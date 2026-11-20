/**
 * Songs saved by an older version, moved over to today's (every section has its own tracks and
 * its own settings for every track: see ./structure and ./tracks) once, on their raw JSON,
 * before they are revived. Each section gets exactly what it played before, so an old song
 * sounds as it did:
 *
 *  - Stored with no version (sounds per section, the first section's carried over to the others
 *    until changed there: "= A" / "Own ↺"): every section gets the settings it played, links
 *    resolved. An added chords track with no style of its own played the section's style there;
 *    an added melody played its track's harp; an added drums track its own beat there.
 *  - Version 2 (one sound per track, the drum rhythm carried over from the first section):
 *    every section gets a copy of each track's sound, and the rhythm it played.
 *  - Either way, each section gets a copy of the instruments its tracks played (they were one
 *    per track). An added track stays in a section where it has music (a chord, a melody note,
 *    drums on with a hit), and leaves the sections where it was empty; a track empty everywhere
 *    stays in the section the song was on.
 *  - A melody from before the melody had a harp of its own played the chords' harp: it keeps
 *    that sound (only for data with no version).
 *
 * Everything else (the mixer, harmonies, vocal tracks) is left as it is. Running it again
 * changes nothing.
 */
import { DEFAULT_BEAT, emptyRows, grooveOf, kitOfBeat, reviveBeat, reviveGroove, reviveKit, type Beat, type DrumKit, type Groove } from "../audio/beats";
import { hasStyle, reviveFeel, type Feel, type PatternId } from "../audio/patterns";
import { reviveSound, type HarpSound } from "../audio/rack";
import { fitRhythm, isCompound, reviveSig, sameSig, sigBeats, type TimeSig } from "./meter";

/** The version of the stored song this app writes: 3 = every section has its own tracks and settings. */
export const SOUND_V = 3;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const tidy = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const notes = (m: unknown) => isObj(m) && Array.isArray(m.notes) && m.notes.length > 0;
const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

/** How the first tracks sounded in a section, as the older versions kept it (style and feel go together). */
interface Old {
  style?: PatternId;
  feel?: Partial<Feel>;
  sound?: Partial<HarpSound>;
  tuneSound?: Partial<HarpSound>;
  groove?: Groove;
  kit?: DrumKit;
}
const GROUPS = ["style", "sound", "tuneSound", "groove", "kit"] as const;
type G = (typeof GROUPS)[number];
const reviveOld = (x: Obj | undefined): Old =>
  tidy({
    style: hasStyle(x?.style) ? x.style : undefined,
    feel: isObj(x?.feel) ? reviveFeel(x.feel) : undefined,
    sound: isObj(x?.sound) ? reviveSound(x.sound) : undefined,
    tuneSound: isObj(x?.tuneSound) ? reviveSound(x.tuneSound) : undefined,
    groove: reviveGroove(x?.groove),
    kit: reviveKit(x?.kit),
  });
const owns = (g: G, x: Old) => (g === "style" ? x.style !== undefined || x.feel !== undefined : x[g] !== undefined);
const pick = (g: G, x: Old): Old => (g === "style" ? { style: x.style, feel: x.feel } : { [g]: x[g] });
const sameSound = (a: unknown, b: unknown) => JSON.stringify(reviveSound(a)) === JSON.stringify(reviveSound(b));
const sameFeel = (a: unknown, b: unknown) => JSON.stringify(reviveFeel(a)) === JSON.stringify(reviveFeel(b));
/** Two values of one group the same? (Only where it could matter: a part whose value is the song's played the song's anyway.) */
const same = (g: G, a: Old, b: Old) => (g === "style" ? a.style === b.style && sameFeel(a.feel, b.feel) : g === "sound" || g === "tuneSound" ? sameSound(a[g], b[g]) : JSON.stringify(a[g]) === JSON.stringify(b[g]));

/** The song's rhythm as a section in another time signature played it (as the older versions fitted it). */
function fitted(s: Old, from: TimeSig | undefined, to: TimeSig | undefined): Old {
  if (!s.groove || !to || (from && sameSig(from, to))) return s;
  return { ...s, groove: fitRhythm(s.groove, sigBeats(to), isCompound(to), !!from && isCompound(from) && !isCompound(to)) };
}

/** Does a stored track part hold music: a chord that is not a rest, a melody note, drums on with a hit? */
function hasMusic(l: unknown): boolean {
  if (!isObj(l)) return false;
  if (Array.isArray(l.chords) && l.chords.some((c) => isObj(c) && !c.rest)) return true;
  if (notes(l.melody)) return true;
  const b = l.beat;
  return isObj(b) && b.on === true && isObj(b.rows) && Object.values(b.rows).some((r) => typeof r === "string" && /[1-9]/.test(r));
}

/** A stored progression (raw JSON) moved over to today's. Anything that is not one comes back as it is. */
export function migrateSong<T>(raw0: T): T {
  if (!isObj(raw0)) return raw0;
  const v = typeof raw0.v === "number" ? raw0.v : undefined;
  if (v !== undefined && v >= SOUND_V) return raw0;
  const raw: Obj = { ...raw0 };
  const song = isObj(raw.song) ? raw.song : undefined;
  const allParts = song && Array.isArray(song.parts) ? (song.parts as unknown[]).filter((x): x is Obj => isObj(x) && typeof x.id === "string" && Array.isArray(x.chords)) : [];
  const blocks = song && Array.isArray(song.blocks) ? (song.blocks as unknown[]).filter((b): b is Obj => isObj(b) && typeof b.id === "string" && allParts.some((x) => x.id === b.partId)) : [];
  const order = [...new Set(blocks.map((b) => b.partId as string))];
  const used = allParts.filter((x) => order.includes(x.id as string));
  const hasSong = !!song && blocks.length > 0;
  const curBlock = hasSong && blocks.some((b) => b.id === song!.current) ? song!.current : blocks[0]?.id;
  const cur = hasSong ? used.find((x) => x.id === blocks.find((b) => b.id === curBlock)?.partId) : undefined;

  // a melody from before it had a harp of its own played the chords' harp
  if (v === undefined && raw.tuneSound === undefined && raw.sound !== undefined && (notes(raw.melody) || allParts.some((x) => notes(x.melody)))) raw.tuneSound = raw.sound;

  // what is on the page: the newest there is (the section on screen, or the only one)
  const beat: Beat = reviveBeat(raw.beat) ?? DEFAULT_BEAT;
  const live: Old = tidy({ style: hasStyle(raw.pattern) ? raw.pattern : "ring", feel: isObj(raw.feel) ? reviveFeel(raw.feel) : undefined, sound: isObj(raw.sound) ? reviveSound(raw.sound) : undefined, tuneSound: isObj(raw.tuneSound) ? reviveSound(raw.tuneSound) : undefined, groove: grooveOf(beat), kit: kitOfBeat(beat) });

  // ── how each section's first tracks played, by part id ──
  const played = new Map<string, Old>();
  if (hasSong) {
    // the groups a section could have of its own: everything (no version), or only the drum rhythm (version 2)
    const groups: readonly G[] = v === undefined ? GROUPS : ["groove"];
    const parts = [...used];
    // older songs: the section that plays first is the one the others follow
    if (!isObj(song!.shared)) parts.sort((a, b) => order.indexOf(a.id as string) - order.indexOf(b.id as string));
    const own = new Map(parts.map((x) => [x, reviveOld(x)]));
    let shared: Old = reviveOld(isObj(song!.shared) ? song!.shared : undefined);
    // the first section held nothing of its own: whatever it had was the song's
    const lead = own.get(parts[0])!;
    for (const g of groups) if (owns(g, lead) && !owns(g, shared)) shared = { ...shared, ...pick(g, lead) };
    // the page went back into its section: from the first, into the song's
    if (cur === parts[0]) for (const g of groups) shared = tidy({ ...shared, ...pick(g, live) });
    // (what the song held of each group, the page standing in for what it did not)
    const full: Old = { style: shared.style ?? live.style, feel: shared.style ? shared.feel : live.feel, sound: shared.sound ?? live.sound, tuneSound: shared.tuneSound ?? live.tuneSound, groove: shared.groove ?? live.groove, kit: shared.kit ?? live.kit };
    const songSig = reviveSig(raw.meter);
    const sigOf = (x: Obj) => reviveSig(x.meter) ?? songSig;
    parts.forEach((x, i) => {
      const theirs = fitted(full, sigOf(parts[0]), sigOf(x));
      let out: Old = {};
      for (const g of GROUPS) {
        const mine = !groups.includes(g) ? live : i === 0 ? theirs : x === cur ? (owns(g, live) && !same(g, live, theirs) ? live : theirs) : owns(g, own.get(x)!) ? own.get(x)! : theirs;
        out = { ...out, ...pick(g, mine) };
      }
      played.set(x.id as string, tidy(out));
    });
  }

  // ── the added tracks: which sections they stay in, and how they sound in each ──
  const tracks = Array.isArray(raw.tracks) ? (raw.tracks as unknown[]).filter(isObj) : [];
  const added = tracks.filter((t) => typeof t.id === "string" && (t.kind === "chords" || t.kind === "melody" || t.kind === "drums"));
  /** each section's stored layers (the one on screen: the page's) */
  const layersOf = (x: Obj | undefined): Obj => (isObj(x === cur || !x ? raw.layers : x.layers) ? ((x === cur || !x ? raw.layers : x.layers) as Obj) : {});
  const spots: (Obj | undefined)[] = hasSong ? used : [undefined];
  /** a track's part of a section, with how it sounds there */
  const partFor = (t: Obj, l: unknown, style: PatternId | undefined): Obj => {
    const layer: Obj = isObj(l) ? { ...l } : t.kind === "chords" ? { chords: [] } : {};
    if (t.kind === "chords") return tidy({ ...layer, pattern: hasStyle(t.style) ? t.style : v === undefined ? style ?? "ring" : "ring", feel: isObj(t.feel) ? clone(t.feel) : undefined, sound: isObj(t.sound) ? clone(t.sound) : undefined });
    if (t.kind === "melody") return tidy({ ...layer, tuneSound: isObj(t.sound) ? clone(t.sound) : undefined });
    // drums: its beat there, on the kit it played (version 2: the track's one kit; before: the beat's own)
    const b = isObj(layer.beat) ? layer.beat : { ...DEFAULT_BEAT, on: false, patternId: null, name: "Empty", edited: false, bars: 1, rows: emptyRows(DEFAULT_BEAT.steps) };
    const kit = v === 2 ? reviveKit(t.kit) ?? kitOfBeat(DEFAULT_BEAT) : undefined;
    return { ...layer, beat: kit ? { ...b, ...kit } : b };
  };
  const newLayers = new Map<Obj | undefined, Obj>(spots.map((x) => [x, {}]));
  for (const t of added) {
    const id = t.id as string;
    const withMusic = spots.filter((x) => hasMusic(layersOf(x)[id]));
    // empty everywhere: it stays in the section the song was on (with no song: on the page)
    const keep = withMusic.length ? withMusic : [hasSong ? cur : undefined];
    for (const x of keep) newLayers.get(x)![id] = partFor(t, layersOf(x)[id], x ? played.get(x.id as string)?.style : live.style);
  }
  // (the tracks are rows only from now on: how they sound is in each section)
  raw.tracks = (raw.tracks as unknown[] | undefined)?.map((t) => {
    if (!isObj(t)) return t;
    const { style: _s, feel: _f, sound: _o, kit: _k, ...rest } = t;
    return t.kind === "vocals" ? t : rest;
  });

  // ── the instruments: one per track before, now a copy in every section that has the track ──
  const tones = isObj(raw.tones) ? raw.tones : undefined;
  const tonesFor = (ls: Obj): Obj | undefined => {
    if (!tones) return undefined;
    const ids = ["chords", "melody", ...Object.keys(ls).filter((id) => added.some((t) => t.id === id && t.kind !== "drums"))];
    const out = Object.fromEntries(ids.filter((id) => isObj(tones[id])).map((id) => [id, clone(tones[id])]));
    return Object.keys(out).length ? out : undefined;
  };

  if (hasSong) {
    const { shared: _sh, ...rest } = song!;
    raw.song = {
      ...rest,
      parts: (song!.parts as unknown[]).map((x) => {
        if (!isObj(x) || !used.includes(x)) return x;
        const s = played.get(x.id as string)!;
        const ls = newLayers.get(x)!;
        const { style: _a, feel: _b, sound: _c, tuneSound: _d, kit: _e, groove: _f, layers: _g, tones: _h, ...base } = x;
        return tidy({ ...base, ...clone(s), layers: Object.keys(ls).length ? ls : undefined, tones: tonesFor(ls) });
      }),
    };
    // the page shows the section on screen, as it played
    const s = played.get(cur!.id as string)!;
    raw.pattern = s.style;
    raw.feel = s.feel;
    raw.sound = s.sound;
    raw.tuneSound = s.tuneSound;
    raw.beat = { ...beat, ...s.kit, ...s.groove, on: s.groove?.on ?? beat.on };
  }
  const ls = newLayers.get(hasSong ? cur : undefined)!;
  raw.layers = Object.keys(ls).length ? ls : undefined;
  raw.tones = tonesFor(ls);
  return tidy({ ...raw, v: SOUND_V }) as T;
}

/**
 * A copied section (a clipboard) from an older version: its added tracks get the sound they
 * played there, in their parts of it (a chords track the section's style when it had none of its
 * own, a melody its track's harp, a drums track the kit of its beat there).
 */
export function migrateSectionClip<T>(raw: T): T {
  if (!isObj(raw) || !Array.isArray(raw.tracks) || raw.whole === true) return raw;
  const style = isObj(raw.settings) && hasStyle(raw.settings.style) ? raw.settings.style : "ring";
  const layers = isObj(raw.layers) ? { ...raw.layers } : {};
  for (const t of raw.tracks as unknown[]) {
    if (!isObj(t) || typeof t.id !== "string" || !isObj(layers[t.id])) continue;
    const l = layers[t.id] as Obj;
    if (t.kind === "chords") layers[t.id] = tidy({ ...l, pattern: hasStyle(t.style) ? t.style : style, feel: isObj(t.feel) ? t.feel : undefined, sound: isObj(t.sound) ? t.sound : undefined });
    else if (t.kind === "melody") layers[t.id] = tidy({ ...l, tuneSound: isObj(t.sound) ? t.sound : undefined });
    else if (t.kind === "drums" && isObj(l.beat) && reviveKit(t.kit)) layers[t.id] = { ...l, beat: { ...l.beat, ...reviveKit(t.kit) } };
  }
  return { ...raw, layers } as T;
}
