import { describe, expect, it } from "vitest";
import { airDb, bellDb, eqDb, fOf, highCutDb, hz, lowCutDb, lowShelfDb, tidyHz, xOf } from "./eqcurve";
import { FX_DEFAULT, PRESETS, presetFx, reviveFx } from "./vocalfx";

describe("the EQ curve", () => {
  it("a bell is its gain at its centre, half of it a half-width away, nothing far off", () => {
    expect(bellDb(4000, 4000, 1, 6)).toBeCloseTo(6, 5);
    expect(bellDb(4000, 4000, 1, -6)).toBeCloseTo(-6, 5);
    expect(bellDb(40, 4000, 1, 6)).toBeCloseTo(0, 2);
    // boost and cut are mirror images
    expect(bellDb(2500, 4000, 1.4, 5)).toBeCloseTo(-bellDb(2500, 4000, 1.4, -5), 6);
    // narrower with a higher Q
    expect(bellDb(3000, 4000, 4, 6)).toBeLessThan(bellDb(3000, 4000, 1, 6));
  });
  it("shelves and cuts", () => {
    expect(lowShelfDb(20, 120, 4)).toBeCloseTo(4, 0);
    expect(lowShelfDb(120, 120, 4)).toBeCloseTo(2, 0);
    expect(Math.abs(lowShelfDb(3000, 120, 4))).toBeLessThan(0.05);
    expect(airDb(12000, 12000, 6)).toBeCloseTo(3.98, 1);
    expect(airDb(200, 12000, 6)).toBeLessThan(0.01);
    expect(lowCutDb(90, 90)).toBeCloseTo(-3.01, 1);
    expect(lowCutDb(45, 90)).toBeCloseTo(-24.1, 0);
    expect(highCutDb(4000, 4000)).toBeCloseTo(-3.01, 1);
    expect(highCutDb(10000, 20000)).toBe(0);
  });
  it("the whole EQ is its bands added up, and a flat EQ is flat", () => {
    const flat = { ...FX_DEFAULT, lowcut: 20, low: 0, mid: 0, mud: 0, presence: 0, air: 0, highcut: 20000 };
    for (const f of [100, 1000, 10000]) expect(Math.abs(eqDb(flat, f))).toBeLessThan(0.05);
    expect(eqDb({ ...flat, presence: 4, presence_freq: 3000 }, 3000)).toBeCloseTo(4, 3);
    // an older sound's mud cut still counts
    expect(eqDb({ ...flat, mud: 1, mud_freq: 320 }, 320)).toBeCloseTo(-5, 3);
  });
  it("the graph's scale: octaves evenly spaced, and back again", () => {
    expect(xOf(20)).toBe(0);
    expect(xOf(40000)).toBeCloseTo(1, 9);
    expect(xOf(200) - xOf(100)).toBeCloseTo(xOf(8000) - xOf(4000), 9);
    expect(fOf(xOf(1234))).toBeCloseTo(1234, 6);
    expect([hz(90), hz(3500), hz(12000)]).toEqual(["90 Hz", "3.5 kHz", "12 kHz"]);
    expect([tidyHz(93.4), tidyHz(3274), tidyHz(11800)]).toEqual([93, 3250, 12000]);
  });
});

describe("vocal sounds", () => {
  it("a sound from before the EQ had a graph keeps its mud cut, as the low-mid band", () => {
    const old = reviveFx({ on: true, mud: 0.6, presence: 3, verb: 0.4 })!;
    expect(old.mid).toBeCloseTo(-3, 6);
    expect(old.mud).toBe(0);
    expect([old.color, old.verb_type, old.echo_type, old.width]).toEqual(["tube", "plate", "tape", "double"]);
    expect(old.low_freq).toBe(120);
    // one saved since stays as it is
    expect(reviveFx({ mid: 2, mud: 0 })!.mid).toBe(2);
    // unknown type names fall back
    expect(reviveFx({ verb_type: "cathedral" })!.verb_type).toBe("plate");
  });
  it("every preset is complete, in range, and named for a kind of record", () => {
    for (const p of PRESETS) {
      const fx = presetFx(p.id, 100);
      for (const [k, v] of Object.entries(fx)) expect(v, `${p.id}.${k}`).not.toBeUndefined();
      expect(fx.mud).toBe(0);
      expect(fx.mid).toBeLessThanOrEqual(0);
      expect(fx.echo_time).toBeGreaterThan(0.05);
      expect(Math.abs(eqDb(fx, 1000))).toBeLessThan(6);
    }
    expect(presetFx("dance", 120).echo_time).toBeCloseTo(0.375, 6);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });
});
