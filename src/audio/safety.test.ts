import { afterEach, describe, expect, it, vi } from "vitest";
import { SAFETY_CEILING, SAFETY_KNEE, SAFETY_LIMIT, SafetyLimiter, roundOff } from "./safety";

const SR = 48000;
/** a sine of `amp`, `secs` long */
const sine = (amp: number, secs: number, hz = 220, sr = SR) => Float32Array.from({ length: Math.round(secs * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr));
const peakOf = (...xs: Float32Array[]) => Math.max(...xs.map((x) => x.reduce((a, v) => Math.max(a, Math.abs(v)), 0)));

/** run a stereo pair through a stage, in blocks of 128 as the audio thread hands them over */
const through = (lim: SafetyLimiter, l: Float32Array, r: Float32Array) => {
  for (let i = 0; i < l.length; i += 128) lim.process(l.subarray(i, i + 128), r.subarray(i, i + 128), Math.min(128, l.length - i));
};
/** a drum-like hit: a 60 Hz thump whose first cycle peaks at `amp`, dying away in about 40 ms */
const hit = (amp: number, secs = 0.25) => Float32Array.from({ length: Math.round(secs * SR) }, (_, i) => amp * Math.exp(-i / (0.04 * SR)) * Math.sin((2 * Math.PI * 60 * i) / SR + Math.PI / 2));

describe("the master's safety stage", () => {
  it("passes anything under −1 dBFS through bit for bit", () => {
    const l = sine(0.88, 0.5);
    const r = sine(0.5, 0.5, 330);
    const l0 = l.slice();
    const r0 = r.slice();
    const lim = new SafetyLimiter(SR);
    through(lim, l, r);
    expect(l).toEqual(l0);
    expect(r).toEqual(r0);
    expect(lim.gain).toBe(1);
    expect(lim.events).toBe(0);
    expect(lim.rounded).toBe(0);
  });

  it("rounds off a drum hit's tip a dB or two over, and leaves the level of everything around it alone", () => {
    // a full mix: a steady part under the knee and hits that peak at +1 dBFS (the sum of two drum tracks on the beat)
    const n = SR * 2;
    const l = sine(0.3, 2, 330);
    for (let k = 0; k < 4; k++) {
      const h = hit(1.12 - 0.3);
      l.set(h.map((v, i) => v + l[k * (SR / 2) + i]), k * (SR / 2));
    }
    const r = l.slice();
    const l0 = l.slice();
    const lim = new SafetyLimiter(SR);
    through(lim, l, r);
    // never at full scale, and never over the ceiling it rounds toward
    expect(peakOf(l, r)).toBeLessThan(SAFETY_CEILING);
    // the level never moved: every sample under the knee is exactly as it was, only the tips were touched
    expect(lim.events).toBe(0);
    let touched = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(l0[i]) <= SAFETY_KNEE) expect(l[i]).toBe(l0[i]);
      else touched++;
    }
    expect(touched).toBeGreaterThan(0);
    expect(touched).toBeLessThan(0.01 * n);
    // each tip is rounded, not cut: what is left over the knee still rises with what came in (no flat top, no corner)
    for (let i = 1; i < n; i++) if (l0[i] > l0[i - 1] && l0[i - 1] > SAFETY_KNEE) expect(l[i]).toBeGreaterThan(l[i - 1]);
  });

  it("rounding is smooth at the knee and never reaches the ceiling", () => {
    expect(roundOff(0.5)).toBe(0.5);
    expect(roundOff(SAFETY_KNEE)).toBe(SAFETY_KNEE);
    expect(roundOff(-SAFETY_KNEE - 1e-4)).toBeCloseTo(-SAFETY_KNEE - 1e-4, 6);
    // the slope is 1 at the knee (no corner, so no new edge in the sound), then flattens
    const d = 1e-5;
    expect((roundOff(SAFETY_KNEE + d) - SAFETY_KNEE) / d).toBeCloseTo(1, 3);
    expect(roundOff(1)).toBeLessThan(1);
    expect(roundOff(1.122)).toBeLessThan(SAFETY_CEILING);
    expect(roundOff(100)).toBeLessThanOrEqual(SAFETY_CEILING);
    expect(roundOff(-100)).toBeGreaterThanOrEqual(-SAFETY_CEILING);
  });

  it("brings a held over down to −1 dBFS over about 20 ms instead of rounding it for long", () => {
    // a loud held note, 0.5 dB over full scale
    const l = sine(1.06, 1);
    const r = l.slice();
    const lim = new SafetyLimiter(SR);
    through(lim, l, r);
    expect(peakOf(l, r)).toBeLessThan(SAFETY_CEILING);
    expect(lim.gain).toBeLessThan(1);
    // after the first quarter of a second it sits at the knee: hardly anything is rounded any more
    const tail = l.subarray(SR / 4);
    expect(peakOf(tail)).toBeLessThanOrEqual(SAFETY_KNEE * 1.005);
    expect(peakOf(tail)).toBeGreaterThan(SAFETY_KNEE - 0.01);
    // the rounding was a small part of the note
    expect(lim.rounded).toBeLessThan(0.1 * l.length);
    // and once it has passed, the level comes back to exactly 1
    lim.process(new Float32Array(SR * 4), new Float32Array(SR * 4));
    expect(lim.gain).toBe(1);
  });

  it("holds a peak far over at once, with no delay, and never lets anything out at full scale", () => {
    // a mix gone 3 dB over full scale
    const l = sine(1.41, 1);
    const r = sine(1.2, 1, 110);
    const lim = new SafetyLimiter(SR);
    through(lim, l, r);
    expect(peakOf(l, r)).toBeLessThan(SAFETY_CEILING);
    expect(lim.events).toBeGreaterThan(0);
    // nothing is moved in time: the first samples (under the knee) are untouched, and the wave keeps its zero crossings
    const ref = sine(1.41, 1);
    for (let i = 0; i < 20; i++) expect(l[i]).toBe(ref[i]);
    for (let i = 1; i < l.length; i++) if (Math.sign(ref[i]) !== Math.sign(ref[i - 1])) expect(Math.sign(l[i]) === Math.sign(ref[i]) || l[i] === 0).toBe(true);
  });

  it("turns the left and right down together, so the picture does not lean", () => {
    const l = Float32Array.from([0.2, 3, 0.2]);
    const r = Float32Array.from([0.1, 0.3, 0.1]);
    new SafetyLimiter(SR).process(l, r);
    expect(l[1]).toBeLessThan(SAFETY_CEILING);
    // the right went down by the same gain, though it was nowhere near the knee
    expect(r[1] / 0.3).toBeCloseTo(SAFETY_LIMIT / 3, 5);
  });

  it("holds for 10 ms after a peak far over, then comes back over about 150 ms, to exactly 1", () => {
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
    expect(lim2.gain).toBeCloseTo(SAFETY_LIMIT / 2, 6); // still holding
    const b = new Float32Array(Math.round(0.15 * SR) + Math.round(0.001 * SR));
    lim2.process(b, b);
    // one time constant up: 1 − (1 − g)/e
    expect(1 - lim2.gain).toBeCloseTo((1 - SAFETY_LIMIT / 2) / Math.E, 2);
  });

  it("a quiet signal right after an over comes back to unity and passes bit for bit again", () => {
    const lim = new SafetyLimiter(SR);
    const over = sine(1.3, 0.3);
    lim.process(over, over);
    lim.process(new Float32Array(SR * 3), new Float32Array(SR * 3));
    const q = sine(0.3, 0.1);
    const q0 = q.slice();
    lim.process(q, q);
    expect(q).toEqual(q0);
    expect(lim.gain).toBe(1);
  });

  it("adds no click of its own: a rounded tip bends about as gently as the hit itself, where a flattened one has corners", () => {
    const l = hit(1.1);
    const r = l.slice();
    const l0 = l.slice();
    through(new SafetyLimiter(SR), l, r);
    // (the sharpest bend: the largest second difference)
    const bend = (x: Float32Array) => x.reduce((m, _, i) => (i < 2 ? m : Math.max(m, Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]))), 0);
    const clipped = l0.map((v) => Math.max(-SAFETY_CEILING, Math.min(SAFETY_CEILING, v)));
    expect(bend(l)).toBeLessThan(5 * bend(l0));
    expect(bend(clipped)).toBeGreaterThan(10 * bend(l));
  });

  it("a mix of drum hits over −1 dBFS never brings its level down (the tips are rounded), where a held note does", () => {
    const hits = new Float32Array(SR * 2);
    for (let k = 0; k < 8; k++) hits.set(hit(1.12, 0.2), k * (SR / 4));
    const lim = new SafetyLimiter(SR);
    through(lim, hits, hits.slice());
    expect(lim.events).toBe(0);
    expect(lim.gain).toBe(1);
    const held = sine(1.0, 0.5);
    const lim2 = new SafetyLimiter(SR);
    through(lim2, held, held.slice());
    expect(lim2.events).toBe(1);
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
    // (through the mix's very end, which the recording engine can take it from: see mix.ts masterOut)
    expect(nodes[0].outputs.length).toBe(1);
    expect((nodes[0].outputs[0] as { outputs: unknown[] }).outputs).toEqual([c.destination]);
  });
});
