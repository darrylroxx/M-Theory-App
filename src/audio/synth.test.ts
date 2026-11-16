import { describe, expect, it } from "vitest";
import { seededRng } from "../theory/progression";
import { renderPluck } from "./synth";

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

describe("guitar synth", () => {
  it("every string of a guitar is in tune (within 3 cents)", () => {
    const sr = 44100;
    for (const midi of [40, 45, 50, 55, 59, 64, 69, 76, 81]) {
      const { data, rate } = renderPluck(sr, midi, seededRng(midi));
      const f = detectPitch(data, sr) * rate;
      const target = 440 * Math.pow(2, (midi - 69) / 12);
      expect(Math.abs(cents(f, target))).toBeLessThan(3);
    }
  });
  it("decays and stays within range", () => {
    const { data } = renderPluck(44100, 52, seededRng(1));
    const early = Math.max(...Array.from(data.subarray(0, 4410)).map(Math.abs));
    const late = Math.max(...Array.from(data.subarray(data.length - 8820, data.length - 4410)).map(Math.abs));
    expect(early).toBeLessThanOrEqual(0.61);
    expect(late).toBeLessThan(early * 0.2);
  });
});
