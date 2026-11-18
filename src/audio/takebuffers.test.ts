import { describe, expect, it, vi } from "vitest";

// the engine and the audio context, stood in for: a read returns the range it was asked for
const reads: { path: string; start: number; frames: number }[] = [];
vi.mock("../desktop", () => ({
  readTakeRange: async (path: string, start: number, frames: number) => {
    reads.push({ path, start, frames });
    return new Float64Array([start, frames]).buffer;
  },
}));
vi.mock("./context", () => ({
  audioContext: () => ({ decodeAudioData: async (b: ArrayBuffer) => ({ from: new Float64Array(b)[0], length: new Float64Array(b)[1] }) }),
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
});
