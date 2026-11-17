/**
 * The harp: every note is built from its partials, each one a sine that fades at its own speed.
 *
 * What makes it a harp rather than a guitar (see README, "Where the harp comes from"):
 *  - the string is plucked with the soft pad of a finger, far from its end, so the tone is round
 *    and whole families of overtones are missing (pluck in the middle: only the odd ones are left);
 *  - gut and nylon lose their high overtones quickly, leaving a pure, bell-like tail;
 *  - nothing damps the string, so it rings on, and the two ways it can swing (along and across
 *    the soundboard) fade at different speeds: a quick bloom, then a long quiet tail;
 *  - the soundboard answers each pluck with a soft knock.
 *
 * Pure functions: the same note with the same settings is always the same samples.
 */
import { midiToFreq } from "../theory/notes";

export type HarpVoice = "concert" | "folk" | "wire" | "box" | "guitar";

export interface HarpString {
  voice: HarpVoice;
  /** where the finger plucks: 0 = the middle of the string (round, hollow), 1 = right by the soundboard (thin, bright) */
  pluck: number;
  /** 0 = a nail or pick (bright, sharp), 1 = the soft pad of the finger */
  soft: number;
  /** how long the strings ring: 0 = short and dry, 1 = endless */
  ring: number;
  /** how much of the soundboard is heard: warmth and the knock at the start of each note */
  body: number;
}

export const HARP_VOICES: { id: HarpVoice; name: string; hint: string }[] = [
  { id: "concert", name: "Concert harp", hint: "Gut and nylon strings on a big soundboard: warm, round and deep" },
  { id: "folk", name: "Folk harp", hint: "A small lever harp with nylon strings: clear and light" },
  { id: "wire", name: "Wire harp", hint: "Brass strings played with the nails: bright, bell-like, rings for a long time" },
  { id: "box", name: "Music box", hint: "Tuned metal teeth: pure, glassy and gentle" },
  { id: "guitar", name: "Guitar", hint: "A steel-string guitar played with a pick" },
];

interface Model {
  /** pluck point as a fraction of the string, at pluck = 0 and pluck = 1 */
  beta: [number, number];
  /** where the finger stops passing overtones (Hz at middle C), at soft = 0 and soft = 1 */
  cut: [number, number];
  /** how freely the string swings (its Q): a partial at f Hz takes about 2.2·Q/f seconds to die away */
  q: number;
  /** above this frequency (Hz) the string's own stiffness eats the overtones faster and faster */
  qFall: number;
  /** the loss every partial shares, per second: energy handed to the soundboard */
  base: number;
  /** how far the overtones are stretched sharp (stiffness) at middle C */
  stiff: number;
  /** soundboard: its lowest resonances (Hz), below which little is radiated; how loud its knock is and how long it lasts (s) */
  modes: number[];
  low: number;
  knock: number;
  knockLen: number;
  /** the share of each partial that swings the slow way, and how much longer it lasts */
  slow: number;
  slowLen: number;
  /** the other strings humming along (the halo) */
  halo: number;
  /** finger or pick noise at the very start */
  noise: number;
}

/**
 * Numbers from the measurements listed in the README: harpists pluck a third to two fifths of the
 * way along the string; gut and nylon have a Q near 1000 that falls above 2–3 kHz; a concert harp
 * radiates most around 148, 166, 228 and 335 Hz and little below; a small harp starts near 190 Hz.
 */
const MODELS: Record<Exclude<HarpVoice, "box">, Model> = {
  concert: { beta: [0.5, 0.1], cut: [5200, 1100], q: 760, qFall: 3000, base: 0.5, stiff: 3e-5, modes: [150, 228, 335], low: 105, knock: 0.5, knockLen: 0.09, slow: 0.3, slowLen: 1.7, halo: 1, noise: 0.5 },
  folk: { beta: [0.5, 0.1], cut: [6500, 1500], q: 1000, qFall: 3600, base: 0.75, stiff: 5e-5, modes: [190, 273, 350], low: 165, knock: 0.4, knockLen: 0.07, slow: 0.28, slowLen: 1.6, halo: 0.7, noise: 0.6 },
  wire: { beta: [0.42, 0.08], cut: [9500, 2600], q: 2600, qFall: 9000, base: 0.3, stiff: 4e-5, modes: [200, 320, 470], low: 170, knock: 0.25, knockLen: 0.06, slow: 0.4, slowLen: 1.9, halo: 1.3, noise: 0.35 },
  guitar: { beta: [0.36, 0.07], cut: [9000, 2200], q: 1900, qFall: 6500, base: 0.85, stiff: 5e-5, modes: [102, 204, 380], low: 75, knock: 0.55, knockLen: 0.08, slow: 0.25, slowLen: 1.8, halo: 0, noise: 0.8 },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** The Ring knob: a quarter as long at 0, about twice as long at 1. */
const ringOf = (s: HarpString) => Math.pow(2, (clamp01(s.ring) - 0.5) * 3);

/** How fast a partial at f Hz dies away, per second. */
function lossAt(f: number, m: Model, ring: number): number {
  const x = f / m.qFall;
  return ((Math.PI * f) / m.q) * (1 + x * x) / Math.sqrt(ring) + m.base / ring;
}

const boxT60 = (midi: number) => 2.6 * Math.pow(2, -(midi - 60) / 30);

/** How long a note of this pitch is rendered for, in seconds. */
export function harpSeconds(midi: number, s: HarpString): number {
  const ring = ringOf(s);
  const t60 = s.voice === "box" ? boxT60(midi) * ring : 6.91 / lossAt(midiToFreq(midi), MODELS[s.voice], ring);
  return Math.min(5, Math.max(0.7, t60 * 0.9 + 0.25));
}

/** Add one fading sine to the buffer; stops as soon as it can no longer be heard. */
function addPartial(out: Float32Array, sr: number, freq: number, amp: number, phase: number, rate: number, floor: number) {
  if (amp <= floor || freq >= sr * 0.47) return;
  const n = Math.min(out.length, Math.ceil((Math.log(amp / floor) / rate) * sr));
  const w = (2 * Math.PI * freq) / sr;
  const d = Math.exp(-rate / sr);
  const cr = d * Math.cos(w);
  const ci = d * Math.sin(w);
  let re = amp * Math.cos(phase);
  let im = amp * Math.sin(phase);
  for (let i = 0; i < n; i++) {
    out[i] += re;
    const t = re * cr - im * ci;
    im = re * ci + im * cr;
    re = t;
  }
}

/** The soundboard's colour at a frequency: a lift around its resonances, and little below the lowest of them. */
function board(freq: number, m: Model, body: number): number {
  let g = 1;
  for (const mode of m.modes) {
    const x = Math.log2(freq / mode);
    g += 0.9 * body * Math.exp(-x * x * 9);
  }
  return g * (freq / Math.hypot(freq, m.low)); // the lowest strings are heard mostly through their overtones
}

/**
 * One plucked note, in tune, ready to play (mono).
 * `rand` only shapes the pluck noise and the slow shimmer, never the pitch.
 */
export function renderHarp(sr: number, midi: number, s: HarpString, rand: () => number = Math.random): Float32Array {
  const f0 = midiToFreq(midi);
  const len = Math.floor(sr * harpSeconds(midi, s));
  const out = new Float32Array(len);
  const ring = ringOf(s);
  const body = clamp01(s.body);
  const soft = clamp01(s.soft);
  const floor = 2e-5;

  if (s.voice === "box") {
    // a tuned metal tooth: one strong pure tone, and the high, quickly fading overtones of a clamped bar
    const t60 = boxT60(midi) * ring;
    const bright = lerp(1, 0.25, soft) * lerp(0.6, 1.4, clamp01(s.pluck));
    const bars: [number, number, number][] = [[1, 1, 1], [2, 0.1 + 0.25 * body, 0.7], [6.27, 0.3 * bright, 0.16], [17.55, 0.12 * bright, 0.06], [34.4, 0.05 * bright, 0.03]];
    for (const [ratio, amp, life] of bars) addPartial(out, sr, f0 * ratio, amp, -Math.PI / 2, 6.91 / (t60 * life), floor);
    addPartial(out, sr, f0 + 0.3, 0.22, -Math.PI / 2, 6.91 / (t60 * 1.6), floor); // the box sings on, beating slowly
  } else {
    const m = MODELS[s.voice];
    const beta = lerp(m.beta[0], m.beta[1], clamp01(s.pluck));
    // thinner, tighter strings up high let more overtones through
    const cut = lerp(m.cut[0], m.cut[1], soft) * Math.pow(f0 / 261.63, 0.35);
    const stiff = Math.min(1.6e-4, m.stiff * Math.pow(f0 / 261.63, 0.8));
    // the wave that reaches the soundboard is a pulse; the note starts just before it arrives
    const start = -Math.PI * beta - Math.PI * (1 - beta) * 0.3;
    for (let n = 1; n < 400; n++) {
      const f = n * f0 * Math.sqrt(1 + stiff * n * n);
      if (f > Math.min(sr * 0.47, 16000)) break;
      const shape = Math.sin(n * Math.PI * beta) / n;
      const amp = shape * (1 / (1 + (f / cut) * (f / cut))) * board(f, m, body);
      const size = Math.abs(amp);
      if (size < floor) continue;
      const rate = lossAt(f, m, ring);
      const ph = n * start + (amp < 0 ? Math.PI : 0);
      // the string swings two ways at once, into the soundboard (louder, gone sooner) and along it, a hair apart in pitch
      const drift = (0.1 + 0.4 * rand()) * (rand() < 0.5 ? -1 : 1);
      addPartial(out, sr, f, size * (1 - m.slow), ph, rate * 1.15, floor);
      addPartial(out, sr, f + drift, size * m.slow, ph, rate / m.slowLen, floor);
      // the halo: neighbouring strings pick the note up through the soundboard, swelling in after the pluck
      if (n <= 6 && m.halo > 0) {
        const h = size * m.halo * (0.1 + 0.16 * body);
        const hf = f + (rand() - 0.5) * 1.2;
        const hp = rand() * 2 * Math.PI;
        addPartial(out, sr, hf, h, hp, rate / 2.2, floor);
        addPartial(out, sr, hf, h, hp + Math.PI, rate / 2.2 + 14, floor);
      }
    }
    // the soundboard's knock: its own low resonances, set off by the pluck
    const knock = m.knock * body * 0.16;
    m.modes.forEach((mode, i) => addPartial(out, sr, mode, knock / (1 + i), -Math.PI / 2, 6.91 / (m.knockLen / (1 + i * 0.4)), floor));
    // the finger (or pick) leaving the string
    const hiss = m.noise * (1 - soft) * 0.1;
    if (hiss > 0) {
      const n = Math.floor(sr * 0.012);
      let lp = 0;
      let hp = 0;
      for (let i = 0; i < n && i < len; i++) {
        const x = rand() * 2 - 1;
        lp += 0.35 * (x - lp);
        hp += 0.08 * (lp - hp);
        out[i] += (lp - hp) * hiss * Math.pow(1 - i / n, 2);
      }
    }
  }

  // fade in over a moment (the string slipping off the finger), fade out at the very end
  const rise = Math.floor(sr * lerp(0.0012, 0.004, soft));
  for (let i = 0; i < rise && i < len; i++) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / rise);
  const fade = Math.floor(sr * 0.12);
  for (let i = Math.max(0, len - fade); i < len; i++) out[i] *= (len - i) / fade;

  // every note equally loud: by the energy of its first quarter second, with a ceiling on the peak
  const head = Math.min(len, Math.floor(sr * 0.25));
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    if (i < head) sum += out[i] * out[i];
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  const rms = Math.sqrt(sum / head) || 1;
  // low notes carry more weight than high ones at the same level, so they are turned down a touch
  const tilt = Math.pow(f0 / 261.63, 0.12);
  const gain = Math.min((HARP_LEVEL * tilt) / rms, 0.92 / (peak || 1));
  for (let i = 0; i < len; i++) out[i] *= gain;
  return out;
}

/** The level every note is brought to (RMS of its first quarter second). */
export const HARP_LEVEL = 0.17;

export const STRING_DEFAULT: HarpString = { voice: "concert", pluck: 0.33, soft: 0.55, ring: 0.5, body: 0.5 };
export const STRING_KEYS = ["voice", "pluck", "soft", "ring", "body"] as const;

/** A name for a rendered note: two notes with the same key are the same sound. */
export const stringKey = (midi: number, s: HarpString) => `${midi}|${s.voice}|${s.pluck.toFixed(2)}|${s.soft.toFixed(2)}|${s.ring.toFixed(2)}|${s.body.toFixed(2)}`;
