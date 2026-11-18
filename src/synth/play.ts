/**
 * Ways of playing: the chords and notes as written go in, the notes the synth should play come
 * out. Pure functions of their input (randomness comes from a seed), so the same song always
 * plays the same way, live and in a render.
 *
 * Times are in seconds, like the audio clock; `bpm` (and `origin`, where beat 1 falls) are only
 * needed to turn musical step sizes (1/16, 1/8 triplets…) into seconds.
 *
 * Modes, after the research notes: Sustain (as written), Arp (up, down, up-down, random, chord,
 * crawl; 1/4 to 1/32 with triplets; 1 to 3 octaves; gate), Strum (spread and direction), Pulse
 * (the chord struck again on a rhythm), Drone (the home note and its fifth held under everything,
 * with a slow-moving voice above that follows the chords) and Glide (one line, notes joined so a
 * legato synth slides between them). Humanise loosens the timing and the touch of any of them.
 */
import type { ArpPattern, PlaySettings, Rate, StrumDir, SynthParams } from "./params";

export interface PlayNote {
  midi: number;
  /** seconds */
  start: number;
  /** seconds */
  length: number;
  /** 0..1 */
  velocity: number;
}

export interface SynthNote extends PlayNote {
  /** a lane: a new note on the same slot takes over from the one before (see Instrument.play) */
  slot?: number;
}

export interface PlayContext {
  bpm: number;
  /** where beat 1 falls, in seconds (rhythmic modes line up to it); default 0 */
  origin?: number;
  /** seed for Random arpeggios and Humanise */
  seed?: number;
  /** the key's home note as a pitch class (0 = C) for the drone; default: the first chord's bass */
  tonic?: number;
}

/** The length of one step, in beats. */
export function rateBeats(rate: Rate): number {
  switch (rate) {
    case "1/4":
      return 1;
    case "1/8":
      return 0.5;
    case "1/8T":
      return 1 / 3;
    case "1/16":
      return 0.25;
    case "1/16T":
      return 1 / 6;
    case "1/32":
      return 0.125;
  }
}

const beatSec = (bpm: number) => 60 / Math.max(20, Math.min(400, bpm || 120));
/** notes that start within this of each other are one chord */
const TOGETHER = 0.005;

function rng(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const valid = (n: PlayNote) => Number.isFinite(n.midi) && Number.isFinite(n.start) && Number.isFinite(n.length) && n.length > 0;
const byStart = (a: PlayNote, b: PlayNote) => a.start - b.start || a.midi - b.midi;

/** Group notes that start together into chords, in time order (each chord lowest note first). */
export function chordsOf(notes: PlayNote[]): PlayNote[][] {
  const sorted = notes.filter(valid).sort(byStart);
  const out: PlayNote[][] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n.start - last[0].start <= TOGETHER) last.push(n);
    else out.push([n]);
  }
  for (const c of out) c.sort((a, b) => a.midi - b.midi);
  return out;
}

/** When a chord stops: its longest note, or the next chord, whichever comes first. */
function spanOf(chords: PlayNote[][], i: number): [number, number] {
  const c = chords[i];
  const start = c[0].start;
  let end = start;
  for (const n of c) end = Math.max(end, n.start + n.length);
  const next = chords[i + 1];
  if (next) end = Math.min(end, next[0].start);
  return [start, end];
}

/** As written. */
export function sustain(notes: PlayNote[]): SynthNote[] {
  return notes.filter(valid).sort(byStart).map((n) => ({ ...n }));
}

/** The order an arpeggio walks a chord's notes (spread over `octaves`); "chord" is handled by the caller. */
export function arpOrder(pitches: number[], pattern: ArpPattern, octaves: number, rand: () => number = Math.random): number[] {
  const base = [...new Set(pitches)].sort((a, b) => a - b);
  if (base.length === 0) return [];
  const up: number[] = [];
  for (let o = 0; o < octaves; o++) for (const p of base) up.push(p + 12 * o);
  switch (pattern) {
    case "up":
    case "chord":
      return up;
    case "down":
      return [...up].reverse();
    case "updown":
      return up.length > 2 ? [...up, ...up.slice(1, -1).reverse()] : up;
    case "random": {
      const r = [...up];
      for (let i = r.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [r[i], r[j]] = [r[j], r[i]];
      }
      return r;
    }
    case "crawl": {
      // a window as wide as the chord, sliding up one note at a time: C E G, E G C', G C' E', …
      const n = base.length;
      const ext = [...up, ...base.map((p) => p + 12 * octaves)];
      const out: number[] = [];
      for (let i = 0; i + n <= ext.length; i++) out.push(...ext.slice(i, i + n));
      return out;
    }
  }
}

/** Arpeggio: each chord's notes one after another at `rate`, starting again at every chord. */
export function arp(notes: PlayNote[], o: { pattern: ArpPattern; rate: Rate; octaves: number; gate: number }, ctx: PlayContext): SynthNote[] {
  const chords = chordsOf(notes);
  const step = rateBeats(o.rate) * beatSec(ctx.bpm);
  const gate = Math.max(0.05, Math.min(1, o.gate));
  const octaves = Math.max(1, Math.min(3, Math.round(o.octaves)));
  const rand = rng((ctx.seed ?? 1) ^ 0xa5a5);
  const out: SynthNote[] = [];
  chords.forEach((c, ci) => {
    const [start, end] = spanOf(chords, ci);
    const vel = Math.max(...c.map((n) => n.velocity));
    let seq = arpOrder(c.map((n) => n.midi), o.pattern, octaves, rand);
    if (seq.length === 0) return;
    const base = [...new Set(c.map((n) => n.midi))].sort((a, b) => a - b);
    const origin = ctx.origin ?? 0;
    for (let k = 0; ; k++) {
      const t = start + k * step;
      if (t >= end - 1e-6) break;
      const len = Math.min(step * gate, end - t);
      // a little weight on the beat
      const beatPos = (t - origin) / beatSec(ctx.bpm);
      const accent = Math.abs(beatPos - Math.round(beatPos)) < 1e-3 ? 1 : 0.82;
      if (o.pattern === "chord") {
        const oct = 12 * (k % octaves);
        for (const p of base) out.push({ midi: p + oct, start: t, length: len, velocity: vel * accent });
      } else {
        if (o.pattern === "random" && k > 0 && k % seq.length === 0) seq = arpOrder(c.map((n) => n.midi), "random", octaves, rand);
        out.push({ midi: seq[k % seq.length], start: t, length: len, velocity: vel * accent });
      }
    }
  });
  return out.sort(byStart);
}

/** Strum: each chord's notes spread out like a hand across strings, all let go together. */
export function strum(notes: PlayNote[], o: { spread: number; direction: StrumDir }): SynthNote[] {
  const chords = chordsOf(notes);
  const gap = (10 + 70 * Math.max(0, Math.min(1, o.spread))) / 1000;
  const out: SynthNote[] = [];
  chords.forEach((c, ci) => {
    const down = o.direction === "down" || (o.direction === "alternate" && ci % 2 === 0);
    const order = down ? c : [...c].reverse();
    order.forEach((n, i) => {
      const d = i * gap;
      const len = n.length - d;
      if (len <= 0.01) return;
      // later strings are struck a little softer
      out.push({ midi: n.midi, start: n.start + d, length: len, velocity: n.velocity * (1 - 0.04 * i) });
    });
  });
  return out.sort(byStart);
}

/** Pulse: every chord struck again on a rhythm (in time with the song's beat), each hit held for `gate` of a step. */
export function pulse(notes: PlayNote[], o: { rate: Rate; gate: number }, ctx: PlayContext): SynthNote[] {
  const chords = chordsOf(notes);
  const spb = beatSec(ctx.bpm);
  const step = rateBeats(o.rate) * spb;
  const gate = Math.max(0.05, Math.min(1, o.gate));
  const origin = ctx.origin ?? 0;
  const out: SynthNote[] = [];
  chords.forEach((c, ci) => {
    const [start, end] = spanOf(chords, ci);
    // the chord itself, then every grid point after it
    const times = [start];
    let k = Math.floor((start - origin) / step + 1e-6) + 1;
    for (let t = origin + k * step; t < end - 1e-6; t = origin + ++k * step) times.push(t);
    for (const t of times) {
      const len = Math.min(step * gate, end - t);
      if (len <= 0.005) continue;
      const beatPos = (t - origin) / spb;
      const accent = Math.abs(beatPos - Math.round(beatPos)) < 1e-3 ? 1 : 0.8;
      for (const n of c) out.push({ midi: n.midi, start: t, length: len, velocity: n.velocity * accent });
    }
  });
  return out.sort(byStart);
}

/** Put a pitch class in the octave starting at `low`. */
const near = (pc: number, low: number) => low + ((((pc - low) % 12) + 12) % 12);

/**
 * Drone: the home note, its fifth and its octave held under the whole passage, low down; above
 * them one quieter voice moves to each chord's root as the chords change (slowly, if the sound
 * has a slow attack), so the drone keeps evolving.
 */
export function drone(notes: PlayNote[], ctx: PlayContext): SynthNote[] {
  const chords = chordsOf(notes);
  if (chords.length === 0) return [];
  const first = chords[0][0];
  const tonic = ctx.tonic ?? ((first.midi % 12) + 12) % 12;
  const root = near(tonic, 36);
  const start = first.start;
  let end = start;
  for (const c of chords) for (const n of c) end = Math.max(end, n.start + n.length);
  const vel = Math.max(...chords.flat().map((n) => n.velocity));
  const len = end - start;
  const out: SynthNote[] = [
    { midi: root, start, length: len, velocity: vel, slot: 100 },
    { midi: root + 7, start, length: len, velocity: vel * 0.85, slot: 101 },
    { midi: root + 12, start, length: len, velocity: vel * 0.7, slot: 102 },
  ];
  // the moving voice, an octave above the drone, overlapping a little so it swells from one root to the next
  const overlap = 0.4 * beatSec(ctx.bpm);
  let lastPc = -1;
  chords.forEach((c, ci) => {
    const [s, e] = spanOf(chords, ci);
    const pc = ((c[0].midi % 12) + 12) % 12;
    const prev = out[out.length - 1];
    if (pc === lastPc && prev.slot === 103) {
      prev.length = e - prev.start + overlap;
      return;
    }
    lastPc = pc;
    out.push({ midi: near(pc, root + 12), start: s, length: Math.min(e + overlap, end) - s, velocity: vel * 0.55, slot: 103 });
  });
  for (const n of out) n.length = Math.max(0.01, Math.min(n.length, end - n.start));
  return out.sort(byStart);
}

/**
 * Glide: one line. Of notes that start together only the top one is kept (the melody); each note
 * is held until just after the next one starts (when it follows within a beat), so a mono-legato
 * synth slides from one to the next instead of starting again.
 */
export function glide(notes: PlayNote[], ctx: PlayContext): SynthNote[] {
  const line = chordsOf(notes).map((c) => c[c.length - 1]);
  const join = beatSec(ctx.bpm);
  return line.map((n, i) => {
    const next = line[i + 1];
    let length = n.length;
    if (next) {
      const gap = next.start - (n.start + n.length);
      if (gap <= join) length = next.start - n.start + 0.03;
    }
    return { midi: n.midi, start: n.start, length, velocity: n.velocity, slot: 0 };
  });
}

/** Humanise: nudge each note's time by up to ±20 ms and its velocity by up to ±15% (scaled by `amount`). */
export function humanise<T extends PlayNote>(notes: T[], amount: number, seed = 1): T[] {
  const a = Math.max(0, Math.min(1, amount));
  if (a === 0) return notes.map((n) => ({ ...n }));
  const r = rng(seed ^ 0x51ed);
  // groups of notes struck together move together, so chords stay chords
  let lastStart = Number.NaN;
  let shift = 0;
  return notes
    .map((n) => {
      if (Math.abs(n.start - lastStart) > TOGETHER) {
        shift = (r() + r() - 1) * 0.02 * a;
        lastStart = n.start;
      }
      const vel = n.velocity * (1 + (r() + r() - 1) * 0.15 * a);
      const start = Math.max(0, n.start + shift);
      return { ...n, start, length: Math.max(0.005, n.length - Math.max(0, start - n.start)), velocity: Math.max(0.05, Math.min(1, vel)) };
    })
    .sort(byStart);
}

/**
 * The voice a way of playing needs: Glide joins notes, so it needs a legato voice (with some
 * portamento if the sound has none); a Drone holds several notes at once, so it needs a poly one.
 */
export function voiceForPlay(p: SynthParams): SynthParams {
  if (p.play.mode === "glide" && p.voice === "poly") return { ...p, voice: "legato", glide: p.glide > 0 ? p.glide : 0.35 };
  if (p.play.mode === "drone" && p.voice !== "poly") return { ...p, voice: "poly" };
  return p;
}

/** Play written notes the way the settings say. */
export function playNotes(notes: PlayNote[], play: PlaySettings, ctx: PlayContext): SynthNote[] {
  let out: SynthNote[];
  switch (play.mode) {
    case "arp":
      out = arp(notes, play, ctx);
      break;
    case "strum":
      out = strum(notes, play);
      break;
    case "pulse":
      out = pulse(notes, play, ctx);
      break;
    case "drone":
      out = drone(notes, ctx);
      break;
    case "glide":
      out = glide(notes, ctx);
      break;
    default:
      out = sustain(notes);
  }
  return humanise(out, play.humanise, ctx.seed ?? 1);
}
