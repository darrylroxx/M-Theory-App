import { describe, expect, it } from "vitest";
import { DEFAULT_BEAT, barsOf, levelAt, type Beat } from "../../audio/beats";
import { fitRhythm } from "../../song/meter";
import { deskFollowsPage, putBack, snapOf } from "./DrumMachine";

describe("the drum page's changes on the track's desk", () => {
  it("are always heard at once (there is one desk for a drums track, and one kit for the whole track)", () => {
    expect(deskFollowsPage(false, null)).toBe(true);
    expect(deskFollowsPage(true, 2.5)).toBe(true);
    // also while other bars of the song are the ones playing
    expect(deskFollowsPage(true, null)).toBe(true);
  });
});

describe("the drum grid's Undo and Cancel", () => {
  /** two bars of 4/4: the kick on bar 1 beat 1, the snare on bar 2 beat 1 */
  const four: Beat = { ...DEFAULT_BEAT, on: true, steps: 16, div: 4, bars: 2, rows: { ...DEFAULT_BEAT.rows, kick: "3" + "0".repeat(31), snare: "0".repeat(16) + "3" + "0".repeat(15), hat: "0".repeat(32) } };
  it("put back the whole grid, its size with its rows, even after the bars changed (another time signature)", () => {
    const start = snapOf(four);
    // the section goes to 3/4 on the Frame page while the edit is open: the beat is fitted to the new bars
    const fitted = fitRhythm(four, 3, false);
    expect(fitted.steps).toBe(12);
    // Cancel: the grid as it was, and the song fits it to its bars again (as every change does)
    const back = fitRhythm(putBack(fitted, start), 3, false);
    expect(back.rows.snare.length).toBe(back.steps * barsOf(back));
    // the snare is still on bar 2 beat 1, not read 12 steps to a bar from a 16-step row
    expect(levelAt(back.rows, "snare", back.steps)).toBe(3);
    expect(levelAt(back.rows, "kick", 0)).toBe(3);
  });
});
