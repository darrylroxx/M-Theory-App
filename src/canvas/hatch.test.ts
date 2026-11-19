import { describe, expect, it } from "vitest";
import { hexToRgb } from "./color";
import { layerColours, type LayerKind } from "./layers";
import { MARGIN, hzOfMidi, noteColors } from "./layout";
import { getPalette } from "./palettes";
import { yOfUp } from "./place";
import type { Stamp } from "./sim";
import { LayerHand, type Cue } from "./strokes";

const W = 1000;
const H = 560;
const PASS = 16;
const SECS = 12;
function hand(layer: LayerKind) {
  const h = new LayerHand(layer);
  h.size(W, H);
  const pal = getPalette("woodblock");
  h.colours(layerColours(pal), pal.colors.map(hexToRgb), noteColors(0, [0, 2, 4, 5, 7, 9, 11], pal.colors.length));
  h.run = 1;
  h.where = (t, up) => ({ x: W * (MARGIN + ((t % PASS) / PASS) * (1 - 2 * MARGIN)), y: yOfUp(up, H), dx: 1, dy: 0, seg: Math.floor(t / PASS), scale: 1 });
  const marks: Stamp[] = [];
  h.put = (s) => marks.push(s);
  return { h, marks };
}
let ids = 1;
const note = (t: number, midi: number, len: number, o: Partial<Cue> = {}): Cue => ({ id: ids++, t, hz: hzOfMidi(midi), amp: 0.75, attack: 0.5, bright: 0.5, rough: 0.15, len, ring: 1.5, ...o });
const isHatch = (m: Stamp) => m.hard === 0.7 && m.load === 0.55;

/**
 * A melody with a harmony a third under it note for note, a pad holding a note under each bar
 * (painted as a harmony too), a bass and chords: twelve seconds of each, its marks kept per layer.
 */
function song() {
  const tune = [72, 74, 76, 77, 79, 77, 76, 74, 72, 71, 72, 74, 76, 74, 72, 72];
  const step = 0.4;
  const layers = { melody: hand("melody"), harmony: hand("harmony"), pad: hand("harmony"), bass: hand("bass"), chords: hand("chords") };
  layers.harmony.h.partner = layers.melody.h;
  layers.pad.h.partner = layers.melody.h;
  const notes: [LayerHand, Cue][] = [];
  for (let i = 0; i * step < SECS; i++) {
    const m = tune[i % tune.length];
    notes.push([layers.melody.h, note(0.2 + i * step, m, step * 0.95)]);
    notes.push([layers.harmony.h, note(0.2 + i * step, m - 3, step * 0.95, { rough: 0.2 })]);
    if (i % 4 === 0) {
      notes.push([layers.bass.h, note(0.2 + i * step, 36, step * 3.9)]);
      notes.push([layers.pad.h, note(0.2 + i * step, m - 5, step * 3.9, { attack: 0.1, rough: 0.3 })]);
      for (const c of [60, 64, 67]) notes.push([layers.chords.h, note(0.2 + i * step, c, step * 3.9, { attack: 0.15 })]);
    }
  }
  notes.sort((a, b) => a[1].t - b[1].t);
  let i = 0;
  for (let t = 0; t <= SECS; t += 1 / 60) {
    while (i < notes.length && notes[i][1].t <= t + 1e-9) {
      const [h, c] = notes[i++];
      h.start(c);
    }
    for (const l of Object.values(layers)) l.h.advance(t);
  }
  return layers;
}

describe("a harmony that follows its melody closely", () => {
  const layers = song();
  const rate = (k: keyof typeof layers) => layers[k].marks.length / SECS;

  it("lays marks at about the melody's rate, not many times it (the cross-hatching goes by distance, a few links at a time)", () => {
    for (const k of ["melody", "harmony", "pad", "bass", "chords"] as const) expect(rate(k)).toBeLessThan(160);
    expect(rate("harmony")).toBeLessThan(2 * rate("melody"));
    expect(rate("pad")).toBeLessThan(2 * rate("melody"));
    // (it used to lay over a thousand a second, nearly all of them hatching)
    expect(layers.harmony.marks.filter(isHatch).length / SECS).toBeLessThan(rate("melody"));
  });

  it("still reads as a harmony: a thinner line of its own, hatched to the melody with links at many slants", () => {
    const hatch = layers.harmony.marks.filter(isHatch);
    expect(hatch.length / SECS).toBeGreaterThan(10);
    expect(hatch.length / layers.harmony.marks.length).toBeGreaterThan(0.12);
    // links at many slants cross one another: a hatching, not a fringe of parallel ticks
    const lean = hatch.map((m) => Math.abs(Math.cos(m.angle)));
    expect(lean.filter((c) => c < 0.25).length).toBeGreaterThan(hatch.length * 0.1);
    expect(lean.filter((c) => c > 0.5).length).toBeGreaterThan(hatch.length * 0.1);
    const size = (ms: Stamp[]) => {
      const line = ms.filter((m) => m.kind === 0 && !isHatch(m));
      return line.reduce((a, m) => a + m.r, 0) / line.length;
    };
    expect(size(layers.harmony.marks)).toBeLessThan(0.8 * size(layers.melody.marks));
    // the pad is hatched too
    expect(layers.pad.marks.filter(isHatch).length / SECS).toBeGreaterThan(10);
  });
});
