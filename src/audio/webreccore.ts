/**
 * The plain arithmetic of recording in a browser (see webrec.ts), and what the page and the audio thread share.
 * Nothing here touches the browser, so the audio thread's own code can read it, and so can a test.
 */

/** The name the audio thread's recorder is known by. */
export const WEBREC_PROCESSOR = "m-theory-webrec";
/** How many frames the recorder gathers before it hands them to the page (about 43 ms at 48,000 a second). */
export const WEBREC_BLOCK = 2048;

/** What the audio thread hands the page: the samples of each channel it was given, and the audio clock at their first frame. */
export interface WebBlock {
  /** the audio clock (seconds) at the first frame of this block */
  at: number;
  channels: Float32Array[];
}

/**
 * Where in a browser's recording the song's first beat lies, in frames from the recording's first frame.
 *
 * The recording and the song run on one clock, the browser's audio clock: `recAt` is that clock at the recording's
 * first frame, `songAt` at the moment the song's first beat was booked to sound. But a booked sound is heard later
 * than the clock says, by the browser's own buffer (`baseLatency`) and the computer's output (`outputLatency`), and
 * what is played along to it is played that much later. So the take is moved earlier by the two together: its first
 * beat lies that many frames further into the recording. (How long the sound then takes to come back in through the
 * microphone no browser says: that is what the timing nudge is for, and it is added where every take's is.)
 */
export function webOffset(o: { rate: number; recAt: number; songAt: number; baseLatency?: number; outputLatency?: number }): number {
  const late = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
  return Math.round((o.songAt - o.recAt + late(o.baseLatency) + late(o.outputLatency)) * o.rate);
}

/**
 * Which of the channels a microphone gave are kept, for a track's choice of input: one input is that channel (the
 * last one there is, when the microphone has fewer), a pair is that channel and the next when the microphone gives
 * two, else the one it gives. `have`: how many channels came in.
 */
export function keptChannels(input: { ch: number; pair?: boolean }, have: number): number[] {
  const n = Math.max(1, Math.floor(have));
  const ch = Math.max(0, Math.min(n - 1, Math.round(input.ch)));
  return input.pair && ch + 1 < n ? [ch, ch + 1] : [ch];
}

/** Blocks of samples as one list, `frames` long (blocks past it are cut, a shortfall is silence). */
export function joinBlocks(blocks: readonly Float32Array[], frames: number): Float32Array {
  const out = new Float32Array(Math.max(0, frames));
  let at = 0;
  for (const b of blocks) {
    if (at >= out.length) break;
    out.set(at + b.length > out.length ? b.subarray(0, out.length - at) : b, at);
    at += b.length;
  }
  return out;
}

/** The loudest sample in a block, 0 or more. */
export function peakOf(b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < b.length; i++) {
    const v = b[i] < 0 ? -b[i] : b[i];
    if (v > m) m = v;
  }
  return m;
}
