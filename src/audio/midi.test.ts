import { describe, expect, it } from "vitest";
import { progressionToMidi } from "./midi";
import { STYLES, styleNotes } from "./patterns";

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
  it("every style lands inside the chord, in every bar length", () => {
    for (const p of STYLES)
      for (const bar of [4, 3, 2]) {
        const ev = styleNotes(items[0].midi, bar, p.id, 0, { bar, triplet: bar === 2 });
        // a style made of off-beats can be silent in a bar too short to reach its first one
        if (bar !== 2 || p.entry !== "") expect(ev.length, p.id).toBeGreaterThan(0);
        expect(ev.every((e) => e.beat >= 0 && e.beat < bar && e.velocity > 0 && e.velocity <= 1), p.id).toBe(true);
      }
  });
  it("names the harp, and plays what the style plays", () => {
    const b = progressionToMidi(items, 100, "pima");
    // program change to Orchestral Harp
    expect([...b].join(",")).toContain("192,46");
    let on = 0;
    for (let i = 22; i < b.length - 2; i++) if (b[i] === 0x90 && b[i + 2] > 0 && b[i + 2] < 128 && b[i + 1] < 128) on++;
    expect(on).toBeGreaterThanOrEqual(styleNotes(items[0].midi, 4, "pima").length * 2);
  });
});

describe("zip packaging (for sandboxed saves)", () => {
  it("crc32 matches the standard check value", async () => {
    const { crc32 } = await import("./midi");
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
