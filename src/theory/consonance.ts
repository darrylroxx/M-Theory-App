/**
 * How rough or smooth notes sound together: the measure Harmonize writes by and is tested with.
 *
 * Each note is taken as a harmonic tone (11 partials, the k-th at 1/k), as the research on
 * consonance does. Two notes are rough where their partials sit close enough to beat (inside a
 * critical band) and smooth where they line up. That is why a third low down is muddier than the
 * same third an octave higher, and why a minor ninth rubs while a major ninth does not.
 *
 * The formulas are ported from the R packages dycon, hrep, har18 and incon
 * (MIT License, Copyright (c) 2018 Peter M. C. Harrison; see NOTICE.md):
 *  - Sethares (1993) dissonance between partials: additive over pairs of notes, so what one note
 *    adds to what already sounds is a sum of table lookups (`cross`, `added`): the engine's cost;
 *  - Hutchinson & Knopoff (1978) roughness of a whole set (`roughness`): the quality tests' measure;
 *  - Harrison & Pearce (2018) harmonicity (`harmonicity`), how much a set sounds like one tone,
 *    and the combined model of incon (2019) (`consonance`).
 * Nothing here reads the song: notes are MIDI numbers.
 */

/** A MIDI note's frequency (A4 = 440 Hz). */
export const hz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

const HARMONICS = 11;

/** A set of notes as partials: frequency → amplitude, coinciding partials summed incoherently. */
function spectrum(midis: readonly number[]): [number, number][] {
  const parts = new Map<number, number>();
  for (const m of midis) {
    const f0 = hz(m);
    for (let k = 1; k <= HARMONICS; k++) {
      const f = Math.round(f0 * k * 1000) / 1000;
      const a = 1 / k;
      const was = parts.get(f) ?? 0;
      parts.set(f, Math.sqrt(was * was + a * a));
    }
  }
  return [...parts.entries()].sort((x, y) => x[0] - y[0]);
}

/** Sethares (1993) dissonance of a set of partials (dycon's `roughness_seth`). */
function seth(sp: [number, number][]): number {
  let d = 0;
  for (let i = 0; i < sp.length; i++)
    for (let j = i + 1; j < sp.length; j++) {
      const [f1, a1] = sp[i];
      const [f2, a2] = sp[j];
      const s = 0.24 / (0.021 * Math.min(f1, f2) + 19);
      const x = Math.abs(f2 - f1);
      d += Math.min(a1, a2) * (Math.exp(-3.5 * s * x) - Math.exp(-5.75 * s * x));
    }
  return d;
}

let table: Float32Array | null = null;
let selfRough: Float32Array | null = null;
/** What two notes add when they sound together: seth([a, b]) − seth([a]) − seth([b]). Symmetric; 0 for the same note. */
export function cross(a: number, b: number): number {
  const x = Math.max(0, Math.min(127, Math.round(a)));
  const y = Math.max(0, Math.min(127, Math.round(b)));
  if (x === y) return 0;
  if (!table) {
    table = new Float32Array(128 * 128).fill(NaN);
    selfRough = new Float32Array(128).fill(NaN);
  }
  const lo = Math.min(x, y);
  const hi = Math.max(x, y);
  let v = table[lo * 128 + hi];
  if (Number.isNaN(v)) {
    const own = (m: number) => {
      if (Number.isNaN(selfRough![m])) selfRough![m] = seth(spectrum([m]));
      return selfRough![m];
    };
    v = Math.max(0, seth(spectrum([lo, hi])) - own(lo) - own(hi));
    table[lo * 128 + hi] = v;
    v = table[lo * 128 + hi];
  }
  return v;
}

/** What one note adds to what already sounds. */
export function added(h: number, sounding: readonly number[]): number {
  let s = 0;
  for (const k of sounding) s += cross(h, k);
  return s;
}

/** What a set of notes adds to what already sounds (its own pairs included). */
export function addedSet(hs: readonly number[], sounding: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < hs.length; i++) {
    s += added(hs[i], sounding);
    for (let j = i + 1; j < hs.length; j++) s += cross(hs[i], hs[j]);
  }
  return s;
}

/**
 * Hutchinson & Knopoff (1978) roughness of a set of notes, normalised by its energy (dycon's
 * `roughness_hutch`): critical bandwidth 1.72·f̄^0.65, Parncutt's curve ((y/0.25)·e^(1−y/0.25))²,
 * nothing beyond 1.2 bandwidths.
 */
export function roughness(midis: readonly number[]): number {
  const sp = spectrum(midis);
  let den = 0;
  for (const [, a] of sp) den += a * a;
  if (!den) return 0;
  let num = 0;
  for (let i = 0; i < sp.length; i++)
    for (let j = i + 1; j < sp.length; j++) {
      const [f1, a1] = sp[i];
      const [f2, a2] = sp[j];
      const y = Math.abs(f2 - f1) / (1.72 * ((f1 + f2) / 2) ** 0.65);
      if (y > 1.2) break;
      const g = (y / 0.25) * Math.exp(1 - y / 0.25);
      num += a1 * a2 * g * g;
    }
  return num / den;
}

// ── Harmonicity (har18) ────────────────────────────────────────

const BINS = 1200;
const SIGMA = 6.83;
const ROLLOFF = 0.75;
const PC_HARMONICS = 12;

/** A pitch-class spectrum: harmonics of each pitch class smeared by a Gaussian of σ cents on a 1200-bin circle. */
function pcSpectrum(pcs: readonly number[]): Float64Array {
  const out = new Float64Array(BINS);
  for (const p of pcs)
    for (let n = 1; n <= PC_HARMONICS; n++) {
      const centre = (((p * 100 + 1200 * Math.log2(n)) % BINS) + BINS) % BINS;
      const w = n ** -ROLLOFF;
      for (let d = -40; d <= 40; d++) {
        const bin = (((Math.round(centre) + d) % BINS) + BINS) % BINS;
        const x = Math.round(centre) + d - centre;
        out[bin] += w * Math.exp(-(x * x) / (2 * SIGMA * SIGMA));
      }
    }
  return out;
}
let template: Float64Array | null = null;
const harmCache = new Map<string, number>();
/**
 * Harrison & Pearce (2018) harmonicity: how far the set's virtual-pitch profile (its spectrum
 * against a harmonic template at every rotation) is from flat, as a KL divergence. Higher: more
 * like one tone. Depends on pitch classes only.
 */
export function harmonicity(midis: readonly number[]): number {
  const pcs = [...new Set(midis.map((m) => ((Math.round(m) % 12) + 12) % 12))].sort((a, b) => a - b);
  const k = pcs.join(",");
  const hit = harmCache.get(k);
  if (hit !== undefined) return hit;
  template ??= pcSpectrum([0]);
  const sp = pcSpectrum(pcs);
  // the template's support is small: correlate only over its non-zero bins
  const support: number[] = [];
  for (let i = 0; i < BINS; i++) if (template[i] > 1e-9) support.push(i);
  const profile = new Float64Array(BINS);
  let total = 0;
  for (let r = 0; r < BINS; r++) {
    let dot = 0;
    for (const i of support) dot += template[i] * sp[(i + r) % BINS];
    profile[r] = dot;
    total += dot;
  }
  let kl = 0;
  for (let r = 0; r < BINS; r++) {
    const q = profile[r] / total;
    if (q > 0) kl += q * Math.log2(q * BINS);
  }
  harmCache.set(k, kl);
  return kl;
}

/** The combined consonance model of incon (Harrison & Pearce 2020): 0.628 − 1.620·roughness + 1.780·harmonicity. */
export function consonance(midis: readonly number[]): number {
  return 0.628 - 1.62 * roughness(midis) + 1.78 * harmonicity(midis);
}
