/**
 * A tiny guitar synthesizer using the Karplus–Strong plucked-string algorithm:
 * a burst of noise circulates through a short delay line whose length sets the
 * pitch; a gentle low-pass in the loop makes it decay like a real string.
 * No samples, no downloads, works offline.
 */
import { midiToFreq } from "../theory/notes";
import { barBeats, barsOf, lenOf, levelAt, stepBeat, type Beat } from "./beats";
import { audioContext, audioIfStarted } from "./context";
import { onKickHit, playStep, prepareBeat, setBedPlaying, stopDrums, syncDrums } from "./drumbus";
import { DRUM_IDS } from "./drums";
import { PatternId, patternEvents } from "./patterns";

let master: GainNode | null = null;
/** The guitar's own volume dip under each kick (the drums' Pump control). */
let duck: GainNode | null = null;
const buffers = new Map<number, { buf: AudioBuffer; rate: number }>();

export function getAudio(): AudioContext {
  const ctx = audioContext();
  if (!master) {
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
    duck = ctx.createGain();
    master.connect(duck).connect(body).connect(presence).connect(air).connect(comp).connect(ctx.destination);
    // Pump: the guitar dips under every kick and swells back, like a sidechained compressor
    onKickHit((when, depth) => {
      const g = duck!.gain;
      g.cancelScheduledValues(when);
      g.setTargetAtTime(1 - 0.75 * Math.min(1, depth), when, 0.004);
      g.setTargetAtTime(1, when + 0.03, 0.09);
    });
  }
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
  const ctx = audioIfStarted();
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
  /** the drum rhythm under this chord (missing = the player's own beat) */
  drums?: Beat;
  /** a song section starts here: its drum pattern starts again from bar 1 */
  section?: boolean;
}

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
  onStep: (index: number) => void = () => {};
  /** Called as each drum step sounds (step index inside the bar), or with −1 when playback stops. */
  onDrumStep: (step: number) => void = () => {};
  onEnd: () => void = () => {};
  playing = false;

  /** With no chords, the beat plays on its own, the whole pattern each time round. */
  private fill(items: PlayItem[]): PlayItem[] {
    return items.length ? items : this.beat?.on ? [{ midi: [], beats: barBeats(this.beat) * barsOf(this.beat) }] : [];
  }

  private drumsAt(a: Anchor): Beat | null {
    return this.items[a.index]?.drums ?? this.beat;
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
    this.origin = 0;
    this.startTime = c.currentTime + 0.08;
    this.nextTime = this.startTime;
    this.endAt = null;
    this.dDiv = beat?.div ?? 4;
    setBedPlaying(true, beat);
    if (beat) {
      syncDrums(beat, bpm);
      for (const b of new Set([beat, ...list.map((x) => x.drums).filter((x): x is Beat => !!x)])) prepareBeat(b);
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
      if (this.nextIndex === 0 || item.section) this.origin = this.passBeat;
      this.marks.push({ time: t, index: this.nextIndex });
      this.anchors.push({ time: t, beat: this.passBeat, spb, index: this.nextIndex, origin: this.origin });
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
    setBedPlaying(false, null);
    duck?.gain.cancelScheduledValues(0);
    duck?.gain.setValueAtTime(1, getAudio().currentTime);
    stopAll();
    stopDrums();
  }
}
