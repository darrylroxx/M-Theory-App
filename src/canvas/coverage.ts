/**
 * How much of the canvas the music may cover.
 *
 * The canvas fills in proportion to how much is playing: two quiet parts leave most of it bare
 * ground, a loud, full arrangement covers much more, and a third or so of the ground is always
 * left. The music sets a target,
 *
 *     C* = c_min + (c_max − c_min) · (1 − e^(−k·D)),
 *
 * where D, the density, adds up each layer that is playing, weighted by how loud it is (0..1
 * against a loud part of a song). With c_min 0.04, c_max 0.78 and k 0.35, one quiet part aims for
 * about 11 %, two quiet parts 18 %, two loud ones 39 %, four middling ones 46 % and six loud ones
 * 67 %.
 *
 * The target is kept three ways, as the research for this canvas proposes:
 * - a coarse map of the canvas (64 by 36 cells) keeps how much of each cell is painted, from the
 *   marks as they go down and, a few times a second, from the painting itself; a mark is let down
 *   in full while there is room, and thinned and shrunk once there is not (a cell never fills
 *   solid, and the canvas as a whole never passes its target for long);
 * - each layer has a ration of paint a second, in proportion to its own share of the density,
 *   and may hold no more than its share of the target, so a busy hi-hat cannot cover the canvas
 *   on its own and the other parts always find room;
 * - when the canvas is fuller than the music now calls for (a loud chorus has given way to a quiet
 *   verse), old paint sinks back into the ground until it is not. Nothing new has to be removed:
 *   quiet music simply stops adding, and the ground it leaves bare stays bare.
 */
import type { LayerKind } from "./layers";
import type { Stamp } from "./sim";

export const C_MIN = 0.04;
export const C_MAX = 0.78;
export const C_K = 0.35;
/** How much of the canvas the music calls to be covered, for a density `d`. */
export const targetCoverage = (d: number) => C_MIN + (C_MAX - C_MIN) * (1 - Math.exp(-C_K * Math.max(0, d)));

/** The density of the music: every layer that is playing, weighted by how loud it is (0..1). */
export function densityOf(layers: Iterable<{ active: boolean; loud: number }>): number {
  let d = 0;
  for (const l of layers) if (l.active) d += Math.max(0, Math.min(1, l.loud));
  return d;
}

/** Each layer's ration: how much of the canvas it may cover a second, for each unit of its own density. */
export const RATION: Record<LayerKind, number> = { drums: 0.012, bass: 0.016, chords: 0.03, melody: 0.016, harmony: 0.012, vocals: 0.016, other: 0.03 };

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

export class Budget {
  readonly cols: number;
  readonly rows: number;
  /** how much of each cell is painted, 0..1 */
  readonly cells: Float32Array;
  private w = 1000;
  private h = 560;
  /** what the music calls for now */
  target = C_MIN;
  /** how much each layer has covered lately (an average over about a second, as cover a second) */
  private spent = new Map<LayerKind, number>();
  /** each layer's share of the density */
  private share = new Map<LayerKind, number>();
  /** how much of the canvas each layer's paint covers (an estimate, kept in step with what is measured) */
  private owned = new Map<LayerKind, number>();
  private shares = 0;
  private mean = 0;
  private accX = 0;
  private accY = 0;

  constructor(cols = 64, rows = 36) {
    this.cols = cols;
    this.rows = rows;
    this.cells = new Float32Array(cols * rows);
  }

  size(w: number, h: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
  }
  clear() {
    this.cells.fill(0);
    this.spent.clear();
    this.owned.clear();
    this.mean = 0;
  }

  /** The music now: each layer, whether it is playing, and how loud. Sets the target. */
  setLayers(layers: { layer: LayerKind; active: boolean; loud: number }[]) {
    const d = densityOf(layers);
    this.target = targetCoverage(d);
    this.share.clear();
    this.shares = 0;
    for (const l of layers) {
      const sh = l.active ? clamp(l.loud) : 0;
      this.share.set(l.layer, sh);
      this.shares += sh;
    }
  }

  /** How much of the canvas is painted (0..1). */
  get covered() {
    return this.mean;
  }
  private refresh() {
    let s = 0;
    for (let i = 0; i < this.cells.length; i++) s += this.cells[i];
    this.mean = s / this.cells.length;
  }

  /** How much a mark would cover, as seen: its area (more for wet paint, which spreads) and how strongly it shows. */
  footprint(st: Stamp): { area: number; shows: number } {
    const spread = 1 + 1.4 * Math.min(1, st.water * 2);
    const area = Math.PI * st.r * st.r * Math.max(1, st.stretch) * spread;
    const amount = st.kind === 3 ? st.paint * 2 : st.paint;
    const shows = clamp((1 - Math.exp(-3.2 * amount)) / 0.22);
    return { area, shows };
  }

  /**
   * A layer asks to lay a mark. The answer is how much of it may go down (0..1); the mark is
   * counted at that weight. The caller thins and shrinks it accordingly.
   */
  admit(st: Stamp, layer: LayerKind, dt = 1 / 60): number {
    const { area, shows } = this.footprint(st);
    // the whole canvas: in full while under the target, less and less as it passes it, and nothing a little past it
    const over = this.mean - this.target;
    let allow = over <= 0 ? 1 : clamp(1 - over / (0.12 * this.target + 0.015));
    // the cell: never painted solid; room is shared out by what the music calls for
    const cx = clamp(Math.floor((st.x / this.w) * this.cols), 0, this.cols - 1);
    const cy = clamp(Math.floor((st.y / this.h) * this.rows), 0, this.rows - 1);
    const cap = Math.min(0.94, 0.42 + 0.75 * this.target);
    const here = this.cells[cy * this.cols + cx];
    if (here > cap) allow *= clamp((cap + 0.08 - here) / 0.08);
    // the layer's share of the target: what is left is kept for the others
    const share = this.share.get(layer) ?? 0.3;
    const fair = this.target * (this.shares > 0 ? Math.max(share, 0.05) / Math.max(this.shares, share) : 1);
    const owned = this.owned.get(layer) ?? 0;
    if (owned > fair) allow *= clamp(1 - (owned - fair) / (0.25 * fair + 0.01));
    // and its ration of paint a second
    const ration = RATION[layer] * (0.25 + share) * (0.5 + 2.2 * this.target);
    const spent = this.spent.get(layer) ?? 0;
    if (spent > ration) allow *= clamp(ration / spent, 0.1, 1);
    if (allow <= 0) return 0;
    this.record(st, area * allow, shows, layer, dt);
    return allow;
  }

  /** Count a mark that has gone down (`area` in pixels, `shows` how strongly it shows, 0..1). */
  private record(st: Stamp, area: number, shows: number, layer: LayerKind, dt: number) {
    const cw = this.w / this.cols;
    const ch = this.h / this.rows;
    const rad = Math.sqrt(area / Math.PI);
    const x0 = clamp(Math.floor((st.x - rad) / cw), 0, this.cols - 1);
    const x1 = clamp(Math.floor((st.x + rad) / cw), 0, this.cols - 1);
    const y0 = clamp(Math.floor((st.y - rad) / ch), 0, this.rows - 1);
    const y1 = clamp(Math.floor((st.y + rad) / ch), 0, this.rows - 1);
    const n = (x1 - x0 + 1) * (y1 - y0 + 1);
    // spread over the cells it touches, as a share of each cell's area
    const per = clamp(area / n / (cw * ch)) * shows;
    let added = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * this.cols + x;
        const before = this.cells[i];
        this.cells[i] = 1 - (1 - before) * (1 - per);
        added += this.cells[i] - before;
      }
    this.mean += added / this.cells.length;
    this.owned.set(layer, (this.owned.get(layer) ?? 0) + added / this.cells.length);
    // spent: an average over about a second of what was covered, as cover a second
    const k = Math.min(1, dt);
    this.spent.set(layer, (this.spent.get(layer) ?? 0) + added / this.cells.length / Math.max(dt, 1 / 240) * k);
  }

  /** Time passes: each layer's spending is forgotten over about a second; old paint fades at `fade` (a part each second). */
  tick(dt: number, fade = 0) {
    const k = Math.exp(-dt / 1);
    for (const [l, v] of this.spent) this.spent.set(l, v * k);
    if (fade > 0) {
      const keep = Math.exp(-fade * dt);
      for (let i = 0; i < this.cells.length; i++) this.cells[i] *= keep;
      this.mean *= keep;
      for (const [l, v] of this.owned) this.owned.set(l, v * keep);
    }
  }

  /** What the painting itself shows (a measured map, the same size): it replaces the estimate. */
  observe(map: ArrayLike<number>) {
    if (map.length !== this.cells.length) return;
    const before = this.mean;
    for (let i = 0; i < map.length; i++) this.cells[i] = clamp(map[i]);
    this.refresh();
    // each layer's part is scaled to match
    if (before > 1e-6) for (const [l, v] of this.owned) this.owned.set(l, (v * this.mean) / before);
  }

  /** The canvas moved (the river): `dx`, `dy` in pixels. */
  shift(dx: number, dy = 0) {
    // (a little at a time: the cells move once the canvas has moved a whole cell)
    this.accX += dx;
    this.accY += dy;
    const sx = Math.trunc(this.accX / (this.w / this.cols));
    const sy = Math.trunc(this.accY / (this.h / this.rows));
    this.accX -= sx * (this.w / this.cols);
    this.accY -= sy * (this.h / this.rows);
    if (!sx && !sy) return 0;
    const before = this.mean;
    const old = Float32Array.from(this.cells);
    for (let y = 0; y < this.rows; y++)
      for (let x = 0; x < this.cols; x++) {
        const fx = x - sx;
        const fy = y - sy;
        this.cells[y * this.cols + x] = fx >= 0 && fx < this.cols && fy >= 0 && fy < this.rows ? old[fy * this.cols + fx] : 0;
      }
    this.refresh();
    // what flowed off the canvas took each layer's paint with it, in proportion
    if (before > 1e-6) for (const [l, v] of this.owned) this.owned.set(l, (v * this.mean) / before);
    return sx;
  }

  /** How fast old paint should sink back into the ground (a part each second): only while the canvas is fuller than the music calls for. */
  sink(): number {
    const over = this.mean - this.target * 1.08;
    return over <= 0 ? 0 : Math.min(0.25, (0.09 * over) / Math.max(0.04, this.target));
  }
}
