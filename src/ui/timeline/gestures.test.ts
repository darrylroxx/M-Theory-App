import { describe, expect, it } from "vitest";
import { barMap } from "../../timeline/bars";
import { resizeClip } from "../../timeline/edit";
import { bandSong, chordsClip, chordsTrack, drumsClip, drumsTrack, mixedSong, songOf } from "../../timeline/testsongs";
import {
  MAX_PX, MIN_PX, barEvery, barRegion, barsLabel, barsText, beatOfX, boxHits, clipUnder, dragRegion, edgeTo, fitView, inView, laneAt, lengthText, markerRegion,
  mergeRegions, moveBy, pageFor, positionText, reach, roomAt, snap, snapMode, xOfBeat, zoomAbout, type View,
} from "./gestures";

const clipOf = (song: ReturnType<typeof bandSong>, id: string) => song.clips.find((c) => c.id === id)!;

describe("beats and pixels", () => {
  const v: View = { pxPerBeat: 10, scroll: 8 };
  it("go there and back", () => {
    expect(xOfBeat(v, 8)).toBe(0);
    expect(xOfBeat(v, 20)).toBe(120);
    expect(beatOfX(v, 120)).toBe(20);
  });

  it("zoom keeps the beat under the pointer where it is", () => {
    const at = 300;
    const far: View = { pxPerBeat: 10, scroll: 80 };
    const beat = beatOfX(far, at);
    for (const f of [1.25, 2, 0.5, 0.8]) {
      const z = zoomAbout(far, f, at);
      expect(z.pxPerBeat).toBeCloseTo(far.pxPerBeat * f);
      expect(beatOfX(z, at)).toBeCloseTo(beat);
    }
  });

  it("zoom stays between 2 and 320 pixels a beat", () => {
    expect(zoomAbout(v, 1000, 100).pxPerBeat).toBe(MAX_PX);
    expect(zoomAbout(v, 0.0001, 100).pxPerBeat).toBe(MIN_PX);
    expect(MIN_PX).toBe(2);
    expect(MAX_PX).toBe(320);
    // zooming out at the song's start never shows time before it
    expect(zoomAbout({ pxPerBeat: 10, scroll: 0 }, 0.5, 400).scroll).toBe(0);
  });

  it("fit shows the whole song, and an empty song as 16 bars", () => {
    const empty = fitView(0, 1020, 4);
    expect(empty.scroll).toBe(0);
    expect(1020 / empty.pxPerBeat).toBeCloseTo(64);
    const long = fitView(88, 1020, 4);
    expect(88 * long.pxPerBeat).toBeCloseTo(1020);
    // a short song still shows 16 bars
    expect(1020 / fitView(16, 1020, 4).pxPerBeat).toBeCloseTo(64);
    // a very long one is as narrow as beats get, no narrower
    expect(fitView(10000, 1020, 4).pxPerBeat).toBe(MIN_PX);
  });

  it("the lanes reach a screen past the end, and never fewer than 32 bars", () => {
    const song = bandSong();
    expect(reach(song, { pxPerBeat: 10, scroll: 0 }, 1000)).toBe(64 + 100);
    expect(reach(songOf([chordsTrack("tc")]), { pxPerBeat: 20, scroll: 0 }, 1000)).toBe(128);
    // scrolled far out, they reach what is on screen
    expect(reach(song, { pxPerBeat: 10, scroll: 500 }, 1000)).toBe(600);
  });
});

describe("snapping", () => {
  // 4/4 for 8 bars (beats 0–32), 6/8 for 4 bars (two beats each, beats 32–40), then 4/4 again
  const map = barMap(mixedSong());
  it("to bars, on both sides of a change of signature", () => {
    expect(snap(map, 29.9, "bar")).toBe(28);
    expect(snap(map, 30.1, "bar")).toBe(32);
    expect(snap(map, 32.9, "bar")).toBe(32);
    expect(snap(map, 33.1, "bar")).toBe(34);
    expect(snap(map, 41.9, "bar")).toBe(40);
    expect(snap(map, 42.1, "bar")).toBe(44);
  });
  it("to beats, and not at all", () => {
    expect(snap(map, 33.4, "beat")).toBe(33);
    expect(snap(map, 33.6, "beat")).toBe(34);
    expect(snap(map, 33.4, "free")).toBe(33.4);
    expect(snap(map, -3, "free")).toBe(0);
    expect(snap(map, -3, "bar")).toBe(0);
  });
  it("Shift is beats and Alt is free", () => {
    expect(snapMode({})).toBe("bar");
    expect(snapMode({ shift: true })).toBe("beat");
    expect(snapMode({ alt: true })).toBe("free");
    expect(snapMode({ alt: true, shift: true })).toBe("free");
  });
});

describe("moving a clip", () => {
  const song = bandSong();
  it("a note clip's start goes to bar lines, or to beats with Shift", () => {
    const m = clipOf(song, "m1");
    expect(moveBy(song, m, 3.4)).toBe(4);
    expect(moveBy(song, m, 1.4)).toBe(0);
    expect(moveBy(song, m, 1.4, { shift: true })).toBe(1);
    expect(moveBy(song, m, -100)).toBe(-32);
  });
  it("a drums clip never goes to a beat", () => {
    const d = clipOf(song, "d1");
    expect(moveBy(song, d, 1.4, { shift: true })).toBe(0);
    expect(moveBy(song, d, 2.6, { shift: true })).toBe(4);
    expect(moveBy(song, d, 5)).toBe(4);
  });
  it("an audio clip moves by whole sixteenths, not to the bar line", () => {
    const a = clipOf(song, "a1");
    const d = moveBy(song, a, 0.3);
    expect(d).toBeCloseTo(0.25, 3);
    expect(moveBy(song, a, 1.13)).toBeCloseTo(1.25, 3);
    expect(moveBy(song, a, -0.6)).toBeCloseTo(-0.5, 3);
    // Shift or Alt: free
    expect(moveBy(song, a, 0.3, { shift: true })).toBeCloseTo(0.3, 3);
    expect(moveBy(song, a, 0.3, { alt: true })).toBeCloseTo(0.3, 3);
    // never before the song starts
    expect(moveBy(song, a, -500)).toBe(-32);
  });
  it("in 6/8 a sixteenth is a sixth of a beat", () => {
    const mixed = { ...mixedSong(), tracks: [...mixedSong().tracks, song.tracks[4]], clips: [...mixedSong().clips, { ...clipOf(song, "a1"), start: 32 }] };
    expect(moveBy(mixed, mixed.clips[mixed.clips.length - 1], 0.2)).toBeCloseTo(1 / 6, 3);
  });
});

describe("dragging an edge", () => {
  it("a note clip's edge goes to bar lines and to where its content starts again", () => {
    // a 4-bar rhythm at bars 5–8; a clip of a 3-beat tune would start again off the bar lines
    const song = bandSong();
    const d = clipOf(song, "d1");
    expect(edgeTo(song, d, "right", 55.2)).toBe(56);
    expect(edgeTo(song, d, "left", 8.9)).toBe(8);
    const odd = { ...songOf([chordsTrack("tc")]), clips: [chordsClip("c1", "tc", 0, 3, { content: { chords: [], bars: 1, style: "ring" as const }, sig: { num: 3, den: 4 } })] };
    // its content is 3 beats long in a song of 4/4: the edge takes the restart at beat 6 as well as the bar lines
    expect(edgeTo(odd, odd.clips[0], "right", 6.2)).toBe(6);
    expect(edgeTo(odd, odd.clips[0], "right", 7.7)).toBe(8);
    expect(edgeTo(odd, odd.clips[0], "right", 6.6, { shift: true })).toBe(7);
  });
  it("stops at the next clip, at the song's start, and at its shortest", () => {
    const song = bandSong();
    const c1 = clipOf(song, "c1");
    const c2 = clipOf(song, "c2");
    expect(edgeTo(song, c1, "right", 50)).toBe(32);
    expect(edgeTo(song, c2, "left", 10)).toBe(32);
    expect(edgeTo(song, c1, "left", -9)).toBe(0);
    expect(edgeTo(song, c1, "right", -9)).toBe(1);
    expect(edgeTo(song, c2, "left", 99, { shift: true })).toBe(63);
    // a drums clip: a bar line, and at least a bar
    const d = clipOf(song, "d1");
    expect(edgeTo(song, d, "right", 0)).toBe(20);
    expect(edgeTo(song, d, "left", 99)).toBe(28);
  });
  it("lands where the edit itself puts the edge", () => {
    const song = bandSong();
    for (const [id, edge, beat] of [["d1", "right", 57], ["d1", "left", 7.4], ["m1", "left", 13], ["c1", "right", 18.3]] as const) {
      const c = clipOf(song, id);
      const to = edgeTo(song, c, edge, beat);
      const after = resizeClip(song, id, edge, to).clips.find((x) => x.id === id)!;
      expect(edge === "left" ? after.start : after.start + (after as typeof d1).len).toBe(to);
    }
  });
  const d1 = drumsClip("x", "td", 0, 4);
  it("an audio edge is free, or on a beat with Shift, and stops at the take's neighbours", () => {
    const song = bandSong();
    const a = clipOf(song, "a1");
    expect(edgeTo(song, a, "right", 41.37)).toBe(41.37);
    expect(edgeTo(song, a, "right", 41.37, { shift: true })).toBe(41);
    expect(edgeTo(song, a, "left", -4)).toBe(0);
    expect(edgeTo(song, a, "right", 10)).toBeCloseTo(32 + (0.02 * 96) / 60);
  });
});

describe("what is on screen", () => {
  const song = bandSong();
  it("leaves out a clip two screens away, keeps one a screen away", () => {
    // a screen of 16 beats, starting at beat 0: clips up to beat 32 are kept
    const near = inView(song, { pxPerBeat: 10, scroll: 0 }, 160).map((c) => c.id);
    expect(near).toEqual(["c1", "b1", "d1"]);
    // scrolled to beat 64 with a 16-beat screen: only what reaches beat 48 or later
    expect(inView(song, { pxPerBeat: 10, scroll: 64 }, 160).map((c) => c.id)).toEqual(["c2", "m1"]);
    expect(inView(song, { pxPerBeat: 10, scroll: 96 }, 160)).toEqual([]);
  });
  it("finds the lane under a height", () => {
    const lanes = [{ track: "a", top: 0, bottom: 64 }, { track: "b", top: 64, bottom: 128 }];
    expect(laneAt(lanes, 0)).toBe("a");
    expect(laneAt(lanes, 63.9)).toBe("a");
    expect(laneAt(lanes, 64)).toBe("b");
    expect(laneAt(lanes, 128)).toBeNull();
    expect(laneAt(lanes, -1)).toBeNull();
  });
  it("a box selects the clips it touches on its tracks", () => {
    expect(boxHits(song, { from: 4, to: 44, tracks: ["tm", "tb"] })).toEqual(["m1", "b1"]);
    expect(boxHits(song, { from: 44, to: 4, tracks: ["tm", "tb"] })).toEqual(["m1", "b1"]);
    expect(boxHits(song, { from: 4, to: 30, tracks: ["tm", "tb"] })).toEqual(["b1"]);
    // a clip that only touches the box's edge is not in it
    expect(boxHits(song, { from: 0, to: 16, tracks: ["td"] })).toEqual([]);
    expect(boxHits(song, { from: 4, to: 44, tracks: [] })).toEqual([]);
  });
  it("finds the clip under a beat, and room for a new one", () => {
    expect(clipUnder(song, "td", 20)?.id).toBe("d1");
    expect(clipUnder(song, "td", 16)).toBeUndefined();
    expect(clipUnder(song, "td", 40)).toBeUndefined();
    // four bars from the bar line under the pointer
    expect(roomAt(song, "tm", 66, false)).toEqual({ from: 64, to: 80 });
    // shorter when another clip is in the way
    expect(roomAt(song, "tm", 25, false)).toEqual({ from: 24, to: 32 });
    expect(roomAt(song, "td", 9, true)).toEqual({ from: 8, to: 16 });
    // on a clip: no room
    expect(roomAt(song, "tm", 40, false)).toBeNull();
  });
});

describe("the loop's stretches", () => {
  it("are sorted, and those that touch or overlap become one", () => {
    expect(mergeRegions([{ from: 32, to: 48 }, { from: 0, to: 8 }, { from: 8, to: 16 }, { from: 40, to: 56 }])).toEqual([{ from: 0, to: 16 }, { from: 32, to: 56 }]);
    expect(mergeRegions([{ from: 4, to: 4 }, { from: 9, to: 5 }])).toEqual([]);
    expect(mergeRegions([{ from: 16, to: 24 }, { from: 0, to: 8 }])).toEqual([{ from: 0, to: 8 }, { from: 16, to: 24 }]);
  });
  it("a drag marks whole bars, or beats with Shift, and never nothing", () => {
    const map = barMap(bandSong());
    expect(dragRegion(map, 33, 47, "bar")).toEqual({ from: 32, to: 48 });
    expect(dragRegion(map, 47, 33, "bar")).toEqual({ from: 32, to: 48 });
    expect(dragRegion(map, 33, 33.5, "bar")).toEqual({ from: 32, to: 36 });
    expect(dragRegion(map, 33.2, 35.4, "beat")).toEqual({ from: 33, to: 35 });
    expect(dragRegion(map, 33.2, 33.3, "beat")).toEqual({ from: 33, to: 34 });
    expect(barRegion(map, 21)).toEqual({ from: 20, to: 24 });
  });
  it("a marker's stretch runs to the next marker, the last one's to the end", () => {
    const song = bandSong();
    expect(markerRegion(song.markers, "mk1", 64)).toEqual({ from: 0, to: 32 });
    expect(markerRegion(song.markers, "mk2", 64)).toEqual({ from: 32, to: 64 });
    expect(markerRegion(song.markers, "nope", 64)).toBeNull();
  });
});

describe("words and numbers", () => {
  const map = barMap(mixedSong());
  it("the position reads bar.beat and minutes:seconds", () => {
    expect(positionText(barMap(bandSong()), 16, 96)).toBe("5.1 · 0:10");
    expect(positionText(barMap(bandSong()), 0, 96)).toBe("1.1 · 0:00");
    expect(positionText(map, 35, 120)).toBe("10.2 · 0:17");
    expect(positionText(barMap(bandSong()), 200, 96)).toBe("51.1 · 2:05");
  });
  it("lengths and bars are said in plain words", () => {
    expect(barsText(barMap(bandSong()), 16, 56)).toBe("10 bars");
    expect(barsText(map, 16, 56)).toBe("12 bars");
    expect(barsText(map, 0, 4)).toBe("1 bar");
    expect(barsText(map, 0, 9)).toBe("2 bars + 1 beat");
    expect(barsText(map, 1, 3)).toBe("2 beats");
    // bars of different lengths are counted as bars
    expect(barsText(map, 28, 44)).toBe("6 bars");
    expect(barsLabel(map, 16, 32)).toBe("bars 5–8");
    expect(barsLabel(map, 32, 34)).toBe("bar 9");
    const song = bandSong();
    expect(lengthText(song, clipOf(song, "d1"))).toBe("4 bars");
    expect(lengthText(song, clipOf(song, "a1"))).toBe("8.00 s");
  });
  it("bar numbers thin out as bars get narrow", () => {
    expect([46, 30, 12, 6, 3].map(barEvery)).toEqual([1, 2, 4, 8, 16]);
  });
  it("Follow turns a whole screen when the play line leaves it", () => {
    const v: View = { pxPerBeat: 10, scroll: 0 };
    expect(pageFor(v, 320, 12)).toBeNull();
    expect(pageFor(v, 320, 33)).toBe(32);
    expect(pageFor({ pxPerBeat: 10, scroll: 64 }, 320, 5)).toBe(0);
  });
});

describe("drums on bar lines", () => {
  it("an edge next to another drums clip stops on a bar line", () => {
    const song = { ...songOf([drumsTrack("td")]), clips: [drumsClip("a", "td", 0, 8), drumsClip("b", "td", 16, 8)] };
    expect(edgeTo(song, song.clips[0], "right", 30)).toBe(16);
    expect(edgeTo(song, song.clips[1], "left", 2)).toBe(8);
  });
});
