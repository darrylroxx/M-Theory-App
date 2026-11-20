/**
 * The master's safety limiter on the audio thread (see safety.ts): a stereo pair in, the same
 * pair out, untouched unless it goes over −1 dBFS. No lookahead, so no delay.
 */
import { SAFETY_PROCESSOR, SafetyLimiter } from "./safetycore";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class SafetyProcessor extends AudioWorkletProcessor {
  private lim = new SafetyLimiter(sampleRate);

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || !out.length) return true;
    const L = out[0];
    const R = out[1] ?? out[0];
    // nothing connected (or silent): silence out, and the gain comes back as time passes
    if (!inp || !inp.length) {
      L.fill(0);
      if (R !== L) R.fill(0);
      this.lim.process(L, R, L.length);
      return true;
    }
    const a = inp[0];
    const b = inp[1] ?? inp[0];
    L.set(a);
    if (R !== L) R.set(b);
    this.lim.process(L, R, L.length);
    return true;
  }
}

registerProcessor(SAFETY_PROCESSOR, SafetyProcessor);
