/**
 * The shape book: the ways guitarists actually play a chord, starting from the
 * shapes everybody knows and branching out from there.
 *
 * The voicing generator finds every combination of chord tones a hand could
 * possibly hold, which includes hundreds of grips nobody uses. This module keeps
 * only shapes that follow the standard families taught for the instrument:
 *
 *  - open chords at the nut
 *  - the two movable barre shapes (root on the 6th string = "E shape",
 *    root on the 5th string = "A shape")
 *  - small shapes: triads on three neighbouring strings and four-string shapes
 *    (the top-four "F" and "D" shapes, drop-2 style seventh chords)
 *  - shell voicings for seventh chords (root, 3rd and 7th)
 *  - the same again with another chord tone in the bass (inversions)
 */
import type { ChordType } from "../theory/chords";
import { POSITIONS, positionOf } from "./shapeMap";
import type { Voicing } from "./voicings";

/**
 * The open chords on every chord chart (standard tuning, frets low string → high).
 * These come first; everything else is found by the rules below.
 * Keyed by chord type, then by root note (0 = C … 11 = B).
 */
export const OPEN_CHORDS: Record<string, Record<number, string[]>> = {
  maj: { 0: ["x32010"], 2: ["xx0232"], 4: ["022100"], 7: ["320003", "320033"], 9: ["x02220"] },
  min: { 9: ["x02210"], 2: ["xx0231"], 4: ["022000"] },
  "7": { 0: ["x32310"], 2: ["xx0212"], 4: ["020100", "022130"], 7: ["320001"], 9: ["x02020", "x02223"], 11: ["x21202"] },
  maj7: { 0: ["x32000"], 2: ["xx0222"], 4: ["021100"], 5: ["xx3210"], 7: ["320002"], 9: ["x02120"] },
  m7: { 9: ["x02010"], 2: ["xx0211"], 4: ["022030", "020000"], 11: ["x20202"] },
  sus2: { 9: ["x02200"], 2: ["xx0230"], 7: ["300033"] },
  sus4: { 9: ["x02230"], 2: ["xx0233"], 4: ["022200"], 0: ["x33011"] },
  "7sus4": { 9: ["x02030"], 2: ["xx0213"], 4: ["020200"] },
  add9: { 0: ["x32030", "x32033"], 7: ["320203"], 9: ["x02420"], 4: ["022102"] },
  madd9: { 9: ["x02410"], 4: ["022002"] },
  "6": { 0: ["x32210"], 2: ["xx0202"], 4: ["022120"], 7: ["320000"], 9: ["x02222"] },
  m6: { 9: ["x02212"], 2: ["xx0201"], 4: ["022020"] },
  aug: { 0: ["x32110"], 4: ["032110"] },
  dim7: { 2: ["xx0101"] },
  "5": { 4: ["022xxx"], 9: ["x022xx"], 2: ["xx023x"] },
};

/** Ids of the textbook open shapes for a chord, if it has any (standard tuning only; a capo moves them with it). */
export function openChordIds(rootPc: number, typeId: string, tuningNotes: number[], capo = 0): string[] {
  const STANDARD = [40, 45, 50, 55, 59, 64];
  if (tuningNotes.length !== 6 || tuningNotes.some((n, i) => n !== STANDARD[i])) return [];
  const list = OPEN_CHORDS[typeId]?.[(((rootPc - capo) % 12) + 12) % 12] ?? [];
  return list.map((t) => t.split("").join(","));
}

const soundingStrings = (v: Voicing) => v.frets.map((f, s) => (f === null ? -1 : s)).filter((s) => s >= 0);
const count = (v: Voicing) => v.frets.filter((f) => f !== null).length;
const bassString = (v: Voicing) => v.frets.findIndex((f) => f !== null);
const innerMutes = (v: Voicing) => {
  const s = soundingStrings(v);
  return s[s.length - 1] - s[0] + 1 - s.length;
};
/** An open chord: open strings ringing, everything else within the first four frets. */
export const atNut = (v: Voicing) => v.openStrings > 0 && v.maxFret <= 4;
const hasSeventh = (type: ChordType) => type.intervals.some((t) => /^(b|bb)?7$/.test(t) || t === "6");

/**
 * Can a hand hold this comfortably? Stricter than the generator's "is it possible":
 * no awkward muted strings in the middle, no big stretches, no open strings mixed
 * with notes far up the neck.
 */
export function playable(v: Voicing): boolean {
  const s = soundingStrings(v);
  if (s.length < 2) return false;
  // a muted string in the middle only works right above a bass note on the lowest
  // string, where the finger holding it leans on the next string (3x0003, 5x555x)
  const inner = innerMutes(v);
  if (inner > 1 || (inner === 1 && (s[0] !== 0 || v.frets[1] !== null))) return false;
  if (inner === 1 && s.length < 3) return false;
  // open strings belong with shapes near the nut
  if (v.openStrings > 0 && !atNut(v)) return false;
  const span = v.maxFret - v.minFret;
  const fingers = new Set(v.fingers.filter((f) => f !== null)).size;
  if (span > 3) return false;
  if (span === 3 && fingers > 3) {
    // four fingers over four frets only works when fingers 2–4 sit close together (the Asus4 barre shape)
    const rest = v.frets.filter((f, i): f is number => !!f && (v.fingers[i] ?? 0) > 1);
    if (Math.max(...rest) - Math.min(...rest) > 1) return false;
  }
  // each finger has to reach its fret: at most one fret further per finger, plus one of slack
  const at = new Map<number, number>();
  v.frets.forEach((f, i) => {
    const fg = v.fingers[i];
    if (f && fg) at.set(fg, f);
  });
  const used = [...at.keys()].sort((a, b) => a - b);
  for (let i = 1; i < used.length; i++) {
    const gap = at.get(used[i])! - at.get(used[i - 1])!;
    if (gap > used[i] - used[i - 1] + 1) return false;
    if (used[i - 1] >= 3 && gap > 1) return false; // ring finger to little finger
  }
  // two barres at once (index and ring) only in the plain A shape
  if (v.barres.length > 1 && fingers > 2) return false;
  return v.difficulty <= 6.5;
}

/** a is b with some strings left out (same bass string, same frets where both sound) */
function isCutDown(a: Voicing, b: Voicing): boolean {
  if (a === b || count(a) >= count(b) || bassString(a) !== bassString(b)) return false;
  return a.frets.every((f, s) => f === null || f === b.frets[s]);
}

/** The same grip twelve frets higher. */
function octaveUpOf(a: Voicing, b: Voicing): boolean {
  if (a.openStrings || b.openStrings) return false;
  return a.frets.every((f, s) => (f === null ? b.frets[s] === null : b.frets[s] === f - 12));
}

export type ShapeKind = "open" | "barre6" | "barre5" | "shell" | "triad" | "four" | "power" | "full";

/** Which family a shape belongs to. */
export function kindOf(v: Voicing, type: ChordType): ShapeKind {
  const n = count(v);
  const b = bassString(v);
  const adjacent = innerMutes(v) === 0;
  if (type.intervals.length <= 2) return "power";
  if (atNut(v)) return "open";
  const barreFrom = (from: number) => v.barres.some((x) => x.fret === v.minFret && x.from <= from && x.to === v.frets.length - 1);
  if (b === 0 && n === 6 && barreFrom(0)) return "barre6";
  if (b === 1 && n === 5 && barreFrom(1)) return "barre5";
  if (n === 3 && adjacent) return "triad";
  if (n === 3 && hasSeventh(type)) return "shell";
  if (n === 4 && adjacent) return "four";
  return "full";
}

export const KIND_LABEL: Record<ShapeKind, string> = { open: "Open", barre6: "Barre", barre5: "Barre", shell: "Shell", triad: "3 strings", four: "4 strings", power: "Power", full: "Full" };

export interface ShapeGroup {
  /** heading shown above the shapes ("" = none) */
  title: string;
  shapes: Voicing[];
}

export interface ShapeBook {
  /** the handful of shapes every player reaches for first, low to high on the neck */
  common: Voicing[];
  /** three- and four-string shapes, grouped by string set */
  small: ShapeGroup[];
  /** another chord tone in the bass, grouped by bass note */
  inversions: ShapeGroup[];
  /** everything playable, grouped by where it sits on the neck */
  all: ShapeGroup[];
}

const byFret = (a: Voicing, b: Voicing) => a.minFret - b.minFret || a.rank - b.rank;
const best = (list: Voicing[], n = 1) => [...list].sort((a, b) => a.rank - b.rank).slice(0, n);

/** "Strings 1–3": guitarists count strings from the thinnest. */
function stringSet(v: Voicing): string {
  const s = soundingStrings(v);
  const total = v.frets.length;
  return `Strings ${total - s[s.length - 1]}–${total - s[0]}`;
}

/**
 * Organise a chord's voicings into the shape book.
 * `openIds` are the textbook open shapes (see openChordIds); `bassName` turns a bass
 * interval ("3", "5", "b7") into a heading such as "E in the bass".
 */
export function shapeBook(voicings: Voicing[], type: ChordType, openIds: string[] = [], bassName: (token: string) => string = (t) => t): ShapeBook {
  const textbook = openIds.map((id) => voicings.find((v) => v.id === id)).filter((v): v is Voicing => !!v);
  let ok = voicings.filter((v) => playable(v) || textbook.includes(v));
  // one copy of each grip: drop the same shape an octave up
  ok = ok.filter((v) => !(v.minFret > 12 && ok.some((w) => octaveUpOf(v, w))));
  const kinds = new Map(ok.map((v) => [v.id, kindOf(v, type)] as const));
  const kind = (v: Voicing) => kinds.get(v.id)!;
  const rootBass = (v: Voicing) => v.bassToken === "1" || v.bassToken === "bass";
  const total = voicings[0]?.frets.length ?? 6;
  const low = (v: Voicing) => bassString(v) === 0; // shapes starting on the lowest string
  const top = (v: Voicing) => soundingStrings(v).at(-1) === total - 1;
  const span = (v: Voicing) => v.maxFret - v.minFret;
  const power = type.intervals.length <= 2;
  const rich = type.intervals.length >= 4; // seventh chords and beyond

  // ── Common ──
  const common: Voicing[] = [];
  const add = (v?: Voicing, evenIfPartOf = false) => {
    if (!v || common.some((c) => c.id === v.id)) return;
    if (!evenIfPartOf && common.some((c) => isCutDown(v, c) || isCutDown(c, v))) return;
    common.push(v);
  };
  const lowest = (list: Voicing[]) => best([...list].sort(byFret).filter((v, _, l) => v.minFret - l[0].minFret < 6))[0];
  if (power) {
    textbook.forEach((v) => add(v));
    // root on the 6th and on the 5th string
    for (const b of [0, 1]) add(lowest(ok.filter((v) => rootBass(v) && bassString(v) === b && count(v) === 3 && innerMutes(v) === 0 && soundingStrings(v).at(-1) === b + 2)));
  } else {
    // open chords: the textbook shapes, otherwise the best one found
    textbook.slice(0, 2).forEach((v) => add(v));
    if (!OPEN_CHORDS[type.id]) {
      const opens = ok.filter((v) => kind(v) === "open" && rootBass(v) && count(v) >= 4 && innerMutes(v) === 0 && span(v) <= 2);
      add(best(opens.filter((v) => !opens.some((w) => isCutDown(v, w))))[0]);
    }
    // the two movable barre shapes
    add(lowest(ok.filter((v) => kind(v) === "barre6" && rootBass(v) && span(v) <= 2)));
    add(lowest(ok.filter((v) => kind(v) === "barre5" && rootBass(v) && span(v) <= 2)));
    // seventh chords: the four-note grip with the root on the 6th string (5x555x for Am7)
    if (rich) add(lowest(ok.filter((v) => low(v) && rootBass(v) && count(v) === 4 && innerMutes(v) === 1 && !v.openStrings)), true);
    // four-string shapes: middle strings (root on the 5th) and the top four (the small "F" shape)
    add(lowest(ok.filter((v) => kind(v) === "four" && bassString(v) === 1 && rootBass(v))));
    add(lowest(ok.filter((v) => kind(v) === "four" && top(v) && rootBass(v))));
    // rare chord types with nothing well-known: the easiest movable shapes
    if (common.length < 3) best(ok.filter((v) => rootBass(v) && !v.openStrings && count(v) >= 4), 4).forEach((v) => common.length < 4 && add(v));
    if (common.length < 2) best(ok.filter(rootBass), 4).forEach((v) => common.length < 3 && add(v));
  }
  // the same shapes an octave up (12th fret and beyond) are not what anyone reaches for first
  const near = common.filter((v) => v.minFret < 12);
  if (near.length >= 2) common.splice(0, common.length, ...near);
  common.sort(byFret);

  // ── Small shapes, by string set ──
  const smallAll = ok.filter((v) => (kind(v) === "triad" || kind(v) === "four") && !low(v) && !v.openStrings);
  const sets = [...new Set(smallAll.map(stringSet))].sort((a, b) => {
    const size = (t: string) => Number(t.slice(-1)) - Number(t.slice(8, 9));
    return size(a) - size(b) || a.localeCompare(b);
  });
  const small = sets.map((title) => ({ title, shapes: smallAll.filter((v) => stringSet(v) === title).sort(byFret) }));
  if (rich) {
    // shells: just the root, 3rd and 7th, with the root on the 6th or 5th string
    const shells = [0, 1].map((b) => lowest(ok.filter((v) => count(v) === 3 && bassString(v) === b && rootBass(v) && !v.openStrings && (kind(v) === "shell" || kind(v) === "triad")))).filter((v): v is Voicing => !!v);
    if (shells.length) small.unshift({ title: "Shells", shapes: shells.sort(byFret) });
  }

  // ── Inversions, by bass note ──
  const inv = ok.filter((v) => !rootBass(v) && (count(v) >= 4 || kind(v) === "triad") && !(kind(v) === "triad" && low(v)));
  const order = (t: string) => {
    const i = type.intervals.indexOf(t);
    return i < 0 ? 99 : i;
  };
  const inversions = [...new Set(inv.map((v) => v.bassToken))]
    .sort((a, b) => order(a) - order(b))
    .map((t) => ({ title: bassName(t), shapes: best(inv.filter((v) => v.bassToken === t && !inv.some((w) => w.bassToken === t && isCutDown(v, w))), 9).sort(byFret) }));

  // ── Everything, by neck position ──
  const slim = ok.filter((v) => common.includes(v) || !ok.some((w) => isCutDown(v, w)));
  const all = POSITIONS.map((p, i) => ({ title: i === 0 ? "Open" : `Frets ${p}`, shapes: best(slim.filter((v) => positionOf(v) === i), 12).sort(byFret) })).filter((g) => g.shapes.length);

  return { common, small, inversions, all };
}
