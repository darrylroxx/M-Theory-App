import { describe, expect, it, vi } from "vitest";

// the file player sends its sound to the app's master bus: stood in for, as nothing is heard here
vi.mock("../audio/mix", () => ({ master: () => ({}) }));

const { heardTime } = await import("./clock");
const { Player } = await import("../listen/songfile");

/** A stand-in audio context: its clock, its delays, and (if given) the browser's stamp of what is leaving the speakers. */
function context(o: { now: number; base?: number; output?: number; stamp?: { contextTime: number; performanceTime: number } }) {
  return {
    currentTime: o.now,
    baseLatency: o.base,
    outputLatency: o.output,
    getOutputTimestamp: o.stamp ? () => o.stamp! : undefined,
    createBufferSource: () => ({ buffer: null, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }),
  };
}

describe("the clock both kinds of music are painted by: what is heard, not what is scheduled", () => {
  it("without the browser's stamp, both the context's own buffering and the system's delay are taken off", () => {
    expect(heardTime(context({ now: 10, base: 0.01, output: 0.02 }))).toBeCloseTo(9.97, 9);
    // a browser that gives neither: the context's clock
    expect(heardTime(context({ now: 10 }))).toBe(10);
    // (only one of them given)
    expect(heardTime(context({ now: 10, base: 0.005 }))).toBeCloseTo(9.995, 9);
  });

  it("the browser's stamp is believed when it is sensible: the time leaving the speakers, carried on to now", () => {
    const c = context({ now: 10, base: 0.01, output: 0.02, stamp: { contextTime: 9.95, performanceTime: 1000 } });
    expect(heardTime(c, 1010)).toBeCloseTo(9.96, 9);
    // never later than the context's clock
    expect(heardTime(context({ now: 10, stamp: { contextTime: 9.999, performanceTime: 1000 } }), 1008)).toBe(10);
    // a stamp that is stale (half a second or more behind) is not believed
    expect(heardTime(context({ now: 10, base: 0.01, output: 0.02, stamp: { contextTime: 9, performanceTime: 1000 } }), 1000)).toBeCloseTo(9.97, 9);
    // nor one not started yet
    expect(heardTime(context({ now: 10, base: 0.01, stamp: { contextTime: 0, performanceTime: 0 } }), 0)).toBeCloseTo(9.99, 9);
  });

  it("a song from a file is where the app's own song would be: the file player's position goes by the same clock", () => {
    const c = context({ now: 5, base: 0.012, output: 0.03 });
    const p = new Player(c as unknown as AudioContext);
    p.play({ name: "x", buffer: {} as AudioBuffer, mono: new Float32Array(0), duration: 60, ref: -20 }, 0);
    // it starts a moment after it is asked to (30 ms), from 0 s
    c.currentTime = 7;
    // two seconds on the context's clock, less the start's moment, less what is still on its way to the speakers
    expect(p.position()).toBeCloseTo(heardTime(c) - 5.03, 9);
    expect(p.position()).toBeCloseTo(2 - 0.03 - 0.042, 9);
    // the same with the browser's stamp
    const d = context({ now: 5, base: 0.012, output: 0.03, stamp: { contextTime: 0, performanceTime: 0 } });
    const q = new Player(d as unknown as AudioContext);
    q.play({ name: "x", buffer: {} as AudioBuffer, mono: new Float32Array(0), duration: 60, ref: -20 }, 10);
    d.currentTime = 6;
    d.getOutputTimestamp = () => ({ contextTime: 5.95, performanceTime: performance.now() });
    expect(q.position()).toBeCloseTo(10 + heardTime(d) - 5.03, 3);
    // stopped: nowhere
    q.stop();
    expect(q.position()).toBeNull();
  });
});
