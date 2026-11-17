import { describe, expect, it } from "vitest";
import { audible, gainOf, reviveMix } from "./mix";

describe("the mixer", () => {
  it("a track is at full level unless it is turned down", () => {
    expect(gainOf(undefined, "chords")).toBe(1);
    expect(gainOf({ drums: { db: -6 } }, "drums")).toBeCloseTo(0.501, 3);
    expect(gainOf({ drums: { db: 6 } }, "drums")).toBeCloseTo(1.995, 3);
    expect(gainOf({ drums: { db: -60 } }, "drums")).toBe(0);
    expect(gainOf({ drums: { db: 40 } }, "drums")).toBeCloseTo(1.995, 3);
  });
  it("mute silences a track; solo silences every track that is not soloed", () => {
    expect(audible({ melody: { mute: true } }, "melody")).toBe(false);
    expect(audible({ melody: { mute: true } }, "chords")).toBe(true);
    const solo = { drums: { solo: true } };
    expect(audible(solo, "drums")).toBe(true);
    expect(audible(solo, "chords")).toBe(false);
    expect(gainOf(solo, "melody")).toBe(0);
    // a muted track stays muted even when soloed
    expect(audible({ drums: { solo: true, mute: true } }, "drums")).toBe(false);
    // a solo on an added track counts too
    expect(audible({ t9: { solo: true } }, "chords")).toBe(false);
    expect(audible({ t9: { solo: true } }, "t9")).toBe(true);
  });
  it("a stored mix is made safe; a mix with nothing set is no mix", () => {
    expect(reviveMix(undefined)).toBeUndefined();
    expect(reviveMix({ chords: { db: 0 } })).toBeUndefined();
    expect(reviveMix({ chords: { db: -3.04, mute: 1 }, junk: 4, drums: { db: "x", solo: true } })).toEqual({ chords: { db: -3, mute: true }, drums: { solo: true } });
    // tracks added on the Track page have strips of their own
    expect(reviveMix({ t1: { db: -6 } })).toEqual({ t1: { db: -6 } });
    expect(reviveMix({ melody: { db: -500 } })).toEqual({ melody: { db: -60 } });
  });
});
