/**
 * Copy and Paste between sections: one page at a time, or a whole section at once.
 *
 * Each page has a clipboard of its own, so a rhythm can only be pasted as a rhythm, a melody as a
 * melody and drums as drums, and copying on one page never wipes what was copied on another.
 *
 * Copying and pasting moves music, never sound: the track pasted into keeps its own instrument,
 * style, harp, effects and kit (see ./tracks).
 *
 * - Rhythm: the chords (their lengths, rests and chosen shapes).
 * - Melody: the notes, the grid and on/off.
 * - Drums: the drum rhythm and on/off.
 *
 * A paste replaces that page of the section on screen and nothing else: the section keeps its
 * length (the Frame decides it) and its other two pages. The clipboards are kept with the app, so
 * a part can also be pasted into another idea; a song in another key gets the chords and melody
 * moved to its key.
 *
 * - Section (on the Frame page): everything in it. Every track's chords, melody and drums, its
 *   drum rhythm, its length and time signature, and the vocal takes recorded in it. A paste puts
 *   all of that in place of what the section had; the recordings come as new takes of the same
 *   audio files (nothing is copied on disk, nothing deleted). A track the paste has to make (into
 *   another idea) comes with its own sound and instrument; the tracks already there keep theirs.
 */
import { DEFAULT_BEAT, grooveOf, reviveBeat, type Beat } from "../audio/beats";
import { transposeRef, type Key } from "../theory/keys";
import { pc } from "../theory/notes";
import { TICKS, melodyBase, reviveMelody, transposeMelody, type Melody } from "./melody";
import type { ProgChord, Progression } from "../ui/state";
import { fitChordBeats, fitMelody, isCompound, reviveSig, sigBeats, type TimeSig } from "./meter";
import { conform, sectionSig, sigOf } from "./unity";
import { barsOr } from "./frame";
import { commit, ensureSong, replaceSection, reviveSettings, sections, soloSection, type Settings } from "./structure";
import { forget, insteadTarget, isFirst, muteInstead, normalize, reviveLayers, reviveTracks, settled, type Layer, type Layers, type Track } from "./tracks";
import { reviveTones, type Tones } from "../audio/tone";
import { groupsOf } from "./takes";
import { migrateSectionClip } from "./migrate";
import { clipsOf } from "./clips";

export type ClipKind = "rhythm" | "melody" | "drums";

interface ClipBase {
  /** the section it was copied from, as it was called then */
  from: string;
  /** the key it was written in */
  key: Key;
  /** beats in a bar where it was written (its section's time signature then) */
  bar?: number;
}
export interface RhythmClip extends ClipBase {
  chords: ProgChord[];
}
export interface MelodyClip extends ClipBase {
  melody: Melody | null;
}
export interface DrumClip extends ClipBase {
  /** its rhythm and on/off are what is pasted (the kit stays the pasted track's) */
  beat: Beat;
}
/** A whole section. */
export interface SectionClip extends ClipBase {
  /** the block and section it was copied from, and the idea (see ui/openidea: null = one not saved yet, from before ideas not saved had an id) */
  block: string;
  part?: string;
  idea: string | null;
  /** its time signature and length */
  meter: TimeSig;
  bars: number;
  /** the first chords and melody tracks' parts */
  chords: ProgChord[];
  melody?: Melody;
  /** the first drums track's rhythm, as it played (in its own bars) */
  settings: Settings;
  /** what the added tracks hold in it, by track id */
  layers?: Layers;
  /** the added tracks it has something on, so they can be found (or made, with their own sound) in another idea; vocal tracks carry only the takes recorded in it */
  tracks: Track[];
  /** the instruments those tracks play, by track id (a track the paste makes plays the same one) */
  tones?: Tones;
}
export interface Clips {
  rhythm?: RhythmClip;
  melody?: MelodyClip;
  drums?: DrumClip;
  section?: SectionClip;
}

const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));
const uid = () => Math.random().toString(36).slice(2, 10);

/** Semitones from one key's home note to another's, the short way round (−5 … +6). */
export function keyShift(from: Key, to: Key): number {
  const d = (((pc(to.tonic) - pc(from.tonic)) % 12) + 12) % 12;
  return d > 6 ? d - 12 : d;
}

export function copyRhythm(p: Progression, key: Key, from: string): RhythmClip {
  return clone({ from, key, bar: sigBeats(sectionSig(p)), chords: p.chords });
}
export function copyMelody(p: Progression, key: Key, from: string): MelodyClip {
  return clone({ from, key, bar: sigBeats(sectionSig(p)), melody: p.melody ?? null });
}
export function copyDrums(p: Progression, key: Key, from: string): DrumClip {
  return clone({ from, key, bar: sigBeats(sectionSig(p)), beat: p.beat ?? DEFAULT_BEAT });
}

/** The section on screen gets the copied chords (each a new slot). The track keeps its own style and sound. */
export function pasteRhythm(p: Progression, c: RhythmClip, key: Key, id: () => string = uid): Progression {
  const n = keyShift(c.key, key);
  // copied in another time signature: chords that lasted whole bars there last whole bars here
  const to = sigBeats(sectionSig(p));
  const chords = clone(c.chords).map((x) => ({ ...x, beats: fitChordBeats(x.beats, c.bar ?? to, to) })).map((x) => (n ? { ...x, id: id(), ref: transposeRef(x.ref, n, key), voicingId: undefined } : { ...x, id: id() }));
  return { ...p, chords };
}
/**
 * How far to move a melody into another key: by as much as the home note moves, up or down,
 * whichever keeps the most notes on the new key's grid (two octaves from its home note).
 */
export function melodyShift(m: Melody, from: Key, to: Key): number {
  const n = keyShift(from, to);
  if (!n) return 0;
  const lo = melodyBase(to);
  const inside = (by: number) => m.notes.filter((x) => x.midi + by >= lo && x.midi + by <= lo + 24).length;
  return [n, n - 12, n + 12].reduce((best, by) => (inside(by) > inside(best) ? by : best));
}
/** The section on screen gets the copied melody. The track keeps its own sound. */
export function pasteMelody(p: Progression, c: MelodyClip, key: Key): Progression {
  const sig = sectionSig(p);
  const to = sigBeats(sig);
  // copied in another time signature: every note stays in its bar
  const m = c.melody ? fitMelody(clone(c.melody), c.bar ?? to, to, isCompound(sig)) : undefined;
  const by = m ? melodyShift(m, c.key, key) : 0;
  return { ...p, melody: m && by ? transposeMelody(m, by) : m };
}
/** The section on screen gets the copied drum rhythm and on/off; the track keeps its kit. (A rhythm from other bars is fitted to the section's: see song/unity.) */
export function pasteDrums(p: Progression, c: DrumClip): Progression {
  return { ...p, beat: { ...(p.beat ?? DEFAULT_BEAT), ...clone(grooveOf(c.beat)) } };
}

// ── A whole section ──────────────────────────────────────────

const tidy = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
/** A section as it plays (with no song yet, the page is section A). */
const sectionAt = (p: Progression, blockId: string) => (p.song ? sections(p).find((s) => s.blockId === blockId) : blockId ? undefined : soloSection(p));

/** Everything in one section, ready to paste into another (in this idea or another one). */
export function copySection(p0: Progression, blockId: string, key: Key, idea: string | null = null): SectionClip | null {
  const p = conform(commit(normalize(p0)));
  const sec = sectionAt(p, blockId);
  if (!sec) return null;
  const tracks = (p.tracks ?? []).flatMap((t): Track[] => {
    if (t.kind !== "vocals") return sec.layers?.[t.id] ? [t] : [];
    // the recordings made in this section, each with every take of it and the one chosen
    const groups = groupsOf(t.takes).filter((g) => (t.takes ?? []).some((k) => k.group === g && k.at.block === sec.blockId));
    if (!groups.length) return [];
    const active = Object.fromEntries(Object.entries(t.active ?? {}).filter(([g]) => groups.includes(g)));
    const takes = (t.takes ?? []).filter((k) => groups.includes(k.group));
    // what plays of them, as edited
    const clips = clipsOf(t).filter((c) => takes.some((k) => k.id === c.take));
    return [{ ...t, takes, active, clips }];
  });
  const settings: Settings = tidy({ groove: sec.groove });
  const tones: Tones = Object.fromEntries(tracks.filter((t) => p.tones?.[t.id]).map((t) => [t.id, p.tones![t.id]]));
  return clone({ from: sec.label, key, block: sec.blockId, part: sec.partId || undefined, idea, meter: sec.meter ?? sigOf(p), bars: barsOr(sec.bars), chords: sec.chords, melody: sec.melody, settings, layers: sec.layers, tracks, ...(Object.keys(tones).length ? { tones } : {}) });
}

/**
 * Is a row the section a copy was taken from: the very block (`exact`), or any block of the same
 * section? Only in the idea it was copied in (`idea`: see ui/openidea), as rows in another idea
 * can be called the same.
 */
export function clipSource(c: SectionClip | undefined, idea: string | null, row: { blockId: string; partId: string }, exact = false): boolean {
  if (!c || c.idea !== idea) return false;
  return c.block === row.blockId || (!exact && !!c.part && c.part === row.partId);
}

/** Is anything written in a section: chords, notes, drums of its own, recordings? (Pasting over it asks first.) */
export function sectionHasContent(p0: Progression, blockId: string): boolean {
  const p = commit(normalize(p0));
  const sec = sectionAt(p, blockId);
  if (!sec) return false;
  const ls = Object.values(sec.layers ?? {});
  if ([sec.chords, ...ls.map((l) => l.chords ?? [])].some((cs) => cs.some((c) => !c.rest))) return true;
  if ([sec.melody, ...ls.map((l) => l.melody)].some((m) => !!m?.notes.length)) return true;
  if (ls.some((l) => l.beat?.on)) return true;
  // drums of its own (the first section's are the song's, so they are its own too)
  const part = p.song?.parts.find((x) => x.id === sec.partId);
  if (sec.groove?.on && (!p.song || p.song.parts[0] === part || !!part?.groove)) return true;
  return (p.tracks ?? []).some((t) => t.kind === "vocals" && (t.takes ?? []).some((k) => k.at.block === sec.blockId));
}

/**
 * A copied section goes into another, in place of everything that section had (every block of
 * it changes, as an edit there would; the recordings go into this block only). Its name and
 * colour stay; its length and time signature become the copy's. The tracks it had are found by
 * id, or by kind and name in another idea, and made if they are missing. In another key the
 * chords and melodies move to this one.
 */
function pasteSectionN(p0: Progression, blockId: string, c: SectionClip, key: Key, id: () => string = uid): Progression {
  // with no song yet the page becomes section A
  const p = conform(p0.song?.blocks.length ? p0 : ensureSong(p0, id));
  const target = blockId || p.song!.current;
  if (!p.song!.blocks.some((b) => b.id === target)) return p0;

  // the copy's tracks, here
  const tracks = [...(p.tracks ?? [])];
  const to = new Map<string, string>();
  /** the tracks the paste made */
  const made = new Set<string>();
  for (const t of c.tracks) {
    const free = (x: Track) => x.kind === t.kind && ![...to.values()].includes(x.id);
    const same = tracks.find((x) => x.id === t.id && free(x)) ?? tracks.find((x) => x.name === t.name && free(x));
    if (same) {
      to.set(t.id, same.id);
      continue;
    }
    const nid = isFirst(t.id) || tracks.some((x) => x.id === t.id) ? id() : t.id;
    const { takes: _t, active: _a, clips: _c, ...rest } = t;
    tracks.push({ ...clone(rest), id: nid });
    made.add(nid);
    to.set(t.id, nid);
  }

  // another key: the chords move by as much as the home note, the melodies by the same amount (so they stay together)
  const n = keyShift(c.key, key);
  const chordsOf = (cs: ProgChord[]) => clone(cs).map((x) => (n ? { ...x, id: id(), ref: transposeRef(x.ref, n, key), voicingId: undefined } : { ...x, id: id() }));
  const tunes = [c.melody, ...Object.values(c.layers ?? {}).map((l) => l.melody)].filter((m): m is Melody => !!m);
  const by = n && tunes.length ? melodyShift({ div: 2, bars: 1, notes: tunes.flatMap((m) => m.notes) }, c.key, key) : 0;
  const tuneOf = (m: Melody | undefined) => (m ? (by ? transposeMelody(clone(m), by) : clone(m)) : undefined);
  const layers: Layers = {};
  for (const [tid, l] of Object.entries(c.layers ?? {})) {
    const into = to.get(tid);
    if (!into) continue;
    layers[into] = tidy<Layer>({ chords: l.chords && chordsOf(l.chords), melody: tuneOf(l.melody), beat: l.beat && clone(l.beat) });
  }
  const q = replaceSection({ ...p, tracks: tracks.length ? tracks : undefined }, target, {
    chords: chordsOf(c.chords), melody: tuneOf(c.melody), bars: c.bars, meter: c.meter, layers: Object.keys(layers).length ? layers : undefined, settings: clone(c.settings),
  });

  // the recordings: what was sung in this block makes way, the copy's come in as recordings of their own (the files are shared)
  const vocals = (q.tracks ?? []).map((t) => {
    if (t.kind !== "vocals") return t;
    const takes = (t.takes ?? []).filter((k) => k.at.block !== target);
    const active: Record<string, string> = Object.fromEntries(Object.entries(t.active ?? {}).filter(([g]) => takes.some((k) => k.group === g)));
    const clips = clipsOf(t).filter((c) => takes.some((k) => k.id === c.take));
    for (const ct of c.tracks) {
      if (ct.kind !== "vocals" || to.get(ct.id) !== t.id) continue;
      const groups = new Map<string, string>();
      const ids = new Map<string, string>();
      for (const k of ct.takes ?? []) {
        if (!groups.has(k.group)) groups.set(k.group, id());
        ids.set(k.id, id());
        takes.push({ ...clone(k), id: ids.get(k.id)!, group: groups.get(k.group)!, at: { block: target, bar: k.at.bar } });
      }
      for (const [g, k] of Object.entries(ct.active ?? {})) if (groups.has(g) && ids.has(k)) active[groups.get(g)!] = ids.get(k)!;
      // the copy's clips, on its takes here
      for (const c of clipsOf(ct)) if (ids.has(c.take)) clips.push({ ...clone(c), id: id(), take: ids.get(c.take)! });
    }
    return tidy({ ...t, takes: takes.length ? takes : undefined, active: Object.keys(active).length ? active : undefined, clips: takes.length ? clips : undefined });
  });
  const part = q.song?.blocks.find((b) => b.id === target)?.partId;
  const harmonies = part ? vocals.map((t) => harmonyAfterPaste(t, c, to, made, part, vocals)) : vocals;
  // a track the paste made plays the instrument it played there, and one that played instead of chords there does here too (they are muted)
  let tones = q.tones;
  let mix = q.mix;
  // (a mute is for the whole song, and the pasted track plays only in this section: where those chords
  // are heard in another section they are left playing, and writing the harmony again mutes them)
  const others = commit(normalize(q)).song?.parts.filter((x) => x.id !== part) ?? [];
  const elsewhere = (tid: string) => others.some((x) => (tid === "chords" ? x.chords : x.layers?.[tid]?.chords)?.some((ch) => !ch.rest && ch.beats > 0));
  for (const [from, nid] of to) {
    if (!made.has(nid)) continue;
    const tone = c.tones?.[from];
    if (tone) tones = { ...tones, [nid]: clone(tone) };
    const t = harmonies.find((x) => x.id === nid);
    const replaced = t && insteadTarget(t, harmonies);
    if (replaced && !elsewhere(replaced)) mix = muteInstead(mix, replaced);
  }
  return { ...q, tracks: harmonies.length ? harmonies : undefined, ...(tones ? { tones } : {}), ...(mix ? { mix } : {}) };
}

/**
 * A harmony track after a section was pasted: one made by the paste is written from the same
 * track here as it was there (or from nothing, when that track did not come along). What the
 * section now holds is what the copied one held, so it takes that section's fingerprint: then
 * writing the harmony again later knows whether those notes were changed by hand. Where the
 * copy's harmony was written another way, the section counts as changed by hand (it is asked about).
 */
function harmonyAfterPaste(t: Track, c: SectionClip, to: Map<string, string>, made: Set<string>, part: string, tracks: Track[]): Track {
  const ct = c.tracks.find((x) => to.get(x.id) === t.id);
  if (!t.harmony || !ct) return t;
  /** the copy's source, as it is called here */
  const here = (id: string | undefined) => (id === undefined ? undefined : isFirst(id) ? id : to.get(id) ?? (tracks.some((x) => x.id === id) ? id : undefined));
  const fresh = made.has(t.id);
  const from = fresh ? here(t.harmony.from) : t.harmony.from;
  if (!from || (!isFirst(from) && !tracks.some((x) => x.id === from))) return forget(t, tracks);
  const same = !!ct.harmony && ct.harmony.option === t.harmony.option && here(ct.harmony.from) === from;
  // (a copy of a page with no sections yet: its record is the page's)
  const mark = same ? ct.harmony?.marks?.[c.part ?? ""] : undefined;
  const { [part]: _, ...others } = fresh ? {} : t.harmony.marks ?? {};
  const marks = mark ? { ...others, [part]: mark } : others;
  return { ...t, harmony: { from, option: t.harmony.option, ...(Object.keys(marks).length ? { marks } : {}) } };
}
export const pasteSection = settled(pasteSectionN);

/** The fields of the page that a paste replaces: music only (each track keeps its own sound). */
export function pastePart(p: Progression, kind: ClipKind): Partial<Progression> {
  return kind === "rhythm" ? { chords: p.chords } : kind === "melody" ? { melody: p.melody } : { beat: p.beat };
}
/** What taking a paste back puts on the page: the music from before (drums: only the rhythm and on/off; the kit stays as it is now). */
export function unpastePart(now: Progression, before: Partial<Progression>): Partial<Progression> {
  return before.beat ? { beat: { ...(now.beat ?? DEFAULT_BEAT), ...grooveOf(before.beat) } } : before;
}

/** What a page held before a paste, for the section and the track it was pasted into, while it can be taken back. */
export interface PasteUndo {
  block: string;
  track: string;
  before: Partial<Progression>;
  /** how that track was last written, when it is a harmony track (see `writtenAs`) */
  written?: string;
}
/**
 * Can a paste be taken back here? Only in the section and on the track it was pasted into: the
 * page's fields hold whichever track is brought forward, so taken back on another track it would
 * write the old music over that track's. Nor once a harmony track was written again since
 * (`written`, as `writtenAs` has it now): the old music would go back over the new in this section only.
 */
export function undoFits(u: PasteUndo | null, block: string, track: string, written = ""): u is PasteUndo {
  return !!u && u.block === block && u.track === track && (u.written ?? "") === written;
}

/** Is there anything on this page of the section on screen? (Pasting over it can be undone.) */
export function hasPart(p: Progression, kind: ClipKind): boolean {
  if (kind === "rhythm") return p.chords.length > 0;
  if (kind === "melody") return !!p.melody?.notes.length;
  return !!p.beat?.on;
}

/** Does some of this page lie past the end of a section `frame` beats long? (That part does not play.) */
export function pastFrame(p: Progression, kind: ClipKind, frame: number): boolean {
  if (kind === "rhythm") {
    let at = 0;
    for (const c of p.chords) {
      if (at >= frame - 1e-6 && !c.rest) return true;
      at += c.beats;
    }
    return false;
  }
  if (kind === "melody") return !!p.melody?.notes.some((x) => x.at >= Math.round(frame * TICKS));
  return false;
}

/** Clipboards loaded from storage, made safe (anything broken is dropped). */
export function reviveClips(raw: unknown): Clips {
  const r = (raw ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const base = (x: Record<string, unknown> | undefined): ClipBase | null => {
    const k = x?.key as Key | undefined;
    return x && typeof x.from === "string" && k && typeof k.tonic === "string" && typeof k.scaleId === "string" ? { from: x.from, key: { tonic: k.tonic, scaleId: k.scaleId }, ...(typeof x.bar === "number" && x.bar > 0 ? { bar: x.bar } : {}) } : null;
  };
  const out: Clips = {};
  const chordsOf = (raw: unknown) => (raw as ProgChord[]).filter((c) => !!c && typeof c.id === "string" && !!c.ref && typeof c.ref.root === "string" && typeof c.ref.typeId === "string" && Number.isFinite(c.beats) && c.beats > 0);
  const rh = r.rhythm;
  const rb = base(rh);
  // (a clipboard from before held the sound too: it is let go)
  if (rb && Array.isArray(rh!.chords)) out.rhythm = { ...rb, chords: chordsOf(rh!.chords) };
  // a whole section: its tracks first, so only parts of tracks it has are kept (one from before: its tracks keep the sound they played there)
  const se = migrateSectionClip(r.section);
  const sb = base(se);
  const meter = reviveSig(se?.meter);
  if (sb && se && meter && typeof se.block === "string" && Array.isArray(se.chords)) {
    const tracks = reviveTracks(se.tracks) ?? [];
    out.section = tidy({
      ...sb, block: se.block, part: typeof se.part === "string" ? se.part : undefined, idea: typeof se.idea === "string" ? se.idea : null, meter, bars: barsOr(se.bars), chords: chordsOf(se.chords), melody: reviveMelody(se.melody),
      settings: reviveSettings(se.settings as Settings | undefined), layers: reviveLayers(se.layers, tracks), tracks, tones: reviveTones(se.tones, tracks.map((t) => t.id)),
    });
  }
  const me = r.melody;
  const mb = base(me);
  if (mb && me) out.melody = { ...mb, melody: reviveMelody(me.melody) ?? null };
  const dr = r.drums;
  const db = base(dr);
  const beat = db ? reviveBeat(dr!.beat) : undefined;
  if (db && beat) out.drums = { ...db, beat };
  return out;
}
