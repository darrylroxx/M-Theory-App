import { beforeAll, describe, expect, it } from "vitest";
import type { SynthEvent } from "./kernel";
import { allFinite, rms } from "./measure";
import { DEFAULT_PARAMS, type SynthParams } from "./params";
import { presetById } from "./presets";
import { renderNotes, soundFor } from "./render";
import type { SynthProcessorOptions } from "./synth.worklet";

// The worklet's world, as far as the processor sees it: a sample rate, the frame now, a port, and registerProcessor.
const SR = 48000;
const g = globalThis as unknown as Record<string, unknown>;
type Proc = { port: { onmessage: ((m: { data: unknown }) => void) | null }; process(i: Float32Array[][], o: Float32Array[][]): boolean };
let Processor: new (o: { processorOptions?: SynthProcessorOptions }) => Proc;

beforeAll(async () => {
  g.sampleRate = SR;
  g.currentFrame = 0;
  g.AudioWorkletProcessor = class {
    port = { onmessage: null, postMessage() {} };
  };
  g.registerProcessor = (_name: string, ctor: typeof Processor) => {
    Processor = ctor;
  };
  await import("./synth.worklet");
});

/** Where two renders first differ (−1: they are identical, sample for sample). */
function firstDiff(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** Run a processor for `frames` (128 at a time, as the audio thread does), calling `before(frame)` ahead of each block. */
function run(p: Proc, frames: number, before?: (frame: number) => void) {
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  const l = new Float32Array(128);
  const r = new Float32Array(128);
  for (let f = 0; f < frames; f += 128) {
    g.currentFrame = f;
    before?.(f);
    const alive = p.process([], [[l, r]]);
    expect(alive).toBe(true);
    L.set(l.subarray(0, Math.min(128, frames - f)), f);
    R.set(r.subarray(0, Math.min(128, frames - f)), f);
  }
  return { L, R };
}

const sound: SynthParams = { ...presetById("warm-pad")!.params };
const notes = [
  { midi: 48, start: 0.05, length: 0.9, velocity: 0.8 },
  { midi: 55, start: 0.05, length: 0.9, velocity: 0.7 },
  { midi: 64, start: 0.3, length: 0.5, velocity: 0.9 },
  { midi: 67, start: 0.6, length: 0.6, velocity: 0.6, slot: 2 },
  { midi: 69, start: 0.9, length: 0.4, velocity: 0.6, slot: 2 },
];
const eventsOf = (shift = 0): SynthEvent[] =>
  notes.flatMap((n, i) => [
    { type: "on" as const, t: n.start + shift, midi: n.midi, vel: n.velocity, id: i + 1, slot: n.slot ?? -1 },
    { type: "off" as const, t: n.start + n.length + shift, id: i + 1 },
  ]);

describe("the worklet", () => {
  it("renders an event list given in its options exactly as the kernel does (an offline render is the same sound)", () => {
    const p = new Processor({ processorOptions: { params: soundFor(sound), events: eventsOf(), seed: 9 } });
    const out = run(p, 2 * SR);
    const ref = renderNotes(sound, notes, { sampleRate: SR, seconds: 2, seed: 9 });
    expect(rms(out.L, 0, out.L.length)).toBeGreaterThan(0.01);
    expect(firstDiff(out.L, ref.L)).toBe(-1);
    expect(firstDiff(out.R, ref.R)).toBe(-1);
  });

  it("plays notes sent ahead of time through its port on the same samples", () => {
    const ref = renderNotes(sound, notes, { sampleRate: SR, seconds: 2, seed: 9 });
    // all at once, before the first block
    const p = new Processor({ processorOptions: { params: soundFor(sound), seed: 9 } });
    p.port.onmessage?.({ data: eventsOf() });
    expect(firstDiff(run(p, 2 * SR).L, ref.L)).toBe(-1);
    // a little at a time, each event sent up to 100 ms before it is due, as a player schedules
    const q = new Processor({ processorOptions: { params: soundFor(sound), seed: 9 } });
    const left = eventsOf();
    let sends = 0;
    const out = run(q, 2 * SR, (f) => {
      const due = left.filter((e) => "t" in e && e.t !== undefined && Math.round(e.t * SR) < f + 0.1 * SR + 128);
      if (!due.length) return;
      sends++;
      for (const e of due) left.splice(left.indexOf(e), 1);
      q.port.onmessage?.({ data: due });
    });
    expect(sends).toBeGreaterThan(3);
    expect(firstDiff(out.L, ref.L)).toBe(-1);
    expect(firstDiff(out.R, ref.R)).toBe(-1);
  });

  it("after a sync, a song played live sounds exactly like an offline render of it", () => {
    // live: the processor has been running (its LFO and drift moving) for 1.5 s before the song starts
    const live = new Processor({ processorOptions: { params: soundFor(sound), seed: 4 } });
    const start = 1.5;
    const out = run(live, Math.round((start + 2) * SR), (f) => {
      if (f === 128 * 100) live.port.onmessage?.({ data: [{ type: "sync", t: start }, ...eventsOf(start)] });
    });
    const offline = new Processor({ processorOptions: { params: soundFor(sound), events: eventsOf(), seed: 4 } });
    const ref = run(offline, 2 * SR);
    const from = Math.round(start * SR);
    // the sync lands on a block boundary only by chance; compare from the song's own start
    expect(firstDiff(out.L.subarray(from, from + 2 * SR - 256), ref.L.subarray(0, 2 * SR - 256))).toBe(-1);
  });

  it("changes sound at a time given in the list, stops on a stop, and ends when disposed", () => {
    const bright: SynthParams = soundFor({ ...DEFAULT_PARAMS, cutoff: 1, reverb: 0, fx: "off", release: 0, width: 0 });
    const dark: SynthParams = { ...bright, cutoff: 0.25 };
    const evs: SynthEvent[] = [
      { type: "on", t: 0, midi: 45, vel: 0.8, id: 1 },
      { type: "on", t: 1.2, midi: 45, vel: 0.8, id: 2 },
      { type: "params", t: 0.5, params: dark },
      { type: "stop", t: 1 },
      { type: "on", t: 1.4, midi: 45, vel: 0.8, id: 3 },
    ];
    // the stop at 1 s drops the note at 1.2 s that was sent before it, not the one at 1.4 s sent after it
    const p = new Processor({ processorOptions: { params: bright, events: evs } });
    const out = run(p, 2 * SR);
    const d = new Float32Array(out.L.length);
    for (let i = 1; i < d.length; i++) d[i] = out.L[i] - out.L[i - 1];
    expect(rms(d, 0.6 * SR, 0.9 * SR)).toBeLessThan(0.5 * rms(d, 0.2 * SR, 0.45 * SR));
    expect(rms(out.L, 1.15 * SR, 1.38 * SR)).toBeLessThan(1e-4);
    expect(rms(out.L, 1.5 * SR, 2 * SR)).toBeGreaterThan(0.01);
    expect(allFinite(out.L)).toBe(true);
    p.port.onmessage?.({ data: "dispose" });
    expect(p.process([], [[new Float32Array(128), new Float32Array(128)]])).toBe(false);
  });
});

describe("the worklet tells the page when it has gone quiet", () => {
  const on = (t: number, midi: number, id: number): SynthEvent => ({ type: "on", t, midi, vel: 0.8, id });
  const off = (t: number, id: number): SynthEvent => ({ type: "off", t, id });
  // a short sound with no echo or reverb of its own, so it is quiet soon after each note
  const short = soundFor({ ...DEFAULT_PARAMS, reverb: 0, release: 0.05, fx: "off" });
  it("once, after the last note has rung out, with how many messages it had; not while a note waits; again after the next", () => {
    const p = new Processor({ processorOptions: { params: short, report: true } });
    const said: { frame: number; d: unknown }[] = [];
    (p.port as unknown as { postMessage: (d: unknown) => void }).postMessage = (d) => said.push({ frame: g.currentFrame as number, d });
    p.port.onmessage!({ data: [on(0.05, 60, 1), off(0.3, 1)] });
    p.port.onmessage!({ data: [on(1.5, 64, 2), off(1.6, 2)] });
    run(p, SR * 1.4);
    // quiet between them, but a note is waiting: nothing said
    expect(said).toEqual([]);
    run(p, SR * 4, (f) => (g.currentFrame = SR * 1.4 + f));
    expect(said.length).toBe(1);
    expect(said[0].d).toEqual({ idle: true, got: 2 });
    expect(said[0].frame / SR).toBeGreaterThan(1.6);
    p.port.onmessage!({ data: [on(6, 67, 3), off(6.1, 3)] });
    run(p, SR * 3, (f) => (g.currentFrame = SR * 5.4 + f));
    expect(said.length).toBe(2);
    expect(said[1].d).toEqual({ idle: true, got: 3 });
    // a change of sound while it is quiet: said again, with the new count (the page only acts on a quiet that has heard everything)
    p.port.onmessage!({ data: { type: "params", params: short } });
    run(p, SR, (f) => (g.currentFrame = SR * 8.4 + f));
    expect(said.length).toBe(3);
    expect(said[2].d).toEqual({ idle: true, got: 4 });
  });
  it("says nothing unless asked (an offline render)", () => {
    const p = new Processor({ processorOptions: { params: short, events: [on(0.05, 60, 1), off(0.3, 1)] } });
    const said: unknown[] = [];
    (p.port as unknown as { postMessage: (d: unknown) => void }).postMessage = (d) => said.push(d);
    run(p, SR * 2);
    expect(said).toEqual([]);
  });
});
