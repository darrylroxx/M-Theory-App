/**
 * A tiny guitar synthesizer using the Karplus–Strong plucked-string algorithm:
 * a burst of noise circulates through a short delay line whose length sets the
 * pitch; a gentle low-pass in the loop makes it decay like a real string.
 * No samples, no downloads, works offline.
 */
import { midiToFreq } from "../theory/notes";
import { PatternId, patternEvents } from "./patterns";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<number, { buf: AudioBuffer; rate: number }>();

export function getAudio(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
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

// ── Progression player (look-ahead scheduler) ─────────────────

export interface PlayItem {
  midi: (number | null)[];
  beats: number;
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
  private marks: { time: number; index: number }[] = [];
  onStep: (index: number) => void = () => {};
  onEnd: () => void = () => {};
  playing = false;

  start(items: PlayItem[], bpm: number, pattern: PatternId, loop: boolean, fromIndex = 0) {
    this.stop();
    if (!items.length) return;
    const c = getAudio();
    this.items = items;
    this.bpm = bpm;
    this.pattern = pattern;
    this.loop = loop;
    this.nextIndex = fromIndex;
    this.startTime = c.currentTime + 0.08;
    this.nextTime = this.startTime;
    this.playing = true;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.stepTimer = window.setInterval(() => this.tick(), 30);
    this.schedule();
  }

  /** Update tempo/pattern/items on the fly (takes effect from the next chord). */
  update(items: PlayItem[], bpm: number, pattern: PatternId, loop: boolean) {
    this.items = items;
    this.bpm = bpm;
    this.pattern = pattern;
    this.loop = loop;
    if (this.nextIndex >= items.length) this.nextIndex = 0;
  }

  private schedule() {
    const c = getAudio();
    const spb = 60 / this.bpm;
    while (this.playing && this.nextTime < c.currentTime + 0.25) {
      if (this.nextIndex >= this.items.length) {
        if (!this.loop) {
          const endAt = this.nextTime;
          this.marks.push({ time: endAt, index: -1 });
          this.playing = false;
          break;
        }
        this.nextIndex = 0;
      }
      const item = this.items[this.nextIndex];
      const t = this.nextTime;
      this.marks.push({ time: t, index: this.nextIndex });
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
      this.nextIndex++;
    }
  }

  private tick() {
    const c = getAudio();
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
    stopAll();
  }
}
