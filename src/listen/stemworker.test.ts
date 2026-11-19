import { describe, expect, it } from "vitest";
import { renderPiece } from "../canvas/pieces";
import type { FromWorker, ToWorker } from "./layers.worker";

// the worker, run here: its `self` is stood in for, and what it posts is kept
const posted: FromWorker[] = [];
const self = { postMessage: (m: FromWorker) => posted.push(m), onmessage: null as ((e: MessageEvent<ToWorker>) => void) | null };
(globalThis as unknown as { self: typeof self }).self = self;
await import("./layers.worker");
const send = (m: ToWorker) => self.onmessage!({ data: m } as MessageEvent<ToWorker>);
const wait = async (until: () => boolean, ms = 30_000) => {
  const end = Date.now() + ms;
  while (!until() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
};

/** A stem, left and right interleaved, as the engine writes it. */
function interleave(x: Float32Array, from: number, to: number): ArrayBuffer {
  const out = new Float32Array((to - from) * 2);
  for (let i = from; i < to; i++) out[2 * (i - from)] = out[2 * (i - from) + 1] = x[i];
  return out.buffer;
}

describe("the worker takes a model's stems as the engine wrote them", () => {
  const piece = renderPiece({ seed: 4, seconds: 8, bpm: 110, key: 2, drums: { level: 0.8 }, bass: { level: 0.7 }, pad: { level: 0.5 }, vocal: { level: 0.6 } });
  const names = ["drums", "bass", "other", "vocals"] as const;
  const stem = (n: (typeof names)[number]) => piece.stems[n === "other" ? "chords" : n] ?? piece.stems.other ?? new Float32Array(piece.left.length);

  it("interleaved stretches are taken apart there and heard as far as they reach; the end lets it hear the rest", async () => {
    posted.length = 0;
    send({ type: "open", id: 1, sr: piece.sr, left: piece.left.slice(), right: piece.right.slice(), ref: -20 });
    send({ type: "stems", id: 1, pass: 1, names: [...names], rate: piece.sr, from: 0 });
    const half = Math.floor(piece.left.length / 2);
    send({ type: "stem-raw", id: 1, at: 0, channels: 2, raw: Object.fromEntries(names.map((n) => [n, interleave(stem(n), 0, half)])) });
    await wait(() => posted.some((m) => m.type === "better" && m.to > 2));
    await new Promise((r) => setTimeout(r, 200));
    const better = () => posted.filter((m): m is Extract<FromWorker, { type: "better" }> => m.type === "better");
    // heard up to where the stems were handed over, and no further
    const reach = Math.max(...better().map((m) => m.to));
    expect(reach).toBeGreaterThan(1.5);
    expect(reach).toBeLessThanOrEqual(half / piece.sr);
    expect(better().some((m) => m.layers.some((l) => l.frames.length > 0))).toBe(true);
    send({ type: "stem-raw", id: 1, at: half, channels: 2, raw: Object.fromEntries(names.map((n) => [n, interleave(stem(n), half, piece.left.length)])) });
    send({ type: "stems-end", id: 1 });
    await wait(() => better().some((m) => m.to >= 7.9));
    expect(Math.max(...better().map((m) => m.to))).toBeCloseTo(8, 1);
  });

  it("stopped part way, the second pass hears no further and waits for nothing; the first goes on", async () => {
    posted.length = 0;
    send({ type: "open", id: 2, sr: piece.sr, left: piece.left.slice(), right: piece.right.slice(), ref: -20 });
    send({ type: "stems", id: 2, pass: 1, names: [...names], rate: piece.sr, from: 0 });
    const part = Math.floor(piece.sr * 3);
    send({ type: "stem-raw", id: 2, at: 0, channels: 2, raw: Object.fromEntries(names.map((n) => [n, interleave(stem(n), 0, part)])) });
    await wait(() => posted.some((m) => m.type === "better"));
    send({ type: "stems-stop", id: 2 });
    // stems handed over after the stop are not taken
    send({ type: "stem-raw", id: 2, at: part, channels: 2, raw: Object.fromEntries(names.map((n) => [n, interleave(stem(n), part, piece.left.length)])) });
    await wait(() => posted.some((m) => m.type === "vibe" && m.final));
    await new Promise((r) => setTimeout(r, 200));
    const reach = Math.max(...posted.filter((m) => m.type === "better").map((m) => (m as { to: number }).to));
    expect(reach).toBeLessThanOrEqual(3);
    // the first pass heard the whole song
    expect(Math.max(...posted.filter((m) => m.type === "heard").map((m) => (m as { to: number }).to))).toBeCloseTo(8, 1);
    send({ type: "close" });
  });
});
