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
 * A section holds music: its chords, its melody, every added track's part and the drum rhythm.
 * How each track sounds (its instrument, playing style, harp and effects, drum kit) is the
 * track's own and the same in every section (see ./tracks), so it is not kept here.
 *
 * The drum rhythm carries over. The section that plays first sets the first drums track's
 * rhythm for the whole song; every other section plays it until its rhythm is changed there, and
 * from then on keeps a rhythm of its own ("= A" / "Own ↺" on the Drums page). Move another
 * section to the front and it leads from then on, with every section still playing as it did.
 *
 * The page always shows the block that is selected. Those live copies sit in `progression.chords`,
 * `.melody`, `.bars`, `.layers` and the rhythm of `.beat`; they are written back into the song
 * whenever another block is chosen, the song is played, saved or exported.
 */
import { DEFAULT_BEAT, barBeats, barsOf, grooveOf, reviveGroove, sameGroove, type Beat, type Groove } from "../audio/beats";
import { styleBar, type PatternId } from "../audio/patterns";
import { melodyBeats, reviveMelody, tileMelody, type Melody } from "./melody";
import { DEFAULT_BARS, MAX_SECTION_BARS, autoBeats, barsOr, fitBars, frameItems } from "./frame";
import { DEFAULT_SIG, fitRhythm, isCompound, mapLayers, mapList, refit, reviveSig, sameSig, sigBeats, type TimeSig } from "./meter";
import type { ProgChord, Progression } from "../ui/state";
import { carryMarks, normalize, reviveLayers, settled, type Layers, type Track } from "./tracks";
import { outPrint } from "./prints";

/** What carries over from the first section: the first drums track's rhythm (and whether the drums play). */
export interface Settings {
  groove?: Groove;
}

/**
 * One set of chords and one melody, used by one or more blocks.
 * Its drum rhythm is kept only when it differs from the song's: otherwise it plays the first section's.
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
  /** what the extra tracks (added on the Track page) hold in this section, by track id */
  layers?: Layers;
}
/** One step of the song, in playing order. */
export interface SongBlock {
  id: string;
  partId: string;
}
export interface Song {
  /** the first part is the one that plays first: the others follow its settings */
  parts: SongPart[];
  blocks: SongBlock[];
  /** the song's drum rhythm: what the first section plays, and what every other section plays unless it has one of its own */
  shared?: Settings;
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

/** The drum rhythm on screen right now (the first drums track's, with every track in its place). */
export function liveSettings(p: Progression): Required<Settings> {
  return { groove: grooveOf(p.beat ?? DEFAULT_BEAT) };
}

/** The song's drum rhythm; for songs saved before sections could differ, what is on screen stands in for what is missing. */
function sharedOf(p: Progression, song: Song): Settings {
  return { groove: song.shared?.groove ?? liveSettings(p).groove };
}

/**
 * A part's time signature: its own, or the song's. (The song's is `progression.meter`, which
 * song/unity sets on every change; it is missing only before that has happened, and then no
 * part has one of its own either.)
 */
const sigOfPart = (p: Progression, part: SongPart | undefined): TimeSig | undefined => part?.meter ?? p.meter;

/**
 * The song's settings as one part plays them. The song's drum rhythm is kept in the bars of the
 * first section; a section in another time signature plays it fitted to its own bars (and never
 * writes that back, so nothing is lost on the way).
 */
function fitShared(shared: Settings, from: TimeSig | undefined, to: TimeSig | undefined): Settings {
  if (!shared.groove || !to || (from && sameSig(from, to))) return shared;
  const g = fitRhythm(shared.groove, sigBeats(to), isCompound(to), !!from && isCompound(from) && !isCompound(to));
  return g === shared.groove ? shared : { ...shared, groove: g };
}
/** The song's settings, in the bars of one part. */
const sharedFor = (p: Progression, song: Song, part: SongPart | undefined): Settings => fitShared(sharedOf(p, song), sigOfPart(p, song.parts[0]), sigOfPart(p, part));

/** The drum rhythm a part plays: its own where it has one, the song's (in its bars) otherwise. */
function resolve(part: SongPart, first: boolean, shared: Settings): Settings {
  return { groove: !first && part.groove !== undefined ? part.groove : shared.groove };
}

const tidy = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const sig = (x: unknown) => JSON.stringify(x);

/** What every part sounds like, by part id. */
function resolvedAll(p: Progression, song: Song): Map<string, Settings> {
  return new Map(song.parts.map((x, i) => [x.id, resolve(x, i === 0, sharedFor(p, song, x))]));
}

/**
 * Store the drum rhythms so that every part listed in `want` plays exactly as it says: the first
 * part's becomes the song's, and each other part keeps one of its own only where it differs from
 * that (as it plays it, in its own bars). A part whose `want` has no drum rhythm follows the
 * song's. Parts not listed are left as they are.
 */
function rebase(p: Progression, song: Song, want: Map<string, Settings>): Song {
  const lead = song.parts[0];
  const shared = tidy({ ...sharedOf(p, song), ...tidy(want.get(lead.id) ?? {}) });
  const parts = song.parts.map((x, i) => {
    const w = want.get(x.id);
    if (!w) return x;
    let y: SongPart = { ...x, groove: undefined };
    if (i > 0 && w.groove) {
      const has = fitShared(shared, sigOfPart(p, lead), sigOfPart(p, x));
      if (!sameGroove(w.groove, has.groove)) y = { ...y, groove: w.groove };
    }
    return tidy(y);
  });
  return { ...song, parts, shared };
}

/**
 * The part that plays first leads. When another part comes to the front (moved there, or the
 * first one removed), its drum rhythm becomes the song's and every section keeps playing as it
 * did: a section whose rhythm the song's no longer is keeps it as its own.
 * `before`: what each part played before the change.
 */
function lead(p: Progression, song: Song, before: Map<string, Settings> = resolvedAll(p, song)): Song {
  const first = song.blocks[0]?.partId;
  const top = song.parts.find((x) => x.id === first);
  if (!top || song.parts[0] === top) return song;
  return rebase(p, { ...song, parts: [top, ...song.parts.filter((x) => x !== top)] }, before);
}

/**
 * Write what is on screen back into the song: the chords, the melody and the tracks' parts into
 * their section, and the drum rhythm either into the song (from the first section) or, where it
 * differs from the song's, into this section alone.
 */
function commitN(p: Progression): Progression {
  const song = p.song;
  if (!song) return p;
  const part = partOf(song, song.current);
  if (!part) return p;
  const first = song.parts[0]?.id === part.id;
  const live = liveSettings(p);
  let shared = sharedOf(p, song);
  // what this section would play if it followed the song, in its own bars
  const theirs = fitShared(shared, sigOfPart(p, song.parts[0]), sigOfPart(p, part));
  let next: SongPart = { ...part, chords: p.chords, melody: p.melody, bars: p.bars, layers: p.layers };
  if (first) {
    shared = { ...shared, groove: live.groove };
    next = { ...next, groove: undefined };
  } else next = { ...next, groove: sameGroove(live.groove, theirs.groove) ? undefined : live.groove };
  next = tidy(next);
  shared = tidy(shared);
  if (part.chords === p.chords && part.melody === p.melody && part.layers === p.layers && sig({ ...part, chords: 0, melody: 0 }) === sig({ ...next, chords: 0, melody: 0 }) && sig(song.shared) === sig(shared)) return p;
  return { ...p, song: { ...song, shared, parts: song.parts.map((x) => (x.id === part.id ? next : x)) } };
}

/** Turn the page into section A, if there is no song yet. */
function ensureSongN(p: Progression, id: () => string = uid): Progression {
  if (p.song?.blocks.length) return commit(p);
  const part: SongPart = tidy({ id: id(), color: 0, chords: p.chords, melody: p.melody, bars: p.bars, layers: p.layers });
  const block: SongBlock = { id: id(), partId: part.id };
  // what was sung over the page (before it had sections) was sung in section A: it goes with it
  const sung = p.tracks && mapList(p.tracks, (t) => (t.takes?.some((k) => !k.at.block) ? { ...t, takes: t.takes.map((k) => (k.at.block ? k : { ...k, at: { ...k.at, block: block.id } })) } : t));
  // and a harmony written on the page was written in section A
  const tracks = carryMarks(sung, "", part.id);
  return { ...p, ...(tracks ? { tracks } : {}), song: { parts: [part], blocks: [block], current: block.id, shared: tidy(liveSettings(p)) } };
}

/** Load a part onto the page: its chords, melody and tracks' parts, and the drum rhythm it plays (the drums keep their kit). */
function show(p: Progression, song: Song, blockId: string): Progression {
  const part = partOf(song, blockId)!;
  const s = resolve(part, song.parts[0]?.id === part.id, sharedFor(p, song, part));
  const beat = { ...(p.beat ?? DEFAULT_BEAT), ...s.groove };
  return { ...p, chords: part.chords, melody: part.melody, bars: part.bars, layers: part.layers, beat: { ...beat, on: s.groove?.on ?? beat.on }, song: { ...song, current: blockId } };
}

/** Put the page back in step with the song (after loading one). */
function loadCurrentN(p: Progression): Progression {
  return p.song && partOf(p.song, p.song.current) ? show(p, p.song, p.song.current) : p;
}

/** Make sure the section that plays first is the one the others follow (songs saved before that was always so). */
function leadFirstN(p0: Progression): Progression {
  if (!p0.song || !p0.song.blocks.length || p0.song.parts[0]?.id === p0.song.blocks[0].partId) return p0;
  const p = commit(p0);
  return { ...p, song: lead(p, p.song!) };
}

/** What a part is called on screen: its name, or else its letter. */
const labelOf = (part: SongPart | undefined, order: Map<string, number>): string => part?.name ?? letterAt(part ? order.get(part.id) ?? 0 : 0);

/** Whether the section on screen has a drum rhythm of its own, and which section the others follow. */
export function linkState(p0: Progression): { first: boolean; source: string; own: boolean } {
  const p = normalize(p0);
  const song = p.song;
  const part = song && partOf(song, song.current);
  if (!song || !part) return { first: true, source: "A", own: false };
  const first = song.parts[0].id === part.id;
  const source = labelOf(song.parts[0], playOrder(song));
  if (first) return { first, source, own: false };
  return { first, source, own: !sameGroove(liveSettings(p).groove, sharedFor(p, song, part).groove) };
}

/** Give up the section's own drum rhythm: it plays the song's again. */
function relinkN(p: Progression): Progression {
  if (!p.song) return p;
  const sh = sharedFor(p, p.song, partOf(p.song, p.song.current));
  const beat = p.beat ?? DEFAULT_BEAT;
  return { ...p, beat: { ...beat, ...sh.groove, on: sh.groove?.on ?? beat.on } };
}

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

/** A brand-new section: no chords and no melody yet, the drum rhythm and the time signature follow the song, and it starts as long as the section it was made from. */
function addNewSectionN(p0: Progression, id: () => string = uid): Progression {
  const p = ensureSong(p0, id);
  const song = p.song!;
  const part: SongPart = tidy({ id: id(), color: freeColor(song.parts), chords: [], bars: p.bars });
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
 * If the section that played first goes, the next one leads, and every section keeps sounding as it did.
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
  // the leader changes first (while the old one is still there to hand over from); then the part no block plays any more goes
  const led = lead(p, { ...song, blocks });
  const next: Song = { ...led, parts: led.parts.filter((x) => blocks.some((b) => b.partId === x.id)) };
  if (song.current !== blockId) return { ...p, song: next };
  return show(p, next, blocks[Math.min(at, blocks.length - 1)].id);
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

/** Move a block so it lands before the block now at `index` (blocks.length = the end). Whichever section then plays first leads. */
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
  return { ...p, song: lead(p, { ...p.song!, blocks }) };
}

/** How many blocks share this block's section. */
export function sharedCount(p: Progression, blockId: string): number {
  const song = p.song;
  const partId = song?.blocks.find((b) => b.id === blockId)?.partId;
  return song && partId ? song.blocks.filter((b) => b.partId === partId).length : 0;
}

/** Give a block a section of its own, with a copy of the chords, melody, tracks' parts, drum rhythm and time signature, so it can differ from the others. */
function unlinkBlockN(p0: Progression, blockId: string, id: () => string = uid): Progression {
  const p = commit(p0);
  const song = p.song;
  const part = song && partOf(song, blockId);
  if (!song || !part || sharedCount(p, blockId) < 2) return p;
  // the first section's rhythm is the song's: the copy follows it, like any new section. It has its own colour, and its letter until it is named.
  const copy: SongPart = tidy({ ...part, id: id(), name: undefined, color: freeColor(song.parts), chords: part.chords.map((c) => ({ ...c, id: id() })) });
  const next = lead(p, { ...song, parts: [...song.parts, copy], blocks: song.blocks.map((b) => (b.id === blockId ? { ...b, partId: copy.id } : b)) });
  // a harmony in the copy is what was written there, not a change by hand
  const tracks = carryMarks(p.tracks, part.id, copy.id);
  const q = tracks === p.tracks ? p : { ...p, tracks };
  return song.current === blockId ? { ...q, chords: copy.chords, song: next } : { ...q, song: next };
}

/**
 * New time signatures: the song's (`meter`), and perhaps one section's (`one`; the song's own
 * signature there means it follows the song again). Every section whose bars change has its
 * chords, melody, drums and tracks fitted to them; every other section keeps sounding exactly
 * as it did, even where the song's drum rhythm had to be fitted for the first section.
 */
function retimeN(p0: Progression, meter: TimeSig, one: { block: string; sig: TimeSig } | null = null): Progression {
  const p = commit(p0);
  const song = p.song;
  if (!song) return p;
  const target = one ? partOf(song, one.block) : undefined;
  if (one && !target) return p;
  const same = (a?: TimeSig, b?: TimeSig) => (!a && !b) || sameSig(a, b);
  if (same(meter, p.meter) && (!target || same(sameSig(one!.sig, meter) ? undefined : one!.sig, target.meter))) return p0;
  const before = resolvedAll(p, song);
  const want = new Map(before);
  const parts = song.parts.map((x, i) => {
    const own = x === target ? (sameSig(one!.sig, meter) ? undefined : one!.sig) : x.meter;
    const from = sigOfPart(p, x) ?? DEFAULT_SIG;
    const to = own ?? meter;
    let y: SongPart = same(own, x.meter) ? x : tidy({ ...x, meter: own });
    if (sameSig(from, to)) return y;
    const f = refit(from, to);
    y = tidy({ ...y, chords: mapList(y.chords, f.chord!), melody: y.melody && f.melody!(y.melody), groove: y.groove && f.rhythm!(y.groove), layers: mapLayers(y.layers, f) });
    // what it plays in its new bars: the first section's rhythm (the song's) moves with it; one of its own is fitted; otherwise it follows the song
    const w = before.get(x.id)!;
    want.set(x.id, { ...w, groove: i === 0 ? w.groove && f.rhythm!(w.groove) : x.groove !== undefined ? y.groove : undefined });
    return y;
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
  return show(q, rebase(q, { ...song, parts }, want), song.current);
}

/**
 * Put new music into a section, in place of all it had: its chords, melody, length, time
 * signature, every track's part and its drum rhythm. Every block of it changes (it is one
 * section); every other section keeps playing as it did. Its name and colour stay. How the
 * tracks sound is theirs, and does not change.
 */
export interface SectionContent {
  chords: ProgChord[];
  melody?: Melody;
  bars?: number;
  /** the time signature it is written in */
  meter: TimeSig;
  layers?: Layers;
  /** its drum rhythm, as it plays (in its own bars) */
  settings: Settings;
}
function replaceSectionN(p0: Progression, blockId: string, c: SectionContent): Progression {
  const p = commit(p0);
  const song = p.song;
  const part = song && partOf(song, blockId);
  if (!song || !part) return p;
  const before = resolvedAll(p, song);
  const next: SongPart = tidy({ id: part.id, name: part.name, color: part.color, chords: c.chords, melody: c.melody, bars: fitBars(c.bars), meter: p.meter && sameSig(c.meter, p.meter) ? undefined : c.meter, layers: c.layers });
  const want = new Map(before).set(part.id, c.settings);
  const parts = song.parts.map((x) => (x.id === part.id ? next : x));
  return show(p, rebase(p, { ...song, parts }, want), song.current);
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
  /** what the extra tracks hold in it */
  layers?: Layers;
  current: boolean;
}

/** The song in playing order, each section with its chords, melody, tracks' parts and the drum rhythm it plays. Empty when there is no structure. */
export function sections(p0: Progression): Section[] {
  const p = commit(normalize(p0));
  const song = p.song;
  if (!song) return [];
  const order = playOrder(song);
  const all = resolvedAll(p, song);
  return song.blocks.map((b) => {
    const part = song.parts.find((x) => x.id === b.partId)!;
    const i = order.get(part.id) ?? 0;
    return { ...all.get(part.id)!, blockId: b.id, partId: b.partId, letter: letterAt(i), ...(part.name ? { name: part.name } : {}), label: labelOf(part, order), color: colorOf(part, i), chords: part.chords, melody: part.melody, bars: part.bars, ...(part.meter ? { meter: part.meter } : {}), layers: part.layers, current: b.id === song.current };
  });
}

/** The page as a section, when there is no song yet: section A, with everything on screen. */
export function soloSection(p0: Progression): Section {
  const p = normalize(p0);
  return { ...liveSettings(p), blockId: "", partId: "", letter: "A", label: "A", color: 0, current: true, chords: p.chords, melody: p.melody, bars: p.bars, layers: p.layers };
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
    const drums: Beat = { ...live, ...sec?.groove, on: sec?.groove?.on ?? live.on };
    return { ...part, ...settleOne(part, barOfBeat(drums, p.pattern), drums.on ? barBeats(drums) * barsOf(drums) : 0) };
  });
  return show(p, { ...song, parts }, song.current);
}

/** A section's drum rhythm loaded from storage, made safe (anything else it held is let go: see ./migrate). */
export function reviveSettings(x: { [K in keyof Settings]?: unknown } | undefined): Settings {
  return tidy({ groove: reviveGroove(x?.groove) });
}

/**
 * Tidy up a song loaded from storage. Letters are never stored: they follow the playing order
 * (songs saved with letters, or with Intro / Verse / Chorus, are lettered that way too). Each
 * section keeps its colour; songs from before colours had one each get the colour their letter
 * had. Songs saved when every section kept a copy of its own drum rhythm are moved to today's
 * way: the first section's is the song's, and the others keep one only where it differs.
 */
export function reviveSong(raw: unknown, tracks?: Track[]): Song | null {
  const s = raw as Partial<Song> | null | undefined;
  if (!s || !Array.isArray(s.parts) || !Array.isArray(s.blocks)) return null;
  type Raw = { id: string; chords: ProgChord[]; letter?: unknown; name?: unknown; color?: unknown; meter?: unknown; bars?: unknown } & { [K in keyof Settings | "melody"]?: unknown };
  const valid = (s.parts as unknown[]).filter((x): x is Raw => !!x && typeof (x as Raw).id === "string" && Array.isArray((x as Raw).chords));
  const blocks = s.blocks.filter((b): b is SongBlock => !!b && typeof b.id === "string" && valid.some((x) => x.id === b.partId));
  if (!blocks.length) return null;
  const used = valid.filter((x) => blocks.some((b) => b.partId === x.id));
  const order = [...new Set(blocks.map((b) => b.partId))];
  // older songs: the section that plays first is the one the others follow
  if (!s.shared) used.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  // a colour of its own; before sections had one, the colour went with the letter
  const stored = (x: Raw): number | undefined => {
    if (typeof x.color === "number" && Number.isInteger(x.color) && x.color >= 0 && x.color < COLORS) return x.color;
    const l = typeof x.letter === "string" ? x.letter.charCodeAt(0) - 65 : -1;
    return l >= 0 && l < 26 ? l % COLORS : undefined;
  };
  let parts: SongPart[] = used.map((x) => tidy({ id: x.id, name: fitName(x.name), color: stored(x), chords: x.chords, melody: reviveMelody(x.melody), bars: fitBars(x.bars), meter: reviveSig(x.meter), layers: reviveLayers((x as { layers?: unknown }).layers, tracks), ...reviveSettings(x) }));
  // sections with no colour yet get the first free one, in playing order
  for (const pid of order) {
    const k = parts.findIndex((x) => x.id === pid);
    if (k >= 0 && parts[k].color === undefined) parts[k] = { ...parts[k], color: freeColor(parts) };
  }
  let shared = reviveSettings(s.shared as Settings | undefined);
  // the first section holds nothing of its own: whatever it has is the song's
  const lead = parts[0];
  if (lead.groove !== undefined) {
    if (shared.groove === undefined) shared = { groove: lead.groove };
    parts[0] = tidy({ ...parts[0], groove: undefined });
  }
  parts = parts.map((x, i) => (i > 0 && x.groove && shared.groove && sameGroove(x.groove, shared.groove) ? tidy({ ...x, groove: undefined }) : x));
  return { parts, blocks, shared: tidy(shared), current: blocks.some((b) => b.id === s.current) ? s.current! : blocks[0].id };
}

// ── The song as the pages change it. Each change is made with every track in its place, and the
// track each page was editing is brought forward again afterwards (see ./tracks).
export const commit = settled(commitN);
export const ensureSong = settled(ensureSongN);
export const loadCurrent = settled(loadCurrentN);
export const leadFirst = settled(leadFirstN);
export const relink = settled(relinkN);
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
