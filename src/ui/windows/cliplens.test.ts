// The old pages' whole world for one clip: what they change in their small song goes back into the real one, and
// everything else they change (a rhythm saved, the capo, a studio setting) reaches the real state.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BeatPattern } from "../../audio/beats";
import { getTuning } from "../../guitar/tunings";
import { convertAll } from "../../timeline/convert";
import { makeHistory } from "../../timeline/history";
import type { Target } from "../../timeline/lens";
import type { ChordsClip, DrumsClip } from "../../timeline/model";
import { bandSong } from "../../timeline/testsongs";
import { App5Ctx, editIn, editKeyedIn, stepIn, type App5State, type Ctx5, type Toast5 } from "../app5";
import { DEFAULT_STATE, useApp, type AppState, type Ctx } from "../state";
import { ClipLens, V4View, controlOf, lensSet, useLens, v4View, type LensInfo } from "./ClipLens";

/** The app's state held in a plain box, with every way to change it: what the provider is, without a screen. */
function box(start: App5State) {
  let s = start;
  const h = makeHistory();
  const toasts: { msg: string; action?: Toast5 }[] = [];
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
    tuning: getTuning("standard"),
    toast: (msg, action) => { toasts.push({ msg, action }); },
    idea: null, dirty: false, opened: 0,
    saveIdea: () => "nothing", openIdea: () => {}, newIdea: () => {}, renameIdea: () => {}, deleteIdea: () => {},
    importIdeas: () => 0, cloud: "local", syncNow: () => {}, recordingTo: null, setRecordingTo: () => {},
  };
  return { app, get: () => s, toasts, h };
}
const start = (): App5State => ({ ...convertAll(DEFAULT_STATE, 1), song: bandSong(), key: { tonic: "C", scaleId: "ionian" } });

/** Draw something inside a lens (or the plain old view) once, and hand back the old context it was given. */
function inside(app: Ctx5, wrap: (children: ReactNode) => ReactNode): { ctx: Ctx; info: LensInfo | null } {
  let got: { ctx: Ctx; info: LensInfo | null } | null = null;
  const Probe = () => {
    got = { ctx: useApp(), info: useLens() };
    return null;
  };
  renderToStaticMarkup(createElement(App5Ctx.Provider, { value: app }, wrap(createElement(Probe))));
  if (!got) throw new Error("nothing was drawn");
  return got;
}
const lens = (app: Ctx5, target: Target, pane: "rhythm" | "melody" | "drums" = "rhythm") => inside(app, (c) => createElement(ClipLens, { target, pane }, c));
const chords1: Target = { track: "tc", clip: "c1" };
const drums1: Target = { track: "td", clip: "d1" };

describe("one clip as the old pages' whole world", () => {
  it("the song the old pages see is the clip's; every other field is the real app's", () => {
    const b = box(start());
    const { ctx, info } = lens(b.app, chords1);
    expect(ctx.state.progression.chords).toEqual((b.get().song.clips.find((c) => c.id === "c1") as ChordsClip).content.chords);
    expect(ctx.state.progression.song ?? null).toBeNull();
    for (const k of ["key", "settings", "shapes", "myBeats", "myKits", "mySounds"] as const) expect(ctx.state[k]).toBe(b.get()[k]);
    // the lead chords track is the old first chords track
    expect(info?.openId).toBe("chords");
    expect(info?.lens.span).toEqual({ from: 0, to: 32 });
    expect(lens(b.app, drums1, "drums").info?.openId).toBe("td");
    // a clip that is gone gives nothing to draw
    expect(() => lens(b.app, { track: "tc", clip: "nope" })).toThrow("nothing was drawn");
  });

  it("a chord added inside lands in the clip, as one undo step, and nowhere else", () => {
    const b = box(start());
    const before = b.get();
    lens(b.app, chords1).ctx.addChord({ root: "D", typeId: "min" });
    const now = b.get().song.clips.find((c) => c.id === "c1") as ChordsClip;
    const was = before.song.clips.find((c) => c.id === "c1") as ChordsClip;
    expect(now.content.chords.length).toBe(was.content.chords.length + 1);
    expect(now.content.chords[now.content.chords.length - 1].ref).toEqual({ root: "D", typeId: "min" });
    expect(b.get().song.clips.filter((c) => c.id !== "c1")).toEqual(before.song.clips.filter((c) => c.id !== "c1"));
    expect(b.get().song.tracks).toBe(before.song.tracks);
    expect(b.h.canUndo).toBe(true);
    b.app.undo();
    expect(b.get().song).toBe(before.song);
    expect(b.h.canUndo).toBe(false);
  });

  it("saving a rhythm inside the lens grows the real list of rhythms, and is no undo step", () => {
    const b = box(start());
    const song = b.get().song;
    const mine = { id: "r1", name: "Mine 1", group: "mine" } as unknown as BeatPattern;
    lens(b.app, drums1, "drums").ctx.set((s) => ({ ...s, myBeats: [...s.myBeats, mine] }));
    expect(b.get().myBeats).toEqual([mine]);
    expect(b.get().song).toBe(song);
    expect(b.h.canUndo).toBe(false);
    // deleting one works the same way
    lens(b.app, drums1, "drums").ctx.set((s) => ({ ...s, myBeats: s.myBeats.filter((x) => x.id !== "r1") }));
    expect(b.get().myBeats).toEqual([]);
  });

  it("a capo change inside reaches the real settings; a chosen shape and bars on screen too", () => {
    const b = box(start());
    const { ctx } = lens(b.app, chords1);
    ctx.set((s) => ({ ...s, settings: { ...s.settings, capo: 3 } }));
    expect(b.get().settings.capo).toBe(3);
    ctx.setShape({ root: "C", typeId: "maj" }, "x32010");
    expect(Object.values(b.get().shapes)).toEqual(["x32010"]);
    ctx.set((s) => ({ ...s, view: { ...s.view, bars: 8 } }));
    expect(b.get().view).toMatchObject({ bars: 8 });
    expect(b.h.canUndo).toBe(false);
  });

  it("a rhythm picked inside goes to the clip, and the kit to the track; knobs of the kit fold into one step", () => {
    const b = box(start());
    const { ctx } = lens(b.app, drums1, "drums");
    const was = b.get().song.clips.find((c) => c.id === "d1") as DrumsClip;
    ctx.set((s) => ({ ...s, progression: { ...s.progression, beat: { ...s.progression.beat!, swing: 0.3, name: "Swung" } } }));
    const now = b.get().song.clips.find((c) => c.id === "d1") as DrumsClip;
    expect(now.content.name).toBe("Swung");
    expect(now.content.swing).toBe(0.3);
    expect(now.len).toBe(was.len);
    // what a held knob makes many of in a row is named as one control; something written is not
    const p = lens(b.app, drums1, "drums").ctx.state.progression;
    expect(controlOf(p, { ...p, beat: { ...p.beat!, level: 0.5 } }, "td")).toBe("lens:td:kit");
    expect(controlOf(p, { ...p, beat: { ...p.beat!, swing: 0.1 } }, "td")).toBeUndefined();
    expect(controlOf(p, { ...p, sound: { drive: 0.2 } }, "tc")).toBe("lens:tc:sound");
    expect(controlOf(p, p, "tc")).toBeUndefined();
  });

  it("a toast's condition is given the old view of the state, never the new state itself", () => {
    const b = box(start());
    const { ctx } = lens(b.app, chords1);
    let seen: AppState | null = null;
    ctx.toast("Pasted", { label: "↶", aria: "Undo", run: () => {}, when: (s) => { seen = s; return s.progression.chords.length > 0; } });
    const sent = b.toasts[0];
    expect(sent.msg).toBe("Pasted");
    // (the real provider calls it with the new state: called raw, an old page's condition would throw there)
    expect(() => sent.action!.when!(b.get())).not.toThrow();
    expect(sent.action!.when!(b.get())).toBe(true);
    expect(seen!.progression.chords.length).toBe(8);
    // a state whose clip is gone: the condition is asked on an empty old song, and says no
    expect(sent.action!.when!({ ...b.get(), song: { ...b.get().song, clips: [] } })).toBe(false);
    // a plain message passes as it is
    ctx.toast("Hello");
    expect(b.toasts[1]).toEqual({ msg: "Hello", action: undefined });
  });

  it("each lens has its own sheet: one opened in a window is not open in another", () => {
    const b = box(start());
    let one: Ctx | null = null;
    let two: Ctx | null = null;
    const A = () => { one = useApp(); return null; };
    const B = () => { two = useApp(); return null; };
    renderToStaticMarkup(createElement(App5Ctx.Provider, { value: b.app },
      createElement(ClipLens, { target: chords1 }, createElement(A)),
      createElement(ClipLens, { target: { track: "tc", clip: "c2" } }, createElement(B))));
    expect(one!.sheet).toBeNull();
    expect(two!.sheet).toBeNull();
    // (two separate pieces of state: neither window's way to open its sheet is the other's)
    expect(one!.openSheet).not.toBe(two!.openSheet);
    expect(one!.state.progression).not.toBe(two!.state.progression);
  });

  it("the plain old view: a change to the song is dropped, a change to the studio passes through", () => {
    const b = box(start());
    const song = b.get().song;
    const { ctx, info } = inside(b.app, (c) => createElement(V4View, null, c));
    expect(info).toBeNull();
    expect(ctx.state.progression.chords).toEqual([]);
    expect(ctx.state.progression.bpm).toBe(song.bpm);
    ctx.set((s) => ({ ...s, progression: { ...s.progression, bpm: 200, chords: [{ id: "x", ref: { root: "C", typeId: "maj" }, beats: 4 }] }, studio: { ...s.studio, countIn: 2 } }));
    expect(b.get().song).toBe(song);
    expect(b.h.canUndo).toBe(false);
    expect(b.get().studio).toMatchObject({ countIn: 2 });
    ctx.set((s) => ({ ...s, canvas: { palette: "dusk" } }));
    expect(b.get().canvas).toEqual({ palette: "dusk" });
    // a page asking for the old Frame page (its key chip) asks the host instead
    let asked = 0;
    lensSet(b.app, null, "track", (s) => ({ ...s, pane: "frame" }), () => asked++);
    expect(asked).toBe(1);
  });

  it("the old view of a state is the same object's fields, with the song handed in", () => {
    const s = start();
    const p = { ...DEFAULT_STATE.progression, bpm: 99 };
    const v = v4View(s, p, "melody");
    expect(v.progression).toBe(p);
    expect(v.pane).toBe("melody");
    expect(v.settings).toBe(s.settings);
    expect(v.saved).toEqual([]);
  });
});
