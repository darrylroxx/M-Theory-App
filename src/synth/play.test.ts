import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, DEFAULT_PLAY, type PlaySettings } from "./params";
import { DRONE_SUSTAIN, type PlayNote, arp, arpOrder, chordsOf, drone, glide, humanise, playNotes, pulse, rateBeats, strum, sustain, voiceForPlay } from "./play";

const chord = (midis: number[], start: number, length: number, velocity = 0.8): PlayNote[] => midis.map((midi) => ({ midi, start, length, velocity }));
// C major for two beats, then A minor for two beats, at 120 bpm (a beat is half a second)
const song: PlayNote[] = [...chord([60, 64, 67], 0, 1), ...chord([57, 60, 64], 1, 1)];
const ctx = { bpm: 120, seed: 3 };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe("ways of playing", () => {
  it("groups notes struck together into chords", () => {
    const c = chordsOf(song);
    expect(c.length).toBe(2);
    expect(c[0].map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(c[1].map((n) => n.midi)).toEqual([57, 60, 64]);
  });

  it("Sustain plays exactly what is written", () => {
    expect(sustain(song).map((n) => [n.midi, n.start, n.length])).toEqual(song.map((n) => [n.midi, n.start, n.length]).sort((a, b) => a[1] - b[1] || a[0] - b[0]));
  });

  it("arpeggio orders: up, down, up-down, crawl, and random that is the same for the same seed", () => {
    expect(arpOrder([60, 64, 67], "up", 1)).toEqual([60, 64, 67]);
    expect(arpOrder([60, 64, 67], "down", 1)).toEqual([67, 64, 60]);
    expect(arpOrder([60, 64, 67], "up", 2)).toEqual([60, 64, 67, 72, 76, 79]);
    expect(arpOrder([60, 64, 67], "updown", 1)).toEqual([60, 64, 67, 64]);
    expect(arpOrder([60, 64, 67], "crawl", 1)).toEqual([60, 64, 67, 64, 67, 72, 67, 72, 76, 72, 76, 79]);
    const r1 = arp(song, { pattern: "random", rate: "1/16", octaves: 2, gate: 0.5 }, ctx).map((n) => n.midi);
    const r2 = arp(song, { pattern: "random", rate: "1/16", octaves: 2, gate: 0.5 }, ctx).map((n) => n.midi);
    expect(r1).toEqual(r2);
    expect(new Set(r1.slice(0, 6))).toEqual(new Set([60, 64, 67, 72, 76, 79]));
  });

  it("an arpeggio steps at the rate, holds each note for the gate, and starts again at each chord", () => {
    const out = arp(song, { pattern: "up", rate: "1/16", octaves: 1, gate: 0.5 }, ctx);
    // a sixteenth at 120 bpm is 125 ms: 8 steps per chord
    expect(out.length).toBe(16);
    expect(out.slice(0, 4).map((n) => n.midi)).toEqual([60, 64, 67, 60]);
    expect(near(out[1].start, 0.125)).toBe(true);
    expect(near(out[0].length, 0.0625)).toBe(true);
    // the second chord starts its own pattern from its lowest note
    expect(out[8].midi).toBe(57);
    expect(near(out[8].start, 1)).toBe(true);
    // the beat is accented
    expect(out[0].velocity).toBeGreaterThan(out[1].velocity);
    // triplet rates
    expect(rateBeats("1/8T")).toBeCloseTo(1 / 3, 9);
    expect(rateBeats("1/16T")).toBeCloseTo(1 / 6, 9);
    const trip = arp(song, { pattern: "up", rate: "1/8T", octaves: 1, gate: 1 }, ctx);
    expect(trip.length).toBe(12);
    expect(near(trip[1].start - trip[0].start, 1 / 6)).toBe(true);
    // every rate fits whole steps into a chord and never runs past it
    for (const rate of ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"] as const) {
      for (const n of arp(song, { pattern: "updown", rate, octaves: 3, gate: 1 }, ctx)) expect(n.start + n.length).toBeLessThanOrEqual((n.start < 1 ? 1 : 2) + 1e-9);
    }
  });

  it("the chord pattern strikes the whole chord each step, jumping octaves", () => {
    const out = arp(song, { pattern: "chord", rate: "1/8", octaves: 2, gate: 0.5 }, ctx);
    const first = out.filter((n) => near(n.start, 0)).map((n) => n.midi);
    const second = out.filter((n) => near(n.start, 0.25)).map((n) => n.midi);
    expect(first).toEqual([60, 64, 67]);
    expect(second).toEqual([72, 76, 79]);
  });

  it("Strum spreads each chord like a hand across strings, down, up or alternating, and lets go together", () => {
    const down = strum(song, { spread: 0, direction: "down" });
    expect(down.slice(0, 3).map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(near(down[1].start - down[0].start, 0.01)).toBe(true);
    const wide = strum(song, { spread: 1, direction: "up" });
    expect(wide.slice(0, 3).map((n) => n.midi)).toEqual([67, 64, 60]);
    expect(near(wide[1].start - wide[0].start, 0.08)).toBe(true);
    for (const n of wide.slice(0, 3)) expect(near(n.start + n.length, 1)).toBe(true);
    const alt = strum(song, { spread: 0.5, direction: "alternate" });
    expect(alt.slice(0, 3).map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(alt.slice(3, 6).map((n) => n.midi)).toEqual([64, 60, 57]);
    // later strings are a touch softer
    expect(down[2].velocity).toBeLessThan(down[0].velocity);
  });

  it("Pulse strikes the chord again on the grid of the song", () => {
    const out = pulse(song, { rate: "1/8", gate: 0.5 }, ctx);
    const starts = [...new Set(out.map((n) => n.start.toFixed(4)))];
    expect(starts.length).toBe(8);
    expect(out.filter((n) => near(n.start, 0.25)).map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(near(out[0].length, 0.125)).toBe(true);
    // a chord that starts off the grid is struck at once, then joins the grid
    const late = pulse(chord([60, 64], 0.1, 0.6), { rate: "1/4", gate: 1 }, { bpm: 120, origin: 0 });
    expect([...new Set(late.map((n) => n.start))]).toEqual([0.1, 0.5]);
  });

  it("Drone holds the home note and its fifth under every chord, and a softer voice follows the chords", () => {
    const out = drone(song, { bpm: 120, tonic: 0 });
    const held = out.filter((n) => n.slot !== undefined && n.slot >= 100 && n.slot <= 102);
    expect(held.map((n) => n.midi)).toEqual([36, 43, 48]);
    for (const n of held) {
      expect(n.start).toBe(0);
      expect(near(n.length, 2)).toBe(true);
    }
    const moving = out.filter((n) => n.slot === 103);
    expect(moving.map((n) => n.midi % 12)).toEqual([0, 9]);
    expect(moving[1].start).toBe(1);
    expect(moving[0].velocity).toBeLessThan(held[0].velocity);
    // the key's home note, not the first chord's, when it is given
    expect(drone(song, { bpm: 120, tonic: 9 })[0].midi % 12).toBe(9);
  });

  it("Glide plays one line, each note held into the next so a legato voice slides", () => {
    const line: PlayNote[] = [
      ...chord([48, 60], 0, 0.4),
      { midi: 62, start: 0.5, length: 0.4, velocity: 0.8 },
      { midi: 64, start: 3, length: 0.5, velocity: 0.8 },
    ];
    const out = glide(line, ctx);
    expect(out.map((n) => n.midi)).toEqual([60, 62, 64]);
    // joined across a short gap, not across a long rest
    expect(out[0].start + out[0].length).toBeGreaterThan(out[1].start);
    expect(out[1].start + out[1].length).toBeLessThan(out[2].start);
    expect(out.every((n) => n.slot === 0)).toBe(true);
  });

  it("Humanise loosens timing by up to 20 ms and touch by up to 15%, keeps chords together, and repeats for a seed", () => {
    const notes = arp(song, { pattern: "up", rate: "1/16", octaves: 1, gate: 0.5 }, ctx);
    expect(humanise(notes, 0)).toEqual(notes);
    const a = humanise(song, 1, 5);
    const b = humanise(song, 1, 5);
    expect(a).toEqual(b);
    for (const n of a) {
      const orig = song.find((o) => o.midi === n.midi && Math.abs(o.start - n.start) < 0.03)!;
      expect(Math.abs(n.start - orig.start)).toBeLessThanOrEqual(0.02 + 1e-9);
      expect(Math.abs(n.velocity / orig.velocity - 1)).toBeLessThanOrEqual(0.15 + 1e-9);
    }
    const first = a.filter((n) => n.start < 0.5);
    expect(new Set(first.map((n) => n.start)).size).toBe(1);
  });

  it("each way of playing gets the voice it needs, and playNotes chooses by the settings", () => {
    expect(voiceForPlay({ ...DEFAULT_PARAMS, play: { ...DEFAULT_PLAY, mode: "glide" } }).voice).toBe("legato");
    expect(voiceForPlay({ ...DEFAULT_PARAMS, play: { ...DEFAULT_PLAY, mode: "glide" } }).glide).toBeGreaterThan(0);
    expect(voiceForPlay({ ...DEFAULT_PARAMS, voice: "mono", play: { ...DEFAULT_PLAY, mode: "drone" } }).voice).toBe("poly");
    // a drone is held: a sound that dies away (a pluck) is kept sounding; one that sustains is left alone
    expect(voiceForPlay({ ...DEFAULT_PARAMS, sustain: 0, play: { ...DEFAULT_PLAY, mode: "drone" } }).sustain).toBe(DRONE_SUSTAIN);
    expect(voiceForPlay({ ...DEFAULT_PARAMS, sustain: 0.9, play: { ...DEFAULT_PLAY, mode: "drone" } }).sustain).toBe(0.9);
    expect(voiceForPlay({ ...DEFAULT_PARAMS, sustain: 0, play: { ...DEFAULT_PLAY, mode: "arp" } }).sustain).toBe(0);
    const s = (mode: PlaySettings["mode"]) => playNotes(song, { ...DEFAULT_PLAY, mode }, ctx).length;
    expect(s("sustain")).toBe(6);
    expect(s("arp")).toBe(16);
    expect(s("strum")).toBe(6);
    expect(s("pulse")).toBe(48);
    expect(s("drone")).toBe(5);
    expect(s("glide")).toBe(2);
    // bad input is skipped, not played
    expect(playNotes([{ midi: Number.NaN, start: 0, length: 1, velocity: 1 }, { midi: 60, start: 0, length: 0, velocity: 1 }], DEFAULT_PLAY, ctx)).toEqual([]);
  });
});
