import { describe, expect, it } from "vitest";
import { nudgeFrames } from "../song/takes";
import { joinBlocks, keptChannels, peakOf, webOffset } from "./webreccore";

describe("a recording made in a browser: where the song's first beat lies in it", () => {
  const rate = 48000;

  it("with nothing late: as many frames in as the song began after the recording did", () => {
    expect(webOffset({ rate, recAt: 10, songAt: 10.5 })).toBe(24000);
    expect(webOffset({ rate, recAt: 3.25, songAt: 3.25 })).toBe(0);
  });

  it("the take is moved earlier by the browser's buffer and the computer's output together", () => {
    // 20 ms of the browser's own, 30 ms of the output: what is played along is played 50 ms after the clock says
    const plain = webOffset({ rate, recAt: 10, songAt: 10.5 });
    const late = webOffset({ rate, recAt: 10, songAt: 10.5, baseLatency: 0.02, outputLatency: 0.03 });
    expect(late - plain).toBe(Math.round(0.05 * rate));
    // (the take's first frame lies further into the recording: played back from there, it sounds that much earlier)
    expect(late).toBeGreaterThan(plain);
  });

  it("the timing nudge comes on top, as for every take: a take starts at the offset plus the nudge", () => {
    const offset = webOffset({ rate, recAt: 10, songAt: 10.5, baseLatency: 0.02, outputLatency: 0.03 });
    const start = (ms: number) => offset + nudgeFrames(ms, rate);
    expect(start(0)).toBe(24000 + 2400);
    // a nudge of 12 ms moves it 576 frames further: earlier still
    expect(start(12) - start(0)).toBe(576);
    expect(start(-5) - start(0)).toBe(-240);
  });

  it("a browser that does not say how late it is counts as not late (the nudge is then the whole correction)", () => {
    const plain = webOffset({ rate, recAt: 1, songAt: 2 });
    expect(webOffset({ rate, recAt: 1, songAt: 2, baseLatency: undefined, outputLatency: undefined })).toBe(plain);
    expect(webOffset({ rate, recAt: 1, songAt: 2, baseLatency: NaN, outputLatency: -1 })).toBe(plain);
  });

  it("is counted at the recording's own rate", () => {
    expect(webOffset({ rate: 44100, recAt: 0, songAt: 1, baseLatency: 0.01 })).toBe(Math.round(1.01 * 44100));
  });
});

describe("a recording made in a browser: which channels are kept", () => {
  it("one input is that channel of the microphone; one it does not have, its last", () => {
    expect(keptChannels({ ch: 0 }, 2)).toEqual([0]);
    expect(keptChannels({ ch: 1 }, 2)).toEqual([1]);
    expect(keptChannels({ ch: 4 }, 2)).toEqual([1]);
    expect(keptChannels({ ch: 1 }, 1)).toEqual([0]);
  });

  it("a pair is stereo where the microphone gives two channels, and the one it gives where it does not", () => {
    expect(keptChannels({ ch: 0, pair: true }, 2)).toEqual([0, 1]);
    expect(keptChannels({ ch: 0, pair: true }, 1)).toEqual([0]);
    expect(keptChannels({ ch: 2, pair: true }, 2)).toEqual([1]);
  });
});

describe("a recording made in a browser: the blocks the audio thread hands over", () => {
  it("are joined into one list, as long as the recording", () => {
    const out = joinBlocks([Float32Array.from([1, 2]), Float32Array.from([3]), Float32Array.from([4, 5])], 5);
    expect([...out]).toEqual([1, 2, 3, 4, 5]);
    // a channel that came in late or stopped early is silence where it has nothing
    expect([...joinBlocks([Float32Array.from([1, 2])], 4)]).toEqual([1, 2, 0, 0]);
    expect([...joinBlocks([Float32Array.from([1, 2, 3])], 2)]).toEqual([1, 2]);
    expect(joinBlocks([], 0)).toHaveLength(0);
  });

  it("the loudest sample of a block is its level", () => {
    expect(peakOf(Float32Array.from([0.1, -0.5, 0.25]))).toBeCloseTo(0.5);
    expect(peakOf(new Float32Array(8))).toBe(0);
  });
});
