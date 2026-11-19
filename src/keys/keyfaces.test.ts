import { describe, expect, it } from "vitest";
import { BLACK_WIDTH, isBlack, keyCentre, keyLeft, keyRects, keyboardWindow, whiteMidi } from "./keyfaces";
import { mod12 } from "../theory/notes";

describe("keyboard geometry", () => {
  it("knows the black keys and where they sit", () => {
    expect([60, 61, 62, 63, 64, 65, 66].map(isBlack)).toEqual([false, true, false, true, false, false, true]);
    expect(keyLeft(60)).toBe(35); // middle C is the 36th white key from MIDI 0
    expect(keyLeft(62) - keyLeft(60)).toBe(1);
    expect(keyLeft(61) - keyLeft(60)).toBeCloseTo(0.55);
    expect(keyLeft(70) - keyLeft(60)).toBeCloseTo(5.85);
    expect(keyLeft(72) - keyLeft(60)).toBe(7);
    expect(whiteMidi(35)).toBe(60);
    expect(whiteMidi(41)).toBe(71);
  });

  it("every black key sits across the crack between its two white neighbours", () => {
    for (let m = 21; m < 108; m++) {
      if (!isBlack(m)) continue;
      const crack = keyLeft(m + 1);
      expect(keyLeft(m)).toBeLessThan(crack);
      expect(keyLeft(m) + BLACK_WIDTH).toBeGreaterThan(crack);
    }
  });

  it("cuts the keyboard to fit the voicing, on C or F at the bottom and E or B at the top", () => {
    const w = keyboardWindow([48, 52, 59], 7);
    expect(w.lo).toBeLessThanOrEqual(48);
    expect(w.hi).toBeGreaterThanOrEqual(59);
    expect([0, 5]).toContain(mod12(w.lo));
    expect([4, 11]).toContain(mod12(w.hi));
    expect(w.whites).toBeGreaterThanOrEqual(7);
    // a black key at the edge is drawn whole
    const b = keyboardWindow([61, 70], 7);
    expect(b.lo).toBeLessThanOrEqual(60);
    expect(b.hi).toBeGreaterThanOrEqual(71);
  });

  it("shows at least the number of white keys asked for, and grows with the voicing up to four octaves", () => {
    for (const min of [7, 10, 14, 21]) expect(keyboardWindow([60, 64, 67], min).whites).toBeGreaterThanOrEqual(min);
    const wide = keyboardWindow([36, 43, 52, 59, 62, 67, 74], 7);
    expect(wide.lo).toBeLessThanOrEqual(36);
    expect(wide.hi).toBeGreaterThanOrEqual(74);
    expect(keyboardWindow([60, 64, 67], 7, 7).whites).toBeLessThanOrEqual(8);
    expect(keyboardWindow([], 7).whites).toBeGreaterThanOrEqual(7);
  });

  it("lists every key of the window once, white keys first so black ones draw on top", () => {
    const rects = keyRects(60, 71);
    expect(rects.length).toBe(12);
    expect(rects.slice(0, 7).every((r) => !r.black)).toBe(true);
    expect(rects.slice(7).every((r) => r.black)).toBe(true);
    expect(rects[0].x).toBe(0);
    expect(keyCentre(60, 60)).toBe(0.5);
    expect(keyCentre(61, 60)).toBeCloseTo(0.55 + BLACK_WIDTH / 2);
  });
});
