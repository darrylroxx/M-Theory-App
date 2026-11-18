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

  it("writes the song's time signature, and counts dotted quarters in 6/8", () => {
    const four = [...progressionToMidi(items, 120, "ring")].join(",");
    expect(four).toContain("255,88,4,4,2,24,8");
    const three = [...progressionToMidi(items, 120, "ring", "x", null, null, {}, { num: 3, den: 4 })].join(",");
    expect(three).toContain("255,88,4,3,2,24,8");
    const b = progressionToMidi([{ midi: [null, 48, 52, 55, 60, 64], beats: 2 }], 80, "ring", "x", null, null, {}, { num: 6, den: 8 });
    const six = [...b].join(",");
    expect(six).toContain("255,88,4,6,3,36,8");
    // 80 dotted quarters a minute are 120 quarter notes a minute: 500000 microseconds each
    expect(six).toContain("255,81,3,7,161,32");
  });
});

/** The events of a MIDI file, track by track, each at its tick from the start (the writer never uses running status). */
function readMidi(b: Uint8Array): { tick: number; data: number[] }[][] {
  const tracks: { tick: number; data: number[] }[][] = [];
  let i = 14;
  while (i < b.length) {
    const len = (b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7];
    const end = i + 8 + len;
    let at = i + 8;
    let tick = 0;
    const ev: { tick: number; data: number[] }[] = [];
    while (at < end) {
      let d = 0;
      for (;;) {
        const x = b[at++];
        d = (d << 7) | (x & 0x7f);
        if (!(x & 0x80)) break;
      }
      tick += d;
      const s = b[at];
      const size = s === 0xff ? 3 + b[at + 2] : (s & 0xf0) === 0xc0 ? 2 : 3;
      ev.push({ tick, data: [...b.slice(at, at + size)] });
      at += size;
    }
    tracks.push(ev);
    i = end;
  }
  return tracks;
}

describe("midi export with a time signature for each section", () => {
  const sec = (beats: number, num: number, den: 4 | 8, tune?: PlayItem["tune"]): PlayItem => ({ midi: [null, 48, 52, 55, 60, 64], beats, section: true, tune, meter: { bar: den === 8 ? num / 3 : num, triplet: den === 8, sig: { num, den } } });
  // a bar of 4/4, a bar of 6/8 (two dotted-quarter beats) with a note on its second beat, a bar of 3/4
  const items = [sec(4, 4, 4, null), sec(2, 6, 8, { m: { div: 3, bars: 1, notes: [{ at: 12, midi: 72 }] }, bar: 2, swing: 0 }), sec(3, 3, 4, null)];

  it("writes each signature where its section starts, and the tempo where a beat changes between a quarter and a dotted quarter", () => {
    const [first, melody] = readMidi(progressionToMidi(items, 120, "ring", "x", null, null, {}, { num: 4, den: 4 }));
    const meta = first.filter((e) => e.data[0] === 0xff && (e.data[1] === 0x58 || e.data[1] === 0x51)).map((e) => [e.tick, ...e.data]);
    expect(meta).toEqual([
      [0, 255, 81, 3, 7, 161, 32], // 120 quarters a minute
      [0, 255, 88, 4, 4, 2, 24, 8],
      [1920, 255, 81, 3, 5, 22, 21], // 120 dotted quarters a minute: 333333 µs to a quarter
      [1920, 255, 88, 4, 6, 3, 36, 8],
      [3360, 255, 81, 3, 7, 161, 32],
      [3360, 255, 88, 4, 3, 2, 24, 8],
    ]);
    // 4/4 to 3/4: the beat stays a quarter, so the tempo is not written again
    const plain = readMidi(progressionToMidi([sec(4, 4, 4), sec(3, 3, 4)], 120, "ring"))[0];
    expect(plain.filter((e) => e.data[1] === 0x51)).toHaveLength(1);
    expect(plain.filter((e) => e.data[1] === 0x58).map((e) => [e.tick, e.data[3]])).toEqual([[0, 4], [1920, 3]]);
    // every note of each section lands inside it; the song ends with the 3/4 bar
    const ons = first.filter((e) => (e.data[0] & 0xf0) === 0x90 && e.data[2] > 0).map((e) => e.tick);
    expect(ons.some((t) => t >= 1920 && t < 3360)).toBe(true);
    expect(ons.some((t) => t >= 3360 && t < 4800)).toBe(true);
    expect(first[first.length - 1]).toEqual({ tick: 4800, data: [0xff, 0x2f, 0] });
    // the 6/8 bar's second beat is a dotted quarter after it starts: 720 ticks
    expect(melody.find((e) => (e.data[0] & 0xf0) === 0x90)!.tick).toBe(2640);
  });

  it("a song in one signature is written as it always was", () => {
    const one = [sec(4, 4, 4), sec(4, 4, 4)];
    const a = progressionToMidi(one, 100, "strum", "x", null, null, {}, { num: 4, den: 4 });
    const b = progressionToMidi(one.map(({ meter: _m, ...x }) => x), 100, "strum", "x");
    expect([...a]).toEqual([...b]);
  });
});
