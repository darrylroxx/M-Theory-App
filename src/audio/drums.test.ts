import { describe, expect, it } from "vitest";
import { BEAT_GROUPS, BEAT_LIBRARY, DEFAULT_BEAT, ECHO_TIMES, MAX_BARS, barsOf, beatHitsBetween, chordRounds, copyBar, grooveOf, lenOf, removeBar, reviveGroove, setBars, FX_DEFAULTS, BUILTIN_KITS, NOISE_BEDS, VERBS, VIBES, knownVoice, oldGrit, applyKit, applyPattern, applyUserKit, barBeats, beatHits, clearBeat, fxOf, kitFrom, levelAt, reviveBeat, reviveUserKits, setStep, soundOf, stepBeat, varyBeat, vibeOf, voiceOf } from "./beats";
import { softCeiling } from "./drumbus";
import { isSatType } from "./saturation";
import { DRUM_IDS, KITS, SAMPLERS, VARIANTS, defaultParams, drumRng, renderDrum, renderNoiseBed, renderSpace } from "./drums";
import { ALL_RECIPES, RECIPES } from "./voices";
import { GM_DRUM, progressionToMidi } from "./midi";

const SR = 44100;
const rms = (d: Float32Array, from = 0, to = d.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
/** loudest 40 ms of a sound */
const loudest = (d: Float32Array) => {
  const win = Math.floor(SR * 0.04);
  let best = 0;
  for (let s = 0; s < d.length; s += win >> 2) best = Math.max(best, rms(d, s, Math.min(d.length, s + win)) * Math.sqrt(Math.min(win, d.length - s) / win));
  return best;
};
const peakOf = (d: Float32Array) => d.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
/** share of the energy above a frequency (one-pole split, good enough to compare two sounds) */
const brightness = (d: Float32Array, hz = 3000) => {
  const a = Math.exp((-2 * Math.PI * hz) / SR);
  let lp = 0, hi = 0, all = 0;
  for (const x of d) {
    lp = a * lp + (1 - a) * x;
    hi += (x - lp) * (x - lp);
    all += x * x;
  }
  return hi / all;
};
/** rough pitch: zero crossings per second / 2 */
const pitch = (d: Float32Array, from: number, to: number) => {
  let z = 0;
  for (let i = from + 1; i < to; i++) if (d[i - 1] < 0 !== d[i] < 0) z++;
  return (z / 2 / (to - from)) * SR;
};

describe("drum sounds", () => {
  it("every kit renders every drum: audible, finite, never clipping", () => {
    for (const kit of KITS)
      for (const id of DRUM_IDS) {
        const d = renderDrum(SR, kit.id, id);
        expect(d.length, `${kit.id} ${id}`).toBeGreaterThan(SR * 0.02);
        let peak = 0;
        for (const x of d) {
          expect(Number.isFinite(x)).toBe(true);
          peak = Math.max(peak, Math.abs(x));
        }
        expect(peak, `${kit.id} ${id}`).toBeGreaterThan(0.2);
        expect(peak).toBeLessThanOrEqual(1);
        expect(Math.abs(d[d.length - 1])).toBeLessThan(0.01); // ends in silence (no click)
      }
  });

  it("is deterministic", () => {
    expect(Array.from(renderDrum(SR, "808", "snare").slice(0, 500))).toEqual(Array.from(renderDrum(SR, "808", "snare").slice(0, 500)));
    const a = drumRng(5), b = drumRng(5);
    expect(a()).toBe(b());
  });

  it("kicks are low, hats are high", () => {
    for (const kit of KITS) {
      const k = renderDrum(SR, kit.id, "kick", { tone: 0 });
      expect(pitch(k, Math.floor(SR * 0.05), Math.floor(SR * 0.11)), `${kit.id} kick`).toBeLessThan(160);
      const h = renderDrum(SR, kit.id, "hat");
      expect(pitch(h, 0, Math.floor(SR * 0.02)), `${kit.id} hat`).toBeGreaterThan(3000);
    }
  });

  it("the 808 kick booms longer than the vintage box thud", () => {
    expect(renderDrum(SR, "808", "kick").length).toBeGreaterThan(renderDrum(SR, "box", "kick").length * 2);
  });

  it("decay makes a sound longer, tune makes it higher", () => {
    for (const id of DRUM_IDS) expect(renderDrum(SR, "808", id, { decay: 1 }).length, id).toBeGreaterThan(renderDrum(SR, "808", id, { decay: 0 }).length);
    const win = [Math.floor(SR * 0.06), Math.floor(SR * 0.14)] as const;
    const lo = pitch(renderDrum(SR, "808", "tom", { tune: -7, tone: 0 }), ...win);
    const hi = pitch(renderDrum(SR, "808", "tom", { tune: 7, tone: 0 }), ...win);
    expect(hi / lo).toBeGreaterThan(1.8);
    expect(hi / lo).toBeLessThan(2.7);
  });

  it("open hat rings on after the closed hat has gone", () => {
    const at = Math.floor(SR * 0.2);
    expect(rms(renderDrum(SR, "808", "open"), at, at + 2000)).toBeGreaterThan(0.004);
    expect(renderDrum(SR, "808", "hat").length).toBeLessThan(at);
  });

  it("the lo-fi kit is 8-bit", () => {
    const d = renderDrum(SR, "lofi", "snare");
    const levels = new Set(Array.from(d.slice(0, Math.floor(d.length * 0.8)), (x) => Math.round(x * 1e4)));
    expect(levels.size).toBeLessThanOrEqual(260);
  });
});

describe("sound design", () => {
  it("there are eight machines, each with a name for every drum", () => {
    expect(KITS.map((k) => k.id)).toEqual(["box", "808", "909", "707", "linn", "volca", "lofi", "mod"]);
    for (const k of KITS) for (const id of DRUM_IDS) expect(k.names[id], `${k.id} ${id}`).toBeTruthy();
  });

  it("every machine's version of a drum is equally loud, so swapping voices keeps the mix", () => {
    for (const id of DRUM_IDS) {
      const levels = KITS.map((k) => loudest(renderDrum(SR, k.id, id)));
      expect(Math.max(...levels) / Math.min(...levels), id).toBeLessThan(1.35);
    }
    // and the kick is the loudest thing in the kit
    for (const id of DRUM_IDS) if (id !== "kick") expect(loudest(renderDrum(SR, "808", "kick"))).toBeGreaterThan(loudest(renderDrum(SR, "808", id)));
  });

  it("the machines really sound different", () => {
    for (const id of DRUM_IDS) {
      const all = KITS.map((k) => renderDrum(SR, k.id, id));
      for (let a = 0; a < all.length; a++)
        for (let b = a + 1; b < all.length; b++) {
          let diff = 0;
          for (let i = 0; i < 2000; i++) diff += Math.abs((all[a][i] ?? 0) - (all[b][i] ?? 0));
          expect(diff, `${id}: ${KITS[a].id} vs ${KITS[b].id}`).toBeGreaterThan(5);
        }
    }
  });

  it("punch sweeps the kick's pitch harder", () => {
    const early = [0, Math.floor(SR * 0.03)] as const;
    for (const kit of ["808", "909", "volca"] as const) {
      const soft = pitch(renderDrum(SR, kit, "kick", { punch: 0, tone: 0 }), ...early);
      const hard = pitch(renderDrum(SR, kit, "kick", { punch: 1, tone: 0 }), ...early);
      expect(hard, kit).toBeGreaterThan(soft * 1.15);
    }
  });

  it("tone adds click to the kick and snap to the snare", () => {
    for (const k of KITS) {
      expect(brightness(renderDrum(SR, k.id, "kick", { tone: 1 }), 1500), `${k.id} kick`).toBeGreaterThan(brightness(renderDrum(SR, k.id, "kick", { tone: 0 }), 1500));
      expect(brightness(renderDrum(SR, k.id, "snare", { tone: 1 })), `${k.id} snare`).toBeGreaterThan(brightness(renderDrum(SR, k.id, "snare", { tone: 0 })));
    }
  });

  it("drive adds harmonics without changing the loudness", () => {
    const clean = renderDrum(SR, "808", "kick", { tone: 0 });
    const driven = renderDrum(SR, "808", "kick", { tone: 0, drive: 1 });
    // how strong is one frequency, between 0.1 and 0.35 s (where the kick's pitch has settled)
    const from = Math.floor(SR * 0.1), to = Math.floor(SR * 0.35);
    const level = (d: Float32Array, f: number) => {
      let re = 0, im = 0;
      for (let i = from; i < to; i++) {
        re += d[i] * Math.cos((2 * Math.PI * f * i) / SR);
        im += d[i] * Math.sin((2 * Math.PI * f * i) / SR);
      }
      return Math.hypot(re, im);
    };
    let f0 = 0, best = 0;
    for (let f = 44; f < 56; f += 0.2) if (level(clean, f) > best) [best, f0] = [level(clean, f), f];
    const third = (d: Float32Array) => level(d, 3 * f0) / level(d, f0);
    expect(third(clean)).toBeLessThan(0.05);
    expect(third(driven)).toBeGreaterThan(0.12);
    // loudness held over the length of a hit, which is what the ear judges for a long kick
    const sec = (d: Float32Array) => rms(d, 0, Math.min(SR, d.length)) * Math.sqrt(Math.min(SR, d.length) / SR);
    expect(sec(driven) / sec(clean)).toBeGreaterThan(0.8);
    expect(sec(driven) / sec(clean)).toBeLessThan(1.25);
    expect(peakOf(driven)).toBeLessThanOrEqual(1);
  });

  it("the filter darkens to the left and thins to the right, and never clips", () => {
    const flat = renderDrum(SR, "linn", "snare");
    const dark = renderDrum(SR, "linn", "snare", { filter: -0.7 });
    const thin = renderDrum(SR, "linn", "snare", { filter: 0.7 });
    expect(brightness(dark)).toBeLessThan(brightness(flat) * 0.5);
    expect(brightness(thin)).toBeGreaterThan(brightness(flat));
    for (const id of DRUM_IDS) for (const f of [-1, -0.5, 0.5, 1]) expect(peakOf(renderDrum(SR, "909", id, { filter: f })), `${id} ${f}`).toBeLessThanOrEqual(1);
  });

  it("the extreme knob positions still give a clean sound on every machine", () => {
    for (const kit of KITS)
      for (const id of DRUM_IDS)
        for (const v of [0, 1]) {
          const d = renderDrum(SR, kit.id, id, { tune: v ? 12 : -12, decay: v, tone: v, punch: v, drive: v, filter: v ? 0.4 : -0.4 });
          const peak = peakOf(d);
          expect(Number.isFinite(peak), `${kit.id} ${id}`).toBe(true);
          expect(peak, `${kit.id} ${id}`).toBeGreaterThan(0.02);
          expect(peak, `${kit.id} ${id}`).toBeLessThanOrEqual(1);
        }
  });

  it("each drum has its own place in the mix by default", () => {
    expect(defaultParams("kick").space).toBeLessThan(defaultParams("snare").space);
    expect(defaultParams("kick").pan).toBe(0);
    expect(defaultParams("hat").pan).not.toBe(0);
    expect(soundOf({ sounds: { kick: { tune: -3 } } }, "kick")).toMatchObject({ tune: -3, decay: 0.5, drive: 0, filter: 0 });
  });

  it("a drum can borrow another machine's voice; switching kit gives it back", () => {
    let b = applyKit(DEFAULT_BEAT, "808");
    b = { ...b, voices: { snare: "linn" }, sounds: { kick: { tune: -2 } } };
    expect(voiceOf(b, "snare")).toBe("linn");
    expect(voiceOf(b, "kick")).toBe("808");
    b = applyKit(b, "909");
    expect(voiceOf(b, "snare")).toBe("909");
    expect(b.sounds.kick).toEqual({ tune: -2 }); // knob settings stay
  });

  it("effects have defaults for older beats, and vibes set them in one go", () => {
    expect(fxOf({ level: 0.5, space: 0.1, grit: 0 })).toEqual({ ...FX_DEFAULTS, level: 0.5, space: 0.1, grit: 0 });
    expect(new Set(VIBES.map((v) => v.id)).size).toBe(VIBES.length);
    expect(vibeOf(DEFAULT_BEAT)).toBeNull();
    for (const v of VIBES) {
      const b = { ...DEFAULT_BEAT, level: 0.6, human: 0.4, ...v.fx };
      expect(vibeOf(b), v.name).toBe(v.id);
      expect(b.level).toBe(0.6); // a vibe leaves the volume and feel alone
      expect(vibeOf({ ...b, tape: 0.99 })).toBeNull();
    }
  });

  it("saved kits keep machine, voices, sounds and effects", () => {
    const made = { ...applyKit(DEFAULT_BEAT, "linn"), voices: { kick: "808" as const }, sounds: { snare: { decay: 0.9, drive: 0.3 } }, tape: 0.5, echo: 0.3 };
    const kit = kitFrom(made, "kit-1", "My kit 1");
    const fresh = applyUserKit(applyPattern(DEFAULT_BEAT, BEAT_LIBRARY[5]), kit);
    expect(fresh.kit).toBe("linn");
    expect(voiceOf(fresh, "kick")).toBe("808");
    expect(soundOf(fresh, "snare").decay).toBe(0.9);
    expect(fxOf(fresh)).toMatchObject({ tape: 0.5, echo: 0.3 });
    expect(fresh.userKit).toBe("kit-1");
    expect(fresh.name).toBe(BEAT_LIBRARY[5].name); // the rhythm is untouched
    fresh.sounds.snare!.decay = 0.1;
    expect(kit.sounds.snare!.decay).toBe(0.9); // the saved kit is a copy
    expect(reviveUserKits([kit, null, { id: 3 }, { id: "x", name: "Old", sounds: {} }])).toHaveLength(2);
    expect(reviveUserKits("nope")).toEqual([]);
  });

  it("the library: about a hundred sounds, every drum with plenty to choose from", () => {
    expect(ALL_RECIPES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(ALL_RECIPES.map((r) => r.id)).size).toBe(ALL_RECIPES.length);
    for (const id of DRUM_IDS) {
      expect(RECIPES[id].length, id).toBeGreaterThanOrEqual(10);
      expect(new Set(RECIPES[id].map((r) => r.name)).size, id).toBe(RECIPES[id].length);
      for (const r of RECIPES[id]) expect(r.id.startsWith(id + "."), r.id).toBe(true);
    }
  });

  it("every library sound renders cleanly, even with every knob at an extreme", () => {
    for (const id of DRUM_IDS)
      for (const r of RECIPES[id])
        for (const p of [{}, { tune: -12, decay: 0, tone: 0, punch: 0, drive: 0, filter: -0.5 }, { tune: 12, decay: 1, tone: 1, punch: 1, drive: 1, filter: 0.5 }]) {
          const d = renderDrum(SR, r.id, id, p);
          const peak = peakOf(d);
          expect(Number.isFinite(peak), r.id).toBe(true);
          expect(peak, `${r.id} ${JSON.stringify(p)}`).toBeGreaterThan(0.005); // a hat through a dark filter is quiet, but there
          expect(peak, r.id).toBeLessThanOrEqual(1);
          expect(Math.abs(d[d.length - 1]), r.id).toBeLessThan(0.01);
        }
  }, 120000);

  it("library sounds sit at the same loudness as the machines", () => {
    for (const id of DRUM_IDS) {
      const ref = loudest(renderDrum(SR, "808", id));
      for (const r of RECIPES[id]) {
        const l = loudest(renderDrum(SR, r.id, id));
        // a few sounds are all spikes and cannot reach the level without clipping; none is louder
        expect(l / ref, r.id).toBeLessThan(1.35);
        expect(l / ref, r.id).toBeGreaterThan(0.25);
      }
    }
  }, 60000);

  it("round robin: each take is a little different, never a different sound", () => {
    for (const v of ["kick.909", "snare.acoustic", "hat.808", "808"]) {
      const id = v === "808" ? "snare" : (v.split(".")[0] as (typeof DRUM_IDS)[number]);
      const takes = Array.from({ length: VARIANTS }, (_, i) => renderDrum(SR, v, id, {}, { variant: i }));
      for (let i = 1; i < takes.length; i++) {
        let diff = 0;
        for (let k = 0; k < Math.min(4000, takes[0].length, takes[i].length); k++) diff += Math.abs(takes[i][k] - takes[0][k]);
        expect(diff, v).toBeGreaterThan(0.5);
        expect(loudest(takes[i]) / loudest(takes[0]), v).toBeGreaterThan(0.8);
        expect(loudest(takes[i]) / loudest(takes[0]), v).toBeLessThan(1.25);
      }
    }
  });

  it("sampler modes: fewer levels, held samples, same loudness", () => {
    const clean = renderDrum(SR, "snare.acoustic", "snare");
    for (const smp of SAMPLERS.filter((x) => x.id !== "off")) {
      const d = renderDrum(SR, "snare.acoustic", "snare", {}, { sampler: smp.id });
      expect(peakOf(d), smp.id).toBeLessThanOrEqual(1);
      expect(loudest(d) / loudest(clean), smp.id).toBeGreaterThan(0.7);
      expect(loudest(d) / loudest(clean), smp.id).toBeLessThan(1.3);
      expect(Array.from(d).some((x, i) => x !== clean[i]), smp.id).toBe(true);
    }
    // the toy sampler holds each value for about five samples at 48 kHz
    const toy = renderDrum(SR, "snare.acoustic", "snare", { filter: 0 }, { sampler: "toy" });
    expect(brightness(toy, 6000)).toBeLessThan(brightness(clean, 6000));
  });

  it("built-in kits are complete, in range, and use only real sounds", () => {
    expect(BUILTIN_KITS.length).toBeGreaterThanOrEqual(15);
    expect(new Set(BUILTIN_KITS.map((k) => k.id)).size).toBe(BUILTIN_KITS.length);
    expect(new Set(BUILTIN_KITS.map((k) => k.name)).size).toBe(BUILTIN_KITS.length);
    const machines = KITS.map((k) => k.id);
    for (const k of BUILTIN_KITS) {
      expect(machines, k.name).toContain(k.kit);
      expect(Object.keys(k.voices).sort(), k.name).toEqual([...DRUM_IDS].sort());
      for (const v of Object.values(k.voices)) expect(knownVoice(v), `${k.name} ${v}`).toBe(true);
      for (const [id, snd] of Object.entries(k.sounds)) {
        expect(DRUM_IDS, k.name).toContain(id);
        for (const [key, v] of Object.entries(snd!)) {
          const [lo, hi] = key === "tune" ? [-12, 12] : key === "filter" || key === "pan" ? [-1, 1] : [0, 1];
          expect(v, `${k.name} ${id} ${key}`).toBeGreaterThanOrEqual(lo);
          expect(v, `${k.name} ${id} ${key}`).toBeLessThanOrEqual(hi);
        }
      }
      expect(Object.keys(k.fx).sort()).toEqual(Object.keys(FX_DEFAULTS).sort());
      expect(ECHO_TIMES.map((e) => e.id)).toContain(k.fx.echoTime);
      expect(VERBS.map((e) => e.id)).toContain(k.fx.verb);
      expect(SAMPLERS.map((e) => e.id)).toContain(k.fx.sampler);
      expect(NOISE_BEDS.map((e) => e.id)).toContain(k.fx.noise);
      for (const key of ["level", "space", "size", "echo", "grit", "tape", "glue", "human", "noiseAmt", "pump"] as const) expect(k.fx[key] >= 0 && k.fx[key] <= 1, `${k.name} ${key}`).toBe(true);
    }
    // no two kits are the same setup
    expect(new Set(BUILTIN_KITS.map((k) => JSON.stringify([k.voices, k.sounds, k.fx]))).size).toBe(BUILTIN_KITS.length);
  });

  it("saturation: every kit and vibe names a real colour, and old settings are moved to today's knob", () => {
    for (const k of [...BUILTIN_KITS, ...VIBES]) {
      expect(isSatType(k.fx.color), k.name).toBe(true);
      expect(k.fx.blend).toBeGreaterThan(0);
      expect(k.fx.blend).toBeLessThanOrEqual(1);
    }
    // all six colours are used somewhere, so each can be heard without touching a knob
    expect(new Set([...BUILTIN_KITS, ...VIBES].map((k) => k.fx.color)).size).toBe(6);
    expect(BUILTIN_KITS.length).toBe(24);
    // the old knob was far coarser: a tenth of a turn then is four tenths now
    expect(oldGrit(0)).toBe(0);
    expect(oldGrit(0.1)).toBeCloseTo(0.4);
    expect(oldGrit(0.5)).toBeCloseTo(0.95);
    expect(oldGrit(1)).toBe(1);
    for (let g = 0; g < 1; g += 0.05) expect(oldGrit(g + 0.05)).toBeGreaterThanOrEqual(oldGrit(g));
    // a beat saved before colours existed is moved once, and then left alone
    const { color: _c, blend: _b, ...old } = { ...DEFAULT_BEAT, grit: 0.25 };
    const moved = reviveBeat(JSON.parse(JSON.stringify(old)))!;
    expect(moved.grit).toBeCloseTo(0.67);
    expect(moved.color).toBe("tape");
    expect(reviveBeat(JSON.parse(JSON.stringify(moved)))!.grit).toBeCloseTo(0.67);
    expect(reviveBeat({ ...moved, color: "sparkle" })!.color).toBe("tape");
    const kits = reviveUserKits([{ id: "k", name: "Mine", kit: "808", sounds: {}, fx: { grit: 0.1 } }, { id: "n", name: "New", kit: "808", sounds: {}, fx: { grit: 0.1, color: "fuzz" } }]);
    expect(kits[0].fx.grit).toBeCloseTo(0.4);
    expect(kits[1].fx).toMatchObject({ grit: 0.1, color: "fuzz" });
  });

  it("every drum of every kit makes a sound, wherever in the library it was borrowed from", () => {
    for (const k of BUILTIN_KITS)
      for (const id of DRUM_IDS) {
        const d = renderDrum(SR, k.voices[id] ?? k.kit, id, k.sounds[id] ?? {});
        let peak = 0;
        for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
        expect(peak, `${k.name} ${id}`).toBeGreaterThan(0.01);
        expect(peak).toBeLessThanOrEqual(1);
      }
  });

  it("names nothing after artists", () => {
    const text = JSON.stringify([BUILTIN_KITS, KITS, VIBES, ALL_RECIPES.map((r) => r.name), BEAT_LIBRARY.map((p) => p.name)]).toLowerCase();
    for (const name of ["radiohead", "kid a", "beach house", "current joys", "florence", "boy harsher", "molchat", "her's", "joy division", "cure"]) expect(text, name).not.toContain(name);
  });

  it("a kit sets the whole sound and leaves the rhythm alone", () => {
    const rhythm = applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Motorik")!);
    for (const k of BUILTIN_KITS) {
      const b = applyUserKit(rhythm, k);
      expect(b.userKit).toBe(k.id);
      expect(b.rows).toBe(rhythm.rows);
      expect(fxOf(b)).toEqual(k.fx);
      for (const id of DRUM_IDS) expect(voiceOf(b, id)).toBe(k.voices[id]);
      // picking a plain machine afterwards lets go of the kit
      expect(applyKit(b, "808").userKit).toBeNull();
      expect(voiceOf(applyKit(b, "808"), "snare")).toBe("808");
    }
  });

  it("every reverb type: unit energy, stereo, finite; size makes it longer", () => {
    for (const v of VERBS) {
      const [l, r] = renderSpace(SR, 0.5, drumRng(2), v.id);
      let e = 0, same = 0;
      for (let i = 0; i < l.length; i++) {
        expect(Number.isFinite(l[i])).toBe(true);
        e += l[i] * l[i];
        if (l[i] === r[i]) same++;
      }
      expect(e, v.id).toBeCloseTo(1, 3);
      expect(same, v.id).toBeLessThan(l.length * 0.5);
      if (v.id !== "gated") expect(renderSpace(SR, 1, drumRng(1), v.id)[0].length, v.id).toBeGreaterThan(renderSpace(SR, 0, drumRng(1), v.id)[0].length);
    }
    // the gated room stays up, then stops dead
    const [g] = renderSpace(SR, 0.5, drumRng(3), "gated");
    const win = (from: number) => rms(g, Math.floor(from * SR), Math.floor((from + 0.03) * SR));
    expect(win(0.2) / win(0.02)).toBeGreaterThan(0.8);
    expect(win(g.length / SR - 0.03)).toBeLessThan(win(0.1) * 0.05);
    // a hall dies away
    const [h] = renderSpace(SR, 0.5, drumRng(2), "hall");
    expect(rms(h, 0, 8000)).toBeGreaterThan(rms(h, h.length - 8000, h.length) * 20);
  });

  it("noise beds loop seamlessly at the same loudness", () => {
    for (const n of NOISE_BEDS.filter((x) => x.id !== "off")) {
      const [l, r] = renderNoiseBed(SR, n.id, 2);
      expect(l.length).toBe(SR * 2);
      expect(rms(l), n.id).toBeCloseTo(0.5, 2);
      // the seam: the end runs into the start without a jump
      const jump = Math.abs(l[l.length - 1] - l[0]);
      expect(jump, n.id).toBeLessThan(0.5 * 4);
      let same = 0;
      for (let i = 0; i < l.length; i++) if (l[i] === r[i]) same++;
      if (n.id !== "hum") expect(same, n.id).toBeLessThan(l.length * 0.5);
    }
  });

  it("the output ceiling is transparent until it is needed", () => {
    const c = softCeiling();
    const at = (x: number) => c[Math.round(((x + 1) / 2) * (c.length - 1))];
    expect(at(0)).toBeCloseTo(0);
    expect(at(0.5)).toBeCloseTo(0.5, 3);
    expect(at(-0.7)).toBeCloseTo(-0.7, 3);
    expect(at(1)).toBeLessThan(0.95);
    expect(at(1)).toBeGreaterThan(at(0.9));
  });
});

describe("rhythm library", () => {
  it("has a big, well-formed library", () => {
    expect(BEAT_LIBRARY.length).toBeGreaterThanOrEqual(270);
    expect(BEAT_GROUPS.length).toBe(15);
    expect(new Set(BEAT_LIBRARY.map((p) => p.id)).size).toBe(BEAT_LIBRARY.length);
    for (const g of BEAT_GROUPS) expect(BEAT_LIBRARY.filter((p) => p.group === g.id).length, g.name).toBeGreaterThanOrEqual(14);
    for (const p of BEAT_LIBRARY) {
      expect(Number.isInteger(barBeats(p)), p.name).toBe(true);
      expect(p.bpm).toBeGreaterThanOrEqual(40);
      expect(p.bpm).toBeLessThanOrEqual(200);
      let hits = 0;
      for (const id of DRUM_IDS) {
        expect(p.rows[id], `${p.name} ${id}`).toMatch(new RegExp(`^[0-3]{${p.steps * (p.bars ?? 1)}}$`));
        hits += p.rows[id].replace(/0/g, "").length;
      }
      expect(hits, p.name).toBeGreaterThanOrEqual(3);
    }
  });

  it("covers the styles songwriters ask for, with longer rhythms and odd metres among them", () => {
    const names = BEAT_GROUPS.map((g) => g.name.toLowerCase()).join(" | ");
    for (const want of ["pop", "rock", "indie", "alternative", "dark wave", "electronic", "hip hop", "funk", "jazz", "punk", "latin"]) expect(names, want).toContain(want);
    // two-bar rhythms: a fill, or a second bar that answers the first
    const long = BEAT_LIBRARY.filter((p) => (p.bars ?? 1) > 1);
    expect(long.length).toBeGreaterThanOrEqual(12);
    for (const p of long) expect(DRUM_IDS.map((id) => p.rows[id].slice(0, p.steps)).join(), p.name).not.toBe(DRUM_IDS.map((id) => p.rows[id].slice(p.steps)).join());
    // metres: 4/4, 3/4, 5/4, 6/8, 12/8 and the swung 3/4 and 5/4 of jazz
    const metres = new Set(BEAT_LIBRARY.map((p) => `${p.steps}/${p.div}`));
    for (const m of ["16/4", "12/4", "20/4", "6/3", "12/3", "9/3", "15/3"]) expect(metres.has(m), m).toBe(true);
    // a library rhythm with several bars loads whole
    const fill = BEAT_LIBRARY.find((p) => p.name === "Rock with a fill")!;
    const b = applyPattern(DEFAULT_BEAT, fill);
    expect(barsOf(b)).toBe(2);
    expect(lenOf(b)).toBe(32);
    expect(levelAt(b.rows, "snare", 31)).toBeGreaterThan(0);
  });

  it("a new idea still starts with the slow heartbeat, and old ideas still find their rhythms", () => {
    expect(DEFAULT_BEAT.name).toBe("Heartbeat");
    expect(DEFAULT_BEAT.patternId).toBe("dream-heartbeat");
    // ids saved in older ideas
    for (const id of ["dream-heartbeat", "indie-motorik", "dark-cold-disco", "box-bossa-nova", "808-boom-bap", "rock-backbeat", "slow-12-8-ballad", "world-one-drop"]) expect(BEAT_LIBRARY.some((p) => p.id === id), id).toBe(true);
  });

  it("almost every rhythm is one of a kind across the whole library", () => {
    const sigs = BEAT_LIBRARY.map((p) => JSON.stringify([p.steps, p.div, p.bars ?? 1, p.rows]));
    // a few standards rightly live in two places (a disco beat is also the organ's Disco button)
    expect(sigs.length - new Set(sigs).size).toBeLessThanOrEqual(4);
  });

  it("every rhythm has a pulse: something on the first beat or a deliberate hole there, and never a wall of noise", () => {
    for (const p of BEAT_LIBRARY) {
      const len = p.steps * (p.bars ?? 1);
      let filled = 0;
      for (let i = 0; i < len; i++) if (DRUM_IDS.some((id) => p.rows[id][i] !== "0")) filled++;
      expect(filled / len, p.name).toBeGreaterThan(0.12);
      // no more than five drums at once
      for (let i = 0; i < len; i++) expect(DRUM_IDS.filter((id) => p.rows[id][i] !== "0").length, `${p.name} step ${i}`).toBeLessThanOrEqual(5);
    }
  });

  it("no two rhythms in a style are identical", () => {
    for (const g of BEAT_GROUPS) {
      const sigs = BEAT_LIBRARY.filter((p) => p.group === g.id).map((p) => JSON.stringify([p.steps, p.div, p.bars ?? 1, p.swing, p.rows]));
      expect(new Set(sigs).size, g.name).toBe(sigs.length);
    }
  });

  it("editing steps", () => {
    let b = applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Motorik")!);
    expect(b.on).toBe(true);
    expect(b.edited).toBe(false);
    expect(levelAt(b.rows, "kick", 0)).toBe(2);
    b = setStep(b, "kick", 0, 0);
    expect(levelAt(b.rows, "kick", 0)).toBe(0);
    expect(b.edited).toBe(true);
    b = setStep(b, "bell", 3, 3);
    expect(b.rows.bell).toBe("0003000000000000");
    expect(setStep(b, "bell", 3, 3)).toBe(b); // no change, same object
    expect(setStep(b, "bell", 99, 2)).toBe(b);
    expect(Object.values(clearBeat(b).rows).join("")).toMatch(/^0+$/);
    expect(BEAT_LIBRARY.find((p) => p.name === "Motorik")!.rows.kick[0]).toBe("2"); // library untouched
  });

  it("vary changes a little, not everything", () => {
    const base = applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Backbeat")!);
    for (let seed = 1; seed < 30; seed++) {
      const v = varyBeat(base, drumRng(seed));
      let diff = 0;
      for (const id of DRUM_IDS) for (let i = 0; i < base.steps; i++) if (v.rows[id][i] !== base.rows[id][i]) diff++;
      expect(diff).toBeGreaterThanOrEqual(1);
      expect(diff).toBeLessThanOrEqual(6);
      expect(levelAt(v.rows, "kick", 0)).toBe(2); // the downbeat survives
    }
  });

  it("swing delays every second 16th, up to a triplet", () => {
    expect(stepBeat(1, 4, 0)).toBeCloseTo(0.25);
    expect(stepBeat(1, 4, 1)).toBeCloseTo(1 / 3);
    expect(stepBeat(2, 4, 1)).toBeCloseTo(0.5);
    expect(stepBeat(1, 3, 1)).toBeCloseTo(1 / 3); // triplet grids are not swung
  });

  it("lists hits across bars", () => {
    const b = applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Backbeat")!);
    const hits = beatHits(b, 8);
    expect(hits.filter((h) => h.id === "kick").map((h) => h.beat)).toEqual([0, 2, 4, 6]);
    expect(hits.filter((h) => h.id === "snare").map((h) => h.beat)).toEqual([1, 3, 5, 7]);
    expect(beatHits({ ...b, mutes: ["kick"] }, 8).some((h) => h.id === "kick")).toBe(false);
    const waltz = applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Waltz")!);
    expect(barBeats(waltz)).toBe(3);
    expect(beatHits(waltz, 6).filter((h) => h.id === "kick").map((h) => h.beat)).toEqual([0, 3]);
  });

  it("revives stored beats safely", () => {
    expect(reviveBeat(undefined)).toBeUndefined();
    expect(reviveBeat({ steps: 16 })).toBeUndefined();
    const r = reviveBeat({ steps: 16, div: 4, rows: { kick: "2xx2" }, on: true })!;
    expect(r.rows.kick).toBe("2002000000000000");
    expect(r.rows.snare).toHaveLength(16);
    expect(r.kit).toBe("box");
    expect(r.voices).toEqual({});
    expect(reviveBeat({ steps: 16, div: 4, rows: {}, kit: "nonsense" })!.kit).toBe("box");
    expect(reviveBeat({ steps: 16, div: 4, rows: {}, kit: "909", voices: { hat: "linn" }, tape: 0.4 })).toMatchObject({ kit: "909", voices: { hat: "linn" }, tape: 0.4 });
  });
});

describe("MIDI with drums", () => {
  const items = [{ midi: [40, 47, 52, 56, 59, 64], beats: 4 }, { midi: [45, 52, 57, 61, 64, null], beats: 4 }];
  const count = (bytes: Uint8Array, status: number, note: number) => {
    let n = 0;
    for (let i = 0; i < bytes.length - 2; i++) if (bytes[i] === status && bytes[i + 1] === note && bytes[i + 2] > 0 && bytes[i + 2] < 128) n++;
    return n;
  };

  it("adds a drum track on channel 10", () => {
    const beat = applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Backbeat")!);
    const plain = progressionToMidi(items, 100, "ring", "t");
    const withDrums = progressionToMidi(items, 100, "ring", "t", beat);
    expect(plain[9]).toBe(0); // format 0, one track
    expect([withDrums[9], withDrums[11]]).toEqual([1, 2]); // format 1, two tracks
    expect(count(withDrums, 0x99, GM_DRUM.kick)).toBe(4);
    expect(count(withDrums, 0x99, GM_DRUM.snare)).toBe(4);
    expect(count(withDrums, 0x99, GM_DRUM.hat)).toBe(16);
    // a beat that is switched off is left out
    expect(progressionToMidi(items, 100, "ring", "t", { ...beat, on: false })).toEqual(plain);
  });

  it("exports four bars of the beat when there are no chords", () => {
    const beat = applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Backbeat")!);
    expect(count(progressionToMidi([], 100, "ring", "t", beat), 0x99, GM_DRUM.kick)).toBe(8);
  });
});

describe("bars", () => {
  const base = () => applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Backbeat")!);
  it("extends a pattern with copies of the last bar, and shortens it again", () => {
    const two = setBars(base(), 2);
    expect(barsOf(two)).toBe(2);
    expect(lenOf(two)).toBe(32);
    expect(two.rows.snare).toBe(base().rows.snare.repeat(2));
    expect(two.edited).toBe(true);
    expect(setBars(two, 1).rows.snare).toBe(base().rows.snare);
    expect(barsOf(setBars(base(), 99))).toBe(MAX_BARS);
    expect(setBars(base(), 1)).toEqual(base());
  });
  it("removes, copies and clears single bars", () => {
    let b = setStep(setBars(base(), 3), "tom", 16 + 15, 3); // a fill at the end of bar 2
    expect(b.rows.tom.slice(16, 32)).toBe("0000000000000003");
    b = copyBar(b, 1, 2);
    expect(b.rows.tom.slice(32)).toBe("0000000000000003");
    b = clearBeat(b, 0);
    expect(b.rows.kick.slice(0, 16)).toBe("0".repeat(16));
    expect(b.rows.kick.slice(16, 32)).toBe(base().rows.kick);
    b = removeBar(b, 0);
    expect(barsOf(b)).toBe(2);
    expect(b.rows.tom).toBe("0000000000000003".repeat(2));
    expect(removeBar(setBars(base(), 1), 0).rows).toEqual(base().rows); // the last bar stays
  });
  it("hits run across all bars, and a range can start mid-pattern", () => {
    const b = setStep(setBars(base(), 2), "bell", 20, 2); // bar 2, beat 2
    const hits = beatHits(b, 16);
    expect(hits.filter((h) => h.id === "bell").map((h) => h.beat)).toEqual([5, 13]);
    expect(beatHitsBetween(b, 4, 8).filter((h) => h.id === "bell").map((h) => h.beat)).toEqual([5]);
    expect(beatHitsBetween(b, 0, 4).some((h) => h.id === "bell")).toBe(false);
  });
  it("vary only touches the bar on screen", () => {
    const b = setBars(base(), 2);
    for (let seed = 1; seed < 20; seed++) {
      const v = varyBeat(b, drumRng(seed), 1);
      for (const id of DRUM_IDS) expect(v.rows[id].slice(0, 16)).toBe(b.rows[id].slice(0, 16));
    }
  });
  it("a section plays its chords again until a longer beat has finished", () => {
    const four = { ...setBars(base(), 4), on: true };
    expect(chordRounds(8, four)).toBe(2);
    expect(chordRounds(16, four)).toBe(1);
    expect(chordRounds(12, four)).toBe(2);
    expect(chordRounds(8, { ...four, on: false })).toBe(1);
    expect(chordRounds(0, four)).toBe(1);
  });
  it("sections keep their rhythm through storage", () => {
    const g = grooveOf(setBars(base(), 3));
    expect(reviveGroove(JSON.parse(JSON.stringify(g)))).toEqual(g);
    expect(reviveGroove({ steps: 16, div: 4, bars: 2, rows: { kick: "2" } })!.rows.kick).toHaveLength(32);
    expect(reviveGroove({ steps: 0 })).toBeUndefined();
    expect(reviveBeat({ ...base(), bars: 40 })!.bars).toBe(MAX_BARS);
  });
});

describe("MIDI with song sections", () => {
  it("each section exports its own rhythm, starting from its first bar", () => {
    const a = { ...applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Backbeat")!), on: true };
    const b = { ...applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.name === "Four on the floor")!), on: true };
    const chordA = { midi: [40, 47, 52, 56, 59, 64], beats: 4 };
    const bytes = progressionToMidi([{ ...chordA, drums: a, section: true }, { ...chordA, drums: b, section: true }], 100, "ring", "t", a);
    let kicks = 0;
    for (let i = 0; i < bytes.length - 2; i++) if (bytes[i] === 0x99 && bytes[i + 1] === GM_DRUM.kick && bytes[i + 2] > 0) kicks++;
    expect(kicks).toBe(2 + 4); // Backbeat: 2 kicks a bar; four on the floor: 4
  });
});
