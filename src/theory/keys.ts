/**
 * Harmony in a key: which chords live in it, what job each one does,
 * and which "outside" chords you can borrow to escape the obvious.
 */
import {
  CHORD_TYPES,
  ChordRef,
  ChordType,
  chordPcs,
  chordTypeFromIntervals,
  defaultRomanSuffix,
  getChordType,
  isMinorish,
} from "./chords";
import { intervalNote, makeToken, parseInterval } from "./intervals";
import { accidentalCount, letterIndex, mod12, parseNote, pc } from "./notes";
import { bestTonicSpelling, getScale, isHeptatonic, scaleNotes, scalePcs, signaturePcs } from "./scales";

export interface Key {
  tonic: string; // spelled
  scaleId: string;
}

export const keyScale = (k: Key) => getScale(k.scaleId);
export const keyName = (k: Key) => `${k.tonic} ${keyScale(k).name}`;

export type Role = "home" | "stable" | "motion" | "tension";

export const ROLE_INFO: Record<Role, { label: string; blurb: string }> = {
  home: { label: "Home", blurb: "Total rest. Songs feel finished here." },
  stable: { label: "Near home", blurb: "Calm, shares notes with home. A softer home." },
  motion: { label: "Away", blurb: "Takes the song on a journey away from home." },
  tension: { label: "Tension", blurb: "Restless, wants to fall back home." },
};

export interface KeyChord {
  ref: ChordRef;
  type: ChordType;
  roman: string;
  /** degree 1–7 for diatonic chords */
  degree?: number;
  role?: Role;
  /** Contains the mode's signature note */
  signature?: boolean;
  notes: string[];
  /** Where it comes from + why it's interesting */
  source?: string;
  explain?: string;
  /** A few words on what it does ("Leads into C#m") */
  short?: string;
}

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** Degree token of `note` relative to `tonic`, using letter names: ("B","D") → "b3" */
export function degreeToken(tonic: string, note: string): string {
  const t = parseNote(tonic);
  const n = parseNote(note);
  const steps = (letterIndex(n.letter) - letterIndex(t.letter) + 7) % 7;
  return makeToken(steps + 1, mod12(pc(note) - pc(tonic)));
}

/** Roman numeral for a chord rooted on a degree: ("b3", m7) → "biii7" */
export function romanNumeral(degreeTok: string, type: ChordType): string {
  const iv = parseInterval(degreeTok);
  const accidental = degreeTok.replace(/\d+/g, "");
  let num = NUMERALS[(iv.number - 1) % 7];
  const lower = isMinorish(type);
  if (lower) num = num.toLowerCase();
  return accidental + num + defaultRomanSuffix(type);
}

/**
 * Spell a pitch class sensibly inside a key: scale notes use the key's spelling,
 * outside notes use the most common chromatic spelling (♭3, ♭6, ♭7, ♯4 …).
 */
export function spellInKey(p: number, key: Key): string {
  const scale = keyScale(key);
  const tonicPc = pc(key.tonic);
  const notes = scaleNotes(key.tonic, scale);
  const idx = notes.findIndex((n) => pc(n) === mod12(p));
  if (idx >= 0) return notes[idx];
  const semis = mod12(p - tonicPc);
  const has4 = scalePcs(tonicPc, scale).includes(mod12(tonicPc + 5));
  // preferred chromatic degree first, then its enharmonic alternative
  const TOKENS: Record<number, string[]> = {
    0: ["1"], 1: ["b2", "#1"], 2: ["2"], 3: ["b3", "#2"], 4: ["3"], 5: ["4"],
    6: has4 ? ["#4", "b5"] : ["b5", "#4"], 7: ["5"], 8: ["b6", "#5"], 9: ["6"], 10: ["b7", "#6"], 11: ["7"],
  };
  const options = TOKENS[semis].map((t) => intervalNote(key.tonic, t));
  options.sort((a, b) => accidentalCount(a) - accidentalCount(b)); // stable: keeps preference on ties
  return accidentalCount(options[0]) <= 1 ? options[0] : simpleSpelling(p, key.tonic);
}

function simpleSpelling(p: number, tonic: string): string {
  const flats = tonic.includes("b") || tonic === "F";
  const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  return (flats ? FLAT : SHARP)[mod12(p)];
}

/**
 * Make an outside-the-key spelling friendly to read (E♯ → F, C♭ → B, F𝄪 → G),
 * unless the key itself uses that spelling.
 */
export function friendlySpelling(note: string, key: Key): string {
  const inKey = scaleNotes(key.tonic, keyScale(key));
  if (inKey.includes(note)) return note;
  if (accidentalCount(note) > 1 || ["E#", "B#", "Cb", "Fb"].includes(note)) return spellInKey(pc(note), key);
  return note;
}

/** Stack thirds from each degree of a 7-note scale. size 3 = triads, 4 = 7ths, 5 = 9ths … */
export function diatonicChords(key: Key, size: 3 | 4 | 5 = 3): KeyChord[] {
  const scale = keyScale(key);
  if (!isHeptatonic(scale)) return [];
  const notes = scaleNotes(key.tonic, scale);
  const tonicPc = pc(key.tonic);
  const tonicTriad = [0, 2, 4].map((i) => pc(notes[i]));
  const scaleSet = scalePcs(tonicPc, scale);
  const neighbours = [mod12(tonicPc + 1), mod12(tonicPc - 1)].filter((p) => scaleSet.includes(p));
  const sig = signaturePcs(tonicPc, scale);

  const out: KeyChord[] = [];
  for (let d = 0; d < 7; d++) {
    const root = notes[d];
    const tokens: string[] = [];
    const chordNotes: string[] = [];
    for (let k = 0; k < size; k++) {
      const n = notes[(d + 2 * k) % 7];
      chordNotes.push(n);
      const number = 2 * k + 1;
      let semis = mod12(pc(n) - pc(root));
      if (number >= 9) semis += 12;
      tokens.push(makeToken(number, semis));
    }
    const type = chordTypeFromIntervals(tokens);
    if (!type) continue; // not a nameable stack (rare, exotic scales)
    const pcs = chordNotes.map(pc);
    let role: Role;
    const unstable = type.intervals.includes("b5") || type.intervals.includes("#5");
    if (d === 0) role = "home";
    else if (unstable) role = "tension"; // diminished & augmented chords never feel like rest
    else if (pcs.filter((p) => tonicTriad.includes(p)).length >= 2) role = "stable";
    else if (!pcs.includes(tonicPc) && pcs.some((p) => neighbours.includes(p))) role = "tension";
    else role = "motion";
    out.push({
      ref: { root, typeId: type.id },
      type,
      roman: romanNumeral(degreeToken(key.tonic, root), type),
      degree: d + 1,
      role,
      signature: d !== 0 && pcs.some((p) => sig.includes(p)),
      notes: chordNotes,
      source: "Diatonic",
    });
  }
  return out;
}

/**
 * EVERY chord in the library whose notes all live inside the scale,
 * grouped by the scale degree it's built on. This is "all the chords in the key".
 */
export function chordsInScale(key: Key): { degree: number; root: string; token: string; chords: KeyChord[] }[] {
  const scale = keyScale(key);
  const notes = scaleNotes(key.tonic, scale);
  const set = new Set(scalePcs(pc(key.tonic), scale));
  // a chord tone is called what the key calls that note: in C major the ♭5 of F is B, not C♭
  const named = new Map(notes.map((n) => [pc(n), n]));
  return notes.map((root, i) => {
    const token = degreeToken(key.tonic, root);
    const chords: KeyChord[] = [];
    for (const type of CHORD_TYPES) {
      const pcs = chordPcs(pc(root), type);
      if (!pcs.every((p) => set.has(p))) continue;
      chords.push({
        ref: { root, typeId: type.id },
        type,
        roman: romanNumeral(token, type),
        degree: i + 1,
        notes: type.intervals.map((iv) => named.get(pc(intervalNote(root, iv))) ?? intervalNote(root, iv)),
        source: "In key",
      });
    }
    return { degree: i + 1, root, token, chords };
  });
}

const chordKey = (rootPc: number, typeId: string) => `${rootPc}:${typeId}`;

/**
 * Modal interchange: chords borrowed from parallel scales (same tonic, different mode).
 * In B major you can borrow from B minor: G (♭VI), A (♭VII), D (♭III), Em (iv) …
 */
export type BorrowedChord = KeyChord & { from: string[]; fromIds: string[]; outside: number };

export function borrowedChords(key: Key): BorrowedChord[] {
  const current = keyScale(key);
  const tonicPc = pc(key.tonic);
  const own = new Set<string>();
  for (const size of [3, 4] as const) for (const c of diatonicChords(key, size)) own.add(chordKey(pc(c.ref.root), c.type.id));
  const keySet = new Set(scalePcs(tonicPc, current));

  // most useful / common sources first: the parallel minor is the classic "borrow"
  const sources = [
    "aeolian", "dorian", "mixolydian", "lydian", "phrygian", "ionian",
    "harmonicMinor", "melodicMinor", "harmonicMajor", "phrygianDominant", "locrian",
  ].filter((id) => id !== current.id);
  const found = new Map<string, KeyChord & { from: string[]; fromIds: string[] }>();
  for (const sid of sources) {
    const src = getScale(sid);
    for (const size of [3, 4] as const) {
      for (const c of diatonicChords({ tonic: key.tonic, scaleId: sid }, size)) {
        const rp = pc(c.ref.root);
        const k = chordKey(rp, c.type.id);
        if (own.has(k)) continue;
        if (c.type.synthetic) continue;
        const existing = found.get(k);
        if (existing) {
          if (!existing.from.includes(src.short)) {
            existing.from.push(src.short);
            existing.fromIds.push(src.id);
          }
          continue;
        }
        const root = accidentalCount(c.ref.root) > 1 ? spellInKey(rp, key) : c.ref.root;
        found.set(k, {
          ...c,
          ref: { root, typeId: c.type.id },
          notes: c.type.intervals.map((iv) => intervalNote(root, iv)),
          roman: romanNumeral(degreeToken(key.tonic, root), c.type),
          role: undefined,
          signature: undefined,
          from: [src.short],
          fromIds: [src.id],
        });
      }
    }
  }
  const list = [...found.values()].map((c) => {
    const outside = chordPcs(pc(c.ref.root), c.type).filter((p) => !keySet.has(p)).length;
    return {
      ...c,
      source: `Borrowed from ${c.from.join(", ")}`,
      explain:
        outside === 1
          ? "Changes just one note from your key: a subtle shift in colour."
          : `Brings in ${outside} notes from outside your key: a bold colour change.`,
      outside,
    };
  });
  list.sort((a, b) => a.outside - b.outside || a.type.intervals.length - b.type.intervals.length);
  return list;
}

/**
 * Chromatic "spice" chords that point at diatonic chords:
 * secondary dominants (V7/x), tritone subs (subV7/x), leading-tone diminished (vii°7/x),
 * chromatic mediants and the Neapolitan.
 */
export function spiceChords(key: Key): { group: string; blurb: string; chords: KeyChord[] }[] {
  const diatonic = diatonicChords(key, 3);
  const tonicPc = pc(key.tonic);
  const own = new Set<string>();
  for (const size of [3, 4] as const) for (const c of diatonicChords(key, size)) own.add(chordKey(pc(c.ref.root), c.type.id));

  const make = (root0: string, typeId: string, roman: string, explain: string, source: string, short?: string): KeyChord => {
    const type = getChordType(typeId);
    const root = friendlySpelling(root0, key);
    return {
      ref: { root, typeId },
      type,
      roman,
      notes: type.intervals.map((iv) => intervalNote(root, iv)),
      source,
      short,
      explain,
    };
  };

  const targets = diatonic.filter((c) => c.type.id === "maj" || c.type.id === "min");
  const secondary: KeyChord[] = [];
  const tritone: KeyChord[] = [];
  const leading: KeyChord[] = [];
  for (const t of targets) {
    const label = t.roman;
    const isTonic = t.degree === 1;
    const v = make(intervalNote(t.ref.root, "5"), "7", isTonic ? "V7" : `V7/${label}`, `Pulls strongly into ${t.ref.root}${t.type.symbol} (${label}).`, "Secondary dominant", `Leads into ${t.ref.root}${t.type.symbol}`);
    secondary.push(v);
    tritone.push(make(intervalNote(t.ref.root, "b2"), "7", isTonic ? "subV7" : `subV7/${label}`, `Slides down a half step into ${t.ref.root}${t.type.symbol}. A jazzy swap for V7/${label}.`, "Tritone substitution", `Slides into ${t.ref.root}${t.type.symbol}`));
    leading.push(make(intervalNote(t.ref.root, "7"), "dim7", isTonic ? "vii°7" : `vii°7/${label}`, `Creeps up a half step into ${t.ref.root}${t.type.symbol}. Suspenseful.`, "Leading-tone diminished", `Creeps into ${t.ref.root}${t.type.symbol}`));
  }

  // chromatic mediants: same quality as the tonic chord, root a 3rd away, not already in the key
  const tonicChord = diatonic[0];
  const tonicQuality = tonicChord && isMinorish(tonicChord.type) ? "min" : "maj";
  const mediants: KeyChord[] = [];
  for (const semis of [3, 4, 8, 9]) {
    for (const q of [tonicQuality, tonicQuality === "maj" ? "min" : "maj"]) {
      const rp = mod12(tonicPc + semis);
      if (own.has(chordKey(rp, q))) continue;
      const root = spellInKey(rp, key);
      const type = getChordType(q);
      const roman = romanNumeral(degreeToken(key.tonic, root), type);
      const common = chordPcs(rp, type).filter((p) => (tonicChord ? chordPcs(pc(tonicChord.ref.root), tonicChord.type) : []).includes(p)).length;
      mediants.push(
        make(root, q, roman, common === 1 ? "Shares one note with home: a cinematic, goosebump shift." : "A sudden, colourful jump that still feels connected.", "Chromatic mediant", "Cinematic shift"),
      );
    }
  }

  const neapolitan: KeyChord[] = [];
  if (!own.has(chordKey(mod12(tonicPc + 1), "maj"))) {
    neapolitan.push(make(intervalNote(key.tonic, "b2"), "maj", "bII", "The Neapolitan: a dramatic, dark-gold chord a half step above home. Great before V or straight back to i.", "Neapolitan", "Dark & dramatic"));
  }

  const dedupe = (arr: KeyChord[]) => {
    const seen = new Set<string>();
    return arr.filter((c) => {
      const k = chordKey(pc(c.ref.root), c.type.id);
      if (seen.has(k) || own.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  return [
    { group: "Secondary dominants", blurb: "Borrow the V7 of any chord in your key to make it feel like a temporary home.", chords: dedupe(secondary) },
    { group: "Chromatic mediants", blurb: "Chords a 3rd away from home that break the key. Instant film-score emotion.", chords: dedupe(mediants) },
    { group: "Tritone substitutions", blurb: "Swap any V7 for the 7 chord a tritone away. It resolves by sliding a half step.", chords: dedupe(tritone) },
    { group: "Passing diminished", blurb: "A dim7 a half step below a chord leads into it like a ramp.", chords: dedupe(leading) },
    { group: "Neapolitan", blurb: "The ♭II major chord: dark, noble, operatic.", chords: dedupe(neapolitan) },
  ].filter((g) => g.chords.length > 0);
}

/** How a chord relates to a key: its Roman numeral and whether it's in / borrowed / chromatic. */
export function analyzeChord(ref: ChordRef, key: Key): { roman: string; status: "diatonic" | "borrowed" | "chromatic"; source: string; role?: Role } {
  const type = getChordType(ref.typeId);
  const rp = pc(ref.root);
  const roman = romanNumeral(degreeToken(key.tonic, ref.root), type) + (ref.bass && pc(ref.bass) !== rp ? `/${degreeToken(key.tonic, ref.bass)}` : "");
  const scale = keyScale(key);
  const set = new Set(scalePcs(pc(key.tonic), scale));
  if (chordPcs(rp, type).every((p) => set.has(p))) {
    const role = diatonicChords(key, 3).find((c) => pc(c.ref.root) === rp)?.role;
    return { roman, status: "diatonic", source: "In key", role };
  }
  const b = borrowedChords(key).find((c) => pc(c.ref.root) === rp && c.type.id === type.id);
  if (b) return { roman, status: "borrowed", source: b.source ?? "Borrowed" };
  for (const g of spiceChords(key)) {
    const s = g.chords.find((c) => pc(c.ref.root) === rp && c.type.id === type.id);
    if (s) return { roman: s.roman, status: "chromatic", source: g.group.replace(/s$/, "") };
  }
  return { roman, status: "chromatic", source: "Outside the key" };
}

/** Which major & minor keys a chord naturally belongs to (handy for modulation). */
export function keysContainingChord(ref: ChordRef): { key: Key; roman: string }[] {
  const type = getChordType(ref.typeId);
  const pcs = chordPcs(pc(ref.root), type);
  const out: { key: Key; roman: string }[] = [];
  for (const scaleId of ["ionian", "aeolian"]) {
    const scale = getScale(scaleId);
    for (let t = 0; t < 12; t++) {
      const set = new Set(scalePcs(t, scale));
      if (!pcs.every((p) => set.has(p))) continue;
      const key: Key = { tonic: bestTonicSpelling(t, scale), scaleId };
      const root = spellInKey(pc(ref.root), key);
      out.push({ key, roman: romanNumeral(degreeToken(key.tonic, root), type) });
    }
  }
  return out;
}

/** Transpose a spelled note by semitones, re-spelled for a key. */
export function transposeNote(note: string, semitones: number, key: Key): string {
  return spellInKey(pc(note) + semitones, key);
}

export function transposeRef(ref: ChordRef, semitones: number, key: Key): ChordRef {
  return {
    root: transposeNote(ref.root, semitones, key),
    typeId: ref.typeId,
    bass: ref.bass ? transposeNote(ref.bass, semitones, key) : undefined,
  };
}

