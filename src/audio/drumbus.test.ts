import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withContext } from "./context";
import { FakeAudio, asAudio, type FakeAny } from "./fakectx";
import { FakeParam } from "../keys/fakeaudio";
import { fader } from "./mix";
import { playStep, setDrumFx, setDrumSolo, syncDrums } from "./drumbus";
import { DEFAULT_BEAT, fxOf, type Beat } from "./beats";

const kit = (k: Beat["kit"]): Beat => ({ ...DEFAULT_BEAT, on: true, kit: k });

// the desks' timers (rendering the other takes of a hit) run on fake time, so none can fire after a test
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Every param on a node, with how many changes are booked on it. */
const booked = (c: FakeAudio) => c.nodes.flatMap((n) => Object.values(n).filter((v): v is FakeParam => v instanceof FakeParam).map((p) => ({ n, p, k: p.events.length })));

describe("every drums track has a desk of its own", () => {
  it("a hit reaches only its own track's fader", () => {
    const c = new FakeAudio();
    withContext(asAudio(c), () => {
      playStep(kit("909"), "kick", 3, 0.1, "drums");
      playStep(kit("mod"), "kick", 3, 0.1, "d2");
    });
    const [a, b] = c.started;
    const one = fader("drums", asAudio(c));
    const two = fader("d2", asAudio(c));
    expect(c.reaches(a, one)).toBe(true);
    expect(c.reaches(a, two)).toBe(false);
    expect(c.reaches(b, two)).toBe(true);
    expect(c.reaches(b, one)).toBe(false);
  });
  it("each track keeps its own effects: drenching Drums 2 leaves Drums 1 as it was", () => {
    const c = new FakeAudio();
    withContext(asAudio(c), () => {
      syncDrums(kit("909"), 100, "drums");
      syncDrums(kit("mod"), 100, "d2");
    });
    const before = booked(c);
    withContext(asAudio(c), () => setDrumFx({ ...fxOf({}), space: 1, echo: 0.8, grit: 0.9, tone: -0.6, glue: 1 }, 100, "d2"));
    const changed = before.filter((x) => x.p.events.length !== x.k).map((x) => x.n);
    expect(changed.length).toBeGreaterThan(3);
    const one = fader("drums", asAudio(c));
    const two = fader("d2", asAudio(c));
    expect(changed.every((n) => c.reaches(n, two) && !c.reaches(n, one))).toBe(true);
  });
  it("a drum soloed on one track does not touch the other", () => {
    const c = new FakeAudio();
    setDrumSolo("snare", "d2");
    withContext(asAudio(c), () => {
      playStep(kit("909"), "kick", 3, 0.1, "drums");
      playStep(kit("mod"), "kick", 3, 0.1, "d2");
    });
    setDrumSolo(null, "d2");
    expect(c.started.length).toBe(1);
    expect(c.reaches(c.started[0], fader("drums", asAudio(c)))).toBe(true);
  });
  it("a track's level, mute and solo live in its own fader, so they apply at once", () => {
    const c = new FakeAudio();
    withContext(asAudio(c), () => playStep(kit("mod"), "kick", 3, 0.1, "d2"));
    const g = c.started[0].outputs[0] as unknown as FakeAny;
    // the hit itself is played at full strength: the fader alone sets the track's level
    expect(g.gain.value).toBeCloseTo(1.1, 5);
  });
});
