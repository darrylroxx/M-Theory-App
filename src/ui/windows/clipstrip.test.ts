// The strip at the bottom of a composer window, drawn to text: what it offers for a draft and for a placed clip.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { needsFit, openOf, setOpenBars, type OpenTarget } from "../../timeline/content";
import { resizeClip, setDraft } from "../../timeline/edit";
import type { TimelineSong } from "../../timeline/model";
import { KEY_C, SIG44, bandSong, groove, mixedSong } from "../../timeline/testsongs";
import { ClipStrip, ClipSwitch, lookOf, type StripCtl } from "./ClipStrip";

const NOTHING: StripCtl = { fresh() {}, play() {}, setAlone() {}, bars() {}, copy() {}, paste() {}, fit() {}, drag() {} };
/** The strip of a target, as its window draws it. */
function strip(song: TimelineSong, target: OpenTarget, anchor = 0, more: { playing?: boolean; alone?: boolean; canPaste?: boolean } = {}): string {
  const open = openOf(song, target, anchor)!;
  return renderToStaticMarkup(createElement(ClipStrip, { open, keyOf: KEY_C, playing: !!more.playing, alone: !!more.alone, canPaste: !!more.canPaste, fit: needsFit(song, target, anchor), on: NOTHING }));
}
const bars = (html: string) => /<option value="(\d+)" selected="">/.exec(html)?.[1];

describe("the clip strip", () => {
  it("holds New, ▶ and alone, the clip to drag, its length with − and +, copy and paste", () => {
    const html = strip(bandSong(), { track: "td", clip: "d1" });
    expect(html).toContain(">New<");
    expect(html).toContain("▶");
    expect(html).toContain(">alone<");
    expect(html).toContain('aria-label="One bar shorter"');
    expect(html).toContain('aria-label="One bar longer"');
    expect(html).toContain('aria-label="Copy this clip of Drums"');
    expect(html).toContain("Paste: copy a clip of this kind first");
    // the clip is drawn as on its lane, in its track's colour, and says where it may be dropped
    expect(html).toContain("cs-clip tlc k-drums");
    expect(html).toContain("drag it onto a drums lane");
    expect(html).toContain("<rect");
  });

  it("a melody may be dropped on a melody or a bass lane", () => {
    expect(strip(bandSong(), { track: "tm", clip: "m1" })).toContain("drag it onto a melody or bass lane");
    expect(strip(bandSong(), { track: "tb" })).toContain("drag it onto a melody or bass lane");
  });

  it("\"Fit to these bars\" only when the clip's signature differs from its bars", () => {
    const mixed = mixedSong();
    expect(strip(mixed, { track: "td", clip: "d1" })).not.toContain("Fit to these bars");
    const moved = { ...mixed, clips: mixed.clips.filter((c) => c.id !== "d2").map((c) => (c.id === "d3" ? { ...c, start: 32 } : c)) };
    expect(strip(moved, { track: "td", clip: "d3" })).toContain("Fit to these bars");
    // a draft written in 4/4, lying where the bars are in 6/8
    const drafted = setDraft(mixed, "td", groove(1), SIG44);
    expect(strip(drafted, { track: "td" }, 0)).not.toContain("Fit to these bars");
    expect(strip(drafted, { track: "td" }, 32)).toContain("Fit to these bars");
  });

  it("the On / Off switch is not shown for a draft", () => {
    const band = bandSong();
    const sw = (target: OpenTarget) => renderToStaticMarkup(createElement(ClipSwitch, { clip: openOf(band, target, 0)!.clip, onMute() {} }));
    expect(sw({ track: "td" })).toBe("");
    expect(sw({ track: "td", clip: "d1" })).toContain('role="switch"');
    expect(sw({ track: "td", clip: "d1" })).toContain(">On<");
    const muted = { ...band, clips: band.clips.map((c) => (c.id === "d1" ? { ...c, mute: true as const } : c)) };
    expect(renderToStaticMarkup(createElement(ClipSwitch, { clip: openOf(muted, { track: "td", clip: "d1" }, 0)!.clip, onMute() {} }))).toContain(">Off<");
  });

  it("\"N bars\" follows the clip's length only when the clip showed its whole content once", () => {
    const band = bandSong();
    expect(bars(strip(band, { track: "td", clip: "d1" }))).toBe("4");
    // shown once: six bars asked for, the clip is six bars and the strip draws all of them with no repeat
    const six = setOpenBars(band, { track: "td", clip: "d1" }, 6, 0);
    expect(bars(strip(six, { track: "td", clip: "d1" }))).toBe("6");
    expect(lookOf(openOf(six, { track: "td", clip: "d1" }, 0)!).len).toBe(24);
    expect(strip(six, { track: "td", clip: "d1" })).not.toContain("tlc-notch");
    // dragged out to repeat: two bars asked for, the content is two bars, the clip keeps its eight and shows the repeats
    const twice = setOpenBars(resizeClip(band, "d1", "right", 48), { track: "td", clip: "d1" }, 2, 0);
    expect(bars(strip(twice, { track: "td", clip: "d1" }))).toBe("2");
    expect(lookOf(openOf(twice, { track: "td", clip: "d1" }, 0)!).len).toBe(32);
    expect(strip(twice, { track: "td", clip: "d1" }).split("tlc-notch").length - 1).toBe(3);
  });

  it("an empty draft says so; ▶ says whether it plays the track alone; a running ▶ is a stop", () => {
    const band = bandSong();
    expect(strip(band, { track: "td" })).toContain("Nothing in it yet");
    expect(strip(band, { track: "td", clip: "d1" })).not.toContain("Nothing in it yet");
    expect(strip(band, { track: "td", clip: "d1" })).toContain("with the song");
    expect(strip(band, { track: "td", clip: "d1" }, 0, { alone: true })).toContain("this track alone");
    expect(strip(band, { track: "td", clip: "d1" }, 0, { playing: true })).toContain("■");
    expect(strip(band, { track: "td", clip: "d1" }, 0, { canPaste: true })).toContain("Paste into this clip of Drums");
  });
});
