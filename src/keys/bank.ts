/**
 * Where a sample pack's recordings live once they are downloaded and decoded.
 *
 * Decoded audio is big (a second of stereo at 48 kHz is 384 KB, the whole piano is over 400 MB), so
 * files are fetched in the order the instrument needs them, background loading stops at a memory
 * budget, and the least recently played layers are let go when a song needs others. Files past the
 * budget are still downloaded (not decoded) when a service worker keeps them, so the installed app
 * has the whole piano offline; and what a bounce has prepared is kept whatever the budget.
 *
 * Decoding happens at the audio context's own sample rate, so a bank is shared by every instrument
 * at that rate: the live piano and an offline render at the same rate use the same buffers, and a
 * render at another rate gets its own bank, decoded for it.
 */
import { checkManifest, loadOrder, type PackManifest } from "./pack";

export type Fetcher = (url: string) => Promise<ArrayBuffer>;
export type Decoder = (data: ArrayBuffer, sampleRate: number) => Promise<AudioBuffer>;

export interface BankOptions {
  fetch?: Fetcher;
  decode?: Decoder;
  /**
   * Download every file of the pack, even those over the memory budget (they are fetched and not
   * decoded), so the service worker keeps the whole instrument and it plays offline. By default,
   * whenever a service worker looks after the page (the installed web app; the desktop app has its
   * files on disk already).
   */
  offline?: boolean;
}

/** How a bank is getting on: bytes of files (as downloaded). */
export interface Progress {
  /** Bytes of the first tier (one layer across the keyboard) that are in. */
  loaded: number;
  /** Bytes of that first tier. */
  total: number;
  /** Bytes in memory as decoded audio. */
  memory: number;
  /** Every key can sound. */
  ready: boolean;
}

interface Entry {
  buffer: AudioBuffer;
  bytes: number;
  /** last time it was played (performance clock), for letting the least used go first */
  used: number;
}

interface Job {
  file: string;
  /** lower = sooner */
  pri: number;
  /** Only download it (into the browser's caches, for offline use): it is over the memory budget. */
  stash?: boolean;
  waiters: { ok: () => void; fail: (e: unknown) => void }[];
}

/** Background loading (the layers nobody has played yet) waits behind anything a note asked for. */
const BACKGROUND = 10;
const PARALLEL = 3;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const defaultFetch: Fetcher = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.arrayBuffer();
};

/** Decoding goes through a one-frame offline context at the wanted rate: the result is resampled to it. */
const decoders = new Map<number, BaseAudioContext>();
const defaultDecode: Decoder = (data, rate) => {
  let c = decoders.get(rate);
  if (!c) {
    const OAC =
      globalThis.OfflineAudioContext ?? (globalThis as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    c = new OAC(2, 1, rate);
    decoders.set(rate, c);
  }
  const ctx = c;
  // Older WebKit only has the callback form, and returns undefined instead of a promise.
  return new Promise<AudioBuffer>((ok, fail) => {
    const p = ctx.decodeAudioData(data, ok, fail) as Promise<AudioBuffer> | undefined;
    if (p && typeof p.then === "function") p.then(ok, fail);
  });
};

/**
 * The extra silence a decoder puts in front of a file. MP3 encoders add a fixed delay; Chromium
 * removes it, other decoders may not. The probe tone starts `at` seconds into the file: where it
 * starts once decoded tells us how much to skip at the start of every recording.
 */
export function measureLead(data: Float32Array, sampleRate: number, at: number): number {
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > 0.25) return Math.max(0, Math.min(0.1, i / sampleRate - at));
  }
  return 0;
}

/** Decoded bytes an AudioBuffer holds. */
export const bufferBytes = (b: AudioBuffer) => b.length * b.numberOfChannels * 4;

/** The manifest of each pack, fetched once (a pack is the same whatever the sample rate). */
const manifests = new Map<string, Promise<PackManifest>>();

export class Bank {
  private static banks = new Map<string, Bank>();

  /** The bank for a pack (folder URL ending in "/") at a sample rate, shared by every instrument on it. */
  static for(base: string, sampleRate: number, opts: BankOptions = {}): Bank {
    const key = `${base}|${sampleRate}`;
    let b = Bank.banks.get(key);
    if (!b) {
      b = new Bank(base, sampleRate, opts);
      Bank.banks.set(key, b);
    }
    return b;
  }

  /** Forget every shared bank (tests). */
  static reset() {
    Bank.banks.clear();
    manifests.clear();
  }

  manifest?: PackManifest;
  /** Seconds to skip at the start of every file (see measureLead). */
  lead = 0;
  /** Decoded audio allowed in memory, in bytes (background loading stops here). */
  budget = Infinity;
  private entries = new Map<string, Entry>();
  private sizes = new Map<string, number>();
  private queue: Job[] = [];
  private running = 0;
  private failed = new Set<string>();
  private core: string[] = [];
  private coreSet = new Set<string>();
  private started?: Promise<void>;
  private listeners = new Set<(p: Progress) => void>();
  private users = 0;
  /** Files downloaded but not decoded (over budget): a note that needs one decodes it from the cache. */
  private stashed = new Set<string>();
  /** Decoded bytes the downloads under way will add (so parallel loads cannot overshoot the budget). */
  private reserved = 0;
  /** Files an instrument has asked to keep (a song about to be bounced): never let go to save memory. */
  private pins = new Map<object, Set<string>>();
  private readonly fetchBytes: Fetcher;
  private readonly decode: Decoder;
  private readonly offlineOpt?: boolean;

  private constructor(
    readonly base: string,
    readonly sampleRate: number,
    opts: BankOptions,
  ) {
    this.fetchBytes = opts.fetch ?? defaultFetch;
    this.decode = opts.decode ?? defaultDecode;
    this.offlineOpt = opts.offline;
  }

  /** Should files over the budget still be downloaded? (Asked late: the worker takes over after the first load.) */
  private get offline(): boolean {
    if (this.offlineOpt !== undefined) return this.offlineOpt;
    return typeof navigator !== "undefined" && !!navigator.serviceWorker?.controller;
  }

  /** An instrument starts using the bank. */
  attach() {
    this.users++;
  }

  /** An instrument is done with it: when nobody uses it any more its audio is let go. */
  detach() {
    this.users = Math.max(0, this.users - 1);
    if (this.users === 0) {
      this.entries.clear();
      this.stashed.clear();
      this.pins.clear();
      this.queue = [];
      this.started = undefined;
      Bank.banks.forEach((b, k) => b === this && Bank.banks.delete(k));
    }
  }

  url(file: string, sha?: string) {
    return this.base + file + (sha ? `?v=${sha}` : "");
  }

  /**
   * Fetch the manifest, measure the decoder, then load the first tier (resolves when it is in) and
   * queue the rest in the background. Safe to call again: it starts once.
   */
  start(core = 0.7, releases = true): Promise<void> {
    if (!this.started) {
      this.started = (async () => {
        const m = await this.loadManifest();
        await this.measure(m);
        const tiers = loadOrder(m, core, releases);
        this.core = tiers[0] ?? [];
        this.coreSet = new Set(this.core);
        this.emit();
        // The first tier is queued before the rest, so it is what the first downloads fetch.
        const first = this.want(this.core, 0);
        tiers.slice(1).forEach((t, i) => this.want(t, BACKGROUND + i).catch(() => {}));
        await first;
      })();
      this.started.catch(() => (this.started = undefined)); // let a later call try again (back online)
    }
    return this.started;
  }

  private loadManifest(): Promise<PackManifest> {
    let p = manifests.get(this.base);
    if (!p) {
      p = this.fetchBytes(this.base + "manifest.json").then((ab) => {
        const m = JSON.parse(new TextDecoder().decode(ab)) as PackManifest;
        const errs = checkManifest(m);
        if (errs.length) throw new Error(`bad sample pack: ${errs[0]}`);
        return m;
      });
      manifests.set(this.base, p);
      p.catch(() => manifests.delete(this.base));
    }
    return p.then((m) => {
      if (!this.manifest) {
        this.manifest = m;
        for (const s of [...m.samples, ...m.releases]) this.sizes.set(s.file, s.bytes);
      }
      return m;
    });
  }

  private async measure(m: PackManifest) {
    try {
      const buf = await this.decode(await this.fetchBytes(this.url(m.probe.file, m.probe.sha)), this.sampleRate);
      this.lead = measureLead(buf.getChannelData(0), buf.sampleRate, m.probe.at);
    } catch {
      this.lead = 0; // the files still play, a few milliseconds late at worst
    }
  }

  /** Is this file decoded and ready? */
  has(file: string): boolean {
    return this.entries.has(file);
  }

  /** The decoded file (and mark it as just used). */
  get(file: string): AudioBuffer | undefined {
    const e = this.entries.get(file);
    if (e) e.used = now();
    return e?.buffer;
  }

  /** Bytes of decoded audio held. */
  memory(): number {
    let n = 0;
    this.entries.forEach((e) => (n += e.bytes));
    return n;
  }

  ready(): boolean {
    return this.core.length > 0 && this.core.every((f) => this.entries.has(f));
  }

  progress(): Progress {
    let loaded = 0;
    let total = 0;
    for (const f of this.core) {
      const b = this.sizes.get(f) ?? 0;
      total += b;
      if (this.entries.has(f)) loaded += b;
    }
    return { loaded, total, memory: this.memory(), ready: this.ready() };
  }

  /** Call `cb` whenever a file comes in. Returns a function that stops it. */
  onProgress(cb: (p: Progress) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    if (!this.listeners.size) return;
    const p = this.progress();
    this.listeners.forEach((cb) => cb(p));
  }

  /** Decoded size of a file, estimated from its length before it is loaded. */
  private estimate(file: string): number {
    const m = this.manifest;
    const s = m?.samples.find((x) => x.file === file) ?? m?.releases.find((x) => x.file === file);
    return s ? Math.ceil(s.dur * this.sampleRate) * 2 * 4 : 0;
  }

  /**
   * Load these files (lower `pri` = sooner). Resolves when all are in; rejects if one fails.
   * Files already loaded resolve at once; a file already queued moves up if asked for sooner.
   */
  want(files: string[], pri = 1): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const file of files) {
      if (this.entries.has(file)) continue;
      waits.push(
        new Promise<void>((ok, fail) => {
          let job = this.queue.find((j) => j.file === file);
          if (!job) {
            job = { file, pri, waiters: [] };
            this.queue.push(job);
          } else job.pri = Math.min(job.pri, pri);
          job.waiters.push({ ok, fail });
        }),
      );
    }
    this.pump();
    return Promise.all(waits).then(() => undefined);
  }

  /** The files queued, soonest first (tests). */
  pending(): string[] {
    return [...this.queue].sort((a, b) => a.pri - b.pri).map((j) => j.file);
  }

  /** Keep these files for `owner` (replacing what it kept before), whatever the memory budget. */
  pin(owner: object, files: Iterable<string>) {
    this.pins.set(owner, new Set(files));
  }

  /** `owner` no longer needs the files it kept. */
  unpin(owner: object) {
    this.pins.delete(owner);
  }

  private pinned(file: string): boolean {
    for (const set of this.pins.values()) if (set.has(file)) return true;
    return false;
  }

  /** Files downloaded for offline use but not decoded (over the memory budget). */
  stashedFiles(): string[] {
    return [...this.stashed];
  }

  private pump() {
    while (this.running < PARALLEL && this.queue.length) {
      // the soonest job; ties go in the order they were asked for
      let bi = 0;
      for (let i = 1; i < this.queue.length; i++) if (this.queue[i].pri < this.queue[bi].pri) bi = i;
      const job = this.queue.splice(bi, 1)[0];
      const size = this.estimate(job.file);
      if (job.pri >= BACKGROUND && this.memory() + this.reserved + size > this.budget) {
        // Over budget: background files are not decoded (a note that needs one asks again). They
        // are still downloaded, once, so the whole pack is in the browser's cache for offline use.
        if (!this.offline || this.stashed.has(job.file)) {
          job.waiters.forEach((w) => w.ok());
          continue;
        }
        job.stash = true;
      }
      const hold = job.stash ? 0 : size;
      this.running++;
      this.reserved += hold;
      this.loadOne(job).finally(() => {
        this.running--;
        this.reserved -= hold;
        this.pump();
      });
    }
  }

  private async loadOne(job: Job) {
    const m = this.manifest;
    const meta = m?.samples.find((s) => s.file === job.file) ?? m?.releases.find((s) => s.file === job.file);
    try {
      const data = await this.fetchBytes(this.url(job.file, meta?.sha));
      if (job.stash) {
        this.stashed.add(job.file);
        job.waiters.forEach((w) => w.ok());
        return;
      }
      const buffer = await this.decode(data, this.sampleRate);
      if (this.users === 0 && !this.started) {
        job.waiters.forEach((w) => w.ok()); // let go while it was on its way
        return;
      }
      this.entries.set(job.file, { buffer, bytes: bufferBytes(buffer), used: job.pri < BACKGROUND ? now() : 0 });
      this.failed.delete(job.file);
      if (job.pri < BACKGROUND) this.trim();
      job.waiters.forEach((w) => w.ok());
      this.emit();
    } catch (e) {
      this.failed.add(job.file);
      job.waiters.forEach((w) => w.fail(e));
    }
  }

  /** Over budget after a note asked for a file: let the least recently played go (never the first tier, nor pinned files). */
  private trim() {
    let used = this.memory();
    if (used <= this.budget) return;
    const old = [...this.entries].filter(([f]) => !this.coreSet.has(f) && !this.pinned(f)).sort((a, b) => a[1].used - b[1].used);
    const recent = now() - 10_000; // anything played in the last ten seconds stays
    for (const [f, e] of old) {
      if (used <= this.budget || e.used > recent) break;
      this.entries.delete(f);
      used -= e.bytes;
    }
  }
}

/**
 * A sensible memory budget for decoded samples: phones and small machines keep two layers and the
 * damper sounds; a desktop keeps three and loads the others when a song plays them.
 */
export function defaultBudget(): number {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  const MB = 1024 * 1024;
  if (!nav) return 320 * MB;
  if ((nav.deviceMemory ?? 8) <= 4) return 160 * MB;
  if ((nav.maxTouchPoints ?? 0) > 1) return 192 * MB;
  return 320 * MB;
}
