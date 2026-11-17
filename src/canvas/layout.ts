/**
 * Where things go on the canvas.
 *
 * Time runs from left to right: the canvas is as wide as the section (long sections take several
 * canvases, one after another). Frequency runs from bottom to top, an octave to every equal step:
 * the kick and the bass strings at the bottom, the chords and the melody above them at the height
 * of their own notes, their overtones above those, and the cymbals and shakers at the very top.
 */
import { F_HI, F_LO } from "../audio/describe";

/** Where the music is: which section, and how far into it. */
export interface Spot {
  /** the section's letter: the same letter is the same painting */
  key: string;
  /** how many sections come before this one in the alphabet of the song (A = 0): shifts its colours */
  index: number;
  /** beats into the section */
  beat: number;
  /** beats in a bar, and bars in the section */
  bar: number;
  bars: number;
  /** seconds per beat */
  spb: number;
}

/** No more bars than this share one canvas: more, and the marks crowd each other out. */
export const maxBars = (width: number) => (width < 520 ? 4 : 8);

export interface Page {
  /** the section's letter and which of its canvases this is: the name of the painting */
  key: string;
  page: number;
  pages: number;
  /** bars on each of the section's canvases */
  perPage: number;
  /** how far across this canvas the music is, 0..1 */
  frac: number;
}

/** Which canvas of the section the music is on, and how far across it. */
export function pageOf(spot: Spot, width: number): Page {
  const bars = Math.max(1, Math.round(spot.bars));
  const pages = Math.ceil(bars / maxBars(width));
  const perPage = Math.ceil(bars / pages);
  const at = Math.max(0, spot.beat / spot.bar);
  const page = Math.min(pages - 1, Math.floor(at / perPage + 1e-9));
  const frac = Math.max(0, Math.min(1, (at - page * perPage) / perPage));
  return { key: `${spot.key}:${page}`, page, pages, perPage, frac };
}

/** The canvas keeps a margin left and right, so a mark made on the first or last beat has room. */
export const MARGIN = 0.06;
export const xOf = (frac: number, width: number) => width * (MARGIN + frac * (1 - 2 * MARGIN));
/** How many pixels the music moves across the canvas in a second. */
export const speed = (page: Page, spot: Spot, width: number) => (width * (1 - 2 * MARGIN)) / (page.perPage * spot.bar * spot.spb);

/**
 * Up and down is frequency: the lowest hum the app can make at the bottom, the top of hearing
 * that matters in a mix at the top, and every sound painted at the height of the frequencies it
 * is really made of.
 *
 * An octave is a fixed step up the canvas, as on any analyser, but the step is not the same size
 * everywhere: the four octaves the notes of a song live in (80 Hz to 1.3 kHz) get the biggest
 * steps, so that notes a tone apart can be told apart; the rumble below them and the hiss and
 * shimmer far above them get smaller ones. The ruler at the edge of the canvas shows where each
 * frequency is.
 */
export const TOP = 0.045;
export const BOTTOM = 0.955;
/** The scale: marks along it, each a frequency (hertz) and how far up the scale it sits (0 = the bottom, 1 = the top). Between two marks, equal steps are equal parts of an octave. */
export const SCALE: readonly (readonly [number, number])[] = [
  [F_LO, 0],
  [80, 0.095],
  [1280, 0.675],
  [5120, 0.855],
  [F_HI, 1],
];

/** The frequency of a note (MIDI number; 69 = the A above middle C = 440 Hz), and the note nearest a frequency. */
export const hzOfMidi = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
export const midiOfHz = (hz: number) => 69 + 12 * Math.log2(Math.max(1e-6, hz) / 440);

/** How far up the scale a frequency sits: 0 = the bottom, 1 = the top. Frequencies off the scale are kept at its ends. */
export function upOfHz(hz: number): number {
  const f = Math.max(F_LO, Math.min(F_HI, hz));
  for (let i = 1; i < SCALE.length; i++) {
    const [f1, u1] = SCALE[i];
    if (f <= f1) {
      const [f0, u0] = SCALE[i - 1];
      return u0 + ((u1 - u0) * Math.log2(f / f0)) / Math.log2(f1 / f0);
    }
  }
  return 1;
}
/** How far down the canvas a frequency sits (pixels from the top): higher sounds higher up. */
export const yOfHz = (hz: number, height: number) => height * (BOTTOM - upOfHz(hz) * (BOTTOM - TOP));
/** The frequency at a height on the canvas. */
export function hzOfY(y: number, height: number): number {
  const up = Math.max(0, Math.min(1, (BOTTOM - y / height) / (BOTTOM - TOP)));
  for (let i = 1; i < SCALE.length; i++) {
    const [f1, u1] = SCALE[i];
    if (up <= u1) {
      const [f0, u0] = SCALE[i - 1];
      return f0 * Math.pow(f1 / f0, (up - u0) / (u1 - u0));
    }
  }
  return F_HI;
}
/** How many pixels tall a stretch of the scale is: so many octaves wide, centred on a frequency. */
export const spanPx = (hz: number, octaves: number, height: number) => Math.abs(yOfHz(hz * Math.pow(2, octaves / 2), height) - yOfHz(hz * Math.pow(2, -octaves / 2), height));

/** The frequencies marked on the ruler. */
export const RULER_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
export const hzLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`);
/** The regions of a mix, as people who mix call them, lowest first (hertz). (The high mids take in what is also called presence, 4 to 6 kHz.) */
export const REGIONS = [
  { name: "Sub", short: "Sub", from: F_LO, to: 60 },
  { name: "Bass", short: "Bass", from: 60, to: 250 },
  { name: "Low mids", short: "Lo-mid", from: 250, to: 500 },
  { name: "Mids", short: "Mid", from: 500, to: 2000 },
  { name: "High mids", short: "Hi-mid", from: 2000, to: 6000 },
  { name: "Air", short: "Air", from: 6000, to: F_HI },
] as const;

/**
 * Which colour of the palette each of the twelve notes takes, in this key.
 *
 * Notes a fifth apart are the closest relatives in music, so the notes of the key are laid out in
 * fifths and share the palette out between them in that order: every colour gets used, a chord
 * is a family of neighbouring colours, and a change of chord is a change of colour. A note from
 * outside the key takes the colour of its nearest relative inside it.
 */
export function noteColors(tonicPc: number, scale: number[], colors: number): number[] {
  const mod = (n: number) => ((n % 12) + 12) % 12;
  const fifths = (pc: number) => mod((pc - tonicPc) * 7);
  const pcs = [...new Set((scale.length ? scale : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]).map(mod))].sort((a, b) => fifths(a) - fifths(b));
  const m = pcs.length;
  // the row starts after the widest gap in the circle, so neighbours in the circle stay neighbours in the row
  let start = 0;
  let widest = -1;
  for (let i = 0; i < m; i++) {
    const gap = mod(fifths(pcs[(i + 1) % m]) - fifths(pcs[i])) || 12;
    if (gap > widest) {
      widest = gap;
      start = (i + 1) % m;
    }
  }
  const row = pcs.map((_, i) => pcs[(start + i) % m]);
  const out = new Array<number>(12).fill(-1);
  row.forEach((pc, j) => (out[pc] = Math.min(colors - 1, Math.floor((j * colors) / m))));
  for (let pc = 0; pc < 12; pc++) {
    if (out[pc] >= 0) continue;
    let best = row[0];
    let far = 99;
    for (const q of row) {
      const d = mod(fifths(pc) - fifths(q));
      const dist = Math.min(d, 12 - d);
      if (dist < far) {
        far = dist;
        best = q;
      }
    }
    out[pc] = out[best];
  }
  return out;
}

/** The colour of one note: its place in the key's colours, moved round by `shift` so each section of the song has its own cast. */
export function colorIndex(midi: number, map: number[], colors: number, shift = 0): number {
  return (map[((midi % 12) + 12) % 12] + shift) % colors;
}
