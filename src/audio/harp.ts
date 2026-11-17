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

export type HarpVoice =
  | "concert" | "folk" | "wire" | "latin" | "baroque" | "bray" | "kora" | "lyre" | "electric" | "harmonics"
  | "nylon" | "guitar" | "koto" | "dulcimer" | "mandolin" | "banjo" | "ukulele" | "pizz"
  | "box" | "kalimba" | "glass" | "vibes";

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

export type VoiceGroup = "Harps" | "Plucked" | "Bells";
export const VOICE_GROUPS: VoiceGroup[] = ["Harps", "Plucked", "Bells"];
export const HARP_VOICES: { id: HarpVoice; name: string; group: VoiceGroup; hint: string }[] = [
  { id: "concert", name: "Concert harp", group: "Harps", hint: "Gut and nylon strings on a big soundboard: warm, round and deep" },
  { id: "folk", name: "Folk harp", group: "Harps", hint: "A small lever harp with nylon strings: clear and light" },
  { id: "wire", name: "Wire harp", group: "Harps", hint: "Brass strings played with the nails: bright, bell-like, rings for a long time" },
  { id: "latin", name: "Latin harp", group: "Harps", hint: "Light nylon strings played with the nails: bright, snappy, dancing" },
  { id: "baroque", name: "Baroque harp", group: "Harps", hint: "Slack gut strings on a narrow soundbox: dry, soft, lute-like" },
  { id: "bray", name: "Bray harp", group: "Harps", hint: "A medieval harp whose strings buzz against small pins: nasal and humming" },
  { id: "kora", name: "Kora", group: "Harps", hint: "The West African harp: bright strings over a drum-like gourd" },
  { id: "lyre", name: "Lyre", group: "Harps", hint: "Short gut strings on a small box: thin, plain, ancient" },
  { id: "electric", name: "Electric harp", group: "Harps", hint: "A solid body and pickups: clean, even, long-ringing" },
  { id: "harmonics", name: "Harp harmonics", group: "Harps", hint: "Strings touched at their middle: an octave higher, pure as a flute" },
  { id: "nylon", name: "Nylon guitar", group: "Plucked", hint: "A classical guitar played with the fingers" },
  { id: "guitar", name: "Steel guitar", group: "Plucked", hint: "A steel-string guitar played with a pick" },
  { id: "koto", name: "Koto", group: "Plucked", hint: "Long strings plucked hard near their end with picks: sharp and vivid" },
  { id: "dulcimer", name: "Dulcimer", group: "Plucked", hint: "Pairs of steel strings struck with small hammers: shimmering" },
  { id: "mandolin", name: "Mandolin", group: "Plucked", hint: "Pairs of short steel strings: bright and quick to fade" },
  { id: "banjo", name: "Banjo", group: "Plucked", hint: "Strings over a drum skin: twangy, short, loud" },
  { id: "ukulele", name: "Ukulele", group: "Plucked", hint: "Four short nylon strings: plucky and cheerful" },
  { id: "pizz", name: "Pizzicato", group: "Plucked", hint: "Orchestral strings plucked with a finger: a short, woody thud" },
  { id: "box", name: "Music box", group: "Bells", hint: "Tuned metal teeth: pure, glassy and gentle" },
  { id: "kalimba", name: "Kalimba", group: "Bells", hint: "Metal tongues on a wooden box, plucked with the thumbs" },
  { id: "glass", name: "Glass bells", group: "Bells", hint: "Small struck bars: sweet and sparkling, like a celesta" },
  { id: "vibes", name: "Vibraphone", group: "Bells", hint: "Struck metal bars over tubes: mellow and long" },
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
  /** how fast the overtones thin out going up: 1 is a plain plucked string, less is brighter and buzzier, more is purer */
  tilt?: number;
  /** two strings to a note, this many cents apart: a built-in shimmer */
  pair?: number;
  /** sounds this many semitones above the note asked for (harmonics) */
  shift?: number;
}

/** A struck or plucked bar: its overtones are not whole multiples of the note, and each has its own life. */
interface Bars {
  /** seconds for middle C to die away, and the list of [ratio to the note, loudness, share of that time] */
  t60: number;
  partials: [number, number, number][];
  /** a woody knock at the start */
  knock: number;
}
const BARS: Partial<Record<HarpVoice, Bars>> = {
  box: { t60: 2.6, partials: [[1, 1, 1], [2, 0.22, 0.7], [6.27, 0.3, 0.16], [17.55, 0.12, 0.06], [34.4, 0.05, 0.03]], knock: 0 },
  kalimba: { t60: 1.7, partials: [[1, 1, 1], [5.6, 0.22, 0.1], [13.5, 0.06, 0.04]], knock: 0.5 },
  glass: { t60: 3.2, partials: [[1, 1, 1], [4, 0.18, 0.35], [9.2, 0.07, 0.12], [16.4, 0.03, 0.05]], knock: 0 },
  vibes: { t60: 5, partials: [[1, 1, 1], [4, 0.12, 0.5], [10, 0.035, 0.15]], knock: 0.1 },
};
/** How many semitones above the written note a voice sounds. */
export const voiceShift = (v: HarpVoice): number => (BARS[v] ? 0 : (MODELS[v as StringVoice].shift ?? 0));
type StringVoice = Exclude<HarpVoice, "box" | "kalimba" | "glass" | "vibes">;

/**
 * Numbers from the measurements listed in the README: harpists pluck a third to two fifths of the
 * way along the string; gut and nylon have a Q near 1000 that falls above 2–3 kHz; a concert harp
 * radiates most around 148, 166, 228 and 335 Hz and little below; a small harp starts near 190 Hz.
 */
const MODELS: Record<StringVoice, Model> = {
  concert: { beta: [0.5, 0.1], cut: [5200, 1100], q: 760, qFall: 3000, base: 0.5, stiff: 3e-5, modes: [150, 228, 335], low: 105, knock: 0.5, knockLen: 0.09, slow: 0.3, slowLen: 1.7, halo: 1, noise: 0.5 },
  folk: { beta: [0.5, 0.1], cut: [6500, 1500], q: 1000, qFall: 3600, base: 0.75, stiff: 5e-5, modes: [190, 273, 350], low: 165, knock: 0.4, knockLen: 0.07, slow: 0.28, slowLen: 1.6, halo: 0.7, noise: 0.6 },
  wire: { beta: [0.42, 0.08], cut: [9500, 2600], q: 2600, qFall: 9000, base: 0.3, stiff: 4e-5, modes: [200, 320, 470], low: 170, knock: 0.25, knockLen: 0.06, slow: 0.4, slowLen: 1.9, halo: 1.3, noise: 0.35 },
  latin: { beta: [0.4, 0.08], cut: [9000, 2500], q: 900, qFall: 4200, base: 1.1, stiff: 5e-5, modes: [170, 260, 380], low: 150, knock: 0.45, knockLen: 0.07, slow: 0.28, slowLen: 1.5, halo: 0.6, noise: 0.75 },
  baroque: { beta: [0.45, 0.1], cut: [4200, 1000], q: 520, qFall: 2400, base: 1, stiff: 2e-5, modes: [200, 300, 450], low: 180, knock: 0.35, knockLen: 0.07, slow: 0.3, slowLen: 1.6, halo: 0.5, noise: 0.5 },
  bray: { beta: [0.3, 0.07], cut: [12000, 5000], q: 1400, qFall: 6000, base: 0.9, stiff: 1.2e-5, modes: [200, 300, 440], low: 170, knock: 0.3, knockLen: 0.06, slow: 0.35, slowLen: 1.7, halo: 0.4, noise: 0.5, tilt: 0.55 },
  kora: { beta: [0.3, 0.08], cut: [8000, 2200], q: 800, qFall: 3500, base: 1.6, stiff: 4e-5, modes: [120, 210, 330], low: 100, knock: 0.9, knockLen: 0.12, slow: 0.25, slowLen: 1.5, halo: 0.3, noise: 0.7 },
  lyre: { beta: [0.4, 0.1], cut: [6000, 1600], q: 600, qFall: 2800, base: 1.8, stiff: 3e-5, modes: [280, 420, 600], low: 240, knock: 0.3, knockLen: 0.05, slow: 0.25, slowLen: 1.5, halo: 0.4, noise: 0.6 },
  electric: { beta: [0.45, 0.1], cut: [5000, 1400], q: 1500, qFall: 5000, base: 0.35, stiff: 5e-5, modes: [], low: 30, knock: 0, knockLen: 0.05, slow: 0.2, slowLen: 1.4, halo: 0, noise: 0.3 },
  harmonics: { beta: [0.5, 0.3], cut: [3200, 1200], q: 900, qFall: 3000, base: 0.6, stiff: 2e-5, modes: [150, 228, 335], low: 105, knock: 0.25, knockLen: 0.08, slow: 0.3, slowLen: 1.7, halo: 0.8, noise: 0.2, tilt: 1.8, shift: 12 },
  nylon: { beta: [0.3, 0.08], cut: [6500, 1600], q: 900, qFall: 3200, base: 1, stiff: 4e-5, modes: [100, 200, 330], low: 80, knock: 0.6, knockLen: 0.08, slow: 0.25, slowLen: 1.7, halo: 0, noise: 0.6 },
  koto: { beta: [0.14, 0.06], cut: [11000, 4000], q: 1100, qFall: 4500, base: 1.3, stiff: 6e-5, modes: [160, 280, 520], low: 140, knock: 0.5, knockLen: 0.07, slow: 0.3, slowLen: 1.6, halo: 0.5, noise: 0.9 },
  dulcimer: { beta: [0.15, 0.08], cut: [7000, 2500], q: 2400, qFall: 8000, base: 0.6, stiff: 5e-5, modes: [220, 330, 500], low: 180, knock: 0.4, knockLen: 0.06, slow: 0.35, slowLen: 1.8, halo: 1.2, noise: 0.2, pair: 7 },
  mandolin: { beta: [0.2, 0.07], cut: [10000, 3000], q: 1300, qFall: 6000, base: 2.2, stiff: 6e-5, modes: [300, 450, 700], low: 250, knock: 0.45, knockLen: 0.05, slow: 0.25, slowLen: 1.5, halo: 0, noise: 0.8, pair: 6 },
  banjo: { beta: [0.2, 0.06], cut: [11000, 3500], q: 900, qFall: 5000, base: 3, stiff: 5e-5, modes: [280, 480, 720], low: 230, knock: 1, knockLen: 0.05, slow: 0.2, slowLen: 1.4, halo: 0, noise: 0.8, tilt: 0.8 },
  ukulele: { beta: [0.3, 0.1], cut: [6500, 1800], q: 700, qFall: 3000, base: 2.4, stiff: 4e-5, modes: [260, 400, 620], low: 230, knock: 0.5, knockLen: 0.05, slow: 0.25, slowLen: 1.5, halo: 0, noise: 0.6 },
  pizz: { beta: [0.3, 0.12], cut: [3500, 1100], q: 300, qFall: 2200, base: 4.5, stiff: 3e-5, modes: [280, 460, 900], low: 150, knock: 0.7, knockLen: 0.06, slow: 0.2, slowLen: 1.3, halo: 0, noise: 0.4, tilt: 1.1 },
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

const barT60 = (midi: number, b: Bars) => b.t60 * Math.pow(2, -(midi - 60) / 30);

/** How long a note of this pitch is rendered for, in seconds. */
export function harpSeconds(midi: number, s: HarpString): number {
  const ring = ringOf(s);
  const bars = BARS[s.voice];
  const t60 = bars ? barT60(midi, bars) * ring : 6.91 / lossAt(midiToFreq(midi + voiceShift(s.voice)), MODELS[s.voice as StringVoice], ring);
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
  const f0 = midiToFreq(midi + voiceShift(s.voice));
  const len = Math.floor(sr * harpSeconds(midi, s));
  const out = new Float32Array(len);
  const ring = ringOf(s);
  const body = clamp01(s.body);
  const soft = clamp01(s.soft);
  const floor = 2e-5;

  const bars = BARS[s.voice];
  if (bars) {
    // a bar: one strong pure tone, and the high, quickly fading overtones that are not whole multiples of it
    const t60 = barT60(midi, bars) * ring;
    const bright = lerp(1, 0.25, soft) * lerp(0.6, 1.4, clamp01(s.pluck));
    bars.partials.forEach(([ratio, amp, life], i) => addPartial(out, sr, f0 * ratio, i === 0 ? 1 : amp * (i === 1 && ratio < 3 ? 0.45 + 1.1 * body : bright), -Math.PI / 2, 6.91 / (t60 * life), floor));
    addPartial(out, sr, f0 + 0.3, 0.22, -Math.PI / 2, 6.91 / (t60 * 1.6), floor); // it sings on, beating slowly
    // the box it sits on answers with a knock
    if (bars.knock) [190, 320].forEach((mode, i) => addPartial(out, sr, mode, (bars.knock * (0.3 + body) * 0.2) / (1 + i), -Math.PI / 2, 6.91 / 0.07, floor));
  } else {
    const m = MODELS[s.voice as StringVoice];
    const tilt = m.tilt ?? 1;
    // two strings to a note sit a few cents either side of it
    const pair = m.pair ? [Math.pow(2, -m.pair / 2400), Math.pow(2, m.pair / 2400)] : [1];
    const beta = lerp(m.beta[0], m.beta[1], clamp01(s.pluck));
    // thinner, tighter strings up high let more overtones through
    const cut = lerp(m.cut[0], m.cut[1], soft) * Math.pow(f0 / 261.63, 0.35);
    const stiff = Math.min(1.6e-4, m.stiff * Math.pow(f0 / 261.63, 0.8));
    // the wave that reaches the soundboard is a pulse; the note starts just before it arrives
    const start = -Math.PI * beta - Math.PI * (1 - beta) * 0.3;
    for (let n = 1; n < 400; n++) {
      const f = n * f0 * Math.sqrt(1 + stiff * n * n);
      if (f > Math.min(sr * 0.47, 16000)) break;
      const shape = Math.sin(n * Math.PI * beta) / Math.pow(n, tilt);
      const amp = shape * (1 / (1 + (f / cut) * (f / cut))) * board(f, m, body);
      const size = Math.abs(amp);
      if (size < floor) continue;
      const rate = lossAt(f, m, ring);
      const ph = n * start + (amp < 0 ? Math.PI : 0);
      // the string swings two ways at once, into the soundboard (louder, gone sooner) and along it, a hair apart in pitch
      const drift = (0.1 + 0.4 * rand()) * (rand() < 0.5 ? -1 : 1);
      for (const [j, det] of pair.entries()) {
        const g = size / Math.sqrt(pair.length);
        addPartial(out, sr, f * det, g * (1 - m.slow), ph + j * 0.6 * n, rate * 1.15, floor);
        addPartial(out, sr, f * det + drift, g * m.slow, ph + j * 0.6 * n, rate / m.slowLen, floor);
      }
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
