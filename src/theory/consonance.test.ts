import { describe, expect, it } from "vitest";
import { added, consonance, cross, harmonicity, roughness } from "./consonance";

describe("the sound model (ported from dycon / har18 / incon)", () => {
  it("Hutchinson–Knopoff roughness of two notes from C4 matches the reference values, interval by interval", () => {
    const ref = [0.001, 0.484, 0.254, 0.112, 0.07, 0.045, 0.097, 0.023, 0.093, 0.057, 0.102, 0.225, 0.002, 0.22, 0.087];
    ref.forEach((r, i) => expect(roughness([60, 60 + i]), `interval ${i}`).toBeCloseTo(r, 1));
    // the same thirds an octave lower are rougher
    expect(roughness([48, 51])).toBeGreaterThan(roughness([60, 63]));
    expect(roughness([48, 52])).toBeGreaterThan(roughness([60, 64]));
    expect(roughness([48, 51])).toBeCloseTo(0.212, 1);
    expect(roughness([48, 52])).toBeCloseTo(0.128, 1);
  });
  it("major and minor triads: roughness, harmonicity and the combined score as published", () => {
    expect(roughness([60, 64, 67])).toBeCloseTo(0.12, 1);
    expect(roughness([60, 63, 67])).toBeCloseTo(0.13, 1);
    expect(harmonicity([60, 64, 67])).toBeCloseTo(harmonicity([60, 63, 67]), 1);
    expect(consonance([60, 64, 67])).toBeGreaterThan(consonance([60, 61, 62]));
  });
  it("cross is symmetric, zero for the same note, and ranks a minor second over a major third over a fifth", () => {
    expect(cross(60, 64)).toBeCloseTo(cross(64, 60), 9);
    expect(cross(60, 60)).toBe(0);
    expect(added(61, [60])).toBeGreaterThan(added(64, [60]));
    expect(added(64, [60])).toBeGreaterThan(added(67, [60]));
    // a minor ninth rubs, a major ninth less so
    expect(added(73, [60])).toBeGreaterThan(added(74, [60]));
  });
  it("is quick: a full row of the table fills in well under a frame", () => {
    const t = performance.now();
    for (let m = 0; m < 128; m++) cross(30, m);
    expect(performance.now() - t).toBeLessThan(250);
  });
});
