/**
 * The idea library: saving, naming and merging ideas.
 * Pure functions, so the rules (what counts as "changed", who wins when two
 * devices disagree) can be tested without a browser.
 */
import { GROOVE_KEYS, reviveBeat } from "../audio/beats";
import { hasStyle } from "../audio/patterns";
import { reviveSound } from "../audio/rack";
import { chordSymbol } from "../theory/chords";
import type { Key } from "../theory/keys";
import { getScale } from "../theory/scales";
import type { Progression, SavedProgression } from "../ui/state";
import { commit, reviveSong, sections } from "./structure";

/** Everything that makes up an idea, ready to store. */
export interface Snapshot {
  key: Key;
  progression: Progression;
  capo: number;
  tuningId: string;
}

export function snapshot(key: Key, progression: Progression, capo: number, tuningId: string): Snapshot {
  return { key, progression: commit(progression), capo, tuningId };
}

/** Two snapshots are the same idea when their fingerprints match. Which section happens to be selected does not count. */
export function fingerprint(s: Snapshot): string {
  const p = commit(s.progression);
  const song = p.song ? { parts: p.song.parts, blocks: p.song.blocks } : null;
  // with a song, each section keeps its own rhythm: the one showing in the grid is not counted twice
  const beat = p.beat && song ? Object.fromEntries(Object.entries(p.beat).filter(([k]) => !(GROOVE_KEYS as readonly string[]).includes(k))) : (p.beat ?? null);
  // a sound saved with only some knobs is the same sound as one with the rest at their defaults
  const sound = reviveSound(p.sound);
  return JSON.stringify({ key: s.key, capo: s.capo, tuningId: s.tuningId, bpm: p.bpm, pattern: song ? null : p.pattern, loop: p.loop, arrange: p.arrange ?? null, beat, sound, song, chords: song ? null : p.chords });
}

/** Nothing worth saving yet. */
export const isBlank = (p: Progression) => !p.chords.length && !p.song && !p.beat?.on;

export const ideaTime = (i: SavedProgression) => i.updatedAt ?? i.savedAt;

/** "B Major idea 3": the first free number for this key. */
export function autoName(key: Key, existing: SavedProgression[]): string {
  const base = `${key.tonic.replace("#", "♯").replace(/(?<=[A-G])b/, "♭")} ${getScale(key.scaleId).short} idea`;
  for (let n = 1; ; n++) if (!existing.some((i) => i.name === `${base} ${n}`)) return `${base} ${n}`;
}

/** One line about an idea: its sections, or its chords when it has no structure. */
export function describeIdea(i: SavedProgression): string {
  const secs = sections(i.progression);
  if (secs.length) return secs.map((s) => s.letter).join(" ");
  return i.progression.chords.map((c) => chordSymbol(c.ref)).join(" · ") || (i.progression.beat?.on ? `Beat: ${i.progression.beat.name}` : "Empty");
}

/** Make a stored idea safe to load (older versions, hand-edited backups). */
export function reviveIdea(raw: unknown): SavedProgression | null {
  const i = raw as Partial<SavedProgression> | null;
  if (!i || typeof i.id !== "string" || !i.key || typeof i.key.tonic !== "string" || !i.progression || !Array.isArray(i.progression.chords)) return null;
  const p = i.progression;
  const song = reviveSong(p.song);
  const progression: Progression = { chords: p.chords, bpm: Number(p.bpm) || 84, pattern: hasStyle(p.pattern) ? p.pattern : "ring", loop: p.loop ?? true, arrange: p.arrange ?? null, beat: reviveBeat(p.beat), song, ...(p.sound ? { sound: reviveSound(p.sound) } : {}) };
  if (song) {
    const part = song.parts.find((x) => x.id === song.blocks.find((b) => b.id === song.current)?.partId);
    progression.chords = part?.chords ?? [];
    if (progression.beat && part?.groove) progression.beat = { ...progression.beat, ...part.groove };
    if (part?.style) progression.pattern = part.style;
  }
  return { id: i.id, name: String(i.name ?? "Idea"), key: i.key, progression, savedAt: Number(i.savedAt) || Date.now(), updatedAt: Number(i.updatedAt ?? i.savedAt) || Date.now(), capo: i.capo, tuningId: i.tuningId };
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
