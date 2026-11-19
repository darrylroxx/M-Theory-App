import { describe, expect, it } from "vitest";
import { playAlone } from "./CanvasPage";

describe("a song from a file on the Canvas", () => {
  it("stops the app's own song before it starts, so the two are never heard (or queued for the paint) together", () => {
    const did: string[] = [];
    playAlone(true, () => did.push("stop app"), () => did.push("play file"));
    expect(did).toEqual(["stop app", "play file"]);
    did.length = 0;
    playAlone(false, () => did.push("stop app"), () => did.push("play file"));
    expect(did).toEqual(["play file"]);
  });
});
