/**
 * Where in the music a moment is, for the two kinds of music the canvas paints: the app's own
 * song (in sections and bars, with its own tempo), and a song from a file (just seconds, with a
 * bar as long as its heard tempo says).
 */
import type { Spot } from "./layout";
import { pageOf } from "./layout";
import type { When } from "./place";

/** What `heardTime` needs of an audio context (a real one, or a stand-in in a test). */
export interface HeardClock {
  readonly currentTime: number;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  getOutputTimestamp?(): { contextTime?: number; performanceTime?: number };
}

/**
 * The moment of the music being heard now, on the audio clock. The clock the app schedules its
 * sounds by runs ahead of the speakers: by the time a sample leaves them, the context has already
 * moved on by its own buffering (`baseLatency`) and the system's (`outputLatency`). The browser's
 * own word on it (`getOutputTimestamp`: which context time was leaving the speakers, and when) is
 * best; without it both delays are taken off. The app's song and a song from a file both go by
 * this, so their marks land with the sound alike.
 */
export function heardTime(c: HeardClock, perfNow: number = typeof performance !== "undefined" ? performance.now() : 0): number {
  const now = c.currentTime;
  try {
    const ts = c.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime) {
      const t = ts.contextTime + Math.max(0, (perfNow - ts.performanceTime) / 1000);
      // (some browsers answer with a stamp that is stale or not yet started: only a sensible one is believed)
      if (t <= now + 0.01 && t > now - 0.5) return Math.min(now, t);
    }
  } catch {
    // not given: estimated below
  }
  return now - (c.outputLatency || 0) - (c.baseLatency || 0);
}

/**
 * The app's own song. `spot` is where the music is at audio time `at`; `start` is the audio time
 * the music started (so that seconds since then run on without a break); `jump` counts the times
 * it has jumped. Moments a little before `at` are worked out back from it.
 */
export function songWhen(spot: Spot, at: number, width: number, start: number, jump: number): (t: number) => When {
  const pg = pageOf(spot, width);
  const bar = spot.bar * spot.spb;
  const pass = pg.perPage * bar;
  const intoNow = spot.beat * spot.spb;
  const length = Math.max(bar, spot.bars * bar);
  return (t: number) => {
    const back = at - t;
    let frac = pg.frac - back / pass;
    let page = pg.key;
    if (frac < 0) {
      // a moment from before this page began: it belongs at the end of the page before
      frac += 1;
      page = `${pg.key}<`;
    }
    return { s: t - start, bar, key: spot.key, index: spot.index, into: Math.max(0, intoNow - back), length, frac: Math.min(1, frac), page, pass, jump };
  };
}

/**
 * A song from a file: `pass` seconds to one crossing of the canvas (the sweep, the river), `bar`
 * the length of a bar as heard (two seconds until a tempo is heard); every eight bars is a
 * section of its own (for the blooms).
 */
export function fileWhen(pass: number, bar: number, jump: number): (t: number) => When {
  const section = Math.max(6, bar * 8);
  return (t: number) => {
    const k = Math.floor(Math.max(0, t) / section);
    return { s: t, bar, key: `${k}`, index: k, into: t - k * section, length: section, frac: ((t % pass) + pass) % pass / pass, page: String(Math.floor(t / pass)), pass, jump };
  };
}
