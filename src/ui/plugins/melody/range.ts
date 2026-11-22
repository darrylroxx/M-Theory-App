// Where the note grid of the Melody and Bass composer stands, as plain arithmetic. The grid has every row from the
// lowest note a melody may hold to the highest (seven octaves), and only some of them fit in the window: these say
// which rows are in view when a clip is opened, where one press of "an octave up" or "an octave down" leaves the
// view, and where a note lies on the small overview of the whole range. Nothing here touches the screen.
import { GRID_HIGH, GRID_LOW, melodyBase, type MelodyNote, type MelodyRow } from "../../../song/melody";
import type { Key } from "../../../theory/keys";

/** How many octaves the grid has: all a melody may hold. */
export const GRID_OCTAVES = (GRID_HIGH - GRID_LOW) / 12;
/** The lowest string of a bass: E1. */
export const BASS_LOW = 28;

/** A stretch of notes, lowest and highest. */
export interface Span { low: number; high: number }

/** What a clip with no notes opens on: a bass on E1 to E3, a melody on the two octaves from the key's home note. */
export function emptySpan(bass: boolean, key: Key): Span {
  const low = bass ? BASS_LOW : melodyBase(key);
  return { low, high: Math.min(GRID_HIGH, low + 24) };
}

/** From the lowest to the highest of some notes (null: there are none). */
export function spanOf(notes: readonly MelodyNote[]): Span | null {
  if (!notes.length) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const n of notes) {
    if (n.midi < low) low = n.midi;
    if (n.midi > high) high = n.midi;
  }
  return { low, high };
}

/**
 * Which row a note is on (rows are highest first). A note that has no row of its own (the rows of the key only)
 * counts as the nearest row under it, or the lowest row there is.
 */
export function rowAt(rows: readonly MelodyRow[], midi: number): number {
  for (let i = 0; i < rows.length; i++) if (rows[i].midi <= midi) return i;
  return Math.max(0, rows.length - 1);
}

/** The first row in view may be anything from the top row to the one that leaves the last row at the bottom. */
export const clampTop = (rows: readonly MelodyRow[], top: number, inView: number): number => Math.max(0, Math.min(Math.max(0, rows.length - Math.max(1, Math.floor(inView))), Math.round(top)));

/**
 * The first row in view when something is opened, in a view `inView` rows tall. With notes: they stand in the
 * middle; when they reach further than the view, the middle one of them does. With none: `empty` stands in the
 * middle, or, when it is taller than the view, its lowest note is the bottom row (a bass starts on its low E).
 */
export function openTop(rows: readonly MelodyRow[], notes: readonly MelodyNote[], empty: Span, inView: number): number {
  const n = Math.max(1, Math.floor(inView));
  const own = spanOf(notes);
  const span = own ?? empty;
  const hi = rowAt(rows, span.high);
  const lo = rowAt(rows, span.low);
  const tall = lo - hi + 1;
  if (tall <= n) return clampTop(rows, hi - Math.floor((n - tall) / 2), n);
  if (!own) return clampTop(rows, lo - n + 1, n);
  const sorted = notes.map((x) => x.midi).sort((a, b) => a - b);
  const mid = sorted[Math.floor((sorted.length - 1) / 2)];
  return clampTop(rows, rowAt(rows, mid) - Math.floor(n / 2), n);
}

/**
 * One press of "an octave up" (1) or "an octave down" (-1): the first row in view becomes the row of the note twelve
 * semitones away from the one that is first now. With every row shown that is twelve rows; with the rows of the key
 * only, as many rows as the scale has notes.
 */
export function octaveTop(rows: readonly MelodyRow[], top: number, dir: 1 | -1, inView: number): number {
  if (!rows.length) return 0;
  const from = rows[Math.max(0, Math.min(rows.length - 1, Math.round(top)))].midi;
  const to = from + 12 * dir;
  return clampTop(rows, to >= rows[0].midi ? 0 : rowAt(rows, to), inView);
}

/** The first row in view that puts a row in the middle (a press on the overview). */
export const centreTop = (rows: readonly MelodyRow[], row: number, inView: number): number => clampTop(rows, row - Math.floor(inView) / 2 + 0.5, inView);

/** Is a note on a row that is in view (wholly), when `top` is the first row in view and `inView` rows fit? */
export function rowInView(rows: readonly MelodyRow[], midi: number, top: number, inView: number): boolean {
  const i = rowAt(rows, midi);
  return rows[i]?.midi === midi && i >= top - 1e-6 && i + 1 <= top + inView + 1e-6;
}

/** The octave a note is in, as it is written after its name (middle C is C4). */
export const octaveOf = (midi: number): number => Math.floor(midi / 12) - 1;
