import { describe, expect, it } from "vitest";
import { bestPath, bestPath1 } from "./search";
import { seededRng } from "./progression";
import { fingerNotes } from "../guitar/finger";
import { getTuning } from "../guitar/tunings";
import { playedNotes, reviveNotes } from "../song/chordnotes";

describe("the search a whole phrase is chosen with", () => {
  it("finds the cheapest path, first and second order, as trying every path does; ties go to the earlier candidate", () => {
    const rng = seededRng(7);
    for (let t = 0; t < 120; t++) {
      const n = 2 + Math.floor(rng() * 4);
      const cands = Array.from({ length: n }, () => Array.from({ length: 1 + Math.floor(rng() * 4) }, () => Math.floor(rng() * 20)));
      const w = Array.from({ length: 400 }, () => Math.floor(rng() * 5));
      const node = (i: number, c: number) => w[(i * 31 + c) % 400];
      const edge2 = (i: number, z: number | null, a: number, b: number) => w[(i * 7 + (z ?? 3) * 11 + a * 13 + b) % 400] / 2;
      const edge1 = (i: number, a: number, b: number) => w[(i * 7 + a * 13 + b) % 400] / 2;
      let best2 = Infinity;
      let best1 = Infinity;
      const walk = (i: number, path: number[]) => {
        if (i === n) {
          let c2 = 0;
          let c1 = 0;
          path.forEach((c, k) => {
            c2 += node(k, c);
            c1 += node(k, c);
            if (k > 0) {
              c2 += edge2(k, k > 1 ? path[k - 2] : null, path[k - 1], c);
              c1 += edge1(k, path[k - 1], c);
            }
          });
          best2 = Math.min(best2, c2);
          best1 = Math.min(best1, c1);
          return;
        }
        for (const c of cands[i]) walk(i + 1, [...path, c]);
      };
      walk(0, []);
      expect(bestPath(cands, node, edge2).cost).toBeCloseTo(best2, 9);
      expect(bestPath1(cands, node, edge1).cost).toBeCloseTo(best1, 9);
    }
    expect(bestPath([[1, 2], [5]], () => 0, () => 0).path).toEqual([1, 5]);
  });
});

describe("exact notes on the guitar, and kept honest", () => {
  const std = getTuning("standard");
  it("finds a hand for G4 B4 D5 on the top strings within four frets, moves with the capo, and says when there is none", () => {
    const f = fingerNotes([67, 71, 74], std, 0)!;
    expect(f).toBeDefined();
    const used = f.map((x, s) => (x === null ? -1 : s)).filter((s) => s >= 0);
    expect(used.length).toBe(3);
    const fretted = f.filter((x): x is number => x !== null && x > 0);
    expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(4);
    used.forEach((s, i) => expect(std.notes[s] + f[s]!).toBe([67, 71, 74][i]));
    const c2 = fingerNotes([67, 71, 74], std, 2)!;
    c2.forEach((x, s) => x !== null && expect(std.notes[s] + 2 + x).toBeGreaterThan(0));
    expect(fingerNotes([40, 41, 42, 43, 44, 45, 46], std, 0)).toBeUndefined();
    expect(fingerNotes([30], std, 0)).toBeUndefined();
  });
  it("written notes play only while they belong to the chord, and load safely", () => {
    expect(playedNotes({ ref: { root: "C", typeId: "maj7" }, notes: [64, 67, 71] })).toEqual([64, 67, 71]);
    expect(playedNotes({ ref: { root: "C", typeId: "maj" }, notes: [64, 67, 71] })).toBeUndefined();
    expect(playedNotes({ ref: { root: "C", typeId: "maj7" }, notes: [64], rest: true })).toBeUndefined();
    expect(reviveNotes([71, 64, 67])).toEqual([64, 67, 71]);
    expect(reviveNotes([64, 64])).toBeUndefined();
    expect(reviveNotes([10])).toBeUndefined();
    expect(reviveNotes("x")).toBeUndefined();
  });
});
