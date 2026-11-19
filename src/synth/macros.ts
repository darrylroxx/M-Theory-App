/**
 * Six big knobs that reshape any sound, for whoever does not want to learn the panel first.
 *
 * A macro is an offset, not a setting: at the centre (0) the sound is exactly what it was made as,
 * and turning it either way pushes several panel knobs at once along fixed curves. The panel
 * shows the result (its sliders move as a macro turns, which is how a beginner learns what each
 * knob does), and when a slider is then moved by hand the sound's own value is set so the slider
 * lands where it was put, with the macros left where they are.
 *
 * The groupings follow the research notes (Brightness, Motion, Space, Grit, Width, Shape/Time),
 * each mapped onto this synth's controls.
 */
import { type FxType, type LfoDest, type Macros, type OscType, type SynthParams, type UnitKey, UNIT_KEYS, clamp01 } from "./params";

export interface MacroInfo {
  id: keyof Macros;
  name: string;
  /** a symbol for small screens */
  symbol: string;
  /** what the two ends do */
  hint: string;
  /** the panel knobs it moves */
  moves: UnitKey[];
}

export const MACROS: MacroInfo[] = [
  { id: "bright", name: "Bright", symbol: "☀", hint: "Darker ← → brighter", moves: ["cutoff", "resonance", "texture"] },
  { id: "motion", name: "Motion", symbol: "∿", hint: "Still ← → moving", moves: ["lfoDepth", "lfoSpeed", "drift"] },
  { id: "space", name: "Space", symbol: "◌", hint: "Close ← → far", moves: ["reverb", "fxDepth"] },
  { id: "grit", name: "Grit", symbol: "▲", hint: "Clean ← → dirty", moves: ["drive", "texture", "resonance", "fxDepth"] },
  { id: "width", name: "Width", symbol: "↔", hint: "Narrow ← → wide", moves: ["width", "mod", "fxDepth"] },
  { id: "shape", name: "Shape", symbol: "◢", hint: "Tight ← → soft", moves: ["attack", "decay", "release"] },
];

/** Gentle near the centre, so small turns are small. */
const curve = (m: number) => m * (0.55 + 0.45 * Math.abs(m));

/** The LFO destination and effect the macros switch on when the sound has none (Motion and Space must always do something). */
const MOTION_DEST: LfoDest = "filter";
const SPACE_FX: FxType = "delay";
/** the echo time Space brings in, about 420 ms */
const SPACE_RATE = 0.62;
const ON = 0.02;

/** The LFO destination and effect after the macros. */
export function macroChoices(p: SynthParams): { lfoDest: LfoDest; fx: FxType; lfoBorrowed: boolean; fxBorrowed: boolean } {
  const lfoBorrowed = p.lfoDest === "off" && p.macros.motion > ON;
  const fxBorrowed = p.fx === "off" && p.macros.space > ON;
  return { lfoDest: lfoBorrowed ? MOTION_DEST : p.lfoDest, fx: fxBorrowed ? SPACE_FX : p.fx, lfoBorrowed, fxBorrowed };
}

/** How far each knob is pushed by the macros, given the oscillator and the effect in use. */
export function macroOffsets(m: Macros, osc: OscType, fx: FxType): Partial<Record<UnitKey, number>> {
  const b = curve(m.bright);
  const mo = curve(m.motion);
  const s = curve(m.space);
  const g = curve(m.grit);
  const w = curve(m.width);
  const sh = curve(m.shape);
  const edge = osc === "fm" || osc === "sync";
  return {
    cutoff: 0.3 * b,
    resonance: -0.06 * Math.max(0, b) + 0.12 * g,
    texture: (edge ? 0.12 * b : 0) + (osc === "saw" || edge ? 0.2 * g : 0),
    mod: osc === "saw" ? 0.3 * w : 0,
    drive: 0.55 * g,
    lfoDepth: 0.45 * mo,
    lfoSpeed: 0.2 * mo,
    drift: 0.5 * mo,
    reverb: 0.45 * s,
    fxDepth: (fx === "chorus" || fx === "phaser" || fx === "delay" ? 0.35 * s : 0) + (fx === "dist" ? 0.35 * g : 0) + (fx === "chorus" ? 0.25 * w : 0),
    width: 0.5 * w,
    attack: 0.3 * sh,
    decay: 0.2 * sh,
    release: 0.3 * sh,
  };
}

/** The sound as it will be heard: the sound's own knobs with the macros applied. */
export function applyMacros(p: SynthParams): SynthParams {
  const m = p.macros;
  if (m.bright === 0 && m.motion === 0 && m.space === 0 && m.grit === 0 && m.width === 0 && m.shape === 0) return p;
  const c = macroChoices(p);
  const off = macroOffsets(m, p.osc, c.fx);
  const out: SynthParams = { ...p, lfoDest: c.lfoDest, fx: c.fx };
  // a borrowed LFO or effect starts from nothing: the sound's own (unused) depth does not leak in
  const base: SynthParams = c.lfoBorrowed || c.fxBorrowed ? { ...p } : p;
  if (c.lfoBorrowed) base.lfoDepth = 0;
  if (c.fxBorrowed) {
    base.fxDepth = 0;
    base.fxRate = SPACE_RATE;
  }
  for (const k of UNIT_KEYS) {
    const o = off[k];
    out[k] = o ? clamp01(base[k] + o) : base[k];
  }
  return out;
}

/**
 * A panel knob was moved by hand to `value` (what the panel shows, macros included). Returns the
 * sound with its own value set so the knob lands there. Touching a borrowed LFO or effect makes
 * it the sound's own.
 */
export function setKnob(p: SynthParams, key: UnitKey, value: number): SynthParams {
  const c = macroChoices(p);
  const next: SynthParams = { ...p, preset: p.preset };
  if (c.lfoBorrowed && (key === "lfoDepth" || key === "lfoSpeed" || key === "lfoFade")) {
    next.lfoDest = c.lfoDest;
    next.lfoDepth = 0;
  }
  if (c.fxBorrowed && (key === "fxDepth" || key === "fxRate")) {
    next.fx = c.fx;
    next.fxDepth = 0;
    next.fxRate = SPACE_RATE;
  }
  const off = macroOffsets(p.macros, next.osc, macroChoices(next).fx)[key] ?? 0;
  next[key] = clamp01(value - off);
  return next;
}

/**
 * A choice on the panel (oscillator, LFO destination, effect, voice mode). Choosing "off" for the
 * LFO or the effect while Motion or Space is lending one also turns that macro's push down to
 * nothing, so "off" means off.
 */
export function setChoice(p: SynthParams, patch: Partial<Pick<SynthParams, "osc" | "lfoDest" | "lfoShape" | "fx" | "voice">>): SynthParams {
  const next: SynthParams = { ...p, ...patch, macros: { ...p.macros } };
  if (patch.lfoDest === "off" && next.macros.motion > 0) next.macros.motion = 0;
  if (patch.fx === "off" && next.macros.space > 0) next.macros.space = 0;
  if (patch.lfoDest && patch.lfoDest !== "off" && p.lfoDest === "off" && macroChoices(p).lfoBorrowed) next.lfoDepth = 0;
  if (patch.fx && patch.fx !== "off" && p.fx === "off" && macroChoices(p).fxBorrowed) {
    next.fxDepth = 0;
    next.fxRate = SPACE_RATE;
  }
  return next;
}

/** Turn one macro. */
export function setMacro(p: SynthParams, id: keyof Macros, value: number): SynthParams {
  return { ...p, macros: { ...p.macros, [id]: Math.max(-1, Math.min(1, value)) } };
}

/** Fold the macros into the sound's own knobs and centre them (what you hear stays the same). */
export function bakeMacros(p: SynthParams): SynthParams {
  const e = applyMacros(p);
  return { ...e, macros: { bright: 0, motion: 0, space: 0, grit: 0, width: 0, shape: 0 } };
}
