/**
 * Splitting a recording into layers, on this machine, with no trained model.
 *
 * A song from a file comes as one mix. To paint its drums, its bass, its voice and the rest each
 * in their own way, it is split into four "stems" (the four a separation model gives:
 * drums, bass, vocals, other) by plain signal processing, the way the research for this canvas
 * proposes (`research_notes/Synths harmony stems and vibe painting/stems.md`, section 4):
 *
 * - **drums** are what is sudden: the sound is looked at in short overlapping slices (an STFT),
 *   and at every frequency and moment the median of its neighbours along time (what is steady)
 *   is set against the median of its neighbours along frequency (what is a click or a crash).
 *   This is harmonic/percussive separation by median filtering (Fitzgerald, DAFx 2010, with the
 *   margins of Driedger, Müller and Disch, ISMIR 2014, as librosa implements it); the medians
 *   are taken over a sliding window, so the same code can run on live sound (the real-time
 *   variant of sevagh's Real-Time-HPSS) or, for a file, centred on each moment;
 * - **bass** is what is steady and low (below about 200 Hz, a cut-off rather than a separation:
 *   the kick's thump goes to the drums because it is sudden);
 * - **vocals** are what is steady, in the voice's range, in the middle of the stereo picture
 *   and does not repeat: a song's accompaniment repeats (the same bar, the same chorus) and a
 *   voice mostly does not, so every moment is compared with the moments most like it elsewhere
 *   in the song, and what stands above their median is taken as the voice (REPET-SIM, Rafii
 *   and Pardo 2012, as in librosa's vocal-separation example and nussl);
 * - **other** is everything left: chords, pads, guitars, keys, leads.
 *
 * None of this comes near a trained model, and a held synth or a sustained guitar line can pass
 * for a voice; but it is instant, and good enough to give each layer its own paint. A model's
 * stems (from the desktop app's engine, later) can take its place through `StemSource` with no
 * other change.
 *
 * Every stem is a plain mono recording at the song's own rate (the mid channel, masked), so the
 * same ear that hears the whole mix can hear each layer.
 */
import { ComplexFFT } from "./fft";

export type StemId = "drums" | "bass" | "vocals" | "other";
export const STEM_IDS: StemId[] = ["drums", "bass", "vocals", "other"];
/** The stems any source may give: the split's four, and the two more of a six-stem model. */
export type StemName = StemId | "guitar" | "piano";
export const STEM_NAMES: StemName[] = ["drums", "bass", "vocals", "other", "guitar", "piano"];
export const isStemName = (x: unknown): x is StemName => typeof x === "string" && (STEM_NAMES as string[]).includes(x);

/** The slices the sound is looked at in (samples), and how far apart they start. */
export const N = 2048;
export const HOP = 512;

/** A recording in two channels (the same twice for a mono one). */
export interface Stereo {
  sr: number;
  left: Float32Array;
  right: Float32Array;
}

/** Stretches of stems on their way out. */
interface Pieces {
  from: number;
  length: number;
  parts: Record<StemId, Float32Array[]>;
}

/**
 * A stretch of stems: each a mono recording at the song's own rate, starting at sample `from` of
 * the song, `length` samples long. A source gives the stems it has (see `StemSource.stems`).
 */
export interface StemChunk {
  from: number;
  length: number;
  stems: Partial<Record<StemName, Float32Array>>;
}
/** A stretch of the split's own four stems. */
export interface SplitChunk extends StemChunk {
  stems: Record<StemId, Float32Array>;
}

/**
 * Where a song's stems come from. The signal-processing split below is one; a trained model's
 * (vocals, drums, bass, other, and with six stems guitar and piano, from the desktop app's
 * engine: `pushed.ts` takes them as they are made) can be another: whatever paints the layers
 * asks only for this.
 */
export interface StemSource {
  readonly id: string;
  /** true for a split by signal processing (a rough guess), false for a trained model */
  readonly approx: boolean;
  /** the stems it gives (the split's four when not said) */
  readonly stems?: readonly StemName[];
  /** Get ready for a song: whatever has to look at the whole of it first. `progress` 0..1. */
  prepare(song: Stereo, progress?: (f: number) => void): Promise<void>;
  /** Give stems from sample `from` of the song on. */
  seek(from: number): void;
  /**
   * The next stretch of stems, of at most about `max` samples (null: the song is over). A source
   * still making its stems answers once it has the next stretch (it may give less than `max`).
   */
  next(max: number): Promise<StemChunk | null>;
  /** How far from the start of the song (seconds) it can give stems without waiting (Infinity: all of it). */
  ready?(): number;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const odd = (x: number) => Math.max(1, Math.round(x) | 1);

/** The median of the first `n` values of `a` (which it reorders). */
export function median(a: Float32Array, n: number): number {
  if (n <= 0) return 0;
  const k = n >> 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}

/** The Hann window, and how much its overlapping squares add up to at a hop of a quarter of its length. */
function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
const OLA = 1.5;

/** A soft mask (librosa's `softmask`, power 2): how much of a point belongs to `x` rather than `ref`. */
const soft = (x: number, ref: number) => {
  const a = x * x;
  const b = ref * ref;
  return a + b > 1e-20 ? a / (a + b) : 0;
};

/**
 * Harmonic/percussive separation by median filtering, a slice at a time.
 *
 * For each slice it is given the magnitudes; it answers, for each frequency, how much is steady
 * (harmonic) and how much is sudden (percussive). The median along time is taken over about a
 * fifth of a second, the median along frequency over about 500 Hz (the kernel sizes of
 * Real-Time-HPSS). `centred`: each slice is judged with as much after it as before (for a file,
 * read ahead), so its answer comes `delay` slices later; otherwise only what came before counts,
 * and the answer is at once (for live sound).
 */
export class Hpss {
  readonly bins: number;
  readonly kh: number;
  readonly kp: number;
  readonly delay: number;
  /** a percussive part must be this many times the harmonic to count fully (a cleaner drum layer) */
  marginP = 2;
  marginH = 1;
  private readonly hist: Float32Array[];
  private count = 0;
  private readonly scratch: Float32Array;

  constructor(bins: number, sr: number, hop = HOP, n = N, centred = true) {
    this.bins = bins;
    this.kh = odd(0.2 / (hop / sr));
    this.kp = odd(500 / (sr / n));
    this.delay = centred ? (this.kh - 1) >> 1 : 0;
    this.hist = Array.from({ length: this.kh }, () => new Float32Array(bins));
    this.scratch = new Float32Array(Math.max(this.kh, this.kp));
  }

  /** The magnitudes of the next slice. The masks of the slice `delay` back come out, with its number (null until there is one). */
  push(mag: Float32Array): Masks | null {
    this.hist[this.count % this.kh].set(mag.subarray(0, this.bins));
    this.count++;
    const f = this.count - 1 - this.delay;
    if (f < 0) return null;
    return this.masks(f, this.count - 1);
  }

  /** The masks of the slices still waiting, judged on what there is (the song ended). */
  flush(): Masks[] {
    const out = [];
    for (let f = Math.max(0, this.count - this.delay); f < this.count; f++) out.push(this.masks(f, this.count - 1));
    return out;
  }

  private masks(f: number, last: number): Masks {
    const { bins, kh, kp, scratch } = this;
    // centred: as far after as before; otherwise the slices before it
    const from = Math.max(0, last - kh + 1, f - (this.delay || kh - 1));
    const to = Math.min(last, f + this.delay);
    const cur = this.hist[f % kh];
    const h = new Float32Array(bins);
    const p = new Float32Array(bins);
    const half = kp >> 1;
    for (let k = 0; k < bins; k++) {
      // steady: the median along time
      let n = 0;
      for (let g = from; g <= to; g++) scratch[n++] = this.hist[g % kh][k];
      const H = median(scratch, n);
      // sudden: the median along frequency
      n = 0;
      for (let j = Math.max(0, k - half); j <= Math.min(bins - 1, k + half); j++) scratch[n++] = cur[j];
      const P = median(scratch, n);
      h[k] = soft(H, P * this.marginH);
      p[k] = soft(P, H * this.marginP);
    }
    return { f, h, p };
  }
}

/** How much of each frequency of one slice is steady (`h`) and how much sudden (`p`). */
export interface Masks {
  f: number;
  h: Float32Array;
  p: Float32Array;
}

/** What repeats in a song, moment by moment: for each slice (a quarter as often as the split's), the median of the slices most like it. */
export interface Background {
  /** samples between slices, and how many slices there are */
  hop: number;
  frames: number;
  /** frequencies kept (from 0 Hz), and for each slice that many magnitudes */
  bins: number;
  mag: Float32Array;
}

/**
 * REPET-SIM: for every moment of a song, the median of the moments most like it (at least a
 * second away, so a held note does not find itself), frequency by frequency. What repeats (the
 * accompaniment) is in it; what does not (mostly the voice) is not. Moments are compared by the
 * shape of their spectrum in 40 bands (cosine similarity); the median is of their magnitudes
 * up to 10 kHz. Taken from the mid channel (left and right as one), where a lead voice sits.
 */
export function background(mid: Float32Array, sr: number, opts: { neighbours?: number; gap?: number; progress?: (f: number) => void } = {}): Background {
  const hop = HOP * 4;
  const frames = Math.max(1, Math.ceil(mid.length / hop));
  const bins = Math.min(N / 2, Math.round(10000 / (sr / N)) + 1);
  const mag = new Float32Array(frames * bins);
  const fft = new ComplexFFT(N);
  const w = hann(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const BANDS = 40;
  const edges = Array.from({ length: BANDS + 1 }, (_, i) => Math.max(1, Math.round((80 * Math.pow(8000 / 80, i / BANDS)) / (sr / N))));
  const feat = new Float32Array(frames * BANDS);
  for (let g = 0; g < frames; g++) {
    const c = g * hop;
    for (let i = 0; i < N; i++) {
      const s = c - N / 2 + i;
      re[i] = s >= 0 && s < mid.length ? mid[s] * w[i] : 0;
      im[i] = 0;
    }
    fft.transform(re, im);
    const row = g * bins;
    for (let k = 0; k < bins; k++) mag[row + k] = Math.hypot(re[k], im[k]);
    let norm = 0;
    for (let b = 0; b < BANDS; b++) {
      let e = 0;
      for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]) && k < bins; k++) e += mag[row + k] * mag[row + k];
      const v = Math.sqrt(e);
      feat[g * BANDS + b] = v;
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    if (norm > 1e-9) for (let b = 0; b < BANDS; b++) feat[g * BANDS + b] /= norm;
    if (opts.progress && g % 256 === 0) opts.progress(0.3 * (g / frames));
  }
  // the moments most like each moment
  const K = Math.max(1, Math.min(opts.neighbours ?? 10, frames));
  const gap = Math.max(1, Math.round((opts.gap ?? 1) * (sr / hop)));
  const reach = 6000;
  const bestSim = new Float32Array(frames * K).fill(-1);
  const bestAt = new Int32Array(frames * K).fill(-1);
  const offer = (g: number, h: number, s: number) => {
    const o = g * K;
    // the weakest of the best so far is replaced
    let lo = 0;
    for (let i = 1; i < K; i++) if (bestSim[o + i] < bestSim[o + lo]) lo = i;
    if (s > bestSim[o + lo]) {
      bestSim[o + lo] = s;
      bestAt[o + lo] = h;
    }
  };
  for (let g = 0; g < frames; g++) {
    const a = g * BANDS;
    for (let h = g + gap; h < Math.min(frames, g + reach); h++) {
      const b = h * BANDS;
      let s = 0;
      for (let i = 0; i < BANDS; i++) s += feat[a + i] * feat[b + i];
      if (s <= 0) continue;
      offer(g, h, s);
      offer(h, g, s);
    }
    if (opts.progress && g % 256 === 0) opts.progress(0.3 + 0.6 * (g / frames));
  }
  // their median, frequency by frequency
  const out = new Float32Array(frames * bins);
  const vals = new Float32Array(K);
  for (let g = 0; g < frames; g++) {
    const near: number[] = [];
    for (let i = 0; i < K; i++) if (bestAt[g * K + i] >= 0) near.push(bestAt[g * K + i]);
    const row = g * bins;
    if (near.length < 2) {
      // nothing to compare it with: taken as repeating, so it is not mistaken for a voice
      out.set(mag.subarray(row, row + bins), row);
      continue;
    }
    for (let k = 0; k < bins; k++) {
      for (let i = 0; i < near.length; i++) vals[i] = mag[near[i] * bins + k];
      out[row + k] = median(vals, near.length);
    }
  }
  opts.progress?.(1);
  return { hop, frames, bins, mag: out };
}

/**
 * The split itself, a slice at a time: stereo in, four mono stems out, each sample of each stem
 * coming out as soon as it is final (a little later than it went in, more when `centred`).
 */
export class Splitter {
  readonly sr: number;
  /** where in the song the split began (samples) */
  readonly start: number;
  private readonly fft = new ComplexFFT(N);
  private readonly w = hann(N);
  private readonly hpss: Hpss;
  private readonly bg: Background | null;
  /** how far a voice must stand above what repeats (librosa's example uses 10, for a clean voice; a painting would rather keep too much voice than too little) */
  marginV = 1;
  private readonly bins = N / 2 + 1;
  private readonly inL = new Float32Array(N);
  private readonly inR = new Float32Array(N);
  /** samples taken in, counting N − HOP of silence before the start */
  private v = N - HOP;
  private frame = 0;
  private readonly re = new Float64Array(N);
  private readonly im = new Float64Array(N);
  /** for the slices waiting for their masks: the mid channel's spectrum, and how much is in the middle */
  private readonly waitRe: Float32Array[];
  private readonly waitIm: Float32Array[];
  private readonly waitCentre: Float32Array[];
  private readonly mag: Float32Array;
  /** where each stem's slices are added up, and the sample of the song its first point is */
  private readonly acc: Record<StemId, Float32Array>;
  private accBase: number;
  private emitted: number;
  private readonly bassW: Float32Array;
  private readonly bandW: Float32Array;
  private ended = false;

  constructor(sr: number, opts: { from?: number; centred?: boolean; background?: Background | null } = {}) {
    this.sr = sr;
    this.start = Math.max(0, Math.round(opts.from ?? 0));
    this.hpss = new Hpss(this.bins, sr, HOP, N, opts.centred !== false);
    this.bg = opts.background ?? null;
    const d = this.hpss.delay + 1;
    this.waitRe = Array.from({ length: d }, () => new Float32Array(this.bins));
    this.waitIm = Array.from({ length: d }, () => new Float32Array(this.bins));
    this.waitCentre = Array.from({ length: d }, () => new Float32Array(this.bins));
    this.mag = new Float32Array(this.bins);
    this.acc = { drums: new Float32Array(N * 2), bass: new Float32Array(N * 2), vocals: new Float32Array(N * 2), other: new Float32Array(N * 2) };
    this.accBase = -(N - HOP);
    this.emitted = 0;
    const hz = (k: number) => (k * sr) / N;
    this.bassW = new Float32Array(this.bins);
    this.bandW = new Float32Array(this.bins);
    for (let k = 0; k < this.bins; k++) {
      const f = hz(k);
      this.bassW[k] = f <= 150 ? 1 : f >= 260 ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (f - 150)) / 110);
      this.bandW[k] = smooth(120, 220, f) * (1 - smooth(6000, 10000, f));
    }
  }

  /** Take in more of the song (left and right, the same length). The stems for every sample now final come out. */
  push(left: Float32Array, right: Float32Array): SplitChunk | null {
    if (this.ended) return null;
    const out = this.empty();
    this.take(left, right, out);
    return this.done(out);
  }

  /** The song is over: everything still waiting comes out. */
  flush(): SplitChunk | null {
    if (this.ended) return null;
    const total = this.v - (N - HOP);
    const out = this.empty();
    // the last slices are completed with silence
    const z = new Float32Array(N);
    this.take(z, z, out);
    for (const m of this.hpss.flush()) this.synth(m, out);
    this.ended = true;
    // (the silence added is not part of the song)
    const keep = Math.max(0, total - (this.emitted - out.length));
    const chunk = this.done(out);
    if (chunk && chunk.length > keep) {
      for (const s of STEM_IDS) chunk.stems[s] = chunk.stems[s].subarray(0, keep);
      chunk.length = keep;
    }
    return chunk && chunk.length ? chunk : null;
  }

  private take(left: Float32Array, right: Float32Array, out: Pieces) {
    for (let i = 0; i < left.length; i++) {
      const p = this.v % N;
      this.inL[p] = left[i];
      this.inR[p] = right[i];
      this.v++;
      if (this.v >= N && (this.v - N) % HOP === 0) this.analyse(out);
    }
  }

  private empty(): Pieces {
    return { from: this.start + this.emitted, length: 0, parts: { drums: [], bass: [], vocals: [], other: [] } };
  }
  /** The pieces handed out, as one stretch. */
  private done(out: Pieces): SplitChunk | null {
    if (!out.length) return null;
    const stems = {} as Record<StemId, Float32Array>;
    for (const s of STEM_IDS) {
      const all = new Float32Array(out.length);
      let at = 0;
      for (const part of out.parts[s]) {
        all.set(part, at);
        at += part.length;
      }
      stems[s] = all;
    }
    return { from: out.from, length: out.length, stems };
  }

  /** A slice has been taken in: look at it, and finish the slice whose masks are now known. */
  private analyse(out: Pieces) {
    const { re, im, w } = this;
    const f = this.frame++;
    const base = this.v - N;
    for (let i = 0; i < N; i++) {
      const p = (base + i) % N;
      const l = this.inL[p];
      const r = this.inR[p];
      // mid in the real part, side in the imaginary: one transform gives both
      re[i] = 0.5 * (l + r) * w[i];
      im[i] = 0.5 * (l - r) * w[i];
    }
    this.fft.transform(re, im);
    const slot = f % this.waitRe.length;
    const mr = this.waitRe[slot];
    const mi = this.waitIm[slot];
    const centre = this.waitCentre[slot];
    for (let k = 0; k < this.bins; k++) {
      const j = (N - k) % N;
      // the mid channel's spectrum and the side's, taken apart again
      const Mr = 0.5 * (re[k] + re[j]);
      const Mi = 0.5 * (im[k] - im[j]);
      const Sr = 0.5 * (im[k] + im[j]);
      const Si = -0.5 * (re[k] - re[j]);
      mr[k] = Mr;
      mi[k] = Mi;
      const m2 = Mr * Mr + Mi * Mi;
      const s2 = Sr * Sr + Si * Si;
      centre[k] = m2 + s2 > 1e-20 ? m2 / (m2 + s2) : 1;
      this.mag[k] = Math.sqrt(m2 + s2);
    }
    const m = this.hpss.push(this.mag);
    if (m) this.synth(m, out);
  }

  /** The masks of a slice are known: its four stems are made and added in. */
  private synth(m: Masks, out: Pieces) {
    const f = m.f;
    const slot = f % this.waitRe.length;
    const mr = this.waitRe[slot];
    const mi = this.waitIm[slot];
    const centre = this.waitCentre[slot];
    const { re, im, bins } = this;
    // where this slice sits among the background's (its middle, in samples of the song)
    const mid = this.start + f * HOP - (N - HOP) + N / 2;
    const bg = this.bg;
    let g0 = 0;
    let g1 = 0;
    let gf = 0;
    if (bg) {
      const g = Math.max(0, Math.min(bg.frames - 1, mid / bg.hop));
      g0 = Math.floor(g);
      g1 = Math.min(bg.frames - 1, g0 + 1);
      gf = g - g0;
    }
    const share = { drums: new Float32Array(bins), bass: new Float32Array(bins), vocals: new Float32Array(bins), other: new Float32Array(bins) };
    for (let k = 0; k < bins; k++) {
      const h = m.h[k];
      const drums = m.p[k];
      const bass = h * this.bassW[k];
      let vocals = 0;
      if (this.bandW[k] > 0 && bg && k < bg.bins) {
        const b = bg.mag[g0 * bg.bins + k] * (1 - gf) + bg.mag[g1 * bg.bins + k] * gf;
        const M = Math.hypot(mr[k], mi[k]);
        const below = Math.min(M, b);
        const fg = soft(M - below, this.marginV * below);
        vocals = h * (1 - this.bassW[k]) * this.bandW[k] * smooth(0.5, 0.85, centre[k]) * fg;
      }
      share.drums[k] = drums;
      share.bass[k] = bass;
      share.vocals[k] = vocals;
      share.other[k] = Math.max(0, 1 - drums - bass - vocals);
    }
    // two stems to a transform: one in the real part, one in the imaginary
    for (const [a, b] of [["drums", "bass"], ["vocals", "other"]] as [StemId, StemId][]) {
      const sa = share[a];
      const sb = share[b];
      for (let k = 0; k < bins; k++) {
        // a = sa·M, b = sb·M, as one signal a + i·b
        re[k] = sa[k] * mr[k] - sb[k] * mi[k];
        im[k] = sa[k] * mi[k] + sb[k] * mr[k];
      }
      for (let k = 1; k < N / 2; k++) {
        // the negative frequencies: conj(a) + i·conj(b)
        re[N - k] = sa[k] * mr[k] + sb[k] * mi[k];
        im[N - k] = -sa[k] * mi[k] + sb[k] * mr[k];
      }
      this.fft.transform(re, im, true);
      const A = this.acc[a];
      const B = this.acc[b];
      const at = f * HOP - (N - HOP) - this.accBase;
      for (let i = 0; i < N; i++) {
        A[at + i] += (re[i] * this.w[i]) / OLA;
        B[at + i] += (im[i] * this.w[i]) / OLA;
      }
    }
    // every sample before the next slice's start is now final
    const final = (f + 1) * HOP - (N - HOP);
    if (final > this.emitted) this.emit(out, final - this.emitted);
  }

  /** Hand out the next `n` final samples of each stem. */
  private emit(out: Pieces, n: number) {
    if (n <= 0) return;
    const from = this.emitted - this.accBase;
    for (const s of STEM_IDS) out.parts[s].push(this.acc[s].slice(from, from + n));
    out.length += n;
    this.emitted += n;
    // what has gone out is dropped from the front
    const drop = this.emitted - this.accBase;
    if (drop >= N) {
      for (const s of STEM_IDS) {
        const A = this.acc[s];
        A.copyWithin(0, drop);
        A.fill(0, A.length - drop);
      }
      this.accBase += drop;
    }
  }
}

/**
 * The split above as a source of stems: it first looks once at the whole song for what repeats
 * (a second or so for a song of a few minutes), then splits it a stretch at a time.
 */
export class SignalStems implements StemSource {
  readonly id = "signal";
  readonly approx = true;
  readonly stems = STEM_IDS;
  private song: Stereo | null = null;
  private bg: Background | null = null;
  private splitter: Splitter | null = null;
  private at = 0;

  async prepare(song: Stereo, progress?: (f: number) => void): Promise<void> {
    this.song = song;
    const mid = new Float32Array(song.left.length);
    for (let i = 0; i < mid.length; i++) mid[i] = 0.5 * (song.left[i] + song.right[i]);
    this.bg = background(mid, song.sr, { progress });
    this.seek(0);
  }

  seek(from: number) {
    if (!this.song) return;
    this.at = Math.max(0, Math.min(this.song.left.length, Math.round(from)));
    this.splitter = new Splitter(this.song.sr, { from: this.at, background: this.bg });
  }

  ready() {
    return Infinity;
  }

  async next(max: number): Promise<SplitChunk | null> {
    const s = this.song;
    const sp = this.splitter;
    if (!s || !sp) return null;
    if (this.at >= s.left.length) {
      const last = sp.flush();
      this.splitter = null;
      return last;
    }
    const end = Math.min(s.left.length, this.at + Math.max(HOP, Math.round(max)));
    const out = sp.push(s.left.subarray(this.at, end), s.right.subarray(this.at, end));
    this.at = end;
    return out ?? { from: sp.start, length: 0, stems: { drums: new Float32Array(0), bass: new Float32Array(0), vocals: new Float32Array(0), other: new Float32Array(0) } };
  }
}
