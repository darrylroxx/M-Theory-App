import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrackKeys, computerKey, lowest } from "./SynthKeys";
import type { Tone } from "../../audio/tone";

const keys = (chords: Tone, melody: Tone) => renderToStaticMarkup(createElement(TrackKeys, { chords, melody }));

describe("keys on a page with no instrument of its own (the Canvas)", () => {
  it("are there for a track on the piano or the synth, so notes played by hand can be painted", () => {
    expect(keys({ inst: "piano" }, { inst: "guitar" })).toContain("data-midi");
    expect(keys({ inst: "guitar" }, { inst: "synth" })).toContain("data-midi");
  });
  it("are not there when both tracks are on the strings", () => {
    expect(keys({ inst: "guitar" }, { inst: "guitar" })).toBe("");
  });
});

describe("the keys played from the computer keyboard", () => {
  const ev = (key: string, mods: { ctrlKey?: boolean; repeat?: boolean } = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...mods });
  it("a key let go with Ctrl held by then still lets its note go", () => {
    expect(computerKey(ev("a"), true, 48, 72)).toEqual({ kind: "press", midi: 48 });
    expect(computerKey(ev("a", { ctrlKey: true }), false, 48, 72)).toEqual({ kind: "lift", midi: 48 });
    // (Ctrl with a key going down is the page's: Ctrl+Z still undoes)
    expect(computerKey(ev("a", { ctrlKey: true }), true, 48, 72)).toBeNull();
    expect(computerKey(ev("z", { ctrlKey: true }), true, 48, 72)).toBeNull();
  });
  it("plays only the keys that are shown", () => {
    // one octave: C to C, so the keys past the top C (o, l, p, ;) play nothing
    expect(computerKey(ev("k"), true, 48, 60)).toEqual({ kind: "press", midi: 60 });
    expect(computerKey(ev("o"), true, 48, 60)).toEqual({ kind: "eat" });
  });
  it("more octaves fitting after a move up bring the keys down rather than past the top", () => {
    expect(lowest(84, 1)).toBe(84);
    expect(lowest(84, 3)).toBe(60);
    expect(lowest(12, 2)).toBe(24);
  });
});
