import { describe, expect, it } from "vitest";
import { dropPulses, due, listen, pulse, waiting } from "../audio/pulse";
import { contrast, hexToRgb, hslToRgb, isHex, luminance, mix, rgbToHsl, shade, vary } from "./color";
import { BANDS, F_HI, F_LO, bandHz, plainTone, type Sound } from "../audio/describe";
import type { DrumPulse, NotePulse } from "../audio/pulse";
import { BOTTOM, MARGIN, REGIONS, RULER_HZ, SCALE, TOP, colorIndex, hzLabel, hzOfMidi, hzOfY, maxBars, midiOfHz, noteColors, pageOf, spanPx, speed, upOfHz, xOf, yOfHz, type Spot } from "./layout";
import { BRUSHES, CLOUDS, TOUCHES, backrun, blobPoints, cloud, dab, deform, drip, flam, later, paintPath, reach, speckle, splatter, straight, stroke, tooth, touch, wash, type G, type Pt } from "./marks";
import { ANGULAR, FADES, HIGH_DAB, LOW_DAB, MID_DAB, Painter, STEM_IDS, TAPER, TUNE_DAB, habits, left, tilt } from "./painter";
import { DEFAULT_PALETTE, PALETTES, PALETTE_GROUPS, getPalette, roles, trio } from "./palettes";
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

  it("up is higher in frequency: the bottom of the scale at the bottom, the top at the top", () => {
    expect(yOfHz(F_LO, 600)).toBeCloseTo(BOTTOM * 600);
    expect(yOfHz(F_HI, 600)).toBeCloseTo(TOP * 600);
    // off the scale is kept at its ends
    expect(yOfHz(5, 600)).toBeCloseTo(BOTTOM * 600);
    expect(yOfHz(40000, 600)).toBeCloseTo(TOP * 600);
    let last = Infinity;
    for (let hz = F_LO; hz <= F_HI; hz *= 1.03) {
      const y = yOfHz(hz, 600);
      expect(y).toBeLessThan(last);
      last = y;
      // and back again
      expect(hzOfY(y, 600) / hz).toBeCloseTo(1, 6);
    }
    // every note of the instrument is higher than the one below it
    for (let m = 29; m < 100; m++) expect(yOfHz(hzOfMidi(m + 1), 600)).toBeLessThan(yOfHz(hzOfMidi(m), 600));
    expect(hzOfMidi(69)).toBeCloseTo(440);
    expect(hzOfMidi(57)).toBeCloseTo(220);
    expect(midiOfHz(hzOfMidi(52.4))).toBeCloseTo(52.4);
  });

  it("an octave is a fixed step, and the octaves the notes live in get the biggest steps", () => {
    // the marks of the scale run upwards in frequency and in height, from one end to the other
    expect(SCALE[0]).toEqual([F_LO, 0]);
    expect(SCALE[SCALE.length - 1]).toEqual([F_HI, 1]);
    for (let i = 1; i < SCALE.length; i++) {
      expect(SCALE[i][0]).toBeGreaterThan(SCALE[i - 1][0]);
      expect(SCALE[i][1]).toBeGreaterThan(SCALE[i - 1][1]);
    }
    // inside the range of the notes every octave is the same height…
    const oct = (hz: number) => yOfHz(hz, 600) - yOfHz(hz * 2, 600);
    expect(oct(82.4)).toBeCloseTo(oct(220), 6);
    expect(oct(220)).toBeCloseTo(oct(640), 6);
    // …and taller than an octave of rumble or of hiss
    expect(oct(220)).toBeGreaterThan(oct(35) * 1.3);
    expect(oct(220)).toBeGreaterThan(oct(6000) * 1.3);
    // a semitone there is wide enough to see, even on a phone
    expect(spanPx(220, 1 / 12, 440)).toBeGreaterThan(4);
    expect(spanPx(220, 1, 600)).toBeCloseTo(oct(220 / Math.SQRT2), 6);
    expect(upOfHz(80)).toBeCloseTo(0.095);
    expect(upOfHz(1280)).toBeCloseTo(0.675);
  });

  it("the ruler and the regions of a mix cover the scale", () => {
    for (const hz of RULER_HZ) {
      expect(hz).toBeGreaterThan(F_LO);
      expect(hz).toBeLessThan(F_HI);
    }
    expect(RULER_HZ.map(hzLabel)).toEqual(["50", "100", "200", "500", "1k", "2k", "5k", "10k"]);
    // the regions follow one another with no gap, from the bottom of the scale to the top
    expect(REGIONS[0].from).toBe(F_LO);
    expect(REGIONS[REGIONS.length - 1].to).toBe(F_HI);
    for (let i = 1; i < REGIONS.length; i++) expect(REGIONS[i].from).toBe(REGIONS[i - 1].to);
    expect(REGIONS.map((r) => r.name)).toEqual(["Sub", "Bass", "Low mids", "Mids", "High mids", "Air"]);
    // each is tall enough, even on a phone, for its name to be written in it
    for (const r of REGIONS) expect(yOfHz(r.from, 420) - yOfHz(r.to, 420), r.name).toBeGreaterThan(r.short.length * 6 + 6);
    for (const r of REGIONS) expect(r.short.length).toBeLessThanOrEqual(6);
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

// ── the marks, drawn on a canvas that only notes what is asked of it, and where ──
class FakePath {
  moves = 0;
  lines = 0;
  pts: [number, number][] = [];
  moveTo(x?: number, y?: number) { this.moves++; if (x !== undefined) this.pts.push([x, y ?? 0]); }
  lineTo(x?: number, y?: number) { this.lines++; if (x !== undefined) this.pts.push([x, y ?? 0]); }
  quadraticCurveTo(_cx?: number, _cy?: number, x?: number, y?: number) { this.lines++; if (x !== undefined) this.pts.push([x, y ?? 0]); }
  closePath() {}
}
function fakeCanvas() {
  const calls: Record<string, number> = {};
  const xs: number[] = [];
  /** every place something was drawn, as [x, y] */
  const at: [number, number][] = [];
  /** how each fill was laid over what was there */
  const modes: string[] = [];
  /** every rectangle filled: [x, y, w, h, how, how strongly] */
  const rects: [number, number, number, number, string, number][] = [];
  const note = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const put = (x: number, y: number) => { xs.push(x); at.push([x, y]); };
  const gradient = () => ({ addColorStop: () => {} });
  const g = {
    globalAlpha: 1, globalCompositeOperation: "source-over", fillStyle: "" as unknown, strokeStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "round",
    save: () => note("save"), restore: () => note("restore"), beginPath: () => note("beginPath"), closePath: () => {},
    moveTo: (x: number, y: number) => { note("moveTo"); put(x, y); }, lineTo: (x: number, y: number) => { note("lineTo"); put(x, y); },
    quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) => { note("curve"); put(x, y); },
    arc: (x: number, y: number) => { note("arc"); put(x, y); }, ellipse: (x: number, y: number) => { note("ellipse"); put(x, y); },
    fill: (p?: FakePath) => { note("fill"); modes.push(g.globalCompositeOperation); if (p) for (const q of p.pts) at.push(q); },
    stroke: (p?: FakePath) => { note("stroke"); if (p) { note("strokePath"); for (const q of p.pts) at.push(q); } },
    clip: () => note("clip"), translate: () => {}, rotate: () => {}, setTransform: () => {}, clearRect: () => note("clearRect"), drawImage: () => note("drawImage"),
    fillRect: (x: number, y: number, w: number, h: number) => { note("fillRect"); rects.push([x, y, w, h, g.globalCompositeOperation, g.globalAlpha]); },
    createRadialGradient: gradient, createLinearGradient: gradient,
  };
  return { g: g as unknown as G, calls, xs, at, modes, rects };
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
    const first = fakeCanvas();
    const frames = run(wash(first.g, { x: 50, y: 50, rx: 30, ry: 20, color: [20, 40, 120], alpha: 0.04, layers: 24, ms: 500, r: rng(1), mode: "multiply" }));
    void g;
    void calls;
    expect(first.calls.fill).toBe(24);
    expect(frames).toBeGreaterThan(20);
    expect(frames).toBeLessThan(40);
    expect(first.modes.every((m) => m === "multiply")).toBe(true);
    // when it has dried: a darker line inside its edge, and grains of pigment in the hollows of the surface
    expect(first.calls.clip).toBe(1);
    expect(first.calls.strokePath).toBe(2);
    expect(first.calls.fillRect).toBeGreaterThan(3);
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

  it("a hand sets off slowly, is fastest in the middle and slows to a stop", () => {
    expect(reach(0)).toBe(0);
    expect(reach(1)).toBe(1);
    expect(reach(0.5)).toBeCloseTo(0.5);
    expect(reach(-1)).toBe(0);
    expect(reach(2)).toBe(1);
    // the first tenth of the time covers far less than a tenth of the way; the middle tenth covers far more
    expect(reach(0.1)).toBeLessThan(0.01);
    expect(reach(0.55) - reach(0.45)).toBeGreaterThan(0.18);
    for (let t = 0; t < 1; t += 0.05) expect(reach(t + 0.05)).toBeGreaterThan(reach(t));
  });

  it("there is a big library: every brush, every touch and every way of throwing paint makes a mark", () => {
    expect(BRUSHES.length).toBeGreaterThanOrEqual(20);
    expect(TOUCHES.length).toBeGreaterThanOrEqual(28);
    expect(CLOUDS.length).toBeGreaterThanOrEqual(9);
    expect(new Set(BRUSHES).size).toBe(BRUSHES.length);
    expect(new Set(TOUCHES).size).toBe(TOUCHES.length);
    expect(new Set(CLOUDS).size).toBe(CLOUDS.length);
    const drawn = (c: ReturnType<typeof fakeCanvas>) => (c.calls.fill ?? 0) + (c.calls.stroke ?? 0) + (c.calls.fillRect ?? 0);
    const path: Pt[] = Array.from({ length: 120 }, (_, i) => ({ x: 20 + i * 2.5, y: 100 - 20 * Math.sin(i / 40), w: 1, a: 1 - i / 160 }));
    for (const brush of BRUSHES) {
      const c = fakeCanvas();
      const frames = run(paintPath(c.g, path, { brush, width: 12, color: [150, 40, 60], second: [40, 60, 150], r: rng(5), ms: 300 }));
      // a hand's stroke: done in about the time it was given
      expect(frames).toBeGreaterThanOrEqual(17);
      expect(frames).toBeLessThanOrEqual(19);
      expect(drawn(c), brush).toBeGreaterThan(5);
      // and it stays on its path: nothing far above or below it, nothing before its start or after its end
      for (const [x, y] of c.at) {
        expect(x, brush).toBeGreaterThan(-5);
        expect(x, brush).toBeLessThan(345);
        expect(y, brush).toBeGreaterThan(40);
        expect(y, brush).toBeLessThan(140);
      }
    }
    for (const kind of TOUCHES) {
      const c = fakeCanvas();
      touch(c.g, kind, { x: 200, y: 100, r: 8, color: [10, 90, 60], rng: rng(3), long: 1.5 });
      expect(drawn(c), kind).toBeGreaterThan(0);
    }
    for (const kind of CLOUDS) {
      const c = fakeCanvas();
      cloud(c.g, kind, { x: 200, y: 100, rx: 10, ry: 30, n: 40, color: [0, 0, 0], rng: rng(3), size: 1.5 });
      expect(drawn(c), kind).toBeGreaterThan(0);
      // thrown where it was aimed: nearly all of it within reach of the spot
      const near = c.at.filter(([x, y]) => Math.abs(x - 200) < 40 && Math.abs(y - 100) < 80).length;
      expect(near / c.at.length, kind).toBeGreaterThan(0.9);
    }
  });

  it("a path is painted once, a piece at a time, and never gone back over", () => {
    // each point of the path is reached once: the brush is never ahead of where the hand has got to
    const path = straight(10, 50, 200, 0, rng(1));
    expect(path[0].x).toBeCloseTo(10);
    expect(path[path.length - 1].x).toBeCloseTo(210);
    // pressed down at the start, lifted at the end
    expect(path[0].w).toBeLessThan(0.5);
    expect(path[Math.floor(path.length / 2)].w).toBe(1);
    expect(path[path.length - 1].w).toBeLessThan(0.6);
    const c = fakeCanvas();
    const m = paintPath(c.g, path, { brush: "liner", width: 1.2, color: [0, 0, 0], r: rng(2), ms: 400 });
    let far = -Infinity;
    for (let i = 0; i < 40; i++) {
      const before = c.xs.length;
      const done = m.step(16);
      const fresh = c.xs.slice(before);
      if (fresh.length) {
        // what this moment added starts where the last one stopped
        expect(Math.min(...fresh)).toBeGreaterThanOrEqual(far - 3);
        far = Math.max(far, ...fresh);
      }
      if (done) break;
    }
    expect(far).toBeCloseTo(210, 0);
    // an empty path is no mark at all
    expect(paintPath(c.g, [], { brush: "wash", width: 4, color: [0, 0, 0], r: rng(1), ms: 100 }).step(1)).toBe(true);
  });

  it("the surface has a grain that stays put, so dry strokes that cross break in the same places", () => {
    for (let i = 0; i < 200; i++) {
      const x = (i * 37.3) % 500;
      const y = (i * 91.7) % 400;
      const t = tooth(x, y);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
      expect(tooth(x, y)).toBe(t);
    }
    // it is not flat
    const some = Array.from({ length: 400 }, (_, i) => tooth(i * 3.1, i * 1.7));
    expect(Math.max(...some) - Math.min(...some)).toBeGreaterThan(0.6);
  });

  it("a mark can be made to wait; a backrun takes paint off and leaves a broken line round the place", () => {
    let made = 0;
    const m = later(100, () => { made++; });
    expect(m.step(50)).toBe(false);
    expect(made).toBe(0);
    expect(m.step(60)).toBe(true);
    expect(made).toBe(1);
    const c = fakeCanvas();
    const frames = run(backrun(c.g, { x: 100, y: 100, r: 20, color: [80, 40, 20], rng: rng(4) }));
    expect(frames).toBeGreaterThan(30);
    expect(c.modes.filter((x) => x === "destination-out").length).toBe(4);
    expect(c.calls.stroke).toBeGreaterThan(8);
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

/** A sound made to measure: one tone (or band of noise), ringing so long. */
const tone = (hz: number, ring: number, more: Partial<Sound["parts"][number]> = {}): Sound => ({ ...plainTone(hz, ring), attack: 1, parts: [{ hz, width: 0.05, gain: 1, ring, noise: 0, glide: 0, ...more }] });
const drumHit = (time: number, drum: DrumPulse["drum"], velocity = 1, sound: Sound = tone(80, 0.12)): DrumPulse => ({ kind: "drum", time, drum, velocity, gain: 1, sound });
const noteHit = (kind: NotePulse["kind"], time: number, midi: number, length: number, more: Partial<NotePulse> = {}): NotePulse => ({ kind, time, midi, velocity: 0.8, length, slot: 0, gain: 0.8, cutoff: 12000, octave: 0, sound: tone(hzOfMidi(midi), 3), ...more });

describe("hearing the song", () => {
  it("nothing is kept unless someone is listening", () => {
    dropPulses();
    pulse(drumHit(1, "kick"));
    expect(waiting()).toBe(0);
    const stop = listen();
    pulse(drumHit(1, "kick"));
    expect(waiting()).toBe(1);
    stop();
    expect(waiting()).toBe(0);
    stop(); // twice is harmless
  });

  it("each sound is handed over once, when its moment has come, the earliest first", () => {
    const stop = listen();
    pulse(noteHit("chord", 2.0, 60, 1));
    pulse(drumHit(1.0, "snare"));
    pulse(noteHit("melody", 1.5, 72, 8));
    pulse(drumHit(3.0, "hat", 0.5));
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
    pulse(drumHit(1, "kick"));
    expect(waiting()).toBe(1);
    b();
    expect(waiting()).toBe(0);
  });
});

// ── the painter, on canvases that only note what is asked of them ──
/** A painter 1000 by 600, and everything its canvases were asked to draw. */
function studio(keep = 0.74, seed = 11) {
  const made: (ReturnType<typeof fakeCanvas> & { className: string })[] = [];
  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      const c = fakeCanvas();
      const el = { width: 0, height: 0, className: "", style: {} as Record<string, string>, dataset: {} as Record<string, string>, getContext: () => c.g, remove: () => {} };
      const rec = Object.assign(c, { className: "" });
      Object.defineProperty(rec, "className", { get: () => el.className });
      made.push(rec);
      return el;
    },
  };
  const host = { appendChild: () => {}, insertBefore: () => {} } as unknown as HTMLElement;
  const p = new Painter(host, getPalette(DEFAULT_PALETTE), keep, seed);
  p.size(1000, 600, 1);
  const wet = made[0];
  /** the canvas that holds the dry paint of a section (made when the section is first seen) */
  const dry = (n = 1) => made.filter((c) => c.className === "cv-layer")[n - 1];
  return { p, wet, dry, made };
}
/** Four bars of four beats at half a second each: eight seconds across the canvas. */
const where = (beat: number, key = "A"): Spot => ({ key, index: 0, beat, bar: 4, bars: 4, spb: 0.5 });
const SPEED = (1000 * (1 - 2 * MARGIN)) / 8;
/** Let every mark that is being made finish; says how long it took (milliseconds). */
function settle(p: Painter): number {
  let ms = 0;
  for (; ms < 20000 && p.busy(); ms += 16) p.frame(16);
  return ms;
}

describe("the painter: what is heard is what is painted", () => {
  it("how much of a sound is left, and the tilt of the guide", () => {
    expect(left(0, 2)).toBe(1);
    // rung out: 30 dB down
    expect(left(2, 2)).toBeCloseTo(Math.pow(10, -1.5));
    expect(left(1, 2)).toBeGreaterThan(left(1.5, 2));
    expect(left(-1, 2)).toBe(1);
    // the guide is level at 1 kHz and tips up 1.5 dB for every octave above it
    const at = (hz: number) => tilt(Math.round(Math.log2(hz / F_LO) * 6 - 0.5));
    expect(Math.abs(at(1000))).toBeLessThan(0.3);
    expect(at(4000) - at(1000)).toBeCloseTo(3, 0);
    expect(at(125) - at(1000)).toBeCloseTo(-4.5, 0);
  });

  it("every section has its own hand, and keeps it", () => {
    const a = habits("A", 5);
    expect(habits("A", 5)).toEqual(a);
    const all = ["A", "B", "C", "D", "E", "F", "G", "H"].map((k) => JSON.stringify(habits(k, 5)));
    expect(new Set(all).size).toBeGreaterThanOrEqual(7);
    // a habit is always something with body
    for (const k of ["A", "B", "C", "D", "E", "F"]) {
      const h = habits(k, 9);
      expect(LOW_DAB).toContain(h.dabLow);
      expect(MID_DAB).toContain(h.dabMid);
      expect(HIGH_DAB).toContain(h.dabHigh);
      expect(TUNE_DAB).toContain(h.dabTune);
      expect(Math.abs(h.lean)).toBeLessThan(0.06);
    }
    for (const t of TAPER) expect(TOUCHES).toContain(t);
    for (const t of ANGULAR) expect(TOUCHES).toContain(t);
  });

  it("a note is painted at the height of its own frequency: higher notes higher up", () => {
    const heights = [40, 52, 64, 76, 88].map((midi) => {
      const { p, wet } = studio();
      p.at(where(4));
      p.hit(noteHit("chord", 2, midi, 0.1));
      settle(p);
      const ys = wet.at.map(([, y]) => y).filter(Number.isFinite);
      const mid = ys.sort((a, b) => a - b)[Math.floor(ys.length / 2)];
      // within a tone or so of where its frequency is on the scale
      expect(Math.abs(mid - yOfHz(hzOfMidi(midi), 600))).toBeLessThan(spanPx(hzOfMidi(midi), 3 / 12, 600));
      return mid;
    });
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeLessThan(heights[i - 1]);
  });

  it("a short note is a touch, a longer one a shape with a taper, a held one a stroke as long as the note", () => {
    const paint = (length: number, ring = 3) => {
      const { p, wet } = studio();
      p.at(where(4));
      p.hit(noteHit("chord", 2, 64, length, { sound: tone(hzOfMidi(64), ring) }));
      const kind = p.last;
      settle(p);
      const xs = wet.at.map(([x]) => x);
      return { kind, from: Math.min(...xs), to: Math.max(...xs) };
    };
    const x0 = xOf(0.25, 1000);
    expect(paint(0.05).kind).toMatch(/^chord touch /);
    expect(paint(0.3).kind).toMatch(/^chord taper /);
    const held = paint(1.5);
    expect(held.kind).toMatch(/^chord stroke /);
    // it starts where the note starts and is as long as the note is: a second and a half at this speed
    expect(Math.abs(held.from - x0)).toBeLessThan(14);
    expect(Math.abs(held.to - (x0 + 1.5 * SPEED))).toBeLessThan(16);
    // a note left to ring is as long as it can be heard for, not as long as the hand stays down
    const rung = paint(6, 1);
    expect(rung.kind).toMatch(/^chord stroke /);
    expect(Math.abs(rung.to - (x0 + 0.7 * SPEED))).toBeLessThan(16);
    // a taper is as long as its note, too: longer than a touch, shorter than a held stroke
    expect(paint(0.3).to - x0).toBeGreaterThan(paint(0.05).to - x0);
    expect(paint(0.3).to - x0).toBeLessThan(0.3 * SPEED + 30);
  });

  it("a note that takes over from another on its string carries the stroke on: up to a higher note, down to a lower one", () => {
    const slur = (from: number, to: number) => {
      const { p, wet } = studio();
      p.at(where(4));
      p.hit(noteHit("melody", 2, from, 0.5, { slot: 48 }));
      settle(p);
      const before = wet.at.length;
      p.at(where(5));
      p.hit(noteHit("melody", 2.5, to, 0.5, { slot: 48 }));
      const kind = p.last;
      settle(p);
      const pts = wet.at.slice(before).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      const first = pts.reduce((a, q) => (q[0] < a[0] ? q : a));
      const end = pts.reduce((a, q) => (q[0] > a[0] ? q : a));
      return { kind, first, end };
    };
    const up = slur(60, 67);
    expect(up.kind).toMatch(/^melody slur /);
    // it sets off at the height of the note before and arrives at its own
    expect(Math.abs(up.first[1] - yOfHz(hzOfMidi(60), 600))).toBeLessThan(12);
    expect(Math.abs(up.end[1] - yOfHz(hzOfMidi(67), 600))).toBeLessThan(12);
    expect(up.end[1]).toBeLessThan(up.first[1]);
    // and it starts a little before the new note, where the old one was ending
    expect(up.first[0]).toBeLessThan(xOf(5 / 16, 1000));
    const down = slur(67, 60);
    expect(down.kind).toMatch(/^melody slur /);
    expect(down.end[1]).toBeGreaterThan(down.first[1]);
    // a note after a silence does not: it is a mark of its own
    const { p } = studio();
    p.at(where(4));
    p.hit(noteHit("melody", 2, 60, 0.2, { slot: 48 }));
    p.at(where(6));
    p.hit(noteHit("melody", 3, 67, 1, { slot: 48 }));
    expect(p.last).toMatch(/^melody stroke /);
    // nor does the same note played again
    p.at(where(8));
    p.hit(noteHit("melody", 4, 67, 1, { slot: 48 }));
    expect(p.last).not.toMatch(/slur/);
  });

  it("a stroke is made in one quick movement: nothing creeps across the canvas with the music", () => {
    const { p, wet } = studio();
    p.at(where(0));
    // a note held for three seconds: at the speed of the music its stroke would take three seconds to draw
    p.hit(noteHit("chord", 0, 64, 3, { sound: tone(hzOfMidi(64), 6) }));
    let ms = 0;
    let reached = 0;
    const end = xOf(0, 1000) + 3 * SPEED;
    for (; ms < 3000; ms += 16) {
      p.frame(16);
      reached = Math.max(reached, ...wet.at.map(([x]) => x).filter(Number.isFinite));
      if (reached > end - 12) break;
    }
    // the whole stroke is there in well under a second
    expect(ms).toBeLessThan(800);
    expect(ms).toBeGreaterThan(80);
  });

  it("a drum is painted from what it is made of: each part at its own height, as tall as it is wide", () => {
    const { p, wet } = studio();
    p.at(where(4));
    // a thump at 60 Hz
    p.hit(drumHit(2, "kick", 1, tone(60, 0.12)));
    expect(p.last).toMatch(/^drum kick /);
    settle(p);
    const low = wet.at.map(([, y]) => y).filter(Number.isFinite);
    const lowMid = low.sort((a, b) => a - b)[Math.floor(low.length / 2)];
    expect(Math.abs(lowMid - yOfHz(60, 600))).toBeLessThan(30);
    // a burst of hiss round 9 kHz, an octave wide
    const before = wet.at.length;
    p.at(where(8));
    p.hit(drumHit(4, "hat", 0.8, tone(9000, 0.04, { noise: 1, width: 1 })));
    settle(p);
    const ys = wet.at.slice(before).map(([, y]) => y).filter(Number.isFinite);
    const top = yOfHz(9000 * Math.SQRT2, 600);
    const bottom = yOfHz(9000 / Math.SQRT2, 600);
    // nearly all of it inside the octave it covers, and spread over most of that octave
    expect(ys.filter((y) => y > top - 8 && y < bottom + 8).length / ys.length).toBeGreaterThan(0.85);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan((bottom - top) * 0.4);
    // far above the thump
    expect(Math.max(...ys)).toBeLessThan(lowMid - 200);
  });

  it("a noise that lasts is dragged for as long as it lasts; a ringing drum is a stroke", () => {
    const { p, wet } = studio();
    p.at(where(4));
    p.hit(drumHit(2, "open", 0.9, tone(8000, 0.8, { noise: 1, width: 0.8 })));
    settle(p);
    const xs = wet.at.map(([x]) => x).filter(Number.isFinite);
    const x0 = xOf(0.25, 1000);
    // 0.8 s of ring: about 0.6 s of it is painted
    expect(Math.max(...xs) - x0).toBeGreaterThan(0.45 * SPEED);
    expect(Math.max(...xs) - x0).toBeLessThan(0.75 * SPEED);
    // a long boom
    const b = studio();
    b.p.at(where(4));
    b.p.hit(drumHit(2, "kick", 1, tone(50, 0.9)));
    settle(b.p);
    const bx = b.wet.at.map(([x]) => x).filter(Number.isFinite);
    expect(Math.max(...bx) - x0).toBeGreaterThan(0.5 * SPEED);
  });

  it("the same strum is made the same way: its notes are one gesture", () => {
    const { p } = studio();
    p.at(where(4));
    const kinds = [60, 64, 67, 71].map((m, i) => {
      p.hit(noteHit("chord", 2 + i * 0.01, m, 0.05, { slot: i }));
      return p.last;
    });
    expect(new Set(kinds).size).toBe(1);
    // over a long run the hand does change its mind now and then, but not every time
    const { p: q } = studio(0.74, 3);
    const seen: string[] = [];
    for (let i = 0; i < 80; i++) {
      q.at(where((i % 16) + 0.01));
      q.hit(noteHit("chord", 10 + i * 0.5, 64, 0.05));
      seen.push(q.last);
    }
    const changes = seen.filter((k, i) => i > 0 && k !== seen[i - 1]).length;
    expect(new Set(seen).size).toBeGreaterThan(1);
    expect(changes).toBeLessThan(30);
  });

  it("each section, and each of a long section's canvases, is its own painting", () => {
    const { p } = studio();
    p.at(where(0, "A"));
    p.hit(drumHit(0, "kick"));
    expect(p.keys()).toEqual(["A:0"]);
    expect(p.showing()).toBe("A:0");
    p.at(where(0, "B"));
    expect(p.showing()).toBe("B:0");
    expect(p.keys()).toEqual(["A:0", "B:0"]);
    // sixteen bars: two canvases of eight
    p.at({ key: "C", index: 2, beat: 40, bar: 4, bars: 16, spb: 0.5 });
    expect(p.showing()).toBe("C:1");
    p.clear();
    expect(p.keys()).toEqual([]);
    expect(p.made).toBe(0);
  });

  it("when a section comes round again the old paint fades all over at once: nothing sweeps across", () => {
    const { p, dry } = studio(FADES[1].keep);
    p.at(where(0));
    p.hit(noteHit("chord", 0, 60, 1));
    p.at(where(15.9));
    settle(p);
    const layer = dry();
    expect(layer.rects.filter((r) => r[4] === "destination-out")).toHaveLength(0);
    // round again
    p.at(where(0.01));
    for (let i = 0; i < 80; i++) p.frame(16);
    const fades = layer.rects.filter((r) => r[4] === "destination-out");
    expect(fades).toHaveLength(7);
    // every step covers the whole canvas
    for (const [x, y, w, h] of fades) expect([x, y, w, h]).toEqual([0, 0, 1000, 600]);
    // and together they leave just as much as is asked for
    expect(fades.reduce((a, r) => a * (1 - r[5]), 1)).toBeCloseTo(FADES[1].keep);
    // the pass's own paint lies on another sheet, so it does not fade with the old
    expect(layer.calls.drawImage).toBe(1);
    // old paint that is kept does not fade at all
    const k = studio(FADES[0].keep);
    k.p.at(where(0));
    k.p.hit(noteHit("chord", 0, 60, 1));
    k.p.at(where(15.9));
    k.p.at(where(0.01));
    for (let i = 0; i < 80; i++) k.p.frame(16);
    expect(k.dry().rects.filter((r) => r[4] === "destination-out")).toHaveLength(0);
  });

  it("only the bars that are played again fade", () => {
    const { p, dry } = studio(FADES[2].keep);
    // the second bar, looped
    p.at(where(4));
    p.hit(noteHit("chord", 2, 60, 0.4));
    p.at(where(7.9));
    p.at(where(4));
    for (let i = 0; i < 80; i++) p.frame(16);
    const fades = dry().rects.filter((r) => r[4] === "destination-out");
    expect(fades).toHaveLength(7);
    for (const [x, , w] of fades) {
      // from about the start of the second bar to about its end (with soft edges), not the whole canvas
      expect(x).toBeGreaterThan(xOf(0.25, 1000) - 60);
      expect(x + w).toBeLessThan(xOf(0.5, 1000) + 90);
    }
  });

  it("what the mix covers: the band that is sounding shows, and the parts of the mix share it out", () => {
    const { p } = studio();
    const levels = { chords: new Float32Array(BANDS), melody: new Float32Array(BANDS), drums: new Float32Array(BANDS) };
    const at = (hz: number) => Math.round(Math.log2(hz / F_LO) * 6 - 0.5);
    levels.chords[at(220)] = 0.02;
    levels.melody[at(880)] = 0.01;
    levels.drums[at(220)] = 0.02;
    levels.drums[at(60)] = 0.05;
    for (let i = 0; i < 400; i++) p.mix(levels, 16);
    const { level, share } = p.coverage();
    expect(level).toHaveLength(BANDS);
    expect(Math.max(...level)).toBeCloseTo(1);
    for (const hz of [60, 220, 880]) expect(level[at(hz)]).toBeGreaterThan(0.8);
    // nothing where nothing sounds
    expect(level[at(3000)]).toBe(0);
    expect(level[at(120)]).toBe(0);
    // at 220 Hz the chords and the drums are as strong as each other; at 880 it is all melody
    expect(share.chords[at(220)]).toBeCloseTo(0.5);
    expect(share.drums[at(220)]).toBeCloseTo(0.5);
    expect(share.melody[at(880)]).toBeCloseTo(1);
    for (let b = 0; b < BANDS; b++) {
      const sum = STEM_IDS.reduce((a, s) => a + share[s][b], 0);
      expect(sum === 0 || Math.abs(sum - 1) < 1e-5).toBe(true);
    }
    expect(bandHz(at(220))).toBeGreaterThan(190);
    expect(bandHz(at(220))).toBeLessThan(250);
  });

  it("what goes on sounding leaves a fine grain where it sounds, behind the music, never along a line", () => {
    const { p, wet } = studio();
    p.at(where(8));
    p.hit(noteHit("chord", 4, 57, 2));
    settle(p);
    const before = wet.at.length;
    const levels = { chords: new Float32Array(BANDS) };
    const band = Math.round(Math.log2(220 / F_LO) * 6 - 0.5);
    levels.chords[band] = 0.05;
    for (let i = 0; i < 300; i++) p.mix(levels, 16);
    const grains = wet.at.slice(before);
    expect(grains.length).toBeGreaterThan(40);
    const x = xOf(0.5, 1000);
    // all of it at or behind where the music is, spread over a stretch (not on one line)
    for (const [gx] of grains) expect(gx).toBeLessThan(x + 12);
    const gxs = grains.map(([gx]) => gx);
    expect(Math.max(...gxs) - Math.min(...gxs)).toBeGreaterThan(15);
    // and at the height of the band that is sounding
    const y = yOfHz(220, 600);
    expect(grains.filter(([, gy]) => Math.abs(gy - y) < 25).length / grains.length).toBeGreaterThan(0.9);
    // silence leaves nothing
    const quiet = studio();
    quiet.p.at(where(8));
    quiet.p.hit(noteHit("chord", 4, 57, 0.05));
    settle(quiet.p);
    const n = quiet.wet.at.length;
    for (let i = 0; i < 300; i++) quiet.p.mix({ chords: new Float32Array(BANDS) }, 16);
    expect(quiet.wet.at.length).toBe(n);
  });
});

describe("the guide's three colours", () => {
  it("chords, melody and drums can be told apart on every colour scheme", () => {
    const apart = (a: string, b: string) => Math.hypot(...hexToRgb(a).map((v, i) => v - hexToRgb(b)[i]));
    for (const p of PALETTES) {
      const t = trio(p);
      expect(t.drums).toBe(p.ink);
      expect(p.colors).toContain(t.chords);
      expect(p.colors).toContain(t.melody);
      expect(apart(t.chords, t.melody), p.id).toBeGreaterThan(50);
      expect(apart(t.chords, t.drums), p.id).toBeGreaterThan(50);
      expect(apart(t.melody, t.drums), p.id).toBeGreaterThan(50);
      expect(apart(t.melody, p.ground), p.id).toBeGreaterThan(50);
    }
  });
});
