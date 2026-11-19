import { beforeEach, describe, expect, it, vi } from "vitest";

// the desktop app's native side, stood in for: each command answers as the Rust side would
let desktop = true;
const calls: { cmd: string; args: unknown; options?: unknown }[] = [];
let answer: (cmd: string, args: Record<string, unknown>) => Promise<unknown> = async () => null;

class FakeChannel<T> {
  onmessage: (m: T) => void = () => undefined;
}

vi.mock("../desktop", () => ({ isDesktop: () => desktop }));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: FakeChannel,
  invoke: (cmd: string, args: Record<string, unknown>, options?: unknown) => {
    calls.push({ cmd, args, options });
    return answer(cmd, args);
  },
}));

const ns = await import("./neuralstems");

const stems = [
  { name: "drums", path: "C:/cache/abc-htdemucs/drums.wav" },
  { name: "bass", path: "C:/cache/abc-htdemucs/bass.wav" },
  { name: "other", path: "C:/cache/abc-htdemucs/other.wav" },
  { name: "vocals", path: "C:/cache/abc-htdemucs/vocals.wav" },
];

function status(over: Partial<import("./neuralstems").NeuralStatus> = {}): import("./neuralstems").NeuralStatus {
  return {
    available: true,
    reason: null,
    models: [
      { id: "htdemucs", name: "Demucs v4", stems: ["drums", "bass", "other", "vocals"], present: false, bytes: 166_000_000, source: "https://example/htdemucs.onnx", page: "", licence: "MIT", sha256: null, checked_against: null, revision: null },
      { id: "htdemucs_6s", name: "Demucs v4, six", stems: ["drums", "bass", "other", "vocals", "guitar", "piano"], present: true, bytes: 136_000_000, source: "", page: "", licence: "MIT", sha256: "ab", checked_against: "host", revision: null },
    ],
    runtime: { present: false, loaded: false, version: "1.24.4", source: "https://files.pythonhosted.org/x.whl", bytes: 25_111_930, licence: "MIT", error: null },
    gpu: { provider: "DirectML", usable: null, note: null },
    preparing: false,
    splitting: [],
    cache_bytes: 0,
    cache_dir: "C:/cache",
    threads: 4,
    ...over,
  };
}

beforeEach(() => {
  desktop = true;
  calls.length = 0;
  answer = async () => null;
});

describe("where neural stems can run", () => {
  it("in the browser they cannot, and nothing is asked of a native side", async () => {
    desktop = false;
    expect(ns.neuralUnavailable(false)).toMatch(/desktop app/);
    const s = await ns.neuralStatus();
    expect(s.available).toBe(false);
    expect(s.reason).toMatch(/desktop app/);
    expect(ns.readyToSplit(s)).toBe(false);
    await expect(ns.prepareNeural().done).rejects.toThrow(/desktop app/);
    await expect(ns.splitNeural("song.mp3").done).rejects.toThrow(/desktop app/);
    await expect(ns.readStem("x.wav", 0, 10)).rejects.toThrow(/desktop app/);
    expect(await ns.clearStems()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("in the desktop app, the native side's answer counts", async () => {
    expect(ns.neuralUnavailable(true)).toBeNull();
    expect(ns.neuralUnavailable(true, { available: false, reason: "needs a 64-bit PC" })).toBe("needs a 64-bit PC");
    answer = async () => status();
    const s = await ns.neuralStatus();
    expect(calls.map((c) => c.cmd)).toEqual(["stems_status"]);
    expect(ns.readyToSplit(s)).toBe(false);
    expect(ns.readyToSplit(s, "htdemucs_6s")).toBe(false);
    expect(ns.readyToSplit(status({ runtime: { ...s.runtime, present: true } }), "htdemucs_6s")).toBe(true);
    // what is still to be fetched: the runtime and the model
    expect(ns.toDownload(s)).toBe(25_111_930 + 166_000_000);
    expect(ns.toDownload(s, "htdemucs_6s")).toBe(25_111_930);
    expect(ns.sizeLabel(166_000_000)).toBe("166 MB");
    expect(ns.sizeLabel(4.2e9)).toBe("4.2 GB");
  });
});

describe("downloading", () => {
  it("reports progress, and can be cancelled by its id", async () => {
    const seen: string[] = [];
    answer = async (cmd, args) => {
      if (cmd === "stems_prepare") {
        const ch = args.progress as FakeChannel<import("./neuralstems").PrepareProgress>;
        ch.onmessage({ part: "runtime", step: "download", done: 1, total: 2 });
        ch.onmessage({ part: "model", step: "download", done: 5, total: null });
        ch.onmessage({ part: "gpu", step: "done", done: 0, total: null });
        return status({ runtime: { ...status().runtime, present: true } });
      }
      if (cmd === "stems_cancel") return true;
      return null;
    };
    const job = ns.prepareNeural({ model: "htdemucs", onProgress: (p) => seen.push(`${p.part}:${p.step}`) });
    const s = await job.done;
    expect(s.runtime.present).toBe(true);
    expect(seen).toEqual(["runtime:download", "model:download", "gpu:done"]);
    expect(calls[0].args).toMatchObject({ id: job.id, model: "htdemucs" });
    expect(await job.cancel()).toBe(true);
    expect(calls[1]).toMatchObject({ cmd: "stems_cancel", args: { id: job.id } });
  });

  it("a failed download is an ordinary error, and a cancel is told apart from one", async () => {
    answer = async () => {
      throw "Could not reach huggingface.co (timed out)";
    };
    const e = await ns.prepareNeural().done.catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toMatch(/Could not reach/);
    expect(ns.isCancelled(e)).toBe(false);
    answer = async () => {
      throw "cancelled";
    };
    expect(ns.isCancelled(await ns.prepareNeural().done.catch((x) => x))).toBe(true);
  });
});

describe("splitting", () => {
  it("the stems can be read as far as they are ready, before the whole song is done", async () => {
    let emit: (e: import("./neuralstems").SplitEvent) => void = () => undefined;
    let finish: (v: unknown) => void = () => undefined;
    answer = (cmd, args) =>
      new Promise((resolve) => {
        if (cmd !== "stems_split") return resolve(null);
        emit = (e) => (args.events as FakeChannel<import("./neuralstems").SplitEvent>).onmessage(e);
        finish = resolve;
      });
    const events: string[] = [];
    const job = ns.splitNeural("C:/Music/song.mp3", { onEvent: (e) => events.push(e.kind) });
    expect(job.state.phase).toBe("waiting");
    // the native side has the job once the bridge has been reached
    await vi.waitFor(() => expect(calls.map((c) => c.cmd)).toContain("stems_split"));
    const at10 = job.whenReady(10);
    const at5 = job.whenReady(5);
    emit({ kind: "loading" });
    emit({ kind: "started", key: "abc-htdemucs", stems, rate: 48_000, seconds: 30, provider: "DirectML", cached: false });
    expect(job.state.stems.map((s) => s.name)).toEqual(["drums", "bass", "other", "vocals"]);
    emit({ kind: "progress", done: 1, total: 6, ready_frames: 280_000, ready: 280_000 / 48_000, speed: 2, eta: 12 });
    expect(job.state.phase).toBe("working");
    expect(ns.readyUpTo(job.state, 5)).toBe(true);
    expect(ns.readyUpTo(job.state, 6)).toBe(false);
    expect(await at5).toBe(true);
    // what can be read of a part that is only partly made
    expect(ns.readableFrames(job.state, 270_000, 48_000)).toBe(10_000);
    expect(ns.readableFrames(job.state, 300_000, 48_000)).toBe(0);
    emit({ kind: "paused", reason: "recording" });
    expect(job.state.phase).toBe("paused");
    emit({ kind: "resumed" });
    emit({ kind: "progress", done: 2, total: 6, ready_frames: 560_000, ready: 560_000 / 48_000, speed: 2, eta: 9 });
    expect(await at10).toBe(true);
    finish({ id: job.id, key: "abc-htdemucs", model: "htdemucs", stems, rate: 48_000, frames: 1_440_000, seconds: 30, provider: "DirectML", cached: false, took: 15 });
    const r = await job.done;
    expect(r.frames).toBe(1_440_000);
    expect(job.state.phase).toBe("done");
    expect(ns.readyUpTo(job.state, 30)).toBe(true);
    expect(events).toEqual(["loading", "started", "progress", "paused", "resumed", "progress"]);
    expect(calls[0]).toMatchObject({ cmd: "stems_split", args: { id: job.id, path: "C:/Music/song.mp3", model: null } });
  });

  it("a split that fails or is cancelled says so, and anyone waiting for a part is told it will not come", async () => {
    answer = async (cmd) => {
      if (cmd === "stems_split") throw "This kind of file cannot be split here (unsupported codec)";
      return true;
    };
    const job = ns.splitNeural("song.opus");
    const waiting = job.whenReady(3);
    await expect(job.done).rejects.toThrow(/cannot be split/);
    expect(await waiting).toBe(false);
    expect(job.state.phase).toBe("failed");
    expect(job.state.error).toMatch(/cannot be split/);

    answer = async (cmd) => {
      if (cmd === "stems_split") throw "cancelled";
      return true;
    };
    const job2 = ns.splitNeural("song.mp3");
    await job2.done.catch(() => undefined);
    expect(job2.state.phase).toBe("cancelled");
    expect(job2.state.error).toBeNull();
    expect(job2.id).not.toBe(job.id);
  });

  it("the same song again comes from the cache, ready at once", () => {
    let s = ns.initialSplit();
    s = ns.onSplitEvent(s, { kind: "started", key: "abc-htdemucs", stems, rate: 44_100, seconds: 10, provider: "CPU", cached: true });
    s = ns.onSplitEvent(s, { kind: "progress", done: 1, total: 1, ready_frames: 441_000, ready: 10, speed: 0, eta: 0 });
    expect(s.cached).toBe(true);
    expect(ns.readyUpTo(s, 10)).toBe(true);
    // a late or repeated report never takes back what is ready
    s = ns.onSplitEvent(s, { kind: "progress", done: 1, total: 1, ready_frames: 100, ready: 0.01, speed: 0, eta: 0 });
    expect(s.readyFrames).toBe(441_000);
  });

  it("a file the page opened is handed over as bytes, with only its kind named", async () => {
    answer = async (cmd) => {
      if (cmd === "stems_upload") return "C:/cache/uploads/abc.mp3";
      if (cmd === "stems_split") return { id: "x", key: "k", model: "htdemucs", stems, rate: 44_100, frames: 1, seconds: 0, provider: "CPU", cached: false, took: 1 };
      return null;
    };
    const file = { name: "Été — démo final.MP3", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    const job = await ns.splitFile(file);
    await job.done;
    expect(calls[0].cmd).toBe("stems_upload");
    expect(Array.from(calls[0].args as Uint8Array)).toEqual([1, 2, 3]);
    expect(calls[0].options).toEqual({ headers: { "x-name": "song.mp3" } });
    expect(calls[1].args).toMatchObject({ path: "C:/cache/uploads/abc.mp3" });
    expect(ns.fileKind("track.flac")).toBe("flac");
    expect(ns.fileKind("no-ending")).toBe("bin");
  });
});

describe("reading a stem back", () => {
  it("left and right come apart into one array each", async () => {
    const inter = new Float32Array([0.5, -0.5, 0.25, -0.25, 1, -1]);
    answer = async (cmd) => (cmd === "stems_read" ? inter.buffer.slice(0) : null);
    const [l, r] = await ns.readStem(stems[3].path, 1000.4, 3);
    expect(Array.from(l)).toEqual([0.5, 0.25, 1]);
    expect(Array.from(r)).toEqual([-0.5, -0.25, -1]);
    expect(calls[0]).toMatchObject({ cmd: "stems_read", args: { path: stems[3].path, start: 1000, frames: 3 } });
  });

  it("a part cut short mid-frame keeps only whole frames", () => {
    const buf = new Float32Array([1, 2, 3, 4, 5]).buffer;
    const [l, r] = ns.deinterleave(buf, 2);
    expect(Array.from(l)).toEqual([1, 3]);
    expect(Array.from(r)).toEqual([2, 4]);
    expect(ns.deinterleave(new ArrayBuffer(0), 2).map((c) => c.length)).toEqual([0, 0]);
  });
});
