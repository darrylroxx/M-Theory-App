import { describe, expect, it } from "vitest";
import { NOISE_BANDS, type Frame, type Voice } from "./ear";
import { VoiceRouter, isOvertone } from "./route";
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

  it("a tone that has ended is let go of", () => {
    const r = new VoiceRouter({ delay: 0 });
    r.route(frame(0, [{ id: 1, hz: 500 }]));
    const out = r.route(frame(0.1, [], { ended: [1] }));
    expect(out.melody?.ended).toEqual([1]);
  });
});
