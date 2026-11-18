import { describe, expect, it } from "vitest";
import { Ear, type Frame } from "./ear";

const SR = 48000;
const TAU = Math.PI * 2;

/** A stretch of silence to write sounds into. */
const tape = (seconds: number) => new Float32Array(Math.round(seconds * SR));
/** A tone from `at` for `len` seconds, with a quick fade in and out (5 ms) unless it is plucked. */
function tone(x: Float32Array, hz: number, at: number, len: number, amp = 0.3, pluck = 0) {
  const from = Math.round(at * SR);
  const n = Math.round(len * SR);
  for (let i = 0; i < n && from + i < x.length; i++) {
    const t = i / SR;
    const env = pluck > 0 ? Math.exp(-t / pluck) * Math.min(1, i / 48) : Math.min(1, i / 240, (n - i) / 240);
    x[from + i] += amp * env * Math.sin(TAU * hz * t);
  }
}
/** A burst of noise (a snare, a hat): white, dying away over `ring` seconds, above `lowest` hertz. */
function burst(x: Float32Array, at: number, ring: number, amp = 0.4, seed = 1) {
  const from = Math.round(at * SR);
  let s = seed;
  for (let i = 0; i < ring * 6 * SR && from + i < x.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    x[from + i] += amp * Math.exp(-i / SR / ring) * (s / 2147483648 - 1);
  }
}
const hear = (x: Float32Array, ref?: number): Frame[] => new Ear(SR, ref).push(x);
/** Every voice that was heard, with how long it lasted and its (median) frequency. */
function voices(frames: Frame[]) {
  const seen = new Map<number, { born: number; last: number; hz: number[]; struck: number; peak: number }>();
  for (const f of frames) {
    for (const v of f.voices) {
      const s = seen.get(v.id) ?? { born: v.born, last: f.t, hz: [], struck: v.struck, peak: 0 };
      s.last = f.t;
      s.hz.push(v.hz);
      s.peak = Math.max(s.peak, v.amp);
      seen.set(v.id, s);
    }
  }
  return [...seen.values()].map((s) => ({ born: s.born, len: s.last - s.born, hz: s.hz.sort((a, b) => a - b)[s.hz.length >> 1], struck: s.struck, peak: s.peak }));
}

describe("the ear", () => {
  it("follows a held note for as long as it sounds, at its own frequency", () => {
    const x = tape(2);
    tone(x, 440, 0.3, 1.2);
    const v = voices(hear(x)).filter((v) => v.peak > 0.5);
    expect(v).toHaveLength(1);
    expect(Math.abs(v[0].hz - 440)).toBeLessThan(2);
    expect(v[0].born).toBeGreaterThan(0.24);
    expect(v[0].born).toBeLessThan(0.36);
    expect(v[0].len).toBeGreaterThan(1.05);
    expect(v[0].len).toBeLessThan(1.35);
  });

  it("hears staccato notes as short and legato notes as long", () => {
    const x = tape(4);
    // four short notes, then one long one, at the same pitch
    for (let k = 0; k < 4; k++) tone(x, 660, 0.3 + k * 0.25, 0.06);
    tone(x, 660, 1.6, 1.5);
    const v = voices(hear(x)).filter((v) => v.peak > 0.4 && Math.abs(v.hz - 660) < 20);
    const short = v.filter((s) => s.born < 1.4);
    const long = v.filter((s) => s.born > 1.4);
    expect(short).toHaveLength(4);
    for (const s of short) expect(s.len).toBeLessThan(0.16);
    expect(long).toHaveLength(1);
    expect(long[0].len).toBeGreaterThan(1.3);
  });

  it("hears the same note struck again as a new sound", () => {
    const x = tape(3);
    // one string plucked four times, each pluck ringing on under the next
    for (let k = 0; k < 4; k++) tone(x, 392, 0.3 + k * 0.5, 2, 0.3, 0.6);
    const v = voices(hear(x)).filter((v) => v.peak > 0.5 && Math.abs(v.hz - 392) < 10);
    expect(v.length).toBe(4);
    expect(v.map((s) => Math.round(s.born * 10) / 10)).toEqual([0.3, 0.8, 1.3, 1.8]);
    // and a note that merely swells and fades (a tremolo) is one sound
    const y = tape(3);
    for (let i = Math.round(0.2 * SR); i < 2.6 * SR; i++) y[i] = 0.3 * (0.75 + 0.25 * Math.sin((TAU * 4 * i) / SR)) * Math.sin((TAU * 500 * i) / SR);
    expect(voices(hear(y)).filter((v) => v.peak > 0.5 && v.len > 2)).toHaveLength(1);
  });

  it("tells the notes of a chord apart, low and high", () => {
    const x = tape(1.5);
    for (const hz of [110, 220, 277.2, 329.6, 1318.5, 3520]) tone(x, hz, 0.2, 1, 0.12);
    const v = voices(hear(x)).filter((v) => v.len > 0.7);
    for (const hz of [110, 220, 277.2, 329.6, 1318.5, 3520]) {
      expect(v.some((s) => Math.abs(12 * Math.log2(s.hz / hz)) < 0.3), `${hz} Hz`).toBe(true);
    }
    expect(v.length).toBeLessThan(9);
  });

  it("follows a bend and a vibrato", () => {
    const x = tape(2);
    let ph = 0;
    for (let i = Math.round(0.2 * SR); i < 1.7 * SR; i++) {
      const t = i / SR - 0.2;
      // from 400 Hz up to 500 Hz over a second, with a 6 Hz wobble
      const hz = 400 + 100 * Math.min(1, t) + 6 * Math.sin(TAU * 6 * t);
      ph += (TAU * hz) / SR;
      x[i] = 0.3 * Math.sin(ph);
    }
    const frames = hear(x);
    const at = (t: number) => frames.find((f) => f.t >= t)!.voices.sort((a, b) => b.amp - a.amp)[0];
    expect(Math.abs(at(0.35).hz - 415)).toBeLessThan(15);
    expect(Math.abs(at(1.5).hz - 500)).toBeLessThan(12);
    // one voice all the way, not a string of new ones
    expect(voices(frames).filter((v) => v.peak > 0.5 && v.len > 1.2)).toHaveLength(1);
  });

  it("marks a drum as a hit, where it is, and a noise as noisy", () => {
    const x = tape(3);
    // a kick (a low thump that falls in pitch), a snare (noise), a hat (very short noise)
    let ph = 0;
    for (let i = 0; i < 0.3 * SR; i++) {
      const t = i / SR;
      ph += (TAU * (50 + 90 * Math.exp(-t / 0.03))) / SR;
      x[Math.round(0.5 * SR) + i] += 0.8 * Math.exp(-t / 0.09) * Math.sin(ph);
    }
    burst(x, 1.2, 0.05, 0.5);
    burst(x, 2.0, 0.012, 0.3, 7);
    const hits = hear(x).flatMap((f) => f.hits.map((h) => ({ ...h, t: f.t })));
    const near = (t: number) => hits.filter((h) => Math.abs(h.t - t) < 0.05);
    expect(near(0.5), "kick").toHaveLength(1);
    expect(near(1.2), "snare").toHaveLength(1);
    expect(near(2.0), "hat").toHaveLength(1);
    expect(hits.length).toBeLessThanOrEqual(4);
    const [kick] = near(0.5);
    const [snare] = near(1.2);
    expect(kick.hz).toBeLessThan(250);
    expect(snare.hi).toBeGreaterThan(4000);
    expect(snare.noisy).toBeGreaterThan(kick.noisy + 0.2);
  });

  it("reports a noise as noise and not as a crowd of notes", () => {
    const x = tape(2);
    let s = 9;
    for (let i = Math.round(0.2 * SR); i < 1.8 * SR; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      x[i] = 0.2 * (s / 2147483648 - 1);
    }
    const frames = hear(x);
    const mid = frames.filter((f) => f.t > 0.6 && f.t < 1.6);
    const perFrame = mid.reduce((a, f) => a + f.voices.length, 0) / mid.length;
    expect(perFrame).toBeLessThan(3);
    const loud = mid.reduce((a, f) => a + f.noise[18], 0) / mid.length;
    expect(loud).toBeGreaterThan(0.4);
    expect(mid[10].flat).toBeGreaterThan(0.3);
    // and a pure tone is not noise
    const y = tape(1);
    tone(y, 1000, 0.1, 0.8);
    const f = hear(y).find((f) => f.t > 0.5)!;
    expect(Math.max(...f.noise)).toBeLessThan(0.25);
    expect(f.flat).toBeLessThan(0.05);
  });

  it("knows a plucked note from one that swells in", () => {
    const x = tape(3);
    tone(x, 330, 0.3, 1, 0.4, 0.25);
    // a slow swell: half a second to full
    for (let i = 0; i < SR; i++) x[Math.round(1.7 * SR) + i] += 0.4 * Math.min(1, i / (0.5 * SR)) * Math.sin((TAU * 330 * i) / SR);
    const v = voices(hear(x)).filter((v) => v.peak > 0.4);
    const plucked = v.find((s) => s.born < 1)!;
    const swelled = v.find((s) => s.born > 1.5)!;
    expect(plucked.struck).toBeGreaterThan(0.5);
    expect(swelled.struck).toBeLessThan(0.3);
  });

  it("paints a quiet recording as fully as a loud one", () => {
    const loud = tape(1.5);
    const quiet = tape(1.5);
    tone(loud, 500, 0.2, 1, 0.5);
    tone(quiet, 500, 0.2, 1, 0.01);
    const a = voices(hear(loud))[0];
    const b = voices(hear(quiet))[0];
    expect(a.peak).toBeGreaterThan(0.9);
    expect(b.peak).toBeGreaterThan(0.9);
  });

  it("names the notes that are sounding", () => {
    const x = tape(1.5);
    // C major: C E G
    for (const hz of [261.63, 329.63, 392]) tone(x, hz, 0.1, 1.2, 0.2);
    const f = hear(x).find((f) => f.t > 0.8)!;
    expect(f.chroma[0] + f.chroma[4] + f.chroma[7]).toBeGreaterThan(0.95);
  });

  it("gives the same answer however the audio is cut up", () => {
    const x = tape(1);
    tone(x, 700, 0.1, 0.5);
    burst(x, 0.7, 0.03);
    const whole = hear(x);
    const ear = new Ear(SR);
    const parts: Frame[] = [];
    for (let i = 0; i < x.length; i += 128) ear.push(x.subarray(i, i + 128), parts);
    expect(parts.length).toBe(whole.length);
    expect(parts.map((f) => f.voices.length)).toEqual(whole.map((f) => f.voices.length));
    expect(parts.map((f) => f.hits.length)).toEqual(whole.map((f) => f.hits.length));
  });
});
