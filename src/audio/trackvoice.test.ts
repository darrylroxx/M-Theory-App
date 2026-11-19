import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio, FakeOffline, asAudio, type FakeAny } from "./fakectx";
import type { FakeParam } from "../keys/fakeaudio";
import { TrackVoice } from "./trackvoice";
import { playChord, playTuneNote, playTuneSpan, synthWay, tuneSection, type SynthCache } from "./trackplay";
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
  it("■ stops the synth's notes and fades the track out, its room too; the next note brings it back in full", () => {
    const c = new FakeAudio();
    const { v } = voice(c);
    v.setTone({ inst: "synth", synth: presetById("saw-drone")!.params });
    playChord(v, { midi: C, beats: 16 }, 0.1, 0.5, "ring", 0, null, new Map(), () => ({ key: "d", t0: 0.1, chords: [{ midi: C, at: 0, beats: 16 }] }));
    c.currentTime = 2;
    v.stopAll();
    expect(synthEvents(v).some((e) => e.type === "stop" && e.t === 2)).toBe(true);
    const out = v.out.gain as unknown as FakeParam;
    // silent (below −60 dB) within half a second of ■, though the drone lets go over six seconds
    expect(out.at(2.5)).toBeLessThan(0.001);
    expect(out.at(10)).toBeLessThan(0.001);
    // ▶ again: back to full before the first note
    c.currentTime = 4;
    v.note(48, 4.08, 0.8, 1);
    expect(out.at(4.08)).toBeGreaterThan(0.95);
  });
});

describe("a melody on the synth, played its way", () => {
  const lead = presetById("pwm-lead")!.params;
  const way = (play: Partial<typeof lead.play>): Tone => ({ inst: "synth", synth: { ...lead, play: { ...lead.play, ...play } } });
  // C E G, a beat each, then a rest to the end of a 4-beat section (12 ticks a beat)
  const tune = { m: { div: 1 as const, bars: 1, notes: [{ at: 0, midi: 72 }, { at: 12, midi: 76 }, { at: 24, midi: 79 }] }, bar: 4, swing: 0 };
  const spb = 0.5;
  /** the section played a twelfth of a beat at a time, as the live player does */
  const play = (tone: Tone) => {
    const c = new FakeAudio();
    const { v } = voice(c, "melody");
    v.setTone(tone);
    const cache: SynthCache = new Map();
    for (let k = 0; k < 48; k++) playTuneSpan(v, cache, "m", tune, 1, spb, 4, 1 + (k * spb) / 12, 1 + ((k + 1) * spb) / 12);
    return v;
  };
  const lengths = (v: TrackVoice) => {
    const ev = synthEvents(v);
    return ons(v).map((on) => ({ midi: on.midi, t: on.t, len: (ev.find((e) => e.type === "off" && e.id === on.id) as { t: number }).t - on.t }));
  };

  it("reads the section's notes, each held until the next and the last to the end", () => {
    expect(tuneSection(tune.m, tune.bar, 0, 4)).toEqual([{ midi: [72], at: 0, beats: 1 }, { midi: [76], at: 1, beats: 1 }, { midi: [79], at: 2, beats: 2 }]);
  });
  it("note for note only when it is set to Hold, so nothing changes for a plain lead", () => {
    const c = new FakeAudio();
    expect(synthWay(voice(c, "melody").v)).toBe(false);
    const { v } = voice(c, "melody");
    v.setTone(way({ mode: "sustain", humanise: 0 }));
    expect(synthWay(v)).toBe(false);
    v.setTone(way({ mode: "glide" }));
    expect(synthWay(v)).toBe(true);
  });
  it("Glide: each note is held into the next, so the lead slides, and every note is played once", () => {
    const n = lengths(play(way({ mode: "glide", humanise: 0 })));
    expect(n.map((x) => x.midi)).toEqual([72, 76, 79]);
    expect(n[0].len).toBeGreaterThan(spb);
    expect(n[1].len).toBeGreaterThan(spb);
    expect(n[0].t).toBeCloseTo(1, 5);
  });
  it("Arp: a held note runs at its rate", () => {
    const n = lengths(play(way({ mode: "arp", rate: "1/8", octaves: 2, pattern: "up", humanise: 0 })));
    // C for a beat in eighths over two octaves: C, C an octave up; then E, E'; then G, G' for two beats
    expect(n.map((x) => x.midi)).toEqual([72, 84, 76, 88, 79, 91, 79, 91]);
  });
  it("Drone: the home note is held under the tune for the whole section", () => {
    const n = lengths(play(way({ mode: "drone", humanise: 0 })));
    // the home note low down and its fifth, from the first note to the end of the section
    const held = n.filter((x) => Math.abs(x.t - 1) < 1e-6 && Math.abs(x.len - 4 * spb) < 1e-3).map((x) => x.midi);
    expect(held).toContain(36);
    expect(held).toContain(43);
  });
});

describe("a melody on the synth, played its way, at any tempo and in any loop", () => {
  const lead = presetById("pwm-lead")!.params;
  const way = (play: Partial<typeof lead.play>): Tone => ({ inst: "synth", synth: { ...lead, play: { ...lead.play, humanise: 0, ...play } } });
  // a two-bar section: a note on every beat, then the last held for two beats
  const tune = { m: { div: 1 as const, bars: 2, notes: [60, 62, 64, 65, 67, 69].map((midi, i) => ({ at: i * 12, midi })) }, bar: 4, swing: 0 };
  /**
   * The section played as the live player plays it: a twelfth of a beat at a time from beat
   * `from` (a loop's start), each stretch's start and end worked out on their own. What was
   * played, and what the section holds from there on.
   */
  const live = (bpm: number, t: number, tone: Tone, from = 0, m = tune) => {
    const spb = 60 / bpm;
    const c = new FakeAudio();
    const { v } = voice(c, "melody");
    v.setTone(tone);
    const cache: SynthCache = new Map();
    const t0 = t - from * spb;
    for (let k = from * 12; k < 8 * 12; k++) {
      const base = t + (k / 12 - from) * spb;
      playTuneSpan(v, cache, "m", m, t0, spb, 8, base, base + spb / 12, from);
    }
    const got = ons(v).map((n) => `${n.midi}@${(n.t - t0).toFixed(4)}`);
    const all = [...cache.values()].flat().map((n) => `${n.midi}@${(Math.max(n.start, 0) - t0).toFixed(4)}`);
    return { got, all };
  };
  const ways: [string, Tone][] = [["Arp 1/16", way({ mode: "arp", rate: "1/16", octaves: 1, pattern: "up" })], ["Arp 1/32", way({ mode: "arp", rate: "1/32", octaves: 1, pattern: "up" })], ["Pulse", way({ mode: "pulse", rate: "1/8" })], ["Glide", way({ mode: "glide" })], ["Drone", way({ mode: "drone" })]];
  for (const [name, tone] of ways)
    it(`${name}: every note of the section is played once, wherever the clock is (100, 160 and 200 bpm)`, () => {
      for (const bpm of [100, 160, 200])
        for (const t of [0.08, 1.2345, 7.77, 13.0123]) {
          const { got, all } = live(bpm, t, tone);
          expect(got.length).toBeGreaterThan(0);
          expect([...got].sort()).toEqual([...all].sort());
        }
    });
  it("Drone, in a loop of its second bar: what is held under the section sounds from the loop's start", () => {
    // C on beat 1, E from beat 4 into the second bar, G on its third beat
    const held = { ...tune, m: { ...tune.m, notes: [{ at: 0, midi: 60 }, { at: 36, midi: 64 }, { at: 72, midi: 67 }] } };
    const { got } = live(120, 3.1, way({ mode: "drone" }), 4, held);
    // the drone and the note still sounding where the loop starts begin there, every time round
    const atStart = got.filter((x) => x.endsWith(`@${(4 * 0.5).toFixed(4)}`)).map((x) => Number(x.split("@")[0]));
    // (nothing starts there in the tune itself: the E began a beat before)
    expect(atStart.length).toBeGreaterThanOrEqual(3);
    expect(atStart.some((m) => m % 12 === 4)).toBe(true);
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

describe("the arpeggiator's rhythm in a song", () => {
  const rhythm = "X..x..x.x..x..x."; // sixteen steps: more than a bar of 3/4 holds
  const base = presetById("arp-pluck")!.params;
  const synthArp = (play: Partial<typeof base.play>): Tone => ({ inst: "synth", synth: { ...base, play: { ...base.play, ...play } } });
  // (sixteen sixteenths take two bars of 3/4: all sixteen, then eight of them to the end of the second bar)
  const twoBars = Array.from({ length: 24 }, (_, i) => i).filter((i) => rhythm[i % 16] !== ".");
  it("a chords track starts the rhythm again on a bar line of its section once it has played through (3/4 here)", () => {
    const c = new FakeAudio();
    const { v } = voice(c);
    v.setTone(synthArp({ mode: "arp", pattern: "up", rate: "1/16", octaves: 1, rhythm, humanise: 0 }));
    const spb = 0.5;
    const chords = [{ midi: C, at: 0, beats: 6 }];
    playChord(v, { midi: C, beats: 6, meter: { bar: 3 } }, 1, spb, "ring", 0, null, new Map(), () => ({ key: "r", t0: 1, chords }));
    const steps = ons(v).map((n) => Math.round((n.t - 1) / (spb / 4)));
    expect(steps).toEqual(twoBars);
  });
  it("so does a melody track, by its bars", () => {
    const c = new FakeAudio();
    const { v } = voice(c, "melody");
    v.setTone(synthArp({ mode: "arp", pattern: "up", rate: "1/16", octaves: 2, rhythm, humanise: 0 }));
    const tune = { m: { div: 1 as const, bars: 2, notes: [{ at: 0, midi: 72 }] }, bar: 3, swing: 0 };
    const cache: SynthCache = new Map();
    for (let k = 0; k < 72; k++) playTuneSpan(v, cache, "m", tune, 1, 0.5, 6, 1 + (k * 0.5) / 12, 1 + ((k + 1) * 0.5) / 12);
    const steps = ons(v).map((n) => Math.round((n.t - 1) / 0.125));
    expect(steps).toEqual(twoBars);
  });
});
