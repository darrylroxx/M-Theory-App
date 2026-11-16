/**
 * The voicing generator: finds every playable way to grab a chord on the neck.
 *
 * It scans the fretboard window by window, tries every combination of chord tones
 * on each string, then keeps only shapes a human hand can actually play
 * (≤ 4 fingers, barres where needed, sensible stretch). Each voicing gets a
 * difficulty score and tags (open, barre, triad, inversion, string set…) so you can
 * break out of the "barre chord for everything" habit.
 */
import { ChordType, chordToneMap, requiredIntervals } from "../theory/chords";
import { parseInterval, semitonesOf } from "../theory/intervals";
import { mod12 } from "../theory/notes";
import type { Tuning } from "./tunings";

export interface Barre {
  fret: number;
  from: number; // string index (0 = lowest string)
  to: number;
  finger: number;
}

export interface Voicing {
  /** Per string, low → high. null = muted, 0 = open (relative to capo). */
  frets: (number | null)[];
  fingers: (number | null)[];
  barres: Barre[];
  /** Sounding MIDI notes per string (null when muted). */
  midi: (number | null)[];
  /** Chord-tone label per string ("1", "b3", "5", "b7" …). */
  tokens: (string | null)[];
  bassToken: string;
  /** Lowest / highest fretted (non-open) fret, 0 when the shape is all open. */
  minFret: number;
  maxFret: number;
  difficulty: number;
  /** Sort key: difficulty plus musical-usefulness penalties (lower = shown first). */
  rank: number;
  tags: string[];
  inversion: string;
  barreKind: "none" | "mini" | "full";
  openStrings: number;
  omitted: string[];
  id: string;
}

export interface VoicingOptions {
  tuning: Tuning;
  capo?: number;
  /** Highest fret (relative to capo) to search. */
  maxFret?: number;
  /** Max distance between the lowest and highest fretted notes (3 = a 4-fret box). */
  maxSpan?: number;
  /** Force this pitch class in the bass (slash chords). */
  bassPc?: number;
  /** Allow leaving out the root (jazz "rootless" voicings). */
  rootless?: boolean;
  /** How many muted strings may sit *between* sounding strings. */
  internalMutes?: number;
  limit?: number;
}

type Note = { s: number; f: number };

/** Work out a fingering. Returns null when a hand can't play it. */
export function assignFingers(frets: (number | null)[]): { fingers: (number | null)[]; barres: Barre[] } | null {
  const fingers: (number | null)[] = frets.map(() => null);
  const notes: Note[] = [];
  frets.forEach((f, s) => {
    if (f !== null && f > 0) notes.push({ s, f });
  });
  if (notes.length === 0) return { fingers, barres: [] };
  const minF = Math.min(...notes.map((n) => n.f));

  const tryBarre = (fret: number, pool: Note[]): Note[] | null => {
    const at = pool.filter((n) => n.f === fret);
    if (at.length < 2) return null;
    const lo = Math.min(...at.map((n) => n.s));
    const hi = Math.max(...at.map((n) => n.s));
    for (let s = lo; s <= hi; s++) {
      const f = frets[s];
      if (f === null || f < fret) return null; // can't lay a barre over a muted/open/lower string
    }
    return at;
  };

  // groups = units that each need one finger: a single note or a barre
  type Group = { notes: Note[]; fret: number; s: number; barre: boolean };
  const finish = (groups: Group[]) => {
    if (groups.length > 4) return null;
    groups.sort((a, b) => a.fret - b.fret || a.s - b.s);
    // finger ≈ fret offset from the lowest fret, kept strictly increasing
    let prev = 0;
    const assigned = groups.map((g) => {
      const ideal = g.fret - minF + 1;
      const f = Math.max(ideal, prev + 1);
      prev = f;
      return f;
    });
    const overflow = assigned[assigned.length - 1] > 4;
    const barres: Barre[] = [];
    groups.forEach((g, i) => {
      const finger = overflow ? i + 1 : assigned[i];
      for (const n of g.notes) fingers[n.s] = finger;
      if (g.barre) {
        barres.push({ fret: g.fret, from: Math.min(...g.notes.map((n) => n.s)), to: Math.max(...g.notes.map((n) => n.s)), finger });
      }
    });
    return { fingers, barres };
  };
  const singles = (ns: Note[]): Group[] => ns.map((n) => ({ notes: [n], fret: n.f, s: n.s, barre: false }));
  const barreGroup = (ns: Note[]): Group => ({ notes: ns, fret: ns[0].f, s: Math.min(...ns.map((n) => n.s)), barre: true });

  // 1. Index-finger barre at the lowest fret when 4+ notes are fretted (F-shape style)
  if (notes.length >= 4) {
    const b = tryBarre(minF, notes);
    if (b) {
      const rest = notes.filter((n) => !b.includes(n));
      if (rest.length <= 3) return finish([barreGroup(b), ...singles(rest)]);
      // 2. A second barre higher up (A-shape with ring-finger barre)
      for (const fr of [...new Set(rest.map((n) => n.f))]) {
        const b2 = tryBarre(fr, rest);
        if (!b2) continue;
        const rest2 = rest.filter((n) => !b2.includes(n));
        if (rest2.length <= 2) return finish([barreGroup(b), barreGroup(b2), ...singles(rest2)]);
      }
    }
  }
  // 3. No barre needed
  if (notes.length <= 4) return finish(singles(notes));
  // 4. A barre on some other fret
  for (const fr of [...new Set(notes.map((n) => n.f))].sort((a, b) => a - b)) {
    const b = tryBarre(fr, notes);
    if (!b) continue;
    const rest = notes.filter((n) => !b.includes(n));
    if (rest.length <= 3) return finish([barreGroup(b), ...singles(rest)]);
  }
  return null;
}

const INVERSION_NAMES: Record<number, string> = { 1: "Root position", 3: "1st inversion", 5: "2nd inversion", 7: "3rd inversion" };

function inversionOf(bassToken: string): string {
  if (bassToken === "bass") return "Slash bass";
  const n = parseInterval(bassToken).number;
  if (INVERSION_NAMES[n]) return INVERSION_NAMES[n] + (n === 1 ? "" : ` (${bassToken.replace(/b/g, "♭").replace(/#/g, "♯")} in bass)`);
  if (n === 6) return "3rd inversion (6 in bass)";
  return `${bassToken.replace(/b/g, "♭").replace(/#/g, "♯")} in bass`;
}

function scoreAndTag(
  v: Omit<Voicing, "difficulty" | "rank" | "tags" | "inversion" | "barreKind">,
  type: ChordType,
  stringCount: number,
  forcedBass: boolean,
): Pick<Voicing, "difficulty" | "rank" | "tags" | "inversion" | "barreKind"> {
  const sounding = v.frets.map((f, i) => (f === null ? -1 : i)).filter((i) => i >= 0);
  const first = sounding[0];
  const last = sounding[sounding.length - 1];
  let internal = 0;
  for (let i = first; i <= last; i++) if (v.frets[i] === null) internal++;
  const leading = first;
  const trailing = stringCount - 1 - last;
  const fretted = v.frets.filter((f): f is number => f !== null && f > 0);
  const span = fretted.length ? v.maxFret - v.minFret : 0;
  const fingerCount = new Set(v.fingers.filter((f) => f !== null)).size;

  let barreKind: Voicing["barreKind"] = "none";
  for (const b of v.barres) {
    const size = b.to - b.from + 1;
    if (size >= 4) barreKind = "full";
    else if (barreKind === "none") barreKind = "mini";
  }

  let d = fingerCount * 0.5;
  for (const b of v.barres) {
    const size = b.to - b.from + 1;
    d += size >= 5 ? 2.5 : size === 4 ? 2 : size === 3 ? 1.2 : 0.8;
  }
  d += [0, 0.2, 0.7, 1.6, 3, 4.5][span] ?? 5;
  d += internal * 1.5 + leading * 0.25 + trailing * 0.6;
  if (span >= 3 && v.minFret <= 3) d += 0.6;
  if (v.minFret > 12) d += 0.5;
  const difficulty = Math.round(d * 10) / 10;

  const tags: string[] = [];
  const inversion = inversionOf(v.bassToken);
  if (v.openStrings > 0 && v.maxFret <= 4) tags.push("Open chord");
  if (v.openStrings > 0 && v.minFret >= 5) tags.push("Ringing open strings");
  if (barreKind === "full") tags.push("Barre");
  else if (barreKind === "mini") tags.push("Mini-barre");
  else tags.push("No barre");
  if (sounding.length === 3) tags.push("3-string");
  if (sounding.length <= 4 && last === stringCount - 1 && first >= stringCount - 4) tags.push("Top strings");
  if (last <= 3) tags.push("Low strings");
  const uniq = new Set(v.tokens.filter((t): t is string => t !== null && t !== "bass").map((t) => parseInterval(t).number % 7));
  if (type.intervals.some((t) => parseInterval(t).number === 7) && uniq.size === 3 && uniq.has(1) && uniq.has(3) && uniq.has(0)) tags.push("Shell");
  if (v.omitted.length === 0) tags.push("All chord tones");
  tags.push(difficulty < 3 ? "Easy" : difficulty < 5 ? "Medium" : "Hard");

  // Usefulness: full, root-position, clear-sounding shapes first
  let rank = difficulty;
  if (!forcedBass && v.bassToken !== "bass") {
    const bn = parseInterval(v.bassToken).number;
    rank += bn === 1 ? 0 : bn === 3 || bn === 5 ? 1.2 : bn === 7 ? 1.6 : 2.5;
  }
  rank += ({ 2: 1.2, 3: 0.6, 4: 0.2 } as Record<number, number>)[sounding.length] ?? 0;
  rank += v.omitted.length * 0.3;
  const m = v.midi.filter((x): x is number => x !== null);
  // close intervals down low sound muddy (below C3 = MIDI 48)
  for (let i = 1; i < m.length; i++) {
    const gap = m[i] - m[i - 1];
    if (m[i - 1] < 48 && gap > 0 && gap <= 4) rank += gap <= 2 ? 1.2 : 0.7;
  }
  if (tags.includes("Open chord")) rank -= 0.3;
  rank += v.minFret * 0.03;
  return { difficulty, rank: Math.round(rank * 100) / 100, tags, inversion, barreKind };
}

/** Generate every playable voicing of a chord. */
export function generateVoicings(rootPc: number, type: ChordType, opts: VoicingOptions): Voicing[] {
  const tuning = opts.tuning.notes;
  const capo = opts.capo ?? 0;
  const n = tuning.length;
  const maxFret = opts.maxFret ?? 15;
  const maxSpan = opts.maxSpan ?? 3;
  const internalMutesAllowed = opts.internalMutes ?? 1;
  const toneMap = chordToneMap(rootPc, type);
  const bassPc = opts.bassPc !== undefined ? mod12(opts.bassPc) : undefined;
  const slashOutside = bassPc !== undefined && !toneMap.has(bassPc);
  let required = [...new Set(requiredIntervals(type).map((iv) => mod12(rootPc + semitonesOf(iv))))];
  if (opts.rootless) required = required.filter((p) => p !== rootPc);
  const minStrings = type.intervals.length <= 2 ? 2 : 3;

  const pcAt = (s: number, f: number) => mod12(tuning[s] + capo + f);
  const allowedOn = (s: number, f: number) => toneMap.has(pcAt(s, f)) || (slashOutside && pcAt(s, f) === bassPc);

  const seen = new Set<string>();
  const out: Voicing[] = [];
  const frets: (number | null)[] = new Array(n).fill(null);

  for (let start = 1; start <= maxFret; start++) {
    const end = Math.min(start + maxSpan, maxFret);
    const options: (number | null)[][] = [];
    for (let s = 0; s < n; s++) {
      const o: (number | null)[] = [null];
      if (allowedOn(s, 0)) o.push(0);
      for (let f = start; f <= end; f++) if (allowedOn(s, f)) o.push(f);
      options.push(o);
    }
    const dfs = (s: number) => {
      if (s === n) {
        evaluate(start);
        return;
      }
      for (const f of options[s]) {
        frets[s] = f;
        dfs(s + 1);
      }
      frets[s] = null;
    };
    dfs(0);
  }

  function evaluate(start: number) {
    const fretted = frets.filter((f): f is number => f !== null && f > 0);
    const minF = fretted.length ? Math.min(...fretted) : 0;
    if (fretted.length ? minF !== start : start !== 1) return; // each shape counted once
    const sounding: number[] = [];
    for (let s = 0; s < n; s++) if (frets[s] !== null) sounding.push(s);
    if (sounding.length < minStrings) return;
    let internal = 0;
    for (let s = sounding[0]; s <= sounding[sounding.length - 1]; s++) if (frets[s] === null) internal++;
    if (internal > internalMutesAllowed) return;
    const bassString = sounding[0];
    const bass = pcAt(bassString, frets[bassString]!);
    if (bassPc !== undefined && bass !== bassPc) return;
    const pcs = sounding.map((s) => pcAt(s, frets[s]!));
    // a non-chord slash bass may only appear in the bass
    if (slashOutside && pcs.slice(1).includes(bassPc!)) return;
    if (!required.every((p) => pcs.includes(p))) return;
    if (bassPc === undefined && !toneMap.has(bass)) return;
    const id = frets.map((f) => (f === null ? "x" : f)).join(",");
    if (seen.has(id)) return;
    const fing = assignFingers(frets);
    if (!fing) return;
    seen.add(id);
    const midi = frets.map((f, s) => (f === null ? null : tuning[s] + capo + f));
    const tokens = frets.map((f, s) => {
      if (f === null) return null;
      const p = pcAt(s, f);
      return toneMap.get(p) ?? "bass";
    });
    const present = new Set(pcs);
    const omitted = type.intervals.filter((iv) => !present.has(mod12(rootPc + semitonesOf(iv))));
    const base = {
      frets: [...frets],
      fingers: fing.fingers,
      barres: fing.barres,
      midi,
      tokens,
      bassToken: toneMap.get(bass) ?? "bass",
      minFret: minF,
      maxFret: fretted.length ? Math.max(...fretted) : 0,
      openStrings: frets.filter((f) => f === 0).length,
      omitted,
      id,
    };
    const extra = scoreAndTag(base, type, n, bassPc !== undefined);
    out.push({ ...base, ...extra });
  }

  out.sort((a, b) => a.rank - b.rank || a.minFret - b.minFret);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** "x32010" style text (frets ≥ 10 are separated by dashes). */
export function voicingText(v: Pick<Voicing, "frets">): string {
  const big = v.frets.some((f) => f !== null && f >= 10);
  return v.frets.map((f) => (f === null ? "x" : String(f))).join(big ? "-" : "");
}

/** Average hand position, used to keep progressions in one area of the neck. */
export function voicingCenter(v: Voicing): number {
  const fretted = v.frets.filter((f): f is number => f !== null && f > 0);
  if (!fretted.length) return 0;
  return fretted.reduce((a, b) => a + b, 0) / fretted.length;
}

export const isRootPosition = (v: Voicing) => v.bassToken === "1";

/** Build a Voicing from an explicit fret list (e.g. a shape the user tapped in). */
export function voicingFromFrets(frets: (number | null)[], rootPc: number, type: ChordType, tuning: Tuning, capo = 0): Voicing {
  const toneMap = chordToneMap(rootPc, type);
  const midi = frets.map((f, s) => (f === null ? null : tuning.notes[s] + capo + f));
  const tokens = midi.map((m) => (m === null ? null : toneMap.get(mod12(m)) ?? "bass"));
  const fing = assignFingers(frets) ?? { fingers: frets.map(() => null), barres: [] };
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  const present = new Set(midi.filter((m): m is number => m !== null).map(mod12));
  const firstTok = tokens.find((t) => t !== null) ?? "1";
  const base = {
    frets: [...frets],
    fingers: fing.fingers,
    barres: fing.barres,
    midi,
    tokens,
    bassToken: firstTok,
    minFret: fretted.length ? Math.min(...fretted) : 0,
    maxFret: fretted.length ? Math.max(...fretted) : 0,
    openStrings: frets.filter((f) => f === 0).length,
    omitted: type.intervals.filter((iv) => !present.has(mod12(rootPc + semitonesOf(iv)))),
    id: frets.map((f) => (f === null ? "x" : f)).join(","),
  };
  return { ...base, ...scoreAndTag(base, type, frets.length, true) };
}

/** Parse a voicing id ("x,3,2,0,1,0") back into frets. */
export function fretsFromId(id: string): (number | null)[] {
  return id.split(",").map((t) => (t === "x" ? null : Number(t)));
}
