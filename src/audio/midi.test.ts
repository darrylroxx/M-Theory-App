import { describe, expect, it } from "vitest";
import { progressionToMidi } from "./midi";
import { PATTERNS, patternEvents } from "./patterns";

describe("midi export", () => {
  const items = [
    { midi: [null, 48, 52, 55, 60, 64], beats: 4 },
    { midi: [43, 47, 50, 55, 59, 67], beats: 4 },
  ];
  it("writes a valid single-track SMF", () => {
    const b = progressionToMidi(items, 100, "strum");
    const txt = String.fromCharCode(...b.slice(0, 4));
    expect(txt).toBe("MThd");
    expect(String.fromCharCode(...b.slice(14, 18))).toBe("MTrk");
    const len = (b[18] << 24) | (b[19] << 16) | (b[20] << 8) | b[21];
    expect(len).toBe(b.length - 22);
    // ends with end-of-track
    expect([...b.slice(-3)]).toEqual([0xff, 0x2f, 0x00]);
    // balanced note on/off
    let on = 0, off = 0;
    for (let i = 22; i < b.length - 2; i++) {
      if (b[i] === 0x90 && b[i + 1] < 128 && b[i + 2] > 0 && b[i + 2] < 128) on++;
      if (b[i] === 0x80 && b[i + 1] < 128 && b[i + 2] === 0) off++;
    }
    expect(on).toBe(off);
    expect(on).toBeGreaterThan(10);
  });
  it("every pattern produces events within the chord length", () => {
    for (const p of PATTERNS) {
      const ev = patternEvents(items[0].midi, 4, p.id);
      expect(ev.length).toBeGreaterThan(0);
      expect(ev.every((e) => e.beat >= 0 && e.beat < 4)).toBe(true);
    }
  });
});
