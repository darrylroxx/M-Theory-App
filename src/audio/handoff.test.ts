import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HANDOFF_WAIT, QUIET_AFTER, Quiet, engineWanted, freeInterface, holdInterface, mayList } from "./handoff";

describe("when the recording engine has the interface", () => {
  const base = { recording: false, busy: false, monitor: false, active: false, quiet: true };
  it("only while it is needed and the app is not sounding", () => {
    // the Vocals page on screen, the app quiet: open
    expect(engineWanted({ ...base, active: true })).toBe(true);
    // the song (or a take heard alone) playing on the Vocals page: closed
    expect(engineWanted({ ...base, active: true, quiet: false })).toBe(false);
    // another page: closed
    expect(engineWanted(base)).toBe(false);
    // recording, rehearsing (or getting either ready) and hearing yourself through the effects: always open
    expect(engineWanted({ ...base, recording: true, quiet: false })).toBe(true);
    expect(engineWanted({ ...base, busy: true, quiet: false })).toBe(true);
    expect(engineWanted({ ...base, monitor: true, quiet: false })).toBe(true);
  });
});

describe("when the interfaces are listed (the Vocals page opened while the song plays)", () => {
  const base = { recording: false, busy: false, monitor: false, active: true, quiet: false };
  it("waits for the app to be quiet, unless the engine is to be open while it sounds anyway", () => {
    // hardware monitoring: the engine would not open while the song plays, so nothing is listed until it stops
    expect(mayList(base)).toBe(false);
    expect(mayList({ ...base, quiet: true })).toBe(true);
    // through the effects: listed at once, so you hear yourself at once, not only once the song has stopped
    expect(mayList({ ...base, monitor: true })).toBe(true);
    expect(engineWanted({ ...base, monitor: true })).toBe(true);
    // recording or rehearsing (the song is the engine's then)
    expect(mayList({ ...base, recording: true })).toBe(true);
    expect(mayList({ ...base, busy: true })).toBe(true);
    // never from another page
    expect(mayList({ ...base, active: false, monitor: true, quiet: true })).toBe(false);
  });
});

describe("handing the interface over to the app's sound", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("the sound waits for the engine to close; with nothing open it goes at once", async () => {
    let closed = false;
    const done: (() => void)[] = [];
    holdInterface(() => new Promise<void>((r) => done.push(() => ((closed = true), r()))));
    let went = false;
    void freeInterface().then(() => (went = true));
    await Promise.resolve();
    expect(went).toBe(false);
    done[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toBe(true);
    expect(went).toBe(true);
    // nothing held now: no wait
    let next = false;
    void freeInterface().then(() => (next = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(next).toBe(true);
  });

  it("a driver that never answers does not keep the song from playing", async () => {
    holdInterface(() => new Promise<void>(() => {}));
    let went = false;
    void freeInterface().then(() => (went = true));
    await vi.advanceTimersByTimeAsync(1600);
    expect(went).toBe(true);
  });

  it("an offer taken back is not used", async () => {
    let asked = 0;
    const back = holdInterface(async () => void asked++);
    back();
    await freeInterface();
    expect(asked).toBe(0);
  });

  it("quiet a second after the sound stops, not at once; a sound in between keeps it from opening", () => {
    const seen: boolean[] = [];
    const q = new Quiet((x) => seen.push(x));
    q.sound(true);
    expect(q.quiet).toBe(false);
    q.sound(false);
    vi.advanceTimersByTime(QUIET_AFTER * 1000 - 50);
    expect(q.quiet).toBe(false);
    // a quick audition before then: still not quiet, and the second starts again from its end
    q.sound(true);
    q.sound(false);
    vi.advanceTimersByTime(QUIET_AFTER * 1000 - 50);
    expect(q.quiet).toBe(false);
    vi.advanceTimersByTime(100);
    expect(q.quiet).toBe(true);
    // one change each way: the engine opens once after the last stop
    expect(seen).toEqual([false, true]);
  });

  it("a hand-off whose sound never comes (▶ called off) lets it open again after a while", () => {
    const q = new Quiet(() => {});
    q.handOff();
    expect(q.quiet).toBe(false);
    vi.advanceTimersByTime(HANDOFF_WAIT * 1000 - 50);
    expect(q.quiet).toBe(false);
    // the sound comes: from then on it is the sound that counts
    q.sound(true);
    vi.advanceTimersByTime(10000);
    expect(q.quiet).toBe(false);
    q.sound(false);
    vi.advanceTimersByTime(QUIET_AFTER * 1000 + 10);
    expect(q.quiet).toBe(true);
    q.handOff();
    vi.advanceTimersByTime(HANDOFF_WAIT * 1000 + 10);
    expect(q.quiet).toBe(true);
  });
});
