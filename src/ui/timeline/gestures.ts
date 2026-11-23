// The arithmetic behind every pointer gesture of the track view: beats to pixels and back, zoom, fit, snapping,
// which clips are on screen, which lane a pointer is over, the box that selects, and the loop's stretches.
// Nothing here touches the screen or the song: each function takes numbers and gives numbers, so all of it is tested.
import { MIN_CLIP, snapMove, sixteenths } from "../../song/clips";
import { isCompound, sigBeats } from "../../song/meter";
import { barMap, ceilBar, type BarMap } from "../../timeline/bars";
import { songEnd } from "../../timeline/edit";
import { beatsToFrames, clipBeats, clipEnd, contentBeats, contentFrames, framesToBeats, rateOf, type Clip, type Marker, type Region, type TimelineSong } from "../../timeline/model";

/** How the timeline is shown: how wide a beat is, and which beat is at the left edge of the lanes. */
export interface View { pxPerBeat: number; scroll: number }

/** The narrowest and the widest a beat is drawn (the top end is for cutting a recording between two words). */
export const MIN_PX = 2;
export const MAX_PX = 320;
/** One press of + or −, and one notch of the wheel. */
export const ZOOM_STEP = 1.25;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const EPS = 1e-9;

export const xOfBeat = (v: View, beat: number): number => (beat - v.scroll) * v.pxPerBeat;
export const beatOfX = (v: View, x: number): number => v.scroll + x / v.pxPerBeat;

/** Zoom in or out by a factor: the beat under `atX` stays under it (until the song's start comes to the left edge). */
export function zoomAbout(v: View, factor: number, atX: number): View {
  const pxPerBeat = clamp(v.pxPerBeat * factor, MIN_PX, MAX_PX);
  const beat = beatOfX(v, atX);
  return { pxPerBeat, scroll: Math.max(0, beat - atX / pxPerBeat) };
}

/** The whole song across the lanes, from its first beat; never fewer than 16 bars (so an empty song has room to write in). */
export function fitView(end: number, width: number, barBeats: number): View {
  const beats = Math.max(end, 16 * Math.max(1, barBeats));
  return { pxPerBeat: clamp(Math.max(1, width) / beats, MIN_PX, MAX_PX), scroll: 0 };
}

/**
 * Two fingers on the lanes: they began `d0` pixels apart about `mid0` (pixels from the lanes' left edge) and are now
 * `d` apart about `mid`. The zoom follows how far apart they are, and the beat that was between them stays between them.
 */
export function pinchView(v: View, d0: number, d: number, mid0: number, mid: number): View {
  const pxPerBeat = clamp(v.pxPerBeat * (Math.max(1, d) / Math.max(1, d0)), MIN_PX, MAX_PX);
  return { pxPerBeat, scroll: Math.max(0, beatOfX(v, mid0) - mid / pxPerBeat) };
}

/** A beat brought to the nearest bar line, the nearest beat, or left where it is (never before the song starts). */
export function snap(map: BarMap, beat: number, mode: "bar" | "beat" | "free"): number {
  return mode === "bar" ? map.snapBar(beat) : mode === "beat" ? map.snapBeat(beat) : Math.max(0, beat);
}
/** How a pointer with these keys held snaps: bars; Shift: beats; Alt: not at all. */
export const snapMode = (keys: { shift?: boolean; alt?: boolean }): "bar" | "beat" | "free" => (keys.alt ? "free" : keys.shift ? "beat" : "bar");

/** How far the lanes reach, in beats: a screen past the song's end, never fewer than 32 bars, and never short of what is on screen. */
export function reach(song: TimelineSong, v: View, width: number): number {
  const screen = width / v.pxPerBeat;
  return Math.max(songEnd(song) + screen, barMap(song).beatOfBar(32), v.scroll + screen);
}

/** The clips to draw: those that touch the screen, and those within one screen either side of it. */
export function inView(song: TimelineSong, v: View, width: number): Clip[] {
  const screen = width / v.pxPerBeat;
  const from = v.scroll - screen;
  const to = v.scroll + 2 * screen;
  return song.clips.filter((c) => c.start < to && clipEnd(c, song) > from);
}

/** The lane a height is in (the track's id), or null between and outside them. */
export function laneAt(lanes: { track: string; top: number; bottom: number }[], y: number): string | null {
  return lanes.find((l) => y >= l.top && y < l.bottom)?.track ?? null;
}

/** The clips a box touches: on those tracks, anywhere between the two beats. */
export function boxHits(song: TimelineSong, box: { from: number; to: number; tracks: string[] }): string[] {
  const a = Math.min(box.from, box.to);
  const b = Math.max(box.from, box.to);
  const on = new Set(box.tracks);
  return song.clips.filter((c) => on.has(c.track) && c.start < b && clipEnd(c, song) > a).map((c) => c.id);
}

/** Stretches of time in song order; those that touch or overlap become one. (One with no length is left out.) */
export function mergeRegions(rs: Region[]): Region[] {
  const sorted = rs.filter((r) => r.to > r.from + EPS).map((r) => ({ from: Math.max(0, r.from), to: r.to })).sort((a, b) => a.from - b.from);
  const out: Region[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to + EPS) last.to = Math.max(last.to, r.to);
    else out.push(r);
  }
  return out;
}

/** The stretch a drag across the ruler marks: both ends go to the nearest bar line (Shift: beat), and it is never shorter than one bar (one beat). */
export function dragRegion(map: BarMap, a: number, b: number, mode: "bar" | "beat" | "free"): Region {
  const lo = snap(map, Math.min(a, b), mode);
  const hi = snap(map, Math.max(a, b), mode);
  if (hi > lo + EPS) return { from: lo, to: hi };
  if (mode === "bar") {
    const from = map.floorBar(Math.min(a, b));
    return { from, to: map.beatOfBar(map.barAt(from).bar + 1) };
  }
  const from = Math.floor(Math.max(0, Math.min(a, b)));
  return { from, to: from + 1 };
}

/** The bar a beat is in, as a stretch. */
export function barRegion(map: BarMap, beat: number): Region {
  const from = map.floorBar(beat);
  return { from, to: map.beatOfBar(map.barAt(from).bar + 1) };
}

/** From a marker to the next one (the last marker: to the song's end). null: there is no such marker, or nothing after it. */
export function markerRegion(markers: Marker[] | undefined, id: string, end: number): Region | null {
  const m = markers?.find((x) => x.id === id);
  if (!m) return null;
  const next = Math.min(end, ...(markers ?? []).filter((x) => x.beat > m.beat + EPS).map((x) => x.beat));
  return next > m.beat + EPS ? { from: m.beat, to: next } : null;
}

// ── clips ───────────────────────────────────────────────────

/** A clip's length in beats in its song. */
export const lenOf = (song: TimelineSong, c: Clip): number => clipBeats(c, song.bpm, c.kind === "audio" ? rateOf(song, c) : undefined);

/**
 * How far a dragged clip really moves when the pointer has gone `d` beats.
 * A note clip: its start goes to the nearest bar line (Shift: beat; a drums clip always a bar line).
 * An audio clip: the distance goes to whole sixteenths of the bar it lands in (so a voice sung on the beat stays on
 * a beat, and one that starts on a breath before the bar is not pulled out of time); Shift or Alt: free.
 * Never before the song starts.
 */
export function moveBy(song: TimelineSong, c: Clip, d: number, keys: { shift?: boolean; alt?: boolean } = {}): number {
  const map = barMap(song);
  if (c.kind !== "audio") {
    const to = c.kind === "drums" || !keys.shift ? map.snapBar(c.start + d) : map.snapBeat(c.start + d);
    return to - c.start;
  }
  const rate = rateOf(song, c);
  const frames = snapMove(beatsToFrames(d, rate, song.bpm), rate, song.bpm, !!keys.shift || !!keys.alt, sixteenths(isCompound(map.sigAt(Math.max(0, c.start + d)))));
  return Math.max(-c.start, framesToBeats(frames, rate, song.bpm));
}

/** The clips either side of one on its track: where the one before it ends (0 when there is none) and where the next starts. */
export function neighbours(song: TimelineSong, c: Clip): { prev: number; next: number } {
  const others = song.clips.filter((x) => x.track === c.track && x.id !== c.id);
  return {
    prev: Math.min(c.start, Math.max(0, ...others.filter((x) => x.start < c.start - EPS).map((x) => clipEnd(x, song)))),
    next: Math.min(Infinity, ...others.filter((x) => x.start > c.start + EPS).map((x) => x.start)),
  };
}

/**
 * Where a dragged edge of a clip lands when the pointer is at `beat`.
 * A note clip: the nearest bar line, or the nearest point where its content starts again, whichever is closer
 * (Shift: the nearest beat; a drums clip always a bar line). An audio clip: exactly there (Shift: the nearest beat).
 * Then the edge stops: at the next clip on the track, at the song's start, and before the clip gets too short.
 */
export function edgeTo(song: TimelineSong, c: Clip, edge: "left" | "right", beat: number, keys: { shift?: boolean } = {}): number {
  const map = barMap(song);
  const end = clipEnd(c, song);
  const { prev, next } = neighbours(song, c);
  let to = Math.max(0, beat);
  if (c.kind === "audio") {
    if (keys.shift) to = map.snapBeat(to);
    // (the shortest a recording is cut to: 20 ms)
    const least = (MIN_CLIP * song.bpm) / 60;
    return edge === "right" ? clamp(to, c.start + least, next) : clamp(to, prev, end - least);
  }
  if (c.kind === "drums") to = map.snapBar(to);
  else if (keys.shift) to = map.snapBeat(to);
  else {
    const bar = map.snapBar(to);
    const size = contentBeats(c);
    const zero = c.start - c.off;
    const round = zero + Math.round((to - zero) / size) * size;
    to = round >= 0 && Math.abs(round - to) < Math.abs(bar - to) ? round : bar;
  }
  if (edge === "right") {
    const least = c.kind === "drums" ? map.beatOfBar(map.barAt(c.start).bar + 1) : c.start + 1;
    return Math.max(least, Math.min(to, c.kind === "drums" && next < Infinity ? map.floorBar(next) : next));
  }
  const most = c.kind === "drums" ? Math.max(c.start, map.floorBar(end - 0.5)) : end - 1;
  return Math.min(most, Math.max(to, c.kind === "drums" ? ceilBar(map, prev) : Math.ceil(prev - EPS)));
}

/** The clip on a track that a beat is inside (its edges not counted). */
export function clipUnder(song: TimelineSong, track: string, beat: number): Clip | undefined {
  return song.clips.find((c) => c.track === track && c.start < beat - EPS && clipEnd(c, song) > beat + EPS);
}

/**
 * Where a new empty clip goes when a lane is double-clicked at a beat: from the bar line at or before it (or from
 * where the clip before it ends), four bars long, shorter if another clip is in the way. null: there is no room.
 */
export function roomAt(song: TimelineSong, track: string, beat: number, drums: boolean): Region | null {
  const map = barMap(song);
  const mine = song.clips.filter((c) => c.track === track);
  if (mine.some((c) => c.start <= beat + EPS && clipEnd(c, song) > beat + EPS)) return null;
  const before = Math.max(0, ...mine.filter((c) => c.start <= beat).map((c) => clipEnd(c, song)));
  const after = Math.min(Infinity, ...mine.filter((c) => c.start > beat).map((c) => c.start));
  const line = map.floorBar(beat);
  const from = drums ? Math.max(line, ceilBar(map, before)) : Math.max(line, Math.ceil(before - EPS));
  const want = map.beatOfBar(map.barAt(line).bar + 4);
  const to = drums ? map.floorBar(Math.min(want, after)) : Math.floor(Math.min(want, after) + EPS);
  return to >= from + (drums ? sigBeats(map.sigAt(from)) : 1) - EPS ? { from, to } : null;
}

// ── words and numbers on screen ─────────────────────────────

/** Bar numbers are written on every bar while there is room, else on every 2nd, 4th, 8th or 16th. */
export const barEvery = (pxPerBar: number): number => (pxPerBar >= 40 ? 1 : pxPerBar >= 20 ? 2 : pxPerBar >= 10 ? 4 : pxPerBar >= 5 ? 8 : 16);

/** "5.1 · 0:10": the bar and the beat in it (both counted from 1), then minutes and seconds from the song's start. */
export function positionText(map: BarMap, beat: number, bpm: number): string {
  const at = map.barAt(beat);
  const secs = Math.floor((Math.max(0, beat) * 60) / Math.max(1, bpm) + 1e-6);
  return `${at.bar + 1}.${Math.floor(at.beat + 1e-6) + 1} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/** How many bars lie between two beats, as words: "8 bars", "1 bar", "2 bars + 1 beat", "3 beats". */
export function barsText(map: BarMap, from: number, to: number): string {
  const a = map.barAt(from);
  const b = map.barAt(to);
  const whole = a.beat < EPS && b.beat < EPS;
  const bars = whole ? b.bar - a.bar : Math.floor((to - from) / sigBeats(a.sig) + EPS);
  const beats = whole ? 0 : Math.round((to - from - bars * sigBeats(a.sig)) * 100) / 100;
  const bs = bars ? `${bars} bar${bars === 1 ? "" : "s"}` : "";
  const ts = beats ? `${beats} beat${beats === 1 ? "" : "s"}` : "";
  return bs && ts ? `${bs} + ${ts}` : bs || ts || "0 bars";
}

/** Which bars a stretch covers, as it is said: "bars 5–8", "bar 9". (A stretch that ends inside a bar counts that bar.) */
export function barsLabel(map: BarMap, from: number, to: number): string {
  const first = map.barAt(from).bar + 1;
  const last = Math.max(first, map.barAt(Math.max(from, to - 1e-6)).bar + 1);
  return first === last ? `bar ${first}` : `bars ${first}–${last}`;
}

/** How long a clip is, for the tag beside the pointer while its edge is dragged: bars and beats, or seconds for a recording. */
export function lengthText(song: TimelineSong, c: Clip): string {
  if (c.kind === "audio") return `${(c.frames / rateOf(song, c)).toFixed(c.frames / rateOf(song, c) < 10 ? 2 : 1)} s`;
  return barsText(barMap(song), c.start, c.start + c.len);
}

/** With Follow on: where the lanes turn to when the play line is at `beat` (a whole screen at a time), or null while it is on screen. */
export function pageFor(v: View, width: number, beat: number): number | null {
  const x = xOfBeat(v, beat);
  if (x >= 0 && x < width - 1) return null;
  const screen = width / v.pxPerBeat;
  return Math.max(0, Math.floor(beat / screen + EPS) * screen);
}

/**
 * Where a clip's right edge goes to play its content one round more (`by` 1) or one round less (-1): the next or the
 * last place its content starts again (what a drag of the edge would snap to, as a button). Null when one round less
 * would leave nothing. The edit itself is `resizeClip`, which stops at the next clip.
 */
export function repeatEnd(song: TimelineSong, c: Clip, by: 1 | -1): number | null {
  const rate = c.kind === "audio" ? rateOf(song, c) : 0;
  const size = c.kind === "audio" ? framesToBeats(contentFrames(c), rate, song.bpm) : contentBeats(c);
  const off = c.kind === "audio" ? framesToBeats(c.off, rate, song.bpm) : c.off;
  if (!(size > 0)) return null;
  const rounds = (off + lenOf(song, c)) / size;
  const to = (by > 0 ? Math.floor(rounds + 1e-6) + 1 : Math.ceil(rounds - 1e-6) - 1) * size - off;
  return to > 1e-6 ? c.start + to : null;
}
