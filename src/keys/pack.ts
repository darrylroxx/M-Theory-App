/**
 * A sample pack (the piano's recordings) and the arithmetic of playing it: which recording a key
 * uses, how far it is re-pitched, how loud each velocity is, and in what order the files load.
 *
 * Nothing here touches Web Audio, so the tests can check every key of the keyboard in node.
 *
 * The pack itself is built offline (scripts/piano-pack.py): every minor third across the 88 keys,
 * recorded at five strengths, trimmed, measured and described in `manifest.json`.
 */

/** One velocity layer: the same keys struck harder or softer. */
export interface PackLayer {
  /** The velocities (0..1) that use it, [from, to). The bands follow on from each other. */
  vel: [number, number];
  /** The velocity it was recorded at: here it plays at its natural loudness. */
  center: number;
  /**
   * Its natural loudness against the middle layer, in dB, as `db[0] + db[1] * octaves from C4`:
   * the treble has a wider range between soft and hard than the bass.
   */
  db: [number, number];
}

/** One recording of one key at one strength. */
export interface PackSample {
  /** The key it was recorded on. */
  note: number;
  /** Index into `layers`. */
  layer: number;
  file: string;
  /**
   * dB that bring the file (stored at full scale) to the instrument's level for its key; the
   * velocity curve is added on top.
   */
  gain: number;
  /** Its measured pitch, in cents from equal temperament. */
  cents: number;
  /** Seconds. */
  dur: number;
  bytes: number;
  /** The start of the file's SHA-256 (it names the version in the URL, so a cache never serves an old one). */
  sha?: string;
  /**
   * The lowpass cutoff (Hz) that makes this take as bright as the softer layer's take of the same
   * key, and the loudness (dB) that filter takes away. Played at the bottom of its layer's band it
   * is darkened this far, opening up to its own sound at the velocity it was recorded at, so
   * brightness follows velocity smoothly across the hand-over between layers.
   */
  soft?: number;
  softDb?: number;
}

/** The sound of the damper landing on the strings when a key is let go. */
export interface PackRelease {
  note: number;
  /** Recorded after soft playing (used below the second layer). */
  soft: boolean;
  file: string;
  gain: number;
  /** dB per second the release is quieter by for each second the note was held (the string has died away). */
  decay: number;
  cents: number;
  dur: number;
  bytes: number;
  sha?: string;
}

export interface PackManifest {
  name: string;
  version: number;
  format: string;
  sampleRate: number;
  /** Seconds of faded lead-in before the hammer strikes, in every file. */
  preroll: number;
  /** Lowest and highest key. */
  range: [number, number];
  /** Keys above this have no dampers: they ring on when let go. */
  dampedTop: number;
  /** The furthest any key is re-pitched, in semitones. */
  maxShift: number;
  /** A short tone that starts at `at` seconds, to measure how much silence the decoder adds. */
  probe: { file: string; at: number; sha?: string };
  /** Each key's tuning in cents from equal temperament, from range[0] up (a piano is stretch-tuned). */
  stretch: number[];
  layers: PackLayer[];
  samples: PackSample[];
  releases: PackRelease[];
  source: string;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** dB the softest notes (velocity 0) sit below the softest recording. */
const SOFTEST_DROP = 18;

/** The key's tuning, in cents from equal temperament (A4 = 440 Hz). */
export function stretchOf(m: PackManifest, midi: number): number {
  const i = clamp(Math.round(midi) - m.range[0], 0, m.stretch.length - 1);
  return m.stretch[i] ?? 0;
}

/** The frequency a key should sound at. */
export function targetHz(m: PackManifest, midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12 + stretchOf(m, midi) / 1200);
}

/** The velocity layer for a velocity (0..1). */
export function layerOf(m: PackManifest, velocity: number): number {
  const v = clamp(velocity, 0, 1);
  for (let i = 0; i < m.layers.length; i++) if (v < m.layers[i].vel[1]) return i;
  return m.layers.length - 1;
}

/** A layer's natural loudness against the middle layer at this key, in dB. */
export function layerDb(m: PackManifest, layer: number, midi: number): number {
  const d = m.layers[layer].db;
  return d[0] + d[1] * ((midi - 60) / 12);
}

/**
 * How loud a velocity plays, in dB against the middle layer, at this key.
 *
 * The curve passes through each layer's natural loudness at the velocity it was recorded at and is
 * straight in between, whichever layer actually sounds: so loudness never jumps where one layer
 * hands over to the next, only the tone changes (as it does on a real piano).
 */
export function velocityDb(m: PackManifest, midi: number, velocity: number): number {
  const L = m.layers;
  const v = clamp(velocity, 0, 1);
  const pts = L.map((l, i) => [l.center, layerDb(m, i, midi)] as const);
  const [c0, d0] = pts[0];
  // Softer than the softest take: just quieter, down to 18 dB below it at velocity 0.
  if (v <= c0) return d0 - SOFTEST_DROP * ((c0 - v) / c0);
  for (let i = 1; i < pts.length; i++) {
    const [c1, d1] = pts[i];
    if (v <= c1) {
      const [ca, da] = pts[i - 1];
      return da + ((v - ca) / (c1 - ca)) * (d1 - da);
    }
  }
  // Harder than the hardest take: a little louder still, at half the slope of the last step.
  const [ca, da] = pts[pts.length - 2];
  const [cb, db] = pts[pts.length - 1];
  return db + (v - cb) * 0.5 * ((db - da) / (cb - ca));
}

/** Cents a recording must move to sound as this key. */
export function shiftCents(m: PackManifest, s: { note: number; cents: number }, midi: number): number {
  return (midi - s.note) * 100 + stretchOf(m, midi) - s.cents;
}

/** The playback rate that turns a recording into this key. */
export function rateFor(m: PackManifest, s: { note: number; cents: number }, midi: number): number {
  return 2 ** (shiftCents(m, s, midi) / 1200);
}

/** The recording of `layer` that needs the smallest re-pitch for this key. */
export function nearestIn<T extends { note: number; cents: number }>(m: PackManifest, list: T[], midi: number): T | undefined {
  let best: T | undefined;
  let bestShift = Infinity;
  for (const s of list) {
    const d = Math.abs(shiftCents(m, s, midi));
    if (d < bestShift) {
      best = s;
      bestShift = d;
    }
  }
  return best;
}

/** Samples grouped by layer (cached per manifest). */
const byLayer = new WeakMap<PackManifest, PackSample[][]>();
export function layerSamples(m: PackManifest, layer: number): PackSample[] {
  let g = byLayer.get(m);
  if (!g) {
    g = m.layers.map(() => [] as PackSample[]);
    for (const s of m.samples) g[s.layer]?.push(s);
    byLayer.set(m, g);
  }
  return g[layer] ?? [];
}

/** Layers in the order to fall back on: the one asked for, then outwards (softer first on a tie). */
export function layersNear(m: PackManifest, layer: number): number[] {
  const out: number[] = [layer];
  for (let d = 1; out.length < m.layers.length; d++) {
    if (layer - d >= 0) out.push(layer - d);
    if (layer + d < m.layers.length) out.push(layer + d);
  }
  return out;
}

/** Above this the lowpass is left out (a piano has next to nothing up there). */
export const OPEN_CUTOFF = 16000;
/**
 * How the cutoff opens across the band: soft / (1 - u)^SHADE_OPEN for u from 0 (the band's
 * bottom) to 1 (the take's own velocity). Measured on the takes, this makes brightness rise about
 * evenly with velocity (a straight sweep of the cutoff would do most of it in the first fifth).
 */
export const SHADE_OPEN = 0.6;

/** How far a take is darkened when played at `velocity` (none at or above the velocity it was recorded at). */
export function shade(m: PackManifest, s: PackSample, velocity: number): { cutoff: number; db: number } | undefined {
  if (!s.soft || s.layer === 0) return undefined;
  const L = m.layers[s.layer];
  const v = clamp(velocity, 0, 1);
  if (v >= L.center) return undefined;
  const u = clamp((v - L.vel[0]) / (L.center - L.vel[0]), 0, 1);
  const cutoff = s.soft * (1 - u) ** -SHADE_OPEN;
  if (cutoff >= OPEN_CUTOFF) return undefined;
  return { cutoff, db: (s.softDb ?? 0) * (1 - u) };
}

export interface Pick {
  sample: PackSample;
  /** The layer the velocity asked for (the sample may come from a neighbour while that one loads). */
  layer: number;
  rate: number;
  /** dB to apply: the file's own gain plus the velocity curve (plus what the darkening takes away). */
  db: number;
  /** Lowpass cutoff (Hz) that darkens a take played softer than it was recorded; none when it plays as it is. */
  cutoff?: number;
}

function picked(m: PackManifest, s: PackSample, layer: number, midi: number, velocity: number, db: number): Pick {
  const sh = shade(m, s, velocity);
  return { sample: s, layer, rate: rateFor(m, s, midi), db: s.gain + db + (sh?.db ?? 0), cutoff: sh?.cutoff };
}

/**
 * The recording to play for a key and velocity. `has` says which files are loaded: when the right
 * one is not there yet, the nearest loaded layer stands in (and then the nearest loaded key within
 * reach), so a note is never silent just because its own take is still on its way.
 */
export function pick(m: PackManifest, midi: number, velocity: number, has: (file: string) => boolean = () => true): Pick | undefined {
  const layer = layerOf(m, velocity);
  const db = velocityDb(m, midi, velocity);
  const limit = m.maxShift * 100 + 1;
  for (const l of layersNear(m, layer)) {
    const ready = layerSamples(m, l).filter((s) => has(s.file));
    const s = nearestIn(m, ready, midi);
    if (s && Math.abs(shiftCents(m, s, midi)) <= limit) return picked(m, s, layer, midi, velocity, db);
  }
  // Nothing within reach is loaded: take any loaded take, however far it must move.
  for (const l of layersNear(m, layer)) {
    const s = nearestIn(m, layerSamples(m, l).filter((x) => has(x.file)), midi);
    if (s) return picked(m, s, layer, midi, velocity, db);
  }
  return undefined;
}

/** The damper sound for a key let go, or nothing for the undamped top keys. */
export function releaseFor(m: PackManifest, midi: number, velocity: number): PackRelease | undefined {
  if (midi > m.dampedTop || !m.releases.length) return undefined;
  const soft = m.layers.length > 1 && velocity < m.layers[1].vel[0];
  const list = m.releases.filter((r) => r.soft === soft);
  return nearestIn(m, list.length ? list : m.releases, midi);
}

/** The files a set of notes needs (for an offline render, which cannot wait for a file mid-way). */
export function filesFor(m: PackManifest, notes: Iterable<{ midi: number; velocity: number }>, releases = true): string[] {
  const out = new Set<string>();
  for (const n of notes) {
    const p = pick(m, n.midi, n.velocity);
    if (p) out.add(p.sample.file);
    const r = releases ? releaseFor(m, n.midi, n.velocity) : undefined;
    if (r) out.add(r.file);
  }
  return [...out];
}

/**
 * The order to load files in: first one layer (the one for `core` velocity) across the whole
 * keyboard, middle octaves first, so every key can sound as soon as possible; then the damper
 * sounds; then the other layers, nearest in strength first, each again from the middle outwards.
 * Returns tiers: the first tier is what `ready()` waits for.
 */
export function loadOrder(m: PackManifest, core = 0.7, releases = true, middle = 62): string[][] {
  const first = layerOf(m, core);
  const outward = <T extends { note: number }>(list: T[]) =>
    [...list].sort((a, b) => Math.abs(a.note - middle) - Math.abs(b.note - middle) || a.note - b.note);
  const tiers: string[][] = [];
  const rel = (soft: boolean) => outward(m.releases.filter((r) => r.soft === soft)).map((r) => r.file);
  for (const l of layersNear(m, first)) {
    tiers.push(outward(layerSamples(m, l)).map((s) => s.file));
    if (releases && l === first) tiers.push(rel(false));
    // the soft damper sounds are only used with the softest layer, so they come with it
    if (releases && l === 0) tiers.push(rel(true));
  }
  return tiers.filter((t) => t.length);
}

/** Problems with a manifest (empty when it is sound). Used by the tests and when a pack loads. */
export function checkManifest(m: PackManifest): string[] {
  const errs: string[] = [];
  if (!m.layers.length) errs.push("no layers");
  if (m.stretch.length !== m.range[1] - m.range[0] + 1) errs.push("stretch table does not cover the range");
  for (let i = 0; i < m.layers.length; i++) {
    const l = m.layers[i];
    if (!(l.vel[0] < l.vel[1])) errs.push(`layer ${i} has an empty band`);
    if (!(l.center >= l.vel[0] && l.center <= l.vel[1])) errs.push(`layer ${i} centre lies outside its band`);
    if (i > 0) {
      const p = m.layers[i - 1];
      if (p.vel[1] !== l.vel[0]) errs.push(`layers ${i - 1} and ${i} do not meet`);
      if (!(l.center > p.center)) errs.push(`layer ${i} is not harder than layer ${i - 1}`);
    }
  }
  if (m.layers[0]?.vel[0] !== 0 || m.layers[m.layers.length - 1]?.vel[1] !== 1) errs.push("layers do not cover 0..1");
  for (let k = m.range[0]; k <= m.range[1]; k++) {
    for (let l = 0; l < m.layers.length; l++) {
      const s = nearestIn(m, layerSamples(m, l), k);
      if (!s) errs.push(`layer ${l} has no samples`);
      else if (Math.abs(shiftCents(m, s, k)) > m.maxShift * 100) errs.push(`key ${k} layer ${l} is ${shiftCents(m, s, k).toFixed(0)} cents from its sample`);
    }
  }
  const files = new Set<string>();
  for (const s of [...m.samples, ...m.releases]) {
    if (files.has(s.file)) errs.push(`${s.file} listed twice`);
    files.add(s.file);
    if (!(s.dur > 0) || !(s.bytes > 0) || !Number.isFinite(s.gain)) errs.push(`${s.file} has a bad size, length or gain`);
  }
  for (const s of m.samples)
    if (s.soft !== undefined && !(s.soft > 50 && s.soft < OPEN_CUTOFF && s.layer > 0 && Number.isFinite(s.softDb ?? 0)))
      errs.push(`${s.file} has a bad darkening`);
  return errs;
}
