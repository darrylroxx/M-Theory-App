/**
 * The app's own sound through the recording engine while you hear yourself through the effects
 * (through.ts): the blocks it is cut into, how they are sent, when it gives up, and the order in
 * which the computer's sound is let go of and taken back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chunker, GapWatch, Sender } from "./throughcore";

describe("the tap on the audio thread", () => {
  it("hands over blocks of whole frames, left and right interleaved, each in a buffer of its own", () => {
    const got: Float32Array[] = [];
    const ch = new Chunker((b) => got.push(b), 256);
    const l = Float32Array.from({ length: 128 }, (_, i) => i);
    const r = Float32Array.from({ length: 128 }, (_, i) => -i);
    ch.push(l, r, 128);
    expect(got.length).toBe(0);
    ch.push(l, r, 128);
    ch.push(l, r, 128);
    expect(got.length).toBe(1);
    expect(got[0].length).toBe(512);
    expect([...got[0].subarray(0, 6)]).toEqual([0, -0, 1, -1, 2, -2]);
    expect(got[0][2 * 200]).toBe(200 - 128);
    ch.push(l, r, 128);
    expect(got.length).toBe(2);
    // (the one handed over moves to whoever takes it: the next is a fresh buffer, not the same one written over)
    expect(got[1]).not.toBe(got[0]);
  });

  it("one channel is heard on both sides, and a block with nothing connected is silence that still keeps time", () => {
    const got: Float32Array[] = [];
    const ch = new Chunker((b) => got.push(b), 128);
    ch.push(Float32Array.from({ length: 128 }, () => 0.5), undefined, 128);
    expect(got[0].every((v) => v === 0.5)).toBe(true);
    ch.push(undefined, undefined, 128);
    expect(got.length).toBe(2);
    expect(got[1].every((v) => v === 0)).toBe(true);
  });
});

describe("sending the blocks to the engine", () => {
  const block = (v: number) => Float32Array.from({ length: 8 }, () => v);

  it("one after another, in order, never two at once", async () => {
    const order: number[] = [];
    let inFlight = 0;
    let most = 0;
    const s = new Sender(
      async (b) => {
        inFlight++;
        most = Math.max(most, inFlight);
        await Promise.resolve();
        order.push(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)[0]);
        inFlight--;
        return 4800;
      },
      48000,
      () => {},
    );
    for (let k = 1; k <= 5; k++) s.send(block(k));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(most).toBe(1);
    // how far behind the engine keeps the sound (what it has queued), lately
    expect(s.delay).toBeGreaterThan(0);
    expect(s.delay).toBeCloseTo(0.1, 9);
  });

  it("a backlog (the page held up, the engine slow) never grows past `most`: the oldest, being stale, go first", async () => {
    let release!: () => void;
    const sent: number[] = [];
    const s = new Sender(
      (b) =>
        new Promise<number>((r) => {
          sent.push(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)[0]);
          release = () => r(0);
        }),
      48000,
      () => {},
      3,
    );
    for (let k = 1; k <= 8; k++) s.send(block(k));
    expect(sent).toEqual([1]);
    for (let i = 0; i < 3; i++) {
      release();
      for (let j = 0; j < 5; j++) await Promise.resolve();
    }
    expect(sent).toEqual([1, 6, 7, 8]);
    expect(s.dropped).toBe(4);
  });

  it("stops at the first block the engine will not take (it has closed), and says so once", async () => {
    let fails = 0;
    let tries = 0;
    const s = new Sender(
      async () => {
        tries++;
        throw new Error("The interface is not open");
      },
      48000,
      () => fails++,
    );
    s.send(block(1));
    s.send(block(2));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    s.send(block(3));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(tries).toBe(1);
    expect(fails).toBe(1);
  });
});

describe("giving up when this computer cannot keep the engine fed", () => {
  it("six times dry within a minute: back to the computer's sound; now and then: carry on", () => {
    const w = new GapWatch();
    // the first count is where it starts from
    expect(w.note(0, 0)).toBe(false);
    // a dry spell every 20 s (a heavy page now and then): never
    for (let k = 1; k <= 10; k++) expect(w.note(k, k * 20)).toBe(false);
    // six in ten seconds: yes
    const w2 = new GapWatch();
    w2.note(0, 0);
    for (let k = 1; k <= 5; k++) expect(w2.note(k, k * 2)).toBe(false);
    expect(w2.note(6, 12)).toBe(true);
    // (several at once count as several; a count that goes back is a new engine: from there)
    const w3 = new GapWatch();
    w3.note(10, 0);
    expect(w3.note(3, 1)).toBe(false);
    expect(w3.note(9, 2)).toBe(true);
    expect(new GapWatch().note(undefined, 0)).toBe(false);
  });
});

describe("the app's sound going through the engine, and coming back", () => {
  type Call = string;
  let calls: Call[];
  let nodes: { opts: { numberOfOutputs: number; channelCount: number }; port: { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown) => void; sent: unknown[] } }[];
  let ctx: Record<string, unknown>;

  beforeEach(async () => {
    vi.resetModules();
    calls = [];
    nodes = [];
    const { FakeAudio } = await import("./fakectx");
    const c = new FakeAudio(48000);
    Object.assign(c, {
      sampleRate: 44100,
      // (the master's safety stage loads its own module as the sound opens: only the tap's is noted)
      audioWorklet: { addModule: async (u: string) => void (/through/.test(u) && calls.push("module")) },
      setSinkId: async (id: unknown) => void calls.push(`sink ${JSON.stringify(id)}`),
      state: "running",
      resume: async () => {},
    });
    ctx = c as unknown as Record<string, unknown>;
    vi.stubGlobal(
      "AudioWorkletNode",
      class {
        port = { onmessage: null, sent: [] as unknown[], postMessage(m: unknown) { this.sent.push(m); } };
        constructor(
          _c: unknown,
          readonly name: string,
          readonly opts: unknown,
        ) {
          nodes.push(this as never);
          calls.push(`node ${name}`);
        }
      },
    );
    vi.stubGlobal("window", { AudioContext: function () { return c; } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const engine = (fail = false) => ({
    start: async (rate: number) => {
      calls.push(`start ${rate}`);
      if (fail) throw new Error("no");
    },
    feed: async (b: Uint8Array) => {
      calls.push(`feed ${b.byteLength}`);
      return 4410;
    },
    stop: async () => void calls.push("stop"),
  });

  it("the engine takes it first, then the computer's sound is let go of; coming back, the other way round", async () => {
    const T = await import("./through");
    const { masterOut } = await import("./mix");
    const { extraDelay } = await import("./outdelay");
    expect(await T.goThrough(engine())).toBe(true);
    expect(T.goingThrough()).toBe(true);
    expect(calls).toEqual(["module", "start 44100", "node m-theory-through", 'sink {"type":"none"}']);
    // the tap hears the very end of the mix (after the safety stage), and plays nothing itself
    const out = masterOut(ctx as never) as unknown as { outputs: unknown[] };
    expect(out.outputs).toContain(nodes[0]);
    expect(nodes[0].opts.numberOfOutputs).toBe(0);
    expect(nodes[0].opts.channelCount).toBe(2);
    // a block from the audio thread goes to the engine, as raw bytes
    nodes[0].port.onmessage!({ data: new Float32Array(2048) } as MessageEvent);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(calls).toContain("feed 8192");
    // the canvas allows for the engine's queue
    expect(extraDelay()).toBeGreaterThan(0);
    calls = [];
    await T.comeBack();
    expect(calls).toEqual(['sink ""', "stop"]);
    expect(nodes[0].port.sent).toContain("stop");
    expect(out.outputs).not.toContain(nodes[0]);
    expect(extraDelay()).toBe(0);
    expect(T.goingThrough()).toBe(false);
    // and again, as often as it is asked (the module is loaded once)
    calls = [];
    expect(await T.goThrough(engine())).toBe(true);
    expect(calls).toEqual(["start 44100", "node m-theory-through", 'sink {"type":"none"}']);
    await T.comeBack();
  });

  it("if the computer's sound will not take it back at once, it is asked again until it does: the app is never left without a sound", async () => {
    vi.useFakeTimers();
    try {
      const T = await import("./through");
      let refuse = 2;
      ctx.sinkId = "speakers";
      ctx.setSinkId = async (id: unknown) => {
        calls.push(`sink ${JSON.stringify(id)}`);
        if (id !== "" && id !== "speakers") return void (ctx.sinkId = { type: "none" });
        if (refuse-- > 0) throw new Error("NotFoundError");
        ctx.sinkId = id;
      };
      expect(await T.goThrough(engine())).toBe(true);
      calls = [];
      await T.comeBack();
      // the device it was on, then the computer's default: both refused just now
      expect(calls.slice(0, 2)).toEqual(['sink "speakers"', 'sink ""']);
      expect(ctx.sinkId).toEqual({ type: "none" });
      calls = [];
      await vi.advanceTimersByTimeAsync(2100);
      expect(calls).toEqual(['sink "speakers"']);
      expect(ctx.sinkId).toBe("speakers");
    } finally {
      vi.useRealTimers();
    }
  });

  it("asked twice at once, it goes through once", async () => {
    const T = await import("./through");
    const [a, b] = await Promise.all([T.goThrough(engine()), T.goThrough(engine())]);
    expect(a && b).toBe(true);
    expect(calls.filter((c) => c.startsWith("start")).length).toBe(1);
    await T.comeBack();
  });

  it("where it cannot (no way to send the browser's sound nowhere, or the engine will not take it), the computer's sound is left alone", async () => {
    const T = await import("./through");
    expect(await T.goThrough(engine(true))).toBe(false);
    expect(calls.some((c) => c.startsWith("sink"))).toBe(false);
    expect(calls).toContain("stop");
    delete ctx.setSinkId;
    calls = [];
    expect(await T.goThrough(engine())).toBe(false);
    expect(calls).toEqual([]);
  });

  it("if this computer cannot keep the engine fed, it comes back for the rest of the session", async () => {
    const T = await import("./through");
    expect(await T.goThrough(engine())).toBe(true);
    T.noteGaps(0, 0);
    for (let k = 1; k <= 6; k++) T.noteGaps(k, k);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(T.goingThrough()).toBe(false);
    expect(calls).toContain('sink ""');
    expect(await T.goThrough(engine())).toBe(false);
  });
});

describe("the canvas allows for the engine's queue", () => {
  afterEach(async () => (await import("./outdelay")).setExtraDelay(0));
  it("what is heard is that much further back on the audio clock", async () => {
    const { heardTime } = await import("../canvas/clock");
    const { setExtraDelay } = await import("./outdelay");
    const c = { currentTime: 10, baseLatency: 0.02, outputLatency: 0.03 };
    expect(heardTime(c)).toBeCloseTo(9.95, 9);
    setExtraDelay(0.13);
    expect(heardTime(c)).toBeCloseTo(9.82, 9);
    setExtraDelay(NaN);
    expect(heardTime(c)).toBeCloseTo(9.95, 9);
  });
});
