// Harmonize hosted once by the track view: who gets the one sheet when a window asks, and the sheet itself drawn as
// text on what a window has open (through the same lens the old pages use).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getTuning } from "../../../guitar/tunings";
import { writeHarmony } from "../../../song/harmony";
import { convertAll } from "../../../timeline/convert";
import { lensOf, unlens, type Target } from "../../../timeline/lens";
import type { TimelineSong } from "../../../timeline/model";
import { KEY_C, chord, chordsClip, chordsContent, chordsTrack, counter, melodyClip, songOf, tune, tuneTrack } from "../../../timeline/testsongs";
import { App5Ctx, type App5State, type Ctx5 } from "../../app5";
import { DEFAULT_STATE } from "../../state";
import { ClipLens } from "../../windows/ClipLens";
import { HarmonySheet, asked, canHarmonize, type HarmonyOpen } from "./host";

const ask = (win: string, more: Partial<HarmonyOpen> = {}): HarmonyOpen => ({ win, kind: "chords", anchor: null, again: false, clip: "c1", ...more });

describe("who has the one harmony sheet", () => {
  it("a window's Harmonize button opens it for that window", () => {
    const a = ask("compose:tc");
    expect(asked(null, a)).toBe(a);
  });
  it("the same window's button pressed again closes it", () => {
    expect(asked(ask("compose:tc"), ask("compose:tc"))).toBeNull();
  });
  it("another window's button takes it over: there is never a second sheet", () => {
    const b = ask("compose:tm", { kind: "melody", clip: "m1" });
    expect(asked(ask("compose:tc"), b)).toBe(b);
  });
  it("⟳ always opens the sheet that writes again, also over a sheet for a new track, also pressed twice", () => {
    const again = ask("compose:hx", { again: true });
    expect(asked(null, again)).toBe(again);
    expect(asked(ask("compose:hx"), again)).toBe(again);
    expect(asked(again, ask("compose:hx", { again: true }))).toMatchObject({ win: "compose:hx", again: true });
  });
  it("the Harmonize button pressed while the sheet writes a track again: the sheet for a new track", () => {
    const fresh = ask("compose:hx");
    expect(asked(ask("compose:hx", { again: true }), fresh)).toBe(fresh);
  });
});

/** A song for Harmonize: the lead chords and a melody over four bars, and an empty second chords track. */
function forHarmony(): TimelineSong {
  const chords = [chord("a1", "C"), chord("a2", "A", 4, "min"), chord("a3", "D", 4, "min"), chord("a4", "G", 4, "7")];
  return songOf([chordsTrack("tc", "Chords", { lead: true }), tuneTrack("tm"), chordsTrack("te", "Chords 2")], {
    clips: [chordsClip("c1", "tc", 16, 16, { content: chordsContent(4, undefined, chords) }), melodyClip("m1", "tm", 16, 16, { content: tune(4, [[0, 64], [2, 67], [4, 69], [6, 72], [8, 74], [10, 77], [12, 74], [14, 71]]) })],
  });
}
/** … and the same with a second melody track that Harmonize wrote from the melody (track "hx") */
function harmonized(): { song: TimelineSong; clip: string } {
  const s = forHarmony();
  const t: Target = { track: "tm", clip: "m1" };
  const lens = lensOf(s, t, KEY_C, 0)!;
  const song = unlens(s, t, lens, writeHarmony(lens.p, KEY_C, { kind: "melody", from: "melody", option: "third-above" }, { id: "hx", isNew: true, name: "x" }).p, counter("x"));
  return { song, clip: song.clips.find((c) => c.track === "hx")!.id };
}

describe("whether a composer shows its Harmonize button", () => {
  it("yes while some chords, melody or bass track has music under the open bars", () => {
    const s = forHarmony();
    expect(canHarmonize(s, { track: "tc", clip: "c1" }, KEY_C, 0)).toBe(true);
    expect(canHarmonize(s, { track: "tm", clip: "m1" }, KEY_C, 0)).toBe(true);
    // a draft lies at its anchor: over the music at bar 5, over nothing at bar 1
    expect(canHarmonize(s, { track: "te" }, KEY_C, 16)).toBe(true);
    expect(canHarmonize(s, { track: "te" }, KEY_C, 0)).toBe(false);
  });
  it("no in a song with nothing written, or for a track or a clip that is gone", () => {
    const empty = songOf([chordsTrack("tc"), tuneTrack("tm")]);
    expect(canHarmonize(empty, { track: "tc" }, KEY_C, 0)).toBe(false);
    expect(canHarmonize(forHarmony(), { track: "gone" }, KEY_C, 0)).toBe(false);
    expect(canHarmonize(forHarmony(), { track: "tm", clip: "gone" }, KEY_C, 0)).toBe(false);
  });
});

const no = () => {};
function draw(song: TimelineSong, target: Target, kind: "chords" | "melody", again = false): string {
  const state: App5State = { ...convertAll(DEFAULT_STATE, 1), song, key: KEY_C };
  const app: Ctx5 = {
    state, peek: () => state, set: no, edit: no, editKeyed: no, setSession: no, undo: no, redo: no, canUndo: false, canRedo: false,
    tuning: getTuning("standard"), toast: no, idea: null, dirty: false, opened: 0, saveIdea: () => "nothing", openIdea: no, newIdea: no, renameIdea: no,
    deleteIdea: no, importIdeas: () => 0, cloud: "local", syncNow: no, recordingTo: null, setRecordingTo: no,
  };
  return renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app },
    createElement(ClipLens, { target, pane: kind === "chords" ? "rhythm" : "melody" }, createElement(HarmonySheet, { kind, again, anchor: null, playing: false, onPreview: no, onClose: no }))));
}
/** the tracks offered to harmonize with, in the order they stand */
const sources = (html: string) => [...html.matchAll(/aria-label="Harmonize with ([^"]+)"/g)].map((m) => m[1]);

describe("the harmony sheet on what a window has open", () => {
  it("from a chords clip: one sheet that asks which track to go with, the open track first", () => {
    const html = draw(forHarmony(), { track: "tc", clip: "c1" }, "chords");
    expect(html.split('class="hz-sheet"').length - 1).toBe(1);
    expect(html).toContain('role="dialog" aria-label="Harmonize"');
    expect(sources(html)).toEqual(["Chords", "Melody"]);
    // the open track holds chords written by hand: the harmony goes into the empty chords track of the song
    expect(html).toContain('<b class="hz-to">Chords 2</b>');
    // nothing is chosen yet: no harmonies are offered, and there is nothing to keep
    expect(html).not.toContain("hz-opts");
    expect(html).not.toContain("hz-keep");
  });

  it("from a melody clip: a new track, the melody first among the tracks to go with", () => {
    const html = draw(forHarmony(), { track: "tm", clip: "m1" }, "melody");
    expect(html).toContain("<b>a new track</b>");
    expect(sources(html)).toEqual(["Melody", "Chords"]);
  });

  it("from an empty draft: written into the draft itself, and with one track to go with its harmonies are offered at once", () => {
    // (a draft lies at the cursor: bar 1 here, where this song has its melody)
    const song = songOf([tuneTrack("tm"), chordsTrack("te", "Chords 2")], { clips: [melodyClip("m1", "tm", 0, 16, { content: tune(4, [[0, 64], [2, 67], [4, 69], [6, 72], [8, 74], [10, 77], [12, 74], [14, 71]]) })] });
    const html = draw(song, { track: "te" }, "chords");
    expect(html).toContain('<b class="hz-to">Chords 2</b>');
    expect(sources(html)).toEqual(["Melody"]);
    expect(html).toContain("hz-opts");
    expect(html).toContain('aria-label="Keep it"');
  });

  it("⟳ on a track Harmonize wrote: the sheet that writes it again, on the option it was written with", () => {
    const { song, clip } = harmonized();
    const html = draw(song, { track: "hx", clip }, "melody", true);
    expect(html.split('class="hz-sheet"').length - 1).toBe(1);
    expect(html).toMatch(/role="dialog" aria-label="Write [^"]+ again"/);
    expect(html).toContain("with Melody");
    expect(html).toMatch(/class="chip hz-opt on now" aria-pressed="true"/);
    expect(html).toContain('aria-label="Write it again"');
    expect(sources(html)).toEqual([]);
  });

  it("⟳ asked for a track that Harmonize did not write: no sheet", () => {
    expect(draw(forHarmony(), { track: "tm", clip: "m1" }, "melody", true)).toBe("");
  });

  it("the track or the clip gone: no sheet", () => {
    expect(draw(forHarmony(), { track: "tm", clip: "gone" }, "melody")).toBe("");
    expect(draw(forHarmony(), { track: "gone" }, "chords")).toBe("");
  });
});
