/**
 * The arpeggiator, the short way: a few ready styles, each a whole bundle of the engine's settings
 * (pattern, how it moves through the octaves, straight or in threes, how long each step is held,
 * swing, a rhythm of steps and repeats), and two plain choices on top: Speed (a quarter, an eighth
 * or a sixteenth a step) and Range (one to three octaves).
 *
 * The engine (play.ts) and what a song saves (PlaySettings) are unchanged, so an old song whose
 * arp matches none of these styles still plays exactly as it was saved; the panel then shows no
 * style chosen ("Custom") until one is picked.
 *
 * In 6/8, 9/8 and 12/8 (compound: the beat is a dotted quarter that divides in three) the styles
 * are fitted to the meter: Slow is one step a beat, Medium and Fast are real eighths and sixteenths
 * (three and six to a beat, which the engine counts as "1/8T" and "1/16T"), accents fall on the
 * beats, nothing is swung (the meter already lilts), each note is let go by half its step (a 6/8
 * sixteenth at 140 is 71 ms: held longer, a pad's steps ran together) and Triplets is not offered
 * (every style is in threes there).
 */
import { type ArpPattern, type OctMove, type PlaySettings, type Rate, RATES } from "./params";

export type ArpStyleId = "up" | "down" | "updown" | "skip" | "bounce" | "shuffle" | "triplets" | "random";
/** How a step is felt: straight, or three in the time of two. (Dotted steps stay in old songs; no style has them.) */
export type Feel = "" | "T" | "D";

export interface ArpStyle {
  id: ArpStyleId;
  name: string;
  hint: string;
  pattern: ArpPattern;
  octMove: OctMove;
  feel: Feel;
  /** how much of each step a note is held (set when the style is picked; any gate counts as the style) */
  gate: number;
  swing: number;
  rhythm: string;
  ratchet: 1 | 2 | 3 | 4;
  /** the least range it is picked with (Bounce needs octaves to bounce over) */
  minRange?: number;
  /** its rhythm in 6/8, 9/8 and 12/8 (one with the accents on the beats, three steps to one) */
  rhythm3?: string;
}

const style = (s: Omit<ArpStyle, "octMove" | "feel" | "gate" | "swing" | "rhythm" | "ratchet"> & Partial<ArpStyle>): ArpStyle => ({ octMove: "span", feel: "", gate: 0.6, swing: 0, rhythm: "", ratchet: 1, ...s });

/** The styles, in the order offered. Up is how the arp has always started (DEFAULT_PLAY). */
export const ARP_STYLES: ArpStyle[] = [
  style({ id: "up", name: "Up", hint: "Low to high, over and over", pattern: "up" }),
  style({ id: "down", name: "Down", hint: "High to low", pattern: "down" }),
  style({ id: "updown", name: "Up & down", hint: "Up, then back down", pattern: "updown" }),
  style({ id: "skip", name: "Skip", hint: "The low note between each of the others, leaning on the beat", pattern: "thumb", gate: 0.5, rhythm: "XxxxXxxx", rhythm3: "XxxXxx" }),
  style({ id: "bounce", name: "Bounce", hint: "Long, short, short, up the octaves and back", pattern: "up", octMove: "bounce", gate: 0.55, rhythm: "X.xxX.xx", rhythm3: "X.xX.x", minRange: 2 }),
  style({ id: "shuffle", name: "Shuffle", hint: "Swung, from the outside notes in", pattern: "converge", swing: 0.4 }),
  style({ id: "triplets", name: "Triplets", hint: "Up, three steps to a beat", pattern: "up", feel: "T", gate: 0.55 }),
  style({ id: "random", name: "Random", hint: "The chord's notes in a new order every time round", pattern: "random", gate: 0.5 }),
];

/** Speed: how long a step is. */
export const SPEEDS: { value: "1/4" | "1/8" | "1/16"; name: string }[] = [
  { value: "1/4", name: "Slow" },
  { value: "1/8", name: "Medium" },
  { value: "1/16", name: "Fast" },
];
/** Speed's names in 6/8, 9/8 and 12/8, where Slow is a whole beat: a dotted quarter. */
export const speedName = (value: string, compound = false): string => (compound && value === "1/4" ? "1/4." : value);
/** Range: how many octaves the arp climbs. */
export const RANGES = [1, 2, 3] as const;

/** A step's note value ("1/16") and its feel ("", "T" or "D"). */
export function splitRate(r: Rate): { value: string; feel: Feel } {
  const m = /^(1\/\d+)([DT]?)$/.exec(r);
  return { value: m?.[1] ?? "1/16", feel: (m?.[2] ?? "") as Feel };
}
/** A note value with a feel (a straight one when that combination does not exist). */
export function joinRate(value: string, feel: Feel): Rate {
  const r = `${value}${feel}` as Rate;
  return RATES.includes(r) ? r : RATES.includes(value as Rate) ? (value as Rate) : "1/16";
}

/**
 * The engine's step for a speed: in a compound meter (6/8, 9/8, 12/8) the app's beat is a dotted
 * quarter, so a straight "1/8" would be a dotted eighth, off the meter's grid. There Slow is the
 * beat ("1/4") and the others are in threes ("1/8T" is a real 6/8 eighth); elsewhere the feel asked for.
 */
export function fitRate(value: string, feel: Feel, compound = false): Rate {
  if (!compound) return joinRate(value, feel);
  return value === "1/4" ? "1/4" : joinRate(value, "T");
}
/** Whether a step lands on a compound meter's grid (a beat, an eighth, a sixteenth ...). */
const onGrid = (rate: Rate) => rate === fitRate(splitRate(rate).value, "", true);

/** The styles offered: all of them, or in 6/8, 9/8 and 12/8 all but Triplets. */
export const stylesFor = (compound = false): ArpStyle[] => (compound ? ARP_STYLES.filter((s) => s.feel !== "T") : ARP_STYLES);
/** How much of a step a note is held at most in a compound meter (see above). */
export const GATE3 = 0.5;
/** What a style bundles in a meter: in a compound one, its rhythm in threes, no swing and shorter notes. */
export function styleIn(s: ArpStyle, compound = false): ArpStyle {
  return compound ? { ...s, swing: 0, rhythm: s.rhythm3 ?? s.rhythm, gate: Math.min(s.gate, GATE3) } : s;
}

/** Over one octave every octave movement plays the same, so they count as one. */
const moveIn = (move: OctMove, octaves: number): OctMove => (octaves > 1 ? move : "span");

/**
 * The style an arp's settings are (its speed, range and gate may be anything), or null: settings
 * of their own. In a compound meter a style counts only with its steps on the meter's grid.
 */
export function styleOf(p: PlaySettings, compound = false): ArpStyle | null {
  const feel = splitRate(p.rate).feel;
  const rateOk = (s: ArpStyle) => (compound ? onGrid(p.rate) : s.feel === feel);
  return (
    stylesFor(compound).find((style) => {
      const s = styleIn(style, compound);
      return s.pattern === p.pattern && rateOk(s) && Math.abs(s.swing - p.swing) < 1e-6 && s.rhythm === p.rhythm && s.ratchet === p.ratchet && moveIn(s.octMove, p.octaves) === moveIn(p.octMove, p.octaves);
    }) ?? null
  );
}

/** Play in a style: everything it bundles, at the speed and over the range already chosen (fitted to a compound meter). */
export function withStyle(p: PlaySettings, style: ArpStyle, compound = false): PlaySettings {
  const { value } = splitRate(p.rate);
  const s = styleIn(style, compound);
  return {
    ...p,
    mode: "arp",
    pattern: s.pattern,
    octMove: s.octMove,
    gate: s.gate,
    swing: s.swing,
    rhythm: s.rhythm,
    ratchet: s.ratchet,
    rate: fitRate(value, s.feel, compound),
    octaves: Math.max(s.minRange ?? 1, p.octaves) as PlaySettings["octaves"],
  };
}

/** The speed an arp (or a pulse) is set to, if it is one of the three (in a compound meter: and on its grid). */
export const speedOf = (p: PlaySettings, compound = false): string | null => {
  const v = splitRate(p.rate).value;
  return SPEEDS.some((s) => s.value === v) && (!compound || onGrid(p.rate)) ? v : null;
};
/** Another speed, the feel kept (an arp in threes stays in threes); in a compound meter, on its grid. */
export const withSpeed = (p: PlaySettings, value: string, compound = false): PlaySettings => ({ ...p, rate: fitRate(value, splitRate(p.rate).feel, compound) });
/**
 * An arp or a pulse just turned on (or a sound's own picked) in a compound meter, its steps put on
 * the meter's grid if they are off it (an eighth stays an eighth, now a real one). Anything else as it is.
 */
export function fitMeter(p: PlaySettings, compound = false): PlaySettings {
  if (!compound || (p.mode !== "arp" && p.mode !== "pulse") || onGrid(p.rate)) return p;
  const rate = fitRate(splitRate(p.rate).value, "", true);
  const style = p.mode === "arp" ? styleOf(p) : null;
  if (!style) return { ...p, rate };
  // (a style's rhythm, swing and how long it holds its notes go with it, to that style in this meter)
  const s = styleIn(style, true);
  return { ...p, rate, swing: s.swing, rhythm: s.rhythm, gate: Math.min(p.gate, s.gate) };
}
/** Another range. */
export const withRange = (p: PlaySettings, octaves: number): PlaySettings => ({ ...p, octaves: Math.max(1, Math.min(4, Math.round(octaves))) as PlaySettings["octaves"] });
