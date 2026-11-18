/**
 * The synth as an instrument a track can play: the same interface as the plucked strings and the
 * piano (src/audio/instrument.ts), backed by one AudioWorklet processor that holds all its voices
 * and its effects.
 *
 * Live: `await load()` once, then `play()` notes ahead of time on the audio clock and `set()` the
 * sound whenever a knob moves (it glides there).
 *
 * Offline (a WAV export): make it on the OfflineAudioContext, connect `output`, `play()` the
 * whole song, and only then `await load()` and start rendering. Everything played before
 * `load()` is handed to the processor when it is made, so not one note depends on a message
 * arriving in time; `renderSynth()` below does all of that for one track.
 */
import type { Instrument } from "../audio/instrument";
import { SYNTH_PROCESSOR, type SynthEvent } from "./kernel";
import { DEFAULT_PARAMS, type SynthParams, reviveSynth } from "./params";
import { type PlayContext, type PlayNote, type SynthNote, playNotes } from "./play";
import { soundFor, tail } from "./render";
import type { SynthMessage, SynthProcessorOptions } from "./synth.worklet";
import workletUrl from "./synth.worklet.ts?worker&url";

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

/** Add the synth's processor to a context (once per context; an offline context needs its own). */
export function loadSynthWorklet(c: BaseAudioContext): Promise<void> {
  if (!c.audioWorklet || typeof AudioWorkletNode === "undefined") return Promise.reject(new Error("This browser cannot run the synth (no AudioWorklet)."));
  let ready = loaded.get(c);
  if (!ready) {
    ready = c.audioWorklet.addModule(workletUrl);
    ready.catch(() => loaded.delete(c));
    loaded.set(c, ready);
  }
  return ready;
}

const isOffline = (c: BaseAudioContext) => typeof OfflineAudioContext !== "undefined" && c instanceof OfflineAudioContext;

export interface SynthOptions {
  /** notes that can sound at once (default 8, as on the original; up to 16) */
  voices?: number;
  /** seed for drift, oscillator phases and noise: the same seed plays the same way every time */
  seed?: number;
}

export class SynthInstrument implements Instrument {
  readonly output: GainNode;
  private node: AudioWorkletNode | null = null;
  private loading: Promise<void> | null = null;
  /** sent before the processor exists, handed to it when it is made */
  private pending: SynthEvent[] = [];
  /** sent since the last flush (one message per task, not one per note) */
  private queue: SynthEvent[] = [];
  private flushing = false;
  private nextId = 1;
  private disposed = false;
  private p: SynthParams;

  constructor(readonly ctx: BaseAudioContext, params: SynthParams = DEFAULT_PARAMS, private opts: SynthOptions = {}) {
    this.output = ctx.createGain();
    this.p = reviveSynth(params);
  }

  /** The sound as last set (with its macros and way of playing). */
  get params(): SynthParams {
    return this.p;
  }

  /** Change the sound now: every knob glides to its new place (no clicks, no zipper noise). */
  set(params: SynthParams) {
    this.p = reviveSynth(params);
    this.send({ type: "params", params: soundFor(this.p) });
  }

  /** Change the sound at `when` (seconds on the audio clock): a section with a sound of its own, in a render. */
  setAt(params: SynthParams, when: number) {
    const p = reviveSynth(params);
    this.send({ type: "params", t: when, params: soundFor(p) });
  }

  play(midi: number, when: number, velocity: number, length: number, slot?: number) {
    if (!Number.isFinite(midi) || !Number.isFinite(when)) return;
    const id = this.nextId++;
    this.send({ type: "on", t: when, midi, vel: Math.max(0, Math.min(1, velocity)), id, slot: slot ?? -1 });
    if (Number.isFinite(length)) this.send({ type: "off", t: when + Math.max(0, length), id });
  }

  /**
   * Play written notes (chords, a melody) the way the sound's play settings say: as written, as
   * an arpeggio, strummed, pulsed, as a drone or as one gliding line. Returns what was played.
   */
  playWritten(notes: PlayNote[], ctx: PlayContext): SynthNote[] {
    const out = playNotes(notes, this.p.play, ctx);
    for (const n of out) this.play(n.midi, n.start, n.velocity, n.length, n.slot);
    return out;
  }

  stopAll(when?: number) {
    this.send({ type: "stop", t: when ?? this.ctx.currentTime });
  }

  /**
   * The song starts at `when`: the LFO, the drift and each note's small differences start over
   * from the seed, so playing from here sounds exactly like an offline render that starts here.
   */
  sync(when: number) {
    this.send({ type: "sync", t: when });
  }

  /** Silence at once and forget every note still to come. */
  panic() {
    this.send({ type: "panic" });
  }

  ready(): boolean {
    return this.node !== null;
  }

  load(): Promise<void> {
    if (this.node) return Promise.resolve();
    if (!this.loading) {
      this.loading = loadSynthWorklet(this.ctx).then(
        () => {
          if (this.disposed || this.node) return;
          this.make();
        },
        (e) => {
          this.loading = null;
          throw e;
        },
      );
    }
    return this.loading;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = [];
    this.queue = [];
    if (this.node) {
      this.node.port.postMessage("dispose" satisfies SynthMessage);
      this.node.port.close();
      this.node.disconnect();
      this.node = null;
    }
    this.output.disconnect();
  }

  private make() {
    let events = this.pending;
    this.pending = [];
    if (!isOffline(this.ctx)) {
      // live: a note that both started and ended while the processor was loading would only be a blip; leave it out
      const now = this.ctx.currentTime;
      const gone = new Set<number>();
      for (const e of events) if (e.type === "off" && e.t < now) gone.add(e.id);
      if (gone.size) events = events.filter((e) => !((e.type === "on" || e.type === "off") && gone.has(e.id)));
    }
    const processorOptions: SynthProcessorOptions = { params: soundFor(this.p), events, voices: this.opts.voices ?? 8, seed: this.opts.seed ?? 1 };
    const node = new AudioWorkletNode(this.ctx, SYNTH_PROCESSOR, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions });
    node.connect(this.output);
    this.node = node;
  }

  private send(e: SynthEvent) {
    if (this.disposed) return;
    if (!this.node) {
      // the processor is made with everything sent so far; a new sound replaces the one it starts with
      if (e.type === "params" && e.t === undefined) return;
      this.pending.push(e);
      return;
    }
    this.queue.push(e);
    if (!this.flushing) {
      this.flushing = true;
      queueMicrotask(() => {
        this.flushing = false;
        const q = this.queue;
        this.queue = [];
        if (this.node && q.length) this.node.port.postMessage(q satisfies SynthMessage);
      });
    }
  }
}

export interface RenderSynthOptions extends SynthOptions {
  sampleRate?: number;
  /** total length in seconds; default: until the last note has rung out */
  seconds?: number;
}

/** Render notes (in seconds from 0) through the synth's worklet in an OfflineAudioContext: exactly what live playback sounds like. */
export async function renderSynth(params: SynthParams, notes: SynthNote[], o: RenderSynthOptions = {}): Promise<AudioBuffer> {
  const sr = o.sampleRate ?? 48000;
  const p = reviveSynth(params);
  const s = soundFor(p);
  let end = 0;
  for (const n of notes) end = Math.max(end, n.start + (Number.isFinite(n.length) ? n.length : 0));
  const seconds = o.seconds ?? end + tail(s);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.max(1, Math.ceil(seconds * sr)), sampleRate: sr });
  const inst = new SynthInstrument(ctx, p, o);
  inst.output.connect(ctx.destination);
  for (const n of notes) inst.play(n.midi, n.start, n.velocity, n.length, n.slot);
  await inst.load();
  return ctx.startRendering();
}
