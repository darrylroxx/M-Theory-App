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
