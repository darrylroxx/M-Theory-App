/**
 * The arp's ready styles: what each one bundles, that Speed and Range keep the style, that the
 * arp of an old song (settings no style has) is shown as Custom and plays exactly as it was
 * saved, that choosing a sound keeps the arp running, and that in 6/8, 9/8 and 12/8 the styles
 * play on the meter's eighths and sixteenths.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ARP_STYLES, RANGES, SPEEDS, fitMeter, joinRate, speedName, speedOf, splitRate, styleOf, stylesFor, withRange, withSpeed, withStyle } from "./arpstyles";
import { DEFAULT_PARAMS, DEFAULT_PLAY, type PlaySettings, RATES, reviveSynth } from "./params";
import { type PlayNote, playNotes, stepSec, withSteps } from "./play";
import { PRESETS, pickPreset, presetById, presetsIn } from "./presets";
import { ArpControls } from "../ui/components/SynthPanel";

const arpPlay: PlaySettings = { ...DEFAULT_PLAY, mode: "arp" };
const chord = (midis: number[], start: number, length: number): PlayNote[] => midis.map((midi) => ({ midi, start, length, velocity: 0.8 }));
const song: PlayNote[] = [...chord([60, 64, 67], 0, 2), ...chord([57, 60, 64, 69], 2, 2)];
const ctx = { bpm: 120, origin: 0, seed: 5, bar: 4 };
/** The row of styles in the arp's markup. */
const stylesRow = (html: string) => html.slice(html.indexOf('aria-label="Arp style"'), html.indexOf("</div>", html.indexOf('aria-label="Arp style"')));
const strip = (n: { midi: number; start: number; length: number; velocity: number; slot?: number }) => ({ midi: n.midi, start: n.start, length: n.length, velocity: n.velocity, slot: n.slot });

describe("arp styles", () => {
  it("are a short row of plainly named bundles of the engine's settings", () => {
    expect(ARP_STYLES.map((s) => s.name)).toEqual(["Up", "Down", "Up & down", "Skip", "Bounce", "Shuffle", "Triplets", "Random"]);
    expect(SPEEDS.map((s) => s.value)).toEqual(["1/4", "1/8", "1/16"]);
    expect([...RANGES]).toEqual([1, 2, 3]);
    const by = Object.fromEntries(ARP_STYLES.map((s) => [s.id, withStyle(arpPlay, s)]));
    expect(by.up).toMatchObject({ mode: "arp", pattern: "up", rate: "1/16", octaves: 1, octMove: "span", gate: 0.6, swing: 0, rhythm: "", ratchet: 1 });
    expect(by.down).toMatchObject({ pattern: "down", rate: "1/16" });
    expect(by.updown).toMatchObject({ pattern: "updown" });
    expect(by.skip).toMatchObject({ pattern: "thumb", rhythm: "XxxxXxxx", gate: 0.5 });
    // Bounce climbs and comes back over at least two octaves
    expect(by.bounce).toMatchObject({ pattern: "up", octMove: "bounce", rhythm: "X.xxX.xx", octaves: 2 });
    expect(by.shuffle).toMatchObject({ pattern: "converge", swing: 0.4 });
    expect(by.triplets).toMatchObject({ pattern: "up", rate: "1/16T" });
    expect(by.random).toMatchObject({ pattern: "random", rate: "1/16" });
  });
  it("the arp as it starts (the default settings) is Up, fast, over one octave", () => {
    expect(styleOf(arpPlay)?.id).toBe("up");
    expect(speedOf(arpPlay)).toBe("1/16");
    expect(arpPlay.octaves).toBe(1);
    expect(withStyle(arpPlay, ARP_STYLES[0])).toEqual(arpPlay);
  });
  it("each style is known again at every speed and range, and no two are the same", () => {
    for (const s of ARP_STYLES)
      for (const sp of SPEEDS)
        for (const r of RANGES) {
          const p = withRange(withSpeed(withStyle(arpPlay, s), sp.value), r);
          expect(styleOf(p)?.id, `${s.id} ${sp.value} ${r}`).toBe(s.id);
          expect(speedOf(p)).toBe(sp.value);
          expect(p.octaves).toBe(r);
        }
    // and they all sound different from one another (over two octaves, where the octave movement counts)
    const two = ARP_STYLES.map((s) => JSON.stringify(playNotes(song, withRange(withStyle(arpPlay, s), 2), ctx).map((n) => [n.midi, n.start.toFixed(4)])));
    expect(new Set(two).size).toBe(ARP_STYLES.length);
  });
  it("a style keeps the speed and range chosen; speed keeps a style's feel", () => {
    const slow = withRange(withSpeed(arpPlay, "1/4"), 3);
    const t = withStyle(slow, ARP_STYLES.find((s) => s.id === "triplets")!);
    expect([t.rate, t.octaves]).toEqual(["1/4T", 3]);
    expect(withSpeed(t, "1/8").rate).toBe("1/8T");
    expect(withStyle(t, ARP_STYLES.find((s) => s.id === "down")!).rate).toBe("1/4");
    // (a dotted step of an old song keeps its dot when sped up)
    expect(withSpeed({ ...arpPlay, rate: "1/8D" }, "1/16").rate).toBe("1/16D");
    expect(splitRate("1/16T")).toEqual({ value: "1/16", feel: "T" });
    for (const r of RATES) expect(joinRate(splitRate(r).value, splitRate(r).feel)).toBe(r);
  });
  it("most Arp sounds come in one of the styles", () => {
    const named = presetsIn("arp").map((p) => [p.id, styleOf(p.params.play)?.id ?? null]);
    expect(Object.fromEntries(named)).toMatchObject({ "arp-pluck": "up", "square-arp": "updown", "bubble-arp": "random", "gallop-arp": "bounce", "lazy-arp": "shuffle", "pedal-arp": "skip" });
  });
});

describe("an old song's arp", () => {
  // settings the styles do not have: dotted or 1/32 steps, crawl and chord patterns, four octaves, a ratchet, an own rhythm
  const olds: Partial<PlaySettings>[] = [
    { pattern: "crawl", rate: "1/8", octaves: 2, gate: 0.7 },
    { pattern: "chord", rate: "1/8", octaves: 2, gate: 0.45 },
    { pattern: "diverge", rate: "1/8D", octaves: 2, octMove: "up", gate: 0.5 },
    { pattern: "up", rate: "1/8", octaves: 3, octMove: "up", gate: 0.6, ratchet: 2, rhythm: "X.x.Xxx." },
    { pattern: "played", rate: "1/32", octaves: 4, gate: 1, swing: 0.2 },
    { pattern: "pinky", rate: "1/16", octaves: 1, gate: 0.3, rhythm: "x..x" },
  ];
  it("matches no style: it is shown as Custom, with no style chosen", () => {
    for (const o of olds) {
      const p = reviveSynth(JSON.parse(JSON.stringify({ play: { ...arpPlay, ...o } }))).play;
      expect(styleOf(p), JSON.stringify(o)).toBeNull();
      const html = renderToStaticMarkup(createElement(ArpControls, { play: p, onChange: () => {} }));
      const row = stylesRow(html);
      expect(row).toContain("Custom");
      expect(row).not.toContain('aria-checked="true"');
    }
    const up = stylesRow(renderToStaticMarkup(createElement(ArpControls, { play: arpPlay, onChange: () => {} })));
    expect(up).not.toContain("Custom");
    expect(up.match(/aria-checked="true"[^>]*>([^<]+)</)?.[1]).toBe("Up");
  });
  it("plays exactly the notes it played before the styles, and the synth's step marks change none of them", () => {
    for (const o of olds)
      for (const bpm of [72, 120, 151]) {
        const saved = { ...DEFAULT_PARAMS, play: { ...arpPlay, ...o } };
        const p = reviveSynth(JSON.parse(JSON.stringify(saved))).play;
        const c = { ...ctx, bpm };
        const now = playNotes(song, p, c);
        expect(now).toEqual(playNotes(song, { ...arpPlay, ...o } as PlaySettings, c));
        // marked as steps for the synth: the same notes, at the same times, as loud and as long
        const marked = withSteps(now, p, bpm);
        expect(marked.map(strip)).toEqual(now.map(strip));
        expect(marked.every((n) => n.step === stepSec(p, bpm) && n.step > 0)).toBe(true);
      }
  });
  it("the other ways of playing are not marked at all (the synth plays them as the sound is made)", () => {
    for (const mode of ["sustain", "strum", "drone", "glide"] as const) {
      const p = { ...DEFAULT_PLAY, mode };
      expect(stepSec(p, 120)).toBe(0);
      const n = playNotes(song, p, ctx);
      expect(withSteps(n, p, 120)).toBe(n);
    }
    // a step is the time to the next strike: shorter for a swung second step or a repeat
    expect(stepSec(arpPlay, 120)).toBeCloseTo(0.125, 9);
    expect(stepSec({ ...arpPlay, ratchet: 2 }, 120)).toBeCloseTo(0.0625, 9);
    expect(stepSec({ ...arpPlay, swing: 0.375 }, 120)).toBeCloseTo(0.125 * 0.75, 9);
    expect(stepSec({ ...DEFAULT_PLAY, mode: "pulse", rate: "1/8" }, 120)).toBeCloseTo(0.25, 9);
  });
});

describe("choosing a sound", () => {
  const pad = presetById("warm-pad")!;
  const pluck = presetById("saw-pluck")!;
  const harp = presetById("harp-pluck")!;
  it("keeps an arp that is running, in its style, speed and range", () => {
    const running = { ...pad.params, volume: 0.5, play: withRange(withSpeed(withStyle(arpPlay, ARP_STYLES[5]), "1/8"), 2) };
    for (const x of [pluck, harp, presetById("dark-drone")!]) {
      const next = pickPreset(running, x);
      expect(next.play).toEqual(running.play);
      expect(next.volume).toBe(0.5);
      expect(next.preset).toBe(x.id);
    }
  });
  it("a sound from the Arp kind plays as an arp, in its own style", () => {
    const held = { ...pad.params, volume: 0.6 };
    for (const x of presetsIn("arp")) expect(pickPreset(held, x).play).toEqual(x.params.play);
    expect(pickPreset(held, presetById("gallop-arp")!).play.mode).toBe("arp");
  });
  it("otherwise a sound brings its own way of playing, as before", () => {
    const held = { ...pad.params };
    expect(pickPreset(held, harp).play.mode).toBe("strum");
    expect(pickPreset({ ...held, play: { ...held.play, mode: "pulse" } }, pluck).play).toEqual(pluck.params.play);
    for (const x of PRESETS) expect(pickPreset(held, x)).toEqual({ ...x.params, volume: held.volume });
  });
});

describe("in 6/8, 9/8 and 12/8", () => {
  // the app's beat there is a dotted quarter, three eighths: at 120 a beat is 0.5 s, an eighth 1/6 s
  const spb = 0.5;
  const sig = (beats: number) => ({ bpm: 120, origin: 0, seed: 5, bar: beats });
  const held = (beats: number): PlayNote[] => [...chord([60, 64, 67], 0, 2 * beats * spb), ...chord([57, 60, 64, 69], 2 * beats * spb, 2 * beats * spb)];
  const onGrid = (t: number, step: number) => Math.abs(t / step - Math.round(t / step)) < 1e-6;
  it("every style offered plays real eighths and sixteenths, as many to a bar as the meter has", () => {
    for (const beats of [2, 3, 4])
      for (const s of stylesFor(true))
        for (const [speed, per] of [["1/8", 3], ["1/16", 6]] as const) {
          const p = withSpeed(withStyle(arpPlay, s, true), speed, true);
          const notes = playNotes(held(beats), p, sig(beats));
          const step = spb / per;
          const what = `${beats * 3}/8 ${s.id} ${speed}`;
          expect(notes.every((n) => onGrid(n.start, step)), what).toBe(true);
          // a step for every eighth (sixteenth) of the bar, but for the rests of a rhythm
          const bar1 = new Set(notes.filter((n) => n.start < beats * spb - 1e-6).map((n) => n.start.toFixed(4))).size;
          const rests = (p.rhythm.match(/\./g) ?? []).length / Math.max(1, p.rhythm.length);
          expect(bar1, what).toBe(Math.round(beats * per * (1 - rests)));
        }
  });
  it("the arp at its start (Up, fast) is in sixteenths of the meter, and a beat a step when slow", () => {
    const fast = withStyle(arpPlay, ARP_STYLES[0], true);
    expect(fast.rate).toBe("1/16T");
    const starts = playNotes(held(2), fast, sig(2)).map((n) => n.start);
    expect(starts[1] - starts[0]).toBeCloseTo(spb / 6, 9);
    expect(withSpeed(fast, "1/8", true).rate).toBe("1/8T");
    expect(withSpeed(fast, "1/4", true).rate).toBe("1/4");
    expect(speedName("1/4", true)).toBe("1/4.");
    expect(speedName("1/4")).toBe("1/4");
  });
  it("leans on the beats, swings nothing, and offers no Triplets (everything is in threes there)", () => {
    expect(stylesFor(true).map((s) => s.id)).toEqual(["up", "down", "updown", "skip", "bounce", "shuffle", "random"]);
    expect(stylesFor(false)).toEqual(ARP_STYLES);
    for (const s of stylesFor(true)) {
      const p = withSpeed(withStyle(arpPlay, s, true), "1/8", true);
      expect(p.swing, s.id).toBe(0);
      expect(p.gate, s.id).toBeLessThanOrEqual(0.5);
      const notes = playNotes(held(2), p, sig(2));
      const loud = Math.max(...notes.map((n) => n.velocity));
      // the hardest strikes all fall on a beat
      for (const n of notes) if (n.velocity > loud - 1e-9) expect(onGrid(n.start, spb), `${s.id} ${n.start}`).toBe(true);
    }
  });
  it("each style is known again in the meter at every speed and range", () => {
    for (const s of stylesFor(true))
      for (const sp of SPEEDS)
        for (const r of RANGES) {
          const p = withRange(withSpeed(withStyle(arpPlay, s, true), sp.value, true), r);
          expect(styleOf(p, true)?.id, `${s.id} ${sp.value} ${r}`).toBe(s.id);
          expect(speedOf(p, true)).toBe(sp.value);
        }
  });
  it("steps off the meter's grid (a straight eighth there is a dotted one) show as Custom with no speed, and play as they are", () => {
    for (const rate of ["1/16", "1/8", "1/8D", "1/4T"] as const) {
      const p = { ...arpPlay, rate };
      expect(styleOf(p, true), rate).toBeNull();
      expect(speedOf(p, true), rate).toBeNull();
      const row = stylesRow(renderToStaticMarkup(createElement(ArpControls, { play: p, compound: true, onChange: () => {} })));
      expect(row).toContain("Custom");
      expect(row).not.toContain("Triplets");
    }
    const html = renderToStaticMarkup(createElement(ArpControls, { play: withStyle(arpPlay, ARP_STYLES[0], true), compound: true, onChange: () => {} }));
    expect(html).toContain("1/4.");
    expect(stylesRow(html).match(/aria-checked="true"[^>]*>([^<]+)</)?.[1]).toBe("Up");
  });
  it("turning the arp (or a pulse) on, or picking a sound that plays one, puts its steps on the meter's grid", () => {
    // as it starts: Up, fast, now real sixteenths
    expect(fitMeter(arpPlay, true)).toEqual(withStyle(arpPlay, ARP_STYLES[0], true));
    expect(fitMeter({ ...DEFAULT_PLAY, mode: "pulse", rate: "1/8" }, true).rate).toBe("1/8T");
    // a style keeps its style, its rhythm, swing and notes' length fitted to the meter (its range kept)
    const bounce = { ...withStyle(arpPlay, ARP_STYLES[4]), gate: 0.8, octaves: 3 as const };
    const fitted = fitMeter(bounce, true);
    expect(styleOf(fitted, true)?.id).toBe("bounce");
    expect([fitted.gate, fitted.octaves, fitted.rate]).toEqual([0.5, 3, "1/16T"]);
    expect(fitMeter({ ...bounce, gate: 0.3 }, true).gate).toBe(0.3);
    expect(styleOf(fitMeter(withStyle(arpPlay, ARP_STYLES[5]), true), true)?.id).toBe("shuffle");
    expect(styleOf(fitMeter(presetById("gallop-arp")!.params.play, true), true)?.id).toBe("bounce");
    // already on the grid, held, strummed ..., or in 4/4: as it was
    const on = withStyle(arpPlay, ARP_STYLES[1], true);
    expect(fitMeter(on, true)).toBe(on);
    for (const mode of ["sustain", "strum", "drone", "glide"] as const) expect(fitMeter({ ...DEFAULT_PLAY, mode }, true).rate).toBe("1/16");
    expect(fitMeter(arpPlay, false)).toBe(arpPlay);
  });
});
