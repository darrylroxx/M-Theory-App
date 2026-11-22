import { describe, expect, it, vi } from "vitest";

// the engine and the audio context, stood in for: a read returns the range it was asked for
const reads: { path: string; start: number; frames: number }[] = [];
vi.mock("../desktop", () => ({
  readTakeRange: async (path: string, start: number, frames: number) => {
    reads.push({ path, start, frames });
    return new Float64Array([start, frames]).buffer;
  },
}));
// (a read of a file whose name ends in "stereo.wav" decodes to two channels, as a pair's files and a voice's second file do)
vi.mock("./context", () => ({
  audioContext: () => ({
    decodeAudioData: async (b: ArrayBuffer) => ({ from: new Float64Array(b)[0], length: new Float64Array(b)[1], numberOfChannels: reads[reads.length - 1].path.endsWith("stereo.wav") ? 2 : 1 }),
    // a buffer made by hand, as one is for a recording kept in the browser
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, getChannelData: (ch: number) => data[ch] };
    },
  }),
}));
// the browser's store of recordings, stood in for: one stereo recording of ten frames under "idb:w1"
const stored: Record<string, { rate: number; channels: Float32Array[] }> = {
  "idb:w1": { rate: 44100, channels: [Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), Float32Array.from([0, -1, -2, -3, -4, -5, -6, -7, -8, -9])] },
  "idb:m1": { rate: 48000, channels: [Float32Array.from([5, 6, 7])] },
};
const asked: string[] = [];
vi.mock("./takestore", () => ({
  isStored: (path: string) => path.startsWith("idb:"),
  getSound: async (path: string) => {
    asked.push(path);
    return stored[path] ?? null;
  },
}));

const { heldTakes, keepTakes, loadTake, takeBuffer, takeKey } = await import("./takebuffers");

describe("take buffers", () => {
  it("only the take is read from a recording, and each take of one file is its own buffer", async () => {
    const a = { wet: "long-wet-1.wav", start: 96_300, frames: 192_000 };
    const b = { wet: "long-wet-1.wav", start: 96_300 + 192_000 * 400, frames: 192_000 };
    const ba = (await loadTake(a)) as unknown as { from: number };
    const bb = (await loadTake(b)) as unknown as { from: number };
    expect(reads).toEqual([{ path: a.wet, start: a.start, frames: a.frames }, { path: b.wet, start: b.start, frames: b.frames }]);
    expect(ba.from).toBe(a.start);
    expect(bb.from).toBe(b.start);
    expect(takeKey(a)).not.toBe(takeKey(b));
    // asked again, nothing is read again
    await loadTake(a);
    await Promise.all([loadTake(b), loadTake(b)]);
    expect(reads).toHaveLength(2);
    expect(takeBuffer({ ...a })).toBe(ba);
    // the same part of a file made again with a new sound is a different take
    expect(takeBuffer({ ...a, wet: "long-wet-2.wav" })).toBeUndefined();
  });

  it("the takes the song plays stay; of the others, only the few heard last", async () => {
    const played = [{ wet: "x.wav", start: 0, frames: 10 }, { wet: "y.wav", start: 5, frames: 10 }];
    keepTakes(played);
    for (const t of played) await loadTake(t);
    // heard alone, one after another: a long session's worth
    for (let i = 0; i < 40; i++) await loadTake({ wet: "x.wav", start: 1000 * (i + 1), frames: 10 });
    expect(heldTakes()).toBeLessThanOrEqual(2 + 8);
    expect(played.every((t) => takeBuffer(t))).toBe(true);
    expect(takeBuffer({ wet: "x.wav", start: 40_000, frames: 10 })).toBeDefined();
    expect(takeBuffer({ wet: "x.wav", start: 1000, frames: 10 })).toBeUndefined();
  });

  it("a stereo take loads as it is: both channels of a pair's file", async () => {
    const pair = { wet: "guitars-stereo.wav", start: 4800, frames: 96_000 };
    const buf = (await loadTake(pair)) as unknown as { from: number; numberOfChannels: number };
    expect(reads[reads.length - 1]).toEqual({ path: pair.wet, start: 4800, frames: 96_000 });
    expect(buf.numberOfChannels).toBe(2);
    expect(takeBuffer(pair)).toBe(buf);
    // a voice's dry file beside it is one channel, as ever
    expect(((await loadTake({ wet: "voice.wav", start: 0, frames: 10 })) as unknown as { numberOfChannels: number }).numberOfChannels).toBe(1);
  });

  it("a take kept in the browser's store (idb:) is read from there: its own part, its own channels, at its own rate", async () => {
    const before = reads.length;
    const t = { wet: "idb:w1", start: 2, frames: 5 };
    const buf = (await loadTake(t))!;
    // (nothing is asked of the desktop engine)
    expect(reads).toHaveLength(before);
    expect(asked).toEqual(["idb:w1"]);
    expect([buf.numberOfChannels, buf.length, buf.sampleRate]).toEqual([2, 5, 44100]);
    expect([...buf.getChannelData(0)]).toEqual([2, 3, 4, 5, 6]);
    expect([...buf.getChannelData(1)]).toEqual([-2, -3, -4, -5, -6]);
    // kept like any other take
    expect(takeBuffer({ ...t })).toBe(buf);
    await loadTake(t);
    expect(asked).toEqual(["idb:w1"]);
    // a one-channel recording is one channel
    expect((await loadTake({ wet: "idb:m1", start: 0, frames: 3 }))!.numberOfChannels).toBe(1);
  });

  it("an idb: take that starts before its recording does, or runs past its end, is silence there (as a file's is)", async () => {
    const early = (await loadTake({ wet: "idb:w1", start: -2, frames: 4 }))!;
    expect([...early.getChannelData(0)]).toEqual([0, 0, 0, 1]);
    const late = (await loadTake({ wet: "idb:w1", start: 8, frames: 4 }))!;
    expect([...late.getChannelData(0)]).toEqual([8, 9, 0, 0]);
    expect([...late.getChannelData(1)]).toEqual([-8, -9, 0, 0]);
  });

  it("an idb: take whose recording this browser does not have does not load, and is asked for again the next time", async () => {
    const gone = { wet: "idb:elsewhere", start: 0, frames: 10 };
    expect(await loadTake(gone)).toBeNull();
    expect(takeBuffer(gone)).toBeUndefined();
    stored["idb:elsewhere"] = { rate: 48000, channels: [new Float32Array(10)] };
    expect(await loadTake(gone)).not.toBeNull();
  });
});
