/**
 * The exact notes a chord plays, when Harmonize wrote them (`ProgChord.notes`): a chords track
 * written to sit above another plays those notes, on any instrument, instead of its stock shape.
 * They are honest only while every one belongs to the chord: a chord changed by hand to one that
 * does not hold them is voiced as usual again.
 */
import type { ProgChord } from "../ui/state";
import { getChordType, findChordType, type ChordRef } from "../theory/chords";
import { semitonesOf } from "../theory/intervals";
import { mod12, pc } from "../theory/notes";
import { transposeRef, type Key } from "../theory/keys";

const pcsOfRef = (ref: ChordRef): number[] => {
  const t = findChordType(ref.typeId);
  if (!t) return [];
  const r = pc(ref.root);
  return [...getChordType(t.id).intervals.map((iv) => mod12(r + semitonesOf(iv))), ...(ref.bass ? [pc(ref.bass)] : [])];
};

/** The notes a chord plays as written (undefined: none written, or no longer its chord's). */
export function playedNotes(c: Pick<ProgChord, "ref" | "rest" | "notes">): number[] | undefined {
  if (c.rest || !c.notes?.length) return undefined;
  try {
    const pcs = pcsOfRef(c.ref);
    return c.notes.every((m) => pcs.includes(mod12(m))) ? c.notes : undefined;
  } catch {
    return undefined;
  }
}

/** Written notes loaded from storage: whole MIDI notes 36–96, each once, low to high, one to six of them (else none). */
export function reviveNotes(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ns = [...new Set(raw.filter((m): m is number => Number.isInteger(m) && m >= 36 && m <= 96))].sort((a, b) => a - b);
  return ns.length >= 1 && ns.length <= 6 && ns.length === raw.length ? ns : undefined;
}

/** A chord with its written notes moved with it (by semitones), kept inside the range written notes may have (moved by octaves). */
export const shiftNotes = (c: ProgChord, n: number): ProgChord => {
  if (!c.notes || !n) return c;
  let ns = c.notes.map((m) => m + n);
  while (Math.max(...ns) > 96) ns = ns.map((m) => m - 12);
  while (Math.min(...ns) < 36) ns = ns.map((m) => m + 12);
  return { ...c, notes: ns };
};
/**
 * A chord moved by `n` semitones into `key` (the song moved, or chords pasted from another key):
 * its name re-spelled, its written notes moved with it the nearest way (at most a tritone, so a
 * layer stays where it sat over the chords under it), and any shape pinned by hand let go.
 */
export function transposeChord(c: ProgChord, n: number, key: Key): ProgChord {
  const d = (((n % 12) + 18) % 12) - 6;
  return { ...shiftNotes(c, d), ref: transposeRef(c.ref, n, key), voicingId: undefined };
}
/** A chord taken over by hand (another chord, another shape): its written notes go. */
export const withoutNotes = (c: ProgChord): ProgChord => {
  if (!c.notes) return c;
  const { notes: _, ...rest } = c;
  return rest;
};
