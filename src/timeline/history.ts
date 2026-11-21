// Undo and redo for a whole idea: one list of steps for clips, tracks, mixer, sounds and everything a composer writes.
//
// A step holds the song and the key together, so undoing "Move song" puts back the notes and the key as one.
// The list is kept in memory by whoever owns the idea (it is cleared when another idea opens).
// Recordings are outside it: after every undo and redo `keepTakes` puts back any take the step would have taken away.
import type { Key } from "../theory/keys";
import type { AudioTrack, Shelved, Take5, TimelineSong, Track } from "./model";

/** The idea at one moment: its song and its key. `label` says what was done from there ("Move clip"). */
export interface Step { song: TimelineSong; key: Key; label: string }

export interface History {
  /** note the idea as it was just before a change. Changes from one control within 500 ms fold into one step */
  push(before: Step, control?: string): void;
  /** go one step back (forward): hand in the idea as it is now, get the idea to show (null: there is no such step) */
  undo(now: Step): Step | null; redo(now: Step): Step | null;
  clear(): void; canUndo: boolean; canRedo: boolean;
}

/** Changes from one control this close together are one step (a knob being turned, a slider being dragged). */
const FOLD_MS = 500;

/** A history that remembers at most `limit` steps (the oldest are forgotten first). */
export function makeHistory(limit = 100): History {
  const max = Math.max(1, Math.round(limit));
  let back: Step[] = [];
  let forward: Step[] = [];
  /** the control the last step came from, and when it last changed something */
  let last: { control: string; at: number } | null = null;
  return {
    push(before, control) {
      const at = Date.now();
      const fold = !!control && !!last && last.control === control && at - last.at < FOLD_MS && back.length > 0;
      last = control ? { control, at } : null;
      // a new change ends what could be redone
      forward = [];
      if (fold) return;
      back.push(before);
      if (back.length > max) back = back.slice(back.length - max);
    },
    undo(now) {
      const step = back.pop();
      if (!step) return null;
      forward.push(now);
      last = null;
      return step;
    },
    redo(now) {
      const step = forward.pop();
      if (!step) return null;
      back.push(now);
      if (back.length > max) back = back.slice(back.length - max);
      last = null;
      return step;
    },
    clear() {
      back = [];
      forward = [];
      last = null;
    },
    get canUndo() {
      return back.length > 0;
    },
    get canRedo() {
      return forward.length > 0;
    },
  };
}

const isAudioTrack = (t: Track): t is AudioTrack => t.kind === "vocals" || t.kind === "audio";

/**
 * After an undo or a redo: every take the song had just before is still in it.
 *
 * `restored` is the song the step brings back, `current` the song as it was just before. A take that `current` has
 * and `restored` has nowhere (on no track, and not on the shelf) is put back: on its own track when that is still
 * there, unplaced (`at: null`: the clip that played it went with the step, and "Use" lays it again); on the shelf
 * when the step took the track away too. The same song comes back when there is nothing to keep.
 */
export function keepTakes(restored: TimelineSong, current: TimelineSong): TimelineSong {
  const have = new Set<string>();
  for (const t of restored.tracks) if (isAudioTrack(t)) for (const k of t.takes) have.add(k.id);
  for (const s of restored.shelf ?? []) for (const k of s.takes) have.add(k.id);

  /** takes to put back, by the track they were on */
  const lost = new Map<string, { name: string; kind: "vocals" | "audio"; row: number; takes: Take5[] }>();
  const note = (track: string, name: string, kind: "vocals" | "audio", row: number, takes: Take5[]) => {
    for (const k of takes) {
      if (have.has(k.id)) continue;
      have.add(k.id);
      const entry = lost.get(track) ?? { name, kind, row, takes: [] };
      entry.takes.push(k);
      lost.set(track, entry);
    }
  };
  current.tracks.forEach((t, row) => {
    if (isAudioTrack(t)) note(t.id, t.name, t.kind, row, t.takes);
  });
  for (const s of current.shelf ?? []) note(s.track, s.name, s.kind, s.at, s.takes);
  if (!lost.size) return restored;

  const out: TimelineSong = { ...restored };
  if (restored.tracks.some((t) => isAudioTrack(t) && lost.has(t.id)))
    out.tracks = restored.tracks.map((t): Track => {
      const entry = isAudioTrack(t) ? lost.get(t.id) : undefined;
      if (!entry || !isAudioTrack(t)) return t;
      lost.delete(t.id);
      return { ...t, takes: [...t.takes, ...entry.takes.map((k) => (k.at === null ? k : { ...k, at: null }))] };
    });
  // what is left belonged to tracks the step took away: onto the shelf
  if (lost.size) {
    let shelf: Shelved[] = restored.shelf ?? [];
    for (const [track, entry] of lost) {
      const i = shelf.findIndex((s) => s.track === track);
      if (i >= 0) shelf = shelf.map((s, k) => (k === i ? { ...s, takes: [...s.takes, ...entry.takes] } : s));
      else shelf = [...shelf, { track, name: entry.name, kind: entry.kind, takes: entry.takes, at: entry.row, saves: 0 }];
    }
    out.shelf = shelf;
  }
  return out;
}
