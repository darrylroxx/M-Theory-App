/**
 * The painting: what is heard goes in, paint comes out.
 *
 * It is told, every moment, what each layer of the music did (from the app's own notes, or from
 * an ear on the layer's sound), what the whole mix sounds like, and where in the music each
 * moment is. It keeps:
 *
 * - a **hand** for every track of the song, or every stem of a recording (`strokes.ts`), each
 *   with the kind of brush of the layer it is painted in;
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
  /** the hand that paints it (a track's own, by default the layer's) */
  key?: string;
  cue: Cue;
  /** a hit (a drum), not a held sound */
  hit?: boolean;
}

/** What one ear heard: a track's, a stem's, or a share of one, and the layer it is painted in. */
export interface EarFrames {
  key: string;
  layer: LayerKind;
  frames: Frame[];
  /** its notes come as cues: the ear only gives its texture */
  exact?: boolean;
}

/** What was heard since the last time. */
export interface Heard {
  /** how far the music has got (seconds, on the clock frames and notes are stamped with): paint up to here */
  now: number;
  /** where in the music a moment is (null: nowhere on the canvas) */
  when: (t: number) => When | null;
  /** what the ear on the whole mix heard: the mood, the key and (unless the vibe is known) the vibe come from it */
  mix: Frame[];
  /** what each track's (or stem's) own ear heard */
  ears?: EarFrames[];
  cues?: LayerCue[];
}

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
/** Is anything of a layer in this frame? */
function sounding(f: Frame, layer: LayerKind): boolean {
  if (f.hits.length || f.voices.some((v) => v.of === undefined && v.amp > 0.05)) return true;
  if (layer !== "other" && layer !== "drums") return false;
  let n = 0;
  for (let i = 0; i < f.noise.length; i++) n += f.noise[i];
  return n / Math.max(1, f.noise.length) > 0.12;
}
/** How long a layer stays "playing" after its last sound, seconds. */
const ACTIVE_FOR = 2.2;
/** Seconds of music before a vibe heard live counts in full (until then the look stays near the middle of the road). */
const SETTLE = 20;

/** The thinking part of the painting: everything but the paint. Marks go to `put`. */
export class Artist {
  /** a hand for every track (or stem) heard, by its key */
  readonly hands = new Map<string, LayerHand>();
  readonly budget = new Budget();
  readonly mood = new Mood();
  /** the vibe of what has been heard lately (half a minute), when it is not known ahead */
  vibe = new VibeMeter(30);
  look: Look = lookOf(new Float32Array(74));
  /** a vibe known ahead (a file heard before it plays): the look comes from it */
  private known: Float32Array | null = null;
  private lookAt = -1;
  layout: Layout = makeLayout("river");
  /** the layout asked for ("auto": the music chooses) */
  choice: LayoutId | "auto" = "auto";
  private chooser = new LayoutChooser();
  private settled = false;
  /** 1 just after the layout changed, dying away over a few seconds: the old layout's paint sinks back meanwhile */
  private turnover = 0;
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
  private colours: { c: ReturnType<typeof layerColours>; palette: RGB[]; map: number[] } | null = null;
  /** when each layer last sounded, and how loud it has been lately */
  readonly activity: Record<LayerKind, { last: number; loud: number; cue: number }>;
  private now = -1;
  /** where marks go */
  put: (s: Stamp, layer: LayerKind) => void = () => {};
  /** how many marks have gone down */
  made = 0;
  feeling: Feeling = new Mood().feeling;

  constructor() {
    this.activity = Object.fromEntries(LAYERS.map((l) => [l, { last: -99, loud: 0, cue: 0 }])) as Artist["activity"];
  }

  /** The hand for a key (made the first time it is asked for). */
  hand(key: string, layer: LayerKind): LayerHand {
    let h = this.hands.get(key);
    if (h && h.layer !== layer) {
      // a track painted in another layer now (marked as a harmony): a new hand
      this.hands.delete(key);
      h = undefined;
    }
    if (!h) {
      h = new LayerHand(layer);
      h.put = (s) => this.lay(s, layer);
      h.size(this.w, this.h);
      if (this.colours) h.colours(this.colours.c, this.colours.palette, this.colours.map);
      h.run = this.run;
      this.hands.set(key, h);
      this.partners();
    }
    return h;
  }
  /** Each harmony line is hatched to the melody it goes with (the first melody heard). */
  private partners() {
    let melody: LayerHand | null = null;
    for (const h of this.hands.values()) if (h.layer === "melody") {
      melody = h;
      break;
    }
    for (const h of this.hands.values()) if (h.layer === "harmony") h.partner = melody;
  }
  /** The moment the music was last painted up to (seconds, on its own clock). */
  get time() {
    return this.now;
  }
  /** Every hand of one layer. */
  handsOf(layer: LayerKind): LayerHand[] {
    return [...this.hands.values()].filter((h) => h.layer === layer);
  }

  size(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.budget.size(w, h);
    this.layout.size(w, h);
    for (const hd of this.hands.values()) hd.size(w, h);
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
  /**
   * The vibe of the whole piece, known ahead (from a file heard before it plays); null: heard
   * as it plays. `final`: it is the whole piece's, and the layout chosen from it is kept.
   */
  knowVibe(fp: Float32Array | null, final = true) {
    this.known = fp;
    this.lookAt = -1;
    if (final || !fp) {
      this.chooser.reset();
      this.settled = final && !!fp;
    }
  }

  private recolour() {
    if (!this.pal) return;
    const key = `${this.pal.id}/${this.tonic}/${this.scale.join()}/${Math.round(this.look.turn)}/${this.look.light.toFixed(1)}`;
    if (key === this.colourKey) return;
    this.colourKey = key;
    const c = layerColours(this.pal, this.look.turn, this.look.light);
    const palette: RGB[] = this.pal.colors.map(hexToRgb);
    const map = noteColors(this.tonic, this.scale, palette.length);
    this.colours = { c, palette, map };
    for (const h of this.hands.values()) h.colours(c, palette, map);
  }

  /** The music stopped or jumped: brushes up. */
  lift() {
    for (const h of this.hands.values()) h.lift();
  }
  /** A new piece of music: forget the mood and vibe of the last, and its hands. */
  fresh() {
    this.mood.reset();
    this.vibe = new VibeMeter(30);
    this.known = null;
    this.lookAt = -1;
    this.chooser.reset();
    this.settled = false;
    this.lift();
    this.hands.clear();
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
    this.activity[layer].last = Math.max(this.activity[layer].last, this.now);
    this.made++;
    this.put(s, layer);
  }

  /** The layout to paint with now. */
  private chooseLayout(t: number, bar: number) {
    const settle = this.settled || (!this.known && this.vibe.heard > 30);
    // heard live, the music is let flow by in the river until there has been enough of it to know it by
    const early = !this.known && this.vibe.heard < SETTLE;
    const id = this.choice !== "auto" ? this.choice : early ? "river" : this.chooser.pick(this.look.layouts, t, bar, settle);
    if (id !== this.layout.id) {
      // (what was painted in the old layout sinks back for a few seconds, under the new one: a ghost, not a muddle)
      if (this.made > 0) this.turnover = 1;
      this.layout = makeLayout(id);
      this.layout.size(this.w, this.h);
      this.lift();
    }
    this.layout.setSeed(this.look.seed);
  }

  /** Paint what was heard. */
  hear(h: Heard) {
    if (!this.w) return;
    if (this.now >= 0 && h.now < this.now - 0.5) {
      // the music went back (a song from a file, played again): what played later has not played yet
      this.lift();
      for (const l of LAYERS) this.activity[l] = { last: -99, loud: 0, cue: 0 };
    }
    const dt = this.now < 0 ? 1 / 60 : clamp(h.now - this.now, 0, 0.25);
    this.now = h.now;
    this.turnover *= Math.exp(-dt / 5);
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
    // the look of the whole piece, from its vibe (worked out again twice a second); a vibe heard
    // live counts for little until there has been enough music to know it by
    if (this.lookAt < 0 || h.now - this.lookAt > 0.5 || h.now < this.lookAt) {
      this.lookAt = h.now;
      const v = normalise(this.known ?? this.vibe.fingerprint());
      const trust = this.known ? 1 : clamp(this.vibe.heard / SETTLE);
      if (trust < 1) for (let i = 0; i < v.length; i++) v[i] *= trust;
      this.look = lookOf(v);
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
    // the hands this time: every ear's and every cue's
    for (const e of h.ears ?? []) this.hand(e.key, e.layer);
    for (const c of h.cues ?? []) this.hand(c.key ?? c.layer, c.layer);
    const touch = { stroke: this.look.stroke, spread: this.look.spread, density: this.look.density };
    const flow = this.layout.drift();
    for (const hand of this.hands.values()) {
      hand.flow = flow;
      const l = hand.layer;
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
      const hand = this.hand(c.key ?? c.layer, c.layer);
      if (c.hit) hand.hit(c.cue);
      else hand.start(c.cue);
      const a = this.activity[c.layer];
      a.cue = Math.max(a.cue, c.cue.amp);
    }
    // what each ear heard
    for (const e of h.ears ?? []) if (e.frames.length) this.hand(e.key, e.layer).hear(e.frames, !e.exact);
    for (const hand of this.hands.values()) hand.advance(h.now);
    // how much is playing: each layer that sounded lately, as loud as it is
    const levels: Partial<Record<LayerKind, number>> = {};
    const list: { layer: LayerKind; active: boolean; loud: number }[] = [];
    // (an ear's share of a stem is playing only when it has something in it: a note, a hit, or for the fog, noise that goes on;
    // the level is the stem's, which its other shares have too)
    const heardNow = new Map<LayerKind, number>();
    for (const e of h.ears ?? []) {
      if (!e.frames.length || !e.frames.some((f) => sounding(f, e.layer))) continue;
      heardNow.set(e.layer, Math.max(heardNow.get(e.layer) ?? 0, this.hand(e.key, e.layer).texture.level));
    }
    for (const l of LAYERS) {
      const a = this.activity[l];
      a.cue *= Math.exp(-dt / 1.5);
      const ear = heardNow.get(l) ?? 0;
      a.loud = Math.max(a.loud * Math.exp(-dt / 1.2), ear, a.cue);
      const down = this.handsOf(l).some((hd) => hd.down > 0);
      const active = !this.hidden.has(l) && (h.now - a.last < ACTIVE_FOR || down) && a.loud > 0.04;
      list.push({ layer: l, active, loud: a.loud });
      if (active) levels[l] = a.loud;
    }
    this.budget.setLayers(list);
    if (!this.known) this.vibe.roles(levels, dt);
  }

  /** How fast old paint should fade now: the chosen fade, the sinking the budget calls for, and a layout just left. */
  fadeRate(chosen: number) {
    return chosen + this.budget.sink() + 0.18 * this.turnover;
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
      if (mv.x || mv.y) {
        a.budget.shift(mv.x, mv.y);
        for (const h of a.hands.values()) h.shift(mv.x, mv.y);
      }
      // a few times a second, the budget is told what the painting really shows
      this.measured += dt;
      if (this.measured > 0.3) {
        this.measured = 0;
        const seen = this.sim.measure(a.budget.cols, a.budget.rows);
        if (seen) a.budget.observe(seen);
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
