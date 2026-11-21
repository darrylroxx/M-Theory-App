import { describe, expect, it } from "vitest";
import {
  CLIP_OF, SONG_V, accepts, beatsToFrames, clipBeats, clipEnd, contentBeats, contentFrames, cycles, frameCycles, framesToBeats, mod, notches, phase, rateOf, zeroBeat,
  type ClipKind, type DrumsClip, type NoteClip, type TrackKind,
} from "./model";
import { SIG34, SIG68, audioClip, audioTrack, chordsClip, drumsClip, drumsTrack, melodyClip, songOf, take } from "./testsongs";

const TRACKS: TrackKind[] = ["chords", "melody", "bass", "drums", "vocals", "audio"];
const CLIPS: ClipKind[] = ["chords", "melody", "drums", "audio"];

describe("the track view's song model", () => {
  it("is stored as version 5", () => {
    expect(SONG_V).toBe(5);
  });

  it("which clip may lie on which track: all 24 pairs", () => {
    // rows: the kind of track; columns: chords, melody, drums, audio
    const table: Record<TrackKind, [boolean, boolean, boolean, boolean]> = {
      chords: [true, false, false, false],
      melody: [false, true, false, false],
      bass: [false, true, false, false],
      drums: [false, false, true, false],
      vocals: [false, false, false, true],
      audio: [false, false, false, true],
    };
    let pairs = 0;
    for (const t of TRACKS) {
      CLIPS.forEach((c, i) => {
        expect(accepts(t, c), `${c} clip on a ${t} track`).toBe(table[t][i]);
        pairs++;
      });
    }
    expect(pairs).toBe(24);
  });

  it("a melody clip lies on a bass track, an audio clip on a vocals track, and a drums clip not on a chords track", () => {
    expect(accepts("bass", "melody")).toBe(true);
    expect(accepts("vocals", "audio")).toBe(true);
    expect(accepts("chords", "drums")).toBe(false);
  });

  it("every kind of track takes exactly one kind of clip: the one it makes", () => {
    for (const t of TRACKS) {
      expect(CLIPS.filter((c) => accepts(t, c))).toEqual([CLIP_OF[t]]);
    }
  });
});

describe("how long a clip is, and how its content comes round again", () => {
  /** the worked example of the spec (A.3): a drums clip in 4/4 with a 4-bar rhythm, at bar 5 */
  const example = () => {
    const clip = drumsClip("d", "td", 16, 16);
    return { clip, song: songOf([drumsTrack("td")], { clips: [clip] }) };
  };
  // the window rule, as the spec states it: an edge drag only moves that edge of the window
  const rightTo = <C extends NoteClip>(c: C, e: number): C => ({ ...c, len: e - c.start });
  const leftTo = <C extends NoteClip>(c: C, s: number): C => ({ ...c, off: mod(c.off + (s - c.start), contentBeats(c)), len: c.len - (s - c.start), start: s });

  it("one round of the content: bars times the beats in a bar of the clip's own signature", () => {
    expect(contentBeats(example().clip)).toBe(16);
    expect(contentBeats(chordsClip("c", "tc", 0, 12, { sig: SIG34 }))).toBe(12);
    expect(contentBeats(drumsClip("d", "td", 0, 8, { sig: SIG68, bars: 2 }))).toBe(4);
    // a rhythm saved with no `bars` is one bar long
    const one = drumsClip("d", "td", 0, 8, { bars: 1 });
    expect(contentBeats({ ...one, content: { ...one.content, bars: undefined } })).toBe(4);
  });

  it("the worked example, step 1: the right edge from bar 9 to bar 15 plays the rhythm twice, then its first two bars", () => {
    const { clip: first, song } = example();
    const clip: DrumsClip = rightTo(first, 56);
    expect(clip).toMatchObject({ start: 16, len: 40, off: 0 });
    expect(cycles(clip)).toEqual([{ at: 0, from: 0, to: 16 }, { at: 16, from: 0, to: 16 }, { at: 32, from: 0, to: 8 }]);
    // notches at bars 9 and 13
    expect(notches(clip, song)).toEqual([32, 48]);
  });

  it("the worked example, step 2: the left edge two bars earlier opens with bars 3 and 4 of the rhythm, and the rhythm still starts where it did", () => {
    const { clip: first, song } = example();
    const longer = rightTo(first, 56);
    const clip = leftTo(longer, 8);
    expect(clip).toMatchObject({ off: 8, len: 48, start: 8 });
    expect(cycles(clip)[0]).toEqual({ at: 0, from: 8, to: 16 });
    expect(notches(clip, song)[0]).toBe(16);
    expect(notches(clip, song)).toEqual([16, 32, 48]);
    // what was heard at a beat before the drag is heard there after it
    for (const x of [16, 21, 32, 47, 55]) expect(phase(clip, x)).toBe(phase(longer, x));
  });

  it("which point of the content sounds at a beat, also before the clip's start (a negative distance)", () => {
    const { clip } = example();
    expect(phase(clip, 16)).toBe(0);
    expect(phase(clip, 21)).toBe(5);
    expect(phase(clip, 33)).toBe(1);
    expect(phase(clip, 13)).toBe(13);
    expect(phase(clip, -3)).toBe(13);
    expect(phase({ ...clip, off: 6 }, 10)).toBe(0);
    expect(mod(-1, 16)).toBe(15);
    expect(mod(32, 16)).toBe(0);
  });

  it("a clip no longer than its content has one cycle and no notch; one that starts inside it has its first notch where the content starts again", () => {
    const { clip, song } = example();
    expect(cycles(clip)).toEqual([{ at: 0, from: 0, to: 16 }]);
    expect(notches(clip, song)).toEqual([]);
    const late = { ...clip, off: 12, len: 12 };
    expect(cycles(late)).toEqual([{ at: 0, from: 12, to: 16 }, { at: 4, from: 0, to: 8 }]);
    expect(notches(late, song)).toEqual([20]);
    // a clip that ends exactly where the content does has no notch on its edge
    expect(notches({ ...clip, len: 32 }, song)).toEqual([32]);
  });

  it("a note clip is as long as it says, at any tempo; an audio clip's length in beats follows the tempo", () => {
    expect(clipBeats(melodyClip("m", "tm", 0, 8), 60)).toBe(8);
    expect(clipBeats(melodyClip("m", "tm", 0, 8), 180)).toBe(8);
    const sung = take("k", 5);
    const clip = audioClip("a", "tv", sung, 8);
    // five seconds: five beats at 60, ten at 120, eight at 96
    expect(clipBeats(clip, 60, 48000)).toBeCloseTo(5, 9);
    expect(clipBeats(clip, 120, 48000)).toBeCloseTo(10, 9);
    expect(clipBeats(clip, 96, 48000)).toBeCloseTo(8, 9);
    // the same frames at half the rate last twice as long
    expect(clipBeats(clip, 60, 24000)).toBeCloseTo(10, 9);
    const song = songOf([audioTrack("tv", "vocals", "Vocal 1", [sung])], { clips: [clip] });
    expect(clipEnd(clip, song)).toBeCloseTo(16, 9);
    expect(clipEnd(clip, { ...song, bpm: 120 })).toBeCloseTo(18, 9);
    expect(rateOf(song, clip)).toBe(48000);
    // a take that cannot be found is read at 48,000
    expect(rateOf(song, { ...clip, take: "gone" })).toBe(48000);
  });

  it("frames and beats turn into each other at a tempo", () => {
    expect(framesToBeats(48000, 48000, 60)).toBe(1);
    expect(framesToBeats(48000, 48000, 120)).toBe(2);
    expect(beatsToFrames(2, 48000, 120)).toBe(48000);
    expect(beatsToFrames(framesToBeats(12345, 44100, 97), 44100, 97)).toBeCloseTo(12345, 6);
  });

  it("an audio clip's content is a stretch of its take, and comes round again past its end, with a notch", () => {
    const sung = take("k", 2);
    const whole = audioClip("a", "tv", sung, 4);
    expect(contentFrames(whole)).toBe(96000);
    expect(frameCycles(whole)).toEqual([{ at: 0, from: 0, to: 96000 }]);
    // shown from one second in, for three seconds: the last second, the whole take, nothing more
    const round = { ...whole, off: 48000, frames: 144000 };
    expect(frameCycles(round)).toEqual([{ at: 0, from: 48000, to: 96000 }, { at: 48000, from: 0, to: 96000 }]);
    const song = songOf([audioTrack("tv", "vocals", "Vocal 1", [sung])], { bpm: 60, clips: [round] });
    expect(notches(round, song)).toEqual([5]);
    expect(notches(whole, song)).toEqual([]);
  });

  it("the beat an audio clip's take starts on: the same for both halves of a cut, whatever the tempo says the clip's own start is", () => {
    const sung = take("k", 10);
    const left = audioClip("a", "tv", sung, 16, { frames: 100000 });
    const right = audioClip("b", "tv", sung, 16 + framesToBeats(100000, 48000, 96), { off: 100000, frames: 380000 });
    expect(zeroBeat(left, 96, 48000)).toBe(16);
    expect(zeroBeat(right, 96, 48000)).toBe(16);
  });
});
