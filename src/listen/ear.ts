/**
 * The ear: it listens to any audio (the app's own mix, a song from a file) and says, a hundred
 * times a second, what is sounding.
 *
 * - **Voices**: every steady tone in the sound (a note, and each of its overtones) is followed
 *   from the moment it starts to the moment it stops: where it is in frequency (so a bend or a
 *   vibrato is seen), how strong it is now, how long it has lasted, how hard it began. A staccato
 *   note is a voice that is over in a few hundredths of a second; a held note is one that goes on.
 *   Nothing has to be guessed in advance: a voice is simply followed for as long as it sounds.
 * - **Hits**: every sudden start (a drum, a pluck, a consonant), with how hard it was and which
 *   stretch of the frequency scale it filled.
 * - **Noise**: what is left when the tones are taken away (a cymbal's wash, breath, a snare's
 *   rattle), band by band.
 * - how loud it is, how bright, how noisy, and which notes of the twelve are sounding.
 *
 * Three looks at the sound are taken at once: a long one (4096 samples) for the low notes, where
 * tones lie close together in hertz; a middle one; and a short one (1024) for the top and for
 * the timing of hits. This is the usual way round the rule that a look cannot be both sharp in
 * time and sharp in frequency.
 *
 * Levels are read against the loudest thing heard lately, so a quiet recording paints as fully as
 * a loud one, and tilted by 4.5 dB an octave, as analysers are, because music has that much less
 * in it the higher it goes. Several ears listening to the parts of one mix can share that
 * reference (`hold`), so a quiet part of a loud mix is heard as quiet.
 *
 * Each frame also carries the shape of its spectrum in a few numbers (`shape`): the levels of 24
 * bands spaced as the ear spaces pitch (the mel scale), how far each of six octave bands' peaks
 * stand above their valleys (spectral contrast), and how noise-like four broad bands are. These
 * are what the vibe of a song is measured from (`canvas/vibe.ts`).
 *
 * Many ears can run side by side on the audio thread (one for each layer of a song). Each does
 * its work once every hundredth of a second, all in one go; ears made together would all do it
 * in the same few milliseconds and could hold up the sound. `phase` staggers them, and `light`
 * leaves out the following of tones, for a layer whose notes the app already knows exactly.
 */
import { FFT } from "./fft";

/** The range that is listened to: nine octaves. */
export const EAR_LO = 32;
export const EAR_HI = 16000;
/** Bands for hits: four to the octave. Bands for noise: three to the octave. */
export const HIT_BANDS = 36;
export const NOISE_BANDS = 27;
/** How far below the loudest thing a sound can be and still be shown (dB). */
export const RANGE_DB = 42;
/** The shape of a spectrum: 24 mel band levels (dB), 6 octave bands' contrast, 4 broad bands' flatness. */
export const MEL_BANDS = 24;
export const CONTRAST_BANDS = 6;
export const FLAT_BANDS = 4;
export const SHAPE = MEL_BANDS + CONTRAST_BANDS + FLAT_BANDS;
const CONTRAST_EDGES = [60, 200, 400, 800, 1600, 3200, 8000];
const FLAT_EDGES = [60, 500, 2000, 6000, 12000];
/** The mel scale (as the ear spaces pitch): 1127.01048 · ln(1 + f/700). */
export const mel = (hz: number) => 1127.01048 * Math.log(1 + hz / 700);
export const melHz = (m: number) => 700 * (Math.exp(m / 1127.01048) - 1);

export interface EarOptions {
  /** where in its hundredth of a second this ear does its work (0..1): ears that share the audio thread take turns */
  phase?: number;
  /** only levels, brightness, hits and noise: no tones followed and no shape (for a layer whose notes are known) */
  light?: boolean;
  /** the second of the stream its first sample is (an ear that begins part way through a song keeps the song's clock) */
  start?: number;
  /** a frame every this many hundredths of a second (an ear that only gives a track's texture need not hear it a hundred times a second) */
  every?: number;
}

export interface Voice {
  id: number;
  /** where it is now, in hertz */
  hz: number;
  /** how strong it is now, 0..1 (against the loudest thing heard lately) */
  amp: number;
  /** the strongest it has been */
  peak: number;
  /** when it began (seconds of the stream) and how long it has lasted */
  born: number;
  age: number;
  /** how hard it began: 0 = it swelled in, 1 = it was struck */
  struck: number;
  /** true in the first frame it is reported */
  fresh: boolean;
  /** the tone this one is an overtone of, when that is known (whoever shares the tones out sets it) */
  of?: number;
}

export interface Hit {
  /** how hard, 0..1 */
  strength: number;
  /** the stretch of the frequency scale it filled, and where its weight was (hertz) */
  lo: number;
  hi: number;
  hz: number;
  /** 0 = a tone (a pluck, a bell) … 1 = noise (a snare, a hat) */
  noisy: number;
}

export interface Frame {
  /** seconds of the stream */
  t: number;
  voices: Voice[];
  /** the voices that stopped in this frame */
  ended: number[];
  hits: Hit[];
  /** noise in each band, 0..1 */
  noise: Float32Array;
  /** how loud it is now: 0..1 against the loudest heard lately, and in dB against full scale */
  level: number;
  db: number;
  /** where the weight of the sound is (hertz) and how much of it is noise (0 = all tones … 1 = hiss) */
  centroid: number;
  flat: number;
  /** how much is starting right now (the sum of every band's rise) */
  flux: number;
  /** how strong each of the twelve notes is (C first), adding up to 1 (all 0 in silence) */
  chroma: Float32Array;
  /** the shape of the spectrum (see SHAPE); missing from a light ear's frames */
  shape?: Float32Array;
}

/** The tilt of music: this many dB are added for a component at `hz` before it is compared with others. */
export const tiltDb = (hz: number) => 4.5 * Math.log2(Math.max(20, hz) / 1000);
/** The middle frequency of a hit band and of a noise band. */
export const hitHz = (b: number) => EAR_LO * Math.pow(2, (b + 0.5) / 4);
export const noiseHz = (b: number) => EAR_LO * Math.pow(2, (b + 0.5) / 3);

const dB = (p: number) => 10 * Math.log10(p + 1e-14);

interface Track extends Voice {
  db: number;
  /** its last few levels (tilted dB), the highest it has reached, and how many frames ago that was */
  hist: number[];
  top: number;
  sinceTop: number;
  miss: number;
  seen: number;
}
interface Peak {
  hz: number;
  db: number;
  /** tilted level, for comparing */
  w: number;
  taken: boolean;
}

/** Triangular mel bands from 60 Hz to 8 kHz over the short look's bins (1024 points). */
function melPlan(sr: number): { from: number; w: Float32Array }[] {
  const binHz = sr / 1024;
  const lo = mel(60);
  const hi = mel(Math.min(8000, sr / 2 - binHz));
  const edges = Array.from({ length: MEL_BANDS + 2 }, (_, i) => melHz(lo + ((hi - lo) * i) / (MEL_BANDS + 1)));
  const out: { from: number; w: Float32Array }[] = [];
  for (let m = 0; m < MEL_BANDS; m++) {
    const [a, b, c] = [edges[m], edges[m + 1], edges[m + 2]];
    const from = Math.max(1, Math.floor(a / binHz));
    const to = Math.min(511, Math.ceil(c / binHz));
    const w = new Float32Array(Math.max(1, to - from + 1));
    for (let k = from; k <= to; k++) {
      const f = k * binHz;
      w[k - from] = f <= b ? Math.max(0, (f - a) / (b - a)) : Math.max(0, (c - f) / (c - b));
    }
    // a band narrower than a bin still takes the bin it falls in
    if (w.every((x) => x === 0)) w[Math.min(w.length - 1, Math.round(b / binHz) - from)] = 1;
    out.push({ from, w });
  }
  return out;
}

/** Which bins make up each of `count` bands, `per` to the octave, for a spectrum of `n` points at `sr`. */
function plan(count: number, per: number, sr: number, n: number): { from: number; to: number }[] {
  const out = [];
  const hzPerBin = sr / n;
  for (let b = 0; b < count; b++) {
    const lo = (EAR_LO * Math.pow(2, b / per)) / hzPerBin;
    const hi = (EAR_LO * Math.pow(2, (b + 1) / per)) / hzPerBin;
    const from = Math.max(1, Math.round(lo));
    out.push({ from, to: Math.max(from + 1, Math.min(n / 2, Math.round(hi))) });
  }
  return out;
}

export class Ear {
  readonly sr: number;
  /** samples between one frame and the next: a hundredth of a second */
  readonly hop: number;
  private readonly ring = new Float32Array(8192);
  private pos = 0;
  private count = 0;
  /** the count it began at */
  private first = 0;
  private sinceHop = 0;
  private readonly long = new FFT(4096);
  private readonly mid = new FFT(2048);
  private readonly short = new FFT(1024);
  private readonly pLong = new Float32Array(2049);
  private readonly pMid = new Float32Array(1025);
  private readonly pShort = new Float32Array(513);
  private readonly hitPlan: { from: number; to: number }[];
  private readonly noisePlan: { from: number; to: number }[];
  /** each hit band's level (dB) in the last frames, newest last */
  private readonly hist: Float32Array[] = [];
  private readonly rise = new Float32Array(HIT_BANDS);
  /** the rise in each of the last frames, for judging how hard a voice began */
  private readonly rises: Float32Array[] = [];
  private readonly odf: number[] = [];
  private sinceHit = 99;
  private tracks: Track[] = [];
  private nextId = 1;
  /** the loudest thing heard lately (tilted dB) */
  private ref: number;
  private peaks: Peak[] = [];
  private readonly noiseNow = new Float32Array(NOISE_BANDS);
  private readonly around = new Float32Array(24);
  /** for each of the last frames: each band's rise, weighted towards the bands that are loud (to say where a hit was) */
  private readonly shapes: Float32Array[] = [];
  private readonly light: boolean;
  /** the mel bands: for each, its bins and their weights in the short look */
  private readonly melPlan: { from: number; w: Float32Array }[];
  private readonly scratchBins = new Float32Array(512);

  /** `ref`: how loud the loudest parts are expected to be (dBFS), if known. Otherwise the first sounds set it. */
  constructor(sr: number, ref = -54, opts: EarOptions = {}) {
    this.sr = sr;
    this.hop = Math.round(sr / 100) * Math.max(1, Math.round(opts.every ?? 1));
    this.ref = ref;
    this.hitPlan = plan(HIT_BANDS, 4, sr, 1024);
    this.noisePlan = plan(NOISE_BANDS, 3, sr, 2048);
    this.light = !!opts.light;
    // a later phase: this ear's first frame comes that much of a hop later, and so do all the rest
    this.sinceHop = -Math.round((((opts.phase ?? 0) % 1) + 1) % 1 * this.hop);
    this.melPlan = melPlan(sr);
    this.count = this.first = Math.max(0, Math.round((opts.start ?? 0) * sr));
  }

  /** Share another ear's sense of the loudest thing heard lately (dB, tilted): never read levels against less. */
  hold(ref: number) {
    this.ref = Math.max(this.ref, ref);
  }

  /** The loudest thing heard lately (dB, tilted): what levels are read against. */
  get loudest() {
    return this.ref;
  }

  /** The time of the newest sample taken in, in seconds. */
  get now() {
    return this.count / this.sr;
  }

  /** Take in samples (any number at a time); what was heard comes back, a frame for every hundredth of a second. */
  push(x: Float32Array, out: Frame[] = []): Frame[] {
    const { ring } = this;
    for (let i = 0; i < x.length; i++) {
      ring[this.pos] = x[i];
      this.pos = (this.pos + 1) & 8191;
      this.count++;
      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        if (this.count - this.first >= 1024) out.push(this.frame());
      }
    }
    return out;
  }

  private frame(): Frame {
    const { sr, pLong, pMid, pShort } = this;
    const dt = this.hop / sr;
    if (!this.light) this.long.power(this.ring, this.pos, pLong);
    this.mid.power(this.ring, this.pos, pMid);
    this.short.power(this.ring, this.pos, pShort);
    // the short look is centred half its length back from now
    const t = (this.count - 512) / sr;

    // ── how loud, how bright, how noisy (from the short look) ──
    let sum = 0;
    let weighted = 0;
    let logSum = 0;
    let bins = 0;
    const kLo = Math.max(1, Math.round((60 * 1024) / sr));
    const kHi = Math.min(511, Math.round((12000 * 1024) / sr));
    for (let k = kLo; k <= kHi; k++) {
      const p = pShort[k];
      sum += p;
      weighted += p * k;
      logSum += Math.log(p + 1e-14);
      bins++;
    }
    const centroid = sum > 1e-12 ? ((weighted / sum) * sr) / 1024 : 0;
    const flat = sum > 1e-12 ? Math.min(1, Math.exp(logSum / bins) / (sum / bins)) : 0;
    let e = 0;
    for (let i = 1; i <= 1024; i++) {
      const v = this.ring[(this.pos - i) & 8191];
      e += v * v;
    }
    const db = dB(e / 1024);

    // ── tones: the peaks of the three looks, each in its own range ──
    const peaks = this.peaks;
    peaks.length = 0;
    if (!this.light) {
      this.findPeaks(pLong, 4096, EAR_LO, 700);
      this.findPeaks(pMid, 2048, 700, 2800);
      this.findPeaks(pShort, 1024, 2800, EAR_HI);
    }
    let top = -200;
    for (const p of peaks) top = Math.max(top, p.w);
    const level = new Float32Array(HIT_BANDS);
    for (let b = 0; b < HIT_BANDS; b++) {
      const { from, to } = this.hitPlan[b];
      let s = 0;
      for (let k = from; k < to; k++) s += pShort[k];
      level[b] = dB(s) + tiltDb(hitHz(b));
      top = Math.max(top, level[b] - 6);
    }
    // the loudest lately: it comes down slowly (2 dB a second), so a quiet passage is painted quietly
    this.ref = Math.max(this.ref - 2 * dt, top, -54);
    const floor = this.ref - RANGE_DB;
    const amp = (w: number) => Math.max(0, Math.min(1, (w - floor) / RANGE_DB));

    // ── hits: where the level jumps ──
    const rise = this.rise;
    const shape = new Float32Array(HIT_BANDS);
    let flux = 0;
    const h = this.hist;
    for (let b = 0; b < HIT_BANDS; b++) {
      // against the louder of the last two frames, so a sound that is merely wavering does not count;
      // and by how loud the band is, so a faint thing appearing out of silence is not a great event
      const before = h.length ? Math.max(h[h.length - 1][b], h.length > 1 ? h[h.length - 2][b] : -200) : level[b];
      const a = amp(level[b] + 3);
      rise[b] = Math.max(0, Math.min(30, level[b] - Math.max(before, floor))) * a;
      shape[b] = rise[b] * a * a;
      flux += rise[b];
    }
    this.shapes.push(shape);
    if (this.shapes.length > 3) this.shapes.shift();
    h.push(level);
    if (h.length > 3) h.shift();
    this.rises.push(Float32Array.from(rise));
    if (this.rises.length > 6) this.rises.shift();
    const hits: Hit[] = [];
    const odf = this.odf;
    odf.push(flux);
    if (odf.length > 24) odf.shift();
    this.sinceHit++;
    if (odf.length >= 3) {
      // a hit is a frame that rose more than the ones around it, and well above what has been usual
      const prev = odf[odf.length - 2];
      const sorted = odf.slice(0, -1).sort((a, b) => a - b);
      const usual = sorted[sorted.length >> 1];
      if (prev > flux && prev >= odf[odf.length - 3] && prev > usual * 1.7 + 14 && this.sinceHit > 4) {
        const hit = this.describeHit(this.shapes[this.shapes.length - 2], prev, pShort);
        if (hit) {
          hits.push(hit);
          this.sinceHit = 0;
        }
      }
    }

    // ── follow the voices ──
    const ended: number[] = [];
    const tracks = this.tracks;
    for (const tr of tracks) tr.fresh = false;
    tracks.sort((a, b) => b.db - a.db);
    for (const tr of tracks) {
      let best: Peak | null = null;
      let bestD = 1e9;
      const tol = Math.max(0.8, 12 * Math.log2(1 + (0.6 * sr) / (tr.hz < 700 ? 4096 : tr.hz < 2800 ? 2048 : 1024) / tr.hz));
      for (const p of peaks) {
        if (p.taken) continue;
        const d = Math.abs(12 * Math.log2(p.hz / tr.hz));
        if (d < tol && d < bestD) {
          bestD = d;
          best = p;
        }
      }
      // The same note struck again while it still rang: its level, which had been falling or
      // steady, jumps. (It must be past its own beginning, or the rise of the note itself would
      // count; and a slow swell or a tremolo does not rise this fast.)
      const before = tr.hist.length ? Math.min(...tr.hist) : 0;
      const again =
        best !== null && tr.seen >= 2 && tr.sinceTop >= 8 && (best.w - tr.hist[0] > 5.5 || (best.w - before > 2.5 && this.struckAt(tr.hz, 4) > 0.3));
      if (best && best.w > floor && again) {
        // the old sound is over; the peak is left for a new voice to take, below
        tr.miss = 99;
      } else if (best && best.w > floor) {
        best.taken = true;
        tr.hist.push(best.w);
        if (tr.hist.length > 8) tr.hist.shift();
        if (best.w >= tr.top - 0.5) {
          tr.top = Math.max(tr.top, best.w);
          tr.sinceTop = 0;
        } else tr.sinceTop++;
        tr.hz = best.hz;
        tr.db = best.w;
        tr.amp = amp(best.w);
        tr.peak = Math.max(tr.peak, tr.amp);
        tr.miss = 0;
        tr.seen++;
        if (tr.seen === 2) tr.fresh = true;
      } else {
        tr.miss++;
        // while it is missing it is taken to be dying away
        tr.db -= 3;
        tr.amp = amp(tr.db);
      }
      tr.age = t - tr.born;
    }
    this.tracks = tracks.filter((tr) => {
      // gone for three frames, or never came back after its first: it has stopped
      const over = tr.miss > 2 || (tr.seen < 2 && tr.miss > 0) || tr.amp <= 0;
      if (over && tr.seen >= 2) ended.push(tr.id);
      return !over;
    });
    for (const p of peaks) {
      if (p.taken || p.w <= floor + 2 || this.tracks.length >= 64) continue;
      this.tracks.push({ id: this.nextId++, hz: p.hz, db: p.w, amp: amp(p.w), peak: amp(p.w), born: t, age: 0, struck: this.struckAt(p.hz), fresh: false, miss: 0, seen: 1, hist: [p.w], top: p.w, sinceTop: 0 });
    }
    const voices: Voice[] = [];
    const chroma = new Float32Array(12);
    let chromaSum = 0;
    for (const tr of this.tracks) {
      if (tr.seen < 2) continue;
      if (tr.fresh) tr.struck = Math.max(tr.struck, this.struckAt(tr.hz));
      voices.push({ id: tr.id, hz: tr.hz, amp: tr.amp, peak: tr.peak, born: tr.born, age: tr.age, struck: tr.struck, fresh: tr.fresh });
      if (tr.hz > 55 && tr.hz < 2100 && tr.miss === 0) {
        const pc = ((Math.round(12 * Math.log2(tr.hz / 261.6256)) % 12) + 12) % 12;
        const wgt = tr.amp * tr.amp;
        chroma[pc] += wgt;
        chromaSum += wgt;
      }
    }
    if (chromaSum > 0) for (let i = 0; i < 12; i++) chroma[i] /= chromaSum;

    // ── noise: in each band, what the quieter half of its points says the floor is ──
    const noise = new Float32Array(NOISE_BANDS);
    const scratch: number[] = [];
    for (let b = 0; b < NOISE_BANDS; b++) {
      const { from, to } = this.noisePlan[b];
      let nz = -200;
      if (to - from >= 4) {
        scratch.length = 0;
        for (let k = from; k < to; k++) scratch.push(pMid[k]);
        scratch.sort((x, y) => x - y);
        let s = 0;
        const half = scratch.length >> 1;
        for (let i = 0; i < half; i++) s += scratch[i];
        // the quieter half of a noise holds about 0.31 of its power
        nz = dB((s / 0.31) * 1) + tiltDb(noiseHz(b));
      }
      // it is noise only if it stands above the floor; smoothed a little (it flickers by nature)
      const a = amp(nz - 3);
      this.noiseNow[b] += (a - this.noiseNow[b]) * (a > this.noiseNow[b] ? 0.6 : 0.25);
      noise[b] = this.noiseNow[b];
    }

    const f: Frame = { t, voices, ended, hits, noise, level: amp(db + 9), db, centroid, flat, flux, chroma };
    if (!this.light) f.shape = this.shapeOf(pShort);
    return f;
  }

  /** The shape of the spectrum (the short look): mel band levels, octave contrast, broad flatness. */
  private shapeOf(p: Float32Array): Float32Array {
    const out = new Float32Array(SHAPE);
    const binHz = this.sr / 1024;
    for (let m = 0; m < MEL_BANDS; m++) {
      const { from, w } = this.melPlan[m];
      let s = 0;
      for (let i = 0; i < w.length; i++) s += p[from + i] * w[i];
      out[m] = dB(s);
    }
    const bins = this.scratchBins;
    for (let b = 0; b < CONTRAST_BANDS; b++) {
      const k0 = Math.max(1, Math.round(CONTRAST_EDGES[b] / binHz));
      const k1 = Math.min(511, Math.max(k0 + 2, Math.round(CONTRAST_EDGES[b + 1] / binHz)));
      const n = k1 - k0;
      for (let k = 0; k < n; k++) bins[k] = p[k0 + k];
      const part = bins.subarray(0, n).sort();
      // the peak and the valley: the loudest and the quietest fifth of the band's points
      const q = Math.max(1, Math.round(n * 0.2));
      let lo = 0;
      let hi = 0;
      for (let k = 0; k < q; k++) {
        lo += part[k];
        hi += part[n - 1 - k];
      }
      out[MEL_BANDS + b] = Math.log10((hi + 1e-12) / (lo + 1e-12));
    }
    for (let b = 0; b < FLAT_BANDS; b++) {
      const k0 = Math.max(1, Math.round(FLAT_EDGES[b] / binHz));
      const k1 = Math.min(512, Math.max(k0 + 2, Math.round(FLAT_EDGES[b + 1] / binHz)));
      let s = 0;
      let ls = 0;
      for (let k = k0; k < k1; k++) {
        s += p[k];
        ls += Math.log(p[k] + 1e-14);
      }
      const n = k1 - k0;
      out[MEL_BANDS + CONTRAST_BANDS + b] = s > 1e-12 ? Math.min(1, Math.exp(ls / n) / (s / n)) : 0;
    }
    return out;
  }

  /** How hard a sound at `hz` has just begun, 0..1: the biggest rise in its band over the last few frames (five, unless told). */
  private struckAt(hz: number, frames = 5): number {
    const b = Math.max(0, Math.min(HIT_BANDS - 1, Math.floor(Math.log2(Math.max(EAR_LO, hz) / EAR_LO) * 4)));
    let most = 0;
    for (let i = Math.max(0, this.rises.length - frames); i < this.rises.length; i++) {
      const r = this.rises[i];
      most = Math.max(most, r[b], b > 0 ? r[b - 1] * 0.7 : 0, b < HIT_BANDS - 1 ? r[b + 1] * 0.7 : 0);
    }
    return Math.max(0, Math.min(1, (most - 2) / 12));
  }

  /** The peaks of one look between two frequencies: points that stand well clear of what is around them. */
  private findPeaks(p: Float32Array, n: number, lo: number, hi: number) {
    const hzPerBin = this.sr / n;
    const from = Math.max(2, Math.ceil(lo / hzPerBin));
    const to = Math.min(n / 2 - 2, Math.floor(hi / hzPerBin));
    const W = 10;
    const around = this.around;
    for (let k = from; k <= to; k++) {
      const v = p[k];
      if (v < 1e-9 || v <= p[k - 1] || v < p[k + 1]) continue;
      // what is around it, leaving out the peak's own skirts: the middle value of its neighbours,
      // which other tones standing nearby cannot shift (the notes of a chord must not hide each other)
      let c = 0;
      for (let j = 3; j < 3 + W; j++) {
        if (k - j >= 1) around[c++] = p[k - j];
        if (k + j <= n / 2) around[c++] = p[k + j];
      }
      if (c >= 6) {
        // (a short insertion sort: there are at most twenty)
        for (let i = 1; i < c; i++) {
          const x = around[i];
          let j = i - 1;
          while (j >= 0 && around[j] > x) {
            around[j + 1] = around[j];
            j--;
          }
          around[j + 1] = x;
        }
        // 11.5 dB clear of that: among random noise a point reaches it only once in tens of thousands
        if (v < 14 * around[c >> 1]) continue;
      }
      // a parabola through the peak and its neighbours gives the true frequency and level
      const a = dB(p[k - 1]);
      const b = dB(v);
      const g = dB(p[k + 1]);
      const d = a - 2 * b + g;
      const off = d < -1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - g)) / d)) : 0;
      const hz = (k + off) * hzPerBin;
      const level = b - 0.25 * (a - g) * off;
      this.peaks.push({ hz, db: level, w: level + tiltDb(hz), taken: false });
    }
  }

  /** What a hit was: how hard, and which stretch of the scale rose with it. */
  private describeHit(shape: Float32Array, size: number, spectrum: Float32Array): Hit | null {
    let total = 0;
    let mean = 0;
    for (let b = 0; b < HIT_BANDS; b++) {
      total += shape[b];
      mean += shape[b] * b;
    }
    if (total <= 0) return null;
    mean /= total;
    // the stretch that holds four fifths of the rise
    let lo = 0;
    let hi = HIT_BANDS - 1;
    let acc = 0;
    for (let b = 0; b < HIT_BANDS; b++) {
      acc += shape[b];
      if (acc >= total * 0.1) {
        lo = b;
        break;
      }
    }
    acc = 0;
    for (let b = HIT_BANDS - 1; b >= 0; b--) {
      acc += shape[b];
      if (acc >= total * 0.1) {
        hi = b;
        break;
      }
    }
    // noise or tone: how flat the spectrum is across that stretch
    const k0 = this.hitPlan[lo].from;
    const k1 = this.hitPlan[hi].to;
    let s = 0;
    let ls = 0;
    for (let k = k0; k < k1; k++) {
      s += spectrum[k];
      ls += Math.log(spectrum[k] + 1e-14);
    }
    const n = Math.max(1, k1 - k0);
    const flatness = s > 0 ? Math.exp(ls / n) / (s / n) : 0;
    const wide = (hi - lo + 1) / HIT_BANDS;
    return {
      strength: Math.max(0.05, Math.min(1, (size - 12) / 150)),
      lo: EAR_LO * Math.pow(2, lo / 4),
      hi: EAR_LO * Math.pow(2, (hi + 1) / 4),
      hz: EAR_LO * Math.pow(2, (mean + 0.5) / 4),
      noisy: Math.max(0, Math.min(1, flatness * 2.2 * (0.4 + wide))),
    };
  }
}
