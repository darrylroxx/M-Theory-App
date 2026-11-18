/**
 * The vocal EQ as a curve: how many decibels it adds or takes away at each frequency. The
 * engine's filters are analog-matched (see src-tauri/src/eqm.rs), so these are simply the
 * analog curves: what is drawn is what is heard.
 */
import type { VocalFx } from "./vocalfx";

export type EqSettings = Pick<VocalFx, "lowcut" | "low" | "low_freq" | "mid" | "mid_q" | "mud" | "mud_freq" | "presence" | "presence_freq" | "presence_q" | "air" | "air_freq" | "highcut">;

const db = (power: number) => 10 * Math.log10(Math.max(power, 1e-12));

/** A bell of `gain` dB at `fc`, `fc / q` wide at half its gain. */
export function bellDb(f: number, fc: number, q: number, gain: number): number {
  if (Math.abs(gain) < 0.005) return 0;
  const a = 10 ** (gain / 40);
  const w = f / fc;
  const re = (1 - w * w) ** 2;
  return db((re + ((w * a) / q) ** 2) / (re + (w / (a * q)) ** 2));
}
/** A low shelf of `gain` dB below `fc` (12 dB per octave, Q 0.707). */
export function lowShelfDb(f: number, fc: number, gain: number): number {
  if (Math.abs(gain) < 0.005) return 0;
  const a = 10 ** (gain / 40);
  const w = f / fc;
  const k = (Math.sqrt(a) / 0.7071) * w;
  return db((a * a * ((a - w * w) ** 2 + k * k)) / ((1 - a * w * w) ** 2 + k * k));
}
/** The air band: a 6 dB-per-octave shelf of `gain` dB above `fc`. */
export function airDb(f: number, fc: number, gain: number): number {
  const g = 10 ** (gain / 20);
  return db((g * g * f * f + fc * fc) / (f * f + fc * fc));
}
/** The low cut: 24 dB per octave below `fc`. */
export const lowCutDb = (f: number, fc: number) => -db(1 + (fc / f) ** 8);
/** The high cut: 12 dB per octave above `fc` (18 kHz and up = off). */
export const highCutDb = (f: number, fc: number) => (fc >= 18000 ? 0 : -db(1 + (f / fc) ** 4));

/** What the whole EQ does at a frequency, in dB. */
export function eqDb(e: EqSettings, f: number): number {
  return lowCutDb(f, e.lowcut) + lowShelfDb(f, e.low_freq, e.low) + bellDb(f, e.mud_freq, e.mid_q, e.mid - 5 * e.mud) + bellDb(f, e.presence_freq, e.presence_q, e.presence) + airDb(f, e.air_freq, e.air) + highCutDb(f, e.highcut);
}

/** The points you take hold of: which settings each one moves, and how far they go. */
export type EqNodeId = "lowcut" | "low" | "mid" | "presence" | "air" | "highcut";
export interface EqNode {
  id: EqNodeId;
  name: string;
  /** the settings for frequency, gain and width (a cut has only a frequency) */
  freq: keyof EqSettings;
  gain?: keyof EqSettings;
  q?: keyof EqSettings;
  fmin: number;
  fmax: number;
  /** what a double-click puts back */
  rest: Partial<EqSettings>;
}
export const EQ_NODES: EqNode[] = [
  { id: "lowcut", name: "Low cut", freq: "lowcut", fmin: 20, fmax: 400, rest: { lowcut: 90 } },
  { id: "low", name: "Body", freq: "low_freq", gain: "low", fmin: 40, fmax: 600, rest: { low: 0, low_freq: 120 } },
  { id: "mid", name: "Low mid", freq: "mud_freq", gain: "mid", q: "mid_q", fmin: 100, fmax: 2000, rest: { mid: 0, mud: 0, mid_q: 1.4 } },
  { id: "presence", name: "Presence", freq: "presence_freq", gain: "presence", q: "presence_q", fmin: 800, fmax: 12000, rest: { presence: 0, presence_q: 0.9 } },
  { id: "air", name: "Air", freq: "air_freq", gain: "air", fmin: 3000, fmax: 40000, rest: { air: 0, air_freq: 12000 } },
  { id: "highcut", name: "High cut", freq: "highcut", fmin: 1500, fmax: 20000, rest: { highcut: 20000 } },
];
export const EQ_FMIN = 20;
export const EQ_FMAX = 40000;
export const EQ_DB = 15;
/** Where a frequency sits across the graph (0..1, octaves evenly spaced), and back. */
export const xOf = (f: number) => Math.log(f / EQ_FMIN) / Math.log(EQ_FMAX / EQ_FMIN);
export const fOf = (x: number) => EQ_FMIN * (EQ_FMAX / EQ_FMIN) ** Math.min(1, Math.max(0, x));
/** A frequency as you would say it: 90 Hz, 3.5 kHz. */
export const hz = (f: number) => (f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);
/** Rounded to a step that suits its size (so a drag gives clean numbers). */
export const tidyHz = (f: number) => {
  const step = f < 100 ? 1 : f < 1000 ? 5 : f < 10000 ? 50 : 500;
  return Math.round(f / step) * step;
};
