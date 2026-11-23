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
 * would have (the engine keeps about a sixth of a second queued, to ride out a busy page), and
 * the canvas, which paints what is heard, allows for that (outdelay.ts).
 *
 * The hand-over is never heard twice and never clicks: the mix fades out (a hundredth of a
 * second), the computer's sound is let go of, and only then does anything go to the engine, which
 * fades it in once it has enough queued. Coming back is the other way round: the mix fades out,
 * the computer's sound is taken back, the engine fades out what it still holds, the mix fades in.
 *
 * If this browser cannot send its sound nowhere, or the engine cannot keep up with the page on
 * this computer (it ran dry again and again), the app's sound goes back to the computer's sound,
 * as it was before.
 */
import throughUrl from "./through.worklet.ts?worker&url";
import { audioContext, blockFrames, soonest } from "./context";
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

/** How long the mix fades out and back in around a hand-over (seconds): the switch is never heard as a click. */
export const SWITCH_FADE = 0.012;
/** How long the engine is given to fade out what it holds before it may be closed (milliseconds). */
export const LET_GO_MS = 30;

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The longest a fade is waited for (milliseconds): an audio thread held up does not hold up the hand-over for long. */
const FADE_WAIT_MS = 250;

/**
 * The very end of the mix fades to `to` (0: silent, 1: as it is) from the soonest moment the
 * audio thread has not yet worked out; resolves once the fade is over on the audio clock (which,
 * on a busy computer, can fall behind the page's).
 */
async function fadeEnd(c: BaseAudioContext, to: 0 | 1): Promise<void> {
  const g = masterOut(c).gain;
  const at = soonest(c);
  g.cancelScheduledValues(at);
  g.setValueAtTime(Number.isFinite(g.value) ? g.value : 1 - to, at);
  g.linearRampToValueAtTime(to, at + SWITCH_FADE);
  const until = at + SWITCH_FADE;
  const t0 = Date.now();
  await pause(Math.max(0, until - c.currentTime) * 1000 + 2);
  while (c.currentTime < until && Date.now() - t0 < FADE_WAIT_MS) await pause(4);
}

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
  let faded = false;
  try {
    let ready = loaded.get(c);
    if (!ready) {
      ready = c.audioWorklet.addModule(throughUrl);
      loaded.set(c, ready);
      ready.catch(() => loaded.delete(c));
    }
    await ready;
    await engine.start(c.sampleRate);
    node = new AudioWorkletNode(c, THROUGH_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: "explicit", processorOptions: { chunk: CHUNK, block: blockFrames(c) } });
    const sender = new Sender((b) => engine.feed(b), c.sampleRate, () => void comeBack());
    sender.onDelay = setExtraDelay;
    // (nothing goes to the engine while the computer's sound still plays it: it would be heard twice)
    let held = true;
    node.port.onmessage = (e: MessageEvent) => {
      // (the tap waits for this before it sends more than a couple: see Outbox)
      node!.port.postMessage("ack");
      if (!held) sender.send(e.data as Float32Array);
    };
    masterOut(c).connect(node);
    live = { c, node, sender, engine, watch: new GapWatch() };
    clearTimeout(retry);
    if (typeof c.sinkId === "string") wasSink = c.sinkId;
    // the mix fades out, the computer's sound is let go of in silence, and the mix comes back up for the engine alone
    faded = true;
    await fadeEnd(c, 0);
    await c.setSinkId!({ type: "none" });
    held = false;
    faded = false;
    void fadeEnd(c, 1);
    return true;
  } catch {
    // (it could not: the computer's sound as before. Not by way of comeBack, which would wait for this very start)
    if (live) await letGo();
    else {
      node?.port.postMessage("stop");
      await engine.stop().catch(() => {});
      if (faded) void fadeEnd(c, 1);
    }
    return false;
  }
}

/**
 * The app's sound goes back to the computer's sound (the engine closing, or hearing yourself
 * through the effects turned off): the mix fades out, the computer's sound is taken back, the
 * engine fades out what it still holds, and the mix fades back in. Resolves once the engine has
 * let go, so it may be closed.
 */
export async function comeBack(): Promise<void> {
  if (starting) await starting.catch(() => false);
  return letGo();
}
async function letGo(): Promise<void> {
  const l = live;
  live = null;
  if (!l) return;
  await fadeEnd(l.c, 0);
  try {
    await backToComputer(l.c);
  } finally {
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
    void fadeEnd(l.c, 1);
    // (the engine fades out on its own audio thread: a moment for it before anything closes it)
    await pause(LET_GO_MS);
  }
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
