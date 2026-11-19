import { describe, expect, it } from "vitest";
import { Hpss, STEM_IDS, Splitter, background, median, type StemId } from "./split";

const SR = 44100;
const TAU = Math.PI * 2;
const tape = (s: number) => new Float32Array(Math.round(s * SR));
function sine(x: Float32Array, hz: number, amp: number, from = 0, to = x.length / SR) {
  for (let i = Math.round(from * SR); i < Math.min(x.length, Math.round(to * SR)); i++) {
    const t = i / SR - from;
    const env = Math.min(1, t / 0.01, (to - from - t) / 0.01);
    x[i] += amp * env * Math.sin(TAU * hz * (i / SR));
  }
}
/** A click: a few milliseconds of noise. */
function click(x: Float32Array, at: number, amp: number, seed: number) {
  let s = seed;
  for (let i = 0; i < 0.006 * SR; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    x[Math.round(at * SR) + i] += amp * (s / 0x40000000 - 1) * Math.exp(-i / (0.0015 * SR));
  }
}
/** Split a whole recording and gather each stem. */
function splitAll(left: Float32Array, right: Float32Array, bg = true): Record<StemId, Float32Array> {
  const mid = left.map((l, i) => 0.5 * (l + right[i]));
  const sp = new Splitter(SR, { background: bg ? background(mid, SR) : null });
  const out = Object.fromEntries(STEM_IDS.map((s) => [s, new Float32Array(left.length)])) as Record<StemId, Float32Array>;
  let at = 0;
  const put = (c: ReturnType<Splitter["push"]>) => {
    if (!c) return;
    expect(c.from).toBe(at);
    for (const s of STEM_IDS) out[s].set(c.stems[s].subarray(0, Math.max(0, left.length - at)), at);
    at += c.length;
  };
  // fed in uneven pieces, as a stream would be
  for (let i = 0; i < left.length; ) {
    const n = 1000 + ((i * 7) % 3001);
    put(sp.push(left.subarray(i, i + n), right.subarray(i, i + n)));
    i += n;
  }
  put(sp.flush());
  expect(at).toBe(left.length);
  return out;
}
const energy = (x: Float32Array, from = 0, to = x.length / SR) => {
  let e = 0;
  for (let i = Math.round(from * SR); i < Math.min(x.length, Math.round(to * SR)); i++) e += x[i] * x[i];
  return e;
};
const corr = (a: Float32Array, b: Float32Array) => {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb + 1e-20);
};

describe("splitting a recording into layers (no model)", () => {
  it("finds medians", () => {
    expect(median(Float32Array.from([5, 1, 4, 2, 3]), 5)).toBe(3);
    expect(median(Float32Array.from([9, 9, 1]), 3)).toBe(9);
    expect(median(Float32Array.from([2, 7, 7, 1, 7, 0, 3]), 7)).toBe(3);
  });

  it("the median filters' sizes: about a fifth of a second across time, about 500 Hz across frequency; live, they look only back", () => {
    const h = new Hpss(1025, SR);
    expect(h.kh).toBe(17);
    expect(h.kp).toBe(23);
    expect(h.delay).toBe(8);
    expect(new Hpss(1025, SR, 512, 2048, false).delay).toBe(0);
  });

  it("the four stems add up to the mix again", () => {
    const l = tape(2);
    const r = tape(2);
    sine(l, 220, 0.3);
    sine(r, 330, 0.2);
    for (let k = 0; k < 8; k++) click(l, 0.1 + k * 0.23, 0.6, k + 1);
    const s = splitAll(l, r);
    let err = 0;
    for (let i = 0; i < l.length; i++) err = Math.max(err, Math.abs(s.drums[i] + s.bass[i] + s.vocals[i] + s.other[i] - 0.5 * (l[i] + r[i])));
    expect(err).toBeLessThan(1e-4);
  });

  it("clicks go to the drums and a held tone does not (harmonic/percussive separation)", () => {
    const x = tape(3);
    sine(x, 440, 0.2);
    sine(x, 660, 0.1);
    const clicks = tape(3);
    const at = Array.from({ length: 10 }, (_, k) => 0.3 + k * 0.25);
    at.forEach((t, k) => click(clicks, t, 0.9, 7 + k));
    for (let i = 0; i < x.length; i++) x[i] += clicks[i];
    const s = splitAll(x, x);
    const tone = (st: StemId) => at.reduce((e, t) => e + energy(s[st], t + 0.06, t + 0.2), 0);
    const hits = (y: Float32Array) => at.reduce((e, t) => e + energy(y, t - 0.002, t + 0.008), 0);
    const steady = tone("bass") + tone("vocals") + tone("other");
    // between the clicks, the tone is in the steady stems, hardly in the drums
    expect(tone("drums")).toBeLessThan(0.05 * steady);
    // at the clicks, the drums take most of the clicks
    expect(hits(s.drums)).toBeGreaterThan(0.4 * hits(clicks));
    expect(corr(s.drums, clicks)).toBeGreaterThan(0.6);
  });

  it("what is steady and low is the bass", () => {
    const x = tape(2);
    sine(x, 55, 0.3);
    sine(x, 1200, 0.2);
    const s = splitAll(x, x, false);
    const low = tape(2);
    sine(low, 55, 0.3);
    expect(corr(s.bass, low)).toBeGreaterThan(0.95);
    expect(energy(s.bass, 0.3, 1.7)).toBeGreaterThan(0.8 * energy(low, 0.3, 1.7));
    // the high tone is not in the bass
    const high = tape(2);
    sine(high, 1200, 0.2);
    expect(Math.abs(corr(s.bass, high))).toBeLessThan(0.05);
  });

  it("a voice in the middle that does not repeat stands out from an accompaniment that does, out to the sides (REPET-SIM)", () => {
    const secs = 10;
    const accL = tape(secs);
    const accR = tape(secs);
    // a one-second figure, played over and over, panned out
    for (let k = 0; k < secs; k++) {
      [196, 247, 294].forEach((hz, i) => sine(i === 1 ? accR : accL, hz, 0.12, k + i * 0.25, k + 1));
      sine(accR, 392, 0.08, k + 0.5, k + 1);
    }
    // a line that never repeats, in the middle
    const voice = tape(secs);
    let s = 3;
    for (let t = 0.2; t < secs - 0.4; t += 0.4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const hz = 330 * Math.pow(2, (s % 13) / 12);
      for (let h = 1; h <= 3; h++) sine(voice, hz * h * (1 + 0.004 * Math.sin(t * 9)), 0.12 / h, t, t + 0.36);
    }
    const left = accL.map((a, i) => a + voice[i]);
    const right = accR.map((a, i) => a + voice[i]);
    const st = splitAll(left, right);
    const accMid = accL.map((a, i) => 0.5 * (a + accR[i]));
    expect(corr(st.vocals, voice)).toBeGreaterThan(0.5);
    expect(corr(st.vocals, voice)).toBeGreaterThan(10 * Math.abs(corr(st.vocals, accMid)));
    // and the accompaniment is left in the other stem
    expect(corr(st.other, accMid)).toBeGreaterThan(10 * Math.abs(corr(st.vocals, accMid)));
  });

  it("starts from the middle of a song, in step with it", () => {
    const x = tape(3);
    sine(x, 300, 0.3);
    const sp = new Splitter(SR, { from: SR });
    const c = sp.push(x.subarray(SR, 2 * SR), x.subarray(SR, 2 * SR));
    expect(c?.from).toBe(SR);
  });
});
