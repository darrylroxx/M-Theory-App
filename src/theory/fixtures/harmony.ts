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
  chords: [root: string, typeId: string, beats: number, bass?: string][];
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
  const chords: ProgChord[] = f.chords.map(([root, typeId, beats, bass]) => ({ id: `${f.name}-${n++}`, ref: { root, typeId, ...(bass ? { bass } : {}) }, beats }));
  const melody: Melody = { div: f.div, bars: f.bars, notes: f.tune.map(([b, midi]) => ({ at: Math.round(b * TICKS), midi })) };
  return { name: f.name, key: f.key, bar: f.bar, bars: f.bars, compound: f.compound, chords, melody, len: Math.round(f.bars * f.bar * TICKS) };
}
export const BUILT: Built[] = FIXTURES.map(build);

/**
 * Eight more sections, written for the listening review of the harmony engine (none from any
 * recording): busy and sparse tunes, a waltz, 6/8 runs, borrowed chords in the tune, a high tune
 * in sixteenths, a low tune, a secondary dominant. The review's findings are tested on these.
 */
export const REVIEW_FIXTURES: Fixture[] = [
  {
    name: "rev-G-busy", feel: "G major 4/4, 8 bars, busy eighths, slash chord, m7 and dom7", key: { tonic: "G", scaleId: "ionian" }, bar: 4, compound: false, bars: 8, div: 2,
    chords: [["G", "maj", 4], ["D", "maj", 4, "F#"], ["E", "min", 4], ["C", "maj", 4], ["A", "m7", 4], ["D", "7", 4], ["G", "maj", 2], ["E", "min", 2], ["C", "maj", 2], ["D", "maj", 2]],
    tune: [[0, 71], [0.5, 69], [1, 67], [1.5, 69], [2, 71], [3, 74], [3.5, 71], [4, 69], [4.5, 66], [5, 69], [6, 74], [7, 76], [7.5, 74], [8, 71], [8.5, 67], [9, 64], [9.5, 67], [10, 71], [11, 69], [11.5, 67], [12, 67], [12.5, 64], [13, 67], [14, 72], [16, 72], [16.5, 71], [17, 69], [17.5, 67], [18, 64], [19, 67], [19.5, 69], [20, 66], [20.5, 69], [21, 72], [22, 69], [23, 66], [23.5, 64], [24, 62], [25, 67], [25.5, 71], [26, 71], [27, 67], [28, 64], [28.5, 67], [29, 72], [30, 69], [30.5, 66], [31, 74]],
  },
  {
    name: "rev-Cm-sparse", feel: "C minor 4/4, 8 bars, half and whole notes, harmonic-minor V7", key: { tonic: "C", scaleId: "aeolian" }, bar: 4, compound: false, bars: 8, div: 1,
    chords: [["C", "min", 4], ["Ab", "maj", 4], ["F", "min", 4], ["G", "7", 4], ["C", "min", 4], ["Eb", "maj", 4], ["F", "min", 2], ["G", "7", 2], ["C", "min", 4]],
    tune: [[0, 67], [2, 75], [4, 72], [7, 70], [8, 68], [10, 72], [12, 71], [14, 74], [16, 67], [17, 68], [18, 67], [20, 70], [22, 67], [24, 68], [26, 65], [28, 63]],
  },
  {
    name: "rev-F-waltz", feel: "F major 3/4, 8 bars, quarter notes and a few eighths", key: { tonic: "F", scaleId: "ionian" }, bar: 3, compound: false, bars: 8, div: 2,
    chords: [["F", "maj", 3], ["Bb", "maj", 3], ["C", "7", 3], ["F", "maj", 3], ["D", "min", 3], ["G", "min", 3], ["C", "7", 3], ["F", "maj", 3]],
    tune: [[0, 69], [2, 72], [3, 74], [5, 70], [6, 67], [8, 64], [9, 65], [12, 65], [12.5, 67], [13, 69], [14, 74], [15, 74], [16, 70], [17, 67], [18, 67], [19, 70], [19.5, 69], [20, 67], [21, 65]],
  },
  {
    name: "rev-Dm-68", feel: "D minor 6/8, 4 bars, eighth-note runs, A7", key: { tonic: "D", scaleId: "aeolian" }, bar: 2, compound: true, bars: 4, div: 3,
    chords: [["D", "min", 2], ["Bb", "maj", 2], ["G", "min", 2], ["A", "7", 2]],
    tune: [[e(0), 69], [e(1), 70], [e(2), 69], [e(3), 65], [e(6), 74], [e(7), 72], [e(8), 70], [e(9), 65], [e(10), 67], [e(11), 69], [e(12), 70], [e(14), 69], [e(15), 67], [e(16), 65], [e(17), 64], [e(18), 73], [e(21), 69]],
  },
  {
    name: "rev-C-borrowed", feel: "C major 4/4, 4 bars, borrowed iv, bVI and bVII, A-flat and E-flat in the tune", key: { tonic: "C", scaleId: "ionian" }, bar: 4, compound: false, bars: 4, div: 2,
    chords: [["C", "maj", 4], ["F", "min", 4], ["Ab", "maj", 2], ["Bb", "maj", 2], ["C", "maj", 4]],
    tune: [[0, 67], [1, 72], [2, 76], [3.5, 74], [4, 72], [6, 68], [7, 65], [8, 75], [9, 72], [10, 74], [11, 77], [12, 76], [14, 67], [15, 72]],
  },
  {
    name: "rev-E-high", feel: "E major 4/4, 4 bars, sixteenths, high (B4 to C#6)", key: { tonic: "E", scaleId: "ionian" }, bar: 4, compound: false, bars: 4, div: 4,
    chords: [["E", "maj", 4], ["C#", "min", 4], ["A", "maj", 4], ["B", "7", 4]],
    tune: [[0, 71], [0.25, 76], [0.5, 80], [0.75, 83], [1, 80], [1.5, 76], [2, 78], [2.25, 80], [2.5, 78], [2.75, 76], [3, 71], [4, 76], [4.25, 80], [4.5, 85], [4.75, 83], [5, 80], [5.5, 76], [6, 75], [6.25, 76], [6.5, 78], [6.75, 80], [7, 76], [8, 85], [8.5, 83], [9, 81], [9.25, 80], [9.5, 78], [9.75, 76], [10, 73], [11, 76], [11.5, 81], [12, 78], [12.25, 75], [12.5, 71], [12.75, 75], [13, 78], [14, 81], [14.5, 80], [15, 78]],
  },
  {
    name: "rev-Em-low", feel: "E minor 3/4, 8 bars, a low tune (E3 to E4), B7", key: { tonic: "E", scaleId: "aeolian" }, bar: 3, compound: false, bars: 8, div: 1,
    chords: [["E", "min", 3], ["C", "maj", 3], ["D", "maj", 3], ["B", "7", 3], ["E", "min", 3], ["A", "min", 3], ["B", "7", 3], ["E", "min", 3]],
    tune: [[0, 59], [2, 55], [3, 60], [5, 59], [6, 57], [7, 54], [8, 57], [9, 59], [11, 57], [12, 55], [15, 57], [16, 60], [17, 64], [18, 63], [20, 59], [21, 52]],
  },
  {
    name: "rev-Bb-68", feel: "B-flat major 6/8, 4 bars, sparse, D7 as V of vi, a split last bar", key: { tonic: "Bb", scaleId: "ionian" }, bar: 2, compound: true, bars: 4, div: 3,
    chords: [["Bb", "maj", 2], ["D", "7", 2], ["G", "min", 2], ["Eb", "maj", 1], ["F", "maj", 1]],
    tune: [[0, 65], [1, 74], [2, 69], [3, 66], [4, 67], [6, 70], [7, 69]],
  },
];
export const REVIEW: Built[] = REVIEW_FIXTURES.map(build);
