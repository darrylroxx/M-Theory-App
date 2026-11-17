/**
 * Tracks. A song has one chords track, one melody track and one drums track to begin with (the
 * "first" of each kind), and any number of extra tracks of any kind added on the Track page,
 * vocals among them.
 *
 * Every track has something in every section: an extra chords track its own chords, an extra
 * melody its own notes, an extra drums track its own beat. Those live in each section as
 * `layers`, keyed by the track's id. How an extra track sounds (its playing style and harp) is
 * the same in every section and lives on the track itself.
 *
 * The pages edit one track of their kind at a time. The track being edited sits in the same
 * place the first track always does (`chords`, `pattern`, `feel`, `sound` for chords; `melody`,
 * `tuneSound` for the melody; `beat` for the drums), so every page works the same for any
 * track. While another track of a kind is being edited, the first track's things are kept
 * aside in `layers` under the kind's own name. `normalize` puts everything back where it
 * belongs; `refocus` brings a chosen track forward again.
 */
import { DEFAULT_BEAT, emptyRows, reviveBeat, type Beat } from "../audio/beats";
import { hasStyle, reviveFeel, type Feel, type PatternId } from "../audio/patterns";
import { reviveSound, type HarpSound } from "../audio/rack";
import { reviveMelody, type Melody } from "./melody";
import type { ProgChord, Progression } from "../ui/state";

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
  /** a vocal track: which input it records (1 = the mic input, 2 = the instrument/line jack) */
  input?: 1 | 2;
}

/** What one track holds in one section (and, for the first track kept aside, its settings too). */
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
      t.id !== id ? t : kind === "chords" ? { ...t, style: live.pattern, feel: live.feel, sound: live.sound } : kind === "melody" ? { ...t, sound: live.tuneSound } : t,
    );
    q = putLive({ ...q, tracks, layers: { ...without(q.layers, kind), [id]: content } }, kind, first);
  }
  return q;
}

/**
 * Bring tracks forward for editing (one per kind): `focus` says which. A track that does not
 * exist is left alone; the first track needs nothing.
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
      kind === "chords" ? { chords: mine.chords ?? [], pattern: t.style ?? first.pattern, feel: t.feel, sound: t.sound }
      : kind === "melody" ? { melody: mine.melody, tuneSound: t.sound }
      : { beat: mine.beat ?? emptyBeat(first.beat ?? DEFAULT_BEAT) };
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

/** Add a track of a kind; it is brought forward when its kind is one a page edits. */
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
  const tracks = (p.tracks ?? []).filter((t) => t.id !== id);
  return refocus({ ...p, tracks: tracks.length ? tracks : undefined, layers: without(p.layers, id), song, mix: mix && Object.keys(mix).length ? mix : undefined }, focus);
}

/** Rename a track (the first three keep their names). */
export function renameTrack(p: Progression, id: string, name: string): Progression {
  const n = name.trim().slice(0, 32);
  if (!n || isFirst(id)) return p;
  return { ...p, tracks: (p.tracks ?? []).map((t) => (t.id === id ? { ...t, name: n } : t)) };
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
      ...(r.kind === "vocals" ? { input: r.input === 2 ? 2 : 1 } : {}),
    });
  }
  return out.length ? out : undefined;
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

