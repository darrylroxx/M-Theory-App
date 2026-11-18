import { describe, expect, it } from "vitest";
import { SynthKernel } from "./kernel";
import { DEFAULT_PARAMS, type SynthParams } from "./params";
import { presetById } from "./presets";
import { soundFor } from "./render";

/**
 * How much of the audio thread the synth needs. Skipped unless asked for:
 *   SYNTH_BENCH=1 npx vitest run src/synth/bench.test.ts
 * Prints nanoseconds per voice-sample (all the work of a block, effects included, divided by
 * voices × samples) and the share of real time eight voices take at 48 kHz.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe.skipIf(!env.SYNTH_BENCH)("benchmark", () => {
  it("eight voices stay far inside real time", () => {
    const sr = 48000;
    const rows: string[] = [];
    const bare: Partial<SynthParams> = { fx: "off", reverb: 0, width: 0, lfoDest: "off" };
    const cases: [string, SynthParams][] = [
      ["Multi Saw, 1 saw, filter only", { ...DEFAULT_PARAMS, osc: "saw", mod: 0, ...bare }],
      ["Multi Saw, 7 saws + sub, filter only", { ...DEFAULT_PARAMS, osc: "saw", mod: 0.7, texture: 0.4, ...bare }],
      ["Multi Saw, 7 saws + sub, filter, chorus, width, reverb, LFO", { ...DEFAULT_PARAMS, osc: "saw", mod: 0.7, texture: 0.4, fx: "chorus", fxDepth: 0.5, reverb: 0.4, width: 0.7, lfoDest: "filter", lfoDepth: 0.3, drift: 0.4 }],
      ["Pulse (PWM), delay, reverb", { ...DEFAULT_PARAMS, osc: "pulse", mod: 0.3, lfoDest: "osc", lfoDepth: 0.4, fx: "delay", fxDepth: 0.4, reverb: 0.3 }],
      ["Sync, distortion", { ...DEFAULT_PARAMS, osc: "sync", texture: 0.5, mod: 0.4, fx: "dist", fxDepth: 0.4 }],
      ["Ring (2x), phaser", { ...DEFAULT_PARAMS, osc: "ring", fx: "phaser", fxDepth: 0.4 }],
      ["FM, chorus", { ...DEFAULT_PARAMS, osc: "fm", texture: 0.5, fx: "chorus", fxDepth: 0.4 }],
      ["preset Warm Pad", soundFor(presetById("warm-pad")!.params)],
    ];
    for (const [name, p] of cases) {
      const k = new SynthKernel(sr, { voices: 8, seed: 1 });
      k.setParams({ ...p, sustain: 1, release: 0.5, attack: 0 });
      k.snapSmoothing();
      for (let i = 0; i < 8; i++) k.noteOn(0, 48 + i * 3, 0.8, i + 1);
      const L = new Float32Array(128);
      const R = new Float32Array(128);
      // warm up the compiler first
      for (let b = 0; b < 2000; b++) k.render(L, R, 128);
      const blocks = 6000;
      const t0 = performance.now();
      for (let b = 0; b < blocks; b++) k.render(L, R, 128);
      const ms = performance.now() - t0;
      const ns = (ms * 1e6) / (blocks * 128 * 8);
      const share = (ms / blocks / ((128 / sr) * 1000)) * 100;
      rows.push(`${name.padEnd(62)} ${ns.toFixed(1).padStart(6)} ns per voice-sample, 8 voices = ${share.toFixed(1)}% of real time`);
      expect(share).toBeLessThan(50);
    }
    console.log(rows.join("\n"));
  }, 120000);
});
