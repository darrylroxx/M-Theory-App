/**
 * Song structure: a song is a row of sections, each labelled with a letter (A, B, C …).
 *
 * The same letter played twice is the same music: both blocks share one set of chords and
 * one drum rhythm, so changing one changes the other. A block can be given its own letter
 * (and its own copy of the chords and drums) when it needs to differ.
 *
 * Every section has a length in bars (or none: then it is as long as what is in it). Its chords, its
 * melody and its drums all play inside that length.
 *
 * Settings carry over. The first section sets the playing style, the sounds and the drums for the
 * whole song; every other section follows it until something is changed there, and from then on
 * keeps that one thing as its own. Chords and melody notes always belong to their own section.
 *
 * The page always shows the block that is selected. Those live copies sit in `progression.chords`,
 * `.melody`, `.bars`, `.pattern`, `.feel`, `.sound`, `.tuneSound` and `.beat`; they are written back into
 * the song whenever another block is chosen, the song is played, saved or exported.
 */
import { DEFAULT_BEAT, grooveOf, kitOfBeat, reviveGroove, reviveKit, sameGroove, sameKit, type DrumKit, type Groove } from "../audio/beats";
import { reviveSound, type HarpSound } from "../audio/rack";
import { hasStyle, reviveFeel, sameFeel, type Feel, type PatternId } from "../audio/patterns";
import { reviveMelody, type Melody } from "./melody";
import { fitBars } from "./frame";
import type { ProgChord, Progression } from "../ui/state";

/**
 * What a section sounds like, apart from its notes: how the chords are played, the two harps'
 * sounds, the drum rhythm and the drum sound.
 */
export interface Settings {
  /** how the chords are played: strummed, picked, rolled … and at what speed, swing and touch */
  style?: PatternId;
  feel?: Partial<Feel>;
  /** the harp that plays the chords, and the one that plays the melody */
  sound?: Partial<HarpSound>;
  tuneSound?: Partial<HarpSound>;
  /** the drum rhythm (and whether the drums play), and the drum sound */
  groove?: Groove;
  kit?: DrumKit;
}
export const SETTING_GROUPS = ["style", "sound", "tuneSound", "groove", "kit"] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

/**
 * One set of chords and one melody, used by one or more blocks.
 * Its settings are only the ones that differ from the song's: everything else follows the first section.
 */
export interface SongPart extends Settings {
  id: string;
  /** "A", "B" … */
  letter: string;
  chords: ProgChord[];
  /** this section's melody */
  melody?: Melody;
  /** how long the section lasts, in bars. Not set = as long as what is in it. */
  bars?: number;
}
/** One step of the song, in playing order. */
export interface SongBlock {
  id: string;
  partId: string;
}
export interface Song {
  parts: SongPart[];
  blocks: SongBlock[];
  /** the song's settings: what the first section is set to, and what every other section uses unless it has been given its own */
  shared?: Settings;
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

const soundSig = (x: Partial<HarpSound> | undefined) => JSON.stringify(reviveSound(x));
const sameSound = (a: Partial<HarpSound> | undefined, b: Partial<HarpSound> | undefined) => soundSig(a) === soundSig(b);

/** The settings on screen right now. */
export function liveSettings(p: Progression): Required<Pick<Settings, "style" | "groove" | "kit">> & Settings {
  const beat = p.beat ?? DEFAULT_BEAT;
  return { style: p.pattern, feel: p.feel, sound: p.sound, tuneSound: p.tuneSound, groove: grooveOf(beat), kit: kitOfBeat(beat) };
}

/** Is one group of settings the same in two sets? (Style and feel go together.) */
function sameGroup(g: SettingGroup, a: Settings, b: Settings): boolean {
  if (g === "style") return a.style === b.style && sameFeel(a.feel, b.feel);
  if (g === "groove") return sameGroove(a.groove, b.groove);
  if (g === "kit") return sameKit(a.kit, b.kit);
  return sameSound(a[g], b[g]);
}
const pick = (g: SettingGroup, from: Settings): Settings => (g === "style" ? { style: from.style, feel: from.feel } : { [g]: from[g] });
const drop = (g: SettingGroup): Settings => (g === "style" ? { style: undefined, feel: undefined } : { [g]: undefined });
/** Does a part hold its own value for this group? */
const owns = (g: SettingGroup, part: Settings) => (g === "style" ? part.style !== undefined || part.feel !== undefined : part[g] !== undefined);

/** The song's settings; for songs saved before sections could differ, what is on screen stands in for what is missing. */
function sharedOf(p: Progression, song: Song): Settings {
  const live = liveSettings(p);
  const sh = song.shared ?? {};
  return { style: sh.style ?? live.style, feel: sh.style ? sh.feel : live.feel, sound: sh.sound ?? live.sound, tuneSound: sh.tuneSound ?? live.tuneSound, groove: sh.groove ?? live.groove, kit: sh.kit ?? live.kit };
}

/** What a part sounds like: its own settings where it has them, the song's everywhere else. */
function resolve(part: SongPart, first: boolean, shared: Settings): Settings {
  const out: Settings = {};
  for (const g of SETTING_GROUPS) Object.assign(out, pick(g, !first && owns(g, part) ? part : shared));
  return out;
}

const tidy = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const sig = (x: unknown) => JSON.stringify(x);

/**
 * Write what is on screen back into the song: the chords and the melody into their section, and
 * the settings either into the song (from the first section) or, where they differ from the
 * song's, into this section alone.
 */
export function commit(p: Progression): Progression {
  const song = p.song;
  if (!song) return p;
  const part = partOf(song, song.current);
  if (!part) return p;
  const first = song.parts[0]?.id === part.id;
  const live = liveSettings(p);
  let shared = sharedOf(p, song);
  let next: SongPart = { ...part, chords: p.chords, melody: p.melody, bars: p.bars };
  for (const g of SETTING_GROUPS) {
    if (first) {
      shared = { ...shared, ...pick(g, live) };
      next = { ...next, ...drop(g) };
    } else next = { ...next, ...(sameGroup(g, live, shared) ? drop(g) : pick(g, live)) };
  }
  next = tidy(next);
  shared = tidy(shared);
  if (part.chords === p.chords && part.melody === p.melody && sig({ ...part, chords: 0, melody: 0 }) === sig({ ...next, chords: 0, melody: 0 }) && sig(song.shared) === sig(shared)) return p;
  return { ...p, song: { ...song, shared, parts: song.parts.map((x) => (x.id === part.id ? next : x)) } };
}

/** Turn the page into section A, if there is no song yet. */
export function ensureSong(p: Progression, id: () => string = uid): Progression {
  if (p.song?.blocks.length) return commit(p);
  const part: SongPart = tidy({ id: id(), letter: "A", chords: p.chords, melody: p.melody, bars: p.bars });
  const block: SongBlock = { id: id(), partId: part.id };
  return { ...p, song: { parts: [part], blocks: [block], current: block.id, shared: tidy(liveSettings(p)) } };
}

/** Load a part onto the page: its chords and melody, and the settings it plays with. */
function show(p: Progression, song: Song, blockId: string): Progression {
  const part = partOf(song, blockId)!;
  const s = resolve(part, song.parts[0]?.id === part.id, sharedOf(p, song));
  const beat = { ...(p.beat ?? DEFAULT_BEAT), ...s.kit, ...s.groove };
  return { ...p, chords: part.chords, melody: part.melody, bars: part.bars, pattern: s.style ?? p.pattern, feel: s.feel, sound: s.sound, tuneSound: s.tuneSound, beat: { ...beat, on: s.groove?.on ?? beat.on }, song: { ...song, current: blockId } };
}

/** Put the page back in step with the song (after loading one). */
export function loadCurrent(p: Progression): Progression {
  return p.song && partOf(p.song, p.song.current) ? show(p, p.song, p.song.current) : p;
}

/** Which groups of settings the section on screen has as its own, and which section the others follow. */
export function linkState(p: Progression): { first: boolean; source: string; own: Record<SettingGroup, boolean> } {
  const none = { style: false, sound: false, tuneSound: false, groove: false, kit: false };
  const song = p.song;
  const part = song && partOf(song, song.current);
  if (!song || !part) return { first: true, source: "A", own: none };
  const first = song.parts[0].id === part.id;
  if (first) return { first, source: part.letter, own: none };
  const live = liveSettings(p);
  const shared = sharedOf(p, song);
  return { first, source: song.parts[0].letter, own: Object.fromEntries(SETTING_GROUPS.map((g) => [g, !sameGroup(g, live, shared)])) as Record<SettingGroup, boolean> };
}

/** Give up a section's own settings for one group: it follows the song again. */
export function relink(p: Progression, g: SettingGroup): Progression {
  if (!p.song) return p;
  const sh = sharedOf(p, p.song);
  const beat = p.beat ?? DEFAULT_BEAT;
  if (g === "style") return { ...p, pattern: sh.style ?? p.pattern, feel: sh.feel };
  if (g === "groove") return { ...p, beat: { ...beat, ...sh.groove, on: sh.groove?.on ?? beat.on } };
  if (g === "kit") return { ...p, beat: { ...beat, ...sh.kit } };
  return { ...p, [g]: sh[g] };
}

/** Insert a block right after the selected one and select it. */
function insert(song: Song, block: SongBlock): Song {
  const at = song.blocks.findIndex((b) => b.id === song.current);
  const blocks = [...song.blocks];
  blocks.splice(at < 0 ? blocks.length : at + 1, 0, block);
  return { ...song, blocks, current: block.id };
}

/** A brand-new section with the next free letter: no chords and no melody yet, every setting follows the song, and it starts as long as the section it was made from. */
export function addNewSection(p0: Progression, id: () => string = uid): Progression {
  const p = ensureSong(p0, id);
  const song = p.song!;
  const part: SongPart = tidy({ id: id(), letter: nextLetter(song.parts), chords: [], bars: p.bars });
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

/**
 * Remove a block. Removing the last one turns the song back into a single idea (the page keeps what it shows).
 * If the first section goes, the next one takes its place, and every section keeps sounding as it did.
 */
export function removeBlock(p0: Progression, blockId: string): Progression {
  const p = commit(p0);
  const song = p.song;
  if (!song) return p;
  const at = song.blocks.findIndex((b) => b.id === blockId);
  if (at < 0) return p;
  const blocks = song.blocks.filter((b) => b.id !== blockId);
  if (!blocks.length) return { ...p, song: null };
  let parts = song.parts.filter((x) => blocks.some((b) => b.partId === x.id));
  let shared = sharedOf(p, song);
  if (parts[0].id !== song.parts[0].id) {
    // a new first section: what it had of its own becomes the song's, and the others keep the old settings as their own
    const lead = parts[0];
    for (const g of SETTING_GROUPS) {
      if (!owns(g, lead)) continue;
      const was = pick(g, shared);
      shared = { ...shared, ...pick(g, lead) };
      parts = parts.map((x, i) => tidy(i === 0 ? { ...x, ...drop(g) } : owns(g, x) ? x : { ...x, ...was }));
    }
  }
  const next: Song = { parts, blocks, current: song.current, shared: tidy(shared) };
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

/** Give a block a letter of its own, with a copy of the chords, melody and settings, so it can differ from the others. */
export function unlinkBlock(p0: Progression, blockId: string, id: () => string = uid): Progression {
  const p = commit(p0);
  const song = p.song;
  const part = song && partOf(song, blockId);
  if (!song || !part || sharedCount(p, blockId) < 2) return p;
  // the first section's settings are the song's: the copy follows them, like any new section
  const copy: SongPart = tidy({ ...part, id: id(), letter: nextLetter(song.parts), chords: part.chords.map((c) => ({ ...c, id: id() })) });
  const next: Song = { ...song, parts: [...song.parts, copy], blocks: song.blocks.map((b) => (b.id === blockId ? { ...b, partId: copy.id } : b)) };
  return song.current === blockId ? { ...p, chords: copy.chords, song: next } : { ...p, song: next };
}

export interface Section extends Settings {
  blockId: string;
  partId: string;
  letter: string;
  chords: ProgChord[];
  melody?: Melody;
  /** the length it is set to, in bars (not set = as long as what is in it) */
  bars?: number;
  current: boolean;
}

/** The song in playing order, each section with its chords, melody and the settings it plays with. Empty when there is no structure. */
export function sections(p0: Progression): Section[] {
  const p = commit(p0);
  const song = p.song;
  if (!song) return [];
  const shared = sharedOf(p, song);
  return song.blocks.map((b) => {
    const part = song.parts.find((x) => x.id === b.partId)!;
    return { ...resolve(part, song.parts[0].id === part.id, shared), blockId: b.id, partId: b.partId, letter: part.letter, chords: part.chords, melody: part.melody, bars: part.bars, current: b.id === song.current };
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

/**
 * Tidy up a song loaded from storage. Songs saved with Intro / Verse / Chorus names get letters in
 * playing order. Songs saved when every section kept a copy of its own drum rhythm and style are
 * moved to today's way: the first section's are the song's, and the others keep only what differs.
 */
export function reviveSong(raw: unknown): Song | null {
  const s = raw as Partial<Song> | null | undefined;
  if (!s || !Array.isArray(s.parts) || !Array.isArray(s.blocks)) return null;
  type Raw = { id: string; chords: ProgChord[]; letter?: unknown; bars?: unknown } & { [K in keyof Settings | "melody"]?: unknown };
  const valid = (s.parts as unknown[]).filter((x): x is Raw => !!x && typeof (x as Raw).id === "string" && Array.isArray((x as Raw).chords));
  const blocks = s.blocks.filter((b): b is SongBlock => !!b && typeof b.id === "string" && valid.some((x) => x.id === b.partId));
  if (!blocks.length) return null;
  const used = valid.filter((x) => blocks.some((b) => b.partId === x.id));
  const order = [...new Set(blocks.map((b) => b.partId))];
  // older songs: the section that plays first is the one the others follow
  if (!s.shared) used.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const settings = (x: { [K in keyof Settings]?: unknown } | undefined): Settings =>
    tidy({
      style: hasStyle(x?.style) ? x.style : undefined,
      feel: x?.feel ? reviveFeel(x.feel) : undefined,
      sound: x?.sound ? reviveSound(x.sound) : undefined,
      tuneSound: x?.tuneSound ? reviveSound(x.tuneSound) : undefined,
      groove: reviveGroove(x?.groove),
      kit: reviveKit(x?.kit),
    });
  let parts: SongPart[] = [];
  // parts keep the order they were made in; letters are checked in playing order
  const letterOf = new Map<string, string>();
  for (const pid of order) {
    const x = used.find((u) => u.id === pid)!;
    const taken = [...letterOf.values(), ...used.filter((u) => typeof u.letter === "string" && u.id !== pid && !letterOf.has(u.id)).map((u) => u.letter as string)].map((letter) => ({ letter }));
    letterOf.set(pid, typeof x.letter === "string" && x.letter && ![...letterOf.values()].includes(x.letter) ? x.letter : nextLetter(taken));
  }
  for (const x of used) parts.push(tidy({ id: x.id, letter: letterOf.get(x.id)!, chords: x.chords, melody: reviveMelody(x.melody), bars: fitBars(x.bars), ...settings(x) }));
  let shared = settings(s.shared as Settings | undefined);
  // the first section holds nothing of its own: whatever it has is the song's
  const lead = parts[0];
  for (const g of SETTING_GROUPS) {
    if (owns(g, lead)) {
      if (!owns(g, shared)) shared = { ...shared, ...pick(g, lead) };
      parts[0] = tidy({ ...parts[0], ...drop(g) });
    }
  }
  parts = parts.map((x, i) => {
    if (i === 0) return x;
    let y = x;
    for (const g of SETTING_GROUPS) if (owns(g, y) && owns(g, shared) && sameGroup(g, y, shared)) y = tidy({ ...y, ...drop(g) });
    return y;
  });
  return { parts, blocks, shared: tidy(shared), current: blocks.some((b) => b.id === s.current) ? s.current! : blocks[0].id };
}
