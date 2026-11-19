/**
 * Every sound the app plays reaches the canvas: each instrument a chords or melody track can be
 * played on (the strings, the grand and the electric piano, the synth in every way of playing)
 * and every drums track's desk tells the canvas of each note and hit, with its track, at the
 * moment it is heard; and each is painted as what it is (a held pad as a held wash, an arp as
 * quick notes, a drone as a long low line).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio, asAudio } from "../audio/fakectx";
import { TrackVoice, pianoShape, synthShape } from "../audio/trackvoice";
import { playChord, playTuneNote, playTuneSpan, type SynthCache } from "../audio/trackplay";
import { due, listen, type NotePulse, type Pulse } from "../audio/pulse";
import { playStep } from "../audio/drumbus";
import { DEFAULT_BEAT, type Beat } from "../audio/beats";
import { setMix } from "../audio/mix";
import { GUITAR, type Tone } from "../audio/tone";
import { presetById } from "../synth/presets";
import type { PlaySettings } from "../synth/params";
import type { SynthEvent } from "../synth/kernel";
import type { Track } from "../song/tracks";
import { cueOfPulse } from "./cues";
import { handOf, layerOf, planTaps } from "./taps";
import { fileWhen } from "./clock";
import { Artist, type LayerCue } from "./painting";
import { getPalette } from "./palettes";

let stop: () => void = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  stop = listen();
  setMix(undefined);
});
afterEach(() => {
  stop();
  setMix(undefined);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const C = [48, 52, 55, 60];
const F = [53, 57, 60, 65];
const SPB = 0.5;
const chords = [{ midi: C, at: 0, beats: 4 }, { midi: F, at: 4, beats: 4 }];
const ons = (v: TrackVoice) => (v.instrument as unknown as { pending: SynthEvent[] }).pending.filter((e): e is Extract<SynthEvent, { type: "on" }> => e.type === "on");
const synth = (id: string, play: Partial<PlaySettings> = {}): Tone => {
  const p = presetById(id)!.params;
  return { inst: "synth", synth: { ...p, play: { ...p.play, ...play } } };
};

/** A chords track's two bars of C and F, on a tone, as the player plays them. */
function chordsOn(tone: Tone, track: string | null = "c2") {
  const c = new FakeAudio();
  const v = new TrackVoice(asAudio(c), c.createGain() as unknown as AudioNode, "chord", track ?? undefined);
  v.setTone(tone);
  const played: number[] = [];
  if (v.instrument && tone.inst === "piano") {
    const inst = v.instrument;
    const real = inst.play.bind(inst);
    inst.play = (midi, when, vel, len, slot) => {
      played.push(when);
      real(midi, when, vel, len, slot);
    };
  }
  const cache: SynthCache = new Map();
  const sec = () => ({ key: "s", t0: 1, chords });
  for (const ch of chords) playChord(v, { midi: ch.midi, beats: ch.beats }, 1 + ch.at * SPB, SPB, "ring", ch.at, null, cache, sec);
  const heard = tone.inst === "synth" ? ons(v).map((e) => e.t) : tone.inst === "piano" ? played : c.started.map((s) => (s as unknown as { started: { when: number } }).started.when);
  return { v, pulses: due(Infinity) as NotePulse[], heard };
}

/** A melody track's tune (C E G, a beat each, then held), on a tone. */
function tuneOn(tone: Tone, track = "m2") {
  const c = new FakeAudio();
  const v = new TrackVoice(asAudio(c), c.createGain() as unknown as AudioNode, "melody", track);
  v.setTone(tone);
  const tune = { m: { div: 1 as const, bars: 1, notes: [{ at: 0, midi: 72 }, { at: 12, midi: 76 }, { at: 24, midi: 79 }] }, bar: 4, swing: 0 };
  const cache: SynthCache = new Map();
  const way = tone.inst === "synth" && (tone.synth!.play.mode !== "sustain" || tone.synth!.play.humanise > 0);
  if (way) for (let k = 0; k < 48; k++) playTuneSpan(v, cache, "m", tune, 1, SPB, 4, 1 + (k * SPB) / 12, 1 + ((k + 1) * SPB) / 12);
  else [72, 76, 79].forEach((m, i) => playTuneNote(v, m, 1 + i * SPB, i < 2 ? SPB : 2 * SPB, 3, 0));
  return { v, pulses: due(Infinity) as NotePulse[], heard: tone.inst === "synth" ? ons(v).map((e) => e.t) : [] };
}

const sameTimes = (a: number[], b: number[]) => {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  expect(x.length).toBe(y.length);
  x.forEach((t, i) => expect(t).toBeCloseTo(y[i], 6));
};

describe("every instrument tells the canvas of its notes, with its track, at the moment they are heard", () => {
  it("the strings, the grand piano and the electric piano", () => {
    for (const tone of [GUITAR, { inst: "piano" } as Tone, { inst: "piano", keys: "electric" } as Tone]) {
      const { pulses, heard } = chordsOn(tone);
      expect(pulses.length).toBeGreaterThanOrEqual(8);
      expect(pulses.every((p) => p.kind === "chord" && p.track === "c2")).toBe(true);
      // every pulse is a note that sounds, at the moment it sounds (the strings may sound a copy of a note, an octave up)
      for (const p of pulses) expect(heard.some((t) => Math.abs(t - p.time) < 1e-6)).toBe(true);
      if (tone.inst === "piano") sameTimes(pulses.map((p) => p.time), heard);
    }
  });

  it("the synth's chords in every way of playing: Hold, Glide, Arp, Pulse, Drone, Strum and Loose", () => {
    const ways: Partial<PlaySettings>[] = [{ mode: "sustain" }, { mode: "glide" }, { mode: "arp", rate: "1/16" }, { mode: "pulse", rate: "1/8" }, { mode: "drone" }, { mode: "strum" }, { mode: "sustain", humanise: 0.8 }];
    for (const w of ways) {
      const { pulses, heard } = chordsOn(synth("warm-pad", { humanise: 0, ...w }));
      expect(pulses.length, JSON.stringify(w)).toBeGreaterThan(0);
      expect(pulses.every((p) => p.kind === "chord" && p.track === "c2")).toBe(true);
      sameTimes(pulses.map((p) => p.time), heard);
    }
  });

  it("the synth's melodies in every way of playing", () => {
    const ways: Partial<PlaySettings>[] = [{ mode: "sustain" }, { mode: "glide" }, { mode: "arp", rate: "1/8" }, { mode: "pulse", rate: "1/8" }, { mode: "drone" }, { mode: "sustain", humanise: 0.8 }];
    for (const w of ways) {
      const { pulses, heard } = tuneOn(synth("pwm-lead", { humanise: 0, ...w }));
      expect(pulses.length, JSON.stringify(w)).toBeGreaterThan(0);
      expect(pulses.every((p) => p.kind === "melody" && p.track === "m2")).toBe(true);
      sameTimes(pulses.map((p) => p.time), heard);
    }
    // and on the keys and the strings
    for (const tone of [GUITAR, { inst: "piano" } as Tone]) {
      const { pulses } = tuneOn(tone);
      expect(pulses.map((p) => p.time)).toEqual([1, 1.5, 2]);
      expect(pulses.every((p) => p.track === "m2")).toBe(true);
    }
  });

  it("the first tracks are told by their kind", () => {
    const { pulses } = chordsOn({ inst: "piano" }, null);
    expect(pulses.every((p) => p.track === undefined && p.kind === "chord")).toBe(true);
  });

  it("every drums track's hits, each with its own track, at the moment each is heard", () => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("AudioContext", FakeAudio);
    const beat: Beat = { ...DEFAULT_BEAT, on: true };
    playStep(beat, "kick", 3, 0.5, "drums");
    playStep(beat, "snare", 3, 0.75, "d2");
    playStep(beat, "hat", 2, 1, "d3");
    const hits = due(Infinity);
    expect(hits.map((h) => [h.kind, h.track, h.time])).toEqual([
      ["drum", undefined, 0.5],
      ["drum", "d2", 0.75],
      ["drum", "d3", 1],
    ]);
    // a muted drums track is not painted
    setMix({ d2: { mute: true } });
    playStep(beat, "snare", 3, 1.25, "d2");
    playStep(beat, "kick", 3, 1.5, "drums");
    expect(due(Infinity).map((h) => h.track)).toEqual([undefined]);
  });

  it("an offline render (an export) is on a clock of its own and is not painted", () => {
    const c = new FakeAudio();
    (c as unknown as { startRendering: () => void }).startRendering = () => {};
    for (const tone of [GUITAR, { inst: "piano" } as Tone, synth("warm-pad")]) {
      const v = new TrackVoice(asAudio(c), c.createGain() as unknown as AudioNode, "chord", "c2");
      v.setTone(tone);
      playChord(v, { midi: C, beats: 4 }, 0, SPB, "ring", 0, null, new Map(), () => ({ key: "s", t0: 0, chords: [chords[0]] }));
    }
    expect(due(Infinity)).toEqual([]);
  });
});

describe("each instrument is painted as what it is", () => {
  const tracks: Track[] = [
    { id: "c2", kind: "chords", name: "Chords 2" },
    { id: "h1", kind: "melody", name: "Melody 3", role: "harmony" },
    { id: "h2", kind: "chords", name: "Chords 3", role: "harmony" },
  ];
  // (six tracks in all: an ear and a hand each)
  const plans = planTaps({ tracks });
  let id = 1;
  const cues = (ps: Pulse[]) => ps.map((p) => cueOfPulse(p, id++, layerOf(plans), () => 1, handOf(plans)));

  it("a held pad swells in and holds; a plucked synth, the piano and the strings are struck and die away", () => {
    const pad = synthShape(presetById("warm-pad")!.params);
    expect(pad.attack).toBeLessThan(0.4);
    expect(pad.ring).toBeGreaterThan(12);
    const pluck = synthShape(presetById("arp-pluck")!.params);
    expect(pluck.attack).toBeGreaterThan(0.6);
    expect(pluck.ring).toBeLessThan(3);
    expect(pianoShape(false, 60).attack).toBeGreaterThan(0.7);
    // a piano's low notes ring longer than its high ones
    expect(pianoShape(false, 40).ring).toBeGreaterThan(pianoShape(false, 84).ring);
    const padCue = cues(chordsOn(synth("warm-pad", { mode: "sustain", humanise: 0 })).pulses).find((c) => c.layer === "chords")!;
    expect(padCue.cue.len).toBeCloseTo(4 * SPB, 1);
    expect(padCue.cue.attack).toBeLessThan(0.4);
  });

  it("an arp is quick notes, one at a time", () => {
    const cs = cues(chordsOn(synth("arp-pluck", { mode: "arp", rate: "1/16", humanise: 0 })).pulses);
    expect(cs.length).toBeGreaterThanOrEqual(24);
    expect(cs.every((c) => c.cue.len! < 0.16)).toBe(true);
    expect(new Set(cs.map((c) => c.cue.t.toFixed(4))).size).toBe(cs.length);
  });

  it("a drone is a long held line low down (the bass, under a chords track), held as long as it sounds", () => {
    const cs = cues(chordsOn(synth("saw-drone", { mode: "drone", humanise: 0 })).pulses);
    const low = cs.filter((c) => c.layer === "bass");
    expect(low.length).toBeGreaterThanOrEqual(2);
    // held for the whole two bars, not cut short
    for (const c of low) expect(c.cue.len).toBeCloseTo(8 * SPB, 2);
    expect(low.every((c) => c.key === "c2:bass")).toBe(true);
  });

  it("a harmony track paints in the harmony layer, a hand of its own, whatever it is played on", () => {
    for (const tone of [GUITAR, { inst: "piano" } as Tone, synth("pwm-lead", { mode: "arp", rate: "1/8", humanise: 0 })]) {
      const cs = cues(tuneOn(tone, "h1").pulses);
      expect(cs.length).toBeGreaterThan(0);
      expect(cs.every((c) => c.layer === "harmony" && c.key === "h1")).toBe(true);
    }
    // a chords track marked as a harmony too, its low notes included
    const cs = cues(chordsOn({ inst: "piano" }, "h2").pulses);
    expect(cs.every((c) => c.layer === "harmony" && c.key === "h2")).toBe(true);
  });

  it("a long synth pad does not cover more of the canvas than the same chords on the strings", () => {
    const cover = (tone: Tone) => {
      const a = new Artist();
      a.size(1000, 560);
      a.setPalette(getPalette("woodblock"));
      a.setKey(0, [0, 2, 4, 5, 7, 9, 11]);
      // eight bars of the same two chords, over and over
      const all: LayerCue[] = [];
      for (let k = 0; k < 4; k++) {
        const ps = chordsOn(tone).pulses.map((p) => ({ ...p, time: p.time + k * 4, length: p.length }));
        all.push(...cues(ps).map((c) => ({ ...c, cue: { ...c.cue, id: id++ } })));
      }
      all.sort((x, y) => x.cue.t - y.cue.t);
      let i = 0;
      for (let f = 0; f <= 17 * 60; f++) {
        const now = f / 60;
        const d: LayerCue[] = [];
        while (i < all.length && all[i].cue.t <= now + 0.3) d.push(all[i++]);
        a.hear({ now, when: fileWhen(16, 2, 1), mix: [], cues: d });
      }
      return { covered: a.budget.covered, target: a.budget.target };
    };
    const strings = cover(GUITAR);
    const pad = cover(synth("warm-pad", { mode: "sustain", humanise: 0 }));
    const drone = cover(synth("saw-drone", { mode: "drone", humanise: 0 }));
    expect(strings.covered).toBeGreaterThan(0.005);
    for (const x of [pad, drone]) {
      expect(x.covered).toBeLessThan(Math.max(1.3 * strings.covered, 1.2 * x.target));
      expect(x.covered).toBeGreaterThan(0.01);
    }
  });
});
