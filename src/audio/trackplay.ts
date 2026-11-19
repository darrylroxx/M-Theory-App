/**
 * How a track's written notes are played on its voice, shared by the live player and the render:
 * a chord in its playing style (or, on the synth, the synth's own way of playing over the whole
 * section), and a melody note held as long as it should be.
 */
import type { Beat } from "./beats";
import { meterOf, styleNotes, type PatternId, type PlayItem } from "./patterns";
import type { HarpSound } from "./rack";
import type { TrackVoice } from "./trackvoice";
import { synthOf } from "./tone";
import { tuneBetween, type Melody } from "../song/melody";
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
 * A track's chords as a run of items plays them: only what lies in [from, to) beats of the
 * section, so a chord over a loop's edge is cut there (it neither goes missing nor runs on into
 * the next time round).
 */
export function clipChords<T extends SecChord>(list: T[], from: number, to: number): T[] {
  const out: T[] = [];
  for (const c of list) {
    const a = Math.max(c.at, from);
    const b = Math.min(c.at + c.beats, to);
    if (b - a > 1e-6) out.push(a === c.at && b === c.at + c.beats ? c : { ...c, at: a, beats: b - a });
  }
  return out;
}

/**
 * A synth track's chords for a whole section, played its way (an arpeggio runs on across the
 * chords, a drone holds through them). Worked out once per section and kept here; each chord then
 * plays the notes that start under it. Times in seconds on the audio clock.
 */
export type SynthCache = Map<string, SynthNote[]>;
const EARLY = 0.05;

/** The song's home note (a pitch class, 0 = C): what a synth's drone holds, live and in a WAV alike. */
let home: number | undefined;
export function setHome(pc: number | undefined) {
  home = pc;
}
export function synthSection(cache: SynthCache, section: string, v: TrackVoice, t0: number, spb: number, chords: () => SecChord[], velocity = 0.78): SynthNote[] {
  const list = chords();
  const play = v.synth.play;
  // a chord changed (or the way of playing) while the section plays is heard from the next chord on, as on the other instruments
  const key = `${section}|${home}|${JSON.stringify(list)}|${JSON.stringify(play)}`;
  let notes = cache.get(key);
  if (!notes) {
    const written: PlayNote[] = [];
    for (const c of list) for (const m of c.midi) if (m !== null) written.push({ midi: m, start: t0 + c.at * spb, length: c.beats * spb, velocity });
    notes = playNotes(written, play, { bpm: 60 / spb, origin: t0, seed: 11, tonic: home });
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
    // each note is played once, by the chord it falls under (a little early, so a humanised note pushed ahead of its chord is not lost);
    // the last chord before a rest or the end of the section takes everything up to there, so its last step is not lost
    const from = t - EARLY;
    const next = s.chords.reduce((n, c) => (c.at > at + 1e-6 && c.at < n && c.midi.some((m) => m !== null) ? c.at : n), Infinity);
    const end = Number.isFinite(next) ? t + (next - at) * spb - EARLY : Infinity;
    playSpan(v, synthSection(cache, s.key, v, s.t0, spb, () => s.chords), from, end);
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

/** The synth's notes that start in [from, to): each is played once, by the stretch of time it falls in. */
function playSpan(v: TrackVoice, notes: SynthNote[], from: number, to: number) {
  for (const n of notes) if (n.start >= from && n.start < to) v.note(n.midi, Math.max(n.start, 0), n.velocity, n.length, { slot: n.slot });
}

/** Does the track's synth play a melody its own way (an arp, a pulse, a glide, a drone, or loosened), not note for note? */
export function synthWay(v: TrackVoice): boolean {
  if (v.tone.inst !== "synth") return false;
  // (asked every twelfth of a beat: the track's own settings are read as they are, not made afresh)
  const play = synthOf(v.tone, v.kind === "chord" ? "chords" : "melody").play;
  return play.mode !== "sustain" || play.humanise > 0;
}

/**
 * A melody's notes over a whole section (`len` beats), each held until the next one comes and
 * never past the section's end: what a synth's way of playing is worked out from.
 */
export function tuneSection(m: Melody, bar: number, swing: number, len: number): SecChord[] {
  const hits = tuneBetween(m, bar, 0, len, swing);
  const out: SecChord[] = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.at - h.beat) < 1e-6) last.midi.push(h.midi);
    else out.push({ midi: [h.midi], at: h.beat, beats: 0 });
  }
  out.forEach((c, i) => (c.beats = (out[i + 1]?.at ?? len) - c.at));
  return out;
}

/** The melody's velocity: as the notes it plays one by one. */
const TUNE_VELOCITY = 0.9;

/** Where each section's melody on the synth has been played up to, so the next stretch starts exactly there (by section, for each cache). */
const playedTo = new WeakMap<SynthCache, Map<string, number>>();

/**
 * A melody on a synth with a way of its own, for the stretch [from, to) of a section that started
 * at `t0` and is `len` beats long: the whole section is worked out once (so a lead glides from
 * note to note, an arp runs through each note, a drone holds under the tune) and the notes that
 * start in this stretch are played. `start`: the beat of the section where the playing started
 * (a loop's start): the tune is worked out from there, as a synth's chords are, so a drone or a
 * note held from before it sounds from there.
 */
export function playTuneSpan(v: TrackVoice, cache: SynthCache, key: string, tune: { m: Melody; bar: number; swing: number }, t0: number, spb: number, len: number, from: number, to: number, start = 0) {
  const notes = synthSection(cache, key, v, t0, spb, () => clipChords(tuneSection(tune.m, tune.bar, tune.swing, len), start, len), TUNE_VELOCITY);
  let done = playedTo.get(cache);
  if (!done) playedTo.set(cache, (done = new Map()));
  // each stretch starts where the last one of this section ended (a note on the edge between two is played once,
  // whatever the rounding), and the last one takes everything up to the section's end, so its last step is not lost
  const a = done.get(key) ?? from - EARLY;
  const b = to >= t0 + len * spb - 1e-4 ? Infinity : to - EARLY;
  if (b <= a) return;
  done.set(key, b);
  if (done.size > 64) done.delete(done.keys().next().value!);
  playSpan(v, notes, a, b);
}

/** One melody note: on the strings it rings until the next; on the keys and the synth it is held until the next note, and never past the section's end. */
export function playTuneNote(v: TrackVoice, midi: number, when: number, gap: number, sectionEnd: number, lane: number, as?: HarpSound) {
  if (!v.instrument) v.note(midi, when, 0.9, Infinity, { slot: TUNE_SLOT + lane, lift: TUNE_LIFT, as, until: gap });
  else v.note(midi, when, TUNE_VELOCITY, Math.max(0.05, Math.min(gap, sectionEnd - when)), { as });
}

