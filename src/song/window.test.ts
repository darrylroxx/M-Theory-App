import { describe, expect, it } from "vitest";
import { BARS_SHOWN, barAtBeat, barAtFrac, barWindow, clampStart, defaultShown, inWindow, isShown, pageStart, reveal, reviveView, scrolledWindow, showSection, shownCount, turnPage, widePage } from "./window";

describe("bars on screen", () => {
  it("offers 1, 2, 4, 8 bars or the whole section", () => {
    expect([...BARS_SHOWN]).toEqual([1, 2, 4, 8, 0]);
    expect(isShown(4)).toBe(true);
    expect(isShown(0)).toBe(true);
    expect(isShown(3)).toBe(false);
    expect(isShown("4")).toBe(false);
  });

  it("suits the screen until someone picks: four wide, two on a tablet, one on a phone", () => {
    expect(defaultShown(1280)).toBe(4);
    expect(defaultShown(1000)).toBe(4);
    expect(defaultShown(999)).toBe(2);
    expect(defaultShown(640)).toBe(2);
    expect(defaultShown(390)).toBe(1);
  });

  it("is loaded safely: a bad number is forgotten, and Follow is off unless it was on", () => {
    expect(reviveView(undefined)).toBeUndefined();
    expect(reviveView("4")).toBeUndefined();
    expect(reviveView({ bars: 8, follow: true })).toEqual({ bars: 8, follow: true });
    expect(reviveView({ bars: 0 })).toEqual({ bars: 0, follow: false });
    expect(reviveView({ bars: 3, follow: "yes" })).toEqual({ follow: false });
    expect(reviveView({})).toEqual({ follow: false });
  });

  it("never shows more bars than there are; All is all of them", () => {
    expect(shownCount(4, 8)).toBe(4);
    expect(shownCount(8, 3)).toBe(3);
    expect(shownCount(0, 32)).toBe(32);
    expect(shownCount(1, 0)).toBe(1);
  });
});

describe("the window of bars", () => {
  it("stays inside the section and full wherever it can", () => {
    expect(barWindow(8, 4, 0)).toEqual({ start: 0, count: 4 });
    expect(barWindow(8, 4, 6)).toEqual({ start: 4, count: 4 });
    expect(barWindow(6, 4, 4)).toEqual({ start: 2, count: 4 });
    expect(barWindow(3, 4, 2)).toEqual({ start: 0, count: 3 });
    expect(barWindow(32, 0, 9)).toEqual({ start: 0, count: 32 });
    expect(barWindow(8, 1, 7)).toEqual({ start: 7, count: 1 });
    expect(barWindow(8, 1, 99)).toEqual({ start: 7, count: 1 });
    expect(barWindow(8, 2, -3)).toEqual({ start: 0, count: 2 });
    expect(clampStart(Number.NaN, 2, 8)).toBe(0);
  });

  it("turns whole pages: bar 5 of a four-bar view is on the page of bars 5 to 8", () => {
    expect(pageStart(4, 4, 8)).toBe(4);
    expect(pageStart(3, 4, 8)).toBe(0);
    expect(pageStart(7, 2, 8)).toBe(6);
    // the last page is moved back so it is still four bars
    expect(pageStart(5, 4, 6)).toBe(2);
    // one bar at a time is the old way: the page is the bar
    expect(pageStart(5, 1, 8)).toBe(5);
  });

  it("moves only when the bar it must show is off screen", () => {
    const w = { start: 4, count: 4 };
    expect(inWindow(w, 4)).toBe(true);
    expect(inWindow(w, 7)).toBe(true);
    expect(inWindow(w, 8)).toBe(false);
    expect(reveal(w, 6, 12)).toBe(4);
    expect(reveal(w, 9, 12)).toBe(8);
    expect(reveal(w, 1, 12)).toBe(0);
    // a window that does not start on a page edge is left where it is while the bar is on it
    expect(reveal({ start: 2, count: 4 }, 5, 12)).toBe(2);
  });

  it("‹ and › go a page at a time and stop at either end", () => {
    expect(turnPage({ start: 0, count: 4 }, 1, 12)).toBe(4);
    expect(turnPage({ start: 8, count: 4 }, 1, 12)).toBe(8);
    expect(turnPage({ start: 4, count: 4 }, -1, 12)).toBe(0);
    expect(turnPage({ start: 0, count: 4 }, -1, 12)).toBe(0);
    expect(turnPage({ start: 0, count: 4 }, 1, 6)).toBe(2);
  });

  it("follows the music page by page, never bar by bar", () => {
    const total = 12;
    let w = { start: 0, count: 4 };
    const seen: number[] = [];
    for (let b = 0; b < total; b++) {
      w = { ...w, start: reveal(w, b, total) };
      if (seen[seen.length - 1] !== w.start) seen.push(w.start);
    }
    expect(seen).toEqual([0, 4, 8]);
  });

  it("knows which bar is sounding, a section that comes round again folded back", () => {
    expect(barAtBeat(0, 4, 8)).toBe(0);
    expect(barAtBeat(3.99, 4, 8)).toBe(0);
    expect(barAtBeat(4, 4, 8)).toBe(1);
    expect(barAtBeat(4 - 1e-9, 4, 8)).toBe(1);
    expect(barAtBeat(33, 4, 8)).toBe(0);
    expect(barAtBeat(7.5, 3, 4)).toBe(2);
    expect(barAtBeat(-1, 4, 2)).toBe(1);
    expect(barAtBeat(Number.NaN, 4, 2)).toBe(0);
  });
});

describe("the Vocals lane's window", () => {
  it("finds the bar a point across the lane is in", () => {
    expect(barAtFrac(0, 8)).toBe(0);
    expect(barAtFrac(0.124, 8)).toBe(0);
    expect(barAtFrac(0.125, 8)).toBe(1);
    expect(barAtFrac(0.99, 8)).toBe(7);
    expect(barAtFrac(1, 8)).toBe(7);
    expect(barAtFrac(-0.2, 8)).toBe(0);
    expect(barAtFrac(Number.NaN, 8)).toBe(0);
  });
  it("reads the bars on screen from how far the lane is scrolled", () => {
    // 4 bars in 800 px: 200 px a bar
    expect(scrolledWindow(0, 800, 4, 12)).toEqual({ start: 0, count: 4 });
    expect(scrolledWindow(800, 800, 4, 12)).toEqual({ start: 4, count: 4 });
    expect(scrolledWindow(890, 800, 4, 12)).toEqual({ start: 4, count: 4 });
    expect(scrolledWindow(5000, 800, 4, 12)).toEqual({ start: 8, count: 4 });
    // not laid out yet, or more bars asked for than there are
    expect(scrolledWindow(300, 0, 4, 12)).toEqual({ start: 0, count: 4 });
    expect(scrolledWindow(0, 800, 8, 3)).toEqual({ start: 0, count: 3 });
  });
  it("turns a whole page when the music leaves it, never a bar at a time", () => {
    const w = scrolledWindow(0, 800, 4, 12);
    expect(reveal(w, 3, 12)).toBe(0);
    expect(reveal(w, 4, 12)).toBe(4);
    // a loop of 6 bars, 4 on screen: the last page is kept full (bars 3 to 6)
    expect(reveal(scrolledWindow(0, 800, 4, 6), 5, 6)).toBe(2);
  });
});

describe("the whole width of the screen", () => {
  it("goes to every page laid over bars when it shows more than one", () => {
    for (const page of ["rhythm", "melody", "drums", "vocals"]) {
      expect(widePage(page, 4, 4)).toBe(true);
      expect(widePage(page, 0, 4)).toBe(true);
      expect(widePage(page, 1, 4)).toBe(false);
      expect(widePage(page, 4, 1)).toBe(false);
    }
  });
  it("always to the Track page (the whole song), never to the Frame or the Canvas", () => {
    expect(widePage("track", 4, 1)).toBe(true);
    expect(widePage("track", 1, 4)).toBe(false);
    expect(widePage("frame", 8, 4)).toBe(false);
    expect(widePage("canvas", 8, 4)).toBe(false);
  });
});

describe("the Track page shows the section being worked on", () => {
  it("stays put while the section is in view", () => {
    expect(showSection(0, 4, 0, 4)).toBe(0);
    expect(showSection(4, 8, 8, 4)).toBe(4);
    expect(showSection(2.5, 8, 4, 4)).toBe(2.5);
  });
  it("goes to a section that is off to either side", () => {
    // four bars on screen at the song's start: section C (bars 8 to 11) is brought in
    expect(showSection(0, 4, 8, 4)).toBe(8);
    expect(showSection(8, 4, 0, 4)).toBe(0);
  });
  it("goes to a section only partly in view, when all of it fits", () => {
    expect(showSection(0, 4, 2, 4)).toBe(2);
    expect(showSection(3, 4, 0, 4)).toBe(0);
  });
  it("a section longer than the screen: its start is enough", () => {
    expect(showSection(0, 4, 0, 8)).toBe(0);
    expect(showSection(1, 4, 0, 8)).toBe(0);
    expect(showSection(0, 4, 2, 8)).toBe(0);
  });
  it("while the music plays (any length counts as longer than the screen): only a start off screen moves the lanes", () => {
    // four bars on screen, sections of three: B (bars 3 to 5) starts in view, so the lanes wait for the page to turn
    expect(showSection(0, 4, 3, Infinity)).toBe(0);
    expect(showSection(4, 4, 6, Infinity)).toBe(4);
    expect(showSection(0, 4, 9, Infinity)).toBe(9);
  });
});
