/**
 * The plucked strings (the Guitar instrument of a track): notes rendered by harp.ts, one buffer
 * per note, played into a track's effects rack. A string plucked again stops the note before it,
 * as on a real instrument.
 */
import { drumRng } from "./drums";
import { renderHarp, stringKey, voiceShift, type HarpString } from "./harp";
import { listening, pulse } from "./pulse";
import { describe, type Sound } from "./describe";
import { SOUND_DEFAULT, type HarpSound } from "./rack";

/** How many rendered notes are kept (each is up to a megabyte). */
const MAX_NOTES = 96;

/** How loud one string is before the effects. */
export const VOICE_GAIN = 0.4;

interface Ringing {
  srcs: AudioBufferSourceNode[];
  gain: GainNode;
}

/** A note, measured (once for each recording). */
const measured = new WeakMap<AudioBuffer, Sound>();
function soundOf(buf: AudioBuffer): Sound {
  let s = measured.get(buf);
  if (!s) {
    s = describe(buf.getChannelData(0), buf.sampleRate);
    measured.set(buf, s);
  }
  return s;
}

/** Where the strings go: the rack's input, and its reverb-only send (for the shimmer). */
export interface StringsOut {
  input: AudioNode;
  halo: AudioNode;
}

export class Harp {
  sound: HarpSound = SOUND_DEFAULT;
  /** the strings the notes are rendered with (they can lag behind `sound` while a knob is moving) */
  strings: HarpString = SOUND_DEFAULT;
  /** what this harp plays in the song: its notes are reported so the canvas can paint them (not set = not reported) */
  tag?: "chord" | "melody";
  /** the track it plays, when it is one added on the Track page (its mute and solo decide whether it is painted) */
  track?: string;
  private buffers = new Map<string, AudioBuffer>();
  private ringing = new Map<number, Ringing>(); // by string
  private all = new Set<Ringing>();

  constructor(
    readonly c: BaseAudioContext,
    private out: StringsOut,
  ) {}

  /** Change the sound; `strings: false` leaves the notes themselves as they were (a knob is still moving). */
  setSound(s: HarpSound, strings = true) {
    this.sound = s;
    if (strings) this.strings = s;
  }

  /** Is this note ready to play without a pause? */
  has(midi: number, strings: HarpString = this.strings): boolean {
    return this.buffers.has(stringKey(midi, strings));
  }

  /** The note, on this harp's own strings or (another song section's) given ones. */
  buffer(midi: number, strings: HarpString = this.strings): AudioBuffer {
    const key = stringKey(midi, strings);
    let buf = this.buffers.get(key);
    if (!buf) {
      const data = renderHarp(this.c.sampleRate, midi, strings, drumRng(midi * 131 + 7));
      buf = this.c.createBuffer(1, data.length, this.c.sampleRate);
      buf.getChannelData(0).set(data);
      if (this.buffers.size >= MAX_NOTES) this.buffers.delete(this.buffers.keys().next().value!);
      this.buffers.set(key, buf);
    }
    return buf;
  }

  private damp(r: Ringing, at: number, tc = 0.025) {
    try {
      r.gain.gain.cancelScheduledValues(at);
      r.gain.gain.setTargetAtTime(0, at, tc);
      for (const src of r.srcs) src.stop(at + tc * 8);
    } catch {
      /* already stopped */
    }
  }

  /**
   * Pluck one string. `slot` = which string: a new note on the same string stops the old one, as on a real instrument.
   * `lengthSec` = when the hand lifts; how gently the note then fades follows the Ring knob.
   */
  play(midi: number, when: number, velocity = 0.8, slot?: number, lengthSec = Infinity, cut = false, lift = 1, as?: HarpSound, until?: number) {
    const c = this.c;
    // a note scheduled just before a song section begins is already played the way that section sounds
    const s = as ?? this.sound;
    const src = c.createBufferSource();
    src.buffer = this.buffer(midi, as ?? this.strings);
    // for the canvas: what sounds, measured from the note itself. `until` = when the next note of this voice comes, if that is sooner than the hand lifts
    // a harder pluck is a brighter one
    const cutoff = Math.min(20000, 700 * Math.pow(2, velocity * 5));
    if (this.tag && listening()) pulse({ kind: this.tag, track: this.track, time: when, midi: midi + voiceShift((as ?? this.strings).voice), velocity, length: Math.min(8, lengthSec, until ?? Infinity), slot: slot ?? -1, gain: s.level * lift, cutoff, octave: 0.7 * Math.max(0, s.octave), sound: soundOf(src.buffer) });
    const vcf = c.createBiquadFilter();
    vcf.type = "lowpass";
    vcf.frequency.value = cutoff;
    vcf.Q.value = 0.4;
    const g = c.createGain();
    g.gain.value = VOICE_GAIN * Math.pow(velocity, 1.3) * lift;
    const pan = c.createStereoPanner();
    pan.pan.value = slot !== undefined ? (((slot % 6) - 2.5) / 2.5) * 0.7 * s.wide : 0;
    src.connect(vcf).connect(g).connect(pan).connect(this.out.input);
    const r: Ringing = { srcs: [src], gain: g };
    src.start(when);
    if (s.octave > 0) {
      // the octave string of a twelve-string: the same pluck an octave up, a moment later
      const oct = c.createBufferSource();
      oct.buffer = src.buffer;
      oct.detune.value = 1200;
      const og = c.createGain();
      og.gain.value = 0.7 * s.octave;
      oct.connect(og).connect(vcf);
      oct.start(when + 0.009);
      r.srcs.push(oct);
    }
    if (s.shimmer > 0 && !cut) {
      // a halo an octave up that swells in after the pluck and is heard only in the reverb
      const sh = c.createBufferSource();
      sh.buffer = src.buffer;
      sh.detune.value = 1200;
      const sg = c.createGain();
      sg.gain.setValueAtTime(0, when);
      sg.gain.linearRampToValueAtTime(VOICE_GAIN * velocity * s.shimmer * 0.85, when + 0.28);
      sh.connect(sg).connect(this.out.halo);
      sh.start(when);
      r.srcs.push(sh);
    }
    if (slot !== undefined) {
      const prev = this.ringing.get(slot);
      if (prev) this.damp(prev, when);
      this.ringing.set(slot, r);
    }
    this.all.add(r);
    src.onended = () => this.all.delete(r);
    if (Number.isFinite(lengthSec)) this.damp(r, when + lengthSec, cut ? 0.012 : 0.04 + 0.3 * s.ring * s.ring);
  }

  stopAll(at = this.c.currentTime) {
    for (const r of this.all) this.damp(r, at);
    this.all.clear();
    this.ringing.clear();
  }
}
