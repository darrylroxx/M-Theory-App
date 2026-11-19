import { describe, expect, it } from "vitest";
import { BANDS } from "./describe";
import { FakeAudio } from "./fakectx";
import { hasStem, readStem, tapStem, untapStem } from "./stems";

/** A track's way out, whose tap hears a steady level in every bin. */
function track(c: FakeAudio, db: number) {
  const out = c.createGain();
  return { out, db };
}
function tap(c: FakeAudio, stem: "drums" | "chords", id: string, db: number) {
  const t = track(c, db);
  tapStem(stem, t.out as unknown as AudioNode, id);
  const node = c.nodes.at(-1) as unknown as { getFloatFrequencyData: (a: Float32Array) => void };
  node.getFloatFrequencyData = (a) => a.fill(db);
  return t;
}
const total = (a: Float32Array) => a.reduce((s, x) => s + x, 0);

describe("the canvas's guide hears every track", () => {
  it("adds a second drums track to the drums it reads, and drops it when it goes", () => {
    const c = new FakeAudio();
    const out = new Float32Array(BANDS);
    tap(c, "drums", "drums", -30);
    readStem("drums", out);
    const one = total(out);
    expect(one).toBeGreaterThan(0);
    tap(c, "drums", "t-drums-2", -30);
    readStem("drums", out);
    expect(total(out)).toBeCloseTo(2 * one, 6);
    untapStem("t-drums-2");
    readStem("drums", out);
    expect(total(out)).toBeCloseTo(one, 6);
    untapStem("drums");
    expect(hasStem("drums")).toBe(false);
    expect(readStem("drums", out)).toBe(false);
    expect(total(out)).toBe(0);
  });

  it("keeps each kind apart", () => {
    const c = new FakeAudio();
    const out = new Float32Array(BANDS);
    tap(c, "chords", "t-chords-2", -20);
    readStem("drums", out);
    expect(total(out)).toBe(0);
    readStem("chords", out);
    expect(total(out)).toBeGreaterThan(0);
    untapStem("t-chords-2");
  });
});
