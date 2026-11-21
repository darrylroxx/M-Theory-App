// The ideas list of the track view: loading an idea safely, telling whether it changed, merging two devices' lists, and
// backup files. Modelled one for one on the old library (song/library.ts), for a song of tracks and clips. Pure
// functions, so the rules can be tested without a browser.
import { grooveOf, kitSig, reviveGroove, reviveKit, type Beat, type Groove } from "../audio/beats";
import { reviveMix } from "../audio/mix";
import { hasStyle, reviveFeel } from "../audio/patterns";
import { reviveSound } from "../audio/rack";
import { reviveTone } from "../audio/tone";
import { FX_DEFAULT, reviveFx } from "../audio/vocalfx";
import { reviveNotes, withoutNotes } from "../song/chordnotes";
import { importIdeas, type RemoteIdea } from "../song/library";
import { MELODY_MAX_BARS, type Melody, type MelodyNote } from "../song/melody";
import { DEFAULT_SIG, fitRhythm, isCompound, reviveSig, sigBeats, type TimeSig } from "../song/meter";
import { PLAIN_KIT, reviveArrange } from "../song/tracks";
import { chordSymbol } from "../theory/chords";
import type { Key } from "../theory/keys";
import type { ProgChord, SavedProgression } from "../ui/state";
import { accepts, mod } from "./model";
import type { AudioClip, AudioTrack, ChordsContent, Clip, HarmonyMark5, Marker, Shelved, Take5, TimelineSong, Track, TrackKind } from "./model";

export interface SavedIdea {
  id: string; name: string; key: Key; savedAt: number; updatedAt?: number; capo?: number; tuningId?: string;
  song: TimelineSong;
  /** it was converted from a version 4 idea: that copy's own `updatedAt` */
  from?: { at: number };
  /** a backup entry: the version 4 idea it stands for */
  backup?: { of: string; unsaved?: true };
}

/** A song with nothing in it: what a new idea starts from, and what a backup entry holds. */
export const emptySong5 = (bpm = 84, meter: TimeSig = DEFAULT_SIG): TimelineSong => ({ v: 5, bpm, meter, tracks: [], clips: [] });

const isAudio = (t: Track): t is AudioTrack => t.kind === "vocals" || t.kind === "audio";
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
/** The ids the engine keeps for itself: no track may have one. */
const RESERVED = new Set(["chords", "melody", "drums"]);
const KINDS: TrackKind[] = ["chords", "melody", "bass", "drums", "vocals", "audio"];
const KIND_NAME: Record<TrackKind, string> = { chords: "Chords", melody: "Melody", bass: "Bass", drums: "Drums", vocals: "Vocal", audio: "Audio" };

/**
 * A melody or bass clip's notes loaded from storage, made safe. A note may carry a length, and one outside the range a
 * melody may hold is moved by octaves back into it (never dropped). Whether it plays is the clip's own switch, not the melody's.
 */
export function reviveMelody5(raw: unknown): Melody | undefined {
  const m = raw as Partial<Melody> | null | undefined;
  if (!m || typeof m !== "object" || !Array.isArray(m.notes)) return undefined;
  const div = m.div === 1 || m.div === 3 || m.div === 4 ? m.div : 2;
  const bars = Math.max(1, Math.min(MELODY_MAX_BARS, Math.round(Number(m.bars) || 2)));
  const fold = (midi: number) => {
    let x = midi;
    while (x < 24) x += 12;
    while (x > 108) x -= 12;
    return x;
  };
  const notes: MelodyNote[] = [];
  for (const n of m.notes as Partial<MelodyNote>[]) {
    if (!n || !Number.isInteger(n.at) || n.at! < 0 || !Number.isInteger(n.midi)) continue;
    notes.push({ at: n.at!, midi: fold(n.midi!), ...(Number.isInteger(n.len) && n.len! > 0 ? { len: n.len } : {}) });
  }
  return { div, bars, notes };
}

function reviveChords(raw: unknown): ProgChord[] {
  if (!Array.isArray(raw)) return [];
  const out: ProgChord[] = [];
  for (const c of raw as ProgChord[]) {
    if (!c || !str(c.id) || !isObj(c.ref) || typeof c.ref.root !== "string" || typeof c.ref.typeId !== "string" || !num(c.beats) || c.beats <= 0) continue;
    out.push(c.notes === undefined ? c : reviveNotes(c.notes) ? { ...c, notes: reviveNotes(c.notes) } : withoutNotes(c));
  }
  return out;
}
function reviveChordsContent(raw: unknown): ChordsContent | undefined {
  if (!isObj(raw) || !Array.isArray(raw.chords)) return undefined;
  const arrange = reviveArrange(raw.arrange);
  return {
    chords: reviveChords(raw.chords), bars: Math.max(1, Math.min(32, Math.round(Number(raw.bars) || 4))), style: hasStyle(raw.style) ? raw.style : "ring",
    ...(isObj(raw.feel) ? { feel: reviveFeel(raw.feel) } : {}), ...(arrange ? { arrange } : {}),
  };
}
/** A drum rhythm for a clip: made safe, without its on/off (the clip's own switch), and in the bars of its signature. */
function reviveRhythm(raw: unknown, sig: TimeSig): Omit<Groove, "on"> | undefined {
  const g = reviveGroove(raw);
  if (!g) return undefined;
  const { on: _on, ...rest } = fitRhythm(g, sigBeats(sig), isCompound(sig));
  return rest;
}

function reviveTakes5(raw: unknown): Take5[] {
  if (!Array.isArray(raw)) return [];
  const out: Take5[] = [];
  for (const t of raw as Partial<Take5>[]) {
    if (!t || !str(t.id) || typeof t.group !== "string" || typeof t.dry !== "string" || typeof t.wet !== "string" || !num(t.rate) || !(t.rate > 0) || !num(t.start) || !num(t.frames) || out.some((x) => x.id === t.id)) continue;
    out.push({
      id: t.id, n: Number(t.n) || 1, group: t.group, dry: t.dry, wet: t.wet, rate: t.rate, start: t.start, frames: t.frames, at: num(t.at) ? t.at : null,
      ...(t.short === true ? { short: true } : {}), ...(typeof t.sound === "string" ? { sound: t.sound } : {}), ...(num(t.bpm) ? { bpm: t.bpm } : {}), ...(typeof t.key === "string" ? { key: t.key } : {}),
      ...(typeof t.sig === "string" ? { sig: t.sig } : {}), ...(t.keep === true ? { keep: true } : {}), ...(num(t.nudge) ? { nudge: t.nudge } : {}), ...(t.channels === 2 ? { channels: 2 as const } : {}),
    });
  }
  return out;
}

function reviveTrack(r: Record<string, unknown>, taken: Set<string>): Track | null {
  if (!str(r.id) || RESERVED.has(r.id) || taken.has(r.id) || !KINDS.includes(r.kind as TrackKind)) return null;
  const kind = r.kind as TrackKind;
  const base = {
    id: r.id, name: typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 48) : KIND_NAME[kind],
    ...(Number.isInteger(r.color) && (r.color as number) >= 0 && (r.color as number) < 8 ? { color: r.color as number } : {}), ...(str(r.group) ? { group: r.group } : {}),
  };
  const draftOf = <C,>(content: (raw: unknown, sig: TimeSig) => C | undefined): { draft?: { content: C; sig: TimeSig } } => {
    const d = r.draft;
    const sig = isObj(d) ? reviveSig(d.sig) : undefined;
    const c = isObj(d) && sig ? content(d.content, sig) : undefined;
    return c && sig ? { draft: { content: c, sig } } : {};
  };
  const harmony = isObj(r.harmony) && str(r.harmony.from) && typeof r.harmony.option === "string" ? { harmony: { from: r.harmony.from, option: r.harmony.option } } : {};
  const role = r.role === "harmony" ? { role: "harmony" as const } : {};
  const sound = isObj(r.sound) ? { sound: reviveSound(r.sound) } : {};
  if (kind === "chords") return { ...base, kind, tone: reviveTone(r.tone), ...sound, ...(r.lead === true ? { lead: true as const } : {}), ...role, ...harmony, ...draftOf((c) => reviveChordsContent(c)) };
  if (kind === "melody" || kind === "bass") return { ...base, kind, tone: reviveTone(r.tone), ...sound, ...role, ...harmony, ...draftOf((c) => reviveMelody5(c)) };
  if (kind === "drums") return { ...base, kind, kit: reviveKit(r.kit) ?? PLAIN_KIT, ...(r.lead === true ? { lead: true as const } : {}), ...draftOf((c, sig) => reviveRhythm(c, sig)) };
  const input = isObj(r.input) && Number.isInteger(r.input.ch) && (r.input.ch as number) >= 0 ? { input: { ch: r.input.ch as number, ...(r.input.pair === true ? { pair: true as const } : {}) } } : {};
  return { ...base, kind, ...input, fx: reviveFx(r.fx) ?? (kind === "audio" ? { ...FX_DEFAULT, on: false } : FX_DEFAULT), takes: reviveTakes5(r.takes) };
}

function reviveMark(raw: unknown): HarmonyMark5 | undefined {
  if (!isObj(raw) || !str(raw.from) || typeof raw.option !== "string" || typeof raw.src !== "string" || typeof raw.out !== "string") return undefined;
  const s = raw.shape as { busy?: unknown; wide?: unknown; colour?: unknown } | undefined;
  const level = (x: unknown): x is 0 | 1 | 2 => x === 0 || x === 1 || x === 2;
  const shape = isObj(s) && level(s.busy) && level(s.wide) && level(s.colour) ? { shape: { busy: s.busy, wide: s.wide, colour: s.colour } } : {};
  return { from: raw.from, option: raw.option, ...shape, src: raw.src, out: raw.out, ...(raw.along === true ? { along: true as const } : {}) };
}

function reviveClip(r: Record<string, unknown>, tracks: Map<string, Track>, taken: Set<string>): Clip | null {
  if (!str(r.id) || taken.has(r.id) || !str(r.track) || !num(r.start) || r.start < 0) return null;
  const t = tracks.get(r.track);
  const kind = r.kind;
  if (!t || (kind !== "chords" && kind !== "melody" && kind !== "drums" && kind !== "audio") || !accepts(t.kind, kind)) return null;
  const head = { id: r.id, track: r.track, start: r.start, ...(r.mute === true ? { mute: true } : {}) };
  if (kind === "audio") {
    const take = (t as AudioTrack).takes.find((k) => k.id === r.take);
    if (!take || !num(r.from) || !num(r.to) || !num(r.off) || !num(r.frames)) return null;
    const from = Math.max(0, r.from);
    const to = Math.min(take.frames, r.to);
    if (!(to > from) || !(r.frames > 0)) return null;
    const clip: AudioClip = { ...head, kind, take: take.id, from, to, off: mod(r.off, to - from), frames: r.frames };
    return clip;
  }
  const sig = reviveSig(r.sig);
  if (!sig || !num(r.len) || !(r.len > 0)) return null;
  const off = num(r.off) ? r.off : 0;
  const mark = reviveMark(r.harmony);
  if (kind === "chords") {
    const content = reviveChordsContent(r.content);
    if (!content) return null;
    const instead = str(r.instead) && tracks.get(r.instead)?.kind === "chords" && r.instead !== r.track ? { instead: r.instead } : {};
    return { ...head, kind, len: r.len, off: mod(off, content.bars * sigBeats(sig)), sig, content, ...(mark ? { harmony: mark } : {}), ...instead };
  }
  if (kind === "melody") {
    const content = reviveMelody5(r.content);
    if (!content) return null;
    return { ...head, kind, len: r.len, off: mod(off, content.bars * sigBeats(sig)), sig, content, ...(mark ? { harmony: mark } : {}) };
  }
  const content = reviveRhythm(r.content, sig);
  if (!content) return null;
  return { ...head, kind, len: r.len, off: mod(off, Math.max(1, content.bars ?? 1) * sigBeats(sig)), sig, content };
}

/**
 * A song loaded from storage, made safe. Anything broken is dropped quietly: a track with no id or a kind that does not
 * exist, a clip whose track is gone or that its track cannot hold, a clip of a take that is gone. It never throws:
 * what cannot be read at all gives an empty song.
 */
export function reviveSong5(raw: unknown): TimelineSong {
  try {
    if (!isObj(raw)) return emptySong5();
    const bpm = Math.max(40, Math.min(200, Number(raw.bpm) || 84));
    const meter = reviveSig(raw.meter) ?? DEFAULT_SIG;
    const tracks: Track[] = [];
    const ids = new Set<string>();
    for (const r of Array.isArray(raw.tracks) ? raw.tracks : []) {
      const t = isObj(r) ? reviveTrack(r, ids) : null;
      if (t) tracks.push(t), ids.add(t.id);
    }
    const byId = new Map(tracks.map((t) => [t.id, t]));
    // a harmony's source must still be a track of the song
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if ((t.kind === "chords" || t.kind === "melody" || t.kind === "bass") && t.harmony && !byId.has(t.harmony.from)) {
        const { harmony: _h, ...rest } = t;
        tracks[i] = rest as Track;
      }
    }
    const clips: Clip[] = [];
    const clipIds = new Set<string>();
    for (const r of Array.isArray(raw.clips) ? raw.clips : []) {
      const c = isObj(r) ? reviveClip(r, byId, clipIds) : null;
      if (c) clips.push(c), clipIds.add(c.id);
    }
    const sigs: { bar: number; sig: TimeSig }[] = [];
    for (const s of Array.isArray(raw.sigs) ? raw.sigs : []) {
      const sig = isObj(s) ? reviveSig(s.sig) : undefined;
      if (isObj(s) && sig && Number.isInteger(s.bar) && (s.bar as number) > 0 && !sigs.some((x) => x.bar === s.bar)) sigs.push({ bar: s.bar as number, sig });
    }
    sigs.sort((a, b) => a.bar - b.bar);
    const markers: Marker[] = [];
    for (const m of Array.isArray(raw.markers) ? raw.markers : [])
      if (isObj(m) && str(m.id) && num(m.beat) && m.beat >= 0 && !markers.some((x) => x.id === m.id))
        markers.push({ id: m.id, beat: m.beat, name: typeof m.name === "string" ? m.name.slice(0, 48) : "", ...(Number.isInteger(m.color) && (m.color as number) >= 0 && (m.color as number) < 8 ? { color: m.color as number } : {}) });
    const shelf: Shelved[] = [];
    for (const s of Array.isArray(raw.shelf) ? raw.shelf : []) {
      if (!isObj(s) || !str(s.track)) continue;
      const takes = reviveTakes5(s.takes);
      if (takes.length) shelf.push({ track: s.track, name: typeof s.name === "string" ? s.name : "", kind: s.kind === "audio" ? "audio" : "vocals", takes, at: num(s.at) ? s.at : 0, saves: Math.max(0, Math.round(Number(s.saves) || 0)) });
    }
    const mix = reviveMix(raw.mix);
    return {
      v: 5, bpm, meter, ...(sigs.length ? { sigs } : {}), tracks, clips, ...(mix ? { mix } : {}), ...(markers.length ? { markers } : {}),
      ...(num(raw.end) && raw.end > 0 ? { end: raw.end } : {}), ...(shelf.length ? { shelf } : {}),
    };
  } catch {
    return emptySong5();
  }
}

/** Make a stored idea safe to load (hand-edited backups, a copy from another device). Null: it is not an idea at all. */
export function reviveIdea5(raw: unknown): SavedIdea | null {
  const i = raw as Partial<SavedIdea> | null;
  if (!i || typeof i !== "object" || typeof i.id !== "string" || !i.id || !i.key || typeof i.key.tonic !== "string" || typeof i.key.scaleId !== "string" || !isObj(i.song)) return null;
  const savedAt = Number(i.savedAt) || Date.now();
  return {
    id: i.id, name: String(i.name ?? "Idea"), key: { tonic: i.key.tonic, scaleId: i.key.scaleId }, savedAt, updatedAt: Number(i.updatedAt ?? i.savedAt) || savedAt,
    ...(num(i.capo) ? { capo: i.capo } : {}), ...(typeof i.tuningId === "string" ? { tuningId: i.tuningId } : {}),
    song: reviveSong5(i.song),
    ...(isObj(i.from) && num(i.from.at) ? { from: { at: i.from.at } } : {}),
    ...(isObj(i.backup) && typeof i.backup.of === "string" ? { backup: { of: i.backup.of, ...(i.backup.unsaved === true ? { unsaved: true as const } : {}) } } : {}),
  };
}

/** JSON with every object's keys in order: an idea opened again is rebuilt field by field, and is still the same idea. */
const inOrder = (x: unknown) => JSON.stringify(x, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));

/**
 * Two ideas are the same idea when their fingerprints match: the key, the capo and tuning, and the song (every track
 * with how it sounds, every clip, the mixer, the markers, the bars). A sound saved with only some knobs is the same
 * sound as one with the rest at their defaults, and a kit is compared by what it sounds like. What is open or selected
 * is not part of an idea, nor are removed recordings waiting on the shelf.
 */
export function fingerprint5(i: Pick<SavedIdea, "key" | "song" | "capo" | "tuningId">): string {
  const s = i.song;
  const tracks = s.tracks.map((t) => {
    if (t.kind === "drums") return { ...t, kit: kitSig(t.kit), draft: t.draft ?? null };
    if (isAudio(t)) return { ...t, input: t.input ?? null };
    return { ...t, sound: reviveSound(t.sound), draft: t.draft ?? null };
  });
  const clips = [...s.clips].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((c) => (c.kind === "chords" ? { ...c, mute: !!c.mute, content: { ...c.content, feel: reviveFeel(c.content.feel), arrange: c.content.arrange ?? null } } : { ...c, mute: !!c.mute }));
  return inOrder({ key: i.key, capo: i.capo ?? null, tuningId: i.tuningId ?? null, bpm: s.bpm, meter: s.meter, sigs: s.sigs ?? [], tracks, clips, mix: s.mix ?? {}, markers: s.markers ?? [], end: s.end ?? null });
}

/** The time an idea was last changed. */
export const ideaTime5 = (i: SavedIdea): number => i.updatedAt ?? i.savedAt;
/** Nothing worth saving yet: no clip, no recording, and nothing being composed. */
export const isBlank5 = (s: TimelineSong): boolean => !s.clips.length && !s.tracks.some((t) => (isAudio(t) ? t.takes.length > 0 : !!t.draft));

/** One line about an idea: the names on its ruler, or its first chords, or its drums. */
export function describeIdea5(i: SavedIdea): string {
  const s = i.song;
  const names = (s.markers ?? []).slice().sort((a, b) => a.beat - b.beat).map((m) => m.name).filter((n) => n);
  if (names.length) return names.join(" ");
  const first = s.clips.filter((c) => c.kind === "chords").sort((a, b) => a.start - b.start)[0];
  if (first && first.kind === "chords" && first.content.chords.length) return first.content.chords.map((c) => (c.rest ? "–" : chordSymbol(c.ref))).join(" · ");
  const drums = s.clips.find((c) => c.kind === "drums" && !c.mute);
  if (drums && drums.kind === "drums") return `Beat: ${drums.content.name}`;
  return s.clips.length ? `${s.tracks.length} tracks` : "Empty";
}

// ── Syncing between devices ──────────────────────────────────

export interface MergeResult5 {
  ideas: SavedIdea[];
  /** ids deleted here or elsewhere → when */
  tombs: Record<string, number>;
}

/** Bring this device's ideas together with the cloud's. The newer copy of each idea wins; a deletion wins over any copy that is older than it. */
export function mergeIdeas5(local: SavedIdea[], tombs: Record<string, number>, remote: RemoteIdea[]): MergeResult5 {
  const ideas = new Map(local.map((i) => [i.id, i] as const));
  const dead = { ...tombs };
  for (const r of remote) {
    const mine = ideas.get(r.id);
    if (r.deleted) {
      if (mine && ideaTime5(mine) > r.updatedAt) continue; // edited here after it was deleted elsewhere: keep it
      ideas.delete(r.id);
      dead[r.id] = Math.max(dead[r.id] ?? 0, r.updatedAt);
      continue;
    }
    if ((dead[r.id] ?? 0) >= r.updatedAt) continue; // deleted here after the cloud copy was written
    if (mine && ideaTime5(mine) >= r.updatedAt) continue;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(r.json ?? "null");
    } catch {
      /* unreadable copy: ignore it */
    }
    const idea = reviveIdea5(parsed);
    if (!idea) continue;
    ideas.set(r.id, { ...idea, id: r.id, updatedAt: r.updatedAt });
    delete dead[r.id];
  }
  for (const id of Object.keys(dead)) if (ideas.has(id) && ideaTime5(ideas.get(id)!) <= dead[id]) ideas.delete(id);
  return { ideas: [...ideas.values()].sort((a, b) => ideaTime5(b) - ideaTime5(a)), tombs: dead };
}

/**
 * What still has to be sent to the cloud, given what it is known to hold (id → time, negative = deletion). Backup
 * entries are never sent (the cloud's old copy of the idea is the original they stand for); a deleted one is, as a
 * deletion, so it stays deleted on every device.
 */
export function toPush5(ideas: SavedIdea[], tombs: Record<string, number>, known: Map<string, number>): RemoteIdea[] {
  const out: RemoteIdea[] = [];
  for (const i of ideas) if (!i.backup && known.get(i.id) !== ideaTime5(i)) out.push({ id: i.id, updatedAt: ideaTime5(i), json: JSON.stringify(i) });
  for (const [id, at] of Object.entries(tombs)) if (!ideas.some((i) => i.id === id) && known.get(id) !== -at) out.push({ id, updatedAt: at, deleted: true });
  return out;
}

// ── Backup files ─────────────────────────────────────────────

/** A backup file (version 2): the ideas, and for every backup entry among them the old idea it stands for. */
export function exportIdeas5(ideas: SavedIdea[], originals: Record<string, SavedProgression> = {}): string {
  return JSON.stringify({ app: "m-theory", version: 2, ideas, originals }, null, 1);
}

/**
 * Read a backup file of either version. A version 2 file gives its ideas and the originals of its backup entries. A
 * version 1 file (written by an old build) gives old ideas (`old`): each is to be taken in as an old copy that turned up.
 * Anything else gives nothing.
 */
export function importIdeas5(text: string): { version: 1 | 2; ideas: SavedIdea[]; originals: Record<string, SavedProgression>; old: SavedProgression[] } {
  try {
    const data = JSON.parse(text) as { version?: unknown; ideas?: unknown[]; originals?: unknown };
    if (data?.version === 2) {
      const ideas = (Array.isArray(data.ideas) ? data.ideas : []).map(reviveIdea5).filter((i): i is SavedIdea => !!i);
      const originals: Record<string, SavedProgression> = {};
      if (isObj(data.originals))
        for (const [id, raw] of Object.entries(data.originals)) {
          const [o] = importIdeas(JSON.stringify({ ideas: [raw] }));
          if (o) originals[id] = o;
        }
      return { version: 2, ideas, originals, old: [] };
    }
    return { version: 1, ideas: [], originals: {}, old: importIdeas(text) };
  } catch {
    return { version: 1, ideas: [], originals: {}, old: [] };
  }
}

/** A drum rhythm with its on/off left out: what a drums clip holds of a beat. */
export const rhythmOf = (b: Beat): Omit<Groove, "on"> => {
  const { on: _on, ...g } = grooveOf(b);
  return g;
};
