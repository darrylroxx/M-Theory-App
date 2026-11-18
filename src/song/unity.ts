/**
 * One song, one set of rules. Everything in the song that has bars (every chord track, every
 * melody, every drum rhythm, in every section) lives in the bars the time signature gives.
 * `conform` makes that true of any song (it is run on every change, and does nothing when the
 * song already agrees); `setSig` changes the signature and takes the whole song along.
 */
import { DEFAULT_BEAT, barBeats } from "../audio/beats";
import { styleBar } from "../audio/patterns";
import type { ProgChord, Progression } from "../ui/state";
import { DEFAULT_SIG, fitChordBeats, fitMelody, fitRhythm, isCompound, sameSig, sigBeats, sigFor, type TimeSig } from "./meter";
import type { Melody } from "./melody";
import { sections } from "./structure";
import { normalize, type Layer, type Layers } from "./tracks";

type Rhythm = Parameters<typeof fitRhythm>[0];
interface Maps {
  chord?: (c: ProgChord) => ProgChord;
  melody?: (m: Melody) => Melody;
  rhythm?: <T extends Rhythm>(g: T) => T;
}

/** A list with every item changed; the same list back when nothing changed. */
const mapList = <T,>(xs: T[], fn: (x: T) => T): T[] => {
  let same = true;
  const out = xs.map((x) => {
    const y = fn(x);
    if (y !== x) same = false;
    return y;
  });
  return same ? xs : out;
};

/** Change every chord, melody and drum rhythm of the song, wherever it is kept. Unchanged parts keep their identity. */
function mapSong(p: Progression, f: Maps): Progression {
  const chords = (cs: ProgChord[] | undefined) => (cs && f.chord ? mapList(cs, f.chord) : cs);
  const melody = (m: Melody | undefined) => (m && f.melody ? f.melody(m) : m);
  const rhythm = <T extends Rhythm>(g: T | undefined) => (g && f.rhythm ? f.rhythm(g) : g);
  const layer = (l: Layer): Layer => {
    const c = chords(l.chords);
    const m = melody(l.melody);
    const b = rhythm(l.beat);
    return c === l.chords && m === l.melody && b === l.beat ? l : { ...l, chords: c, melody: m, beat: b };
  };
  const layers = (ls: Layers | undefined): Layers | undefined => {
    if (!ls) return ls;
    let same = true;
    const out: Layers = {};
    for (const [k, v] of Object.entries(ls)) {
      out[k] = layer(v);
      if (out[k] !== v) same = false;
    }
    return same ? ls : out;
  };
  let q = p;
  const put = <K extends keyof Progression>(k: K, v: Progression[K]) => {
    if (v !== q[k]) q = { ...q, [k]: v };
  };
  put("chords", chords(p.chords)!);
  put("melody", melody(p.melody));
  put("beat", rhythm(p.beat));
  put("layers", layers(p.layers));
  if (p.song) {
    const sh = p.song.shared;
    const g = rhythm(sh?.groove);
    const shared = sh && g !== sh.groove ? { ...sh, groove: g } : sh;
    const parts = mapList(p.song.parts, (x) => {
      const c = chords(x.chords)!;
      const m = melody(x.melody);
      const gr = rhythm(x.groove);
      const ls = layers(x.layers);
      return c === x.chords && m === x.melody && gr === x.groove && ls === x.layers ? x : { ...x, chords: c, melody: m, groove: gr, layers: ls };
    });
    if (shared !== sh || parts !== p.song.parts) q = { ...q, song: { ...p.song, shared, parts } };
  }
  return q;
}

/**
 * The signature a song from before signatures has: the one its first section played in (its
 * drum rhythm's bars, or its playing style's when the drums were off).
 */
function inferSig(p: Progression): TimeSig {
  try {
    const np = normalize(p);
    const first = sections(np)[0];
    const live = np.beat ?? DEFAULT_BEAT;
    const g = first?.groove ?? live;
    const on = first ? first.groove?.on ?? live.on : live.on;
    const beats = on ? barBeats(g) : styleBar(first?.style ?? np.pattern);
    return sigFor(beats, on && g.div === 3);
  } catch {
    return DEFAULT_SIG;
  }
}

/** The song's time signature. */
export const sigOf = (p: Progression): TimeSig => p.meter ?? inferSig(p);

/** Make every drum rhythm of the song fit its time signature. A song that already agrees comes back as it is. */
export function conform(p: Progression): Progression {
  const sig = sigOf(p);
  const beats = sigBeats(sig);
  const comp = isCompound(sig);
  const q = mapSong(p, { rhythm: (g) => fitRhythm(g, beats, comp) });
  return q.meter ? q : { ...q, meter: sig };
}

/**
 * Change the time signature. Chords that lasted whole bars still do; melody notes stay in
 * their bars; every drum rhythm is fitted to the new bars. Recorded audio cannot follow.
 */
export function setSig(p0: Progression, sig: TimeSig): Progression {
  const p = conform(p0);
  if (sameSig(p.meter, sig)) return p;
  const from = sigBeats(p.meter!);
  const to = sigBeats(sig);
  const comp = isCompound(sig);
  // leaving 6/8, 9/8 or 12/8: the triplets become 16ths again
  const straight = isCompound(p.meter!) && !comp;
  return mapSong({ ...p, meter: sig }, {
    chord: (c) => {
      const beats = fitChordBeats(c.beats, from, to);
      return beats === c.beats ? c : { ...c, beats };
    },
    melody: (m) => fitMelody(m, from, to, comp, straight),
    rhythm: (g) => fitRhythm(g, to, comp, straight),
  });
}
