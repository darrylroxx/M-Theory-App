/**
 * Tracks. A song has one chords track, one melody track and one drums track to begin with (the
 * "first" of each kind), and any number of extra tracks of any kind added with a + (vocals among
 * them). A new track is plain: nothing is copied from another track.
 *
 * Every track has something in every section: an extra chords track its own chords, an extra
 * melody its own notes, an extra drums track its own drum rhythm. Those live in each section as
 * `layers`, keyed by the track's id.
 *
 * Every track has one sound of its own, the same in every section, and changing it never changes
 * another track's. The first tracks keep theirs on the page (`pattern`, `feel`, `sound` for the
 * chords; `tuneSound` for the melody; the kit part of `beat` for the drums); an extra track keeps
 * it on the track itself (`style`, `feel`, `sound`; `kit` for drums; `fx` for vocals). What plays
 * a chords or melody track (Guitar, Piano or Synth) is in `tones`, by track id. Anything missing
 * is the plain default.
 *
 * The pages edit one track of their kind at a time. The track being edited sits in the same
 * place the first track always does, so every page works the same for any track. While another
 * track of a kind is being edited, the first track's things (its notes and its sound) are kept
 * aside in `layers` under the kind's own name. `normalize` puts everything back where it belongs;
 * `refocus` brings a chosen track forward again.
 */
import { DEFAULT_BEAT, emptyRows, kitOfBeat, reviveBeat, reviveKit, type Beat, type DrumKit } from "../audio/beats";
import { hasStyle, reviveFeel, type Feel, type PatternId } from "../audio/patterns";
import { reviveSound, type HarpSound } from "../audio/rack";
import { reviveMelody, type Melody } from "./melody";
import type { ProgChord, Progression } from "../ui/state";
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
  /** an extra chords track: how it is played, and its harp */
  style?: PatternId;
  feel?: Partial<Feel>;
  /** an extra chords or melody track: its harp's sound and effects */
  sound?: Partial<HarpSound>;
  /** an extra drums track: its kit (the machine, each drum's sound, the mix and the effects), the same in every section */
  kit?: DrumKit;
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
  /** a chords track that played instead of another and lost its source: the one it still plays instead of */
  replaces?: string;
}

/**
 * Where a harmony track came from: the track it was written from, the option it was written
 * with, and for each section (by part id) a fingerprint of the source as it was then and of what
 * was written. A section whose notes no longer match was changed by hand since; one whose source
 * no longer matches has a source that changed since.
 */
export interface HarmonyOf {
  from: string;
  option: string;
  marks?: Record<string, HarmonyMark>;
}
export interface HarmonyMark {
  src: string;
  out: string;
}

/**
 * What one track holds in one section (and, for the first track kept aside, its sound too). An
 * added drums track's `beat` is its rhythm there: its kit is the track's (`Track.kit`).
 */
export interface Layer {
  chords?: ProgChord[];
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
/** What an added drums track plays in a section: its rhythm there, on its own kit. */
export const drumsOf = (t: Pick<Track, "kit">, l: Layer | undefined): Beat | undefined => l?.beat && { ...l.beat, ...(t.kit ?? PLAIN_KIT) };

/** What the page shows for a kind, taken off the page. */
function takeLive(p: Progression, kind: EditKind): Layer {
  if (kind === "chords") return { chords: p.chords, pattern: p.pattern, feel: p.feel, sound: p.sound };
  if (kind === "melody") return { melody: p.melody, tuneSound: p.tuneSound };
  return { beat: p.beat };
}
/** Put a kind's things on the page. */
function putLive(p: Progression, kind: EditKind, l: Layer): Progression {
  if (kind === "chords") return { ...p, chords: l.chords ?? [], pattern: l.pattern ?? p.pattern, feel: l.feel, sound: l.sound };
  if (kind === "melody") return { ...p, melody: l.melody, tuneSound: l.tuneSound };
  return { ...p, beat: l.beat };
}
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
 * Everything back where it belongs: the first tracks on the page, every extra track's notes in
 * `layers` and its sound on the track. Nothing is brought forward afterwards (`focus` is empty).
 */
export function normalize(p: Progression): Progression {
  if (!focused(p)) return p.focus ? { ...p, focus: undefined } : p;
  let q: Progression = { ...p, focus: undefined };
  for (const kind of EDIT_KINDS) {
    const id = p.focus?.[kind];
    if (!id || id === kind) continue;
    const live = takeLive(q, kind);
    const first = q.layers?.[kind] ?? {};
    // the extra track's notes go back into its layer, and its sound back onto the track
    const content: Layer = kind === "chords" ? { chords: live.chords } : kind === "melody" ? { melody: live.melody } : { beat: live.beat };
    const tracks = (q.tracks ?? []).map((t) =>
      t.id !== id ? t : kind === "chords" ? { ...t, style: live.pattern, feel: live.feel, sound: live.sound } : kind === "melody" ? { ...t, sound: live.tuneSound } : live.beat ? { ...t, kit: kitOfBeat(live.beat) } : t,
    );
    q = putLive({ ...q, tracks, layers: { ...without(q.layers, kind), [id]: content } }, kind, first);
  }
  return q;
}

/**
 * Bring tracks forward for editing (one per kind): `focus` says which. A track that does not
 * exist is left alone; the first track needs nothing. Each comes with its own sound (a plain one
 * if it has none yet); an added drums track with nothing yet in this section starts empty, on its own kit.
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
    if (!t) continue;
    keep[kind] = id;
    const first = takeLive(q, kind);
    const mine = q.layers?.[id] ?? {};
    const layer: Layer =
      kind === "chords" ? { chords: mine.chords ?? [], pattern: t.style ?? PLAIN_STYLE, feel: t.feel, sound: t.sound }
      : kind === "melody" ? { melody: mine.melody, tuneSound: t.sound }
      : { beat: { ...(mine.beat ?? emptyBeat(DEFAULT_BEAT)), ...(t.kit ?? PLAIN_KIT) } };
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

/** Add a plain track of a kind (nothing copied from another); it is brought forward when its kind is one a page edits. */
export function addTrack(p0: Progression, kind: TrackKind, id: string): { p: Progression; track: Track } {
  const p = normalize(p0);
  const track: Track = { id, kind, name: nextName(p, kind), ...(kind === "vocals" ? { input: 1 as const } : {}) };
  const next: Progression = { ...p, tracks: [...(p.tracks ?? []), track] };
  const focus: Focus = { ...p0.focus, ...(kind !== "vocals" ? { [kind]: id } : {}) };
  return { p: refocus(next, focus), track };
}

/** Take a track out of the song, with everything it holds in every section (the first three stay). */
export function removeTrack(p0: Progression, id: string): Progression {
  if (isFirst(id)) return p0;
  const focus = Object.fromEntries(Object.entries(p0.focus ?? {}).filter(([, v]) => v !== id)) as Focus;
  const p = normalize(p0);
  const song = p.song ? { ...p.song, parts: p.song.parts.map((x) => ({ ...x, layers: without(x.layers, id) })) } : p.song;
  const mix = p.mix ? Object.fromEntries(Object.entries(p.mix).filter(([k]) => k !== id)) : undefined;
  // tracks written from it keep their notes, but can no longer be written again from it
  const tracks = (p.tracks ?? []).filter((t) => t.id !== id).map((t) => (t.harmony?.from === id ? forget(t, p.tracks ?? [], id) : t));
  // a re-harmonisation that went: the chords it played instead of are heard again (unless another still
  // replaces them, or they were muted by hand before it came)
  const gone = p.tracks?.find((t) => t.id === id);
  const target = gone && insteadTarget(gone, p.tracks ?? []);
  const freed = target && !tracks.some((t) => insteadTarget(t, tracks) === target) ? unmuteInstead(mix, target) : mix;
  // its instrument goes with it
  return refocus(withoutTone({ ...p, tracks: tracks.length ? tracks : undefined, layers: without(p.layers, id), song, mix: freed && Object.keys(freed).length ? freed : undefined }, id), focus);
}

/**
 * The chords track a harmony track plays instead of: a re-harmonisation (an Instead option)
 * replaces the chords it was written from (from a melody: the song's chords, which it re-voices),
 * and Best fit chooses chords of its own for the tune, so it replaces the song's chords too.
 * Undefined for a track that plays with its source.
 */
export function insteadTarget(t: Track, tracks: Track[]): string | undefined {
  const h = t.harmony;
  if (t.kind !== "chords") return undefined;
  if (!h) return t.replaces;
  const opt = HARMONY_OPTIONS.find((o) => o.kind === "chords" && o.id === h.option);
  if (!opt || !(opt.instead || opt.id === "fit")) return undefined;
  return h.from === "chords" || tracks.some((x) => x.id === h.from && x.kind === "chords") ? h.from : "chords";
}

/**
 * Harmony tracks' record of what they wrote in one section, given to another section that now
 * holds the same music: the page that became section A, or a section given a copy of its own.
 * Without it those notes would look changed by hand and out of date, though nobody touched them.
 */
export function carryMarks(tracks: Track[] | undefined, from: string, to: string): Track[] | undefined {
  if (!tracks?.some((t) => t.harmony?.marks?.[from] && !t.harmony.marks[to])) return tracks;
  return tracks.map((t) => {
    const m = t.harmony?.marks?.[from];
    if (!t.harmony || !m || t.harmony.marks?.[to]) return t;
    // a record moving between the page and section A moves (only one of them is there now); a section's is shared with its copy
    const { [from]: _, ...rest } = t.harmony.marks ?? {};
    return { ...t, harmony: { ...t.harmony, marks: { ...(from === "" || to === "" ? rest : t.harmony.marks), [to]: m } } };
  });
}

/**
 * A harmony track without its source (it stays a harmony line; it just can no longer be written
 * again). One that plays instead of chords still does (`gone`: a track going out of the song),
 * so those chords are heard again when it goes.
 */
export function forget(t: Track, tracks: Track[], gone?: string): Track {
  const target = insteadTarget(t, tracks);
  const { harmony: _, ...rest } = t;
  return target && target !== gone ? { ...rest, replaces: target } : rest;
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
      ...(hasStyle(r.style) ? { style: r.style } : {}), ...(r.feel ? { feel: reviveFeel(r.feel) } : {}), ...(r.sound ? { sound: reviveSound(r.sound) } : {}),
      ...(r.kind === "drums" && reviveKit(r.kit) ? { kit: reviveKit(r.kit) } : {}),
      ...(r.kind === "vocals" ? { input: r.input === 2 ? 2 : 1 } : {}),
      ...(r.kind === "vocals" && reviveFx(r.fx) ? { fx: reviveFx(r.fx) } : {}),
      ...(r.kind === "vocals" ? reviveVocal(r) : {}),
      ...((r.kind === "melody" || r.kind === "chords") && r.role === "harmony" ? { role: "harmony" as const } : {}),
      ...(r.kind === "melody" || r.kind === "chords" ? reviveHarmony(r.harmony, r.kind) : {}),
      ...(r.kind === "chords" && typeof r.replaces === "string" && r.replaces ? { replaces: r.replaces } : {}),
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
    for (const [k, m] of Object.entries(h.marks)) if (m && typeof m.src === "string" && typeof m.out === "string") marks[k] = { src: m.src, out: m.out };
  return { harmony: { from: h.from, option: h.option, ...(Object.keys(marks).length ? { marks } : {}) } };
}

/** Layers loaded from storage, made safe; only tracks that exist are kept. */
export function reviveLayers(raw: unknown, tracks: Track[] | undefined): Layers | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Layers = {};
  for (const t of tracks ?? []) {
    const l = (raw as Record<string, Layer | undefined>)[t.id];
    if (!l || typeof l !== "object") continue;
    if (t.kind === "chords" && Array.isArray(l.chords)) out[t.id] = { chords: l.chords.filter((c) => c && c.ref && typeof c.ref.root === "string" && Number.isFinite(c.beats) && c.beats > 0) };
    else if (t.kind === "melody" && l.melody) { const m = reviveMelody(l.melody); if (m) out[t.id] = { melody: m }; }
    else if (t.kind === "drums" && l.beat) { const b = reviveBeat(l.beat); if (b) out[t.id] = { beat: b }; }
  }
  return Object.keys(out).length ? out : undefined;
}

