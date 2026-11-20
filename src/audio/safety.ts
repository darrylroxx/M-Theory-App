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
import { SAFETY_PROCESSOR } from "./safetycore";
export { SAFETY_CEILING, SAFETY_HOLD, SAFETY_RELEASE, SAFETY_PROCESSOR, SafetyLimiter } from "./safetycore";

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
