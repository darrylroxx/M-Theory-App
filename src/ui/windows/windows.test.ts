import { describe, expect, it } from "vitest";
import { bandSong } from "../../timeline/testsongs";
import type { Session } from "../../timeline/model";
import { freshState, load5, save5, type KV } from "../../timeline/store5";
import { MIN_H, MIN_W, PANEL_W, SOUND_W, TOP_H, Z_FIRST, Z_LAST, closeWin, firstPlace, frontWin, isBeside, isSheet, keepInside, openLabel, openWin, openWins, placeWin, resized, retargetWin, winId, zOf } from "./windows";

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

describe("closed, hidden, and back as it was left", () => {
  it("a closed window stays in the list with open: false", () => {
    let s = openWin(openWin(blank(), "compose", "td", undefined, VIEW), "sound", "td", undefined, VIEW);
    s = closeWin(s, "compose:td");
    expect(s.windows.map((w) => [w.id, w.open])).toEqual([["compose:td", false], ["sound:td", true]]);
    s = closeWin(s, "sound:td");
    expect(s.windows).toHaveLength(2);
    expect(s.windows.every((w) => !w.open)).toBe(true);
  });

  it("the compose button opens the track's draft: the window has no clip; a clip opened puts it on that clip", () => {
    let s = openWin(blank(), "compose", "td", undefined, VIEW);
    expect("clip" in s.windows[0]).toBe(false);
    s = openWin(s, "compose", "td", "d1", VIEW);
    expect(s.windows[0].clip).toBe("d1");
    // back on the draft, in the same place
    s = openWin(placeWin(s, "compose:td", { x: 300, y: 300, w: 700, h: 420 }), "compose", "td", undefined, VIEW);
    expect(s.windows[0]).toMatchObject({ x: 300, y: 300, w: 700, h: 420, open: true });
    expect("clip" in s.windows[0]).toBe(false);
  });

  it("a composer whose clip is gone goes back to its track's draft, open or not", () => {
    const s = closeWin(openWin(blank(), "compose", "td", "d1", VIEW), "compose:td");
    const back = retargetWin(s, "compose:td", undefined);
    expect("clip" in back.windows[0]).toBe(false);
    expect(back.windows[0].open).toBe(false);
    expect(retargetWin(back, "compose:td", undefined)).toBe(back);
    expect(retargetWin(back, "compose:td", "d2").windows[0].clip).toBe("d2");
    // a sound window is on no clip
    const snd = openWin(blank(), "sound", "td", undefined, VIEW);
    expect(retargetWin(snd, "sound:td", "d1")).toBe(snd);
  });

  it("the stored place survives a reload of the session", () => {
    const store = new Map<string, string>();
    const kv: KV = { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v), remove: (k) => void store.delete(k) };
    const fresh = freshState("draft-1");
    let session = openWin({ ...fresh.session, pxPerBeat: 14 }, "compose", "t-drums", undefined, VIEW);
    session = openWin(session, "sound", "t-drums", undefined, VIEW, true);
    session = placeWin(session, "compose:t-drums", { x: 300, y: 250, w: 640, h: 380 });
    session = closeWin(session, "compose:t-drums");
    expect(save5(kv, { ...fresh, session })).toBe(true);
    const again = load5(kv).state.session.windows;
    expect(again).toEqual(session.windows);
    expect(again.find((w) => w.id === "compose:t-drums")).toMatchObject({ x: 300, y: 250, w: 640, h: 380, open: false });
  });
});

describe("a sound window beside its composer", () => {
  it("opened from a composer, it takes its width from it: the composer gives up 420 and the two stand side by side", () => {
    let s = openWin(blank(), "compose", "td", undefined, VIEW);
    s = openWin(s, "sound", "td", undefined, VIEW, true);
    const comp = s.windows.find((w) => w.id === "compose:td")!;
    const snd = s.windows.find((w) => w.id === "sound:td")!;
    expect(comp).toMatchObject({ x: 260, y: 360, w: 600, h: 440 });
    expect(snd).toMatchObject({ x: 860, y: 360, w: 420, h: 440, open: true });
    expect(isBeside(snd, comp)).toBe(true);
    // asked for again, nothing moves
    const twice = openWin(s, "sound", "td", undefined, VIEW, true);
    expect(twice.windows.find((w) => w.id === "compose:td")).toEqual(comp);
    expect(twice.windows.find((w) => w.id === "sound:td")).toEqual(snd);
  });

  it("closed, it gives the width back; opened from the panel's FX it stands on its own", () => {
    let s = openWin(openWin(blank(), "compose", "td", undefined, VIEW), "sound", "td", undefined, VIEW, true);
    s = closeWin(s, "sound:td");
    expect(s.windows.find((w) => w.id === "compose:td")).toMatchObject({ x: 260, w: 1020 });
    // FX on the panel, with no composer asking: where a sound window opens by itself, and no composer is touched
    const alone = openWin(openWin(blank(), "compose", "td", undefined, VIEW), "sound", "td", undefined, VIEW);
    expect(alone.windows.find((w) => w.id === "sound:td")).toMatchObject({ x: 860, y: 84, w: 420, h: 716 });
    expect(alone.windows.find((w) => w.id === "compose:td")).toMatchObject({ w: 1020 });
  });

  it("a sound window that already has a place is brought beside the composer when the composer asks for it", () => {
    let s = openWin(blank(), "sound", "td", undefined, VIEW);
    s = openWin(closeWin(s, "sound:td"), "compose", "td", undefined, VIEW);
    s = openWin(s, "sound", "td", undefined, VIEW, true);
    expect(s.windows.find((w) => w.id === "sound:td")).toMatchObject({ x: 860, y: 360, w: 420, h: 440 });
    expect(s.windows.find((w) => w.id === "compose:td")).toMatchObject({ w: 600 });
  });

  it("a composer too narrow to share keeps its width, and the sound window opens where it would on its own", () => {
    let s = placeWin(openWin(blank(), "compose", "td", undefined, VIEW), "compose:td", { x: 260, y: 360, w: 500, h: 440 });
    s = openWin(s, "sound", "td", undefined, VIEW, true);
    expect(s.windows.find((w) => w.id === "compose:td")!.w).toBe(500);
    expect(s.windows.find((w) => w.id === "sound:td")).toMatchObject({ x: 860, y: 84 });
  });
});

describe("the corner that makes a window larger or smaller", () => {
  it("drags the right and bottom edges, never past the screen, never smaller than the least", () => {
    const r = { x: 260, y: 360, w: 600, h: 300 };
    expect(resized(r, 100, 50, { w: 1280, h: 800 })).toEqual({ x: 260, y: 360, w: 700, h: 350 });
    expect(resized(r, 900, 900, { w: 1280, h: 800 })).toEqual({ x: 260, y: 360, w: 1020, h: 440 });
    expect(resized(r, -900, -900, { w: 1280, h: 800 })).toEqual({ x: 260, y: 360, w: MIN_W, h: MIN_H });
    expect(resized(r, 0, 0, { w: 1280, h: 800 })).toBe(r);
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
