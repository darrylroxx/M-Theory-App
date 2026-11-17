/**
 * The painter: it listens to the song and paints what it hears, where it hears it.
 *
 * Across is time: a painting is as wide as its bars. Up and down is frequency, an octave to every
 * equal step, so a sound is painted at the height of the frequencies it is really made of. Every
 * section of the song has its own painting (long sections have several, one after another).
 *
 * Nothing here knows what a "hi-hat" or a "bass note" should look like. Every sound arrives with
 * its own measurements (which frequencies it is made of, how wide each is, how long each rings,
 * whether it is a tone or a noise, how hard it starts) and the mark is made from those:
 *
 * - how long a mark is across = how long the sound lasts;
 * - how tall = how much of the frequency scale it covers;
 * - how heavy = how loud;
 * - a sound that is over at once is paint put down and lifted: a dab, a dot, a print, a spatter;
 * - a sound that lasts is paint pulled along: a stroke, which runs dry as the sound dies away;
 * - a note that takes over from another on the same string while it still sounds is the same
 *   stroke carried on, sloping up to a higher note and down to a lower one;
 * - a tone is a line or a shape, a noise is a spray; a note's overtones are thin lines above it.
 *
 * A stroke is made the way a hand makes one, in one quick movement, not drawn out at the speed
 * of the music: nothing creeps across the canvas.
 *
 * When a section comes round again it is painted over what is there, and what is there is first
 * let fade a little, all over at once, so the newest pass is the clearest.
 */
import { BANDS, bandHz, bandOf, type Part } from "../audio/describe";
import type { DrumId } from "../audio/drums";
import type { DrumPulse, NotePulse, Pulse } from "../audio/pulse";
import { hexToRgb, mix, shade, vary, type RGB } from "./color";
import { MARGIN, colorIndex, hzOfMidi, midiOfHz, noteColors, pageOf, spanPx, speed, xOf, yOfHz, type Page, type Spot } from "./layout";
import { CLOUDS, backrun, cloud, dab, drip, flam, later, paintPath, ring, speckle, splatter, touch, wash, type Brush, type Cloud, type G, type Mark, type Pt, type Touch, type WashOpts } from "./marks";
import { roles, type Palette } from "./palettes";
import { between, gauss, noise, rng, type Rng } from "./rand";

/** The three parts of the mix that can be listened to on their own. */
export type StemId = "chords" | "melody" | "drums";
export const STEM_IDS: StemId[] = ["chords", "melody", "drums"];

const TAU = Math.PI * 2;
const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const smooth = (t: number) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
/**
 * Music has less in it the higher up it goes: about 4.5 dB less for every octave. Analysers tilt
 * what they show by that much, so that a balanced mix looks level and a gap looks like a gap. The
 * bands here are a fixed part of an octave wide, which makes up 3 dB of it; this is the rest
 * (in dB, for a band; nothing at 1 kHz).
 */
export const tilt = (band: number) => 1.5 * Math.log2(bandHz(band) / 1000);
/** How much of a sound is left `t` seconds after it began, if it rings for `ring` seconds (until it is 30 dB down): 1 = all of it. */
export const left = (t: number, ring: number) => Math.pow(10, (-1.5 * Math.max(0, t)) / Math.max(0.02, ring));
/** The first choice most of the time, something else from the pool now and then. */
function pick<T>(first: T, pool: readonly T[], r: Rng, stray: number): T {
  return r() < stray ? pool[Math.floor(r() * pool.length)] : first;
}
/**
 * The shape of a touch follows the sound. People match harsh sounds (bright ones that start with
 * a click) to shapes with corners, and soft or dull ones to round shapes: so a sound that swells
 * in, or a low thump, is always round, and a bright hard one usually has corners.
 */
function shaped(kind: Touch, pool: readonly Touch[], harsh: number, r: Rng): Touch {
  const want = harsh < 0.35 ? "round" : harsh > 0.7 && r() < 0.7 ? "angular" : "";
  if (!want || (want === "angular") === ANGULAR.has(kind)) return kind;
  const fit = pool.filter((k) => (want === "angular") === ANGULAR.has(k));
  return fit.length ? fit[Math.floor(r() * fit.length)] : kind;
}
/** How harsh a sound is, 0..1: how hard it starts, and how high its energy sits (nothing under 300 Hz is harsh; by 3 kHz everything that clicks is). */
const harshness = (attack: number, hz: number, hard: number) => clamp(attack) * clamp(Math.log2(Math.max(1, hz) / 300) / 3.3) * (0.6 + 0.4 * clamp(hard));

// ── what each kind of sound may be painted with ──
/** Strokes for notes that last: low strings, middle strings, high strings, the melody's line. */
export const LOW_BRUSH: Brush[] = ["wash", "bristle", "wet", "double", "knife", "side", "bone"];
export const MID_BRUSH: Brush[] = ["wash", "bristle", "ribbon", "dry", "double", "wet", "chalk", "side", "reed", "bone"];
export const HIGH_BRUSH: Brush[] = ["liner", "ribbon", "dry", "wash", "dashes", "fan", "reed", "sketch"];
export const TUNE_BRUSH: Brush[] = ["wash", "ribbon", "bristle", "nib", "bone", "side"];
/**
 * The brushes a painting may take as its habit: the ones with body. The lighter ones above (a
 * reed pen, a dry drag, a sketched line) are turned to now and then, never all the time.
 */
const LOW_USUAL: Brush[] = ["wash", "bristle", "wet", "double", "knife", "bone"];
const MID_USUAL: Brush[] = ["wash", "bristle", "ribbon", "wet", "double", "bone"];
const HIGH_USUAL: Brush[] = ["ribbon", "liner", "wash", "bristle", "reed"];
const TUNE_USUAL: Brush[] = ["wash", "ribbon", "bristle", "nib", "bone"];
/** A noise that lasts (an open cymbal, a shaker's swish). */
export const DRAG_BRUSH: Brush[] = ["spray", "dry", "hatch", "fan", "chalk", "scribble"];
/** Touches for notes that are over at once: low, middle, high, and the melody. */
export const LOW_DAB: Touch[] = ["round", "blot", "tile", "sponge", "petal", "block", "bloom"];
export const MID_DAB: Touch[] = ["round", "petal", "teardrop", "tile", "pair", "diamond", "comma", "wedge", "seed", "block", "stamp"];
export const HIGH_DAB: Touch[] = ["dot", "bead", "tick", "tally", "burst", "ringdrop", "comma", "dash", "crescent", "diamond", "wedge", "edge", "stamp"];
export const TUNE_DAB: Touch[] = ["bead", "round", "teardrop", "diamond", "petal", "wedge"];
/** A sound that starts hard and dies away at once is a shape that does the same: a head and a taper, as long as the sound. */
export const TAPER: Touch[] = ["teardrop", "wedge", "comma", "leaf", "nail", "dash", "petal", "tile", "blade"];
/** Shapes with corners and spikes. People match hard, sudden sounds to these and soft ones to round shapes. */
export const ANGULAR: ReadonlySet<Touch> = new Set<Touch>(["tile", "tick", "tally", "burst", "dash", "diamond", "wedge", "block", "edge", "blade", "crown"]);
/** Paint thrown for a short noise, by drum. */
const DRUM_CLOUDS: Record<DrumId, Cloud[]> = {
  kick: ["grit", "stipple", "tap"],
  tom: ["grit", "stipple", "tap"],
  snare: ["grit", "mist", "shards", "flick", "tap"],
  clap: ["shards", "grit", "fanTap", "tap"],
  bell: ["stipple", "mist"],
  rim: ["stipple", "shards"],
  hat: ["stipple", "fanTap", "grit", "flick", "mist", "rain"],
  open: ["fanTap", "mist", "rain", "scumble"],
  shaker: ["mist", "rain", "grit", "scumble"],
};

/**
 * The habits of one painting: which brush is reached for first, how the brush is put down for a
 * short note, how the hand leans and how steady it is. Every section of the song has its own, so
 * the verse does not look like the chorus; inside a section they are habits, not rules.
 */
export interface Hand {
  low: Brush;
  mid: Brush;
  high: Brush;
  tune: Brush;
  drag: Brush;
  dabLow: Touch;
  dabMid: Touch;
  dabHigh: Touch;
  dabTune: Touch;
  cloudOf: Record<DrumId, Cloud>;
  /** the lean of every stroke (radians), how much the hand shakes and how much a string is seen to swing (1 = as usual) */
  lean: number;
  shake: number;
  ripple: number;
}
export function habits(letter: string, seed: number): Hand {
  let h = seed | 0;
  for (let i = 0; i < letter.length; i++) h = Math.imul(h ^ letter.charCodeAt(i), 0x9e3779b1);
  const r = rng(h >>> 0);
  const of = <T>(pool: readonly T[]): T => pool[Math.floor(r() * pool.length)];
  const cloudOf = {} as Record<DrumId, Cloud>;
  for (const id of Object.keys(DRUM_CLOUDS) as DrumId[]) cloudOf[id] = of(DRUM_CLOUDS[id]);
  return {
    low: of(LOW_USUAL),
    mid: of(MID_USUAL),
    high: of(HIGH_USUAL),
    tune: of(TUNE_USUAL),
    drag: of(DRAG_BRUSH),
    dabLow: of(LOW_DAB),
    dabMid: of(MID_DAB),
    dabHigh: of(HIGH_DAB),
    dabTune: of(TUNE_DAB),
    cloudOf,
    lean: gauss(r) * 0.01,
    shake: between(r, 0.7, 1.35),
    ripple: between(r, 0.65, 1.25),
  };
}

interface Layer {
  key: string;
  /** the paint of earlier passes, dry */
  canvas: HTMLCanvasElement;
  g: G;
  /** when it was last the one on show */
  seen: number;
  /** nothing has been painted on it yet */
  bare: boolean;
  /** how far across the pass now being painted began, and how far it has got (0..1; −1 = there has been none) */
  from: number;
  to: number;
  hand: Hand;
}
/** The last note on one string: a note that takes over from it carries its stroke on. */
interface Voice {
  layer: Layer;
  /** when it began and when its mark ends (audio clock, seconds) */
  time: number;
  end: number;
  x: number;
  y: number;
  midi: number;
}

/** How much of the old paint is left after the music has passed over it once more. */
export const FADES = [
  { id: 0, label: "Keep", keep: 1 },
  { id: 1, label: "Slow", keep: 0.74 },
  { id: 2, label: "Fast", keep: 0.42 },
] as const;
/** Old paint is let fade in this many steps, this far apart (milliseconds): few enough that faint paint fades too, close enough that no step is seen. */
const FADE_STEPS = 7;
const FADE_EVERY = 105;
const MAX_LAYERS = 10;
const MAX_MARKS = 260;
/** How long the measured levels are averaged over for the coverage guide (seconds). */
const COVER_SECONDS = 6;

export class Painter {
  private layers = new Map<string, Layer>();
  private cur: Layer | null = null;
  /** this pass's paint, still wet: it lies over the dry paint of the painting on show, and joins it when the pass is over */
  private wet: { canvas: HTMLCanvasElement; g: G; owner: Layer | null };
  private marks: { g: G; m: Mark }[] = [];
  private W = 1;
  private H = 1;
  private dpr = 1;
  private r: Rng;
  private page: Page | null = null;
  private spot: Spot | null = null;
  private lastFrac = -1;
  private clock = 0;
  private voices = new Map<string, Voice>();
  /** how much paint is on the brush for the chords and for the melody (1 = just loaded) */
  private load = { chord: 1, melody: 1 };
  /**
   * What the hand is doing just now, for each kind of sound: which touch, which brush. A hand
   * goes on making the same mark for a while and then changes, and all the notes of one strum
   * are one gesture: they are made the same way.
   */
  private manners = new Map<string, { time: number; touch: Touch; taper: Touch; brush: Brush; cloud: Cloud }>();
  /** where thin paint was lately put down and has not dried yet: a touch that lands there spreads, and now and then a backrun opens */
  private pools: { x: number; y: number; rx: number; ry: number; until: number; color: RGB }[] = [];
  /**
   * The hand's drift: how much bigger or smaller than usual it is making things just now, and
   * which way it is turning them. Each mark is a little different from the last, but not wildly:
   * a hand wanders, it does not throw dice.
   */
  private mood = { size: 0, turn: 0 };
  /** old paint being let fade: where, how many steps are left, how much each takes off */
  private fade: { l: Layer; a: number; b: number; left: number; alpha: number; wait: number } | null = null;
  /** the colour last painted at each height (and when), so that what goes on sounding there can be painted in it */
  private tint: (RGB | null)[] = new Array(BANDS).fill(null);
  private tintAt = new Float64Array(BANDS);
  /** how loud each part of the mix has lately been at each height: for the coverage guide */
  private cover: Record<StemId, Float32Array> = { chords: new Float32Array(BANDS), melody: new Float32Array(BANDS), drums: new Float32Array(BANDS) };
  private loudest = 1e-9;
  /** how many marks have been made (for tests, and to tell an empty canvas from a painted one) */
  made = 0;
  /** what was made last, in words (for tests) */
  last = "";

  /** the colour each of the twelve notes takes (see `noteColors`) */
  private map: number[];
  private tonic = 0;
  private scale: number[] = [0, 2, 4, 5, 7, 9, 11];

  constructor(
    private host: HTMLElement,
    private pal: Palette,
    private keep = 0.74,
    private seed = 20260417,
  ) {
    this.r = rng(seed);
    this.map = noteColors(this.tonic, this.scale, pal.colors.length);
    const canvas = document.createElement("canvas");
    canvas.className = "cv-wet";
    host.appendChild(canvas);
    this.wet = { canvas, g: canvas.getContext("2d")!, owner: null };
  }

  /** The size of the canvas on screen, and how many real pixels there are to each of its pixels. */
  size(width: number, height: number, dpr: number) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.W && h === this.H && dpr === this.dpr && this.wet.canvas.width === Math.round(w * dpr)) return;
    this.finish();
    this.settle();
    for (const l of this.layers.values()) {
      // the painting is kept: it is stretched onto the new size
      const old = document.createElement("canvas");
      old.width = l.canvas.width;
      old.height = l.canvas.height;
      old.getContext("2d")!.drawImage(l.canvas, 0, 0);
      l.canvas.width = Math.round(w * dpr);
      l.canvas.height = Math.round(h * dpr);
      l.g.setTransform(1, 0, 0, 1, 0, 0);
      l.g.drawImage(old, 0, 0, l.canvas.width, l.canvas.height);
      l.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    this.wet.canvas.width = Math.round(w * dpr);
    this.wet.canvas.height = Math.round(h * dpr);
    this.wet.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.voices.clear();
    this.W = w;
    this.H = h;
    this.dpr = dpr;
  }

  setPalette(p: Palette) {
    this.pal = p;
    this.map = noteColors(this.tonic, this.scale, p.colors.length);
  }
  /** The key of the song: its home note and the notes of its scale (0–11). The note colours follow it. */
  setKey(tonicPc: number, scale: number[]) {
    this.tonic = tonicPc;
    this.scale = scale;
    this.map = noteColors(tonicPc, scale, this.pal.colors.length);
  }
  setKeep(keep: number) {
    this.keep = keep;
  }

  /** Start again with a bare canvas. */
  clear() {
    for (const l of this.layers.values()) l.canvas.remove();
    this.layers.clear();
    this.cur = null;
    this.marks = [];
    this.fade = null;
    this.voices.clear();
    this.manners.clear();
    this.wet.g.clearRect(0, 0, this.W, this.H);
    this.wet.owner = null;
    this.lastFrac = -1;
    this.made = 0;
    this.tint.fill(null);
    for (const s of STEM_IDS) this.cover[s].fill(0);
    this.loudest = 1e-9;
  }

  /** The painter is done with: its canvases are taken away. */
  destroy() {
    this.clear();
    this.wet.canvas.remove();
  }

  /** The names of the paintings there are, and the one on show. */
  keys(): string[] {
    return [...this.layers.keys()];
  }
  showing(): string | null {
    return this.cur?.key ?? null;
  }
  busy(): boolean {
    return this.marks.length > 0 || !!this.fade;
  }
  /** The habits of the painting on show (for tests). */
  hand(): Hand | null {
    return this.cur?.hand ?? null;
  }

  private layer(key: string): Layer {
    let l = this.layers.get(key);
    if (l) return l;
    const canvas = document.createElement("canvas");
    canvas.className = "cv-layer";
    canvas.dataset.key = key;
    canvas.width = Math.round(this.W * this.dpr);
    canvas.height = Math.round(this.H * this.dpr);
    canvas.style.opacity = "0";
    const g = canvas.getContext("2d")!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // under the wet paint
    this.host.insertBefore(canvas, this.wet.canvas);
    // every canvas of a section is painted by the same hand
    l = { key, canvas, g, seen: this.clock, bare: true, from: -1, to: -1, hand: habits(key.split(":")[0], this.seed) };
    this.layers.set(key, l);
    if (this.layers.size > MAX_LAYERS) {
      // the painting that has been out of sight longest makes room
      const old = [...this.layers.values()].filter((x) => x !== l && x !== this.cur).sort((a, b) => a.seen - b.seen)[0];
      if (old) {
        old.canvas.remove();
        this.layers.delete(old.key);
        this.marks = this.marks.filter((x) => x.g !== old.g);
        if (this.fade?.l === old) this.fade = null;
      }
    }
    return l;
  }

  /** Finish, at once, every mark that is still being made. */
  private finish() {
    for (const k of this.marks) {
      k.g.save();
      for (let i = 0; i < 90 && !k.m.step(40); i++);
      k.g.restore();
    }
    this.marks = [];
  }

  /** One step of letting old paint fade: the same all over (or all over the bars that are being played again), so nothing is seen to move. */
  private fadeStep(f: NonNullable<Painter["fade"]>) {
    const g = f.l.g;
    const { W, H } = this;
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.globalAlpha = f.alpha;
    if (f.a <= 0 && f.b >= W) {
      g.fillStyle = "#000";
      g.fillRect(0, 0, W, H);
    } else {
      // only some of the bars: the edges of the fade are soft
      const soft = Math.max(8, W * 0.035);
      const a = f.a - soft;
      const b = f.b + soft;
      const gr = g.createLinearGradient(a, 0, b, 0);
      gr.addColorStop(0, "rgba(0,0,0,0)");
      gr.addColorStop(Math.min(0.49, soft / (b - a)), "rgba(0,0,0,1)");
      gr.addColorStop(Math.max(0.51, 1 - soft / (b - a)), "rgba(0,0,0,1)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(a, 0, b - a, H);
    }
    g.restore();
    f.left--;
  }

  /** Let what is left of a fade happen at once, and let the wet paint dry onto the painting it belongs to. */
  private settle() {
    const f = this.fade;
    if (f) {
      while (f.left > 0) this.fadeStep(f);
      this.fade = null;
    }
    const w = this.wet;
    if (w.owner && this.layers.has(w.owner.key)) {
      w.owner.g.save();
      w.owner.g.globalCompositeOperation = "source-over";
      w.owner.g.globalAlpha = 1;
      w.owner.g.drawImage(w.canvas, 0, 0, this.W, this.H);
      w.owner.g.restore();
    }
    w.g.clearRect(0, 0, this.W, this.H);
    w.owner = null;
    this.pools = [];
  }

  /** Lay a wash, and remember that the canvas is wet there for a while. */
  private pool(g: G, o: WashOpts) {
    this.add(g, wash(g, o));
    this.pools.push({ x: o.x, y: o.y, rx: o.rx, ry: o.ry, until: this.clock + 2800, color: o.color });
    if (this.pools.length > 24) this.pools.shift();
  }
  /** Is the canvas still wet here? (The wash that made it so, if it is.) */
  private damp(x: number, y: number) {
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      if (p.until < this.clock) continue;
      const dx = (x - p.x) / p.rx;
      const dy = (y - p.y) / p.ry;
      if (dx * dx + dy * dy < 0.8) return p;
    }
    return null;
  }
  /**
   * Put the brush down. On dry canvas the touch is crisp; where the canvas is still wet it
   * spreads into a soft bloom, and now and then the water it brings pushes the wash back and
   * leaves a backrun beside it.
   */
  private put(g: G, kind: Touch, o: Parameters<typeof touch>[2]) {
    const wet = this.damp(o.x, o.y);
    if (wet) {
      touch(g, "bloom", { ...o, r: o.r * 0.9, alpha: (o.alpha ?? 0.9) * 0.8 });
      if (this.r() < 0.22) {
        const way = this.r() * TAU;
        const rad = o.r * between(this.r, 1.5, 2.4);
        this.add(g, later(between(this.r, 200, 600), () => backrun(g, { x: o.x + Math.cos(way) * rad * 1.1, y: o.y + Math.sin(way) * rad * 0.7, r: rad, color: wet.color, rng: this.r })));
      }
    }
    touch(g, kind, wet ? { ...o, alpha: (o.alpha ?? 0.9) * 0.82 } : o);
  }

  /**
   * The music is about to cross a painting again: the last pass's paint dries, and (unless old
   * paint is kept) what is on the bars about to be played is let fade a little, everywhere at once.
   */
  private pass(l: Layer, frac: number) {
    this.settle();
    this.voices.clear();
    if (this.keep < 1 && !l.bare) {
      const a = frac < 0.02 ? 0 : xOf(frac, this.W) - this.W * 0.01;
      // as far as the last pass went (or to the end, if this pass starts beyond it)
      const b = l.to >= frac + 0.02 && l.to < 0.98 ? xOf(l.to, this.W) + this.W * 0.03 : this.W;
      this.fade = { l, a, b, left: FADE_STEPS, alpha: 1 - Math.pow(this.keep, 1 / FADE_STEPS), wait: 0 };
      // the first step is taken now, so the fade is under way before the first note of the pass is painted
      this.fadeStep(this.fade);
    }
    l.from = frac;
    l.to = frac;
  }

  /**
   * Tell the painter where the music is (or null when it has stopped). The right painting is put
   * on show; when the music starts across it again, a new pass begins.
   */
  at(spot: Spot | null) {
    this.spot = spot;
    if (!spot) {
      this.page = null;
      this.lastFrac = -1;
      return;
    }
    const page = pageOf(spot, this.W);
    const l = this.layer(page.key);
    const entered = l !== this.cur;
    // a new pass: the painting has just come on show, the music has just started, or it has gone back
    const again = entered || this.lastFrac < 0 || page.frac < this.lastFrac - 0.01;
    if (entered) {
      // strokes still being made on the painting that is left are finished at once
      this.finish();
      this.settle();
      if (this.cur) this.cur.canvas.style.opacity = "0";
      l.canvas.style.opacity = "1";
      this.cur = l;
    }
    if (again) this.pass(l, page.frac);
    l.seen = this.clock;
    l.to = Math.max(l.to, page.frac);
    this.lastFrac = page.frac;
    this.page = page;
  }

  private add(g: G, m: Mark) {
    this.marks.push({ g, m });
    if (this.marks.length > MAX_MARKS) {
      // too many at once: the oldest are finished off rather than dropped half made
      const over = this.marks.splice(0, this.marks.length - MAX_MARKS);
      for (const k of over) {
        k.g.save();
        for (let i = 0; i < 90 && !k.m.step(40); i++);
        k.g.restore();
      }
    }
  }

  /** Remember what colour was painted at a frequency, so that what goes on sounding there is painted in it. */
  private stain(hz: number, color: RGB) {
    const b = Math.round(bandOf(hz) - 0.5);
    if (b < 0 || b >= BANDS) return;
    this.tint[b] = color;
    this.tintAt[b] = this.clock;
  }

  /**
   * Something sounded: paint it, where the music is now. `late` = how many seconds ago it was
   * heard (a frame may have been slow): the mark is put where the music was then.
   */
  hit(p: Pulse, late = 0) {
    const l = this.cur;
    const page = this.page;
    const spot = this.spot;
    if (!l || !page || !spot) return;
    const sp = speed(page, spot, this.W);
    const x = xOf(page.frac, this.W) - clamp(late, 0, 0.25) * sp;
    this.made++;
    if (l.bare) {
      l.bare = false;
      this.ground(l, spot);
    }
    this.wet.owner = l;
    const g = this.wet.g;
    // the hand drifts: each mark's size and turn is the last one's, changed a little
    this.mood.size = 0.82 * this.mood.size + 0.57 * gauss(this.r) * 0.07;
    this.mood.turn = 0.82 * this.mood.turn + 0.57 * gauss(this.r) * 0.1;
    g.save();
    if (p.kind === "drum") this.drum(l, p, x, sp, spot);
    else this.note(l, p, x, sp, spot);
    g.restore();
  }

  /**
   * The way the hand is making marks for one kind of sound on one painting. It starts as the
   * painting's own habit; at the start of a new gesture it now and then turns to something else
   * (`change` = how often), and then stays with that.
   */
  private manner(l: Layer, what: string, time: number, change: number, first: { touch: Touch; brush: Brush; cloud?: Cloud }, pools: { touch: readonly Touch[]; brush: readonly Brush[]; cloud?: readonly Cloud[] }, harsh: number) {
    const r = this.r;
    const key = `${l.key}|${what}`;
    let m = this.manners.get(key);
    if (!m) m = { time, touch: shaped(first.touch, pools.touch, harsh, r), taper: TAPER[Math.max(0, pools.touch.indexOf(first.touch)) % TAPER.length], brush: first.brush, cloud: first.cloud ?? "mist" };
    else if (time - m.time > 0.09 && r() < change) {
      // one thing changes at a time
      const which = r();
      if (which < 0.4) m.touch = shaped(pick(first.touch, pools.touch, r, 0.7), pools.touch, harsh, r);
      else if (which < 0.6) m.taper = TAPER[Math.floor(r() * TAPER.length)];
      else if (which < 0.85) m.brush = pick(first.brush, pools.brush, r, 0.7);
      else if (pools.cloud) m.cloud = pick(first.cloud ?? "mist", pools.cloud, r, 0.7);
    }
    m.time = time;
    this.manners.set(key, m);
    return m;
  }

  /** Take paint for a stroke: how full the brush is (1 = just dipped). It is dipped again when it runs low. */
  private dip(kind: "chord" | "melody", uses: number): { load: number; fresh: boolean } {
    let load = this.load[kind];
    const fresh = load < 0.3 || this.r() < 0.06;
    if (fresh) load = 1;
    this.load[kind] = Math.max(0, load - uses * between(this.r, 0.6, 1.4));
    return { load, fresh };
  }

  /**
   * The path of a stroke for a sound that lasts: from where the sound begins to where it ends,
   * at the height of its frequency.
   * - The brush presses hardest and has most paint where the sound is loudest, at its start, and
   *   has less of both as the sound dies away.
   * - A string swings widely when it is plucked and comes to rest: so does the line, in waves
   *   that are long for a low note and short for a high one.
   * - If it takes over from another note (`joined`), it starts at that note's height and slopes
   *   to its own.
   */
  private trace(o: {
    /** where the stroke starts and ends, and where the sound itself begins (x) */
    xs: number;
    xe: number;
    x: number;
    y: number;
    /** the height it starts at, and where the slope to its own height ends (when it is joined) */
    ys: number;
    slopeTo: number;
    joined: boolean;
    /** pixels a second, how long the sound rings (seconds), and whether a hand stops it before it has died away */
    sp: number;
    ring: number;
    damped: boolean;
    /** the swing of the line: its wavelength and how far it goes (pixels) */
    lam: number;
    amp: number;
    /** how far a pitch that slides starts above its note (pixels; negative = below), and how fast it gets there (seconds) */
    fall?: number;
    fallIn?: number;
    /** how far the end of the stroke is flicked to one side as the brush leaves (pixels; negative = up) */
    hook?: number;
    load: number;
    hand: Hand;
    u: number;
  }): Pt[] {
    const r = this.r;
    const total = Math.max(1, o.xe - o.xs);
    const step = Math.min(2.2, Math.max(0.8, o.lam / 7));
    const n = Math.max(2, Math.ceil(total / step) + 1);
    const seed = Math.floor(r() * 9973);
    const phase = r() * TAU;
    const len = Math.max(1, o.xe - o.x);
    const bow = gauss(r) * Math.min(o.u * 0.4, len * 0.012);
    /** how far the brush travels while it is being pressed down, and while it is being lifted */
    const press = o.u * between(r, 0.9, 1.9);
    const lift = Math.max(o.u * 1.3, len * between(r, 0.08, 0.17));
    const lean = Math.tan(o.hand.lean);
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const xx = o.xs + (total * i) / (n - 1);
      const since = (xx - o.x) / o.sp;
      const e = left(since, o.ring);
      const along = clamp((xx - o.x) / len);
      let yy = o.joined && xx < o.slopeTo ? o.ys + (o.y - o.ys) * smooth((xx - o.xs) / Math.max(1, o.slopeTo - o.xs)) : o.y;
      yy += bow * Math.sin(Math.PI * along) + (xx - o.x) * lean + (noise(xx / (o.u * 7), seed) - 0.5) * o.u * 0.5 * o.hand.shake;
      // (the swing is never quite even: a string does not, and a hand does not)
      if (xx >= o.x && o.amp) yy += o.amp * Math.pow(e, 0.75) * (0.45 + 1.1 * noise(xx / (o.lam * 2.3), seed + 5)) * Math.sin(phase + (TAU * (xx - o.x)) / o.lam);
      if (o.fall) yy -= o.fall * Math.exp(-Math.max(0, since) / Math.max(0.004, o.fallIn ?? 0.03));
      let w = 0.46 + 0.54 * Math.pow(e, 0.4);
      if (!o.joined) w *= Math.min(1, 0.35 + (0.65 * (xx - o.xs)) / press);
      const end = (o.xe - xx) / lift;
      if (o.hook && end < 1) yy += o.hook * (1 - end) * (1 - end);
      // a note that is stopped ends bluntly, with paint still on the brush; one left to ring trails off
      if (end < 1) w *= o.damped ? 0.62 + 0.38 * end : 0.28 + 0.72 * end;
      const a = clamp(Math.pow(e, 0.5) * (0.55 + 0.45 * o.load) + (o.damped ? 0.1 : 0));
      pts.push({ x: xx, y: yy, w, a });
    }
    return pts;
  }

  /** How long the swing of a line is for a frequency: long for a low note, short for a high one (pixels). */
  private wave(hz: number, u: number) {
    return u * clamp(7.5 * Math.sqrt(110 / Math.max(20, hz)), 0.85, 10);
  }

  /** How long a brush takes to make a stroke this long (milliseconds): a hand is quick, and quicker over a short distance. */
  private quick(px: number) {
    // (a figure drawn twice the size takes a hand only a little longer: the time goes up with about the cube root of the distance)
    return clamp(210 * Math.pow(Math.max(4, px) / 60, 0.3), 120, 560) * between(this.r, 0.8, 1.25);
  }

  /** A plucked string: a note of a chord, or a note of the melody. */
  private note(l: Layer, p: NotePulse, x: number, sp: number, spot: Spot) {
    const { W, H, r } = this;
    const g = this.wet.g;
    const pal = this.pal;
    const role = roles(pal);
    const hand = l.hand;
    /** one hundredth of the canvas's shorter side: sizes are in these, so a painting looks the same large or small */
    const u = Math.min(W, H) / 100;
    const beatPx = sp * spot.spb;
    const tune = p.kind === "melody";
    const s = p.sound;
    const f0 = hzOfMidi(p.midi);
    /** how tall a semitone is, where this note is */
    const semi = spanPx(f0, 1 / 12, H);
    const y = yOfHz(f0, H);
    const v = clamp(p.velocity, 0.12, 1);
    /** how loud it is in the mix: its fader, and how hard the string is plucked (by the law the sound itself follows) */
    const loud = clamp(Math.pow(v, 1.3) * clamp(p.gain, 0.05, 1.8) * (tune ? 0.75 : 1.3), 0.08, 1);
    /** how long it is heard: until the hand stops it, or it has all but died away by itself */
    const rings = Math.max(0.05, s.ring * 0.7);
    const dur = Math.max(0.03, Math.min(p.length, rings));
    const damped = p.length < rings;
    const maxX = W * (1 - MARGIN * 0.25);
    const lenPx = Math.max(1, Math.min(dur * sp, maxX - x));
    /** low strings, middle strings, high strings */
    const reg = f0 < 131 ? 0 : f0 < 523 ? 1 : 2;
    const n = pal.colors.length;
    const at = colorIndex(p.midi, this.map, n, spot.index + (tune ? 1 : 0));
    // a hard pluck is a bright one, and a bright sound is a lighter colour
    const col = shade(vary(pal.colors[at], r, tune ? 0.6 : 1), (v - 0.65) * 0.14);
    const ink = hexToRgb(pal.ink);
    // as wide as it is loud, but never so wide that the note next to it cannot be told from it
    let width = u * (tune ? 0.9 + 1.1 * loud : [1.2, 0.9, 0.6][reg] + [1.9, 1.3, 0.9][reg] * loud) * (1 + this.mood.size) * between(r, 0.94, 1.07);
    width = Math.max(1.4, Math.min(width, semi * (tune ? 2.6 : [4, 2.5, 2][reg])));
    const pools = { touch: tune ? TUNE_DAB : [LOW_DAB, MID_DAB, HIGH_DAB][reg], brush: tune ? TUNE_BRUSH : [LOW_BRUSH, MID_BRUSH, HIGH_BRUSH][reg] };
    const how = this.manner(l, `${p.kind}${reg}`, p.time, 0.2, { touch: tune ? hand.dabTune : [hand.dabLow, hand.dabMid, hand.dabHigh][reg], brush: tune ? hand.tune : [hand.low, hand.mid, hand.high][reg] }, pools, harshness(s.attack, Math.min(p.cutoff, s.centre * 2), v));
    this.stain(f0, col);

    const key = `${p.kind}:${p.slot}`;
    const prev = p.slot >= 0 ? this.voices.get(key) : undefined;
    /** it takes over from another note on the same string, which was still sounding: the stroke is carried on */
    const joined = !!prev && prev.layer === l && p.time - prev.end < 0.09 && p.time - prev.time > 0.05 && x - prev.x > 2 && prev.midi !== p.midi;
    if (p.slot >= 0) this.voices.set(key, { layer: l, time: p.time, end: p.time + dur, x, y, midi: p.midi });
    /** how big a touch for this note is */
    const rad = Math.max(u * 0.6, width * (tune ? 0.8 : 0.85));
    /**
     * Over at once: paint put down and lifted. A note that is gone in the time it takes to make a
     * dab is a dab; one that lasts a little longer is a shape with a head and a taper, as long as
     * the note; anything longer is a stroke.
     */
    const dabbed = !joined && lenPx < rad * 2.6;
    const tapered = !joined && !dabbed && lenPx < rad * 6;
    const stac = dabbed || tapered;
    this.last = `${p.kind} ${dabbed ? "touch" : tapered ? "taper" : joined ? "slur" : "stroke"}`;

    if (stac) {
      const kind = tapered ? how.taper : how.touch;
      const long = tapered ? clamp(lenPx / (rad * 1.9), 1.2, 3) : clamp(lenPx / (rad * 1.5), 1, 3);
      const cx = tapered ? x + rad * 0.7 : x + Math.max(rad * 0.55, lenPx * 0.5);
      const cy = y + gauss(r) * semi * 0.1;
      // on a dark ground a note is a point of light
      if (role.dark) touch(g, "halo", { x: cx, y: cy, r: rad * 1.7, color: col, rng: r, alpha: 0.5 });
      this.put(g, kind, { x: cx, y: cy, r: tapered ? rad * 0.85 : rad, color: col, rng: r, dir: hand.lean * 4 + this.mood.turn * (tapered ? 0.5 : 1), alpha: 0.62 + 0.38 * loud, long });
      // the pen goes round a note of the melody
      if (tune) ring(g, { x: cx, y: cy, r: rad * between(r, 1.15, 1.4), w: Math.max(0.7, u * 0.15), color: ink, rng: r, alpha: 0.75 });
      // a short note hit hard throws a little paint the way the hand was going
      if (v > 0.78 && r() < 0.3) speckle(g, { x: cx + rad * between(r, 1.5, 3), y: cy - rad * between(r, 0.2, 1.4), n: 2 + Math.floor(r() * 5), sx: rad * 1.2, sy: rad * 0.7, color: col, rng: r, size: u * 0.2 });
      this.last += ` ${kind}`;
    } else {
      const lead = joined ? Math.min((x - prev!.x) * 0.45, beatPx * 0.22, u * 4) : 0;
      const xs = x - lead;
      // a note that is stopped (by the hand, or by its string being plucked again) ends a moment early: the brush is lifted before it comes down for the next
      const breath = damped ? Math.max(2.5, Math.min(lenPx * 0.14, u * 1.3)) : 0;
      const xe = Math.min(maxX, x + lenPx - breath);
      const slopeTo = joined ? x + Math.min(lenPx * 0.45, beatPx * 0.3, u * 5) : x;
      const { load, fresh } = joined ? { load: Math.max(0.35, this.load[p.kind]), fresh: false } : this.dip(p.kind, tune ? 0.16 : 0.07);
      // a note that is stopped short: now and then the hand flicks the brush off the canvas as it lifts
      const hook = damped && xe < maxX - 1 && r() < 0.2 ? width * between(r, 0.5, 1.1) * (r() < 0.8 ? -1 : 1) : 0;
      const pts = this.trace({ xs, xe, x, y, ys: joined ? prev!.y : y, slopeTo, joined, sp, ring: s.ring, damped, lam: this.wave(f0, u), amp: u * (tune ? 0.3 : 0.22) * (0.3 + 0.7 * loud) * hand.ripple, hook, load, hand, u });
      const ms = this.quick(xe - xs);
      const wait = between(r, 0, 30);
      const brush = how.brush;
      if (tune) {
        // the melody: a stroke of its own colour, and over it a thin line of ink, so it can be told from the chords at a glance
        this.add(g, later(wait, () => paintPath(g, pts, { brush, width, color: col, r, ms, alpha: 0.7 + 0.3 * loud, dry: 0.15 + 0.45 * (1 - load), glow: role.dark, maxX })));
        this.add(g, later(wait + 30, () => paintPath(g, pts, { brush: "liner", width: Math.max(0.9, u * 0.2), color: ink, r, ms, alpha: 0.85, maxX })));
        if (!joined) touch(g, "bead", { x, y, r: width * 0.62, color: col, rng: r, alpha: 0.95 });
        this.last += ` ${brush}`;
      } else {
        const second = brush === "double" ? vary(pal.colors[(at + 1) % n], r) : undefined;
        // a note that is left to ring: thin paint first, wider than the stroke, which the stroke then sits in
        if (xe - xs > beatPx * 0.6 && brush !== "wash" && brush !== "wet") this.add(g, later(wait, () => paintPath(g, pts, { brush: "wash", width: width * 1.9, color: col, r, ms, alpha: 0.3 + 0.25 * loud, maxX })));
        this.add(g, later(wait + 20, () => paintPath(g, pts, { brush, width, color: col, second, r, ms, alpha: 0.7 + 0.3 * loud, dry: 0.15 + 0.55 * (1 - load), glow: role.dark, maxX })));
        // a brush that has just been dipped leaves a blob where it lands
        if (fresh && !joined && width > u * 1.1) dab(g, { x: x + width * 0.2, y, r: width * 0.56, color: col, rng: r, squash: 1.2, rot: hand.lean, thick: true, alpha: 0.9 });
        // a low string, plucked hard: thin paint pools under the stroke
        if (reg === 0 && loud > 0.4) this.pool(g, { x: x + Math.min(lenPx * 0.3, u * 8), y, rx: Math.min(lenPx * 0.5, u * 10) + u * 2.5, ry: u * (1.5 + 2.2 * loud), color: col, alpha: role.dark ? 0.035 : 0.03, layers: 14, ms: 620, r, mode: "source-over" });
        if (reg === 0 && fresh && loud > 0.7 && r() < 0.3) this.add(g, drip(g, { x: x + u, y: y + width * 0.4, w: u * 0.32, length: u * between(r, 4, 11), color: col, rng: r }));
        // a hard pluck flicks a little paint off the brush
        if (v > 0.74 && r() < 0.22) speckle(g, { x: x + u * between(r, 2, 6), y: y - width * between(r, 0.6, 1.6), n: 3 + Math.floor(r() * 6), sx: u * 2.4, sy: u * 1.1, color: col, rng: r, size: u * 0.24 });
        this.last += ` ${brush}`;
      }
    }

    // its overtones: thin lines above it, each as strong and as long as it really is
    const lighter = shade(col, role.dark ? 0.2 : 0.08);
    const over = (hz: number, strength: number, rang: number) => {
      const qy = yOfHz(hz, H);
      const qlen = Math.max(1, Math.min(Math.min(p.length, Math.max(0.03, rang * 0.7)) * sp, maxX - x));
      const wq = Math.max(0.6, u * (0.12 + 0.3 * strength));
      this.stain(hz, lighter);
      if (stac || qlen < u * 1.8) {
        touch(g, r() < 0.25 ? "tick" : "dot", { x: x + wq, y: qy, r: Math.max(0.9, wq * 1.5), color: lighter, rng: r, alpha: clamp(0.25 + 0.6 * strength), long: clamp(qlen / (wq * 3), 1, 3) });
        return;
      }
      const qpts = this.trace({ xs: x, xe: x + qlen, x, y: qy, ys: qy, slopeTo: x, joined: false, sp, ring: rang, damped: p.length < rang * 0.7, lam: this.wave(hz, u), amp: u * 0.16 * strength * hand.ripple, load: 0.8, hand, u });
      const brush: Brush = r() < 0.72 ? "liner" : pick("dashes", ["dashes", "dots", "dry", "fan"], r, 0.6);
      this.add(g, later(between(r, 25, 95), () => paintPath(g, qpts, { brush, width: brush === "liner" ? wq : wq * 2.2, color: lighter, r, ms: this.quick(qlen) * 0.8, alpha: clamp(0.2 + 0.6 * strength), glow: role.dark && strength > 0.4, maxX })));
    };
    let drawn = 0;
    for (const q of s.parts) {
      if (drawn >= 3) break;
      if (q.hz < f0 * 1.45 || q.gain < 0.05) continue;
      // a soft pluck is a dull one: the sound's own filter takes the top off
      const strength = (Math.pow(q.gain, 0.7) * loud) / Math.sqrt(1 + Math.pow(q.hz / Math.max(200, p.cutoff), 4));
      if (strength < 0.08) continue;
      over(q.hz, clamp(strength), q.ring);
      drawn++;
    }
    // the octave string of a twelve-string
    if (p.octave > 0.05) over(f0 * 2, clamp(p.octave * loud * 0.8), s.ring * 0.7);
  }

  /** A drum: every part of its sound is painted where it is, as tall as it is wide and as long as it lasts. */
  private drum(l: Layer, p: DrumPulse, x: number, sp: number, spot: Spot) {
    const { W, H, r } = this;
    const g = this.wet.g;
    const pal = this.pal;
    const role = roles(pal);
    const hand = l.hand;
    const u = Math.min(W, H) / 100;
    const beatPx = sp * spot.spb;
    const maxX = W * (1 - MARGIN * 0.25);
    const v = clamp(p.velocity, 0.12, 1);
    const loud = clamp(Math.pow(v, 1.1) * clamp(p.gain, 0.1, 1.4), 0.08, 1);
    const ink = hexToRgb(pal.ink);
    const n = pal.colors.length;
    const pop = vary(role.pop, r);
    // every drum keeps its own colour, so it can be followed across the canvas
    const base: RGB =
      p.drum === "kick" ? vary(role.low, r, 0.7)
      : p.drum === "tom" ? vary(pal.colors[2 % n], r)
      : p.drum === "snare" ? vary(role.second, r)
      : p.drum === "clap" || p.drum === "bell" ? pop
      : p.drum === "rim" ? ink
      : p.drum === "open" ? mix(ink, pop, 0.5)
      : p.drum === "shaker" ? mix(ink, pop, 0.25)
      : r() < 0.2 ? pop : mix(ink, hexToRgb(role.high), 0.2);
    const parts = p.sound.parts.filter((q) => q.gain >= 0.07).slice(0, 4);
    const made: string[] = [];
    let body: { y: number } | null = null;
    let hiss: { y: number } | null = null;

    parts.forEach((q: Part, i) => {
      const y = yOfHz(q.hz, H);
      const lowPart = q.hz < 260;
      // the same drum is painted the same way for a while: it can be followed across the canvas
      const how = this.manner(l, `${p.drum}${i}`, p.time, 0.1, { touch: lowPart ? hand.dabLow : hand.dabHigh, brush: lowPart ? hand.low : "liner", cloud: hand.cloudOf[p.drum] }, { touch: lowPart ? LOW_DAB : HIGH_DAB, brush: lowPart ? LOW_BRUSH : ["liner", "dashes", "dots", "ribbon"], cloud: i === 0 ? DRUM_CLOUDS[p.drum] : CLOUDS }, harshness(p.sound.attack, q.hz, v));
      const strength = clamp(loud * Math.pow(q.gain, 0.6), 0.06, 1);
      // higher parts of the same drum are a little lighter, lower ones a little darker
      const col = shade(base, clamp((bandOf(q.hz) / BANDS - 0.5) * 0.2, -0.1, 0.1) + (r() - 0.5) * 0.05);
      const long = Math.min(Math.max(0.01, q.ring * 0.75) * sp, maxX - x);
      const low = q.hz < 260;
      // a thump is a thump however rough it is; high up, anything broad is as good as a noise
      const noisy = !low && (q.noise >= 0.45 || q.width >= 0.5);
      this.stain(q.hz, col);
      if (noisy) {
        hiss = hiss ?? { y };
        const tall = clamp(spanPx(q.hz, q.width, H), u * 1.3, H * 0.28);
        if (long < u * 3) {
          // a burst of noise: paint thrown at one spot, as tall as the noise is wide and as long as it lasts
          const kind = how.cloud;
          const rx = Math.max(u * 0.7, Math.min(Math.max(u * 1.2, beatPx * 0.42), long * 0.5 + u * 0.35));
          const amount = (12 + 75 * strength) * clamp((rx * tall) / (u * u * 10), 0.5, 2.4);
          const throwIt = (dx: number) => cloud(g, kind, { x: x + rx * 0.7 + dx, y: y + gauss(r) * tall * 0.05, rx, ry: tall * 0.5, n: amount, color: col, rng: r, size: u * (0.2 + 0.26 * strength) * (1 + this.mood.size), alpha: 0.5 + 0.5 * strength });
          // a clap is several hands, a moment apart
          if (p.drum === "clap") this.add(g, flam(3, 14, (k) => throwIt((k - 1) * u * 0.9 + gauss(r) * u * 0.3)));
          else throwIt(0);
          made.push(kind);
        } else {
          // a noise that lasts: the brush is dragged for as long as it sounds, and runs out of paint as it dies away
          const brush = pick(hand.drag, DRAG_BRUSH, r, 0.3);
          const pts = this.trace({ xs: x, xe: x + long, x, y, ys: y, slopeTo: x, joined: false, sp, ring: q.ring, damped: false, lam: u * 1.2, amp: 0, load: 0.9, hand, u });
          this.add(g, later(between(r, 0, 30), () => paintPath(g, pts, { brush, width: clamp(tall * 0.5, u * 1.3, u * 8), color: col, r, ms: this.quick(long), alpha: 0.35 + 0.6 * strength, dry: 0.6, maxX })));
          made.push(brush);
        }
        return;
      }
      body = body ?? { y };
      // a pitch that slides (a kick drum's falls) is painted sliding: it starts above its note and comes down to it
      const fall = low && Math.abs(q.glide) > 0.06 ? y - yOfHz(q.hz * Math.pow(2, -clamp(q.glide, -1.2, 1.2)), H) : 0;
      const size = Math.min(u * (low ? 1.3 + 3.1 * strength : 0.55 + 1.3 * strength), Math.max(u * 1.3, beatPx * (low ? 0.46 : 0.3)));
      if (long < size * 2.6) {
        // a thump or a ping that is over at once
        // (a drum hit as hard as it can be splashes)
        // (a rim shot is a click: everything at once, for an instant, so its mark is a line straight up and down)
        const click = p.drum === "rim" && i === 0;
        const kind: Touch = click ? "edge" : Math.abs(fall) > size * 0.6 ? "teardrop" : !low && v > 0.93 && r() < 0.6 ? "crown" : how.touch;
        const cx = x + Math.max(size * 0.5, long * 0.5);
        // (a thump whose pitch falls has a tail pointing back to where it came from: up, and a moment earlier)
        this.put(g, kind, { x: cx, y, r: size * (low ? 0.6 : 0.8), color: click ? ink : col, rng: r, dir: click ? -Math.PI / 2 + this.mood.turn * 0.5 : fall > 0 ? -Math.PI / 2 - 0.4 : fall < 0 ? Math.PI / 2 + 0.4 : this.mood.turn, alpha: 0.6 + 0.4 * strength, long: Math.abs(fall) > size * 0.6 ? clamp(Math.abs(fall) / (size * 1.6), 1, 1.8) : clamp(long / (size * 1.2), 1, 3) });
        // (the thin paint round a thump goes on after the thump itself, so the next one finds the canvas wet)
        if (low && strength > 0.3) this.pool(g, { x: cx, y, rx: size * 1.35, ry: size * 0.85, color: col, alpha: role.dark ? 0.045 : 0.05, layers: 18, ms: 420, r, mode: "source-over" });
        made.push(kind);
      } else {
        // a drum that rings: a stroke for as long as it does
        const brush = how.brush;
        const pts = this.trace({ xs: x, xe: x + long, x, y, ys: y, slopeTo: x, joined: false, sp, ring: q.ring, damped: false, lam: this.wave(q.hz, u), amp: u * 0.3 * strength, fall, fallIn: 0.035, load: 1, hand, u });
        this.add(g, later(between(r, 0, 25), () => paintPath(g, pts, { brush, width: size * (low ? 1.05 : 0.5), color: col, r, ms: this.quick(long), alpha: 0.6 + 0.4 * strength, dry: 0.35, glow: role.dark, maxX })));
        if (low) {
          // the thump itself, where the stroke begins
          touch(g, how.touch, { x: x + size * 0.35, y: y - fall * 0.5, r: size * 0.62, color: col, rng: r, alpha: 0.9 });
          if (strength > 0.35) this.pool(g, { x: x + Math.min(long * 0.35, u * 7), y, rx: Math.min(long * 0.5, u * 9) + size, ry: size * 0.9, color: col, alpha: role.dark ? 0.04 : 0.045, layers: 16, ms: 520, r, mode: "source-over" });
        } else touch(g, how.touch, { x, y, r: size, color: col, rng: r, alpha: 0.9 });
        made.push(brush);
      }
    });

    // a snare is a drum and a rattle at once: the two are joined by paint thrown up from the one to the other
    const bodyAt = body as { y: number } | null;
    const hissAt = hiss as { y: number } | null;
    if (p.drum === "snare" && bodyAt && hissAt && bodyAt.y > hissAt.y) {
      this.add(g, splatter(g, { x: x + u * 0.5, y: bodyAt.y, r: Math.min(u * (0.5 + 0.8 * loud), Math.max(u * 0.6, beatPx * 0.2)), color: vary(role.second, r), rng: r, drops: Math.round(5 + 14 * loud), spread: clamp((bodyAt.y - hissAt.y) / (u * 5), 1.2, 4.5), dir: -Math.PI / 2 + gauss(r) * 0.3 }));
      if (v > 0.85 && r() < 0.12) this.add(g, drip(g, { x, y: bodyAt.y + u, w: u * 0.28, length: u * between(r, 3, 8), color: vary(role.second, r), rng: r }));
    }
    this.last = `drum ${p.drum} ${made.join(" ")}`;
  }

  /**
   * What the mix is sounding right now: how much there is in every band of each part of it, read
   * off the taps on the mixer (so it has the echoes, the reverb and the saturation in it). Where
   * something goes on sounding, a little more paint settles there: a grain so fine it is a tint,
   * strongest where the sound is. It also keeps the running measure the coverage guide shows.
   */
  mix(levels: Partial<Record<StemId, Float32Array>>, dt: number) {
    const k = 1 - Math.exp(-Math.max(0, dt) / 1000 / COVER_SECONDS);
    let top = 0;
    for (const s of STEM_IDS) {
      const now = levels[s];
      const c = this.cover[s];
      for (let b = 0; b < BANDS; b++) {
        const pw = now ? now[b] || 0 : 0;
        c[b] += (pw - c[b]) * k;
        if (pw > top) top = pw;
      }
    }
    // loudness is judged against the loudest the mix has been lately, so a quiet song is painted as fully as a loud one
    this.loudest = Math.max(this.loudest * Math.exp(-Math.max(0, dt) / 20000), top, 1e-9);
    const l = this.cur;
    const page = this.page;
    const spot = this.spot;
    if (!l || !page || !spot || l.bare) return;
    const { W, H, r } = this;
    const u = Math.min(W, H) / 100;
    const sp = speed(page, spot, W);
    const x = xOf(page.frac, W);
    const pal = this.pal;
    const ink = hexToRgb(pal.ink);
    const g = this.wet.g;
    const tries = Math.max(1, Math.round(clamp(dt, 4, 50) / 5));
    g.save();
    for (const s of STEM_IDS) {
      const now = levels[s];
      if (!now) continue;
      for (let i = 0; i < tries; i++) {
        const b = Math.floor(r() * BANDS);
        // how strong this band is, from 0 (48 dB under the loudest) to 1, tilted as the guide is
        const w = clamp(1 + (10 * Math.log10((now[b] || 0) / this.loudest + 1e-12) + tilt(b)) / 48);
        if (w < 0.2 || r() > w * w) continue;
        const hz = bandHz(b) * Math.pow(2, (r() - 0.5) / 6);
        const stained = this.tint[b] && this.clock - this.tintAt[b] < 5000 ? this.tint[b]! : null;
        const col = stained ?? (s === "drums" ? mix(ink, hexToRgb(roles(pal).low), 0.5) : hexToRgb(pal.colors[colorIndex(Math.round(midiOfHz(hz)), this.map, pal.colors.length, spot.index)]));
        // it settles a little behind the music, here and there, never along a line
        cloud(g, "mist", { x: x - r() * 0.28 * sp - u * 0.5, y: yOfHz(hz, H), rx: u * 1.4, ry: spanPx(hz, 1 / 6, H) * 0.5, n: 2 + Math.round(3 * w), color: col, rng: r, size: u * 0.2, alpha: 0.1 + 0.3 * w * w });
        this.wet.owner = l;
      }
    }
    g.restore();
  }

  /**
   * Which frequencies the mix has lately covered, for the guide: for every band (lowest first)
   * how strong the whole mix is there, from 0 (nothing: 54 dB under its strongest band) to 1, and
   * how much of that is the chords', the melody's and the drums' (three shares that add up to 1).
   */
  coverage(): { level: Float32Array; share: Record<StemId, Float32Array> } {
    const total = new Float32Array(BANDS);
    let top = 1e-12;
    for (let b = 0; b < BANDS; b++) {
      for (const s of STEM_IDS) total[b] += this.cover[s][b];
      // (tilted first, so the strongest band is the strongest as it is shown)
      total[b] *= Math.pow(10, tilt(b) / 10);
      top = Math.max(top, total[b]);
    }
    const level = new Float32Array(BANDS);
    const share = { chords: new Float32Array(BANDS), melody: new Float32Array(BANDS), drums: new Float32Array(BANDS) };
    for (let b = 0; b < BANDS; b++) {
      level[b] = clamp(1 + (10 * Math.log10(total[b] / top + 1e-12)) / 54);
      let sum = 0;
      for (const s of STEM_IDS) sum += this.cover[s][b];
      if (sum > 0) for (const s of STEM_IDS) share[s][b] = this.cover[s][b] / sum;
    }
    return { level, share };
  }

  /**
   * The first thing on a new painting: a few broad, thin sweeps of the section's own colour, so
   * every section has its own weather before a note is painted.
   */
  private ground(l: Layer, spot: Spot) {
    const { W, H, r } = this;
    const pal = this.pal;
    const role = roles(pal);
    const u = Math.min(W, H) / 100;
    const base = hexToRgb(pal.colors[spot.index % pal.colors.length]);
    const tint = mix(base, hexToRgb(pal.ground), role.dark ? 0.35 : 0.2);
    for (let i = 0; i < 3; i++) {
      const x = W * between(r, -0.02, 0.12);
      const y = H * between(r, 0.3, 0.8);
      const length = W * between(r, 0.7, 1.0);
      const bow = gauss(r) * u * 4;
      const n = Math.ceil(length / 3);
      const lean = gauss(r) * 0.05;
      const pts: Pt[] = Array.from({ length: n }, (_, k) => {
        const t = k / (n - 1);
        return { x: x + length * t, y: y + length * t * Math.tan(lean) + bow * Math.sin(Math.PI * t), w: Math.min(1, 0.3 + t * 8) * (t > 0.85 ? 1 - 0.6 * ((t - 0.85) / 0.15) : 1), a: 1 - 0.75 * t };
      });
      this.add(l.g, later(i * 140, () => paintPath(l.g, pts, { brush: i === 1 ? "dry" : "bristle", width: u * between(r, 9, 16), color: tint, r, ms: between(r, 420, 760), dry: 0.8, alpha: role.dark ? 0.1 : 0.13 })));
    }
  }

  /** Go on with every mark that is still being made, and with any fade. `dt` in milliseconds. Says whether anything is still going on. */
  frame(dt: number): boolean {
    const step = Math.min(60, Math.max(0, dt));
    this.clock += step;
    const f = this.fade;
    if (f) {
      f.wait += step;
      while (f.left > 0 && f.wait >= FADE_EVERY) {
        f.wait -= FADE_EVERY;
        this.fadeStep(f);
      }
      if (f.left <= 0) this.fade = null;
    }
    if (!this.marks.length) return !!this.fade;
    const going: { g: G; m: Mark }[] = [];
    // (a mark may add another while it is being made: those are kept too)
    const marks = this.marks;
    this.marks = [];
    for (const k of marks) {
      k.g.save();
      const done = k.m.step(step);
      k.g.restore();
      if (!done) going.push(k);
    }
    this.marks = going.concat(this.marks);
    return this.marks.length > 0 || !!this.fade;
  }

  /** The painting on show, as one picture: the ground, the paint, and the surface over them. */
  picture(texture?: HTMLCanvasElement | null): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = Math.round(this.W * this.dpr);
    out.height = Math.round(this.H * this.dpr);
    const g = out.getContext("2d")!;
    g.fillStyle = this.pal.ground;
    g.fillRect(0, 0, out.width, out.height);
    if (this.cur) g.drawImage(this.cur.canvas, 0, 0, out.width, out.height);
    if (this.wet.owner && this.wet.owner === this.cur) g.drawImage(this.wet.canvas, 0, 0, out.width, out.height);
    if (texture) {
      g.globalCompositeOperation = "hard-light";
      g.globalAlpha = roles(this.pal).dark ? 0.5 : 1;
      g.drawImage(texture, 0, 0, out.width, out.height);
    }
    return out;
  }
}
