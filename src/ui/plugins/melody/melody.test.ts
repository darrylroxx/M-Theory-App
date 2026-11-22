// The Melody and Bass plugin: the composer window of a melody track and of a bass track, drawn as text; and the plain
// arithmetic of where its seven-octave grid stands (what is in view when something is opened, an octave step).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getTuning } from "../../../guitar/tunings";
import { GRID_HIGH, GRID_LOW, gridRows, melodyBase, type Melody, type MelodyNote } from "../../../song/melody";
import { chordSymbol } from "../../../theory/chords";
import { openOf } from "../../../timeline/content";
import { convertAll } from "../../../timeline/convert";
import { chordsUnderSpan } from "../../../timeline/lens";
import type { TimelineSong } from "../../../timeline/model";
import { KEY_B, KEY_C, bandSong, chord, chordsClip, chordsContent, chordsTrack, melodyClip, songOf, tune, tuneTrack } from "../../../timeline/testsongs";
import { App5Ctx, type App5State, type Ctx5 } from "../../app5";
import { MelodyGrid } from "../../components/MelodyGrid";
import { DEFAULT_STATE } from "../../state";
import type { ComposerCtl, ComposerProps } from "../ComposerFrame";
import { PLUGINS } from "../registry";
import { MelodyComposer } from "./MelodyComposer";
import { BASS_LOW, GRID_OCTAVES, centreTop, clampTop, emptySpan, octaveOf, octaveTop, openTop, rowAt, rowInView, spanOf } from "./range";

const no = () => {};
/** a host that does nothing, whatever it is asked */
const ctl = new Proxy({}, { get: () => no }) as ComposerCtl;
function draw(song: TimelineSong, track: string, clip: string | undefined, more: Partial<ComposerProps> = {}): string {
  const key = more.keyOf ?? KEY_C;
  const state: App5State = { ...convertAll(DEFAULT_STATE, 1), song, key };
  const app: Ctx5 = {
    state, peek: () => state, set: no, edit: no, editKeyed: no, setSession: no, undo: no, redo: no, canUndo: false, canRedo: false,
    tuning: getTuning("standard"), toast: no, idea: null, dirty: false, opened: 0, saveIdea: () => "nothing", openIdea: no, newIdea: no, renameIdea: no,
    deleteIdea: no, importIdeas: () => 0, cloud: "local", syncNow: no, recordingTo: null, setRecordingTo: no,
  };
  const props: ComposerProps = {
    win: { id: `compose:${track}`, kind: "compose", track, ...(clip === undefined ? {} : { clip }), x: 260, y: 360, w: 1020, h: 440, open: true },
    track: song.tracks.find((t) => t.id === track)!, song, keyOf: key, target: clip === undefined ? { track } : { track, clip }, anchor: 0,
    focused: true, hidden: false, z: 59, player: { playing: false, toggle: no, stop: no, getBeat: () => null, seek: no, audition: no },
    audit: false, alone: false, heard: true, ctl, canPaste: false, harmonizing: false, ...more,
  };
  return renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app }, createElement(MelodyComposer, props)));
}
const count = (html: string, what: RegExp) => (html.match(what) ?? []).length;
/** the notes of the grid's rows, top to bottom */
const rowNotes = (html: string) => [...html.matchAll(/<button data-m="(\d+)" class="mg-label/g)].map((m) => Number(m[1]));
/** where the grid opens: the notes it is to show */
const opensOn = (html: string) => {
  const m = html.match(/data-low="(\d+)" data-high="(\d+)"/);
  return m ? { low: Number(m[1]), high: Number(m[2]) } : null;
};
/** the notes drawn in the grid: [first step of the clip, note, squares] */
const drawn = (html: string) => [...html.matchAll(/class="mel-note[^"]*" data-g="(\d+)" data-m="(\d+)"[^>]*style="--k:(\d+);--n:([\d.]+);--i:(\d+)"/g)].map((m) => ({ g: Number(m[1]), midi: Number(m[2]), k: Number(m[3]), n: Number(m[4]), i: Number(m[5]) }));
const ALL = gridRows(KEY_C, GRID_LOW, GRID_OCTAVES);
const note = (midi: number, at = 0): MelodyNote => ({ at, midi });

describe("the Melody and Bass composer", () => {
  it("is what the registry mounts for a Melody track and for a Bass track, and for no other kind", () => {
    expect(PLUGINS.melody.compose).toBe(MelodyComposer);
    expect(PLUGINS.bass.compose).toBe(MelodyComposer);
    for (const k of ["chords", "drums", "vocals", "audio"] as const) expect(PLUGINS[k].compose).not.toBe(MelodyComposer);
  });

  it("a Melody track on a clip: one window with the grid, the tools and the strip, and nothing of the old pages", () => {
    const html = draw(bandSong(), "tm", "m1");
    expect(count(html, /class="tlw[ "]/g)).toBe(1);
    expect(html).toContain('data-win="compose:tm"');
    expect(html).toContain("Melody · bars 9–16");
    expect(count(html, /<section class="mel"/g)).toBe(1);
    expect(html).toContain('class="tlw-strip"');
    expect(count(html, /class="cs"/g)).toBe(1);
    for (const other of [/class="card melody"/, /class="card board"/, /class="card drums/, /class="dock/, /transport/, /clip-bar/, /page write embedded/, /sound-row/, /class="synth/]) expect(count(html, other), other.source).toBe(0);
    // every tool the Melody page had for writing: a tab for every bar, copy the bar before, the grid's steps, key only, undo, Clear
    expect(count(html, /role="tab"/g)).toBe(8);
    expect(html).toContain('aria-label="Copy the bar before"');
    expect(html).toContain('aria-label="Steps to a beat"');
    expect(count(html, /role="radio"/g)).toBeGreaterThanOrEqual(4);
    expect(html).toContain(">Key only</button>");
    expect(html).toContain('aria-label="Undo"');
    expect(html).toContain(">Clear</button>");
    // new here: every note an octave up or down, said in words, apart from the buttons that move the view
    expect(html).toContain('aria-label="Every note an octave up"');
    expect(html).toContain('aria-label="Every note an octave down"');
    expect(html).toContain('aria-label="Show an octave higher"');
    expect(html).toContain('aria-label="Show an octave lower"');
    // whether it is heard is the clip's switch in the title bar: one switch, not two
    expect(count(html, /role="switch"[^>]*aria-label="This clip is on"/g)).toBe(1);
    expect(count(html, /title="Play the melody with the chords"/g)).toBe(0);
  });

  it("the grid has every note from C1 to C8, highest first, for a melody and for a bass alike", () => {
    for (const [track, clip] of [["tm", "m1"], ["tb", "b1"], ["tm", undefined], ["tb", undefined]] as const) {
      const rows = rowNotes(draw(bandSong(), track, clip));
      expect(rows.length, `${track} ${clip}`).toBe(85);
      expect(rows[0]).toBe(GRID_HIGH);
      expect(rows[84]).toBe(GRID_LOW);
      expect(rows).toEqual(ALL.map((r) => r.midi));
    }
    // each row says its octave, and the home note is marked in every one of them
    const html = draw(bandSong(), "tb", "b1");
    expect(html).toContain('aria-label="Hear E1"');
    expect(html).toContain('aria-label="Hear C8"');
    expect(count(html, /<button data-m="\d+" class="mg-label in home"/g)).toBe(8);
    // and it is drawn without a square of its own for every step: stripes, and an element for each note
    expect(count(html, /role="gridcell"/g)).toBe(0);
    expect(count(html, /class="mel-row[ "]/g)).toBe(85 * 4);
  });

  it("a Bass composer opens low: an empty one on E1 to E3, one with notes on its notes", () => {
    const song = bandSong();
    expect(opensOn(draw(song, "tb", undefined))).toEqual({ low: 28, high: 52 });
    // (b1's notes are C2, F2 and G2)
    expect(opensOn(draw(song, "tb", "b1"))).toEqual({ low: 36, high: 43 });
    // an empty melody: the two octaves from the home note, in whatever key
    expect(opensOn(draw(song, "tm", undefined))).toEqual({ low: 60, high: 84 });
    expect(opensOn(draw(song, "tm", undefined, { keyOf: KEY_B }))).toEqual({ low: melodyBase(KEY_B), high: melodyBase(KEY_B) + 24 });
    expect(opensOn(draw(song, "tm", "m1"))).toEqual({ low: 60, high: 64 });
    // a melody clip laid on a bass track is opened where its notes are, not on low E
    const high = songOf([tuneTrack("tb", "bass")], { clips: [melodyClip("x", "tb", 0, 8, { content: tune(2, [[0, 72], [1, 79]]) })] });
    expect(opensOn(draw(high, "tb", "x"))).toEqual({ low: 72, high: 79 });
  });

  it("the chords the song plays under the open bars stand over the grid, with a dot on the notes that fit them", () => {
    const song = bandSong();
    const html = draw(song, "tm", "m1");
    const open = openOf(song, { track: "tm", clip: "m1" }, 0)!;
    const under = chordsUnderSpan(song, open.span);
    expect(under.length).toBe(8);
    // four bars are on screen: the names of the chords that come in in them, each over its first step
    const names = [...html.matchAll(/<span style="grid-column:(\d+)">([^<]+)<\/span>/g)].map((m) => [Number(m[1]), m[2]]);
    expect(names).toEqual(under.slice(0, 4).map((c) => [1, chordSymbol(c.ref)]));
    expect(count(html, /class="mel-fit"/g)).toBeGreaterThan(40);
    // the same clip over other chords: other names
    const other = songOf([chordsTrack("tc", "Chords", { lead: true }), tuneTrack("tm")], {
      clips: [chordsClip("c", "tc", 0, 8, { content: chordsContent(2, undefined, [chord("a", "D", 2, "min"), chord("b", "G", 6)]) }), melodyClip("m", "tm", 0, 8)],
    });
    const h2 = draw(other, "tm", "m");
    expect([...h2.matchAll(/<span style="grid-column:(\d+)">([^<]+)<\/span>/g)].map((m) => [Number(m[1]), m[2]])).toEqual([[1, "Dm"], [5, "G"]]);
    // a D minor chord for two beats: its dots stand under four steps, on every D, F and A of the grid
    expect(count(h2, /class="mel-fit" style="--k:0;--n:4;/g)).toBe(ALL.filter((r) => [2, 5, 9].includes(r.midi % 12)).length);
    // no chords under the bars: no names, no dots, and no room kept for them
    const alone = songOf([tuneTrack("tm")], { clips: [melodyClip("m", "tm", 0, 8)] });
    const h3 = draw(alone, "tm", "m");
    expect(count(h3, /mel-chords/g)).toBe(0);
    expect(count(h3, /class="mel-fit"/g)).toBe(0);
  });

  it("a note is drawn where it lies and as long as it is held", () => {
    const content: Melody = { div: 2, bars: 2, notes: [{ at: 0, midi: 60 }, { at: 12, midi: 64, len: 18 }, { at: 42, midi: 67, len: 24 }] };
    const song = songOf([tuneTrack("tm")], { clips: [melodyClip("m", "tm", 0, 8, { content })] });
    const notes = drawn(draw(song, "tm", "m"));
    const row = (midi: number) => rowAt(ALL, midi);
    // a note with no length of its own is one square
    expect(notes).toContainEqual({ g: 0, midi: 60, k: 0, n: 1, i: row(60) });
    // a beat and a half on a grid of half beats: three squares, from the third
    expect(notes).toContainEqual({ g: 2, midi: 64, k: 2, n: 3, i: row(64) });
    // held over the bar line: one square to the end of its bar, and it goes on in the next
    expect(notes).toContainEqual({ g: 7, midi: 67, k: 7, n: 1, i: row(67) });
    expect(notes).toContainEqual({ g: 7, midi: 67, k: 0, n: 3, i: row(67) });
    expect(notes.length).toBe(4);
  });

  it("on the track's draft: titled as a draft, with no note in the grid and nothing to move", () => {
    const html = draw(bandSong(), "tm", undefined);
    expect(html).toContain("Melody · draft");
    expect(drawn(html)).toEqual([]);
    expect(html).toMatch(/aria-label="Every note an octave up"[^>]*disabled=""/);
    expect(html).toMatch(/aria-label="Every note an octave down"[^>]*disabled=""/);
    // a draft has no switch: it is not on the timeline yet
    expect(count(html, /aria-label="This clip is o/g)).toBe(0);
  });

  it("every note can go an octave up or down only while none of them would leave the grid", () => {
    const at = (midi: number[]) => songOf([tuneTrack("tb", "bass")], { clips: [melodyClip("x", "tb", 0, 8, { content: tune(2, midi.map((m, i) => [i, m])) })] });
    const low = draw(at([28, 33]), "tb", "x");
    expect(low).toMatch(/aria-label="Every note an octave down"[^>]*disabled=""/);
    expect(low).not.toMatch(/aria-label="Every note an octave up"[^>]*disabled=""/);
    const top = draw(at([97, 60]), "tb", "x");
    expect(top).toMatch(/aria-label="Every note an octave up"[^>]*disabled=""/);
    expect(top).not.toMatch(/aria-label="Every note an octave down"[^>]*disabled=""/);
  });

  it("draws no harmony sheet: its Harmonize button asks the host, and is lit while the host says the sheet is open for it", () => {
    const plain = draw(bandSong(), "tm", "m1");
    expect(count(plain, /class="chip hz-go"/g)).toBe(1);
    const lit = draw(bandSong(), "tm", "m1", { harmonizing: true });
    expect(count(lit, /class="chip hz-go on"/g)).toBe(1);
    for (const html of [plain, lit]) expect(html).not.toContain("hz-sheet");
    // a clip nobody wrote with Harmonize has nothing to write again
    expect(plain).not.toContain("mel-again");
    // nothing to harmonize with (the only track, and it is empty): no button
    expect(draw(songOf([tuneTrack("tm")]), "tm", undefined)).not.toContain("hz-go");
  });

  it("draws nothing for a track of another kind, or a clip that is gone", () => {
    expect(draw(bandSong(), "tc", "c1")).toBe("");
    expect(draw(bandSong(), "td", "d1")).toBe("");
    expect(draw(bandSong(), "tm", "nothing")).toBe("");
  });
});

describe("the old Melody page's grid is as it was", () => {
  const props = { melody: tune(2, [[0, 60], [1, 62]]), setMelody: no, keyOf: KEY_C, bar: 4, chords: [], playing: false, getPos: () => null, shown: 0 as const, follow: false, active: true };
  it("without `octaves`: two octaves of squares, each a button, and no overview", () => {
    const html = renderToStaticMarkup(createElement(MelodyGrid, props));
    expect(html).toContain('class="card melody"');
    expect(count(html, /role="gridcell"/g)).toBe(25 * 8 * 2);
    expect(count(html, /role="gridcell"[^>]*aria-pressed="true"/g)).toBe(2);
    expect(html).not.toContain("mel-");
    // its own On / Off chip, as before
    expect(html).toContain('title="Play the melody with the chords"');
    // and with a lowest row: the two octaves from there
    const low = renderToStaticMarkup(createElement(MelodyGrid, { ...props, low: 36 }));
    expect([...new Set([...low.matchAll(/data-m="(\d+)"/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => 36 + i).concat([62]).filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b));
  });
  it("given no sound, it draws no sound controls", () => {
    expect(renderToStaticMarkup(createElement(MelodyGrid, props))).not.toContain("sound-row");
  });
});

describe("where the seven-octave grid stands", () => {
  /** the notes in view, highest and lowest, when `top` is the first row and `n` rows fit */
  const inView = (top: number, n: number) => ({ high: ALL[top].midi, low: ALL[top + n - 1].midi });

  it("an empty bass clip opens on E1 to E3; an empty melody on the two octaves from its home note", () => {
    expect(BASS_LOW).toBe(28);
    expect(emptySpan(true, KEY_C)).toEqual({ low: 28, high: 52 });
    expect(emptySpan(true, KEY_B)).toEqual({ low: 28, high: 52 });
    expect(emptySpan(false, KEY_C)).toEqual({ low: 60, high: 84 });
    expect(emptySpan(false, KEY_B)).toEqual({ low: 59, high: 83 });
    // in a view tall enough for two octaves, exactly those rows are in view
    expect(inView(openTop(ALL, [], emptySpan(true, KEY_C), 25), 25)).toEqual({ high: 52, low: 28 });
    expect(inView(openTop(ALL, [], emptySpan(false, KEY_C), 25), 25)).toEqual({ high: 84, low: 60 });
    // taller still: they stand in the middle
    expect(inView(openTop(ALL, [], emptySpan(false, KEY_C), 31), 31)).toEqual({ high: 87, low: 57 });
    // in the docked window thirteen rows fit: the low end is the bottom row (a bass starts on its low E)
    expect(inView(openTop(ALL, [], emptySpan(true, KEY_C), 13), 13)).toEqual({ high: 40, low: 28 });
    expect(inView(openTop(ALL, [], emptySpan(false, KEY_C), 13), 13)).toEqual({ high: 72, low: 60 });
    // (part of a row at the bottom does not count as a row)
    expect(openTop(ALL, [], emptySpan(true, KEY_C), 13.6)).toBe(openTop(ALL, [], emptySpan(true, KEY_C), 13));
  });

  it("a clip with notes opens around them", () => {
    const some = [note(36), note(41, 12), note(43, 24)];
    expect(spanOf(some)).toEqual({ low: 36, high: 43 });
    expect(spanOf([])).toBeNull();
    // eight rows of notes in thirteen: two rows over them, three under
    const top = openTop(ALL, some, emptySpan(true, KEY_C), 13);
    expect(inView(top, 13)).toEqual({ high: 45, low: 33 });
    for (const n of some) expect(rowInView(ALL, n.midi, top, 13)).toBe(true);
    // wherever the notes are: at the very top, at the very bottom
    expect(inView(openTop(ALL, [note(108), note(104)], emptySpan(true, KEY_C), 13), 13)).toEqual({ high: 108, low: 96 });
    expect(inView(openTop(ALL, [note(24)], emptySpan(false, KEY_C), 13), 13)).toEqual({ high: 36, low: 24 });
    // notes that reach further than the view: the middle one of them is in the middle of it
    const wide = [note(28), note(40), note(52), note(64), note(76)];
    const t = openTop(ALL, wide, emptySpan(true, KEY_C), 13);
    expect(rowInView(ALL, 52, t, 13)).toBe(true);
    expect(inView(t, 13)).toEqual({ high: 58, low: 46 });
    // what an empty clip opens on plays no part once there are notes
    expect(openTop(ALL, some, emptySpan(false, KEY_C), 13)).toBe(top);
  });

  it("an octave step moves the view by twelve rows, up and down, and stops at the ends", () => {
    const top = openTop(ALL, [], emptySpan(true, KEY_C), 13);
    const down = octaveTop(ALL, top, -1, 13);
    // (E1 is four rows over the lowest row: an octave down stops on C1)
    expect(inView(down, 13).low).toBe(24);
    const up = octaveTop(ALL, top, 1, 13);
    expect(up).toBe(top - 12);
    expect(inView(up, 13)).toEqual({ high: 52, low: 40 });
    expect(octaveTop(ALL, up, 1, 13)).toBe(top - 24);
    expect(octaveTop(ALL, up, -1, 13)).toBe(top);
    // from between two rows (the wheel left it there) it lands on a whole row
    expect(octaveTop(ALL, top - 0.4, 1, 13)).toBe(top - 12);
    // at the top it stays at the top
    expect(octaveTop(ALL, 5, 1, 13)).toBe(0);
    expect(octaveTop(ALL, 0, 1, 13)).toBe(0);
    // seven presses from the bottom reach the top, seven more the bottom again
    let at = clampTop(ALL, 999, 13);
    expect(at).toBe(85 - 13);
    for (let i = 0; i < 7; i++) at = octaveTop(ALL, at, 1, 13);
    expect(at).toBe(0);
    for (let i = 0; i < 7; i++) at = octaveTop(ALL, at, -1, 13);
    expect(at).toBe(85 - 13);
  });

  it("with the rows of the key only, an octave step is still an octave: as many rows as the scale has notes", () => {
    const only = gridRows(KEY_C, GRID_LOW, GRID_OCTAVES, true);
    expect(only.length).toBe(50);
    const top = rowAt(only, 72);
    expect(only[octaveTop(only, top, 1, 13)].midi).toBe(84);
    expect(octaveTop(only, top, 1, 13)).toBe(top - 7);
    expect(only[octaveTop(only, top, -1, 13)].midi).toBe(60);
    // a note that has no row of its own (outside the key) counts as the row under it
    expect(only[rowAt(only, 61)].midi).toBe(60);
    expect(rowInView(only, 61, rowAt(only, 72), 13)).toBe(false);
    expect(rowInView(only, 60, rowAt(only, 72), 13)).toBe(true);
  });

  it("a press on the overview puts that place of the range in the middle of the view", () => {
    // the row of middle C, in a view of thirteen rows: six rows over it, six under
    const t = centreTop(ALL, rowAt(ALL, 60) + 0.5, 13);
    expect(inView(t, 13)).toEqual({ high: 66, low: 54 });
    // the two ends of the overview are the two ends of the grid
    expect(centreTop(ALL, 0, 13)).toBe(0);
    expect(centreTop(ALL, 85, 13)).toBe(85 - 13);
  });

  it("a row counts as in view only when all of it is", () => {
    expect(rowInView(ALL, 108, 0, 13)).toBe(true);
    expect(rowInView(ALL, 96, 0, 13)).toBe(true);
    expect(rowInView(ALL, 95, 0, 13)).toBe(false);
    // half scrolled under the top edge: not in view
    expect(rowInView(ALL, 108, 0.5, 13)).toBe(false);
    expect(rowInView(ALL, 95, 0.5, 13.5)).toBe(true);
  });

  it("octaves are numbered as they are written: middle C is C4, a bass's low E is E1", () => {
    expect(octaveOf(60)).toBe(4);
    expect(octaveOf(28)).toBe(1);
    expect(octaveOf(24)).toBe(1);
    expect(octaveOf(108)).toBe(8);
    expect(octaveOf(59)).toBe(3);
    expect(GRID_OCTAVES).toBe(7);
  });
});
