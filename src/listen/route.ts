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
 *   the note itself: the router looks that far ahead before it decides (`delay`). In a layer
 *   that is one line (a voice, a bass) any whole multiple begun with a tone is part of it; in a
 *   mix, see `overtoneOf` (a chord played over its own bass note sits on the bass's overtones);
 *   a tone the split's bass band shares with the stem above (`beside`) is the stem's where it
 *   is louder;
 * - a stem split by signal processing also holds scraps of the others: a drum's ring (a kick's
 *   thump, a snare's body) passes for a short tone begun on the hit, and a mask that flickers
 *   chops a held tone into tones a few hundredths of a second long. With `minLife` and `hits`,
 *   the router looks far enough ahead to see how long each tone lives, and lets go of the
 *   flickers and of short tones begun on a drum hit (and of hits that are the drums' own);
 * - tones that begin together, two or more at once, are a **chord**;
 * - a tone that begins on its own, above the chord that is sounding (or with none, or with only
 *   one other tone ringing on), is the **melody**: one line, the top of what is played; and so is
 *   a tone that carries the melody on (it begins within a moment of the melody's last note and
 *   no more than a sixth from it), even if it dips under the chord;
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
import { NOISE_BANDS, RANGE_DB, type Frame, type Voice } from "./ear";
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
  /** tones that live less than this long (seconds) are scraps, not notes (needs `delay` at least this long) */
  minLife?: number;
  /** tones begun on a drum hit (see `hits`) that live less than this long (seconds) are the drum's ring */
  hitLife?: number;
}

const BASS_HZ = 160;
/** tones begun within this long of each other began together; tones that both swelled in, within this long */
const TOGETHER = 0.06;
const SWELL = 0.18;

/** Is `hi` a whole multiple (2 to 12 times) of `lo`? */
export function isOvertone(hi: number, lo: number): boolean {
  if (lo <= 0 || hi < lo * 1.9) return false;
  const r = hi / lo;
  const whole = Math.round(r);
  return whole >= 2 && whole <= 12 && Math.abs(r - whole) < 0.035 * whole;
}

/**
 * Can a tone (`hz`, `amp` on the ear's tilted 0..1 scale) be an overtone of another (`lo`,
 * `loAmp`) that began with it? It must be a whole multiple of it. In a layer that is one voice or
 * one bass line (`oneLine`) that is enough. In a mix it must also be quieter than real overtones
 * are: a sound's overtones fade by about 6 dB an octave up its series (a bright, buzzing one; most
 * fade faster), and the ear tilts levels up by 4.5 dB an octave, so heard by the ear an overtone
 * is a little quieter than its note. One no louder than 0.9 of its note is taken as an overtone.
 * One louder than that is an overtone only if it is the octave, or if `lower`: an overtone lower
 * in the same series is sounding too (a voice's overtones near its resonances are loud, but they
 * come as a whole series); and even then only if it is no louder than its note less half the
 * tilt (as it would be heard if it faded by 2¼ dB an octave). Louder, it is a note of its own: a
 * chord played over its bass note sits exactly on the bass's 4th, 5th and 6th overtones, and is
 * a chord.
 */
export function overtoneOf(hz: number, amp: number, lo: number, loAmp: number, oneLine = false, lower = false): boolean {
  if (!isOvertone(hz, lo)) return false;
  if (oneLine || amp <= loAmp * 0.9) return true;
  const k = Math.round(hz / lo);
  return (k === 2 || lower) && amp <= loAmp + (2.25 * Math.log2(k)) / RANGE_DB;
}

/** Is a tone at a whole multiple (2 up to, not including, `k`) of `lo` among `hzs`? */
function lowerPartial(lo: number, k: number, hzs: Iterable<number>): boolean {
  for (const hz of hzs) {
    const r = hz / lo;
    const j = Math.round(r);
    if (j >= 2 && j < k && Math.abs(r - j) < 0.035 * j) return true;
  }
  return false;
}

/** A tone of another stem, sounding beside this one's. */
export interface Beside {
  hz: number;
  amp: number;
  born: number;
  /** the same tone here, no louder, is this one split between two stems (where the split is by frequency, as the bass's is) */
  shared?: boolean;
}

export class VoiceRouter {
  private readonly opts: RouteOptions;
  private readonly delay: number;
  /** the layer each tone has been given (null: let go of), and what it is an overtone of */
  private readonly given = new Map<number, { layer: LayerKind | null; of?: number }>();
  /** the tones sounding now: when they began and at what pitch (for overtones and chords) */
  private readonly live = new Map<number, { born: number; hz: number; amp: number; layer: LayerKind; over: boolean; struck?: number }>();
  private readonly queue: Frame[] = [];
  /** the melody: when a note of it last sounded, and at what pitch */
  private line = { t: -99, hz: 0 };
  /** drum hits heard in another stem (seconds), and the tones of other stems, moment by moment */
  private drumHits: number[] = [];
  private besides: { t: number; tones: Beside[] }[] = [];

  constructor(opts: RouteOptions = {}) {
    this.opts = opts;
    this.delay = Math.max(0, opts.delay ?? 8);
  }

  /** Forget everything (the music jumped). */
  reset() {
    this.given.clear();
    this.live.clear();
    this.queue.length = 0;
    this.line = { t: -99, hz: 0 };
    this.drumHits = [];
    this.besides = [];
  }

  /** Drum hits heard in the drums' own stem (seconds) that reach down into the tones (a kick, a snare, a tom; not a hat): short tones begun on one are its ring. */
  hits(times: number[]) {
    for (const t of times) this.drumHits.push(t);
  }
  /** The tones another stem has sounding at time `t` (a tone here at the same pitch, and quieter, is that tone, if it is `shared`). */
  beside(t: number, tones: Beside[]) {
    this.besides.push({ t, tones });
  }
  private nearHit(t: number): boolean {
    for (const h of this.drumHits) if (Math.abs(h - t) <= 0.08) return true;
    return false;
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
    // (what other stems did long ago no longer matters)
    while (this.drumHits.length && this.drumHits[0] < f.t - 0.5) this.drumHits.shift();
    while (this.besides.length && this.besides[0].t < f.t - 0.2) this.besides.shift();
    // the new tones of this frame, lowest first: chords are judged from the bottom up
    const fresh = f.voices.filter((v) => !this.given.has(v.id)).sort((a, b) => a.hz - b.hz);
    // (scraps first, so that none of them is taken for a note of a chord)
    for (const v of fresh) if (this.scrap(v)) this.given.set(v.id, { layer: null });
    for (const v of fresh) if (!this.given.has(v.id)) this.give(v, fresh);
    const out: Partial<Record<LayerKind, Frame>> = {};
    const fog = this.opts.only ?? this.opts.fog;
    const frameOf = (l: LayerKind): Frame => (out[l] ??= { ...f, voices: [], ended: [], hits: [], noise: fog === l ? f.noise : QUIET });
    for (const l of this.layers) frameOf(l);
    for (const v of f.voices) {
      const g = this.given.get(v.id);
      if (!g || !g.layer) continue;
      frameOf(g.layer).voices.push(g.of !== undefined ? { ...v, of: g.of } : v);
      if (g.layer === "melody" && g.of === undefined && v.amp > 0.05) this.line = { t: f.t, hz: v.hz };
    }
    for (const id of f.ended) {
      const g = this.given.get(id);
      if (g?.layer) frameOf(g.layer).ended.push(id);
      this.given.delete(id);
    }
    for (const h of f.hits) {
      // a hit heard here as the drums' own stem hears one is the drum's, leaking in
      if (this.drumHits.length && this.nearHit(f.t)) continue;
      if (this.opts.only) frameOf(this.opts.only).hits.push(h);
      else if (this.opts.drums) frameOf("drums").hits.push(h);
      else frameOf(h.hz < BASS_HZ && this.opts.bass ? "bass" : "chords").hits.push(h);
    }
    return out;
  }

  /** The tone `v` is a whole multiple of, if one is sounding or is about to be heard (`id` −1: it is another stem's tone). */
  private fundamental(v: Voice): { id: number; layer: LayerKind | null; voice?: Voice } | null {
    let best: { id: number; layer: LayerKind | null; voice?: Voice; hz: number } | null = null;
    const one = !!this.opts.only;
    // the tones that may be overtones of the same series lower down: ones already taken as overtones, and ones not yet
    // given a layer (a tone taken as a note of its own, a chord's, is no evidence of a series)
    const known: number[] = [];
    for (const o of this.live.values()) if (o.over) known.push(o.hz);
    for (const f of this.queue) for (const o of f.voices) if (o.id !== v.id && !this.given.has(o.id)) known.push(o.hz);
    // (a low note is heard a little later than the high one that is its overtone)
    const side: Beside[] = [];
    for (const b of this.besides) if (b.t >= v.born - 0.05 && b.t <= v.born + 0.1) for (const o of b.tones) if (!side.some((x) => Math.abs(x.hz - o.hz) < 0.5 && x.born === o.born)) side.push(o);
    for (const o of side) known.push(o.hz);
    const of = (lo: number, loAmp: number) => overtoneOf(v.hz, v.amp, lo, loAmp, one, lowerPartial(lo, Math.round(v.hz / lo), known));
    for (const [id, o] of this.live) {
      if (o.over || v.born - o.born > 0.35 || v.born < o.born - TOGETHER) continue;
      if (of(o.hz, o.amp) && (!best || o.hz < best.hz)) best = { id, layer: o.layer, hz: o.hz };
    }
    // a note heard a moment after its overtones
    for (const f of this.queue)
      for (const o of f.voices) {
        if (o.id === v.id || this.given.has(o.id) || o.born > v.born + 0.1 || o.born < v.born - TOGETHER) continue;
        if (of(o.hz, o.amp) && (!best || o.hz < best.hz)) best = { id: o.id, layer: null, voice: o, hz: o.hz };
      }
    // the same tone as one of another stem's, split between the two by a band (the bass's), and louder there. (Its
    // overtones are not let go of: a chord played over the bass sits on them, and a split leaves too little of either
    // in a stem to tell them apart by their loudness)
    for (const o of side) {
      if (!o.shared || v.born - o.born > 0.35 || v.born < o.born - TOGETHER) continue;
      if (Math.abs(12 * Math.log2(v.hz / o.hz)) < 0.5 && o.amp >= v.amp - 0.1) return { id: -1, layer: null };
    }
    return best;
  }

  /** How long a tone that begins in the frame being routed goes on, as far as the frames held back show (Infinity: past them). */
  private lifeOf(v: Voice): number {
    // (nothing held back: the song is over, or nothing is looked ahead at)
    if (!this.queue.length) return Infinity;
    let last = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const f = this.queue[i];
      if (f.voices.some((o) => o.id === v.id)) last = i;
      else break;
    }
    return last === this.queue.length - 1 && !this.queue[last]?.ended.includes(v.id) ? Infinity : last < 0 ? 0.01 : this.queue[last].t - v.born;
  }
  /** How far a tone's pitch falls in its first moments (semitones), as far as the frames held back show. */
  private fallOf(v: Voice): number {
    let low = v.hz;
    for (const f of this.queue) {
      if (f.t - v.born > 0.1) break;
      const o = f.voices.find((x) => x.id === v.id);
      if (!o) break;
      low = Math.min(low, o.hz);
    }
    return 12 * Math.log2(v.hz / low);
  }
  /**
   * Is a tone a scrap of another stem, or of a flickering mask, and not a note? A flicker lives
   * less than `minLife`; a drum's ring begins on a drum hit and either dies within `hitLife` or
   * falls in pitch as it starts (a kick's thump, a tom), which a played note does not.
   */
  private scrap(v: Voice): boolean {
    const min = this.opts.minLife ?? 0;
    const hit = this.opts.hitLife ?? 0;
    if (!min && !hit) return false;
    const life = this.lifeOf(v);
    if (life < min) return true;
    return hit > 0 && this.nearHit(v.born) && (life < hit || this.fallOf(v) > 1.5);
  }

  private give(v: Voice, fresh: Voice[]): LayerKind | null {
    const f = this.fundamental(v);
    if (f) {
      // another stem's overtone is painted with its note there, not here
      if (f.id < 0) {
        this.given.set(v.id, { layer: null });
        return null;
      }
      // the note itself is given its layer first, and its overtone goes with it
      let layer = f.layer;
      if (!layer && f.voice) layer = this.give(f.voice, [f.voice, ...fresh.filter((x) => x !== v)]);
      if (!layer) {
        // (its note was a scrap: so is it)
        this.given.set(v.id, { layer: null });
        return null;
      }
      this.given.set(v.id, { layer, of: f.id });
      this.live.set(v.id, { born: v.born, hz: v.hz, amp: v.amp, layer, over: true });
      return layer;
    }
    let layer: LayerKind;
    if (this.opts.only) layer = this.opts.only;
    else if (this.opts.bass && v.hz < BASS_HZ) layer = "bass";
    else {
      // begun with another tone (not its overtone), it is part of a chord. (Tones that swell in are heard to begin when
      // each grows loud enough, which for the notes of one slow chord is not quite together)
      const within = (o: { born: number; struck?: number }) => Math.abs(o.born - v.born) <= (v.struck < 0.4 && (o.struck ?? 1) < 0.4 ? SWELL : TOGETHER);
      // (and the tones about to be heard: the router looks ahead)
      const coming = this.queue.flatMap((f) => f.voices.filter((o) => !this.given.has(o.id) && !fresh.some((x) => x.id === o.id)));
      const together = [...fresh, ...coming].filter((o) => o.id !== v.id && within(o) && !(this.opts.bass && o.hz < BASS_HZ) && !isOvertone(v.hz, o.hz) && !isOvertone(o.hz, v.hz) && this.given.get(o.id)?.layer !== null);
      const older = [...this.live.values()].filter((o) => !o.over && o.layer === "chords" && within(o));
      if (together.length || older.length) layer = "chords";
      else {
        // on its own: the melody if it is above the chord now sounding (one tone ringing on is not yet a chord), or
        // if it carries the melody on; otherwise a note of the accompaniment
        let top = 0;
        let ringing = 0;
        for (const o of this.live.values())
          if (o.layer === "chords" && !o.over) {
            top = Math.max(top, o.hz);
            ringing++;
          }
        const carries = v.born - this.line.t < 0.35 && Math.abs(12 * Math.log2(v.hz / this.line.hz)) <= 9.5;
        layer = v.hz > 180 && (ringing < 2 || v.hz >= top * 0.94 || carries) ? "melody" : "chords";
      }
    }
    this.given.set(v.id, { layer });
    this.live.set(v.id, { born: v.born, hz: v.hz, amp: v.amp, layer, over: false, struck: v.struck });
    return layer;
  }
}

const QUIET = new Float32Array(NOISE_BANDS);
