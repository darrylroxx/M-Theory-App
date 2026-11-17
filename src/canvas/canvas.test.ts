import { describe, expect, it } from "vitest";
import { DRUM_IDS } from "../audio/drums";
import { dropPulses, due, listen, pulse, waiting } from "../audio/pulse";
import { contrast, hexToRgb, hslToRgb, isHex, luminance, mix, rgbToHsl, shade, vary } from "./color";
import { BANDS, DRUM_PLACE, MARGIN, colorIndex, maxBars, noteColors, pageOf, speed, xOf, yOfDrum, yOfMidi, type Spot } from "./layout";
import { blobPoints, dab, deform, drip, flam, inkLine, speckle, splatter, stroke, wash, type G } from "./marks";
import { DEFAULT_PALETTE, PALETTES, PALETTE_GROUPS, getPalette, roles } from "./palettes";
import { gauss, hash, noise, noise2, rng } from "./rand";
import { SURFACES, isSurface, surfaceHeight, surfaceTexture } from "./weave";

describe("chance that can be repeated", () => {
  it("the same seed gives the same numbers, a different seed different ones", () => {
    const a = rng(7);
    const b = rng(7);
    const c = rng(8);
    const xs = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 50 }, () => c())).not.toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("bell-curve numbers centre on nothing and mostly stay small", () => {
    const r = rng(3);
    const xs = Array.from({ length: 4000 }, () => gauss(r));
    const mean = xs.reduce((a, x) => a + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.06);
    expect(sd).toBeGreaterThan(0.93);
    expect(sd).toBeLessThan(1.07);
    expect(xs.every(Number.isFinite)).toBe(true);
  });

  it("noise wanders smoothly between 0 and 1", () => {
    for (let x = -5; x < 30; x += 0.37) {
      const a = noise(x, 2);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(Math.abs(noise(x + 0.01, 2) - a)).toBeLessThan(0.03);
      expect(noise2(x, x * 0.7, 1)).toBeGreaterThanOrEqual(0);
      expect(noise2(x, x * 0.7, 1)).toBeLessThanOrEqual(1);
    }
    expect(noise(3.3, 1)).toBe(noise(3.3, 1));
    expect(hash(12)).toBe(hash(12));
    expect(hash(12)).not.toBe(hash(13));
  });
});

describe("colour", () => {
  it("reads hex, and turns colours round the wheel and back", () => {
    expect(hexToRgb("#ff8000")).toEqual([255, 128, 0]);
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(isHex("#12abEF")).toBe(true);
    expect(isHex("12abef")).toBe(false);
    expect(isHex("#12abe")).toBe(false);
    for (const hex of ["#c8102e", "#1f3f8a", "#f2a900", "#808080", "#000000", "#ffffff", "#2de2e6"]) {
      const rgb = hexToRgb(hex);
      const back = hslToRgb(...rgbToHsl(rgb));
      back.forEach((v, i) => expect(Math.abs(v - rgb[i])).toBeLessThanOrEqual(1));
    }
  });

  it("knows light from dark", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 3);
    expect(contrast("#777777", "#777777")).toBe(1);
    expect(contrast("#102030", "#f0f0f0")).toBe(contrast("#f0f0f0", "#102030"));
  });

  it("a paint varies a little from one brush-load to the next, but stays itself", () => {
    const r = rng(5);
    const base = hexToRgb("#c8102e");
    const [h0] = rgbToHsl(base);
    let differs = 0;
    for (let i = 0; i < 200; i++) {
      const v = vary("#c8102e", r);
      const [h, s, l] = rgbToHsl(v);
      const dh = Math.min(Math.abs(h - h0), 360 - Math.abs(h - h0));
      expect(dh).toBeLessThan(6);
      expect(s).toBeGreaterThan(0.7);
      expect(l).toBeGreaterThan(0.3);
      expect(l).toBeLessThan(0.55);
      if (v.join() !== base.join()) differs++;
    }
    expect(differs).toBeGreaterThan(190);
    expect(rgbToHsl(shade(base, 0.2))[2]).toBeGreaterThan(rgbToHsl(base)[2]);
    expect(mix([0, 0, 0], [200, 100, 50], 0.5)).toEqual([100, 50, 25]);
  });
});

describe("where things go on the canvas", () => {
  const spot = (beat: number, bars = 4, bar = 4): Spot => ({ key: "A", index: 0, beat, bar, bars, spb: 0.5 });

  it("a section of up to eight bars is one canvas, crossed from left to right", () => {
    expect(maxBars(1200)).toBe(8);
    expect(pageOf(spot(0), 1200)).toEqual({ key: "A:0", page: 0, pages: 1, perPage: 4, frac: 0 });
    expect(pageOf(spot(8), 1200).frac).toBeCloseTo(0.5);
    expect(pageOf(spot(15.99), 1200).frac).toBeCloseTo(1, 2);
    expect(pageOf(spot(4, 8), 1200)).toMatchObject({ pages: 1, perPage: 8, frac: 1 / 8 });
  });

  it("longer sections take several canvases, shared out evenly", () => {
    expect(pageOf(spot(0, 16), 1200)).toMatchObject({ key: "A:0", pages: 2, perPage: 8 });
    expect(pageOf(spot(32, 16), 1200)).toMatchObject({ key: "A:1", page: 1, frac: 0 });
    expect(pageOf(spot(63.9, 16), 1200)).toMatchObject({ key: "A:1", page: 1 });
    expect(pageOf(spot(0, 12), 1200)).toMatchObject({ pages: 2, perPage: 6 });
    expect(pageOf(spot(0, 32), 1200)).toMatchObject({ pages: 4, perPage: 8 });
    expect(pageOf(spot(127.99, 32), 1200).key).toBe("A:3");
    // the last canvas of nine bars has room to spare, and the music stays on it
    expect(pageOf(spot(35.5, 9), 1200)).toMatchObject({ pages: 2, perPage: 5, page: 1 });
    // other time signatures: bars are counted, not beats
    expect(pageOf(spot(6, 4, 3), 1200).frac).toBeCloseTo(0.5);
  });

  it("a narrow canvas (a phone held upright) takes four bars at a time", () => {
    expect(maxBars(360)).toBe(4);
    expect(pageOf(spot(0, 8), 360)).toMatchObject({ pages: 2, perPage: 4 });
    expect(pageOf(spot(16, 8), 360)).toMatchObject({ key: "A:1", frac: 0 });
    expect(pageOf(spot(0, 4), 360).pages).toBe(1);
  });

  it("each letter is its own painting", () => {
    expect(pageOf({ ...spot(0), key: "B" }, 1200).key).toBe("B:0");
  });

  it("there is a margin either side, and the speed follows the tempo", () => {
    expect(xOf(0, 1000)).toBeCloseTo(MARGIN * 1000);
    expect(xOf(1, 1000)).toBeCloseTo(1000 - MARGIN * 1000);
    expect(xOf(0.5, 1000)).toBeCloseTo(500);
    const p = pageOf(spot(0), 1000);
    // four bars of four beats at half a second each: eight seconds to cross the inside of the canvas
    expect(speed(p, spot(0), 1000)).toBeCloseTo((1000 * (1 - 2 * MARGIN)) / 8);
    expect(speed(p, { ...spot(0), spb: 0.25 }, 1000)).toBeCloseTo(speed(p, spot(0), 1000) * 2);
  });

  it("higher notes sit higher: lows at the bottom, highs at the top", () => {
    for (const band of ["chords", "melody"] as const) {
      let last = Infinity;
      for (let m = 30; m <= 96; m++) {
        const y = yOfMidi(m, band, 600);
        expect(y).toBeLessThanOrEqual(last);
        expect(y).toBeGreaterThanOrEqual(BANDS[band][0] * 600 - 1e-6);
        expect(y).toBeLessThanOrEqual(BANDS[band][1] * 600 + 1e-6);
        last = y;
      }
    }
    // the same note is higher up in the melody than in the chords
    expect(yOfMidi(67, "melody", 600)).toBeLessThan(yOfMidi(67, "chords", 600));
  });

  it("every drum has its place: kick lowest, snare above it, cymbals along the top", () => {
    for (const id of DRUM_IDS) {
      expect(DRUM_PLACE[id]).toBeTruthy();
      const y = yOfDrum(id, 600);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(600);
    }
    expect(yOfDrum("kick", 600)).toBeGreaterThan(yOfDrum("tom", 600));
    expect(yOfDrum("tom", 600)).toBeGreaterThan(yOfDrum("snare", 600));
    expect(yOfDrum("snare", 600)).toBeGreaterThan(yOfDrum("hat", 600));
    expect(yOfDrum("hat", 600)).toBeGreaterThan(yOfDrum("open", 600));
    // however far it wanders, it stays in its band
    expect(yOfDrum("kick", 600, 9)).toBeLessThanOrEqual(BANDS.low[1] * 600);
    expect(yOfDrum("hat", 600, -9)).toBeGreaterThanOrEqual(BANDS.air[0] * 600);
  });

  it("the notes of the key share out the whole palette, near relatives side by side", () => {
    const major = [0, 2, 4, 5, 7, 9, 11];
    for (const n of [5, 6, 7, 8]) {
      for (let tonic = 0; tonic < 12; tonic++) {
        const scale = major.map((p) => (p + tonic) % 12);
        const map = noteColors(tonic, scale, n);
        expect(map).toHaveLength(12);
        expect(map.every((i) => Number.isInteger(i) && i >= 0 && i < n)).toBe(true);
        // every colour (or all but one, when there are more colours than notes) is used by a note of the key
        expect(new Set(scale.map((p) => map[p])).size).toBeGreaterThanOrEqual(Math.min(n, 7) - 1);
        // going round the key in fifths (F C G D A E B in C major), the colours only ever move on, one step at most
        const inFifths = [5, 0, 7, 2, 9, 4, 11].map((p) => map[(p + tonic) % 12]);
        for (let i = 1; i < 7; i++) expect([0, 1]).toContain(inFifths[i] - inFifths[i - 1]);
        // the same in every octave
        expect(colorIndex(60 + tonic, map, n)).toBe(colorIndex(36 + tonic, map, n));
      }
    }
    // C major on six colours: F and C share the first, then G, D, A, E, B take one each
    expect([5, 0, 7, 2, 9, 4, 11].map((p) => noteColors(0, major, 6)[p])).toEqual([0, 0, 1, 2, 3, 4, 5]);
    // a note from outside the key takes the colour of its nearest relative: F sharp sits beyond B
    expect(noteColors(0, major, 6)[6]).toBe(noteColors(0, major, 6)[11]);
    // B flat sits beyond F
    expect(noteColors(0, major, 6)[10]).toBe(noteColors(0, major, 6)[5]);
  });

  it("other scales get the whole palette too", () => {
    const minor = [0, 2, 3, 5, 7, 8, 10];
    const penta = [0, 3, 5, 7, 10];
    expect(new Set(minor.map((p) => noteColors(9, minor.map((x) => (x + 9) % 12), 6)[(p + 9) % 12])).size).toBe(6);
    expect(new Set(penta.map((p) => noteColors(0, penta, 5)[p])).size).toBe(5);
    // no scale given: all twelve notes share the colours out
    expect(new Set(noteColors(0, [], 6)).size).toBe(6);
    // another section: the same family of colours, moved round
    const map = noteColors(0, [0, 2, 4, 5, 7, 9, 11], 6);
    expect(colorIndex(64, map, 6, 2)).toBe((colorIndex(64, map, 6) + 2) % 6);
  });
});

describe("colour schemes", () => {
  it("there are plenty, each one complete", () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(30);
    expect(PALETTE_GROUPS).toEqual(["Paint", "Prints", "Loved", "Screens", "Glow"]);
    for (const g of PALETTE_GROUPS) expect(PALETTES.filter((p) => p.group === g).length, g).toBeGreaterThanOrEqual(3);
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
    expect(new Set(PALETTES.map((p) => p.name)).size).toBe(PALETTES.length);
    for (const p of PALETTES) {
      expect(isHex(p.ground), p.id).toBe(true);
      expect(isHex(p.ink), p.id).toBe(true);
      expect(p.colors.length, p.id).toBeGreaterThanOrEqual(4);
      expect(p.colors.length, p.id).toBeLessThanOrEqual(8);
      expect(p.colors.every(isHex), p.id).toBe(true);
      expect(new Set(p.colors).size, p.id).toBe(p.colors.length);
      expect(isSurface(p.surface), p.id).toBe(true);
      expect(p.name.length, p.id).toBeLessThanOrEqual(14);
    }
    expect(getPalette("no such palette").id).toBe(DEFAULT_PALETTE);
    expect(getPalette(undefined).id).toBe(DEFAULT_PALETTE);
    expect(getPalette(PALETTES[3].id)).toBe(PALETTES[3]);
  });

  it("the melody's line can always be seen, and so can most of the paints", () => {
    for (const p of PALETTES) {
      expect(contrast(p.ink, p.ground), `${p.id} ink`).toBeGreaterThanOrEqual(4.5);
      expect(p.colors.filter((c) => contrast(c, p.ground) >= 1.6).length, `${p.id} paints`).toBeGreaterThanOrEqual(4);
    }
  });

  it("the paints have parts to play: the darkest is the weight at the bottom, the lightest the sparkle on top", () => {
    for (const p of PALETTES) {
      const r = roles(p);
      for (const c of [r.low, r.high, r.pop, r.second]) expect(p.colors, p.id).toContain(c);
      expect(luminance(r.low), p.id).toBeLessThanOrEqual(luminance(r.high));
      expect(r.dark, p.id).toBe(luminance(p.ground) < 0.2);
      // whatever plays the kick shows up against the canvas
      expect(contrast(r.low, p.ground), p.id).toBeGreaterThanOrEqual(1.6);
    }
    expect(PALETTES.some((p) => roles(p).dark)).toBe(true);
    expect(PALETTES.some((p) => !roles(p).dark)).toBe(true);
  });

  it("nothing is named after an artist, a band or a song", () => {
    const text = JSON.stringify(PALETTES.map((p) => [p.name, p.group, p.id])).toLowerCase();
    for (const name of ["monet", "gogh", "picasso", "rothko", "pollock", "matisse", "klimt", "hokusai", "mondrian", "kandinsky", "warhol", "zorn", "anderson", "radiohead", "cure", "emo"]) expect(text, name).not.toContain(name);
  });
});

describe("the surface under the paint", () => {
  it("three surfaces, each a relief between 0 and 1", () => {
    expect(SURFACES.map((s) => s.id)).toEqual(["canvas", "linen", "paper"]);
    for (const s of SURFACES) {
      let lo = 1;
      let hi = 0;
      for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 40; x++) {
          const h = surfaceHeight(s.id, x, y, 4);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThanOrEqual(1);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
      // it really does go up and down
      expect(hi - lo, s.id).toBeGreaterThan(0.35);
    }
    expect(isSurface("silk")).toBe(false);
  });

  it("lit, it is greys around middle grey: lighter and darker in equal measure, so it neither lightens nor darkens a painting overall", () => {
    for (const s of SURFACES) {
      const w = 96;
      const h = 64;
      const px = surfaceTexture(s.id, w, h, 4);
      expect(px.length).toBe(w * h * 4);
      let sum = 0;
      let sq = 0;
      for (let i = 0; i < px.length; i += 4) {
        expect(px[i]).toBe(px[i + 1]);
        expect(px[i]).toBe(px[i + 2]);
        expect(px[i + 3]).toBe(255);
        sum += px[i];
        sq += px[i] * px[i];
      }
      const mean = sum / (w * h);
      const sd = Math.sqrt(sq / (w * h) - mean * mean);
      expect(Math.abs(mean - 128), s.id).toBeLessThan(7);
      expect(sd, s.id).toBeGreaterThan(3);
      expect(sd, s.id).toBeLessThan(40);
    }
    // the same cloth every time; a different one for a different seed
    expect(surfaceTexture("canvas", 32, 32, 4, 0.5, 3)).toEqual(surfaceTexture("canvas", 32, 32, 4, 0.5, 3));
    expect(surfaceTexture("linen", 32, 32, 4, 0.5, 3)).not.toEqual(surfaceTexture("linen", 32, 32, 4, 0.5, 4));
    expect(surfaceTexture("canvas", 32, 32, 4)).not.toEqual(surfaceTexture("paper", 32, 32, 4));
  });

  it("canvas is woven: over one thread, under the next", () => {
    // along a row of thread centres, the tops alternate high and low
    const p = 6;
    const tops = Array.from({ length: 8 }, (_, i) => surfaceHeight("canvas", i * p + p / 2, p / 2, p));
    let alternates = 0;
    for (let i = 1; i < tops.length - 1; i++) if ((tops[i] - tops[i - 1]) * (tops[i + 1] - tops[i]) < 0) alternates++;
    expect(alternates).toBeGreaterThanOrEqual(5);
  });
});

// ── the marks, drawn on a canvas that only counts what is asked of it ──
class FakePath {
  moves = 0;
  lines = 0;
  moveTo() { this.moves++; }
  lineTo() { this.lines++; }
  quadraticCurveTo() { this.lines++; }
  closePath() {}
}
function fakeCanvas() {
  const calls: Record<string, number> = {};
  const xs: number[] = [];
  const note = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const g = {
    globalAlpha: 1, globalCompositeOperation: "source-over", fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "round",
    save: () => note("save"), restore: () => note("restore"), beginPath: () => note("beginPath"), closePath: () => {},
    moveTo: (x: number) => { note("moveTo"); xs.push(x); }, lineTo: (x: number) => { note("lineTo"); xs.push(x); }, quadraticCurveTo: () => note("curve"),
    arc: (x: number) => { note("arc"); xs.push(x); }, ellipse: (x: number) => { note("ellipse"); xs.push(x); },
    fill: () => note("fill"), stroke: (p?: FakePath) => { note("stroke"); if (p) note("strokePath"); }, translate: () => {}, fillRect: () => note("fillRect"),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };
  return { g: g as unknown as G, calls, xs };
}
(globalThis as { Path2D?: unknown }).Path2D = FakePath;
/** Run a mark to the end, a frame at a time; says how many frames it took (it must finish). */
function run(m: { step(dt: number): boolean }, dt = 16.7, max = 4000): number {
  for (let i = 1; i <= max; i++) if (m.step(dt)) return i;
  throw new Error("the mark never finished");
}

describe("the marks paint makes", () => {
  it("a blob's edge wanders but keeps its size; roughening an outline doubles its points", () => {
    const pts = blobPoints(100, 50, 20, 20, 0, rng(1), 0.2, 14);
    expect(pts).toHaveLength(28);
    for (let i = 0; i < pts.length; i += 2) {
      const d = Math.hypot(pts[i] - 100, pts[i + 1] - 50);
      expect(d).toBeGreaterThan(6);
      expect(d).toBeLessThan(40);
    }
    expect(blobPoints(100, 50, 20, 20, 0, rng(1), 0.2, 14)).toEqual(pts);
    expect(blobPoints(100, 50, 20, 20, 0, rng(2), 0.2, 14)).not.toEqual(pts);
    const rough = deform(pts, rng(4), 0.4);
    expect(rough).toHaveLength(56);
    // the old corners are still there, with a new point between each pair
    for (let i = 0; i < 14; i++) expect([rough[4 * i], rough[4 * i + 1]]).toEqual([pts[2 * i], pts[2 * i + 1]]);
    expect(deform(pts, rng(4), 0.4)).toEqual(rough);
    expect(deform(pts, rng(4), 0)[2]).toBeCloseTo((pts[0] + pts[2]) / 2);
  });

  it("a wash soaks in over its time, in exactly as many layers as asked", () => {
    const { g, calls } = fakeCanvas();
    const frames = run(wash(g, { x: 50, y: 50, rx: 30, ry: 20, color: [20, 40, 120], alpha: 0.04, layers: 24, ms: 500, r: rng(1), mode: "multiply" }));
    expect(calls.fill).toBe(24);
    expect(frames).toBeGreaterThan(20);
    expect(frames).toBeLessThan(40);
    expect(g.globalCompositeOperation).toBe("multiply");
    // a slow machine (long frames) still gets every layer
    const slow = fakeCanvas();
    expect(run(wash(slow.g, { x: 50, y: 50, rx: 30, ry: 20, color: [20, 40, 120], alpha: 0.04, layers: 24, ms: 500, r: rng(1), mode: "screen" }), 120)).toBeLessThan(7);
    expect(slow.calls.fill).toBe(24);
  });

  it("a brush stroke takes as long as it is given, and has many bristles", () => {
    const { g, calls } = fakeCanvas();
    const frames = run(stroke(g, { x: 10, y: 50, length: 300, angle: 0, width: 16, ms: 1000, color: [200, 30, 40], r: rng(2), dry: 0.2 }));
    expect(frames).toBeGreaterThanOrEqual(59);
    expect(frames).toBeLessThanOrEqual(61);
    // ten bristles or so, most of them drawing on most frames
    expect(calls.strokePath).toBeGreaterThan(frames * 5);
  });

  it("a dry brush leaves gaps; a wet one does not", () => {
    const gaps = (dry: number) => {
      const made: FakePath[] = [];
      (globalThis as { Path2D?: unknown }).Path2D = class extends FakePath { constructor() { super(); made.push(this); } };
      run(stroke(fakeCanvas().g, { x: 0, y: 0, length: 400, angle: 0, width: 14, ms: 400, color: [0, 0, 0], r: rng(9), dry }));
      (globalThis as { Path2D?: unknown }).Path2D = FakePath;
      // a path that lifts the brush and puts it down again has more than one start
      return made.reduce((a, p) => a + Math.max(0, p.moves - 1), 0);
    };
    expect(gaps(0)).toBe(0);
    expect(gaps(1)).toBeGreaterThan(25);
    expect(gaps(1)).toBeGreaterThan(gaps(0.5));
  });

  it("a stroke stops at the edge of the canvas", () => {
    const xs: number[] = [];
    (globalThis as { Path2D?: unknown }).Path2D = class extends FakePath { moveTo(x?: number) { super.moveTo(); if (x !== undefined) xs.push(x); } lineTo(x?: number) { super.lineTo(); if (x !== undefined) xs.push(x); } };
    run(stroke(fakeCanvas().g, { x: 100, y: 0, length: 900, angle: 0, width: 10, ms: 300, color: [0, 0, 0], r: rng(3), maxX: 500 }));
    (globalThis as { Path2D?: unknown }).Path2D = FakePath;
    expect(xs.length).toBeGreaterThan(50);
    expect(Math.max(...xs)).toBeLessThanOrEqual(500);
    expect(Math.min(...xs)).toBeGreaterThan(90);
  });

  it("a line of ink arrives where it is going", () => {
    const { g, calls, xs } = fakeCanvas();
    run(inkLine(g, { x0: 40, y0: 100, x1: 160, y1: 60, w0: 1, w1: 4, ms: 120, color: [10, 10, 10], r: rng(1) }));
    expect(xs[0]).toBeCloseTo(40);
    expect(xs[xs.length - 1]).toBeCloseTo(160);
    // each piece is drawn twice: the wet edge, then the line
    expect(calls.stroke).toBe(calls.beginPath * 2);
  });

  it("a splatter throws every drop it has, the near ones first", () => {
    const { g, calls } = fakeCanvas();
    run(splatter(g, { x: 200, y: 200, r: 10, color: [90, 30, 90], rng: rng(6), drops: 30, spread: 2 }));
    expect(calls.ellipse).toBe(30);
    // thrown one way, the drops land on that side
    const one = fakeCanvas();
    run(splatter(one.g, { x: 0, y: 0, r: 10, color: [0, 0, 0], rng: rng(6), drops: 60, spread: 2, dir: 0 }));
    const right = one.xs.filter((x) => x > 0).length;
    expect(right / one.xs.length).toBeGreaterThan(0.8);
  });

  it("a drip runs down, slows, and ends in a bead; a clap is three dabs", () => {
    const d = fakeCanvas();
    const frames = run(drip(d.g, { x: 50, y: 10, w: 2, length: 60, color: [0, 0, 0], rng: rng(2) }));
    expect(frames).toBeGreaterThan(100);
    expect(d.calls.fill).toBeGreaterThanOrEqual(1);
    const c = fakeCanvas();
    let made = 0;
    const frames2 = run(flam(3, 16, () => { made++; dab(c.g, { x: 0, y: 0, r: 6, color: [0, 0, 0], rng: rng(1) }); }));
    expect(made).toBe(3);
    expect(frames2).toBeGreaterThanOrEqual(2);
    const s = fakeCanvas();
    speckle(s.g, { x: 0, y: 0, n: 40, sx: 5, sy: 5, color: [0, 0, 0], rng: rng(1), size: 1 });
    expect(s.calls.arc).toBe(40);
  });
});

describe("hearing the song", () => {
  it("nothing is kept unless someone is listening", () => {
    dropPulses();
    pulse({ kind: "drum", time: 1, drum: "kick", velocity: 1 });
    expect(waiting()).toBe(0);
    const stop = listen();
    pulse({ kind: "drum", time: 1, drum: "kick", velocity: 1 });
    expect(waiting()).toBe(1);
    stop();
    expect(waiting()).toBe(0);
    stop(); // twice is harmless
  });

  it("each sound is handed over once, when its moment has come, the earliest first", () => {
    const stop = listen();
    pulse({ kind: "chord", time: 2.0, midi: 60, velocity: 0.8, length: 1 });
    pulse({ kind: "drum", time: 1.0, drum: "snare", velocity: 1 });
    pulse({ kind: "melody", time: 1.5, midi: 72, velocity: 0.9, length: 8 });
    pulse({ kind: "drum", time: 3.0, drum: "hat", velocity: 0.5 });
    expect(due(0.5)).toEqual([]);
    expect(due(2.0).map((p) => p.time)).toEqual([1.0, 1.5, 2.0]);
    expect(due(2.0)).toEqual([]);
    expect(waiting()).toBe(1);
    // playing stopped: what had not sounded yet never will
    dropPulses();
    expect(due(99)).toEqual([]);
    stop();
  });

  it("two listeners: the song is still collected until both have left", () => {
    const a = listen();
    const b = listen();
    a();
    pulse({ kind: "drum", time: 1, drum: "kick", velocity: 1 });
    expect(waiting()).toBe(1);
    b();
    expect(waiting()).toBe(0);
  });
});
