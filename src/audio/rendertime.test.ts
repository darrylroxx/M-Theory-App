import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atRenderTime, withContext } from "./context";
import { FakeAudio, FakeOffline, asAudio, type FakeAny } from "./fakectx";
import { SOUND_DEFAULT, createRack } from "./rack";
import { setDrumFx } from "./drumbus";
import { fxOf } from "./beats";
import { TrackVoice, FADE } from "./trackvoice";
import { GUITAR } from "./tone";
import { FakeParam } from "../keys/fakeaudio";

const convolvers = (c: FakeAudio) => c.nodes.filter((n) => "normalize" in n && (n as FakeAny).normalize === false) as FakeAny[];

describe("a moment of an offline render", () => {
  it("pauses once for each moment, runs everything asked for there, and carries on", async () => {
    const c = new FakeOffline();
    const ran: string[] = [];
    expect(atRenderTime(asAudio(c), 2, () => ran.push("a"))).toBe(true);
    expect(atRenderTime(asAudio(c), 2.0001, () => ran.push("b"))).toBe(true);
    expect(atRenderTime(asAudio(c), 5, () => ran.push("c"))).toBe(true);
    // the two near 2 s land on the same block of 128 frames: one pause
    expect(c.pauses.length).toBe(2);
    await c.reach(3);
    expect(ran).toEqual(["a", "b"]);
    expect(c.resumed).toBe(1);
    await c.reach(6);
    expect(ran).toEqual(["a", "b", "c"]);
  });
  it("is not for a live context, nor past the end of the render", () => {
    expect(atRenderTime(asAudio(new FakeAudio()), 1, () => {})).toBe(false);
    expect(atRenderTime(asAudio(new FakeOffline(48000, 48000)), 2, () => {})).toBe(false);
  });
});

describe("a section's own room in a WAV", () => {
  it("a track's send crosses over to the section's room exactly at its moment; the room it leaves is never cut", () => {
    const c = new FakeOffline();
    const rack = createRack(asAudio(c));
    rack.set(SOUND_DEFAULT, 90);
    const [hall] = convolvers(c);
    const first = hall.buffer;
    expect(first).toBeTruthy();
    const a = rack.room()!;
    rack.set({ ...SOUND_DEFAULT, verb: "plate", size: 0.9 }, 90, 4);
    const b = rack.room()!;
    expect(b.key).not.toBe(a.key);
    // the new room is built at once (a render has no time to wait), the old one keeps its impulse and rings out
    const [, plate] = convolvers(c);
    expect(plate.buffer).toBeTruthy();
    expect(hall.buffer).toBe(first);
    const sendInto = (input: unknown) => c.nodes.find((n) => n.outputs.includes(input as FakeAny)) as FakeAny;
    expect(sendInto(a.input).gain.at(3.99)).toBeCloseTo(1, 6);
    expect(sendInto(a.input).gain.at(4.1)).toBeLessThan(1e-4);
    expect(sendInto(b.input).gain.at(3.99)).toBe(0);
    expect(sendInto(b.input).gain.at(4.1)).toBeGreaterThan(0.9999);
    // (nothing waits for the render to pause)
    expect(c.pauses.length).toBe(0);
  });
  it("a drums track's room changes when the render reaches the section, into the desk's other room, crossing over", async () => {
    // the desk's timers run on fake time, so none can fire after the test has put `window` away
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const c = new FakeOffline();
    withContext(asAudio(c), () => setDrumFx(fxOf({}), 100, "dz"));
    const [one, two] = convolvers(c);
    const first = one.buffer;
    expect(two.buffer).toBeNull();
    withContext(asAudio(c), () => setDrumFx({ ...fxOf({}), verb: "hall", size: 0.95 }, 100, "dz", 6));
    vi.advanceTimersByTime(5000);
    expect(two.buffer).toBeNull();
    await c.reach(6.5);
    // the ringing room keeps its impulse (setting it would cut it to silence): the other one gets the new one
    expect(one.buffer).toBe(first);
    expect(two.buffer).toBeTruthy();
    const outOf = (v: FakeAny) => v.outputs[0] as FakeAny;
    expect(outOf(one).gain.at(6.07)).toBe(0);
    expect(outOf(two).gain.at(6.07)).toBe(1);
    expect(outOf(one).gain.at(6.03)).toBeGreaterThan(0.3);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});

describe("a section's sound booked for later", () => {
  it("does not land after playing stopped just before it and started again", () => {
    const c = new FakeAudio();
    const rack = createRack(asAudio(c));
    rack.set(SOUND_DEFAULT, 90);
    // the next section, with an echo of its own, is booked 0.2 s ahead; playing stops, and starts again at once
    rack.set({ ...SOUND_DEFAULT, echo: 0.9, chorus: 0.7 }, 90, 0.2);
    c.currentTime = 0.05;
    rack.set(SOUND_DEFAULT, 90, 0.05);
    const params = c.nodes.flatMap((n) => Object.values(n).filter((v): v is FakeParam => v instanceof FakeParam));
    expect(params.filter((p) => p.events.some((e) => e.t > 0.06))).toEqual([]);
  });
});

describe("live changes that must not click", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("a track switched from Synth to Guitar fades the synth out and frees it afterwards", () => {
    const c = new FakeAudio();
    const dest = c.createGain() as unknown as AudioNode;
    const v = new TrackVoice(asAudio(c), dest, "chord");
    v.setTone({ inst: "synth" });
    const synth = v.instrument!;
    const into = (synth.output as unknown as FakeAny).outputs[0] as FakeAny;
    v.setTone(GUITAR);
    expect(v.instrument).toBeNull();
    // it fades over a few hundredths of a second, never at once
    expect(into.gain.at(c.currentTime + FADE)).toBeLessThan(0.05);
    expect(into.gain.at(c.currentTime + 0.005)).toBeGreaterThan(0.3);
    expect(into.outputs.length).toBe(1);
    vi.advanceTimersByTime(FADE * 2000 + 10);
    expect(into.outputs.length).toBe(0);
  });
  it("a removed track fades out and then lets everything go", () => {
    const c = new FakeAudio();
    const dest = c.createGain() as unknown as AudioNode;
    const v = new TrackVoice(asAudio(c), dest, "melody");
    const out = v.out as unknown as FakeAny;
    v.dispose();
    expect(out.gain.at(FADE)).toBeLessThan(0.05);
    expect(out.gain.at(0.005)).toBeGreaterThan(0.3);
    expect(out.outputs.length).toBe(1);
    vi.advanceTimersByTime(FADE * 2000 + 10);
    expect(out.outputs.length).toBe(0);
    // the rack's oscillators are stopped
    expect(c.nodes.filter((n) => (n as FakeAny).started !== undefined).every((n) => (n as FakeAny).stopped)).toBe(true);
  });
});
