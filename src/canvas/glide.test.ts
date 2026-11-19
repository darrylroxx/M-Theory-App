import { describe, expect, it } from "vitest";
import { fileWhen } from "./clock";
import { hzOfMidi } from "./layout";
import type { LayerKind } from "./layers";
import { Artist, type LayerCue } from "./painting";
import { getPalette } from "./palettes";
import type { LayoutId } from "./place";
import type { Stamp } from "./sim";
import { MAX_SLOPE } from "./strokes";

const W = 1000;
const H = 560;
let id = 1;
const note = (layer: LayerKind, t: number, midi: number, len: number): LayerCue => ({ layer, cue: { id: id++, t, hz: hzOfMidi(midi), amp: 0.6, attack: 0.3, bright: 0.5, rough: 0.1, len, ring: 2 } });

/**
 * Paint a line of notes in a layout, as the painting does (the canvas flowing under the brushes
 * in the river), and give back every mark of the layer where it ends up on the paper itself:
 * a mark laid at time `a` while the canvas flows left at `v` pixels a second sits, on the paper,
 * `v·a` to the right of where it was laid.
 */
function paint(layout: LayoutId, layer: LayerKind, cues: LayerCue[], seconds: number, pass = 16) {
  const a = new Artist();
  a.size(W, H);
  a.setPalette(getPalette("woodblock"));
  a.setKey(0, [0, 2, 4, 5, 7, 9, 11]);
  a.choice = layout;
  // (every mark the hand makes is kept: the line's shape is what is looked at here, not how much the canvas has room for)
  a.budget.admit = () => 1;
  const marks: { x: number; y: number; at: number; s: Stamp }[] = [];
  let now = 0;
  let flowed = 0;
  a.put = (s, l) => {
    if (l === layer) marks.push({ x: s.x - flowed, y: s.y, at: now, s });
  };
  const list = [...cues].sort((x, y) => x.cue.t - y.cue.t);
  let i = 0;
  for (let f = 0; f <= seconds * 60; f++) {
    now = f / 60;
    const due: LayerCue[] = [];
    while (i < list.length && list[i].cue.t <= now + 0.3) due.push(list[i++]);
    a.hear({ now, when: fileWhen(pass, 2, 1), mix: [], cues: due });
    // the canvas flows on under the brushes (as `Painting.frame` moves them, and the budget's record of the paint, with it)
    a.budget.tick(1 / 60, 0);
    const d = a.layout.drift();
    const mx = d.x / 60;
    flowed += mx;
    a.budget.shift(mx, 0);
    for (const h of a.hands.values()) h.shift(mx, 0);
  }
  return marks;
}

/** The steepest the line gets, over every stretch of it at least `span` pixels long across. */
function steepest(marks: { x: number; y: number }[], span = 3) {
  let worst = 0;
  for (let i = 0; i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      const dx = marks[j].x - marks[i].x;
      if (Math.abs(dx) < span) continue;
      worst = Math.max(worst, Math.abs(marks[j].y - marks[i].y) / Math.abs(dx));
      break;
    }
  }
  return worst;
}

/** A tune that steps up and down, every note joined to the next. */
function tune(layer: LayerKind, from: number, len: number, steps: number[]) {
  return steps.map((m, k) => note(layer, from + k * len, m, len));
}

describe("a line flows from note to note: it glides, it does not climb stairs", () => {
  it("a melody of joined notes in the river has no vertical risers: no stretch of it is steeper than the slope a glide keeps to", () => {
    const steps = [72, 74, 76, 77, 79, 77, 76, 74, 72, 74, 76, 74, 72, 71, 72, 76];
    // (a brush that went to each new pitch at once climbed about 7 times as fast as it went on: a stair)
    for (const [len, most] of [[0.5, MAX_SLOPE * 1.8], [0.25, 3.2]]) {
      const marks = paint("river", "melody", tune("melody", 0.5, len, steps), 0.5 + steps.length * len + 0.3);
      expect(marks.length).toBeGreaterThan(80);
      // the line is never much steeper than a glide keeps to (there is a little room for the hand's own wobble, the
      // brush's spring, and a leap of a third that has only part of its note to glide in); short notes leave a glide
      // less time, but even they never stand a riser on end
      expect(steepest(marks)).toBeLessThan(most);
      // and it does reach each note: the line spans the tune's range
      const ys = marks.map((m) => m.y);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(H * 0.04);
    }
  });

  it("so do the bass and the harmony", () => {
    for (const [layer, steps] of [["bass", [36, 38, 40, 38, 36, 35, 36, 38]], ["harmony", [69, 71, 72, 74, 72, 71, 69, 67]]] as [LayerKind, number[]][]) {
      const marks = paint("river", layer, tune(layer, 0.5, 0.4, steps), 0.5 + steps.length * 0.4 + 0.3);
      expect(marks.length).toBeGreaterThan(20);
      expect(steepest(marks)).toBeLessThan(MAX_SLOPE * 1.6);
    }
  });

  it("a glide is the way into a note, not all of it: the line arrives at each pitch and holds it", () => {
    const steps = [72, 76, 72, 76];
    const len = 0.5;
    const marks = paint("river", "melody", tune("melody", 0.5, len, steps), 0.5 + steps.length * len + 0.2);
    // over the last part of each note the line is level, at that note's height
    const level = (k: number) => marks.filter((m) => m.at > 0.5 + k * len + 0.38 && m.at < 0.5 + (k + 1) * len - 0.02).map((m) => m.y);
    for (let k = 0; k < steps.length; k++) {
      const ys = level(k);
      expect(ys.length).toBeGreaterThan(2);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(4);
    }
    // up a third, down a third: the held parts are a third apart
    const mean = (xs: number[]) => xs.reduce((p, x) => p + x, 0) / xs.length;
    expect(mean(level(0)) - mean(level(1))).toBeGreaterThan(8);
    expect(mean(level(2)) - mean(level(1))).toBeGreaterThan(8);
  });
});
