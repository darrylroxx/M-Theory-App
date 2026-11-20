/**
 * Saturation: the colour analogue gear adds when it is pushed. Shared by the drums and the harp.
 *
 * Each colour is a bend in the signal (which overtones appear, and how suddenly) plus the tone
 * shaping that the real machine does around the bend:
 *
 *   tape     the magnetisation curve of tape: very gradual, odd overtones. Treble is boosted going
 *            in and cut coming out, so highs saturate first and are smoothed, and the lows gain a
 *            little weight (the "head bump").
 *   tube     a valve biased off-centre: one half of the wave rounds off sooner. That makes the
 *            second overtone, an octave above the note, which is why it reads as warmth.
 *   console  a mixing desk's transformers: iron saturates on low notes first, so kicks and bass
 *            thicken while the top stays clean.
 *   crunch   an overdrive pedal: the bass is passed round the clip, so the mids bark and the
 *            low end stays tight.
 *   fuzz     hard, lopsided clipping: square, buzzing, loud.
 *   clip     nothing at all until the peaks, which are shaved off: louder and punchier, not dirtier.
 *
 *   in ─┬─ straight ────────────────────────────────────────────────┐
 *       ├─ lows (crunch and fuzz only) ─────────────────────────────┤
 *       └─ (minus those lows) ─ shape in ─ bend ─ shape out ─ top ──┴─ out
 *
 * The bend runs four times oversampled, which in a browser delays it by a few milliseconds. The
 * other two paths go through the same (unbent) stage, so all three stay exactly in step. With the
 * knob at zero only the straight path runs (it is what sets the timing, so it always does): the
 * bend and the lows round it are not fed, and cost nothing.
 */
import { gate } from "./gate";

export type SatType = "tape" | "tube" | "console" | "crunch" | "fuzz" | "clip";
export const SAT_TYPES: { id: SatType; name: string; hint: string }[] = [
  { id: "tape", name: "Tape", hint: "Soft and thick: rounds the peaks, smooths the top, adds weight below" },
  { id: "tube", name: "Tube", hint: "A valve pushed gently: warm, with an octave of sweetness above each note" },
  { id: "console", name: "Console", hint: "A mixing desk's transformers: fat lows, a clean top" },
  { id: "crunch", name: "Crunch", hint: "An overdrive pedal: barking mids, the low end kept tight" },
  { id: "fuzz", name: "Fuzz", hint: "Hard clipping: square, buzzing, blown-out" },
  { id: "clip", name: "Clip", hint: "Shaves only the peaks: louder and punchier, not dirtier" },
];
export const isSatType = (v: unknown): v is SatType => SAT_TYPES.some((t) => t.id === v);

/**
 * Where on its bend each colour sits: how far up a typical peak reaches with the knob at zero,
 * and how many dB the knob adds by the top. Set so the overtones grow the way the real thing's do:
 * about 1% at a quarter (colour you feel more than hear), 5% at half, well into distortion at full.
 */
const DRIVE: Record<SatType, [number, number]> = { tape: [0.12, 26], tube: [0.04, 36], console: [0.2, 16], crunch: [0.22, 30], fuzz: [0.45, 34], clip: [0.5, 16] };
/** The size (peak) of a typical sound, in the units the curves are drawn in. */
export const SAT_REF = 0.25;

const langevin = (z: number) => (Math.abs(z) < 1e-4 ? z / 3 : 1 / Math.tanh(z) - 1 / z);
/** A clip with a knee: the higher `p`, the sharper the corner. */
const knee = (u: number, p: number) => u / Math.pow(1 + Math.pow(Math.abs(u), p), 1 / p);

/** The bend of each colour, for a signal already multiplied by the drive. Slope 1 through the middle. */
export function bend(type: SatType, u: number): number {
  switch (type) {
    case "tape": {
      // tape magnetises along a Langevin curve; a trace of bias makes it very slightly lopsided
      const b = 0.04;
      return (langevin(3 * (u + b)) - langevin(3 * b)) / (1 - 3 * b * b * 0.6);
    }
    case "tube": {
      const b = 0.42;
      const s = 1 - Math.tanh(b) * Math.tanh(b);
      return (Math.tanh(u + b) - Math.tanh(b)) / s;
    }
    case "console":
      // iron: a pure cubic, so the first thing to appear is the third overtone alone
      return Math.abs(u) < 1 ? u - (u * u * u) / 3 : Math.sign(u) * (2 / 3);
    case "crunch":
      return knee(u, 2.5);
    case "fuzz":
      // the top is shaved sooner than the bottom, as a starved transistor does it
      return u >= 0 ? 0.8 * knee(u / 0.8, 7) : knee(u, 5);
    case "clip": {
      const t = 0.72;
      const a = Math.abs(u);
      return a <= t ? u : Math.sign(u) * (t + (1 - t) * Math.tanh((a - t) / (1 - t)));
    }
  }
}

/**
 * The curve handed to the wave shaper, for a signal whose usual peaks are near SAT_REF.
 * A sound of that size comes out as loud as it went in: quiet sounds are lifted, loud ones flattened.
 */
export function satCurve(type: SatType, amount: number, size = 4097): Float32Array<ArrayBuffer> {
  const a = Math.min(1, Math.max(0, amount));
  const [rest, db] = DRIVE[type];
  // how far up the bend a peak of the usual size reaches
  const reach = (rest * Math.pow(10, (db * a) / 20)) / SAT_REF;
  const f = (x: number) => bend(type, x * reach) / reach;
  const ref = (f(SAT_REF) - f(-SAT_REF)) / (2 * SAT_REF);
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) curve[i] = f((i / (size - 1)) * 2 - 1) / ref;
  return curve;
}

interface Tone {
  /** the bass below this (Hz) goes round the bend untouched (0 = the bend gets everything) */
  split: number;
  /** boosted going in and cut coming out, at full amount: [shelf Hz, dB in, dB out] for the lows and the highs */
  low: [number, number, number];
  high: [number, number, number];
  /** where the top is rolled off after the bend, at zero and at full */
  lp: [number, number];
}

const TONE: Record<SatType, Tone> = {
  tape: { split: 0, low: [100, 0, 1.5], high: [3500, 5, -7], lp: [20000, 10500] },
  tube: { split: 0, low: [120, 0, 0], high: [1800, 3, -4], lp: [18000, 8500] },
  console: { split: 0, low: [150, 8, -7], high: [6000, 0, 0], lp: [20000, 15000] },
  crunch: { split: 320, low: [120, 0, 0], high: [2500, 0, 0], lp: [16000, 3800] },
  fuzz: { split: 160, low: [120, 0, 0], high: [2500, 0, 0], lp: [14000, 3200] },
  clip: { split: 0, low: [120, 0, 0], high: [6000, 0, 0], lp: [20000, 18000] },
};
/** With chords, the bass goes round every colour: at least this low (Hz). */
const CHORD_SPLIT: Record<SatType, number> = { tape: 140, tube: 200, console: 110, crunch: 320, fuzz: 260, clip: 140 };

/** How long the colour takes to glide out (τ 30 ms) before the bend stops being fed (seconds). */
const BEND_SETTLE = 0.35;

/** A straight line for the paths that are not bent: the same stage, so the same delay. */
const straight = new Float32Array([-1, 0, 1]);

export interface Saturator {
  input: GainNode;
  output: GainNode;
  /** `amount` and `mix` 0…1; `trimDb` is added to the output to keep the loudness where it was. */
  set(type: SatType, amount: number, mix: number, trimDb?: number): void;
}

/**
 * Build a saturator. `ref` is the usual peak of what will be sent in.
 * With `chords`, every colour passes the lowest notes round the bend: several notes at once
 * turn to mud when their bass is distorted together.
 */
export function createSaturator(c: BaseAudioContext, ref: number, chords = false): Saturator {
  const gain = (v = 1) => {
    const g = c.createGain();
    g.gain.value = v;
    return g;
  };
  const filter = (type: BiquadFilterType, freq: number, q = 0.707) => {
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  };
  const shaper = (curve: Float32Array<ArrayBuffer>) => {
    const w = c.createWaveShaper();
    w.oversample = "4x";
    w.curve = curve;
    return w;
  };
  const input = gain();
  const output = gain();
  // everything is brought to the size the curves are drawn for, and put back afterwards
  const down = gain(SAT_REF / ref);
  const up = gain(ref / SAT_REF);
  input.connect(down);
  up.connect(output);

  // the straight path (a quarter size, so even the loudest peaks pass the unbent stage untouched)
  const dry = gain(1);
  down.connect(gain(0.25)).connect(shaper(straight)).connect(gain(4)).connect(dry).connect(up);
  // the lows that go round the bend
  const aroundLp = filter("lowpass", 200, 0.5);
  const around = gain(0);
  aroundLp.connect(gain(0.25)).connect(shaper(straight)).connect(gain(4)).connect(around).connect(up);
  // the bend gets everything, minus those lows: the two halves add back up to exactly the original
  const bendIn = gain();
  const minus = gain(0);
  aroundLp.connect(minus).connect(bendIn);
  // with the knob at zero, the bend and the lows round it add nothing: they are not fed at all
  // (see gate.ts), and the straight path, which sets the timing, runs on alone
  const feed = gate(c, [[down, bendIn], [down, aroundLp]], BEND_SETTLE);
  const lowIn = filter("lowshelf", 120);
  const highIn = filter("highshelf", 3000);
  const bender = shaper(satCurve("tape", 0));
  const dc = filter("highpass", 8, 0.5);
  const lowOut = filter("lowshelf", 120);
  const highOut = filter("highshelf", 3000);
  const lp = filter("lowpass", 20000, 0.6);
  const wet = gain(0);
  bendIn.connect(lowIn).connect(highIn).connect(bender).connect(dc).connect(lowOut).connect(highOut).connect(lp).connect(wet).connect(up);

  let was: { type?: SatType; amount?: number; mix?: number; trimDb?: number } = {};
  const to = (p: AudioParam, v: number) => (was.type === undefined ? (p.value = v) : p.setTargetAtTime(v, c.currentTime, 0.03));

  return {
    input,
    output,
    set(type, amount, mix, trimDb = 0) {
      const a = Math.min(1, Math.max(0, amount));
      if (type === was.type && a === was.amount && mix === was.mix && trimDb === was.trimDb) return;
      const t = TONE[type];
      const split = chords ? CHORD_SPLIT[type] : t.split;
      if (type !== was.type || a !== was.amount) {
        bender.curve = satCurve(type, a);
        if (split) to(aroundLp.frequency, split);
        to(minus.gain, split ? -1 : 0);
        to(lowIn.frequency, t.low[0]);
        to(lowOut.frequency, t.low[0]);
        to(highIn.frequency, t.high[0]);
        to(highOut.frequency, t.high[0]);
        to(lowIn.gain, t.low[1] * a);
        to(lowOut.gain, t.low[2] * a);
        to(highIn.gain, t.high[1] * a);
        to(highOut.gain, t.high[2] * a);
        to(lp.frequency, t.lp[0] * Math.pow(t.lp[1] / t.lp[0], a));
      }
      // the first eighth of the knob fades the colour in; from there on it only deepens
      const w = Math.min(1, Math.max(0, mix)) * Math.min(1, a * 8);
      // fed before its level glides up from nothing; let go once it has glided down to it
      if (w > 0) feed.on();
      else feed.off();
      const trim = Math.pow(10, trimDb / 20);
      to(wet.gain, w * trim);
      to(around.gain, split ? w * trim : 0);
      to(dry.gain, 1 - w);
      was = { type, amount: a, mix, trimDb };
    },
  };
}
