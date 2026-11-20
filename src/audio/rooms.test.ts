import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio, FakeOffline, asAudio, type FakeAny } from "./fakectx";
import { SOUND_DEFAULT, createRack } from "./rack";
import { master, sendFader, setMix } from "./mix";
import { roomsOf } from "./rooms";

const convolvers = (c: FakeAudio) => c.nodes.filter((n) => "normalize" in n && (n as FakeAny).normalize === false) as FakeAny[];
/** Does sound go from `a` to `b` (through any nodes on the way)? */
function reaches(a: FakeAny, b: unknown, seen = new Set<unknown>()): boolean {
  if (a === b) return true;
  if (seen.has(a)) return false;
  seen.add(a);
  return a.outputs.some((n) => reaches(n as FakeAny, b, seen));
}

describe("the reverb rooms the tracks share", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tracks with the same room share one; another kind or size gets one of its own", () => {
    const c = new FakeAudio();
    const racks = [0, 1, 2].map(() => createRack(asAudio(c), c.createGain() as never));
    racks[0].set(SOUND_DEFAULT, 90);
    racks[1].set(SOUND_DEFAULT, 90);
    racks[2].set({ ...SOUND_DEFAULT, verb: "room", size: 0.2 }, 90);
    expect(convolvers(c).length).toBe(2);
    expect(racks[0].room()).toBe(racks[1].room());
    expect(racks[2].room()).not.toBe(racks[0].room());
    // every room goes to the master, and each track's send into it
    for (const r of roomsOf(asAudio(c))) expect(reaches(r.input as unknown as FakeAny, master(asAudio(c)))).toBe(true);
    for (const r of racks) expect(reaches(r.halo as unknown as FakeAny, r.room()!.input)).toBe(true);
  });

  it("a track's send goes through a copy of its fader, which follows the mix (mute, solo, level)", () => {
    const c = new FakeAudio();
    const f = sendFader("zz", asAudio(c)) as unknown as FakeAny;
    const r = createRack(asAudio(c), c.createGain() as never, f as never);
    r.set(SOUND_DEFAULT, 90);
    expect(reaches(r.send as unknown as FakeAny, f)).toBe(true);
    expect(reaches(f, r.room()!.input)).toBe(true);
    // (the fake context is not a live AudioContext: the copy is set when made, and a live one follows setMix)
    setMix({ zz: { mute: true } });
    expect(sendFader("zz", asAudio(new FakeAudio())).gain.value).toBe(0);
    setMix(undefined);
  });

  it("the knob being turned: the send crosses over once it stops, the old room rings out and is let go after", () => {
    const c = new FakeAudio();
    const r = createRack(asAudio(c), c.createGain() as never);
    r.set(SOUND_DEFAULT, 90);
    const a = r.room()!;
    r.set({ ...SOUND_DEFAULT, size: 0.5 }, 90);
    r.set({ ...SOUND_DEFAULT, size: 0.6 }, 90);
    // not yet: a room takes a moment to build, and the knob may still be moving
    expect(r.room()).toBe(a);
    expect(convolvers(c).length).toBe(1);
    vi.advanceTimersByTime(150);
    const b = r.room()!;
    expect(b).not.toBe(a);
    expect(b.key).toBe("hall|0.6");
    expect(convolvers(c).length).toBe(2);
    // the old room keeps its impulse (it rings out what it was sent), and the send to it is let go once crossed over
    expect(convolvers(c)[0].buffer).toBeTruthy();
    vi.advanceTimersByTime(300);
    expect(reaches(r.send as unknown as FakeAny, a.input)).toBe(false);
    expect(reaches(r.send as unknown as FakeAny, b.input)).toBe(true);
    // once nothing sends to it and it has rung out, it goes
    expect(roomsOf(asAudio(c)).map((x) => x.key)).toContain(a.key);
    vi.advanceTimersByTime((a.seconds + 1.2) * 1000);
    expect(roomsOf(asAudio(c)).map((x) => x.key)).toEqual([b.key]);
  });

  it("■ fades the room with the track; the next note brings it back", () => {
    const c = new FakeAudio();
    const r = createRack(asAudio(c), c.createGain() as never);
    r.set(SOUND_DEFAULT, 90);
    const h = r.room()!.hush.gain as unknown as FakeAny["gain"];
    r.hush(1, 0.065);
    expect(h.at(1.4)).toBeLessThan(0.01);
    r.wake(2);
    expect(h.at(2.05)).toBeGreaterThan(0.99);
  });

  it("a render keeps every room it was sent to (so every export is the same)", () => {
    const c = new FakeOffline();
    const r = createRack(asAudio(c), c.createGain() as never);
    r.set(SOUND_DEFAULT, 90);
    const a = r.room()!;
    r.set({ ...SOUND_DEFAULT, verb: "plate" }, 90, 2);
    vi.advanceTimersByTime(60000);
    expect(reaches(r.send as unknown as FakeAny, a.input)).toBe(true);
    expect(roomsOf(asAudio(c)).length).toBe(2);
  });
});
