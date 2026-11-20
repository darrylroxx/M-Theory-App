/**
 * A bank of ears on the audio thread: one on the whole mix, and one on each track (or group of
 * tracks) of the app's own song, all in a single audio node with many inputs.
 *
 * Each ear does its work once every hundredth of a second, all in one go (about half a
 * millisecond for an ear that follows tones). Ears started together would all do it in the same
 * 128-sample block of sound, and a handful of them could make that block late, which is heard
 * as a click in everything the app plays. So their turns are staggered (`turns`), and ears on
 * tracks whose notes the app already knows exactly only listen for level, brightness and noise
 * (`light`), which costs about half as much, and only every other hundredth. With the mix and
 * seven tracks whose notes are known, the bank takes about a tenth of the audio thread's time
 * (measured in this container: 0.3 ms of each 2.7 ms block at 48 kHz, 0.9 ms at the worst
 * hundredth of blocks).
 *
 * Every ear on a track reads its levels against the loudness of the whole mix, so a quiet track
 * of a loud song is painted quietly.
 */
import { Ear, type Frame } from "./ear";

export interface BankInput {
  key: string;
  /** levels, brightness, hits and noise only (the notes are known otherwise) */
  light: boolean;
}

/** What one ear heard in one block. */
export interface BankOut {
  key: string;
  frames: Frame[];
}

export class EarBank {
  readonly ears: Ear[];
  readonly keys: string[];
  private mono = new Float32Array(128);

  /** `inputs`: the whole mix first, then the tracks. */
  constructor(sr: number, inputs: BankInput[]) {
    this.keys = inputs.map((i) => i.key);
    // an ear that only gives a track's texture (its notes are known) takes its turn every other hundredth of a second:
    // its texture changes no faster than that, and the audio thread has more room
    const phases = turns(inputs.map((i) => (i.light ? 2 : 1)));
    this.ears = inputs.map((inp, i) => new Ear(sr, -54, { phase: phases[i], light: inp.light, every: inp.light ? 2 : 1 }));
  }

  /**
   * One block of sound for every input (each a list of channels; an input with nothing connected
   * hears silence). `t0`: the audio clock at the start of the stream. Frames come back for the
   * ears that finished one.
   */
  process(inputs: Float32Array[][], t0: number): BankOut[] {
    const out: BankOut[] = [];
    const mixRef = this.ears[0]?.loudest ?? -54;
    for (let i = 0; i < this.ears.length; i++) {
      const input = inputs[i];
      const n = input && input[0] ? input[0].length : 128;
      if (this.mono.length !== n) this.mono = new Float32Array(n);
      const mono = this.mono;
      if (!input || input.length === 0) mono.fill(0);
      else if (input.length === 1) mono.set(input[0]);
      else {
        const k = 1 / input.length;
        for (let j = 0; j < n; j++) {
          let s = 0;
          for (let c = 0; c < input.length; c++) s += input[c][j];
          mono[j] = s * k;
        }
      }
      const ear = this.ears[i];
      if (i > 0) ear.hold(mixRef);
      const frames = ear.push(mono);
      if (frames.length) {
        for (const f of frames) f.t += t0;
        out.push({ key: this.keys[i], frames });
      }
    }
    return out;
  }
}

/**
 * Where in its turn each ear does its work (0..1 of its own turn), for ears that take a turn
 * every `every[i]` hundredths of a second: spread over two hundredths so that no two do their work
 * close together. The ears that hear every hundredth are spread evenly first; then each of the
 * others goes where it is furthest from all the work already placed.
 */
export function turns(every: number[]): number[] {
  const CYCLE = 200;
  const taken: number[] = [];
  const out = new Array<number>(every.length).fill(0);
  const fast = every.map((e, i) => (e === 1 ? i : -1)).filter((i) => i >= 0);
  fast.forEach((i, k) => {
    const at = Math.round((k * CYCLE) / 2 / fast.length);
    out[i] = (at / (CYCLE / 2)) % 1;
    taken.push(at, at + CYCLE / 2);
  });
  every.forEach((e, i) => {
    if (e === 1) return;
    let best = 0;
    let far = -1;
    for (let c = 0; c < CYCLE; c++) {
      let near = CYCLE;
      for (const t of taken) near = Math.min(near, Math.abs(c - t), CYCLE - Math.abs(c - t));
      if (near > far) {
        far = near;
        best = c;
      }
    }
    taken.push(best);
    out[i] = best / CYCLE;
  });
  return out;
}
