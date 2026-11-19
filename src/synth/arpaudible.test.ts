/**
 * Every arp step heard as a note of its own, on every sound: the whole chain (the way of playing,
 * the steps marked for the synth, the sound as the engine gets it, the kernel) rendered offline and
 * each step's start measured. A pad played as an arp used to sound like the pad held (its slow
 * swell never arrived within a step, its long release and hall ran the steps together); now at
 * least nine steps in ten rise 6 dB or more over what came before, at 1/8 and 1/16, at 90 and
 * 140 bpm, while the same sound's held chord still swells as it was made to.
 */
import { describe, expect, it } from "vitest";
import { ARP_STYLES, withSpeed, withStyle } from "./arpstyles";
import { onsetRises, partialHz, cents, rms } from "./measure";
import { DEFAULT_PLAY, type PlaySettings, type SynthParams } from "./params";
import { type PlayNote, type SynthNote, playNotes, withSteps } from "./play";
import { PRESETS, presetById } from "./presets";
import { renderNotes } from "./render";

const SR = 24000;
const START = 0.1;
/** Two bars: C major, then A minor, voiced as a chords track on the synth voices them. */
function chords(bpm: number): PlayNote[] {
  const bar = (4 * 60) / bpm;
  return [
    ...[52, 60, 64, 67].map((midi) => ({ midi, start: START, length: bar, velocity: 0.78 })),
    ...[57, 60, 64, 69].map((midi) => ({ midi, start: START + bar, length: bar, velocity: 0.78 })),
  ];
}

/** Each strike of the arp, measured: how far it rises over what came before it (dB). */
function rises(sound: SynthParams, play: PlaySettings, bpm: number, notes: PlayNote[] = chords(bpm)): number[] {
  const out = withSteps(playNotes(notes, play, { bpm, origin: START, seed: 11, bar: 4 }), play, bpm);
  const { L, R } = renderNotes({ ...sound, play }, out, { sampleRate: SR, seconds: START + (8 * 60) / bpm + 0.4, seed: 7 });
  const hits: { t: number; step: number }[] = [];
  // (the very first strike starts from silence: the ones after it are the test)
  for (const n of out) if (n.start > START + 0.02 && !hits.some((h) => Math.abs(h.t - n.start) < 1e-4)) hits.push({ t: n.start, step: n.step ?? 0 });
  return onsetRises(L, R, SR, hits);
}
const share = (r: number[]) => r.filter((x) => x >= 6).length / r.length;
const arp: PlaySettings = { ...DEFAULT_PLAY, mode: "arp" };

describe("arp steps are heard on every sound", () => {
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
  // the sounds made for holding (slow swells, long tails, big rooms, echoes, a gliding lead, a sliding bass), in every style
  const hard = ["warm-pad", "choir-pad", "wide-pad", "glass-drone", "ensemble-strings", "supersaw-lead", "rubber-bass", "fm-bell"];
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
  it("a pulse strikes the chord again, every time heard", () => {
    const low: string[] = [];
    for (const p of PRESETS) {
      const r = rises(p.params, { ...DEFAULT_PLAY, mode: "pulse", rate: "1/8", gate: 0.6 }, 120);
      if (share(r) < 0.9) low.push(`${p.id} ${Math.round(share(r) * 100)}%`);
    }
    expect(low).toEqual([]);
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
