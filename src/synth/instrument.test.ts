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

describe("the synth at rest lets the track's effects rest", () => {
  // a node that says what was done to it, and whose processor can speak
  let nodes: { port: { onmessage: ((m: { data: unknown }) => void) | null; posts: unknown[] }; wired: boolean; log: string[] }[] = [];
  beforeEach(() => {
    nodes = [];
    g.AudioWorkletNode = class {
      port = { onmessage: null as ((m: { data: unknown }) => void) | null, posts: [] as unknown[], postMessage(d: unknown) { this.posts.push(d); }, close() {} };
      wired = false;
      log: string[] = [];
      constructor(_c: unknown, _name: string, o: { processorOptions: SynthProcessorOptions }) {
        made.push(o.processorOptions);
        nodes.push(this as never);
      }
      connect() {
        this.wired = true;
        this.log.push("connect");
      }
      disconnect() {
        this.wired = false;
        this.log.push("disconnect");
      }
    };
  });
  const tick = () => new Promise<void>((r) => queueMicrotask(r));

  it("live: quiet with nothing sent since, its output is let go; the next note connects it again before it is sent", async () => {
    const s = new SynthInstrument(ctx as unknown as BaseAudioContext);
    await s.load();
    expect(made[0].report).toBe(true);
    const n = nodes[0];
    s.play(60, 0.2, 0.8, 0.3);
    await tick();
    expect(n.port.posts.length).toBe(1);
    // a quiet reported before that message arrived is not the real one
    n.port.onmessage!({ data: { idle: true, got: 0 } });
    expect(n.wired).toBe(true);
    n.port.onmessage!({ data: { idle: true, got: 1 } });
    expect(n.wired).toBe(false);
    // a new sound does not wake it; a note does, at once, before its message goes
    s.set(made[0].params!);
    expect(n.wired).toBe(false);
    ctx.currentTime = 3;
    s.play(64, 3.1, 0.8, 0.3);
    expect(n.wired).toBe(true);
    expect(n.port.posts.length).toBe(1);
    await tick();
    expect(n.port.posts.length).toBe(2);
    expect(n.log).toEqual(["connect", "disconnect", "connect"]);
  });

  it("offline: never asked to report, so a render keeps everything connected", async () => {
    class Off {
      currentTime = 0;
      createGain = () => ({ connect() {}, disconnect() {} });
      audioWorklet = { addModule: () => Promise.resolve() };
    }
    g.OfflineAudioContext = Off;
    try {
      const s = new SynthInstrument(new Off() as unknown as BaseAudioContext);
      s.play(60, 0.2, 0.8, 0.3);
      await s.load();
      expect(made[0].report).toBe(false);
      expect(nodes[0].port.onmessage).toBe(null);
    } finally {
      delete g.OfflineAudioContext;
    }
  });
});
