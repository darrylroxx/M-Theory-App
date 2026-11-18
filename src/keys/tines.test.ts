import { describe, expect, it } from "vitest";
import {
  KEY_GROUPS,
  TABLE_LENGTH,
  TINE_DEFAULT,
  TINE_PRESETS,
  TINE_RATE,
  decayTau,
  groupOf,
  groupSlice,
  hardnessShift,
  levelOf,
  lfoOf,
  loopCents,
  onePole,
  panOf,
  prepareTable,
  rateOf,
  releaseTau,
  ringSeconds,
  tineParams,
  trebleMix,
} from "./tines";

const cents = (ratio: number) => 1200 * Math.log2(ratio);

describe("the electric piano's recordings", () => {
  it("lays out 33 recordings that tile the table, three strengths per key group", () => {
    expect(KEY_GROUPS.length).toBe(33);
    for (let k = 0; k < 33; k++) {
      const g = KEY_GROUPS[k];
      expect(g.end).toBeGreaterThan(g.pos);
      expect(g.loop).toBeGreaterThan(0);
      expect(g.end - g.loop).toBeGreaterThan(g.pos); // the loop lies inside the recording
      expect(g.end).toBeLessThan(TABLE_LENGTH);
      if (k > 0 && k !== 28 && k !== 31) expect(g.pos).toBe(KEY_GROUPS[k - 1].end + 1);
      expect(g.root).toBe(KEY_GROUPS[k - (k % 3)].root);
    }
  });

  it("picks the key group by key and the recording by velocity, as mda does", () => {
    expect(KEY_GROUPS[groupOf(36, 0.3)].root).toBe(36);
    expect(KEY_GROUPS[groupOf(40, 0.3)].root).toBe(43); // C1's group ends at 39
    expect(KEY_GROUPS[groupOf(60, 0.3)].root).toBe(60);
    expect(KEY_GROUPS[groupOf(108, 0.3)].root).toBe(96);
    expect(KEY_GROUPS[groupOf(20, 0.3)].root).toBe(36); // below the lowest recording: the lowest, moved down
    // soft (MIDI velocity 48 and under), medium (to 80), hard
    expect(groupOf(60, 48 / 127) % 3).toBe(0);
    expect(groupOf(60, 49 / 127) % 3).toBe(1);
    expect(groupOf(60, 80 / 127) % 3).toBe(1);
    expect(groupOf(60, 81 / 127) % 3).toBe(2);
  });

  it("moves the split points with Hardness: hard plays each key from a lower recording", () => {
    expect(hardnessShift(0.5)).toBe(0);
    expect(hardnessShift(1)).toBe(6);
    expect(hardnessShift(0)).toBe(-6);
    expect(KEY_GROUPS[groupOf(62, 0.5, 1)].root).toBe(55);
    expect(KEY_GROUPS[groupOf(62, 0.5, 0)].root).toBe(67);
  });

  it("reads each recording's own pitch from its loop (a whole number of cycles)", () => {
    for (let k = 0; k < KEY_GROUPS.length; k++) expect(Math.abs(loopCents(k))).toBeLessThan(12);
    expect(loopCents(2)).toBeCloseTo(-10.2, 1); // the hard low C, the flattest
    expect(loopCents(12)).toBeCloseTo(-1.2, 1);
  });

  it("tunes every key to equal temperament within a cent", () => {
    for (let note = 21; note <= 108; note++)
      for (const v of [0.2, 0.5, 0.9]) {
        const g = groupOf(note, v);
        const k = KEY_GROUPS[g];
        // the loop's steady tone, as recorded
        const loopHz = (Math.round((k.loop * 440 * 2 ** ((k.root - 69) / 12)) / TINE_RATE) * TINE_RATE) / k.loop;
        const heard = loopHz * rateOf(note, g);
        expect(Math.abs(cents(heard / (440 * 2 ** ((note - 69) / 12))))).toBeLessThan(1);
      }
  });
});

describe("the electric piano's envelopes", () => {
  it("rings longer in the bass and with more Decay, stops fast when let go", () => {
    expect(decayTau(48)).toBeGreaterThan(decayTau(72));
    expect(decayTau(30)).toBe(decayTau(44)); // mda limits the longest decay
    expect(decayTau(60, 0.8)).toBeGreaterThan(decayTau(60, 0.5));
    // mda's numbers: middle C fades with a time constant of 1.22 s, and stops in about 0.1 s
    expect(decayTau(60)).toBeCloseTo(1 / Math.exp(-0.2), 9);
    expect(releaseTau(60)).toBeCloseTo(1 / Math.exp(4.1), 9);
    expect(releaseTau(60) * Math.log(1e4)).toBeLessThan(0.2);
    expect(ringSeconds(60, 0.7)).toBeGreaterThan(8);
    expect(ringSeconds(96, 0.7)).toBeLessThan(ringSeconds(60, 0.7));
  });

  it("is louder with velocity, a little quieter up high", () => {
    let prev = 0;
    for (let v = 0.05; v <= 1; v += 0.05) {
      const l = levelOf(60, v);
      expect(l).toBeGreaterThan(prev);
      prev = l;
    }
    expect(levelOf(84, 0.7)).toBeLessThan(levelOf(60, 0.7));
    expect(levelOf(48, 0.7)).toBeCloseTo(levelOf(60, 0.7), 9);
    // more Touch, a wider range between soft and hard
    const span = (touch: number) => levelOf(60, 1, touch) / levelOf(60, 0.2, touch);
    expect(span(0.8)).toBeGreaterThan(span(0.25));
  });

  it("places keys in the stereo field with mda's left/right balance", () => {
    for (const note of [24, 48, 60, 72, 100]) {
      const { pan, gain } = panOf(note);
      const x = (pan + 1) / 2;
      const l = gain * Math.cos((x * Math.PI) / 2);
      const r = gain * Math.sin((x * Math.PI) / 2);
      const d = 0.03 * TINE_DEFAULT.width * (note - 60);
      expect(l).toBeCloseTo(1 - d, 9);
      expect(r).toBeCloseTo(1 + d, 9);
    }
    expect(panOf(48).pan).toBeLessThan(0); // low keys left
    expect(panOf(72).pan).toBeGreaterThan(0);
    expect(panOf(84, 0).pan).toBeCloseTo(0, 12);
  });
});

describe("the electric piano's tone and movement", () => {
  /** The treble chain's response at f, built from the same pieces the instrument wires up. */
  function trebleAt(treble: number, f: number, sr = 48000) {
    const m = trebleMix(treble);
    const z = { re: Math.cos((-2 * Math.PI * f) / sr), im: Math.sin((-2 * Math.PI * f) / sr) };
    const lp = (w: number) => {
      const { feedforward: b, feedback: a } = onePole(w, sr);
      // H = b0 / (1 + a1 z^-1)
      const den = { re: 1 + a[1] * z.re, im: a[1] * z.im };
      const d2 = den.re * den.re + den.im * den.im;
      return { re: (b[0] * den.re) / d2, im: (-b[0] * den.im) / d2 };
    };
    const lo = lp(5000);
    const hi = lp(14000);
    const re = m.dry + m.low * lo.re + m.high * hi.re;
    const im = m.low * lo.im + m.high * hi.im;
    return 20 * Math.log10(Math.hypot(re, im));
  }

  it("leaves the sound alone with Treble in the middle, darkens below, lifts the top above", () => {
    for (const f of [100, 1000, 8000]) expect(Math.abs(trebleAt(0.5, f))).toBeLessThan(1e-9);
    expect(trebleAt(0, 100)).toBeGreaterThan(-0.5);
    expect(trebleAt(0, 5000)).toBeLessThan(-12);
    expect(trebleAt(1, 100)).toBeLessThan(0.5);
    expect(trebleAt(1, 10000)).toBeGreaterThan(9);
  });

  it("runs the tremolo and autopan as mda does", () => {
    expect(lfoOf(TINE_DEFAULT).left).toBe(0); // no movement by default
    const trem = lfoOf(tineParams({ mod: 0.75 }));
    expect(trem.left).toBeCloseTo(0.5, 9);
    expect(trem.right).toBeCloseTo(0.5, 9);
    const pan = lfoOf(tineParams({ mod: 0.25 }));
    expect(pan.left).toBeCloseTo(-0.5, 9);
    expect(pan.right).toBeCloseTo(0.5, 9);
    expect(lfoOf(TINE_DEFAULT).hz).toBeCloseTo(Math.exp(6.22 * 0.65 - 2.61), 9); // about 4.2 Hz
    expect(lfoOf(tineParams({ rate: 0 })).hz).toBeLessThan(0.1);
  });

  it("keeps knobs in range and has a preset for each mda program", () => {
    expect(tineParams({ treble: 3, decay: -1, rate: NaN })).toEqual({ ...TINE_DEFAULT, treble: 1, decay: 0 });
    expect(TINE_PRESETS.map((p) => p.id)).toEqual(["classic", "bright", "mellow", "autopan", "tremolo"]);
    for (const p of TINE_PRESETS) expect(tineParams(p.params)).toEqual(p.params);
  });
});

describe("preparing the table", () => {
  /** A table of one rising ramp per recording, so each sample says where it came from. */
  const ramp = () => {
    const t = new Int16Array(TABLE_LENGTH + 4);
    for (let i = 0; i < t.length; i++) t[i] = (i % 20000) - 10000;
    return t;
  };

  it("crossfades each loop's end into the part before it, and leaves the rest alone", () => {
    const raw = ramp();
    const out = prepareTable(raw);
    expect(raw[KEY_GROUPS[0].end]).toBe((KEY_GROUPS[0].end % 20000) - 10000); // the original is not changed
    for (const k of [0, 5, 27]) {
      const g = KEY_GROUPS[k];
      // at the very end the loop's start has taken over, 50 samples back the original is still there
      expect(out[g.end] * 32768).toBeCloseTo(raw[g.end - g.loop], -1);
      expect(out[g.end - 51] * 32768).toBe(raw[g.end - 51]);
      expect(out[g.pos] * 32768).toBe(raw[g.pos]);
    }
    // the top groups (from 28) are not crossfaded in mda
    const g = KEY_GROUPS[30];
    expect(out[g.end] * 32768).toBe(raw[g.end]);
  });

  it("cuts a recording out with its loop in seconds at the table's rate", () => {
    const t = prepareTable(ramp());
    const g = KEY_GROUPS[12];
    const s = groupSlice(t, 12);
    expect(s.data.length).toBe(g.end - g.pos + 1);
    expect(s.data[0]).toBe(t[g.pos]);
    expect(s.loopEnd * TINE_RATE).toBeCloseTo(g.end - g.pos, 6);
    expect((s.loopEnd - s.loopStart) * TINE_RATE).toBeCloseTo(g.loop, 6);
  });
});
