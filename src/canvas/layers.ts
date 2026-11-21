/**
 * The layers of a song, and the paint each one is painted in.
 *
 * A song is heard as parts that play together: the drums, the bass, the chords, the melody, a
 * harmony line beside the melody, the vocals, and everything else (pads, ambience, effects).
 * Each part has its own kind of paint, recognisable by its shape alone, even in grey:
 *
 * - **drums**: impacts. A kick is a soft round blot at the bottom, a snare a burst of hard little
 *   drops, the hats a dry stipple of specks and scratches near the top.
 * - **bass**: broad, flat, heavy bands low down; a held bass note is one band, short ones are
 *   stacked slabs.
 * - **chords**: washes and blocks. A held chord is a translucent wash spanning its lowest note to
 *   its highest; a stabbed one a hard-edged block.
 * - **melody**: one continuous line, as if drawn by a single loaded brush: notes that join are a
 *   curve, short notes a dotted line along the same path.
 * - **harmony**: a companion line beside the melody, thinner and lighter, hatched to it where the
 *   two lines are close.
 * - **vocals**: a luminous ribbon of many fine strands, glazed on in light.
 * - **other**: fog. Edge-less haze that drifts.
 *
 * They also differ in size (fog much larger than washes, washes than bands, bands than lines,
 * lines than specks) and in how they lie over each other: fog and washes underneath, bands and
 * lines in the middle, glaze and impacts on top. Which part is which comes from the track it is
 * on (the app's own song), or from splitting a recording into layers (a song from a file).
 */
import { contrast, hexToRgb, luminance, mix as mixRgb, rgbToHsl, type RGB } from "./color";
import type { Palette } from "./palettes";
import type { Track } from "../song/tracks";
import type { Track as Track5 } from "../timeline/model";

export type LayerKind = "drums" | "bass" | "chords" | "melody" | "harmony" | "vocals" | "other";
/** The layers, lowest first: the order they lie in on the canvas. */
export const LAYERS: LayerKind[] = ["other", "chords", "bass", "harmony", "melody", "vocals", "drums"];
/** The layers in the order a musician lists them. */
export const LAYER_ORDER: LayerKind[] = ["drums", "bass", "chords", "melody", "harmony", "vocals", "other"];

export interface LayerInfo {
  name: string;
  /** a short mark for the legend */
  symbol: string;
  /** how deep it lies: 0 = underneath everything … 1 = on top */
  depth: number;
}
export const LAYER_INFO: Record<LayerKind, LayerInfo> = {
  other: { name: "Other", symbol: "≈", depth: 0.05 },
  chords: { name: "Chords", symbol: "▤", depth: 0.2 },
  bass: { name: "Bass", symbol: "▬", depth: 0.35 },
  harmony: { name: "Harmony", symbol: "∥", depth: 0.5 },
  melody: { name: "Melody", symbol: "∿", depth: 0.65 },
  vocals: { name: "Vocals", symbol: "◌", depth: 0.8 },
  drums: { name: "Drums", symbol: "✱", depth: 0.95 },
};
export const isLayer = (x: unknown): x is LayerKind => typeof x === "string" && (LAYERS as string[]).includes(x);

/** The layer a track of the app's own song is painted in. A track marked as a harmony is painted as one. */
export function layerOfTrack(t: Pick<Track, "kind"> & { role?: string }): LayerKind {
  if (t.role === "harmony" && (t.kind === "melody" || t.kind === "chords")) return "harmony";
  if (t.kind === "vocals") return "vocals";
  return t.kind;
}

/**
 * The layer a track of a song of tracks and clips is painted in: a harmony track as a harmony, a bass track in the
 * bass's own paint, vocals as vocals, a blank audio track as everything else.
 */
export function layerOfTrack5(t: Pick<Track5, "kind"> & { role?: string }): LayerKind {
  if (t.role === "harmony" && (t.kind === "melody" || t.kind === "chords")) return "harmony";
  if (t.kind === "audio") return "other";
  return t.kind;
}

/** Notes this low, played on a chords track, are the bass: the app has no bass track of its own, so the low strings are it. */
export const BASS_TOP_MIDI = 47;

/**
 * The colour each layer is painted in, all from the palette in use: the darkest paint that still
 * shows for the weight at the bottom (bass, kick), the most vivid for the glow of the voice, the
 * palette's ink for the melody's line, a lighter tint of it for the harmony, the lightest for the
 * hats, and the ground's near neighbour for the fog. The chords take the colours of their notes
 * (see `noteColors`), so a change of chord is a change of colour.
 *
 * `turn` (from the music's vibe) moves the choice round the palette, so two songs of different
 * character in the same scheme are not painted in the same casting; `light` (−1..1) leans every
 * layer a little lighter or darker.
 */
export interface LayerColours {
  drums: RGB;
  kick: RGB;
  hat: RGB;
  bass: RGB;
  melody: RGB;
  harmony: RGB;
  vocals: RGB;
  other: RGB;
  /** for the chords' colours: how far round the palette the note colours are turned */
  shift: number;
  /** the ground is dark (light glazed on shows; on a light ground a glaze needs pigment) */
  dark: boolean;
}

export function layerColours(p: Palette, turn = 0, light = 0): LayerColours {
  const ground = hexToRgb(p.ground);
  const dark = luminance(p.ground) < 0.2;
  const seen = p.colors.filter((c) => contrast(c, p.ground) >= 1.6);
  const pool = (seen.length >= 3 ? seen : p.colors).slice();
  const n = pool.length;
  const t = ((Math.round(turn) % n) + n) % n;
  const turned = pool.map((_, i) => pool[(i + t) % n]);
  const byLight = [...pool].sort((a, b) => luminance(a) - luminance(b));
  const sat = (h: string) => rgbToHsl(hexToRgb(h))[1];
  // the weight at the bottom: the paint that stands out most from the ground in value
  const heavy = dark ? byLight[byLight.length - 1] : byLight[0];
  const airy = dark ? byLight[0] : byLight[byLight.length - 1];
  const vivid = [...turned].sort((a, b) => sat(b) - sat(a))[0];
  const second = turned.find((c) => c !== heavy && c !== vivid) ?? turned[0];
  const lean = (c: RGB) => (light > 0 ? mixRgb(c, [255, 255, 255], 0.18 * light) : mixRgb(c, [0, 0, 0], -0.18 * light));
  const ink = hexToRgb(p.ink);
  const melody = lean(mixRgb(ink, hexToRgb(turned[0]), dark ? 0.25 : 0.35));
  return {
    drums: lean(hexToRgb(second)),
    kick: lean(hexToRgb(heavy)),
    hat: lean(mixRgb(hexToRgb(airy), ink, dark ? 0.15 : 0.45)),
    bass: lean(mixRgb(hexToRgb(heavy), hexToRgb(turned[(1 + t) % n] ?? heavy), 0.25)),
    melody,
    harmony: mixRgb(melody, ground, 0.38),
    vocals: lean(hexToRgb(vivid)),
    other: mixRgb(hexToRgb(turned[Math.floor(n / 2)] ?? turned[0]), ground, 0.55),
    shift: t,
    dark,
  };
}
