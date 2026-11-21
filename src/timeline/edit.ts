// Every change a user can make to a song of tracks and clips.
//
// All of it is plain arithmetic on the song: each function takes a song and gives a song, and gives the very same
// object back when nothing changed (the screen relies on that to skip work). Nothing here reads a clock, a random
// number, storage or the screen: the ids of new clips and tracks come in through an argument.
//
// The rules kept everywhere (spec A.6): clips on one track never overlap (a clip put down trims what it covers);
// a track only holds clips of its own kind; note clips sit on whole beats and drums clips on bar lines; a recorded
// take never leaves the song by an edit.
import { emptyRows, type Groove } from "../audio/beats";
import { SOUND_DEFAULT } from "../audio/rack";
import { GUITAR } from "../audio/tone";
import { FX_DEFAULT as VOCAL_DEFAULT } from "../audio/vocalfx";
import { transposeChord } from "../song/chordnotes";
import { keyShift, melodyShift } from "../song/clip";
import { MIN_CLIP } from "../song/clips";
import { DEFAULT_BARS } from "../song/frame";
import { EMPTY_MELODY, melodyBase, type Melody } from "../song/melody";
import { fitRhythm, isCompound, mapList, refit, sameSig, sigBeats, type TimeSig } from "../song/meter";
import { PLAIN_KIT, PLAIN_STYLE } from "../song/tracks";
import { reviveSynth } from "../synth/params";
import { presetsIn } from "../synth/presets";
import type { Key } from "../theory/keys";
import { barMap, ceilBar, onBarLine, type BarMap } from "./bars";
import {
  CLIP_OF, accepts, beatsToFrames, clipBeats, clipEnd, contentBeats, contentFrames, framesToBeats, mod, phase, rateOf, zeroBeat,
  type AudioClip, type AudioTrack, type ChordsContent, type Clip, type ClipKind, type Clipboard5, type Marker, type NoteClip, type Session,
  type SoundCopy, type Take5, type TimelineSong, type Track, type TrackKind,
} from "./model";

export type { Clipboard5, SoundCopy } from "./model";

type Song = TimelineSong;

/** A hair's width in beats: two clips that arithmetic left this close are touching, not overlapping. */
const EPS = 1e-9;
/**
 * How near an edge of a clip may come to a line and still count as on it. A recorded clip is a whole number of frames
 * long but may start anywhere, so its edges are given half a frame; a note clip, on whole beats, only the hair.
 */
const slack = (song: Song, c: Clip): number => (c.kind === "audio" ? Math.max(EPS, framesToBeats(0.5, rateOf(song, c), song.bpm)) : EPS);
const clone = <T,>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));
const isAudioTrack = (t: Track): t is AudioTrack => t.kind === "vocals" || t.kind === "audio";
const trackOf = (song: Song, id: string): Track | undefined => song.tracks.find((t) => t.id === id);
/** The song with one track changed (the same song when it is the same track). */
const withTrack = (song: Song, t: Track, next: Track): Song => (next === t ? song : { ...song, tracks: song.tracks.map((x) => (x === t ? next : x)) });
/** A list built again, or the old list when every item in it is the same one. */
const sameList = <T,>(old: T[], next: T[]): T[] => (next.length === old.length && next.every((x, i) => x === old[i]) ? old : next);
/** A song built again, or the old song when every part of it is the same one. */
function sameSong(old: Song, next: Song): Song {
  const a = old as unknown as Record<string, unknown>;
  const b = next as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => a[k] === b[k]) ? old : next;
}
/** The engine keeps these three ids for itself: no track may have one. */
const RESERVED = new Set(["chords", "melody", "drums"]);

// ── tracks ──────────────────────────────────────────────────

const KIND_NAME: Record<TrackKind, string> = { chords: "Chords", melody: "Melody", bass: "Bass", drums: "Drums", vocals: "Vocal", audio: "Audio" };

/** The next free name for a new track of a kind: "Chords", then "Chords 2"; recorded tracks are numbered from the first ("Vocal 1"). */
function nextName(song: Song, kind: TrackKind): string {
  const base = KIND_NAME[kind];
  const taken = new Set(song.tracks.map((t) => t.name));
  const numbered = kind === "vocals" || kind === "audio";
  if (!numbered && !taken.has(base)) return base;
  for (let n = numbered ? 1 : 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}
/** The next free name after a track's own: "Drums" gives "Drums 2", "Vocal 1" gives "Vocal 2". */
function nameAfter(song: Song, name: string): string {
  const m = /^(.*?)(?: (\d+))?$/.exec(name);
  const base = m?.[1] || name;
  const taken = new Set(song.tracks.map((t) => t.name));
  for (let n = m?.[2] ? Number(m[2]) + 1 : 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** Does the song have a track of this kind that the others may follow? */
const hasLead = (tracks: Track[], kind: "chords" | "drums"): boolean => tracks.some((t) => t.kind === kind && t.lead);

/** A track of a kind with its plain defaults (spec D.4). The first chords track and the first drums track of a song lead. */
function plainTrack(song: Song, kind: TrackKind, id: string): Track {
  const name = nextName(song, kind);
  const first = !song.tracks.some((t) => t.kind === kind);
  switch (kind) {
    case "chords":
      return { id, kind, name, tone: GUITAR, sound: SOUND_DEFAULT, ...(first ? { lead: true as const } : {}) };
    case "melody":
      return { id, kind, name, tone: GUITAR, sound: SOUND_DEFAULT };
    case "bass":
      // the synth on the first of its bass sounds
      return { id, kind, name, tone: { inst: "synth", synth: reviveSynth(presetsIn("bass")[0]?.params) } };
    case "drums":
      return { id, kind, name, kit: PLAIN_KIT, ...(first ? { lead: true as const } : {}) };
    case "vocals":
      // the vocal chain on, as its first starting point sets it; input 1
      return { id, kind, name, fx: VOCAL_DEFAULT, takes: [] };
    case "audio":
      // a blank track: the same chain, switched off
      return { id, kind, name, fx: { ...VOCAL_DEFAULT, on: false }, takes: [] };
  }
}

/** A new track with the plain defaults of its kind, at row `at` (none: below the last). An id that is taken, or one the engine keeps for itself, is refused. */
export function addTrack(song: Song, kind: TrackKind, id: string, at?: number): Song {
  if (!id || RESERVED.has(id) || trackOf(song, id)) return song;
  const i = at === undefined || !Number.isFinite(at) ? song.tracks.length : Math.max(0, Math.min(song.tracks.length, Math.round(at)));
  return { ...song, tracks: [...song.tracks.slice(0, i), plainTrack(song, kind, id), ...song.tracks.slice(i)] };
}

/**
 * A track taken out, with its clips and its mixer entry. The takes of a recorded track go to the song's shelf, so no
 * recording is lost by it (`at` on the shelf: the row the track had). When it led its kind and no other does, the
 * top track of that kind leads from now on.
 */
export function removeTrack(song: Song, id: string): Song {
  const row = song.tracks.findIndex((t) => t.id === id);
  if (row < 0) return song;
  const gone = song.tracks[row];
  let tracks = song.tracks.filter((t) => t !== gone);
  if ((gone.kind === "chords" || gone.kind === "drums") && gone.lead && !hasLead(tracks, gone.kind)) {
    const top = tracks.findIndex((t) => t.kind === gone.kind);
    tracks = tracks.map((t, i) => (i === top ? ({ ...t, lead: true } as Track) : t));
  }
  // a clip that played instead of this track plays beside nothing now
  const clips = song.clips.filter((c) => c.track !== id).map((c) => (c.kind === "chords" && c.instead === id ? without(c, "instead") : c));
  const out: Song = { ...song, tracks, clips };
  if (song.mix && id in song.mix) {
    const { [id]: _, ...rest } = song.mix;
    out.mix = rest;
  }
  if (isAudioTrack(gone) && gone.takes.length) out.shelf = [...(song.shelf ?? []), { track: gone.id, name: gone.name, kind: gone.kind, takes: gone.takes, at: row, saves: 0 }];
  return out;
}
const without = <T extends object, K extends keyof T>(o: T, k: K): T => {
  const { [k]: _, ...rest } = o;
  return rest as T;
};

/** A second track like this one, directly below it: the same kind, sound, input, colour and mixer entry; no clips, no takes, nothing being composed. */
export function duplicateTrack(song: Song, id: string, newId: string): Song {
  const row = song.tracks.findIndex((t) => t.id === id);
  if (row < 0 || !newId || RESERVED.has(newId) || trackOf(song, newId)) return song;
  const t = song.tracks[row];
  const base = { id: newId, name: nameAfter(song, t.name), ...(t.color !== undefined ? { color: t.color } : {}) };
  const copy: Track =
    t.kind === "drums" ? { ...base, kind: t.kind, kit: clone(t.kit) }
    : isAudioTrack(t) ? { ...base, kind: t.kind, fx: clone(t.fx), takes: [], ...(t.input ? { input: { ...t.input } } : {}) }
    : { ...base, kind: t.kind, tone: clone(t.tone), ...(t.sound ? { sound: clone(t.sound) } : {}) } as Track;
  const out: Song = { ...song, tracks: [...song.tracks.slice(0, row + 1), copy, ...song.tracks.slice(row + 1)] };
  const fader = song.mix?.[id];
  if (fader) out.mix = { ...song.mix, [newId]: { ...fader } };
  return out;
}

/** A track moved to another row: `toIndex` is the row it has afterwards (0 = the top). */
export function moveTrack(song: Song, id: string, toIndex: number): Song {
  const row = song.tracks.findIndex((t) => t.id === id);
  if (row < 0 || !Number.isFinite(toIndex)) return song;
  const rest = song.tracks.filter((_, i) => i !== row);
  const to = Math.max(0, Math.min(rest.length, Math.round(toIndex)));
  if (to === row) return song;
  return { ...song, tracks: [...rest.slice(0, to), song.tracks[row], ...rest.slice(to)] };
}

/** A track's name (at most 32 letters; an empty name changes nothing). */
export function renameTrack(song: Song, id: string, name: string): Song {
  const t = trackOf(song, id);
  const to = name.trim().slice(0, 32);
  if (!t || !to || to === t.name) return song;
  return withTrack(song, t, { ...t, name: to });
}

/** Fields of a track set: sound, tone, kit, fx, input, what is being composed. Its id and its kind stay; a field given as undefined is taken off. */
export function setTrack<T extends Track>(song: Song, id: string, patch: Partial<T>): Song {
  const t = trackOf(song, id);
  if (!t) return song;
  const now = t as unknown as Record<string, unknown>;
  const next: Record<string, unknown> = { ...now };
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (k === "id" || k === "kind" || now[k] === v) continue;
    if (v === undefined) delete next[k];
    else next[k] = v;
    changed = true;
  }
  return changed ? withTrack(song, t, next as unknown as Track) : song;
}

/** A track's sound on its own, to carry to another track or another idea. */
export const copySound = (t: Track): SoundCopy =>
  clone(
    t.kind === "drums" ? { kind: CLIP_OF[t.kind], kit: t.kit }
    : isAudioTrack(t) ? { kind: CLIP_OF[t.kind], fx: t.fx }
    : { kind: CLIP_OF[t.kind], tone: t.tone, ...(t.sound ? { sound: t.sound } : {}) },
  );

/** A copied sound put on a track. Only onto a track whose clips are of the same kind (a melody's sound fits a bass track, a vocal chain a blank track); else the song as it was. */
export function pasteSound(song: Song, id: string, s: SoundCopy): Song {
  const t = trackOf(song, id);
  if (!t || CLIP_OF[t.kind] !== s.kind) return song;
  let next: Track;
  if (t.kind === "drums") next = s.kit ? { ...t, kit: clone(s.kit) } : t;
  else if (isAudioTrack(t)) next = s.fx ? { ...t, fx: clone(s.fx) } : t;
  else if (!s.tone) next = t;
  else next = { ...without(t, "sound"), tone: clone(s.tone), ...(s.sound ? { sound: clone(s.sound) } : {}) } as Track;
  // (the sound it already has: nothing to do)
  return next === t || JSON.stringify(next) === JSON.stringify(t) ? song : withTrack(song, t, next);
}

// ── a clip's edges ──────────────────────────────────────────

const minFrames = (rate: number): number => Math.max(1, Math.ceil(MIN_CLIP * rate));

/** An audio clip with its left edge `d` frames later (earlier below zero, uncovering what lies before it). The sound stays where it was. */
function slideLeft(c: AudioClip, d: number, rate: number, bpm: number): AudioClip {
  return { ...c, start: Math.max(0, zeroBeat(c, bpm, rate) + framesToBeats(c.from + c.off + d, rate, bpm)), off: mod(c.off + d, contentFrames(c)), frames: c.frames - d };
}
/** A clip with its right edge brought in to beat `e`: what is left of it plays as before. null: nothing is left. */
function cutRight(song: Song, c: Clip, e: number): Clip | null {
  if (c.kind === "audio") {
    const frames = Math.floor(beatsToFrames(e - c.start, rateOf(song, c), song.bpm) + 1e-6);
    return frames >= c.frames ? c : frames < 1 ? null : { ...c, frames };
  }
  const len = Math.round(e - c.start);
  return len >= c.len ? c : len < 1 ? null : { ...c, len };
}
/** A clip with its left edge brought in to beat `s`: what is left of it plays where it did. null: nothing is left. */
function cutLeft(song: Song, c: Clip, s: number): Clip | null {
  if (c.kind === "audio") {
    const rate = rateOf(song, c);
    const d = Math.ceil(beatsToFrames(s - c.start, rate, song.bpm) - 1e-6);
    return d <= 0 ? c : d >= c.frames ? null : slideLeft(c, d, rate, song.bpm);
  }
  const d = Math.round(s - c.start);
  return d <= 0 ? c : d >= c.len ? null : { ...c, start: c.start + d, off: mod(c.off + d, contentBeats(c)), len: c.len - d };
}
/** A clip moved along the timeline, whole. */
const shifted = <C extends Clip>(c: C, d: number): C => (d ? { ...c, start: Math.max(0, c.start + d) } : c);

/** An id for the second piece of a clip that an edit cut in two without being handed ids: the clip's own with a number after it, the first that is free. */
function spareId(taken: Set<string>, id: string): string {
  const base = id.replace(/:\d+$/, "");
  for (let n = 2; ; n++) {
    const next = `${base}:${n}`;
    if (!taken.has(next)) {
      taken.add(next);
      return next;
    }
  }
}

/** A clip as it may lie in a song: at or after beat 0; a note clip on whole beats, at least a beat long, starting inside its content. */
function tidy(c: Clip): Clip {
  if (c.kind === "audio") {
    const start = Math.max(0, c.start);
    const off = mod(c.off, contentFrames(c));
    const frames = Math.max(1, Math.round(c.frames));
    return start === c.start && off === c.off && frames === c.frames ? c : { ...c, start, off, frames };
  }
  const start = Math.max(0, Math.round(c.start)) + 0;
  const len = Math.max(1, Math.round(c.len));
  const off = mod(Math.round(c.off), contentBeats(c)) + 0;
  return Object.is(start, c.start) && len === c.len && Object.is(off, c.off) ? c : { ...c, start, len, off };
}

/** What a clip covers on its track makes way for it: trimmed at the edge it covers, cut in two round a clip that lands inside it, gone when it is covered whole. */
function trimAround(song: Song, laid: Clip): Song {
  const s = laid.start;
  const e = clipEnd(laid, song);
  const near = slack(song, laid);
  let taken: Set<string> | null = null;
  let changed = false;
  const clips: Clip[] = [];
  for (const c of song.clips) {
    if (c.id === laid.id || c.track !== laid.track) {
      clips.push(c);
      continue;
    }
    const a = c.start;
    const b = clipEnd(c, song);
    if (b <= s + near || a >= e - near) {
      clips.push(c);
      continue;
    }
    changed = true;
    const left = a < s - near ? cutRight(song, c, s) : null;
    const right = b > e + near ? cutLeft(song, c, e) : null;
    if (left) clips.push(left);
    if (right) clips.push(left ? { ...right, id: spareId((taken ??= new Set(song.clips.map((x) => x.id))), c.id) } : right);
  }
  return changed ? { ...song, clips } : song;
}

/** Clips that are already in the song's list, each at its new place: one after the other, each trims what it covers. */
function settle(song: Song, ids: string[]): Song {
  let out = song;
  for (const id of ids) {
    const now = out.clips.find((c) => c.id === id);
    if (now) out = trimAround(out, now);
  }
  return out;
}

/**
 * Put a clip down: it is added (or, when the song has a clip of that id, takes its place), and whatever it covers on
 * its track makes way (A.6 rule 2). On a track that does not take clips of its kind, or that is not there, nothing happens.
 */
export function layDown(song: Song, clip: Clip): Song {
  const t = trackOf(song, clip.track);
  if (!t || !accepts(t.kind, clip.kind)) return song;
  const c = tidy(clip);
  const i = song.clips.findIndex((x) => x.id === c.id);
  const placed: Song = i < 0 ? { ...song, clips: [...song.clips, c] } : song.clips[i] === c ? song : { ...song, clips: song.clips.map((x, k) => (k === i ? c : x)) };
  return trimAround(placed, c);
}

// ── moving, copying, edges, splitting ───────────────────────

/** How far a group of clips really moves: never before beat 0, and by whole beats when a note clip is among them. */
function reach(clips: Clip[], d: number): number {
  const lo = -Math.min(...clips.map((c) => c.start));
  return clips.some((c) => c.kind !== "audio") ? Math.max(Math.round(d), Math.ceil(lo - EPS)) + 0 : Math.max(d, lo);
}
/** Do the drums clips among these start on bar lines? */
const drumsOnBars = (map: BarMap, clips: Clip[]): boolean => clips.every((c) => c.kind !== "drums" || onBarLine(map, c.start));

/** The takes that audio clips play, carried onto the track the clips go to (the record only: the files are shared). */
function carryTakes(song: Song, clips: Clip[], to: Track | undefined): Song {
  if (!to || !isAudioTrack(to)) return song;
  const add: Take5[] = [];
  for (const c of clips) {
    if (c.kind !== "audio" || c.track === to.id) continue;
    const from = trackOf(song, c.track);
    const take = from && isAudioTrack(from) ? from.takes.find((k) => k.id === c.take) : undefined;
    if (take && !to.takes.some((k) => k.id === take.id) && !add.some((k) => k.id === take.id)) add.push(clone(take));
  }
  return add.length ? withTrack(song, to, { ...to, takes: [...to.takes, ...add] }) : song;
}

/** What a move or a copy needs before it starts: the clips, where they go, and how far. null: it cannot be done. */
function plan(song: Song, ids: string[], dBeats: number, toTrack: string | undefined): { picked: Clip[]; to: Track | undefined; d: number } | null {
  const pick = new Set(ids);
  const picked = song.clips.filter((c) => pick.has(c.id));
  if (!picked.length || !Number.isFinite(dBeats)) return null;
  const to = toTrack === undefined ? undefined : trackOf(song, toTrack);
  if (toTrack !== undefined && (!to || !picked.every((c) => accepts(to.kind, c.kind)))) return null;
  const d = reach(picked, dBeats);
  // a drums clip may only start on a bar line
  if (!drumsOnBars(barMap(song), picked.map((c) => shifted(c, d)))) return null;
  return { picked, to, d };
}

/**
 * Clips moved by `dBeats`, all together, keeping their spacing; with `toTrack`, onto that track. Never before beat 0.
 * Where they land they trim what they cover. Nothing happens when the track does not take one of them, or when a
 * drums clip would start off a bar line. An audio clip that changes track brings its take's record.
 */
export function moveClips(song: Song, ids: string[], dBeats: number, toTrack?: string): Song {
  const p = plan(song, ids, dBeats, toTrack);
  if (!p) return song;
  const moved = new Map(p.picked.map((c) => [c.id, { ...shifted(c, p.d), track: p.to?.id ?? c.track }]));
  if (p.picked.every((c) => moved.get(c.id)!.start === c.start && moved.get(c.id)!.track === c.track)) return song;
  const carried = carryTakes(song, p.picked, p.to);
  return settle({ ...carried, clips: carried.clips.map((c) => moved.get(c.id) ?? c) }, p.picked.map((c) => c.id));
}

/** The same as a move, but the originals stay and separate copies land: each with a new id and its own content. */
export function copyClips(song: Song, ids: string[], dBeats: number, toTrack: string | undefined, id: () => string): Song {
  const p = plan(song, ids, dBeats, toTrack);
  if (!p) return song;
  // (a copy dropped exactly onto its original would only take its place)
  if (p.d === 0 && p.picked.every((c) => (p.to?.id ?? c.track) === c.track)) return song;
  const copies = p.picked.map((c): Clip => ({ ...shifted(clone(c), p.d), id: id(), track: p.to?.id ?? c.track }));
  const carried = carryTakes(song, p.picked, p.to);
  return settle({ ...carried, clips: [...carried.clips, ...copies] }, copies.map((c) => c.id));
}

/**
 * A separate copy straight after each chosen clip. Clips chosen together on one track are copied as one run, after
 * the last of them, so the copy of one never lands on another that was chosen. A drums copy starts on the next bar line.
 */
export function duplicateClips(song: Song, ids: string[], id: () => string): Song {
  const pick = new Set(ids);
  const picked = song.clips.filter((c) => pick.has(c.id));
  if (!picked.length) return song;
  const map = barMap(song);
  const by = new Map<string, number>();
  for (const track of new Set(picked.map((c) => c.track))) {
    const run = picked.filter((c) => c.track === track);
    const first = Math.min(...run.map((c) => c.start));
    const last = Math.max(...run.map((c) => clipEnd(c, song)));
    by.set(track, (run.some((c) => c.kind === "drums") ? ceilBar(map, last) : last) - first);
  }
  const copies = picked.map((c): Clip => {
    const start = c.start + by.get(c.track)!;
    return { ...clone(c), id: id(), start: c.kind === "drums" ? ceilBar(map, start) : start };
  });
  return settle({ ...song, clips: [...song.clips, ...copies] }, copies.map((c) => c.id));
}

/**
 * One edge of a clip dragged to a beat: the window rule of A.3. The right edge only changes how long the clip is. The
 * left edge moves its start, and what was already heard stays where it was. Dragged outward, the content comes round
 * again (an audio clip first uncovers the rest of its take). An edge stops at the next clip on the track and at beat 0.
 * A note clip stays on whole beats and at least a beat long; a drums clip only takes a bar line (another beat changes
 * nothing); an audio clip is free, to the frame, and at least 20 ms long.
 */
export function resizeClip(song: Song, id: string, edge: "left" | "right", toBeat: number): Song {
  const c = song.clips.find((x) => x.id === id);
  if (!c || !Number.isFinite(toBeat)) return song;
  const map = barMap(song);
  const end = clipEnd(c, song);
  const others = song.clips.filter((x) => x.track === c.track && x.id !== c.id);
  // the clips either side, by where they start (after a tempo change one may reach under this one)
  const next = Math.min(Infinity, ...others.filter((x) => x.start > c.start + EPS).map((x) => x.start));
  const prev = Math.min(c.start, Math.max(0, ...others.filter((x) => x.start < c.start - EPS).map((x) => clipEnd(x, song))));

  if (c.kind === "audio") {
    const rate = rateOf(song, c);
    const least = minFrames(rate);
    if (edge === "right") {
      const stop = toBeat >= next - EPS;
      const want = beatsToFrames(Math.min(toBeat, next) - c.start, rate, song.bpm);
      const frames = Math.max(least, stop ? Math.floor(want + 1e-6) : Math.round(want));
      return frames === c.frames ? song : layDown(song, { ...c, frames });
    }
    const stop = toBeat <= prev + EPS;
    const want = beatsToFrames(Math.max(toBeat, prev) - c.start, rate, song.bpm);
    const d = Math.min(c.frames - least, stop ? Math.ceil(want - 1e-6) : Math.round(want));
    return d === 0 ? song : layDown(song, slideLeft(c, d, rate, song.bpm));
  }

  const drums = c.kind === "drums";
  const to = Math.round(toBeat);
  if (drums && !onBarLine(map, toBeat)) return song;
  if (edge === "right") {
    // (the shortest it can be: a beat; a drums clip: to the first bar line after its start)
    const least = drums ? map.beatOfBar(map.barAt(c.start).bar + 1) : c.start + 1;
    const e = Math.max(least, Math.min(to, next));
    return e === c.start + c.len ? song : layDown(song, { ...c, len: e - c.start });
  }
  const most = drums ? Math.max(c.start, map.floorBar(end - 0.5)) : end - 1;
  const s = Math.min(most, Math.max(to, drums ? ceilBar(map, prev) : Math.ceil(prev - EPS))) + 0;
  const d = s - c.start;
  return d === 0 ? song : layDown(song, { ...c, start: s, off: mod(c.off + d, contentBeats(c)), len: c.len - d });
}

/**
 * The chosen clips cut in two at a beat (those the beat is not inside stay whole). A note clip is cut on the nearest
 * beat (a drums clip on the nearest bar line) and gives two clips with separate content, the right one starting at
 * the point of the content that was sounding there. An audio clip is cut exactly there, to the frame: both halves
 * play the same take, one straight after the other, so they are one continuous sound.
 */
export function splitClips(song: Song, ids: string[], atBeat: number, id: () => string): Song {
  const pick = new Set(ids);
  if (!Number.isFinite(atBeat)) return song;
  const map = barMap(song);
  let changed = false;
  const clips: Clip[] = [];
  for (const c of song.clips) {
    const halves = pick.has(c.id) ? halve(song, map, c, atBeat, id) : null;
    if (halves) {
      clips.push(...halves);
      changed = true;
    } else clips.push(c);
  }
  return changed ? { ...song, clips } : song;
}
function halve(song: Song, map: BarMap, c: Clip, atBeat: number, id: () => string): [Clip, Clip] | null {
  if (c.kind === "audio") {
    const rate = rateOf(song, c);
    const cut = Math.round(beatsToFrames(atBeat - c.start, rate, song.bpm));
    if (cut < minFrames(rate) || c.frames - cut < minFrames(rate)) return null;
    return [{ ...c, frames: cut }, { ...slideLeft(c, cut, rate, song.bpm), id: id() }];
  }
  const x = c.kind === "drums" ? map.snapBar(atBeat) : Math.round(atBeat);
  if (!(x > c.start && x < c.start + c.len)) return null;
  return [{ ...c, len: x - c.start }, { ...clone(c), id: id(), start: x, off: phase(c, x), len: c.start + c.len - x }];
}

/** The chosen clips taken out. Nothing else moves. */
export function deleteClips(song: Song, ids: string[]): Song {
  const pick = new Set(ids);
  const clips = song.clips.filter((c) => !pick.has(c.id));
  return clips.length === song.clips.length ? song : { ...song, clips };
}

// ── what a composer writes ──────────────────────────────────

type Content = NoteClip["content"];
/** Which kind of clip a content belongs in (null: none that is known). */
const contentKind = (c: Content | null | undefined): ClipKind | null =>
  !c || typeof c !== "object" ? null
  : Array.isArray((c as ChordsContent).chords) ? "chords"
  : Array.isArray((c as Melody).notes) ? "melody"
  : typeof (c as Groove).steps === "number" && !!(c as Groove).rows ? "drums"
  : null;
/** A content as it may lie in a clip of a signature: a drum rhythm is fitted to its bars (so steps / div is always the beats in a bar). */
const fitted = (content: Content, kind: ClipKind, sig: TimeSig): Content => (kind === "drums" ? fitRhythm(content as Groove, sigBeats(sig), isCompound(sig)) : content);

/** A clip's content, from a composer. The clip keeps its place and its length (a shorter content comes round again inside it); a content of another kind changes nothing. */
export function setContent(song: Song, id: string, content: NoteClip["content"]): Song {
  const c = song.clips.find((x) => x.id === id);
  if (!c || c.kind === "audio" || contentKind(content) !== c.kind) return song;
  const fit = fitted(content, c.kind, c.sig);
  if (fit === c.content) return song;
  const next = { ...c, content: fit } as NoteClip;
  return { ...song, clips: song.clips.map((x) => (x === c ? { ...next, off: mod(c.off, contentBeats(next)) } : x)) };
}

/** What is being composed on a track and is not on the timeline yet, in the signature it is written in. null takes it off. */
export function setDraft(song: Song, track: string, content: NoteClip["content"] | null, sig: TimeSig): Song {
  const t = trackOf(song, track);
  if (!t || isAudioTrack(t)) return song;
  if (content === null) return t.draft ? withTrack(song, t, without(t, "draft")) : song;
  if (contentKind(content) !== CLIP_OF[t.kind]) return song;
  const fit = fitted(content, CLIP_OF[t.kind], sig);
  if (t.draft && t.draft.content === fit && sameSig(t.draft.sig, sig)) return song;
  return withTrack(song, t, { ...t, draft: { content: fit, sig } } as Track);
}

/** A separate copy of what is being composed on a track, put down as a clip at a beat (a drums clip at the bar line at or before it), one round of the content long. The draft stays. */
export function placeDraft(song: Song, track: string, atBeat: number, id: () => string): Song {
  const t = trackOf(song, track);
  if (!t || isAudioTrack(t) || !t.draft || !Number.isFinite(atBeat)) return song;
  const map = barMap(song);
  const clip = { id: id(), track: t.id, kind: CLIP_OF[t.kind], start: t.kind === "drums" ? map.floorBar(atBeat) : map.snapBeat(atBeat), len: 1, off: 0, sig: t.draft.sig, content: clone(t.draft.content) } as NoteClip;
  return layDown(song, { ...clip, len: contentBeats(clip) });
}

/**
 * A content with nothing in it yet: four bars for chords, let ring; a melody of two bars, on a grid of triplets where
 * every beat divides in three (6/8, 9/8, 12/8); one empty bar of drums in the signature. (A recorded clip has no
 * written content: asked for one, the answer is the empty melody, which no recorded track takes.)
 */
export const blankContent = (kind: ClipKind, sig: TimeSig): NoteClip["content"] => {
  if (kind === "chords") return { chords: [], bars: DEFAULT_BARS, style: PLAIN_STYLE };
  if (kind === "drums") {
    const div = isCompound(sig) ? 3 : 4;
    const steps = sigBeats(sig) * div;
    return { patternId: null, name: "Empty", edited: false, steps, div, bars: 1, swing: 0, rows: emptyRows(steps) };
  }
  return isCompound(sig) ? { ...EMPTY_MELODY, div: 3, notes: [] } : { ...EMPTY_MELODY, notes: [] };
};

/** Where a draft is treated as lying: the bar line at or before the first loop stretch's start when the loop is on, else at or before the cursor. */
export const draftAnchor = (song: TimelineSong, session: Pick<Session, "cursor" | "loop">): number =>
  barMap(song).floorBar(session.loop?.on && session.loop.regions.length ? session.loop.regions[0].from : session.cursor);

// ── signature, tempo, key ───────────────────────────────────

/** The song's signatures as one list from bar 0 on, in order. */
const sigList = (song: Song): { bar: number; sig: TimeSig }[] => [
  { bar: 0, sig: song.meter },
  ...[...(song.sigs ?? [])].filter((s) => Number.isInteger(s.bar) && s.bar > 0).sort((a, b) => a.bar - b.bar),
];
/** The song with that list as its signatures: a change to the signature already in force is left out. */
function withSigs(song: Song, list: { bar: number; sig: TimeSig }[]): Song {
  const kept = list.filter((s, i) => i === 0 || !sameSig(s.sig, list[i - 1].sig));
  const meter = sameSig(kept[0].sig, song.meter) ? song.meter : kept[0].sig;
  const sigs = kept.slice(1);
  const same = sigs.length === (song.sigs?.length ?? 0) && sigs.every((s, i) => s.bar === song.sigs![i].bar && sameSig(s.sig, song.sigs![i].sig));
  if (same && meter === song.meter) return song;
  const out: Song = { ...song, meter };
  if (sigs.length) out.sigs = same ? song.sigs : sigs;
  else delete out.sigs;
  return out;
}

/** A note clip written in one signature, moved into another: chords that lasted whole bars still do, every note and drum hit stays in its bar. */
function refitted(c: NoteClip, to: TimeSig): NoteClip {
  const f = refit(c.sig, to);
  const a = sigBeats(c.sig);
  const b = sigBeats(to);
  const next = (
    c.kind === "chords" ? { ...c, sig: to, content: { ...c.content, chords: mapList(c.content.chords, f.chord!) } }
    : c.kind === "melody" ? { ...c, sig: to, content: f.melody!(c.content) }
    : { ...c, sig: to, content: f.rhythm!(c.content) }
  ) as NoteClip;
  // its left edge is as far into the content as before: the same bar of it, the same beat where the bar still has one
  return { ...next, off: mod(Math.floor(c.off / a) * b + Math.min(c.off % a, b - 1), contentBeats(next)) };
}

/** Note clips of one track that a change of bar lengths pushed into each other: an earlier one ends where the next starts; one left with nothing goes. */
function unlap(clips: Clip[]): Clip[] {
  const out = [...clips];
  const gone = new Set<number>();
  for (const track of new Set(clips.map((c) => c.track))) {
    const rows = out.map((c, i) => ({ c, i })).filter((x) => x.c.track === track && x.c.kind !== "audio").sort((p, q) => p.c.start - q.c.start);
    for (let k = 0; k + 1 < rows.length; k++) {
      const c = out[rows[k].i] as NoteClip;
      const room = out[rows[k + 1].i].start - c.start;
      if (room >= c.len) continue;
      if (room < 1) gone.add(rows[k].i);
      else out[rows[k].i] = { ...c, len: room };
    }
  }
  return gone.size ? out.filter((_, i) => !gone.has(i)) : out;
}

/**
 * The time signature of the stretch of bars that bar `atBar` is in (the whole song when it has one signature), or,
 * with `fromHereOn`, from that bar to the next change. Everything keeps its bar number: clips, markers, the song's
 * end and where takes were sung are placed again by the new bar lengths. Every note clip that starts in the stretch
 * is refitted to the new bars (chords that lasted whole bars still do, notes and drum hits stay in their bars).
 */
export function setSig(song: Song, atBar: number, sig: TimeSig, fromHereOn: boolean): Song {
  if (!Number.isFinite(atBar)) return song;
  const bar = Math.max(0, Math.round(atBar));
  const old = sigList(song);
  let i = 0;
  old.forEach((s, k) => {
    if (s.bar <= bar) i = k;
  });
  if (sameSig(old[i].sig, sig)) return song;
  const fresh = fromHereOn && bar > old[i].bar;
  const first = fresh ? bar : old[i].bar;
  const list = fresh ? [...old.slice(0, i + 1), { bar, sig }, ...old.slice(i + 1)] : old.map((s, k) => (k === i ? { bar: s.bar, sig } : s));
  const before = barMap(song);
  const laid = withSigs(song, list);
  const after = barMap(laid);
  const from = before.beatOfBar(first);
  const to = old[i + 1] ? before.beatOfBar(old[i + 1].bar) : Infinity;
  /** a beat, in the same bar as before: as far into it as it was, where the bar is still that long (`spare`: how much of the bar's end to keep clear) */
  const place = (beat: number, spare: number): number => {
    const at = before.barAt(beat);
    const line = after.beatOfBar(at.bar);
    return line + Math.min(at.beat, Math.max(0, sigBeats(after.sigAt(line)) - spare));
  };

  const clips = unlap(
    mapList(song.clips, (c): Clip => {
      if (c.kind === "audio") {
        const start = place(c.start, 0);
        return start === c.start ? c : { ...c, start };
      }
      const start = place(c.start, 1);
      const len = Math.max(1, place(c.start + c.len, 0) - start);
      const next = c.start >= from - EPS && c.start < to - EPS && !sameSig(c.sig, sig) ? refitted(c, sig) : c;
      return next === c && start === c.start && len === c.len ? c : { ...next, start, len };
    }),
  );
  const out: Song = { ...laid, clips: sameList(song.clips, clips) };
  if (song.markers) out.markers = mapList(song.markers, (m) => moved(m, place(m.beat, 0)));
  if (song.end !== undefined) out.end = place(song.end, 0);
  out.tracks = retimed(song.tracks, (at) => place(at, 0));
  return out;
}
const moved = (m: Marker, beat: number): Marker => (beat === m.beat ? m : { ...m, beat });
/** Every placed take's "sung on this beat", moved as the bars it was sung in moved. */
const retimed = (tracks: Track[], f: (at: number) => number): Track[] =>
  mapList(tracks, (t) => {
    if (!isAudioTrack(t)) return t;
    const takes = mapList(t.takes, (k) => (k.at === null || f(k.at) === k.at ? k : { ...k, at: f(k.at) }));
    return takes === t.takes ? t : { ...t, takes };
  });

/**
 * The tempo (40 to 200, a whole number). Recorded audio does not stretch: every audio clip is placed again so that
 * the beat its take's first frame lies on stays put, which keeps the voice where it was sung and the two halves of a
 * split touching. Nothing stored is trimmed (where a faster tempo makes one clip run into the next, playback cuts the
 * earlier one there, and the old tempo brings everything back). A clip that would start before the song does has its
 * left edge brought in to beat 0.
 */
export function setTempo(song: Song, bpm: number): Song {
  if (!Number.isFinite(bpm)) return song;
  const to = Math.max(40, Math.min(200, Math.round(bpm)));
  if (to === song.bpm) return song;
  const clips = mapList(song.clips, (c): Clip => {
    if (c.kind !== "audio") return c;
    const rate = rateOf(song, c);
    const zero = zeroBeat(c, song.bpm, rate);
    const start = zero + framesToBeats(c.from + c.off, rate, to);
    if (start >= 0) return start === c.start ? c : { ...c, start };
    // it would start before the song does: its left edge comes in to beat 0, and what is left plays where it should
    const d = Math.min(c.frames - 1, Math.ceil(beatsToFrames(-start, rate, to) - 1e-6));
    return { ...c, start: Math.max(0, zero + framesToBeats(c.from + c.off + d, rate, to)), off: mod(c.off + d, contentFrames(c)), frames: c.frames - d };
  });
  return { ...song, bpm: to, clips };
}

/** A melody note kept inside what can be stored (24 to 108): one that would leave moves back in by octaves. */
const inRange = (midi: number): number => {
  let m = midi;
  while (m > 108) m -= 12;
  while (m < 24) m += 12;
  return m;
};
const tuneBy = (m: Melody, by: number): Melody => (by && m.notes.length ? { ...m, notes: m.notes.map((x) => ({ ...x, midi: inRange(x.midi + by) })) } : m);
const chordsBy = (c: ChordsContent, n: number, key: Key): ChordsContent => (n && c.chords.length ? { ...c, chords: c.chords.map((x) => transposeChord(x, n, key)) } : c);

/**
 * "Move song": every chords clip and every melody and bass clip moved from one key into another, and what is being
 * composed on each track too. Chords move by `n` semitones (their written notes with them). Melody and bass notes
 * move by as much as the melody grid's home row does, so they stay on the same rows.
 */
export function transpose(song: Song, n: number, from: Key, to: Key): Song {
  const by = melodyBase(to) - melodyBase(from);
  if (!n && !by) return song;
  const clips = mapList(song.clips, (c): Clip => {
    if (c.kind === "chords") {
      const content = chordsBy(c.content, n, to);
      return content === c.content ? c : { ...c, content };
    }
    if (c.kind === "melody") {
      const content = tuneBy(c.content, by);
      return content === c.content ? c : { ...c, content };
    }
    return c;
  });
  const tracks = mapList(song.tracks, (t): Track => {
    if (t.kind === "chords" && t.draft) {
      const content = chordsBy(t.draft.content, n, to);
      return content === t.draft.content ? t : { ...t, draft: { ...t.draft, content } };
    }
    if ((t.kind === "melody" || t.kind === "bass") && t.draft) {
      const content = tuneBy(t.draft.content, by);
      return content === t.draft.content ? t : { ...t, draft: { ...t.draft, content } };
    }
    return t;
  });
  return clips === song.clips && tracks === song.tracks ? song : { ...song, clips, tracks };
}

// ── time on every track ─────────────────────────────────────

/** Where the song ends: the larger of `end` and the end of its last clip, up to the bar line. */
export function songEnd(song: Song): number {
  const last = Math.max(song.end ?? 0, 0, ...song.clips.map((c) => clipEnd(c, song)));
  return ceilBar(barMap(song), last);
}

/** The ids of the clips that lie inside a stretch of time, whole (the stretch is snapped to bar lines first). */
export function clipsIn(song: Song, from: number, to: number): string[] {
  const map = barMap(song);
  const a = map.snapBar(from);
  const b = map.snapBar(to);
  return song.clips.filter((c) => c.start >= a - slack(song, c) && clipEnd(c, song) <= b + slack(song, c)).map((c) => c.id);
}

/**
 * A stretch of time taken out of every track, and the gap closed (the stretch is snapped to bar lines first). A clip
 * that lies across an edge of it is cut there; one that lies across all of it is left as two clips that meet. Markers
 * inside it go, later ones move up; the bars after it keep their signatures; the song's end moves up too.
 */
export function cutTime(song: Song, from: number, to: number): Song {
  const map = barMap(song);
  const a = map.snapBar(Math.min(from, to));
  const b = map.snapBar(Math.max(from, to));
  if (!(b > a)) return song;
  const span = b - a;
  let taken: Set<string> | null = null;
  const clips: Clip[] = [];
  for (const c of song.clips) {
    const s = c.start;
    const e = clipEnd(c, song);
    const near = slack(song, c);
    if (e <= a + near) {
      clips.push(c);
      continue;
    }
    if (s >= b - near) {
      clips.push(shifted(c, -span));
      continue;
    }
    const left = s < a - near ? cutRight(song, c, a) : null;
    const right = e > b + near ? cutLeft(song, c, b) : null;
    if (left) clips.push(left);
    if (right) clips.push(left ? { ...shifted(right, -span), id: spareId((taken ??= new Set(song.clips.map((x) => x.id))), c.id) } : shifted(right, -span));
  }
  /** a beat after the cut: what lay in the stretch lands on its start */
  const up = (beat: number): number => (beat >= b - EPS ? beat - span : beat > a ? a : beat);

  // the bars before the stretch keep their signatures, then come the bars that followed it with theirs
  const barA = map.barAt(a).bar;
  const barB = map.barAt(b).bar;
  const old = sigList(song);
  const list = [...old.filter((s) => s.bar < barA), { bar: barA, sig: map.sigAt(b) }, ...old.filter((s) => s.bar > barB).map((s) => ({ bar: s.bar - (barB - barA), sig: s.sig }))];
  const out: Song = { ...withSigs(song, list), clips: sameList(song.clips, clips) };
  if (song.markers) out.markers = sameList(song.markers, song.markers.filter((m) => m.beat < a - EPS || m.beat >= b - EPS).map((m) => moved(m, up(m.beat))));
  if (song.end !== undefined) out.end = up(song.end);
  out.tracks = retimed(song.tracks, up);
  return sameSong(song, out);
}

/**
 * Empty bars put in at a bar line (`at` is snapped to one; `beats` to whole bars of the signature there, at least
 * one): everything from there on is pushed later, on every track. A clip that lies across the line is cut in two
 * there. Markers, later signature changes and the song's end move too.
 */
export function insertTime(song: Song, at: number, beats: number): Song {
  if (!Number.isFinite(at) || !(beats > 0)) return song;
  const map = barMap(song);
  const a = map.snapBar(at);
  const bar = sigBeats(map.sigAt(a));
  const bars = Math.max(1, Math.round(beats / bar));
  const span = bars * bar;
  let taken: Set<string> | null = null;
  const clips: Clip[] = [];
  for (const c of song.clips) {
    const e = clipEnd(c, song);
    const near = slack(song, c);
    if (e <= a + near) clips.push(c);
    else if (c.start >= a - near) clips.push(shifted(c, span));
    else {
      const left = cutRight(song, c, a);
      const right = cutLeft(song, c, a);
      if (left) clips.push(left);
      if (right) clips.push(left ? { ...shifted(right, span), id: spareId((taken ??= new Set(song.clips.map((x) => x.id))), c.id) } : shifted(right, span));
    }
  }
  const later = (beat: number): number => (beat >= a - EPS ? beat + span : beat);
  const barA = map.barAt(a).bar;
  const out: Song = { ...withSigs(song, sigList(song).map((s) => (s.bar > barA ? { bar: s.bar + bars, sig: s.sig } : s))), clips: sameList(song.clips, clips) };
  if (song.markers) out.markers = mapList(song.markers, (m) => moved(m, later(m.beat)));
  // the song's end moves with the rest; bars put in exactly at the end of a song with no set end make it that much longer
  if (song.end !== undefined) out.end = later(song.end);
  else if (Math.abs(songEnd(song) - a) < EPS) out.end = a + span;
  out.tracks = retimed(song.tracks, later);
  return sameSong(song, out);
}

// ── copy and paste ──────────────────────────────────────────

/** How long what a clipboard holds is, in beats at a tempo (for a paste that first makes room). */
export function clipboardBeats(c: Clipboard5, bpm: number): number {
  return Math.max(0, ...c.clips.map((x) => x.start + clipBeats(x, bpm, x.kind === "audio" ? c.takes.find((k) => k.id === x.take)?.rate : undefined)));
}

/** A track as a clipboard carries it: what it is and how it sounds. Its takes travel beside it; what is being composed on it, and whether it leads, stay behind. */
function carried(t: Track): Track {
  const { draft: _d, lead: _l, group: _g, ...rest } = clone(t) as Track & { draft?: unknown; lead?: unknown };
  return (isAudioTrack(t) ? { ...rest, takes: [] } : rest) as Track;
}

/** What a copy holds: separate copies of the clips, their starts counted from the first one; each clip's track with its sound, so a paste can make the track; and the takes the audio clips play (the records only). */
export function copyOut(song: Song, ids: string[], key: Key): Clipboard5 {
  const pick = new Set(ids);
  const picked = song.clips.filter((c) => pick.has(c.id));
  const first = picked.length ? Math.min(...picked.map((c) => c.start)) : 0;
  const tracks = song.tracks.filter((t) => picked.some((c) => c.track === t.id));
  const takes: Take5[] = [];
  for (const c of picked) {
    if (c.kind !== "audio") continue;
    const t = trackOf(song, c.track);
    const take = t && isAudioTrack(t) ? t.takes.find((k) => k.id === c.take) : undefined;
    if (take && !takes.some((k) => k.id === take.id)) takes.push(clone(take));
  }
  return { key: { ...key }, clips: picked.map((c) => ({ ...clone(c), start: c.start - first })), tracks: tracks.map(carried), takes };
}

/**
 * What a clipboard holds, pasted at a beat, each clip a separate copy with a new id, its chords and notes moved into
 * this idea's key. One clip goes onto `onto` when that track takes it, else onto the first track that does. Several
 * clips each go to the track they were copied from (found by its id, then by its kind and name). A track that is not
 * in this idea is made from the clipboard's copy of it, with its sound. Audio clips bring their takes' records (the
 * files are shared). Where the clips land they trim what they cover. A note clip lands on a whole beat, a drums clip
 * on the bar line at or before.
 */
export function pasteIn(song: Song, c: Clipboard5, atBeat: number, key: Key, onto: string | null, id: () => string): Song {
  if (!c.clips.length || !Number.isFinite(atBeat)) return song;
  let out = song;
  const map = barMap(song);
  const base = c.clips.some((x) => x.kind === "drums") ? map.floorBar(atBeat) : c.clips.some((x) => x.kind !== "audio") ? map.snapBeat(atBeat) : Math.max(0, atBeat);
  const n = keyShift(c.key, key);

  /** the track of this idea a copied clip goes to (made when the idea has none for it) */
  const home = new Map<string, string>();
  const target = (clip: Clip): string => {
    const known = home.get(clip.track);
    if (known) return known;
    const src = c.tracks.find((t) => t.id === clip.track);
    const fits = (t: Track) => accepts(t.kind, clip.kind);
    let found: Track | undefined;
    if (c.clips.length === 1) found = (onto ? out.tracks.find((t) => t.id === onto && fits(t)) : undefined) ?? out.tracks.find(fits);
    else found = out.tracks.find((t) => t.id === clip.track && fits(t)) ?? (src ? out.tracks.find((t) => t.kind === src.kind && t.name === src.name && fits(t)) : undefined);
    if (!found) {
      const kind: TrackKind = src && accepts(src.kind, clip.kind) ? src.kind : clip.kind === "audio" ? "vocals" : clip.kind;
      // (its own id where that is free, so what points at it still does)
      const tid = src && !RESERVED.has(src.id) && !trackOf(out, src.id) ? src.id : id();
      out = addTrack(out, kind, tid);
      const made = trackOf(out, tid)!;
      if (src && src.kind === kind) {
        // the copy's sound, colour and name (the name only while no other track here has it); the rest is the new track's own
        const own = new Set(["id", "kind", "name", "lead", "draft", "group", "takes"]);
        const sound = Object.fromEntries(Object.entries(clone(src)).filter(([k]) => !own.has(k)));
        out = withTrack(out, made, { ...made, ...sound, name: out.tracks.some((t) => t !== made && t.name === src.name) ? made.name : src.name } as Track);
      }
      found = trackOf(out, tid)!;
    }
    home.set(clip.track, found.id);
    return found.id;
  };

  const laid: string[] = [];
  for (const x of c.clips) {
    const tid = target(x);
    const t = trackOf(out, tid)!;
    let start = base + x.start;
    if (x.kind === "drums") start = map.floorBar(start);
    const mine = { id: id(), track: tid, start };
    let copy: Clip;
    if (x.kind === "chords") copy = { ...clone(x), ...mine, content: chordsBy(clone(x.content), n, key) };
    else if (x.kind === "melody") copy = { ...clone(x), ...mine, content: tuneBy(clone(x.content), melodyShift(x.content, c.key, key)) };
    else if (x.kind === "drums") copy = { ...clone(x), ...mine };
    else {
      const sound: AudioClip = { ...clone(x), ...mine };
      copy = sound;
      // its take comes with it: the record only, placed where this clip puts its first frame
      const take = c.takes.find((k) => k.id === x.take);
      if (take && isAudioTrack(t) && !t.takes.some((k) => k.id === take.id))
        out = withTrack(out, t, { ...t, takes: [...t.takes, { ...clone(take), at: Math.max(0, zeroBeat(sound, out.bpm, take.rate > 0 ? take.rate : rateOf(out, sound))) }] });
    }
    out = { ...out, clips: [...out.clips, tidy(copy)] };
    laid.push(copy.id);
  }
  // a clip that played instead of a track that is not in this idea plays beside nothing
  out = { ...out, clips: out.clips.map((x) => (laid.includes(x.id) && x.kind === "chords" && x.instead && !trackOf(out, x.instead) ? without(x, "instead") : x)) };
  return settle(out, laid);
}
