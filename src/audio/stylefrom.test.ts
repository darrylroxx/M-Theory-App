/**
 * A chord of an added chords track can say the beat its playing style counts from (`from`, in
 * beats into the section, as `at` is): a style longer than one bar, and a style at half speed,
 * then start where it says and not where the section starts. A chord that does not say counts
 * from the section's start, as it always did. Live, in the render, and in what is made ready.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio, FakeOffline } from "./fakectx";
import { Harp } from "./plucked";
import { TrackVoice } from "./trackvoice";
import { setMix } from "./mix";
import { SOUND_DEFAULT } from "./rack";
import { styleNotes, type ExtraPlay, type Feel, type PatternId, type PlayItem } from "./patterns";
import { presetById } from "../synth/presets";
import type { Tone } from "./tone";

class LiveCtx extends FakeAudio {}
class Render extends FakeOffline {
  constructor(_channels: number, length: number, rate: number) {
    super(rate, length);
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("AudioContext", LiveCtx);
  vi.stubGlobal("OfflineAudioContext", Render);
  setMix(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const S = await import("./synth");

const CHORD = [48, 52, 55, 60];
const BPM = 120;
const SPB = 60 / BPM;
type Chord = ExtraPlay["chords"][number];
const chord = (at: number, beats: number, style: PatternId, more: Partial<Chord> = {}): Chord => ({ track: "x", at, beats, midi: CHORD, style, sound: SOUND_DEFAULT, ...more });
/** three bars of 4/4 with one added chords track; nothing else sounds */
const section = (chords: Chord[]): PlayItem[] => [{ midi: [], beats: 12, section: true, tune: null, meter: { bar: 4 }, extra: { chords, tunes: [], drums: [] } }];

/** Every note the added track is asked for: its pitch, and when (in beats from the start, to a thousandth). */
function watch() {
  const log: string[] = [];
  vi.spyOn(Harp.prototype, "buffer").mockImplementation(() => null as never);
  vi.spyOn(TrackVoice.prototype, "prepare").mockResolvedValue(undefined);
  vi.spyOn(TrackVoice.prototype, "note").mockImplementation(function (this: TrackVoice, midi: number, when: number) {
    if (this.track === "x") log.push(`${midi}@${(when / SPB).toFixed(3)}`);
  });
  return log;
}
/** counted from the first note, so two lists can be held against each other whenever they were started */
const fromFirst = (list: string[]): string[] => {
  const first = Math.min(...list.map((x) => Number(x.split("@")[1])));
  return list.map((x) => `${x.split("@")[0]}@${(Number(x.split("@")[1]) - first).toFixed(3)}`).sort();
};
function live(items: PlayItem[]): string[] {
  const log = watch();
  const p = new S.ProgressionPlayer();
  p.start(items, BPM, "ring", false);
  for (let i = 0; i < 80; i++) {
    (S.getAudio() as unknown as FakeAudio).currentTime += 0.1;
    vi.advanceTimersByTime(100);
  }
  p.stop();
  vi.restoreAllMocks();
  return fromFirst(log);
}
async function rendered(items: PlayItem[]): Promise<string[]> {
  const log = watch();
  await S.renderSong(items, { bpm: BPM, pattern: "ring", beat: null, rate: 8000 });
  vi.restoreAllMocks();
  return [...log].sort();
}
/** the notes a style gives for a chord `into` beats into what it counts from, as pitch@beat counted from `start` */
const notes = (style: PatternId, beats: number, into: number, start: number, feel?: Partial<Feel>) =>
  styleNotes(CHORD, beats, style, into, { bar: 4, triplet: false, swing: 0 }, feel).map((e) => `${e.midi}@${(start + e.beat + e.delay / SPB).toFixed(3)}`).sort();

describe("the beat a chord's playing style counts from", () => {
  // "Son clave" is two bars long: three hits, then two
  it("the two bars of a two-bar style are not the same (or nothing here would be tested)", () => {
    expect(notes("clave", 8, 0, 0)).not.toEqual(notes("clave", 8, 4, 0));
    expect(notes("strum", 8, 0, 0, { speed: 0.5 })).not.toEqual(notes("strum", 8, 4, 0, { speed: 0.5 }));
  });

  it("in the render, a two-bar style on a chord that says `from` starts with its first bar there", async () => {
    // a chord over bars 2 and 3 of the section, whose clip starts on bar 2
    const got = await rendered(section([chord(4, 8, "clave", { from: 4 })]));
    expect(got.length).toBeGreaterThan(0);
    expect(got).toEqual(notes("clave", 8, 0, 4));
  });
  it("in the render, without `from` it counts from the section's start, as it always did", async () => {
    const got = await rendered(section([chord(4, 8, "clave")]));
    expect(got).toEqual(notes("clave", 8, 4, 4));
    expect(got).not.toEqual(notes("clave", 8, 0, 4));
    // and a `from` of nothing is the same as none
    expect(await rendered(section([chord(4, 8, "clave", { from: 0 })]))).toEqual(got);
  });
  it("in the render, a second chord of the same clip goes on from where the first left the pattern", async () => {
    // two chords of one bar each, the clip starting on bar 2: the second plays the style's second bar
    const got = await rendered(section([chord(4, 4, "clave", { from: 4 }), chord(8, 4, "clave", { from: 4 })]));
    expect(got).toEqual([...notes("clave", 4, 0, 4), ...notes("clave", 4, 4, 8)].sort());
  });
  it("in the render, a style at half speed counts from there too", async () => {
    const feel = { speed: 0.5 as const };
    const got = await rendered(section([chord(4, 8, "strum", { from: 4, feel })]));
    expect(got).toEqual(notes("strum", 8, 0, 4, feel));
    expect(await rendered(section([chord(4, 8, "strum", { feel })]))).toEqual(notes("strum", 8, 4, 4, feel));
  });
  it("a clip that started before the section counts from before it", async () => {
    // the clip started one bar before the section: the chord at the section's start is in the style's second bar
    const got = await rendered(section([chord(0, 4, "clave", { from: -4 })]));
    expect(got).toEqual(notes("clave", 4, 4, 0));
  });

  it("live, the same notes at the same moments as in the render", () => {
    const withFrom = section([chord(4, 8, "clave", { from: 4 })]);
    const without = section([chord(4, 8, "clave")]);
    const a = live(withFrom);
    const b = live(without);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(fromFirst(notes("clave", 8, 0, 4)));
    expect(b).toEqual(fromFirst(notes("clave", 8, 4, 4)));
    expect(a).not.toEqual(b);
  });

  it("what is made ready before playing is what will be played", () => {
    const pitches = (items: PlayItem[]) => S.prepFor(items, "ring").filter((n) => n.use?.track === "x").map((n) => `${n.midi}@${n.at!.toFixed(3)}`).sort();
    const beatsOnly = (style: PatternId, into: number) => styleNotes(CHORD, 8, style, into, { bar: 4, triplet: false, swing: 0 }).map((e) => `${e.midi}@${(4 + e.beat).toFixed(3)}`).sort();
    expect(pitches(section([chord(4, 8, "clave", { from: 4 })]))).toEqual(beatsOnly("clave", 0));
    expect(pitches(section([chord(4, 8, "clave")]))).toEqual(beatsOnly("clave", 4));
  });

  it("a synth plays its own way and is not moved by `from`", async () => {
    const tone: Tone = { inst: "synth", synth: presetById("pwm-lead")!.params };
    const a = await rendered(section([chord(4, 8, "clave", { tone })]));
    const b = await rendered(section([chord(4, 8, "clave", { tone, from: 4 })]));
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});
