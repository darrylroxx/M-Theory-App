import { describe, expect, it } from "vitest";
import { bandSong } from "../../timeline/testsongs";
import type { Session } from "../../timeline/model";
import { PANEL_W, SOUND_W, TOP_H, Z_FIRST, Z_LAST, closeWin, firstPlace, frontWin, isSheet, keepInside, openLabel, openWin, openWins, placeWin, winId, zOf } from "./windows";

const VIEW = { w: 1280, h: 800, panel: 260, top: 84 };
const blank = (): Session => ({ cursor: 0, loop: null, sel: { clips: [], track: null }, pxPerBeat: 12, scroll: 0, armed: null, windows: [] });

describe("where a window first opens", () => {
  it("a composer lies across the lower part of the lanes", () => {
    expect(firstPlace("compose", VIEW)).toEqual({ x: 260, y: 360, w: 1020, h: 440 });
    expect(PANEL_W).toBe(260);
    expect(TOP_H).toBe(84);
  });
  it("on a low screen a composer is 55 % of its height", () => {
    expect(firstPlace("compose", { ...VIEW, h: 600 })).toEqual({ x: 260, y: 270, w: 1020, h: 330 });
  });
  it("a sound window is 420 wide down the right side of the lanes", () => {
    expect(firstPlace("sound", VIEW)).toEqual({ x: 860, y: 84, w: 420, h: 716 });
    expect(SOUND_W).toBe(420);
  });
  it("beside a composer, a sound window takes the right end of it", () => {
    const comp = { id: "compose:t", kind: "compose" as const, track: "t", ...firstPlace("compose", VIEW), open: true };
    expect(firstPlace("sound", VIEW, comp)).toEqual({ x: 860, y: 360, w: 420, h: 440 });
  });
  it("a window cannot leave the screen", () => {
    expect(keepInside({ x: -50, y: 900, w: 400, h: 300 }, { w: 1280, h: 800 })).toEqual({ x: 0, y: 500, w: 400, h: 300 });
    expect(keepInside({ x: 1000, y: 10, w: 400, h: 300 }, { w: 1280, h: 800 })).toEqual({ x: 880, y: 10, w: 400, h: 300 });
    const fine = { x: 10, y: 10, w: 400, h: 300 };
    expect(keepInside(fine, { w: 1280, h: 800 })).toBe(fine);
    // one wider than the screen starts at its left edge
    expect(keepInside({ x: 40, y: 0, w: 1020, h: 300 }, { w: 700, h: 800 }).x).toBe(0);
  });
});

describe("the list of windows", () => {
  it("one composer window per track: opening a second clip keeps the window and changes what it shows", () => {
    let s = openWin(blank(), "compose", "td", "d1", VIEW);
    expect(s.windows).toHaveLength(1);
    expect(s.windows[0]).toMatchObject({ id: "compose:td", kind: "compose", track: "td", clip: "d1", open: true, x: 260, y: 360 });
    s = openWin(s, "compose", "td", "d2", VIEW);
    expect(s.windows).toHaveLength(1);
    expect(s.windows[0].clip).toBe("d2");
    // with no clip it shows what is being composed
    s = openWin(s, "compose", "td", undefined, VIEW);
    expect("clip" in s.windows[0]).toBe(false);
    // a sound window of the same track is another window
    s = openWin(s, "sound", "td", undefined, VIEW);
    expect(s.windows.map((w) => w.id)).toEqual(["compose:td", "sound:td"]);
    expect(winId("sound", "td")).toBe("sound:td");
  });

  it("the stacking order follows the last press", () => {
    let s = openWin(blank(), "compose", "a", undefined, VIEW);
    s = openWin(s, "compose", "b", undefined, VIEW);
    s = openWin(s, "sound", "c", undefined, VIEW);
    expect(openWins(s).map((w) => w.id)).toEqual(["compose:a", "compose:b", "sound:c"]);
    s = frontWin(s, "compose:a");
    expect(openWins(s).map((w) => w.id)).toEqual(["compose:b", "sound:c", "compose:a"]);
    expect(zOf(s, "compose:a")).toBe(Z_LAST);
    expect(zOf(s, "sound:c")).toBe(Z_LAST - 1);
    expect(zOf(s, "compose:b")).toBe(Z_LAST - 2);
    // the one in front pressed again: nothing changes
    expect(frontWin(s, "compose:a")).toBe(s);
    // opening one that is already open brings it to the front
    s = openWin(s, "compose", "b", undefined, VIEW);
    expect(openWins(s).map((w) => w.id)).toEqual(["sound:c", "compose:a", "compose:b"]);
  });

  it("stays inside its band however many are open", () => {
    let s = blank();
    for (let i = 0; i < 30; i++) s = openWin(s, "compose", `t${i}`, undefined, VIEW);
    const zs = openWins(s).map((w) => zOf(s, w.id));
    expect(Math.min(...zs)).toBe(Z_FIRST);
    expect(Math.max(...zs)).toBe(Z_LAST);
    expect(Z_FIRST).toBe(45);
    expect(Z_LAST).toBe(59);
  });

  it("closing takes it off the screen and keeps where it was left", () => {
    let s = openWin(blank(), "compose", "a", "c1", VIEW);
    s = placeWin(s, "compose:a", { x: 300, y: 200, w: 800, h: 400 });
    s = closeWin(s, "compose:a");
    expect(openWins(s)).toEqual([]);
    expect(closeWin(s, "compose:a")).toBe(s);
    s = openWin(s, "compose", "a", "c2", VIEW);
    expect(openWins(s)[0]).toMatchObject({ x: 300, y: 200, w: 800, h: 400, clip: "c2", open: true });
  });

  it("a composer's title says which bars it has open", () => {
    const song = bandSong();
    expect(openLabel(song, "d1")).toBe("bars 5–8");
    expect(openLabel(song, "c2")).toBe("bars 9–16");
    expect(openLabel(song, undefined)).toBe("draft");
    expect(openLabel(song, "gone")).toBe("draft");
  });
});

describe("on a narrow screen", () => {
  it("a window is a sheet at 760 pixels and below, and under a finger", () => {
    expect(isSheet(761, false)).toBe(false);
    expect(isSheet(760, false)).toBe(true);
    expect(isSheet(700, false)).toBe(true);
    expect(isSheet(1280, true)).toBe(true);
    expect(isSheet(1280, false)).toBe(false);
  });
});
