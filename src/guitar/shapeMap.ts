/**
 * The shape map: every way to play a chord, organised the way a guitarist looks
 * for one. Columns run up the neck; rows are the note in the bass (the inversion).
 * Each cell holds the shapes for that spot, best first.
 */
import type { ChordType } from "../theory/chords";
import type { Voicing } from "./voicings";

export const POSITIONS = ["Open", "1–3", "4–6", "7–9", "10–12", "13+"] as const;

/** Which column a shape belongs to: where the hand sits on the neck. */
export function positionOf(v: Voicing): number {
  if (v.minFret === 0) return 0; // nothing fretted
  if (v.openStrings > 0 && v.maxFret <= 4) return 0; // classic open chord
  const f = v.minFret;
  return f <= 3 ? 1 : f <= 6 ? 2 : f <= 9 ? 3 : f <= 12 ? 4 : 5;
}

export interface ShapeFilters {
  /** how many strings ring: any, exactly 3, exactly 4, or 5 and more */
  strings: "any" | 3 | 4 | 5;
  noBarre: boolean;
  open: boolean;
}

export interface ShapeRow {
  /** interval of the bass note ("1", "3", "b7" …) or "bass" for a slash chord */
  token: string;
  /** one list per neck position, best shape first */
  cells: Voicing[][];
}

const sounding = (v: Voicing) => v.frets.filter((f) => f !== null).length;
const bassString = (v: Voicing) => v.frets.findIndex((f) => f !== null);

/** a is b with some strings left out (same bass string, same frets where both sound) */
function isCutDown(a: Voicing, b: Voicing): boolean {
  if (a === b || sounding(a) >= sounding(b) || bassString(a) !== bassString(b)) return false;
  return a.frets.every((f, s) => f === null || f === b.frets[s]);
}

export function buildShapeMap(all: Voicing[], type: ChordType, filters: ShapeFilters, keepId?: string): ShapeRow[] {
  const tokens = [...new Set(all.map((v) => v.bassToken))].sort((a, b) => {
    const ia = type.intervals.indexOf(a);
    const ib = type.intervals.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const rows: ShapeRow[] = tokens.map((token) => ({ token, cells: POSITIONS.map(() => []) }));
  for (const v of all) {
    const n = sounding(v);
    if (filters.strings === 3 && n !== 3) continue;
    if (filters.strings === 4 && n !== 4) continue;
    if (filters.strings === 5 && n < 5) continue;
    if (filters.noBarre && v.barreKind === "full" && v.id !== keepId) continue;
    if (filters.open && v.openStrings === 0 && v.id !== keepId) continue;
    rows[tokens.indexOf(v.bassToken)].cells[positionOf(v)].push(v);
  }
  // With no size chosen, show each grip once: hide shapes that are just a bigger
  // shape with strings left out (pick "3" or "4" strings to see those).
  if (filters.strings === "any") {
    for (const row of rows) row.cells = row.cells.map((cell) => cell.filter((v) => v.id === keepId || !cell.some((w) => isCutDown(v, w))));
  }
  return rows;
}
