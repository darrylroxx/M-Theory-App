// The composer window of a Chords track while it is still the old Chords page: drawn as text. (This file goes when
// the Chords plugin replaces `ChordsLegacy`.)
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getTuning } from "../../../guitar/tunings";
import { convertAll } from "../../../timeline/convert";
import type { TimelineSong } from "../../../timeline/model";
import { KEY_C, bandSong } from "../../../timeline/testsongs";
import { App5Ctx, type App5State, type Ctx5 } from "../../app5";
import { DEFAULT_STATE } from "../../state";
import type { ComposerCtl, ComposerProps } from "../ComposerFrame";
import { PLUGINS } from "../registry";
import { ChordsLegacy } from "./ChordsLegacy";

const no = () => {};
/** a host that does nothing, whatever it is asked */
const ctl = new Proxy({}, { get: () => no }) as ComposerCtl;
function draw(song: TimelineSong, track: string, clip: string | undefined, more: Partial<ComposerProps> = {}): string {
  const state: App5State = { ...convertAll(DEFAULT_STATE, 1), song, key: KEY_C };
  const app: Ctx5 = {
    state, peek: () => state, set: no, edit: no, editKeyed: no, setSession: no, undo: no, redo: no, canUndo: false, canRedo: false,
    tuning: getTuning("standard"), toast: no, idea: null, dirty: false, opened: 0, saveIdea: () => "nothing", openIdea: no, newIdea: no, renameIdea: no,
    deleteIdea: no, importIdeas: () => 0, cloud: "local", syncNow: no, recordingTo: null, setRecordingTo: no,
  };
  const props: ComposerProps = {
    win: { id: `compose:${track}`, kind: "compose", track, ...(clip === undefined ? {} : { clip }), x: 260, y: 360, w: 1020, h: 440, open: true },
    track: song.tracks.find((t) => t.id === track)!, song, keyOf: KEY_C, target: clip === undefined ? { track } : { track, clip }, anchor: 0,
    focused: true, hidden: false, z: 59, player: { playing: false, toggle: no, stop: no, getBeat: () => null, seek: no, audition: no },
    audit: false, alone: false, heard: true, ctl, canPaste: false, harmonizing: false, ...more,
  };
  return renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app }, createElement(ChordsLegacy, props)));
}
const count = (html: string, what: RegExp) => (html.match(what) ?? []).length;

describe("the Chords track's composer window, while it is the old Chords page", () => {
  it("is what the registry mounts for a Chords track, and for no other kind", () => {
    expect(PLUGINS.chords.compose).toBe(ChordsLegacy);
    for (const k of ["melody", "bass", "drums", "vocals", "audio"] as const) expect(PLUGINS[k].compose).not.toBe(ChordsLegacy);
  });

  it("on a clip: one window with the Chords page and nothing of the other pages, and the strip with the clip", () => {
    const html = draw(bandSong(), "tc", "c1");
    expect(count(html, /class="tlw[ "]/g)).toBe(1);
    expect(html).toContain('data-win="compose:tc"');
    expect(html).toContain("Chords · bars 1–8");
    expect(count(html, /class="card board"/g)).toBe(1);
    expect(html).toContain('class="dock');
    expect(html).toContain('class="tlw-strip"');
    expect(count(html, /class="cs"/g)).toBe(1);
    for (const other of [/class="card melody"/, /class="card drums/, /transport/, /clip-bar/]) expect(count(html, other), other.source).toBe(0);
    // its sound panels are in the window, hidden (the track's sound has its own window); its playing style stays
    expect(html).toContain('class="lc-scroll lc-nosound"');
  });

  it("on the track's draft: titled as a draft, with an empty tray", () => {
    const html = draw(bandSong(), "tc", undefined);
    expect(html).toContain("Chords · draft");
    expect(count(html, /data-slot="/g)).toBe(0);
  });

  it("draws no harmony sheet: its Harmonize button asks the host, and is lit while the host says the sheet is open for it", () => {
    const plain = draw(bandSong(), "tc", "c1");
    expect(count(plain, /class="chip hz-go"/g)).toBe(1);
    expect(plain).toContain('aria-expanded="false"');
    const lit = draw(bandSong(), "tc", "c1", { harmonizing: true });
    expect(count(lit, /class="chip hz-go on"/g)).toBe(1);
    for (const html of [plain, lit]) expect(html).not.toContain("hz-sheet");
  });

  it("draws nothing for a track of another kind, or a clip that is gone", () => {
    expect(draw(bandSong(), "tm", "m1")).toBe("");
    expect(draw(bandSong(), "tb", "b1")).toBe("");
    expect(draw(bandSong(), "td", "d1")).toBe("");
    expect(draw(bandSong(), "tc", "nothing")).toBe("");
  });
});
