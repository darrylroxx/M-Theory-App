import { describe, expect, it } from "vitest";
import { lastOnly, lastOnlyEach } from "./latest";

describe("only the last of what was started goes on", () => {
  it("a slow file read finishing after a later, quicker one is dropped", async () => {
    const opens = lastOnly();
    const opened: string[] = [];
    const open = async (name: string, ms: number) => {
      const mine = opens.begin();
      await new Promise((r) => setTimeout(r, ms));
      if (mine()) opened.push(name);
    };
    await Promise.all([open("long.flac", 30), open("short.mp3", 5)]);
    expect(opened).toEqual(["short.mp3"]);
  });
  it("one called off while it waits (the song closed, ■ pressed) does nothing when it ends", async () => {
    const starts = lastOnly();
    let played = false;
    const mine = starts.begin();
    const ready = new Promise((r) => setTimeout(r, 5)).then(() => {
      if (mine()) played = true;
    });
    starts.cancel();
    await ready;
    expect(played).toBe(false);
  });
});

describe("only the last of what was started goes on, for each thing on its own", () => {
  it("a track's slow piano finishing after it was changed again is dropped; another track's is not", () => {
    const loads = lastOnlyEach();
    const piano = loads.begin("chords");
    const other = loads.begin("pad1");
    const guitar = loads.begin("chords");
    expect(piano()).toBe(false);
    expect(guitar()).toBe(true);
    expect(other()).toBe(true);
  });
});
