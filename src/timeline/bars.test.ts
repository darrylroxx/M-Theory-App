import { describe, expect, it } from "vitest";
import { barMap, ceilBar, onBarLine } from "./bars";
import { SIG34, SIG44, SIG68 } from "./testsongs";

/** 4/4 for 8 bars, 6/8 for 4 bars, then 4/4 again */
const mixed = { meter: SIG44, sigs: [{ bar: 8, sig: SIG68 }, { bar: 12, sig: SIG44 }] };

describe("the bar map: where every bar line of a song lies", () => {
  it("a song in one signature: every bar is as long as the first", () => {
    const m = barMap({ meter: SIG34 });
    expect(m.beatOfBar(0)).toBe(0);
    expect(m.beatOfBar(5)).toBe(15);
    expect(m.barAt(7)).toEqual({ bar: 2, beat: 1, sig: SIG34 });
    expect(m.sigAt(100)).toEqual(SIG34);
    expect(m.snapBar(4)).toBe(3);
    expect(m.snapBar(5)).toBe(6);
    expect(m.floorBar(5.9)).toBe(3);
    expect(m.snapBeat(5.4)).toBe(5);
    expect(m.lines(0, 9)).toEqual([{ beat: 0, bar: 0 }, { beat: 3, bar: 1 }, { beat: 6, bar: 2 }]);
  });

  it("an empty list of changes is the same as none", () => {
    const m = barMap({ meter: SIG44, sigs: [] });
    expect(m.beatOfBar(3)).toBe(12);
    expect(m.barAt(13)).toEqual({ bar: 3, beat: 1, sig: SIG44 });
  });

  it("where each bar starts when the signature changes at bar 9 and again at bar 13", () => {
    const m = barMap(mixed);
    expect(m.beatOfBar(0)).toBe(0);
    expect(m.beatOfBar(7)).toBe(28);
    expect(m.beatOfBar(8)).toBe(32);
    // the four bars of 6/8 are two beats each
    expect(m.beatOfBar(9)).toBe(34);
    expect(m.beatOfBar(12)).toBe(40);
    expect(m.beatOfBar(13)).toBe(44);
  });

  it("which bar a beat is in, and how far into it", () => {
    const m = barMap(mixed);
    expect(m.barAt(0)).toEqual({ bar: 0, beat: 0, sig: SIG44 });
    expect(m.barAt(31.5)).toEqual({ bar: 7, beat: 3.5, sig: SIG44 });
    expect(m.barAt(32)).toEqual({ bar: 8, beat: 0, sig: SIG68 });
    expect(m.barAt(33)).toEqual({ bar: 8, beat: 1, sig: SIG68 });
    expect(m.barAt(35)).toEqual({ bar: 9, beat: 1, sig: SIG68 });
    expect(m.barAt(40)).toEqual({ bar: 12, beat: 0, sig: SIG44 });
    expect(m.barAt(47)).toEqual({ bar: 13, beat: 3, sig: SIG44 });
    // before the song starts counts as its start
    expect(m.barAt(-2)).toEqual({ bar: 0, beat: 0, sig: SIG44 });
  });

  it("the signature at a beat", () => {
    const m = barMap(mixed);
    expect(m.sigAt(31.99)).toEqual(SIG44);
    expect(m.sigAt(32)).toEqual(SIG68);
    expect(m.sigAt(39.9)).toEqual(SIG68);
    expect(m.sigAt(40)).toEqual(SIG44);
  });

  it("the bar lines between two beats: the first beat included, the second not", () => {
    const m = barMap(mixed);
    expect(m.lines(28, 44)).toEqual([
      { beat: 28, bar: 7 }, { beat: 32, bar: 8 }, { beat: 34, bar: 9 }, { beat: 36, bar: 10 }, { beat: 38, bar: 11 }, { beat: 40, bar: 12 },
    ]);
    expect(m.lines(29, 33)).toEqual([{ beat: 32, bar: 8 }]);
    expect(m.lines(33, 33.5)).toEqual([]);
    expect(m.lines(-10, 5)).toEqual([{ beat: 0, bar: 0 }, { beat: 4, bar: 1 }]);
  });

  it("snapping to the nearest bar line, on both sides of a change", () => {
    const m = barMap(mixed);
    // in 4/4, before the change
    expect(m.snapBar(29)).toBe(28);
    expect(m.snapBar(30)).toBe(32);
    expect(m.snapBar(31)).toBe(32);
    // in 6/8: lines every two beats
    expect(m.snapBar(32.9)).toBe(32);
    expect(m.snapBar(33)).toBe(34);
    expect(m.snapBar(39.2)).toBe(40);
    // back in 4/4
    expect(m.snapBar(41.9)).toBe(40);
    expect(m.snapBar(42)).toBe(44);
    expect(m.snapBar(-3)).toBe(0);
  });

  it("the bar line at or before a beat, and the one at or after", () => {
    const m = barMap(mixed);
    expect(m.floorBar(31.9)).toBe(28);
    expect(m.floorBar(32)).toBe(32);
    expect(m.floorBar(33.9)).toBe(32);
    expect(m.floorBar(39)).toBe(38);
    expect(m.floorBar(43.5)).toBe(40);
    expect(ceilBar(m, 32)).toBe(32);
    expect(ceilBar(m, 32.1)).toBe(34);
    expect(ceilBar(m, 40.5)).toBe(44);
    expect(ceilBar(m, 0)).toBe(0);
    expect(onBarLine(m, 34)).toBe(true);
    expect(onBarLine(m, 35)).toBe(false);
    expect(onBarLine(m, 42)).toBe(false);
  });

  it("snapping to the nearest beat is the same everywhere (a bar line is always on a whole beat)", () => {
    const m = barMap(mixed);
    expect(m.snapBeat(31.4)).toBe(31);
    expect(m.snapBeat(32.5)).toBe(33);
    expect(m.snapBeat(38.6)).toBe(39);
    expect(m.snapBeat(-0.7)).toBe(0);
  });

  it("a beat that arithmetic left a hair short of a bar line is on it", () => {
    const m = barMap(mixed);
    expect(m.barAt(32 - 1e-12).bar).toBe(8);
    expect(m.floorBar(40 - 1e-12)).toBe(40);
  });

  it("changes out of order are sorted, and a change that is not after bar 1 is left out", () => {
    const m = barMap({ meter: SIG44, sigs: [{ bar: 12, sig: SIG44 }, { bar: 8, sig: SIG68 }, { bar: 0, sig: SIG34 }] });
    expect(m.beatOfBar(12)).toBe(40);
    expect(m.sigAt(0)).toEqual(SIG44);
  });

  it("the same map comes back while the song's signatures are the same objects", () => {
    expect(barMap(mixed)).toBe(barMap({ ...mixed }));
    expect(barMap(mixed)).not.toBe(barMap({ ...mixed, sigs: [...mixed.sigs] }));
    expect(barMap({ meter: SIG44 })).toBe(barMap({ meter: SIG44 }));
  });
});
