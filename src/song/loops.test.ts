import { describe, expect, it } from "vitest";
import { allBars, allLoop, entryAfter, fitBars, loopKeys, loopRuns, placesOf, sectionBars, sectionLoops, tapBar, toggleSection, type LoopBars } from "./loops";

// A B A C: A has 4 bars, B 2, A again 4, C 3 (the two A's are different places in the song)
const layout = [{ block: "a1", bars: 4 }, { block: "b", bars: 2 }, { block: "a2", bars: 4 }, { block: "c", bars: 3 }];
const bar = (block: string, n: number) => ({ block, bar: n });
const order = layout.map((s) => s.block);
/** toggle sections one after another, starting with nothing looping */
const pick = (...blocks: string[]) => blocks.reduce<LoopBars>((c, b) => toggleSection(layout, c, b), []);
const runsOf = (c: LoopBars) => loopRuns(layout, c).map((r) => `${r.from.block}${r.from.bar}-${r.to.block}${r.to.bar}`);

describe("looping any sections", () => {
  it("nothing chosen: nothing loops", () => {
    expect(loopRuns(layout, [])).toEqual([]);
    expect(loopKeys(layout, []).size).toBe(0);
  });

  it("two sections apart: each its own run, in the song's order, whatever order they were picked in", () => {
    expect(runsOf(pick("c", "b"))).toEqual(["b0-b1", "c0-c2"]);
    expect(runsOf(pick("a1", "c"))).toEqual(["a10-a13", "c0-c2"]);
    // sections next to each other are one run
    expect(runsOf(pick("b", "a2"))).toEqual(["b0-a23"]);
    expect(runsOf(pick("a1", "b", "a2", "c"))).toEqual(["a10-c2"]);
  });

  it("a section picked again comes out of the loop", () => {
    expect(runsOf(toggleSection(layout, pick("b", "c"), "b"))).toEqual(["c0-c2"]);
    expect(toggleSection(layout, pick("b"), "b")).toEqual([]);
  });

  it("the two A's are picked apart", () => {
    const c = pick("a2");
    expect(sectionLoops(layout, c, "a2")).toBe("all");
    expect(sectionLoops(layout, c, "a1")).toBe("none");
  });

  it("a section with only some bars looping is filled out by a pick, then taken out by the next", () => {
    const some = [bar("c", 1)];
    expect(sectionLoops(layout, some, "c")).toBe("some");
    const full = toggleSection(layout, some, "c");
    expect(sectionLoops(layout, full, "c")).toBe("all");
    expect(toggleSection(layout, full, "c")).toEqual([]);
  });

  it("All: every bar of the song", () => {
    expect(allLoop(layout, allBars(layout))).toBe(true);
    expect(allLoop(layout, pick("a1", "b", "a2"))).toBe(false);
    expect(runsOf(allBars(layout))).toEqual(["a10-c2"]);
  });

  it("tapping bars fine-tunes the run they are in, and leaves the others alone", () => {
    const c = pick("a1", "c");
    // the last bar of A comes off
    expect(runsOf(tapBar(layout, c, bar("a1", 3)))).toEqual(["a10-a12", "c0-c2"]);
    // a bar in the middle of C becomes the whole of that run
    expect(runsOf(tapBar(layout, c, bar("c", 1)))).toEqual(["a10-a13", "c1-c1"]);
    // a bar outside: the nearest run grows to it (the one before it, when both are as near)
    expect(runsOf(tapBar(layout, c, bar("b", 0)))).toEqual(["a10-b0", "c0-c2"]);
    expect(runsOf(tapBar(layout, c, bar("a2", 3)))).toEqual(["a10-a13", "a23-c2"]);
    // and when it reaches the other run, they are one
    const grown = [bar("a2", 0), bar("a2", 2), bar("a2", 3)].reduce((x, b) => tapBar(layout, x, b), c);
    expect(runsOf(grown)).toEqual(["a10-c2"]);
  });

  it("tapping bars with nothing looping starts a loop, as before", () => {
    expect(tapBar(layout, [], bar("b", 1))).toEqual([bar("b", 1)]);
    expect(runsOf(tapBar(layout, [bar("b", 1)], bar("c", 0)))).toEqual(["b1-c0"]);
    expect(tapBar(layout, [bar("b", 1)], bar("b", 1))).toEqual([]);
  });

  it("keeps up with the song: removed sections and bars past a section's end are let go, moved sections play in their new order", () => {
    const c = pick("b", "c");
    // B removed, C cut to 2 bars
    expect(fitBars([{ block: "a1", bars: 4 }, { block: "c", bars: 2 }], c)).toEqual([bar("c", 0), bar("c", 1)]);
    const moved = [{ block: "c", bars: 3 }, { block: "a1", bars: 4 }, { block: "b", bars: 2 }];
    expect(loopRuns(moved, c).map((r) => r.from.block)).toEqual(["c", "b"]);
    expect(sectionBars(layout, "gone")).toEqual([]);
  });
});

describe("where a changed loop goes on", () => {
  // a play list for some runs of the song: an item a bar long, each saying how far into its section it starts
  const BAR: Record<string, number> = { a1: 4, b: 3, a2: 4, c: 3 };
  const list = (...blocks: string[]) => {
    const items: { beats: number; from: number }[] = [];
    const map: { block: string }[] = [];
    for (const b of blocks) for (let k = 0; k < layout.find((s) => s.block === b)!.bars; k++) {
      items.push({ beats: BAR[b], from: k * BAR[b] });
      map.push({ block: b });
    }
    return { items, map };
  };
  /** the whole song, as it plays straight through (items do not say where they start) */
  const song = () => {
    const l = list(...order);
    return { items: l.items.map((x) => ({ beats: x.beats })), map: l.map };
  };

  it("knows where every item is in the song", () => {
    expect(placesOf(song().items, song().map, order).slice(3, 6)).toEqual([{ sec: 0, at: 12 }, { sec: 1, at: 0 }, { sec: 1, at: 3 }]);
  });

  it("from the end of B, on to the next section picked (C), skipping the A between", () => {
    const old = list("b");
    const neu = list("b", "c");
    // B came round (its list's end): on into C
    expect(entryAfter(old, old.items.length, neu, order)).toBe(2);
  });

  it("from the end of the last section picked: round again from the new loop's start", () => {
    const old = list("b", "c");
    const neu = list("a1", "c");
    expect(entryAfter(old, old.items.length, neu, order)).toBe(0);
  });

  it("playing straight through, a loop of A and C picked during the first A: on to C after it", () => {
    const old = song();
    const neu = list("a1", "c");
    // the first A ends at item 4
    expect(entryAfter(old, 4, neu, order)).toBe(4);
    // (changed during B, it goes on to C after B, skipping the second A)
    expect(entryAfter(old, 6, neu, order)).toBe(4);
    // during C: round again
    expect(entryAfter(old, old.items.length, neu, order)).toBe(0);
  });

  it("a loop that grew goes straight on into the bars just added", () => {
    const old = { items: [{ beats: 4, from: 0 }, { beats: 4, from: 4 }], map: [{ block: "a1" }, { block: "a1" }] };
    const neu = list("a1");
    expect(entryAfter(old, 2, neu, order)).toBe(2);
  });

  it("the loop let go while playing: on through the song from the next section", () => {
    const old = list("b");
    expect(entryAfter(old, old.items.length, song(), order)).toBe(6);
  });
});
