import { describe, expect, it } from "vitest";
import type { Recorded } from "../song/takes";
import type { AudioClip, AudioTrack, Session, TimelineSong } from "./model";
import { addRecording5, backingKey, recordPlan5, RECORD_BARS } from "./record";
import { setContent, setTrack } from "./edit";
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

  it("with no loop (or the loop off) the song is played once: from the bar line at or before the cursor to the song's end and eight bars more", () => {
    // the band's song is 16 bars (64 beats)
    const off = recordPlan5(bandSong(), session({ cursor: 9.5 }));
    expect([off.from, off.to, off.loop]).toEqual([8, 64 + 4 * RECORD_BARS, false]);
    expect(off.bars).toEqual(Array(14 + RECORD_BARS).fill(4));
    // a cursor on a bar line starts there
    expect(recordPlan5(bandSong(), session({ cursor: 16 }))).toMatchObject({ from: 16, to: 96, loop: false });
    // stretches that are marked but switched off do not count
    expect(recordPlan5(bandSong(), session({ cursor: 9.5, loop: { regions: [{ from: 0, to: 4 }], on: false } }))).toEqual(off);
  });

  it("with the loop off and the cursor at or past the song's end: eight bars from the cursor's bar; a song with nothing in it: eight bars from the start", () => {
    const near = recordPlan5(bandSong(), session({ cursor: 48 }));
    expect([near.from, near.to]).toEqual([48, 96]);
    const past = recordPlan5(bandSong(), session({ cursor: 70 }));
    expect([past.from, past.to, past.loop]).toEqual([68, 100, false]);
    expect(past.bars).toEqual(Array(8).fill(4));
    expect(recordPlan5(songOf([audioTrack("tv")]), session())).toEqual({ from: 0, to: 32, loop: false, bars: Array(8).fill(4) });
  });

  it("with the loop off across a change of time signature: every bar to the end and past it in its own beats", () => {
    // 4/4 to bar 8, 6/8 (two beats) in bars 9 to 12, 4/4 again from bar 13
    const song = mixedSong();
    const p = recordPlan5(song, session({ cursor: 30 }));
    expect(p.from).toBe(28);
    expect(p.loop).toBe(false);
    expect(p.bars.slice(0, 6)).toEqual([4, 2, 2, 2, 2, 4]);
    expect(p.bars.reduce((a, b) => a + b, 0)).toBe(p.to - p.from);
    // the last eight bars lie past the song's end, in the time signature the song ends in
    expect(p.bars.slice(-RECORD_BARS)).toEqual(Array(RECORD_BARS).fill(4));
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

describe("a recording from a pair of inputs", () => {
  const stereo = (passes: number, o: Partial<Recorded> = {}) => recorded(passes, { channels: 2, ...o });

  it("round the loop: every pass is a stereo take, cut where a voice's would be (the counts are frames, whatever the channels)", () => {
    const plan = { from: 8, to: 12, loop: true, bars: [4] };
    const out = addRecording5(empty(), "tv", stereo(3), plan, opts());
    const mono = addRecording5(empty(), "tv", recorded(3), plan, opts());
    expect(vocal(out).takes.map((k) => k.channels)).toEqual([2, 2, 2]);
    expect(vocal(out).takes.map(({ channels: _c, ...k }) => k)).toEqual(vocal(mono).takes);
    // a voice's takes say nothing of channels, as before
    expect(vocal(mono).takes.every((k) => !("channels" in k))).toBe(true);
    expect(clipsOn(out)).toEqual(clipsOn(mono));
  });

  it("once through: one stereo take from where the song began to the stop", () => {
    const r = stereo(0, { loop_frames: 0, frames: 480 + 48000 + 300000 });
    const out = addRecording5(empty(), "tv", r, { from: 16, to: 80, loop: false, bars: Array(16).fill(4) }, opts());
    expect(vocal(out).takes).toHaveLength(1);
    expect(vocal(out).takes[0]).toMatchObject({ channels: 2, start: 480 + 48000, frames: 300000, at: 16 });
    expect(clipsOn(out)[0]).toMatchObject({ take: vocal(out).takes[0].id, start: 16, frames: 300000 });
  });

  it("what the file is counts, not what the track's input says by then", () => {
    const paired = setTrack<AudioTrack>(empty(), "tv", { input: { ch: 2, pair: true } });
    expect(vocal(addRecording5(paired, "tv", recorded(1), { from: 0, to: 4, loop: true, bars: [4] }, opts())).takes[0].channels).toBeUndefined();
  });
});

describe("the song under a recording, as a text that says when it can be played again", () => {
  const plan = { from: 16, to: 96, loop: false };
  const k1 = take("k1", 8, 4);
  const song = () => songOf([chordsTrack("tc"), audioTrack("tv", "vocals", "Vocal 1", [k1]), audioTrack("ta", "audio", "Guitar")], { bpm: 120, clips: [chordsClip("c1", "tc", 0, 16), audioClip("a1", "tv", k1, 4)] });

  it("is the same for the same song and stretch", () => {
    expect(backingKey(song(), "ta", plan)).toBe(backingKey(song(), "ta", plan));
  });

  it("changes when another track's clip changes, and not when the armed track's does", () => {
    const before = song();
    const key = backingKey(before, "tv", plan);
    // another track: its clip moved, its content changed, its sound changed
    const moved: TimelineSong = { ...before, clips: before.clips.map((c) => (c.id === "c1" ? { ...c, start: 4 } : c)) };
    expect(backingKey(moved, "tv", plan)).not.toBe(key);
    const c1 = before.clips.find((c) => c.id === "c1") as Extract<TimelineSong["clips"][number], { kind: "chords" }>;
    expect(backingKey(setContent(before, "c1", { ...c1.content, style: "strum" }), "tv", plan)).not.toBe(key);
    // the armed track: a new take and its clip (a recording just made), a clip trimmed, its name
    const k2 = take("k2", 8, 16);
    const sung: TimelineSong = { ...before, tracks: before.tracks.map((t) => (t.id === "tv" ? ({ ...t, name: "Lead", takes: [k1, k2] } as AudioTrack) : t)), clips: [...before.clips.map((c) => (c.id === "a1" ? { ...c, frames: 1000 } : c)), audioClip("a2", "tv", k2, 16)] };
    expect(backingKey(sung, "tv", plan)).toBe(key);
    // (heard under a rehearsal, where nothing is left out, the same change counts)
    expect(backingKey(sung, null, plan)).not.toBe(backingKey(before, null, plan));
  });

  it("changes with the stretch, the tempo, the mixer, and whether the song goes round", () => {
    const s = song();
    const key = backingKey(s, "ta", plan);
    expect(backingKey(s, "ta", { ...plan, from: 12 })).not.toBe(key);
    expect(backingKey(s, "ta", { ...plan, loop: true })).not.toBe(key);
    expect(backingKey({ ...s, bpm: 121 }, "ta", plan)).not.toBe(key);
    expect(backingKey({ ...s, mix: { tc: { db: -3 } } }, "ta", plan)).not.toBe(key);
    // the armed track's own fader is not in what is sung over; its solo is (it silences the others)
    expect(backingKey({ ...s, mix: { ta: { db: -6, mute: true } } }, "ta", plan)).toBe(key);
    expect(backingKey({ ...s, mix: { ta: { solo: true } } }, "ta", plan)).not.toBe(key);
  });

  it("played once: a take just recorded past the song's end moves the plan's end, and not the text", () => {
    const before = song();
    const p1 = recordPlan5(before, session({ cursor: 16 }));
    // the recording ran on past the end: its clip on the armed track is now the last thing in the song
    const long = take("k9", 60, 16);
    const after: TimelineSong = { ...before, tracks: before.tracks.map((t) => (t.id === "ta" ? ({ ...t, takes: [long] } as AudioTrack) : t)), clips: [...before.clips, audioClip("a9", "ta", long, 16)] };
    const p2 = recordPlan5(after, session({ cursor: 16 }));
    expect(p2.to).toBeGreaterThan(p1.to);
    expect(backingKey(after, "ta", p2)).toBe(backingKey(before, "ta", p1));
    // round a loop, where the stretch ends is heard
    expect(backingKey(before, "ta", { from: 0, to: 16, loop: true })).not.toBe(backingKey(before, "ta", { from: 0, to: 32, loop: true }));
  });

  it("does not read what is not heard: a name, a colour", () => {
    const s = song();
    expect(backingKey(setTrack(s, "tc", { color: 3 }), "ta", plan)).toBe(backingKey(s, "ta", plan));
    expect(backingKey({ ...s, tracks: s.tracks.map((t) => (t.id === "tc" ? { ...t, name: "Keys" } : t)) }, "ta", plan)).toBe(backingKey(s, "ta", plan));
  });
});
