import { describe, expect, it } from "vitest";
import { CHORD_TYPES, chordPcs } from "./chords";
import { chordsInScale, diatonicChords, type Key } from "./keys";
import { mod12, pc } from "./notes";
import { SCALES, bestTonicSpelling, isHeptatonic, scaleNotes, scalePcs } from "./scales";

const keys: Key[] = SCALES.flatMap((s) => Array.from({ length: 12 }, (_, p) => ({ tonic: bestTonicSpelling(p, s), scaleId: s.id })));
const scaleOf = (k: Key) => SCALES.find((s) => s.id === k.scaleId)!;

describe("what a key offers", () => {
  it("every chord type has a root, unique tones, and a unique id and symbol", () => {
    expect(CHORD_TYPES.length).toBeGreaterThanOrEqual(56);
    expect(new Set(CHORD_TYPES.map((t) => t.id)).size).toBe(CHORD_TYPES.length);
    expect(new Set(CHORD_TYPES.map((t) => t.symbol)).size).toBe(CHORD_TYPES.length);
    const sets = new Set<string>();
    for (const t of CHORD_TYPES) {
      expect(t.intervals[0], t.id).toBe("1");
      const pcs = chordPcs(0, t);
      expect(new Set(pcs).size, t.id).toBe(pcs.length);
      // no two types are the same set of notes over the same root
      const sig = [...pcs].sort((a, b) => a - b).join(",");
      expect(sets.has(sig), `${t.id} duplicates another type`).toBe(false);
      sets.add(sig);
    }
  });

  it("in every key of every scale: every chord offered uses only notes of the scale, and nothing that fits is left out", () => {
    for (const key of keys) {
      const scale = scaleOf(key);
      const set = new Set(scalePcs(pc(key.tonic), scale));
      const notes = scaleNotes(key.tonic, scale);
      const offered = chordsInScale(key);
      expect(offered.length).toBe(notes.length);
      offered.forEach((deg, i) => {
        expect(deg.root).toBe(notes[i]);
        const ids = new Set(deg.chords.map((c) => c.type.id));
        for (const t of CHORD_TYPES) {
          const fits = chordPcs(pc(deg.root), t).every((p) => set.has(p));
          expect(ids.has(t.id), `${key.tonic} ${scale.name}: ${deg.root}${t.symbol}`).toBe(fits);
        }
      });
    }
  });

  it("in the seven-note scales every chord tone is spelled with the scale's own letter (F♯ in G major, never G♭)", () => {
    for (const key of keys) {
      const scale = scaleOf(key);
      if (!isHeptatonic(scale)) continue;
      const notes = scaleNotes(key.tonic, scale);
      // only scales whose seven notes use seven different letters can be spelled this way
      if (new Set(notes.map((n) => n[0])).size !== 7) continue;
      const byPc = new Map(notes.map((n) => [pc(n), n]));
      for (const deg of chordsInScale(key))
        for (const c of deg.chords) for (const n of c.notes) expect(n, `${key.tonic} ${scale.name}: ${c.ref.root}${c.type.symbol}`).toBe(byPc.get(pc(n)));
    }
  });

  it("the major scale's chords are the ones every theory book lists", () => {
    const names = (size: 3 | 4 | 5) => diatonicChords({ tonic: "C", scaleId: "ionian" }, size).map((c) => c.ref.root + c.type.symbol);
    expect(names(3)).toEqual(["C", "Dm", "Em", "F", "G", "Am", "Bdim"]);
    expect(names(4)).toEqual(["Cmaj7", "Dm7", "Em7", "Fmaj7", "G7", "Am7", "Bm7b5"]);
    expect(names(5)).toEqual(["Cmaj9", "Dm9", "Em7(b9)", "Fmaj9", "G9", "Am9", "Bm7b5(b9)"]);
    expect(diatonicChords({ tonic: "C", scaleId: "ionian" }).map((c) => c.roman)).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
    // natural, harmonic and melodic minor
    const triads = (scaleId: string) => diatonicChords({ tonic: "A", scaleId }).map((c) => c.ref.root + c.type.symbol);
    expect(triads("aeolian")).toEqual(["Am", "Bdim", "C", "Dm", "Em", "F", "G"]);
    expect(triads("harmonicMinor")).toEqual(["Am", "Bdim", "Caug", "Dm", "E", "F", "G#dim"]);
    expect(triads("melodicMinor")).toEqual(["Am", "Bm", "Caug", "D", "E", "F#dim", "G#dim"]);
    const sevenths = (scaleId: string) => diatonicChords({ tonic: "A", scaleId }, 4).map((c) => c.ref.root + c.type.symbol);
    expect(sevenths("harmonicMinor")).toEqual(["Am(maj7)", "Bm7b5", "Cmaj7#5", "Dm7", "E7", "Fmaj7", "G#dim7"]);
  });

  it("in all seven modes, every degree has a named triad, seventh and ninth chord", () => {
    for (const scaleId of ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"])
      for (const size of [3, 4, 5] as const) {
        const chords = diatonicChords({ tonic: "D", scaleId }, size);
        expect(chords.length, `${scaleId} ${size}`).toBe(7);
        for (const c of chords) expect(c.type.synthetic, `${scaleId}: ${c.ref.root}${c.type.symbol}`).toBeFalsy();
      }
  });

  it("each degree of a major key offers its sus, sixth, added-note and extended chords too", () => {
    const deg = chordsInScale({ tonic: "G", scaleId: "ionian" });
    const on = (i: number) => deg[i].chords.map((c) => c.type.id);
    for (const id of ["maj", "5", "sus2", "sus4", "6", "69", "add9", "maj7", "maj9", "maj13", "maj7sus2"]) expect(on(0), `I ${id}`).toContain(id);
    for (const id of ["min", "sus2", "sus4", "m6", "m7", "m9", "m11", "m13", "madd9", "m69"]) expect(on(1), `ii ${id}`).toContain(id);
    for (const id of ["min", "m7", "sus4", "susb9", "m7b9", "mb6"]) expect(on(2), `iii ${id}`).toContain(id);
    for (const id of ["maj", "maj7", "maj7#11", "maj9#11", "add#11", "6", "sus2"]) expect(on(3), `IV ${id}`).toContain(id);
    for (const id of ["maj", "7", "9", "11", "13", "7sus4", "9sus4", "sus2", "sus4", "6"]) expect(on(4), `V ${id}`).toContain(id);
    for (const id of ["min", "m7", "m9", "m11", "mb6", "sus2", "sus4", "madd9"]) expect(on(5), `vi ${id}`).toContain(id);
    for (const id of ["dim", "m7b5", "m7b5b9", "m11b5"]) expect(on(6), `vii ${id}`).toContain(id);
    // and nothing foreign: no major chord on the 2nd degree, no dominant 7th on the 1st
    expect(on(1)).not.toContain("maj");
    expect(on(0)).not.toContain("7");
    expect(mod12(pc(deg[4].root) - pc("G"))).toBe(7);
  });
});
