import { describe, expect, it } from "vitest";
import { NOISE_BANDS, type Frame, type Voice } from "./ear";
import { VoiceRouter, isOvertone, overtoneOf } from "./route";
import { RANGE_DB } from "./ear";
import type { LayerKind } from "../canvas/layers";

const frame = (t: number, voices: Partial<Voice>[], o: Partial<Frame> = {}): Frame => ({
  t,
  voices: voices.map((v, i) => ({ id: i + 1, hz: 440, amp: 0.5, peak: 0.5, born: t, age: 0, struck: 0.5, fresh: true, ...v })),
  ended: [],
  hits: [],
  noise: new Float32Array(NOISE_BANDS).fill(0.3),
  level: 0.5,
  db: -20,
  centroid: 1000,
  flat: 0.1,
  flux: 0,
  chroma: new Float32Array(12),
  ...o,
});
/** Run frames through a router and say which layer each tone ended up in (and what it is an overtone of). */
function routeAll(r: VoiceRouter, frames: Frame[]) {
  const got = new Map<number, { layer: LayerKind; of?: number }>();
  const outs = [...frames.flatMap((f) => r.push(f)), ...r.flush()];
  for (const o of outs) for (const [l, f] of Object.entries(o) as [LayerKind, Frame][]) for (const v of f.voices) got.set(v.id, { layer: l, of: v.of });
  return { got, outs };
}

describe("sharing out what an ear hears among the layers", () => {
  it("knows an overtone: a whole multiple of a tone", () => {
    expect(isOvertone(880, 440)).toBe(true);
    expect(isOvertone(1320, 440)).toBe(true);
    expect(isOvertone(660, 440)).toBe(false);
    expect(isOvertone(440, 440)).toBe(false);
  });

  it("notes begun together are a chord; a note on its own above them is the melody; a low one the bass", () => {
    const r = new VoiceRouter({ bass: true, drums: true, fog: "other" });
    const f0 = frame(0, [
      { id: 1, hz: 262, born: 0 },
      { id: 2, hz: 330, born: 0.01 },
      { id: 3, hz: 392, born: 0.02 },
      { id: 4, hz: 65, born: 0 },
    ]);
    const f1 = frame(0.5, [
      { id: 1, hz: 262, born: 0, fresh: false, age: 0.5 },
      { id: 2, hz: 330, born: 0.01, fresh: false, age: 0.5 },
      { id: 3, hz: 392, born: 0.02, fresh: false, age: 0.5 },
      { id: 4, hz: 65, born: 0, fresh: false, age: 0.5 },
      { id: 5, hz: 784, born: 0.5 },
    ]);
    const { got } = routeAll(r, [f0, f1]);
    expect([1, 2, 3].map((id) => got.get(id)?.layer)).toEqual(["chords", "chords", "chords"]);
    expect(got.get(4)?.layer).toBe("bass");
    expect(got.get(5)?.layer).toBe("melody");
  });

  it("an overtone goes with its note and is marked as its overtone, even when it is heard a moment before the note", () => {
    const r = new VoiceRouter({ fog: "other" });
    // the overtone of a melody note is heard 40 ms before the note itself (the ear needs a longer look for low notes)
    const frames = [frame(0, [{ id: 7, hz: 1320, born: 0, amp: 0.2 }]), ...[1, 2, 3, 4].map((k) => frame(k * 0.01, [{ id: 7, hz: 1320, born: 0, amp: 0.2, fresh: false, age: k * 0.01 }, ...(k >= 4 ? [{ id: 8, hz: 440, born: 0.04, amp: 0.6 }] : [])]))];
    const { got } = routeAll(r, frames);
    expect(got.get(8)?.layer).toBe("melody");
    expect(got.get(7)?.layer).toBe("melody");
    expect(got.get(7)?.of).toBe(8);
    expect(got.get(8)?.of).toBeUndefined();
  });

  it("hits go to the drums when there are drums, and the noise to the fog, once", () => {
    const r = new VoiceRouter({ drums: true, fog: "other", delay: 0 });
    const out = r.route(frame(0, [{ hz: 500 }], { hits: [{ strength: 0.8, lo: 2000, hi: 9000, hz: 5000, noisy: 0.9 }] }));
    expect(out.drums?.hits).toHaveLength(1);
    expect(out.chords?.hits ?? []).toHaveLength(0);
    expect(out.other?.noise[0]).toBeCloseTo(0.3, 6);
    expect(out.melody?.noise[0]).toBe(0);
    // every layer keeps the source's level and colour
    expect(out.melody?.db).toBe(-20);
  });

  it("with one layer only, every tone goes to it and only the overtones are worked out", () => {
    const r = new VoiceRouter({ only: "vocals", delay: 0 });
    const out = r.route(frame(0, [{ id: 1, hz: 220, amp: 0.6 }, { id: 2, hz: 440, amp: 0.3 }, { id: 3, hz: 300, amp: 0.3 }]));
    expect(Object.keys(out)).toEqual(["vocals"]);
    const vs = out.vocals!.voices;
    expect(vs.find((v) => v.id === 2)?.of).toBe(1);
    expect(vs.find((v) => v.id === 3)?.of).toBeUndefined();
  });

  it("in a mix, a whole multiple is an overtone only if it is as quiet as an overtone is, or comes with the rest of its series", () => {
    // plainly quieter: an overtone
    expect(overtoneOf(660, 0.5, 220, 0.7)).toBe(true);
    // a chord note over its bass note, as loud as the bass: a note of its own (the bass's 4th, 5th and 6th overtones)
    for (const hz of [262, 330, 392]) expect(overtoneOf(hz, 0.5, 65.4, 0.5)).toBe(false);
    // a voice's loud overtone near its resonance: an overtone when the series below it is sounding, a note when not
    expect(overtoneOf(660, 0.55, 220, 0.5, false, true)).toBe(true);
    expect(overtoneOf(660, 0.55, 220, 0.5, false, false)).toBe(false);
    // the octave needs no series below it; nothing much louder than its note is an overtone
    expect(overtoneOf(440, 0.53, 220, 0.5)).toBe(true);
    expect(overtoneOf(660, 0.5 + 6 / RANGE_DB, 220, 0.5, false, true)).toBe(false);
    // in one line (a voice, a bass) every whole multiple is
    expect(overtoneOf(660, 0.9, 220, 0.5, true)).toBe(true);
  });

  it("notes of a chord that swell in are a chord, though each is heard to begin a little apart", () => {
    const r = new VoiceRouter({ fog: "other", delay: 20 });
    const frames: Frame[] = [];
    for (let k = 0; k < 40; k++) {
      const t = k * 0.01;
      const vs: Partial<Voice>[] = [];
      for (const [id, hz, born] of [[1, 262, 0], [2, 330, 0.08], [3, 392, 0.15]]) if (t >= born) vs.push({ id, hz, born, struck: 0.1, fresh: t - born < 0.005 });
      frames.push(frame(t, vs));
    }
    const { got } = routeAll(r, frames);
    expect([1, 2, 3].map((id) => got.get(id)?.layer)).toEqual(["chords", "chords", "chords"]);
  });

  it("looking ahead, a split's scraps are let go of: tones that flicker, and a drum's ring; a note begun on a hit is kept", () => {
    const r = new VoiceRouter({ fog: "other", delay: 20, minLife: 0.07, hitLife: 0.12 });
    r.hits([1.0]);
    const frames: Frame[] = [];
    for (let k = 0; k <= 100; k++) {
      const t = 0.5 + k * 0.01;
      const vs: Partial<Voice>[] = [];
      // a flicker, 4 hundredths of a second long
      if (t >= 0.6 && t < 0.64) vs.push({ id: 1, hz: 700, born: 0.6, fresh: t < 0.605 });
      // the snare's body: begun on the hit, gone in a tenth of a second
      if (t >= 1.0 && t < 1.09) vs.push({ id: 2, hz: 190, born: 1.0, fresh: t < 1.005 });
      // a tom's thump: begun on the hit, its pitch falling
      if (t >= 1.0 && t < 1.3) vs.push({ id: 3, hz: 300 * Math.pow(2, -Math.min(0.1, t - 1.0) * 25 / 12), born: 1.0, fresh: t < 1.005 });
      // a note played on the hit, held
      if (t >= 1.0) vs.push({ id: 4, hz: 523, born: 1.0, fresh: t < 1.005 });
      const hits = Math.abs(t - 1.0) < 0.005 ? [{ strength: 0.9, lo: 150, hi: 6000, hz: 1500, noisy: 0.8 }] : [];
      frames.push(frame(t, vs, { hits }));
    }
    const { got, outs } = routeAll(r, frames);
    expect(got.has(1)).toBe(false);
    expect(got.has(2)).toBe(false);
    expect(got.has(3)).toBe(false);
    expect(got.get(4)?.layer).toBe("melody");
    // the hit itself is the drums' (heard in their own stem): it is not thrown again here
    expect(outs.reduce((n, o) => n + Object.values(o).reduce((m, f) => m + f!.hits.length, 0), 0)).toBe(0);
  });

  it("a tone the split's bass band shares with the stem above is the bass's, where it is louder", () => {
    const r = new VoiceRouter({ fog: "other", delay: 0 });
    r.beside(0, [{ hz: 165, amp: 0.8, born: 0, shared: true }]);
    const out = r.route(frame(0, [{ id: 1, hz: 165.5, amp: 0.5, born: 0 }, { id: 2, hz: 660, amp: 0.5, born: 0.3 }]));
    const voices = Object.values(out).flatMap((f) => f!.voices.map((v) => v.id));
    expect(voices).not.toContain(1);
    expect(voices).toContain(2);
  });

  it("a tone that has ended is let go of", () => {
    const r = new VoiceRouter({ delay: 0 });
    r.route(frame(0, [{ id: 1, hz: 500 }]));
    const out = r.route(frame(0.1, [], { ended: [1] }));
    expect(out.melody?.ended).toEqual([1]);
  });
});
