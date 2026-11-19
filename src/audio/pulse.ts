/**
 * Everything that sounds, as it is scheduled: each chord note, each melody note and each drum
 * hit, with the moment it will be heard. The canvas paints from these.
 *
 * Nothing is kept unless someone is listening.
 */
import type { Sound } from "./describe";
import type { DrumId } from "./drums";
import { heard } from "./mix";

/** A plucked string. */
export interface NotePulse {
  /** which harp: the one that plays the chords, or the one that plays the melody */
  kind: "chord" | "melody";
  /** the track, when it is one added on the Track page */
  track?: string;
  /** when it is heard (audio clock, seconds) */
  time: number;
  /** the note that sounds (MIDI number; an instrument that sounds an octave up is reported an octave up) */
  midi: number;
  /** how hard it is plucked, 0..1: harder is louder and brighter */
  velocity: number;
  /** how long it is left to sound, in seconds: until the hand damps it or the same string is plucked again */
  length: number;
  /** which string (a new note on the same string takes over from the old one); −1 = no particular string */
  slot: number;
  /** the instrument's fader, 0..1 */
  gain: number;
  /** a hard pluck is a bright one: overtones above this frequency (hertz) are dulled */
  cutoff: number;
  /** a twelve-string's octave string: how strong it is next to the note itself (0 = there is none) */
  octave: number;
  /** the note itself, measured */
  sound: Sound;
}
/** A drum hit. */
export interface DrumPulse {
  kind: "drum";
  /** the track, when it is one added on the Track page */
  track?: string;
  time: number;
  drum: DrumId;
  velocity: number;
  /** the drum's fader, 1 = as it comes */
  gain: number;
  sound: Sound;
}
export type Pulse = NotePulse | DrumPulse;

let listeners = 0;
let queue: Pulse[] = [];

/** Start collecting. Call what it returns to stop. */
export function listen(): () => void {
  listeners++;
  let on = true;
  return () => {
    if (!on) return;
    on = false;
    listeners = Math.max(0, listeners - 1);
    if (!listeners) queue = [];
  };
}

/** Is anyone listening? (Measuring a sound takes a moment: it is only done when someone is.) */
export const listening = () => listeners > 0;

/** Something has been scheduled to sound. */
export function pulse(p: Pulse) {
  if (!listeners) return;
  // a muted track is not painted
  if (!heard(p.track ?? (p.kind === "drum" ? "drums" : p.kind === "chord" ? "chords" : "melody"))) return;
  queue.push(p);
  // nobody collected for a long while: let the oldest go
  if (queue.length > 6000) queue.splice(0, 2000);
}

/** Everything whose moment has come (audio clock, in seconds), oldest first. Each is handed out once. */
export function due(now: number): Pulse[] {
  if (!queue.length) return [];
  const out: Pulse[] = [];
  const keep: Pulse[] = [];
  for (const p of queue) (p.time <= now ? out : keep).push(p);
  queue = keep;
  return out.sort((a, b) => a.time - b.time);
}

/** Forget what has not sounded yet (playing was stopped). */
export function dropPulses() {
  queue = [];
}

/** How many are waiting (for tests). */
export const waiting = () => queue.length;
