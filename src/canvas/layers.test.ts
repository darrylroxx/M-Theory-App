import { describe, expect, it } from "vitest";
import type { DrumPulse, NotePulse } from "../audio/pulse";
import type { Sound } from "../audio/describe";
import { reviveTracks } from "../song/tracks";
import { hexToRgb, luminance } from "./color";
import { cueOfPulse } from "./cues";
import { LAYERS, LAYER_INFO, LAYER_ORDER, layerColours, layerOfTrack, layerOfTrack5, type LayerKind } from "./layers";
import { MARGIN, hzOfMidi, noteColors, upOfHz, yOfHz } from "./layout";
import { PALETTES, getPalette } from "./palettes";
import { yOfUp } from "./place";
import { reflOf, type Stamp } from "./sim";
import { LayerHand, type Cue, type Manner } from "./strokes";
import { NOISE_BANDS, noiseHz, type Frame, type Voice } from "../listen/ear";

const W = 1000;
const H = 560;
const PASS = 16;
const steady: Manner = { wet: 0.4, loose: 0.3, body: 1 };

/** A hand for a layer on a sweep across the canvas, keeping every mark it makes. */
function hand(layer: LayerKind, run = 1, manner = steady) {
  const h = new LayerHand(layer);
  h.size(W, H);
  const pal = getPalette("woodblock");
  h.colours(layerColours(pal), pal.colors.map(hexToRgb), noteColors(0, [0, 2, 4, 5, 7, 9, 11], pal.colors.length));
  h.manner = manner;
  h.run = run;
  h.where = (t, up) => ({ x: W * (MARGIN + ((t % PASS) / PASS) * (1 - 2 * MARGIN)), y: yOfUp(up, H), dx: 1, dy: 0, seg: Math.floor(t / PASS), scale: 1 });
  const marks: Stamp[] = [];
  h.put = (s) => marks.push(s);
  return { h, marks };
}
/** Play a list of sounds into a hand (notes start, hits are thrown), a sixtieth of a second at a time. */
function play(layer: LayerKind, sounds: (Cue & { hit?: boolean })[], until: number, run = 1, manner = steady): Stamp[] {
  const { h, marks } = hand(layer, run, manner);
  const list = [...sounds].sort((a, b) => a.t - b.t);
  let i = 0;
  for (let t = 0; t <= until; t += 1 / 60) {
    while (i < list.length && list[i].t <= t + 1e-9) {
      const c = list[i++];
      if (c.hit) h.hit(c);
      else h.start(c);
    }
    h.advance(t);
  }
  return marks;
}
let ids = 1;
const note = (t: number, midi: number, len: number, o: Partial<Cue> = {}): Cue => ({ id: ids++, t, hz: hzOfMidi(midi), amp: 0.75, attack: 0.5, bright: 0.5, rough: 0.15, len, ring: 1.5, ...o });
const drum = (t: number, drum: string, hz: number, o: Partial<Cue> = {}): Cue & { hit: true } => ({ id: -1, t, hz, amp: 0.8, attack: 1, bright: 0.6, rough: drum === "kick" ? 0.2 : 0.85, len: 0, ring: 0.3, drum, hit: true, ...o });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const share = (marks: Stamp[], f: (m: Stamp) => boolean) => marks.filter(f).length / Math.max(1, marks.length);
const xOfT = (t: number) => W * (MARGIN + (t / PASS) * (1 - 2 * MARGIN));
/** The longest run of marks along the canvas with no gap wider than `gap` pixels. */
function longestRun(marks: Stamp[], gap = 12): number {
  const xs = marks.map((m) => m.x).sort((a, b) => a - b);
  let best = 0;
  let from = xs[0] ?? 0;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > gap) from = xs[i];
    best = Math.max(best, xs[i] - from);
  }
  return best;
}
const fakeSound = (centre: number, noise = 0.1): Sound => ({ parts: [{ gain: 1, noise }], centre, attack: 0.8, ring: 0.6 }) as unknown as Sound;

describe("the layers of a song", () => {
  it("seven roles, lying in a fixed order: fog and washes underneath, lines in the middle, glaze and impacts on top", () => {
    expect(new Set(LAYERS)).toEqual(new Set(LAYER_ORDER));
    expect(LAYERS).toHaveLength(7);
    const depth = (l: LayerKind) => LAYER_INFO[l].depth;
    expect(depth("other")).toBeLessThan(depth("chords"));
    expect(depth("chords")).toBeLessThan(depth("bass"));
    expect(depth("bass")).toBeLessThan(depth("harmony"));
    expect(depth("harmony")).toBeLessThan(depth("melody"));
    expect(depth("melody")).toBeLessThan(depth("vocals"));
    expect(depth("vocals")).toBeLessThan(depth("drums"));
  });

  it("each track of the app's own song is painted in the layer of its kind, and a track marked as a harmony in the harmony's", () => {
    expect(layerOfTrack({ kind: "chords" })).toBe("chords");
    expect(layerOfTrack({ kind: "melody" })).toBe("melody");
    expect(layerOfTrack({ kind: "drums" })).toBe("drums");
    expect(layerOfTrack({ kind: "vocals" })).toBe("vocals");
    // the track view's tracks: a bass has its own paint, a blank audio track is "everything else"
    expect(layerOfTrack5({ kind: "bass" })).toBe("bass");
    expect(layerOfTrack5({ kind: "audio" })).toBe("other");
    expect(layerOfTrack5({ kind: "vocals" })).toBe("vocals");
    expect(layerOfTrack5({ kind: "melody", role: "harmony" })).toBe("harmony");
    expect(layerOfTrack5({ kind: "bass", role: "harmony" })).toBe("bass");
    for (const kind of ["chords", "melody", "drums"] as const) expect(layerOfTrack5({ kind })).toBe(layerOfTrack({ kind }));
    expect(layerOfTrack({ kind: "melody", role: "harmony" })).toBe("harmony");
    expect(layerOfTrack({ kind: "chords", role: "harmony" })).toBe("harmony");
    expect(layerOfTrack({ kind: "drums", role: "harmony" })).toBe("drums");
  });

  it("the harmony mark is kept with a saved song, and nothing else is let in its place", () => {
    const t = reviveTracks([
      { id: "m2", kind: "melody", name: "Melody 2", role: "harmony" },
      { id: "c2", kind: "chords", name: "Chords 2", role: "harmony" },
      { id: "d2", kind: "drums", name: "Drums 2", role: "harmony" },
      { id: "m3", kind: "melody", name: "Melody 3", role: "lead" },
      { id: "v1", kind: "vocals", name: "Vocal 1" },
    ])!;
    expect(t.map((x) => x.role)).toEqual(["harmony", "harmony", undefined, undefined, undefined]);
    // a song saved before there were roles loads as it was
    expect(reviveTracks([{ id: "m2", kind: "melody", name: "Melody 2" }])![0]).not.toHaveProperty("role");
  });

  it("every note the app plays is a cue for its layer: the low strings of the chords are the bass, a drum is a hit, and a track's fader sets how loud", () => {
    const n = (midi: number, track?: string): NotePulse => ({ kind: "chord", track, time: 3, midi, velocity: 0.8, length: 0.5, slot: 0, gain: 1, cutoff: 3000, octave: 0, sound: fakeSound(400) });
    const layer = (t: string): LayerKind => (t === "m2" ? "harmony" : t.startsWith("c") ? "chords" : "melody");
    const hand = (t: string) => `hand:${t}`;
    const low = cueOfPulse(n(40), 1, layer, () => 1, hand);
    expect(low.layer).toBe("bass");
    expect(low.key).toBe("hand:chords:bass");
    const high = cueOfPulse(n(64), 2, layer, () => 1, hand);
    expect(high.layer).toBe("chords");
    expect(high.cue.len).toBe(0.5);
    expect(high.cue.t).toBe(3);
    expect(cueOfPulse({ ...n(70, "m2"), kind: "melody" }, 3, layer, () => 1, hand).layer).toBe("harmony");
    // a quieter fader, a quieter cue
    expect(cueOfPulse(n(64), 4, layer, () => 0.25, hand).cue.amp).toBeLessThan(high.cue.amp * 0.4);
    const d: DrumPulse = { kind: "drum", time: 2, drum: "snare", velocity: 0.9, gain: 1, sound: fakeSound(1800, 0.8) };
    const hit = cueOfPulse(d, 5, layer, () => 1, hand);
    expect(hit.layer).toBe("drums");
    expect(hit.hit).toBe(true);
    expect(hit.cue.drum).toBe("snare");
    expect(hit.cue.rough).toBeGreaterThan(0.5);
  });

  it("each layer has its own colour from the palette in use, and the weight at the bottom stands out from the ground", () => {
    for (const p of PALETTES) {
      const c = layerColours(p);
      const g = luminance(p.ground);
      const lum = (rgb: number[]) => luminance(`#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`);
      expect(Math.abs(lum(c.kick) - g)).toBeGreaterThan(0.08);
      // the fog is close to the ground; the bass is not
      expect(Math.abs(lum(c.other) - g)).toBeLessThan(Math.abs(lum(c.bass) - g) + 0.05);
    }
  });
});

describe("each layer paints in its own kind of paint", () => {
  const drums = play("drums", [drum(0.2, "kick", 60), drum(0.7, "snare", 1800), drum(1.2, "kick", 60), drum(1.7, "snare", 1800), ...[0.45, 0.95, 1.45, 1.95].map((t) => drum(t, "hat", 9000, { amp: 0.5, ring: 0.05 }))], 2.4);
  const bass = play("bass", [note(0.2, 33, 1.6, { amp: 0.85, attack: 0.5, ring: 2 })], 2.2);
  const chords = play("chords", [60, 64, 67].map((m) => note(0.2, m, 1.8, { attack: 0.15, ring: 3 })), 2.4);
  const stab = play("chords", [60, 64, 67].map((m) => note(0.2, m, 0.08, { attack: 0.95, ring: 0.5 })), 0.8);
  const line = [72, 74, 76, 77, 76, 74].map((m, i) => note(0.2 + i * 0.3, m, 0.3));
  const melody = play("melody", line, 2.4);
  const vocals = play("vocals", [note(0.2, 64, 1.8, { attack: 0.2, rough: 0.4 })], 2.4);
  const fog = (() => {
    const { h, marks } = hand("other");
    h.texture = { bright: 0.5, rough: 0.3, level: 0.7, floor: 0.7 };
    for (let t = 0; t < 3; t += 1 / 60) h.advance(t);
    return marks;
  })();

  it("drums are impacts: soft blots for the kick, bursts of drops for the snare, specks for the hats; never a long line", () => {
    expect(share(drums, (m) => m.kind === 1)).toBeGreaterThan(0.6);
    // the kick's blot, low down
    const blots = drums.filter((m) => m.kind === 2 && m.r > 10);
    expect(blots.length).toBeGreaterThanOrEqual(2);
    for (const b of blots) expect(b.y).toBeGreaterThan(H * 0.6);
    // the hats near the top
    const top = drums.filter((m) => m.y < H * 0.25);
    expect(top.length).toBeGreaterThan(8);
    expect(longestRun(drums.filter((m) => m.kind === 0 && m.load > 0.6), 6)).toBeLessThan(40);
  });

  it("the bass is a broad, flat, heavy band low down", () => {
    const body = bass.filter((m) => m.kind === 0);
    expect(mean(body.map((m) => m.stretch))).toBeGreaterThan(2);
    expect(mean(body.map((m) => m.y))).toBeGreaterThan(H * 0.75);
    // as long as the note
    expect(longestRun(body)).toBeGreaterThan((xOfT(1.8) - xOfT(0.2)) * 0.85);
    // and broader than the melody's line
    expect(mean(body.map((m) => m.r))).toBeGreaterThan(1.8 * mean(melody.filter((m) => m.kind === 0).map((m) => m.r)));
  });

  it("held chords are a thin, wide wash from the lowest note to the highest; a stab is a hard block", () => {
    const wash = chords.filter((m) => m.kind === 2);
    expect(wash.length).toBeGreaterThan(30);
    expect(mean(wash.map((m) => m.paint))).toBeLessThan(0.08);
    const ys = wash.map((m) => m.y);
    // from below the lowest note (C) to above the highest (G): more than the fifth between them
    const span = Math.max(...ys) - Math.min(...ys);
    expect(span).toBeGreaterThan(Math.abs(yOfHz(hzOfMidi(60), H) - yOfHz(hzOfMidi(67), H)));
    expect(longestRun(wash, 20)).toBeGreaterThan((xOfT(2) - xOfT(0.2)) * 0.8);
    const block = stab.filter((m) => m.hard >= 0.9);
    expect(block.length).toBeGreaterThan(1);
    expect(stab.filter((m) => m.kind === 2 && m.hard < 0.3).length).toBe(0);
  });

  it("the melody is one line: notes that join are one stroke from the first to the last", () => {
    const body = melody.filter((m) => m.kind === 0);
    expect(longestRun(body, 6)).toBeGreaterThan((xOfT(0.2 + 6 * 0.3) - xOfT(0.2)) * 0.9);
    expect(mean(body.map((m) => m.paint))).toBeGreaterThan(0.1);
  });

  it("the harmony is a thinner, lighter line of its own, hatched to the melody where the two run close", () => {
    const { h: mel, marks: mm } = hand("melody");
    const { h: har, marks: hm } = hand("harmony");
    har.partner = mel;
    const lineA = [72, 74, 76, 77, 76, 74];
    let i = 0;
    for (let t = 0; t <= 2.4; t += 1 / 60) {
      while (i < lineA.length && 0.2 + i * 0.3 <= t) {
        mel.start(note(0.2 + i * 0.3, lineA[i], 0.3));
        har.start(note(0.2 + i * 0.3, lineA[i] - 3, 0.3));
        i++;
      }
      mel.advance(t);
      har.advance(t);
    }
    const line = (ms: Stamp[]) => ms.filter((m) => m.kind === 0 && m.stretch < 2);
    expect(mean(line(hm).map((m) => m.r))).toBeLessThan(0.8 * mean(line(mm).map((m) => m.r)));
    const hatch = hm.filter((m) => m.hard === 0.7 && m.load === 0.55);
    expect(hatch.length).toBeGreaterThan(5);
  });

  it("the voice is a ribbon of fine strands glazed on in light", () => {
    const glaze = vocals.filter((m) => m.kind === 3);
    expect(share(vocals, (m) => m.kind === 3)).toBeGreaterThan(0.9);
    expect(mean(glaze.map((m) => m.r))).toBeLessThan(3);
    expect(longestRun(glaze)).toBeGreaterThan((xOfT(2) - xOfT(0.2)) * 0.8);
  });

  it("a held voice that comes round to the other side of the canvas is lifted with all its strands: nothing is drawn across", () => {
    const ms = play("vocals", [note(15.2, 64, 1.6, { attack: 0.2 })], 17.2);
    expect(ms.filter((m) => m.x < W * 0.2).length).toBeGreaterThan(10);
    expect(ms.filter((m) => m.x > W * 0.8).length).toBeGreaterThan(10);
    expect(ms.filter((m) => m.x > W * 0.25 && m.x < W * 0.75)).toHaveLength(0);
  });

  it("the other sounds are fog: huge, edge-less and very thin", () => {
    expect(fog.length).toBeGreaterThan(5);
    for (const m of fog) {
      expect(m.kind).toBe(2);
      expect(m.r).toBeGreaterThan(25);
      expect(m.paint).toBeLessThan(0.06);
      expect(m.hard).toBeLessThan(0.05);
    }
  });

  it("they differ in size by role: fog much larger than washes, washes than the bass band, the band than the line, the line than the specks", () => {
    const r = (ms: Stamp[]) => mean(ms.map((m) => m.r));
    expect(r(fog)).toBeGreaterThan(2 * r(chords.filter((m) => m.kind === 2)));
    expect(r(chords.filter((m) => m.kind === 2))).toBeGreaterThan(r(bass.filter((m) => m.kind === 0)));
    expect(r(bass.filter((m) => m.kind === 0))).toBeGreaterThan(r(melody.filter((m) => m.kind === 0)));
    expect(r(melody.filter((m) => m.kind === 0))).toBeGreaterThan(r(drums.filter((m) => m.y < H * 0.25)));
  });
});

describe("the marks answer the sound", () => {
  it("louder is bigger and more heavily loaded", () => {
    const loud = play("melody", [note(0.2, 72, 1, { amp: 0.95 })], 1.3).filter((m) => m.kind === 0);
    const soft = play("melody", [note(0.2, 72, 1, { amp: 0.25 })], 1.3).filter((m) => m.kind === 0);
    expect(mean(loud.map((m) => m.r))).toBeGreaterThan(1.6 * mean(soft.map((m) => m.r)));
    expect(mean(loud.map((m) => m.paint))).toBeGreaterThan(mean(soft.map((m) => m.paint)));
  });

  it("staccato is a dab, legato a stroke as long as the note", () => {
    const short = play("melody", [note(0.2, 72, 0.06)], 1).filter((m) => m.kind === 0);
    const held = play("melody", [note(0.2, 72, 1.5)], 2).filter((m) => m.kind === 0);
    expect(longestRun(short)).toBeLessThan(26);
    expect(longestRun(held)).toBeGreaterThan(xOfT(1.7) - xOfT(0.2) - 10);
  });

  it("a struck sound lands with a hard edge and throws paint; one that swells in has a soft one", () => {
    let struck = 0;
    let swelled = 0;
    let drops = 0;
    for (let k = 0; k < 12; k++) {
      const a = play("melody", [note(0.2, 72, 0.5, { attack: 1, amp: 0.9 })], 0.8, k);
      const b = play("melody", [note(0.2, 72, 0.5, { attack: 0, amp: 0.9 })], 0.8, k);
      struck += a.find((m) => m.kind === 0)!.hard;
      swelled += b.find((m) => m.kind === 0)!.hard;
      drops += a.filter((m) => m.kind === 1).length - b.filter((m) => m.kind === 1).length;
    }
    expect(struck).toBeGreaterThan(swelled + 12 * 0.15);
    expect(drops).toBeGreaterThan(0);
  });

  it("a noisy hit throws its drops wider than a clean one", () => {
    const spread = (rough: number) => {
      const ms = play("drums", [drum(0.3, "snare", 1800, { rough })], 0.6).filter((m) => m.kind === 1);
      const cx = mean(ms.map((m) => m.x));
      const cy = mean(ms.map((m) => m.y));
      return mean(ms.map((m) => Math.hypot(m.x - cx, m.y - cy)));
    };
    expect(spread(0.95)).toBeGreaterThan(spread(0.1) * 1.3);
  });

  it("a bright sound is painted lighter than a dull one", () => {
    const light = (bright: number) => {
      const ms = play("melody", [note(0.2, 72, 0.6, { bright })], 1).filter((m) => m.kind === 0);
      return mean(ms.map((m) => mean(m.k.map((k) => reflOf(k)))));
    };
    expect(light(0.95)).toBeGreaterThan(light(0.05) + 0.03);
  });

  it("a cymbal leaves a trail as long as it rings; a closed hat only a few specks", () => {
    const trail = (ring: number, d: string) => play("drums", [drum(0.3, d, 8000, { ring, amp: 0.8 })], 2).filter((m) => m.y < H * 0.35);
    const open = trail(1.5, "crash");
    const closed = trail(0.05, "hat");
    expect(open.length).toBeGreaterThan(closed.length * 1.5);
    expect(Math.max(...open.map((m) => m.x)) - Math.min(...open.map((m) => m.x))).toBeGreaterThan(Math.max(...closed.map((m) => m.x)) - Math.min(...closed.map((m) => m.x)) + 15);
  });

  it("the same music in the same run paints the same marks; a new run (Clear) paints new detail on the same structure", () => {
    const a = play("melody", line(), 2.2, 1);
    const again = play("melody", line(), 2.2, 1);
    const b = play("melody", line(), 2.2, 2);
    expect(again).toEqual(a);
    const key = (m: Stamp[]) => m.slice(0, 30).map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)},${s.r.toFixed(2)}`).join(" ");
    expect(key(a)).not.toBe(key(b));
    expect(Math.abs(mean(a.map((m) => m.y)) - mean(b.map((m) => m.y)))).toBeLessThan(6);
  });
});

describe("what an ear hears, painted", () => {
  /** A frame as an ear gives it: its tones, how loud it is, and its noise (0..1 in the bands below `noiseTop` hertz). */
  const heard = (t: number, voices: Partial<Voice>[], o: { db?: number; noise?: number; noiseTop?: number } = {}): Frame => ({
    t,
    voices: voices.map((v) => ({ id: 1, hz: 440, amp: 0.7, peak: 0.7, born: t, struck: 0.5, fresh: false, ...v, age: t - (v.born ?? t) })),
    ended: [],
    hits: [],
    noise: Float32Array.from({ length: NOISE_BANDS }, (_, b) => (noiseHz(b) < (o.noiseTop ?? 20000) ? o.noise ?? 0 : 0)),
    level: 0.6,
    db: o.db ?? -20,
    centroid: 1200,
    flat: 0.1,
    flux: 0,
    chroma: new Float32Array(12),
  });
  /** Hand a hand the frames of a tone that lives from `from` to `to` (seconds), and anything else in `more`. */
  function sound(h: LayerHand, from: number, to: number, voice: Partial<Voice>, more: (t: number) => Partial<Voice>[] = () => []) {
    for (let t = from; t <= to + 1e-9; t += 0.01) h.hear([heard(t, [{ ...voice, born: from, fresh: t - from < 0.005 }, ...more(t)])]);
  }

  it("an overtone the ear follows as a tone of its own leaves no mark of its own: it is part of its note", () => {
    const { h, marks } = hand("melody");
    sound(h, 0.2, 0.8, { id: 1, hz: 220, amp: 0.8 }, (t) => (t >= 0.21 ? [{ id: 2, hz: 440, amp: 0.55, born: 0.21, fresh: t < 0.215 }] : []));
    expect(h.down).toBe(1);
    const y440 = yOfUp(upOfHz(440), H);
    expect(marks.filter((m) => Math.abs(m.y - y440) < 6).length).toBe(0);
  });

  it("a tone the ear loses for a moment and finds again carries on its stroke: it is not set down afresh", () => {
    const run = (gap: number) => {
      const { h, marks } = hand("melody");
      sound(h, 0.2, 0.6, { id: 1, hz: 440, amp: 0.7 });
      h.hear([heard(0.61, [])]);
      const before = marks.length;
      sound(h, 0.6 + gap, 1.2, { id: 2, hz: 441, amp: 0.7 });
      // the biggest mark laid as the tone comes back
      const back = marks.slice(before, before + 6);
      const along = marks.slice(before + 10);
      return { first: Math.max(...back.map((m) => m.r)), usual: mean(along.map((m) => m.r)), k: back[0]?.k, k0: marks[before - 1]?.k };
    };
    const again = run(0.04);
    const fresh = run(0.4);
    // a new note is set down with weight; the same note picked up again is not, and keeps its paint
    expect(fresh.first).toBeGreaterThan(fresh.usual * 1.15);
    expect(again.first).toBeLessThan(again.usual * 1.15);
    expect(again.k).toEqual(again.k0);
  });

  it("fog comes from noise that goes on (air, breath, a room), not from a stem's loudness, nor from a hat's hiss", () => {
    const fogOf = (o: { noise: number; noiseTop?: number }) => {
      const { h, marks } = hand("other");
      for (let t = 0; t < 4; t += 0.01) {
        h.hear([heard(t, [], { db: -16, ...o })], false);
        h.advance(t);
      }
      return marks.filter((m) => m.r > 25).length;
    };
    expect(fogOf({ noise: 0 })).toBe(0);
    expect(fogOf({ noise: 0.45, noiseTop: 20000 })).toBeGreaterThan(5);
    // a hiss only up among the cymbals is the drums'
    const hiss = (() => {
      const { h, marks } = hand("other");
      for (let t = 0; t < 4; t += 0.01) {
        h.hear([heard(t, [], { db: -16, noise: 0, noiseTop: 0 })], true);
        h.advance(t);
      }
      return marks.length;
    })();
    expect(hiss).toBe(0);
  });

  it("a hit an ear hears that reaches right down and is not noisy is a kick: a soft blot laid where its thump is, not its click", () => {
    const { h, marks } = hand("drums");
    h.advance(0.1);
    h.hear([{ ...heard(0.2, []), hits: [{ strength: 0.9, lo: 70, hi: 16000, hz: 1900, noisy: 0.05 }] }]);
    const blots = marks.filter((m) => m.kind === 2 && m.r > 15);
    expect(blots.length).toBeGreaterThan(0);
    for (const m of blots) expect(m.y).toBeGreaterThan(yOfHz(150, H));
  });

  it("an ear that stops being heard (the painting has moved on to other stems) leaves no brush down", () => {
    const { h } = hand("melody");
    sound(h, 0.2, 0.5, { id: 1, hz: 440, amp: 0.7 });
    expect(h.down).toBe(1);
    h.advance(0.8);
    expect(h.down).toBe(1);
    h.advance(1.2);
    expect(h.down).toBe(0);
  });
});

function line(): Cue[] {
  return [72, 74, 76, 77].map((m, i) => ({ id: 900 + i, t: 0.2 + i * 0.4, hz: hzOfMidi(m), amp: 0.75, attack: 0.5, bright: 0.5, rough: 0.15, len: 0.4, ring: 1.5 }));
}
