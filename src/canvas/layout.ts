/**
 * Where things go on the canvas.
 *
 * Time runs from left to right: the canvas is as wide as the section (long sections take several
 * canvases, one after another). Pitch runs from bottom to top: the kick and the bass strings at
 * the bottom, the chords across the middle, the melody above them, and the cymbals and shakers
 * as a sprinkle along the top.
 */
import type { DrumId } from "../audio/drums";

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

/** The bands of the canvas, top and bottom as parts of its height. */
export const BANDS = {
  air: [0.07, 0.19],
  melody: [0.13, 0.5],
  chords: [0.36, 0.78],
  hits: [0.64, 0.8],
  low: [0.83, 0.93],
} as const;
export type Band = keyof typeof BANDS;

/** The notes each pitched band spans, lowest and highest (MIDI). Notes outside are kept at the edge. */
export const RANGE = { chords: [38, 79], melody: [55, 88] } as const;

/** How high on the canvas a note sits: higher notes higher up. */
export function yOfMidi(midi: number, band: "chords" | "melody", height: number): number {
  const [lo, hi] = RANGE[band];
  const [top, bottom] = BANDS[band];
  const t = Math.max(0, Math.min(1, (midi - lo) / (hi - lo)));
  return height * (bottom - t * (bottom - top));
}

/** Where a drum lands: its band, and how far down that band (0 = top, 1 = bottom). */
export const DRUM_PLACE: Record<DrumId, { band: Band; at: number }> = {
  kick: { band: "low", at: 0.5 },
  tom: { band: "hits", at: 0.85 },
  snare: { band: "hits", at: 0.35 },
  clap: { band: "hits", at: 0.1 },
  bell: { band: "air", at: 0.02 },
  rim: { band: "air", at: 0.95 },
  hat: { band: "air", at: 0.45 },
  open: { band: "air", at: 0.2 },
  shaker: { band: "air", at: 0.7 },
};
export function yOfDrum(id: DrumId, height: number, wander = 0): number {
  const p = DRUM_PLACE[id];
  const [top, bottom] = BANDS[p.band];
  return height * (top + (bottom - top) * Math.max(0, Math.min(1, p.at + wander)));
}

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
