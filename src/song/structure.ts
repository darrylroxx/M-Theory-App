/**
 * Song structure: a song is a row of blocks (Intro, Verse, Chorus …).
 *
 * Blocks of the same kind share one set of chords, the way every chorus of a
 * song is the same chorus: change one and they all change. A block can be given
 * its own chords when a verse or chorus needs to differ.
 *
 * The tray always shows the chords of the block that is selected. Those live
 * chords sit in `progression.chords`; they are written back into the song
 * whenever another block is chosen, the song is played, saved or exported.
 */
import type { ProgChord, Progression } from "../ui/state";

export type SectionKind = "intro" | "verse" | "pre" | "chorus" | "bridge" | "solo" | "outro";

export const SECTION_KINDS: { id: SectionKind; name: string }[] = [
  { id: "intro", name: "Intro" },
  { id: "verse", name: "Verse" },
  { id: "chorus", name: "Chorus" },
  { id: "bridge", name: "Bridge" },
  { id: "outro", name: "Outro" },
  { id: "pre", name: "Pre-chorus" },
  { id: "solo", name: "Solo" },
];
const kindName = (k: SectionKind) => SECTION_KINDS.find((x) => x.id === k)?.name ?? k;

/** One set of chords, used by one or more blocks. */
export interface SongPart {
  id: string;
  kind: SectionKind;
  chords: ProgChord[];
}
/** One step of the song, in playing order. */
export interface SongBlock {
  id: string;
  partId: string;
}
export interface Song {
  parts: SongPart[];
  blocks: SongBlock[];
  /** the block whose chords are in the tray */
  current: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const partOf = (song: Song, blockId: string) => song.parts.find((p) => p.id === song.blocks.find((b) => b.id === blockId)?.partId);

/** Write the tray's chords back into the song. */
export function commit(p: Progression): Progression {
  const song = p.song;
  if (!song) return p;
  const part = partOf(song, song.current);
  if (!part || part.chords === p.chords) return p;
  return { ...p, song: { ...song, parts: song.parts.map((x) => (x.id === part.id ? { ...x, chords: p.chords } : x)) } };
}

/**
 * Add a section at the end of the song and select it. The first section ever
 * added names the chords already in the tray. After that, a kind that already
 * exists (a second verse) reuses its chords; a new kind starts empty.
 */
export function addSection(p0: Progression, kind: SectionKind, id: () => string = uid): Progression {
  const p = commit(p0);
  if (!p.song || !p.song.blocks.length) {
    const part: SongPart = { id: id(), kind, chords: p.chords };
    const block: SongBlock = { id: id(), partId: part.id };
    return { ...p, song: { parts: [part], blocks: [block], current: block.id } };
  }
  const song = p.song;
  const existing = song.parts.find((x) => x.kind === kind);
  const part = existing ?? { id: id(), kind, chords: [] };
  const block: SongBlock = { id: id(), partId: part.id };
  return { ...p, chords: part.chords, song: { parts: existing ? song.parts : [...song.parts, part], blocks: [...song.blocks, block], current: block.id } };
}

/** Put another block's chords in the tray. */
export function selectBlock(p0: Progression, blockId: string): Progression {
  const p = commit(p0);
  if (!p.song || p.song.current === blockId) return p;
  const part = partOf(p.song, blockId);
  if (!part) return p;
  return { ...p, chords: part.chords, song: { ...p.song, current: blockId } };
}

/** Remove a block. Removing the last one turns the song back into a single idea (the tray keeps its chords). */
export function removeBlock(p0: Progression, blockId: string): Progression {
  const p = commit(p0);
  const song = p.song;
  if (!song) return p;
  const at = song.blocks.findIndex((b) => b.id === blockId);
  if (at < 0) return p;
  const blocks = song.blocks.filter((b) => b.id !== blockId);
  if (!blocks.length) return { ...p, song: null };
  const parts = song.parts.filter((x) => blocks.some((b) => b.partId === x.id));
  const next: Song = { parts, blocks, current: song.current };
  if (song.current !== blockId) return { ...p, song: next };
  const neighbour = blocks[Math.min(at, blocks.length - 1)];
  return { ...p, chords: parts.find((x) => x.id === neighbour.partId)!.chords, song: { ...next, current: neighbour.id } };
}

/** Move a block one step earlier (−1) or later (+1). */
export function moveBlock(p: Progression, blockId: string, dir: -1 | 1): Progression {
  const song = p.song;
  if (!song) return p;
  const i = song.blocks.findIndex((b) => b.id === blockId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= song.blocks.length) return p;
  const blocks = [...song.blocks];
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  return { ...p, song: { ...song, blocks } };
}

/** How many blocks share this block's chords. */
export function sharedCount(p: Progression, blockId: string): number {
  const song = p.song;
  const partId = song?.blocks.find((b) => b.id === blockId)?.partId;
  return song && partId ? song.blocks.filter((b) => b.partId === partId).length : 0;
}

/** Give a block its own copy of the chords, so it can differ from the others of its kind. */
export function unlinkBlock(p0: Progression, blockId: string, id: () => string = uid): Progression {
  const p = commit(p0);
  const song = p.song;
  const part = song && partOf(song, blockId);
  if (!song || !part || sharedCount(p, blockId) < 2) return p;
  const copy: SongPart = { id: id(), kind: part.kind, chords: part.chords.map((c) => ({ ...c, id: id() })) };
  const next: Song = { ...song, parts: [...song.parts, copy], blocks: song.blocks.map((b) => (b.id === blockId ? { ...b, partId: copy.id } : b)) };
  return { ...p, chords: song.current === blockId ? copy.chords : p.chords, song: next };
}

export interface Section {
  blockId: string;
  partId: string;
  kind: SectionKind;
  /** "Verse 2": numbered when a kind appears more than once */
  name: string;
  chords: ProgChord[];
  current: boolean;
}

/** The song in playing order, with names and up-to-date chords. Empty when there is no structure. */
export function sections(p0: Progression): Section[] {
  const p = commit(p0);
  const song = p.song;
  if (!song) return [];
  const totals = new Map<SectionKind, number>();
  const kinds = song.blocks.map((b) => song.parts.find((x) => x.id === b.partId)?.kind ?? "verse");
  kinds.forEach((k) => totals.set(k, (totals.get(k) ?? 0) + 1));
  const seen = new Map<SectionKind, number>();
  return song.blocks.map((b, i) => {
    const part = song.parts.find((x) => x.id === b.partId)!;
    const kind = kinds[i];
    const n = (seen.get(kind) ?? 0) + 1;
    seen.set(kind, n);
    return { blockId: b.id, partId: b.partId, kind, name: kindName(kind) + ((totals.get(kind) ?? 0) > 1 ? ` ${n}` : ""), chords: part?.chords ?? [], current: b.id === song.current };
  });
}

/** Apply a change to every chord in the song (transpose, change bar length), not just the ones in the tray. */
export function mapAllChords(p0: Progression, fn: (c: ProgChord) => ProgChord): Progression {
  const p = commit(p0);
  const chords = p.chords.map(fn);
  if (!p.song) return { ...p, chords };
  const cur = partOf(p.song, p.song.current);
  return { ...p, chords, song: { ...p.song, parts: p.song.parts.map((x) => ({ ...x, chords: x.id === cur?.id ? chords : x.chords.map(fn) })) } };
}

/** Tidy up a song loaded from storage. */
export function reviveSong(raw: unknown): Song | null {
  const s = raw as Partial<Song> | null | undefined;
  if (!s || !Array.isArray(s.parts) || !Array.isArray(s.blocks)) return null;
  const parts = s.parts.filter((x) => x && typeof x.id === "string" && Array.isArray(x.chords) && SECTION_KINDS.some((k) => k.id === x.kind));
  const blocks = s.blocks.filter((b) => b && typeof b.id === "string" && parts.some((x) => x.id === b.partId));
  if (!blocks.length) return null;
  return { parts: parts.filter((x) => blocks.some((b) => b.partId === x.id)), blocks, current: blocks.some((b) => b.id === s.current) ? s.current! : blocks[0].id };
}
