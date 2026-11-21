// The whole old app state as the new one, old copies that turn up later, and the ideas list of the track view.
import { describe, expect, it } from "vitest";
import { exportIdeas, type RemoteIdea } from "../song/library";
import { copyRhythm } from "../song/clip";
import { DEFAULT_STATE, loadV4, type AppStateV4, type SavedProgression } from "../ui/state";
import type { App5State } from "../ui/app5";
import { BLOB, BLOB_LATE, arrive, backupId, backupSource, besideId, convertAll, convertIdea, keepOriginal, newSession, sideKey, type Stores } from "./convert";
import { fixture, fixtures } from "./fixtures5";
import { describeIdea5, emptySong5, exportIdeas5, fingerprint5, ideaTime5, importIdeas5, isBlank5, mergeIdeas5, reviveIdea5, reviveMelody5, reviveSong5, toPush5, type SavedIdea } from "./library5";
import { toTimeline } from "./migrate5";
import type { TimelineSong } from "./model";
import { KEY_V1, KEY_V2, freshState, load5, recover5, reviveState5, save5, settleConversion, storedText, takeLate, type Blobs, type KV } from "./store5";
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

// ── where it is kept: the move from the old storage, with pretend stores ──

/** Local storage that holds only so many characters in all (as a full device does). */
function pretendKV(room = Infinity, start: Record<string, string> = {}) {
  const map = new Map(Object.entries(start));
  const log: string[] = [];
  const kv: KV = {
    get: (k) => map.get(k) ?? null,
    set(k, v) {
      let used = 0;
      for (const [key, val] of map) if (key !== k) used += val.length;
      if (used + v.length > room) {
        log.push(`full ${k}`);
        throw new Error("QuotaExceededError");
      }
      log.push(`set ${k}`);
      map.set(k, v);
    },
    remove(k) {
      log.push(`remove ${k}`);
      map.delete(k);
    },
  };
  return { kv, map, log };
}
/** The larger store. `broken`: it cannot be written; `forgetful`: it gives back something else than was put in. */
function pretendBlobs(how: "ok" | "broken" | "forgetful" = "ok") {
  const map = new Map<string, string>();
  const blobs: Blobs = {
    get: async (k) => (how === "forgetful" && map.has(k) ? map.get(k)!.slice(1) : map.get(k) ?? null),
    put: async (k, v) => {
      if (how === "broken") throw new Error("no store");
      map.set(k, v);
    },
  };
  return { blobs, map };
}
/** What an old build left in storage: three saved ideas, the second open with a change not saved yet. */
const oldText = (o: { open?: SavedProgression; ideaId?: string | null; draft?: string } = {}) =>
  JSON.stringify({ ...json(DEFAULT_STATE), saved: JSON.parse(exportIdeas(fixtures().slice(0, 3))).ideas, progression: (o.open ?? later(fixture(2), fixture(2).updatedAt!, 150)).progression, key: (o.open ?? fixture(2)).key, ideaId: o.ideaId === undefined ? "fixture-2" : o.ideaId, draft: o.draft });

describe("the first start of the new build: the old storage is moved, never written", () => {
  it("the old text is converted in memory; nothing is written until it is settled", () => {
    const v1 = oldText();
    const { kv, log } = pretendKV(Infinity, { [KEY_V1]: v1 });
    const got = load5(kv);
    expect(got.v1).toBe(v1);
    expect(got.state.saved.filter((i) => !i.backup).map((i) => i.id)).toEqual(["fixture-1", "fixture-2", "fixture-3"]);
    expect(got.state.saved.filter((i) => i.backup).map((i) => i.id)).toEqual(["fixture-1-v4", "fixture-2-v4", "fixture-3-v4", "fixture-2-u-v4"]);
    expect(got.state.song.bpm).toBe(150);
    // (an idea opens with the whole song across the lanes: no zoom is chosen yet)
    expect(got.state.session.pxPerBeat).toBe(0);
    expect(log).toEqual([]);
  });

  it("the old text is byte-identical in its new place, and the old key goes only after both copies were read back equal", async () => {
    const v1 = oldText();
    const { kv, map, log } = pretendKV(Infinity, { [KEY_V1]: v1 });
    const { blobs, map: big } = pretendBlobs();
    const got = load5(kv);
    const out = await settleConversion(kv, blobs, got.state, got.v1!);
    expect(big.get(BLOB)).toBe(v1);
    expect(map.has(KEY_V1)).toBe(false);
    expect(map.has(KEY_V2)).toBe(true);
    // the new key was written before the old one was removed
    expect(log).toEqual([`set ${KEY_V2}`, `remove ${KEY_V1}`]);
    expect(out.converted!.blob).toMatchObject({ len: v1.length, where: "idb" });
    expect(out.converted!.blob!.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(out.converted!.size).toBeGreaterThan(0);
    expect(out.unsaved).toBeUndefined();
    // what was written is the state, and loads as it
    expect(map.get(KEY_V2)).toBe(storedText(out));
    expect(load5(kv).state.saved.map((i) => i.id)).toEqual(out.saved.map((i) => i.id));
  });

  it("where the larger store cannot be used, or does not give back what was put in, the old key is left alone and is the backup store", async () => {
    for (const how of ["broken", "forgetful", "none"] as const) {
      const v1 = oldText();
      const { kv, map, log } = pretendKV(Infinity, { [KEY_V1]: v1 });
      const got = load5(kv);
      const out = await settleConversion(kv, how === "none" ? null : pretendBlobs(how).blobs, got.state, got.v1!);
      expect(map.get(KEY_V1), how).toBe(v1);
      expect(log, how).toEqual([`set ${KEY_V2}`]);
      expect(out.converted!.blob!.where, how).toBe("local");
      expect(out.unsaved).toBeUndefined();
    }
  });

  it("no room for the new key: the old key is removed (its copy verified) and the write tried again", async () => {
    const v1 = oldText();
    const size = storedText(load5(pretendKV(Infinity, { [KEY_V1]: v1 }).kv).state).length;
    // room for either text, not for both
    const { kv, map, log } = pretendKV(Math.max(v1.length, size) + 2000, { [KEY_V1]: v1 });
    const { blobs, map: big } = pretendBlobs();
    const got = load5(kv);
    const out = await settleConversion(kv, blobs, got.state, got.v1!);
    expect(log).toEqual([`full ${KEY_V2}`, `remove ${KEY_V1}`, `set ${KEY_V2}`]);
    expect(big.get(BLOB)).toBe(v1);
    expect(map.has(KEY_V1)).toBe(false);
    expect(out.unsaved).toBeUndefined();
    expect(out.converted!.blob!.where).toBe("idb");
  });

  it("still no room: the state says unsaved, the old text is back under its key, and the next start converts from it again", async () => {
    const v1 = oldText();
    const { kv, map } = pretendKV(v1.length + 10, { [KEY_V1]: v1 });
    const { blobs, map: big } = pretendBlobs();
    const got = load5(kv);
    const out = await settleConversion(kv, blobs, got.state, got.v1!);
    expect(out.unsaved).toBe(true);
    expect(map.has(KEY_V2)).toBe(false);
    expect(map.get(KEY_V1)).toBe(v1);
    expect(big.get(BLOB)).toBe(v1);
    // unsaved is never written
    expect(JSON.parse(storedText(out)).unsaved).toBeUndefined();
    const again = load5(kv);
    expect(again.v1).toBe(v1);
    expect(again.state.saved.map((i) => i.id)).toEqual(got.state.saved.map((i) => i.id));
    // with no larger store and no room, nothing at all is touched
    const tight = pretendKV(v1.length + 10, { [KEY_V1]: v1 });
    const none = await settleConversion(tight.kv, null, got.state, v1);
    expect(none.unsaved).toBe(true);
    expect(tight.map.get(KEY_V1)).toBe(v1);
    expect(tight.log.filter((l) => l.startsWith("remove"))).toEqual([`remove ${KEY_V2}`]);
  });

  it("the old key gone and the new one never written: the next start finds the old text in the larger store and converts it again", async () => {
    const v1 = oldText();
    const { blobs, map: big } = pretendBlobs();
    big.set(BLOB, v1);
    const { kv } = pretendKV();
    expect(load5(kv).fresh).toBe(true);
    const back = await recover5(blobs);
    expect(back!.v1).toBe(v1);
    expect(back!.state.saved.filter((i) => !i.backup).map((i) => i.id)).toEqual(["fixture-1", "fixture-2", "fixture-3"]);
    expect(await recover5(pretendBlobs().blobs)).toBeNull();
    expect(await recover5(null)).toBeNull();
  });

  it("conversion never runs over a new key that exists; loading twice changes nothing", async () => {
    const v1 = oldText();
    const { kv, map, log } = pretendKV(Infinity, { [KEY_V1]: v1 });
    const got = load5(kv);
    const out = await settleConversion(kv, pretendBlobs("broken").blobs, got.state, got.v1!);
    // the idea is edited and saved in the new app; the old key is still there (it is the backup store)
    const edited: App5State = { ...out, song: { ...out.song, bpm: 77 } };
    expect(save5(kv, edited)).toBe(true);
    const one = load5(kv);
    expect(one.v1).toBeUndefined();
    expect(one.state.song.bpm).toBe(77);
    const text = map.get(KEY_V2);
    const two = load5(kv);
    expect(two.state).toEqual(one.state);
    expect(map.get(KEY_V2)).toBe(text);
    expect(map.get(KEY_V1)).toBe(v1);
    expect(log.filter((l) => l.includes(KEY_V1))).toEqual([]);
    // stored and loaded, the state is what it was (what is never stored aside)
    expect(reviveState5(storedText(one.state))).toEqual(one.state);
  });

  it("what cannot be read is never taken for an empty start, and never written over", () => {
    // a new key that is not a state: the app starts in memory, and says the stored ideas are stuck
    const a = pretendKV(Infinity, { [KEY_V2]: "{not json", [KEY_V1]: oldText() });
    const got = load5(a.kv);
    expect(got.stuck).toBe("v2");
    expect(got.v1).toBeUndefined();
    expect(a.log).toEqual([]);
    // an old key that is not a state
    for (const bad of ["{not json", "null", "[1,2]"]) expect(load5(pretendKV(Infinity, { [KEY_V1]: bad }).kv).stuck, bad).toBe("v1");
    // a store that cannot be read at all
    const dead: KV = { get: () => { throw new Error("denied"); }, set: () => { throw new Error("denied"); }, remove: () => {} };
    expect(load5(dead).stuck).toBe("storage");
    expect(save5(dead, freshState())).toBe(false);
    // nothing stored: a first start, with the three tracks every idea starts with and nothing to convert
    const first = load5(pretendKV().kv, "d1");
    expect(first).toMatchObject({ fresh: true });
    expect(first.state.draft).toBe("d1");
    expect(first.state.converted).toBeUndefined();
    expect(first.state.song.tracks.map((t) => t.kind)).toEqual(["chords", "melody", "drums"]);
  });

  it("what is stored: everything but the armed track and the failed-write mark; the inputs of the interface are carried", () => {
    const base = convertAll(oldState({ saved: fixtures().slice(0, 2), open: fixture(1), ideaId: "fixture-1", more: { studio: { host: "Driver" } } }), 1);
    const s: App5State = { ...base, unsaved: true, studio: { ...base.studio, inputs: 8 }, session: { ...base.session, armed: "v1", cursor: 12, loop: { regions: [{ from: 4, to: 8 }], on: true }, windows: [{ id: "compose:t-chords", kind: "compose", track: "t-chords", clip: "a.chords", x: 260, y: 360, w: 1020, h: 440, open: true }] } };
    const back = reviveState5(storedText(s))!;
    expect(back.session.armed).toBeNull();
    expect(back.unsaved).toBeUndefined();
    expect(back.session).toEqual({ ...s.session, armed: null });
    expect(back.studio).toMatchObject({ host: "Driver", inputs: 8 });
    expect(back.saved).toEqual(s.saved);
    expect(back.song).toEqual(s.song);
    expect(reviveState5("[]")).toBeNull();
    expect(reviveState5("{}")).toBeNull();
  });
});

describe("the originals behind the backup entries", () => {
  const settled = async (text: string, how: "ok" | "broken" = "ok") => {
    const { kv } = pretendKV(Infinity, { [KEY_V1]: text });
    const { blobs } = pretendBlobs(how);
    const got = load5(kv);
    const state = await settleConversion(kv, blobs, got.state, got.v1!);
    const st: Stores = { kv, blobs: how === "ok" ? blobs : null };
    return { state, st, kv, blobs };
  };

  it("a saved idea, the unsaved changes of a saved one, and the never-saved idea on screen are each found, wherever the old text is kept", async () => {
    for (const how of ["ok", "broken"] as const) {
      const { state, st } = await settled(oldText(), how);
      // every backup entry has its original
      for (const b of state.saved.filter((i) => i.backup)) expect(await backupSource(b.id, st), `${how} ${b.id}`).not.toBeNull();
      const one = await backupSource("fixture-1-v4", st);
      expect(one).toEqual(loadV4(oldText()).saved[0]);
      // the saved idea is the saved one; its unsaved changes are what was on the page
      expect((await backupSource("fixture-2-v4", st))!.progression.bpm).toBe(96);
      expect((await backupSource("fixture-2-u-v4", st))!.progression.bpm).toBe(150);
      expect(await backupSource("fixture-9-v4", st)).toBeNull();
      expect(await backupSource("fixture-9-u-v4", st)).toBeNull();
    }
    const never = await settled(oldText({ open: fixture(5), ideaId: null, draft: "d7" }));
    expect(never.state.saved.map((i) => i.id)).toContain("draft-d7-v4");
    const page = await backupSource("draft-d7-v4", never.st);
    expect(page!.progression.bpm).toBe(fixture(5).progression.bpm);
    expect(convertIdea(page!).idea.song.clips).toEqual(never.state.song.clips);
    expect(await backupSource("draft-zz-v4", never.st)).toBeNull();
    // with no stores at all there is nothing to read
    expect(await backupSource("fixture-1-v4", null)).toBeNull();
  });

  it("an old idea kept on its own is read first (one that arrived later); the old cloud copy last", async () => {
    const { st, blobs } = await settled(oldText());
    const newer = later(fixture(2), fixture(2).updatedAt! + 500, 141);
    await keepOriginal("fixture-2", newer, st);
    expect(await blobs.get(sideKey("fixture-2"))).toBe(JSON.stringify(newer));
    expect((await backupSource("fixture-2-v4", st))!.progression.bpm).toBe(141);
    // with no larger store it is kept under a local key instead
    const local = await settled(oldText(), "broken");
    await keepOriginal("fixture-3", later(fixture(3), 9, 99), local.st);
    expect((await backupSource("fixture-3-v4", local.st))!.progression.bpm).toBe(99);
    // an idea only the old cloud has
    const cloud: Stores = { ...st, cloud: (id) => (id === "fixture-7" ? fixture(7) : null) };
    expect((await backupSource("fixture-7-v4", cloud))!.id).toBe("fixture-7");
  });

  it("a backup entry is never converted on load, and a deleted one stays deleted", async () => {
    const { state, kv } = await settled(oldText());
    const b = state.saved.find((i) => i.id === "fixture-1-v4")!;
    expect(b.song).toEqual(emptySong5());
    const gone: App5State = { ...state, saved: state.saved.filter((i) => i.id !== b.id), tombs: { ...state.tombs, [b.id]: 9000 } };
    save5(kv, gone);
    const back = load5(kv).state;
    expect(back.saved.some((i) => i.id === b.id)).toBe(false);
    // its old copy turning up again (the cloud, an old tab) does not bring it back
    expect(arrive(back, fixture(1), () => fixture(1)).state.saved.some((i) => i.id === b.id)).toBe(false);
    const newer = arrive(back, later(fixture(1), fixture(1).updatedAt! + 10), () => fixture(1));
    expect(newer.added).toBe("refreshed");
    expect(newer.state.saved.some((i) => i.id === b.id)).toBe(false);
  });

  it("the old key written again by an old tab is kept as the late copy and removed; where the old key is the backup store it stays", async () => {
    const v1 = oldText();
    const { state, kv, blobs } = await settled(v1);
    expect(kv.get(KEY_V1)).toBeNull();
    const lateText = JSON.stringify({ ...JSON.parse(v1), saved: JSON.parse(exportIdeas([...fixtures().slice(0, 3), fixture(6)])).ideas });
    kv.set(KEY_V1, lateText);
    expect(await takeLate(kv, blobs, state)).toBe(lateText);
    expect(kv.get(KEY_V1)).toBeNull();
    expect(await blobs.get(BLOB_LATE)).toBe(lateText);
    expect(await blobs.get(BLOB)).toBe(v1);
    // its ideas are read from there
    expect((await backupSource("fixture-6-v4", { kv, blobs }))!.id).toBe("fixture-6");
    expect(await takeLate(kv, blobs, state)).toBeNull();
    const local = await settled(v1, "broken");
    expect(await takeLate(local.kv, null, local.state)).toBe(v1);
    expect(local.kv.get(KEY_V1)).toBe(v1);
  });
});
