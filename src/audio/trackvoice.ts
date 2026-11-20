/**
 * One chords or melody track's sound, from the notes to its fader:
 *
 *   instrument (the strings, a piano or the synth) ─ effects rack ─ out ─ fader(track)
 *
 * The instrument can change while the track plays (the Guitar / Piano / Synth switch): the old
 * one fades out over a few hundredths of a second and is freed, the new one comes in through the
 * same rack and fader, so the track's effects, level, mute and solo stay as they were.
 *
 * The same voice serves the live player and an offline render (a WAV, the recording engine's
 * backing). Offline, a keyboard's notes are written down first; `prepare()` then loads exactly
 * the recordings they need at the render's sample rate and plays them, and the synth is played
 * before its processor is made, so every note is in the render however long loading takes.
 */
import type { Instrument } from "./instrument";
import { soonest } from "./context";
import { SOUND_DEFAULT, createRack, type HarpSound, type Rack } from "./rack";
import { STRING_KEYS } from "./harp";
import { Harp } from "./plucked";
import { GUITAR, instKey, synthOf, type Tone } from "./tone";
import { listening, pulse } from "./pulse";
import type { Sound } from "./describe";
import { createElectricPiano, createPiano } from "../keys/piano";
import { Sampler } from "../keys/sampler";
import type { EPiano } from "../keys/epiano";
import { SynthInstrument } from "../synth/instrument";
import { STOP_FADE } from "../synth/kernel";
import { attackSec, cutoffHz, reviveSynth, timeSec, type PlaySettings, type SynthParams } from "../synth/params";
import { soundFor } from "../synth/render";

/** How long an instrument takes to fade out when it is swapped, or its track is removed. */
export const FADE = 0.06;
/**
 * How long after ■ a track rests (seconds): its fade is over long before (its room's tail is in
 * the shared room, which fades on its own); with its echo on, once the repeats have died away.
 */
const REST = 2;
const REST_ECHO = 12;
const TAU = FADE / 4;

/**
 * Levels on the way into the rack (dB), so a track switched between instruments keeps its place
 * in the mix: measured by exporting the same chords and melodies on each instrument and on the
 * strings. The keyboards and the synth presets are all calibrated to one loudness of their own;
 * against the strings (which strum six notes, and lift a melody note over the chords) a piano's
 * chords sat about 6 dB under (its single melody notes 9 dB) and a synth pad 10 dB. The electric piano's chords come out 3–4 dB
 * above the grand's, so they get less.
 */
export const LEVEL_DB: Record<"grand" | "electric" | "synth", Record<VoiceKind, number>> = {
  grand: { chord: 6, melody: 9 },
  electric: { chord: 2.5, melody: 4 },
  synth: { chord: -3, melody: -5.5 },
};
const db = (v: number) => Math.pow(10, v / 20);

export type VoiceKind = "chord" | "melody";

/**
 * How much of the track's own reverb (its Reverb knob, in the rack after the instrument) and echo
 * a synth's arp or pulse gets at most. The synth's own room is already kept small for them
 * (play.ts ARP_REVERB), but the track's hall comes on top: at the Reverb every track starts with
 * (0.3), a loud step filled it and the soft step after it rose only 2–4 dB out of it (measured in
 * the app's WAV export: Soft Horns' Bounce, a fifth of its steps; Synth Brass and Choir Pad too).
 */
export const ARP_SPACE = 0.15;
export const ARP_TRACK_ECHO = 0.3;
/** The track's effects as they are heard behind its instrument: as set, except behind a synth's arp or pulse (see ARP_SPACE). */
export function rackForPlay(s: HarpSound, play: PlaySettings | null): HarpSound {
  if (!play || (play.mode !== "arp" && play.mode !== "pulse") || (s.space <= ARP_SPACE && s.echo <= ARP_TRACK_ECHO)) return s;
  return { ...s, space: Math.min(s.space, ARP_SPACE), echo: Math.min(s.echo, ARP_TRACK_ECHO) };
}
type Keys = Sampler | EPiano;

/**
 * What a piano or synth note is like, for the canvas (the strings measure their own recordings).
 * A piano is struck and dies away, low notes ringing longest. A synth is shaped by its envelope:
 * a pad swells in and holds for as long as its key is held, a pluck clicks and is gone, so the
 * canvas paints a held pad as a held wash and a plucked synth as a dab, like the strings.
 */
export interface KeysShape {
  /** 0 = swells in ... 1 = a click */
  attack: number;
  /** seconds to 30 dB down while the key is held (a held synth note: long) */
  ring: number;
  /** where its energy sits against its pitch (a dark sound lower, a bright one higher) */
  tilt: number;
  /** how much noise is in it, 0..1 */
  noise: number;
  /** the synth's filter cutoff (hertz): a brighter sound paints brighter */
  cutoff: number;
  /** each overtone's strength falls as 1/h^fall */
  fall: number;
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** A synth's sound as the canvas reads it, from its envelope, filter and noise. */
export function synthShape(p: SynthParams): KeysShape {
  const s = soundFor(p);
  // how much the envelope shapes the loudness (the rest is a plain gate), and what it holds at
  const amt = Math.min(1, 2 * (1 - s.balance));
  // (an envelope on the filter alone still plucks: the note goes dark and thin as the filter closes)
  const held = Math.max(0, 1 - (amt + 0.6 * Math.min(1, 2 * s.balance)) * (1 - s.sustain));
  const rise = Math.max(0.001, attackSec(s.attack) * amt);
  const cutoff = cutoffHz(s.cutoff);
  return {
    attack: clamp01(1 - Math.log10(rise / 0.002) / 2.7),
    // the decay falls 60 dB in its time; a sound that holds at all is held until its key is let go
    ring: held > 0.25 ? 12 + 24 * held : Math.max(0.12, 0.5 * timeSec(s.decay) + 2 * held),
    tilt: Math.max(0.6, Math.min(4, Math.pow(cutoff / 2000, 0.35) * 2)),
    noise: clamp01(2 * s.noise),
    cutoff,
    fall: 1,
  };
}
/** A piano: struck, dying away over seconds (the low strings longest); the electric piano a little shorter and purer. */
export const pianoShape = (electric: boolean, midi: number): KeysShape => ({
  attack: electric ? 0.8 : 0.9,
  ring: Math.max(1, Math.min(12, (electric ? 5 : 8) * Math.pow(2, -(midi - 48) / 24))),
  tilt: electric ? 1.6 : 2.2,
  noise: 0,
  cutoff: electric ? 5000 : 8000,
  fall: 2,
});
const sounds = new Map<string, Sound>();
function keysSound(midi: number, k: KeysShape): Sound {
  const key = `${midi}|${k.attack.toFixed(2)}|${k.ring.toFixed(1)}|${k.tilt.toFixed(2)}|${k.noise.toFixed(2)}|${k.fall}`;
  let s = sounds.get(key);
  if (!s) {
    const hz = 440 * Math.pow(2, (midi - 69) / 12);
    const parts = [1, 2, 3, 4, 5].map((h) => ({ hz: hz * h, width: 0.02, gain: 1 / Math.pow(h, k.fall), ring: k.ring / h, noise: k.noise, glide: 0 }));
    s = { ring: k.ring, attack: k.attack, level: 0.5, centre: hz * k.tilt, parts };
    sounds.set(key, s);
    if (sounds.size > 2000) sounds.delete(sounds.keys().next().value!);
  }
  return s;
}

export interface NoteOpts {
  /** a lane: a new note on the same one takes over from the one before */
  slot?: number;
  /** a muted, cut-short note (the strings damp it quickly) */
  cut?: boolean;
  /** played this much louder (a melody note over a chord, on the strings) */
  lift?: number;
  /** a song section's own sound (the strings are rendered that way) */
  as?: HarpSound;
  /** for the canvas: when the next note of this voice comes, if sooner than the note ends */
  until?: number;
  /** the synth: a step of an arpeggio or a pulse, the next one this many seconds later (see SynthKernel.on) */
  step?: number;
}

export class TrackVoice {
  readonly rack: Rack;
  /** after the rack: a removed track fades out here */
  readonly out: GainNode;
  readonly harp: Harp;
  /** the strings' own way into the rack (faded out while another instrument plays) */
  private harpIn: GainNode;
  tone: Tone = GUITAR;
  private key = "guitar";
  private inst: Instrument | null = null;
  /** the instrument's own way into the rack, its brightness and level */
  private instIn: GainNode | null = null;
  private shelf: BiquadFilterNode | null = null;
  sound: HarpSound = SOUND_DEFAULT;
  private soundKey = "";
  private toneKey = "";
  private settle: ReturnType<typeof setTimeout> | undefined;
  readonly offline: boolean;
  /** offline: what a keyboard plays, written down until its recordings are loaded */
  private later: (() => void)[] = [];
  private wanted: { midi: number; velocity: number }[] = [];
  private gone = false;
  /** the synth's sound as the canvas reads it (worked out again when the tone changes) */
  private shape: KeysShape | null = null;
  /** ■ faded the track out (its room and echoes with it): the next note brings it back */
  private hushed = false;
  /** a while after ■ it is let go of its fader (and its room), so nothing of it is worked out until its next note */
  private restTimer: ReturnType<typeof setTimeout> | undefined;
  private resting = false;
  private dest: AudioNode;
  /** the tempo the rack was last set for (its echo keeps time with it) */
  private bpm = 90;

  constructor(
    readonly c: BaseAudioContext,
    dest: AudioNode,
    readonly kind: VoiceKind,
    /** an added track's id (the first tracks are reported by kind) */
    readonly track?: string,
    /** the sound it starts on: a song's track starts on its own, so its first note has nothing to glide from */
    start: HarpSound = SOUND_DEFAULT,
    bpm = 90,
    /** the track's fader as its reverb hears it (mix.ts sendFader): the rooms are shared, see rooms.ts */
    sendTo?: AudioNode,
  ) {
    this.offline = "startRendering" in c;
    this.out = c.createGain();
    this.dest = dest;
    this.out.connect(dest);
    this.rack = createRack(c, this.out, sendTo);
    this.rack.set(start, bpm);
    this.harpIn = c.createGain();
    this.harpIn.connect(this.rack.input);
    this.harp = new Harp(c, { input: this.harpIn, halo: this.rack.halo });
    // (an offline render's notes are on another clock and are not heard live: the canvas is not told of them)
    this.harp.tag = this.offline ? undefined : kind;
    this.harp.track = track;
    this.setSound(start, bpm);
  }

  /** The instrument playing now (none: the strings). */
  get instrument(): Instrument | null {
    return this.inst;
  }

  /**
   * Set the track's sound and effects: now, or from `at` (a song section with a sound of its own
   * starting there). Nothing is done when it is already set that way. `strings: false` keeps the
   * strings' notes as they are (a knob is still turning: new notes wait until it stops).
   */
  setSound(s: HarpSound, bpm: number, at?: number, strings = true): boolean {
    const key = JSON.stringify(s) + bpm;
    if (key === this.soundKey) return false;
    this.soundKey = key;
    this.sound = s;
    this.bpm = bpm;
    this.rack.set(rackForPlay(s, this.steps), bpm, at);
    this.harp.setSound(s, strings);
    return true;
  }

  /**
   * A knob turned on the page: the effects follow at once, new strings only once the knob has
   * stopped for a moment (making notes takes time). `settled` is called when they are made.
   */
  turn(s: HarpSound, bpm: number, settled?: () => void) {
    const same = STRING_KEYS.every((k) => this.harp.strings[k] === s[k]);
    this.setSound(s, bpm, undefined, same);
    clearTimeout(this.settle);
    if (!same)
      this.settle = setTimeout(() => {
        this.harp.setSound(this.sound);
        settled?.();
      }, 150);
  }

  /** Play on another instrument, or the same one set another way. Cheap when nothing changed. */
  setTone(tone: Tone): void {
    if (this.gone) return;
    const k = JSON.stringify(tone);
    if (k === this.toneKey) return;
    this.toneKey = k;
    const prev = this.tone;
    const stepped = this.steps;
    this.tone = tone;
    this.shape = null;
    // a synth's arp or pulse turned on or off: the track's room and echo follow (see ARP_SPACE)
    if (!!this.steps !== !!stepped) this.rack.set(rackForPlay(this.sound, this.steps), this.bpm);
    const ik = instKey(tone);
    if (ik !== this.key) this.swap(ik);
    else if (tone.inst === "synth" && this.inst instanceof SynthInstrument && JSON.stringify(prev.synth) !== JSON.stringify(tone.synth)) this.inst.set(this.synth);
    if (this.shelf) this.shelf.gain.setTargetAtTime(brightDb(tone), this.c.currentTime, 0.02);
    if (!tone.pedal && prev.pedal && isKeys(this.inst)) this.inst.pedal(false);
  }

  /** How the synth plays, when it plays an arp or a pulse (null: any other way, or not the synth). */
  private get steps(): PlaySettings | null {
    if (this.tone.inst !== "synth") return null;
    const play = this.synth.play;
    return play.mode === "arp" || play.mode === "pulse" ? play : null;
  }

  /** The synth's sound for this track (its own, or the one a new synth track starts with). */
  get synth(): SynthParams {
    return reviveSynth(synthOf(this.tone, this.kind === "chord" ? "chords" : "melody"));
  }

  private swap(next: string) {
    const c = this.c;
    const now = c.currentTime;
    this.key = next;
    // the instrument being left fades out, then lets go of what it holds
    const old = this.inst;
    const oldIn = this.instIn;
    if (old && oldIn) {
      if (this.offline) {
        old.dispose();
        oldIn.disconnect();
      } else {
        oldIn.gain.cancelScheduledValues(now);
        oldIn.gain.setTargetAtTime(0, now, TAU);
        old.stopAll(now + FADE);
        setTimeout(() => {
          old.dispose();
          oldIn.disconnect();
        }, FADE * 2000);
      }
    }
    this.inst = null;
    this.instIn = null;
    this.shelf = null;
    // the strings come and go the same way
    this.harpIn.gain.cancelScheduledValues(now);
    if (next === "guitar") this.harpIn.gain.setTargetAtTime(1, now, TAU);
    else {
      this.harpIn.gain.setTargetAtTime(0, now, TAU);
      this.harp.stopAll(now + FADE);
    }
    if (next === "guitar") return;
    const inst: Instrument = this.tone.inst === "synth" ? new SynthInstrument(c, this.synth, { seed: 7 }) : this.tone.keys === "electric" ? createElectricPiano(c) : createPiano(c);
    const g = c.createGain();
    const level = db(LEVEL_DB[this.tone.inst === "synth" ? "synth" : this.tone.keys === "electric" ? "electric" : "grand"][this.kind]);
    // a new voice starts at its level outright, so a render that begins on a chord begins at the right level
    if (this.offline || !old) g.gain.value = level;
    else {
      g.gain.value = 0;
      g.gain.setTargetAtTime(level, now, TAU);
    }
    inst.output.connect(g);
    if (this.tone.inst === "piano") {
      // Bright: a shelf over the top of the piano, duller or brighter than it was recorded
      const shelf = c.createBiquadFilter();
      shelf.type = "highshelf";
      shelf.frequency.value = 2500;
      shelf.gain.value = brightDb(this.tone);
      g.connect(shelf).connect(this.rack.input);
      this.shelf = shelf;
    } else g.connect(this.rack.input);
    this.inst = inst;
    this.instIn = g;
    if (!this.offline) void inst.load().catch(() => {});
  }

  /** Ready to sound at once? (A piano still loading its recordings is not.) */
  ready(): boolean {
    return !this.inst || this.inst.ready();
  }
  /** Resolves when the instrument can sound. */
  load(): Promise<void> {
    return this.inst ? this.inst.load() : Promise.resolve();
  }

  /** Play one note. `length` in seconds (Infinity: the strings ring on; the keys and the synth are held until stopped). */
  note(midi: number, when: number, velocity: number, length: number, o: NoteOpts = {}) {
    if (this.gone) return;
    this.wake(when);
    const inst = this.inst;
    if (!inst) {
      this.harp.play(midi, when, velocity, o.slot, length, !!o.cut, o.lift ?? 1, o.as, o.until);
      return;
    }
    const len = o.cut ? Math.min(length, 0.12) : length;
    this.tell(midi, when, velocity, len, o);
    // the synth takes its notes ahead of loading (they are handed to its processor when it is made); a keyboard needs its recordings first
    if (this.offline && isKeys(inst)) {
      this.wanted.push({ midi, velocity });
      this.later.push(() => inst.play(midi, when, velocity, len, o.slot));
      return;
    }
    if (inst instanceof SynthInstrument) inst.play(midi, when, velocity, len, o.slot, o.step);
    else inst.play(midi, when, velocity, len, o.slot);
  }

  /** Tell the canvas of a piano or synth note (when it is listening). */
  private tell(midi: number, when: number, velocity: number, len: number, o: NoteOpts = {}) {
    if (!this.harp.tag || !listening()) return;
    const synth = this.tone.inst === "synth";
    const k = synth ? (this.shape ??= synthShape(this.synth)) : pianoShape(this.tone.keys === "electric", midi);
    // (a synth can hold a note for a whole section, a drone: it is painted for as long as it is held; a piano dies away)
    pulse({ kind: this.harp.tag, track: this.track, time: when, midi, velocity, length: Math.min(synth ? 60 : 8, len, o.until ?? Infinity), slot: -1, gain: (o.as ?? this.sound).level, cutoff: k.cutoff, octave: 0, sound: keysSound(midi, k) });
  }

  /** The pianist's pedal change at a new chord: up for a moment, then down again (only when Pedal is on). */
  repedal(at: number) {
    const inst = this.inst;
    if (!this.tone.pedal || !isKeys(inst)) return;
    const go = () => {
      inst.pedal(false, Math.max(0, at - 0.01));
      inst.pedal(true, at + 0.03);
    };
    if (this.offline) this.later.push(go);
    else go();
  }

  /** The song starts at `when`: the synth's movement starts over, so playing from here sounds like a render from here. */
  sync(when: number) {
    if (this.inst instanceof SynthInstrument) this.inst.sync(when);
  }

  /**
   * Let every note go from `at` (■). Live, the track also fades out over the synth's stop fade,
   * its room and echoes too, so nothing rings on for seconds after ■ (a hall's tail behind a
   * drone otherwise lingers); the next note played on it brings it back.
   */
  stopAll(at = soonest(this.c)) {
    clearTimeout(this.settle);
    this.harp.stopAll(at);
    const inst = this.inst;
    if (inst) {
      if (isKeys(inst)) inst.pedal(false, at);
      inst.stopAll(at);
    }
    if (this.offline || this.gone) return;
    this.hushed = true;
    // (to 1% in the fade's time: the room is 40 dB down by then, and silent soon after; what the track
    // sends to its room fades the same way, and the room itself with it)
    for (const g of this.fades()) {
      g.cancelScheduledValues(at);
      g.setTargetAtTime(0, at, STOP_FADE / 4.6);
    }
    this.rack.hush(at, STOP_FADE / 4.6);
    // once it is silent (its own fade over, and any echo it was still repeating died away), it rests:
    // let go of its fader and its room, it costs the audio thread nothing until the next note wakes it
    clearTimeout(this.restTimer);
    const after = Math.max(0, at - this.c.currentTime) + (this.sound.echo > 0 ? REST_ECHO : REST);
    this.restTimer = setTimeout(() => {
      if (!this.hushed || this.gone || this.resting) return;
      this.resting = true;
      this.out.disconnect();
      this.rack.unplug();
    }, after * 1000);
  }

  /** The track's own fade, on its sound and on what it sends to its room. */
  private fades(): AudioParam[] {
    return [this.out.gain, this.rack.send.gain];
  }

  /** A note is coming at `when` after ■ faded the track out: it comes back just before it (quickly, without a click). */
  private wake(when: number) {
    if (!this.hushed || this.offline) return;
    this.hushed = false;
    clearTimeout(this.restTimer);
    if (this.resting) {
      this.resting = false;
      this.out.connect(this.dest);
      this.rack.plug();
    }
    const t = Math.max(this.c.currentTime, when - 0.03);
    for (const g of this.fades()) {
      g.cancelScheduledValues(t);
      g.setTargetAtTime(1, t, 0.006);
    }
    this.rack.wake(t);
  }

  /** Offline, before the render: load what the notes need, then play what was written down. */
  async prepare(): Promise<void> {
    const inst = this.inst;
    if (!inst) return;
    if (inst instanceof Sampler) await inst.prepare(this.wanted);
    else await inst.load();
    for (const f of this.later) f();
    this.later = [];
  }

  /** Free everything. Live, the track fades out first so nothing clicks (a track removed while it plays). */
  dispose() {
    if (this.gone) return;
    this.gone = true;
    clearTimeout(this.settle);
    clearTimeout(this.restTimer);
    const inst = this.inst;
    const end = () => {
      inst?.dispose();
      this.rack.dispose();
      this.out.disconnect();
    };
    if (this.offline) return end();
    const now = this.c.currentTime;
    for (const g of this.fades()) {
      g.cancelScheduledValues(now);
      g.setTargetAtTime(0, now, TAU);
    }
    this.harp.stopAll(now + FADE);
    inst?.stopAll(now + FADE);
    setTimeout(end, FADE * 2000);
  }
}

const isKeys = (i: Instrument | null): i is Keys => !!i && "pedal" in i;
/** Bright: ±8 dB over the top. */
const brightDb = (t: Tone) => ((t.bright ?? 0.5) - 0.5) * 16;
