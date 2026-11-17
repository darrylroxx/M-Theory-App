import { describe, expect, it } from "vitest";
import { chordPcs, chordSymbolAscii } from "./chords";
import { CHORD_ROWS, chordRow, chordsInScale, type Key } from "./keys";
import { pc } from "./notes";
import { SCALES, scalePcs } from "./scales";

const TONICS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const names = (key: Key, row: string) => chordRow(key, row).map((c) => (c ? chordSymbolAscii(c.ref) : "-")).join(" ");

describe("rows of chords for the key", () => {
  it("there is a row for every kind worth having", () => {
    expect(CHORD_ROWS.map((r) => r.label)).toEqual(["Triads", "Power", "Sus2", "Sus4", "6ths", "7ths", "Add9", "9ths", "11ths", "13ths"]);
    expect(new Set(CHORD_ROWS.map((r) => r.id)).size).toBe(CHORD_ROWS.length);
  });

  it("C major, row by row", () => {
    const c = { tonic: "C", scaleId: "ionian" };
    expect(names(c, "triads")).toBe("C Dm Em F G Am Bdim");
    expect(names(c, "power")).toBe("C5 D5 E5 F5 G5 A5 -");
    // no sus2 on E or B (their second is not in the key), no sus4 on F or B
    expect(names(c, "sus2")).toBe("Csus2 Dsus2 - Fsus2 Gsus2 Asus2 -");
    expect(names(c, "sus4")).toBe("Csus4 Dsus4 Esus4 - Gsus4 Asus4 -");
    expect(names(c, "sixths")).toBe("C6 Dm6 Em(b6) F6 G6 Am(b6) -");
    expect(names(c, "sevenths")).toBe("Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7b5");
    expect(names(c, "add9")).toBe("Cadd9 Dm(add9) - Fadd9 Gadd9 Am(add9) -");
    // E and B would need a flattened ninth, which clashes: left out
    expect(names(c, "ninths")).toBe("Cmaj9 Dm9 - Fmaj9 G9 Am9 -");
    // the eleventh: natural on minor chords, raised on F (Lydian), suspended on G; none on C, where it would clash with the third
    expect(names(c, "elevenths")).toBe("- Dm11 Em7(11) Fmaj9#11 G9sus4 Am11 Bm7b5(11)");
    expect(names(c, "thirteenths")).toBe("Cmaj13 Dm13 - Fmaj13 G13 - -");
  });

  it("the relative minor has the same chords, starting from its own home note", () => {
    const a = { tonic: "A", scaleId: "aeolian" };
    expect(names(a, "triads")).toBe("Am Bdim C Dm Em F G");
    expect(names(a, "ninths")).toBe("Am9 - Cmaj9 Dm9 - Fmaj9 G9");
    expect(names(a, "sus4")).toBe("Asus4 - Csus4 Dsus4 Esus4 - Gsus4");
  });

  it("harmonic minor: the fifth chord is a dominant, and its ninth is the flattened one", () => {
    const a = { tonic: "A", scaleId: "harmonicMinor" };
    expect(names(a, "sevenths")).toBe("Am(maj7) Bm7b5 Cmaj7#5 Dm7 E7 Fmaj7 G#dim7");
    expect(names(a, "ninths").split(" ")[4]).toBe("E7b9");
    expect(names(a, "thirteenths").split(" ")[4]).toBe("E7b13");
  });

  it("in every key and scale, every chord of every row uses only notes of the key and sits on its own scale note", () => {
    let count = 0;
    for (const scale of SCALES) {
      for (const tonic of TONICS) {
        const key = { tonic, scaleId: scale.id };
        const set = new Set(scalePcs(pc(tonic), scale));
        const notes = chordsInScale(key);
        for (const row of CHORD_ROWS) {
          const cards = chordRow(key, row.id);
          expect(cards).toHaveLength(notes.length);
          cards.forEach((c, i) => {
            if (!c) return;
            count++;
            const where = `${tonic} ${scale.id} ${row.id} ${chordSymbolAscii(c.ref)}`;
            expect(pc(c.ref.root), where).toBe(pc(notes[i].root));
            expect(chordPcs(pc(c.ref.root), c.type).every((p) => set.has(p)), where).toBe(true);
            // a chord of the row's own kind (rows built by stacking thirds take whatever the scale stacks up to)
            if (!row.any && !row.stack && !c.type.synthetic) expect(row.types, where).toContain(c.type.id);
          });
        }
      }
    }
    expect(count).toBeGreaterThan(5000);
  });

  it("where the key has a chord of a kind on a note, the row shows one", () => {
    for (const tonic of TONICS) {
      const key = { tonic, scaleId: "ionian" };
      const notes = chordsInScale(key);
      for (const row of CHORD_ROWS) {
        chordRow(key, row.id).forEach((c, i) => {
          const could = notes[i].chords.some((x) => row.types.includes(x.type.id));
          if (could) expect(c, `${tonic} ${row.id} ${notes[i].root}`).not.toBeNull();
        });
      }
    }
  });
});
