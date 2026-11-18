/**
 * The page's side of hearing a song from a file layer by layer: the song is handed to a worker
 * (`layers.worker.ts`) as soon as it is opened, and what each layer did comes back, well ahead
 * of where the song is playing, and is kept here until the painting asks for it.
 */
import type { Frame } from "./ear";
import type { LayerFrames } from "./layers";
import type { Song } from "./songfile";
import type { FromWorker, ToWorker } from "./layers.worker";
import type { LayerKind } from "../canvas/layers";
import LayersWorker from "./layers.worker.ts?worker";

let next = 1;

/** Frames kept in time order, handed out by time. */
class Track {
  frames: Frame[] = [];
  /** where the last asking ended */
  private cursor = 0;
  constructor(readonly key: string, readonly layer: LayerKind) {}
  /** The frames after `from` up to `to` (seconds). */
  between(from: number, to: number): Frame[] {
    const fs = this.frames;
    // the song went back: look again from the start
    if (this.cursor > 0 && (this.cursor > fs.length || fs[this.cursor - 1].t > from)) this.cursor = 0;
    let i = this.cursor;
    while (i < fs.length && fs[i].t <= from) i++;
    const out: Frame[] = [];
    while (i < fs.length && fs[i].t <= to) out.push(fs[i++]);
    this.cursor = i;
    return out;
  }
}

export class FileLayers {
  private readonly worker: Worker | null;
  private readonly id = next++;
  private readonly mix = new Track("mix", "other");
  private readonly tracks = new Map<string, Track>();
  /** how far into the song everything has been heard (seconds) */
  heardTo = 0;
  /** the song's vibe, as far as it is known, and whether it is the whole song's */
  vibe: Float32Array | null = null;
  vibeFinal = false;
  bpm = 0;
  failed = false;

  constructor(song: Song) {
    let w: Worker | null = null;
    try {
      w = new LayersWorker();
    } catch {
      w = null;
    }
    this.worker = w;
    if (!w) {
      this.failed = true;
      return;
    }
    w.onmessage = (e: MessageEvent<FromWorker>) => this.take(e.data);
    w.onerror = () => (this.failed = true);
    const b = song.buffer;
    const left = b.getChannelData(0).slice();
    const right = (b.numberOfChannels > 1 ? b.getChannelData(1) : b.getChannelData(0)).slice();
    const msg: ToWorker = { type: "open", id: this.id, sr: b.sampleRate, left, right, ref: song.ref };
    w.postMessage(msg, [left.buffer, right.buffer]);
  }

  private take(m: FromWorker) {
    if (m.id !== this.id) return;
    if (m.type === "failed") this.failed = true;
    else if (m.type === "vibe") {
      this.vibe = m.fp;
      this.vibeFinal = m.final;
      this.bpm = m.bpm;
    } else if (m.type === "heard") {
      for (const f of m.mix) this.mix.frames.push(f);
      for (const lf of m.layers as LayerFrames[]) {
        let t = this.tracks.get(lf.key);
        if (!t) this.tracks.set(lf.key, (t = new Track(lf.key, lf.layer)));
        for (const f of lf.frames) t.frames.push(f);
      }
      this.heardTo = m.to;
    }
  }

  /** Is everything up to `t` seconds heard? */
  ready(t: number) {
    return !this.failed && this.heardTo >= t;
  }

  /** What was heard after `from` up to `to` seconds: the whole mix, and each layer. */
  between(from: number, to: number): { mix: Frame[]; ears: { key: string; layer: LayerKind; frames: Frame[] }[] } {
    return {
      mix: this.mix.between(from, to),
      ears: [...this.tracks.values()].map((t) => ({ key: t.key, layer: t.layer, frames: t.between(from, to) })),
    };
  }

  close() {
    this.worker?.postMessage({ type: "close" } satisfies ToWorker);
    this.worker?.terminate();
  }
}
