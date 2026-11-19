/**
 * Ways of playing: the chords and notes as written go in, the notes the synth should play come
 * out. Pure functions of their input (randomness comes from a seed), so the same song always
 * plays the same way, live and in a render.
 *
 * Times are in seconds, like the audio clock; `bpm` (and `origin`, where beat 1 falls) are only
 * needed to turn musical step sizes (1/16, 1/8 triplets…) into seconds.
 *
 * Modes, after the research notes: Sustain (as written), Arp (up, down, up-down, as written,
 * converge, diverge, thumb and pinky pedals, crawl, chord, random; 1/4 to 1/32, dotted and
 * triplet; 1 to 4 octaves moving up, down or both ways; gate, swing, a rhythm of steps with
 * accents, and repeats), Strum (spread and direction), Pulse
 * (the chord struck again on a rhythm), Drone (the home note and its fifth held under everything,
 * with a slow-moving voice above that follows the chords) and Glide (one line, notes joined so a
 * legato synth slides between them). Humanise loosens the timing and the touch of any of them.
 */
import { type ArpPattern, type OctMove, type PlaySettings, type Rate, type StrumDir, type SynthParams, SWING_MAX } from "./params";

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
  /** the key's home note as a pitch class (0 = C) for the drone; default: the first chord's root */
  tonic?: number;
  /** beats in a bar, counted from `origin`: an arp's swing starts again at each one, its rhythm of steps at the first one after it has played through (0 or missing: they run on) */
  bar?: number;
}

/** The length of one step, in beats. */
export function rateBeats(rate: Rate): number {
  // a quarter note is one beat; "D" makes it half as long again, "T" fits three in the time of two
  const m = /^1\/(\d+)([DT]?)$/.exec(rate);
  const base = m ? 4 / Number(m[1]) : 0.25;
  return m?.[2] === "D" ? base * 1.5 : m?.[2] === "T" ? (base * 2) / 3 : base;
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

/**
 * One pass of a pattern over a pool of notes. `up` is the pool low to high, `played` the same
 * notes in the order they were written (or the keys pressed); `base` and `octaves` are what the
 * crawl needs to climb past the top of the pool.
 */
function walk(up: number[], played: number[], pattern: ArpPattern, rand: () => number, base: number[], octaves: number): number[] {
  const n = up.length;
  switch (pattern) {
    case "up":
    case "chord":
      return up;
    case "down":
      return [...up].reverse();
    case "updown":
      return n > 2 ? [...up, ...up.slice(1, -1).reverse()] : up;
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
      const w = base.length;
      const ext = [...up, ...base.map((p) => p + 12 * octaves)];
      const out: number[] = [];
      for (let i = 0; i + w <= ext.length; i++) out.push(...ext.slice(i, i + w));
      return out;
    }
    case "played":
      return played;
    case "converge": {
      // from the outside in: lowest, highest, next lowest, next highest…
      const out: number[] = [];
      for (let i = 0, j = n - 1; i <= j; i++, j--) out.push(...(i === j ? [up[i]] : [up[i], up[j]]));
      return out;
    }
    case "diverge": {
      // from the middle out: the middle note, then one above, one below, and so on
      const out: number[] = [];
      const m = Math.floor((n - 1) / 2);
      out.push(up[m]);
      for (let d = 1; out.length < n; d++) {
        if (m + d < n) out.push(up[m + d]);
        if (m - d >= 0) out.push(up[m - d]);
      }
      return out;
    }
    case "thumb": {
      // the lowest note between each of the others, as a thumb holding a pedal note
      if (n < 3) return up;
      const out: number[] = [];
      for (let i = 1; i < n; i++) out.push(up[0], up[i]);
      return out;
    }
    case "pinky": {
      // the highest note between each of the others
      if (n < 3) return [...up].reverse();
      const out: number[] = [];
      for (let i = 0; i < n - 1; i++) out.push(up[n - 1], up[i]);
      return out;
    }
  }
}

/** The order the octaves come in, one pass of the pattern each: up, down from the top, or up and back. */
export function octaveOrder(move: OctMove, octaves: number): number[] {
  const up = Array.from({ length: Math.max(1, octaves) }, (_, i) => i);
  if (move === "down") return up.reverse();
  if (move === "bounce") return [...up, ...up.slice(1, -1).reverse()];
  return up;
}

/**
 * The order an arpeggio walks a chord's notes over `octaves`, one time round. `pitches` in the
 * order written (or pressed), which only the "played" pattern listens to. "chord" is handled by
 * the caller (it strikes them all at once). With `move` "span" the pattern runs over the whole
 * range at once; otherwise it runs in one octave and that pass is moved through the octaves.
 */
export function arpOrder(pitches: number[], pattern: ArpPattern, octaves: number, rand: () => number = Math.random, move: OctMove = "span"): number[] {
  const played = [...new Set(pitches)];
  const base = [...played].sort((a, b) => a - b);
  if (base.length === 0) return [];
  if (move === "span" || octaves <= 1) {
    const up: number[] = [];
    const inOrder: number[] = [];
    for (let o = 0; o < octaves; o++) {
      for (const p of base) up.push(p + 12 * o);
      for (const p of played) inOrder.push(p + 12 * o);
    }
    return walk(up, inOrder, pattern, rand, base, octaves);
  }
  const out: number[] = [];
  // (a random pass is shuffled afresh in each octave)
  for (const o of octaveOrder(move, octaves)) out.push(...walk(base, played, pattern, rand, base, 1).map((p) => p + 12 * o));
  return out;
}

/** The arpeggiator's settings (the ones the newer controls added may be left out: they then play as before). */
export interface ArpSettings {
  pattern: ArpPattern;
  rate: Rate;
  octaves: number;
  gate: number;
  octMove?: OctMove;
  swing?: number;
  rhythm?: string;
  ratchet?: number;
}

/** How much harder an accented step ("X") is struck, and how much softer the plain steps of a rhythm that has accents are. */
export const ACCENT = 1.25;
export const UNACCENTED = 0.8;

/**
 * One step of the arp's clock, `index` steps into the rhythm (or into the run of keys): how late
 * it falls for the swing, how long it lasts (a swung pair still adds up to two steps), and whether
 * it plays: 0 rests, 1 plays, 2 plays accented. `inBar`: how many steps into its bar it is, which
 * is what the swing counts (the rhythm may run over more than one bar); the same as `index` if left out.
 */
export function arpStep(index: number, step: number, o: { swing?: number; rhythm?: string }, inBar = index): { shift: number; dur: number; hit: 0 | 1 | 2 } {
  // the whole knob is three quarters: half way (0.375) pushes the second step a quarter of a step, to the triplet lilt
  const sh = (Math.max(0, Math.min(SWING_MAX, o.swing ?? 0)) * 2 * step) / 3;
  const odd = inBar % 2 === 1;
  const r = o.rhythm ?? "";
  const c = r ? r[index % r.length] : "x";
  return { shift: odd ? sh : 0, dur: odd ? step - sh : step + sh, hit: c === "X" ? 2 : c === "x" ? 1 : 0 };
}

/** How far (in steps, counting from 0) a moment falls into a stretch of `bar` beats that starts again and again from `origin`. */
function stepIndex(t: number, origin: number, spb: number, step: number, bar: number): number {
  let beats = (t - origin) / spb;
  if (bar > 0) beats -= Math.floor(beats / bar + 1e-6) * bar;
  return Math.max(0, Math.floor((beats * spb) / step + 1e-6));
}

/**
 * Arpeggio: each chord's notes one after another at `rate`, starting again at every chord. A
 * rhythm of steps rests some and leans on others (a rest does not use up a note: the next step
 * that plays takes it), swing pushes every second step late, and a ratchet strikes each step
 * more than once.
 */
export function arp(notes: PlayNote[], o: ArpSettings, ctx: PlayContext): SynthNote[] {
  const chords = chordsOf(notes);
  const spb = beatSec(ctx.bpm);
  const step = rateBeats(o.rate) * spb;
  const gate = Math.max(0.05, Math.min(1, o.gate));
  const octaves = Math.max(1, Math.min(4, Math.round(o.octaves)));
  const move = o.octMove ?? "span";
  const reps = Math.max(1, Math.min(4, Math.round(o.ratchet ?? 1)));
  const accents = /X/.test(o.rhythm ?? "");
  const rand = rng((ctx.seed ?? 1) ^ 0xa5a5);
  const origin = ctx.origin ?? 0;
  const octs = octaveOrder(move === "span" ? "up" : move, octaves);
  // the rhythm starts again on the first bar line after it has played through, so it keeps in step
  // with the bars and every step of it is heard, even one longer than a bar (16 eighths in 4/4: two bars)
  const bar = ctx.bar ?? 0;
  const rlen = (o.rhythm ?? "").length;
  const phrase = bar > 0 && rlen ? Math.max(1, Math.ceil((rlen * rateBeats(o.rate)) / bar - 1e-6)) * bar : bar;
  // the order the notes were written in, for the "played" pattern
  const written = new Map(notes.map((n, i) => [n, i]));
  const out: SynthNote[] = [];
  chords.forEach((c, ci) => {
    const [start, end] = spanOf(chords, ci);
    const vel = Math.max(...c.map((n) => n.velocity));
    const pitches = [...c].sort((a, b) => (written.get(a) ?? 0) - (written.get(b) ?? 0)).map((n) => n.midi);
    let seq = arpOrder(pitches, o.pattern, octaves, rand, move);
    if (seq.length === 0) return;
    const base = [...new Set(c.map((n) => n.midi))].sort((a, b) => a - b);
    let played = 0;
    for (let k = 0; ; k++) {
      const t = start + k * step;
      if (t >= end - 1e-6) break;
      const s = arpStep(stepIndex(t, origin, spb, step, phrase), step, o, stepIndex(t, origin, spb, step, bar));
      if (s.hit === 0) continue;
      const at = t + s.shift;
      if (at >= end - 1e-6) continue;
      // a little weight on the beat (and more on an accented step)
      const beatPos = (t - origin) / spb;
      const lean = Math.abs(beatPos - Math.round(beatPos)) < 1e-3 ? 1 : 0.82;
      const v = s.hit === 2 ? Math.min(1, vel * ACCENT) : vel * lean * (accents ? UNACCENTED : 1);
      let midis: number[];
      if (o.pattern === "chord") midis = base.map((p) => p + 12 * octs[played % octs.length]);
      else {
        if (o.pattern === "random" && played > 0 && played % seq.length === 0) seq = arpOrder(pitches, "random", octaves, rand, move);
        midis = [seq[played % seq.length]];
      }
      played++;
      const sub = s.dur / reps;
      for (let r = 0; r < reps; r++) {
        const ts = at + r * sub;
        if (ts >= end - 1e-6) break;
        const len = Math.min(sub * gate, end - ts);
        // the repeats of a ratchet a touch softer than the strike they repeat
        for (const m of midis) out.push({ midi: m, start: ts, length: len, velocity: r ? v * 0.9 : v });
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
 * The root of a chord as written, by ear: the note with a fifth and a third (or a fourth or
 * second, for a sus chord) above it in the chord. A keyboard voicing is often an inversion
 * (C as E G C), so the lowest note is not always the root; with no such note it is.
 */
export function rootOf(chord: PlayNote[]): number {
  const pcs = [...new Set(chord.map((n) => ((n.midi % 12) + 12) % 12))];
  const has = (r: number, iv: number) => pcs.includes((r + iv) % 12);
  const score = (r: number) => (has(r, 7) ? 2 : 0) + (has(r, 3) || has(r, 4) ? 1 : has(r, 5) || has(r, 2) ? 0.5 : 0);
  const low = ((chord[0].midi % 12) + 12) % 12;
  let best = low;
  for (const r of pcs) if (score(r) > score(best)) best = r;
  return best;
}

/**
 * Drone: the home note, its fifth and its octave held under the whole passage, low down; above
 * them one quieter voice moves to each chord's root as the chords change (slowly, if the sound
 * has a slow attack), so the drone keeps evolving.
 */
export function drone(notes: PlayNote[], ctx: PlayContext): SynthNote[] {
  const chords = chordsOf(notes);
  if (chords.length === 0) return [];
  const first = chords[0][0];
  const tonic = ctx.tonic ?? rootOf(chords[0]);
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
    const pc = rootOf(c);
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

/** The least sustain a drone is played with: a drone is held, so a sound that dies away is kept sounding. */
export const DRONE_SUSTAIN = 0.6;

/**
 * The voice a way of playing needs: Glide joins notes, so it needs a legato voice (with some
 * portamento if the sound has none); a Drone holds several notes at once, so it needs a poly one,
 * and it must keep sounding (a pluck or a bell chosen as a drone would otherwise fade to nothing
 * long before the passage ends).
 */
export function voiceForPlay(p: SynthParams): SynthParams {
  if (p.play.mode === "glide" && p.voice === "poly") return { ...p, voice: "legato", glide: p.glide > 0 ? p.glide : 0.35 };
  if (p.play.mode === "drone" && (p.voice !== "poly" || p.sustain < DRONE_SUSTAIN)) return { ...p, voice: "poly", sustain: Math.max(p.sustain, DRONE_SUSTAIN) };
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
