/**
 * What goes round: any bars of the song, chosen a section at a time (or a bar at a time), played
 * in the song's order, round and round. They need not be next to each other: verse and chorus can
 * loop while the bridge between them is skipped. Bars next to each other play as one run.
 */
import { barAt, barIndex, tapLoop, type BarRef, type LoopSpan } from "./frame";

type Layout = { block: string; bars: number }[];

/** The bars chosen to loop, in any order (an empty list: nothing loops). Each is a bar of one section of the song. */
export type LoopBars = BarRef[];

/** The chosen bars that are still in the song, as places in it (bars counted from 0), in order, each once. */
function places(layout: Layout, bars: LoopBars): number[] {
  const at = new Set<number>();
  for (const b of bars) {
    const s = layout.find((x) => x.block === b.block);
    // (a bar past the end of a section that was made shorter is no longer there)
    if (!s || b.bar < 0 || b.bar >= s.bars) continue;
    at.add(barIndex(layout, b));
  }
  return [...at].sort((a, b) => a - b);
}

const toBars = (layout: Layout, at: Iterable<number>): LoopBars => [...at].sort((a, b) => a - b).map((i) => barAt(layout, i)).filter((x): x is BarRef => !!x);

/** The loop as it plays: runs of bars next to each other, in the song's order. None: nothing loops. */
export function loopRuns(layout: Layout, bars: LoopBars): LoopSpan[] {
  const at = places(layout, bars);
  const runs: LoopSpan[] = [];
  let start = -1;
  at.forEach((i, k) => {
    if (start < 0) start = i;
    if (at[k + 1] !== i + 1) {
      runs.push({ from: barAt(layout, start)!, to: barAt(layout, i)! });
      start = -1;
    }
  });
  return runs;
}

/** The chosen bars that are still in the song, in its order (bars of removed sections, or past a section's end, are let go). */
export const fitBars = (layout: Layout, bars: LoopBars): LoopBars => toBars(layout, places(layout, bars));

/** Every bar that loops, as `block:bar`, to tell quickly whether a bar is in the loop. */
export const loopKeys = (layout: Layout, bars: LoopBars): Set<string> => new Set(fitBars(layout, bars).map((b) => `${b.block}:${b.bar}`));

/** Every bar of one section. */
export const sectionBars = (layout: Layout, block: string): LoopBars => {
  const s = layout.find((x) => x.block === block);
  return s ? Array.from({ length: s.bars }, (_, bar) => ({ block, bar })) : [];
};

/** Every bar of the song. */
export const allBars = (layout: Layout): LoopBars => layout.flatMap((s) => sectionBars(layout, s.block));

/** How much of a section loops: all of it, some of its bars, or none. */
export function sectionLoops(layout: Layout, bars: LoopBars, block: string): "all" | "some" | "none" {
  const s = layout.find((x) => x.block === block);
  const own = new Set(bars.filter((b) => b.block === block && s && b.bar >= 0 && b.bar < s.bars).map((b) => b.bar)).size;
  return !s || own === 0 ? "none" : own >= s.bars ? "all" : "some";
}

/** A section goes into the loop (every bar of it), or, if all of it loops already, comes out of it. */
export function toggleSection(layout: Layout, bars: LoopBars, block: string): LoopBars {
  const at = new Set(places(layout, bars));
  const own = places(layout, sectionBars(layout, block));
  const all = own.every((i) => at.has(i));
  for (const i of own) (all ? at.delete(i) : at.add(i));
  return toBars(layout, at);
}

/** Does every bar of the song loop? */
export const allLoop = (layout: Layout, bars: LoopBars): boolean => {
  const n = layout.reduce((a, s) => a + s.bars, 0);
  return n > 0 && places(layout, bars).length === n;
};

/**
 * A bar tapped. Inside a run of the loop, the run changes as a loop of bars always has: a bar at
 * either end of it comes off, one in the middle becomes the whole run. Outside the loop, the run
 * nearest to it grows to reach it, bringing every bar in between (nothing loops yet: it is the loop).
 */
export function tapBar(layout: Layout, bars: LoopBars, bar: BarRef): LoopBars {
  const i = barIndex(layout, bar);
  const runs = loopRuns(layout, bars);
  if (i < 0) return fitBars(layout, bars);
  if (!runs.length) return [bar];
  const span = (r: LoopSpan) => [barIndex(layout, r.from), barIndex(layout, r.to)] as const;
  // the run it is in, else the nearest one (the one before it, when two are as near)
  let k = runs.findIndex((r) => span(r)[0] <= i && i <= span(r)[1]);
  if (k < 0) {
    const gap = (r: LoopSpan) => (i < span(r)[0] ? span(r)[0] - i : i - span(r)[1]);
    k = runs.reduce((best, r, n) => (gap(r) < gap(runs[best]) ? n : best), 0);
  }
  const was = span(runs[k]);
  const now = tapLoop(layout, runs[k], bar);
  const at = new Set(places(layout, bars));
  for (let n = was[0]; n <= was[1]; n++) at.delete(n);
  if (now) for (let n = barIndex(layout, now.from); n <= barIndex(layout, now.to); n++) at.add(n);
  return toBars(layout, at);
}

/** One item of a list the player plays: how long it is, and (in a loop) how far into its section it starts. */
type Item = { beats: number; from?: number };
/** Which section each item of that list is in. */
type Where = { block: string };

/**
 * Where each item of a play list is in the song: its section's place in the song (`order`, the
 * sections by block, in order) and how many beats into that section it starts.
 */
export function placesOf(items: Item[], map: Where[], order: string[]): { sec: number; at: number }[] {
  const out: { sec: number; at: number }[] = [];
  items.forEach((it, i) => {
    const sec = order.indexOf(map[i]?.block ?? "");
    const prev = out[i - 1];
    // (a whole song's items do not say where they start: they follow on from the one before, in the same section)
    const at = it.from ?? (prev && map[i - 1]?.block === map[i]?.block ? prev.at + items[i - 1].beats : 0);
    out.push({ sec, at });
  });
  return out;
}

/**
 * The loop changed while the music plays, and the music has come to the end of a section: where it
 * goes on in the new list. Just after where it was, if the new list has those bars too (a loop
 * that grew, or let go: `on`, it follows straight on in the song); else at the start of the next
 * run of the new list later in the song than where it was; else, round again from the new list's
 * start, or, for a list that does not go round (`loop` false: the song straight through), its end:
 * the music stops there. `next`: the item the old list would have played next (its length: it came round).
 * `lens`: how many beats each section of `order` is, to tell that the start of the next section
 * follows straight on from the end of one (without them, only the same place in the same section does).
 */
export function entryOf(old: { items: Item[]; map: Where[] }, next: number, neu: { items: Item[]; map: Where[]; loop?: boolean }, order: string[], lens?: number[]): { at: number; on: boolean } {
  if (!neu.items.length || next <= 0) return { at: 0, on: false };
  const was = placesOf(old.items, old.map, order);
  const last = was[Math.min(next, old.items.length) - 1];
  if (!last) return { at: 0, on: false };
  const end = { sec: last.sec, at: last.at + old.items[Math.min(next, old.items.length) - 1].beats };
  const now = placesOf(neu.items, neu.map, order);
  const same = now.findIndex((p) => p.sec === end.sec && Math.abs(p.at - end.at) < 1e-6);
  if (same >= 0) return { at: same, on: true };
  const starts = now.map((p, j) => j === 0 || neu.map[j].block !== neu.map[j - 1].block || Math.abs(now[j - 1].at + neu.items[j - 1].beats - p.at) > 1e-6);
  const later = now.findIndex((p, j) => starts[j] && (p.sec > end.sec || (p.sec === end.sec && p.at >= end.at - 1e-6)));
  if (later >= 0) return { at: later, on: !!lens && now[later].sec === end.sec + 1 && now[later].at < 1e-6 && Math.abs(end.at - (lens[end.sec] ?? NaN)) < 1e-6 };
  return { at: neu.loop === false ? neu.items.length : 0, on: false };
}

/** Where a changed loop goes on (see `entryOf`): just the place in the new list. */
export const entryAfter = (old: { items: Item[]; map: Where[] }, next: number, neu: { items: Item[]; map: Where[]; loop?: boolean }, order: string[]): number => entryOf(old, next, neu, order).at;
