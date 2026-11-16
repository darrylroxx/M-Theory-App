/**
 * Drum-machine voices, synthesized from scratch (no samples, works offline).
 *
 * Four kits, each modelled on how a family of classic machines makes its sound:
 *  - "box":   preset rhythm boxes built into 70s organs and keyboards (CR-78 lineage):
 *             a short thud, a thin noise snare, ticking hats, clave and tambourine.
 *  - "808":   analog voices: a long sine kick with a tiny pitch blip, a two-tone snare
 *             with "snappy" noise, hats and cowbell made from a bank of square waves.
 *  - "volca": small modern analog box: clicky punchy kick, snappy snare, grainy hats.
 *  - "lofi":  mid-80s 8-bit sample machines (TR-505 style): punchy, gated and crunchy.
 *
 * Every voice has the same four controls: tune, decay, tone and level.
 * Everything here is pure maths on arrays, so it can be tested without a browser.
 */

export type KitId = "box" | "808" | "volca" | "lofi";
export type DrumId = "kick" | "snare" | "clap" | "hat" | "open" | "tom" | "rim" | "shaker" | "bell";

export const DRUM_IDS: DrumId[] = ["kick", "snare", "clap", "hat", "open", "tom", "rim", "shaker", "bell"];

export interface DrumParams {
  /** semitones, −12…+12 */
  tune: number;
  /** 0…1 (short … long) */
  decay: number;
  /** 0…1: click on the kick, snap on the snare, grain on the hats, brightness elsewhere */
  tone: number;
  /** 0…1 */
  level: number;
}

export const DEFAULT_PARAMS: DrumParams = { tune: 0, decay: 0.5, tone: 0.5, level: 0.8 };

/** Short labels for the step grid. */
export const DRUM_LABEL: Record<DrumId, string> = { kick: "Kick", snare: "Snare", clap: "Clap", hat: "Hat", open: "Open", tom: "Tom", rim: "Rim", shaker: "Shake", bell: "Bell" };

/** What the "tone" control does for each voice. */
export const TONE_LABEL: Record<DrumId, string> = { kick: "Click", snare: "Snap", clap: "Tone", hat: "Grain", open: "Grain", tom: "Attack", rim: "Tone", shaker: "Tone", bell: "Tone" };

export interface Kit {
  id: KitId;
  name: string;
  hint: string;
  /** Full names of the sounds in this kit */
  names: Record<DrumId, string>;
}

const BASE_NAMES: Record<DrumId, string> = { kick: "Kick", snare: "Snare", clap: "Clap", hat: "Closed hat", open: "Open hat", tom: "Tom", rim: "Rimshot", shaker: "Shaker", bell: "Cowbell" };

export const KITS: Kit[] = [
  { id: "box", name: "Vintage", hint: "Organ rhythm box: soft thud, ticking hats, tambourine. Dream pop.", names: { ...BASE_NAMES, tom: "Bongo", rim: "Clave", shaker: "Tambourine" } },
  { id: "808", name: "808", hint: "Analog classic: long boomy kick, snappy snare, metallic hats, cowbell.", names: { ...BASE_NAMES, shaker: "Maracas" } },
  { id: "volca", name: "Volca", hint: "Small analog box: clicky punchy kick, snappy snare, grainy hats.", names: { ...BASE_NAMES, rim: "Clave", bell: "Agogo" } },
  { id: "lofi", name: "Lo-fi", hint: "80s 8-bit sample machine: punchy, gated and crunchy.", names: { ...BASE_NAMES, shaker: "Tambourine" } },
];

export const getKit = (id: KitId): Kit => KITS.find((k) => k.id === id) ?? KITS[0];

/** Relative loudness of each voice in the mix. */
export const DRUM_MIX: Record<DrumId, number> = { kick: 1, snare: 0.8, clap: 0.7, hat: 0.42, open: 0.4, tom: 0.8, rim: 0.55, shaker: 0.4, bell: 0.42 };

// ── DSP helpers ──────────────────────────────────────────────

const TAU = Math.PI * 2;
type Filter = (x: number) => number;

function biquad(kind: "lp" | "hp" | "bp", freq: number, q: number, sr: number): Filter {
  const w = (TAU * Math.min(freq, sr * 0.45)) / sr;
  const cs = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const a0 = 1 + al;
  const a1 = (-2 * cs) / a0;
  const a2 = (1 - al) / a0;
  let b0: number, b1: number, b2: number;
  if (kind === "lp") {
    b0 = (1 - cs) / 2;
    b1 = 1 - cs;
    b2 = b0;
  } else if (kind === "hp") {
    b0 = (1 + cs) / 2;
    b1 = -(1 + cs);
    b2 = b0;
  } else {
    b0 = al;
    b1 = 0;
    b2 = -al;
  }
  b0 /= a0;
  b1 /= a0;
  b2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

/** Small deterministic noise source, so a sound is identical every time it is rendered. */
export function drumRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The 808's bank of six detuned square waves: the source of its hats, cymbal and cowbell. */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
function metal(sr: number, ratio: number, freqs = METAL): () => number {
  const ph = freqs.map((_, i) => i * 0.137);
  return () => {
    let s = 0;
    for (let k = 0; k < freqs.length; k++) {
      ph[k] += (freqs[k] * ratio) / sr;
      if (ph[k] >= 1) ph[k] -= 1;
      s += ph[k] < 0.5 ? 1 : -1;
    }
    return s / freqs.length;
  };
}

const ratioOf = (semis: number) => Math.pow(2, semis / 12);
/** Exponential blend between two times. */
const span = (lo: number, hi: number, x: number) => lo * Math.pow(hi / lo, Math.min(1, Math.max(0, x)));
/** Envelope that has fallen 60 dB after `t60` seconds. */
const fall = (t: number, t60: number) => Math.exp((-6.9 * t) / t60);

type Voice = (sr: number, kit: KitId, p: DrumParams, rand: () => number) => Float32Array;

const kick: Voice = (sr, kit, p, rand) => {
  //                 f0  sweep sweepT  short  long  click drive
  const cfg = {
    box: [76, 0.5, 0.012, 0.12, 0.42, 0.2, 1.0],
    "808": [50, 1.3, 0.016, 0.28, 2.0, 0.5, 1.4],
    volca: [58, 3.2, 0.03, 0.16, 0.9, 1.0, 2.0],
    lofi: [62, 2.4, 0.04, 0.18, 0.6, 0.7, 2.6],
  }[kit];
  const [f0, sweep, sweepT, lo, hi, click, drive] = cfg;
  const t60 = span(lo, hi, p.decay);
  const r = ratioOf(p.tune);
  const out = new Float32Array(Math.floor(sr * (t60 + 0.03)));
  const lp = biquad("lp", 3500, 0.7, sr);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    ph += (f0 * r * (1 + sweep * Math.exp(-t / sweepT))) / sr;
    const body = Math.sin(TAU * ph) * fall(t, t60);
    const cl = lp(rand() * 2 - 1) * Math.exp(-t / 0.0025) * click * p.tone * 2;
    out[i] = Math.tanh(drive * (body + cl));
  }
  return out;
};

const snare: Voice = (sr, kit, p, rand) => {
  const cfg = {
    box: { f: [220], drop: 0, bodyT: 0.07, body: 0.35, nLo: 0.07, nHi: 0.24 },
    "808": { f: [238, 476], drop: 0, bodyT: 0.14, body: 0.9, nLo: 0.1, nHi: 0.45 },
    volca: { f: [185], drop: 0.6, bodyT: 0.11, body: 0.8, nLo: 0.07, nHi: 0.32 },
    lofi: { f: [200], drop: 0.9, bodyT: 0.15, body: 0.9, nLo: 0.12, nHi: 0.36 },
  }[kit];
  const nT = span(cfg.nLo, cfg.nHi, p.decay);
  const r = ratioOf(p.tune);
  const chain: Filter[] = {
    box: [biquad("bp", 5200, 0.8, sr), biquad("hp", 1500, 0.7, sr)],
    "808": [biquad("hp", 1800, 0.7, sr), biquad("lp", 9000, 0.7, sr)],
    volca: [biquad("bp", 3600, 0.6, sr), biquad("hp", 900, 0.7, sr)],
    lofi: [biquad("lp", 7000, 0.7, sr), biquad("hp", 350, 0.7, sr)],
  }[kit];
  const out = new Float32Array(Math.floor(sr * (Math.max(nT, cfg.bodyT) + 0.03)));
  const ph = cfg.f.map(() => 0);
  const snap = 0.3 + 1.2 * p.tone;
  const gate = kit === "lofi" ? nT * 0.6 : Infinity; // the abrupt "gated" tail of 80s sample snares
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let body = 0;
    cfg.f.forEach((f, k) => {
      ph[k] += (f * r * (1 + cfg.drop * Math.exp(-t / 0.015))) / sr;
      body += Math.sin(TAU * ph[k]) * fall(t, cfg.bodyT / (k + 1)) * (k ? 0.5 : 1);
    });
    let n = rand() * 2 - 1;
    for (const f of chain) n = f(n);
    let env = fall(t, nT);
    if (t > gate) env *= Math.exp(-(t - gate) / 0.012);
    out[i] = cfg.body * body + snap * n * env;
  }
  return out;
};

function hatVoice(open: boolean): Voice {
  return (sr, kit, p, rand) => {
    const t60 = open ? span(0.25, 1.3, p.decay) : span(0.035, 0.17, p.decay);
    const grain = 0.75 + 0.5 * p.tone;
    const osc = metal(sr, ratioOf(p.tune));
    const mix = { box: 0, "808": 1, volca: 0.6, lofi: 0.5 }[kit]; // how much square-wave "metal" vs. plain noise
    const f1 = kit === "box" ? biquad("hp", 7500 * grain, 0.7, sr) : biquad("bp", 7100 * grain, 1.1, sr);
    const f2 = biquad("hp", (kit === "box" ? 5000 : 6000) * grain, 0.7, sr);
    const ring = biquad("bp", 9500 * grain, 2.5, sr);
    const out = new Float32Array(Math.floor(sr * (t60 + 0.02)));
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const src = mix * osc() + (1 - mix) * (rand() * 2 - 1);
      let y = f2(f1(src));
      if (kit === "box") y += 0.5 * ring(src);
      out[i] = y * (fall(t, t60) + (open ? 0 : 0.6 * Math.exp(-t / 0.004)));
    }
    return out;
  };
}

const clap: Voice = (sr, kit, p, rand) => {
  const t60 = span(0.12, 0.6, p.decay) * (kit === "box" ? 0.6 : 1);
  const centre = { box: 1500, "808": 1050, volca: 1250, lofi: 1150 }[kit] * ratioOf(p.tune) * (0.7 + 0.6 * p.tone);
  const bp = biquad("bp", centre, 1.3, sr);
  const hp = biquad("hp", 500, 0.7, sr);
  const out = new Float32Array(Math.floor(sr * (t60 + 0.06)));
  const gap = 0.011; // three quick "hands" before the tail, as in the analog clap circuit
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const env = t < gap * 3 ? Math.exp(-(t % gap) / 0.0035) : 0.8 * fall(t - gap * 3, t60);
    out[i] = hp(bp(rand() * 2 - 1)) * env;
  }
  return out;
};

const tom: Voice = (sr, kit, p, rand) => {
  const f0 = { box: 165, "808": 110, volca: 135, lofi: 125 }[kit] * ratioOf(p.tune);
  const t60 = kit === "box" ? span(0.1, 0.4, p.decay) : span(0.16, 0.9, p.decay);
  const lp = biquad("lp", 2500, 0.7, sr);
  const out = new Float32Array(Math.floor(sr * (t60 + 0.03)));
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    ph += (f0 * (1 + 0.5 * Math.exp(-t / 0.04))) / sr;
    out[i] = Math.sin(TAU * ph) * fall(t, t60) + lp(rand() * 2 - 1) * Math.exp(-t / 0.006) * p.tone * 0.8;
  }
  return out;
};

const rim: Voice = (sr, kit, p, rand) => {
  //                partials (Hz, level)                      short  long
  const cfg = {
    box: { parts: [[1850, 1], [3700, 0.2]], lo: 0.03, hi: 0.14 }, // clave
    "808": { parts: [[455, 1], [1667, 0.6]], lo: 0.02, hi: 0.08 }, // rimshot: two short pings
    volca: { parts: [[2450, 1]], lo: 0.03, hi: 0.14 }, // clave
    lofi: { parts: [[820, 1], [2100, 0.4]], lo: 0.03, hi: 0.1 },
  }[kit];
  const t60 = span(cfg.lo, cfg.hi, p.decay);
  const r = ratioOf(p.tune);
  const hp = biquad("hp", 2500, 0.7, sr);
  const out = new Float32Array(Math.floor(sr * (t60 + 0.02)));
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let s = 0;
    for (const [f, a] of cfg.parts) s += a * Math.sin(TAU * f * r * t);
    out[i] = s * fall(t, t60) + hp(rand() * 2 - 1) * Math.exp(-t / 0.0015) * p.tone * 1.6;
  }
  return out;
};

const shaker: Voice = (sr, kit, p, rand) => {
  const tamb = kit === "box" || kit === "lofi";
  const t60 = tamb ? span(0.09, 0.45, p.decay) : span(0.04, 0.22, p.decay);
  const bright = ratioOf(p.tune) * (0.7 + 0.6 * p.tone);
  const hp = biquad("hp", { box: 6500, "808": 6500, volca: 5500, lofi: 5500 }[kit] * bright, 0.7, sr);
  const j1 = biquad("bp", 8200 * bright, 9, sr); // tambourine jingles
  const j2 = biquad("bp", 11500 * bright, 11, sr);
  const attack = tamb ? 0.004 : 0.012; // shakers swell in, tambourines hit
  const out = new Float32Array(Math.floor(sr * (t60 + attack + 0.02)));
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const n = rand() * 2 - 1;
    const y = hp(n) + (tamb ? 2.2 * (j1(n) + j2(n)) : 0);
    out[i] = y * (t < attack ? t / attack : fall(t - attack, t60));
  }
  return out;
};

const bell: Voice = (sr, kit, p) => {
  const r = ratioOf(p.tune);
  const t60 = span(0.12, 0.9, p.decay);
  const out = new Float32Array(Math.floor(sr * (t60 + 0.02)));
  if (kit === "volca") {
    // agogo: a few inharmonic sine partials
    const parts = [[920, 1], [1385, 0.7], [2760, 0.3 + 0.5 * p.tone]];
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      let s = 0;
      for (const [f, a] of parts) s += a * Math.sin(TAU * f * r * t);
      out[i] = s * (0.5 * Math.exp(-t / 0.01) + fall(t, t60));
    }
    return out;
  }
  // cowbell: two square waves (540 + 800 Hz on the 808) through a band-pass
  const pair = kit === "box" ? [587, 845] : kit === "lofi" ? [560, 845] : [540, 800];
  const osc = metal(sr, r, pair);
  const bp = biquad("bp", (kit === "box" ? 1700 : 2400) * (0.7 + 0.6 * p.tone), kit === "box" ? 0.9 : 1.4, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] = bp(osc()) * (0.7 * Math.exp(-t / 0.012) + 0.5 * fall(t, t60));
  }
  return out;
};

const VOICES: Record<DrumId, Voice> = { kick, snare, clap, hat: hatVoice(false), open: hatVoice(true), tom, rim, shaker, bell };

/** 8-bit, half-rate playback: the crunch of mid-80s sample machines. */
function crush(data: Float32Array, hold: number, bits: number) {
  const q = Math.pow(2, bits - 1);
  let held = 0;
  for (let i = 0; i < data.length; i++) {
    if (i % hold === 0) held = Math.round(data[i] * q) / q;
    data[i] = held;
  }
}

function normalise(data: Float32Array, target: number) {
  let peak = 0;
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i] *= target / peak;
}

/** Render one drum hit. Pure: the same inputs always give the same samples. */
export function renderDrum(sr: number, kit: KitId, id: DrumId, params: Partial<DrumParams> = {}): Float32Array {
  const p = { ...DEFAULT_PARAMS, ...params };
  const out = VOICES[id](sr, kit, p, drumRng(DRUM_IDS.indexOf(id) * 7919 + 17));
  normalise(out, 0.9);
  if (kit === "lofi") {
    crush(out, Math.max(1, Math.round(sr / 24000)), 8);
    normalise(out, 0.9);
  }
  const fade = Math.min(out.length, Math.floor(sr * 0.008));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}
