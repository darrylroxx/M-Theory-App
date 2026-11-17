/**
 * The marks paint makes.
 *
 * Three families, as a painter has three ways of touching the surface:
 * - a brush pulled along a path (`paintPath`): bristle strokes, dry-brush drags, wet strokes,
 *   lines, ribbons, sprays, hatching, rows of dots;
 * - a brush put down and lifted (`touch`): dabs, prints, blots, dots, ticks, rings, bursts;
 * - paint that is thrown or left to run (`splatter`, `cloud`, `streak`, `wash`, `drip`).
 *
 * Every mark is drawn a little at a time, as a hand would make it, and what is drawn stays
 * drawn: nothing is redrawn from scratch, so a painting costs the same however much is on it.
 * A pulled stroke moves the way a hand moves: off slowly, fast through the middle, slowing to a
 * stop (the smoothest way of getting from one place to another), not at one steady speed.
 */
import { css, shade, type RGB } from "./color";
import { between, gauss, hash, noise, type Rng } from "./rand";

export type G = CanvasRenderingContext2D;
/** A mark being made. `step` draws the next bit (dt in milliseconds) and says whether it is finished. */
export interface Mark {
  step(dt: number): boolean;
}

const TAU = Math.PI * 2;

// ── outlines ──

/** The outline of a blob: a circle (or oval) whose edge wanders in and out. Points as x, y, x, y … */
export function blobPoints(x: number, y: number, rx: number, ry: number, rot: number, r: Rng, rough = 0.2, n = 14): number[] {
  const raw = Array.from({ length: n }, () => 1 + gauss(r) * rough);
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    // neighbours pull on each other, so the edge bulges rather than spikes
    const o = Math.max(0.35, (raw[(i + n - 1) % n] + 2 * raw[i] + raw[(i + 1) % n]) / 4);
    const a = (i / n) * TAU;
    const px = Math.cos(a) * rx * o;
    const py = Math.sin(a) * ry * o;
    pts.push(x + px * cs - py * sn, y + px * sn + py * cs);
  }
  return pts;
}

/** A closed, rounded path through the middle of each side of a polygon. */
export function smoothPath(g: G | Path2D, pts: number[]) {
  const n = pts.length / 2;
  const mx = (i: number) => (pts[2 * (i % n)] + pts[2 * ((i + 1) % n)]) / 2;
  const my = (i: number) => (pts[2 * (i % n) + 1] + pts[2 * ((i + 1) % n) + 1]) / 2;
  g.moveTo(mx(n - 1), my(n - 1));
  for (let i = 0; i < n; i++) g.quadraticCurveTo(pts[2 * i], pts[2 * i + 1], mx(i), my(i));
  g.closePath();
}

/**
 * Roughen an outline: every side gets a new point near its middle, pushed a random way by an
 * amount that depends on how long the side is. Done a few times over, a neat polygon becomes
 * the ragged edge of a watercolour wash.
 */
export function deform(pts: number[], r: Rng, variance: number): number[] {
  const n = pts.length / 2;
  const out = new Array<number>(n * 4);
  for (let i = 0; i < n; i++) {
    const ax = pts[2 * i];
    const ay = pts[2 * i + 1];
    const bx = pts[2 * ((i + 1) % n)];
    const by = pts[2 * ((i + 1) % n) + 1];
    const len = Math.hypot(bx - ax, by - ay);
    out[4 * i] = ax;
    out[4 * i + 1] = ay;
    out[4 * i + 2] = (ax + bx) / 2 + gauss(r) * len * variance;
    out[4 * i + 3] = (ay + by) / 2 + gauss(r) * len * variance;
  }
  return out;
}

/**
 * The tooth of the surface: its high and low points, fixed in place (0 = a peak that always takes
 * paint … 1 = a hollow only a full brush reaches). Dry brushes and chalk all skip on the same
 * grain, so where their strokes cross they break in the same places, as on real paper.
 */
export function tooth(x: number, y: number): number {
  // fine grain, gathered into clumps about nine times its size
  const fine = hash(Math.floor(x / 1.7) * 7349 + Math.floor(y / 1.7) * 9151);
  const clump = hash(Math.floor(x / 15) * 3571 + Math.floor(y / 15) * 2477);
  return fine * 0.72 + clump * 0.28;
}

/** How far a hand has got, part-way through a movement that takes one unit of time: off slowly, fastest in the middle, slowing to a stop. */
export const reach = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (10 - 15 * x + 6 * x * x);
};

// ── washes ──

export interface WashOpts {
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: RGB;
  /** how strong one layer is; many thin layers make the wash */
  alpha: number;
  layers: number;
  /** how long it takes to soak in */
  ms: number;
  r: Rng;
  /** how the wash sits on what is under it: "multiply" glazes (light ground), "screen" glows (dark ground) */
  mode: GlobalCompositeOperation;
  rot?: number;
}
/**
 * A wash: thin paint soaking outwards. It is many see-through layers of the same ragged shape,
 * each roughened a little differently, so the middle is dense and the edge feathers away.
 */
export function wash(g: G, o: WashOpts): Mark {
  let base = blobPoints(o.x, o.y, o.rx, o.ry, o.rot ?? 0, o.r, 0.14, 11);
  for (let k = 0; k < 3; k++) base = deform(base, o.r, 0.33);
  let done = 0;
  let owed = 1;
  let dried = false;
  return {
    step(dt) {
      owed += (dt * o.layers) / o.ms;
      const n = Math.min(o.layers - done, Math.floor(owed));
      owed -= n;
      g.globalCompositeOperation = o.mode;
      for (let k = 0; k < n; k++) {
        const p = deform(deform(base, o.r, 0.24), o.r, 0.24);
        g.beginPath();
        g.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
        g.closePath();
        g.globalAlpha = o.alpha * (0.6 + 0.8 * o.r());
        g.fillStyle = css(shade(o.color, (o.r() - 0.5) * 0.06));
        g.fill();
      }
      done += n;
      if (done >= o.layers && !dried) {
        dried = true;
        // as a wash dries the water carries pigment out to its edge and leaves a darker line there, stronger on its lower side
        const rim = new Path2D();
        rim.moveTo(base[0], base[1]);
        for (let i = 2; i < base.length; i += 2) rim.lineTo(base[i], base[i + 1]);
        rim.closePath();
        g.save();
        g.clip(rim);
        g.globalCompositeOperation = "source-over";
        g.strokeStyle = css(shade(o.color, -0.1));
        g.lineJoin = "round";
        for (const [wide, strength] of [[0.1, 1.2], [0.045, 2]] as const) {
          g.globalAlpha = Math.min(0.22, o.alpha * strength);
          g.lineWidth = Math.max(1.5, Math.min(o.rx, o.ry) * wide * 2);
          g.stroke(rim);
        }
        // and the heavier grains of pigment settle into the hollows of the surface
        g.fillStyle = css(shade(o.color, -0.16));
        for (let i = 0, k = Math.round(Math.min(90, (o.rx * o.ry) / 14)); i < k; i++) {
          const px = o.x + gauss(o.r) * o.rx * 0.5;
          const py = o.y + gauss(o.r) * o.ry * 0.5;
          if (tooth(px, py) < 0.5) continue;
          g.globalAlpha = Math.min(0.4, o.alpha * (2 + 3 * o.r()));
          g.fillRect(px, py, 0.8 + o.r() * 0.9, 0.8 + o.r() * 0.9);
        }
        g.restore();
      }
      return done >= o.layers;
    },
  };
}

/**
 * A backrun: a drop of water (or wetter paint) falls into a wash that is half dry and pushes the
 * pigment outwards. It leaves a pale patch with a crinkled dark line round it, like the edge of
 * a cauliflower. `g` must be a sheet of paint with nothing under it: the patch is made by
 * taking paint off.
 */
export function backrun(g: G, o: { x: number; y: number; r: number; color: RGB; rng: Rng; strength?: number }): Mark {
  const r = o.rng;
  const s = o.strength ?? 0.8;
  let outline = blobPoints(o.x, o.y, o.r, o.r * between(r, 0.75, 1), r() * TAU, r, 0.25, 8);
  for (let k = 0; k < 3; k++) outline = deform(outline, r, 0.4);
  const seed = Math.floor(r() * 9973);
  let grown = 0;
  return {
    step(dt) {
      // it spreads in a few breaths
      const before = grown;
      grown = Math.min(1, grown + dt / 700);
      const steps = 4;
      for (let k = Math.ceil(before * steps); k < Math.ceil(grown * steps); k++) {
        const f = 0.6 + (0.4 * (k + 1)) / steps;
        g.globalCompositeOperation = "destination-out";
        g.globalAlpha = 0.09 * s;
        g.fillStyle = "#000";
        g.beginPath();
        for (let i = 0; i < outline.length; i += 2) g.lineTo(o.x + (outline[i] - o.x) * f, o.y + (outline[i + 1] - o.y) * f);
        g.closePath();
        g.fill();
      }
      if (grown < 1) return false;
      // the front: the pigment it pushed ahead of itself, left as a broken line
      g.globalCompositeOperation = "source-over";
      g.strokeStyle = css(shade(o.color, -0.12));
      g.lineCap = "round";
      g.lineWidth = Math.max(0.7, o.r * 0.04);
      const n = outline.length / 2;
      for (let i = 0; i < n; i++) {
        if (noise(i / 3.1, seed) < 0.42) continue;
        const j = (i + 1) % n;
        g.globalAlpha = (0.3 + 0.3 * noise(i / 2, seed + 1)) * s;
        g.beginPath();
        g.moveTo(outline[2 * i], outline[2 * i + 1]);
        g.lineTo(outline[2 * j], outline[2 * j + 1]);
        g.stroke();
      }
      return true;
    },
  };
}

// ── a brush put down and lifted ──

/** The ways a brush can be put down and lifted. */
export const TOUCHES = ["round", "teardrop", "petal", "tile", "sponge", "blot", "ringdrop", "comma", "dot", "bead", "tick", "tally", "burst", "dash", "halo", "pair", "diamond", "wedge", "crescent", "block", "seed", "leaf", "nail", "blade", "stamp", "crown", "bloom", "edge"] as const;
export type Touch = (typeof TOUCHES)[number];

export interface DabOpts {
  x: number;
  y: number;
  /** its size: about half its width */
  r: number;
  color: RGB;
  rng: Rng;
  alpha?: number;
  /** how ragged the edge is */
  rough?: number;
  /** wider than tall (>1) or taller than wide (<1) */
  squash?: number;
  rot?: number;
  /** thick paint: a lit side and a shaded side */
  thick?: boolean;
}
/** A blob of paint, put down in one go. */
export function dab(g: G, o: DabOpts) {
  const sq = o.squash ?? 1;
  const pts = blobPoints(o.x, o.y, o.r * sq, o.r / sq, o.rot ?? 0, o.rng, o.rough ?? 0.2, o.r < 5 ? 9 : 14);
  g.globalCompositeOperation = "source-over";
  g.beginPath();
  smoothPath(g, pts);
  g.globalAlpha = o.alpha ?? 0.93;
  g.fillStyle = css(o.color);
  g.fill();
  if (o.thick && o.r > 2.5) {
    // light from the top left: a soft shine on that side, a shadow on the other
    const gr = g.createRadialGradient(o.x - o.r * 0.38, o.y - o.r * 0.38, o.r * 0.05, o.x, o.y, o.r * 1.15 * Math.max(sq, 1 / sq));
    gr.addColorStop(0, "rgba(255,255,255,0.3)");
    gr.addColorStop(0.45, "rgba(255,255,255,0)");
    gr.addColorStop(0.75, "rgba(0,0,0,0)");
    gr.addColorStop(1, "rgba(0,0,0,0.22)");
    g.globalAlpha = 1;
    g.fillStyle = gr;
    g.fill();
  }
}

export interface TouchOpts {
  x: number;
  y: number;
  /** its size: about half its width */
  r: number;
  color: RGB;
  rng: Rng;
  /** the way the brush was moving as it touched (radians): a teardrop's tail, a comma's curl and a tick's flick point this way */
  dir?: number;
  alpha?: number;
  /** how much longer than wide: a sound that lasts is a longer mark */
  long?: number;
}
/**
 * A shape drawn along a line: from (x, y), `len` long in the direction `dir`, as wide at every
 * point as `left` and `right` say (each takes how far along, 0..1, and gives the half-width on
 * its side), bowed sideways by `bow`. Most marks a brush makes when it is set down, pulled a
 * little and lifted are one of these.
 */
function along(g: G, x: number, y: number, dir: number, len: number, left: (t: number) => number, right: (t: number) => number, bow: number, r: Rng, rough = 0.05, n = 16) {
  const cs = Math.cos(dir);
  const sn = Math.sin(dir);
  const at = (t: number, off: number): [number, number] => {
    const side = bow * Math.sin(Math.PI * t) + off;
    return [x + cs * len * t - sn * side, y + sn * len * t + cs * side];
  };
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [px, py] = at(t, -left(t) * (1 + gauss(r) * rough));
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const [px, py] = at(t, right(t) * (1 + gauss(r) * rough));
    g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
}

/**
 * Put the brush down and lift it. Twenty-eight ways of doing it, from a loaded round brush
 * pressed flat to the tip of a liner flicked across, and a few shapes cut clean as if from paper.
 */
export function touch(g: G, kind: Touch, o: TouchOpts) {
  const r = o.rng;
  const a = o.alpha ?? 0.92;
  const dir = o.dir ?? 0;
  const long = Math.max(1, o.long ?? 1);
  const col = css(o.color);
  g.globalCompositeOperation = "source-over";
  g.lineCap = "round";
  g.lineJoin = "round";
  switch (kind) {
    case "round":
      dab(g, { x: o.x, y: o.y, r: o.r, color: o.color, rng: r, alpha: a, thick: true, squash: Math.sqrt(long) * between(r, 0.9, 1.15), rot: dir, rough: 0.2 });
      break;
    case "teardrop": {
      // pressed down and pulled away: fat where it landed, a point where it left
      const len = o.r * (1.3 + long * 1.1);
      const cs = Math.cos(dir);
      const sn = Math.sin(dir);
      const head = o.r * 0.92;
      // where the sides leave the round head (radians either side of straight ahead)
      const open = 1.15 + gauss(r) * 0.06;
      const steps = 10;
      g.beginPath();
      let fx = 0;
      let fy = 0;
      for (let i = 0; i <= steps; i++) {
        const t = dir + open + ((TAU - 2 * open) * i) / steps;
        const rad = head * (1 + gauss(r) * 0.05);
        const px = o.x + Math.cos(t) * rad;
        const py = o.y + Math.sin(t) * rad;
        if (i === 0) {
          g.moveTo(px, py);
          fx = px;
          fy = py;
        } else g.lineTo(px, py);
      }
      // in to the point and back, the sides a little hollow
      g.quadraticCurveTo(o.x + cs * len * 0.45 + sn * head * 0.42, o.y + sn * len * 0.45 - cs * head * 0.42, o.x + cs * len, o.y + sn * len + gauss(r) * o.r * 0.08);
      g.quadraticCurveTo(o.x + cs * len * 0.45 - sn * head * 0.42, o.y + sn * len * 0.45 + cs * head * 0.42, fx, fy);
      g.globalAlpha = a;
      g.fillStyle = col;
      g.fill();
      break;
    }
    case "petal":
      // the print of a filbert: an oval with one blunt end
      dab(g, { x: o.x, y: o.y, r: o.r * 1.05, color: o.color, rng: r, alpha: a, thick: true, squash: 1.35 * Math.sqrt(long), rot: dir + gauss(r) * 0.25, rough: 0.1 });
      break;
    case "tile": {
      // the print of a flat brush: a block with ragged ends and the grain of its bristles
      const w = o.r * 1.5 * long;
      const h = o.r * 0.85;
      g.save();
      g.translate(o.x, o.y);
      g.rotate(dir + gauss(r) * 0.08);
      g.beginPath();
      const steps = 6;
      for (let i = 0; i <= steps; i++) g.lineTo(-w + gauss(r) * o.r * 0.12, -h + (2 * h * i) / steps);
      for (let i = steps; i >= 0; i--) g.lineTo(w + gauss(r) * o.r * 0.14, -h + (2 * h * i) / steps);
      g.closePath();
      g.globalAlpha = a * 0.9;
      g.fillStyle = col;
      g.fill();
      const lines = Math.max(2, Math.round(h / 1.6));
      for (let i = 0; i < lines; i++) {
        const y = -h + ((i + 0.5) * 2 * h) / lines;
        g.globalAlpha = 0.16 + 0.2 * r();
        g.strokeStyle = css(shade(o.color, (r() - 0.5) * 0.2));
        g.lineWidth = 0.8 + r();
        g.beginPath();
        g.moveTo(-w * between(r, 0.7, 1), y);
        g.lineTo(w * between(r, 0.5, 1), y + gauss(r) * 0.4);
        g.stroke();
      }
      g.restore();
      break;
    }
    case "sponge": {
      // dabbed with a sponge: a patch of small touching blobs with gaps between
      const n = Math.round(14 + o.r * 2.2);
      for (let i = 0; i < n; i++) {
        const d = Math.sqrt(r()) * o.r;
        const t = r() * TAU;
        dab(g, { x: o.x + Math.cos(t) * d * Math.sqrt(long), y: o.y + Math.sin(t) * d, r: o.r * between(r, 0.16, 0.34), color: shade(o.color, (r() - 0.5) * 0.1), rng: r, alpha: a * between(r, 0.6, 0.95), rough: 0.25 });
      }
      break;
    }
    case "blot": {
      // ink let fall on damp paper: a body with little feet running out along the fibres
      const n = 30;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const t = (i / n) * TAU;
        const rad = o.r * (0.78 + (r() < 0.22 ? between(r, 0.3, 0.8) : gauss(r) * 0.07));
        g.lineTo(o.x + Math.cos(t) * rad * Math.sqrt(long), o.y + Math.sin(t) * rad);
      }
      g.closePath();
      g.globalAlpha = a;
      g.fillStyle = col;
      g.fill();
      break;
    }
    case "ringdrop": {
      // a drop of water in wet paint pushes the pigment outwards: a pale middle and a dark rim
      const pts = blobPoints(o.x, o.y, o.r * Math.sqrt(long), o.r, dir, r, 0.1, 12);
      g.beginPath();
      smoothPath(g, pts);
      g.globalAlpha = a * 0.16;
      g.fillStyle = col;
      g.fill();
      g.globalAlpha = a * 0.8;
      g.strokeStyle = col;
      g.lineWidth = Math.max(0.8, o.r * 0.24);
      g.stroke();
      break;
    }
    case "comma": {
      // the tip set down, swung round and lifted
      const len = o.r * (1.8 + long);
      const curl = between(r, 0.5, 1.1) * (r() < 0.5 ? 1 : -1);
      const n = 7;
      let px = o.x;
      let py = o.y;
      g.strokeStyle = col;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const ang = dir + curl * t;
        const nx = px + (Math.cos(ang) * len) / n;
        const ny = py + (Math.sin(ang) * len) / n;
        g.globalAlpha = a;
        g.lineWidth = Math.max(0.7, o.r * 1.1 * (1 - t) ** 1.3 + 0.6);
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(nx, ny);
        g.stroke();
        px = nx;
        py = ny;
      }
      break;
    }
    case "dot":
      g.globalAlpha = a;
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(o.x, o.y, o.r * 0.6 * Math.sqrt(long), o.r * 0.6, dir, 0, TAU);
      g.fill();
      break;
    case "bead":
      // a bead of thick paint, standing up off the surface
      dab(g, { x: o.x, y: o.y, r: o.r * 0.75, color: o.color, rng: r, alpha: a, thick: true, rough: 0.06, squash: Math.sqrt(long), rot: dir });
      break;
    case "tick": {
      // a flick of the tip: it lands, and is gone in a thin tail
      const len = o.r * (1.6 + long * 0.7);
      const ang = dir - 0.55 + gauss(r) * 0.15;
      g.globalAlpha = a;
      g.fillStyle = col;
      along(g, o.x, o.y, ang, len, (t) => o.r * 0.34 * Math.pow(1 - t, 1.2) + 0.25, (t) => o.r * 0.34 * Math.pow(1 - t, 1.2) + 0.25, gauss(r) * o.r * 0.2, r, 0.04, 8);
      g.beginPath();
      g.arc(o.x, o.y, o.r * 0.36, 0, TAU);
      g.fill();
      break;
    }
    case "tally": {
      // two or three short strokes side by side, as a pen makes when it is worked quickly on the spot
      const k = r() < 0.5 ? 2 : 3;
      const ang = dir - 1.05 + gauss(r) * 0.12;
      const len = o.r * 1.25;
      const gap = o.r * 0.7 * Math.sqrt(long);
      g.strokeStyle = col;
      for (let i = 0; i < k; i++) {
        const cx = o.x + (i - (k - 1) / 2) * gap + gauss(r) * o.r * 0.06;
        const l = len * between(r, 0.8, 1.15);
        g.globalAlpha = a * between(r, 0.75, 1);
        g.lineWidth = Math.max(0.8, o.r * between(r, 0.2, 0.3));
        g.beginPath();
        g.moveTo(cx - Math.cos(ang) * l * 0.5, o.y - Math.sin(ang) * l * 0.5);
        g.lineTo(cx + Math.cos(ang) * l * 0.5, o.y + Math.sin(ang) * l * 0.5);
        g.stroke();
      }
      break;
    }
    case "burst": {
      // short lines flying out from a point, as salt draws paint to itself
      const n = 5 + Math.floor(r() * 5);
      g.strokeStyle = col;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * TAU + gauss(r) * 0.25;
        const from = o.r * between(r, 0.15, 0.4);
        const to = o.r * between(r, 0.8, 1.5);
        g.globalAlpha = a * between(r, 0.6, 1);
        g.lineWidth = Math.max(0.6, o.r * 0.16);
        g.beginPath();
        g.moveTo(o.x + Math.cos(t) * from * Math.sqrt(long), o.y + Math.sin(t) * from);
        g.lineTo(o.x + Math.cos(t) * to * Math.sqrt(long), o.y + Math.sin(t) * to);
        g.stroke();
      }
      break;
    }
    case "dash": {
      // the edge of a flat brush touched down: a short straight bar
      const len = o.r * (0.9 + long * 0.9);
      g.globalAlpha = a;
      g.strokeStyle = col;
      g.lineCap = "butt";
      g.lineWidth = Math.max(1, o.r * 0.5);
      g.beginPath();
      g.moveTo(o.x - Math.cos(dir) * len * 0.3, o.y - Math.sin(dir) * len * 0.3);
      g.lineTo(o.x + Math.cos(dir) * len, o.y + Math.sin(dir) * len);
      g.stroke();
      g.lineCap = "round";
      break;
    }
    case "halo": {
      // a soft breath of colour with no edge at all
      const rad = o.r * 1.9;
      const gr = g.createRadialGradient(o.x, o.y, 0, o.x, o.y, rad);
      gr.addColorStop(0, css(o.color, a * 0.7));
      gr.addColorStop(0.5, css(o.color, a * 0.28));
      gr.addColorStop(1, css(o.color, 0));
      g.globalAlpha = 1;
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(o.x, o.y, rad * Math.sqrt(long), rad, dir, 0, TAU);
      g.fill();
      break;
    }
    case "pair": {
      // two touches side by side: the brush bounced
      const gap = o.r * 0.95;
      for (const s of [-1, 1]) dab(g, { x: o.x + Math.cos(dir) * gap * s, y: o.y + Math.sin(dir) * gap * s, r: o.r * (s < 0 ? 0.62 : 0.48), color: o.color, rng: r, alpha: a, thick: true, rough: 0.14 });
      break;
    }
    case "diamond":
    case "block": {
      // a shape with corners, cut by hand: no two sides quite the same
      const turn = dir + (kind === "diamond" ? 0 : Math.PI / 4) + gauss(r) * 0.12;
      const k = kind === "diamond" ? 1.15 : 1.05;
      g.beginPath();
      for (let i = 0; i < 4; i++) {
        const t = turn + (i * Math.PI) / 2;
        const rad = o.r * k * (i % 2 === 0 ? Math.sqrt(long) : 1 / Math.sqrt(kind === "diamond" ? 1.25 : 1)) * (1 + gauss(r) * 0.07);
        g.lineTo(o.x + Math.cos(t) * rad, o.y + Math.sin(t) * rad);
      }
      g.closePath();
      g.globalAlpha = a;
      g.fillStyle = col;
      g.fill();
      break;
    }
    case "wedge": {
      // wide where the sound begins, a point where it has died away: the shape of a struck note
      const len = o.r * (1.5 + long * 1.1);
      const half = o.r * 0.9;
      const cs = Math.cos(dir);
      const sn = Math.sin(dir);
      const back = o.r * 0.6;
      g.beginPath();
      g.moveTo(o.x - cs * back + sn * half * (1 + gauss(r) * 0.08), o.y - sn * back - cs * half);
      g.quadraticCurveTo(o.x - cs * back * 1.25, o.y - sn * back * 1.25, o.x - cs * back - sn * half * (1 + gauss(r) * 0.08), o.y - sn * back + cs * half);
      g.lineTo(o.x + cs * len, o.y + sn * len + gauss(r) * o.r * 0.1);
      g.closePath();
      g.globalAlpha = a;
      g.fillStyle = col;
      g.fill();
      break;
    }
    case "crescent": {
      // the brush swung round on the spot: thin, thick, thin
      const open = dir + Math.PI + gauss(r) * 0.6;
      const rad = o.r * Math.sqrt(long);
      const sweep = between(r, 2.6, 3.6);
      const n = 12;
      g.beginPath();
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i <= n; i++) {
          const t = pass === 0 ? i / n : 1 - i / n;
          const ang = open + Math.PI - sweep / 2 + sweep * t;
          const w = o.r * 0.34 * Math.pow(Math.sin(Math.PI * t), 0.8) + 0.3;
          const rr = rad + (pass === 0 ? w : -w);
          const px = o.x + Math.cos(ang) * rr;
          const py = o.y + Math.sin(ang) * rr;
          if (pass === 0 && i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
      }
      g.closePath();
      g.globalAlpha = a;
      g.fillStyle = col;
      g.fill();
      break;
    }
    case "seed": {
      // a handful of small firm touches close together, as a round brush leaves when it is tapped
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const t = (i / n) * TAU + r();
        const d = o.r * between(r, 0.35, 0.9);
        dab(g, { x: o.x + Math.cos(t) * d * Math.sqrt(long), y: o.y + Math.sin(t) * d, r: o.r * between(r, 0.22, 0.4), color: shade(o.color, (r() - 0.5) * 0.08), rng: r, alpha: a, rough: 0.12, squash: between(r, 1, 1.5), rot: t });
      }
      break;
    }
    case "leaf": {
      // the brush lands dark, swells, and is drawn off to a long point: the leaf of ink painting
      const len = o.r * (2.2 + long * 1.2);
      const half = o.r * 0.62;
      const w = (t: number) => half * (t < 0.35 ? Math.pow(t / 0.35, 0.8) : Math.pow((1 - t) / 0.65, 1.3)) + 0.2;
      const gr = g.createLinearGradient(o.x, o.y, o.x + Math.cos(dir) * len, o.y + Math.sin(dir) * len);
      gr.addColorStop(0, css(o.color, a));
      gr.addColorStop(1, css(o.color, a * 0.55));
      g.globalAlpha = 1;
      g.fillStyle = gr;
      along(g, o.x - Math.cos(dir) * o.r * 0.4, o.y - Math.sin(dir) * o.r * 0.4, dir, len, w, w, gauss(r) * o.r * 0.22, r);
      break;
    }
    case "nail": {
      // set down hard and drawn off: a blunt head and a long thinning tail
      const len = o.r * (2.4 + long * 1.5);
      const head = 0.12;
      const w = (t: number) => o.r * 0.5 * (t < head ? 0.8 + (0.2 * t) / head : Math.pow((1 - t) / (1 - head), 1.5)) + 0.2;
      g.globalAlpha = a;
      g.fillStyle = col;
      along(g, o.x - Math.cos(dir) * o.r * 0.3, o.y - Math.sin(dir) * o.r * 0.3, dir, len, w, w, gauss(r) * o.r * 0.15, r);
      dab(g, { x: o.x, y: o.y, r: o.r * 0.6, color: o.color, rng: r, alpha: a, thick: true, rough: 0.12 });
      break;
    }
    case "blade": {
      // the long edge of a dagger brush laid down: one side straight, the other full, and a needle of a tip
      const len = o.r * (2.2 + long * 1.3);
      const lean = r() < 0.5 ? 0.25 : 0.75;
      g.globalAlpha = a;
      g.fillStyle = col;
      along(g, o.x - Math.cos(dir) * o.r * 0.5, o.y - Math.sin(dir) * o.r * 0.5, dir, len, (t) => o.r * 1.2 * lean * Math.pow(Math.sin(Math.PI * t), 0.7) + 0.2, (t) => o.r * 1.2 * (1 - lean) * Math.pow(Math.sin(Math.PI * t), 1.6) + 0.2, 0, r);
      break;
    }
    case "stamp": {
      // the flat end of a stiff brush pressed straight down: a disc of pin-points, crowded at its rim
      const n = Math.round(26 + o.r * 3);
      g.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const d = o.r * (r() < 0.3 ? between(r, 0.8, 1) : Math.sqrt(r()));
        const t = r() * TAU;
        const px = o.x + Math.cos(t) * d * Math.sqrt(long);
        const py = o.y + Math.sin(t) * d;
        if (tooth(px, py) > 0.8) continue;
        g.globalAlpha = a * between(r, 0.5, 0.95);
        g.beginPath();
        g.arc(px, py, Math.max(0.5, o.r * between(r, 0.07, 0.15)), 0, TAU);
        g.fill();
      }
      break;
    }
    case "crown": {
      // a drop from a height: a blot, with fingers thrown out all round it and a bead at the end of each
      dab(g, { x: o.x, y: o.y, r: o.r * 0.66, color: o.color, rng: r, alpha: a, thick: true, rough: 0.16 });
      const n = 7 + Math.floor(r() * 7);
      g.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + gauss(r) * 0.14;
        const reach = o.r * Math.min(1.7, 0.75 * Math.exp(gauss(r) * 0.4)) * (1 + 0.4 * Math.max(0, Math.cos(ang - dir)) * (long - 1));
        g.globalAlpha = a * 0.9;
        along(g, o.x + Math.cos(ang) * o.r * 0.5, o.y + Math.sin(ang) * o.r * 0.5, ang, reach, (t) => o.r * 0.13 * (1 - t) + 0.25, (t) => o.r * 0.13 * (1 - t) + 0.25, 0, r, 0.04, 4);
        g.beginPath();
        g.arc(o.x + Math.cos(ang) * (o.r * 0.5 + reach), o.y + Math.sin(ang) * (o.r * 0.5 + reach), Math.max(0.5, o.r * 0.1), 0, TAU);
        g.fill();
        if (r() < 0.3) {
          // a drop that flew clear
          const far = o.r * 0.5 + reach * between(r, 1.3, 2.1);
          g.beginPath();
          g.arc(o.x + Math.cos(ang) * far, o.y + Math.sin(ang) * far, Math.max(0.4, o.r * between(r, 0.05, 0.11)), 0, TAU);
          g.fill();
        }
      }
      break;
    }
    case "bloom": {
      // a full tip touched to damp paper: a dark heart, and colour feathering out round it with no edge to it
      const rad = o.r * 2.1;
      const gr = g.createRadialGradient(o.x, o.y, 0, o.x, o.y, rad);
      gr.addColorStop(0, css(o.color, a * 0.34));
      gr.addColorStop(0.45, css(o.color, a * 0.14));
      gr.addColorStop(1, css(o.color, 0));
      g.globalAlpha = 1;
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(o.x, o.y, rad * Math.sqrt(long), rad, dir, 0, TAU);
      g.fill();
      g.fillStyle = col;
      for (let k = 0; k < 5; k++) {
        g.beginPath();
        smoothPath(g, deform(blobPoints(o.x, o.y, o.r * (0.75 + 0.22 * k) * Math.sqrt(long), o.r * (0.75 + 0.22 * k), dir, r, 0.16, 9), r, 0.3));
        g.globalAlpha = a * 0.07;
        g.fill();
      }
      dab(g, { x: o.x, y: o.y, r: o.r * 0.5, color: o.color, rng: r, alpha: a * 0.85, rough: 0.14 });
      break;
    }
    case "edge": {
      // the edge of a knife touched down: a short dead-straight line, with a bead or two of paint left along it
      const len = o.r * (1.9 + long * 0.8);
      const cs = Math.cos(dir);
      const sn = Math.sin(dir);
      g.globalAlpha = a;
      g.strokeStyle = col;
      g.fillStyle = col;
      g.lineCap = "butt";
      g.lineWidth = Math.max(1, o.r * 0.2);
      g.beginPath();
      g.moveTo(o.x - cs * len * 0.5, o.y - sn * len * 0.5);
      g.lineTo(o.x + cs * len * 0.5, o.y + sn * len * 0.5);
      g.stroke();
      g.lineCap = "round";
      for (let i = 0, k = 1 + Math.floor(r() * 3); i < k; i++) {
        const t = between(r, -0.45, 0.45);
        g.beginPath();
        g.ellipse(o.x + cs * len * t, o.y + sn * len * t, o.r * between(r, 0.2, 0.34), o.r * between(r, 0.12, 0.2), dir, 0, TAU);
        g.fill();
      }
      break;
    }
  }
}

// ── a brush pulled along ──

/** One point of the path a brush is pulled along. */
export interface Pt {
  x: number;
  y: number;
  /** how hard the brush is pressed here: 1 = its full width */
  w: number;
  /** how much paint it still has here: 1 = loaded, 0 = dry */
  a: number;
}

/** The brushes that can be pulled along a path. */
export const BRUSHES = ["bristle", "dry", "wet", "wash", "liner", "ribbon", "spray", "hatch", "dots", "fan", "double", "side", "knife", "chalk", "dashes", "scribble", "nib", "reed", "sketch", "bone"] as const;
export type Brush = (typeof BRUSHES)[number];

export interface PathOpts {
  brush: Brush;
  /** how wide the brush is at full pressure */
  width: number;
  color: RGB;
  r: Rng;
  /** how long the whole stroke takes */
  ms: number;
  alpha?: number;
  /** 0 = a wet, full brush; 1 = it runs dry almost at once and leaves streaks (on top of what the path says about its paint) */
  dry?: number;
  /** on a dark ground: the paint glows */
  glow?: boolean;
  /** how a wet stroke sits on what is under it */
  mode?: GlobalCompositeOperation;
  /** the brush moves like a hand (off slowly, fast in the middle, slowing to a stop) rather than at one speed */
  hand?: boolean;
  /** the second colour of a double-loaded brush */
  second?: RGB;
  /** the brush stops at this x (the edge of the canvas) */
  maxX?: number;
}

/**
 * Pull a brush along a path. The path says where the brush goes, how hard it is pressed and how
 * much paint it has left at every point; the brush decides what that looks like.
 * - bristle: a flat or round bristle brush; every bristle has its own shade and runs dry in its own time
 * - dry: the same with almost no paint: broken streaks that only catch here and there
 * - wet: thin paint put down touch over touch: soft, ragged edges that are darker than its middle, and a bead where it stops
 * - wash: watercolour pulled in one go: a soft band, densest along its middle, with a darker line where its edges dried
 * - liner: one line, thick where it is pressed and thin where it is lifted
 * - ribbon: a flat brush turning as it goes, so the band swells and narrows
 * - spray: no brush on the surface at all: fine spatter along the path
 * - hatch: short strokes across the path, side by side
 * - dots: a row of touches, each fainter than the last
 * - fan: a fan brush, its bristles spread: a few hairlines far apart
 * - double: a brush loaded with two colours side by side
 * - knife: a palette knife: a flat slab of thick paint with broken edges and a ridge where the blade left it
 * - chalk: a stick of pastel dragged over the tooth of the surface: it only catches on the high points
 * - dashes: the brush touched down and lifted again and again along the way
 * - scribble: a pen worked quickly from side to side
 * - nib: a broad pen held at a slant: thin going up, thick coming down
 * - side: a brush loaded on one side only: dark along one edge, fading to almost nothing at the other
 * - reed: a cut reed: a solid line while it is full, then two tracks as the nib splits, then scratches
 * - sketch: a line found by drawing it twice, the second pass not quite on the first
 * - bone: a firm, even line with a knot of paint at each end, as ink painters draw the bones of things
 */
export function paintPath(g: G, pts: Pt[], o: PathOpts): Mark {
  const r = o.r;
  const n = pts.length;
  if (n < 2) return { step: () => true };
  const alpha = o.alpha ?? 0.92;
  const seed = Math.floor(r() * 9973);
  // which way is "across" at each point
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  let length = 0;
  const far = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[Math.min(n - 1, i + 1)];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const d = Math.hypot(dx, dy) || 1;
    nx[i] = -dy / d;
    ny[i] = dx / d;
    if (i > 0) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    far[i] = length;
  }
  const brush = o.brush;
  const dryness = brush === "dry" ? Math.max(0.85, o.dry ?? 0.9) : (o.dry ?? 0.4);
  const count = brush === "fan" ? Math.max(3, Math.min(7, Math.round(o.width / 3.2))) : Math.max(2, Math.min(26, Math.round(o.width / (brush === "dry" ? 1.25 : 1.6))));
  const bristles =
    brush === "bristle" || brush === "dry" || brush === "fan" || brush === "double" || brush === "side"
      ? Array.from({ length: count }, (_, i) => {
          const across = count === 1 ? 0 : i / (count - 1) - 0.5;
          const edge = Math.abs(across) * 2;
          const base = brush === "double" && o.second && across > 0 ? o.second : o.color;
          return {
            off: across * o.width * (brush === "fan" ? 1.5 : 0.9 + 0.2 * r()),
            phase: r() * 1000,
            color: css(shade(base, (r() - 0.5) * 0.13)),
            // (a brush loaded on one side: full strength along that edge, nearly nothing at the other)
            alpha: brush === "side" ? alpha * (0.95 - 0.8 * Math.pow(across + 0.5, 0.7)) : alpha * (0.5 + 0.5 * r()) * (1 - 0.3 * edge * r()),
            lw: brush === "fan" ? 0.7 + 0.8 * r() : Math.max(0.7, (o.width / count) * (0.8 + 1.1 * r())),
            // the bristles at the edge of the brush run dry first
            dry: Math.max(0.03, 1.25 - dryness * (0.55 + 0.9 * r()) - edge * dryness * 0.3),
            ridge: alpha > 0.5 && brush !== "fan" && r() < 0.26,
          };
        })
      : [];
  const col = css(o.color);
  const dark = css(shade(o.color, -0.12));
  const glow = o.glow ? css(shade(o.color, 0.08)) : "";
  let at = 0; // how many points have been passed
  let spent = 0;
  let stamp = 0; // how far along the last wet stamp, dot or hatch was put down
  let ended = false;
  let knotted = false;
  const point = (i: number, off: number): [number, number] => [pts[i].x + nx[i] * off, pts[i].y + ny[i] * off];
  return {
    step(dt) {
      spent += dt;
      const t = Math.min(1, spent / Math.max(1, o.ms));
      const upto = Math.min(n - 1, Math.round((o.hand === false ? t : reach(t)) * (n - 1)));
      if (upto > at) {
        const i0 = at;
        const i1 = upto;
        g.globalCompositeOperation = "source-over";
        g.lineJoin = "round";
        const cut = (i: number) => o.maxX !== undefined && pts[i].x > o.maxX;
        if (glow && brush !== "spray" && brush !== "dots") {
          // a soft light around the stroke, laid in bands, widest and faintest first, so it fades away to the sides
          // (the paint's own colour, thinly: it can pile up to the colour itself but never bleach to white)
          g.strokeStyle = glow;
          g.lineCap = "butt";
          const paint = pts[i1].a;
          for (const wide of [4.2, 3.3, 2.5, 1.9, 1.4]) {
            g.globalAlpha = 0.034 * (0.25 + 0.75 * paint);
            g.lineWidth = o.width * wide * (0.4 + 0.6 * pts[i1].w);
            g.beginPath();
            g.moveTo(pts[i0].x, pts[i0].y);
            for (let i = i0 + 1; i <= i1; i++) if (!cut(i)) g.lineTo(pts[i].x, pts[i].y);
            g.stroke();
          }
        }
        if (bristles.length) {
          g.lineCap = "butt";
          if (o.width > 6 && !o.glow && alpha > 0.5 && brush !== "fan") {
            // thick paint stands off the canvas: a thin shadow along its lower edge
            g.globalAlpha = 0.1;
            g.strokeStyle = "#000";
            g.lineWidth = 1.6;
            g.beginPath();
            let down = false;
            for (let i = i0; i <= i1; i++) {
              // (only where there is paint enough to stand up)
              if (pts[i].a < 0.5 || cut(i) || i / (n - 1) > 1.1 - dryness * 0.75) {
                down = false;
                continue;
              }
              const [px, py] = point(i, o.width * 0.5 * pts[i].w);
              if (down) g.lineTo(px + 0.8, py + 1);
              else g.moveTo(px + 0.8, py + 1);
              down = true;
            }
            g.stroke();
          }
          for (const b of bristles) {
            const path = new Path2D();
            let pen = false;
            let any = false;
            for (let i = i0; i <= i1; i++) {
              const p = pts[i];
              const tt = i / (n - 1);
              // a bristle skips where it has run out: later along the stroke, and wherever the path says the paint is thin
              const thirst = Math.max(tt - b.dry, 1 - p.a - b.dry * 0.75);
              if (cut(i) || (thirst > 0 && noise(far[i] / 5 + b.phase * 3, seed) < Math.min(0.95, thirst / Math.max(0.05, 1.04 - b.dry) + 0.12))) {
                pen = false;
                continue;
              }
              const wob = (noise(far[i] / 16 + b.phase, seed + 1) - 0.5) * 2.4;
              const [px, py] = point(i, b.off * p.w + wob);
              if (pen) path.lineTo(px, py);
              else path.moveTo(px, py);
              any = any || pen;
              pen = true;
            }
            if (!any) continue;
            g.globalAlpha = b.alpha * (0.45 + 0.55 * pts[i1].a);
            g.strokeStyle = b.color;
            g.lineWidth = b.lw;
            g.stroke(path);
            if (b.ridge) {
              // a ridge of paint: lit on one side, in shadow on the other
              g.lineWidth = 0.7;
              g.globalAlpha = 0.2;
              g.strokeStyle = "#fff";
              g.translate(-0.6, -0.6);
              g.stroke(path);
              g.strokeStyle = "#000";
              g.globalAlpha = 0.14;
              g.translate(1.3, 1.3);
              g.stroke(path);
              g.translate(-0.7, -0.7);
            }
          }
        } else if (brush === "liner" || brush === "sketch") {
          g.strokeStyle = col;
          if (brush === "liner" && o.width > 1.6) {
            // the wet edge of the line: a faint wider band under it, laid in one piece
            g.lineCap = "butt";
            g.globalAlpha = (o.glow ? 0.16 : 0.1) * (0.3 + 0.7 * pts[i1].a) * alpha;
            g.lineWidth = o.width * pts[i1].w * 2.2;
            g.beginPath();
            g.moveTo(pts[i0].x, pts[i0].y);
            for (let i = i0 + 1; i <= i1; i++) if (!cut(i)) g.lineTo(pts[i].x, pts[i].y);
            g.stroke();
          }
          g.lineCap = "round";
          // (a sketched line is drawn twice, the second pass not quite on the first)
          for (let pass = 0; pass < (brush === "sketch" ? 2 : 1); pass++) {
            const wander = brush === "sketch" ? (i: number) => (noise(far[i] / (36 - pass * 9), seed + pass * 11) - 0.5) * Math.max(2.2, o.width * 0.9) : () => 0;
            for (let i = i0; i < i1; i++) {
              if (cut(i + 1)) break;
              const p = pts[i + 1];
              const w = Math.max(0.5, o.width * (brush === "sketch" ? 0.5 : 1) * p.w * (0.85 + 0.3 * noise(far[i] / 7, seed + pass)));
              const [ax, ay] = point(i, wander(i));
              const [bx, by] = point(i + 1, wander(i + 1));
              g.beginPath();
              g.moveTo(ax, ay);
              g.lineTo(bx, by);
              g.globalAlpha = alpha * (brush === "sketch" ? 0.7 : 1) * (0.35 + 0.65 * p.a);
              g.lineWidth = w;
              g.stroke();
            }
          }
        } else if (brush === "reed") {
          // a cut reed: full, it draws a solid line; as it empties the nib splits and draws two; then it only scratches
          g.strokeStyle = col;
          g.lineCap = "round";
          for (let i = i0; i < i1; i++) {
            if (cut(i + 1)) break;
            const p = pts[i + 1];
            const w = Math.max(0.6, o.width * p.w);
            if (p.a > 0.55) {
              g.globalAlpha = alpha * (0.6 + 0.4 * p.a);
              g.lineWidth = w * (0.9 + 0.2 * noise(far[i] / 8, seed));
              g.beginPath();
              g.moveTo(pts[i].x, pts[i].y);
              g.lineTo(p.x, p.y);
              g.stroke();
            } else if (p.a > 0.22) {
              // how far the nib has opened
              const open = (0.55 - p.a) / 0.33;
              g.lineWidth = Math.max(0.6, w * (0.3 - 0.12 * open));
              for (const side of [-1, 1]) {
                const [ax, ay] = point(i, side * w * 0.36 * (0.5 + 0.5 * open));
                const [bx, by] = point(i + 1, side * w * 0.36 * (0.5 + 0.5 * open));
                g.globalAlpha = alpha * (0.5 + 0.4 * p.a);
                g.beginPath();
                g.moveTo(ax, ay);
                g.lineTo(bx, by);
                g.stroke();
              }
              g.globalAlpha = alpha * 0.25 * (1 - open);
              g.lineWidth = w * 0.6;
              g.beginPath();
              g.moveTo(pts[i].x, pts[i].y);
              g.lineTo(p.x, p.y);
              g.stroke();
            } else if (noise(far[i] / 6, seed + 2) > 0.52) {
              const side = noise(far[i] / 40, seed + 3) > 0.5 ? 1 : -1;
              const [ax, ay] = point(i, side * w * 0.3);
              const [bx, by] = point(i + 1, side * w * 0.3);
              g.globalAlpha = alpha * 0.5;
              g.lineWidth = 0.7;
              g.beginPath();
              g.moveTo(ax, ay);
              g.lineTo(bx, by);
              g.stroke();
            }
          }
        } else if (brush === "bone") {
          // a firm, even line: the brush upright, the same weight all the way
          const from = i0;
          const pathOf = (off: (i: number) => number) => {
            const q = new Path2D();
            let pen = false;
            for (let i = from; i <= i1; i++) {
              if (cut(i)) break;
              const [px, py] = point(i, off(i));
              if (pen) q.lineTo(px, py);
              else q.moveTo(px, py);
              pen = true;
            }
            return q;
          };
          const wNow = Math.max(0.8, o.width * 0.8 * (0.94 + 0.12 * noise(far[i1] / 20, seed)));
          g.lineCap = "butt";
          g.lineJoin = "round";
          g.strokeStyle = col;
          g.globalAlpha = alpha * (0.6 + 0.4 * pts[i1].a);
          g.lineWidth = wNow;
          g.stroke(pathOf(() => 0));
          // the dense heart of the line
          g.strokeStyle = dark;
          g.globalAlpha = alpha * 0.22;
          g.lineWidth = wNow * 0.4;
          g.stroke(pathOf(() => 0));
        } else if (brush === "ribbon") {
          // the band between the two edges of the brush, filled a piece at a time, with the grain of the bristles along it
          g.fillStyle = col;
          for (let i = i0; i < i1; i++) {
            if (cut(i + 1)) break;
            const wa = o.width * 0.5 * pts[i].w;
            const wb = o.width * 0.5 * pts[i + 1].w;
            const [ax, ay] = point(i, -wa);
            const [bx, by] = point(i + 1, -wb);
            const [cx, cy] = point(i + 1, wb);
            const [dx, dy] = point(i, wa);
            g.globalAlpha = alpha * 0.82 * (0.4 + 0.6 * pts[i + 1].a);
            g.beginPath();
            g.moveTo(ax, ay);
            g.lineTo(bx, by);
            g.lineTo(cx, cy);
            g.lineTo(dx, dy);
            g.closePath();
            g.fill();
          }
          g.lineCap = "butt";
          for (let s = 0; s < 3; s++) {
            const off = (s - 1) * 0.3 + (noise(s * 7.1, seed) - 0.5) * 0.2;
            g.globalAlpha = 0.16;
            g.strokeStyle = s === 1 ? "#fff" : dark;
            g.lineWidth = 0.9;
            g.beginPath();
            for (let i = i0; i <= i1; i++) {
              if (cut(i)) break;
              const [px, py] = point(i, off * o.width * pts[i].w);
              if (i === i0) g.moveTo(px, py);
              else g.lineTo(px, py);
            }
            g.stroke();
          }
        } else if (brush === "wash") {
          // thin wet paint: bands of it one inside the other, so it is densest along the middle and feathers away to the sides
          const from = i0;
          const line = new Path2D();
          let last = from;
          line.moveTo(pts[from].x, pts[from].y);
          for (let i = from + 1; i <= i1; i++) {
            if (cut(i)) break;
            line.lineTo(pts[i].x, pts[i].y);
            last = i;
          }
          if (last > from) {
            const wNow = o.width * 0.5 * (pts[from].w + pts[last].w);
            const aNow = 0.5 * (pts[from].a + pts[last].a);
            const bands = 6;
            g.lineCap = "butt";
            g.globalCompositeOperation = o.mode ?? "source-over";
            for (let k = 0; k < bands; k++) {
              const t = k / (bands - 1);
              g.globalAlpha = alpha * 0.3 * (0.3 + 0.7 * aNow) * (1.3 - 0.6 * t);
              g.strokeStyle = css(shade(o.color, (noise(k * 3.3 + far[last] / 60, seed) - 0.5) * 0.07));
              g.lineWidth = Math.max(0.8, wNow * (0.36 + 0.78 * t) * (0.9 + 0.2 * noise(far[last] / 13 + k * 5, seed + 2)));
              g.stroke(line);
            }
            g.globalCompositeOperation = "source-over";
            if (wNow > 2.4) {
              // the paint runs to the lower edge and gathers there; and where both edges dried, a darker line is left, here and there
              g.strokeStyle = dark;
              g.globalAlpha = alpha * 0.1 * aNow;
              g.lineWidth = wNow * 0.3;
              g.translate(0, wNow * 0.3);
              g.stroke(line);
              g.translate(0, -wNow * 0.3);
              g.lineCap = "round";
              for (const side of [-1, 1]) {
                const edge = new Path2D();
                let pen = false;
                let any = false;
                for (let i = from; i <= last; i++) {
                  if (noise(far[i] / 15 + side * 31, seed + 4) < 0.36) {
                    pen = false;
                    continue;
                  }
                  const [ex, ey] = point(i, side * 0.5 * o.width * pts[i].w * (0.9 + 0.14 * noise(far[i] / 9 + side * 3, seed + 6)));
                  if (pen) edge.lineTo(ex, ey);
                  else edge.moveTo(ex, ey);
                  any = any || pen;
                  pen = true;
                }
                if (!any) continue;
                g.globalAlpha = alpha * (side > 0 ? 0.34 : 0.22) * (0.25 + 0.75 * aNow);
                g.lineWidth = Math.min(1.5, 0.6 + wNow * 0.05);
                g.stroke(edge);
              }
            }
          }
        } else if (brush === "knife") {
          // a slab of thick paint: solid, with edges that break where the blade lifted
          for (let i = i0; i < i1; i++) {
            if (cut(i + 1)) break;
            const p = pts[i + 1];
            // the blade skips where the paint ran thin
            if (noise(far[i] / 9, seed + 3) < (1 - p.a) * 0.75 - 0.2) continue;
            const ea = 0.5 * o.width * pts[i].w * (0.78 + 0.44 * noise(far[i] / 9, seed));
            const eb = 0.5 * o.width * p.w * (0.78 + 0.44 * noise(far[i + 1] / 9, seed));
            const fa = 0.5 * o.width * pts[i].w * (0.78 + 0.44 * noise(far[i] / 7, seed + 9));
            const fb = 0.5 * o.width * p.w * (0.78 + 0.44 * noise(far[i + 1] / 7, seed + 9));
            const [ax, ay] = point(i, -ea);
            const [bx, by] = point(i + 1, -eb);
            const [cx, cy] = point(i + 1, fb);
            const [dx, dy] = point(i, fa);
            g.globalAlpha = alpha * (0.72 + 0.28 * p.a);
            g.fillStyle = col;
            g.beginPath();
            g.moveTo(ax, ay);
            g.lineTo(bx, by);
            g.lineTo(cx, cy);
            g.lineTo(dx, dy);
            g.closePath();
            g.fill();
            if (o.width > 3) {
              // the ridge the blade leaves along its upper edge, lit from above, and the shadow under the slab
              g.lineCap = "butt";
              g.lineWidth = 1;
              g.globalAlpha = 0.3;
              g.strokeStyle = "#fff";
              g.beginPath();
              g.moveTo(ax, ay + 0.6);
              g.lineTo(bx, by + 0.6);
              g.stroke();
              g.globalAlpha = 0.2;
              g.strokeStyle = "#000";
              g.beginPath();
              g.moveTo(dx, dy + 0.7);
              g.lineTo(cx, cy + 0.7);
              g.stroke();
            }
          }
        } else if (brush === "nib") {
          // a broad pen held at a slant: the mark is as wide as the pen looks from the way it is going
          const tilt = -0.72;
          const px = Math.cos(tilt);
          const py = Math.sin(tilt);
          g.fillStyle = col;
          g.strokeStyle = col;
          g.lineCap = "round";
          for (let i = i0; i < i1; i++) {
            if (cut(i + 1)) break;
            const a0 = pts[i];
            const b0 = pts[i + 1];
            const ha = Math.max(0.3, 0.5 * o.width * a0.w);
            const hb = Math.max(0.3, 0.5 * o.width * b0.w);
            g.globalAlpha = alpha * (0.4 + 0.6 * b0.a);
            g.beginPath();
            g.moveTo(a0.x - px * ha, a0.y - py * ha);
            g.lineTo(b0.x - px * hb, b0.y - py * hb);
            g.lineTo(b0.x + px * hb, b0.y + py * hb);
            g.lineTo(a0.x + px * ha, a0.y + py * ha);
            g.closePath();
            g.fill();
            // the hairline the corner of the pen leaves when it travels along its own edge
            g.lineWidth = 0.7;
            g.beginPath();
            g.moveTo(a0.x, a0.y);
            g.lineTo(b0.x, b0.y);
            g.stroke();
          }
        } else if (brush === "scribble") {
          // one line, worked from side to side
          g.strokeStyle = col;
          g.lineCap = "round";
          g.lineWidth = Math.max(0.6, Math.min(1.6, o.width * 0.14));
          const pitch = Math.max(2.2, o.width * 0.55);
          g.beginPath();
          const side = (i: number) => {
            const k = far[i] / pitch;
            const tri = 2 * Math.abs(k - Math.floor(k + 0.5)) * 2 - 1;
            return tri * 0.5 * o.width * pts[i].w * (0.75 + 0.5 * noise(far[i] / 5, seed));
          };
          let pen = false;
          for (let i = i0; i <= i1; i++) {
            if (cut(i)) break;
            const [qx, qy] = point(i, side(i));
            if (pen) g.lineTo(qx, qy);
            else g.moveTo(qx, qy);
            pen = true;
          }
          g.globalAlpha = alpha * (0.35 + 0.6 * pts[i1].a);
          g.stroke();
        } else if (brush === "dashes") {
          // touched down and lifted, again and again
          g.strokeStyle = col;
          g.lineCap = "round";
          const on = Math.max(3, o.width * 2.4);
          const period = on + Math.max(2.5, o.width * 1.7);
          for (let i = i0; i < i1; i++) {
            if (cut(i + 1)) break;
            const where = (far[i] + noise(Math.floor(far[i] / period), seed) * period * 0.3) % period;
            if (where > on) continue;
            const p = pts[i + 1];
            g.globalAlpha = alpha * (0.35 + 0.65 * p.a);
            // each dash swells in its middle
            g.lineWidth = Math.max(0.6, o.width * p.w * (0.55 + 0.45 * Math.sin((Math.PI * where) / on)));
            g.beginPath();
            g.moveTo(pts[i].x, pts[i].y);
            g.lineTo(p.x, p.y);
            g.stroke();
          }
        } else if (brush === "chalk") {
          // a dry stick over a rough surface: colour only where the surface stands up to meet it
          g.fillStyle = col;
          for (let i = i0 + 1; i <= i1; i++) {
            if (cut(i)) break;
            const p = pts[i];
            const half = 0.5 * o.width * p.w;
            const k = Math.max(2, Math.round(half * 2.2));
            for (let j = 0; j < k; j++) {
              const off = (r() * 2 - 1) * half;
              const [qx, qy] = point(i, off);
              // the tooth of the surface: fixed in place, so strokes that cross catch on the same grain
              if (tooth(qx, qy) > 0.34 + 0.6 * p.a * (1 - 0.45 * Math.abs(off) / Math.max(1, half))) continue;
              g.globalAlpha = alpha * (0.45 + 0.5 * r());
              g.fillRect(qx - 1, qy - 1, 1.4 + r() * 1.3, 1.4 + r() * 1.3);
            }
          }
        } else {
          // marks put down one after another along the path
          const gapOf = brush === "wet" ? Math.max(1.4, o.width * 0.24) : brush === "dots" ? Math.max(3, o.width * 1.25) : brush === "hatch" ? Math.max(2.2, o.width * 0.32) : 2.4;
          for (let i = i0 + 1; i <= i1; i++) {
            if (far[i] - stamp < gapOf && i !== 1) continue;
            if (cut(i)) break;
            stamp = far[i];
            const p = pts[i];
            if (brush === "wet") {
              // see-through touches that overlap: dense in the middle, ragged and feathered at the sides
              const rad = Math.max(0.8, o.width * 0.5 * p.w * between(r, 0.85, 1.15));
              g.globalCompositeOperation = o.mode ?? "source-over";
              g.beginPath();
              smoothPath(g, blobPoints(p.x + gauss(r) * 0.4, p.y + gauss(r) * rad * 0.12, rad * 1.25, rad, Math.atan2(-nx[i], ny[i]), r, 0.2, 9));
              g.globalAlpha = alpha * 0.42 * (0.35 + 0.65 * p.a) * between(r, 0.7, 1.2);
              g.fillStyle = css(shade(o.color, (r() - 0.5) * 0.06));
              g.fill();
              g.globalCompositeOperation = "source-over";
              // pigment gathers at the edges of a wet stroke as it dries: both sides are drawn a little darker
              if (rad > 2.2) {
                g.fillStyle = dark;
                for (const s of [-1, 1]) {
                  if (r() < 0.3) continue;
                  const [ex, ey] = point(i, s * rad * between(r, 0.86, 1));
                  g.globalAlpha = alpha * 0.22 * p.a;
                  g.beginPath();
                  g.arc(ex, ey, between(r, 0.5, 1.1), 0, TAU);
                  g.fill();
                }
              }
            } else if (brush === "dots") {
              touch(g, "dot", { x: p.x, y: p.y + gauss(r) * 0.6, r: Math.max(0.8, o.width * 0.5 * p.w), color: o.color, rng: r, alpha: alpha * (0.3 + 0.7 * p.a) });
            } else if (brush === "hatch") {
              const len = o.width * 0.5 * p.w * between(r, 0.7, 1.2);
              const lean = 0.5 + gauss(r) * 0.12;
              g.globalAlpha = alpha * (0.3 + 0.6 * p.a) * between(r, 0.6, 1);
              g.strokeStyle = col;
              g.lineCap = "round";
              g.lineWidth = between(r, 0.6, 1.3);
              g.beginPath();
              g.moveTo(p.x - nx[i] * len - ny[i] * len * lean, p.y - ny[i] * len + nx[i] * len * lean);
              g.lineTo(p.x + nx[i] * len + ny[i] * len * lean, p.y + ny[i] * len - nx[i] * len * lean);
              g.stroke();
            } else {
              // spray: the finer for being further from the middle
              const k = Math.max(1, Math.round(o.width * 0.5 * p.a + 0.5));
              g.fillStyle = col;
              for (let j = 0; j < k; j++) {
                const off = gauss(r) * o.width * 0.32 * p.w;
                const [px, py] = point(i, off);
                g.globalAlpha = alpha * (0.3 + 0.6 * r()) * (0.4 + 0.6 * p.a);
                g.beginPath();
                g.arc(px + gauss(r) * 1.6, py, Math.max(0.35, (0.5 + r() * r() * 1.4) * (1 - Math.min(0.6, Math.abs(off) / o.width))), 0, TAU);
                g.fill();
              }
            }
          }
        }
        at = upto;
      }
      if (brush === "bone" && !knotted && spent > 0) {
        knotted = true;
        dab(g, { x: pts[0].x, y: pts[0].y, r: o.width * 0.55, color: o.color, rng: r, alpha, rough: 0.1 });
      }
      if (t >= 1 && !ended) {
        ended = true;
        const end = pts[n - 1];
        if (brush === "bone" && !(o.maxX !== undefined && end.x > o.maxX)) dab(g, { x: end.x, y: end.y, r: o.width * 0.5, color: o.color, rng: r, alpha: alpha * (0.6 + 0.4 * end.a), rough: 0.1 });
        // where a wet stroke stops, the last of the paint collects in a bead
        if (brush === "wet" && end.a > 0.25 && o.width > 3 && !(o.maxX !== undefined && end.x > o.maxX)) dab(g, { x: end.x, y: end.y, r: o.width * 0.3 * end.w, color: shade(o.color, -0.08), rng: r, alpha: alpha * 0.4, rough: 0.2 });
      }
      return t >= 1;
    },
  };
}

/** A straight (or gently bowed) path for a brush: where it sets off, which way, how far. It presses down at the start and lifts at the end. */
export function straight(x: number, y: number, length: number, angle: number, r: Rng, curve = 0, paint: (t: number) => number = () => 1): Pt[] {
  const n = Math.max(2, Math.ceil(length / 2.5) + 1);
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const side = curve * Math.sin(Math.PI * t);
    pts.push({
      x: x + cs * length * t - sn * side,
      y: y + sn * length * t + cs * side,
      // the brush swells as it presses down and narrows as it lifts
      w: Math.min(1, Math.sqrt(t / 0.06 + 0.04)) * (t > 0.8 ? 1 - 0.6 * ((t - 0.8) / 0.2) ** 2 : 1),
      a: Math.max(0, Math.min(1, paint(t))),
    });
  }
  // (r is taken so that every path, even a straight one, has its own chance; a hand never draws quite the same line twice)
  void r;
  return pts;
}

export interface StrokeOpts {
  x: number;
  y: number;
  /** how far the brush travels, in pixels, and which way (radians; 0 = to the right) */
  length: number;
  angle: number;
  /** how wide the brush is */
  width: number;
  /** how long the stroke takes */
  ms: number;
  color: RGB;
  r: Rng;
  /** how far the stroke bows to one side */
  curve?: number;
  /** 0 = a wet, full brush all the way; 1 = it runs dry almost at once and leaves streaks */
  dry?: number;
  alpha?: number;
  /** the blob left where a loaded brush first touches down */
  load?: boolean;
  /** on a dark ground: the paint glows */
  glow?: boolean;
  /** the brush stops at this x (the edge of the canvas) */
  maxX?: number;
  brush?: Brush;
}
/** One straight stroke of a bristle brush (or another brush), drawn at a steady speed. */
export function stroke(g: G, o: StrokeOpts): Mark {
  const m = paintPath(g, straight(o.x, o.y, o.length, o.angle, o.r, o.curve ?? 0), { brush: o.brush ?? "bristle", width: o.width, color: o.color, r: o.r, ms: o.ms, alpha: o.alpha, dry: o.dry ?? 0.5, glow: o.glow, maxX: o.maxX, hand: false });
  let first = true;
  return {
    step(dt) {
      if (first) {
        first = false;
        if (o.load) dab(g, { x: o.x, y: o.y, r: o.width * 0.56, color: o.color, rng: o.r, squash: 1.15, rot: o.angle, thick: true, alpha: 0.9 });
      }
      return m.step(dt);
    },
  };
}

// ── paint that is thrown ──

export interface SplatOpts {
  x: number;
  y: number;
  /** the size of the main blot */
  r: number;
  color: RGB;
  rng: Rng;
  /** how many drops fly off, and how far (in blot sizes) */
  drops: number;
  spread: number;
  /** the way it was thrown (radians); leave out for all round */
  dir?: number;
  ms?: number;
}
/**
 * Paint thrown at the canvas: a blot where it lands and drops flying off it, smaller and longer
 * the further they go, some still joined to the blot by a thread of paint.
 */
export function splatter(g: G, o: SplatOpts): Mark {
  const r = o.rng;
  const drops = Array.from({ length: o.drops }, () => {
    const dist = o.r * (1.05 + Math.abs(gauss(r)) * o.spread);
    const ang = o.dir === undefined ? r() * TAU : o.dir + gauss(r) * 0.55;
    const size = Math.max(0.45, o.r * 0.34 * Math.exp(-dist / (o.r * 3.2)) * (0.35 + r()));
    return { dist, ang, size, long: 1 + Math.min(2.4, dist / (o.r * 2.4)) * r(), leg: r() < 0.16 && dist < o.r * 3 };
  }).sort((a, b) => a.dist - b.dist);
  const ms = o.ms ?? 70;
  const col = css(o.color);
  let k = -1;
  let spent = 0;
  return {
    step(dt) {
      g.globalCompositeOperation = "source-over";
      if (k < 0) {
        k = 0;
        dab(g, { x: o.x, y: o.y, r: o.r, color: o.color, rng: r, rough: 0.3, thick: true, squash: between(r, 0.85, 1.2), rot: r() * TAU });
        if (r() < 0.6) dab(g, { x: o.x + gauss(r) * o.r * 0.6, y: o.y + gauss(r) * o.r * 0.6, r: o.r * between(r, 0.4, 0.7), color: shade(o.color, (r() - 0.5) * 0.08), rng: r, rough: 0.3, thick: true });
      }
      spent += dt;
      const upto = Math.min(drops.length, Math.ceil((spent / ms) * drops.length));
      g.fillStyle = col;
      g.strokeStyle = col;
      for (; k < upto; k++) {
        const d = drops[k];
        const cx = o.x + Math.cos(d.ang) * d.dist;
        const cy = o.y + Math.sin(d.ang) * d.dist;
        if (d.leg) {
          g.globalAlpha = 0.55;
          g.lineWidth = Math.max(0.5, d.size * 0.45);
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(o.x + Math.cos(d.ang) * o.r * 0.7, o.y + Math.sin(d.ang) * o.r * 0.7);
          g.lineTo(cx, cy);
          g.stroke();
        }
        g.globalAlpha = 0.9;
        g.beginPath();
        g.ellipse(cx, cy, d.size * d.long, d.size, d.ang, 0, TAU);
        g.fill();
      }
      return k >= drops.length;
    },
  };
}

/** A sprinkle of fine dots, as from a flicked or shaken brush. */
export function speckle(g: G, o: { x: number; y: number; n: number; sx: number; sy: number; color: RGB; rng: Rng; size: number; alpha?: number }) {
  g.globalCompositeOperation = "source-over";
  g.fillStyle = css(o.color);
  const a = o.alpha ?? 1;
  for (let i = 0; i < o.n; i++) {
    g.globalAlpha = (0.45 + 0.5 * o.rng()) * a;
    g.beginPath();
    g.arc(o.x + gauss(o.rng) * o.sx, o.y + gauss(o.rng) * o.sy, Math.max(0.35, o.size * (0.3 + o.rng() * o.rng() * 1.6)), 0, TAU);
    g.fill();
  }
}

/** The ways fine paint can be thrown at one spot. */
export const CLOUDS = ["mist", "grit", "flick", "fanTap", "stipple", "rain", "shards", "tap", "scumble"] as const;
export type Cloud = (typeof CLOUDS)[number];

export interface CloudOpts {
  x: number;
  y: number;
  /** half its width and half its height: a sound that covers a wide stretch of frequencies is a tall cloud, one that lasts is a long one */
  rx: number;
  ry: number;
  /** how much of it there is */
  n: number;
  color: RGB;
  rng: Rng;
  /** the size of its grains */
  size: number;
  alpha?: number;
}
/**
 * Fine paint thrown at one place: what a noise looks like. Seven ways of throwing it.
 * - mist: the finest spray, densest in the middle
 * - grit: fewer, coarser grains of uneven size
 * - flick: drops in a curved line, as from a brush flicked sideways
 * - fanTap: a few short hairlines side by side, the tap of a fan brush
 * - stipple: firm, even dots placed apart, as with the point of a brush
 * - rain: short thin streaks all leaning the same way
 * - shards: little angular chips, as from a palette knife
 * - tap: a loaded brush tapped on a finger: fewer, rounder, bigger drops, thrown one way
 * - scumble: a nearly dry brush scrubbed round on the spot: broken little arcs
 */
export function cloud(g: G, kind: Cloud, o: CloudOpts) {
  const r = o.rng;
  const a = o.alpha ?? 1;
  const col = css(o.color);
  g.globalCompositeOperation = "source-over";
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineCap = "round";
  const n = Math.max(1, Math.round(o.n));
  switch (kind) {
    case "mist":
      for (let i = 0; i < n; i++) {
        g.globalAlpha = a * (0.3 + 0.5 * r());
        g.beginPath();
        g.arc(o.x + gauss(r) * o.rx * 0.5, o.y + gauss(r) * o.ry * 0.5, Math.max(0.3, o.size * (0.25 + r() * r())), 0, TAU);
        g.fill();
      }
      break;
    case "grit":
      for (let i = 0; i < Math.ceil(n * 0.45); i++) {
        const big = r() < 0.18;
        g.globalAlpha = a * (0.5 + 0.45 * r());
        g.beginPath();
        g.ellipse(o.x + gauss(r) * o.rx * 0.55, o.y + gauss(r) * o.ry * 0.55, Math.max(0.4, o.size * (big ? 1.6 + r() : 0.4 + r() * 0.7)), Math.max(0.4, o.size * (big ? 1.1 + r() * 0.6 : 0.4 + r() * 0.6)), r() * TAU, 0, TAU);
        g.fill();
      }
      break;
    case "flick": {
      const bend = between(r, 0.3, 0.9) * (r() < 0.5 ? 1 : -1);
      const tilt = gauss(r) * 0.3;
      for (let i = 0; i < Math.ceil(n * 0.5); i++) {
        const t = r();
        const along = (t - 0.5) * 2;
        const px = o.x + along * o.rx * Math.cos(tilt) + bend * (1 - along * along) * o.ry * 0.5 * Math.sin(tilt);
        const py = o.y + along * o.rx * Math.sin(tilt) - bend * (1 - along * along) * o.ry * 0.7 + gauss(r) * o.ry * 0.12;
        g.globalAlpha = a * (0.5 + 0.45 * r());
        g.beginPath();
        // the drops get smaller along the throw
        g.ellipse(px, py, Math.max(0.4, o.size * (1.5 - t) * (0.5 + r() * 0.8)), Math.max(0.35, o.size * (1.2 - t * 0.7) * 0.6), tilt, 0, TAU);
        g.fill();
      }
      break;
    }
    case "fanTap": {
      const k = Math.max(3, Math.min(9, Math.round(n / 5)));
      const lean = -0.9 + gauss(r) * 0.25;
      for (let i = 0; i < k; i++) {
        const off = (i / (k - 1) - 0.5) * 2 * o.rx;
        const len = o.ry * between(r, 0.7, 1.25);
        g.globalAlpha = a * (0.45 + 0.45 * r());
        g.lineWidth = Math.max(0.6, o.size * between(r, 0.45, 0.9));
        g.beginPath();
        g.moveTo(o.x + off - Math.cos(lean) * len * 0.5, o.y - Math.sin(lean) * len * 0.5 + gauss(r) * o.ry * 0.15);
        g.lineTo(o.x + off + Math.cos(lean) * len * 0.5, o.y + Math.sin(lean) * len * 0.5);
        g.stroke();
      }
      break;
    }
    case "stipple": {
      const k = Math.max(2, Math.round(n * 0.3));
      for (let i = 0; i < k; i++) {
        // placed apart rather than piled up: evenly round a centre, with a little wander
        const t = (i / k) * TAU + gauss(r) * 0.3;
        const d = Math.sqrt((i + 0.5) / k);
        g.globalAlpha = a * (0.7 + 0.25 * r());
        g.beginPath();
        g.arc(o.x + Math.cos(t * 2.4) * d * o.rx * 0.8, o.y + Math.sin(t * 2.4) * d * o.ry * 0.8, Math.max(0.5, o.size * between(r, 0.7, 1.15)), 0, TAU);
        g.fill();
      }
      break;
    }
    case "rain": {
      const lean = 1.2 + gauss(r) * 0.12;
      for (let i = 0; i < Math.ceil(n * 0.4); i++) {
        const px = o.x + gauss(r) * o.rx * 0.55;
        const py = o.y + gauss(r) * o.ry * 0.5;
        const len = o.size * between(r, 2.2, 5);
        g.globalAlpha = a * (0.35 + 0.5 * r());
        g.lineWidth = Math.max(0.5, o.size * between(r, 0.3, 0.6));
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + Math.cos(lean) * len, py + Math.sin(lean) * len);
        g.stroke();
      }
      break;
    }
    case "tap": {
      const way = -0.6 + gauss(r) * 0.5;
      for (let i = 0; i < Math.max(3, Math.ceil(n * 0.16)); i++) {
        // near the brush the drops are big, far off they are small
        const d = Math.abs(gauss(r)) * 0.6;
        const ang = way + gauss(r) * 0.5;
        const px = o.x + Math.cos(ang) * d * o.rx * 1.3 + gauss(r) * o.rx * 0.2;
        const py = o.y + Math.sin(ang) * d * o.ry * 1.3 + gauss(r) * o.ry * 0.2;
        const rad = Math.max(0.5, o.size * 2.4 * Math.exp(-d * 1.3) * between(r, 0.6, 1.4));
        g.globalAlpha = a * (0.6 + 0.35 * r());
        g.beginPath();
        smoothPath(g, blobPoints(px, py, rad, rad * between(r, 0.8, 1), r() * TAU, r, 0.08, 7));
        g.fill();
        if (rad > o.size * 1.7) {
          // a big drop dries with a darker rim
          g.globalAlpha = a * 0.3;
          g.lineWidth = Math.max(0.5, rad * 0.16);
          g.strokeStyle = css(shade(o.color, -0.14));
          g.stroke();
          g.strokeStyle = col;
        }
      }
      break;
    }
    case "scumble": {
      for (let i = 0; i < Math.max(4, Math.ceil(n * 0.3)); i++) {
        const px = o.x + gauss(r) * o.rx * 0.45;
        const py = o.y + gauss(r) * o.ry * 0.45;
        if (tooth(px, py) > 0.78) continue;
        const rad = o.size * between(r, 2.4, 6);
        const from = r() * TAU;
        g.globalAlpha = a * (0.3 + 0.45 * r());
        g.lineWidth = Math.max(0.6, o.size * between(r, 0.5, 1.1));
        g.beginPath();
        g.arc(px, py, rad, from, from + between(r, 0.7, 2.4));
        g.stroke();
      }
      break;
    }
    case "shards":
      for (let i = 0; i < Math.ceil(n * 0.3); i++) {
        const px = o.x + gauss(r) * o.rx * 0.55;
        const py = o.y + gauss(r) * o.ry * 0.55;
        const s = o.size * between(r, 1.2, 2.8);
        const t = r() * TAU;
        g.globalAlpha = a * (0.5 + 0.4 * r());
        g.beginPath();
        g.moveTo(px + Math.cos(t) * s, py + Math.sin(t) * s);
        g.lineTo(px + Math.cos(t + 2.2 + r() * 0.6) * s * 0.7, py + Math.sin(t + 2.2 + r() * 0.6) * s * 0.7);
        g.lineTo(px + Math.cos(t + 4 + r() * 0.6) * s * 0.5, py + Math.sin(t + 4 + r() * 0.6) * s * 0.5);
        g.closePath();
        g.fill();
      }
      break;
  }
}

/** A thin hand-drawn ring. */
export function ring(g: G, o: { x: number; y: number; r: number; w: number; color: RGB; rng: Rng; alpha?: number }) {
  g.globalCompositeOperation = "source-over";
  g.beginPath();
  smoothPath(g, blobPoints(o.x, o.y, o.r, o.r, 0, o.rng, 0.07, 10));
  g.globalAlpha = o.alpha ?? 0.85;
  g.strokeStyle = css(o.color);
  g.lineWidth = o.w;
  g.stroke();
}

/** Paint that was put on too thick, running down: fast at first, slowing to a bead. */
export function drip(g: G, o: { x: number; y: number; w: number; length: number; color: RGB; rng: Rng }): Mark {
  const life = between(o.rng, 900, 1900);
  const col = css(o.color);
  let v = o.length / life;
  let x = o.x;
  let y = o.y;
  let age = 0;
  const seed = Math.floor(o.rng() * 9973);
  return {
    step(dt) {
      age += dt;
      const dy = v * dt;
      v *= Math.exp(-dt / life);
      const nx = o.x + (noise(y / 22, seed) - 0.5) * o.w * 1.6;
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 0.86;
      g.strokeStyle = col;
      g.lineCap = "round";
      g.lineWidth = o.w * (0.75 + 0.3 * noise(y / 9, seed + 1));
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(nx, y + dy);
      g.stroke();
      x = nx;
      y += dy;
      if (age < life * 3.2) return false;
      // the bead where it stopped
      dab(g, { x, y: y + o.w * 0.3, r: o.w * 0.95, color: o.color, rng: o.rng, rough: 0.08, squash: 0.9, thick: true });
      return true;
    },
  };
}

/** Several marks, one after another, a moment apart (a clap is three hands, not one). */
export function flam(n: number, gapMs: number, make: (i: number) => void): Mark {
  let i = 0;
  let spent = gapMs;
  return {
    step(dt) {
      spent += dt;
      while (i < n && spent >= gapMs) {
        spent -= gapMs;
        make(i++);
      }
      return i >= n;
    },
  };
}

/** Wait, then make a mark (a hand does not put everything down at the same instant). */
export function later(ms: number, make: () => Mark | void): Mark {
  let left = ms;
  let m: Mark | void;
  let made = false;
  return {
    step(dt) {
      if (!made) {
        left -= dt;
        if (left > 0) return false;
        made = true;
        m = make();
        return !m;
      }
      return m ? m.step(dt) : true;
    },
  };
}
