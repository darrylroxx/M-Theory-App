import { afterEach, describe, expect, it, vi } from "vitest";
import { SAT_REF, SAT_TYPES, bend, createSaturator, isSatType, satCurve, type SatType } from "./saturation";
import { FakeAudio, FakeOffline, type FakeAny } from "./fakectx";

/** Put a sine of the usual size through a curve and measure its overtones, relative to the note itself. */
function overtones(type: SatType, amount: number, size = SAT_REF): number[] {
  const curve = satCurve(type, amount);
  const n = 4096;
  const out = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const x = size * Math.sin((2 * Math.PI * 8 * i) / n);
    const at = ((x + 1) / 2) * (curve.length - 1);
    const lo = Math.floor(at);
    out[i] = curve[lo] + (curve[Math.min(curve.length - 1, lo + 1)] - curve[lo]) * (at - lo);
    mean += out[i] / n;
  }
  const mag = (h: number) => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      re += (out[i] - mean) * Math.cos((2 * Math.PI * 8 * h * i) / n);
      im += (out[i] - mean) * Math.sin((2 * Math.PI * 8 * h * i) / n);
    }
    return Math.hypot(re, im);
  };
  const f = mag(1);
  return [1, 2, 3, 4, 5].map((h) => 20 * Math.log10(mag(h) / f + 1e-9));
}
const at = (curve: Float32Array, x: number) => curve[Math.round(((x + 1) / 2) * (curve.length - 1))];

describe("saturation", () => {
  it("has six colours", () => {
    expect(SAT_TYPES.map((t) => t.id)).toEqual(["tape", "tube", "console", "crunch", "fuzz", "clip"]);
    expect(isSatType("tube")).toBe(true);
    expect(isSatType("grit")).toBe(false);
  });

  it("every bend is a straight line through the middle, never jumps, and never runs away", () => {
    for (const t of SAT_TYPES) {
      expect((bend(t.id, 1e-3) - bend(t.id, -1e-3)) / 2e-3, t.id).toBeCloseTo(1, 1);
      let prev = bend(t.id, -40);
      for (let u = -40; u <= 40; u += 0.01) {
        const y = bend(t.id, u);
        expect(y, t.id).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(y - prev).toBeLessThan(0.013);
        expect(Math.abs(y)).toBeLessThan(1.8);
        prev = y;
      }
    }
  });

  it("is clean with the knob down and dirtier the further it is turned", () => {
    for (const t of SAT_TYPES) {
      const dirt = (a: number) => Math.max(...overtones(t.id, a, SAT_REF * 1.5).slice(1));
      expect(dirt(0), t.id).toBeLessThan(t.id === "fuzz" ? -18 : -38);
      // each quarter turn adds overtones
      const steps = [0, 0.25, 0.5, 0.75, 1].map(dirt);
      for (let i = 1; i < steps.length; i++) expect(steps[i], `${t.id} ${i}`).toBeGreaterThan(steps[i - 1] - 0.5);
      expect(steps[4], t.id).toBeGreaterThan(-20);
      for (const v of satCurve(t.id, 1)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("a quarter turn is colour, not distortion: about 1% of overtones on tape, tube and console", () => {
    for (const id of ["tape", "tube", "console"] as SatType[]) {
      const worst = Math.max(...overtones(id, 0.25).slice(1));
      expect(worst, id).toBeLessThan(-32);
      expect(worst, id).toBeGreaterThan(-46);
    }
  });

  it("a tube adds the octave above the note; tape, console and crunch add the twelfth", () => {
    // the 2nd overtone (an octave up) is what makes valves sound warm
    const tube = overtones("tube", 0.5);
    expect(tube[1]).toBeGreaterThan(tube[2] + 15);
    for (const id of ["tape", "console", "crunch"] as SatType[]) {
      const h = overtones(id, 0.5);
      expect(h[2], id).toBeGreaterThan(h[1] + 6);
    }
    // console and crunch are perfectly even-handed: no even overtones at all
    expect(overtones("console", 0.7)[1]).toBeLessThan(-80);
    expect(overtones("crunch", 0.7)[1]).toBeLessThan(-80);
    // pushed hard, the tube turns from sweet to edgy: the odd overtones catch up
    const hot = overtones("tube", 1);
    expect(hot[2]).toBeGreaterThan(tube[2] + 20);
  });

  it("clip leaves ordinary hits alone and only shaves the peaks", () => {
    expect(Math.max(...overtones("clip", 0.25).slice(1))).toBeLessThan(-55);
    // the same setting on a hit twice the size: now it bites
    expect(Math.max(...overtones("clip", 0.25, SAT_REF * 2).slice(1))).toBeGreaterThan(-30);
    const c = satCurve("clip", 0.6);
    expect(at(c, 1) / at(c, 0.25)).toBeLessThan(2);
  });

  it("fuzz is the dirtiest, tape the gentlest", () => {
    const thd = (id: SatType, a: number) => Math.max(...overtones(id, a).slice(1));
    expect(thd("fuzz", 0.5)).toBeGreaterThan(thd("crunch", 0.5) + 6);
    expect(thd("crunch", 1)).toBeGreaterThan(thd("tape", 1));
    // fuzz is lopsided: it has even overtones too
    expect(overtones("fuzz", 0.2)[1]).toBeGreaterThan(-35);
  });

  it("a sound of the usual size comes out about as loud as it went in; quiet ones are lifted, loud ones held back", () => {
    for (const t of SAT_TYPES)
      for (const a of [0.25, 0.5, 0.75, 1]) {
        const c = satCurve(t.id, a);
        const gain = (x: number) => (at(c, x) - at(c, -x)) / (2 * x);
        expect(gain(SAT_REF), `${t.id} ${a}`).toBeCloseTo(1, 1);
        expect(gain(0.05)).toBeGreaterThanOrEqual(gain(SAT_REF) - 0.02);
        expect(gain(0.9)).toBeLessThanOrEqual(gain(SAT_REF) + 0.02);
      }
  });
});

describe("a saturator turned all the way down rests", () => {
  afterEach(() => vi.useRealTimers());
  /** the oversampled shapers a sound passes on its way through, and whether the bend is one of them */
  const shapers = (c: FakeAudio, from: object) => (c.nodes as FakeAny[]).filter((n) => n.oversample === "4x" && c.reaches(from, n));
  const isBend = (n: FakeAny) => (n.curve as Float32Array).length === 4097;

  it("live: at zero only the straight path runs; turned up, the bend is fed before it glides in; turned down, let go once it has", () => {
    vi.useFakeTimers();
    const c = new FakeAudio(48000);
    const sat = createSaturator(c as never, 0.2, true);
    sat.set("tape", 0, 1);
    // the straight path (which sets the timing) always runs, and alone
    expect(shapers(c, sat.input).length).toBe(1);
    expect(shapers(c, sat.input).some(isBend)).toBe(false);
    expect(c.reaches(sat.input, sat.output)).toBe(true);
    sat.set("tube", 0.5, 1);
    expect(shapers(c, sat.input).length).toBe(3);
    expect(shapers(c, sat.input).some(isBend)).toBe(true);
    sat.set("tube", 0, 1);
    // still fed while its level glides down
    vi.advanceTimersByTime(200);
    expect(shapers(c, sat.input).length).toBe(3);
    vi.advanceTimersByTime(200);
    expect(shapers(c, sat.input).length).toBe(1);
    // turned up and straight back down before it settled: it stays fed, then rests
    sat.set("tube", 0.3, 1);
    sat.set("tube", 0, 1);
    sat.set("tube", 0.3, 1);
    vi.advanceTimersByTime(1000);
    expect(shapers(c, sat.input).length).toBe(3);
    // the mix at zero is the knob at zero too
    sat.set("tube", 0.3, 0);
    vi.advanceTimersByTime(1000);
    expect(shapers(c, sat.input).length).toBe(1);
  });

  it("offline: unfed while it is never used, fed from where it first is, and never let go", () => {
    vi.useFakeTimers();
    const c = new FakeOffline(48000);
    const sat = createSaturator(c as never, 0.25);
    sat.set("tape", 0, 1);
    expect(shapers(c, sat.input).length).toBe(1);
    sat.set("tape", 0.4, 1);
    sat.set("tape", 0, 1);
    vi.advanceTimersByTime(5000);
    expect(shapers(c, sat.input).length).toBe(3);
  });
});
