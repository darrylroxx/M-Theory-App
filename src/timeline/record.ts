// Recording onto the timeline: what a recording goes round, and a finished recording as takes and one clip.
//
// The recording itself is made as before: the song (without the track being recorded) is rendered, the engine plays
// it on the interface's own clock and writes one file from the first click of the count-in until Stop. Here that
// file becomes takes that know the song beat they were sung from, and one clip on the track's lane.
import { activeTake, cutTakes, nudgeFrames, type Recorded } from "../song/takes";
import { sigBeats } from "../song/meter";
import { barMap, ceilBar } from "./bars";
import { layDown, songEnd } from "./edit";
import type { AudioClip, AudioTrack, Session, Take5, TimelineSong } from "./model";

/** What a recording goes round: from which beat to which, whether the song goes round under it, and the beats in each bar (for the click). */
export interface RecordPlan5 { from: number; to: number; loop: boolean; bars: number[] }

/** With no loop set, a recording goes round at most this many bars from the cursor's bar. */
export const RECORD_BARS = 8;

const EPS = 1e-6;

/**
 * What a recording goes round. With the loop on: from the first stretch's start to the last one's end, both brought
 * out to bar lines (stretches apart from each other are recorded as one, with all between: a take is one piece of
 * sound). With no loop: from the bar the cursor is in, to the song's end, at most eight bars (eight when the cursor
 * is at or past the end).
 */
export function recordPlan5(song: TimelineSong, session: Pick<Session, "cursor" | "loop">): RecordPlan5 {
  const map = barMap(song);
  const regions = session.loop?.on ? session.loop.regions : [];
  let from: number;
  let to: number;
  if (regions.length) {
    from = map.floorBar(Math.min(...regions.map((r) => r.from)) + EPS);
    to = ceilBar(map, Math.max(...regions.map((r) => r.to)) - EPS);
  } else {
    const bar = map.barAt(Math.max(0, session.cursor) + EPS).bar;
    from = map.beatOfBar(bar);
    const most = map.beatOfBar(bar + RECORD_BARS);
    const end = ceilBar(map, songEnd(song) - EPS);
    to = end > from + EPS ? Math.min(most, end) : most;
  }
  if (!(to > from + EPS)) to = map.beatOfBar(map.barAt(from + EPS).bar + 1);
  const bars: number[] = [];
  for (let b = map.barAt(from + EPS).bar; map.beatOfBar(b) < to - EPS; b++) bars.push(sigBeats(map.barAt(map.beatOfBar(b) + EPS).sig));
  return { from, to, loop: true, bars };
}

/**
 * A finished recording on its track. With the song going round (`plan.loop`), it is cut into one take per pass, each
 * sung from `plan.from`; the passes in `kept` are ★. With the song played once, the whole of it is one take. Either
 * way the time the sound took to come back in, the timing nudge and the count-in are in each take's `start`, so the
 * clip sits where it was sung. One clip is laid at `plan.from` playing the take that plays (the last ★, else the last
 * full pass), and whatever it covers on the track makes way; the other passes are a choice away.
 *
 * `o.nudge`: the timing nudge in use, in milliseconds. `o.id`: the first id it gives names the recording, the next
 * ones its takes, the last one the clip. `bpm`, `key`, `sig`, `sound`: what it was sung in and with, kept on each take.
 * The same song comes back when the track is not one that records, or nothing was sung.
 */
export function addRecording5(song: TimelineSong, track: string, r: Recorded, plan: RecordPlan5, o: { nudge: number; kept: number[]; id: () => string; bpm: number; key: string; sig: string; sound: string }): TimelineSong {
  const t = song.tracks.find((x) => x.id === track);
  if (!t || (t.kind !== "vocals" && t.kind !== "audio")) return song;
  const group = o.id();
  const nudge = nudgeFrames(o.nudge, r.rate);
  const sung = { sound: o.sound, bpm: o.bpm, key: o.key, sig: o.sig };
  let takes: Take5[];
  if (plan.loop && r.loop_frames > 0) {
    takes = cutTakes(r, { group, at: { block: "", bar: 0 }, nudge, id: o.id, kept: o.kept }).map(({ at: _at, ...k }): Take5 => ({ ...k, at: plan.from, ...sung }));
  } else {
    // once through: one take, the whole of it (there is no loop length to cut it by)
    const start = r.offset + nudge + r.count_in;
    const frames = r.frames - start;
    takes = frames < r.rate * 0.05 ? [] : [{ id: o.id(), n: 1, group, dry: r.dry, wet: r.wet, rate: r.rate, start, frames, at: plan.from, nudge, ...(o.kept.includes(1) ? { keep: true as const } : {}), ...sung }];
  }
  if (!takes.length) return song;
  // (the old rule picks the take that plays; it only reads what both kinds of take have)
  const plays = activeTake(takes as unknown as Parameters<typeof activeTake>[0], group) as unknown as Take5 | undefined;
  const play = takes.find((k) => k.id === plays?.id) ?? takes[takes.length - 1];
  const withTakes: TimelineSong = { ...song, tracks: song.tracks.map((x) => (x === t ? ({ ...t, takes: [...t.takes, ...takes] } as AudioTrack) : x)) };
  const clip: AudioClip = { id: o.id(), track, kind: "audio", take: play.id, from: 0, to: play.frames, off: 0, frames: play.frames, start: plan.from };
  return layDown(withTakes, clip);
}
