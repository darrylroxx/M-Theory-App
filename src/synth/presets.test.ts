import { describe, expect, it } from "vitest";
import { allFinite, loudness } from "./measure";
import { OSC_TYPES, reviveSynth } from "./params";
import { CATEGORIES, PRESETS, presetById, presetsIn } from "./presets";
import { referenceNotes, renderNotes } from "./render";

/**
 * Level matching: every preset is rendered playing a phrase that suits its kind (a bass line, a
 * melody, a held chord, see referencePhrase in render.ts) the way it suggests (its play mode),
 * and its loudest 400 ms (BS.1770 momentary loudness) is measured. Each preset's `trim` was set
 * so that this lands at −20 LUFS, unless that would push the phrase's peak past 0.6 (a few very
 * short plucks, which then sit a little lower). To re-measure after changing a recipe, set each
 * trim to target − measured + current.
 */
const TARGET = -20;

describe("presets", () => {
  it("there are at least forty, in every kind a beginner looks for, plus a plain start for each oscillator", () => {
    const named = PRESETS.filter((p) => p.category !== "init");
    expect(named.length).toBeGreaterThanOrEqual(40);
    for (const c of CATEGORIES) {
      const n = presetsIn(c.id).length;
      if (c.id === "init") expect(n).toBe(OSC_TYPES.length);
      else expect(n, c.name).toBeGreaterThanOrEqual(3);
    }
    for (const o of OSC_TYPES) expect(presetsIn("init").some((p) => p.params.osc === o)).toBe(true);
    // drones and keys that this synth does well
    expect(presetsIn("drone").every((p) => p.params.play.mode === "drone" && p.params.attack > 0.5)).toBe(true);
    expect(presetsIn("keys").some((p) => p.params.osc === "fm")).toBe(true);
    expect(presetsIn("keys").some((p) => /organ/i.test(p.name))).toBe(true);
    expect(presetsIn("arp").every((p) => p.params.play.mode === "arp")).toBe(true);
  });

  it("have unique ids and names, a hint each, and plain names (no players, records or products)", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(PRESETS.length);
    const banned = /reface|yamaha|roland|moog|korg|juno|jupiter|prophet|oberheim|arp\s?2600|odyssey|dx-?7|jp-?8000|tb-?303|303|808|rhodes|wurli|clavinet|hammond|mellotron|minimoog|nord|sequential|serum|vital|massive/i;
    for (const p of PRESETS) {
      expect(p.hint.length).toBeGreaterThan(5);
      expect(banned.test(p.name) || banned.test(p.hint), p.name).toBe(false);
      expect(p.params.preset).toBe(p.id);
      expect(presetById(p.id)).toBe(p);
    }
  });

  it("are whole sounds: reviving one changes nothing", () => {
    for (const p of PRESETS) expect(reviveSynth(JSON.parse(JSON.stringify(p.params)))).toEqual(p.params);
  });

  it("all sit at about the same loudness, played the way they suggest", () => {
    const rows: string[] = [];
    const levels: number[] = [];
    for (const p of PRESETS) {
      const { L, R, sampleRate } = renderNotes(p.params, referenceNotes(p.params, p.category));
      const m = loudness(L, R, sampleRate);
      levels.push(m.momentaryMax);
      rows.push(`${p.id}: ${m.momentaryMax.toFixed(1)} LUFS, peak ${m.peak.toFixed(2)}`);
      expect(m.momentaryMax, rows.join("; ")).toBeGreaterThan(TARGET - 2);
      expect(m.momentaryMax, rows.join("; ")).toBeLessThan(TARGET + 1);
      expect(m.peak).toBeLessThan(0.65);
    }
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(3);
  });

  it("never clip or go wrong at full polyphony, played hard", () => {
    for (const p of PRESETS) {
      // ten notes held on an eight-voice synth (two stolen), then a quick run that keeps stealing
      const notes = [36, 43, 48, 52, 55, 60, 64, 67, 72, 76].map((m, i) => ({ midi: m, start: 0.02 * i, length: 2, velocity: 1 }));
      for (let i = 0; i < 16; i++) notes.push({ midi: 60 + ((i * 7) % 24), start: 2 + i * 0.06, length: 0.5, velocity: 1 });
      const { L, R } = renderNotes({ ...p.params, play: { ...p.params.play, mode: "sustain" } }, notes, { seconds: 4 });
      expect(allFinite(L) && allFinite(R), p.id).toBe(true);
      let peak = 0;
      let soft = 0;
      for (let i = 0; i < L.length; i++) {
        const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        peak = Math.max(peak, a);
        // above 0.7 the output's soft ceiling bends the wave: it should hardly ever need to
        if (a > 0.7) soft++;
      }
      expect(peak, p.id).toBeLessThan(1);
      expect(soft / L.length, p.id).toBeLessThan(0.005);
    }
  });
});
