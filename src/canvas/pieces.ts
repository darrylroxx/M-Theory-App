/**
 * Short pieces of music made from nothing, part by part, for testing the canvas: the drums, a
 * bass, held chords or plucked ones, a melody, a harmony line under it and a singing voice, each
 * with its own sound, in any key, at any tempo, louder or quieter, brighter or duller. Two pieces
 * made from the same parts in different keys, with different notes and a different mix, are
 * "the same kind of music"; pieces made from different parts are not. The canvas should paint
 * the first two alike and the others differently.
 *
 * Every piece comes back as a stereo mix, each part on its own (as a stem), and the list of its
 * notes and hits.
 */
import { Ear } from "../listen/ear";
import type { LayerKind } from "./layers";
import { rng, type Rng } from "./rand";
import { VibeMeter } from "./vibe";

export interface PieceSpec {
  seed: number;
  seconds: number;
  bpm: number;
  /** the key note (0 = C) and whether the key is minor */
  key: number;
  minor?: boolean;
  /** the whole mix louder or quieter (a plain multiplier) */
  gain?: number;
  /** a shelf above 2 kHz, in dB (brighter or duller production) */
  tilt?: number;
  sr?: number;
  drums?: { level: number; busy?: boolean; open?: boolean };
  bass?: { level: number; pulse?: boolean };
  pad?: { level: number };
  pluck?: { level: number };
  melody?: { level: number; staccato?: boolean; leaps?: boolean };
  harmony?: { level: number };
  vocal?: { level: number; breathy?: boolean };
}

export interface PieceNote {
  layer: LayerKind;
  t: number;
  midi: number;
  len: number;
  vel: number;
  drum?: string;
}

export interface Piece {
  sr: number;
  left: Float32Array;
  right: Float32Array;
  stems: Partial<Record<LayerKind, Float32Array>>;
  notes: PieceNote[];
}

const TAU = Math.PI * 2;
const hzOf = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** The chords of the piece, one a bar, as scale steps from the key note: I V vi IV, or i VI III VII. */
const PROG_MAJOR = [0, 4, 5, 3];
const PROG_MINOR = [0, 5, 2, 6];

export function renderPiece(spec: PieceSpec): Piece {
  const sr = spec.sr ?? 44100;
  const n = Math.round(spec.seconds * sr);
  const r = rng(spec.seed);
  const scale = spec.minor ? MINOR : MAJOR;
  const prog = spec.minor ? PROG_MINOR : PROG_MAJOR;
  const beat = 60 / spec.bpm;
  const bar = beat * 4;
  const bars = Math.ceil(spec.seconds / bar);
  const stems: Partial<Record<LayerKind, Float32Array>> = {};
  const pan: Partial<Record<LayerKind, number>> = {};
  const notes: PieceNote[] = [];
  const stem = (l: LayerKind, p = 0) => {
    pan[l] = p;
    return (stems[l] ??= new Float32Array(n));
  };
  const degree = (step: number, octave: number) => {
    const s = ((step % 7) + 7) % 7;
    const o = Math.floor(step / 7);
    return 12 * (octave + o + 1) + spec.key + scale[s];
  };

  // ── drums ──
  if (spec.drums) {
    const d = stem("drums", 0);
    const L = spec.drums.level;
    const steps = bars * 16;
    for (let i = 0; i < steps; i++) {
      const t = (i / 4) * beat;
      if (t >= spec.seconds) break;
      const pos = i % 16;
      if (pos === 0 || pos === 8 || (spec.drums.busy && (pos === 10 || pos === 3))) kick(d, sr, t, L * (0.9 + 0.1 * r()), notes);
      if (pos === 4 || pos === 12) snare(d, sr, t, L * 0.8 * (0.9 + 0.2 * r()), r, notes);
      const hat = spec.drums.busy ? true : pos % 2 === 0;
      if (hat) hiss(d, sr, t, L * (pos % 4 === 2 ? 0.45 : 0.3) * (0.8 + 0.4 * r()), spec.drums.open && pos % 8 === 6 ? 0.28 : 0.035, r, notes);
    }
  }
  // ── bass: the root of each chord, low ──
  if (spec.bass) {
    const b = stem("bass", 0);
    for (let k = 0; k < bars; k++) {
      const root = degree(prog[k % 4], 1);
      const t0 = k * bar;
      if (spec.bass.pulse) for (let e = 0; e < 8; e++) tone(b, sr, t0 + e * beat * 0.5, beat * 0.4, hzOf(root), spec.bass.level, [1, 0.5, 0.3, 0.15], 0.005, 0.06, notes, "bass", root);
      else tone(b, sr, t0, bar * 0.96, hzOf(root), spec.bass.level, [1, 0.5, 0.3, 0.15], 0.02, 0.15, notes, "bass", root);
    }
  }
  // ── held chords: a triad a bar, swelling in ──
  if (spec.pad) {
    const p = stem("chords", 0.5);
    for (let k = 0; k < bars; k++) {
      const st = prog[k % 4];
      for (const s of [0, 2, 4]) {
        const m = degree(st + s, 3);
        tone(p, sr, k * bar, bar * 0.98, hzOf(m) * (1 + (r() - 0.5) * 0.002), spec.pad.level * 0.5, [1, 0.35, 0.2, 0.1], 0.25, 0.3, notes, "chords", m);
      }
    }
  }
  // ── plucked chords: the triad broken in eighths ──
  if (spec.pluck) {
    const p = stem("other", -0.4);
    for (let k = 0; k < bars; k++) {
      const st = prog[k % 4];
      for (let e = 0; e < 8; e++) {
        const m = degree(st + [0, 2, 4, 7][e % 4], 3);
        pluck(p, sr, k * bar + e * beat * 0.5, hzOf(m), spec.pluck.level * 0.6, notes, m);
      }
    }
  }
  // ── melody: steps (or leaps) through the scale, a note a beat or two ──
  let line: { t: number; len: number; step: number }[] = [];
  if (spec.melody || spec.harmony || spec.vocal) {
    let step = 7 + Math.floor(r() * 3);
    let t = bar * 0.5;
    while (t < spec.seconds - 0.2) {
      const len = beat * (r() < 0.3 ? 2 : 1);
      line.push({ t, len, step });
      const move = spec.melody?.leaps ? [-4, -3, 3, 4, 5, -5][Math.floor(r() * 6)] : [-1, 1, -1, 1, 2, -2][Math.floor(r() * 6)];
      step = Math.max(4, Math.min(13, step + move));
      t += len;
      // a breath now and then
      if (r() < 0.12) t += beat;
    }
  }
  if (spec.melody) {
    const m = stem("melody", 0.15);
    for (const nn of line) {
      const midi = degree(nn.step, 4);
      const len = spec.melody.staccato ? Math.min(0.12, nn.len * 0.3) : nn.len * 0.94;
      tone(m, sr, nn.t, len, hzOf(midi), spec.melody.level * 0.55, [1, 0.45, 0.25, 0.12, 0.06], 0.008, 0.05, notes, "melody", midi);
    }
  }
  if (spec.harmony) {
    const h = stem("harmony", -0.15);
    for (const nn of line) {
      const midi = degree(nn.step - 2, 4);
      tone(h, sr, nn.t, nn.len * 0.9, hzOf(midi), spec.harmony.level * 0.4, [1, 0.3, 0.12], 0.012, 0.06, notes, "harmony", midi);
    }
  }
  if (spec.vocal) {
    const v = stem("vocals", 0);
    for (const nn of line) {
      const midi = degree(nn.step, 3);
      voice(v, sr, nn.t, nn.len * 0.97, hzOf(midi), spec.vocal.level * 0.5, !!spec.vocal.breathy, r);
      notes.push({ layer: "vocals", t: nn.t, midi, len: nn.len * 0.97, vel: spec.vocal.level });
    }
    void line;
  }
  line = [];

  // ── the mix: each part panned, then the production (a shelf, the level) ──
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (const [l, x] of Object.entries(stems) as [LayerKind, Float32Array][]) {
    const p = pan[l] ?? 0;
    const gl = Math.cos(((p + 1) * Math.PI) / 4);
    const gr = Math.sin(((p + 1) * Math.PI) / 4);
    for (let i = 0; i < n; i++) {
      left[i] += x[i] * gl;
      right[i] += x[i] * gr;
    }
  }
  const g = spec.gain ?? 1;
  for (const ch of [left, right, ...Object.values(stems)] as Float32Array[]) {
    if (spec.tilt) shelf(ch, sr, spec.tilt);
    if (g !== 1) for (let i = 0; i < n; i++) ch[i] *= g;
  }
  notes.sort((a, b) => a.t - b.t);
  return { sr, left, right, stems, notes };
}

/** A tone with a few overtones, swelling in over `att` and dying over `rel`. */
function tone(x: Float32Array, sr: number, t0: number, len: number, hz: number, amp: number, partials: number[], att: number, rel: number, notes: PieceNote[], layer: LayerKind, midi: number) {
  const from = Math.round(t0 * sr);
  const end = Math.min(x.length, from + Math.round((len + rel) * sr));
  notes.push({ layer, t: t0, midi, len, vel: amp });
  for (let i = from; i < end; i++) {
    const t = (i - from) / sr;
    const env = Math.min(1, t / Math.max(0.001, att)) * (t < len ? 1 : Math.exp(-(t - len) / Math.max(0.005, rel / 4)));
    let s = 0;
    for (let k = 0; k < partials.length; k++) if (hz * (k + 1) < sr / 2) s += partials[k] * Math.sin(TAU * hz * (k + 1) * t);
    x[i] += amp * env * s * 0.6;
  }
}

/** A plucked string: bright at first, darkening and dying away. */
function pluck(x: Float32Array, sr: number, t0: number, hz: number, amp: number, notes: PieceNote[], midi: number) {
  const from = Math.round(t0 * sr);
  const len = 1.2;
  notes.push({ layer: "other", t: t0, midi, len, vel: amp });
  for (let i = from; i < Math.min(x.length, from + len * sr); i++) {
    const t = (i - from) / sr;
    let s = 0;
    for (let k = 1; k <= 6; k++) if (hz * k < sr / 2) s += Math.exp(-t * (2 + 3 * k)) * Math.sin(TAU * hz * k * t) / k;
    x[i] += amp * Math.min(1, t / 0.002) * s;
  }
}

function kick(x: Float32Array, sr: number, t0: number, amp: number, notes: PieceNote[]) {
  const from = Math.round(t0 * sr);
  notes.push({ layer: "drums", t: t0, midi: 0, len: 0.3, vel: amp, drum: "kick" });
  let ph = 0;
  for (let i = from; i < Math.min(x.length, from + 0.35 * sr); i++) {
    const t = (i - from) / sr;
    const f = 45 + 80 * Math.exp(-t / 0.04);
    ph += (TAU * f) / sr;
    x[i] += amp * 0.9 * Math.exp(-t / 0.16) * Math.sin(ph);
  }
}

function snare(x: Float32Array, sr: number, t0: number, amp: number, r: Rng, notes: PieceNote[]) {
  const from = Math.round(t0 * sr);
  notes.push({ layer: "drums", t: t0, midi: 0, len: 0.15, vel: amp, drum: "snare" });
  let lp = 0;
  for (let i = from; i < Math.min(x.length, from + 0.25 * sr); i++) {
    const t = (i - from) / sr;
    const w = r() * 2 - 1;
    lp += (w - lp) * 0.5;
    x[i] += amp * (0.55 * Math.exp(-t / 0.07) * (w - lp * 0.6) + 0.35 * Math.exp(-t / 0.05) * Math.sin(TAU * 190 * t));
  }
}

function hiss(x: Float32Array, sr: number, t0: number, amp: number, decay: number, r: Rng, notes: PieceNote[]) {
  const from = Math.round(t0 * sr);
  notes.push({ layer: "drums", t: t0, midi: 0, len: decay, vel: amp, drum: decay > 0.1 ? "open" : "hat" });
  let prev = 0;
  for (let i = from; i < Math.min(x.length, from + decay * 7 * sr); i++) {
    const t = (i - from) / sr;
    const w = r() * 2 - 1;
    // a crude high pass: the difference of successive samples
    x[i] += amp * 0.5 * Math.exp(-t / decay) * (w - prev);
    prev = w;
  }
}

/** A sung vowel: a pitch with a vibrato, its overtones shaped by the vowel's resonances, and a little breath. */
function voice(x: Float32Array, sr: number, t0: number, len: number, hz: number, amp: number, breathy: boolean, r: Rng) {
  const from = Math.round(t0 * sr);
  const end = Math.min(x.length, from + Math.round((len + 0.08) * sr));
  const formants = [700, 1150, 2600];
  let ph = 0;
  let lp = 0;
  for (let i = from; i < end; i++) {
    const t = (i - from) / sr;
    const vib = 1 + 0.012 * Math.sin(TAU * 5.5 * t) * Math.min(1, t / 0.3);
    const f = hz * vib;
    ph += (TAU * f) / sr;
    let s = 0;
    for (let k = 1; k <= 12; k++) {
      const fk = f * k;
      if (fk > sr / 2) break;
      let g = 0;
      for (const fm of formants) g += 1 / (1 + ((fk - fm) / 160) ** 2);
      s += (g / k ** 0.5) * Math.sin(ph * k);
    }
    const env = Math.min(1, t / 0.06) * (t < len ? 1 : Math.exp(-(t - len) / 0.03));
    const w = r() * 2 - 1;
    lp += (w - lp) * 0.3;
    x[i] += amp * env * (0.35 * s + (breathy ? 0.25 : 0.05) * (w - lp));
  }
}

/** A gentle shelf above 2 kHz, `db` up or down. */
function shelf(x: Float32Array, sr: number, db: number) {
  const g = Math.pow(10, db / 20) - 1;
  const a = Math.exp((-TAU * 2000) / sr);
  let lp = 0;
  for (let i = 0; i < x.length; i++) {
    lp = (1 - a) * x[i] + a * lp;
    x[i] += g * (x[i] - lp);
  }
}

/** Left and right as one. */
export function monoOf(p: Piece): Float32Array {
  const out = new Float32Array(p.left.length);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (p.left[i] + p.right[i]);
  return out;
}

/**
 * How loud each part is, a hundred times a second, on the scale the canvas uses for every layer
 * (0 = −50 dBFS or less … 1 = −14 dBFS): what a song's layers would report.
 */
export function partLevels(p: Piece): { t: number; levels: Partial<Record<LayerKind, number>> }[] {
  const hop = Math.round(p.sr / 100);
  const out: { t: number; levels: Partial<Record<LayerKind, number>> }[] = [];
  for (let i = 0; i + hop <= p.left.length; i += hop) {
    const levels: Partial<Record<LayerKind, number>> = {};
    for (const [l, x] of Object.entries(p.stems) as [LayerKind, Float32Array][]) {
      let e = 0;
      for (let k = i; k < i + hop; k++) e += x[k] * x[k];
      const db = 10 * Math.log10(e / hop + 1e-12);
      const as: LayerKind = l === "other" ? "chords" : l === "harmony" ? "melody" : l;
      levels[as] = Math.max(levels[as] ?? 0, Math.max(0, Math.min(1, (db + 50) / 36)));
    }
    out.push({ t: i / p.sr, levels });
  }
  return out;
}

/** A spread of different pieces, for measuring what is usual (the vibe's reference figures). */
export function referenceSpecs(): PieceSpec[] {
  const out: PieceSpec[] = [];
  const r = rng(20261118);
  for (let i = 0; i < 30; i++) {
    const has = (p: number) => r() < p;
    const lv = () => 0.3 + 0.7 * r();
    out.push({
      seed: 1000 + i,
      seconds: 14,
      bpm: Math.round(65 + r() * 100),
      key: Math.floor(r() * 12),
      minor: has(0.45),
      gain: 0.4 + 0.9 * r(),
      tilt: (r() - 0.5) * 8,
      drums: has(0.6) ? { level: lv(), busy: has(0.4), open: has(0.3) } : undefined,
      bass: has(0.6) ? { level: lv(), pulse: has(0.4) } : undefined,
      pad: has(0.55) ? { level: lv() } : undefined,
      pluck: has(0.4) ? { level: lv() } : undefined,
      melody: has(0.7) ? { level: lv(), staccato: has(0.3), leaps: has(0.3) } : undefined,
      harmony: has(0.3) ? { level: lv() } : undefined,
      vocal: has(0.35) ? { level: lv(), breathy: has(0.4) } : undefined,
    });
  }
  return out;
}

/** The vibe of a piece, measured as the canvas measures a song from a file: the ear on the mix, and each part's loudness. */
export function measureVibe(p: Piece): Float32Array {
  const ear = new Ear(p.sr);
  const meter = new VibeMeter();
  const mono = monoOf(p);
  const levels = partLevels(p);
  const step = Math.round(p.sr / 50);
  let li = 0;
  for (let i = 0; i < mono.length; i += step) {
    for (const f of ear.push(mono.subarray(i, i + step))) {
      meter.take(f);
      while (li < levels.length - 1 && levels[li].t < f.t) li++;
      meter.roles(levels[li].levels);
    }
  }
  return meter.fingerprint();
}
