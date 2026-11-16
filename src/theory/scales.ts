/**
 * Scales & modes.
 *
 * A mode is just a scale started from a different note. The trick to *hearing*
 * modes is the signature note: the one note that's different from plain
 * major or minor. Lean on it and the mode comes alive.
 */
import { intervalNote, semitonesOf } from "./intervals";
import { accidentalCount, mod12, pc, spellingsOf } from "./notes";

export type ScaleFamily =
  | "Major modes"
  | "Harmonic minor modes"
  | "Melodic minor modes"
  | "Pentatonic & blues"
  | "Symmetric"
  | "Exotic";

export const SCALE_FAMILIES: ScaleFamily[] = [
  "Major modes",
  "Harmonic minor modes",
  "Melodic minor modes",
  "Pentatonic & blues",
  "Exotic",
  "Symmetric",
];

export interface ScaleType {
  id: string;
  name: string;
  short: string;
  altNames?: string[];
  intervals: string[];
  family: ScaleFamily;
  /** For major modes: 7 = brightest (Lydian) … 1 = darkest (Locrian) */
  brightness?: number;
  /** Intervals that give the mode its unique flavour */
  signature?: string[];
  /** Compared with … */
  compareTo?: string;
  mood: string;
  description: string;
  /** Roman-numeral vamps that make the mode obvious to the ear */
  vamps?: string[][];
}

const S = (s: ScaleType) => s;

export const SCALES: ScaleType[] = [
  // ── The 7 modes of the major scale (brightest → darkest order is in `brightness`)
  S({
    id: "ionian", name: "Major (Ionian)", short: "Major", altNames: ["Ionian"],
    intervals: ["1", "2", "3", "4", "5", "6", "7"], family: "Major modes", brightness: 6,
    signature: [], compareTo: "the reference everything else is compared to",
    mood: "Happy, bright, resolved, singable",
    description: "The 'do re mi' scale. Strong pull home thanks to the 7th degree sitting a half step under the root.",
    vamps: [["I", "IV"], ["I", "V", "vi", "IV"], ["I", "iii", "IV", "V"]],
  }),
  S({
    id: "dorian", name: "Dorian", short: "Dorian",
    intervals: ["1", "2", "b3", "4", "5", "6", "b7"], family: "Major modes", brightness: 4,
    signature: ["6"], compareTo: "natural minor, but with a raised (natural) 6th",
    mood: "Minor but hopeful. Cool, soulful, funky, groovy",
    description: "A minor scale with a bright major 6th. That one note turns the IV chord major, the classic Dorian sound.",
    vamps: [["i", "IV"], ["i", "ii", "bIII", "IV"], ["i7", "IV7"]],
  }),
  S({
    id: "phrygian", name: "Phrygian", short: "Phrygian",
    intervals: ["1", "b2", "b3", "4", "5", "b6", "b7"], family: "Major modes", brightness: 2,
    signature: ["b2"], compareTo: "natural minor, but with a flat 2nd",
    mood: "Dark, Spanish / Middle-Eastern, heavy, menacing",
    description: "Minor with a flat 2nd right above the root. The half-step bII → i move is pure drama (flamenco, metal).",
    vamps: [["i", "bII"], ["i", "bII", "bIII", "bII"], ["i", "bvii", "bII", "i"]],
  }),
  S({
    id: "lydian", name: "Lydian", short: "Lydian",
    intervals: ["1", "2", "3", "#4", "5", "6", "7"], family: "Major modes", brightness: 7,
    signature: ["#4"], compareTo: "major, but with a raised 4th",
    mood: "Dreamy, floating, magical, cinematic wonder",
    description: "The brightest mode. The ♯4 turns the II chord major. Rock between I and II and you're in a film score.",
    vamps: [["I", "II"], ["I", "II", "vii", "I"], ["Imaj7", "II"]],
  }),
  S({
    id: "mixolydian", name: "Mixolydian", short: "Mixolydian",
    intervals: ["1", "2", "3", "4", "5", "6", "b7"], family: "Major modes", brightness: 5,
    signature: ["b7"], compareTo: "major, but with a flat 7th",
    mood: "Bright but laid-back. Bluesy rock, celebratory, anthemic",
    description: "Major with a flat 7th. The bVII major chord is its calling card (I → bVII → IV).",
    vamps: [["I", "bVII"], ["I", "bVII", "IV", "I"], ["I", "v", "IV"]],
  }),
  S({
    id: "aeolian", name: "Natural Minor (Aeolian)", short: "Minor", altNames: ["Aeolian"],
    intervals: ["1", "2", "b3", "4", "5", "b6", "b7"], family: "Major modes", brightness: 3,
    signature: ["b6"], compareTo: "Dorian, but with a flat 6th",
    mood: "Sad, serious, epic, emotional",
    description: "The standard minor scale. The ♭6 gives it that heavy-hearted, epic quality.",
    vamps: [["i", "bVI", "bIII", "bVII"], ["i", "bVII", "bVI", "bVII"], ["i", "iv", "bVI", "v"]],
  }),
  S({
    id: "locrian", name: "Locrian", short: "Locrian",
    intervals: ["1", "b2", "b3", "4", "b5", "b6", "b7"], family: "Major modes", brightness: 1,
    signature: ["b5"], compareTo: "Phrygian, but with a flat 5th",
    mood: "Unstable, dissonant, unsettling. Horror & experimental",
    description: "The darkest mode. Even the home chord is diminished, so it never quite feels at rest.",
    vamps: [["i°", "bII"], ["i°", "bII", "bvii", "bII"]],
  }),
  // ── Harmonic minor family
  S({
    id: "harmonicMinor", name: "Harmonic Minor", short: "Harm. minor",
    intervals: ["1", "2", "b3", "4", "5", "b6", "7"], family: "Harmonic minor modes",
    signature: ["7"], compareTo: "natural minor, but with a raised 7th",
    mood: "Dramatic, classical, exotic, neo-classical",
    description: "Minor with a raised 7th. Gives minor keys a powerful major V chord and an exotic gap between ♭6 and 7.",
    vamps: [["i", "V"], ["i", "bVI", "V"], ["i", "iv", "V"]],
  }),
  S({
    id: "locrianNat6", name: "Locrian ♮6", short: "Locrian ♮6",
    intervals: ["1", "b2", "b3", "4", "b5", "6", "b7"], family: "Harmonic minor modes",
    signature: ["6"], compareTo: "Locrian, but with a natural 6th",
    mood: "Dark, tense, mysterious", description: "Mode 2 of harmonic minor. Locrian with a lifted 6th.",
  }),
  S({
    id: "ionianSharp5", name: "Ionian ♯5 (Augmented Major)", short: "Ionian ♯5",
    intervals: ["1", "2", "3", "4", "#5", "6", "7"], family: "Harmonic minor modes",
    signature: ["#5"], compareTo: "major, but with a raised 5th",
    mood: "Shimmering, surreal, glassy", description: "Mode 3 of harmonic minor. Major with an augmented home chord.",
  }),
  S({
    id: "dorianSharp4", name: "Ukrainian Dorian (Dorian ♯4)", short: "Dorian ♯4",
    intervals: ["1", "2", "b3", "#4", "5", "6", "b7"], family: "Harmonic minor modes",
    signature: ["#4"], compareTo: "Dorian, but with a raised 4th",
    mood: "Eastern-European folk, klezmer, haunting", description: "Mode 4 of harmonic minor.",
    vamps: [["i", "II7"]],
  }),
  S({
    id: "phrygianDominant", name: "Phrygian Dominant", short: "Phryg. dom.", altNames: ["Spanish Gypsy", "Freygish"],
    intervals: ["1", "b2", "3", "4", "5", "b6", "b7"], family: "Harmonic minor modes",
    signature: ["b2", "3"], compareTo: "Phrygian, but with a major 3rd",
    mood: "Flamenco, Middle-Eastern, metal, snake-charmer exotic",
    description: "Mode 5 of harmonic minor. A major chord at home with a menacing ♭2 above it.",
    vamps: [["I", "bII"], ["I", "bII", "biii", "bII"], ["I", "iv", "bII", "I"]],
  }),
  S({
    id: "lydianSharp2", name: "Lydian ♯2", short: "Lydian ♯2",
    intervals: ["1", "#2", "3", "#4", "5", "6", "7"], family: "Harmonic minor modes",
    signature: ["#2", "#4"], compareTo: "Lydian, but with a raised 2nd",
    mood: "Bright, exotic, mystical", description: "Mode 6 of harmonic minor.",
  }),
  S({
    id: "ultralocrian", name: "Ultralocrian (Super Locrian 𝄫7)", short: "Ultralocrian",
    intervals: ["1", "b2", "b3", "b4", "b5", "b6", "bb7"], family: "Harmonic minor modes",
    signature: ["b4", "bb7"], compareTo: "Locrian with a flat 4th and double-flat 7th",
    mood: "Extremely dark and tense", description: "Mode 7 of harmonic minor. Home chord is a diminished 7th.",
  }),
  // ── Melodic minor family
  S({
    id: "melodicMinor", name: "Melodic Minor (Jazz Minor)", short: "Mel. minor",
    intervals: ["1", "2", "b3", "4", "5", "6", "7"], family: "Melodic minor modes",
    signature: ["6", "7"], compareTo: "major, but with a flat 3rd",
    mood: "Smooth, sophisticated, bittersweet", description: "Major with a minor 3rd. Elegant minor with no ♭6 heaviness.",
    vamps: [["i(maj7)", "IV7"], ["i", "ii", "IV"]],
  }),
  S({
    id: "dorianb2", name: "Dorian ♭2 (Phrygian ♮6)", short: "Dorian ♭2",
    intervals: ["1", "b2", "b3", "4", "5", "6", "b7"], family: "Melodic minor modes",
    signature: ["b2", "6"], compareTo: "Dorian, but with a flat 2nd",
    mood: "Dark but with a glint of light", description: "Mode 2 of melodic minor.",
  }),
  S({
    id: "lydianAugmented", name: "Lydian Augmented", short: "Lydian aug.",
    intervals: ["1", "2", "3", "#4", "#5", "6", "7"], family: "Melodic minor modes",
    signature: ["#4", "#5"], compareTo: "Lydian, but with a raised 5th",
    mood: "Weightless, sci-fi, very bright", description: "Mode 3 of melodic minor.",
  }),
  S({
    id: "lydianDominant", name: "Lydian Dominant (Overtone)", short: "Lydian dom.",
    intervals: ["1", "2", "3", "#4", "5", "6", "b7"], family: "Melodic minor modes",
    signature: ["#4", "b7"], compareTo: "Mixolydian, but with a raised 4th",
    mood: "Playful, quirky, whimsical, fusion", description: "Mode 4 of melodic minor. Bright Lydian ♯4 meets bluesy ♭7.",
    vamps: [["I7", "II"], ["I", "II", "bVII"]],
  }),
  S({
    id: "mixolydianb6", name: "Mixolydian ♭6 (Aeolian Dominant)", short: "Mixo ♭6",
    intervals: ["1", "2", "3", "4", "5", "b6", "b7"], family: "Melodic minor modes",
    signature: ["3", "b6"], compareTo: "Mixolydian, but with a flat 6th",
    mood: "Bittersweet, heroic-sad, cinematic", description: "Mode 5 of melodic minor. A major home chord with minor-key heartbreak.",
    vamps: [["I", "iv", "bVI", "bVII"], ["I", "bVI", "bVII", "I"]],
  }),
  S({
    id: "locrianNat2", name: "Locrian ♮2 (Half-Diminished)", short: "Locrian ♮2",
    intervals: ["1", "2", "b3", "4", "b5", "b6", "b7"], family: "Melodic minor modes",
    signature: ["2", "b5"], compareTo: "Locrian, but with a natural 2nd",
    mood: "Dark, smoky, unresolved", description: "Mode 6 of melodic minor. The scale for m7♭5 chords.",
  }),
  S({
    id: "altered", name: "Altered (Super Locrian)", short: "Altered",
    intervals: ["1", "b2", "b3", "b4", "b5", "b6", "b7"], family: "Melodic minor modes",
    signature: ["b2", "b4"], compareTo: "every tension a dominant chord can have",
    mood: "Maximum tension, jazzy outside sounds", description: "Mode 7 of melodic minor. Used over altered dominant chords before they resolve.",
  }),
  // ── Pentatonic & blues
  S({
    id: "majorPentatonic", name: "Major Pentatonic", short: "Maj. pent.",
    intervals: ["1", "2", "3", "5", "6"], family: "Pentatonic & blues",
    mood: "Sweet, open, country / pop / folk", description: "Major scale without the 4th and 7th, so there are no clashing notes.",
  }),
  S({
    id: "minorPentatonic", name: "Minor Pentatonic", short: "Min. pent.",
    intervals: ["1", "b3", "4", "5", "b7"], family: "Pentatonic & blues",
    mood: "Rock, blues, soulful", description: "The guitarist's home base: 5 notes, no wrong ones.",
  }),
  S({
    id: "blues", name: "Blues Scale", short: "Blues",
    intervals: ["1", "b3", "4", "b5", "5", "b7"], family: "Pentatonic & blues",
    signature: ["b5"], mood: "Gritty, bluesy, attitude", description: "Minor pentatonic plus the ♭5 'blue note'.",
  }),
  S({
    id: "majorBlues", name: "Major Blues", short: "Maj. blues",
    intervals: ["1", "2", "b3", "3", "5", "6"], family: "Pentatonic & blues",
    signature: ["b3"], mood: "Happy blues, country, soul", description: "Major pentatonic with the ♭3 as a passing 'blue' note.",
  }),
  S({
    id: "egyptian", name: "Suspended Pentatonic (Egyptian)", short: "Sus pent.",
    intervals: ["1", "2", "4", "5", "b7"], family: "Pentatonic & blues",
    mood: "Open, ancient, ambiguous", description: "No 3rd at all. Neither major nor minor.",
  }),
  S({
    id: "hirajoshi", name: "Hirajoshi", short: "Hirajoshi",
    intervals: ["1", "2", "b3", "5", "b6"], family: "Pentatonic & blues",
    mood: "Japanese, delicate, melancholic", description: "A Japanese pentatonic with a bittersweet ♭6.",
  }),
  S({
    id: "insen", name: "In Sen", short: "In Sen",
    intervals: ["1", "b2", "4", "5", "b7"], family: "Pentatonic & blues",
    mood: "Japanese, sparse, mysterious", description: "A Japanese pentatonic with a dark ♭2.",
  }),
  // ── Exotic heptatonic
  S({
    id: "harmonicMajor", name: "Harmonic Major", short: "Harm. major",
    intervals: ["1", "2", "3", "4", "5", "b6", "7"], family: "Exotic",
    signature: ["b6"], compareTo: "major, but with a flat 6th",
    mood: "Major with a bittersweet, romantic twist", description: "Gives a major key the minor iv chord naturally.",
    vamps: [["I", "iv"], ["I", "bVI+", "iv", "I"]],
  }),
  S({
    id: "doubleHarmonic", name: "Double Harmonic (Byzantine)", short: "Dbl. harmonic",
    intervals: ["1", "b2", "3", "4", "5", "b6", "7"], family: "Exotic",
    signature: ["b2", "b6"], mood: "Arabic, Middle-Eastern, intensely exotic",
    description: "Two exotic 'gaps' (augmented 2nds). Instantly evocative.",
    vamps: [["I", "bII"], ["I", "bII", "I", "iii"]],
  }),
  S({
    id: "hungarianMinor", name: "Hungarian Minor", short: "Hungarian min.",
    intervals: ["1", "2", "b3", "#4", "5", "b6", "7"], family: "Exotic",
    signature: ["#4", "7"], mood: "Gypsy, dramatic, gothic", description: "Harmonic minor with a raised 4th.",
  }),
  S({
    id: "neapolitanMinor", name: "Neapolitan Minor", short: "Neap. minor",
    intervals: ["1", "b2", "b3", "4", "5", "b6", "7"], family: "Exotic",
    signature: ["b2", "7"], mood: "Operatic, dark, dramatic", description: "Harmonic minor with a flat 2nd.",
  }),
  S({
    id: "neapolitanMajor", name: "Neapolitan Major", short: "Neap. major",
    intervals: ["1", "b2", "b3", "4", "5", "6", "7"], family: "Exotic",
    signature: ["b2"], mood: "Strange, bright-dark, romantic", description: "Melodic minor with a flat 2nd.",
  }),
  // ── Symmetric
  S({
    id: "wholeTone", name: "Whole Tone", short: "Whole tone",
    intervals: ["1", "2", "3", "#4", "#5", "b7"], family: "Symmetric",
    mood: "Dreamy, weightless, dream-sequence", description: "Only whole steps, so there's no gravity and no home.",
  }),
  S({
    id: "dimHW", name: "Diminished (Half-Whole)", short: "Dim. H-W", altNames: ["Dominant diminished"],
    intervals: ["1", "b2", "#2", "3", "#4", "5", "6", "b7"], family: "Symmetric",
    mood: "Tense, jazzy, angular", description: "Alternating half & whole steps. Great over 7♭9 chords.",
  }),
  S({
    id: "dimWH", name: "Diminished (Whole-Half)", short: "Dim. W-H",
    intervals: ["1", "2", "b3", "4", "b5", "b6", "6", "7"], family: "Symmetric",
    mood: "Suspenseful, mysterious", description: "Alternating whole & half steps. Fits diminished 7th chords.",
  }),
];

const BY_ID = new Map(SCALES.map((s) => [s.id, s]));

export function getScale(id: string): ScaleType {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`Unknown scale: ${id}`);
  return s;
}

export const MAJOR_MODE_IDS = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"];

/** Brightest → darkest: Lydian, Ionian, Mixolydian, Dorian, Aeolian, Phrygian, Locrian */
export const MODES_BY_BRIGHTNESS = SCALES.filter((s) => s.family === "Major modes").sort(
  (a, b) => (b.brightness ?? 0) - (a.brightness ?? 0),
);

export const isHeptatonic = (s: ScaleType) => s.intervals.length === 7;

export function scalePcs(tonicPc: number, scale: ScaleType): number[] {
  return scale.intervals.map((iv) => mod12(tonicPc + semitonesOf(iv)));
}

/** Spelled notes of a scale: scaleNotes("B", major) → B C# D# E F# G# A# */
export function scaleNotes(tonic: string, scale: ScaleType): string[] {
  return scale.intervals.map((iv) => intervalNote(tonic, iv));
}

/**
 * Choose how to spell the tonic so the scale has the fewest accidentals
 * (e.g. pitch class 1 in major → D♭ major (5♭) rather than C♯ major (7♯)).
 */
export function bestTonicSpelling(tonicPc: number, scale: ScaleType): string {
  const candidates = spellingsOf(tonicPc);
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const notes = scaleNotes(c, scale);
    let score = 0;
    for (const n of notes) {
      const a = accidentalCount(n);
      score += a === 2 ? 10 : a; // double accidentals are a strong no
    }
    score += accidentalCount(c) * 0.5; // prefer a natural tonic name (E# major → F major)
    if (c.includes("#")) score -= 0.1; // tie-break toward sharps (F# over Gb)
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** The other common spelling of the tonic (for an enharmonic toggle), if any. */
export function enharmonicTonic(tonic: string): string | null {
  const alts = spellingsOf(pc(tonic)).filter((s) => s !== tonic && s.length === 2);
  return alts[0] ?? null;
}

/** Key signature summary for heptatonic scales: e.g. B major → 5 sharps. */
export function keySignature(tonic: string, scale: ScaleType): { sharps: string[]; flats: string[] } {
  const notes = scaleNotes(tonic, scale);
  return {
    sharps: notes.filter((n) => n.includes("#")),
    flats: notes.filter((n) => /^[A-G]b/.test(n)),
  };
}

/**
 * Other scales that use exactly the same notes ("relative modes").
 * B major = C♯ Dorian = D♯ Phrygian = E Lydian = F♯ Mixolydian = G♯ minor = A♯ Locrian.
 */
export function relativeModes(tonic: string, scale: ScaleType): { tonic: string; scale: ScaleType }[] {
  const notes = scaleNotes(tonic, scale);
  const semis = scale.intervals.map(semitonesOf);
  const out: { tonic: string; scale: ScaleType }[] = [];
  for (let i = 1; i < semis.length; i++) {
    const rotated = semis.map((_, j) => mod12(semis[(i + j) % semis.length] - semis[i])).join(",");
    const match = SCALES.find(
      (s) => s.intervals.length === semis.length && s.intervals.map(semitonesOf).map(mod12).join(",") === rotated,
    );
    if (match) out.push({ tonic: notes[i], scale: match });
  }
  return out;
}

/** Signature intervals expressed as pitch classes for a given tonic. */
export function signaturePcs(tonicPc: number, scale: ScaleType): number[] {
  return (scale.signature ?? []).map((iv) => mod12(tonicPc + semitonesOf(iv)));
}
