/**
 * Listening to the app's own sound as it plays: an ear on the point every sound passes (the
 * whole mix), and one on each of the song's tracks (`bank.ts`), all in one audio node.
 *
 * A tap is any audio node: a track's fader today; a drum track's own output, when added drum
 * tracks have one, can be tapped the same way.
 */
import { blockFrames } from "../audio/context";
import { master } from "../audio/mix";
import type { Frame } from "./ear";
import type { BankInput, BankOut } from "./bank";
import earUrl from "./ear.worklet.ts?worker&url";

/** Something to listen to: the nodes whose sound is heard together, and whether the notes are known (so only the texture is wanted). */
export interface Tap {
  key: string;
  nodes: AudioNode[];
  light: boolean;
}

export interface Listening {
  /** What has been heard since the last call (times are on the audio clock): the whole mix, and each tap by its key. */
  take(): { mix: Frame[]; taps: Map<string, Frame[]> };
  stop(): void;
}

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** Start listening to everything the app plays, and to each tap. Null where the browser cannot (very old ones). */
export async function listenLive(c: AudioContext, taps: Tap[] = []): Promise<Listening | null> {
  if (!c.audioWorklet || typeof AudioWorkletNode === "undefined") return null;
  try {
    let ready = loaded.get(c);
    if (!ready) {
      ready = c.audioWorklet.addModule(earUrl);
      loaded.set(c, ready);
    }
    await ready;
    const inputs: BankInput[] = [{ key: "mix", light: false }, ...taps.map((t) => ({ key: t.key, light: t.light }))];
    const node = new AudioWorkletNode(c, "m-theory-ears", {
      numberOfInputs: inputs.length,
      numberOfOutputs: 0,
      channelCount: 2,
      channelCountMode: "explicit",
      processorOptions: { inputs, block: blockFrames(c) },
    });
    let mix: Frame[] = [];
    let byTap = new Map<string, Frame[]>();
    let held = 0;
    node.port.onmessage = (e: MessageEvent<BankOut[]>) => {
      for (const o of e.data) {
        if (o.key === "mix") for (const f of o.frames) mix.push(f);
        else {
          let list = byTap.get(o.key);
          if (!list) byTap.set(o.key, (list = []));
          for (const f of o.frames) list.push(f);
        }
        held += o.frames.length;
      }
      // nobody is collecting: do not let them pile up
      if (held > 4000) {
        mix = mix.slice(-200);
        for (const [k, v] of byTap) byTap.set(k, v.slice(-200));
        held = 0;
      }
    };
    const from = master(c);
    from.connect(node, 0, 0);
    const wired: [AudioNode, number][] = [];
    taps.forEach((t, i) => {
      for (const n of t.nodes) {
        n.connect(node, 0, i + 1);
        wired.push([n, i + 1]);
      }
    });
    return {
      take() {
        const out = { mix, taps: byTap };
        mix = [];
        byTap = new Map();
        held = 0;
        return out;
      },
      stop() {
        node.port.postMessage("stop");
        try {
          from.disconnect(node);
        } catch {
          // already gone
        }
        for (const [n, i] of wired) {
          try {
            n.disconnect(node, 0, i);
          } catch {
            // already gone
          }
        }
      },
    };
  } catch {
    loaded.delete(c);
    return null;
  }
}
