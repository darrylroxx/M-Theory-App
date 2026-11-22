// The lens: one clip of a song of tracks and clips, shown to the old pages as an old song with one section.
//
// The old Chords, Melody and Drums pages were written against "the section on screen". So that they can be used as
// they are, a clip (or a track with nothing on it yet, or what is being composed on a track) is presented to them as a
// small old song with no sections: the open track's content is the page's, the song's lead chords under the clip are
// the old first chords track (the old code reads that one as "the song's chords"), and every other chords, melody
// and bass track is there with its music under the clip, so Harmonize sees what it can go with. `unlens` reads what
// the old code changed in that small song and writes it back into the real one.
//
// (Vocal tracks are never put behind a lens.)
import { grooveOf, kitOfBeat, kitSig, onKit, type Beat } from "../audio/beats";
import type { Mix, TrackMix } from "../audio/mix";
import { toneOf, type Tone, type Tones } from "../audio/tone";
import { barsOr } from "../song/frame";
import { harmonyState, remarkHarmony, type HarmonyState } from "../song/harmony";
import type { Melody, MelodyNote } from "../song/melody";
import { SOUND_V } from "../song/migrate";
import { sigBeats, type TimeSig } from "../song/meter";
import { PLAIN_STYLE, hasMusic, insteadHere, normalize, refocus, type FirstHarmony, type HarmonyOf, type Layer, type Layers, type Track as OldTrack } from "../song/tracks";
import { conform } from "../song/unity";
import type { Key } from "../theory/keys";
import type { ProgChord, Progression } from "../ui/state";
import { barMap } from "./bars";
import { barOwner, drumsClipsOf, leadDrums } from "./cuts";
import { blankContent, layDown, resizeClip, setContent, setDraft, transpose } from "./edit";
import { beatOf } from "./flatten";
import { CLIP_OF, contentBeats, cycles } from "./model";
import type { ChordsClip, ChordsContent, ChordsTrack, Clip, ClipKind, DrumsClip, DrumsTrack, HarmonyMark5, MelodyClip, NoteClip, Region, TimelineSong, Track, TuneTrack } from "./model";

/** What a window is on: a placed clip; or a track with nothing on it yet (`fresh`: where the first thing written will lie); or, with neither, what is being composed on the track. */
export interface Target { track: string; clip?: string; fresh?: { id: string; at: number; sig: TimeSig } }
/**
 * The small old song, the stretch of the real song it stands for, and the real tracks behind the old first tracks:
 * `lead` behind the first chords track (the song's lead chords under the stretch; null: the song has no lead chords
 * track), `melody` behind the first melody track (the song's top melody track; null: it has none).
 */
export interface Lens { p: Progression; span: Region; lead: string | null; melody: string | null }

const EPS = 1e-6;
const tidy = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
type NoteTrack = ChordsTrack | TuneTrack | DrumsTrack;
const isNoteTrack = (t: Track | undefined): t is NoteTrack => !!t && t.kind !== "vocals" && t.kind !== "audio";
const overlaps = (c: Clip, span: Region) => c.kind !== "audio" && c.start < span.to - EPS && c.start + c.len > span.from + EPS;

// ── what lies under a stretch of the song ───────────────────

/** A track's unmuted clips that reach into a stretch, in the order they start. */
function clipsUnder<C extends NoteClip>(song: TimelineSong, track: string, span: Region): C[] {
  return (song.clips.filter((c) => c.track === track && !c.mute && overlaps(c, span)) as C[]).sort((a, b) => a.start - b.start);
}
/** Is a stretch exactly one round of a clip's content, all of it inside the clip? Then the content itself is what lies under it. */
const wholeRound = (c: NoteClip, span: Region): boolean =>
  Math.abs(span.to - span.from - contentBeats(c)) < EPS && Math.abs(((span.from - (c.start - c.off)) / contentBeats(c)) % 1) < EPS && c.start <= span.from + EPS && c.start + c.len >= span.to - EPS;

/** The chords of a chords track under a stretch, as one run from the stretch's start: rests where it has none (none after its last chord). */
function chordsOver(song: TimelineSong, track: string, span: Region): ProgChord[] {
  const clips = clipsUnder<ChordsClip>(song, track, span);
  if (clips.length === 1 && wholeRound(clips[0], span)) return clips[0].content.chords;
  const out: ProgChord[] = [];
  let at = span.from;
  const rest = (to: number) => {
    // (a chord, and so a rest, is 16 beats long at most)
    for (let left = to - at; left > EPS; left -= 16) out.push({ id: `rest-${at}-${out.length}`, ref: { root: "C", typeId: "maj" }, beats: Math.min(16, left), rest: true });
    at = to;
  };
  for (const c of clips) {
    const size = contentBeats(c);
    const inside: { a: number; b: number; ch: ProgChord }[] = [];
    let x = 0;
    for (const ch of c.content.chords) {
      if (x >= size - EPS) break;
      inside.push({ a: x, b: Math.min(size, x + ch.beats), ch });
      x += ch.beats;
    }
    cycles(c).forEach((cy, round) => {
      const base = c.start + cy.at - cy.from;
      for (const k of inside) {
        const a = Math.max(base + Math.max(k.a, cy.from), span.from, at);
        const b = Math.min(base + Math.min(k.b, cy.to), span.to);
        if (b - a < EPS) continue;
        if (a > at + EPS) rest(a);
        out.push({ ...k.ch, id: round ? `${k.ch.id}~${round}` : k.ch.id, beats: b - a });
        at = b;
      }
    });
  }
  return out;
}

/** The notes of a melody or bass track under a stretch, counted from the stretch's start. */
function melodyOver(song: TimelineSong, track: string, span: Region, sig: TimeSig): Melody | undefined {
  const clips = clipsUnder<MelodyClip>(song, track, span);
  if (!clips.length) return undefined;
  if (clips.length === 1 && wholeRound(clips[0], span)) return clips[0].content;
  const len = Math.round((span.to - span.from) * 12);
  const notes: MelodyNote[] = [];
  for (const c of clips)
    for (const cy of cycles(c)) {
      const base = Math.round((c.start + cy.at - cy.from - span.from) * 12);
      for (const n of c.content.notes) {
        const at = base + n.at;
        if (n.at >= Math.round(cy.from * 12) && n.at < Math.round(cy.to * 12) && at >= 0 && at < len) notes.push({ ...n, at });
      }
    }
  notes.sort((a, b) => a.at - b.at || a.midi - b.midi);
  return { div: clips[0].content.div, bars: Math.max(1, Math.round((span.to - span.from) / sigBeats(sig))), notes };
}

/** The drums track the others follow under a stretch (the topmost lead drums track with a rhythm there), with its rhythm written out over the stretch. */
function leadBeat(song: TimelineSong, span: Region, sig: TimeSig): { track: DrumsTrack; beat: Beat } | undefined {
  const bar = sigBeats(sig);
  for (const id of leadDrums(song)) {
    const t = song.tracks.find((x) => x.id === id) as DrumsTrack;
    const clips = drumsClipsOf(song, id).filter((c) => overlaps(c, span));
    if (!clips.length || !barOwner(clips, span.from, span.from + bar)) continue;
    const beat = beatOf(t.kit, clips, { from: span.from, to: span.to, bar, bars: Math.max(1, Math.round((span.to - span.from) / bar)) });
    if (beat) return { track: t, beat: { ...beat, name: clips[0].content.name, patternId: clips[0].content.patternId, edited: !!clips[0].content.edited } };
  }
  return undefined;
}

/** The chords track the song's pulse follows under a stretch: the topmost lead chords track with a clip there, else the topmost lead chords track. */
function leadChords(song: TimelineSong, span: Region): ChordsTrack | undefined {
  const leads = song.tracks.filter((t): t is ChordsTrack => t.kind === "chords" && !!t.lead);
  return leads.find((t) => clipsUnder(song, t.id, span).length > 0) ?? leads[0];
}

/**
 * The melody track the old code reads as "the song's melody" under a stretch (a chords harmony is checked against it):
 * the song's top melody track, or, where conversion split that row by sound, the one of its tracks with a clip there.
 */
function leadMelody(song: TimelineSong, span: Region): TuneTrack | undefined {
  const top = song.tracks.find((t): t is TuneTrack => t.kind === "melody");
  if (!top) return undefined;
  const row = song.tracks.filter((t): t is TuneTrack => t.kind === "melody" && (t === top || (!!t.group && t.group === (top.group ?? top.id))));
  return row.find((t) => clipsUnder(song, t.id, span).length > 0) ?? top;
}

/**
 * The chords that sound under a stretch of the song: the lead chords track's, or those of a clip that plays instead of
 * it there (while that clip's track is not muted and it has a chord that sounds). What the old code's `chordsUnder`
 * gives for the lens song of that stretch.
 */
export function chordsUnderSpan(song: TimelineSong, span: Region): ProgChord[] {
  const lead = leadChords(song, span);
  if (!lead) return [];
  const by = song.clips.find((c) => c.kind === "chords" && !c.mute && c.instead === lead.id && overlaps(c, span) && !song.mix?.[c.track]?.mute && c.content.chords.some((x) => !x.rest));
  return chordsOver(song, by ? by.track : lead.id, span);
}

// ── the lens ────────────────────────────────────────────────

/** What a target opens on: the track, its clip if it has one, the content shown, the signature it is written in, and the stretch of the song it stands for. */
interface Open { track: NoteTrack; clip?: NoteClip; content: NoteClip["content"]; sig: TimeSig; span: Region; mute: boolean }
function openOf(song: TimelineSong, target: Target, anchor: number): Open | null {
  const track = song.tracks.find((t) => t.id === target.track);
  if (!isNoteTrack(track)) return null;
  const kind = CLIP_OF[track.kind];
  if (target.clip !== undefined) {
    const clip = song.clips.find((c) => c.id === target.clip);
    if (!clip || clip.kind === "audio" || clip.track !== track.id) return null;
    const size = contentBeats(clip);
    // one round of the content: the first that starts inside the clip, else the one its left edge lies in
    const first = clip.off === 0 ? clip.start : clip.start + (size - clip.off);
    const from = first < clip.start + clip.len - EPS ? first : clip.start - clip.off;
    return { track, clip, content: clip.content, sig: clip.sig, span: { from, to: from + size }, mute: !!clip.mute };
  }
  if (target.fresh) {
    // nothing on the track yet: four bars, where the first thing written will lie
    const sig = target.fresh.sig;
    const blank = blankFor(kind, sig);
    return { track, content: blank, sig, span: { from: target.fresh.at, to: target.fresh.at + FRESH_BARS * sigBeats(sig) }, mute: false };
  }
  const sig = track.draft?.sig ?? barMap(song).sigAt(anchor);
  const content = track.draft?.content ?? blankFor(kind, sig);
  const bars = kind === "drums" ? Math.max(1, (content as DrumsClip["content"]).bars ?? 1) : (content as ChordsContent | Melody).bars;
  return { track, content, sig, span: { from: anchor, to: anchor + bars * sigBeats(sig) }, mute: false };
}
const blanks = new Map<string, NoteClip["content"]>();
/**
 * The same empty content for the same kind and signature, every time. A track with nothing in it yet must show the
 * same one-section song each time it is asked for, or what is written into it "while nothing else changed" (a kept
 * harmony) would never be written.
 */
function blankFor(kind: ClipKind, sig: TimeSig): NoteClip["content"] {
  const k = `${kind}|${sig.num}/${sig.den}`;
  let b = blanks.get(k);
  if (!b) blanks.set(k, (b = blankContent(kind, sig)));
  return b;
}

/** How long the first clip of an empty track is, in bars. */
const FRESH_BARS = 4;

/** The real tracks behind the old first chords and melody tracks. */
type Firsts = { lead: string | null; melody: string | null };
/** A real track's id as the lens song names it: the lead chords track is the old first chords track, the top melody track the old first melody track. */
const lensId = (f: Firsts, id: string): string => (id === f.lead ? "chords" : id === f.melody ? "melody" : id);
const realId = (f: Firsts, id: string): string | null => (id === "chords" ? f.lead : id === "melody" ? f.melody : id === "drums" ? null : id);

/** A clip's harmony record as the old code keeps it for its one section. */
function harmonyOfClip(t: ChordsTrack | TuneTrack, mark: HarmonyMark5 | undefined, instead: string | undefined, lead: Firsts): Pick<OldTrack, "harmony" | "replaces" | "replacesIn"> {
  if (mark) {
    // (written to replace chords, but it does not here: it plays along)
    const along = mark.along || (t.kind === "chords" && !instead && replaces(mark.option)) ? { along: true as const } : {};
    const h: HarmonyOf = { from: lensId(lead, t.harmony?.from ?? mark.from), option: t.harmony?.option ?? mark.option, marks: { "": tidy({ src: mark.src, out: mark.out, option: mark.option, from: lensId(lead, mark.from), shape: mark.shape, ...along }) } };
    return { harmony: h };
  }
  if (t.harmony) return { harmony: { from: lensId(lead, t.harmony.from), option: t.harmony.option, marks: {} } };
  // it plays instead of chords with no record of what it was written from
  return instead ? { replaces: lensId(lead, instead), replacesIn: [""] } : {};
}
/** Does a chords option play instead of the chords it goes with? (As the old code asks it, through a track that has it.) */
const replaces = (option: string): boolean => insteadHere({ id: "x", kind: "chords", name: "", harmony: { from: "chords", option, marks: { "": { src: "", out: "", option } } } }, [], "") !== undefined;

const kept = new Map<string, { deps: unknown[]; lens: Lens | null }>();

/**
 * One clip (or what is being composed on a track, placed at `anchor`) as a one-section old song. null: the clip or its
 * track is gone, or the track is a recorded one. The same object comes back while the clip, its track, the key and
 * everything it read under the stretch are the same objects.
 */
export function lensOf(song: TimelineSong, target: Target, key: Key, anchor: number): Lens | null {
  const open = openOf(song, target, anchor);
  if (!open) return null;
  const span = open.span;
  const lead: Firsts = { lead: leadChords(song, span)?.id ?? null, melody: leadMelody(song, span)?.id ?? null };
  // what it reads: every chords, melody and bass track with its clips under the stretch, the drums the others follow, the mixer entries of those
  const read = song.tracks.filter((t) => t === open.track || t.kind === "chords" || t.kind === "melody" || t.kind === "bass" || (t.kind === "drums" && t.lead));
  const under = song.clips.filter((c) => !c.mute && overlaps(c, span) && read.some((t) => t.id === c.track));
  const deps: unknown[] = [key, song.bpm, span.from, span.to, target.fresh?.at, open.clip ?? open.content, ...read, ...under, ...read.map((t) => song.mix?.[t.id])];
  const k = `${target.track}|${target.clip ?? ""}|${target.fresh?.id ?? ""}`;
  const was = kept.get(k);
  if (was && was.deps.length === deps.length && was.deps.every((d, i) => d === deps[i])) return was.lens;

  const sig = open.sig;
  const bars = Math.max(1, Math.round((span.to - span.from) / sigBeats(sig)));
  const openId = lensId(lead, open.track.id);
  const tracks: OldTrack[] = [];
  const layers: Layers = {};
  const tones: Tones = {};
  const mix: Mix = {};
  const firstHarmony: FirstHarmony = {};
  let page: Partial<Progression> = { chords: [], pattern: PLAIN_STYLE, arrange: null };
  const markOf = (t: Track): { mark?: HarmonyMark5; instead?: string } => {
    const c = t === open.track ? open.clip : clipsUnder<NoteClip>(song, t.id, span).find((x) => x.kind !== "drums" && (x.harmony || (x.kind === "chords" && x.instead)));
    return c && c.kind !== "drums" ? { mark: c.harmony, instead: c.kind === "chords" ? c.instead : undefined } : {};
  };
  for (const t of song.tracks) {
    if (t.kind === "vocals" || t.kind === "audio") continue;
    const id = lensId(lead, t.id);
    const mine = t === open.track;
    if (song.mix?.[t.id] && (mine || t.kind !== "drums")) mix[id] = song.mix[t.id];
    if (t.kind === "chords") {
      const c = mine ? (open.content as ChordsContent) : undefined;
      const first = clipsUnder<ChordsClip>(song, t.id, span)[0]?.content;
      const layer: Layer = tidy({ chords: c ? c.chords : chordsOver(song, t.id, span), arrange: (c ?? first)?.arrange, pattern: (c ?? first)?.style ?? PLAIN_STYLE, feel: (c ?? first)?.feel, sound: t.sound });
      tones[id] = t.tone;
      const h = harmonyOfClip(t, markOf(t).mark, markOf(t).instead, lead);
      if (id === "chords") {
        page = { ...page, chords: layer.chords ?? [], arrange: layer.arrange ?? null, pattern: layer.pattern ?? PLAIN_STYLE, feel: layer.feel, sound: layer.sound };
        if (h.harmony) firstHarmony.chords = h.harmony;
      } else {
        tracks.push(tidy({ id, kind: "chords" as const, name: t.name, role: t.role, ...h }));
        layers[id] = layer;
      }
    } else if (t.kind === "melody" || t.kind === "bass") {
      const m = mine ? ({ ...(open.content as Melody), ...(open.mute ? { on: false } : {}) } as Melody) : melodyOver(song, t.id, span, sig);
      tones[id] = t.tone;
      const h = harmonyOfClip(t, markOf(t).mark, undefined, lead);
      if (id === "melody") {
        page = { ...page, melody: m, tuneSound: t.sound };
        if (h.harmony) firstHarmony.melody = h.harmony;
      } else {
        tracks.push(tidy({ id, kind: "melody" as const, name: t.name, role: t.role, ...h }));
        layers[id] = tidy({ melody: m, tuneSound: t.sound });
      }
    } else if (mine && t.kind === "drums") {
      tracks.push({ id, kind: "drums", name: t.name });
      layers[id] = { beat: onKit({ ...(open.content as DrumsClip["content"]), on: !open.mute } as Beat, t.kit) };
    }
  }
  // the old first drums track: the drums the others follow under the stretch (not when those are the open track's: they are its own)
  const drums = leadBeat(song, span, sig);
  if (drums && drums.track !== open.track) page.beat = drums.beat;
  const flat: Progression = tidy({
    chords: page.chords ?? [], bpm: song.bpm, pattern: page.pattern ?? PLAIN_STYLE, loop: true, arrange: page.arrange ?? null, beat: page.beat, feel: page.feel, sound: page.sound, melody: page.melody, tuneSound: page.tuneSound,
    bars, play: "section" as const, song: null, meter: sig, v: SOUND_V,
    mix: Object.keys(mix).length ? mix : undefined, tracks: tracks.length ? tracks : undefined, layers: Object.keys(layers).length ? layers : undefined,
    firstHarmony: Object.keys(firstHarmony).length ? firstHarmony : undefined, tones,
  });
  // the open track is brought forward, as the old pages have the track they edit (a first track is in front already)
  const kind = CLIP_OF[open.track.kind] as "chords" | "melody" | "drums";
  const p = openId === "chords" || openId === "melody" ? flat : refocus(flat, { [kind]: openId });
  const lens: Lens = { p, span, lead: lead.lead, melody: lead.melody };
  kept.delete(k);
  kept.set(k, { deps, lens });
  if (kept.size > 64) kept.delete(kept.keys().next().value!);
  return lens;
}

// ── writing back ────────────────────────────────────────────

/** A track's part of the lens song with everything in its place: its layer, or the page for the first chords track. */
function layerIn(q: Progression, id: string): Layer | undefined {
  if (id === "chords") return tidy({ chords: q.chords, arrange: q.arrange ?? undefined, pattern: q.pattern, feel: q.feel, sound: q.sound });
  if (id === "melody") return tidy({ melody: q.melody, tuneSound: q.tuneSound });
  return q.layers?.[id];
}
const harmonyIn = (q: Progression, id: string): HarmonyOf | undefined => (id === "chords" || id === "melody" ? q.firstHarmony?.[id] : q.tracks?.find((t) => t.id === id)?.harmony);

/** The record a clip carries of what Harmonize wrote, from the old code's record of its one section. */
function markFrom(q: Progression, id: string, lead: Firsts): HarmonyMark5 | undefined {
  const h = harmonyIn(q, id);
  const m = h?.marks?.[""];
  if (!h || !m) return undefined;
  const from = realId(lead, m.from ?? h.from);
  return from ? tidy({ from, option: m.option ?? h.option, shape: m.shape, src: m.src, out: m.out, along: m.along }) : undefined;
}
/** The real chords track a lens track plays instead of, as the old code says it does in its one section. */
function insteadFrom(q: Progression, id: string, lead: Firsts): string | undefined {
  const t = q.tracks?.find((x) => x.id === id);
  const target = t ? insteadHere(t, q.tracks ?? [], "") : undefined;
  return (target && realId(lead, target)) || undefined;
}

/** A layer as a clip's content (the clip's kind says which part of it). */
function contentFrom(l: Layer | undefined, kind: "chords" | "melody" | "drums", bars: number): { content: NoteClip["content"]; mute: boolean } | null {
  if (kind === "chords") return { content: tidy({ chords: l?.chords ?? [], bars, style: l?.pattern ?? PLAIN_STYLE, feel: l?.feel, arrange: l?.arrange }), mute: false };
  if (kind === "melody") {
    if (!l?.melody) return null;
    const { on, ...m } = l.melody;
    return { content: { ...m, bars }, mute: on === false };
  }
  if (!l?.beat) return null;
  const { on, ...g } = grooveOf(l.beat);
  return { content: g, mute: on === false };
}
const isEmpty = (content: NoteClip["content"], kind: "chords" | "melody" | "drums"): boolean =>
  kind === "chords" ? !(content as ChordsContent).chords.length : kind === "melody" ? !(content as Melody).notes.length : !Object.values((content as DrumsClip["content"]).rows ?? {}).some((r) => /[1-9]/.test(r ?? ""));

const setOn = (song: TimelineSong, id: string, fn: (t: Track) => Track): TimelineSong => {
  const i = song.tracks.findIndex((t) => t.id === id);
  if (i < 0) return song;
  const next = fn(song.tracks[i]);
  return next === song.tracks[i] ? song : { ...song, tracks: song.tracks.map((t, k) => (k === i ? next : t)) };
};
/** A track with fields set where they differ (undefined takes a field off). The same track back when nothing differs. */
function patched(t: Track, patch: Record<string, unknown>): Track {
  const now = t as unknown as Record<string, unknown>;
  const next = { ...now };
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (same(now[k], v)) continue;
    if (v === undefined) delete next[k];
    else next[k] = v;
    changed = true;
  }
  return changed ? (next as unknown as Track) : t;
}

/**
 * What the old code changed in the lens song, written back into the real song. `after` is the lens song as it is now;
 * it is first put in order the old way (every track in its place, drum rhythms fitted to the clip's bars). Then:
 *  1. the open track's content goes to its clip (or to what is being composed), its sound, instrument or kit to the
 *     track; with nothing on the track yet, the first thing written makes the clip;
 *  2. a track added inside (Harmonize into a new track) becomes a real track below the open one, with a clip over the stretch;
 *  3. a track that was empty under the stretch and now has music gets a clip over the stretch;
 *  4. "plays instead" becomes the clip's `instead` (the old first chords track is the real lead chords track);
 *  5. a change of the mixer made inside goes to the real mixer;
 *  6. a change to another track that already had music under the stretch is ignored.
 * The same song comes back when nothing changed.
 */
export function unlens(song: TimelineSong, target: Target, lens: Lens, after: Progression, id: () => string): TimelineSong {
  const before = normalize(lens.p);
  const q = conform(normalize(after));
  const { span } = lens;
  const lead: Firsts = { lead: lens.lead, melody: lens.melody };
  const open = song.tracks.find((t) => t.id === target.track);
  if (!isNoteTrack(open)) return song;
  const kind = CLIP_OF[open.kind] as "chords" | "melody" | "drums";
  const openId = lensId(lead, open.id);
  const sig = q.meter ?? lens.p.meter!;
  const bars = barsOr(q.bars);
  let out = song;

  // 1. the open track: how it sounds
  const l = layerIn(q, openId);
  const was = layerIn(before, openId);
  if (kind === "drums") {
    const kit = l?.beat ? kitOfBeat(l.beat) : undefined;
    if (kit && kitSig(kit) !== kitSig((open as DrumsTrack).kit)) out = setOn(out, open.id, (t) => ({ ...t, kit }) as Track);
  } else {
    const sound = kind === "chords" ? l?.sound : l?.tuneSound;
    const tone: Tone = toneOf(q, openId);
    out = setOn(out, open.id, (t) => patched(t, { ...(same(sound, kind === "chords" ? was?.sound : was?.tuneSound) ? {} : { sound }), ...(same(tone, toneOf(before, openId)) ? {} : { tone }) }));
  }
  // … and what it holds
  const made = contentFrom(l, kind, bars);
  const old = contentFrom(was, kind, barsOr(before.bars));
  let openClip: string | undefined = target.clip;
  if (made && !same(made, old)) {
    if (target.clip !== undefined) {
      const c = out.clips.find((x) => x.id === target.clip);
      if (c && c.kind !== "audio") {
        // (a rhythm picked never changes how long a drums clip is: it comes round again inside it)
        const whole = kind !== "drums" && c.off === 0 && Math.abs(c.len - contentBeats(c)) < EPS;
        out = setContent(out, c.id, made.content);
        const now = out.clips.find((x) => x.id === c.id) as NoteClip;
        if (!!now.mute !== made.mute) out = { ...out, clips: out.clips.map((x) => (x === now ? (made.mute ? { ...now, mute: true } : (({ mute: _m, ...rest }) => rest as NoteClip)(now)) : x)) };
        // a clip that showed its whole content once follows it when the content is made longer or shorter
        const size = contentBeats(out.clips.find((x) => x.id === c.id) as NoteClip);
        if (whole && Math.abs(size - c.len) > EPS) out = resizeClip(out, c.id, "right", c.start + size);
      }
    } else if (target.fresh) {
      if (!isEmpty(made.content, kind)) {
        // the first thing written makes the clip: as long as its content, and never over what follows it on the track
        const clip = { id: target.fresh.id, track: open.id, kind, start: target.fresh.at, len: 1, off: 0, sig: target.fresh.sig, content: made.content, ...(made.mute ? { mute: true } : {}) } as NoteClip;
        const next = Math.min(Infinity, ...out.clips.filter((x) => x.track === open.id && x.start > clip.start - EPS).map((x) => x.start));
        const bar = sigBeats(clip.sig);
        const len = Math.min(kind === "drums" ? FRESH_BARS * bar : contentBeats(clip), Math.max(bar, Math.floor((next - clip.start) / bar + EPS) * bar));
        out = layDown(out, { ...clip, len });
        openClip = clip.id;
      }
    } else out = setDraft(out, open.id, made.content, sig);
  }

  // the open track's harmony record, and whether its clip plays instead of chords
  const record = (track: string, lid: string, clip: string | undefined) => {
    const h = harmonyIn(q, lid);
    const t = q.tracks?.find((x) => x.id === lid);
    if (!same(h, harmonyIn(before, lid)) || t?.role !== before.tracks?.find((x) => x.id === lid)?.role || (t && t.name !== before.tracks?.find((x) => x.id === lid)?.name)) {
      const from = h && realId(lead, h.from);
      out = setOn(out, track, (r) => patched(r, { ...(h && from ? { harmony: { from, option: h.option } } : { harmony: undefined }), ...(lid === "chords" || lid === "melody" ? {} : { role: t?.role, ...(t?.name ? { name: t.name } : {}) }) }));
    }
    if (clip === undefined) return;
    const c = out.clips.find((x) => x.id === clip);
    if (!c || c.kind === "audio" || c.kind === "drums") return;
    const mark = markFrom(q, lid, lead);
    const instead = c.kind === "chords" ? insteadFrom(q, lid, lead) : undefined;
    const next = tidy({ ...c, harmony: mark, ...(c.kind === "chords" ? { instead } : {}) }) as NoteClip;
    if (!same(next, c)) out = { ...out, clips: out.clips.map((x) => (x === c ? next : x)) };
  };
  if (kind !== "drums") record(open.id, openId, openClip);

  // 2. and 3. the other chords and melody tracks: one added inside, or one that was empty under the stretch and now has music
  const below = () => out.tracks.findIndex((t) => t.id === open.id) + 1;
  const others: { lid: string; kind: "chords" | "melody"; name: string }[] = [
    ...(openId === "chords" ? [] : [{ lid: "chords", kind: "chords" as const, name: "Chords" }]),
    ...(openId === "melody" ? [] : [{ lid: "melody", kind: "melody" as const, name: "Melody" }]),
    ...(q.tracks ?? []).filter((t) => t.id !== openId && (t.kind === "chords" || t.kind === "melody")).map((t) => ({ lid: t.id, kind: t.kind as "chords" | "melody", name: t.name })),
  ];
  for (const o of others) {
    const now = layerIn(q, o.lid);
    if (!hasMusic(now) || hasMusic(layerIn(before, o.lid))) continue;
    let track = realId(lead, o.lid) ?? undefined;
    if (!track || !out.tracks.some((t) => t.id === track)) {
      // a new track of its kind, directly below the open one (the first chords track written into a song that has none: it leads)
      const fresh = !track || RESERVED.has(track) ? id() : track;
      const tone = toneOf(q, o.lid);
      const t: Track = o.kind === "chords" ? tidy({ id: fresh, kind: "chords" as const, name: o.name, tone, sound: now?.sound, ...(o.lid === "chords" ? { lead: true as const } : {}) }) : tidy({ id: fresh, kind: "melody" as const, name: o.name, tone, sound: now?.tuneSound });
      const at = below();
      out = { ...out, tracks: [...out.tracks.slice(0, at), t, ...out.tracks.slice(at)] };
      track = fresh;
    }
    const c = contentFrom(now, o.kind, bars)!;
    const clip = { id: id(), track, kind: o.kind, start: span.from, len: span.to - span.from, off: 0, sig, content: c.content } as NoteClip;
    out = layDown(out, clip);
    record(track, o.lid, clip.id);
  }

  // 5. the mixer: what changed inside goes to the real entries
  const ids = new Set([...Object.keys(q.mix ?? {}), ...Object.keys(before.mix ?? {})]);
  for (const lid of ids) {
    const m = q.mix?.[lid];
    if (same(m, before.mix?.[lid])) continue;
    const real = realId(lead, lid) ?? (lid === "chords" ? out.tracks.find((t) => t.kind === "chords" && t.lead)?.id : lid === "melody" ? out.tracks.find((t) => t.kind === "melody")?.id : undefined);
    if (!real || !out.tracks.some((t) => t.id === real)) continue;
    const { instead: _i, ...entry } = (m ?? {}) as TrackMix;
    const mix = { ...out.mix };
    if (m && Object.keys(entry).length) mix[real] = entry;
    else delete mix[real];
    out = { ...out, mix };
  }
  return out;
}
const RESERVED = new Set(["chords", "melody", "drums"]);

/**
 * Where the harmony written into one clip stands (as `harmonyState` says for an old section): was it changed by hand
 * since, has what it was written from changed since, and is its source still there to write from.
 */
export function harmonyState5(song: TimelineSong, key: Key, clip: string): HarmonyState {
  const c = song.clips.find((x) => x.id === clip);
  const lens = c ? lensOf(song, { track: c.track, clip }, key, 0) : null;
  if (!c || !lens) return { edited: [], stale: false, source: false };
  return harmonyState(lens.p, key, lensId({ lead: lens.lead, melody: lens.melody }, c.track));
}

/**
 * "Move song" with the harmony records following: every chord, melody and bass note moves into the new key (see
 * `transpose`), and a harmony clip that stood as it was written (not changed by hand, its source not changed since)
 * still stands so afterwards: its record is brought up to date with the moved song. Without this a harmony would
 * read as "its source changed" just because the whole song moved. A clip that was changed by hand or was out of
 * date before the move stays so.
 */
export function transposeSong(song: TimelineSong, n: number, from: Key, to: Key): TimelineSong {
  const moved = transpose(song, n, from, to);
  if (moved === song) return song;
  let out = moved;
  let made = 0;
  for (const c of song.clips) {
    if (c.kind === "audio" || c.kind === "drums" || !c.harmony) continue;
    try {
      const was = harmonyState5(song, from, c.id);
      if (!was.source || was.stale || was.edited.length) continue;
      const target: Target = { track: c.track, clip: c.id };
      const lens = lensOf(out, target, to, 0);
      if (!lens) continue;
      const p = remarkHarmony(lens.p, to, lensId({ lead: lens.lead, melody: lens.melody }, c.track));
      if (p !== lens.p) out = unlens(out, target, lens, p, () => `moved-${++made}`);
    } catch {
      /* a clip that cannot be read this way keeps its record as it is */
    }
  }
  return out;
}
