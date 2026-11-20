/**
 * The master's safety limiter: the last thing before the speakers, live and in every offline
 * render (a WAV, the recording engine's backing), so what is heard, exported and sung over match.
 *
 * Every track stays under a ceiling of its own, but the sum of them (a vocal take near its own
 * limit over loud drums, two vocals, a fader pushed up) can go over full scale, and the sound
 * card then flattens each over into a crackle. This catches only those overs: while nothing goes
 * over −1 dBFS its gain is exactly 1 and the sound passes through bit for bit. An over is held
 * down at once (the left and right together, so the picture does not lean), the gain holds for
 * 10 ms and comes back over 150 ms.
 *
 * It looks at nothing ahead, so it delays nothing: a lookahead limiter (or the browser's own
 * compressor, which always looks 6 ms ahead) would push the engine's backing late, and every
 * take sung over it would land late against the instruments.
 */
import safetyUrl from "./safety.worklet.ts?worker&url";

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

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();
const ready = new WeakSet<BaseAudioContext>();

/** Can this context run the limiter at all? (Not in the tests' pretend contexts, nor in very old browsers.) */
export const canRunSafety = (c: BaseAudioContext) => !!(c as { audioWorklet?: unknown }).audioWorklet && typeof AudioWorkletNode !== "undefined";

/**
 * Add the limiter's processor to a context (once per context). Resolves true when it can be
 * used, false where it cannot (the master then goes straight to the speakers, as before).
 */
export function loadSafety(c: BaseAudioContext): Promise<boolean> {
  if (!canRunSafety(c)) return Promise.resolve(false);
  let p = loaded.get(c);
  if (!p) {
    p = c.audioWorklet.addModule(safetyUrl).then(
      () => {
        ready.add(c);
        return true;
      },
      () => false,
    );
    loaded.set(c, p);
  }
  return p;
}

/** Is the limiter loaded on this context, so a master made now goes through it from its first sample? */
export const safetyReady = (c: BaseAudioContext) => ready.has(c);

/** A limiter node on a context whose processor is loaded. */
export function createSafety(c: BaseAudioContext): AudioWorkletNode {
  return new AudioWorkletNode(c, SAFETY_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
  });
}
