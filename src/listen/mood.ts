/**
 * The mood of what is being heard, taken over the last several seconds: how much energy it has,
 * how held or how clipped its notes are, how bright it is, and which key it seems to be in.
 * The painting takes its manner from these (wet and slow, or dry and quick), never its marks:
 * those come from the sounds themselves.
 */
import type { Frame } from "./ear";

/** How well each of the twelve notes fits a major and a minor key (Krumhansl and Kessler's listening tests). */
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
/** The notes of a major and of a natural minor scale, as steps above the key note. */
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

function fit(chroma: ArrayLike<number>, profile: number[], tonic: number): number {
  let mc = 0;
  let mp = 0;
  for (let i = 0; i < 12; i++) {
    mc += chroma[i] / 12;
    mp += profile[i] / 12;
  }
  let num = 0;
  let dc = 0;
  let dp = 0;
  for (let i = 0; i < 12; i++) {
    const c = chroma[(i + tonic) % 12] - mc;
    const p = profile[i] - mp;
    num += c * p;
    dc += c * c;
    dp += p * p;
  }
  return dc > 0 ? num / Math.sqrt(dc * dp) : 0;
}

/** The key that twelve note-strengths point to: its key note (0 = C), whether it is major, and how sure (0..1). */
export function keyOf(chroma: ArrayLike<number>): { tonic: number; major: boolean; sure: number } {
  let best = { tonic: 0, major: true, sure: -2 };
  let second = -2;
  for (let t = 0; t < 12; t++) {
    for (const major of [true, false]) {
      const f = fit(chroma, major ? MAJOR : MINOR, t);
      if (f > best.sure) {
        second = best.sure;
        best = { tonic: t, major, sure: f };
      } else if (f > second) second = f;
    }
  }
  return { ...best, sure: Math.max(0, Math.min(1, best.sure)) * Math.max(0, Math.min(1, (best.sure - second) * 6 + 0.3)) };
}

export interface Feeling {
  /** 0 = still and quiet … 1 = loud, busy and bright */
  energy: number;
  /** 0 = every note clipped short … 1 = everything held */
  held: number;
  /** 0 = dull … 1 = bright */
  bright: number;
  /** 0 = all tone … 1 = all noise */
  rough: number;
  /** hits a second */
  pace: number;
  tonic: number;
  major: boolean;
  /** how sure the key is, 0..1 */
  sure: number;
}

export class Mood {
  private level = 0;
  private held = 0.5;
  private bright = 0.4;
  private rough = 0.2;
  private pace = 0;
  private chroma = new Float32Array(12);
  private heard = 0;
  private last = -1;

  reset() {
    this.level = 0;
    this.held = 0.5;
    this.bright = 0.4;
    this.rough = 0.2;
    this.pace = 0;
    this.chroma.fill(0);
    this.heard = 0;
    this.last = -1;
  }

  take(f: Frame) {
    const dt = this.last < 0 ? 0.01 : Math.max(0.001, Math.min(0.1, f.t - this.last));
    this.last = f.t;
    // about six seconds of memory for the manner, half a minute for the key
    const k = 1 - Math.exp(-dt / 6);
    this.level += (f.level - this.level) * k;
    this.pace += (f.hits.length / dt - this.pace) * k;
    if (f.level > 0.08) {
      // how much of what is sounding has been sounding for a quarter of a second or more
      let all = 0;
      let long = 0;
      for (const v of f.voices) {
        all += v.amp;
        if (v.age > 0.25) long += v.amp;
      }
      if (all > 0) this.held += (long / all - this.held) * k;
      if (f.centroid > 0) this.bright += (Math.max(0, Math.min(1, Math.log2(f.centroid / 400) / 3.5)) - this.bright) * k;
      this.rough += (Math.min(1, f.flat * 2.5) - this.rough) * k;
      const kc = 1 - Math.exp(-dt / 30);
      for (let i = 0; i < 12; i++) this.chroma[i] += (f.chroma[i] - this.chroma[i]) * kc;
      this.heard += dt;
    }
  }

  get feeling(): Feeling {
    const key = this.heard > 3 ? keyOf(this.chroma) : { tonic: 0, major: true, sure: 0 };
    const pace = Math.min(1, this.pace / 8);
    return {
      energy: Math.max(0, Math.min(1, 0.45 * this.level + 0.3 * pace + 0.25 * this.bright)),
      held: this.held,
      bright: this.bright,
      rough: this.rough,
      pace: this.pace,
      ...key,
    };
  }
}
