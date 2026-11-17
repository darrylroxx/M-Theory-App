/**
 * The marks paint makes: a loaded brush dragged along, a wash soaking in, a blob, a splatter,
 * a drip, a thin line of ink, a sprinkle.
 *
 * Every mark is drawn a little at a time, as it would be made, and what is drawn stays drawn:
 * nothing is redrawn from scratch, so a painting costs the same however much is on it.
 */
import { css, shade, vary, type RGB } from "./color";
import { between, gauss, noise, type Rng } from "./rand";

export type G = CanvasRenderingContext2D;
/** A mark being made. `step` draws the next bit (dt in milliseconds) and says whether it is finished. */
export interface Mark {
  step(dt: number): boolean;
}

const TAU = Math.PI * 2;
const rgbHex = (c: RGB) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

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
  let base = blobPoints(o.x, o.y, o.rx, o.ry, o.rot ?? 0, o.r, 0.14, 9);
  for (let k = 0; k < 3; k++) base = deform(base, o.r, 0.4);
  let done = 0;
  let owed = 1;
  return {
    step(dt) {
      owed += (dt * o.layers) / o.ms;
      const n = Math.min(o.layers - done, Math.floor(owed));
      owed -= n;
      g.globalCompositeOperation = o.mode;
      for (let k = 0; k < n; k++) {
        const p = deform(deform(base, o.r, 0.28), o.r, 0.28);
        g.beginPath();
        g.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
        g.closePath();
        g.globalAlpha = o.alpha * (0.6 + 0.8 * o.r());
        g.fillStyle = css(shade(o.color, (o.r() - 0.5) * 0.06));
        g.fill();
      }
      done += n;
      return done >= o.layers;
    },
  };
}

export interface DabOpts {
  x: number;
  y: number;
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
    const gr = g.createRadialGradient(o.x - o.r * 0.38, o.y - o.r * 0.38, o.r * 0.05, o.x, o.y, o.r * 1.15);
    gr.addColorStop(0, "rgba(255,255,255,0.3)");
    gr.addColorStop(0.45, "rgba(255,255,255,0)");
    gr.addColorStop(0.75, "rgba(0,0,0,0)");
    gr.addColorStop(1, "rgba(0,0,0,0.22)");
    g.globalAlpha = 1;
    g.fillStyle = gr;
    g.fill();
  }
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
}
/**
 * A brush stroke, bristle by bristle. Each bristle carries its own shade of the colour and its
 * own amount of paint, and wanders a little; as the stroke goes on, bristles run dry and begin
 * to skip, so the stroke ends in streaks. A few bristles leave a ridge that catches the light.
 */
export function stroke(g: G, o: StrokeOpts): Mark {
  const r = o.r;
  const n = Math.max(2, Math.min(24, Math.round(o.width / 1.6)));
  const cs = Math.cos(o.angle);
  const sn = Math.sin(o.angle);
  const dry = o.dry ?? 0.5;
  const seed = Math.floor(r() * 9973);
  const bristles = Array.from({ length: n }, (_, i) => {
    const across = n === 1 ? 0 : i / (n - 1) - 0.5;
    const edge = Math.abs(across) * 2;
    return {
      off: across * o.width * (0.9 + 0.2 * r()),
      phase: r() * 1000,
      color: css(shade(o.color, (r() - 0.5) * 0.13)),
      alpha: (o.alpha ?? 0.92) * (0.5 + 0.5 * r()) * (1 - 0.3 * edge * r()),
      lw: Math.max(0.7, (o.width / n) * (0.8 + 1.1 * r())),
      // the bristles at the edge of the brush run dry first
      dry: Math.max(0.04, 1.3 - dry * (0.55 + 0.9 * r()) - edge * dry * 0.3),
      // (thin, see-through paint has no ridges)
      ridge: (o.alpha ?? 0.92) > 0.5 && r() < 0.28,
    };
  });
  const curve = o.curve ?? 0;
  const glow = o.glow ? css(shade(o.color, 0.08)) : "";
  let t = 0;
  let first = true;
  return {
    step(dt) {
      const t1 = Math.min(1, t + dt / Math.max(1, o.ms));
      const steps = Math.max(1, Math.ceil(((t1 - t) * o.length) / 3));
      g.globalCompositeOperation = "source-over";
      g.lineCap = "butt";
      g.lineJoin = "round";
      if (first && o.load) {
        first = false;
        dab(g, { x: o.x, y: o.y, r: o.width * 0.56, color: o.color, rng: r, squash: 1.15, rot: o.angle, thick: true, alpha: 0.9 });
      }
      first = false;
      const point = (tt: number, off: number): [number, number] => {
        const d = o.length * tt;
        const side = off + curve * Math.sin(Math.PI * tt);
        return [o.x + cs * d - sn * side, o.y + sn * d + cs * side];
      };
      if (glow) {
        // a soft light around the stroke
        const [ax, ay] = point(t, 0);
        const [bx, by] = point(t1, 0);
        // (the paint's own colour, thinly: it can pile up to the colour itself but never bleach to white)
        // (square ends, so one bit of glow never lands on the bristles of the bit before)
        g.strokeStyle = glow;
        g.lineCap = "butt";
        // it is laid in bands, widest and faintest first, so it fades away to the sides; and it dies down as the stroke runs dry
        const fade = Math.min(1, t1 / 0.04) * (1 - 0.9 * Math.pow(t1, 1.4));
        for (const wide of [4.2, 3.3, 2.5, 1.9, 1.4]) {
          g.globalAlpha = 0.034 * fade;
          g.lineWidth = o.width * wide;
          g.beginPath();
          g.moveTo(ax, ay);
          g.lineTo(bx, by);
          g.stroke();
        }
        g.lineCap = "butt";
      }
      if (o.width > 6 && !o.glow && (o.alpha ?? 0.92) > 0.5) {
        // thick paint stands off the canvas: a thin shadow along its lower edge
        const [ax, ay] = point(t, o.width * 0.5);
        const [bx, by] = point(t1, o.width * 0.5);
        g.globalAlpha = 0.1;
        g.strokeStyle = "#000";
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(ax + 0.8, ay + 1);
        g.lineTo(bx + 0.8, by + 1);
        g.stroke();
      }
      for (const b of bristles) {
        const path = new Path2D();
        let pen = false;
        let any = false;
        for (let s = 0; s <= steps; s++) {
          const tt = t + ((t1 - t) * s) / steps;
          const d = tt * o.length;
          // the brush swells as it presses down and narrows as it lifts
          const swell = Math.min(1, Math.sqrt(tt / 0.06 + 0.04)) * (tt > 0.8 ? 1 - 0.6 * ((tt - 0.8) / 0.2) ** 2 : 1);
          if (tt > b.dry && noise(d / 5 + b.phase * 3, seed) < Math.min(0.94, (tt - b.dry) / Math.max(0.05, 1.04 - b.dry) + 0.12)) {
            pen = false;
            continue;
          }
          const wob = (noise(d / 16 + b.phase, seed + 1) - 0.5) * 2.4;
          const [px, py] = point(tt, b.off * swell + wob);
          if (o.maxX !== undefined && px > o.maxX) {
            pen = false;
            continue;
          }
          if (pen) path.lineTo(px, py);
          else path.moveTo(px, py);
          pen = true;
          any = any || s > 0;
        }
        if (!any) continue;
        g.globalAlpha = b.alpha;
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
      t = t1;
      return t >= 1;
    },
  };
}

export interface LineOpts {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** how thick the line is where it sets off, and where it arrives (the pen presses down on the note) */
  w0: number;
  w1: number;
  ms: number;
  color: RGB;
  r: Rng;
  glow?: boolean;
}
/**
 * A line of ink from one note to the next. It leaves level, arrives level, and swings up or down
 * in between, so a melody draws its own shape. The line thickens as it reaches the note.
 */
export function inkLine(g: G, o: LineOpts): Mark {
  const dx = o.x1 - o.x0;
  const c1 = o.x0 + dx * 0.45;
  const c2 = o.x1 - dx * 0.45;
  const at = (t: number): [number, number] => {
    const u = 1 - t;
    return [u * u * u * o.x0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * o.x1, u * u * u * o.y0 + 3 * u * u * t * o.y0 + 3 * u * t * t * o.y1 + t * t * t * o.y1];
  };
  const segs = Math.max(4, Math.ceil((Math.abs(dx) + Math.abs(o.y1 - o.y0)) / 2.5));
  const seed = Math.floor(o.r() * 9973);
  const col = css(o.color);
  let k = 0;
  let spent = 0;
  return {
    step(dt) {
      spent += dt;
      const upto = Math.min(segs, Math.ceil((spent / Math.max(1, o.ms)) * segs));
      g.lineCap = "round";
      g.strokeStyle = col;
      for (; k < upto; k++) {
        const [ax, ay] = at(k / segs);
        const [bx, by] = at((k + 1) / segs);
        const w = (o.w0 + (o.w1 - o.w0) * Math.pow((k + 1) / segs, 2.4)) * (0.82 + 0.36 * noise(k / 3, seed));
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(bx, by);
        // the wet edge of the line, then the line
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = o.glow ? 0.09 : 0.06;
        g.lineWidth = w * (o.glow ? 4.2 : 2.8);
        g.stroke();
        g.globalAlpha = 0.9;
        g.lineWidth = w;
        g.stroke();
      }
      return k >= segs;
    },
  };
}

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
export function speckle(g: G, o: { x: number; y: number; n: number; sx: number; sy: number; color: RGB; rng: Rng; size: number }) {
  g.globalCompositeOperation = "source-over";
  g.fillStyle = css(o.color);
  for (let i = 0; i < o.n; i++) {
    g.globalAlpha = 0.45 + 0.5 * o.rng();
    g.beginPath();
    g.arc(o.x + gauss(o.rng) * o.sx, o.y + gauss(o.rng) * o.sy, Math.max(0.35, o.size * (0.3 + o.rng() * o.rng() * 1.6)), 0, TAU);
    g.fill();
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

export { rgbHex, vary };
