/**
 * Chord types, chord building and chord identification.
 *
 * Every chord is just a root note plus a *formula* of intervals.
 *   Major = 1 3 5        Minor = 1 ♭3 5        m7♭5 = 1 ♭3 ♭5 ♭7
 * Learn the formulas and you can build any chord on any root.
 */
import { SIMPLE_INTERVAL_LABELS, intervalNote, parseInterval, semitonesOf } from "./intervals";
import { displayNote, mod12, pc } from "./notes";

export type ChordCategory =
  | "Triads"
  | "Power & Sus"
  | "Sixths"
  | "Sevenths"
  | "Added tones"
  | "Extended (9, 11, 13)"
  | "Altered dominants";

export const CHORD_CATEGORIES: ChordCategory[] = [
  "Triads",
  "Power & Sus",
  "Sixths",
  "Sevenths",
  "Added tones",
  "Extended (9, 11, 13)",
  "Altered dominants",
];

export interface ChordType {
  id: string;
  /** Suffix written after the root, ASCII (b/#): "m7b5" */
  symbol: string;
  name: string;
  intervals: string[];
  /** Tones guitarists commonly leave out (usually the 5th) */
  optional?: string[];
  category: ChordCategory;
  /** What it sounds / feels like */
  feel: string;
  /** Suffix used in Roman numerals (after the numeral), if different from the default */
  roman?: string;
  aliases?: string[];
  /** Built on the fly (not in the library) — e.g. an unusual stack from an exotic scale */
  synthetic?: boolean;
}

const T = (
  id: string,
  symbol: string,
  name: string,
  intervals: string[],
  category: ChordCategory,
  feel: string,
  extra: Partial<ChordType> = {},
): ChordType => ({ id, symbol, name, intervals, category, feel, ...extra });

export const CHORD_TYPES: ChordType[] = [
  // ── Triads ────────────────────────────────────────────────
  T("maj", "", "Major", ["1", "3", "5"], "Triads", "Bright, stable, resolved. The sound of 'home' in a major key.", { aliases: ["M", "maj"] }),
  T("min", "m", "Minor", ["1", "b3", "5"], "Triads", "Darker, emotional, introspective.", { aliases: ["min", "-"] }),
  T("dim", "dim", "Diminished", ["1", "b3", "b5"], "Triads", "Tense, unstable, eerie. Wants to move somewhere.", { roman: "°", aliases: ["°"] }),
  T("aug", "aug", "Augmented", ["1", "3", "#5"], "Triads", "Dreamlike, suspenseful, unresolved, like a question mark.", { roman: "+", aliases: ["+"] }),
  T("majb5", "(b5)", "Major ♭5", ["1", "3", "b5"], "Triads", "Strange and Lydian-tinged. An unsettled major chord."),
  // ── Power & Sus ───────────────────────────────────────────
  T("5", "5", "Power chord", ["1", "5"], "Power & Sus", "Neutral, heavy, punchy. No 3rd, so it's neither happy nor sad."),
  T("sus2", "sus2", "Suspended 2nd", ["1", "2", "5"], "Power & Sus", "Open, airy, ambiguous. Neither major nor minor."),
  T("sus4", "sus4", "Suspended 4th", ["1", "4", "5"], "Power & Sus", "Hanging tension that wants to fall back to major or minor."),
  T("7sus4", "7sus4", "Dominant 7 sus4", ["1", "4", "5", "b7"], "Power & Sus", "Floating, modern dominant. Tension without the bite.", { optional: ["5"] }),
  T("7sus2", "7sus2", "Dominant 7 sus2", ["1", "2", "5", "b7"], "Power & Sus", "Open, hazy and unresolved.", { optional: ["5"] }),
  T("9sus4", "9sus4", "9 sus4", ["1", "4", "5", "b7", "9"], "Power & Sus", "Modern gospel / fusion float. Smooth and suspended.", { optional: ["5"] }),
  T("maj7sus2", "maj7sus2", "Major 7 sus2", ["1", "2", "5", "7"], "Power & Sus", "Wide open and glassy: a major 7th with no 3rd."),
  T("susb9", "sus(b9)", "Sus ♭9 (Phrygian)", ["1", "4", "5", "b9"], "Power & Sus", "Dark and Spanish. The Phrygian sound without a 3rd."),
  T("7susb9", "7sus(b9)", "Dominant 7 sus ♭9", ["1", "4", "5", "b7", "b9"], "Power & Sus", "Brooding, suspended Phrygian tension.", { optional: ["5"] }),
  // ── Sixths ────────────────────────────────────────────────
  T("6", "6", "Major 6th", ["1", "3", "5", "6"], "Sixths", "Sweet, vintage, nostalgic. Major with a warm glow.", { optional: ["5"] }),
  T("m6", "m6", "Minor 6th", ["1", "b3", "5", "6"], "Sixths", "Mysterious, noir, bittersweet. The Dorian minor sound.", { optional: ["5"] }),
  T("69", "6/9", "6/9", ["1", "3", "5", "6", "9"], "Sixths", "Lush, open and resolved. A beautiful final chord.", { optional: ["5"] }),
  T("m69", "m6/9", "Minor 6/9", ["1", "b3", "5", "6", "9"], "Sixths", "Smoky, sophisticated minor.", { optional: ["5"] }),
  // ── Sevenths ──────────────────────────────────────────────
  T("maj7", "maj7", "Major 7th", ["1", "3", "5", "7"], "Sevenths", "Dreamy, soft, sophisticated, a little wistful.", { optional: ["5"], aliases: ["M7", "Δ7"] }),
  T("7", "7", "Dominant 7th", ["1", "3", "5", "b7"], "Sevenths", "Bluesy, gritty, restless. Pulls toward the chord a 5th below.", { optional: ["5"], aliases: ["dom7"] }),
  T("m7", "m7", "Minor 7th", ["1", "b3", "5", "b7"], "Sevenths", "Smooth, mellow, soulful minor.", { optional: ["5"], aliases: ["min7", "-7"] }),
  T("m7b5", "m7b5", "Half-diminished (m7♭5)", ["1", "b3", "b5", "b7"], "Sevenths", "Dark, yearning, unresolved. The minor key's ii chord.", { roman: "ø7", aliases: ["ø", "ø7"] }),
  T("dim7", "dim7", "Diminished 7th", ["1", "b3", "b5", "bb7"], "Sevenths", "Maximum suspense. Cinematic and symmetrical; it can slide anywhere.", { roman: "°7", aliases: ["°7"] }),
  T("mMaj7", "m(maj7)", "Minor-major 7th", ["1", "b3", "5", "7"], "Sevenths", "Haunting, spy-movie, dramatic minor.", { optional: ["5"], roman: "(maj7)", aliases: ["mM7", "m/maj7"] }),
  T("dimMaj7", "dim(maj7)", "Diminished major 7th", ["1", "b3", "b5", "7"], "Sevenths", "Eerie and unstable, with a bright note on top.", { roman: "°(maj7)" }),
  T("maj7#5", "maj7#5", "Augmented major 7th", ["1", "3", "#5", "7"], "Sevenths", "Shimmering and otherworldly.", { roman: "+maj7", aliases: ["+maj7"] }),
  T("7#5", "7#5", "Augmented 7th", ["1", "3", "#5", "b7"], "Altered dominants", "Pushing, rising tension.", { roman: "+7", aliases: ["aug7", "+7"] }),
  T("7b5", "7b5", "Dominant 7♭5", ["1", "3", "b5", "b7"], "Altered dominants", "Slippery, angular dominant."),
  // ── Added tones ───────────────────────────────────────────
  T("add9", "add9", "Major add 9", ["1", "3", "5", "9"], "Added tones", "Major with sparkle. Pretty, open and modern.", { optional: ["5"], aliases: ["add2"] }),
  T("madd9", "m(add9)", "Minor add 9", ["1", "b3", "5", "9"], "Added tones", "Beautiful, aching minor.", { optional: ["5"], aliases: ["madd9", "madd2"] }),
  T("add11", "add11", "Major add 11", ["1", "3", "5", "11"], "Added tones", "Major with a folky, suspended rub.", { optional: ["5"], aliases: ["add4"] }),
  T("madd11", "m(add11)", "Minor add 11", ["1", "b3", "5", "11"], "Added tones", "Open, modal, earthy minor.", { optional: ["5"], aliases: ["madd11", "madd4"] }),
  T("mb6", "m(b6)", "Minor ♭6", ["1", "b3", "5", "b6"], "Added tones", "Aching and cinematic: the natural-minor colour.", { optional: ["5"] }),
  T("add#11", "add#11", "Major add ♯11", ["1", "3", "5", "#11"], "Added tones", "Floating Lydian brightness.", { optional: ["5"] }),
  // ── Extended ──────────────────────────────────────────────
  T("maj9", "maj9", "Major 9th", ["1", "3", "5", "7", "9"], "Extended (9, 11, 13)", "Lush, romantic, neo-soul.", { optional: ["5"] }),
  T("9", "9", "Dominant 9th", ["1", "3", "5", "b7", "9"], "Extended (9, 11, 13)", "Funky, rich dominant.", { optional: ["5"] }),
  T("m9", "m9", "Minor 9th", ["1", "b3", "5", "b7", "9"], "Extended (9, 11, 13)", "Silky, R&B, introspective.", { optional: ["5"] }),
  T("mMaj9", "m(maj9)", "Minor-major 9th", ["1", "b3", "5", "7", "9"], "Extended (9, 11, 13)", "Dark glamour. Haunting and lush.", { optional: ["5"], roman: "(maj9)" }),
  T("11", "11", "Dominant 11th", ["1", "3", "5", "b7", "9", "11"], "Extended (9, 11, 13)", "Big, open and suspended. Usually played without the 3rd.", { optional: ["3", "5", "9"] }),
  T("m11", "m11", "Minor 11th", ["1", "b3", "5", "b7", "9", "11"], "Extended (9, 11, 13)", "Wide, modal, cool. Very guitar-friendly.", { optional: ["5", "9"] }),
  T("m7add11", "m7(11)", "Minor 7 add 11", ["1", "b3", "5", "b7", "11"], "Extended (9, 11, 13)", "Open and modal: a minor 7th with the 4th on top.", { optional: ["5"] }),
  T("m7b9", "m7(b9)", "Minor 7 ♭9 (Phrygian)", ["1", "b3", "5", "b7", "b9"], "Extended (9, 11, 13)", "Dark, Spanish minor: the chord on the 3rd degree of a major key.", { optional: ["5"] }),
  T("m9b5", "m9(b5)", "Minor 9 ♭5", ["1", "b3", "b5", "b7", "9"], "Extended (9, 11, 13)", "A half-diminished chord made softer by a natural 9th."),
  T("m7b5b9", "m7b5(b9)", "Half-diminished ♭9 (Locrian)", ["1", "b3", "b5", "b7", "b9"], "Extended (9, 11, 13)", "The darkest stack a major key holds: its 7th degree in full."),
  T("m11b5", "m7b5(11)", "Half-diminished add 11", ["1", "b3", "b5", "b7", "11"], "Extended (9, 11, 13)", "Hollow, floating half-diminished."),
  T("maj7#11", "maj7#11", "Major 7♯11 (Lydian chord)", ["1", "3", "5", "7", "#11"], "Extended (9, 11, 13)", "The Lydian chord. Bright, cinematic, floating.", { optional: ["5"] }),
  T("maj9#11", "maj9#11", "Major 9 ♯11", ["1", "3", "5", "7", "9", "#11"], "Extended (9, 11, 13)", "The full Lydian chord: wide, bright and weightless.", { optional: ["5"] }),
  T("7#11", "7#11", "Dominant 7♯11 (Lydian dominant)", ["1", "3", "5", "b7", "#11"], "Altered dominants", "Bright but bluesy. Quirky, whimsical tension.", { optional: ["5"] }),
  T("9#11", "9#11", "Dominant 9 ♯11", ["1", "3", "5", "b7", "9", "#11"], "Altered dominants", "Lydian dominant in full: bright, bluesy, a little sly.", { optional: ["5"] }),
  T("maj13", "maj13", "Major 13th", ["1", "3", "5", "7", "9", "13"], "Extended (9, 11, 13)", "Glowing, luxurious, jazzy major.", { optional: ["5", "9"] }),
  T("13", "13", "Dominant 13th", ["1", "3", "5", "b7", "9", "13"], "Extended (9, 11, 13)", "Sophisticated, jazzy, soulful dominant.", { optional: ["5", "9"] }),
  T("m13", "m13", "Minor 13th", ["1", "b3", "5", "b7", "9", "13"], "Extended (9, 11, 13)", "Deep, warm Dorian minor.", { optional: ["5", "9"] }),
  // ── Altered dominants ─────────────────────────────────────
  T("7b9", "7b9", "Dominant 7♭9", ["1", "3", "5", "b7", "b9"], "Altered dominants", "Dark, exotic dominant. Flamenco / minor-key drama.", { optional: ["5"] }),
  T("7#9", "7#9", "Dominant 7♯9", ["1", "3", "5", "b7", "#9"], "Altered dominants", "Gritty rock-blues. Major and minor at the same time.", { optional: ["5"] }),
  T("7b13", "7b13", "Dominant 7♭13", ["1", "3", "5", "b7", "b13"], "Altered dominants", "Bittersweet dominant that leans into a minor chord.", { optional: ["5"] }),
  T("7alt", "7alt", "Altered dominant", ["1", "3", "b7", "#9", "b13"], "Altered dominants", "Maximum dominant tension. Resolves hard."),
];

const BY_ID = new Map(CHORD_TYPES.map((t) => [t.id, t]));

export function getChordType(id: string): ChordType {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`Unknown chord type: ${id}`);
  return t;
}

export function findChordType(id: string): ChordType | undefined {
  return BY_ID.get(id);
}

/** Pretty-print a chord suffix: "m7b5" → "m7♭5". */
export function displaySuffix(symbol: string): string {
  return symbol.replace(/b(?=\d)/g, "♭").replace(/#/g, "♯");
}

/** A concrete chord: root + type (+ optional different bass note for slash chords). */
export interface ChordRef {
  root: string; // spelled, ASCII: "C#"
  typeId: string;
  bass?: string; // slash chord bass, spelled
}

export function chordTypeOf(ref: ChordRef): ChordType {
  return getChordType(ref.typeId);
}

/** ASCII chord symbol: "C#m7b5/G" */
export function chordSymbolAscii(ref: ChordRef): string {
  const t = chordTypeOf(ref);
  return ref.root + t.symbol + (ref.bass && pc(ref.bass) !== pc(ref.root) ? "/" + ref.bass : "");
}

/** Display chord symbol: "C♯m7♭5/G" */
export function chordSymbol(ref: ChordRef): string {
  const t = chordTypeOf(ref);
  return (
    displayNote(ref.root) +
    displaySuffix(t.symbol) +
    (ref.bass && pc(ref.bass) !== pc(ref.root) ? "/" + displayNote(ref.bass) : "")
  );
}

export function chordName(ref: ChordRef): string {
  const t = chordTypeOf(ref);
  return `${displayNote(ref.root)} ${t.name}`;
}

/** Spelled chord tones, in formula order: chordNotes("B","maj7") → ["B","D#","F#","A#"] */
export function chordNotes(root: string, type: ChordType): string[] {
  return type.intervals.map((iv) => intervalNote(root, iv));
}

/** Pitch classes of a chord (formula order, may contain duplicates for odd formulas). */
export function chordPcs(rootPc: number, type: ChordType): number[] {
  return type.intervals.map((iv) => mod12(rootPc + semitonesOf(iv)));
}

export function refPcs(ref: ChordRef): number[] {
  const pcs = chordPcs(pc(ref.root), chordTypeOf(ref));
  if (ref.bass && !pcs.includes(pc(ref.bass))) pcs.push(pc(ref.bass));
  return pcs;
}

/** Map pitch class → interval token for this chord (for labelling diagram dots). */
export function chordToneMap(rootPc: number, type: ChordType): Map<number, string> {
  const m = new Map<number, string>();
  for (const iv of type.intervals) {
    const p = mod12(rootPc + semitonesOf(iv));
    if (!m.has(p)) m.set(p, iv);
  }
  return m;
}

export function requiredIntervals(type: ChordType): string[] {
  return type.intervals.filter((iv) => !(type.optional ?? []).includes(iv));
}

/**
 * Find the chord type matching a set of interval tokens exactly (as a set).
 * Falls back to a synthetic type ("m7b5(b9)") when nothing in the library matches,
 * so exotic scales still produce a sensible name.
 */
export function chordTypeFromIntervals(tokens: string[]): ChordType | null {
  const key = (arr: string[]) => [...new Set(arr)].sort().join(",");
  const target = key(tokens);
  for (const t of CHORD_TYPES) if (key(t.intervals) === target) return t;
  // Fallback: a known lower structure + extensions in parentheses
  const sorted = [...tokens].sort((a, b) => parseInterval(a).number - parseInterval(b).number);
  for (let cut = sorted.length - 1; cut >= 3; cut--) {
    const base = sorted.slice(0, cut);
    const extra = sorted.slice(cut);
    const bt = CHORD_TYPES.find((t) => key(t.intervals) === key(base));
    if (bt) {
      const ext = extra.join(",");
      return {
        id: `${bt.id}(${ext})`,
        symbol: `${bt.symbol}(${ext})`,
        name: `${bt.name} with ${extra.map((e) => displaySuffix(e)).join(", ")}`,
        intervals: sorted,
        category: "Extended (9, 11, 13)",
        feel: bt.feel,
        roman: (bt.roman ?? defaultRomanSuffix(bt)) + `(${ext})`,
        synthetic: true,
      };
    }
  }
  return null;
}

export function isMinorish(type: ChordType): boolean {
  return type.intervals.includes("b3") && !type.intervals.includes("3");
}

export function defaultRomanSuffix(type: ChordType): string {
  if (type.roman !== undefined) return type.roman;
  if (isMinorish(type) && type.symbol.startsWith("m") && !type.symbol.startsWith("maj")) {
    const rest = type.symbol.slice(1);
    return rest.startsWith("(") && rest.endsWith(")") ? rest.slice(1, -1) : rest; // "m(add9)" → "add9"
  }
  return type.symbol;
}

// ── Chord identification ─────────────────────────────────────

export interface ChordMatch {
  ref: ChordRef;
  type: ChordType;
  /** Optional tones from the formula that are missing from the played notes */
  omitted: string[];
  score: number;
}

const CATEGORY_RANK: Record<ChordCategory, number> = {
  Triads: 0,
  "Power & Sus": 1,
  Sevenths: 1,
  Sixths: 2,
  "Added tones": 2,
  "Extended (9, 11, 13)": 3,
  "Altered dominants": 4,
};

/**
 * Name the chord(s) formed by a set of pitch classes.
 * identifyChord([0,4,7,9], 0) → C6 first, then Am7/C …
 * `spell` turns a pitch class into a note name (key-aware spelling from the caller).
 */
export function identifyChord(
  pcsIn: number[],
  bassPc: number | undefined,
  spell: (p: number) => string,
): ChordMatch[] {
  const pcs = [...new Set(pcsIn.map(mod12))];
  if (pcs.length < 2) return [];
  const results: ChordMatch[] = [];
  for (const rootPc of pcs) {
    for (const type of CHORD_TYPES) {
      const tones = chordToneMap(rootPc, type);
      // every played note must belong to the chord
      if (!pcs.every((p) => tones.has(p))) continue;
      const req = requiredIntervals(type).map((iv) => mod12(rootPc + semitonesOf(iv)));
      if (!req.every((p) => pcs.includes(p))) continue;
      const omitted = type.intervals.filter((iv) => !pcs.includes(mod12(rootPc + semitonesOf(iv))));
      let score = 0;
      score += omitted.length * 3;
      score += CATEGORY_RANK[type.category];
      if (bassPc !== undefined && bassPc !== rootPc) score += 4;
      if (type.id === "majb5" || type.id === "7b5") score += 2;
      const root = spell(rootPc);
      const ref: ChordRef = { root, typeId: type.id };
      if (bassPc !== undefined && bassPc !== rootPc) ref.bass = spell(bassPc);
      results.push({ ref, type, omitted, score });
    }
  }
  results.sort((a, b) => a.score - b.score);
  // dedupe by symbol
  const seen = new Set<string>();
  return results.filter((r) => {
    const k = chordSymbolAscii(r.ref);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Interval token of a pitch class relative to a chord root (uses chord formula if possible). */
export function tokenInChord(rootPc: number, type: ChordType, p: number): string {
  const m = chordToneMap(rootPc, type);
  return m.get(mod12(p)) ?? SIMPLE_INTERVAL_LABELS[mod12(p - rootPc)];
}
