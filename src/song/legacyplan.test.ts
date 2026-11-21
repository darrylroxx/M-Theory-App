import { describe, expect, it } from "vitest";
import { DEFAULT_BEAT, type Beat } from "../audio/beats";
import type { PlayItem } from "../audio/patterns";
import { chordShape } from "../guitar/arrange";
import { getTuning } from "../guitar/tunings";
import type { ChordRef } from "../theory/chords";
import type { VoicingCtx } from "../timeline/voicing";
import type { ProgChord, Progression } from "../ui/state";
import { frameBeats } from "./frame";
import { legacyPlan, legacySlice } from "./legacyplan";
import { sigBeats } from "./meter";
import { addNewSection, ensureSong, repeatSection, sections, selectBlock } from "./structure";
import type { Take } from "./takes";
import { setSectionSig, sigOf } from "./unity";

const tuning = getTuning("standard");
const ctx: VoicingCtx = { tuning, capo: 0, avoidBarre: true, shapeOf: (ref: ChordRef, voicingId?: string) => chordShape(ref, tuning, 0, true, voicingId) };
/** no recordings are loaded */
const none = () => undefined;

let n = 0;
const id = () => `id${++n}`;
const chord = (root: string, beats = 4): ProgChord => ({ id: root + ++n, ref: { root, typeId: "maj" }, beats });
const mel = (notes: [number, number][]) => ({ div: 2 as const, bars: 2, notes: notes.map(([at, midi]) => ({ at, midi })) });
const ROWS = { kick: "3000300030003000", snare: "0000300000003000", hat: "2020202020202020" } as Beat["rows"];
const drums = (): Beat => ({ ...DEFAULT_BEAT, on: true, rows: { ...DEFAULT_BEAT.rows, ...ROWS } });
const sum = (items: { beats: number }[]) => items.reduce((a, x) => a + x.beats, 0);

/** A song with no sections: four bars of 4/4, two of them with chords, a melody and drums. */
function plain(): Progression {
  return { chords: [chord("C"), chord("G")], melody: mel([[0, 64], [4, 67]]), bpm: 100, pattern: "ring", loop: true, bars: 4, meter: { num: 4, den: 4 }, beat: drums(), v: 4 };
}
/** Sections A, B and C and then A again: A's chords fill its four bars, B's two bars hold one chord, C has no chords at all. */
function three(): Progression {
  let p: Progression = { ...plain(), chords: [chord("C"), chord("G"), chord("A"), chord("F")] };
  p = ensureSong(p, id);
  const partA = p.song!.blocks[0].partId;
  p = addNewSection(p, id);
  p = { ...p, chords: [chord("D")], melody: mel([[0, 69]]), bars: 2 };
  p = addNewSection(p, id);
  p = { ...p, chords: [], melody: undefined, bars: 1 };
  p = repeatSection(p, partA, id);
  return selectBlock(p, p.song!.blocks[0].id);
}
/** Two sections of four bars; the second is in 6/8. */
function withSixEight(): Progression {
  let p: Progression = { ...plain(), chords: [chord("C"), chord("G"), chord("A"), chord("F")] };
  p = ensureSong(p, id);
  p = addNewSection(p, id);
  p = { ...p, chords: [chord("E"), chord("A")], bars: 4 };
  p = setSectionSig(p, p.song!.blocks[1].id, { num: 6, den: 8 });
  return selectBlock(p, p.song!.blocks[0].id);
}
/** how long each section of a song is, in beats (a song with no sections is one section) */
function sectionBeats(p: Progression): number[] {
  const secs = sections(p);
  if (!secs.length) return [frameBeats(p.bars, sigBeats(sigOf(p)))];
  return secs.map((s) => frameBeats(s.bars, sigBeats(s.meter ?? sigOf(p))));
}
/** the items, cut into sections at each item marked as a section's first */
function bySection(items: PlayItem[]): PlayItem[][] {
  const out: PlayItem[][] = [];
  for (const it of items) {
    if (it.section) out.push([]);
    out[out.length - 1].push(it);
  }
  return out;
}

const SONGS: [string, () => Progression, number[]][] = [
  ["a song with no sections", plain, [16]],
  ["three sections and a repeat", three, [16, 8, 4, 16]],
  ["a song with a 6/8 section", withSixEight, [16, 8]],
];

describe("the old view's plan of a song, as a plain function", () => {
  for (const [name, make, beats] of SONGS) {
    describe(name, () => {
      const p = make();
      const plan = legacyPlan(p, ctx, none);

      it("the items' beats add up to the sum of the sections' beats", () => {
        expect(sectionBeats(p)).toEqual(beats);
        expect(sum(plan.items)).toBeCloseTo(sum(beats.map((b) => ({ beats: b }))), 9);
        expect(plan.per.map((x) => sum(x.items))).toEqual(beats);
        expect(plan.per.map((x) => x.bars * x.bar)).toEqual(beats);
      });

      it("the first item of each section, and no other, is marked as a section's first", () => {
        expect(plan.per.every((x) => x.items[0].section === true)).toBe(true);
        expect(plan.items.filter((x) => x.section)).toHaveLength(beats.length);
        expect(bySection(plan.items).map(sum)).toEqual(beats);
        expect(plan.items).toEqual(plan.per.flatMap((x) => x.items));
      });

      it("the map has one entry per item: its section and which chord it is", () => {
        expect(plan.map).toHaveLength(plan.items.length);
        expect(plan.map).toEqual(plan.per.flatMap((x) => x.idx.map((idx) => ({ block: x.block, idx }))));
        // a chord is its place in its section's chords; what fills a section out is none (−1)
        plan.items.forEach((it, i) => expect(plan.map[i].idx === -1).toBe(!!it.pad));
      });

      it("the same song twice gives the same plan", () => {
        expect(legacyPlan(p, ctx, none)).toEqual(plan);
        expect(legacyPlan(make(), ctx, none).items.map((x) => [x.beats, x.midi, !!x.pad, !!x.section])).toEqual(plan.items.map((x) => [x.beats, x.midi, !!x.pad, !!x.section]));
      });

      it("there is something to hear", () => {
        expect(plan.any).toBe(true);
      });
    });
  }

  it("a section whose chords end early ends in one item that fills it out", () => {
    // no sections: two chords in four bars
    const a = legacyPlan(plain(), ctx, none);
    expect(a.items.map((x) => [x.beats, !!x.pad])).toEqual([[4, false], [4, false], [8, true]]);
    expect(a.items[2].midi).toEqual([]);
    expect(a.map.map((m) => m.idx)).toEqual([0, 1, -1]);
    // three sections and a repeat: A is full, B is one chord in two bars, C is one bar with no chords
    const b = legacyPlan(three(), ctx, none);
    expect(b.per.map((x) => x.items.map((it) => [it.beats, !!it.pad]))).toEqual([
      [[4, false], [4, false], [4, false], [4, false]],
      [[4, false], [4, true]],
      [[4, true]],
      [[4, false], [4, false], [4, false], [4, false]],
    ]);
    // (a section with no chords: its one item is both its first and what fills it out)
    expect(b.per[2].items[0].section).toBe(true);
    for (const x of b.per) expect(x.items.filter((it) => it.pad).length).toBeLessThanOrEqual(1);
  });

  it("a repeat plays the same music as the section it repeats, under its own place in the song", () => {
    const plan = legacyPlan(three(), ctx, none);
    const [a, , , again] = plan.per;
    expect(again.partId).toBe(a.partId);
    expect(again.block).not.toBe(a.block);
    expect(again.items.map((x) => x.midi)).toEqual(a.items.map((x) => x.midi));
    expect(a.items[0].midi.length).toBeGreaterThan(0);
  });

  it("a 6/8 section plays in its own bar: two beats of three, counted in triplets", () => {
    const plan = legacyPlan(withSixEight(), ctx, none);
    expect(plan.per.map((x) => [x.bars, x.bar])).toEqual([[4, 4], [4, 2]]);
    expect(plan.per[0].items[0].meter).toEqual({ bar: 4, triplet: false, sig: { num: 4, den: 4 } });
    expect(plan.per[1].items[0].meter).toEqual({ bar: 2, triplet: true, sig: { num: 6, den: 8 } });
  });

  it("an empty song has nothing to hear, and still one bar-long section", () => {
    const plan = legacyPlan({ chords: [], bpm: 84, pattern: "ring", loop: true, bars: 1, meter: { num: 4, den: 4 }, v: 4 }, ctx, none);
    expect(plan.any).toBe(false);
    expect(plan.items.map((x) => [x.beats, !!x.pad, !!x.section])).toEqual([[4, true, true]]);
  });

  it("a recording plays where the caller has its sound, on its own track", () => {
    const take: Take = { id: "t1", n: 1, group: "g1", dry: "d.wav", wet: "w.wav", rate: 48000, start: 0, frames: 48000, at: { block: "", bar: 1 } };
    const p: Progression = { ...plain(), tracks: [{ id: "v1", kind: "vocals", name: "Vocals", takes: [take] }] };
    const sound = { duration: 1 } as AudioBuffer;
    const asked: string[] = [];
    const plan = legacyPlan(p, ctx, (t) => {
      asked.push(t.id);
      return sound;
    });
    expect(asked).toEqual(["t1"]);
    const takes = plan.items[0].extra?.takes;
    expect(takes).toHaveLength(1);
    expect(takes![0]).toMatchObject({ track: "v1", at: 4, offset: 0, dur: 1 });
    expect(takes![0].buffer).toBe(sound);
    // not loaded yet: the song plays without it
    expect(legacyPlan(p, ctx, none).items[0].extra?.takes).toBeUndefined();
  });
});

describe("the bars of a loop, cut out of the plan", () => {
  it("bars 3 to 6 of a two-section song: four bars, the first item saying how far into its section it starts", () => {
    let p: Progression = { ...plain(), chords: [chord("C"), chord("G"), chord("A"), chord("F")] };
    p = ensureSong(p, id);
    p = addNewSection(p, id);
    p = { ...p, chords: [chord("D", 8), chord("E", 8)], bars: 4 };
    const [a, b] = p.song!.blocks.map((x) => x.id);
    const plan = legacyPlan(p, ctx, none);
    expect(plan.per.map((x) => x.bars)).toEqual([4, 4]);
    // bars 3 and 4 of the first section, bars 1 and 2 of the second (bars are counted from 0 in a section)
    const cut = legacySlice(plan.per, { from: { block: a, bar: 2 }, to: { block: b, bar: 1 } });
    expect(cut.loop).toBe(true);
    expect(sum(cut.items)).toBe(16);
    expect(cut.items[0].from).toBe(8);
    expect(cut.items.map((x) => [x.beats, x.from, !!x.section])).toEqual([[4, 8, true], [4, 12, false], [8, 0, true]]);
    expect(cut.map).toEqual([{ block: a, idx: 2 }, { block: a, idx: 3 }, { block: b, idx: 0 }]);
    // the plan itself is not changed by cutting from it
    expect(plan).toEqual(legacyPlan(p, ctx, none));
  });

  it("a cut through the middle of a chord gives the part of it inside the loop", () => {
    let p: Progression = { ...plain(), chords: [chord("C", 8), chord("G", 8)] };
    p = ensureSong(p, id);
    const a = p.song!.blocks[0].id;
    const plan = legacyPlan(p, ctx, none);
    // bar 2 alone: the second half of the first chord
    const cut = legacySlice(plan.per, { from: { block: a, bar: 1 }, to: { block: a, bar: 1 } });
    expect(cut.items.map((x) => [x.beats, x.from])).toEqual([[4, 4]]);
    expect(cut.items[0].midi).toEqual(plan.items[0].midi);
    expect(cut.map).toEqual([{ block: a, idx: 0 }]);
  });
});
