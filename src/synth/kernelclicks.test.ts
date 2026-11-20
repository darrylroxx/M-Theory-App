/**
 * Moments that used to click on the synth: pressing ▶ while a sound still rings in its chorus or
 * phaser, its widener coming back on, changing effect type under a held chord; and a held note
 * that died away into numbers the processor is slow with.
 */
import { describe, expect, it } from "vitest";
import { SynthKernel, feed, type SynthEvent } from "./kernel";
import { DEFAULT_PARAMS, ratioOf, type SynthParams } from "./params";
import { soundFor } from "./render";

const SR = 48000;

/** A plain sine chord sound, still (no drift, no LFO), with the effects asked for. */
const sine = (patch: Partial<SynthParams> = {}): SynthParams => ({
  ...DEFAULT_PARAMS,
  osc: "fm",
  texture: 0,
  mod: ratioOf("fm", 1),
  cutoff: 1,
  resonance: 0,
  keyTrack: 0,
  drive: 0,
  balance: 0,
  attack: 0,
  decay: 0.5,
  sustain: 1,
  release: 0.3,
  reverb: 0,
  width: 0,
  drift: 0,
  velocity: 0,
  lfoDest: "off",
  volume: 1,
  fx: "off",
  ...patch,
});

function play(p: SynthParams, events: SynthEvent[], seconds: number) {
  const k = new SynthKernel(SR, { voices: 8, seed: 3 });
  k.setParams(soundFor(p));
  k.snapSmoothing();
  for (const e of events) feed(k, e);
  const n = Math.round(seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i += 128) k.render(L.subarray(i, i + 128), R.subarray(i, i + 128), Math.min(128, n - i));
  return { L, R, k };
}
const chord = (t: number, len: number): SynthEvent[] =>
  [57, 61, 64].flatMap((midi, i) => [
    { type: "on", t, midi, vel: 0.8, id: i + 1 },
    { type: "off", t: t + len, id: i + 1 },
  ]);
/** The sharpest bend (second difference) right after `at`, against the sharpest in the steady stretch before it. */
function click(x: Float32Array, at: number, after = 0.02): number {
  const d2 = (from: number, to: number) => {
    let m = 0;
    for (let i = Math.round(from * SR); i < Math.round(to * SR); i++) m = Math.max(m, Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]));
    return m;
  };
  return d2(at, at + after) / d2(at - 0.3, at - 0.02);
}

describe("no click where the synth used to click", () => {
  for (const fx of ["chorus", "phaser"] as const) {
    it(`▶ while a chord still rings in its ${fx}: the sweep carries on instead of jumping`, () => {
      const { L } = play(sine({ fx, fxDepth: 0.7 }), [...chord(0.05, 3), { type: "sync", t: 1.5 }], 2);
      expect(click(L, 1.5)).toBeLessThan(3);
    });
  }

  it("▶ from silence still starts every sweep where an offline render starts it", () => {
    const p = sine({ fx: "chorus", fxDepth: 0.7 });
    const a = play(p, [{ type: "sync", t: 1 }, ...chord(1.2, 0.5)], 2.2);
    // the same notes on a fresh synth, a second earlier
    const b = play(p, chord(0.2, 0.5), 1.2);
    let same = true;
    for (let i = 0; i < b.L.length; i++) if (Math.abs(a.L[i + SR] - b.L[i]) > 1e-6) same = false;
    expect(same).toBe(true);
  });

  it("the stereo widener coming back on carries on from the sound as it is, not from what it held when it went off", () => {
    const p = sine({ width: 0.5 });
    const events: SynthEvent[] = [...chord(0.05, 4), { type: "params", t: 1, params: soundFor({ ...p, width: 0 }) }, { type: "params", t: 1.7, params: soundFor(p) }];
    const { L, R } = play(p, events, 2.5);
    // the side (left minus right) is where the widener is heard
    const side = L.map((l, i) => l - R[i]);
    const bend = (from: number, to: number) => {
      let m = 0;
      for (let i = Math.round(from * SR); i < Math.round(to * SR); i++) m = Math.max(m, Math.abs(side[i] - 2 * side[i - 1] + side[i - 2]));
      return m;
    };
    // coming back on, the side is no sharper than it was while the widener was steadily on
    expect(bend(1.7, 1.8) / bend(0.5, 0.95)).toBeLessThan(2);
  });

  it("changing effect type under a held chord glides sample by sample, without a zipper", () => {
    const p = sine({ fx: "chorus", fxDepth: 0.6 });
    const { L } = play(p, [...chord(0.05, 3), { type: "params", t: 1.5, params: soundFor({ ...p, fx: "phaser" }) }], 2);
    expect(click(L, 1.5, 0.05)).toBeLessThan(2);
  });
});

describe("a held note that has died away", () => {
  it("is let down to exactly nothing, not left in numbers far below hearing that are slow to work with", () => {
    // a pluck held down: it dies away while the key is still held
    const p = sine({ sustain: 0, decay: 0, release: 0.3 });
    const { k } = play(p, [{ type: "on", t: 0.01, midi: 60, vel: 0.8, id: 1 }], 20);
    const v = (k as unknown as { voices: { active: boolean; env: number; gateEnv: number }[] }).voices.find((x) => x.active)!;
    expect(v).toBeDefined();
    expect(v.env === 0 || v.env > 1e-30).toBe(true);
    expect(v.gateEnv === 0 || v.gateEnv > 1e-30).toBe(true);
  });
});
