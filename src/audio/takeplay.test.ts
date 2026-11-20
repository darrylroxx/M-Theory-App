/** A take heard alone: one at a time, and never one asked for before it finished loading. */
import { describe, expect, it, vi } from "vitest";

const pending: ((b: unknown) => void)[] = [];
const sources: { buffer: unknown; started?: number; stopped: boolean; stopAt?: number }[] = [];
const gains: { events: [string, number, number][] }[] = [];
vi.mock("./takebuffers", () => ({ loadTake: () => new Promise((r) => pending.push(r)) }));
vi.mock("./mix", () => ({ fader: () => ({}) }));
vi.mock("./context", () => ({
  audioContext: () => ({
    currentTime: 1,
    createGain: () => {
      const events: [string, number, number][] = [];
      gains.push({ events });
      const p = { value: 1, setValueAtTime: (v: number, t: number) => events.push(["set", v, t]), linearRampToValueAtTime: (v: number, t: number) => events.push(["ramp", v, t]), cancelScheduledValues: (t: number) => events.push(["cancel", 0, t]) };
      return { gain: p, connect() {}, disconnect() {} };
    },
    createBufferSource: () => {
      const s = { buffer: null as unknown, started: undefined as number | undefined, stopped: false, stopAt: undefined as number | undefined, connect() {}, start(w: number) { s.started = w; }, stop(w?: number) { s.stopped = true; s.stopAt = w; }, onended: null };
      sources.push(s);
      return s;
    },
  }),
  // (this pretend context does not say how far ahead it works: a fade starts on its clock)
  soonest: (c: { currentTime: number }) => c.currentTime,
}));
const { EDGE_FADE, hearAlone, hearingAlone, stopAlone } = await import("./takeplay");
const take = (start: number) => ({ wet: "a.wav", start, frames: 48000, rate: 48000 });

describe("a take heard alone", () => {
  it("two asked for while loading: only the last is heard", async () => {
    const a = hearAlone(take(0), "v1");
    const b = hearAlone(take(48000), "v1");
    pending[0]("A");
    pending[1]("B");
    expect(await a).toBeNull();
    expect(await b).toBe(true);
    expect(sources.map((s) => s.buffer)).toEqual(["B"]);
  });
  it("the next one stops it; stopping stops it, and one still loading is never heard", async () => {
    const c = hearAlone(take(96000), "v1");
    expect(sources[0].stopped).toBe(true);
    pending[2]("C");
    await c;
    expect(hearingAlone()).toBe(true);
    stopAlone();
    expect(sources[1].stopped).toBe(true);
    expect(hearingAlone()).toBe(false);
    // not cut off where it is (a click): faded out over a few milliseconds from now (1 s), then stopped
    const g = gains[gains.length - 1].events;
    expect(g.slice(-1)[0]).toEqual(["ramp", 0, 1 + EDGE_FADE]);
    expect(sources[1].stopAt).toBeCloseTo(1 + EDGE_FADE + 0.001, 9);
    const d = hearAlone(take(0), "v1");
    stopAlone();
    pending[3]("D");
    expect(await d).toBeNull();
    expect(sources).toHaveLength(2);
  });
  it("stopped (▶, the page left) or another asked for while the interface closes first: it is never heard, the last one asked for is", async () => {
    let closed!: () => void;
    const closing = new Promise<void>((r) => (closed = r));
    const first = () => closing;
    const e = hearAlone(take(0), "v1", undefined, first);
    stopAlone();
    closed();
    expect(await e).toBeNull();
    expect(pending).toHaveLength(4);
    let closed2!: () => void;
    const closing2 = new Promise<void>((r) => (closed2 = r));
    const f = hearAlone(take(0), "v1", undefined, () => closing2);
    const g = hearAlone(take(48000), "v1", undefined, () => closing2);
    closed2();
    expect(await f).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    // only the second is read, and heard
    expect(pending).toHaveLength(5);
    pending[4]("G");
    expect(await g).toBe(true);
    expect(sources.map((s) => s.buffer)).toEqual(["B", "C", "G"]);
    stopAlone();
  });
});
