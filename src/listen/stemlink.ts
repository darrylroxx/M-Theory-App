/**
 * The Canvas's link to the desktop app's neural split, for one song opened from a file.
 *
 * When the split can run on this computer, the link starts it as soon as the song is open (the
 * model and its runtime already downloaded: at once; a song split before: from its kept stems,
 * at once). When they are not downloaded yet, it waits for the painter to ask (`fetch`), then
 * downloads them, then splits. While the split runs, every stretch that becomes ready is read
 * from the stem files in modest chunks and handed, as it is, to the worker that hears the song
 * (`FileLayers.pushRaw`): the page does no work on the sound itself. The painting switches to
 * the model's stems wherever they reach and keeps the quick split everywhere else.
 *
 * `stop` ends it all (the song closed, another opened, the page left): the download and the
 * split are cancelled, no read is begun after it, and the worker is told the stems stop there.
 * Nothing goes wrong for the painting if anything here fails: the quick split is always there.
 */
import { isDesktop } from "../desktop";
import * as neural from "./neuralstems";
import type { Job, NeuralStatus, PrepareProgress, SplitEvent, SplitJob, SplitState } from "./neuralstems";
import { isStemName, type StemName } from "./split";

/** Where the model's stems go: the song's hearing (`FileLayers`). */
export interface StemSink {
  useStems(names: StemName[], rate: number, from?: number): void;
  pushRaw(at: number, raw: Partial<Record<StemName, ArrayBuffer>>, channels?: number): void;
  endStems(): void;
  stopStems(): void;
  /**
   * How far (seconds) the hearing has got through the stems handed to it. Stems are not read
   * more than `AHEAD` seconds beyond it: whatever is handed over is held until it is heard, and a
   * split kept from before could otherwise hand over a whole long song at once.
   */
  stemsHeard?(): number;
}

/** What the link asks of the native side (the real one by default; a stand-in in tests). */
export interface NeuralApi {
  desktop(): boolean;
  status(): Promise<NeuralStatus>;
  prepare(opts: { model?: string; onProgress?: (p: PrepareProgress) => void }): Job<NeuralStatus>;
  split(file: SongFile, opts: { model?: string; onEvent?: (e: SplitEvent, s: SplitState) => void }): Promise<SplitJob>;
  read(path: string, start: number, frames: number): Promise<ArrayBuffer>;
}

export type SongFile = { name: string; arrayBuffer(): Promise<ArrayBuffer> };

const REAL: NeuralApi = {
  desktop: isDesktop,
  status: neural.neuralStatus,
  prepare: neural.prepareNeural,
  split: neural.splitFile,
  read: neural.readStemRaw,
};

/**
 * Where the link is:
 * - "off": the split cannot run here (`reason` says why; in the browser the control is not shown);
 * - "checking": asking the native side;
 * - "need": the model and runtime are not downloaded (`bytes` to fetch); `reason` holds why a
 *   last try failed, if one did;
 * - "fetching": downloading them (`fetched`, 0..1);
 * - "starting": handing the song over;
 * - "splitting" / "paused" (a take is being recorded: the native side waits, and so do the reads);
 * - "done": every stem is ready and handed over;
 * - "failed": the split did not finish (`reason`); what it made so far is still painted from.
 */
export type LinkPhase = "off" | "checking" | "need" | "fetching" | "starting" | "splitting" | "paused" | "done" | "failed";

export interface LinkView {
  phase: LinkPhase;
  reason: string | null;
  bytes: number;
  fetched: number;
  /** seconds of every stem ready (made by the model), and how far of them has been handed over */
  ready: number;
  read: number;
  seconds: number | null;
  stems: StemName[];
  cached: boolean;
}

/** Frames read from a stem at a time: about three seconds, one megabyte a stem (never the whole song at once). */
export const CHUNK = 1 << 17;
/**
 * Seconds of stems read ahead of what the hearing has got through. The hearing takes them in a
 * few times faster than they play, so it is never kept waiting; and what it holds stays small
 * (half a minute of six mono stems is about 30 MB, where a whole ten-minute song would be more
 * than half a gigabyte).
 */
export const AHEAD = 30;
/** The longest a new split or download waits for one this page cancelled to end on the native side (ms). */
const WIND_DOWN = 20_000;

/**
 * Jobs this page cancelled that may still be ending on the native side, by the side they run
 * on. A split cancelled there stops only at its next stretch: until then the song is still
 * "being split", and a download still "under way", so a new one asked for at once (the page
 * left and come back to, the same song opened again) would be refused.
 */
const ending = new WeakMap<NeuralApi, Promise<void>>();
function windDown(api: NeuralApi, done: Promise<unknown>) {
  const one = new Promise<void>((res) => {
    const t = setTimeout(res, WIND_DOWN);
    done.then(
      () => (clearTimeout(t), res()),
      () => (clearTimeout(t), res()),
    );
  });
  const before = ending.get(api);
  const all = before ? Promise.all([before, one]).then(() => undefined) : one;
  ending.set(api, all);
  // (once everything has ended, nothing is waited for)
  void all.then(() => ending.get(api) === all && ending.delete(api));
}

/**
 * Which model to split with: the first one listed (the default) if it is ready, else another that
 * is (a six-stem model already downloaded is used as it is), else the default, to be downloaded.
 */
export function pickModel(status: NeuralStatus): { id: string; ready: boolean } | null {
  const first = status.models[0];
  if (!first) return null;
  if (neural.readyToSplit(status, first.id)) return { id: first.id, ready: true };
  const other = status.models.find((m) => neural.readyToSplit(status, m.id));
  return other ? { id: other.id, ready: true } : { id: first.id, ready: false };
}

/** How far a download is, 0..1, from its progress reports (the runtime's and the model's bytes together). */
export class Fetched {
  private done = new Map<string, number>();
  private total = new Map<string, number>();
  constructor(expected: { runtime: number; model: number }) {
    if (expected.runtime > 0) this.total.set("runtime", expected.runtime);
    if (expected.model > 0) this.total.set("model", expected.model);
  }
  take(p: PrepareProgress): number {
    if (p.part !== "gpu") {
      if (p.total) this.total.set(p.part, p.total);
      if (p.step === "download") this.done.set(p.part, p.done);
      // (checked or unpacked: all of that part is here)
      else this.done.set(p.part, this.total.get(p.part) ?? p.done);
    }
    return this.fraction;
  }
  get fraction(): number {
    let d = 0;
    let t = 0;
    for (const [k, v] of this.total) {
      t += v;
      d += Math.min(v, this.done.get(k) ?? 0);
    }
    return t > 0 ? Math.max(0, Math.min(1, d / t)) : 0;
  }
}

export class StemLink {
  view: LinkView = { phase: "checking", reason: null, bytes: 0, fetched: 0, ready: 0, read: 0, seconds: null, stems: [], cached: false };
  private readonly api: NeuralApi;
  private readonly chunk: number;
  private readonly ahead: number;
  private readonly poll: number;
  private readonly onChange: (v: LinkView) => void;
  private stopped = false;
  private status: NeuralStatus | null = null;
  private model: string | undefined;
  private prep: Job<NeuralStatus> | null = null;
  /** downloads asked for: one stopped while it still waits for an earlier one to end does not start */
  private fetches = 0;
  private job: SplitJob | null = null;
  /** the stems' files (in the order the model makes them) and their rate, once the split has started */
  private files: { name: StemName; path: string }[] = [];
  private rate = 0;
  /** frames read and handed over so far; the song's length in frames once the split is done */
  private readAt = 0;
  private frames: number | null = null;
  /** the split whose stems are being read now (one reading at a time) */
  private reading: SplitJob | null = null;
  private handed = false;
  private ended = false;
  /** a split that went on after the link was stopped has been cancelled again */
  private recancelled = false;

  constructor(private readonly file: SongFile, private readonly sink: StemSink, opts: { api?: NeuralApi; chunk?: number; ahead?: number; poll?: number; onChange?: (v: LinkView) => void } = {}) {
    this.api = opts.api ?? REAL;
    this.chunk = Math.max(1024, Math.round(opts.chunk ?? CHUNK));
    this.ahead = opts.ahead ?? AHEAD;
    this.poll = opts.poll ?? 250;
    this.onChange = opts.onChange ?? (() => undefined);
  }

  private set(patch: Partial<LinkView>) {
    if (this.stopped) return;
    this.view = { ...this.view, ...patch };
    this.onChange(this.view);
  }

  /** Find out whether the split can run here, and start it if all it needs is already downloaded. */
  async start(): Promise<void> {
    if (!this.api.desktop()) return this.set({ phase: "off", reason: neural.neuralUnavailable(false) });
    this.set({ phase: "checking" });
    const status = await this.api.status();
    if (this.stopped) return;
    this.status = status;
    const why = neural.neuralUnavailable(true, status);
    const pick = pickModel(status);
    if (why || !pick) return this.set({ phase: "off", reason: why ?? "No model is offered." });
    this.model = pick.id;
    // (the song is handed over and the split started in the background: the page waits for none of it)
    if (pick.ready) return void this.split();
    const m = status.models.find((x) => x.id === pick.id);
    this.set({ phase: "need", bytes: neural.toDownload(status, pick.id), reason: m?.error ?? null });
  }

  /** Download the model and its runtime (the painter asked); the split starts by itself once they are here. */
  async fetch(): Promise<void> {
    if (this.stopped || this.view.phase !== "need" || !this.status) return;
    const status = this.status;
    const m = status.models.find((x) => x.id === this.model);
    const got = new Fetched({ runtime: status.runtime.present ? 0 : status.runtime.bytes, model: m && (!m.present || m.error) ? m.bytes : 0 });
    this.set({ phase: "fetching", fetched: 0, reason: null });
    const mine = ++this.fetches;
    // (a download stopped a moment ago may still be ending: two at once would be refused)
    await ending.get(this.api);
    if (this.stopped || mine !== this.fetches) return;
    const prep = (this.prep = this.api.prepare({ model: this.model, onProgress: (p) => this.set({ fetched: got.take(p) }) }));
    try {
      const after = await prep.done;
      if (this.stopped) return;
      this.status = after;
      if (neural.readyToSplit(after, this.model)) return void this.split();
      const why = neural.neuralUnavailable(true, after) ?? after.models.find((x) => x.id === this.model)?.error ?? null;
      this.set({ phase: why && !after.available ? "off" : "need", bytes: neural.toDownload(after, this.model), reason: why });
    } catch (e) {
      if (this.stopped) return;
      // stopped by the painter: back to the offer; failed: the offer again, with why on hover
      this.set({ phase: "need", reason: neural.isCancelled(e) ? null : message(e) });
    } finally {
      if (this.prep === prep) this.prep = null;
    }
  }

  /** Stop a download under way (the painter changed their mind). */
  cancelFetch() {
    if (!this.prep) {
      // still waiting for an earlier download to end: it never starts, and the offer comes back
      if (this.view.phase === "fetching") {
        this.fetches++;
        this.set({ phase: "need", reason: null });
      }
      return;
    }
    windDown(this.api, this.prep.done);
    void this.prep.cancel().catch(() => false);
  }

  /** Try the split again after it failed. */
  retry() {
    if (this.stopped || this.view.phase !== "failed") return;
    // (a fresh split: its stems are handed over again from the start)
    this.job = null;
    this.files = [];
    this.readAt = 0;
    this.frames = null;
    this.handed = false;
    this.ended = false;
    void this.split();
  }

  private async split(): Promise<void> {
    this.set({ phase: "starting", reason: null, ready: 0, read: 0 });
    // (a split of this song stopped a moment ago may still be ending: until it has, this one would be refused)
    await ending.get(this.api);
    if (this.stopped) return;
    let job: SplitJob;
    try {
      job = await this.api.split(this.file, { model: this.model, onEvent: (e, s) => this.event(e, s, job) });
    } catch (e) {
      return this.set({ phase: "failed", reason: message(e) });
    }
    this.job = job;
    // (stopped while the song was being handed over: the split is not wanted)
    if (this.stopped) return this.cancel(job);
    job.done.then(
      (r) => {
        if (this.stopped || this.job !== job) return;
        // a split that comes back without a "started" (from the kept stems, at once) is taken up here
        if (!this.files.length) this.begin(r.stems, r.rate, r.seconds, r.cached);
        this.frames = r.frames;
        this.set({ ready: r.seconds, seconds: r.seconds });
        void this.pump();
      },
      (e) => {
        // (stopped here: nothing more to say; given up here after a failed read: that failure was said already)
        if (this.stopped || this.job !== job || this.view.phase === "failed") return;
        if (this.handed && !this.ended) this.sink.stopStems();
        this.ended = true;
        this.set({ phase: "failed", reason: neural.isCancelled(e) ? null : message(e) });
      },
    );
  }

  private event(e: SplitEvent, s: SplitState, job: SplitJob | undefined) {
    if (this.stopped) {
      // a split that still speaks after it was stopped did not hear its cancel (one sent before the native side had
      // taken the split on is lost): it is cancelled again, rather than left splitting a song no one will see
      if (job && !this.recancelled) {
        // (once is enough: a split that speaks has been taken on, so it hears this one)
        this.recancelled = true;
        void job.cancel().catch(() => false);
      }
      return;
    }
    if (e.kind === "started") {
      this.begin(e.stems, e.rate, e.seconds, e.cached);
    } else if (e.kind === "progress") {
      this.set({ ready: s.ready });
      void this.pump();
    } else if (e.kind === "paused") {
      if (this.files.length) this.set({ phase: "paused" });
    } else if (e.kind === "resumed") {
      if (this.files.length) this.set({ phase: "splitting" });
      void this.pump();
    }
  }

  /** The split has begun: its stems (only those the painting knows), their rate, and the song's length. */
  private begin(stems: neural.StemFile[], rate: number, seconds: number | null, cached: boolean) {
    if (this.files.length) return;
    this.files = stems.filter((x) => isStemName(x.name)).map((x) => ({ name: x.name as StemName, path: x.path }));
    this.rate = rate;
    if (!this.files.length || !(rate > 0)) {
      this.set({ phase: "failed", reason: "The split made no stems the canvas knows." });
      if (this.job) this.cancel(this.job);
      return;
    }
    this.sink.useStems(this.files.map((f) => f.name), rate, 0);
    this.handed = true;
    this.set({ phase: "splitting", stems: this.files.map((f) => f.name), seconds, cached });
    void this.pump();
  }

  /**
   * Read what has become ready since the last read, a chunk at a time, and hand it on. Only one
   * reading goes on at a time; whatever becomes ready meanwhile is read by the same loop. While a
   * take is being recorded nothing is read (the native side has paused, and the page keeps still).
   */
  private async pump(): Promise<void> {
    const job = this.job;
    if (!job || this.reading === job || this.stopped || !this.files.length) return;
    this.reading = job;
    // (this reading is over once the link is stopped, the split has failed, or another split has taken its place)
    const gone = () => this.stopped || this.job !== job || this.view.phase === "failed";
    try {
      for (;;) {
        if (gone() || this.view.phase === "paused") return;
        const upTo = this.frames ?? job.state.readyFrames;
        const n = Math.min(this.chunk, upTo - this.readAt);
        if (n <= 0) break;
        const at = this.readAt;
        // far enough ahead of the hearing: wait for it to catch up (what is handed over is held until it is heard)
        const heard = this.sink.stemsHeard?.();
        if (heard !== undefined && at / this.rate > heard + this.ahead) {
          await new Promise((r) => setTimeout(r, this.poll));
          continue;
        }
        const bufs = await Promise.all(this.files.map((f) => this.api.read(f.path, at, n)));
        if (gone()) return;
        // (a file read short gives only the frames every stem has; the rest is read next time)
        const got = Math.min(...bufs.map((b) => Math.floor(b.byteLength / 8)));
        if (got <= 0) break;
        const raw: Partial<Record<StemName, ArrayBuffer>> = {};
        this.files.forEach((f, i) => (raw[f.name] = bufs[i].byteLength === got * 8 ? bufs[i] : bufs[i].slice(0, got * 8)));
        this.sink.pushRaw(at, raw, 2);
        this.readAt = at + got;
        this.set({ read: this.readAt / this.rate });
      }
      if (this.frames !== null && this.readAt >= this.frames && !this.ended) {
        this.ended = true;
        this.sink.endStems();
        this.set({ phase: "done" });
      }
    } catch (e) {
      if (gone()) return;
      // a stem that could not be read: the split is given up, and the stems stop where they were read to
      this.sink.stopStems();
      this.ended = true;
      this.set({ phase: "failed", reason: message(e) });
      this.cancel(job);
    } finally {
      if (this.reading === job) this.reading = null;
    }
  }

  /** The song was closed, another opened, or the page left: everything under way is stopped. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.prep) {
      windDown(this.api, this.prep.done);
      void this.prep.cancel().catch(() => false);
    }
    if (this.job && this.frames === null) this.cancel(this.job);
    if (this.handed && !this.ended) this.sink.stopStems();
  }

  /** Cancel a split, and let a new one wait for it to end. */
  private cancel(job: SplitJob) {
    windDown(this.api, job.done);
    void job.cancel().catch(() => false);
  }

  get isStopped() {
    return this.stopped;
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
