import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio, FakeOffline, asAudio, type FakeAny } from "./fakectx";
import { SOUND_DEFAULT, createRack, type HarpSound } from "./rack";
import { withContext } from "./context";
import { setDrumFx } from "./drumbus";
import { fxOf } from "./beats";

/**
 * Effects turned to 0 rest: what feeds them (their way in, their sweeps) is let go once they have
 * died away, and connected again before they are turned up. The main path never changes.
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** a pretend context whose delays remember how long they can be */
function ctx<T extends FakeAudio>(c: T): T {
  const make = c.createDelay.bind(c);
  c.createDelay = ((max?: number) => Object.assign(make(), { max })) as never;
  return c;
}
const delays = (c: FakeAudio, from: object, max: number) => (c.nodes as (FakeAny & { max?: number })[]).filter((n) => n.max === max && c.reaches(from, n)).length;
/** sweeps (oscillators) that move something: their depth is connected on to a param */
const sweeping = (c: FakeAudio) => (c.nodes as FakeAny[]).filter((n) => n.started !== undefined && n.outputs.some((g) => g.outputs.length > 0)).length;

describe("a track's effects at 0 rest", () => {
  const sound = (o: Partial<HarpSound>): HarpSound => ({ ...SOUND_DEFAULT, ...o });

  it("live: with every effect at 0 nothing feeds the echo, and no sweep moves anything; the sound still reaches the speakers and the room", () => {
    const c = ctx(new FakeAudio(48000));
    const r = createRack(asAudio(c), c.destination as never);
    r.set(SOUND_DEFAULT, 100);
    expect(c.reaches(r.input, c.destination)).toBe(true);
    // the room (its convolver) is still fed
    expect((c.nodes as FakeAny[]).some((n) => n.normalize === false && c.reaches(r.input, n))).toBe(true);
    expect(delays(c, r.input, 2)).toBe(0);
    expect(delays(c, r.input, 0.05)).toBe(1); // the tape stage, on the main path
    expect(sweeping(c)).toBe(0);
  });

  it("live: each effect is fed when turned up, and let go only once it has died away", () => {
    const c = ctx(new FakeAudio(48000));
    const r = createRack(asAudio(c), c.destination as never);
    r.set(SOUND_DEFAULT, 100);
    r.set(sound({ echo: 0.5, chorus: 0.5, phaser: 0.5, wobble: 0.5, trem: 0.5 }), 100);
    expect(delays(c, r.input, 2)).toBe(2);
    expect(delays(c, r.input, 0.05)).toBe(3); // the tape and the chorus's two
    expect(sweeping(c)).toBe(6);
    r.set(SOUND_DEFAULT, 100);
    // the levels glide down first: nothing is let go yet
    vi.advanceTimersByTime(250);
    expect(sweeping(c)).toBe(6);
    vi.advanceTimersByTime(300);
    expect(sweeping(c)).toBe(0);
    expect(delays(c, r.input, 0.05)).toBe(1);
    // the echo waits for its last repeat
    expect(delays(c, r.input, 2)).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(delays(c, r.input, 2)).toBe(0);
    expect(c.reaches(r.input, c.destination)).toBe(true);
  });

  it("live: an effect turned to 0 in a section that starts later is let go after that, not before", () => {
    const c = ctx(new FakeAudio(48000));
    const r = createRack(asAudio(c), c.destination as never);
    r.set(sound({ echo: 0.5 }), 100);
    r.set(SOUND_DEFAULT, 100, 4);
    vi.advanceTimersByTime(5000);
    expect(delays(c, r.input, 2)).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(delays(c, r.input, 2)).toBe(0);
  });

  it("offline: unfed until first needed, then never let go (every render of a song is the same)", () => {
    const c = ctx(new FakeOffline(48000));
    const r = createRack(asAudio(c), c.destination as never);
    r.set(SOUND_DEFAULT, 100);
    expect(delays(c, r.input, 2)).toBe(0);
    r.set(sound({ echo: 0.5 }), 100, 8);
    r.set(SOUND_DEFAULT, 100, 16);
    vi.advanceTimersByTime(60000);
    expect(delays(c, r.input, 2)).toBe(2);
  });
});

describe("a drum desk's echo and tape at 0 rest", () => {
  it("live: fed when turned up, let go once died away", () => {
    const c = ctx(new FakeAudio(48000));
    withContext(asAudio(c), () => setDrumFx({ ...fxOf({}), echo: 0, tape: 0 }, 100, "dz"));
    const ins = (c.nodes as FakeAny[]).filter((n) => n.outputs.length);
    const reachEcho = () => (c.nodes as (FakeAny & { max?: number })[]).filter((n) => n.max === 2 && ins.some((i) => i !== n && c.reaches(i, n) && !c.reaches(n, i))).length;
    expect(reachEcho()).toBe(0);
    expect(sweeping(c)).toBe(0);
    withContext(asAudio(c), () => setDrumFx({ ...fxOf({}), echo: 0.4, tape: 0.5 }, 100, "dz"));
    expect(reachEcho()).toBe(1);
    expect(sweeping(c)).toBe(2);
    withContext(asAudio(c), () => setDrumFx({ ...fxOf({}), echo: 0, tape: 0 }, 100, "dz"));
    vi.advanceTimersByTime(600);
    expect(sweeping(c)).toBe(0);
    expect(reachEcho()).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(reachEcho()).toBe(0);
  });
});
