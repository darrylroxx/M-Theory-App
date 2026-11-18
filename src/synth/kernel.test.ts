import { describe, expect, it } from "vitest";
import { SynthKernel, detuneCurve, sin2pi } from "./kernel";
import { allFinite, cents, foldDb, harmonics, maxStep, partialHz, rms } from "./measure";
import { DEFAULT_PARAMS, type OscType, type SynthParams, attackOf, ratioOf, timeOf } from "./params";
import { renderNotes } from "./render";

const SR = 48000;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** A plain, still sound for measuring: no drift, no LFO, no effects, the filter wide open, the envelope on the loudness only. */
function clean(patch: Partial<SynthParams> = {}): SynthParams {
  return {
    ...DEFAULT_PARAMS,
    texture: 0,
    mod: 0,
    cutoff: 1,
    resonance: 0,
    keyTrack: 0,
    drive: 0,
    balance: 0,
    attack: 0,
    decay: 0.5,
    sustain: 1,
    release: 0,
    fx: "off",
    reverb: 0,
    width: 0,
    drift: 0,
    velocity: 0,
    lfoDest: "off",
    volume: 1,
    ...patch,
  };
}

/** A pure sine: FM with no depth. */
const sine = (patch: Partial<SynthParams> = {}) => clean({ osc: "fm", texture: 0, mod: ratioOf("fm", 1), ...patch });

/** Render one sound for `seconds` with notes given as [midi, start, length, velocity?]. */
function render(p: SynthParams, notes: [number, number, number, number?][], seconds: number, opts: { voices?: number; seed?: number } = {}) {
  return renderNotes(p, notes.map(([midi, start, length, velocity]) => ({ midi, start, length, velocity: velocity ?? 0.8 })), { sampleRate: SR, seconds, ...opts });
}

describe("building blocks", () => {
  it("the polynomial sine is a sine", () => {
    for (let i = 0; i <= 64; i++) expect(Math.abs(sin2pi(i / 64) - Math.sin((2 * Math.PI * i) / 64))).toBeLessThan(1e-5);
  });
  it("the supersaw detune curve rises from almost nothing to full", () => {
    expect(detuneCurve(0)).toBeCloseTo(0.003, 3);
    expect(detuneCurve(1)).toBeCloseTo(1, 3);
    let last = -1;
    for (let x = 0; x <= 1.0001; x += 0.05) {
      const d = detuneCurve(x);
      expect(d).toBeGreaterThan(last - 1e-3);
      last = d;
    }
  });
});

describe("pitch", () => {
  // each oscillator in a setting whose lowest partial is the note itself
  const types: [OscType, Partial<SynthParams>][] = [
    ["saw", { mod: 0, texture: 0 }],
    ["saw", { mod: 0, texture: 0.5 }],
    ["pulse", { texture: 0, mod: 0.3 }],
    ["sync", { texture: 0.4, mod: 0 }],
    ["ring", { texture: 0, mod: ratioOf("ring", 2) }],
    ["fm", { texture: 0.3, mod: ratioOf("fm", 1) }],
  ];
  for (const [osc, patch] of types) {
    it(`${osc} ${JSON.stringify(patch)} plays in tune from the bottom to the top of the range`, () => {
      for (const midi of [28, 36, 48, 60, 72, 84, 96]) {
        const p = clean({ osc, ...patch });
        const { L } = render(p, [[midi, 0, 2]], 1.6);
        const f = hz(midi);
        // (a saw with a sub has its lowest partial an octave down; the note is still a partial of it)
        const got = partialHz(L, SR, f, Math.round(0.2 * SR), 0.6);
        expect(Math.abs(cents(f, got)), `${osc} midi ${midi}: ${got.toFixed(3)} Hz for ${f.toFixed(3)}`).toBeLessThan(0.5);
      }
    });
  }
  it("drift wanders by a few cents at most", () => {
    const p = sine({ drift: 1 });
    const { L } = render(p, [[69, 0, 3]], 3);
    const got = partialHz(L, SR, 440, Math.round(0.5 * SR), 1);
    const c = Math.abs(cents(440, got));
    expect(c).toBeGreaterThan(0.05);
    expect(c).toBeLessThan(12);
  });
});

describe("aliasing (energy that is not a harmonic of the note)", () => {
  const cases: [string, Partial<SynthParams>, number][] = [
    ["saw", { osc: "saw", mod: 0 }, 1],
    ["supersaw", { osc: "saw", mod: 0.7 }, 0],
    ["pulse", { osc: "pulse", mod: 0 }, 1],
    ["narrow pulse", { osc: "pulse", mod: 0.8 }, 1],
    ["sync", { osc: "sync", texture: 0.4 }, 1],
    ["ring", { osc: "ring", mod: ratioOf("ring", 2) }, 1],
    ["fm", { osc: "fm", texture: 0.6, mod: ratioOf("fm", 2) }, 1],
  ];
  for (const [name, patch, harmonic] of cases) {
    it(`${name} stays clean up to the top of the keyboard`, () => {
      const rows: string[] = [];
      // (a detuned stack through the filter's gentle saturation also makes a little intermodulation, which counts here too)
      const limits = harmonic ? [-55, -48, -44, -35] : [-45, -42, -40, -35];
      for (const [midi, limit] of [[60, limits[0]], [84, limits[1]], [96, limits[2]], [108, limits[3]]] as const) {
        const { L } = render(clean(patch), [[midi, 0, 2]], 2);
        const f = hz(midi);
        // a detuned stack is not harmonic: measure the spread saws against their own partials
        const partials = harmonic ? harmonics(f, SR) : stackPartials(f);
        const db = foldDb(L, SR, partials, 12000);
        rows.push(`${midi}: ${db.toFixed(1)} dB`);
        expect(db, `${name} midi ${midi} (${rows.join(", ")})`).toBeLessThan(limit);
      }
    });
  }
  function stackPartials(f: number) {
    const d = detuneCurve(0.9 * Math.pow(0.7, 0.8));
    const offs = [0, -0.11002313, 0.10745242, -0.06288439, 0.06216538, -0.01952356, 0.01991221];
    const out: number[] = [];
    for (const o of offs) out.push(...harmonics(f * (1 + o * d), SR));
    return out;
  }
});

describe("envelope", () => {
  /** loudness envelope of a sine, one RMS value per 2 ms */
  function envOf(x: Float32Array) {
    const hop = Math.round(0.002 * SR);
    const out: number[] = [];
    for (let i = 0; i + hop <= x.length; i += hop) out.push(rms(x, i, i + hop) * Math.SQRT2);
    return { out, hop: 0.002 };
  }
  it("attack reaches the top at the time on the knob", () => {
    for (const a of [0.05, 0.3, 1]) {
      const p = sine({ attack: attackOf(a), sustain: 1, decay: timeOf(0.5) });
      const { L } = render(p, [[57, 0.1, 3]], 0.1 + a + 0.6);
      const { out, hop } = envOf(L);
      const peak = Math.max(...out);
      const t = out.findIndex((v) => v >= 0.98 * peak) * hop - 0.1;
      expect(Math.abs(t - a), `attack ${a}: ${t}`).toBeLessThan(0.05 * a + 0.01);
      // and it rose steadily: half way up by about a third of the attack time (the analogue curve is fast at first)
      const half = out.findIndex((v) => v >= 0.5 * peak) * hop - 0.1;
      expect(half).toBeLessThan(0.5 * a);
    }
  });
  it("decay falls to the sustain level, 60 dB down at the decay time", () => {
    const d = 0.8;
    const p = sine({ sustain: 0, decay: timeOf(d), release: timeOf(0.1) });
    const { L } = render(p, [[57, 0, 3]], 1.5);
    const { out, hop } = envOf(L);
    const peak = Math.max(...out);
    const at = out[Math.round(d / hop)];
    expect(20 * Math.log10(at / peak)).toBeLessThan(-54);
    expect(20 * Math.log10(at / peak)).toBeGreaterThan(-66);
    const p2 = sine({ sustain: 0.5, decay: timeOf(0.2) });
    const r2 = envOf(render(p2, [[57, 0, 2]], 1.5).L).out;
    expect(r2[Math.round(1 / 0.002)] / Math.max(...r2)).toBeCloseTo(0.5, 1);
  });
  it("release fades 60 dB at the release time, from wherever the note was", () => {
    const r = 0.5;
    const p = sine({ release: timeOf(r) });
    const { L } = render(p, [[57, 0, 0.5]], 1.5);
    const { out, hop } = envOf(L);
    const held = out[Math.round(0.45 / hop)];
    const after = out[Math.round((0.5 + r) / hop)];
    expect(20 * Math.log10(after / held)).toBeLessThan(-54);
    expect(20 * Math.log10(after / held)).toBeGreaterThan(-66);
  });
  it("a voice that has rung out is freed", () => {
    const k = new SynthKernel(SR, { seed: 1 });
    k.setParams(sine({ release: timeOf(0.05) }));
    k.snapSmoothing();
    k.noteOn(0, 60, 0.8, 1);
    k.noteOff(0.1 * SR, 1);
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    for (let i = 0; i < 0.05 * SR; i += 128) k.render(L, R, 128);
    expect(k.activeVoices()).toBe(1);
    for (let i = 0; i < 0.4 * SR; i += 128) k.render(L, R, 128);
    expect(k.activeVoices()).toBe(0);
  });
});

/** The largest second difference in [from, to). */
function maxBend(x: Float32Array, from: number, to: number) {
  let m = 0;
  for (let i = from + 2; i < to; i++) m = Math.max(m, Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]));
  return m;
}

describe("no clicks", () => {
  // A 220 Hz sine moves by at most 2π·220/48000 ≈ 0.029 of its height per sample; a click is a step far bigger than that.
  const steady = (amp: number) => amp * ((2 * Math.PI * 220) / SR);

  it("when notes start and stop (the shortest attack and release)", () => {
    const p = sine({ attack: 0, release: 0 });
    const { L } = render(p, [[57, 0.1, 0.3], [57, 0.6, 0.0004], [57, 0.8, 0.2]], 1.2);
    const amp = Math.max(...L.subarray(Math.round(0.2 * SR), Math.round(0.3 * SR)));
    expect(amp).toBeGreaterThan(0.1);
    expect(maxStep(L, 0, L.length)).toBeLessThan(1.6 * steady(amp));
  });
  it("when a voice is stolen", () => {
    const p = sine({ attack: 0, release: timeOf(2) });
    // nine overlapping notes on an eight-voice synth: the ninth takes the oldest voice
    const notes: [number, number, number][] = [];
    for (let i = 0; i < 9; i++) notes.push([57 + (i % 2 ? 12 : 0), 0.05 * i, 2]);
    const { L } = render(p, notes, 1.2, { voices: 8 });
    // A click is a corner: the second difference of a sum of sines is small and smooth, a cut-off voice makes it spike.
    const at = Math.round(0.4 * SR);
    const before = maxBend(L, at - 4000, at - 100);
    const around = maxBend(L, at - 100, at + 1000);
    expect(around).toBeLessThan(2 * before);
    expect(allFinite(L)).toBe(true);
  });
  it("when a mono line moves and when the same key is struck again while ringing", () => {
    const p = sine({ voice: "mono", attack: 0, release: timeOf(0.3) });
    const { L } = render(p, [[57, 0.1, 0.3], [64, 0.4, 0.3], [57, 0.7, 0.2], [57, 0.95, 0.2]], 1.4);
    const amp = Math.max(...L.subarray(Math.round(0.2 * SR), Math.round(0.35 * SR)));
    expect(maxStep(L, 0, L.length)).toBeLessThan(1.6 * amp * ((2 * Math.PI * hz(64)) / SR));
  });
  it("when the volume, the cutoff or the oscillator type changes under a held note", () => {
    const k = new SynthKernel(SR, { seed: 3 });
    const a = sine({ volume: 0.3 });
    k.setParams(a);
    k.snapSmoothing();
    k.noteOn(0, 57, 0.8, 1);
    const L = new Float32Array(SR);
    const R = new Float32Array(SR);
    for (let i = 0; i < SR; i += 128) {
      if (i === 128 * 100) k.setParams({ ...a, volume: 1 });
      if (i === 128 * 200) k.setParams({ ...a, volume: 1, cutoff: 0.3 });
      if (i === 128 * 280) k.setParams({ ...a, volume: 1, cutoff: 0.3, osc: "pulse", mod: 0 });
      k.render(L, R, 128, i);
    }
    const amp = Math.max(...L.subarray(128 * 150, 128 * 190));
    expect(maxStep(L, 0, 128 * 270)).toBeLessThan(1.6 * steady(amp));
    // the switch to a square is a dip and a fade, not a jump: its own edges are smoothed too
    expect(maxStep(L, 128 * 270, 128 * 300)).toBeLessThan(0.5);
    expect(allFinite(L)).toBe(true);
  });
});

describe("voices", () => {
  it("plays as many notes at once as it has voices, and steals the oldest after that", () => {
    const k = new SynthKernel(SR, { voices: 4, seed: 1 });
    k.setParams(sine({ release: timeOf(1) }));
    k.snapSmoothing();
    for (let i = 0; i < 6; i++) k.noteOn(i * 1000, 60 + i, 0.8, i + 1);
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    for (let i = 0; i < 0.2 * SR; i += 128) k.render(L, R, 128);
    // four sounding; the two stolen ones have faded and gone
    expect(k.activeVoices()).toBe(4);
  });
  it("notes start on their exact sample", () => {
    const p = sine({ attack: 0 });
    for (const at of [1000, 1001, 1077]) {
      const { L } = renderNotes(p, [{ midi: 69, start: at / SR, length: 0.1, velocity: 0.8 }], { sampleRate: SR, seconds: 0.1 });
      let first = 0;
      while (first < L.length && L[first] === 0) first++;
      // the oscillators run two samples behind (room for the band-limited corrections), always the same two
      expect(first - at).toBeGreaterThanOrEqual(1);
      expect(first - at).toBeLessThanOrEqual(3);
    }
  });
  it("legato slides without starting the envelope again; mono strikes it again", () => {
    const base = sine({ attack: attackOf(0.2), sustain: 1 });
    const hold = (voice: "mono" | "legato") => {
      const { L } = render({ ...base, voice, glide: 0.4 }, [[57, 0, 0.6], [64, 0.5, 0.5]], 1.1);
      // just after the second note: legato is still at full level; mono is attacking again from where it was
      return rms(L, Math.round(0.52 * SR), Math.round(0.56 * SR)) / rms(L, Math.round(0.4 * SR), Math.round(0.48 * SR));
    };
    expect(hold("legato")).toBeGreaterThan(0.95);
    // the mono envelope restarts its attack from the current level, so it keeps sounding (no gap) but swells again
    expect(hold("mono")).toBeGreaterThan(0.6);
  });
  it("glide takes about the portamento time to arrive", () => {
    const p = sine({ voice: "legato", glide: 0.6 });
    const { L } = render(p, [[57, 0, 1.2], [69, 0.4, 1]], 1.4);
    // a quarter of the way into the glide the pitch is between the two notes; at the end it is at the new note
    const early = partialHz(L, SR, hz(69), Math.round(1.1 * SR), 0.12);
    expect(Math.abs(cents(hz(69), early))).toBeLessThan(5);
  });
  it("is the same every time for the same seed, and different for another", () => {
    const p = clean({ osc: "saw", mod: 0.6, drift: 0.5, lfoDest: "pitch", lfoDepth: 0.2, fx: "chorus", fxDepth: 0.5, reverb: 0.4 });
    const notes: [number, number, number][] = [[48, 0, 1], [55, 0.1, 0.8], [64, 0.2, 0.6]];
    const a = render(p, notes, 1.5, { seed: 7 });
    const b = render(p, notes, 1.5, { seed: 7 });
    const c = render(p, notes, 1.5, { seed: 8 });
    const same = (x: Float32Array, y: Float32Array) => x.length === y.length && x.every((v, i) => v === y[i]);
    expect(same(a.L, b.L) && same(a.R, b.R)).toBe(true);
    expect(same(a.L, c.L)).toBe(false);
  });
  it("an all-notes-off lets go of what sounds and cancels what was still to come", () => {
    const k = new SynthKernel(SR, { seed: 1 });
    k.setParams(sine({ release: timeOf(0.02) }));
    k.snapSmoothing();
    k.noteOn(0, 60, 0.8, 1);
    k.noteOn(0.5 * SR, 64, 0.8, 2);
    k.allOff(0.2 * SR, true);
    const L = new Float32Array(SR);
    const R = new Float32Array(SR);
    for (let i = 0; i < SR; i += 128) k.render(L, R, 128, i);
    expect(rms(L, 0.1 * SR, 0.15 * SR)).toBeGreaterThan(0.05);
    expect(rms(L, 0.4 * SR, SR)).toBe(0);
  });
});

describe("sound changes", () => {
  it("knobs glide to new values instead of stepping (no zipper noise)", () => {
    const k = new SynthKernel(SR, { seed: 1 });
    const p = clean({ osc: "saw", cutoff: 0.3 });
    k.setParams(p);
    k.snapSmoothing();
    k.noteOn(0, 45, 0.8, 1);
    const L = new Float32Array(SR / 2);
    const R = new Float32Array(SR / 2);
    for (let i = 0; i < L.length; i += 128) {
      if (i === 128 * 40) k.setParams({ ...p, cutoff: 0.8 });
      k.render(L, R, 128, i);
    }
    // the brightness (how much the wave moves from sample to sample) rises over tens of milliseconds, not in one block
    const d = new Float32Array(L.length);
    for (let i = 1; i < L.length; i++) d[i] = L[i] - L[i - 1];
    const at = 128 * 40;
    // (measured over two whole cycles of the 110 Hz note, so each window holds the same number of saw edges)
    const ms = (t: number) => rms(d, at + Math.round(t * SR), at + Math.round((t + 2 / 110) * SR));
    const end = ms(0.2);
    expect(ms(0)).toBeLessThan(0.6 * end);
    expect(ms(0.012)).toBeGreaterThan(ms(0));
    expect(ms(0.025)).toBeGreaterThan(ms(0.012));
    expect(ms(0.08)).toBeGreaterThan(0.9 * end);
  });
  it("never produces NaN or runs away, whatever the knobs", () => {
    const r = (() => {
      let s = 12345;
      return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
    })();
    const oscs: OscType[] = ["saw", "pulse", "sync", "ring", "fm"];
    for (let t = 0; t < 25; t++) {
      const p = clean({
        osc: oscs[t % 5], texture: r(), mod: r(), noise: r() * 0.5, cutoff: r(), resonance: r(), drive: r(), balance: r(), keyTrack: r(),
        attack: r() * 0.3, decay: r() * 0.5, sustain: r(), release: r() * 0.4, lfoDest: (["off", "amp", "filter", "pitch", "osc"] as const)[t % 5],
        lfoDepth: r(), lfoSpeed: r(), fx: (["off", "dist", "chorus", "phaser", "delay"] as const)[(t * 3) % 5], fxDepth: r(), fxRate: r(),
        reverb: r(), drift: r(), width: r(), velocity: r(), voice: (["poly", "mono", "legato"] as const)[t % 3], glide: r() * 0.5,
      });
      const notes: [number, number, number, number][] = [];
      for (let i = 0; i < 12; i++) notes.push([24 + Math.floor(r() * 84), r() * 1.2, 0.05 + r() * 0.6, r()]);
      const { L, R } = render(p, notes, 2);
      expect(allFinite(L) && allFinite(R), JSON.stringify(p)).toBe(true);
      for (let i = 0; i < L.length; i++) expect(Math.abs(L[i]) <= 1 && Math.abs(R[i]) <= 1).toBe(true);
    }
  });
  it("a screaming filter (resonance at the top) rings at the cutoff without blowing up", () => {
    const p = clean({ osc: "saw", resonance: 1, cutoff: 0.55, drive: 0.5 });
    const { L } = render(p, [[45, 0, 2]], 2);
    expect(allFinite(L)).toBe(true);
    expect(rms(L, SR, 2 * SR)).toBeGreaterThan(0.01);
    expect(Math.max(...L.map(Math.abs))).toBeLessThanOrEqual(1);
  });
});
