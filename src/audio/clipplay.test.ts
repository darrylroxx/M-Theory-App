/**
 * Edited clips as the player plays them: each from exactly its stretch of its take, exactly
 * where it lies, with a short fade at each edge so a cut never clicks; a clip edited while it
 * plays is started again as it now is, one left alone carries on.
 */
import { describe, expect, it } from "vitest";
import { FakeAudio } from "./fakectx";
import { FakeParam } from "../keys/fakeaudio";
import { EDGE_FADE, TakeRuns, type PlayTake } from "./takeplay";
import { layClips, splitClip, trimClip, type Clip } from "../song/clips";
import type { Take } from "../song/takes";

const R = 48000;
const take: Take = { id: "t1", n: 1, group: "g", dry: "d.wav", wet: "w.wav", rate: R, start: 0, frames: R * 4, at: { block: "a", bar: 0 }, keep: true };

/** A context that notes every source's start (when, where in its buffer, how long) and the gain after it. */
function ctx() {
  const c = new FakeAudio();
  const out: { when: number; offset: number; dur: number; gain: FakeParam; stops: number[] }[] = [];
  const make = c.createBufferSource.bind(c);
  c.createBufferSource = () => {
    const s = make() as unknown as { start: (w?: number, o?: number, d?: number) => void; connect: (n: unknown) => unknown; stops: number[] };
    const connect = s.connect.bind(s);
    let gain: FakeParam | null = null;
    s.connect = (n) => {
      gain ??= (n as { gain: FakeParam }).gain;
      return connect(n);
    };
    s.start = (when = 0, offset = 0, dur = Infinity) => out.push({ when, offset, dur, gain: gain!, stops: s.stops });
    return s as never;
  };
  return { c, out };
}
const buffer = { duration: 4, length: R * 4, sampleRate: R } as unknown as AudioBuffer;
/** the clips laid in one section of 8 beats at 120 (a beat is half a second), as the page lists them */
const list = (clips: Clip[]): PlayTake[] =>
  layClips([{ block: "a", bar: 4, beats: 8 }], clips.map((clip) => ({ clip, take })), 120).a.map((x) => ({ track: "v1", buffer, at: x.at, offset: x.offset, dur: x.dur, id: x.clip.id }));

describe("edited clips as they play", () => {
  it("each from exactly its stretch, exactly where it lies (to the sample)", () => {
    const { c, out } = ctx();
    // the cough trimmed off (0.45 s), split at 1.25 s and 2.25 s, the middle deleted, the first moved a beat later
    let clips: Clip[] = trimClip([{ id: "a", take: "t1", from: 0, to: R * 4 }], "a", "from", 21600, take);
    clips = splitClip(clips, "a", 60000, take, "b");
    clips = splitClip(clips, "b", 108000, take, "c");
    clips = clips.filter((x) => x.id !== "b").map((x) => (x.id === "a" ? { ...x, move: 24000 } : x));
    new TakeRuns().item(c as unknown as BaseAudioContext, list(clips), { t: 10, s0: 0, s1: 8, spb: 0.5, now: 9.9 });
    expect(out.map((x) => [Math.round(x.when * R), Math.round(x.offset * R), Math.round(x.dur * R)])).toEqual([
      // a: frames 21600..60000 of the take, sounding a beat (24000 frames) after where they were sung
      [10 * R + 21600 + 24000, 21600, 60000 - 21600],
      // c: frames 108000..192000, where they were sung
      [10 * R + 108000, 108000, 192000 - 108000],
    ]);
  });

  it("fades in and out over its first and last few milliseconds", () => {
    const { c, out } = ctx();
    new TakeRuns().item(c as unknown as BaseAudioContext, list([{ id: "a", take: "t1", from: 24000, to: 48000 }]), { t: 10, s0: 0, s1: 8, spb: 0.5, now: 9.9 });
    const [x] = out;
    const g = x.gain;
    expect(x.when).toBe(10.5);
    expect(g.at(10.5)).toBe(0);
    expect(g.at(10.5 + EDGE_FADE / 2)).toBeCloseTo(0.5, 6);
    expect(g.at(10.5 + EDGE_FADE)).toBe(1);
    expect(g.at(10.75)).toBe(1);
    expect(g.at(11 - EDGE_FADE)).toBe(1);
    expect(g.at(11 - EDGE_FADE / 2)).toBeCloseTo(0.5, 6);
    expect(g.at(11)).toBe(0);
    expect(EDGE_FADE).toBeGreaterThanOrEqual(0.004);
    expect(EDGE_FADE).toBeLessThanOrEqual(0.01);
    // a piece shorter than two fades: half of it each way
    const short = ctx();
    new TakeRuns().item(short.c as unknown as BaseAudioContext, list([{ id: "a", take: "t1", from: 0, to: 288 }]), { t: 10, s0: 0, s1: 8, spb: 0.5, now: 9.9 });
    expect(short.out[0].gain.at(10.003)).toBe(1);
    expect(short.out[0].gain.at(10.006)).toBe(0);
  });

  it("cut by the loop's end, it fades out there", () => {
    const { c, out } = ctx();
    new TakeRuns().item(c as unknown as BaseAudioContext, list([{ id: "a", take: "t1", from: 0, to: R * 4, move: 24000 }]), { t: 10, s0: 0, s1: 8, spb: 0.5, now: 9.9, until: 14 });
    expect(out[0].when).toBe(10.5);
    expect(out[0].dur).toBe(3.5);
    expect(out[0].gain.at(14 - EDGE_FADE)).toBe(1);
    expect(out[0].gain.at(14)).toBe(0);
  });

  it("edited while it plays: started again as it is now; one not edited carries on", () => {
    const { c, out } = ctx();
    const runs = new TakeRuns();
    const go = (clips: Clip[], t: number) => runs.item(c as unknown as BaseAudioContext, list(clips), { t, s0: 0, s1: 8, spb: 0.5, now: t - 0.1 });
    const two: Clip[] = [{ id: "a", take: "t1", from: 0, to: 96000 }, { id: "b", take: "t1", from: 96000, to: R * 4 }];
    go(two, 10);
    expect(out).toHaveLength(2);
    // the loop comes round with nothing changed: both start again (a new pass), nothing doubled
    go(two, 14);
    expect(out).toHaveLength(4);
    expect(out[0].stops).toEqual([]);
    // b trimmed at its end while the music is still in this pass: b stops and starts again, as it is now; a carries on
    go([two[0], { ...two[1], to: 150000 }], 14);
    expect(out).toHaveLength(5);
    expect(out[3].stops).toEqual([14]);
    expect(out[2].stops).toEqual([]);
    expect([out[4].when, out[4].offset, out[4].dur]).toEqual([16, 2, 150000 / R - 2]);
  });
});
