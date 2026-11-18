import { describe, expect, it } from "vitest";
import pack from "../../public/keys/piano/manifest.json";
import {
  OPEN_CUTOFF,
  checkManifest,
  filesFor,
  layerOf,
  layerSamples,
  loadOrder,
  pick,
  rateFor,
  releaseFor,
  shade,
  shiftCents,
  stretchOf,
  targetHz,
  velocityDb,
  type PackManifest,
} from "./pack";

const m = pack as unknown as PackManifest;
const KEYS = Array.from({ length: 88 }, (_, i) => 21 + i);
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
/** The pitch a recording really has (its key's equal-tempered pitch moved by its measured cents). */
const recordedHz = (s: { note: number; cents: number }) => 440 * 2 ** ((s.note - 69) / 12 + s.cents / 1200);

describe("the piano pack's manifest", () => {
  it("is sound: layers in order and touching, every key reachable in every layer", () => {
    expect(checkManifest(m)).toEqual([]);
  });

  it("covers the 88 keys with recordings every minor third in each of its layers", () => {
    expect(m.range).toEqual([21, 108]);
    expect(m.layers.length).toBeGreaterThanOrEqual(3);
    for (let l = 0; l < m.layers.length; l++) {
      const notes = layerSamples(m, l).map((s) => s.note).sort((a, b) => a - b);
      expect(notes[0]).toBe(21);
      expect(notes[notes.length - 1]).toBe(108);
      for (let i = 1; i < notes.length; i++) expect(notes[i] - notes[i - 1]).toBeLessThanOrEqual(3);
    }
  });

  it("orders the velocity layers from soft to hard, and they get louder", () => {
    for (let i = 1; i < m.layers.length; i++) {
      expect(m.layers[i].center).toBeGreaterThan(m.layers[i - 1].center);
      expect(m.layers[i].vel[0]).toBe(m.layers[i - 1].vel[1]);
      for (const k of [24, 60, 96]) expect(velocityDb(m, k, m.layers[i].center)).toBeGreaterThan(velocityDb(m, k, m.layers[i - 1].center));
    }
  });

  it("keeps every re-pitch within the stated reach (two semitones)", () => {
    for (const k of KEYS)
      for (let l = 0; l < m.layers.length; l++) {
        const p = pick(m, k, m.layers[l].center)!;
        expect(Math.abs(shiftCents(m, p.sample, k))).toBeLessThanOrEqual(m.maxShift * 100);
        expect(p.sample.layer).toBe(l);
      }
  });

  it("lists sizes that add up to a download under 20 MB, and no file twice", () => {
    const files = [...m.samples, ...m.releases];
    expect(new Set(files.map((f) => f.file)).size).toBe(files.length);
    const total = files.reduce((n, f) => n + f.bytes, 0);
    expect(total).toBeLessThan(20e6);
  });
});

describe("choosing a recording", () => {
  it("tunes every key, in every layer, to within 1 cent of its target pitch", () => {
    let worst = 0;
    for (const k of KEYS)
      for (let l = 0; l < m.layers.length; l++) {
        const p = pick(m, k, m.layers[l].center)!;
        const heard = recordedHz(p.sample) * p.rate;
        worst = Math.max(worst, Math.abs(cents(heard, targetHz(m, k))));
      }
    expect(worst).toBeLessThan(1);
  });

  it("follows a gentle stretch: middle keys near equal temperament, A4 at 440 Hz", () => {
    expect(stretchOf(m, 69)).toBe(0);
    for (const k of [57, 60, 64, 67, 72]) expect(Math.abs(stretchOf(m, k))).toBeLessThan(5);
    expect(stretchOf(m, 21)).toBeLessThan(0); // bass a little flat
    expect(stretchOf(m, 108)).toBeGreaterThan(0); // treble a little sharp
    for (let k = 22; k <= 108; k++) expect(stretchOf(m, k)).toBeGreaterThanOrEqual(stretchOf(m, k - 1) - 0.01); // never folds back
  });

  it("plays a recording at its own pitch on its own key apart from the tuning correction", () => {
    for (const s of m.samples) {
      const r = rateFor(m, s, s.note);
      expect(Math.abs(1200 * Math.log2(r) - (stretchOf(m, s.note) - s.cents))).toBeLessThan(1e-9);
    }
  });

  it("picks the layer by velocity, the band edges going to the harder layer", () => {
    expect(layerOf(m, 0)).toBe(0);
    expect(layerOf(m, 1)).toBe(m.layers.length - 1);
    for (let i = 1; i < m.layers.length; i++) {
      expect(layerOf(m, m.layers[i].vel[0])).toBe(i);
      expect(layerOf(m, m.layers[i].vel[0] - 1e-6)).toBe(i - 1);
    }
    expect(layerOf(m, -3)).toBe(0);
    expect(layerOf(m, 7)).toBe(m.layers.length - 1);
  });

  it("makes loudness rise smoothly with velocity, with no jump where layers hand over", () => {
    for (const k of [21, 45, 60, 81, 100]) {
      let prev = -Infinity;
      for (let v = 0.02; v <= 1.0001; v += 0.01) {
        const db = velocityDb(m, k, v);
        expect(db).toBeGreaterThan(prev);
        if (prev > -Infinity) expect(db - prev).toBeLessThan(2.5); // 1% more velocity never adds more than 2.5 dB
        prev = db;
      }
    }
    // either side of each band edge the level is the same
    for (let i = 1; i < m.layers.length; i++) {
      const e = m.layers[i].vel[0];
      expect(Math.abs(velocityDb(m, 60, e + 1e-6) - velocityDb(m, 60, e - 1e-6))).toBeLessThan(0.01);
    }
  });

  it("keeps a wide but usable range: soft to hard about 15 to 25 dB in the middle", () => {
    const span = velocityDb(m, 60, 1) - velocityDb(m, 60, 0.2);
    expect(span).toBeGreaterThan(15);
    expect(span).toBeLessThan(28);
  });

  it("falls back to the nearest loaded layer, then to any loaded take, while files arrive", () => {
    const only = new Set(layerSamples(m, 2).map((s) => s.file));
    const p = pick(m, 61, 0.95, (f) => only.has(f))!;
    expect(p.sample.layer).toBe(2);
    expect(p.layer).toBe(layerOf(m, 0.95));
    // the level still follows the velocity asked for
    expect(p.db).toBeCloseTo(p.sample.gain + velocityDb(m, 61, 0.95) + (shade(m, p.sample, 0.95)?.db ?? 0), 6);
    const one = new Set([layerSamples(m, 0).find((s) => s.note === 60)!.file]);
    const far = pick(m, 90, 0.5, (f) => one.has(f))!;
    expect(far.sample.note).toBe(60);
    expect(pick(m, 60, 0.5, () => false)).toBeUndefined();
  });

  it("darkens a take played softer than it was recorded, opening smoothly to its own sound", () => {
    let shaded = 0;
    for (const s of m.samples) {
      const L = m.layers[s.layer];
      // at and above the velocity it was recorded at, and on the softest layer, it plays as it is
      expect(shade(m, s, L.center)).toBeUndefined();
      expect(shade(m, s, Math.min(1, L.center + 0.05))).toBeUndefined();
      if (s.layer === 0 || !s.soft) {
        expect(shade(m, s, L.vel[0])).toBeUndefined();
        continue;
      }
      shaded++;
      // at the bottom of its band it is as dark as the softer take, with the level the filter took given back
      const bottom = shade(m, s, L.vel[0])!;
      expect(bottom.cutoff).toBeCloseTo(s.soft, 6);
      expect(bottom.db).toBeCloseTo(s.softDb ?? 0, 9);
      // then it opens steadily
      let prev = 0;
      for (let v = L.vel[0]; v < L.center; v += 0.01) {
        const sh = shade(m, s, v);
        const fc = sh ? sh.cutoff : OPEN_CUTOFF;
        expect(fc).toBeGreaterThanOrEqual(prev);
        prev = fc;
      }
      // never below three times the note's fundamental (it keeps its first overtones)
      expect(s.soft).toBeGreaterThanOrEqual(3 * 440 * 2 ** ((s.note - 69) / 12) - 1);
    }
    expect(shaded).toBeGreaterThan(m.samples.length / 2);
    // pick() carries it
    const s60 = layerSamples(m, 3).find((s) => s.note === 60)!;
    const p = pick(m, 60, m.layers[3].vel[0] + 0.01)!;
    expect(p.sample).toBe(s60);
    expect(p.cutoff).toBeGreaterThan(s60.soft!);
    expect(pick(m, 60, m.layers[3].center)!.cutoff).toBeUndefined();
  });

  it("has damper sounds for the damped keys only, soft ones after soft playing", () => {
    expect(releaseFor(m, 60, 0.6)?.soft).toBe(false);
    expect(releaseFor(m, 60, 0.1)?.soft).toBe(true);
    expect(releaseFor(m, m.dampedTop + 1, 0.6)).toBeUndefined();
    for (let k = 21; k <= m.dampedTop; k++) {
      const r = releaseFor(m, k, 0.6)!;
      expect(Math.abs(shiftCents(m, r, k))).toBeLessThanOrEqual(m.maxShift * 100);
    }
  });

  it("lists the files a song needs", () => {
    const files = filesFor(m, [
      { midi: 60, velocity: 0.7 },
      { midi: 61, velocity: 0.7 },
      { midi: 100, velocity: 0.2 },
    ]);
    const p60 = pick(m, 60, 0.7)!.sample.file;
    expect(files).toContain(p60);
    expect(files).toContain(releaseFor(m, 60, 0.7)!.file);
    expect(files.filter((f) => f === p60).length).toBe(1);
    expect(files).toContain(pick(m, 100, 0.2)!.sample.file);
  });
});

describe("loading order", () => {
  const tiers = loadOrder(m, 0.7);
  const fileOf = new Map([...m.samples, ...m.releases].map((s) => [s.file, s]));

  it("loads one layer across the whole keyboard first, the middle octaves before the ends", () => {
    const first = tiers[0].map((f) => fileOf.get(f)! as (typeof m.samples)[number]);
    expect(new Set(first.map((s) => s.layer))).toEqual(new Set([layerOf(m, 0.7)]));
    expect(first.length).toBe(layerSamples(m, layerOf(m, 0.7)).length);
    const dist = first.map((s) => Math.abs(s.note - 62));
    for (let i = 1; i < dist.length; i++) expect(dist[i]).toBeGreaterThanOrEqual(dist[i - 1]);
    expect(first[0].note).toBeGreaterThanOrEqual(57);
    expect(first[0].note).toBeLessThanOrEqual(66);
  });

  it("then the damper sounds, then the other layers nearest in strength first, and every file once", () => {
    expect(tiers[1].every((f) => f.startsWith("r"))).toBe(true);
    const all = tiers.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(m.samples.length + m.releases.length);
    const layerTiers = tiers.filter((t) => fileOf.get(t[0]) && "layer" in fileOf.get(t[0])!).map((t) => (fileOf.get(t[0]) as (typeof m.samples)[number]).layer);
    const core = layerOf(m, 0.7);
    for (let i = 1; i < layerTiers.length; i++) expect(Math.abs(layerTiers[i] - core)).toBeGreaterThanOrEqual(Math.abs(layerTiers[i - 1] - core));
  });
});
