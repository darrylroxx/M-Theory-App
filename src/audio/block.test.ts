// The live context works in blocks as long as the sound card's buffer (context.ts openLive). What must hold for that:
// the block asked for is the buffer's own size and never too long, an echo's loop keeps its timing whatever the block,
// and nothing on the audio thread assumes a block is 128 frames.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BLOCK, blockFor, blockFrames, loopLag, openLive, withContext } from "./context";
import { ECHO_TIMES, DEFAULT_BEAT, type Beat } from "./beats";
import { playStep, syncDrums } from "./drumbus";
import { FakeAudio, FakeOffline, asAudio, type FakeAny } from "./fakectx";
import { SOUND_DEFAULT, createRack } from "./rack";
import { Chunker } from "./throughcore";
import { EarBank } from "../listen/bank";

/** A pretend context that works in blocks of `q` frames. */
function inBlocksOf(q: number, c: FakeAudio = new FakeAudio()): FakeAudio {
  (c as unknown as { renderQuantumSize: number }).renderQuantumSize = q;
  return c;
}
/** The delay times a node was set to, in order. */
const setTo = (n: FakeAny): number[] => (n.delayTime ? [n.delayTime.value, ...n.delayTime.events.map((e) => e.v)] : []);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the block the live context asks for", () => {
  it("is the sound card's buffer itself: one block for each hand-over", () => {
    expect(blockFor(1024, 44100)).toBe(1024);
    expect(blockFor(960, 48000)).toBe(960);
    expect(blockFor(1024.0000001, 48000)).toBe(1024);
    expect(blockFor(441, 44100)).toBe(441);
  });
  it("is halved while it would be longer than an echo can be short", () => {
    expect(blockFor(2048, 44100)).toBe(1024);
    expect(blockFor(4096, 48000)).toBe(1024);
    expect(blockFor(1920, 48000)).toBe(960);
    for (const [frames, rate] of [[2048, 44100], [4096, 48000], [8192, 96000], [1764, 44100]]) expect(blockFor(frames, rate) / rate).toBeLessThanOrEqual(MAX_BLOCK);
  });
  it("is not asked for at all where it is no gain, cannot be kept short, or the buffer is not a whole number of frames", () => {
    expect(blockFor(128, 48000)).toBe(0);
    expect(blockFor(64, 48000)).toBe(0);
    // (an odd buffer too long for one block cannot be split evenly)
    expect(blockFor(1765, 44100)).toBe(0);
    expect(blockFor(1024.4, 48000)).toBe(0);
    expect(blockFor(NaN, 48000)).toBe(0);
    expect(blockFor(1024, 0)).toBe(0);
  });
  it("a context says its own block; one that does not works in 128, as an offline render always does", () => {
    expect(blockFrames(asAudio(new FakeAudio()))).toBe(128);
    expect(blockFrames(asAudio(new FakeOffline()))).toBe(128);
    expect(blockFrames(asAudio(inBlocksOf(1024)))).toBe(1024);
    expect(loopLag(asAudio(new FakeAudio()))).toBe(0);
    expect(loopLag(asAudio(inBlocksOf(1024, new FakeAudio(44100))))).toBeCloseTo(896 / 44100, 12);
  });
});

describe("opening the live context", () => {
  /** A pretend browser: what each context it opens comes out as, and what became of it. */
  function browser(o: { blocks?: boolean; handed?: number; rate?: number; grows?: boolean; refuses?: boolean }) {
    const made: { opts: Record<string, unknown>; closed: boolean; renderQuantumSize?: number; baseLatency: number; sampleRate: number }[] = [];
    const rate = o.rate ?? 44100;
    const handed = o.handed ?? 1024;
    class AC {
      baseLatency: number;
      sampleRate = rate;
      closed = false;
      renderQuantumSize?: number;
      constructor(readonly opts: Record<string, unknown> = {}) {
        const hint = opts.renderSizeHint as number | undefined;
        if (hint && o.refuses) throw new Error("no");
        // (a browser that grows the buffer to fit the block: later, not wanted)
        this.baseLatency = (hint && o.grows ? handed * 2 : handed) / rate;
        if (o.blocks !== false) this.renderQuantumSize = hint ?? 128;
        made.push(this);
      }
      close() {
        this.closed = true;
        return Promise.resolve();
      }
    }
    return { AC: AC as unknown as typeof AudioContext, made };
  }
  it("opens it as before, reads how much the sound card is handed at a time, and opens it again in blocks of that; the first one is closed", () => {
    const b = browser({});
    const c = openLive(b.AC);
    expect(b.made.map((m) => m.opts)).toEqual([{ latencyHint: "playback" }, { latencyHint: "playback", renderSizeHint: 1024 }]);
    expect(c).toBe(b.made[1]);
    expect(blockFrames(c)).toBe(1024);
    expect(b.made.map((m) => m.closed)).toEqual([true, false]);
  });
  it("a browser that cannot choose its block: opened once, as it always was", () => {
    const b = browser({ blocks: false });
    const c = openLive(b.AC);
    expect(b.made.length).toBe(1);
    expect(c).toBe(b.made[0]);
    expect(b.made[0].closed).toBe(false);
    expect(blockFrames(c)).toBe(128);
  });
  it("a buffer that is no longer than a block already: nothing is asked for", () => {
    const b = browser({ handed: 128 });
    expect(openLive(b.AC)).toBe(b.made[0]);
    expect(b.made.length).toBe(1);
  });
  it("a context that comes out with a longer buffer (the sound would be later), or a browser that refuses: the first one is used, the other closed", () => {
    const grows = browser({ grows: true });
    expect(openLive(grows.AC)).toBe(grows.made[0]);
    expect(grows.made.map((m) => m.closed)).toEqual([false, true]);
    const refuses = browser({ refuses: true });
    expect(openLive(refuses.AC)).toBe(refuses.made[0]);
    expect(refuses.made.length).toBe(1);
    expect(refuses.made[0].closed).toBe(false);
  });
  it("a long buffer is worked out in two or more blocks, none longer than the shortest echo allows", () => {
    const b = browser({ handed: 4096, rate: 48000 });
    expect(blockFrames(openLive(b.AC))).toBe(1024);
  });
});

describe("an echo's loop comes round where it always did, whatever the block", () => {
  const echoOf = (c: FakeAudio) => {
    createRack(asAudio(c)).set({ ...SOUND_DEFAULT, echo: 0.5, echoTime: "1/8" }, 120);
    // (the two delays of a rack's echo are the only ones that can hold two seconds)
    return c.nodes.filter((n) => setTo(n as FakeAny).some((v) => Math.abs(v - 0.25) < 0.03)) as FakeAny[];
  };
  it("in blocks of 128 both delays of a track's echo are the note value itself, as they always were", () => {
    const delays = echoOf(new FakeAudio());
    expect(delays.length).toBe(2);
    for (const d of delays) expect(setTo(d).at(-1)).toBe(0.25);
  });
  it("in longer blocks the delay that takes over from the other is shorter by what the longer block adds to the loop", () => {
    const c = inBlocksOf(1024);
    const delays = echoOf(c);
    const lag = (1024 - 128) / 48000;
    expect(delays.map((d) => setTo(d).at(-1)!).sort()).toEqual([0.25 - lag, 0.25]);
    // the one made shorter is the second of the two: the first feeds it (left, then right)
    const [short, whole] = setTo(delays[0]).at(-1)! < 0.25 ? delays : [delays[1], delays[0]];
    expect(whole.outputs).toContain(short);
  });
  it("a drum desk's echo, in blocks of 128: one delay of the note value, fed straight", () => {
    const c = new FakeAudio();
    const beat: Beat = { ...DEFAULT_BEAT, on: true, echo: 0.5, echoTime: "1/8" };
    withContext(asAudio(c), () => syncDrums(beat, 120, "e1"));
    const T = (ECHO_TIMES.find((e) => e.id === "1/8")!.beats * 60) / 120;
    const delays = c.nodes.filter((n) => setTo(n as FakeAny).includes(T)) as FakeAny[];
    expect(delays.length).toBe(1);
    // (nothing with a wait of its own leads into it)
    expect(c.nodes.filter((n) => (n as FakeAny).outputs.includes(delays[0]) && ((n as FakeAny).delayTime?.value ?? 0) > 0)).toEqual([]);
  });
  it("in longer blocks the desk's delay is shorter by the same, and what goes into it for the first time waits that long first", () => {
    const c = inBlocksOf(1024);
    const beat: Beat = { ...DEFAULT_BEAT, on: true, echo: 0.5, echoTime: "1/8" };
    withContext(asAudio(c), () => {
      syncDrums(beat, 120, "e2");
      playStep(beat, "snare", 3, 0.1, "e2");
    });
    const lag = (1024 - 128) / 48000;
    const T = (ECHO_TIMES.find((e) => e.id === "1/8")!.beats * 60) / 120;
    const loop = c.nodes.filter((n) => Math.abs(setTo(n as FakeAny).at(-1)! - (T - lag)) < 1e-9) as FakeAny[];
    expect(loop.length).toBe(1);
    const pre = c.nodes.filter((n) => (n as FakeAny).outputs.includes(loop[0]) && Math.abs(((n as FakeAny).delayTime?.value ?? 0) - lag) < 1e-12) as FakeAny[];
    expect(pre.length).toBe(1);
    // a hit reaches the loop's delay only through the wait (the first repeat is a whole note value after the hit), and
    // what comes round again does not pass the wait (each next repeat is the loop's own length later)
    const hit = c.started[0];
    expect(c.reaches(hit, pre[0])).toBe(true);
    expect(c.reaches(loop[0], pre[0])).toBe(false);
  });
});

describe("nothing on the audio thread takes a block to be 128 frames", () => {
  it("the tap for the recording engine: a block of any length is kept whole, and a silent one keeps its own time", () => {
    const got: Float32Array[] = [];
    const ch = new Chunker((b) => got.push(b), 1024);
    const l = Float32Array.from({ length: 1024 }, (_, i) => i / 1024);
    ch.push(l, undefined, 1024);
    expect(got.length).toBe(1);
    expect(got[0][2 * 513]).toBeCloseTo(513 / 1024, 6);
    // (nothing connected for a block of 960: 960 frames of silence, not 128)
    ch.push(undefined, undefined, 960);
    ch.push(l, undefined, 64);
    expect(got.length).toBe(2);
    expect(Array.from(got[1].subarray(0, 2 * 960)).every((v) => v === 0)).toBe(true);
    expect(got[1][2 * 961]).toBeCloseTo(1 / 1024, 6);
  });
  it("the canvas's ears: an input with nothing connected is as long as the context's block", () => {
    const SR = 48000;
    const a = new EarBank(SR, [{ key: "mix", light: false }, { key: "t", light: true }], 1024);
    const b = new EarBank(SR, [{ key: "mix", light: false }, { key: "t", light: true }], 1024);
    const tone = Float32Array.from({ length: 1024 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR));
    const zeros = new Float32Array(1024);
    let outA = 0;
    let outB = 0;
    for (let k = 0; k < 40; k++) {
      // one bank hears the track as "nothing connected", the other as a block of silence: the same thing
      outA += a.process([[tone], []], 0).reduce((n, o) => n + o.frames.length, 0);
      outB += b.process([[tone], [zeros]], 0).reduce((n, o) => n + o.frames.length, 0);
    }
    expect(outA).toBeGreaterThan(0);
    expect(outA).toBe(outB);
  });
});
