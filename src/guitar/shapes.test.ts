import { describe, expect, it } from "vitest";
import { getChordType } from "../theory/chords";
import { arrangeProgression, easyVoicing, fitAlternatives, playableFor, voicingsFor } from "./arrange";
import { positionOf } from "./shapeMap";
import { OPEN_CHORDS, atNut, kindOf, openChordIds, playable, shapeBook } from "./shapes";
import { getTuning } from "./tunings";
import { voicingText, type Voicing } from "./voicings";

const std = getTuning("standard");
const NOTE = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const book = (rootPc: number, typeId: string, capo = 0) =>
  shapeBook(voicingsFor({ root: NOTE[rootPc], typeId }, std, capo), getChordType(typeId), openChordIds(rootPc, typeId, std.notes, capo));
const texts = (vs: Voicing[]) => vs.map(voicingText);
const everything = (b: ReturnType<typeof book>) => [...b.common, ...b.small.flatMap((g) => g.shapes), ...b.inversions.flatMap((g) => g.shapes), ...b.all.flatMap((g) => g.shapes)];

describe("textbook open chords", () => {
  it("every one is a real voicing of its chord, comes first, and is the default shape", () => {
    for (const [typeId, roots] of Object.entries(OPEN_CHORDS))
      for (const [root, shapes] of Object.entries(roots)) {
        const pcRoot = Number(root);
        const ref = { root: NOTE[pcRoot], typeId };
        const all = voicingsFor(ref, std, 0);
        const found = shapes.map((t) => all.find((v) => voicingText(v) === t));
        found.forEach((v, i) => expect(v, `${NOTE[pcRoot]}${typeId} ${shapes[i]}`).toBeDefined());
        expect(found[0]!.bassToken, `${NOTE[pcRoot]}${typeId}`).toBe("1");
        expect(texts(book(pcRoot, typeId).common), `${NOTE[pcRoot]}${typeId}`).toContain(shapes[0]);
        expect(voicingText(easyVoicing(ref, std, 0)!), `${NOTE[pcRoot]}${typeId}`).toBe(shapes[0]);
      }
  });
  it("move with a capo and are skipped in other tunings", () => {
    expect(openChordIds(2, "maj", std.notes, 2)).toEqual(["x,3,2,0,1,0"]); // capo 2: the C shape sounds as D
    expect(voicingText(easyVoicing({ root: "D", typeId: "maj" }, std, 2)!)).toBe("x32010");
    expect(openChordIds(0, "maj", getTuning("dropD").notes)).toEqual([]);
  });
});

describe("shape book", () => {
  it("C major starts with the shapes everybody knows", () => {
    expect(texts(book(0, "maj").common)).toEqual(["x32010", "x35553", "x-x-10-9-8-8", "8-10-10-9-8-8"]);
  });
  it("G, F and B major", () => {
    expect(texts(book(7, "maj").common).slice(0, 2)).toEqual(["320003", "320033"]);
    expect(texts(book(7, "maj").common)).toContain("355433");
    expect(texts(book(5, "maj").common)).toEqual(["xx3211", "133211", "x-8-10-10-10-8"]); // no odd "open F"
    expect(texts(book(11, "maj").common)).toEqual(["x24442", "xx9877", "799877"]);
  });
  it("seventh chords get the jazz grips", () => {
    const am7 = texts(book(9, "m7").common);
    expect(am7).toEqual(expect.arrayContaining(["x02010", "575555", "5x555x"]));
    expect(texts(book(6, "7").common)).toEqual(expect.arrayContaining(["242322", "2x232x", "x9897x"]));
    expect(texts(book(0, "maj7").common)).toEqual(expect.arrayContaining(["x32000", "x35453", "8x998x"]));
    expect(book(9, "m7").small[0].title).toBe("Shells");
    expect(texts(book(9, "m7").small[0].shapes)).toContain("5x55xx");
  });
  it("power chords: root on the 6th and 5th string", () => {
    expect(texts(book(4, "5").common)).toEqual(["022xxx", "x799xx"]);
    expect(texts(book(7, "5").common)).toEqual(["355xxx", "x-10-12-12-x-x"]);
  });
  it("leaves octave repeats at the 12th fret out of the first tab", () => {
    expect(texts(book(4, "min").common)).toEqual(["022000", "x79987"]);
    expect(texts(book(9, "maj").common)).toEqual(["x02220", "xx7655", "577655"]);
    expect(voicingText(easyVoicing({ root: "B", typeId: "5" }, std, 0)!)).toBe("x244xx");
    expect(voicingText(easyVoicing({ root: "E", typeId: "5" }, std, 0)!)).toBe("022xxx");
  });
  it("small shapes are grouped by string set and run up the neck", () => {
    const small = book(0, "maj").small;
    expect(small.map((g) => g.title)).toEqual(["Strings 1–3", "Strings 2–4", "Strings 3–5", "Strings 1–4", "Strings 2–5"]);
    expect(texts(small[0].shapes)).toEqual(["xxx553", "xxx988", "x-x-x-12-13-12"]); // the three inversions
    for (const g of small) {
      expect(g.shapes.map((v) => v.minFret)).toEqual([...g.shapes.map((v) => v.minFret)].sort((a, b) => a - b));
      for (const v of g.shapes) expect(v.openStrings).toBe(0);
    }
  });
  it("inversions are grouped by bass note", () => {
    const inv = shapeBook(voicingsFor({ root: "C", typeId: "maj" }, std, 0), getChordType("maj"), [], (t) => `${t} in the bass`).inversions;
    expect(inv.map((g) => g.title)).toEqual(["3 in the bass", "5 in the bass"]);
    expect(texts(inv[0].shapes)).toContain("032010");
    expect(texts(inv[1].shapes)).toContain("332010");
    for (const v of inv[0].shapes) expect(v.bassToken).toBe("3");
  });
  it("everything is grouped by neck position", () => {
    for (const g of book(0, "maj").all) for (const v of g.shapes) expect(g.title).toBe(positionOf(v) === 0 ? "Open" : `Frets ${["", "1–3", "4–6", "7–9", "10–12", "13+"][positionOf(v)]}`);
  });

  it("never offers an awkward grip, for any common chord in any key", () => {
    const types = ["maj", "min", "7", "maj7", "m7", "sus2", "sus4", "add9", "6", "m6", "dim", "aug", "m7b5", "dim7", "9", "m9", "maj9", "5", "7sus4", "madd9"];
    let total = 0;
    for (let root = 0; root < 12; root++)
      for (const typeId of types) {
        const b = book(root, typeId);
        const name = `${NOTE[root]}${typeId}`;
        expect(b.common.length, name).toBeGreaterThanOrEqual(2);
        expect(b.common.length, name).toBeLessThanOrEqual(7);
        for (const v of everything(b)) {
          total++;
          const where = `${name} ${voicingText(v)}`;
          const strings = v.frets.map((f, s) => (f === null ? -1 : s)).filter((s) => s >= 0);
          const inner = strings[strings.length - 1] - strings[0] + 1 - strings.length;
          // a muted string in the middle only right above the bass note
          expect(inner, where).toBeLessThanOrEqual(1);
          if (inner === 1) expect([strings[0], v.frets[1]], where).toEqual([0, null]);
          // open strings only with shapes at the nut
          if (v.openStrings) expect(v.maxFret, where).toBeLessThanOrEqual(4);
          // no stretch beyond four frets, never more than four fingers
          expect(v.maxFret - v.minFret, where).toBeLessThanOrEqual(3);
          expect(new Set(v.fingers.filter((f) => f !== null)).size, where).toBeLessThanOrEqual(4);
        }
      }
    expect(total).toBeGreaterThan(5000);
  });

  it("filters most of what the generator finds", () => {
    const all = voicingsFor({ root: "C", typeId: "maj" }, std, 0);
    const ok = all.filter(playable);
    expect(all.length).toBeGreaterThan(400);
    expect(ok.length).toBeLessThan(100);
    const t = texts(ok);
    for (const good of ["x32010", "x35553", "8-10-10-9-8-8", "xxx553", "x3555x", "332010", "032010"]) expect(t, good).toContain(good);
    for (const bad of ["x35050", "x3x010", "87x080", "8-10-10-0-8-0", "x-15-14-0-13-0"]) expect(t, bad).not.toContain(bad);
    expect(texts(voicingsFor({ root: "D", typeId: "sus4" }, std, 0).filter(playable))).toContain("x5778x"); // the A-shape sus4
  });

  it("names the families", () => {
    const C = getChordType("maj");
    const by = (t: string) => voicingsFor({ root: "C", typeId: "maj" }, std, 0).find((v) => voicingText(v) === t)!;
    expect(kindOf(by("x32010"), C)).toBe("open");
    expect(atNut(by("x32010"))).toBe(true);
    expect(kindOf(by("8-10-10-9-8-8"), C)).toBe("barre6");
    expect(kindOf(by("x35553"), C)).toBe("barre5");
    expect(kindOf(by("xxx553"), C)).toBe("triad");
    expect(kindOf(by("x-x-10-9-8-8"), C)).toBe("four");
  });
});

describe("arranging uses playable shapes only", () => {
  const refs = [{ root: "B", typeId: "maj" }, { root: "G#", typeId: "min" }, { root: "E", typeId: "maj" }, { root: "F#", typeId: "maj" }];
  it("in every area of the neck", () => {
    for (const zone of [0, 1, 2, 3, 4]) {
      const vs = arrangeProgression(refs, { tuning: std, capo: 0, avoidBarre: false, preferOpen: zone === 0, targetFret: null, allowInversions: true, zone });
      vs.forEach((v, i) => expect(playableFor(refs[i], std, 0), voicingText(v)).toContain(v));
    }
  });
  it("and when sifting one chord", () => {
    const alts = fitAlternatives(refs[0], { tuning: std, capo: 0, avoidBarre: true, preferOpen: false, targetFret: null, allowInversions: false });
    expect(alts.length).toBeGreaterThan(10);
    expect(alts.every(playable)).toBe(true);
  });
});
