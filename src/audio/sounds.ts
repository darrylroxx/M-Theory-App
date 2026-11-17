/**
 * Ready-made sounds: each one sets how the strings are played and the whole effects rack in one
 * tap, on whichever instrument is chosen.
 * Named for how they sound, never after a player or a record.
 */
import { SOUND_DEFAULT, reviveSound, type HarpSound } from "./rack";

export interface SoundPreset {
  id: string;
  name: string;
  hint: string;
  sound: Partial<HarpSound>;
}

export const SOUNDS: SoundPreset[] = [
  { id: "concert", name: "Natural", hint: "The plain instrument in a hall. The one to write with.", sound: {} },
  { id: "warm", name: "Warm", hint: "Plucked near the middle with soft fingers, a touch of valve warmth", sound: { pluck: 0.15, soft: 0.8, body: 0.7, tone: -0.25, drive: 0.5, driveType: "tube", verb: "room", space: 0.3, size: 0.5 } },
  { id: "bright", name: "Bright", hint: "Plucked crisply near the soundboard: cuts through a mix", sound: { pluck: 0.5, soft: 0.3, tone: 0.3, verb: "plate", space: 0.25 } },
  { id: "close", name: "Dry and close", hint: "No room at all: every note exactly as played", sound: { space: 0, squeeze: 0.3, body: 0.6 } },
  { id: "dream", name: "Dreamy", hint: "Chorus, a dotted echo and a long hall", sound: { ring: 0.65, chorus: 0.5, echo: 0.3, space: 0.5, size: 0.65, shimmer: 0.25, wide: 0.8 } },
  { id: "ambient", name: "Ambient", hint: "Soft plucks dissolving into a huge shimmering space", sound: { soft: 0.85, ring: 0.8, chorus: 0.3, echo: 0.4, echoTime: "1/4", space: 0.7, size: 0.85, shimmer: 0.6, wide: 0.9 } },
  { id: "cathedral", name: "Cathedral", hint: "The biggest hall there is", sound: { soft: 0.7, ring: 0.7, space: 0.6, size: 1 } },
  { id: "lofi", name: "Lo-fi tape", hint: "Wobbly, dull and saturated, like a worn cassette", sound: { soft: 0.7, wobble: 0.55, drive: 0.7, driveType: "tape", tone: -0.45, squeeze: 0.5, verb: "dark", space: 0.3, wide: 0.3 } },
  { id: "underwater", name: "Underwater", hint: "Dark and swirling, the pitch drifting", sound: { wobble: 0.8, chorus: 0.7, phaser: 0.3, tone: -0.6, space: 0.5, size: 0.6 } },
  { id: "twelve", name: "Twelve-string", hint: "Every string doubled an octave up, with a little chorus", sound: { soft: 0.4, octave: 0.7, chorus: 0.3, verb: "plate", space: 0.25, wide: 0.8 } },
  { id: "glass", name: "Halo", hint: "Soft and long, with a glow an octave above", sound: { soft: 0.7, ring: 0.7, chorus: 0.2, space: 0.45, size: 0.6, shimmer: 0.35 } },
  { id: "echo", name: "Dotted echo", hint: "Each pluck answered by bouncing repeats", sound: { soft: 0.45, echo: 0.55, echoTime: "1/8.", space: 0.25, wide: 0.7 } },
  { id: "tremolo", name: "Tremolo", hint: "A pulsing volume and a spring reverb, like an old amp", sound: { soft: 0.5, trem: 0.7, tremSpeed: "1/8t", drive: 0.6, driveType: "tube", verb: "spring", space: 0.35 } },
  { id: "phase", name: "Phaser", hint: "A slow sweep moving through the chords", sound: { phaser: 0.7, squeeze: 0.4, verb: "room", space: 0.2 } },
  { id: "valve", name: "Valve glow", hint: "Through warm valves: sweeter, a little thicker", sound: { soft: 0.5, drive: 0.65, driveType: "tube", squeeze: 0.35, space: 0.3 } },
  { id: "desk", name: "Big desk", hint: "Through a mixing desk's transformers: a fat low end and a firm attack", sound: { soft: 0.4, body: 0.65, drive: 0.6, driveType: "console", squeeze: 0.4, verb: "plate", space: 0.2 } },
  { id: "crunch", name: "Crunch", hint: "Through an overdrive pedal and a spring reverb", sound: { pluck: 0.6, soft: 0.2, drive: 0.6, driveType: "crunch", squeeze: 0.5, tone: 0.1, verb: "spring", space: 0.2 } },
  { id: "fuzz", name: "Fuzz", hint: "Hard clipping: thick and buzzing", sound: { pluck: 0.5, soft: 0.3, drive: 0.45, driveType: "fuzz", squeeze: 0.4, verb: "room", space: 0.2 } },
];

/** A sound someone saved for themselves. */
export interface UserSound {
  id: string;
  name: string;
  sound: HarpSound;
}

/** A preset on a given instrument: presets shape the playing and the effects, and leave the instrument alone. */
export const soundOfPreset = (p: SoundPreset, voice: HarpSound["voice"] = SOUND_DEFAULT.voice): HarpSound => ({ ...SOUND_DEFAULT, ...p.sound, voice });

const KEYS = Object.keys(SOUND_DEFAULT) as (keyof HarpSound)[];
/**
 * Volume is a mixing choice, not part of the sound: two sounds that differ only in volume are the same.
 * A preset is the same whatever instrument plays it (`anyVoice`); a sound you saved includes its instrument.
 */
export const sameSound = (a: HarpSound, b: HarpSound, anyVoice = false) =>
  KEYS.every((k) => k === "level" || (anyVoice && k === "voice") || (typeof a[k] === "number" ? Math.abs((a[k] as number) - (b[k] as number)) < 1e-6 : a[k] === b[k]));

/** The name of the preset these settings are, if any. */
export function soundName(s: HarpSound, mine: UserSound[] = []): string | null {
  return mine.find((u) => sameSound(u.sound, s))?.name ?? SOUNDS.find((p) => sameSound(soundOfPreset(p), s, true))?.name ?? null;
}

export function reviveUserSounds(raw: unknown): UserSound[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((u) => u && typeof u.id === "string" && typeof u.name === "string").map((u) => ({ id: u.id, name: u.name, sound: reviveSound(u.sound) }));
}
