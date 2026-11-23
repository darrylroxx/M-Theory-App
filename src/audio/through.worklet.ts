/**
 * The app's own sound, tapped on the audio thread for the recording engine (see through.ts): the
 * whole mix as it leaves the master, in blocks of about 21 ms, left and right interleaved, handed
 * to the page as each fills (its buffer moved, not copied); while the page is held up and has not
 * said it has the last ones, they wait and go together (see Outbox).
 */
import { CHUNK, Chunker, Outbox, THROUGH_PROCESSOR } from "./throughcore";

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: new (opts: { processorOptions?: { chunk?: number; block?: number } }) => AudioWorkletProcessor): void;

class ThroughProcessor extends AudioWorkletProcessor {
  private on = true;
  private chunks: Chunker;
  private box: Outbox;

  /** how many frames one block of the context is (128 unless it was opened with larger ones) */
  private block: number;

  constructor(opts: { processorOptions?: { chunk?: number; block?: number } }) {
    super();
    this.block = opts.processorOptions?.block ?? 128;
    this.box = new Outbox((b) => this.port.postMessage(b, [b.buffer]), sampleRate);
    this.chunks = new Chunker((b) => this.box.add(b), opts.processorOptions?.chunk ?? CHUNK);
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data === "stop") this.on = false;
      else if (e.data === "ack") this.box.ack();
    };
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.on) return false;
    const inp = inputs[0];
    // (nothing sounding: an input with no channels; it is still a block of time, sent as silence)
    this.chunks.push(inp?.[0], inp?.[1], inp?.[0]?.length ?? this.block);
    return true;
  }
}

registerProcessor(THROUGH_PROCESSOR, ThroughProcessor);
