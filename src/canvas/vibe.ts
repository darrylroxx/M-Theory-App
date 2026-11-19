/**
 * The vibe of a piece of music: about seventy numbers that say what it is like as a whole, and
 * a steady way of turning them into how the painting looks.
 *
 * The numbers (the "fingerprint") are measured from the sound as it plays, the way the research
 * for this canvas proposes (`research_notes/Synths harmony stems and vibe painting/vibe_painting.md`):
 *
 * - **timbre (35)**: the shape of the spectrum as the ear hears it (the means and spreads of
 *   twelve mel-cepstral coefficients, leaving out the first, which is only loudness), how far
 *   the peaks of six octave bands stand above their valleys, how noise-like four broad bands
 *   are, and where the weight of the sound sits, in octaves;
 * - **harmony (16)**: how clearly it is in a key, how major or minor, how fast its harmony moves
 *   (distance travelled per second on the tonal-centroid "tonnetz"), how rough its intervals
 *   are, and the strength of each of the twelve notes counted from the key note (smoothed and
 *   quantised as librosa's CENS chroma is), so a song transposed is still the same song;
 * - **rhythm (10)**: tempo (folded into one octave), onsets a second, how clear the pulse is,
 *   danceability (a detrended fluctuation analysis of the loudness, as essentia's), and how the
 *   loudness swings in six bands of modulation from half a beat a second to ten;
 * - **dynamics (5)**: the loudness range, how far the loudness strays from its usual level, the
 *   peak over the average, the share of short notes, and how long notes last against the gaps
 *   between them (legato against staccato);
 * - **texture and roles (8)**: tone against hit, how many layers play at once, how much of the
 *   sound is drums, bass, chords, melody and voice, and how noisy it is.
 *
 * Every one of them is a ratio or measured in decibels against the music itself, so turning the
 * whole song up or down changes none of them: the measure is of the music, not of its level.
 *
 * Each number is then read against fixed reference figures (not against the song itself, which
 * would erase what makes two songs differ) and squashed into −1..1. From there, the look is:
 *
 * - **continuous**: four broad axes (energy, brightness of mood, groove, density) are smooth
 *   functions of the numbers, and everything else (how wet the paint is, how loose the hand,
 *   how fast the currents, how many marks, how long the strokes, how far the drops fly, how
 *   light the colours) is a smooth function of those. Music that is a little different looks a
 *   little different;
 * - **arbitrary but steady** where there is no reason to prefer one choice to another (which way
 *   round the palette the parts are cast, where the currents and anchors fall): random numbers
 *   pinned to the corners of a coarse grid over the axes and blended smoothly between them, so
 *   similar music lands on the same choice and distant music on different ones;
 * - **chosen with patience** for layouts: each has a score, and the canvas changes only when
 *   another leads clearly, and for at least a bar.
 *
 * The fine detail of every mark stays its own (`strokes.ts`): two similar songs share style and
 * structure, while their marks, which follow their own notes, never repeat.
 */
import { CONTRAST_BANDS, FLAT_BANDS, MEL_BANDS, type Frame } from "../listen/ear";
import { keyFits } from "../listen/mood";
import type { LayerKind } from "./layers";
import type { LayoutId } from "./place";
import { hash } from "./rand";

export const VIBE_DIMS = 74;
/** The five groups of the fingerprint: in comparing two songs each group counts the same. */
export const GROUPS: { name: string; from: number; to: number }[] = [
  { name: "timbre", from: 0, to: 35 },
  { name: "harmony", from: 35, to: 51 },
  { name: "rhythm", from: 51, to: 61 },
  { name: "dynamics", from: 61, to: 66 },
  { name: "texture", from: 66, to: 74 },
];
/** Where each measure sits in the fingerprint. */
export const AT = {
  mfcc: 0,
  mfccSpread: 12,
  contrast: 24,
  flat: 30,
  centroid: 34,
  clarity: 35,
  major: 36,
  change: 37,
  rough: 38,
  cens: 39,
  tempo: 51,
  onsets: 52,
  pulse: 53,
  dance: 54,
  swing: 55,
  range: 61,
  stray: 62,
  crest: 63,
  short: 64,
  legato: 65,
  tone: 66,
  layers: 67,
  roles: 68,
  noise: 73,
} as const;
/** The roles whose share of the sound is measured, in the order they are kept. */
export const ROLE_ORDER: LayerKind[] = ["drums", "bass", "chords", "melody", "vocals"];

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const FRAME = 0.01;
/** The mel-cepstrum: a discrete cosine transform of the band levels (orthonormal), coefficients 1 to 12. */
function cepstrum(m: ArrayLike<number>, out: Float64Array) {
  const n = MEL_BANDS;
  for (let k = 1; k <= 12; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += m[i] * Math.cos((Math.PI * k * (i + 0.5)) / n);
    out[k - 1] = s * Math.sqrt(2 / n);
  }
}
/** The six tonnetz coordinates of a chroma (fifths, minor thirds and major thirds as circles; radii 1, 1, 0.5), as librosa computes them. */
export function tonnetz(chroma: ArrayLike<number>, out = new Float64Array(6)): Float64Array {
  out.fill(0);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Math.abs(chroma[i]);
  if (sum <= 0) return out;
  for (let i = 0; i < 12; i++) {
    const c = chroma[i] / sum;
    out[0] += c * Math.sin((i * 7 * Math.PI) / 6);
    out[1] += c * Math.cos((i * 7 * Math.PI) / 6);
    out[2] += c * Math.sin((i * 3 * Math.PI) / 2);
    out[3] += c * Math.cos((i * 3 * Math.PI) / 2);
    out[4] += 0.5 * c * Math.sin((i * 2 * Math.PI) / 3);
    out[5] += 0.5 * c * Math.cos((i * 2 * Math.PI) / 3);
  }
  return out;
}
/** How rough two tones are together (Plomp and Levelt's curve, in the parametrisation MIRtoolbox uses). */
export function roughPair(f1: number, f2: number): number {
  const lo = Math.min(f1, f2);
  const s = 0.24 / (0.0207 * lo + 18.96);
  const d = Math.abs(f2 - f1);
  return Math.exp(-3.51 * s * d) - Math.exp(-5.75 * s * d);
}

/** A histogram of decibel values (one-decibel bins) that forgets as the meter does. */
class Spread {
  readonly bins = new Float64Array(100);
  add(db: number, w = 1) {
    this.bins[Math.max(0, Math.min(99, Math.round(db + 100)))] += w;
  }
  scale(k: number) {
    for (let i = 0; i < 100; i++) this.bins[i] *= k;
  }
  total() {
    let s = 0;
    for (let i = 0; i < 100; i++) s += this.bins[i];
    return s;
  }
  /** The value below which a share `q` of what was counted lies. */
  quantile(q: number) {
    const all = this.total();
    if (all <= 0) return -100;
    let acc = 0;
    for (let i = 0; i < 100; i++) {
      acc += this.bins[i];
      if (acc >= q * all) return i - 100;
    }
    return 0;
  }
}

const SLOTS = 74 + 12 + 12 + 12;
/** extra slots after the fingerprint: squares of the cepstrum (for its spread), raw chroma (for the key), smoothed CENS chroma */
const SQ = 74;
const RAW = 86;
const CENS = 98;

/**
 * Measures the vibe of what it is given, a frame at a time (from the ear on the whole mix). With
 * `window` (seconds) it remembers that far back, for music heard live; without, the whole piece.
 */
export class VibeMeter {
  private readonly sum = new Float64Array(SLOTS);
  private readonly wt = new Float64Array(SLOTS);
  private readonly window: number;
  /** the last half-minute of flux and level, a frame each, for rhythm */
  private readonly flux = new Float32Array(3000);
  private readonly lev = new Float32Array(3000);
  private n = 0;
  private sinceRhythm = 0;
  private readonly short = new Spread();
  private readonly fifth = new Spread();
  private stEnergy = 0;
  private fifthE = 0;
  private fifthN = 0;
  private secMax = -200;
  private secE = 0;
  private secN = 0;
  private smooth = new Float64Array(12);
  private cens = new Float64Array(12);
  private tz = new Float64Array(6);
  private tzLast = new Float64Array(6);
  private tzAt = -1;
  private ages = new Map<number, number>();
  private lastBirth = -1;
  private last = -1;
  /** seconds of music heard (with sound in it) */
  heard = 0;
  /** the tempo heard last (beats a minute, folded into 85..170), or 0 before one is heard */
  bpm = 0;

  constructor(window = Infinity) {
    this.window = window;
  }

  private add(i: number, x: number, w = 1) {
    if (!Number.isFinite(x)) return;
    this.sum[i] += x * w;
    this.wt[i] += w;
  }
  private value(i: number, or = 0) {
    return this.wt[i] > 1e-9 ? this.sum[i] / this.wt[i] : or;
  }

  /** Forget a little (live listening only). */
  private forget(dt: number) {
    if (!Number.isFinite(this.window)) return;
    const k = Math.exp(-dt / this.window);
    for (let i = 0; i < SLOTS; i++) {
      this.sum[i] *= k;
      this.wt[i] *= k;
    }
    this.short.scale(k);
    this.fifth.scale(k);
    this.births *= k;
    this.timeSeconds *= k;
  }

  /** What the ear on the whole mix heard. */
  take(f: Frame) {
    const dt = this.last < 0 ? FRAME : clamp(f.t - this.last, 0.001, 0.2);
    this.last = f.t;
    this.forget(dt);
    const loud = f.db > -70;
    // the envelope, for rhythm and dynamics
    const e = Math.pow(10, f.db / 10);
    this.flux[this.n % 3000] = f.flux;
    this.lev[this.n % 3000] = f.db;
    this.n++;
    this.stEnergy += (e - this.stEnergy) * (1 - Math.exp(-dt / 3));
    if (this.n % 10 === 0 && this.stEnergy > 1e-7) this.short.add(10 * Math.log10(this.stEnergy));
    this.fifthE += e;
    this.fifthN++;
    if (this.fifthN >= 20) {
      const db = 10 * Math.log10(this.fifthE / this.fifthN + 1e-14);
      if (db > -70) this.fifth.add(db);
      this.fifthE = 0;
      this.fifthN = 0;
    }
    this.secMax = Math.max(this.secMax, f.db);
    this.secE += e;
    this.secN++;
    if (this.secN >= 100) {
      const mean = 10 * Math.log10(this.secE / this.secN + 1e-14);
      if (mean > -70) this.add(AT.crest, this.secMax - mean);
      this.secMax = -200;
      this.secE = 0;
      this.secN = 0;
    }
    this.add(AT.onsets, f.hits.length / FRAME);
    // notes: how long they last, against how often they begin
    const ended = new Set(f.ended);
    for (const id of ended) {
      const age = this.ages.get(id);
      if (age === undefined) continue;
      this.ages.delete(id);
      this.add(AT.short, age < 0.2 ? 1 : 0);
      this.add(AT.legato, age);
    }
    for (const v of f.voices) {
      this.ages.set(v.id, v.age);
      if (v.fresh) {
        // notes begun together are one onset
        if (v.born - this.lastBirth > 0.05) this.births++;
        this.lastBirth = v.born;
      }
    }
    if (this.ages.size > 256) this.ages.clear();
    if (!loud) return;
    this.heard += dt;
    this.timeSeconds += dt;
    // timbre
    const s = f.shape;
    if (s) {
      const c = new Float64Array(12);
      cepstrum(s, c);
      for (let k = 0; k < 12; k++) {
        this.add(AT.mfcc + k, c[k]);
        this.add(SQ + k, c[k] * c[k]);
      }
      for (let b = 0; b < CONTRAST_BANDS; b++) this.add(AT.contrast + b, s[MEL_BANDS + b]);
      for (let b = 0; b < FLAT_BANDS; b++) this.add(AT.flat + b, s[MEL_BANDS + CONTRAST_BANDS + b]);
    }
    if (f.centroid > 0) this.add(AT.centroid, Math.log2(f.centroid / 1000));
    // harmony
    let any = 0;
    for (let i = 0; i < 12; i++) any += f.chroma[i];
    if (any > 0) {
      for (let i = 0; i < 12; i++) this.add(RAW + i, f.chroma[i]);
      // CENS: quantised (each threshold passed adds a quarter), smoothed over about four tenths of a second
      const k = 1 - Math.exp(-dt / 0.4);
      for (let i = 0; i < 12; i++) {
        const x = f.chroma[i];
        const q = (x > 0.4 ? 0.25 : 0) + (x > 0.2 ? 0.25 : 0) + (x > 0.1 ? 0.25 : 0) + (x > 0.05 ? 0.25 : 0);
        this.cens[i] += (q - this.cens[i]) * k;
        this.smooth[i] += (x - this.smooth[i]) * (1 - Math.exp(-dt / 0.5));
      }
      for (let i = 0; i < 12; i++) this.add(CENS + i, this.cens[i]);
      if (f.t - this.tzAt >= 0.1) {
        tonnetz(this.smooth, this.tz);
        if (this.tzAt >= 0) {
          let d = 0;
          for (let i = 0; i < 6; i++) d += (this.tz[i] - this.tzLast[i]) ** 2;
          this.add(AT.change, Math.sqrt(d) / Math.max(0.05, f.t - this.tzAt));
        }
        this.tzLast.set(this.tz);
        this.tzAt = f.t;
      }
    }
    // roughness of the tones sounding together (the strongest twelve)
    const vs = f.voices.filter((v) => v.amp > 0.05).sort((a, b) => b.amp - a.amp).slice(0, 12);
    if (vs.length) {
      let r = 0;
      let p = 0;
      for (let i = 0; i < vs.length; i++) {
        p += vs[i].amp * vs[i].amp;
        for (let j = i + 1; j < vs.length; j++) r += vs[i].amp * vs[j].amp * roughPair(vs[i].hz, vs[j].hz);
      }
      this.add(AT.rough, r / Math.max(1e-6, p));
    }
    // tone against hit, and noise
    let tone = 0;
    for (const v of f.voices) tone += v.amp;
    let hit = 0;
    for (const h of f.hits) hit += h.strength;
    this.add(AT.tone, tone / (tone + 6 * hit + 0.05));
    let nz = 0;
    for (let b = 0; b < f.noise.length; b++) nz += f.noise[b];
    this.add(AT.noise, nz / Math.max(1, f.noise.length));
    // rhythm, every three seconds, over the last six
    if (++this.sinceRhythm >= 300 && this.n >= 400) {
      this.sinceRhythm = 0;
      this.rhythm();
    }
  }
  private births = 0;
  private timeSeconds = 0;

  /** How loud each layer is just now (0..1, for those measured): how many play, and each one's share. */
  roles(levels: Partial<Record<LayerKind, number>>, dt = FRAME) {
    let n = 0;
    for (const v of Object.values(levels)) if ((v ?? 0) > 0.1) n++;
    this.add(AT.layers, n, dt);
    ROLE_ORDER.forEach((r, i) => this.add(AT.roles + i, clamp(levels[r] ?? 0), dt));
  }

  /** Tempo, pulse, danceability and the swing of the loudness, over the last six seconds. */
  private rhythm() {
    const N = 600;
    const fl = new Float64Array(N);
    const lv = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const j = (this.n - N + i + 3000 * 4) % 3000;
      fl[i] = this.flux[j];
      lv[i] = this.lev[j];
    }
    const r = rhythmOf(fl, lv);
    if (!r) return;
    this.bpm = 120 * Math.pow(2, r.tempo);
    this.add(AT.tempo, r.tempo);
    this.add(AT.pulse, r.pulse);
    this.add(AT.dance, r.dance);
    for (let b = 0; b < 6; b++) this.add(AT.swing + b, r.swing[b]);
  }

  /** The fingerprint, as measured so far (raw values; see `normalise`). */
  fingerprint(): Float32Array {
    const out = new Float32Array(VIBE_DIMS);
    for (let k = 0; k < 12; k++) {
      const m = this.value(AT.mfcc + k);
      out[AT.mfcc + k] = m;
      out[AT.mfccSpread + k] = Math.log(Math.max(0, this.value(SQ + k) - m * m) + 1);
    }
    for (let b = 0; b < CONTRAST_BANDS; b++) out[AT.contrast + b] = this.value(AT.contrast + b);
    for (let b = 0; b < FLAT_BANDS; b++) out[AT.flat + b] = this.value(AT.flat + b);
    out[AT.centroid] = this.value(AT.centroid);
    const raw = Array.from({ length: 12 }, (_, i) => this.value(RAW + i));
    const fits = keyFits(raw);
    out[AT.clarity] = Math.max(fits.major, fits.minor);
    out[AT.major] = fits.major - fits.minor;
    out[AT.change] = this.value(AT.change);
    out[AT.rough] = this.value(AT.rough);
    const cens = Array.from({ length: 12 }, (_, i) => this.value(CENS + ((i + fits.tonic) % 12)));
    const norm = Math.hypot(...cens) || 1;
    for (let i = 0; i < 12; i++) out[AT.cens + i] = cens[i] / norm;
    out[AT.tempo] = this.value(AT.tempo);
    out[AT.onsets] = this.value(AT.onsets);
    out[AT.pulse] = this.value(AT.pulse);
    out[AT.dance] = this.value(AT.dance, 1);
    for (let b = 0; b < 6; b++) out[AT.swing + b] = this.value(AT.swing + b, 1 / 6);
    out[AT.range] = Math.max(0, this.short.quantile(0.95) - this.short.quantile(0.1));
    // how far the loudness strays from its usual level (loud stretches count most)
    let lw = 0;
    let ls = 0;
    const fb = this.fifth.bins;
    for (let i = 0; i < 100; i++) {
      const w = fb[i] * Math.pow(0.9, -(i - 100) / 2);
      lw += w;
      ls += w * (i - 100);
    }
    const L = lw > 0 ? ls / lw : -30;
    let dev = 0;
    let all = 0;
    for (let i = 0; i < 100; i++) {
      dev += fb[i] * Math.abs(i - 100 - L);
      all += fb[i];
    }
    out[AT.stray] = all > 0 ? dev / all : 0;
    out[AT.crest] = this.value(AT.crest, 6);
    out[AT.short] = this.value(AT.short, 0.5);
    const meanDur = this.value(AT.legato, 0.3);
    const rate = this.births / Math.max(1, this.timeSeconds);
    out[AT.legato] = clamp(meanDur * rate, 0, 3);
    out[AT.tone] = this.value(AT.tone, 0.5);
    out[AT.layers] = this.value(AT.layers, 0);
    const roles = ROLE_ORDER.map((_, i) => this.value(AT.roles + i, 0));
    const rs = roles.reduce((a, b) => a + b, 0);
    roles.forEach((v, i) => (out[AT.roles + i] = rs > 0 ? v / rs : 0));
    out[AT.noise] = this.value(AT.noise);
    return out;
  }
}

/**
 * The rhythm of a stretch of music (100 frames a second): its tempo folded into one octave
 * (log2 of beats a minute over 120, between −0.5 and 0.5), how clear its pulse is (the main peak
 * of the onsets' autocorrelation), danceability (one over the mean scaling exponent of a
 * detrended fluctuation analysis of the loudness), and how its loudness swings in six bands of
 * modulation frequency from 0.5 to 10 Hz (weighted as fluctuation strength is, most at 4 Hz;
 * shares adding up to 1). Null for silence.
 */
export function rhythmOf(flux: ArrayLike<number>, db: ArrayLike<number>): { tempo: number; pulse: number; dance: number; swing: number[] } | null {
  const n = flux.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i];
  mean /= n;
  let zero = 0;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = flux[i] - mean;
    zero += x[i] * x[i];
  }
  let maxDb = -200;
  for (let i = 0; i < n; i++) maxDb = Math.max(maxDb, db[i]);
  if (maxDb < -70) return null;
  // the pulse: the strongest repeat of the onsets between 40 and 200 beats a minute (a little weight towards 120)
  let best = 0;
  let bestLag = 50;
  if (zero > 1e-9) {
    for (let lag = 30; lag <= 150; lag++) {
      let s = 0;
      for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
      const c = s / zero;
      const lean = c * (1 - 0.15 * Math.abs(Math.log2(lag / 50)));
      if (lean > best) {
        best = lean;
        bestLag = lag;
      }
    }
  }
  const bpm = 6000 / bestLag;
  let tempo = Math.log2(bpm / 120);
  tempo -= Math.round(tempo);
  // danceability: detrended fluctuation analysis of the amplitude
  const amp = new Float64Array(n);
  let am = 0;
  for (let i = 0; i < n; i++) {
    amp[i] = Math.pow(10, db[i] / 20);
    am += amp[i];
  }
  am /= n;
  const y = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += amp[i] - am;
    y[i] = acc;
  }
  const taus: number[] = [];
  for (let t = 31; t <= Math.min(300, n / 2); t = Math.ceil(t * 1.1)) taus.push(t);
  const F: number[] = [];
  for (const tau of taus) {
    const jump = Math.max(1, Math.floor(tau / 50));
    let res = 0;
    let blocks = 0;
    for (let s0 = 0; s0 + tau <= n; s0 += jump) {
      // the residual of a straight line fitted to the block
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      for (let i = 0; i < tau; i++) {
        const v = y[s0 + i];
        sx += i;
        sy += v;
        sxx += i * i;
        sxy += i * v;
      }
      const den = tau * sxx - sx * sx;
      const b = den !== 0 ? (tau * sxy - sx * sy) / den : 0;
      const a = (sy - b * sx) / tau;
      let r = 0;
      for (let i = 0; i < tau; i++) {
        const e = y[s0 + i] - (a + b * i);
        r += e * e;
      }
      res += r / tau;
      blocks++;
    }
    F.push(Math.sqrt(res / Math.max(1, blocks)));
  }
  let alphaSum = 0;
  let alphas = 0;
  for (let i = 0; i + 1 < F.length; i++) {
    if (F[i] <= 0 || F[i + 1] <= 0) continue;
    alphaSum += Math.log10(F[i + 1] / F[i]) / Math.log10((taus[i + 1] + 3) / (taus[i] + 3));
    alphas++;
  }
  const alpha = alphas ? alphaSum / alphas : 1;
  const dance = clamp(alpha > 0 ? 1 / alpha : 3, 0, 3);
  // the swing of the loudness: its modulation spectrum, weighted by fluctuation strength
  const N = 1024;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  let lm = 0;
  const sone = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    sone[i] = Math.pow(2, (Math.max(-90, db[i]) + 60) / 10);
    lm += sone[i];
  }
  lm /= n;
  for (let i = 0; i < n && i < N; i++) re[i] = (sone[i] - lm) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  dft(re, im);
  const edges = [0.5, 0.82, 1.35, 2.2, 3.6, 6, 10];
  const swing = new Array(6).fill(0);
  for (let k = 1; k < N / 2; k++) {
    const f = (k * 100) / N;
    if (f < edges[0] || f >= edges[6]) continue;
    const w = 1 / (f / 4 + 4 / f);
    let b = 0;
    while (b < 5 && f >= edges[b + 1]) b++;
    swing[b] += Math.hypot(re[k], im[k]) * w;
  }
  const ss = swing.reduce((a, b) => a + b, 0);
  return { tempo, pulse: clamp(best), dance, swing: ss > 0 ? swing.map((v) => v / ss) : new Array(6).fill(1 / 6) };
}

/** An in-place Fourier transform (radix 2). */
function dft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = (-2 * Math.PI) / size;
    for (let i = 0; i < n; i += size)
      for (let k = 0; k < size / 2; k++) {
        const c = Math.cos(ang * k);
        const s = Math.sin(ang * k);
        const a = i + k;
        const b = a + size / 2;
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
  }
}

/**
 * Reference figures for each measure: its mean and spread over a reference set of pieces, fixed
 * here once. Measured with `measureVibe` over the reference set in `pieces.ts` (thirty
 * pieces of different make-up: sparse and dense, held and clipped, tonal and noisy, slow and
 * fast), and rounded.
 */
// prettier-ignore
export const REF_MEAN = Float32Array.from([86.5, -15.4, 6.38, -6.37, 0.301, 0.948, -0.0472, -2.25, -0.264, -0.0274, -0.332, -1.17, 7.05, 6.42, 5.54, 5.18, 4.97, 4.66, 4.61, 4.54, 4.09, 4.06, 4.28, 4.5, 1.83, 1.57, 2.27, 3.66, 4.35, 3.31, 0.267, 0.07, 0.132, 0.365, -1.14, 0.848, 0.0804, 0.851, 0.0279, 0.506, 0.0249, 0.24, 0.0633, 0.334, 0.256, 0.0374, 0.424, 0.0445, 0.329, 0.0641, 0.227, 0.0721, 5.49, 0.599, 1.39, 0.0348, 0.0708, 0.131, 0.213, 0.305, 0.245, 5.03, 1.19, 3.1, 0.376, 2.13, 0.938, 2.74, 0.154, 0.197, 0.32, 0.259, 0.0696, 0.15]);
// prettier-ignore
export const REF_SD = Float32Array.from([62.7, 26.4, 20.2, 15.2, 9.74, 7.91, 5.37, 5.72, 6.32, 4.69, 4.75, 2.81, 1.12, 0.915, 0.923, 0.947, 0.913, 0.84, 1.02, 0.863, 0.702, 0.739, 1.03, 1.08, 0.923, 0.684, 0.798, 0.848, 1.37, 2.31, 0.191, 0.105, 0.13, 0.191, 0.865, 0.0757, 0.0991, 0.287, 0.0138, 0.113, 0.0527, 0.0903, 0.154, 0.152, 0.0998, 0.0366, 0.126, 0.0981, 0.148, 0.11, 0.146, 0.268, 2.54, 0.171, 0.412, 0.0108, 0.0202, 0.0352, 0.0539, 0.0618, 0.0468, 0.809, 1.6, 2.29, 0.193, 0.723, 0.142, 0.873, 0.248, 0.185, 0.165, 0.137, 0.103, 0.073]);

/** The fingerprint read against the reference figures and squashed into −1..1: tanh(z / 2). */
export function normalise(fp: ArrayLike<number>): Float32Array {
  const out = new Float32Array(VIBE_DIMS);
  for (let i = 0; i < VIBE_DIMS; i++) out[i] = Math.tanh((fp[i] - REF_MEAN[i]) / Math.max(1e-6, REF_SD[i]) / 2);
  return out;
}

/** How far apart two normalised fingerprints are: each of the five groups counts the same. */
export function vibeDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0;
  for (const g of GROUPS) {
    let s = 0;
    for (let i = g.from; i < g.to; i++) s += (a[i] - b[i]) ** 2;
    d += s / (g.to - g.from);
  }
  return Math.sqrt(d / GROUPS.length);
}

export interface Axes {
  /** −1..1: calm … energetic */
  energy: number;
  /** −1..1: dark, minor, rough … bright, major, sweet */
  valence: number;
  /** −1..1: free … a steady, clear beat */
  groove: number;
  /** −1..1: sparse … many layers, busy harmony */
  density: number;
}

const avg = (v: ArrayLike<number>, from: number, n: number) => {
  let s = 0;
  for (let i = 0; i < n; i++) s += v[from + i];
  return s / n;
};

/** The four broad axes of a normalised fingerprint (smooth functions of it). */
export function axesOf(v: ArrayLike<number>): Axes {
  const t = (x: number) => Math.tanh(0.9 * x);
  return {
    energy: t(0.35 * v[AT.onsets] + 0.25 * avg(v, AT.flat, FLAT_BANDS) + 0.2 * v[AT.centroid] - 0.25 * v[AT.tone] - 0.15 * v[AT.range] + 0.2 * v[AT.layers] + 0.15 * v[AT.short] + 0.15 * v[AT.roles] + 0.2 * v[AT.noise]),
    valence: t(0.5 * v[AT.major] + 0.2 * v[AT.clarity] + 0.25 * v[AT.centroid] - 0.3 * v[AT.rough]),
    groove: t(0.3 * v[AT.dance] + 0.35 * v[AT.pulse] + 0.15 * (v[AT.swing + 2] + v[AT.swing + 3]) + 0.3 * v[AT.roles] + 0.15 * v[AT.onsets]),
    density: t(0.45 * v[AT.layers] - 0.2 * avg(v, AT.contrast, CONTRAST_BANDS) + 0.25 * v[AT.change] + 0.2 * v[AT.onsets] + 0.15 * v[AT.legato]),
  };
}

/**
 * Smoothly blended random numbers pinned to a coarse grid over a few axes: the same point gives
 * the same number, nearby points nearly the same, distant points unrelated. `channel` picks an
 * independent set of numbers; `cell` is the grid's spacing.
 */
export function valueNoise(p: number[], channel: number, cell = 0.5): number {
  const d = p.length;
  const base = p.map((x) => Math.floor(x / cell));
  const frac = p.map((x, i) => {
    const f = x / cell - base[i];
    return f * f * (3 - 2 * f);
  });
  let out = 0;
  for (let corner = 0; corner < 1 << d; corner++) {
    let w = 1;
    let key = channel * 7919 + 17;
    for (let i = 0; i < d; i++) {
      const bit = (corner >> i) & 1;
      w *= bit ? frac[i] : 1 - frac[i];
      key = Math.imul(key ^ (base[i] + bit + 1000), 0x45d9f3b) + i * 131;
    }
    out += w * hash(key);
  }
  return out;
}

/** How the painting looks, from the vibe. */
export interface Look {
  axes: Axes;
  /** 0 = thick, dry paint … 1 = thin and wet */
  wet: number;
  /** how unsteady the hand is, 0..1 */
  loose: number;
  /** how fast wet paint and the currents move, 0..1 */
  motion: number;
  /** how many marks a sound leaves (1 = as usual) */
  density: number;
  /** how far a stroke goes on one load of paint (1 = as usual) */
  stroke: number;
  /** how far drops are thrown (1 = as usual) */
  spread: number;
  /** how far round the palette the parts are cast (a whole number when used) */
  turn: number;
  /** −1..1: every colour a little darker … lighter */
  light: number;
  /** where currents and anchors fall */
  seed: number;
  /** how well each layout suits the music */
  layouts: Record<LayoutId, number>;
}

export function lookOf(v: ArrayLike<number>): Look {
  const a = axesOf(v);
  const z = (x: number) => (x + 1) / 2;
  const e = z(a.energy);
  const g = z(a.groove);
  const d = z(a.density);
  const leg = z(v[AT.legato]);
  const noisy = z(v[AT.noise]);
  const at = [a.energy, a.valence, a.groove];
  const pick = (ch: number) => 0.05 * valueNoise(at, ch);
  const busy = z(v[AT.onsets]);
  const lay = z(v[AT.layers]);
  const val = z(a.valence);
  return {
    axes: a,
    wet: clamp(0.22 + 0.42 * (1 - e) + 0.28 * leg - 0.1 * g),
    loose: clamp(0.18 + 0.62 * e),
    motion: clamp(0.15 + 0.6 * e + 0.15 * (1 - g) + 0.1 * noisy),
    density: 0.7 + 0.6 * d,
    stroke: 0.7 + 0.7 * leg,
    spread: 0.7 + 0.7 * e,
    // which way round the palette the parts are cast: a choice with no reason behind it, so pinned to a coarse grid over
    // energy and groove (two cells to an axis): music of one kind falls in one cell and is cast alike
    turn: 3 * valueNoise([a.energy, a.groove], 1, 1),
    light: 0.8 * a.valence,
    seed: 1000 * valueNoise(at, 2),
    // how well each layout suits the music (after the research's suggestions): a steady groove flows (river) or comes
    // round (rings, more so the clearer the beat); calm, held music opens in blooms; energetic, textured music with few
    // parts is carried by the field; a dense arrangement of many parts is laid out in lanes
    layouts: {
      river: 0.3 + 0.35 * g + 0.2 * leg - 0.15 * d + pick(11),
      rings: 0.1 + 0.8 * g - 0.15 * e + 0.1 * val + pick(12),
      bloom: 0.3 + 0.45 * (1 - e) + 0.25 * leg + 0.15 * (1 - busy) - 0.35 * g + pick(13),
      field: 0.18 + 0.55 * e + 0.1 * noisy + 0.1 * (1 - leg) - 0.15 * g - 0.2 * lay + pick(14),
      lanes: 0.12 + 0.45 * d + 0.4 * lay - 0.3 * g + pick(15),
      sweep: -0.5,
    },
  };
}

/** How different two looks are (each part on its own scale; the layout scores together count as one part). */
export function lookDistance(a: Look, b: Look): number {
  const parts = [
    a.axes.energy - b.axes.energy,
    a.axes.valence - b.axes.valence,
    a.axes.groove - b.axes.groove,
    a.axes.density - b.axes.density,
    (a.wet - b.wet) * 2,
    (a.loose - b.loose) * 2,
    (a.motion - b.motion) * 2,
    (a.density - b.density) / 0.3,
    (a.stroke - b.stroke) / 0.35,
    (a.spread - b.spread) / 0.35,
    a.light - b.light,
  ];
  let lay = 0;
  for (const k of Object.keys(a.layouts) as LayoutId[]) lay += (a.layouts[k] - b.layouts[k]) ** 2;
  return Math.sqrt((parts.reduce((s, x) => s + x * x, 0) + lay * 2) / (parts.length + 1));
}

/** The layout that suits the music best, changed only with patience: another must lead clearly, for at least a bar, before the music has settled. */
export class LayoutChooser {
  current: LayoutId | null = null;
  private lead: LayoutId | null = null;
  private since = 0;
  /** once the vibe has settled (half a minute live; at once for a file), the choice is kept */
  settled = false;
  pick(scores: Record<LayoutId, number>, t: number, bar: number, settle = false): LayoutId {
    let best: LayoutId = "river";
    for (const k of Object.keys(scores) as LayoutId[]) if (scores[k] > scores[best]) best = k;
    if (!this.current) {
      this.current = best;
      this.settled = settle;
      return best;
    }
    if (this.settled) return this.current;
    if (best !== this.current && scores[best] > scores[this.current] + 0.1) {
      if (this.lead !== best) {
        this.lead = best;
        this.since = t;
      } else if (t - this.since >= bar) {
        this.current = best;
        this.lead = null;
      }
    } else this.lead = null;
    if (settle) this.settled = true;
    return this.current;
  }
  reset() {
    this.current = null;
    this.lead = null;
    this.settled = false;
  }
}
