// What the take list does to a song of tracks and clips: use a take, ★ it, delete it, remove a whole recording, bring
// a removed recording back from the shelf, and move every take when the timing nudge changes.
//
// These are the old Vocals page's edits (song/clips.ts), with a song beat where those had a section and a bar. As
// there, nothing is ever cut out of a file: an edit only changes which stretch of which take plays where.
import { activeTake, nudgeFrames } from "../song/takes";
import { MIN_CLIP } from "../song/clips";
import { layDown } from "./edit";
import type { AudioClip, AudioTrack, Clip, Shelved, Take5, TimelineSong, Track } from "./model";

const EPS = 1e-6;
const isAudioTrack = (t: Track | undefined): t is AudioTrack => !!t && (t.kind === "vocals" || t.kind === "audio");
const audioTrack = (song: TimelineSong, id: string): AudioTrack | undefined => {
  const t = song.tracks.find((x) => x.id === id);
  return isAudioTrack(t) ? t : undefined;
};
const withTrack = (song: TimelineSong, t: AudioTrack, next: AudioTrack): TimelineSong => (next === t ? song : { ...song, tracks: song.tracks.map((x) => (x === t ? next : x)) });
const minFrames = (rate: number): number => Math.max(1, Math.round(MIN_CLIP * (rate > 0 ? rate : 48000)));

/** Can one take stand in for another in a clip: of one recording, or sung from the same song beat at the same rate? (The real beat, so recordings in different bars never replace each other.) */
export const sameSpot5 = (a: Take5, b: Take5): boolean => a.group === b.group || (a.at !== null && b.at !== null && Math.abs(a.at - b.at) < EPS && a.rate === b.rate);

/** The take of a recording that plays when nothing says otherwise: the last ★, else the last full pass, else the last. */
function bestOf(takes: Take5[], group: string): Take5 | undefined {
  // (the old rule; it only reads what both kinds of take have)
  const t = activeTake(takes as unknown as Parameters<typeof activeTake>[0], group);
  return t ? takes.find((k) => k.id === t.id) : undefined;
}

/** A whole take as a clip, from a beat. */
const wholeClip = (t: Take5, track: string, id: string, start: number): AudioClip => ({ id, track, kind: "audio", take: t.id, from: 0, to: t.frames, off: 0, frames: t.frames, start: Math.max(0, start) });

/**
 * A clip playing another take in the same place: the same stretch of that pass. A clip that showed the whole of its
 * take shows the whole of the new one's content too (so its edge can still be dragged out over the rest). A shorter
 * take (a last pass that was stopped early) has less in it: the clip is cut to what it holds, and is gone (null)
 * when it lay wholly past that.
 */
function swapped(c: AudioClip, was: Take5 | undefined, to: Take5): AudioClip | null {
  if (c.take === to.id) return c;
  const whole = c.from === 0 && (!was || c.to >= was.frames);
  const end = whole ? to.frames : Math.min(c.to, to.frames);
  const size = end - c.from;
  if (size < minFrames(to.rate)) return null;
  if (end >= c.to) return { ...c, take: to.id, to: end };
  // less content than before: what the clip showed past it is let go (a clip that went round its content still does)
  if (c.off >= size - minFrames(to.rate)) return null;
  const once = c.off + c.frames <= c.to - c.from;
  return { ...c, take: to.id, to: end, frames: once ? Math.min(c.frames, size - c.off) : c.frames };
}

/**
 * Use a take: every clip of its track that plays its recording, or another sung from the same beat, plays it instead
 * (as edited). With nothing there playing, the whole take is laid as a clip: where it was sung, or, for one that lies
 * nowhere (its clip was undone, its section was deleted), at beat `at`, and from then on that is where its recording
 * was sung. What the new clip covers makes way.
 */
export function useTake5(song: TimelineSong, track: string, take: string, at: number, id: () => string): TimelineSong {
  const t = audioTrack(song, track);
  const k = t?.takes.find((x) => x.id === take);
  if (!t || !k) return song;
  const by = new Map(t.takes.map((x) => [x.id, x]));
  const here = (c: Clip): c is AudioClip => {
    if (c.kind !== "audio" || c.track !== track) return false;
    const now = by.get(c.take);
    return !!now && sameSpot5(now, k);
  };
  if (song.clips.some(here)) {
    let changed = false;
    const clips = song.clips.flatMap((c): Clip[] => {
      if (!here(c)) return [c];
      const next = swapped(c, by.get(c.take), k);
      if (next !== c) changed = true;
      return next ? [next] : [];
    });
    return changed ? { ...song, clips } : song;
  }
  if (k.at !== null) return layDown(song, wholeClip(k, track, id(), k.at));
  const to = Math.max(0, Number.isFinite(at) ? at : 0);
  // its recording lies there from now on: the other passes of it are alternatives in the same place
  const takes = t.takes.map((x) => (x.group === k.group && x.at === null ? { ...x, at: to } : x));
  return layDown(withTrack(song, t, { ...t, takes }), wholeClip(k, track, id(), to));
}

/** ★ a take, or take the ★ off. */
export function keepTake5(song: TimelineSong, track: string, take: string, keep: boolean): TimelineSong {
  const t = audioTrack(song, track);
  const k = t?.takes.find((x) => x.id === take);
  if (!t || !k || !!k.keep === keep) return song;
  const next: Take5 = keep ? { ...k, keep: true } : (({ keep: _, ...rest }) => rest)(k);
  return withTrack(song, t, { ...t, takes: t.takes.map((x) => (x === k ? next : x)) });
}

/**
 * Delete a take from the song (its file stays on disk). The clips that played it play the next best take of its
 * recording instead (the last ★, else the last full pass); when the recording has no take left, they go with it.
 * No clip is ever left without a take.
 */
export function dropTake5(song: TimelineSong, track: string, take: string): TimelineSong {
  const t = audioTrack(song, track);
  const k = t?.takes.find((x) => x.id === take);
  if (!t || !k) return song;
  const takes = t.takes.filter((x) => x !== k);
  const instead = bestOf(takes, k.group);
  const clips = song.clips.flatMap((c): Clip[] => {
    if (c.kind !== "audio" || c.track !== track || c.take !== take) return [c];
    const next = instead ? swapped(c, k, instead) : null;
    return next ? [next] : [];
  });
  return { ...withTrack(song, t, { ...t, takes }), clips: clips.length === song.clips.length && clips.every((c, i) => c === song.clips[i]) ? song.clips : clips };
}

/** Remove a whole recording from a track: its takes, and the clips that play them (the files stay on disk). Nothing else is touched. */
export function removeRecording5(song: TimelineSong, track: string, group: string): TimelineSong {
  const t = audioTrack(song, track);
  if (!t) return song;
  const gone = new Set(t.takes.filter((x) => x.group === group).map((x) => x.id));
  if (!gone.size) return song;
  return { ...withTrack(song, t, { ...t, takes: t.takes.filter((x) => !gone.has(x.id)) }), clips: song.clips.filter((c) => !(c.kind === "audio" && c.track === track && gone.has(c.take))) };
}

/**
 * Use a take from the shelf (the takes of a track that was removed): its whole recording comes onto `track`, and the
 * take is laid as a clip at beat `at`, where the recording lies from then on. The shelf entry goes when it is empty.
 */
export function useShelved5(song: TimelineSong, track: string, take: string, at: number, id: () => string): TimelineSong {
  const t = audioTrack(song, track);
  const entry = (song.shelf ?? []).find((s) => s.takes.some((k) => k.id === take));
  const k = entry?.takes.find((x) => x.id === take);
  if (!t || !entry || !k) return song;
  const to = Math.max(0, Number.isFinite(at) ? at : 0);
  const have = new Set(t.takes.map((x) => x.id));
  const moved = entry.takes.filter((x) => x.group === k.group);
  const left = entry.takes.filter((x) => x.group !== k.group);
  const shelf = (song.shelf ?? []).flatMap((s): Shelved[] => (s !== entry ? [s] : left.length ? [{ ...s, takes: left }] : []));
  const next: TimelineSong = { ...withTrack(song, t, { ...t, takes: [...t.takes, ...moved.filter((x) => !have.has(x.id)).map((x) => ({ ...x, at: to }))] }), shelf };
  if (!shelf.length) delete next.shelf;
  return layDown(next, wholeClip(k, track, id(), to));
}

/** Empty the shelf: the removed recordings leave the song (their files stay on disk). */
export function emptyShelf5(song: TimelineSong): TimelineSong {
  if (!song.shelf) return song;
  const { shelf: _, ...rest } = song;
  return rest;
}

/**
 * A list of takes as they lie with the timing nudge at `ms` milliseconds: each moves from the nudge it was cut with
 * to that one. A take that does not say which nudge it was cut with was cut with `was`. The same list when nothing moves.
 */
export function renudgeTakes5(takes: Take5[], ms: number, was: number = ms): Take5[] {
  let moved = false;
  const out = takes.map((k) => {
    const from = Number.isFinite(k.nudge) ? k.nudge! : nudgeFrames(was, k.rate);
    const to = nudgeFrames(ms, k.rate);
    if (from === to) return k;
    moved = true;
    return { ...k, start: k.start - from + to, nudge: to };
  });
  return moved ? out : takes;
}

/**
 * The song with the timing nudge at `ms` milliseconds: every take of every track that records, and every take on the
 * shelf, moves from its own nudge to that one (so a take heard early or late is put right by the nudge, not only the
 * next recording). `was`: the nudge before, for takes from before a take said which one it was cut with (left out:
 * those stay). The same song when nothing moves.
 */
export function renudge5(song: TimelineSong, ms: number, was: number = ms): TimelineSong {
  let moved = false;
  const tracks = song.tracks.map((t) => {
    if (!isAudioTrack(t)) return t;
    const takes = renudgeTakes5(t.takes, ms, was);
    if (takes === t.takes) return t;
    moved = true;
    return { ...t, takes };
  });
  const shelf = song.shelf?.map((s) => {
    const takes = renudgeTakes5(s.takes, ms, was);
    if (takes === s.takes) return s;
    moved = true;
    return { ...s, takes };
  });
  return moved ? { ...song, tracks, ...(shelf ? { shelf } : {}) } : song;
}
