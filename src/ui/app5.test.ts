// The plain rules of the app's state once a song is tracks and clips: undo for the whole idea, opening and saving
// ideas, what makes an idea "changed", and what is written.
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportIdeas } from "../song/library";
import { backupId, convertAll } from "../timeline/convert";
import { renudge5, stampTakes5 } from "../timeline/audioclips";
import { addTrack, moveClips, setTempo } from "../timeline/edit";
import { fixture, fixtures } from "../timeline/fixtures5";
import { makeHistory } from "../timeline/history";
import { exportIdeas5 } from "../timeline/library5";
import type { AudioTrack, Take5 } from "../timeline/model";
import { storedText } from "../timeline/store5";
import { audioTrack, bandSong, songOf, take } from "../timeline/testsongs";
import { afterRestore, arriveAll, onScreen, deleteIn, dirtyOf, editIn, editKeyedIn, importIn, mayArrive, newIn, openIn, restoreIn, saveIn, stepIn, type App5State } from "./app5";
import { DEFAULT_STATE, loadV4, type SavedProgression } from "./state";

const json = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** A state as the first start of the new build makes it: three old ideas converted, the second on screen. */
const start = (): App5State => convertAll(loadV4(JSON.stringify({ ...json(DEFAULT_STATE), saved: JSON.parse(exportIdeas(fixtures().slice(0, 3))).ideas, progression: fixture(2).progression, key: fixture(2).key, ideaId: "fixture-2" })), 5000);
const later = (i: SavedProgression, at: number, bpm = 133): SavedProgression => ({ ...i, updatedAt: at, progression: { ...i.progression, bpm } });

afterEach(() => vi.useRealTimers());

describe("one undo for the whole idea", () => {
  it("an edit is one step; an edit that changes nothing is none", () => {
    const h = makeHistory();
    const s0 = start();
    const s1 = editIn(s0, h, "Tempo", (song) => setTempo(song, 120));
    expect(s1.song.bpm).toBe(120);
    expect(h.canUndo).toBe(true);
    expect(editIn(s1, h, "Nothing", (song) => song)).toBe(s1);
    const back = stepIn(s1, h, true, false);
    expect(back.song).toBe(s0.song);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);
    expect(stepIn(back, h, false, false).song.bpm).toBe(120);
    // with nothing to undo the state comes back as it is
    const h2 = makeHistory();
    expect(stepIn(s0, h2, true, false)).toBe(s0);
  });

  it("two edits from one control inside half a second are one step; later ones, or from another control, are their own", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const h = makeHistory();
    let s = start();
    const first = s.song;
    s = editIn(s, h, "Tempo", (song) => setTempo(song, 100), "tempo");
    vi.setSystemTime(1200);
    s = editIn(s, h, "Tempo", (song) => setTempo(song, 101), "tempo");
    vi.setSystemTime(1400);
    s = editIn(s, h, "Tempo", (song) => setTempo(song, 102), "tempo");
    expect(stepIn(s, h, true, false).song).toBe(first);
    expect(h.canUndo).toBe(false);
    // a pause, then the same control again: a step of its own
    s = stepIn(stepIn(s, h, true, false), h, false, false);
    vi.setSystemTime(3000);
    s = editIn(s, h, "Tempo", (song) => setTempo(song, 110), "tempo");
    expect(stepIn(s, h, true, false).song.bpm).toBe(102);
  });

  it("undo puts the song and the key back together", () => {
    const h = makeHistory();
    const s0 = start();
    const s1 = editKeyedIn(s0, h, "Move song", (song) => ({ song: setTempo(song, 90), key: { tonic: "D", scaleId: "ionian" } }));
    expect(s1.key.tonic).toBe("D");
    const back = stepIn(s1, h, true, false);
    expect(back.key).toBe(s0.key);
    expect(back.song).toBe(s0.song);
    const again = stepIn(back, h, false, false);
    expect(again.key.tonic).toBe("D");
    expect(again.song.bpm).toBe(90);
    // nothing changed: no step
    expect(editKeyedIn(s0, makeHistory(), "Move song", (song, key) => ({ song, key }))).toBe(s0);
  });

  it("undo keeps every recording, and does nothing while a recording runs", () => {
    const h = makeHistory();
    const s0: App5State = { ...start(), song: bandSong() };
    const take: Take5 = { id: "new-take", n: 9, group: "g9", dry: "d.wav", wet: "w.wav", rate: 48000, start: 0, frames: 48000, at: 0 };
    // a recording arrives (as one step), then it is undone: the take is still on its track, unplaced
    const s1 = editIn(s0, h, "Record", (song) => ({ ...song, tracks: song.tracks.map((t) => (t.id === "tv" ? { ...(t as AudioTrack), takes: [...(t as AudioTrack).takes, take] } : t)) }));
    expect(stepIn(s1, h, true, true)).toBe(s1);
    expect(h.canUndo).toBe(true);
    const back = stepIn(s1, h, true, false);
    const tv = back.song.tracks.find((t) => t.id === "tv") as AudioTrack;
    expect(tv.takes.find((k) => k.id === "new-take")).toMatchObject({ at: null });
    // a track added and undone leaves nothing behind
    const h2 = makeHistory();
    const s2 = editIn(s0, h2, "Add track", (song) => addTrack(song, "bass", "tx"));
    expect(stepIn(s2, h2, true, false).song.tracks.some((t) => t.id === "tx")).toBe(false);
  });
});

describe("the ideas list", () => {
  it("opening another idea clears the undo steps, starts a new session and arms nothing", () => {
    const h = makeHistory();
    let s = start();
    s = editIn(s, h, "Tempo", (song) => setTempo(song, 120));
    s = { ...s, session: { ...s.session, armed: "v1", cursor: 9, loop: { regions: [{ from: 0, to: 4 }], on: true }, pxPerBeat: 30, sel: { clips: ["x"], track: "t-chords" } } };
    const opened = openIn(s, h, "fixture-3");
    expect(opened.ideaId).toBe("fixture-3");
    expect(opened.song.tracks.length).toBe(5);
    expect(opened.session).toEqual({ cursor: 0, loop: null, sel: { clips: [], track: null }, pxPerBeat: 0, scroll: 0, armed: null, windows: [] });
    expect(h.canUndo).toBe(false);
    expect(stepIn(opened, h, true, false)).toBe(opened);
    // an idea just opened is not changed
    expect(dirtyOf(opened)).toBe(false);
    // an id that is not an idea, or a backup entry, opens nothing this way
    expect(openIn(s, h, "nope")).toBe(s);
    expect(openIn(s, makeHistory(), backupId("fixture-1"))).toBe(s);
  });

  it("a new idea: the three tracks every idea starts with, the tempo kept, nothing to undo, nothing to save", () => {
    const h = makeHistory();
    let s = start();
    s = editIn(s, h, "Tempo", (song) => setTempo(song, 132));
    const fresh = newIn(s, h, "d9");
    expect(fresh.ideaId).toBeNull();
    expect(fresh.draft).toBe("d9");
    expect(fresh.song.tracks.map((t) => t.kind)).toEqual(["chords", "melody", "drums"]);
    expect(fresh.song.clips).toEqual([]);
    expect(fresh.song.bpm).toBe(132);
    expect(h.canUndo).toBe(false);
    expect(dirtyOf(fresh)).toBe(false);
    expect(saveIn(fresh, false, "n1", 1).result).toBe("nothing");
  });

  it("what is open, selected, looped or where a window stands never makes an idea changed; the music, the key and the capo do", () => {
    const s = start();
    expect(dirtyOf(s)).toBe(false);
    const moved: App5State = { ...s, session: { ...s.session, cursor: 12, pxPerBeat: 40, scroll: 3, armed: "v1", loop: { regions: [{ from: 0, to: 8 }], on: true }, sel: { clips: ["b1.chords"], track: "t-chords" }, windows: [{ id: "compose:t-chords", kind: "compose", track: "t-chords", x: 1, y: 2, w: 300, h: 200, open: true }] } };
    expect(dirtyOf(moved)).toBe(false);
    expect(dirtyOf({ ...moved, session: { ...moved.session, windows: [{ ...moved.session.windows[0], x: 500, y: 90 }] } })).toBe(false);
    expect(dirtyOf({ ...s, song: setTempo(s.song, 97) })).toBe(true);
    expect(dirtyOf({ ...s, key: { tonic: "D", scaleId: "ionian" } })).toBe(true);
    // (an old idea saved before ideas kept their capo follows the capo in use; once saved here it has its own)
    expect(dirtyOf({ ...s, settings: { ...s.settings, capo: 2 } })).toBe(false);
    const kept = saveIn({ ...s, song: setTempo(s.song, 98) }, false, "x", 1).state;
    expect(dirtyOf({ ...kept, settings: { ...kept.settings, capo: 2 } })).toBe(true);
    // an idea never saved is changed as soon as there is something in it
    expect(dirtyOf({ ...s, ideaId: null })).toBe(true);
  });

  it("saving: the open idea is updated and stays as converted from its old copy; a first save adds it; a copy is another idea", () => {
    const s = { ...start(), song: setTempo(start().song, 101) };
    const up = saveIn(s, false, "n1", 9000);
    expect(up.result).toBe("updated");
    const mine = up.state.saved.find((i) => i.id === "fixture-2")!;
    expect(mine).toMatchObject({ updatedAt: 9000, from: { at: fixture(2).updatedAt } });
    expect(mine.song.bpm).toBe(101);
    expect(dirtyOf(up.state)).toBe(false);
    const copy = saveIn(up.state, true, "n2", 9100);
    expect(copy.result).toBe("new");
    expect(copy.state.ideaId).toBe("n2");
    expect(copy.state.saved[0]).toMatchObject({ id: "n2", name: "Fixture 2 copy", savedAt: 9100 });
    const first = saveIn({ ...s, ideaId: null, draft: "d1" }, false, "n3", 9200);
    expect(first.result).toBe("new");
    expect(first.state.ideaId).toBe("n3");
    expect(first.state.saved[0].name).toMatch(/idea 1$/);
  });

  it("a deleted idea, or backup entry, leaves the list and its deletion is noted; the idea open stays on screen, not saved", () => {
    const s = start();
    const gone = deleteIn(s, "fixture-2", "d5", 7000);
    expect(gone.saved.some((i) => i.id === "fixture-2")).toBe(false);
    expect(gone.tombs).toMatchObject({ "fixture-2": 7000 });
    expect(gone.ideaId).toBeNull();
    expect(gone.draft).toBe("d5");
    expect(gone.song).toBe(s.song);
    const b = deleteIn(s, "fixture-1-v4", "d6", 7100);
    expect(b.saved.some((i) => i.id === "fixture-1-v4")).toBe(false);
    expect(b.tombs).toMatchObject({ "fixture-1-v4": 7100 });
    expect(b.ideaId).toBe("fixture-2");
  });

  it("a backup entry opens as a new restored idea; the entry stays", () => {
    const h = makeHistory();
    const s = start();
    const back = restoreIn(s, h, fixture(1), "r1", 8000);
    expect(back.ideaId).toBe("r1");
    expect(back.saved[0]).toMatchObject({ id: "r1", name: "Fixture 1 (restored)", savedAt: 8000 });
    expect(back.saved[0].from).toBeUndefined();
    expect(back.saved.some((i) => i.id === "fixture-1-v4")).toBe(true);
    expect(back.saved.filter((i) => i.backup).length).toBe(s.saved.filter((i) => i.backup).length);
    expect(back.song.clips.map((c) => c.id)).toEqual(s.saved.find((i) => i.id === "fixture-1")!.song.clips.map((c) => c.id));
    expect(dirtyOf(back)).toBe(false);
    // the unsaved changes of an idea come back under the idea's own name
    expect(restoreIn(s, makeHistory(), { ...fixture(2), id: "fixture-2-u", name: "Fixture 2 (unsaved)" }, "r2", 1).saved[0].name).toBe("Fixture 2 (restored)");
  });

  it("the armed track is not in what is stored", () => {
    const s = start();
    const text = storedText({ ...s, session: { ...s.session, armed: "v1" }, unsaved: true });
    expect(JSON.parse(text).session.armed).toBeNull();
    expect(JSON.parse(text).unsaved).toBeUndefined();
  });
});

describe("backup files and old copies", () => {
  it("a version 1 file restored again doubles nothing; a version 2 file brings its ideas, backup entries and their originals", () => {
    const s = start();
    const v1 = exportIdeas(fixtures().slice(0, 3));
    const again = importIn(s, v1);
    expect(again.added).toBe(0);
    expect(again.state).toBe(s);
    // (they are here already: looked at once more, against what they were converted from, and passed over)
    expect(arriveAll(s, again.later, (id) => fixtures().find((f) => f.id === id) ?? null).state).toBe(s);
    // an old idea that is not here yet is converted and added, with its backup entry
    const more = importIn(s, exportIdeas([fixture(6)]));
    expect(more.added).toBe(1);
    expect(more.state.saved.map((i) => i.id)).toEqual(expect.arrayContaining(["fixture-6", "fixture-6-v4"]));
    // a version 2 file on a machine that has nothing
    const blank: App5State = { ...s, saved: [], ideaId: null };
    const file = exportIdeas5(s.saved, { "fixture-1-v4": fixture(1) });
    const r = importIn(blank, file);
    expect(r.added).toBe(3);
    expect(r.state.saved.filter((i) => i.backup).length).toBe(s.saved.filter((i) => i.backup).length);
    expect(Object.keys(r.originals)).toEqual(["fixture-1-v4"]);
    expect(importIn(r.state, file).added).toBe(0);
    expect(importIn(s, "not a file").added).toBe(0);
  });

  it("old copies that turn up: only those that could change anything are looked at; a newer one of an edited idea goes beside it and is kept", () => {
    const s = start();
    const t = fixture(2).updatedAt!;
    expect(mayArrive(s, "fixture-2", t)).toBe(false);
    expect(mayArrive(s, "fixture-2", t + 1)).toBe(true);
    expect(mayArrive(s, "fixture-9", 1)).toBe(true);
    expect(mayArrive({ ...s, tombs: { "fixture-9": 5 } }, "fixture-9", 5)).toBe(false);
    const edited = saveIn({ ...s, song: setTempo(s.song, 101) }, false, "x", t + 100).state;
    const r = arriveAll(edited, [later(fixture(2), t + 500), later(fixture(1), fixture(1).updatedAt! + 5, 140)], (id) => fixtures().find((f) => f.id === id) ?? null);
    expect(r.beside).toBe(1);
    expect(r.refreshed).toEqual(["fixture-1"]);
    expect(r.keep.map((k) => k.stem)).toEqual(["fixture-2-o", "fixture-1"]);
    expect(r.state.saved.find((i) => i.id === "fixture-2-o")!.name).toBe("Fixture 2 (edited in the old version)");
    expect(r.state.saved.find((i) => i.id === "fixture-1")!.song.bpm).toBe(140);
  });
});

describe("the timing nudge and the songs that come back", () => {
  const takesOf = (s: App5State) => (s.song.tracks.find((t) => t.id === "tv") as AudioTrack).takes;
  /** the band's song on screen, saved as an idea; its one take does not say which nudge it was cut with */
  const withIdea = (): App5State => {
    const s0 = start();
    return { ...s0, song: bandSong(), ideaId: "band", saved: [{ id: "band", name: "Band", key: s0.key, song: bandSong(), savedAt: 1, updatedAt: 1 }, ...s0.saved] };
  };

  it("a song that comes on screen has every take at the nudge in use, and each says so", () => {
    // one take cut with no nudge, one with 10 ms (480 frames), one that does not say
    const song = songOf([audioTrack("tv", "vocals", "Vocal 1", [take("a", 2, 0, { start: 1000, nudge: 0 }), take("b", 2, 0, { start: 1000, nudge: 480 }), take("c", 2, 0, { start: 1000 })])]);
    const out = onScreen(song, 10);
    expect((out.tracks[0] as AudioTrack).takes.map((k) => [k.start, k.nudge])).toEqual([[1480, 480], [1000, 480], [1000, 480]]);
    // and nothing changes the second time
    expect(onScreen(out, 10)).toBe(out);
    expect(afterRestore(out, 10)).toBe(out);
    expect(afterRestore(out, undefined)).not.toBe(out);
    // a song brought back by an undo: its takes move, and one that does not say its nudge is left as it is
    const back = afterRestore(song, 10);
    expect((back.tracks[0] as AudioTrack).takes.map((k) => [k.start, k.nudge])).toEqual([[1480, 480], [1000, 480], [1000, undefined]]);
    expect(afterRestore(bandSong(), 10)).toEqual(bandSong());
  });

  it("an idea opened under another nudge than its takes were cut with plays in time, and does not read as changed", () => {
    const s0 = withIdea();
    const cut = { ...s0, saved: s0.saved.map((i) => (i.id === "band" ? { ...i, song: stampTakes5(i.song, 0) } : i)), studio: { nudge: 10 }, ideaId: "fixture-1" };
    const opened = openIn(cut, makeHistory(), "band");
    expect(takesOf(opened).map((k) => [k.start, k.nudge])).toEqual([[480, 480]]);
    expect(dirtyOf(opened)).toBe(false);
  });

  it("undo after the nudge was changed does not undo the nudge: the takes stay where the nudge puts them", () => {
    const h = makeHistory();
    // the idea comes on screen (its take is noted as lying with the nudge in use: none), then a clip is moved
    const s0 = openIn({ ...withIdea(), ideaId: "fixture-1" }, h, "band");
    expect(takesOf(s0).map((k) => [k.start, k.nudge])).toEqual([[0, 0]]);
    const s1 = editIn(s0, h, "Move clip", (song) => moveClips(song, ["m1"], 4));
    // the nudge is set to 10 ms (a setting: no undo step), and every take moves
    const s2 = { ...s1, studio: { nudge: 10 }, song: renudge5(s1.song, 10, 0) };
    expect(takesOf(s2).map((k) => [k.start, k.nudge])).toEqual([[480, 480]]);
    const back = stepIn(s2, h, true, false);
    expect(back.song.clips.find((c) => c.id === "m1")?.start).toBe(32);
    expect(back.studio?.nudge).toBe(10);
    expect(takesOf(back).map((k) => [k.start, k.nudge])).toEqual([[480, 480]]);
    // and redo
    expect(takesOf(stepIn(back, h, false, false)).map((k) => [k.start, k.nudge])).toEqual([[480, 480]]);
  });

  it("a change of the nudge alone never makes an idea read as changed; a take added or deleted does", () => {
    const s0 = openIn({ ...withIdea(), ideaId: "fixture-1" }, makeHistory(), "band");
    expect(dirtyOf(s0)).toBe(false);
    expect(dirtyOf({ ...s0, studio: { nudge: 25 }, song: renudge5(s0.song, 25, 0) })).toBe(false);
    const more = { ...s0, song: { ...s0.song, tracks: s0.song.tracks.map((t) => (t.id === "tv" ? { ...(t as AudioTrack), takes: [...(t as AudioTrack).takes, take("new", 1, 4)] } : t)) } };
    expect(dirtyOf(more)).toBe(true);
    const fewer = { ...s0, song: { ...s0.song, clips: s0.song.clips.filter((c) => c.id !== "a1"), tracks: s0.song.tracks.map((t) => (t.id === "tv" ? { ...(t as AudioTrack), takes: [] } : t)) } };
    expect(dirtyOf(fewer)).toBe(true);
  });
});
