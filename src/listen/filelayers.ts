/**
 * The page's side of hearing a song from a file layer by layer: the song is handed to a worker
 * (`layers.worker.ts`) as soon as it is opened, and what each layer did comes back, well ahead
 * of where the song is playing, and is kept (`store.ts`) until the painting asks for it.
 *
 * A trained model's stems (the desktop app's engine writes each stem to a file and says how far
 * all of them are ready) can take over at any time: `useStems` says which stems, at what rate,
 * and from which second of the song; `pushStems` hands over each stretch as it is read from the
 * files (in order, every stem the same length); `endStems` says they are complete. Wherever
 * they have been heard, the painting is made from them instead of the quick split.
 */
import type { Frame } from "./ear";
import type { StemStretch } from "./pushed";
import type { Song } from "./songfile";
import type { StemName } from "./split";
import { LayerStore } from "./store";
import type { FromWorker, ToWorker } from "./layers.worker";
import type { LayerKind } from "../canvas/layers";
import LayersWorker from "./layers.worker.ts?worker";

let next = 1;

export class FileLayers {
  private readonly worker: Worker | null;
  private readonly id = next++;
  private readonly store = new LayerStore();
  /** which handing over of a model's stems is the current one */
  private pass = 0;
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
    this.post({ type: "open", id: this.id, sr: b.sampleRate, left, right, ref: song.ref }, [left.buffer, right.buffer]);
  }

  private post(m: ToWorker, transfer: Transferable[] = []) {
    this.worker?.postMessage(m, transfer);
  }

  private take(m: FromWorker) {
    if (m.id !== this.id) return;
    if (m.type === "failed") this.failed = true;
    else if (m.type === "vibe") {
      this.vibe = m.fp;
      this.vibeFinal = m.final;
      this.bpm = m.bpm;
    } else if (m.type === "heard") this.store.addFirst(m.mix, m.layers, m.to);
    else if (m.type === "better" && m.pass === this.pass) this.store.addBetter(m.layers, m.to);
  }

  /** How far into the song everything has been heard (seconds). */
  get heardTo() {
    return this.store.heardTo;
  }
  /** How far a model's stems have been heard, from where they took over (null: none). */
  get stemsSpan() {
    return this.store.betterSpan;
  }
  /** How far into the song the model's stems have been heard (seconds): whoever reads them reads only a little beyond. */
  stemsHeard() {
    return this.store.betterSpan?.to ?? 0;
  }

  /**
   * A trained model's stems take over from `from` seconds of the song (0: all of it): `names` are
   * the stems that will be handed over, `rate` their sample rate (the song's, as the engine
   * decoded it; it may differ from the page's).
   */
  useStems(names: StemName[], rate: number, from = 0) {
    this.pass++;
    this.store.beginBetter(Math.max(0, from));
    this.post({ type: "stems", id: this.id, pass: this.pass, names, rate, from: Math.max(0, from) });
  }
  /**
   * The model's stems from frame `at` (at their own rate) on, each as its channels (left and
   * right): every stem the same number of frames, handed over in order as the engine makes
   * them. (The arrays are handed to the worker: they are not usable here afterwards.)
   */
  pushStems(at: number, stretch: StemStretch) {
    const transfer: Transferable[] = [];
    for (const ch of Object.values(stretch)) for (const c of ch ?? []) if (!transfer.includes(c.buffer)) transfer.push(c.buffer);
    this.post({ type: "stem-data", id: this.id, at, stretch }, transfer);
  }
  /**
   * `pushStems` for stems as the engine wrote them (each stem's channels interleaved, 32-bit
   * floats): they are handed to the worker as they are and taken apart there, so the page does
   * no work on them. (The buffers are handed over: not usable here afterwards.)
   */
  pushRaw(at: number, raw: Partial<Record<StemName, ArrayBuffer>>, channels = 2) {
    const transfer = [...new Set(Object.values(raw).filter((b): b is ArrayBuffer => !!b))];
    this.post({ type: "stem-raw", id: this.id, at, raw, channels }, transfer);
  }
  /** Every stem of the model has been handed over. */
  endStems() {
    this.post({ type: "stems-end", id: this.id });
  }
  /** The model's stems stop where they got to (the split was stopped or failed): the quick split paints the rest. */
  stopStems() {
    this.post({ type: "stems-stop", id: this.id });
  }

  /** Is everything up to `t` seconds heard? */
  ready(t: number) {
    return !this.failed && this.store.ready(t);
  }

  /** What was heard after `from` up to `to` seconds: the whole mix, and each layer. */
  between(from: number, to: number): { mix: Frame[]; ears: { key: string; layer: LayerKind; frames: Frame[] }[] } {
    return this.store.between(from, to);
  }

  close() {
    this.post({ type: "close" });
    this.worker?.terminate();
  }
}
