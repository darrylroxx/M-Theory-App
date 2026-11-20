/**
 * The app's own sound through the recording engine while you hear yourself through the effects
 * (through.ts): the blocks it is cut into, how they are sent, when it gives up, and the order in
 * which the computer's sound is let go of and taken back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chunker, GapWatch, Outbox, Sender } from "./throughcore";
import type { FakeParam } from "../keys/fakeaudio";

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

describe("handing the blocks to the page (on the audio thread)", () => {
  const N = 1024;
  const tone = (k: number) => {
    const b = new Float32Array(2 * N);
    for (let i = 0; i < N; i++) {
      const v = 0.8 * Math.sin((2 * Math.PI * 440 * (k * N + i)) / 48000);
      b[2 * i] = v;
      b[2 * i + 1] = v;
    }
    return b;
  };
  const left = (bs: Float32Array[]) => bs.flatMap((b) => Array.from(b.filter((_, i) => i % 2 === 0)));
  const worstStep = (x: number[]) => x.reduce((m, v, i) => (i ? Math.max(m, Math.abs(v - x[i - 1])) : m), 0);

  it("a page keeping up gets every block as it fills; a page held up gets all it missed in one message when it catches up", () => {
    const got: Float32Array[] = [];
    const box = new Outbox((b) => got.push(b), 48000);
    // the page says it has each one: one message a block
    for (let k = 0; k < 5; k++) {
      box.add(tone(k));
      box.ack();
    }
    expect(got.length).toBe(5);
    // the page held up for half a second (24 blocks) without saying it has anything: two go, the rest wait
    for (let k = 5; k < 29; k++) box.add(tone(k));
    expect(got.length).toBe(7);
    // it catches up: the first ack brings everything since, in one message, in order, with nothing left out
    box.ack();
    expect(got.length).toBe(8);
    expect(got[7].length).toBe(2 * N * 22);
    const all = left(got);
    expect(all.length).toBe(29 * N);
    expect(worstStep(all)).toBeLessThan(0.05);
    expect(all[28 * N + 7]).toBeCloseTo(left([tone(28)])[7], 9);
    expect(box.dropped).toBe(0);
  });

  it("held up for longer than it keeps, the oldest it has go (faded, never a jump) and it stays the same size", () => {
    const got: Float32Array[] = [];
    const box = new Outbox((b) => got.push(b), 48000, 2, 1);
    box.add(tone(0));
    box.add(tone(1));
    // five seconds without a word from the page
    for (let k = 2; k < 236; k++) box.add(tone(k));
    box.ack();
    const last = got[got.length - 1];
    // no more than a second (and a block) kept
    expect(last.length / 2).toBeLessThanOrEqual(48000 + N);
    expect(box.dropped).toBeGreaterThan(3.5 * 48000);
    // what came, joined up: never a step bigger than the tone's own, and it ends on the newest
    const all = left(got);
    expect(worstStep(all)).toBeLessThan(0.05);
    expect(all[all.length - 1]).toBeCloseTo(left([tone(235)])[N - 1], 9);
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

  it("a backlog (the page held up, the engine slow) never grows past `most`; where blocks are left out the sound dips for a moment, it never jumps", async () => {
    // the page's sound: a loud 440 Hz tone, cut into blocks of 1024 frames as the audio thread hands them over
    const N = 1024;
    const tone = (k: number) => {
      const b = new Float32Array(2 * N);
      for (let i = 0; i < N; i++) {
        const v = 0.8 * Math.sin((2 * Math.PI * 440 * (k * N + i)) / 48000);
        b[2 * i] = v;
        b[2 * i + 1] = -v;
      }
      return b;
    };
    let release!: () => void;
    const sent: Float32Array[] = [];
    const s = new Sender(
      (b) =>
        new Promise<number>((r) => {
          sent.push(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice());
          release = () => r(0);
        }),
      48000,
      () => {},
      (3 * N) / 48000,
    );
    const blocks = Array.from({ length: 8 }, (_, k) => tone(k));
    const middle = (b: Float32Array) => b[2 * (N / 2)];
    for (const b of blocks) s.send(b);
    expect(sent.length).toBe(1);
    for (let i = 0; i < 3; i++) {
      release();
      for (let j = 0; j < 5; j++) await Promise.resolve();
    }
    // the one being sent, the first still waiting (it follows on from it), then the newest
    expect(sent.map(middle)).toEqual([0, 1, 6, 7].map((k) => middle(tone(k))));
    expect(s.dropped).toBe(4 * N);
    // joined up as the engine queues them: never a step bigger than the tone's own (0.8 × 2π × 440 / 48000 ≈ 0.046)
    const joined = sent.flatMap((b) => Array.from(b.filter((_, i) => i % 2 === 0)));
    let worst = 0;
    for (let i = 1; i < joined.length; i++) worst = Math.max(worst, Math.abs(joined[i] - joined[i - 1]));
    expect(worst).toBeLessThan(0.05);
    // and where nothing was left out, the sound is exactly as it came
    expect([...sent[0]]).toEqual([...tone(0)]);
    // (left and right faded together)
    expect(sent[1][2 * (N - 1)]).toBeCloseTo(-sent[1][2 * (N - 1) + 1], 12);

    // a backlog let through as the engine takes each block, more arriving in between (the page catching up): still no jump
    sent.length = 0;
    const s2 = new Sender(
      (b) =>
        new Promise<number>((r) => {
          sent.push(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice());
          release = () => r(0);
        }),
      48000,
      () => {},
      (3 * N) / 48000,
    );
    for (let k = 0; k < 60; k++) {
      s2.send(tone(k));
      if (k % 7 === 6) {
        release();
        for (let j = 0; j < 5; j++) await Promise.resolve();
      }
    }
    for (let i = 0; i < 6; i++) {
      release();
      for (let j = 0; j < 5; j++) await Promise.resolve();
    }
    expect(s2.dropped).toBeGreaterThan(20 * N);
    const joined2 = sent.flatMap((b) => Array.from(b.filter((_, i) => i % 2 === 0)));
    let worst2 = 0;
    for (let i = 1; i < joined2.length; i++) worst2 = Math.max(worst2, Math.abs(joined2[i] - joined2[i - 1]));
    expect(worst2).toBeLessThan(0.05);
    // the newest is always the last sent
    expect(middle(sent[sent.length - 1])).toBe(middle(tone(59)));
  });

  it("one block on its own goes whole, however long (what went before it is gone: the engine skips ahead over it, with fades of its own)", async () => {
    const sent: Float32Array[] = [];
    const s = new Sender(
      async (b) => {
        sent.push(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice());
        return 0;
      },
      48000,
      () => {},
      0.5,
    );
    const big = Float32Array.from({ length: 2 * 48000 }, (_, i) => Math.sin(i / 50));
    s.send(big);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(sent.length).toBe(1);
    expect([...sent[0]]).toEqual([...big]);
    expect(s.dropped).toBe(0);
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
    // (its clock keeps time, as a real one does: a fade is waited for on it)
    const born = Date.now();
    Object.defineProperty(c, "currentTime", { get: () => (Date.now() - born) / 1000, configurable: true });
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
      // (the fades around the hand-over take a moment on the clock)
      const going = T.goThrough(engine());
      await vi.advanceTimersByTimeAsync(100);
      expect(await going).toBe(true);
      calls = [];
      const back = T.comeBack();
      await vi.advanceTimersByTimeAsync(100);
      await back;
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

  it("the hand-over is never heard twice and never clicks: the mix fades out, the computer's sound is let go of, and only then does anything go to the engine", async () => {
    const T = await import("./through");
    const { masterOut } = await import("./mix");
    const gain = (masterOut(ctx as never) as unknown as { gain: FakeParam }).gain;
    let release!: () => void;
    let gainAtSwitch = -1;
    ctx.setSinkId = (id: unknown) => {
      calls.push(`sink ${JSON.stringify(id)}`);
      // the computer's sound is let go of only once the mix has faded all the way out
      gainAtSwitch = gain.at(ctx.currentTime as number);
      return new Promise<void>((r) => (release = r));
    };
    const going = T.goThrough(engine());
    while (!calls.includes('sink {"type":"none"}')) await new Promise((r) => setTimeout(r, 1));
    expect(gainAtSwitch).toBe(0);
    // a block from the audio thread while the computer's sound still plays it: not sent (it would be heard twice)
    nodes[0].port.onmessage!({ data: new Float32Array(2048) } as MessageEvent);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(calls.some((c) => c.startsWith("feed"))).toBe(false);
    release();
    expect(await going).toBe(true);
    // let go of: the mix comes back up, for the engine alone, and what the audio thread hands over from now on goes to it
    expect(gain.at(10)).toBe(1);
    nodes[0].port.onmessage!({ data: new Float32Array(2048) } as MessageEvent);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(calls.filter((c) => c.startsWith("feed")).length).toBe(1);

    // coming back: faded out before the computer's sound is taken back, the engine let go of after, faded back in;
    // and done only once the engine has had a moment to fade out what it holds (it may be closed then)
    calls = [];
    let gainAtBack = -1;
    ctx.setSinkId = async (id: unknown) => {
      calls.push(`sink ${JSON.stringify(id)}`);
      gainAtBack = gain.at(ctx.currentTime as number);
    };
    const t0 = Date.now();
    await T.comeBack();
    expect(gainAtBack).toBe(0);
    expect(calls).toEqual(['sink ""', "stop"]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(T.LET_GO_MS - 2);
    expect(gain.at(20)).toBe(1);
  });

  it("a busy audio thread whose clock falls behind: the computer's sound is let go of only once the fade is over on that clock", async () => {
    const T = await import("./through");
    const { masterOut } = await import("./mix");
    const gain = (masterOut(ctx as never) as unknown as { gain: FakeParam }).gain;
    // the audio clock at a third of the speed of the page's
    const born = Date.now();
    Object.defineProperty(ctx, "currentTime", { get: () => (Date.now() - born) / 3000, configurable: true });
    let gainAtSwitch = -1;
    ctx.setSinkId = async (id: unknown) => {
      calls.push(`sink ${JSON.stringify(id)}`);
      gainAtSwitch = gain.at(ctx.currentTime as number);
    };
    expect(await T.goThrough(engine())).toBe(true);
    expect(gainAtSwitch).toBe(0);
    await T.comeBack();
  });

  it("if the computer's sound cannot be let go of, it is left as it was, faded back in, and the engine is let go of (no waiting on itself)", async () => {
    const T = await import("./through");
    const { masterOut } = await import("./mix");
    const gain = (masterOut(ctx as never) as unknown as { gain: FakeParam }).gain;
    ctx.setSinkId = async (id: unknown) => {
      calls.push(`sink ${JSON.stringify(id)}`);
      if (typeof id !== "string") throw new Error("NotAllowedError");
    };
    expect(await T.goThrough(engine())).toBe(false);
    expect(T.goingThrough()).toBe(false);
    expect(calls).toContain("stop");
    expect(calls).toContain('sink ""');
    expect(gain.at(10)).toBe(1);
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
    // (after the mix has faded out)
    await new Promise((r) => setTimeout(r, 60));
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
