/**
 * The hands: one for each layer of the music, each holding its own kind of brush.
 *
 * A hand is told when each of its layer's sounds begins, how it goes on (its pitch and its
 * loudness, moment by moment, or how long it will last when that is known in advance) and when
 * it ends; and it is told how far the music has got. A brush comes down when its sound begins,
 * is pulled along with the music for exactly as long as the sound lasts, and is lifted when it
 * stops: a staccato note is over before the brush has moved, so it leaves a dab; a held note a
 * stroke as long as itself. Where the brush goes is the layout's business (`place.ts`); what the
 * brush is like is the layer's:
 *
 * - the **melody** is one line: a note that follows closely on the last carries on from where
 *   that one's brush was, so a phrase is a single curve; short notes are a dotted line;
 * - the **harmony** is a thinner, lighter line of its own, and where it runs near the melody the
 *   two are hatched together (the "sketchy" brush of the Harmony drawing tool), more densely the
 *   rougher the harmony sounds;
 * - the **bass** is a broad flat band that lies along the bottom, or a stack of short slabs;
 * - the **chords** are a wash that spans from their lowest note to their highest and is laid
 *   while they ring, in the colour of the chord, or a hard block when they are stabbed;
 * - the **vocals** are a ribbon of fine strands, each following the voice on its own spring (the
 *   "ribbon" brush of the Harmony drawing tool), glazed on in light: breath splays the strands,
 *   loudness makes them glow, vibrato ripples them;
 * - the **drums** are thrown: a kick is a soft blot, a snare a burst of drops, a hat a stipple of
 *   specks, a cymbal a trail of scratches;
 * - **other** sounds are fog, laid as wide, edge-less haze that the wet canvas carries off.
 *
 * Every part of a mark answers the sound: how loud is how big and how heavily loaded; how hard
 * it began is how hard its edge is and whether it throws paint; how long it rings is how long
 * its tail is; how noisy it is is how broken and splayed the mark is; how bright is how light.
 * All chance in a mark comes from its own sound (its layer, when it began, its pitch) and the
 * painting's run number, so the same music painted twice in the same run is the same picture,
 * and Clear starts a new run with new detail on the same structure.
 */
import type { Frame, Hit } from "../listen/ear";
import { NOISE_BANDS, noiseHz } from "../listen/ear";
import { overtoneOf } from "../listen/route";
import { mix as mixRgb, rgbToHsl, hslToRgb, type RGB } from "./color";
import type { LayerColours, LayerKind } from "./layers";
import { colorIndex, midiOfHz, upOfHz } from "./layout";
import type { Place } from "./place";
import { gauss, hash, noise, rng, type Rng } from "./rand";
import { paintOf, type Stamp } from "./sim";

/** The manner of the painting just now (set from the mood of the music, or by choice). */
export interface Manner {
  /** 0 = thick, dry paint … 1 = thin and wet */
  wet: number;
  /** how unsteady the hand is, 0..1 */
  loose: number;
  /** how much paint there is to a mark, 1 = as usual */
  body: number;
}

/** One sound of a layer, as its hand is told of it. */
export interface Cue {
  /** stays the same while the sound lasts */
  id: number;
  /** when it begins (seconds, on the clock the painting is told) */
  t: number;
  /** its pitch, or where a hit's weight is (hertz) */
  hz: number;
  /** how loud, 0..1, against a loud part of a song (not against the layer's own loudest): a quiet part paints quietly */
  amp: number;
  /** how hard it begins: 0 = it swells in … 1 = struck */
  attack: number;
  /** 0 = dull … 1 = bright */
  bright: number;
  /** 0 = a pure tone … 1 = noise */
  rough: number;
  /** how long it sounds, when that is known in advance (the app's own notes), seconds */
  len?: number;
  /** how long it rings when left alone (seconds to die away by 30 dB) */
  ring?: number;
  /** a hit: the stretch of the scale it fills */
  lo?: number;
  hi?: number;
  /** which drum, when known */
  drum?: string;
  /** the sound this one is an overtone of, when that is known */
  of?: number;
}

/** What a layer sounds like just now, measured from its own sound (smoothed): for the marks of sounds whose texture is not otherwise known. */
export interface Texture {
  bright: number;
  rough: number;
  /** how loud the layer is, 0..1, against a loud mix (absolute, not relative to itself) */
  level: number;
  /** how loud it stays: its level between its peaks (a pad's is its level; a drum's ring leaking into a stem has next to none) */
  floor: number;
  /** how much of it is noise that goes on (air, a room, a hiss), 0..1 */
  air?: number;
}

/** Things about the music as a whole that change the brushes (from its vibe): all near 1 for a middling song. */
export interface Touch {
  /** how long a stroke goes on before it needs paint again; how far drops are thrown */
  stroke: number;
  spread: number;
  /** how many marks a sound leaves */
  density: number;
}

/** Where a brush was lifted, and how it was loaded. */
interface Lifted {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  seg: number;
  load: number;
  short: boolean;
  k: [number, number, number];
  rgb: RGB;
  hz: number;
  strands?: Stroke["strands"];
}

interface Stroke {
  cue: Cue;
  /** it sounds until this time (Infinity: until told it has stopped) */
  until: number;
  hz: number;
  amp: number;
  /** the tip: where it is and how it is moving */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** where a mark was last left */
  px: number;
  py: number;
  /** where the music was the last time the brush moved, and which stretch of the layout it was in */
  t: number;
  seg: number;
  /** the brush: its size, paint, lean, load of paint and how far a load lasts */
  size: number;
  k: [number, number, number];
  rgb: RGB;
  lean: number;
  load: number;
  reach: number;
  water: number;
  r: number;
  scale: number;
  rand: Rng;
  seed: number;
  /** the vocals' strands, each on its own spring */
  strands?: { x: number; y: number; ax: number; ay: number; ease: number; off: number; px: number; py: number }[];
  /** a wash already laid as far as this time, and where (the chords) */
  laid: number;
  laidAt: { x: number; y: number } | null;
  /** for the harmony's hatching: where it has been */
  marks: number;
  /** the pitch (semitones) the brush is making for, and the height on the frequency scale it was last at */
  aim: number;
  up: number;
  /**
   * A line's way from one pitch to the next (melody, harmony, bass, voice): from the height of
   * `from` to that of `to` (on the frequency scale), starting at `t0`, over `dur` seconds.
   */
  glide?: { from: number; to: number; t0: number; dur: number };
}

const TAU = Math.PI * 2;
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
/** The tip follows its target like a weight on a spring (8.6 Hz, a little under-damped). */
const SPRING = 54.3;
const DAMP = 72;
/** Notes closer together than this (seconds) are one gesture: the line carries on. */
const JOIN = 0.14;
/**
 * A line goes from one pitch to the next no steeper than this (height over length, along the way
 * the music runs): a brush follows a line, it does not climb a stair. How long a glide takes
 * follows from this and from how fast the music runs across the canvas.
 */
export const MAX_SLOPE = 1.2;
/** ...but a glide never takes longer than this (seconds), nor more than this part of its note: it is the way into the note, not all of it. */
const GLIDE_MAX = 0.4;
const GLIDE_PART = 0.9;
/** A tone's pitch moving less than this (semitones: vibrato, a slide the ear follows) is followed as it comes. */
const GLIDE_FROM = 0.5;
/** Eased in and out: a glide sets off and arrives without a corner. */
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const isLine = (l: LayerKind) => l === "melody" || l === "harmony" || l === "bass" || l === "vocals";
/** The noise bands up among the cymbals (above about 5 kHz). */
const HIGH_BANDS = Array.from({ length: NOISE_BANDS }, (_, b) => noiseHz(b)).filter((hz) => hz >= 5000).length;
/** Shorter than this is a stab: a dab, a slab or a block. */
const SHORT = 0.16;
/** How far up the scale a chord's wash may reach above its lowest note (about an octave and a half, where the notes live). */
const CHORD_SPAN = 0.22;

/** Lighter and a touch more vivid for a bright sound, darker and greyer for a dull one. */
export function brighten(c: RGB, bright: number, amount = 1): RGB {
  const [h, s, l] = rgbToHsl(c);
  const d = (bright - 0.5) * amount;
  return hslToRgb(h, clamp(s * (1 + 0.35 * d)), clamp(l + 0.16 * d, 0.03, 0.97));
}
/** A paint, never quite the same twice. */
function varied(c: RGB, r: Rng, amount = 1): RGB {
  const [h, s, l] = rgbToHsl(c);
  return hslToRgb(h + (r() - 0.5) * 9 * amount, clamp(s + (r() - 0.5) * 0.12 * amount), clamp(l + (r() - 0.5) * 0.1 * amount, 0.02, 0.98));
}

export class LayerHand {
  readonly layer: LayerKind;
  /** where a moment of this layer's music goes: given by the painting each time it paints */
  where: (t: number, up: number) => Place | null = () => null;
  /** where marks go */
  put: (s: Stamp) => void = () => {};
  manner: Manner = { wet: 0.4, loose: 0.3, body: 1 };
  touch: Touch = { stroke: 1, spread: 1, density: 1 };
  texture: Texture = { bright: 0.5, rough: 0.2, level: 0.5, floor: 0 };
  /** the melody, for the harmony's hatching */
  partner: LayerHand | null = null;
  /** how the canvas itself is moving under the brushes (pixels a second; the river flows left): a brush held still draws along the current */
  flow = { x: 0, y: 0 };
  /** the painting's run: the same run paints the same marks for the same music */
  run = 0;
  /** how many marks have gone down */
  made = 0;
  /** real pixels to one design pixel (the canvas is designed 560 tall) */
  private u = 1;
  private strokes = new Map<number, Stroke>();
  /** sounds that begin later than the music has got to (the app's own notes are known ahead) */
  private waiting: Cue[] = [];
  /** the line so far (melody, harmony, bass): where its brush last was, at what pitch, when it lifted, and whether it was a stab */
  private line: Lifted | null = null;
  /** brushes lifted in the last moment, any layer: a tone heard again at once picks its brush up again */
  private lifted: Lifted[] = [];
  /** recent points of the line, for hatching */
  readonly trail: { x: number; y: number; t: number }[] = [];
  /** the colours */
  private col: LayerColours | null = null;
  private palette: RGB[] = [[60, 60, 60]];
  private map: number[] = new Array(12).fill(0);
  /** the last moment the hand was told of, and the last an ear told it of its tones */
  private now = -1;
  private heardAt = -1;
  private fogT = -1;

  constructor(layer: LayerKind) {
    this.layer = layer;
  }

  size(_w: number, h: number) {
    this.u = h / 560;
  }
  colours(c: LayerColours, palette: RGB[], noteMap: number[]) {
    this.col = c;
    this.palette = palette.length ? palette : [[60, 60, 60]];
    this.map = noteMap;
  }
  get down() {
    return this.strokes.size;
  }

  /**
   * The canvas moved under the brushes (the river flows): everything the hand remembers of where
   * it has been moves with the paint, so a brush held still while the canvas flows past it draws
   * a stroke along the current.
   */
  shift(dx: number, dy: number) {
    for (const s of this.strokes.values()) {
      s.x += dx;
      s.y += dy;
      s.px += dx;
      s.py += dy;
      if (s.laidAt) s.laidAt = { x: s.laidAt.x + dx, y: s.laidAt.y + dy };
      for (const st of s.strands ?? []) {
        st.x += dx;
        st.y += dy;
        st.px += dx;
        st.py += dy;
      }
    }
    for (const l of this.line ? [this.line, ...this.lifted] : this.lifted) {
      l.x += dx;
      l.y += dy;
    }
    for (const p of this.trail) {
      p.x += dx;
      p.y += dy;
    }
  }

  /**
   * Every brush off the canvas (the music stopped, or jumped). Sounds not begun are forgotten, and
   * so is the time: the music may start again from further back (a song from a file, played again).
   */
  lift() {
    this.strokes.clear();
    this.waiting = [];
    this.line = null;
    this.lifted = [];
    this.trail.length = 0;
    this.now = -1;
    this.heardAt = -1;
    this.fogT = -1;
  }

  /** A fixed chance for this sound: its layer, when it began (to a hundredth of a second), its pitch, and the run. */
  private seedOf(c: Cue, salt = 0): number {
    const li = "dbcmhvo".indexOf(this.layer[0]) + 1;
    return (hash(li * 1_000_003 + Math.round(c.t * 100) * 7919 + Math.round(c.hz) * 31 + this.run * 104_729 + salt) * 4294967296) >>> 0;
  }

  /** The colour of a note in this layer. */
  private colourOf(hz: number, bright: number, r: Rng): RGB {
    const c = this.col;
    const pc = Math.round(midiOfHz(hz));
    const own = this.palette[colorIndex(pc, this.map, this.palette.length, c?.shift ?? 0)] ?? [80, 80, 80];
    let base: RGB;
    switch (this.layer) {
      case "melody":
        base = c ? mixRgb(c.melody, own, 0.3) : own;
        break;
      case "harmony":
        base = c ? mixRgb(c.harmony, own, 0.25) : own;
        break;
      case "bass":
        base = c ? mixRgb(c.bass, own, 0.2) : own;
        break;
      case "vocals":
        base = c ? mixRgb(c.vocals, own, 0.2) : own;
        break;
      case "other":
        base = c ? mixRgb(c.other, own, 0.3) : own;
        break;
      case "drums":
        base = c ? c.drums : own;
        break;
      default:
        base = own;
    }
    return varied(brighten(base, bright, 0.8), r, 1);
  }

  // ── what the hand is told ──

  /** A sound begins (now, or later: the app's own notes are known a little ahead). */
  start(c: Cue) {
    // (a hand that has not been told the time yet keeps it until it is)
    if (this.now < 0 || c.t > this.now + 1e-4) {
      this.waiting.push(c);
      return;
    }
    this.begin(c);
  }
  /** A sound goes on: its pitch and loudness at time `t` (from the ear). */
  hold(id: number, t: number, hz: number, amp: number) {
    const s = this.strokes.get(id);
    if (!s) return;
    s.hz = hz;
    s.amp = amp;
    void t;
  }
  /** A sound stopped at time `t`. */
  stop(id: number, t: number) {
    const s = this.strokes.get(id);
    if (!s) {
      this.waiting = this.waiting.filter((c) => c.id !== id);
      return;
    }
    s.until = Math.min(s.until, t);
  }
  /** A hit (a drum, or the attack of something struck). */
  hit(c: Cue) {
    if (this.now < 0 || c.t > this.now + 1e-4) {
      this.waiting.push({ ...c, len: c.len ?? 0 });
      return;
    }
    this.thrown(c);
  }

  /**
   * Take what an ear heard of this layer: each tone it follows becomes a brush, each sudden
   * start a hit, noise that goes on a texture. (For layers whose notes come from the app
   * itself, the ear's frames give only the texture.)
   */
  hear(frames: Frame[], notesToo = true) {
    if (notesToo && frames.length) this.heardAt = frames[frames.length - 1].t;
    for (const f of frames) {
      this.feel(f);
      if (!notesToo) continue;
      this.advance(f.t);
      for (const id of f.ended) this.stop(id, f.t);
      for (const v of f.voices) {
        if (!this.strokes.has(v.id)) {
          if (v.fresh || v.age < 0.05) {
            // a tone already sounding when the hand began listening is joined where it is
            this.begin({ id: v.id, t: v.fresh ? v.born : f.t, hz: v.hz, amp: v.amp * this.texture.level ** 0.35, attack: v.struck, bright: this.texture.bright, rough: this.texture.rough, of: v.of });
          }
        } else this.hold(v.id, f.t, v.hz, v.amp * this.texture.level ** 0.35);
      }
      for (const h of f.hits) this.thrown(this.cueOfHit(h, f.t));
      this.scrub(f);
    }
    // a tone the ear no longer reports has stopped
    if (notesToo && frames.length) {
      const last = frames[frames.length - 1];
      const alive = new Set(last.voices.map((v) => v.id));
      for (const [id, s] of this.strokes) if (!alive.has(id) && s.until === Infinity) s.until = last.t;
    }
  }

  /** The layer's own sound, smoothed: how bright, how noisy and how loud it is. */
  private feel(f: Frame) {
    const k = 0.08;
    const tx = this.texture;
    if (f.db > -75) {
      tx.bright += (clamp(Math.log2(Math.max(100, f.centroid) / 300) / 4.5) - tx.bright) * k;
      tx.rough += (clamp(f.flat * 2.5) - tx.rough) * k;
    }
    // loudness on a fixed scale: −50 dBFS is nothing, −14 is loud
    const lv = clamp((f.db + 50) / 36);
    tx.level += (lv - tx.level) * (f.db > -75 ? 0.05 : 0.02);
    // what it stays at: it drops at once and climbs back over about a second
    tx.floor += (lv - tx.floor) * (lv < tx.floor ? 0.3 : 0.012);
    // (noise below the cymbals: air, breath, a room; a hat's hiss that leaks into a stem is the drums')
    let n = 0;
    let bands = 0;
    for (let b = 0; b < f.noise.length && noiseHz(b) < 5000; b++, bands++) n += f.noise[b];
    tx.air = (tx.air ?? 0) + (clamp((n / Math.max(1, bands) - 0.06) / 0.2) - (tx.air ?? 0)) * 0.03;
  }

  private cueOfHit(h: Hit, t: number): Cue {
    return { id: -1, t, hz: h.hz, lo: h.lo, hi: h.hi, amp: h.strength * (0.4 + 0.6 * this.texture.level), attack: 1, bright: clamp(upOfHz(h.hz)), rough: h.noisy };
  }

  /** Let the music run to `t`: sounds due by then begin, every brush that is down moves on, and sounds that have ended are lifted. */
  advance(t: number) {
    if (this.now >= 0 && t < this.now - 0.5) this.lift();
    if (t <= this.now) return;
    this.now = t;
    if (this.waiting.length) {
      this.waiting.sort((a, b) => a.t - b.t);
      while (this.waiting.length && this.waiting[0].t <= t) {
        const c = this.waiting.shift()!;
        if (c.len === 0 || c.drum || this.layer === "drums") this.thrown(c);
        else this.begin(c);
      }
    }
    // an ear that has gone quiet (its stem is no longer heard: the painting moved on to another source) leaves no brush down
    if (this.heardAt >= 0 && t - this.heardAt > 0.4)
      for (const s of this.strokes.values()) if (s.cue.len === undefined && s.until === Infinity) s.until = Math.max(s.t, this.heardAt);
    for (const s of [...this.strokes.values()]) this.move(s, Math.min(t, s.until));
    for (const [id, s] of this.strokes) {
      if (s.until <= t) {
        this.release(s);
        this.strokes.delete(id);
      }
    }
    if (this.layer === "other" || this.layer === "chords") this.haze(t);
  }

  // ── brushes ──

  /** How big a brush is for a tone at `hz` (design pixels of radius, at full strength), by layer. */
  private sizeOf(hz: number): number {
    const low = Math.pow(1 - clamp(upOfHz(hz)), 1.6);
    switch (this.layer) {
      case "bass":
        return 9 + 9 * low;
      case "melody":
        return 2.6 + 6.5 * low;
      case "harmony":
        return 1.7 + 4 * low;
      case "vocals":
        return 3.4 + 5 * low;
      case "chords":
        return 5 + 9 * low;
      default:
        return 3 + 8 * low;
    }
  }

  private begin(c: Cue) {
    if (this.layer === "drums") return this.thrown(c);
    const seed = this.seedOf(c);
    const r = rng(seed);
    const p = this.where(c.t, upOfHz(c.hz));
    if (!p) return;
    // an overtone of a tone already being painted (a whole multiple of its pitch, heard soon after it began, and
    // quiet enough; in a line, a voice or a bass, any whole multiple) is part of that tone's sound: an ear hears each
    // overtone of a note as a tone, but a painter paints the note. (The app's own notes are known exactly: none of
    // them is an overtone, and an octave in a chord is a note of the chord.)
    const u = this.u * p.scale;
    const heard = c.len === undefined;
    const oneLine = this.layer === "melody" || this.layer === "harmony" || this.layer === "bass" || this.layer === "vocals";
    if (c.of !== undefined) return;
    if (heard)
      for (const o of this.strokes.values()) {
        if (o.cue.len !== undefined || c.t - o.cue.t > 0.35 || c.t < o.cue.t - 0.06) continue;
        if (overtoneOf(c.hz, c.amp, o.hz, o.amp, oneLine)) return;
      }
    // a note heard a moment after its own overtones: they were part of it all along
    if (heard)
      for (const [id, o] of this.strokes) {
        if (o.cue.len !== undefined || o.cue.t < c.t - 0.12) continue;
        if (overtoneOf(o.hz, o.amp, c.hz, c.amp, oneLine)) this.strokes.delete(id);
      }
    // a tone that stopped a moment ago at this pitch, heard again (an ear loses a tone for a few hundredths of a second
    // when something passes over it): the same brush carries on, without being set down afresh
    const back = heard ? this.lifted.findIndex((l) => l.seg === p.seg && c.t - l.t < 0.09 && c.t >= l.t - 0.02 && Math.abs(midiOfHz(c.hz) - midiOfHz(l.hz)) < 0.7) : -1;
    const again = back >= 0;
    const ln = again ? this.lifted.splice(back, 1)[0] : this.line;
    const rgb = this.colourOf(c.hz, c.bright, r);
    const until = c.len !== undefined ? c.t + Math.max(0.01, c.len) : Infinity;
    const s: Stroke = {
      cue: c,
      until,
      hz: c.hz,
      amp: c.amp,
      x: p.x,
      y: p.y + gauss(r) * 0.8 * u * (1 + 2 * this.manner.loose),
      vx: 0,
      vy: 0,
      px: p.x,
      py: p.y,
      t: c.t,
      seg: p.seg,
      size: this.sizeOf(c.hz) * (0.8 + 0.4 * r()),
      k: paintOf(rgb),
      rgb,
      lean: gauss(r) * 0.2,
      load: 0.8 + 0.2 * r(),
      reach: (150 + 500 * r() * r()) * this.u * (0.6 + 0.8 * c.amp) * this.touch.stroke,
      water: clamp(0.5 + 0.5 * (r() - 0.5)),
      r: 0,
      scale: p.scale,
      rand: r,
      seed: r() * 97,
      laid: c.t,
      laidAt: null,
      marks: 0,
      aim: midiOfHz(c.hz),
      up: upOfHz(c.hz),
    };
    s.py = s.y;
    // a line: a note that follows closely on the last carries on from where that one's brush was
    const lineLayer = oneLine;
    // (a leap is a new stroke: the line is joined only to a note close by, a step or two away, or a few for a voice)
    const near = ln ? Math.abs(midiOfHz(c.hz) - midiOfHz(ln.hz)) <= (this.layer === "bass" ? 2.5 : 5.5) : false;
    if (ln && (again || (lineLayer && near && ln.seg === p.seg && c.t - ln.t < JOIN && c.t >= ln.t - 0.02 && !ln.short))) {
      s.x = ln.x;
      s.y = ln.y;
      s.vx = ln.vx;
      s.vy = ln.vy;
      s.px = ln.x;
      s.py = ln.y;
      s.load = Math.max(s.load * 0.85, ln.load);
      // the line keeps one paint: a new note tints it, it does not change it (and the same note picked up again is the same paint)
      s.rgb = again ? ln.rgb : mixRgb(ln.rgb, rgb, 0.35);
      s.k = again ? ln.k : paintOf(s.rgb);
      // the line goes on to the new pitch from the last one: it glides there, as a brush would
      if (!again) {
        s.up = upOfHz(ln.hz);
        s.glide = this.glideTo(s.up, upOfHz(c.hz), c.t, c.len);
      }
    }
    if (this.layer === "vocals") {
      const n = 12;
      s.strands = again && ln?.strands ? ln.strands : Array.from({ length: n }, () => ({ x: s.x, y: s.y, ax: 0, ay: 0, ease: 0.6 + 0.2 * r(), off: gauss(r), px: s.x, py: s.y }));
    }
    this.strokes.set(c.id, s);
    s.r = this.radius(s, c.amp);
    // picked up again: nothing is set down
    if (again) {
      s.r = Math.max(s.r, 0.6);
      return;
    }
    const m = this.manner;
    const short = c.len !== undefined && c.len < SHORT;
    // set down: a struck sound lands with weight, and may throw a few drops
    switch (this.layer) {
      case "chords":
        this.chordOnset(s, short);
        break;
      case "bass":
        this.mark(s, s.x, s.y, s.r * (1 + 0.25 * c.attack), p, 1.3, short ? 0.9 : undefined);
        break;
      case "vocals":
        break;
      default:
        this.mark(s, s.x, s.y, s.r * (1 + 0.35 * c.attack), p, 1.25);
    }
    if (c.attack > 0.7 && c.amp > 0.45 && this.layer !== "vocals" && this.layer !== "other" && r() < 0.35 + 0.4 * c.rough)
      this.spatter(s.x, s.y, s.r * 2.2, Math.round((2 + 5 * r()) * this.touch.density), s.k, 0.45 * s.r, 0.5, -p.dx, -p.dy, m);
  }

  /** How wide the brush marks right now (real pixels of radius): pressed as hard as the sound is loud. */
  private radius(s: Stroke, amp: number): number {
    const press = 0.2 + 0.95 * Math.pow(clamp(amp), 1.4);
    return Math.max(0.6, s.size * press * this.u * s.scale);
  }

  /** The loudness of a sound whose shape is known (the app's own notes): plucked ones die away, held ones stay. */
  private envelope(s: Stroke, t: number): number {
    const c = s.cue;
    if (c.len === undefined) return s.amp;
    const age = Math.max(0, t - c.t);
    const ring = Math.max(0.05, c.ring ?? 2);
    // a struck sound dies away by 30 dB over its ring; a swelled one holds
    const fall = Math.pow(10, (-1.5 * age) / ring);
    return c.amp * (c.attack > 0.4 ? fall : 0.85 + 0.15 * fall);
  }

  /** Move a brush on to where the music is at `t`, leaving marks along the way. */
  private move(s: Stroke, t: number) {
    if (t <= s.t) return;
    const m = this.manner;
    let at = s.t;
    while (at < t - 1e-6) {
      const dt = Math.min(1 / 60, t - at);
      at += dt;
      const p = this.where(at, this.upOf(s, at));
      if (!p) {
        s.until = Math.min(s.until, at);
        break;
      }
      if (p.seg !== s.seg) {
        // the music came round again (or jumped): the brush is lifted and set down afresh
        s.seg = p.seg;
        s.x = s.px = p.x;
        s.y = s.py = p.y;
        s.vx = s.vy = 0;
        s.laidAt = null;
        // (the voice's strands are lifted with it: they do not chase across the canvas to where it is set down)
        for (const st of s.strands ?? []) {
          st.x = st.px = p.x;
          st.y = st.py = p.y;
          st.ax = st.ay = 0;
        }
        if (this.line) this.line = null;
      }
      const amp = s.cue.len !== undefined ? this.envelope(s, at) : s.amp;
      const wander = m.loose * this.u;
      const tx = p.x + (noise(at * 0.8 + s.seed, 3) - 0.5) * 4 * wander;
      const ty = p.y + (noise(at * 1.1 + s.seed * 1.7, 5) - 0.5) * 5 * wander;
      const h = dt / 2;
      for (let i = 0; i < 2; i++) {
        s.vx += ((tx - s.x) * SPRING * SPRING - DAMP * s.vx) * h;
        s.vy += ((ty - s.y) * SPRING * SPRING - DAMP * s.vy) * h;
        s.x += s.vx * h;
        s.y += s.vy * h;
      }
      // the sound swelled well past where it was: the brush is dipped again
      if (amp > s.amp + 0.18 && s.cue.len === undefined) s.load = Math.max(s.load, 0.7 + 0.3 * s.rand());
      s.scale = p.scale;
      const want = this.radius(s, amp);
      s.r += (want - s.r) * clamp(dt / 0.03);
      if (s.strands) this.ribbon(s, p, amp, dt);
      else if (this.layer === "chords") this.wash(s, at, p, amp);
      else this.pull(s, p);
      s.t = at;
    }
    if (this.layer === "melody" || this.layer === "harmony" || this.layer === "bass" || this.layer === "vocals") this.line = this.memory(s, false);
  }

  /**
   * How a line goes from height `from` to height `to` (on the frequency scale), starting at `t`:
   * as long as it takes to climb no steeper than `MAX_SLOPE` at the speed the music runs across
   * the canvas there, within `GLIDE_MAX` and a part of what is left of the note (`len`, when known).
   */
  private glideTo(from: number, to: number, t: number, len?: number): Stroke["glide"] {
    const a = this.where(t, from);
    const b = this.where(t, to);
    const ahead = this.where(t + 0.05, to);
    if (!a || !b || !ahead || ahead.seg !== b.seg) return undefined;
    const rise = Math.hypot(b.x - a.x, b.y - a.y);
    const speed = Math.hypot(ahead.x - b.x, ahead.y - b.y) / 0.05;
    // (an eased glide is steepest in its middle: half as steep again as on average)
    const want = (1.5 * rise) / Math.max(1e-6, MAX_SLOPE * speed);
    const dur = Math.min(want, GLIDE_MAX, len !== undefined ? GLIDE_PART * Math.max(0.02, len) : GLIDE_MAX);
    return dur > 1e-3 ? { from, to, t0: t, dur } : undefined;
  }

  /** The height on the frequency scale a brush is at, at `t`: a line glides from pitch to pitch; anything else is where its sound is. */
  private upOf(s: Stroke, t: number): number {
    const up = upOfHz(s.hz);
    if (!isLine(this.layer)) return up;
    const midi = midiOfHz(s.hz);
    if (Math.abs(midi - s.aim) > GLIDE_FROM) {
      // the tone stepped to another pitch (the ear followed it there): a glide from where the line is
      const left = s.cue.len !== undefined ? Math.max(0, s.cue.t + s.cue.len - t) : undefined;
      s.glide = this.glideTo(s.up, up, t, left);
    } else if (s.glide && midi !== s.aim) {
      // it moved a little (vibrato, a slide): the way there moves with it
      const d = up - s.glide.to;
      s.glide = { ...s.glide, from: s.glide.from + d, to: up };
    }
    s.aim = midi;
    let out = up;
    const g = s.glide;
    if (g) {
      const f = (t - g.t0) / g.dur;
      if (f >= 1) s.glide = undefined;
      else out = g.from + (g.to - g.from) * smooth(f);
    }
    s.up = out;
    return out;
  }

  private memory(s: Stroke, short: boolean): Lifted {
    return { x: s.x, y: s.y, vx: s.vx, vy: s.vy, t: s.t, seg: s.seg, load: s.load, short, k: s.k, rgb: s.rgb, hz: s.hz, strands: s.strands };
  }

  /** Leave marks along the way from where the last one was left to where the tip is now. */
  private pull(s: Stroke, p: Place) {
    const dx = s.x - s.px;
    const dy = s.y - s.py;
    const dist = Math.hypot(dx, dy);
    const flat = this.layer === "bass";
    const space = Math.max(0.7, s.r * (flat ? 0.5 : 0.34));
    if (dist < space) return;
    const n = Math.min(40, Math.floor(dist / space));
    for (let i = 1; i <= n; i++) {
      const f = (i * space) / dist;
      const x = s.px + dx * f;
      const y = s.py + dy * f;
      this.mark(s, x, y, s.r, p, 1);
      s.load = Math.max(0, s.load - space / s.reach);
      if (this.layer === "melody" || this.layer === "harmony") this.remember(x, y, s);
    }
    s.px += dx * ((n * space) / dist);
    s.py += dy * ((n * space) / dist);
  }

  /** Where the line has been (for the harmony's hatching); and the hatching itself. */
  private remember(x: number, y: number, s: Stroke) {
    this.trail.push({ x, y, t: s.t });
    if (this.trail.length > 90) this.trail.shift();
    s.marks++;
    if (this.layer !== "harmony" || !this.partner || s.marks % 2) return;
    // Harmony's "sketchy" brush: link this point to points of the melody nearby, more surely the
    // nearer they are, drawing only the middle of each link; rougher harmony, denser hatching
    const lim = 64 * this.u;
    const r = s.rand;
    const rough = clamp(0.3 + 0.9 * s.cue.rough + 0.4 * this.texture.rough);
    for (const q of this.partner.trail) {
      const dx = q.x - x;
      const dy = q.y - y;
      const d = dx * dx + dy * dy;
      if (d > lim * lim || d < 9 * this.u * this.u) continue;
      if (r() > (1 - d / (lim * lim * 0.55)) * rough * 0.5) continue;
      const a = Math.atan2(dy, dx);
      const steps = Math.max(2, Math.round(Math.sqrt(d) * 0.4 / (1.2 * this.u)));
      for (let i = 0; i <= steps; i++) {
        const f = 0.3 + (0.4 * i) / steps;
        this.emit({ x: x + dx * f, y: y + dy * f, r: (0.55 + 0.35 * r()) * this.u, angle: a, stretch: 2.2, k: s.k, paint: 0.09 * this.manner.body, water: 0.02, vx: 0, vy: 0, load: 0.55, kind: 0, hard: 0.7, seed: r() * 97 });
      }
    }
  }

  /** One touch of a brush. */
  private mark(s: Stroke, x: number, y: number, radius: number, p: Place, weight: number, hardOverride?: number) {
    const { rand: r } = s;
    const m = this.manner;
    const wet = clamp(m.wet * (0.5 + s.water));
    // how the brush moves over the paint (on a flowing canvas, the paint moves under it)
    const vx = s.vx - this.flow.x;
    const vy = s.vy - this.flow.y;
    const speed = Math.hypot(vx, vy);
    // (the bass's slabs lie along the band whichever way its brush moves: a slide does not stand them on end)
    const ang = speed > 1 && this.layer !== "bass" ? Math.atan2(vy, vx) : Math.atan2(p.dy, p.dx);
    const size = radius * (0.87 + 0.26 * r());
    const side = gauss(r) * radius * 0.07 * (0.5 + m.loose);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    const rough = clamp(0.6 * s.cue.rough + 0.4 * this.texture.rough);
    let share = 0.17 * weight * m.body * (0.78 + 0.3 * r()) * (0.45 + 0.75 * clamp(radius / Math.max(0.5, s.size * this.u * s.scale)));
    let stretch = 1.25 + Math.min(0.9, speed / (140 * this.u));
    let water = share * wet * 2.2;
    let hard = hardOverride ?? 0.35 + 0.45 * (1 - wet) + 0.2 * s.cue.attack;
    let load = clamp(s.load + 0.25 * wet - 0.45 * rough);
    let kind = 0;
    if (this.layer === "bass") {
      // flat and heavy: long dabs laid along the band
      stretch = 2.2 + Math.min(1.2, speed / (90 * this.u));
      share *= 1.15;
      water *= 0.8;
    } else if (this.layer === "harmony") {
      share *= 0.85;
      hard = Math.max(hard, 0.55);
    } else if (this.layer === "melody") {
      share *= 1.12;
    } else if (this.layer === "other") {
      kind = 2;
      share *= 0.35;
      water = share * 4;
      hard = 0.05;
      load = 1;
    }
    this.emit({
      x: x + nx * side,
      y: y + ny * side,
      r: size,
      angle: ang + s.lean * 0.3,
      stretch,
      k: s.k,
      paint: share * (1.15 - 0.55 * wet),
      water,
      vx: s.vx * 0.5,
      vy: s.vy * 0.5,
      load,
      kind,
      hard: clamp(hard),
      seed: s.seed,
    });
  }

  private emit(st: Stamp) {
    this.made++;
    this.put(st);
  }

  /** The sound stopped: the brush is lifted, leaving a short tail the way it was going. */
  private release(s: Stroke) {
    const short = s.cue.len !== undefined ? s.cue.len < SHORT : s.t - s.cue.t < SHORT;
    const lineLayer = this.layer === "melody" || this.layer === "harmony" || this.layer === "bass" || this.layer === "vocals";
    if (lineLayer) this.line = this.memory(s, short);
    if (s.cue.len === undefined) {
      while (this.lifted.length && this.lifted[0].t < s.t - 0.1) this.lifted.shift();
      this.lifted.push(this.memory(s, short));
    }
    if (this.layer === "chords") {
      if (short) this.block(s);
      return;
    }
    if (s.r < 0.9 * this.u || this.layer === "vocals" || this.layer === "other") return;
    // a line that goes straight on into its next note has no tail
    if (lineLayer && !short) return;
    const r = s.rand;
    const vx = s.vx - this.flow.x;
    const vy = s.vy - this.flow.y;
    const speed = Math.hypot(vx, vy);
    const ang = speed > 4 ? Math.atan2(vy, vx) + gauss(r) * 0.25 : gauss(r) * 0.5;
    const ring = s.cue.ring ?? 0.4;
    const len = s.r * (1 + 1.4 * r() + Math.min(2, speed / (120 * this.u)) + Math.min(1.5, ring));
    const n = Math.max(2, Math.round(len / Math.max(0.7, s.r * 0.4)));
    const p: Place = { x: s.x, y: s.y, dx: Math.cos(ang), dy: Math.sin(ang), seg: s.seg, scale: s.scale };
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const ease = 1 - f * f;
      s.load *= 0.86;
      this.mark(s, s.px + Math.cos(ang) * len * f, s.py + Math.sin(ang) * len * f, s.r * (0.25 + 0.75 * ease), p, 0.9 * ease + 0.1, this.layer === "bass" ? 0.85 : undefined);
    }
  }

  // ── the vocals: a ribbon ──

  /** Harmony's "ribbon": every strand chases the voice on its own spring and leaves a fine line of light. */
  private ribbon(s: Stroke, p: Place, amp: number, dt: number) {
    const strands = s.strands!;
    const u = this.u * s.scale;
    // breath splays the strands across the line; a clean voice keeps them close
    const splay = (2 + 9 * clamp(0.3 * s.cue.rough + 0.7 * this.texture.rough)) * u * (0.6 + 0.6 * amp);
    const nx = -p.dy;
    const ny = p.dx;
    const steps = Math.max(1, Math.round(dt * 60));
    const glow = 0.08 + 0.16 * amp;
    for (const st of strands) {
      const tx = s.x + nx * st.off * splay;
      const ty = s.y + ny * st.off * splay;
      for (let k = 0; k < steps; k++) {
        st.ax = (st.ax + (st.x - tx) * 0.1) * st.ease;
        st.ay = (st.ay + (st.y - ty) * 0.1) * st.ease;
        st.x -= st.ax;
        st.y -= st.ay;
      }
      const dx = st.x - st.px;
      const dy = st.y - st.py;
      const d = Math.hypot(dx, dy);
      const space = Math.max(1.1 * this.u, 1.6 * u);
      if (d < space) continue;
      const n = Math.min(20, Math.floor(d / space));
      for (let i = 1; i <= n; i++) {
        const f = (i * space) / d;
        this.emit({
          x: st.px + dx * f,
          y: st.py + dy * f,
          r: (0.7 + 0.9 * amp) * u * (0.8 + 0.4 * s.rand()),
          angle: Math.atan2(dy, dx),
          stretch: 2.4,
          k: s.k,
          paint: glow * this.manner.body,
          water: 0.03 * this.manner.wet,
          vx: 0,
          vy: 0,
          load: 0.9,
          kind: 3,
          hard: 0.55,
          seed: s.seed,
          pigment: this.col?.dark === false ? 0.75 : 0.3,
        });
      }
      st.px += dx * ((n * space) / d);
      st.py += dy * ((n * space) / d);
    }
    s.px = s.x;
    s.py = s.y;
  }

  // ── the chords: washes and blocks ──

  /** The notes of the chord that are sounding now. */
  private sounding(): Stroke[] {
    return [...this.strokes.values()];
  }
  /** How rough the chord sounding now is: pairs of notes a semitone or a tone apart beat against each other. */
  private tension(): number {
    const pcs = this.sounding().map((s) => ((Math.round(midiOfHz(s.hz)) % 12) + 12) % 12);
    let rough = 0;
    for (let i = 0; i < pcs.length; i++)
      for (let j = i + 1; j < pcs.length; j++) {
        const d = Math.min((pcs[i] - pcs[j] + 12) % 12, (pcs[j] - pcs[i] + 12) % 12);
        if (d === 1) rough += 1;
        else if (d === 2) rough += 0.4;
        else if (d === 6) rough += 0.5;
      }
    return clamp(rough / 2);
  }

  /** A chord note begins: a soft bloom where it is. */
  private chordOnset(s: Stroke, short: boolean) {
    const r = s.rand;
    const c = s.cue;
    const size = (9 + 11 * c.amp) * this.u * s.scale * (0.8 + 0.4 * r());
    const wet = clamp(this.manner.wet + 0.25);
    if (short) return;
    this.emit({ x: s.x + gauss(r) * 2 * this.u, y: s.y + gauss(r) * 2 * this.u, r: size, angle: r() * TAU, stretch: 1 + 0.4 * r(), k: s.k, paint: (0.07 + 0.09 * c.amp) * this.manner.body, water: (0.25 + 0.6 * wet) * (0.6 + 0.5 * c.amp), vx: 0, vy: 0, load: 1, kind: 2, hard: 0.12 + 0.4 * c.attack * (1 - wet), seed: s.seed });
  }

  /**
   * While a chord rings, a wash is laid across it: from below its lowest note to above its
   * highest, a little further along each moment, in the colour of its lowest note mixed with
   * the rest. The more it clashes, the more thin layers, the greyer and cooler.
   */
  private wash(s: Stroke, t: number, p: Place, amp: number) {
    // a stabbed chord is a block, laid when it ends, not a wash
    if (s.cue.len !== undefined && s.cue.len < SHORT) return;
    // one wash for the whole chord: the lowest sounding note lays it
    const notes = this.sounding();
    if (!notes.length || notes.reduce((a, b) => (b.hz < a.hz ? b : a), notes[0]) !== s) return;
    // a new band of wash each time the music has moved on by half a touch (or, where it hardly moves, a few times a second)
    const here = this.where(t, upOfHz(s.hz));
    if (!here) return;
    const touch = 9 * this.u * here.scale;
    const moved = s.laidAt ? Math.hypot(here.x - s.laidAt.x, here.y - s.laidAt.y) : Infinity;
    if (moved < touch * 0.6 / Math.max(0.5, this.touch.density) && t - s.laid < 0.25) return;
    s.laid = t;
    s.laidAt = { x: here.x, y: here.y };
    let lo = Infinity;
    let hi = -Infinity;
    let loud = 0;
    let rgb: RGB = [0, 0, 0];
    let wsum = 0;
    // a chord's notes lie within an octave and a half or so of its lowest: anything far above is not part of its wash
    const floor = upOfHz(s.hz);
    for (const n of notes) {
      const up = upOfHz(n.hz);
      if (up > floor + CHORD_SPAN) continue;
      lo = Math.min(lo, up);
      hi = Math.max(hi, up);
      const a = n.cue.len !== undefined ? this.envelope(n, t) : n.amp;
      loud = Math.max(loud, a);
      const w = n === s ? 2 : 1;
      rgb = [rgb[0] + n.rgb[0] * w, rgb[1] + n.rgb[1] * w, rgb[2] + n.rgb[2] * w];
      wsum += w;
    }
    void amp;
    if (loud < 0.04) return;
    rgb = [rgb[0] / wsum, rgb[1] / wsum, rgb[2] / wsum];
    const tension = this.tension();
    if (tension > 0) rgb = mixRgb(rgb, [128, 132, 140], 0.3 * tension);
    const k = paintOf(rgb);
    const pad = 0.025;
    const from = lo - pad;
    const to = hi + pad;
    const layers = 1 + Math.round(2 * tension + (to - from > 0.12 ? 1 : 0));
    const r = s.rand;
    const wet = clamp(this.manner.wet + 0.2);
    for (let L = 0; L < layers; L++) {
      // up the span in overlapping soft touches
      const span = Math.max(0.01, to - from);
      const n = Math.max(2, Math.min(14, Math.ceil(span / 0.035)));
      for (let i = 0; i <= n; i++) {
        const up = from + (span * (i + (r() - 0.5) * 0.6)) / n;
        const q = this.where(t, up);
        if (!q) continue;
        const size = (7 + 7 * loud) * this.u * q.scale * (0.75 + 0.5 * r());
        this.emit({ x: q.x + gauss(r) * 3 * this.u, y: q.y + gauss(r) * 2 * this.u, r: size, angle: Math.atan2(q.dy, q.dx), stretch: 1.3 + 0.5 * r(), k, paint: (0.01 + 0.026 * loud) * this.manner.body, water: (0.08 + 0.35 * wet) * (0.4 + loud), vx: q.dx * 6 * this.u, vy: q.dy * 6 * this.u, load: 1, kind: 2, hard: 0.08, seed: r() * 97 });
      }
    }
    void p;
  }

  /** A stabbed chord: a hard-edged block over the span of its notes. */
  private block(s: Stroke) {
    const notes = [s, ...this.sounding().filter((n) => n !== s && Math.abs(n.cue.t - s.cue.t) < 0.05)];
    let lo = Infinity;
    let hi = -Infinity;
    const floor = Math.min(...notes.map((n) => upOfHz(n.hz)));
    for (const n of notes) {
      const up = upOfHz(n.hz);
      if (up > floor + CHORD_SPAN) continue;
      lo = Math.min(lo, up);
      hi = Math.max(hi, up);
    }
    const r = s.rand;
    const n = Math.max(1, Math.ceil((hi - lo + 0.03) / 0.04));
    for (let i = 0; i <= n; i++) {
      const up = lo - 0.012 + ((hi - lo + 0.024) * i) / n;
      const q = this.where(s.cue.t, up);
      if (!q) continue;
      this.emit({ x: q.x, y: q.y, r: (4 + 6 * s.cue.amp) * this.u * q.scale, angle: Math.atan2(q.dy, q.dx) + Math.PI / 2, stretch: 1.6, k: s.k, paint: (0.14 + 0.16 * s.cue.amp) * this.manner.body, water: 0.03, vx: 0, vy: 0, load: clamp(0.85 - 0.4 * s.cue.rough), kind: 0, hard: 0.92, seed: r() * 97 });
    }
  }

  // ── fog, and noise that goes on ──

  /** Fog drifts in where the other sounds (pads, ambience) are: wide, edge-less, very thin. */
  private haze(t: number) {
    if (this.layer !== "other") return;
    // (only sound that goes on makes fog, and only as much of it as is noise: a drum's ring that leaks into the stem
    // comes and goes, and clean tones are the chords' and the melody's)
    const lv = Math.min(this.texture.level, this.texture.floor * 1.3) * (this.texture.air ?? 1);
    if (lv < 0.08) return;
    const every = 0.18 / (0.4 + lv);
    if (t - this.fogT < every) return;
    this.fogT = t;
    const r = rng(this.seedOf({ id: 0, t, hz: 0, amp: 0, attack: 0, bright: 0, rough: 0 }, 77));
    // where its sound is: around the brightness of the layer, wide
    const up = clamp(0.15 + 0.7 * this.texture.bright + gauss(r) * 0.12);
    const p = this.where(t, up);
    if (!p) return;
    const rgb = brighten(this.col?.other ?? [180, 180, 180], this.texture.bright, 0.6);
    this.emit({ x: p.x + gauss(r) * 22 * this.u, y: p.y + gauss(r) * 14 * this.u, r: (38 + 46 * lv) * this.u * p.scale * (0.7 + 0.6 * r()), angle: r() * TAU, stretch: 1.4 + 0.8 * r(), k: paintOf(varied(rgb, r, 1.5)), paint: (0.012 + 0.03 * lv) * this.manner.body, water: 0.5 + 0.6 * this.manner.wet, vx: p.dx * 10 * this.u, vy: p.dy * 10 * this.u, load: 1, kind: 2, hard: 0, seed: r() * 97 });
  }

  /** Noise that goes on (a cymbal's wash, breath, a hiss): a dry brush scrubbed lightly where it is, or fog. */
  private scrub(f: Frame) {
    const r = rng(this.seedOf({ id: 0, t: f.t, hz: 1, amp: 0, attack: 0, bright: 0, rough: 0 }, 13));
    const dt = 0.01;
    // (a hiss up among the cymbals is the drums': in any other layer it has leaked in from them)
    const bands = this.layer === "drums" ? NOISE_BANDS : NOISE_BANDS - HIGH_BANDS;
    for (let b = 0; b < bands; b++) {
      const n = f.noise[b];
      if (n < 0.25) continue;
      if (r() > (n - 0.2) * 18 * dt * this.touch.density) continue;
      const hz = noiseHz(b) * Math.pow(2, (r() - 0.5) / 3);
      const up = upOfHz(hz);
      const p = this.where(f.t, up);
      if (!p) continue;
      if (this.layer === "drums") {
        // a cymbal or a hat ringing on: specks and short scratches
        this.speck(p, hz, n * 0.6, r, f.t);
        continue;
      }
      if (this.layer === "vocals" || this.layer === "melody" || this.layer === "harmony") continue;
      const tone = mixRgb(this.col?.other ?? [150, 150, 150], this.col?.hat ?? [40, 40, 40], 0.3);
      this.emit({ x: p.x - p.dx * r() * 10 * this.u, y: p.y + gauss(r) * 2 * this.u, r: (2.5 + 7 * (1 - up) + 4 * n) * this.u * (0.6 + 0.8 * r()), angle: Math.atan2(p.dy, p.dx) + gauss(r) * 0.4, stretch: 1.6 + 1.4 * r(), k: paintOf(tone), paint: 0.16 * this.manner.body * (0.5 + n), water: 0.1 * this.manner.wet, vx: p.dx * 20 * this.u, vy: p.dy * 20 * this.u, load: 0.18 + 0.3 * n * r(), kind: 0, hard: 0.5, seed: r() * 97 });
    }
  }

  // ── the drums: thrown ──

  /** Drops of paint about a point. Most are small, a few large (and the large ones thinner), as real spatter is. */
  private spatter(x: number, y: number, spread: number, count: number, k: [number, number, number], median: number, sigma: number, dirX: number, dirY: number, m: Manner, r: Rng = rng(Math.round(x * 31 + y * 17) >>> 0), tall = 0, cone = 0.7) {
    const wet = clamp(m.wet + 0.15);
    for (let i = 0; i < count; i++) {
      const size = clamp(median * Math.exp(gauss(r) * sigma), 0.45 * this.u, 11 * this.u);
      const far = Math.abs(gauss(r)) * spread * this.touch.spread;
      const a = Math.atan2(dirY, dirX) + gauss(r) * (dirX === 0 && dirY === 0 ? 3 : cone);
      const big = Math.min(1, (median / size) * (median / size));
      this.emit({
        x: x + Math.cos(a) * far + gauss(r) * spread * 0.2,
        y: y + Math.sin(a) * far + gauss(r) * (spread * 0.2 + tall),
        r: size,
        angle: a,
        stretch: 1 + Math.min(1.4, far / (spread + 1)) * r(),
        k,
        paint: 0.55 * m.body * (0.35 + 0.65 * big) * (0.8 + 0.4 * r()),
        water: wet * (0.5 + 0.6 * r()) * (size > 4 * this.u ? 1.2 : 0.5),
        vx: Math.cos(a) * 30 * this.u,
        vy: Math.sin(a) * 30 * this.u,
        load: 1,
        kind: 1,
        hard: 0.6 + 0.35 * r(),
        seed: r() * 97,
      });
    }
  }

  /** A speck or a short scratch, dry, near the top: a hat. */
  private speck(p: Place, hz: number, s: number, r: Rng, t: number) {
    const u = this.u * p.scale;
    const c = this.col;
    const rgb = varied(c ? (r() < 0.6 ? c.hat : c.drums) : [40, 40, 40], r, 1.2);
    const scratch = r() < 0.35;
    void hz;
    void t;
    this.emit({
      x: p.x + gauss(r) * 7 * u,
      y: p.y + gauss(r) * 5 * u,
      r: (scratch ? 0.7 : 0.5 + 0.9 * r()) * u * (0.8 + 0.6 * s),
      angle: Math.atan2(p.dy, p.dx) + gauss(r) * 0.6,
      stretch: scratch ? 3 + 3 * r() : 1 + 0.4 * r(),
      k: paintOf(rgb),
      paint: (0.35 + 0.35 * s) * this.manner.body,
      water: 0.02,
      vx: 0,
      vy: 0,
      load: scratch ? 0.35 : 1,
      kind: scratch ? 0 : 1,
      hard: 0.85,
      seed: r() * 97,
    });
  }

  /** A hit: what it is decides what is thrown. */
  private thrown(c: Cue) {
    const r = rng(this.seedOf(c, 5));
    // a hit heard by an ear (no drum named) that reaches right down and is not noisy is a kick: an ear hears its weight
    // a little higher than its thump, because of its click, so it is laid where its thump is
    const thump = this.layer === "drums" && c.drum === undefined && c.lo !== undefined && c.lo < 120 && c.rough < 0.45;
    const up = clamp(upOfHz(thump ? Math.max(45, Math.min(c.hz, c.lo! * 1.6)) : c.hz));
    const p = this.where(c.t, up);
    if (!p) return;
    const u = this.u * p.scale;
    const m = this.manner;
    const s = clamp(c.amp);
    const col = this.col;
    const drum = c.drum ?? (thump || (c.rough < 0.45 && up < 0.3) ? "kick" : up > 0.68 ? (c.ring !== undefined && c.ring > 0.6 ? "crash" : "hat") : c.rough > 0.4 ? "snare" : "tom");
    const kind = /kick|808/.test(drum) ? "kick" : /hat|open|shaker|ride|crash|cymbal|tamb|bell/.test(drum) ? (/open|crash|ride|cymbal/.test(drum) ? "cymbal" : "hat") : /snare|clap|rim|snap/.test(drum) ? "snare" : "tom";
    if (this.layer !== "drums") {
      // the hit of a struck note in another layer: a few drops off its attack, nothing more
      if (c.attack < 0.5 || s < 0.3) return;
      const rgb = this.colourOf(c.hz, c.bright, r);
      this.spatter(p.x, p.y, (4 + 10 * s) * u, Math.round((1 + 5 * s * c.rough) * this.touch.density), paintOf(rgb), 1.2 * u, 0.6, p.dx, p.dy, m, r);
      return;
    }
    if (kind === "kick") {
      // a thump: one soft, flattened blot where its weight is, harder-edged the sharper it starts, with a halo as long as it rings
      const rgb = varied(brighten(col?.kick ?? [40, 30, 30], c.bright, 0.5), r, 1);
      const k = paintOf(rgb);
      const size = (12 + 20 * s) * u * (0.85 + 0.3 * r());
      const ang = Math.atan2(p.dy, p.dx);
      this.emit({ x: p.x + gauss(r) * 2 * u, y: p.y + gauss(r) * 2 * u, r: size, angle: ang + Math.PI / 2, stretch: 1.3, k, paint: (0.07 + 0.13 * s) * m.body, water: (0.3 + 0.6 * m.wet) * (0.6 + 0.4 * s), vx: 0, vy: 0, load: 1, kind: 2, hard: 0.08 + 0.4 * c.attack * (1 - 0.5 * m.wet), seed: r() * 97 });
      const halo = Math.min(1.5, c.ring ?? 0.3);
      if (halo > 0.15) this.emit({ x: p.x, y: p.y, r: size * (1.35 + 0.6 * halo), angle: ang + Math.PI / 2, stretch: 1.4, k, paint: 0.05 * s * m.body * halo, water: 0.4 + 0.4 * m.wet, vx: 0, vy: 0, load: 1, kind: 2, hard: 0, seed: r() * 97 });
      this.spatter(p.x, p.y, size * 1.1, Math.round((1 + 5 * s * r()) * this.touch.density), k, 1.5 * u, 0.7, 0, 0, m, r);
      return;
    }
    if (kind === "snare" || kind === "tom") {
      // a burst of hard little drops in a cone; noisier, wider; louder, more
      const rgb = varied(brighten(kind === "tom" ? col?.kick ?? [60, 40, 40] : col?.drums ?? [60, 40, 40], c.bright, 0.7), r, 1);
      const count = Math.round((kind === "tom" ? 6 + 14 * s : 10 + 36 * s) * (0.5 + 0.7 * c.rough) * this.touch.density);
      const median = (0.9 + 2.3 * s * (1 - 0.5 * c.rough)) * u;
      const dir = gauss(r) * 0.5 + (r() < 0.5 ? Math.PI : 0) * 0.15;
      const a = Math.atan2(p.dy, p.dx) + Math.PI / 2 + dir;
      this.spatter(p.x, p.y, (6 + 16 * s) * u * (0.6 + 0.8 * c.rough), count, paintOf(rgb), median, 0.35 + 0.4 * (1 - c.rough) + 0.2 * s, Math.cos(a), Math.sin(a), m, r, 0, 0.45 + 0.6 * c.rough);
      if (kind === "tom") this.emit({ x: p.x, y: p.y, r: (6 + 8 * s) * u, angle: r() * TAU, stretch: 1.1, k: paintOf(rgb), paint: 0.14 * s * m.body, water: 0.3 + 0.4 * m.wet, vx: 0, vy: 0, load: 1, kind: 2, hard: 0.35, seed: r() * 97 });
      return;
    }
    // hats and cymbals: dry specks near the top, more for a busier, louder hat; a cymbal leaves a trail as long as it rings
    const n = Math.round((3 + 9 * s) * this.touch.density);
    for (let i = 0; i < n; i++) this.speck(p, c.hz, s, r, c.t);
    if (kind === "cymbal") {
      const ring = Math.min(2, c.ring ?? 1);
      const trail = Math.round(4 + 8 * ring * s);
      for (let i = 1; i <= trail; i++) {
        const q = this.where(c.t + (i / trail) * ring * 0.8, clamp(up + gauss(r) * 0.03));
        if (q) this.speck(q, c.hz, s * (1 - i / (trail + 1)), r, c.t);
      }
    }
  }
}
