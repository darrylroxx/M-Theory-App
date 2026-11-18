/**
 * Measuring a rendered sound: its pitch, how much of it is folded-back noise, its loudness, its
 * peaks and its clicks. Plain arithmetic on sample arrays, so the tests (in node) and the browser
 * check (on an offline render made with the real worklet) measure in exactly the same way.
 */

/** In-place radix-2 FFT of `re`/`im` (length a power of two). */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(a * k);
        const wi = Math.sin(a * k);
        const p = i + k;
        const q = p + half;
        const vr = re[q] * wr - im[q] * wi;
        const vi = re[q] * wi + im[q] * wr;
        re[q] = re[p] - vr;
        im[q] = im[p] - vi;
        re[p] += vr;
        im[p] += vi;
      }
    }
  }
}

/** Power spectrum (bins 0..N/2) of N samples from `from`, through a Blackman-Harris window (sidelobes below −92 dB). */
export function powerSpectrum(x: ArrayLike<number>, from: number, N: number): Float64Array {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (2 * Math.PI * i) / N;
    re[i] = (x[from + i] ?? 0) * (0.35875 - 0.48829 * Math.cos(a) + 0.14128 * Math.cos(2 * a) - 0.01168 * Math.cos(3 * a));
  }
  fft(re, im);
  const p = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) p[i] = re[i] * re[i] + im[i] * im[i];
  return p;
}

/**
 * How much of a sound is folded-back noise (aliasing), in dB: energy between 20 Hz and `top` that
 * is not within a few bins of an expected partial, against the energy that is. `partials` are
 * the frequencies the sound should contain (the harmonics of the note, for most).
 */
export function foldDb(x: ArrayLike<number>, sr: number, partials: number[], from: number, N = 65536, top = 15000): number {
  const p = powerSpectrum(x, from, N);
  const hz = sr / N;
  let inside = 0;
  let outside = 0;
  const sorted = [...partials].sort((a, b) => a - b);
  let j = 0;
  for (let b = 1; b < p.length; b++) {
    const f = b * hz;
    if (f < 20 || f > top) continue;
    while (j < sorted.length - 1 && sorted[j + 1] <= f) j++;
    const d = Math.min(Math.abs(f - sorted[j]), j + 1 < sorted.length ? Math.abs(f - sorted[j + 1]) : Infinity);
    if (d < 6 * hz) inside += p[b];
    else outside += p[b];
  }
  return 10 * Math.log10((outside + 1e-30) / (inside + 1e-30));
}

/** The harmonics of `f` below half the sample rate. */
export function harmonics(f: number, sr: number): number[] {
  const out: number[] = [];
  for (let k = 1; k * f < sr / 2; k++) out.push(k * f);
  return out;
}

/** The complex amplitude of frequency `f` over N samples from `from` (Hann window). */
function probe(x: ArrayLike<number>, sr: number, f: number, from: number, N: number): [number, number] {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * f) / sr;
  for (let i = 0; i < N; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    const s = (x[from + i] ?? 0) * h;
    re += s * Math.cos(w * (from + i));
    im -= s * Math.sin(w * (from + i));
  }
  return [re, im];
}

/**
 * The exact frequency of the partial near `guess` Hz: its phase is read in two windows a known
 * time apart, and how far it turned (beyond what `guess` would turn) gives the true frequency.
 * Precise to a small fraction of a cent for a steady tone; `guess` must be within
 * sr / (2·gap) Hz of the truth.
 */
export function partialHz(x: ArrayLike<number>, sr: number, guess: number, from: number, seconds = 0.5): number {
  const N = Math.round(seconds * sr);
  const gap = N;
  const [ar, ai] = probe(x, sr, guess, from, N);
  const [br, bi] = probe(x, sr, guess, from + gap, N);
  // the phase of each window is referenced to absolute time, so a correct guess turns by nothing
  let d = Math.atan2(bi, br) - Math.atan2(ai, ar);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return guess + (d * sr) / (2 * Math.PI * gap);
}

/** Cents from `a` to `b`. */
export const cents = (a: number, b: number) => 1200 * Math.log2(b / a);

/**
 * Loudness after ITU-R BS.1770: K-weighting (a high shelf, then a high-pass), mean square over
 * 400 ms windows every 100 ms. Returns the loudest window (LUFS, "momentary max"), the mean over
 * the windows that are not near silence (LUFS) and the sample peak.
 */
export function loudness(L: ArrayLike<number>, R: ArrayLike<number>, sr: number): { momentaryMax: number; integrated: number; peak: number } {
  const kw = (x: ArrayLike<number>) => {
    const y = new Float64Array(x.length);
    // stage 1: high shelf
    let K = Math.tan((Math.PI * 1681.974450955533) / sr);
    const Q = 0.7071752369554196;
    const Vh = Math.pow(10, 3.999843853973347 / 20);
    const Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const b0 = (Vh + (Vb * K) / Q + K * K) / a0;
    const b1 = (2 * (K * K - Vh)) / a0;
    const b2 = (Vh - (Vb * K) / Q + K * K) / a0;
    let a1 = (2 * (K * K - 1)) / a0;
    let a2 = (1 - K / Q + K * K) / a0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const o = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x[i];
      y2 = y1;
      y1 = o;
      y[i] = o;
    }
    // stage 2: high-pass
    K = Math.tan((Math.PI * 38.13547087602444) / sr);
    const Q2 = 0.5003270373238773;
    a0 = 1 + K / Q2 + K * K;
    a1 = (2 * (K * K - 1)) / a0;
    a2 = (1 - K / Q2 + K * K) / a0;
    x1 = x2 = y1 = y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const xi = y[i];
      const o = (xi - 2 * x1 + x2) / a0 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = o;
      y[i] = o;
    }
    return y;
  };
  const l = kw(L);
  const r = kw(R);
  const win = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  let best = -Infinity;
  const blocks: number[] = [];
  for (let s = 0; s + win <= l.length; s += hop) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += l[i] * l[i] + r[i] * r[i];
    const lufs = -0.691 + 10 * Math.log10(e / win + 1e-20);
    blocks.push(lufs);
    if (lufs > best) best = lufs;
  }
  // gated as in the standard: absolute −70 LUFS, then 10 LU under the ungated mean
  const mean = (xs: number[]) => -0.691 + 10 * Math.log10(xs.reduce((a, b) => a + Math.pow(10, (b + 0.691) / 10), 0) / Math.max(1, xs.length) + 1e-20);
  const abs = blocks.filter((b) => b > -70);
  const rel = mean(abs) - 10;
  const integrated = mean(abs.filter((b) => b > rel));
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  return { momentaryMax: best, integrated, peak };
}

/** The largest sample-to-sample step in [from, to): a click shows up as a step far larger than the waveform's own. */
export function maxStep(x: ArrayLike<number>, from: number, to: number): number {
  let m = 0;
  for (let i = Math.max(1, Math.round(from)); i < Math.min(x.length, Math.round(to)); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
  return m;
}

/** RMS of [from, to). */
export function rms(x: ArrayLike<number>, from: number, to: number): number {
  let e = 0;
  let n = 0;
  for (let i = Math.max(0, Math.round(from)); i < Math.min(x.length, Math.round(to)); i++) {
    e += x[i] * x[i];
    n++;
  }
  return Math.sqrt(e / Math.max(1, n));
}

/** True when every sample is a finite number. */
export function allFinite(x: ArrayLike<number>): boolean {
  for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return false;
  return true;
}
