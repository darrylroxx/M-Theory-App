/**
 * The song changes shape while it plays straight through (a section removed, or made a bar
 * shorter): the music keeps its place. What is sounding plays on as it was, with its own drums,
 * and the song goes on from the same place in the new list, never an item or a section further on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio } from "./fakectx";
import { Harp } from "./plucked";
import { TrackVoice } from "./trackvoice";
import { setMix } from "./mix";
import type { Beat } from "./beats";
import type { PlayItem } from "./patterns";
import { placeAfter, sameShape } from "../song/loops";

/** every drum hit, with the beat (by its name) it was read from */
const hits: { name: string; when: number }[] = [];
vi.mock(import("./drumbus"), async (original) => {
  const mod = await original();
  return { ...mod, playStep: (b: Beat, _id: unknown, _lv: number, when: number) => void hits.push({ name: b.name ?? "", when }) };
});

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
  hits.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const S = await import("./synth");
const B = await import("./beats");

/** When each chord starts: every item plays one note of its own, so the order can be read off. */
function heard() {
  const log: { midi: number; when: number }[] = [];
  vi.spyOn(Harp.prototype, "buffer").mockImplementation(() => null as never);
  vi.spyOn(TrackVoice.prototype, "note").mockImplementation(function (this: TrackVoice, midi: number, when: number) {
    if ((this.track ?? this.kind) === "chord") log.push({ midi, when });
  });
  return () => {
    const out: [number, number][] = [];
    for (const n of [...log].sort((a, b) => a.when - b.when)) if (!out.some(([m, w]) => m === n.midi && Math.abs(w - n.when) < 1e-6)) out.push([n.midi, n.when]);
    return out;
  };
}

/** a one-bar 4/4 beat with a kick on every beat, named after its section */
const drumsOf = (name: string): Beat => ({ ...B.DEFAULT_BEAT, on: true, name, steps: 16, div: 4, bars: 1, rows: { ...B.DEFAULT_BEAT.rows, kick: "3000300030003000", snare: "0".repeat(16), hat: "0".repeat(16) } });

// A, B and C, each two bars of 4/4 (two seconds a bar at 120), each with drums of its own.
// Each bar plays a note that says where it is: A 60+, B 70+, C 80+.
type Sec = { block: string; bars: number; note: number };
const A: Sec = { block: "a", bars: 2, note: 60 };
const Bs: Sec = { block: "b", bars: 2, note: 70 };
const C: Sec = { block: "c", bars: 2, note: 80 };
const DRUMS: Record<string, Beat> = { a: drumsOf("A"), b: drumsOf("B"), c: drumsOf("C") };
/** The song straight through, as the page makes it. */
function song(...secs: Sec[]) {
  const items: PlayItem[] = [];
  const map: { block: string }[] = [];
  for (const s of secs)
    for (let k = 0; k < s.bars; k++) {
      items.push({ midi: [s.note + k], beats: 4, section: k === 0, drums: DRUMS[s.block], meter: { bar: 4 } });
      map.push({ block: s.block });
    }
  return { items, map, loop: false };
}
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
/** The page renders again with the new list, as GuitarView does: an edit of the same shape in place, else the list is put in at the same place. */
function edit(p: InstanceType<typeof S.ProgressionPlayer>, old: ReturnType<typeof song>, neu: ReturnType<typeof song>) {
  if (!sameShape(old, neu)) p.relist(neu.items, neu.loop, (next) => placeAfter(old, next, neu));
  p.update(neu.items, 120, "ring", neu.loop, null);
}
const notesOf = (got: [number, number][]) => got.map(([m]) => m);
/** the drums heard from `a` to `b` seconds, by the section they were read from */
const drumsIn = (a: number, b: number) => [...new Set(hits.filter((h) => h.when >= a - 1e-6 && h.when < b - 1e-6).map((h) => h.name))];

describe("the song changes shape while it plays straight through", () => {
  it("the section before the one playing is removed: B plays to its end, with its own drums, then C in full", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    let ended = false;
    p.onEnd = () => void (ended = true);
    const t0 = start();
    const all = song(A, Bs, C);
    p.start(all.items, 120, "ring", false, DRUMS.a);
    const gen = p.gen;
    // during B's first bar
    runTo(t0 + 4.5);
    edit(p, all, song(Bs, C));
    // what is sounding is still B's first bar of the list it came from
    expect(p.position()).toMatchObject({ gen, index: 2 });
    runTo(t0 + 11.9);
    expect(ended).toBe(false);
    runTo(t0 + 12.2);
    expect(ended).toBe(true);
    const got = read();
    expect(notesOf(got)).toEqual([60, 61, 70, 71, 80, 81]);
    got.forEach(([, w], i) => expect(w).toBeCloseTo(t0 + i * 2, 6));
    // B's drums all through B, C's only from where C starts
    expect(drumsIn(t0 + 4, t0 + 8)).toEqual(["B"]);
    expect(drumsIn(t0 + 8, t0 + 12)).toEqual(["C"]);
  });

  it("the section playing is made a bar shorter in its last bar: that bar plays out, then B from its first bar", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    const t0 = start();
    const all = song(A, Bs, C);
    p.start(all.items, 120, "ring", false, DRUMS.a);
    runTo(t0 + 2.5);
    edit(p, all, song({ ...A, bars: 1 }, Bs, C));
    runTo(t0 + 12.2);
    const got = read();
    p.stop();
    expect(notesOf(got)).toEqual([60, 61, 70, 71, 80, 81]);
    got.forEach(([, w], i) => expect(w).toBeCloseTo(t0 + i * 2, 6));
    expect(drumsIn(t0 + 2, t0 + 4)).toEqual(["A"]);
    expect(drumsIn(t0 + 4, t0 + 8)).toEqual(["B"]);
  });

  it("the section playing is made a bar longer in its last bar: its new bar plays, then B", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    const t0 = start();
    const all = song(A, Bs, C);
    p.start(all.items, 120, "ring", false, DRUMS.a);
    runTo(t0 + 2.5);
    edit(p, all, song({ ...A, bars: 3 }, Bs, C));
    runTo(t0 + 14.2);
    const got = read();
    p.stop();
    expect(notesOf(got)).toEqual([60, 61, 62, 70, 71, 80, 81]);
    got.forEach(([, w], i) => expect(w).toBeCloseTo(t0 + i * 2, 6));
    expect(drumsIn(t0 + 4, t0 + 6)).toEqual(["A"]);
    expect(drumsIn(t0 + 6, t0 + 10)).toEqual(["B"]);
  });

  it("the section playing is removed: its bar sounding ends, and the song goes on from the next section", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    const t0 = start();
    const all = song(A, Bs, C);
    p.start(all.items, 120, "ring", false, DRUMS.a);
    runTo(t0 + 4.5);
    edit(p, all, song(A, C));
    runTo(t0 + 10.2);
    const got = read();
    p.stop();
    expect(notesOf(got)).toEqual([60, 61, 70, 80, 81]);
    got.forEach(([, w], i) => expect(w).toBeCloseTo(t0 + i * 2, 6));
    expect(drumsIn(t0 + 4, t0 + 6)).toEqual(["B"]);
    expect(drumsIn(t0 + 6, t0 + 10)).toEqual(["C"]);
  });

  it("an edit that keeps the shape is played in place, from the next bar, with no new list", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    const t0 = start();
    const all = song(A, Bs, C);
    p.start(all.items, 120, "ring", false, DRUMS.a);
    const gen = p.gen;
    runTo(t0 + 4.5);
    const neu = { ...all, items: all.items.map((x, i) => (i === 3 ? { ...x, midi: [75] } : x)) };
    edit(p, all, neu);
    expect(p.gen).toBe(gen);
    runTo(t0 + 12.2);
    expect(notesOf(read())).toEqual([60, 61, 70, 75, 80, 81]);
  });
});
