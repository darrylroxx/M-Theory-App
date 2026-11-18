/**
 * A bank of ears on the audio thread: one on the whole mix, and one on each track (or group of
 * tracks) of the app's own song, all in a single audio node with many inputs.
 *
 * Each ear does its work once every hundredth of a second, all in one go (about half a
 * millisecond for an ear that follows tones). Ears started together would all do it in the same
 * 128-sample block of sound, and a handful of them could make that block late, which is heard
 * as a click in everything the app plays. So their turns are staggered across the hundredth of
 * a second (`phase`), and ears on tracks whose notes the app already knows exactly only listen
 * for level, brightness and noise (`light`), which costs about half as much.
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
    const n = inputs.length;
    this.keys = inputs.map((i) => i.key);
    // the turns spread evenly over the hundredth of a second
    this.ears = inputs.map((inp, i) => new Ear(sr, -54, { phase: i / n, light: inp.light }));
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
