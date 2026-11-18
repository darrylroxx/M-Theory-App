/**
 * The worker that hears a song from a file layer by layer (`layers.ts`), away from the page, so
 * the painting never waits for it. It is sent the song once and sends back what each layer did,
 * a couple of seconds of the song at a time, as fast as it can, and the song's vibe as it
 * becomes known.
 */
import { LayerAnalysis } from "./layers";
import { SignalStems } from "./split";

export type ToWorker = { type: "open"; id: number; sr: number; left: Float32Array; right: Float32Array; ref: number } | { type: "close" };
export type FromWorker =
  | { type: "ready"; id: number }
  | { type: "heard"; id: number; to: number; mix: import("./ear").Frame[]; layers: import("./layers").LayerFrames[] }
  | { type: "vibe"; id: number; fp: Float32Array; bpm: number; final: boolean }
  | { type: "failed"; id: number };

declare const self: { postMessage(m: FromWorker): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };

let current = 0;
const pause = () => new Promise((r) => setTimeout(r, 0));

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "close") {
    current = -1;
    return;
  }
  if (m.type === "open") void run(m);
};

async function run(m: Extract<ToWorker, { type: "open" }>) {
  const id = (current = m.id);
  try {
    const job = new LayerAnalysis({ sr: m.sr, left: m.left, right: m.right }, new SignalStems(), m.ref);
    await job.prepare();
    if (current !== id) return;
    self.postMessage({ type: "ready", id });
    let told = -1;
    for (;;) {
      const h = await job.step(2);
      if (current !== id) return;
      if (!h) break;
      self.postMessage({ type: "heard", id, to: h.to, mix: h.mix, layers: h.layers });
      // a first idea of the vibe after the first eight seconds of music (a few seconds after the song is opened), and a
      // better one every half minute of the song after that
      if (job.vibe.heard >= 8 && (told < 0 || h.to - told >= 30)) {
        told = h.to;
        self.postMessage({ type: "vibe", id, fp: job.vibe.fingerprint(), bpm: job.vibe.bpm, final: false });
      }
      // (a pause lets a newer song take over)
      await pause();
      if (current !== id) return;
    }
    self.postMessage({ type: "vibe", id, fp: job.vibe.fingerprint(), bpm: job.vibe.bpm, final: true });
  } catch {
    if (current === id) self.postMessage({ type: "failed", id });
  }
}
