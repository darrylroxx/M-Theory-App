/** A take heard alone: one at a time, and never one asked for before it finished loading. */
import { describe, expect, it, vi } from "vitest";

const pending: ((b: unknown) => void)[] = [];
const sources: { buffer: unknown; started?: number; stopped: boolean }[] = [];
vi.mock("./takebuffers", () => ({ loadTake: () => new Promise((r) => pending.push(r)) }));
vi.mock("./mix", () => ({ fader: () => ({}) }));
vi.mock("./context", () => ({
  audioContext: () => ({
    currentTime: 1,
    createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
    createBufferSource: () => {
      const s = { buffer: null as unknown, started: undefined as number | undefined, stopped: false, connect() {}, start(w: number) { s.started = w; }, stop() { s.stopped = true; }, onended: null };
      sources.push(s);
      return s;
    },
  }),
}));
const { hearAlone, hearingAlone, stopAlone } = await import("./takeplay");
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
    const d = hearAlone(take(0), "v1");
    stopAlone();
    pending[3]("D");
    expect(await d).toBeNull();
    expect(sources).toHaveLength(2);
  });
});
