/**
 * What was heard of a song from a file, layer by layer, kept in time order until the painting
 * asks for it (`filelayers.ts` fills it from its worker).
 *
 * There can be two hearings of the layers: the first from the quick split, ready almost at once;
 * and, later, a better one from a trained model's stems (`pushed.ts`), which begins at some point
 * of the song and is heard up to wherever the model has got. A stretch the better hearing covers
 * is painted from it; anything else from the first.
 */
import type { Frame } from "./ear";
import type { LayerFrames } from "./layers";
import type { LayerKind } from "../canvas/layers";

/** Frames kept in time order, handed out by time. */
export class FrameTrack {
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

/** One hearing of the layers: a track for each, and how far it has been heard. */
class Hearing {
  readonly tracks = new Map<string, FrameTrack>();
  /** heard from here (seconds) up to `to` */
  constructor(readonly from: number, public to = from) {}
  add(layers: LayerFrames[], to: number) {
    for (const lf of layers) {
      let t = this.tracks.get(lf.key);
      if (!t) this.tracks.set(lf.key, (t = new FrameTrack(lf.key, lf.layer)));
      for (const f of lf.frames) t.frames.push(f);
    }
    this.to = Math.max(this.to, to);
  }
  covers(from: number, to: number) {
    return from >= this.from - 1e-6 && to <= this.to;
  }
}

export class LayerStore {
  private readonly mix = new FrameTrack("mix", "other");
  private first = new Hearing(0);
  private better: Hearing | null = null;

  /** How far the whole song (the mix and the first hearing of its layers) has been heard, seconds. */
  get heardTo() {
    return this.first.to;
  }
  /** From where, and up to where, a model's stems have been heard (null: none yet). */
  get betterSpan(): { from: number; to: number } | null {
    return this.better ? { from: this.better.from, to: this.better.to } : null;
  }

  /** The first hearing: the mix and the quick split's layers, heard up to `to` seconds. */
  addFirst(mix: Frame[], layers: LayerFrames[], to: number) {
    for (const f of mix) this.mix.frames.push(f);
    this.first.add(layers, to);
  }
  /** A model's stems take over from `from` seconds (anything heard of them before is let go of). */
  beginBetter(from: number) {
    this.better = new Hearing(from);
  }
  /** More of what a model's stems held, heard up to `to` seconds. */
  addBetter(layers: LayerFrames[], to: number) {
    this.better?.add(layers, to);
  }

  /** Is everything up to `t` seconds heard (by either hearing)? */
  ready(t: number) {
    return this.first.to >= t || (!!this.better && this.better.from <= 0 && this.better.to >= t);
  }

  /** What was heard after `from` up to `to` seconds: the whole mix, and each layer (from the better hearing, where it reaches). */
  between(from: number, to: number): { mix: Frame[]; ears: { key: string; layer: LayerKind; frames: Frame[] }[]; better: boolean } {
    const use = this.better && this.better.covers(from, to) ? this.better : this.first;
    // (the other hearing's tracks are moved along too, so each finds its place quickly when it is used again)
    const other = use === this.first ? this.better : this.first;
    if (other) for (const t of other.tracks.values()) t.between(from, to);
    return {
      mix: this.mix.between(from, to),
      ears: [...use.tracks.values()].map((t) => ({ key: t.key, layer: t.layer, frames: t.between(from, to) })),
      better: use !== this.first,
    };
  }
}
