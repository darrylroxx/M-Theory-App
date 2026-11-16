/**
 * The sound library: about a hundred drum sounds, each a short recipe for one general drum
 * synthesizer. The engine follows how the classic machines and the best drum synths build
 * their sounds (from circuit studies, the Mutable Instruments Plaits source, Perry Cook's
 * PhISEM shaker models and Sound On Sound's "Synth Secrets"):
 *
 *  tone      oscillators with a fast pitch drop, an optional slow sag, several membrane modes, FM
 *  ping      a pulse ringing a resonant filter: the TR-808's bridged-T way of making a drum
 *  metal     a bank of square waves (or ring-modulated pairs) through band-pass filters: hats, bells
 *  noise     white, pink or clocked noise, filtered, with a hold, a gated tail or clap bursts
 *  click     a very short pulse: beater, stick, transient
 *  partials  many decaying sine partials: cymbals, triangles, bells
 *  particles beads and jingles colliding: shakers, tambourines, cabasa
 *
 * then shaping (ring modulation, EQ, saturation, clipping) and optional sampler grit.
 * Pure maths on arrays: the same inputs always give the same samples.
 */
import type { DrumId, DrumParams } from "./drums";

const TAU = Math.PI * 2;

// ── recipe format ────────────────────────────────────────────

type Wave = "sine" | "tri" | "sq" | "saw";
/** Times are in milliseconds. D is the time to fall 60 dB. Levels (g, level) are in dB. */
interface Env {
  /** delay before the layer starts */
  at?: number;
  A?: number;
  H?: number;
  D: number;
  level?: number;
}
interface Tone extends Env {
  t: "tone";
  f: number;
  wave?: Wave;
  /** start phase, 0…1 (0.25 = the peak: a click) */
  phase?: number;
  /** modes: frequency ratio, level dB, decay scale */
  modes?: [number, number, number][];
  /** pitch starts k times higher and falls with time constant tau */
  k?: number;
  tau?: number;
  /** a second, slower drop */
  k2?: number;
  tau2?: number;
  /** FM: modulator ratio, index, index time constant */
  fm?: [number, number, number];
}
interface Ping {
  t: "ping";
  /** resonators: frequency, decay (ms to −60 dB), level dB */
  rings: [number, number, number][];
  /** the pulse makes every resonator jump k times higher for tau ms (the 808 "attack") */
  k?: number;
  tau?: number;
  k2?: number;
  tau2?: number;
  /** how much of the pulse itself is heard, dB */
  leak?: number;
  level?: number;
}
interface Metal extends Env {
  t: "metal";
  f: number[];
  /** multiply pairs of squares instead of adding them */
  ring?: boolean;
  /** FM metal: carrier, modulator, index */
  fm?: [number, number, number];
  bp?: [number, number][];
  hp?: number;
  lp?: number;
  /** two-stage envelope: fall fast to this share, with time constant ms, then decay */
  drop?: [number, number];
}
interface Noise extends Env {
  t: "noise";
  color?: "white" | "pink" | "clock";
  /** clock rate for clocked (sample-and-hold) noise */
  clock?: number;
  /** half-wave rectified (808 snare) */
  rect?: boolean;
  hp?: number;
  bp?: [number, number];
  lp?: number;
  /** clap: bursts, gap between them, random spread, each burst's decay; the tail follows */
  bursts?: [number, number, number, number];
  /** amplitude wobble: rate Hz, depth 0…1 */
  am?: [number, number];
  /** the noise follows a drum head that decays in this many ms (snare wires) */
  couple?: [number, number];
}
interface Click {
  t: "click";
  len: number;
  noise?: boolean;
  hp?: number;
  lp?: number;
  bp?: [number, number];
  level?: number;
}
interface Partials extends Env {
  t: "partials";
  n: number;
  lo: number;
  hi: number;
  /** fixed partial frequencies instead of random ones */
  list?: number[];
  /** the upper half fades in over this many ms (a cymbal's swell) */
  swell?: number;
  /** pairs of partials a few Hz apart: beating */
  split?: boolean;
  seed?: number;
}
interface Particles {
  t: "particles";
  objects: number;
  soundDecay: number;
  systemDecay: number;
  /** resonances: frequency, radius, gain */
  res: [number, number, number][];
  /** shakes: time ms, strength */
  shakes: [number, number][];
  dur: number;
  level?: number;
}
type Layer = Tone | Ping | Metal | Noise | Click | Partials | Particles;

interface Post {
  ring?: number;
  /** peaking EQ before drive: frequency, dB, Q */
  peak?: [number, number, number];
  drive?: number;
  clip?: number;
  /** transistor-style soft clip */
  soft?: number;
  fold?: number;
  lp?: number;
  hp?: number;
  /** sampler character: rate Hz, bits, mu-law */
  rate?: number;
  bits?: number;
  mulaw?: boolean;
  trem?: [number, number];
}

export interface Recipe {
  id: string;
  name: string;
  layers: Layer[];
  post?: Post;
}

// ── helpers ──────────────────────────────────────────────────

const db = (x = 0) => Math.pow(10, x / 20);
const fall = (t: number, D: number) => Math.exp((-6.9 * t) / Math.max(1e-4, D));

function biquad(kind: "lp" | "hp" | "bp" | "peak", freq: number, q: number, sr: number, gainDb = 0) {
  const w = (TAU * Math.min(Math.max(freq, 10), sr * 0.45)) / sr;
  const cs = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (kind === "peak") {
    const A = Math.pow(10, gainDb / 40);
    b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A;
  } else {
    a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    if (kind === "lp") { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (kind === "hp") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x: number) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

/** Envelope: linear attack, hold, then exponential decay. */
function envAt(e: Env, t: number, dk: number): number {
  const s = t - (e.at ?? 0) / 1000;
  if (s < 0) return 0;
  const A = (e.A ?? 0) / 1000;
  if (s < A) return s / A;
  const H = (e.H ?? 0) / 1000;
  if (s < A + H) return 1;
  return fall(s - A - H, (e.D / 1000) * dk);
}
const envLen = (e: Env, dk: number) => ((e.at ?? 0) + (e.A ?? 0) + (e.H ?? 0) + e.D * dk) / 1000;

function wave(w: Wave | undefined, ph: number): number {
  const p = ph - Math.floor(ph);
  switch (w) {
    case "tri": {
      const x = 4 * Math.abs(p - 0.5) - 1;
      return (2 * x) / (1 + Math.abs(x)) / 0.667; // a triangle shaped towards a sine, as the 909 does
    }
    case "sq":
      return p < 0.5 ? 1 : -1;
    case "saw":
      return 2 * p - 1;
    default:
      return Math.sin(TAU * p);
  }
}

/** polyBLEP square bank (no aliasing whine). */
function squares(sr: number, freqs: number[]) {
  const ph = freqs.map((_, i) => (i * 0.137) % 1);
  const dt = freqs.map((f) => Math.min(0.45, f / sr));
  const blep = (t: number, d: number) => {
    if (t < d) { const x = t / d; return x + x - x * x - 1; }
    if (t > 1 - d) { const x = (t - 1) / d; return x * x + x + x + 1; }
    return 0;
  };
  const out = new Float64Array(freqs.length);
  return () => {
    for (let k = 0; k < ph.length; k++) {
      let p = ph[k] + dt[k];
      if (p >= 1) p -= 1;
      ph[k] = p;
      const half = p + 0.5 >= 1 ? p - 0.5 : p + 0.5;
      out[k] = (p < 0.5 ? 1 : -1) + blep(p, dt[k]) - blep(half, dt[k]);
    }
    return out;
  };
}

/** Pink noise (Paul Kellet's filter). */
function pink(rand: () => number) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    const y = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    return y * 0.11;
  };
}

// ── the renderer ─────────────────────────────────────────────

interface Knobs {
  sr: number;
  /** tune as a frequency ratio */
  r: number;
  /** decay scale */
  dk: number;
  /** brightness scale (tone knob) */
  br: number;
  /** pitch-drop and attack scale (punch knob) */
  pk: number;
  /** tone knob 0…1 */
  tone: number;
  rand: () => number;
}

function layerLen(L: Layer, dk: number): number {
  switch (L.t) {
    case "ping": return Math.max(...L.rings.map(([, D]) => D * dk)) / 1000 + 0.01;
    case "click": return L.len / 1000 + 0.01;
    case "particles": return L.dur * dk;
    case "noise": return envLen(L, dk) + (L.bursts ? (L.bursts[0] - 1) * L.bursts[1] / 1000 * 1.5 : 0);
    default: return envLen(L, dk);
  }
}

function renderTone(L: Tone, k: Knobs, out: Float32Array) {
  const { sr, r, dk, pk } = k;
  const modes = L.modes ?? [[1, 0, 1]];
  const kk = 1 + ((L.k ?? 1) - 1) * pk;
  const tau = (L.tau ?? 10) / 1000;
  const k2 = L.k2 ?? 1;
  const tau2 = (L.tau2 ?? 100) / 1000;
  const ph = modes.map(() => L.phase ?? 0);
  const gains = modes.map(([, g]) => db(g));
  let fmPh = 0;
  const g0 = db(L.level);
  const end = Math.min(out.length, Math.ceil(envLen(L, dk) * sr));
  for (let i = Math.floor(((L.at ?? 0) / 1000) * sr); i < end; i++) {
    const t = i / sr;
    const f = L.f * r * (1 + (kk - 1) * Math.exp(-t / tau)) * (1 + (k2 - 1) * Math.exp(-t / tau2));
    let pm = 0;
    if (L.fm) {
      fmPh += (f * L.fm[0]) / sr;
      pm = L.fm[1] * Math.exp(-t / (L.fm[2] / 1000)) * Math.sin(TAU * fmPh) / TAU;
    }
    let s = 0;
    for (let m = 0; m < modes.length; m++) {
      ph[m] += (f * modes[m][0]) / sr;
      s += gains[m] * wave(L.wave, ph[m] + pm) * envAt({ ...L, D: L.D * modes[m][2] }, t, dk);
    }
    out[i] += g0 * s;
  }
}

/** Topology-preserving state-variable filter: stays stable while its frequency sweeps every sample. */
function svf() {
  let ic1 = 0, ic2 = 0;
  return (x: number, g: number, kq: number) => {
    const a1 = 1 / (1 + g * (g + kq)), a2 = g * a1, a3 = g * a2;
    const v3 = x - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    return v1;
  };
}

function renderPing(L: Ping, k: Knobs, out: Float32Array) {
  const { sr, r, dk, pk } = k;
  const kk = 1 + ((L.k ?? 1) - 1) * pk;
  const tau = (L.tau ?? 6) / 1000;
  const k2 = L.k2 ?? 1;
  const tau2 = (L.tau2 ?? 200) / 1000;
  const pulseN = Math.max(1, Math.round(sr * 0.001));
  const tmp = new Float32Array(out.length);
  for (const [f0, D, g] of L.rings) {
    const filt = svf();
    const Dk = (D / 1000) * dk;
    const end = Math.min(out.length, Math.ceil((Dk + 0.01) * sr));
    tmp.fill(0, 0, end);
    let peak = 1e-9;
    for (let i = 0; i < end; i++) {
      const t = i / sr;
      const pulse = i < pulseN ? 1 : Math.exp(-(i - pulseN) / (sr * 0.0002));
      const f = Math.min(sr * 0.45, f0 * r * (1 + (kk - 1) * Math.exp(-t / tau)) * (1 + (k2 - 1) * Math.exp(-t / tau2)));
      const q = Math.max(0.6, (Dk * f) / 2.2);
      const y = filt(pulse, Math.tan((Math.PI * f) / sr), 1 / q);
      tmp[i] = y;
      if (Math.abs(y) > peak) peak = Math.abs(y);
    }
    const gain = (db(g) * db(L.level)) / peak;
    for (let i = 0; i < end; i++) out[i] += tmp[i] * gain;
  }
  if (L.leak !== undefined) {
    const lp = biquad("lp", 2000, 0.7, sr);
    for (let i = 0; i < pulseN * 6 && i < out.length; i++) out[i] += lp(i < pulseN ? 1 : 0) * db(L.leak) * db(L.level);
  }
}

function renderMetal(L: Metal, k: Knobs, out: Float32Array) {
  const { sr, r, dk, br } = k;
  const freqs = L.fm ? [] : L.f.map((f) => f * r);
  const bank = freqs.length ? squares(sr, freqs) : null;
  const bps = (L.bp ?? []).map(([f, q]) => biquad("bp", f * Math.sqrt(br) * Math.sqrt(r), q, sr));
  const hp = L.hp ? biquad("hp", L.hp * Math.sqrt(br), 0.7, sr) : null;
  const hp2 = L.hp ? biquad("hp", L.hp * Math.sqrt(br), 0.7, sr) : null;
  const lp = L.lp ? biquad("lp", L.lp * br, 0.7, sr) : null;
  let cph = 0, mph = 0;
  const g0 = db(L.level);
  const end = Math.min(out.length, Math.ceil(envLen(L, dk) * sr));
  for (let i = Math.floor(((L.at ?? 0) / 1000) * sr); i < end; i++) {
    const t = i / sr;
    let s = 0;
    if (L.fm) {
      // a square wave whose pitch is thrown up and down by another square: clangorous metal
      mph += (L.fm[1] * r) / sr;
      cph += (L.fm[0] * r + L.fm[2] * (mph % 1 < 0.5 ? 1 : -1)) / sr;
      s = cph % 1 < 0.5 ? 1 : -1;
    } else {
      const v = bank!();
      if (L.ring) for (let m = 0; m + 1 < v.length; m += 2) s += v[m] * v[m + 1];
      else for (let m = 0; m < v.length; m++) s += v[m];
      s /= L.ring ? Math.max(1, v.length / 2) : v.length;
    }
    let y = bps.length ? bps.reduce((a, f) => a + f(s), 0) : s;
    if (hp && hp2) y = hp2(hp(y));
    if (lp) y = lp(y);
    let e = envAt(L, t, dk);
    if (L.drop) {
      const s0 = t - (L.at ?? 0) / 1000;
      e *= L.drop[0] + (1 - L.drop[0]) * Math.exp(-s0 / (L.drop[1] / 1000));
    }
    out[i] += g0 * y * e;
  }
}

function renderNoise(L: Noise, k: Knobs, out: Float32Array) {
  const { sr, r, dk, br, pk, rand } = k;
  const src = L.color === "pink" ? pink(rand) : () => rand() * 2 - 1;
  let held = 0;
  const step = L.color === "clock" ? Math.max(1, sr / ((L.clock ?? 12000) * Math.sqrt(r))) : 1;
  let acc = 0;
  const fr = Math.sqrt(r);
  const hp = L.hp ? biquad("hp", L.hp * fr * Math.pow(br, 0.3), 0.7, sr) : null;
  const bp = L.bp ? biquad("bp", L.bp[0] * fr * Math.pow(br, 0.6), L.bp[1], sr) : null;
  const lp = L.lp ? biquad("lp", L.lp * fr * br, 0.7, sr) : null;
  const g0 = db(L.level);
  const at = (L.at ?? 0) / 1000;
  // clap bursts
  let starts: number[] = [];
  let each = 0;
  if (L.bursts) {
    const [n, gap, jit, eachMs] = L.bursts;
    const spread = 0.5 + pk * 0.5;
    starts = Array.from({ length: n }, (_, j) => (j * gap * spread + (j ? (rand() - 0.5) * 2 * jit : 0)) / 1000).sort((a, b) => a - b);
    each = eachMs / 1000;
  }
  const last = starts.length ? starts[starts.length - 1] : 0;
  const end = Math.min(out.length, Math.ceil((layerLen(L, dk) + 0.005) * sr));
  for (let i = Math.floor(at * sr); i < end; i++) {
    const t = i / sr;
    let x: number;
    if (L.color === "clock") {
      acc += 1;
      if (acc >= step) { acc -= step; held = rand() * 2 - 1; }
      x = held;
    } else x = src();
    if (L.rect) x = Math.max(0, x) * 2 - 0.5;
    if (hp) x = hp(x);
    if (bp) x = bp(x);
    if (lp) x = lp(x);
    let e: number;
    if (starts.length) {
      const s = t - at;
      if (s < last) {
        let j = 0;
        while (j + 1 < starts.length && s >= starts[j + 1]) j++;
        e = s < starts[j] ? 0 : fall(s - starts[j], each);
      } else e = envAt({ ...L, at: 0 }, s - last, dk) * 0.85;
    } else e = envAt(L, t, dk);
    if (L.am) e *= 1 + L.am[1] * Math.sin(TAU * L.am[0] * t);
    if (L.couple) e *= 1 - L.couple[0] + L.couple[0] * fall(t, (L.couple[1] / 1000) * dk);
    out[i] += g0 * x * e;
  }
}

function renderClick(L: Click, k: Knobs, out: Float32Array) {
  const { sr, br, tone, rand } = k;
  const n = Math.max(1, Math.round((L.len / 1000) * sr));
  const hp = L.hp ? biquad("hp", L.hp * Math.sqrt(br), 0.7, sr) : null;
  const bp = L.bp ? biquad("bp", L.bp[0] * Math.sqrt(br), L.bp[1], sr) : null;
  const lp = L.lp ? biquad("lp", L.lp * br, 0.7, sr) : null;
  const g = db(L.level) * (0.15 + 1.7 * tone);
  for (let i = 0; i < Math.min(out.length, n * 8 + 64); i++) {
    let x = i < n ? (L.noise ? rand() * 2 - 1 : 1) : 0;
    if (hp) x = hp(x);
    if (bp) x = bp(x);
    if (lp) x = lp(x);
    out[i] += g * x;
  }
}

function renderPartials(L: Partials, k: Knobs, out: Float32Array) {
  const { sr, r, dk, br } = k;
  let s = (L.seed ?? 7) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const parts: { f: number; g: number; D: number; sw: number; ph: number }[] = [];
  const freqs = L.list ?? Array.from({ length: L.n }, () => L.lo * Math.pow(L.hi / L.lo, rnd()));
  const mid = Math.sqrt(L.lo * L.hi);
  for (const f0 of freqs) {
    const f = f0 * r;
    if (f > sr * 0.45) continue;
    const g = Math.pow(f0 / 1000, -0.3) * (0.6 + 0.8 * rnd()) * (f0 > 3000 ? Math.pow(br, 0.7) : 1);
    const D = (L.D / 1000) * dk * Math.pow(f0 / 1000, L.list ? -0.15 : -0.4) * (0.7 + 0.6 * rnd());
    const sw = L.swell && f0 > mid ? L.swell / 1000 : 0;
    parts.push({ f, g, D, sw, ph: rnd() });
    if (L.split) parts.push({ f: f + 2 + 13 * rnd(), g: g * 0.7, D, sw, ph: rnd() });
  }
  const g0 = db(L.level) / Math.sqrt(parts.length || 1);
  const start = Math.floor(((L.at ?? 0) / 1000) * sr);
  const A = (L.A ?? 0) / 1000;
  for (const p of parts) {
    // a rotating phasor instead of Math.sin for every sample
    const w = (TAU * p.f) / sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    let c = Math.cos(TAU * p.ph), sn = Math.sin(TAU * p.ph);
    const end = Math.min(out.length, start + Math.ceil((A + p.sw + p.D) * sr));
    for (let i = start; i < end; i++) {
      const t = (i - start) / sr;
      const att = A + p.sw;
      const e = t < att ? t / att : fall(t - att, p.D);
      out[i] += g0 * p.g * sn * e;
      const nc = c * cw - sn * sw;
      sn = sn * cw + c * sw;
      c = nc;
    }
  }
}

/** Perry Cook's PhISEM: beads or jingles colliding, each collision exciting a few resonances. */
function renderParticles(L: Particles, k: Knobs, out: Float32Array) {
  const { sr, r, dk, br, rand } = k;
  const scale = 44100 / sr;
  const sysD = Math.pow(L.systemDecay, scale / dk);
  const sndD = Math.pow(L.soundDecay, scale);
  const res = L.res.map(([f, rad, g]) => {
    const rr = Math.pow(rad, scale);
    const w = (TAU * Math.min(sr * 0.45, f * r * Math.sqrt(br))) / sr;
    return { a1: -2 * rr * Math.cos(w), a2: rr * rr, g, y1: 0, y2: 0 };
  });
  let energy = 0;
  let level = 0;
  const shakes = L.shakes.map(([t, e]) => [Math.floor((t / 1000) * sr), e]);
  const g0 = db(L.level);
  const end = Math.min(out.length, Math.ceil(L.dur * dk * sr));
  for (let i = 0; i < end; i++) {
    for (const [at, e] of shakes) if (at === i) energy += e;
    energy *= sysD;
    if (rand() * 1024 < L.objects) level += energy;
    level *= sndD;
    const x = level * (rand() * 2 - 1);
    let y = 0;
    for (const q of res) {
      const v = x - q.a1 * q.y1 - q.a2 * q.y2;
      q.y2 = q.y1;
      q.y1 = v;
      y += q.g * (v - q.y2);
    }
    out[i] += g0 * y;
  }
}

function mulaw(x: number, bits: number) {
  const mu = 255;
  const ln = Math.log(1 + mu);
  const q = Math.pow(2, bits - 1) - 1;
  const y = Math.round((Math.sign(x) * Math.log(1 + mu * Math.min(1, Math.abs(x)))) / ln * q) / q;
  return (Math.sign(y) * (Math.exp(Math.abs(y) * ln) - 1)) / mu;
}

/** Sampler grit: hold samples at a lower rate (no filter, so it aliases like the old boxes) and quantise. */
export function sampler(data: Float32Array, sr: number, rate: number, bits: number, law: boolean, smooth = 0) {
  const step = Math.min(1, rate / sr);
  const q = Math.pow(2, bits - 1);
  let acc = 1;
  let held = 0;
  let peak = 1e-9;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  for (let i = 0; i < data.length; i++) {
    acc += step;
    if (acc >= 1) {
      acc -= 1;
      const x = data[i] / peak; // sampled hot, as people did
      held = (law ? mulaw(x, bits) : Math.round(x * q) / q) * peak;
    }
    data[i] = held;
  }
  if (smooth > 0) {
    const a = biquad("lp", smooth, 0.7, sr), b = biquad("lp", smooth, 0.7, sr);
    for (let i = 0; i < data.length; i++) data[i] = b(a(data[i]));
  }
}

function post(data: Float32Array, P: Post, sr: number) {
  if (P.ring) {
    for (let i = 0; i < data.length; i++) data[i] *= Math.sin((TAU * P.ring * i) / sr) >= 0 ? 1 : -1;
  }
  if (P.peak) {
    const f = biquad("peak", P.peak[0], P.peak[2], sr, P.peak[1]);
    for (let i = 0; i < data.length; i++) data[i] = f(data[i]);
  }
  let peak = 1e-9;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (P.drive || P.clip || P.soft || P.fold) {
    for (let i = 0; i < data.length; i++) {
      let x = data[i] / peak;
      if (P.drive) x = Math.tanh(P.drive * x) / Math.tanh(P.drive);
      if (P.soft) { const s = x * P.soft; x = (3 * s) / (2 + Math.abs(s)); }
      if (P.fold) x = Math.sin(x * P.fold * Math.PI / 2);
      if (P.clip) x = Math.max(-1, Math.min(1, x * P.clip));
      data[i] = x;
    }
  }
  if (P.hp) {
    const a = biquad("hp", P.hp, 0.7, sr), b = biquad("hp", P.hp, 0.7, sr);
    for (let i = 0; i < data.length; i++) data[i] = b(a(data[i]));
  }
  if (P.lp) {
    const a = biquad("lp", P.lp, 0.7, sr), b = biquad("lp", P.lp, 0.7, sr);
    for (let i = 0; i < data.length; i++) data[i] = b(a(data[i]));
  }
  if (P.trem) for (let i = 0; i < data.length; i++) data[i] *= 1 - P.trem[1] * (0.5 + 0.5 * Math.sin((TAU * P.trem[0] * i) / sr));
  if (P.rate || P.bits) sampler(data, sr, P.rate ?? sr, P.bits ?? 16, !!P.mulaw, P.rate ? P.rate * 0.42 : 0);
}

/** Render one recipe with the drum's knob settings. Returns raw samples (normalised later). */
export function renderRecipe(sr: number, R: Recipe, p: DrumParams, rand: () => number): Float32Array {
  const k: Knobs = {
    sr,
    r: Math.pow(2, p.tune / 12),
    dk: Math.pow(2, (p.decay - 0.5) * 2.4),
    br: Math.pow(2, (p.tone - 0.5) * 1.6),
    pk: 0.3 + 1.4 * p.punch,
    tone: p.tone,
    rand,
  };
  const len = Math.min(6.5, Math.max(...R.layers.map((L) => layerLen(L, k.dk)))) + 0.03;
  const out = new Float32Array(Math.max(64, Math.floor(len * sr)));
  for (const L of R.layers) {
    if (L.t === "tone") renderTone(L, k, out);
    else if (L.t === "ping") renderPing(L, k, out);
    else if (L.t === "metal") renderMetal(L, k, out);
    else if (L.t === "noise") renderNoise(L, k, out);
    else if (L.t === "click") renderClick(L, k, out);
    else if (L.t === "partials") renderPartials(L, k, out);
    else renderParticles(L, k, out);
  }
  if (R.post) post(out, R.post, sr);
  // DC block
  const dc = biquad("hp", 22, 0.7, sr);
  for (let i = 0; i < out.length; i++) out[i] = dc(out[i]);
  return out;
}

// ── the library ──────────────────────────────────────────────

const SQ808 = [205.3, 304.4, 369.6, 522.7, 540, 800];
const SQ606 = [245, 306, 365, 415, 437, 619];
const PLAITS = [1, 1.304, 1.466, 1.787, 1.932, 2.536].map((x) => x * 828);
const MEMBRANE: [number, number, number][] = [[1, 0, 1], [1.593, -9, 0.3], [2.136, -14, 0.2], [2.296, -18, 0.15]];
const WOOD: [number, number, number][] = [[1, 0, 1], [2.777, -6, 0.5], [7.378, -12, 0.25], [15.377, -20, 0.13]];

const R = (id: string, name: string, layers: Layer[], postFx?: Post): Recipe => ({ id, name, layers, post: postFx });

export const RECIPES: Record<DrumId, Recipe[]> = {
  kick: [
    R("kick.808long", "808 Long", [{ t: "ping", rings: [[49, 1400, 0]], k: 2.6, tau: 6, k2: 1.06, tau2: 250, leak: -24 }], { lp: 5000 }),
    R("kick.808short", "808 Short", [{ t: "ping", rings: [[56, 280, 0]], k: 2.4, tau: 6, leak: -20 }], { lp: 2500 }),
    R("kick.909", "909", [{ t: "tone", f: 52, wave: "tri", phase: 0.25, k: 4.5, tau: 12, H: 10, D: 450 }, { t: "click", len: 0.5, hp: 1000, level: -8 }, { t: "noise", lp: 5000, D: 8, level: -12 }], { soft: 1.6 }),
    R("kick.909hard", "909 Hard", [{ t: "tone", f: 54, wave: "tri", phase: 0.25, k: 5, tau: 8, H: 6, D: 300 }, { t: "click", len: 0.6, hp: 1500, level: -6 }, { t: "noise", lp: 6000, D: 8, level: -10 }], { drive: 3 }),
    R("kick.sub", "Long Sub", [{ t: "tone", f: 45, k: 2, tau: 15, A: 1, H: 250, D: 2500 }, { t: "tone", f: 90, k: 2, tau: 15, A: 1, H: 150, D: 1500, level: -14 }], { drive: 3, lp: 6000 }),
    R("kick.rumble", "Rumble", [{ t: "tone", f: 50, wave: "tri", phase: 0.25, k: 4.5, tau: 10, H: 8, D: 320 }, { t: "click", len: 0.5, hp: 1200, level: -8 }, { t: "noise", color: "pink", at: 70, A: 90, D: 1100, lp: 140, level: 2 }], { drive: 2.5, hp: 28 }),
    R("kick.industrial", "Industrial", [{ t: "tone", f: 55, k: 6, tau: 8, D: 350 }, { t: "noise", D: 15, bp: [2500, 1], level: -10 }], { peak: [2500, 6, 1], clip: 12, bits: 8 }),
    R("kick.hardcore", "Distorted", [{ t: "tone", f: 65, k: 7, tau: 12, H: 40, D: 500 }], { peak: [250, 9, 1], clip: 25, lp: 5000 }),
    R("kick.felt", "Felt", [{ t: "tone", f: 58, modes: MEMBRANE, k: 1.05, tau: 40, D: 420 }, { t: "noise", bp: [3500, 1], D: 8, level: -10 }, { t: "click", len: 0.5, lp: 8000, level: -14 }]),
    R("kick.dusty", "Dusty", [{ t: "tone", f: 60, k: 3, tau: 10, D: 320 }, { t: "click", len: 0.6, lp: 6000, level: -14 }], { rate: 26040, bits: 12, lp: 7000, drive: 1.5 }),
    R("kick.soft", "Soft", [{ t: "tone", f: 60, A: 3, k: 1.5, tau: 20, D: 300 }], { lp: 1000 }),
    R("kick.stiff", "Stiff", [{ t: "tone", f: 74, k: 2, tau: 5, D: 180 }, { t: "noise", bp: [3000, 1], D: 4, level: -12 }], { rate: 28000, bits: 8, mulaw: true }),
    R("kick.click", "Click", [{ t: "tone", f: 70, k: 8, tau: 2, D: 120 }, { t: "noise", hp: 8000, D: 2, level: -6 }], { clip: 8, bits: 6 }),
    R("kick.blip", "Blip", [{ t: "tone", f: 95, k: 3, tau: 3, D: 60 }]),
    R("kick.round", "Round", [{ t: "tone", f: 64, k: 1.8, tau: 25, D: 500 }], { lp: 300, drive: 1.2 }),
    R("kick.tight", "Tight", [{ t: "tone", f: 62, k: 3, tau: 10, D: 280 }, { t: "click", len: 0.5, hp: 2000, level: -10 }], { drive: 3 }),
  ],
  snare: [
    R("snare.808", "808", [{ t: "ping", rings: [[238, 150, 0], [476, 90, -4]], k: 1.15, tau: 4 }, { t: "noise", rect: true, bp: [3800, 1.2], hp: 1800, D: 200, level: -2 }]),
    R("snare.909", "909", [{ t: "tone", f: 185, wave: "tri", modes: [[1, 0, 1], [1.47, -7.6, 0.8]], k: 3, tau: 7, D: 150 }, { t: "noise", color: "clock", clock: 18000, hp: 1850, lp: 6500, H: 50, D: 180, level: -2 }], { drive: 1.5 }),
    R("snare.acoustic", "Acoustic", [{ t: "tone", f: 180, modes: [[1, 0, 1], [1.833, -3, 0.8], [1.59, -12, 0.5], [2.14, -16, 0.4]], k: 1.04, tau: 30, D: 160 }, { t: "noise", at: 1.5, hp: 1800, bp: [5000, 0.7], lp: 10000, D: 260, couple: [0.4, 120], level: -1 }, { t: "click", len: 0.3, hp: 3000, level: -10 }]),
    R("snare.gated", "Gated", [{ t: "tone", f: 185, wave: "tri", modes: [[1, 0, 1], [1.47, -7.6, 0.8]], k: 3, tau: 7, D: 150 }, { t: "noise", hp: 1850, lp: 6500, H: 50, D: 180, level: -2 }, { t: "noise", bp: [1500, 0.6], lp: 8000, H: 230, D: 25, level: -3 }], { drive: 1.4 }),
    R("snare.dusty", "Dusty", [{ t: "tone", f: 180, modes: [[1, 0, 1], [1.833, -3, 0.8]], k: 1.04, tau: 30, D: 150 }, { t: "noise", hp: 1800, bp: [5000, 0.7], D: 240, couple: [0.4, 120] }], { rate: 26040, bits: 12, lp: 8000, drive: 2 }),
    R("snare.steppers", "Rim Snare", [{ t: "tone", f: 330, modes: [[1, 0, 1], [1.7, -3, 0.8]], D: 90 }, { t: "noise", hp: 3000, D: 110, level: -3 }]),
    R("snare.crack", "Crack", [{ t: "tone", f: 210, k: 1.5, tau: 4, D: 120 }, { t: "noise", bp: [3500, 0.8], D: 160 }], { drive: 4 }),
    R("snare.cold", "Cold", [{ t: "tone", f: 240, D: 90 }, { t: "noise", hp: 2500, D: 160 }], { rate: 28000, bits: 8, mulaw: true }),
    R("snare.soft", "Soft", [{ t: "noise", A: 4, bp: [4000, 0.6], lp: 9000, D: 300 }, { t: "tone", f: 170, D: 120, level: -12 }]),
    R("snare.tight", "Tight", [{ t: "tone", f: 230, D: 80 }, { t: "noise", hp: 3000, D: 140 }, { t: "noise", hp: 600, bp: [1500, 2], bursts: [3, 7, 1, 7], D: 110, level: -3 }], { drive: 2 }),
    R("snare.brush", "Brush", [{ t: "noise", bp: [3000, 0.8], lp: 7000, A: 80, D: 400, level: -6 }, { t: "noise", hp: 2000, lp: 8000, D: 60 }, { t: "tone", f: 190, D: 80, level: -14 }]),
    R("snare.piccolo", "Piccolo", [{ t: "tone", f: 320, modes: [[1, 0, 1], [1.75, -3, 0.8]], D: 70 }, { t: "noise", hp: 4000, D: 120 }]),
    R("snare.industrial", "Industrial", [{ t: "tone", f: 200, D: 150 }, { t: "noise", hp: 1500, D: 200 }], { ring: 1300, clip: 10, bits: 6 }),
    R("snare.hyper", "Snap", [{ t: "tone", f: 350, k: 3, tau: 3, D: 100 }, { t: "noise", hp: 5000, D: 90 }], { clip: 6 }),
    R("snare.modal", "Modal", [{ t: "tone", f: 200, modes: [[1, 0, 1], [2, -4, 0.4], [3.18, -8, 0.33], [4.16, -10, 0.27], [5.62, -12, 0.2]], D: 150 }, { t: "noise", rect: true, bp: [3200, 1], D: 200, level: -2 }]),
  ],
  clap: [
    R("clap.808", "808", [{ t: "noise", bp: [1000, 1.8], bursts: [4, 10, 0, 9], D: 120 }]),
    R("clap.909", "909", [{ t: "noise", bp: [1150, 1.2], hp: 700, bursts: [3, 9, 0, 8], D: 250 }]),
    R("clap.tight", "Tight", [{ t: "noise", bp: [1500, 2], hp: 600, bursts: [4, 7, 1, 7], D: 110 }], { drive: 2 }),
    R("clap.crowd", "Crowd", [{ t: "noise", bp: [1300, 1.2], bursts: [8, 3.2, 3, 8], D: 180 }, { t: "noise", bp: [2100, 2], bursts: [6, 4, 3, 7], D: 140, level: -3 }]),
    R("clap.gated", "Gated", [{ t: "noise", bp: [1000, 1.8], bursts: [4, 10, 0, 9], D: 120 }, { t: "noise", bp: [1500, 0.6], lp: 8000, at: 30, H: 200, D: 25, level: -3 }]),
    R("clap.snap", "Snap", [{ t: "noise", bp: [2200, 4], D: 30 }, { t: "click", len: 1, noise: true, hp: 1000 }, { t: "tone", f: 1700, D: 20, level: -10 }]),
    R("clap.dusty", "Dusty", [{ t: "noise", bp: [1000, 1.8], bursts: [4, 10, 0, 9], D: 130 }], { rate: 26040, bits: 12, lp: 7000 }),
    R("clap.crunch", "Crunch", [{ t: "noise", bp: [1150, 1.2], hp: 700, bursts: [3, 9, 0, 8], D: 220 }], { clip: 8, bits: 6 }),
    R("clap.soft", "Soft", [{ t: "noise", A: 2, bp: [800, 1], lp: 4000, bursts: [3, 14, 0, 12], D: 400 }]),
    R("clap.dry", "Dry", [{ t: "noise", bp: [1600, 2], bursts: [4, 8, 0, 6], D: 60 }]),
    R("clap.cold", "Cold", [{ t: "noise", bp: [1200, 1.5], bursts: [3, 10, 0, 8], D: 160 }], { rate: 28000, bits: 8, mulaw: true }),
  ],
  hat: [
    R("hat.808", "808", [{ t: "metal", f: SQ808, bp: [[3440, 1.5], [7100, 1.5]], hp: 6500, D: 50 }]),
    R("hat.606", "606", [{ t: "metal", f: SQ606, bp: [[7500, 1]], hp: 6000, D: 40 }]),
    R("hat.909", "909", [{ t: "metal", f: SQ808.map((x) => x * 2), hp: 8000, D: 60 }, { t: "noise", hp: 8000, D: 50, level: -4 }], { rate: 32000, bits: 6, lp: 12000 }),
    R("hat.metal", "Metal", [{ t: "metal", f: PLAITS, bp: [[6000, 4]], hp: 6000, D: 70, drop: [0.5, 8] }]),
    R("hat.noise", "Noise", [{ t: "noise", hp: 7000, bp: [10000, 2], D: 30 }]),
    R("hat.fm", "FM", [{ t: "metal", f: [], fm: [2500, 1000, 3000], hp: 7000, D: 45 }]),
    R("hat.ring", "Ring", [{ t: "metal", f: [587, 845, 1351, 1793], ring: true, hp: 8000, D: 40 }]),
    R("hat.crisp", "Crisp", [{ t: "noise", hp: 9000, D: 25 }, { t: "metal", f: SQ808, hp: 7000, D: 25, level: -10 }]),
    R("hat.dusty", "Dusty", [{ t: "noise", bp: [7000, 0.7], D: 40 }], { rate: 26040, bits: 12 }),
    R("hat.pedal", "Pedal", [{ t: "noise", hp: 5000, A: 2, D: 60 }, { t: "noise", bp: [2500, 1], D: 30, level: -6 }, { t: "noise", lp: 800, D: 10, level: -10 }]),
    R("hat.tick", "Tick", [{ t: "noise", hp: 10000, D: 6 }]),
    R("hat.grind", "Grind", [{ t: "noise", hp: 3000, D: 50 }], { ring: 3000, clip: 6, bits: 6 }),
    R("hat.soft", "Soft", [{ t: "noise", bp: [6000, 0.7], A: 5, D: 120, lp: 10000 }]),
    R("hat.acoustic", "Acoustic", [{ t: "partials", n: 40, lo: 3000, hi: 16000, D: 80 }, { t: "noise", bp: [4000, 1], D: 10, level: -6 }]),
  ],
  open: [
    R("open.808", "808", [{ t: "metal", f: SQ808, bp: [[3440, 1.5], [7100, 1.5]], hp: 6500, D: 450 }]),
    R("open.606", "606", [{ t: "metal", f: SQ606, bp: [[7500, 1]], hp: 6000, D: 350 }]),
    R("open.909", "909", [{ t: "metal", f: SQ808.map((x) => x * 2), hp: 8000, D: 350 }, { t: "noise", hp: 8000, D: 300, level: -4 }], { rate: 32000, bits: 6, lp: 12000 }),
    R("open.disco", "Disco", [{ t: "metal", f: SQ808.map((x) => x * 2), hp: 8000, A: 3, D: 300, drop: [0.7, 150] }, { t: "noise", hp: 8000, A: 3, D: 280, level: -4 }]),
    R("open.trap", "Bright", [{ t: "noise", hp: 9000, D: 220 }, { t: "metal", f: SQ808, hp: 7000, D: 220, level: -8 }]),
    R("open.acoustic", "Acoustic", [{ t: "partials", n: 80, lo: 2000, hi: 16000, D: 850, swell: 30 }, { t: "noise", hp: 6000, D: 600, level: -12 }]),
    R("open.sizzle", "Sizzle", [{ t: "noise", hp: 6000, D: 600, am: [20, 0.2] }, { t: "metal", f: PLAITS, hp: 6000, D: 500, level: -6 }]),
    R("open.fm", "FM", [{ t: "metal", f: [], fm: [2500, 1000, 3000], hp: 7000, D: 400 }]),
    R("open.half", "Half", [{ t: "metal", f: SQ808, bp: [[3440, 1.5], [7100, 1.5]], hp: 6500, D: 150 }]),
    R("open.swell", "Swell", [{ t: "noise", hp: 7000, A: 120, D: 15 }]),
    R("open.dusty", "Dusty", [{ t: "noise", bp: [7000, 0.7], D: 350 }], { rate: 26040, bits: 12 }),
  ],
  tom: [
    R("tom.808", "808", [{ t: "ping", rings: [[135, 250, 0]], k: 1.15, tau: 60 }, { t: "noise", color: "pink", D: 120, level: -18 }]),
    R("tom.909", "909", [{ t: "tone", f: 150, wave: "tri", k: 1.6, tau: 30, D: 350 }, { t: "noise", lp: 3000, D: 30, level: -12 }]),
    R("tom.simmons", "Electronic", [{ t: "tone", f: 160, wave: "tri", k: 2.5, tau: 120, D: 500 }, { t: "noise", bp: [1000, 1], D: 40, level: -10 }]),
    R("tom.syn", "Syn Drop", [{ t: "tone", f: 250, k: 3, tau: 200, D: 600 }]),
    R("tom.floor", "Floor", [{ t: "tone", f: 82, modes: MEMBRANE, k: 1.08, tau: 60, D: 900 }, { t: "noise", bp: [2500, 1], D: 10, level: -14 }]),
    R("tom.rack", "Rack", [{ t: "tone", f: 150, modes: MEMBRANE, k: 1.08, tau: 60, D: 600 }, { t: "noise", bp: [2500, 1], D: 10, level: -14 }]),
    R("tom.conga", "Conga", [{ t: "ping", rings: [[250, 180, 0]], k: 1.04, tau: 30 }]),
    R("tom.slap", "Slap", [{ t: "tone", f: 330, modes: [[1, 0, 1], [1.59, -8, 0.4], [2.14, -12, 0.3]], D: 120 }, { t: "noise", bp: [1800, 1.5], D: 25, level: -6 }]),
    R("tom.bongo", "Bongo", [{ t: "tone", f: 450, modes: [[1, 0, 1], [1.38, -4, 0.8]], k: 1.04, tau: 20, D: 120 }]),
    R("tom.dusty", "Dusty", [{ t: "tone", f: 150, wave: "tri", k: 1.6, tau: 30, D: 350 }], { rate: 26040, bits: 12 }),
    R("tom.dub", "Dub", [{ t: "tone", f: 200, k: 2, tau: 150, D: 700 }]),
    R("tom.cold", "Cold", [{ t: "tone", f: 130, k: 1.3, tau: 20, D: 250 }], { rate: 28000, bits: 8, mulaw: true }),
  ],
  rim: [
    R("rim.808", "808", [{ t: "ping", rings: [[455, 25, 0], [1667, 20, -2]] }], { hp: 300 }),
    R("rim.909", "909", [{ t: "ping", rings: [[500, 30, 0], [1100, 25, -3], [1800, 20, -6]] }, { t: "noise", hp: 2000, D: 3, level: -6 }]),
    R("rim.sidestick", "Sidestick", [{ t: "tone", f: 400, modes: WOOD, D: 60 }, { t: "click", len: 1, noise: true, hp: 2000, level: -4 }]),
    R("rim.claves", "Claves", [{ t: "ping", rings: [[2500, 55, 0]] }, { t: "click", len: 0.5, hp: 3000, level: -10 }]),
    R("rim.woodhi", "Woodblock", [{ t: "tone", f: 1100, modes: WOOD, D: 80 }]),
    R("rim.woodlo", "Low Block", [{ t: "tone", f: 700, modes: WOOD, D: 80 }]),
    R("rim.dub", "Dub", [{ t: "tone", f: 1000, modes: [[1, 0, 1], [1.6, -3, 0.7]], D: 40 }, { t: "click", len: 0.5, hp: 2000, level: -6 }]),
    R("rim.linn", "Stick", [{ t: "tone", f: 400, modes: WOOD, D: 60 }, { t: "click", len: 1, noise: true, hp: 2000, level: -4 }], { rate: 28000, bits: 8, mulaw: true }),
    R("rim.tick", "Tick", [{ t: "ping", rings: [[3000, 25, 0]] }]),
    R("rim.tink", "Tink", [{ t: "tone", f: 2400, D: 40 }], { clip: 3 }),
    R("rim.log", "Log", [{ t: "tone", f: 220, modes: [[1, 0, 1], [1.217, -3, 0.9], [1.475, -6, 0.8], [1.729, -9, 0.7]], D: 150 }]),
  ],
  shaker: [
    R("shaker.maraca", "Maraca", [{ t: "particles", objects: 25, soundDecay: 0.95, systemDecay: 0.999, res: [[3200, 0.96, 1]], shakes: [[0, 1]], dur: 0.15 }]),
    R("shaker.cabasa", "Cabasa", [{ t: "particles", objects: 512, soundDecay: 0.96, systemDecay: 0.997, res: [[3000, 0.7, 1]], shakes: [[0, 1]], dur: 0.12 }]),
    R("shaker.sekere", "Sekere", [{ t: "particles", objects: 64, soundDecay: 0.96, systemDecay: 0.999, res: [[5500, 0.6, 1]], shakes: [[0, 1]], dur: 0.2 }]),
    R("shaker.tamb", "Tambourine", [{ t: "particles", objects: 32, soundDecay: 0.95, systemDecay: 0.9985, res: [[2300, 0.96, 0.1], [5600, 0.995, 0.8], [8100, 0.995, 1]], shakes: [[0, 1]], dur: 0.35 }]),
    R("shaker.sleigh", "Sleigh Bells", [{ t: "particles", objects: 32, soundDecay: 0.97, systemDecay: 0.9994, res: [[2500, 0.99, 1], [5300, 0.99, 1], [6500, 0.99, 1], [8300, 0.99, 0.5], [9800, 0.99, 0.3]], shakes: [[0, 1]], dur: 0.5 }]),
    R("shaker.guiro", "Guiro", [{ t: "particles", objects: 128, soundDecay: 0.95, systemDecay: 0.9995, res: [[2500, 0.97, 1], [4000, 0.97, 1]], shakes: [[0, 0.5], [25, 0.5], [50, 0.5], [75, 0.5], [100, 0.5]], dur: 0.2 }]),
    R("shaker.808", "Maracas", [{ t: "noise", hp: 5000, A: 1, D: 40 }]),
    R("shaker.16th", "Shaker", [{ t: "noise", bp: [6000, 1.5], A: 15, D: 70 }]),
    R("shaker.egg", "Egg", [{ t: "noise", bp: [5000, 1.2], A: 25, D: 60 }, { t: "noise", at: 20, bp: [5000, 1.2], A: 10, D: 60, level: -4 }]),
    R("shaker.jingle", "Jingles", [{ t: "partials", n: 0, lo: 5000, hi: 11000, list: [5600, 8100, 11000, 6900, 9400], D: 250 }, { t: "noise", hp: 6000, D: 250, am: [35, 0.4], level: -4 }]),
  ],
  bell: [
    R("bell.808", "Cowbell", [{ t: "metal", f: [540, 800], bp: [[880, 4.8]], D: 320, drop: [0.25, 8] }]),
    R("bell.agogo", "Agogo", [{ t: "partials", n: 0, lo: 600, hi: 4000, list: [600, 2448, 4001, 3725], D: 220 }]),
    R("bell.fm", "FM Bell", [{ t: "tone", f: 880, fm: [3.5, 4, 300], D: 1500 }]),
    R("bell.ridebell", "Ride Bell", [{ t: "partials", n: 0, lo: 700, hi: 3000, list: [700, 1064, 1589, 2072, 2600, 3300], D: 2500 }, { t: "noise", hp: 5000, D: 1200, level: -16 }]),
    R("bell.vibes", "Vibes", [{ t: "tone", f: 523, modes: [[1, 0, 1], [2.01, -8, 0.6], [3.9, -14, 0.4]], A: 1, D: 2000 }], { trem: [5, 0.3] }),
    R("bell.marimba", "Marimba", [{ t: "tone", f: 392, modes: [[1, 0, 1], [3.99, -10, 0.4], [10.65, -18, 0.2]], A: 2, D: 600 }]),
    R("bell.triangle", "Triangle", [{ t: "partials", n: 0, lo: 1200, hi: 8200, list: [1200, 2400, 3700, 5100, 6600, 8200], D: 3000 }]),
    R("bell.clang", "Clang", [{ t: "metal", f: [587, 845], ring: true, bp: [[1500, 2]], D: 250 }]),
    R("bell.glass", "Glass", [{ t: "partials", n: 0, lo: 2600, hi: 7100, list: [2600, 7100], D: 400 }]),
    R("bell.crash", "Crash", [{ t: "partials", n: 56, lo: 900, hi: 15000, D: 2400, swell: 40, split: true, seed: 11 }, { t: "noise", hp: 4500, D: 1500, level: -4 }, { t: "noise", bp: [3000, 1], D: 5, level: -6 }]),
    R("bell.ride", "Ride", [{ t: "partials", n: 40, lo: 2500, hi: 6000, D: 2500, split: true, seed: 5 }, { t: "noise", hp: 4000, D: 3000, level: -12 }, { t: "noise", bp: [3500, 1], D: 4, level: -8 }]),
    R("bell.china", "China", [{ t: "noise", bp: [1400, 2], D: 1500 }, { t: "metal", f: [1130, 1750, 2380], D: 1500, level: -3 }], { ring: 1130, drive: 3, peak: [2500, 6, 1] }),
    R("bell.808cym", "808 Cymbal", [{ t: "metal", f: SQ808, bp: [[3440, 1.5]], D: 1200 }, { t: "metal", f: SQ808, bp: [[7100, 1.5]], D: 250 }, { t: "metal", f: SQ808, hp: 9000, D: 60 }]),
    R("bell.reverse", "Reverse", [{ t: "noise", hp: 4000, bp: [8000, 0.5], A: 900, D: 20 }]),
  ],
};

export const ALL_RECIPES: Recipe[] = Object.values(RECIPES).flat();
const BY_ID = new Map(ALL_RECIPES.map((r) => [r.id, r]));
export const getRecipe = (id: string): Recipe | undefined => BY_ID.get(id);
