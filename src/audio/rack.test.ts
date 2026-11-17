import { describe, expect, it } from "vitest";
import { DRIVES, FX_DEFAULT, HARP_VERBS, SOUND_DEFAULT, TREM_SPEEDS, reviveSound } from "./rack";
import { ECHO_TIMES } from "./beats";
import { HARP_VOICES } from "./harp";
import { SOUNDS, reviveUserSounds, sameSound, soundName, soundOfPreset } from "./sounds";

describe("harp sounds", () => {
  it("the default is a plain concert harp in a hall, with every effect off", () => {
    expect(SOUND_DEFAULT.voice).toBe("concert");
    expect(SOUND_DEFAULT.verb).toBe("hall");
    for (const k of ["drive", "chorus", "phaser", "trem", "wobble", "echo", "shimmer", "octave"] as const) expect(FX_DEFAULT[k], k).toBe(0);
  });
  it("there are plenty of presets, all valid, all different, none named after an artist", () => {
    expect(SOUNDS.length).toBeGreaterThanOrEqual(20);
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
