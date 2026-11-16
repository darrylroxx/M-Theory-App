import { describe, expect, it } from "vitest";
import { getChordType } from "../theory/chords";
import { getTuning } from "./tunings";
import { assignFingers, generateVoicings, voicingText } from "./voicings";

const std = getTuning("standard");
const shapes = (root: number, type: string, opts = {}) =>
  generateVoicings(root, getChordType(type), { tuning: std, ...opts }).map(voicingText);

describe("voicing generator", () => {
  it("finds the classic open chords", () => {
    expect(shapes(0, "maj")).toContain("x32010");
    expect(shapes(7, "maj")).toContain("320003");
    expect(shapes(9, "min")).toContain("x02210");
    expect(shapes(4, "maj")).toContain("022100");
    expect(shapes(2, "maj")).toContain("xx0232");
    expect(shapes(0, "maj7")).toContain("x32000");
  });
  it("finds barre chords and labels them", () => {
    const f = generateVoicings(5, getChordType("maj"), { tuning: std });
    const barre = f.find((v) => voicingText(v) === "133211")!;
    expect(barre).toBeTruthy();
    expect(barre.barreKind).toBe("full");
    expect(barre.fingers).toEqual([1, 3, 4, 2, 1, 1]);
    const bm = generateVoicings(11, getChordType("min"), { tuning: std }).map(voicingText);
    expect(bm).toContain("x24432");
  });
  it("respects slash bass", () => {
    const v = generateVoicings(0, getChordType("maj"), { tuning: std, bassPc: 4 });
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((x) => x.bassToken === "3")).toBe(true);
  });
  it("offers non-barre options for B major", () => {
    const b = generateVoicings(11, getChordType("maj"), { tuning: std });
    expect(b.filter((v) => v.barreKind === "none").length).toBeGreaterThan(5);
  });
  it("assigns fingers", () => {
    expect(assignFingers([null, 3, 2, 0, 1, 0])!.fingers).toEqual([null, 3, 2, null, 1, null]);
    expect(assignFingers([1, 1, 1, 1, 1, 1, ])!.barres.length).toBe(1);
    expect(assignFingers([1, 3, 5, 2, 4, 6])).toBeNull();
  });
  it("handles capo", () => {
    // B major with capo 4 = G shape 320003
    const b = generateVoicings(11, getChordType("maj"), { tuning: std, capo: 4 }).map(voicingText);
    expect(b).toContain("320003");
  });
});
