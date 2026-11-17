/**
 * The painter: it listens to the song and paints it.
 *
 * Every section of the song has its own painting (long sections have several, one after another).
 * A painting is as wide as its bars, so the music crosses it from left to right; when a section
 * comes round again, it is painted over what is there, and what is there is first knocked back a
 * little, so the newest pass is the clearest and older ones show through behind it.
 *
 * - A chord note is a brush stroke that goes on for as long as the note is held, and runs dry as it goes.
 * - A bass string leaves a pool of thin paint under its stroke.
 * - The melody is a line of ink from note to note, with a bead of colour on each note.
 * - The kick is a heavy blot at the bottom, the snare a splatter, the clap three dabs, the hats
 *   flicks along the top, the shaker a sprinkle, the rim a ring.
 */
import type { Pulse } from "../audio/pulse";
import { css, hexToRgb, mix, shade, vary } from "./color";
import { MARGIN, colorIndex, noteColors, pageOf, speed, xOf, yOfDrum, yOfMidi, type Page, type Spot } from "./layout";
import { dab, drip, flam, inkLine, ring, speckle, splatter, stroke, wash, type G, type Mark } from "./marks";
import { roles, type Palette } from "./palettes";
import { between, gauss, rng, type Rng } from "./rand";

interface Layer {
  key: string;
  canvas: HTMLCanvasElement;
  g: G;
  /** how far across the old paint has been knocked back on this pass (pixels) */
  front: number;
  /** when it was last the one on show */
  seen: number;
  /** nothing has been painted on it yet */
  bare: boolean;
}

/** How much of the old paint is left after the music has passed over it once more. */
export const FADES = [
  { id: 0, label: "Keep", keep: 1 },
  { id: 1, label: "Slow", keep: 0.74 },
  { id: 2, label: "Fast", keep: 0.42 },
] as const;
const STEPS = 6;
const MAX_LAYERS = 12;
const MAX_MARKS = 240;

export class Painter {
  private layers = new Map<string, Layer>();
  private cur: Layer | null = null;
  private marks: { g: G; m: Mark }[] = [];
  private W = 1;
  private H = 1;
  private dpr = 1;
  private r: Rng;
  private page: Page | null = null;
  private spot: Spot | null = null;
  private lastFrac = -1;
  private clock = 0;
  private lastTune: { layer: Layer; x: number; y: number; at: number } | null = null;
  /** how many marks have been made (for tests, and to tell an empty canvas from a painted one) */
  made = 0;

  /** the colour each of the twelve notes takes (see `noteColors`) */
  private map: number[];
  private tonic = 0;
  private scale: number[] = [0, 2, 4, 5, 7, 9, 11];

  constructor(
    private host: HTMLElement,
    private pal: Palette,
    private keep = 0.74,
    seed = 20260417,
  ) {
    this.r = rng(seed);
    this.map = noteColors(this.tonic, this.scale, pal.colors.length);
  }

  /** The size of the canvas on screen, and how many real pixels there are to each of its pixels. */
  size(width: number, height: number, dpr: number) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.W && h === this.H && dpr === this.dpr) return;
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
      l.front = (l.front / this.W) * w;
    }
    this.marks = [];
    this.lastTune = null;
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
    this.lastTune = null;
    this.lastFrac = -1;
    this.made = 0;
  }

  /** The names of the paintings there are, and the one on show. */
  keys(): string[] {
    return [...this.layers.keys()];
  }
  showing(): string | null {
    return this.cur?.key ?? null;
  }
  busy(): boolean {
    return this.marks.length > 0;
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
    this.host.appendChild(canvas);
    l = { key, canvas, g, front: 0, seen: this.clock, bare: true };
    this.layers.set(key, l);
    if (this.layers.size > MAX_LAYERS) {
      // the painting that has been out of sight longest makes room
      const old = [...this.layers.values()].filter((x) => x !== l && x !== this.cur).sort((a, b) => a.seen - b.seen)[0];
      if (old) {
        old.canvas.remove();
        this.layers.delete(old.key);
        this.marks = this.marks.filter((x) => x.g !== old.g);
      }
    }
    return l;
  }

  /** Knock the old paint back between two places across the canvas. */
  private wipe(l: Layer, from: number, to: number, alpha: number) {
    const a = Math.max(0, from);
    const b = Math.min(this.W, to);
    if (b <= a || alpha <= 0) return;
    const g = l.g;
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.globalAlpha = alpha;
    g.fillStyle = "#000";
    g.fillRect(a, 0, b - a, this.H);
    g.restore();
  }

  /**
   * Tell the painter where the music is (or null when it has stopped). The right painting is put
   * on show, and the old paint just ahead of the music is knocked back, softly, in a few steps.
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
    if (entered) {
      if (this.cur) this.cur.canvas.style.opacity = "0";
      l.canvas.style.opacity = "1";
      this.cur = l;
      this.lastTune = null;
    }
    l.seen = this.clock;
    const x = xOf(page.frac, this.W);
    const lead = this.W * 0.13;
    const step = this.W * 0.012;
    const front = x + lead;
    if (this.keep < 1 && !l.bare) {
      // a new pass: the painting has just come on show, the music has just started, or it has gone back
      const again = entered || this.lastFrac < 0 || page.frac < this.lastFrac - 0.01;
      const a = 1 - Math.pow(this.keep, 1 / STEPS);
      // a new pass: start from where the music is (from the very edge, if it is at the beginning)
      const start = again ? (page.frac < 0.02 ? 0 : x) : l.front;
      for (let s = 0; s < STEPS; s++) this.wipe(l, start - (again ? 0 : s * step), front - s * step, a);
    }
    l.front = front;
    this.lastFrac = page.frac;
    this.page = page;
  }

  private add(g: G, m: Mark) {
    this.marks.push({ g, m });
    if (this.marks.length > MAX_MARKS) this.marks.splice(0, this.marks.length - MAX_MARKS);
  }

  /** Something sounded: paint it, where the music is now. */
  hit(p: Pulse) {
    const l = this.cur;
    const page = this.page;
    const spot = this.spot;
    if (!l || !page || !spot) return;
    const { W, H, r } = this;
    const g = l.g;
    const pal = this.pal;
    const role = roles(pal);
    const n = pal.colors.length;
    /** one hundredth of the canvas's shorter side: sizes are in these, so a painting looks the same large or small */
    const u = Math.min(W, H) / 100;
    const x = xOf(page.frac, W);
    /** how far the music moves across the canvas in one beat: marks made on the beat must not swallow their neighbours */
    const beatPx = speed(page, spot, W) * spot.spb;
    const v = Math.max(0.15, Math.min(1, p.velocity));
    const paint = (hex: string, amount = 1) => vary(hex, r, amount);
    this.made++;
    if (l.bare) {
      l.bare = false;
      this.ground(l, spot);
    }
    g.save();

    if (p.kind === "chord") {
      const y = yOfMidi(p.midi, "chords", H) + gauss(r) * u * 0.7;
      const col = paint(pal.colors[colorIndex(p.midi, this.map, n, spot.index)]);
      const bass = p.midi < 50;
      const width = u * (bass ? 3.3 : 1.75) * (0.55 + v * 0.85) * between(r, 0.75, 1.3);
      // the stroke goes on for as long as the string is held (two bars at most), at the speed the music crosses the canvas
      const sec = Math.max(0.1, Math.min(p.length, spot.bar * spot.spb * 2));
      const length = Math.max(u * 2.6, sec * speed(page, spot, W));
      if (bass) this.add(g, wash(g, { x: x + length * 0.3, y, rx: Math.min(length * 0.5, u * 11) + u * 3, ry: u * (2.6 + 2.2 * v), color: col, alpha: role.dark ? 0.035 : 0.03, layers: 18, ms: 700, r, mode: role.dark ? "screen" : "multiply" }));
      this.add(g, stroke(g, { x, y, length, angle: gauss(r) * 0.018, width, ms: sec * 1000, color: col, r, curve: gauss(r) * u * 0.7, dry: 0.5 + 0.35 * r(), load: v > 0.5, glow: role.dark, maxX: W * (1 - MARGIN * 0.25) }));
      if (bass && v > 0.75 && r() < 0.12) this.add(g, drip(g, { x: x + u, y: y + width * 0.4, w: u * 0.34, length: u * between(r, 5, 13), color: col, rng: r }));
      // a hard pluck flicks a little paint off the brush, the way it is going
      if (v > 0.7 && r() < 0.3) speckle(g, { x: x + u * between(r, 2, 6), y: y - width * between(r, 0.6, 1.6), n: 3 + Math.floor(r() * 7), sx: u * 2.6, sy: u * 1.2, color: col, rng: r, size: u * 0.26 });
    } else if (p.kind === "melody") {
      const y = yOfMidi(p.midi, "melody", H);
      const ink = hexToRgb(pal.ink);
      const last = this.lastTune;
      const w1 = u * (0.5 + v * 0.5);
      if (last && last.layer === l && x - last.x > 1 && this.clock - last.at < spot.spb * 2600) {
        this.add(g, inkLine(g, { x0: last.x, y0: last.y, x1: x, y1: y, w0: u * 0.2, w1, ms: Math.max(45, Math.min(170, (this.clock - last.at) * 0.35)), color: ink, r, glow: role.dark }));
      } else {
        // the first note of a phrase: the pen flicks in from the left
        this.add(g, inkLine(g, { x0: x - u * between(r, 3.5, 6), y0: y + gauss(r) * u * 2.2, x1: x, y1: y, w0: u * 0.12, w1, ms: 60, color: ink, r, glow: role.dark }));
      }
      const bead = paint(pal.colors[colorIndex(p.midi, this.map, n, spot.index + 1)], 0.6);
      const size = u * (0.85 + v * 0.75);
      if (role.dark) {
        // on a dark ground a note is a point of light
        const halo = g.createRadialGradient(x, y, size * 0.4, x, y, size * 3.4);
        halo.addColorStop(0, css(bead, 0.42));
        halo.addColorStop(1, css(bead, 0));
        g.fillStyle = halo;
        g.beginPath();
        g.arc(x, y, size * 3.4, 0, Math.PI * 2);
        g.fill();
      }
      dab(g, { x, y, r: size, color: bead, rng: r, thick: true, rough: 0.12 });
      if (r() < 0.35) speckle(g, { x: x + u, y, n: 2 + Math.floor(r() * 4), sx: u * 1.6, sy: u * 1.4, color: bead, rng: r, size: u * 0.22 });
      this.lastTune = { layer: l, x, y, at: this.clock };
    } else {
      const ink = hexToRgb(pal.ink);
      const heavy = paint(role.low, 0.7);
      const pop = paint(role.pop);
      const drum = p.drum;
      const y = (wander = 0.12) => yOfDrum(drum, H, gauss(r) * wander);
      switch (drum) {
        case "kick": {
          const size = Math.min(u * (3.6 + 3.4 * v), Math.max(u * 1.6, beatPx * 0.5));
          const ky = y(0.2);
          this.add(g, wash(g, { x, y: ky, rx: size * 1.3, ry: size * 0.82, color: heavy, alpha: role.dark ? 0.045 : 0.05, layers: 24, ms: 460, r, mode: role.dark ? "screen" : "multiply" }));
          dab(g, { x, y: ky, r: size * 0.4, color: heavy, rng: r, thick: true, rough: 0.24, squash: 1.2 });
          break;
        }
        case "snare": {
          const sy = y(0.25);
          const col = paint(role.second);
          this.add(g, splatter(g, { x, y: sy, r: Math.min(u * (1.25 + 1.5 * v), Math.max(u, beatPx * 0.3)), color: col, rng: r, drops: Math.round(10 + 22 * v), spread: 1.5 + v, dir: -Math.PI / 2 + gauss(r) * 0.9 }));
          if (v > 0.8 && r() < 0.14) this.add(g, drip(g, { x, y: sy + u, w: u * 0.3, length: u * between(r, 4, 10), color: col, rng: r }));
          break;
        }
        case "clap": {
          const cy = y(0.2);
          const col = pop;
          this.add(g, flam(3, 16, () => dab(g, { x: x + gauss(r) * u * 1.3, y: cy + gauss(r) * u * 1.1, r: u * between(r, 0.8, 1.5) * (0.6 + v * 0.6), color: shade(col, (r() - 0.5) * 0.08), rng: r, thick: true, rough: 0.28 })));
          break;
        }
        case "tom": {
          const ty = y(0.3);
          const col = paint(pal.colors[2 % n]);
          this.add(g, wash(g, { x, y: ty, rx: u * 3.2, ry: u * 2.4, color: col, alpha: 0.05, layers: 12, ms: 300, r, mode: role.dark ? "screen" : "multiply" }));
          dab(g, { x, y: ty, r: u * (1.3 + 1.2 * v), color: col, rng: r, thick: true, rough: 0.22 });
          break;
        }
        case "hat":
          this.add(g, stroke(g, { x, y: y(0.5), length: u * (2 + 2.4 * v), angle: -0.75 + gauss(r) * 0.45, width: u * (0.6 + 0.5 * v), ms: 55, color: r() < 0.22 ? pop : mix(ink, hexToRgb(role.high), 0.2), r, dry: 0.35, alpha: 0.85 }));
          break;
        case "open":
          this.add(g, stroke(g, { x, y: y(0.4), length: u * (7 + 7 * v), angle: -0.1 + gauss(r) * 0.14, width: u * (1.2 + 0.8 * v), ms: 240, color: mix(ink, pop, 0.5), r, dry: 0.95, alpha: 0.8, curve: gauss(r) * u, glow: role.dark }));
          break;
        case "shaker":
          speckle(g, { x, y: y(0.5), n: Math.round(18 + 30 * v), sx: u * 2.1, sy: u * 1.1, color: mix(ink, pop, 0.25), rng: r, size: u * 0.2 });
          break;
        case "rim":
          ring(g, { x, y: y(0.3), r: u * (0.6 + 0.3 * v), w: Math.max(1, u * 0.2), color: ink, rng: r });
          break;
        default: {
          // a bell or a wood block: a bright bead with a ring round it
          const by = y(0.6);
          const col = pop;
          ring(g, { x, y: by, r: u * (1.5 + v), w: Math.max(0.8, u * 0.14), color: col, rng: r, alpha: 0.6 });
          dab(g, { x, y: by, r: u * (0.5 + 0.4 * v), color: col, rng: r, thick: true, rough: 0.1 });
        }
      }
    }
    g.restore();
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
      this.add(l.g, stroke(l.g, { x: W * between(r, -0.02, 0.12), y: H * between(r, 0.3, 0.8), length: W * between(r, 0.7, 1.0), angle: gauss(r) * 0.05, width: u * between(r, 9, 16), ms: between(r, 900, 1500), color: tint, r, curve: gauss(r) * u * 4, dry: 0.8, alpha: role.dark ? 0.1 : 0.13 }));
    }
  }

  /** Go on with every mark that is still being made. `dt` in milliseconds. Says whether any are left. */
  frame(dt: number): boolean {
    const step = Math.min(60, Math.max(0, dt));
    this.clock += step;
    if (!this.marks.length) return false;
    const left: { g: G; m: Mark }[] = [];
    for (const k of this.marks) {
      k.g.save();
      const done = k.m.step(step);
      k.g.restore();
      if (!done) left.push(k);
    }
    this.marks = left;
    return left.length > 0;
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
    if (texture) {
      g.globalCompositeOperation = "hard-light";
      g.globalAlpha = roles(this.pal).dark ? 0.5 : 1;
      g.drawImage(texture, 0, 0, out.width, out.height);
    }
    return out;
  }
}
