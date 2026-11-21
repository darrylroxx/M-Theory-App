import { describe, expect, it } from "vitest";
import type { Recorded } from "../song/takes";
import type { AudioClip, AudioTrack, Session, TimelineSong } from "./model";
import { addRecording5, recordPlan5, RECORD_BARS } from "./record";
import { audioClip, audioTrack, bandSong, chordsClip, chordsTrack, counter, mixedSong, songOf, take } from "./testsongs";

const session = (o: Partial<Session> = {}): Pick<Session, "cursor" | "loop"> => ({ cursor: 0, loop: null, ...o });
const vocal = (s: TimelineSong, id = "tv") => s.tracks.find((t) => t.id === id) as AudioTrack;
const clipsOn = (s: TimelineSong, id = "tv") => s.clips.filter((c): c is AudioClip => c.kind === "audio" && c.track === id);

describe("what a recording goes round", () => {
  it("one loop stretch: that stretch, with the beats of each of its bars", () => {
    expect(recordPlan5(bandSong(), session({ loop: { regions: [{ from: 0, to: 16 }], on: true } }))).toEqual({ from: 0, to: 16, loop: true, bars: [4, 4, 4, 4] });
  });

  it("two stretches: one, from the first start to the last end, with all between", () => {
    const p = recordPlan5(bandSong(), session({ loop: { regions: [{ from: 8, to: 16 }, { from: 32, to: 40 }], on: true } }));
    expect([p.from, p.to, p.loop]).toEqual([8, 40, true]);
    expect(p.bars).toHaveLength(8);
    // (in whatever order the stretches are listed)
    const q = recordPlan5(bandSong(), session({ loop: { regions: [{ from: 32, to: 40 }, { from: 8, to: 16 }], on: true } }));
    expect([q.from, q.to]).toEqual([8, 40]);
  });

  it("edges that are not on bar lines are brought out to them", () => {
    const p = recordPlan5(bandSong(), session({ loop: { regions: [{ from: 5, to: 10.5 }], on: true } }));
    expect([p.from, p.to]).toEqual([4, 12]);
    expect(p.bars).toEqual([4, 4]);
    // one that is on them already stays
    expect(recordPlan5(bandSong(), session({ loop: { regions: [{ from: 4, to: 12 }], on: true } }))).toMatchObject({ from: 4, to: 12 });
  });

  it("with no loop (or the loop off): from the bar the cursor is in, at most eight bars", () => {
    const off = recordPlan5(bandSong(), session({ cursor: 9.5 }));
    expect([off.from, off.to, off.loop]).toEqual([8, 8 + 4 * RECORD_BARS, true]);
    expect(off.bars).toEqual(Array(RECORD_BARS).fill(4));
    // stretches that are marked but switched off do not count
    expect(recordPlan5(bandSong(), session({ cursor: 9.5, loop: { regions: [{ from: 0, to: 4 }], on: false } }))).toEqual(off);
  });

  it("with no loop it stops at the song's end when that is nearer, and goes eight bars when the cursor is past it", () => {
    // the band's song is 16 bars (64 beats): from bar 13, four bars are left
    const near = recordPlan5(bandSong(), session({ cursor: 48 }));
    expect([near.from, near.to]).toEqual([48, 64]);
    expect(near.bars).toEqual([4, 4, 4, 4]);
    const past = recordPlan5(bandSong(), session({ cursor: 64 }));
    expect([past.from, past.to]).toEqual([64, 96]);
    // a song with nothing in it: eight bars from the start
    expect(recordPlan5(songOf([audioTrack("tv")]), session())).toEqual({ from: 0, to: 32, loop: true, bars: Array(8).fill(4) });
  });

  it("the bars hold each bar's own beats across a change of time signature", () => {
    // 4/4 to bar 8, 6/8 (two beats) in bars 9 to 12, 4/4 again from bar 13
    const p = recordPlan5(mixedSong(), session({ loop: { regions: [{ from: 28, to: 44 }], on: true } }));
    expect([p.from, p.to]).toEqual([28, 44]);
    expect(p.bars).toEqual([4, 2, 2, 2, 2, 4]);
    expect(p.bars.reduce((a, b) => a + b, 0)).toBe(p.to - p.from);
    // an edge inside a 6/8 bar goes out to that bar's own lines
    const q = recordPlan5(mixedSong(), session({ loop: { regions: [{ from: 33, to: 37 }], on: true } }));
    expect([q.from, q.to]).toEqual([32, 38]);
  });
});

/** A recording as the engine hands it back: at 48,000 frames a second, a count-in of a second, each pass two seconds. */
const recorded = (passes: number, o: Partial<Recorded> = {}): Recorded => ({
  dry: "new-dry.wav", wet: "new-wet.wav", rate: 48000, frames: 480 + 48000 + Math.round(passes * 96000), offset: 480, count_in: 48000, loop_frames: 96000, dropped: 0, ...o,
});
const opts = (o: Partial<Parameters<typeof addRecording5>[4]> = {}) => ({ nudge: 0, kept: [] as number[], id: counter("r"), bpm: 120, key: "C|ionian", sig: "4/4", sound: "#abc", ...o });
/** a vocal track with nothing on it, in a song at 120 (a bar of 4/4 is two seconds) */
const empty = () => songOf([chordsTrack("tc"), audioTrack("tv")], { bpm: 120 });

describe("a finished recording, with the song going round", () => {
  const plan = { from: 8, to: 12, loop: true, bars: [4] };

  it("is one take for each pass, each sung from where the loop starts", () => {
    const out = addRecording5(empty(), "tv", recorded(3), plan, opts());
    const takes = vocal(out).takes;
    expect(takes.map((k) => [k.id, k.n, k.at, k.group])).toEqual([["r2", 1, 8, "r1"], ["r3", 2, 8, "r1"], ["r4", 3, 8, "r1"]]);
    expect(takes.every((k) => k.frames === 96000 && k.dry === "new-dry.wav" && k.wet === "new-wet.wav" && k.rate === 48000)).toBe(true);
    // what it was sung in and with
    expect(takes.every((k) => k.bpm === 120 && k.key === "C|ionian" && k.sig === "4/4" && k.sound === "#abc")).toBe(true);
  });

  it("has the time the sound took to come back, the nudge and the count-in in each take's start", () => {
    const plain = vocal(addRecording5(empty(), "tv", recorded(3), plan, opts())).takes;
    expect(plain.map((k) => k.start)).toEqual([480 + 48000, 480 + 48000 + 96000, 480 + 48000 + 192000]);
    expect(plain.map((k) => k.nudge)).toEqual([0, 0, 0]);
    // a nudge of 10 ms is 480 frames at this rate
    const nudged = vocal(addRecording5(empty(), "tv", recorded(3), plan, opts({ nudge: 10 }))).takes;
    expect(nudged.map((k) => k.start)).toEqual([480 + 480 + 48000, 480 + 480 + 48000 + 96000, 480 + 480 + 48000 + 192000]);
    expect(nudged.map((k) => k.nudge)).toEqual([480, 480, 480]);
  });

  it("lays one clip at the loop start, playing the pass that was kept ★", () => {
    const out = addRecording5(empty(), "tv", recorded(3), plan, opts({ kept: [2] }));
    expect(vocal(out).takes.map((k) => !!k.keep)).toEqual([false, true, false]);
    expect(clipsOn(out)).toEqual([{ id: "r5", track: "tv", kind: "audio", take: "r3", from: 0, to: 96000, off: 0, frames: 96000, start: 8 }]);
  });

  it("with no pass kept, the last full pass plays; a last pass stopped early is short and stays an alternative", () => {
    const out = addRecording5(empty(), "tv", recorded(2.25), plan, opts());
    expect(vocal(out).takes.map((k) => [k.n, !!k.short])).toEqual([[1, false], [2, false], [3, true]]);
    expect(clipsOn(out)[0].take).toBe("r3");
  });

  it("trims what the new clip covers on its track, and nothing on any other", () => {
    // an earlier take of eight seconds from beat 4: it covers beats 4 to 20 at this tempo; the new clip takes 8 to 12 out of it
    const old = take("k1", 8, 4);
    const before = songOf([chordsTrack("tc"), audioTrack("tv", "vocals", "Vocal 1", [old])], { bpm: 120, clips: [chordsClip("c1", "tc", 0, 16), audioClip("a1", "tv", old, 4)] });
    const out = addRecording5(before, "tv", recorded(1), plan, opts());
    const mine = clipsOn(out).sort((a, b) => a.start - b.start);
    expect(mine.map((c) => [c.id, c.take, c.start, c.off, c.frames])).toEqual([
      ["a1", "k1", 4, 0, 96000],
      ["r3", "r2", 8, 0, 96000],
      ["a1:2", "k1", 12, 192000, 192000],
    ]);
    expect(out.clips.find((c) => c.id === "c1")).toBe(before.clips[0]);
    // nothing is taken from the track's takes
    expect(vocal(out).takes.map((k) => k.id)).toEqual(["k1", "r2"]);
  });

  it("changes nothing when nothing was sung, or the track is not one that records", () => {
    const song = empty();
    // stopped in the count-in
    expect(addRecording5(song, "tv", recorded(0), plan, opts())).toBe(song);
    expect(addRecording5(song, "tc", recorded(3), plan, opts())).toBe(song);
    expect(addRecording5(song, "nowhere", recorded(3), plan, opts())).toBe(song);
  });
});

describe("a finished recording, with the song played once", () => {
  const plan = { from: 16, to: 80, loop: false, bars: Array(16).fill(4) };

  it("is one take, built here: everything from where the song began to the stop", () => {
    const r = recorded(0, { loop_frames: 0, frames: 480 + 48000 + 300000 });
    const out = addRecording5(empty(), "tv", r, plan, opts({ nudge: 10 }));
    const start = 480 + 480 + 48000;
    expect(vocal(out).takes).toEqual([{ id: "r2", n: 1, group: "r1", dry: "new-dry.wav", wet: "new-wet.wav", rate: 48000, start, frames: r.frames - start, at: 16, nudge: 480, sound: "#abc", bpm: 120, key: "C|ionian", sig: "4/4" }]);
    expect(clipsOn(out)).toEqual([{ id: "r3", track: "tv", kind: "audio", take: "r2", from: 0, to: r.frames - start, off: 0, frames: r.frames - start, start: 16 }]);
  });

  it("a loop length of nothing never cuts it into passes, even when the plan says the song went round", () => {
    const r = recorded(0, { loop_frames: 0, frames: 480 + 48000 + 300000 });
    const out = addRecording5(empty(), "tv", r, { ...plan, loop: true }, opts({ kept: [1] }));
    expect(vocal(out).takes).toHaveLength(1);
    expect(vocal(out).takes[0]).toMatchObject({ frames: 300000, keep: true });
  });
});
