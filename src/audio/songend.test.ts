/**
 * The end of a song that does not go round: the player looks a moment ahead, so the end is booked
 * a little before it comes. Until it comes the music is still playing: the playhead stays on the
 * last bar, and an edit made in that last moment (a loop set) is still heard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio } from "./fakectx";
import { Harp } from "./plucked";
import { TrackVoice } from "./trackvoice";
import { setMix } from "./mix";
import type { PlayItem } from "./patterns";

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
  return () => {
    const out: [number, number][] = [];
    for (const n of [...log].sort((a, b) => a.when - b.when)) if (!out.some(([m, w]) => m === n.midi && Math.abs(w - n.when) < 1e-6)) out.push([n.midi, n.when]);
    return out;
  };
}
/** Let the clock run to `to` seconds, the player's timers with it, in small steps. */
function runTo(to: number) {
  while (live.currentTime < to - 1e-9) {
    live.currentTime = Math.min(to, live.currentTime + 0.01);
    vi.advanceTimersByTime(10);
  }
}
const start = () => {
  S.getAudio();
  live.currentTime = 0;
  return 0.08;
};

// one section of two bars of 4/4 (two seconds a bar at 120): the song is over 4 s after it starts
const items: PlayItem[] = [
  { midi: [60], beats: 4, section: true, meter: { bar: 4 } },
  { midi: [61], beats: 4, meter: { bar: 4 } },
];

describe("the end of a song that does not go round", () => {
  it("the music is still playing, on its last bar, until the last beat has sounded", () => {
    heard();
    const p = new S.ProgressionPlayer();
    let ended = 0;
    p.onEnd = () => void ended++;
    const t0 = start();
    p.start(items, 120, "ring", false);
    // the end is booked a moment before it comes: the last bar is still sounding
    runTo(t0 + 3.9);
    expect(p.playing).toBe(true);
    expect(p.position()).toMatchObject({ index: 1 });
    expect(p.position()!.beat).toBeCloseTo(7.8, 1);
    expect(ended).toBe(0);
    // and when it comes, the player is over, once
    runTo(t0 + 4.1);
    expect(p.playing).toBe(false);
    expect(p.position()).toBeNull();
    expect(ended).toBe(1);
  });

  it("a loop set in that last moment: the music goes round, in time, and does not end", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    let ended = 0;
    p.onEnd = () => void ended++;
    const t0 = start();
    p.start(items, 120, "ring", false);
    runTo(t0 + 3.85);
    p.queue(items, true, () => 0);
    runTo(t0 + 8.5);
    expect(ended).toBe(0);
    expect(p.playing).toBe(true);
    const got = read();
    p.stop();
    expect(got.map(([m]) => m)).toEqual([60, 61, 60, 61, 60]);
    got.forEach(([, w], i) => expect(w).toBeCloseTo(t0 + i * 2, 6));
  });

  it("an edit in that last moment that does not go on past the end: it still ends there, once", () => {
    const read = heard();
    const p = new S.ProgressionPlayer();
    let ended = 0;
    p.onEnd = () => void ended++;
    const t0 = start();
    p.start(items, 120, "ring", false);
    runTo(t0 + 3.85);
    p.update(items.map((x) => ({ ...x })), 90, "ring", false);
    runTo(t0 + 6);
    expect(ended).toBe(1);
    expect(p.playing).toBe(false);
    expect(read().map(([m]) => m)).toEqual([60, 61]);
  });
});
