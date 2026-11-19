/**
 * The app's own notes and hits, as the hands are told of them.
 *
 * The app knows exactly what it plays, before it is heard: every plucked note with its pitch,
 * how hard it is plucked, how long it will sound and what its sound is made of (measured from
 * the note itself), and every drum hit with its drum and its sound (`audio/pulse.ts`). Painting
 * from these is exact: a staccato note is a dab because it lasts 0.1 s, not because an ear
 * judged it short a moment late, and every mark can land with its sound.
 */
import type { DrumPulse, NotePulse, Pulse } from "../audio/pulse";
import type { Sound } from "../audio/describe";
import { BASS_TOP_MIDI, type LayerKind } from "./layers";
import { hzOfMidi } from "./layout";
import type { LayerCue } from "./painting";

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

/** How noisy a sound is (0 = all tone … 1 = all noise), weighting each part by its strength. */
export function noisiness(s: Sound): number {
  let w = 0;
  let n = 0;
  for (const p of s.parts) {
    w += p.gain;
    n += p.gain * p.noise;
  }
  return w > 0 ? n / w : 0.5;
}
/** How bright a sound is, 0..1, from where its energy sits. */
export const brightness = (s: Sound) => clamp(Math.log2(Math.max(100, s.centre) / 300) / 4.5);

/** The track a note or hit is from (the first tracks are told by their kind). */
export const trackOfPulse = (p: Pulse) => p.track ?? (p.kind === "drum" ? "drums" : p.kind === "chord" ? "chords" : "melody");

/**
 * A note or hit as a cue for a layer. `layerOf` says which layer a track is painted in (by its
 * id; the first tracks have their kind's name), `level` how far up its fader is (0..1+), `id` a
 * number for this sound alone, and `handOf` which hand paints the track (its ear's key; the low
 * strings of a chords track have a hand of their own, the bass's).
 */
export function cueOfPulse(p: Pulse, id: number, layerOf: (track: string) => LayerKind, level: (track: string) => number, handOf: (track: string) => string = (t) => t): LayerCue {
  const track = trackOfPulse(p);
  const fader = Math.min(1.5, level(track));
  if (p.kind === "drum") {
    const d = p as DrumPulse;
    return {
      layer: "drums",
      key: handOf(track),
      hit: true,
      cue: { id, t: d.time, hz: Math.max(40, d.sound.centre), amp: clamp(d.velocity * Math.min(1.3, d.gain) * fader), attack: d.sound.attack, bright: brightness(d.sound), rough: noisiness(d.sound), ring: d.sound.ring, len: 0, drum: d.drum },
    };
  }
  const n = p as NotePulse;
  let layer = layerOf(track);
  let key = handOf(track);
  // the low strings of a chords track are the bass
  if (layer === "chords" && n.midi <= BASS_TOP_MIDI) {
    layer = "bass";
    key = `${key}:bass`;
  }
  return {
    layer,
    key,
    cue: {
      id,
      t: n.time,
      hz: hzOfMidi(n.midi),
      amp: clamp(Math.pow(n.velocity, 1.2) * Math.min(1.3, n.gain) * fader),
      attack: n.sound.attack,
      bright: clamp(0.6 * brightness(n.sound) + 0.4 * clamp(Math.log2(n.cutoff / 700) / 5)),
      rough: noisiness(n.sound),
      len: n.length,
      ring: n.sound.ring,
    },
  };
}
