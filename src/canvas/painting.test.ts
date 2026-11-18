import { describe, expect, it } from "vitest";
import { Ear, type Frame } from "../listen/ear";
import { Mood, keyOf } from "../listen/mood";
import { Reader, loudest, toMono } from "../listen/songfile";
import { Cover, STEM_IDS } from "./cover";
import { Hand, type Manner } from "./hand";
import { MARGIN, yOfHz } from "./layout";
import { FADES, mannerOf } from "./painting";
import { getPalette } from "./palettes";
import { ksOf, mixPaint, paintOf, reflOf, toLinear, toScreen, type Stamp } from "./sim";
import { BANDS } from "../audio/describe";

const SR = 48000;
const TAU = Math.PI * 2;
const W = 1000;
const H = 560;
const PASS = 8;
const tape = (seconds: number) => new Float32Array(Math.round(seconds * SR));
function tone(x: Float32Array, hz: number, at: number, len: number, amp = 0.3, pluck = 0) {
  const from = Math.round(at * SR);
  const n = Math.round(len * SR);
  for (let i = 0; i < n && from + i < x.length; i++) {
    const t = i / SR;
    const env = pluck > 0 ? Math.exp(-t / pluck) * Math.min(1, i / 48) : Math.min(1, i / 240, (n - i) / 240);
    x[from + i] += amp * env * Math.sin(TAU * hz * t);
  }
}
function burst(x: Float32Array, at: number, ring: number, amp = 0.4) {
  const from = Math.round(at * SR);
  let s = 3;
  for (let i = 0; i < ring * 6 * SR && from + i < x.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    x[from + i] += amp * Math.exp(-i / SR / ring) * (s / 2147483648 - 1);
  }
}
const steady: Manner = { wet: 0.4, loose: 0.3, body: 1 };
/** Paint a recording: every mark the hand made, as the page would have it make them (a frame at a time). */
function paint(x: Float32Array, seed = 5, manner = steady): Stamp[] {
  const hand = new Hand(seed);
  hand.size(W, H);
  hand.setPalette(getPalette("woodblock"));
  const ear = new Ear(SR);
  const marks: Stamp[] = [];
  const xAt = (t: number) => (MARGIN + ((t % PASS) / PASS) * (1 - 2 * MARGIN)) * W;
  const step = Math.round(SR / 60);
  for (let i = 0; i < x.length; i += step) hand.paint(ear.push(x.subarray(i, i + step)), xAt, manner, (s) => marks.push(s));
  return marks;
}
const xOfT = (t: number) => (MARGIN + (t / PASS) * (1 - 2 * MARGIN)) * W;
/** The marks made near a frequency's height, between two moments of the music. */
const near = (marks: Stamp[], hz: number, t0: number, t1: number, tall = 14) => marks.filter((m) => Math.abs(m.y - yOfHz(hz, H)) < tall && m.x >= xOfT(t0) - 8 && m.x <= xOfT(t1) + 30);
const extent = (marks: Stamp[]) => (marks.length ? Math.max(...marks.map((m) => m.x)) - Math.min(...marks.map((m) => m.x)) : 0);

describe("paint mixes as pigment does", () => {
  it("blue into yellow goes green, not grey", () => {
    const [r, g, b] = mixPaint([30, 70, 170], [245, 205, 40], 0.5);
    expect(g).toBeGreaterThan(r + 25);
    expect(g).toBeGreaterThan(b + 25);
    // plain averaging of the two screen colours would give a grey: red, green and blue within a few of each other
    const avg = [(30 + 245) / 2, (70 + 205) / 2, (170 + 40) / 2];
    expect(Math.max(...avg) - Math.min(...avg)).toBeLessThan(40);
  });
  it("a colour mixed with itself, or with none of the other, is itself", () => {
    expect(mixPaint([200, 60, 40], [200, 60, 40], 0.5)).toEqual([200, 60, 40]);
    expect(mixPaint([200, 60, 40], [40, 200, 90], 0)).toEqual([200, 60, 40]);
    expect(mixPaint([200, 60, 40], [40, 200, 90], 1)).toEqual([40, 200, 90]);
  });
  it("its measure of a paint can be turned back into the colour", () => {
    for (const v of [0.02, 0.2, 0.5, 0.9]) expect(reflOf(ksOf(v))).toBeCloseTo(v, 5);
    for (const c of [0, 12, 128, 255]) expect(toScreen(toLinear(c))).toBe(c);
    // dark paint absorbs a great deal, light paint hardly at all
    expect(paintOf([20, 20, 20])[0]).toBeGreaterThan(paintOf([240, 240, 240])[0] * 50);
  });
  it("a little dark paint goes a long way in a light one, as on a real palette", () => {
    const [r] = mixPaint([240, 240, 240], [20, 20, 20], 0.1);
    expect(r).toBeLessThan(170);
  });
});

describe("the hand: what is heard is what is painted", () => {
  it("a staccato note is a dab, a held note a stroke as long as itself", () => {
    const x = tape(4);
    tone(x, 660, 0.5, 0.06);
    tone(x, 660, 1.5, 1.5);
    const marks = paint(x);
    const dab = near(marks, 660, 0.45, 0.62).filter((m) => m.kind !== 1);
    const stroke = near(marks, 660, 1.45, 3.05).filter((m) => m.kind !== 1);
    expect(dab.length).toBeGreaterThan(0);
    // 0.06 s of music is 6.6 pixels across; a dab is no longer than a brush-width or two more
    expect(extent(dab)).toBeLessThan(26);
    // 1.5 s is 165 pixels
    expect(extent(stroke)).toBeGreaterThan(150);
    expect(extent(stroke)).toBeLessThan(200);
    // and between the two there is bare canvas at that height
    expect(near(marks, 660, 0.8, 1.3).filter((m) => m.x > xOfT(0.8) && m.x < xOfT(1.3) && m.kind !== 1)).toHaveLength(0);
  });

  it("paint goes up and down the canvas with the frequency", () => {
    const x = tape(3);
    tone(x, 110, 0.3, 0.6);
    tone(x, 880, 1.2, 0.6);
    tone(x, 5000, 2.1, 0.6);
    const marks = paint(x);
    const yOf = (t0: number, t1: number) => {
      const m = marks.filter((s) => s.x > xOfT(t0) && s.x < xOfT(t1) && s.kind !== 1);
      return m.reduce((a, s) => a + s.y, 0) / m.length;
    };
    const low = yOf(0.35, 0.85);
    const mid = yOf(1.25, 1.75);
    const high = yOf(2.15, 2.65);
    expect(Math.abs(low - yOfHz(110, H))).toBeLessThan(8);
    expect(Math.abs(mid - yOfHz(880, H))).toBeLessThan(8);
    expect(Math.abs(high - yOfHz(5000, H))).toBeLessThan(8);
    expect(low).toBeGreaterThan(mid + 100);
    expect(mid).toBeGreaterThan(high + 60);
  });

  it("a low note takes a broad brush and a high one a fine one; a loud note a heavier touch than a soft one", () => {
    const x = tape(4);
    tone(x, 110, 0.3, 0.6, 0.4);
    tone(x, 3500, 1.2, 0.6, 0.4);
    const marks = paint(x);
    const size = (hz: number, t0: number, t1: number) => {
      const m = near(marks, hz, t0, t1).filter((s) => s.kind === 0);
      return m.reduce((a, s) => a + s.r, 0) / m.length;
    };
    expect(size(110, 0.4, 0.8)).toBeGreaterThan(size(3500, 1.3, 1.7) * 2);
    // loud and soft, together, at two pitches (so each is judged against the other)
    const y = tape(2);
    tone(y, 500, 0.3, 1, 0.5);
    tone(y, 800, 0.3, 1, 0.05);
    const two = paint(y);
    const r = (hz: number) => {
      const m = near(two, hz, 0.5, 1.2, 8).filter((s) => s.kind === 0);
      return m.reduce((a, s) => a + s.r, 0) / m.length;
    };
    expect(r(500)).toBeGreaterThan(r(800) * 1.6);
  });

  it("a plucked note that dies away leaves a head and a thinning tail", () => {
    const x = tape(3);
    tone(x, 440, 0.4, 2, 0.4, 0.35);
    const m = near(paint(x), 440, 0.4, 2.2).filter((s) => s.kind === 0).sort((a, b) => a.x - b.x);
    const head = m.slice(1, 6).reduce((a, s) => a + s.r, 0) / 5;
    const tail = m.slice(-6, -1).reduce((a, s) => a + s.r, 0) / 5;
    expect(head).toBeGreaterThan(tail * 1.8);
    // and the brush has less paint on it at the end than at the start
    expect(m[m.length - 2].load).toBeLessThan(m[1].load);
  });

  it("a bend is a slope and a vibrato a ripple", () => {
    const x = tape(3);
    let ph = 0;
    for (let i = Math.round(0.3 * SR); i < 2.3 * SR; i++) {
      const t = i / SR - 0.3;
      ph += (TAU * 400 * Math.pow(2, t / 2)) / SR;
      x[i] = 0.3 * Math.sin(ph);
    }
    const m = paint(x).filter((s) => s.kind === 0).sort((a, b) => a.x - b.x);
    // an octave up over two seconds: it starts at the height of 400 Hz and ends near that of 800 Hz
    expect(Math.abs(m[2].y - yOfHz(400, H))).toBeLessThan(12);
    expect(Math.abs(m[m.length - 6].y - yOfHz(790, H))).toBeLessThan(16);
  });

  it("a drum is paint thrown: drops, where the drum is in frequency, and no stroke", () => {
    const x = tape(2);
    burst(x, 0.6, 0.02, 0.5);
    const marks = paint(x);
    const drops = marks.filter((m) => m.kind === 1);
    expect(drops.length).toBeGreaterThan(8);
    // thrown about the moment of the hit
    const at = drops.reduce((a, m) => a + m.x, 0) / drops.length;
    expect(Math.abs(at - xOfT(0.6))).toBeLessThan(30);
    // most are small, a few are large
    const sizes = drops.map((m) => m.r).sort((a, b) => a - b);
    expect(sizes[sizes.length - 1]).toBeGreaterThan(sizes[sizes.length >> 1] * 1.5);
    // a noise makes no long line
    expect(extent(marks.filter((m) => m.kind === 0 && m.load > 0.6))).toBeLessThan(40);
  });

  it("no two paintings of the same music are alike, and one seed paints the same picture twice", () => {
    const x = tape(2);
    tone(x, 330, 0.2, 1.2, 0.3, 0.5);
    burst(x, 1.0, 0.03);
    const a = paint(x, 1);
    const b = paint(x, 2);
    const again = paint(x, 1);
    expect(again).toEqual(a);
    const key = (m: Stamp[]) => m.slice(0, 40).map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)},${s.r.toFixed(2)},${s.k[0].toFixed(3)}`).join(" ");
    expect(key(a)).not.toBe(key(b));
    // but both are of the same music: the same heights, about the same number of marks
    const meanY = (m: Stamp[]) => m.filter((s) => s.kind === 0).reduce((t, s) => t + s.y, 0) / m.filter((s) => s.kind === 0).length;
    expect(Math.abs(meanY(a) - meanY(b))).toBeLessThan(12);
  });

  it("when the music comes round again the brushes are lifted and set down afresh", () => {
    const x = tape(10);
    tone(x, 500, 7.5, 1.5);
    const m = paint(x).filter((s) => s.kind === 0);
    // the note runs past the end of the pass (8 s): it goes on from the left edge, with nothing drawn across the canvas between
    const right = m.filter((s) => s.x > W * 0.8);
    const left = m.filter((s) => s.x < W * 0.2);
    expect(right.length).toBeGreaterThan(5);
    expect(left.length).toBeGreaterThan(5);
    expect(m.filter((s) => s.x > W * 0.25 && s.x < W * 0.75)).toHaveLength(0);
  });

  it("wet music is painted wet, dry music dry", () => {
    const x = tape(2);
    tone(x, 440, 0.3, 1.2);
    const water = (m: Manner) => {
      const s = paint(x, 4, m).filter((k) => k.kind !== 1);
      return s.reduce((a, k) => a + k.water, 0) / s.reduce((a, k) => a + k.paint, 0);
    };
    expect(water({ wet: 0.9, loose: 0.3, body: 1 })).toBeGreaterThan(water({ wet: 0.1, loose: 0.3, body: 1 }) * 4);
  });
});

describe("the mood of the music sets the manner of the painting", () => {
  const feel = (x: Float32Array) => {
    const mood = new Mood();
    for (const f of new Ear(SR).push(x)) mood.take(f);
    return mood.feeling;
  };
  it("held, quiet music runs wet; loud, clipped, noisy music goes on dry and loose", () => {
    const calm = tape(10);
    for (let k = 0; k < 3; k++) for (const hz of [196, 247, 294]) tone(calm, hz, 0.2 + k * 3.2, 3, 0.1);
    const busy = tape(10);
    for (let k = 0; k < 76; k++) {
      burst(busy, 0.2 + k * 0.125, 0.015, 0.5);
      if (k % 2 === 0) tone(busy, 2000 + 500 * (k % 5), 0.2 + k * 0.125, 0.05, 0.4);
    }
    const a = feel(calm);
    const b = feel(busy);
    expect(a.held).toBeGreaterThan(b.held + 0.3);
    expect(b.energy).toBeGreaterThan(a.energy + 0.15);
    expect(b.pace).toBeGreaterThan(4);
    expect(mannerOf(a, "auto").wet).toBeGreaterThan(mannerOf(b, "auto").wet + 0.25);
    expect(mannerOf(b, "auto").loose).toBeGreaterThan(mannerOf(a, "auto").loose);
    // and the choice overrides the mood
    expect(mannerOf(b, "wash").wet).toBeGreaterThan(0.6);
    expect(mannerOf(a, "thick").wet).toBeLessThan(0.31);
  });
  it("the key is heard", () => {
    // the notes of A minor, the key note and its fifth the most
    const chroma = new Float32Array(12);
    for (const [pc, w] of [[9, 5], [11, 1], [0, 3], [2, 1.5], [4, 4], [5, 1.5], [7, 1.5]]) chroma[pc] = w;
    const k = keyOf(chroma);
    expect(k.tonic).toBe(9);
    expect(k.major).toBe(false);
    const x = tape(8);
    // G major, as chords
    for (let k2 = 0; k2 < 4; k2++) for (const hz of [[196, 247, 294], [262, 330, 392], [294, 370, 440], [196, 247, 294]][k2]) tone(x, hz, 0.2 + k2 * 1.9, 1.8, 0.15);
    const f = feel(x);
    expect(f.tonic).toBe(7);
    expect(f.major).toBe(true);
  });
});

describe("a song from a file", () => {
  const song = () => {
    const mono = tape(6);
    tone(mono, 440, 1, 0.5, 0.05);
    tone(mono, 660, 3, 0.5, 0.05);
    burst(mono, 4.5, 0.03, 0.08);
    return { mono, ref: loudest(mono, SR), buffer: { sampleRate: SR } };
  };
  it("is read a little at a time, and what is heard does not depend on how it is cut up", () => {
    const s = song();
    const whole = new Reader(s).upTo(6);
    const reader = new Reader(s);
    const parts: Frame[] = [];
    for (let t = 0; t <= 6.001; t += 1 / 60) reader.upTo(t, parts);
    expect(parts.length).toBe(whole.length);
    expect(parts.map((f) => f.voices.length)).toEqual(whole.map((f) => f.voices.length));
    expect(parts[100].t).toBeCloseTo(whole[100].t, 6);
  });
  it("a quiet recording is painted as fully as a loud one, on one scale for the whole song", () => {
    const s = song();
    const frames = new Reader(s).upTo(6);
    const peak = Math.max(...frames.flatMap((f) => f.voices.map((v) => v.amp)));
    expect(peak).toBeGreaterThan(0.85);
  });
  it("can be started from the middle, in time", () => {
    const s = song();
    const frames = new Reader(s, 2.8).upTo(4);
    expect(frames[0].t).toBeGreaterThan(2.77);
    const first = frames.find((f) => f.voices.some((v) => Math.abs(v.hz - 660) < 10 && v.amp > 0.5))!;
    expect(first.t).toBeGreaterThan(2.95);
    expect(first.t).toBeLessThan(3.1);
  });
  it("left and right are heard as one", () => {
    const l = new Float32Array([1, 0, -1]);
    const r = new Float32Array([0, 0, -1]);
    expect([...toMono({ numberOfChannels: 2, length: 3, getChannelData: (c) => (c ? r : l) })]).toEqual([0.5, 0, -1]);
  });
});

describe("the guide and the options", () => {
  it("what the mix covers: each band's strength and whose it is", () => {
    const c = new Cover();
    const chords = new Float32Array(BANDS);
    const drums = new Float32Array(BANDS);
    chords[20] = 1;
    drums[20] = 3;
    drums[5] = 0.5;
    for (let i = 0; i < 200; i++) c.mix({ chords, drums }, 50);
    const { level, share } = c.coverage();
    expect(level[20]).toBeGreaterThan(0.95);
    expect(level[5]).toBeGreaterThan(0.5);
    expect(level[40]).toBe(0);
    expect(share.drums[20]).toBeCloseTo(0.75, 2);
    expect(STEM_IDS.reduce((a, s) => a + share[s][20], 0)).toBeCloseTo(1, 5);
  });
  it("old paint can stay, or fade at three speeds", () => {
    expect(FADES.map((f) => f.id)).toEqual([0, 1, 2, 3]);
    expect(FADES[0].half).toBe(0);
    expect(FADES[1].half).toBeGreaterThan(FADES[2].half);
    expect(FADES[2].half).toBeGreaterThan(FADES[3].half);
  });
});
