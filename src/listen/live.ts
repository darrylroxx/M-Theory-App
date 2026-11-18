/** Listening to the app's own sound as it plays: an ear on the point every sound passes. */
import { master } from "../audio/mix";
import type { Frame } from "./ear";
import earUrl from "./ear.worklet.ts?worker&url";

export interface Listening {
  /** What has been heard since the last call (times are on the audio clock). */
  take(): Frame[];
  stop(): void;
}

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** Start listening to everything the app plays. Null where the browser cannot (very old ones). */
export async function listenLive(c: AudioContext): Promise<Listening | null> {
  if (!c.audioWorklet || typeof AudioWorkletNode === "undefined") return null;
  try {
    let ready = loaded.get(c);
    if (!ready) {
      ready = c.audioWorklet.addModule(earUrl);
      loaded.set(c, ready);
    }
    await ready;
    const node = new AudioWorkletNode(c, "m-theory-ear", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: "explicit" });
    let frames: Frame[] = [];
    node.port.onmessage = (e: MessageEvent<Frame[]>) => {
      for (const f of e.data) frames.push(f);
      // nobody is collecting: do not let them pile up
      if (frames.length > 1000) frames = frames.slice(-200);
    };
    const from = master(c);
    from.connect(node);
    return {
      take() {
        const out = frames;
        frames = [];
        return out;
      },
      stop() {
        node.port.postMessage("stop");
        try {
          from.disconnect(node);
        } catch {
          // already gone
        }
      },
    };
  } catch {
    loaded.delete(c);
    return null;
  }
}
