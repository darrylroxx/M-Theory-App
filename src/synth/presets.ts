/**
 * Ready-made sounds, by kind, so nobody starts from a blank panel. Each is a whole sound (every
 * knob, a suggested way of playing) that can then be reshaped with the macros or the panel.
 *
 * The recipes follow the research notes (synth_design.md, section 3): plucks have no sustain and
 * a falling filter, brass has a quick filter "blat" and velocity on brightness, pads have slow
 * attacks and detuned saws or moving pulse widths with chorus, bells use ring or FM ratios that
 * are not whole numbers, acid sounds are resonant with a falling filter and a gliding mono voice.
 * The numbers are this app's own; they are written in musical units below and turned into knob
 * positions by the inverse curves in params.ts.
 *
 * `trim` was measured (see presets.test.ts and the level-matching notes there) so that every
 * preset, played the way it suggests, arrives at about the same loudness. Named for how they
 * sound, never after a player, a record or a product.
 */
import {
  type ArpPattern,
  type PlayMode,
  type Rate,
  type StrumDir,
  type SynthParams,
  DEFAULT_PARAMS,
  DEFAULT_PLAY,
  attackOf,
  cutoffOf,
  delayOf,
  glideOf,
  lfoOf,
  ratioOf,
  reviveSynth,
  timeOf,
} from "./params";

export type PresetCategory = "bass" | "lead" | "pad" | "keys" | "pluck" | "brass" | "strings" | "bells" | "drone" | "fx" | "arp" | "init";

export const CATEGORIES: { id: PresetCategory; name: string }[] = [
  { id: "bass", name: "Bass" },
  { id: "lead", name: "Lead" },
  { id: "pad", name: "Pad" },
  { id: "keys", name: "Keys" },
  { id: "pluck", name: "Pluck" },
  { id: "brass", name: "Brass" },
  { id: "strings", name: "Strings" },
  { id: "bells", name: "Bells" },
  { id: "drone", name: "Drone" },
  { id: "fx", name: "FX" },
  { id: "arp", name: "Arp" },
  { id: "init", name: "Init" },
];

export interface SynthPreset {
  id: string;
  name: string;
  category: PresetCategory;
  /** one line: what it is good for */
  hint: string;
  params: SynthParams;
}

/** What a recipe may set: any knob in musical units, plus a way of playing. */
interface Recipe extends Partial<Omit<SynthParams, "play" | "macros" | "cutoff" | "attack" | "decay" | "release" | "lfoSpeed" | "glide">> {
  /** Hz */
  cutoff?: number;
  /** seconds */
  attack?: number;
  decay?: number;
  release?: number;
  /** Hz */
  lfoSpeed?: number;
  /** seconds (0 = none) */
  glide?: number;
  /** seconds, for the delay effect (sets fxRate) */
  echo?: number;
  play?: Partial<{ mode: PlayMode; pattern: ArpPattern; rate: Rate; octaves: 1 | 2 | 3; gate: number; spread: number; direction: StrumDir; humanise: number }>;
}

/** Everything a recipe does not mention: no LFO, no effect, a little room. */
const BASE: Partial<SynthParams> = { lfoDest: "off", lfoDepth: 0, fx: "off", fxDepth: 0.35, fxRate: 0.45, reverb: 0.15, drift: 0.2 };

function preset(id: string, name: string, category: PresetCategory, hint: string, r: Recipe): SynthPreset {
  const { cutoff, attack, decay, release, lfoSpeed, glide, echo, play, ...rest } = r;
  const raw: Record<string, unknown> = { ...DEFAULT_PARAMS, ...BASE, ...rest, preset: id, play: { ...DEFAULT_PLAY, ...play } };
  if (cutoff !== undefined) raw.cutoff = cutoffOf(cutoff);
  if (attack !== undefined) raw.attack = attackOf(attack);
  if (decay !== undefined) raw.decay = timeOf(decay);
  if (release !== undefined) raw.release = timeOf(release);
  if (lfoSpeed !== undefined) raw.lfoSpeed = lfoOf(lfoSpeed);
  if (glide !== undefined) raw.glide = glideOf(glide);
  if (echo !== undefined) raw.fxRate = delayOf(echo);
  return { id, name, category, hint, params: reviveSynth(raw) };
}

const fm = (ratio: number) => ratioOf("fm", ratio);
const ring = (ratio: number) => ratioOf("ring", ratio);
/** Pulse Texture positions for the second square's steps (+7, +12, +19, +24). */
const FIFTH = 0.65;
const OCTAVE = 0.75;
const TWELFTH = 0.85;
const TWO_OCT = 0.95;

export const PRESETS: SynthPreset[] = [
  // ── Bass
  preset("sub-bass", "Sub Bass", "bass", "Deep and round, felt more than heard", {
    osc: "pulse", texture: 0, mod: 0, cutoff: 170, resonance: 0, keyTrack: 0.5, drive: 0.15, balance: 0.3, attack: 0.002, decay: 0.3, sustain: 1, release: 0.08,
    voice: "mono", glide: 0.025, velocity: 0.3, reverb: 0, width: 0, drift: 0.05, trim: 0.5,
  }),
  preset("acid-bass", "Acid Bass", "bass", "Squelchy and resonant; play harder for more bite", {
    osc: "saw", texture: 0, mod: 0, cutoff: 260, resonance: 0.82, keyTrack: 0.3, drive: 0.35, balance: 0.85, attack: 0.001, decay: 0.28, sustain: 0, release: 0.05,
    voice: "legato", glide: 0.06, velocity: 0.75, fx: "dist", fxDepth: 0.3, fxRate: 0.6, reverb: 0, width: 0, drift: 0.1, trim: -2.3,
  }),
  preset("saw-bass", "Saw Bass", "bass", "A saw with a sub underneath: solid under anything", {
    osc: "saw", texture: 0.75, mod: 0.12, cutoff: 650, resonance: 0.2, keyTrack: 0.5, drive: 0.2, balance: 0.6, attack: 0.002, decay: 0.35, sustain: 0.45, release: 0.1,
    voice: "mono", glide: 0.02, velocity: 0.45, reverb: 0, width: 0.1, trim: 0.8,
  }),
  preset("fm-bass", "FM Bass", "bass", "Woody and punchy, brighter the harder you play", {
    osc: "fm", texture: 0.36, mod: fm(1), cutoff: 2600, resonance: 0, keyTrack: 0.4, balance: 0.35, attack: 0.001, decay: 0.5, sustain: 0.4, release: 0.1,
    voice: "mono", glide: 0, velocity: 0.65, fx: "dist", fxDepth: 0.12, fxRate: 0.5, reverb: 0, width: 0, trim: 4.7,
  }),
  preset("rubber-bass", "Rubber Bass", "bass", "Bouncy, with a little slide between notes", {
    osc: "pulse", texture: 0.1, mod: 0.55, cutoff: 240, resonance: 0.45, keyTrack: 0.4, drive: 0.2, balance: 0.75, attack: 0.001, decay: 0.2, sustain: 0.3, release: 0.06,
    voice: "legato", glide: 0.045, velocity: 0.55, reverb: 0, width: 0, trim: 4.6,
  }),
  preset("sync-bass", "Sync Bass", "bass", "Hollow and growling", {
    osc: "sync", texture: 0.25, mod: 0.3, cutoff: 1300, resonance: 0.2, keyTrack: 0.5, drive: 0.25, balance: 0.45, attack: 0.001, decay: 0.3, sustain: 0.6, release: 0.08,
    voice: "mono", velocity: 0.5, reverb: 0, width: 0, trim: 0.1,
  }),

  // ── Lead
  preset("supersaw-lead", "Supersaw Lead", "lead", "Huge and shining, with a slow vibrato", {
    osc: "saw", texture: 0.2, mod: 0.75, cutoff: 6500, resonance: 0.1, balance: 0.2, attack: 0.004, decay: 0.5, sustain: 1, release: 0.25,
    voice: "legato", glide: 0.04, lfoDest: "pitch", lfoDepth: 0.22, lfoSpeed: 5.5, lfoFade: 0.5, fx: "delay", fxDepth: 0.35, echo: 0.36, reverb: 0.25, width: 0.7, trim: -3.1,
    play: { mode: "glide" },
  }),
  preset("sync-lead", "Sync Lead", "lead", "Biting and vocal; the tone sweeps on every note", {
    osc: "sync", texture: 0.55, mod: 0.45, cutoff: 4200, resonance: 0.2, balance: 0.55, attack: 0.002, decay: 0.6, sustain: 0.7, release: 0.15,
    voice: "legato", glide: 0.03, lfoDest: "pitch", lfoDepth: 0.22, lfoSpeed: 5.8, lfoFade: 0.4, fx: "dist", fxDepth: 0.22, fxRate: 0.55, reverb: 0.15, trim: 2.7,
    play: { mode: "glide" },
  }),
  preset("pwm-lead", "PWM Lead", "lead", "A square whose width breathes", {
    osc: "pulse", texture: 0, mod: 0.3, cutoff: 2600, resonance: 0.25, balance: 0.5, attack: 0.005, decay: 0.5, sustain: 0.85, release: 0.2,
    voice: "legato", glide: 0.06, lfoDest: "osc", lfoDepth: 0.35, lfoSpeed: 1.2, fx: "delay", fxDepth: 0.3, echo: 0.3, reverb: 0.2, trim: -1,
    play: { mode: "glide" },
  }),
  preset("square-lead", "Square Lead", "lead", "Plain, clear, a bit retro", {
    osc: "pulse", texture: 0.12, mod: 0, cutoff: 3200, resonance: 0.15, balance: 0.4, attack: 0.003, decay: 0.4, sustain: 0.9, release: 0.12,
    voice: "mono", glide: 0.03, lfoDest: "pitch", lfoDepth: 0.2, lfoSpeed: 5.5, lfoFade: 0.55, reverb: 0.2, trim: 0.9,
    play: { mode: "glide" },
  }),
  preset("screamer", "Screamer", "lead", "Overdriven and wailing", {
    osc: "saw", texture: 0.1, mod: 0.4, cutoff: 950, resonance: 0.68, drive: 0.6, balance: 0.6, attack: 0.002, decay: 0.8, sustain: 0.6, release: 0.18,
    voice: "legato", glide: 0.05, lfoDest: "pitch", lfoDepth: 0.2, lfoSpeed: 6, lfoFade: 0.5, fx: "dist", fxDepth: 0.45, fxRate: 0.65, reverb: 0.2, trim: -6.1,
    play: { mode: "glide" },
  }),
  preset("whistle", "Whistle", "lead", "Soft and breathy, like a flute", {
    osc: "fm", texture: 0.12, mod: fm(2), noise: 0.1, cutoff: 6000, resonance: 0, balance: 0.2, attack: 0.04, decay: 0.6, sustain: 0.9, release: 0.25,
    voice: "legato", glide: 0.08, lfoDest: "pitch", lfoDepth: 0.24, lfoSpeed: 5, lfoFade: 0.6, fx: "delay", fxDepth: 0.25, echo: 0.42, reverb: 0.35, trim: -3.4,
    play: { mode: "glide" },
  }),

  // ── Pad
  preset("pulse-pad", "Pulse Pad", "pad", "Warm and slowly shifting", {
    osc: "pulse", texture: 0.08, mod: 0.4, cutoff: 2100, resonance: 0.1, balance: 0.4, attack: 0.7, decay: 1.5, sustain: 0.85, release: 1.2,
    lfoDest: "osc", lfoDepth: 0.5, lfoSpeed: 0.4, fx: "chorus", fxDepth: 0.5, fxRate: 0.3, reverb: 0.4, width: 0.7, trim: -4,
  }),
  preset("warm-pad", "Warm Pad", "pad", "Detuned saws, soft and wide", {
    osc: "saw", texture: 0.2, mod: 0.7, cutoff: 1500, resonance: 0.15, balance: 0.35, attack: 0.9, decay: 2, sustain: 0.9, release: 1.5,
    lfoDest: "filter", lfoDepth: 0.25, lfoSpeed: 0.15, fx: "chorus", fxDepth: 0.4, fxRate: 0.25, reverb: 0.45, width: 0.8, trim: -8.2,
  }),
  preset("glass-pad", "Glass Pad", "pad", "Clear and shimmering", {
    osc: "fm", texture: 0.25, mod: fm(2), cutoff: 7000, resonance: 0, balance: 0.3, attack: 1.2, decay: 2, sustain: 0.85, release: 1.6,
    lfoDest: "osc", lfoDepth: 0.2, lfoSpeed: 0.3, fx: "delay", fxDepth: 0.35, echo: 0.5, reverb: 0.5, width: 0.7, trim: -10.1,
  }),
  preset("dark-pad", "Dark Pad", "pad", "Low, murky and moving", {
    osc: "saw", texture: 0.3, mod: 0.5, cutoff: 480, resonance: 0.3, balance: 0.3, attack: 1.5, decay: 2.5, sustain: 0.9, release: 2,
    lfoDest: "filter", lfoDepth: 0.32, lfoSpeed: 0.08, fx: "phaser", fxDepth: 0.4, fxRate: 0.15, reverb: 0.5, width: 0.6, drift: 0.35, trim: -5.9,
  }),
  preset("choir-pad", "Choir Pad", "pad", "Like voices singing \"aah\"", {
    osc: "saw", texture: 0, mod: 0.35, noise: 0.06, cutoff: 1100, resonance: 0.55, keyTrack: 0.3, balance: 0.3, attack: 0.6, decay: 1.5, sustain: 0.9, release: 1.2,
    lfoDest: "pitch", lfoDepth: 0.18, lfoSpeed: 4.5, lfoFade: 0.5, fx: "chorus", fxDepth: 0.55, fxRate: 0.3, reverb: 0.5, width: 0.7, trim: -6.5,
  }),
  preset("wide-pad", "Wide Pad", "pad", "Bright, enormous and far away", {
    osc: "saw", texture: 0, mod: 0.9, cutoff: 3500, resonance: 0.1, balance: 0.3, attack: 1, decay: 2, sustain: 0.9, release: 2.5,
    fx: "delay", fxDepth: 0.45, echo: 0.42, reverb: 0.65, width: 0.95, trim: -8.8,
  }),

  // ── Keys
  preset("fm-piano", "FM Piano", "keys", "A bell-like electric piano that answers your touch", {
    osc: "fm", texture: 0.38, mod: fm(1), cutoff: 900, resonance: 0, keyTrack: 0.6, balance: 0.5, attack: 0.001, decay: 1.8, sustain: 0.15, release: 0.5,
    velocity: 0.75, lfoDest: "amp", lfoDepth: 0.18, lfoSpeed: 4.5, fx: "chorus", fxDepth: 0.3, fxRate: 0.3, reverb: 0.2, trim: 0,
  }),
  preset("square-organ", "Square Organ", "keys", "Steady and reedy, with a rotating shimmer", {
    osc: "pulse", texture: OCTAVE, mod: 0, cutoff: 5000, resonance: 0, balance: 0, attack: 0.003, decay: 0.1, sustain: 1, release: 0.03,
    velocity: 0, fx: "phaser", fxDepth: 0.35, fxRate: 0.4, reverb: 0.25, trim: -1,
  }),
  preset("poly-keys", "Poly Keys", "keys", "A classic polysynth chord sound", {
    osc: "saw", texture: 0, mod: 0.3, cutoff: 600, resonance: 0.3, balance: 0.75, attack: 0.001, decay: 0.6, sustain: 0.35, release: 0.3,
    velocity: 0.6, fx: "delay", fxDepth: 0.25, echo: 0.33, reverb: 0.2, trim: -3.7,
  }),
  preset("funky-snap", "Funky Snap", "keys", "Short, nasal and percussive", {
    osc: "pulse", texture: 0, mod: 0.75, cutoff: 1200, resonance: 0.35, balance: 0.7, attack: 0.001, decay: 0.35, sustain: 0.1, release: 0.08,
    velocity: 0.7, fx: "phaser", fxDepth: 0.25, fxRate: 0.5, reverb: 0.1, trim: 2.8,
  }),
  preset("chapel-organ", "Chapel Organ", "keys", "Pipes and air in a big room", {
    osc: "pulse", texture: TWELFTH, mod: 0.2, noise: 0.03, cutoff: 3000, resonance: 0, balance: 0.1, attack: 0.06, decay: 0.5, sustain: 1, release: 0.4,
    velocity: 0, lfoDest: "pitch", lfoDepth: 0.1, lfoSpeed: 5.5, reverb: 0.55, width: 0.6, trim: -5,
  }),

  // ── Pluck
  preset("saw-pluck", "Saw Pluck", "pluck", "Bright pick, quick fall, an echo behind", {
    osc: "saw", texture: 0, mod: 0.25, cutoff: 250, resonance: 0.25, keyTrack: 0.7, balance: 0.55, attack: 0.001, decay: 0.35, sustain: 0, release: 0.35,
    fx: "delay", fxDepth: 0.35, echo: 0.35, reverb: 0.25, trim: 5.4,
  }),
  preset("pulse-pluck", "Pulse Pluck", "pluck", "Glassy, hollow plucks an octave apart", {
    osc: "pulse", texture: OCTAVE, mod: 0.45, cutoff: 400, resonance: 0.1, balance: 0.6, attack: 0.001, decay: 0.5, sustain: 0, release: 0.45,
    fx: "delay", fxDepth: 0.3, echo: 0.25, reverb: 0.2, trim: 6.7,
  }),
  preset("harp-pluck", "Harp Pluck", "pluck", "Soft plucked strings: strum it", {
    osc: "pulse", texture: 0, mod: 0.15, cutoff: 500, resonance: 0, keyTrack: 0.7, balance: 0.5, attack: 0.001, decay: 0.9, sustain: 0, release: 0.9,
    fx: "chorus", fxDepth: 0.25, fxRate: 0.2, reverb: 0.35, trim: 2.8,
    play: { mode: "strum", spread: 0.45, direction: "down" },
  }),
  preset("wood-pluck", "Wood Pluck", "pluck", "Like a struck wooden bar", {
    osc: "fm", texture: 0.3, mod: fm(3.5), cutoff: 5000, resonance: 0, balance: 0.15, attack: 0.001, decay: 0.5, sustain: 0, release: 0.5,
    velocity: 0.6, reverb: 0.25, trim: 2.5,
  }),
  preset("muted-pluck", "Muted Pluck", "pluck", "Short and dampened, good for rhythm", {
    osc: "saw", texture: 0, mod: 0, cutoff: 190, resonance: 0.4, drive: 0.3, keyTrack: 0.6, balance: 0.7, attack: 0.001, decay: 0.2, sustain: 0, release: 0.12,
    velocity: 0.6, reverb: 0.1, trim: 2.1,
    play: { mode: "pulse", rate: "1/8", gate: 0.5 },
  }),

  // ── Brass
  preset("synth-brass", "Synth Brass", "brass", "Bold, rising swells; dig in for brightness", {
    osc: "saw", texture: 0.15, mod: 0.3, cutoff: 420, resonance: 0.15, keyTrack: 0.9, balance: 0.6, attack: 0.06, decay: 0.8, sustain: 0.75, release: 0.25,
    velocity: 0.6, lfoDest: "pitch", lfoDepth: 0.18, lfoSpeed: 5.3, lfoFade: 0.4, fx: "chorus", fxDepth: 0.3, fxRate: 0.3, reverb: 0.25, trim: -4.9,
  }),
  preset("brass-stab", "Brass Stab", "brass", "Short punchy hits on the beat", {
    osc: "saw", texture: 0.08, mod: 0.4, cutoff: 520, resonance: 0.2, keyTrack: 0.8, balance: 0.68, attack: 0.008, decay: 0.3, sustain: 0.35, release: 0.15,
    velocity: 0.6, reverb: 0.2, trim: -0.6,
    play: { mode: "pulse", rate: "1/4", gate: 0.35 },
  }),
  preset("soft-horns", "Soft Horns", "brass", "Mellow, round and warm", {
    osc: "pulse", texture: 0.06, mod: 0.2, cutoff: 460, resonance: 0.1, keyTrack: 0.8, balance: 0.55, attack: 0.12, decay: 0.9, sustain: 0.7, release: 0.35,
    velocity: 0.5, lfoDest: "pitch", lfoDepth: 0.15, lfoSpeed: 5, lfoFade: 0.5, fx: "chorus", fxDepth: 0.25, fxRate: 0.25, reverb: 0.3, trim: -1.6,
  }),

  // ── Strings
  preset("ensemble-strings", "Ensemble Strings", "strings", "A lush string section", {
    osc: "pulse", texture: 0.05, mod: 0.35, cutoff: 2200, resonance: 0.05, balance: 0.25, attack: 0.35, decay: 1, sustain: 0.9, release: 0.6,
    lfoDest: "osc", lfoDepth: 0.45, lfoSpeed: 0.6, fx: "chorus", fxDepth: 0.65, fxRate: 0.35, reverb: 0.4, width: 0.75, trim: -4.1,
  }),
  preset("saw-strings", "Saw Strings", "strings", "Bowed and bright, with vibrato", {
    osc: "saw", texture: 0, mod: 0.55, cutoff: 1800, resonance: 0.05, balance: 0.25, attack: 0.4, decay: 1, sustain: 0.9, release: 0.7,
    lfoDest: "pitch", lfoDepth: 0.15, lfoSpeed: 5, lfoFade: 0.5, fx: "phaser", fxDepth: 0.3, fxRate: 0.2, reverb: 0.4, width: 0.7, trim: -4.3,
  }),
  preset("pizzicato", "Pizzicato", "strings", "Plucked strings, short and light", {
    osc: "saw", texture: 0, mod: 0.4, cutoff: 650, resonance: 0.05, keyTrack: 0.8, balance: 0.5, attack: 0.001, decay: 0.32, sustain: 0, release: 0.3,
    velocity: 0.5, reverb: 0.3, trim: 4.9,
  }),

  // ── Bells
  preset("ring-bell", "Ring Bell", "bells", "Metallic, clanging and bright", {
    osc: "ring", texture: 0, mod: ring(2.76), cutoff: 6000, resonance: 0, balance: 0.2, attack: 0.001, decay: 1.4, sustain: 0, release: 1.4,
    fx: "delay", fxDepth: 0.3, echo: 0.38, reverb: 0.4, trim: -1,
  }),
  preset("fm-bell", "FM Bell", "bells", "A clear tuned bell", {
    osc: "fm", texture: 0.55, mod: fm(3.5), cutoff: 9000, resonance: 0, balance: 0.25, attack: 0.001, decay: 2, sustain: 0, release: 2,
    velocity: 0.5, reverb: 0.4, trim: -5.9,
  }),
  preset("glass-chime", "Glass Chime", "bells", "High, delicate and glassy", {
    osc: "fm", texture: 0.4, mod: fm(7), cutoff: 12000, resonance: 0, balance: 0.2, attack: 0.001, decay: 1.2, sustain: 0, release: 1.2,
    velocity: 0.5, fx: "delay", fxDepth: 0.3, echo: 0.3, reverb: 0.45, trim: -3.5,
    play: { mode: "strum", spread: 0.8, direction: "up" },
  }),
  preset("music-box", "Music Box", "bells", "Tiny and tinkling", {
    osc: "pulse", texture: TWO_OCT, mod: 0.6, cutoff: 3000, resonance: 0, keyTrack: 0.6, balance: 0.15, attack: 0.001, decay: 0.7, sustain: 0, release: 0.7,
    velocity: 0.3, reverb: 0.35, trim: 5.3,
  }),

  // ── Drone
  preset("saw-drone", "Evolving Drone", "drone", "A slow, deep wash that never quite repeats", {
    osc: "saw", texture: 0.55, mod: 0.2, cutoff: 450, resonance: 0.3, balance: 0.5, attack: 5, decay: 9, sustain: 1, release: 6,
    lfoDest: "filter", lfoDepth: 0.35, lfoSpeed: 0.07, fx: "phaser", fxDepth: 0.35, fxRate: 0.05, reverb: 0.55, width: 0.8, drift: 0.5, trim: -4,
    play: { mode: "drone" },
  }),
  preset("ring-drone", "Beating Drone", "drone", "Two tones rubbing slowly against each other", {
    osc: "ring", texture: 0, mod: ring(1.02), cutoff: 1500, resonance: 0.2, balance: 0.3, attack: 6, decay: 9, sustain: 1, release: 6,
    lfoDest: "osc", lfoDepth: 0.15, lfoSpeed: 0.06, fx: "delay", fxDepth: 0.45, echo: 0.8, reverb: 0.5, width: 0.7, trim: -4.9,
    play: { mode: "drone" },
  }),
  preset("dark-drone", "Dark Drone", "drone", "Low, rumbling, faintly menacing", {
    osc: "pulse", texture: 0.12, mod: 0.2, cutoff: 300, resonance: 0.4, balance: 0.4, attack: 4, decay: 9, sustain: 1, release: 5,
    lfoDest: "filter", lfoDepth: 0.4, lfoSpeed: 0.05, reverb: 0.6, width: 0.7, drift: 0.6, trim: -3.8,
    play: { mode: "drone" },
  }),
  preset("glass-drone", "Glass Drone", "drone", "High and luminous, softly turning", {
    osc: "fm", texture: 0.2, mod: fm(2), cutoff: 6000, resonance: 0, balance: 0.3, attack: 3, decay: 9, sustain: 1, release: 5,
    lfoDest: "osc", lfoDepth: 0.3, lfoSpeed: 0.08, fx: "chorus", fxDepth: 0.5, fxRate: 0.1, reverb: 0.6, width: 0.85, trim: -9.7,
    play: { mode: "drone" },
  }),

  // ── FX / texture
  preset("sync-riser", "Sync Riser", "fx", "A long rising sweep: hold a chord", {
    osc: "sync", texture: 0.3, mod: 1, cutoff: 3000, resonance: 0.3, balance: 1, attack: 8, decay: 9, sustain: 1, release: 1.5,
    lfoDest: "pitch", lfoDepth: 0.2, lfoSpeed: 0.2, fx: "delay", fxDepth: 0.5, echo: 0.6, reverb: 0.4, trim: -10.7,
  }),
  preset("ring-chaos", "Ring Chaos", "fx", "Unruly, metallic and jittery", {
    osc: "ring", texture: 0.6, mod: 0.7, cutoff: 4000, resonance: 0.4, balance: 0.4, attack: 0.05, decay: 1, sustain: 0.7, release: 0.8,
    lfoDest: "pitch", lfoShape: "random", lfoDepth: 0.75, lfoSpeed: 8, fx: "phaser", fxDepth: 0.6, fxRate: 0.7, reverb: 0.3, trim: -2.7,
  }),
  preset("wind", "Wind", "fx", "Air whistling past: higher keys, higher whistle", {
    osc: "saw", noise: 1, cutoff: 700, resonance: 0.8, keyTrack: 1, balance: 0.3, attack: 1.5, decay: 4, sustain: 1, release: 2.5,
    lfoDest: "filter", lfoDepth: 0.45, lfoSpeed: 0.12, reverb: 0.5, width: 0.9, velocity: 0.2, trim: -6.9,
  }),
  preset("laser-zap", "Laser Zap", "fx", "A falling zap on every note", {
    osc: "sync", texture: 0.1, mod: 1, cutoff: 5000, resonance: 0.2, balance: 0.3, attack: 0.001, decay: 0.4, sustain: 0, release: 0.3,
    fx: "delay", fxDepth: 0.35, echo: 0.2, reverb: 0.2, trim: 2.6,
  }),

  // ── Arp
  preset("arp-pluck", "Arp Pluck", "arp", "Rippling sixteenths over two octaves", {
    osc: "saw", texture: 0, mod: 0.15, cutoff: 450, resonance: 0.45, keyTrack: 0.6, balance: 0.8, attack: 0.001, decay: 0.2, sustain: 0, release: 0.15,
    fx: "delay", fxDepth: 0.4, echo: 0.375, reverb: 0.2, trim: 2.8,
    play: { mode: "arp", pattern: "up", rate: "1/16", octaves: 2, gate: 0.5 },
  }),
  preset("square-arp", "Square Arp", "arp", "Bright up-and-down chiptune steps", {
    osc: "pulse", texture: 0, mod: 0.7, cutoff: 2600, resonance: 0.1, balance: 0.4, attack: 0.001, decay: 0.18, sustain: 0, release: 0.12,
    fx: "delay", fxDepth: 0.3, echo: 0.25, reverb: 0.15, trim: 9,
    play: { mode: "arp", pattern: "updown", rate: "1/16", octaves: 1, gate: 0.6 },
  }),
  preset("bubble-arp", "Bubble Arp", "arp", "Round, bubbling notes in a random order", {
    osc: "fm", texture: 0.3, mod: fm(2), cutoff: 4000, resonance: 0, balance: 0.3, attack: 0.001, decay: 0.15, sustain: 0, release: 0.1,
    fx: "delay", fxDepth: 0.35, echo: 0.3, reverb: 0.25, trim: 4.3,
    play: { mode: "arp", pattern: "random", rate: "1/16T", octaves: 2, gate: 0.5 },
  }),
  preset("crawl-arp", "Crawling Arp", "arp", "Climbing patterns that creep up the chord", {
    osc: "saw", texture: 0.1, mod: 0.5, cutoff: 1200, resonance: 0.3, balance: 0.6, attack: 0.001, decay: 0.3, sustain: 0.2, release: 0.2,
    fx: "chorus", fxDepth: 0.3, fxRate: 0.3, reverb: 0.25, trim: 3.8,
    play: { mode: "arp", pattern: "crawl", rate: "1/8", octaves: 2, gate: 0.7 },
  }),
  preset("chord-arp", "Chord Pulse", "arp", "The whole chord in eighths, jumping octaves", {
    osc: "pulse", texture: FIFTH, mod: 0.4, cutoff: 900, resonance: 0.25, balance: 0.65, attack: 0.001, decay: 0.2, sustain: 0.1, release: 0.12,
    fx: "delay", fxDepth: 0.25, echo: 0.375, reverb: 0.2, trim: 5.3,
    play: { mode: "arp", pattern: "chord", rate: "1/8", octaves: 2, gate: 0.45 },
  }),

  // ── Init: one plain start per oscillator, for building from scratch
  preset("init-saw", "Init Saw", "init", "A plain saw to build from", { osc: "saw", mod: 0, reverb: 0, trim: -4.1 }),
  preset("init-pulse", "Init Pulse", "init", "A plain square to build from", { osc: "pulse", texture: 0, mod: 0, reverb: 0, trim: -4.6 }),
  preset("init-sync", "Init Sync", "init", "Plain hard sync to build from", { osc: "sync", texture: 0.3, mod: 0, reverb: 0, trim: -4.8 }),
  preset("init-ring", "Init Ring", "init", "Plain ring modulation to build from", { osc: "ring", texture: 0, mod: ring(2), reverb: 0, trim: -4.7 }),
  preset("init-fm", "Init FM", "init", "Plain FM to build from", { osc: "fm", texture: 0.3, mod: fm(1), cutoff: 8000, reverb: 0, trim: -3.8 }),
];

export const presetById = (id: string): SynthPreset | undefined => PRESETS.find((p) => p.id === id);
export const presetsIn = (c: PresetCategory): SynthPreset[] => PRESETS.filter((p) => p.category === c);
