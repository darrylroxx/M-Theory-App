/**
 * The browser's recorder, on the audio thread (see webrec.ts): whatever the microphone gives is gathered, channel by
 * channel, into blocks of about 43 ms and handed to the page as each fills (its buffers moved, not copied), with the
 * audio clock at the block's first frame. It makes no sound itself.
 */
import { WEBREC_BLOCK, WEBREC_PROCESSOR, type WebBlock } from "./webreccore";

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const sampleRate: number;
declare const currentFrame: number;
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class WebRecProcessor extends AudioWorkletProcessor {
  private on = true;
  /** the block being filled: one list for each channel, how full it is, and the clock at its first frame */
  private bufs: Float32Array[] = [];
  private fill = 0;
  private at = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data !== "stop") return;
      // what is left goes out, and then the word that it was the last
      this.on = false;
      this.flush();
      this.port.postMessage("done");
    };
  }

  private flush() {
    if (!this.fill) return;
    const channels = this.bufs.map((b) => (this.fill === b.length ? b : b.slice(0, this.fill)));
    const block: WebBlock = { at: this.at, channels };
    this.port.postMessage(block, channels.map((c) => c.buffer));
    this.bufs = [];
    this.fill = 0;
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.on) return false;
    const inp = inputs[0];
    // (the microphone is not joined on yet: nothing is kept until it is, so the first frame kept is its first)
    if (!inp || !inp.length) return true;
    const n = inp[0].length;
    // another number of channels than the block was begun with: the block goes out as it is, and a new one begins
    if (this.bufs.length !== inp.length) {
      this.flush();
      this.bufs = inp.map(() => new Float32Array(WEBREC_BLOCK));
    }
    if (!this.fill) this.at = currentFrame / sampleRate;
    for (let c = 0; c < inp.length; c++) this.bufs[c].set(inp[c], this.fill);
    this.fill += n;
    if (this.fill + n > WEBREC_BLOCK) {
      this.flush();
      this.bufs = inp.map(() => new Float32Array(WEBREC_BLOCK));
    }
    return true;
  }
}

registerProcessor(WEBREC_PROCESSOR, WebRecProcessor);
