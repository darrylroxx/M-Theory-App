/**
 * Keys played by hand on the screen: a piano track (grand or electric) plays them as well as a
 * synth track, each note held until its key comes up; and each note reaches the canvas with its
 * track, at the moment it is heard, painted for as long as the key was held.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio, asAudio } from "../audio/fakectx";
import { HAND_LANE, TrackVoice } from "../audio/trackvoice";
import { due, dueReleases, listen, type NotePulse } from "../audio/pulse";
import { setMix } from "../audio/mix";
import { GUITAR, type Tone } from "../audio/tone";
import type { Keyboard, KeyVoice } from "../keys/keyboard";
import { presetById } from "../synth/presets";
import { LiveKeys } from "../synth/live";
import { DEFAULT_PLAY } from "../synth/params";
import type { SynthEvent } from "../synth/kernel";
import { HeldCues, cueOfPulse } from "./cues";
import { hexToRgb } from "./color";
import { layerColours } from "./layers";
import { MARGIN, hzOfMidi, noteColors } from "./layout";
import { getPalette } from "./palettes";
import { yOfUp } from "./place";
import type { Stamp } from "./sim";
import { LayerHand, type Cue } from "./strokes";

let stop: () => void = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  stop = listen();
  setMix(undefined);
});
afterEach(() => {
  stop();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const PIANOS: Tone[] = [{ inst: "piano" }, { inst: "piano", keys: "electric" }];
const PAD: Tone = { inst: "synth", synth: presetById("warm-pad")!.params };

/** A chords track's voice on a tone, with what its keyboard was asked to play and let go. */
function voiceOn(tone: Tone, track = "c2") {
  const c = new FakeAudio();
  const v = new TrackVoice(asAudio(c), c.createGain() as unknown as AudioNode, "chord", track);
  v.setTone(tone);
  const played: { midi: number; when: number; len: number; slot?: number }[] = [];
  const lifted: { slot: number; when: number }[] = [];
  const kb = v.instrument as unknown as Keyboard<KeyVoice> & { play: (m: number, w: number, v: number, l: number, s?: number) => void };
  if (tone.inst === "piano") {
    kb.play = (midi, when, _vel, len, slot) => void played.push({ midi, when, len, slot });
    const lift = kb.lift.bind(kb);
    kb.lift = (slot, when) => {
      lifted.push({ slot, when: when! });
      lift(slot, when);
    };
  }
  return { c, v, played, lifted };
}
const synthEvents = (v: TrackVoice) => (v.instrument as unknown as { pending: SynthEvent[] }).pending;

describe("keys played by hand", () => {
  it("a piano track, grand or electric, holds each key's note until it comes up, on a lane of its own", () => {
    for (const tone of PIANOS) {
      const { v, played, lifted } = voiceOn(tone);
      const a = v.hold(60, 1, 0.8);
      const b = v.hold(64, 1.1, 0.6);
      expect(a).toBeGreaterThan(0);
      expect(b).toBeGreaterThan(0);
      expect(a).not.toBe(b);
      expect(played).toEqual([
        { midi: 60, when: 1, len: Infinity, slot: HAND_LANE + 60 },
        { midi: 64, when: 1.1, len: Infinity, slot: HAND_LANE + 64 },
      ]);
      v.letGo(a, 2);
      expect(lifted).toEqual([{ slot: HAND_LANE + 60, when: 2 }]);
      // let go twice (or a key never held): nothing more
      v.letGo(a, 3);
      v.letGo(999, 3);
      expect(lifted).toHaveLength(1);
    }
  });

  it("the synth still holds and lets go its own way; the strings have no keys", () => {
    const { v } = voiceOn(PAD);
    const id = v.hold(60, 1, 0.8);
    expect(id).toBeGreaterThan(0);
    v.letGo(id, 2);
    const ev = synthEvents(v);
    expect(ev.some((e) => e.type === "on" && e.midi === 60 && e.t === 1)).toBe(true);
    expect(ev.some((e) => e.type === "off" && e.t === 2)).toBe(true);
    expect(voiceOn(GUITAR).v.hold(60, 1, 0.8)).toBe(0);
  });

  it("the on-screen keys play a piano the way they play a synth held: down sounds, up lets go", () => {
    const { v, played, lifted } = voiceOn(PIANOS[0]);
    let now = 5;
    const live = new LiveKeys({ now: () => now, bpm: () => 90, on: (m, w, vel) => v.hold(m, w, vel), off: (id, w) => v.letGo(id, w), note: () => {} }, () => ({ ...DEFAULT_PLAY, mode: "sustain" }));
    live.press(62, 0.7);
    now = 5.4;
    live.release(62);
    expect(played.map((p) => p.midi)).toEqual([62]);
    expect(lifted).toEqual([{ slot: HAND_LANE + 62, when: 5.4 }]);
  });
});

describe("keys played by hand reach the canvas", () => {
  it("each note goes to the canvas with its track at the moment it is heard, on the piano and the synth", () => {
    for (const tone of [...PIANOS, PAD]) {
      const { v } = voiceOn(tone);
      v.hold(67, 2.5, 0.9);
      const [p] = due(Infinity) as NotePulse[];
      expect(p).toMatchObject({ kind: "chord", track: "c2", time: 2.5, midi: 67, velocity: 0.9 });
      expect(p.hold).toBeGreaterThan(0);
    }
  });

  it("a key let go before its note was handed to the canvas is simply a shorter note", () => {
    const { v } = voiceOn(PIANOS[0]);
    const id = v.hold(60, 1, 0.8);
    v.letGo(id, 1.3);
    const [p] = due(Infinity) as NotePulse[];
    expect(p.length).toBeCloseTo(0.3, 9);
    expect(dueReleases(Infinity)).toEqual([]);
  });

  it("a key let go after its note was handed on: the canvas is told when it stopped, and the stroke stops there", () => {
    const { v } = voiceOn(PAD);
    const id = v.hold(60, 1, 0.8);
    const held = new HeldCues();
    const [p] = due(1.05);
    // (until it comes up, a held synth note may sound for a long while)
    expect((p as NotePulse).length).toBeGreaterThan(10);
    const start = held.note(p, cueOfPulse(p, 7, () => "chords", () => 1));
    v.letGo(id, 2);
    expect(dueReleases(1.5)).toEqual([]);
    const ends = held.ends(dueReleases(2.5));
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ layer: "chords", key: "c2", stop: true, cue: { id: 7, t: 2 } });
    // told once
    expect(held.ends([{ hold: (p as NotePulse).hold!, time: 2 }])).toEqual([]);

    // painted: the stroke is as long as the key was held, not as long as the note could have sounded
    const W = 1000;
    const H = 560;
    const h = new LayerHand("melody");
    h.size(W, H);
    const pal = getPalette("woodblock");
    h.colours(layerColours(pal), pal.colors.map(hexToRgb), noteColors(0, [0, 2, 4, 5, 7, 9, 11], pal.colors.length));
    h.where = (t, up) => ({ x: W * (MARGIN + (t / 16) * (1 - 2 * MARGIN)), y: yOfUp(up, H), dx: 1, dy: 0, seg: 0, scale: 1 });
    const marks: Stamp[] = [];
    h.put = (s) => marks.push(s);
    const cue: Cue = { ...start.cue, hz: hzOfMidi(72) };
    h.advance(0.9);
    h.start(cue);
    // told it stopped while it was still to begin, and again once it had: both keep it to the key's length
    h.end(cue.id, 2);
    for (let t = 0.9; t <= 6; t += 1 / 60) h.advance(t);
    const xEnd = W * (MARGIN + (2.2 / 16) * (1 - 2 * MARGIN));
    expect(marks.length).toBeGreaterThan(5);
    expect(marks.every((m) => m.x < xEnd)).toBe(true);

    const h2 = new LayerHand("melody");
    h2.size(W, H);
    h2.where = h.where;
    const marks2: Stamp[] = [];
    h2.put = (s) => marks2.push(s);
    h2.advance(0.9);
    h2.start({ ...cue, id: 8 });
    for (let t = 0.9; t <= 1.5; t += 1 / 60) h2.advance(t);
    h2.end(8, 2);
    for (let t = 1.5; t <= 6; t += 1 / 60) h2.advance(t);
    expect(marks2.some((m) => m.x > W * (MARGIN + (1.8 / 16) * (1 - 2 * MARGIN)))).toBe(true);
    expect(marks2.every((m) => m.x < xEnd)).toBe(true);
  });

  it("nothing is kept when the canvas is not listening, and a muted track's keys are not painted", () => {
    stop();
    const { v } = voiceOn(PIANOS[0]);
    v.letGo(v.hold(60, 1, 0.8), 2);
    expect(due(Infinity)).toEqual([]);
    expect(dueReleases(Infinity)).toEqual([]);
    stop = listen();
    setMix({ c2: { mute: true } });
    const id = v.hold(60, 3, 0.8);
    expect(id).toBeGreaterThan(0);
    v.letGo(id, 4);
    expect(due(Infinity)).toEqual([]);
    // (its release is told, but there is no note of it to stop)
    expect(new HeldCues().ends(dueReleases(Infinity))).toEqual([]);
    setMix(undefined);
  });
});
