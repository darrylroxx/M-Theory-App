/**
 * Neural stems: a song split on the user's own computer, by a neural network (Demucs v4), into
 * vocals, drums, bass and the rest (with the six-stem model, guitar and piano too), each a WAV
 * the Canvas can paint from as its own layer.
 *
 * Only the desktop app can do this (the work is done by its native side, `src-tauri/src/stems.rs`).
 * The model and the runtime that runs it are downloaded once, when the user asks: `prepareNeural`.
 * A split reports, stretch by stretch, how far every stem is ready from its start, so painting can
 * begin long before the whole song is done: `splitNeural` / `splitFile`, then `readStem` for any
 * part that is ready. In the browser (and the installed web app) none of this exists:
 * `neuralUnavailable` says so, and the Canvas keeps its quick splits.
 */
import { isDesktop } from "../desktop";

// ── what the native side reports ──

export interface NeuralModel {
  id: string;
  name: string;
  /** in the order the model makes them, e.g. ["drums", "bass", "other", "vocals"] */
  stems: string[];
  present: boolean;
  /** bytes on disk if present, else about how many will be downloaded */
  bytes: number;
  /** where it was (or will be) downloaded from, and the page that describes it */
  source: string;
  page: string;
  licence: string;
  /** the SHA-256 it was checked against: this app's own ("pinned") or the host's ("host") */
  sha256: string | null;
  checked_against: string | null;
  revision: string | null;
  /** why it would not open when a split last tried (downloading it again replaces it) */
  error: string | null;
}

export interface NeuralStatus {
  /** can this computer split with the neural model at all? */
  available: boolean;
  reason: string | null;
  models: NeuralModel[];
  runtime: { present: boolean; loaded: boolean; version: string | null; source: string | null; bytes: number; licence: string | null; error: string | null };
  /** the graphics-card path ("DirectML" on Windows); `usable` is null until it has been tried */
  gpu: { provider: string | null; usable: boolean | null; note: string | null };
  preparing: boolean;
  /** ids of the splits under way */
  splitting: string[];
  cache_bytes: number;
  cache_dir: string;
  /** threads a split may use (the rest are left for the audio) */
  threads: number;
}

export interface PrepareProgress {
  part: "runtime" | "model" | "gpu";
  step: "download" | "check" | "unpack" | "try" | "done";
  done: number;
  total: number | null;
}

export interface StemFile {
  name: string;
  path: string;
}

export type SplitEvent =
  | { kind: "queued" }
  | { kind: "loading" }
  | { kind: "started"; key: string; stems: StemFile[]; rate: number; seconds: number | null; provider: string; cached: boolean }
  | { kind: "progress"; done: number; total: number; ready_frames: number; ready: number; speed: number; eta: number | null }
  | { kind: "paused"; reason: string }
  | { kind: "resumed" };

export interface Separated {
  id: string;
  key: string;
  model: string;
  stems: StemFile[];
  /** the song's sample rate; every stem is stereo, 32-bit float, at this rate */
  rate: number;
  frames: number;
  seconds: number;
  /** "DirectML", "CPU", or how it was made when it comes from the cache */
  provider: string;
  cached: boolean;
  /** seconds the split took (0 from the cache) */
  took: number;
}

// ── where it can run ──

/** Why neural stems cannot be used here, or null if they can (as far as is known). */
export function neuralUnavailable(desktop: boolean, status?: Pick<NeuralStatus, "available" | "reason"> | null): string | null {
  if (!desktop) return "Neural stems run only in the desktop app (Windows). Here the quick splits are used.";
  if (status && !status.available) return status.reason ?? "Neural stems cannot run on this computer.";
  return null;
}

/** What the status is where there is no native side (the browser, the web app). */
export function offStatus(reason: string): NeuralStatus {
  return {
    available: false,
    reason,
    models: [],
    runtime: { present: false, loaded: false, version: null, source: null, bytes: 0, licence: null, error: null },
    gpu: { provider: null, usable: null, note: null },
    preparing: false,
    splitting: [],
    cache_bytes: 0,
    cache_dir: "",
    threads: 0,
  };
}

/** Is everything needed to split with `model` downloaded, and did nothing fail to open? */
export function readyToSplit(status: NeuralStatus, model?: string): boolean {
  const m = model ? status.models.find((x) => x.id === model) : status.models[0];
  return status.available && status.runtime.present && !!m?.present && !m.error;
}

/** How much `prepareNeural` would still download, in bytes (about, for the model). */
export function toDownload(status: NeuralStatus, model?: string): number {
  const m = model ? status.models.find((x) => x.id === model) : status.models[0];
  return (status.runtime.present ? 0 : status.runtime.bytes) + (m && (!m.present || m.error) ? m.bytes : 0);
}

/** "166 MB", "25 MB", "4.0 GB" */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

async function core() {
  return import("@tauri-apps/api/core");
}

// ── status and downloading ──

/** Never fails: whatever goes wrong, the answer is a status saying why the quick splits are used. */
export async function neuralStatus(): Promise<NeuralStatus> {
  const why = neuralUnavailable(isDesktop());
  if (why) return offStatus(why);
  try {
    return await (await core()).invoke<NeuralStatus>("stems_status");
  } catch (e) {
    return offStatus(failure(e).message);
  }
}

let seq = 0;
/** A fresh id for a job (the native side knows jobs by it, for cancelling). */
export function jobId(kind: string): string {
  seq += 1;
  return `${kind}-${Date.now().toString(36)}-${seq}`;
}

export interface Job<T> {
  id: string;
  /** resolves when the job is done; rejects with its reason (see `isCancelled`) */
  done: Promise<T>;
  /** stop it; false if it had already ended */
  cancel(): Promise<boolean>;
}

/** Was this failure only a cancel? */
export function isCancelled(e: unknown): boolean {
  return (e instanceof Error ? e.message : String(e)) === "cancelled";
}

function failure(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

async function cancelJob(id: string): Promise<boolean> {
  if (!isDesktop()) return false;
  return (await core()).invoke<boolean>("stems_cancel", { id });
}

/**
 * Download what splitting needs: the runtime (about 25 MB) and the model (about 140-170 MB),
 * each checked against its SHA-256, once. Anything already here is not fetched again; a download
 * that was stopped goes on from where it stopped.
 */
export function prepareNeural(opts: { model?: string; onProgress?: (p: PrepareProgress) => void } = {}): Job<NeuralStatus> {
  const id = jobId("prepare");
  const done = (async () => {
    const why = neuralUnavailable(isDesktop());
    if (why) throw new Error(why);
    const { invoke, Channel } = await core();
    const ch = new Channel<PrepareProgress>();
    ch.onmessage = (p) => opts.onProgress?.(p);
    try {
      return await invoke<NeuralStatus>("stems_prepare", { id, model: opts.model ?? null, progress: ch });
    } catch (e) {
      throw failure(e);
    }
  })();
  // a failure is for whoever awaits `done`; it must not also be reported as unhandled
  done.catch(() => undefined);
  return { id, done, cancel: () => cancelJob(id) };
}

// ── splitting ──

/** Where a split is, from its events (see `onSplitEvent`). */
export interface SplitState {
  phase: "waiting" | "queued" | "loading" | "working" | "paused" | "done" | "failed" | "cancelled";
  stems: StemFile[];
  rate: number;
  /** how long the song is (seconds), when known */
  seconds: number | null;
  /** every stem holds its first `readyFrames` frames (`ready` seconds) */
  readyFrames: number;
  ready: number;
  /** stretches done, of about `total` */
  done: number;
  total: number;
  /** seconds of music split per second of work; and the seconds still to go, when known */
  speed: number;
  eta: number | null;
  provider: string;
  cached: boolean;
  error: string | null;
}

export function initialSplit(): SplitState {
  return { phase: "waiting", stems: [], rate: 0, seconds: null, readyFrames: 0, ready: 0, done: 0, total: 0, speed: 0, eta: null, provider: "", cached: false, error: null };
}

/** The state after one more event. Pure. */
export function onSplitEvent(s: SplitState, e: SplitEvent): SplitState {
  switch (e.kind) {
    case "queued":
      return { ...s, phase: "queued" };
    case "loading":
      return { ...s, phase: "loading" };
    case "started":
      return { ...s, phase: "working", stems: e.stems, rate: e.rate, seconds: e.seconds, provider: e.provider, cached: e.cached };
    case "progress":
      // never backwards (an event can only add to what is ready)
      return {
        ...s,
        phase: s.phase === "paused" ? "paused" : "working",
        done: e.done,
        total: Math.max(e.total, e.done),
        readyFrames: Math.max(s.readyFrames, e.ready_frames),
        ready: Math.max(s.ready, e.ready),
        speed: e.speed,
        eta: e.eta,
      };
    case "paused":
      return { ...s, phase: "paused" };
    case "resumed":
      return { ...s, phase: "working" };
  }
}

/** The state once the split has ended. Pure. */
export function onSplitEnd(s: SplitState, r: { ok: Separated } | { err: unknown }): SplitState {
  if ("ok" in r) {
    const v = r.ok;
    return { ...s, phase: "done", stems: v.stems, rate: v.rate, seconds: v.seconds, readyFrames: v.frames, ready: v.seconds, provider: v.provider, cached: v.cached, eta: 0, error: null };
  }
  const msg = failure(r.err).message;
  return { ...s, phase: isCancelled(msg) ? "cancelled" : "failed", error: isCancelled(msg) ? null : msg };
}

/** Is every stem ready from its start up to `t` seconds? */
export function readyUpTo(s: SplitState, t: number): boolean {
  if (s.phase === "done") return true;
  return s.rate > 0 && s.readyFrames >= Math.ceil(t * s.rate);
}

/** Of `frames` frames from `start`, how many can be read now (0 if none). */
export function readableFrames(s: SplitState, start: number, frames: number): number {
  return Math.max(0, Math.min(frames, s.readyFrames - start));
}

export interface SplitJob extends Job<Separated> {
  /** where it is now */
  readonly state: SplitState;
  /** resolves true once every stem is ready up to `t` seconds, false if the split ends first without it */
  whenReady(t: number): Promise<boolean>;
}

/**
 * Split the song at `path` (a file on this computer; see `splitFile` for a file the page opened).
 * The stems' files are known from the first event on (`state.stems`, `onEvent` "started"), and
 * every stem can be read up to `state.ready` seconds while the rest is still being made.
 */
export function splitNeural(path: string, opts: { model?: string; onEvent?: (e: SplitEvent, s: SplitState) => void } = {}): SplitJob {
  const id = jobId("split");
  let state = initialSplit();
  const waiting: { t: number; resolve: (ok: boolean) => void }[] = [];
  const settle = () => {
    for (let i = waiting.length - 1; i >= 0; i--) {
      const w = waiting[i];
      if (readyUpTo(state, w.t)) w.resolve(true);
      else if (state.phase === "failed" || state.phase === "cancelled") w.resolve(false);
      else continue;
      waiting.splice(i, 1);
    }
  };
  const done = (async () => {
    const why = neuralUnavailable(isDesktop());
    if (why) throw new Error(why);
    const { invoke, Channel } = await core();
    const ch = new Channel<SplitEvent>();
    ch.onmessage = (e) => {
      state = onSplitEvent(state, e);
      settle();
      opts.onEvent?.(e, state);
    };
    try {
      const r = await invoke<Separated>("stems_split", { id, path, model: opts.model ?? null, events: ch });
      state = onSplitEnd(state, { ok: r });
      return r;
    } catch (e) {
      state = onSplitEnd(state, { err: e });
      throw failure(e);
    } finally {
      settle();
    }
  })();
  // a failure is for whoever awaits `done`; it must not also be reported as unhandled
  done.catch(() => undefined);
  return {
    id,
    done,
    get state() {
      return state;
    },
    cancel: () => cancelJob(id),
    whenReady(t: number) {
      return new Promise<boolean>((resolve) => {
        waiting.push({ t, resolve });
        settle();
      });
    },
  };
}

/** The file's ending, as plain letters and digits ("mp3"), for the native side to know its kind. */
export function fileKind(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  return m ? m[1].toLowerCase() : "bin";
}

/**
 * Hand a song the page opened (a File, whose place on disk the page does not know) to the native
 * side, which keeps it in its cache folder; the answer is its path there, for `splitNeural`.
 */
export async function uploadSong(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<string> {
  const why = neuralUnavailable(isDesktop());
  if (why) throw new Error(why);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return (await core()).invoke<string>("stems_upload", bytes, { headers: { "x-name": `song.${fileKind(file.name)}` } });
}

/** `uploadSong`, then `splitNeural`. */
export async function splitFile(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }, opts: { model?: string; onEvent?: (e: SplitEvent, s: SplitState) => void } = {}): Promise<SplitJob> {
  return splitNeural(await uploadSong(file), opts);
}

// ── reading stems back ──

/** Interleaved little-endian 32-bit floats as one Float32Array per channel. Pure. */
export function deinterleave(buf: ArrayBuffer, channels: number): Float32Array[] {
  const all = new Float32Array(buf, 0, Math.floor(buf.byteLength / 4 / channels) * channels);
  const n = all.length / channels;
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c][i] = all[i * channels + c];
  return out;
}

/**
 * `frames` frames of a stem from frame `start`, left and right. A part not yet made comes back
 * shorter (check `readableFrames` first to ask only for what is there).
 */
export async function readStem(path: string, start: number, frames: number): Promise<Float32Array[]> {
  const why = neuralUnavailable(isDesktop());
  if (why) throw new Error(why);
  const buf = await (await core()).invoke<ArrayBuffer>("stems_read", { path, start: Math.max(0, Math.round(start)), frames: Math.max(0, Math.round(frames)) });
  return deinterleave(buf, 2);
}

/** Delete every kept stem (the cache); returns the bytes freed. */
export async function clearStems(): Promise<number> {
  if (!isDesktop()) return 0;
  return (await core()).invoke<number>("stems_clear");
}
