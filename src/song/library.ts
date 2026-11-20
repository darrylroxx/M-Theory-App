/**
 * The idea library: saving, naming and merging ideas.
 * Pure functions, so the rules (what counts as "changed", who wins when two
 * devices disagree) can be tested without a browser.
 */
import { reviveSig, sigName } from "./meter";
import { conform, sigOf } from "./unity";
import { reviveMix } from "../audio/mix";
import { PLAIN_KIT, PLAIN_STYLE, normalize, prune, reviveLayers, reviveTracks, type Layer, type Layers } from "./tracks";
import { reviveTones } from "../audio/tone";
import { grooveOf, kitOfBeat, kitSig, reviveBeat } from "../audio/beats";
import { hasStyle, reviveFeel } from "../audio/patterns";
import { reviveMelody } from "./melody";
import { fitBars } from "./frame";
import { reviveSound } from "../audio/rack";
import { chordSymbol } from "../theory/chords";
import type { Key } from "../theory/keys";
import { getScale } from "../theory/scales";
import type { Progression, SavedProgression } from "../ui/state";
import { commit, loadCurrent, reviveSong, sections, settle, toneIdsIn, type SongPart } from "./structure";
import { SOUND_V, migrateSong } from "./migrate";

/** Everything that makes up an idea, ready to store. */
export interface Snapshot {
  key: Key;
  progression: Progression;
  capo: number;
  tuningId: string;
}

export function snapshot(key: Key, progression: Progression, capo: number, tuningId: string): Snapshot {
  return { key, progression: commit(normalize(progression)), capo, tuningId };
}

/**
 * JSON with every object's keys in order: an idea opened again is rebuilt field by field, in an
 * order of its own, and is still the same idea as the one that was saved.
 */
const inOrder = (x: unknown) => JSON.stringify(x, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));

/**
 * A sound as it plays: one saved with only some knobs is the same sound as one with the rest at
 * their defaults, and a kit is compared by what it sounds like.
 */
const layerSound = (x: Layer) =>
  x.beat ? { ...x, beat: { ...grooveOf(x.beat), kit: kitSig(kitOfBeat(x.beat)) } }
  : x.chords ? { ...x, pattern: x.pattern ?? PLAIN_STYLE, feel: reviveFeel(x.feel), sound: reviveSound(x.sound) }
  : { ...x, tuneSound: reviveSound(x.tuneSound) };
const soundsOf = (l: Layers | undefined) => l && Object.fromEntries(Object.entries(l).map(([k, x]) => [k, layerSound(x)]));
const partSound = (x: SongPart) => ({ ...x, style: x.style ?? PLAIN_STYLE, feel: reviveFeel(x.feel), sound: reviveSound(x.sound), tuneSound: reviveSound(x.tuneSound), kit: kitSig(x.kit ?? PLAIN_KIT), groove: x.groove ?? null, layers: soundsOf(x.layers) ?? null, tones: x.tones ?? null });

/** Two snapshots are the same idea when their fingerprints match. Which section happens to be selected does not count. */
export function fingerprint(s: Snapshot): string {
  const p = commit(normalize(s.progression));
  const base = { key: s.key, capo: s.capo, tuningId: s.tuningId, meter: sigName(sigOf(p)), bpm: p.bpm, arrange: p.arrange ?? null, play: p.play ?? "section", ...(p.mix ? { mix: p.mix } : {}), ...(p.tracks ? { tracks: p.tracks } : {}) };
  // with a song, the page is a copy of one section: the song itself is what counts (every section with how its tracks sound)
  if (p.song) return inOrder({ ...base, parts: p.song.parts.map(partSound), blocks: p.song.blocks });
  return inOrder({ ...base, pattern: p.pattern, feel: reviveFeel(p.feel), melody: p.melody?.notes.length ? p.melody : null, bars: p.bars ?? null, beat: p.beat ?? null, sound: reviveSound(p.sound), tuneSound: reviveSound(p.tuneSound), chords: p.chords, ...(p.layers ? { layers: soundsOf(p.layers) } : {}), ...(p.tones ? { tones: p.tones } : {}) });
}

/**
 * Is the music still as it was? (Which section is selected, and which track a page is editing,
 * do not count.) An undo puts back what was there before one change, so it is only offered
 * while nothing else has changed since: it would take that away too.
 */
export function sameMusic(a: Progression, b: Progression): boolean {
  if (a === b) return true;
  const as = (progression: Progression): Snapshot => ({ key: { tonic: "C", scaleId: "ionian" }, progression, capo: 0, tuningId: "" });
  return fingerprint(as(a)) === fingerprint(as(b));
}

/** Nothing worth saving yet. */
export const isBlank = (p: Progression) => !p.chords.length && !p.song && !p.beat?.on && !p.melody?.notes.length;

export const ideaTime = (i: SavedProgression) => i.updatedAt ?? i.savedAt;

/** "B Major idea 3": the first free number for this key. */
export function autoName(key: Key, existing: SavedProgression[]): string {
  const base = `${key.tonic.replace("#", "♯").replace(/(?<=[A-G])b/, "♭")} ${getScale(key.scaleId).short} idea`;
  for (let n = 1; ; n++) if (!existing.some((i) => i.name === `${base} ${n}`)) return `${base} ${n}`;
}

/** One line about an idea: its sections, or its chords when it has no structure. */
export function describeIdea(i: SavedProgression): string {
  const secs = sections(i.progression);
  if (secs.length) return secs.map((s) => s.label).join(" ");
  return i.progression.chords.map((c) => (c.rest ? "–" : chordSymbol(c.ref))).join(" · ") || (i.progression.beat?.on ? `Beat: ${i.progression.beat.name}` : "Empty");
}

/** Make a stored idea safe to load (older versions, hand-edited backups; a song saved by an older version is moved over first). */
export function reviveIdea(raw: unknown): SavedProgression | null {
  const i = raw as Partial<SavedProgression> | null;
  if (!i || typeof i.id !== "string" || !i.key || typeof i.key.tonic !== "string" || !i.progression || !Array.isArray(i.progression.chords)) return null;
  const p = migrateSong(i.progression);
  const tracks = reviveTracks(p.tracks);
  const song = reviveSong(p.song, tracks);
  const melody = reviveMelody(p.melody);
  const layers = reviveLayers(p.layers, tracks);
  const tones = reviveTones(p.tones, toneIdsIn(layers, tracks));
  // (an added track that is in no section is not part of the song)
  const progression: Progression = settle(prune(loadCurrent({
    chords: p.chords, bpm: Number(p.bpm) || 84, pattern: hasStyle(p.pattern) ? p.pattern : "ring", loop: p.loop ?? true, arrange: p.arrange ?? null, beat: reviveBeat(p.beat), song,
    ...(p.sound ? { sound: reviveSound(p.sound) } : {}),
    ...(p.tuneSound ? { tuneSound: reviveSound(p.tuneSound) } : {}),
    ...(p.feel ? { feel: reviveFeel(p.feel) } : {}), ...(melody ? { melody } : {}), ...(fitBars(p.bars) ? { bars: fitBars(p.bars) } : {}),
    play: p.play === "song" ? "song" : "section",
    ...(reviveSig(p.meter) ? { meter: reviveSig(p.meter) } : {}),
    ...(reviveMix(p.mix) ? { mix: reviveMix(p.mix) } : {}),
    ...(tracks ? { tracks } : {}), ...(layers ? { layers } : {}),
    ...(tones ? { tones } : {}),
    v: SOUND_V,
  })));
  return { id: i.id, name: String(i.name ?? "Idea"), key: i.key, progression: conform(progression), savedAt: Number(i.savedAt) || Date.now(), updatedAt: Number(i.updatedAt ?? i.savedAt) || Date.now(), capo: i.capo, tuningId: i.tuningId };
}

// ── Syncing between devices ──────────────────────────────────

/** An idea as stored in the cloud: either the idea itself, or a note that it was deleted. */
export interface RemoteIdea {
  id: string;
  updatedAt: number;
  deleted?: boolean;
  /** the idea as JSON (absent on deletion notes) */
  json?: string;
}

export interface MergeResult {
  ideas: SavedProgression[];
  /** ids deleted here or elsewhere → when */
  tombs: Record<string, number>;
}

/**
 * Bring this device's ideas together with the cloud's. The newer copy of each idea
 * wins; a deletion wins over any copy that is older than it.
 */
export function mergeIdeas(local: SavedProgression[], tombs: Record<string, number>, remote: RemoteIdea[]): MergeResult {
  const ideas = new Map(local.map((i) => [i.id, i] as const));
  const dead = { ...tombs };
  for (const r of remote) {
    const mine = ideas.get(r.id);
    if (r.deleted) {
      if (mine && ideaTime(mine) > r.updatedAt) continue; // edited here after it was deleted elsewhere: keep it
      ideas.delete(r.id);
      dead[r.id] = Math.max(dead[r.id] ?? 0, r.updatedAt);
      continue;
    }
    if ((dead[r.id] ?? 0) >= r.updatedAt) continue; // deleted here after the cloud copy was written
    if (mine && ideaTime(mine) >= r.updatedAt) continue;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(r.json ?? "null");
    } catch {
      /* unreadable copy: ignore it */
    }
    const idea = reviveIdea(parsed);
    if (!idea) continue;
    ideas.set(r.id, { ...idea, id: r.id, updatedAt: r.updatedAt });
    delete dead[r.id];
  }
  for (const id of Object.keys(dead)) if (ideas.has(id) && ideaTime(ideas.get(id)!) <= dead[id]) ideas.delete(id);
  return { ideas: [...ideas.values()].sort((a, b) => ideaTime(b) - ideaTime(a)), tombs: dead };
}

/** What still has to be sent to the cloud, given what it is known to hold (id → time, negative = deletion). */
export function toPush(ideas: SavedProgression[], tombs: Record<string, number>, known: Map<string, number>): RemoteIdea[] {
  const out: RemoteIdea[] = [];
  for (const i of ideas) if (known.get(i.id) !== ideaTime(i)) out.push({ id: i.id, updatedAt: ideaTime(i), json: JSON.stringify(i) });
  for (const [id, at] of Object.entries(tombs)) if (!ideas.some((i) => i.id === id) && known.get(id) !== -at) out.push({ id, updatedAt: at, deleted: true });
  return out;
}

// ── Backup files ─────────────────────────────────────────────

export function exportIdeas(ideas: SavedProgression[]): string {
  return JSON.stringify({ app: "m-theory", version: 1, ideas }, null, 1);
}

/** Read a backup file. Returns the ideas it holds (empty when the file is something else). */
export function importIdeas(text: string): SavedProgression[] {
  try {
    const data = JSON.parse(text) as { ideas?: unknown[] };
    return (Array.isArray(data?.ideas) ? data.ideas : []).map(reviveIdea).filter((i): i is SavedProgression => !!i);
  } catch {
    return [];
  }
}
