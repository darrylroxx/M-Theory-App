/**
 * Drum-machine voices, synthesized from scratch (no samples, works offline).
 *
 * Six machines, each modelled on how a family of classic boxes makes its sound:
 *  - "box":   preset rhythm boxes built into 70s organs (CR-78 lineage): a short thud,
 *             a thin noise snare, ticking hats, clave and tambourine.
 *  - "808":   analog voices: a long sine kick with a tiny pitch blip, a two-tone snare with
 *             "snappy" noise, hats and cowbell made from a bank of six square waves.
 *  - "909":   harder analog voices: a kick with a deep pitch sweep and a noise click, a snare
 *             with two bending oscillators, and grainy low-bit cymbals.
 *  - "linn":  80s studio machines that played recordings of real drums: a beater on a kick,
 *             a cracking snare with wires, a room full of hand claps, a sidestick.
 *  - "volca": small modern analog box: clicky punchy kick, snappy snare, grainy hats.
 *  - "lofi":  mid-80s 8-bit sample machines: punchy, gated and crunchy.
 *
 * Any drum can use any machine's voice, and every voice has the same six sound controls
 * (tune, decay, tone, punch, drive, filter). Everything here is pure maths on arrays, so it
 * can be tested without a browser.
 */

export type KitId = "box" | "808" | "909" | "linn" | "volca" | "lofi";
export type DrumId = "kick" | "snare" | "clap" | "hat" | "open" | "tom" | "rim" | "shaker" | "bell";

export const DRUM_IDS: DrumId[] = ["kick", "snare", "clap", "hat", "open", "tom", "rim", "shaker", "bell"];

export interface DrumParams {
  /** semitones, −12…+12 */
  tune: number;
  /** 0…1 (short … long) */
  decay: number;
  /** 0…1: click on the kick, snap on the snare, brightness elsewhere */
  tone: number;
  /** 0…1: pitch sweep on the kick, body on the snare, attack elsewhere */
  punch: number;
  /** 0…1 saturation of this drum alone */
  drive: number;
  /** −1…0 closes a low-pass (darker), 0…1 opens a high-pass (thinner), 0 = off */
  filter: number;
  /** 0…1 */
  level: number;
  /** −1 left … 1 right */
  pan: number;
  /** how much of this drum goes to the reverb, 0…1 */
  space: number;
  /** how much of this drum goes to the echo, 0…1 */
  echo: number;
}

/** The controls that change the rendered sound itself (the rest are mixed live). */
export const SHAPE_KEYS = ["tune", "decay", "tone", "punch", "drive", "filter"] as const;

const BASE: DrumParams = { tune: 0, decay: 0.5, tone: 0.5, punch: 0.5, drive: 0, filter: 0, level: 0.8, pan: 0, space: 0.3, echo: 0.2 };
/** Where each drum sits in the mix by default: kick dry and central, snare and clap in the room. */
const MIX: Record<DrumId, Partial<DrumParams>> = {
  kick: { pan: 0, space: 0.05, echo: 0 },
  snare: { pan: 0, space: 0.45, echo: 0.35 },
  clap: { pan: 0.1, space: 0.55, echo: 0.4 },
  hat: { pan: 0.25, space: 0.12, echo: 0.15 },
  open: { pan: 0.25, space: 0.2, echo: 0.15 },
  tom: { pan: -0.25, space: 0.35, echo: 0.3 },
  rim: { pan: -0.15, space: 0.5, echo: 0.55 },
  shaker: { pan: -0.3, space: 0.2, echo: 0.15 },
  bell: { pan: 0.3, space: 0.35, echo: 0.4 },
};
export const defaultParams = (id: DrumId): DrumParams => ({ ...BASE, ...MIX[id] });

/** Short labels for the step grid. */
export const DRUM_LABEL: Record<DrumId, string> = { kick: "Kick", snare: "Snare", clap: "Clap", hat: "Hat", open: "Open", tom: "Tom", rim: "Rim", shaker: "Shake", bell: "Bell" };

/** What the "tone" and "punch" controls do for each drum. */
export const TONE_LABEL: Record<DrumId, string> = { kick: "Click", snare: "Snap", clap: "Bright", hat: "Bright", open: "Bright", tom: "Stick", rim: "Bright", shaker: "Bright", bell: "Bright" };
export const PUNCH_LABEL: Record<DrumId, string> = { kick: "Punch", snare: "Body", clap: "Spread", hat: "Attack", open: "Attack", tom: "Bend", rim: "Knock", shaker: "Attack", bell: "Strike" };

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
  { id: "909", name: "909", hint: "Harder analog: thumping kick, cracking snare, sizzling cymbals.", names: { ...BASE_NAMES, bell: "Ride" } },
  { id: "linn", name: "Linn", hint: "80s studio machine playing real drums: fat kick, big snare, hand claps.", names: { ...BASE_NAMES, rim: "Sidestick", shaker: "Tambourine" } },
  { id: "volca", name: "Volca", hint: "Small analog box: clicky punchy kick, snappy snare, grainy hats.", names: { ...BASE_NAMES, rim: "Clave", bell: "Agogo" } },
  { id: "lofi", name: "Lo-fi", hint: "80s 8-bit sample machine: punchy, gated and crunchy.", names: { ...BASE_NAMES, shaker: "Tambourine" } },
];

export const getKit = (id: KitId): Kit => KITS.find((k) => k.id === id) ?? KITS[0];

/**
 * How loud each drum is rendered: the loudest 40 ms of the sound is brought to this level,
 * so every machine's version of a drum sits at the same place in the mix.
 */
const LOUDNESS: Record<DrumId, number> = { kick: 0.6, snare: 0.17, clap: 0.14, hat: 0.056, open: 0.1, tom: 0.34, rim: 0.078, shaker: 0.082, bell: 0.1 };
/** …but never with a peak above this, however short and spiky the sound is. */
const PEAK: Record<DrumId, number> = { kick: 0.98, snare: 0.8, clap: 0.7, hat: 0.42, open: 0.4, tom: 0.8, rim: 0.55, shaker: 0.4, bell: 0.42 };

// ── DSP helpers ──────────────────────────────────────────────

const TAU = Math.PI * 2;
type Filter = (x: number) => number;

function biquad(kind: "lp" | "hp" | "bp", freq: number, q: number, sr: number): Filter {
  const w = (TAU * Math.min(Math.max(freq, 10), sr * 0.45)) / sr;
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

/** Smooths the edge of a square wave so it does not alias (polyBLEP). */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** A bank of square waves: the source of analog hats, cymbals and cowbells. */
function squares(sr: number, freqs: number[]): () => number {
  const ph = freqs.map((_, i) => (i * 0.137) % 1);
  const dt = freqs.map((f) => Math.min(0.45, f / sr));
  return () => {
    let s = 0;
    for (let k = 0; k < ph.length; k++) {
      let p = ph[k] + dt[k];
      if (p >= 1) p -= 1;
      ph[k] = p;
      const half = p + 0.5 >= 1 ? p - 0.5 : p + 0.5;
      s += (p < 0.5 ? 1 : -1) + blep(p, dt[k]) - blep(half, dt[k]);
    }
    return s / ph.length;
  };
}

/** The 808's six oscillators. */
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
/** A denser, more clangorous set for sampled-cymbal machines. */
const CYMBAL = [263, 400, 421, 474, 587, 845, 1021, 1389];

const ratioOf = (semis: number) => Math.pow(2, semis / 12);
/** Exponential blend between two values. */
const span = (lo: number, hi: number, x: number) => lo * Math.pow(hi / lo, Math.min(1, Math.max(0, x)));
/** Envelope that has fallen 60 dB after `t60` seconds. */
const fall = (t: number, t60: number) => (t < 0 ? 0 : Math.exp((-6.9 * t) / t60));

interface Ctx {
  sr: number;
  p: DrumParams;
  rand: () => number;
  /** tune as a frequency ratio */
  r: number;
}
type Voice = (c: Ctx, kit: KitId) => Float32Array;
const alloc = (sr: number, sec: number) => new Float32Array(Math.max(64, Math.floor(sr * sec)));

// ── Kick ─────────────────────────────────────────────────────

//                                 pitch sweep (fast, slow)      length       click               body
const KICK: Record<KitId, { f0: number; sw1: number; t1: number; sw2: number; t2: number; lo: number; hi: number; click: number; clickF: number; noise: number; drive: number; shape: number }> = {
  box: { f0: 78, sw1: 0.35, t1: 0.008, sw2: 0.06, t2: 0.05, lo: 0.09, hi: 0.5, click: 0.2, clickF: 1400, noise: 0, drive: 1, shape: 0 },
  "808": { f0: 48, sw1: 1.1, t1: 0.006, sw2: 0.14, t2: 0.06, lo: 0.25, hi: 2.8, click: 0.5, clickF: 2600, noise: 0, drive: 1.3, shape: 0 },
  "909": { f0: 51, sw1: 3.6, t1: 0.022, sw2: 0.25, t2: 0.09, lo: 0.16, hi: 1.1, click: 0.9, clickF: 6500, noise: 0.5, drive: 2, shape: 1.5 },
  linn: { f0: 62, sw1: 1, t1: 0.018, sw2: 0.1, t2: 0.08, lo: 0.16, hi: 0.6, click: 0.3, clickF: 2500, noise: 0, drive: 1.2, shape: 0 },
  volca: { f0: 56, sw1: 4.5, t1: 0.014, sw2: 0.2, t2: 0.07, lo: 0.14, hi: 1.2, click: 1, clickF: 5000, noise: 0.2, drive: 2.3, shape: 0 },
  lofi: { f0: 64, sw1: 2.2, t1: 0.035, sw2: 0.1, t2: 0.08, lo: 0.14, hi: 0.55, click: 0.7, clickF: 3000, noise: 0.5, drive: 2.6, shape: 0 },
};

const kick: Voice = ({ sr, p, rand, r }, kit) => {
  const k = KICK[kit];
  const t60 = span(k.lo, k.hi, p.decay);
  const out = alloc(sr, t60 + 0.04);
  const sw1 = k.sw1 * (0.25 + 1.5 * p.punch);
  const click = k.click * p.tone * 2;
  const pulseLp = biquad("lp", k.clickF, 0.7, sr);
  const noiseLp = biquad("lp", k.clickF, 0.7, sr);
  // a real kick: the beater slapping the head, and the air it moves
  const slap = kit === "linn" ? biquad("bp", 3200, 1, sr) : null;
  const thud = kit === "linn" ? biquad("lp", 400, 0.7, sr) : null;
  const pulseLen = Math.floor(sr * 0.0008);
  const norm = k.shape ? Math.tanh(k.shape) : 1;
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    ph += (k.f0 * r * (1 + sw1 * Math.exp(-t / k.t1) + k.sw2 * Math.exp(-t / k.t2))) / sr;
    let body = Math.sin(TAU * ph);
    if (k.shape) body = Math.tanh(k.shape * body) / norm;
    body *= fall(t, t60);
    const n = rand() * 2 - 1;
    let cl = (pulseLp(i < pulseLen ? 1 : 0) * 1.6 + noiseLp(n) * Math.exp(-t / 0.004) * k.noise) * click;
    if (slap && thud) {
      body += 0.25 * Math.sin(TAU * 1.6 * ph) * Math.exp(-t / 0.035); // second mode of the head
      cl += slap(n) * Math.exp(-t / 0.005) * (0.25 + 1.5 * p.tone) + thud(n) * Math.exp(-t / 0.02) * 0.5;
    }
    out[i] = Math.tanh(k.drive * (body + cl));
  }
  return out;
};

// ── Snare ────────────────────────────────────────────────────

interface SnareCfg {
  /** shell tones: frequency, level, ring time */
  f: number[]; a: number[]; t: number[];
  /** downward pitch bend of the shell at the hit */
  drop: number; dropT: number;
  body: number;
  /** noise ("wires") length, short … long */
  nLo: number; nHi: number;
  chain: (sr: number) => Filter[];
  /** stick transient */
  crack: number;
  drive: number;
}
const SNARE: Record<KitId, SnareCfg> = {
  box: { f: [220], a: [1], t: [0.07], drop: 0.1, dropT: 0.01, body: 0.35, nLo: 0.06, nHi: 0.24, chain: (sr) => [biquad("bp", 5200, 0.8, sr), biquad("hp", 1500, 0.7, sr)], crack: 0, drive: 0 },
  "808": { f: [238, 476], a: [1, 0.55], t: [0.18, 0.09], drop: 0.25, dropT: 0.004, body: 0.9, nLo: 0.1, nHi: 0.5, chain: (sr) => [biquad("hp", 2000, 0.7, sr), biquad("lp", 9500, 0.7, sr)], crack: 0, drive: 0 },
  "909": { f: [185, 330], a: [1, 0.6], t: [0.13, 0.07], drop: 0.9, dropT: 0.012, body: 1, nLo: 0.12, nHi: 0.45, chain: (sr) => [biquad("lp", 8000, 0.8, sr), biquad("hp", 1100, 0.7, sr)], crack: 0.3, drive: 1.5 },
  linn: { f: [190, 302, 407, 503], a: [1, 0.5, 0.35, 0.2], t: [0.12, 0.08, 0.06, 0.05], drop: 0.2, dropT: 0.02, body: 0.8, nLo: 0.12, nHi: 0.42, chain: (sr) => [biquad("bp", 4200, 0.5, sr), biquad("hp", 1200, 0.7, sr)], crack: 0.9, drive: 1.1 },
  volca: { f: [185], a: [1], t: [0.11], drop: 0.6, dropT: 0.015, body: 0.8, nLo: 0.07, nHi: 0.32, chain: (sr) => [biquad("bp", 3600, 0.6, sr), biquad("hp", 900, 0.7, sr)], crack: 0, drive: 0 },
  lofi: { f: [200], a: [1], t: [0.15], drop: 0.9, dropT: 0.015, body: 0.9, nLo: 0.12, nHi: 0.36, chain: (sr) => [biquad("lp", 7000, 0.7, sr), biquad("hp", 350, 0.7, sr)], crack: 0.2, drive: 0 },
};

const snare: Voice = ({ sr, p, rand, r }, kit) => {
  const k = SNARE[kit];
  const nT = span(k.nLo, k.nHi, p.decay);
  const chain = k.chain(sr);
  const crackBp = biquad("bp", 2500, 0.8, sr);
  const out = alloc(sr, Math.max(nT, k.t[0]) + 0.03);
  const ph = k.f.map(() => 0);
  const snap = 0.3 + 1.4 * p.tone;
  const body = k.body * (0.4 + 1.2 * p.punch);
  const gate = kit === "lofi" ? nT * 0.6 : Infinity; // the abrupt "gated" tail of 80s sample snares
  const real = kit === "linn";
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const bend = 1 + k.drop * Math.exp(-t / k.dropT);
    let tone = 0;
    for (let m = 0; m < ph.length; m++) {
      ph[m] += (k.f[m] * r * bend) / sr;
      tone += k.a[m] * Math.sin(TAU * ph[m]) * fall(t, k.t[m]);
    }
    const white = rand() * 2 - 1;
    let n = white;
    for (const f of chain) n = f(n);
    // real snare wires rattle hard at first and then hiss on
    let env = real ? 0.6 * fall(t, nT * 0.35) + 0.4 * fall(t, nT) : fall(t, nT);
    if (t > gate) env *= Math.exp(-(t - gate) / 0.012);
    const y = body * tone + snap * n * env + k.crack * crackBp(white) * Math.exp(-t / 0.003) * 2;
    out[i] = k.drive ? Math.tanh(k.drive * y) : y;
  }
  return out;
};

// ── Clap ─────────────────────────────────────────────────────

const CLAP: Record<KitId, { f: number; q: number; hp: number; hands: number; gap: number; jitter: number; lo: number; hi: number; air: number }> = {
  box: { f: 1500, q: 1.2, hp: 600, hands: 3, gap: 0.009, jitter: 0, lo: 0.07, hi: 0.32, air: 0 },
  "808": { f: 1050, q: 1.4, hp: 500, hands: 4, gap: 0.0105, jitter: 0, lo: 0.12, hi: 0.7, air: 0 },
  "909": { f: 1300, q: 1, hp: 700, hands: 4, gap: 0.009, jitter: 0, lo: 0.12, hi: 0.65, air: 0.5 },
  linn: { f: 1900, q: 1.3, hp: 800, hands: 7, gap: 0.006, jitter: 0.005, lo: 0.08, hi: 0.32, air: 0.35 },
  volca: { f: 1250, q: 1.2, hp: 500, hands: 4, gap: 0.011, jitter: 0, lo: 0.1, hi: 0.5, air: 0 },
  lofi: { f: 1150, q: 1.2, hp: 450, hands: 4, gap: 0.012, jitter: 0, lo: 0.1, hi: 0.5, air: 0 },
};

const clap: Voice = ({ sr, p, rand, r }, kit) => {
  const k = CLAP[kit];
  const t60 = span(k.lo, k.hi, p.decay);
  const centre = k.f * r * (0.7 + 0.6 * p.tone);
  const bp = biquad("bp", centre, k.q, sr);
  const air = biquad("bp", centre * 2.1, 0.9, sr);
  const hp = biquad("hp", k.hp, 0.7, sr);
  // several hands, one after another, then the room: "spread" pulls them apart
  const gap = k.gap * (0.5 + p.punch);
  const starts = Array.from({ length: k.hands }, (_, i) => i * gap + (i ? (rand() - 0.5) * 2 * k.jitter : 0)).sort((a, b) => a - b);
  const last = starts[starts.length - 1];
  const out = alloc(sr, last + t60 + 0.04);
  let hand = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    while (hand < starts.length - 1 && t >= starts[hand + 1]) hand++;
    const env = t < last ? Math.exp(-(t - starts[hand]) / 0.0035) : 0.85 * fall(t - last, t60);
    const n = rand() * 2 - 1;
    out[i] = hp(bp(n) + k.air * air(n)) * env;
  }
  return out;
};

// ── Hats ─────────────────────────────────────────────────────

/** How much of the sound is the square-wave "metal" rather than plain noise. */
const HAT_METAL: Record<KitId, number> = { box: 0, "808": 1, "909": 0.55, linn: 0.2, volca: 0.6, lofi: 0.5 };

function hatVoice(open: boolean): Voice {
  return ({ sr, p, rand, r }, kit) => {
    const t60 = open ? span(kit === "909" ? 0.3 : 0.25, kit === "909" ? 1.7 : 1.3, p.decay) : span(0.035, 0.17, p.decay);
    const g = 0.72 + 0.56 * p.tone;
    const mix = HAT_METAL[kit];
    const sampled = kit === "909" || kit === "linn";
    const osc = squares(sr, (sampled ? CYMBAL.map((f) => f * 1.6) : METAL).map((f) => f * r));
    const lowBand = biquad("bp", 3440 * g, 1, sr);
    const highBand = kit === "box" ? biquad("hp", 7500 * g, 0.7, sr) : biquad("bp", (sampled ? 8600 : 7100) * g, sampled ? 0.8 : 1.2, sr);
    const hp = biquad("hp", (kit === "box" ? 5000 : sampled ? 6800 : 6200) * g, 0.7, sr);
    const ring = biquad("bp", (kit === "linn" ? 11800 : 9500) * g, kit === "linn" ? 4 : 2.5, sr);
    const top = kit === "box" ? biquad("lp", 13000 * g, 0.7, sr) : null; // old noise circuits ran out of treble
    const out = alloc(sr, t60 + 0.02);
    const tick = (open ? 0.25 : 1.2) * p.punch;
    const swell = open ? 0.0006 + (1 - p.punch) * 0.012 : 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const src = mix * osc() * 1.4 + (1 - mix) * (rand() * 2 - 1);
      let y = highBand(src);
      if (kit === "808") y += 0.5 * lowBand(src);
      y = hp(y);
      if (kit === "box" || kit === "linn") y += 0.5 * ring(src);
      if (top) y = top(y);
      // the 909's cymbals were short, coarse recordings: the grain is part of the sound
      if (kit === "909") y = Math.round(Math.max(-1, Math.min(1, y * 2.5)) * 48) / 48;
      let env = fall(t, t60) + tick * Math.exp(-t / 0.004);
      if (swell) env *= 1 - Math.exp(-t / swell);
      // two real cymbals rattling against each other
      if (open && kit === "linn") env *= 1 + 0.18 * Math.sin(TAU * 37 * t) * Math.exp(-t / 0.25);
      out[i] = y * env;
    }
    return out;
  };
}

// ── Tom ──────────────────────────────────────────────────────

const TOM: Record<KitId, { f0: number; bend: number; bendT: number; parts: [number, number, number][]; lo: number; hi: number; noise: number; drive: number }> = {
  box: { f0: 190, bend: 0.12, bendT: 0.02, parts: [[1, 1, 1], [2.3, 0.25, 0.4]], lo: 0.07, hi: 0.3, noise: 0.5, drive: 0 }, // bongo
  "808": { f0: 110, bend: 0.35, bendT: 0.05, parts: [[1, 1, 1]], lo: 0.16, hi: 0.95, noise: 0.6, drive: 0 },
  "909": { f0: 118, bend: 1, bendT: 0.03, parts: [[1, 1, 1], [1.5, 0.4, 0.6], [2.2, 0.25, 0.4]], lo: 0.14, hi: 0.8, noise: 0.8, drive: 1.6 },
  linn: { f0: 124, bend: 0.28, bendT: 0.04, parts: [[1, 1, 1], [1.5, 0.45, 0.5], [1.98, 0.3, 0.35], [2.44, 0.15, 0.25]], lo: 0.2, hi: 0.75, noise: 1.2, drive: 1.1 },
  volca: { f0: 135, bend: 0.5, bendT: 0.04, parts: [[1, 1, 1]], lo: 0.16, hi: 0.9, noise: 0.8, drive: 1.3 },
  lofi: { f0: 125, bend: 0.6, bendT: 0.04, parts: [[1, 1, 1], [1.5, 0.3, 0.5]], lo: 0.14, hi: 0.6, noise: 0.8, drive: 1.8 },
};

const tom: Voice = ({ sr, p, rand, r }, kit) => {
  const k = TOM[kit];
  const t60 = span(k.lo, k.hi, p.decay);
  const bend = k.bend * (0.3 + 1.4 * p.punch);
  const stick = biquad(kit === "linn" ? "bp" : "lp", kit === "linn" ? 3200 : 2500, 0.8, sr);
  const out = alloc(sr, t60 + 0.03);
  const ph = k.parts.map(() => 0);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const f = k.f0 * r * (1 + bend * Math.exp(-t / k.bendT));
    let y = 0;
    for (let m = 0; m < ph.length; m++) {
      ph[m] += (f * k.parts[m][0]) / sr;
      y += k.parts[m][1] * Math.sin(TAU * ph[m]) * fall(t, t60 * k.parts[m][2]);
    }
    y += stick(rand() * 2 - 1) * Math.exp(-t / 0.006) * p.tone * k.noise;
    out[i] = k.drive ? Math.tanh(k.drive * y) : y;
  }
  return out;
};

// ── Rim / clave / sidestick ──────────────────────────────────

const RIM: Record<KitId, { parts: [number, number][]; lo: number; hi: number; clip: number; knock: number; wood: number }> = {
  box: { parts: [[2450, 1]], lo: 0.03, hi: 0.16, clip: 0, knock: 0.1, wood: 0 }, // clave
  "808": { parts: [[455, 1], [1667, 0.7]], lo: 0.018, hi: 0.08, clip: 3, knock: 0.5, wood: 0 }, // rimshot: two short pings
  "909": { parts: [[220, 0.7], [500, 1], [1000, 0.8]], lo: 0.02, hi: 0.09, clip: 5, knock: 0.5, wood: 0 },
  linn: { parts: [[520, 0.6], [1380, 1], [2900, 0.35]], lo: 0.025, hi: 0.09, clip: 0, knock: 0.7, wood: 1.6 }, // stick laid across the snare
  volca: { parts: [[2450, 1], [4900, 0.12]], lo: 0.03, hi: 0.14, clip: 0, knock: 0.1, wood: 0 }, // clave
  lofi: { parts: [[820, 1], [2100, 0.4]], lo: 0.03, hi: 0.1, clip: 2, knock: 0.5, wood: 0 },
};

const rim: Voice = ({ sr, p, rand, r }, kit) => {
  const k = RIM[kit];
  const t60 = span(k.lo, k.hi, p.decay);
  const hp = biquad("hp", 2500, 0.7, sr);
  const wood = biquad("bp", 1800, 3, sr);
  const out = alloc(sr, t60 + 0.03);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    let s = 0;
    for (const [f, a] of k.parts) s += a * Math.sin(TAU * f * r * t);
    s *= fall(t, t60);
    if (k.clip) s = Math.tanh(k.clip * s);
    const n = rand() * 2 - 1;
    s += hp(n) * Math.exp(-t / 0.0015) * p.tone * 1.6;
    if (k.wood) s += wood(n) * Math.exp(-t / 0.004) * k.wood;
    s += Math.sin(TAU * 180 * r * t) * Math.exp(-t / 0.012) * p.punch * k.knock * 0.9;
    out[i] = s;
  }
  return out;
};

// ── Shaker / maracas / tambourine ────────────────────────────

const SHAKER: Record<KitId, { hp: number; jingles: [number, number][]; jAmt: number; attack: number; lo: number; hi: number }> = {
  box: { hp: 6500, jingles: [[8200, 9], [11500, 11]], jAmt: 2.2, attack: 0.004, lo: 0.09, hi: 0.45 }, // tambourine
  "808": { hp: 6500, jingles: [], jAmt: 0, attack: 0.012, lo: 0.04, hi: 0.22 }, // maracas
  "909": { hp: 7500, jingles: [[9500, 5]], jAmt: 0.8, attack: 0.008, lo: 0.05, hi: 0.25 },
  linn: { hp: 5200, jingles: [[6100, 10], [8300, 12], [10900, 12], [13200, 10]], jAmt: 2.6, attack: 0.003, lo: 0.1, hi: 0.5 }, // tambourine
  volca: { hp: 5500, jingles: [], jAmt: 0, attack: 0.012, lo: 0.04, hi: 0.22 },
  lofi: { hp: 5500, jingles: [[8200, 9], [11500, 11]], jAmt: 2.2, attack: 0.004, lo: 0.09, hi: 0.45 }, // tambourine
};

const shaker: Voice = ({ sr, p, rand, r }, kit) => {
  const k = SHAKER[kit];
  const t60 = span(k.lo, k.hi, p.decay);
  const bright = r * (0.7 + 0.6 * p.tone);
  const hp = biquad("hp", k.hp * bright, 0.7, sr);
  const top = biquad("lp", 12500 * bright, 0.7, sr);
  const jingles = k.jingles.map(([f, q]) => biquad("bp", f * bright, q, sr));
  const attack = Math.max(0.001, k.attack * (2.2 - 2.4 * p.punch)); // shakers swell in, tambourines hit
  const again = kit === "linn" ? 0.019 : 0; // a real tambourine's jingles land twice
  const out = alloc(sr, t60 + attack + again + 0.02);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const n = rand() * 2 - 1;
    let y = top(hp(n));
    for (const j of jingles) y += k.jAmt * j(n);
    let env = t < attack ? t / attack : fall(t - attack, t60);
    if (again && t > again) env += 0.5 * fall(t - again, t60 * 0.7);
    out[i] = y * env;
  }
  return out;
};

// ── Cowbell / agogo / ride ───────────────────────────────────

const bell: Voice = ({ sr, p, rand, r }, kit) => {
  const bright = 0.7 + 0.6 * p.tone;
  const strike = p.punch * 2;
  if (kit === "909") {
    // ride cymbal: a long metallic wash with a ping on top
    const t60 = span(0.5, 2.4, p.decay);
    const out = alloc(sr, t60 + 0.02);
    const osc = squares(sr, CYMBAL.map((f) => f * 1.3 * r));
    const bp = biquad("bp", 5200 * bright, 0.8, sr);
    const hp = biquad("hp", 3500 * bright, 0.7, sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      const y = hp(bp(0.7 * osc() * 1.4 + 0.3 * (rand() * 2 - 1)));
      out[i] = (Math.round(Math.max(-1, Math.min(1, y * 2.5)) * 48) / 48) * (fall(t, t60) + 0.6 * strike * Math.exp(-t / 0.02));
    }
    return out;
  }
  const t60 = span(0.12, 0.9, p.decay);
  const out = alloc(sr, t60 + 0.02);
  if (kit === "volca" || kit === "linn") {
    // struck metal as a handful of ringing partials: an agogo, or a real cowbell
    const parts = kit === "volca" ? [[920, 1, 1], [1385, 0.7, 1], [2760, 0.3 + 0.5 * p.tone, 0.8]] : [[562, 1, 1], [845, 0.8, 0.8], [1408, 0.3 * bright, 0.5], [2240, 0.2 * bright, 0.35], [3360, 0.1 * bright, 0.25]];
    const hp = biquad("hp", 3000, 0.7, sr);
    for (let i = 0; i < out.length; i++) {
      const t = i / sr;
      let s = 0;
      for (const [f, a, len] of parts) s += a * Math.sin(TAU * f * r * t) * (0.5 * Math.exp(-t / 0.01) + fall(t, t60 * len));
      out[i] = s + hp(rand() * 2 - 1) * Math.exp(-t / 0.002) * strike * 0.4;
    }
    return out;
  }
  // analog cowbell: two square waves (540 + 800 Hz on the 808) through a band-pass
  const pair = kit === "box" ? [587, 845] : kit === "lofi" ? [560, 845] : [540, 800];
  const osc = squares(sr, pair.map((f) => f * r));
  const bp = biquad("bp", (kit === "box" ? 1700 : 2500) * bright, kit === "box" ? 0.9 : 1.5, sr);
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    out[i] = bp(osc()) * (0.7 * strike * Math.exp(-t / 0.012) + 0.5 * fall(t, t60));
  }
  return out;
};

const VOICES: Record<DrumId, Voice> = { kick, snare, clap, hat: hatVoice(false), open: hatVoice(true), tom, rim, shaker, bell };

// ── Finishing ────────────────────────────────────────────────

/** 8-bit, half-rate playback: the crunch of mid-80s sample machines. */
function crush(data: Float32Array, hold: number, bits: number) {
  const q = Math.pow(2, bits - 1);
  let held = 0;
  for (let i = 0; i < data.length; i++) {
    if (i % hold === 0) held = Math.round(data[i] * q) / q;
    data[i] = held;
  }
}

/** 8-bit companded storage, as on early-80s sampled machines: quiet grit that follows the sound. */
function compand(data: Float32Array) {
  const mu = 255;
  const ln = Math.log(1 + mu);
  for (let i = 0; i < data.length; i++) {
    const x = Math.max(-1, Math.min(1, data[i]));
    const y = Math.round((Math.log(1 + mu * Math.abs(x)) / ln) * 127) / 127;
    data[i] = (Math.sign(x) * (Math.exp(y * ln) - 1)) / mu;
  }
}

function peakOf(data: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
  return peak;
}

function scale(data: Float32Array, by: number) {
  for (let i = 0; i < data.length; i++) data[i] *= by;
}

/** Loudest 40 ms of the sound (RMS). */
function loudest(data: Float32Array, sr: number): number {
  const win = Math.max(1, Math.floor(sr * 0.04));
  let best = 0;
  for (let s = 0; s < data.length; s += win >> 2 || 1) {
    let sum = 0;
    const e = Math.min(data.length, s + win);
    for (let i = s; i < e; i++) sum += data[i] * data[i];
    best = Math.max(best, Math.sqrt(sum / win));
  }
  return best;
}

/** Per-drum saturation: more harmonics and a flatter, fatter sound, at the same loudness. */
function saturate(data: Float32Array, drive: number, sr: number) {
  const g = 1 + 11 * drive * drive;
  const hp = biquad("hp", 18, 0.7, sr); // the lopsided curve shifts the wave off centre; bring it back
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    data[i] = hp(Math.tanh(g * x + 0.2 * (g - 1) * x * x));
  }
}

/** One-knob filter: left of centre closes a low-pass, right of centre opens a high-pass. */
function sweep(data: Float32Array, amount: number, sr: number) {
  const f = amount < 0 ? biquad("lp", span(18000, 220, -amount), 0.8, sr) : biquad("hp", span(20, 4500, amount), 0.8, sr);
  for (let i = 0; i < data.length; i++) data[i] = f(data[i]);
}

/** Render one drum hit. Pure: the same inputs always give the same samples. */
export function renderDrum(sr: number, kit: KitId, id: DrumId, params: Partial<DrumParams> = {}): Float32Array {
  const p = { ...defaultParams(id), ...params };
  const out = VOICES[id]({ sr, p, rand: drumRng(DRUM_IDS.indexOf(id) * 7919 + 17), r: ratioOf(p.tune) }, kit);
  scale(out, 0.95 / (peakOf(out) || 1));
  if (p.drive > 0.001) {
    saturate(out, p.drive, sr);
    scale(out, 0.95 / (peakOf(out) || 1));
  }
  if (kit === "lofi") crush(out, Math.max(1, Math.round(sr / 24000)), 8);
  if (kit === "linn") {
    if (id !== "hat" && id !== "open" && id !== "shaker") {
      const lp = biquad("lp", 11000, 0.7, sr);
      for (let i = 0; i < out.length; i++) out[i] = lp(out[i]);
    }
    compand(out);
  }
  // same loudness whichever machine and settings, without ever clipping
  scale(out, Math.min(LOUDNESS[id] / (loudest(out, sr) || 1), PEAK[id] / (peakOf(out) || 1)));
  if (Math.abs(p.filter) > 0.001) {
    sweep(out, p.filter, sr);
    const peak = peakOf(out);
    if (peak > 0.98) scale(out, 0.98 / peak);
  }
  const fade = Math.min(out.length, Math.floor(sr * 0.008));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

// ── Reverb ───────────────────────────────────────────────────

/**
 * The room the drums play in, as a stereo impulse response: a few early reflections and a
 * tail of noise that gets darker as it dies away. `size` 0 is a small room, 1 a long hall.
 */
export function renderSpace(sr: number, size: number, rand: () => number = Math.random): [Float32Array, Float32Array] {
  const s = Math.min(1, Math.max(0, size));
  const t60 = 0.35 + s * s * 4.2;
  const pre = 0.004 + s * 0.022;
  const len = Math.floor(sr * Math.min(6, pre + t60 * 1.05));
  const make = () => {
    const d = new Float32Array(len);
    const start = Math.floor(pre * sr);
    for (let k = 0; k < 6 + Math.floor(s * 6); k++) {
      const at = pre + 0.004 + rand() * 0.07 * (0.4 + s);
      const i = Math.floor(at * sr);
      if (i < len) d[i] += (rand() < 0.5 ? -1 : 1) * 0.6 * Math.exp(-(at - pre) / 0.05);
    }
    let lp = 0;
    for (let i = start; i < len; i++) {
      const t = i / sr - pre;
      lp += (0.12 + 0.75 * Math.exp(-t / (0.25 + s * 0.6))) * (rand() * 2 - 1 - lp);
      d[i] += lp * fall(t, t60) * Math.min(1, t / 0.012);
    }
    const fade = Math.floor(sr * 0.02);
    for (let i = 0; i < fade && i < len; i++) d[len - 1 - i] *= i / fade;
    // unit energy: whatever the size, the room gives back as much sound as it is sent
    let energy = 0;
    for (let i = 0; i < len; i++) energy += d[i] * d[i];
    scale(d, 1 / Math.sqrt(energy || 1));
    return d;
  };
  return [make(), make()];
}
