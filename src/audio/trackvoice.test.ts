import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio, FakeOffline, asAudio, type FakeAny } from "./fakectx";
import { TrackVoice } from "./trackvoice";
import { playChord, playTuneNote, type SynthCache } from "./trackplay";
import { SOUND_DEFAULT } from "./rack";
import { GUITAR, type Tone } from "./tone";
import { presetById } from "../synth/presets";
import { progressionToMidi } from "./midi";
import type { PlayItem } from "./patterns";
import type { SynthEvent } from "../synth/kernel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const voice = (c: FakeAudio, kind: "chord" | "melody" = "chord") => {
  const dest = c.createGain() as unknown as AudioNode;
  return { v: new TrackVoice(asAudio(c), dest, kind), dest };
};
/** What a synth was told to play (before its processor exists, everything waits in a list). */
const synthEvents = (v: TrackVoice): SynthEvent[] => (v.instrument as unknown as { pending: SynthEvent[] }).pending;
const ons = (v: TrackVoice) => synthEvents(v).filter((e): e is Extract<SynthEvent, { type: "on" }> => e.type === "on");
const arp: Tone = { inst: "synth", synth: presetById("arp-pluck")!.params };
const pad: Tone = { inst: "synth", synth: presetById("warm-pad")!.params };
const C = [48, 52, 55, 60];

describe("a track's voice", () => {
  it("plays into its own rack and out through its own fader", () => {
    const c = new FakeAudio();
    const a = voice(c);
    const b = voice(c);
    a.v.note(60, 0.1, 0.8, 1, { slot: 0 });
    const src = c.started[0];
    expect(c.reaches(src, a.dest)).toBe(true);
    expect(c.reaches(src, b.dest)).toBe(false);
  });
  it("keeps its rack and fader when its instrument changes", () => {
    const c = new FakeAudio();
    const { v, dest } = voice(c);
    const rack = v.rack;
    v.setTone({ inst: "synth" });
    expect(v.rack).toBe(rack);
    expect(c.reaches(v.instrument!.output, rack.input)).toBe(true);
    expect(c.reaches(v.instrument!.output, dest)).toBe(true);
    v.setTone({ inst: "piano", keys: "electric" });
    expect(c.reaches(v.instrument!.output, dest)).toBe(true);
  });
  it("lets everything go when it is done", () => {
    const c = new FakeAudio();
    const { v } = voice(c);
    v.setTone({ inst: "synth" });
    const out = v.instrument!.output as unknown as FakeAny;
    v.dispose();
    vi.advanceTimersByTime(500);
    expect(out.outputs.length).toBe(0);
    expect((v.out as unknown as FakeAny).outputs.length).toBe(0);
    // a note after that is not played
    v.note(60, 1, 0.8, 1);
    expect(c.started.length).toBe(0);
  });
  it("on the synth, an arpeggio shapes the chord into a run of single notes across the section", () => {
    const c = new FakeAudio();
    const { v } = voice(c);
    v.setTone(arp);
    const cache: SynthCache = new Map();
    const chords = [{ midi: C, at: 0, beats: 4 }, { midi: [53, 57, 60, 65], at: 4, beats: 4 }];
    const sec = () => ({ key: "s", t0: 0, chords });
    playChord(v, { midi: C, beats: 4 }, 0, 0.5, "ring", 0, null, cache, sec);
    const first = ons(v).length;
    playChord(v, { midi: chords[1].midi, beats: 4 }, 2, 0.5, "ring", 4, null, cache, sec);
    const notes = ons(v);
    // sixteenths: four notes to a beat, one at a time, each chord's own notes under it
    expect(first).toBeGreaterThanOrEqual(14);
    expect(new Set(notes.map((n) => n.t.toFixed(3))).size).toBe(notes.length);
    expect(notes.filter((n) => n.t < 2 - 0.05).every((n) => C.map((m) => m % 12).includes(n.midi % 12))).toBe(true);
    // each note played once, by the chord it falls under
    expect(notes.length).toBeLessThanOrEqual(34);
  });
  it("on the synth, a chord changed while its section plays is heard from the next chord on", () => {
    const c = new FakeAudio();
    const { v } = voice(c);
    v.setTone(arp);
    const cache: SynthCache = new Map();
    const F = [53, 57, 60, 65];
    const G = [55, 59, 62, 67];
    playChord(v, { midi: C, beats: 4 }, 0, 0.5, "ring", 0, null, cache, () => ({ key: "s", t0: 0, chords: [{ midi: C, at: 0, beats: 4 }, { midi: F, at: 4, beats: 4 }] }));
    const before = ons(v).length;
    // the second chord is changed from F to G before it comes round
    playChord(v, { midi: G, beats: 4 }, 2, 0.5, "ring", 4, null, cache, () => ({ key: "s", t0: 0, chords: [{ midi: C, at: 0, beats: 4 }, { midi: G, at: 4, beats: 4 }] }));
    const second = ons(v).slice(before);
    expect(second.length).toBeGreaterThan(8);
    expect(second.every((n) => G.map((m) => m % 12).includes(n.midi % 12))).toBe(true);
  });
  it("on the synth as written, the chord is held for its length", () => {
    const c = new FakeAudio();
    const { v } = voice(c);
    v.setTone(pad);
    playChord(v, { midi: C, beats: 4 }, 1, 0.5, "ring", 0, null, new Map(), () => ({ key: "s", t0: 1, chords: [{ midi: C, at: 0, beats: 4 }] }));
    const on = ons(v);
    expect(on.map((n) => n.midi).sort()).toEqual(C);
    const offs = synthEvents(v).filter((e) => e.type === "off");
    expect(offs.every((e) => Math.abs(e.t - 3) < 0.15)).toBe(true);
  });
  it("books a section's own sound once, at the moment the section starts", () => {
    const c = new FakeAudio();
    const { v } = voice(c);
    const set = vi.spyOn(v.rack, "set");
    const mine = { ...SOUND_DEFAULT, echo: 0.6 };
    playChord(v, { midi: C, beats: 4, sound: mine }, 2, 0.5, "ring", 0, null, new Map(), () => ({ key: "a", t0: 2, chords: [] }));
    playChord(v, { midi: C, beats: 4, sound: mine }, 4, 0.5, "ring", 4, null, new Map(), () => ({ key: "a", t0: 2, chords: [] }));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][2]).toBe(2);
  });
  it("holds a melody note on the keys until the next one, and never past the end of its section", () => {
    const c = new FakeAudio();
    const { v } = voice(c, "melody");
    v.setTone({ inst: "synth" });
    playTuneNote(v, 72, 1, 0.5, 4, 0);
    playTuneNote(v, 74, 3.8, Infinity, 4, 0);
    const ev = synthEvents(v);
    const len = (midi: number) => {
      const on = ev.find((e) => e.type === "on" && e.midi === midi) as Extract<SynthEvent, { type: "on" }>;
      const off = ev.find((e) => e.type === "off" && e.id === on.id)!;
      return (off as { t: number }).t - on.t;
    };
    expect(len(72)).toBeCloseTo(0.5, 5);
    expect(len(74)).toBeCloseTo(0.2, 5);
  });
  it("gives every key of a big chord its own place: more than six keys never share a string", () => {
    const c = new FakeOffline();
    const { v } = voice(c);
    v.setTone({ inst: "piano" });
    const big = [36, 43, 48, 52, 55, 60, 64, 67];
    playChord(v, { midi: big, beats: 4, style: "block" }, 0, 0.5, "block", 0, null, new Map(), () => ({ key: "b", t0: 0, chords: [] }));
    // offline the piano writes its notes down until their recordings are loaded
    const wanted = (v as unknown as { wanted: { midi: number }[] }).wanted.map((n) => n.midi);
    for (const m of big) expect(wanted).toContain(m);
  });
  it("the strings still play as they always did", () => {
    const c = new FakeAudio();
    const { v } = voice(c);
    v.setTone(GUITAR);
    expect(v.instrument).toBeNull();
    playChord(v, { midi: [40, 47, 52, 56, 59, 64], beats: 4 }, 0, 0.5, "ring", 0, null, new Map(), () => ({ key: "g", t0: 0, chords: [] }));
    expect(c.started.length).toBeGreaterThanOrEqual(6);
  });
});

describe("MIDI files", () => {
  const items: PlayItem[] = [{ midi: C, beats: 4 }];
  const programs = (b: Uint8Array) => [...b].flatMap((x, i) => ((x & 0xf0) === 0xc0 && b[i - 1] === 0 ? [b[i + 1]] : []));
  it("write each track with its instrument's program", () => {
    expect(programs(progressionToMidi(items, 100, "ring"))).toEqual([46]);
    expect(programs(progressionToMidi(items, 100, "ring", "x", null, null, {}, { num: 4, den: 4 }, { chords: { inst: "piano" } }))).toEqual([0]);
    expect(programs(progressionToMidi(items, 100, "ring", "x", null, null, {}, { num: 4, den: 4 }, { chords: { inst: "piano", keys: "electric" } }))).toEqual([4]);
    expect(programs(progressionToMidi(items, 100, "ring", "x", null, null, {}, { num: 4, den: 4 }, { chords: { inst: "synth", synth: presetById("supersaw-lead")!.params } }))).toEqual([81]);
  });
  it("write a synth track's chords held, once each", () => {
    const b = progressionToMidi(items, 100, "ring", "x", null, null, {}, { num: 4, den: 4 }, { chords: pad });
    const noteOns = [...b].filter((x, i) => (x & 0xf0) === 0x90 && b[i + 2] > 0 && C.includes(b[i + 1])).length;
    expect(noteOns).toBe(C.length);
  });
});
