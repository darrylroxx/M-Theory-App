/**
 * Which frequencies the mix has lately covered, for the guide at the edge of the canvas: read
 * off the three taps on the mixer (chords, melody, drums), averaged over a few seconds.
 */
import { BANDS, bandHz } from "../audio/describe";

export type StemId = "chords" | "melody" | "drums";
export const STEM_IDS: StemId[] = ["chords", "melody", "drums"];
/** How long the measured levels are averaged over (seconds). */
const COVER_SECONDS = 6;
/**
 * Music has less in it the higher up it goes: about 4.5 dB less for every octave. Analysers tilt
 * what they show by that much, so that a balanced mix looks level and a gap looks like a gap. The
 * bands here are a fixed part of an octave wide, which makes up 3 dB of it; this is the rest
 * (in dB, for a band; nothing at 1 kHz).
 */
export const tilt = (band: number) => 1.5 * Math.log2(bandHz(band) / 1000);
const clamp = (x: number) => Math.max(0, Math.min(1, x));

export class Cover {
  private cover: Record<StemId, Float32Array> = { chords: new Float32Array(BANDS), melody: new Float32Array(BANDS), drums: new Float32Array(BANDS) };

  /** What each part of the mix is sounding right now (power in every band); `dt` in milliseconds. */
  mix(levels: Partial<Record<StemId, Float32Array>>, dt: number) {
    const k = 1 - Math.exp(-Math.max(0, dt) / 1000 / COVER_SECONDS);
    for (const s of STEM_IDS) {
      const now = levels[s];
      const c = this.cover[s];
      for (let b = 0; b < BANDS; b++) c[b] += ((now ? now[b] || 0 : 0) - c[b]) * k;
    }
  }

  /**
   * For every band (lowest first): how strong the whole mix is there, from 0 (nothing: 54 dB
   * under its strongest band) to 1, and how much of that is the chords', the melody's and the
   * drums' (three shares that add up to 1).
   */
  coverage(): { level: Float32Array; share: Record<StemId, Float32Array> } {
    const total = new Float32Array(BANDS);
    let top = 1e-12;
    for (let b = 0; b < BANDS; b++) {
      for (const s of STEM_IDS) total[b] += this.cover[s][b];
      // (tilted first, so the strongest band is the strongest as it is shown)
      total[b] *= Math.pow(10, tilt(b) / 10);
      top = Math.max(top, total[b]);
    }
    const level = new Float32Array(BANDS);
    const share = { chords: new Float32Array(BANDS), melody: new Float32Array(BANDS), drums: new Float32Array(BANDS) };
    for (let b = 0; b < BANDS; b++) {
      level[b] = clamp(1 + (10 * Math.log10(total[b] / top + 1e-12)) / 54);
      let sum = 0;
      for (const s of STEM_IDS) sum += this.cover[s][b];
      if (sum > 0) for (const s of STEM_IDS) share[s][b] = this.cover[s][b] / sum;
    }
    return { level, share };
  }
}
