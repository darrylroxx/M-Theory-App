/**
 * The app's own sound through the recording engine, while you hear yourself through the effects.
 *
 * The app plays through the computer's own sound (WASAPI on Windows). Hearing yourself through
 * the effects keeps the recording engine open on the interface directly (ASIO) on every page, and
 * many interfaces' drivers crackle when both play through them at once. So while it is open for
 * that, the app stops playing through the computer's sound (its output goes nowhere: `setSinkId`
 * with no device) and the whole mix, taken after the master's safety stage, goes to the engine in
 * blocks of about 21 ms (through.worklet.ts), which plays it alongside your voice (see the
 * engine's through.rs): one program on the interface, never two. It comes a little later than it
 * would have (the engine keeps about a tenth of a second queued, to ride out a busy page), and
 * the canvas, which paints what is heard, allows for that (outdelay.ts).
 *
 * If this browser cannot send its sound nowhere, or the engine cannot keep up with the page on
 * this computer (it ran dry again and again), the app's sound goes back to the computer's sound,
 * as it was before.
 */
import throughUrl from "./through.worklet.ts?worker&url";
import { audioContext } from "./context";
import { masterOut } from "./mix";
import { setExtraDelay } from "./outdelay";
import { CHUNK, GapWatch, Sender, THROUGH_PROCESSOR } from "./throughcore";

/** The engine's side: start taking the app's sound at a rate, take a block, stop. */
export interface ThroughEngine {
  start(rate: number): Promise<void>;
  feed(bytes: Uint8Array): Promise<number>;
  stop(): Promise<void>;
}

type Sinkable = AudioContext & { sinkId?: string | { type: string }; setSinkId?: (id: string | { type: "none" }) => Promise<void> };

/** Can the app's sound go through the engine in this browser (it can send its own output nowhere, and run a worklet)? */
export function canGoThrough(c: BaseAudioContext): boolean {
  return typeof (c as Sinkable).setSinkId === "function" && !!(c as { audioWorklet?: unknown }).audioWorklet && typeof AudioWorkletNode !== "undefined";
}

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();
let live: { c: Sinkable; node: AudioWorkletNode; sender: Sender; engine: ThroughEngine; watch: GapWatch } | null = null;
let starting: Promise<boolean> | null = null;
/** it could not keep up on this computer: not tried again until the app is opened again */
let gaveUp = false;
/** the computer's sound the app was playing through before (its device: "" is the computer's default) */
let wasSink = "";
let retry: ReturnType<typeof setTimeout> | undefined;

/** Is the app's sound going through the engine now? */
export const goingThrough = () => live !== null;

/**
 * From now on the app's sound goes through the engine (the engine must be open). Resolves true
 * once it does, false where it cannot (the computer's sound is left as it was).
 */
export function goThrough(engine: ThroughEngine): Promise<boolean> {
  if (live) return Promise.resolve(true);
  if (starting) return starting;
  starting = start(engine).finally(() => (starting = null));
  return starting;
}

async function start(engine: ThroughEngine): Promise<boolean> {
  if (gaveUp) return false;
  const c = audioContext() as Sinkable;
  if (!canGoThrough(c)) return false;
  let node: AudioWorkletNode | null = null;
  try {
    let ready = loaded.get(c);
    if (!ready) {
      ready = c.audioWorklet.addModule(throughUrl);
      loaded.set(c, ready);
      ready.catch(() => loaded.delete(c));
    }
    await ready;
    await engine.start(c.sampleRate);
    node = new AudioWorkletNode(c, THROUGH_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: "explicit", processorOptions: { chunk: CHUNK } });
    const sender = new Sender((b) => engine.feed(b), c.sampleRate, () => void comeBack());
    sender.onDelay = setExtraDelay;
    node.port.onmessage = (e: MessageEvent) => sender.send(e.data as Float32Array);
    masterOut(c).connect(node);
    live = { c, node, sender, engine, watch: new GapWatch() };
    // the computer's sound is let go of last: until the engine has the first blocks, it still plays there
    clearTimeout(retry);
    if (typeof c.sinkId === "string") wasSink = c.sinkId;
    await c.setSinkId!({ type: "none" });
    return true;
  } catch {
    // (it could not: the computer's sound as before)
    if (live) await comeBack();
    else {
      node?.port.postMessage("stop");
      await engine.stop().catch(() => {});
    }
    return false;
  }
}

/** The app's sound goes back to the computer's sound (the engine closing, or hearing yourself through the effects turned off). */
export async function comeBack(): Promise<void> {
  if (starting) await starting.catch(() => false);
  const l = live;
  live = null;
  if (!l) return;
  // the computer's sound first, so the song is heard again as soon as it can be; then the engine lets go (fading out)
  await backToComputer(l.c);
  l.node.port.onmessage = null;
  l.sender.onDelay = null;
  l.node.port.postMessage("stop");
  try {
    masterOut(l.c).disconnect(l.node);
  } catch {
    /* already let go */
  }
  l.sender.close();
  setExtraDelay(0);
  await l.engine.stop().catch(() => {});
}

/**
 * Back to the computer's sound: the device it played through before, else the computer's
 * default. If neither will take it just now (the device was unplugged, say), it is tried again
 * every two seconds, for the app must never be left without a sound.
 */
async function backToComputer(c: Sinkable): Promise<void> {
  clearTimeout(retry);
  for (const id of new Set([wasSink, ""])) {
    try {
      await c.setSinkId!(id);
      return;
    } catch {
      /* the next, or again in a moment */
    }
  }
  retry = setTimeout(() => {
    if (!live && !starting) void backToComputer(c);
  }, 2000);
}

/**
 * The engine's count of times the app's sound ran dry (from its status, about 30 times a
 * second): if the page cannot keep it fed on this computer, the app's sound goes back to the
 * computer's sound for the rest of the session.
 */
export function noteGaps(gaps: number | undefined, t = performance.now() / 1000): void {
  if (!live || !live.watch.note(gaps, t)) return;
  gaveUp = true;
  void comeBack();
}
