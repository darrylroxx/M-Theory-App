/**
 * Notes & pitch classes.
 *
 * A *pitch class* (pc) is a number 0–11 where C = 0, C♯/D♭ = 1 … B = 11.
 * A *spelled note* keeps the letter name too, because in music theory
 * A♯ and B♭ sound the same but mean different things (B major contains A♯,
 * F major contains B♭). Getting spelling right is what makes the app's
 * scales and chords read the way a teacher would write them.
 */

export const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
export type Letter = (typeof LETTERS)[number];

const LETTER_PC: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export interface SpelledNote {
  letter: Letter;
  /** Accidental: -2 = double flat, -1 = flat, 0 = natural, 1 = sharp, 2 = double sharp */
  acc: number;
}

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

export const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** Parse "C", "F#", "Bb", "C##", "Ebb", "F♯", "B♭", "Fx" into a spelled note. */
export function parseNote(name: string): SpelledNote {
  const clean = name.trim().replace(/♯/g, "#").replace(/♭/g, "b").replace(/𝄪/g, "##").replace(/𝄫/g, "bb");
  const letter = clean[0]?.toUpperCase() as Letter;
  if (!LETTERS.includes(letter)) throw new Error(`Invalid note name: ${name}`);
  let acc = 0;
  for (const ch of clean.slice(1)) {
    if (ch === "#") acc += 1;
    else if (ch === "x") acc += 2;
    else if (ch === "b") acc -= 1;
    else throw new Error(`Invalid note name: ${name}`);
  }
  return { letter, acc };
}

/** ASCII form: "C#", "Bb", "F##". */
export function noteToString(n: SpelledNote): string {
  return n.letter + (n.acc > 0 ? "#".repeat(n.acc) : "b".repeat(-n.acc));
}

export function pcOfSpelled(n: SpelledNote): number {
  return mod12(LETTER_PC[n.letter] + n.acc);
}

/** Pitch class of a note name. */
export function pc(name: string): number {
  return pcOfSpelled(parseNote(name));
}

/** Pretty display with real musical symbols: "C♯", "B♭", "F♯♯". */
export function displayNote(name: string): string {
  return name.replace(/##/g, "♯♯").replace(/#/g, "♯").replace(/(?<=[A-G])bb/g, "♭♭").replace(/(?<=[A-G♭])b/g, "♭");
}

/** Default spelling of a pitch class when there is no key context. */
export function defaultName(pitchClass: number, preferFlats = false): string {
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[mod12(pitchClass)];
}

/** Letter index 0–6 for C–B. */
export function letterIndex(l: Letter): number {
  return LETTERS.indexOf(l);
}

/**
 * Spell the note that is `steps` letters and `semitones` semitones above `root`.
 * e.g. spellAbove("B", 2, 4) → "D#" (a major 3rd above B is D♯, never E♭).
 */
export function spellAbove(root: string, letterSteps: number, semitones: number): string {
  const r = parseNote(root);
  const letter = LETTERS[(letterIndex(r.letter) + letterSteps) % 7];
  const targetPc = mod12(pcOfSpelled(r) + semitones);
  let acc = mod12(targetPc - LETTER_PC[letter]);
  if (acc > 6) acc -= 12; // choose the smallest accidental (-6..6)
  return noteToString({ letter, acc });
}

/** Number of accidentals in a spelling (double sharps count as 2). */
export function accidentalCount(name: string): number {
  return Math.abs(parseNote(name).acc);
}

/** Every reasonable spelling of a pitch class (natural, sharp or flat). */
export function spellingsOf(pitchClass: number): string[] {
  const out: string[] = [];
  for (const letter of LETTERS) {
    let acc = mod12(pitchClass - LETTER_PC[letter]);
    if (acc > 6) acc -= 12;
    if (Math.abs(acc) <= 1) out.push(noteToString({ letter, acc }));
  }
  return out;
}

/** MIDI number → frequency in Hz (A4 = 440). */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** MIDI number → name with octave, e.g. 40 → "E2". */
export function midiToName(midi: number, preferFlats = false): string {
  return defaultName(midi, preferFlats) + (Math.floor(midi / 12) - 1);
}
