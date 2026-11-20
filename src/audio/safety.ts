/**
 * The master's safety stage: the last thing before the speakers, live and in every offline render
 * (a WAV, the recording engine's backing), so what is heard, exported and sung over match.
 *
 * Every track stays under a ceiling of its own, but the sum of them (a vocal take near its own
 * limit over loud drums, two vocals, a fader pushed up) can go over full scale, and the sound
 * card then flattens each over into a crackle. This catches only those overs, and on a normal mix
 * leaves the level alone: a drum hit's tip over −1 dBFS is rounded off (smoothly, toward −0.2
 * dBFS, which it never reaches); a sound held over −1 dBFS has its level brought down to it over
 * about 20 ms, so it is not rounded for long; and a peak more than 1 dB over full scale is held
 * down at once (10 ms, then back over 150 ms). Under −1 dBFS, with the level not held down,
 * everything passes bit for bit. Left and right move together, so the picture does not lean.
 *
 * It looks at nothing ahead, so it delays nothing: a lookahead limiter (or the browser's own
 * compressor, which always looks 6 ms ahead) would push the engine's backing late, and every
 * take sung over it would land late against the instruments.
 */
import safetyUrl from "./safety.worklet.ts?worker&url";
import { SAFETY_PROCESSOR } from "./safetycore";
export { SAFETY_CEILING, SAFETY_FALL, SAFETY_HOLD, SAFETY_KNEE, SAFETY_LIMIT, SAFETY_PROCESSOR, SAFETY_RELEASE, SAFETY_RISE, SafetyLimiter, roundOff } from "./safetycore";

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
