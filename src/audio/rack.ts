/**
 * The harp's effects: a pedalboard in the order guitarists wire one.
 *
 *   strings ─ squeeze ─ saturation ─ tone ─ phaser ─ wobble ─ chorus ─ tremolo ─┬────────────┐
 *                                                                                ├─ echo ─────┤
 *                                 shimmer (octave-up strings) ───────────────────┴─ reverb ───┤
 *                                                                                             ▼
 *                                                           pump (from the kick) ─ volume ─ ceiling ─ out
 *
 * Compressing first hands the saturation an even signal; modulation works on the tone that has
 * already been shaped; echo and reverb come last so they repeat the finished sound.
 *
 * Works on any audio context, live or offline, so the same chain can be measured in tests.
 */
import { ECHO_TIMES, type EchoTime, type VerbId } from "./beats";
import { atRenderTime } from "./context";
import { renderSpace, drumRng } from "./drums";
import { HARP_VOICES, STRING_DEFAULT, type HarpString } from "./harp";
import { SAT_TYPES, createSaturator, type SatType } from "./saturation";

export type DriveType = SatType;
export const DRIVES = SAT_TYPES;
export type TremSpeed = "1/4" | "1/8" | "1/8t" | "1/16";
export const TREM_SPEEDS: { id: TremSpeed; name: string; hint: string; perBeat: number }[] = [
  { id: "1/4", name: "Beat", hint: "One swell per beat", perBeat: 1 },
  { id: "1/8", name: "8th", hint: "Two per beat", perBeat: 2 },
  { id: "1/8t", name: "Triplet", hint: "Three per beat", perBeat: 3 },
  { id: "1/16", name: "16th", hint: "Four per beat: a flutter", perBeat: 4 },
];
export type HarpVerb = Exclude<VerbId, "gated">;
export const HARP_VERBS: { id: HarpVerb; name: string; hint: string }[] = [
  { id: "hall", name: "Hall", hint: "A concert hall: long and smooth" },
  { id: "room", name: "Room", hint: "A small wooden room: close and real" },
  { id: "plate", name: "Plate", hint: "Dense and bright: the studio classic" },
  { id: "spring", name: "Spring", hint: "The drippy reverb inside a guitar amp" },
  { id: "dark", name: "Lo-fi", hint: "Dark and grainy, like a cheap old digital reverb" },
];

export interface HarpFx {
  /** overall volume */
  level: number;
  /** saturation: how hard, which colour, and how much of the sound goes through it (1 = all of it) */
  drive: number;
  driveType: DriveType;
  driveMix: number;
  /** compressor: evens out loud and quiet notes, lengthens the ring */
  squeeze: number;
  /** −1 dark … +1 bright */
  tone: number;
  chorus: number;
  phaser: number;
  trem: number;
  tremSpeed: TremSpeed;
  /** tape wow and flutter: the pitch drifts */
  wobble: number;
  echo: number;
  echoTime: EchoTime;
  /** reverb amount, type and size */
  space: number;
  verb: HarpVerb;
  size: number;
  /** a halo an octave above, heard only in the reverb */
  shimmer: number;
  /** each string doubled an octave up, like a twelve-string */
  octave: number;
  /** how far the strings are spread between the speakers */
  wide: number;
}

export type HarpSound = HarpString & HarpFx;

export const FX_DEFAULT: HarpFx = {
  level: 0.8, drive: 0, driveType: "tape", driveMix: 1, squeeze: 0.2, tone: 0, chorus: 0, phaser: 0, trem: 0, tremSpeed: "1/8", wobble: 0,
  echo: 0, echoTime: "1/8.", space: 0.3, verb: "hall", size: 0.4, shimmer: 0, octave: 0, wide: 0.5,
};
export const SOUND_DEFAULT: HarpSound = { ...STRING_DEFAULT, ...FX_DEFAULT };

const unit = (v: unknown, d: number, min = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(min, v)) : d);

/** A sound loaded from storage, made whole and safe: unknown names and missing knobs fall back to the default. */
export function reviveSound(raw: unknown): HarpSound {
  const r = (raw ?? {}) as Partial<Record<keyof HarpSound, unknown>>;
  const d = SOUND_DEFAULT;
  const pick = <T extends string>(v: unknown, list: { id: T }[], def: T): T => (list.some((x) => x.id === v) ? (v as T) : def);
  return {
    voice: pick(r.voice, HARP_VOICES, d.voice), pluck: unit(r.pluck, d.pluck), soft: unit(r.soft, d.soft), ring: unit(r.ring, d.ring), body: unit(r.body, d.body),
    level: unit(r.level, d.level), drive: unit(r.drive, d.drive), driveType: pick(r.driveType, DRIVES, d.driveType), driveMix: unit(r.driveMix, d.driveMix), squeeze: unit(r.squeeze, d.squeeze), tone: unit(r.tone, d.tone, -1),
    chorus: unit(r.chorus, d.chorus), phaser: unit(r.phaser, d.phaser), trem: unit(r.trem, d.trem), tremSpeed: pick(r.tremSpeed, TREM_SPEEDS, d.tremSpeed), wobble: unit(r.wobble, d.wobble),
    echo: unit(r.echo, d.echo), echoTime: pick(r.echoTime, ECHO_TIMES, d.echoTime), space: unit(r.space, d.space), verb: pick(r.verb, HARP_VERBS, d.verb), size: unit(r.size, d.size),
    shimmer: unit(r.shimmer, d.shimmer), octave: unit(r.octave, d.octave), wide: unit(r.wide, d.wide),
  };
}

/** The level a strummed chord arrives at: what the saturation is told to expect. */
const DRIVE_REF = 0.2;

/** Straight up to 0.75, then bending over so nothing can leave louder than about 0.94. */
function ceiling(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= 0.75 ? a : 0.75 + 0.25 * Math.tanh((a - 0.75) / 0.25));
  }
  return curve;
}

export interface Rack {
  /** the strings go in here */
  input: GainNode;
  /** sounds sent here are heard only through the reverb (the shimmer) */
  halo: GainNode;
  /** dips under each kick when the drums' Pump is up */
  duck: GainNode;
  /**
   * Set the sound: now, or from `at` (seconds on the audio clock) when a song section with a sound
   * of its own starts there. A room is rebuilt at that moment too: live by a timer, in an offline
   * render by pausing the render there (see atRenderTime), so every export is the same.
   */
  set(s: HarpSound, bpm: number, at?: number): void;
  /** Stop its oscillators and let go of everything (the track is gone). */
  dispose(): void;
}

/**
 * Most effects make the sound louder or quieter as a side effect. These numbers (measured by
 * rendering a strummed progression through the finished chain) take that back, so each knob
 * changes the character and leaves the volume where it was.
 */
const QUARTERS = [0, 0.25, 0.5, 0.75, 1];
/** the compressor has automatic make-up gain */
export const SQUEEZE_DB = [0, -0.9, -4.3, -6, -5];
/** per colour of saturation, at 0, ¼, ½, ¾ and 1 */
export const DRIVE_TRIM: Record<DriveType, number[]> = { tape: [0, -0.1, -0.8, -2.4, -4.7], tube: [0, 0.2, 0.1, -0.5, -3.6], console: [0, -0.1, -0.4, -0.9, -2.7], crunch: [0, -0.1, -1.3, -4.2, -6.9], fuzz: [0, -1.4, -5.8, -7.9, -8.8], clip: [0, 0.3, -1.5, -4.3, -6.2] };
/** each kind of reverb returns a different amount of what it is sent, once its lows are cut */
const VERB_SEND: Record<HarpVerb, number> = { hall: 1, room: 1.13, plate: 1.35, spring: 0.87, dark: 0.75 };
/** How much of the sound goes to the reverb (the room comes back at the level it is sent), for the Reverb knob and the kind of room. */
export const verbSendOf = (s: Pick<HarpSound, "space" | "verb">) => Math.pow(s.space, 1.3) * 1.5 * VERB_SEND[s.verb];
/** The reverb's gap before it starts (seconds). */
export const VERB_PRE = 0.018;
/** Read a value off a curve given as points. */
const table = (xs: number[], ys: number[], x: number) => {
  let i = 0;
  while (i < xs.length - 2 && x > xs[i + 1]) i++;
  const t = Math.min(1, Math.max(0, (x - xs[i]) / (xs[i + 1] - xs[i])));
  return ys[i] + (ys[i + 1] - ys[i]) * t;
};
const db = (v: number) => Math.pow(10, v / 20);

export function createRack(c: BaseAudioContext, out: AudioNode = c.destination): Rack {
  const gain = (v = 1) => {
    const g = c.createGain();
    g.gain.value = v;
    return g;
  };
  const filter = (type: BiquadFilterType, freq: number, q = 0.707, db = 0) => {
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.gain.value = db;
    return f;
  };
  const oscs: OscillatorNode[] = [];
  const lfo = (hz: number, type: OscillatorType = "sine") => {
    const o = c.createOscillator();
    oscs.push(o);
    o.type = type;
    o.frequency.value = hz;
    o.start();
    return o;
  };

  const input = gain();
  // ── squeeze ──
  const comp = c.createDynamicsCompressor();
  comp.knee.value = 12;
  comp.attack.value = 0.015;
  comp.release.value = 0.12;
  comp.threshold.value = 0;
  comp.ratio.value = 1;
  const compTrim = gain();
  input.connect(comp).connect(compTrim);

  // ── saturation: the lowest notes go round it, so chords stay clear instead of turning to mud ──
  const sat = createSaturator(c, DRIVE_REF, true);
  const driven = gain();
  compTrim.connect(sat.input);
  sat.output.connect(driven);

  // ── tone ──
  const hp = filter("highpass", 60);
  const lowShelf = filter("lowshelf", 240);
  const highShelf = filter("highshelf", 3200);
  driven.connect(hp).connect(lowShelf).connect(highShelf);

  // ── phaser: four all-pass stages swept slowly, mixed half and half with the dry sound ──
  const phased = gain();
  const phaseWet = gain(0);
  const stages = [0, 1, 2, 3].map(() => filter("allpass", 870, 0.6));
  const phaseLfo = lfo(0.33);
  const phaseDepth = gain(1500); // cents either side of 870 Hz: about 360 Hz to 2.1 kHz
  phaseLfo.connect(phaseDepth);
  stages.forEach((s) => phaseDepth.connect(s.detune));
  highShelf.connect(phased);
  stages.reduce<AudioNode>((a, s) => a.connect(s), highShelf).connect(phaseWet).connect(phased);

  // ── wobble: a short delay whose length drifts, as a worn tape does ──
  const tape = c.createDelay(0.05);
  tape.delayTime.value = 0.006;
  const wow = gain(0);
  const flutter = gain(0);
  lfo(0.55).connect(wow).connect(tape.delayTime);
  lfo(6.3).connect(flutter).connect(tape.delayTime);
  phased.connect(tape);

  // ── chorus: two delayed copies, drifting opposite ways, one in each speaker ──
  const chorused = gain();
  const chorusWet = gain(0);
  const merge = c.createChannelMerger(2);
  const chorusLfo = lfo(0.62, "triangle");
  const slowLfo = lfo(0.17);
  [0.013, 0.0175].forEach((base, ch) => {
    const d = c.createDelay(0.05);
    d.delayTime.value = base;
    d.channelCount = 1;
    d.channelCountMode = "explicit";
    const depth = gain(ch ? -0.0026 : 0.0026);
    const slow = gain(ch ? 0.0011 : -0.0011);
    chorusLfo.connect(depth).connect(d.delayTime);
    slowLfo.connect(slow).connect(d.delayTime);
    tape.connect(d).connect(merge, 0, ch);
  });
  tape.connect(chorused);
  merge.connect(chorusWet).connect(chorused);

  // ── tremolo ──
  const trem = gain(1);
  const tremLfo = lfo(4);
  const tremDepth = gain(0);
  tremLfo.connect(tremDepth).connect(trem.gain);
  chorused.connect(trem);

  // ── echo: two delays feeding each other, so the repeats bounce from side to side; each repeat is duller and thinner ──
  const mix = gain();
  trem.connect(mix);
  const echoSend = gain(0);
  const left = c.createDelay(2);
  const right = c.createDelay(2);
  const echoHp = filter("highpass", 180);
  const echoLp = filter("lowpass", 3200);
  const feedback = gain(0.34);
  const echoOut = c.createChannelMerger(2);
  const echoWet = gain(1);
  left.channelCount = right.channelCount = 1;
  left.channelCountMode = right.channelCountMode = "explicit";
  trem.connect(echoSend).connect(left);
  left.connect(right).connect(echoHp).connect(echoLp).connect(feedback).connect(left);
  left.connect(echoOut, 0, 0);
  right.connect(echoOut, 0, 1);
  echoOut.connect(echoWet).connect(mix);

  // ── reverb: a short gap before it, so the pluck stays clear; its lows cut, so it never booms ──
  const halo = gain();
  const verbSend = gain(0);
  const pre = c.createDelay(0.2);
  pre.delayTime.value = VERB_PRE;
  const verbHp = filter("highpass", 120);
  const verb = c.createConvolver();
  verb.normalize = false; // the room is already scaled to return exactly the energy it is sent
  const verbWet = gain(1);
  trem.connect(verbSend).connect(pre);
  echoWet.connect(gain(0.35)).connect(verbSend);
  halo.connect(pre);
  pre.connect(verbHp).connect(verb).connect(verbWet).connect(mix);

  // ── out ──
  const duck = gain();
  const level = gain(0.8);
  const top = c.createWaveShaper();
  top.curve = ceiling();
  mix.connect(duck).connect(level).connect(top).connect(out);

  let was: Partial<HarpSound> & { bpm?: number } = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  // an offline render has no time to wait for a knob to settle (it has resume() too, so ask for what only it has)
  const live = !("startRendering" in c);
  let when = 0;
  // a change booked for later that never came (playing stopped or jumped just before a section with a
  // sound of its own) must not land on top of this one: anything booked from this moment on goes
  const to = (p: AudioParam, v: number, tc = 0.03) => {
    if (was.level === undefined) p.value = v;
    else p.cancelScheduledValues(when).setTargetAtTime(v, when, tc);
  };
  const room = (s: HarpSound) => {
    const sides = renderSpace(c.sampleRate, s.size, drumRng(11), s.verb);
    const buf = c.createBuffer(2, sides[0].length, c.sampleRate);
    sides.forEach((d, ch) => buf.getChannelData(ch).set(d));
    verb.buffer = buf;
  };

  return {
    input,
    halo,
    duck,
    set(s, bpm, at) {
      when = Math.max(at ?? 0, c.currentTime);
      if (s.squeeze !== was.squeeze) {
        to(comp.threshold, -34 * s.squeeze);
        to(comp.ratio, 1 + 4 * s.squeeze);
      }
      if (s.squeeze !== was.squeeze) to(compTrim.gain, db(table(QUARTERS, SQUEEZE_DB, s.squeeze)));
      if (s.drive !== was.drive || s.driveType !== was.driveType || s.driveMix !== was.driveMix) sat.set(s.driveType, s.drive, s.driveMix, table(QUARTERS, DRIVE_TRIM[s.driveType], s.drive));
      if (s.tone !== was.tone) {
        to(lowShelf.gain, s.tone < 0 ? -2 * s.tone : -3 * s.tone);
        to(highShelf.gain, s.tone < 0 ? 14 * s.tone : 8 * s.tone);
      }
      if (s.tone !== was.tone) to(driven.gain, db(s.tone < 0 ? 1.2 * s.tone : 1.5 * s.tone));
      if (s.phaser !== was.phaser) {
        to(phaseWet.gain, s.phaser);
        to(phased.gain, 1 - 0.26 * s.phaser);
      }
      if (s.wobble !== was.wobble) {
        // up to about ±12 cents of slow drift and ±3 cents of flutter
        to(wow.gain, 0.002 * s.wobble * s.wobble);
        to(flutter.gain, 0.00005 * s.wobble);
      }
      if (s.chorus !== was.chorus) {
        to(chorusWet.gain, 0.75 * s.chorus);
        to(chorused.gain, 1 - 0.2 * s.chorus);
      }
      if (s.trem !== was.trem) {
        // at full the volume swings from almost nothing to well above where it was
        to(tremDepth.gain, 0.62 * s.trem);
        to(trem.gain, 1 - 0.2 * s.trem);
      }
      if (s.tremSpeed !== was.tremSpeed || bpm !== was.bpm) to(tremLfo.frequency, ((TREM_SPEEDS.find((x) => x.id === s.tremSpeed)?.perBeat ?? 2) * bpm) / 60);
      if (s.echo !== was.echo) {
        to(echoSend.gain, Math.pow(s.echo, 1.2) * 0.75);
        to(feedback.gain, s.echo > 0 ? 0.22 + 0.3 * s.echo : 0);
      }
      if (s.echoTime !== was.echoTime || bpm !== was.bpm) {
        const sec = Math.min(1.9, ((ECHO_TIMES.find((x) => x.id === s.echoTime)?.beats ?? 0.75) * 60) / bpm);
        to(left.delayTime, sec, 0.05);
        to(right.delayTime, sec, 0.05);
      }
      if (s.space !== was.space || s.verb !== was.verb) {
        to(verbSend.gain, verbSendOf(s));
        to(mix.gain, db(-7 * Math.pow(s.space, 1.6)));
      }
      if (s.size !== was.size || s.verb !== was.verb) {
        // building a room takes a moment: wait until the knob stops moving
        clearTimeout(timer);
        const later = when - c.currentTime;
        if (!verb.buffer) room(s);
        else if (!live) {
          // a section's own room, in a render: at exactly its moment (a render that cannot pause keeps the room it has)
          if (later <= 0.001) room(s);
          else atRenderTime(c, when, () => room(s));
        } else timer = setTimeout(() => room(s), later > 0.001 ? later * 1000 : 140);
      }
      if (s.level !== was.level) to(level.gain, s.level * s.level * 1.25);
      was = { ...s, bpm };
    },
    dispose() {
      clearTimeout(timer);
      for (const o of oscs) {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
        o.disconnect();
      }
      top.disconnect();
    },
  };
}
