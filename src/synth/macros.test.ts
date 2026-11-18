import { describe, expect, it } from "vitest";
import { MACROS, applyMacros, bakeMacros, macroChoices, setChoice, setKnob, setMacro } from "./macros";
import { loudness, powerSpectrum } from "./measure";
import { DEFAULT_PARAMS, MACRO_KEYS, type SynthParams, UNIT_KEYS } from "./params";
import { PRESETS, presetById } from "./presets";
import { renderNotes } from "./render";

/** How bright a held chord is: the share of its energy above 1 kHz, in dB. */
function brightness(p: SynthParams): number {
  const { L } = renderNotes(p, [48, 55, 64].map((midi) => ({ midi, start: 0, length: 1.2, velocity: 0.8 })), { seconds: 1.2 });
  const N = 16384;
  const sp = powerSpectrum(L, 24000, N);
  let high = 0;
  let all = 0;
  for (let b = 1; b < sp.length; b++) {
    all += sp[b];
    if ((b * 48000) / N > 1000) high += sp[b];
  }
  return 10 * Math.log10(high / all);
}

describe("macros", () => {
  it("are six, named, and leave a sound exactly as made at the centre", () => {
    expect(MACROS.map((m) => m.id)).toEqual(MACRO_KEYS);
    for (const p of PRESETS) expect(applyMacros(p.params)).toEqual(p.params);
  });

  it("Bright makes any sound darker or brighter", () => {
    for (const id of ["warm-pad", "fm-piano", "sub-bass", "ring-bell"]) {
      const p = presetById(id)!.params;
      const dark = brightness(applyMacros(setMacro(p, "bright", -1)));
      const mid = brightness(p);
      const bright = brightness(applyMacros(setMacro(p, "bright", 1)));
      expect(dark, id).toBeLessThan(mid);
      expect(bright, id).toBeGreaterThan(mid);
    }
  });

  it("each macro moves the knobs it names, in the right direction", () => {
    const p = presetById("poly-keys")!.params;
    const up = (id: (typeof MACRO_KEYS)[number]) => applyMacros(setMacro(p, id, 0.8));
    expect(up("bright").cutoff).toBeGreaterThan(p.cutoff);
    expect(up("grit").drive).toBeGreaterThan(p.drive);
    expect(up("width").width).toBeGreaterThan(p.width);
    expect(up("width").mod).toBeGreaterThan(p.mod);
    expect(up("shape").attack).toBeGreaterThan(p.attack);
    expect(up("shape").release).toBeGreaterThan(p.release);
    expect(up("space").reverb).toBeGreaterThan(p.reverb);
    expect(up("motion").drift).toBeGreaterThan(p.drift);
    // a small turn is a small change: the curve is gentle near the centre
    const small = applyMacros(setMacro(p, "bright", 0.1)).cutoff - p.cutoff;
    const big = applyMacros(setMacro(p, "bright", 1)).cutoff - p.cutoff;
    expect(small).toBeLessThan(big / 15);
  });

  it("Motion and Space always do something: they lend an LFO or an effect to a sound that has none", () => {
    const plain: SynthParams = { ...DEFAULT_PARAMS, lfoDest: "off", fx: "off", lfoDepth: 0.7, fxDepth: 0.9 };
    const moved = applyMacros(setMacro(setMacro(plain, "motion", 0.6), "space", 0.6));
    expect(moved.lfoDest).not.toBe("off");
    expect(moved.fx).toBe("delay");
    // the borrowed LFO and effect start from nothing, not from the sound's own unused depths
    expect(moved.lfoDepth).toBeLessThan(0.4);
    expect(moved.fxDepth).toBeLessThan(0.4);
    expect(macroChoices(setMacro(plain, "motion", 0.6)).lfoBorrowed).toBe(true);
    // choosing "off" on the panel while a macro lends one means off
    const off = setChoice(setMacro(plain, "space", 0.6), { fx: "off" });
    expect(applyMacros(off).fx).toBe("off");
  });

  it("a knob moved by hand lands where it was put, whatever the macros are doing", () => {
    let p = setMacro(setMacro(presetById("warm-pad")!.params, "bright", 0.7), "shape", -0.5);
    for (const k of UNIT_KEYS) {
      const want = 0.42;
      p = setKnob(p, k, want);
      const shown = applyMacros(p)[k];
      // unless the macro's push makes that place unreachable, the knob shows exactly what was set
      if (p[k] > 0 && p[k] < 1) expect(shown, k).toBeCloseTo(want, 9);
    }
  });

  it("baking folds the macros into the knobs without changing the sound", () => {
    const p = setMacro(setMacro(setMacro(presetById("synth-brass")!.params, "grit", 0.5), "space", -0.3), "width", 0.4);
    const baked = bakeMacros(p);
    expect(Object.values(baked.macros).every((v) => v === 0)).toBe(true);
    expect(applyMacros(baked)).toEqual({ ...applyMacros(p), macros: baked.macros });
  });

  it("Grit adds dirt without making the sound much louder", () => {
    const p = presetById("saw-strings")!.params;
    const level = (q: SynthParams) => {
      const { L, R, sampleRate } = renderNotes(q, [48, 55, 64].map((midi) => ({ midi, start: 0, length: 1.5, velocity: 0.8 })), { seconds: 1.6 });
      return loudness(L, R, sampleRate).momentaryMax;
    };
    expect(Math.abs(level(applyMacros(setMacro(p, "grit", 1))) - level(p))).toBeLessThan(6);
  });
});
