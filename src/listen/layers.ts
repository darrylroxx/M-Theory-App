/**
 * A song from a file, heard layer by layer, ahead of playing it.
 *
 * The song is split into stems (`split.ts`, or a model's stems through the same `StemSource`),
 * and an ear listens to each, as the ear on the whole mix does: the drums (only their hits and
 * noise: an ear that does not follow tones, which is cheaper), the bass, the vocals, and the
 * rest, whose tones are shared out into chords and melody and whose noise is the fog
 * (`route.ts`). Every ear reads levels against the loudness of the whole mix, so a quiet layer
 * is painted quietly. An ear on the whole mix gives the mood, the key and the vibe.
 *
 * It all runs in a worker (`layers.worker.ts`), well ahead of where the song is playing, so
 * every mark can be laid exactly when its sound is heard; the whole song is heard once, and its
 * vibe is known by the end of it (and a first estimate long before).
 */
import { Ear, type Frame } from "./ear";
import { VoiceRouter } from "./route";
import type { StemChunk, StemId, StemSource, Stereo } from "./split";
import type { LayerKind } from "../canvas/layers";
import { VibeMeter, ROLE_ORDER } from "../canvas/vibe";

/** What one source (a stem, or a part of one) gave to one layer. */
export interface LayerFrames {
  key: string;
  layer: LayerKind;
  frames: Frame[];
}

/** A stretch of the song, heard. */
export interface Heard {
  /** seconds of the song heard so far (everything before this is final) */
  to: number;
  mix: Frame[];
  layers: LayerFrames[];
}

const EMPTY_CHROMA = new Float32Array(12);
/** A layer's frame without what only the whole mix needs (it is posted from a worker a hundred times a second). */
function slim(f: Frame): Frame {
  return { t: f.t, voices: f.voices, ended: f.ended, hits: f.hits, noise: f.noise, level: f.level, db: f.db, centroid: f.centroid, flat: f.flat, flux: f.flux, chroma: EMPTY_CHROMA };
}

/** How loud a layer is, 0..1, on the canvas's fixed scale (−50 dBFS is nothing, −14 is loud). */
export const levelOfDb = (db: number) => Math.max(0, Math.min(1, (db + 50) / 36));

export class LayerAnalysis {
  readonly sr: number;
  readonly duration: number;
  private readonly song: Stereo;
  private readonly source: StemSource;
  private readonly ref: number;
  private mixEar: Ear;
  private ears: Record<StemId, Ear>;
  /** the rest is shared out into chords, melody and fog; the bass's and the voice's overtones are marked */
  private routers: Record<"bass" | "vocals" | "other", VoiceRouter> = { bass: new VoiceRouter({ only: "bass" }), vocals: new VoiceRouter({ only: "vocals" }), other: new VoiceRouter({ fog: "other" }) };
  private at = 0;
  private stemAt = 0;
  /** the vibe of everything heard so far */
  readonly vibe = new VibeMeter();
  private mono: Float32Array;
  done = false;

  /** `ref`: how loud the loudest parts of the song are (as `loudest` measures), so the whole song is read on one scale. */
  constructor(song: Stereo, source: StemSource, ref: number) {
    this.song = song;
    this.sr = song.sr;
    this.duration = song.left.length / song.sr;
    this.source = source;
    this.ref = ref;
    this.mono = new Float32Array(song.left.length);
    for (let i = 0; i < this.mono.length; i++) this.mono[i] = 0.5 * (song.left[i] + song.right[i]);
    this.mixEar = new Ear(this.sr, ref);
    this.ears = this.fresh();
  }

  private fresh(): Record<StemId, Ear> {
    const { sr, ref } = this;
    return { drums: new Ear(sr, ref, { light: true, phase: 0.2 }), bass: new Ear(sr, ref, { phase: 0.4 }), vocals: new Ear(sr, ref, { phase: 0.6 }), other: new Ear(sr, ref, { phase: 0.8 }) };
  }

  async prepare(progress?: (f: number) => void) {
    await this.source.prepare(this.song, progress);
    this.source.seek(0);
  }

  /** Hear the next `seconds` of the song (null once it is all heard). */
  async step(seconds: number): Promise<Heard | null> {
    if (this.done) return null;
    const n = Math.round(seconds * this.sr);
    const end = Math.min(this.mono.length, this.at + n);
    const mix: Frame[] = [];
    this.mixEar.push(this.mono.subarray(this.at, end), mix);
    this.at = end;
    const layers: LayerFrames[] = [];
    // stems for (at least) as far as the mix has been heard
    while (this.stemAt < this.at || (this.at >= this.mono.length && !this.done)) {
      const c = await this.source.next(this.at - this.stemAt + 4096);
      if (!c) {
        this.done = this.at >= this.mono.length;
        break;
      }
      if (c.length) {
        this.hearStems(c, layers);
        this.stemAt = c.from + c.length;
      }
    }
    for (const f of mix) this.vibe.take(f);
    this.roles(layers);
    if (this.at >= this.mono.length && this.stemAt >= this.mono.length) this.done = true;
    // (the routers hold back a tenth of a second, to hear a note whose overtones came first)
    return { to: this.done ? this.duration : Math.max(0, Math.min(this.at, this.stemAt) / this.sr - 0.12), mix, layers };
  }

  private hearStems(c: StemChunk, out: LayerFrames[]) {
    const take = (key: string, layer: LayerKind): Frame[] => {
      let e = out.find((x) => x.key === key);
      if (!e) out.push((e = { key, layer, frames: [] }));
      return e.frames;
    };
    const ref = this.mixEar.loudest;
    for (const id of ["drums", "bass", "vocals", "other"] as StemId[]) {
      const ear = this.ears[id];
      // a stem is heard against the loudness of the whole mix
      ear.hold(ref);
      const frames = ear.push(c.stems[id]);
      if (id === "drums") {
        for (const f of frames) take(id, id).push(slim(f));
        continue;
      }
      const router = this.routers[id];
      const last = c.from + c.length >= this.mono.length;
      const parts = frames.flatMap((f) => router.push(f));
      if (last) parts.push(...router.flush());
      for (const part of parts) for (const [l, pf] of Object.entries(part) as [LayerKind, Frame][]) take(l, l).push(slim(pf));
    }
  }

  /** How loud each layer was (for the vibe's measure of the parts): a layer with nothing sounding is silent. */
  private roles(layers: LayerFrames[]) {
    const by = new Map<number, Partial<Record<LayerKind, number>>>();
    for (const lf of layers) {
      for (const f of lf.frames) {
        const k = Math.round(f.t * 100);
        const lv = by.get(k) ?? {};
        const sounding = lf.layer === "drums" || lf.layer === "other" ? true : f.voices.length > 0;
        const v = sounding ? levelOfDb(f.db) : 0;
        const as: LayerKind = lf.layer === "harmony" ? "melody" : lf.layer;
        if ((ROLE_ORDER as string[]).includes(as)) lv[as] = Math.max(lv[as] ?? 0, v);
        by.set(k, lv);
      }
    }
    for (const k of [...by.keys()].sort((a, b) => a - b)) this.vibe.roles(by.get(k)!);
  }
}
