import { describe, expect, it } from "vitest";
import { measureVibe, renderPiece, type PieceSpec } from "./pieces";
import { GROUPS, LayoutChooser, REF_MEAN, REF_SD, VIBE_DIMS, axesOf, lookDistance, lookOf, normalise, rhythmOf, tonnetz, valueNoise, vibeDistance } from "./vibe";
import { rng } from "./rand";

const base = (o: Partial<PieceSpec>): PieceSpec => ({ seed: 1, seconds: 14, bpm: 100, key: 0, ...o });
/** Two kinds of music, each made twice: the same parts, but other notes, another key and tempo, and another mix. */
const A = base({ seed: 1, bpm: 96, key: 0, drums: { level: 0.8, busy: true }, bass: { level: 0.7, pulse: true }, pluck: { level: 0.6 }, melody: { level: 0.7, staccato: true } });
const A2 = base({ seed: 7, bpm: 102, key: 5, gain: 0.5, tilt: 3, drums: { level: 0.7, busy: true }, bass: { level: 0.8, pulse: true }, pluck: { level: 0.5 }, melody: { level: 0.8, staccato: true } });
const B = base({ seed: 3, bpm: 70, key: 9, minor: true, pad: { level: 0.7 }, vocal: { level: 0.7, breathy: true }, harmony: { level: 0.4 } });
const B2 = base({ seed: 11, bpm: 66, key: 2, minor: true, gain: 1.4, tilt: -3, pad: { level: 0.8 }, vocal: { level: 0.6, breathy: true }, harmony: { level: 0.5 } });
const C = base({ seed: 5, bpm: 128, key: 7, drums: { level: 0.9, busy: true, open: true }, bass: { level: 0.9 }, pad: { level: 0.5 }, melody: { level: 0.6, leaps: true } });
const C2 = base({ seed: 9, bpm: 124, key: 1, gain: 0.7, drums: { level: 0.8, busy: true, open: true }, bass: { level: 0.8 }, pad: { level: 0.6 }, melody: { level: 0.7, leaps: true } });

const cache = new Map<PieceSpec, Float32Array>();
const fp = (s: PieceSpec) => {
  let v = cache.get(s);
  if (!v) cache.set(s, (v = normalise(measureVibe(renderPiece(s)))));
  return v;
};

describe("the vibe of a piece: about seventy numbers", () => {
  it("has the five groups the research proposes, and reference figures for every number", () => {
    expect(VIBE_DIMS).toBe(74);
    expect(GROUPS.map((g) => g.to - g.from)).toEqual([35, 16, 10, 5, 8]);
    expect(REF_MEAN).toHaveLength(74);
    expect(REF_SD).toHaveLength(74);
    for (const s of REF_SD) expect(s).toBeGreaterThan(0);
  });

  it("the same music measured twice gives exactly the same numbers", () => {
    const a = measureVibe(renderPiece(A));
    const b = measureVibe(renderPiece(A));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("a song turned down, or mixed brighter, is still the same song: it moves less than a song with other parts", () => {
    const quiet = normalise(measureVibe(renderPiece({ ...A, gain: 0.25 })));
    const bright = normalise(measureVibe(renderPiece({ ...A, tilt: 4 })));
    const other = fp(B);
    expect(vibeDistance(fp(A), quiet)).toBeLessThan(0.3 * vibeDistance(fp(A), other));
    expect(vibeDistance(fp(A), bright)).toBeLessThan(0.3 * vibeDistance(fp(A), other));
  });

  it("music with the same parts lands closer than music with different parts, in the numbers and in the look of the painting", () => {
    const pairs: [PieceSpec, PieceSpec][] = [[A, A2], [B, B2], [C, C2]];
    const all = [A, A2, B, B2, C, C2];
    for (const [x, y] of pairs) {
      const same = vibeDistance(fp(x), fp(y));
      const sameLook = lookDistance(lookOf(fp(x)), lookOf(fp(y)));
      for (const z of all) {
        if (z === x || z === y) continue;
        expect(same).toBeLessThan(vibeDistance(fp(x), fp(z)));
        expect(sameLook).toBeLessThan(lookDistance(lookOf(fp(x)), lookOf(fp(z))));
      }
    }
    // and by a wide margin
    expect(vibeDistance(fp(A), fp(A2)) * 3).toBeLessThan(vibeDistance(fp(A), fp(B)));
  });

  it("music of one kind chooses the same layout and casts the palette the same way", () => {
    for (const [x, y] of [[A, A2], [B, B2], [C, C2]] as [PieceSpec, PieceSpec][]) {
      const lx = lookOf(fp(x));
      const ly = lookOf(fp(y));
      const best = (l: ReturnType<typeof lookOf>) => Object.entries(l.layouts).sort((a, b) => b[1] - a[1])[0][0];
      expect(best(lx)).toBe(best(ly));
      expect(Math.round(lx.turn)).toBe(Math.round(ly.turn));
    }
    // busy, beat-driven music and calm, held music read differently on the broad axes
    expect(axesOf(fp(A)).energy).toBeGreaterThan(axesOf(fp(B)).energy + 0.3);
    expect(axesOf(fp(A)).groove).toBeGreaterThan(axesOf(fp(B)).groove + 0.3);
  });

  it("the look is a smooth function of the vibe: a small change in the music is a small change in the painting", () => {
    const r = rng(7);
    let worst = 0;
    for (let k = 0; k < 300; k++) {
      const v = Float32Array.from({ length: 74 }, () => (r() * 2 - 1) * 0.9);
      const step = 0.002 + 0.05 * r();
      const w = v.map((x) => Math.max(-1, Math.min(1, x + (r() * 2 - 1) * step)));
      const d = vibeDistance(v, w);
      if (d < 1e-6) continue;
      worst = Math.max(worst, lookDistance(lookOf(v), lookOf(w)) / d);
    }
    // a fixed bound on how fast the look can change with the numbers (a Lipschitz constant)
    expect(worst).toBeLessThan(6);
    // and no change at all for no change
    const v = Float32Array.from({ length: 74 }, () => 0.3);
    expect(lookDistance(lookOf(v), lookOf(Float32Array.from(v)))).toBe(0);
  });

  it("choices with no reason behind them are pinned to a coarse grid: the same for nearby music, unrelated far apart", () => {
    const at = (p: number[]) => valueNoise(p, 3);
    expect(at([0.1, 0.2, 0.3])).toBe(at([0.1, 0.2, 0.3]));
    expect(Math.abs(at([0.1, 0.2, 0.3]) - at([0.11, 0.2, 0.3]))).toBeLessThan(0.05);
    // smooth across the edges of the grid, too
    expect(Math.abs(at([0.4999, 0.2, 0.3]) - at([0.5001, 0.2, 0.3]))).toBeLessThan(0.01);
    const far = [at([-0.9, -0.9, -0.9]), at([0.9, 0.9, 0.9]), at([-0.9, 0.9, 0.1]), at([0.9, -0.9, -0.4])];
    expect(Math.max(...far) - Math.min(...far)).toBeGreaterThan(0.2);
  });

  it("a layout is changed only when another leads clearly, for at least a bar, and kept once the music is known", () => {
    const ch = new LayoutChooser();
    const s = (river: number, rings: number) => ({ river, rings, bloom: 0, field: 0, lanes: 0, sweep: -1 });
    expect(ch.pick(s(0.5, 0.4), 0, 2)).toBe("river");
    // a small lead is not enough
    expect(ch.pick(s(0.5, 0.55), 1, 2)).toBe("river");
    // a clear lead, but not yet for a bar
    expect(ch.pick(s(0.5, 0.7), 2, 2)).toBe("river");
    expect(ch.pick(s(0.5, 0.7), 3, 2)).toBe("river");
    expect(ch.pick(s(0.5, 0.7), 4.1, 2)).toBe("rings");
    // settled: kept
    ch.pick(s(0.5, 0.7), 5, 2, true);
    expect(ch.pick(s(0.9, 0.1), 20, 2)).toBe("rings");
  });

  it("knows a tempo, a steady pulse, and the six bands of swing", () => {
    // onsets every half second (120 a minute) for six seconds
    const flux = new Float64Array(600);
    const db = new Float64Array(600).fill(-40);
    for (let i = 0; i < 600; i += 50) {
      flux[i] = 1;
      db[i] = -10;
      db[i + 1] = -16;
    }
    const r = rhythmOf(flux, db)!;
    expect(Math.abs(r.tempo)).toBeLessThan(0.05);
    expect(r.pulse).toBeGreaterThan(0.5);
    expect(r.swing.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(rhythmOf(new Float64Array(600), new Float64Array(600).fill(-120))).toBeNull();
  });

  it("hears harmony on the tonnetz: a chord and its transposition are the same distance from home", () => {
    const c = new Float64Array(12);
    [0, 4, 7].forEach((i) => (c[i] = 1));
    const g = new Float64Array(12);
    [7, 11, 2].forEach((i) => (g[i] = 1));
    const tc = tonnetz(c);
    const tg = tonnetz(g);
    const norm = (t: Float64Array) => Math.hypot(...t);
    expect(norm(tc)).toBeCloseTo(norm(tg), 6);
    expect(Math.hypot(...tc.map((x, i) => x - tg[i]))).toBeGreaterThan(0.1);
  });
});
