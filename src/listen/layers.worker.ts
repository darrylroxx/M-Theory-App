/**
 * The worker that hears a song from a file layer by layer (`layers.ts`), away from the page, so
 * the painting never waits for it. It is sent the song once and sends back what each layer did,
 * a couple of seconds of the song at a time, as fast as it can, and the song's vibe as it
 * becomes known.
 *
 * Later, a trained model's stems may be handed over as the desktop app's engine makes them
 * ("stems", then "stem-data" stretch by stretch, then "stems-end"): they are heard in a second
 * pass of their own, from where they take over, as far as they are ready, and what they hold is
 * sent back as "better" (the page paints from it wherever it reaches).
 */
import { LayerAnalysis } from "./layers";
import { PushedStems, type StemStretch } from "./pushed";
import { SignalStems, type StemName } from "./split";

export type ToWorker =
  | { type: "open"; id: number; sr: number; left: Float32Array; right: Float32Array; ref: number }
  | { type: "close" }
  /** a model's stems take over from `from` seconds: these stems, at this rate */
  | { type: "stems"; id: number; pass: number; names: StemName[]; rate: number; from: number }
  /** the model's stems from frame `at` (at their own rate) on */
  | { type: "stem-data"; id: number; at: number; stretch: StemStretch }
  | { type: "stems-end"; id: number };
export type FromWorker =
  | { type: "ready"; id: number }
  | { type: "heard"; id: number; to: number; mix: import("./ear").Frame[]; layers: import("./layers").LayerFrames[] }
  | { type: "vibe"; id: number; fp: Float32Array; bpm: number; final: boolean }
  | { type: "better"; id: number; pass: number; to: number; layers: import("./layers").LayerFrames[] }
  | { type: "failed"; id: number };

declare const self: { postMessage(m: FromWorker): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };

let current = 0;
/** the song now being heard, and the model's stems for it (when they are being handed over) */
let song: Extract<ToWorker, { type: "open" }> | null = null;
let model: { stems: PushedStems; pass: number } | null = null;
const pause = () => new Promise((r) => setTimeout(r, 0));

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === "close") {
    current = -1;
    song = null;
    model?.stems.end();
    model = null;
    return;
  }
  if (m.type === "open") {
    model?.stems.end();
    model = null;
    song = m;
    void run(m);
    return;
  }
  if (m.id !== current || !song) return;
  if (m.type === "stems") {
    model?.stems.end();
    model = { stems: new PushedStems(m.names, m.rate), pass: m.pass };
    void better(song, model, m.from);
  } else if (m.type === "stem-data") model?.stems.push(m.at, m.stretch);
  else if (m.type === "stems-end") model?.stems.end();
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

/** The second pass: the model's stems, from `from` seconds, as far as they have been handed over. */
async function better(m: Extract<ToWorker, { type: "open" }>, mine: NonNullable<typeof model>, from: number) {
  const id = m.id;
  const still = () => current === id && model === mine;
  try {
    // (the mix, its mood and its vibe are known from the first pass: only the stems are heard)
    const job = new LayerAnalysis({ sr: m.sr, left: m.left, right: m.right }, mine.stems, m.ref, { from, mix: false });
    await job.prepare();
    for (;;) {
      const h = await job.step(2);
      if (!still()) return;
      if (!h) break;
      self.postMessage({ type: "better", id, pass: mine.pass, to: h.to, layers: h.layers });
      await pause();
      if (!still()) return;
    }
  } catch {
    // (the first pass goes on being painted)
  }
}
