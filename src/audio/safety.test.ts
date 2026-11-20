import { afterEach, describe, expect, it, vi } from "vitest";
import { SAFETY_CEILING, SafetyLimiter } from "./safety";

const SR = 48000;
/** a sine of `amp`, `secs` long */
const sine = (amp: number, secs: number, hz = 220, sr = SR) => Float32Array.from({ length: Math.round(secs * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr));
const peakOf = (...xs: Float32Array[]) => Math.max(...xs.map((x) => x.reduce((a, v) => Math.max(a, Math.abs(v)), 0)));

describe("the master's safety limiter", () => {
  it("passes anything under −1 dBFS through bit for bit", () => {
    const l = sine(0.88, 0.5);
    const r = sine(0.5, 0.5, 330);
    const l0 = l.slice();
    const r0 = r.slice();
    const lim = new SafetyLimiter(SR);
    for (let i = 0; i < l.length; i += 128) lim.process(l.subarray(i, i + 128), r.subarray(i, i + 128), Math.min(128, l.length - i));
    expect(l).toEqual(l0);
    expect(r).toEqual(r0);
    expect(lim.gain).toBe(1);
    expect(lim.events).toBe(0);
  });

  it("holds every over down to the ceiling at once, with no delay", () => {
    // a mix gone 3 dB over full scale, in blocks as the audio thread hands them over
    const l = sine(1.41, 1);
    const r = sine(1.2, 1, 110);
    const lim = new SafetyLimiter(SR);
    for (let i = 0; i < l.length; i += 128) lim.process(l.subarray(i, i + 128), r.subarray(i, i + 128), Math.min(128, l.length - i));
    expect(peakOf(l, r)).toBeLessThanOrEqual(SAFETY_CEILING + 1e-6);
    expect(lim.events).toBeGreaterThan(0);
    // nothing is moved in time: the first samples (under the ceiling) are untouched, and the wave keeps its zero crossings
    const ref = sine(1.41, 1);
    for (let i = 0; i < 20; i++) expect(l[i]).toBe(ref[i]);
    for (let i = 1; i < l.length; i++) if (Math.sign(ref[i]) !== Math.sign(ref[i - 1])) expect(Math.sign(l[i]) === Math.sign(ref[i]) || l[i] === 0).toBe(true);
  });

  it("limits the left and right together, so the picture does not lean", () => {
    const l = Float32Array.from([0.2, 1.5, 0.2]);
    const r = Float32Array.from([0.1, 0.3, 0.1]);
    new SafetyLimiter(SR).process(l, r);
    expect(l[1]).toBeCloseTo(SAFETY_CEILING, 5);
    // the right went down by the same gain, though it was nowhere near the ceiling
    expect(r[1] / 0.3).toBeCloseTo(l[1] / 1.5, 5);
  });

  it("holds for 10 ms, then comes back over about 150 ms, to exactly 1", () => {
    const lim = new SafetyLimiter(SR);
    const click = new Float32Array(SR * 3);
    click[0] = 2;
    lim.process(click, click);
    // three seconds of silence after it: back to rest
    expect(lim.gain).toBe(1);
    const lim2 = new SafetyLimiter(SR);
    const a = new Float32Array(Math.round(0.009 * SR));
    a[0] = 2;
    lim2.process(a, a);
    expect(lim2.gain).toBeCloseTo(SAFETY_CEILING / 2, 6); // still holding
    const b = new Float32Array(Math.round(0.15 * SR) + Math.round(0.001 * SR));
    lim2.process(b, b);
    // one time constant up: 1 − (1 − g)/e
    expect(1 - lim2.gain).toBeCloseTo((1 - SAFETY_CEILING / 2) / Math.E, 2);
  });

  it("a quiet signal right after an over comes back to unity and passes bit for bit again", () => {
    const lim = new SafetyLimiter(SR);
    const over = sine(1.3, 0.05);
    lim.process(over, over);
    lim.process(new Float32Array(SR * 3), new Float32Array(SR * 3));
    const q = sine(0.3, 0.1);
    const q0 = q.slice();
    lim.process(q, q);
    expect(q).toEqual(q0);
  });
});

describe("the master goes out through the limiter", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("the live context is opened with the larger buffer, and starts loading the limiter", async () => {
    const made: unknown[] = [];
    const modules: string[] = [];
    class AC {
      state = "running";
      audioWorklet = { addModule: (u: string) => (modules.push(u), Promise.resolve()) };
      constructor(o?: unknown) {
        made.push(o);
      }
      resume() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal("window", { AudioContext: AC });
    vi.stubGlobal("AudioWorkletNode", class {});
    const { audioContext } = await import("./context");
    audioContext();
    audioContext();
    expect(made).toEqual([{ latencyHint: "playback" }]);
    expect(modules.length).toBe(1);
    expect(modules[0]).toMatch(/safety/);
  });

  it("live: straight out until the limiter is loaded, then crossed over to it in 20 ms, nothing delayed", async () => {
    const { FakeAudio } = await import("./fakectx");
    const c = new FakeAudio(48000);
    let loaded!: () => void;
    (c as unknown as { audioWorklet: unknown }).audioWorklet = { addModule: () => new Promise<void>((r) => (loaded = r)) };
    const nodes: { opts: unknown; outputs: unknown[]; connect: (n: unknown) => unknown; disconnect: () => void }[] = [];
    vi.stubGlobal(
      "AudioWorkletNode",
      class {
        outputs: unknown[] = [];
        constructor(
          _c: unknown,
          readonly name: string,
          readonly opts: unknown,
        ) {
          nodes.push(this as never);
        }
        connect(n: unknown) {
          this.outputs.push(n);
          return n;
        }
        disconnect() {
          this.outputs = [];
        }
      },
    );
    vi.stubGlobal("setTimeout", (f: () => void) => (f(), 0));
    const { master } = await import("./mix");
    const m = master(c as never) as unknown as InstanceType<typeof FakeAudio>["nodes"][number];
    expect(master(c as never)).toBe(m);
    // before it is loaded: the master reaches the speakers straight away
    expect(c.reaches(m, c.destination)).toBe(true);
    expect(nodes.length).toBe(0);
    loaded();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(nodes.length).toBe(1);
    // now only through the limiter (the straight way was let go once the crossover was done)
    expect(m.outputs).toEqual([nodes[0]]);
    expect(c.reaches(m, c.destination)).toBe(true);
    const wet = nodes[0].outputs[0] as { gain: { at(t: number): number } };
    expect(wet.gain.at(0.05)).toBe(0);
    expect(wet.gain.at(0.06)).toBeCloseTo(0.5, 6);
    expect(wet.gain.at(0.07)).toBe(1);
  });

  it("offline: a render's master goes through the limiter from its first sample", async () => {
    const { FakeOffline } = await import("./fakectx");
    const c = new FakeOffline(48000, 48000);
    (c as unknown as { audioWorklet: unknown }).audioWorklet = { addModule: () => Promise.resolve() };
    const nodes: { outputs: unknown[] }[] = [];
    vi.stubGlobal(
      "AudioWorkletNode",
      class {
        outputs: unknown[] = [];
        constructor() {
          nodes.push(this);
        }
        connect(n: unknown) {
          this.outputs.push(n);
          return n;
        }
      },
    );
    const { loadSafety } = await import("./safety");
    const { master } = await import("./mix");
    expect(await loadSafety(c as never)).toBe(true);
    const m = master(c as never) as unknown as { outputs: unknown[] };
    expect(m.outputs).toEqual([nodes[0]]);
    expect(nodes[0].outputs).toEqual([c.destination]);
  });
});
