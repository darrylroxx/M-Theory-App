/**
 * Measuring a sound, from the sound itself.
 *
 * Every drum hit and every plucked note in the app is a little recording made by the app's own
 * synthesizers. This looks at such a recording and says what a listener hears in it: which
 * frequencies it is made of, how wide each of those is, whether each is a tone or a noise, how
 * long each goes on ringing, whether its pitch moves, and how hard it starts. The canvas paints
 * from these measurements, so what is painted is what sounds.
 */

/** The frequency range that is measured and shown, in hertz: nine octaves, from below a bass guitar's lowest note to the top of hearing that matters in a mix. */
export const F_LO = 32;
export const F_HI = 16000;
/** Bands to an octave: six, so each band is two semitones wide. */
export const PER_OCTAVE = 6;
export const BANDS = Math.round(Math.log2(F_HI / F_LO) * PER_OCTAVE);
/** The middle of a band, in hertz, and the band a frequency falls in (it can be a fraction). */
export const bandHz = (i: number) => F_LO * Math.pow(2, (i + 0.5) / PER_OCTAVE);
export const bandOf = (hz: number) => Math.log2(Math.max(1e-6, hz) / F_LO) * PER_OCTAVE;

/** One part of a sound: a tone or a band of noise, somewhere in frequency. */
export interface Part {
  /** where it is, in hertz */
  hz: number;
  /** how wide it is, in octaves (a pure tone is next to nothing; a hiss can be several) */
  width: number;
  /** how strong it is next to the sound's strongest part: 1 = the strongest */
  gain: number;
  /** how long it rings, in seconds, until it has died away by 30 dB */
  ring: number;
  /** 0 = a pure tone … 1 = noise */
  noise: number;
  /** how far its pitch moves in its first tenth of a second, in octaves (negative = it falls, as a kick drum's does) */
  glide: number;
}

export interface Sound {
  /** how long the whole sound rings, in seconds (to 30 dB down) */
  ring: number;
  /** how hard it starts: 0 = it swells in, 1 = a click */
  attack: number;
  /** how loud it is (the level of its first tenth of a second, 0..1) */
  level: number;
  /** where its energy sits on average, in hertz */
  centre: number;
  /** its parts, strongest first */
  parts: Part[];
}

// ── the Fourier transform (radix 2, in place) ──
const tables = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array; hann: Float64Array }>();
function table(n: number) {
  let t = tables.get(n);
  if (t) return t;
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }
  const hann = new Float64Array(n);
  for (let i = 0; i < n; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  t = { cos, sin, rev, hann };
  tables.set(n, t);
  return t;
}

/** The transform itself. `re` and `im` are changed in place; their length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  const { cos, sin, rev } = table(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const a = re[i];
      re[i] = re[j];
      re[j] = a;
      const b = im[i];
      im[i] = im[j];
      im[j] = b;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step];
        const s = -sin[k * step];
        const xr = re[i + k + half] * c - im[i + k + half] * s;
        const xi = re[i + k + half] * s + im[i + k + half] * c;
        re[i + k + half] = re[i + k] - xr;
        im[i + k + half] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
}

/** The power in every frequency bin of a stretch of sound starting at sample `from` (a window of `n` samples, tapered at both ends). */
export function spectrum(data: ArrayLike<number>, from: number, n: number): Float64Array {
  const { hann } = table(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = from + i;
    re[i] = k >= 0 && k < data.length ? data[k] * hann[i] : 0;
  }
  fft(re, im);
  const out = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) out[i] = re[i] * re[i] + im[i] * im[i];
  return out;
}

/** Bin powers gathered into the bands (a band narrower than a bin takes its share of the nearest bins). */
export function toBands(power: ArrayLike<number>, sampleRate: number, out = new Float64Array(BANDS)): Float64Array {
  const n = power.length * 2;
  const hzPerBin = sampleRate / n;
  out.fill(0);
  for (let b = 0; b < BANDS; b++) {
    const lo = (F_LO * Math.pow(2, b / PER_OCTAVE)) / hzPerBin;
    const hi = (F_LO * Math.pow(2, (b + 1) / PER_OCTAVE)) / hzPerBin;
    // each bin stands for the frequencies half a bin either side of it; the band takes the part of each bin that lies inside it
    const first = Math.max(1, Math.floor(lo + 0.5));
    const last = Math.min(power.length - 1, Math.floor(hi + 0.5));
    let sum = 0;
    for (let k = first; k <= last; k++) {
      const overlap = Math.min(hi, k + 0.5) - Math.max(lo, k - 0.5);
      if (overlap > 0) sum += power[k] * overlap;
    }
    out[b] = sum;
  }
  return out;
}

const DB30 = Math.pow(10, -30 / 10);

/**
 * The pitch of a stretch of sound, from how often its wave crosses from below to above (after
 * smoothing away everything above `keepBelow` hertz, so a click on top does not count).
 * 0 when there are too few crossings to tell.
 */
function swings(data: ArrayLike<number>, sr: number, from: number, to: number, keepBelow: number): number {
  const k = 1 - Math.exp((-2 * Math.PI * keepBelow) / sr);
  let y = 0;
  let prev = 0;
  let first = -1;
  let last = -1;
  let count = 0;
  const end = Math.min(data.length, to);
  for (let i = Math.max(0, from); i < end; i++) {
    y += k * (data[i] - y);
    if (prev <= 0 && y > 0 && i > from) {
      // where between the two samples it crossed
      const at = i - y / (y - prev);
      if (first < 0) first = at;
      last = at;
      count++;
    }
    prev = y;
  }
  return count >= 3 ? ((count - 1) * sr) / (last - first) : 0;
}
const cache = new WeakMap<object, Sound>();

/**
 * Measure a sound. `data` is the recording (one channel), `sampleRate` its samples per second.
 * The result for the same recording is remembered.
 */
export function describe(data: Float32Array, sampleRate: number): Sound {
  const known = cache.get(data);
  if (known) return known;
  const sr = sampleRate;
  // ── how loud it is over time: the level in 5 ms steps ──
  const hop = Math.max(1, Math.round(sr * 0.005));
  const steps = Math.max(1, Math.ceil(data.length / hop));
  const env = new Float64Array(steps);
  let peak = 0;
  for (let s = 0; s < steps; s++) {
    let sum = 0;
    const end = Math.min(data.length, (s + 1) * hop);
    for (let i = s * hop; i < end; i++) sum += data[i] * data[i];
    env[s] = sum / Math.max(1, end - s * hop);
    if (env[s] > peak) peak = env[s];
  }
  if (peak <= 1e-12) {
    const none: Sound = { ring: 0, attack: 0, level: 0, centre: 1000, parts: [] };
    cache.set(data, none);
    return none;
  }
  let start = 0;
  while (start < steps - 1 && env[start] < peak * 0.01) start++;
  let top = start;
  while (top < steps - 1 && env[top] < peak * 0.8) top++;
  let last = steps - 1;
  while (last > start && env[last] < peak * DB30) last--;
  const ring = Math.max(0.01, ((last - start + 1) * hop) / sr);
  // from first being heard to nearly full: under 3 ms is a click, 40 ms and more is a swell
  const rise = ((top - start) * hop) / sr;
  const attack = Math.max(0, Math.min(1, 1 - (rise - 0.003) / 0.04));
  let lv = 0;
  const lvEnd = Math.min(steps, start + 20);
  for (let s = start; s < lvEnd; s++) lv += env[s];
  const level = Math.min(1, Math.sqrt(lv / Math.max(1, lvEnd - start)) * 2);

  // ── what it is made of: the spectrum just after it starts, and again later, to hear what lasts ──
  const N = 4096;
  const at0 = start * hop;
  const times = [0.004, 0.1, 0.25, 0.5, 1, 2].filter((t, i) => i === 0 || t < ring + 0.05);
  const frames = times.map((t) => spectrum(data, at0 + Math.round(t * sr), N));
  const bands = frames.map((f) => toBands(f, sr));
  const body = bands[0];
  let total = 0;
  let centreSum = 0;
  for (let b = 0; b < BANDS; b++) {
    total += body[b];
    centreSum += body[b] * (b + 0.5);
  }
  const centre = total > 0 ? F_LO * Math.pow(2, centreSum / total / PER_OCTAVE) : 1000;

  // the parts: each hill in the spectrum, from its top down to a tenth of its height either side
  const hzPerBin = sr / N;
  const smooth = (b: number) => (b <= 0 ? (2 * body[0] + body[1]) / 3 : b >= BANDS - 1 ? (2 * body[BANDS - 1] + body[BANDS - 2]) / 3 : (body[b - 1] + 2 * body[b] + body[b + 1]) / 4);
  const taken = new Uint8Array(BANDS);
  const found: { lo: number; hi: number; power: number }[] = [];
  for (let n = 0; n < 5; n++) {
    let best = -1;
    for (let b = 0; b < BANDS; b++) if (!taken[b] && (best < 0 || smooth(b) > smooth(best))) best = b;
    if (best < 0 || body[best] <= 0) break;
    let lo = best;
    let hi = best;
    const floor = smooth(best) * 0.1;
    while (lo > 0 && !taken[lo - 1] && smooth(lo - 1) > floor && smooth(lo - 1) <= smooth(lo) * 1.15) lo--;
    while (hi < BANDS - 1 && !taken[hi + 1] && smooth(hi + 1) > floor && smooth(hi + 1) <= smooth(hi) * 1.15) hi++;
    let power = 0;
    for (let b = lo; b <= hi; b++) {
      power += body[b];
      taken[b] = 1;
    }
    // (the bands next to a hill are its skirts, not hills of their own)
    if (lo > 0) taken[lo - 1] = 1;
    if (hi < BANDS - 1) taken[hi + 1] = 1;
    found.push({ lo, hi, power });
  }
  const strongest = Math.max(...found.map((f) => f.power), 1e-30);
  const parts: Part[] = [];
  for (const f of found) {
    if (f.power < strongest * 0.004) continue;
    const kLo = Math.max(1, Math.floor((F_LO * Math.pow(2, f.lo / PER_OCTAVE)) / hzPerBin));
    const kHi = Math.min(N / 2 - 1, Math.ceil((F_LO * Math.pow(2, (f.hi + 1) / PER_OCTAVE)) / hzPerBin));
    // where it is: the middle of its power, counted in octaves so a wide noise is placed by ear, not by arithmetic
    const frame = frames[0];
    let sum = 0;
    let logSum = 0;
    let sq = 0;
    let geo = 0;
    let count = 0;
    let maxBin = kLo;
    for (let k = kLo; k <= kHi; k++) {
      const p = frame[k];
      sum += p;
      logSum += p * Math.log2(k * hzPerBin);
      geo += Math.log(p + 1e-30);
      count++;
      if (p > frame[maxBin]) maxBin = k;
    }
    if (sum <= 0) continue;
    const mid = logSum / sum;
    for (let k = kLo; k <= kHi; k++) sq += frame[k] * (Math.log2(k * hzPerBin) - mid) ** 2;
    const spread = Math.sqrt(sq / sum);
    // a tone is one tall bin among low ones; a noise is all bins much alike
    const flat = count >= 6 ? Math.exp(geo / count) / (sum / count) : 0;
    let noise = Math.max(0, Math.min(1, (flat - 0.02) / 0.3));
    // (right at the bottom there are too few bins to tell a thump from a rumble: down there it is taken as a tone)
    const mid0 = Math.pow(2, mid);
    if (mid0 < 300) noise *= Math.max(0, (mid0 - 100) / 200);
    // a tone is placed exactly, by the top of its peak (a parabola through the tallest bin and its neighbours)
    let hz = Math.pow(2, mid);
    if (noise < 0.35 && maxBin > 1 && maxBin < N / 2 - 1) {
      const a = Math.log(frame[maxBin - 1] + 1e-30);
      const b = Math.log(frame[maxBin] + 1e-30);
      const c = Math.log(frame[maxBin + 1] + 1e-30);
      const d = a - 2 * b + c;
      // (only a true peak has a top; the shift is never more than half a bin)
      hz = (maxBin + (d < -1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0)) * hzPerBin;
    }
    // how long it rings: when this part of the spectrum has fallen by 30 dB
    const powerAt = (i: number) => {
      let p = 0;
      for (let b = f.lo; b <= f.hi; b++) p += bands[i][b];
      return p;
    };
    const first = powerAt(0);
    let partRing = ring;
    for (let i = 1; i < bands.length; i++) {
      const p = powerAt(i);
      if (p < first * DB30) {
        // between the last time it was still there and this one, falling steadily (in dB)
        const before = Math.max(powerAt(i - 1), first * DB30 * 1.0001);
        const t0 = times[i - 1];
        const t1 = times[i];
        const need = Math.log(before / (first * DB30));
        const fell = Math.log(before / Math.max(p, 1e-30));
        partRing = Math.min(ring, t0 + (t1 - t0) * Math.min(1, need / Math.max(1e-9, fell)));
        break;
      }
    }
    parts.push({ hz, width: Math.max(0.03, spread * 2), gain: Math.sqrt(f.power / strongest), ring: Math.max(0.01, partRing), noise, glide: 0 });
  }
  parts.sort((a, b) => b.gain - a.gain);
  // A drum's pitch often falls as it sounds. That is looked for in its lowest strong tone only (higher
  // parts of a sound are overtones, and an overtone starting before another is not a pitch that moves):
  // how fast the wave swings back and forth in its first moments, against how fast it swings later.
  const low = parts.filter((p) => p.gain >= 0.4 && p.noise < 0.5 && p.hz < 500).sort((a, b) => a.hz - b.hz)[0];
  if (low) {
    const early = swings(data, sr, at0, at0 + Math.round(sr * 0.03), low.hz * 6);
    const later = swings(data, sr, at0 + Math.round(sr * 0.06), at0 + Math.round(sr * (0.06 + 6 / low.hz)), low.hz * 6);
    if (early > 0 && later > 0 && early > later * 1.3) low.glide = Math.max(-3, Math.log2(later / early));
  }
  const out: Sound = { ring, attack, level, centre, parts };
  cache.set(data, out);
  return out;
}

/** A sound with nothing known about it but its pitch: one clean tone (used when a recording cannot be reached). */
export const plainTone = (hz: number, ring = 1.5): Sound => ({ ring, attack: 0.8, level: 0.5, centre: hz, parts: [{ hz, width: 0.05, gain: 1, ring, noise: 0, glide: 0 }] });
