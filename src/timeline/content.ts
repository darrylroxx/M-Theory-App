// What a composer window has open, as plain arithmetic: a placed clip, or its track's draft (what is being composed
// and is not on the timeline yet). Reading it, writing it back, making it longer or shorter, and laying a separate
// copy of it on a lane. Used by the clip strip at the bottom of every composer and by the composers themselves.
import { MAX_BARS, emptyRows, setBars, type Beat, type Groove } from "../audio/beats";
import { fitBars } from "../song/frame";
import { setMelodyBars, type Melody } from "../song/melody";
import { mapList, refit, sameSig, sigBeats, type TimeSig } from "../song/meter";
import { barMap } from "./bars";
import { blankContent, copyClips, layDown, resizeClip, setContent, setDraft } from "./edit";
import { CLIP_OF, accepts, contentBeats, mod, type ChordsContent, type ClipKind, type NoteClip, type Region, type TimelineSong, type Track } from "./model";

type Content = NoteClip["content"];
type NoteKind = NoteClip["kind"];
const EPS = 1e-6;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** How many bars a new drum draft has: a picked rhythm is written out over them, so each bar can be changed on its own. */
export const DRAFT_DRUM_BARS = 4;

/** Is there anything to hear in a content: a chord that is not a rest, a note, a drum hit? */
export function contentHas(kind: ClipKind, content: Content): boolean {
  if (kind === "chords") return (content as ChordsContent).chords.some((c) => !c.rest);
  if (kind === "melody") return (content as Melody).notes.length > 0;
  if (kind === "drums") return Object.values((content as Groove).rows ?? {}).some((r) => /[1-9]/.test(r ?? ""));
  return false;
}

/** How many bars a content is long. */
export const contentBars = (content: Content): number => Math.max(1, Math.round(content.bars ?? 1));

/** What a draft starts as: the plain empty content of its kind (four empty bars of drums, so there is room to write). */
export function blankDraft(kind: ClipKind, sig: TimeSig): Content {
  const blank = blankContent(kind, sig);
  if (kind !== "drums") return blank;
  const g = blank as Groove;
  return { ...g, bars: DRAFT_DRUM_BARS, rows: emptyRows(g.steps * DRAFT_DRUM_BARS) };
}

/**
 * A content made `bars` long (1 to 32). Drums: new bars start as a copy of the last one. A melody: new bars are
 * empty, notes past the end are dropped. Chords: only the frame changes (chords past it are kept, and not played).
 */
export function withBars(kind: ClipKind, content: Content, bars: number, sig: TimeSig): Content {
  const n = Math.max(1, Math.min(MAX_BARS, Math.round(bars)));
  if (n === contentBars(content)) return content;
  if (kind === "drums") {
    // (only the rhythm is read and written: the rows, and how many bars there are of them)
    return setBars(content as unknown as Beat, n) as unknown as Groove;
  }
  if (kind === "melody") return setMelodyBars(content as Melody, n, sigBeats(sig));
  return { ...(content as ChordsContent), bars: fitBars(n) ?? n };
}

/** What a composer window is on: a clip of its track, or (no clip) the track's draft. */
export interface OpenTarget { track: string; clip?: string }

/** What is open, read from the song: the content, the signature it is written in, the bars of the song it stands for, and the clip when it is a placed one. */
export interface Open { track: Track; kind: NoteKind; clip?: NoteClip; content: Content; sig: TimeSig; span: Region }

const blanks = new Map<string, Content>();
/** The same empty content for the same kind and signature, every time (so nothing is drawn again for it). */
function blankOf(kind: ClipKind, sig: TimeSig): Content {
  const k = `${kind}|${sig.num}/${sig.den}`;
  let b = blanks.get(k);
  if (!b) blanks.set(k, (b = blankDraft(kind, sig)));
  return b;
}

/**
 * What a target has open. A placed clip: its content, and one round of it on the song's line (the first round that
 * starts inside the clip, else the one its left edge lies in). A draft: its content (an empty one when the track has
 * none yet), lying from `anchor`. null: the track or the clip is gone, or the track records.
 */
export function openOf(song: TimelineSong, target: OpenTarget, anchor: number): Open | null {
  const track = song.tracks.find((t) => t.id === target.track);
  if (!track || "takes" in track) return null;
  const kind = CLIP_OF[track.kind] as NoteKind;
  if (target.clip !== undefined) {
    const clip = song.clips.find((c) => c.id === target.clip);
    if (!clip || clip.kind === "audio" || clip.track !== track.id) return null;
    const size = contentBeats(clip);
    const first = clip.off === 0 ? clip.start : clip.start + (size - clip.off);
    const from = first < clip.start + clip.len - EPS ? first : clip.start - clip.off;
    return { track, kind, clip, content: clip.content, sig: clip.sig, span: { from, to: from + size } };
  }
  const sig = track.draft?.sig ?? barMap(song).sigAt(Math.max(0, anchor) + EPS);
  const content = (track.draft?.content as Content | undefined) ?? blankOf(kind, sig);
  return { track, kind, content, sig, span: { from: anchor, to: anchor + contentBars(content) * sigBeats(sig) } };
}

/** Did a clip show its whole content exactly once? (Then its length follows when the content is made longer or shorter.) */
export const wholeOnce = (c: NoteClip): boolean => c.off === 0 && Math.abs(c.len - contentBeats(c)) < EPS;

/**
 * A content written into what is open: a placed clip's content (the clip keeps its place; one that showed its whole
 * content once follows the content's length, any other keeps its own), or the track's draft. Drums are fitted to the
 * signature, as everywhere. The same song back when nothing changed, or the target is gone.
 */
export function writeOpen(song: TimelineSong, target: OpenTarget, content: Content, anchor: number): TimelineSong {
  const open = openOf(song, target, anchor);
  if (!open) return song;
  if (!open.clip) return setDraft(song, open.track.id, content, open.sig);
  const follows = wholeOnce(open.clip);
  let out = setContent(song, open.clip.id, content);
  if (out === song || !follows) return out;
  const now = out.clips.find((c) => c.id === open.clip!.id) as NoteClip;
  const size = contentBeats(now);
  if (Math.abs(size - now.len) > EPS) {
    const sized = resizeClip(out, now.id, "right", now.start + size);
    // (another clip in the way: it stays as long as it was, and shows that much of the content)
    out = sized;
  }
  return out;
}

/** What is open, made `bars` long (see `withBars` and `writeOpen`). */
export function setOpenBars(song: TimelineSong, target: OpenTarget, bars: number, anchor: number): TimelineSong {
  const open = openOf(song, target, anchor);
  if (!open) return song;
  const next = withBars(open.kind, open.content, bars, open.sig);
  return next === open.content ? song : writeOpen(song, target, next, anchor);
}

/** Is what is open written in another time signature than the bars it lies in (a draft: the bars at the anchor)? */
export function needsFit(song: TimelineSong, target: OpenTarget, anchor: number): boolean {
  const open = openOf(song, target, anchor);
  if (!open) return false;
  const at = open.clip ? open.clip.start : Math.max(0, anchor);
  return !sameSig(open.sig, barMap(song).sigAt(at + EPS));
}

/**
 * A separate copy of what is open, laid on a lane at a beat: of the draft, as a clip one round of its content long
 * (the draft stays as it is); of a placed clip, as that clip again, as long as it is. `onto`: the track it lands on,
 * which must take clips of its kind (none: its own track). A drums clip lands on the bar line at or before the beat.
 * It trims what it covers. The same song back when it cannot be done.
 */
export function stampOpen(song: TimelineSong, target: OpenTarget, onto: string, atBeat: number, anchor: number, id: () => string): TimelineSong {
  const open = openOf(song, target, anchor);
  const to = song.tracks.find((t) => t.id === onto);
  if (!open || !to || !accepts(to.kind, open.kind) || !Number.isFinite(atBeat)) return song;
  const map = barMap(song);
  const start = open.kind === "drums" ? map.floorBar(Math.max(0, atBeat)) : map.snapBeat(Math.max(0, atBeat));
  if (open.clip) {
    // (a copy dropped exactly onto its original would only take its place)
    if (to.id === open.clip.track && start === open.clip.start) return song;
    return copyClips(song, [open.clip.id], start - open.clip.start, to.id, id);
  }
  const clip = { id: id(), track: to.id, kind: open.kind, start, len: 1, off: 0, sig: open.sig, content: clone(open.content) } as NoteClip;
  return layDown(song, { ...clip, len: contentBeats(clip) });
}

/** A content written in one signature, moved into another: chords that lasted whole bars still do, every note and drum hit stays in its bar. */
export function refitContent(kind: ClipKind, content: Content, from: TimeSig, to: TimeSig): Content {
  if (sameSig(from, to)) return content;
  const f = refit(from, to);
  if (kind === "chords") {
    const c = content as ChordsContent;
    return { ...c, chords: mapList(c.chords, f.chord!) };
  }
  if (kind === "melody") return f.melody!(content as Melody);
  return f.rhythm!(content as Groove);
}

/**
 * "Fit to these bars": what is open, refitted to the time signature of the bars it lies in (a draft: the bars at the
 * anchor). A placed clip keeps its place and its length, and its left edge stays in the same bar of its content.
 * The same song back when it fits already.
 */
export function fitOpen(song: TimelineSong, target: OpenTarget, anchor: number): TimelineSong {
  const open = openOf(song, target, anchor);
  if (!open) return song;
  const at = open.clip ? open.clip.start : Math.max(0, anchor);
  const to = barMap(song).sigAt(at + EPS);
  if (sameSig(open.sig, to)) return song;
  const content = refitContent(open.kind, open.content, open.sig, to);
  if (!open.clip) return setDraft(song, open.track.id, content, to);
  const c = open.clip;
  const a = sigBeats(c.sig);
  const b = sigBeats(to);
  const next = { ...c, sig: to, content } as NoteClip;
  const fitted = { ...next, off: mod(Math.floor(c.off / a) * b + Math.min(c.off % a, b - 1), contentBeats(next)) } as NoteClip;
  return layDown(song, fitted);
}
