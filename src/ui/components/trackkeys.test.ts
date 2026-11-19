import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrackKeys } from "./SynthKeys";
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
