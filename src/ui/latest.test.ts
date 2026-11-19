import { describe, expect, it } from "vitest";
import { lastOnly } from "./latest";

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
