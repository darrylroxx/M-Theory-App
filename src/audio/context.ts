/** The one Web Audio context shared by the guitar and the drums. */
let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** The context if sound has already started, without starting it. */
export const audioIfStarted = (): AudioContext | null => ctx;
