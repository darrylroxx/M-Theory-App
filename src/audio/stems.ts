/**
 * Listening to the mix as it is, one stem at a time: the chords, the melody and the drums each
 * pass a tap on their way out (after all their effects), and each tap can be asked what is
 * sounding right now, band by band. This is what really comes out of the speakers, so reverb
 * tails, echoes, distortion and anything else the effects add are all in it.
 *
 * A tap only listens: it changes nothing in the sound and adds no delay.
 */
import { BANDS, F_LO, PER_OCTAVE } from "./describe";

export type Stem = "chords" | "melody" | "drums";
export const STEMS: Stem[] = ["chords", "melody", "drums"];

interface Tap {
  node: AnalyserNode;
  db: Float32Array<ArrayBuffer>;
  /** for every band: which bins it takes, and how much of each */
  plan: { bin: number; share: number }[][];
}
const taps: Partial<Record<Stem, Tap>> = {};
/**
 * A long look (8192 samples, about a sixth of a second): the bass needs it. With a shorter one a
 * kick drum at 50 Hz and a bass note at 80 Hz are one smear.
 */
const FFT = 8192;

/** Which bins make up each band, at this sample rate (worked out once). */
export function bandPlan(sampleRate: number, fftSize: number): { bin: number; share: number }[][] {
  const hzPerBin = sampleRate / fftSize;
  const plan: { bin: number; share: number }[][] = [];
  for (let b = 0; b < BANDS; b++) {
    const lo = (F_LO * Math.pow(2, b / PER_OCTAVE)) / hzPerBin;
    const hi = (F_LO * Math.pow(2, (b + 1) / PER_OCTAVE)) / hzPerBin;
    const list: { bin: number; share: number }[] = [];
    for (let k = Math.max(1, Math.floor(lo + 0.5)); k <= Math.min(fftSize / 2 - 1, Math.floor(hi + 0.5)); k++) {
      const share = Math.min(hi, k + 0.5) - Math.max(lo, k - 0.5);
      if (share > 0) list.push({ bin: k, share });
    }
    plan.push(list);
  }
  return plan;
}

/** Put a tap on a stem: everything that passes `from` is heard. */
export function tapStem(stem: Stem, from: AudioNode) {
  const c = from.context;
  const node = c.createAnalyser();
  node.fftSize = FFT;
  // no smoothing: what is asked for is what is sounding now, not an average of the last second
  node.smoothingTimeConstant = 0;
  node.minDecibels = -120;
  from.connect(node);
  taps[stem] = { node, db: new Float32Array(FFT / 2), plan: bandPlan(c.sampleRate, FFT) };
}

/**
 * What a stem is sounding right now: the power in each band, written into `out` (length BANDS).
 * False (and silence in `out`) when the stem has not made a sound yet.
 */
export function readStem(stem: Stem, out: Float32Array): boolean {
  const t = taps[stem];
  if (!t) {
    out.fill(0);
    return false;
  }
  t.node.getFloatFrequencyData(t.db);
  for (let b = 0; b < BANDS; b++) {
    let sum = 0;
    for (const { bin, share } of t.plan[b]) {
      const d = t.db[bin];
      if (d > -119) sum += Math.pow(10, d / 10) * share;
    }
    out[b] = sum;
  }
  return true;
}

/** Is there a tap on this stem? */
export const hasStem = (stem: Stem) => !!taps[stem];
