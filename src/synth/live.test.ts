import { describe, expect, it } from "vitest";
import { LiveKeys, type LiveOut } from "./live";
import { DEFAULT_PARAMS, type PlaySettings } from "./params";

/** A pretend synth on a clock the test moves by hand. */
function rig(mode: PlaySettings["mode"], patch: Partial<PlaySettings> = {}) {
  const log: string[] = [];
  const notes: { midi: number; when: number; length: number }[] = [];
  let t = 10;
  let id = 1;
  const out: LiveOut = {
    now: () => t,
    bpm: () => 120,
    on: (midi) => {
      log.push(`on ${midi}`);
      return id++;
    },
    off: (n) => log.push(`off ${n}`),
    note: (midi, when, _v, length) => notes.push({ midi, when, length }),
  };
  const play: PlaySettings = { ...DEFAULT_PARAMS.play, mode, ...patch };
  const keys = new LiveKeys(out, () => play);
  return { keys, log, notes, at: (s: number) => (t = s), play };
}

describe("playing the synth by hand", () => {
  it("holds a note while its key is down", () => {
    const r = rig("sustain");
    r.keys.press(60);
    r.keys.press(64);
    expect(r.log).toEqual(["on 60", "on 64"]);
    r.keys.release(60);
    expect(r.log).toEqual(["on 60", "on 64", "off 1"]);
    expect(r.keys.keys).toEqual([64]);
    r.keys.releaseAll();
    expect(r.log.at(-1)).toBe("off 2");
    expect(r.keys.keys).toEqual([]);
  });

  it("a key up before the audio clock has moved lets its note go no earlier than it starts", () => {
    const times: { on?: number; off?: number }[] = [];
    const out: LiveOut = {
      now: () => 10,
      bpm: () => 120,
      on: (_m, when) => times.push({ on: when }) - 1,
      off: (id, when) => (times[id].off = when),
      note: () => {},
    };
    const play: PlaySettings = { ...DEFAULT_PARAMS.play, mode: "sustain" };
    const keys = new LiveKeys(out, () => play);
    // a quick slide across two keys, all in one step of the audio clock
    keys.press(60);
    keys.release(60);
    keys.press(62);
    keys.releaseAll();
    expect(times.length).toBe(2);
    for (const t of times) expect(t.off).toBeGreaterThanOrEqual(t.on!);
  });

  it("latches a drone's keys until they are tapped again", () => {
    const r = rig("drone");
    r.keys.press(48);
    r.keys.release(48);
    expect(r.keys.isDown(48)).toBe(true);
    expect(r.log).toEqual(["on 48"]);
    r.keys.press(48);
    expect(r.keys.isDown(48)).toBe(false);
    expect(r.log).toEqual(["on 48", "off 1"]);
  });

  it("walks the keys held down as an arpeggio, in time, while any is down", () => {
    const r = rig("arp", { pattern: "up", rate: "1/8", octaves: 1, gate: 0.5 });
    r.keys.press(64);
    r.keys.press(60);
    r.keys.press(67);
    // nothing is held: an arpeggio's notes each have an end
    expect(r.log).toEqual([]);
    for (let s = 10; s <= 11.01; s += 0.05) {
      r.at(s);
      r.keys.tick();
    }
    const step = 0.25; // an eighth at 120
    const first = r.notes[0].when;
    expect(r.notes.slice(0, 4).map((n) => n.midi)).toEqual([60, 64, 67, 60]);
    r.notes.forEach((n, i) => {
      expect(n.when).toBeCloseTo(first + i * step, 6);
      expect(n.length).toBeCloseTo(step * 0.5, 6);
    });
    // nothing is scheduled far ahead, so letting go stops it promptly
    expect(r.notes.at(-1)!.when).toBeLessThanOrEqual(11.01 + 0.2);
    const count = r.notes.length;
    r.keys.release(60);
    r.keys.release(64);
    r.keys.release(67);
    expect(r.keys.running).toBe(false);
    r.at(12);
    r.keys.tick();
    expect(r.notes.length).toBe(count);
  });

  it("pulses every key held down on each step", () => {
    const r = rig("pulse", { rate: "1/4", gate: 0.4 });
    r.keys.press(60);
    r.keys.press(67);
    r.at(10.04);
    r.keys.tick();
    r.at(10.4);
    r.keys.tick();
    // two steps (half a second each at 120) with both notes in each
    expect(r.notes.map((n) => n.midi)).toEqual([60, 67, 60, 67]);
    expect(r.notes[2].when - r.notes[0].when).toBeCloseTo(0.5, 6);
  });

  it("starts the arpeggio with every key of a chord pressed together", () => {
    const r = rig("arp", { pattern: "down", rate: "1/16" });
    r.keys.press(60);
    r.at(10.01);
    r.keys.tick();
    r.keys.press(64);
    r.at(10.02);
    r.keys.press(67);
    r.at(10.04);
    r.keys.tick();
    expect(r.notes[0].midi).toBe(67);
  });

  it("skips steps a late timer missed instead of playing them in a heap", () => {
    const r = rig("arp", { pattern: "up", rate: "1/16" });
    r.keys.press(60);
    r.at(10.04);
    r.keys.tick();
    const before = r.notes.length;
    r.at(13);
    r.keys.tick();
    expect(r.notes.length).toBeGreaterThan(before);
    expect(r.notes.slice(before).every((n) => n.when >= 13 - 0.01)).toBe(true);
  });
});
