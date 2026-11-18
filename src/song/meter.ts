/**
 * The time signature. The song has one, set on the Frame page, and every section plays in it
 * unless that section has been given one of its own. A section's signature is the one thing
 * that says how long its bars are: on the Chords, Melody and Drums pages, in the Track view,
 * the loop bar, the count-in for vocals and every export. Nothing else decides it (it used to
 * follow the drum rhythm, or the playing style when the drums were off).
 *
 * A "beat" is the pulse the tempo counts: a quarter note in 3/4 or 4/4, a dotted quarter in
 * 6/8, 9/8 and 12/8 (so 6/8 is two beats to the bar, each one dividing in three).
 */
import { DRUM_IDS, type DrumId } from "../audio/drums";
import type { Melody } from "./melody";
import type { Layer, Layers } from "./tracks";
import type { ProgChord } from "../ui/state";

export interface TimeSig {
  num: number;
  den: 4 | 8;
}
export const DEFAULT_SIG: TimeSig = { num: 4, den: 4 };
export const TIME_SIGS: TimeSig[] = [
  { num: 2, den: 4 }, { num: 3, den: 4 }, { num: 4, den: 4 }, { num: 5, den: 4 }, { num: 6, den: 4 }, { num: 7, den: 4 },
  { num: 6, den: 8 }, { num: 9, den: 8 }, { num: 12, den: 8 },
];
export const sigName = (m: TimeSig) => `${m.num}/${m.den}`;
export const sameSig = (a: TimeSig | undefined, b: TimeSig | undefined) => !!a && !!b && a.num === b.num && a.den === b.den;
/** 6/8, 9/8, 12/8: every beat divides in three. */
export const isCompound = (m: TimeSig) => m.den === 8;
/** Beats in a bar. */
export const sigBeats = (m: TimeSig) => (m.den === 8 ? m.num / 3 : m.num);

export function reviveSig(raw: unknown): TimeSig | undefined {
  const m = raw as Partial<TimeSig> | null;
  return m ? TIME_SIGS.find((x) => x.num === m.num && x.den === m.den) : undefined;
}
/** The signature a song had before it could be chosen: from how long its bars were, and whether its beats divided in three. */
export function sigFor(beats: number, triplet: boolean): TimeSig {
  if (triplet && [2, 3, 4].includes(beats)) return { num: beats * 3, den: 8 };
  return TIME_SIGS.find((x) => x.den === 4 && x.num === beats) ?? DEFAULT_SIG;
}

/** A drum rhythm's grid: steps in a bar, steps to a beat, and a row of levels per drum for every bar. */
interface Grid {
  steps: number;
  div: number;
  bars?: number;
  rows: Record<DrumId, string>;
  edited?: boolean;
}

/**
 * A drum rhythm in bars of another length. The beats that still fit keep their hits; a longer
 * bar is filled by going round the old one again (beat 4 of a new 4/4 plays what beat 1 of the
 * old 3/4 did). Going to 6/8, 9/8 or 12/8, a grid of 16ths becomes triplets: the "and" and the
 * "a" both land on the last triplet. A rhythm whose bars are already the right length is
 * returned as it is (a triplet shuffle is at home in 4/4 too). `straight`: the song is leaving
 * 6/8, 9/8 or 12/8, so its triplets become 16ths again.
 */
export function fitRhythm<T extends Grid>(g: T, beats: number, compound: boolean, straight = false): T {
  const from = g.steps / g.div;
  const div = compound ? 3 : straight && g.div === 3 ? 4 : g.div;
  if (Math.abs(from - beats) < 1e-9 && div === g.div) return g;
  const steps = Math.round(beats * div);
  const bars = Math.max(1, Math.round(g.bars ?? 1));
  const old = Math.max(1, Math.floor(from + 1e-9));
  const rows = {} as Record<DrumId, string>;
  for (const id of DRUM_IDS) {
    const src = g.rows[id] ?? "";
    let out = "";
    for (let b = 0; b < bars; b++)
      for (let j = 0; j < steps; j++) {
        const base = b * g.steps + (Math.floor(j / div) % old) * g.div;
        const at = (i: number) => Number(src[base + i] ?? 0) || 0;
        const k = j % div;
        out += div === g.div ? at(k) : g.div === 3 && div === 4 ? (k < 3 ? at(k) : 0) : g.div === 4 ? (k === 0 ? at(0) : k === 1 ? at(1) : Math.max(at(2), at(3))) : g.div === 2 ? (k === 0 ? at(0) : k === 2 ? at(1) : 0) : at(Math.min(g.div - 1, Math.round((k * g.div) / div)));
      }
    rows[id] = out;
  }
  return { ...g, steps, div, rows, edited: true };
}

/** A chord's length when the bars change: one that lasted whole bars still does. */
export function fitChordBeats(beats: number, from: number, to: number): number {
  if (from === to || beats % from !== 0) return beats;
  return Math.min(16, Math.max(0.5, Math.round((beats / from) * to * 2) / 2));
}

/**
 * A melody when the bars change: every note stays in its bar, at the same place in it. Notes
 * in the part of a bar that is gone are left out. Going to 6/8, 9/8 or 12/8, the grid becomes
 * triplets and notes between the beats move onto them; leaving those (`straight`), the
 * triplets become 16ths.
 */
export function fitMelody(m: Melody, from: number, to: number, compound: boolean, straight = false): Melody {
  const tri = compound && m.div !== 3;
  const str = !compound && straight && m.div === 3;
  if (from === to && !tri && !str) return m;
  const a = Math.round(from * 12);
  const b = Math.round(to * 12);
  const seen = new Set<string>();
  const notes = [];
  for (const n of m.notes) {
    const bar = Math.floor(n.at / a);
    let pos = n.at - bar * a;
    if (pos >= b) continue;
    if (tri) {
      const k = pos % 12;
      pos = pos - k + (k < 2 ? 0 : k < 6 ? 4 : 8);
    } else if (str) {
      const k = pos % 12;
      pos = pos - k + (k < 2 ? 0 : k < 6 ? 3 : 6);
    }
    const at = bar * b + pos;
    const key = `${at}:${n.midi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push({ ...n, at });
  }
  return { ...m, div: tri ? 3 : str ? 4 : m.div, notes };
}

type Rhythm = Parameters<typeof fitRhythm>[0];
/** What to do to every chord, melody and drum rhythm of something (a section, a track's part of it). */
export interface Maps {
  chord?: (c: ProgChord) => ProgChord;
  melody?: (m: Melody) => Melody;
  rhythm?: <T extends Rhythm>(g: T) => T;
}

/** Everything written in one signature, moved into another (see fitChordBeats, fitMelody, fitRhythm). */
export function refit(from: TimeSig, to: TimeSig): Maps {
  const a = sigBeats(from);
  const b = sigBeats(to);
  const comp = isCompound(to);
  // leaving 6/8, 9/8 or 12/8: the triplets become 16ths again
  const straight = isCompound(from) && !comp;
  return {
    chord: (c) => {
      const beats = fitChordBeats(c.beats, a, b);
      return beats === c.beats ? c : { ...c, beats };
    },
    melody: (m) => fitMelody(m, a, b, comp, straight),
    rhythm: (g) => fitRhythm(g, b, comp, straight),
  };
}

/** A list with every item changed; the same list back when nothing changed. */
export const mapList = <T,>(xs: T[], fn: (x: T) => T): T[] => {
  let same = true;
  const out = xs.map((x) => {
    const y = fn(x);
    if (y !== x) same = false;
    return y;
  });
  return same ? xs : out;
};

/** Every track's part of a section changed; the same object back when nothing changed. */
export function mapLayers(ls: Layers | undefined, f: Maps): Layers | undefined {
  if (!ls) return ls;
  const layer = (l: Layer): Layer => {
    const c = l.chords && f.chord ? mapList(l.chords, f.chord) : l.chords;
    const m = l.melody && f.melody ? f.melody(l.melody) : l.melody;
    const b = l.beat && f.rhythm ? f.rhythm(l.beat) : l.beat;
    return c === l.chords && m === l.melody && b === l.beat ? l : { ...l, chords: c, melody: m, beat: b };
  };
  let same = true;
  const out: Layers = {};
  for (const [k, v] of Object.entries(ls)) {
    out[k] = layer(v);
    if (out[k] !== v) same = false;
  }
  return same ? ls : out;
}
