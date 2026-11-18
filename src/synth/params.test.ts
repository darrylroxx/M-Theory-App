import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAMS,
  UNIT_KEYS,
  attackOf,
  attackSec,
  cutoffHz,
  cutoffOf,
  delayOf,
  delaySec,
  fmRatio,
  glideOf,
  glideSec,
  lfoHz,
  lfoOf,
  pulseInterval,
  ratioOf,
  reviveSynth,
  ringRatio,
  sameSynth,
  timeOf,
  timeSec,
  valueText,
} from "./params";

describe("knob curves", () => {
  it("cover the musical ranges, exponentially, and turn back into knob positions", () => {
    expect(cutoffHz(0)).toBeCloseTo(20, 6);
    expect(cutoffHz(1)).toBeCloseTo(20480, 0);
    expect(cutoffHz(0.5)).toBeCloseTo(640, 0);
    expect(attackSec(0)).toBeCloseTo(0.001, 6);
    expect(attackSec(1)).toBeCloseTo(8.001, 3);
    expect(timeSec(0)).toBeCloseTo(0.005, 6);
    expect(timeSec(1)).toBeCloseTo(10.005, 3);
    expect(lfoHz(0)).toBeCloseTo(0.05, 6);
    expect(lfoHz(1)).toBeCloseTo(25.6, 3);
    expect(glideSec(0)).toBe(0);
    expect(glideSec(1)).toBeCloseTo(1.81, 2);
    expect(delaySec(0)).toBeCloseTo(0.03, 6);
    expect(delaySec(1)).toBeCloseTo(1.2, 1);
    for (const x of [0.01, 0.2, 0.5, 0.77, 1]) {
      expect(cutoffOf(cutoffHz(x))).toBeCloseTo(x, 9);
      expect(attackOf(attackSec(x))).toBeCloseTo(x, 9);
      expect(timeOf(timeSec(x))).toBeCloseTo(x, 9);
      expect(lfoOf(lfoHz(x))).toBeCloseTo(x, 9);
      expect(glideOf(glideSec(x))).toBeCloseTo(x, 9);
      expect(delayOf(delaySec(x))).toBeCloseTo(x, 9);
    }
    // the bottom of every time knob is short and the middle is where the musical values are
    expect(attackSec(0.25)).toBeLessThan(0.15);
    expect(timeSec(0.5)).toBeGreaterThan(1);
  });

  it("the Pulse oscillator's second pitch detunes, then steps through intervals", () => {
    expect(pulseInterval(0)).toBe(0);
    expect(pulseInterval(0.2)).toBeCloseTo(0.15, 6);
    expect(pulseInterval(0.39)).toBeLessThan(0.3);
    const steps = new Set<number>();
    for (let t = 0.4; t <= 1; t += 0.01) steps.add(pulseInterval(t));
    expect([...steps].sort((a, b) => a - b)).toEqual([-12, -5, 7, 12, 19, 24]);
  });

  it("ratio knobs rest on whole ratios and pass through the metallic ones between", () => {
    for (const r of [0.5, 1, 2, 3, 4]) {
      expect(ringRatio(ratioOf("ring", r))).toBeCloseTo(r, 9);
      expect(fmRatio(ratioOf("fm", r))).toBeCloseTo(r, 9);
    }
    // a bell ratio between the anchors is reachable and comes back
    expect(ringRatio(ratioOf("ring", 2.76))).toBeCloseTo(2.76, 6);
    expect(fmRatio(ratioOf("fm", 3.3))).toBeCloseTo(3.3, 6);
    // and a small turn near an anchor stays on it
    const at = ratioOf("fm", 2);
    expect(fmRatio(at + 0.005)).toBe(2);
  });

  it("show values in a musician's units", () => {
    expect(valueText("cutoff", 0.5)).toBe("640 Hz");
    expect(valueText("cutoff", 1)).toBe("20 kHz");
    expect(valueText("attack", 0)).toBe("1 ms");
    expect(valueText("glide", 0)).toBe("Off");
    expect(valueText("balance", 0)).toBe("Amp");
    expect(valueText("balance", 1)).toBe("Filter");
    expect(valueText("mod", 0, { ...DEFAULT_PARAMS, osc: "pulse" })).toBe("50%");
    expect(valueText("mod", ratioOf("fm", 2), { ...DEFAULT_PARAMS, osc: "fm" })).toBe("×2.00");
    expect(valueText("fxRate", delayOf(0.25), { ...DEFAULT_PARAMS, fx: "delay" })).toBe("250 ms");
  });
});

describe("reviving a stored sound", () => {
  it("fills in everything missing from a partial or older sound", () => {
    const old = { osc: "pulse", cutoff: 0.3, attack: 0.2 };
    const p = reviveSynth(old);
    expect(p.osc).toBe("pulse");
    expect(p.cutoff).toBe(0.3);
    expect(p.attack).toBe(0.2);
    expect(p.release).toBe(DEFAULT_PARAMS.release);
    expect(p.macros).toEqual(DEFAULT_PARAMS.macros);
    expect(p.play).toEqual(DEFAULT_PARAMS.play);
    expect(reviveSynth(undefined)).toEqual(DEFAULT_PARAMS);
    expect(reviveSynth("nonsense")).toEqual(DEFAULT_PARAMS);
    expect(reviveSynth(null)).toEqual(DEFAULT_PARAMS);
  });
  it("clamps numbers, replaces unknown choices and drops unknown fields", () => {
    const p = reviveSynth({
      osc: "wavetable",
      cutoff: 7,
      resonance: -2,
      attack: Number.NaN,
      release: Infinity,
      fx: "bitcrush",
      voice: "duo",
      trim: 99,
      junk: 1,
      macros: { bright: 5, motion: -9, grit: "lots" },
      play: { mode: "arp", rate: "1/64", octaves: 7, gate: 0, humanise: 2 },
    }) as unknown as Record<string, unknown>;
    expect(p.osc).toBe("saw");
    expect(p.cutoff).toBe(1);
    expect(p.resonance).toBe(0);
    expect(p.attack).toBe(DEFAULT_PARAMS.attack);
    expect(p.release).toBe(DEFAULT_PARAMS.release);
    expect(p.fx).toBe("off");
    expect(p.voice).toBe("poly");
    expect(p.trim).toBe(24);
    expect("junk" in p).toBe(false);
    expect(p.macros).toEqual({ bright: 1, motion: -1, space: 0, grit: 0, width: 0, shape: 0 });
    const play = p.play as Record<string, unknown>;
    expect(play.mode).toBe("arp");
    expect(play.rate).toBe(DEFAULT_PARAMS.play.rate);
    expect(play.octaves).toBe(DEFAULT_PARAMS.play.octaves);
    expect(play.gate).toBe(0.1);
    expect(play.humanise).toBe(1);
  });
  it("every knob that the panel and the macros move is a 0..1 number", () => {
    for (const k of UNIT_KEYS) {
      expect(typeof DEFAULT_PARAMS[k]).toBe("number");
      expect(DEFAULT_PARAMS[k]).toBeGreaterThanOrEqual(0);
      expect(DEFAULT_PARAMS[k]).toBeLessThanOrEqual(1);
    }
  });
  it("tells two sounds apart, ignoring the volume", () => {
    expect(sameSynth(DEFAULT_PARAMS, { ...DEFAULT_PARAMS, volume: 0.2 })).toBe(true);
    expect(sameSynth(DEFAULT_PARAMS, { ...DEFAULT_PARAMS, cutoff: 0.2 })).toBe(false);
    expect(sameSynth(DEFAULT_PARAMS, { ...DEFAULT_PARAMS, macros: { ...DEFAULT_PARAMS.macros, grit: 0.5 } })).toBe(false);
  });
});
