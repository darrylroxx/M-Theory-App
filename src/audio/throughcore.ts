/**
 * The app's own sound through the recording engine (see through.ts): the parts that do not touch
 * the browser, so the tap on the audio thread (through.worklet.ts) and the tests can use them.
 * Nothing here may import a module that asks for a worker's URL (see worklets.test.ts).
 */
export const THROUGH_PROCESSOR = "m-theory-through";
/** Frames in each block handed over (about 21 ms at 48 kHz): few enough messages, small enough blocks. */
export const CHUNK = 1024;

/**
 * Gathers the audio thread's blocks (128 frames, or as many as the context works in) into blocks of `chunk` frames, left and right
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

/** How long the sound fades out and in where blocks were left out (seconds): long enough not to click. */
export const JOIN_FADE = 0.005;

/**
 * Fade the start of a block in (`edge` "in") or its end out ("out"), left and right interleaved,
 * over `frames` frames, along half a cosine (no corner at either end of the fade).
 */
export function fadeEdge(b: Float32Array, edge: "in" | "out", frames: number): void {
  const n = b.length / 2;
  const f = Math.max(1, Math.min(n, Math.round(frames)));
  for (let i = 0; i < f; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / f);
    const k = edge === "in" ? i : n - 1 - i;
    b[2 * k] *= g;
    b[2 * k + 1] *= g;
  }
}

/** Blocks waiting to go on, oldest first; `faded`: its end has been faded out already. */
export type Waiting = { b: Float32Array; faded: boolean }[];
const framesIn = (w: Waiting) => w.reduce((n, x) => n + x.b.length / 2, 0);

/**
 * Keep no more than `most` frames waiting: the oldest still waiting stays (it follows on from what
 * went before it), and what comes after it goes, oldest first, so the newest are kept. Where
 * something went the sound would jump from one moment to another, a click: the block before the
 * gap fades out and the one after it fades in (neither has gone on yet), a dip of a few
 * milliseconds instead. Returns the frames left out.
 */
export function keepNewest(w: Waiting, most: number, fade: number): number {
  let total = framesIn(w);
  // (one block alone goes whole, however long: what went before it is gone already, so a cut in it could not
  // fade both ways; the engine skips ahead over a backlog with fades of its own)
  if (total <= most || w.length < 2) return 0;
  let gone = 0;
  while (total > most && w.length > 2) {
    const n = w.splice(1, 1)[0].b.length / 2;
    total -= n;
    gone += n;
  }
  // (still too much: the start of the one after the oldest goes, so long as enough of it is left to fade in)
  const over = total - most;
  const second = w[1].b.length / 2;
  if (over > 0 && second - over > 2 * fade) {
    w[1] = { b: w[1].b.slice(2 * over), faded: w[1].faded };
    gone += over;
  }
  if (gone > 0) {
    if (!w[0].faded) fadeEdge(w[0].b, "out", fade);
    w[0].faded = true;
    fadeEdge(w[1].b, "in", fade);
  }
  return gone;
}

/**
 * On the audio thread: hands the blocks to the page, at most `most` messages at a time that the
 * page has not yet said it has (`ack`). A page held up handles one message at a time, with a
 * frame drawn in between, so one message per block would come in no faster than the page draws
 * (a busy page: a few a second) and the sound would fall further and further behind; instead,
 * while the page has not caught up, the blocks are kept and go together in one message when it
 * does, however long it took. No more than `keep` seconds are kept (see `keepNewest`), so a page
 * catching up never hands the engine more than its queue holds (see the engine's through.rs).
 */
export class Outbox {
  private waiting: Waiting = [];
  /** messages the page has not yet said it has */
  out = 0;
  /** frames left out, the page having been held up for longer than `keep` */
  dropped = 0;
  constructor(
    private readonly post: (b: Float32Array) => void,
    private readonly rate: number,
    readonly most = 2,
    readonly keep = 0.75,
  ) {}
  add(block: Float32Array) {
    if (this.out < this.most && !this.waiting.length) {
      this.out++;
      this.post(block);
      return;
    }
    this.waiting.push({ b: block, faded: false });
    this.dropped += keepNewest(this.waiting, this.keep * this.rate, JOIN_FADE * this.rate);
  }
  /** The page has a message. */
  ack() {
    this.out = Math.max(0, this.out - 1);
    if (!this.waiting.length || this.out >= this.most) return;
    const w = this.waiting;
    this.waiting = [];
    let b = w[0].b;
    if (w.length > 1) {
      b = new Float32Array(w.reduce((n, x) => n + x.b.length, 0));
      let at = 0;
      for (const x of w) {
        b.set(x.b, at);
        at += x.b.length;
      }
    }
    this.out++;
    this.post(b);
  }
}

/**
 * Sends the blocks to the engine one after another, in order. If the engine is slow to take
 * them, or a page held up hands over a lot at once, no more than `most` seconds wait (see
 * `keepNewest`: the engine skips ahead over a backlog anyway, and a gap fades rather than
 * jumps). It keeps how far behind the sound is (`delay`, seconds: what is queued in the engine),
 * and stops at the first block the engine will not take (it has closed), saying so once.
 */
export class Sender {
  private waiting: Waiting = [];
  private busy = false;
  private closed = false;
  /** seconds queued in the engine, lately */
  delay = 0;
  /** frames left out, being stale */
  dropped = 0;
  /** told how far behind the sound is, each time the engine says */
  onDelay: ((seconds: number) => void) | null = null;
  constructor(
    private readonly feed: (bytes: Uint8Array) => Promise<number>,
    private readonly rate: number,
    private readonly onFail: () => void,
    readonly most = 0.5,
  ) {}
  send(block: Float32Array) {
    if (this.closed) return;
    this.waiting.push({ b: block, faded: false });
    this.dropped += keepNewest(this.waiting, this.most * this.rate, JOIN_FADE * this.rate);
    if (!this.busy) void this.pump();
  }
  close() {
    this.closed = true;
    this.waiting = [];
  }
  private async pump() {
    this.busy = true;
    while (!this.closed && this.waiting.length) {
      const b = this.waiting.shift()!.b;
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
