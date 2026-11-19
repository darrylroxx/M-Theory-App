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
import { VoiceRouter, type Beside, type RouteOptions } from "./route";
import { STEM_IDS, type StemChunk, type StemName, type StemSource, type Stereo } from "./split";
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

/** How long the routers look ahead (seconds): long enough to see a drum's ring end. */
const AHEAD = 0.2;
const router = (o: RouteOptions) => new VoiceRouter({ ...o, delay: Math.round(AHEAD * 100), minLife: 0.07, hitLife: 0.12 });

/** The tones a stem's ear follows below `top` hertz, moment by moment (for the stems above the bass: the same tone there, where the split's bands overlap, is the bass's). */
function tonesOf(frames: Frame[], top = Infinity, shared = false): { t: number; tones: Beside[] }[] {
  return frames.map((f) => ({ t: f.t, tones: f.voices.filter((v) => v.hz < top).map((v) => ({ hz: v.hz, amp: v.amp, born: v.born, shared })) }));
}
/**
 * A bass is below about 175 Hz; the split's bass stem reaches a little higher (it fades out over
 * 150 to 260 Hz), where the bottom notes of chords are, and those are painted from the stem above.
 */
const BASS_TOP = 175;

/** How loud a layer is, 0..1, on the canvas's fixed scale (−50 dBFS is nothing, −14 is loud). */
export const levelOfDb = (db: number) => Math.max(0, Math.min(1, (db + 50) / 36));

export class LayerAnalysis {
  readonly sr: number;
  readonly duration: number;
  private readonly song: Stereo;
  private readonly source: StemSource;
  private readonly ref: number;
  /** the ear on the whole mix (none in a pass that hears only the stems: see `opts.mix`) */
  private mixEar: Ear | null;
  /** an ear on each stem the source gives */
  private ears = new Map<StemName, Ear>();
  /**
   * The tones of every stem but the drums go through a router (`route.ts`): the bass's and the
   * voice's only have their overtones marked; the rest (and a six-stem model's guitar and piano)
   * are shared out into chords and melody, and the rest's noise is the fog. Each looks a fifth of
   * a second ahead, to let go of the scraps a split leaves in a stem: tones that flicker for a
   * few hundredths of a second, and a drum's ring.
   */
  private routers = new Map<StemName, VoiceRouter>();
  private readonly from: number;
  private at = 0;
  private stemAt = 0;
  /** the low hits the ear on the whole mix heard lately */
  private mixHits: LowHit[] = [];
  /** the vibe of everything heard so far */
  readonly vibe = new VibeMeter();
  private mono: Float32Array;
  done = false;

  /**
   * `ref`: how loud the loudest parts of the song are (as `loudest` measures), so the whole song
   * is read on one scale. `opts.from`: the second of the song to begin at (a model's stems that
   * take over from the split part way through); `opts.mix`: false to hear only the stems (the
   * mix, its mood and its vibe already known from a first pass).
   */
  constructor(song: Stereo, source: StemSource, ref: number, opts: { from?: number; mix?: boolean } = {}) {
    this.song = song;
    this.sr = song.sr;
    this.duration = song.left.length / song.sr;
    this.source = source;
    this.ref = ref;
    this.from = Math.max(0, Math.min(song.left.length, Math.round((opts.from ?? 0) * song.sr)));
    this.at = this.stemAt = this.from;
    this.mixEar = opts.mix === false ? null : new Ear(this.sr, ref, { start: this.from / this.sr });
    this.mono = new Float32Array(this.mixEar ? song.left.length : 0);
    for (let i = 0; i < this.mono.length; i++) this.mono[i] = 0.5 * (song.left[i] + song.right[i]);
    const names = source.stems ?? STEM_IDS;
    names.forEach((name, i) => {
      this.ears.set(name, new Ear(this.sr, ref, { light: name === "drums", phase: (i + 1) / (names.length + 1), start: this.from / this.sr }));
      if (name === "drums") return;
      this.routers.set(name, router(name === "bass" || name === "vocals" ? { only: name } : { fog: name === "other" ? "other" : null }));
    });
  }

  async prepare(progress?: (f: number) => void) {
    await this.source.prepare(this.song, progress);
    this.source.seek(this.from);
  }

  /** Hear the next `seconds` of the song (null once it is all heard). */
  async step(seconds: number): Promise<Heard | null> {
    if (this.done) return null;
    const length = this.song.left.length;
    const end = Math.min(length, this.at + Math.round(seconds * this.sr));
    const mix: Frame[] = [];
    if (this.mixEar) this.mixEar.push(this.mono.subarray(this.at, end), mix);
    this.at = end;
    for (const m of mix) for (const h of m.hits) if (h.lo < 300) this.mixHits.push({ t: m.t, strength: h.strength, hz: h.hz, lo: h.lo, noisy: h.noisy });
    const layers: LayerFrames[] = [];
    // stems for (at least) as far as the mix has been heard
    while (this.stemAt < this.at || (this.at >= length && !this.done)) {
      const c = await this.source.next(this.at - this.stemAt + 4096);
      if (!c) {
        this.done = this.at >= length;
        break;
      }
      if (c.length) {
        this.hearStems(c, layers);
        this.stemAt = c.from + c.length;
      }
    }
    for (const f of mix) this.vibe.take(f);
    this.roles(layers);
    if (this.at >= length && this.stemAt >= length) this.done = true;
    // (the routers hold back what they look ahead at)
    return { to: this.done ? this.duration : Math.max(0, Math.min(this.at, this.stemAt) / this.sr - AHEAD - 0.02), mix, layers };
  }

  private hearStems(c: StemChunk, out: LayerFrames[]) {
    const take = (key: string, layer: LayerKind): Frame[] => {
      let e = out.find((x) => x.key === key);
      if (!e) out.push((e = { key, layer, frames: [] }));
      return e.frames;
    };
    // (every stem is heard against the loudness of the whole mix, or of the whole song when the mix is not heard here)
    const ref = this.mixEar?.loudest ?? this.ref;
    const heard = new Map<StemName, Frame[]>();
    for (const [name, ear] of this.ears) {
      const x = c.stems[name] ?? new Float32Array(c.length);
      ear.hold(ref);
      heard.set(name, ear.push(x));
    }
    // a kick's or a tom's weight is mostly the ring of its body, which a split hands to the bass (the bass lets go of
    // it: `route.ts`): such a hit is as hard as the whole mix heard it
    const drums = heard.get("drums") ?? [];
    for (const f of drums) take("drums", "drums").push(slim(weighed(f, this.mixHits)));
    // what the other stems tell each one: where the drums hit (the drums that ring: a kick, a snare, a tom, not a hat),
    // and the bass's tones (only the bass's: what a split leaves in the voice's stem is too uncertain to go by)
    const hits = drums.filter((f) => f.hits.some((h) => h.lo < 500)).map((f) => f.t);
    const bass = tonesOf(heard.get("bass") ?? [], BASS_TOP, true);
    const last = c.from + c.length >= this.song.left.length;
    for (const [name, router] of this.routers) {
      router.hits(hits);
      if (name !== "bass") for (const b of bass) router.beside(b.t, b.tones);
      const parts = (heard.get(name) ?? []).flatMap((f) => router.push(name === "bass" ? under(f, BASS_TOP) : f));
      if (last) parts.push(...router.flush());
      // (the rest's shares are known by their layer; a model's guitar and piano each have hands of their own)
      for (const part of parts) for (const [l, pf] of Object.entries(part) as [LayerKind, Frame][]) take(name === "guitar" || name === "piano" ? `${name}:${l}` : l, l).push(slim(pf));
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

/** A frame with only its tones below `top` hertz (the rest are let go of). */
function under(f: Frame, top: number): Frame {
  if (f.voices.every((v) => v.hz < top)) return f;
  return { ...f, voices: f.voices.filter((v) => v.hz < top) };
}

/** A hit the ear on the whole mix heard low down: when, how hard, where its weight was, how low it reached and how noisy it was. */
interface LowHit {
  t: number;
  strength: number;
  hz: number;
  lo: number;
  noisy: number;
}

/**
 * A drum stem's frame with its kicks and toms as the whole mix heard them (`kept`: the low hits
 * the ear on the mix heard, which runs a little ahead of the stems). A split leaves only a kick's
 * click in the drums' stem (its thump is steady enough to pass for the bass, which lets go of
 * it: `route.ts`), so a hit there that reaches below the cymbals, on a hit the mix heard low
 * down, is as hard as that low hit, and if it is not noisy (a kick or a tom, not a snare), has
 * its weight as low. (A snare's body goes the same way, but the mix hears it together with the
 * hats and everything else that starts on the beat, too mixed to tell it by.)
 */
function weighed(f: Frame, kept: LowHit[]): Frame {
  while (kept.length && kept[0].t < f.t - 1) kept.shift();
  if (!f.hits.length) return f;
  let best: LowHit | null = null;
  for (const k of kept) {
    if (k.t > f.t + 0.04) break;
    if (k.t >= f.t - 0.04 && (!best || k.strength > best.strength)) best = k;
  }
  if (!best) return f;
  const low = best;
  return {
    ...f,
    hits: f.hits.map((h) => {
      if (h.lo >= 1000) return h;
      return h.noisy < 0.6 ? { ...h, strength: Math.max(h.strength, low.strength), hz: Math.min(h.hz, low.hz), lo: Math.min(h.lo, low.lo) } : { ...h, strength: Math.max(h.strength, low.strength) };
    }),
  };
}
