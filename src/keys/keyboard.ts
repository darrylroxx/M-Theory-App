/**
 * Keyboard geometry: where each key of a piano sits, for drawing chord shapes on one.
 *
 * Measured in white-key widths from the C of MIDI octave -1 (note 0). The black keys are not
 * centred on the cracks between white keys: on a real piano C♯ and D♯ lean apart, and F♯, G♯,
 * A♯ spread across their three white keys. The offsets, the black keys' width (0.65 of a white
 * key) and height (two thirds) follow react-piano (MIT, see NOTICE.md).
 */
import { mod12 } from "../theory/notes";

/** Where each black key's left edge sits, in white-key widths from its octave's C. */
export const BLACK_OFFSET: Record<number, number> = { 1: 0.55, 3: 1.8, 6: 3.5, 8: 4.7, 10: 5.85 };
/** Which white key of its octave each white note is (C = 0 … B = 6). */
const WHITE_INDEX: Record<number, number> = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
export const BLACK_WIDTH = 0.65;
export const BLACK_HEIGHT = 0.66;

export const isBlack = (midi: number) => mod12(midi) in BLACK_OFFSET;

/** The left edge of a key, in white-key widths from MIDI note 0. */
export function keyLeft(midi: number): number {
  const oct = Math.floor(midi / 12) * 7;
  const p = mod12(midi);
  return oct + (isBlack(midi) ? BLACK_OFFSET[p] : WHITE_INDEX[p]);
}

/** The white key a note sits on or just above (a black key counts as the white key under its left side). */
const whiteAt = (midi: number) => Math.floor(keyLeft(midi));

/** The MIDI note of the n-th white key from note 0. */
export function whiteMidi(n: number): number {
  const oct = Math.floor(n / 7);
  return oct * 12 + [0, 2, 4, 5, 7, 9, 11][((n % 7) + 7) % 7];
}

/**
 * Which stretch of keyboard to draw for a voicing: from a C or an F at or below its lowest key
 * to a B or an E at or above its highest, then widened a half-octave at a time (below and above
 * by turns) until it has at least `minWhite` white keys. Never more than `maxWhite` unless the
 * voicing itself needs it. With no notes, the octave from middle C.
 */
export function keyboardWindow(notes: number[], minWhite = 7, maxWhite = 28): { lo: number; hi: number; whites: number } {
  const ns = notes.filter((n) => Number.isFinite(n));
  let a = ns.length ? whiteAt(Math.min(...ns)) : whiteAt(60);
  let b = ns.length ? whiteAt(Math.max(...ns)) : whiteAt(64);
  // half-octave boundaries: a window starts on C or F, ends on E or B
  const startOf = (w: number) => (((w % 7) + 7) % 7 >= 3 ? w - (((w % 7) + 7) % 7 - 3) : w - ((w % 7) + 7) % 7);
  const endOf = (w: number) => {
    const i = ((w % 7) + 7) % 7;
    return i <= 2 ? w + (2 - i) : w + (6 - i);
  };
  a = startOf(a);
  b = endOf(b);
  const want = Math.max(1, Math.min(minWhite, maxWhite));
  let below = true;
  while (b - a + 1 < want) {
    // a half-octave is 3 (C–E) or 4 (F–B) white keys
    if (below) a = startOf(a - 1);
    else b = endOf(b + 1);
    below = !below;
  }
  while (b - a + 1 > Math.max(maxWhite, 7) && ns.length) {
    // too wide (only when asked for more than the notes need): trim from the side with room
    const lo = whiteAt(Math.min(...ns));
    const hi = whiteAt(Math.max(...ns));
    if (a < startOf(lo)) a = startOf(a + 4);
    else if (b > endOf(hi)) b = endOf(b - 4);
    else break;
  }
  return { lo: whiteMidi(a), hi: whiteMidi(b), whites: b - a + 1 };
}

export interface KeyRect {
  midi: number;
  black: boolean;
  /** in white-key widths from the window's first key */
  x: number;
  w: number;
  /** as a share of the white keys' height */
  h: number;
}

/** Every key from `lo` to `hi` (white keys first, so the black ones draw on top). */
export function keyRects(lo: number, hi: number): KeyRect[] {
  const x0 = keyLeft(lo);
  const whites: KeyRect[] = [];
  const blacks: KeyRect[] = [];
  for (let m = lo; m <= hi; m++) {
    if (isBlack(m)) blacks.push({ midi: m, black: true, x: keyLeft(m) - x0, w: BLACK_WIDTH, h: BLACK_HEIGHT });
    else whites.push({ midi: m, black: false, x: keyLeft(m) - x0, w: 1, h: 1 });
  }
  return [...whites, ...blacks];
}

/** The middle of a key, across, in white-key widths from the window's first key. */
export const keyCentre = (midi: number, lo: number) => keyLeft(midi) - keyLeft(lo) + (isBlack(midi) ? BLACK_WIDTH : 1) / 2;
