/**
 * Song structure: a song is a row of sections. Each section has a letter (A, B, C …) that
 * follows the order the sections first play in, so whatever is moved to the front becomes A, and
 * it can be given a name of its own instead ("Verse", "Hook" …). A name stays with its section
 * wherever it is moved; so does its colour.
 *
 * The same section played twice is the same music: both blocks share one set of chords and
 * one drum rhythm, so changing one changes the other. A block can be given a section of its own
 * (with its own copy of the chords and drums) when it needs to differ.
 *
 * Every section has a length in bars, and a time signature: the song's, or one of its own. Its
 * chords, its melody and its drums are written into those bars: what is in a bar plays, an empty
 * bar is silent.
 *
 * Every section is its own: its tracks (the first chords, melody and drums tracks, and the ones
 * added there: see ./tracks), what each of them plays there, and how each sounds there (the
 * instrument, the playing style and feel, the harp and its effects, the drum kit, the drum
 * rhythm and on/off). Changing one never changes another track or another section. A new section
 * starts with a copy of the settings of the section it was made from; a block given a section of
 * its own is an exact copy of it. After that they are separate.
 *
 * The page always shows the block that is selected. Those live copies sit in `progression.chords`,
 * `.melody`, `.bars`, `.layers`, `.pattern`, `.feel`, `.sound`, `.tuneSound`, `.beat` and `.tones`;
 * they are written back into the song whenever another block is chosen, the song is played, saved
 * or exported.
 */
import { DEFAULT_BEAT, barBeats, barsOf, grooveOf, kitOfBeat, reviveGroove, reviveKit, type Beat, type DrumKit, type Groove } from "../audio/beats";
import { hasStyle, reviveFeel, styleBar, type Feel, type PatternId } from "../audio/patterns";
import { reviveSound, type HarpSound } from "../audio/rack";
import { reviveTones, type Tones } from "../audio/tone";
import { melodyBeats, reviveMelody, tileMelody, type Melody } from "./melody";
import { DEFAULT_BARS, MAX_SECTION_BARS, autoBeats, barsOr, fitBars, frameItems } from "./frame";
import { DEFAULT_SIG, mapLayers, mapList, refit, reviveSig, sameSig, type TimeSig } from "./meter";
import type { ProgChord, Progression } from "../ui/state";
import { PLAIN_KIT, PLAIN_STYLE, carryMarks, isFirst, normalize, plainLayer, prune, reviveLayers, settled, type EditKind, type Layers, type Track } from "./tracks";
import { outPrint } from "./prints";

/**
 * How a section's first tracks sound there, apart from their notes: how the chords are played
 * (style and feel) and their harp, the melody's harp, and the drums' kit and rhythm (and whether
 * they play). Anything missing is the plain default.
 */
export interface Settings {
  style?: PatternId;
  feel?: Partial<Feel>;
  sound?: Partial<HarpSound>;
  tuneSound?: Partial<HarpSound>;
  kit?: DrumKit;
  groove?: Groove;
}

/**
 * One section: its music and its settings, used by one or more blocks (a section played twice
 * is the same section).
 */
export interface SongPart extends Settings {
  id: string;
  /** a name of its own (not set = its letter) */
  name?: string;
  /** its colour, 0–7: it goes wherever the section goes */
  color?: number;
  chords: ProgChord[];
  /** this section's melody */
  melody?: Melody;
  /** how long the section lasts, in bars (only missing in songs made before sections had lengths) */
  bars?: number;
  /** a time signature of its own (not set = the song's) */
  meter?: TimeSig;
  /** the added tracks in this section, by track id: what each holds here and how it sounds here */
  layers?: Layers;
  /** what plays each chords and melody track here (Guitar, Piano or Synth), by track id; none = Guitar */
  tones?: Tones;
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

/** The letter of the nth section to start playing (0 = A): A … Z, then A2 … Z2, and on. */
export function letterAt(i: number): string {
  const n = Math.max(0, Math.floor(i));
  return LETTERS[n % 26] + (n >= 26 ? String(Math.floor(n / 26) + 1) : "");
}

/** Each part's place in the order the parts first play (0 = the first to play). */
function playOrder(song: Song): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of song.blocks) if (!out.has(b.partId)) out.set(b.partId, out.size);
  return out;
}

/** The longest a section's name can be. */
export const MAX_NAME = 24;
/** A name someone typed, made safe: one line, no more than 24 characters. Empty means "use the letter". */
export function fitName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const one = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const n = Array.from(one).slice(0, MAX_NAME).join("").trim();
  return n || undefined;
}

const COLORS = 8;
/** The first colour no other part has (after eight they come round again). */
function freeColor(parts: SongPart[]): number {
  const used = new Set(parts.map((x) => x.color));
  for (let c = 0; c < COLORS; c++) if (!used.has(c)) return c;
  return parts.length % COLORS;
}
const colorOf = (x: SongPart, fallback: number): number => (Number.isInteger(x.color) ? x.color! : fallback) % COLORS;

/**
 * A part's time signature: its own, or the song's. (The song's is `progression.meter`, which
 * song/unity sets on every change; it is missing only before that has happened, and then no
 * part has one of its own either.)
 */
const sigOfPart = (p: Progression, part: SongPart | undefined): TimeSig | undefined => part?.meter ?? p.meter;

const tidy = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const sig = (x: unknown) => JSON.stringify(x);
const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

/** The first tracks' settings on screen right now (with every track in its place). */
export function liveSettings(p: Progression): Settings {
  const beat = p.beat ?? DEFAULT_BEAT;
  return tidy({ style: p.pattern, feel: p.feel, sound: p.sound, tuneSound: p.tuneSound, kit: kitOfBeat(beat), groove: grooveOf(beat) });
}
/** A section's settings on their own (the rest of it left out). */
export const settingsOf = (x: Settings): Settings => tidy({ style: x.style, feel: x.feel, sound: x.sound, tuneSound: x.tuneSound, kit: x.kit, groove: x.groove });

/** A section's first drums track, as it plays: its kit and its rhythm. */
export function drumsIn(x: Settings): Beat {
  const groove = x.groove ?? grooveOf(DEFAULT_BEAT);
  return { ...DEFAULT_BEAT, ...(x.kit ?? PLAIN_KIT), ...groove, on: groove.on ?? false };
}

/**
 * Write what is on screen back into the song: the chords, the melody, the tracks and their parts,
 * and how every track sounds, into the section on screen (and nowhere else).
 */
function commitN(p: Progression): Progression {
  const song = p.song;
  if (!song) return p;
  const part = partOf(song, song.current);
  if (!part) return p;
  const { style: _s, feel: _f, sound: _o, tuneSound: _t, kit: _k, groove: _g, ...rest } = part;
  const next: SongPart = tidy({ ...rest, chords: p.chords, melody: p.melody, bars: p.bars, layers: p.layers, tones: p.tones && Object.keys(p.tones).length ? p.tones : undefined, ...liveSettings(p) });
  if (part.chords === p.chords && part.melody === p.melody && part.layers === p.layers && part.tones === next.tones && sig({ ...part, chords: 0, melody: 0, layers: 0 }) === sig({ ...next, chords: 0, melody: 0, layers: 0 })) return p;
  return { ...p, song: { ...song, parts: song.parts.map((x) => (x.id === part.id ? next : x)) } };
}

/** Turn the page into section A, if there is no song yet. */
function ensureSongN(p: Progression, id: () => string = uid): Progression {
  if (p.song?.blocks.length) return commit(p);
  const part: SongPart = tidy({ id: id(), color: 0, chords: p.chords, melody: p.melody, bars: p.bars, layers: p.layers, tones: p.tones && Object.keys(p.tones).length ? p.tones : undefined, ...liveSettings(p) });
  const block: SongBlock = { id: id(), partId: part.id };
  // what was sung over the page (before it had sections) was sung in section A: it goes with it
  const sung = p.tracks && mapList(p.tracks, (t) => (t.takes?.some((k) => !k.at.block) ? { ...t, takes: t.takes.map((k) => (k.at.block ? k : { ...k, at: { ...k.at, block: block.id } })) } : t));
  // and a harmony written on the page was written in section A
  const tracks = carryMarks(sung, "", part.id);
  return { ...p, ...(tracks ? { tracks } : {}), song: { parts: [part], blocks: [block], current: block.id } };
}

/** Load a part onto the page: its chords, melody, tracks and their parts, and how every track sounds there. */
function show(p: Progression, song: Song, blockId: string): Progression {
  const part = partOf(song, blockId)!;
  return { ...p, chords: part.chords, melody: part.melody, bars: part.bars, layers: part.layers, pattern: part.style ?? PLAIN_STYLE, feel: part.feel, sound: part.sound, tuneSound: part.tuneSound, beat: drumsIn(part), tones: part.tones, song: { ...song, current: blockId } };
}

/** Put the page back in step with the song (after loading one). */
function loadCurrentN(p: Progression): Progression {
  return p.song && partOf(p.song, p.song.current) ? show(p, p.song, p.song.current) : p;
}

/** What a part is called on screen: its name, or else its letter. */
const labelOf = (part: SongPart | undefined, order: Map<string, number>): string => part?.name ?? letterAt(part ? order.get(part.id) ?? 0 : 0);

/** Insert a block right after the selected one and select it. */
function insert(song: Song, block: SongBlock): Song {
  const at = song.blocks.findIndex((b) => b.id === song.current);
  const blocks = [...song.blocks];
  blocks.splice(at < 0 ? blocks.length : at + 1, 0, block);
  return { ...song, blocks, current: block.id };
}

/** The letter a new section would have: it lands right after the one on screen. */
export function newLetter(p: Progression): string {
  const song = p.song;
  if (!song?.blocks.length) return letterAt(1);
  const at = song.blocks.findIndex((b) => b.id === song.current);
  const before = new Set(song.blocks.slice(0, at < 0 ? song.blocks.length : at + 1).map((b) => b.partId));
  return letterAt(before.size);
}

/** The colour a new section would have. */
export const newColor = (p: Progression): number => (p.song?.blocks.length ? freeColor(p.song.parts) : 1);

/**
 * A brand-new section: no chords and no melody yet, and no added tracks. Its first tracks start
 * with a copy of how they sound in the section it was made from (the one on screen: its playing
 * style, harps, instruments, drum kit and rhythm), so it sounds the same until it is changed; it
 * starts as long as that section, and in the song's time signature.
 */
function addNewSectionN(p0: Progression, id: () => string = uid): Progression {
  const p = ensureSong(p0, id);
  const song = p.song!;
  const tones = Object.fromEntries(Object.entries(p.tones ?? {}).filter(([k]) => isFirst(k)));
  const part: SongPart = tidy({ id: id(), color: freeColor(song.parts), chords: [], bars: p.bars, ...clone(liveSettings(p)), tones: Object.keys(tones).length ? clone(tones) : undefined });
  return addBlock(p, song, part, id);
}

function addBlock(p: Progression, song: Song, part: SongPart, id: () => string): Progression {
  const parts = song.parts.some((x) => x.id === part.id) ? song.parts : [...song.parts, part];
  const block: SongBlock = { id: id(), partId: part.id };
  return show(p, insert({ ...song, parts }, block), block.id);
}

/** Play a section again: a new block with the same music, right after the selected one. (With no song yet, the page is section A: it plays again.) */
function repeatSectionN(p0: Progression, partId: string, id: () => string = uid): Progression {
  const p = ensureSong(p0, id);
  const song = p.song!;
  const part = song.parts.find((x) => x.id === partId) ?? (p0.song?.blocks.length ? undefined : song.parts[0]);
  return part ? addBlock(p, song, part, id) : p;
}

/** Put another block's chords in the tray and its rhythm in the drum grid. */
function selectBlockN(p0: Progression, blockId: string): Progression {
  const p = commit(p0);
  if (!p.song || p.song.current === blockId || !partOf(p.song, blockId)) return p;
  return show(p, p.song, blockId);
}

/**
 * Remove a block. Removing the last one turns the song back into a single idea (the page keeps what it shows).
 * A section no block plays any more goes, and with it its tracks: one that is then in no section leaves the song.
 */
function removeBlockN(p0: Progression, blockId: string): Progression {
  const p = commit(p0);
  const song = p.song;
  if (!song) return p;
  const at = song.blocks.findIndex((b) => b.id === blockId);
  if (at < 0) return p;
  const blocks = song.blocks.filter((b) => b.id !== blockId);
  if (!blocks.length) {
    // a harmony written in the section the page keeps was written on the page now
    const tracks = carryMarks(p.tracks, partOf(song, song.current)?.id ?? "", "");
    return { ...p, ...(tracks ? { tracks } : {}), song: null };
  }
  const next: Song = { ...song, blocks, parts: song.parts.filter((x) => blocks.some((b) => b.partId === x.id)) };
  if (song.current !== blockId) return prune({ ...p, song: next });
  return prune(show(p, next, blocks[Math.min(at, blocks.length - 1)].id));
}

/** Set how long a section lasts, in bars: the one on screen, or any other (every block of it). */
function setSectionBarsN(p0: Progression, blockId: string, bars: number): Progression {
  const n = barsOr(bars);
  const part = p0.song && partOf(p0.song, blockId);
  if (!p0.song || !part || partOf(p0.song, p0.song.current)?.id === part.id) return p0.bars === n ? p0 : { ...p0, bars: n };
  const p = commit(p0);
  return { ...p, song: { ...p.song!, parts: p.song!.parts.map((x) => (x.id === part.id ? { ...x, bars: n } : x)) } };
}

/** Give a section a name ("" = its letter again). Every block of it has the name; it stays with it wherever it moves. */
function renameSectionN(p0: Progression, blockId: string, name: string, id: () => string = uid): Progression {
  // with no song yet the page is section A
  const p = p0.song?.blocks.length ? p0 : ensureSong(p0, id);
  const song = p.song!;
  const part = partOf(song, blockId || song.current);
  const n = fitName(name);
  if (!part || part.name === n) return p0;
  return { ...p, song: { ...song, parts: song.parts.map((x) => (x.id === part.id ? tidy({ ...x, name: n }) : x)) } };
}

/** Move a block one step earlier (−1) or later (+1). */
function moveBlockN(p: Progression, blockId: string, dir: -1 | 1): Progression {
  const i = p.song?.blocks.findIndex((b) => b.id === blockId) ?? -1;
  return i < 0 ? p : moveBlockTo(p, blockId, dir < 0 ? i - 1 : i + 2);
}

/** Move a block so it lands before the block now at `index` (blocks.length = the end). Every section keeps sounding as it did. */
function moveBlockToN(p0: Progression, blockId: string, index: number): Progression {
  const song0 = p0.song;
  if (!song0) return p0;
  const i = song0.blocks.findIndex((b) => b.id === blockId);
  if (i < 0 || index < 0 || index > song0.blocks.length) return p0;
  const blocks = [...song0.blocks];
  const [b] = blocks.splice(i, 1);
  blocks.splice(index > i ? index - 1 : index, 0, b);
  if (blocks.every((x, k) => x === song0.blocks[k])) return p0;
  const p = commit(p0);
  return { ...p, song: { ...p.song!, blocks } };
}

/** How many blocks share this block's section. */
export function sharedCount(p: Progression, blockId: string): number {
  const song = p.song;
  const partId = song?.blocks.find((b) => b.id === blockId)?.partId;
  return song && partId ? song.blocks.filter((b) => b.partId === partId).length : 0;
}

/** Give a block a section of its own: an exact copy (its chords, melody, tracks and their parts, how every track sounds, its time signature), so it can differ from the others. */
function unlinkBlockN(p0: Progression, blockId: string, id: () => string = uid): Progression {
  const p = commit(p0);
  const song = p.song;
  const part = song && partOf(song, blockId);
  if (!song || !part || sharedCount(p, blockId) < 2) return p;
  // it has its own colour, and its letter until it is named
  const copy: SongPart = tidy({ ...clone(part), id: id(), name: undefined, color: freeColor(song.parts), chords: part.chords.map((c) => ({ ...c, id: id() })) });
  const next: Song = { ...song, parts: [...song.parts, copy], blocks: song.blocks.map((b) => (b.id === blockId ? { ...b, partId: copy.id } : b)) };
  // a harmony in the copy is what was written there, not a change by hand
  const tracks = carryMarks(p.tracks, part.id, copy.id);
  const q = tracks === p.tracks ? p : { ...p, tracks };
  return song.current === blockId ? { ...q, chords: copy.chords, song: next } : { ...q, song: next };
}

/**
 * New time signatures: the song's (`meter`), and perhaps one section's (`one`; the song's own
 * signature there means it follows the song again). Every section whose bars change has its
 * chords, melody, drums and tracks fitted to them; every other section keeps sounding exactly
 * as it did.
 */
function retimeN(p0: Progression, meter: TimeSig, one: { block: string; sig: TimeSig } | null = null): Progression {
  const p = commit(p0);
  const song = p.song;
  if (!song) return p;
  const target = one ? partOf(song, one.block) : undefined;
  if (one && !target) return p;
  const same = (a?: TimeSig, b?: TimeSig) => (!a && !b) || sameSig(a, b);
  if (same(meter, p.meter) && (!target || same(sameSig(one!.sig, meter) ? undefined : one!.sig, target.meter))) return p0;
  const parts = song.parts.map((x) => {
    const own = x === target ? (sameSig(one!.sig, meter) ? undefined : one!.sig) : x.meter;
    const from = sigOfPart(p, x) ?? DEFAULT_SIG;
    const to = own ?? meter;
    let y: SongPart = same(own, x.meter) ? x : tidy({ ...x, meter: own });
    if (sameSig(from, to)) return y;
    const f = refit(from, to);
    // its chords, melody, drum rhythm and every track's part, fitted to its new bars
    return tidy({ ...y, chords: mapList(y.chords, f.chord!), melody: y.melody && f.melody!(y.melody), groove: y.groove && f.rhythm!(y.groove), layers: mapLayers(y.layers, f) });
  });
  // a harmony track fitted to the new bars is still what was written, only fitted: its record of
  // each section follows (unless changed by hand before), so it does not look changed by hand now
  const tracks = p.tracks?.map((t) => {
    const marks = t.harmony?.marks;
    if (!marks) return t;
    let next = marks;
    song.parts.forEach((x, i) => {
      const k = marks[x.id] ? x.id : song.parts.length === 1 && marks[""] ? "" : null;
      const m = k === null ? undefined : marks[k];
      if (!m || parts[i].layers === x.layers || m.out !== outPrint(x.layers?.[t.id])) return;
      next = { ...next, [k!]: { ...m, out: outPrint(parts[i].layers?.[t.id]) } };
    });
    return next === marks ? t : { ...t, harmony: { ...t.harmony!, marks: next } };
  });
  const q: Progression = { ...p, meter, ...(tracks ? { tracks } : {}) };
  return show(q, { ...song, parts }, song.current);
}

/**
 * Put a copied section into a section, in place of all it had: its chords, melody, length, time
 * signature, its tracks with their parts, and how every track sounds there. Every block of it
 * changes (it is one section); every other section keeps playing as it did. Its name and colour
 * stay. A copy from before sections had settings of their own (`whole` not set) brings only the
 * drum rhythm: the section keeps the rest of how it sounds, and its instruments.
 */
export interface SectionContent {
  chords: ProgChord[];
  melody?: Melody;
  bars?: number;
  /** the time signature it is written in */
  meter: TimeSig;
  layers?: Layers;
  /** how its first tracks sound (in its own bars) */
  settings: Settings;
  /** what plays its chords and melody tracks */
  tones?: Tones;
  /** the settings and instruments are all there is (a copy from before held only the drum rhythm) */
  whole?: boolean;
}
function replaceSectionN(p0: Progression, blockId: string, c: SectionContent): Progression {
  const p = commit(p0);
  const song = p.song;
  const part = song && partOf(song, blockId);
  if (!song || !part) return p;
  const settings = c.whole ? settingsOf(c.settings) : { ...settingsOf(part), ...settingsOf(c.settings) };
  const keep = (id: string) => isFirst(id) || !!c.layers?.[id];
  const tones = c.whole ? c.tones : Object.fromEntries(Object.entries({ ...part.tones, ...c.tones }).filter(([k]) => keep(k)));
  const next: SongPart = tidy({ id: part.id, name: part.name, color: part.color, chords: c.chords, melody: c.melody, bars: fitBars(c.bars), meter: p.meter && sameSig(c.meter, p.meter) ? undefined : c.meter, layers: c.layers, ...settings, tones: tones && Object.keys(tones).length ? tones : undefined });
  const parts = song.parts.map((x) => (x.id === part.id ? next : x));
  return show(p, { ...song, parts }, song.current);
}

export interface Section extends Settings {
  blockId: string;
  partId: string;
  /** its letter, from the order the sections first play in: the first is A */
  letter: string;
  /** the name it was given, if any */
  name?: string;
  /** what it is called on screen: its name, or else its letter */
  label: string;
  /** its colour (0–7), the same wherever it is moved */
  color: number;
  chords: ProgChord[];
  melody?: Melody;
  /** the length it is set to, in bars (not set = as long as what is in it) */
  bars?: number;
  /** a time signature of its own (not set = the song's) */
  meter?: TimeSig;
  /** the added tracks in it: what each holds there and how it sounds there */
  layers?: Layers;
  /** what plays its chords and melody tracks */
  tones?: Tones;
  current: boolean;
}

/** The song in playing order, each section with its chords, melody, tracks and their parts, and how every track sounds there. Empty when there is no structure. */
export function sections(p0: Progression): Section[] {
  const p = commit(normalize(p0));
  const song = p.song;
  if (!song) return [];
  const order = playOrder(song);
  return song.blocks.map((b) => {
    const part = song.parts.find((x) => x.id === b.partId)!;
    const i = order.get(part.id) ?? 0;
    return { ...settingsOf(part), ...(part.tones ? { tones: part.tones } : {}), blockId: b.id, partId: b.partId, letter: letterAt(i), ...(part.name ? { name: part.name } : {}), label: labelOf(part, order), color: colorOf(part, i), chords: part.chords, melody: part.melody, bars: part.bars, ...(part.meter ? { meter: part.meter } : {}), layers: part.layers, current: b.id === song.current };
  });
}

/** The page as a section, when there is no song yet: section A, with everything on screen. */
export function soloSection(p0: Progression): Section {
  const p = normalize(p0);
  return { ...liveSettings(p), ...(p.tones ? { tones: p.tones } : {}), blockId: "", partId: "", letter: "A", label: "A", color: 0, current: true, chords: p.chords, melody: p.melody, bars: p.bars, layers: p.layers };
}

/** Each section once, in the order it first plays, with the block to select for it. */
export function letters(p: Progression): { partId: string; letter: string; label: string; color: number; blockId: string; current: boolean }[] {
  const song = p.song;
  if (!song) return [];
  const order = playOrder(song);
  const cur = song.blocks.find((b) => b.id === song.current)?.partId;
  const out: { partId: string; letter: string; label: string; color: number; blockId: string; current: boolean }[] = [];
  for (const b of song.blocks) {
    if (out.some((x) => x.partId === b.partId)) continue;
    const part = song.parts.find((x) => x.id === b.partId);
    const i = order.get(b.partId) ?? 0;
    if (part) out.push({ partId: part.id, letter: letterAt(i), label: labelOf(part, order), color: colorOf(part, i), blockId: b.partId === cur ? song.current : b.id, current: b.partId === cur });
  }
  return out;
}

/**
 * A harmony track changed along with the whole song (moved to another key with it) is still what
 * was written: its record of each section follows (unless changed by hand before), so a later
 * change to its source is not taken for a change by hand.
 */
function followMarks(p: Progression, q: Progression): Progression {
  const spots: [string, Layers | undefined, Layers | undefined][] = p.song && q.song ? p.song.parts.map((x, i) => [x.id, x.layers, q.song!.parts[i]?.layers]) : [["", p.layers, q.layers]];
  const tracks = q.tracks?.map((t) => {
    const marks = t.harmony?.marks;
    if (!marks) return t;
    let next = marks;
    for (const [id, was, now] of spots) {
      const k = marks[id] ? id : spots.length === 1 && marks[""] ? "" : null;
      const m = k === null ? undefined : marks[k];
      if (!m || m.out !== outPrint(was?.[t.id])) continue;
      next = { ...next, [k!]: { ...m, out: outPrint(now?.[t.id]) } };
    }
    return next === marks ? t : { ...t, harmony: { ...t.harmony!, marks: next } };
  });
  return tracks ? { ...q, tracks } : q;
}

/** Apply a change to every chord in the song (transpose, change bar length), not just the ones in the tray. */
function mapAllChordsN(p0: Progression, fn: (c: ProgChord) => ProgChord): Progression {
  const p = commit(p0);
  const chords = p.chords.map(fn);
  // the extra chords tracks change with the first one
  const mapLayers = (l: Layers | undefined): Layers | undefined => (l ? Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v.chords ? { ...v, chords: v.chords.map(fn) } : v])) : l);
  const layers = mapLayers(p.layers);
  if (!p.song) return followMarks(p, { ...p, chords, layers });
  const cur = partOf(p.song, p.song.current);
  return followMarks(p, { ...p, chords, layers, song: { ...p.song, parts: p.song.parts.map((x) => (x.id === cur?.id ? { ...x, chords, layers } : { ...x, chords: x.chords.map(fn), layers: mapLayers(x.layers) })) } });
}

/** Change every melody in the song (each section's, and the added melody tracks'). */
function mapAllMelodiesN(p0: Progression, fn: (m: Melody) => Melody): Progression {
  const p = commit(p0);
  const one = (m: Melody | undefined) => (m ? fn(m) : m);
  const mapLayers = (l: Layers | undefined): Layers | undefined => (l ? Object.fromEntries(Object.entries(l).map(([k, v]) => [k, v.melody ? { ...v, melody: fn(v.melody) } : v])) : l);
  const melody = one(p.melody);
  const layers = mapLayers(p.layers);
  if (!p.song) return followMarks(p, { ...p, melody, layers });
  const cur = partOf(p.song, p.song.current);
  return followMarks(p, { ...p, melody, layers, song: { ...p.song, parts: p.song.parts.map((x) => (x.id === cur?.id ? { ...x, melody, layers } : { ...x, melody: one(x.melody), layers: mapLayers(x.layers) })) } });
}

/**
 * Give one section a length, the way it used to play: as long as its chords, repeated until the
 * drum rhythm and the melody had both finished. The repeats are written out, so it sounds the same.
 */
function settleOne(x: { chords: ProgChord[]; melody?: Melody }, bar: number, drumBeats: number): { chords: ProgChord[]; melody?: Melody; bars: number } {
  const total = x.chords.reduce((a, c) => a + c.beats, 0);
  const tune = x.melody?.notes.length && x.melody.on !== false ? melodyBeats(x.melody, bar) : 0;
  const auto = autoBeats(total, drumBeats, tune);
  const bars = auto > 0 ? Math.max(1, Math.min(MAX_SECTION_BARS, Math.ceil(auto / bar - 1e-6))) : DEFAULT_BARS;
  const n = x.chords.length;
  const chords = total > 0 && auto > total + 1e-6 ? frameItems(x.chords, Math.min(auto, bars * bar)).map((f, k) => (k < n ? f.item : { ...f.item, id: `${f.item.id}~${Math.floor(k / n)}` })) : x.chords;
  return { chords, bars, ...(x.melody ? { melody: x.melody.notes.length ? tileMelody(x.melody, bar, bars) : x.melody } : {}) };
}
const barOfBeat = (beat: Beat, style: PatternId) => {
  const n = beat.on ? barBeats(beat) : styleBar(style);
  return n >= 1 && n <= 16 ? n : 4;
};

/**
 * Songs made before sections had lengths: every section gets one, and whatever used to come
 * round again inside it is written out in full. Sections that have a length are left alone.
 */
function settleN(p0: Progression): Progression {
  const live = p0.beat ?? DEFAULT_BEAT;
  if (!p0.song) {
    if (fitBars(p0.bars)) return p0;
    return { ...p0, ...settleOne({ chords: p0.chords, melody: p0.melody }, barOfBeat(live, p0.pattern), live.on ? barBeats(live) * barsOf(live) : 0) };
  }
  const p = commit(p0);
  const song = p.song!;
  if (song.parts.every((x) => fitBars(x.bars))) return p;
  const secs = sections(p);
  const parts = song.parts.map((part) => {
    if (fitBars(part.bars)) return part;
    const sec = secs.find((x) => x.partId === part.id);
    const drums: Beat = sec ? drumsIn(sec) : live;
    return { ...part, ...settleOne(part, barOfBeat(drums, sec?.style ?? p.pattern), drums.on ? barBeats(drums) * barsOf(drums) : 0) };
  });
  return show(p, { ...song, parts }, song.current);
}

/** A section's settings loaded from storage, made safe (what is broken is let go: it is then the plain default). */
export function reviveSettings(x: { [K in keyof Settings]?: unknown } | undefined): Settings {
  return tidy({
    style: hasStyle(x?.style) ? x.style : undefined,
    feel: x?.feel && typeof x.feel === "object" ? reviveFeel(x.feel) : undefined,
    sound: x?.sound && typeof x.sound === "object" ? reviveSound(x.sound) : undefined,
    tuneSound: x?.tuneSound && typeof x.tuneSound === "object" ? reviveSound(x.tuneSound) : undefined,
    kit: reviveKit(x?.kit),
    groove: reviveGroove(x?.groove),
  });
}

/** The tracks of a section that can have an instrument of their own: the first chords and melody, and the chords and melody tracks it has. */
export const toneIdsIn = (layers: Layers | undefined, tracks: Track[] | undefined): string[] => ["chords", "melody", ...(tracks ?? []).filter((t) => (t.kind === "chords" || t.kind === "melody") && !!layers?.[t.id]).map((t) => t.id)];

/**
 * Tidy up a song loaded from storage (one saved by an older version is moved over first: see
 * ./migrate). Letters are never stored: they follow the playing order (songs saved with letters,
 * or with Intro / Verse / Chorus, are lettered that way too). Each section keeps its colour; songs
 * from before colours had one each get the colour their letter had.
 */
export function reviveSong(raw: unknown, tracks?: Track[]): Song | null {
  const s = raw as Partial<Song> | null | undefined;
  if (!s || !Array.isArray(s.parts) || !Array.isArray(s.blocks)) return null;
  type Raw = { id: string; chords: ProgChord[]; letter?: unknown; name?: unknown; color?: unknown; meter?: unknown; bars?: unknown; layers?: unknown; tones?: unknown } & { [K in keyof Settings | "melody"]?: unknown };
  const valid = (s.parts as unknown[]).filter((x): x is Raw => !!x && typeof (x as Raw).id === "string" && Array.isArray((x as Raw).chords));
  const blocks = s.blocks.filter((b): b is SongBlock => !!b && typeof b.id === "string" && valid.some((x) => x.id === b.partId));
  if (!blocks.length) return null;
  const used = valid.filter((x) => blocks.some((b) => b.partId === x.id));
  const order = [...new Set(blocks.map((b) => b.partId))];
  // a colour of its own; before sections had one, the colour went with the letter
  const stored = (x: Raw): number | undefined => {
    if (typeof x.color === "number" && Number.isInteger(x.color) && x.color >= 0 && x.color < COLORS) return x.color;
    const l = typeof x.letter === "string" ? x.letter.charCodeAt(0) - 65 : -1;
    return l >= 0 && l < 26 ? l % COLORS : undefined;
  };
  const parts: SongPart[] = used.map((x) => {
    const layers = reviveLayers(x.layers, tracks);
    return tidy({ id: x.id, name: fitName(x.name), color: stored(x), chords: x.chords, melody: reviveMelody(x.melody), bars: fitBars(x.bars), meter: reviveSig(x.meter), layers, ...reviveSettings(x), tones: reviveTones(x.tones, toneIdsIn(layers, tracks)) });
  });
  // sections with no colour yet get the first free one, in playing order
  for (const pid of order) {
    const k = parts.findIndex((x) => x.id === pid);
    if (k >= 0 && parts[k].color === undefined) parts[k] = { ...parts[k], color: freeColor(parts) };
  }
  return { parts, blocks, current: blocks.some((b) => b.id === s.current) ? s.current! : blocks[0].id };
}

/**
 * "All sections": how one track sounds in the section on screen, copied to the same track in
 * every other section that has it: its instrument and how that is set, its playing style and
 * feel and its harp (a chords track), its harp (a melody), or its kit (a drums track: the
 * machine, each drum's sound, the mix and the effects). Never its music, nor its drum rhythm.
 */
function soundToAllN(p: Progression, kind: EditKind, id: string): Progression {
  const song = p.song;
  if (!song) return p;
  const cur = partOf(song, song.current);
  if (!cur || (!isFirst(id) && !p.layers?.[id])) return p;
  const tone = p.tones?.[id];
  const withTone = (x: SongPart): Tones | undefined => {
    const { [id]: _, ...rest } = x.tones ?? {};
    const t = tone ? { ...rest, [id]: clone(tone) } : rest;
    return Object.keys(t).length ? t : undefined;
  };
  const src = p.layers?.[id];
  const parts = song.parts.map((x): SongPart => {
    if (x.id === cur.id) return x;
    if (isFirst(id)) {
      if (kind === "chords") return tidy({ ...x, style: p.pattern, feel: clone(p.feel), sound: clone(p.sound), tones: withTone(x) });
      if (kind === "melody") return tidy({ ...x, tuneSound: clone(p.tuneSound), tones: withTone(x) });
      return { ...x, kit: clone(kitOfBeat(p.beat ?? DEFAULT_BEAT)) };
    }
    const l = x.layers?.[id];
    if (!l || !src) return x;
    const mine = kind === "chords" ? tidy({ ...l, pattern: src.pattern, feel: clone(src.feel), sound: clone(src.sound) }) : kind === "melody" ? tidy({ ...l, tuneSound: clone(src.tuneSound) }) : { ...l, beat: { ...(l.beat ?? src.beat!), ...clone(kitOfBeat(src.beat ?? DEFAULT_BEAT)) } };
    return tidy({ ...x, layers: { ...x.layers, [id]: mine }, tones: kind === "drums" ? x.tones : withTone(x) });
  });
  return { ...p, song: { ...song, parts } };
}
/** How many other sections have this track (the "All sections" button is there only when some do). */
export function sectionsWith(p0: Progression, id: string): number {
  const p = normalize(p0);
  const song = p.song;
  if (!song) return 0;
  const cur = partOf(song, song.current)?.id;
  return song.parts.filter((x) => x.id !== cur && (isFirst(id) || !!x.layers?.[id])).length;
}

/** A track put into one section (the Track page's + in a section that does not have it): plain, empty, ready to write in. */
function addTrackToN(p: Progression, blockId: string, id: string): Progression {
  const t = p.tracks?.find((x) => x.id === id);
  if (!t || t.kind === "vocals" || isFirst(id)) return p;
  const kind = t.kind as EditKind;
  const song = p.song;
  const cur = song ? partOf(song, song.current) : undefined;
  const part = song ? partOf(song, blockId) : undefined;
  const plain = plainLayer(kind);
  if (!song || !part || part.id === cur?.id) {
    if (p.layers?.[id]) return p;
    const { [id]: _, ...tones } = p.tones ?? {};
    return { ...p, layers: { ...p.layers, [id]: plain }, tones: Object.keys(tones).length ? tones : undefined };
  }
  if (part.layers?.[id]) return p;
  const { [id]: _, ...tones } = part.tones ?? {};
  const next: SongPart = tidy({ ...part, layers: { ...part.layers, [id]: plain }, tones: Object.keys(tones).length ? tones : undefined });
  return { ...p, song: { ...song, parts: song.parts.map((x) => (x.id === part.id ? next : x)) } };
}

// ── The song as the pages change it. Each change is made with every track in its place, and the
// track each page was editing is brought forward again afterwards (see ./tracks).
export const commit = settled(commitN);
export const ensureSong = settled(ensureSongN);
export const loadCurrent = settled(loadCurrentN);
export const addNewSection = settled(addNewSectionN);
export const repeatSection = settled(repeatSectionN);
export const selectBlock = settled(selectBlockN);
export const removeBlock = settled(removeBlockN);
export const setSectionBars = settled(setSectionBarsN);
export const renameSection = settled(renameSectionN);
export const moveBlock = settled(moveBlockN);
export const moveBlockTo = settled(moveBlockToN);
export const unlinkBlock = settled(unlinkBlockN);
/** (song/unity's setSig and setSectionSig are the way in: they make sure the song has a signature first) */
export const retime = settled(retimeN);
export const replaceSection = settled(replaceSectionN);
export const mapAllChords = settled(mapAllChordsN);
export const mapAllMelodies = settled(mapAllMelodiesN);
export const settle = settled(settleN);
export const soundToAll = settled(soundToAllN);
export const addTrackTo = settled(addTrackToN);
