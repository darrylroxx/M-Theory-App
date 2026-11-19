/**
 * Clips: what a vocal track plays from its takes, as edited on the Vocals lane.
 *
 * A clip is a stretch of one take, laid where the take was sung (and moved from there if it was
 * dragged). Nothing is ever cut out of a file: trimming a clip's edge, splitting it, moving it
 * or deleting it only changes which stretch of which take plays where. Every take of one
 * recording is the same length and was sung over the same bars, so a clip can be switched to
 * another take of its recording (comping): the same stretch of that pass plays in its place.
 * So can a take of another recording sung from the same bar (the loop recorded again): it
 * keeps the same time, so it is another alternative for the same place.
 *
 * All the numbers are frames of the take's own file (at the take's rate): `from`..`to` is the
 * stretch of the take, counted from the take's first frame; `move` is how far later (or, below
 * zero, earlier) than where it was sung it plays. A trim never moves the voice: the part that
 * is left plays exactly where it did.
 */
import { activeTake, groupsOf, type Take } from "./takes";

export interface Clip {
  id: string;
  /** the take it plays (any take of the same recording can be swapped in) */
  take: string;
  /** the stretch of the take it plays: frames from the take's first frame (from < to ≤ take.frames) */
  from: number;
  to: number;
  /** frames later than where it was sung (earlier, below zero) */
  move?: number;
}

/** What a vocal track holds of these (a Track has more). */
export interface ClipHolder {
  takes?: Take[];
  active?: Record<string, string>;
  clips?: Clip[];
}

/** The shortest a clip can be trimmed or split to (seconds). */
export const MIN_CLIP = 0.02;

/** Can one take stand in for another in a clip: of one recording, or of recordings sung from the same bar at the same rate (one timeline)? */
export const sameSpot = (a: Take, b: Take): boolean => a.group === b.group || (a.at.block === b.at.block && a.at.bar === b.at.bar && a.rate === b.rate);

/** A whole take as a clip, where it was sung. */
export const wholeClip = (t: Take, id: string): Clip => ({ id, take: t.id, from: 0, to: t.frames });

/**
 * The clips of a track saved before clips existed: the take that played from each recording,
 * whole, where it was sung (exactly as it played). Their ids are made from the take's, so the
 * same track gives the same clips every time.
 */
export function migrateClips(takes: Take[] | undefined, active: Record<string, string> | undefined): Clip[] {
  const out: Clip[] = [];
  for (const g of groupsOf(takes)) {
    const t = activeTake(takes ?? [], g, active?.[g]);
    if (t) out.push(wholeClip(t, `${t.id}~c`));
  }
  return out;
}

/** The clips a track plays: its own, or (saved before clips) one whole take from each recording. */
export const clipsOf = (h: ClipHolder): Clip[] => (Array.isArray(h.clips) ? h.clips : migrateClips(h.takes, h.active));

/** Every clip with its take (a clip whose take is gone is left out). */
export function placedClips(h: ClipHolder): { clip: Clip; take: Take }[] {
  const by = new Map((h.takes ?? []).map((t) => [t.id, t]));
  return clipsOf(h).flatMap((clip) => {
    const take = by.get(clip.take);
    return take ? [{ clip, take }] : [];
  });
}

/** The takes the clips play (each once): these are read from disk and kept. */
export function playedTakes(h: ClipHolder): Take[] {
  const seen = new Set<string>();
  const out: Take[] = [];
  for (const { take } of placedClips(h)) if (!seen.has(take.id)) seen.add(take.id), out.push(take);
  return out;
}

/** Is a take played anywhere on its track (all of it, or a piece)? */
export const inUse = (h: ClipHolder, take: string): boolean => clipsOf(h).some((c) => c.take === take);

/** Clips loaded from storage, made safe: whole numbers, inside their take, longer than nothing. Those whose take is gone are dropped. */
export function reviveClips(raw: unknown, takes: Take[] | undefined): Clip[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const by = new Map((takes ?? []).map((t) => [t.id, t]));
  const out: Clip[] = [];
  for (const c of raw as Partial<Clip>[]) {
    if (!c || typeof c.id !== "string" || typeof c.take !== "string" || out.some((x) => x.id === c.id)) continue;
    const t = by.get(c.take);
    if (!t || !Number.isFinite(c.from) || !Number.isFinite(c.to)) continue;
    const from = Math.max(0, Math.round(c.from!));
    const to = Math.min(t.frames, Math.round(c.to!));
    if (!(to > from)) continue;
    const move = Number.isFinite(c.move) ? Math.round(c.move!) : 0;
    out.push({ id: c.id, take: c.take, from, to, ...(move ? { move } : {}) });
  }
  return out;
}

// ── edits (each gives the track's new clips, the rest of the track as it was) ──

const minFrames = (t: Take) => Math.max(1, Math.round(MIN_CLIP * t.rate));
const tidy = (c: Clip): Clip => {
  const { move, ...rest } = c;
  return move ? { ...rest, move } : rest;
};
const swap = (clips: Clip[], id: string, fn: (c: Clip) => Clip | Clip[] | null): Clip[] => clips.flatMap((c) => (c.id !== id ? [c] : fn(c) ?? []));

/**
 * Trim a clip's edge to `frame` (a frame of its take): the start (`"from"`) or the end
 * (`"to"`). Kept inside the take, and never shorter than MIN_CLIP. The voice stays where it is.
 */
export function trimClip(clips: Clip[], id: string, edge: "from" | "to", frame: number, take: Take): Clip[] {
  const min = minFrames(take);
  return swap(clips, id, (c) => {
    const f = Math.round(frame);
    return edge === "from" ? { ...c, from: Math.max(0, Math.min(f, c.to - min)) } : { ...c, to: Math.min(take.frames, Math.max(f, c.from + min)) };
  });
}

/** Move a clip: `move` frames from where it was sung (not from where it is). */
export const moveClip = (clips: Clip[], id: string, move: number): Clip[] => swap(clips, id, (c) => tidy({ ...c, move: Math.round(move) }));

/**
 * Split a clip in two at `frame` (a frame of its take). The first piece keeps the clip's id,
 * the second gets `newId`; both play exactly what the one did. Nothing happens unless both
 * pieces would be at least MIN_CLIP long.
 */
export function splitClip(clips: Clip[], id: string, frame: number, take: Take, newId: string): Clip[] {
  const f = Math.round(frame);
  const min = minFrames(take);
  return swap(clips, id, (c) => (f - c.from < min || c.to - f < min ? c : [{ ...c, to: f }, tidy({ ...c, id: newId, from: f })]));
}

/** Delete a clip (the take stays). */
export const deleteClip = (clips: Clip[], id: string): Clip[] => clips.filter((c) => c.id !== id);

/** Play another take of the same recording in a clip's place: the same stretch of that pass (comping). */
export function compClip(h: ClipHolder, id: string, take: string): Clip[] {
  const clips = clipsOf(h);
  const by = new Map((h.takes ?? []).map((t) => [t.id, t]));
  const c = clips.find((x) => x.id === id);
  const now = c && by.get(c.take);
  const next = by.get(take);
  if (!c || !now || !next || !sameSpot(now, next)) return clips;
  // a short last pass has less in it: the stretch is cut to what it holds
  const to = Math.min(c.to, next.frames);
  if (to - c.from < minFrames(next)) return clips;
  return swap(clips, id, (x) => ({ ...x, take, to }));
}

/**
 * Use a take: it plays wherever its recording (or another sung from the same bar) does, in
 * every clip there (as edited). With nothing there left playing, the whole take comes back.
 */
export function chooseTake(h: ClipHolder, take: string, newId: string): Pick<ClipHolder, "clips" | "active"> {
  const t = (h.takes ?? []).find((x) => x.id === take);
  const clips = clipsOf(h);
  if (!t) return { clips, active: h.active };
  const by = new Map((h.takes ?? []).map((x) => [x.id, x]));
  const here = (c: Clip) => {
    const k = by.get(c.take);
    return !!k && sameSpot(k, t);
  };
  const min = minFrames(t);
  const next = clips.some(here)
    ? clips.flatMap((c) => {
        if (!here(c)) return [c];
        const to = Math.min(c.to, t.frames);
        return to - c.from < min ? [] : [{ ...c, take, to }];
      })
    : [...clips, wholeClip(t, newId)];
  return { clips: next, active: { ...h.active, [t.group]: take } };
}

/**
 * Delete a take from the song (its file stays on disk). The clips that played it play the
 * next best take of the recording instead (the last ★, else the last full pass); a recording
 * with no takes left has no clips either.
 */
export function deleteTake(h: ClipHolder, take: string): Pick<ClipHolder, "takes" | "clips" | "active"> {
  const t = (h.takes ?? []).find((x) => x.id === take);
  const clips = clipsOf(h);
  if (!t) return { takes: h.takes, clips, active: h.active };
  const takes = (h.takes ?? []).filter((x) => x.id !== take);
  const chosen = h.active?.[t.group];
  const instead = activeTake(takes, t.group, chosen === take ? undefined : chosen);
  const active = { ...h.active };
  if (instead) active[t.group] = instead.id;
  else delete active[t.group];
  const next = !clips.some((c) => c.take === take) ? clips : clips.flatMap((c) => {
    if (c.take !== take) return [c];
    if (!instead) return [];
    const to = Math.min(c.to, instead.frames);
    return to - c.from < minFrames(instead) ? [] : [{ ...c, take: instead.id, to }];
  });
  return { takes, clips: next, active };
}

/** Remove a whole recording: its takes and its clips (the files stay on disk). */
export function removeRecording(h: ClipHolder, group: string): Pick<ClipHolder, "takes" | "clips" | "active"> {
  const gone = new Set((h.takes ?? []).filter((t) => t.group === group).map((t) => t.id));
  return {
    takes: (h.takes ?? []).filter((t) => !gone.has(t.id)),
    clips: clipsOf(h).filter((c) => !gone.has(c.take)),
    active: Object.fromEntries(Object.entries(h.active ?? {}).filter(([g]) => g !== group)),
  };
}

/**
 * A new recording's takes come in: the one that plays (the last ★, else the last full pass) is
 * laid whole where it was sung. Sung again over what an earlier recording plays from the same
 * bar, it plays there instead: the earlier clips make way where the new one lies (as a punch
 * in: what they had before it and after it still plays), and are one choice away (Use).
 */
export function addRecording(h: ClipHolder, takes: Take[], id: () => string): Pick<ClipHolder, "takes" | "clips"> {
  const clips = clipsOf(h);
  const all = [...(h.takes ?? []), ...takes];
  const g = takes[0]?.group;
  const t = g ? activeTake(takes, g) : undefined;
  if (!t) return { takes: all, clips };
  const by = new Map((h.takes ?? []).map((x) => [x.id, x]));
  const end = t.frames;
  const kept = clips.flatMap((c) => {
    const k = by.get(c.take);
    if (!k || !sameSpot(k, t)) return [c];
    // where it plays, on the same timeline as the new take (frames from the bar both were sung from)
    const m = c.move ?? 0;
    const a = c.from + m;
    const b = c.to + m;
    if (b <= 0 || a >= end) return [c];
    const min = minFrames(k);
    const out: Clip[] = [];
    if (-a >= min) out.push({ ...c, to: -m });
    if (b - end >= min) out.push(tidy({ ...c, id: out.length ? id() : c.id, from: end - m }));
    return out;
  });
  return { takes: all, clips: [...kept, wholeClip(t, id())] };
}

// ── undo ──

/** An edit to one track's takes and clips: what it was before, and what it left. */
export interface UndoStep<T> {
  track: string;
  before: T;
  after: T;
}

/** The last edit made on `track` (each track's edits are taken back on their own), and the list without it. */
export function popUndo<T>(steps: readonly UndoStep<T>[], track: string): { step?: UndoStep<T>; rest: UndoStep<T>[] } {
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].track === track) return { step: steps[i], rest: [...steps.slice(0, i), ...steps.slice(i + 1)] };
  return { rest: [...steps] };
}

// ── time ──

/**
 * How far a 1/16 note is, in frames of a take at `rate`, at `bpm`. `perBeat`: 1/16 notes in a
 * beat: 4 where a beat is a quarter note, 6 in x/8, where a beat is a dotted quarter.
 */
export const gridFrames = (rate: number, bpm: number, perBeat = 4): number => (rate * 60) / Math.max(1, bpm) / Math.max(1, perBeat);

/** 1/16 notes in a beat of a bar of `beats` beats in x/8 (`compound`) or not. */
export const sixteenths = (compound: boolean): number => (compound ? 6 : 4);

/**
 * A move kept to whole 1/16 notes (sung on the beat, it stays on a beat), unless `free`. `origin`:
 * where (frames from where it was sung) the bar it lands in starts, so it keeps to that bar's
 * grid even where the bars before it do not end on a whole 1/16 note of it.
 */
export function snapMove(move: number, rate: number, bpm: number, free = false, perBeat = 4, origin = 0): number {
  if (free) return Math.round(move);
  const g = gridFrames(rate, bpm, perBeat);
  return Math.round(origin + Math.round((move - origin) / g) * g);
}

/** Where a clip plays, from the bar its take was sung on: its start and its end (seconds). */
export function clipSpan(c: Clip, t: Pick<Take, "rate">): { start: number; end: number } {
  const m = c.move ?? 0;
  return { start: (c.from + m) / t.rate, end: (c.to + m) / t.rate };
}

/**
 * Where clips lie in the song: for every section (in the song's order, each with the beats in a
 * bar and the beats it lasts), the clips that sound in it, each with where its sound starts
 * counted from the section's start (beats), how far into its take that is (seconds), and how
 * long it plays (seconds). One that runs across several sections is listed in each it reaches
 * (at a place before the start of those after the first), so wherever the music is, the player
 * knows which part of which clip lies under it. A clip whose section is gone is left out.
 * `joined`: it starts where another clip of the same take ends, in the same place (a split): the
 * two are one sound.
 */
export function layClips<T extends Pick<Take, "at" | "frames" | "rate">>(secs: readonly { block: string; bar: number; beats: number }[], clips: readonly { clip: Clip; take: T }[], bpm: number): Record<string, { clip: Clip; take: T; at: number; offset: number; dur: number; joined: boolean }[]> {
  const start: Record<string, { at: number; bar: number }> = {};
  let pos = 0;
  for (const s of secs) {
    start[s.block] = { at: pos, bar: s.bar };
    pos += s.beats;
  }
  const out: Record<string, { clip: Clip; take: T; at: number; offset: number; dur: number; joined: boolean }[]> = {};
  for (const s of secs) out[s.block] = [];
  const spb = 60 / Math.max(1, bpm);
  for (const { clip, take } of clips) {
    const from = start[take.at.block];
    if (!from || !(take.rate > 0) || !(clip.to > clip.from)) continue;
    const span = clipSpan(clip, take);
    const begin = from.at + take.at.bar * from.bar + span.start / spb;
    const len = (span.end - span.start) / spb;
    const joined = clips.some((x) => x.clip !== clip && x.clip.take === clip.take && x.clip.to === clip.from && (x.clip.move ?? 0) === (clip.move ?? 0));
    for (const s of secs) {
      const at = begin - start[s.block].at;
      if (at < s.beats - 1e-6 && at + len > 1e-6) out[s.block].push({ clip, take, at, offset: clip.from / take.rate, dur: (clip.to - clip.from) / take.rate, joined });
    }
  }
  return out;
}

/**
 * Where a track's clips are drawn in each section of a row of sections (each `bar` beats a bar,
 * `beats` long): in bars from the section's start, and how many bars long (counted in that
 * section's bars). One that runs across sections is in each it reaches, from before the start
 * of those after the first, so each section shows its own part of it.
 */
export function clipBars<T extends Pick<Take, "at" | "frames" | "rate">>(secs: readonly { block: string; bar: number; beats: number }[], clips: readonly { clip: Clip; take: T }[], bpm: number): Record<string, { clip: Clip; take: T; x: number; w: number }[]> {
  const laid = layClips(secs, clips, bpm);
  const spb = 60 / Math.max(1, bpm);
  const out: Record<string, { clip: Clip; take: T; x: number; w: number }[]> = {};
  for (const s of secs) out[s.block] = (laid[s.block] ?? []).map(({ clip, take, at, dur }) => ({ clip, take, x: at / s.bar, w: dur / spb / s.bar }));
  return out;
}

// ── the lane: every bar is drawn the same width, whatever its beats ──

/** How many beats from the lane's start a place on it is (`pos` in bars, as drawn; before or after the bars, at the first's or the last's length). */
export function laneBeats(bars: readonly { beats: number }[], pos: number): number {
  const len = (k: number) => (bars[k]?.beats > 0 ? bars[k].beats : 1);
  if (!bars.length) return pos * 4;
  if (pos < 0) return pos * len(0);
  let at = 0;
  const k = Math.floor(pos);
  for (let i = 0; i < Math.min(k, bars.length); i++) at += len(i);
  return k >= bars.length ? at + (pos - bars.length) * len(bars.length - 1) : at + (pos - k) * len(k);
}

/** Where on the lane (in bars, as drawn) a moment `beats` from its start is: the inverse of laneBeats. */
export function lanePos(bars: readonly { beats: number }[], beats: number): number {
  const len = (k: number) => (bars[k]?.beats > 0 ? bars[k].beats : 1);
  if (!bars.length) return beats / 4;
  if (beats < 0) return beats / len(0);
  let left = beats;
  for (let k = 0; k < bars.length; k++) {
    if (left < len(k)) return k + left / len(k);
    left -= len(k);
  }
  return bars.length + left / len(bars.length - 1);
}
