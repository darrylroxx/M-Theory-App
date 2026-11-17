import { describe, expect, it } from "vitest";
import { seededRng } from "../theory/progression";
import { HARP_VOICES, STRING_DEFAULT, VOICE_GROUPS, harpSeconds, renderHarp, voiceShift, type HarpString } from "./harp";

const SR = 44100;

/** Estimate the fundamental via normalised autocorrelation + parabolic interpolation. */
function detectPitch(x: Float32Array, sr: number, minHz = 60, maxHz = 1500): number {
  const start = Math.floor(sr * 0.1);
  const W = Math.floor(sr * 0.1);
  const seg = x.subarray(start, start + W * 2);
  const ac = (lag: number) => {
    let s = 0;
    for (let i = 0; i < W; i++) s += seg[i] * seg[i + lag];
    return s;
  };
  const minLag = Math.floor(sr / maxHz);
  const maxLag = Math.ceil(sr / minHz);
  const vals: number[] = [];
  for (let l = 0; l <= maxLag + 1; l++) vals.push(l >= minLag - 1 ? ac(l) : 0);
  // first strong peak (avoids octave errors)
  const best = Math.max(...vals.slice(minLag, maxLag));
  let lag = minLag;
  for (let l = minLag + 1; l < maxLag; l++) {
    if (vals[l] > 0.9 * best && vals[l] >= vals[l - 1] && vals[l] >= vals[l + 1]) { lag = l; break; }
  }
  const [a, b, c] = [vals[lag - 1], vals[lag], vals[lag + 1]];
  const shift = (a - c) / (2 * (a - 2 * b + c));
  return sr / (lag + shift);
}

const cents = (f: number, ref: number) => 1200 * Math.log2(f / ref);
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const rms = (x: Float32Array, from: number, to: number) => {
  let s = 0;
  const b = Math.min(to, x.length);
  for (let i = from; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - from));
};
/** How strong one frequency is, a little after the pluck. */
function level(x: Float32Array, f: number, n = 8192, from = Math.floor(SR * 0.02)): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    re += x[from + i] * w * Math.cos((2 * Math.PI * f * i) / SR);
    im += x[from + i] * w * Math.sin((2 * Math.PI * f * i) / SR);
  }
  return Math.hypot(re, im) / n;
}
/** The strongest frequency within 20 cents of `f`, to the nearest cent. */
function peakNear(x: Float32Array, f: number): number {
  let best = f;
  let top = 0;
  for (let c = -20; c <= 20; c++) {
    const g = f * Math.pow(2, c / 1200);
    const l = level(x, g, Math.min(32768, x.length - 2000), 1000);
    if (l > top) [top, best] = [l, g];
  }
  return best;
}
/** The centre of the energy within 20 cents of `f`. */
function centreNear(x: Float32Array, f: number): number {
  let sum = 0;
  let weight = 0;
  for (let c = -20; c <= 20; c++) {
    const l = level(x, f * Math.pow(2, c / 1200), Math.min(32768, x.length - 2000), 1000) ** 2;
    sum += c * l;
    weight += l;
  }
  return f * Math.pow(2, sum / weight / 1200);
}
const note = (midi: number, s: Partial<HarpString> = {}) => renderHarp(SR, midi, { ...STRING_DEFAULT, ...s }, seededRng(midi));

describe("harp", () => {
  it("is a library: ten harps, their plucked relatives, and bells", () => {
    expect(HARP_VOICES.length).toBeGreaterThanOrEqual(22);
    expect(new Set(HARP_VOICES.map((v) => v.id)).size).toBe(HARP_VOICES.length);
    expect(new Set(HARP_VOICES.map((v) => v.name)).size).toBe(HARP_VOICES.length);
    expect(HARP_VOICES.filter((v) => v.group === "Harps").length).toBeGreaterThanOrEqual(10);
    for (const g of VOICE_GROUPS) expect(HARP_VOICES.some((v) => v.group === g), g).toBe(true);
    // no two instruments are the same sound
    const sig = (id: HarpString["voice"]) => Array.from(note(57, { voice: id }).subarray(2000, 2064)).map((x) => x.toFixed(4)).join();
    expect(new Set(HARP_VOICES.map((v) => sig(v.id))).size).toBe(HARP_VOICES.length);
  });

  it("every instrument is in tune across the guitar's range (within 4 cents)", () => {
    for (const v of HARP_VOICES)
      for (const midi of [40, 45, 50, 55, 59, 64, 69, 76, 81]) {
        const d = note(midi, { voice: v.id });
        // a music box's overtones are not whole multiples of its note, which fools a pitch detector: find its fundamental directly
        // harmonics sound an octave above the string that is touched
        const want = hz(midi + voiceShift(v.id));
        // bars fool a pitch detector (their overtones are not whole multiples), so they are measured at the note itself;
        // paired strings sit either side of the note on purpose, so it is their centre that must be in tune
        const paired = ["dulcimer", "mandolin"].includes(v.id);
        const f = paired ? centreNear(d, want) : v.group === "Bells" ? peakNear(d, want) : detectPitch(d, SR, 60, 3000);
        expect(Math.abs(cents(f, want)), `${v.id} ${midi}`).toBeLessThan(4);
      }
  }, 20000);

  it("is the same note every time, never silent, never clipped, at any knob setting", () => {
    for (const v of HARP_VOICES)
      for (const k of [0, 1])
        for (const midi of [40, 60, 84]) {
          const s = { voice: v.id, pluck: k, soft: 1 - k, ring: k, body: 1 - k };
          const a = renderHarp(SR, midi, s, seededRng(3));
          const b = renderHarp(SR, midi, s, seededRng(3));
          let peak = 0;
          let bad = 0;
          for (let i = 0; i < a.length; i++) {
            if (!Number.isFinite(a[i]) || a[i] !== b[i]) bad++;
            peak = Math.max(peak, Math.abs(a[i]));
          }
          expect(a.length).toBe(b.length);
          expect(bad, `${v.id} ${midi} ${k}`).toBe(0);
          expect(peak, `${v.id} ${midi} ${k}`).toBeGreaterThan(0.05);
          expect(peak).toBeLessThanOrEqual(0.93);
          // starts and ends without a click
          expect(Math.abs(a[0])).toBeLessThan(0.01);
          expect(Math.abs(a[a.length - 1])).toBeLessThan(0.01);
        }
  }, 20000);

  it("low and high notes are equally loud", () => {
    for (const v of HARP_VOICES) {
      const levels = [40, 48, 55, 60, 67, 72, 79, 86].map((m) => 20 * Math.log10(rms(note(m, { voice: v.id }), 0, SR / 4)));
      expect(Math.max(...levels) - Math.min(...levels), v.id).toBeLessThan(4);
    }
  });

  it("low strings ring for seconds, high strings die quickly", () => {
    const fall = (midi: number) => {
      const d = note(midi);
      const start = rms(d, 0, SR * 0.1);
      for (let t = 0.1; t < d.length / SR; t += 0.05) if (rms(d, Math.floor(t * SR), Math.floor((t + 0.05) * SR)) < start * 0.1) return t;
      return d.length / SR;
    };
    expect(fall(40)).toBeGreaterThan(1.5);
    expect(fall(88)).toBeLessThan(1);
    expect(fall(40)).toBeGreaterThan(fall(64));
    expect(fall(64)).toBeGreaterThan(fall(88));
  });

  it("plucked in the middle, the even overtones vanish; near the soundboard, they come back", () => {
    const middle = note(57, { pluck: 0 });
    const edge = note(57, { pluck: 1 });
    const f = hz(57);
    expect(level(middle, 2 * f)).toBeLessThan(level(middle, f) * 0.02);
    expect(level(middle, 3 * f)).toBeGreaterThan(level(middle, 2 * f) * 3);
    expect(level(edge, 2 * f)).toBeGreaterThan(level(edge, f) * 0.2);
  });

  it("a soft finger is duller than a nail", () => {
    const f = hz(52);
    const bright = (d: Float32Array) => [6, 7, 8, 9, 10, 11].reduce((a, n) => a + level(d, n * f), 0) / level(d, f);
    expect(bright(note(52, { soft: 0 }))).toBeGreaterThan(bright(note(52, { soft: 1 })) * 2);
  });

  it("gut loses its overtones sooner than wire: the harp's tail is purer", () => {
    const f = hz(48);
    const late = Math.floor(SR * 1.2);
    const share = (d: Float32Array) => level(d, 5 * f, 8192, late) / level(d, f, 8192, late);
    expect(share(note(48, { voice: "wire" }))).toBeGreaterThan(share(note(48, { voice: "concert" })) * 3);
  });

  it("Ring makes notes longer", () => {
    expect(harpSeconds(52, { ...STRING_DEFAULT, ring: 1 })).toBeGreaterThan(harpSeconds(52, { ...STRING_DEFAULT, ring: 0 }) * 1.5);
    const short = note(60, { ring: 0 });
    const long = note(60, { ring: 1 });
    expect(rms(long, SR, SR * 1.2)).toBeGreaterThan(rms(short, SR, SR * 1.2) * 3);
  });

  it("the soundboard knocks: more Body, more low thump at the start of a high note", () => {
    const thump = (d: Float32Array) => level(d, 150, 2048, 0) + level(d, 228, 2048, 0);
    expect(thump(note(84, { body: 1 }))).toBeGreaterThan(thump(note(84, { body: 0 })) * 3);
  });
});
