// The bar map: where every bar line of a song lies, in beats.
// A song has one time signature from bar 1 (`meter`) and may change it at later bars (`sigs`). Bars are counted
// from 0 here (bar 0 is the first bar; the screen shows it as bar 1). Every signature the app offers has a whole
// number of beats to the bar, so a bar line is always on a whole beat.
import { DEFAULT_SIG, sigBeats, type TimeSig } from "../song/meter";
import type { TimelineSong } from "./model";

export interface BarMap {
  /** the beat a bar starts on (bar 0 = the first bar) */
  beatOfBar(bar: number): number;
  /** which bar a beat is in, how far into it, and that bar's signature */
  barAt(beat: number): { bar: number; beat: number; sig: TimeSig };
  sigAt(beat: number): TimeSig;
  /** bar lines between two beats, the first included and the second not (for the ruler and the grid) */
  lines(from: number, to: number): { beat: number; bar: number }[];
  /** nearest bar line / nearest beat / the bar line at or before */
  snapBar(beat: number): number; snapBeat(beat: number): number; floorBar(beat: number): number;
}

/** A stretch of bars in one signature: its first bar, the beat that bar starts on, and how long its bars are. */
interface Stretch { bar: number; beat: number; sig: TimeSig; len: number }

/** A hair's width, so a beat that arithmetic left just short of a bar line still counts as on it. */
const EPS = 1e-9;

/** The stretches of a song, in order. Changes that are out of order, not on a whole bar or not after bar 1 are left out. */
function stretches(song: Pick<TimelineSong, "meter" | "sigs">): Stretch[] {
  const first = song.meter ?? DEFAULT_SIG;
  const out: Stretch[] = [{ bar: 0, beat: 0, sig: first, len: sigBeats(first) }];
  const later = [...(song.sigs ?? [])].filter((s) => s && Number.isInteger(s.bar) && s.bar > 0 && s.sig).sort((a, b) => a.bar - b.bar);
  for (const s of later) {
    const last = out[out.length - 1];
    // two changes on one bar: the later one in the list holds
    if (s.bar === last.bar) out[out.length - 1] = { ...last, sig: s.sig, len: sigBeats(s.sig) };
    else out.push({ bar: s.bar, beat: last.beat + (s.bar - last.bar) * last.len, sig: s.sig, len: sigBeats(s.sig) });
  }
  return out;
}

const made = new WeakMap<TimeSig, WeakMap<object, BarMap>>();
const NO_SIGS = {};

/** The bar map of a song. The same map comes back while the song's `meter` and `sigs` are the same objects. */
export function barMap(song: Pick<TimelineSong, "meter" | "sigs">): BarMap {
  const meter = song.meter ?? DEFAULT_SIG;
  let per = made.get(meter);
  if (!per) made.set(meter, (per = new WeakMap()));
  const key = song.sigs ?? NO_SIGS;
  let map = per.get(key);
  if (!map) per.set(key, (map = build(stretches(song))));
  return map;
}

function build(ss: Stretch[]): BarMap {
  /** the stretch a bar is in */
  const ofBar = (bar: number): Stretch => {
    let s = ss[0];
    for (const x of ss) if (x.bar <= bar) s = x;
    return s;
  };
  /** the stretch a beat is in */
  const ofBeat = (beat: number): Stretch => {
    let s = ss[0];
    for (const x of ss) if (x.beat <= beat + EPS) s = x;
    return s;
  };
  const beatOfBar = (bar: number): number => {
    const b = Math.max(0, bar);
    const s = ofBar(b);
    return s.beat + (b - s.bar) * s.len;
  };
  const barAt = (beat: number): { bar: number; beat: number; sig: TimeSig } => {
    const x = Math.max(0, beat);
    const s = ofBeat(x);
    const bar = s.bar + Math.floor((x - s.beat) / s.len + EPS);
    return { bar, beat: Math.max(0, x - (s.beat + (bar - s.bar) * s.len)), sig: s.sig };
  };
  const floorBar = (beat: number): number => beatOfBar(barAt(beat).bar);
  return {
    beatOfBar,
    barAt,
    sigAt: (beat) => ofBeat(Math.max(0, beat)).sig,
    lines: (from, to) => {
      const out: { beat: number; bar: number }[] = [];
      let bar = barAt(from).bar;
      if (beatOfBar(bar) < Math.max(0, from) - EPS) bar++;
      for (let beat = beatOfBar(bar); beat < to - EPS; beat = beatOfBar(++bar)) out.push({ beat, bar });
      return out;
    },
    snapBar: (beat) => {
      const at = barAt(beat);
      const lo = beatOfBar(at.bar);
      const hi = beatOfBar(at.bar + 1);
      return Math.max(0, beat) - lo < hi - Math.max(0, beat) ? lo : hi;
    },
    snapBeat: (beat) => Math.max(0, Math.round(beat)),
    floorBar,
  };
}

/** The bar line at or after a beat. */
export function ceilBar(map: BarMap, beat: number): number {
  const lo = map.floorBar(beat);
  return lo >= Math.max(0, beat) - EPS ? lo : map.beatOfBar(map.barAt(beat).bar + 1);
}
/** Is a beat on a bar line? */
export const onBarLine = (map: BarMap, beat: number): boolean => Math.abs(map.floorBar(beat) - beat) < EPS;
