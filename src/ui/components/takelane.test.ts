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
const lefts = (html: string) => [...html.matchAll(/left:(-?[\d.]+)%;width:([\d.]+)%/g)].map((m) => [Number(m[1]), Number(m[2])]);

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

describe("a take sung in other bars that plays in these", () => {
  // the song: A (two bars of 4/4), then B (two bars of 6/8: two beats a bar); the lane is B
  const song = [
    { block: "a", bar: 0, letter: "A", beats: 4 }, { block: "a", bar: 1, letter: "A", beats: 4 },
    { block: "b", bar: 0, letter: "B", beats: 2 }, { block: "b", bar: 1, letter: "B", beats: 2 },
  ];
  const laneB = song.slice(2);
  /** a take sung from A's second bar, `s` seconds long (at 120 bpm a beat is half a second) */
  const sung = (s: number, at = { block: "a", bar: 1 }, o: { from?: number; move?: number } = {}) => {
    const t = { ...take, frames: 48000 * s, at } as Take;
    return renderToStaticMarkup(createElement(TakeLane, { bars: laneB, song, rows: [{ group: "g1", label: "● 1", clips: [{ clip: { id: "c", take: "t1", from: o.from ?? 0, to: 48000 * s, move: o.move }, take: t }] }], bpm: 120, where: () => null, live: false, edit, shown: 0, follow: false }));
  };

  it("is drawn on the lane where it plays (from before its start), so it can be edited there", () => {
    // 3 s from A's second bar: 2 s in A, then a second (two beats, B's first bar) in B
    expect(lefts(sung(3))).toEqual([[-100, 150]]);
    expect(sung(3)).toContain('data-edge="to"');
    // its start trimmed off past A's end: it plays only in B, from B's start
    expect(lefts(sung(3, undefined, { from: 48000 * 2 }))).toEqual([[0, 50]]);
  });

  it("is not on the lane when it ends before it, or starts after it, or its bar is gone", () => {
    expect(lefts(sung(2))).toEqual([]);
    expect(lefts(sung(1, { block: "a", bar: 0 }))).toEqual([]);
    expect(lefts(sung(3, { block: "x", bar: 0 }))).toEqual([]);
    // without the song, only the takes sung in these bars are known
    const t = { ...take, frames: 48000 * 3, at: { block: "a", bar: 1 } } as Take;
    expect(lefts(renderToStaticMarkup(createElement(TakeLane, { bars: laneB, rows: [{ group: "g1", label: "● 1", clips: [{ clip: { id: "c", take: "t1", from: 0, to: 48000 * 3 }, take: t }] }], bpm: 120, where: () => null, live: false, shown: 0, follow: false })))).toEqual([]);
  });
});
