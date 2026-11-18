/**
 * The painting: what is heard goes in, paint comes out.
 *
 * It holds the canvas (the wet-paint simulation), the hand (the brushes) and a sense of the
 * music's mood, and it is told two things: what the ear heard, and where across the canvas each
 * moment of the music belongs.
 */
import type { Frame } from "../listen/ear";
import { MAJOR_SCALE, MINOR_SCALE, Mood, type Feeling } from "../listen/mood";
import { hexToRgb } from "./color";
import { Hand, type Manner } from "./hand";
import { roles, type Palette } from "./palettes";
import { Sim } from "./sim";

/** How the paint behaves. "auto" lets the music decide: held, quiet music runs wet; loud, clipped music goes on thick and dry. */
export type PaintStyle = "auto" | "wash" | "thick";
export const STYLES: { id: PaintStyle; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "wash", label: "Wash" },
  { id: "thick", label: "Thick" },
];
/** How long old paint lasts: the time (in passes of the music across the canvas) for it to fade by half. */
export const FADES = [
  { id: 0, label: "Stays", half: 0 },
  { id: 1, label: "Slow", half: 4 },
  { id: 2, label: "Medium", half: 1.5 },
  { id: 3, label: "Fast", half: 0.5 },
] as const;

/** The manner for a mood: wet for held and gentle music, dry and loose for loud and clipped. */
export function mannerOf(f: Feeling, style: PaintStyle): Manner {
  const auto = Math.max(0.08, Math.min(1, 0.5 + 0.55 * (f.held - 0.5) - 0.7 * (f.energy - 0.4) - 0.3 * f.rough));
  return {
    wet: style === "wash" ? 0.6 + 0.4 * auto : style === "thick" ? 0.3 * auto : auto,
    loose: 0.25 + 0.75 * f.energy,
    body: style === "wash" ? 0.8 : style === "thick" ? 1.25 : 1,
  };
}

export class Painting {
  readonly sim: Sim;
  readonly hand: Hand;
  readonly mood = new Mood();
  private pal: Palette;
  private w = 0;
  private h = 0;
  style: PaintStyle = "auto";
  drips = false;
  /** a part each second by which old paint fades */
  fade = 0;
  /** when the key is not given, it is taken from what is heard */
  private keyGiven = false;
  private keyAt = "";

  constructor(host: HTMLElement, pal: Palette, seed?: number) {
    const canvas = document.createElement("canvas");
    canvas.className = "cv-paint";
    host.appendChild(canvas);
    this.sim = new Sim(canvas);
    this.hand = new Hand(seed);
    this.pal = pal;
    this.setPalette(pal);
  }

  get made() {
    return this.hand.made;
  }

  /** The size on the page (CSS pixels) and how many real pixels to each. */
  size(w: number, h: number, dpr: number) {
    this.w = Math.round(w * dpr);
    this.h = Math.round(h * dpr);
    this.sim.size(this.w, this.h);
    this.hand.size(this.w, this.h);
  }
  get width() {
    return this.w;
  }
  get height() {
    return this.h;
  }

  setPalette(p: Palette) {
    this.pal = p;
    this.sim.setGround(hexToRgb(p.ground));
    this.hand.setPalette(p);
  }
  /** The song's key, when it is known (the app's own song). */
  setKey(tonic: number, scale: number[]) {
    this.keyGiven = true;
    this.hand.setKey(tonic, scale);
  }
  /** No key is known: it will be heard. */
  hearKey() {
    this.keyGiven = false;
    this.keyAt = "";
  }

  clear() {
    this.sim.clear();
    // the next painting is by a different hand
    this.hand.reseed();
  }
  /** The music stopped or jumped: brushes up. */
  lift() {
    this.hand.lift();
  }
  /** A new piece of music: forget the mood of the last. */
  fresh() {
    this.mood.reset();
    this.hand.lift();
    this.keyAt = "";
  }

  /** Paint what was heard. `xAt`: where across the canvas (0..1) a moment of the music is, or null. */
  hear(frames: Frame[], xAt: (t: number) => number | null) {
    if (!frames.length || !this.w) return;
    for (const f of frames) this.mood.take(f);
    const feeling = this.mood.feeling;
    if (!this.keyGiven && feeling.sure > 0.35) {
      const id = `${feeling.tonic}${feeling.major}`;
      if (id !== this.keyAt) {
        this.keyAt = id;
        this.hand.setKey(feeling.tonic, feeling.major ? MAJOR_SCALE : MINOR_SCALE);
      }
    }
    const manner = mannerOf(feeling, this.style);
    // on a dark ground thin paint does not show: it goes on with more body
    if (roles(this.pal).dark) manner.body *= 1.35;
    const s = this.sim.settings;
    s.dry = 1.7 - 1.2 * manner.wet;
    s.bleed = 0.3 + 1.4 * manner.wet;
    s.flow = 0.5 + 0.9 * manner.wet;
    s.stir = 0.15 + 0.9 * feeling.energy;
    s.gravity = this.drips ? 0.5 + 0.5 * manner.wet : 0;
    this.sim.touched();
    this.hand.paint(frames, (t) => {
      const x = xAt(t);
      return x === null ? null : x * this.w;
    }, manner, (st) => this.sim.stamp(st));
  }

  /** Let time pass (seconds). `playing`: old paint only fades while the music is going. Says whether anything is still moving. */
  frame(dt: number, playing: boolean): boolean {
    this.sim.settings.fade = playing ? this.fade : 0;
    const busy = this.sim.waiting > 0 || !this.sim.settled(dt) || (playing && this.fade > 0);
    if (busy) this.sim.step(dt);
    return busy;
  }

  /** The painting as one picture, with the surface it is on laid over it. */
  picture(texture?: HTMLCanvasElement | null): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = this.w;
    out.height = this.h;
    const g = out.getContext("2d")!;
    this.sim.show();
    g.drawImage(this.sim.canvas, 0, 0);
    if (texture) {
      g.globalCompositeOperation = "hard-light";
      g.globalAlpha = roles(this.pal).dark ? 0.5 : 1;
      g.drawImage(texture, 0, 0, out.width, out.height);
    }
    return out;
  }

  destroy() {
    this.sim.destroy();
    this.sim.canvas.remove();
  }
}
