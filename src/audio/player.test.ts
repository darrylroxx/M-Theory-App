/**
 * The song player and the song's render, on a pretend audio context: what each track is asked
 * to play, where loops cut it, and what a render keeps of the live desks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio, FakeOffline, asAudio, type FakeAny } from "./fakectx";
import type { FakeParam, FakeSource } from "../keys/fakeaudio";
import { DEFAULT_BEAT, ECHO_TIMES, fxOf, type Beat } from "./beats";
import { SOUND_DEFAULT, type HarpSound } from "./rack";
import { TrackVoice } from "./trackvoice";
import { Harp } from "./plucked";
import { fader, setMix } from "./mix";
import { onKickHit, playStep, syncDrums } from "./drumbus";
import type { ExtraPlay, PlayItem } from "./patterns";
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
/** a noise bed fades out over 20 ms when it stops, and its source stops just after */
const BED_STOP = 0.021;

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

describe("the first notes of every track are ready before the clock starts", () => {
  // a section with a chord on the first chords track, an added chords track's chord on the strings over both
  // bars, a melody, and an added melody: all of them start on the first beat
  const tune = { m: { div: 1 as const, bars: 2, notes: [{ at: 0, midi: 72 }, { at: 12, midi: 74 }] }, bar: 4, swing: 0 };
  const m2 = { m: { div: 1 as const, bars: 2, notes: [{ at: 0, midi: 84 }, { at: 48, midi: 86 }] }, bar: 4, swing: 0 };
  const extra: ExtraPlay = { chords: [{ track: "c2", at: 0, beats: 8, midi: [57, 60, 64], style: "ring", sound: SOUND_DEFAULT }], tunes: [{ track: "m2", tune: m2 }], drums: [] };
  const items: PlayItem[] = [{ midi: CHORD, beats: 4, section: true, tune, extra }, { midi: [55, 59, 62], beats: 4, tune, extra }];
  it("every note booked as ▶ is pressed was made on its own track's strings before anything was booked", () => {
    const ev: { what: "buffer" | "note"; key: string }[] = [];
    vi.spyOn(Harp.prototype, "buffer").mockImplementation(function (this: Harp, midi: number) {
      ev.push({ what: "buffer", key: `${this.track ?? this.tag}:${midi}` });
      return null as never;
    });
    vi.spyOn(TrackVoice.prototype, "note").mockImplementation(function (this: TrackVoice, midi: number) {
      ev.push({ what: "note", key: `${this.track ?? this.kind}:${midi}` });
    });
    const p = new S.ProgressionPlayer();
    p.start(items, 120, "ring", true);
    p.stop();
    const first = ev.findIndex((e) => e.what === "note");
    const booked = new Set(ev.filter((e) => e.what === "note").map((e) => e.key));
    const ready = new Set(ev.slice(0, first).filter((e) => e.what === "buffer").map((e) => e.key));
    // the added chords track, the melody and the added melody are booked straight away too
    for (const k of ["chord:48", "c2:57", "c2:60", "c2:64", "melody:72", "m2:84"]) expect(booked.has(k), k).toBe(true);
    for (const k of booked) expect(ready.has(k), k).toBe(true);
  });
  it("what the song needs later is listed to be made in the background: every track, on its own voice, soonest first", () => {
    const need = S.prepFor(items, "ring", null, null);
    const keys = new Set(need.map((n) => `${n.use?.track}:${n.midi}`));
    for (const k of ["chords:48", "chords:55", "c2:57", "c2:60", "c2:64", "melody:72", "melody:74", "m2:84", "m2:86"]) expect(keys.has(k), k).toBe(true);
    // each on its own slot (an added track's notes never go to the first track's strings)
    expect(new Set(need.filter((n) => n.use?.track === "c2").map((n) => n.slot)).size).toBe(1);
    expect(need.find((n) => n.use?.track === "c2")!.slot).not.toBe(need.find((n) => n.use?.track === "chords")!.slot);
    const at = need.map((n) => n.at!);
    expect(at).toEqual([...at].sort((a, b) => a - b));
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

describe("each section plays a track its own way", () => {
  const piano: Tone = { inst: "piano" };
  const verse: HarpSound = { ...SOUND_DEFAULT, verb: "hall", space: 0.6 };
  const chorus: HarpSound = { ...SOUND_DEFAULT, verb: "plate", space: 0.2, echo: 0.5 };
  /** two one-bar sections at 120 (two seconds each): A on the strings with one sound, B on its own */
  const two = (b: Partial<PlayItem>): PlayItem[] => [
    { midi: CHORD, beats: 4, section: true, sound: verse },
    { midi: CHORD, beats: 4, section: true, sound: verse, ...b },
  ];
  const run = (to: number) => {
    live.currentTime = to;
    vi.advanceTimersByTime(30);
  };
  it("live: B's chords are on a voice of B's own from B's first beat, and A's voice is never touched", () => {
    const log = notes();
    const swaps = vi.spyOn(TrackVoice.prototype, "setTone");
    const p = new S.ProgressionPlayer();
    S.getAudio();
    live.currentTime = 0;
    p.start(two({ tone: piano, sound: chorus }), 120, "ring", false);
    for (let t = 0.2; t < 4.2; t += 0.2) run(t);
    const a = log.filter((n) => n.track === "chord" && n.when < 2.08 - 1e-6);
    const b = log.filter((n) => n.track === "chord" && n.when >= 2.08 - 1e-6);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    const va = a[0].v;
    const vb = b[0].v;
    expect(va).not.toBe(vb);
    expect(a.every((n) => n.v === va) && b.every((n) => n.v === vb)).toBe(true);
    // B starts exactly where B starts, on its own instrument and sound
    expect(Math.min(...b.map((n) => n.when))).toBeCloseTo(0.08 + 2, 9);
    expect([vb.tone.inst, vb.sound]).toEqual(["piano", chorus]);
    expect([va.tone.inst, va.sound]).toEqual(["guitar", verse]);
    // nothing was switched on A's voice while it played (no instrument change cuts its notes off)
    expect(swaps.mock.calls.filter((c) => swaps.mock.contexts[swaps.mock.calls.indexOf(c)] === va && (c[0] as Tone).inst !== "guitar")).toEqual([]);
    p.stop();
  });
  it("in a render: each section on its own voice, made on its own instrument and sound, nothing changed mid-render", async () => {
    const log = notes();
    vi.spyOn(TrackVoice.prototype, "prepare").mockResolvedValue(undefined);
    const swaps = vi.spyOn(TrackVoice.prototype, "setTone");
    const sounds = vi.spyOn(TrackVoice.prototype, "setSound");
    await S.renderSong(two({ tone: piano, sound: chorus }), { bpm: 120, pattern: "ring", beat: null, rate: 8000 });
    const a = log.filter((n) => n.track === "chord" && n.when < 2 - 1e-6);
    const b = log.filter((n) => n.track === "chord" && n.when >= 2 - 1e-6);
    expect(a[0].v).not.toBe(b[0].v);
    expect(Math.min(...b.map((n) => n.when))).toBe(2);
    expect([b[0].v.tone.inst, b[0].v.sound]).toEqual(["piano", chorus]);
    expect([a[0].v.tone.inst, a[0].v.sound]).toEqual(["guitar", verse]);
    // each voice took its tone and its sound once, when it was made, and never another
    for (const v of [a[0].v, b[0].v]) {
      expect(new Set(swaps.mock.contexts.flatMap((x, i) => (x === v ? [JSON.stringify(swaps.mock.calls[i][0])] : []))).size).toBe(1);
      expect(new Set(sounds.mock.contexts.flatMap((x, i) => (x === v ? [JSON.stringify(sounds.mock.calls[i][0])] : []))).size).toBe(1);
    }
  });
  it("sections that play a track the same way share one voice, live and in a render", async () => {
    const log = notes();
    vi.spyOn(TrackVoice.prototype, "prepare").mockResolvedValue(undefined);
    const p = new S.ProgressionPlayer();
    S.getAudio();
    live.currentTime = 0;
    // (equal sounds, made separately: it is what they are that counts)
    p.start(two({ sound: { ...verse } }), 120, "ring", false);
    for (let t = 0.2; t < 4.2; t += 0.2) run(t);
    p.stop();
    expect(new Set(log.filter((n) => n.track === "chord").map((n) => n.v)).size).toBe(1);
    log.length = 0;
    await S.renderSong(two({ sound: { ...verse } }), { bpm: 120, pattern: "ring", beat: null, rate: 8000 });
    expect(new Set(log.filter((n) => n.track === "chord").map((n) => n.v)).size).toBe(1);
  });
  it("a knob turned on the page is heard at once on the same voice, never a new one", () => {
    notes();
    S.getAudio();
    // (sounds of this test's own: no voice has them yet)
    const verse: HarpSound = { ...SOUND_DEFAULT, level: 0.31 };
    const chorus: HarpSound = { ...SOUND_DEFAULT, level: 0.32 };
    S.hearOn("chord", { track: "chords", kind: "chord", sound: verse });
    const log = notes();
    S.strum([48, 52, 55]);
    const v = log[0].v;
    S.hearOn("chord", { track: "chords", kind: "chord", sound: chorus });
    log.length = 0;
    S.strum([48, 52, 55]);
    expect(log[0].v).toBe(v);
    expect(v.sound).toEqual(chorus);
    // an instrument chosen: the same voice takes it
    S.hearOn("chord", { track: "chords", kind: "chord", tone: piano, sound: chorus });
    log.length = 0;
    S.strum([48, 52, 55]);
    expect(log[0].v).toBe(v);
    expect(v.tone.inst).toBe("piano");
    S.hearOn("chord", null);
  });
  it("a keys or synth control dragged step by step, as the page does it (the song first, then what is heard), keeps one voice: none piles up", () => {
    notes();
    S.getAudio();
    const sound: HarpSound = { ...SOUND_DEFAULT, level: 0.33 };
    let tone: Tone = { inst: "piano", bright: 0.5 };
    const use = () => ({ track: "chords", kind: "chord" as const, tone, sound });
    S.keepSlots([use()], []);
    S.hearOn("chord", use());
    const before = S.voiceCount();
    const log = notes();
    S.strum([48, 52, 55]);
    const v = log[0].v;
    for (let i = 1; i <= 20; i++) {
      tone = { inst: "piano", bright: 0.5 + i / 50 };
      // the order the page's effects run in: the song's slots, then the track heard on the page
      S.keepSlots([use()], []);
      S.hearOn("chord", use());
    }
    expect(S.voiceCount()).toBe(before);
    log.length = 0;
    S.strum([48, 52, 55]);
    expect(log[0].v).toBe(v);
    expect(v.tone.bright).toBeCloseTo(0.9);
    // a section that still plays the old setting keeps its own voice: only then is there a second one
    const old = use();
    tone = { inst: "piano", bright: 0.2 };
    S.keepSlots([old, use()], []);
    S.hearOn("chord", use());
    expect(S.voiceCount()).toBe(before + 1);
    S.hearOn("chord", null);
  });
  it("an added track's first chord is on the track's own sound from its start, in a render and on every ▶", async () => {
    const log = notes();
    const quiet: HarpSound = { ...SOUND_DEFAULT, level: 0.3, drive: 0.5 };
    const target = 0.3 * 0.3 * 1.25;
    // (the rack's level comes straight after its pump)
    const level = (v: TrackVoice) => ((v.rack.duck as unknown as FakeAny).outputs[0] as FakeAny).gain;
    const extra: ExtraPlay = { chords: [{ track: "c9", at: 0, beats: 4, midi: CHORD, style: "ring", sound: quiet }], tunes: [], drums: [] };
    const items: PlayItem[] = [{ midi: CHORD, beats: 4, section: true, extra }];
    await S.renderSong(items, { bpm: 120, pattern: "ring", beat: null, rate: 8000 });
    const r = log.find((n) => n.track === "c9")!;
    expect(level(r.v).at(r.when + 0.005)).toBeCloseTo(target, 3);
    const p = new S.ProgressionPlayer();
    for (let pass = 0; pass < 2; pass++) {
      log.length = 0;
      p.start(items, 120, "ring", false);
      const n = log.find((x) => x.track === "c9")!;
      expect(level(n.v).at(n.when + 0.005)).toBeCloseTo(target, 3);
      p.stop();
    }
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
    // (faded out from there over 20 ms, so it is not cut off with a click)
    expect(beds[0].src.stopsAt).toBeCloseTo(2 + BED_STOP, 6);
    const fade = (beds[0].src.outputs[0] as unknown as { gain: FakeParam }).gain;
    expect(fade.at(2)).toBe(1);
    expect(fade.at(2.01)).toBeCloseTo(0.5, 6);
    expect(fade.at(2.02)).toBe(0);
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
    expect(beds[0].src.stopsAt).toBeCloseTo(2 + BED_STOP, 6);
    expect(beds[1].src.stopsAt).toBeCloseTo(6 + BED_STOP, 6);
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
      // (booked late, the page having been busy until 2.5 s: it fades out from then, as a stop booked in the past would have been heard)
      expect(t0 + 2).toBeLessThan(2.5);
      expect(beds()[0].src.stopsAt).toBeCloseTo(2.5 + BED_STOP, 6);
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
  it("live, a kick pumps as its own section's kit has it: A's last kicks keep A's, B's first take B's", () => {
    S.getAudio();
    live.currentTime = 0;
    const pumped: number[] = [];
    onKickHit((when) => pumped.push(when));
    syncDrums(beat({ pump: 0.6 }), 120, "dp");
    // B, with no pump, booked to start at 2 s
    syncDrums(beat({ pump: 0 }), 120, "dp", 2);
    playStep(beat(), "kick", 3, 1.9, "dp");
    playStep(beat(), "kick", 3, 2.1, "dp");
    expect(pumped).toEqual([1.9]);
    onKickHit(null);
  });
  it("a kick that cannot be heard (its track muted, or another soloed) pumps nothing", () => {
    S.getAudio();
    live.currentTime = 0;
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

describe("a note played to be heard", () => {
  it("goes to the track being edited, so an instrument that finishes loading after another track was picked is not heard on that one", () => {
    expect(S.heardTrack("chord")).toBe("chords");
    S.hearOn("chord", { track: "c2", kind: "chord", sound: SOUND_DEFAULT });
    expect(S.heardTrack("chord")).toBe("c2");
    expect(S.heardTrack("melody")).toBe("melody");
    S.hearOn("chord", null);
    expect(S.heardTrack("chord")).toBe("chords");
  });
});


describe("the page held up while the song plays (see late.ts)", () => {
  it("drum hits whose moment has passed start part-way in, faded in, or are left out once over: none is piled up at once", async () => {
    const { LATE_FADE, lateCount } = await import("./late");
    notes();
    const b: Beat = { ...DEFAULT_BEAT, on: true };
    const items: PlayItem[] = [{ midi: CHORD, beats: 4, section: true, drums: b }];
    const p = new S.ProgressionPlayer();
    S.getAudio();
    live.currentTime = 0;
    p.start(items, 120, "ring", true, b);
    const tick = (to: number) => {
      live.currentTime = to;
      vi.advanceTimersByTime(25);
    };
    for (let t = 0.025; t <= 1; t += 0.025) tick(t);
    const hits = () => starts.filter((s) => s.ctx === live && !s.loop);
    const before = hits().length;
    const was = { ...lateCount };
    expect(before).toBeGreaterThan(4);
    // the page is held up for 600 ms: the next timer runs at 1.6 s
    tick(1.6);
    const after = hits().slice(before);
    // nothing is booked for a moment already gone (the audio thread would play it at once, from its start)
    expect(after.filter((s) => s.when < 1.6 - 1e-9).length).toBe(0);
    // the hits that fell due while the page was held up start now, each as far into itself as it is late
    const partway = after.filter((s) => s.when === 1.6 && s.offset > 0.01);
    expect(partway.length).toBeGreaterThan(0);
    // only the latest of each drum (the ones before it would sound under it, quieter): not a burst of every hit missed
    const drums = Object.values(b.rows).filter((r) => /[123]/.test(r ?? "")).length;
    expect(partway.length).toBeLessThanOrEqual(drums);
    expect(lateCount.drums - was.drums).toBe(partway.length);
    // (the hits whose sound was over by then are left out: counted, not played)
    expect(lateCount.over).toBeGreaterThanOrEqual(was.over);
    for (const s of partway) {
      // a hit begun in its middle starts with a step: it fades in from silence, over a few milliseconds
      const fade = s.src.outputs[0] as unknown as { gain: FakeParam };
      expect(fade.gain.at(1.6)).toBe(0);
      expect(fade.gain.at(1.6 + LATE_FADE / 2)).toBeCloseTo(0.5, 6);
      expect(fade.gain.at(1.6 + LATE_FADE)).toBe(1);
      // and it is still a sound of its own length: it ends where it would have
      expect(s.offset).toBeLessThan((s.buffer as { duration: number }).duration);
    }
    // the hits on time go straight on, with no fade of their own
    const onTime = after.filter((s) => s.when > 1.6);
    expect(onTime.length).toBeGreaterThan(0);
    for (const s of onTime) expect(s.offset).toBe(0);
    // and it carries on in time
    tick(2);
    expect(hits().length).toBeGreaterThan(before + after.length);
    p.stop();
  });
  it("around a page switch the song is booked a second ahead, so a page held up for most of a second leaves nothing late", async () => {
    const { lateCount } = await import("./late");
    notes();
    const b: Beat = { ...DEFAULT_BEAT, on: true };
    const items: PlayItem[] = [{ midi: CHORD, beats: 4, section: true, drums: b }];
    const p = new S.ProgressionPlayer();
    S.getAudio();
    live.currentTime = 0;
    p.start(items, 120, "ring", true, b);
    const tick = (to: number) => {
      live.currentTime = to;
      vi.advanceTimersByTime(25);
    };
    for (let t = 0.025; t <= 1; t += 0.025) tick(t);
    const hits = () => starts.filter((s) => s.ctx === live && !s.loop);
    // usually booked a quarter of a second ahead
    expect(Math.max(...hits().map((s) => s.when))).toBeLessThan(1 + 0.25 + 1e-6);
    // a page is about to open: booked a second ahead at once
    S.bookAhead();
    expect(Math.max(...hits().map((s) => s.when))).toBeGreaterThan(1 + S.SWITCH_AHEAD);
    const was = { ...lateCount };
    // the page is held up for 900 ms: nothing fell due unbooked, so nothing starts late
    tick(1.9);
    expect(lateCount.drums).toBe(was.drums);
    expect(lateCount.over).toBe(was.over);
    // and once the moment has passed, it books a quarter of a second ahead again
    for (let t = 1.925; t <= 4; t += 0.025) tick(t);
    expect(Math.max(...hits().map((s) => s.when))).toBeLessThan(4 + 0.25 + 1e-6);
    p.stop();
    // stopped: there is nothing to book ahead
    const n = hits().length;
    S.bookAhead();
    expect(hits().length).toBe(n);
  });
  it("a kick started late pumps nothing (its thump has passed), and a late hat chokes an open one from when it really starts", async () => {
    S.getAudio();
    const pumped: number[] = [];
    onKickHit((when) => pumped.push(when));
    const pump: Beat = { ...DEFAULT_BEAT, on: true, pump: 0.6 };
    syncDrums(pump, 120, "d2");
    live.currentTime = 1;
    playStep(pump, "kick", 3, 0.95, "d2");
    expect(pumped).toEqual([]);
    playStep(pump, "kick", 3, 1.1, "d2");
    expect(pumped).toEqual([1.1]);
    onKickHit(null);
    // an open hat rings; a closed one booked 50 ms late cuts it from the moment it starts, not from a moment gone
    playStep(pump, "open", 3, 1.2, "d2");
    const open = starts[starts.length - 1].src.outputs[0] as unknown as { gain: FakeParam };
    live.currentTime = 1.35;
    playStep(pump, "hat", 3, 1.3, "d2");
    expect(open.gain.at(1.35)).toBeCloseTo(open.gain.at(1.34), 6);
    expect(open.gain.at(1.45)).toBeLessThan(0.1 * open.gain.at(1.35));
  });
  it("a recorded note booked late starts in a moment, that far into itself (at the speed it plays at), faded in, so it ends where it would have", async () => {
    const { LATE_FADE, startRecorded } = await import("./late");
    const c = new FakeAudio();
    c.currentTime = 2;
    const into = c.createGain();
    const got: number[][] = [];
    const conns: unknown[] = [];
    const src = { start: (w: number, o: number) => got.push([w, o]), connect: (n: unknown) => (conns.push(n), n), playbackRate: { value: 1 }, detune: { value: 1200 } };
    expect(startRecorded(asAudio(c), src as never, 1.8, into as never, 0.01)).toBe(2);
    expect(got[0][0]).toBe(2);
    // an octave up plays twice as fast: 0.2 s late is 0.4 s into the recording
    expect(got[0][1]).toBeCloseTo(0.41, 9);
    // through a fade of its own, from silence, into where it was going
    const fade = conns[0] as FakeAny;
    expect(fade).not.toBe(into);
    expect(fade.outputs).toEqual([into]);
    expect(fade.gain.at(2)).toBe(0);
    expect(fade.gain.at(2 + LATE_FADE)).toBe(1);
    // the audio thread works ahead of the clock the page reads: a late note starts after that, so its fade is heard whole
    (c as unknown as { baseLatency: number }).baseLatency = 0.02;
    expect(startRecorded(asAudio(c), src as never, 1.8, into as never, 0)).toBeCloseTo(2.023, 9);
    expect(got[1][1]).toBeCloseTo(2 * 0.223, 9);
    (c as unknown as { baseLatency: number }).baseLatency = 0;
    // on time, or a moment old (a sound tapped to be heard): as asked, straight in
    expect(startRecorded(asAudio(c), src as never, 2.1, into as never, 0)).toBe(2.1);
    expect(got[2]).toEqual([2.1, 0]);
    expect(conns[2]).toBe(into);
    expect(startRecorded(asAudio(c), src as never, 1.995, into as never, 0)).toBe(1.995);
    expect(conns[3]).toBe(into);
    // a render is never late
    const off = new FakeOffline();
    off.currentTime = 2;
    startRecorded(asAudio(off), src as never, 1, into as never, 0);
    expect(got[4]).toEqual([1, 0]);
  });
});
