// Where a song of tracks and clips is cut into stretches for the player.
import { describe, expect, it } from "vitest";
import { emptyRows, type Groove } from "../audio/beats";
import { cutPoints, stretches } from "./cuts";
import type { DrumsClip, TimelineSong } from "./model";
import { SIG44, bandSong, chordsClip, chordsContent, chordsTrack, drumsClip, drumsTrack, groove, melodyClip, mixedSong, songOf, tune, tuneTrack } from "./testsongs";

/** a one-bar 4/4 rhythm on a grid of so many steps to the beat, with a swing */
const grid = (div: number, swing = 0): Groove => {
  const steps = 4 * div;
  const rows = emptyRows(steps);
  rows.kick = Array.from({ length: steps }, (_, i) => (i % div === 0 ? "2" : "0")).join("");
  return { patternId: null, name: `${div}`, edited: true, steps, div, bars: 1, swing, rows };
};
/** chords over the whole song on a lead track, so nothing is cut just because nothing crosses */
const under = (beats: number, extra: TimelineSong["tracks"], clips: TimelineSong["clips"], o: Partial<TimelineSong> = {}): TimelineSong =>
  songOf([chordsTrack("tc", "Chords", { lead: true }), ...extra], { clips: [chordsClip("long", "tc", 0, beats), ...clips], ...o });
const d = (id: string, start: number, len: number, content: Groove, track = "td"): DrumsClip => drumsClip(id, track, start, len, { content });

describe("cutPoints", () => {
  it("the first cut is the song's start, the cuts are in order, and the song's end is not one", () => {
    expect(cutPoints(songOf([]))).toEqual([0]);
    const cuts = cutPoints(bandSong());
    expect(cuts[0]).toBe(0);
    expect([...cuts].sort((a, b) => a - b)).toEqual(cuts);
    expect(cuts).not.toContain(64);
    // the same list back for the same song
    const s = bandSong();
    expect(cutPoints(s)).toBe(cutPoints(s));
  });

  it("rule 1: there is a cut where the time signature changes, also under a clip that lies across the change", () => {
    expect(cutPoints(mixedSong())).toEqual([0, 32, 40]);
    const across: TimelineSong = { ...mixedSong(), clips: [chordsClip("all", "tc", 0, 56)] };
    expect(cutPoints(across)).toEqual([0, 32, 40]);
    expect(stretches(across).map((x) => [x.from, x.to, x.bar, x.bars])).toEqual([[0, 32, 4, 8], [32, 40, 2, 4], [40, 56, 4, 4]]);
  });

  it("rule 2: there is a cut at every bar line no unmuted note clip crosses, and at no other", () => {
    // chords and bass over bars 1–8, chords and melody over bars 9–16: one line that nothing crosses
    expect(cutPoints(bandSong())).toEqual([0, 32]);
    // an audio clip across a line does not hold it together (the band's recording lies across bars 9 to 12)
    const onlyVoice: TimelineSong = { ...bandSong(), clips: bandSong().clips.filter((c) => c.kind === "audio") };
    expect(cutPoints(onlyVoice)).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60]);
    // a muted clip does not either
    const muted = songOf([chordsTrack("tc", "Chords", { lead: true })], { clips: [chordsClip("c", "tc", 0, 16, { mute: true })] });
    expect(cutPoints(muted)).toEqual([0, 4, 8, 12]);
    // an empty song that is kept 4 bars long: a cut at every bar
    expect(cutPoints(songOf([], { end: 16 }))).toEqual([0, 4, 8, 12]);
    // a clip that ends on a line does not cross it
    const two = songOf([chordsTrack("tc", "Chords", { lead: true }), tuneTrack("tm")], { clips: [chordsClip("a", "tc", 0, 8), chordsClip("b", "tc", 8, 8), melodyClip("m", "tm", 4, 8)] });
    expect(cutPoints(two)).toEqual([0]);
    expect(cutPoints({ ...two, clips: two.clips.filter((c) => c.id !== "m") })).toEqual([0, 8]);
  });

  it("rule 3: a drums track's rhythm on another grid, or with another swing, starts a new stretch", () => {
    const tracks = [drumsTrack("td", "Drums")];
    // sixteenths, then triplets, bar after bar
    expect(cutPoints(under(16, tracks, [d("a", 0, 8, grid(4)), d("b", 8, 8, grid(3))]))).toEqual([0, 8]);
    // the same grid with another swing
    expect(cutPoints(under(16, tracks, [d("a", 0, 8, grid(4)), d("b", 8, 8, grid(4, 0.5))]))).toEqual([0, 8]);
    // with silence between the two: the cut is where the second starts
    expect(cutPoints(under(16, tracks, [d("a", 0, 4, grid(4)), d("b", 12, 4, grid(3))]))).toEqual([0, 12]);
    // a swing on a grid of triplets is not heard, so it makes no cut
    expect(cutPoints(under(16, tracks, [d("a", 0, 8, grid(3)), d("b", 8, 8, grid(3, 0.5))]))).toEqual([0]);
    // two drums tracks on different grids at once are no reason to cut: each has its own
    expect(cutPoints(under(16, [...tracks, drumsTrack("te", "Drums 2")], [d("a", 0, 16, grid(4)), d("b", 0, 16, grid(3), "te")]))).toEqual([0]);
  });

  it("drums clips of one rhythm stamped bar after bar force no cut", () => {
    const stamped = Array.from({ length: 8 }, (_, i) => d(`s${i}`, i * 4, 4, groove(1, SIG44)));
    expect(cutPoints(under(32, [drumsTrack("td", "Drums", { lead: true })], stamped))).toEqual([0]);
  });

  it("rule 4: a cut where the swing or the triplet grid the lead drums give the others changes", () => {
    const lead = [drumsTrack("td", "Drums", { lead: true })];
    // the lead drums come in with a swing at bar 3
    expect(cutPoints(under(16, lead, [d("a", 8, 8, grid(4, 0.5))]))).toEqual([0, 8]);
    // … and go out again
    expect(cutPoints(under(24, lead, [d("a", 8, 8, grid(4, 0.5))]))).toEqual([0, 8, 16]);
    // a triplet grid does the same
    expect(cutPoints(under(16, lead, [d("a", 8, 8, grid(3))]))).toEqual([0, 8]);
    // straight sixteenths coming in change nothing the others follow
    expect(cutPoints(under(16, lead, [d("a", 8, 8, grid(4))]))).toEqual([0]);
    // a drums track that does not lead is not followed
    expect(cutPoints(under(16, [drumsTrack("td", "Drums")], [d("a", 8, 8, grid(4, 0.5))]))).toEqual([0]);
  });

  it("rule 5: no stretch is longer than 32 bars; it is cut at the line of those 32 the fewest clips cross, the latest on a tie", () => {
    // one clip of 40 bars: every line is crossed once, so the last of the 32 is taken
    const long = songOf([chordsTrack("tc", "Chords", { lead: true })], { clips: [chordsClip("c", "tc", 0, 160, { content: chordsContent(8) })] });
    expect(cutPoints(long)).toEqual([0, 128]);
    expect(stretches(long).map((x) => x.bars)).toEqual([32, 8]);
    // a melody under it with a gap of one bar: the two lines of the gap are crossed by fewer, and the later one is taken
    const gap: TimelineSong = { ...long, tracks: [...long.tracks, tuneTrack("tm")], clips: [...long.clips, melodyClip("m1", "tm", 0, 120, { content: tune(8) }), melodyClip("m2", "tm", 124, 36, { content: tune(8) })] };
    expect(cutPoints(gap)).toEqual([0, 124]);
    // 70 bars under one clip: two forced cuts
    const longer = songOf([chordsTrack("tc", "Chords", { lead: true })], { clips: [chordsClip("c", "tc", 0, 280, { content: chordsContent(8) })] });
    expect(cutPoints(longer)).toEqual([0, 128, 256]);
  });
});
