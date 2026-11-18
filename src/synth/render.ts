/**
 * Rendering and measuring without Web Audio: the kernel driven directly, for the tests, for
 * level-matching the presets, and for anything that wants a picture or a number of a sound
 * (the canvas, a preview) without an audio context.
 */
import { SynthKernel } from "./kernel";
import { applyMacros } from "./macros";
import { type SynthParams, timeSec } from "./params";
import { type PlayNote, type SynthNote, playNotes, voiceForPlay } from "./play";
import type { PresetCategory } from "./presets";

export { loudness } from "./measure";

/** The sound the engine is given: the macros applied, and the voice the way of playing needs. */
export const soundFor = (p: SynthParams): SynthParams => voiceForPlay(applyMacros(p));

export interface RenderOptions {
  sampleRate?: number;
  /** total length; default: until the last note has rung out */
  seconds?: number;
  seed?: number;
  voices?: number;
}

/** How long a sound (in the engine's terms) keeps ringing after its last note lets go: release, echoes, reverb. */
export function tail(s: SynthParams): number {
  return timeSec(s.release) + 0.3 + (s.fx === "delay" ? 0.4 + 2.5 * s.fxDepth : 0) + 2.5 * s.reverb;
}

/** Render notes (already in the synth's own terms: times in seconds) to stereo samples, with the kernel alone (no Web Audio). */
export function renderNotes(params: SynthParams, notes: SynthNote[], o: RenderOptions = {}): { L: Float32Array; R: Float32Array; sampleRate: number } {
  const sr = o.sampleRate ?? 48000;
  const sound = soundFor(params);
  const k = new SynthKernel(sr, { seed: o.seed ?? 1, voices: o.voices });
  k.setParams(sound);
  k.snapSmoothing();
  let end = 0;
  notes.forEach((n, i) => {
    k.noteOn(n.start * sr, n.midi, n.velocity, i + 1, n.slot ?? -1);
    if (Number.isFinite(n.length)) k.noteOff((n.start + n.length) * sr, i + 1);
    end = Math.max(end, n.start + (Number.isFinite(n.length) ? n.length : 0));
  });
  const seconds = o.seconds ?? end + tail(sound);
  const len = Math.max(1, Math.round(seconds * sr));
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  for (let i = 0; i < len; i += 128) k.render(L, R, Math.min(128, len - i), i);
  return { L, R, sampleRate: sr };
}

/** A short phrase that shows a kind of sound off: a bass line, a melody, a held chord. */
export function referencePhrase(category: PresetCategory): PlayNote[] {
  const v = 0.8;
  if (category === "bass") return [36, 36, 43, 41, 36, 48, 43, 39].map((m, i) => ({ midi: m, start: i * 0.25, length: 0.22, velocity: v }));
  if (category === "lead") return [72, 74, 76, 79, 76, 74].map((m, i) => ({ midi: m, start: i * 0.4, length: 0.36, velocity: v }));
  const held = category === "drone" || category === "fx" ? 9 : 2.5;
  return [60, 64, 67].map((m) => ({ midi: m, start: 0, length: held, velocity: v }));
}

/** The reference phrase, played the way the sound suggests (at 120 bpm). */
export function referenceNotes(params: SynthParams, category: PresetCategory): SynthNote[] {
  return playNotes(referencePhrase(category), params.play, { bpm: 120, seed: 1 });
}
