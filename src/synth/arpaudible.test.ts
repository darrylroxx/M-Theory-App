/**
 * Every arp step heard as a note of its own, on every sound: the whole chain (the way of playing,
 * the steps marked for the synth, the sound as the engine gets it, the kernel) rendered offline and
 * each step's start measured. A pad played as an arp used to sound like the pad held (its slow
 * swell never arrived within a step, its long release and hall ran the steps together); now at
 * least nine steps in ten rise 6 dB or more over what came before, at 1/8 and 1/16, at 90 and
 * 140 bpm, while the same sound's held chord still swells as it was made to. A track's own reverb
 * (the Reverb knob every track has, after its instrument) is modelled with the very room it builds,
 * since it comes on top of the synth's own.
 */
import { describe, expect, it } from "vitest";
import { ARP_STYLES, stylesFor, withRange, withSpeed, withStyle } from "./arpstyles";
import { onsetRises, partialHz, cents, rms } from "./measure";
import { SOUND_DEFAULT, VERB_PRE, verbSendOf, type HarpSound } from "../audio/rack";
import { drumRng, renderSpace } from "../audio/drums";
import { rackForPlay } from "../audio/trackvoice";
import { DEFAULT_PLAY, type PlaySettings, type SynthParams } from "./params";
import { type PlayNote, type SynthNote, playNotes, withSteps } from "./play";
import { PRESETS, presetById } from "./presets";
import { renderNotes } from "./render";

const SR = 24000;
const START = 0.1;
/** Two bars: C major, then A minor, voiced as a chords track on the synth voices them. */
function chords(bpm: number, beats = 4): PlayNote[] {
  const bar = (beats * 60) / bpm;
  return [
    ...[52, 60, 64, 67].map((midi) => ({ midi, start: START, length: bar, velocity: 0.78 })),
    ...[57, 60, 64, 69].map((midi) => ({ midi, start: START + bar, length: bar, velocity: 0.78 })),
  ];
}

/** Each strike of the arp, measured: how far it rises over what came before it (dB). */
function rises(sound: SynthParams, play: PlaySettings, bpm: number, notes: PlayNote[] = chords(bpm), bar = 4): number[] {
  const out = withSteps(playNotes(notes, play, { bpm, origin: START, seed: 11, bar }), play, bpm);
  const { L, R } = renderNotes({ ...sound, play }, out, { sampleRate: SR, seconds: START + (8 * 60) / bpm + 0.4, seed: 7 });
  const hits: { t: number; step: number }[] = [];
  // (the very first strike starts from silence: the ones after it are the test)
  for (const n of out) if (n.start > START + 0.02 && !hits.some((h) => Math.abs(h.t - n.start) < 1e-4)) hits.push({ t: n.start, step: n.step ?? 0 });
  return onsetRises(L, R, SR, hits);
}
const share = (r: number[]) => r.filter((x) => x >= 6).length / r.length;
const arp: PlaySettings = { ...DEFAULT_PLAY, mode: "arp" };

describe("arp steps are heard on every sound", () => {
  // the sounds made for holding (slow swells, long tails, big rooms, echoes, a gliding lead, a sliding bass), in every style
  const hard = ["warm-pad", "choir-pad", "wide-pad", "glass-drone", "ensemble-strings", "supersaw-lead", "rubber-bass", "fm-bell", "synth-brass", "dark-pad"];
  for (const speed of ["1/16", "1/8"])
    for (const bpm of [90, 140])
      it(`every preset, the arp as it starts (Up), ${speed} at ${bpm} bpm`, () => {
        const low: string[] = [];
        for (const p of PRESETS) {
          const r = rises(p.params, withSpeed(arp, speed), bpm);
          if (share(r) < 0.9) low.push(`${p.id} ${Math.round(share(r) * 100)}%`);
        }
        expect(low).toEqual([]);
      });
  for (const s of ARP_STYLES)
    it(`${s.name}: the slow, long and gliding sounds too`, () => {
      const low: string[] = [];
      for (const id of hard)
        for (const [speed, bpm] of [["1/16", 140], ["1/8", 90]] as const) {
          const r = rises(presetById(id)!.params, withSpeed(withStyle(arp, s), speed), bpm);
          if (share(r) < 0.9) low.push(`${id} ${speed} ${bpm}: ${Math.round(share(r) * 100)}%`);
        }
      expect(low).toEqual([]);
    });
  // 6/8: a beat is three eighths, so its sixteenths are the fastest steps there are (71 ms at 140)
  for (const [speed, bpm] of [["1/16", 140], ["1/8", 90]] as const)
    it(`in 6/8, every preset (Up), and the slow, long and gliding sounds in every style offered there, ${speed} at ${bpm} bpm`, () => {
      const low: string[] = [];
      for (const p of PRESETS)
        for (const s of hard.includes(p.id) ? stylesFor(true) : stylesFor(true).slice(0, 1)) {
          const r = rises(p.params, withSpeed(withStyle(arp, s, true), speed, true), bpm, chords(bpm, 2), 2);
          if (share(r) < 0.9) low.push(`${p.id} ${s.id} ${Math.round(share(r) * 100)}%`);
        }
      expect(low).toEqual([]);
    });
  it("a pulse strikes the chord again, every time heard", () => {
    const low: string[] = [];
    for (const p of PRESETS) {
      const r = rises(p.params, { ...DEFAULT_PLAY, mode: "pulse", rate: "1/8", gate: 0.6 }, 120);
      if (share(r) < 0.9) low.push(`${p.id} ${Math.round(share(r) * 100)}%`);
    }
    expect(low).toEqual([]);
  });
});

/** In-place radix-2 FFT with its turns worked out once for each length (the tests below make many of the same length). */
const turns = new Map<number, [Float64Array, Float64Array]>();
function fastFft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  let t = turns.get(n);
  if (!t) {
    t = [new Float64Array(n / 2), new Float64Array(n / 2)];
    for (let k = 0; k < n / 2; k++) {
      t[0][k] = Math.cos((-2 * Math.PI * k) / n);
      t[1][k] = Math.sin((-2 * Math.PI * k) / n);
    }
    turns.set(n, t);
  }
  const [cs, sn] = t;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const stride = n / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < half; k++) {
        const wr = cs[k * stride];
        const wi = sn[k * stride];
        const p = i + k;
        const q = p + half;
        const vr = re[q] * wr - im[q] * wi;
        const vi = re[q] * wi + im[q] * wr;
        re[q] = re[p] - vr;
        im[q] = im[p] - vi;
        re[p] += vr;
        im[p] += vi;
      }
  }
}
/** A room's two sides, and their spectra at each length, made once. */
const rooms = new Map<string, { sides: [Float32Array, Float32Array]; spectra: Map<number, [Float64Array, Float64Array][]> }>();
/** `x` convolved with side `ch` of the room (the first x.length samples), by FFT. */
function convolve(x: Float32Array, room: HarpSound, ch: 0 | 1): Float64Array {
  const key = `${room.size}|${room.verb}`;
  let r = rooms.get(key);
  if (!r) rooms.set(key, (r = { sides: renderSpace(SR, room.size, drumRng(11), room.verb), spectra: new Map() }));
  const h = r.sides[ch];
  let n = 1;
  while (n < x.length + h.length) n <<= 1;
  let spec = r.spectra.get(n);
  if (!spec) {
    spec = r.sides.map((side) => {
      const re = new Float64Array(n), im = new Float64Array(n);
      re.set(side);
      fastFft(re, im);
      return [re, im] as [Float64Array, Float64Array];
    });
    r.spectra.set(n, spec);
  }
  const [br, bi] = spec[ch];
  const ar = new Float64Array(n), ai = new Float64Array(n);
  ar.set(x);
  fastFft(ar, ai);
  // the product, conjugated, transformed again: the inverse transform (conjugated back, scaled)
  for (let i = 0; i < n; i++) {
    const re = ar[i] * br[i] - ai[i] * bi[i];
    const im = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = re;
    ai[i] = -im;
  }
  fastFft(ar, ai);
  return Float64Array.from(ar.subarray(0, x.length), (v) => v / n);
}
/** The synth's output through a track's rack reverb as the app builds it: the same room, sent as much, after the same gap (the rest of the rack does not blur). */
function throughRoom(L: Float32Array, R: Float32Array, s: HarpSound): { L: Float32Array; R: Float32Array } {
  const send = verbSendOf(s);
  const gap = Math.round(VERB_PRE * SR);
  const wet = [convolve(L, s, 0), convolve(R, s, 1)];
  const mix = (dry: Float32Array, w: Float64Array) => Float32Array.from(dry, (v, i) => v + (i >= gap ? send * w[i - gap] : 0));
  return { L: mix(L, wet[0]), R: mix(R, wet[1]) };
}
/** As the Chords page voices B, E, G#m, F# for a chords track on the synth (from the app's MIDI export). */
const PAGE = [[51, 59, 66], [52, 59, 68], [51, 59, 68], [49, 58, 66]];
/** Each step's rise with the track's own room behind the synth, for the page's chords at 120 bpm. */
function risesInRoom(sound: SynthParams, play: PlaySettings, room: (p: PlaySettings) => HarpSound, bars = 2): number[] {
  const bpm = 120;
  const bar = (4 * 60) / bpm;
  const notes = PAGE.slice(0, bars).flatMap((c, i) => c.map((midi) => ({ midi, start: START + i * bar, length: bar, velocity: 0.725 })));
  const out = withSteps(playNotes(notes, play, { bpm, origin: START, seed: 11, bar: 4 }), play, bpm);
  const dry = renderNotes({ ...sound, play }, out, { sampleRate: SR, seconds: START + bars * bar + 0.3, seed: 7 });
  const { L, R } = throughRoom(dry.L, dry.R, room(play));
  const hits: { t: number; step: number }[] = [];
  for (const n of out) if (n.start > START + 0.02 && !hits.some((h) => Math.abs(h.t - n.start) < 1e-4)) hits.push({ t: n.start, step: n.step ?? 0 });
  return onsetRises(L, R, SR, hits);
}

describe("behind the track's own reverb", () => {
  // the sounds whose soft steps came after loud ones in a full room: brass, choir, pads, drones, strings
  const hard = ["soft-horns", "synth-brass", "choir-pad", "glass-pad", "warm-pad", "glass-drone", "ensemble-strings", "fm-bell"];
  const at = (s: (typeof ARP_STYLES)[number]) => withRange(withSpeed(withStyle(arp, s), "1/16"), 1);
  it("every style, on the sounds made for holding, with the Reverb every track starts with", () => {
    const low: string[] = [];
    for (const id of hard)
      for (const s of ARP_STYLES) {
        const r = risesInRoom(presetById(id)!.params, at(s), (p) => rackForPlay(SOUND_DEFAULT, p));
        if (share(r) < 0.9) low.push(`${id} ${s.id}: ${Math.round(share(r) * 100)}%`);
      }
    expect(low).toEqual([]);
  }, 60000);
  it("(the track's room at its full Reverb is what lost them: Bounce's soft step after its loud one)", () => {
    const bounce = at(ARP_STYLES.find((s) => s.id === "bounce")!);
    const full = risesInRoom(presetById("synth-brass")!.params, bounce, () => SOUND_DEFAULT, 4);
    expect(share(full)).toBeLessThan(0.9);
    expect(share(risesInRoom(presetById("synth-brass")!.params, bounce, (p) => rackForPlay(SOUND_DEFAULT, p), 4))).toBeGreaterThanOrEqual(0.9);
  });
});

describe("why it was not heard, and what is left as it was", () => {
  const pad = presetById("warm-pad")!.params;
  it("the same steps not marked as steps (how they used to reach the synth) blur into the pad held", () => {
    const play = withSpeed(arp, "1/16");
    const out = playNotes(chords(90), play, { bpm: 90, origin: START, seed: 11, bar: 4 });
    const { L, R } = renderNotes({ ...pad, play: DEFAULT_PLAY }, out, { sampleRate: SR, seconds: 6, seed: 7 });
    const hits = out.filter((n, i) => n.start > START + 0.02 && out.findIndex((m) => m.start === n.start) === i).map((n) => ({ t: n.start, step: 60 / 90 / 4 }));
    expect(share(onsetRises(L, R, SR, hits))).toBeLessThan(0.2);
    expect(share(rises(pad, play, 90))).toBeGreaterThanOrEqual(0.9);
  });
  it("a held chord on the pad still swells in slowly and rings on, as the sound was made", () => {
    const held = playNotes(chords(90).slice(0, 4), { ...DEFAULT_PLAY }, { bpm: 90, origin: START });
    const { L } = renderNotes({ ...pad, play: DEFAULT_PLAY }, held, { sampleRate: SR, seconds: 4.5, seed: 7 });
    const at = (t: number) => rms(L, (START + t) * SR, (START + t + 0.05) * SR);
    // still well under its full level a tenth of a second in, as before
    expect(20 * Math.log10(at(0.1) / at(1.6))).toBeLessThan(-12);
    // and its release rings on long after the chord ends (2.67 s)
    expect(20 * Math.log10(at(3.2) / at(1.6))).toBeGreaterThan(-20);
  });
  it("a mono bass with a slide plays every arp step at its own pitch, struck afresh (no slide between steps)", () => {
    const bass = presetById("rubber-bass")!.params;
    const notes: PlayNote[] = [36, 43, 48].map((midi) => ({ midi, start: START, length: 2.6, velocity: 0.8 }));
    const play: PlaySettings = { ...arp, rate: "1/8", gate: 0.8 };
    const out: SynthNote[] = withSteps(playNotes(notes, play, { bpm: 90, origin: START }), play, 90);
    const { L, R } = renderNotes({ ...bass, play }, out, { sampleRate: 48000, seconds: 3, seed: 7 });
    for (const n of out.slice(1, 6)) {
      const hz = 440 * Math.pow(2, (n.midi - 69) / 12);
      // a third of the way into the step (a slide of 45 ms would still be on its way)
      expect(Math.abs(cents(hz, partialHz(L, 48000, hz, (n.start + 0.02) * 48000, 0.08)))).toBeLessThan(25);
    }
    const hits = out.slice(1).map((n) => ({ t: n.start, step: n.step! }));
    expect(share(onsetRises(L, R, 48000, hits))).toBeGreaterThanOrEqual(0.9);
  });
});
