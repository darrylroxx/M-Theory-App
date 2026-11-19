import { describe, expect, it } from "vitest";
import { deskFollowsPage } from "./DrumMachine";

describe("the drum page's changes on the track's desk", () => {
  it("are heard at once when stopped or when the page's section is the one playing", () => {
    expect(deskFollowsPage(false, null)).toBe(true);
    expect(deskFollowsPage(true, 2.5)).toBe(true);
  });
  it("are only noted while another section, with a kit of its own, is the one playing", () => {
    expect(deskFollowsPage(true, null)).toBe(false);
  });
});
