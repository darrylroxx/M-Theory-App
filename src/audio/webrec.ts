/**
 * Recording in a browser: the microphone, as the browser gives it.
 *
 * The desktop app records through its own engine, on the interface's clock, to the sample. A browser has no such
 * engine: here the microphone is asked for (the browser shows its own question the first time), with everything the
 * browser would do to a voice on a call switched off (echo cancelling, noise suppression, automatic gain), and what
 * it gives is gathered on the audio thread into memory until Stop. The song plays live meanwhile, through the app's
 * own player, on the same audio clock, so where the song's first beat lies in the recording can be worked out
 * (`webOffset`): close, not to the sample, because no browser says how long the sound takes to come back in. The
 * timing nudge is the correction for that.
 *
 * The finished recording is kept in the browser's own store (takestore.ts), and its takes name it there.
 */
import recUrl from "./webrec.worklet.ts?worker&url";
import { WEBREC_PROCESSOR, joinBlocks, keptChannels, peakOf, type WebBlock } from "./webreccore";
export { WEBREC_BLOCK, WEBREC_PROCESSOR, joinBlocks, keptChannels, peakOf, webOffset, type WebBlock } from "./webreccore";

/** Can this browser record at all? (A page not served safely, or a very old browser, cannot.) */
export const canWebRec = (): boolean =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";

/** Why the microphone could not be had, in plain words. */
export function micProblem(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return "The browser did not allow the microphone";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone found";
  if (name === "NotReadableError" || name === "AbortError") return "The microphone is in use by something else";
  return `The microphone could not be opened (${String((e as { message?: string } | null)?.message ?? e)})`;
}

/** A recording that has ended: its sample rate, the channels kept, and the audio clock at its first frame. */
export interface WebRecording {
  rate: number;
  channels: Float32Array[];
  /** the audio clock (seconds) at the recording's first frame */
  at: number;
}

/** A recording that is running. */
export interface WebRecorder {
  rate: number;
  /** the audio clock at the recording's first frame (null until the first sound has come in) */
  startedAt(): number | null;
  /** how loud a channel is right now, 0 to 1 of full scale (its loudest sample lately) */
  level(ch: number): number;
  /** stop, let go of the microphone, and hand back what was recorded: the channels the track's input asks for */
  stop(): Promise<WebRecording>;
}

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/**
 * Ask for the microphone and start recording it on the context `c` (the app's own, so the recording and the song
 * share one clock). `input`: the track's choice of input, counted from 0 as on an interface: the microphone's first
 * channel, its second, or the two as a stereo pair where it gives two. `mic`: the microphone to use, as the browser
 * names it (none: the browser's own choice). Rejects when the browser refuses the microphone or has none (see
 * `micProblem`).
 */
export async function startWebRec(c: AudioContext, input: { ch: number; pair?: boolean }, mic?: string): Promise<WebRecorder> {
  let ready = loaded.get(c);
  if (!ready) {
    ready = c.audioWorklet.addModule(recUrl);
    loaded.set(c, ready);
    ready.catch(() => loaded.delete(c));
  }
  // nothing a call would want: the sound as it is. Two channels are asked for; a microphone with one gives one
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, ...(mic ? { deviceId: { exact: mic } } : {}) } });
  const letGo = () => stream.getTracks().forEach((t) => t.stop());
  let src: MediaStreamAudioSourceNode;
  let node: AudioWorkletNode;
  try {
    await ready;
    if (c.state === "suspended") await c.resume();
    src = c.createMediaStreamSource(stream);
    node = new AudioWorkletNode(c, WEBREC_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: "max", channelInterpretation: "discrete" });
  } catch (e) {
    letGo();
    throw e;
  }
  /** every block as it came, channel by channel (a channel the microphone stopped giving is silence from then on) */
  const blocks: Float32Array[][] = [];
  let frames = 0;
  let at: number | null = null;
  const peaks: number[] = [];
  let done: (() => void) | null = null;
  node.port.onmessage = (e: MessageEvent) => {
    if (e.data === "done") return done?.();
    const b = e.data as WebBlock;
    if (!b?.channels?.length) return;
    if (at === null) at = b.at;
    b.channels.forEach((ch, i) => {
      // (a channel that comes in only now starts with silence for as long as the others have run)
      (blocks[i] ??= pad(frames)).push(ch);
      // the level falls back slowly from its loudest, so a short sound is seen
      peaks[i] = Math.max(peakOf(ch), (peaks[i] ?? 0) * 0.8);
    });
    // (a channel that was there before and is not in this block: silence for as long)
    for (let i = b.channels.length; i < blocks.length; i++) blocks[i].push(new Float32Array(b.channels[0].length));
    frames += b.channels[0].length;
  };
  src.connect(node);
  return {
    rate: c.sampleRate,
    startedAt: () => at,
    level: (ch) => Math.min(1, peaks[Math.min(ch, peaks.length - 1)] ?? 0),
    stop: async () => {
      // the audio thread hands over what it still holds, then says so (not waited for longer than a moment)
      await new Promise<void>((resolve) => {
        done = resolve;
        node.port.postMessage("stop");
        setTimeout(resolve, 500);
      });
      try {
        src.disconnect();
      } catch {
        /* already apart */
      }
      node.port.onmessage = null;
      letGo();
      const kept = keptChannels(input, Math.max(1, blocks.length));
      return { rate: c.sampleRate, at: at ?? c.currentTime, channels: kept.map((i) => joinBlocks(blocks[i] ?? [], frames)) };
    },
  };
}

/** Silence as long as what was recorded before a channel first came in (so every channel starts on the same frame). */
const pad = (frames: number): Float32Array[] => (frames > 0 ? [new Float32Array(frames)] : []);
