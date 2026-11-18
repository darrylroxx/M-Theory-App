/**
 * Sharing out what an ear hears among the layers of a song.
 *
 * An ear on one stem of a recording (or on the whole of it, before it has been split) hears
 * tones, hits and noise, not parts. The tones are shared out by how they behave, the way the
 * research for this canvas suggests for the stem a model calls "other"
 * (`research_notes/Synths harmony stems and vibe painting/vibe_painting.md`, section 3):
 *
 * - an overtone (a whole multiple of a tone, heard with it) goes with its tone, and is marked as
 *   its overtone. The ear hears high tones sooner than low ones (it needs a longer look to tell
 *   low notes apart), so a note's overtones are often heard a few hundredths of a second before
 *   the note itself: the router looks that far ahead before it decides (`delay`);
 * - tones that begin together, two or more at once, are a **chord**;
 * - a tone that begins on its own, above the chord that is sounding (or with none), is the
 *   **melody**: one line, the top of what is played;
 * - a tone low down (below about 160 Hz) is the **bass**, when the source has a bass in it;
 * - hits go to the **drums** when the source has drums in it, and otherwise stay with the tones
 *   (a plucked string's attack);
 * - noise that goes on (a pad, air, a room) is the **other** layer's fog.
 *
 * Once a tone has been given to a layer it stays there until it ends. Each layer's share comes
 * out as a frame of its own, with the source's levels and colour, so the layer's hand paints it
 * exactly as it would paint an ear of its own. With `only`, every tone goes to one layer and the
 * router only marks the overtones.
 */
import { NOISE_BANDS, type Frame, type Voice } from "./ear";
import type { LayerKind } from "../canvas/layers";

export interface RouteOptions {
  /** low tones are a bass (an unsplit mix; a stem without its own bass) */
  bass?: boolean;
  /** hits are drums (an unsplit mix) */
  drums?: boolean;
  /** the layer noise goes to (fog), if any */
  fog?: LayerKind | null;
  /** every tone to this one layer (only the overtones are worked out) */
  only?: LayerKind;
  /** how many frames (hundredths of a second) to look ahead for a note whose overtones came first */
  delay?: number;
}

const BASS_HZ = 160;
/** tones begun within this long of each other began together */
const TOGETHER = 0.06;

/** Is `hi` a whole multiple (2 to 12 times) of `lo`? */
export function isOvertone(hi: number, lo: number): boolean {
  if (lo <= 0 || hi < lo * 1.9) return false;
  const r = hi / lo;
  const whole = Math.round(r);
  return whole >= 2 && whole <= 12 && Math.abs(r - whole) < 0.035 * whole;
}

export class VoiceRouter {
  private readonly opts: RouteOptions;
  private readonly delay: number;
  /** the layer each tone has been given, and what it is an overtone of */
  private readonly given = new Map<number, { layer: LayerKind; of?: number }>();
  /** the tones sounding now: when they began and at what pitch (for overtones and chords) */
  private readonly live = new Map<number, { born: number; hz: number; amp: number; layer: LayerKind; over: boolean }>();
  private readonly queue: Frame[] = [];

  constructor(opts: RouteOptions = {}) {
    this.opts = opts;
    this.delay = Math.max(0, opts.delay ?? 8);
  }

  /** Forget everything (the music jumped). */
  reset() {
    this.given.clear();
    this.live.clear();
    this.queue.length = 0;
  }

  /** The layers a frame's share is given to. */
  get layers(): LayerKind[] {
    if (this.opts.only) return [this.opts.only];
    const out: LayerKind[] = ["chords", "melody"];
    if (this.opts.bass) out.push("bass");
    if (this.opts.drums) out.push("drums");
    if (this.opts.fog) out.push(this.opts.fog);
    return out;
  }

  /** Take a frame; the frames that come out (`delay` frames later) are each shared out among the layers. */
  push(f: Frame): Partial<Record<LayerKind, Frame>>[] {
    this.queue.push(f);
    const out: Partial<Record<LayerKind, Frame>>[] = [];
    while (this.queue.length > this.delay) out.push(this.route(this.queue.shift()!));
    return out;
  }
  /** The frames still held back (the song is over, or stopped). */
  flush(): Partial<Record<LayerKind, Frame>>[] {
    const out: Partial<Record<LayerKind, Frame>>[] = [];
    while (this.queue.length) out.push(this.route(this.queue.shift()!));
    return out;
  }
  /** Share one frame out at once, with no look ahead. */
  route(f: Frame): Partial<Record<LayerKind, Frame>> {
    for (const id of f.ended) this.live.delete(id);
    // the new tones of this frame, lowest first: chords are judged from the bottom up
    const fresh = f.voices.filter((v) => !this.given.has(v.id)).sort((a, b) => a.hz - b.hz);
    for (const v of fresh) if (!this.given.has(v.id)) this.give(v, fresh);
    const out: Partial<Record<LayerKind, Frame>> = {};
    const fog = this.opts.only ?? this.opts.fog;
    const frameOf = (l: LayerKind): Frame => (out[l] ??= { ...f, voices: [], ended: [], hits: [], noise: fog === l ? f.noise : QUIET });
    for (const l of this.layers) frameOf(l);
    for (const v of f.voices) {
      const g = this.given.get(v.id);
      if (!g) continue;
      frameOf(g.layer).voices.push(g.of !== undefined ? { ...v, of: g.of } : v);
    }
    for (const id of f.ended) {
      const g = this.given.get(id);
      if (g) frameOf(g.layer).ended.push(id);
      this.given.delete(id);
    }
    for (const h of f.hits) {
      if (this.opts.only) frameOf(this.opts.only).hits.push(h);
      else if (this.opts.drums) frameOf("drums").hits.push(h);
      else frameOf(h.hz < BASS_HZ && this.opts.bass ? "bass" : "chords").hits.push(h);
    }
    return out;
  }

  /** The tone `v` is a whole multiple of, if one is sounding or is about to be heard. */
  private fundamental(v: Voice): { id: number; layer: LayerKind | null; voice?: Voice } | null {
    let best: { id: number; layer: LayerKind | null; voice?: Voice; hz: number } | null = null;
    // (an overtone is weaker than its note: a note as loud as the bass's fourth overtone is a note of a chord)
    for (const [id, o] of this.live) {
      if (o.over || v.born - o.born > 0.35 || v.born < o.born - TOGETHER || v.amp > o.amp * 0.9) continue;
      if (isOvertone(v.hz, o.hz) && (!best || o.hz < best.hz)) best = { id, layer: o.layer, hz: o.hz };
    }
    // a note heard a moment after its overtones
    for (const f of this.queue)
      for (const o of f.voices) {
        if (o.id === v.id || this.given.has(o.id) || o.born > v.born + 0.1 || o.born < v.born - TOGETHER || v.amp > o.amp * 0.9) continue;
        if (isOvertone(v.hz, o.hz) && (!best || o.hz < best.hz)) best = { id: o.id, layer: null, voice: o, hz: o.hz };
      }
    return best;
  }

  private give(v: Voice, fresh: Voice[]): LayerKind {
    const f = this.fundamental(v);
    if (f) {
      // the note itself is given its layer first, and its overtone goes with it
      let layer = f.layer;
      if (!layer && f.voice) layer = this.give(f.voice, [f.voice, ...fresh.filter((x) => x !== v)]);
      this.given.set(v.id, { layer: layer!, of: f.id });
      this.live.set(v.id, { born: v.born, hz: v.hz, amp: v.amp, layer: layer!, over: true });
      return layer!;
    }
    let layer: LayerKind;
    if (this.opts.only) layer = this.opts.only;
    else if (this.opts.bass && v.hz < BASS_HZ) layer = "bass";
    else {
      // begun with another tone (not its overtone), it is part of a chord
      const together = fresh.filter((o) => o !== v && Math.abs(o.born - v.born) <= TOGETHER && !(this.opts.bass && o.hz < BASS_HZ) && !isOvertone(v.hz, o.hz) && !isOvertone(o.hz, v.hz));
      const older = [...this.live.values()].filter((o) => !o.over && o.layer === "chords" && Math.abs(o.born - v.born) <= TOGETHER);
      if (together.length || older.length) layer = "chords";
      else {
        // on its own: the melody if it is above the chord now sounding, otherwise a note of the accompaniment
        let top = 0;
        for (const o of this.live.values()) if (o.layer === "chords" && !o.over) top = Math.max(top, o.hz);
        layer = v.hz > 180 && v.hz >= top * 0.94 ? "melody" : "chords";
      }
    }
    this.given.set(v.id, { layer });
    this.live.set(v.id, { born: v.born, hz: v.hz, amp: v.amp, layer, over: false });
    return layer;
  }
}

const QUIET = new Float32Array(NOISE_BANDS);
