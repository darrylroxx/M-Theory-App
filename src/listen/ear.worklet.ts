/**
 * The ears, on the audio thread: whatever is connected to each input of this node is listened
 * to as it plays (the first input is the whole mix, the others the song's tracks, see
 * `bank.ts`), and what was heard is sent back every 50 ms, each frame stamped with the audio
 * clock (see EarPost).
 */
import { EarBank, EarPost, type BankInput, type BankOut } from "./bank";

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new (opts: { processorOptions?: { inputs?: BankInput[] } }) => AudioWorkletProcessor): void;

class EarsProcessor extends AudioWorkletProcessor {
  private bank: EarBank;
  private t0 = -1;
  private on = true;
  private post = new EarPost(sampleRate);

  constructor(opts: { processorOptions?: { inputs?: BankInput[] } }) {
    super();
    this.bank = new EarBank(sampleRate, opts.processorOptions?.inputs ?? [{ key: "mix", light: false }]);
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === "stop") this.on = false;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.on) return false;
    if (this.t0 < 0) this.t0 = currentTime;
    const out: BankOut[] = this.bank.process(inputs, this.t0);
    const m = this.post.add(out, inputs[0]?.[0]?.length ?? 128);
    if (m) this.port.postMessage(m.list, m.transfer);
    return true;
  }
}
registerProcessor("m-theory-ears", EarsProcessor);
