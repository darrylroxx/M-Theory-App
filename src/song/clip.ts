/**
 * Copy and Paste between sections, one page at a time.
 *
 * Each page has a clipboard of its own, so a rhythm can only be pasted as a rhythm, a melody as a
 * melody and drums as drums, and copying on one page never wipes what was copied on another.
 *
 * - Rhythm: the chords (their lengths, rests and chosen shapes), how they are played (style, speed,
 *   swing, touch …) and the sound of the chord harp.
 * - Melody: the notes, the grid, on/off, and the sound of the melody harp.
 * - Drums: the drum rhythm, on/off, and the drum sound (machine, each drum's sound, mix and effects).
 *
 * A paste replaces that page of the section on screen and nothing else: the section keeps its
 * length (the Frame decides it) and its other two pages. The clipboards are kept with the app, so
 * a part can also be pasted into another idea; a song in another key gets the chords and melody
 * moved to its key.
 */
import { DEFAULT_BEAT, reviveBeat, type Beat } from "../audio/beats";
import { hasStyle, reviveFeel, type Feel, type PatternId } from "../audio/patterns";
import { reviveSound, type HarpSound } from "../audio/rack";
import { transposeRef, type Key } from "../theory/keys";
import { pc } from "../theory/notes";
import { TICKS, melodyBase, reviveMelody, transposeMelody, type Melody } from "./melody";
import type { ProgChord, Progression } from "../ui/state";
import { fitChordBeats, fitMelody, isCompound, sigBeats } from "./meter";
import { sigOf } from "./unity";

export type ClipKind = "rhythm" | "melody" | "drums";

interface ClipBase {
  /** the letter of the section it was copied from */
  from: string;
  /** the key it was written in */
  key: Key;
  /** beats in a bar where it was written (the song's time signature then) */
  bar?: number;
}
export interface RhythmClip extends ClipBase {
  chords: ProgChord[];
  pattern: PatternId;
  feel?: Partial<Feel>;
  sound?: Partial<HarpSound>;
}
export interface MelodyClip extends ClipBase {
  melody: Melody | null;
  tuneSound?: Partial<HarpSound>;
}
export interface DrumClip extends ClipBase {
  beat: Beat;
}
export interface Clips {
  rhythm?: RhythmClip;
  melody?: MelodyClip;
  drums?: DrumClip;
}

const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));
const uid = () => Math.random().toString(36).slice(2, 10);

/** Semitones from one key's home note to another's, the short way round (−5 … +6). */
export function keyShift(from: Key, to: Key): number {
  const d = (((pc(to.tonic) - pc(from.tonic)) % 12) + 12) % 12;
  return d > 6 ? d - 12 : d;
}

export function copyRhythm(p: Progression, key: Key, from: string): RhythmClip {
  return clone({ from, key, bar: sigBeats(sigOf(p)), chords: p.chords, pattern: p.pattern, feel: p.feel, sound: p.sound });
}
export function copyMelody(p: Progression, key: Key, from: string): MelodyClip {
  return clone({ from, key, bar: sigBeats(sigOf(p)), melody: p.melody ?? null, tuneSound: p.tuneSound });
}
export function copyDrums(p: Progression, key: Key, from: string): DrumClip {
  return clone({ from, key, bar: sigBeats(sigOf(p)), beat: p.beat ?? DEFAULT_BEAT });
}

/** The section on screen gets the copied rhythm: chords (each a new slot), style, feel and harp sound. */
export function pasteRhythm(p: Progression, c: RhythmClip, key: Key, id: () => string = uid): Progression {
  const n = keyShift(c.key, key);
  // copied in another time signature: chords that lasted whole bars there last whole bars here
  const to = sigBeats(sigOf(p));
  const chords = clone(c.chords).map((x) => ({ ...x, beats: fitChordBeats(x.beats, c.bar ?? to, to) })).map((x) => (n ? { ...x, id: id(), ref: transposeRef(x.ref, n, key), voicingId: undefined } : { ...x, id: id() }));
  return { ...p, chords, pattern: c.pattern, feel: clone(c.feel), sound: clone(c.sound) };
}
/**
 * How far to move a melody into another key: by as much as the home note moves, up or down,
 * whichever keeps the most notes on the new key's grid (two octaves from its home note).
 */
export function melodyShift(m: Melody, from: Key, to: Key): number {
  const n = keyShift(from, to);
  if (!n) return 0;
  const lo = melodyBase(to);
  const inside = (by: number) => m.notes.filter((x) => x.midi + by >= lo && x.midi + by <= lo + 24).length;
  return [n, n - 12, n + 12].reduce((best, by) => (inside(by) > inside(best) ? by : best));
}
/** The section on screen gets the copied melody and the melody harp's sound. */
export function pasteMelody(p: Progression, c: MelodyClip, key: Key): Progression {
  const sig = sigOf(p);
  const to = sigBeats(sig);
  // copied in another time signature: every note stays in its bar
  const m = c.melody ? fitMelody(clone(c.melody), c.bar ?? to, to, isCompound(sig)) : undefined;
  const by = m ? melodyShift(m, c.key, key) : 0;
  return { ...p, melody: m && by ? transposeMelody(m, by) : m, tuneSound: clone(c.tuneSound) };
}
/** The section on screen gets the copied drums: rhythm, on/off and sound. (A rhythm from other bars is fitted to the song's: see song/unity.) */
export function pasteDrums(p: Progression, c: DrumClip): Progression {
  return { ...p, beat: clone(c.beat) };
}

/** Is there anything on this page of the section on screen? (Pasting over it can be undone.) */
export function hasPart(p: Progression, kind: ClipKind): boolean {
  if (kind === "rhythm") return p.chords.length > 0;
  if (kind === "melody") return !!p.melody?.notes.length;
  return !!p.beat?.on;
}

/** Does some of this page lie past the end of a section `frame` beats long? (That part does not play.) */
export function pastFrame(p: Progression, kind: ClipKind, frame: number): boolean {
  if (kind === "rhythm") {
    let at = 0;
    for (const c of p.chords) {
      if (at >= frame - 1e-6 && !c.rest) return true;
      at += c.beats;
    }
    return false;
  }
  if (kind === "melody") return !!p.melody?.notes.some((x) => x.at >= Math.round(frame * TICKS));
  return false;
}

/** Clipboards loaded from storage, made safe (anything broken is dropped). */
export function reviveClips(raw: unknown): Clips {
  const r = (raw ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const base = (x: Record<string, unknown> | undefined): ClipBase | null => {
    const k = x?.key as Key | undefined;
    return x && typeof x.from === "string" && k && typeof k.tonic === "string" && typeof k.scaleId === "string" ? { from: x.from, key: { tonic: k.tonic, scaleId: k.scaleId }, ...(typeof x.bar === "number" && x.bar > 0 ? { bar: x.bar } : {}) } : null;
  };
  const out: Clips = {};
  const rh = r.rhythm;
  const rb = base(rh);
  if (rb && Array.isArray(rh!.chords) && hasStyle(rh!.pattern)) {
    const chords = (rh!.chords as ProgChord[]).filter((c) => !!c && typeof c.id === "string" && !!c.ref && typeof c.ref.root === "string" && typeof c.ref.typeId === "string" && Number.isFinite(c.beats) && c.beats > 0);
    out.rhythm = { ...rb, chords, pattern: rh!.pattern as PatternId, feel: rh!.feel ? reviveFeel(rh!.feel) : undefined, sound: rh!.sound ? reviveSound(rh!.sound) : undefined };
  }
  const me = r.melody;
  const mb = base(me);
  if (mb && me) out.melody = { ...mb, melody: reviveMelody(me.melody) ?? null, tuneSound: me.tuneSound ? reviveSound(me.tuneSound) : undefined };
  const dr = r.drums;
  const db = base(dr);
  const beat = db ? reviveBeat(dr!.beat) : undefined;
  if (db && beat) out.drums = { ...db, beat };
  return out;
}
