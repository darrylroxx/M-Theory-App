import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withContext } from "./context";
import { FakeAudio, FakeOffline, asAudio, type FakeAny } from "./fakectx";
import { FakeParam } from "../keys/fakeaudio";
import { fader } from "./mix";
import { deskResting, deskTail, playStep, setBedPlaying, setDrumFx, setDrumSolo, syncDrums } from "./drumbus";
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

describe("a section's drum sound booked for later", () => {
  it("does not land after playing stopped just before it and started again", () => {
    const c = new FakeAudio();
    const dry = kit("909");
    const wet = { ...kit("909"), space: 1, echo: 0.8 };
    withContext(asAudio(c), () => {
      syncDrums(dry, 100, "drums");
      // the next section, with its own sound, is booked 0.2 s ahead; playing stops, and starts again at once
      syncDrums(wet, 100, "drums", 0.2);
      c.currentTime = 0.05;
      syncDrums(dry, 100, "drums", 0.05);
    });
    const now = booked(c).filter((x) => x.p.events.some((e) => e.t > 0.06));
    expect(now).toEqual([]);
  });
});

describe("a section's own kit, from where the section starts", () => {
  it("in a render: B's grit comes in where B starts, not when it is booked", async () => {
    const c = new FakeOffline();
    const curves = () => JSON.stringify(c.nodes.filter((n) => (n as FakeAny).curve).map((n) => Array.from((n as FakeAny).curve as Float32Array).slice(0, 8)));
    withContext(asAudio(c), () => setDrumFx(fxOf({ grit: 0 }), 100, "dg"));
    const before = curves();
    withContext(asAudio(c), () => setDrumFx(fxOf({ grit: 0.9 }), 100, "dg", 6));
    expect(curves()).toBe(before);
    await c.reach(6.5);
    expect(curves()).not.toBe(before);
  });
});

describe("a new desk", () => {
  it("starts on its drums' settings, so the first hit of a render does not glide in from the defaults", () => {
    const c = new FakeAudio();
    withContext(asAudio(c), () => syncDrums({ ...kit("909"), noise: "vinyl", noiseAmt: 0.6 }, 100, "drums"));
    const gliding = booked(c).filter((x) => Math.abs(x.p.at(0) - x.p.at(5)) > 1e-6);
    expect(gliding).toEqual([]);
  });
});

describe("every drums track has a noise bed of its own", () => {
  it("one track's bed stops when its drums stop, and the other's runs on", () => {
    const c = new FakeAudio();
    const noisy = { ...kit("909"), noise: "vinyl" as const, noiseAmt: 0.6 };
    withContext(asAudio(c), () => {
      setBedPlaying(true, noisy, "drums");
      setBedPlaying(true, noisy, "d2");
    });
    const beds = c.nodes.filter((n) => (n as unknown as { loop?: boolean }).loop === true) as unknown as { stops: number[] }[];
    expect(beds.length).toBe(2);
    withContext(asAudio(c), () => setBedPlaying(false, null, "d2"));
    expect(beds.map((b) => b.stops.length > 0)).toEqual([false, true]);
    withContext(asAudio(c), () => setBedPlaying(false, null));
    expect(beds.every((b) => b.stops.length > 0)).toBe(true);
  });
});

/** The moment the audio clock and the page's timers have both reached. */
function passTo(c: FakeAudio, t: number) {
  const by = Math.max(0, t - c.currentTime);
  c.currentTime = t;
  vi.advanceTimersByTime(by * 1000 + 50);
}
/** The rooms of every desk on a context (only a room is made with `normalize` off). */
const roomsOf = (c: FakeAudio) => c.nodes.filter((n) => (n as FakeAny).normalize === false && "buffer" in n) as FakeAny[];

describe("a desk that makes no sound rests", () => {
  const dry = { ...kit("909"), space: 0, echo: 0 };
  it("a while after its last hit has rung out it is let go of its fader; the next hit puts it back before it sounds", () => {
    const c = new FakeAudio();
    const out = () => fader("dr", asAudio(c));
    withContext(asAudio(c), () => {
      syncDrums(dry, 100, "dr");
      playStep(dry, "kick", 3, 0.1, "dr");
    });
    const first = c.started[0];
    const rings = (first.buffer as unknown as { duration: number }).duration;
    expect(c.reaches(first, out())).toBe(true);
    // while the hit rings, and for the moment after, it is still there
    passTo(c, 0.1 + rings + 0.3);
    expect(withContext(asAudio(c), () => deskResting("dr"))).toBe(false);
    expect(c.reaches(first, out())).toBe(true);
    // rung out: nothing of the desk reaches the speakers, so none of it is worked out
    passTo(c, 0.1 + rings + 5);
    expect(withContext(asAudio(c), () => deskResting("dr"))).toBe(true);
    expect(c.reaches(first, out())).toBe(false);
    // the next hit, booked a quarter of a second ahead as the player books it: on its fader at once, well before it sounds
    withContext(asAudio(c), () => playStep(dry, "snare", 3, c.currentTime + 0.25, "dr"));
    const next = c.started[c.started.length - 1];
    expect(next.started!.when).toBeCloseTo(c.currentTime + 0.25, 6);
    expect(c.reaches(next, out())).toBe(true);
    expect(withContext(asAudio(c), () => deskResting("dr"))).toBe(false);
  });

  it("hits that keep coming keep it awake, however long", () => {
    const c = new FakeAudio();
    withContext(asAudio(c), () => syncDrums(dry, 100, "dk"));
    for (let i = 0; i < 40; i++) {
      withContext(asAudio(c), () => playStep(dry, "hat", 2, c.currentTime + 0.25, "dk"));
      passTo(c, c.currentTime + 0.5);
      expect(withContext(asAudio(c), () => deskResting("dk"))).toBe(false);
    }
  });

  it("with Echo on it waits until the repeats are far under hearing, then rests all the same", () => {
    const c = new FakeAudio();
    const echoing = { ...dry, echo: 0.5 };
    withContext(asAudio(c), () => {
      syncDrums(echoing, 100, "de");
      playStep(echoing, "kick", 3, 0.1, "de");
    });
    const rings = (c.started[0].buffer as unknown as { duration: number }).duration;
    const tail = deskTail({ echo: 0.5, echoTime: "1/8.", bpm: 100 }, roomsOf(c)[0].buffer ? (roomsOf(c)[0].buffer as { duration: number }).duration : 0);
    // (each repeat about 7 dB under the one before, 0.45 s apart: some seconds)
    expect(tail).toBeGreaterThan(5);
    passTo(c, 0.1 + rings + tail - 0.5);
    expect(withContext(asAudio(c), () => deskResting("de"))).toBe(false);
    passTo(c, 0.1 + rings + tail + 0.5);
    expect(withContext(asAudio(c), () => deskResting("de"))).toBe(true);
  });

  it("an echo turned up while a hit rings is waited for too", () => {
    const c = new FakeAudio();
    withContext(asAudio(c), () => {
      syncDrums(dry, 100, "du");
      playStep(dry, "kick", 3, 0.1, "du");
      c.currentTime = 0.2;
      setDrumFx({ ...fxOf(dry), echo: 0.9 }, 100, "du");
    });
    passTo(c, 6);
    expect(withContext(asAudio(c), () => deskResting("du"))).toBe(false);
    passTo(c, 60);
    expect(withContext(asAudio(c), () => deskResting("du"))).toBe(true);
  });

  it("its noise bed keeps it awake while it runs, and lets it rest once it has stopped", () => {
    const c = new FakeAudio();
    const noisy = { ...dry, noise: "vinyl" as const, noiseAmt: 0.6 };
    withContext(asAudio(c), () => {
      syncDrums(noisy, 100, "dn");
      setBedPlaying(true, noisy, "dn");
    });
    passTo(c, 120);
    expect(withContext(asAudio(c), () => deskResting("dn"))).toBe(false);
    withContext(asAudio(c), () => setBedPlaying(false, null, "dn"));
    passTo(c, 130);
    expect(withContext(asAudio(c), () => deskResting("dn"))).toBe(true);
    // and the bed coming back wakes it
    withContext(asAudio(c), () => setBedPlaying(true, noisy, "dn"));
    expect(withContext(asAudio(c), () => deskResting("dn"))).toBe(false);
  });

  it("a desk made and never played rests too", () => {
    const c = new FakeAudio();
    withContext(asAudio(c), () => syncDrums(dry, 100, "dx"));
    passTo(c, 30);
    expect(withContext(asAudio(c), () => deskResting("dx"))).toBe(true);
  });

  it("an offline render's desk never rests: every render of a song is the same", () => {
    const c = new FakeOffline();
    withContext(asAudio(c), () => {
      syncDrums(dry, 100, "dr");
      playStep(dry, "kick", 3, 0.1, "dr");
    });
    const first = c.started[0];
    c.currentTime = 25;
    vi.advanceTimersByTime(60000);
    expect(withContext(asAudio(c), () => deskResting("dr"))).toBe(false);
    expect(c.reaches(first, fader("dr", asAudio(c)))).toBe(true);
  });

  it("how long a desk rings on: its room, and with Echo the repeats until they are 100 dB down", () => {
    expect(deskTail({ echo: 0 }, 1.2)).toBeCloseTo(1.7, 6);
    // Echo at 0.1 feeds back 0.29 of each repeat (10.75 dB less each time): ten repeats, a dotted eighth apart at 120
    expect(deskTail({ echo: 0.1, echoTime: "1/8.", bpm: 120 }, 1.2)).toBeCloseTo(10 * 0.375 + 1.7, 6);
    // more Echo rings longer, and a repeat is never further apart than the delay can hold
    expect(deskTail({ echo: 1, echoTime: "1/4", bpm: 20 }, 0)).toBeCloseTo(27 * 1.9 + 0.5, 6);
    // an echo just turned to 0 still holds one pass of what was in it
    expect(deskTail({ echo: 0, echoTime: "1/4", bpm: 120 }, 0, true)).toBeCloseTo(0.5 + 0.5, 6);
  });
});

describe("a desk's room is only fed while its Reverb is up", () => {
  const wet = { ...kit("909"), space: 0.5 };
  const dry = { ...kit("909"), space: 0 };
  it("at 0 no drum reaches the room (the costliest thing a desk has); the drums themselves go out as before", () => {
    const c = new FakeAudio();
    withContext(asAudio(c), () => {
      syncDrums(dry, 100, "ra");
      playStep(dry, "snare", 3, 0.1, "ra");
    });
    const hit = c.started[0];
    expect(roomsOf(c).length).toBe(2);
    expect(roomsOf(c).some((r) => c.reaches(hit, r))).toBe(false);
    expect(c.reaches(hit, fader("ra", asAudio(c)))).toBe(true);
  });
  it("turned up, it is fed at once (before its level glides up); turned back to 0, it is let go once the level has glided down", () => {
    const c = new FakeAudio();
    withContext(asAudio(c), () => {
      syncDrums(dry, 100, "rb");
      playStep(dry, "snare", 3, 0.1, "rb");
    });
    const hit = c.started[0];
    withContext(asAudio(c), () => setDrumFx(fxOf(wet), 100, "rb"));
    expect(roomsOf(c).some((r) => c.reaches(hit, r))).toBe(true);
    withContext(asAudio(c), () => setDrumFx(fxOf(dry), 100, "rb"));
    // still fed while the level glides down
    vi.advanceTimersByTime(200);
    expect(roomsOf(c).some((r) => c.reaches(hit, r))).toBe(true);
    vi.advanceTimersByTime(200);
    expect(roomsOf(c).some((r) => c.reaches(hit, r))).toBe(false);
    // turned up again before it was let go: it simply stays
    withContext(asAudio(c), () => {
      setDrumFx(fxOf(wet), 100, "rb");
      setDrumFx(fxOf(dry), 100, "rb");
    });
    vi.advanceTimersByTime(100);
    withContext(asAudio(c), () => setDrumFx(fxOf(wet), 100, "rb"));
    vi.advanceTimersByTime(1000);
    expect(roomsOf(c).some((r) => c.reaches(hit, r))).toBe(true);
  });
  it("the echo's own way into the room goes with it", () => {
    const c = new FakeAudio();
    const echoing = { ...dry, echo: 0.5 };
    withContext(asAudio(c), () => {
      syncDrums(echoing, 100, "rc");
      playStep(echoing, "snare", 3, 0.1, "rc");
    });
    const hit = c.started[0];
    expect(roomsOf(c).some((r) => c.reaches(hit, r))).toBe(false);
    withContext(asAudio(c), () => setDrumFx({ ...fxOf(echoing), space: 0.3 }, 100, "rc"));
    expect(roomsOf(c).some((r) => c.reaches(hit, r))).toBe(true);
  });
  it("a render that never uses the room never feeds it; one that uses it anywhere has it fed from its first sample", () => {
    const off = new FakeOffline();
    withContext(asAudio(off), () => {
      syncDrums(dry, 100, "rd");
      playStep(dry, "snare", 3, 0.1, "rd");
    });
    expect(roomsOf(off).some((r) => off.reaches(off.started[0], r))).toBe(false);
    const two = new FakeOffline();
    withContext(asAudio(two), () => {
      syncDrums(dry, 100, "re");
      // a later section with its own kit: booked before the render starts, as every change of a render is
      syncDrums(wet, 100, "re", 8);
      playStep(dry, "snare", 3, 0.1, "re");
      // … and back to none: a render keeps what it has connected
      syncDrums(dry, 100, "re", 16);
    });
    vi.advanceTimersByTime(5000);
    expect(roomsOf(two).some((r) => two.reaches(two.started[0], r))).toBe(true);
  });
});
