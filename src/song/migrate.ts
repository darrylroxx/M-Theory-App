/**
 * Songs saved before every track had one sound of its own.
 *
 * The first chords, melody and drums tracks used to keep their sound per section: the first
 * section's was the song's (`song.shared`), and any other section could have its own
 * (`parts[i].style`, `.feel`, `.sound`, `.tuneSound`, `.kit`). Now each track has one sound for
 * the whole song (see ./tracks), so a song from before is moved over once, on its raw JSON,
 * before it is revived:
 *
 *  1. The first tracks take the sound their lead section played (the section that plays first).
 *     A section that had a sound of its own plays the lead's from now on.
 *  2. A melody from before the melody had a harp of its own played the chords' harp: it keeps
 *     that sound (only for data with no version, `v`: newer data never inherits it).
 *  3. An added chords track that never had a style of its own played the first chords' style:
 *     it keeps the lead's.
 *  4. An added drums track's kit was kept per section: it keeps the kit of the first section
 *     where it plays (in playing order), as the track's one kit.
 *
 * Everything else (instruments, the mixer) is left as it is. Running it again changes nothing.
 */
import { DEFAULT_BEAT, kitOfBeat, reviveBeat, reviveKit, type DrumKit } from "../audio/beats";
import { hasStyle } from "../audio/patterns";

/** The version of the stored song this app writes: 2 = one sound per track. */
export const SOUND_V = 2;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
/** What a section could hold of the first tracks' sound, before. */
const SOUND_KEYS = ["style", "feel", "sound", "tuneSound", "kit"] as const;
const strip = (x: Obj): Obj => {
  if (!SOUND_KEYS.some((k) => k in x)) return x;
  const out = { ...x };
  for (const k of SOUND_KEYS) delete out[k];
  return out;
};
/** A drum beat's kit, from stored JSON (none: undefined). */
const kitOf = (raw: unknown): DrumKit | undefined => {
  if (!isObj(raw)) return undefined;
  const b = reviveBeat(raw);
  return b ? kitOfBeat(b) : undefined;
};
const notes = (m: unknown) => isObj(m) && Array.isArray(m.notes) && m.notes.length > 0;

/** One group of the old settings, as a section held it (undefined: it did not). The playing style goes with its feel. */
type Group = "style" | "sound" | "tuneSound" | "kit";
function groupOf(x: Obj | undefined, g: Group, shared: boolean): Obj | undefined {
  if (!x) return undefined;
  // (the song's style counted only with a style; a section's own with a style or a feel)
  if (g === "style") return x.style !== undefined || (!shared && x.feel !== undefined) ? { style: x.style, feel: x.feel } : undefined;
  return x[g] !== undefined ? { [g]: x[g] } : undefined;
}

/** A stored progression (raw JSON) moved to one sound per track. Anything that is not one comes back as it is. */
export function migrateSound<T>(raw0: T): T {
  if (!isObj(raw0)) return raw0;
  let raw: Obj = { ...raw0 };
  const song = isObj(raw.song) ? raw.song : undefined;
  const parts = song && Array.isArray(song.parts) ? (song.parts as unknown[]).filter(isObj) : [];
  const blocks = song && Array.isArray(song.blocks) ? (song.blocks as unknown[]).filter(isObj) : [];
  const partOf = (blockId: unknown) => parts.find((x) => x.id === blocks.find((b) => b.id === blockId)?.partId);
  const lead = blocks.length ? parts.find((x) => x.id === blocks[0].partId) : undefined;
  const cur = song ? partOf(song.current) : undefined;
  const shared = song && isObj(song.shared) ? song.shared : undefined;

  // 1. the first tracks: what the lead section played (on the page already when it is the one shown, or there is no song)
  if (song && lead && cur && cur !== lead) {
    for (const g of ["style", "sound", "tuneSound", "kit"] as Group[]) {
      const sh = groupOf(shared, g, true);
      const own = groupOf(lead, g, false);
      const v = lead === parts[0] ? sh ?? own : own ?? sh;
      if (!v) continue;
      if (g === "style") {
        if (hasStyle(v.style)) raw.pattern = v.style;
        raw.feel = v.feel;
      } else if (g === "kit") {
        // (a section's kit was made whole on the default one, as it played)
        const kit = reviveKit(v.kit);
        if (kit) raw.beat = { ...(isObj(raw.beat) ? raw.beat : DEFAULT_BEAT), ...kit };
      } else raw[g] = v[g];
    }
  }
  if (song) {
    raw.song = { ...song, ...(shared ? { shared: strip(shared) } : {}), parts: Array.isArray(song.parts) ? (song.parts as unknown[]).map((x) => (isObj(x) ? strip(x) : x)) : song.parts };
  }

  // 2. a melody from before it had a harp of its own played the chords' harp
  if (raw.v === undefined && raw.tuneSound === undefined && raw.sound !== undefined && (notes(raw.melody) || parts.some((x) => notes(x.melody)))) raw.tuneSound = raw.sound;

  // 3 and 4. added chords and drums tracks: the style they played, and the kit they first played on
  if (Array.isArray(raw.tracks)) {
    const order = [...new Set(blocks.map((b) => b.partId))];
    /** each section's layers in playing order (the section on the page: the page's) */
    const layers: unknown[] = song ? order.map((pid) => (cur && pid === cur.id ? raw.layers : parts.find((x) => x.id === pid)?.layers)) : [raw.layers];
    raw = { ...raw, tracks: (raw.tracks as unknown[]).map((t) => (isObj(t) ? migrateTrack(t, layers, raw.pattern) : t)) };
  }
  return { ...raw, v: SOUND_V } as T;
}

/** An added chords track with no style takes `style`; an added drums track with no kit takes the one it first plays on (else the first it has). */
function migrateTrack(t: Obj, layers: unknown[], style: unknown): Obj {
  if (t.kind === "chords" && t.style === undefined && hasStyle(style)) return { ...t, style };
  if (t.kind === "drums" && t.kit === undefined) {
    const beats = layers.map((l) => (isObj(l) && isObj(l[t.id as string]) ? (l[t.id as string] as Obj).beat : undefined)).filter(isObj);
    const kit = kitOf(beats.find((b) => b.on === true) ?? beats[0]);
    return kit ? { ...t, kit } : t;
  }
  return t;
}

/**
 * A copied section (a clipboard) from before: its added tracks get the sound they played there
 * (a chords track the section's style, a drums track the kit of its beat there). Its settings
 * keep only the drum rhythm once revived.
 */
export function migrateSectionClip<T>(raw: T): T {
  if (!isObj(raw) || !Array.isArray(raw.tracks)) return raw;
  const style = isObj(raw.settings) ? raw.settings.style : undefined;
  return { ...raw, tracks: (raw.tracks as unknown[]).map((t) => (isObj(t) ? migrateTrack(t, [raw.layers], style) : t)) } as T;
}
