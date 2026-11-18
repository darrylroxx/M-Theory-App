/**
 * Where in the music a moment is, for the two kinds of music the canvas paints: the app's own
 * song (in sections and bars, with its own tempo), and a song from a file (just seconds, with a
 * bar as long as its heard tempo says).
 */
import type { Spot } from "./layout";
import { pageOf } from "./layout";
import type { When } from "./place";

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
