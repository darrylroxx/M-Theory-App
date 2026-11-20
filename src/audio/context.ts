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
    // the larger of the browser's buffers ('playback': about 20 ms instead of 10): a spike on the
    // audio thread (a busy moment, the system's own drivers) is then absorbed instead of heard as a
    // crackle. Nothing needs less: the song is booked a quarter of a second ahead, takes and the
    // recording engine's backing are on the audio clock, and a sound tapped to be heard comes a
    // hundredth of a second later, which nobody notices.
    ctx = new AC({ latencyHint: "playback" });
    // the master's safety limiter starts loading as the sound opens (see mix.ts master)
    void loadSafety(ctx);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
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
  // a render pauses only on the edge of a block of 128 frames: the moment is rounded to the one it would land on
  const frame = Math.max(0, Math.round((t * c.sampleRate) / 128) * 128);
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
