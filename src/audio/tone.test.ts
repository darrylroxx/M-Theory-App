import { describe, expect, it } from "vitest";
import { GUITAR, keysVoicing, keysVoicings, midiProgram, reviveTone, reviveTones, synthOf, toneOf, voicingOf, withTone } from "./tone";
import { fingerprint, reviveIdea, snapshot } from "../song/library";
import { addTrack, focusTrack, removeTrack } from "../song/tracks";
import { presetById } from "../synth/presets";
import type { ProgChord, Progression } from "../ui/state";

const key = { tonic: "C", scaleId: "ionian" };
const chord = (root: string, typeId = "maj"): ProgChord => ({ id: root + typeId, ref: { root, typeId }, beats: 4 });
const base = (): Progression => ({ chords: [chord("C"), chord("A", "min"), chord("F"), chord("G")], bpm: 90, pattern: "ring", loop: true, bars: 4 });

describe("what plays a track", () => {
  it("broken or unknown tones play Guitar", () => {
    expect(reviveTone(null)).toEqual(GUITAR);
    expect(reviveTone("piano")).toEqual(GUITAR);
    expect(reviveTone({ inst: "organ" })).toEqual(GUITAR);
    expect(reviveTone({ inst: "piano", keys: "harpsichord", bright: 7, voicing: "wide" })).toEqual({ inst: "piano", bright: 1 });
    expect(reviveTone({ inst: "synth", synth: { cutoff: "x" } }).synth?.cutoff).toBeTypeOf("number");
  });
  it("tones are kept only for tracks that exist, and plain Guitar is no tone at all", () => {
    expect(reviveTones({ chords: { inst: "piano" }, gone: { inst: "synth" }, melody: { inst: "guitar" } }, ["chords", "melody"])).toEqual({ chords: { inst: "piano" } });
    expect(reviveTones("x", ["chords"])).toBeUndefined();
  });
  it("an old idea loads with no tones, and is the same idea it was", () => {
    const old = { id: "i1", name: "Old", key, savedAt: 1, progression: base() };
    const back = reviveIdea(JSON.parse(JSON.stringify(old)))!;
    expect(back.progression.tones).toBeUndefined();
    expect(toneOf(back.progression, "chords")).toEqual(GUITAR);
    expect(fingerprint(snapshot(key, back.progression, 0, "standard"))).toBe(fingerprint(snapshot(key, reviveIdea(old)!.progression, 0, "standard")));
  });
  it("an idea keeps its tracks' instruments through saving and loading", () => {
    const p = withTone(base(), "chords", { inst: "synth", synth: presetById("warm-pad")!.params, voicing: "shell" });
    const back = reviveIdea(JSON.parse(JSON.stringify({ id: "i2", name: "New", key, savedAt: 1, progression: p })))!;
    expect(back.progression.tones?.chords.inst).toBe("synth");
    expect(back.progression.tones?.chords.voicing).toBe("shell");
    expect(back.progression.tones?.chords.synth?.preset).toBe("warm-pad");
    expect(fingerprint(snapshot(key, back.progression, 0, "standard"))).not.toBe(fingerprint(snapshot(key, base(), 0, "standard")));
  });
  it("a removed track's tone goes with it", () => {
    let p = addTrack(base(), "melody", "m2").p;
    p = withTone(p, "m2", { inst: "piano", keys: "electric" });
    expect(toneOf(p, "m2").keys).toBe("electric");
    expect(removeTrack(p, "m2").tones).toBeUndefined();
  });
  it("switching which track a page edits changes no track's instrument", () => {
    let p = addTrack(base(), "chords", "c2").p;
    p = withTone(withTone(p, "c2", { inst: "synth" }), "chords", { inst: "piano" });
    const tones = p.tones;
    p = focusTrack(p, "chords", "chords");
    expect(p.tones).toEqual(tones);
    p = focusTrack(p, "chords", "c2");
    expect(p.tones).toEqual(tones);
  });
  it("the pages follow the track being edited", () => {
    let p = addTrack(base(), "chords", "c2").p;
    p = withTone(p, "c2", { inst: "synth" });
    expect(toneOf(p, p.focus?.chords ?? "chords").inst).toBe("synth");
    p = focusTrack(p, "chords", "chords");
    expect(toneOf(p, p.focus?.chords ?? "chords")).toEqual(GUITAR);
  });
});

describe("chords on the keys", () => {
  it("the piano plays Spread, with the root at the bottom; the synth Open", () => {
    expect(voicingOf({ inst: "piano" })).toBe("spread");
    expect(voicingOf({ inst: "synth" })).toBe("open");
    expect(voicingOf({ inst: "piano", voicing: "close" })).toBe("close");
    const vs = keysVoicings(base().chords, { inst: "piano" });
    const roots = [0, 9, 5, 7];
    vs.forEach((v, i) => {
      expect(v.length).toBeGreaterThanOrEqual(3);
      expect(Math.min(...v) % 12).toBe(roots[i]);
    });
  });
  it("a rest has no keys", () => {
    const vs = keysVoicings([chord("C"), { ...chord("D"), rest: true }, chord("G")], { inst: "piano" });
    expect(vs[1]).toEqual([]);
  });
  it("a chord on its own (tapped, on its card, in the sheet) sits where the tray plays it, in the track's register", () => {
    const am = { ref: { root: "A", typeId: "min" } };
    for (const t of [{ inst: "piano" as const, register: "high" as const }, { inst: "piano" as const, voicing: "close" as const, register: "high" as const }, { inst: "synth" as const }]) {
      expect(keysVoicing(am.ref, t)).toEqual(keysVoicings([am], t)[0]);
    }
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    expect(mean(keysVoicing(am.ref, { inst: "piano", register: "high" }))).toBeGreaterThan(mean(keysVoicing(am.ref, { inst: "piano" })) + 6);
  });
});

describe("the synth on a track", () => {
  it("starts on a pad for chords and a lead for a melody", () => {
    expect(presetById(synthOf({ inst: "synth" }, "chords").preset)?.category).toBe("pad");
    expect(presetById(synthOf({ inst: "synth" }, "melody").preset)?.category).toBe("lead");
  });
  it("is written to MIDI with a program for its kind of sound", () => {
    expect(midiProgram(GUITAR)).toBe(46);
    expect(midiProgram({ inst: "piano" })).toBe(0);
    expect(midiProgram({ inst: "piano", keys: "electric" })).toBe(4);
    expect(midiProgram({ inst: "synth", synth: presetById("warm-pad")!.params })).toBe(89);
    expect(midiProgram({ inst: "synth", synth: presetById("supersaw-lead")!.params })).toBe(81);
  });
});
