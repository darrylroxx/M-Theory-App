import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SynthInstrument } from "./instrument";
import type { SynthEvent } from "./kernel";
import type { SynthProcessorOptions } from "./synth.worklet";

// Just enough of a live audio context and an AudioWorkletNode to see what the processor is made with.
const g = globalThis as unknown as Record<string, unknown>;
let made: SynthProcessorOptions[] = [];
let ctx: { currentTime: number; createGain(): unknown; audioWorklet: { addModule(): Promise<void> } };

beforeEach(() => {
  made = [];
  g.AudioWorkletNode = class {
    port = { postMessage() {}, close() {} };
    constructor(_c: unknown, _name: string, o: { processorOptions: SynthProcessorOptions }) {
      made.push(o.processorOptions);
    }
    connect() {}
    disconnect() {}
  };
  ctx = { currentTime: 0, createGain: () => ({ connect() {}, disconnect() {} }), audioWorklet: { addModule: () => Promise.resolve() } };
});
afterEach(() => {
  delete g.AudioWorkletNode;
});

const notesIn = (events: SynthEvent[] | undefined) => (events ?? []).filter((e): e is Extract<SynthEvent, { type: "on" }> => e.type === "on").map((e) => e.midi);

describe("the synth, stopped while it is still loading", () => {
  it("does not burst into what was booked before ■ once it has loaded", async () => {
    const s = new SynthInstrument(ctx as unknown as BaseAudioContext);
    // ▶: a drone booked across the section, an arpeggio's steps ahead
    ctx.currentTime = 0.1;
    for (const m of [48, 55, 60]) s.play(m, 0.18, 0.8, 9.6, 100);
    for (let i = 0; i < 8; i++) s.play(72 + i, 0.18 + i * 0.15, 0.8, 0.12);
    // ■ half a second in, before the processor exists
    ctx.currentTime = 0.6;
    s.stopAll();
    // ▶ again: these are the notes to hear
    ctx.currentTime = 0.9;
    s.play(64, 1, 0.8, 2);
    ctx.currentTime = 1.2;
    await s.load();
    expect(made).toHaveLength(1);
    expect(notesIn(made[0].events)).toEqual([64]);
    expect(made[0].events?.some((e) => e.type === "stop")).toBe(false);
  });

  it("keeps everything when it was not stopped", async () => {
    const s = new SynthInstrument(ctx as unknown as BaseAudioContext);
    ctx.currentTime = 0.1;
    for (const m of [48, 55, 60]) s.play(m, 0.18, 0.8, 9.6, 100);
    ctx.currentTime = 0.5;
    await s.load();
    expect(notesIn(made[0].events)).toEqual([48, 55, 60]);
  });
});
