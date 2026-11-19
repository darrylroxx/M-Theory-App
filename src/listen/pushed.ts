/**
 * Stems that are handed over as they are made: a trained model's, split on the user's own
 * computer by the desktop app's engine (`neuralstems.ts` on the stems branch). The engine writes
 * every stem to a file of its own and says, stretch by stretch, how far all of them are ready
 * from the start of the song; whoever reads those files hands each new stretch here (`push`),
 * and the painting asks for stems as it always does (`StemSource`). A stretch not made yet is
 * waited for.
 *
 * The engine's stems are stereo, at the rate the song was recorded at; the page may have decoded
 * the song at another rate (the rate of its sound output). Each stem is made mono (its two
 * channels as one) and brought to the song's rate here, so the ears that hear it need nothing
 * else.
 */
import type { StemChunk, StemName, StemSource, Stereo } from "./split";

/** A stem's stretch, as the engine makes it: its channels, at `rate`. */
export type StemStretch = Partial<Record<StemName, Float32Array[]>>;

export class PushedStems implements StemSource {
  readonly id: string;
  readonly approx: boolean;
  readonly stems: readonly StemName[];
  /** the stems' own rate */
  readonly rate: number;
  /** the song's rate and length (samples), once `prepare` has been told */
  private sr = 0;
  private length = 0;
  /** each stem, mono, at its own rate: what has been pushed and not yet given out (its first `used` frames, from frame `base`) */
  private held: Float32Array[] = [];
  private used = 0;
  private base = 0;
  /** frames of the stems pushed so far (all stems alike), counted from the start of the song */
  private pushed = 0;
  private ended = false;
  /** the next sample of the song to give */
  private at = 0;
  private wake: (() => void) | null = null;

  /** `stems`: the stems that will be pushed; `rate`: their rate; `approx`: true if they are a rough guess rather than a model's. */
  constructor(stems: readonly StemName[], rate: number, opts: { id?: string; approx?: boolean } = {}) {
    this.stems = [...stems];
    this.rate = rate;
    this.id = opts.id ?? "model";
    this.approx = opts.approx ?? false;
    this.held = this.stems.map(() => new Float32Array(0));
  }

  async prepare(song: Stereo): Promise<void> {
    this.sr = song.sr;
    this.length = song.left.length;
  }

  seek(from: number) {
    this.at = Math.max(0, Math.round(from));
    // (what is held from before there is not needed again)
    this.drop(Math.floor(this.frameOf(this.at)) - 1);
  }

  /**
   * Hand over the stems from frame `from` (at the stems' own rate) on: every stem, the same
   * number of frames. A stretch that overlaps what was already pushed has only its new part
   * taken; one that leaves a gap is not taken (the engine makes its stems in order).
   */
  push(from: number, stretch: StemStretch) {
    if (this.ended) return;
    const mono = this.stems.map((name) => {
      const ch = stretch[name];
      if (!ch || !ch.length) return null;
      const n = Math.min(...ch.map((c) => c.length));
      const out = new Float32Array(n);
      for (const c of ch) for (let i = 0; i < n; i++) out[i] += c[i] / ch.length;
      return out;
    });
    const n = Math.min(...mono.map((m) => (m ? m.length : Infinity)));
    if (!Number.isFinite(n) || from > this.pushed) return;
    const skip = this.pushed - from;
    if (skip >= n) return;
    const add = n - skip;
    // (room is made by doubling, so handing over a whole song a stretch at a time costs no more than once)
    if (this.used + add > (this.held[0]?.length ?? 0)) {
      const room = Math.max(this.used + add, 2 * (this.held[0]?.length ?? 0), 65536);
      this.held = this.held.map((h) => {
        const out = new Float32Array(room);
        out.set(h.subarray(0, this.used));
        return out;
      });
    }
    this.held.forEach((h, i) => {
      if (mono[i]) h.set(mono[i]!.subarray(skip, n), this.used);
      else h.fill(0, this.used, this.used + add);
    });
    this.used += add;
    this.pushed += add;
    this.poke();
  }

  /** Every stem is complete. */
  end() {
    this.ended = true;
    this.poke();
  }

  ready() {
    if (this.ended) return Infinity;
    return this.pushed / this.rate;
  }

  async next(max: number): Promise<StemChunk | null> {
    for (;;) {
      if (!this.sr || this.at >= this.length) return null;
      // how far the song can be given: up to the last sample whose neighbours in the stems are both there
      const can = this.ended ? this.length : Math.min(this.length, Math.floor(((this.pushed - 1) * this.sr) / this.rate));
      const end = Math.min(can, this.at + Math.max(1, Math.round(max)));
      if (end > this.at) return this.take(end);
      if (this.ended) return null;
      await new Promise<void>((r) => (this.wake = r));
    }
  }

  /** The song's samples from `at` up to `end`, every stem brought to the song's rate. */
  private take(end: number): StemChunk {
    const n = end - this.at;
    const stems: Partial<Record<StemName, Float32Array>> = {};
    this.stems.forEach((name, k) => {
      const h = this.held[k];
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        // where this sample of the song falls among the stem's frames: in between two of them, a straight line
        const f = this.frameOf(this.at + i) - this.base;
        const j = Math.floor(f);
        const a = j >= 0 && j < this.used ? h[j] : 0;
        const b = j + 1 >= 0 && j + 1 < this.used ? h[j + 1] : a;
        out[i] = a + (b - a) * (f - j);
      }
      stems[name] = out;
    });
    const chunk = { from: this.at, length: n, stems };
    this.at = end;
    this.drop(Math.floor(this.frameOf(this.at)) - 1);
    return chunk;
  }

  /** The stems' frame (fractional) that a sample of the song falls on. */
  private frameOf(sample: number) {
    return this.sr ? (sample * this.rate) / this.sr : 0;
  }

  /** Let go of the frames held from before frame `upTo` (once they are a good part of what is held). */
  private drop(upTo: number) {
    const k = Math.min(upTo - this.base, this.used);
    if (k <= Math.max(32768, this.used / 2)) return;
    for (const h of this.held) h.copyWithin(0, k, this.used);
    this.used -= k;
    this.base += k;
  }

  private poke() {
    const w = this.wake;
    this.wake = null;
    w?.();
  }
}
