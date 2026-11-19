/**
 * Listening to the mix as it is, one stem at a time: every chords, melody and drums track passes
 * a tap on its way out (after all its effects and its fader), and each stem can be asked what is
 * sounding right now, band by band, in all its tracks together (a second drums track is drums too). This is what really comes out of the speakers, so reverb
 * tails, echoes, distortion and anything else the effects add are all in it.
 *
 * A tap only listens: it changes nothing in the sound and adds no delay.
 */
import { BANDS, F_LO, PER_OCTAVE } from "./describe";

export type Stem = "chords" | "melody" | "drums";
export const STEMS: Stem[] = ["chords", "melody", "drums"];

interface Tap {
  from: AudioNode;
  node: AnalyserNode;
  db: Float32Array<ArrayBuffer>;
  /** for every band: which bins it takes, and how much of each */
  plan: { bin: number; share: number }[][];
}
/** each stem's taps, by track */
const taps: Record<Stem, Map<string, Tap>> = { chords: new Map(), melody: new Map(), drums: new Map() };
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

/** Put a tap on a track of a stem: everything that passes `from` is heard. A track tapped again moves its tap. */
export function tapStem(stem: Stem, from: AudioNode, track: string = stem) {
  const old = taps[stem].get(track);
  if (old?.from === from) return;
  untapStem(track);
  const c = from.context;
  const node = c.createAnalyser();
  node.fftSize = FFT;
  // no smoothing: what is asked for is what is sounding now, not an average of the last second
  node.smoothingTimeConstant = 0;
  node.minDecibels = -120;
  from.connect(node);
  taps[stem].set(track, { from, node, db: new Float32Array(FFT / 2), plan: bandPlan(c.sampleRate, FFT) });
}

/** A track has gone: stop hearing it. */
export function untapStem(track: string) {
  for (const s of STEMS) {
    const t = taps[s].get(track);
    if (!t) continue;
    try {
      t.from.disconnect(t.node);
    } catch {
      /* already apart */
    }
    taps[s].delete(track);
  }
}

/**
 * What a stem is sounding right now: the power in each band, written into `out` (length BANDS).
 * False (and silence in `out`) when the stem has not made a sound yet.
 */
export function readStem(stem: Stem, out: Float32Array): boolean {
  out.fill(0);
  const list = taps[stem];
  if (!list.size) return false;
  // the stem's tracks add up as powers do (two tracks at once are louder than either)
  for (const t of list.values()) {
    t.node.getFloatFrequencyData(t.db);
    for (let b = 0; b < BANDS; b++) {
      let sum = 0;
      for (const { bin, share } of t.plan[b]) {
        const d = t.db[bin];
        if (d > -119) sum += Math.pow(10, d / 10) * share;
      }
      out[b] += sum;
    }
  }
  return true;
}

/** Is there a tap on this stem? */
export const hasStem = (stem: Stem) => taps[stem].size > 0;
