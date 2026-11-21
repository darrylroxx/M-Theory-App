import { describe, expect, it } from "vitest";
import { dropTake5, emptyShelf5, keepTake5, removeRecording5, renudge5, sameSpot5, stampTakes5, useShelved5, useTake5 } from "./audioclips";
import { removeTrack, splitClips } from "./edit";
import type { AudioClip, AudioTrack, Take5, TimelineSong } from "./model";
import { audioClip, audioTrack, chordsClip, chordsTrack, counter, songOf, take } from "./testsongs";

const vocal = (s: TimelineSong, id = "tv") => s.tracks.find((t) => t.id === id) as AudioTrack;
const clipsOn = (s: TimelineSong, id = "tv") => s.clips.filter((c): c is AudioClip => c.kind === "audio" && c.track === id).sort((a, b) => a.start - b.start);

/** Three passes of one recording sung from beat 8 (two seconds each; the last stopped early), and one of a later recording sung from the same beat. */
const p1 = take("p1", 2, 8, { group: "g1", n: 1 });
const p2 = take("p2", 2, 8, { group: "g1", n: 2, keep: true });
const p3 = take("p3", 0.5, 8, { group: "g1", n: 3, short: true });
const q1 = take("q1", 2, 8, { group: "g2", n: 1 });
/** and one sung somewhere else */
const far = take("far", 2, 24, { group: "g3", n: 1 });
const song = (clips: AudioClip[], takes: Take5[] = [p1, p2, p3, q1, far]): TimelineSong =>
  songOf([chordsTrack("tc"), audioTrack("tv", "vocals", "Vocal 1", takes), audioTrack("tx", "audio", "Audio 1", [])], { bpm: 120, clips: [chordsClip("c1", "tc", 0, 16), ...clips] });

describe("which takes are alternatives of each other", () => {
  it("the passes of one recording are", () => {
    expect(sameSpot5(p1, p3)).toBe(true);
    // also when they lie nowhere (their clip was undone)
    expect(sameSpot5({ ...p1, at: null }, { ...p2, at: null })).toBe(true);
  });
  it("two recordings sung from the same beat at the same rate are", () => {
    expect(sameSpot5(p1, q1)).toBe(true);
    expect(sameSpot5(p1, { ...q1, rate: 44100 })).toBe(false);
  });
  it("recordings from different bars are not, and two that lie nowhere are not either", () => {
    expect(sameSpot5(p1, far)).toBe(false);
    expect(sameSpot5({ ...p1, at: null }, { ...q1, at: null })).toBe(false);
  });
});

describe("use a take", () => {
  it("every clip of that spot plays it, as it was edited; clips of other spots stay", () => {
    // the recording's clip was split in two, and another recording plays further on
    const cut = splitClips(song([audioClip("a1", "tv", p1, 8), audioClip("a2", "tv", far, 24)]), ["a1"], 10, counter("s"));
    const out = useTake5(cut, "tv", "q1", 0, counter());
    expect(clipsOn(out).map((c) => [c.id, c.take, c.start, c.off, c.frames])).toEqual([
      ["a1", "q1", 8, 0, 48000],
      ["s1", "q1", 10, 48000, 48000],
      ["a2", "far", 24, 0, 96000],
    ]);
    // the takes themselves are not touched
    expect(vocal(out).takes).toBe(vocal(cut).takes);
    // asked for again, nothing changes
    expect(useTake5(out, "tv", "q1", 0, counter())).toBe(out);
  });

  it("a shorter pass has less in it: the clip is cut to what it holds, and one that lay past it goes", () => {
    const cut = splitClips(song([audioClip("a1", "tv", p1, 8)]), ["a1"], 10, counter("s"));
    const out = useTake5(cut, "tv", "p3", 0, counter());
    // half a second of take: the first piece keeps that much; the second lay wholly after it
    expect(clipsOn(out).map((c) => [c.id, c.take, c.to, c.off, c.frames])).toEqual([["a1", "p3", 24000, 0, 24000]]);
    // and back to a full pass: the clip shows the whole of it again
    const back = useTake5(out, "tv", "p2", 0, counter());
    expect(clipsOn(back).map((c) => [c.take, c.to, c.frames])).toEqual([["p2", 96000, 24000]]);
  });

  it("with nothing of its spot on the lane, the whole take comes back where it was sung", () => {
    const out = useTake5(song([audioClip("a2", "tv", far, 24)]), "tv", "p2", 3, counter());
    expect(clipsOn(out).map((c) => [c.id, c.take, c.start, c.frames])).toEqual([["n1", "p2", 8, 96000], ["a2", "far", 24, 96000]]);
  });

  it("a take that lies nowhere is laid at the beat given, and its recording lies there from then on", () => {
    const loose = [p1, p2, p3].map((k) => ({ ...k, at: null }));
    const before = song([audioClip("a2", "tv", far, 24)], [...loose, far]);
    const out = useTake5(before, "tv", "p1", 12, counter());
    expect(clipsOn(out).map((c) => [c.id, c.take, c.start])).toEqual([["n1", "p1", 12], ["a2", "far", 24]]);
    expect(vocal(out).takes.map((k) => [k.id, k.at])).toEqual([["p1", 12], ["p2", 12], ["p3", 12], ["far", 24]]);
    // the other passes are now a choice in the same place
    const other = useTake5(out, "tv", "p2", 99, counter("m"));
    expect(clipsOn(other).map((c) => [c.id, c.take, c.start])).toEqual([["n1", "p2", 12], ["a2", "far", 24]]);
  });

  it("the clip that is laid trims what it covers", () => {
    // `far` plays from beat 24; a take that lies nowhere is laid at 26, inside it
    const loose = { ...q1, at: null };
    const out = useTake5(song([audioClip("a2", "tv", far, 24)], [loose, far]), "tv", "q1", 26, counter());
    expect(clipsOn(out).map((c) => [c.id, c.take, c.start, c.frames])).toEqual([["a2", "far", 24, 48000], ["n1", "q1", 26, 96000]]);
  });

  it("changes nothing for a take or a track that is not there", () => {
    const s = song([audioClip("a1", "tv", p1, 8)]);
    expect(useTake5(s, "tv", "nope", 0, counter())).toBe(s);
    expect(useTake5(s, "tc", "p1", 0, counter())).toBe(s);
  });
});

describe("keep a take ★", () => {
  it("marks it and takes the mark off again, and leaves everything else as it was", () => {
    const s = song([audioClip("a1", "tv", p1, 8)]);
    const on = keepTake5(s, "tv", "p1", true);
    expect(vocal(on).takes.map((k) => !!k.keep)).toEqual([true, true, false, false, false]);
    expect(on.clips).toBe(s.clips);
    const off = keepTake5(on, "tv", "p1", false);
    expect(vocal(off).takes[0]).toEqual(p1);
    expect("keep" in vocal(off).takes[0]).toBe(false);
    expect(keepTake5(s, "tv", "p2", true)).toBe(s);
  });
});

describe("delete a take", () => {
  it("what played it plays the next best take of its recording: the last ★, else the last full pass", () => {
    const s = song([audioClip("a1", "tv", p1, 8), audioClip("a2", "tv", far, 24)]);
    const out = dropTake5(s, "tv", "p1");
    expect(vocal(out).takes.map((k) => k.id)).toEqual(["p2", "p3", "q1", "far"]);
    expect(clipsOn(out).map((c) => [c.id, c.take, c.start])).toEqual([["a1", "p2", 8], ["a2", "far", 24]]);
    // with the ★ gone too: the last full pass, never the short one while a full one is left
    const three: Take5[] = [p1, take("p2b", 2, 8, { group: "g1", n: 2 }), p3];
    const next = dropTake5(song([audioClip("a1", "tv", p1, 8)], three), "tv", "p1");
    expect(clipsOn(next).map((c) => c.take)).toEqual(["p2b"]);
  });

  it("a take that no clip plays just leaves the list", () => {
    const s = song([audioClip("a1", "tv", p1, 8)]);
    const out = dropTake5(s, "tv", "p3");
    expect(vocal(out).takes.map((k) => k.id)).toEqual(["p1", "p2", "q1", "far"]);
    expect(out.clips).toBe(s.clips);
  });

  it("never leaves a clip without a take: the last take of a recording takes its clips with it", () => {
    const s = song([audioClip("a1", "tv", p1, 8), audioClip("a2", "tv", far, 24)]);
    const out = dropTake5(s, "tv", "far");
    expect(clipsOn(out).map((c) => c.id)).toEqual(["a1"]);
    // every clip that is left has its take
    for (const c of clipsOn(out)) expect(vocal(out).takes.some((k) => k.id === c.take)).toBe(true);
    // one by one down to nothing
    let all = s;
    for (const id of ["p1", "p2", "p3", "q1", "far"]) {
      all = dropTake5(all, "tv", id);
      for (const c of clipsOn(all)) expect(vocal(all).takes.some((k) => k.id === c.take)).toBe(true);
    }
    expect(vocal(all).takes).toEqual([]);
    expect(clipsOn(all)).toEqual([]);
    expect(all.clips.map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("remove a recording", () => {
  it("removes its takes and the clips that play them, and nothing else", () => {
    const s = song([audioClip("a1", "tv", p2, 8), audioClip("a2", "tv", far, 24)]);
    const out = removeRecording5(s, "tv", "g1");
    expect(vocal(out).takes.map((k) => k.id)).toEqual(["q1", "far"]);
    expect(out.clips.map((c) => c.id)).toEqual(["c1", "a2"]);
    expect(out.tracks[0]).toBe(s.tracks[0]);
    // (the recording sung from the same beat stays: it is another recording)
    expect(removeRecording5(s, "tv", "nope")).toBe(s);
  });

  it("only on the track asked for: a copy of the take on another track stays there", () => {
    const s = song([audioClip("a1", "tv", p2, 8)]);
    const two: TimelineSong = { ...s, tracks: s.tracks.map((t) => (t.id === "tx" ? { ...(t as AudioTrack), takes: [p2] } : t)), clips: [...s.clips, audioClip("x1", "tx", p2, 8)] };
    const out = removeRecording5(two, "tv", "g1");
    expect(vocal(out, "tx").takes.map((k) => k.id)).toEqual(["p2"]);
    expect(out.clips.map((c) => c.id)).toEqual(["c1", "x1"]);
  });
});

describe("the shelf of removed recordings", () => {
  it("use: the take's whole recording comes onto the track, and the take is laid at the beat given", () => {
    const removed = removeTrack(song([audioClip("a1", "tv", p2, 8)]), "tv");
    expect(removed.shelf?.[0].takes).toHaveLength(5);
    const out = useShelved5(removed, "tx", "p3", 16, counter());
    expect(vocal(out, "tx").takes.map((k) => [k.id, k.at])).toEqual([["p1", 16], ["p2", 16], ["p3", 16]]);
    expect(clipsOn(out, "tx").map((c) => [c.id, c.take, c.start])).toEqual([["n1", "p3", 16]]);
    // the rest of that track's takes are still on the shelf
    expect(out.shelf?.[0].takes.map((k) => k.id)).toEqual(["q1", "far"]);
    // the last of them empties the shelf
    const all = useShelved5(useShelved5(out, "tx", "q1", 0, counter("m")), "tx", "far", 40, counter("o"));
    expect(all.shelf).toBeUndefined();
    expect(vocal(all, "tx").takes).toHaveLength(5);
  });

  it("empty: the removed recordings leave the song", () => {
    const removed = removeTrack(song([audioClip("a1", "tv", p2, 8)]), "tv");
    const out = emptyShelf5(removed);
    expect("shelf" in out).toBe(false);
    expect(out.tracks).toBe(removed.tracks);
    expect(emptyShelf5(out)).toBe(out);
  });
});

describe("the timing nudge", () => {
  // a nudge of 10 ms is 480 frames at 48,000
  const cut = (id: string, nudge: number | undefined, o: Partial<Take5> = {}): Take5 => ({ ...take(id, 2, 8, { start: 50000 }), ...(nudge === undefined ? {} : { nudge }), ...o });

  it("moves every take of every track that records, and the shelf, from its own nudge to the new one", () => {
    const a = audioTrack("tv", "vocals", "Vocal 1", [cut("a", 0), cut("b", 480)]);
    const b = audioTrack("tx", "audio", "Audio 1", [cut("c", -240)]);
    const s = songOf([chordsTrack("tc"), a, b], { clips: [audioClip("a1", "tv", a.takes[0], 8)], shelf: [{ track: "gone", name: "Vocal 2", kind: "vocals", takes: [cut("d", 0)], at: 3, saves: 0 }] });
    const out = renudge5(s, 10);
    expect(vocal(out).takes.map((k) => [k.start, k.nudge])).toEqual([[50480, 480], [50000, 480]]);
    expect(vocal(out, "tx").takes.map((k) => [k.start, k.nudge])).toEqual([[50720, 480]]);
    expect(out.shelf?.[0].takes.map((k) => [k.start, k.nudge])).toEqual([[50480, 480]]);
    // a take that was already there is the same object; clips and other tracks are not touched
    expect(vocal(out).takes[1]).toBe(a.takes[1]);
    expect(out.clips).toBe(s.clips);
    expect(out.tracks[0]).toBe(s.tracks[0]);
  });

  it("gives the same song back when nothing moves", () => {
    const s = songOf([audioTrack("tv", "vocals", "Vocal 1", [cut("a", 480), cut("b", 480)])], { shelf: [{ track: "gone", name: "Vocal 2", kind: "vocals", takes: [cut("d", 480)], at: 1, saves: 0 }] });
    expect(renudge5(s, 10)).toBe(s);
    const none = songOf([chordsTrack("tc")]);
    expect(renudge5(none, 10)).toBe(none);
  });

  it("a take that does not say its nudge stays, unless the nudge before is given", () => {
    const s = songOf([audioTrack("tv", "vocals", "Vocal 1", [cut("old", undefined)])]);
    expect(renudge5(s, 10)).toBe(s);
    const moved = renudge5(s, 10, 0);
    expect(vocal(moved).takes.map((k) => [k.start, k.nudge])).toEqual([[50480, 480]]);
    // and there and back leaves it where it was
    expect(vocal(renudge5(moved, 0)).takes[0].start).toBe(50000);
  });

  it("takes that do not say their nudge can be marked as cut with one, without moving; then they move like the others", () => {
    const s = songOf([audioTrack("tv", "vocals", "Vocal 1", [cut("old", undefined), cut("new", 480)])], { shelf: [{ track: "gone", name: "Vocal 2", kind: "vocals", takes: [cut("d", undefined, { rate: 96000 })], at: 1, saves: 0 }] });
    const marked = stampTakes5(s, 5);
    expect(vocal(marked).takes.map((k) => [k.start, k.nudge])).toEqual([[50000, 240], [50000, 480]]);
    expect(marked.shelf?.[0].takes.map((k) => [k.start, k.nudge])).toEqual([[50000, 480]]);
    // one that said so already is the same object, and a second marking changes nothing
    expect(vocal(marked).takes[1]).toBe(vocal(s).takes[1]);
    expect(stampTakes5(marked, 99)).toBe(marked);
    // now the nudge goes from 5 to 10 ms: the old take moves by the 5 ms between
    expect(vocal(renudge5(marked, 10)).takes.map((k) => [k.start, k.nudge])).toEqual([[50240, 480], [50000, 480]]);
  });

  it("a take recorded at another rate moves by the same time", () => {
    const s = songOf([audioTrack("tv", "vocals", "Vocal 1", [cut("a", 0, { rate: 96000 })])]);
    expect(vocal(renudge5(s, 10)).takes.map((k) => [k.start, k.nudge])).toEqual([[50960, 960]]);
  });
});
