import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addTrack, deleteClips, layDown, moveClips, removeTrack, transpose } from "./edit";
import { keepTakes, makeHistory, type Step } from "./history";
import type { AudioTrack, ChordsClip, TimelineSong } from "./model";
import { useTake5 } from "./audioclips";
import { addRecording5 } from "./record";
import { KEY_C, audioClip, audioTrack, bandSong, chordsTrack, counter, songOf, take } from "./testsongs";

const step = (song: TimelineSong, label = "", key = KEY_C): Step => ({ song, key, label });
const vocal = (song: TimelineSong, id = "tv") => song.tracks.find((t) => t.id === id) as AudioTrack;

describe("the history: one undo for the whole idea", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  /** let time pass */
  const wait = (ms: number) => vi.setSystemTime(Date.now() + ms);

  it("push, undo, redo", () => {
    const h = makeHistory();
    const a = bandSong();
    const b = moveClips(a, ["m1"], 4);
    const c = deleteClips(b, ["d1"]);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo(step(a))).toBeNull();
    expect(h.redo(step(a))).toBeNull();

    h.push(step(a, "Move clip"));
    h.push(step(b, "Delete clip"));
    expect(h.canUndo).toBe(true);
    // back from c to b, then to a
    const one = h.undo(step(c, "now"))!;
    expect(one.song).toBe(b);
    expect(one.label).toBe("Delete clip");
    expect(h.canRedo).toBe(true);
    const two = h.undo(step(b, "now"))!;
    expect(two.song).toBe(a);
    expect(two.label).toBe("Move clip");
    expect(h.canUndo).toBe(false);
    expect(h.undo(step(a))).toBeNull();
    // forward again
    expect(h.redo(step(a))!.song).toBe(b);
    expect(h.redo(step(b))!.song).toBe(c);
    expect(h.canRedo).toBe(false);
    expect(h.redo(step(c))).toBeNull();
    expect(h.canUndo).toBe(true);
  });

  it("a new change ends what could be redone", () => {
    const h = makeHistory();
    const a = bandSong();
    const b = moveClips(a, ["m1"], 4);
    h.push(step(a));
    h.undo(step(b));
    expect(h.canRedo).toBe(true);
    h.push(step(a));
    expect(h.canRedo).toBe(false);
    expect(h.redo(step(b))).toBeNull();
  });

  it("remembers 100 steps and forgets the oldest first", () => {
    const h = makeHistory();
    const songs = Array.from({ length: 131 }, (_, i) => ({ ...bandSong(), bpm: 60 + i }));
    for (let i = 0; i < 130; i++) h.push(step(songs[i]));
    let now = songs[130];
    let count = 0;
    for (;;) {
      const back = h.undo(step(now));
      if (!back) break;
      now = back.song;
      count++;
    }
    expect(count).toBe(100);
    // the oldest step it still had: the song before change 31
    expect(now).toBe(songs[30]);
    // a history told to remember fewer
    const small = makeHistory(2);
    for (let i = 0; i < 5; i++) small.push(step(songs[i]));
    expect(small.undo(step(songs[5]))!.song).toBe(songs[4]);
    expect(small.undo(step(songs[4]))!.song).toBe(songs[3]);
    expect(small.undo(step(songs[3]))).toBeNull();
  });

  it("two changes from one control within 500 ms are one step", () => {
    const h = makeHistory();
    const a = bandSong();
    const b = { ...a, bpm: 100 };
    const c = { ...a, bpm: 104 };
    h.push(step(a, "Tempo"), "tempo");
    wait(300);
    h.push(step(b, "Tempo"), "tempo");
    wait(300);
    h.push(step(c, "Tempo"), "tempo");
    // one undo goes all the way back to before the control was touched
    expect(h.undo(step({ ...a, bpm: 108 }))!.song).toBe(a);
    expect(h.canUndo).toBe(false);
  });

  it("after 500 ms, or from another control, or with no control, a change is a step of its own", () => {
    const h = makeHistory();
    const a = bandSong();
    const b = { ...a, bpm: 100 };
    const c = { ...a, bpm: 104 };
    const d = { ...a, bpm: 108 };
    h.push(step(a), "tempo");
    wait(500);
    h.push(step(b), "tempo");
    wait(100);
    h.push(step(c), "volume");
    wait(100);
    h.push(step(d));
    wait(100);
    h.push(step(d));
    const seen: TimelineSong[] = [];
    for (let s = h.undo(step(d)); s; s = h.undo(step(s.song))) seen.push(s.song);
    expect(seen).toEqual([d, d, c, b, a]);
  });

  it("an undo ends the fold: the same control straight afterwards starts a new step", () => {
    const h = makeHistory();
    const a = bandSong();
    const b = { ...a, bpm: 100 };
    h.push(step(a), "tempo");
    wait(100);
    expect(h.undo(step(b))!.song).toBe(a);
    wait(100);
    h.push(step(a), "tempo");
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it("a step holds the key: undo after \"Move song\" gives the old key back with the old notes", () => {
    const h = makeHistory();
    const before = bandSong();
    const inD = { tonic: "D", scaleId: "ionian" };
    h.push({ song: before, key: KEY_C, label: "Move song" });
    const after = transpose(before, 2, KEY_C, inD);
    expect((after.clips[0] as ChordsClip).content.chords[0].ref.root).toBe("D");
    const back = h.undo({ song: after, key: inD, label: "" })!;
    expect(back.key).toEqual(KEY_C);
    expect(back.song).toBe(before);
    // and redo brings the new key back with the new notes
    const again = h.redo({ song: back.song, key: back.key, label: "" })!;
    expect(again.key).toEqual(inD);
    expect(again.song).toBe(after);
  });

  it("clear forgets everything", () => {
    const h = makeHistory();
    const a = bandSong();
    h.push(step(a));
    h.push(step(a));
    h.undo(step(a));
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo(step(a))).toBeNull();
  });
});

describe("keepTakes: a recording is never lost by undo", () => {
  /** a finished recording as the model sees it: two takes of one pass on the vocal track, and a clip that plays the first */
  const record = (song: TimelineSong): TimelineSong => {
    const one = take("r1", 4, 8, { group: "rec" });
    const two = take("r2", 4, 8, { group: "rec", n: 2 });
    const t = vocal(song);
    const withTakes = { ...song, tracks: song.tracks.map((x) => (x === t ? { ...t, takes: [...t.takes, one, two] } : x)) };
    return layDown(withTakes, audioClip("rc", "tv", one, 8));
  };

  it("after the undo of a recording its takes are still on the track, unplaced; the clip is gone and what it trimmed is back", () => {
    const before = layDown(bandSong(), audioClip("old", "tv", vocal(bandSong()).takes[0], 6, { frames: 2 * 48000 }));
    const after = record(before);
    // the recording trimmed the clip that lay there
    expect(after.clips.find((c) => c.id === "old")).not.toEqual(before.clips.find((c) => c.id === "old"));
    const undone = keepTakes(before, after);
    expect(undone.clips).toBe(before.clips);
    expect(vocal(undone).takes.map((k) => k.id)).toEqual(["k1", "r1", "r2"]);
    // the take that was there is as it was; the new ones lie nowhere
    expect(vocal(undone).takes[0]).toBe(vocal(before).takes[0]);
    expect(vocal(undone).takes.slice(1).map((k) => k.at)).toEqual([null, null]);
    expect(vocal(undone).takes[1]).toEqual({ ...vocal(after).takes[1], at: null });
    expect(undone.shelf).toBeUndefined();
  });

  it("they are still there after one more edit, and after a redo they are placed again, once", () => {
    const before = bandSong();
    const after = record(before);
    const undone = keepTakes(before, after);
    const edited = moveClips(undone, ["m1"], 4);
    expect(vocal(edited).takes.map((k) => k.id)).toEqual(["k1", "r1", "r2"]);
    // redo: the song after the recording comes back; it has every take already
    const redone = keepTakes(after, undone);
    expect(redone).toBe(after);
    expect(vocal(redone).takes.map((k) => [k.id, k.at])).toEqual([["k1", 32], ["r1", 8], ["r2", 8]]);
  });

  it("through the history itself: record, undo, edit, undo, redo", () => {
    const h = makeHistory();
    const start = bandSong();
    h.push(step(start, "Record"));
    const recorded = record(start);
    let now = keepTakes(h.undo(step(recorded))!.song, recorded);
    expect(now.clips.some((c) => c.id === "rc")).toBe(false);
    expect(vocal(now).takes).toHaveLength(3);
    h.push(step(now, "Move clip"));
    const moved = moveClips(now, ["c2"], 32);
    now = keepTakes(h.undo(step(moved))!.song, moved);
    expect(vocal(now).takes).toHaveLength(3);
    now = keepTakes(h.redo(step(now))!.song, now);
    expect(now).toBe(moved);
    expect(vocal(now).takes).toHaveLength(3);
  });

  it("when the undo takes the track away too, its takes are on the shelf", () => {
    const before = songOf([chordsTrack("tc")]);
    const added = addTrack(before, "vocals", "tv");
    const sung = take("r1", 3, 0);
    const recorded = layDown({ ...added, tracks: added.tracks.map((t) => (t.id === "tv" ? { ...(t as AudioTrack), takes: [sung] } : t)) }, audioClip("rc", "tv", sung, 0));
    // undo the recording, then undo the track
    const one = keepTakes(added, recorded);
    expect(vocal(one).takes.map((k) => k.id)).toEqual(["r1"]);
    const two = keepTakes(before, one);
    expect(two.tracks).toBe(before.tracks);
    expect(two.shelf).toEqual([{ track: "tv", name: "Vocal 1", kind: "vocals", takes: [{ ...sung, at: null }], at: 1, saves: 0 }]);
    // one more undo, of anything: the shelf is carried along
    const older = songOf([]);
    expect(keepTakes(older, two).shelf).toEqual(two.shelf);
    // redo the track: the take is back on it, and no longer on the shelf
    const again = keepTakes(added, two);
    expect(vocal(again).takes.map((k) => k.id)).toEqual(["r1"]);
    expect(again.shelf).toBeUndefined();
  });

  it("undoing the removal of a track brings the track back with its takes, and shelves nothing twice", () => {
    const band = bandSong();
    const removed = removeTrack(band, "tv");
    expect(removed.shelf).toHaveLength(1);
    expect(keepTakes(band, removed)).toBe(band);
    // and redo: the shelf of the song that comes back already holds them
    expect(keepTakes(removed, band)).toBe(removed);
  });

  it("a take that only changed track is not doubled", () => {
    const band = addTrack(bandSong(), "audio", "tx");
    const moved = moveClips(band, ["a1"], 0, "tx");
    expect((moved.tracks.find((t) => t.id === "tx") as AudioTrack).takes).toHaveLength(1);
    // undo the move: the take is on the vocal track, where the clip is again
    expect(keepTakes(band, moved)).toBe(band);
  });

  it("with nothing to keep the restored song comes back as it is", () => {
    const band = bandSong();
    expect(keepTakes(band, band)).toBe(band);
    expect(keepTakes(band, deleteClips(band, ["a1"]))).toBe(band);
    const other = songOf([audioTrack("tv", "vocals", "Vocal 1", [])]);
    expect(keepTakes(band, other)).toBe(band);
  });

  it("a take lost from a track that is still there, with others kept: only the lost one is added", () => {
    const band = bandSong();
    const more = { ...band, tracks: band.tracks.map((t) => (t.id === "tv" ? { ...(t as AudioTrack), takes: [...(t as AudioTrack).takes, take("r9", 1, 4)] } : t)) };
    const out = keepTakes(band, more);
    expect(vocal(out).takes.map((k) => [k.id, k.at])).toEqual([["k1", 32], ["r9", null]]);
    expect(out.tracks[0]).toBe(band.tracks[0]);
  });
});

describe("a real recording through the history", () => {
  /** three passes round bars 3 and 4 of the band's song (at 96, two bars are five seconds), as the engine hands them back */
  const loop = 5 * 48000;
  const sing = (song: TimelineSong): TimelineSong =>
    addRecording5(song, "tv", { dry: "d.wav", wet: "w.wav", rate: 48000, frames: 480 + 48000 + 3 * loop, offset: 480, count_in: 48000, loop_frames: loop, dropped: 0 }, { from: 8, to: 16, loop: true, bars: [4, 4] }, { nudge: 0, kept: [2], id: counter("r"), bpm: 96, key: "C|ionian", sig: "4/4", sound: "" });

  it("record, undo, one more edit: the takes are still listed, and the undone clip's take lies nowhere", () => {
    const h = makeHistory();
    const start = bandSong();
    h.push(step(start, "Record"));
    const recorded = sing(start);
    expect(recorded.clips.filter((c) => c.track === "tv").map((c) => c.id).sort()).toEqual(["a1", "r5"]);
    expect(vocal(recorded).takes.map((k) => [k.id, k.at, !!k.keep])).toEqual([["k1", 32, false], ["r2", 8, false], ["r3", 8, true], ["r4", 8, false]]);

    // undo: the clip leaves the lane, the takes stay in the list
    let now = keepTakes(h.undo(step(recorded))!.song, recorded);
    expect(now.clips).toBe(start.clips);
    expect(vocal(now).takes.map((k) => [k.id, k.at])).toEqual([["k1", 32], ["r2", null], ["r3", null], ["r4", null]]);
    // (the ★ and everything else about them is kept)
    expect(vocal(now).takes[2]).toEqual({ ...vocal(recorded).takes[2], at: null });

    // one more edit, and its undo: they are still there
    h.push(step(now, "Move clip"));
    const moved = moveClips(now, ["m1"], 4);
    expect(vocal(moved).takes).toHaveLength(4);
    now = keepTakes(h.undo(step(moved))!.song, moved);
    expect(vocal(now).takes.map((k) => [k.id, k.at])).toEqual([["k1", 32], ["r2", null], ["r3", null], ["r4", null]]);
  });

  it("after the undo, Use lays one back at the cursor, and the others are a choice in the same place", () => {
    const start = bandSong();
    const recorded = sing(start);
    const undone = keepTakes(start, recorded);
    const used = useTake5(undone, "tv", "r2", 16, counter("u"));
    expect(used.clips.filter((c) => c.track === "tv" && c.kind === "audio").map((c) => [c.id, c.kind === "audio" && c.take, c.start]).sort()).toEqual([["a1", "k1", 32], ["u1", "r2", 16]]);
    expect(vocal(used).takes.map((k) => [k.id, k.at])).toEqual([["k1", 32], ["r2", 16], ["r3", 16], ["r4", 16]]);
    // that Use is undone as any edit is, and still nothing is lost
    const back = keepTakes(undone, used);
    expect(back).toBe(undone);
    expect(vocal(back).takes).toHaveLength(4);
  });
});
