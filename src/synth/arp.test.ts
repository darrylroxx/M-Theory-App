import { describe, expect, it } from "vitest";
import { DEFAULT_PLAY, type PlaySettings, RATES, RHYTHMS, reviveSynth, sameSynth } from "./params";
import { ACCENT, type PlayNote, type SynthNote, arp, arpOrder, arpStep, octaveOrder, playNotes, rateBeats } from "./play";
import { LiveKeys, type LiveOut } from "./live";
import { PRESETS, presetsIn } from "./presets";

const chord = (midis: number[], start: number, length: number, velocity = 0.8): PlayNote[] => midis.map((midi) => ({ midi, start, length, velocity }));
// at 120 bpm a beat is half a second: C major for two beats, then A minor for two
const song: PlayNote[] = [...chord([60, 64, 67], 0, 1), ...chord([57, 60, 64], 1, 1)];
const ctx = { bpm: 120, seed: 3 };
const arpOf = (patch: Partial<PlaySettings>, notes = song, c: Parameters<typeof arp>[2] = ctx) => arp(notes, { ...DEFAULT_PLAY, mode: "arp", ...patch }, c);
const midis = (n: SynthNote[]) => n.map((x) => x.midi);

// ── The arpeggiator as it was before its newer settings, kept word for word, to prove an old song plays exactly as it did ──
function oldRng(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}
const OLD_RATE: Record<string, number> = { "1/4": 1, "1/8": 0.5, "1/8T": 1 / 3, "1/16": 0.25, "1/16T": 1 / 6, "1/32": 0.125 };
function oldOrder(pitches: number[], pattern: string, octaves: number, rand: () => number = Math.random): number[] {
  const base = [...new Set(pitches)].sort((a, b) => a - b);
  if (base.length === 0) return [];
  const up: number[] = [];
  for (let o = 0; o < octaves; o++) for (const p of base) up.push(p + 12 * o);
  switch (pattern) {
    case "up":
    case "chord":
      return up;
    case "down":
      return [...up].reverse();
    case "updown":
      return up.length > 2 ? [...up, ...up.slice(1, -1).reverse()] : up;
    case "random": {
      const r = [...up];
      for (let i = r.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [r[i], r[j]] = [r[j], r[i]];
      }
      return r;
    }
    default: {
      const n = base.length;
      const ext = [...up, ...base.map((p) => p + 12 * octaves)];
      const out: number[] = [];
      for (let i = 0; i + n <= ext.length; i++) out.push(...ext.slice(i, i + n));
      return out;
    }
  }
}
function oldArp(notes: PlayNote[], o: { pattern: string; rate: string; octaves: number; gate: number }, c: { bpm: number; origin?: number; seed?: number }) {
  const sorted = notes.filter((n) => n.length > 0).sort((a, b) => a.start - b.start || a.midi - b.midi);
  const chords: PlayNote[][] = [];
  for (const n of sorted) {
    const last = chords[chords.length - 1];
    if (last && n.start - last[0].start <= 0.005) last.push(n);
    else chords.push([n]);
  }
  for (const ch of chords) ch.sort((a, b) => a.midi - b.midi);
  const beat = 60 / Math.max(20, Math.min(400, c.bpm || 120));
  const step = OLD_RATE[o.rate] * beat;
  const gate = Math.max(0.05, Math.min(1, o.gate));
  const octaves = Math.max(1, Math.min(3, Math.round(o.octaves)));
  const rand = oldRng((c.seed ?? 1) ^ 0xa5a5);
  const out: SynthNote[] = [];
  chords.forEach((ch, ci) => {
    const start = ch[0].start;
    let end = start;
    for (const n of ch) end = Math.max(end, n.start + n.length);
    if (chords[ci + 1]) end = Math.min(end, chords[ci + 1][0].start);
    const vel = Math.max(...ch.map((n) => n.velocity));
    let seq = oldOrder(ch.map((n) => n.midi), o.pattern, octaves, rand);
    if (seq.length === 0) return;
    const base = [...new Set(ch.map((n) => n.midi))].sort((a, b) => a - b);
    const origin = c.origin ?? 0;
    for (let k = 0; ; k++) {
      const t = start + k * step;
      if (t >= end - 1e-6) break;
      const len = Math.min(step * gate, end - t);
      const beatPos = (t - origin) / beat;
      const accent = Math.abs(beatPos - Math.round(beatPos)) < 1e-3 ? 1 : 0.82;
      if (o.pattern === "chord") {
        const oct = 12 * (k % octaves);
        for (const p of base) out.push({ midi: p + oct, start: t, length: len, velocity: vel * accent });
      } else {
        if (o.pattern === "random" && k > 0 && k % seq.length === 0) seq = oldOrder(ch.map((n) => n.midi), "random", octaves, rand);
        out.push({ midi: seq[k % seq.length], start: t, length: len, velocity: vel * accent });
      }
    }
  });
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

describe("the arpeggiator: an old song plays exactly as it did", () => {
  // chords held for different lengths, one off the beat, one a single note, and a long one
  const notes: PlayNote[] = [...chord([60, 64, 67, 71], 0, 1.2, 0.7), ...chord([55, 62, 65], 1.2, 0.8), ...chord([48], 2, 0.4), ...chord([45, 52, 57, 60, 64], 2.4, 3.1, 0.9)];
  it("every pattern, octave count, step and gate of before, through a saved sound that knows nothing of the new settings", () => {
    for (const pattern of ["up", "down", "updown", "random", "chord", "crawl"] as const)
      for (const octaves of [1, 2, 3] as const)
        for (const rate of ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"] as const)
          for (const gate of [0.1, 0.6, 1])
            for (const bpm of [72, 120, 151]) {
              // a sound saved before the arp had more settings
              const saved = { play: { mode: "arp", pattern, rate, octaves, gate, spread: 0.35, direction: "down", humanise: 0 } };
              const play = reviveSynth(JSON.parse(JSON.stringify(saved))).play;
              const c = { bpm, origin: 0.1, seed: 11, bar: 4 };
              const now = playNotes(notes, play, c);
              const before = oldArp(notes, { pattern, rate, octaves, gate }, c);
              expect(now, `${pattern} ${octaves} ${rate} ${gate} ${bpm}`).toEqual(before);
            }
  });
  it("the step lengths of before are unchanged, and the old orders are the same", () => {
    for (const r of Object.keys(OLD_RATE)) expect(rateBeats(r as never)).toBeCloseTo(OLD_RATE[r], 12);
    for (const p of ["up", "down", "updown", "chord", "crawl"]) for (const o of [1, 2, 3]) expect(arpOrder([64, 60, 67, 71], p as never, o)).toEqual(oldOrder([64, 60, 67, 71], p, o));
  });
  it("the newer settings default to how it played, and a saved sound keeps them", () => {
    const p = reviveSynth({ play: { mode: "arp" } }).play;
    expect([p.octMove, p.swing, p.rhythm, p.ratchet]).toEqual(["span", 0, "", 1]);
    const full = reviveSynth({ play: { mode: "arp", pattern: "thumb", octaves: 4, octMove: "bounce", swing: 0.5, rhythm: "X.x.", ratchet: 3, rate: "1/8D" } });
    expect(full.play).toMatchObject({ pattern: "thumb", octaves: 4, octMove: "bounce", swing: 0.5, rhythm: "X.x.", ratchet: 3, rate: "1/8D" });
    expect(reviveSynth(JSON.parse(JSON.stringify(full)))).toEqual(full);
    // out of range or broken: made safe
    const bad = reviveSynth({ play: { octaves: 5, octMove: "sideways", swing: 3, rhythm: "x?y..X" + "x".repeat(30), ratchet: 9, pattern: "zigzag", rate: "1/7" } }).play;
    expect(bad).toMatchObject({ octaves: 1, octMove: "span", swing: 0.75, ratchet: 1, pattern: "up", rate: "1/16" });
    expect(bad.rhythm).toBe(("x..X" + "x".repeat(30)).slice(0, 16));
    // a rhythm that rests throughout is no rhythm
    expect(reviveSynth({ play: { rhythm: "...." } }).play.rhythm).toBe("");
    // the new settings count as part of the sound
    const a = reviveSynth({});
    expect(sameSynth(a, { ...a, play: { ...a.play, swing: 0.2 } })).toBe(false);
    expect(sameSynth(a, { ...a, play: { ...a.play, rhythm: "x.x." } })).toBe(false);
  });
});

describe("the arpeggiator's patterns", () => {
  const C7 = [64, 60, 70, 67]; // written E C B♭ G
  it("as played: in the order written (or pressed)", () => {
    expect(arpOrder(C7, "played", 1)).toEqual([64, 60, 70, 67]);
    expect(arpOrder(C7, "played", 2)).toEqual([64, 60, 70, 67, 76, 72, 82, 79]);
    // a song's chord keeps its written order
    const out = arpOf({ pattern: "played", rate: "1/16" }, chord([67, 60, 64], 0, 0.5));
    expect(midis(out)).toEqual([67, 60, 64, 67]);
  });
  it("converge: from the outside in; diverge: from the middle out", () => {
    expect(arpOrder(C7, "converge", 1)).toEqual([60, 70, 64, 67]);
    expect(arpOrder([60, 64, 67], "converge", 1)).toEqual([60, 67, 64]);
    expect(arpOrder(C7, "diverge", 1)).toEqual([64, 67, 60, 70]);
    expect(arpOrder([60, 64, 67], "diverge", 1)).toEqual([64, 67, 60]);
    expect(arpOrder([60, 64, 67, 72, 76], "diverge", 1)).toEqual([67, 72, 64, 76, 60]);
  });
  it("thumb: the lowest note between each of the others; pinky: the highest", () => {
    expect(arpOrder(C7, "thumb", 1)).toEqual([60, 64, 60, 67, 60, 70]);
    expect(arpOrder(C7, "pinky", 1)).toEqual([70, 60, 70, 64, 70, 67]);
    // two notes: just the two
    expect(arpOrder([60, 67], "thumb", 1)).toEqual([60, 67]);
    expect(arpOrder([60, 67], "pinky", 1)).toEqual([67, 60]);
    // a single note: that note
    for (const p of ["played", "converge", "diverge", "thumb", "pinky"] as const) expect(arpOrder([62], p, 1)).toEqual([62]);
  });
  it("every pattern plays only the chord's notes (in its octaves) and fills the chord's time", () => {
    for (const pattern of ["up", "down", "updown", "played", "converge", "diverge", "thumb", "pinky", "crawl", "chord", "random"] as const) {
      const out = arpOf({ pattern, rate: "1/16", octaves: 2 });
      expect(out.length, pattern).toBeGreaterThanOrEqual(16);
      for (const n of out) {
        const pcs = n.start < 1 ? [0, 4, 7] : [9, 0, 4];
        expect(pcs, pattern).toContain(n.midi % 12);
        expect(n.start + n.length).toBeLessThanOrEqual((n.start < 1 ? 1 : 2) + 1e-9);
      }
    }
  });
  it("random is the same for the same seed and different for another", () => {
    const a = midis(arpOf({ pattern: "random", octaves: 3 }, song, { bpm: 120, seed: 5 }));
    expect(midis(arpOf({ pattern: "random", octaves: 3 }, song, { bpm: 120, seed: 5 }))).toEqual(a);
    expect(midis(arpOf({ pattern: "random", octaves: 3 }, song, { bpm: 120, seed: 6 }))).not.toEqual(a);
    // and so is it with the octaves moving
    expect(midis(arpOf({ pattern: "random", octaves: 3, octMove: "bounce" }, song, { bpm: 120, seed: 5 }))).toEqual(midis(arpOf({ pattern: "random", octaves: 3, octMove: "bounce" }, song, { bpm: 120, seed: 5 })));
  });
});

describe("the arpeggiator's octaves", () => {
  it("up to four, and the octaves move up, down, or up and back", () => {
    expect(octaveOrder("up", 4)).toEqual([0, 1, 2, 3]);
    expect(octaveOrder("down", 3)).toEqual([2, 1, 0]);
    expect(octaveOrder("bounce", 4)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(octaveOrder("bounce", 2)).toEqual([0, 1]);
    expect(arpOrder([60, 64, 67], "up", 4)).toEqual([60, 64, 67, 72, 76, 79, 84, 88, 91, 96, 100, 103]);
    // the pattern plays in one octave, then moves
    expect(arpOrder([60, 64, 67], "down", 2, Math.random, "up")).toEqual([67, 64, 60, 79, 76, 72]);
    expect(arpOrder([60, 64, 67], "up", 2, Math.random, "down")).toEqual([72, 76, 79, 60, 64, 67]);
    expect(arpOrder([60, 64, 67], "up", 3, Math.random, "bounce")).toEqual([60, 64, 67, 72, 76, 79, 84, 88, 91, 72, 76, 79]);
    // all at once (as before): the pattern runs over the whole range
    expect(arpOrder([60, 64, 67], "down", 2, Math.random, "span")).toEqual([79, 76, 72, 67, 64, 60]);
    // one octave: the movement makes no difference
    for (const m of ["span", "up", "down", "bounce"] as const) expect(arpOrder([60, 64, 67], "updown", 1, Math.random, m)).toEqual([60, 64, 67, 64]);
  });
  it("the whole-chord pattern jumps octaves the same ways", () => {
    const tops = (move: PlaySettings["octMove"]) => arpOf({ pattern: "chord", rate: "1/8", octaves: 3, octMove: move }, chord([60, 64, 67], 0, 1.5)).filter((n) => n.midi % 12 === 0).map((n) => n.midi);
    expect(tops("span")).toEqual([60, 72, 84, 60, 72, 84]);
    expect(tops("down")).toEqual([84, 72, 60, 84, 72, 60]);
    expect(tops("bounce")).toEqual([60, 72, 84, 72, 60, 72]);
  });
});

describe("the arpeggiator's timing", () => {
  it("dotted and triplet steps", () => {
    expect(rateBeats("1/8D")).toBeCloseTo(0.75, 12);
    expect(rateBeats("1/16D")).toBeCloseTo(0.375, 12);
    expect(rateBeats("1/4T")).toBeCloseTo(2 / 3, 12);
    expect(rateBeats("1/32T")).toBeCloseTo(1 / 12, 12);
    for (const r of RATES) expect(rateBeats(r)).toBeGreaterThan(0);
    // dotted eighths at 120: every 0.375 s, so three in a chord of 1.2 s
    const out = arpOf({ rate: "1/8D" }, chord([60, 64, 67], 0, 1.2));
    expect(out.map((n) => n.start)).toEqual([0, 0.375, 0.75, 1.125].map((x) => expect.closeTo(x, 9)));
  });
  it("swing pushes every second step late; half way is a triplet lilt; the pair still fills two steps", () => {
    const step = 0.125;
    const straight = arpOf({ rate: "1/16", gate: 1 });
    const swung = arpOf({ rate: "1/16", gate: 1, swing: 0.375 });
    expect(swung.length).toBe(straight.length);
    swung.forEach((n, i) => {
      if (i % 2 === 0) expect(n.start).toBeCloseTo(straight[i].start, 9);
      else expect(n.start - straight[i].start).toBeCloseTo(step / 4, 9);
    });
    // the first of a pair is held longer, the second shorter, and they never overlap
    expect(swung[0].length).toBeCloseTo(step * 1.25, 9);
    expect(swung[1].length).toBeCloseTo(step * 0.75, 9);
    // at its most, the second step falls three quarters of the way through the pair
    const hard = arpOf({ rate: "1/8", swing: 0.75 });
    expect((hard[1].start - hard[0].start) / 0.5).toBeCloseTo(0.75, 9);
    expect(arpStep(1, 1, { swing: 9 }).shift).toBeCloseTo(0.5, 9);
  });
  it("a rhythm of steps: rests are silent and do not use up a note, accents are struck harder", () => {
    const out = arpOf({ rate: "1/16", rhythm: "X.x.", gate: 0.5 }, chord([60, 64, 67], 0, 1));
    // 8 sixteenths, every second one a rest
    expect(out.map((n) => n.start)).toEqual([0, 0.25, 0.5, 0.75].map((x) => expect.closeTo(x, 9)));
    // the pattern carries on through the rests
    expect(midis(out)).toEqual([60, 64, 67, 60]);
    // the accented steps are harder than the plain ones, by about the accent
    expect(out[0].velocity).toBeCloseTo(Math.min(1, 0.8 * ACCENT), 9);
    expect(out[1].velocity).toBeLessThan(out[0].velocity * 0.8);
    // every ready rhythm plays the steps it says
    for (const r of RHYTHMS) {
      const n = arpOf({ rate: "1/16", rhythm: r.steps }, chord([60, 64, 67], 0, 4)).length;
      const hits = r.steps ? [...r.steps].filter((c) => c !== ".").length * (16 / r.steps.length) : 16;
      expect(n, r.name).toBe(hits * 2);
    }
  });
  it("the rhythm starts again at every bar, whatever the time signature", () => {
    const rhythm = "X..x..x.x..x..x."; // sixteen steps: more than a bar of 3/4 holds
    const onsets = (bar: number, rate: PlaySettings["rate"], bpm = 120) => {
      const spb = 60 / bpm;
      const out = arp(chord([60, 64, 67], 0.2, 2 * bar * spb), { ...DEFAULT_PLAY, rate, rhythm }, { bpm, origin: 0.2, bar });
      return out.map((n) => Math.round(((n.start - 0.2) / spb / rateBeats(rate)) * 1000) / 1000);
    };
    // 3/4: twelve sixteenths to a bar; the second bar plays the first twelve steps again
    const three = onsets(3, "1/16");
    const first = [...rhythm.slice(0, 12)].flatMap((c, i) => (c === "." ? [] : [i]));
    expect(three).toEqual([...first, ...first.map((i) => i + 12)]);
    // 6/8: two dotted-quarter beats, six eighths (a third of a beat each) to a bar
    const six = onsets(2, "1/8T", 90);
    const firstSix = [...rhythm.slice(0, 6)].flatMap((c, i) => (c === "." ? [] : [i]));
    expect(six).toEqual([...firstSix, ...firstSix.map((i) => i + 6)]);
    // 7/4 at a fast tempo: 28 sixteenths, the rhythm twice and then from its start again for the bar's last steps
    const seven = onsets(7, "1/16", 168);
    const firstSeven = [...(rhythm + rhythm).slice(0, 28)].flatMap((c, i) => (c === "." ? [] : [i]));
    expect(seven).toEqual([...firstSeven, ...firstSeven.map((i) => i + 28)]);
  });
  it("a ratchet strikes each step two to four times inside it", () => {
    for (const reps of [2, 3, 4] as const) {
      const out = arpOf({ rate: "1/8", ratchet: reps, gate: 0.5 }, chord([60, 64, 67], 0, 1));
      // four eighths in a chord of a second at 120, each struck `reps` times
      expect(out.length).toBe(4 * reps);
      expect(out[1].start).toBeCloseTo(0.25 / reps, 9);
      expect(out[0].length).toBeCloseTo((0.25 / reps) * 0.5, 9);
      // the repeats are of the same note, a touch softer
      expect(out.slice(0, reps).every((n) => n.midi === 60)).toBe(true);
      expect(out[1].velocity).toBeLessThan(out[0].velocity);
      expect(out[reps].midi).toBe(64);
    }
    // with a rhythm and swing too: never past the chord's end
    const all = arpOf({ rate: "1/16", ratchet: 3, swing: 0.6, rhythm: "XxX.x", octaves: 4, octMove: "bounce", pattern: "pinky" });
    for (const n of all) expect(n.start + n.length).toBeLessThanOrEqual((n.start < 1 ? 1 : 2) + 1e-9);
  });
  it("is the same at any tempo, in steps", () => {
    for (const bpm of [60, 97, 174]) {
      const spb = 60 / bpm;
      const out = arp(chord([60, 64, 67], 0, 4 * spb), { ...DEFAULT_PLAY, rate: "1/16", rhythm: "X.xxX.xx", swing: 0.3, ratchet: 2 }, { bpm, bar: 4 });
      expect(out.length).toBe(16 * 6 / 8 * 2);
      expect(out[0].start).toBe(0);
    }
  });
});

describe("arp presets", () => {
  it("there are new ones showing the rhythm, swing, pedal, repeats, dotted steps and moving octaves off", () => {
    const arps = presetsIn("arp").map((p) => p.params.play);
    expect(arps.length).toBeGreaterThanOrEqual(10);
    expect(arps.some((p) => p.rhythm)).toBe(true);
    expect(arps.some((p) => p.swing > 0)).toBe(true);
    expect(arps.some((p) => p.pattern === "thumb" || p.pattern === "pinky")).toBe(true);
    expect(arps.some((p) => p.ratchet > 1)).toBe(true);
    expect(arps.some((p) => p.rate.endsWith("D"))).toBe(true);
    expect(arps.some((p) => p.octMove !== "span")).toBe(true);
    // the ones from before are as they were
    for (const p of PRESETS.filter((x) => !["gallop-arp", "lazy-arp", "pedal-arp", "ratchet-arp", "dotted-arp"].includes(x.id))) expect([p.params.play.octMove, p.params.play.swing, p.params.play.rhythm, p.params.play.ratchet], p.id).toEqual(["span", 0, "", 1]);
  });
});

/** A pretend synth on a clock the test moves by hand. */
function rig(patch: Partial<PlaySettings> = {}) {
  const notes: { midi: number; when: number; length: number; vel: number }[] = [];
  let t = 10;
  const out: LiveOut = { now: () => t, bpm: () => 120, on: () => 1, off: () => {}, note: (midi, when, vel, length) => notes.push({ midi, when, length, vel }) };
  const play: PlaySettings = { ...DEFAULT_PLAY, mode: "arp", ...patch };
  const keys = new LiveKeys(out, () => play);
  const run = (until: number) => {
    for (let s = t; s <= until; s += 0.03) {
      t = s;
      keys.tick();
    }
  };
  return { keys, notes, run, at: (s: number) => (t = s) };
}

describe("the arpeggiator on the keys", () => {
  it("plays the new patterns, in the order the keys were pressed for as-played", () => {
    const r = rig({ pattern: "played", rate: "1/8" });
    for (const m of [67, 60, 64]) r.keys.press(m);
    r.run(11.5);
    expect(r.notes.slice(0, 4).map((n) => n.midi)).toEqual([67, 60, 64, 67]);
    const t = rig({ pattern: "thumb", rate: "1/8" });
    for (const m of [60, 64, 67]) t.keys.press(m);
    t.run(11.5);
    expect(t.notes.slice(0, 4).map((n) => n.midi)).toEqual([60, 64, 60, 67]);
  });
  it("follows the rhythm, the swing and the repeats", () => {
    const r = rig({ rate: "1/8", rhythm: "X.x", swing: 0.375, ratchet: 2, gate: 1 });
    r.keys.press(60);
    r.keys.press(64);
    r.run(12);
    const first = r.notes[0].when;
    const steps = r.notes.map((n) => Math.round(((n.when - first) / 0.25) * 1000) / 1000);
    // steps 0 and 2 of each three play, struck twice each (the second step of each swung pair is a quarter of a step late, and shorter)
    expect(steps.slice(0, 8)).toEqual([0, 0.625, 2, 2.625, 3.25, 3.625, 5.25, 5.625]);
    expect(r.notes[0].vel).toBeGreaterThan(r.notes[2].vel);
    expect(r.notes[2].midi).toBe(64);
  });
  it("latch: the arpeggio runs on after the keys are let go, a new chord takes over, and unlatching stops it", () => {
    const r = rig({ rate: "1/8" });
    r.keys.setLatch(true);
    r.keys.press(60);
    r.keys.press(64);
    r.keys.release(60);
    r.keys.release(64);
    expect(r.keys.running).toBe(true);
    expect(r.keys.keys).toEqual([60, 64]);
    r.run(11);
    const n = r.notes.length;
    expect(n).toBeGreaterThan(2);
    // a new chord, once every finger is up, replaces the latched one
    r.keys.press(62);
    r.keys.press(65);
    expect(r.keys.keys).toEqual([62, 65]);
    r.keys.release(62);
    r.keys.release(65);
    r.run(12);
    expect(r.notes.slice(n + 1).every((x) => [62, 65].includes(x.midi))).toBe(true);
    // unlatching lets go of every key no finger is on: it stops
    r.keys.setLatch(false);
    expect(r.keys.running).toBe(false);
    const m = r.notes.length;
    r.run(13);
    expect(r.notes.length).toBe(m);
  });
  it("latch: a key still held stays when unlatched; stopping all sound unlatches", () => {
    const r = rig();
    r.keys.setLatch(true);
    r.keys.press(60);
    r.keys.press(67);
    r.keys.release(67);
    r.keys.setLatch(false);
    expect(r.keys.keys).toEqual([60]);
    r.keys.setLatch(true);
    r.keys.unlatch();
    expect(r.keys.latched).toBe(false);
    expect(r.keys.running).toBe(false);
    expect(r.keys.keys).toEqual([]);
  });
  it("without the latch, letting go stops it as before", () => {
    const r = rig();
    r.keys.press(60);
    r.keys.release(60);
    expect(r.keys.running).toBe(false);
  });
});
