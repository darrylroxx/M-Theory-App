/**
 * Development only: the synth panel on a page of its own, playing through the real worklet, and
 * the hooks the browser check uses (window.synthCheck). Open /src/synth/demo.html on the dev
 * server; nothing in the app imports this, so it is not part of the build.
 */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SynthPanel } from "../ui/components/SynthPanel";
import "../ui/styles.css";
import { SynthInstrument, renderSynth } from "./instrument";
import { allFinite, cents, loudness, partialHz } from "./measure";
import type { SynthParams } from "./params";
import { PRESETS, presetById } from "./presets";
import { referenceNotes, renderNotes } from "./render";

let ctx: AudioContext | null = null;
let inst: SynthInstrument | null = null;
/** hand the panel a sound from outside, as a track switch would (for the browser check) */
let setOutside: ((p: SynthParams) => void) | null = null;

function Demo() {
  const compact = new URLSearchParams(location.search).has("compact");
  const [params, setParams] = useState<SynthParams>(presetById("warm-pad")!.params);
  const latest = useRef(params);
  latest.current = params;
  setOutside = setParams;
  useEffect(() => {
    inst?.set(params);
  }, [params]);
  const audition = async () => {
    if (!ctx) ctx = new AudioContext();
    await ctx.resume();
    if (!inst) {
      inst = new SynthInstrument(ctx, latest.current);
      inst.output.connect(ctx.destination);
      await inst.load();
    }
    // the sound may have just changed: play once it has been handed over
    queueMicrotask(() => {
      if (!inst || !ctx) return;
      inst.set(latest.current);
      const cat = presetById(latest.current.preset)?.category ?? "pad";
      const at = ctx.currentTime + 0.05;
      const notes = referenceNotes(latest.current, cat).filter((n) => n.start < 3);
      inst.stopAll(at);
      for (const n of notes) inst.play(n.midi, at + n.start, n.velocity, Math.min(n.length, 3), n.slot);
    });
  };
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto" }}>
      <SynthPanel params={params} onChange={setParams} onAudition={audition} compact={compact} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);

/** For the browser check: render through the real worklet in an OfflineAudioContext and measure. */
const synthCheck = {
  ids: () => PRESETS.map((p) => p.id),
  /** give the panel another sound, as if another track were selected */
  setSound: (id: string) => setOutside?.(presetById(id)!.params),
  /** a preset playing its reference phrase: level, peak, NaN, and whether the worklet matched the kernel sample for sample */
  async preset(id: string) {
    const p = presetById(id)!;
    const notes = referenceNotes(p.params, p.category);
    const buf = await renderSynth(p.params, notes, { sampleRate: 48000 });
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const m = loudness(L, R, buf.sampleRate);
    const ref = renderNotes(p.params, notes, { sampleRate: 48000, seconds: buf.length / 48000, seed: 1 });
    let diff = 0;
    for (let i = 0; i < L.length; i++) diff = Math.max(diff, Math.abs(L[i] - ref.L[i]), Math.abs(R[i] - ref.R[i]));
    let silent = 0;
    for (let i = 0; i < L.length; i += 4800) {
      let e = 0;
      for (let j = i; j < Math.min(L.length, i + 4800); j++) e = Math.max(e, Math.abs(L[j]));
      if (e < 1e-6) silent++;
    }
    return { id, seconds: buf.duration, lufs: m.momentaryMax, peak: m.peak, finite: allFinite(L) && allFinite(R), diffFromKernel: diff, silentTenths: silent };
  },
  /** one note held on a plain sound of each oscillator type: is it in tune? */
  async pitch(osc: string, midi: number) {
    const p = presetById(`init-${osc}`)!.params;
    // no drift, LFO, effects or stereo widening (its moving copy would bend the measured pitch)
    const plain: SynthParams = { ...p, drift: 0, lfoDest: "off", fx: "off", reverb: 0, width: 0, cutoff: 1, texture: osc === "sync" ? 0.3 : 0 };
    const buf = await renderSynth(plain, [{ midi, start: 0, length: 1.5, velocity: 0.8 }], { sampleRate: 48000, seconds: 1.6 });
    const L = buf.getChannelData(0);
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const got = partialHz(L, 48000, f, 9600, 0.5);
    return { osc, midi, hz: got, cents: cents(f, got) };
  },
  /** the live path: a real AudioContext, a chord played ahead of time, an analyser on the output */
  async live(id: string) {
    const c = new AudioContext();
    await c.resume();
    const s = new SynthInstrument(c, presetById(id)!.params);
    const tap = c.createAnalyser();
    tap.fftSize = 2048;
    s.output.connect(tap);
    s.output.connect(c.destination);
    await s.load();
    const t = c.currentTime + 0.1;
    for (const m of [48, 55, 64]) s.play(m, t, 0.8, 0.8);
    const level = async (at: number) => {
      while (c.currentTime < at) await new Promise((r) => setTimeout(r, 20));
      const buf = new Float32Array(2048);
      tap.getFloatTimeDomainData(buf);
      let e = 0;
      for (const x of buf) e += x * x;
      return Math.sqrt(e / buf.length);
    };
    const before = await level(t - 0.05);
    const during = await level(t + 0.5);
    s.stopAll();
    const after = await level(c.currentTime + 2.5);
    s.dispose();
    await c.close();
    return { before, during, after };
  },
};
(window as unknown as { synthCheck: typeof synthCheck }).synthCheck = synthCheck;
