/**
 * The harp, live: plays notes rendered by harp.ts through the effects in rack.ts,
 * and steps through a progression in time (with the drums).
 */
import { barBeats, barsOf, lenOf, levelAt, stepBeat, type Beat } from "./beats";
import { audioContext, audioIfStarted } from "./context";
import { onKickHit, playStep, prepareBeat, setBedPlaying, stopDrums, syncDrums } from "./drumbus";
import { DRUM_IDS, drumRng } from "./drums";
import { STRING_KEYS, renderHarp, stringKey, voiceShift, type HarpString } from "./harp";
import { melodyBeats, nextNote, tuneBetween } from "../song/melody";
import { itemNotes, meterOf, sectionStart, styleNotes, type PatternId, type PlayItem, type PlayTune } from "./patterns";
import { dropPulses, listening, pulse } from "./pulse";
import { describe, type Sound } from "./describe";
import { tapStem } from "./stems";
import { fader, levelOf } from "./mix";
export type { PlayItem } from "./patterns";
import { SOUND_DEFAULT, createRack, type HarpSound, type Rack } from "./rack";

/** How many rendered notes are kept (each is up to a megabyte). */
const MAX_NOTES = 96;

interface Ringing {
  srcs: AudioBufferSourceNode[];
  gain: GainNode;
}

/** A set of strings on one audio context (the live one, or an offline one for measuring and bouncing). */
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

export class Harp {
  readonly rack: Rack;
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

  constructor(readonly c: BaseAudioContext, out?: AudioNode) {
    this.rack = createRack(c, out);
    this.rack.set(this.sound, 90);
  }

  /** Change the sound. The effects follow at once; `strings: false` leaves the notes themselves as they were. */
  setSound(s: HarpSound, bpm: number, strings = true) {
    this.sound = s;
    if (strings) this.strings = s;
    this.rack.set(s, bpm);
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
    src.connect(vcf).connect(g).connect(pan).connect(this.rack.input);
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
      sh.connect(sg).connect(this.rack.halo);
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

/** The melody's own strings: a new note stops the one before it, so a tune stays a tune and does not smear. */
const TUNE_SLOT = 48;
/** A single melody note against a whole chord: it is played this much louder so the tune sits on top. */
const TUNE_LIFT = 1.7;

/** How loud one string is before the effects. */
const VOICE_GAIN = 0.4;

/**
 * Two harps, each with its own instrument and its own effects: one plays the chords, one the melody.
 * Both dip under the kick when the drums' Pump is up.
 */
interface Live {
  harp: Harp | null;
  sound: HarpSound;
  settle: number;
}
const chordsLive: Live = { harp: null, sound: SOUND_DEFAULT, settle: 0 };
const tuneLive: Live = { harp: null, sound: SOUND_DEFAULT, settle: 0 };
let tempo = 90;
const ducks: AudioParam[] = [];
let ducking = false;

function wake(l: Live): Harp {
  const ctx = audioContext();
  if (!l.harp) {
    // each harp goes out through a tap of its own, so the canvas can hear the chords and the melody apart
    // …through its track's fader (volume, mute and solo for the whole song)
    const out = ctx.createGain();
    const f = fader(l === tuneLive ? "melody" : "chords", ctx);
    out.connect(f);
    tapStem(l === tuneLive ? "melody" : "chords", f);
    l.harp = new Harp(ctx, out);
    l.harp.tag = l === tuneLive ? "melody" : "chord";
    l.harp.setSound(l.sound, tempo);
    ducks.push(l.harp.rack.duck.gain);
    if (!ducking) {
      ducking = true;
      // Pump: the harps dip under every kick and swell back, like a sidechained compressor
      onKickHit((when, depth) => {
        for (const duck of ducks) {
          duck.cancelScheduledValues(when);
          duck.setTargetAtTime(1 - 0.75 * Math.min(1, depth), when, 0.004);
          duck.setTargetAtTime(1, when + 0.03, 0.09);
        }
      });
    }
  }
  return l.harp;
}
const live = () => wake(chordsLive);
const liveTune = () => wake(tuneLive);

export function getAudio(): AudioContext {
  return live().c as AudioContext;
}

/**
 * Change a harp's sound and effects. Safe to call before any sound has been made.
 * The effects follow at once. New strings (instrument, pluck, soft, ring, body) mean new notes have
 * to be made, so those wait until the knob has stopped moving.
 */
function setLive(l: Live, s: HarpSound, bpm: number) {
  l.sound = s;
  tempo = bpm;
  const h = l.harp;
  if (!h) return;
  const same = STRING_KEYS.every((k) => h.strings[k] === s[k]);
  h.setSound(s, bpm, same);
  window.clearTimeout(l.settle);
  if (!same)
    l.settle = window.setTimeout(() => {
      h.setSound(l.sound, tempo);
      prepareNotes(queue);
    }, 150);
}
/** The harp that plays the chords. */
export const setHarpSound = (s: HarpSound, bpm: number) => setLive(chordsLive, s, bpm);
/** The harp that plays the melody: a separate instrument with separate effects. */
export const setTuneSound = (s: HarpSound, bpm: number) => setLive(tuneLive, s, bpm);

/** A note to get ready: for the chords or the melody, on that harp's own strings or a given section's. */
export interface Prep {
  midi: number;
  tune?: boolean;
  as?: HarpString;
}
let queue: Prep[] = [];
let queued = 0;
/** Get these notes ready in the background, one at a time, so playing never has to wait for them. */
export function prepareNotes(list: Prep[]) {
  queue = list;
  if (queued) return;
  const step = () => {
    queued = 0;
    const next = queue.find((n) => {
      const h = n.tune ? tuneLive.harp : chordsLive.harp;
      return !!h && !h.has(n.midi, n.as);
    });
    if (!next) return;
    (next.tune ? tuneLive.harp : chordsLive.harp)!.buffer(next.midi, next.as);
    queued = window.setTimeout(step, 0);
  };
  queued = window.setTimeout(step, 0);
}

/** Play a single note. `slot` = string index. */
/** While a page edits a track added on the Track page, the notes it plays to be heard go to that track's harp. */
const heardOn: { chord: { id: string; sound: HarpSound } | null; melody: { id: string; sound: HarpSound } | null } = { chord: null, melody: null };
export function hearOn(kind: "chord" | "melody", track: { id: string; sound: HarpSound } | null) {
  heardOn[kind] = track;
}
const chordHarp = () => (heardOn.chord ? trackHarp(heardOn.chord.id, heardOn.chord.sound, "chord") : live());

export function playNote(midi: number, when?: number, velocity = 0.8, slot?: number, lengthSec = Infinity) {
  // a melody note is played by the melody's own harp
  const tune = slot === TUNE_SLOT;
  const h = tune ? (heardOn.melody ? trackHarp(heardOn.melody.id, heardOn.melody.sound, "melody") : liveTune()) : chordHarp();
  h.play(midi, when ?? h.c.currentTime + 0.01, velocity, slot, lengthSec, false, tune ? TUNE_LIFT : 1);
}

/** Roll a chord (the note on each string, null = not played), the way a harpist spreads one. */
export function strum(midi: (number | null)[], opts: { when?: number; dir?: "down" | "up"; spread?: number; velocity?: number; length?: number } = {}) {
  const h = chordHarp();
  const strings = midi.map((m, s) => ({ m, s })).filter((x): x is { m: number; s: number } => x.m !== null);
  // the first note sounds as soon as the notes are ready
  for (const x of strings) h.buffer(x.m);
  const t0 = opts.when ?? h.c.currentTime + 0.02;
  if (opts.dir === "up") strings.reverse();
  strings.forEach(({ m, s }, i) => h.play(m, t0 + i * (opts.spread ?? 0.028), (opts.velocity ?? 0.78) * (1 + i * 0.02), s, opts.length ?? Infinity));
}

export function stopAll() {
  if (!audioIfStarted()) return;
  chordsLive.harp?.stopAll();
  tuneLive.harp?.stopAll();
  for (const e of extraHarps.values()) e.harp.stopAll();
}

/** The harps of the tracks added on the Track page: one each, through its own fader. */
const extraHarps = new Map<string, { harp: Harp; sig: string }>();
function trackHarp(id: string, sound: HarpSound, kind: "chord" | "melody"): Harp {
  const ctx = audioContext();
  let e = extraHarps.get(id);
  if (!e || e.harp.c !== ctx) {
    const out = ctx.createGain();
    out.connect(fader(id, ctx));
    const harp = new Harp(ctx, out);
    harp.tag = kind;
    harp.track = id;
    ducks.push(harp.rack.duck.gain);
    e = { harp, sig: "" };
    extraHarps.set(id, e);
  }
  const sig = JSON.stringify(sound);
  if (sig !== e.sig) {
    e.harp.setSound(sound, tempo);
    e.sig = sig;
  }
  return e.harp;
}

/** Play a scale / list of notes one after another. */
export function playSequence(midis: number[], noteSec = 0.28) {
  const h = live();
  for (const m of new Set(midis)) h.buffer(m);
  const t0 = h.c.currentTime + 0.05;
  midis.forEach((m, i) => h.play(m, t0 + i * noteSec, 0.75, 0, noteSec * 1.6));
}

/** Every note a run of chords and its melodies will need, each with the sound of its own section. */
export function prepFor(items: PlayItem[], pattern: PatternId, beat: Beat | null = null, tune: PlayTune | null = null): Prep[] {
  const out: Prep[] = itemNotes(items, pattern, beat).map((n) => ({ midi: n.e.midi, as: items[n.item].sound }));
  let at = 0;
  let origin = 0;
  items.forEach((item, i) => {
    origin = sectionStart(item, i, at, origin);
    const t = item.tune === undefined ? tune : item.tune;
    if (t && t.m.on !== false) for (const h of tuneBetween(t.m, t.bar, at - origin, at - origin + item.beats)) out.push({ midi: h.midi, tune: true, as: t.sound });
    at += item.beats;
  });
  return out;
}

/** Pluck everything one chord's style asks for, starting at time `t`. */
function playItem(h: Harp, item: PlayItem, t: number, spb: number, pattern: PatternId, at: number, beat: Beat | null) {
  const notes = styleNotes(item.midi, item.beats, item.style ?? pattern, at, meterOf(item.drums ?? beat), item.feel);
  const when = (e: (typeof notes)[number]) => e.beat * spb + e.delay;
  const watched = listening();
  for (const e of notes) {
    const held = Math.min(e.length, item.beats - e.beat) * spb - e.delay;
    // for the canvas: a string that is plucked again stops sounding as it was, so a note lasts only until its string's next pluck
    let until = Infinity;
    if (watched) {
      for (const o of notes) {
        const gap = when(o) - when(e);
        if (o.slot === e.slot && gap > 0.02 && gap < until) until = gap;
      }
    }
    h.play(e.midi, t + when(e), e.velocity, e.slot, Math.min(held, e.cut ?? Infinity), e.cut !== undefined, 1, item.sound, until);
  }
}

/**
 * The chords alone, played once through the effects into a buffer, without a speaker.
 * Used to measure levels; it is also everything an audio export would need.
 */
export async function renderOffline(items: PlayItem[], bpm: number, pattern: PatternId, s: HarpSound, tail = 2, sr = 44100): Promise<AudioBuffer> {
  const spb = 60 / bpm;
  const total = items.reduce((a, x) => a + x.beats, 0) * spb + tail;
  const c = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const h = new Harp(c);
  h.setSound(s, bpm);
  let at = 0;
  let origin = 0;
  items.forEach((item, i) => {
    origin = sectionStart(item, i, at, origin);
    playItem(h, item, 0.05 + at * spb, spb, pattern, at - origin, null);
    at += item.beats;
  });
  return c.startRendering();
}

// ── Progression player (look-ahead scheduler) ─────────────────

/** Where a chord starts: the drum grid re-locks to each of these, so tempo changes and loops stay tight. */
interface Anchor {
  time: number;
  /** beats since the start of this pass through the progression */
  beat: number;
  /** seconds per beat */
  spb: number;
  /** which item this chord is, to look up its drums live (so edits are heard straight away) */
  index: number;
  /** where the drum pattern started (the start of the pass, or of the song section) */
  origin: number;
}

export class ProgressionPlayer {
  private timer: number | null = null;
  private stepTimer: number | null = null;
  private startTime = 0;
  private items: PlayItem[] = [];
  private bpm = 90;
  private pattern: PatternId = "ring";
  private loop = true;
  private nextIndex = 0;
  private nextTime = 0;
  private passBeat = 0;
  private origin = 0;
  private endAt: number | null = null;
  private marks: { time: number; index: number }[] = [];
  // drums
  private beat: Beat | null = null;
  private anchors: Anchor[] = [];
  private cur: Anchor | null = null;
  private dStep = 0;
  private dDiv = 4;
  private drumMarks: { time: number; step: number }[] = [];
  // melody: scheduled a moment ahead, like the drums, so a note tapped in is heard on the next pass of the grid
  private tune: PlayTune | null = null;
  private tAnchors: Anchor[] = [];
  private tCur: Anchor | null = null;
  private tTick = 0;
  /** where recent chords started, to tell how far into its section the music is */
  private spans: Anchor[] = [];
  /** the drum tracks added on the Track page, each on a grid of its own */
  private lanes = new Map<string, { anchors: Anchor[]; cur: Anchor | null; step: number; div: number }>();
  onStep: (index: number) => void = () => {};
  /** Called as each drum step sounds (step index inside the bar), or with −1 when playback stops. */
  onDrumStep: (step: number) => void = () => {};
  onEnd: () => void = () => {};
  playing = false;

  /** With no chords, the beat and the melody play on their own, the whole of the longer one each time round. */
  private fill(items: PlayItem[]): PlayItem[] {
    if (items.length) return items;
    const drums = this.beat?.on ? barBeats(this.beat) * barsOf(this.beat) : 0;
    const tune = this.tune && this.tune.m.on !== false && this.tune.m.notes.length ? melodyBeats(this.tune.m, this.tune.bar) : 0;
    const beats = tune && drums ? Math.ceil(tune / drums - 1e-6) * drums : Math.max(drums, tune);
    return beats ? [{ midi: [], beats }] : [];
  }

  private tuneAt(a: Anchor): PlayTune | null {
    const own = this.items[a.index]?.tune;
    return own === undefined ? this.tune : own;
  }

  /** How many beats into its section the music is right now (null when stopped). */
  sectionBeat(): number | null {
    return this.position()?.beat ?? null;
  }

  /** What is sounding right now: which item of the list, and how many beats into its section (null when stopped). */
  position(): { index: number; beat: number } | null {
    if (!this.playing) return null;
    const now = getAudio().currentTime;
    let at: Anchor | null = null;
    for (const s of this.spans) if (s.time <= now) at = s;
    return at ? { index: at.index, beat: at.beat - at.origin + (now - at.time) / at.spb } : null;
  }

  private drumsAt(a: Anchor): Beat | null {
    return this.items[a.index]?.drums ?? this.beat;
  }

  start(items: PlayItem[], bpm: number, pattern: PatternId, loop: boolean, beat: Beat | null = null, fromIndex = 0, tune: PlayTune | null = null) {
    this.stop();
    this.beat = beat;
    this.tune = tune;
    const list = this.fill(items);
    if (!list.length) return;
    const c = getAudio();
    this.items = list;
    this.bpm = bpm;
    this.pattern = pattern;
    this.loop = loop || !items.length;
    this.nextIndex = fromIndex;
    this.passBeat = list.slice(0, fromIndex).reduce((a, x) => a + x.beats, 0);
    this.origin = 0;
    this.endAt = null;
    this.dDiv = beat?.div ?? 4;
    setBedPlaying(true, beat);
    if (beat) {
      syncDrums(beat, bpm);
      for (const b of new Set([beat, ...list.map((x) => x.drums).filter((x): x is Beat => !!x)])) prepareBeat(b);
    }
    // the first chords are made ready before the clock starts, the rest while they play
    const h = live();
    const need = itemNotes(list, pattern, beat);
    for (const n of need) if (n.item <= fromIndex + 1 && n.item >= fromIndex) h.buffer(n.e.midi, list[n.item].sound);
    prepareNotes(prepFor(list, pattern, beat, tune));
    this.startTime = c.currentTime + 0.08;
    this.nextTime = this.startTime;
    this.playing = true;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.stepTimer = window.setInterval(() => this.tick(), 30);
    this.schedule();
  }

  /** Update tempo/pattern/items/beat on the fly (chords from the next chord, drums from the next step). */
  update(items: PlayItem[], bpm: number, pattern: PatternId, loop: boolean, beat: Beat | null = null, tune: PlayTune | null = null) {
    this.beat = beat;
    this.tune = tune;
    this.items = this.fill(items);
    this.bpm = bpm;
    this.pattern = pattern;
    this.loop = loop || !items.length;
    if (beat) syncDrums(beat, bpm);
    setBedPlaying(this.playing, beat);
    // chords were removed while playing: start over. (Exactly at the end is left alone, so a song that is not looping can finish.)
    if (this.nextIndex > this.items.length) this.nextIndex = 0;
  }

  private schedule() {
    const c = getAudio();
    const horizon = c.currentTime + 0.25;
    const spb = 60 / this.bpm;
    while (this.playing && this.nextTime < horizon) {
      if (this.nextIndex >= this.items.length) {
        if (!this.loop || !this.items.length) {
          this.endAt = this.nextTime;
          this.marks.push({ time: this.nextTime, index: -1 });
          this.playing = false;
          break;
        }
        this.nextIndex = 0;
        this.passBeat = 0;
      }
      const item = this.items[this.nextIndex];
      const t = this.nextTime;
      this.origin = sectionStart(item, this.nextIndex, this.passBeat, this.origin);
      this.marks.push({ time: t, index: this.nextIndex });
      const anchor: Anchor = { time: t, beat: this.passBeat, spb, index: this.nextIndex, origin: this.origin };
      this.anchors.push(anchor);
      this.tAnchors.push(anchor);
      this.spans.push(anchor);
      if (this.spans.length > 24) this.spans.shift();
      playItem(live(), item, t, spb, this.pattern, this.passBeat - this.origin, this.beat);
      // the extra chords tracks: every chord that starts while this item plays
      const ex = item.extra;
      if (ex) {
        const s0 = this.passBeat - this.origin;
        const s1 = s0 + item.beats;
        for (const c of ex.chords)
          if (c.midi.length && c.at >= s0 - 1e-6 && c.at < s1 - 1e-6)
            playItem(trackHarp(c.track, c.sound, "chord"), { midi: c.midi, beats: c.beats, style: c.style, feel: c.feel, sound: c.sound, drums: item.drums }, t + (c.at - s0) * spb, spb, this.pattern, c.at, this.beat);
        for (const d of ex.drums) if (!this.lanes.has(d.track)) this.lanes.set(d.track, { anchors: [], cur: null, step: 0, div: d.beat.div });
      }
      for (const lane of this.lanes.values()) lane.anchors.push(anchor);
      this.nextTime += item.beats * spb;
      this.passBeat += item.beats;
      this.nextIndex++;
    }
    this.scheduleDrums(horizon);
    this.scheduleExtraDrums(horizon);
    this.scheduleTune(horizon);
  }

  /** The melody, a twelfth of a beat at a time. */
  private scheduleTune(horizon: number) {
    const first = (a: Anchor) => Math.ceil((a.beat - a.origin) * 12 - 1e-6);
    for (let guard = 0; guard < 2000; guard++) {
      if (!this.tCur) {
        const next = this.tAnchors.shift();
        if (!next) return;
        this.tCur = next;
        this.tTick = first(next);
      }
      const cur = this.tCur;
      const base = cur.time + (cur.origin + this.tTick / 12 - cur.beat) * cur.spb;
      const next = this.tAnchors[0];
      if (next && base >= next.time - 1e-4) {
        this.tCur = this.tAnchors.shift()!;
        this.tTick = first(this.tCur);
        continue;
      }
      if (this.endAt !== null && base >= this.endAt - 1e-4) return;
      if (!next && base >= this.nextTime - 1e-4) return;
      if (base >= horizon) return;
      const t = this.tuneAt(cur);
      if (t && t.m.on !== false && t.m.notes.length) {
        const hits = tuneBetween(t.m, t.bar, this.tTick / 12, (this.tTick + 1) / 12, t.swing);
        // (for the canvas: a melody note sounds until the next one comes)
        const gap = hits.length ? nextNote(t.m, t.bar, this.tTick / 12) * cur.spb : 0;
        hits.forEach((h, i) => liveTune().play(h.midi, cur.time + (cur.origin + h.beat - cur.beat) * cur.spb, 0.9, TUNE_SLOT + Math.min(i, 3), Infinity, false, TUNE_LIFT, t.sound, gap));
      }
      // the extra melody tracks, each on its own harp
      for (const x of this.items[cur.index]?.extra?.tunes ?? []) {
        const xt = x.tune;
        if (xt.m.on === false || !xt.m.notes.length) continue;
        const hits = tuneBetween(xt.m, xt.bar, this.tTick / 12, (this.tTick + 1) / 12, xt.swing);
        if (!hits.length) continue;
        const gap = nextNote(xt.m, xt.bar, this.tTick / 12) * cur.spb;
        const harp = trackHarp(x.track, xt.sound ?? SOUND_DEFAULT, "melody");
        hits.forEach((h, i) => harp.play(h.midi, cur.time + (cur.origin + h.beat - cur.beat) * cur.spb, 0.9, TUNE_SLOT + Math.min(i, 3), Infinity, false, TUNE_LIFT, xt.sound, gap));
      }
      this.tTick++;
    }
  }

  /** Drums run on their own short look-ahead, so edits to the grid are heard on the very next step. */
  private scheduleDrums(horizon: number) {
    // first grid step at or after a chord's start, counted from where the pattern started
    const firstStep = (a: Anchor, div: number) => Math.ceil((a.beat - a.origin) * div - 1e-6);
    for (let guard = 0; guard < 400; guard++) {
      if (!this.cur) {
        const first = this.anchors.shift();
        if (!first) return;
        this.cur = first;
        this.dDiv = this.drumsAt(first)?.div ?? 4;
        this.dStep = firstStep(first, this.dDiv);
      }
      const cur = this.cur;
      const b = this.drumsAt(cur);
      const div = b?.div ?? 4;
      if (div !== this.dDiv) {
        // the rhythm changed to a different grid: carry on from the same place in the bar
        this.dStep = Math.ceil((this.dStep / this.dDiv) * div - 1e-6);
        this.dDiv = div;
      }
      const swing = b?.swing ?? 0;
      const base = cur.time + (cur.origin + this.dStep / div - cur.beat) * cur.spb;
      const next = this.anchors[0];
      if (next && base >= next.time - 1e-4) {
        this.cur = this.anchors.shift()!;
        this.dDiv = this.drumsAt(this.cur)?.div ?? 4;
        this.dStep = firstStep(this.cur, this.dDiv);
        continue;
      }
      if (this.endAt !== null && base >= this.endAt - 1e-4) return;
      if (!next && base >= this.nextTime - 1e-4) return; // wait until the next chord is scheduled
      if (base >= horizon) return;
      const step = b ? this.dStep % lenOf(b) : 0;
      const t = cur.time + (cur.origin + Math.floor(this.dStep / div) + stepBeat(this.dStep % div, div, swing) - cur.beat) * cur.spb;
      if (b?.on) {
        for (const id of DRUM_IDS) {
          const lv = levelAt(b.rows, id, step);
          if (lv) playStep(b, id, lv, t);
        }
        this.drumMarks.push({ time: t, step });
      }
      this.dStep++;
    }
  }

  /** The drum tracks added on the Track page: the same as the first drums, each on its own grid. */
  private scheduleExtraDrums(horizon: number) {
    const firstStep = (a: Anchor, div: number) => Math.ceil((a.beat - a.origin) * div - 1e-6);
    for (const [track, lane] of this.lanes) {
      const beatAt = (a: Anchor) => this.items[a.index]?.extra?.drums.find((d) => d.track === track)?.beat ?? null;
      for (let guard = 0; guard < 400; guard++) {
        if (!lane.cur) {
          const first = lane.anchors.shift();
          if (!first) break;
          lane.cur = first;
          lane.div = beatAt(first)?.div ?? 4;
          lane.step = firstStep(first, lane.div);
        }
        const cur = lane.cur;
        const b = beatAt(cur);
        const div = b?.div ?? lane.div;
        if (div !== lane.div) {
          lane.step = Math.ceil((lane.step / lane.div) * div - 1e-6);
          lane.div = div;
        }
        const base = cur.time + (cur.origin + lane.step / div - cur.beat) * cur.spb;
        const next = lane.anchors[0];
        if (next && base >= next.time - 1e-4) {
          lane.cur = lane.anchors.shift()!;
          lane.div = beatAt(lane.cur)?.div ?? lane.div;
          lane.step = firstStep(lane.cur, lane.div);
          continue;
        }
        if (this.endAt !== null && base >= this.endAt - 1e-4) break;
        if (!next && base >= this.nextTime - 1e-4) break;
        if (base >= horizon) break;
        const gain = levelOf(track);
        if (b?.on && gain > 0) {
          const step = lane.step % lenOf(b);
          const t = cur.time + (cur.origin + Math.floor(lane.step / div) + stepBeat(lane.step % div, div, b.swing ?? 0) - cur.beat) * cur.spb;
          for (const id of DRUM_IDS) {
            const lv = levelAt(b.rows, id, step);
            if (lv) playStep(b, id, lv, t, gain, track);
          }
        }
        lane.step++;
      }
    }
  }

  private tick() {
    const c = getAudio();
    while (this.drumMarks.length && this.drumMarks[0].time <= c.currentTime) this.onDrumStep(this.drumMarks.shift()!.step);
    while (this.marks.length && this.marks[0].time <= c.currentTime) {
      const m = this.marks.shift()!;
      if (m.index === -1) {
        this.stop();
        this.onEnd();
        return;
      }
      this.onStep(m.index);
    }
  }

  stop() {
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.stepTimer !== null) window.clearInterval(this.stepTimer);
    this.timer = this.stepTimer = null;
    this.marks = [];
    this.anchors = [];
    this.tAnchors = [];
    this.tCur = null;
    this.spans = [];
    this.cur = null;
    this.lanes.clear();
    this.drumMarks = [];
    this.onDrumStep(-1);
    dropPulses();
    setBedPlaying(false, null);
    for (const duck of ducks) {
      duck.cancelScheduledValues(0);
      duck.setValueAtTime(1, getAudio().currentTime);
    }
    stopAll();
    stopDrums();
  }
}
