import { loadSafety } from "./safety";

/** The one Web Audio context shared by the guitar and the drums. */
let ctx: AudioContext | null = null;

/** While the song is being rendered offline (for the recording engine), sounds are made there instead. */
let rendering: BaseAudioContext | null = null;
export const isRendering = () => rendering !== null;
export function withContext<T>(c: BaseAudioContext, fn: () => T): T {
  const was = rendering;
  rendering = c;
  try {
    return fn();
  } finally {
    rendering = was;
  }
}

export function audioContext(): AudioContext {
  if (rendering) return rendering as AudioContext;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = openLive(AC);
    // the master's safety limiter starts loading as the sound opens (see mix.ts master)
    void loadSafety(ctx);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/**
 * How many frames of sound the browser works out in one go on a context (a "block"). 128 where
 * nothing else was asked for, as it always was; the live context asks for larger ones where the
 * browser lets it (see `openLive`).
 */
export function blockFrames(c: BaseAudioContext): number {
  const q = (c as { renderQuantumSize?: number }).renderQuantumSize;
  return typeof q === "number" && q >= 1 ? Math.round(q) : 128;
}

/**
 * An echo that feeds itself comes round one block later than its delay says: the browser hands
 * the delay what the loop put out a block ago. In blocks of 128 that is 3 ms, and it has always
 * been part of every echo's timing (in a WAV too). In larger blocks the loop would come round that
 * much later still, so the delay in the loop is made shorter by the difference (this many
 * seconds), and every repeat falls on the very frame it always did.
 */
export const loopLag = (c: BaseAudioContext): number => (blockFrames(c) - 128) / c.sampleRate;

/** The longest block the engine is worked out in (seconds): well under the shortest echo (a sixteenth at the fastest tempo, 75 ms), which must stay longer than a block. */
export const MAX_BLOCK = 0.03;

/**
 * The block to ask for, given how much sound the sound card is handed at a time (`handed`,
 * frames): that many, so each hand-over is worked out in one block instead of several; halved
 * while that is over MAX_BLOCK; 0 (ask for nothing: blocks of 128) when it is no gain or not a
 * whole number of frames.
 */
export function blockFor(handed: number, rate: number): number {
  let q = Math.round(handed);
  if (!(rate > 0) || !Number.isFinite(handed) || Math.abs(q - handed) > 0.01) return 0;
  while (q / rate > MAX_BLOCK && q % 2 === 0) q /= 2;
  return q > 128 && q / rate <= MAX_BLOCK ? q : 0;
}

/**
 * Open the live context.
 *
 * With the larger of the browser's buffers ('playback': about 20 ms instead of 10): a spike on
 * the audio thread (a busy moment, the system's own drivers) is then absorbed instead of heard as
 * a crackle. Nothing needs less: the song is booked a quarter of a second ahead, takes and the
 * recording engine's backing are on the audio clock, and a sound tapped to be heard comes a
 * hundredth of a second later, which nobody notices.
 *
 * And, where the browser can, worked out in blocks as long as that buffer. The browser fills the
 * buffer in one go either way; by default it does so 128 frames at a time, calling on every node
 * of every track eight times for one buffer of about a thousand frames, and most of what a small
 * node costs is being called on at all. One block per buffer is the same sound for about a third
 * less of the audio thread's time (measured: see the notes on the track limit). Nothing is
 * delayed by it: the buffer is the size it would have been, which is checked, and a context that
 * comes out otherwise is not used. The one thing a block's length is heard in, an echo's loop, is
 * set right for it (see `loopLag`). An offline render always works in blocks of 128.
 */
function openLive(AC: typeof AudioContext): AudioContext {
  const plain = new AC({ latencyHint: "playback" });
  if (!("renderQuantumSize" in plain)) return plain;
  const want = blockFor(plain.baseLatency * plain.sampleRate, plain.sampleRate);
  if (!want) return plain;
  let big: AudioContext | null = null;
  try {
    big = new AC({ latencyHint: "playback", renderSizeHint: want } as AudioContextOptions);
    // (the same buffer, the same rate, and the block that was asked for: otherwise as it always was)
    if (blockFrames(big) === want && big.sampleRate === plain.sampleRate && Math.abs(big.baseLatency - plain.baseLatency) < 1e-4) {
      void plain.close().catch(() => {});
      return big;
    }
  } catch {
    /* a browser that will not: as it always was */
  }
  void big?.close().catch(() => {});
  return plain;
}

/**
 * The soonest moment a change made now can start to be heard. The audio thread works a whole
 * buffer ahead of the clock the page reads (about 20 ms with the 'playback' buffer), so a fade
 * booked from the clock's "now" can already be partly past when it is worked out, and start with
 * a jump: a click, the very thing it is there to prevent. A fade at ■ starts here instead. (An
 * offline render's clock is exact.)
 */
export function soonest(c: BaseAudioContext): number {
  const ahead = (c as AudioContext).baseLatency;
  // (a context that does not say how far ahead it works: its clock, as before)
  if ("startRendering" in c || typeof ahead !== "number" || !Number.isFinite(ahead) || ahead <= 0) return c.currentTime;
  return c.currentTime + ahead + 0.003;
}

/** The context if sound has already started, without starting it. */
export const audioIfStarted = (): AudioContext | null => ctx;

/**
 * Do something at a moment of an offline render (a section's own room, say). An offline render
 * runs as fast as it can, so a timer would land at a different place on every export: instead
 * the render is paused at exactly that moment (`OfflineAudioContext.suspend`), the change is made,
 * and it carries on. Everything asked for at one moment shares one pause. Returns false when the
 * moment cannot be reached this way (a live context, a browser that cannot pause a render, or a
 * moment past the end); the caller then makes the change some other way, or not at all.
 */
type Suspendable = BaseAudioContext & { suspend?: (t: number) => Promise<void>; resume?: () => Promise<void>; length?: number };
const pauses = new WeakMap<BaseAudioContext, Map<number, (() => void)[]>>();
export function atRenderTime(c: BaseAudioContext, t: number, fn: () => void): boolean {
  const off = c as Suspendable;
  const isOffline = "startRendering" in c;
  if (!isOffline || typeof off.suspend !== "function" || typeof off.resume !== "function") return false;
  // a render pauses only on the edge of a block (128 frames): the moment is rounded to the one it would land on
  const block = blockFrames(c);
  const frame = Math.max(0, Math.round((t * c.sampleRate) / block) * block);
  if (typeof off.length === "number" && frame >= off.length) return false;
  if (frame === 0) {
    fn();
    return true;
  }
  let at = pauses.get(c);
  if (!at) pauses.set(c, (at = new Map()));
  const list = at.get(frame);
  if (list) {
    list.push(fn);
    return true;
  }
  const jobs = [fn];
  at.set(frame, jobs);
  off.suspend(frame / c.sampleRate).then(
    () => {
      for (const j of jobs) j();
      void off.resume!();
    },
    () => {
      /* the render cannot pause there: the change is not made */
    },
  );
  return true;
}
