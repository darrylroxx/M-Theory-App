/**
 * How a track's written notes are played on its voice, shared by the live player and the render:
 * a chord in its playing style (or, on the synth, the synth's own way of playing over the whole
 * section), and a melody note held as long as it should be.
 */
import type { Beat } from "./beats";
import { meterOf, styleNotes, type PatternId, type PlayItem } from "./patterns";
import type { HarpSound } from "./rack";
import type { TrackVoice } from "./trackvoice";
import { playNotes, type PlayNote, type SynthNote } from "../synth/play";

/** The melody's own strings: a new note stops the one before it, so a tune stays a tune and does not smear. */
export const TUNE_SLOT = 48;
/** A single melody note against a whole chord: it is played this much louder on the strings so the tune sits on top. */
export const TUNE_LIFT = 1.7;

/** One chord as a track plays it: its keys, where it starts in its section and for how long (beats). */
export interface SecChord {
  midi: (number | null)[];
  at: number;
  beats: number;
}

/**
 * A synth track's chords for a whole section, played its way (an arpeggio runs on across the
 * chords, a drone holds through them). Worked out once per section and kept here; each chord then
 * plays the notes that start under it. Times in seconds on the audio clock.
 */
export type SynthCache = Map<string, SynthNote[]>;
const EARLY = 0.05;
export function synthSection(cache: SynthCache, section: string, v: TrackVoice, t0: number, spb: number, chords: () => SecChord[]): SynthNote[] {
  const list = chords();
  const play = v.synth.play;
  // a chord changed (or the way of playing) while the section plays is heard from the next chord on, as on the other instruments
  const key = `${section}|${JSON.stringify(list)}|${JSON.stringify(play)}`;
  let notes = cache.get(key);
  if (!notes) {
    const written: PlayNote[] = [];
    for (const c of list) for (const m of c.midi) if (m !== null) written.push({ midi: m, start: t0 + c.at * spb, length: c.beats * spb, velocity: 0.78 });
    notes = playNotes(written, play, { bpm: 60 / spb, origin: t0, seed: 11 });
    cache.set(key, notes);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
  }
  return notes;
}

/**
 * Play one chord the way its track plays: on the strings and the piano, its playing style (a
 * strum, a pattern, a roll); on the synth, the synth's way of playing over its whole section.
 * `at` = beats into its section; `section` = the section's chords on this track and where the
 * section started, for the synth.
 */
export function playChord(v: TrackVoice, item: PlayItem, t: number, spb: number, pattern: PatternId, at: number, beat: Beat | null, cache: SynthCache, section: () => { key: string; t0: number; chords: SecChord[] }) {
  if (item.tone) v.setTone(item.tone);
  if (item.sound) v.setSound(item.sound, 60 / spb, t);
  if (!item.midi.some((m) => m !== null)) return;
  if (v.tone.inst === "synth") {
    const s = section();
    // each note is played once, by the chord it falls under (a little early, so a humanised note pushed ahead of its chord is not lost)
    const from = t - EARLY;
    const end = t + item.beats * spb - EARLY;
    for (const n of synthSection(cache, s.key, v, s.t0, spb, () => s.chords)) if (n.start >= from && n.start < end) v.note(n.midi, Math.max(n.start, 0), n.velocity, n.length, { slot: n.slot });
    return;
  }
  const keys = !!v.instrument;
  v.repedal(t);
  const notes = styleNotes(item.midi, item.beats, item.style ?? pattern, at, meterOf(item.drums ?? beat, item.meter), item.feel);
  const when = (e: (typeof notes)[number]) => e.beat * spb + e.delay;
  for (const e of notes) {
    const held = Math.min(e.length, item.beats - e.beat) * spb - e.delay;
    // for the canvas: a string that is plucked again stops sounding as it was, so a note lasts only until its string's next pluck
    let until = Infinity;
    for (const o of notes) {
      const gap = when(o) - when(e);
      if (o.slot === e.slot && gap > 0.02 && gap < until) until = gap;
    }
    // the keys have no strings: a key struck again takes over by itself, and more than six keys never share a lane
    v.note(e.midi, t + when(e), e.velocity, Math.min(held, e.cut ?? Infinity), { slot: keys ? undefined : e.slot, cut: e.cut !== undefined, as: item.sound, until });
  }
}

/** One melody note: on the strings it rings until the next; on the keys and the synth it is held until the next note, and never past the section's end. */
export function playTuneNote(v: TrackVoice, midi: number, when: number, gap: number, sectionEnd: number, lane: number, as?: HarpSound) {
  if (!v.instrument) v.note(midi, when, 0.9, Infinity, { slot: TUNE_SLOT + lane, lift: TUNE_LIFT, as, until: gap });
  else v.note(midi, when, 0.9, Math.max(0.05, Math.min(gap, sectionEnd - when)), { as });
}

