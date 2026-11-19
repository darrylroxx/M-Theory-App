import { describe, expect, it, vi } from "vitest";
import type { FromWorker, ToWorker } from "./layers.worker";
import type { Song } from "./songfile";

// the worker that hears the song, stood in for: what it is sent is kept, and the test answers for it
const workers: FakeWorker[] = [];
class FakeWorker {
  sent: ToWorker[] = [];
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    workers.push(this);
  }
  postMessage(m: ToWorker) {
    this.sent.push(m);
  }
  terminate() {}
}
vi.mock("./layers.worker.ts?worker", () => ({ default: FakeWorker }));

const { FileLayers } = await import("./filelayers");

const song = (): Song => {
  const ch = new Float32Array(4410);
  return { name: "x", buffer: { sampleRate: 44100, numberOfChannels: 1, getChannelData: () => ch } as unknown as AudioBuffer, mono: ch, duration: 0.1, ref: -20 };
};

describe("the page's side of a song's hearing", () => {
  it("says how far the model's stems have been heard (so they are read only a little ahead of it), counting only the current hand-over", () => {
    const f = new FileLayers(song());
    const w = workers.at(-1)!;
    const open = w.sent[0] as Extract<ToWorker, { type: "open" }>;
    const say = (m: FromWorker) => w.onmessage!({ data: m } as MessageEvent<FromWorker>);
    expect(f.stemsHeard()).toBe(0);
    f.useStems(["drums", "bass", "other", "vocals"], 44100, 0);
    expect(f.stemsHeard()).toBe(0);
    say({ type: "better", id: open.id, pass: 1, to: 12.5, layers: [] });
    expect(f.stemsHeard()).toBe(12.5);
    // a hand-over begun again (the split tried again) starts from nothing; word of the old one is not taken
    f.useStems(["drums", "bass", "other", "vocals"], 44100, 0);
    say({ type: "better", id: open.id, pass: 1, to: 30, layers: [] });
    expect(f.stemsHeard()).toBe(0);
    say({ type: "better", id: open.id, pass: 2, to: 4, layers: [] });
    expect(f.stemsHeard()).toBe(4);
    f.close();
  });
});
