/** What the Harmonize sheet says when a harmony is kept, and the sheet on the bars of one clip. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getTuning } from "../../guitar/tunings";
import { convertAll } from "../../timeline/convert";
import type { Target } from "../../timeline/lens";
import type { TimelineSong } from "../../timeline/model";
import { KEY_C, chord, chordsClip, chordsContent, chordsTrack, melodyClip, songOf, tune, tuneTrack } from "../../timeline/testsongs";
import { App5Ctx, type App5State, type Ctx5 } from "../app5";
import { DEFAULT_STATE } from "../state";
import { ClipLens } from "../windows/ClipLens";
import { HarmonyPicker, keptMessage } from "./HarmonyPicker";

describe("the toast when a harmony is kept", () => {
  it("names a new track, or the track and the harmony now in it", () => {
    expect(keptMessage(true, "High chords", "High chords")).toBe("High chords added");
    expect(keptMessage(false, "Chords 2", "High chords")).toBe("Chords 2: High chords");
  });
  it("says the name once when the track is called by its harmony (written over by Harmonize, it takes the new one's name)", () => {
    expect(keptMessage(false, "Guide tones", "Guide tones")).toBe("Guide tones");
    expect(keptMessage(false, "Guide tones 2", "Guide tones")).toBe("Guide tones 2");
  });
  it("and says which chords it plays in place of", () => {
    expect(keptMessage(false, "Chords 2", "Relative", "Chords")).toBe("Chords 2: Relative, in place of Chords here");
  });
});

const no = () => {};
/** the sheet as text, on what a window of the track view has open (the song it reads is that clip's bars: windows/ClipLens) */
function sheet(song: TimelineSong, target: Target, props: Partial<Parameters<typeof HarmonyPicker>[0]> = {}): string {
  const state: App5State = { ...convertAll(DEFAULT_STATE, 1), song, key: KEY_C };
  const app: Ctx5 = {
    state, peek: () => state, set: no, edit: no, editKeyed: no, setSession: no, undo: no, redo: no, canUndo: false, canRedo: false,
    tuning: getTuning("standard"), toast: no, idea: null, dirty: false, opened: 0, saveIdea: () => "nothing", openIdea: no, newIdea: no, renameIdea: no,
    deleteIdea: no, importIdeas: () => 0, cloud: "local", syncNow: no, recordingTo: null, setRecordingTo: no,
  };
  return renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app },
    createElement(ClipLens, { target, pane: "melody" }, createElement(HarmonyPicker, { kind: "melody", first: "melody", onClose: no, ...props }))));
}
const offered = (html: string) => [...html.matchAll(/aria-label="Harmonize with ([^"]+)"/g)].map((m) => m[1]);

describe("the sheet on one clip's bars", () => {
  const notes: [number, number][] = [[0, 64], [2, 67], [4, 69], [6, 72], [8, 74], [10, 77], [12, 74], [14, 71]];
  const chords = (id: string) => [chord(`${id}1`, "C"), chord(`${id}2`, "A", 4, "min"), chord(`${id}3`, "D", 4, "min"), chord(`${id}4`, "G", 4, "7")];
  /** chords under bars 1–4 on the lead track, and under bars 9–12 on a second chords track; a melody clip over bars 9–12 */
  const song = songOf([chordsTrack("tc", "Chords", { lead: true }), tuneTrack("tm"), chordsTrack("t2", "Chords 2")], {
    clips: [
      chordsClip("c1", "tc", 0, 16, { content: chordsContent(4, undefined, chords("a")) }),
      melodyClip("m1", "tm", 32, 16, { content: tune(4, notes) }),
      chordsClip("c2", "t2", 32, 16, { content: chordsContent(4, undefined, chords("b")) }),
    ],
  });

  it("offers the tracks with music under those bars, and no other", () => {
    expect(offered(sheet(song, { track: "tm", clip: "m1" }))).toEqual(["Melody", "Chords 2"]);
    // the clip moved under the first chords: now those are the ones under it
    const moved = { ...song, clips: song.clips.map((c) => (c.id === "m1" ? { ...c, start: 0 } : c)) };
    expect(offered(sheet(moved, { track: "tm", clip: "m1" }))).toEqual(["Melody", "Chords"]);
  });

  it("names the bars when it is told them, and says nothing of bars when it is not (the old view)", () => {
    const named = sheet(song, { track: "tm", clip: "m1" }, { bars: "bars 9–12" });
    expect(named).toContain("bars 9–12");
    expect(named).toMatch(/Harmonize <b>a new track<\/b><span class="hz-bars">, bars 9–12,<\/span> with/);
    const plain = sheet(song, { track: "tm", clip: "m1" });
    expect(plain).not.toContain("hz-bars");
    expect(plain).toContain("Harmonize <b>a new track</b> with");
  });
});
