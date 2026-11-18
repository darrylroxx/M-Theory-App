/**
 * The painting: what is heard goes in, paint comes out.
 *
 * It is told, every moment, what each layer of the music did (from the app's own notes, or from
 * an ear on the layer's sound), what the whole mix sounds like, and where in the music each
 * moment is. It keeps:
 *
 * - a **hand** for every layer (`strokes.ts`), each with its own kind of brush;
 * - a **layout** (`place.ts`) that says where each moment of each layer goes, chosen by the music
 *   itself (**Auto**) or by the painter;
 * - the **mood** of the last few seconds (wet and slow, or dry and quick) and the **vibe** of the
 *   piece as a whole (`vibe.ts`), which set the manner, the colours and the layout;
 * - a **budget** (`coverage.ts`) that lets the canvas fill only as far as the music calls for.
 *
 * The thinking (`Artist`) is apart from the paint itself (`Painting`, on the graphics card), so it
 * can be tested without a screen.
 */
import type { Frame } from "../listen/ear";
import { MAJOR_SCALE, MINOR_SCALE, Mood, type Feeling } from "../listen/mood";
import { hexToRgb, type RGB } from "./color";
import { Budget } from "./coverage";
import { LAYER_INFO, LAYERS, layerColours, type LayerKind } from "./layers";
import { noteColors } from "./layout";
import { roles, type Palette } from "./palettes";
import { makeLayout, type Layout, type LayoutId, type When } from "./place";
import { Sim, type Stamp } from "./sim";
import { LayerHand, type Cue, type Manner } from "./strokes";
import { LayoutChooser, VibeMeter, lookOf, normalise, type Look } from "./vibe";

export type { Manner } from "./strokes";

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

/** A note or hit of one layer, known from the app itself (or from a file analysed ahead). */
export interface LayerCue {
  layer: LayerKind;
  cue: Cue;
  /** a hit (a drum), not a held sound */
  hit?: boolean;
}

/** What was heard since the last time. */
export interface Heard {
  /** how far the music has got (seconds, on the clock frames and notes are stamped with): paint up to here */
  now: number;
  /** where in the music a moment is (null: nowhere on the canvas) */
  when: (t: number) => When | null;
  /** what the ear on the whole mix heard: the mood, the key and (unless the vibe is known) the vibe come from it */
  mix: Frame[];
  /** what each layer's own ear heard */
  layers?: Partial<Record<LayerKind, Frame[]>>;
  /** the layers whose notes come as cues: their ear only gives their texture */
  exact?: LayerKind[];
  cues?: LayerCue[];
}

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
/** How long a layer stays "playing" after its last sound, seconds. */
const ACTIVE_FOR = 2.2;

/** The thinking part of the painting: everything but the paint. Marks go to `put`. */
export class Artist {
  readonly hands: Record<LayerKind, LayerHand>;
  readonly budget = new Budget();
  readonly mood = new Mood();
  /** the vibe of what has been heard lately (half a minute), when it is not known ahead */
  vibe = new VibeMeter(30);
  look: Look = lookOf(new Float32Array(74));
  /** a vibe known ahead (a file analysed before it plays): the look comes from it */
  private known: Float32Array | null = null;
  private lookAt = -1;
  layout: Layout = makeLayout("river");
  /** the layout asked for ("auto": the music chooses) */
  choice: LayoutId | "auto" = "auto";
  private chooser = new LayoutChooser();
  /** layers not painted */
  hidden = new Set<LayerKind>();
  style: PaintStyle = "auto";
  drips = false;
  /** the run: Clear starts a new one, with new detail on the same structure */
  run = 1;
  manner: Manner = { wet: 0.4, loose: 0.3, body: 1 };
  private w = 0;
  private h = 0;
  private pal: Palette | null = null;
  private keyGiven = false;
  private keyAt = "";
  private tonic = 0;
  private scale = MAJOR_SCALE;
  private colourKey = "";
  /** when each layer last sounded, and how loud it has been lately */
  readonly activity: Record<LayerKind, { last: number; loud: number; cue: number }>;
  private now = -1;
  /** where marks go */
  put: (s: Stamp, layer: LayerKind) => void = () => {};
  /** how many marks have gone down */
  made = 0;
  feeling: Feeling = new Mood().feeling;

  constructor() {
    this.hands = Object.fromEntries(LAYERS.map((l) => [l, new LayerHand(l)])) as Record<LayerKind, LayerHand>;
    this.hands.harmony.partner = this.hands.melody;
    this.activity = Object.fromEntries(LAYERS.map((l) => [l, { last: -99, loud: 0, cue: 0 }])) as Artist["activity"];
    for (const l of LAYERS) this.hands[l].put = (s) => this.lay(s, l);
  }

  size(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.budget.size(w, h);
    this.layout.size(w, h);
    for (const l of LAYERS) this.hands[l].size(w, h);
  }
  setPalette(p: Palette) {
    this.pal = p;
    this.colourKey = "";
    this.recolour();
  }
  /** The song's key, when it is known (the app's own song). */
  setKey(tonic: number, scale: number[]) {
    this.keyGiven = true;
    this.tonic = tonic;
    this.scale = scale;
    this.colourKey = "";
    this.recolour();
  }
  /** No key is known: it will be heard. */
  hearKey() {
    this.keyGiven = false;
    this.keyAt = "";
  }
  /** The vibe of the whole piece, known ahead (from a file analysed before it plays); null: heard as it plays. */
  knowVibe(fp: Float32Array | null) {
    this.known = fp;
    this.lookAt = -1;
    this.chooser.reset();
  }

  private recolour() {
    if (!this.pal) return;
    const key = `${this.pal.id}/${this.tonic}/${this.scale.join()}/${Math.round(this.look.turn)}/${this.look.light.toFixed(1)}`;
    if (key === this.colourKey) return;
    this.colourKey = key;
    const c = layerColours(this.pal, this.look.turn, this.look.light);
    const palette: RGB[] = this.pal.colors.map(hexToRgb);
    const map = noteColors(this.tonic, this.scale, palette.length);
    for (const l of LAYERS) this.hands[l].colours(c, palette, map);
  }

  /** The music stopped or jumped: brushes up. */
  lift() {
    for (const l of LAYERS) this.hands[l].lift();
  }
  /** A new piece of music: forget the mood and vibe of the last. */
  fresh() {
    this.mood.reset();
    this.vibe = new VibeMeter(30);
    this.known = null;
    this.lookAt = -1;
    this.chooser.reset();
    this.lift();
    this.keyAt = "";
  }
  /** A new painting: the canvas is bare, and the next run of marks is a new one. */
  clear() {
    this.budget.clear();
    this.run++;
    this.lift();
  }

  /** Lay a mark of a layer, as far as the budget lets it. */
  private lay(s: Stamp, layer: LayerKind) {
    if (this.hidden.has(layer)) return;
    const allow = this.budget.admit(s, layer);
    if (allow < 0.04) return;
    if (allow < 1) {
      s.paint *= allow;
      s.water *= 0.5 + 0.5 * allow;
      s.r *= 0.7 + 0.3 * allow;
    }
    s.depth = LAYER_INFO[layer].depth;
    this.activity[layer].last = this.now;
    this.made++;
    this.put(s, layer);
  }

  /** The layout to paint with now. */
  private chooseLayout(t: number, bar: number) {
    const id = this.choice === "auto" ? this.chooser.pick(this.look.layouts, t, bar, !!this.known || this.vibe.heard > 30) : this.choice;
    if (id !== this.layout.id) {
      this.layout = makeLayout(id);
      this.layout.size(this.w, this.h);
      this.lift();
    }
    this.layout.setSeed(this.look.seed);
  }

  /** Paint what was heard. */
  hear(h: Heard) {
    if (!this.w) return;
    const dt = this.now < 0 ? 1 / 60 : clamp(h.now - this.now, 0, 0.25);
    this.now = h.now;
    for (const f of h.mix) {
      this.mood.take(f);
      if (!this.known) this.vibe.take(f);
    }
    const feeling = (this.feeling = this.mood.feeling);
    if (!this.keyGiven && feeling.sure > 0.35) {
      const id = `${feeling.tonic}${feeling.major}`;
      if (id !== this.keyAt) {
        this.keyAt = id;
        this.tonic = feeling.tonic;
        this.scale = feeling.major ? MAJOR_SCALE : MINOR_SCALE;
        this.colourKey = "";
      }
    }
    // the look of the whole piece, from its vibe (worked out again twice a second)
    if (this.lookAt < 0 || h.now - this.lookAt > 0.5 || h.now < this.lookAt) {
      this.lookAt = h.now;
      this.look = lookOf(normalise(this.known ?? this.vibe.fingerprint()));
    }
    this.recolour();
    // the manner: the mood of the moment, steadied by the vibe of the piece
    const m = mannerOf(feeling, this.style);
    if (this.style === "auto") {
      m.wet = 0.55 * m.wet + 0.45 * this.look.wet;
      m.loose = 0.6 * m.loose + 0.4 * this.look.loose;
    }
    if (this.pal && roles(this.pal).dark) m.body *= 1.35;
    this.manner = m;
    const now = h.when(h.now);
    this.chooseLayout(h.now, now?.bar ?? 2);
    if (now) this.layout.now(now, dt, this.look.motion);
    const touch = { stroke: this.look.stroke, spread: this.look.spread, density: this.look.density };
    for (const l of LAYERS) {
      const hand = this.hands[l];
      hand.where = (t, up) => {
        const w = h.when(t);
        return w ? this.layout.place(w, up, l) : null;
      };
      hand.manner = m;
      hand.touch = touch;
      hand.run = this.run;
    }
    // notes known ahead
    for (const c of h.cues ?? []) {
      const hand = this.hands[c.layer];
      if (c.hit) hand.hit(c.cue);
      else hand.start(c.cue);
      const a = this.activity[c.layer];
      a.cue = Math.max(a.cue, c.cue.amp);
      a.last = Math.max(a.last, c.cue.t);
    }
    // what each layer's ear heard
    const exact = new Set(h.exact ?? []);
    for (const [l, frames] of Object.entries(h.layers ?? {}) as [LayerKind, Frame[]][]) if (frames?.length) this.hands[l].hear(frames, !exact.has(l));
    for (const l of LAYERS) this.hands[l].advance(h.now);
    // how much is playing: each layer that sounded lately, as loud as it is
    const levels: Partial<Record<LayerKind, number>> = {};
    const list: { layer: LayerKind; active: boolean; loud: number }[] = [];
    for (const l of LAYERS) {
      const a = this.activity[l];
      a.cue *= Math.exp(-dt / 1.5);
      const ear = h.layers?.[l]?.length ? this.hands[l].texture.level : 0;
      a.loud = Math.max(a.loud * Math.exp(-dt / 1.2), ear, a.cue);
      const active = !this.hidden.has(l) && (h.now - a.last < ACTIVE_FOR || this.hands[l].down > 0) && a.loud > 0.04;
      list.push({ layer: l, active, loud: a.loud });
      if (active) levels[l] = a.loud;
    }
    this.budget.setLayers(list);
    if (!this.known) this.vibe.roles(levels, dt);
  }

  /** How fast old paint should fade now: the chosen fade, and the sinking the budget calls for. */
  fadeRate(chosen: number) {
    return chosen + this.budget.sink();
  }
}

/** The painting itself: the artist's marks, in wet paint on the graphics card. */
export class Painting {
  readonly sim: Sim;
  readonly artist = new Artist();
  private w = 0;
  private h = 0;
  /** a part each second by which old paint fades (as chosen) */
  fade = 0;
  private measured = 0;

  constructor(host: HTMLElement, pal: Palette) {
    const canvas = document.createElement("canvas");
    canvas.className = "cv-paint";
    host.appendChild(canvas);
    this.sim = new Sim(canvas);
    this.artist.put = (s) => this.sim.stamp(s);
    this.setPalette(pal);
  }

  get made() {
    return this.artist.made;
  }
  get width() {
    return this.w;
  }
  get height() {
    return this.h;
  }

  /** The size on the page (CSS pixels) and how many real pixels to each. */
  size(w: number, h: number, dpr: number) {
    this.w = Math.round(w * dpr);
    this.h = Math.round(h * dpr);
    this.sim.size(this.w, this.h);
    this.artist.size(this.w, this.h);
  }

  setPalette(p: Palette) {
    this.sim.setGround(hexToRgb(p.ground));
    this.artist.setPalette(p);
  }

  clear() {
    this.sim.clear();
    this.artist.clear();
  }
  lift() {
    this.artist.lift();
  }
  fresh() {
    this.artist.fresh();
  }

  /** Paint what was heard. */
  hear(h: Heard) {
    const a = this.artist;
    a.hear(h);
    const m = a.manner;
    const s = this.sim.settings;
    s.dry = 1.7 - 1.2 * m.wet;
    s.bleed = 0.3 + 1.4 * m.wet;
    s.flow = 0.5 + 0.9 * m.wet;
    s.stir = 0.15 + 0.9 * a.feeling.energy * 0.6 + 0.5 * a.look.motion * (a.layout.id === "field" ? 1.6 : 0.6);
    s.gravity = a.drips ? 0.5 + 0.5 * m.wet : 0;
    const drift = a.layout.drift();
    s.driftX = drift.x;
    s.driftY = drift.y;
    this.sim.touched();
  }

  /** Let time pass (seconds). `playing`: old paint only fades while the music is going. Says whether anything is still moving. */
  frame(dt: number, playing: boolean): boolean {
    const a = this.artist;
    const fade = playing ? a.fadeRate(this.fade) : 0;
    this.sim.settings.fade = fade;
    if (!playing) {
      this.sim.settings.driftX = 0;
      this.sim.settings.driftY = 0;
    }
    const busy = this.sim.waiting > 0 || !this.sim.settled(dt) || (playing && (fade > 0 || this.sim.settings.driftX !== 0));
    if (busy) {
      this.sim.step(dt);
      a.budget.tick(dt, fade);
      const mv = this.sim.moved;
      if (mv.x || mv.y) a.budget.shift(mv.x, mv.y);
      // a few times a second, the budget is told what the painting really shows
      this.measured += dt;
      if (this.measured > 0.3) {
        this.measured = 0;
        a.budget.observe(this.sim.measure(a.budget.cols, a.budget.rows));
      }
    }
    return busy;
  }

  /** The painting as one picture, with the surface it is on laid over it. */
  picture(texture: HTMLCanvasElement | null | undefined, dark: boolean): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = this.w;
    out.height = this.h;
    const g = out.getContext("2d")!;
    this.sim.show();
    g.drawImage(this.sim.canvas, 0, 0);
    if (texture) {
      g.globalCompositeOperation = "hard-light";
      g.globalAlpha = dark ? 0.5 : 1;
      g.drawImage(texture, 0, 0, out.width, out.height);
    }
    return out;
  }

  destroy() {
    this.sim.destroy();
    this.sim.canvas.remove();
  }
}
