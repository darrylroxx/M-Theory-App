import { describe, expect, it } from "vitest";
import { fileWhen, songWhen } from "./clock";
import { LAYERS, type LayerKind } from "./layers";
import { MARGIN, upOfHz, yOfHz } from "./layout";
import { Bloom, Field, LANES, LAYOUTS, Lanes, Rings, River, Sweep, makeLayout, yOfUp, type When } from "./place";

const W = 1000;
const H = 560;
const PASS = 16;
const when = fileWhen(PASS, 2, 1);
/** A layout sized, with the music at `t` seconds. */
function at<T extends { size(w: number, h: number): void; now(w: When, dt: number, motion?: number): void }>(l: T, t: number): T {
  l.size(W, H);
  l.now(when(t), 1 / 60, 0.5);
  return l;
}

describe("layouts: where each moment of each layer goes", () => {
  it("there are six, one of them the sweep, and every one keeps a sound's height (or distance from the middle) for its frequency", () => {
    expect(LAYOUTS.map((l) => l.id).sort()).toEqual(["bloom", "field", "lanes", "rings", "river", "sweep"]);
    for (const { id } of LAYOUTS) {
      const l = makeLayout(id);
      l.size(W, H);
      for (let t = 0; t < 30; t += 1 / 60) l.now(when(t), 1 / 60, 0.5);
      for (const layer of LAYERS) {
        const lo = l.place(when(30), 0.2, layer);
        const hi = l.place(when(30), 0.8, layer);
        expect(lo && hi).toBeTruthy();
        for (const p of [lo!, hi!]) {
          expect(p.x).toBeGreaterThan(-W * 0.1);
          expect(p.x).toBeLessThan(W * 1.1);
          expect(p.y).toBeGreaterThan(-1);
          expect(p.y).toBeLessThan(H + 1);
          expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(1, 3);
        }
        if (id === "rings" || id === "bloom") continue;
        // higher is higher
        expect(hi!.y).toBeLessThan(lo!.y);
      }
    }
  });

  it("the sweep is the canvas as it was: left to right across a page of bars, frequency up the side", () => {
    const s = at(new Sweep(), 4);
    const p = s.place(when(4), upOfHz(440));
    expect(p.x).toBeCloseTo(W * (MARGIN + (4 / PASS) * (1 - 2 * MARGIN)), 6);
    expect(p.y).toBeCloseTo(yOfHz(440, H), 6);
    // the next page starts a new stroke
    expect(s.place(when(PASS + 1), 0.5).seg).not.toBe(s.place(when(PASS - 1), 0.5).seg);
  });

  it("the river has no line crossing the canvas: paint goes in at one place, and the canvas itself flows left", () => {
    const r = at(new River(), 5);
    const head = r.place(when(5), 0.5, "melody")!.x;
    r.now(when(9), 1 / 60);
    // the newest paint lands where it always does
    expect(r.place(when(9), 0.5, "melody")!.x).toBeCloseTo(head, 6);
    // and the canvas drifts left at one crossing a pass
    expect(r.drift().x).toBeCloseTo(-(W * (1 - 2 * MARGIN)) / PASS, 6);
    // music of a second ago is a second's drift downstream
    const back = r.place(when(8), 0.5, "melody")!.x;
    expect(head - back).toBeCloseTo((W * (1 - 2 * MARGIN)) / PASS, 0);
    // the lines meander a little, never more than a few semitones
    for (let t = 0; t < 30; t += 0.25) expect(Math.abs(r.place(when(t), 0.5, "melody")!.y - yOfUp(0.5, H))).toBeLessThan(H * 0.04);
  });

  it("rings: time goes round, frequency goes out from the middle, and a phrase comes round to the same spoke", () => {
    const g = at(new Rings(), 0);
    const centre = { x: W / 2, y: H / 2 };
    const r = (t: number, up: number) => {
      const p = g.place(when(t), up);
      return Math.hypot((p.x - centre.x) / Math.min(1.3, W / H), p.y - centre.y);
    };
    expect(r(3, 0.8)).toBeGreaterThan(r(3, 0.4) + 50);
    expect(r(3, 0.4)).toBeGreaterThan(r(3, 0.1) + 30);
    const ang = (t: number) => {
      const p = g.place(when(t), 0.5);
      return Math.atan2(p.y - centre.y, (p.x - centre.x) / Math.min(1.3, W / H));
    };
    const turn = 2 * g.turnBars(when(0));
    // one turn later: the same spoke, but a little further round, so the turns lie side by side
    const d = Math.abs(ang(turn + 1) - ang(1));
    expect(d).toBeGreaterThan(0.02);
    expect(d).toBeLessThan(0.15);
    // a quarter of a turn later, a quarter of the way round
    expect(Math.abs(Math.abs(ang(1 + turn / 4) - ang(1)) - Math.PI / 2)).toBeLessThan(0.05);
  });

  it("blooms: each section opens from a place of its own, and grows out from it", () => {
    const b = at(new Bloom(), 0);
    const anchors = [0, 1, 2, 3].map((i) => b.anchor(i));
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++) expect(Math.hypot(anchors[i].x - anchors[j].x, anchors[i].y - anchors[j].y)).toBeGreaterThan(40);
    for (const a of anchors) {
      expect(a.x).toBeGreaterThan(W * 0.15);
      expect(a.x).toBeLessThan(W * 0.85);
    }
    const sec: When = { ...when(0), index: 2, key: "C", into: 0, length: 16 };
    const dist = (into: number) => {
      const p = b.place({ ...sec, into }, 0.5);
      return Math.hypot(p.x - anchors[2].x, p.y - anchors[2].y);
    };
    expect(dist(12)).toBeGreaterThan(dist(4));
    expect(dist(4)).toBeGreaterThan(dist(0.2));
  });

  it("the field: every layer is carried across the whole canvas by a current of its own, so they cross and weave", () => {
    const f = new Field();
    f.size(W, H);
    const xs = new Map<LayerKind, number[]>();
    for (let t = 0; t < 60; t += 1 / 60) {
      f.now(when(t), 1 / 60, 0.5);
      if (Math.abs((t % 1) - 0) < 1 / 120) for (const l of LAYERS) xs.set(l, [...(xs.get(l) ?? []), f.place(when(t), 0.5, l).x]);
    }
    for (const l of LAYERS) {
      const v = xs.get(l)!;
      expect(Math.max(...v) - Math.min(...v)).toBeGreaterThan(W * 0.5);
    }
    // at any moment the layers are in different places (there is no one line where the music is)
    const now = LAYERS.map((l) => f.place(when(60), 0.5, l).x);
    expect(Math.max(...now) - Math.min(...now)).toBeGreaterThan(W * 0.2);
    // the current bends a note's height by no more than about an octave
    for (let t = 30; t < 60; t += 0.5) expect(Math.abs(f.place(when(t), 0.5, "melody").y - yOfUp(0.5, H))).toBeLessThanOrEqual(H / 12 + 1e-6);
  });

  it("lanes: each layer in a band of its own, the bass low, the drums high", () => {
    const l = at(new Lanes(), 5);
    for (const layer of LAYERS) {
      const [top, bottom] = LANES[layer];
      for (const hz of [60, 200, 600, 2000]) {
        const y = l.place(when(5), upOfHz(hz), layer)!.y / H;
        expect(y).toBeGreaterThan(top - 0.08);
        expect(y).toBeLessThan(bottom + 0.08);
      }
    }
    expect(LANES.bass[0]).toBeGreaterThan(LANES.melody[1]);
    expect(LANES.drums[1]).toBeLessThan(LANES.chords[0]);
  });

  it("the app's own song is placed by its sections and bars, and runs on without a break", () => {
    const spot = { key: "A", index: 0, beat: 6, bar: 4, bars: 8, spb: 0.5 };
    const w = songWhen(spot, 100, 1200, 97, 2);
    expect(w(100).s).toBeCloseTo(3, 6);
    expect(w(100).into).toBeCloseTo(3, 6);
    expect(w(99).into).toBeCloseTo(2, 6);
    expect(w(100).bar).toBe(2);
    expect(w(100).jump).toBe(2);
    expect(w(100).frac).toBeCloseTo(6 / 32, 6);
  });
});
