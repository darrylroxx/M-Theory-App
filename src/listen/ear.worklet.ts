/**
 * The ear, on the audio thread: whatever is connected to this node is listened to as it plays,
 * and what was heard is sent back a frame at a time, stamped with the audio clock.
 */
import { Ear, type Frame } from "./ear";

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class EarProcessor extends AudioWorkletProcessor {
  private ear = new Ear(sampleRate);
  private mono = new Float32Array(128);
  private t0 = -1;
  private on = true;
  private out: Frame[] = [];

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === "stop") this.on = false;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.on) return false;
    if (this.t0 < 0) this.t0 = currentTime;
    const input = inputs[0];
    const n = input && input[0] ? input[0].length : 128;
    if (this.mono.length !== n) this.mono = new Float32Array(n);
    const mono = this.mono;
    if (!input || input.length === 0) {
      // nothing is playing: silence is heard, so that whatever was sounding is heard to stop
      mono.fill(0);
    } else if (input.length === 1) {
      mono.set(input[0]);
    } else {
      const k = 1 / input.length;
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < input.length; c++) s += input[c][i];
        mono[i] = s * k;
      }
    }
    const out = this.out;
    this.ear.push(mono, out);
    if (out.length) {
      for (const f of out) f.t += this.t0;
      this.port.postMessage(out);
      this.out = [];
    }
    return true;
  }
}
registerProcessor("m-theory-ear", EarProcessor);
