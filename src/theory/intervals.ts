/**
 * Intervals — the distance between two notes, written the way musicians
 * write chord & scale formulas: "1", "b3", "5", "#11", "bb7" …
 *
 * The number tells you which *letter* (scale step) the note sits on,
 * the ♭/♯ tells you how it differs from the major scale.
 */
import { spellAbove } from "./notes";

export interface Interval {
  token: string; // e.g. "b3"
  number: number; // 1..13
  semitones: number; // distance above the root (can exceed 12 for 9/11/13)
}

// Semitones of the major-scale degrees 1..7
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

export function parseInterval(token: string): Interval {
  const m = /^([b#]*)(\d+)$/.exec(token.replace(/♭/g, "b").replace(/♯/g, "#"));
  if (!m) throw new Error(`Invalid interval: ${token}`);
  const number = parseInt(m[2], 10);
  if (number < 1) throw new Error(`Invalid interval: ${token}`);
  let acc = 0;
  for (const ch of m[1]) acc += ch === "#" ? 1 : -1;
  const octave = Math.floor((number - 1) / 7);
  const semitones = 12 * octave + MAJOR_STEPS[(number - 1) % 7] + acc;
  return { token, number, semitones };
}

export const semitonesOf = (token: string): number => parseInterval(token).semitones;

/** Spell the note at `token` above `root`: intervalNote("B", "3") → "D#". */
export function intervalNote(root: string, token: string): string {
  const iv = parseInterval(token);
  return spellAbove(root, (iv.number - 1) % 7, iv.semitones);
}

/** Build an interval token from a scale-step number and a semitone distance. */
export function makeToken(number: number, semitones: number): string {
  const octave = Math.floor((number - 1) / 7);
  const base = 12 * octave + MAJOR_STEPS[(number - 1) % 7];
  let acc = semitones - base;
  // normalise across octave wrap (e.g. a "9" given 2 semitones instead of 14)
  while (acc > 6) acc -= 12;
  while (acc < -6) acc += 12;
  return (acc > 0 ? "#".repeat(acc) : "b".repeat(-acc)) + number;
}

/** Simple label for a semitone distance (0–11) with no letter context. */
export const SIMPLE_INTERVAL_LABELS = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];

/** Plain-English names, used in tooltips and the Learn tab. */
const INTERVAL_NAMES: Record<string, string> = {
  "1": "Root",
  b2: "Minor 2nd",
  "2": "Major 2nd",
  "#2": "Augmented 2nd",
  b3: "Minor 3rd",
  "3": "Major 3rd",
  b4: "Diminished 4th",
  "4": "Perfect 4th",
  "#4": "Augmented 4th (tritone)",
  b5: "Diminished 5th (tritone)",
  "5": "Perfect 5th",
  "#5": "Augmented 5th",
  b6: "Minor 6th",
  "6": "Major 6th",
  bb7: "Diminished 7th",
  b7: "Minor 7th",
  "7": "Major 7th",
  b9: "Flat 9th",
  "9": "9th",
  "#9": "Sharp 9th",
  "11": "11th",
  "#11": "Sharp 11th",
  b13: "Flat 13th",
  "13": "13th",
};

export function intervalName(token: string): string {
  return INTERVAL_NAMES[token] ?? token;
}

/** Short descriptions of how each interval *sounds* — for the Learn tab. */
export const INTERVAL_SOUNDS: { semis: number; token: string; name: string; sound: string }[] = [
  { semis: 0, token: "1", name: "Unison / Root", sound: "Home. The note everything is measured from." },
  { semis: 1, token: "b2", name: "Minor 2nd (half step)", sound: "Crunchy, tense, sinister. Think horror-movie stabs." },
  { semis: 2, token: "2", name: "Major 2nd (whole step)", sound: "Open, gentle movement. Adds air to chords (sus2, add9)." },
  { semis: 3, token: "b3", name: "Minor 3rd", sound: "Sad, dark, soulful. The note that makes a chord minor." },
  { semis: 4, token: "3", name: "Major 3rd", sound: "Bright, happy, sunny. The note that makes a chord major." },
  { semis: 5, token: "4", name: "Perfect 4th", sound: "Strong, open, a bit unresolved (sus4)." },
  { semis: 6, token: "b5", name: "Tritone", sound: "Maximum restlessness. The engine of dominant & diminished chords." },
  { semis: 7, token: "5", name: "Perfect 5th", sound: "Rock solid, neutral, powerful. Power chords are root + 5th." },
  { semis: 8, token: "b6", name: "Minor 6th", sound: "Bittersweet, melancholic, cinematic." },
  { semis: 9, token: "6", name: "Major 6th", sound: "Sweet, warm, nostalgic." },
  { semis: 10, token: "b7", name: "Minor 7th", sound: "Bluesy, laid-back, funky. Turns chords into 7ths & m7s." },
  { semis: 11, token: "7", name: "Major 7th", sound: "Dreamy, yearning, sophisticated. Leans hard toward the root." },
];

/**
 * Colour family of an interval, used consistently across all diagrams so your
 * eye learns: orange = root, blue = 3rd, green = 5th, purple = 7th, gold = colour tones.
 */
export type ToneRole = "root" | "third" | "fifth" | "seventh" | "ext" | "other";

export function toneRole(token: string): ToneRole {
  const n = parseInterval(token).number;
  if (n === 1 || n === 8) return "root";
  if (n === 3) return "third";
  if (n === 5) return "fifth";
  if (n === 7) return "seventh";
  return "ext"; // 2, 4, 6, 9, 11, 13 — the colour tones
}
