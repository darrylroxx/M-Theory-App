// The old app state as the new one, and what happens when an old-format copy of an idea turns up later.
//
// Conversion reads old data and never writes it: every converted idea keeps the date of the copy it came from (so no
// device wins a merge just by having converted), and gets a backup entry that stands for the untouched original.
import { barsOf, kitOfBeat } from "../audio/beats";
import { GUITAR } from "../audio/tone";
import type { DrumClip, MelodyClip as OldMelodyClip, RhythmClip } from "../song/clip";
import { fingerprint, isBlank, reviveIdea, snapshot } from "../song/library";
import { melodyBars } from "../song/melody";
import { isCompound, fitRhythm, sigBeats, sigFor } from "../song/meter";
import { commit, settle } from "../song/structure";
import { PLAIN_KIT, PLAIN_STYLE, normalize, prune } from "../song/tracks";
import { conform } from "../song/unity";
import type { App5State } from "../ui/app5";
import type { AppStateV4, Progression, SavedProgression } from "../ui/state";
import { emptySong5, fingerprint5, rhythmOf, type SavedIdea } from "./library5";
import { toTimeline } from "./migrate5";
import type { Clipboard5, Session, TimelineSong } from "./model";

const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));
const tidy = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** An old song as the old loader leaves it: every track in its place, the page written back, repeats written out, in its bars. */
const settled = (p: Progression): Progression => conform(settle(prune(commit(normalize(p)))));

/** An old song as tracks and clips. A song that cannot be read at all gives an empty one (it never throws: the original is kept as the backup). */
function songOf(p: Progression): TimelineSong {
  try {
    return toTimeline(settled(p)).song;
  } catch {
    return emptySong5(Number(p?.bpm) || 84);
  }
}

/** The names of what conversion adds to the ideas list. */
export const backupId = (id: string): string => `${id}-v4`;
export const besideId = (id: string): string => `${id}-o`;

/** The backup entry that stands for an old idea: its name and dates, an empty song (the original is read from where it is kept). */
function backupOf(i: SavedProgression, o: { id?: string; name?: string; unsaved?: true } = {}): SavedIdea {
  return tidy({
    id: o.id ?? backupId(i.id), name: o.name ?? `${i.name} (before track view)`, key: i.key, savedAt: i.savedAt, updatedAt: i.updatedAt, capo: i.capo, tuningId: i.tuningId,
    song: emptySong5(), backup: { of: i.id, ...(o.unsaved ? { unsaved: true as const } : {}) },
  });
}

/** One old idea as a new one, with its backup entry. The converted idea keeps the old `updatedAt` and records it in `from.at`. */
export function convertIdea(i0: SavedProgression): { idea: SavedIdea; backup: SavedIdea } {
  // (a copy that came as stored text is loaded the old way first; one already loaded comes back as it is)
  const i = reviveIdea(i0) ?? i0;
  const idea: SavedIdea = tidy({ id: i.id, name: i.name, key: i.key, savedAt: i.savedAt, updatedAt: i.updatedAt, capo: i.capo, tuningId: i.tuningId, song: songOf(i.progression), from: { at: i.updatedAt ?? i.savedAt } });
  return { idea, backup: backupOf(i) };
}

/** What is open and selected when an idea opens: nothing, from the first beat, sixteen bars of 4/4 across the lanes. */
export const newSession = (): Session => ({ cursor: 0, loop: null, sel: { clips: [], track: null }, pxPerBeat: 16, scroll: 0, armed: null, windows: [] });

/**
 * What was last copied on the old Chords, Melody and Drums pages, as the one clipboard there is now: one clip at the
 * first beat, and a track of its kind that carries the instrument and sound (or the kit) it was copied with, so a
 * paste where no such track exists makes the track with that sound. (The old app kept one clipboard for each page and
 * did not note which was used last: the chords win, then the melody, then the drums.)
 */
export function clipboard5(old: AppStateV4["clip"]): Clipboard5 | undefined {
  const head = { id: "copied", track: "copied-track", start: 0, off: 0 };
  const r: RhythmClip | undefined = old?.rhythm;
  if (r?.chords.length) {
    const sig = sigFor(r.bar ?? 4, false);
    const bar = sigBeats(sig);
    const bars = Math.max(1, Math.min(32, Math.ceil(r.chords.reduce((a, c) => a + c.beats, 0) / bar - 1e-6)));
    return {
      key: r.key, takes: [],
      clips: [{ ...head, kind: "chords", len: bars * bar, sig, content: tidy({ chords: clone(r.chords), bars, style: r.pattern ?? PLAIN_STYLE, feel: clone(r.feel), arrange: clone(r.arrange) }) }],
      tracks: [tidy({ id: head.track, kind: "chords" as const, name: "Chords", tone: clone(r.tone ?? GUITAR), sound: clone(r.sound) })],
    };
  }
  const m: OldMelodyClip | undefined = old?.melody;
  if (m?.melody?.notes.length) {
    const sig = sigFor(m.bar ?? 4, false);
    const bars = melodyBars(m.melody);
    const { on: _on, ...content } = m.melody;
    return {
      key: m.key, takes: [],
      clips: [{ ...head, kind: "melody", len: bars * sigBeats(sig), sig, content: clone({ ...content, bars }) }],
      tracks: [tidy({ id: head.track, kind: "melody" as const, name: "Melody", tone: clone(m.tone ?? GUITAR), sound: clone(m.tuneSound) })],
    };
  }
  const d: DrumClip | undefined = old?.drums;
  if (d?.beat) {
    const sig = sigFor(d.bar ?? d.beat.steps / d.beat.div, false);
    const beat = fitRhythm(d.beat, sigBeats(sig), isCompound(sig));
    const bars = barsOf(beat);
    return {
      key: d.key, takes: [],
      clips: [{ ...head, kind: "drums", len: bars * sigBeats(sig), sig, content: clone(rhythmOf(beat)), ...(beat.on ? {} : { mute: true }) }],
      // (a copy from before copies carried the kit brings only its rhythm)
      tracks: [{ id: head.track, kind: "drums", name: "Drums", kit: clone(d.whole ? kitOfBeat(d.beat) : PLAIN_KIT) }],
    };
  }
  return undefined;
}

/**
 * The whole old app state as the new one: every saved idea and the idea on screen converted, a backup entry for each,
 * every other field copied unchanged. `now`: the moment, noted as when the conversion was done.
 */
export function convertAll(old: AppStateV4, now: number = Date.now()): App5State {
  const ideas: SavedIdea[] = [];
  const backups: SavedIdea[] = [];
  const times: Record<string, number> = {};
  for (const i of old.saved) {
    const c = convertIdea(i);
    ideas.push(c.idea);
    backups.push(c.backup);
    times[c.idea.id] = c.idea.from!.at;
  }
  // the idea on screen: its music is the page's, not the saved list's
  const capo = old.settings.capo;
  const tuningId = old.settings.tuningId;
  const open = old.ideaId ? old.saved.find((i) => i.id === old.ideaId) : undefined;
  if (!open) {
    // never saved: it gets an entry of its own, unless there is nothing in it
    if (!isBlank(old.progression)) {
      const id = `draft-${old.draft ?? "0"}`;
      backups.push(backupOf({ id, name: "Unsaved idea", key: old.key, progression: old.progression, savedAt: now, updatedAt: now, capo, tuningId }, { name: "Unsaved idea (before track view)", unsaved: true }));
    }
  } else if (fingerprint(snapshot(old.key, old.progression, capo, tuningId)) !== fingerprint(snapshot(open.key, open.progression, open.capo ?? capo, open.tuningId ?? tuningId))) {
    // saved, and open with changes not saved yet: those are kept too
    backups.push(backupOf(open, { id: `${open.id}-u-v4`, name: `${open.name} (unsaved, before track view)`, unsaved: true }));
  }
  const clip = clipboard5(old.clip);
  return tidy({
    key: old.key, settings: old.settings,
    song: songOf(old.progression), saved: [...ideas, ...backups], session: newSession(),
    shapes: old.shapes, myBeats: old.myBeats, myKits: old.myKits, mySounds: old.mySounds,
    canvas: old.canvas, ideaId: old.ideaId, draft: old.draft, tombs: old.tombs, clip, studio: old.studio, view: old.view,
    converted: { at: now, ideas: times },
  });
}

/**
 * An old-format copy of an idea turns up: from the cloud, from a version 1 backup file, or because an old tab wrote the
 * old key again. `original(id)` gives the old idea a backup entry stands for (null when it cannot be read here).
 *
 *  - a deletion of its id is as new or newer: ignored
 *  - no idea has its id: converted and added, with its backup entry ("new")
 *  - an idea has its id and came from this copy or a newer one: ignored
 *  - the copy is newer, and the idea was not edited since it was converted: the idea is replaced by a fresh conversion
 *    of the newer copy, and its backup entry stands for the newer copy ("refreshed"; the caller keeps that copy where
 *    `original` reads from)
 *  - the copy is newer, and the idea was edited in the new app: the copy is converted and added beside it, as
 *    "<name> (edited in the old version)" ("beside"). The same copy arriving again adds nothing.
 */
export function arrive(s: App5State, old0: SavedProgression, original: (id: string) => SavedProgression | null): { state: App5State; added?: "new" | "refreshed" | "beside" } {
  const old = reviveIdea(old0) ?? old0;
  const t = old.updatedAt ?? old.savedAt;
  if ((s.tombs?.[old.id] ?? 0) >= t) return { state: s };
  /** the list with one converted copy in it (in place of the idea it replaces, if any), and its backup entry unless that was deleted */
  const put = (c: { idea: SavedIdea; backup: SavedIdea }): App5State => {
    const tombs = { ...s.tombs };
    delete tombs[c.idea.id];
    const dead = (tombs[c.backup.id] ?? 0) > 0;
    const rest = s.saved.filter((i) => i.id !== c.idea.id && i.id !== c.backup.id);
    const at = s.saved.findIndex((i) => i.id === c.idea.id);
    const saved = at < 0 ? [c.idea, ...rest] : [...rest.slice(0, at), c.idea, ...rest.slice(at)];
    return { ...s, saved: [...saved, ...(dead ? [] : [c.backup])], tombs, converted: { at: s.converted?.at ?? 0, ...s.converted, ideas: { ...s.converted?.ideas, [c.idea.id]: c.idea.from!.at } } };
  };
  const mine = s.saved.find((i) => i.id === old.id && !i.backup);
  if (!mine) return { state: put(convertIdea(old)), added: "new" };
  if (mine.from && t <= mine.from.at) return { state: s };
  // edited since it was converted? (unknown when its original cannot be read: then it is treated as edited, so nothing is lost)
  const was = original(old.id);
  const untouched = !!mine.from && !!was && fingerprint5(mine) === fingerprint5(convertIdea(was).idea);
  if (untouched) return { state: put(convertIdea(old)), added: "refreshed" };
  const id = besideId(old.id);
  const there = s.saved.find((i) => i.id === id && !i.backup);
  if ((s.tombs?.[id] ?? 0) >= t || (there && t <= (there.from?.at ?? Infinity))) return { state: s };
  // (a still newer copy, while the one beside is as it arrived, takes its place; one that was edited too is left alone)
  if (there) {
    const prev = original(id);
    if (!(prev && fingerprint5(there) === fingerprint5(convertIdea({ ...prev, id, name: there.name }).idea))) return { state: s };
  }
  return { state: put(convertIdea({ ...old, id, name: `${old.name} (edited in the old version)` })), added: "beside" };
}
