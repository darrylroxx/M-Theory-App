/**
 * A loop of any sections, live: the sections chosen play back to back in the song's order, round
 * and round, each starting exactly where the one before ends (across time signatures), and a loop
 * changed while playing takes over where the section playing ends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio } from "./fakectx";
import { Harp } from "./plucked";
import { TrackVoice } from "./trackvoice";
import { setMix } from "./mix";
import type { PlayItem } from "./patterns";
import { entryAfter } from "../song/loops";

let live: FakeAudio;
class LiveCtx extends FakeAudio {
  constructor() {
    super();
    live = this;
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("AudioContext", LiveCtx);
  setMix(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const S = await import("./synth");

/** When each chord starts: every item plays one note of its own, so the order can be read off. */
function heard() {
  const log: { midi: number; when: number }[] = [];
  vi.spyOn(Harp.prototype, "buffer").mockImplementation(() => null as never);
  vi.spyOn(TrackVoice.prototype, "note").mockImplementation(function (this: TrackVoice, midi: number, when: number) {
    if ((this.track ?? this.kind) === "chord") log.push({ midi, when });
  });
  /** each chord once, in the order it sounds: [note, start] */
  return () => {
    const out: [number, number][] = [];
    for (const n of [...log].sort((a, b) => a.when - b.when)) if (!out.some(([m, w]) => m === n.midi && Math.abs(w - n.when) < 1e-6)) out.push([n.midi, n.when]);
    return out;
  };
}

// A B A C: A is 4/4 (a bar of 4 beats), B is 6/8 (3), C is 3/4 (3). Every item is a bar.
// Each bar plays a note that says where it is: A 60+, B 70+, the second A 90+, C 80+.
const SECS = [
  { block: "a1", bars: 2, bar: 4, note: 60 },
  { block: "b", bars: 2, bar: 3, note: 70 },
  { block: "a2", bars: 2, bar: 4, note: 90 },
  { block: "c", bars: 3, bar: 3, note: 80 },
];
const order = SECS.map((s) => s.block);
/** The play list of a loop of these sections (as the page makes it: each bar says how far into its section it starts). */
function loopOf(...blocks: string[]) {
  const items: PlayItem[] = [];
  const map: { block: string }[] = [];
  for (const s of SECS.filter((x) => blocks.includes(x.block)))
    for (let k = 0; k < s.bars; k++) {
      items.push({ midi: [s.note + k], beats: s.bar, from: k * s.bar, section: k === 0, meter: { bar: s.bar } });
      map.push({ block: s.block });
    }
  return { items, map };
}
/** The whole song straight through. */
function song() {
  const items: PlayItem[] = [];
  const map: { block: string }[] = [];
  for (const s of SECS)
    for (let k = 0; k < s.bars; k++) {
      items.push({ midi: [s.note + k], beats: s.bar, section: k === 0, meter: { bar: s.bar } });
      map.push({ block: s.block });
    }
  return { items, map };
}
/** Let the clock run to `to` seconds, the player's timers with it. */
function runTo(to: number) {
  while (live.currentTime < to - 1e-9) {
    live.currentTime = Math.min(to, live.currentTime + 0.05);
    vi.advanceTimersByTime(30);
  }
}
const start = () => {
  S.getAudio();
  live.currentTime = 0;
  return 0.08;
};
/** what plays, as notes, from a list of [note, start] (start rounded to a millisecond) */
const notesOf = (got: [number, number][]) => got.map(([m]) => m);

describe("a loop of sections apart from each other", () => {
  it("B and C (the A between them skipped): back to back, round and round, each bar where the last one ends", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    const t0 = start();
    const l = loopOf("b", "c");
    p.start(l.items, 120, "ring", true);
    // one pass is 2 bars of 3 + 3 bars of 3 = 15 beats = 7.5 s at 120
    runTo(t0 + 7.5 * 3 - 0.3);
    const got = read();
    p.stop();
    const pass = [70, 71, 80, 81, 82];
    expect(notesOf(got)).toEqual([...pass, ...pass, ...pass]);
    // every bar starts where the one before ends: 1.5 s each, with no gap where B meets C or the loop comes round
    got.forEach(([, w], i) => expect(w).toBeCloseTo(t0 + i * 1.5, 6));
  });

  it("A and C, across 4/4 and 3/4", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    const t0 = start();
    const l = loopOf("a1", "c");
    p.start(l.items, 120, "ring", true);
    // a pass: 8 + 9 beats = 8.5 s
    runTo(t0 + 8.5 * 2 - 0.3);
    const got = read();
    p.stop();
    expect(notesOf(got)).toEqual([60, 61, 80, 81, 82, 60, 61, 80, 81, 82]);
    const starts = [0, 2, 4, 5.5, 7, 8.5, 10.5, 12.5, 14, 15.5];
    got.forEach(([, w], i) => expect(w).toBeCloseTo(t0 + starts[i], 6));
  });

  it("a section that comes twice: the first A and the second, with B between them skipped", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    const t0 = start();
    p.start(loopOf("a1", "a2").items, 120, "ring", true);
    runTo(t0 + 8 * 2 - 0.3);
    const got = read();
    p.stop();
    expect(notesOf(got)).toEqual([60, 61, 90, 91, 60, 61, 90, 91]);
    got.forEach(([, w], i) => expect(w).toBeCloseTo(t0 + i * 2, 6));
  });
});

describe("the loop changed while playing", () => {
  /** queue a new list as the page does, and say where it goes on (in the list playing) */
  const change = (p: InstanceType<typeof S.ProgressionPlayer>, old: ReturnType<typeof song>, neu: ReturnType<typeof song>) =>
    p.queue(neu.items, true, (next) => entryAfter(old, next, neu, order));

  it("B looping, C added during B's first bar: B plays to its end, then C, then round to B", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    const t0 = start();
    const b = loopOf("b");
    p.start(b.items, 120, "ring", true);
    const gen = p.gen;
    runTo(t0 + 0.7);
    expect(change(p, b, loopOf("b", "c"))).toBe(gen + 1);
    // the bar playing is still the old list's
    expect(p.position()?.gen).toBe(gen);
    runTo(t0 + 7.5 + 3 - 0.3);
    const got = read();
    expect(p.position()?.gen).toBe(gen + 1);
    p.stop();
    expect(notesOf(got)).toEqual([70, 71, 80, 81, 82, 70, 71]);
    got.forEach(([, w], i) => expect(w).toBeCloseTo(t0 + i * 1.5, 6));
  });

  it("playing straight through, A and C picked during the first A: A plays out, then C (B and the second A skipped), then A", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    const t0 = start();
    const all = song();
    p.start(all.items, 120, "ring", false);
    runTo(t0 + 1);
    change(p, all, loopOf("a1", "c"));
    runTo(t0 + 8.5 + 4 - 0.3);
    const got = read();
    p.stop();
    expect(notesOf(got)).toEqual([60, 61, 80, 81, 82, 60, 61]);
    const starts = [0, 2, 4, 5.5, 7, 8.5, 10.5];
    got.forEach(([, w], i) => expect(w).toBeCloseTo(t0 + starts[i], 6));
  });

  it("changed twice before the section ends: the last change is the one that plays", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    const t0 = start();
    const b = loopOf("b");
    p.start(b.items, 120, "ring", true);
    runTo(t0 + 0.5);
    change(p, b, loopOf("b", "a2"));
    runTo(t0 + 1);
    change(p, b, loopOf("b", "c"));
    runTo(t0 + 3 + 4.5 - 0.3);
    const got = read();
    p.stop();
    expect(notesOf(got)).toEqual([70, 71, 80, 81, 82]);
  });

  it("an edit while a change waits goes to the new list; a new tempo is heard at once, and the join stays exact", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    const t0 = start();
    const b = loopOf("b");
    p.start(b.items, 120, "ring", true);
    runTo(t0 + 0.5);
    const neu = loopOf("b", "c");
    change(p, b, neu);
    // the page renders again with the new list (a chord of C changed), and a new tempo
    const edited = { ...neu, items: neu.items.map((x, i) => (i === 2 ? { ...x, midi: [85] } : x)) };
    p.update(edited.items, 120, "ring", true);
    runTo(t0 + 1.4);
    p.update(edited.items, 90, "ring", true);
    runTo(t0 + 12);
    const got = read();
    p.stop();
    expect(notesOf(got).slice(0, 5)).toEqual([70, 71, 85, 81, 82]);
    // B's first bar at 120 (1.5 s); its second was booked at 120 too (the player looks ahead); from then on at 90 (2 s a bar)
    const starts = [0, 1.5, 3, 5, 7];
    got.slice(0, 5).forEach(([, w], i) => expect(w).toBeCloseTo(t0 + starts[i], 6));
  });

  it("■ while a change waits: nothing is left waiting for the next ▶", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    const t0 = start();
    const b = loopOf("b");
    p.start(b.items, 120, "ring", true);
    runTo(t0 + 0.5);
    change(p, b, loopOf("b", "c"));
    p.stop();
    expect(p.queued).toBe(false);
    live.currentTime = 20;
    p.start(b.items, 120, "ring", true);
    runTo(20 + 0.08 + 3 - 0.3);
    const got = read().filter(([, w]) => w >= 20);
    p.stop();
    expect(notesOf(got)).toEqual([70, 71]);
  });
});
