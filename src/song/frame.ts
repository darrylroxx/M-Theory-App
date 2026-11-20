/**
 * The frame of a section: how long it lasts.
 *
 * A section is a row of bars, as many as it is set to. Its chords, its melody and its drums are
 * all written into those bars: a bar with something in it plays, an empty bar is silent, and
 * nothing comes round again on its own. Whatever runs past the last bar is cut off there.
 */

export const MAX_SECTION_BARS = 32;
/** How long a section is until someone says otherwise. */
export const DEFAULT_BARS = 4;
/** The lengths offered at a tap. */
export const QUICK_BARS = [1, 2, 4, 8, 12, 16, 24, 32];

/** A length someone asked for, made safe: whole bars, 1 to 32. Anything else means "not set". */
export function fitBars(n: unknown): number | undefined {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 1 ? Math.min(MAX_SECTION_BARS, v) : undefined;
}

/** A section's length in bars: what it is set to, or four. */
export const barsOr = (n: unknown): number => fitBars(n) ?? DEFAULT_BARS;

/**
 * How long a section used to last, in beats, before sections had lengths: its chords, played again until the
 * drum rhythm and the melody have both finished. With no chords, the longer of the two
 * (the melody rounded up to whole rounds of the rhythm).
 */
export function autoBeats(chordBeats: number, drumBeats: number, tuneBeats: number): number {
  if (chordBeats > 0) return Math.max(1, Math.ceil(Math.max(drumBeats, tuneBeats) / chordBeats - 1e-6)) * chordBeats;
  return tuneBeats && drumBeats ? Math.ceil(tuneBeats / drumBeats - 1e-6) * drumBeats : Math.max(drumBeats, tuneBeats);
}

/** How long a section lasts, in beats. */
export const frameBeats = (bars: number | undefined, bar: number): number => barsOr(bars) * bar;

/**
 * A section's chords, as they play: once, in order, and the one sounding when the section ends
 * is cut short (any after it are never reached). `index` is the chord's place in the list given.
 */
export function inFrame<T extends { beats: number }>(chords: T[], length: number): { item: T; index: number }[] {
  const out: { item: T; index: number }[] = [];
  let at = 0;
  for (let i = 0; i < chords.length && at < length - 1e-6; i++) {
    const left = length - at;
    out.push({ item: left < chords[i].beats - 1e-6 ? { ...chords[i], beats: left } : chords[i], index: i });
    at += chords[i].beats;
  }
  return out;
}

/** Which of a section's chords is sounding `beat` beats into it (as inFrame plays them): -1 for none (past the last, or out of the section). */
export function chordAt(chords: { beats: number }[], beat: number, length: number): number {
  if (!(beat >= 0) || beat >= length - 1e-6) return -1;
  let at = 0;
  for (let i = 0; i < chords.length; i++) {
    at += chords[i].beats;
    if (beat < at - 1e-6) return i;
  }
  return -1;
}

/**
 * Chords coming round again until a length is filled, the last one cut short. This is how
 * sections played before they had lengths; it is used to write those repeats out in full.
 */
export function frameItems<T extends { beats: number }>(once: T[], length: number): { item: T; index: number }[] {
  const out: { item: T; index: number }[] = [];
  if (!once.length || !(once.reduce((a, x) => a + x.beats, 0) > 0)) return out;
  let at = 0;
  for (let i = 0; at < length - 1e-6 && out.length < 4096; i++) {
    const item = once[i % once.length];
    const left = length - at;
    out.push({ item: left < item.beats - 1e-6 ? { ...item, beats: left } : item, index: i % once.length });
    at += item.beats;
  }
  return out;
}

/** "4", "2½", "1.3": a length in bars, as short as it can be written. */
export function barsText(beats: number, bar: number): string {
  const n = bar > 0 ? beats / bar : 0;
  const r = Math.round(n * 100) / 100;
  if (Number.isInteger(r)) return String(r);
  if (Math.abs((r % 1) - 0.5) < 1e-6) return `${Math.floor(r) || ""}½`;
  return r.toFixed(1);
}

/** One step shorter or longer than a length in beats, in whole bars. */
export function stepBars(beats: number, bar: number, dir: -1 | 1): number {
  const n = bar > 0 ? beats / bar : 1;
  const next = dir < 0 ? Math.ceil(n - 1e-6) - 1 : Math.floor(n + 1e-6) + 1;
  return Math.max(1, Math.min(MAX_SECTION_BARS, next));
}

/**
 * The part of a section that lies between two moments (in beats from its start): items are cut
 * where the range cuts them, and each says how far into the section it starts.
 */
export function sliceItems<T extends { beats: number }>(items: T[], from: number, to: number): { item: T; index: number; from: number }[] {
  const out: { item: T; index: number; from: number }[] = [];
  let at = 0;
  items.forEach((item, index) => {
    const a = Math.max(at, from);
    const b = Math.min(at + item.beats, to);
    if (b - a > 1e-6) out.push({ item: b - a < item.beats - 1e-6 ? { ...item, beats: b - a } : item, index, from: a });
    at += item.beats;
  });
  return out;
}

/** One bar of the song: which section it is in, and which of that section's bars it is (0 = the first). */
export interface BarRef {
  block: string;
  bar: number;
}
/** The bars that go round and round: from one bar to another, both included. They may be in different sections. */
export interface LoopSpan {
  from: BarRef;
  to: BarRef;
}
type Layout = { block: string; bars: number }[];

/** A bar's place in the whole song, counting bars from 0 (−1 = no such bar). */
export function barIndex(layout: Layout, ref: BarRef): number {
  let n = 0;
  for (const s of layout) {
    if (s.block === ref.block) return n + Math.max(0, Math.min(s.bars - 1, ref.bar));
    n += s.bars;
  }
  return -1;
}

/** A loop made to fit the song as it is now: bars that no longer exist are let go, and it runs forwards. Null if it has nothing left. */
export function fitLoop(layout: Layout, span: LoopSpan | null): LoopSpan | null {
  if (!span) return null;
  const a = barIndex(layout, span.from);
  const b = barIndex(layout, span.to);
  if (a < 0 || b < 0) return null;
  const clamp = (r: BarRef): BarRef => ({ block: r.block, bar: Math.max(0, Math.min((layout.find((s) => s.block === r.block)?.bars ?? 1) - 1, r.bar)) });
  return a <= b ? { from: clamp(span.from), to: clamp(span.to) } : { from: clamp(span.to), to: clamp(span.from) };
}

/**
 * Tap bars to build a loop. A bar outside the loop is added, and so is everything between it and
 * the loop (a loop is one unbroken run of bars, across sections too): tap 1, 2, 3 and three bars
 * loop; tap 1 then 8 and all eight do. A bar at either end of the loop is taken off again. A bar
 * in the middle becomes the whole loop. Taking off the last bar lets the loop go.
 */
export function tapLoop(layout: Layout, span: LoopSpan | null, bar: BarRef): LoopSpan | null {
  const at = barIndex(layout, bar);
  const now = fitLoop(layout, span);
  if (at < 0) return now;
  if (!now) return { from: bar, to: bar };
  const a = barIndex(layout, now.from);
  const b = barIndex(layout, now.to);
  if (at < a) return { from: bar, to: now.to };
  if (at > b) return { from: now.from, to: bar };
  if (a === b) return null;
  if (at === a) return { from: barAt(layout, a + 1)!, to: now.to };
  if (at === b) return { from: now.from, to: barAt(layout, b - 1)! };
  return { from: bar, to: bar };
}

/** The bar at a place in the whole song, counting from 0. */
export function barAt(layout: Layout, index: number): BarRef | null {
  let n = index;
  for (const s of layout) {
    if (n < s.bars) return n < 0 ? null : { block: s.block, bar: n };
    n -= s.bars;
  }
  return null;
}

/** Loop every bar of one section. */
export const loopSection = (block: string, bars: number): LoopSpan => ({ from: { block, bar: 0 }, to: { block, bar: Math.max(0, bars - 1) } });

/** Is a bar inside the loop? */
export function inLoop(layout: Layout, span: LoopSpan | null, ref: BarRef): boolean {
  if (!span) return false;
  const i = barIndex(layout, ref);
  return i >= barIndex(layout, span.from) && i <= barIndex(layout, span.to);
}
