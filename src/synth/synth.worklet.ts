/**
 * The synth on the audio thread: one processor holds every voice of one synth track and that
 * track's effects, and plays what it is told (see SynthEvent in kernel.ts) on the exact sample.
 *
 * Live, notes arrive a few at a time through the port, timed on the audio clock ahead of when
 * they sound. Offline (an OfflineAudioContext rendering a WAV), the whole list arrives at once in
 * the processor's options, before the first sample is made: messages are not certain to arrive
 * before an offline render starts, options are. Either way the same kernel plays the same events,
 * so what is exported is what was heard.
 */
import { SYNTH_PROCESSOR, type SynthEvent, SynthKernel, feed } from "./kernel";
import { DEFAULT_PARAMS, type SynthParams } from "./params";

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, ctor: new (options: { processorOptions?: SynthProcessorOptions }) => AudioWorkletProcessor): void;

/** What the processor is made with. */
export interface SynthProcessorOptions {
  /** the sound, in the engine's own terms (macros applied: see soundFor in render.ts) */
  params?: SynthParams;
  /** notes and changes to play, in time order as they were sent */
  events?: SynthEvent[];
  /** notes that can sound at once */
  voices?: number;
  /** seed for drift, oscillator phases and noise */
  seed?: number;
}

/** What the port accepts: one event, a list of them, or "dispose" (the processor stops for good). */
export type SynthMessage = SynthEvent | SynthEvent[] | "dispose";

class SynthProcessor extends AudioWorkletProcessor {
  private k: SynthKernel;
  private dead = false;
  /** the right channel when the output has only one (made once, not per block) */
  private spare = new Float32Array(128);

  constructor(options: { processorOptions?: SynthProcessorOptions }) {
    super(options);
    const o = options?.processorOptions ?? {};
    this.k = new SynthKernel(sampleRate, { voices: o.voices, seed: o.seed });
    this.k.setParams(o.params ?? DEFAULT_PARAMS);
    this.k.snapSmoothing();
    for (const e of o.events ?? []) feed(this.k, e);
    this.port.onmessage = (m: MessageEvent<SynthMessage>) => {
      const d = m.data;
      if (d === "dispose") this.dead = true;
      else if (Array.isArray(d)) for (const e of d) feed(this.k, e);
      else if (d && typeof d === "object") feed(this.k, d);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.dead) return false;
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const L = out[0];
    const R = out[1] ?? out[0];
    // the kernel's clock is the audio clock, so a note sent for time t starts on frame t·sampleRate
    this.k.seek(currentFrame);
    if (R === L) {
      // one channel only: render the pair and keep the mix of the two
      if (this.spare.length < L.length) this.spare = new Float32Array(L.length);
      const r = this.spare;
      this.k.render(L, r, L.length);
      for (let i = 0; i < L.length; i++) L[i] = 0.5 * (L[i] + r[i]);
    } else this.k.render(L, R, L.length);
    return true;
  }
}

registerProcessor(SYNTH_PROCESSOR, SynthProcessor);
