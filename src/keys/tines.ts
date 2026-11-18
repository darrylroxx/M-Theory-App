/**
 * The electric piano's arithmetic, ported from mda ePiano by Paul Kellett (MIT; see NOTICE.md):
 * which recording a key plays, how fast it fades while held and once let go, how loud each
 * velocity is, where each key sits between the speakers, the treble control and the
 * tremolo / autopan. Nothing here touches Web Audio, so the tests can check it in node.
 *
 * The sound is a tine piano's: 11 recordings across the keys (C and G of each octave from C2), each
 * at three strengths, every one a short attack followed by a loop of its steady tone. The
 * instrument makes the rest: the tone fades as a struck tine does, faster the higher the key, and
 * stops quickly when the damper falls.
 *
 * mda's own names for the knobs are kept in the comments (Envelope Decay, Hardness, Modulation...).
 */

/** The recordings' own sample rate. */
export const TINE_RATE = 32000;

export interface KeyGroup {
  /** The key it was recorded on. */
  root: number;
  /** The highest key it plays (before Hardness moves the split points). */
  high: number;
  /** Where it starts and ends in the sample table, and how long its loop is (samples). */
  pos: number;
  end: number;
  loop: number;
}

/**
 * The 33 recordings: three strengths (soft, medium, hard) for each of the 11 keys. Copied from
 * mda ePiano; groups 28 and 31 repeat 27 and 30 (the top keys have only two strengths).
 */
const R = [36, 43, 48, 55, 60, 67, 72, 79, 84, 91, 96];
const H = [39, 45, 51, 57, 63, 69, 75, 81, 87, 93, 999];
const SPAN: [number, number, number][] = [
  [0, 8476, 4400], [8477, 16248, 4903], [16249, 34565, 6398],
  [34566, 41384, 3938], [41385, 45760, 1633], [45761, 65211, 5245],
  [65212, 72897, 2937], [72898, 78626, 2203], [78627, 100387, 6368],
  [100388, 116297, 10452], [116298, 127661, 5217], [127662, 144113, 3099],
  [144114, 152863, 4284], [152864, 173107, 3916], [173108, 192734, 2937],
  [192735, 204598, 4732], [204599, 218995, 4733], [218996, 233801, 2285],
  [233802, 248011, 4098], [248012, 265287, 4099], [265288, 282255, 3609],
  [282256, 293776, 2446], [293777, 312566, 6278], [312567, 330200, 2283],
  [330201, 348889, 2689], [348890, 365675, 4370], [365676, 383661, 5225],
  [383662, 393372, 2811], [383662, 393372, 2811], [393373, 406045, 4522],
  [406046, 414486, 2306], [406046, 414486, 2306], [414487, 422408, 2169],
];
export const KEY_GROUPS: KeyGroup[] = SPAN.map(([pos, end, loop], k) => ({
  root: R[Math.floor(k / 3)],
  high: H[Math.floor(k / 3)],
  pos,
  end,
  loop,
}));
/** Samples in the table (mda's WAVELEN; the file has a few more at the end). */
export const TABLE_LENGTH = 422414;

/** The knobs, each 0..1, as in mda ePiano. */
export interface TineParams {
  /** How long a held note rings (Envelope Decay). */
  decay: number;
  /** How long a note rings on once let go (Envelope Release). */
  release: number;
  /** Which recordings play: higher plays each key from a lower recording, brighter and harder (Hardness). */
  hardness: number;
  /** Treble: below the middle it darkens, above it lifts the top (Treble Boost). */
  treble: number;
  /** Below the middle autopan, above it tremolo; the further from the middle, the deeper (Modulation). */
  mod: number;
  /** Speed of the tremolo or autopan (LFO Rate). */
  rate: number;
  /** How much velocity changes the level (Velocity Sensitivity). */
  touch: number;
  /** How far low and high keys sit apart in the stereo field (Stereo Width). */
  width: number;
}

/** mda ePiano's defaults (its first program). */
export const TINE_DEFAULT: TineParams = { decay: 0.5, release: 0.5, hardness: 0.5, treble: 0.5, mod: 0.5, rate: 0.65, touch: 0.25, width: 0.5 };

/** mda's five programs, without the overdrive (the track's effects have saturation). */
export const TINE_PRESETS: { id: string; name: string; params: TineParams }[] = [
  { id: "classic", name: "Classic", params: TINE_DEFAULT },
  { id: "bright", name: "Bright", params: { ...TINE_DEFAULT, hardness: 1, treble: 0.8 } },
  { id: "mellow", name: "Mellow", params: { ...TINE_DEFAULT, hardness: 0, treble: 0 } },
  { id: "autopan", name: "Autopan", params: { ...TINE_DEFAULT, mod: 0.25, touch: 0.25 } },
  { id: "tremolo", name: "Tremolo", params: { ...TINE_DEFAULT, mod: 0.75, touch: 0.25 } },
];

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Every knob in range, missing ones at their defaults. */
export function tineParams(p: Partial<TineParams> = {}): TineParams {
  const out = { ...TINE_DEFAULT };
  for (const k of Object.keys(TINE_DEFAULT) as (keyof TineParams)[]) {
    const v = p[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = clamp(v, 0, 1);
  }
  return out;
}

/** Velocity 0..1 as the MIDI velocity mda works in (1..127). */
export const midiVelocity = (v: number) => clamp(Math.round(v * 127), 1, 127);

/** How far Hardness moves the split points, in semitones (C's truncation, as in mda). */
export const hardnessShift = (hardness: number) => Math.trunc(12 * hardness - 6);

/** The recording a key plays at a velocity (index into KEY_GROUPS). */
export function groupOf(note: number, velocity: number, hardness = TINE_DEFAULT.hardness): number {
  const s = hardnessShift(hardness);
  const vel = midiVelocity(velocity);
  let k = 0;
  while (note > KEY_GROUPS[k].high + s) k += 3;
  if (vel > 48) k++;
  if (vel > 80) k++;
  return k;
}

/**
 * How far a recording is from equal temperament, in cents. Its loop holds a whole number of cycles,
 * so the steady tone's pitch is exactly cycles × rate / loop length. Most are within 3 cents; a few
 * of the bass recordings are up to 10 cents flat, which mda leaves as they are.
 */
export function loopCents(group: number): number {
  const g = KEY_GROUPS[group];
  const et = 440 * 2 ** ((g.root - 69) / 12);
  const cycles = Math.round((g.loop * et) / TINE_RATE);
  return 1200 * Math.log2((cycles * TINE_RATE) / g.loop / et);
}

/** The playback rate that turns a group's recording into this key, in tune (the table's own rate is TINE_RATE). */
export const rateOf = (note: number, group: number) => 2 ** ((note - KEY_GROUPS[group].root) / 12 - loopCents(group) / 1200);

/** Velocity sensitivity as mda computes it from the knob. */
export function velSens(touch: number): number {
  let s = 1 + touch + touch;
  if (touch < 0.25) s -= 0.75 - 3 * touch;
  return s;
}

/** A note's starting level (mda's env: velocity curve, high notes a little quieter). */
export function levelOf(note: number, velocity: number, touch = TINE_DEFAULT.touch): number {
  const s = velSens(touch);
  let env = (3 + 2 * s) * (0.0078 * midiVelocity(velocity)) ** s;
  if (note > 60) env *= Math.exp(0.01 * (60 - note));
  return env;
}

/** Time constant (seconds) of a held note's fade: mda multiplies by exp(-rate / Fs) every sample. */
export function decayTau(note: number, decay = TINE_DEFAULT.decay): number {
  const n = clamp(note, 44, 108); // mda: "limit max decay length"
  return 1 / Math.exp(-1 + 0.03 * n - 2 * decay);
}

/** Time constant (seconds) of the fade once the damper falls. */
export const releaseTau = (note: number, release = TINE_DEFAULT.release) => 1 / Math.exp(6 + 0.01 * note - 5 * release);

/** mda drops a voice once its envelope is below this. */
export const SILENCE = 0.0001;

/** Seconds a held note takes to fade to silence. */
export const ringSeconds = (note: number, velocity: number, p: TineParams = TINE_DEFAULT) =>
  decayTau(note, p.decay) * Math.log(Math.max(1, levelOf(note, velocity, p.touch) / SILENCE));

/**
 * Where a key sits between the speakers. mda sends a key to the left at (1 - d) and to the right
 * at (1 + d), d growing with the distance from middle C. A StereoPannerNode with mono input sends
 * cos and sin of the same angle, so the same ratio needs this pan, and this gain to keep each
 * side's level.
 */
export function panOf(note: number, width = TINE_DEFAULT.width): { pan: number; gain: number } {
  const d = 0.03 * width * (clamp(note, 12, 108) - 60);
  const x = (2 / Math.PI) * Math.atan2(1 + d, 1 - d);
  return { pan: 2 * x - 1, gain: (1 - d) / Math.cos((x * Math.PI) / 2) };
}

/**
 * The treble control: mda adds `treb` times the signal minus a one-pole lowpass of it, a shelf
 * from about 800 Hz (knob at or below the middle) or 2.2 kHz (above). Returned as the gain on the
 * dry signal and on each of the two lowpasses, which the instrument mixes.
 */
export function trebleMix(treble: number): { dry: number; low: number; high: number } {
  const treb = 4 * treble * treble - 1;
  return { dry: 1 + treb, low: treble > 0.5 ? 0 : -treb, high: treble > 0.5 ? -treb : 0 };
}

/** The two lowpass corners (mda's `tfrq`, in radians per second). */
export const TREBLE_W = { low: 5000, high: 14000 };

/** One-pole lowpass y += a (x - y) as IIR coefficients at a sample rate. */
export function onePole(w: number, sampleRate: number): { feedforward: number[]; feedback: number[] } {
  const a = 1 - Math.exp(-w / sampleRate);
  return { feedforward: [a], feedback: [1, -(1 - a)] };
}

/** The tremolo / autopan: LFO speed in Hz and depth on each side (negative = opposite phase). */
export function lfoOf(p: TineParams): { hz: number; left: number; right: number } {
  const depth = p.mod + p.mod - 1;
  return { hz: Math.exp(6.22 * p.rate - 2.61), left: depth, right: p.mod < 0.5 ? -depth : depth };
}

/**
 * Prepare the sample table as mda does when it starts: the end of each loop is crossfaded (over 50
 * samples) into the part before the loop starts, so the loop joins without a click. Works on a
 * copy of the 16-bit table and returns it as floats (-1..1).
 */
export function prepareTable(raw: Int16Array): Float32Array {
  const w = Int16Array.from(raw);
  for (let k = 0; k < 28; k++) {
    let p0 = KEY_GROUPS[k].end;
    let p1 = KEY_GROUPS[k].end - KEY_GROUPS[k].loop;
    // the same arithmetic as mda (32-bit floats, truncation to 16 bits)
    let xf = 1;
    const dxf = Math.fround(-0.02);
    while (xf > 0) {
      w[p0] = Math.trunc(Math.fround(Math.fround(Math.fround(1 - xf) * w[p0]) + Math.fround(xf * w[p1])));
      p0--;
      p1--;
      xf = Math.fround(xf + dxf);
    }
  }
  const out = new Float32Array(w.length);
  for (let i = 0; i < w.length; i++) out[i] = w[i] / 32768;
  return out;
}

/** One group's recording cut out of the table, with its loop points in seconds (for an AudioBufferSourceNode). */
export function groupSlice(table: Float32Array, group: number): { data: Float32Array; loopStart: number; loopEnd: number } {
  const g = KEY_GROUPS[group];
  // mda plays positions pos .. end-1 and jumps back by `loop` at `end`; sample `end` is kept for the interpolation.
  const data = table.slice(g.pos, g.end + 1);
  return { data, loopStart: (g.end - g.loop - g.pos) / TINE_RATE, loopEnd: (g.end - g.pos) / TINE_RATE };
}
