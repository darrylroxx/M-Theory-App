// The whole old app state as the new one, old copies that turn up later, and the ideas list of the track view.
import { describe, expect, it } from "vitest";
import { exportIdeas, type RemoteIdea } from "../song/library";
import { copyRhythm } from "../song/clip";
import { DEFAULT_STATE, loadV4, type AppStateV4, type SavedProgression } from "../ui/state";
import type { App5State } from "../ui/app5";
import { arrive, backupId, besideId, convertAll, convertIdea, newSession } from "./convert";
import { fixture, fixtures } from "./fixtures5";
import { describeIdea5, emptySong5, exportIdeas5, fingerprint5, ideaTime5, importIdeas5, isBlank5, mergeIdeas5, reviveIdea5, reviveMelody5, reviveSong5, toPush5, type SavedIdea } from "./library5";
import { toTimeline } from "./migrate5";
import type { TimelineSong } from "./model";
import { bandSong } from "./testsongs";

const json = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** An old app state as the old loader gives it, from what an old build stores. */
function oldState(o: { saved: SavedProgression[]; open?: SavedProgression; ideaId?: string | null; draft?: string; more?: Record<string, unknown> }): AppStateV4 {
  return loadV4(JSON.stringify({ ...json(DEFAULT_STATE), saved: JSON.parse(exportIdeas(o.saved)).ideas, ...(o.open ? { progression: o.open.progression, key: o.open.key } : {}), ideaId: o.ideaId ?? null, draft: o.draft, ...o.more }));
}
const ids = (s: App5State) => s.saved.map((i) => i.id);
const idea = (s: App5State, id: string) => s.saved.find((i) => i.id === id)!;
/** an old idea changed and saved again later (as another device still on the old version would) */
const later = (i: SavedProgression, at: number, bpm = 133): SavedProgression => ({ ...i, updatedAt: at, progression: { ...i.progression, bpm } });

describe("convertAll", () => {
  const three = () => fixtures().slice(0, 3);
  it("every saved idea is converted and keeps its name, key and dates; each gets a backup entry", () => {
    const old = oldState({ saved: three(), open: fixture(2), ideaId: "fixture-2" });
    const now = convertAll(old, 5000);
    expect(ids(now)).toEqual(["fixture-1", "fixture-2", "fixture-3", "fixture-1-v4", "fixture-2-v4", "fixture-3-v4"]);
    for (const was of old.saved) {
      const i = idea(now, was.id);
      expect(i).toMatchObject({ name: was.name, key: was.key, savedAt: was.savedAt, updatedAt: was.updatedAt, from: { at: was.updatedAt } });
      expect(i).toEqual(convertIdea(was).idea);
      // (loading an old idea once more can write a default out in full: the same music, told by its fingerprint)
      expect(fingerprint5(i)).toBe(fingerprint5({ ...i, song: toTimeline(was.progression).song }));
      expect(i.song.clips).toEqual(toTimeline(was.progression).song.clips);
      expect(i.backup).toBeUndefined();
      // its backup entry: named after it, with its dates, an empty song (the original is read from where the old data is kept)
      const b = idea(now, backupId(was.id));
      expect(b).toMatchObject({ id: `${was.id}-v4`, name: `${was.name} (before track view)`, key: was.key, savedAt: was.savedAt, updatedAt: was.updatedAt, backup: { of: was.id } });
      expect(b.song).toEqual(emptySong5());
      expect(b.from).toBeUndefined();
      expect(/^[A-Za-z0-9-]+$/.test(b.id)).toBe(true);
    }
    // the idea on screen is the song of the page; it was saved and not changed since, so it has no second entry
    expect(now.song).toEqual(toTimeline(old.progression).song);
    expect(now.ideaId).toBe("fixture-2");
    expect(now.session).toEqual(newSession());
    expect(now.converted).toEqual({ at: 5000, ideas: { "fixture-1": old.saved[0].updatedAt, "fixture-2": old.saved[1].updatedAt, "fixture-3": old.saved[2].updatedAt } });
    expect(now.unsaved).toBeUndefined();
  });
  it("a saved idea that was open with changes not saved yet gets a second backup entry for those", () => {
    const changed = later(fixture(2), fixture(2).updatedAt!, 150);
    const now = convertAll(oldState({ saved: three(), open: changed, ideaId: "fixture-2" }), 5000);
    expect(ids(now)).toContain("fixture-2-u-v4");
    expect(idea(now, "fixture-2-u-v4")).toMatchObject({ name: "Fixture 2 (unsaved, before track view)", backup: { of: "fixture-2", unsaved: true } });
    // what is on screen is the changed song; the saved idea is the saved one
    expect(now.song.bpm).toBe(150);
    expect(idea(now, "fixture-2").song.bpm).toBe(96);
  });
  it("an idea that was never saved gets an entry of its own, unless it was blank", () => {
    const old5 = oldState({ saved: three(), open: fixture(5), ideaId: null, draft: "d7" });
    const now = convertAll(old5, 5000);
    expect(ids(now)).toContain("draft-d7-v4");
    expect(idea(now, "draft-d7-v4")).toMatchObject({ name: "Unsaved idea (before track view)", backup: { of: "draft-d7", unsaved: true } });
    expect(now.ideaId ?? null).toBeNull();
    expect(now.draft).toBe("d7");
    expect(now.song).toEqual(toTimeline(old5.progression).song);
    expect(fingerprint5({ key: now.key, song: now.song })).toBe(fingerprint5({ key: now.key, song: toTimeline(fixture(5).progression).song }));
    const blank = convertAll(oldState({ saved: three(), ideaId: null, draft: "d8" }), 5000);
    expect(ids(blank).some((id) => id.startsWith("draft-"))).toBe(false);
    expect(isBlank5(blank.song)).toBe(true);
    expect(blank.song.tracks.map((t) => t.id)).toEqual(["t-chords", "t-melody", "t-drums"]);
  });
  it("every other field of the state is copied unchanged, and the old chords clipboard becomes a clipboard whose track carries the copied sound", () => {
    const open = fixture(3);
    const copied = copyRhythm({ ...open.progression, sound: { voice: "nylon" }, tones: { chords: { inst: "piano" } } }, open.key, "A");
    const old = oldState({
      saved: three(), open, ideaId: "fixture-3",
      more: { settings: { tuningId: "dropd", capo: 3, leftHanded: false, labels: "notes", theme: "light", avoidBarre: false, v: 3 }, shapes: { a: "x02210" }, tombs: { dead: 9 }, studio: { host: "Driver", nudge: 7 }, view: { bars: 8 }, canvas: { palette: "dusk" }, clip: { rhythm: copied } },
    });
    const now = convertAll(old, 1);
    for (const k of ["key", "settings", "shapes", "myBeats", "myKits", "mySounds", "canvas", "studio", "view", "tombs", "ideaId", "draft"] as const) expect(now[k], k).toEqual(old[k]);
    expect(now.settings.capo).toBe(3);
    expect(now.clip).toMatchObject({ key: open.key, clips: [{ kind: "chords", start: 0 }], tracks: [{ kind: "chords", tone: { inst: "piano" }, sound: { voice: "nylon" } }], takes: [] });
    // with nothing copied there is no clipboard
    expect(convertAll(oldState({ saved: three() }), 1).clip).toBeUndefined();
    // the old state is not touched by any of it
    const before = JSON.stringify(old);
    convertAll(old, 2);
    expect(JSON.stringify(old)).toBe(before);
  });
  it("is the same on every device: the same old state gives the same new one, ids and dates included", () => {
    const old = oldState({ saved: fixtures(), open: fixture(8), ideaId: "fixture-8" });
    expect(convertAll(old, 7)).toEqual(convertAll(json(old), 7));
    expect(convertAll(old, 7).saved.length).toBe(36);
  });
});

describe("an old-format copy turns up later", () => {
  const A = () => fixture(2);
  const start = () => convertAll(oldState({ saved: [A()] }), 5000);
  /** the originals this device can read: what its backup entries stand for */
  const originals = (...xs: SavedProgression[]) => (id: string) => xs.find((x) => x.id === id) ?? null;
  const t = A().updatedAt!;

  it("a deletion of its id that is as new or newer: ignored", () => {
    const s: App5State = { ...start(), tombs: { "fixture-9": 9000 } };
    const r = arrive(s, { ...fixture(9), updatedAt: 9000 }, originals());
    expect(r.state).toBe(s);
    expect(r.added).toBeUndefined();
    // a copy newer than the deletion comes back, and the deletion is forgotten
    const back = arrive(s, { ...fixture(9), updatedAt: 9001 }, originals());
    expect(back.added).toBe("new");
    expect(back.state.tombs).toEqual({});
  });
  it("no idea has its id: it is converted and added, with its backup entry", () => {
    const s = start();
    const r = arrive(s, fixture(4), originals(A()));
    expect(r.added).toBe("new");
    expect(ids(r.state)).toEqual(["fixture-4", "fixture-2", "fixture-2-v4", "fixture-4-v4"]);
    expect(idea(r.state, "fixture-4")).toEqual(convertIdea(fixture(4)).idea);
    expect(idea(r.state, "fixture-4-v4").backup).toEqual({ of: "fixture-4" });
    expect(r.state.converted!.ideas["fixture-4"]).toBe(fixture(4).updatedAt);
    // the same copy again adds nothing
    const again = arrive(r.state, fixture(4), originals(A(), fixture(4)));
    expect(again.state).toBe(r.state);
    expect(again.added).toBeUndefined();
  });
  it("an idea has its id and came from this copy, or from a newer one: ignored", () => {
    const s = start();
    expect(arrive(s, A(), originals(A())).state).toBe(s);
    expect(arrive(s, later(A(), t - 50), originals(A())).state).toBe(s);
  });
  it("a newer copy of an idea that was not edited since it was converted replaces it, silently; the backup stands for the newer copy", () => {
    const s = start();
    const newer = later(A(), t + 500);
    const r = arrive(s, newer, originals(A()));
    expect(r.added).toBe("refreshed");
    expect(ids(r.state)).toEqual(["fixture-2", "fixture-2-v4"]);
    expect(idea(r.state, "fixture-2")).toMatchObject({ updatedAt: t + 500, from: { at: t + 500 }, song: { bpm: 133 } });
    expect(idea(r.state, "fixture-2-v4")).toMatchObject({ updatedAt: t + 500, backup: { of: "fixture-2" } });
    // and once more with the same copy: nothing
    expect(arrive(r.state, newer, originals(newer)).state).toBe(r.state);
  });
  it("a newer copy of an idea that was edited in the new app is added beside it, once, named as edited in the old version", () => {
    const s0 = start();
    // edited in the new app: a track renamed
    const s: App5State = { ...s0, saved: s0.saved.map((i) => (i.id === "fixture-2" ? { ...i, updatedAt: t + 100, song: { ...i.song, tracks: i.song.tracks.map((x, k) => (k === 0 ? { ...x, name: "My guitar" } : x)) } } : i)) };
    const newer = later(A(), t + 500);
    const r = arrive(s, newer, originals(A()));
    expect(r.added).toBe("beside");
    expect(ids(r.state)).toEqual(["fixture-2-o", "fixture-2", "fixture-2-v4", "fixture-2-o-v4"]);
    expect(besideId("fixture-2")).toBe("fixture-2-o");
    expect(idea(r.state, "fixture-2-o")).toMatchObject({ name: "Fixture 2 (edited in the old version)", from: { at: t + 500 }, song: { bpm: 133 } });
    // the idea edited here is exactly as it was
    expect(idea(r.state, "fixture-2")).toBe(idea(s, "fixture-2"));
    expect(idea(r.state, "fixture-2").song.tracks[0].name).toBe("My guitar");
    // a second sync does not add it again
    const again = arrive(r.state, newer, originals(A(), { ...newer, id: "fixture-2-o" }));
    expect(again.state).toBe(r.state);
    expect(again.added).toBeUndefined();
  });
  it("when the original cannot be read here, the idea counts as edited: the newer copy goes beside it, and nothing is replaced", () => {
    const s = start();
    const r = arrive(s, later(A(), t + 500), () => null);
    expect(r.added).toBe("beside");
    expect(idea(r.state, "fixture-2")).toBe(idea(s, "fixture-2"));
  });
  it("a converted idea keeps the old date, so two devices that both converted do not overwrite each other", () => {
    const one = convertAll(oldState({ saved: [A()] }), 5000);
    const two = convertAll(oldState({ saved: [A()] }), 9999);
    expect(ideaTime5(idea(one, "fixture-2"))).toBe(t);
    expect(idea(two, "fixture-2")).toEqual(idea(one, "fixture-2"));
    // device one, edited there; then device two's copy arrives from the cloud with the old date: the edit stands
    const mine: SavedIdea = { ...idea(one, "fixture-2"), updatedAt: t + 10, name: "Renamed here" };
    const remote: RemoteIdea[] = toPush5(two.saved, {}, new Map());
    // (backup entries are never sent)
    expect(remote.map((r) => r.id)).toEqual(["fixture-2"]);
    expect(mergeIdeas5([mine], {}, remote).ideas[0].name).toBe("Renamed here");
    // and the untouched copy on device two takes the edit when it arrives
    const edit: RemoteIdea[] = toPush5([mine], {}, new Map());
    expect(mergeIdeas5(two.saved, {}, edit).ideas.find((i) => i.id === "fixture-2")!.name).toBe("Renamed here");
  });
});

describe("the ideas list of the track view", () => {
  const saved = (): SavedIdea => ({ ...convertIdea(fixture(8)).idea, capo: 2, tuningId: "standard" });
  it("an idea just opened is not changed: stored, loaded and compared, its fingerprint is the saved one's", () => {
    for (const f of fixtures()) {
      const i = convertIdea(f).idea;
      const opened = reviveIdea5(json(i))!;
      expect(fingerprint5(opened), f.name).toBe(fingerprint5(i));
      // loading what was loaded changes nothing more
      expect(reviveIdea5(json(opened))).toEqual(opened);
    }
    const i = saved();
    expect(fingerprint5({ key: i.key, song: i.song, capo: 2, tuningId: "standard" })).toBe(fingerprint5(i));
  });
  it("the fingerprint changes with the music, the key and the capo, and not with what is selected or shelved", () => {
    const i = saved();
    const print = fingerprint5(i);
    expect(fingerprint5({ ...i, song: { ...i.song, bpm: i.song.bpm + 1 } })).not.toBe(print);
    expect(fingerprint5({ ...i, key: { tonic: "D", scaleId: "ionian" } })).not.toBe(print);
    expect(fingerprint5({ ...i, capo: 3 })).not.toBe(print);
    expect(fingerprint5({ ...i, song: { ...i.song, clips: i.song.clips.slice(1) } })).not.toBe(print);
    expect(fingerprint5({ ...i, song: { ...i.song, mix: { ...i.song.mix, "t-drums": { mute: true } } } })).not.toBe(print);
    // a sound saved with only some knobs is the same sound as one with the rest at their defaults; the order of the clips does not count
    expect(fingerprint5({ ...i, song: { ...i.song, clips: [...i.song.clips].reverse(), shelf: [{ track: "x", name: "x", kind: "vocals", takes: [], at: 0, saves: 1 }] } })).toBe(print);
    expect(fingerprint5({ ...i, name: "Another name" } as SavedIdea)).toBe(print);
  });
  it("merging two devices: the newer copy wins, and a deletion wins over an older copy", () => {
    const a = saved();
    const newer: SavedIdea = { ...a, name: "Newer", updatedAt: a.updatedAt! + 10 };
    const older: SavedIdea = { ...a, name: "Older", updatedAt: a.updatedAt! - 10 };
    const remote = (i: SavedIdea): RemoteIdea => ({ id: i.id, updatedAt: ideaTime5(i), json: JSON.stringify(i) });
    expect(mergeIdeas5([a], {}, [remote(newer)]).ideas[0].name).toBe("Newer");
    expect(mergeIdeas5([a], {}, [remote(older)]).ideas[0].name).toBe(a.name);
    // deleted elsewhere after this copy was written: it goes, and stays gone
    const gone = mergeIdeas5([a], {}, [{ id: a.id, updatedAt: a.updatedAt! + 5, deleted: true }]);
    expect(gone.ideas).toEqual([]);
    expect(gone.tombs[a.id]).toBe(a.updatedAt! + 5);
    expect(mergeIdeas5([], gone.tombs, [remote(a)]).ideas).toEqual([]);
    // edited here after it was deleted elsewhere: kept
    expect(mergeIdeas5([newer], {}, [{ id: a.id, updatedAt: a.updatedAt! + 5, deleted: true }]).ideas.length).toBe(1);
    // a copy that cannot be read is ignored
    expect(mergeIdeas5([], {}, [{ id: "x", updatedAt: 5, json: "{not json" }, { id: "y", updatedAt: 5, json: "{}" }]).ideas).toEqual([]);
    // a merged copy is made safe as it comes in
    const fromCloud = mergeIdeas5([], {}, [remote(a)]).ideas[0];
    expect(fingerprint5(fromCloud)).toBe(fingerprint5(a));
  });
  it("what is sent to the cloud: ideas not known there, never a backup entry; a deleted backup entry is sent as a deletion", () => {
    const s = convertAll(oldState({ saved: fixtures().slice(0, 2) }), 1);
    const push = toPush5(s.saved, { "fixture-1-v4": 77, gone: 5 }, new Map([["fixture-1", ideaTime5(idea(s, "fixture-1"))]]));
    expect(push.map((r) => [r.id, !!r.deleted])).toEqual([["fixture-2", false], ["gone", true]]);
    // (a backup entry still in the list is not a deletion; one that was deleted is)
    const without = s.saved.filter((i) => i.id !== "fixture-1-v4");
    expect(toPush5(without, { "fixture-1-v4": 77 }, new Map()).filter((r) => r.deleted).map((r) => r.id)).toEqual(["fixture-1-v4"]);
  });
  it("a backup file is written as version 2, with the originals of its backup entries, and read back", () => {
    const s = convertAll(oldState({ saved: fixtures().slice(0, 2) }), 1);
    const originals = { "fixture-1": fixture(1), "fixture-2": fixture(2) };
    const text = exportIdeas5(s.saved, originals);
    const file = JSON.parse(text);
    expect(file).toMatchObject({ app: "m-theory", version: 2 });
    expect(file.ideas.length).toBe(4);
    expect(Object.keys(file.originals)).toEqual(["fixture-1", "fixture-2"]);
    const back = importIdeas5(text);
    expect(back.version).toBe(2);
    expect(back.ideas).toEqual(s.saved.map((i) => reviveIdea5(json(i))));
    // (the originals come back through the old loader, as every old idea does)
    expect(Object.keys(back.originals)).toEqual(["fixture-1", "fixture-2"]);
    expect(back.originals["fixture-2"]).toMatchObject({ id: "fixture-2", name: "Fixture 2", key: fixture(2).key, updatedAt: fixture(2).updatedAt });
    expect(back.old).toEqual([]);
    // an original brought back on another machine converts to the very idea it gave here
    expect(convertIdea(back.originals["fixture-2"]).idea).toEqual(idea(s, "fixture-2"));
    expect(fingerprint5(convertIdea(back.originals["fixture-1"]).idea)).toBe(fingerprint5(idea(s, "fixture-1")));
  });
  it("a version 1 backup file (from an old build) is still read: its ideas come back as old copies, to be taken in one by one", () => {
    const back = importIdeas5(exportIdeas(fixtures().slice(0, 3)));
    expect(back.version).toBe(1);
    expect(back.ideas).toEqual([]);
    expect(back.old.map((i) => i.id)).toEqual(["fixture-1", "fixture-2", "fixture-3"]);
    let s = convertAll(oldState({ saved: [] }), 1);
    for (const o of back.old) s = arrive(s, o, () => null).state;
    expect(ids(s).sort()).toEqual(["fixture-1", "fixture-1-v4", "fixture-2", "fixture-2-v4", "fixture-3", "fixture-3-v4"]);
    // something that is not a backup file gives nothing, and never throws
    for (const junk of ["", "nope", "[]", "{}", '{"version":2,"ideas":7}', '{"version":2,"ideas":[1,null,{"id":"x"}],"originals":{"a":5}}']) {
      const r = importIdeas5(junk);
      expect(r.ideas).toEqual([]);
      expect(r.old).toEqual([]);
    }
  });
  it("a song is loaded safely: a clip whose track is gone is dropped, a clip its track cannot hold too, and rubbish never throws", () => {
    const s = bandSong();
    const loaded = reviveSong5(json(s));
    expect(loaded.clips.map((c) => c.id)).toEqual(s.clips.map((c) => c.id));
    expect(loaded.tracks.map((t) => [t.id, t.kind])).toEqual(s.tracks.map((t) => [t.id, t.kind]));
    expect(loaded.markers).toEqual(s.markers);
    expect(loaded.end).toBe(64);
    // the melody track is gone: its clip goes with it, the rest stays
    const noTrack = reviveSong5(json({ ...s, tracks: s.tracks.filter((t) => t.id !== "tm") }));
    expect(noTrack.clips.map((c) => c.id)).toEqual(["c1", "c2", "b1", "d1", "a1"]);
    // a drums clip on a chords track, a clip with no length, a clip of a take that is gone, a second clip with a taken id
    const bad = json(s) as unknown as { clips: Record<string, unknown>[]; tracks: Record<string, unknown>[] };
    bad.clips.push({ ...bad.clips[4], id: "wrong", track: "tc" }, { ...bad.clips[0], id: "flat", len: 0 }, { ...bad.clips[5], id: "lost", take: "nope" }, { ...bad.clips[0] });
    // a track with a name the engine keeps for itself, one of a kind that does not exist, one with an id taken
    bad.tracks.push({ id: "chords", kind: "chords", name: "x" }, { id: "t9", kind: "banjo", name: "x" }, { ...bad.tracks[0] });
    const cleaned = reviveSong5(bad);
    expect(cleaned.clips.map((c) => c.id)).toEqual(s.clips.map((c) => c.id));
    expect(cleaned.tracks.map((t) => t.id)).toEqual(s.tracks.map((t) => t.id));
    // a clip that says it plays instead of a track that is not there no longer says so
    const instead = json(s) as unknown as { clips: Record<string, unknown>[] };
    instead.clips[0].instead = "nowhere";
    expect("instead" in reviveSong5(instead).clips[0]).toBe(false);
    for (const junk of [null, undefined, 7, "song", [], {}, { tracks: 5, clips: "x" }, { tracks: [null, 3, {}], clips: [null, {}, { id: 1 }], sigs: [null, { bar: -1 }], markers: [5], shelf: [{}], mix: 9, bpm: "fast" }]) {
      const out = reviveSong5(junk);
      expect(out).toMatchObject({ v: 5, tracks: [], clips: [] });
      expect(out.bpm).toBeGreaterThanOrEqual(40);
    }
    expect(reviveSong5({ bpm: 9999 }).bpm).toBe(200);
    expect(reviveIdea5(null)).toBeNull();
    expect(reviveIdea5({ id: "x", key: { tonic: "C", scaleId: "ionian" } })).toBeNull();
    expect(reviveIdea5({ id: "x", name: 5, key: { tonic: "C", scaleId: "ionian" }, song: {}, savedAt: 9 })).toMatchObject({ id: "x", name: "5", savedAt: 9, updatedAt: 9, song: { v: 5 } });
  });
  it("a melody is loaded with its notes' lengths, and a note outside what a melody may hold is moved by octaves, not dropped", () => {
    const m = reviveMelody5({ div: 4, bars: 2, on: false, notes: [{ at: 0, midi: 20 }, { at: 12, midi: 60, len: 6 }, { at: 24, midi: 120 }, { at: 36, midi: 108 }, { at: -1, midi: 60 }, { at: 1.5, midi: 60 }, null, { at: 48, midi: 61, len: 0 }] });
    expect(m).toEqual({ div: 4, bars: 2, notes: [{ at: 0, midi: 32 }, { at: 12, midi: 60, len: 6 }, { at: 24, midi: 108 }, { at: 36, midi: 108 }, { at: 48, midi: 61 }] });
    expect(reviveMelody5(null)).toBeUndefined();
    expect(reviveMelody5({ notes: "x" })).toBeUndefined();
    expect(reviveMelody5({ notes: [], bars: 99 })).toEqual({ div: 2, bars: 32, notes: [] });
  });
  it("one line about an idea: the names on its ruler, else its first chords", () => {
    expect(describeIdea5(convertIdea(fixture(2)).idea)).toBe("Verse Chorus Verse");
    expect(describeIdea5(convertIdea(fixture(1)).idea)).toBe("C · F · G · Am");
    expect(describeIdea5({ ...convertIdea(fixture(1)).idea, song: emptySong5() })).toBe("Empty");
    const s: TimelineSong = emptySong5(100, { num: 3, den: 4 });
    expect(s).toEqual({ v: 5, bpm: 100, meter: { num: 3, den: 4 }, tracks: [], clips: [] });
    expect(isBlank5(s)).toBe(true);
    expect(isBlank5(bandSong())).toBe(false);
  });
});
