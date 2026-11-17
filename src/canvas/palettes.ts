/**
 * Colour schemes for the canvas. Each is a ground (the colour of the canvas itself), an ink (the
 * colour of the melody's line), and a handful of paints.
 */
import { contrast, hexToRgb, luminance, rgbToHsl } from "./color";
import type { Surface } from "./weave";

export interface Palette {
  id: string;
  name: string;
  /** the family it is listed under */
  group: string;
  /** the canvas itself */
  ground: string;
  /** the melody's line */
  ink: string;
  /** the paints, in the order the notes of the key take them (see `colorIndex`) */
  colors: string[];
  /** the surface it suits best */
  surface: Surface;
}

/**
 * Where the colours come from (the full list of sources and credits is in the README):
 * - Paint: published approximations of real artists' pigments.
 * - Prints: palettes sampled from prints and paintings, traditional Japanese colours, Risograph
 *   inks, and the named colours of a few design eras.
 * - Loved: the palettes people have loved most on the largest palette-sharing site, by its
 *   all-time ranking.
 * - Screens: the colour schemes people choose to look at all day, with each project's own values.
 * - Glow: schemes made for black.
 * A ground or ink that is not part of its source is the nearest neutral: sumi black or an off-white.
 */
export const PALETTES: Palette[] = [
  // ── Paint ──
  // cadmium red, cadmium yellow, French ultramarine, viridian, dioxazine violet, cerulean; ivory black for the line
  { id: "primaries", name: "Primaries", group: "Paint", ground: "#f4f0e6", ink: "#0c0b0a", colors: ["#e30022", "#ed9a22", "#054f96", "#40826d", "#612e81", "#4ba7c8"], surface: "canvas" },
  // yellow ochre, raw sienna, burnt sienna, raw umber, burnt umber, Prussian blue, Naples yellow, on unprimed linen
  { id: "earth", name: "Earth", group: "Paint", ground: "#dccdab", ink: "#0c0b0a", colors: ["#c18f32", "#c9822a", "#bb3726", "#523420", "#633c16", "#233c78", "#f8d877"], surface: "linen" },
  // the old four-tube palette: yellow ochre, vermilion, ivory black, white, and what they mix to, on a toned ground
  { id: "four", name: "Four tubes", group: "Paint", ground: "#c7bdac", ink: "#0c0b0a", colors: ["#c18f32", "#e34234", "#0c0b0a", "#ffffff", "#674d1e", "#f1a19a", "#868585"], surface: "linen" },
  // sampled from a painting of a lily pond: no black, soft greens, pinks and violets
  { id: "lilypond", name: "Lily pond", group: "Paint", ground: "#fcfaf2", ink: "#41507b", colors: ["#4e6d58", "#749e89", "#abccbe", "#e3cacf", "#c399a2", "#9f6e71", "#7d87b2", "#c2cae3"], surface: "canvas" },
  // ink on paper: four strengths of sumi, and the red of the seal (kurenai)
  { id: "sumi", name: "Ink", group: "Paint", ground: "#f1eadb", ink: "#1c1c1c", colors: ["#2e2e2e", "#575757", "#868686", "#afafaf", "#cb1b45"], surface: "paper" },

  // ── Prints ──
  // sampled from a woodblock print: red earth, ochre, sage and indigo
  { id: "woodblock", name: "Woodblock", group: "Prints", ground: "#ece2c6", ink: "#224b5e", colors: ["#6d2f20", "#b75347", "#df7e66", "#e09351", "#edc775", "#94b594", "#224b5e"], surface: "paper" },
  // sampled from a woodblock print of a lake: nothing but blues
  { id: "wave", name: "Wave", group: "Prints", ground: "#ece2c6", ink: "#0a3351", colors: ["#abc9c8", "#72aeb6", "#4692b0", "#2f70a1", "#134b73", "#0a3351"], surface: "paper" },
  // sampled from a woodblock print of an evening sky: from ember to deep blue
  { id: "dusk", name: "Dusk", group: "Prints", ground: "#fbf4e4", ink: "#1e466e", colors: ["#e76254", "#ef8a47", "#f7aa58", "#ffd06f", "#72bcd5", "#528fad", "#376795", "#1e466e"], surface: "paper" },
  // traditional Japanese colours: kurenai, yamabuki, moegi, asagi, ruri, ai, fuji, sakura; sumi for the line, on shironeri
  { id: "kasane", name: "Kasane", group: "Prints", ground: "#fcfaf2", ink: "#1c1c1c", colors: ["#cb1b45", "#ffb11b", "#7ba23f", "#33a6b8", "#005caf", "#0d5661", "#8b81c3", "#fedfe1"], surface: "paper" },
  // Risograph inks on warm white paper: fluorescent pink, blue, yellow, bright red, teal, green, orange
  { id: "riso", name: "Riso", group: "Prints", ground: "#f1e7e1", ink: "#000000", colors: ["#ff48b0", "#0078bf", "#ffe800", "#f15060", "#00838a", "#00a95c", "#ff6c2f"], surface: "paper" },
  // the design school's red, yellow and blue, with black
  { id: "blocks", name: "Blocks", group: "Prints", ground: "#f4f1ea", ink: "#141414", colors: ["#d62f25", "#f2c230", "#1f3a93", "#141414", "#4a71c0"], surface: "canvas" },
  // mustard, burnt orange, teal, olive, walnut
  { id: "midcentury", name: "Mid-century", group: "Prints", ground: "#fcfaf2", ink: "#5d3a1a", colors: ["#e1ad01", "#cc5500", "#008080", "#556b2f", "#1e4f5a", "#6f4e37", "#5d3a1a"], surface: "linen" },
  // harvest gold, avocado, burnt orange, rust, mustard, chocolate, on cream
  { id: "seventies", name: "Seventies", group: "Prints", ground: "#fffdd0", ink: "#7b3f00", colors: ["#da9100", "#568203", "#cc5500", "#b7410e", "#ffdb58", "#7b3f00"], surface: "linen" },
  // eighties laminate: hot pink, cyan, gold, red, cobalt, and black squiggles
  { id: "memphis", name: "Memphis", group: "Prints", ground: "#fcfaf2", ink: "#111111", colors: ["#ff007f", "#00e5ff", "#ffd700", "#e63946", "#2548d6", "#111111"], surface: "paper" },
  // black lacquer, gold, emerald, ivory, bronze
  { id: "deco", name: "Deco", group: "Prints", ground: "#1e1e24", ink: "#d4af37", colors: ["#d4af37", "#133a2b", "#50c878", "#faf4e8", "#b57e4a"], surface: "canvas" },

  // ── Loved: by all-time rank ──
  { id: "goldfish", name: "Goldfish", group: "Loved", ground: "#14323a", ink: "#e0e4cc", colors: ["#69d2e7", "#a7dbd8", "#e0e4cc", "#f38630", "#fa6900"], surface: "canvas" },
  { id: "coral", name: "Coral", group: "Loved", ground: "#1c1c1c", ink: "#f9cdad", colors: ["#fe4365", "#fc9d9a", "#f9cdad", "#c8c8a9", "#83af9b"], surface: "canvas" },
  { id: "plum", name: "Plum", group: "Loved", ground: "#542437", ink: "#ecd078", colors: ["#ecd078", "#d95b43", "#c02942", "#53777a"], surface: "linen" },
  { id: "sherbet", name: "Sherbet", group: "Loved", ground: "#1c1c1c", ink: "#c7f464", colors: ["#556270", "#4ecdc4", "#c7f464", "#ff6b6b", "#c44d58"], surface: "canvas" },
  { id: "cocoa", name: "Cocoa", group: "Loved", ground: "#2b1e17", ink: "#f1d4af", colors: ["#774f38", "#e08e79", "#f1d4af", "#ece5ce", "#c5e0dc"], surface: "linen" },
  { id: "tidewater", name: "Tidewater", group: "Loved", ground: "#f3ecdf", ink: "#031634", colors: ["#e8ddcb", "#cdb380", "#036564", "#033649", "#031634"], surface: "paper" },
  { id: "saffron", name: "Saffron", group: "Loved", ground: "#490a3d", ink: "#f8ca00", colors: ["#bd1550", "#e97f02", "#f8ca00", "#8a9b0f"], surface: "linen" },
  { id: "reef", name: "Reef", group: "Loved", ground: "#fcfaf2", ink: "#6a4a3c", colors: ["#00a0b0", "#6a4a3c", "#cc333f", "#eb6841", "#edc951"], surface: "canvas" },
  { id: "sundown", name: "Sundown", group: "Loved", ground: "#fcfaf2", ink: "#355c7d", colors: ["#f8b195", "#f67280", "#c06c84", "#6c5b7b", "#355c7d"], surface: "paper" },
  { id: "shore", name: "Shore", group: "Loved", ground: "#fbf6ec", ink: "#1d3540", colors: ["#264653", "#2a9d8f", "#e9c46a", "#f4a261", "#e76f51"], surface: "canvas" },

  // ── Screens ──
  { id: "solarized", name: "Solarized", group: "Screens", ground: "#fdf6e3", ink: "#073642", colors: ["#b58900", "#cb4b16", "#dc322f", "#d33682", "#6c71c4", "#268bd2", "#2aa198", "#859900"], surface: "paper" },
  { id: "nord", name: "Nord", group: "Screens", ground: "#2e3440", ink: "#eceff4", colors: ["#88c0d0", "#81a1c1", "#5e81ac", "#bf616a", "#d08770", "#ebcb8b", "#a3be8c", "#b48ead"], surface: "linen" },
  { id: "gruvbox", name: "Gruvbox", group: "Screens", ground: "#282828", ink: "#ebdbb2", colors: ["#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#fe8019"], surface: "linen" },
  { id: "dracula", name: "Dracula", group: "Screens", ground: "#282a36", ink: "#f8f8f2", colors: ["#ff79c6", "#bd93f9", "#8be9fd", "#50fa7b", "#ffb86c", "#ff5555", "#f1fa8c"], surface: "canvas" },
  { id: "catppuccin", name: "Catppuccin", group: "Screens", ground: "#1e1e2e", ink: "#cdd6f4", colors: ["#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#94e2d5", "#89b4fa", "#cba6f7", "#f5c2e7"], surface: "canvas" },
  { id: "rosepine", name: "Rosé Pine", group: "Screens", ground: "#191724", ink: "#e0def4", colors: ["#eb6f92", "#f6c177", "#ebbcba", "#31748f", "#9ccfd8", "#c4a7e7"], surface: "canvas" },
  { id: "tokyo", name: "Tokyo Night", group: "Screens", ground: "#1a1b26", ink: "#c0caf5", colors: ["#f7768e", "#ff9e64", "#e0af68", "#9ece6a", "#73daca", "#7dcfff", "#7aa2f7", "#bb9af7"], surface: "canvas" },
  { id: "kanagawa", name: "Kanagawa", group: "Screens", ground: "#1f1f28", ink: "#dcd7ba", colors: ["#7e9cd8", "#957fb8", "#98bb6c", "#e6c384", "#ffa066", "#d27e99", "#e46876", "#7aa89f"], surface: "canvas" },

  // ── Glow ──
  { id: "synthwave", name: "Synthwave", group: "Glow", ground: "#262335", ink: "#ffffff", colors: ["#ff7edb", "#36f9f6", "#fede5d", "#f97e72", "#72f1b8", "#fe4450", "#03edf9", "#ff8b39"], surface: "canvas" },
  { id: "outrun", name: "Outrun", group: "Glow", ground: "#00002a", ink: "#d0d0fa", colors: ["#ff4242", "#fc8d28", "#f3e877", "#59f176", "#0ef0f0", "#66b0ff", "#f10596", "#f003ef"], surface: "canvas" },
  { id: "vapor", name: "Vapor", group: "Glow", ground: "#241b2f", ink: "#fffb96", colors: ["#ff71ce", "#01cdfe", "#05ffa1", "#b967ff", "#fffb96"], surface: "canvas" },
];
/** The families, in the order they are offered. */
export const PALETTE_GROUPS = [...new Set(PALETTES.map((p) => p.group))];
/** The scheme a new canvas starts with. */
export const DEFAULT_PALETTE = "woodblock";

export const getPalette = (id: unknown): Palette => PALETTES.find((p) => p.id === id) ?? PALETTES.find((p) => p.id === DEFAULT_PALETTE)!;

/**
 * The parts the paints play on this ground. `low` is the darkest paint that still shows (the
 * kick, the weight at the bottom); `high` the lightest that still shows (cymbals, sparks);
 * `pop` the most vivid; `second` the one that stands out most after `low`.
 */
export function roles(p: Palette) {
  const dark = luminance(p.ground) < 0.2;
  const sat = (h: string) => rgbToHsl(hexToRgb(h))[1];
  const seen = p.colors.filter((c) => contrast(c, p.ground) >= 1.6);
  const pool = seen.length ? seen : p.colors;
  const byLight = [...pool].sort((a, b) => luminance(a) - luminance(b));
  const low = byLight[0];
  const high = byLight[byLight.length - 1];
  const pop = [...pool].sort((a, b) => sat(b) - sat(a))[0];
  const second = [...pool].filter((c) => c !== low).sort((a, b) => contrast(b, p.ground) - contrast(a, p.ground))[0] ?? low;
  return { dark, low, high, pop, second };
}
