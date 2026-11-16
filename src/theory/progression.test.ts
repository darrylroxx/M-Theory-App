import { describe, expect, it } from "vitest";
import { getChordType } from "./chords";
import { diatonicChords } from "./keys";
import { pc } from "./notes";
import { candidatePool, colorize, seededRng, sparkProgression, substitutesFor, suggestNext, voiceLeadingDistance } from "./progression";
import { arrangeProgression, capoSuggestions } from "../guitar/arrange";
import { getTuning } from "../guitar/tunings";
import { voicingText } from "../guitar/voicings";

const B = { tonic: "B", scaleId: "ionian" };
const name = (r: { root: string; typeId: string }) => r.root + getChordType(r.typeId).symbol;

describe("progression engine", () => {
  it("pool has diatonic, colour, borrowed and spice chords", () => {
    const pools = new Set(candidatePool(B).map((c) => c.pool));
    expect([...pools].sort()).toEqual(["borrowed", "color", "diatonic", "spice"]);
  });
  it("suggests a V→I resolution and explains it", () => {
    const groups = suggestNext({ root: "F#", typeId: "7" }, B);
    const natural = groups.find((g) => g.id === "natural")!;
    expect(name(natural.items[0].chord.ref)).toBe("B");
    expect(natural.items[0].why).toMatch(/Resolves/);
  });
  it("offers suggestions across all four groups", () => {
    const groups = suggestNext({ root: "B", typeId: "maj" }, B);
    expect(groups.map((g) => g.id).sort()).toEqual(["bold", "color", "natural", "smooth"]);
    for (const g of groups) for (const s of g.items) expect(s.why.length).toBeGreaterThan(10);
  });
  it("sparks progressions of the requested length, deterministic with a seed", () => {
    const a = sparkProgression(B, { length: 6, adventure: 0.5, mood: "dreamy", startHome: true }, seededRng(42));
    const b = sparkProgression(B, { length: 6, adventure: 0.5, mood: "dreamy", startHome: true }, seededRng(42));
    expect(a.length).toBe(6);
    expect(a.map(name)).toEqual(b.map(name));
    expect(pc(a[0].root)).toBe(pc("B"));
  });
  it("safe settings stay mostly diatonic, wild settings leave the key", () => {
    const tonicSet = new Set(diatonicChords(B, 3).map((c) => pc(c.ref.root)));
    let safeOutside = 0;
    let wildOutside = 0;
    for (let s = 1; s <= 30; s++) {
      for (const r of sparkProgression(B, { length: 4, adventure: 0, mood: "any", startHome: true }, seededRng(s))) if (!tonicSet.has(pc(r.root))) safeOutside++;
      for (const r of sparkProgression(B, { length: 4, adventure: 1, mood: "any", startHome: true }, seededRng(s))) if (!tonicSet.has(pc(r.root))) wildOutside++;
    }
    expect(wildOutside).toBeGreaterThan(safeOutside);
  });
  it("substitutes and colours", () => {
    const subs = substitutesFor({ root: "C", typeId: "maj" }, { tonic: "C", scaleId: "ionian" }).map((s) => name(s.chord.ref));
    expect(subs).toContain("Am");
    expect(subs).toContain("Em");
    const tri = substitutesFor({ root: "G", typeId: "7" }, { tonic: "C", scaleId: "ionian" }).map((s) => name(s.chord.ref));
    expect(tri).toContain("Db7");
    const c = colorize({ root: "C", typeId: "maj" }, { tonic: "C", scaleId: "ionian" }, seededRng(3));
    expect(["maj7", "add9", "6", "maj9", "69", "sus2"]).toContain(c.typeId);
  });
  it("voice leading distance", () => {
    expect(voiceLeadingDistance([0, 4, 7], [0, 4, 7])).toBe(0);
    expect(voiceLeadingDistance([0, 4, 7], [9, 0, 4])).toBeLessThan(voiceLeadingDistance([0, 4, 7], [6, 10, 1]));
  });
});

describe("arranging on guitar", () => {
  const std = getTuning("standard");
  it("arranges a progression avoiding barre chords", () => {
    const prog = [
      { root: "B", typeId: "maj" },
      { root: "G#", typeId: "min" },
      { root: "E", typeId: "maj" },
      { root: "F#", typeId: "maj" },
    ];
    const v = arrangeProgression(prog, { tuning: std, capo: 0, avoidBarre: true, preferOpen: false, targetFret: null, allowInversions: false });
    expect(v.length).toBe(4);
    expect(v.every((x) => x.barreKind !== "full")).toBe(true);
    expect(v.every((x) => x.bassToken === "1")).toBe(true);
  });
  it("suggests a capo for B major that unlocks open shapes", () => {
    const chords = diatonicChords(B, 3).map((c) => ({ rootPc: pc(c.ref.root), type: c.type }));
    const s = capoSuggestions(chords, std);
    expect(s[0].capo).not.toBe(0);
    expect(s[0].easy).toBeGreaterThanOrEqual(4);
    const noCapo = s.find((x) => x.capo === 0)!;
    expect(s[0].easy).toBeGreaterThan(noCapo.easy);
    console.log(s.slice(0, 4).map((x) => `capo ${x.capo}: ${x.easy}/7 ${x.shapes.map((v) => (v ? voicingText(v) : "-")).join(" ")}`).join("\n"));
  });
});

describe("arranging in a neck area", () => {
  const std = getTuning("standard");
  const prog = [{ root: "B", typeId: "maj" }, { root: "G#", typeId: "min" }, { root: "E", typeId: "maj" }, { root: "F#", typeId: "maj" }];
  const base = { tuning: std, capo: 0, avoidBarre: false, preferOpen: false, targetFret: null, allowInversions: false };
  it("gathers every chord in the chosen area", async () => {
    const { fretSpan } = await import("../guitar/arrange");
    const { positionOf } = await import("../guitar/shapeMap");
    for (const zone of [1, 2, 3, 4]) {
      const v = arrangeProgression(prog, { ...base, zone });
      const inZone = v.filter((x) => Math.abs(positionOf(x) - zone) <= 1).length;
      expect(inZone).toBe(4);
      const span = fretSpan(v)!;
      expect(span[1] - span[0]).toBeLessThanOrEqual(7);
    }
    const low = fretSpan(arrangeProgression(prog, { ...base, zone: 1 }))!;
    const high = fretSpan(arrangeProgression(prog, { ...base, zone: 4 }))!;
    expect(high[0]).toBeGreaterThan(low[0] + 4);
  });
  it("respects string count and pinned shapes", async () => {
    const { fitAlternatives } = await import("../guitar/arrange");
    const three = arrangeProgression(prog, { ...base, zone: 3, strings: 3 });
    expect(three.every((v) => v.frets.filter((f) => f !== null).length === 3)).toBe(true);
    const free = arrangeProgression(prog, { ...base, zone: 2 });
    const pin = arrangeProgression(prog, { ...base, zone: 4 })[1];
    const withPin = arrangeProgression(prog, { ...base, zone: 2, pinned: [undefined, pin, undefined, undefined] });
    expect(withPin[1].id).toBe(pin.id);
    expect(withPin[0].id).toBeTruthy();
    // alternatives for a spot: the arranged shape should be among the best fits between its neighbours
    const alts = fitAlternatives(prog[1], { ...base, zone: 2 }, free[0], free[2]);
    expect(alts.slice(0, 5).map((v) => v.id)).toContain(free[1].id);
    expect(alts.length).toBeGreaterThan(50);
  });
});
