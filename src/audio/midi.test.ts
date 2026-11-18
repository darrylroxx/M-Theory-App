import { describe, expect, it } from "vitest";
import { extraChordItems, progressionToMidi } from "./midi";
import { DEFAULT_BEAT } from "./beats";
import { SOUND_DEFAULT } from "./rack";
import type { ExtraPlay, PlayItem } from "./patterns";
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

describe("midi export of added tracks", () => {
  const items = [
    { midi: [null, 48, 52, 55, 60, 64], beats: 4 },
    { midi: [43, 47, 50, 55, 59, 67], beats: 4 },
  ];
  it("brings the added tracks along, each on a track of its own with its name", () => {
    // one section of 8 beats; Chords 2 plays a chord in its second half, Melody 2 a note, Drums 2 a beat
    const extra: ExtraPlay = {
      chords: [{ track: "c2", at: 4, beats: 4, midi: [null, 45, 52, 57, 60, 64], style: "ring", sound: SOUND_DEFAULT }],
      tunes: [{ track: "m2", tune: { m: { div: 1, bars: 1, notes: [{ at: 0, midi: 79 }] }, bar: 4, swing: 0 } }],
      drums: [{ track: "d2", beat: { ...DEFAULT_BEAT, on: true } }],
    };
    const list: PlayItem[] = [{ ...items[0], section: true, extra }, { ...items[1], extra }];
    const b = progressionToMidi(list, 100, "ring", "x", null, null, { c2: "Chords 2", m2: "Melody 2", d2: "Drums 2" });
    const tracks = (b[10] << 8) | b[11];
    expect(tracks).toBe(4); // harp, Chords 2, Melody 2, Drums 2
    const text = String.fromCharCode(...b);
    for (const n of ["Chords 2", "Melody 2", "Drums 2"]) expect(text).toContain(n);
    const bytes = [...b].join(",");
    expect(bytes).toContain("153,"); // drums on channel 10
    expect(bytes).toContain(",147,79,"); // Melody 2 on its own channel (4th, after Chords 2 on the 3rd)
    expect(bytes).toContain(",146,45,"); // Chords 2 on the 3rd
    // Chords 2 waits for its chord: silence in the first half, the chord at beat 4
    const own = extraChordItems(list, "c2");
    expect(own.map((x) => [x.beats, x.midi.length])).toEqual([[4, 0], [4, 6]]);
    expect(own[0].section).toBe(true);
  });
});
