import { describe, expect, it } from "vitest";
import { contrast, hexToRgb, hslToRgb, isHex, luminance, mix, rgbToHsl, shade, vary } from "./color";
import { F_HI, F_LO } from "../audio/describe";
import { BOTTOM, MARGIN, REGIONS, RULER_HZ, SCALE, TOP, colorIndex, hzLabel, hzOfMidi, hzOfY, maxBars, midiOfHz, noteColors, pageOf, spanPx, speed, upOfHz, xOf, yOfHz, type Spot } from "./layout";
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
