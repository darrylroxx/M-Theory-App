/**
 * The song player and the song's render, on a pretend audio context: what each track is asked
 * to play, where loops cut it, what a render keeps of the live desks, and the keys on the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio, FakeOffline, asAudio, type FakeAny } from "./fakectx";
import type { FakeSource } from "../keys/fakeaudio";
import { DEFAULT_BEAT, ECHO_TIMES, fxOf, type Beat } from "./beats";
import { SOUND_DEFAULT, type HarpSound } from "./rack";
import { TrackVoice } from "./trackvoice";
import { Harp } from "./plucked";
import { fader, setMix } from "./mix";
import { onKickHit, playStep, syncDrums } from "./drumbus";
import type { ExtraPlay, PlayItem } from "./patterns";
import { LiveKeys } from "../synth/live";
import { DEFAULT_PLAY } from "../synth/params";
import { presetById } from "../synth/presets";
import type { Tone } from "./tone";

/** The live context: made by the app as `new AudioContext()`. */
let live: FakeAudio;
const starts: { ctx: FakeAudio; buffer: unknown; when: number; offset: number; dur?: number; loop: boolean; src: FakeSource }[] = [];
/** Every buffer source a context starts, with how long it was asked to play. */
function watch(c: FakeAudio) {
  const make = c.createBufferSource.bind(c);
  c.createBufferSource = () => {
    const s = make() as unknown as FakeSource;
    const go = s.start.bind(s);
    s.start = (when = 0, offset = 0, dur?: number) => {
      starts.push({ ctx: c, buffer: s.buffer, when, offset, dur, loop: s.loop, src: s });
      go(when, offset);
    };
    return s as never;
  };
}
class LiveCtx extends FakeAudio {
  constructor() {
    super();
    live = this;
    watch(this);
  }
}
const renders: FakeOffline[] = [];
class Render extends FakeOffline {
  constructor(_channels: number, length: number, rate: number) {
    super(rate, length);
    renders.push(this);
    watch(this);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("AudioContext", LiveCtx);
  vi.stubGlobal("OfflineAudioContext", Render);
  starts.length = 0;
  renders.length = 0;
  setMix(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const S = await import("./synth");

/** Every note a track's voice is asked for (nothing is really played: the strings are not made). */
function notes() {
  const log: { track: string; midi: number; when: number; length: number; slot?: number; v: TrackVoice }[] = [];
  vi.spyOn(Harp.prototype, "buffer").mockImplementation(() => null as never);
  vi.spyOn(TrackVoice.prototype, "note").mockImplementation(function (this: TrackVoice, midi: number, when: number, _v: number, length: number, o?: { slot?: number }) {
    log.push({ track: this.track ?? this.kind, midi, when, length, slot: o?.slot, v: this });
  });
  return log;
}
const CHORD = [48, 52, 55];
const chordTrack = (at: number, beats: number): ExtraPlay => ({ chords: [{ track: "c2", at, beats, midi: CHORD, style: "ring", sound: SOUND_DEFAULT }], tunes: [], drums: [] });
const ends = (log: ReturnType<typeof notes>, track: string) => Math.max(...log.filter((n) => n.track === track).map((n) => n.when + (Number.isFinite(n.length) ? n.length : 0)));

describe("an added chords track in a loop", () => {
  // a two-bar section (8 beats at 120: half a second a beat) whose added track holds one chord over both bars
  const extra = chordTrack(0, 8);
  it("a loop on its second bar hears the chord that started in the first", () => {
    const log = notes();
    const p = new S.ProgressionPlayer();
    p.start([{ midi: CHORD, beats: 4, from: 4, section: true, extra }], 120, "ring", true);
    p.stop();
    expect(log.filter((n) => n.track === "c2").length).toBeGreaterThan(0);
  });
  it("a loop on its first bar cuts the chord at the loop's end, so the next time round does not double it", () => {
    const log = notes();
    const p = new S.ProgressionPlayer();
    p.start([{ midi: CHORD, beats: 4, from: 0, section: true, extra }], 120, "ring", true);
    p.stop();
    const t0 = log.find((n) => n.track === "c2")!.when;
    expect(ends(log, "c2")).toBeLessThanOrEqual(t0 + 2 + 1e-6);
  });
  it("the recording backing does the same", async () => {
    const log = notes();
    await S.renderSong([{ midi: CHORD, beats: 4, from: 4, section: true, extra }], { bpm: 120, pattern: "ring", beat: null, rate: 8000 });
    expect(log.filter((n) => n.track === "c2").length).toBeGreaterThan(0);
    log.length = 0;
    await S.renderSong([{ midi: CHORD, beats: 4, from: 0, section: true, extra }], { bpm: 120, pattern: "ring", beat: null, rate: 8000 });
    expect(ends(log, "c2")).toBeLessThanOrEqual(2 + 1e-6);
  });
});

describe("a recorded take in a loop", () => {
  // the take covers four bars from the start of its section (8 s at 120); the loop is bars 2 and 3
  const buffer = { duration: 8 } as unknown as AudioBuffer;
  const items: PlayItem[] = [{ midi: CHORD, beats: 8, from: 4, section: true, extra: { chords: [], tunes: [], drums: [], takes: [{ track: "v1", buffer, at: 0, offset: 0, dur: 8 }] } }];
  it("live, it stops where the loop ends, so the next time round does not play over it", () => {
    notes();
    const p = new S.ProgressionPlayer();
    p.start(items, 120, "ring", true);
    p.stop();
    const take = starts.find((s) => s.buffer === buffer)!;
    expect(take.offset).toBeCloseTo(2, 6);
    expect(take.dur).toBeCloseTo(4, 6);
  });
  it("in the recording backing, a take under way where the loop starts is heard, as it is live", async () => {
    notes();
    await S.renderSong(items, { bpm: 120, pattern: "ring", beat: null, rate: 8000 });
    const take = starts.find((s) => s.buffer === buffer && s.ctx === renders[0]);
    expect(take).toBeTruthy();
    expect(take!.when).toBeCloseTo(0, 6);
    expect(take!.offset).toBeCloseTo(2, 6);
    expect(take!.dur).toBeCloseTo(4, 6);
  });
});

describe("melody notes struck together", () => {
  // two notes at once on the strings (a harmony): each on a string of its own, so neither damps the other
  const tune = { m: { div: 1 as const, bars: 1, notes: [{ at: 0, midi: 60 }, { at: 0, midi: 64 }, { at: 12, midi: 62 }] }, bar: 4, swing: 0 };
  const items: PlayItem[] = [{ midi: CHORD, beats: 4, section: true, tune }];
  const slots = (log: ReturnType<typeof notes>) => log.filter((n) => n.track === "melody").map((n) => n.slot);
  it("ring together in the render, as they do live", async () => {
    const log = notes();
    const p = new S.ProgressionPlayer();
    p.start(items, 120, "ring", false);
    p.stop();
    const heard = slots(log);
    log.length = 0;
    await S.renderSong(items, { bpm: 120, pattern: "ring", beat: null, rate: 8000 });
    // (live, only the first beat is booked yet: the player looks a moment ahead)
    expect(heard.length).toBe(2);
    expect(slots(log).slice(0, 2)).toEqual(heard);
    expect(new Set(heard).size).toBe(2);
  });
});

describe("a melody on a synth's drone, in a loop of a section's second bar", () => {
  // C on beat 1, then E from beat 4 into the second bar: nothing of the tune starts where the loop does
  const lead = presetById("pwm-lead")!.params;
  const drone: Tone = { inst: "synth", synth: { ...lead, play: { ...lead.play, mode: "drone", humanise: 0 } } };
  const tune = { m: { div: 1 as const, bars: 2, notes: [{ at: 0, midi: 60 }, { at: 36, midi: 64 }] }, bar: 4, swing: 0, tone: drone };
  const items: PlayItem[] = [{ midi: CHORD, beats: 4, from: 4, section: true, tune }];
  it("is heard from the loop's start, live and in the recording backing", async () => {
    const log = notes();
    const p = new S.ProgressionPlayer();
    p.start(items, 120, "ring", true);
    const first = Math.min(...log.filter((n) => n.track === "melody").map((n) => n.when));
    p.stop();
    expect(first).toBeCloseTo(live.currentTime + 0.08, 6);
    log.length = 0;
    // (the synth's processor is not loaded here)
    vi.spyOn(TrackVoice.prototype, "prepare").mockResolvedValue(undefined);
    await S.renderSong(items, { bpm: 120, pattern: "ring", beat: null, rate: 8000 });
    expect(log.filter((n) => n.track === "melody" && Math.abs(n.when) < 1e-6).length).toBeGreaterThanOrEqual(2);
  });
});

describe("a section's own sound", () => {
  it("is let go when the music stops: the page's own sound is heard again", () => {
    const log = notes();
    const verse: HarpSound = { ...SOUND_DEFAULT, verb: "hall", space: 0.6 };
    const chorus: HarpSound = { ...SOUND_DEFAULT, verb: "plate", space: 0.2, echo: 0.5 };
    S.setHarpSound(verse, 120);
    const p = new S.ProgressionPlayer();
    p.start([{ midi: CHORD, beats: 4, section: true, sound: chorus }], 120, "ring", false);
    const v = log.find((n) => n.track === "chord")!.v as unknown as { sound: HarpSound };
    expect(v.sound).toEqual(chorus);
    p.stop();
    expect(v.sound).toEqual(verse);
  });
  it("another section's page shown while one plays leaves the playing chord's sound alone until the music stops", () => {
    const log = notes();
    const verse: HarpSound = { ...SOUND_DEFAULT, verb: "hall", space: 0.6 };
    const chorus: HarpSound = { ...SOUND_DEFAULT, level: 0.4, echo: 0.5 };
    S.setHarpSound(verse, 120);
    const p = new S.ProgressionPlayer();
    p.start([{ midi: CHORD, beats: 4, section: true, sound: verse }], 120, "ring", false);
    const v = log.find((n) => n.track === "chord")!.v as unknown as { sound: HarpSound };
    // the chorus's page is shown: its sound is noted for the page, not put on the ringing verse chord
    S.setHarpSound(chorus, 120, false);
    expect(v.sound).toEqual(verse);
    p.stop();
    expect(v.sound).toEqual(chorus);
  });
});

describe("the drum desks", () => {
  const beat = (over: Partial<Beat> = {}): Beat => ({ ...DEFAULT_BEAT, on: true, ...over });
  it("a render leaves the canvas listening to the drums that are heard", async () => {
    notes();
    S.getAudio();
    syncDrums(beat(), 120, "drums");
    const tapped = () => (fader("drums", asAudio(live)) as unknown as FakeAny).outputs.some((n) => (n as FakeAny).fftSize === 8192);
    expect(tapped()).toBe(true);
    await S.renderSong([{ midi: CHORD, beats: 4, section: true }], { bpm: 120, pattern: "ring", beat: beat(), rate: 8000 });
    expect(renders[0].nodes.some((n) => (n as FakeAny).fftSize === 8192)).toBe(false);
    expect(tapped()).toBe(true);
  });
  it("a render has the noise bed the drums have live", async () => {
    notes();
    await S.renderSong([{ midi: [], beats: 4, section: true }], { bpm: 120, pattern: "ring", beat: beat({ noise: "vinyl", noiseAmt: 0.6 }), rate: 8000 });
    const beds = starts.filter((s) => s.ctx === renders[0] && s.loop);
    expect(beds.length).toBe(1);
    // and stops where the song ends, as live: not on through a file's tail or round over the loop's start
    expect(beds[0].src.stopsAt).toBeCloseTo(2, 6);
  });
  it("in a render, an added drums track's noise bed stops where a section without it starts, and comes back with it", async () => {
    notes();
    const bed = beat({ noise: "tape", noiseAmt: 0.6 });
    const withD2: ExtraPlay = { chords: [], tunes: [], drums: [{ track: "d2", beat: bed }] };
    const none: ExtraPlay = { chords: [], tunes: [], drums: [] };
    // three one-bar sections at 120 (two seconds each): the added track drums in the first and the last
    const items: PlayItem[] = [
      { midi: [], beats: 4, section: true, extra: withD2 },
      { midi: [], beats: 4, section: true, extra: none },
      { midi: [], beats: 4, section: true, extra: withD2 },
    ];
    await S.renderSong(items, { bpm: 120, pattern: "ring", beat: null, rate: 8000 });
    const beds = starts.filter((s) => s.ctx === renders[0] && s.loop);
    expect(beds.map((s) => s.when)).toEqual([0, 4]);
    expect(beds[0].src.stopsAt).toBeCloseTo(2, 6);
    expect(beds[1].src.stopsAt).toBeCloseTo(6, 6);
  });
  describe("live, the first track's noise bed follows the section that is playing, as a render has it", () => {
    // two one-bar sections at 120 (two seconds each); the page shows the first
    const vinyl = beat({ noise: "vinyl", noiseAmt: 0.6 });
    const off = beat({ on: false, noise: "vinyl", noiseAmt: 0.6 });
    const two = (a: Beat, b: Beat): PlayItem[] => [
      { midi: CHORD, beats: 4, section: true, drums: a },
      { midi: CHORD, beats: 4, section: true, drums: b },
    ];
    /** Playing starts at 0 on the clock (the music a moment later); returns where the music starts. */
    const begin = () => {
      S.getAudio();
      live.currentTime = 0;
      return 0.08;
    };
    const run = (_p: InstanceType<typeof S.ProgressionPlayer>, to: number) => {
      live.currentTime = to;
      vi.advanceTimersByTime(30);
    };
    const beds = () => starts.filter((s) => s.ctx === live && s.loop);
    it("a section with drums after one without starts its bed where it starts", () => {
      notes();
      const items = two(off, vinyl);
      const p = new S.ProgressionPlayer();
      const t0 = begin();
      p.start(items, 120, "ring", false, off);
      run(p, 1);
      p.update(items, 120, "ring", false, off);
      expect(beds().length).toBe(0);
      run(p, 2.5);
      p.update(items, 120, "ring", false, off);
      expect(beds().length).toBe(1);
      expect(beds()[0].when).toBeCloseTo(t0 + 2, 6);
      p.stop();
    });
    it("a section without drums stops the bed where it starts", () => {
      notes();
      const items = two(vinyl, off);
      const p = new S.ProgressionPlayer();
      const t0 = begin();
      p.start(items, 120, "ring", false, vinyl);
      run(p, 2.5);
      p.update(items, 120, "ring", false, vinyl);
      expect(beds().length).toBe(1);
      expect(beds()[0].src.stopsAt).toBeCloseTo(t0 + 2, 6);
      p.stop();
    });
    it("showing another section's page while one plays leaves the playing one's bed alone", () => {
      notes();
      const items = two(vinyl, off);
      const p = new S.ProgressionPlayer();
      begin();
      p.start(items, 120, "ring", false, vinyl);
      run(p, 0.5);
      p.update(items, 120, "ring", false, off);
      expect(beds().length).toBe(1);
      expect(beds()[0].src.stopsAt).toBe(Infinity);
      p.stop();
    });
  });
  it("a new tempo while playing moves an added drums track's echo to it", () => {
    notes();
    const echo = beat({ echo: 0.5 });
    const items: PlayItem[] = [{ midi: CHORD, beats: 4, section: true, extra: { chords: [], tunes: [], drums: [{ track: "d2", beat: echo }] } }];
    const p = new S.ProgressionPlayer();
    p.start(items, 90, "ring", true);
    p.update(items, 140, "ring", true);
    p.stop();
    const want = Math.min(1.9, (ECHO_TIMES.find((e) => e.id === fxOf(echo).echoTime)!.beats * 60) / 140);
    const set = live.nodes.some((n) => (n as FakeAny).delayTime?.events.some((e) => Math.abs(e.v - want) < 1e-9));
    expect(set).toBe(true);
  });
  it("a kick that cannot be heard (its track muted, or another soloed) pumps nothing", () => {
    S.getAudio();
    const pumped: number[] = [];
    onKickHit((when) => pumped.push(when));
    const pump = beat({ pump: 0.6 });
    syncDrums(pump, 120, "d2");
    setMix({ d2: { mute: true } });
    playStep(pump, "kick", 3, 0.1, "d2");
    setMix({ chords: { solo: true } });
    playStep(pump, "kick", 3, 0.2, "d2");
    expect(pumped).toEqual([]);
    setMix(undefined);
    playStep(pump, "kick", 3, 0.3, "d2");
    expect(pumped).toEqual([0.3]);
    onKickHit(null);
  });
});

describe("the keys on the screen", () => {
  const drone = { ...DEFAULT_PLAY, mode: "drone" as const };
  it("a note is let go on the track that played it, though the page now edits another", () => {
    S.setTones({ chords: { inst: "synth" }, c2: { inst: "synth" } });
    S.hearOn("chord", null);
    const out = S.liveKeys("chord");
    const keys = new LiveKeys(out, () => drone);
    keys.press(60);
    const gone: string[] = [];
    vi.spyOn(TrackVoice.prototype, "letGo").mockImplementation(function (this: TrackVoice) {
      gone.push(this.track ?? this.kind);
    });
    S.hearOn("chord", { id: "c2", sound: SOUND_DEFAULT });
    // the latched key tapped again
    keys.press(60);
    expect(gone).toEqual(["chord"]);
    S.hearOn("chord", null);
    S.setTones(undefined);
  });
  it("when every sound is stopped, the keys go up with it", () => {
    S.setTones({ chords: { inst: "synth" } });
    const out = S.liveKeys("chord");
    const keys = new LiveKeys(out, () => drone);
    const stop = out.onCut?.(() => keys.releaseAll());
    keys.press(60);
    keys.press(64);
    expect(keys.keys).toEqual([60, 64]);
    S.stopAll();
    expect(keys.keys).toEqual([]);
    stop?.();
    S.setTones(undefined);
  });
});
