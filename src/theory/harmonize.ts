/**
 * Harmonize: write a new track that fits one that is already there.
 *
 * What is offered (HARMONY_MENU, best first, after the research in THEORY): a new melody line
 * sings with a tune (a high or a low harmony, a third away and bending to each chord; a
 * counter-melody of its own; long notes, one per chord; an answer in the tune's gaps) or is
 * written from a chords track (long notes, a counter-melody, a walk through the chord notes). A
 * new chords track goes with another (the same chords richer, suspended, over a held bass note),
 * or plays instead of it (some chords from the parallel key, each chord's relative, lead-ins), or
 * is chosen to carry a tune (Best fit, a Viterbi search over the key's chords). The options are
 * harmony only: none of them chooses how the new track sounds.
 *
 * Older options (pad, higher voicing, shell, smooth inversions, passing diminished, tritone swap,
 * sixth below, octave, drone) are kept so tracks written with them can still be written again;
 * they are never offered for a new track.
 *
 * The rules are the ones harmony and counterpoint teaching gives, coded as tests and costs:
 *  - diatonic thirds and sixths move each note so many steps of the scale (so a "third" is three
 *    or four semitones, whichever the key says), and on strong beats bend to a note of the chord
 *    underneath (the fallback ladder of the Contrapunk engine, MIT);
 *  - a note a semitone above a chord tone is an "avoid" note (it rubs as a minor ninth);
 *  - in a counter-line, strong beats are consonant, contrary and oblique motion are preferred,
 *    parallel fifths and octaves never happen, a leap is answered by a step the other way, and
 *    passing notes fill a third by step on weak beats (species counterpoint, as summarised from
 *    Open Music Theory; the parallel test follows music21, BSD-3);
 *  - colour tones and substitutions are only offered where they fit the key and the chord's job
 *    (available tensions after jazzband, ISC; applied and borrowed chords after Open Music Theory),
 *    and every swap is checked against the melody's strong notes when there is a melody;
 *  - all of it is deterministic: the same input and seed always give the same track.
 *
 * Time is in twelfths of a beat (as melodies are), a bar is `bar` beats, a section `bars` bars.
 * See research_notes/Synths harmony stems and vibe painting/harmony_voicing.md for the sources.
 *
 * Using it for one section of a new track (the caller loops over the song's sections):
 *   const sig = sectionSig(p, partId);
 *   harmonize({ kind: "melody", option: "third-above", key,
 *               source: { melody: thatTrack.melody }, under: thatSection.chords,
 *               bar: sigBeats(sig), compound: isCompound(sig), bars: sectionBars })
 *     → { melody }        (or { chords } for a chords track)
 * A chords track written from a melody takes the section's chords as `under` too: its layers
 * then sit on them (only "Best fit" chooses new chords for the tune). Chords come back with
 * fresh ids and no pinned voicing.
 */
import type { ProgChord } from "../ui/state";
import { TICKS, melodyBase, type Melody, type MelodyNote } from "../song/melody";
import { chordNotes, findChordType, getChordType, isMinorish, type ChordRef, type ChordType } from "./chords";
import { intervalNote, parseInterval, semitonesOf } from "./intervals";
import { borrowedChords, degreeToken, diatonicChords, friendlySpelling, keyScale, spellInKey, type Key } from "./keys";
import { mod12, parseNote, pc } from "./notes";
import { isDominantType, seededRng } from "./progression";
import { getScale, isHeptatonic, scaleNotes, scalePcs } from "./scales";

// ── The options ────────────────────────────────────────────────

/** The kind of the new track. */
export type HarmonyKind = "melody" | "chords";
/** The kind of track it is written from. */
export type SourceKind = "chords" | "melody";

export interface HarmonyOption {
  id: string;
  /** the new track's kind */
  kind: HarmonyKind;
  label: string;
  /** one line on what it does */
  hint: string;
  /** which tracks it can be written from */
  from: SourceKind[];
  /**
   * A re-harmonisation: the new chords differ from the source's where they change, so the two
   * clash if both play at once there. Meant to be played instead of the source (or in another
   * section). Every other option is written to sound together with its source.
   */
  instead?: boolean;
}

export const MELODY_HARMONY: HarmonyOption[] = [
  { id: "third-above", kind: "melody", label: "High harmony", hint: "A second voice just above the tune", from: ["melody"] },
  { id: "third-below", kind: "melody", label: "Low harmony", hint: "A second voice just below the tune", from: ["melody"] },
  { id: "counter", kind: "melody", label: "Counter-melody", hint: "A line of its own, moving against yours", from: ["melody", "chords"] },
  { id: "slow-line", kind: "melody", label: "Long notes", hint: "One long note for each chord", from: ["chords", "melody"] },
  { id: "answer", kind: "melody", label: "Answer", hint: "Answers the tune in its gaps", from: ["melody"] },
  { id: "chord-tones", kind: "melody", label: "Chord notes", hint: "Walks through the notes of each chord", from: ["melody", "chords"] },
  // kept for tracks written with them; never offered for a new track
  { id: "sixth-below", kind: "melody", label: "Sixth below", hint: "The third above an octave down: warm and low", from: ["melody"] },
  { id: "octave", kind: "melody", label: "Octave", hint: "The tune doubled an octave away", from: ["melody"] },
  { id: "drone", kind: "melody", label: "Drone", hint: "One note under everything: home, or its fifth", from: ["chords", "melody"] },
];

export const CHORD_HARMONY: HarmonyOption[] = [
  { id: "fit", kind: "chords", label: "Best fit", hint: "Chords chosen to carry the tune", from: ["melody"] },
  { id: "colour", kind: "chords", label: "Richer", hint: "Your chords with 7ths, 9ths and 6ths", from: ["chords", "melody"] },
  { id: "sus", kind: "chords", label: "Sus", hint: "Your chords suspended: open and airy", from: ["chords", "melody"] },
  { id: "borrowed", kind: "chords", label: "Darker", hint: "Some chords from the minor key", from: ["chords", "melody"], instead: true },
  { id: "relative", kind: "chords", label: "Relative", hint: "Each chord swapped for its relative: major for minor", from: ["chords", "melody"], instead: true },
  { id: "pedal", kind: "chords", label: "Pedal bass", hint: "Your chords over one held bass note", from: ["chords", "melody"] },
  { id: "lead-in", kind: "chords", label: "Lead-ins", hint: "A 7th chord that pulls into the next one", from: ["chords", "melody"], instead: true },
  // kept for tracks written with them; never offered for a new track
  { id: "pad", kind: "chords", label: "Pad", hint: "The same chords held high above", from: ["chords", "melody"] },
  { id: "higher", kind: "chords", label: "Higher voicing", hint: "The same chords spread wide and up", from: ["chords", "melody"] },
  { id: "shell", kind: "chords", label: "Shell", hint: "Root, 3rd and 7th only", from: ["chords", "melody"] },
  { id: "smooth", kind: "chords", label: "Smooth inversions", hint: "The same chords with the bass moving by step", from: ["chords", "melody"] },
  { id: "passing", kind: "chords", label: "Passing dim", hint: "A diminished chord sliding up into the next", from: ["chords", "melody"], instead: true },
  { id: "tritone", kind: "chords", label: "Tritone swap", hint: "Each dominant swapped for the one a tritone away", from: ["chords", "melody"], instead: true },
];

export const HARMONY_OPTIONS: HarmonyOption[] = [...MELODY_HARMONY, ...CHORD_HARMONY];

/**
 * What Harmonize offers for a new track, best first, by the new track's kind and the kind of
 * track it goes with. Every other option is retired: kept only so old tracks can be written again.
 */
export const HARMONY_MENU: Record<HarmonyKind, Record<SourceKind, string[]>> = {
  melody: {
    melody: ["third-above", "third-below", "counter", "slow-line", "answer"],
    chords: ["slow-line", "counter", "chord-tones"],
  },
  chords: {
    chords: ["colour", "sus", "borrowed", "relative", "pedal", "lead-in"],
    melody: ["fit", "colour", "sus", "borrowed", "relative", "pedal", "lead-in"],
  },
};

/** The options offered for a new track of a kind written from a track of a kind, best first (no source kind: every option of the kind). */
export function harmonyOptions(kind: HarmonyKind, from?: SourceKind): HarmonyOption[] {
  if (!from) return HARMONY_OPTIONS.filter((o) => o.kind === kind);
  return HARMONY_MENU[kind][from].map((id) => HARMONY_OPTIONS.find((o) => o.kind === kind && o.id === id)!);
}

/** Is the key's home chord minor (a minor third above the tonic in its scale)? The same test borrowed chords use. */
export function isMinorKey(key: Key): boolean {
  const seven = scaleNotes(key.tonic, getScale(parentScale(key)));
  return seven.map(pc).includes(mod12(pc(key.tonic) + 3));
}
/** An option's name in a key: borrowed chords are "Darker" in a major key and "Brighter" in a minor one. */
export function labelFor(opt: HarmonyOption, key: Key): string {
  return opt.id === "borrowed" && opt.kind === "chords" && isMinorKey(key) ? "Brighter" : opt.label;
}
/** An option's one line in a key. */
export function hintFor(opt: HarmonyOption, key: Key): string {
  return opt.id === "borrowed" && opt.kind === "chords" && isMinorKey(key) ? "Some chords from the major key" : opt.hint;
}

export interface HarmonizeInput {
  /** the new track's kind */
  kind: HarmonyKind;
  option: string;
  /** what it is written from: a chords track, a melody track (or both, for checking swaps against the tune) */
  source: { chords?: ProgChord[]; melody?: Melody };
  /** the song's chords in this section: what a melody harmony bends to, and what a chords layer written from a melody sits on */
  under?: ProgChord[];
  key: Key;
  /** beats in a bar */
  bar: number;
  /** bars in the section */
  bars: number;
  seed?: number;
  /** 6/8, 9/8, 12/8: every beat divides in three (written lines use triplet steps) */
  compound?: boolean;
}

export interface HarmonizeOutput {
  chords?: ProgChord[];
  melody?: Melody;
}

// ── Time ───────────────────────────────────────────────────────

/** How the beats of a bar group: 4 = 2+2, 3 = 3, 5 = 3+2, 6 = 3+3, 7 = 2+2+3, 8 = 3+3+2 … */
export function beatGroups(bar: number): number[] {
  const n = Math.max(1, Math.round(bar));
  if (n <= 2) return Array(n).fill(1);
  if (n === 3) return [3];
  if (n === 4) return [2, 2];
  const r = n % 3;
  if (r === 0) return Array(n / 3).fill(3);
  if (r === 1) return [2, 2, ...Array((n - 4) / 3).fill(3)];
  return [...Array((n - 2) / 3).fill(3), 2];
}

/**
 * How strong a moment is: 3 the downbeat, 2 the start of a group of beats (beat 3 in 4/4, the
 * second beat of 6/8), 1 any other beat, 0 between beats.
 */
export function beatStrength(tick: number, bar: number): 0 | 1 | 2 | 3 {
  const barTicks = Math.max(1, Math.round(Math.max(1, bar) * TICKS));
  const pos = ((Math.round(tick) % barTicks) + barTicks) % barTicks;
  if (pos === 0) return 3;
  let at = 0;
  for (const g of beatGroups(bar)) {
    if (pos === at * TICKS) return 2;
    at += g;
  }
  return pos % TICKS === 0 ? 1 : 0;
}

/** A stretch of the section with one chord in it (null: a rest). Times in ticks. */
export interface Span {
  start: number;
  end: number;
  ref: ChordRef | null;
}

const usable = (ref: ChordRef | undefined): ref is ChordRef => {
  if (!ref || typeof ref.root !== "string" || !findChordType(ref.typeId)) return false;
  try {
    pc(ref.root);
    if (ref.bass) pc(ref.bass);
    return true;
  } catch {
    return false;
  }
};

/** A section's chords as they play: once, in order, cut off at the end of the section. */
export function chordSpans(chords: ProgChord[] | undefined, len: number): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const c of chords ?? []) {
    if (at >= len) break;
    const d = Math.round((Number(c?.beats) || 0) * TICKS);
    if (d <= 0) continue;
    out.push({ start: at, end: Math.min(len, at + d), ref: c.rest || !usable(c.ref) ? null : c.ref });
    at += d;
  }
  return out;
}

const spanAt = (spans: Span[], t: number) => spans.find((s) => s.start <= t && t < s.end);

/** One note of a line: when it starts, when the next one does (or the section ends), and its pitch. */
export interface LineNote {
  at: number;
  end: number;
  midi: number;
}

/**
 * A melody as a single line: one note per moment (the top one when several are written
 * together), each lasting until the next starts. Notes past the section's end are left out.
 */
export function melodyLine(m: Melody | undefined, len: number): LineNote[] {
  const top = new Map<number, number>();
  for (const n of m?.notes ?? []) {
    if (!Number.isFinite(n?.at) || !Number.isFinite(n?.midi) || n.at < 0 || n.at >= len) continue;
    top.set(n.at, Math.max(top.get(n.at) ?? -Infinity, n.midi));
  }
  const ats = [...top.keys()].sort((a, b) => a - b);
  return ats.map((at, i) => ({ at, end: i + 1 < ats.length ? ats[i + 1] : len, midi: top.get(at)! }));
}

/** The note of a line sounding at a moment (the last one started at or before it). */
export function soundingAt(line: { at: number; midi: number }[], t: number): number | null {
  let out: number | null = null;
  for (const n of line) {
    if (n.at > t) break;
    out = n.midi;
  }
  return out;
}
const soundingBefore = (line: LineNote[], t: number) => soundingAt(line, t - 1);

/**
 * Strong: on the downbeat or the start of a group of beats, or held longer than a beat. (A plain
 * quarter note on beat 2 is weak, so a line of thirds can pass through it, as a passing note does.)
 */
const strongNote = (n: LineNote, bar: number) => beatStrength(n.at, bar) >= 2 || n.end - n.at > TICKS;

// ── Scales ─────────────────────────────────────────────────────

const PARENTS = ["ionian", "aeolian", "mixolydian", "dorian", "lydian", "phrygian", "harmonicMinor", "melodicMinor", "locrian"];

/** The seven-note mode a key's harmony is built from: its own scale, or the one a pentatonic, blues or symmetric scale sits in. */
export function parentScale(key: Key): string {
  const scale = keyScale(key);
  if (isHeptatonic(scale)) return scale.id;
  const t = pc(key.tonic);
  const own = new Set(scalePcs(t, scale));
  let best = PARENTS[0];
  let bestN = -1;
  for (const id of PARENTS) {
    const n = scalePcs(t, getScale(id)).filter((p) => own.has(p)).length;
    if (n > bestN) {
      bestN = n;
      best = id;
    }
  }
  return best;
}

/**
 * The scale under a chord: the key's seven notes with the chord's own notes put in place of their
 * neighbours (over a borrowed F minor in C major the A becomes A♭; over E7 the G becomes G♯).
 * The swap is made letter by letter, so the scale keeps seven steps.
 */
function localScale(seven: string[], ref: ChordRef | null): number[] {
  const out = seven.map(pc);
  if (!ref) return out;
  const type = findChordType(ref.typeId);
  if (!type) return out;
  const notes = [...chordNotes(ref.root, type), ...(ref.bass ? [ref.bass] : [])];
  const chordSet = new Set(notes.map(pc));
  const replaced = new Set<number>();
  for (const n of notes) {
    const p = pc(n);
    if (out.includes(p)) continue;
    const ok = (i: number) => i > 0 && !replaced.has(i) && !chordSet.has(out[i]) && (mod12(out[i] - p) === 1 || mod12(p - out[i]) === 1);
    let slot = seven.findIndex((s) => parseNote(s).letter === parseNote(n).letter);
    if (!ok(slot)) slot = out.findIndex((_, i) => ok(i));
    if (!ok(slot)) continue;
    out[slot] = p;
    replaced.add(slot);
  }
  return out;
}

const ladders = new Map<string, number[]>();
/** Every MIDI note of a scale, low to high. */
function ladder(scale: number[]): number[] {
  const k = [...new Set(scale.map(mod12))].sort((a, b) => a - b).join(",");
  let l = ladders.get(k);
  if (!l) {
    const set = new Set(scale.map(mod12));
    l = [];
    for (let m = 0; m <= 127; m++) if (set.has(mod12(m))) l.push(m);
    ladders.set(k, l);
  }
  return l;
}

/** A note moved so many steps along a scale (null when the note is not in it). */
function stepAlong(midi: number, steps: number, scale: number[]): number | null {
  const l = ladder(scale);
  const i = l.indexOf(midi);
  if (i < 0) return null;
  return l[i + steps] ?? null;
}

// the parallel modes Contrapunk searches for an outside note, nearest first
const BORROW_RANGES = [
  ["aeolian", "harmonicMinor"],
  ["dorian", "melodicMinor"],
  ["mixolydian", "phrygian"],
  ["lydian", "phrygianDominant"],
  ["ionian", "locrian", "harmonicMajor", "lydianDominant", "mixolydianb6"],
];

/**
 * A note outside the scale moved by `steps`: first in the nearest parallel mode that holds it
 * (widening step by step), then by a consonant interval that lands in the key, then by any
 * consonant interval; failing all that, the note itself (Contrapunk's three-level fallback).
 */
function stepOutside(midi: number, steps: number, key: Key, keyPcs: number[]): number {
  const t = pc(key.tonic);
  for (const range of BORROW_RANGES)
    for (const id of range) {
      if (id === key.scaleId) continue;
      const s = scalePcs(t, getScale(id));
      if (!s.includes(mod12(midi))) continue;
      const r = stepAlong(midi, steps, s);
      if (r !== null) return r;
    }
  // consonant intervals in Contrapunk's order (M3, m3, M6, m6, P5, P4 above; m3 first below), a sixth's own size first
  const list =
    Math.abs(steps) === 1 ? [2 * Math.sign(steps), Math.sign(steps)]
    : steps >= 4 ? [9, 8, 4, 3, 7, 5]
    : steps > 0 ? [4, 3, 9, 8, 7, 5]
    : steps <= -4 ? [-8, -9, -3, -4, -5, -7]
    : [-3, -4, -8, -9, -5, -7];
  for (const d of list) if (keyPcs.includes(mod12(midi + d))) return midi + d;
  return midi + list[0];
}

// ── Little tests ───────────────────────────────────────────────

/** The chord's notes as pitch classes (with a slash bass). */
const pcsOf = (ref: ChordRef): number[] => {
  const t = getChordType(ref.typeId);
  const r = pc(ref.root);
  const out = [...new Set(t.intervals.map((iv) => mod12(r + semitonesOf(iv))))];
  if (ref.bass && !out.includes(pc(ref.bass))) out.push(pc(ref.bass));
  return out;
};

/** A note a semitone above a chord tone rubs against it (a minor ninth): the "avoid" rule. */
const avoids = (p: number, chord: number[]) => !chord.includes(mod12(p)) && chord.some((c) => mod12(p - c) === 1);

/** Both voices move and the fifth or octave between them stays a fifth or octave (compound and contrary forms count too). */
export function parallelPerfect(n1: number, h1: number, n2: number, h2: number): boolean {
  if (n1 === n2 || h1 === h2) return false;
  const a = mod12(Math.abs(h1 - n1));
  const b = mod12(Math.abs(h2 - n2));
  return (a === 7 && b === 7) || (a === 0 && b === 0);
}

const CONSONANT = new Set([0, 3, 4, 5, 7, 8, 9]);
const IMPERFECT = new Set([3, 4, 8, 9]);
/** Interval class between two notes: 0–11 semitones, octaves folded. */
const icOf = (a: number, b: number) => mod12(Math.abs(a - b));

// ── Context ────────────────────────────────────────────────────

interface Ctx {
  key: Key;
  bar: number;
  len: number;
  seven: string[];
  keyPcs: number[];
  tonic: number;
  /** the melody grid's lowest row: the key's home note nearest middle C */
  base: number;
  rng: () => number;
  id: () => string;
  /** the smallest step a written line uses: half a beat, or a third of one in compound time */
  unit: number;
  compound: boolean;
}

function context(input: HarmonizeInput): Ctx {
  const bar = Math.max(1, Number(input.bar) || 4);
  const bars = Math.max(1, Math.round(Number(input.bars) || 1));
  const seed = Math.round(Number(input.seed ?? 1)) || 1;
  const parent = parentScale(input.key);
  const seven = scaleNotes(input.key.tonic, getScale(parent));
  const idRng = seededRng((seed * 2654435761) >>> 0 || 7);
  return {
    key: input.key,
    bar,
    len: Math.round(bars * bar * TICKS),
    seven,
    keyPcs: scalePcs(pc(input.key.tonic), keyScale(input.key)),
    tonic: pc(input.key.tonic),
    base: melodyBase(input.key),
    rng: seededRng(seed),
    id: () => "h" + Math.floor(idRng() * 1e6).toString(36) + Math.floor(idRng() * 1e6).toString(36),
    unit: input.compound ? TICKS / 3 : TICKS / 2,
    compound: !!input.compound,
  };
}

// ── Chords chosen for a melody (Viterbi) ───────────────────────

interface PoolChord {
  ref: ChordRef;
  pcs: number[];
  /** what it costs to use at all: home is cheap, the diminished chord dear */
  prior: number;
}

/**
 * The chords a melody can be harmonised with: the key's triads (and in natural minor the major V
 * and V7). A tune with notes from outside the key also gets the chords that hold them: borrowed
 * chords from the parallel key and secondary dominants, at a price, so they are used only where
 * the tune asks for them.
 */
function pool(ctx: Ctx, outside: number[] = [], sevenths = false): PoolChord[] {
  const parent = parentScale(ctx.key);
  const pkey: Key = { tonic: ctx.key.tonic, scaleId: parent };
  const PRIOR: Record<number, number> = { 1: -0.4, 2: -0.05, 3: 0.05, 4: -0.25, 5: -0.25, 6: -0.1, 7: 0.6 };
  const out: PoolChord[] = [];
  for (const c of diatonicChords(pkey, sevenths ? 4 : 3)) {
    if (c.type.synthetic) continue;
    let prior = PRIOR[c.degree ?? 3] ?? 0;
    if (c.type.id === "aug" || c.type.id === "maj7#5") prior += 0.8;
    if (c.type.id === "dim" || c.type.id === "m7b5" || c.type.id === "dim7") prior += 0.3;
    out.push({ ref: c.ref, pcs: pcsOf(c.ref), prior });
  }
  // where the chord on the 5th is major and its 7th is in the key (major, harmonic minor), its
  // dominant 7th too, a little dearer (it carries the key's 4th over V, as tunes often ask)
  const five = out.find((c) => mod12(pc(c.ref.root) - ctx.tonic) === 7 && c.ref.typeId === "maj");
  const parentPcs = scalePcs(ctx.tonic, getScale(parent));
  if (five) {
    const ref = { root: five.ref.root, typeId: "7" };
    if (pcsOf(ref).every((p) => parentPcs.includes(p))) out.push({ ref, pcs: pcsOf(ref), prior: five.prior + 0.15 });
  }
  // a natural-minor key borrows the major dominant from harmonic minor (it has the leading note);
  // the other minor modes keep their own minor v, which is their sound
  if (parent === "aeolian") {
    const root = friendlySpelling(intervalNote(ctx.key.tonic, "5"), ctx.key);
    for (const [typeId, prior] of [["maj", -0.1], ["7", -0.05]] as const) {
      const ref = { root, typeId };
      if (!out.some((c) => pc(c.ref.root) === pc(root) && c.ref.typeId === typeId)) out.push({ ref, pcs: pcsOf(ref), prior });
    }
  }
  if (outside.length) {
    const holds = (ref: ChordRef) => pcsOf(ref).some((p) => outside.includes(p));
    const add = (ref: ChordRef, prior: number) => {
      if (holds(ref) && !out.some((c) => sameRef(c.ref, ref))) out.push({ ref, pcs: pcsOf(ref), prior });
    };
    for (const b of borrowedChords(ctx.key)) if (["maj", "min", "dim"].includes(b.type.id)) add(b.ref, 0.35 + 0.15 * (b.outside - 1));
    for (const t of diatonicChords(pkey, 3)) {
      if (t.type.id !== "maj" && t.type.id !== "min") continue;
      add({ root: friendlySpelling(intervalNote(t.ref.root, "5"), ctx.key), typeId: "7" }, 0.45);
    }
  }
  return out;
}

/**
 * How well a melody note sits over a chord: a chord tone is best; a note of the chord's own scale
 * passes; an avoid note, or a note from outside both the key and the chord, clashes.
 */
function noteFit(p: number, chord: number[], scale: number[]): number {
  if (chord.includes(mod12(p))) return 1;
  if (avoids(p, chord)) return -1.2;
  return scale.includes(mod12(p)) ? 0.15 : -1;
}

/**
 * Chords for a melody: the section cut into slots (a bar, or a group of beats when the tune
 * asks for a change mid-bar), and a Viterbi search for the row of chords that best covers the
 * notes (weighted by how long and how strong each one is) and moves well (falling fifths, steps,
 * a start and an end at home). `under`, when given, pulls toward chords sharing notes with it.
 */
function chordsForMelody(line: LineNote[], ctx: Ctx, under: Span[] = []): ProgChord[] {
  if (!line.length) return [];
  const slots: { start: number; end: number; down: boolean }[] = [];
  const barTicks = Math.round(ctx.bar * TICKS);
  for (let b = 0; b * barTicks < ctx.len; b++) {
    let at = 0;
    for (const g of beatGroups(ctx.bar)) {
      const start = b * barTicks + Math.round(at * TICKS);
      const end = Math.min(ctx.len, b * barTicks + Math.round((at + g) * TICKS));
      if (start < end) slots.push({ start, end, down: at === 0 });
      at += g;
    }
    // a bar of two light beats (2/4, 6/8) is one slot: chords change by the bar there
    if (ctx.bar <= 2 && slots.length >= 2 && !slots[slots.length - 1].down) {
      const last = slots.pop()!;
      slots[slots.length - 1].end = last.end;
    }
  }
  const scale = ctx.seven.map(pc);
  const P = pool(ctx, [...new Set(line.map((n) => mod12(n.midi)))].filter((p) => !scale.includes(p)));
  const local = P.map((c) => localScale(ctx.seven, c.ref));
  const emit = slots.map((s) =>
    P.map((c, ci) => {
      let score = 0;
      for (const n of line) {
        const from = Math.max(n.at, s.start);
        const to = Math.min(n.end, s.end, n.at + 2 * TICKS);
        if (to <= from) continue;
        const inside = n.at >= s.start;
        const w = ((to - from) / TICKS) * (inside ? (beatStrength(n.at, ctx.bar) >= 2 ? 1.5 : 1) : 0.6);
        score += w * noteFit(n.midi, c.pcs, local[ci]);
      }
      const u = spanAt(under, s.start)?.ref;
      if (u) score += 0.6 * (c.pcs.filter((p) => pcsOf(u).includes(p)).length / 3);
      return -score + c.prior + ctx.rng() * 0.08;
    }),
  );
  const move = (a: PoolChord, b: PoolChord, slot: { down: boolean }) => {
    if (a === b) return slot.down ? 0.12 : 0;
    let c = slot.down ? 0 : 0.5;
    const r = mod12(pc(b.ref.root) - pc(a.ref.root));
    if (r === 5) c -= 0.3;
    else if (r === 2) c -= 0.12;
    else if (r === 8 || r === 9) c -= 0.08;
    if (isDominantType(getChordType(a.ref.typeId)) && r !== 5) c += 0.25;
    // a cross-relation: a note and its own sharp or flat in chords side by side (A♭ in F minor, then
    // A in D minor or F major). Spelled notes tell it apart from a step (A♭ falling to G is fine).
    c += 0.6 * crossRelations(a.ref, b.ref);
    return c;
  };
  const n = slots.length;
  let cost = P.map((c, j) => emit[0][j] + (pc(c.ref.root) === ctx.tonic && !isMinorishOpp(c, ctx) ? -0.4 : 0));
  const back: number[][] = [];
  for (let i = 1; i < n; i++) {
    const next: number[] = [];
    const from: number[] = [];
    for (let j = 0; j < P.length; j++) {
      let best = Infinity;
      let arg = 0;
      for (let k = 0; k < P.length; k++) {
        const c = cost[k] + move(P[k], P[j], slots[i]);
        if (c < best - 1e-9) {
          best = c;
          arg = k;
        }
      }
      let e = emit[i][j];
      if (i === n - 1) e += pc(P[j].ref.root) === ctx.tonic ? -0.6 : mod12(pc(P[j].ref.root) - ctx.tonic) === 7 ? -0.3 : 0;
      next.push(best + e);
      from.push(arg);
    }
    cost = next;
    back.push(from);
  }
  let j = 0;
  for (let k = 1; k < cost.length; k++) if (cost[k] < cost[j] - 1e-9) j = k;
  const pick: number[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    pick[i] = j;
    if (i > 0) j = back[i - 1][j];
  }
  const out: ProgChord[] = [];
  for (let i = 0; i < n; i++) {
    const beats = (slots[i].end - slots[i].start) / TICKS;
    const last = out[out.length - 1];
    if (last && i > 0 && pick[i] === pick[i - 1]) last.beats += beats;
    else out.push({ id: ctx.id(), ref: { ...P[pick[i]].ref }, beats });
  }
  return out;
}
/** How many letters two chords hold with different accidentals (A♭ and A, G♯ and G). */
function crossRelations(a: ChordRef, b: ChordRef): number {
  const spelled = (r: ChordRef) => {
    const t = findChordType(r.typeId);
    return t ? chordNotes(r.root, t).map((n) => parseNote(n)) : [];
  };
  const bs = spelled(b);
  let n = 0;
  for (const x of spelled(a)) if (bs.some((y) => y.letter === x.letter && y.acc !== x.acc)) n++;
  return n;
}

/** The tonic chord of the right quality (a minor key's home chord is minor). */
const isMinorishOpp = (c: PoolChord, ctx: Ctx) => {
  const minorKey = ctx.seven.map(pc).includes(mod12(ctx.tonic + 3));
  return minorKey !== isMinorish(getChordType(c.ref.typeId));
};

// ── Melody from a melody: thirds, sixths, chord tones, octave, answer ─

interface Range {
  lo: number;
  hi: number;
}
/** Where a harmony line may go: within an octave of the tune's own range, inside what a voice or harp can sing. */
function rangeAround(line: LineNote[], ctx: Ctx): Range {
  const lo0 = Math.min(...line.map((n) => n.midi));
  const hi0 = Math.max(...line.map((n) => n.midi));
  // never more than an octave from the tune; down to an octave under the grid, or a sixth under
  // the tune's lowest note when the tune itself goes that low (so a low tune can still have a
  // harmony under it)
  return { lo: Math.max(36, Math.min(ctx.base - 12, lo0 - 9), lo0 - 12), hi: Math.min(96, Math.max(ctx.base + 36, hi0), hi0 + 12) };
}

/** Under-chords for a melody: the song's chords there, or ones chosen for the tune. */
function underFor(input: HarmonizeInput, line: LineNote[], ctx: Ctx): Span[] {
  const given = chordSpans(input.under, ctx.len);
  if (given.some((s) => s.ref)) return given;
  if (input.source.chords?.length) {
    const own = chordSpans(input.source.chords, ctx.len);
    if (own.some((s) => s.ref)) return own;
  }
  return chordSpans(chordsForMelody(line, ctx), ctx.len);
}

// what an interval with the tune costs, on a strong note and on a weak one (index: semitones,
// octaves folded). On a strong note a clash with the tune costs more than a note outside the chord
// (even an avoid note): the two lines are what the ear follows.
const IC_STRONG = [3, 11, 11, 0, 0, 0.8, 11, 1.2, 0, 0, 11, 11];
const IC_WEAK = [3, 2, 2, 0, 0, 0.8, 2, 0.8, 0, 0, 2, 2];

/**
 * A line a fixed number of scale steps from the tune (2 = a third above, -2 a third below, -5 a
 * sixth below). Each note tries, in order: the plain diatonic interval; the nearest chord tone on
 * the same side (a third to a sixth away); the same interval turned over (a third above becomes a
 * sixth below); the other third; holding the note before. Costs pick between them: on strong
 * notes a chord tone wins and a clash with the tune is worse than a note outside the chord, short
 * weak notes may pass through by step, parallel fifths and octaves are out, and the line stays on
 * its side of the tune where it can.
 *
 * `nearest` is the "chord tones" line: a tune note in the chord takes the nearest chord note
 * under it (at least a minor third down, so never a rub; a sixth rather than a tritone), any other
 * note the third below, bent to the chord on a strong beat; the line never goes above the tune.
 */
function intervalLine(line: LineNote[], k: number, spans: Span[], ctx: Ctx, nearest = false): MelodyNote[] {
  const range = rangeAround(line, ctx);
  const side = Math.sign(k);
  const out: MelodyNote[] = [];
  let prevH: number | null = null;
  let prevN: number | null = null;
  for (const n of line) {
    const ref = spanAt(spans, n.at)?.ref ?? null;
    const chord = ref ? pcsOf(ref) : null;
    const scale = localScale(ctx.seven, ref);
    const strong = strongNote(n, ctx.bar);
    const shift = (kk: number) => stepAlong(n.midi, kk, scale) ?? stepOutside(n.midi, kk, ctx.key, ctx.keyPcs);
    const onChord = nearest && !!chord?.includes(mod12(n.midi));
    const band = onChord ? [3, 9] : Math.abs(k) >= 4 ? [7, 10] : [3, 5];
    let cands: { m: number; order: number }[] = [];
    if (onChord) {
      // chord notes under it, nearest first (a fourth below still beats a sixth below: C→G, E→C, G→E)
      for (let d = 3; d <= 9; d++) if (chord!.includes(mod12(n.midi - d))) cands.push({ m: n.midi - d, order: (d - 3) * 0.3 });
    }
    if (!cands.length) {
      cands.push({ m: shift(k), order: 0 });
      // chord tones on the same side, those nearest the size asked for (a third, or a sixth) first
      const size = Math.abs(k) >= 4 ? 8.5 : 3.5;
      if (chord) for (let d = 3; d <= 10; d++) if (chord.includes(mod12(n.midi + side * d))) cands.push({ m: n.midi + side * d, order: 1 + Math.abs(d - size) * 0.1 + (d === 6 ? 1 : 0) });
      cands.push({ m: shift(k > 0 ? k - 7 : k + 7), order: 2 });
      cands.push({ m: shift(Math.abs(k) === 2 ? -k : 2 * Math.sign(k)), order: 3 });
      if (prevH !== null) cands.push({ m: prevH, order: 4 });
      // (the plain third below is always below, so something is left)
      if (nearest) cands = cands.filter((c) => c.m < n.midi);
    }
    let best = cands[0].m;
    let bestCost = Infinity;
    for (const c of cands) {
      const m = c.m;
      const ic = icOf(m, n.midi);
      let s = c.order;
      if (m < range.lo || m > range.hi) s += 30;
      if (m === n.midi) s += 8;
      // crossing the tune costs more than a note outside the chord: the line keeps its side
      if (Math.sign(m - n.midi) !== side) s += 6.5;
      if (Math.abs(m - n.midi) > 16) s += 4;
      // the line keeps the size it is named for: a third (a fourth at a push), or a sixth (a fifth at a push)
      const dist = Math.abs(m - n.midi);
      s += 0.6 * Math.max(0, band[0] - dist, dist - band[1]);
      const isTone = chord?.includes(mod12(m)) ?? false;
      if (strong) {
        if (chord && !isTone) s += 6;
        if (chord && avoids(m, chord)) s += 4;
        s += IC_STRONG[ic];
      } else {
        const step = prevH !== null && Math.abs(m - prevH) <= 2;
        if (chord && avoids(m, chord) && !step) s += 3;
        s += IC_WEAK[ic];
      }
      if (prevH !== null && prevN !== null && parallelPerfect(prevN, prevH, n.midi, m)) s += 20;
      // a smooth line: steps are free, leaps cost more the wider they are
      if (prevH !== null) s += Math.max(0, Math.abs(m - prevH) - 2) * 0.2 + Math.max(0, Math.abs(m - prevH) - 7) * 0.6;
      if (s < bestCost - 1e-9) {
        bestCost = s;
        best = m;
      }
    }
    out.push({ at: n.at, midi: best });
    prevH = best;
    prevN = n.midi;
  }
  return out;
}

/** The tune an octave away: up when there is room, else down; a note that would leave the range is left out. */
function octaveLine(line: LineNote[], ctx: Ctx): MelodyNote[] {
  const lo = Math.max(36, ctx.base - 12);
  const hi = Math.min(96, ctx.base + 36);
  const outside = (d: number) => line.filter((n) => n.midi + d < lo || n.midi + d > hi).length;
  const mean = line.reduce((s, n) => s + n.midi, 0) / line.length;
  const up = outside(12);
  const down = outside(-12);
  const d = up < down || (up === down && mean < ctx.base + 12) ? 12 : -12;
  return line.filter((n) => n.midi + d >= lo && n.midi + d <= hi).map((n) => ({ at: n.at, midi: n.midi + d }));
}

/**
 * Call and response: wherever the tune takes a breath (three beats or more after a note, or two
 * when the gap runs up to a bar line), the last few notes (as many as fit) come back a scale step
 * lower (or higher) after the first beat of the gap, or, when not even two fit, the chord is
 * played as a short run from a chord note near the tune's last one back toward the middle of the
 * tune (so the answer stays in the singer's range). Silent while the tune sings.
 */
function answerLine(line: LineNote[], spans: Span[], ctx: Ctx): MelodyNote[] {
  const out: MelodyNote[] = [];
  const lo = line.length ? Math.min(...line.map((n) => n.midi)) : ctx.base;
  const hi = line.length ? Math.max(...line.map((n) => n.midi)) : ctx.base + 24;
  const middle = (lo + hi) / 2;
  const barTicks = Math.round(ctx.bar * TICKS);
  const dir = ctx.rng() < 0.7 ? -1 : 1;
  for (let i = 0; i < line.length; i++) {
    const n = line[i];
    const next = i + 1 < line.length ? line[i + 1].at : ctx.len;
    // a note followed by two beats may just be held; three, or two up to the bar line, is a breath
    const toBar = next % barTicks === 0 || next === ctx.len;
    if (next - n.at < (toBar ? 2 : 3) * TICKS) continue;
    const g0 = Math.ceil((n.at + TICKS) / TICKS) * TICKS;
    const g1 = next;
    if (g1 - g0 < TICKS) continue;
    // the last few notes sung (up to four, within a bar), cut to the longest ending that fits the gap
    let motif = line.filter((x) => x.at >= g0 - barTicks && x.at <= n.at).slice(-4);
    while (motif.length > 2 && motif[motif.length - 1].at - motif[0].at + TICKS > g1 - g0) motif = motif.slice(1);
    const ref = spanAt(spans, g0)?.ref ?? null;
    const placed: MelodyNote[] = [];
    const span = motif.length ? motif[motif.length - 1].at - motif[0].at + TICKS : Infinity;
    if (motif.length >= 2 && span <= g1 - g0) {
      for (const x of motif) {
        const at = g0 + (x.at - motif[0].at);
        const r = spanAt(spans, at)?.ref ?? null;
        const scale = localScale(ctx.seven, r);
        let m = stepAlong(x.midi, dir, scale) ?? stepOutside(x.midi, dir, ctx.key, ctx.keyPcs);
        // a strong note of the echo that rubs against the chord moves to the nearest chord tone,
        // the way that keeps the motif's shape (still rising where it rose, falling where it fell)
        const chord = r ? pcsOf(r) : [];
        if (r && beatStrength(at, ctx.bar) >= 2 && !chord.includes(mod12(m))) {
          const k = placed.length;
          const want = k ? Math.sign(x.midi - motif[motif.indexOf(x) - 1].midi) : 0;
          const near = [1, -1, 2, -2].map((d) => m + d).filter((y) => chord.includes(mod12(y)));
          const shaped = near.filter((y) => !k || Math.sign(y - placed[k - 1].midi) === want);
          m = shaped[0] ?? near[0] ?? m;
        }
        placed.push({ at, midi: m });
      }
    } else if (ref) {
      const chord = pcsOf(ref);
      // eighth notes, or triplet eighths in 6/8, 9/8 and 12/8
      const step = ctx.unit;
      const count = Math.max(1, Math.min(4, Math.floor((g1 - g0) / step)));
      const way = n.midi > middle ? -1 : 1;
      // start on a chord note near the last one sung (not that note again: an answer is a new
      // voice), then walk the chord toward the middle
      let m = n.midi;
      for (let d = 2; d <= 7; d++) {
        if (chord.includes(mod12(n.midi + way * d))) {
          m = n.midi + way * d;
          break;
        }
        if (chord.includes(mod12(n.midi - way * d))) {
          m = n.midi - way * d;
          break;
        }
      }
      let w = way;
      for (let j = 0; j < count; j++) {
        placed.push({ at: g0 + j * step, midi: m });
        const next = (from: number, dir: number) => {
          let x = from + dir;
          while (!chord.includes(mod12(x))) x += dir;
          return x;
        };
        // a run that would leave the tune's range by more than a third turns back
        let x = next(m, w);
        if (x < lo - 4 || x > hi + 4) {
          w = -w;
          x = next(m, w);
        }
        m = x;
      }
    }
    for (const p of placed) if (p.at < g1 && p.at < ctx.len) out.push(p);
  }
  return out;
}

// ── Lines from chords: counter-line, chord tones, slow line, drone ─

interface Anchor {
  t: number;
  ref: ChordRef;
  spanStart: number;
}

/** The moments a slow line moves: every chord change and the start of every group of beats (one note per chord or half bar). */
function anchorsOf(spans: Span[], ctx: Ctx): Anchor[] {
  const out: Anchor[] = [];
  for (const s of spans) {
    if (!s.ref) continue;
    for (let t = s.start; t < s.end; t++) {
      if (t === s.start || beatStrength(t, ctx.bar) >= 2) out.push({ t, ref: s.ref, spanStart: s.start });
    }
  }
  return out;
}

/** Chord tones of a chord inside a range, with their roles. */
function tonesIn(ref: ChordRef, lo: number, hi: number): { m: number; role: number }[] {
  const type = getChordType(ref.typeId);
  const root = pc(ref.root);
  const roleOf = new Map<number, number>();
  for (const iv of type.intervals) {
    const p = mod12(root + semitonesOf(iv));
    if (!roleOf.has(p)) roleOf.set(p, parseInterval(iv).number);
  }
  const out: { m: number; role: number }[] = [];
  for (let m = lo; m <= hi; m++) {
    const r = roleOf.get(mod12(m));
    if (r !== undefined) out.push({ m, role: r });
  }
  return out;
}

/**
 * Where a second line lives: below the tune when there is room (an octave and more under its
 * middle note), else above it; with no tune, the middle of the melody grid.
 */
function secondRange(tune: LineNote[], ctx: Ctx): Range & { below: boolean } {
  if (!tune.length) return { lo: ctx.base + 3, hi: ctx.base + 17, below: true };
  const sorted = tune.map((n) => n.midi).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const below = med - 12 >= ctx.base - 7;
  return below ? { lo: Math.max(sorted[0] - 12, med - 15), hi: med - 3, below } : { lo: med + 3, hi: Math.min(sorted[sorted.length - 1] + 12, med + 15), below };
}

/**
 * A counter-line: a line of its own. Its notes fall on the chord changes and the strong
 * beats, chosen from the chord's tones (the 3rd and 7th first; against a tune, its available
 * tensions when no chord tone is consonant there) by a dynamic-programming search
 * whose costs are the first-species rules: consonance with the tune at every one of those
 * moments, contrary or oblique motion preferred, no parallel fifths or octaves, no moving into
 * one by similar motion, mostly steps, a leap answered by a step back, no more than three of the
 * same third or sixth in a row, the leading note rising home, the climax away from the tune's.
 * Passing notes then fill thirds and fourths by step on the weak beats in between, where the
 * tune holds (so the two lines take turns to move).
 */
function counterLine(tune: LineNote[], spans: Span[], ctx: Ctx): MelodyNote[] {
  const anchors = anchorsOf(spans, ctx);
  if (!anchors.length) return [];
  const { lo, hi, below } = secondRange(tune, ctx);
  const centre = (lo + hi) / 2;
  const climax = tune.length ? tune.reduce((a, b) => (b.midi > a.midi ? b : a)).at : -1;
  const leading = ctx.keyPcs.includes(mod12(ctx.tonic - 1)) ? mod12(ctx.tonic - 1) : -1;
  const mAt = anchors.map((a) => (tune.length ? soundingAt(tune, a.t) : null));
  const mBefore = anchors.map((a) => (tune.length ? soundingBefore(tune, a.t) : null));
  const cand = anchors.map((a, i) => {
    // the line's range, stretched where the tune dips into it, so there is always room for a
    // consonance on the line's own side of the tune
    const m = mAt[i];
    const l = m !== null && below ? Math.min(lo, m - 9) : lo;
    const h = m !== null && !below ? Math.max(hi, m + 9) : hi;
    let c = tonesIn(a.ref, l, h);
    if (!c.length) c = tonesIn(a.ref, l - 6, h + 6);
    // against a tune, the chord's available tensions too (a note of its scale that is no minor
    // ninth over a chord note: the 9th, 6th or major 7th over a major chord …), at a price: when
    // the tune sits on a colour note itself (a 9th, a ♯11) the chord notes may all clash with it,
    // and the first rule of counterpoint is consonance with the other voice
    if (mAt[i] !== null) {
      const chord = pcsOf(a.ref);
      const scale = localScale(ctx.seven, a.ref);
      for (let x = l; x <= h; x++) if (scale.includes(mod12(x)) && !chord.includes(mod12(x)) && !avoids(x, chord)) c.push({ m: x, role: 0 });
    }
    return c;
  });
  const node = (i: number, c: { m: number; role: number }) => {
    let s = c.role === 3 || c.role === 7 ? 0 : c.role === 1 ? 0.6 : c.role === 0 ? 3.5 : 0.9;
    s += Math.abs(c.m - centre) * 0.05;
    const m = mAt[i];
    if (m !== null) {
      const ic = icOf(c.m, m);
      if (c.m === m) s += 6;
      else if (IMPERFECT.has(ic)) s += 0;
      else if (ic === 7) s += 1.2;
      else if (ic === 0) s += 2.5;
      else if (ic === 5) s += 2;
      else s += beatStrength(anchors[i].t, ctx.bar) >= 2 ? 40 : 8;
      if (below ? c.m >= m : c.m <= m) s += 50;
      const d = Math.abs(c.m - m);
      if (d > 19) s += 50;
      else if (d > 12) s += 1.5;
    }
    if (anchors[i].t === climax && c.m >= hi - 2) s += 1.5;
    if (i === anchors.length - 1 && mod12(c.m) === ctx.tonic) s -= 0.5;
    return s + ctx.rng() * 0.25;
  };
  const melodic = (d: number) => {
    const a = Math.abs(d);
    return a === 0 ? 0.8 : a <= 2 ? 0 : a <= 4 ? 0.6 : a === 5 ? 1.5 : a === 6 ? 8 : a === 7 ? 2 : a <= 9 ? 3.5 : a === 12 ? 4 : a < 12 ? 6 : 50;
  };
  const edge = (i: number, z: number | null, a: number, b: number) => {
    let s = melodic(b - a);
    if (z !== null) {
      const prev = a - z;
      const d = b - a;
      if (Math.abs(prev) >= 5 && (Math.abs(d) > 2 || d === 0 || Math.sign(d) === Math.sign(prev))) s += 4;
      if (Math.abs(prev) >= 3 && Math.abs(d) >= 3 && Math.sign(prev) === Math.sign(d)) s += 2;
    }
    const m2 = mAt[i];
    const m1 = mBefore[i];
    if (m1 !== null && m2 !== null) {
      const movedM = m1 !== m2;
      const movedH = a !== b;
      if (movedM && movedH) {
        if (parallelPerfect(m1, a, m2, b)) s += 100;
        const same = Math.sign(m2 - m1) === Math.sign(b - a);
        if (same && (icOf(b, m2) === 7 || icOf(b, m2) === 0)) s += 3;
        s += same ? (icOf(a, m1) === icOf(b, m2) ? 1.2 : 0.8) : 0;
      } else s += 0.2;
      if (z !== null && i >= 2 && mAt[i - 2] !== null && mAt[i - 1] !== null) {
        const i0 = icOf(z, mAt[i - 2]!);
        const i1 = icOf(a, mAt[i - 1]!);
        const i2 = icOf(b, m2);
        if (i0 === i1 && i1 === i2 && IMPERFECT.has(i2) && z !== a && a !== b) s += 1;
      }
    }
    if (mod12(a) === leading && mod12(b) !== ctx.tonic && Math.abs(b - a) <= 2 && anchors[i].ref !== anchors[i - 1]?.ref) s += 1.5;
    return s;
  };
  // pair-state Viterbi: the state is (note before, note now), so a leap and its recovery can be judged
  type State = { cost: number; back: number };
  const N = anchors.length;
  const dp: State[][][] = [];
  dp[0] = [cand[0].map((c) => ({ cost: node(0, c), back: -1 }))];
  if (N > 1) {
    const layer: State[][] = cand[0].map(() => []);
    for (let p = 0; p < cand[0].length; p++)
      for (let q = 0; q < cand[1].length; q++) layer[p][q] = { cost: dp[0][0][p].cost + edge(1, null, cand[0][p].m, cand[1][q].m) + node(1, cand[1][q]), back: -1 };
    dp[1] = layer;
  }
  for (let i = 2; i < N; i++) {
    const layer: State[][] = cand[i - 1].map(() => []);
    const nodes = cand[i].map((c) => node(i, c));
    for (let p = 0; p < cand[i - 1].length; p++)
      for (let q = 0; q < cand[i].length; q++) {
        let best = Infinity;
        let arg = 0;
        for (let z = 0; z < cand[i - 2].length; z++) {
          const prev = dp[i - 1][z][p];
          if (!prev) continue;
          const c = prev.cost + edge(i, cand[i - 2][z].m, cand[i - 1][p].m, cand[i][q].m);
          if (c < best - 1e-9) {
            best = c;
            arg = z;
          }
        }
        layer[p][q] = { cost: best + nodes[q], back: arg };
      }
    dp[i] = layer;
  }
  const notes: number[] = new Array(N);
  if (N === 1) {
    let q = 0;
    dp[0][0].forEach((s, k) => s.cost < dp[0][0][q].cost && (q = k));
    notes[0] = cand[0][q].m;
  } else {
    let bp = 0;
    let bq = 0;
    let bc = Infinity;
    dp[N - 1].forEach((row, p) => row.forEach((s, q) => s.cost < bc - 1e-9 && ((bc = s.cost), (bp = p), (bq = q))));
    let p = bp;
    let q = bq;
    for (let i = N - 1; i >= 1; i--) {
      notes[i] = cand[i][q].m;
      notes[i - 1] = cand[i - 1][p].m;
      const z = dp[i][p][q].back;
      q = p;
      p = z;
    }
  }
  // the notes, held where they repeat over the same chord, with passing notes in the gaps
  const out: MelodyNote[] = [];
  for (let i = 0; i < N; i++) {
    const held = i > 0 && notes[i] === notes[i - 1] && anchors[i].spanStart === anchors[i - 1].spanStart;
    if (!held) out.push({ at: anchors[i].t, midi: notes[i] });
    const t2 = i + 1 < N ? anchors[i + 1].t : null;
    if (t2 === null) continue;
    const a = notes[i];
    const b = notes[i + 1];
    // a note held from before passes on from the moment it was last due
    const t = anchors[i].t;
    // a passing note only between notes that sound back to back (not across a rest)
    if (spans.some((s) => !s.ref && s.start >= t && s.start < t2)) continue;
    const scale = localScale(ctx.seven, anchors[i].ref);
    const l = ladder(scale);
    const ia = l.indexOf(a);
    const ib = l.indexOf(b);
    if (ia < 0 || ib < 0) continue;
    const between = Math.abs(ib - ia) - 1;
    if (between < 1 || between > 2) continue;
    const gap = t2 - t;
    if (gap < (between + 1) * ctx.unit) continue;
    const pass: MelodyNote[] = [];
    for (let j = 1; j <= between; j++) {
      const at = t + Math.round((gap * j) / (between + 1) / ctx.unit) * ctx.unit;
      pass.push({ at, midi: l[ia + Math.sign(ib - ia) * j] });
    }
    // a passing note fills the gap by step: a semitone or a tone, never an augmented second
    const path = [a, ...pass.map((x) => x.midi), b];
    if (path.some((m, j) => j > 0 && Math.abs(m - path[j - 1]) > 2)) continue;
    // only on weak moments, in order, and never making parallels with the tune; and only where
    // the tune holds, so the two lines take turns to move (the counter-line stays the slower one)
    let ok = pass.every((x, j) => x.at > t && x.at < t2 && beatStrength(x.at, ctx.bar) < 2 && (j === 0 || x.at > pass[j - 1].at) && !tune.some((n) => n.at === x.at));
    if (ok && tune.length) {
      const seq = [{ at: t, midi: a }, ...pass, { at: t2, midi: b }];
      for (let j = 1; j < seq.length && ok; j++) {
        const m1 = soundingBefore(tune, seq[j].at);
        const m2 = soundingAt(tune, seq[j].at);
        if (m1 !== null && m2 !== null && parallelPerfect(m1, seq[j - 1].midi, m2, seq[j].midi)) ok = false;
        if (m2 !== null && (below ? seq[j].midi >= m2 : seq[j].midi <= m2)) ok = false;
      }
    }
    if (ok) out.push(...pass);
  }
  return out.sort((x, y) => x.at - y.at);
}

/**
 * A line of chord notes, for a melody track written from chords: a note at every chord change
 * and strong beat, staying on a shared note across a change and walking through the chord while
 * it lasts.
 */
function chordToneWalk(spans: Span[], ctx: Ctx): MelodyNote[] {
  const lo = ctx.base + 2;
  const hi = ctx.base + 16;
  const out: MelodyNote[] = [];
  let prev: number | null = null;
  let dir = ctx.rng() < 0.5 ? 1 : -1;
  let lastSpan = -1;
  for (const a of anchorsOf(spans, ctx)) {
    const tones = tonesIn(a.ref, lo, hi).map((x) => x.m);
    if (!tones.length) continue;
    let m: number;
    if (prev === null) {
      const third = tonesIn(a.ref, lo, hi).filter((x) => x.role === 3);
      m = (third.length ? third : tonesIn(a.ref, lo, hi)).reduce((x, y) => (Math.abs(y.m - (ctx.base + 12)) < Math.abs(x.m - (ctx.base + 12)) ? y : x)).m;
    } else if (a.spanStart !== lastSpan) {
      m = tones.reduce((x, y) => (Math.abs(y - prev!) < Math.abs(x - prev!) ? y : x));
    } else {
      let next = dir > 0 ? tones.find((x) => x > prev!) : [...tones].reverse().find((x) => x < prev!);
      if (next === undefined) {
        dir = -dir;
        next = dir > 0 ? tones.find((x) => x > prev!) : [...tones].reverse().find((x) => x < prev!);
      }
      m = next ?? prev;
    }
    out.push({ at: a.t, midi: m });
    prev = m;
    lastSpan = a.spanStart;
  }
  return out;
}

/**
 * The slow line: one note per chord, the chord's 3rd or 7th (6th, or 4th in a sus chord; a triad
 * may use its 5th or root), the pair chosen across the whole section so the line moves least.
 * Over a tune it keeps below it and off its notes.
 */
function slowLine(spans: Span[], tune: LineNote[], ctx: Ctx): MelodyNote[] {
  const chords = spans.filter((s) => s.ref) as (Span & { ref: ChordRef })[];
  if (!chords.length) return [];
  const { lo, hi, below } = tune.length ? secondRange(tune, ctx) : { lo: ctx.base + 2, hi: ctx.base + 16, below: true };
  const centre = (lo + hi) / 2;
  const cand = chords.map((s) => {
    const all = tonesIn(s.ref, lo, hi);
    const guides = all.filter((x) => x.role === 3 || x.role === 7 || (x.role === 6 && !all.some((y) => y.role === 7)) || (x.role === 4 && !all.some((y) => y.role === 3)));
    const extra = guides.length >= 2 ? [] : all.filter((x) => x.role === 5 || x.role === 1 || x.role === 2);
    return [...guides.map((x) => ({ ...x, c: 0 })), ...extra.map((x) => ({ ...x, c: x.role === 5 ? 1 : 1.5 }))];
  });
  const node = (i: number, x: { m: number; c: number }) => {
    let s = x.c + Math.abs(x.m - centre) * 0.03 + ctx.rng() * 0.05;
    const m = tune.length ? soundingAt(tune, chords[i].start) : null;
    if (m !== null) {
      if (below ? x.m >= m : x.m <= m) s += 2;
      if (!CONSONANT.has(icOf(x.m, m)) || x.m === m) s += 3;
    }
    return s;
  };
  let cost = cand[0].map((x) => node(0, x));
  const back: number[][] = [];
  for (let i = 1; i < chords.length; i++) {
    const next: number[] = [];
    const from: number[] = [];
    for (const x of cand[i]) {
      let best = Infinity;
      let arg = 0;
      cand[i - 1].forEach((y, k) => {
        const c = cost[k] + Math.abs(x.m - y.m) * 0.4;
        if (c < best - 1e-9) {
          best = c;
          arg = k;
        }
      });
      next.push(best + node(i, x));
      from.push(arg);
    }
    cost = next;
    back.push(from);
  }
  let j = 0;
  cost.forEach((c, k) => c < cost[j] - 1e-9 && (j = k));
  const pick: number[] = new Array(chords.length);
  for (let i = chords.length - 1; i >= 0; i--) {
    pick[i] = cand[i][j].m;
    if (i > 0) j = back[i - 1][j];
  }
  const out: MelodyNote[] = [];
  const barTicks = Math.round(ctx.bar * TICKS);
  let lastAt = -Infinity;
  pick.forEach((m, i) => {
    // a shared note is held; it is struck again only after a bar, so a plucked string keeps sounding
    for (let t = chords[i].start; t < chords[i].end; t = (Math.floor(t / barTicks) + 1) * barTicks) {
      const prev = out[out.length - 1];
      if (prev && prev.midi === m && t - lastAt < barTicks) continue;
      out.push({ at: t, midi: m });
      lastAt = t;
    }
  });
  return out;
}

/**
 * A drone: home, or its fifth when more of the chords hold the fifth, struck at the start of
 * every bar that has a chord (or a tune) in it.
 */
function droneLine(spans: Span[], tune: LineNote[], ctx: Ctx): MelodyNote[] {
  const five = mod12(ctx.tonic + 7);
  const cover = (p: number) => spans.reduce((s, x) => s + (x.ref && pcsOf(x.ref).includes(p) ? x.end - x.start : 0), 0);
  const useFifth = spans.length > 0 && ctx.keyPcs.includes(five) && cover(five) > cover(ctx.tonic);
  const low = tune.length ? Math.min(...tune.map((n) => n.midi)) : ctx.base + 12;
  let midi = useFifth ? ctx.base + 7 : ctx.base;
  if (useFifth && midi > low - 3) midi -= 12;
  const out: MelodyNote[] = [];
  const barTicks = Math.round(ctx.bar * TICKS);
  for (let t = 0; t < ctx.len; t += barTicks) {
    if (!spans.length) {
      if (tune.some((n) => n.at < t + barTicks && n.end > t)) out.push({ at: t, midi });
      continue;
    }
    const s = spans.find((x) => x.ref && x.end > t && x.start < t + barTicks);
    if (s) out.push({ at: Math.max(t, s.start), midi });
  }
  return out;
}

// ── Chords from chords ─────────────────────────────────────────

const sameRef = (a: ChordRef, b: ChordRef) => pc(a.root) === pc(b.root) && a.typeId === b.typeId && (a.bass ? pc(a.bass) : -1) === (b.bass ? pc(b.bass) : -1);

interface Slot {
  c: ProgChord;
  start: number;
  end: number;
}
/** The source chords with their times (all of them, also any past the section's end). */
function slotsOf(chords: ProgChord[]): Slot[] {
  const out: Slot[] = [];
  let at = 0;
  for (const c of chords) {
    const d = Math.round((Number(c?.beats) || 0) * TICKS);
    if (d <= 0) continue;
    out.push({ c, start: at, end: at + d });
    at += d;
  }
  return out;
}
const live = (s: Slot) => !s.c.rest && usable(s.c.ref);

/** The melody notes that matter under a chord: those starting strong inside it, and the one sounding as it comes in. */
function strongIn(tune: LineNote[], start: number, end: number, bar: number): number[] {
  const out: number[] = [];
  for (const n of tune) {
    if (n.at >= end) break;
    if (n.at >= start ? strongNote(n, bar) : n.end > start) out.push(n.midi);
  }
  return out;
}

/** Does a chord carry these melody notes: each a chord tone, or a tension of its own scale that doesn't rub? */
function carries(ref: ChordRef, notes: number[], ctx: Ctx): boolean {
  if (!notes.length) return true;
  const chord = pcsOf(ref);
  const scale = localScale(ctx.seven, ref);
  return notes.every((m) => chord.includes(mod12(m)) || (!avoids(m, chord) && scale.includes(mod12(m))));
}

/** Can two chords sound at once: nothing the new one adds sits a semitone above the old one's notes? */
function blends(next: ChordRef, old: ChordRef): boolean {
  const o = pcsOf(old);
  return pcsOf(next).every((p) => o.includes(p) || !o.some((c) => mod12(p - c) === 1));
}

/** Is every note of a chord inside the scale under the chord it replaces? */
const fitsScale = (ref: ChordRef, scale: number[]) => pcsOf(ref).every((p) => scale.includes(p));

const degreeOf = (root: string, key: Key) => parseInterval(degreeToken(key.tonic, root)).number;
const seventhish = (t: ChordType) => t.intervals.length >= 4;

/** The diatonic chord of the key's parent scale on a degree (triad or seventh). */
function diatonicOn(degree: number, ctx: Ctx, size: 3 | 4): ChordRef | null {
  const pkey: Key = { tonic: ctx.key.tonic, scaleId: parentScale(ctx.key) };
  const c = diatonicChords(pkey, size).find((x) => x.degree === degree && !x.type.synthetic);
  return c ? c.ref : null;
}

/** Is a chord the key's own chord on its degree? */
function diatonicDegree(ref: ChordRef, ctx: Ctx): number | null {
  const scale = ctx.seven.map(pc);
  if (!pcsOf(ref).every((p) => scale.includes(p))) return null;
  const d = degreeOf(ref.root, ctx.key);
  return d >= 1 && d <= 7 && scale.includes(pc(ref.root)) ? d : null;
}

const COLOUR_BY: Record<string, string[]> = {
  "maj:1": ["maj7", "add9", "6", "69", "maj9"],
  "maj:4": ["maj7", "add9", "6", "maj7#11", "maj9"],
  "maj:5": ["7", "9", "13"],
  maj: ["maj7", "add9", "6", "7"],
  "min:1": ["m7", "m9", "madd9", "m11"],
  "min:2": ["m7", "m9", "m11"],
  "min:3": ["m7", "m7add11"],
  "min:6": ["m7", "m9", "m11"],
  min: ["m7", "madd9", "m9"],
  dim: ["m7b5"],
  "5": ["sus2", "add9"],
  "7": ["9", "13"],
  m7: ["m9", "m11"],
  maj7: ["maj9"],
  "6": ["69"],
  sus2: ["7sus2", "maj7sus2"],
  sus4: ["7sus4", "9sus4"],
};

/** A richer chord on the same root: the first colour that suits its job, fits its scale, adds no avoid note and suits the tune. */
function colourOf(ref: ChordRef, ctx: Ctx, tune: LineNote[], start: number, end: number): ChordRef {
  const type = getChordType(ref.typeId);
  const deg = diatonicDegree(ref, ctx);
  const list = COLOUR_BY[`${type.id}:${deg}`] ?? COLOUR_BY[type.id];
  if (!list) return ref;
  const scale = localScale(ctx.seven, ref);
  const old = pcsOf(ref);
  const notes = strongIn(tune, start, end, ctx.bar);
  const ok = list
    .map((id) => ({ root: ref.root, typeId: id, ...(ref.bass ? { bass: ref.bass } : {}) }))
    .filter((r) => {
      const added = pcsOf(r).filter((p) => !old.includes(p));
      if (!fitsScale(r, scale)) return false;
      if (added.some((p) => avoids(p, old))) return false;
      // a colour tone a semitone from a strong melody note rubs (a minor ninth or second against the tune)
      if (notes.some((m) => added.some((p) => icOf(p, m) === 1 || icOf(p, m) === 11))) return false;
      return carries(r, notes, ctx);
    });
  if (!ok.length) return ref;
  return ok.length > 1 && ctx.rng() < 0.35 ? ok[1] : ok[0];
}

/** The suspended form that sits on a chord: the 9th over a major chord (sus2), the 11th over a minor one (sus4). */
function susOf(ref: ChordRef, ctx: Ctx, tune: LineNote[], start: number, end: number): ChordRef {
  const type = getChordType(ref.typeId);
  const has3 = type.intervals.includes("3");
  const hasb3 = type.intervals.includes("b3");
  if (!has3 && !hasb3) return ref;
  if (type.intervals.includes("b5") || type.intervals.includes("#5")) return ref;
  const sev = type.intervals.includes("b7");
  const maj7 = type.intervals.includes("7");
  const two = sev ? "7sus2" : maj7 ? "maj7sus2" : "sus2";
  const four = sev ? "7sus4" : "sus4";
  let order = hasb3 ? [four, two] : [two, four];
  if (hasb3 && ctx.rng() < 0.3) order = [two, four];
  const scale = localScale(ctx.seven, ref);
  const notes = strongIn(tune, start, end, ctx.bar);
  for (const id of order) {
    const r = { root: ref.root, typeId: id, ...(ref.bass ? { bass: ref.bass } : {}) };
    if (fitsScale(r, scale) && blends(r, ref) && carries(r, notes, ctx)) return r;
  }
  return ref;
}

// each degree's cousins (roots a third away, sharing two notes), the one that keeps the chord's job first
const COUSINS: Record<number, number[]> = { 1: [6, 3], 2: [4], 3: [5, 1], 4: [2, 6], 5: [3, 7], 6: [1, 4], 7: [5] };

function relativeOf(ref: ChordRef, ctx: Ctx, tune: LineNote[], start: number, end: number): ChordRef {
  const deg = diatonicDegree(ref, ctx);
  if (!deg) return ref;
  const size = seventhish(getChordType(ref.typeId)) ? 4 : 3;
  const notes = strongIn(tune, start, end, ctx.bar);
  const opts = (COUSINS[deg] ?? [])
    .map((d) => diatonicOn(d, ctx, size))
    .filter((r): r is ChordRef => !!r)
    .filter((r) => {
      const t = getChordType(r.typeId);
      if ((t.id === "dim" || t.id === "m7b5") && deg !== 5) return false;
      if (t.id === "aug" || t.id === "maj7#5") return false;
      return blends(r, ref) && carries(r, notes, ctx);
    });
  if (!opts.length) return ref;
  // the seed may pick the second cousin, but never the diminished one by chance (a V swapped
  // for vii° only when iii won't do)
  const dim = (r: ChordRef) => ["dim", "m7b5"].includes(r.typeId);
  return opts.length > 1 && !dim(opts[1]) && ctx.rng() < 0.3 ? opts[1] : opts[0];
}

/** The chord borrowed from the parallel key on the same degree: iv, ♭VI, ♭VII, ♭III, iiø in major; IV, V, ii (and a final major I) in minor. */
function borrowedOf(ref: ChordRef, ctx: Ctx, last: boolean): ChordRef | null {
  const deg = diatonicDegree(ref, ctx);
  if (!deg) return null;
  const type = getChordType(ref.typeId);
  const sev = seventhish(type);
  const minorKey = ctx.seven.map(pc).includes(mod12(ctx.tonic + 3));
  const MAJOR: Partial<Record<number, [string, string, string]>> = {
    2: ["2", "dim", "m7b5"],
    3: ["b3", "maj", "maj7"],
    4: ["4", "min", "m7"],
    6: ["b6", "maj", "maj7"],
    7: ["b7", "maj", "7"],
  };
  const MINOR: Partial<Record<number, [string, string, string]>> = {
    2: ["2", "min", "m7"],
    4: ["4", "maj", "7"],
    5: ["5", "maj", "7"],
    ...(last ? { 1: ["1", "maj", "maj7"] as [string, string, string] } : {}),
  };
  const spec = (minorKey ? MINOR : MAJOR)[deg];
  if (!spec) return null;
  const root = friendlySpelling(intervalNote(ctx.key.tonic, spec[0]), ctx.key);
  const r = { root, typeId: sev ? spec[2] : spec[1] };
  return sameRef(r, ref) ? null : r;
}

/** Chords at the same moments as the source, each one rewritten (rests and their lengths kept). */
function mapChords(src: ProgChord[], ctx: Ctx, fn: (ref: ChordRef, s: Slot, i: number, all: Slot[]) => ChordRef): ProgChord[] {
  const slots = slotsOf(src);
  return slots.map((s, i) => (live(s) ? { id: ctx.id(), ref: fn(s.c.ref, s, i, slots), beats: s.c.beats } : { id: ctx.id(), ref: { ...s.c.ref }, beats: s.c.beats, rest: true }));
}

/** The pad: the same chords, a chord repeated straight after itself held as one long chord. */
function padChords(src: ProgChord[], ctx: Ctx): ProgChord[] {
  const out: ProgChord[] = [];
  for (const s of slotsOf(src)) {
    const last = out[out.length - 1];
    const rest = !live(s);
    if (last && !!last.rest === rest && (rest || sameRef(last.ref, s.c.ref))) last.beats += s.c.beats;
    else out.push(rest ? { id: ctx.id(), ref: { ...s.c.ref }, beats: s.c.beats, rest: true } : { id: ctx.id(), ref: { ...s.c.ref }, beats: s.c.beats });
  }
  return out;
}

/**
 * Smooth inversions: each chord keeps its notes, and the note in the bass (root, 3rd, 5th or 7th)
 * is chosen across the whole progression so the bass moves least. Root position is preferred at
 * the start and the end, a 5th in the bass (a six-four chord) is used sparingly, a 7th in the bass
 * should fall by step, and a diminished triad sits on its 3rd.
 */
function smoothChords(src: ProgChord[], ctx: Ctx): ProgChord[] {
  const slots = slotsOf(src);
  const idx = slots.map((s, i) => (live(s) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return mapChords(src, ctx, (r) => ({ ...r }));
  const opts = idx.map((i) => {
    const ref = slots[i].c.ref;
    if (ref.bass && pc(ref.bass) !== pc(ref.root)) return [{ bass: ref.bass, cost: 0, sev: false }];
    const type = getChordType(ref.typeId);
    const names = chordNotes(ref.root, type);
    const o: { bass: string; cost: number; sev: boolean }[] = [];
    type.intervals.forEach((iv, k) => {
      const n = parseInterval(iv).number;
      if (n === 1) o.push({ bass: ref.root, cost: type.id === "dim" ? 0.8 : 0, sev: false });
      else if (n === 3) o.push({ bass: names[k], cost: type.id === "dim" ? 0 : 0.6, sev: false });
      else if (n === 5 && type.intervals.length <= 4) o.push({ bass: names[k], cost: 1.5, sev: false });
      else if (n === 7) o.push({ bass: names[k], cost: 1.2, sev: true });
    });
    return o.length ? o : [{ bass: ref.root, cost: 0, sev: false }];
  });
  const N = idx.length;
  const node = (k: number, o: { bass: string; cost: number }) => o.cost + ((k === 0 || k === N - 1) && pc(o.bass) !== pc(slots[idx[k]].c.ref.root) ? 2 : 0) + ctx.rng() * 0.05;
  const move = (a: { bass: string; sev: boolean }, b: { bass: string }) => {
    const d = mod12(pc(b.bass) - pc(a.bass));
    const dist = Math.min(d, 12 - d);
    let c = dist * 0.35;
    if (a.sev && !(d === 11 || d === 10)) c += 1.5;
    return c;
  };
  let cost = opts[0].map((o) => node(0, o));
  const back: number[][] = [];
  for (let k = 1; k < N; k++) {
    const next: number[] = [];
    const from: number[] = [];
    for (const o of opts[k]) {
      let best = Infinity;
      let arg = 0;
      opts[k - 1].forEach((p, j) => {
        const c = cost[j] + move(p, o);
        if (c < best - 1e-9) {
          best = c;
          arg = j;
        }
      });
      next.push(best + node(k, o));
      from.push(arg);
    }
    cost = next;
    back.push(from);
  }
  let j = 0;
  cost.forEach((c, k) => c < cost[j] - 1e-9 && (j = k));
  const bass = new Map<number, string>();
  for (let k = N - 1; k >= 0; k--) {
    bass.set(idx[k], opts[k][j].bass);
    if (k > 0) j = back[k - 1][j];
  }
  return mapChords(src, ctx, (ref, _s, i) => {
    const b = bass.get(i);
    return b && pc(b) !== pc(ref.root) ? { root: ref.root, typeId: ref.typeId, bass: b } : { root: ref.root, typeId: ref.typeId };
  });
}

/** Pedal: every chord over home (or over the fifth, when more of the chords hold the fifth). */
function pedalChords(src: ProgChord[], ctx: Ctx): ProgChord[] {
  const slots = slotsOf(src).filter(live);
  const five = mod12(ctx.tonic + 7);
  const cover = (p: number) => slots.reduce((s, x) => s + (pcsOf(x.c.ref).includes(p) ? x.end - x.start : 0), 0);
  const pedal = cover(five) > cover(ctx.tonic) ? five : ctx.tonic;
  const bass = spellInKey(pedal, ctx.key);
  return mapChords(src, ctx, (ref) => (pc(ref.root) === pedal ? { root: ref.root, typeId: ref.typeId } : { root: ref.root, typeId: ref.typeId, bass }));
}

/**
 * Where a chord is cut in two to slip another chord in before the next one: on a beat, the
 * strongest one inside it, nearest its middle (2+2 in 4/4, 2+1 in 3/4, 3+2 in 5/4, 4+3 in 7/4,
 * bar and bar in a two-bar chord), each part at least a beat long. Null when it is too short.
 */
function splitPoint(start: number, end: number, bar: number): number | null {
  const mid = (start + end) / 2;
  let best: number | null = null;
  let bestScore = -Infinity;
  for (let t = Math.ceil((start + TICKS) / TICKS) * TICKS; t <= end - TICKS; t += TICKS) {
    // a tie goes to the later beat: the chord slipped in is the shorter one
    const score = beatStrength(t, bar) * 4 - Math.abs(t - mid) / TICKS + (t > mid ? 0.01 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** A chord cut at `cut` into itself and another chord (lengths in beats). */
function cutInTwo(s: Slot, cut: number, ref: ChordRef, ctx: Ctx): ProgChord[] {
  const first = (cut - s.start) / TICKS;
  return [
    { id: ctx.id(), ref: { ...s.c.ref }, beats: first },
    { id: ctx.id(), ref, beats: s.c.beats - first },
  ];
}

/** Lead-ins: the second half of a chord lasting two beats or more (cut on a beat) becomes the dominant 7th of the chord after it. */
function leadInChords(src: ProgChord[], ctx: Ctx, tune: LineNote[]): ProgChord[] {
  const slots = slotsOf(src);
  const out: ProgChord[] = [];
  slots.forEach((s, i) => {
    const next = slots[i + 1];
    const keep = (beats: number) => out.push(live(s) ? { id: ctx.id(), ref: { ...s.c.ref }, beats } : { id: ctx.id(), ref: { ...s.c.ref }, beats, rest: true });
    if (!live(s) || !next || !live(next) || s.c.beats < 2) return keep(s.c.beats);
    const target = next.c.ref;
    const tt = getChordType(target.typeId);
    if (!tt.intervals.includes("5") || !(tt.intervals.includes("3") || tt.intervals.includes("b3"))) return keep(s.c.beats);
    const dom: ChordRef = { root: friendlySpelling(intervalNote(target.root, "5"), ctx.key), typeId: "7" };
    if (mod12(pc(s.c.ref.root) - pc(target.root)) === 7 || sameRef(dom, s.c.ref) || pc(s.c.ref.root) === pc(target.root)) return keep(s.c.beats);
    const cut = splitPoint(s.start, s.end, ctx.bar);
    if (cut === null) return keep(s.c.beats);
    // the melody over the lead-in must be in it, or be its 9th or 13th
    const r = pc(dom.root);
    const ok = strongIn(tune, cut, s.end, ctx.bar).every((m) => pcsOf(dom).includes(mod12(m)) || mod12(m - r) === 2 || mod12(m - r) === 9);
    if (!ok) return keep(s.c.beats);
    out.push(...cutInTwo(s, cut, dom, ctx));
  });
  return out;
}

/** Passing diminished: where the bass would climb a whole step, the diminished 7th a semitone under the next chord slides in (on the second part of the chord before, cut on a beat). */
function passingChords(src: ProgChord[], ctx: Ctx, tune: LineNote[]): ProgChord[] {
  const slots = slotsOf(src);
  const out: ProgChord[] = [];
  slots.forEach((s, i) => {
    const next = slots[i + 1];
    const keep = () => out.push(live(s) ? { id: ctx.id(), ref: { ...s.c.ref }, beats: s.c.beats } : { id: ctx.id(), ref: { ...s.c.ref }, beats: s.c.beats, rest: true });
    if (!live(s) || !next || !live(next) || s.c.beats < 2) return keep();
    const a = s.c.ref.bass ?? s.c.ref.root;
    const b = next.c.ref.bass ?? next.c.ref.root;
    const tt = getChordType(next.c.ref.typeId);
    if (mod12(pc(b) - pc(a)) !== 2 || !tt.intervals.includes("5")) return keep();
    const dim: ChordRef = { root: friendlySpelling(intervalNote(next.c.ref.root, "7"), ctx.key), typeId: "dim7" };
    const cut = splitPoint(s.start, s.end, ctx.bar);
    if (cut === null) return keep();
    const tones = pcsOf(dim);
    const ok = strongIn(tune, cut, s.end, ctx.bar).every((m) => tones.includes(mod12(m)) || tones.some((p) => mod12(m - p) === 2));
    if (!ok) return keep();
    out.push(...cutInTwo(s, cut, dim, ctx));
  });
  return out;
}

/** Tritone swap: a dominant chord that falls a fifth to the next chord becomes the dominant 7th a tritone away (G7 → D♭7 before C). */
function tritoneChords(src: ProgChord[], ctx: Ctx, tune: LineNote[]): ProgChord[] {
  return mapChords(src, ctx, (ref, s, i, all) => {
    const next = all.slice(i + 1).find(live);
    if (!next) return { ...ref };
    const type = getChordType(ref.typeId);
    const falls = mod12(pc(ref.root) - pc(next.c.ref.root)) === 7;
    // a dominant 7th, or a major triad acting as one (never the home chord: that would lose home)
    if (!falls || !(isDominantType(type) || (type.id === "maj" && pc(ref.root) !== ctx.tonic))) return { ...ref };
    const sub: ChordRef = { root: friendlySpelling(intervalNote(ref.root, "b5"), ctx.key), typeId: "7" };
    // over the old root or 5th the swap turns the tune into a ♯11 or ♭9: only allowed when the tune avoids them
    const r = pc(ref.root);
    const notes = strongIn(tune, s.start, s.end, ctx.bar);
    const tones = pcsOf(sub);
    const sr = pc(sub.root);
    const ok = notes.every((m) => mod12(m) !== r && mod12(m) !== mod12(r + 7) && (tones.includes(mod12(m)) || mod12(m - sr) === 2 || mod12(m - sr) === 9));
    return ok ? sub : { ...ref };
  });
}

// ── The entry point ────────────────────────────────────────────

function fitDiv(notes: MelodyNote[], like: Melody["div"] | undefined, compound: boolean): Melody["div"] {
  const fits = (d: number) => notes.every((n) => n.at % (TICKS / d) === 0);
  if (like && fits(like)) return like;
  for (const d of (compound ? [3, 1, 2, 4] : [2, 1, 4, 3]) as Melody["div"][]) if (fits(d)) return d === 1 ? (compound ? 3 : 2) : d;
  return like ?? (compound ? 3 : 4);
}

/**
 * Write the new track. The output's chords or melody fill the same section (same bars and beat)
 * as the input; nothing is changed in place. An option that does not exist for the kind, or a
 * source it cannot work from, gives an empty result.
 */
export function harmonize(input: HarmonizeInput): HarmonizeOutput {
  const opt = HARMONY_OPTIONS.find((o) => o.id === input.option && o.kind === input.kind);
  if (!opt) return {};
  const ctx = context(input);
  const bars = Math.max(1, Math.round(Number(input.bars) || 1));
  const tune = melodyLine(input.source.melody, ctx.len);

  if (opt.kind === "melody") {
    const pack = (notes: MelodyNote[]): HarmonizeOutput => {
      const clean = notes
        .filter((n) => n.at >= 0 && n.at < ctx.len && n.midi >= 24 && n.midi <= 108)
        .map((n) => ({ at: Math.round(n.at), midi: Math.round(n.midi) }))
        .sort((a, b) => a.at - b.at || a.midi - b.midi)
        .filter((n, i, a) => i === 0 || n.at !== a[i - 1].at || n.midi !== a[i - 1].midi);
      return { melody: { div: fitDiv(clean, input.source.melody?.div, ctx.compound), bars, notes: clean, on: true } };
    };
    const fromChords = !tune.length && !!input.source.chords?.length;
    if (!tune.length && !fromChords) return pack([]);
    if (fromChords && !opt.from.includes("chords")) return pack([]);
    const spans = fromChords ? chordSpans(input.source.chords, ctx.len) : underFor(input, tune, ctx);
    switch (opt.id) {
      case "third-above":
        return pack(intervalLine(tune, 2, spans, ctx));
      case "third-below":
        return pack(intervalLine(tune, -2, spans, ctx));
      case "sixth-below":
        return pack(intervalLine(tune, -5, spans, ctx));
      case "chord-tones":
        return pack(fromChords ? chordToneWalk(spans, ctx) : intervalLine(tune, -2, spans, ctx, true));
      case "counter":
        return pack(counterLine(tune, spans, ctx));
      case "answer":
        return pack(answerLine(tune, spans, ctx));
      case "octave":
        return pack(octaveLine(tune, ctx));
      case "drone":
        return pack(droneLine(fromChords || input.under?.length ? spans : [], tune, ctx));
      case "slow-line":
        return pack(slowLine(spans, tune, ctx));
    }
    return pack([]);
  }

  // a new chords track: from the source's chords (or the song's chords under a melody source), or
  // from chords chosen for its melody ("Best fit" always chooses for the melody, leaning toward any
  // chords already there)
  // A layer written from a melody track sits on the song's chords when the section has some
  // (`under`), so it sounds with them; with none, chords are chosen for the tune first.
  const own = (input.source.chords ?? []).filter((c) => Number(c?.beats) > 0);
  const songs = (input.under ?? []).filter((c) => Number(c?.beats) > 0);
  const base = own.length ? own : opt.id !== "fit" && songs.some((c) => !c.rest && usable(c.ref)) ? songs : [];
  const refit = !base.length || (opt.id === "fit" && tune.length > 0);
  const src = refit ? chordsForMelody(tune, ctx, chordSpans(songs.length ? songs : own, ctx.len)) : base;
  if (!src.length) return { chords: [] };
  const tuneFor = tune;
  const at = (fn: (ref: ChordRef, s: Slot) => ChordRef) => mapChords(src, ctx, (ref, s) => fn(ref, s));
  switch (opt.id) {
    case "fit":
      return { chords: refit ? src : mapChords(src, ctx, (r) => ({ ...r })) };
    case "pad":
      return { chords: padChords(src, ctx) };
    case "higher":
    case "shell":
      return { chords: mapChords(src, ctx, (r) => ({ ...r })) };
    case "smooth":
      return { chords: smoothChords(src, ctx) };
    case "colour":
      return { chords: at((r, s) => colourOf(r, ctx, tuneFor, s.start, s.end)) };
    case "sus":
      return { chords: at((r, s) => susOf(r, ctx, tuneFor, s.start, s.end)) };
    case "relative":
      return { chords: at((r, s) => relativeOf(r, ctx, tuneFor, s.start, s.end)) };
    case "pedal":
      return { chords: pedalChords(src, ctx) };
    case "borrowed": {
      const slots = slotsOf(src);
      const lastLive = slots.map((s, i) => (live(s) ? i : -1)).filter((i) => i >= 0).pop();
      return {
        chords: mapChords(src, ctx, (ref, s, i) => {
          const b = borrowedOf(ref, ctx, i === lastLive);
          return b && carries(b, strongIn(tuneFor, s.start, s.end, ctx.bar), ctx) ? b : { ...ref };
        }),
      };
    }
    case "lead-in":
      return { chords: leadInChords(src, ctx, tuneFor) };
    case "passing":
      return { chords: passingChords(src, ctx, tuneFor) };
    case "tritone":
      return { chords: tritoneChords(src, ctx, tuneFor) };
  }
  return { chords: [] };
}
