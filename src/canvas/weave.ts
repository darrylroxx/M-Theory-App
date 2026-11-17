/**
 * The surface under the paint: woven canvas, linen, or rough paper.
 *
 * It is worked out as a height (the threads going over and under each other), then lit from the
 * top left, and comes back as greys around a middle grey: lighter where a thread catches the
 * light, darker in the gaps. Laid over the paint, that makes the paint look as if it sits on cloth.
 */
import { hash, noise, noise2 } from "./rand";

export type Surface = "canvas" | "linen" | "paper";
export const SURFACES: { id: Surface; label: string }[] = [
  { id: "canvas", label: "Canvas" },
  { id: "linen", label: "Linen" },
  { id: "paper", label: "Paper" },
];
export const isSurface = (s: unknown): s is Surface => s === "canvas" || s === "linen" || s === "paper";

/** How high the surface stands at a point, 0..1. `p` is the width of one thread in pixels. */
export function surfaceHeight(kind: Surface, x: number, y: number, p: number, seed = 1): number {
  if (kind === "paper") {
    // cold-pressed paper: soft bumps of several sizes, no threads
    return 0.5 * noise2(x / (p * 0.9), y / (p * 0.9), seed) + 0.32 * noise2(x / (p * 2.4), y / (p * 2.4), seed + 3) + 0.18 * noise2(x / (p * 0.4), y / (p * 0.4), seed + 5);
  }
  const linen = kind === "linen";
  // linen threads are uneven: some thick, some thin, with slubs along them
  const wob = linen ? 0.5 : 0.16;
  const u = x / p + wob * (noise(y / (p * 9), seed + 11) - 0.5);
  const v = y / p + wob * (noise(x / (p * 9), seed + 13) - 0.5);
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  // each thread is round across and has its own thickness
  const fat = linen ? 0.55 : 0.25;
  const warp = Math.sin(Math.PI * fu) * (1 - fat * hash(i * 31 + seed));
  const weft = Math.sin(Math.PI * fv) * (1 - fat * hash(j * 57 + seed + 1));
  // plain weave: over one, under one. The thread on top stands proud where it crosses.
  const over = (((i + j) % 2) + 2) % 2 === 0;
  const top = over ? warp * (0.62 + 0.38 * Math.sin(Math.PI * fv)) : weft * (0.62 + 0.38 * Math.sin(Math.PI * fu));
  const under = (over ? weft : warp) * 0.42;
  const slub = linen ? 0.22 * (noise(over ? v * 0.7 + i * 5.1 : u * 0.7 + j * 5.1, seed + 17) - 0.5) : 0;
  return Math.max(0, Math.min(1, Math.max(top, under) + slub));
}

/**
 * Some rows of the surface as a picture (rows `y0` up to, not including, `y1`), lit from the top
 * left: RGBA greys around middle grey (128), written into `out` (a whole picture's worth of
 * bytes). Done a few rows at a time, a big surface can be made without holding up the music.
 */
export function surfaceRows(kind: Surface, width: number, height: number, thread: number, depth: number, seed: number, y0: number, y1: number, out: Uint8ClampedArray) {
  const w = width;
  const a = Math.max(0, y0);
  const b = Math.min(height, y1);
  if (b <= a) return;
  // the heights of these rows and one either side (a slope needs its neighbours)
  const top = Math.max(0, a - 1);
  const bottom = Math.min(height - 1, b);
  const rows = bottom - top + 1;
  const hs = new Float32Array(w * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < w; x++) hs[y * w + x] = surfaceHeight(kind, x, y + top, thread, seed);
  const slope = (kind === "paper" ? 230 : 150) * depth;
  const body = (kind === "paper" ? 22 : 26) * depth;
  for (let y = a; y < b; y++) {
    const row = (y - top) * w;
    const up = (Math.max(top, y - 1) - top) * w;
    const down = (Math.min(bottom, y + 1) - top) * w;
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const l = hs[row + Math.max(0, x - 1)];
      const r = hs[row + Math.min(w - 1, x + 1)];
      // light from the top left: slopes facing it are lighter; the hollows between threads are darker
      const lit = (r - l + (hs[down + x] - hs[up + x])) * 0.5 * slope + (hs[row + x] - 0.55) * body;
      const grain = (hash(k + seed * 101) - 0.5) * 9 * depth;
      // cloth is never quite even: broad, faint patches of lighter and darker
      const patch = (noise2(x / (thread * 34), y / (thread * 34), seed + 23) - 0.5) * 9 * depth;
      out[k * 4] = out[k * 4 + 1] = out[k * 4 + 2] = 128 + lit + grain + patch;
      out[k * 4 + 3] = 255;
    }
  }
}

/** The whole surface as a picture. `thread` = width of one thread in pixels; `depth` = how strong the relief is. */
export function surfaceTexture(kind: Surface, width: number, height: number, thread: number, depth = 0.5, seed = 1): Uint8ClampedArray {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = new Uint8ClampedArray(w * h * 4);
  surfaceRows(kind, w, h, thread, depth, seed, 0, h, out);
  return out;
}
