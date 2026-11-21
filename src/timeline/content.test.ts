import { describe, expect, it } from "vitest";
import type { Groove } from "../audio/beats";
import type { Melody } from "../song/melody";
import { DRAFT_DRUM_BARS, blankDraft, contentBars, contentHas, needsFit, openOf, setOpenBars, stampOpen, withBars, writeOpen } from "./content";
import { addTrack, resizeClip, setDraft } from "./edit";
import type { ChordsContent, DrumsClip, DrumsTrack, MelodyClip, NoteClip, TimelineSong } from "./model";
import { SIG34, SIG44, SIG68, bandSong, chordsContent, counter, groove, mixedSong, tune } from "./testsongs";

const clip = <C extends NoteClip>(song: TimelineSong, id: string) => song.clips.find((c) => c.id === id) as C;

describe("what a composer has open", () => {
  it("a placed clip: its content, and one round of it on the song's line", () => {
    const band = bandSong();
    const o = openOf(band, { track: "td", clip: "d1" }, 0)!;
    expect(o.content).toBe(clip<DrumsClip>(band, "d1").content);
    expect(o.span).toEqual({ from: 16, to: 32 });
    expect(o.kind).toBe("drums");
    // a clip whose left edge lies inside its content: the first round that starts inside it
    const cut = { ...band, clips: band.clips.map((c) => (c.id === "d1" ? { ...c, off: 4, len: 28 } : c)) };
    expect(openOf(cut, { track: "td", clip: "d1" }, 0)!.span).toEqual({ from: 28, to: 44 });
  });

  it("a draft: what is being composed, lying from the anchor; an empty one of its kind when there is none yet", () => {
    const band = bandSong();
    const o = openOf(band, { track: "td" }, 8)!;
    expect(contentBars(o.content)).toBe(DRAFT_DRUM_BARS);
    expect(contentHas("drums", o.content)).toBe(false);
    expect(o.span).toEqual({ from: 8, to: 24 });
    // the very same empty content every time
    expect(openOf(band, { track: "td" }, 8)!.content).toBe(o.content);
    const g = groove(2);
    expect(openOf(setDraft(band, "td", g, SIG44), { track: "td" }, 4)).toMatchObject({ content: g, span: { from: 4, to: 12 } });
    // a draft started where the bars are in 6/8 is written in 6/8
    const six = openOf(mixedSong(), { track: "td" }, 32)!;
    expect(six.sig).toEqual(SIG68);
    expect((six.content as Groove).steps / (six.content as Groove).div).toBe(2);
  });

  it("nothing for a clip that is gone, a clip of another track, or a track that records", () => {
    const band = bandSong();
    expect(openOf(band, { track: "td", clip: "nope" }, 0)).toBeNull();
    expect(openOf(band, { track: "td", clip: "c1" }, 0)).toBeNull();
    expect(openOf(band, { track: "tv" }, 0)).toBeNull();
  });
});

describe("writing into what is open", () => {
  it("a draft is kept on its track; nothing else changes", () => {
    const band = bandSong();
    const g = groove(2);
    const out = writeOpen(band, { track: "td" }, g, 0);
    expect((out.tracks.find((t) => t.id === "td") as DrumsTrack).draft).toEqual({ content: g, sig: SIG44 });
    expect(out.clips).toBe(band.clips);
  });

  it("only the open clip changes: a separate copy of it stays as it was", () => {
    const band = setDraft(bandSong(), "td", groove(1), SIG44);
    const id = counter();
    const two = stampOpen(stampOpen(band, { track: "td" }, "td", 32, 0, id), { track: "td" }, "td", 48, 0, id);
    const changed = writeOpen(two, { track: "td", clip: "n2" }, groove(1, SIG44, 0), 0);
    const loud = { ...groove(1), rows: { ...groove(1).rows, clap: "3".repeat(16) } };
    const out = writeOpen(changed, { track: "td", clip: "n2" }, loud, 0);
    expect(clip<DrumsClip>(out, "n2").content.rows.clap).toBe("3".repeat(16));
    expect(clip<DrumsClip>(out, "n1")).toBe(clip<DrumsClip>(two, "n1"));
    expect(out.tracks).toBe(two.tracks);
  });

  it("\"N bars\" follows the clip's length only when the clip showed its whole content once", () => {
    const band = bandSong();
    // the drums clip shows its four bars once: made eight bars, the clip is eight bars
    const longer = setOpenBars(band, { track: "td", clip: "d1" }, 8, 0);
    expect(clip<DrumsClip>(longer, "d1")).toMatchObject({ start: 16, len: 32 });
    expect(contentBars(clip<DrumsClip>(longer, "d1").content)).toBe(8);
    const shorter = setOpenBars(band, { track: "td", clip: "d1" }, 2, 0);
    expect(clip<DrumsClip>(shorter, "d1")).toMatchObject({ start: 16, len: 8 });
    // dragged out to repeat, it keeps its own length: only the content changes
    const twice = resizeClip(band, "d1", "right", 48);
    const out = setOpenBars(twice, { track: "td", clip: "d1" }, 2, 0);
    expect(clip<DrumsClip>(out, "d1")).toMatchObject({ start: 16, len: 32 });
    expect(contentBars(clip<DrumsClip>(out, "d1").content)).toBe(2);
    // a draft has no length but its content's
    const d = setOpenBars(band, { track: "td" }, 6, 0);
    expect(contentBars((d.tracks.find((t) => t.id === "td") as DrumsTrack).draft!.content)).toBe(6);
  });

  it("a clip that cannot grow (another clip follows) keeps its length", () => {
    const band = bandSong();
    // the chords clip of bars 1 to 8 is followed by the one of bars 9 to 16
    const out = setOpenBars(band, { track: "tc", clip: "c1" }, 12, 0);
    expect(clip(out, "c1")).toMatchObject({ start: 0, len: 32 });
    expect(clip(out, "c2")).toMatchObject({ start: 32 });
    expect(contentBars(clip(out, "c1").content)).toBe(12);
  });

  it("longer drums carry the last bar on; a longer melody gets empty bars; chords only get a longer frame", () => {
    const g = withBars("drums", groove(1, SIG44, 0), 3, SIG44) as Groove;
    expect(g.bars).toBe(3);
    expect(g.rows.snare).toBe(("3" + "0".repeat(15)).repeat(3));
    const m = withBars("melody", tune(2, [[0, 60], [5, 62]]), 1, SIG44) as Melody;
    expect(m).toMatchObject({ bars: 1, notes: [{ at: 0, midi: 60 }] });
    const c = chordsContent(4);
    const longer = withBars("chords", c, 8, SIG44) as ChordsContent;
    expect(longer.bars).toBe(8);
    expect(longer.chords).toBe(c.chords);
    // never fewer than one bar or more than 32, and the same content back when it is that long already
    expect(contentBars(withBars("drums", groove(1), 99, SIG44))).toBe(32);
    expect(withBars("chords", c, 4, SIG44)).toBe(c);
  });

  it("an empty drum draft is four bars; the others are their kind's plain start", () => {
    expect(blankDraft("drums", SIG34)).toMatchObject({ bars: 4, steps: 12, div: 4 });
    expect((blankDraft("drums", SIG34) as Groove).rows.kick.length).toBe(48);
    expect(contentBars(blankDraft("chords", SIG44))).toBe(4);
    expect(contentBars(blankDraft("melody", SIG44))).toBe(2);
  });
});

describe("\"Fit to these bars\"", () => {
  it("is asked for only when what is open is written in another signature than the bars it lies in", () => {
    const mixed = mixedSong();
    expect(needsFit(mixed, { track: "td", clip: "d1" }, 0)).toBe(false);
    expect(needsFit(mixed, { track: "td", clip: "d2" }, 0)).toBe(false);
    // the 4/4 clip moved into the bars in 6/8
    const moved = { ...mixed, clips: mixed.clips.map((c) => (c.id === "d3" ? { ...c, start: 32 } : c)).filter((c) => c.id !== "d2") };
    expect(needsFit(moved, { track: "td", clip: "d3" }, 0)).toBe(true);
    // a draft written in 4/4, with the anchor now in the 6/8 bars
    const drafted = setDraft(mixed, "td", groove(1), SIG44);
    expect(needsFit(drafted, { track: "td" }, 0)).toBe(false);
    expect(needsFit(drafted, { track: "td" }, 32)).toBe(true);
  });
});

describe("a separate copy laid on a lane", () => {
  it("of a draft: one round of its content long, on the bar under the pointer, and the draft stays", () => {
    const g = groove(2);
    const band = setDraft(bandSong(), "td", g, SIG44);
    const out = stampOpen(band, { track: "td" }, "td", 38.7, 0, counter());
    expect(clip<DrumsClip>(out, "n1")).toMatchObject({ track: "td", start: 36, len: 8, off: 0 });
    expect(clip<DrumsClip>(out, "n1").content).toEqual(g);
    expect(clip<DrumsClip>(out, "n1").content).not.toBe(g);
    expect((out.tracks.find((t) => t.id === "td") as DrumsTrack).draft!.content).toBe(g);
  });

  it("onto another track of the same kind, and never onto one of another kind", () => {
    const band = addTrack(setDraft(bandSong(), "td", groove(1), SIG44), "drums", "td2");
    const out = stampOpen(band, { track: "td" }, "td2", 0, 0, counter());
    expect(clip(out, "n1")).toMatchObject({ track: "td2", start: 0, len: 4 });
    // a drum composition only lands on a drums track
    for (const other of ["tc", "tm", "tb", "tv", "nope"]) expect(stampOpen(band, { track: "td" }, other, 0, 0, counter())).toBe(band);
    // a melody may land on a bass track (they hold the same thing)
    const tuned = setDraft(bandSong(), "tm", tune(1, [[0, 60]]), SIG44);
    expect(clip(stampOpen(tuned, { track: "tm" }, "tb", 40.4, 0, counter()), "n1")).toMatchObject({ track: "tb", start: 40, len: 4 });
  });

  it("of a placed clip: that clip again, as long as it is, with its own content", () => {
    const band = bandSong();
    const out = stampOpen(band, { track: "tm", clip: "m1" }, "tm", 0, 0, counter());
    const a = clip<MelodyClip>(out, "m1");
    const b = clip<MelodyClip>(out, "n1");
    expect(b).toMatchObject({ track: "tm", start: 0, len: 32 });
    expect(b.content).toEqual(a.content);
    expect(b.content).not.toBe(a.content);
    // dropped exactly where it is, nothing happens
    expect(stampOpen(band, { track: "tm", clip: "m1" }, "tm", 32, 0, counter())).toBe(band);
  });

  it("an empty draft lands as an empty clip of its kind's length", () => {
    const out = stampOpen(bandSong(), { track: "td" }, "td", 0, 0, counter());
    expect(clip(out, "n1")).toMatchObject({ start: 0, len: 16 });
  });
});
