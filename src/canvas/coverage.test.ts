import { describe, expect, it } from "vitest";
import { Budget, C_MAX, C_MIN, densityOf, targetCoverage } from "./coverage";
import type { LayerKind } from "./layers";
import { rng } from "./rand";
import type { Stamp } from "./sim";

const W = 1000;
const H = 560;
const mark = (x: number, y: number, r = 18): Stamp => ({ x, y, r, angle: 0, stretch: 1.3, k: [0.5, 0.5, 0.5], paint: 0.3, water: 0.1, vx: 0, vy: 0, load: 1, kind: 0, hard: 0.5, seed: 1 });
const playing = (n: number, loud: number) => (["drums", "bass", "chords", "melody", "vocals", "other"] as LayerKind[]).map((layer, i) => ({ layer, active: i < n, loud }));

/** Lay marks of the playing layers all over the canvas for `seconds`, as the budget allows, and say how much is covered. */
function fill(b: Budget, layers: LayerKind[], seconds: number, perSecond = 600, seed = 1): number {
  const r = rng(seed);
  for (let f = 0; f < seconds * 60; f++) {
    for (let i = 0; i < perSecond / 60; i++) {
      const layer = layers[(f * 7 + i) % layers.length];
      b.admit(mark(r() * W, r() * H), layer, 1 / 60);
    }
    // as the painting does: old paint sinks when the canvas is fuller than the music calls for
    b.tick(1 / 60, b.sink());
  }
  return b.covered;
}

describe("the canvas fills as far as the music calls for", () => {
  it("the target: two quiet parts leave most of the canvas bare, six loud ones cover much more, and some ground is always left", () => {
    expect(targetCoverage(0)).toBeCloseTo(C_MIN, 6);
    expect(targetCoverage(0.3)).toBeCloseTo(0.11, 2);
    expect(targetCoverage(0.6)).toBeCloseTo(0.18, 2);
    expect(targetCoverage(1.8)).toBeCloseTo(0.39, 2);
    expect(targetCoverage(2.4)).toBeCloseTo(0.46, 2);
    expect(targetCoverage(5.4)).toBeCloseTo(0.67, 2);
    expect(targetCoverage(100)).toBeLessThanOrEqual(C_MAX);
    expect(C_MAX).toBeLessThanOrEqual(0.8);
  });

  it("the density adds up the parts that are playing, each as loud as it is", () => {
    expect(densityOf(playing(2, 0.3))).toBeCloseTo(0.6, 6);
    expect(densityOf(playing(6, 0.9))).toBeCloseTo(5.4, 6);
    expect(densityOf([{ active: true, loud: 3 }, { active: false, loud: 1 }])).toBe(1);
  });

  it("two quiet parts cover little however much they paint; six loud ones cover far more", () => {
    const quiet = new Budget();
    quiet.size(W, H);
    quiet.setLayers(playing(2, 0.3));
    const sparse = fill(quiet, ["drums", "bass"], 20);
    const loud = new Budget();
    loud.size(W, H);
    loud.setLayers(playing(6, 0.9));
    const dense = fill(loud, ["drums", "bass", "chords", "melody", "vocals", "other"], 20);
    expect(quiet.target).toBeCloseTo(0.18, 2);
    expect(sparse).toBeLessThan(0.18 * 1.35);
    expect(sparse).toBeGreaterThan(0.1);
    expect(dense).toBeGreaterThan(0.55);
    expect(dense).toBeLessThan(C_MAX + 0.05);
  });

  it("no part can cover the canvas on its own: a busy one is rationed, and the others still get their room", () => {
    const b = new Budget();
    b.size(W, H);
    b.setLayers([{ layer: "drums", active: true, loud: 0.8 }, { layer: "melody", active: true, loud: 0.8 }]);
    const r = rng(3);
    let drumsLate = 0;
    let n = 0;
    for (let f = 0; f < 240; f++) {
      // the drums throw a great deal of paint
      for (let i = 0; i < 40; i++) {
        const a = b.admit(mark(r() * W, r() * H, 6), "drums", 1 / 60);
        if (f > 120) {
          drumsLate += a;
          n++;
        }
      }
      b.tick(1 / 60);
    }
    expect(drumsLate / n).toBeLessThan(0.5);
    // the melody, which has laid nothing, is let down in full where there is room
    expect(b.admit(mark(500, 100, 6), "melody", 1 / 60)).toBeGreaterThan(0.6);
  });

  it("when the music gets quieter, nothing new is added and old paint sinks back until the canvas is as full as the music calls for", () => {
    const b = new Budget();
    b.size(W, H);
    b.setLayers(playing(6, 1));
    fill(b, ["drums", "bass", "chords", "melody", "vocals", "other"], 15);
    // loud and full: the canvas is as full as it should be, and hardly anything sinks
    expect(b.sink()).toBeLessThan(0.02);
    const loudSink = b.sink();
    b.setLayers(playing(1, 0.2));
    expect(b.covered).toBeGreaterThan(b.target * 2);
    expect(b.sink()).toBeGreaterThan(loudSink * 5);
    // a new mark goes down thinned
    expect(b.admit(mark(500, 300), "drums", 1 / 60)).toBeLessThan(0.5);
    // sinking at the rate it asks for, it comes down
    const before = b.covered;
    for (let i = 0; i < 60 * 20; i++) b.tick(1 / 60, b.sink());
    expect(b.covered).toBeLessThan(before * 0.6);
  });

  it("knows what the painting really shows, and moves with the canvas when it flows", () => {
    const b = new Budget(4, 2);
    b.size(400, 200);
    b.observe([1, 0, 0, 0, 0, 0, 0, 1]);
    expect(b.covered).toBeCloseTo(0.25, 6);
    // the canvas moved a whole cell to the left: what was in the first column is gone, a bare one comes in on the right
    b.shift(-100);
    expect(Array.from(b.cells)).toEqual([0, 0, 0, 0, 0, 0, 1, 0]);
  });
});
