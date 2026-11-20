/**
 * The app's own sound, tapped on the audio thread for the recording engine (see through.ts): the
 * whole mix as it leaves the master, in blocks of about 21 ms, left and right interleaved, handed
 * to the page as each fills (its buffer moved, not copied).
 */
import { CHUNK, Chunker, THROUGH_PROCESSOR } from "./throughcore";

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new (opts: { processorOptions?: { chunk?: number } }) => AudioWorkletProcessor): void;

class ThroughProcessor extends AudioWorkletProcessor {
  private on = true;
  private chunks: Chunker;

  constructor(opts: { processorOptions?: { chunk?: number } }) {
    super();
    this.chunks = new Chunker((b) => this.port.postMessage(b, [b.buffer]), opts.processorOptions?.chunk ?? CHUNK);
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === "stop") this.on = false;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.on) return false;
    const inp = inputs[0];
    // (nothing sounding: an input with no channels; it is still a block of time, sent as silence)
    this.chunks.push(inp?.[0], inp?.[1], inp?.[0]?.length ?? 128);
    return true;
  }
}

registerProcessor(THROUGH_PROCESSOR, ThroughProcessor);
