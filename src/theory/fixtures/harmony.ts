/**
 * Sections to test Harmonize on (test-only): major and minor, pop, ballad, rock, R&B and folk
 * feels, 4/4 and 6/8, plus the section the harmony work started from (C G Am F with a plain tune).
 * Times in beats (6/8: a beat is a dotted quarter, an eighth is a third of a beat). Each melody
 * note is [start in beats, midi]. No fixture is taken from any recording.
 */
import type { ProgChord } from "../../ui/state";
import type { Key } from "../keys";
import { TICKS, type Melody } from "../../song/melody";

export interface Fixture {
  name: string;
  feel: string;
  key: Key;
  /** beats in a bar (6/8 = 2) */
  bar: number;
  compound: boolean;
  bars: number;
  chords: [root: string, typeId: string, beats: number][];
  div: 1 | 2 | 3 | 4;
  tune: [beat: number, midi: number][];
}

/** 6/8 helper: eighth-note index -> beats */
const e = (i: number) => i / 3;

export const FIXTURES: Fixture[] = [
  {
    name: "user-E", feel: "pop, major, 4/4, I-V-vi-IV, one quarter note a beat", key: { tonic: "C", scaleId: "ionian" }, bar: 4, compound: false, bars: 4, div: 2,
    chords: [["C", "maj", 4], ["G", "maj", 4], ["A", "min", 4], ["F", "maj", 4]],
    tune: [64, 65, 67, 67, 67, 69, 67, 64, 65, 64, 62, 60, 65, 69, 72, 69].map((m, i) => [i, m] as [number, number]),
  },
  {
    name: "pop-C", feel: "pop, major, 4/4, I-V-vi-IV, syncopated eighths", key: { tonic: "C", scaleId: "ionian" }, bar: 4, compound: false, bars: 4, div: 2,
    chords: [["C", "maj", 4], ["G", "maj", 4], ["A", "min", 4], ["F", "maj", 4]],
    tune: [[0, 67], [1, 67], [1.5, 64], [2, 64], [3, 62], [3.5, 60], [4, 62], [5, 62], [5.5, 67], [6, 67], [7, 71], [7.5, 69], [8, 69], [9, 72], [10, 71], [10.5, 69], [11, 67], [12, 65], [13, 69], [14, 72], [15, 69], [15.5, 67]],
  },
  {
    name: "ballad-D", feel: "ballad, major, 4/4, I-vi-IV-V, long notes with 9ths", key: { tonic: "D", scaleId: "ionian" }, bar: 4, compound: false, bars: 4, div: 2,
    chords: [["D", "maj", 4], ["B", "min", 4], ["G", "maj", 4], ["A", "maj", 4]],
    tune: [[0, 66], [2, 64], [3, 66], [4, 74], [6, 73], [7, 71], [8, 71], [9.5, 69], [10, 67], [12, 69], [13, 71], [14, 73]],
  },
  {
    name: "rock-A-low", feel: "rock, major with bVII, 4/4, low male range, one blue note", key: { tonic: "A", scaleId: "ionian" }, bar: 4, compound: false, bars: 4, div: 2,
    chords: [["A", "maj", 4], ["G", "maj", 4], ["D", "maj", 4], ["A", "maj", 4]],
    tune: [[0, 57], [0.5, 57], [1, 59], [2, 61], [3, 59], [3.5, 57], [4, 55], [5, 59], [6, 62], [7, 59], [8, 57], [9, 54], [10, 57], [11, 62], [11.5, 60], [12, 61], [14, 59], [15, 57]],
  },
  {
    name: "rnb-F", feel: "R&B, major sevenths, 4/4, IVmaj7-iii7-ii7-V7, off-beat phrasing", key: { tonic: "F", scaleId: "ionian" }, bar: 4, compound: false, bars: 4, div: 2,
    chords: [["Bb", "maj7", 4], ["A", "m7", 4], ["G", "m7", 4], ["C", "7", 4]],
    tune: [[0.5, 72], [1, 69], [1.5, 67], [2.5, 65], [3.5, 67], [4.5, 72], [5, 67], [6, 64], [6.5, 65], [7, 67], [8, 70], [8.5, 72], [9, 74], [10.5, 72], [11, 69], [12, 70], [12.5, 69], [13, 67], [14, 64], [15, 62]],
  },
  {
    name: "folk-G-68", feel: "folk, major, 6/8, I-IV-I-V", key: { tonic: "G", scaleId: "ionian" }, bar: 2, compound: true, bars: 4, div: 3,
    chords: [["G", "maj", 2], ["C", "maj", 2], ["G", "maj", 2], ["D", "maj", 2]],
    tune: [[e(0), 74], [e(2), 71], [e(3), 67], [e(5), 71], [e(6), 72], [e(8), 76], [e(9), 74], [e(11), 72], [e(12), 71], [e(15), 67], [e(16), 69], [e(17), 71], [e(18), 69], [e(21), 66], [e(22), 64], [e(23), 62]],
  },
  {
    name: "minor-ballad-Am", feel: "ballad, minor, 4/4, i-VI-III-VII", key: { tonic: "A", scaleId: "aeolian" }, bar: 4, compound: false, bars: 4, div: 2,
    chords: [["A", "min", 4], ["F", "maj", 4], ["C", "maj", 4], ["G", "maj", 4]],
    tune: [[0, 64], [1.5, 67], [2, 69], [3, 72], [4, 72], [6, 69], [7, 71], [8, 72], [9, 74], [10, 76], [12, 74], [14, 71], [15, 67]],
  },
  {
    name: "minor-Em-68", feel: "folk/ballad, minor, 6/8, i-iv-V7-i with the raised 7th", key: { tonic: "E", scaleId: "aeolian" }, bar: 2, compound: true, bars: 4, div: 3,
    chords: [["E", "min", 2], ["A", "min", 2], ["B", "7", 2], ["E", "min", 2]],
    tune: [[e(0), 71], [e(1), 72], [e(2), 71], [e(3), 67], [e(5), 64], [e(6), 69], [e(8), 72], [e(9), 76], [e(11), 72], [e(12), 71], [e(14), 75], [e(15), 78], [e(17), 75], [e(18), 76], [e(21), 71], [e(22), 67], [e(23), 64]],
  },
  {
    name: "minor-pop-Dm", feel: "modern pop, minor, 4/4, i-VI-III-VII, repeated-note eighths", key: { tonic: "D", scaleId: "aeolian" }, bar: 4, compound: false, bars: 4, div: 2,
    chords: [["D", "min", 4], ["Bb", "maj", 4], ["F", "maj", 4], ["C", "maj", 4]],
    tune: [[0, 69], [0.5, 69], [1, 69], [1.5, 67], [2, 65], [2.5, 65], [3, 67], [3.5, 69], [4, 70], [4.5, 70], [5, 70], [5.5, 69], [6, 65], [6.5, 62], [7, 65], [8, 69], [8.5, 69], [9, 72], [9.5, 69], [10, 67], [10.5, 65], [11, 65], [12, 64], [12.5, 64], [13, 67], [14, 64], [14.5, 62], [15, 60]],
  },
];

/** A fixture as the song holds it: chords and a melody in ticks. */
export interface Built {
  name: string;
  key: Key;
  bar: number;
  bars: number;
  compound: boolean;
  chords: ProgChord[];
  melody: Melody;
  /** the section's length in ticks */
  len: number;
}
export function build(f: Fixture): Built {
  let n = 0;
  const chords: ProgChord[] = f.chords.map(([root, typeId, beats]) => ({ id: `${f.name}-${n++}`, ref: { root, typeId }, beats }));
  const melody: Melody = { div: f.div, bars: f.bars, notes: f.tune.map(([b, midi]) => ({ at: Math.round(b * TICKS), midi })) };
  return { name: f.name, key: f.key, bar: f.bar, bars: f.bars, compound: f.compound, chords, melody, len: Math.round(f.bars * f.bar * TICKS) };
}
export const BUILT: Built[] = FIXTURES.map(build);
