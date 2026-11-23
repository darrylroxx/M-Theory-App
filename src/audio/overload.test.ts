import { describe, expect, it, vi } from "vitest";
import { OVERLOAD_MESSAGE, overloadJudge, watchOverload } from "./overload";

describe("an overloaded audio thread is said once, after a couple of seconds of it", () => {
  it("one late second (a page opening) says nothing; two in a row say it, once", () => {
    const said = vi.fn();
    const judge = overloadJudge(1, said);
    judge(true);
    judge(false);
    judge(true);
    expect(said).not.toHaveBeenCalled();
    judge(true);
    expect(said).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) judge(true);
    expect(said).toHaveBeenCalledTimes(1);
  });

  it("a browser that measures the thread's load: full, or blocks late, for two readings", () => {
    const said = vi.fn();
    const listeners: ((e: Event) => void)[] = [];
    const cap = { start: vi.fn(), stop: vi.fn(), addEventListener: (_: string, f: (e: Event) => void) => listeners.push(f), removeEventListener: vi.fn() };
    const stop = watchOverload({ renderCapacity: cap } as unknown as BaseAudioContext, said);
    expect(cap.start).toHaveBeenCalledWith({ updateInterval: 1 });
    const tell = (averageLoad: number, underrunRatio: number) => listeners.forEach((f) => f({ averageLoad, underrunRatio } as unknown as Event));
    tell(0.7, 0);
    tell(0.97, 0);
    tell(0.6, 0);
    expect(said).not.toHaveBeenCalled();
    tell(0.9, 0.05);
    tell(0.99, 0);
    expect(said).toHaveBeenCalledTimes(1);
    stop();
    expect(cap.stop).toHaveBeenCalled();
  });

  it("a browser that counts the sound it could not deliver: asked about once a second, while playing only", () => {
    vi.useFakeTimers();
    try {
      const said = vi.fn();
      const stats = { underrunDuration: 0.5, totalDuration: 100 };
      const stop = watchOverload({ playbackStats: stats } as unknown as BaseAudioContext, said);
      // a second of sound, all of it delivered
      stats.totalDuration += 1;
      vi.advanceTimersByTime(1000);
      // two seconds running with a tenth of the sound missing
      stats.totalDuration += 1;
      stats.underrunDuration += 0.1;
      vi.advanceTimersByTime(1000);
      expect(said).not.toHaveBeenCalled();
      stats.totalDuration += 1;
      stats.underrunDuration += 0.1;
      vi.advanceTimersByTime(1000);
      expect(said).toHaveBeenCalledTimes(1);
      stop();
      stats.totalDuration += 5;
      stats.underrunDuration += 3;
      vi.advanceTimersByTime(5000);
      expect(said).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a browser with neither: nothing is watched and nothing is said", () => {
    vi.useFakeTimers();
    try {
      const said = vi.fn();
      const stop = watchOverload({} as BaseAudioContext, said);
      vi.advanceTimersByTime(10000);
      expect(said).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the line names no product and says what helps", () => {
    expect(OVERLOAD_MESSAGE).toMatch(/Fewer tracks/);
    expect(OVERLOAD_MESSAGE).toMatch(/effects/);
  });
});
