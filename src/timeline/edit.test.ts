import { describe, expect, it } from "vitest";
import { BEAT_LIBRARY, type Groove } from "../audio/beats";
import { SOUND_DEFAULT } from "../audio/rack";
import { GUITAR } from "../audio/tone";
import { FX_DEFAULT, PRESETS, presetFx } from "../audio/vocalfx";
import type { Melody } from "../song/melody";
import { isCompound, sigBeats, type TimeSig } from "../song/meter";
import { PLAIN_KIT } from "../song/tracks";
import { presetsIn } from "../synth/presets";
import type { Key } from "../theory/keys";
import { barMap, onBarLine } from "./bars";
import source from "./edit.ts?raw";
import {
  addTrack, blankContent, clipboardBeats, clipsIn, copyClips, copyOut, copySound, cutTime, deleteClips, draftAnchor, duplicateClips, duplicateTrack, insertTime, layDown, moveClips, moveTrack,
  pasteIn, pasteSound, placeDraft, removeTrack, renameTrack, resizeClip, setContent, setDraft, setSig, setTempo, setTrack, songEnd, splitClips, transpose,
  type Clipboard5, type SoundCopy,
} from "./edit";
import {
  accepts, clipEnd, contentBeats, cycles, framesToBeats, notches, phase, zeroBeat,
  type AudioClip, type AudioTrack, type ChordsClip, type ChordsTrack, type Clip, type ClipKind, type DrumsClip, type DrumsTrack, type MelodyClip, type NoteClip, type Session, type TimelineSong,
  type Track, type TrackKind, type TuneTrack,
} from "./model";
import {
  KEY_B, KEY_C, SIG34, SIG44, SIG68, audioClip, audioTrack, bandSong, chord, chordsClip, chordsContent, chordsTrack, counter, drumsClip, drumsTrack, groove, melodyClip, mixedSong, songOf, take,
  tune, tuneTrack,
} from "./testsongs";

const clip = <C extends Clip = Clip>(song: TimelineSong, id: string): C => song.clips.find((c) => c.id === id) as C;
const track = <T = ChordsTrack>(song: TimelineSong, id: string): T => song.tracks.find((t) => t.id === id) as T;
const ids = (song: TimelineSong, t?: string) => song.clips.filter((c) => !t || c.track === t).map((c) => c.id);
/** [start, end] of every clip on a track, in time order */
const spans = (song: TimelineSong, t: string) => song.clips.filter((c) => c.track === t).map((c) => [c.start, clipEnd(c, song)]).sort((a, b) => a[0] - b[0]);
/** no two clips of one track overlap */
const tidySong = (song: TimelineSong) => song.tracks.every((t) => spans(song, t.id).every((s, i, all) => i === 0 || all[i - 1][1] <= s[0] + 1e-9));
/** one chords track with clips at the given [start, len] pairs, ids c1, c2 … */
const row = (...at: [number, number][]) => songOf([chordsTrack("tc", "Chords", { lead: true })], { clips: at.map(([s, l], i) => chordsClip(`c${i + 1}`, "tc", s, l)) });

describe("what the track view is written against", () => {
  it("every edit has the name and the shape the plan gives it", () => {
    type Song = TimelineSong;
    type Content = NoteClip["content"];
    // (this is checked when the file is compiled: a function of another shape does not fit its line)
    const shapes: {
      addTrack(song: Song, kind: TrackKind, id: string, at?: number): Song;
      removeTrack(song: Song, id: string): Song;
      duplicateTrack(song: Song, id: string, newId: string): Song;
      moveTrack(song: Song, id: string, toIndex: number): Song;
      renameTrack(song: Song, id: string, name: string): Song;
      setTrack<T extends Track>(song: Song, id: string, patch: Partial<T>): Song;
      copySound: (t: Track) => SoundCopy;
      pasteSound(song: Song, id: string, s: SoundCopy): Song;
      layDown(song: Song, clip: Clip): Song;
      moveClips(song: Song, ids: string[], dBeats: number, toTrack?: string): Song;
      copyClips(song: Song, ids: string[], dBeats: number, toTrack: string | undefined, id: () => string): Song;
      duplicateClips(song: Song, ids: string[], id: () => string): Song;
      resizeClip(song: Song, id: string, edge: "left" | "right", toBeat: number): Song;
      splitClips(song: Song, ids: string[], atBeat: number, id: () => string): Song;
      deleteClips(song: Song, ids: string[]): Song;
      setContent(song: Song, id: string, content: Content): Song;
      setDraft(song: Song, track: string, content: Content | null, sig: TimeSig): Song;
      placeDraft(song: Song, track: string, atBeat: number, id: () => string): Song;
      blankContent: (kind: ClipKind, sig: TimeSig) => Content;
      draftAnchor: (song: Song, session: Pick<Session, "cursor" | "loop">) => number;
      setSig(song: Song, atBar: number, sig: TimeSig, fromHereOn: boolean): Song;
      setTempo(song: Song, bpm: number): Song;
      transpose(song: Song, n: number, from: Key, to: Key): Song;
      songEnd(song: Song): number;
      clipsIn(song: Song, from: number, to: number): string[];
      cutTime(song: Song, from: number, to: number): Song;
      insertTime(song: Song, at: number, beats: number): Song;
      copyOut(song: Song, ids: string[], key: Key): Clipboard5;
      pasteIn(song: Song, c: Clipboard5, atBeat: number, key: Key, onto: string | null, id: () => string): Song;
    } = {
      addTrack, removeTrack, duplicateTrack, moveTrack, renameTrack, setTrack, copySound, pasteSound, layDown, moveClips, copyClips, duplicateClips, resizeClip, splitClips, deleteClips,
      setContent, setDraft, placeDraft, blankContent, draftAnchor, setSig, setTempo, transpose, songEnd, clipsIn, cutTime, insertTime, copyOut, pasteIn,
    };
    expect(Object.values(shapes).every((f) => typeof f === "function")).toBe(true);
    expect(Object.keys(shapes)).toHaveLength(29);
  });
});

describe("the edits read nothing but the song", () => {
  it("no clock, no random number, no storage and no screen in the file (ids come in through an argument)", () => {
    const code = source.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
    for (const word of ["Date", "Math.random", "localStorage", "sessionStorage", "indexedDB", "document", "window", "performance"]) expect(code.includes(word), word).toBe(false);
  });
});

describe("addTrack", () => {
  const empty = songOf([]);

  it("a chords track: guitar, the default sound, and the first one leads", () => {
    const one = addTrack(empty, "chords", "t1");
    expect(one.tracks).toEqual([{ id: "t1", kind: "chords", name: "Chords", tone: GUITAR, sound: SOUND_DEFAULT, lead: true }]);
    const two = addTrack(one, "chords", "t2");
    expect(two.tracks[1]).toEqual({ id: "t2", kind: "chords", name: "Chords 2", tone: GUITAR, sound: SOUND_DEFAULT });
  });

  it("a melody track: guitar and the default sound", () => {
    expect(addTrack(empty, "melody", "t1").tracks[0]).toEqual({ id: "t1", kind: "melody", name: "Melody", tone: GUITAR, sound: SOUND_DEFAULT });
  });

  it("a bass track: the synth on the first of its bass sounds", () => {
    const t = track<TuneTrack>(addTrack(empty, "bass", "t1"), "t1");
    expect(t).toMatchObject({ kind: "bass", name: "Bass", tone: { inst: "synth" } });
    expect(t.tone.synth).toEqual(presetsIn("bass")[0].params);
  });

  it("a drums track: the plain kit, and the first one leads", () => {
    const one = addTrack(empty, "drums", "t1");
    expect(one.tracks[0]).toEqual({ id: "t1", kind: "drums", name: "Drums", kit: PLAIN_KIT, lead: true });
    expect(track<DrumsTrack>(addTrack(one, "drums", "t2"), "t2").lead).toBeUndefined();
    expect(track(addTrack(one, "drums", "t2"), "t2").name).toBe("Drums 2");
  });

  it("a vocal track: the chain on, as its first starting point sets it, input 1, no takes", () => {
    const t = track<AudioTrack>(addTrack(empty, "vocals", "t1"), "t1");
    expect(t).toEqual({ id: "t1", kind: "vocals", name: "Vocal 1", fx: FX_DEFAULT, takes: [] });
    expect(t.fx.on).toBe(true);
    expect(t.fx).toEqual(presetFx(PRESETS[0].id, empty.bpm));
    expect(t.input).toBeUndefined();
  });

  it("a blank track: the same chain, switched off", () => {
    const t = track<AudioTrack>(addTrack(empty, "audio", "t1"), "t1");
    expect(t).toEqual({ id: "t1", kind: "audio", name: "Audio 1", fx: { ...FX_DEFAULT, on: false }, takes: [] });
  });

  it("goes below the last track, or to the row asked for", () => {
    const band = bandSong();
    expect(addTrack(band, "melody", "x").tracks.map((t) => t.id)).toEqual(["tc", "tm", "tb", "td", "tv", "x"]);
    expect(addTrack(band, "melody", "x", 1).tracks.map((t) => t.id)).toEqual(["tc", "x", "tm", "tb", "td", "tv"]);
    expect(addTrack(band, "melody", "x").tracks.find((t) => t.id === "x")!.name).toBe("Melody 2");
    expect(addTrack(band, "vocals", "x").tracks.find((t) => t.id === "x")!.name).toBe("Vocal 2");
  });

  it("the ids the engine keeps for itself are refused, and so is an id that is taken", () => {
    for (const id of ["chords", "melody", "drums", ""]) expect(addTrack(empty, "chords", id)).toBe(empty);
    const band = bandSong();
    expect(addTrack(band, "chords", "tc")).toBe(band);
  });
});

describe("removeTrack", () => {
  it("takes the track, its clips and its mixer entry, and nothing else", () => {
    const band = { ...bandSong(), mix: { tm: { db: -3 }, tc: { mute: true } } };
    const out = removeTrack(band, "tm");
    expect(out.tracks.map((t) => t.id)).toEqual(["tc", "tb", "td", "tv"]);
    expect(ids(out)).toEqual(["c1", "c2", "b1", "d1", "a1"]);
    expect(out.mix).toEqual({ tc: { mute: true } });
    expect(out.shelf).toBeUndefined();
    expect(removeTrack(band, "nope")).toBe(band);
  });

  it("an audio track's takes go to the shelf, so no recording is lost", () => {
    const band = bandSong();
    const out = removeTrack(band, "tv");
    expect(out.tracks.some((t) => t.id === "tv")).toBe(false);
    expect(ids(out, "tv")).toEqual([]);
    expect(out.shelf).toEqual([{ track: "tv", name: "Vocal 1", kind: "vocals", takes: track<AudioTrack>(band, "tv").takes, at: 4, saves: 0 }]);
    // a second removed track is added to the shelf, not put in its place
    const again = removeTrack(addTrack(out, "audio", "t9"), "t9");
    expect(again.shelf).toHaveLength(1);
    const two = { ...out, tracks: [...out.tracks, audioTrack("t9", "audio", "Audio 1", [take("k9", 1)])] };
    expect(removeTrack(two, "t9").shelf!.map((s) => s.track)).toEqual(["tv", "t9"]);
  });

  it("when the track that led is removed, the top track of its kind leads", () => {
    const song = songOf([chordsTrack("a", "Chords", { lead: true }), tuneTrack("m"), chordsTrack("b", "Chords 2"), chordsTrack("c", "Chords 3"), drumsTrack("d", "Drums", { lead: true })]);
    const out = removeTrack(song, "a");
    expect(track(out, "b").lead).toBe(true);
    expect(track(out, "c").lead).toBeUndefined();
    // the last drums track: nobody is left to lead
    expect(removeTrack(song, "d").tracks.filter((t) => t.kind === "drums")).toEqual([]);
    // a track that did not lead changes nobody
    expect(track(removeTrack(song, "b"), "c").lead).toBeUndefined();
  });

  it("when another track of its kind still leads, nothing is passed on", () => {
    const song = songOf([chordsTrack("x", "Chords 0"), chordsTrack("a", "Chords", { lead: true }), chordsTrack("b", "Chords · B", { lead: true })]);
    const out = removeTrack(song, "a");
    expect(track(out, "x").lead).toBeUndefined();
    expect(track(out, "b").lead).toBe(true);
  });

  it("a clip that played instead of the removed track no longer points at it", () => {
    const song = songOf([chordsTrack("a", "Chords", { lead: true }), chordsTrack("b", "Harmony")], { clips: [chordsClip("c1", "a", 0, 16), chordsClip("h1", "b", 0, 16, { instead: "a" })] });
    expect(clip<ChordsClip>(removeTrack(song, "a"), "h1").instead).toBeUndefined();
  });
});

describe("duplicateTrack", () => {
  it("the copy has the sound and no clips, directly below", () => {
    const band = { ...bandSong(), mix: { td: { db: -6, solo: true } } };
    const kit = { ...PLAIN_KIT, level: 0.5 };
    const song = setTrack<DrumsTrack>(band, "td", { kit, color: 3 });
    const out = duplicateTrack(song, "td", "td2");
    expect(out.tracks.map((t) => t.id)).toEqual(["tc", "tm", "tb", "td", "td2", "tv"]);
    const copy = track<DrumsTrack>(out, "td2");
    expect(copy).toEqual({ id: "td2", kind: "drums", name: "Drums 2", kit, color: 3 });
    expect(copy.kit).not.toBe(kit);
    expect(copy.lead).toBeUndefined();
    expect(ids(out, "td2")).toEqual([]);
    expect(out.clips).toBe(song.clips);
    expect(out.mix).toEqual({ td: { db: -6, solo: true }, td2: { db: -6, solo: true } });
  });

  it("a recorded track's copy has its chain and its input, and none of its takes", () => {
    const band = setTrack<AudioTrack>(bandSong(), "tv", { input: { ch: 2, pair: true } });
    const copy = track<AudioTrack>(duplicateTrack(band, "tv", "tv2"), "tv2");
    expect(copy).toEqual({ id: "tv2", kind: "vocals", name: "Vocal 2", fx: FX_DEFAULT, takes: [], input: { ch: 2, pair: true } });
  });

  it("what is being composed on the track, and its harmony record, stay behind", () => {
    const song = setDraft(setTrack<ChordsTrack>(bandSong(), "tc", { role: "harmony", harmony: { from: "tm", option: "x" } }), "tc", chordsContent(2), SIG44);
    const copy = track<ChordsTrack>(duplicateTrack(song, "tc", "tc2"), "tc2");
    expect(copy).toEqual({ id: "tc2", kind: "chords", name: "Chords 2", tone: GUITAR, sound: SOUND_DEFAULT });
  });

  it("an id that is taken or kept by the engine, or a track that is not there, changes nothing", () => {
    const band = bandSong();
    expect(duplicateTrack(band, "td", "tc")).toBe(band);
    expect(duplicateTrack(band, "td", "drums")).toBe(band);
    expect(duplicateTrack(band, "nope", "x")).toBe(band);
  });
});

describe("moveTrack, renameTrack, setTrack", () => {
  it("a track moved to another row", () => {
    const band = bandSong();
    expect(moveTrack(band, "tm", 2).tracks.map((t) => t.id)).toEqual(["tc", "tb", "tm", "td", "tv"]);
    expect(moveTrack(band, "tv", 0).tracks.map((t) => t.id)).toEqual(["tv", "tc", "tm", "tb", "td"]);
    expect(moveTrack(band, "tc", 99).tracks.map((t) => t.id)).toEqual(["tm", "tb", "td", "tv", "tc"]);
    expect(moveTrack(band, "tm", 1)).toBe(band);
    expect(moveTrack(band, "nope", 1)).toBe(band);
    expect(moveTrack(band, "tm", 2).clips).toBe(band.clips);
  });

  it("a track renamed", () => {
    const band = bandSong();
    expect(track(renameTrack(band, "tb", "  Low  "), "tb").name).toBe("Low");
    expect(renameTrack(band, "tb", "Bass")).toBe(band);
    expect(renameTrack(band, "tb", "   ")).toBe(band);
    expect(track(renameTrack(band, "tb", "x".repeat(50)), "tb").name).toHaveLength(32);
  });

  it("fields of a track set; its id and kind stay; the same value changes nothing", () => {
    const band = bandSong();
    const tone = { inst: "piano" as const, pedal: true };
    const out = setTrack<ChordsTrack>(band, "tc", { tone });
    expect(track(out, "tc").tone).toBe(tone);
    expect(out.tracks[1]).toBe(band.tracks[1]);
    expect(setTrack<ChordsTrack>(out, "tc", { tone })).toBe(out);
    expect(track(setTrack(band, "tc", { id: "zz", kind: "drums" } as never), "tc")).toBe(band.tracks[0]);
    expect(track<AudioTrack>(setTrack<AudioTrack>(band, "tv", { input: { ch: 1 } }), "tv").input).toEqual({ ch: 1 });
    // a field given as undefined is taken off
    const off = setTrack<ChordsTrack>(band, "tc", { sound: undefined });
    expect("sound" in track(off, "tc")).toBe(false);
    expect(setTrack(band, "nope", { name: "x" })).toBe(band);
  });
});

describe("copySound, pasteSound", () => {
  it("a track's sound is carried to another track of the same kind, as a copy of its own", () => {
    const tone = { inst: "piano" as const, keys: "electric" as const };
    const sound = { ...SOUND_DEFAULT, echo: 0.4 };
    const song = setTrack<ChordsTrack>(songOf([chordsTrack("a"), chordsTrack("b", "Chords 2")]), "a", { tone, sound });
    const copy = copySound(track(song, "a"));
    expect(copy).toEqual({ kind: "chords", tone, sound });
    expect(copy.tone).not.toBe(tone);
    const out = pasteSound(song, "b", copy);
    expect(track(out, "b")).toMatchObject({ id: "b", name: "Chords 2", tone, sound });
    expect(track(out, "b").sound).not.toBe(copy.sound);
    // pasting it again changes nothing
    expect(pasteSound(out, "b", copy)).toBe(out);
  });

  it("onto a track of another kind it changes nothing", () => {
    const band = bandSong();
    const chords = copySound(track(band, "tc"));
    for (const id of ["tm", "tb", "td", "tv", "nope"]) expect(pasteSound(band, id, chords)).toBe(band);
    const kit = copySound(track(band, "td"));
    expect(kit).toEqual({ kind: "drums", kit: PLAIN_KIT });
    expect(pasteSound(band, "tc", kit)).toBe(band);
    expect(pasteSound(band, "tv", kit)).toBe(band);
  });

  it("a melody's sound fits a bass track, and a vocal chain a blank track", () => {
    const band = addTrack(bandSong(), "audio", "tx");
    const lead = copySound({ ...track<TuneTrack>(band, "tm"), tone: { inst: "piano" } });
    expect(lead.kind).toBe("melody");
    expect(track<TuneTrack>(pasteSound(band, "tb", lead), "tb").tone).toEqual({ inst: "piano" });
    const chain = copySound(track(band, "tv"));
    expect(chain).toEqual({ kind: "audio", fx: FX_DEFAULT });
    expect(track<AudioTrack>(pasteSound(band, "tx", chain), "tx").fx.on).toBe(true);
  });

  it("a kit is pasted onto a drums track; a copy with no sound knobs takes the track's own off", () => {
    const band = addTrack(bandSong(), "drums", "t2");
    const kit: SoundCopy = { kind: "drums", kit: { ...PLAIN_KIT, level: 0.3 } };
    expect(track<DrumsTrack>(pasteSound(band, "t2", kit), "t2").kit.level).toBe(0.3);
    const bare: SoundCopy = { kind: "chords", tone: { inst: "synth" } };
    const out = pasteSound(band, "tc", bare);
    expect("sound" in track(out, "tc")).toBe(false);
    expect(track(out, "tc").tone).toEqual({ inst: "synth" });
  });
});

describe("layDown", () => {
  it("in free space: the clip is added and nothing else changes", () => {
    const song = row([0, 8]);
    const out = layDown(song, chordsClip("x", "tc", 16, 8));
    expect(spans(out, "tc")).toEqual([[0, 8], [16, 24]]);
    expect(out.clips[0]).toBe(song.clips[0]);
  });

  it("over the start of a clip: that clip's left edge comes in, and what is left of it plays where it did", () => {
    const song = row([8, 16]);
    const before = clip<ChordsClip>(song, "c1");
    const out = layDown(song, chordsClip("x", "tc", 4, 8));
    expect(spans(out, "tc")).toEqual([[4, 12], [12, 24]]);
    const after = clip<ChordsClip>(out, "c1");
    expect(after).toMatchObject({ start: 12, len: 12, off: 4 });
    for (const x of [12, 15, 23]) expect(phase(after, x)).toBe(phase(before, x));
  });

  it("over the end of a clip: that clip's right edge comes in", () => {
    const song = row([0, 16]);
    const out = layDown(song, chordsClip("x", "tc", 12, 8));
    expect(spans(out, "tc")).toEqual([[0, 12], [12, 20]]);
    expect(clip<ChordsClip>(out, "c1")).toMatchObject({ start: 0, len: 12, off: 0 });
  });

  it("inside a clip: that clip is split in two round it", () => {
    const song = row([0, 32]);
    const before = clip<ChordsClip>(song, "c1");
    const out = layDown(song, chordsClip("x", "tc", 8, 8));
    expect(spans(out, "tc")).toEqual([[0, 8], [8, 16], [16, 32]]);
    expect(ids(out)).toEqual(["c1", "c1:2", "x"]);
    expect(clip<ChordsClip>(out, "c1")).toMatchObject({ start: 0, len: 8, off: 0 });
    const tail = clip<ChordsClip>(out, "c1:2");
    expect(tail).toMatchObject({ start: 16, len: 16, off: 16 });
    for (const x of [16, 20, 31]) expect(phase(tail, x)).toBe(phase(before, x));
    // a second cut of the same clip gets the next free id
    const again = layDown(out, chordsClip("y", "tc", 2, 2));
    expect(ids(again)).toEqual(["c1", "c1:3", "c1:2", "x", "y"]);
  });

  it("over the whole of a clip: that clip goes", () => {
    const song = row([4, 4], [8, 4], [16, 4]);
    const out = layDown(song, chordsClip("x", "tc", 4, 8));
    expect(ids(out)).toEqual(["c3", "x"]);
    // several at once: one covered, one trimmed on each side
    const more = layDown(row([0, 8], [8, 4], [12, 8]), chordsClip("x", "tc", 6, 8));
    expect(spans(more, "tc")).toEqual([[0, 6], [6, 14], [14, 20]]);
    expect(ids(more)).toEqual(["c1", "c3", "x"]);
  });

  it("clips that only touch are left alone, and so are the other tracks", () => {
    const band = bandSong();
    const out = layDown(band, melodyClip("x", "tm", 0, 32));
    expect(spans(out, "tm")).toEqual([[0, 32], [32, 64]]);
    for (const c of band.clips) expect(out.clips).toContain(c);
  });

  it("a track only takes clips of its own kind (and a melody clip also lies on a bass track)", () => {
    const band = bandSong();
    expect(layDown(band, melodyClip("x", "tc", 0, 8))).toBe(band);
    expect(layDown(band, chordsClip("x", "td", 0, 8))).toBe(band);
    expect(layDown(band, drumsClip("x", "tv", 0, 16))).toBe(band);
    expect(layDown(band, chordsClip("x", "nope", 0, 8))).toBe(band);
    expect(ids(layDown(band, melodyClip("x", "tb", 40, 8)), "tb")).toEqual(["b1", "x"]);
  });

  it("a clip with the id of one in the song takes its place", () => {
    const song = row([0, 8], [8, 8]);
    const out = layDown(song, { ...clip<ChordsClip>(song, "c1"), len: 12 });
    expect(ids(out)).toEqual(["c1", "c2"]);
    expect(spans(out, "tc")).toEqual([[0, 12], [12, 16]]);
    // the very same clip put down again: nothing happens
    expect(layDown(song, song.clips[0])).toBe(song);
  });

  it("a note clip is kept on whole beats, at or after beat 0", () => {
    const out = layDown(row(), chordsClip("x", "tc", -2.3, 7.6, { off: 18 }));
    expect(clip<ChordsClip>(out, "x")).toMatchObject({ start: 0, len: 8, off: 2 });
  });

  it("an audio clip trims audio clips to the frame, and the sound that is left stays where it was", () => {
    const sung = take("k1", 10, 0);
    const other = take("k2", 2, 0);
    // at 60 beats a minute a second is a beat
    const song = songOf([audioTrack("tv", "vocals", "Vocal 1", [sung, other])], { bpm: 60, clips: [audioClip("a", "tv", sung, 0)] });
    const out = layDown(song, audioClip("b", "tv", other, 3.5));
    expect(ids(out)).toEqual(["a", "a:2", "b"]);
    const left = clip<AudioClip>(out, "a");
    const right = clip<AudioClip>(out, "a:2");
    expect(left).toMatchObject({ start: 0, off: 0, frames: 3.5 * 48000 });
    expect(right).toMatchObject({ start: 5.5, off: 5.5 * 48000, frames: 4.5 * 48000, from: 0, to: 480000, take: "k1" });
    expect(zeroBeat(right, 60, 48000)).toBe(zeroBeat(left, 60, 48000));
    expect(tidySong(out)).toBe(true);
  });
});

describe("moveClips", () => {
  it("two chosen clips move together and keep their spacing", () => {
    const song = row([0, 4], [8, 4], [20, 4]);
    const out = moveClips(song, ["c1", "c2"], 12);
    expect(clip(out, "c1").start).toBe(12);
    expect(clip(out, "c2").start).toBe(20);
    // c3 lay where c2 landed: it made way
    expect(ids(out)).toEqual(["c1", "c2"]);
    expect(out.clips.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("never before beat 0: the whole group stops when its first clip does", () => {
    const song = row([4, 4], [12, 4]);
    const out = moveClips(song, ["c1", "c2"], -10);
    expect(clip(out, "c1").start).toBe(0);
    expect(clip(out, "c2").start).toBe(8);
    expect(moveClips(row([0, 4]), ["c1"], -4)).toEqual(row([0, 4]));
  });

  it("a move of nothing, or of a clip that is not there, gives the same song", () => {
    const song = row([0, 4]);
    expect(moveClips(song, ["c1"], 0)).toBe(song);
    expect(moveClips(song, ["nope"], 4)).toBe(song);
    expect(moveClips(song, [], 4)).toBe(song);
    expect(moveClips(song, ["c1"], 0, "tc")).toBe(song);
    expect(moveClips(song, ["c1"], NaN)).toBe(song);
  });

  it("where it lands it trims what it covers, and its own old place is not in its way", () => {
    const song = row([0, 8], [8, 8]);
    const out = moveClips(song, ["c1"], 4);
    expect(spans(out, "tc")).toEqual([[4, 12], [12, 16]]);
    expect(clip<ChordsClip>(out, "c2")).toMatchObject({ start: 12, len: 4, off: 4 });
    // two neighbours moved by one clip's length: the first lands where the second was, and both arrive whole
    const both = moveClips(song, ["c1", "c2"], 8);
    expect(spans(both, "tc")).toEqual([[8, 16], [16, 24]]);
  });

  it("onto another track that takes it; onto one that does not, nothing changes", () => {
    const band = bandSong();
    const out = moveClips(band, ["m1"], -32, "tb");
    expect(clip(out, "m1")).toMatchObject({ track: "tb", start: 0 });
    // the bass clip that lay there made way
    expect(ids(out, "tb")).toEqual(["m1"]);
    for (const to of ["tc", "td", "tv", "nope"]) expect(moveClips(band, ["m1"], 0, to)).toBe(band);
    // a group that one track cannot take whole does not move at all
    expect(moveClips(band, ["m1", "c1"], 4, "tb")).toBe(band);
  });

  it("a note clip moves by whole beats", () => {
    const out = moveClips(row([4, 4]), ["c1"], 2.4);
    expect(clip(out, "c1").start).toBe(6);
  });

  it("a drums clip only lands on a bar line", () => {
    const band = bandSong();
    expect(moveClips(band, ["d1"], 2)).toBe(band);
    expect(clip(moveClips(band, ["d1"], 4), "d1").start).toBe(20);
    // in a song whose bars change length the lines are where the bar map says
    const mixed = mixedSong();
    expect(moveClips(mixed, ["d3"], 17)).toBe(mixed);
    expect(clip(moveClips(mixed, ["d3"], 16), "d3").start).toBe(56);
  });

  it("an audio clip moves freely, and onto another audio track it brings its take's record", () => {
    const band = addTrack(bandSong(), "audio", "tx");
    const near = moveClips(band, ["a1"], 0.37);
    expect(clip(near, "a1").start).toBeCloseTo(32.37, 9);
    const out = moveClips(band, ["a1"], 0, "tx");
    expect(clip(out, "a1").track).toBe("tx");
    const there = track<AudioTrack>(out, "tx").takes;
    expect(there).toEqual(track<AudioTrack>(band, "tv").takes);
    expect(there[0]).not.toBe(track<AudioTrack>(band, "tv").takes[0]);
    // the track it came from keeps the take (a recording never leaves by an edit)
    expect(track<AudioTrack>(out, "tv").takes).toBe(track<AudioTrack>(band, "tv").takes);
    // and back again: the record is not added twice
    expect(track<AudioTrack>(moveClips(out, ["a1"], 0, "tv"), "tv").takes).toHaveLength(1);
    expect(clipEnd(clip(out, "a1"), out)).toBeCloseTo(32 + 12.8, 9);
  });
});

describe("copyClips", () => {
  it("the original stays; the copy has a new id and a content that is equal but its own", () => {
    const band = bandSong();
    const out = copyClips(band, ["d1"], 16, undefined, counter());
    expect(clip(out, "d1")).toBe(clip(band, "d1"));
    const copy = clip<DrumsClip>(out, "n1");
    expect(copy).toEqual({ ...clip(band, "d1"), id: "n1", start: 32 });
    expect(copy.content).not.toBe(clip<DrumsClip>(band, "d1").content);
    expect(copy.content.rows).not.toBe(clip<DrumsClip>(band, "d1").content.rows);
  });

  it("copies are separate: a change to one never reaches the other", () => {
    const band = bandSong();
    const out = copyClips(band, ["c1"], 64, undefined, counter());
    const changed = setContent(out, "n1", chordsContent(8, SIG44, [chord("z", "D", 32)]));
    expect(clip<ChordsClip>(changed, "c1").content).toBe(clip<ChordsClip>(band, "c1").content);
    expect(clip<ChordsClip>(changed, "n1").content.chords).toHaveLength(1);
    // and the other way round
    const back = setContent(out, "c1", chordsContent(8, SIG44, [chord("z", "D", 32)]));
    expect(clip<ChordsClip>(back, "n1").content.chords).toHaveLength(8);
  });

  it("several copies keep their spacing, land on another track, and trim what they cover", () => {
    const song = { ...row([0, 4], [8, 4]), tracks: [chordsTrack("tc", "Chords", { lead: true }), chordsTrack("t2", "Chords 2")] };
    const laid = layDown(song, chordsClip("old", "t2", 2, 8));
    const out = copyClips(laid, ["c1", "c2"], 0, "t2", counter());
    expect(ids(out, "tc")).toEqual(["c1", "c2"]);
    expect(spans(out, "t2")).toEqual([[0, 4], [4, 8], [8, 12]]);
    expect(clip(out, "n1")).toMatchObject({ track: "t2", start: 0 });
    expect(clip(out, "n2")).toMatchObject({ track: "t2", start: 8 });
  });

  it("onto a track that does not take it, off a bar line for drums, or onto itself: nothing changes and no id is used", () => {
    const band = bandSong();
    let used = 0;
    const id = () => `x${++used}`;
    expect(copyClips(band, ["d1"], 16, "tc", id)).toBe(band);
    expect(copyClips(band, ["d1"], 3, undefined, id)).toBe(band);
    expect(copyClips(band, ["d1"], 0, undefined, id)).toBe(band);
    expect(copyClips(band, ["nope"], 4, undefined, id)).toBe(band);
    expect(used).toBe(0);
  });

  it("an audio copy on another audio track brings its take's record", () => {
    const band = addTrack(bandSong(), "audio", "tx");
    const out = copyClips(band, ["a1"], 4, "tx", counter());
    expect(clip(out, "a1").track).toBe("tv");
    expect(clip<AudioClip>(out, "n1")).toMatchObject({ track: "tx", take: "k1", start: 36 });
    expect(track<AudioTrack>(out, "tx").takes.map((k) => k.id)).toEqual(["k1"]);
    expect(track<AudioTrack>(out, "tx").takes[0].dry).toBe("k1-dry.wav");
  });
});

describe("duplicateClips", () => {
  it("a separate copy straight after each chosen clip", () => {
    const band = bandSong();
    const out = duplicateClips(band, ["b1", "d1"], counter());
    expect(clip(out, "n1")).toMatchObject({ track: "tb", start: 32, len: 32 });
    expect(clip(out, "n2")).toMatchObject({ track: "td", start: 32, len: 16 });
    expect(clip<MelodyClip>(out, "n1").content).toEqual(clip<MelodyClip>(band, "b1").content);
    expect(clip<MelodyClip>(out, "n1").content).not.toBe(clip<MelodyClip>(band, "b1").content);
    expect(duplicateClips(band, [], counter())).toBe(band);
  });

  it("the copy trims what lay there", () => {
    const out = duplicateClips(bandSong(), ["c1"], counter());
    expect(ids(out, "tc")).toEqual(["c1", "n1"]);
    expect(spans(out, "tc")).toEqual([[0, 32], [32, 64]]);
  });

  it("clips chosen together on one track are copied as one run, after the last of them", () => {
    const out = duplicateClips(row([0, 4], [4, 4], [20, 4]), ["c1", "c2"], counter());
    expect(spans(out, "tc")).toEqual([[0, 4], [4, 8], [8, 12], [12, 16], [20, 24]]);
    expect(clip(out, "n1").start).toBe(8);
    expect(clip(out, "n2").start).toBe(12);
  });

  it("an audio copy starts exactly where the clip ends", () => {
    const band = bandSong();
    const out = duplicateClips(band, ["a1"], counter());
    expect(clip<AudioClip>(out, "n1")).toMatchObject({ take: "k1", off: 0, frames: 8 * 48000 });
    expect(clip(out, "n1").start).toBeCloseTo(clipEnd(clip(band, "a1"), band), 9);
  });
});

describe("resizeClip", () => {
  it("the worked example of the plan: a 4-bar rhythm at bar 5, its right edge dragged from bar 9 to bar 15, then its left edge from bar 5 to bar 3", () => {
    const first = bandSong();
    expect(clip<DrumsClip>(first, "d1")).toMatchObject({ start: 16, len: 16, off: 0 });
    expect(contentBeats(clip<DrumsClip>(first, "d1"))).toBe(16);
    // 1. the rhythm twice, then its first two bars; notches at bars 9 and 13
    const longer = resizeClip(first, "d1", "right", 56);
    const ten = clip<DrumsClip>(longer, "d1");
    expect(ten).toEqual({ ...clip(first, "d1"), len: 40 });
    expect(cycles(ten)).toEqual([{ at: 0, from: 0, to: 16 }, { at: 16, from: 0, to: 16 }, { at: 32, from: 0, to: 8 }]);
    expect(notches(ten, longer)).toEqual([32, 48]);
    // 2. it now opens with bars 3 and 4 of the rhythm, then a notch at beat 16, where the rhythm started before
    const both = resizeClip(longer, "d1", "left", 8);
    const twelve = clip<DrumsClip>(both, "d1");
    expect(twelve).toMatchObject({ off: 8, len: 48, start: 8 });
    expect(notches(twelve, both)).toEqual([16, 32, 48]);
    expect(twelve.content).toBe(clip<DrumsClip>(first, "d1").content);
    for (const x of [16, 21, 32, 47, 55]) expect(phase(twelve, x)).toBe(phase(ten, x));
    // nothing else in the song moved
    for (const c of first.clips) if (c.id !== "d1") expect(both.clips).toContain(c);
  });

  it("the right edge only changes how long the clip is", () => {
    const song = row([8, 8]);
    const out = resizeClip(song, "c1", "right", 28);
    expect(clip<ChordsClip>(out, "c1")).toEqual({ ...clip(song, "c1"), len: 20 });
    expect(notches(clip(out, "c1"), out)).toEqual([16, 24]);
    // and shorter: a trim
    expect(clip<ChordsClip>(resizeClip(song, "c1", "right", 11), "c1")).toMatchObject({ start: 8, len: 3, off: 0 });
    expect(resizeClip(song, "c1", "right", 16)).toBe(song);
  });

  it("the left edge changes the start, the length and how far into the content the clip opens; what was heard stays where it was", () => {
    const song = row([8, 8]);
    const before = clip<ChordsClip>(song, "c1");
    const longer = clip<ChordsClip>(resizeClip(song, "c1", "left", 2), "c1");
    expect(longer).toMatchObject({ start: 2, len: 14, off: 2 });
    expect(cycles(longer)).toEqual([{ at: 0, from: 2, to: 8 }, { at: 6, from: 0, to: 8 }]);
    const shorter = clip<ChordsClip>(resizeClip(song, "c1", "left", 11), "c1");
    expect(shorter).toMatchObject({ start: 11, len: 5, off: 3 });
    for (const x of [11, 12, 15]) {
      expect(phase(longer, x)).toBe(phase(before, x));
      expect(phase(shorter, x)).toBe(phase(before, x));
    }
    expect(resizeClip(song, "c1", "left", 8)).toBe(song);
  });

  it("an edge stops at the next clip on the track and at beat 0", () => {
    const song = row([4, 4], [12, 4], [20, 4]);
    expect(clip<ChordsClip>(resizeClip(song, "c2", "right", 40), "c2").len).toBe(8);
    expect(clip<ChordsClip>(resizeClip(song, "c2", "left", 0), "c2")).toMatchObject({ start: 8, len: 8, off: 0 });
    expect(clip<ChordsClip>(resizeClip(song, "c1", "left", -9), "c1")).toMatchObject({ start: 0, len: 8, off: 0 });
    expect(clip<ChordsClip>(resizeClip(song, "c3", "right", 400), "c3").len).toBe(380);
    for (const out of [resizeClip(song, "c2", "right", 40), resizeClip(song, "c2", "left", 0)]) {
      expect(tidySong(out)).toBe(true);
      expect(ids(out)).toEqual(["c1", "c2", "c3"]);
    }
  });

  it("a note clip stays on whole beats and is never shorter than one", () => {
    const song = row([8, 8]);
    expect(clip<ChordsClip>(resizeClip(song, "c1", "right", 13.4), "c1").len).toBe(5);
    expect(clip<ChordsClip>(resizeClip(song, "c1", "right", 2), "c1").len).toBe(1);
    expect(clip<ChordsClip>(resizeClip(song, "c1", "left", 30), "c1")).toMatchObject({ start: 15, len: 1, off: 7 });
    expect(clip<ChordsClip>(resizeClip(song, "c1", "left", 9.6), "c1")).toMatchObject({ start: 10, len: 6, off: 2 });
  });

  it("a drums clip refuses a beat that is not a bar line", () => {
    const band = bandSong();
    expect(resizeClip(band, "d1", "right", 38)).toBe(band);
    expect(resizeClip(band, "d1", "left", 10)).toBe(band);
    expect(resizeClip(band, "d1", "right", 39.5)).toBe(band);
    expect(clip<DrumsClip>(resizeClip(band, "d1", "right", 40), "d1")).toMatchObject({ start: 16, len: 24, off: 0 });
    expect(clip<DrumsClip>(resizeClip(band, "d1", "left", 8), "d1")).toMatchObject({ start: 8, len: 24, off: 8 });
    // never shorter than a bar
    expect(clip<DrumsClip>(resizeClip(band, "d1", "right", 0), "d1").len).toBe(4);
    expect(clip<DrumsClip>(resizeClip(band, "d1", "left", 60), "d1")).toMatchObject({ start: 28, len: 4, off: 12 });
    // the bar lines of a song whose bars change length
    const mixed = mixedSong();
    expect(resizeClip(mixed, "d1", "left", 2)).toBe(mixed);
    expect(resizeClip(mixed, "d2", "right", 37)).toBe(mixed);
    expect(clip<DrumsClip>(resizeClip(mixed, "d2", "right", 38), "d2").len).toBe(6);
  });

  it("an audio clip's right edge first uncovers the rest of the take, then repeats it", () => {
    const band = bandSong();
    // the clip shows the first 8 of 12 seconds from beat 32; at 96 a second is 1.6 beats
    const all = resizeClip(band, "a1", "right", 32 + 12 * 1.6);
    expect(clip<AudioClip>(all, "a1")).toMatchObject({ start: 32, off: 0, from: 0, to: 576000 });
    expect(clip<AudioClip>(all, "a1").frames).toBe(576000);
    expect(notches(clip(all, "a1"), all)).toEqual([]);
    const more = resizeClip(band, "a1", "right", 32 + 15 * 1.6);
    expect(clip<AudioClip>(more, "a1").frames).toBe(720000);
    // the take starts again where it ended: a notch 12 seconds in
    expect(notches(clip(more, "a1"), more)[0]).toBeCloseTo(32 + 12 * 1.6, 9);
    expect(notches(clip(more, "a1"), more)).toHaveLength(1);
  });

  it("an audio clip's left edge uncovers what lies before it, then the end of the take comes round; the sound stays where it was", () => {
    const sung = take("k1", 10, 0);
    const song = songOf([audioTrack("tv", "vocals", "Vocal 1", [sung])], { bpm: 60, clips: [audioClip("a", "tv", sung, 20, { off: 96000, frames: 96000 })] });
    const zero = zeroBeat(clip<AudioClip>(song, "a"), 60, 48000);
    expect(zero).toBe(18);
    const later = clip<AudioClip>(resizeClip(song, "a", "left", 21), "a");
    expect(later).toMatchObject({ start: 21, off: 144000, frames: 48000 });
    const whole = clip<AudioClip>(resizeClip(song, "a", "left", 18), "a");
    expect(whole).toMatchObject({ start: 18, off: 0, frames: 192000 });
    expect(zeroBeat(later, 60, 48000)).toBe(zero);
    expect(zeroBeat(whole, 60, 48000)).toBe(zero);
    // past the take's start its end comes round again
    const round = clip<AudioClip>(resizeClip(song, "a", "left", 15), "a");
    expect(round).toMatchObject({ start: 15, off: 480000 - 144000, frames: 96000 + 5 * 48000 });
    const out = resizeClip(song, "a", "left", 15);
    expect(notches(clip(out, "a"), out)).toEqual([18]);
  });

  it("an audio edge is free, to the frame, stops at its neighbours and at beat 0, and leaves at least 20 ms", () => {
    const sung = take("k1", 4, 0);
    const song = songOf([audioTrack("tv", "vocals", "Vocal 1", [sung])], { bpm: 60, clips: [audioClip("a", "tv", sung, 2, { off: 48000, frames: 48000 }), audioClip("b", "tv", sung, 5, { frames: 48000 })] });
    expect(clip<AudioClip>(resizeClip(song, "a", "right", 3.123), "a").frames).toBe(Math.round(1.123 * 48000));
    expect(clip<AudioClip>(resizeClip(song, "a", "right", 9), "a").frames).toBe(3 * 48000);
    expect(clip<AudioClip>(resizeClip(song, "a", "right", 0), "a").frames).toBe(960);
    expect(clip<AudioClip>(resizeClip(song, "a", "left", 9), "a")).toMatchObject({ frames: 960, off: 96000 - 960 });
    // to beat 0: two seconds more are uncovered (one of the take, then one from its end)
    expect(clip<AudioClip>(resizeClip(song, "a", "left", -4), "a")).toMatchObject({ start: 0, frames: 3 * 48000, off: 3 * 48000 });
    expect(clip<AudioClip>(resizeClip(song, "b", "left", 1), "b")).toMatchObject({ start: 3, frames: 3 * 48000, off: 2 * 48000 });
    expect(tidySong(resizeClip(song, "b", "left", 1))).toBe(true);
  });

  it("a clip that is not there changes nothing", () => {
    const band = bandSong();
    expect(resizeClip(band, "nope", "right", 8)).toBe(band);
    expect(resizeClip(band, "c1", "right", NaN)).toBe(band);
  });
});

describe("splitClips", () => {
  it("a note clip gives two clips; the right one starts at the point of the content that was sounding there", () => {
    const song = row([8, 24]);
    const before = clip<ChordsClip>(song, "c1");
    const out = splitClips(song, ["c1"], 18, counter());
    expect(ids(out)).toEqual(["c1", "n1"]);
    const left = clip<ChordsClip>(out, "c1");
    const right = clip<ChordsClip>(out, "n1");
    expect(left).toMatchObject({ start: 8, len: 10, off: 0 });
    expect(right).toMatchObject({ start: 18, len: 14, off: 10, track: "tc", kind: "chords" });
    expect(right.off).toBe(phase(before, 18));
    for (const x of [18, 23, 31]) expect(phase(right, x)).toBe(phase(before, x));
  });

  it("the halves have separate contents", () => {
    const song = row([0, 16]);
    const out = splitClips(song, ["c1"], 8, counter());
    const left = clip<ChordsClip>(out, "c1");
    const right = clip<ChordsClip>(out, "n1");
    expect(right.content).toEqual(left.content);
    expect(right.content).not.toBe(left.content);
    expect(right.content.chords[0]).not.toBe(left.content.chords[0]);
    const changed = setContent(out, "n1", chordsContent(1));
    expect(clip<ChordsClip>(changed, "c1").content).toBe(left.content);
  });

  it("a clip that repeats is cut inside a later round of its content", () => {
    const band = bandSong();
    const long = resizeClip(band, "d1", "right", 56);
    const out = splitClips(long, ["d1"], 40, counter());
    expect(clip<DrumsClip>(out, "d1")).toMatchObject({ start: 16, len: 24 });
    expect(clip<DrumsClip>(out, "n1")).toMatchObject({ start: 40, len: 16, off: 8 });
  });

  it("a note clip is cut on the nearest beat, a drums clip on the nearest bar line; a beat that is not inside the clip cuts nothing", () => {
    const song = row([8, 8]);
    expect(clip(splitClips(song, ["c1"], 11.6, counter()), "n1").start).toBe(12);
    const band = bandSong();
    expect(clip(splitClips(band, ["d1"], 23, counter()), "n1").start).toBe(24);
    let used = 0;
    const id = () => `x${++used}`;
    expect(splitClips(song, ["c1"], 8, id)).toBe(song);
    expect(splitClips(song, ["c1"], 16, id)).toBe(song);
    expect(splitClips(song, ["c1"], 40, id)).toBe(song);
    expect(splitClips(song, ["nope"], 12, id)).toBe(song);
    expect(splitClips(band, ["d1"], 17, id)).toBe(band);
    expect(used).toBe(0);
  });

  it("only the chosen clips are cut, each with an id of its own", () => {
    const band = bandSong();
    const out = splitClips(band, ["c1", "b1", "m1"], 8, counter());
    expect(ids(out)).toEqual(["c1", "n1", "c2", "m1", "b1", "n2", "d1", "a1"]);
    expect(clip(out, "n1")).toMatchObject({ track: "tc", start: 8, len: 24 });
    expect(clip(out, "n2")).toMatchObject({ track: "tb", start: 8, len: 24 });
  });

  it("an audio clip keeps its take and its stretch and moves on in it: the halves are one continuous sound", () => {
    const band = bandSong();
    const whole = clip<AudioClip>(band, "a1");
    // one second in (1.6 beats at 96), plus a little: cut exactly there, to the frame
    const x = 32 + 1.6 + 0.01;
    const out = splitClips(band, ["a1"], x, counter());
    const left = clip<AudioClip>(out, "a1");
    const right = clip<AudioClip>(out, "n1");
    const cut = Math.round((x - 32) / 1.6 * 48000);
    expect(left).toEqual({ ...whole, frames: cut });
    expect(right).toMatchObject({ take: "k1", from: 0, to: whole.to, off: cut, frames: whole.frames - cut, track: "tv" });
    expect(right.start).toBeCloseTo(x, 4);
    expect(right.start).toBeCloseTo(clipEnd(left, out), 9);
    expect(zeroBeat(right, 96, 48000)).toBe(zeroBeat(left, 96, 48000));
    // too near an edge to leave 20 ms: no cut
    expect(splitClips(band, ["a1"], 32.001, counter())).toBe(band);
  });

  it("the halves of a clip that lies off every grid still only touch: putting one down again takes nothing off the other", () => {
    const band = moveClips(bandSong(), ["a1"], 0.123456789);
    const cut = splitClips(band, ["a1"], 35.4321, counter());
    const left = clip<AudioClip>(cut, "a1");
    const right = clip<AudioClip>(cut, "n1");
    expect(left.frames + right.frames).toBe(8 * 48000);
    expect(Math.abs(right.start - clipEnd(left, cut))).toBeLessThan(1e-6);
    // laid down again, moved away and back, duplicated: the left half keeps every frame
    expect(layDown(cut, { ...right })).toEqual(cut);
    const there = moveClips(addTrack(cut, "audio", "tx"), ["n1"], 0, "tx");
    expect(clip<AudioClip>(moveClips(there, ["n1"], 0, "tv"), "a1")).toBe(left);
    expect(clip<AudioClip>(duplicateClips(cut, ["a1"], counter("m")), "a1")).toBe(left);
    expect(clip<AudioClip>(resizeClip(cut, "n1", "right", 60), "a1")).toBe(left);
  });

  it("a cut inside a repeat of a take starts the right half inside the take again", () => {
    const sung = take("k1", 2, 0);
    const song = songOf([audioTrack("tv", "vocals", "Vocal 1", [sung])], { bpm: 60, clips: [audioClip("a", "tv", sung, 0, { frames: 5 * 48000 })] });
    const out = splitClips(song, ["a"], 3, counter());
    expect(clip<AudioClip>(out, "n1")).toMatchObject({ start: 3, off: 48000, frames: 2 * 48000 });
  });
});

describe("deleteClips", () => {
  it("the chosen clips go and nothing else moves", () => {
    const band = bandSong();
    const out = deleteClips(band, ["c1", "a1"]);
    expect(ids(out)).toEqual(["c2", "m1", "b1", "d1"]);
    for (const c of out.clips) expect(band.clips).toContain(c);
    // the take stays on its track
    expect(out.tracks).toBe(band.tracks);
    expect(deleteClips(band, ["nope"])).toBe(band);
    expect(deleteClips(band, [])).toBe(band);
  });
});

describe("setContent", () => {
  const asGroove = (p: (typeof BEAT_LIBRARY)[number]): Groove => ({ patternId: p.id, name: p.name, edited: false, steps: p.steps, div: p.div, bars: p.bars ?? 1, swing: p.swing, rows: p.rows });

  it("every rhythm of the library, picked into a 3/4 and a 6/8 clip, fits the clip's bars", () => {
    expect(BEAT_LIBRARY.length).toBeGreaterThan(20);
    for (const sig of [SIG34, SIG68] as TimeSig[]) {
      const bar = sigBeats(sig);
      const song = songOf([drumsTrack("td")], { meter: sig, clips: [drumsClip("d", "td", 0, bar * 8, { sig, bars: 1 })] });
      for (const p of BEAT_LIBRARY) {
        const out = setContent(song, "d", asGroove(p));
        const c = clip<DrumsClip>(out, "d");
        expect(c.content.steps / c.content.div, `${p.id} in ${sig.num}/${sig.den}`).toBe(bar);
        if (isCompound(sig)) expect(c.content.div).toBe(3);
        for (const r of Object.values(c.content.rows)) expect(r).toHaveLength(c.content.steps * (c.content.bars ?? 1));
        expect(contentBeats(c)).toBe((p.bars ?? 1) * bar);
        // picking a rhythm never changes the clip's place or length
        expect(c).toMatchObject({ start: 0, len: bar * 8, off: 0 });
      }
    }
  });

  it("a rhythm that already fits is taken as it is", () => {
    const band = bandSong();
    const g = groove(2);
    const out = setContent(band, "d1", g);
    expect(clip<DrumsClip>(out, "d1").content).toBe(g);
    expect(setContent(out, "d1", g)).toBe(out);
  });

  it("chords and a melody are taken as they are; the clip keeps its place and length, and a shorter content comes round again", () => {
    const band = bandSong();
    const two = chordsContent(2);
    const out = setContent(band, "c1", two);
    expect(clip<ChordsClip>(out, "c1")).toEqual({ ...clip(band, "c1"), content: two });
    expect(clip<ChordsClip>(out, "c1").content).toBe(two);
    expect(notches(clip(out, "c1"), out)).toEqual([8, 16, 24]);
    const m = tune(4, [[0, 67]]);
    expect(clip<MelodyClip>(setContent(band, "m1", m), "m1").content).toBe(m);
    expect(clip<MelodyClip>(setContent(band, "b1", m), "b1").content).toBe(m);
  });

  it("a clip that opened far into a long content opens inside the shorter one", () => {
    const song = row([0, 8]);
    const late = { ...song, clips: [{ ...clip<ChordsClip>(song, "c1"), off: 6 }] };
    expect(clip<ChordsClip>(setContent(late, "c1", chordsContent(1)), "c1").off).toBe(2);
  });

  it("a content of another kind, a recorded clip or a clip that is not there: nothing changes", () => {
    const band = bandSong();
    expect(setContent(band, "c1", tune(2))).toBe(band);
    expect(setContent(band, "m1", chordsContent(2))).toBe(band);
    expect(setContent(band, "d1", chordsContent(2))).toBe(band);
    expect(setContent(band, "a1", tune(2))).toBe(band);
    expect(setContent(band, "nope", tune(2))).toBe(band);
    expect(setContent(band, "c1", clip<ChordsClip>(band, "c1").content)).toBe(band);
  });
});

describe("setDraft, placeDraft", () => {
  it("what is being composed is kept on its track, in its signature, and taken off with null", () => {
    const band = bandSong();
    const m = tune(2, [[0, 60]]);
    const out = setDraft(band, "tm", m, SIG44);
    expect(track<TuneTrack>(out, "tm").draft).toEqual({ content: m, sig: SIG44 });
    expect(out.clips).toBe(band.clips);
    expect(setDraft(out, "tm", m, { num: 4, den: 4 })).toBe(out);
    const off = setDraft(out, "tm", null, SIG44);
    expect("draft" in track(off, "tm")).toBe(false);
    expect(setDraft(band, "tm", null, SIG44)).toBe(band);
  });

  it("a drum rhythm being composed is fitted to its signature", () => {
    const band = bandSong();
    const out = setDraft(band, "td", groove(1), SIG68);
    const d = track<DrumsTrack>(out, "td").draft!;
    expect(d.sig).toEqual(SIG68);
    expect(d.content.steps / d.content.div).toBe(2);
    expect(d.content.div).toBe(3);
  });

  it("a content of another kind, or a recorded track, changes nothing", () => {
    const band = bandSong();
    expect(setDraft(band, "tm", chordsContent(2), SIG44)).toBe(band);
    expect(setDraft(band, "tc", groove(1), SIG44)).toBe(band);
    expect(setDraft(band, "tv", tune(2), SIG44)).toBe(band);
    expect(setDraft(band, "nope", tune(2), SIG44)).toBe(band);
    // a melody may be composed on a bass track
    expect(track<TuneTrack>(setDraft(band, "tb", tune(2), SIG44), "tb").draft).toBeDefined();
  });

  it("placing it lands a separate copy, one round of the content long, and the draft stays", () => {
    const m = tune(2, [[0, 60], [3, 64]]);
    const band = setDraft(bandSong(), "tm", m, SIG44);
    const out = placeDraft(band, "tm", 8, counter());
    const c = clip<MelodyClip>(out, "n1");
    expect(c).toEqual({ id: "n1", track: "tm", kind: "melody", start: 8, len: 8, off: 0, sig: SIG44, content: m });
    expect(c.content).not.toBe(m);
    expect(track<TuneTrack>(out, "tm").draft!.content).toBe(m);
    expect(out.tracks).toBe(band.tracks);
  });

  it("a second drop gives a second separate copy, and a drop trims what it covers", () => {
    const band = setDraft(bandSong(), "tm", tune(2, [[0, 60]]), SIG44);
    const id = counter();
    const out = placeDraft(placeDraft(band, "tm", 8, id), "tm", 36, id);
    expect(clip<MelodyClip>(out, "n2").content).toEqual(clip<MelodyClip>(out, "n1").content);
    expect(clip<MelodyClip>(out, "n2").content).not.toBe(clip<MelodyClip>(out, "n1").content);
    // it landed inside the melody clip of bars 9 to 16, which was cut in two round it
    expect(spans(out, "tm")).toEqual([[8, 16], [32, 36], [36, 44], [44, 64]]);
  });

  it("each copy that was placed is its own: changing one changes neither the other nor the draft", () => {
    const g = groove(1);
    const band = setDraft(bandSong(), "td", g, SIG44);
    const id = counter();
    const two = placeDraft(placeDraft(band, "td", 32, id), "td", 48, id);
    expect(spans(two, "td")).toEqual([[16, 32], [32, 36], [48, 52]]);
    const loud = { ...g, rows: { ...g.rows, clap: "3".repeat(16) } };
    const out = setContent(two, "n2", loud);
    expect(clip<DrumsClip>(out, "n2").content.rows.clap).toBe("3".repeat(16));
    expect(clip<DrumsClip>(out, "n1")).toBe(clip<DrumsClip>(two, "n1"));
    expect(clip<DrumsClip>(out, "n1").content.rows.clap).toBe(g.rows.clap);
    expect(track<DrumsTrack>(out, "td").draft!.content).toBe(g);
    // and the draft changed afterwards changes neither of them
    const later = setDraft(out, "td", { ...g, swing: 0.5 }, SIG44);
    expect(later.clips).toBe(out.clips);
  });

  it("a drums draft lands on the bar line at or before; a note draft on the nearest beat", () => {
    const band = setDraft(setDraft(bandSong(), "td", groove(2), SIG44), "tm", tune(1), SIG44);
    expect(clip(placeDraft(band, "td", 38.7, counter()), "n1")).toMatchObject({ start: 36, len: 8 });
    expect(clip(placeDraft(band, "tm", 9.7, counter()), "n1")).toMatchObject({ start: 10, len: 4 });
  });

  it("with nothing being composed, nothing is placed and no id is used", () => {
    const band = bandSong();
    let used = 0;
    expect(placeDraft(band, "tm", 8, () => `x${++used}`)).toBe(band);
    expect(placeDraft(band, "tv", 8, () => `x${++used}`)).toBe(band);
    expect(used).toBe(0);
  });
});

describe("blankContent", () => {
  it("an empty melody is on the triplet grid in 6/8, 9/8 and 12/8, and on halves elsewhere", () => {
    for (const num of [6, 9, 12]) expect(blankContent("melody", { num, den: 8 })).toEqual({ div: 3, bars: 2, notes: [] });
    for (const num of [3, 4, 5]) expect(blankContent("melody", { num, den: 4 })).toEqual({ div: 2, bars: 2, notes: [] });
    // each one is a melody of its own
    expect((blankContent("melody", SIG44) as Melody).notes).not.toBe((blankContent("melody", SIG44) as Melody).notes);
  });

  it("empty chords are four bars, let ring", () => {
    expect(blankContent("chords", SIG34)).toEqual({ chords: [], bars: 4, style: "ring" });
  });

  it("an empty rhythm is one bar that fits the signature", () => {
    for (const sig of [SIG44, SIG34, SIG68, { num: 12, den: 8 } as TimeSig]) {
      const g = blankContent("drums", sig) as Groove;
      expect(g.steps / g.div).toBe(sigBeats(sig));
      expect(g.div).toBe(isCompound(sig) ? 3 : 4);
      expect(g.bars).toBe(1);
      expect(Object.values(g.rows).every((r) => r === "0".repeat(g.steps))).toBe(true);
    }
  });

  it("each can be laid down as a clip on a track of its kind", () => {
    let song = bandSong();
    song = layDown(song, { id: "x1", track: "tc", kind: "chords", start: 64, len: 16, off: 0, sig: SIG44, content: blankContent("chords", SIG44) } as NoteClip);
    song = layDown(song, { id: "x2", track: "td", kind: "drums", start: 64, len: 16, off: 0, sig: SIG44, content: blankContent("drums", SIG44) } as NoteClip);
    song = layDown(song, { id: "x3", track: "tb", kind: "melody", start: 64, len: 16, off: 0, sig: SIG44, content: blankContent("melody", SIG44) } as NoteClip);
    expect(ids(song).slice(-3)).toEqual(["x1", "x2", "x3"]);
    expect(notches(clip(song, "x2"), song)).toEqual([68, 72, 76]);
  });
});

describe("draftAnchor", () => {
  const mixed = mixedSong();
  it("with the loop off: the bar line at or before the cursor", () => {
    expect(draftAnchor(mixed, { cursor: 13.5, loop: null })).toBe(12);
    expect(draftAnchor(mixed, { cursor: 35, loop: null })).toBe(34);
    expect(draftAnchor(mixed, { cursor: 12, loop: { regions: [{ from: 20, to: 28 }], on: false } })).toBe(12);
    expect(draftAnchor(mixed, { cursor: 0, loop: null })).toBe(0);
  });
  it("with the loop on: the bar line at or before the first stretch's start", () => {
    expect(draftAnchor(mixed, { cursor: 3, loop: { regions: [{ from: 21, to: 28 }, { from: 40, to: 44 }], on: true } })).toBe(20);
    expect(draftAnchor(mixed, { cursor: 3, loop: { regions: [{ from: 37, to: 40 }], on: true } })).toBe(36);
    // a loop with no stretch is no loop
    expect(draftAnchor(mixed, { cursor: 6, loop: { regions: [], on: true } })).toBe(4);
  });
});

describe("setSig", () => {
  it("a song in one signature: every clip is refitted and keeps its bar numbers", () => {
    const band = bandSong();
    const out = setSig(band, 0, SIG34, false);
    expect(out.meter).toEqual(SIG34);
    expect(out.sigs).toBeUndefined();
    // bars 1–8 and 9–16 are now 24 beats each
    expect(clip(out, "c1")).toMatchObject({ start: 0, len: 24, sig: SIG34 });
    expect(clip(out, "c2")).toMatchObject({ start: 24, len: 24, sig: SIG34 });
    expect(clip(out, "m1")).toMatchObject({ start: 24, len: 24, sig: SIG34 });
    // the drums clip at bars 5–8
    expect(clip(out, "d1")).toMatchObject({ start: 12, len: 12, sig: SIG34 });
    // chords that lasted a bar still do
    expect(clip<ChordsClip>(out, "c1").content.chords.map((c) => c.beats)).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    expect(clip<ChordsClip>(out, "c1").content.bars).toBe(8);
    // the rhythm fits the new bars, and still has its four
    const g = clip<DrumsClip>(out, "d1").content;
    expect(g.steps / g.div).toBe(3);
    expect(g.bars).toBe(4);
    expect(g.rows.kick).toBe("200020002000".repeat(4));
    // every note of the melody stays in its bar (the one on beat 3.5 of bar 1 would not fit a bar of three: it is where it was)
    expect(clip<MelodyClip>(out, "m1").content.notes.map((n) => n.at)).toEqual([0, 12, 30]);
    // markers, the song's end, and the bar the take was sung in keep their bar numbers too
    expect(out.markers!.map((m) => m.beat)).toEqual([0, 24]);
    expect(out.end).toBe(48);
    expect(clip(out, "a1").start).toBe(24);
    expect(track<AudioTrack>(out, "tv").takes[0].at).toBe(24);
    // recorded audio is not stretched
    expect(clip<AudioClip>(out, "a1").frames).toBe(clip<AudioClip>(band, "a1").frames);
    expect(tidySong(out)).toBe(true);
  });

  it("with changes in the song: only the stretch the bar is in, and what follows keeps its bar numbers", () => {
    const mixed = mixedSong();
    // the 6/8 stretch (bars 9–12) becomes 3/4
    const out = setSig(mixed, 9, SIG34, false);
    expect(out.meter).toBe(mixed.meter);
    expect(out.sigs).toEqual([{ bar: 8, sig: SIG34 }, { bar: 12, sig: SIG44 }]);
    expect(clip(out, "c1")).toBe(clip(mixed, "c1"));
    expect(clip(out, "d1")).toBe(clip(mixed, "d1"));
    expect(clip(out, "c2")).toMatchObject({ start: 32, len: 12, sig: SIG34 });
    expect(clip(out, "d2")).toMatchObject({ start: 32, len: 12, sig: SIG34 });
    expect(clip<DrumsClip>(out, "d2").content.steps / clip<DrumsClip>(out, "d2").content.div).toBe(3);
    // the last stretch starts four beats later and is not refitted
    expect(clip(out, "c3")).toEqual({ ...clip(mixed, "c3"), start: 44 });
    expect(clip<ChordsClip>(out, "c3").content).toBe(clip<ChordsClip>(mixed, "c3").content);
    expect(out.markers!.map((m) => m.beat)).toEqual([0, 32, 44]);
    expect(out.end).toBe(60);
  });

  it("a stretch set to the signature beside it joins it: the change is gone", () => {
    const mixed = mixedSong();
    const out = setSig(mixed, 8, SIG44, false);
    expect(out.sigs).toBeUndefined();
    expect(clip(out, "c2")).toMatchObject({ start: 32, len: 16, sig: SIG44 });
    expect(clip(out, "c3").start).toBe(48);
    expect(out.end).toBe(64);
  });

  it("from this bar on: a change is added at that bar, and the bars before it stay", () => {
    const band = bandSong();
    const out = setSig(band, 8, SIG68, true);
    expect(out.meter).toBe(band.meter);
    expect(out.sigs).toEqual([{ bar: 8, sig: SIG68 }]);
    expect(clip(out, "c1")).toBe(clip(band, "c1"));
    expect(clip(out, "d1")).toBe(clip(band, "d1"));
    expect(clip(out, "c2")).toMatchObject({ start: 32, len: 16, sig: SIG68 });
    expect(clip<ChordsClip>(out, "c2").content.chords.map((c) => c.beats)).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
    expect(clip<MelodyClip>(out, "m1").content.div).toBe(3);
    expect(out.end).toBe(48);
    // from bar 1 on is the whole first stretch
    expect(setSig(band, 0, SIG34, true)).toEqual(setSig(band, 0, SIG34, false));
    // a change inside a stretch that already has later changes ends at the next one
    const mixed = setSig(mixedSong(), 4, SIG34, true);
    expect(mixed.sigs).toEqual([{ bar: 4, sig: SIG34 }, { bar: 8, sig: SIG68 }, { bar: 12, sig: SIG44 }]);
    // (the clip of bars 1–8 starts before the change: it is not refitted, and still ends at bar 9)
    expect(clip(mixed, "c1")).toMatchObject({ start: 0, len: 28, sig: SIG44 });
    expect(clip(mixed, "c2").start).toBe(28);
  });

  it("the signature the bars already have changes nothing", () => {
    const mixed = mixedSong();
    expect(setSig(mixed, 3, SIG44, false)).toBe(mixed);
    expect(setSig(mixed, 9, SIG68, true)).toBe(mixed);
    expect(setSig(mixed, 14, { num: 4, den: 4 }, true)).toBe(mixed);
  });

  it("a clip written in another signature that starts in the stretch is fitted to it as well", () => {
    const band = bandSong();
    const foreign = layDown(band, drumsClip("x", "td", 32, 8, { sig: SIG68, bars: 1 }));
    const out = setSig(foreign, 0, SIG34, false);
    const c = clip<DrumsClip>(out, "x");
    expect(c).toMatchObject({ start: 24, len: 6, sig: SIG34 });
    expect(c.content.steps / c.content.div).toBe(3);
  });

  it("clips shorter than a bar that the shorter bars push together make way for each other", () => {
    // two clips in bar 1 of 4/4, on beats 3 and 4; in 3/4 there is no beat 4
    const out = setSig(row([2, 1], [3, 1], [4, 4]), 0, SIG34, false);
    expect(tidySong(out)).toBe(true);
    expect(spans(out, "tc")).toEqual([[2, 3], [3, 6]]);
    expect(ids(out)).toEqual(["c2", "c3"]);
  });
});

describe("setTempo", () => {
  it("sets the tempo, as a whole number from 40 to 200; note clips stay as they are", () => {
    const band = bandSong();
    const out = setTempo(band, 120);
    expect(out.bpm).toBe(120);
    for (const id of ["c1", "c2", "m1", "b1", "d1"]) expect(clip(out, id)).toBe(clip(band, id));
    expect(out.tracks).toBe(band.tracks);
    expect(setTempo(band, 96)).toBe(band);
    expect(setTempo(band, NaN)).toBe(band);
    expect(setTempo(band, 10).bpm).toBe(40);
    expect(setTempo(band, 999).bpm).toBe(200);
    expect(setTempo(band, 100.4).bpm).toBe(100);
  });

  it("a whole take stays on the beat it was sung from, and is shorter in beats at a slower tempo", () => {
    const band = bandSong();
    const out = setTempo(band, 60);
    expect(clip(out, "a1").start).toBe(32);
    expect(clipEnd(clip(out, "a1"), out)).toBeCloseTo(40, 9);
    expect(clipEnd(clip(band, "a1"), band)).toBeCloseTo(44.8, 9);
  });

  it("a split audio clip, 96 → 120 → 80 → 96: the halves share the beat their take starts on at every tempo, still touch, and the song comes back exactly", () => {
    const band = bandSong();
    const first = splitClips(band, ["a1"], 32 + 3.3, counter());
    const zero = zeroBeat(clip<AudioClip>(first, "a1"), 96, 48000);
    expect(zero).toBe(32);
    let song = first;
    for (const bpm of [120, 80, 96]) {
      song = setTempo(song, bpm);
      const left = clip<AudioClip>(song, "a1");
      const right = clip<AudioClip>(song, "n1");
      expect(zeroBeat(left, bpm, 48000)).toBe(zero);
      expect(zeroBeat(right, bpm, 48000)).toBe(zero);
      // the right half starts where the left one ends: one continuous sound
      expect(right.start).toBeCloseTo(clipEnd(left, song), 9);
      expect(right.start).toBeCloseTo(32 + framesToBeats(left.frames, 48000, bpm), 9);
      // nothing stored is trimmed
      expect(left.frames + right.frames).toBe(8 * 48000);
      expect([left.off, right.off]).toEqual([0, left.frames]);
    }
    expect(song).toEqual(first);
  });

  it("a clip trimmed at its start comes back to the same place too", () => {
    const sung = take("k1", 10, 8);
    const start = 8 + framesToBeats(96000, 48000, 96);
    const song = songOf([audioTrack("tv", "vocals", "Vocal 1", [sung])], { clips: [audioClip("a", "tv", sung, start, { off: 96000, frames: 96000 })] });
    const fast = setTempo(song, 192);
    // two seconds into the take is twice as many beats after its start at twice the tempo
    expect(clip(fast, "a").start).toBeCloseTo(8 + 2 * (start - 8), 9);
    expect(setTempo(setTempo(fast, 40), 96)).toEqual(song);
  });

  it("where a faster tempo makes one clip run into the next, both are kept whole", () => {
    const one = take("k1", 5, 0);
    const two = take("k2", 5, 8);
    const song = songOf([audioTrack("tv", "vocals", "Vocal 1", [one, two])], { bpm: 60, clips: [audioClip("a", "tv", one, 0), audioClip("b", "tv", two, 8)] });
    const fast = setTempo(song, 120);
    expect(spans(fast, "tv")).toEqual([[0, 10], [8, 18]]);
    expect(clip<AudioClip>(fast, "a").frames).toBe(5 * 48000);
    expect(setTempo(fast, 60)).toEqual(song);
  });

  it("a clip that would start before the song does has its left edge brought in to beat 0, and what is left plays where it should", () => {
    // at 60 a second is a beat. The take's first frame lies six beats before the song: the clip shows it from eight seconds in
    const sung = take("k1", 10, 0);
    const song = songOf([audioTrack("tv", "vocals", "Vocal 1", [sung])], { bpm: 60, clips: [audioClip("a", "tv", sung, 2, { off: 8 * 48000, frames: 1.5 * 48000 })] });
    expect(zeroBeat(clip<AudioClip>(song, "a"), 60, 48000)).toBe(-6);
    // at 40, eight seconds are five and a third beats: the clip would start two thirds of a beat (one second) before beat 0
    const slow = setTempo(song, 40);
    const c = clip<AudioClip>(slow, "a");
    expect(c.start).toBeCloseTo(0, 9);
    expect(c.start).toBeGreaterThanOrEqual(0);
    // so it opens one second later in the take, and ends in it where it did
    expect(c.off).toBe(9 * 48000);
    expect(c.frames).toBe(0.5 * 48000);
    expect(zeroBeat(c, 40, 48000)).toBeCloseTo(-6, 6);
    // a clip that still starts in the song is only moved
    expect(clip<AudioClip>(setTempo(song, 50), "a")).toMatchObject({ off: 8 * 48000, frames: 1.5 * 48000 });
    expect(clip<AudioClip>(setTempo(song, 50), "a").start).toBeCloseTo(-6 + 8 * (50 / 60), 9);
  });
});

describe("transpose", () => {
  const E1 = 28;
  const keyAt = (pc: number) => ({ tonic: ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][((pc % 12) + 12) % 12], scaleId: "ionian" });

  it("chords move by the semitones asked for, into the new key's spelling", () => {
    const band = bandSong();
    const out = transpose(band, 2, KEY_C, keyAt(2));
    expect(clip<ChordsClip>(out, "c1").content.chords.slice(0, 4).map((c) => `${c.ref.root}${c.ref.typeId}`)).toEqual(["Dmaj", "Gmaj", "Amaj", "Bmin"]);
    // drums and recordings do not move
    expect(clip(out, "d1")).toBe(clip(band, "d1"));
    expect(clip(out, "a1")).toBe(clip(band, "a1"));
  });

  it("melody and bass notes move by as much as the melody grid's home row does", () => {
    const band = bandSong();
    // C to D: the home row goes up two
    const up = transpose(band, 2, KEY_C, keyAt(2));
    expect(clip<MelodyClip>(up, "m1").content.notes.map((n) => n.midi)).toEqual([62, 64, 66]);
    expect(clip<MelodyClip>(up, "b1").content.notes.map((n) => n.midi)).toEqual([38, 43, 45]);
    // Ab to A: the home row wraps down an octave (68 to 57), so the notes stay on their rows of the grid
    const wrap = transpose(band, 1, keyAt(8), keyAt(9));
    expect(clip<MelodyClip>(wrap, "m1").content.notes.map((n) => n.midi)).toEqual([49, 51, 53]);
  });

  it("a bass clip on E1 moved down a semitone twelve times keeps every note", () => {
    let song = songOf([tuneTrack("tb", "bass")], { clips: [melodyClip("b", "tb", 0, 8, { content: tune(2, [[0, E1], [1, E1 + 7], [2, 24], [3, 108]]) })] });
    const first = song;
    for (let i = 0; i < 12; i++) {
      song = transpose(song, -1, keyAt(-i), keyAt(-i - 1));
      const notes = clip<MelodyClip>(song, "b").content.notes;
      expect(notes).toHaveLength(4);
      expect(notes.map((n) => n.at)).toEqual([0, 12, 24, 36]);
      for (const n of notes) {
        expect(n.midi).toBeGreaterThanOrEqual(24);
        expect(n.midi).toBeLessThanOrEqual(108);
      }
      // each is still the same note of the scale (a whole number of octaves from where it would be)
      expect(notes.map((n) => (((n.midi - (first.clips[0] as MelodyClip).content.notes[notes.indexOf(n)].midi + i + 1) % 12) + 12) % 12)).toEqual([0, 0, 0, 0]);
    }
  });

  it("up a semitone and down again gives the first song back when no note wrapped", () => {
    const band = { ...bandSong(), clips: [...bandSong().clips, chordsClip("w", "tc", 64, 4, { content: chordsContent(1, SIG44, [{ ...chord("w1", "C", 4), notes: [48, 52, 55] }]) })] };
    const up = transpose(band, 1, KEY_C, keyAt(1));
    expect(clip<ChordsClip>(up, "w").content.chords[0].notes).toEqual([49, 53, 56]);
    expect(transpose(up, -1, keyAt(1), KEY_C)).toEqual(band);
  });

  it("what is being composed moves too", () => {
    const band = setDraft(setDraft(bandSong(), "tc", chordsContent(1), SIG44), "tb", tune(1, [[0, 40]]), SIG44);
    const out = transpose(band, 2, KEY_C, keyAt(2));
    expect(track<ChordsTrack>(out, "tc").draft!.content.chords[0].ref.root).toBe("D");
    expect(track<TuneTrack>(out, "tb").draft!.content.notes[0].midi).toBe(42);
    expect(track<TuneTrack>(out, "tb").draft!.sig).toEqual(SIG44);
  });

  it("a move of nothing gives the same song", () => {
    const band = bandSong();
    expect(transpose(band, 0, KEY_C, KEY_C)).toBe(band);
  });
});

describe("songEnd", () => {
  it("the end of the last clip, up to the bar line", () => {
    expect(songEnd(songOf([]))).toBe(0);
    expect(songEnd(row([0, 6]))).toBe(8);
    expect(songEnd(row([0, 8], [16, 5]))).toBe(24);
    // a recording that ends inside a bar
    const band = { ...bandSong(), end: undefined };
    expect(songEnd(resizeClip(band, "a1", "right", 70.3))).toBe(72);
  });

  it("`end` beyond the last clip holds the song open; a clip beyond `end` makes it longer", () => {
    expect(songEnd({ ...row([0, 8]), end: 32 })).toBe(32);
    expect(songEnd({ ...row([0, 8]), end: 30 })).toBe(32);
    expect(songEnd({ ...row([0, 40]), end: 32 })).toBe(40);
    // in a song whose bars change length the bar line is the map's
    expect(songEnd({ ...mixedSong(), clips: [], end: 33 })).toBe(34);
  });
});

describe("clipsIn", () => {
  it("the clips that lie inside a stretch, whole; the stretch is snapped to bar lines first", () => {
    const band = bandSong();
    expect(clipsIn(band, 0, 32)).toEqual(["c1", "b1", "d1"]);
    expect(clipsIn(band, 1.2, 30.9)).toEqual(["c1", "b1", "d1"]);
    expect(clipsIn(band, 32, 64)).toEqual(["c2", "m1", "a1"]);
    expect(clipsIn(band, 16, 32)).toEqual(["d1"]);
    expect(clipsIn(band, 0, 64)).toEqual(["c1", "c2", "m1", "b1", "d1", "a1"]);
    expect(clipsIn(band, 20, 28)).toEqual([]);
  });
});

describe("cutTime", () => {
  it("takes a stretch out of every track and closes the gap; markers, the song's end and the takes move too", () => {
    const band = bandSong();
    // bars 5–8 go
    const out = cutTime(band, 16, 32);
    // the clips of bars 1–8 lay across the start of the stretch: they end there
    expect(clip(out, "c1")).toMatchObject({ start: 0, len: 16 });
    expect(clip(out, "b1")).toMatchObject({ start: 0, len: 16 });
    // the drums clip lay inside it
    expect(ids(out)).toEqual(["c1", "c2", "m1", "b1", "a1"]);
    // everything after moved up four bars
    expect(clip(out, "c2")).toEqual({ ...clip(band, "c2"), start: 16 });
    expect(clip(out, "m1").start).toBe(16);
    expect(clip(out, "a1")).toEqual({ ...clip(band, "a1"), start: 16 });
    expect(out.markers).toEqual([{ id: "mk1", beat: 0, name: "Verse" }, { id: "mk2", beat: 16, name: "Chorus" }]);
    expect(out.end).toBe(48);
    expect(track<AudioTrack>(out, "tv").takes[0].at).toBe(16);
    expect(tidySong(out)).toBe(true);
  });

  it("a clip that lies across the whole stretch is left as two clips that meet, each playing what it did", () => {
    const band = bandSong();
    const before = clip<ChordsClip>(band, "c1");
    const out = cutTime(band, 8, 16);
    expect(ids(out, "tc")).toEqual(["c1", "c1:2", "c2"]);
    expect(clip(out, "c1")).toMatchObject({ start: 0, len: 8, off: 0 });
    const tail = clip<ChordsClip>(out, "c1:2");
    expect(tail).toMatchObject({ start: 8, len: 16, off: 16 });
    expect(phase(tail, 8)).toBe(phase(before, 16));
    expect(spans(out, "tc")).toEqual([[0, 8], [8, 24], [24, 56]]);
  });

  it("a clip that lies across the end of the stretch starts at the cut", () => {
    const band = bandSong();
    const out = cutTime(band, 12, 20);
    // the drums clip of bars 5–8: its first bar is gone
    expect(clip<DrumsClip>(out, "d1")).toMatchObject({ start: 12, len: 12, off: 4 });
  });

  it("a marker inside the stretch goes with it; the stretch is snapped to bar lines first", () => {
    const band = { ...bandSong(), markers: [{ id: "a", beat: 0, name: "A" }, { id: "b", beat: 16, name: "B" }, { id: "c", beat: 20, name: "C" }, { id: "d", beat: 32, name: "D" }] };
    const out = cutTime(band, 15.4, 31.8);
    expect(out.markers).toEqual([{ id: "a", beat: 0, name: "A" }, { id: "d", beat: 16, name: "D" }]);
    expect(out).toEqual(cutTime(band, 16, 32));
    expect(cutTime(band, 32, 16)).toEqual(out);
  });

  it("the bars after the stretch keep their signatures", () => {
    const mixed = mixedSong();
    // the four bars of 6/8 go: the song is 4/4 throughout
    const gone = cutTime(mixed, 32, 40);
    expect(gone.sigs).toBeUndefined();
    expect(gone.meter).toBe(mixed.meter);
    expect(clip(gone, "c3").start).toBe(32);
    expect(gone.end).toBe(48);
    expect(gone.markers!.map((m) => m.name)).toEqual(["A", "A"]);
    // bars 7–10 go (two of 4/4, two of 6/8): the 6/8 now starts at bar 7 and 4/4 comes back at bar 9
    const part = cutTime(mixed, 24, 36);
    expect(part.sigs).toEqual([{ bar: 6, sig: SIG68 }, { bar: 8, sig: SIG44 }]);
    expect(clip(part, "c2")).toMatchObject({ start: 24, len: 4 });
    expect(clip(part, "c3").start).toBe(28);
    // the first eight bars go: the song starts in 6/8
    const head = cutTime(mixed, 0, 32);
    expect(head.meter).toEqual(SIG68);
    expect(head.sigs).toEqual([{ bar: 4, sig: SIG44 }]);
    expect(clip(head, "c2").start).toBe(0);
  });

  it("an audio clip across the cut is cut to the frame, and what is left plays what it did", () => {
    const band = bandSong();
    // bar 10 goes (beats 36 to 40): 2.5 seconds of the take
    const out = cutTime(band, 36, 40);
    const left = clip<AudioClip>(out, "a1");
    const right = clip<AudioClip>(out, "a1:2");
    expect(left).toMatchObject({ start: 32, off: 0, frames: 120000 });
    expect(right).toMatchObject({ start: 36, off: 240000, frames: 384000 - 240000 });
    expect(tidySong(out)).toBe(true);
  });

  it("a stretch of no length changes nothing", () => {
    const band = bandSong();
    expect(cutTime(band, 16, 16)).toBe(band);
    expect(cutTime(band, 16, 17)).toBe(band);
  });
});

describe("insertTime", () => {
  it("pushes everything from a bar line later, on every track; markers, the song's end and the takes move too", () => {
    const band = bandSong();
    const out = insertTime(band, 32, 4);
    for (const id of ["c1", "b1", "d1"]) expect(clip(out, id)).toBe(clip(band, id));
    expect(clip(out, "c2")).toEqual({ ...clip(band, "c2"), start: 36 });
    expect(clip(out, "m1").start).toBe(36);
    expect(clip(out, "a1").start).toBe(36);
    expect(out.markers!.map((m) => m.beat)).toEqual([0, 36]);
    expect(out.end).toBe(68);
    expect(track<AudioTrack>(out, "tv").takes[0].at).toBe(36);
    expect(ids(out)).toEqual(ids(band));
  });

  it("a clip that lies across the line is split there", () => {
    const band = bandSong();
    const before = clip<DrumsClip>(band, "d1");
    const out = insertTime(band, 24, 8);
    expect(ids(out, "td")).toEqual(["d1", "d1:2"]);
    expect(clip(out, "d1")).toMatchObject({ start: 16, len: 8, off: 0 });
    const tail = clip<DrumsClip>(out, "d1:2");
    expect(tail).toMatchObject({ start: 32, len: 8, off: 8 });
    expect(phase(tail, 32)).toBe(phase(before, 24));
    expect(spans(out, "tc")).toEqual([[0, 24], [32, 40], [40, 72]]);
    expect(tidySong(out)).toBe(true);
  });

  it("the place and the length are snapped to whole bars of the signature there, at least one", () => {
    const band = bandSong();
    expect(insertTime(band, 31.2, 3.4)).toEqual(insertTime(band, 32, 4));
    expect(insertTime(band, 32, 0.5)).toEqual(insertTime(band, 32, 4));
    expect(insertTime(band, 32, 9)).toEqual(insertTime(band, 32, 8));
    expect(insertTime(band, 32, 0)).toBe(band);
    expect(insertTime(band, 32, -4)).toBe(band);
  });

  it("later signature changes move with their bars, and the new bars have the signature of the bar they are put before", () => {
    const mixed = mixedSong();
    // two bars before bar 5 (4/4)
    const early = insertTime(mixed, 16, 8);
    expect(early.sigs).toEqual([{ bar: 10, sig: SIG68 }, { bar: 14, sig: SIG44 }]);
    expect(clip(early, "c2").start).toBe(40);
    expect(early.end).toBe(64);
    // one bar at the first 6/8 bar: it is a 6/8 bar, two beats long
    const at = insertTime(mixed, 32, 2);
    expect(at.sigs).toEqual([{ bar: 8, sig: SIG68 }, { bar: 13, sig: SIG44 }]);
    expect(clip(at, "c2").start).toBe(34);
    expect(clip(at, "c3").start).toBe(42);
    expect(at.markers!.map((m) => m.beat)).toEqual([0, 34, 42]);
  });

  it("bars put in at the very end make the song that much longer; beyond the end there is nothing to push", () => {
    const song = row([0, 16]);
    expect(insertTime(song, 16, 4).end).toBe(20);
    expect(songEnd(insertTime(song, 16, 4))).toBe(20);
    expect(insertTime(song, 40, 4)).toBe(song);
    const band = bandSong();
    expect(insertTime(band, 64, 4).end).toBe(68);
  });
});

describe("copyOut, pasteIn", () => {
  it("a copy holds separate copies of the clips with starts counted from the first one, their tracks with their sound, and the takes they play", () => {
    const band = setDraft(bandSong(), "tm", tune(1), SIG44);
    const c = copyOut(band, ["m1", "d1", "a1"], KEY_B);
    expect(c.key).toEqual(KEY_B);
    expect(c.clips.map((x) => [x.id, x.start])).toEqual([["m1", 16], ["d1", 0], ["a1", 16]]);
    expect(c.clips[0]).toEqual({ ...clip(band, "m1"), start: 16 });
    expect((c.clips[0] as MelodyClip).content).not.toBe(clip<MelodyClip>(band, "m1").content);
    expect(c.tracks.map((t) => t.id)).toEqual(["tm", "td", "tv"]);
    // the sound travels; what is being composed, the lead and the takes list do not
    expect(c.tracks[0]).toEqual({ id: "tm", kind: "melody", name: "Melody", tone: GUITAR, sound: SOUND_DEFAULT });
    expect(c.tracks[1]).toEqual({ id: "td", kind: "drums", name: "Drums", kit: PLAIN_KIT });
    expect((c.tracks[2] as AudioTrack).takes).toEqual([]);
    expect(c.takes).toEqual(track<AudioTrack>(band, "tv").takes);
    expect(c.takes[0]).not.toBe(track<AudioTrack>(band, "tv").takes[0]);
    expect(copyOut(band, [], KEY_C)).toEqual({ key: KEY_C, clips: [], tracks: [], takes: [] });
    // it can be stored and read back as it is
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });

  it("how long a clipboard is", () => {
    const band = bandSong();
    expect(clipboardBeats(copyOut(band, ["c1", "d1"], KEY_C), 96)).toBe(32);
    expect(clipboardBeats(copyOut(band, ["d1"], KEY_C), 96)).toBe(16);
    expect(clipboardBeats(copyOut(band, ["a1"], KEY_C), 96)).toBeCloseTo(12.8, 9);
    expect(clipboardBeats(copyOut(band, ["a1"], KEY_C), 60)).toBeCloseTo(8, 9);
    expect(clipboardBeats(copyOut(band, [], KEY_C), 96)).toBe(0);
  });

  it("one clip goes onto the track asked for when that takes it, else onto the first that does", () => {
    const band = bandSong();
    const c = copyOut(band, ["m1"], KEY_C);
    const onBass = pasteIn(band, c, 64, KEY_C, "tb", counter());
    expect(clip(onBass, "n1")).toMatchObject({ track: "tb", start: 64, len: 32, kind: "melody" });
    expect(clip<MelodyClip>(onBass, "n1").content).toEqual(clip<MelodyClip>(band, "m1").content);
    expect(clip<MelodyClip>(onBass, "n1").content).not.toBe(c.clips[0]);
    expect(onBass.tracks).toBe(band.tracks);
    // the chords track does not take a melody: the first track that does
    expect(clip(pasteIn(band, c, 64, KEY_C, "tc", counter()), "n1").track).toBe("tm");
    expect(clip(pasteIn(band, c, 64, KEY_C, null, counter()), "n1").track).toBe("tm");
    // the original is untouched, and the same clipboard pastes again
    expect(clip(onBass, "m1")).toBe(clip(band, "m1"));
    const id = counter();
    const twice = pasteIn(pasteIn(band, c, 64, KEY_C, null, id), c, 96, KEY_C, null, id);
    expect(spans(twice, "tm")).toEqual([[32, 64], [64, 96], [96, 128]]);
  });

  it("a paste trims what it covers", () => {
    const band = bandSong();
    const out = pasteIn(band, copyOut(band, ["d1"], KEY_C), 8, KEY_C, null, counter());
    expect(spans(out, "td")).toEqual([[8, 24], [24, 32]]);
    expect(clip<DrumsClip>(out, "d1")).toMatchObject({ start: 24, len: 8, off: 8 });
  });

  it("into a song with no track of that kind: the track is made, with the copied sound", () => {
    const tone = { inst: "piano" as const, keys: "electric" as const, pedal: true };
    const sound = { ...SOUND_DEFAULT, echo: 0.5 };
    const band = setTrack<ChordsTrack>(bandSong(), "tc", { tone, sound, color: 5, name: "Keys" });
    const c = copyOut(band, ["c1"], KEY_C);
    const other = songOf([drumsTrack("x1", "Drums", { lead: true })]);
    const out = pasteIn(other, c, 0, KEY_C, null, counter());
    expect(out.tracks.map((t) => t.kind)).toEqual(["drums", "chords"]);
    const made = out.tracks[1] as ChordsTrack;
    // (the first chords track of this idea leads)
    expect(made).toEqual({ id: "tc", kind: "chords", name: "Keys", tone, sound, color: 5, lead: true });
    expect(made.tone).not.toBe(c.tracks[0]);
    expect(out.clips).toHaveLength(1);
    expect(out.clips[0]).toMatchObject({ track: "tc", start: 0, len: 32, kind: "chords" });
    expect((out.clips[0] as ChordsClip).content).toEqual(clip<ChordsClip>(band, "c1").content);
    // the same holds for a kit
    const kit = { ...PLAIN_KIT, level: 0.33 };
    const drums = copyOut(setTrack<DrumsTrack>(bandSong(), "td", { kit }), ["d1"], KEY_C);
    const made2 = pasteIn(songOf([]), drums, 0, KEY_C, null, counter());
    expect((made2.tracks[0] as DrumsTrack).kit).toEqual(kit);
    expect((made2.tracks[0] as DrumsTrack).lead).toBe(true);
  });

  it("several clips each go to the track they were copied from: by its id, then by its kind and name, else a track is made", () => {
    const band = bandSong();
    const c = copyOut(band, ["c1", "b1", "d1"], KEY_C);
    // the same idea: by id, whatever track is asked for
    const here = pasteIn(band, c, 64, KEY_C, "tm", counter());
    expect(here.tracks).toBe(band.tracks);
    expect(here.clips.slice(-3).map((x) => [x.track, x.start])).toEqual([["tc", 64], ["tb", 64], ["td", 80]]);
    // another idea: its Chords track is found by kind and name, a Bass and a Drums track are made
    const other = songOf([chordsTrack("o1", "Chords", { lead: true }), tuneTrack("o2", "melody", "Lead")]);
    const there = pasteIn(other, c, 0, KEY_C, null, counter());
    expect(there.tracks.map((t) => [t.id, t.kind, t.name])).toEqual([["o1", "chords", "Chords"], ["o2", "melody", "Lead"], ["tb", "bass", "Bass"], ["td", "drums", "Drums"]]);
    expect(there.clips.map((x) => [x.track, x.start])).toEqual([["o1", 0], ["tb", 0], ["td", 16]]);
    expect(new Set(there.clips.map((x) => x.id)).size).toBe(3);
    // a second paste finds the tracks it made
    expect(pasteIn(there, c, 64, KEY_C, null, counter("m")).tracks).toBe(there.tracks);
  });

  it("a paste moves chords and notes into this idea's key; drums stay", () => {
    const band = bandSong();
    const c = copyOut(band, ["c1", "m1", "d1"], KEY_C);
    const inD = { tonic: "D", scaleId: "ionian" };
    const out = pasteIn(songOf([]), c, 0, inD, null, counter());
    const chords = out.clips.find((x) => x.kind === "chords") as ChordsClip;
    const melody = out.clips.find((x) => x.kind === "melody") as MelodyClip;
    expect(chords.content.chords.slice(0, 4).map((x) => x.ref.root)).toEqual(["D", "G", "A", "B"]);
    expect(melody.content.notes.map((n) => n.midi)).toEqual([62, 64, 66]);
    expect((out.clips.find((x) => x.kind === "drums") as DrumsClip).content).toEqual(clip<DrumsClip>(band, "d1").content);
    // the clipboard itself is not changed by a paste
    expect((c.clips[0] as ChordsClip).content.chords[0].ref.root).toBe("C");
  });

  it("audio clips bring their takes' records: the files are shared", () => {
    const band = bandSong();
    const c = copyOut(band, ["a1"], KEY_C);
    const other = songOf([], { bpm: 120 });
    const out = pasteIn(other, c, 8.25, KEY_C, null, counter());
    const made = out.tracks[0] as AudioTrack;
    expect(made).toMatchObject({ id: "tv", kind: "vocals", name: "Vocal 1", fx: FX_DEFAULT });
    expect(made.takes).toEqual([{ ...c.takes[0], at: 8.25 }]);
    expect(made.takes[0].dry).toBe("k1-dry.wav");
    expect(clip<AudioClip>(out, "n1")).toMatchObject({ track: "tv", take: "k1", start: 8.25, frames: 8 * 48000 });
    // pasted again on the same track, the record is not added twice
    const again = pasteIn(out, c, 40, KEY_C, "tv", counter("m"));
    expect(track<AudioTrack>(again, "tv").takes).toHaveLength(1);
    expect(ids(again, "tv")).toEqual(["n1", "m1"]);
    // onto a blank audio track of the idea
    const blank = pasteIn(addTrack(bandSong(), "audio", "tx"), c, 0, KEY_C, "tx", counter());
    expect(clip(blank, "n1").track).toBe("tx");
    expect(track<AudioTrack>(blank, "tx").takes.map((k) => k.id)).toEqual(["k1"]);
  });

  it("a note clip lands on a whole beat and a drums clip on the bar line at or before", () => {
    const band = bandSong();
    expect(clip(pasteIn(band, copyOut(band, ["m1"], KEY_C), 70.6, KEY_C, null, counter()), "n1").start).toBe(71);
    expect(clip(pasteIn(band, copyOut(band, ["d1"], KEY_C), 70.6, KEY_C, null, counter()), "n1").start).toBe(68);
    // together they keep their spacing
    const both = pasteIn(band, copyOut(band, ["m1", "d1"], KEY_C), 70.6, KEY_C, null, counter());
    expect(both.clips.slice(-2).map((x) => x.start)).toEqual([84, 68]);
  });

  it("a clipboard that lost its copy of the track still pastes: a plain track of the clip's kind is made", () => {
    const band = bandSong();
    const bare: Clipboard5 = { ...copyOut(band, ["m1"], KEY_C), tracks: [] };
    const out = pasteIn(songOf([]), bare, 0, KEY_C, null, counter());
    expect(out.tracks).toEqual([{ id: "n1", kind: "melody", name: "Melody", tone: GUITAR, sound: SOUND_DEFAULT }]);
    expect(out.clips[0]).toMatchObject({ id: "n2", track: "n1", start: 0 });
  });

  it("an empty clipboard pastes nothing", () => {
    const band = bandSong();
    const none: Clipboard5 = { key: KEY_C, clips: [], tracks: [], takes: [] };
    expect(pasteIn(band, none, 0, KEY_C, null, counter())).toBe(band);
  });

  it("a harmony clip that played instead of a track keeps doing so where that track is, and not where it is not", () => {
    const song = songOf([chordsTrack("a", "Chords", { lead: true }), chordsTrack("h", "Harmony")], { clips: [chordsClip("c1", "a", 0, 16), chordsClip("h1", "h", 0, 16, { instead: "a" })] });
    const c = copyOut(song, ["h1"], KEY_C);
    expect(clip<ChordsClip>(pasteIn(song, c, 16, KEY_C, "h", counter()), "n1").instead).toBe("a");
    const other = songOf([chordsTrack("z", "Chords", { lead: true })]);
    expect(clip<ChordsClip>(pasteIn(other, c, 16, KEY_C, null, counter()), "n1").instead).toBeUndefined();
  });
});

describe("the rules every edit keeps", () => {
  /** numbers that look random and are the same on every run */
  const dice = (seed: number) => {
    let x = seed;
    return (n: number) => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return Math.floor((x / 4294967296) * n);
    };
  };
  const SIGS: TimeSig[] = [SIG44, SIG34, SIG68, { num: 5, den: 4 }, { num: 12, den: 8 }];

  it("600 edits chosen by dice, on a 4/4 song: after every one the song is still in order", () => {
    // (seeds 5 and 6 never change the tempo: there, recordings must not overlap either)
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const steady = seed > 4;
      const roll = dice(seed);
      const id = counter(`r${seed}-`);
      let song = bandSong();
      const takes = new Set(["k1"]);
      let changes = 0;
      for (let step = 0; step < 100; step++) {
        const all = song.clips.map((c) => c.id);
        const some = () => all.filter(() => roll(3) === 0).slice(0, 3);
        const one = () => all[roll(Math.max(1, all.length))] ?? "none";
        const tr = () => song.tracks[roll(song.tracks.length)].id;
        const beat = () => roll(96) + (roll(4) === 0 ? roll(100) / 100 : 0);
        const bar = () => roll(24) * 4;
        const before = song;
        const was = JSON.stringify(song);
        switch (roll(16)) {
          case 0: song = moveClips(song, some(), (roll(9) - 4) * 4, roll(3) === 0 ? tr() : undefined); break;
          case 1: song = moveClips(song, some(), roll(17) - 8 + roll(10) / 10); break;
          case 2: song = copyClips(song, some(), (roll(9) - 4) * 4, roll(3) === 0 ? tr() : undefined, id); break;
          case 3: song = duplicateClips(song, some(), id); break;
          case 4: song = resizeClip(song, one(), roll(2) ? "left" : "right", beat()); break;
          case 5: song = resizeClip(song, one(), roll(2) ? "left" : "right", bar()); break;
          case 6: song = splitClips(song, some(), beat(), id); break;
          case 7: song = deleteClips(song, roll(4) === 0 ? some() : []); break;
          case 8: song = insertTime(song, bar(), (1 + roll(3)) * 4); break;
          case 9: { const at = bar(); song = cutTime(song, at, at + (1 + roll(2)) * 4); break; }
          case 10: song = pasteIn(song, copyOut(song, some(), KEY_C), beat(), KEY_C, roll(2) ? tr() : null, id); break;
          case 11: song = steady ? song : setTempo(song, 60 + roll(100)); break;
          case 12: song = layDown(song, chordsClip(id(), "tc", roll(90), 1 + roll(12))); break;
          case 13: song = layDown(song, drumsClip(id(), "td", bar(), (1 + roll(6)) * 4, { bars: 1 + roll(3) })); break;
          case 14: {
            // a stretch of the take, from anywhere in it, put down anywhere
            const sung = (song.tracks.find((x) => x.id === "tv") as AudioTrack).takes[0];
            song = layDown(song, audioClip(id(), "tv", sung, beat(), { off: roll(sung.frames), frames: 2000 + roll(2 * sung.frames) }));
            break;
          }
          default: song = placeDraft(setDraft(song, "tm", tune(1 + roll(3), [[0, 60]]), SIG44), "tm", beat(), id); break;
        }
        const say = `seed ${seed}, step ${step}`;
        // an edit never changes the song it was given; it gives a new one
        expect(JSON.stringify(before) === was, say).toBe(true);
        if (song !== before) changes++;
        expect(new Set(song.clips.map((c) => c.id)).size, say).toBe(song.clips.length);
        const map = barMap(song);
        for (const c of song.clips) {
          const t = song.tracks.find((x) => x.id === c.track);
          expect(t && accepts(t.kind, c.kind), `${say}: ${c.id} on ${c.track}`).toBe(true);
          expect(c.start, say).toBeGreaterThanOrEqual(0);
          if (c.kind === "audio") {
            expect(Number.isInteger(c.frames) && c.frames >= 1 && Number.isInteger(c.off) && c.off >= 0 && c.off < c.to - c.from, `${say}: ${c.id}`).toBe(true);
            expect((t as AudioTrack).takes.some((k) => k.id === c.take), `${say}: ${c.id} has its take`).toBe(true);
          } else {
            expect(Number.isInteger(c.start) && Number.isInteger(c.len) && Number.isInteger(c.off), `${say}: ${c.id} on whole beats`).toBe(true);
            expect(c.len >= 1 && c.off >= 0 && c.off < contentBeats(c), `${say}: ${c.id}`).toBe(true);
            if (c.kind === "drums") expect(onBarLine(map, c.start) && onBarLine(map, c.start + c.len), `${say}: ${c.id} on bar lines`).toBe(true);
          }
        }
        // note clips never overlap; recorded clips only after a tempo change (nothing stored is cut then), and else by less than a frame
        expect(tidySong({ ...song, clips: song.clips.filter((c) => c.kind !== "audio") }), say).toBe(true);
        if (steady) expect(spans(song, "tv").every((x, i, list) => i === 0 || list[i - 1][1] <= x[0] + framesToBeats(1, 48000, 96)), say).toBe(true);
        // no take ever leaves its track
        for (const k of takes) expect((song.tracks.find((x) => x.id === "tv") as AudioTrack).takes.some((x) => x.id === k), say).toBe(true);
      }
      // (most of the dice's edits did something)
      expect(changes).toBeGreaterThan(50);
      expect(song.clips.length).toBeGreaterThan(3);
      if (steady) expect(song.clips.filter((c) => c.kind === "audio").length).toBeGreaterThan(2);
    }
  });

  it("the same, with the bars changing length on the way: note clips stay on whole beats, in order, on tracks of their kind", () => {
    for (const seed of [11, 12, 13]) {
      const roll = dice(seed);
      const id = counter(`s${seed}-`);
      let song = mixedSong();
      let changes = 0;
      for (let step = 0; step < 80; step++) {
        const before = song;
        const all = song.clips.map((c) => c.id);
        const some = () => all.filter(() => roll(3) === 0).slice(0, 3);
        const one = () => all[roll(Math.max(1, all.length))] ?? "none";
        const map = barMap(song);
        const line = () => map.beatOfBar(roll(24));
        switch (roll(10)) {
          case 0: song = setSig(song, roll(20), SIGS[roll(SIGS.length)], roll(2) === 0); break;
          case 1: song = moveClips(song, some(), line() - line()); break;
          case 2: song = resizeClip(song, one(), roll(2) ? "left" : "right", line()); break;
          case 3: song = splitClips(song, some(), line(), id); break;
          case 4: song = insertTime(song, line(), 1 + roll(8)); break;
          case 5: { const bar = roll(24); song = cutTime(song, map.beatOfBar(bar), map.beatOfBar(bar + 1 + roll(2))); break; }
          case 7: { const at = line(); song = layDown(song, chordsClip(id(), "tc", at + roll(3), 1 + roll(12), { sig: map.sigAt(at) })); break; }
          case 8: { const bar = roll(24); const sig = map.sigAt(map.beatOfBar(bar)); song = layDown(song, drumsClip(id(), "td", map.beatOfBar(bar), sigBeats(sig) * (1 + roll(4)), { sig, bars: 1 + roll(2) })); break; }
          case 6: song = duplicateClips(song, some(), id); break;
          default: song = pasteIn(song, copyOut(song, some(), KEY_C), line(), KEY_C, null, id); break;
        }
        const say = `seed ${seed}, step ${step}`;
        expect(new Set(song.clips.map((c) => c.id)).size, say).toBe(song.clips.length);
        for (const c of song.clips as NoteClip[]) {
          expect(Number.isInteger(c.start) && Number.isInteger(c.len) && Number.isInteger(c.off) && c.start >= 0 && c.len >= 1, `${say}: ${c.id}`).toBe(true);
          expect(c.off >= 0 && c.off < contentBeats(c), `${say}: ${c.id}`).toBe(true);
          if (c.kind === "drums") expect(c.content.steps / c.content.div, `${say}: ${c.id} fits its bars`).toBe(sigBeats(c.sig));
        }
        expect(tidySong(song), say).toBe(true);
        // the changes of signature stay in order, each on a later bar than the last, none saying what already holds
        const sigs = song.sigs ?? [];
        sigs.forEach((x, i) => {
          expect(x.bar, say).toBeGreaterThan(i ? sigs[i - 1].bar : 0);
          expect(x.sig, say).not.toEqual(i ? sigs[i - 1].sig : song.meter);
        });
        if (song !== before) changes++;
      }
      expect(changes).toBeGreaterThan(40);
    }
  });

  it("after a run of edits no two clips of a track overlap, and every clip lies on a track that takes it", () => {
    const id = counter("z");
    let song = bandSong();
    song = copyClips(song, ["c1", "b1"], 16, undefined, id);
    song = duplicateClips(song, ["d1", "m1"], id);
    song = resizeClip(song, "d1", "right", 48);
    song = splitClips(song, ["c2", "m1", "a1"], 40, id);
    song = moveClips(song, ["m1"], -20);
    song = insertTime(song, 24, 8);
    song = cutTime(song, 8, 16);
    song = pasteIn(song, copyOut(song, ids(song).slice(0, 5), KEY_C), 12, KEY_C, null, id);
    expect(tidySong(song)).toBe(true);
    song = setSig(song, 2, SIG34, true);
    // (recorded audio is not stretched, so shorter bars may bring two recordings over each other, as a faster tempo may)
    expect(tidySong({ ...song, clips: song.clips.filter((c) => c.kind !== "audio") })).toBe(true);
    expect(new Set(ids(song)).size).toBe(song.clips.length);
    for (const c of song.clips) {
      const t = song.tracks.find((x) => x.id === c.track)!;
      expect(t).toBeDefined();
      expect(c.start).toBeGreaterThanOrEqual(0);
      if (c.kind !== "audio") {
        expect(Number.isInteger(c.start) && Number.isInteger(c.len) && Number.isInteger(c.off)).toBe(true);
        expect(c.len).toBeGreaterThan(0);
        expect(c.off).toBeLessThan(contentBeats(c));
      }
    }
    // no take was lost on the way
    expect(track<AudioTrack>(song, "tv").takes.map((k) => k.id)).toEqual(["k1"]);
  });
});
