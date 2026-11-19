/**
 * Ways of laying a song out on the canvas.
 *
 * Every layout keeps one spatial law fixed, so a sound can always be read: frequency is height
 * (or, in the round layouts, distance from the centre). What each changes is how time is spent:
 *
 * - **sweep**: time runs left to right across a page of bars, page after page (the first way the
 *   canvas worked, kept for reading a song bar by bar);
 * - **river**: the canvas itself flows slowly to the left and paint is laid into the current as
 *   it passes; there is no line crossing the canvas, the water moves instead, and the lines of
 *   the music meander a little as a river does;
 * - **rings**: time is the angle and frequency the distance from the centre, one turn every few
 *   bars, so the downbeats line up on spokes and a repeated groove draws the same rosette;
 * - **bloom**: each section opens like a flower from its own point (placed by the golden
 *   angle); inside it, time is the distance from that point and frequency the angle, low notes
 *   down, high notes up, mirrored bar by bar;
 * - **field**: each layer is carried by a current of its own across the whole canvas, back and
 *   forth, bent by a slow swirl (the curl of a noise, so it never gathers in one place), and
 *   paints where it is: the layers cross and weave over each other; a note's height is still
 *   its frequency, bent by the current by no more than about an octave;
 * - **lanes**: each layer has its own band of the canvas (the bass low, the chords in the middle,
 *   the melody above them, the drums at the top, the voice across the centre), flowing left like
 *   the river.
 *
 * A layout says where a moment of the music goes: `place` is a pure function of the time, the
 * frequency and the layer, given where the music is now.
 */
import { BOTTOM, MARGIN, TOP, upOfHz } from "./layout";
import type { LayerKind } from "./layers";
import { hash, noise2 } from "./rand";

export type LayoutId = "sweep" | "river" | "rings" | "bloom" | "field" | "lanes";
export const LAYOUTS: { id: LayoutId; label: string; symbol: string }[] = [
  { id: "river", label: "River", symbol: "〰" },
  { id: "field", label: "Field", symbol: "≋" },
  { id: "rings", label: "Rings", symbol: "◎" },
  { id: "bloom", label: "Bloom", symbol: "✿" },
  { id: "lanes", label: "Lanes", symbol: "☰" },
  { id: "sweep", label: "Sweep", symbol: "→" },
];
export const isLayoutId = (x: unknown): x is LayoutId => typeof x === "string" && LAYOUTS.some((l) => l.id === x);

/** Where the music is at one moment. */
export interface When {
  /** seconds since the music started, without breaks (a jump in the music is a jump here too) */
  s: number;
  /** seconds in a bar */
  bar: number;
  /** the section: its letter, its place in the song (A = 0), seconds into it, and its length (seconds) */
  key: string;
  index: number;
  into: number;
  length: number;
  /** for the sweep: how far across its page (0..1), which page, and how many seconds a page holds */
  frac: number;
  page: string;
  pass: number;
  /** counts the music's jumps (stopped, sought, looped back): a stroke never runs across one */
  jump: number;
}

/** Where a moment goes, and which way the music is heading there. */
export interface Place {
  x: number;
  y: number;
  /** the way time runs at that point (a unit vector) */
  dx: number;
  dy: number;
  /** a stroke runs on only while this stays the same */
  seg: number;
  /** how big marks are here (1 = as usual): smaller towards the middle of the round layouts */
  scale: number;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const TAU = Math.PI * 2;
/** Height on the canvas for a place on the frequency scale (0 = bottom … 1 = top), as `yOfHz` has it. */
export const yOfUp = (up: number, h: number) => h * (BOTTOM - clamp(up) * (BOTTOM - TOP));

/** The stretch of the scale each layer usually sounds in (for the lanes, which squeeze it into a band). */
const RANGE: Record<LayerKind, [number, number]> = {
  drums: [0, 1],
  bass: [upOfHz(32), upOfHz(400)],
  chords: [upOfHz(90), upOfHz(1600)],
  melody: [upOfHz(180), upOfHz(2500)],
  harmony: [upOfHz(150), upOfHz(2200)],
  vocals: [upOfHz(100), upOfHz(5000)],
  other: [0, 1],
};
/** The lanes: each layer's band, as parts of the canvas's height from the top. */
export const LANES: Record<LayerKind, [number, number]> = {
  drums: [0.04, 0.22],
  melody: [0.2, 0.4],
  harmony: [0.28, 0.48],
  vocals: [0.36, 0.62],
  chords: [0.5, 0.78],
  bass: [0.79, 0.96],
  other: [0.04, 0.96],
};

export abstract class Layout {
  abstract readonly id: LayoutId;
  protected w = 1000;
  protected h = 560;
  /** where the music is now */
  protected at: When | null = null;
  /** how much the music is moving (0..1): currents run faster for busy music */
  protected motion = 0.5;
  /** a number from the music's vibe: where anchors and currents fall (similar music, similar places) */
  protected seed = 1;
  size(w: number, h: number) {
    this.w = w;
    this.h = h;
  }
  setSeed(seed: number) {
    this.seed = seed;
  }
  /** The music is now at `w`; `dt` seconds have passed. */
  now(w: When, _dt: number, motion = 0.5) {
    this.at = w;
    this.motion = clamp(motion);
  }
  /** Where a moment of a layer's music goes, at a place on the frequency scale; null = nowhere. */
  abstract place(w: When, up: number, layer: LayerKind): Place | null;
  /** How the canvas itself moves, in pixels a second (the river flows). */
  drift(): { x: number; y: number } {
    return { x: 0, y: 0 };
  }
  /** Is height still frequency everywhere (so the frequency ruler holds)? */
  get ruler() {
    return true;
  }
  /** Seconds one crossing of the canvas holds. */
  protected crossing(w: When) {
    return Math.max(2, w.pass);
  }
}

/** Left to right across a page of bars. */
export class Sweep extends Layout {
  readonly id = "sweep" as const;
  place(w: When, up: number): Place {
    return { x: this.w * (MARGIN + clamp(w.frac) * (1 - 2 * MARGIN)), y: yOfUp(up, this.h), dx: 1, dy: 0, seg: (hash(w.jump * 7919 + strHash(w.page)) * 1e6) | 0, scale: 1 };
  }
}

/** The canvas flows left; paint is laid in where the current is now. */
export class River extends Layout {
  readonly id: LayoutId = "river";
  /**
   * Where across the canvas the newest paint lands: at the right-hand margin, so the whole width
   * between the margins is painted (the present at the right, the past drifting off to the left)
   * and nothing is left bare on the right.
   */
  static HEAD = 1 - MARGIN;
  speed(w: When) {
    return (this.w * (1 - 2 * MARGIN)) / this.crossing(w);
  }
  drift() {
    return this.at ? { x: -this.speed(this.at), y: 0 } : { x: 0, y: 0 };
  }
  /** The lines of the music wander up and down a little, as the current does (never more than a few semitones). */
  protected meander(s: number, layer: LayerKind) {
    const p = (strHash(layer) % 97) / 97;
    return this.h * 0.022 * (Math.sin(TAU * (s / 23 + p) + this.seed) + 0.6 * Math.sin(TAU * (s / 9.7 + 2 * p)));
  }
  protected yOf(up: number, _layer: LayerKind) {
    return yOfUp(up, this.h);
  }
  place(w: When, up: number, layer: LayerKind): Place | null {
    const now = this.at ?? w;
    const v = this.speed(now);
    const x = this.w * River.HEAD - (now.s - w.s) * v;
    if (x < -this.w * 0.1) return null;
    const m0 = this.meander(w.s, layer);
    const m1 = this.meander(w.s + 0.05, layer);
    const dy = (m1 - m0) / (0.05 * v);
    const n = Math.hypot(1, dy);
    return { x, y: this.yOf(up, layer) + m0, dx: 1 / n, dy: dy / n, seg: w.jump, scale: 1 };
  }
}

/** A band of the canvas for every layer, flowing left. */
export class Lanes extends River {
  readonly id = "lanes" as const;
  protected yOf(up: number, layer: LayerKind) {
    const [lo, hi] = RANGE[layer];
    const f = clamp((up - lo) / Math.max(0.05, hi - lo), -0.15, 1.15);
    const [top, bottom] = LANES[layer];
    return this.h * (bottom - f * (bottom - top));
  }
  protected meander(s: number, layer: LayerKind) {
    return 0.4 * super.meander(s, layer);
  }
  get ruler() {
    return false;
  }
}

/** Time is the angle, frequency the distance from the centre. */
export class Rings extends Layout {
  readonly id = "rings" as const;
  /** bars to one turn */
  turnBars(w: When) {
    return w.bar < 1.2 ? 8 : 4;
  }
  place(w: When, up: number): Place {
    const turn = w.bar * this.turnBars(w);
    const k = w.s / turn;
    // a little further round each turn, so the turns lie beside each other like the growth of a shell
    const th = -Math.PI / 2 + TAU * k + Math.floor(k) * 0.06;
    const R = 0.46 * Math.min(this.h, this.w / 1.25);
    const r = R * (0.13 + 0.85 * clamp(up));
    const ax = Math.min(1.3, this.w / this.h);
    const x = this.w / 2 + r * ax * Math.cos(th);
    const y = this.h / 2 + r * Math.sin(th);
    // (marks are smaller towards the middle, where the turns are short and close together)
    return { x, y, dx: -Math.sin(th), dy: Math.cos(th), seg: w.jump, scale: 0.4 + 0.6 * (r / R) };
  }
  get ruler() {
    return false;
  }
}

/** How far a flower turns as it grows to its full size (radians). */
const TWIST = 1.1;

/** Each section opens from its own point. */
export class Bloom extends Layout {
  readonly id = "bloom" as const;
  /** where a section's flower opens: spread by the golden angle, so no two sit on each other */
  anchor(index: number) {
    const k = ((index % 9) + 9) % 9;
    const a = k * 2.399963 + this.seed * 1.7;
    const rho = 0.3 * Math.sqrt((k + 0.5) / 9);
    return { x: this.w * (0.5 + rho * Math.cos(a)), y: this.h * (0.5 + 0.8 * rho * Math.sin(a)) };
  }
  /** Where a moment of a section goes in its flower, `into` seconds into it. */
  private spot(w: When, into: number, up: number) {
    const { x: cx, y: cy } = this.anchor(w.index);
    const grown = Math.sqrt(clamp(into / Math.max(1, w.length)));
    const R = 0.42 * Math.min(this.w, this.h) * (0.85 + 0.3 * hash(w.index * 31 + 7));
    const r = R * (0.07 + 0.93 * grown);
    // low notes point down, high notes up, on one side and then the other, bar by bar; and the whole flower turns a
    // little as it grows, so a held note curls out like a petal rather than shooting out straight
    const barNo = Math.floor(into / Math.max(0.2, w.bar));
    const side = barNo % 2 === 0 ? 1 : -1;
    const th = Math.PI / 2 + side * Math.PI * clamp(up) + TWIST * grown;
    return { x: cx + r * Math.cos(th), y: cy + r * Math.sin(th), barNo, grown };
  }
  place(w: When, up: number): Place {
    const a = this.spot(w, w.into, up);
    const b = this.spot(w, w.into + 0.05, up);
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: a.x, y: a.y, dx: (b.x - a.x) / d, dy: (b.y - a.y) / d, seg: w.jump * 4096 + w.index * 64 + a.barNo, scale: 0.5 + 0.5 * a.grown };
  }
  get ruler() {
    return false;
  }
}

/** One layer's carrier in the field: where it is across, how far it has strayed up or down, which way it is heading, and its recent path. */
interface Carrier {
  x: number;
  dy: number;
  heading: number;
  s: number;
  trail: { s: number; x: number; dy: number }[];
}

/** Each layer carried by its own current across the whole canvas. */
export class Field extends Layout {
  readonly id = "field" as const;
  private carriers = new Map<LayerKind, Carrier>();
  /** The current at a point: a smooth field of directions with no sinks (the curl of a noise). */
  flow(x: number, y: number, s: number): { x: number; y: number } {
    const k = 2.2;
    const px = (x / this.w) * k;
    const py = (y / this.h) * k + s * 0.01;
    const e = 0.01;
    const n = (a: number, b: number) => noise2(a, b, this.seed);
    const n0 = n(px, py);
    const cx = (n(px, py + e) - n0) / e;
    const cy = -(n(px + e, py) - n0) / e;
    const m = Math.hypot(cx, cy) || 1;
    return { x: cx / m, y: cy / m };
  }
  private carrier(layer: LayerKind, s: number): Carrier {
    let c = this.carriers.get(layer);
    if (!c) {
      const i = LAYER_SEQ.indexOf(layer);
      // the layers set out from places spread across the canvas, some heading one way, some the other
      c = { x: this.w * (0.1 + 0.8 * ((i * 0.618 + this.seed * 0.001) % 1)), dy: 0, heading: i % 2 ? -1 : 1, s, trail: [] };
      this.carriers.set(layer, c);
    }
    return c;
  }
  /** How fast a layer's current runs (pixels a second): about a crossing of the canvas a pass, faster for busy music, each layer at its own pace. */
  private speedOf(layer: LayerKind, w: When) {
    const own = 0.75 + 0.5 * hash(LAYER_SEQ.indexOf(layer) * 131 + Math.round(this.seed));
    return (this.w / Math.max(4, this.crossing(w))) * (0.6 + 0.8 * this.motion) * own;
  }
  now(w: When, dt: number, motion = 0.5) {
    super.now(w, dt, motion);
    for (const layer of LAYER_SEQ) {
      const c = this.carrier(layer, w.s);
      // the music jumped: the carrier stays where it is and takes up from there
      if (w.s < c.s || w.s - c.s > 2) {
        c.s = w.s;
        c.trail = [];
      }
      const speed = this.speedOf(layer, w);
      const lim = this.h / 12;
      const y0 = this.h * (0.2 + 0.6 * ((LAYER_SEQ.indexOf(layer) * 0.37) % 1));
      while (c.s < w.s) {
        const step = Math.min(1 / 60, w.s - c.s);
        const f = this.flow(c.x, y0 + c.dy, c.s);
        // mostly the way it is heading, bent by the current
        let vx = c.heading + 0.9 * f.x;
        let vy = 0.9 * f.y;
        const m = Math.hypot(vx, vy) || 1;
        vx = (vx / m) * speed;
        vy = (vy / m) * speed * 0.5;
        c.x += vx * step;
        // it strays up and down, never far from the height of its own notes (about an octave)
        c.dy += (vy - 1.5 * c.dy) * step;
        c.dy = Math.max(-lim, Math.min(lim, c.dy));
        // the walls turn it back
        if (c.x < this.w * 0.05) c.heading = 1;
        if (c.x > this.w * 0.95) c.heading = -1;
        c.s += step;
        c.trail.push({ s: c.s, x: c.x, dy: c.dy });
      }
      if (c.trail.length > 600) c.trail.splice(0, c.trail.length - 600);
    }
  }
  /** Where a layer's carrier was at time `s` (from its trail; before its trail, where the trail begins). */
  private at2(layer: LayerKind, s: number): { x: number; dy: number } {
    const c = this.carrier(layer, s);
    const t = c.trail;
    if (!t.length) return { x: c.x, dy: c.dy };
    if (s >= t[t.length - 1].s) return t[t.length - 1];
    if (s <= t[0].s) return t[0];
    let lo = 0;
    let hi = t.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const f = (s - t[lo].s) / Math.max(1e-6, t[hi].s - t[lo].s);
    return { x: t[lo].x + (t[hi].x - t[lo].x) * f, dy: t[lo].dy + (t[hi].dy - t[lo].dy) * f };
  }
  place(w: When, up: number, layer: LayerKind): Place {
    const a = this.at2(layer, w.s);
    const b = this.at2(layer, w.s + 0.04);
    const y0 = yOfUp(up, this.h);
    const dx = b.x - a.x;
    const dy = b.dy - a.dy;
    const m = Math.hypot(dx, dy);
    return { x: a.x, y: y0 + a.dy, dx: m > 1e-6 ? dx / m : 1, dy: m > 1e-6 ? dy / m : 0, seg: w.jump, scale: 1 };
  }
}

const LAYER_SEQ: LayerKind[] = ["drums", "bass", "chords", "melody", "harmony", "vocals", "other"];

export function makeLayout(id: LayoutId): Layout {
  switch (id) {
    case "river":
      return new River();
    case "lanes":
      return new Lanes();
    case "rings":
      return new Rings();
    case "bloom":
      return new Bloom();
    case "field":
      return new Field();
    default:
      return new Sweep();
  }
}

/** A whole number for a piece of text (the same text, the same number). */
export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
