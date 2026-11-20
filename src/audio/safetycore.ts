/**
 * The master's safety limiter itself (see safety.ts), on plain arrays: what the audio thread runs
 * (safety.worklet.ts) and what the tests run. Kept apart from safety.ts, which hands the browser
 * the processor's address: the processor must not import that, or its bundle would read the
 * page's address, which an audio worklet does not have, and fail to load.
 */
/** −1 dBFS: the loudest a sample leaves */
export const SAFETY_CEILING = 0.891;
/** how long the gain holds after an over (seconds) */
export const SAFETY_HOLD = 0.01;
/** how long it takes to come back (seconds, to 1/e of the way) */
export const SAFETY_RELEASE = 0.15;
export const SAFETY_PROCESSOR = "m-theory-master-safety";

/** The limiter itself, on plain arrays: the processor runs one, the tests another. Allocates nothing as it runs. */
export class SafetyLimiter {
  /** the gain now (1: not limiting) */
  gain = 1;
  /** gain reductions started (each time it starts holding an over down from rest) */
  events = 0;
  private holdLeft = 0;
  private readonly holdFrames: number;
  private readonly back: number;

  constructor(
    readonly sampleRate: number,
    readonly ceiling = SAFETY_CEILING,
    hold = SAFETY_HOLD,
    release = SAFETY_RELEASE,
  ) {
    this.holdFrames = Math.max(0, Math.round(hold * sampleRate));
    this.back = Math.exp(-1 / (release * sampleRate));
  }

  /** Limit `n` frames of a stereo pair in place (`r` may be `l` for one channel). */
  process(l: Float32Array, r: Float32Array, n = l.length): void {
    const T = this.ceiling;
    let g = this.gain;
    let hold = this.holdLeft;
    for (let i = 0; i < n; i++) {
      const a = l[i] < 0 ? -l[i] : l[i];
      const b = r[i] < 0 ? -r[i] : r[i];
      const peak = a > b ? a : b;
      // coming back: holding, then gliding up to 1 (snapped there once it is all but there, so it passes bit for bit again)
      if (g < 1) {
        if (hold > 0) hold--;
        else {
          g = 1 - (1 - g) * this.back;
          if (1 - g < 1e-6) g = 1;
        }
      }
      // an over: down to exactly the ceiling at once
      if (peak * g > T) {
        if (g === 1) this.events++;
        g = T / peak;
        hold = this.holdFrames;
      }
      if (g !== 1) {
        l[i] *= g;
        if (r !== l) r[i] *= g;
      }
    }
    this.gain = g;
    this.holdLeft = hold;
  }
}
