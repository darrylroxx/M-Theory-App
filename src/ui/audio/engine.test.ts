// The plain parts of the recording engine's hook: the store every readout reads, what the readouts say, the order in
// which the interface is opened and closed (against a pretend desktop side that notes every call and behaves as the
// real one does: an open closes what is open first, a close closes whatever is open), and a recording that comes
// back after a reset of the driver being kept exactly once.
import { describe, expect, it } from "vitest";
import type { AudioHost, EngineOpened, EngineStatus } from "../../desktop";
import type { Recorded } from "../../song/takes";
import { Claims, countText, delayText, devicesOf, dropoutText, engineStatus, makeDoor, makeStore, sessionNotes, type EngineNow, type EngineReadout } from "./useEngine";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const OPENED: EngineOpened = { host: "ASIO", device: "Test Interface", rate: 48000, inputs: 2, outputs: 2, format: "f32", min_buffer: 32, max_buffer: 1024 };
const status = (o: Partial<EngineStatus> = {}): EngineStatus => ({ peak: [0, 0], rms: [0, 0], pos: 0, count_in: 0, length: 0, running: false, reduction: 0, limit: 0, invalid: false, xruns: 0, block: 64, latency: 0, ...o });
const now = (o: Partial<EngineNow> = {}): EngineNow => ({ opened: OPENED, phase: "idle", pass: 0, track: "tv", bpm: 0, ...o });
const recorded = (dry: string): Recorded => ({ dry, wet: dry, rate: 48000, frames: 96000, offset: 0, count_in: 0, loop_frames: 48000, dropped: 0, padded: 0, note: null });

describe("the status store", () => {
  it("has one list of readers: each is told every value published, until it stops", () => {
    const s = makeStore(0);
    const a: number[] = [];
    const b: number[] = [];
    const stopA = s.subscribe((v) => a.push(v));
    const stopB = s.subscribe((v) => b.push(v));
    expect(s.size).toBe(2);
    s.publish(1);
    s.publish(2);
    stopA();
    s.publish(3);
    expect(a).toEqual([0, 1, 2]);
    expect(b).toEqual([0, 1, 2, 3]);
    expect(s.size).toBe(1);
    stopB();
    expect(s.size).toBe(0);
    // (told to stop twice: nothing happens)
    stopB();
    s.publish(4);
    expect(b).toEqual([0, 1, 2, 3]);
  });
  it("a reader that comes late is given the last value at once", () => {
    const s = makeStore("first");
    s.publish("second");
    const seen: string[] = [];
    s.subscribe((v) => seen.push(v));
    expect(seen).toEqual(["second"]);
    expect(s.last()).toBe("second");
  });
  it("a reader that stops while a value is being told does not upset the others", () => {
    const s = makeStore(0);
    const seen: number[] = [];
    let n = 0;
    const stop: () => void = s.subscribe(() => { if (++n > 1) stop(); });
    s.subscribe((v) => seen.push(v));
    s.publish(1);
    s.publish(2);
    expect(seen).toEqual([0, 1, 2]);
    expect(s.size).toBe(1);
  });
  it("the engine's own store starts closed and idle", () => {
    const r = engineStatus.last();
    expect(r.st).toBeNull();
    expect(r.now).toEqual({ opened: null, phase: "idle", pass: 0, track: null, bpm: 0 });
  });
});

describe("what the readouts say", () => {
  const at = (st: Partial<EngineStatus>, n: Partial<EngineNow> = {}): EngineReadout => ({ st: status(st), now: now(n) });
  it("the count-in is counted down a beat at a time, then the pass is named", () => {
    // 120 bpm at 48 kHz: a beat is 24,000 frames; a count-in of one 4/4 bar is 96,000
    const going = { phase: "recording" as const, bpm: 120 };
    expect(countText(at({ running: true, pos: 0, count_in: 96000, length: 192000 }, going))).toBe("4");
    expect(countText(at({ running: true, pos: 24001, count_in: 96000, length: 192000 }, going))).toBe("3");
    expect(countText(at({ running: true, pos: 95999, count_in: 96000, length: 192000 }, going))).toBe("1");
    expect(countText(at({ running: true, pos: 96000, count_in: 96000, length: 192000 }, going))).toBe("Pass 1");
    expect(countText(at({ running: true, pos: 96000 + 2 * 192000 + 5, count_in: 96000, length: 192000 }, going))).toBe("Pass 3");
    // a rehearsal counts its passes too
    expect(countText(at({ running: true, pos: 96000 + 192000, count_in: 96000, length: 192000 }, { phase: "rehearsing", bpm: 120 }))).toBe("Pass 2");
    // nothing while the interface only listens, or is closed
    expect(countText(at({ running: false }))).toBe("");
    expect(countText({ st: null, now: now() })).toBe("");
  });
  it("a long session is noted, and what room is left comes first", () => {
    const rec = { phase: "recording" as const, bpm: 100 };
    expect(sessionNotes(at({ running: true, pos: 48000 * 60 * 5 }, rec))).toEqual({ text: "", warn: false });
    expect(sessionNotes(at({ running: true, pos: 48000 * 60 * 31 }, rec))).toEqual({ text: "31 min", warn: false });
    const tight = sessionNotes(at({ running: true, pos: 48000 * 60 * 31, recorded: 1000, room: 48000 * 60 * 4, free: 1.5e9 }, rec));
    expect(tight).toEqual({ text: "⚠ 4 min left · 1.5 GB free · 31 min", warn: true });
    // only while recording
    expect(sessionNotes(at({ running: true, pos: 48000 * 60 * 31, recorded: 1000, room: 10, free: 1 }, { phase: "rehearsing", bpm: 100 }))).toEqual({ text: "", warn: false });
    expect(sessionNotes({ st: null, now: now() })).toEqual({ text: "", warn: false });
  });
  it("the delay is the driver's own figure once it is in, an estimate from the buffer until then; dropouts are counted", () => {
    expect(delayText(at({ block: 64, latency: 0 }))).toBe("~5 ms");
    expect(delayText(at({ block: 64, latency: 7.26 }))).toBe("7.3 ms");
    expect(delayText(at({ block: 0 }))).toBe("");
    expect(delayText({ st: null, now: now() })).toBe("");
    expect(dropoutText({ xruns: 0 })).toBe("no dropouts");
    expect(dropoutText({ xruns: 1 })).toBe("1 dropout");
    expect(dropoutText({ xruns: 12 })).toBe("12 dropouts");
  });
});

describe("the interfaces that can record and play", () => {
  it("only devices with inputs and outputs, the low-latency driver's first", () => {
    const port = (channels: number) => ({ channels, min_rate: 44100, max_rate: 96000 });
    const hosts: AudioHost[] = [
      { name: "WASAPI", error: null, devices: [{ name: "Speakers", input: null, output: port(2), default_rate: 48000 }, { name: "Line", input: port(2), output: port(2), default_rate: 48000 }] },
      { name: "ASIO", error: null, devices: [{ name: "Test Interface", input: port(4), output: port(4), default_rate: 48000 }] },
    ];
    expect(devicesOf(hosts)).toEqual([{ host: "ASIO", name: "Test Interface", channels: 4 }, { host: "WASAPI", name: "Line", channels: 2 }]);
    expect(devicesOf(null)).toEqual([]);
  });
});

/**
 * A pretend desktop side. Like the real one (src/desktop.ts, src-tauri/src/engine.rs): a call first waits a moment
 * for the bridge to be loaded, then takes its turn after every call asked for before it; `engine_open` closes what
 * is open and opens anew (a recording still going is put by for whoever closes next); `engine_close` closes whatever
 * is open, and hands back a recording that was going, or one put by.
 */
function pretend(o: { openMs?: number } = {}) {
  const calls: string[] = [];
  let line: Promise<unknown> = Promise.resolve();
  const inTurn = <T,>(fn: () => Promise<T>): Promise<T> => {
    const p = line.then(fn, fn);
    line = p.catch(() => undefined);
    return p;
  };
  const loaded = () => Promise.resolve();
  const eng = { open: null as string | null, recording: null as Recorded | null, stash: null as Recorded | null, opens: 0, failClose: false };
  const bridge = {
    async engineOpen(host: string, device: string, buffer: number | null, _onStatus: (s: EngineStatus) => void): Promise<EngineOpened> {
      await loaded();
      return inTurn(async () => {
        calls.push(`open ${buffer ?? "driver"}`);
        await new Promise((r) => setTimeout(r, o.openMs ?? 0));
        if (eng.recording) {
          eng.stash = eng.recording;
          eng.recording = null;
        }
        eng.open = `${host}|${device}|${buffer ?? "driver"}`;
        eng.opens += 1;
        return OPENED;
      });
    },
    async engineClose(): Promise<Recorded | null> {
      await loaded();
      return inTurn(async () => {
        calls.push("close");
        if (eng.failClose) throw new Error("the driver did not answer");
        const r = eng.recording ?? eng.stash;
        eng.recording = eng.stash = null;
        eng.open = null;
        return r;
      });
    },
  };
  return { calls, eng, bridge };
}
const noStatus = () => {};
const rest = { comeBack: async () => {}, salvage: () => {}, closed: () => {} };

describe("the order the interface is opened and closed in", () => {
  it("sent as the old page sent them (the close a moment after the open that follows it), the close lands last: the interface ends closed", async () => {
    const { calls, eng, bridge } = pretend();
    await bridge.engineOpen("ASIO", "Test Interface", null, noStatus);
    // another buffer size picked with the interface open: the old one is closed and the new one opened, in one go
    void rest.comeBack().then(() => bridge.engineClose());
    void bridge.engineOpen("ASIO", "Test Interface", 128, noStatus);
    await tick();
    await tick();
    expect(calls).toEqual(["open driver", "open 128", "close"]);
    expect(eng.open).toBeNull();
  });

  it("through the door, an open waits for the close asked for before it: the interface ends open", async () => {
    const { calls, eng, bridge } = pretend();
    const door = makeDoor(bridge, rest);
    await door.open("ASIO", "Test Interface", null, noStatus);
    // the same change, as the hook makes it: its effect's cleanup closes, and the effect opens again at once
    void door.close();
    const opened = door.open("ASIO", "Test Interface", 128, noStatus);
    await expect(opened).resolves.toEqual(OPENED);
    expect(calls).toEqual(["open driver", "close", "open 128"]);
    expect(eng.open).toBe("ASIO|Test Interface|128");
  });

  it("also when the app's own sound has to be faded back first (it came through the engine), and the driver is slow", async () => {
    const { calls, eng, bridge } = pretend({ openMs: 5 });
    const door = makeDoor(bridge, { ...rest, comeBack: () => new Promise<void>((r) => setTimeout(r, 20)) });
    await door.open("ASIO", "Test Interface", 64, noStatus);
    void door.close();
    await door.open("ASIO", "Test Interface", 256, noStatus);
    expect(calls).toEqual(["open 64", "close", "open 256"]);
    expect(eng.open).toBe("ASIO|Test Interface|256");
  });

  it("three changes in a row, each before the last was done: every close before the open that follows it, the last open stands", async () => {
    const { calls, eng, bridge } = pretend({ openMs: 2 });
    const door = makeDoor(bridge, rest);
    void door.open("ASIO", "Test Interface", 64, noStatus);
    for (const b of [128, 256, 512]) {
      void door.close();
      void door.open("ASIO", "Test Interface", b, noStatus);
    }
    await door.settled();
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toEqual(["open 64", "close", "open 128", "close", "open 256", "close", "open 512"]);
    expect(eng.open).toBe("ASIO|Test Interface|512");
  });

  it("the first open of all is not kept waiting, and a close with nothing after it leaves the interface closed", async () => {
    const { calls, eng, bridge } = pretend();
    const door = makeDoor(bridge, rest);
    await door.open("ASIO", "Test Interface", null, noStatus);
    expect(eng.open).not.toBeNull();
    await door.close();
    expect(calls).toEqual(["open driver", "close"]);
    expect(eng.open).toBeNull();
  });

  it("whoever waits for the interface to close (a sound about to start) is told once it has", async () => {
    const { eng, bridge } = pretend();
    let told = 0;
    let openThen: string | null = "?";
    const door = makeDoor(bridge, { ...rest, closed: () => { told += 1; openThen = eng.open; } });
    await door.open("ASIO", "Test Interface", null, noStatus);
    const closing = door.close();
    expect(told).toBe(0);
    await closing;
    expect(told).toBe(1);
    expect(openThen).toBeNull();
  });

  it("a close the driver does not answer still lets the next open through, and still tells who waits", async () => {
    const { calls, eng, bridge } = pretend();
    let told = 0;
    const door = makeDoor(bridge, { ...rest, closed: () => void told++ });
    await door.open("ASIO", "Test Interface", null, noStatus);
    eng.failClose = true;
    void door.close();
    await door.open("ASIO", "Test Interface", 128, noStatus);
    expect(calls).toEqual(["open driver", "close", "open 128"]);
    expect(told).toBe(1);
    expect(eng.open).toBe("ASIO|Test Interface|128");
  });
});

describe("a recording that comes back after the driver was reset", () => {
  it("is handed over by the close, and reaches onRecorded once", async () => {
    const { calls, eng, bridge } = pretend();
    const claims = new Claims<string, string>();
    const kept: Recorded[] = [];
    // (as the hook does it: the close hands the recording to `salvage`, which claims it and has it laid on its track)
    const onRecorded = (r: Recorded) => kept.push(r);
    const salvage = (r: Recorded) => { if (claims.claim(r)) onRecorded(r); };
    const door = makeDoor(bridge, { ...rest, salvage });
    await door.open("ASIO", "Test Interface", null, noStatus);
    claims.begin("bars 1–4", "tv", true);
    claims.started("C:/Recordings/Vocal-1.wav");
    eng.recording = recorded("C:/Recordings/Vocal-1.wav");
    // the driver resets: the hook closes the interface and opens it again
    void door.close();
    await door.open("ASIO", "Test Interface", null, noStatus);
    expect(calls).toEqual(["open driver", "close", "open driver"]);
    expect(kept.map((r) => r.dry)).toEqual(["C:/Recordings/Vocal-1.wav"]);
    // Stop pressed in the same moment hands the same recording over again: it is not kept twice
    salvage(recorded("C:/Recordings/Vocal-1.wav"));
    expect(kept).toHaveLength(1);
    // and the interface is open again for the next take
    expect(eng.open).not.toBeNull();
  });

  it("only the recording begun last is kept: an older one handed back stays on disk, untouched", () => {
    const claims = new Claims<string, string>();
    claims.begin("bars 1–4", "tv", true);
    claims.started("new.wav");
    expect(claims.claim(recorded("old.wav"))).toBeNull();
    expect(claims.claim(recorded("new.wav"))).toEqual({ plan: "bars 1–4", track: "tv", session: 1 });
    expect(claims.claim(recorded("new.wav"))).toBeNull();
  });

  it("a rehearsal has nothing to keep; and each start is counted, so work left from an earlier one never touches a later one", () => {
    const claims = new Claims<string, string>();
    claims.begin("bars 1–4", "tv", false);
    claims.started(null);
    expect(claims.claim(recorded("x.wav"))).toBeNull();
    claims.begin("bars 5–8", "tv", true);
    claims.started("a.wav");
    const first = claims.claim(recorded("a.wav"))!;
    claims.begin("bars 5–8", "tv", true);
    expect(first.session).toBe(2);
    expect(claims.session).toBe(3);
    // (begun, but the engine has not named its file yet: nothing is claimed)
    expect(claims.claim(recorded("a.wav"))).toBeNull();
    expect(claims.plan).toBe("bars 5–8");
  });
});
