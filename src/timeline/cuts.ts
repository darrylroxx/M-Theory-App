// Where a song of tracks and clips is cut into stretches for the player ("pseudo-sections").
//
// The player counts drum steps, melody ticks and playing styles from one shared start for each group of items it is
// given. In the old song that start was a section line. Here there are no sections, so `cutPoints` chooses the starts:
// always on a bar line, and wherever nothing is cut by it. A converted song is cut exactly on its old section lines,
// because no clip crosses one.
import { isCompound, sameSig, sigBeats } from "../song/meter";
import { barMap } from "./bars";
import { songEnd } from "./edit";
import type { DrumsClip, NoteClip, TimelineSong } from "./model";

/** The most bars one stretch may hold (a melody and a drum pattern hold no more). */
export const MAX_STRETCH_BARS = 32;

const EPS = 1e-6;

/** The unmuted note clips of a song whose track is still there. */
export function noteClips(song: TimelineSong): NoteClip[] {
  const kinds = new Map(song.tracks.map((t) => [t.id, t.kind]));
  return song.clips.filter((c): c is NoteClip => c.kind !== "audio" && !c.mute && kinds.has(c.track));
}

/** A drums track's unmuted clips, in the order they start. */
export function drumsClipsOf(song: TimelineSong, track: string): DrumsClip[] {
  return song.clips.filter((c): c is DrumsClip => c.kind === "drums" && c.track === track && !c.mute).sort((a, b) => a.start - b.start);
}

/**
 * The drums clip a bar of a drums track belongs to: the one that starts in the bar, else the one sounding where the bar
 * starts. (Drums clips start on bar lines, so this only matters for one moved into bars of another length: the bar it
 * starts in is its own, and the clip before it is silent from that bar's line.) `clips`: the track's, in order.
 */
export function barOwner(clips: readonly DrumsClip[], from: number, to: number): DrumsClip | undefined {
  let at: DrumsClip | undefined;
  for (const c of clips) {
    if (c.start >= from - EPS && c.start < to - EPS) return c;
    if (c.start < from + EPS && c.start + c.len > from + EPS) at = c;
  }
  return at;
}

/** A rhythm's grid as a drum part plays it: steps to a beat, and its swing (which only an even grid has). */
export const gridOf = (c: DrumsClip): { div: number; swing: number } => ({ div: c.content.div, swing: c.content.div % 2 === 0 ? c.content.swing || 0 : 0 });

/** The drums tracks the other tracks' swing and triplet grid follow, top to bottom. */
export const leadDrums = (song: TimelineSong): string[] => song.tracks.filter((t) => t.kind === "drums" && t.lead).map((t) => t.id);

/**
 * What the lead drums give the chord styles and the melodies over a bar: whether every beat divides in three, and the
 * swing the sixteenths lean back by. The topmost lead drums track with an unmuted clip there says; with none, the
 * bar's own signature does. `byTrack`: each lead drums track's clips (see drumsClipsOf).
 */
export function leadFeel(byTrack: readonly (readonly DrumsClip[])[], from: number, to: number, compound: boolean): { triplet: boolean; swing: number } {
  for (const clips of byTrack) {
    const c = barOwner(clips, from, to);
    if (c) return { triplet: compound || c.content.div === 3, swing: c.content.div === 4 ? c.content.swing || 0 : 0 };
  }
  return { triplet: compound, swing: 0 };
}

const made = new WeakMap<TimelineSong, number[]>();

/**
 * The beats where the song is cut: sorted, the first one 0, the song's end not included. There is a cut at a bar line when
 *  1. the time signature changes there;
 *  2. no unmuted note clip crosses it (audio clips do not count);
 *  3. a drums track's rhythm after it has another grid or swing than its rhythm before it in the same stretch;
 *  4. the swing or the triplet grid the lead drums give the other tracks changes there;
 *  5. the stretch would otherwise pass 32 bars: then at the bar line of those 32 that the fewest clips cross (the latest, on a tie).
 */
export function cutPoints(song: TimelineSong): number[] {
  const kept = made.get(song);
  if (kept) return kept;
  const out = work(song);
  made.set(song, out);
  return out;
}

function work(song: TimelineSong): number[] {
  const end = songEnd(song);
  const map = barMap(song);
  const lines = map.lines(0, end);
  if (lines.length < 2) return [0];
  const notes = noteClips(song);
  const crossing = (at: number) => notes.reduce((n, c) => n + (c.start < at - EPS && c.start + c.len > at + EPS ? 1 : 0), 0);
  const drums = song.tracks.filter((t) => t.kind === "drums").map((t) => drumsClipsOf(song, t.id));
  const lead = song.tracks.filter((t) => t.kind === "drums" && t.lead).map((t) => drumsClipsOf(song, t.id));
  const barEnd = (i: number) => (i + 1 < lines.length ? lines[i + 1].beat : end);
  const sigOf = (i: number) => map.sigAt(lines[i].beat + EPS);
  const feelKey = (i: number) => {
    const f = leadFeel(lead, lines[i].beat, barEnd(i), isCompound(sigOf(i)));
    return `${f.triplet ? 3 : 0}:${f.swing}`;
  };
  /** each drums track's grid in a bar ("" where it has no rhythm there) */
  const grids = (i: number): string[] =>
    drums.map((clips) => {
      const c = barOwner(clips, lines[i].beat, barEnd(i));
      if (!c) return "";
      const g = gridOf(c);
      return `${g.div}:${g.swing}`;
    });
  /** the line numbers of the cuts so far (line 0 is the song's start) */
  const cuts: number[] = [0];
  // each drums track's grid in the stretch being walked through
  let held = grids(0);
  let feel = feelKey(0);
  for (let i = 1; i < lines.length; i++) {
    const at = lines[i].beat;
    const now = grids(i);
    const f = feelKey(i);
    const cut = !sameSig(sigOf(i - 1), sigOf(i)) || crossing(at) === 0 || f !== feel || now.some((g, k) => g && held[k] && g !== held[k]);
    feel = f;
    if (cut) {
      cuts.push(i);
      held = now;
    } else held = held.map((g, k) => now[k] || g);
  }
  // no stretch longer than 32 bars
  const all: number[] = [];
  cuts.forEach((from, k) => {
    const to = k + 1 < cuts.length ? cuts[k + 1] : lines.length;
    let a = from;
    all.push(a);
    while (to - a > MAX_STRETCH_BARS) {
      let best = a + 1;
      let fewest = Infinity;
      for (let j = a + 1; j <= a + MAX_STRETCH_BARS; j++) {
        const n = crossing(lines[j].beat);
        if (n <= fewest) {
          fewest = n;
          best = j;
        }
      }
      a = best;
      all.push(a);
    }
  });
  return all.map((i) => lines[i].beat);
}

/** The stretches the cuts make: where each starts and ends, how long its bars are, and how many it has. */
export function stretches(song: TimelineSong): { from: number; to: number; bar: number; bars: number }[] {
  const cuts = cutPoints(song);
  const end = songEnd(song);
  const map = barMap(song);
  const out: { from: number; to: number; bar: number; bars: number }[] = [];
  cuts.forEach((from, i) => {
    const to = i + 1 < cuts.length ? cuts[i + 1] : end;
    if (to - from < EPS) return;
    const bar = sigBeats(map.sigAt(from + EPS));
    out.push({ from, to, bar, bars: Math.max(1, Math.round((to - from) / bar)) });
  });
  return out;
}
