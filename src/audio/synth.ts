/**
 * A tiny guitar synthesizer using the Karplus–Strong plucked-string algorithm:
 * a burst of noise circulates through a short delay line whose length sets the
 * pitch; a gentle low-pass in the loop makes it decay like a real string.
 * No samples, no downloads, works offline.
 */
import { midiToFreq } from "../theory/notes";
import { STEP_VELOCITY, barBeats, levelAt, stepBeat, type Beat } from "./beats";
import { DEFAULT_PARAMS, DRUM_IDS, DRUM_MIX, renderDrum, type DrumId, type DrumParams, type KitId } from "./drums";
import { PatternId, patternEvents } from "./patterns";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<number, { buf: AudioBuffer; rate: number }>();

export function getAudio(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 1.1;
    const body = ctx.createBiquadFilter(); // a little wooden body resonance
    body.type = "peaking";
    body.frequency.value = 180;
    body.Q.value = 0.9;
    body.gain.value = 4;
    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 2500;
    presence.Q.value = 1;
    presence.gain.value = 2;
    const air = ctx.createBiquadFilter();
    air.type = "lowpass";
    air.frequency.value = 7000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    master.connect(body).connect(presence).connect(air).connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/**
 * Render one plucked note (pure function, testable without a browser).
 * Returns the samples plus the playback-rate correction that makes the pitch exact
 * (the delay line can only be a whole number of samples long).
 */
export function renderPluck(sr: number, midi: number, rand: () => number = Math.random): { data: Float32Array; rate: number } {
  const freq = midiToFreq(midi);
  const exact = sr / freq;
  // Each loop step averages the current and *next* sample, so the loop period is N − 0.5.
  const N = Math.max(2, Math.floor(exact + 0.5));
  const dur = Math.min(4.5, Math.max(1.6, 4.6 - (midi - 40) * 0.06));
  const len = Math.floor(sr * dur);
  const out = new Float32Array(len);
  const line = new Float32Array(N);
  // excitation: warm (low-passed) noise with a pick-position comb
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp += 0.55 * (rand() * 2 - 1 - lp);
    line[i] = lp;
  }
  const pickPos = Math.max(1, Math.floor(N * 0.18));
  const tmp = Float32Array.from(line);
  for (let i = 0; i < N; i++) line[i] = tmp[i] - 0.7 * tmp[(i + pickPos) % N];
  const mean = line.reduce((a, b) => a + b, 0) / N;
  for (let i = 0; i < N; i++) line[i] -= mean;
  // per-period loss so low strings sustain and high strings fade faster
  const t60 = dur * 0.75;
  const rho = Math.pow(10, -3 / (t60 * (sr / (N - 0.5))));
  let idx = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const a = line[idx];
    const b = line[idx + 1 === N ? 0 : idx + 1];
    out[i] = a;
    if (Math.abs(a) > peak) peak = Math.abs(a);
    line[idx] = rho * 0.5 * (a + b); // 2-tap average: linear phase, so pitch stays exact
    idx = idx + 1 === N ? 0 : idx + 1;
  }
  const norm = peak > 0 ? 0.6 / peak : 1;
  const fade = Math.floor(sr * 0.08);
  for (let i = 0; i < len; i++) {
    out[i] *= norm;
    if (i > len - fade) out[i] *= (len - i) / fade;
  }
  return { data: out, rate: (N - 0.5) / exact };
}

function pluck(c: AudioContext, midi: number): { buf: AudioBuffer; rate: number } {
  const hit = buffers.get(midi);
  if (hit) return hit;
  const { data, rate } = renderPluck(c.sampleRate, midi);
  const buf = c.createBuffer(1, data.length, c.sampleRate);
  buf.getChannelData(0).set(data);
  const r = { buf, rate };
  buffers.set(midi, r);
  return r;
}

interface Ringing {
  src: AudioBufferSourceNode;
  gain: GainNode;
}
const ringing = new Map<number, Ringing>(); // by string/voice slot

function damp(r: Ringing, at: number) {
  try {
    r.gain.gain.cancelScheduledValues(at);
    r.gain.gain.setTargetAtTime(0, at, 0.025);
    r.src.stop(at + 0.2);
  } catch {
    /* already stopped */
  }
}

/** Play a single note. `slot` = string index; a new note on the same string damps the old one, like a real guitar. */
export function playNote(midi: number, when?: number, velocity = 0.8, slot?: number, lengthSec = Infinity) {
  const c = getAudio();
  const t = when ?? c.currentTime + 0.01;
  const { buf, rate } = pluck(c, midi);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = c.createGain();
  g.gain.value = 0.32 * velocity;
  const pan = c.createStereoPanner();
  pan.pan.value = slot !== undefined ? (slot - 2.5) * 0.08 : 0;
  src.connect(g).connect(pan).connect(master!);
  if (slot !== undefined) {
    const prev = ringing.get(slot);
    if (prev) damp(prev, t);
    ringing.set(slot, { src, gain: g });
  }
  src.start(t);
  if (Number.isFinite(lengthSec)) damp({ src, gain: g }, t + lengthSec);
}

/** Strum a voicing (array of MIDI notes per string, null = muted). */
export function strum(midi: (number | null)[], opts: { when?: number; dir?: "down" | "up"; spread?: number; velocity?: number; length?: number } = {}) {
  const c = getAudio();
  const t0 = opts.when ?? c.currentTime + 0.02;
  const strings = midi.map((m, s) => ({ m, s })).filter((x): x is { m: number; s: number } => x.m !== null);
  if (opts.dir === "up") strings.reverse();
  strings.forEach(({ m, s }, i) =>
    playNote(m, t0 + i * (opts.spread ?? 0.025), (opts.velocity ?? 0.8) * (1 - i * 0.03), s, opts.length ?? Infinity),
  );
}

export function stopAll() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const r of ringing.values()) damp(r, t);
  ringing.clear();
}

/** Play a scale / list of notes one after another. */
export function playSequence(midis: number[], noteSec = 0.28) {
  const c = getAudio();
  const t0 = c.currentTime + 0.05;
  midis.forEach((m, i) => playNote(m, t0 + i * noteSec, 0.75, 0, noteSec * 1.6));
}

// ── Drum machine ─────────────────────────────────────────────

interface DrumBus {
  input: GainNode;
  shaper: WaveShaperNode;
  tone: BiquadFilterNode;
  wet: GainNode;
}
let drumBus: DrumBus | null = null;
let drumFx = { level: -1, space: -1, grit: -1 };
const drumBuffers = new Map<string, AudioBuffer>();
const drumLive = new Set<Ringing>();
let openHat: Ringing | null = null;

/** A plate-style reverb tail made from decaying noise (for the "Space" control). */
function reverbImpulse(c: AudioContext): AudioBuffer {
  const len = Math.floor(c.sampleRate * 2.6);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / c.sampleRate;
      lp += 0.35 * (Math.random() * 2 - 1 - lp); // darker tail
      d[i] = lp * Math.exp(-t / 0.55) * Math.min(1, t / 0.012);
    }
  }
  return buf;
}

function driveCurve(grit: number): Float32Array<ArrayBuffer> {
  const k = 1 + grit * 11;
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k) / (1 + 1.6 * grit); // more drive, same loudness
  }
  return curve;
}

function getDrumBus(): DrumBus {
  const c = getAudio();
  if (!drumBus) {
    const input = c.createGain();
    const shaper = c.createWaveShaper();
    shaper.oversample = "2x";
    const tone = c.createBiquadFilter();
    tone.type = "lowpass";
    const verb = c.createConvolver();
    verb.buffer = reverbImpulse(c);
    const wet = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    input.connect(shaper).connect(tone).connect(comp).connect(c.destination);
    tone.connect(verb).connect(wet).connect(comp);
    drumBus = { input, shaper, tone, wet };
    drumFx = { level: -1, space: -1, grit: -1 };
    setDrumFx({ level: 0.8, space: 0.25, grit: 0.1 });
  }
  return drumBus;
}

/** Drum volume, reverb ("space") and saturation ("grit"), each 0…1. */
export function setDrumFx(fx: { level: number; space: number; grit: number }) {
  const bus = getDrumBus();
  const t = getAudio().currentTime;
  if (fx.level !== drumFx.level) bus.input.gain.setTargetAtTime(fx.level * 0.55, t, 0.02);
  if (fx.space !== drumFx.space) bus.wet.gain.setTargetAtTime(Math.pow(fx.space, 1.3) * 0.9, t, 0.03);
  if (fx.grit !== drumFx.grit) {
    bus.shaper.curve = driveCurve(fx.grit);
    bus.tone.frequency.setTargetAtTime(17000 - fx.grit * 11500, t, 0.03);
  }
  drumFx = { ...fx };
}

function drumBuffer(c: AudioContext, kit: KitId, id: DrumId, p: DrumParams): AudioBuffer {
  const key = `${kit}|${id}|${p.tune}|${p.decay.toFixed(2)}|${p.tone.toFixed(2)}`;
  let buf = drumBuffers.get(key);
  if (!buf) {
    const data = renderDrum(c.sampleRate, kit, id, p);
    buf = c.createBuffer(1, data.length, c.sampleRate);
    buf.getChannelData(0).set(data);
    if (drumBuffers.size > 160) drumBuffers.clear();
    drumBuffers.set(key, buf);
  }
  return buf;
}

const DRUM_PAN: Record<DrumId, number> = { kick: 0, snare: 0, clap: 0.1, hat: 0.25, open: 0.25, tom: -0.25, rim: -0.15, shaker: -0.3, bell: 0.3 };

/** Play one drum hit. A closed or open hat cuts off a ringing open hat, like the real thing. */
export function playDrum(kit: KitId, id: DrumId, params: Partial<DrumParams> = {}, when?: number, velocity = 0.8) {
  const c = getAudio();
  const bus = getDrumBus();
  const p = { ...DEFAULT_PARAMS, ...params };
  const t = when ?? c.currentTime + 0.01;
  const src = c.createBufferSource();
  src.buffer = drumBuffer(c, kit, id, p);
  const g = c.createGain();
  g.gain.value = velocity * velocity * p.level * DRUM_MIX[id] * 1.1;
  const pan = c.createStereoPanner();
  pan.pan.value = DRUM_PAN[id];
  src.connect(g).connect(pan).connect(bus.input);
  const r: Ringing = { src, gain: g };
  if (id === "hat" || id === "open") {
    if (openHat) damp(openHat, t);
    openHat = id === "open" ? r : null;
  }
  drumLive.add(r);
  src.onended = () => drumLive.delete(r);
  src.start(t);
}

/** Render a kit's sounds ahead of time so the first bar plays without a hiccup. */
export function prepareBeat(beat: Beat) {
  const c = getAudio();
  for (const id of DRUM_IDS) if (/[123]/.test(beat.rows[id] ?? "")) drumBuffer(c, beat.kit, id, { ...DEFAULT_PARAMS, ...beat.sounds[id] });
}

function stopDrums() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (const r of drumLive) damp(r, t);
  drumLive.clear();
  openHat = null;
}

// ── Progression player (look-ahead scheduler) ─────────────────

export interface PlayItem {
  midi: (number | null)[];
  beats: number;
}

/** Where a chord starts: the drum grid re-locks to each of these, so tempo changes and loops stay tight. */
interface Anchor {
  time: number;
  /** beats since the start of this pass through the progression */
  beat: number;
  /** seconds per beat */
  spb: number;
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
  private endAt: number | null = null;
  private marks: { time: number; index: number }[] = [];
  // drums
  private beat: Beat | null = null;
  private anchors: Anchor[] = [];
  private cur: Anchor | null = null;
  private dStep = 0;
  private dDiv = 4;
  private drumMarks: { time: number; step: number }[] = [];
  onStep: (index: number) => void = () => {};
  /** Called as each drum step sounds (step index inside the bar), or with −1 when playback stops. */
  onDrumStep: (step: number) => void = () => {};
  onEnd: () => void = () => {};
  playing = false;

  /** With no chords, the beat plays on its own, one bar at a time. */
  private fill(items: PlayItem[]): PlayItem[] {
    return items.length ? items : this.beat?.on ? [{ midi: [], beats: barBeats(this.beat) }] : [];
  }

  start(items: PlayItem[], bpm: number, pattern: PatternId, loop: boolean, beat: Beat | null = null, fromIndex = 0) {
    this.stop();
    this.beat = beat;
    const list = this.fill(items);
    if (!list.length) return;
    const c = getAudio();
    this.items = list;
    this.bpm = bpm;
    this.pattern = pattern;
    this.loop = loop || !items.length;
    this.nextIndex = fromIndex;
    this.passBeat = list.slice(0, fromIndex).reduce((a, x) => a + x.beats, 0);
    this.startTime = c.currentTime + 0.08;
    this.nextTime = this.startTime;
    this.endAt = null;
    this.dDiv = beat?.div ?? 4;
    if (beat) {
      setDrumFx(beat);
      prepareBeat(beat);
    }
    this.playing = true;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.stepTimer = window.setInterval(() => this.tick(), 30);
    this.schedule();
  }

  /** Update tempo/pattern/items/beat on the fly (chords from the next chord, drums from the next step). */
  update(items: PlayItem[], bpm: number, pattern: PatternId, loop: boolean, beat: Beat | null = null) {
    this.beat = beat;
    this.items = this.fill(items);
    this.bpm = bpm;
    this.pattern = pattern;
    this.loop = loop || !items.length;
    if (beat) setDrumFx(beat);
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
      this.marks.push({ time: t, index: this.nextIndex });
      this.anchors.push({ time: t, beat: this.passBeat, spb });
      for (const e of patternEvents(item.midi, item.beats, this.pattern)) {
        const when = t + e.beat * spb;
        const lenSec = Number.isFinite(e.length) ? e.length * spb : Infinity;
        if (e.dir === "pick") {
          const s = item.midi.indexOf(e.notes[0]);
          playNote(e.notes[0], when, e.velocity, s >= 0 ? s : undefined, lenSec);
        } else {
          const sub = item.midi.map((m) => (m !== null && e.notes.includes(m) ? m : null));
          strum(sub, { when, dir: e.dir, spread: e.spread, velocity: e.velocity, length: lenSec });
        }
      }
      this.nextTime += item.beats * spb;
      this.passBeat += item.beats;
      this.nextIndex++;
    }
    this.scheduleDrums(horizon);
  }

  /** Drums run on their own short look-ahead, so edits to the grid are heard on the very next step. */
  private scheduleDrums(horizon: number) {
    for (let guard = 0; guard < 400; guard++) {
      const b = this.beat;
      const div = b?.div ?? 4;
      if (!this.cur) {
        const first = this.anchors.shift();
        if (!first) return;
        this.cur = first;
        this.dStep = Math.ceil(first.beat * div - 1e-6);
        this.dDiv = div;
      }
      if (div !== this.dDiv) {
        // the rhythm changed to a different grid: carry on from the same place in the bar
        this.dStep = Math.ceil((this.dStep / this.dDiv) * div - 1e-6);
        this.dDiv = div;
      }
      const cur = this.cur;
      const swing = b?.swing ?? 0;
      const base = cur.time + (this.dStep / div - cur.beat) * cur.spb;
      const next = this.anchors[0];
      if (next && base >= next.time - 1e-4) {
        this.cur = this.anchors.shift()!;
        this.dStep = Math.ceil(this.cur.beat * div - 1e-6);
        continue;
      }
      if (this.endAt !== null && base >= this.endAt - 1e-4) return;
      if (!next && base >= this.nextTime - 1e-4) return; // wait until the next chord is scheduled
      if (base >= horizon) return;
      const steps = b?.steps ?? 16;
      const step = this.dStep % steps;
      const t = cur.time + (Math.floor(this.dStep / div) + stepBeat(this.dStep % div, div, swing) - cur.beat) * cur.spb;
      if (b?.on) {
        for (const id of DRUM_IDS) {
          const lv = levelAt(b.rows, id, step);
          if (lv && !b.mutes?.includes(id)) playDrum(b.kit, id, b.sounds[id], t, STEP_VELOCITY[lv]);
        }
        this.drumMarks.push({ time: t, step });
      }
      this.dStep++;
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
    this.cur = null;
    this.drumMarks = [];
    this.onDrumStep(-1);
    stopAll();
    stopDrums();
  }
}
