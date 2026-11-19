import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NeuralStatus, SplitEvent } from "./neuralstems";
import type { StemName } from "./split";

// the desktop app's native side, stood in for as `neuralstems.test.ts` does: each command answers as the Rust side would
let desktop = true;
const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let answer: (cmd: string, args: Record<string, unknown>) => Promise<unknown> = async () => null;

class FakeChannel<T> {
  onmessage: (m: T) => void = () => undefined;
}

vi.mock("../desktop", () => ({ isDesktop: () => desktop }));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: FakeChannel,
  invoke: (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    return answer(cmd, args);
  },
}));

const { StemLink, CHUNK, Fetched, pickModel } = await import("./stemlink");

const FOUR = ["drums", "bass", "other", "vocals"];
const stemFiles = (names: string[]) => names.map((name) => ({ name, path: `C:/cache/song-key/${name}.wav` }));

function status(over: Partial<NeuralStatus> = {}, ready = true): NeuralStatus {
  return {
    available: true,
    reason: null,
    models: [
      { id: "four", name: "four", stems: FOUR, present: ready, bytes: 166_000_000, source: "", page: "", licence: "MIT", sha256: null, checked_against: null, revision: null, error: null },
      { id: "six", name: "six", stems: [...FOUR, "guitar", "piano"], present: false, bytes: 136_000_000, source: "", page: "", licence: "MIT", sha256: null, checked_against: null, revision: null, error: null },
    ],
    runtime: { present: ready, loaded: false, version: "1", source: null, bytes: 25_000_000, licence: null, error: null },
    gpu: { provider: null, usable: null, note: null },
    preparing: false,
    splitting: [],
    cache_bytes: 0,
    cache_dir: "C:/cache",
    threads: 4,
    ...over,
  };
}

/** The song: a stand-in for a File the page opened. */
const song = (name = "demo.wav") => ({ name, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

/** What the link hands to the song's hearing. */
function sink() {
  const log: string[] = [];
  const pushed: { at: number; names: StemName[]; frames: number; first: number }[] = [];
  return {
    log,
    pushed,
    useStems(names: StemName[], rate: number, from = 0) {
      log.push(`use ${names.join(",")} ${rate} ${from}`);
    },
    pushRaw(at: number, raw: Partial<Record<StemName, ArrayBuffer>>) {
      const names = Object.keys(raw) as StemName[];
      const bufs = Object.values(raw) as ArrayBuffer[];
      pushed.push({ at, names, frames: bufs[0].byteLength / 8, first: new Float32Array(bufs[0])[0] });
      log.push(`push ${at}`);
    },
    endStems() {
      log.push("end");
    },
    stopStems() {
      log.push("stop");
    },
  };
}

/**
 * A native side with a split under the test's control: `emit` sends an event, `finish` ends the
 * split, and stems are read back as interleaved frames (each sample's value is its frame number,
 * so what was read from where can be checked), never past what the split has made.
 */
function native(opts: { status?: NeuralStatus; frames?: number; rate?: number; stems?: string[]; readDelay?: () => Promise<void> } = {}) {
  const st = opts.status ?? status();
  const rate = opts.rate ?? 44_100;
  const frames = opts.frames ?? 400_000;
  let events: FakeChannel<SplitEvent> | null = null;
  let progress: FakeChannel<unknown> | null = null;
  let made = 0;
  let endSplit: ((v: unknown) => void) | null = null;
  let failSplit: ((e: unknown) => void) | null = null;
  let endPrep: ((v: unknown) => void) | null = null;
  let failPrep: ((e: unknown) => void) | null = null;
  const reads: { path: string; start: number; frames: number }[] = [];
  const n = {
    reads,
    get splitting() {
      return !!endSplit;
    },
    emit(e: SplitEvent) {
      if (e.kind === "progress") made = Math.max(made, e.ready_frames);
      events!.onmessage(e);
    },
    started(cached = false) {
      n.emit({ kind: "started", key: "song-key", stems: stemFiles(opts.stems ?? FOUR), rate, seconds: frames / rate, provider: "CPU", cached });
    },
    progress(readyFrames: number) {
      n.emit({ kind: "progress", done: 1, total: 4, ready_frames: readyFrames, ready: readyFrames / rate, speed: 2, eta: 10 });
    },
    finish() {
      made = frames;
      endSplit?.({ id: "x", key: "song-key", model: "four", stems: stemFiles(opts.stems ?? FOUR), rate, frames, seconds: frames / rate, provider: "CPU", cached: false, took: 1 });
      endSplit = null;
    },
    fail(why: string) {
      failSplit?.(why);
      endSplit = null;
    },
    prep(p: unknown) {
      progress!.onmessage(p);
    },
    prepared(s: NeuralStatus) {
      endPrep?.(s);
    },
    ask: async (cmd: string, args: Record<string, unknown>): Promise<unknown> => {
      if (cmd === "stems_status") return st;
      if (cmd === "stems_upload") return "C:/cache/uploads/abc.wav";
      if (cmd === "stems_prepare") {
        progress = args.progress as FakeChannel<unknown>;
        return new Promise((res, rej) => {
          endPrep = res;
          failPrep = rej;
        });
      }
      if (cmd === "stems_split") {
        events = args.events as FakeChannel<SplitEvent>;
        return new Promise((res, rej) => {
          endSplit = res;
          failSplit = rej;
        });
      }
      if (cmd === "stems_cancel") {
        const id = String(args.id);
        if (id.startsWith("split") && failSplit) {
          failSplit("cancelled");
          endSplit = null;
          return true;
        }
        if (id.startsWith("prepare") && failPrep) {
          failPrep("cancelled");
          return true;
        }
        return false;
      }
      if (cmd === "stems_read") {
        const start = Number(args.start);
        const want = Number(args.frames);
        reads.push({ path: String(args.path), start, frames: want });
        await opts.readDelay?.();
        const k = Math.max(0, Math.min(want, made - start));
        const out = new Float32Array(k * 2);
        for (let i = 0; i < k; i++) out[2 * i] = out[2 * i + 1] = start + i;
        return out.buffer;
      }
      return null;
    },
  };
  answer = n.ask;
  return n;
}

/** Let every promise that can settle, settle. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  desktop = true;
  calls.length = 0;
  answer = async () => null;
});

describe("which model, and how far a download is", () => {
  it("the default model when it is ready; one already downloaded when it is not; else the default, to be fetched", () => {
    expect(pickModel(status())).toEqual({ id: "four", ready: true });
    const six = status({}, false);
    six.runtime.present = true;
    six.models[1].present = true;
    expect(pickModel(six)).toEqual({ id: "six", ready: true });
    expect(pickModel(status({}, false))).toEqual({ id: "four", ready: false });
    expect(pickModel(status({ models: [] }))).toBeNull();
  });

  it("a download's progress counts the runtime's and the model's bytes together", () => {
    const f = new Fetched({ runtime: 25, model: 75 });
    expect(f.take({ part: "runtime", step: "download", done: 25, total: 25 })).toBeCloseTo(0.25);
    expect(f.take({ part: "model", step: "download", done: 30, total: null })).toBeCloseTo(0.55);
    expect(f.take({ part: "model", step: "check", done: 0, total: null })).toBeCloseTo(1);
    expect(f.take({ part: "gpu", step: "try", done: 0, total: null })).toBeCloseTo(1);
  });
});

describe("the Canvas's link to the neural split", () => {
  it("with everything downloaded, the split starts at once, and every newly ready stretch is read in chunks and handed on in order", async () => {
    const n = native();
    const s = sink();
    const views: string[] = [];
    const link = new StemLink(song(), s, { onChange: (v) => views.push(v.phase) });
    await link.start();
    await settle();
    expect(calls.map((c) => c.cmd)).toEqual(["stems_status", "stems_upload", "stems_split"]);
    expect(calls[2].args).toMatchObject({ path: "C:/cache/uploads/abc.wav", model: "four" });
    n.started();
    await settle();
    expect(s.log).toEqual(["use drums,bass,other,vocals 44100 0"]);
    expect(link.view.phase).toBe("splitting");
    // partial readiness: only what is ready is read, a chunk at a time
    n.progress(300_000);
    await settle();
    expect(s.pushed.map((p) => [p.at, p.frames, p.first])).toEqual([[0, CHUNK, 0], [CHUNK, CHUNK, CHUNK], [2 * CHUNK, 300_000 - 2 * CHUNK, 2 * CHUNK]]);
    for (const r of n.reads) expect(r.frames).toBeLessThanOrEqual(CHUNK);
    expect(n.reads.every((r) => r.start + r.frames <= 300_000)).toBe(true);
    // every stem, each read once per stretch
    expect(n.reads.filter((r) => r.start === 0).map((r) => r.path).sort()).toEqual(stemFiles(FOUR).map((f) => f.path).sort());
    expect(link.view.ready).toBeCloseTo(300_000 / 44_100, 6);
    expect(link.view.read).toBeCloseTo(300_000 / 44_100, 6);
    // the rest, and the end
    n.finish();
    await settle();
    expect(s.pushed.at(-1)).toMatchObject({ at: 300_000, frames: 100_000 });
    expect(s.log.at(-1)).toBe("end");
    expect(link.view.phase).toBe("done");
    expect(views).toContain("checking");
    expect(views.at(-1)).toBe("done");
    // stopping a link that is done cancels nothing and stops nothing
    calls.length = 0;
    link.stop();
    await settle();
    expect(calls).toHaveLength(0);
    expect(s.log.at(-1)).toBe("end");
  });

  it("events out of order: progress before the start is read once the stems are known, and readiness never goes back", async () => {
    const n = native();
    const s = sink();
    const link = new StemLink(song(), s, { chunk: 100_000 });
    await link.start();
    await settle();
    n.progress(150_000);
    await settle();
    expect(s.pushed).toHaveLength(0);
    n.started();
    await settle();
    expect(s.pushed.map((p) => [p.at, p.frames])).toEqual([[0, 100_000], [100_000, 50_000]]);
    // an older report arriving late changes nothing
    n.progress(120_000);
    await settle();
    expect(s.pushed).toHaveLength(2);
    expect(link.view.ready).toBeCloseTo(150_000 / 44_100, 6);
  });

  it("stems from a split kept from before are taken up at once, even if the split ends before saying it started", async () => {
    const n = native({ frames: 200_000 });
    const s = sink();
    const link = new StemLink(song(), s);
    await link.start();
    await settle();
    n.finish();
    await settle();
    expect(s.log[0]).toBe("use drums,bass,other,vocals 44100 0");
    expect(s.pushed.reduce((k, p) => k + p.frames, 0)).toBe(200_000);
    expect(s.log.at(-1)).toBe("end");
    expect(link.view.phase).toBe("done");
    // and with the start said, the kept stems are marked as such
    const m = native({ frames: 1000 });
    const t = sink();
    const again = new StemLink(song(), t);
    await again.start();
    await settle();
    m.started(true);
    m.finish();
    await settle();
    expect(again.view.cached).toBe(true);
    expect(t.log).toEqual(["use drums,bass,other,vocals 44100 0", "push 0", "end"]);
  });

  it("nothing is read while a take is recorded (the split has paused), and reading goes on when it resumes", async () => {
    const n = native();
    const s = sink();
    const link = new StemLink(song(), s, { chunk: 50_000 });
    await link.start();
    await settle();
    n.started();
    n.progress(50_000);
    await settle();
    expect(s.pushed).toHaveLength(1);
    n.emit({ kind: "paused", reason: "recording" });
    n.progress(150_000);
    await settle();
    expect(link.view.phase).toBe("paused");
    expect(s.pushed).toHaveLength(1);
    n.emit({ kind: "resumed" });
    await settle();
    expect(link.view.phase).toBe("splitting");
    expect(s.pushed.map((p) => p.at)).toEqual([0, 50_000, 100_000]);
  });

  it("closing the song mid-split cancels the split, hands nothing more on, and tells the hearing the stems stop there", async () => {
    let release: () => void = () => undefined;
    const n = native({ readDelay: () => new Promise<void>((r) => (release = r)) });
    const s = sink();
    const link = new StemLink(song(), s);
    await link.start();
    await settle();
    n.started();
    n.progress(100_000);
    await settle();
    // a read is under way when the song is closed
    expect(n.reads.length).toBeGreaterThan(0);
    link.stop();
    release();
    await settle();
    expect(calls.filter((c) => c.cmd === "stems_cancel")).toHaveLength(1);
    expect(String(calls.find((c) => c.cmd === "stems_cancel")!.args.id)).toMatch(/^split-/);
    expect(s.pushed).toHaveLength(0);
    expect(s.log).toEqual(["use drums,bass,other,vocals 44100 0", "stop"]);
    // whatever the native side still says is not listened to
    const reads = n.reads.length;
    expect(n.splitting).toBe(false);
    link.stop();
    await settle();
    expect(n.reads.length).toBe(reads);
    expect(calls.filter((c) => c.cmd === "stems_cancel")).toHaveLength(1);
  });

  it("another song opened (or the page left) before the split began: the split that was being started is cancelled as soon as it exists", async () => {
    let upload: (v: string) => void = () => undefined;
    const n = native();
    const ask = n.ask;
    answer = (cmd, args) => (cmd === "stems_upload" ? new Promise((r) => (upload = r)) : ask(cmd, args));
    const s = sink();
    const first = new StemLink(song("a.wav"), s);
    await first.start();
    await settle();
    first.stop();
    upload("C:/cache/uploads/a.wav");
    await settle();
    expect(calls.map((c) => c.cmd)).toEqual(["stems_status", "stems_upload", "stems_split", "stems_cancel"]);
    expect(s.log).toEqual([]);
    // the next song's link starts on its own
    answer = ask;
    const t = sink();
    const second = new StemLink(song("b.wav"), t);
    await second.start();
    await settle();
    n.started();
    n.progress(1000);
    await settle();
    expect(t.pushed).toHaveLength(1);
    expect(s.pushed).toHaveLength(0);
  });

  it("where the split cannot run, nothing is asked of a native side, and the reason is kept for a hover", async () => {
    desktop = false;
    const s = sink();
    const web = new StemLink(song(), s);
    await web.start();
    expect(web.view.phase).toBe("off");
    expect(web.view.reason).toMatch(/desktop app/);
    expect(calls).toHaveLength(0);
    // a computer without the runtime it needs
    desktop = true;
    native({ status: status({ available: false, reason: "A runtime library is missing; install it and restart the app." }) });
    const pc = new StemLink(song(), s);
    await pc.start();
    expect(pc.view.phase).toBe("off");
    expect(pc.view.reason).toMatch(/restart the app/);
    expect(calls.map((c) => c.cmd)).toEqual(["stems_status"]);
    // a native side that cannot answer at all
    calls.length = 0;
    answer = async () => {
      throw "no data folder";
    };
    const broken = new StemLink(song(), s);
    await broken.start();
    expect(broken.view.phase).toBe("off");
    expect(broken.view.reason).toMatch(/data folder/);
    expect(s.log).toEqual([]);
  });

  it("not downloaded yet: the size is offered; asked for, it downloads once with progress, and the split starts by itself", async () => {
    const n = native({ status: status({}, false) });
    const s = sink();
    const link = new StemLink(song(), s);
    await link.start();
    expect(link.view.phase).toBe("need");
    expect(link.view.bytes).toBe(25_000_000 + 166_000_000);
    expect(calls.map((c) => c.cmd)).toEqual(["stems_status"]);
    void link.fetch();
    void link.fetch();
    await settle();
    expect(calls.filter((c) => c.cmd === "stems_prepare")).toHaveLength(1);
    expect(link.view.phase).toBe("fetching");
    n.prep({ part: "runtime", step: "download", done: 25_000_000, total: 25_000_000 });
    expect(link.view.fetched).toBeGreaterThan(0.1);
    n.prep({ part: "model", step: "download", done: 83_000_000, total: 166_000_000 });
    expect(link.view.fetched).toBeCloseTo((25 + 83) / 191, 2);
    n.prepared(status());
    await settle();
    expect(calls.map((c) => c.cmd)).toEqual(["stems_status", "stems_prepare", "stems_upload", "stems_split"]);
    n.started();
    n.progress(10_000);
    await settle();
    expect(s.pushed).toHaveLength(1);
  });

  it("a download stopped by the painter goes back to the offer; one that fails keeps why for a hover", async () => {
    const n = native({ status: status({}, false) });
    const link = new StemLink(song(), sink());
    await link.start();
    void link.fetch();
    await settle();
    link.cancelFetch();
    await settle();
    expect(String(calls.find((c) => c.cmd === "stems_cancel")!.args.id)).toMatch(/^prepare-/);
    expect(link.view.phase).toBe("need");
    expect(link.view.reason).toBeNull();
    void link.fetch();
    await settle();
    n.prepared({ ...status({}, false), models: status({}, false).models.map((m) => ({ ...m, error: m.id === "four" ? "The model could not be opened" : null })) });
    await settle();
    expect(link.view.phase).toBe("need");
    expect(link.view.reason).toMatch(/could not be opened/);
    // leaving the page during a download stops it
    void link.fetch();
    await settle();
    link.stop();
    await settle();
    expect(calls.filter((c) => c.cmd === "stems_cancel")).toHaveLength(2);
  });

  it("a split that fails keeps what it made: the stems stop where they were read to, and the quick split paints the rest", async () => {
    const n = native();
    const s = sink();
    const link = new StemLink(song(), s);
    await link.start();
    await settle();
    n.started();
    n.progress(20_000);
    await settle();
    n.fail("out of memory");
    await settle();
    expect(link.view.phase).toBe("failed");
    expect(link.view.reason).toMatch(/memory/);
    expect(s.log).toEqual(["use drums,bass,other,vocals 44100 0", "push 0", "stop"]);
    // tried again: a fresh hand-over from the start
    link.retry();
    await settle();
    n.started();
    n.progress(5_000);
    await settle();
    expect(s.log.slice(3)).toEqual(["use drums,bass,other,vocals 44100 0", "push 0"]);
  });

  it("a stem that cannot be read gives the split up, without harm to the painting", async () => {
    const n = native();
    const ask = n.ask;
    answer = (cmd, args) => (cmd === "stems_read" ? Promise.reject("the stem file is gone") : ask(cmd, args));
    const s = sink();
    const link = new StemLink(song(), s);
    await link.start();
    await settle();
    n.started();
    n.progress(1000);
    await settle();
    expect(link.view.phase).toBe("failed");
    expect(s.log).toEqual(["use drums,bass,other,vocals 44100 0", "stop"]);
    expect(calls.some((c) => c.cmd === "stems_cancel")).toBe(true);
  });

  it("a six-stem model's guitar and piano are handed over as stems of their own; names the painting does not know are left out", async () => {
    const n = native({ stems: [...FOUR, "guitar", "piano", "kazoo"] });
    const s = sink();
    const link = new StemLink(song(), s);
    await link.start();
    await settle();
    n.started();
    n.progress(1000);
    await settle();
    expect(s.log[0]).toBe("use drums,bass,other,vocals,guitar,piano 44100 0");
    expect(s.pushed[0].names).toEqual(["drums", "bass", "other", "vocals", "guitar", "piano"]);
    expect(link.view.stems).toContain("guitar");
    expect(n.reads.some((r) => r.path.includes("kazoo"))).toBe(false);
  });
});
