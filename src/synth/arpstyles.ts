/**
 * The arpeggiator, the short way: a few ready styles, each a whole bundle of the engine's settings
 * (pattern, how it moves through the octaves, straight or in threes, how long each step is held,
 * swing, a rhythm of steps and repeats), and two plain choices on top: Speed (a quarter, an eighth
 * or a sixteenth a step) and Range (one to three octaves).
 *
 * The engine (play.ts) and what a song saves (PlaySettings) are unchanged, so an old song whose
 * arp matches none of these styles still plays exactly as it was saved; the panel then shows no
 * style chosen ("Custom") until one is picked.
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
}

const style = (s: Omit<ArpStyle, "octMove" | "feel" | "gate" | "swing" | "rhythm" | "ratchet"> & Partial<ArpStyle>): ArpStyle => ({ octMove: "span", feel: "", gate: 0.6, swing: 0, rhythm: "", ratchet: 1, ...s });

/** The styles, in the order offered. Up is how the arp has always started (DEFAULT_PLAY). */
export const ARP_STYLES: ArpStyle[] = [
  style({ id: "up", name: "Up", hint: "Low to high, over and over", pattern: "up" }),
  style({ id: "down", name: "Down", hint: "High to low", pattern: "down" }),
  style({ id: "updown", name: "Up & down", hint: "Up, then back down", pattern: "updown" }),
  style({ id: "skip", name: "Skip", hint: "The low note between each of the others, leaning on the beat", pattern: "thumb", gate: 0.5, rhythm: "XxxxXxxx" }),
  style({ id: "bounce", name: "Bounce", hint: "Long, short, short, up the octaves and back", pattern: "up", octMove: "bounce", gate: 0.55, rhythm: "X.xxX.xx", minRange: 2 }),
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

/** Over one octave every octave movement plays the same, so they count as one. */
const moveIn = (move: OctMove, octaves: number): OctMove => (octaves > 1 ? move : "span");

/** The style an arp's settings are (its speed, range and gate may be anything), or null: settings of their own. */
export function styleOf(p: PlaySettings): ArpStyle | null {
  const feel = splitRate(p.rate).feel;
  return ARP_STYLES.find((s) => s.pattern === p.pattern && s.feel === feel && Math.abs(s.swing - p.swing) < 1e-6 && s.rhythm === p.rhythm && s.ratchet === p.ratchet && moveIn(s.octMove, p.octaves) === moveIn(p.octMove, p.octaves)) ?? null;
}

/** Play in a style: everything it bundles, at the speed and over the range already chosen. */
export function withStyle(p: PlaySettings, s: ArpStyle): PlaySettings {
  const { value } = splitRate(p.rate);
  return {
    ...p,
    mode: "arp",
    pattern: s.pattern,
    octMove: s.octMove,
    gate: s.gate,
    swing: s.swing,
    rhythm: s.rhythm,
    ratchet: s.ratchet,
    rate: joinRate(value, s.feel),
    octaves: Math.max(s.minRange ?? 1, p.octaves) as PlaySettings["octaves"],
  };
}

/** The speed an arp (or a pulse) is set to, if it is one of the three. */
export const speedOf = (p: PlaySettings): string | null => {
  const v = splitRate(p.rate).value;
  return SPEEDS.some((s) => s.value === v) ? v : null;
};
/** Another speed, the feel kept (an arp in threes stays in threes). */
export const withSpeed = (p: PlaySettings, value: string): PlaySettings => ({ ...p, rate: joinRate(value, splitRate(p.rate).feel) });
/** Another range. */
export const withRange = (p: PlaySettings, octaves: number): PlaySettings => ({ ...p, octaves: Math.max(1, Math.min(4, Math.round(octaves))) as PlaySettings["octaves"] });
