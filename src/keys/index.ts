/**
 * Keys: the piano and the electric piano, as Instruments (src/audio/instrument.ts).
 *
 *   const piano = createPiano(ctx);       // or createElectricPiano(ctx), or createKeys(id, ctx)
 *   piano.output.connect(trackFader);
 *   await piano.load();                   // every key can sound; more layers keep loading behind
 *   piano.play(60, ctx.currentTime, 0.7, 1.5);
 *   piano.pedal(true, t); piano.pedal(false, t2);
 *
 * For a WAV bounce, make one on the OfflineAudioContext and, for the piano, `await
 * piano.prepare(notes)` (it loads exactly the recordings those notes need) before rendering.
 */
export type { Instrument } from "../audio/instrument";
export { Sampler, type SamplerOptions } from "./sampler";
export { EPiano, type EPianoOptions } from "./epiano";
export type { Progress } from "./bank";
export { defaultBudget } from "./bank";
export { TINE_DEFAULT, TINE_PRESETS, tineParams, type TineParams } from "./tines";
export {
  KEYS,
  PIANO_PATH,
  EPIANO_PATH,
  createElectricPiano,
  createKeys,
  createPiano,
  keepSamples,
  packUrl,
  pianoUrl,
  type KeysId,
} from "./piano";
