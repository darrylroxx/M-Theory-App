import { describe, expect, it } from "vitest";
import { activeTake, cutTakes, groupsOf, reviveTakes, type Recorded } from "./takes";

let n = 0;
const id = () => `t${++n}`;
const rec = (frames: number): Recorded => ({ dry: "a.wav", wet: "a-wet-1.wav", rate: 48000, frames, offset: 300, count_in: 96000, loop_frames: 192000, dropped: 0 });
const at = { block: "b1", bar: 0 };

describe("takes", () => {
  it("a recording is cut into one take per pass, after the count-in, moved by the round trip", () => {
    const takes = cutTakes(rec(300 + 96000 + 192000 * 3 + 5000), { group: "g", at, id });
    expect(takes.map((t) => t.n)).toEqual([1, 2, 3, 4]);
    expect(takes[0].start).toBe(96300);
    expect(takes[1].start).toBe(96300 + 192000);
    expect(takes.slice(0, 3).every((t) => t.frames === 192000 && !t.short)).toBe(true);
    // a last pass stopped early is kept but marked short
    expect(takes[3]).toMatchObject({ frames: 5000, short: true });
  });

  it("a last pass past half-way is a take of its own", () => {
    const takes = cutTakes(rec(300 + 96000 + 192000 + 120000), { group: "g", at, id });
    expect(takes).toHaveLength(2);
    expect(takes[1].short).toBeUndefined();
  });

  it("stopping during the count-in gives no takes; a nudge moves them", () => {
    expect(cutTakes(rec(50000), { group: "g", at, id })).toEqual([]);
    expect(cutTakes(rec(300 + 96000 + 192000), { group: "g", at, nudge: 48, id })[0].start).toBe(96348);
  });

  it("the take that plays: the one chosen, or the last full one", () => {
    const takes = cutTakes(rec(300 + 96000 + 192000 * 3 + 5000), { group: "g", at, id });
    expect(activeTake(takes, "g")?.n).toBe(3);
    expect(activeTake(takes, "g", takes[0].id)?.n).toBe(1);
    expect(groupsOf(takes)).toEqual(["g"]);
  });

  it("takes survive a reload; broken ones are dropped", () => {
    const takes = cutTakes(rec(300 + 96000 + 192000), { group: "g", at, id });
    expect(reviveTakes(JSON.parse(JSON.stringify(takes)))).toEqual(takes);
    expect(reviveTakes([{ id: "x" }, 4])).toBeUndefined();
  });
});
