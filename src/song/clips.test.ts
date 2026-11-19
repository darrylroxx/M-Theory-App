import { describe, expect, it } from "vitest";
import { activeTake, layTakes, type Take } from "./takes";
import {
  addRecording, chooseTake, clipSpan, clipsOf, compClip, deleteClip, deleteTake, gridFrames, inUse, laneBeats, lanePos, layClips, migrateClips, moveClip, placedClips,
  playedTakes, removeRecording, reviveClips, sameSpot, snapMove, splitClip, trimClip, type Clip,
} from "./clips";
import { reviveTracks } from "./tracks";

const R = 48000;
/** a pass of 2 bars of 4/4 at 120: 4 s */
const LOOP = R * 4;
const take = (id: string, n: number, o: Partial<Take> = {}): Take => ({ id, n, group: "g1", dry: "d.wav", wet: "w.wav", rate: R, start: 1000 + (n - 1) * LOOP, frames: LOOP, at: { block: "a", bar: 0 }, ...o });
const takes = [take("t1", 1), take("t2", 2), take("t3", 3), take("t4", 4, { frames: 30000, short: true })];
let k = 0;
const id = () => `n${++k}`;
const one = (cs: Clip[]) => {
  expect(cs).toHaveLength(1);
  return cs[0];
};
/** where a frame of a clip's take sounds, in seconds from the bar it was sung on */
const soundsAt = (c: Clip, frame: number, rate = R) => (frame + (c.move ?? 0)) / rate;

describe("clips: what a vocal track plays of its takes", () => {
  it("a track saved before clips plays one whole take from each recording, exactly as it did", () => {
    const old = [...takes, take("u1", 1, { group: "g2", at: { block: "b", bar: 1 } }), take("u2", 2, { group: "g2", at: { block: "b", bar: 1 } })];
    const clips = migrateClips(old, { g1: "t2" });
    expect(clips).toEqual([{ id: "t2~c", take: "t2", from: 0, to: LOOP }, { id: "u2~c", take: "u2", from: 0, to: LOOP }]);
    // the same every time (the player knows a clip by its id)
    expect(migrateClips(old, { g1: "t2" })).toEqual(clips);
    // laid in the song: exactly where, and as long as, the takes were
    const secs = [{ block: "a", bar: 4, beats: 8 }, { block: "b", bar: 3, beats: 9 }];
    const before = layTakes(secs, [old[1], old[5]], 120);
    const after = layClips(secs, placedClips({ takes: old, active: { g1: "t2" } }), 120);
    for (const s of ["a", "b"]) {
      expect(after[s].map((x) => [x.take.id, x.at, x.offset, x.dur])).toEqual(before[s].map((x) => [x.take.id, x.at, 0, x.take.frames / x.take.rate]));
    }
  });

  it("saved clips are read back safe; an old saved track gets its clips", () => {
    expect(reviveClips([{ id: "c1", take: "t1", from: 10.4, to: LOOP + 99, move: -3.6 }, { id: "c1", take: "t1", from: 0, to: 5 }, { id: "c2", take: "gone", from: 0, to: 5 }, { id: "c3", take: "t1", from: 9, to: 9 }, null], takes))
      .toEqual([{ id: "c1", take: "t1", from: 10, to: LOOP, move: -4 }]);
    const [old] = reviveTracks([{ id: "v1", kind: "vocals", name: "Vocal 1", takes, active: { g1: "t1" } }])!;
    expect(old.clips).toEqual([{ id: "t1~c", take: "t1", from: 0, to: LOOP }]);
    const [edited] = reviveTracks([{ id: "v1", kind: "vocals", name: "Vocal 1", takes, clips: [{ id: "c9", take: "t3", from: 100, to: 2000 }] }])!;
    expect(edited.clips).toEqual([{ id: "c9", take: "t3", from: 100, to: 2000 }]);
    // every clip deleted: nothing plays (not the takes again)
    const [none] = reviveTracks([{ id: "v1", kind: "vocals", name: "Vocal 1", takes, clips: [] }])!;
    expect(clipsOf(none)).toEqual([]);
  });

  it("trimming an edge cuts the cough out and leaves the voice where it was", () => {
    const whole: Clip = { id: "c", take: "t1", from: 0, to: LOOP };
    const c = one(trimClip([whole], "c", "from", 21600, takes[0]));
    expect(c).toEqual({ id: "c", take: "t1", from: 21600, to: LOOP });
    // the frame after the cough sounds exactly when it did
    expect(soundsAt(c, 24000)).toBe(soundsAt(whole, 24000));
    // laid in the song: it starts 0.45 s (0.9 beats) later, 0.45 s into its take
    const [x] = layClips([{ block: "a", bar: 4, beats: 8 }], [{ clip: c, take: takes[0] }], 120).a;
    expect(x.at).toBeCloseTo(0.9, 12);
    expect(x.offset).toBe(0.45);
    expect(x.dur).toBe(3.55);
    // never past the other edge, never off the take, never shorter than 20 ms
    expect(one(trimClip([whole], "c", "from", LOOP + 5, takes[0])).from).toBe(LOOP - 960);
    expect(one(trimClip([whole], "c", "from", -50, takes[0])).from).toBe(0);
    expect(one(trimClip([whole], "c", "to", LOOP * 2, takes[0])).to).toBe(LOOP);
    expect(one(trimClip([c], "c", "to", 0, takes[0])).to).toBe(21600 + 960);
  });

  it("a move keeps to whole 1/16 notes, or goes anywhere when free", () => {
    expect(gridFrames(R, 120)).toBe(6000);
    expect(snapMove(23999.4, R, 120)).toBe(24000);
    expect(snapMove(26900, R, 120)).toBe(24000);
    expect(snapMove(-9100, R, 120)).toBe(-12000);
    expect(snapMove(26900.4, R, 120, true)).toBe(26900);
    // 44.1 kHz at 100: a 1/16 note is 6615 frames
    expect(snapMove(13300, 44100, 100)).toBe(13230);
    const c = one(moveClip([{ id: "c", take: "t1", from: 100, to: 500 }], "c", 24000));
    expect(c.move).toBe(24000);
    // moved back to where it was sung: no move kept
    expect(one(moveClip([c], "c", 0))).toEqual({ id: "c", take: "t1", from: 100, to: 500 });
    // a beat later in the song
    const [x] = layClips([{ block: "a", bar: 4, beats: 8 }], [{ clip: c, take: takes[0] }], 120).a;
    expect(x.at).toBeCloseTo(1 + 100 / 24000, 12);
    expect(x.offset).toBe(100 / R);
  });

  it("a split makes two pieces that play exactly what the one did", () => {
    const c: Clip = { id: "c", take: "t1", from: 1000, to: LOOP, move: 6000 };
    const [a, b] = splitClip([c], "c", 60000, takes[0], "c2");
    expect(a).toEqual({ id: "c", take: "t1", from: 1000, to: 60000, move: 6000 });
    expect(b).toEqual({ id: "c2", take: "t1", from: 60000, to: LOOP, move: 6000 });
    expect(clipSpan(a, takes[0]).end).toBe(clipSpan(b, takes[0]).start);
    // too near an edge: nothing happens
    expect(splitClip([c], "c", 1500, takes[0], "c2")).toEqual([c]);
    expect(splitClip([c], "c", LOOP - 10, takes[0], "c2")).toEqual([c]);
    // and a piece deleted leaves the rest
    expect(deleteClip([a, b], "c")).toEqual([b]);
  });

  it("comping: a piece plays the same stretch of another take; a short last pass gives what it has", () => {
    const h = { takes, clips: [{ id: "c", take: "t1", from: 0, to: 60000 }, { id: "d", take: "t1", from: 60000, to: LOOP }] };
    expect(compClip(h, "d", "t2")).toEqual([{ id: "c", take: "t1", from: 0, to: 60000 }, { id: "d", take: "t2", from: 60000, to: LOOP }]);
    expect(compClip(h, "c", "t4")[0]).toEqual({ id: "c", take: "t4", from: 0, to: 30000 });
    // nothing in a short pass there: unchanged
    expect(compClip(h, "d", "t4")).toEqual(h.clips);
    // a take sung from another bar is not the same place
    const other = take("x1", 1, { group: "g9", at: { block: "a", bar: 1 } });
    expect(compClip({ ...h, takes: [...takes, other] }, "c", "x1")).toEqual(h.clips);
    // the loop recorded again from the same bar: its takes can stand in
    const again = take("y1", 1, { group: "g8" });
    expect(sameSpot(again, takes[0])).toBe(true);
    expect(compClip({ ...h, takes: [...takes, again] }, "c", "y1")[0].take).toBe("y1");
  });

  it("Use: a take plays in every clip of its place, as edited; with none left, whole", () => {
    const h = { takes, clips: [{ id: "c", take: "t1", from: 0, to: 60000 }, { id: "d", take: "t2", from: 90000, to: LOOP, move: 6000 }], active: { g1: "t1" } };
    const r = chooseTake(h, "t3", "new");
    expect(r.clips).toEqual([{ id: "c", take: "t3", from: 0, to: 60000 }, { id: "d", take: "t3", from: 90000, to: LOOP, move: 6000 }]);
    expect(r.active).toEqual({ g1: "t3" });
    expect(chooseTake({ takes, clips: [], active: {} }, "t2", "new").clips).toEqual([{ id: "new", take: "t2", from: 0, to: LOOP }]);
    expect(inUse({ ...h, ...r }, "t3")).toBe(true);
    expect(inUse({ ...h, ...r }, "t1")).toBe(false);
  });

  it("deleting a take: what played it plays the last ★, else the last full pass; the last one gone, its clips go", () => {
    const starred = takes.map((t) => (t.id === "t1" ? { ...t, keep: true } : t));
    const h = { takes: starred, clips: [{ id: "c", take: "t3", from: 500, to: 9000 }], active: { g1: "t3" } };
    const r = deleteTake(h, "t3");
    expect(r.takes!.map((t) => t.id)).toEqual(["t1", "t2", "t4"]);
    expect(r.clips).toEqual([{ id: "c", take: "t1", from: 500, to: 9000 }]);
    expect(r.active).toEqual({ g1: "t1" });
    // no ★: the last full pass (not the short one)
    expect(deleteTake({ takes, clips: [{ id: "c", take: "t3", from: 0, to: LOOP }] }, "t3").clips).toEqual([{ id: "c", take: "t2", from: 0, to: LOOP }]);
    // a take not playing: nothing else changes
    expect(deleteTake(h, "t2").clips).toBe(h.clips);
    // the recording's last take
    const solo = { takes: [take("z", 1, { group: "gz" })], clips: [{ id: "c", take: "z", from: 0, to: 9 }], active: { gz: "z" } };
    expect(deleteTake(solo, "z")).toEqual({ takes: [], clips: [], active: {} });
    // a whole recording removed: its takes and clips (another's stay)
    const two = { takes: [...takes, take("u", 1, { group: "g2" })], clips: [{ id: "a", take: "t1", from: 0, to: 9 }, { id: "b", take: "u", from: 0, to: 9 }], active: { g1: "t1", g2: "u" } };
    expect(removeRecording(two, "g1")).toEqual({ takes: [two.takes[4]], clips: [two.clips[1]], active: { g2: "u" } });
  });

  it("a new recording plays whole; sung again over the same bars, the earlier one makes way only where it lies", () => {
    const first = addRecording({}, takes, id);
    expect(first.clips).toEqual([{ id: expect.any(String), take: "t3", from: 0, to: LOOP }]);
    // an earlier 4-bar recording (8 s) from the same bar, and the loop's first 2 bars sung again
    const long = take("L1", 1, { group: "gL", frames: LOOP * 2 });
    const h = { takes: [long], clips: [{ id: "old", take: "L1", from: 0, to: LOOP * 2 }] };
    const again = [take("s1", 1, { group: "gS" }), take("s2", 2, { group: "gS", keep: true }), take("s3", 3, { group: "gS" })];
    const r = addRecording(h, again, id);
    // what the earlier one had after the new one still plays; the new one (the ★) plays where it was sung
    expect(r.clips).toEqual([{ id: "old", take: "L1", from: LOOP, to: LOOP * 2 }, { id: expect.any(String), take: "s2", from: 0, to: LOOP }]);
    // sung from another bar: both play (another place)
    const elsewhere = again.map((t) => ({ ...t, at: { block: "b", bar: 0 } }));
    expect(addRecording(h, elsewhere, id).clips).toHaveLength(2);
    expect(addRecording(h, elsewhere, id).clips![0]).toEqual(h.clips[0]);
    expect(activeTake(again, "gS")!.id).toBe("s2");
  });

  it("the takes the clips play are each read once", () => {
    expect(playedTakes({ takes, clips: [{ id: "a", take: "t1", from: 0, to: 9 }, { id: "b", take: "t1", from: 9, to: 99 }, { id: "c", take: "t2", from: 0, to: 9 }, { id: "d", take: "gone", from: 0, to: 9 }] }).map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("laid in the song across sections, sample-exact", () => {
    // A: 2 bars of 4/4 (8 beats), B: 2 bars of 3/4 (6 beats); at 100 bpm, 44.1 kHz
    const t = take("t", 1, { rate: 44100, frames: 44100 * 8, at: { block: "a", bar: 1 } });
    // from 0.3 s of the take, moved a 1/16 note (6615 frames) later
    const c: Clip = { id: "c", take: "t", from: 13230, to: 44100 * 8, move: 6615 };
    const laid = layClips([{ block: "a", bar: 4, beats: 8 }, { block: "b", bar: 3, beats: 6 }], [{ clip: c, take: t }], 100);
    // its sound starts at bar 2 of A (beat 4) + 0.45 s (0.75 beats)
    expect(laid.a[0].at).toBeCloseTo(4.75, 12);
    expect(laid.a[0].offset * 44100).toBe(13230);
    expect(laid.a[0].dur * 44100).toBeCloseTo(44100 * 8 - 13230, 6);
    // listed in B too, from before B's start
    expect(laid.b[0].at).toBeCloseTo(4.75 - 8, 12);
    expect(laid.b[0].offset).toBe(laid.a[0].offset);
  });

  it("the lane: every bar drawn the same width, whatever its beats", () => {
    const bars = [{ beats: 4 }, { beats: 4 }, { beats: 3 }];
    expect(laneBeats(bars, 2.5)).toBe(9.5);
    expect(lanePos(bars, 9.5)).toBe(2.5);
    for (const p of [-0.5, 0, 0.25, 1.75, 2, 2.9, 3.4]) expect(lanePos(bars, laneBeats(bars, p))).toBeCloseTo(p, 12);
    // before and after the bars: at the first's and the last's length
    expect(laneBeats(bars, -0.5)).toBe(-2);
    expect(laneBeats(bars, 3.5)).toBe(12.5);
  });
});
