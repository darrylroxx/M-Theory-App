import { describe, expect, it } from "vitest";
import type { ChordRef } from "../theory/chords";
import { getChordType } from "../theory/chords";
import { mod12, pc } from "../theory/notes";
import { chordShape, easyVoicing, pinnedShape, voicingsFor } from "./arrange";
import { getTuning } from "./tunings";
import { makesChord, voicingFromFrets, type Voicing } from "./voicings";

const std = getTuning("standard");
const dropD = getTuning("dropD");
const C: ChordRef = { root: "C", typeId: "maj" };
const G: ChordRef = { root: "G", typeId: "maj" };
const pcs = (v: Voicing | undefined) => [...new Set((v?.midi ?? []).filter((m): m is number => m !== null).map(mod12))].sort((a, b) => a - b);

describe("a shape chosen by hand for one spot (kept as frets)", () => {
  it("plays the shape chosen while the tuning and capo are the ones it was chosen with", () => {
    expect(chordShape(C, std, 0, true, "x,3,2,0,1,0")?.id).toBe("x,3,2,0,1,0");
    expect(chordShape(G, std, 0, true, "3,2,0,0,0,3")?.id).toBe("3,2,0,0,0,3");
  });

  it("with a capo on, the chord still sounds the chord named: the old frets would play another one", () => {
    // x,3,2,0,1,0 behind capo 2 is D F# A D F#: the spot says C
    const c = chordShape(C, std, 2, true, "x,3,2,0,1,0");
    expect(pcs(c)).toEqual([0, 4, 7]);
    expect(c?.id).not.toBe("x,3,2,0,1,0");
    // it is the shape a chord with no shape of its own gets, so the progression stays in one key
    expect(c?.id).toBe(easyVoicing(C, std, 2, true)?.id);
    // 3,2,0,0,0,3 behind capo 2 is A C# E A C# A: the spot says G
    const g = chordShape(G, std, 2, true, "3,2,0,0,0,3");
    expect(pcs(g)).toEqual([2, 7, 11]);
  });

  it("in another tuning too: Drop D puts no F under a G", () => {
    const g = chordShape(G, dropD, 0, true, "3,2,0,0,0,3");
    expect(pcs(g)).toEqual([2, 7, 11]);
    expect(g?.midi.find((m) => m !== null)).not.toBe(41);
    // a shape that does not use the retuned string still makes the chord, and stays
    expect(chordShape(C, dropD, 0, true, "x,3,2,0,1,0")?.id).toBe("x,3,2,0,1,0");
  });

  it("back on the capo it was chosen with, the shape is there again", () => {
    expect(pinnedShape(C, "x,3,2,0,1,0", std, 2)).toBeUndefined();
    expect(pinnedShape(C, "x,3,2,0,1,0", std, 0)?.id).toBe("x,3,2,0,1,0");
  });

  it("a shape that makes the chord stays even when it is not among the shapes on offer (a long reach)", () => {
    // C E G E C over six frets: no hand on offer reaches it, but it is a C
    const id = "x,3,2,0,5,8";
    const v = pinnedShape(C, id, std, 0);
    expect(v?.id).toBe(id);
    expect(pcs(v)).toEqual([0, 4, 7]);
  });

  it("with nothing usable pinned: the chord's own chosen shape (for this capo), else the easiest", () => {
    expect(chordShape(C, std, 0, true, "x,x,x")?.id).toBe(easyVoicing(C, std, 0, true)?.id);
    expect(chordShape(C, std, 0, true, "x,3,2,0,1,0,9")?.id).toBe(easyVoicing(C, std, 0, true)?.id);
    const chosen = "8,10,10,9,8,8";
    expect(chordShape(C, std, 0, true, undefined, chosen)?.id).toBe(chosen);
    expect(chordShape(C, std, 0, true, "x,3,2,0,1,0", chosen)?.id).toBe("x,3,2,0,1,0");
    // the pin no longer makes a C behind capo 2; the chord's shape chosen for capo 2 is used
    expect(chordShape(C, std, 2, true, "x,3,2,0,1,0", "x,1,3,3,3,1")?.id).toBe("x,1,3,3,3,1");
  });
});

describe("makesChord", () => {
  const maj = getChordType("maj");
  it("asks for the notes the chord needs, and no others", () => {
    expect(makesChord(voicingFromFrets([null, 3, 2, 0, 1, 0], 0, maj, std), 0, maj)).toBe(true);
    expect(makesChord(voicingFromFrets([null, 3, 2, 0, 1, 0], 0, maj, std, 2), 0, maj)).toBe(false);
    // no third: not a major chord
    expect(makesChord(voicingFromFrets([null, 3, 5, 5, null, null], 0, maj, std), 0, maj)).toBe(false);
  });
  it("a slash chord's bass is at the bottom", () => {
    // C/E: E in the bass
    expect(makesChord(voicingFromFrets([0, 3, 2, 0, 1, 0], 0, maj, std), 0, maj, 4)).toBe(true);
    expect(makesChord(voicingFromFrets([null, 3, 2, 0, 1, 0], 0, maj, std), 0, maj, 4)).toBe(false);
  });
  it("every shape on offer passes it", () => {
    for (const ref of [C, G, { root: "A", typeId: "min" }, { root: "D", typeId: "7" }, { root: "C", typeId: "maj", bass: "E" }] as ChordRef[])
      for (const capo of [0, 3])
        for (const v of voicingsFor(ref, std, capo)) expect(makesChord(v, pc(ref.root), getChordType(ref.typeId), ref.bass ? pc(ref.bass) : undefined), `${ref.root}${ref.typeId} ${v.id}`).toBe(true);
  });
});
