import { describe, expect, it } from "vitest";
import { activeTake, clickPlan, cutTakes, groupsOf, passAt, passToMark, reviveTakes, sameSound, shownTakes, soundTag, takeBars, toggled, type Recorded, type Take } from "./takes";

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

  it("a nudge earlier than the round trip, with no count-in: the first take starts before the file, and no pass moves", () => {
    // 300 frames of round trip, nudged 500 earlier: the first pass begins 200 frames before the file
    const r = { ...rec(192000 * 3 + 1000), count_in: 0 };
    const takes = cutTakes(r, { group: "g", at, nudge: -500, id });
    expect(takes[0]).toMatchObject({ n: 1, start: -200, frames: 192000 });
    // every later pass exactly where it was sung (not pulled 200 frames late with the first)
    expect(takes.slice(1, 3).map((t) => t.start)).toEqual([-200 + 192000, -200 + 192000 * 2]);
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

describe("a flow session: pass after pass until stopped", () => {
  // an hour round a 4-second loop: 900 passes in one file
  const LOOP = 192000;
  const long = (passes: number, tail = 0): Recorded => ({ ...rec(300 + 96000 + LOOP * passes + tail), loop_frames: LOOP });

  it("knows the pass being sung and how far into it, from the engine's position", () => {
    expect(passAt(50_000, 96_000, LOOP)).toBeNull(); // the count-in
    expect(passAt(96_000, 96_000, LOOP)).toEqual({ n: 1, frac: 0 });
    expect(passAt(96_000 + LOOP * 6 + LOOP / 4, 96_000, LOOP)).toEqual({ n: 7, frac: 0.25 });
    expect(passAt(10, 0, 0)).toBeNull(); // nothing to go round yet
    // the pass number agrees with the takes cut at Stop
    const takes = cutTakes(long(7, LOOP / 4), { group: "g", at, id });
    expect(takes[takes.length - 1].n).toBe(passAt(96_000 + LOOP * 7 + LOOP / 4, 96_000, LOOP)?.n);
  });

  it("K keeps the pass being sung, or just after a seam the one that has just ended", () => {
    expect(passToMark({ n: 7, frac: 0.5 }, 0.1)).toBe(7);
    expect(passToMark({ n: 7, frac: 0.05 }, 0.1)).toBe(6);
    expect(passToMark({ n: 1, frac: 0.01 }, 0.1)).toBe(1); // there is no pass before the first
  });

  it("marking and unmarking passes", () => {
    let m = toggled(new Set(), 3);
    m = toggled(m, 9);
    expect([...m].sort()).toEqual([3, 9]);
    m = toggled(m, 3);
    expect([...m]).toEqual([9]);
    const before = new Set([1]);
    toggled(before, 2);
    expect([...before]).toEqual([1]); // the old set is left as it was
  });

  it("passes marked ★ while singing are flagged, and the last of them plays", () => {
    const takes = cutTakes(long(900, 1000), { group: "g", at, id, kept: [12, 487, 3] });
    expect(takes).toHaveLength(900);
    expect(takes.filter((t) => t.keep).map((t) => t.n)).toEqual([3, 12, 487]);
    expect(takes.filter((t) => !t.keep).every((t) => !("keep" in t))).toBe(true);
    expect(activeTake(takes, "g")?.n).toBe(487);
    // a take chosen by hand still wins
    expect(activeTake(takes, "g", takes[899].id)?.n).toBe(900);
    // with nothing marked: the last full pass, as before
    expect(activeTake(cutTakes(long(900, 1000), { group: "h", at, id }), "h")?.n).toBe(900);
  });

  it("a pass marked as it was cut short still counts", () => {
    const takes = cutTakes(long(4, 20_000), { group: "g", at, id, kept: [5] });
    expect(takes[4]).toMatchObject({ n: 5, short: true, keep: true });
    expect(activeTake(takes, "g")?.n).toBe(5);
    // a mark on a pass that was never reached is let go
    expect(cutTakes(long(2), { group: "g", at, id, kept: [9] }).some((t) => t.keep)).toBe(false);
  });

  it("the ★ survives a reload; anything else stored there is let go; old songs load as they were", () => {
    const takes = cutTakes(long(3), { group: "g", at, id, kept: [2] });
    expect(reviveTakes(JSON.parse(JSON.stringify(takes)))).toEqual(takes);
    const odd = reviveTakes([{ ...takes[0], keep: "yes" }, { ...takes[1], keep: 1 }])!;
    expect(odd.every((t) => !("keep" in t))).toBe(true);
    // a take saved before ★ existed (and before it had a number)
    const old = { id: "o", group: "g", dry: "a.wav", wet: "a-wet-1.wav", rate: 48000, start: 10, frames: 20, at };
    expect(reviveTakes([old])).toEqual([{ ...old, n: 1 }]);
  });

  it("hundreds of passes: the list shows the keepers, the one playing and the newest, the rest behind +N", () => {
    const takes = cutTakes(long(300, 20_000), { group: "g", at, id, kept: [5, 120] });
    takes.push(...cutTakes(long(2), { group: "other", at, id }));
    const active = activeTake(takes, "g")!;
    const { shown, more } = shownTakes(takes, "g", { active: active.id });
    expect(shown.map((t) => t.n)).toEqual([5, 120, 293, 294, 295, 296, 297, 298, 299, 300]);
    expect(more).toBe(290);
    // the short tail is hidden unless asked for
    expect(shownTakes(takes, "g", { active: active.id, shorts: true }).shown.map((t) => t.n).slice(-2)).toEqual([300, 301]);
    // a take chosen from deep in the list shows too
    expect(shownTakes(takes, "g", { active: takes[40].id }).shown.map((t) => t.n)).toContain(41);
    // "+N" opened: every one
    expect(shownTakes(takes, "g", { all: true }).shown).toHaveLength(300);
    expect(shownTakes(takes, "g", { all: true, shorts: true }).shown).toHaveLength(301);
    // a short recording shows whole
    const few = cutTakes(long(3), { group: "f", at, id });
    expect(shownTakes(few, "f")).toEqual({ shown: few, more: 0 });
  });

  it("each take keeps a short name of the vocal sound it was made with, not the whole sound", () => {
    const fx = { on: true, verb: 0.25, echo_type: "tape", level: 0 };
    const tag = soundTag(fx);
    expect(tag.length).toBeLessThan(16);
    expect(soundTag({ ...fx })).toBe(tag);
    expect(soundTag({ ...fx, verb: 0.26 })).not.toBe(tag);
    const t = { sound: tag } as Take;
    expect(sameSound(t, fx)).toBe(true);
    expect(sameSound(t, { ...fx, level: 1 })).toBe(false);
    // takes saved before held the whole sound: still known
    expect(sameSound({ sound: JSON.stringify(fx) } as Take, fx)).toBe(true);
    // a take made with no vocal sound (it plays dry) never matches
    expect(sameSound({ sound: "" } as Take, fx)).toBe(false);
  });

  it("a take is as many bars long as its sound at the tempo", () => {
    const t = { frames: 192000, rate: 48000 } as Take;
    expect(takeBars(t, 120, 4)).toBe(2); // 4 s at 120 bpm: 8 beats
    expect(takeBars(t, 90, 3)).toBe(2); // 6 beats of 3
  });
});

describe("the click under a recording", () => {
  it("counts in with the loop's first bar and clicks every bar in its own meter", () => {
    const bars = [{ beats: 4 }, { beats: 4 }, { beats: 3 }, { beats: 3 }];
    expect(clickPlan(bars, 4, 1)).toEqual({ beatsPerBar: 4, countInBeats: 4, bars: [4, 4, 3, 3] });
    // a loop that starts in the 3/4 section counts in three
    expect(clickPlan(bars.slice(2), 4, 2)).toEqual({ beatsPerBar: 3, countInBeats: 6, bars: [3, 3] });
  });
  it("falls back to the bar it was given, and never asks for less than a beat", () => {
    expect(clickPlan(undefined, 3, 1)).toEqual({ beatsPerBar: 3, countInBeats: 3, bars: [] });
    expect(clickPlan([{ beats: 0 }, { beats: Number.NaN }, { beats: 2.0000001 }], 4, 0)).toEqual({ beatsPerBar: 1, countInBeats: 0, bars: [1, 1, 2] });
  });
});
