import { describe, expect, it } from "vitest";
import { HOLD_MS, makeHands } from "./hands";

describe("Follow waits while something is changed by hand", () => {
  it("while a pointer is held (a knob dragged across a section's end), and a moment after", () => {
    const h = makeHands();
    expect(h.busy(0)).toBe(false);
    h.press(1, 1000);
    // however long the drag goes on
    expect(h.busy(1000 + 10 * HOLD_MS)).toBe(true);
    h.release(1, 20000);
    expect(h.busy(20000 + HOLD_MS - 1)).toBe(true);
    expect(h.busy(20000 + HOLD_MS + 1)).toBe(false);
  });

  it("two fingers: until both are off; a pointer never pressed changes nothing", () => {
    const h = makeHands();
    h.press(1, 0);
    h.press(2, 0);
    h.release(1, 100);
    expect(h.busy(100 + 2 * HOLD_MS)).toBe(true);
    h.release(2, 5000);
    expect(h.busy(5000 + HOLD_MS + 1)).toBe(false);
    h.release(7, 9000);
    expect(h.busy(9000)).toBe(false);
  });

  it("keys on a control (arrows on a knob) hold it for a moment after each", () => {
    const h = makeHands();
    h.key(0);
    h.key(250);
    expect(h.busy(250 + HOLD_MS - 1)).toBe(true);
    expect(h.busy(250 + HOLD_MS + 1)).toBe(false);
  });

  it("the window losing focus lets every pointer go", () => {
    const h = makeHands();
    h.press(1, 0);
    h.clear(100);
    expect(h.busy(100 + HOLD_MS + 1)).toBe(false);
  });
});
