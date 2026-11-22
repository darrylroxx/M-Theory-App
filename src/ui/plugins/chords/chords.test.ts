// The Chords plugin: what its window draws, that every chord edit made through the lens lands in what the window has
// open and nowhere else, which chord is lit while the music plays, when the shape finder goes, and "All clips".
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { presetById } from "../../../synth/presets";
import { getTuning } from "../../../guitar/tunings";
import { convertAll } from "../../../timeline/convert";
import { openOf } from "../../../timeline/content";
import { makeHistory } from "../../../timeline/history";
import type { Target } from "../../../timeline/lens";
import type { ChordsClip, ChordsContent, ChordsTrack, TimelineSong } from "../../../timeline/model";
import { KEY_C, bandSong, chord, chordsClip, chordsContent, chordsTrack, songOf } from "../../../timeline/testsongs";
import { App5Ctx, editIn, editKeyedIn, stepIn, type App5State, type Ctx5 } from "../../app5";
import { ShapeFinder } from "../../components/ShapeFinder";
import { AppCtx, DEFAULT_STATE, useApp, type Ctx, type SheetState } from "../../state";
import { ClipLens } from "../../windows/ClipLens";
import type { ComposerCtl, ComposerProps } from "../ComposerFrame";
import { PLUGINS } from "../registry";
import { ChordsComposer } from "./ChordsComposer";
import { placeIn } from "./drag";
import { stepStyle } from "./Playing";
import { addRest, allPlayAs, clearChords, dropChord, finderShown, litChord, pinShape, playingToAll, posIn, removeChord, setArrange, setBars, setLengths, setStyle } from "./tray";

const no = () => {};
/** a host that does nothing, whatever it is asked */
const ctl = new Proxy({}, { get: () => no }) as ComposerCtl;

/** The app's state held in a plain box, with every way to change it: what the provider is, without a screen. */
function box(song: TimelineSong) {
  let s: App5State = { ...convertAll(DEFAULT_STATE, 1), song, key: KEY_C };
  const h = makeHistory();
  const app: Ctx5 = {
    get state() { return s; },
    peek: () => s,
    set: (fn) => { s = fn(s); },
    edit: (label, fn, control) => { s = editIn(s, h, label, fn, control); },
    editKeyed: (label, fn) => { s = editKeyedIn(s, h, label, fn); },
    setSession: (fn) => { s = { ...s, session: fn(s.session) }; },
    undo: () => { s = stepIn(s, h, true, false); },
    redo: () => { s = stepIn(s, h, false, false); },
    get canUndo() { return h.canUndo; },
    get canRedo() { return h.canRedo; },
    tuning: getTuning("standard"), toast: no, idea: null, dirty: false, opened: 0,
    saveIdea: () => "nothing", openIdea: no, newIdea: no, renameIdea: no, deleteIdea: no,
    importIdeas: () => 0, cloud: "local", syncNow: no, recordingTo: null, setRecordingTo: no,
  };
  return { app, get: () => s, song: () => s.song, h };
}

/** The old pages' context for a target, as the plugin's parts get it: drawn once, handed back. */
function lens(app: Ctx5, target: Target): Ctx {
  let got: Ctx | null = null;
  const Probe = () => {
    got = useApp();
    return null;
  };
  renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app }, createElement(ClipLens, { target, pane: "rhythm" }, createElement(Probe))));
  if (!got) throw new Error("nothing was drawn");
  return got;
}

function draw(app: Ctx5, track: string, clip: string | undefined, more: Partial<ComposerProps> = {}): string {
  const song = app.state.song;
  const props: ComposerProps = {
    win: { id: `compose:${track}`, kind: "compose", track, ...(clip === undefined ? {} : { clip }), x: 260, y: 360, w: 1020, h: 440, open: true },
    track: song.tracks.find((t) => t.id === track)!, song, keyOf: KEY_C, target: clip === undefined ? { track } : { track, clip }, anchor: 0,
    focused: true, hidden: false, z: 59, player: { playing: false, toggle: no, stop: no, getBeat: () => null, seek: no, audition: no },
    audit: false, alone: false, heard: true, ctl, canPaste: false, harmonizing: false, ...more,
  };
  return renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app }, createElement(ChordsComposer, props)));
}
const count = (html: string, what: RegExp) => (html.match(what) ?? []).length;
const clipOf = (song: TimelineSong, id: string) => song.clips.find((c) => c.id === id) as ChordsClip;
const names = (c: ChordsContent) => c.chords.map((x) => (x.rest ? "-" : x.ref.root + (x.ref.typeId === "min" ? "m" : "")));
const c1: Target = { track: "tc", clip: "c1" };

describe("the Chords plugin's window", () => {
  it("is what the registry mounts for a Chords track, and for no other kind", () => {
    expect(PLUGINS.chords.compose).toBe(ChordsComposer);
    for (const k of ["melody", "bass", "drums", "vocals", "audio"] as const) expect(PLUGINS[k].compose).not.toBe(ChordsComposer);
  });

  it("on a clip: one window with the board, the tray with a slot and a ruler block for every chord, + Rest, Clear, Arrange, the playing row and the strip", () => {
    const html = draw(box(bandSong()).app, "tc", "c1");
    expect(count(html, /class="tlw[ "]/g)).toBe(1);
    expect(html).toContain('data-win="compose:tc"');
    expect(html).toContain("Chords · bars 1–8");
    // the board: In key / Outside / Next, the kinds of chord, the key, the capo, seven cards
    expect(count(html, /class="card board cp-board/g)).toBe(1);
    for (const word of ["In key", "Outside", "Next", "Triads", "13ths", "Capo", "C Major"]) expect(html, word).toContain(word);
    expect(count(html, /class="kc draggable/g)).toBe(7);
    // the tray
    expect(count(html, /data-slot="/g)).toBe(8);
    expect(count(html, /class="ruler-block/g)).toBe(8);
    expect(html).toContain("+ Rest");
    expect(html).toContain(">Clear<");
    expect(html).toContain(">Arrange<");
    expect(html).toContain("My shapes");
    expect(html).not.toContain(">Voicing<");
    // how it is played: the style of this clip, and "All clips" (the track has another clip)
    expect(html).toContain('aria-label="Playing style: Let ring"');
    expect(html).toContain(">All clips<");
    // the strip
    expect(html).toContain('class="tlw-strip"');
    expect(count(html, /class="cs"/g)).toBe(1);
  });

  it("has no sound panels (they are the track's sound window), no other page, no transport, no slim stand-in for the tray", () => {
    const html = draw(box(bandSong()).app, "tc", "c1");
    for (const gone of [/card harp/, /inst-switch/, /aria-label="Instrument"/, />Effects</, />Strings</, /class="card melody"/, /class="card drums/, /transport/, /clip-bar/, /mini-tray/, /lc-scroll/, /page write embedded/]) expect(count(html, gone), gone.source).toBe(0);
  });

  it("on the track's draft: titled as a draft, with an empty tray that says how to fill it", () => {
    const html = draw(box(bandSong()).app, "tc", undefined);
    expect(html).toContain("Chords · draft");
    expect(count(html, /data-slot="/g)).toBe(0);
    expect(html).toContain("Add a chord with its +, or drag it here");
    // nothing in it yet: nothing to arrange, nothing to clear, and no "All clips" from an empty draft
    expect(html).not.toContain(">Arrange<");
    expect(html).not.toContain(">Clear<");
    expect(html).not.toContain(">All clips<");
    expect(html).toContain("+ Rest");
  });

  it("\"All clips\" is offered only when the track has another clip, and is lit only while one of them is played another way", () => {
    const one = songOf([chordsTrack("tc", "Chords", { lead: true })], { clips: [chordsClip("c1", "tc", 0, 16)] });
    expect(draw(box(one).app, "tc", "c1")).not.toContain(">All clips<");
    const same = draw(box(bandSong()).app, "tc", "c1");
    expect(same).toMatch(/<button class="chip cp-all" disabled=""/);
    const song = bandSong();
    const other = { ...song, clips: song.clips.map((c) => (c.id === "c2" && c.kind === "chords" ? { ...c, content: { ...c.content, style: "strum" as const } } : c)) };
    const html = draw(box(other).app, "tc", "c1");
    expect(html).toContain(">All clips<");
    expect(html).not.toMatch(/<button class="chip cp-all" disabled=""/);
  });

  it("on the keys: Voicing in place of Arrange, keyboards in place of guitar shapes, no capo, no shape steppers", () => {
    const song = bandSong();
    const keys = { ...song, tracks: song.tracks.map((t) => (t.id === "tc" ? ({ ...t, tone: { inst: "piano" } } as ChordsTrack) : t)) };
    const html = draw(box(keys).app, "tc", "c1");
    expect(html).toContain(">Voicing<");
    expect(html).toContain("Drop 2");
    expect(html).not.toContain(">Arrange<");
    expect(html).not.toContain(">Capo<");
    expect(count(html, /class="slot-more"/g)).toBe(8);
    expect(count(html, /Previous shape for/g)).toBe(0);
    // the playing style stays: a piano plays the styles too
    expect(html).toContain('aria-label="Playing style: Let ring"');
  });

  it("on a synth track the playing row is not shown: the synth's own way of playing takes its place", () => {
    const song = bandSong();
    const synth = { ...song, tracks: song.tracks.map((t) => (t.id === "tc" ? ({ ...t, tone: { inst: "synth", synth: presetById("pwm-lead")!.params } } as ChordsTrack) : t)) };
    const html = draw(box(synth).app, "tc", "c1");
    expect(html).not.toContain("Playing style");
    expect(html).not.toContain(">All clips<");
    expect(count(html, /class="cp-playing"/g)).toBe(0);
    // the rest of the composer is there
    expect(count(html, /data-slot="/g)).toBe(8);
    expect(html).toContain(">Voicing<");
  });

  it("draws no harmony sheet: its Harmonize button asks the host, and is lit while the host says the sheet is open for it", () => {
    const app = box(bandSong()).app;
    const plain = draw(app, "tc", "c1");
    expect(count(plain, /class="chip hz-go"/g)).toBe(1);
    expect(plain).toContain('aria-expanded="false"');
    const lit = draw(app, "tc", "c1", { harmonizing: true });
    expect(count(lit, /class="chip hz-go on"/g)).toBe(1);
    for (const html of [plain, lit]) expect(html).not.toContain("hz-sheet");
    // nothing to harmonize with: no button
    const alone = songOf([chordsTrack("tc", "Chords", { lead: true })], {});
    expect(draw(box(alone).app, "tc", undefined)).not.toContain("hz-go");
  });

  it("a chord that starts past the end of the content is struck out: it is kept, and never played", () => {
    const short = songOf([chordsTrack("tc", "Chords", { lead: true })], { clips: [chordsClip("c1", "tc", 0, 8, { content: chordsContent(2, undefined, [chord("a", "C", 4), chord("b", "F", 4), chord("x", "G", 4), chord("y", "A", 2, "min")]) })] });
    const html = draw(box(short).app, "tc", "c1");
    expect(count(html, /data-slot="/g)).toBe(4);
    expect(count(html, /class="slot draggable st-\w+ out"/g)).toBe(2);
    // the ruler offers to make the clip as long as its chords
    expect(html).toContain("The clip ends before these chords do · make it 4 bars");
  });

  it("draws nothing for a track of another kind, or a clip that is gone", () => {
    const app = box(bandSong()).app;
    expect(draw(app, "tm", "m1")).toBe("");
    expect(draw(app, "td", "d1")).toBe("");
    expect(draw(app, "tc", "nothing")).toBe("");
  });

  it("the shape finder is not drawn until it is asked for, and the board is in its place", () => {
    const html = draw(box(bandSong()).app, "tc", "c1");
    expect(html).toContain('data-stage="board"');
    expect(html).not.toContain('class="finder');
    expect(html).not.toContain("cp-play ");
  });
});

describe("every chord edit, through the lens, lands in the open clip", () => {
  /** the song with everything but one clip's content, to see that nothing else moved */
  const rest = (song: TimelineSong, but: string) => ({ ...song, clips: song.clips.map((c) => (c.id === but ? { ...c, content: null, len: 0 } : c)) });
  /** make a change in clip c1 and hand back the box, having checked that only c1 changed, as one undo step */
  function change(fn: (ctx: Ctx) => void, song = bandSong()) {
    const b = box(song);
    const before = b.song();
    fn(lens(b.app, c1));
    expect(b.song()).not.toBe(before);
    expect(rest(b.song(), "c1")).toEqual(rest(before, "c1"));
    expect(b.song().tracks).toBe(before.tracks);
    expect(b.h.canUndo).toBe(true);
    b.app.undo();
    expect(b.song()).toBe(before);
    expect(b.h.canUndo).toBe(false);
    b.app.redo();
    return b;
  }

  it("add: a chord tapped on the board goes to the end, one bar long", () => {
    const b = change((ctx) => ctx.addChord({ root: "D", typeId: "min" }));
    const c = clipOf(b.song(), "c1").content;
    expect(names(c)).toEqual(["C", "F", "G", "Am", "C", "F", "G", "Am", "Dm"]);
    expect(c.chords[8].beats).toBe(4);
  });
  it("add by dragging: a chord dropped at a place in the row lands there, in the shape that was dragged", () => {
    const b = change((ctx) => ctx.set(dropChord({ ref: { root: "E", typeId: "min" }, voicingId: "022000" }, 1, () => "new")));
    const c = clipOf(b.song(), "c1").content;
    expect(names(c).slice(0, 3)).toEqual(["C", "Em", "F"]);
    expect(c.chords[1]).toMatchObject({ id: "new", beats: 4, voicingId: "022000" });
  });
  it("reorder: a chord of the tray dragged to another place moves there and keeps what it is", () => {
    const b = change((ctx) => ctx.set(dropChord({ ref: { root: "C", typeId: "maj" }, slotId: "c1" }, 2)));
    const c = clipOf(b.song(), "c1").content;
    expect(c.chords.slice(0, 3).map((x) => x.id)).toEqual(["c2", "c3", "c1"]);
    expect(c.chords.length).toBe(8);
  });
  it("reorder: let go outside the tray, or back where it was, changes nothing and makes no undo step", () => {
    const b = box(bandSong());
    const before = b.song();
    lens(b.app, c1).set(dropChord({ ref: { root: "C", typeId: "maj" }, slotId: "c1" }, null));
    lens(b.app, c1).set(dropChord({ ref: { root: "C", typeId: "maj" }, slotId: "c1" }, 0));
    lens(b.app, c1).set(dropChord({ ref: { root: "C", typeId: "maj" }, slotId: "gone" }, 3));
    expect(b.song()).toBe(before);
    expect(b.h.canUndo).toBe(false);
  });
  it("remove: the ✕ of a slot takes that chord out", () => {
    const b = change((ctx) => ctx.set(removeChord("c2")));
    expect(clipOf(b.song(), "c1").content.chords.map((x) => x.id)).toEqual(["c1", "c3", "c4", "c5", "c6", "c7", "c8"]);
  });
  it("length: the ruler's lengths are written to the chords named, in half beats", () => {
    const b = change((ctx) => ctx.set(setLengths({ c1: 6, c2: 2.2 })));
    expect(clipOf(b.song(), "c1").content.chords.slice(0, 3).map((x) => x.beats)).toEqual([6, 2, 4]);
  });
  it("rest: + Rest adds a bar of silence after the last chord", () => {
    const b = change((ctx) => ctx.set(addRest(() => "r1")));
    const c = clipOf(b.song(), "c1").content;
    expect(c.chords[8]).toMatchObject({ id: "r1", rest: true, beats: 4 });
    expect(names(c)[8]).toBe("-");
  });
  it("clear: every chord goes; the clip stays where it is, as long as it was", () => {
    const b = change((ctx) => ctx.set(clearChords));
    const c = clipOf(b.song(), "c1");
    expect(c.content.chords).toEqual([]);
    expect([c.start, c.len, c.content.bars]).toEqual([0, 32, 8]);
  });
  it("arrange: the neck area is the clip's own, and the shapes set by hand are let go", () => {
    const song = bandSong();
    const pinned = { ...song, clips: song.clips.map((c) => (c.id === "c1" && c.kind === "chords" ? { ...c, content: { ...c.content, chords: c.content.chords.map((x, i) => (i === 0 ? { ...x, voicingId: "x32010" } : x)) } } : c)) };
    const b = change((ctx) => ctx.set(setArrange({ zone: 2, strings: 4, inversions: true })), pinned);
    const c = clipOf(b.song(), "c1").content;
    expect(c.arrange).toEqual({ zone: 2, strings: 4, inversions: true });
    expect(c.chords.every((x) => x.voicingId === undefined)).toBe(true);
    // the other clip of the track keeps its own (none)
    expect(clipOf(b.song(), "c2").content.arrange).toBeUndefined();
    // "My shapes" takes it off again
    lens(b.app, c1).set(setArrange(null));
    expect(clipOf(b.song(), "c1").content.arrange).toBeUndefined();
  });
  it("a shape chosen for one chord is kept on it; while Arrange is on, the others keep the shapes they were shown in", () => {
    const b = change((ctx) => ctx.set(pinShape("c2", "133211", [])));
    expect(clipOf(b.song(), "c1").content.chords[1].voicingId).toBe("133211");
    expect(clipOf(b.song(), "c1").content.chords[0].voicingId).toBeUndefined();
    lens(b.app, c1).set(setArrange({ zone: 0, strings: "any", inversions: false }));
    const shown = clipOf(b.song(), "c1").content.chords.map((_, i) => ({ id: `shape-${i}` }) as never);
    lens(b.app, c1).set(pinShape("c3", "320003", shown));
    expect(clipOf(b.song(), "c1").content.chords.map((x) => x.voicingId).slice(0, 4)).toEqual(["shape-0", "shape-1", "320003", "shape-3"]);
  });
  it("make it N bars: the content is made longer, and a clip that showed all of it once grows with it", () => {
    const b = change((ctx) => ctx.set(setBars(10)));
    const c = clipOf(b.song(), "c1");
    expect(c.content.bars).toBe(10);
    expect(c.start).toBe(0);
    // with nothing after it on the track, the clip is as long as its content again
    const alone = songOf([chordsTrack("tc", "Chords", { lead: true })], { clips: [chordsClip("c1", "tc", 0, 8)] });
    const a = box(alone);
    lens(a.app, c1).set(setBars(3));
    expect([clipOf(a.song(), "c1").content.bars, clipOf(a.song(), "c1").len]).toEqual([3, 12]);
  });
  it("the playing style and the feel are the clip's own: the other clip of the track keeps its own", () => {
    const b = change((ctx) => ctx.set(setStyle("travis")));
    expect(clipOf(b.song(), "c1").content.style).toBe("travis");
    expect(clipOf(b.song(), "c2").content.style).toBe("ring");
    // the same style picked again writes nothing
    const now = b.song();
    lens(b.app, c1).set(setStyle("travis"));
    expect(b.song()).toBe(now);
    lens(b.app, c1).set((s) => ({ ...s, progression: { ...s.progression, feel: { speed: 0.5, swing: 0.4, touch: 0.5, spread: 0.5, octave: 0 } } }));
    expect(clipOf(b.song(), "c1").content.feel).toMatchObject({ speed: 0.5, swing: 0.4 });
    expect(clipOf(b.song(), "c2").content.feel).toBeUndefined();
  });
  it("on the draft: the same edits land in what is being composed, and no clip is made or changed", () => {
    const b = box(bandSong());
    const before = b.song();
    const draft: Target = { track: "tc" };
    lens(b.app, draft).addChord({ root: "A", typeId: "min" });
    lens(b.app, draft).addChord({ root: "F", typeId: "maj" });
    lens(b.app, draft).set(addRest(() => "r"));
    lens(b.app, draft).set(setStyle("strum"));
    const t = b.song().tracks.find((x) => x.id === "tc") as ChordsTrack;
    const content = t.draft!.content as ChordsContent;
    expect(names(content)).toEqual(["Am", "F", "-"]);
    expect(content.style).toBe("strum");
    expect(b.song().clips).toBe(before.clips);
    lens(b.app, draft).set(clearChords);
    expect(((b.song().tracks.find((x) => x.id === "tc") as ChordsTrack).draft!.content as ChordsContent).chords).toEqual([]);
  });
  it("the capo and a shape chosen for a chord everywhere are the app's, not the clip's: no undo step, the song untouched", () => {
    const b = box(bandSong());
    const song = b.song();
    const ctx = lens(b.app, c1);
    ctx.set((s) => ({ ...s, settings: { ...s.settings, capo: 2 } }));
    ctx.setShape({ root: "G", typeId: "maj" }, "320003");
    expect(b.get().settings.capo).toBe(2);
    expect(Object.values(b.get().shapes)).toEqual(["320003"]);
    expect(b.song()).toBe(song);
    expect(b.h.canUndo).toBe(false);
  });
});

describe("the chord that is lit follows the song beat", () => {
  const song = bandSong();
  it("on a placed clip: counted round its content, and none outside the clip or when it is not heard", () => {
    const open = openOf(song, { track: "tc", clip: "c2" }, 0)!;
    // c2 lies on beats 32 to 64, one chord to the bar
    expect(litChord(open, 32, true, 4)).toBe(0);
    expect(litChord(open, 35.9, true, 4)).toBe(0);
    expect(litChord(open, 36, true, 4)).toBe(1);
    expect(litChord(open, 63.5, true, 4)).toBe(7);
    expect(litChord(open, 31.9, true, 4)).toBe(-1);
    expect(litChord(open, 64, true, 4)).toBe(-1);
    expect(litChord(open, null, true, 4)).toBe(-1);
    expect(litChord(open, 40, false, 4)).toBe(-1);
  });
  it("a clip that repeats its content lights the same chords again; one opened part-way in starts part-way", () => {
    const two = chordsContent(2, undefined, [chord("x", "C", 4), chord("y", "F", 4)]);
    const s = songOf([chordsTrack("tc", "Chords", { lead: true })], { clips: [chordsClip("r", "tc", 8, 16, { content: two }), chordsClip("o", "tc", 32, 8, { off: 4, content: two })] });
    const r = openOf(s, { track: "tc", clip: "r" }, 0)!;
    expect([8, 12, 16, 20].map((b) => litChord(r, b, true, 4))).toEqual([0, 1, 0, 1]);
    const o = openOf(s, { track: "tc", clip: "o" }, 0)!;
    expect([32, 36].map((b) => litChord(o, b, true, 4))).toEqual([1, 0]);
    expect(posIn(o, 33, true)).toBe(5);
  });
  it("a chord past the end of the content is never lit; a silence between the last chord and the end lights none", () => {
    const long = chordsContent(1, undefined, [chord("x", "C", 2), chord("y", "F", 4)]);
    const s = songOf([chordsTrack("tc", "Chords", { lead: true })], { clips: [chordsClip("a", "tc", 0, 4, { content: long }), chordsClip("b", "tc", 8, 8, { content: chordsContent(2, undefined, [chord("x", "C", 4)]) })] });
    const a = openOf(s, { track: "tc", clip: "a" }, 0)!;
    expect([0, 2, 3.5].map((b) => litChord(a, b, true, 4))).toEqual([0, 1, 1]);
    const b = openOf(s, { track: "tc", clip: "b" }, 0)!;
    expect([8, 12].map((x) => litChord(b, x, true, 4))).toEqual([0, -1]);
  });
  it("on a draft: counted from where the draft is treated as lying, while it is heard", () => {
    const b = box(bandSong());
    lens(b.app, { track: "tc" }).addChord({ root: "A", typeId: "min" });
    lens(b.app, { track: "tc" }).addChord({ root: "F", typeId: "maj" });
    const open = openOf(b.song(), { track: "tc" }, 16)!;
    expect(open.span).toEqual({ from: 16, to: 32 });
    expect([16, 20, 24, 15.9, 32].map((x) => litChord(open, x, true, 4))).toEqual([0, 1, -1, -1, -1]);
    expect(litChord(open, 16, false, 4)).toBe(-1);
  });
});

describe("the shape finder closes when its chord is gone", () => {
  const chords = chordsContent(2).chords;
  const on = (slotId?: string): SheetState => ({ ref: { root: "C", typeId: "maj" }, ...(slotId ? { slotId } : {}) });
  it("one opened for a chord of the tray is shown only while that chord is in the tray; one for a chord of the board stays", () => {
    expect(finderShown(null, chords)).toBe(false);
    expect(finderShown(on("c1"), chords)).toBe(true);
    expect(finderShown(on("c1"), chords.filter((c) => c.id !== "c1"))).toBe(false);
    expect(finderShown(on("c1"), [])).toBe(false);
    expect(finderShown(on(), [])).toBe(true);
  });
  /** the finder as the window draws it (a panel), with the sheet set to something */
  function finder(app: Ctx5, sheet: SheetState | null): string {
    const Inner = () => {
      const ctx = useApp();
      return createElement(AppCtx.Provider, { value: { ...ctx, sheet } }, createElement(ShapeFinder, { panel: true, slotShape: () => undefined, onPinSlot: no }));
    };
    return renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app }, createElement(ClipLens, { target: c1, pane: "rhythm" }, createElement(Inner))));
  }
  it("drawn as a panel of the window (not a sheet over the page), with its slot tools, flavours and shape tabs", () => {
    const b = box(bandSong());
    const html = finder(b.app, on("c1"));
    expect(html).toContain('class="finder panel"');
    expect(html).toContain('role="region"');
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain("1 of 8");
    expect(html).toContain(">Remove<");
    for (const tab of ["Common", "Small", "Inversions", "All"]) expect(html).toContain(`>${tab}<`);
    expect(count(html, /class="shape-card draggable/g)).toBeGreaterThan(2);
    // for a chord of the board: "+ Add" in place of the slot tools
    const board = finder(b.app, on());
    expect(board).toContain("+ Add");
    expect(board).not.toContain(">Remove<");
  });
  it("draws nothing once its chord has been taken out of the tray", () => {
    const b = box(bandSong());
    expect(finder(b.app, on("c1"))).not.toBe("");
    lens(b.app, c1).set(removeChord("c1"));
    expect(finder(b.app, on("c1"))).toBe("");
    // and nothing when it was never opened
    expect(finder(b.app, null)).toBe("");
  });
  it("without `panel` it is the sheet it always was", () => {
    const b = box(bandSong());
    const Inner = () => createElement(AppCtx.Provider, { value: { ...useApp(), sheet: on("c1") } }, createElement(ShapeFinder, { slotShape: () => undefined, onPinSlot: no }));
    const html = renderToStaticMarkup(createElement(App5Ctx.Provider, { value: b.app }, createElement(ClipLens, { target: c1, pane: "rhythm" }, createElement(Inner))));
    expect(html).toContain('class="finder"');
    expect(html).toContain('role="dialog"');
  });
});

describe("\"All clips\"", () => {
  const feel = { speed: 0.5 as const, swing: 0.3, touch: 0.5, spread: 0.5, octave: 0 as const };
  /** two chords tracks with two clips each, each clip with its own neck area and a shape set by hand */
  function song(): TimelineSong {
    const a = bandSong();
    const more = songOf([...a.tracks, chordsTrack("t2", "Chords 2")], { ...a, tracks: [...a.tracks, chordsTrack("t2", "Chords 2")], clips: [...a.clips, chordsClip("e1", "t2", 0, 16), chordsClip("e2", "t2", 16, 16)] });
    return { ...more, clips: more.clips.map((c) => (c.id === "c2" && c.kind === "chords" ? { ...c, content: { ...c.content, arrange: { zone: 1, strings: "any" as const, inversions: false }, feel: { swing: 0.9 } } } : c)) };
  }
  it("writes the style and the feel to every clip of the track, and nothing else", () => {
    const before = song();
    const after = playingToAll(before, "tc", "travis", feel);
    for (const id of ["c1", "c2"]) {
      expect(clipOf(after, id).content.style).toBe("travis");
      expect(clipOf(after, id).content.feel).toEqual(feel);
      // the chords, their lengths and shapes, the bars and the neck area are as they were
      const { style: _s, feel: _f, ...now } = clipOf(after, id).content;
      const { style: _s2, feel: _f2, ...was } = clipOf(before, id).content;
      expect(now).toEqual(was);
      const { content: _c, ...clip } = clipOf(after, id);
      const { content: _c2, ...clipWas } = clipOf(before, id);
      expect(clip).toEqual(clipWas);
    }
    // every other clip is the very same object; the tracks (and a draft on them) are untouched
    for (const c of before.clips) if (c.track !== "tc") expect(after.clips.find((x) => x.id === c.id)).toBe(c);
    expect(after.tracks).toBe(before.tracks);
    expect({ ...after, clips: [] }).toEqual({ ...before, clips: [] });
    expect(allPlayAs(after, "tc", "travis", feel)).toBe(true);
    expect(allPlayAs(after, "t2", "travis", feel)).toBe(false);
  });
  it("a feel that was never touched takes the feel off the other clips", () => {
    const after = playingToAll(song(), "tc", "strum", undefined);
    expect(clipOf(after, "c2").content.feel).toBeUndefined();
    expect("feel" in clipOf(after, "c2").content).toBe(false);
    expect(clipOf(after, "c2").content.style).toBe("strum");
  });
  it("the same song back when every clip plays that way already (a plain feel and none are the same); a clip that does keeps its object", () => {
    const s = bandSong();
    expect(playingToAll(s, "tc", "ring", undefined)).toBe(s);
    expect(playingToAll(s, "tc", "ring", { speed: 1, swing: 0, touch: 0.5, spread: 0.5, octave: 0 })).toBe(s);
    const one = { ...s, clips: s.clips.map((c) => (c.id === "c1" && c.kind === "chords" ? { ...c, content: { ...c.content, style: "strum" as const } } : c)) };
    const after = playingToAll(one, "tc", "strum", undefined);
    expect(after.clips.find((c) => c.id === "c1")).toBe(one.clips.find((c) => c.id === "c1"));
    expect(clipOf(after, "c2").content.style).toBe("strum");
  });
  it("does not touch the track's draft", () => {
    const b = box(bandSong());
    lens(b.app, { track: "tc" }).addChord({ root: "A", typeId: "min" });
    const draft = (b.song().tracks.find((t) => t.id === "tc") as ChordsTrack).draft;
    const after = playingToAll(b.song(), "tc", "travis", feel);
    expect((after.tracks.find((t) => t.id === "tc") as ChordsTrack).draft).toBe(draft);
  });
});

describe("where a dragged chord lands among the chords of the tray", () => {
  const box4 = (left: number, top: number) => ({ left, top, width: 100, bottom: top + 140 });
  it("in one row: before the first chord whose middle is right of the pointer", () => {
    const row = [box4(0, 0), box4(110, 0), box4(220, 0)];
    expect(placeIn(row, 10, 70)).toBe(0);
    expect(placeIn(row, 60, 70)).toBe(1);
    expect(placeIn(row, 159, 70)).toBe(1);
    expect(placeIn(row, 161, 70)).toBe(2);
    expect(placeIn(row, 900, 70)).toBe(3);
    // a little above or under the row counts as on it
    expect(placeIn(row, 60, -20)).toBe(1);
    expect(placeIn(row, 60, 160)).toBe(1);
    expect(placeIn([], 60, 70)).toBe(0);
  });
  it("on rows (a tall window): a chord on a row under the pointer comes after, one on a row above before", () => {
    const rows = [box4(0, 0), box4(110, 0), box4(0, 150), box4(110, 150)];
    expect(placeIn(rows, 10, 70)).toBe(0);
    expect(placeIn(rows, 500, 70)).toBe(2);
    expect(placeIn(rows, 10, 200)).toBe(2);
    expect(placeIn(rows, 60, 200)).toBe(3);
    expect(placeIn(rows, 500, 200)).toBe(4);
    // between the rows: after the last chord of the row above
    expect(placeIn(rows, 10, 145)).toBe(2);
  });
});

describe("stepping through the playing styles", () => {
  it("‹ and › go round the styles of the same kind", () => {
    expect(stepStyle("ring", 1)).not.toBe("ring");
    expect(stepStyle(stepStyle("ring", 1), -1)).toBe("ring");
    let id = stepStyle("travis", 1);
    let n = 1;
    while (id !== "travis" && n < 100) (id = stepStyle(id, 1)), n++;
    expect(n).toBeGreaterThan(3);
    expect(n).toBeLessThan(100);
  });
});
