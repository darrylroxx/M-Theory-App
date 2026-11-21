/**
 * An item can say the swing its bars are played with (`meter.swing`): a sixteenth-note playing
 * style then leans back on its off-steps exactly as it does under a drums part with that swing.
 * An item that does not say plays as it always did.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio } from "./fakectx";
import { Harp } from "./plucked";
import { TrackVoice } from "./trackvoice";
import { setMix } from "./mix";
import { DEFAULT_BEAT, emptyRows, type Beat } from "./beats";
import { itemNotes, meterOf, type PlayItem } from "./patterns";

class LiveCtx extends FakeAudio {}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("AudioContext", LiveCtx);
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
/** a drums part that is on, in sixteenths, with a swing and no hits */
const drums = (swing: number): Beat => ({ ...DEFAULT_BEAT, on: true, steps: 16, div: 4, bars: 1, swing, rows: emptyRows(16) });
const withDrums: PlayItem[] = [{ midi: CHORD, beats: 4, section: true, style: "strum16", drums: drums(0.6), meter: { bar: 4 } }];
const withSwing: PlayItem[] = [{ midi: CHORD, beats: 4, section: true, style: "strum16", meter: { bar: 4, swing: 0.6 } }];
const plain: PlayItem[] = [{ midi: CHORD, beats: 4, section: true, style: "strum16", meter: { bar: 4 } }];

const beats = (items: PlayItem[]) => itemNotes(items, "ring").map((n) => n.e.beat);

describe("the swing an item's bars are played with", () => {
  it("a sixteenth-note style's off-steps lean back as under a drums part with that swing", () => {
    expect(beats(withSwing)).toEqual(beats(withDrums));
    // the second sixteenth of the first beat: a twentieth of a beat late (0.6 / 12)
    expect(beats(withSwing).some((b) => Math.abs(b - (0.25 + 0.05)) < 1e-9)).toBe(true);
  });
  it("an item that does not say plays as it always did: straight with no drums, the drums' swing with them", () => {
    expect(beats(plain).some((b) => Math.abs(b - 0.25) < 1e-9)).toBe(true);
    expect(beats(plain)).not.toEqual(beats(withDrums));
    expect(meterOf(null, { bar: 4 })).toEqual({ bar: 4, triplet: false, swing: 0 });
    expect(meterOf(drums(0.6), { bar: 4 })).toEqual({ bar: 4, triplet: false, swing: 0.6 });
    expect(meterOf(drums(0.6))).toEqual({ bar: 4, triplet: false, swing: 0.6 });
  });
  it("the swing given wins over the drums', also when it is none", () => {
    expect(meterOf(drums(0.6), { bar: 4, swing: 0.2 }).swing).toBe(0.2);
    expect(meterOf(drums(0.6), { bar: 4, swing: 0 }).swing).toBe(0);
    expect(meterOf(null, { bar: 4, swing: 0.6 }).swing).toBe(0.6);
  });
  it("the player books the same notes at the same moments either way", () => {
    const heard = (items: PlayItem[]) => {
      const log: number[] = [];
      vi.spyOn(Harp.prototype, "buffer").mockImplementation(() => null as never);
      vi.spyOn(TrackVoice.prototype, "note").mockImplementation(function (this: TrackVoice, _midi: number, when: number) {
        log.push(Math.round(when * 1e6));
      });
      const p = new S.ProgressionPlayer();
      p.start(items, 120, "ring", false);
      p.stop();
      vi.restoreAllMocks();
      return log;
    };
    const a = heard(withDrums);
    expect(a.length).toBeGreaterThan(0);
    expect(heard(withSwing)).toEqual(a);
    expect(heard(plain)).not.toEqual(a);
  });
});
