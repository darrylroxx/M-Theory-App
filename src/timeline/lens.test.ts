// The lens: a clip shown to the old pages as a one-section old song, and what they change written back.
import { describe, expect, it } from "vitest";
import { BEAT_LIBRARY, applyPattern, kitOfBeat, kitSig, type Beat } from "../audio/beats";
import { chordsUnder, harmonyState, rewriteHarmony, writeHarmony } from "../song/harmony";
import { EMPTY_MELODY, toggleNote } from "../song/melody";
import { sigBeats } from "../song/meter";
import { selectBlock } from "../song/structure";
import { allTracks, normalize, writeTarget } from "../song/tracks";
import type { Progression } from "../ui/state";
import { fixture } from "./fixtures5";
import { chordsUnderSpan, harmonyState5, lensOf, unlens, type Target } from "./lens";
import { toTimeline } from "./migrate5";
import type { ChordsClip, ChordsTrack, DrumsClip, DrumsTrack, MelodyClip, TimelineSong, TuneTrack } from "./model";
import { KEY_C, SIG34, SIG68, bandSong, chord, chordsClip, chordsContent, chordsTrack, counter, drumsClip, drumsTrack, melodyClip, songOf, tune, tuneTrack } from "./testsongs";

const clipOf = <C,>(s: TimelineSong, id: string) => s.clips.find((c) => c.id === id) as unknown as C;
const trackOf = <T,>(s: TimelineSong, id: string) => s.tracks.find((t) => t.id === id) as unknown as T;
/** The lens of a target, and a way to write a change of its song back. */
function open(song: TimelineSong, target: Target) {
  const lens = lensOf(song, target, KEY_C, 0)!;
  expect(lens).not.toBeNull();
  const back = (fn: (p: Progression) => Progression) => unlens(song, target, lens, fn(lens.p), counter("new"));
  return { lens, back };
}
/** everything of the song but the clips and tracks named */
const rest = (s: TimelineSong, clips: string[], tracks: string[]) => ({ ...s, clips: s.clips.filter((c) => !clips.includes(c.id)), tracks: s.tracks.filter((t) => !tracks.includes(t.id)) });

/** bandSong with a second chords track (a pad over bars 1–8) and a second drums track */
function band(): TimelineSong {
  const s = bandSong();
  return { ...s, tracks: [...s.tracks, chordsTrack("tp", "Pad"), drumsTrack("td2", "Drums 2")], clips: [...s.clips, chordsClip("p1", "tp", 0, 32), drumsClip("e1", "td2", 0, 16)] };
}

describe("what the lens shows", () => {
  it("a clip of the lead chords track is the old first chords track; the lens song has no sections and is in the clip's bars", () => {
    const s = band();
    const { lens } = open(s, { track: "tc", clip: "c1" });
    expect(lens.lead).toBe("tc");
    expect(lens.span).toEqual({ from: 0, to: 32 });
    expect(lens.p.song ?? null).toBeNull();
    expect(lens.p.bars).toBe(8);
    expect(lens.p.meter).toEqual({ num: 4, den: 4 });
    expect(lens.p.chords).toBe(clipOf<ChordsClip>(s, "c1").content.chords);
    expect(lens.p.focus?.chords ?? "chords").toBe("chords");
    // every other chords, melody and bass track is there as an added track; the vocal track is left out
    // the top melody track is the old first melody track; every other chords, melody and bass track is an added track; the vocal track is left out
    expect(lens.melody).toBe("tm");
    expect(allTracks(lens.p).map((t) => `${t.id}:${t.kind}`)).toEqual(["chords:chords", "melody:melody", "drums:drums", "tb:melody", "tp:chords"]);
    // the bass has music under these bars, the melody has none
    const q = normalize(lens.p);
    expect(q.layers?.tb?.melody?.notes.length).toBe(3);
    expect(q.melody).toBeUndefined();
    expect(q.layers?.tp?.chords?.length).toBe(8);
  });
  it("another track's clip is an added track brought forward, and the old first chords track is the lead chords under it", () => {
    const s = band();
    const bass = open(s, { track: "tb", clip: "b1" }).lens;
    expect(bass.p.focus).toEqual({ melody: "tb" });
    expect(bass.p.melody?.notes).toEqual(clipOf<MelodyClip>(s, "b1").content.notes);
    expect(open(s, { track: "tp", clip: "p1" }).lens.p.focus).toEqual({ chords: "tp" });
    expect(open(s, { track: "td2", clip: "e1" }).lens.p.focus).toEqual({ drums: "td2" });
    // the top melody track is the old first melody track: in front already
    const { lens } = open(s, { track: "tm", clip: "m1" });
    expect(lens.lead).toBe("tc");
    expect(lens.span).toEqual({ from: 32, to: 64 });
    expect(lens.p.focus).toBeUndefined();
    expect(lens.p.melody?.notes).toEqual(clipOf<MelodyClip>(s, "m1").content.notes);
    // the chord names over the melody grid: what the old code reads as "the song's chords"
    expect(chordsUnder(lens.p).map((c) => c.id)).toEqual(clipOf<ChordsClip>(s, "c2").content.chords.map((c) => c.id));
    expect(chordsUnder(lens.p)).toEqual(chordsUnderSpan(s, lens.span));
  });
  it("the span is one round of the content: the first that starts inside the clip, else the one its left edge lies in", () => {
    const s = songOf([chordsTrack("tc", "Chords", { lead: true }), drumsTrack("td", "Drums", { lead: true })], {
      clips: [drumsClip("d1", "td", 8, 40, { off: 8 }), drumsClip("d2", "td", 64, 8, { off: 4 })],
    });
    // a 16-beat rhythm opened 8 beats in: its next round starts at beat 16
    expect(open(s, { track: "td", clip: "d1" }).lens.span).toEqual({ from: 16, to: 32 });
    // a clip shorter than what is left of the round: the round its left edge lies in
    expect(open(s, { track: "td", clip: "d2" }).lens.span).toEqual({ from: 60, to: 76 });
  });
  it("under a stretch the lead chords do not fill, the chords are cut to it, with rests where there are none", () => {
    const s = songOf([chordsTrack("tc", "Chords", { lead: true }), tuneTrack("tm")], {
      clips: [chordsClip("c1", "tc", 0, 6, { content: chordsContent(2, undefined, [chord("x", "C", 4), chord("y", "F", 4)]) }), chordsClip("c2", "tc", 12, 4), melodyClip("m1", "tm", 0, 16)],
    });
    const under = chordsUnderSpan(s, { from: 0, to: 16 });
    expect(under.map((c) => [c.rest ? "rest" : c.ref.root, c.beats])).toEqual([["C", 4], ["F", 2], ["rest", 6], ["C", 4]]);
    expect(chordsUnder(open(s, { track: "tm", clip: "m1" }).lens.p)).toEqual(under);
  });
  it("a missing clip, a missing track and a recorded track have no lens", () => {
    const s = band();
    expect(lensOf(s, { track: "tc", clip: "nope" }, KEY_C, 0)).toBeNull();
    expect(lensOf(s, { track: "nope", clip: "c1" }, KEY_C, 0)).toBeNull();
    expect(lensOf(s, { track: "tm", clip: "c1" }, KEY_C, 0)).toBeNull();
    expect(lensOf(s, { track: "tv", clip: "a1" }, KEY_C, 0)).toBeNull();
  });
  it("the same lens comes back while nothing it read has changed: an unrelated track, or a clip elsewhere, changes nothing", () => {
    const s = band();
    const t: Target = { track: "tc", clip: "c1" };
    const a = lensOf(s, t, KEY_C, 0);
    expect(lensOf(s, t, KEY_C, 0)).toBe(a);
    // the vocal track renamed, the second drums' kit changed, a clip after the stretch moved
    const other: TimelineSong = { ...s, tracks: s.tracks.map((x) => (x.id === "tv" ? { ...x, name: "Lead vocal" } : x.id === "td2" ? { ...x, kit: { ...(x as DrumsTrack).kit, space: 0.9 } } : x)), clips: s.clips.map((c) => (c.id === "m1" ? { ...c, start: 40 } : c)) };
    expect(lensOf(other, t, KEY_C, 0)).toBe(a);
    // the clip itself changed: another lens
    const edited: TimelineSong = { ...s, clips: s.clips.map((c) => (c.id === "c1" ? { ...c, len: 16 } : c)) };
    expect(lensOf(edited, t, KEY_C, 0)).not.toBe(a);
    // a track it reads changed (the bass's sound): another lens
    const knob: TimelineSong = { ...s, tracks: s.tracks.map((x) => (x.id === "tb" ? { ...x, sound: { space: 0.7 } } : x)) };
    expect(lensOf(knob, t, KEY_C, 0)).not.toBe(lensOf(s, t, KEY_C, 0));
  });
});

describe("writing back", () => {
  it("nothing changed inside: the same song comes back, for every kind of track", () => {
    const s = band();
    for (const t of [{ track: "tc", clip: "c1" }, { track: "tc", clip: "c2" }, { track: "tp", clip: "p1" }, { track: "tm", clip: "m1" }, { track: "tb", clip: "b1" }, { track: "td", clip: "d1" }, { track: "td2", clip: "e1" }]) {
      const { back } = open(s, t);
      expect(back((p) => p), t.clip).toBe(s);
      // (also when the old code hands back a copy)
      expect(back((p) => ({ ...p })), t.clip).toBe(s);
    }
  });
  it("a chord added and a slot removed land in the open clip and nowhere else", () => {
    const s = band();
    const added = open(s, { track: "tc", clip: "c1" }).back((p) => ({ ...p, chords: [...p.chords, chord("new", "D", 4, "min")] }));
    expect(clipOf<ChordsClip>(added, "c1").content.chords.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "new"]);
    expect(rest(added, ["c1"], [])).toEqual(rest(s, ["c1"], []));
    // on a track that is not the lead (an added track in the lens)
    const removed = open(s, { track: "tp", clip: "p1" }).back((p) => ({ ...p, chords: p.chords.slice(1) }));
    expect(clipOf<ChordsClip>(removed, "p1").content.chords.length).toBe(7);
    expect(rest(removed, ["p1"], [])).toEqual(rest(s, ["p1"], []));
    // its place and length stay
    expect(clipOf<ChordsClip>(removed, "p1")).toMatchObject({ start: 0, len: 32, off: 0 });
  });
  it("a sound knob and an instrument go to the open track, not to a clip", () => {
    const s = band();
    const knob = open(s, { track: "tc", clip: "c1" }).back((p) => ({ ...p, sound: { ...p.sound, space: 0.9 } }));
    expect(trackOf<ChordsTrack>(knob, "tc").sound).toMatchObject({ space: 0.9 });
    expect(knob.clips).toBe(s.clips);
    expect(rest(knob, [], ["tc"])).toEqual(rest(s, [], ["tc"]));
    const piano = open(s, { track: "tm", clip: "m1" }).back((p) => ({ ...p, tuneSound: { voice: "lyre" }, tones: { ...p.tones, melody: { inst: "piano", pedal: true } } }));
    expect(trackOf<TuneTrack>(piano, "tm").tone).toEqual({ inst: "piano", pedal: true });
    expect(trackOf<TuneTrack>(piano, "tm").sound).toEqual({ voice: "lyre" });
    expect(piano.clips).toBe(s.clips);
    expect(rest(piano, [], ["tm"])).toEqual(rest(s, [], ["tm"]));
  });
  it("a playing style and a feel go to the open clip", () => {
    const s = band();
    const styled = open(s, { track: "tp", clip: "p1" }).back((p) => ({ ...p, pattern: "travis", feel: { speed: 0.5 } }));
    expect(clipOf<ChordsClip>(styled, "p1").content).toMatchObject({ style: "travis", feel: { speed: 0.5 } });
    expect(rest(styled, ["p1"], [])).toEqual(rest(s, ["p1"], []));
  });
  it("a melody note lands in the open clip; a melody switched off mutes it", () => {
    const s = band();
    const noted = open(s, { track: "tb", clip: "b1" }).back((p) => ({ ...p, melody: toggleNote(p.melody ?? EMPTY_MELODY, 24, 40) }));
    expect(clipOf<MelodyClip>(noted, "b1").content.notes).toContainEqual({ at: 24, midi: 40 });
    expect(clipOf<MelodyClip>(noted, "b1").content.notes.length).toBe(4);
    expect(clipOf<MelodyClip>(noted, "b1").mute).toBeUndefined();
    expect(rest(noted, ["b1"], [])).toEqual(rest(s, ["b1"], []));
    const off = open(s, { track: "tb", clip: "b1" }).back((p) => ({ ...p, melody: { ...p.melody!, on: false } }));
    expect(clipOf<MelodyClip>(off, "b1").mute).toBe(true);
    expect((clipOf<MelodyClip>(off, "b1").content as { on?: boolean }).on).toBeUndefined();
    // and on again through the lens of the muted clip
    const on = open(off, { track: "tb", clip: "b1" });
    expect(on.lens.p.melody?.on).toBe(false);
    expect(clipOf<MelodyClip>(on.back((p) => ({ ...p, melody: { ...p.melody!, on: true } })), "b1").mute).toBeUndefined();
  });
  it("a rhythm picked lands in the open drums clip, and a kit on its track; the clip keeps its place and length", () => {
    const s = band();
    const pattern = BEAT_LIBRARY[3];
    const picked = open(s, { track: "td", clip: "d1" }).back((p) => ({ ...p, beat: applyPattern(p.beat!, pattern) }));
    const c = clipOf<DrumsClip>(picked, "d1");
    expect(c.content.name).toBe(pattern.name);
    expect(c).toMatchObject({ start: 16, len: 16, off: 0 });
    expect(c.content.steps / c.content.div).toBe(4);
    expect(rest(picked, ["d1"], [])).toEqual(rest(s, ["d1"], []));
    const kitted = open(s, { track: "td2", clip: "e1" }).back((p) => ({ ...p, beat: { ...p.beat!, kit: "808", space: 0.7 } as Beat }));
    expect(kitSig(trackOf<DrumsTrack>(kitted, "td2").kit)).toBe(kitSig({ ...kitOfBeat(open(s, { track: "td2", clip: "e1" }).lens.p.beat!), kit: "808", space: 0.7 }));
    expect(kitted.clips).toBe(s.clips);
    expect(rest(kitted, [], ["td2"])).toEqual(rest(s, [], ["td2"]));
  });
  it("every library rhythm picked into a 3/4 and a 6/8 clip stays in that clip's bars", () => {
    for (const sig of [SIG34, SIG68]) {
      const bar = sigBeats(sig);
      const s = songOf([drumsTrack("td", "Drums", { lead: true })], { meter: sig, clips: [drumsClip("d1", "td", 0, 4 * bar, { sig, bars: 2 })] });
      for (const pattern of BEAT_LIBRARY) {
        const next = open(s, { track: "td", clip: "d1" }).back((p) => ({ ...p, beat: applyPattern(p.beat!, pattern) }));
        const c = clipOf<DrumsClip>(next, "d1");
        expect(c.content.steps / c.content.div, `${pattern.id} in ${sig.num}/${sig.den}`).toBe(bar);
        expect(c.len).toBe(4 * bar);
        for (const row of Object.values(c.content.rows)) expect(row.length).toBe(c.content.steps * (c.content.bars ?? 1));
      }
    }
  });
  it("a clip that showed its whole content once follows when the content is made longer; one that did not keeps its length", () => {
    const s = songOf([chordsTrack("tc", "Chords", { lead: true }), tuneTrack("tm")], { clips: [melodyClip("m1", "tm", 0, 8), melodyClip("m2", "tm", 16, 4, { content: tune(2) })] });
    const longer = open(s, { track: "tm", clip: "m1" }).back((p) => ({ ...p, bars: 4 }));
    expect(clipOf<MelodyClip>(longer, "m1")).toMatchObject({ len: 16, content: { bars: 4 } });
    const part = open(s, { track: "tm", clip: "m2" }).back((p) => ({ ...p, bars: 4 }));
    expect(clipOf<MelodyClip>(part, "m2")).toMatchObject({ len: 4, content: { bars: 4 } });
  });
  it("on a track with nothing on it yet, the first thing written makes the clip, where the window was opened", () => {
    const s: TimelineSong = { ...band(), tracks: [...band().tracks, tuneTrack("tn", "melody", "Melody 2")] };
    const t: Target = { track: "tn", fresh: { id: "fresh1", at: 8, sig: { num: 4, den: 4 } } };
    const o = open(s, t);
    expect(o.lens.span).toEqual({ from: 8, to: 24 });
    // nothing written: nothing made
    expect(o.back((p) => p)).toBe(s);
    const made = o.back((p) => ({ ...p, melody: toggleNote(p.melody ?? EMPTY_MELODY, 12, 67) }));
    expect(clipOf<MelodyClip>(made, "fresh1")).toMatchObject({ track: "tn", kind: "melody", start: 8, off: 0, content: { notes: [{ at: 12, midi: 67 }] } });
    expect(made.clips.length).toBe(s.clips.length + 1);
    // a sound chosen before anything is written still goes to the track
    expect(trackOf<TuneTrack>(o.back((p) => ({ ...p, tuneSound: { voice: "kora" } })), "tn").sound).toEqual({ voice: "kora" });
  });
  it("what is being composed on a track (no clip) is written to the track's draft", () => {
    const s = band();
    const o = open(s, { track: "tm" });
    const next = o.back((p) => ({ ...p, melody: toggleNote(p.melody ?? EMPTY_MELODY, 0, 72) }));
    expect(trackOf<TuneTrack>(next, "tm").draft?.content.notes).toEqual([{ at: 0, midi: 72 }]);
    expect(next.clips).toBe(s.clips);
    // and the lens then shows the draft
    expect(lensOf(next, { track: "tm" }, KEY_C, 0)!.p.melody?.notes).toEqual([{ at: 0, midi: 72 }]);
  });
  it("a mute set inside goes to the real mixer, with the old first chords track mapped to the lead track", () => {
    const s = band();
    const muted = open(s, { track: "tm", clip: "m1" }).back((p) => ({ ...p, mix: { ...p.mix, chords: { mute: true }, tp: { db: -6 } } }));
    expect(muted.mix).toEqual({ tc: { mute: true }, tp: { db: -6 } });
    expect(muted.clips).toBe(s.clips);
  });
  it("a change to another track that already had music under the stretch is ignored", () => {
    const s = band();
    const o = open(s, { track: "tm", clip: "m1" });
    const q = normalize(o.lens.p);
    const meddled = unlens(s, { track: "tm", clip: "m1" }, o.lens, { ...q, chords: q.chords.slice(2), layers: { ...q.layers, tp: { chords: [] } } }, counter("x"));
    expect(meddled).toBe(s);
  });
});

/** A song for Harmonize: the lead chords and a melody over four bars, and an empty second chords track. */
function forHarmony(): TimelineSong {
  const chords = [chord("a1", "C"), chord("a2", "A", 4, "min"), chord("a3", "D", 4, "min"), chord("a4", "G", 4, "7")];
  return songOf([chordsTrack("tc", "Chords", { lead: true }), tuneTrack("tm"), chordsTrack("te", "Chords 2")], {
    clips: [chordsClip("c1", "tc", 16, 16, { content: chordsContent(4, undefined, chords) }), melodyClip("m1", "tm", 16, 16, { content: tune(4, [[0, 64], [2, 67], [4, 69], [6, 72], [8, 74], [10, 77], [12, 74], [14, 71]]) })],
  });
}

describe("Harmonize through the lens", () => {
  it("into a new track: a real track below the open one, with a clip over the stretch that carries its record", () => {
    const s = forHarmony();
    const t: Target = { track: "tm", clip: "m1" };
    const o = open(s, t);
    const next = o.back((p) => writeHarmony(p, KEY_C, { kind: "melody", from: "melody", option: "third-above" }, { id: "hx", isNew: true, name: "x" }).p);
    expect(next.tracks.map((x) => x.id)).toEqual(["tc", "tm", "hx", "te"]);
    expect(trackOf<TuneTrack>(next, "hx")).toMatchObject({ kind: "melody", role: "harmony", harmony: { from: "tm", option: "third-above" } });
    const made = next.clips.find((c) => c.track === "hx") as MelodyClip;
    expect(made).toMatchObject({ kind: "melody", start: 16, len: 16, off: 0, harmony: { from: "tm", option: "third-above" } });
    expect(made.content.notes.length).toBeGreaterThan(0);
    expect(made.harmony!.out).not.toBe("");
    // the open clip and the others are as they were
    expect(next.clips.filter((c) => c.track !== "hx")).toEqual(s.clips);
    // as written, it is neither changed by hand nor out of date
    expect(harmonyState5(next, KEY_C, made.id)).toEqual({ edited: [], stale: false, source: true });
  });
  it("into a track that was empty under the stretch: a clip over the stretch on that track", () => {
    const s = forHarmony();
    const o = open(s, { track: "tc", clip: "c1" });
    const target = writeTarget(normalize(o.lens.p), "chords", "unused", "unused");
    // (the old code itself finds the empty track: the one on screen has chords written by hand)
    expect(target).toMatchObject({ id: "te", isNew: false });
    const next = o.back((p) => writeHarmony(p, KEY_C, { kind: "chords", from: "chords", option: "high" }, target).p);
    expect(next.tracks.map((x) => x.id)).toEqual(["tc", "tm", "te"]);
    const made = next.clips.find((c) => c.track === "te") as ChordsClip;
    expect(made).toMatchObject({ kind: "chords", start: 16, len: 16, harmony: { from: "tc", option: "high" } });
    expect(made.instead).toBeUndefined();
    // (a track that was there keeps its name and is not marked as a harmony line, as in the old app; it remembers what it was written from)
    expect(trackOf<ChordsTrack>(next, "te")).toMatchObject({ name: "Chords 2", harmony: { from: "tc", option: "high" } });
  });
  it("Best fit from a melody plays instead of the lead chords: the clip says so, by the lead track's real id", () => {
    const s = forHarmony();
    const o = open(s, { track: "tm", clip: "m1" });
    const next = o.back((p) => writeHarmony(p, KEY_C, { kind: "chords", from: "melody", option: "fit" }, { id: "fit1", isNew: true, name: "x" }).p);
    const made = next.clips.find((c) => c.track === "fit1") as ChordsClip;
    expect(made.kind).toBe("chords");
    expect(made.instead).toBe("tc");
    expect(made.harmony).toMatchObject({ from: "tm", option: "fit" });
    // the chords heard under the melody are now the fitted ones
    expect(chordsUnderSpan(next, { from: 16, to: 32 })).toEqual(made.content.chords);
    expect(chordsUnder(lensOf(next, { track: "tm", clip: "m1" }, KEY_C, 0)!.p)).toEqual(made.content.chords);
  });
  it("written again with another option: the clip's notes and its record follow, the track is renamed with it", () => {
    const s0 = forHarmony();
    const first = open(s0, { track: "tm", clip: "m1" }).back((p) => writeHarmony(p, KEY_C, { kind: "melody", from: "melody", option: "third-above" }, { id: "hx", isNew: true, name: "x" }).p);
    const clip = first.clips.find((c) => c.track === "hx") as MelodyClip;
    const o = open(first, { track: "hx", clip: clip.id });
    const next = o.back((p) => rewriteHarmony(p, KEY_C, "hx", "third-below"));
    const again = clipOf<MelodyClip>(next, clip.id);
    expect(again.harmony).toMatchObject({ from: "tm", option: "third-below" });
    expect(again.content.notes).not.toEqual(clip.content.notes);
    expect(trackOf<TuneTrack>(next, "hx").harmony).toEqual({ from: "tm", option: "third-below" });
    expect(trackOf<TuneTrack>(next, "hx").name).not.toBe(trackOf<TuneTrack>(first, "hx").name);
    expect(harmonyState5(next, KEY_C, clip.id)).toEqual({ edited: [], stale: false, source: true });
    // changed by hand afterwards: the state says so
    const hand = open(next, { track: "hx", clip: clip.id }).back((p) => ({ ...p, melody: toggleNote(p.melody!, 0, 90) }));
    expect(harmonyState5(hand, KEY_C, clip.id).edited.length).toBe(1);
    // the source changed afterwards: out of date
    const src = open(next, { track: "tm", clip: "m1" }).back((p) => ({ ...p, melody: toggleNote(toggleNote(p.melody!, 0, 64), 0, 60) }));
    expect(harmonyState5(src, KEY_C, clip.id).stale).toBe(true);
  });
});

describe("the harmony records of a converted song read as they did before", () => {
  it("for every harmony track in every section: changed by hand, out of date, source still there", () => {
    const idea = fixture(7);
    const conv = toTimeline(idea.progression);
    let seen = 0;
    for (const block of idea.progression.song!.blocks) {
      const p = selectBlock(idea.progression, block.id);
      for (const t of allTracks(p)) {
        if (!t.harmony) continue;
        const before = harmonyState(p, idea.key, t.id);
        const clip = conv.song.clips.find((c) => c.id === `${block.id}.${t.id}`);
        // (where the track has no music in a section there is no clip, and nothing was written there)
        if (!clip) {
          expect(before.source, `${block.id} ${t.id}`).toBe(false);
          continue;
        }
        const after = harmonyState5(conv.song, idea.key, clip.id);
        expect({ edited: after.edited.length > 0, stale: after.stale, source: after.source }, `${block.id} ${t.id}`).toEqual({ edited: before.edited.length > 0, stale: before.stale, source: before.source });
        if (before.source) seen++;
      }
    }
    expect(seen).toBeGreaterThanOrEqual(6);
  });
  it("and a harmony changed by hand before the conversion still reads as changed after it", () => {
    const idea = fixture(7);
    const p0 = idea.progression;
    // a note of the third above taken out by hand, in the first section
    const part = p0.song!.parts.find((x) => x.id === "A")!;
    const m = part.layers!.h3.melody!;
    const p: Progression = selectBlock({ ...p0, song: { ...p0.song!, parts: p0.song!.parts.map((x) => (x === part ? { ...x, layers: { ...x.layers, h3: { ...x.layers!.h3, melody: { ...m, notes: m.notes.slice(1) } } } } : x)) } }, "b2");
    const back = selectBlock(p, "b1");
    expect(harmonyState(back, idea.key, "h3").edited.length).toBe(1);
    expect(harmonyState5(toTimeline(back).song, idea.key, "b1.h3").edited.length).toBe(1);
  });
});
