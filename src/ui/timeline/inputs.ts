// Which input a track records: the list a track's input chip offers, and how a choice is told to the engine.
//
// The list never waits for the interface to be open. How many inputs there are is taken from the interface as it
// opened; else from the interface chosen in the list of interfaces; else from what was remembered the last time one
// was open. Every input is offered on its own, and every neighbouring two as a pair, recorded in stereo (1+2, 3+4 …).
// A track's saved choice is always in the list: when the interface turns out not to have it, it is marked "not
// there" and stays as it is until another is picked.
import type { InputRef } from "../../timeline/model";

/** How many inputs there are to choose from when nothing is known yet. */
export const INPUTS_UNKNOWN = 2;

/**
 * How many inputs to offer: the open interface's (`opened`), else the chosen interface's as its list says (`device`),
 * else the count remembered from the last time one was open (`remembered`), else two.
 */
export function inputCount(o: { opened?: number | null; device?: number | null; remembered?: number | null }): number {
  for (const n of [o.opened, o.device, o.remembered]) if (typeof n === "number" && Number.isFinite(n) && n >= 1) return Math.floor(n);
  return INPUTS_UNKNOWN;
}

const chOf = (input: InputRef | undefined): number => Math.max(0, Math.round(input?.ch ?? 0));

/** Are two choices the same input, or the same pair? (No choice is input 1.) */
export const sameInput = (a: InputRef | undefined, b: InputRef | undefined): boolean => chOf(a) === chOf(b) && !!a?.pair === !!b?.pair;

/** An input as the list names it: "In 3", "In 3+4". */
export const inputName = (input: InputRef | undefined): string => (input?.pair ? `In ${chOf(input) + 1}+${chOf(input) + 2}` : `In ${chOf(input) + 1}`);

/** Does an interface with `count` inputs have this input (for a pair: both of them)? */
export const hasInput = (input: InputRef | undefined, count: number): boolean => chOf(input) + (input?.pair ? 1 : 0) < count;

/** One line of the list. `missing`: the track's saved choice, which the interface does not have. */
export interface InputLine {
  input: InputRef;
  /** "In 3", "In 3+4" */
  label: string;
  /** it is the track's choice */
  on: boolean;
  missing?: true;
}

/**
 * The list for a track whose choice is `now`, on an interface with `count` inputs: every input, then every pair of
 * neighbours counted from the first (1+2, 3+4 …; an odd last input has no pair). The track's own choice is in the
 * list also when the interface does not have it (a higher input, or a pair that does not start on an odd input):
 * it comes last in its part, marked.
 */
export function inputLines(count: number, now: InputRef | undefined): { singles: InputLine[]; pairs: InputLine[] } {
  const n = Math.max(1, Math.floor(Number.isFinite(count) ? count : INPUTS_UNKNOWN));
  const line = (input: InputRef): InputLine => ({ input, label: inputName(input), on: sameInput(input, now) });
  const singles = Array.from({ length: n }, (_, ch) => line({ ch }));
  const pairs = Array.from({ length: Math.floor(n / 2) }, (_, k) => line({ ch: 2 * k, pair: true }));
  const mine: InputRef = now?.pair ? { ch: chOf(now), pair: true } : { ch: chOf(now) };
  const list = mine.pair ? pairs : singles;
  if (!list.some((l) => l.on)) list.push({ ...line(mine), ...(hasInput(mine, n) ? {} : { missing: true as const }) });
  return { singles, pairs };
}

/** A choice as the engine takes it: `input` (the left side of a pair) and, for a pair, `inputB` (the right), both counted from 0. */
export function engineInputs(input: InputRef | undefined): { input: number; inputB?: number } {
  const ch = chOf(input);
  return input?.pair ? { input: ch, inputB: ch + 1 } : { input: ch };
}

/** The inputs whose levels a choice shows: one, or the two of a pair. */
export const metersOf = (input: InputRef | undefined): number[] => (input?.pair ? [chOf(input), chOf(input) + 1] : [chOf(input)]);
