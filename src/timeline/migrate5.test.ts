// An old song as tracks and clips: what the conversion must give, structure by structure.
// (That a converted song sounds as it did is held by equal.test.ts.)
import { describe, expect, it } from "vitest";
import { DEFAULT_BEAT, kitOfBeat, kitSig } from "../audio/beats";
import { slotsOf } from "../audio/synth";
import { FX_DEFAULT } from "../audio/vocalfx";
import { chordShape } from "../guitar/arrange";
import { getTuning } from "../guitar/tunings";
import { copyRhythm } from "../song/clip";
import { layClips, placedClips } from "../song/clips";
import { barsOr } from "../song/frame";
import { harmonyState } from "../song/harmony";
import { legacyPlan } from "../song/legacyplan";
import { exportIdeas } from "../song/library";
import { sigBeats } from "../song/meter";
import { sections, selectBlock, soloSection } from "../song/structure";
import { allTracks, normalize } from "../song/tracks";
import { sigOf } from "../song/unity";
import type { ChordRef } from "../theory/chords";
import { DEFAULT_STATE, loadV4, type AppStateV4, type Progression } from "../ui/state";
import { barMap } from "./bars";
import { convertAll } from "./convert";
import { cutPoints } from "./cuts";
import { FIXTURES, fixture, fixtures } from "./fixtures5";
import { harmonyState5 } from "./lens";
import { toTimeline, unplacedTakes } from "./migrate5";
import { clipEnd, notches, rateOf } from "./model";
import type { AudioClip, AudioTrack, ChordsClip, ChordsTrack, DrumsClip, DrumsTrack, MelodyClip, TimelineSong, TuneTrack } from "./model";
import type { VoicingCtx } from "./voicing";

const tuning = getTuning("standard");
const vctx: VoicingCtx = { tuning, capo: 0, avoidBarre: true, shapeOf: (ref: ChordRef, voicingId?: string) => chordShape(ref, tuning, 0, true, voicingId) };
const song = (n: number): TimelineSong => toTimeline(fixture(n).progression).song;
const clip = <C,>(s: TimelineSong, id: string) => s.clips.find((c) => c.id === id) as unknown as C;
const track = <T,>(s: TimelineSong, id: string) => s.tracks.find((t) => t.id === id) as unknown as T;
const on = (s: TimelineSong, t: string) => s.clips.filter((c) => c.track === t).map((c) => c.id);
/** The old song's sections as they lie in time: each with the beat it starts on, its first bar, and its beats in a bar. */
function lay(p: Progression) {
  const secs = sections(p);
  const row = secs.length ? secs : [soloSection(normalize(p))];
  let at = 0;
  let bar0 = 0;
  return row.map((sec) => {
    const bar = sigBeats(sec.meter ?? sigOf(p));
    const bars = barsOr(sec.bars);
    const x = { sec, at, bar0, bar, bars, beats: bars * bar };
    at += bars * bar;
    bar0 += bars;
    return x;
  });
}

describe("toTimeline: structure", () => {
  it("1. the three-section example gives exactly the tracks, clips, bar map and markers of the plan", () => {
    const { song: s, ids } = toTimeline(fixture(18).progression);
    expect(s.v).toBe(5);
    expect(s.bpm).toBe(96);
    expect(s.meter).toEqual({ num: 4, den: 4 });
    expect(s.sigs).toEqual([{ bar: 8, sig: { num: 6, den: 8 } }, { bar: 12, sig: { num: 4, den: 4 } }]);
    expect(s.end).toBe(72);
    expect(s.markers).toEqual([{ id: "b1", beat: 0, name: "Verse", color: 0 }, { id: "b2", beat: 32, name: "Chorus", color: 1 }, { id: "b3", beat: 40, name: "Verse", color: 0 }]);
    expect(s.tracks.map((t) => [t.id, t.kind, t.name])).toEqual([
      ["t-chords", "chords", "Chords"], ["t-chords~2", "chords", "Chords · Chorus"], ["t-melody", "melody", "Melody"], ["t-drums", "drums", "Drums"], ["c7x", "chords", "Chords 2"], ["v1", "vocals", "Vocal 1"],
    ]);
    // the first chords row was a guitar in the verse and a piano in the chorus: two tracks, both lead, the rows kept together
    expect(track<ChordsTrack>(s, "t-chords")).toMatchObject({ tone: { inst: "guitar" }, lead: true, group: "t-chords" });
    expect(track<ChordsTrack>(s, "t-chords~2")).toMatchObject({ tone: { inst: "piano" }, lead: true, group: "t-chords" });
    expect(track<ChordsTrack>(s, "c7x").tone.inst).toBe("synth");
    expect(track<ChordsTrack>(s, "c7x").lead).toBeUndefined();
    // the drums row was not split: one kit
    expect(track<DrumsTrack>(s, "t-drums")).toMatchObject({ lead: true, kit: { kit: "909" } });
    expect(ids).toEqual({ chords: ["t-chords", "t-chords~2"], melody: ["t-melody"], drums: ["t-drums"], c7x: ["c7x"], v1: ["v1"] });
    const place = (id: string) => [clip<ChordsClip>(s, id).start, clip<ChordsClip>(s, id).len, clip<ChordsClip>(s, id).off];
    expect(on(s, "t-chords")).toEqual(["b1.chords", "b3.chords"]);
    expect(place("b1.chords")).toEqual([0, 32, 0]);
    expect(place("b3.chords")).toEqual([40, 32, 0]);
    expect(on(s, "t-chords~2")).toEqual(["b2.chords"]);
    expect(place("b2.chords")).toEqual([32, 8, 0]);
    expect(clip<ChordsClip>(s, "b2.chords").sig).toEqual({ num: 6, den: 8 });
    expect(on(s, "t-melody")).toEqual(["b2.melody"]);
    expect(place("b2.melody")).toEqual([32, 8, 0]);
    expect(clip<MelodyClip>(s, "b2.melody").content.notes.length).toBe(9);
    expect(on(s, "t-drums")).toEqual(["b1.drums", "b2.drums", "b3.drums"]);
    expect(place("b1.drums")).toEqual([0, 32, 0]);
    expect(place("b2.drums")).toEqual([32, 8, 0]);
    expect(place("b3.drums")).toEqual([40, 32, 0]);
    // a one-bar rhythm in an eight-bar section is a clip that repeats eight times; in the four bars of 6/8, four times
    expect(notches(clip<DrumsClip>(s, "b1.drums"), s).length).toBe(7);
    expect(notches(clip<DrumsClip>(s, "b2.drums"), s).length).toBe(3);
    expect(on(s, "c7x")).toEqual(["b2.c7x"]);
    expect(place("b2.c7x")).toEqual([32, 8, 0]);
    // the take was sung from bar 3 of the chorus (two beats to the bar): beat 32 + 2 × 2
    expect(track<AudioTrack>(s, "v1").takes[0].at).toBe(36);
    expect(clip<AudioClip>(s, "k1")).toMatchObject({ track: "v1", kind: "audio", take: "t1", start: 36, from: 0, to: 144000, off: 0, frames: 144000 });
    expect(s.clips.length).toBe(9);
  });

  it("2. a song with no sections converts as one section at beat 0", () => {
    const p = fixture(1).progression;
    expect(p.song ?? null).toBeNull();
    const s = toTimeline(p).song;
    expect(s.tracks.map((t) => t.id)).toEqual(["t-chords", "t-melody", "t-drums"]);
    expect(s.clips.map((c) => [c.id, c.track, c.start])).toEqual([["a.chords", "t-chords", 0], ["a.melody", "t-melody", 0], ["a.drums", "t-drums", 0]]);
    expect(s.clips.every((c) => c.kind !== "audio" && c.len === 16 && c.off === 0)).toBe(true);
    expect(s.end).toBe(16);
    expect(s.sigs).toBeUndefined();
    // (it never had sections: there is nothing to name on the ruler)
    expect(s.markers).toBeUndefined();
    expect(clip<ChordsClip>(s, "a.chords").content).toMatchObject({ bars: 4, style: "strum", feel: { touch: 0.7 } });
  });

  it("3. the same song converted twice gives the same result, and the song converted is left as it was", () => {
    for (const idea of fixtures()) {
      const before = JSON.stringify(idea.progression);
      const a = toTimeline(idea.progression);
      const b = toTimeline(idea.progression);
      expect(b, idea.name).toEqual(a);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(JSON.stringify(idea.progression), idea.name).toBe(before);
      // every id is made from the old ids: none is drawn at random
      expect(toTimeline(fixture(Number(idea.id.split("-")[1]) || 18).progression), idea.name).toEqual(a);
    }
  });

  it("4. one sound, one track; N sounds heard differently, N tracks; settings of an instrument not in use split nothing; never more voices than before", () => {
    // one sound everywhere
    expect(song(2).tracks.map((t) => t.id)).toEqual(["t-chords", "t-melody", "t-drums"]);
    // guitar, piano, synth, and a guitar that remembers a synth and a voicing it is not playing
    const s = song(3);
    expect(s.tracks.filter((t) => t.kind === "chords").map((t) => [t.id, (t as ChordsTrack).tone.inst])).toEqual([["t-chords", "guitar"], ["t-chords~2", "piano"], ["t-chords~3", "synth"]]);
    expect(on(s, "t-chords")).toEqual(["b1.chords", "b4.chords"]);
    expect(on(s, "t-chords~2")).toEqual(["b2.chords", "b5.chords"]);
    expect(on(s, "t-chords~3")).toEqual(["b3.chords"]);
    // the track keeps the fullest tone of its sections: what the guitar remembers is not lost
    expect(track<ChordsTrack>(s, "t-chords").tone.synth).toBeDefined();
    expect(track<ChordsTrack>(s, "t-chords~2").name).toBe("Chords · B");
    // a different kit in each section: a drums track for each
    expect(song(4).tracks.filter((t) => t.kind === "drums").map((t) => [t.id, (t as DrumsTrack).kit.kit])).toEqual([["t-drums", "box"], ["t-drums~2", "909"], ["t-drums~3", "808"]]);
    expect(on(song(4), "t-drums")).toEqual(["b1.drums", "b4.drums"]);
    // counting only tracks that sound, there are never more chords and melody voices than the old song ran
    for (let n = 1; n <= FIXTURES + 1; n++) {
      const p = fixture(n).progression;
      const now = toTimeline(p).song;
      const sounding = now.tracks.filter((t) => (t.kind === "chords" || t.kind === "melody") && now.clips.some((c) => c.track === t.id && !c.mute && (c.kind === "chords" ? c.content.chords.some((x) => !x.rest) : c.kind === "melody" && c.content.notes.length > 0)));
      expect(sounding.length, `fixture ${n}`).toBeLessThanOrEqual(slotsOf(legacyPlan(p, vctx, () => undefined).items).length);
    }
  });

  it("5. a section played twice gives two clips whose contents are equal but not the same object", () => {
    const s = song(2);
    const a = clip<ChordsClip>(s, "b1.chords");
    const b = clip<ChordsClip>(s, "b3.chords");
    expect(b.content).toEqual(a.content);
    expect(b.content).not.toBe(a.content);
    expect(b.content.chords).not.toBe(a.content.chords);
    expect(clip<MelodyClip>(s, "b3.melody").content).toEqual(clip<MelodyClip>(s, "b1.melody").content);
    expect(clip<MelodyClip>(s, "b3.melody").content.notes).not.toBe(clip<MelodyClip>(s, "b1.melody").content.notes);
    expect(clip<DrumsClip>(s, "b3.drums").content.rows).not.toBe(clip<DrumsClip>(s, "b1.drums").content.rows);
    // and nothing of the old song is shared with the new one
    const p = fixture(2).progression;
    expect(clip<ChordsClip>(toTimeline(p).song, "b1.chords").content.chords[0]).not.toBe(p.song!.parts[0].chords[0]);
  });

  it("6. sections in different time signatures give the right changes, and every section starts on the bar line the bar map gives", () => {
    const s = song(5);
    expect(s.meter).toEqual({ num: 4, den: 4 });
    expect(s.sigs).toEqual([{ bar: 2, sig: { num: 6, den: 8 } }, { bar: 6, sig: { num: 3, den: 4 } }]);
    expect(s.clips.filter((c) => c.kind === "chords").map((c) => (c as ChordsClip).sig.num)).toEqual([4, 6, 3]);
    for (let n = 1; n <= FIXTURES + 1; n++) {
      const p = fixture(n).progression;
      const map = barMap(toTimeline(p).song);
      for (const x of lay(p)) expect(map.beatOfBar(x.bar0), `fixture ${n}`).toBe(x.at);
    }
  });

  it("7. every take and every audio clip lies where it lay, to the sample; what was trimmed can be dragged back out", () => {
    const p = fixture(8).progression;
    const np = normalize(p);
    const s = toTimeline(p).song;
    const rows = lay(p);
    const spb = 60 / p.bpm;
    const old = (np.tracks ?? []).filter((t) => t.kind === "vocals");
    const laid = layClips(rows.map((x) => ({ block: x.sec.blockId, bar: x.bar, beats: x.beats })), old.flatMap((t) => placedClips(t)), p.bpm);
    let seen = 0;
    for (const x of rows)
      for (const l of laid[x.sec.blockId]) {
        const c = s.clips.find((k) => k.id === l.clip.id) as AudioClip;
        const begin = x.at + l.at;
        expect(c, l.clip.id).toBeDefined();
        expect(c.mute).toBeUndefined();
        expect([c.from, c.to]).toEqual([0, l.take.frames]);
        if (begin >= 0) {
          expect(Math.abs(c.start - begin), l.clip.id).toBeLessThan(1e-9);
          expect([c.off, c.frames]).toEqual([l.clip.from, l.clip.to - l.clip.from]);
        } else {
          // it began before the song does: it starts on the first beat, that much further into the take
          expect(c.start).toBe(0);
          expect(c.off).toBeCloseTo(l.clip.from - begin * spb * l.take.rate, 6);
          expect(c.frames).toBeCloseTo(l.clip.to - l.clip.from + begin * spb * l.take.rate, 6);
          expect((c.off + c.frames) / l.take.rate).toBeCloseTo(l.clip.to / l.take.rate, 9);
        }
        seen++;
      }
    expect(seen).toBeGreaterThanOrEqual(9);
    expect(clip<AudioClip>(s, "k5")).toMatchObject({ start: 0 });
    expect(clip<AudioClip>(s, "k5").off).toBeGreaterThan(0);
    // each take lies on the beat it was sung from: section start + bar × beats in a bar
    const takes = s.tracks.filter((t): t is AudioTrack => t.kind === "vocals").flatMap((t) => t.takes);
    const at = (id: string) => takes.find((k) => k.id === id)!.at;
    expect([at("t1"), at("t2"), at("t3"), at("t4"), at("t7"), at("u1")]).toEqual([4, 8, 12, 0, 24, 16]);
    // a take whose section is gone is unplaced and has no clip; it is still in the take list
    expect(at("t5")).toBeNull();
    expect(s.clips.some((c) => c.id === "k6")).toBe(false);
    expect(unplacedTakes(s)).toBe(1);
    // one whose bar is gone has its clip, silent, where the bar would be
    expect(at("t6")).toBe(36);
    expect(clip<AudioClip>(s, "k7")).toMatchObject({ start: 36, mute: true });
    // input 2 becomes the second input, counted from 0; input 1 is the default
    expect(track<AudioTrack>(s, "v1").input).toEqual({ ch: 1 });
    expect(track<AudioTrack>(s, "v2").input).toBeUndefined();
    expect(track<AudioTrack>(s, "v2").fx).toEqual(FX_DEFAULT);
  });

  it("8. a row's mixer entry is copied to every track it became; mute and solo survive", () => {
    const s8 = song(8);
    expect(s8.mix).toEqual({ v1: { db: -2, solo: true }, "v1~2": { db: -2, solo: true }, "v1~3": { db: -2, solo: true } });
    expect(song(6).mix).toEqual({ c2: { db: -3 }, m2: { mute: true } });
    // the first chords row, split in three, muted because a harmony played instead of it (as older songs noted it)
    const p: Progression = { ...fixture(3).progression, mix: { chords: { mute: true, instead: true, db: -5 }, drums: { solo: true } } };
    expect(toTimeline(p).song.mix).toEqual({ "t-chords": { mute: true, db: -5 }, "t-chords~2": { mute: true, db: -5 }, "t-chords~3": { mute: true, db: -5 }, "t-drums": { solo: true } });
  });

  it("9. harmony records land on the right clips, and read as they did: changed by hand, source changed", () => {
    const idea = fixture(7);
    const s = toTimeline(idea.progression).song;
    expect(track<ChordsTrack>(s, "h1")).toMatchObject({ role: "harmony", harmony: { from: "t-chords", option: "passing" } });
    expect(track<TuneTrack>(s, "h3")).toMatchObject({ role: "harmony", harmony: { from: "t-melody", option: "third-above" } });
    // written to play instead of the chords in the verse: both verses say so
    for (const id of ["b1.h1", "b3.h1"]) expect(clip<ChordsClip>(s, id)).toMatchObject({ instead: "t-chords", harmony: { from: "t-chords", option: "passing" } });
    // high chords play along, in the verse and in the chorus
    for (const id of ["b1.h2", "b2.h2", "b3.h2"]) {
      expect(clip<ChordsClip>(s, id).harmony).toMatchObject({ from: "t-chords", option: "high" });
      expect(clip<ChordsClip>(s, id).instead).toBeUndefined();
    }
    expect(clip<MelodyClip>(s, "b1.h3").harmony).toMatchObject({ from: "t-melody", option: "third-above" });
    expect(s.clips.some((c) => c.id === "b2.h1" || c.id === "b2.h3")).toBe(false);
    // the clips written by hand carry no record
    expect(clip<ChordsClip>(s, "b1.chords").harmony).toBeUndefined();
    // each record's fingerprints are the old section's
    const part = idea.progression.tracks!.find((t) => t.id === "h2")!.harmony!.marks!;
    expect(clip<ChordsClip>(s, "b1.h2").harmony).toMatchObject({ src: part.A.src, out: part.A.out });
    expect(clip<ChordsClip>(s, "b2.h2").harmony).toMatchObject({ src: part.B.src, out: part.B.out });
    // and they read the same before and after, for every harmony track in every section
    for (const block of idea.progression.song!.blocks) {
      const p = selectBlock(idea.progression, block.id);
      for (const t of allTracks(p).filter((x) => x.harmony)) {
        const c = s.clips.find((x) => x.id === `${block.id}.${t.id}`);
        if (!c) continue;
        const before = harmonyState(p, idea.key, t.id);
        const after = harmonyState5(s, idea.key, c.id);
        expect([after.edited.length > 0, after.stale, after.source], c.id).toEqual([before.edited.length > 0, before.stale, before.source]);
        expect(after).toMatchObject({ stale: false, source: true });
      }
    }
  });

  it("10. a melody or drums that are off become muted clips; drums nobody touched give none; a first drums row on with swing or triplets but no hits gives an empty clip", () => {
    const s = song(14);
    expect(clip<MelodyClip>(s, "b1.melody").mute).toBe(true);
    expect(clip<MelodyClip>(s, "b2.melody").mute).toBeUndefined();
    expect(clip<DrumsClip>(s, "b1.drums").mute).toBe(true);
    expect(clip<DrumsClip>(s, "b2.drums").mute).toBeUndefined();
    expect(clip<MelodyClip>(s, "b2.m2").mute).toBe(true);
    expect(clip<DrumsClip>(s, "b2.d2").mute).toBe(true);
    // (the notes and the rhythm are kept; the old on/off is the clip's own switch now)
    expect(clip<MelodyClip>(s, "b1.melody").content.notes.length).toBe(2);
    expect("on" in clip<MelodyClip>(s, "b1.melody").content).toBe(false);
    expect("on" in clip<DrumsClip>(s, "b1.drums").content).toBe(false);
    // off, not edited, still the rhythm a new idea starts with: no clip
    expect(s.clips.some((c) => c.id === "b3.drums")).toBe(false);
    const s16 = song(16);
    const empty = clip<DrumsClip>(s16, "b1.drums");
    expect(empty).toMatchObject({ kind: "drums", start: 0, len: 8, content: { swing: 0.5, div: 4 } });
    expect(Object.values(empty.content.rows).every((r) => /^0+$/.test(r))).toBe(true);
    expect(empty.mute).toBeUndefined();
    expect(clip<DrumsClip>(s16, "b2.drums").content).toMatchObject({ div: 3 });
    expect(s16.clips.some((c) => c.id === "b3.drums")).toBe(false);
    // a song that never used drums gets no faint drum clips at all
    const never = toTimeline({ ...fixture(11).progression }).song;
    expect(never.clips.some((c) => c.kind === "drums")).toBe(false);
    expect(track<DrumsTrack>(never, "t-drums")).toMatchObject({ kind: "drums", lead: true });
    expect(kitSig(track<DrumsTrack>(never, "t-drums").kit)).toBe(kitSig(kitOfBeat(DEFAULT_BEAT)));
  });

  it("11. recordings that overlap on one old vocal track land on tracks of their own, with the same chain, input and mixer entry; none overlap any more", () => {
    const { song: s, ids } = toTimeline(fixture(8).progression);
    expect(ids.v1).toEqual(["v1", "v1~2", "v1~3"]);
    const lanes = ids.v1.map((id) => track<AudioTrack>(s, id));
    expect(lanes.map((t) => [t.name, t.group])).toEqual([["Vocal 1", "v1"], ["Vocal 1 · 2", "v1"], ["Vocal 1 · 3", "v1"]]);
    for (const t of lanes) {
      expect(t.fx).toEqual(lanes[0].fx);
      expect(t.input).toEqual({ ch: 1 });
      expect(s.mix![t.id]).toEqual({ db: -2, solo: true });
      // each has the records of the takes its clips play (the files are shared, not copied)
      for (const c of s.clips.filter((x) => x.track === t.id)) expect(t.takes.some((k) => k.id === (c as AudioClip).take), c.id).toBe(true);
    }
    // the first track keeps every take, also the ones that lie nowhere
    expect(lanes[0].takes.map((k) => k.id)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
    // the two pieces of the split stay on one track, touching
    expect(clip<AudioClip>(s, "k1").track).toBe(clip<AudioClip>(s, "k2").track);
    for (const t of s.tracks.filter((x) => x.kind === "vocals")) {
      const mine = s.clips.filter((c) => c.track === t.id).sort((a, b) => a.start - b.start) as AudioClip[];
      for (let i = 1; i < mine.length; i++) {
        const half = 0.5 / rateOf(s, mine[i]) / (60 / s.bpm);
        expect(mine[i].start, `${mine[i - 1].id} then ${mine[i].id}`).toBeGreaterThanOrEqual(clipEnd(mine[i - 1], s) - half);
      }
    }
    // a track with no overlaps stays one track
    expect(ids.v2).toEqual(["v2"]);
    expect(track<AudioTrack>(s, "v2").group).toBeUndefined();
  });

  it("12. the song is as long as the old one, also when its last sections are empty", () => {
    expect(song(17).end).toBe(2 * 4 + 3 * 4 + 2 * 4 + 1 * 3);
    for (let n = 1; n <= FIXTURES + 1; n++) {
      const p = fixture(n).progression;
      const rows = lay(p);
      expect(toTimeline(p).song.end, `fixture ${n}`).toBe(rows[rows.length - 1].at + rows[rows.length - 1].beats);
      expect(toTimeline(p).song.end).toBe(legacyPlan(p, vctx, () => undefined).items.reduce((a, x) => a + x.beats, 0));
    }
  });

  it("13. every old section line is a cut", () => {
    for (let n = 1; n <= FIXTURES + 1; n++) {
      const p = fixture(n).progression;
      const cuts = cutPoints(toTimeline(p).song);
      for (const x of lay(p)) expect(cuts, `fixture ${n}, section at ${x.at}`).toContain(x.at);
    }
  });

  it("14. the rest of the app's state is as it was, and an old chords clipboard becomes a clipboard whose track carries the copied sound", () => {
    const ideas = fixtures().slice(0, 3);
    const open = ideas[2];
    const copied = copyRhythm({ ...open.progression, sound: { voice: "nylon", space: 0.7 }, tones: { chords: { inst: "piano", pedal: true } } }, open.key, "A");
    const stored = {
      ...JSON.parse(JSON.stringify(DEFAULT_STATE)), key: { tonic: "D", scaleId: "dorian" }, progression: open.progression, ideaId: open.id, saved: JSON.parse(exportIdeas(ideas)).ideas,
      settings: { tuningId: "dropd", capo: 2, leftHanded: true, labels: "notes", theme: "dark", avoidBarre: false, v: 3 },
      shapes: { "standard|0|C:maj": "x32010" }, myBeats: [{ id: "mine1", name: "Mine", group: "mine", steps: 16, div: 4, swing: 0, rows: DEFAULT_BEAT.rows }],
      myKits: [{ id: "k1", name: "My kit", kit: "808", voices: {}, sounds: {}, fx: {} }], mySounds: [{ id: "s1", name: "My sound", sound: { voice: "lyre" } }],
      canvas: { palette: "dusk", fade: 2 }, studio: { host: "ASIO", device: "Interface", monitor: "effects", countIn: 2, nudge: 12 }, view: { bars: 8, follow: true },
      tombs: { gone1: 123 }, clip: { rhythm: copied }, draft: "d7",
    };
    const old: AppStateV4 = loadV4(JSON.stringify(stored));
    const now = convertAll(old, 1000);
    for (const k of ["key", "settings", "shapes", "myBeats", "myKits", "mySounds", "canvas", "studio", "view", "tombs", "ideaId", "draft"] as const) expect(now[k], k).toEqual(old[k]);
    expect(now.key).toEqual({ tonic: "D", scaleId: "dorian" });
    expect(now.settings.capo).toBe(2);
    expect(now.myKits.length).toBe(1);
    // the clipboard: one chords clip at the first beat, and a track that holds the instrument and the sound it was copied with
    expect(now.clip!.key).toEqual(open.key);
    expect(now.clip!.clips.length).toBe(1);
    expect(now.clip!.clips[0]).toMatchObject({ kind: "chords", start: 0, off: 0, content: { chords: copied.chords } });
    expect(now.clip!.tracks.length).toBe(1);
    expect(now.clip!.tracks[0]).toMatchObject({ id: now.clip!.clips[0].track, kind: "chords", name: "Chords", tone: { inst: "piano", pedal: true }, sound: { voice: "nylon", space: 0.7 } });
    expect(now.clip!.takes).toEqual([]);
  });
});
