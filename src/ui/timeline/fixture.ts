// One song built by hand, for the page that shows the track view before the app uses it (and for its tests):
// 96 beats a minute in B major, 24 bars. Bars 1–16 are in 4/4, bars 17–20 in 6/8, bars 21–24 in 4/4 again.
// Six tracks: Chords, Melody, Bass, Drums (a 4-bar rhythm at bars 5–8), Drums 2 (a 1-bar rhythm over bars 1–4, so
// three notches), and Vocal 1 with one take of 12 seconds whose clip at bar 9 shows its first 8.
import { emptyRows, type Groove } from "../../audio/beats";
import type { DrumId } from "../../audio/drums";
import type { Melody } from "../../song/melody";
import type { TimeSig } from "../../song/meter";
import type { Key } from "../../theory/keys";
import { addTrack } from "../../timeline/edit";
import type { AudioTrack, Clip, Session, Take5, TimelineSong } from "../../timeline/model";
import type { ProgChord } from "../state";

const SIG44: TimeSig = { num: 4, den: 4 };
const SIG68: TimeSig = { num: 6, den: 8 };

export const FIXTURE_KEY: Key = { tonic: "B", scaleId: "ionian" };

/** The tracks' ids, top to bottom. */
export const FIX = { chords: "fx-chords", melody: "fx-melody", bass: "fx-bass", drums: "fx-drums", drums2: "fx-drums2", vocal: "fx-vocal" } as const;

/** Chords, one to the bar. */
const bars = (prefix: string, names: [string, string][]): ProgChord[] => names.map(([root, typeId], i) => ({ id: `${prefix}${i + 1}`, ref: { root, typeId }, beats: 4 }));
/** A tune: [beat, note] pairs. */
const tune = (bars: number, notes: [number, number][]): Melody => ({ div: 2, bars, notes: notes.map(([beat, midi]) => ({ at: Math.round(beat * 12), midi })) });
/** A rhythm from rows written out: "x" a hit, "X" a loud one, "o" a soft one, "." nothing; "|" and spaces are only for the eye. */
function rhythm(name: string, bars: number, rows: Partial<Record<DrumId, string>>): Groove {
  const steps = 16;
  const out = emptyRows(steps * bars);
  for (const [id, src] of Object.entries(rows) as [DrumId, string][]) {
    const s = src.replace(/[|\s]/g, "");
    out[id] = Array.from({ length: steps * bars }, (_, i) => ({ ".": "0", o: "1", x: "2", X: "3" })[s[i] ?? "."] ?? "0").join("");
  }
  return { patternId: null, name, edited: true, steps, div: 4, bars, swing: 0, rows: out };
}

/** The song, new each time. */
export function fixtureSong(): TimelineSong {
  let song: TimelineSong = { v: 5, bpm: 96, meter: SIG44, sigs: [{ bar: 16, sig: SIG68 }, { bar: 20, sig: SIG44 }], tracks: [], clips: [], end: 88 };
  song = addTrack(song, "chords", FIX.chords);
  song = addTrack(song, "melody", FIX.melody);
  song = addTrack(song, "bass", FIX.bass);
  song = addTrack(song, "drums", FIX.drums);
  song = addTrack(song, "drums", FIX.drums2);
  song = addTrack(song, "vocals", FIX.vocal);

  const sung: Take5 = { id: "fx-take1", n: 1, group: "fx-rec1", dry: "fx-take1-dry.wav", wet: "fx-take1-wet.wav", rate: 48000, start: 0, frames: 12 * 48000, at: 32, bpm: 96, key: "B|ionian", sig: "4/4" };
  song = { ...song, tracks: song.tracks.map((t) => (t.id === FIX.vocal ? ({ ...t, takes: [sung] } as AudioTrack) : t)) };

  const verse = bars("v", [["B", "maj"], ["E", "maj"], ["G#", "min"], ["F#", "maj"], ["B", "maj"], ["E", "maj"], ["C#", "min"], ["F#", "maj"]]);
  const chorus = bars("c", [["E", "maj"], ["B", "maj"], ["F#", "maj"], ["G#", "min"], ["E", "maj"], ["B", "maj"], ["F#", "maj"], ["F#", "maj"]]);
  const clips: Clip[] = [
    { id: "fx-c1", track: FIX.chords, kind: "chords", start: 0, len: 32, off: 0, sig: SIG44, content: { chords: verse, bars: 8, style: "ring" } },
    { id: "fx-c2", track: FIX.chords, kind: "chords", start: 32, len: 32, off: 0, sig: SIG44, content: { chords: chorus, bars: 8, style: "ring" } },
    {
      id: "fx-m1", track: FIX.melody, kind: "melody", start: 32, len: 32, off: 0, sig: SIG44,
      content: tune(8, [[0, 71], [1, 73], [2, 75], [3.5, 73], [4, 71], [6, 66], [8, 68], [9, 70], [10, 71], [11.5, 73], [12, 75], [14, 73], [16, 76], [17, 75], [18, 73], [19.5, 71], [20, 70], [22, 66], [24, 68], [25, 70], [26, 71], [28, 70], [30, 66]]),
    },
    {
      id: "fx-b1", track: FIX.bass, kind: "melody", start: 0, len: 32, off: 0, sig: SIG44,
      content: tune(8, [[0, 35], [2, 35], [3, 42], [4, 40], [6, 40], [7, 44], [8, 44], [10, 44], [11, 39], [12, 42], [14, 42], [15, 37], [16, 35], [18, 35], [19, 42], [20, 40], [22, 40], [23, 44], [24, 37], [26, 37], [27, 44], [28, 42], [30, 42], [31, 46]]),
    },
    {
      id: "fx-d1", track: FIX.drums, kind: "drums", start: 16, len: 16, off: 0, sig: SIG44,
      content: rhythm("Four bars", 4, {
        kick: "X...|..x.|X...|....| X...|..x.|X.x.|....| X...|..x.|X...|....| X...|..x.|X.x.|..x.",
        snare: "....|X...|....|X...| ....|X...|....|X...| ....|X...|....|X...| ....|X...|....|X.xx",
        hat: "x.x.|x.x.|x.x.|x.x.| x.x.|x.x.|x.x.|x.x.| x.x.|x.x.|x.x.|x.x.| x.x.|x.x.|x.x.|....",
        open: "....|....|....|....| ....|....|....|..x.| ....|....|....|....| ....|....|....|....",
        tom: "....|....|....|....| ....|....|....|....| ....|....|....|....| ....|....|....|x.x.",
      }),
    },
    {
      id: "fx-d2", track: FIX.drums2, kind: "drums", start: 0, len: 16, off: 0, sig: SIG44,
      content: rhythm("One bar", 1, { shaker: "x.ox|x.ox|x.ox|x.ox", rim: "....|x...|..x.|x...", kick: "X...|....|x...|...." }),
    },
    { id: "fx-a1", track: FIX.vocal, kind: "audio", take: sung.id, start: 32, from: 0, to: sung.frames, off: 0, frames: 8 * 48000 },
  ];
  return {
    ...song,
    clips,
    markers: [{ id: "fx-mk1", beat: 0, name: "Verse" }, { id: "fx-mk2", beat: 32, name: "Chorus" }, { id: "fx-mk3", beat: 64, name: "Bridge" }, { id: "fx-mk4", beat: 72, name: "Out" }],
  };
}

/** The session an idea opens with: nothing selected, no loop, the cursor at the start, and no zoom chosen yet (the view then shows the whole song). */
export const fixtureSession = (): Session => ({ cursor: 0, loop: null, sel: { clips: [], track: null }, pxPerBeat: 0, scroll: 0, armed: null, windows: [] });

/** A made-up waveform for a take: phrases that swell and fall, the same every time for the same take. */
const waves = new Map<string, Float32Array>();
export function fixturePeaks(take: Take5): Float32Array {
  let w = waves.get(take.id);
  if (w) return w;
  const n = 480;
  w = new Float32Array(n);
  let seed = 7;
  for (const ch of take.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    const t = i / n;
    // six phrases, each rising quickly and dying away, with a breath between
    const phrase = (t * 6) % 1;
    const env = phrase < 0.08 ? phrase / 0.08 : phrase > 0.82 ? Math.max(0, (1 - phrase) / 0.18) * 0.3 : 1 - (phrase - 0.08) * 0.55;
    w[i] = Math.min(1, Math.max(0.03, env * (0.45 + 0.5 * rand())));
  }
  waves.set(take.id, w);
  return w;
}
