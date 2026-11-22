// The plain steps of the Chords plugin, apart from what is drawn: every change the tray makes to the chords that are
// open (as the old pages make a change: a function from the state to the state, handed to the lens's `set`, so it
// lands in the open clip or the track's draft as one undo step), which chord is lit while the music plays, whether the
// shape finder still has its chord, and "All clips".
import { reviveFeel, type Feel, type PatternId } from "../../../audio/patterns";
import { withoutNotes } from "../../../song/chordnotes";
import { barsOr, chordAt } from "../../../song/frame";
import type { Voicing } from "../../../guitar/voicings";
import type { Open } from "../../../timeline/content";
import { phase, type ChordsContent, type Clip, type TimelineSong } from "../../../timeline/model";
import type { Payload } from "../../drag";
import { chordBeats, fitBeats, newId, type AppState, type ArrangeSettings, type ProgChord, type SheetState } from "../../state";

/** A change of the state, as the lens's `set` takes it. */
export type Change = (s: AppState) => AppState;
const chordsTo = (s: AppState, chords: ProgChord[]): AppState => ({ ...s, progression: { ...s.progression, chords } });

// ── the chords in the tray ──────────────────────────────────

/**
 * A chord dropped into the tray at a place in the row: a chord of the tray moves there (`slotId`); any other chord
 * (from the board, a pill, a shape of the shape finder) is added there, one bar long, in the shape that was dragged.
 * `index`: its place among the chords that stay (null: it was let go outside the tray, and nothing changes).
 */
export const dropChord = (p: Payload, index: number | null, id: () => string = newId): Change => (s) => {
  if (index === null) return s;
  const cs = [...s.progression.chords];
  let item: ProgChord;
  if (p.slotId) {
    const from = cs.findIndex((c) => c.id === p.slotId);
    if (from < 0) return s;
    [item] = cs.splice(from, 1);
    // (dropped back where it was: nothing to write)
    if (Math.min(index, cs.length) === from) return s;
  } else item = { id: id(), ref: p.ref, beats: chordBeats(s.progression), voicingId: p.voicingId };
  cs.splice(Math.min(index, cs.length), 0, item);
  return chordsTo(s, cs);
};

/** A chord taken out of the tray. */
export const removeChord = (slotId: string): Change => (s) =>
  s.progression.chords.some((c) => c.id === slotId) ? chordsTo(s, s.progression.chords.filter((c) => c.id !== slotId)) : s;

/** A silence, one bar long, after the last chord. (Its chord is only a placeholder: nothing is played.) */
export const addRest = (id: () => string = newId): Change => (s) =>
  chordsTo(s, [...s.progression.chords, { id: id(), ref: { root: s.key.tonic, typeId: "maj" }, beats: chordBeats(s.progression), rest: true }]);

/** Every chord taken out. */
export const clearChords: Change = (s) => (s.progression.chords.length ? chordsTo(s, []) : s);

/** New lengths for some chords, by id, in beats (kept between half a beat and four bars, in half beats). */
export const setLengths = (beats: Record<string, number>): Change => (s) =>
  chordsTo(s, s.progression.chords.map((c) => (beats[c.id] !== undefined ? { ...c, beats: fitBeats(beats[c.id]) } : c)));

/** What is open made this many bars long: the chords stay; those past the end are not played. */
export const setBars = (n: number): Change => (s) => ({ ...s, progression: { ...s.progression, bars: barsOr(n) } });

/**
 * Arrange: the chords are played in one area of the neck (null: each in its own shape). The shapes set by hand are
 * let go: the arrangement chooses them again.
 */
export const setArrange = (a: ArrangeSettings | null): Change => (s) =>
  ({ ...s, progression: { ...s.progression, arrange: a, chords: s.progression.chords.map((c) => ({ ...c, voicingId: undefined })) } });

/**
 * One chord of the tray given a shape by hand. While Arrange is on, the other chords keep the shapes they are shown
 * in (`shown`, one for each chord of the tray), so choosing one shape does not move the rest.
 */
export const pinShape = (slotId: string, voicingId: string, shown: (Voicing | undefined)[]): Change => (s) =>
  chordsTo(s, s.progression.chords.map((c, i) => (c.id === slotId ? { ...withoutNotes(c), voicingId } : s.progression.arrange && !c.voicingId ? { ...c, voicingId: shown[i]?.id } : c)));

/** The playing style of what is open. */
export const setStyle = (id: PatternId): Change => (s) => (s.progression.pattern === id ? s : { ...s, progression: { ...s.progression, pattern: id } });

// ── while the music plays ───────────────────────────────────

/**
 * How far into the open content the music is, in beats, at a beat of the song; null when the play line is not in it,
 * or what is open is not heard now. A placed clip: counted round its content. A draft: from where it is treated as lying.
 */
export function posIn(open: Pick<Open, "clip" | "span">, beat: number | null, heard: boolean): number | null {
  if (beat === null || !heard) return null;
  const c = open.clip;
  if (c) return beat < c.start - 1e-6 || beat >= c.start + c.len - 1e-6 ? null : phase(c, beat);
  return beat < open.span.from - 1e-6 || beat >= open.span.to - 1e-6 ? null : beat - open.span.from;
}

/** The chord of the tray that is sounding at a beat of the song (−1: none; a chord past the end of the content never is). */
export function litChord(open: Pick<Open, "clip" | "span" | "content">, beat: number | null, heard: boolean, bar: number): number {
  const at = posIn(open, beat, heard);
  if (at === null) return -1;
  const content = open.content as ChordsContent;
  return chordAt(content.chords, at, barsOr(content.bars) * bar);
}

// ── the shape finder ────────────────────────────────────────

/**
 * Is the shape finder on something that is still there? One opened for a chord of the tray goes when that chord is
 * gone (removed, cleared, or the window put on another clip): it would otherwise turn into the finder for that chord
 * anywhere. One opened for a chord of the board stays.
 */
export const finderShown = (sheet: SheetState | null, chords: readonly ProgChord[]): boolean => !!sheet && (!sheet.slotId || chords.some((c) => c.id === sheet.slotId));

// ── "All clips" ─────────────────────────────────────────────

/** Two feels that play the same (one that was never touched plays as the plain one does). */
const same = (a: Partial<Feel> | undefined, b: Partial<Feel> | undefined) => a === b || JSON.stringify(reviveFeel(a)) === JSON.stringify(reviveFeel(b));

/** Does every chords clip of a track play in this style, with this feel? */
export function allPlayAs(song: TimelineSong, track: string, style: PatternId, feel: Partial<Feel> | undefined): boolean {
  return song.clips.every((c) => c.kind !== "chords" || c.track !== track || (c.content.style === style && same(c.content.feel, feel)));
}

/**
 * "All clips": every chords clip of a track is played in this style, with this feel. Nothing else is touched: not
 * the chords, not their shapes, not the neck area, not another track, not the track's draft. The same song back when
 * every clip plays that way already.
 */
export function playingToAll(song: TimelineSong, track: string, style: PatternId, feel: Partial<Feel> | undefined): TimelineSong {
  if (allPlayAs(song, track, style, feel)) return song;
  return {
    ...song,
    clips: song.clips.map((c): Clip => {
      if (c.kind !== "chords" || c.track !== track || (c.content.style === style && same(c.content.feel, feel))) return c;
      const { feel: _f, ...rest } = c.content;
      return { ...c, content: { ...rest, style, ...(feel ? { feel: { ...feel } } : {}) } };
    }),
  };
}
