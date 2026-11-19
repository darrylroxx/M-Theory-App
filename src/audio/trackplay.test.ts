import { describe, expect, it } from "vitest";
import { clipChords, playChord, synthSection, type SecChord, type SynthCache } from "./trackplay";
import type { TrackVoice } from "./trackvoice";
import { DEFAULT_PLAY, type PlaySettings } from "../synth/params";

/** A track's voice on the synth, playing its way: what it was asked to play. */
function synthVoice(play: PlaySettings) {
  const played: number[] = [];
  const v = { tone: { inst: "synth" }, kind: "chord", synth: { play }, setTone() {}, setSound() {}, repedal() {}, note: (_m: number, when: number) => void played.push(when) } as unknown as TrackVoice;
  return { v, played };
}

describe("a synth's way of playing, chord by chord", () => {
  // at 200 bpm a 1/32 step is under the 50 ms each chord reaches back for its notes
  for (const mode of ["arp", "pulse"] as const) {
    it(`${mode} at 1/32: the last step before a rest and at the section's end is played`, () => {
      const play = { ...DEFAULT_PLAY, mode, rate: "1/32" as const };
      const { v, played } = synthVoice(play);
      const spb = 60 / 200;
      const chords: SecChord[] = [
        { midi: [48, 52, 55], at: 0, beats: 2 },
        { midi: [null, null, null], at: 2, beats: 1 },
        { midi: [50, 53, 57], at: 3, beats: 2 },
      ];
      const cache: SynthCache = new Map();
      const section = () => ({ key: "chords@0", t0: 0, chords });
      for (const c of chords) playChord(v, { midi: c.midi, beats: c.beats }, c.at * spb, spb, "ring", c.at, null, cache, section);
      const all = synthSection(cache, "chords@0", v, 0, spb, () => chords);
      expect(all.length).toBeGreaterThan(20);
      expect(played.length).toBe(all.length);
    });
  }
});

describe("a track's chords cut to a loop", () => {
  it("a chord over the loop's start or end is cut there; one outside it goes", () => {
    const list = [
      { midi: [48], at: 0, beats: 8 },
      { midi: [50], at: 8, beats: 4 },
    ];
    expect(clipChords(list, 4, 10)).toEqual([
      { midi: [48], at: 4, beats: 4 },
      { midi: [50], at: 8, beats: 2 },
    ]);
    expect(clipChords(list, 0, 4)).toEqual([{ midi: [48], at: 0, beats: 4 }]);
    // nothing to cut: the same chords
    expect(clipChords(list, 0, 12)[0]).toBe(list[0]);
  });
});
