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
 * - **field**: each layer is carried by a slow current that wanders over the whole canvas, back
 *   and forth, and paints where it is; a note's height is still its frequency, bent a little by
 *   the current;
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
  /** where across the canvas the newest paint lands */
  static HEAD = 0.78;
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
    return { x, y, dx: -Math.sin(th), dy: Math.cos(th), seg: w.jump, scale: 0.55 + 0.45 * (r / R) };
  }
  get ruler() {
    return false;
  }
}

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
  place(w: When, up: number): Place {
    const { x: cx, y: cy } = this.anchor(w.index);
    const grown = Math.sqrt(clamp(w.into / Math.max(1, w.length)));
    const R = 0.42 * Math.min(this.w, this.h) * (0.85 + 0.3 * hash(w.index * 31 + 7));
    const r = R * (0.07 + 0.93 * grown);
    // low notes point down, high notes up, on one side and then the other, bar by bar
    const barNo = Math.floor(w.into / Math.max(0.2, w.bar));
    const side = barNo % 2 === 0 ? 1 : -1;
    const th = Math.PI / 2 + side * Math.PI * clamp(up);
    return { x: cx + r * Math.cos(th), y: cy + r * Math.sin(th), dx: Math.cos(th), dy: Math.sin(th), seg: w.jump * 4096 + w.index * 64 + barNo, scale: 0.5 + 0.5 * grown };
  }
  get ruler() {
    return false;
  }
}

/** Each layer carried by a slow current that wanders the whole canvas. */
export class Field extends Layout {
  readonly id = "field" as const;
  /** each layer's carrier: where it is across the canvas, and its recent path (time, place) */
  private carriers = new Map<LayerKind, { x: number; s: number; trail: { s: number; x: number }[] }>();
  /** The current at a point: a smooth field of directions with no sinks (the curl of a noise), mostly sideways. */
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
    return { x: cx / m, y: (0.35 * cy) / m };
  }
  private carrier(layer: LayerKind, s: number) {
    let c = this.carriers.get(layer);
    if (!c) {
      const i = strHash(layer) % 7;
      c = { x: this.w * (0.12 + 0.76 * ((i * 0.618 + this.seed * 0.1) % 1)), s, trail: [] };
      this.carriers.set(layer, c);
    }
    return c;
  }
  now(w: When, dt: number, motion = 0.5) {
    super.now(w, dt, motion);
    const speed = (this.w / Math.max(4, this.crossing(w))) * (0.45 + 0.9 * this.motion);
    for (const layer of ["drums", "bass", "chords", "melody", "harmony", "vocals", "other"] as LayerKind[]) {
      const c = this.carrier(layer, w.s);
      // the music jumped: the carrier stays where it is and takes up from there
      if (w.s < c.s || w.s - c.s > 2) {
        c.s = w.s;
        c.trail = [];
      }
      const y = yOfUp(0.5, this.h);
      while (c.s < w.s) {
        const step = Math.min(1 / 60, w.s - c.s);
        const f = this.flow(c.x, y + (strHash(layer) % 5) * this.h * 0.08, c.s);
        let vx = f.x * speed;
        // the walls turn it back
        if (c.x < this.w * 0.06) vx = Math.abs(vx) + speed * 0.3;
        if (c.x > this.w * 0.94) vx = -Math.abs(vx) - speed * 0.3;
        c.x += vx * step;
        c.s += step;
        c.trail.push({ s: c.s, x: c.x });
      }
      if (c.trail.length > 600) c.trail.splice(0, c.trail.length - 600);
    }
  }
  /** Where a layer's carrier was at time `s` (from its trail; before its trail, where the trail begins). */
  private xAt(layer: LayerKind, s: number): number {
    const c = this.carrier(layer, s);
    const t = c.trail;
    if (!t.length) return c.x;
    if (s >= t[t.length - 1].s) return t[t.length - 1].x;
    if (s <= t[0].s) return t[0].x;
    let lo = 0;
    let hi = t.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const f = (s - t[lo].s) / Math.max(1e-6, t[hi].s - t[lo].s);
    return t[lo].x + (t[hi].x - t[lo].x) * f;
  }
  place(w: When, up: number, layer: LayerKind): Place {
    const x = this.xAt(layer, w.s);
    const x1 = this.xAt(layer, w.s + 0.04);
    const y0 = yOfUp(up, this.h);
    // the current bends a note's height, never by more than about an octave either way
    const bend = (noise2((x / this.w) * 3, (y0 / this.h) * 3 + w.s * 0.02, this.seed + 3) - 0.5) * this.h * 0.12;
    const bend1 = (noise2((x1 / this.w) * 3, (y0 / this.h) * 3 + (w.s + 0.04) * 0.02, this.seed + 3) - 0.5) * this.h * 0.12;
    const dx = x1 - x;
    const dy = bend1 - bend;
    const m = Math.hypot(dx, dy) || 1;
    return { x, y: y0 + bend, dx: m > 1e-6 ? dx / m : 1, dy: m > 1e-6 ? dy / m : 0, seg: w.jump, scale: 1 };
  }
}

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
