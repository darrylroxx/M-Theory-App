import { describe, expect, it } from "vitest";
import { chordShape } from "../guitar/arrange";
import { getTuning } from "../guitar/tunings";
import type { ChordRef } from "../theory/chords";
import type { ArrangeSettings, ProgChord } from "../ui/state";
import { voicingsFor, type VoicingCtx } from "./voicing";

const tuning = getTuning("standard");
/** a guitar in standard tuning with no capo; each chord's own shape is the easiest one (or the one its spot names) */
const ctx: VoicingCtx = { tuning, capo: 0, avoidBarre: true, shapeOf: (ref: ChordRef, voicingId?: string) => chordShape(ref, tuning, 0, true, voicingId) };
let n = 0;
const chord = (root: string, typeId = "maj", o: Partial<ProgChord> = {}): ProgChord => ({ id: `c${++n}`, ref: { root, typeId }, beats: 4, ...o });
const rest = (): ProgChord => ({ ...chord("C"), rest: true });
const sounding = (v: { midi: (number | null)[] } | undefined) => v?.midi.filter((m): m is number => m !== null);
const AREA: ArrangeSettings = { zone: 2, strings: "any", inversions: false };

describe("the shapes a track's chords play on the guitar", () => {
  it("with no Arrange, every chord has its own shape", () => {
    const cs = [chord("C"), chord("G"), chord("A", "min")];
    const vs = voicingsFor(ctx)(cs, null);
    expect(vs).toHaveLength(3);
    cs.forEach((c, i) => {
      expect(vs[i]).toBeDefined();
      expect(vs[i]).toEqual(ctx.shapeOf(c.ref));
    });
  });

  it("a rest gets no shape and the chords either side keep theirs", () => {
    const c = chord("C");
    const g = chord("G");
    const of = voicingsFor(ctx);
    const vs = of([c, rest(), g], null);
    expect(vs).toHaveLength(3);
    expect(vs[1]).toBeUndefined();
    expect(vs[0]).toEqual(ctx.shapeOf(c.ref));
    expect(vs[2]).toEqual(ctx.shapeOf(g.ref));
    // arranged, the two are neighbours: they get the shapes they get with no rest between them
    const together = of([c, g], AREA);
    const apart = of([c, rest(), g], AREA);
    expect(apart[1]).toBeUndefined();
    expect([apart[0], apart[2]]).toEqual(together);
  });

  it("with Arrange set there is one entry per chord, rests included", () => {
    const cs = [chord("C"), chord("G"), rest(), chord("A", "min"), chord("F")];
    const vs = voicingsFor(ctx)(cs, AREA);
    expect(vs).toHaveLength(cs.length);
    expect(vs.map((v) => !!v)).toEqual([true, true, false, true, true]);
    // the same chords, the same area: the same shapes
    expect(voicingsFor(ctx)(cs, AREA)).toEqual(vs);
  });

  it("a shape set by hand stays put when the rest are arranged round it", () => {
    const own = ctx.shapeOf({ root: "G", typeId: "maj" })!;
    const cs = [chord("C"), chord("G", "maj", { voicingId: own.id }), chord("A", "min")];
    const high: ArrangeSettings = { zone: 3, strings: "any", inversions: false };
    const vs = voicingsFor(ctx)(cs, high);
    expect(vs[1]?.id).toBe(own.id);
    // (left free, that chord moves up the neck with the others)
    const free = voicingsFor(ctx)(cs.map((c) => ({ ...c, voicingId: undefined })), high);
    expect(free[1]?.id).not.toBe(own.id);
  });

  it("a chord with written notes gets the shape that plays exactly those notes, where a hand can", () => {
    // C E G from middle C
    const written = chord("C", "maj", { notes: [60, 64, 67] });
    const of = voicingsFor(ctx);
    for (const a of [null, AREA]) {
      const [v, g] = of([written, chord("G")], a);
      expect(sounding(v)).toEqual([60, 64, 67]);
      expect(g).toBeDefined();
    }
    // notes no hand can reach (the lowest E and one four octaves up): the chord keeps its own shape
    const far = chord("C", "maj", { notes: [40, 88] });
    expect(of([far], null)[0]).toEqual(ctx.shapeOf(far.ref));
    // notes that are not the chord's are not played as written
    const wrong = chord("C", "maj", { notes: [61, 65, 68] });
    expect(of([wrong], null)[0]).toEqual(ctx.shapeOf(wrong.ref));
  });
});
