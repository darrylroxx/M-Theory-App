import { describe, expect, it } from "vitest";
import { DRIVES, FX_DEFAULT, HARP_VERBS, SOUND_DEFAULT, TREM_SPEEDS, reviveSound, saturationCurve } from "./rack";
import { ECHO_TIMES } from "./beats";
import { HARP_VOICES } from "./harp";
import { SOUNDS, reviveUserSounds, sameSound, soundName, soundOfPreset } from "./sounds";

const at = (curve: Float32Array, x: number) => curve[Math.round(((x + 1) / 2) * (curve.length - 1))];

describe("saturation", () => {
  it("does nothing audible at zero, and bends harder as it is turned up", () => {
    for (const d of DRIVES) {
      const off = saturationCurve(d.id, 0);
      // a straight line through the middle
      expect(at(off, 0.1) / 0.1, d.id).toBeCloseTo(at(off, 0.05) / 0.05, 1);
      const mild = saturationCurve(d.id, 0.3);
      const hard = saturationCurve(d.id, 1);
      // loud peaks are flattened more and more
      expect(at(hard, 0.9) / at(hard, 0.2)).toBeLessThan(at(mild, 0.9) / at(mild, 0.2));
      for (const c of [off, mild, hard]) for (const v of c) expect(Number.isFinite(v)).toBe(true);
    }
  });
  it("leaves a sound of the usual size about as loud as it was", () => {
    for (const d of DRIVES) for (const a of [0.25, 0.5, 1]) expect(Math.abs(at(saturationCurve(d.id, a), 0.2)), `${d.id} ${a}`).toBeGreaterThan(0.12);
  });
  it("tape treats both halves of the wave alike; a tube does not", () => {
    const tape = saturationCurve("tape", 0.7);
    const tube = saturationCurve("tube", 0.7);
    expect(at(tape, 0.6)).toBeCloseTo(-at(tape, -0.6), 5);
    expect(Math.abs(at(tube, 0.6) + at(tube, -0.6))).toBeGreaterThan(0.02);
  });
  it("fuzz clips harder than tape", () => {
    const flat = (c: Float32Array) => at(c, 1) / at(c, 0.5);
    expect(flat(saturationCurve("fuzz", 1))).toBeLessThan(flat(saturationCurve("tape", 0.5)));
  });
});

describe("harp sounds", () => {
  it("the default is a plain concert harp in a hall, with every effect off", () => {
    expect(SOUND_DEFAULT.voice).toBe("concert");
    expect(SOUND_DEFAULT.verb).toBe("hall");
    for (const k of ["drive", "chorus", "phaser", "trem", "wobble", "echo", "shimmer", "octave"] as const) expect(FX_DEFAULT[k], k).toBe(0);
  });
  it("there are plenty of presets, all valid, all different, none named after an artist", () => {
    expect(SOUNDS.length).toBeGreaterThanOrEqual(18);
    expect(new Set(SOUNDS.map((p) => p.id)).size).toBe(SOUNDS.length);
    expect(new Set(SOUNDS.map((p) => p.name)).size).toBe(SOUNDS.length);
    SOUNDS.forEach((p, i) => {
      const s = soundOfPreset(p);
      // loading it back changes nothing: every value is in range and every name is known
      expect(reviveSound(s), p.id).toEqual(s);
      expect(HARP_VOICES.some((v) => v.id === s.voice) && HARP_VERBS.some((v) => v.id === s.verb) && DRIVES.some((v) => v.id === s.driveType), p.id).toBe(true);
      expect(TREM_SPEEDS.some((v) => v.id === s.tremSpeed) && ECHO_TIMES.some((v) => v.id === s.echoTime), p.id).toBe(true);
      expect(Object.keys(p.sound).every((k) => k in SOUND_DEFAULT), p.id).toBe(true);
      SOUNDS.slice(i + 1).forEach((q) => expect(sameSound(s, soundOfPreset(q)), `${p.id} = ${q.id}`).toBe(false));
      expect(soundName(s)).toBe(p.name);
    });
    expect(SOUNDS.map((p) => `${p.name} ${p.hint}`).join(" ")).not.toMatch(/radiohead|beach house|florence|current joys|boy harsher|molchat/i);
  });
  it("volume is not part of a preset", () => {
    const s = soundOfPreset(SOUNDS[4]);
    expect(soundName({ ...s, level: 0.3 })).toBe(SOUNDS[4].name);
    expect(soundName({ ...s, chorus: 0.123 })).toBe(null);
    expect(soundName({ ...s, chorus: 0.123 }, [{ id: "u", name: "Mine", sound: { ...s, chorus: 0.123 } }])).toBe("Mine");
  });
  it("a damaged or old sound is made whole", () => {
    expect(reviveSound(undefined)).toEqual(SOUND_DEFAULT);
    expect(reviveSound({ voice: "kazoo", verb: "gated", pluck: 7, tone: -3, drive: "lots", echoTime: "1/3" })).toEqual({ ...SOUND_DEFAULT, pluck: 1, tone: -1 });
    expect(reviveSound({ voice: "wire", chorus: 0.4 })).toEqual({ ...SOUND_DEFAULT, voice: "wire", chorus: 0.4 });
    expect(reviveUserSounds("nope")).toEqual([]);
    expect(reviveUserSounds([{ id: "a", name: "A", sound: { ring: 0.9 } }, { nope: 1 }, null])).toEqual([{ id: "a", name: "A", sound: { ...SOUND_DEFAULT, ring: 0.9 } }]);
  });
});
