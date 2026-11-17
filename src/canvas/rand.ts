/** Chance, but repeatable: the same seed paints the same picture. */

export type Rng = () => number;

/** A small, fast random number generator (mulberry32). */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number from a bell curve around 0 (most are small, a few are large): what makes paint look thrown rather than placed. */
export function gauss(r: Rng): number {
  let u = 0;
  while (u < 1e-9) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export const between = (r: Rng, a: number, b: number) => a + (b - a) * r();

/** A fixed pseudo-random value in 0..1 for a whole number. */
export function hash(n: number): number {
  let x = Math.imul(n | 0, 0x45d9f3b) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Smooth wandering between random values: 0..1, the same for the same `x`. */
export function noise(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i + seed * 7919) * (1 - u) + hash(i + 1 + seed * 7919) * u;
}

/** The same in two directions (for paper grain). */
export function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => hash(a * 374761 + b * 668265 + seed * 7919);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
