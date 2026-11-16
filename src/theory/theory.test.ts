import { describe, expect, it } from "vitest";
import { chordNotes, getChordType, identifyChord } from "./chords";
import { intervalNote, parseInterval } from "./intervals";
import { borrowedChords, chordsInScale, diatonicChords, analyzeChord, spiceChords, spellInKey, keysContainingChord } from "./keys";
import { defaultName, displayNote, pc } from "./notes";
import { bestTonicSpelling, getScale, keySignature, relativeModes, scaleNotes } from "./scales";

describe("notes & intervals", () => {
  it("parses and spells", () => {
    expect(pc("B")).toBe(11);
    expect(pc("Cb")).toBe(11);
    expect(pc("E#")).toBe(5);
    expect(displayNote("Bb")).toBe("B♭");
    expect(displayNote("F#")).toBe("F♯");
    expect(displayNote("Ebb")).toBe("E♭♭");
    expect(parseInterval("b9").semitones).toBe(13);
    expect(parseInterval("#11").semitones).toBe(18);
    expect(parseInterval("bb7").semitones).toBe(9);
  });
  it("spells intervals by letter", () => {
    expect(intervalNote("B", "3")).toBe("D#");
    expect(intervalNote("Bb", "3")).toBe("D");
    expect(intervalNote("C", "bb7")).toBe("Bbb");
    expect(intervalNote("G#", "7")).toBe("F##");
  });
});

describe("scales", () => {
  it("spells B major correctly", () => {
    expect(scaleNotes("B", getScale("ionian"))).toEqual(["B", "C#", "D#", "E", "F#", "G#", "A#"]);
    expect(keySignature("B", getScale("ionian")).sharps.length).toBe(5);
  });
  it("chooses sensible tonic spellings", () => {
    expect(bestTonicSpelling(1, getScale("ionian"))).toBe("Db");
    expect(bestTonicSpelling(1, getScale("aeolian"))).toBe("C#");
    expect(bestTonicSpelling(10, getScale("ionian"))).toBe("Bb");
    expect(bestTonicSpelling(6, getScale("ionian"))).toBe("F#");
    expect(bestTonicSpelling(8, getScale("aeolian"))).toBe("G#");
    expect(bestTonicSpelling(5, getScale("ionian"))).toBe("F");
  });
  it("finds relative modes", () => {
    const rel = relativeModes("B", getScale("ionian")).map((r) => `${r.tonic} ${r.scale.id}`);
    expect(rel).toEqual(["C# dorian", "D# phrygian", "E lydian", "F# mixolydian", "G# aeolian", "A# locrian"]);
  });
});

describe("chords", () => {
  it("builds chords", () => {
    expect(chordNotes("B", getChordType("maj7"))).toEqual(["B", "D#", "F#", "A#"]);
    expect(chordNotes("C", getChordType("m7b5"))).toEqual(["C", "Eb", "Gb", "Bb"]);
    expect(chordNotes("C", getChordType("dim7"))).toEqual(["C", "Eb", "Gb", "Bbb"]);
  });
  it("identifies chords", () => {
    const names = identifyChord([0, 4, 7, 9], 0, (p) => defaultName(p)).map((m) => m.ref.root + m.type.symbol + (m.ref.bass ? "/" + m.ref.bass : ""));
    expect(names[0]).toBe("C6");
    expect(names).toContain("Am7/C");
    const g7 = identifyChord([7, 11, 2, 5], 7, (p) => defaultName(p));
    expect(g7[0].ref.root + g7[0].type.symbol).toBe("G7");
  });
});

describe("keys", () => {
  const sym = (c: { ref: { root: string }; type: { symbol: string } }) => c.ref.root + c.type.symbol;
  it("B major diatonic triads & roles", () => {
    const d = diatonicChords({ tonic: "B", scaleId: "ionian" }, 3);
    expect(d.map(sym)).toEqual(["B", "C#m", "D#m", "E", "F#", "G#m", "A#dim"]);
    expect(d.map((c) => c.roman)).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
    expect(d.map((c) => c.role)).toEqual(["home", "motion", "stable", "motion", "tension", "stable", "tension"]);
  });
  it("sevenths in major and harmonic minor", () => {
    expect(diatonicChords({ tonic: "C", scaleId: "ionian" }, 4).map((c) => c.roman)).toEqual(["Imaj7", "ii7", "iii7", "IVmaj7", "V7", "vi7", "viiø7"]);
    expect(diatonicChords({ tonic: "A", scaleId: "harmonicMinor" }, 4).map((c) => c.roman)).toEqual(["i(maj7)", "iiø7", "bIII+maj7", "iv7", "V7", "bVImaj7", "vii°7"]);
  });
  it("modes: dorian IV, phrygian bII, lydian II, mixolydian bVII", () => {
    expect(diatonicChords({ tonic: "D", scaleId: "dorian" }, 3).map((c) => c.roman)).toEqual(["i", "ii", "bIII", "IV", "v", "vi°", "bVII"]);
    expect(diatonicChords({ tonic: "E", scaleId: "phrygian" }, 3)[1].roman).toBe("bII");
    expect(diatonicChords({ tonic: "F", scaleId: "lydian" }, 3)[1].roman).toBe("II");
    expect(diatonicChords({ tonic: "G", scaleId: "mixolydian" }, 3)[6].roman).toBe("bVII");
    const dor = diatonicChords({ tonic: "D", scaleId: "dorian" }, 3);
    expect(dor[3].signature).toBe(true);
  });
  it("all chords in key include colour chords", () => {
    const all = chordsInScale({ tonic: "B", scaleId: "ionian" });
    const I = all[0].chords.map(sym);
    expect(I).toContain("Bmaj7");
    expect(I).toContain("Badd9");
    expect(I).toContain("Bsus2");
    expect(I).not.toContain("B7");
    const V = all[4].chords.map(sym);
    expect(V).toContain("F#7");
    expect(V).toContain("F#13");
  });
  it("borrowed chords in B major come from B minor", () => {
    const b = borrowedChords({ tonic: "B", scaleId: "ionian" });
    const romans = b.map((c) => c.roman);
    expect(romans).toContain("iv");
    expect(romans).toContain("bVI");
    expect(romans).toContain("bVII");
    expect(romans).toContain("bIII");
    const bVI = b.find((c) => c.roman === "bVI")!;
    expect(bVI.ref.root).toBe("G");
  });
  it("spice chords", () => {
    const g = spiceChords({ tonic: "C", scaleId: "ionian" });
    const sec = g.find((x) => x.group === "Secondary dominants")!.chords.map((c) => `${c.roman}=${c.ref.root}${c.type.symbol}`);
    expect(sec).toContain("V7/ii=A7");
    expect(sec).toContain("V7/vi=E7");
    expect(sec).not.toContain("V7=G7");
  });
  it("spells outside notes sensibly", () => {
    expect(spellInKey(pc("G"), { tonic: "B", scaleId: "ionian" })).toBe("G");
    expect(spellInKey(pc("D"), { tonic: "B", scaleId: "ionian" })).toBe("D");
    expect(spellInKey(10, { tonic: "C", scaleId: "ionian" })).toBe("Bb");
  });
  it("analyses chords against a key", () => {
    const key = { tonic: "C", scaleId: "ionian" };
    expect(analyzeChord({ root: "F", typeId: "min" }, key).status).toBe("borrowed");
    expect(analyzeChord({ root: "A", typeId: "min" }, key).roman).toBe("vi");
    expect(analyzeChord({ root: "C", typeId: "maj", bass: "E" }, key).roman).toBe("I/3");
  });
  it("finds keys containing a chord", () => {
    const k = keysContainingChord({ root: "C", typeId: "maj7" }).map((x) => `${x.key.tonic} ${x.key.scaleId} ${x.roman}`);
    expect(k).toContain("C ionian Imaj7");
    expect(k).toContain("G ionian IVmaj7");
    expect(k).toContain("E aeolian bVImaj7");
  });
});
