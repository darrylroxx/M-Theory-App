import { describe, expect, it } from "vitest";
import { renderPiece, type PieceSpec } from "../canvas/pieces";
import type { LayerKind } from "../canvas/layers";
import type { Frame } from "./ear";
import { LayerAnalysis } from "./layers";
import { SignalStems, type StemChunk, type StemSource, type Stereo } from "./split";
import { PushedStems } from "./pushed";
import { LayerStore } from "./store";
import { loudest } from "./songfile";
import { lookDistance, lookOf, normalise, vibeDistance } from "../canvas/vibe";

async function hear(spec: PieceSpec, source: StemSource = new SignalStems()) {
  const p = renderPiece(spec);
  const mono = p.left.map((l, i) => 0.5 * (l + p.right[i]));
  const job = new LayerAnalysis({ sr: p.sr, left: p.left, right: p.right }, source, loudest(mono, p.sr));
  await job.prepare();
  const by = new Map<string, { layer: LayerKind; frames: Frame[] }>();
  const tos: number[] = [];
  let mix = 0;
  for (;;) {
    const h = await job.step(2);
    if (!h) break;
    tos.push(h.to);
    mix += h.mix.length;
    for (const lf of h.layers) {
      const e = by.get(lf.key) ?? { layer: lf.layer, frames: [] };
      e.frames.push(...lf.frames);
      by.set(lf.key, e);
    }
  }
  return { by, tos, mix, job, piece: p };
}
const fundamentals = (fs: Frame[]) => fs.flatMap((f) => f.voices.filter((v) => v.of === undefined));
/** The tones that begin in a layer's frames, loud enough to be painted as more than a speck. */
const births = (fs: Frame[] | undefined) => (fs ?? []).flatMap((f) => f.voices.filter((v) => v.fresh && v.of === undefined && v.amp > 0.1));

describe("a song from a file, heard layer by layer", () => {
  it("drums, bass, a voice and the rest each reach their own layer", async () => {
    const { by, tos, mix } = await hear({ seed: 4, seconds: 10, bpm: 100, key: 0, drums: { level: 0.9 }, bass: { level: 0.8 }, pluck: { level: 0.6 }, vocal: { level: 0.8 } });
    const hits = (k: string) => (by.get(k)?.frames ?? []).reduce((n, f) => n + f.hits.length, 0);
    expect(hits("drums")).toBeGreaterThan(10);
    const bass = fundamentals(by.get("bass")!.frames);
    expect(bass.length).toBeGreaterThan(50);
    expect(bass.filter((v) => v.hz < 200).length / bass.length).toBeGreaterThan(0.8);
    const voice = fundamentals(by.get("vocals")!.frames);
    expect(voice.length).toBeGreaterThan(50);
    // the plucked chords are shared out as chords
    expect(fundamentals(by.get("chords")?.frames ?? []).length).toBeGreaterThan(50);
    // all of it in time order, heard ahead to the end
    for (const e of by.values()) for (let i = 1; i < e.frames.length; i++) expect(e.frames[i].t).toBeGreaterThanOrEqual(e.frames[i - 1].t);
    for (let i = 1; i < tos.length; i++) expect(tos[i]).toBeGreaterThanOrEqual(tos[i - 1]);
    expect(tos[tos.length - 1]).toBeCloseTo(10, 1);
    expect(mix).toBeGreaterThan(900);
  });

  it("a song of drums alone is painted as drums: their ring, the hats' hiss and the scraps of the split are not taken for tones", async () => {
    const { by, piece } = await hear({ seed: 5, seconds: 12, bpm: 100, key: 0, drums: { level: 0.9, busy: true, open: true } });
    const hits = (by.get("drums")?.frames ?? []).reduce((n, f) => n + f.hits.length, 0);
    expect(hits).toBeGreaterThan(piece.notes.length * 0.5);
    // (before the scraps were let go of: about 50 tones in the bass, 20 in the chords, 28 in the melody, 300 in the voice)
    expect(births(by.get("bass")?.frames).length).toBeLessThan(6);
    expect(births(by.get("chords")?.frames).length + births(by.get("melody")?.frames).length).toBeLessThan(15);
    expect(births(by.get("vocals")?.frames).length).toBeLessThan(80);
  });

  it("knows the vibe of the whole song by the end of it, and hears the same song the same way twice", async () => {
    const spec: PieceSpec = { seed: 8, seconds: 8, bpm: 110, key: 3, drums: { level: 0.8, busy: true }, bass: { level: 0.7, pulse: true }, melody: { level: 0.7 } };
    const a = await hear(spec);
    const b = await hear(spec);
    expect(a.job.vibe.heard).toBeGreaterThan(6);
    expect(Array.from(a.job.vibe.fingerprint())).toEqual(Array.from(b.job.vibe.fingerprint()));
    expect([...a.by.keys()].sort()).toEqual([...b.by.keys()].sort());
    for (const [k, e] of a.by) expect(e.frames.length).toBe(b.by.get(k)!.frames.length);
  });

  it("two songs from files with the same parts paint alike, and a song with other parts does not", async () => {
    const base = (o: Partial<PieceSpec>): PieceSpec => ({ seed: 1, seconds: 14, bpm: 100, key: 0, ...o });
    const A = base({ seed: 1, bpm: 96, key: 0, drums: { level: 0.8, busy: true }, bass: { level: 0.7, pulse: true }, pluck: { level: 0.6 }, melody: { level: 0.7, staccato: true } });
    const A2 = base({ seed: 7, bpm: 102, key: 5, gain: 0.5, tilt: 3, drums: { level: 0.7, busy: true }, bass: { level: 0.8, pulse: true }, pluck: { level: 0.5 }, melody: { level: 0.8, staccato: true } });
    const B = base({ seed: 3, bpm: 70, key: 9, minor: true, pad: { level: 0.7 }, vocal: { level: 0.7, breathy: true }, harmony: { level: 0.4 } });
    const fp = async (s: PieceSpec) => normalise((await hear(s)).job.vibe.fingerprint());
    const [a, a2, b] = [await fp(A), await fp(A2), await fp(B)];
    expect(vibeDistance(a, a2) * 2.5).toBeLessThan(vibeDistance(a, b));
    const [la, la2, lb] = [lookOf(a), lookOf(a2), lookOf(b)];
    expect(lookDistance(la, la2) * 2).toBeLessThan(lookDistance(la, lb));
    const best = (l: ReturnType<typeof lookOf>) => Object.entries(l.layouts).sort((x, y) => y[1] - x[1])[0][0];
    expect(best(la)).toBe(best(la2));
    expect(best(la)).not.toBe(best(lb));
    expect(Math.round(la.turn)).toBe(Math.round(la2.turn));
  });

  it("any source of stems will do: a model's stems can take the place of the split with nothing else changed", async () => {
    // a source that hands over the parts of a piece made from nothing, as a model would
    const spec: PieceSpec = { seed: 2, seconds: 6, bpm: 100, key: 0, drums: { level: 0.8 }, bass: { level: 0.8 }, vocal: { level: 0.8 } };
    const piece = renderPiece(spec);
    let at = 0;
    const exact: StemSource = {
      id: "exact",
      approx: false,
      async prepare(_s: Stereo) {},
      seek(from: number) {
        at = from;
      },
      async next(max: number): Promise<StemChunk | null> {
        if (at >= piece.left.length) return null;
        const end = Math.min(piece.left.length, at + max);
        const part = (x?: Float32Array) => (x ? x.slice(at, end) : new Float32Array(end - at));
        const c = { from: at, length: end - at, stems: { drums: part(piece.stems.drums), bass: part(piece.stems.bass), vocals: part(piece.stems.vocals), other: part(piece.stems.other) } };
        at = end;
        return c;
      },
    };
    const { by } = await hear(spec, exact);
    expect(fundamentals(by.get("vocals")!.frames).length).toBeGreaterThan(30);
    expect(fundamentals(by.get("bass")!.frames).every((v) => v.hz < 300)).toBe(true);
    // the drums stem has only drums in it: no tones are followed there
    expect(by.get("drums")!.frames.every((f) => f.voices.length === 0)).toBe(true);
  });
});

describe("a model's stems, handed over as they are made", () => {
  /** A piece's parts as a model would make them: stereo, at the rate the song was recorded at. */
  function modelStems(spec: PieceSpec, rate: number) {
    const piece = renderPiece({ ...spec, sr: rate });
    const two = (x?: Float32Array) => (x ? [x, x.slice()] : [new Float32Array(piece.left.length), new Float32Array(piece.left.length)]);
    const other = new Float32Array(piece.left.length);
    for (const l of ["chords", "other", "melody", "harmony"] as const) {
      const x = piece.stems[l];
      if (x) for (let i = 0; i < x.length; i++) other[i] += x[i];
    }
    return { piece, stems: { drums: two(piece.stems.drums), bass: two(piece.stems.bass), vocals: two(piece.stems.vocals), other: two(other) } };
  }

  it("are heard stretch by stretch as they come, at their own rate, from where they take over; and waited for where they are not ready", async () => {
    const spec: PieceSpec = { seed: 6, seconds: 8, bpm: 100, key: 2, drums: { level: 0.8 }, bass: { level: 0.8 }, vocal: { level: 0.8 }, pluck: { level: 0.5 } };
    // the page decoded the song at 48 kHz; the model made its stems at 44.1 kHz
    const song = renderPiece({ ...spec, sr: 48000 });
    const model = modelStems(spec, 44100);
    const source = new PushedStems(["drums", "bass", "vocals", "other"], 44100);
    const job = new LayerAnalysis({ sr: song.sr, left: song.left, right: song.right }, source, -20, { from: 2, mix: false });
    await job.prepare();
    expect(source.ready()).toBe(0);
    const hand = (from: number, to: number) => {
      const s = Object.fromEntries(Object.entries(model.stems).map(([k, ch]) => [k, ch.map((c) => c.slice(Math.round(from * 44100), Math.round(to * 44100)))]));
      source.push(Math.round(from * 44100), s);
    };
    // the first stretch is ready: the stems are heard up to it, and then the hearing waits
    hand(0, 4);
    expect(source.ready()).toBeCloseTo(4, 3);
    const first = await job.step(1.5);
    expect(first!.to).toBeGreaterThan(3);
    let more = false;
    const waiting = job.step(3).then((h) => ((more = true), h));
    await new Promise((r) => setTimeout(r, 20));
    expect(more).toBe(false);
    // the rest comes (overlapping what was handed over before: only the new part is taken), and the model is done
    hand(3.5, 8);
    source.end();
    expect(source.ready()).toBe(Infinity);
    const all = [first!, (await waiting)!];
    for (;;) {
      const h = await job.step(2);
      if (!h) break;
      all.push(h);
    }
    expect(all[all.length - 1].to).toBeCloseTo(8, 1);
    const by = new Map<string, Frame[]>();
    for (const h of all) {
      expect(h.mix).toHaveLength(0);
      for (const lf of h.layers) by.set(lf.key, [...(by.get(lf.key) ?? []), ...lf.frames]);
    }
    // nothing from before the stems took over; then each part in its own layer
    for (const fs of by.values()) for (const f of fs) expect(f.t).toBeGreaterThan(1.9);
    expect((by.get("drums") ?? []).reduce((n, f) => n + f.hits.length, 0)).toBeGreaterThan(5);
    const bass = fundamentals(by.get("bass") ?? []);
    expect(bass.length).toBeGreaterThan(20);
    expect(bass.every((v) => v.hz < 200)).toBe(true);
    expect(births(by.get("vocals")).length).toBeGreaterThan(5);
    expect(births(by.get("chords")).length + births(by.get("melody")).length).toBeGreaterThan(5);
  });

  it("a six-stem model's guitar and piano each get hands of their own", async () => {
    const spec: PieceSpec = { seed: 3, seconds: 4, bpm: 100, key: 0, pluck: { level: 0.7 }, melody: { level: 0.7 } };
    const piece = renderPiece(spec);
    const source = new PushedStems(["drums", "bass", "vocals", "other", "guitar", "piano"], piece.sr);
    const job = new LayerAnalysis({ sr: piece.sr, left: piece.left, right: piece.right }, source, -20, { mix: false });
    await job.prepare();
    source.push(0, { guitar: [piece.stems.other!], piano: [piece.stems.melody!] });
    source.end();
    const keys = new Set<string>();
    for (;;) {
      const h = await job.step(2);
      if (!h) break;
      for (const lf of h.layers) if (lf.frames.some((f) => f.voices.length)) keys.add(lf.key);
    }
    expect([...keys].some((k) => k.startsWith("guitar:"))).toBe(true);
    expect([...keys].some((k) => k.startsWith("piano:"))).toBe(true);
  });

  it("the painting is made from the model's stems wherever they have been heard, and from the quick split everywhere else", () => {
    const store = new LayerStore();
    const fr = (t: number, id: number): Frame => ({ t, voices: [{ id, hz: 440, amp: 0.5, peak: 0.5, born: t, age: 0, struck: 0.5, fresh: true }], ended: [], hits: [], noise: new Float32Array(1), level: 0.5, db: -20, centroid: 1000, flat: 0.1, flux: 0, chroma: new Float32Array(12) });
    const frames = (id: number) => Array.from({ length: 1000 }, (_, k) => fr(k * 0.01, id));
    store.addFirst([], [{ key: "melody", layer: "melody", frames: frames(1) }], 10);
    expect(store.ready(9)).toBe(true);
    store.beginBetter(2);
    store.addBetter([{ key: "melody", layer: "melody", frames: frames(2).filter((f) => f.t > 2 && f.t <= 5) }], 5);
    const ids = (from: number, to: number) => [...new Set(store.between(from, to).ears.flatMap((e) => e.frames.flatMap((f) => f.voices.map((v) => v.id))))];
    expect(ids(1, 1.5)).toEqual([1]);
    expect(ids(2.5, 3)).toEqual([2]);
    expect(store.between(3, 3.5).better).toBe(true);
    // past where the model has got: the quick split again
    expect(ids(5.5, 6)).toEqual([1]);
    expect(store.betterSpan).toEqual({ from: 2, to: 5 });
  });
});
