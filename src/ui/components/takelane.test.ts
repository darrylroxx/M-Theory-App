import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TakeLane } from "./TakeLane";
import type { Take } from "../../song/takes";

const take: Take = { id: "t1", n: 1, group: "g1", dry: "a.wav", wet: "b.wav", rate: 48000, start: 0, frames: 48000 * 4, at: { block: "a", bar: 0 } } as Take;
const lane = (onPick?: (t: Take) => void) =>
  renderToStaticMarkup(createElement(TakeLane, { bars: [{ block: "a", bar: 0, letter: "A", beats: 4 }, { block: "a", bar: 1, letter: "A", beats: 4 }], takes: [{ take, label: "Take 1" }], bpm: 120, where: () => null, live: false, onPick, shown: 0, follow: false }));

describe("the Vocals lane", () => {
  it("offers a take to be heard alone only where it can be (the desktop app)", () => {
    expect(lane(() => {})).toContain("hear it alone");
    // in the browser a take is only shown: no button that promises sound and makes none
    const html = lane();
    expect(html).toContain("Take 1");
    expect(html).not.toMatch(/hear it alone/i);
    expect(html).not.toContain('<button class="tl-take');
  });
});
