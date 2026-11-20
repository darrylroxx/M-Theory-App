/**
 * One song, one set of rules. Everything in the song that has bars (every chord track, every
 * melody, every drum rhythm, in every section) lives in the bars its section's time signature
 * gives: the song's, or the section's own. `conform` makes that true of any song (it is run on
 * every change, and does nothing when the song already agrees); `setSig` changes the song's
 * signature and takes along every section that follows it; `setSectionSig` changes one section's.
 */
import { DEFAULT_BEAT, barBeats } from "../audio/beats";
import { styleBar } from "../audio/patterns";
import type { Progression } from "../ui/state";
import { DEFAULT_SIG, fitRhythm, isCompound, mapLayers, mapList, refit, sameSig, sigBeats, sigFor, type Maps, type TimeSig } from "./meter";
import { retime, sections, type SongPart } from "./structure";
import { normalize } from "./tracks";
import { outPrint } from "./prints";

/** Which things a change is for: what is on the page, or one section. */
type Scope = "live" | SongPart;

/** Change every chord, melody and drum rhythm of the song, wherever it is kept (`f` says what to do in each place; null = nothing). Unchanged parts keep their identity. */
function mapSong(p: Progression, f: (scope: Scope) => Maps | null): Progression {
  let q = p;
  const put = <K extends keyof Progression>(k: K, v: Progression[K]) => {
    if (v !== q[k]) q = { ...q, [k]: v };
  };
  const live = f("live");
  if (live) {
    put("chords", live.chord ? mapList(p.chords, live.chord) : p.chords);
    put("melody", p.melody && live.melody ? live.melody(p.melody) : p.melody);
    put("beat", p.beat && live.rhythm ? live.rhythm(p.beat) : p.beat);
    put("layers", mapLayers(p.layers, live));
  }
  if (p.song) {
    const parts = mapList(p.song.parts, (x) => {
      const m = f(x);
      if (!m) return x;
      const c = m.chord ? mapList(x.chords, m.chord) : x.chords;
      const me = x.melody && m.melody ? m.melody(x.melody) : x.melody;
      const gr = x.groove && m.rhythm ? m.rhythm(x.groove) : x.groove;
      const ls = mapLayers(x.layers, m);
      return c === x.chords && me === x.melody && gr === x.groove && ls === x.layers ? x : { ...x, chords: c, melody: me, groove: gr, layers: ls };
    });
    if (parts !== p.song.parts) q = { ...q, song: { ...p.song, parts } };
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

/** The song's time signature: the one every section plays in unless it has its own. */
export const sigOf = (p: Progression): TimeSig => p.meter ?? inferSig(p);

/** One section's time signature (the one on screen when no block is given): its own, or the song's. */
export function sectionSig(p: Progression, blockId: string | undefined = p.song?.current): TimeSig {
  const song = p.song;
  const partId = song?.blocks.find((b) => b.id === blockId)?.partId;
  return song?.parts.find((x) => x.id === partId)?.meter ?? sigOf(p);
}

/** Make every drum rhythm of the song fit its section's time signature. A song that already agrees comes back as it is. */
export function conform(p: Progression): Progression {
  const sig = sigOf(p);
  // one fitter per signature, so a song in one signature does no more work than it used to
  const fitters = new Map<string, Maps>();
  const fit = (s: TimeSig): Maps => {
    const k = `${s.num}/${s.den}`;
    let m = fitters.get(k);
    if (!m) {
      const beats = sigBeats(s);
      const comp = isCompound(s);
      m = { rhythm: (g) => fitRhythm(g, beats, comp) };
      fitters.set(k, m);
    }
    return m;
  };
  const song = p.song;
  const cur = song?.parts.find((x) => x.id === song.blocks.find((b) => b.id === song.current)?.partId);
  const q = mapSong(p, (scope) => fit((scope === "live" ? cur?.meter : scope.meter) ?? sig));
  return q.meter ? q : { ...q, meter: sig };
}

/**
 * Change the song's time signature. Every section that follows it goes along: chords that
 * lasted whole bars still do; melody notes stay in their bars; every drum rhythm is fitted to
 * the new bars. Sections with a signature of their own are left as they are. Recorded audio
 * cannot follow.
 */
export function setSig(p0: Progression, sig: TimeSig): Progression {
  const p = conform(p0);
  if (sameSig(p.meter, sig)) return p;
  if (!p.song) {
    const f = refit(p.meter!, sig);
    const q = mapSong({ ...p, meter: sig }, (scope) => (scope === "live" ? f : null));
    // a harmony track fitted to the new bars is still what was written, only fitted: its record of the
    // page follows (unless changed by hand before), as it does for a song's sections, so it does not look changed by hand
    const was = normalize(p).layers;
    const now = normalize(q).layers;
    const tracks = q.tracks?.map((t) => {
      const m = t.harmony?.marks?.[""];
      if (!m || m.out !== outPrint(was?.[t.id])) return t;
      return { ...t, harmony: { ...t.harmony!, marks: { ...t.harmony!.marks, "": { ...m, out: outPrint(now?.[t.id]) } } } };
    });
    return tracks ? { ...q, tracks } : q;
  }
  return retime(p, sig);
}

/**
 * Give one section a time signature of its own (the song's = it follows the song again). Only
 * that section's chords, melody, drums and tracks are fitted to its new bars, the same way a
 * change for the whole song fits them; every other section sounds as it did.
 */
export function setSectionSig(p0: Progression, blockId: string, sig: TimeSig): Progression {
  const p = conform(p0);
  // with no song yet, the page is the only section: its signature is the song's
  if (!p.song) return setSig(p, sig);
  return conform(retime(p, p.meter!, { block: blockId || p.song.current, sig }));
}
