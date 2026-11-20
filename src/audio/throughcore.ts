/**
 * The app's own sound through the recording engine (see through.ts): the parts that do not touch
 * the browser, so the tap on the audio thread (through.worklet.ts) and the tests can use them.
 * Nothing here may import a module that asks for a worker's URL (see worklets.test.ts).
 */
export const THROUGH_PROCESSOR = "m-theory-through";
/** Frames in each block handed over (about 21 ms at 48 kHz): few enough messages, small enough blocks. */
export const CHUNK = 1024;

/**
 * Gathers the audio thread's blocks of 128 into blocks of `chunk` frames, left and right
 * interleaved, and hands each one over as it fills (its buffer moves to whoever takes it, so a
 * fresh one is made: once every `chunk` frames, not every block). Silence where nothing is
 * connected, so the engine's queue keeps time while the app is quiet.
 */
export class Chunker {
  private buf: Float32Array;
  private at = 0;
  constructor(
    private readonly hand: (block: Float32Array) => void,
    readonly chunk = CHUNK,
  ) {
    this.buf = new Float32Array(chunk * 2);
  }
  push(l: Float32Array | undefined, r: Float32Array | undefined, n: number) {
    const R = r ?? l;
    for (let i = 0; i < n; i++) {
      const k = 2 * this.at;
      this.buf[k] = l ? l[i] : 0;
      this.buf[k + 1] = R ? R[i] : 0;
      if (++this.at === this.chunk) {
        this.hand(this.buf);
        this.buf = new Float32Array(this.chunk * 2);
        this.at = 0;
      }
    }
  }
}

/**
 * Sends the blocks to the engine one after another, in order. If the engine is slow to take
 * them (or the page was held up and they came all at once), no more than `most` wait: the oldest
 * go first, being stale (the engine skips ahead over a backlog anyway). It keeps how far behind
 * the sound is (`delay`, seconds: what is queued in the engine), and stops at the first block
 * the engine will not take (it has closed), saying so once.
 */
export class Sender {
  private waiting: Float32Array[] = [];
  private busy = false;
  private closed = false;
  /** seconds queued in the engine, lately */
  delay = 0;
  /** blocks left out, being stale */
  dropped = 0;
  /** told how far behind the sound is, each time the engine says */
  onDelay: ((seconds: number) => void) | null = null;
  constructor(
    private readonly feed: (bytes: Uint8Array) => Promise<number>,
    private readonly rate: number,
    private readonly onFail: () => void,
    readonly most = 24,
  ) {}
  send(block: Float32Array) {
    if (this.closed) return;
    this.waiting.push(block);
    while (this.waiting.length > this.most) {
      this.waiting.shift();
      this.dropped++;
    }
    if (!this.busy) void this.pump();
  }
  close() {
    this.closed = true;
    this.waiting = [];
  }
  private async pump() {
    this.busy = true;
    while (!this.closed && this.waiting.length) {
      const b = this.waiting.shift()!;
      try {
        const queued = await this.feed(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
        if (Number.isFinite(queued)) {
          // (the first figure as it is, then an average: the queue goes up and down by a block as blocks come and go)
          this.delay = this.delay === 0 ? queued / this.rate : this.delay + (queued / this.rate - this.delay) * 0.1;
          this.onDelay?.(this.delay);
        }
      } catch {
        this.close();
        this.onFail();
      }
    }
    this.busy = false;
  }
}

/**
 * Whether the app's sound should stop coming through the engine and go back to the computer's
 * sound: it ran dry `most` times within `window` seconds, even with the longer wait the engine
 * gives itself after each time (the page cannot keep it fed on this computer). Fed the engine's
 * running count of times it ran dry, with the time.
 */
export class GapWatch {
  private seen = -1;
  private times: number[] = [];
  constructor(
    readonly most = 6,
    readonly window = 60,
  ) {}
  /** The engine's count now, at `t` seconds: true once it is time to give up. */
  note(gaps: number | undefined, t: number): boolean {
    if (gaps === undefined || !Number.isFinite(gaps)) return false;
    if (this.seen < 0 || gaps < this.seen) {
      this.seen = gaps;
      return false;
    }
    for (let k = this.seen; k < gaps; k++) this.times.push(t);
    this.seen = gaps;
    this.times = this.times.filter((x) => x > t - this.window);
    return this.times.length >= this.most;
  }
}
