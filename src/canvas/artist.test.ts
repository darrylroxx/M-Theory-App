import { describe, expect, it } from "vitest";
import { fileWhen } from "./clock";
import { hzOfMidi } from "./layout";
import type { LayerKind } from "./layers";
import { Artist, type LayerCue } from "./painting";
import { getPalette } from "./palettes";
import type { Stamp } from "./sim";
import { AT, REF_MEAN, REF_SD } from "./vibe";

const W = 1000;
const H = 560;
/** An artist on a canvas, keeping every mark it lays, and which layer laid it. */
function artist() {
  const a = new Artist();
  a.size(W, H);
  a.setPalette(getPalette("woodblock"));
  a.setKey(0, [0, 2, 4, 5, 7, 9, 11]);
  const marks: { s: Stamp; layer: LayerKind; at: number }[] = [];
  let now = 0;
  a.put = (s, layer) => marks.push({ s, layer, at: now });
  const run = (seconds: number, cues: LayerCue[], from = 0) => {
    const list = [...cues].sort((x, y) => x.cue.t - y.cue.t);
    let i = 0;
    for (let f = Math.round(from * 60); f <= seconds * 60; f++) {
      now = f / 60 + 0.012;
      const due: LayerCue[] = [];
      // the app hands its notes over a little ahead of their time
      while (i < list.length && list[i].cue.t <= now + 0.3) due.push(list[i++]);
      a.hear({ now, when: fileWhen(16, 2, 1), mix: [], cues: due });
    }
  };
  return { a, marks, run };
}
let id = 1;
const note = (layer: LayerKind, t: number, midi: number, len: number, amp: number, key?: string): LayerCue => ({ layer, key, cue: { id: id++, t, hz: hzOfMidi(midi), amp, attack: 0.5, bright: 0.5, rough: 0.1, len, ring: 1.5 } });
const hit = (t: number, drum: string, amp: number): LayerCue => ({ layer: "drums", hit: true, cue: { id: -1, t, hz: drum === "kick" ? 60 : drum === "snare" ? 1800 : 9000, amp, attack: 1, bright: 0.6, rough: drum === "kick" ? 0.2 : 0.85, len: 0, ring: 0.2, drum } });

function song(layers: LayerKind[], amp: number, seconds: number): LayerCue[] {
  const out: LayerCue[] = [];
  for (let t = 0.2; t < seconds; t += 0.5) {
    for (const l of layers) {
      if (l === "drums") out.push(hit(t, t % 1 < 0.5 ? "kick" : "snare", amp));
      else if (l === "bass") out.push(note("bass", t, 36, 0.45, amp));
      else if (l === "chords") for (const m of [60, 64, 67]) out.push(note("chords", t, m, 0.45, amp));
      else if (l === "melody") out.push(note("melody", t, 72 + (Math.round(t * 2) % 5), 0.45, amp));
      else if (l === "harmony") out.push(note("harmony", t, 69 + (Math.round(t * 2) % 5), 0.45, amp));
      else if (l === "vocals") out.push(note("vocals", t, 64, 0.45, amp));
    }
  }
  return out;
}

describe("the artist: how much is playing sets how much is painted", () => {
  it("two quiet parts call for about a fifth of the canvas; six loud ones for about two thirds", () => {
    const quiet = artist();
    quiet.run(6, song(["chords", "melody"], 0.3, 6));
    expect(quiet.a.budget.target).toBeGreaterThan(0.12);
    expect(quiet.a.budget.target).toBeLessThan(0.24);
    const loud = artist();
    loud.run(6, song(["drums", "bass", "chords", "melody", "harmony", "vocals"], 0.9, 6));
    expect(loud.a.budget.target).toBeGreaterThan(0.55);
    // and the loud song lays far more paint
    const area = (ms: { s: Stamp }[]) => ms.reduce((t, m) => t + m.s.r * m.s.r * m.s.paint, 0);
    expect(area(loud.marks)).toBeGreaterThan(4 * area(quiet.marks));
  });

  it("a part that is hidden is not painted", () => {
    const { a, marks, run } = artist();
    a.hidden = new Set(["drums"]);
    run(3, song(["drums", "melody"], 0.8, 3));
    expect(marks.some((m) => m.layer === "drums")).toBe(false);
    expect(marks.some((m) => m.layer === "melody")).toBe(true);
  });

  it("every track has a hand of its own: two melodies are two lines", () => {
    const { a, marks, run } = artist();
    const one = [72, 74, 76, 77].map((m, i) => note("melody", 0.2 + i * 0.4, m, 0.4, 0.8, "melody"));
    const two = [60, 62, 64, 65].map((m, i) => note("melody", 0.2 + i * 0.4, m, 0.4, 0.8, "m2"));
    run(2.2, [...one, ...two]);
    expect([...a.hands.keys()].sort()).toEqual(["m2", "melody"]);
    // each line stays at its own height: no stroke jumps from one to the other
    const ys = marks.filter((m) => m.s.kind === 0).map((m) => m.s.y);
    // (the lower line's top note sits at 0.59 of the height, the upper line's lowest at 0.51)
    const between = ys.filter((y) => y > H * 0.53 && y < H * 0.57);
    expect(between.length).toBeLessThan(ys.length * 0.05);
  });

  it("marks land with their sound, never more than a frame early and never late", () => {
    const { marks, run } = artist();
    run(2, [hit(1, "snare", 0.9)]);
    const first = Math.min(...marks.map((m) => m.at));
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first - 1).toBeLessThan(0.02);
  });

  it("the layout follows the vibe of the music, and stays once the vibe of the whole song is known", () => {
    const { a, run } = artist();
    // a busy, beat-driven vibe (a usual song, two spreads up in onsets, pulse, danceability and drums) and a calm, held one
    const raw = (z: Record<number, number>) => REF_MEAN.map((m, i) => m + (z[i] ?? 0) * REF_SD[i]);
    a.knowVibe(raw({ [AT.onsets]: 2, [AT.pulse]: 2, [AT.dance]: 2, [AT.roles]: 2 }), true);
    run(1, []);
    const first = a.layout.id;
    expect(first).not.toBe("sweep");
    a.knowVibe(raw({ [AT.onsets]: -2, [AT.pulse]: -2, [AT.legato]: 2, [AT.tone]: 2 }), false);
    run(4, [], 1);
    expect(a.layout.id).toBe(first);
    // asked for one, it is that one
    a.choice = "rings";
    run(5, [], 4);
    expect(a.layout.id).toBe("rings");
  });
});
