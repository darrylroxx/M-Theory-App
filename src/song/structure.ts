/**
 * Song structure: a song is a row of sections, each labelled with a letter (A, B, C …).
 *
 * The same letter played twice is the same music: both blocks share one set of chords and
 * one drum rhythm, so changing one changes the other. A block can be given its own letter
 * (and its own copy of the chords and drums) when it needs to differ.
 *
 * The tray always shows the chords of the block that is selected, the drum grid shows its rhythm
 * and the harp its playing style. Those live copies sit in `progression.chords`, `.beat` and
 * `.pattern`; they are written back into the song whenever another block is chosen, the song is
 * played, saved or exported.
 */
import { DEFAULT_BEAT, GROOVE_KEYS, grooveOf, reviveGroove, type Groove } from "../audio/beats";
import { hasStyle, type PatternId } from "../audio/patterns";
import type { ProgChord, Progression } from "../ui/state";

/** One set of chords and one drum rhythm, used by one or more blocks. */
export interface SongPart {
  id: string;
  /** "A", "B" … */
  letter: string;
  chords: ProgChord[];
  /** the drum rhythm of this section (missing in songs saved before sections had drums) */
  groove?: Groove;
  /** how this section is played: strummed, picked, rolled … (missing in older songs) */
  style?: PatternId;
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
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The first letter no section uses yet. */
export function nextLetter(parts: { letter: string }[]): string {
  for (const l of LETTERS) if (!parts.some((x) => x.letter === l)) return l;
  for (let n = 2; ; n++) for (const l of LETTERS) if (!parts.some((x) => x.letter === l + n)) return l + n;
}

/** Write the tray's chords and the drum grid's rhythm back into the song. */
export function commit(p: Progression): Progression {
  const song = p.song;
  if (!song) return p;
  const part = partOf(song, song.current);
  if (!part) return p;
  // every section keeps a rhythm, even before one has been picked (then it is the default one)
  const groove = grooveOf(p.beat ?? DEFAULT_BEAT);
  const sameGroove = !!part.groove && GROOVE_KEYS.every((k) => part.groove![k] === groove[k]);
  if (part.chords === p.chords && sameGroove && part.style === p.pattern) return p;
  return { ...p, song: { ...song, parts: song.parts.map((x) => (x.id === part.id ? { ...x, chords: p.chords, groove, style: p.pattern } : x)) } };
}

/** Turn the tray into section A, if there is no song yet. */
export function ensureSong(p: Progression, id: () => string = uid): Progression {
  if (p.song?.blocks.length) return commit(p);
  const part: SongPart = { id: id(), letter: "A", chords: p.chords, groove: grooveOf(p.beat ?? DEFAULT_BEAT), style: p.pattern };
  const block: SongBlock = { id: id(), partId: part.id };
  return { ...p, song: { parts: [part], blocks: [block], current: block.id } };
}

/** Load a part into the tray and the drum grid. */
function show(p: Progression, song: Song, blockId: string): Progression {
  const part = partOf(song, blockId)!;
  const beat = part.groove ? { ...(p.beat ?? DEFAULT_BEAT), ...part.groove } : p.beat;
  return { ...p, chords: part.chords, beat, pattern: part.style ?? p.pattern, song: { ...song, current: blockId } };
}

/** Insert a block right after the selected one and select it. */
function insert(song: Song, block: SongBlock): Song {
  const at = song.blocks.findIndex((b) => b.id === song.current);
  const blocks = [...song.blocks];
  blocks.splice(at < 0 ? blocks.length : at + 1, 0, block);
  return { ...song, blocks, current: block.id };
}

/** A brand-new section with the next free letter: no chords yet; the drums and the playing style carry on as they were. */
export function addNewSection(p0: Progression, id: () => string = uid): Progression {
  const p = ensureSong(p0, id);
  const song = p.song!;
  const from = partOf(song, song.current);
  const part: SongPart = { id: id(), letter: nextLetter(song.parts), chords: [], ...(from?.groove ? { groove: from.groove } : {}), ...(from?.style ? { style: from.style } : {}) };
  return addBlock(p, song, part, id);
}

function addBlock(p: Progression, song: Song, part: SongPart, id: () => string): Progression {
  const parts = song.parts.some((x) => x.id === part.id) ? song.parts : [...song.parts, part];
  const block: SongBlock = { id: id(), partId: part.id };
  return show(p, insert({ ...song, parts }, block), block.id);
}

/** Play a section again: a new block with the same letter, right after the selected one. */
export function repeatSection(p0: Progression, partId: string, id: () => string = uid): Progression {
  const p = ensureSong(p0, id);
  const song = p.song!;
  const part = song.parts.find((x) => x.id === partId);
  return part ? addBlock(p, song, part, id) : p;
}

/** Put another block's chords in the tray and its rhythm in the drum grid. */
export function selectBlock(p0: Progression, blockId: string): Progression {
  const p = commit(p0);
  if (!p.song || p.song.current === blockId || !partOf(p.song, blockId)) return p;
  return show(p, p.song, blockId);
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
  return show(p, next, blocks[Math.min(at, blocks.length - 1)].id);
}

/** Move a block one step earlier (−1) or later (+1). */
export function moveBlock(p: Progression, blockId: string, dir: -1 | 1): Progression {
  const i = p.song?.blocks.findIndex((b) => b.id === blockId) ?? -1;
  return i < 0 ? p : moveBlockTo(p, blockId, dir < 0 ? i - 1 : i + 2);
}

/** Move a block so it lands before the block now at `index` (blocks.length = the end). */
export function moveBlockTo(p: Progression, blockId: string, index: number): Progression {
  const song = p.song;
  if (!song) return p;
  const i = song.blocks.findIndex((b) => b.id === blockId);
  if (i < 0 || index < 0 || index > song.blocks.length) return p;
  const blocks = [...song.blocks];
  const [b] = blocks.splice(i, 1);
  blocks.splice(index > i ? index - 1 : index, 0, b);
  if (blocks.every((x, k) => x === song.blocks[k])) return p;
  return { ...p, song: { ...song, blocks } };
}

/** How many blocks share this block's letter. */
export function sharedCount(p: Progression, blockId: string): number {
  const song = p.song;
  const partId = song?.blocks.find((b) => b.id === blockId)?.partId;
  return song && partId ? song.blocks.filter((b) => b.partId === partId).length : 0;
}

/** Give a block a letter of its own, with a copy of the chords and drums, so it can differ from the others. */
export function unlinkBlock(p0: Progression, blockId: string, id: () => string = uid): Progression {
  const p = commit(p0);
  const song = p.song;
  const part = song && partOf(song, blockId);
  if (!song || !part || sharedCount(p, blockId) < 2) return p;
  const copy: SongPart = { id: id(), letter: nextLetter(song.parts), chords: part.chords.map((c) => ({ ...c, id: id() })), ...(part.groove ? { groove: part.groove } : {}), ...(part.style ? { style: part.style } : {}) };
  const next: Song = { ...song, parts: [...song.parts, copy], blocks: song.blocks.map((b) => (b.id === blockId ? { ...b, partId: copy.id } : b)) };
  return song.current === blockId ? { ...p, chords: copy.chords, song: next } : { ...p, song: next };
}

export interface Section {
  blockId: string;
  partId: string;
  letter: string;
  chords: ProgChord[];
  groove?: Groove;
  style?: PatternId;
  current: boolean;
}

/** The song in playing order, with up-to-date chords and drums. Empty when there is no structure. */
export function sections(p0: Progression): Section[] {
  const p = commit(p0);
  const song = p.song;
  if (!song) return [];
  return song.blocks.map((b) => {
    const part = song.parts.find((x) => x.id === b.partId)!;
    return { blockId: b.id, partId: b.partId, letter: part.letter, chords: part.chords, groove: part.groove, style: part.style, current: b.id === song.current };
  });
}

/** Each letter once, in the order it first plays, with the block to select for it. */
export function letters(p: Progression): { partId: string; letter: string; blockId: string; current: boolean }[] {
  const song = p.song;
  if (!song) return [];
  const cur = song.blocks.find((b) => b.id === song.current)?.partId;
  const out: { partId: string; letter: string; blockId: string; current: boolean }[] = [];
  for (const b of song.blocks) {
    if (out.some((x) => x.partId === b.partId)) continue;
    const part = song.parts.find((x) => x.id === b.partId);
    if (part) out.push({ partId: part.id, letter: part.letter, blockId: b.partId === cur ? song.current : b.id, current: b.partId === cur });
  }
  return out;
}

/** Apply a change to every chord in the song (transpose, change bar length), not just the ones in the tray. */
export function mapAllChords(p0: Progression, fn: (c: ProgChord) => ProgChord): Progression {
  const p = commit(p0);
  const chords = p.chords.map(fn);
  if (!p.song) return { ...p, chords };
  const cur = partOf(p.song, p.song.current);
  return { ...p, chords, song: { ...p.song, parts: p.song.parts.map((x) => ({ ...x, chords: x.id === cur?.id ? chords : x.chords.map(fn) })) } };
}

/** Tidy up a song loaded from storage. Songs saved with Intro / Verse / Chorus names get letters in playing order. */
export function reviveSong(raw: unknown): Song | null {
  const s = raw as Partial<Song> | null | undefined;
  if (!s || !Array.isArray(s.parts) || !Array.isArray(s.blocks)) return null;
  type Raw = { id: string; chords: ProgChord[]; letter?: unknown; groove?: unknown; style?: unknown };
  const valid = (s.parts as unknown[]).filter((x): x is Raw => !!x && typeof (x as Raw).id === "string" && Array.isArray((x as Raw).chords));
  const blocks = s.blocks.filter((b): b is SongBlock => !!b && typeof b.id === "string" && valid.some((x) => x.id === b.partId));
  if (!blocks.length) return null;
  const used = valid.filter((x) => blocks.some((b) => b.partId === x.id));
  const order = [...new Set(blocks.map((b) => b.partId))];
  const parts: SongPart[] = [];
  for (const pid of order) {
    const x = used.find((u) => u.id === pid)!;
    const taken = [...parts, ...used.filter((u) => typeof u.letter === "string" && u.id !== pid).map((u) => ({ letter: u.letter as string }))];
    const letter = typeof x.letter === "string" && x.letter && !parts.some((q) => q.letter === x.letter) ? x.letter : nextLetter(taken);
    const groove = reviveGroove(x.groove);
    parts.push({ id: x.id, letter, chords: x.chords, ...(groove ? { groove } : {}), ...(hasStyle(x.style) ? { style: x.style } : {}) });
  }
  return { parts, blocks, current: blocks.some((b) => b.id === s.current) ? s.current! : blocks[0].id };
}
