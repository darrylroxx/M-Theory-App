/**
 * A melody: single notes tapped onto a grid, one grid per song section.
 *
 * Time is kept in twelfths of a beat, so the same notes fit a grid of beats, halves, triplets
 * or quarters without being moved. The grid shows two octaves starting on the key's home note.
 */
import type { Key } from "../theory/keys";
import { spellInKey } from "../theory/keys";
import { mod12, pc } from "../theory/notes";
import { getScale, scalePcs } from "../theory/scales";

/** Twelfths of a beat. */
export const TICKS = 12;
export const MELODY_MAX_BARS = 16;

export interface MelodyNote {
  /** when it sounds, in twelfths of a beat from the start of the section */
  at: number;
  midi: number;
}

export interface Melody {
  /** steps to a beat on the grid */
  div: 1 | 2 | 3 | 4;
  /** how many bars long it is before it comes round again */
  bars: number;
  notes: MelodyNote[];
  /** false = kept but not played */
  on?: boolean;
}

export const EMPTY_MELODY: Melody = { div: 2, bars: 2, notes: [] };
export const GRIDS: { value: Melody["div"]; label: string; hint: string }[] = [
  { value: 1, label: "♩", hint: "One step to a beat" },
  { value: 2, label: "♪", hint: "Two steps to a beat (eighth notes)" },
  { value: 3, label: "♪3", hint: "Three steps to a beat (triplets)" },
  { value: 4, label: "♬", hint: "Four steps to a beat (sixteenth notes)" },
];

export const melodyBars = (m: Melody) => Math.max(1, Math.min(MELODY_MAX_BARS, Math.round(m.bars || 1)));
/** How long the melody is, in beats. */
export const melodyBeats = (m: Melody, bar: number) => melodyBars(m) * bar;
/** Is there anything to play? */
export const hasTune = (m: Melody | null | undefined): m is Melody => !!m && m.on !== false && m.notes.length > 0;

/** The time of a grid cell, in ticks. */
export const cellTick = (m: Melody, bar: number, barIndex: number, step: number) => Math.round((barIndex * bar + step / m.div) * TICKS);
/** The notes that fall inside one grid cell (a cell on a coarse grid also holds the finer notes within it). */
export function notesInCell(m: Melody, tick: number, midi: number): MelodyNote[] {
  const size = TICKS / m.div;
  return m.notes.filter((n) => n.midi === midi && n.at >= tick && n.at < tick + size);
}

/** Tap a cell: put a note there, or take away what is there. */
export function toggleNote(m: Melody, tick: number, midi: number): Melody {
  const there = notesInCell(m, tick, midi);
  const notes = there.length ? m.notes.filter((n) => !there.includes(n)) : [...m.notes, { at: tick, midi }].sort((a, b) => a.at - b.at || a.midi - b.midi);
  return { ...m, notes, on: true };
}

/** Empty the whole melody, or one bar of it. */
export function clearMelody(m: Melody, bar: number, barIndex?: number): Melody {
  if (barIndex === undefined) return { ...m, notes: [] };
  const from = barIndex * bar * TICKS;
  return { ...m, notes: m.notes.filter((n) => n.at < from || n.at >= from + bar * TICKS) };
}

/** Make the melody longer (the new bars are empty) or shorter (notes past the end are dropped). */
export function setMelodyBars(m: Melody, bars: number, bar: number): Melody {
  const n = Math.max(1, Math.min(MELODY_MAX_BARS, Math.round(bars)));
  return { ...m, bars: n, notes: m.notes.filter((x) => x.at < n * bar * TICKS) };
}

/** Copy one bar's notes onto another. */
export function copyMelodyBar(m: Melody, bar: number, from: number, to: number): Melody {
  const size = bar * TICKS;
  const kept = m.notes.filter((n) => n.at < to * size || n.at >= (to + 1) * size);
  const copied = m.notes.filter((n) => n.at >= from * size && n.at < (from + 1) * size).map((n) => ({ ...n, at: n.at + (to - from) * size }));
  return { ...m, notes: [...kept, ...copied].sort((a, b) => a.at - b.at || a.midi - b.midi) };
}

/** Move every note up or down by semitones (a key change), staying inside what the grid can show. */
export function transposeMelody(m: Melody, semitones: number): Melody {
  return { ...m, notes: m.notes.map((n) => ({ ...n, midi: n.midi + semitones })) };
}

export interface MelodyRow {
  midi: number;
  /** the note's name in this key */
  name: string;
  /** it belongs to the key's scale */
  inKey: boolean;
  /** it is the key's home note */
  home: boolean;
}

/** The lowest note of the grid: the key's home note nearest middle C. */
export const melodyBase = (key: Key): number => {
  const p = pc(key.tonic);
  return p <= 8 ? 60 + p : 48 + p;
};

/** The grid's rows, highest first: two octaves from the home note. With `keyOnly`, just the notes of the scale. */
export function melodyRows(key: Key, keyOnly = false): MelodyRow[] {
  const base = melodyBase(key);
  const tonic = pc(key.tonic);
  const set = new Set(scalePcs(tonic, getScale(key.scaleId)));
  const rows: MelodyRow[] = [];
  for (let midi = base + 24; midi >= base; midi--) {
    const p = mod12(midi);
    const inKey = set.has(p);
    if (keyOnly && !inKey) continue;
    rows.push({ midi, name: spellInKey(p, key), inKey, home: p === tonic });
  }
  return rows;
}

export interface TuneHit {
  /** beats from the start of the section */
  beat: number;
  midi: number;
}

/**
 * The notes that sound between two moments of a section (in beats). The melody comes round
 * again when it is shorter than the section. `swing` delays every second sixteenth, as the drums do.
 */
export function tuneBetween(m: Melody, bar: number, from: number, to: number, swing = 0): TuneHit[] {
  const len = melodyBeats(m, bar) * TICKS;
  if (len <= 0 || !m.notes.length) return [];
  const out: TuneHit[] = [];
  for (let t = Math.ceil(from * TICKS - 1e-6); t < to * TICKS - 1e-6; t++) {
    const pos = ((t % len) + len) % len;
    for (const n of m.notes) {
      if (n.at !== pos) continue;
      const late = swing && pos % 3 === 0 && (pos / 3) % 2 === 1 ? swing / 12 : 0;
      out.push({ beat: t / TICKS + late, midi: n.midi });
    }
  }
  return out;
}

/** A melody loaded from storage, made safe. */
export function reviveMelody(raw: unknown): Melody | undefined {
  const m = raw as Partial<Melody> | null | undefined;
  if (!m || typeof m !== "object" || !Array.isArray(m.notes)) return undefined;
  const div = m.div === 1 || m.div === 3 || m.div === 4 ? m.div : 2;
  const bars = Math.max(1, Math.min(MELODY_MAX_BARS, Math.round(Number(m.bars) || 2)));
  const notes = m.notes
    .filter((n): n is MelodyNote => !!n && Number.isInteger(n.at) && n.at >= 0 && Number.isInteger(n.midi) && n.midi >= 24 && n.midi <= 108)
    .map((n) => ({ at: n.at, midi: n.midi }));
  return { div, bars, notes, ...(m.on === false ? { on: false } : {}) };
}
