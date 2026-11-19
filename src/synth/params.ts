/**
 * The synth's sound, as a flat set of knobs.
 *
 * The first part is the panel of a small, much-loved virtual-analogue keyboard: one oscillator
 * with five ways of making sound (whose two shared knobs, Texture and Mod, mean something
 * different for each), one LFO with a destination, one resonant low-pass filter, one envelope
 * shared by the loudness and the filter (an EG Balance slider chooses which it shapes), one effect
 * at a time, and a voice mode with portamento. The rest is what that keyboard leaves out and a
 * beginner needs: velocity, the filter following the keyboard, a reverb, analogue drift, a stereo
 * width, six macro knobs and a way of playing.
 *
 * Every continuous knob is stored as 0..1, the position of its slider. The functions below turn
 * a position into seconds, hertz or semitones along curves that put the musical part of each
 * range in the middle of the slider (exponential for frequencies and times).
 */

export type OscType = "saw" | "pulse" | "sync" | "ring" | "fm";
export type LfoDest = "off" | "amp" | "filter" | "pitch" | "osc";
export type LfoShape = "sine" | "triangle" | "square" | "saw" | "random";
export type FxType = "off" | "dist" | "chorus" | "phaser" | "delay";
export type VoiceMode = "poly" | "mono" | "legato";

export type PlayMode = "sustain" | "arp" | "strum" | "pulse" | "drone" | "glide";
export type ArpPattern = "up" | "down" | "updown" | "random" | "chord" | "crawl";
export type Rate = "1/4" | "1/8" | "1/8T" | "1/16" | "1/16T" | "1/32";
export type StrumDir = "down" | "up" | "alternate";

/** The six big knobs. Each is −1..1; 0 leaves the sound exactly as it was made. */
export interface Macros {
  bright: number;
  motion: number;
  space: number;
  grit: number;
  width: number;
  shape: number;
}

/** How written notes are turned into what the synth plays (see play.ts). */
export interface PlaySettings {
  mode: PlayMode;
  /** arpeggio order */
  pattern: ArpPattern;
  /** the step of an arpeggio or a pulse */
  rate: Rate;
  /** how many octaves an arpeggio climbs */
  octaves: 1 | 2 | 3;
  /** how much of each step a note is held, 0.1..1 */
  gate: number;
  /** strum: time between strings, 0..1 = 10..80 ms */
  spread: number;
  direction: StrumDir;
  /** timing and velocity looseness, 0..1 */
  humanise: number;
}

export interface SynthParams {
  /** the ready-made sound this started from ("" if none) */
  preset: string;

  // ── Oscillator
  osc: OscType;
  texture: number;
  mod: number;
  /** white noise mixed with the oscillator (breath, wind, hiss) */
  noise: number;

  // ── LFO
  lfoDest: LfoDest;
  lfoShape: LfoShape;
  lfoDepth: number;
  lfoSpeed: number;
  /** how long the LFO takes to fade in after each note (delayed vibrato), 0..3 s */
  lfoFade: number;

  // ── Filter
  cutoff: number;
  resonance: number;
  /** how far the cutoff follows the keyboard: 0 none, 1 one semitone per semitone */
  keyTrack: number;
  /** how hard the filter is driven (warmth, then growl) */
  drive: number;

  // ── Envelope (one, shared)
  /** 0: the envelope shapes only the loudness; 1: only the filter (the loudness is a plain gate) */
  balance: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;

  // ── Effect
  fx: FxType;
  fxDepth: number;
  fxRate: number;
  reverb: number;

  // ── Voice
  voice: VoiceMode;
  /** portamento time; 0 = none */
  glide: number;
  /** how much playing harder makes a note louder and brighter */
  velocity: number;
  /** slow random wandering of pitch and tone, as old circuits do */
  drift: number;
  /** how far the notes and the effect spread between the speakers */
  width: number;
  volume: number;
  /** loudness trim in dB, set per preset so they all sit at the same level (not a panel knob) */
  trim: number;

  macros: Macros;
  play: PlaySettings;
}

export const OSC_TYPES: OscType[] = ["saw", "pulse", "sync", "ring", "fm"];
export const LFO_DESTS: LfoDest[] = ["off", "amp", "filter", "pitch", "osc"];
export const LFO_SHAPES: LfoShape[] = ["sine", "triangle", "square", "saw", "random"];
export const FX_TYPES: FxType[] = ["dist", "chorus", "phaser", "delay", "off"];
export const VOICE_MODES: VoiceMode[] = ["poly", "mono", "legato"];
export const PLAY_MODES: PlayMode[] = ["sustain", "arp", "strum", "pulse", "drone", "glide"];
export const ARP_PATTERNS: ArpPattern[] = ["up", "down", "updown", "random", "chord", "crawl"];
export const RATES: Rate[] = ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"];
export const STRUM_DIRS: StrumDir[] = ["down", "up", "alternate"];
export const MACRO_KEYS: (keyof Macros)[] = ["bright", "motion", "space", "grit", "width", "shape"];

/** What Texture and Mod do for each oscillator (short names for the panel). */
export const OSC_INFO: Record<OscType, { name: string; texture: string; mod: string; hint: string }> = {
  saw: { name: "Multi Saw", texture: "Sub", mod: "Spread", hint: "Sawtooths: Texture adds a sub-oscillator an octave down, Mod layers seven detuned saws" },
  pulse: { name: "Pulse", texture: "Pitch 2", mod: "Width", hint: "Two square waves: Texture detunes then retunes the second, Mod narrows them both" },
  sync: { name: "Sync", texture: "Pitch 2", mod: "Sweep", hint: "A second oscillator locked to the first: Texture sets its pitch, Mod sweeps it with the envelope" },
  ring: { name: "Ring", texture: "Pitch 1", mod: "Pitch 2", hint: "Two oscillators multiplied: bells, metal and clangs" },
  fm: { name: "FM", texture: "Depth", mod: "Ratio", hint: "One sine wave bending another: Texture is how much, Mod the ratio between them" },
};

export const DEFAULT_MACROS: Macros = { bright: 0, motion: 0, space: 0, grit: 0, width: 0, shape: 0 };

export const DEFAULT_PLAY: PlaySettings = { mode: "sustain", pattern: "up", rate: "1/16", octaves: 1, gate: 0.6, spread: 0.35, direction: "down", humanise: 0 };

/** A plain, playable saw sound: the starting point of every preset and every revived sound. */
export const DEFAULT_PARAMS: SynthParams = {
  preset: "",
  osc: "saw",
  texture: 0,
  mod: 0.3,
  noise: 0,
  lfoDest: "off",
  lfoShape: "sine",
  lfoDepth: 0,
  lfoSpeed: 0.6,
  lfoFade: 0,
  cutoff: 0.62,
  resonance: 0.15,
  keyTrack: 0.5,
  drive: 0.1,
  balance: 0.5,
  attack: 0.05,
  decay: 0.45,
  sustain: 0.7,
  release: 0.35,
  fx: "off",
  fxDepth: 0.4,
  fxRate: 0.4,
  reverb: 0.2,
  voice: "poly",
  glide: 0,
  velocity: 0.4,
  drift: 0.2,
  width: 0.5,
  volume: 0.8,
  trim: 0,
  macros: DEFAULT_MACROS,
  play: DEFAULT_PLAY,
};

// ── Curves: slider position (0..1) to the quantity it controls ──────────────────────────────

/** Cutoff: 20 Hz at the bottom, ten octaves up to 20.5 kHz at the top. */
export const cutoffHz = (x: number) => 20 * Math.pow(2, 10 * x);
export const cutoffOf = (hz: number) => clamp01(Math.log2(Math.max(hz, 20) / 20) / 10);
/** Attack: 1 ms … 8 s, cubic so the short times get most of the slider. */
export const attackSec = (x: number) => 0.001 + 8 * x * x * x;
export const attackOf = (s: number) => clamp01(Math.cbrt(Math.max(0, s - 0.001) / 8));
/** Decay and release: 5 ms … 10 s. */
export const timeSec = (x: number) => 0.005 + 10 * x * x * x;
export const timeOf = (s: number) => clamp01(Math.cbrt(Math.max(0, s - 0.005) / 10));
/** LFO: 0.05 Hz (a 20-second sweep) … 25.6 Hz. */
export const lfoHz = (x: number) => 0.05 * Math.pow(2, 9 * x);
export const lfoOf = (hz: number) => clamp01(Math.log2(Math.max(hz, 0.05) / 0.05) / 9);
/** Portamento: off at 0, then 5 ms … 1.8 s. */
export const glideSec = (x: number) => (x <= 0 ? 0 : 0.005 * Math.pow(2, 8.5 * x));
export const glideOf = (s: number) => (s <= 0 ? 0 : clamp01(Math.log2(s / 0.005) / 8.5));
/** LFO fade-in: 0 … 3 s. */
export const fadeSec = (x: number) => 3 * x * x;
/** Delay effect time: 30 ms … 1.2 s. */
export const delaySec = (x: number) => 0.03 * Math.pow(2, 5.32 * x);
export const delayOf = (s: number) => clamp01(Math.log2(Math.max(s, 0.03) / 0.03) / 5.32);
/** Chorus/flanger and phaser speeds. */
export const chorusHz = (x: number) => 0.05 * Math.pow(2, 7.32 * x);
export const phaserHz = (x: number) => 0.03 * Math.pow(2, 7.64 * x);
/** Distortion tone: a low-pass from 800 Hz to 12 kHz. */
export const distToneHz = (x: number) => 800 * Math.pow(15, x);
/** Resonance: feedback of the four-pole ladder (self-oscillation starts near the top, at 4). */
export const resonanceK = (x: number) => 4.2 * x * x;

/**
 * The Pulse oscillator's second pitch. Up to 0.4 it is detuned from unison up to +30 cents (the
 * two squares beat and thicken); above that it steps through musical intervals.
 */
export const PULSE_STEPS = [-12, -5, 7, 12, 19, 24];
export function pulseInterval(t: number): number {
  if (t < 0.4) return (t / 0.4) * 0.3;
  const i = Math.min(PULSE_STEPS.length - 1, Math.floor(((t - 0.4) / 0.6) * PULSE_STEPS.length));
  return PULSE_STEPS[i];
}

/**
 * A "magnetic" ratio knob: it rests on whole-number ratios for most of its travel and slides
 * through the in-between (inharmonic, bell and metal) ratios in the gaps.
 */
function magnetic(anchors: number[], x: number): number {
  const n = anchors.length - 1;
  const at = clamp01(x) * n;
  const i = Math.min(n - 1, Math.floor(at));
  const f = at - i;
  // hold the anchor for the first and last 30% of each segment
  const s = f < 0.3 ? 0 : f > 0.7 ? 1 : (f - 0.3) / 0.4;
  return anchors[i] * Math.pow(anchors[i + 1] / anchors[i], s);
}
const RING_RATIOS = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8];
const FM_RATIOS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8];
/** Ring: the second oscillator's pitch as a ratio of the note. */
export const ringRatio = (m: number) => magnetic(RING_RATIOS, m);
/** FM: the modulator's pitch as a ratio of the note. */
export const fmRatio = (m: number) => magnetic(FM_RATIOS, m);
/** The knob position for a ratio (the middle of its flat zone when it is one of the anchors). */
export function ratioOf(kind: "ring" | "fm", ratio: number): number {
  const anchors = kind === "ring" ? RING_RATIOS : FM_RATIOS;
  const n = anchors.length - 1;
  for (let i = 0; i < n; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (ratio >= a - 1e-9 && ratio <= b + 1e-9) {
      if (Math.abs(ratio - a) < 1e-9) return i === 0 ? 0 : (i + 0) / n;
      if (Math.abs(ratio - b) < 1e-9) return (i + 1) / n;
      const s = Math.log(ratio / a) / Math.log(b / a);
      return (i + 0.3 + 0.4 * s) / n;
    }
  }
  return ratio < anchors[0] ? 0 : 1;
}
/** FM depth (modulation index, in radians): squared so small amounts are easy to set. */
export const fmIndex = (t: number) => 10 * t * t;

// ── Showing a value ────────────────────────────────────────────────────────────────────────

const ms = (s: number) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(s < 10 ? 1 : 0)} s`);
const hzText = (hz: number) => (hz < 1000 ? `${Math.round(hz)} Hz` : `${(hz / 1000).toFixed(hz < 10000 ? 1 : 0)} kHz`);
const pctText = (v: number) => `${Math.round(v * 100)}`;

/** What a knob is set to, in the units a musician would use. */
export function valueText(key: keyof SynthParams, v: number, p?: SynthParams): string {
  switch (key) {
    case "cutoff":
      return hzText(cutoffHz(v));
    case "attack":
      return ms(attackSec(v));
    case "decay":
    case "release":
      return ms(timeSec(v));
    case "lfoSpeed":
      return `${lfoHz(v) < 1 ? lfoHz(v).toFixed(2) : lfoHz(v).toFixed(1)} Hz`;
    case "lfoFade":
      return v <= 0 ? "0" : ms(fadeSec(v));
    case "glide":
      return v <= 0 ? "Off" : ms(glideSec(v));
    case "trim":
      return `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
    case "balance":
      return v < 0.02 ? "Amp" : v > 0.98 ? "Filter" : `${Math.round((1 - v) * 100)}/${Math.round(v * 100)}`;
    case "texture":
    case "mod":
      return p ? oscText(p.osc, key, v) : pctText(v);
    case "fxRate":
      if (p?.fx === "delay") return ms(delaySec(v));
      if (p?.fx === "dist") return hzText(distToneHz(v));
      if (p?.fx === "chorus") return `${chorusHz(v).toFixed(chorusHz(v) < 1 ? 2 : 1)} Hz`;
      if (p?.fx === "phaser") return `${phaserHz(v).toFixed(phaserHz(v) < 1 ? 2 : 1)} Hz`;
      return pctText(v);
    default:
      return pctText(v);
  }
}

function oscText(osc: OscType, key: "texture" | "mod", v: number): string {
  if (osc === "pulse" && key === "texture") {
    const iv = pulseInterval(v);
    return v < 0.4 ? `+${Math.round(iv * 100)} ct` : `${iv > 0 ? "+" : ""}${iv} st`;
  }
  if (osc === "pulse" && key === "mod") return `${Math.round(50 + 45 * v)}%`;
  if (osc === "sync" && key === "texture") return `+${(36 * v).toFixed(0)} st`;
  if (osc === "ring" && key === "texture") return `+${(24 * v).toFixed(1)} st`;
  if (osc === "ring" && key === "mod") return `×${ringRatio(v).toFixed(2)}`;
  if (osc === "fm" && key === "mod") return `×${fmRatio(v).toFixed(2)}`;
  if (osc === "fm" && key === "texture") return fmIndex(v).toFixed(1);
  return pctText(v);
}

// ── Making a stored sound whole and safe ───────────────────────────────────────────────────

export function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
const num = (v: unknown, d: number, min = 0, max = 1) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const pick = <T extends string | number>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

/**
 * A sound from storage (or from an older version of the app, or half-written), made whole: every
 * missing or broken knob falls back to the default, numbers are clamped to their range, unknown
 * names are replaced and unknown fields are dropped.
 */
export function reviveSynth(raw: unknown): SynthParams {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PARAMS;
  const m = (r.macros && typeof r.macros === "object" ? r.macros : {}) as Record<string, unknown>;
  const pl = (r.play && typeof r.play === "object" ? r.play : {}) as Record<string, unknown>;
  const dp = DEFAULT_PLAY;
  return {
    preset: typeof r.preset === "string" ? r.preset.slice(0, 64) : d.preset,
    osc: pick(r.osc, OSC_TYPES, d.osc),
    texture: num(r.texture, d.texture),
    mod: num(r.mod, d.mod),
    noise: num(r.noise, d.noise),
    lfoDest: pick(r.lfoDest, LFO_DESTS, d.lfoDest),
    lfoShape: pick(r.lfoShape, LFO_SHAPES, d.lfoShape),
    lfoDepth: num(r.lfoDepth, d.lfoDepth),
    lfoSpeed: num(r.lfoSpeed, d.lfoSpeed),
    lfoFade: num(r.lfoFade, d.lfoFade),
    cutoff: num(r.cutoff, d.cutoff),
    resonance: num(r.resonance, d.resonance),
    keyTrack: num(r.keyTrack, d.keyTrack),
    drive: num(r.drive, d.drive),
    balance: num(r.balance, d.balance),
    attack: num(r.attack, d.attack),
    decay: num(r.decay, d.decay),
    sustain: num(r.sustain, d.sustain),
    release: num(r.release, d.release),
    fx: pick(r.fx, FX_TYPES, d.fx),
    fxDepth: num(r.fxDepth, d.fxDepth),
    fxRate: num(r.fxRate, d.fxRate),
    reverb: num(r.reverb, d.reverb),
    voice: pick(r.voice, VOICE_MODES, d.voice),
    glide: num(r.glide, d.glide),
    velocity: num(r.velocity, d.velocity),
    drift: num(r.drift, d.drift),
    width: num(r.width, d.width),
    volume: num(r.volume, d.volume),
    trim: num(r.trim, d.trim, -24, 24),
    macros: {
      bright: num(m.bright, 0, -1, 1),
      motion: num(m.motion, 0, -1, 1),
      space: num(m.space, 0, -1, 1),
      grit: num(m.grit, 0, -1, 1),
      width: num(m.width, 0, -1, 1),
      shape: num(m.shape, 0, -1, 1),
    },
    play: {
      mode: pick(pl.mode, PLAY_MODES, dp.mode),
      pattern: pick(pl.pattern, ARP_PATTERNS, dp.pattern),
      rate: pick(pl.rate, RATES, dp.rate),
      octaves: pick(pl.octaves, [1, 2, 3] as const, dp.octaves),
      gate: num(pl.gate, dp.gate, 0.1, 1),
      spread: num(pl.spread, dp.spread),
      direction: pick(pl.direction, STRUM_DIRS, dp.direction),
      humanise: num(pl.humanise, dp.humanise),
    },
  };
}

/** The knobs that are plain 0..1 numbers (what macros and the panel move). */
export type UnitKey = Exclude<{ [K in keyof SynthParams]: SynthParams[K] extends number ? K : never }[keyof SynthParams], "trim">;
export const UNIT_KEYS: UnitKey[] = [
  "texture", "mod", "noise", "lfoDepth", "lfoSpeed", "lfoFade", "cutoff", "resonance", "keyTrack", "drive", "balance",
  "attack", "decay", "sustain", "release", "fxDepth", "fxRate", "reverb", "glide", "velocity", "drift", "width", "volume",
];

/** Two sounds are the same if every knob matches (volume is a mixing choice and is ignored). */
export function sameSynth(a: SynthParams, b: SynthParams): boolean {
  if (a.osc !== b.osc || a.lfoDest !== b.lfoDest || a.lfoShape !== b.lfoShape || a.fx !== b.fx || a.voice !== b.voice) return false;
  for (const k of UNIT_KEYS) if (k !== "volume" && Math.abs(a[k] - b[k]) > 1e-6) return false;
  for (const k of MACRO_KEYS) if (Math.abs(a.macros[k] - b.macros[k]) > 1e-6) return false;
  const p = a.play;
  const q = b.play;
  return p.mode === q.mode && p.pattern === q.pattern && p.rate === q.rate && p.octaves === q.octaves && p.direction === q.direction
    && Math.abs(p.gate - q.gate) < 1e-6 && Math.abs(p.spread - q.spread) < 1e-6 && Math.abs(p.humanise - q.humanise) < 1e-6;
}
