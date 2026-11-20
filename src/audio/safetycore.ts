/**
 * The master's safety stage itself (see safety.ts), on plain arrays: what the audio thread runs
 * (safety.worklet.ts) and what the tests run. Kept apart from safety.ts, which hands the browser
 * the processor's address: the processor must not import that, or its bundle would read the
 * page's address, which an audio worklet does not have, and fail to load.
 */
/** −1 dBFS: a sample under this leaves exactly as it came, unless the level is being held down */
export const SAFETY_KNEE = 0.891;
/** about −0.2 dBFS: what anything over the knee is rounded off toward, and never reaches */
export const SAFETY_CEILING = 0.98;
/** +1 dBFS: a peak more than this over is held down at once, so the rounding never has more than 2 dB to take in */
export const SAFETY_LIMIT = 1.122;
/** how long the gain holds after a peak over the limit (seconds) */
export const SAFETY_HOLD = 0.01;
/** how long it takes to come back (seconds, to 1/e of the way) */
export const SAFETY_RELEASE = 0.15;
/** a sound counts as held over (not a drum hit's tip) once it has been over the knee this long in the last 50 ms or so (seconds) */
export const SAFETY_HELD = 0.01;
/** a held over's level comes down to the knee this fast (seconds, to 1/e of the way) */
export const SAFETY_RISE = 0.02;
/** and goes back up this fast once it has passed (seconds) */
export const SAFETY_FALL = 0.3;
export const SAFETY_PROCESSOR = "m-theory-master-safety";

/**
 * Round off a sample over the knee: the same up to it, then bending smoothly (no corner, so no
 * new edge) toward the ceiling, which it never reaches. A drum hit's tip a dB or two over is
 * rounded off in a millisecond, which nobody hears; its level is left alone.
 */
export function roundOff(x: number, knee = SAFETY_KNEE, ceiling = SAFETY_CEILING): number {
  const a = x < 0 ? -x : x;
  if (a <= knee) return x;
  const span = ceiling - knee;
  const y = knee + span * Math.tanh((a - knee) / span);
  return x < 0 ? -y : y;
}

/**
 * The safety stage, on plain arrays: the processor runs one, the tests another. Allocates nothing
 * as it runs. Three parts, each for its own kind of over:
 * - a tip over −1 dBFS (a drum hit on a full mix): rounded off, its level left alone;
 * - a sound over −1 dBFS for longer (a loud note held: over for 10 ms of the last 50 or so): its
 *   level comes down to −1 dBFS over about 20 ms and back over about 300 ms once it has passed,
 *   so it is not rounded off for long;
 * - a peak more than 1 dB over full scale (a fader pushed hard): held down at once, for 10 ms, and
 *   let back over 150 ms.
 * While none of that is happening the gain is exactly 1 and everything under −1 dBFS passes bit
 * for bit. Left and right are turned down together, so the picture does not lean. Nothing looks
 * ahead, so nothing is delayed.
 */
export class SafetyLimiter {
  /** the gain now (1: not turning anything down) */
  gain = 1;
  /** times the gain started to move from rest */
  events = 0;
  /** samples rounded off, left and right counted apart (for measuring) */
  rounded = 0;
  /** how long it has been over the knee lately (frames, leaking away over about 50 ms) */
  private over = 0;
  /** its loudest peak lately (falling away over about 300 ms) */
  private loud = 0;
  private slow = 1;
  private fast = 1;
  private holdLeft = 0;
  private readonly holdFrames: number;
  private readonly heldFrames: number;
  private readonly leak: number;
  private readonly loudBack: number;
  private readonly back: number;
  private readonly rise: number;
  private readonly fall: number;

  constructor(
    readonly sampleRate: number,
    readonly knee = SAFETY_KNEE,
    readonly ceiling = SAFETY_CEILING,
    readonly limit = SAFETY_LIMIT,
  ) {
    this.holdFrames = Math.max(0, Math.round(SAFETY_HOLD * sampleRate));
    this.heldFrames = SAFETY_HELD * sampleRate;
    this.leak = Math.exp(-1 / (0.05 * sampleRate));
    this.loudBack = Math.exp(-1 / (SAFETY_FALL * sampleRate));
    this.back = Math.exp(-1 / (SAFETY_RELEASE * sampleRate));
    this.rise = 1 - Math.exp(-1 / (SAFETY_RISE * sampleRate));
    this.fall = 1 - Math.exp(-1 / (SAFETY_FALL * sampleRate));
  }

  /** Make safe `n` frames of a stereo pair in place (`r` may be `l` for one channel). */
  process(l: Float32Array, r: Float32Array, n = l.length): void {
    const K = this.knee;
    const L2 = this.limit;
    const span = this.ceiling - K;
    let over = this.over;
    let loud = this.loud;
    let slow = this.slow;
    let fast = this.fast;
    let hold = this.holdLeft;
    let g = this.gain;
    let rounded = 0;
    for (let i = 0; i < n; i++) {
      const a = l[i] < 0 ? -l[i] : l[i];
      const b = r[i] < 0 ? -r[i] : r[i];
      const peak = a > b ? a : b;
      // the slow level: a sound held over the knee (not a drum hit's tip) comes down to it
      over = over * this.leak + (peak > K ? 1 : 0);
      if (over < 1e-6) over = 0;
      loud = peak > loud ? peak : loud * this.loudBack;
      if (loud < 1e-9) loud = 0;
      const target = over > this.heldFrames && loud > K ? K / loud : 1;
      slow += (target - slow) * (target < slow ? this.rise : this.fall);
      // (snapped back to 1 once within a ten-thousandth of it, an 80 dB step nobody hears, so it passes bit for bit again)
      if (1 - slow < 1e-4) slow = 1;
      // the fast limiter: holding, then gliding up to 1 (snapped there once it is all but there, so it passes bit for bit again)
      if (fast < 1) {
        if (hold > 0) hold--;
        else {
          fast = 1 - (1 - fast) * this.back;
          if (1 - fast < 1e-6) fast = 1;
        }
      }
      if (peak * slow * fast > L2) {
        fast = L2 / (peak * slow);
        hold = this.holdFrames;
      }
      const was = g;
      g = slow * fast;
      if (g < 1 && was === 1) this.events++;
      let x = l[i];
      if (g !== 1) x *= g;
      if (x > K || x < -K) {
        const s = x < 0 ? -1 : 1;
        x = s * (K + span * Math.tanh((s * x - K) / span));
        rounded++;
      }
      l[i] = x;
      if (r !== l) {
        let y = r[i];
        if (g !== 1) y *= g;
        if (y > K || y < -K) {
          const s = y < 0 ? -1 : 1;
          y = s * (K + span * Math.tanh((s * y - K) / span));
          rounded++;
        }
        r[i] = y;
      }
    }
    this.over = over;
    this.loud = loud;
    this.slow = slow;
    this.fast = fast;
    this.holdLeft = hold;
    this.gain = g;
    this.rounded += rounded;
  }
}
