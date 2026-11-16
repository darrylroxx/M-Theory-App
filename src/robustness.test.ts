import { describe, expect, it } from "vitest";
import { arrangeProgression } from "./guitar/arrange";
import { TUNINGS, getTuning } from "./guitar/tunings";
import { generateVoicings, voicingFromFrets } from "./guitar/voicings";
import { CHORD_TYPES, chordTypeFromIntervals, getChordType } from "./theory/chords";
import { analyzeChord, borrowedChords, chordsInScale, diatonicChords, spiceChords } from "./theory/keys";
import { pc } from "./theory/notes";
import { seededRng, sparkProgression, suggestNext } from "./theory/progression";
import { SCALES, bestTonicSpelling, isHeptatonic } from "./theory/scales";

describe("robustness: every chord, every root, every tuning", () => {
  it("every chord type has playable voicings on every root (standard tuning)", () => {
    const std = getTuning("standard");
    const missing: string[] = [];
    for (const t of CHORD_TYPES) for (let r = 0; r < 12; r++) if (!generateVoicings(r, t, { tuning: std }).length) missing.push(`${r}:${t.id}`);
    expect(missing).toEqual([]);
  });
  it("every chord type has voicings in every tuning (root C)", () => {
    const missing: string[] = [];
    for (const tu of TUNINGS) for (const t of CHORD_TYPES) if (!generateVoicings(0, t, { tuning: tu }).length) missing.push(`${tu.id}:${t.id}`);
    expect(missing).toEqual([]);
  });
  it("all voicings contain only chord tones and all required tones", () => {
    const std = getTuning("standard");
    for (const id of ["maj", "m7", "13", "7alt", "m11", "dim7"]) {
      const t = getChordType(id);
      for (const v of generateVoicings(4, t, { tuning: std })) {
        expect(v.tokens.every((x) => x === null || t.intervals.includes(x))).toBe(true);
        const required = t.intervals.filter((iv) => !(t.optional ?? []).includes(iv));
        for (const r of required) expect(v.tokens).toContain(r);
        expect(v.fingers.filter((f) => f !== null).every((f) => f! >= 1 && f! <= 4)).toBe(true);
      }
    }
  });
});

describe("robustness: every scale on every tonic", () => {
  it("analyses without throwing and yields chords", () => {
    for (const s of SCALES) {
      for (let p = 0; p < 12; p++) {
        const key = { tonic: bestTonicSpelling(p, s), scaleId: s.id };
        const all = chordsInScale(key);
        expect(all.length).toBe(s.intervals.length);
        if (isHeptatonic(s)) {
          expect(diatonicChords(key, 3).length).toBeGreaterThanOrEqual(5);
          borrowedChords(key);
          spiceChords(key);
        }
        const groups = suggestNext({ root: key.tonic, typeId: "maj" }, key);
        expect(groups.length).toBeGreaterThan(0);
      }
    }
  });
  it("sparks valid, arrangeable progressions in every major mode", () => {
    const std = getTuning("standard");
    for (const id of ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian", "harmonicMinor"]) {
      for (let seed = 1; seed <= 3; seed++) {
        const key = { tonic: "E", scaleId: id };
        const prog = sparkProgression(key, { length: 6, adventure: seed / 3, mood: "any", startHome: true }, seededRng(seed));
        expect(prog.length).toBe(6);
        const v = arrangeProgression(prog, { tuning: std, capo: 0, avoidBarre: true, preferOpen: false, targetFret: null, allowInversions: false });
        expect(v.length).toBe(6);
        for (const r of prog) expect(analyzeChord(r, key).roman.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("details", () => {
  it("friendly spellings: tritone sub of IV in B major is F7, not E#7", () => {
    const tri = spiceChords({ tonic: "B", scaleId: "ionian" }).find((g) => g.group === "Tritone substitutions")!;
    const roots = tri.chords.map((c) => c.ref.root);
    expect(roots).toContain("F");
    expect(roots).not.toContain("E#");
  });
  it("diminished chords are tension, never 'soft home'", () => {
    const d = diatonicChords({ tonic: "D", scaleId: "dorian" }, 3);
    expect(d[5].role).toBe("tension");
  });
  it("names exotic stacks with a synthetic type", () => {
    const t = chordTypeFromIntervals(["1", "b3", "b5", "b7", "b9"]);
    expect(t?.symbol).toBe("m7b5(b9)");
    expect(diatonicChords({ tonic: "A", scaleId: "harmonicMinor" }, 5)[1].type.symbol).toBe("m7b5(b9)");
  });
  it("builds a voicing from a tapped shape", () => {
    const v = voicingFromFrets([null, 3, 2, 0, 1, 0], pc("C"), getChordType("maj"), getTuning("standard"));
    expect(v.tokens).toEqual([null, "1", "3", "5", "1", "3"]);
    expect(v.tags).toContain("Open chord");
  });
});
