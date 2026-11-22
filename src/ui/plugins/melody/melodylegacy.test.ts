// The composer window of a Melody track and of a Bass track while it is still the old Melody page: drawn as text.
// (This file goes when the Melody and Bass plugin replaces `MelodyLegacy`.)
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getTuning } from "../../../guitar/tunings";
import { melodyBase } from "../../../song/melody";
import { convertAll } from "../../../timeline/convert";
import type { TimelineSong } from "../../../timeline/model";
import { KEY_C, bandSong } from "../../../timeline/testsongs";
import { App5Ctx, type App5State, type Ctx5 } from "../../app5";
import { DEFAULT_STATE } from "../../state";
import type { ComposerCtl, ComposerProps } from "../ComposerFrame";
import { PLUGINS } from "../registry";
import { MelodyLegacy } from "./MelodyLegacy";

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
  return renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app }, createElement(MelodyLegacy, props)));
}
const count = (html: string, what: RegExp) => (html.match(what) ?? []).length;
/** the notes of the grid's rows */
const rowNotes = (html: string) => [...new Set([...html.matchAll(/data-m="(\d+)"/g)].map((m) => Number(m[1])))];

describe("the Melody and Bass tracks' composer window, while it is the old Melody page", () => {
  it("is what the registry mounts for a Melody track and for a Bass track, and for no other kind", () => {
    expect(PLUGINS.melody.compose).toBe(MelodyLegacy);
    expect(PLUGINS.bass.compose).toBe(MelodyLegacy);
    for (const k of ["chords", "drums", "vocals", "audio"] as const) expect(PLUGINS[k].compose).not.toBe(MelodyLegacy);
  });

  it("a Melody track on a clip: one window with the Melody page and nothing of the other pages, and the strip with the clip", () => {
    const html = draw(bandSong(), "tm", "m1");
    expect(count(html, /class="tlw[ "]/g)).toBe(1);
    expect(html).toContain('data-win="compose:tm"');
    expect(html).toContain("Melody · bars 9–16");
    expect(count(html, /class="card melody"/g)).toBe(1);
    expect(html).toContain('class="tlw-strip"');
    expect(count(html, /class="cs"/g)).toBe(1);
    for (const other of [/class="card board"/, /class="card drums/, /class="dock/, /transport/, /clip-bar/]) expect(count(html, other), other.source).toBe(0);
    // the chords the song plays under the melody stand over its grid
    expect(html).toContain("mg-chords");
    // two octaves from the home note
    const rows = rowNotes(html);
    expect(Math.min(...rows)).toBe(melodyBase(KEY_C));
    expect(rows).toContain(melodyBase(KEY_C) + 24);
  });

  it("a Bass track: the same page with its grid two octaves lower", () => {
    const html = draw(bandSong(), "tb", "b1");
    expect(html).toContain("Bass · bars 1–8");
    expect(count(html, /class="card melody"/g)).toBe(1);
    const rows = rowNotes(html);
    expect(Math.min(...rows)).toBe(melodyBase(KEY_C) - 24);
    expect(rows).toContain(melodyBase(KEY_C));
  });

  it("on the track's draft: titled as a draft, with no note in the grid", () => {
    const html = draw(bandSong(), "tm", undefined);
    expect(html).toContain("Melody · draft");
    expect(html).not.toMatch(/role="gridcell" aria-pressed="true"/);
  });

  it("draws no harmony sheet: its Harmonize button asks the host, and is lit while the host says the sheet is open for it", () => {
    const plain = draw(bandSong(), "tm", "m1");
    expect(count(plain, /class="chip hz-go"/g)).toBe(1);
    const lit = draw(bandSong(), "tm", "m1", { harmonizing: true });
    expect(count(lit, /class="chip hz-go on"/g)).toBe(1);
    for (const html of [plain, lit]) expect(html).not.toContain("hz-sheet");
  });

  it("draws nothing for a track of another kind, or a clip that is gone", () => {
    expect(draw(bandSong(), "tc", "c1")).toBe("");
    expect(draw(bandSong(), "td", "d1")).toBe("");
    expect(draw(bandSong(), "tm", "nothing")).toBe("");
  });
});
