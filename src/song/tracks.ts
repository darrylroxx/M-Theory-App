/**
 * Tracks. Every section has one chords track, one melody track and one drums track (the "first"
 * of each kind; they can be empty or off), and any number of tracks added with a + in only the
 * sections they were added to. A new track is plain: nothing is copied from another track.
 *
 * A track is a row of the song (its name, its place on the Track page, its volume, mute and solo),
 * and it is in a section when that section has a part for it: its `layers` entry, keyed by the
 * track's id. That part is everything about the track in that section, and only there: an added
 * chords track's chords and how they are played (`pattern`, `feel`, `sound`), an added melody's
 * notes and its harp (`tuneSound`), an added drums track's rhythm with its kit (`beat`). What
 * plays a chords or melody track (Guitar, Piano or Synth) is in the section's `tones`, by track
 * id. Anything missing is the plain default. The first tracks keep theirs on the section itself
 * (see ./structure). Vocal tracks are the exception: they run across the whole song.
 *
 * The pages edit one track of their kind at a time. The track being edited sits in the same
 * place the first track always does, so every page works the same for any track. While another
 * track of a kind is being edited, the first track's things (its notes and its sound) are kept
 * aside in `layers` under the kind's own name. `normalize` puts everything back where it belongs;
 * `refocus` brings a chosen track forward again (only in a section that has it).
 */
import { DEFAULT_BEAT, emptyRows, kitOfBeat, reviveBeat, type Beat, type DrumKit } from "../audio/beats";
import { hasStyle, reviveFeel, type Feel, type PatternId } from "../audio/patterns";
import { reviveSound, type HarpSound } from "../audio/rack";
import { reviveMelody, type Melody } from "./melody";
import type { ArrangeSettings, ProgChord, Progression } from "../ui/state";
import { reviveFx, type VocalFx } from "../audio/vocalfx";
import { reviveTakes, type Take } from "./takes";
import { migrateClips, reviveClips, type Clip } from "./clips";
import { withoutTone } from "../audio/tone";
import type { Mix } from "../audio/mix";
import { HARMONY_OPTIONS } from "../theory/harmonize";

export type TrackKind = "chords" | "melody" | "drums" | "vocals";
/** The kinds a page edits by bringing a track forward. */
export type EditKind = "chords" | "melody" | "drums";
export const EDIT_KINDS: EditKind[] = ["chords", "melody", "drums"];
export const KIND_NAME: Record<TrackKind, string> = { chords: "Chords", melody: "Melody", drums: "Drums", vocals: "Vocal" };

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  /** a vocal track: which input it records (1 = the mic input, 2 = the instrument/line jack) */
  input?: 1 | 2;
  /** a vocal track: its live sound (the vocal chain), its recorded takes, and which take plays from each recording */
  fx?: VocalFx;
  takes?: Take[];
  active?: Record<string, string>;
  /** a vocal track: what it plays of its takes, as edited (see song/clips; a track saved before has one whole take from each recording) */
  clips?: Clip[];
  /** a chords or melody track written to go with another: the canvas paints it as a harmony line */
  role?: "harmony";
  /** a harmony track: what it was written from and how (see song/harmony), so it can be written again */
  harmony?: HarmonyOf;
  /** a chords track that played instead of another and lost its source: the one it still plays instead of… */
  replaces?: string;
  /** …and the sections it does, by part id (a track from an older version has none: it did so through the mixer) */
  replacesIn?: string[];
}

/**
 * Where a harmony track came from: the track it was written from, the option it was written
 * with, and for each section (by part id) a fingerprint of the source as it was then and of what
 * was written. A section whose notes no longer match was changed by hand since; one whose source
 * no longer matches has a source that changed since.
 */
export interface HarmonyOf {
  from: string;
  /** the option it was last written with (a section's record says what it was written with there) */
  option: string;
  marks?: Record<string, HarmonyMark>;
}
export interface HarmonyMark {
  src: string;
  out: string;
  /** the option it was written with in this section (a record from before has none: the track's) */
  option?: string;
  /**
   * it plays along with the chords here, though it was written to play instead of them: a song
   * from an older version, where those chords were unmuted by hand to hear both
   */
  along?: true;
}

/**
 * What one track is in one section: its music there and how it sounds there. An added chords
 * track: its chords, playing style, feel and harp; an added melody: its notes and its harp; an
 * added drums track: its rhythm and on/off, on its kit there (`beat`). (The first track of a kind
 * kept aside while another is edited is kept the same way.) An empty one (`{}`) is a track that is
 * in the section with nothing in it yet, on plain settings.
 */
export interface Layer {
  chords?: ProgChord[];
  /** on the guitar: the area of the neck its chords are arranged in (none: each chord's own shape) */
  arrange?: ArrangeSettings;
  pattern?: PatternId;
  feel?: Partial<Feel>;
  sound?: Partial<HarpSound>;
  melody?: Melody;
  tuneSound?: Partial<HarpSound>;
  beat?: Beat;
}
export type Layers = Record<string, Layer>;
export type Focus = Partial<Record<EditKind, string>>;

/** The first track of each kind has the kind's own name as its id. */
export const isFirst = (id: string) => (EDIT_KINDS as string[]).includes(id);

/** Every track of the song in order: the first three, then the extra ones as they were added. */
export function allTracks(p: Pick<Progression, "tracks">): Track[] {
  return [
    { id: "chords", kind: "chords", name: "Chords" },
    { id: "melody", kind: "melody", name: "Melody" },
    { id: "drums", kind: "drums", name: "Drums" },
    ...(p.tracks ?? []),
  ];
}
export const tracksOf = (p: Pick<Progression, "tracks">, kind: TrackKind) => allTracks(p).filter((t) => t.kind === kind);

/** The next free name for a new track of a kind: "Chords 2", "Vocal 1" … */
export function nextName(p: Pick<Progression, "tracks">, kind: TrackKind): string {
  const base = KIND_NAME[kind];
  const taken = new Set(allTracks(p).map((t) => t.name));
  for (let n = kind === "vocals" ? 1 : 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** A drum track that has nothing in it yet: the grid is empty and it is off until a step is set. */
export const emptyBeat = (like: Beat = DEFAULT_BEAT): Beat => ({ ...like, on: false, patternId: null, name: "Empty", edited: false, bars: 1, rows: emptyRows(like.steps) });

/** How a new chords track is played: let ring. */
export const PLAIN_STYLE: PatternId = "ring";
/** The kit a new drums track starts on. */
export const PLAIN_KIT: DrumKit = kitOfBeat(DEFAULT_BEAT);
/** What an added drums track plays in a section: its rhythm there, on its kit there. */
export const drumsOf = (l: Layer | undefined): Beat | undefined => l?.beat;
/** A plain new drums track: nothing in it yet, on the plain kit. */
export const plainBeat = (): Beat => emptyBeat(DEFAULT_BEAT);
/** A track of a kind as it comes into a section: plain, with nothing in it yet. */
export function plainLayer(kind: EditKind): Layer {
  return kind === "chords" ? { chords: [] } : kind === "melody" ? {} : { beat: plainBeat() };
}
/** Does a track's part of a section hold music: a chord that is not a rest, a melody note, drums on with a hit? */
export function hasMusic(l: Layer | undefined): boolean {
  if (!l) return false;
  if (l.chords?.some((c) => !c.rest)) return true;
  if (l.melody?.notes.length) return true;
  return !!l.beat?.on && Object.values(l.beat.rows ?? {}).some((r) => /[1-9]/.test(r));
}

/** What the page shows for a kind, taken off the page. */
function takeLive(p: Progression, kind: EditKind): Layer {
  if (kind === "chords") return { chords: p.chords, arrange: p.arrange ?? undefined, pattern: p.pattern, feel: p.feel, sound: p.sound };
  if (kind === "melody") return { melody: p.melody, tuneSound: p.tuneSound };
  return { beat: p.beat };
}
/** Put a kind's things on the page. */
function putLive(p: Progression, kind: EditKind, l: Layer): Progression {
  if (kind === "chords") return { ...p, chords: l.chords ?? [], arrange: l.arrange ?? null, pattern: l.pattern ?? p.pattern, feel: l.feel, sound: l.sound };
  if (kind === "melody") return { ...p, melody: l.melody, tuneSound: l.tuneSound };
  return { ...p, beat: l.beat };
}
const tidy = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const without = (o: Layers | undefined, key: string): Layers | undefined => {
  if (!o || !(key in o)) return o;
  const { [key]: _, ...rest } = o;
  return Object.keys(rest).length ? rest : undefined;
};

/**
 * The first track of a kind as it is, also while its page has an added track of that kind brought
 * forward: the first's things then wait aside in `layers` (empty where it never had any of its own),
 * and the page holds the added track's, which must never stand in for them.
 */
export function firstLayer(p: Progression, kind: EditKind): Layer {
  const id = p.focus?.[kind];
  return id && id !== kind ? p.layers?.[kind] ?? {} : takeLive(p, kind);
}

/** Is some page editing a track other than the first of its kind? */
export const focused = (p: Progression): boolean => EDIT_KINDS.some((k) => !!p.focus?.[k] && p.focus[k] !== k);

/**
 * Everything back where it belongs: the first tracks on the page, every extra track's notes and
 * sound in its part of the section (`layers`). Nothing is brought forward afterwards (`focus` is empty).
 */
export function normalize(p: Progression): Progression {
  if (!focused(p)) return p.focus ? { ...p, focus: undefined } : p;
  let q: Progression = { ...p, focus: undefined };
  for (const kind of EDIT_KINDS) {
    const id = p.focus?.[kind];
    if (!id || id === kind) continue;
    // the extra track's notes and its sound go back into its part of this section
    const content = tidy(takeLive(q, kind));
    const first = q.layers?.[kind] ?? {};
    q = putLive({ ...q, layers: { ...without(q.layers, kind), [id]: content } }, kind, first);
  }
  return q;
}

/**
 * Bring tracks forward for editing (one per kind): `focus` says which. A track that does not
 * exist, or is not in the section on screen, is left alone (the page edits the first track of
 * its kind there); the first track needs nothing. Each comes with its sound in this section (the
 * plain one where it has none yet).
 */
export function refocus(q0: Progression, focus: Focus | undefined): Progression {
  const q1 = normalize(q0);
  if (!focus) return q1;
  let q = q1;
  const keep: Focus = {};
  for (const kind of EDIT_KINDS) {
    const id = focus[kind];
    if (!id || id === kind) continue;
    const t = q.tracks?.find((x) => x.id === id && x.kind === kind);
    const mine = q.layers?.[id];
    if (!t || !mine) continue;
    keep[kind] = id;
    const first = takeLive(q, kind);
    const layer: Layer =
      kind === "chords" ? { chords: mine.chords ?? [], arrange: mine.arrange, pattern: mine.pattern ?? PLAIN_STYLE, feel: mine.feel, sound: mine.sound }
      : kind === "melody" ? { melody: mine.melody, tuneSound: mine.tuneSound }
      : { beat: mine.beat ?? plainBeat() };
    q = putLive({ ...q, layers: { ...without(q.layers, id), [kind]: first } }, kind, layer);
  }
  return Object.keys(keep).length ? { ...q, focus: keep } : q;
}

/** Edit another track of a kind (the first track: pass the kind's own name). */
export function focusTrack(p: Progression, kind: EditKind, id: string): Progression {
  return refocus(p, { ...p.focus, [kind]: id });
}

/** Run a change on the song with every track in its place, then bring the same tracks forward again. */
export function settled<T extends unknown[]>(fn: (p: Progression, ...a: T) => Progression): (p: Progression, ...a: T) => Progression {
  return (p, ...a) => {
    if (!focused(p)) return fn(p, ...a);
    return refocus(fn(normalize(p), ...a), p.focus);
  };
}

/** Is a track in the section on screen? (The first three always are; so is every vocal track: they run across the song.) */
export function inSection(p: Progression, id: string): boolean {
  if (isFirst(id)) return true;
  const t = p.tracks?.find((x) => x.id === id);
  if (!t) return false;
  return t.kind === "vocals" || p.focus?.[t.kind as EditKind] === id || !!p.layers?.[id];
}
/** The tracks of a kind in the section on screen, in the song's order. */
export const tracksHere = (p: Progression, kind: TrackKind): Track[] => tracksOf(p, kind).filter((t) => inSection(p, t.id));

/**
 * Number a track's name ends with ("Chords 3" → 3), so rows are reused lowest first; a renamed
 * one comes after the numbered ones.
 */
const numberOf = (t: Track) => {
  const m = /(\d+)\s*$/.exec(t.name);
  return m ? Number(m[1]) : Infinity;
};

/**
 * A plain track of a kind in the section on screen only, brought forward for editing. It is the
 * same row as a track of that kind in other sections (the lowest-numbered plain one this section
 * does not have yet), so the rows of the Track page line up; with none, a new row. Nothing is
 * copied: in this section it starts empty, on plain settings.
 */
export function addTrackHere(p0: Progression, kind: EditKind, id: string): { p: Progression; track: Track; reused: boolean } {
  const p = normalize(p0);
  const free = (p.tracks ?? []).map((t, i) => ({ t, i })).filter(({ t }) => t.kind === kind && t.role !== "harmony" && !p.layers?.[t.id]);
  free.sort((a, b) => numberOf(a.t) - numberOf(b.t) || a.i - b.i);
  const reuse = free[0]?.t;
  const track: Track = reuse ?? { id, kind, name: nextName(p, kind) };
  const next: Progression = withoutTone({ ...p, tracks: reuse ? p.tracks : [...(p.tracks ?? []), track], layers: { ...p.layers, [track.id]: plainLayer(kind) } }, track.id);
  return { p: refocus(next, { ...p0.focus, [kind]: track.id }), track, reused: !!reuse };
}

/**
 * A new row: a plain track of a kind, in the section on screen only (a vocal track runs across
 * the whole song). It is brought forward when its kind is one a page edits.
 */
export function addTrack(p0: Progression, kind: TrackKind, id: string): { p: Progression; track: Track } {
  const p = normalize(p0);
  const track: Track = { id, kind, name: nextName(p, kind), ...(kind === "vocals" ? { input: 1 as const } : {}) };
  const layers = kind === "vocals" ? p.layers : { ...p.layers, [id]: plainLayer(kind) };
  const next: Progression = { ...p, tracks: [...(p.tracks ?? []), track], ...(layers ? { layers } : {}) };
  const focus: Focus = { ...p0.focus, ...(kind !== "vocals" ? { [kind]: id } : {}) };
  return { p: refocus(next, focus), track };
}

/**
 * Take a track out of the section on screen only (the first three stay: they are in every
 * section). Its music and sound there go with it; every other section keeps it. A track that is
 * then in no section at all leaves the song.
 */
export function removeHere(p0: Progression, id: string): Progression {
  if (isFirst(id)) return p0;
  const t = p0.tracks?.find((x) => x.id === id);
  if (!t || t.kind === "vocals") return p0;
  const focus = Object.fromEntries(Object.entries(p0.focus ?? {}).filter(([, v]) => v !== id)) as Focus;
  const p = normalize(p0);
  const left = withoutTone({ ...p, layers: without(p.layers, id) }, id);
  return refocus(prune(left), focus);
}

/** Is a track in any section of the song (the one on screen included)? `p` has every track in its place. */
function anywhere(p: Progression, id: string): boolean {
  if (p.layers?.[id]) return true;
  const song = p.song;
  if (!song) return false;
  const cur = song.blocks.find((b) => b.id === song.current)?.partId;
  return song.parts.some((x) => x.id !== cur && !!x.layers?.[id]);
}

/** The song without the added tracks that are in no section any more (vocal tracks always stay). */
export function prune(p0: Progression): Progression {
  const p = normalize(p0);
  const gone = (p.tracks ?? []).filter((t) => t.kind !== "vocals" && !anywhere(p, t.id));
  if (!gone.length) return p0;
  let q = p;
  for (const t of gone) q = removeTrack(q, t.id);
  return refocus(q, p0.focus);
}

/** Take a track out of the song, with everything it holds in every section (the first three stay). */
export function removeTrack(p0: Progression, id: string): Progression {
  if (isFirst(id)) return p0;
  const focus = Object.fromEntries(Object.entries(p0.focus ?? {}).filter(([, v]) => v !== id)) as Focus;
  const p = normalize(p0);
  // its part of every section goes, and its instrument there with it
  const song = p.song ? { ...p.song, parts: p.song.parts.map((x) => withoutTone({ ...x, layers: without(x.layers, id) }, id)) } : p.song;
  const mix = p.mix ? Object.fromEntries(Object.entries(p.mix).filter(([k]) => k !== id)) : undefined;
  // tracks written from it keep their notes, but can no longer be written again from it
  const tracks = (p.tracks ?? []).filter((t) => t.id !== id).map((t) => (t.harmony?.from === id ? forget(t, p.tracks ?? [], id) : t));
  // a re-harmonisation that went: the chords it played instead of are heard again (unless another still
  // replaces them, or they were muted by hand before it came)
  const gone = p.tracks?.find((t) => t.id === id);
  const target = gone && insteadTarget(gone, p.tracks ?? []);
  const freed = target && !tracks.some((t) => insteadTarget(t, tracks) === target) ? unmuteInstead(mix, target) : mix;
  return refocus(withoutTone({ ...p, tracks: tracks.length ? tracks : undefined, layers: without(p.layers, id), song, mix: freed && Object.keys(freed).length ? freed : undefined }, id), focus);
}

/** Does a chords option play instead of the chords it goes with (a re-harmonisation, or Best fit)? */
export function replacing(option: string | undefined): boolean {
  const opt = HARMONY_OPTIONS.find((o) => o.kind === "chords" && o.id === option);
  return !!opt && (!!opt.instead || opt.id === "fit");
}
/** The chords track a harmony written from `from` would play instead of: those chords, or (from a tune) the song's. */
const targetOf = (h: HarmonyOf, tracks: Track[]): string => (h.from === "chords" || tracks.some((x) => x.id === h.from && x.kind === "chords") ? h.from : "chords");

/** The option a harmony track was written with in a section (by part id; "" is the page of an idea with no sections yet). */
export const optionIn = (h: HarmonyOf, part: string): string => h.marks?.[part]?.option ?? h.option;

/**
 * The chords track a harmony track plays instead of, as the track was last written: a
 * re-harmonisation (an Instead option) replaces the chords it was written from (from a melody:
 * the song's chords, which it re-voices), and Best fit chooses chords of its own for the tune, so
 * it replaces the song's chords too. Undefined for a track that plays with its source. (Which
 * sections it does that in is `insteadHere`'s; this is for an older song, whose mixer muted them.)
 */
export function insteadTarget(t: Track, tracks: Track[]): string | undefined {
  const h = t.harmony;
  if (t.kind !== "chords") return undefined;
  if (!h) return t.replaces;
  return replacing(h.option) ? targetOf(h, tracks) : undefined;
}

/**
 * The chords track a chords track plays instead of in one section (by part id): only where it
 * was written to replace them, with the option it was written with there. A section it was never
 * written in (a track put there by hand), or one from an older song where both were heard, has none.
 */
export function insteadHere(t: Track, tracks: Track[], part: string): string | undefined {
  if (t.kind !== "chords") return undefined;
  const h = t.harmony;
  if (!h) return t.replaces && t.replacesIn?.includes(part) ? t.replaces : undefined;
  const m = h.marks?.[part];
  if (!m || m.along) return undefined;
  return replacing(m.option ?? h.option) ? targetOf(h, tracks) : undefined;
}

/**
 * The chords tracks that are not heard in a section (by part id) because a harmony track there
 * plays instead of them (a re-harmonisation, or Best fit), each with the track that does: only
 * where it was written to, where it has chords to play, and is not muted. Everywhere else they
 * play as they are.
 */
export function insteadIn(part: string, layers: Layers | undefined, tracks: Track[] | undefined, mix?: Mix): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of tracks ?? []) {
    if (t.kind !== "chords" || mix?.[t.id]?.mute || !layers?.[t.id]?.chords?.some((c) => !c.rest)) continue;
    const target = insteadHere(t, tracks ?? [], part);
    if (target && !out.has(target)) out.set(target, t.id);
  }
  return out;
}

/**
 * Harmony tracks' record of what they wrote in one section, given to another section that now
 * holds the same music: the page that became section A, or a section given a copy of its own.
 * Without it those notes would look changed by hand and out of date, though nobody touched them.
 */
export function carryMarks(tracks: Track[] | undefined, from: string, to: string): Track[] | undefined {
  const moves = (t: Track) => (!!t.harmony?.marks?.[from] && !t.harmony.marks[to]) || (!!t.replacesIn?.includes(from) && !t.replacesIn.includes(to));
  if (!tracks?.some(moves)) return tracks;
  // a record moving between the page and section A moves (only one of them is there now); a section's is shared with its copy
  const move = from === "" || to === "";
  return tracks.map((t) => {
    if (!moves(t)) return t;
    if (t.replacesIn) return { ...t, replacesIn: [...t.replacesIn.filter((x) => !move || x !== from), to] };
    const m = t.harmony!.marks![from];
    const { [from]: _, ...rest } = t.harmony!.marks!;
    return { ...t, harmony: { ...t.harmony!, marks: { ...(move ? rest : t.harmony!.marks), [to]: m } } };
  });
}

/**
 * A harmony track without its source (it stays a harmony line; it just can no longer be written
 * again). One that plays instead of chords still does, in the same sections (`gone`: a track
 * going out of the song), so those chords are heard again when it goes.
 */
export function forget(t: Track, tracks: Track[], gone?: string): Track {
  const { harmony: h, ...rest } = t;
  if (!h || t.kind !== "chords") return rest;
  const target = targetOf(h, tracks);
  if (target === gone) return rest;
  const where = Object.keys(h.marks ?? {}).filter((part) => insteadHere(t, tracks, part) === target);
  // (one with no record of where it was written, from an older song, did so through the mixer: it still names them, so they are heard again when it goes)
  const old = !h.marks && insteadTarget(t, tracks) === target;
  return where.length ? { ...rest, replaces: target, replacesIn: where } : old ? { ...rest, replaces: target } : rest;
}

/**
 * The mixer with a track muted because a harmony track plays instead of it, and marked so, so it
 * is heard again when that goes. One already muted (by hand) is left as it is, and stays muted.
 */
export function muteInstead(mix: Mix | undefined, id: string): Mix | undefined {
  const m = mix?.[id];
  if (m?.mute) return mix;
  return { ...mix, [id]: { ...m, mute: true, instead: true } };
}
/** The mixer with a track heard again that was muted only because a harmony track played instead of it. */
export function unmuteInstead(mix: Mix | undefined, id: string): Mix | undefined {
  const m = mix?.[id];
  if (!m?.mute || !m.instead) return mix;
  const { instead: _, ...rest } = m;
  return { ...mix, [id]: { ...rest, mute: false } };
}

/** Rename a track (the first three keep their names). */
export function renameTrack(p: Progression, id: string, name: string): Progression {
  const n = name.trim().slice(0, 32);
  if (!n || isFirst(id)) return p;
  return { ...p, tracks: (p.tracks ?? []).map((t) => (t.id === id ? { ...t, name: n } : t)) };
}

/** A vocal track's takes, the take chosen from each recording, and its clips (a track saved before clips gets one whole take from each recording, as it played). */
function reviveVocal(r: Partial<Track>): Pick<Track, "takes" | "active" | "clips"> {
  const takes = reviveTakes(r.takes);
  const active = r.active && typeof r.active === "object" ? (Object.fromEntries(Object.entries(r.active).filter(([, v]) => typeof v === "string")) as Record<string, string>) : undefined;
  const clips = reviveClips(r.clips, takes) ?? (takes ? migrateClips(takes, active) : undefined);
  return { ...(takes ? { takes } : {}), ...(active ? { active } : {}), ...(clips && takes ? { clips } : {}) };
}

/** Tracks loaded from storage, made safe. */
export function reviveTracks(raw: unknown): Track[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const kinds: TrackKind[] = ["chords", "melody", "drums", "vocals"];
  const out: Track[] = [];
  for (const r of raw as Partial<Track>[]) {
    if (!r || typeof r.id !== "string" || isFirst(r.id) || !kinds.includes(r.kind as TrackKind) || out.some((t) => t.id === r.id)) continue;
    out.push({
      id: r.id, kind: r.kind as TrackKind, name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 32) : KIND_NAME[r.kind as TrackKind],
      ...(r.kind === "vocals" ? { input: r.input === 2 ? 2 : 1 } : {}),
      ...(r.kind === "vocals" && reviveFx(r.fx) ? { fx: reviveFx(r.fx) } : {}),
      ...(r.kind === "vocals" ? reviveVocal(r) : {}),
      ...((r.kind === "melody" || r.kind === "chords") && r.role === "harmony" ? { role: "harmony" as const } : {}),
      ...(r.kind === "melody" || r.kind === "chords" ? reviveHarmony(r.harmony, r.kind) : {}),
      ...(r.kind === "chords" && typeof r.replaces === "string" && r.replaces ? { replaces: r.replaces, ...(Array.isArray(r.replacesIn) ? { replacesIn: r.replacesIn.filter((x): x is string => typeof x === "string") } : {}) } : {}),
    });
  }
  // a harmony's source must still be a chords or melody track of the song (and not itself)
  const ok = (h: HarmonyOf, self: string) => h.from !== self && (h.from === "chords" || h.from === "melody" || out.some((t) => t.id === h.from && (t.kind === "chords" || t.kind === "melody")));
  const fixed = out.map((t) => (t.harmony && !ok(t.harmony, t.id) ? forget(t, out) : t));
  return fixed.length ? fixed : undefined;
}

/** Where a harmony track came from, loaded from storage: dropped when it makes no sense. */
function reviveHarmony(raw: unknown, kind: "chords" | "melody"): { harmony?: HarmonyOf } {
  const h = raw as Partial<HarmonyOf> | null | undefined;
  if (!h || typeof h !== "object" || typeof h.from !== "string" || !h.from || typeof h.option !== "string") return {};
  if (!HARMONY_OPTIONS.some((o) => o.id === h.option && o.kind === kind)) return {};
  const marks: Record<string, HarmonyMark> = {};
  if (h.marks && typeof h.marks === "object")
    for (const [k, m] of Object.entries(h.marks))
      if (m && typeof m.src === "string" && typeof m.out === "string")
        marks[k] = { src: m.src, out: m.out, ...(typeof m.option === "string" && HARMONY_OPTIONS.some((o) => o.id === m.option && o.kind === kind) ? { option: m.option } : {}), ...(m.along === true ? { along: true as const } : {}) };
  return { harmony: { from: h.from, option: h.option, ...(Object.keys(marks).length ? { marks } : {}) } };
}

/**
 * Layers loaded from storage, made safe; only tracks that exist are kept. A track's part of a
 * section is kept even when it holds nothing (the track is in that section); each keeps the
 * things of its own kind, and what is broken is let go (it is then the plain default).
 */
export function reviveLayers(raw: unknown, tracks: Track[] | undefined): Layers | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Layers = {};
  for (const t of tracks ?? []) {
    const l = (raw as Record<string, Layer | undefined>)[t.id];
    if (!l || typeof l !== "object" || t.kind === "vocals") continue;
    out[t.id] = reviveLayer(l, t.kind);
  }
  return Object.keys(out).length ? out : undefined;
}
/** One track's part of a section, made safe. */
export function reviveLayer(l: Layer, kind: EditKind): Layer {
  if (kind === "chords")
    return tidy({
      chords: Array.isArray(l.chords) ? l.chords.filter((c) => c && c.ref && typeof c.ref.root === "string" && Number.isFinite(c.beats) && c.beats > 0) : [],
      arrange: reviveArrange(l.arrange),
      pattern: hasStyle(l.pattern) ? l.pattern : undefined,
      feel: l.feel && typeof l.feel === "object" ? reviveFeel(l.feel) : undefined,
      sound: l.sound && typeof l.sound === "object" ? reviveSound(l.sound) : undefined,
    });
  if (kind === "melody") return tidy({ melody: l.melody ? reviveMelody(l.melody) : undefined, tuneSound: l.tuneSound && typeof l.tuneSound === "object" ? reviveSound(l.tuneSound) : undefined });
  return { beat: (l.beat && reviveBeat(l.beat)) || plainBeat() };
}

/** Where on the neck a guitar track's chords are arranged, loaded from storage (anything broken: each chord's own shape). */
export function reviveArrange(raw: unknown): ArrangeSettings | undefined {
  const a = raw as Partial<ArrangeSettings> | null | undefined;
  if (!a || typeof a !== "object" || !Number.isInteger(a.zone) || a.zone! < 0 || a.zone! > 12) return undefined;
  const strings = a.strings === 3 || a.strings === 4 || a.strings === 5 ? a.strings : "any";
  return { zone: a.zone!, strings, inversions: a.inversions === true };
}
