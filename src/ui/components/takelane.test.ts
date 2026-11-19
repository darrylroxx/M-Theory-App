import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TakeLane, type LaneEdit } from "./TakeLane";
import type { Take } from "../../song/takes";

const take: Take = { id: "t1", n: 1, group: "g1", dry: "a.wav", wet: "b.wav", rate: 48000, start: 0, frames: 48000 * 4, at: { block: "a", bar: 0 } } as Take;
const bars = [{ block: "a", bar: 0, letter: "A", beats: 4 }, { block: "a", bar: 1, letter: "A", beats: 4 }];
const edit: LaneEdit = { selected: null, onSelect: () => {}, cut: false, snap: true, onTrim: () => {}, onMove: () => {}, onSplit: () => {}, onDelete: () => {}, keys: false };
const lane = (clips: { from: number; to: number; move?: number }[], e?: LaneEdit) =>
  renderToStaticMarkup(createElement(TakeLane, { bars, rows: [{ group: "g1", label: "● 1", clips: clips.map((c, i) => ({ clip: { id: `c${i}`, take: "t1", ...c }, take })) }], bpm: 120, where: () => null, live: false, edit: e, shown: 0, follow: false }));
const lefts = (html: string) => [...html.matchAll(/left:([\d.]+)%;width:([\d.]+)%/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe("the Vocals lane", () => {
  it("draws each clip where it plays: a trim leaves the rest in place, a move moves it", () => {
    // 4 s at 120 bpm is the two bars: the whole take is the whole lane
    expect(lefts(lane([{ from: 0, to: 48000 * 4 }]))).toEqual([[0, 100]]);
    // the first half second trimmed off: the rest starts a beat in (an eighth of the lane), where it was
    expect(lefts(lane([{ from: 24000, to: 48000 * 4 }]))).toEqual([[12.5, 87.5]]);
    // two pieces, the second moved a beat later
    expect(lefts(lane([{ from: 0, to: 48000 }, { from: 48000, to: 96000, move: 24000 }]))).toEqual([[0, 25], [37.5, 25]]);
  });

  it("offers edge handles only where clips can be edited", () => {
    const shown = lane([{ from: 0, to: 48000 }]);
    expect(shown).toContain("● 1 · 1");
    expect(shown).not.toContain("tl-grip");
    expect(shown).not.toContain('role="button"');
    const editing = lane([{ from: 0, to: 48000 }], edit);
    expect(editing).toContain('data-edge="from"');
    expect(editing).toContain('data-edge="to"');
    expect(editing).toContain('role="button"');
  });
});
