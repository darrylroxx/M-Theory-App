/**
 * A melody note with a length of its own: on the keys and the synth it is held that long, and
 * never past the next note; on the strings it rings as it always did. A note with no length is
 * held as it always was. Live and in the render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio, FakeOffline } from "./fakectx";
import { Harp } from "./plucked";
import { TrackVoice } from "./trackvoice";
import { setMix } from "./mix";
import type { PlayItem, PlayTune } from "./patterns";
import type { Tone } from "./tone";
import { tuneSection } from "./trackplay";
import { tuneBetween, type Melody } from "../song/melody";

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

/** How long each melody note is asked to be held (seconds). */
function lengths() {
  const log: { midi: number; length: number }[] = [];
  vi.spyOn(Harp.prototype, "buffer").mockImplementation(() => null as never);
  vi.spyOn(TrackVoice.prototype, "prepare").mockResolvedValue(undefined);
  vi.spyOn(TrackVoice.prototype, "note").mockImplementation(function (this: TrackVoice, midi: number, _when: number, _v: number, length: number) {
    if ((this.track ?? this.kind) === "melody") log.push({ midi, length });
  });
  return log;
}

const piano: Tone = { inst: "piano" };
// a note on beat 1 and one on beat 3, in one bar of 4/4 at 120 (half a second a beat)
const melody = (len?: number): Melody => ({ div: 1, bars: 1, notes: [{ at: 0, midi: 60, ...(len !== undefined ? { len } : {}) }, { at: 24, midi: 62 }] });
const items = (len: number | undefined, tone?: Tone): PlayItem[] => {
  const tune: PlayTune = { m: melody(len), bar: 4, swing: 0, ...(tone ? { tone } : {}) };
  return [{ midi: [], beats: 4, section: true, tune, meter: { bar: 4 } }];
};
const first = (log: { midi: number; length: number }[]) => log.find((n) => n.midi === 60)!.length;

describe("a melody note with a length", () => {
  it("is carried on each hit of the tune", () => {
    expect(tuneBetween(melody(6), 4, 0, 4)).toEqual([{ beat: 0, midi: 60, len: 6 }, { beat: 2, midi: 62 }]);
    expect(tuneBetween(melody(), 4, 0, 4)).toEqual([{ beat: 0, midi: 60 }, { beat: 2, midi: 62 }]);
  });
  it("on the keys, live, is held that long: half a beat, not the two beats to the next note", () => {
    const log = lengths();
    const p = new S.ProgressionPlayer();
    p.start(items(6, piano), 120, "ring", false);
    p.stop();
    expect(first(log)).toBeCloseTo(0.25, 9);
  });
  it("on the keys, with no length, is held until the next note, as it always was", () => {
    const log = lengths();
    const p = new S.ProgressionPlayer();
    p.start(items(undefined, piano), 120, "ring", false);
    p.stop();
    expect(first(log)).toBeCloseTo(1, 9);
  });
  it("is never held past the next note, however long it is", () => {
    const log = lengths();
    const p = new S.ProgressionPlayer();
    p.start(items(96, piano), 120, "ring", false);
    p.stop();
    expect(first(log)).toBeCloseTo(1, 9);
  });
  it("on the strings is ignored: the note rings on", () => {
    const log = lengths();
    const p = new S.ProgressionPlayer();
    p.start(items(6), 120, "ring", false);
    p.stop();
    expect(first(log)).toBe(Infinity);
  });
  it("the render does the same", async () => {
    const log = lengths();
    await S.renderSong(items(6, piano), { bpm: 120, pattern: "ring", beat: null, rate: 8000 });
    expect(first(log)).toBeCloseTo(0.25, 9);
    log.length = 0;
    await S.renderSong(items(undefined, piano), { bpm: 120, pattern: "ring", beat: null, rate: 8000 });
    expect(first(log)).toBeCloseTo(1, 9);
    log.length = 0;
    await S.renderSong(items(6), { bpm: 120, pattern: "ring", beat: null, rate: 8000 });
    expect(first(log)).toBe(Infinity);
  });
  it("a synth's own way of playing gets it too: the note is that long in the section it works from", () => {
    expect(tuneSection(melody(6), 4, 0, 4).map((c) => c.beats)).toEqual([0.5, 2]);
    expect(tuneSection(melody(), 4, 0, 4).map((c) => c.beats)).toEqual([2, 2]);
    expect(tuneSection(melody(96), 4, 0, 4).map((c) => c.beats)).toEqual([2, 2]);
  });
});
