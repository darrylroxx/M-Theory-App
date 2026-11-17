import { describe, expect, it } from "vitest";
import { DEFAULT_BEAT, soundOf, voiceOf } from "./beats";
import { BANDS, F_HI, F_LO, PER_OCTAVE, bandHz, bandOf, describe as measure, fft, plainTone, spectrum, toBands } from "./describe";
import { DRUM_IDS, renderDrum } from "./drums";
import { STRING_DEFAULT, renderHarp } from "./harp";

const SR = 44100;
/** A made-up sound: `fn(t)` for `sec` seconds. */
const make = (sec: number, fn: (t: number, i: number) => number) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => fn(i / SR, i));
const TAU = Math.PI * 2;
/** Noise that is the same every time. */
const hiss = () => {
  let a = 12345;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 2147483648 - 1;
  };
};

describe("the frequency bands", () => {
  it("nine octaves, six bands to the octave", () => {
    expect(BANDS).toBe(Math.round(Math.log2(F_HI / F_LO) * PER_OCTAVE));
    expect(BANDS).toBeGreaterThanOrEqual(50);
    expect(bandOf(F_LO)).toBeCloseTo(0);
    expect(bandOf(F_LO * 2)).toBeCloseTo(PER_OCTAVE);
    expect(Math.floor(bandOf(bandHz(17)))).toBe(17);
    // an octave up is always six bands up
    expect(bandOf(880) - bandOf(440)).toBeCloseTo(PER_OCTAVE);
  });
});

describe("the Fourier transform", () => {
  it("finds a tone at its own frequency and nowhere else", () => {
    const n = 1024;
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((TAU * 37 * i) / n));
    const im = new Float64Array(n);
    fft(re, im);
    const mag = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
    expect(mag.indexOf(Math.max(...mag))).toBe(37);
    expect(mag[37]).toBeCloseTo(n / 2, 3);
    expect(mag.filter((_, k) => k !== 37).every((m) => m < 1e-6)).toBe(true);
  });

  it("keeps the energy (Parseval): what goes in comes out", () => {
    const n = 2048;
    const r = hiss();
    const x = Float64Array.from({ length: n }, () => r());
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft(re, im);
    const inE = x.reduce((a, v) => a + v * v, 0);
    let outE = 0;
    for (let k = 0; k < n; k++) outE += re[k] * re[k] + im[k] * im[k];
    expect(outE / n).toBeCloseTo(inE, 6);
  });

  it("a tone's power lands in its own band", () => {
    for (const hz of [55, 110, 440, 1760, 7040]) {
      const bands = toBands(spectrum(make(0.2, (t) => Math.sin(TAU * hz * t)), 0, 4096), SR);
      let best = 0;
      for (let b = 0; b < BANDS; b++) if (bands[b] > bands[best]) best = b;
      expect(Math.abs(best - Math.floor(bandOf(hz))), `${hz} Hz`).toBeLessThanOrEqual(1);
    }
  });
});

describe("measuring a sound", () => {
  it("a plucked tone: one part, at its pitch, a tone and not a noise, ringing as long as it rings", () => {
    for (const hz of [110, 440, 1760]) {
      const tau = 0.2;
      const s = measure(make(1.5, (t) => Math.sin(TAU * hz * t) * Math.exp(-t / tau) * 0.5), SR);
      expect(s.parts.length, `${hz}`).toBeGreaterThanOrEqual(1);
      expect(Math.abs(Math.log2(s.parts[0].hz / hz)) * 12, `${hz} Hz in semitones`).toBeLessThan(0.3);
      expect(s.parts[0].noise).toBeLessThan(0.15);
      expect(s.parts[0].gain).toBe(1);
      expect(s.parts[0].glide).toBe(0);
      // 30 dB down an exponential decay is 3.45 time constants
      expect(s.ring).toBeGreaterThan(tau * 3.45 * 0.85);
      expect(s.ring).toBeLessThan(tau * 3.45 * 1.2);
      expect(s.attack).toBeGreaterThan(0.8);
    }
  });

  it("a shorter sound rings shorter, a louder one is louder", () => {
    const tone = (tau: number, gain: number) => measure(make(2, (t) => Math.sin(TAU * 330 * t) * Math.exp(-t / tau) * gain), SR);
    expect(tone(0.05, 0.5).ring).toBeLessThan(tone(0.3, 0.5).ring * 0.3);
    expect(tone(0.3, 0.6).level).toBeGreaterThan(tone(0.3, 0.15).level * 2);
  });

  it("a hiss: wide, noisy, high", () => {
    const r = hiss();
    let last = 0;
    // noise with the lows taken out (each sample minus the one before)
    const s = measure(make(0.3, (t) => { const x = r(); const y = x - last; last = x; return y * Math.exp(-t / 0.03) * 0.4; }), SR);
    expect(s.parts[0].noise).toBeGreaterThan(0.6);
    expect(s.parts[0].width).toBeGreaterThan(0.5);
    expect(s.centre).toBeGreaterThan(4000);
    expect(s.ring).toBeLessThan(0.2);
  });

  it("a tone and a hiss together are two parts, each in its place", () => {
    const r = hiss();
    let last = 0;
    const s = measure(make(0.6, (t) => { const x = r(); const y = x - last; last = x; return (Math.sin(TAU * 200 * t) * 0.6 + y * 0.25) * Math.exp(-t / 0.08); }), SR);
    const tone = s.parts.find((p) => Math.abs(Math.log2(p.hz / 200)) < 0.1);
    const noise = s.parts.find((p) => p.hz > 3000);
    expect(tone, "the tone").toBeTruthy();
    expect(noise, "the hiss").toBeTruthy();
    expect(tone!.noise).toBeLessThan(0.3);
    expect(noise!.noise).toBeGreaterThan(0.6);
  });

  it("a pitch that falls is heard as falling", () => {
    // from 240 Hz down to 60 Hz in a few hundredths of a second, like a kick drum
    let phase = 0;
    const s = measure(make(0.6, (t) => { const hz = 60 + 180 * Math.exp(-t / 0.02); phase += (TAU * hz) / SR; return Math.sin(phase) * Math.exp(-t / 0.15) * 0.8; }), SR);
    const low = [...s.parts].sort((a, b) => a.hz - b.hz)[0];
    expect(low.hz).toBeLessThan(110);
    expect(low.glide).toBeLessThan(-0.4);
    // a steady tone does not
    expect(measure(make(0.6, (t) => Math.sin(TAU * 60 * t) * Math.exp(-t / 0.15) * 0.8), SR).parts[0].glide).toBe(0);
  });

  it("a click starts hard, a swell does not", () => {
    const click = measure(make(0.5, (t) => Math.sin(TAU * 500 * t) * Math.exp(-t / 0.1)), SR);
    const swell = measure(make(0.5, (t) => Math.sin(TAU * 500 * t) * Math.min(1, t / 0.12) * Math.exp(-t / 0.3)), SR);
    expect(click.attack).toBeGreaterThan(0.85);
    expect(swell.attack).toBeLessThan(0.2);
  });

  it("silence is nothing; a plain tone is a stand-in when a recording cannot be reached", () => {
    expect(measure(new Float32Array(2000), SR)).toMatchObject({ level: 0, parts: [] });
    const t = plainTone(440, 2);
    expect(t.parts).toEqual([{ hz: 440, width: 0.05, gain: 1, ring: 2, noise: 0, glide: 0 }]);
  });

  it("the same recording is measured once", () => {
    const d = make(0.3, (t) => Math.sin(TAU * 440 * t));
    expect(measure(d, SR)).toBe(measure(d, SR));
  });
});

describe("the app's own sounds, measured", () => {
  const drum = (id: (typeof DRUM_IDS)[number]) => measure(renderDrum(SR, voiceOf(DEFAULT_BEAT, id), id, soundOf(DEFAULT_BEAT, id)), SR);

  it("every drum can be measured and has at least one part inside the range shown", () => {
    for (const id of DRUM_IDS) {
      const s = drum(id);
      expect(s.parts.length, id).toBeGreaterThanOrEqual(1);
      expect(s.level, id).toBeGreaterThan(0);
      expect(s.ring, id).toBeGreaterThan(0.01);
      for (const p of s.parts) {
        expect(p.hz, id).toBeGreaterThan(F_LO * 0.8);
        expect(p.hz, id).toBeLessThan(F_HI * 1.05);
        expect(p.gain, id).toBeGreaterThan(0);
        expect(p.gain, id).toBeLessThanOrEqual(1);
      }
      expect(s.parts[0].gain, id).toBe(1);
    }
  });

  it("the kick is the lowest and a thump; the hats are the highest and a hiss; the snare is both a body and a hiss", () => {
    const kick = drum("kick");
    const hat = drum("hat");
    const open = drum("open");
    const snare = drum("snare");
    expect(kick.parts[0].hz).toBeLessThan(150);
    expect(kick.parts[0].noise).toBeLessThan(0.3);
    expect(hat.parts[0].hz).toBeGreaterThan(4000);
    expect(hat.centre).toBeGreaterThan(kick.centre * 20);
    // an open hat is the same sound left to ring
    expect(open.ring).toBeGreaterThan(hat.ring * 3);
    expect(snare.parts.some((p) => p.hz < 400)).toBe(true);
    expect(snare.parts.some((p) => p.hz > 2000 && p.noise > 0.5)).toBe(true);
    // the loudest sound in the kit is the kick
    for (const id of DRUM_IDS) expect(drum(id).level, id).toBeLessThanOrEqual(kick.level);
  });

  it("a harp note's strongest low part is its pitch, with overtones above; high notes die away sooner than low ones", () => {
    const note = (midi: number) => measure(renderHarp(SR, midi, STRING_DEFAULT, () => 0.5), SR);
    for (const midi of [40, 52, 60, 67, 76]) {
      const hz = 440 * Math.pow(2, (midi - 69) / 12);
      const s = note(midi);
      const lowest = [...s.parts].filter((p) => p.gain > 0.3).sort((a, b) => a.hz - b.hz)[0];
      expect(Math.abs(Math.log2(lowest.hz / hz)) * 12, `midi ${midi}`).toBeLessThan(0.5);
      expect(s.parts.every((p) => p.noise < 0.4), `midi ${midi}`).toBe(true);
      // every other part is higher: an overtone
      expect(s.parts.every((p) => p.hz > hz * 0.9), `midi ${midi}`).toBe(true);
    }
    expect(note(40).ring).toBeGreaterThan(note(76).ring * 2);
    // overtones die away before the note itself does
    const low = note(40);
    const sorted = [...low.parts].sort((a, b) => a.hz - b.hz);
    expect(sorted[sorted.length - 1].ring).toBeLessThan(sorted[0].ring);
  });
});
