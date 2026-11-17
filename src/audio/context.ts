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
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** The context if sound has already started, without starting it. */
export const audioIfStarted = (): AudioContext | null => ctx;
