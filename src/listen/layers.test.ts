import { describe, expect, it } from "vitest";
import { renderPiece, type PieceSpec } from "../canvas/pieces";
import type { LayerKind } from "../canvas/layers";
import type { Frame } from "./ear";
import { LayerAnalysis } from "./layers";
import { SignalStems, type StemChunk, type StemSource, type Stereo } from "./split";
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
