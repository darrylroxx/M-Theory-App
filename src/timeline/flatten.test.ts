// A song of tracks and clips as the list the player takes: the silent items that mark time, and what rides on them.
import { describe, expect, it } from "vitest";
import { emptyRows, type Groove } from "../audio/beats";
import type { PlayItem } from "../audio/patterns";
import { chordShape } from "../guitar/arrange";
import { getTuning } from "../guitar/tunings";
import type { ChordRef } from "../theory/chords";
import { drySound, flatten, songBeat, type Flat, type FlattenCtx } from "./flatten";
import type { AudioClip, Take5, TimelineSong } from "./model";
import { renderLog } from "./renderlog";
import { resizeClip, splitClips } from "./edit";
import { SIG44, SIG68, audioClip, audioTrack, bandSong, chord, chordsClip, chordsContent, chordsTrack, counter, drumsClip, drumsTrack, groove, melodyClip, mixedSong, songOf, take, tune, tuneTrack } from "./testsongs";
import { voicingsFor, type VoicingCtx } from "./voicing";

const tuning = getTuning("standard");
const vctx: VoicingCtx = { tuning, capo: 0, avoidBarre: true, shapeOf: (ref: ChordRef, voicingId?: string) => chordShape(ref, tuning, 0, true, voicingId) };
const voicingsOf = voicingsFor(vctx);
/** every take's pretend sound: one object for a take's sound with its effects, another for it as it was sung */
const bufs = new Map<string, AudioBuffer>();
const buffer = (t: Take5, dry?: boolean): AudioBuffer => {
  const k = `${t.id}${dry ? ":dry" : ""}`;
  if (!bufs.has(k)) bufs.set(k, { duration: t.frames / t.rate, label: k } as unknown as AudioBuffer);
  return bufs.get(k)!;
};
const ctx: FlattenCtx = { voicingsOf, buffer };
const label = (b: AudioBuffer) => (b as unknown as { label: string }).label;

/** how long each item is, with "p" after a pad */
const shape = (f: Flat) => f.items.map((x) => `${x.beats}${x.pad ? "p" : ""}`).join(" ");
/** the item that starts on a beat */
const itemAt = (f: Flat, beat: number): PlayItem => f.items[f.at.indexOf(beat)];

/** lead chords over bars 1–2 and 7–8 with nothing between, and a melody over all eight bars (so it is one stretch) */
function gapped(tone = tuneTrack("tm").tone): TimelineSong {
  return songOf([chordsTrack("tc", "Chords", { lead: true }), tuneTrack("tm", "melody", "Melody", { tone })], {
    clips: [chordsClip("c1", "tc", 0, 8), chordsClip("c2", "tc", 24, 8), melodyClip("m1", "tm", 0, 32, { content: tune(8, [[0, 64], [9, 67], [30, 69]]) })],
  });
}

describe("the items: the time grid", () => {
  it("one item for each chord of the lead chords track, and where it is silent a pad for every bar", () => {
    const f = flatten(gapped(), ctx);
    expect(shape(f)).toBe("4 4 4p 4p 4p 4p 4 4");
    expect(f.at).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(f.origin).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(f.end).toBe(32);
    expect(f.loop).toBe(false);
    expect(f.any).toBe(true);
    // every item is silent: nothing of its own to play, no melody, no drums; all of them share what rides on them
    for (const item of f.items) {
      expect(item.midi).toEqual([]);
      expect(item.tune).toBeNull();
      expect(item.drums).toBeUndefined();
      expect(item.extra).toBe(f.items[0].extra);
      expect(item.meter).toBe(f.items[0].meter);
    }
    expect(f.items.map((x) => !!x.section)).toEqual([true, false, false, false, false, false, false, false]);
    expect(f.items[0].meter).toEqual({ bar: 4, triplet: false, sig: SIG44, swing: 0 });
  });
  it("the silence is one pad, not cut at the bars, under a melody on a piano with the pedal on (its pedal changes with every item)", () => {
    expect(shape(flatten(gapped({ inst: "piano", pedal: true }), ctx))).toBe("4 4 16p 4 4");
    // a piano without the pedal: cut at the bars, as under the strings
    expect(shape(flatten(gapped({ inst: "piano" }), ctx))).toBe("4 4 4p 4p 4p 4p 4 4");
  });
  it("the silence is one pad too under a melody on the keys while the lead drums swing (a rendered note's length is read off the item it is in)", () => {
    const swung: Groove = { ...groove(1, SIG44), swing: 0.5 };
    const withDrums = (tone: TimelineSong["tracks"][number]): TimelineSong => {
      const s = gapped();
      return { ...s, tracks: [s.tracks[0], tone, drumsTrack("td", "Drums", { lead: true })], clips: [...s.clips, drumsClip("d1", "td", 0, 32, { content: swung })] };
    };
    expect(shape(flatten(withDrums(tuneTrack("tm", "melody", "Melody", { tone: { inst: "piano" } })), ctx))).toBe("4 4 16p 4 4");
    expect(shape(flatten(withDrums(tuneTrack("tm")), ctx))).toBe("4 4 4p 4p 4p 4p 4 4");
  });
  it("each stretch starts again: its first item says so, and the items say which beat they and their stretch start on", () => {
    const f = flatten(mixedSong(), ctx);
    // 4/4 for 8 bars, 6/8 for 4, 4/4 for 4: one chord to the bar in each
    expect(f.items.map((x) => x.beats)).toEqual([...Array(8).fill(4), ...Array(4).fill(2), ...Array(4).fill(4)]);
    expect(f.items.map((x, i) => (x.section ? f.at[i] : null)).filter((x) => x !== null)).toEqual([0, 32, 40]);
    expect(f.origin[7]).toBe(0);
    expect(f.origin[8]).toBe(32);
    expect(f.origin[12]).toBe(40);
    expect(itemAt(f, 32).meter).toMatchObject({ bar: 2, triplet: true, sig: SIG68 });
    expect(songBeat(f, { index: 9, beat: 3.5 })).toBe(35.5);
  });
  it("a muted clip sounds nowhere and makes no grid; a lead track muted in the mixer still makes the grid, and still plays into its fader", () => {
    const s = gapped();
    const muted: TimelineSong = { ...s, clips: s.clips.map((c) => (c.id === "c1" ? { ...c, mute: true } : c)) };
    const f = flatten(muted, ctx);
    expect(shape(f)).toBe("4p 4p 4p 4p 4p 4p 4 4");
    expect(f.items[0].extra!.chords.map((c) => c.at)).toEqual([24, 28]);
    const mixed: TimelineSong = { ...s, mix: { tc: { mute: true } } };
    const g = flatten(mixed, ctx);
    expect(shape(g)).toBe("4 4 4p 4p 4p 4p 4 4");
    expect(g.items[0].extra!.chords.map((c) => c.at)).toEqual([0, 4, 24, 28]);
  });
  it("two lead chords tracks at once: the items follow the chord edges of both", () => {
    const s = songOf([chordsTrack("ta", "A", { lead: true }), chordsTrack("tb", "B", { lead: true })], {
      clips: [chordsClip("a", "ta", 0, 8), chordsClip("b", "tb", 0, 8, { content: chordsContent(2, undefined, [chord("x", "C", 2), chord("y", "F", 6)]) })],
    });
    expect(shape(flatten(s, ctx))).toBe("2 2 4");
  });
  it("the swing and the triplet grid the others follow come from the lead drums of the stretch", () => {
    const swung: Groove = { ...groove(1, SIG44), swing: 0.4 };
    const s = songOf([chordsTrack("tc", "Chords", { lead: true }), drumsTrack("td", "Drums", { lead: true })], { clips: [chordsClip("c1", "tc", 0, 16), drumsClip("d1", "td", 8, 8, { content: swung })] });
    const f = flatten(s, ctx);
    expect(itemAt(f, 0).meter).toMatchObject({ swing: 0, triplet: false });
    expect(itemAt(f, 8).meter).toMatchObject({ swing: 0.4, triplet: false });
    expect(f.origin[f.at.indexOf(8)]).toBe(8);
    // a muted lead drums clip gives nothing
    expect(itemAt(flatten({ ...s, clips: s.clips.map((c) => (c.id === "d1" ? { ...c, mute: true } : c)) }, ctx), 8).meter).toMatchObject({ swing: 0 });
  });
});

describe("chords", () => {
  it("every round of a clip's content, from where its left edge opens it, each chord with where it starts in the stretch", () => {
    // two bars of content (C then F), shown from its second bar for three bars: F, then C, F again
    const s = songOf([chordsTrack("tc", "Chords", { lead: true })], { clips: [chordsClip("c1", "tc", 4, 12, { off: 4, content: chordsContent(2, undefined, [chord("x", "C", 4), chord("y", "F", 4)]) })] });
    const f = flatten(s, ctx);
    // (nothing crosses bar 2's line, so the clip's stretch starts there)
    expect(f.origin).toEqual([0, 4, 4, 4]);
    const chords = itemAt(f, 4).extra!.chords;
    expect(chords.map((c) => [c.track, c.at, c.beats, c.style])).toEqual([["tc", 0, 4, "ring"], ["tc", 4, 4, "ring"], ["tc", 8, 4, "ring"]]);
    // F, C, F: the guitar's shapes, without the strings that are not played
    expect(chords[0].midi).toEqual(chords[2].midi);
    expect(chords[0].midi).not.toEqual(chords[1].midi);
    expect(chords[1].midi.every((m) => typeof m === "number")).toBe(true);
    expect(chords[1].midi.length).toBeGreaterThan(2);
  });
  it("a chord is cut at its clip's edge and at the end of its content's frame; a rest plays nothing; on the keys the chords are laid out on the keys", () => {
    const content = chordsContent(1, undefined, [chord("x", "C", 3), { ...chord("r", "C", 2), rest: true }, chord("y", "F", 4)]);
    const s = songOf([chordsTrack("tc", "Chords", { lead: true, tone: { inst: "piano" } })], { clips: [chordsClip("c1", "tc", 0, 7, { content })] });
    const chords = flatten(s, ctx).items[0].extra!.chords;
    // one bar of content: C for 3, a rest cut to 1 by the frame (F is never reached); then round again, cut at the clip's edge
    expect(chords.map((c) => [c.at, c.beats, c.midi.length > 0])).toEqual([[0, 3, true], [3, 1, false], [4, 3, true]]);
    expect(chords[0].tone).toEqual({ inst: "piano" });
  });
  it("a clip that plays instead of a track silences that track over its own span only, while its own track is heard and it has a chord", () => {
    const s = songOf([chordsTrack("tc", "Chords", { lead: true }), chordsTrack("th", "Harmony")], { clips: [chordsClip("c1", "tc", 0, 16), chordsClip("h1", "th", 4, 8, { instead: "tc" })] });
    const of = (song: TimelineSong, track: string) => flatten(song, ctx).items[0].extra!.chords.filter((c) => c.track === track).map((c) => c.at);
    expect(of(s, "tc")).toEqual([0, 12]);
    expect(of(s, "th")).toEqual([4, 8]);
    // the grid is the lead track's all the same
    expect(shape(flatten(s, ctx))).toBe("4 4 4 4");
    // its track muted in the mixer: the chords it replaced are heard again
    expect(of({ ...s, mix: { th: { mute: true } } }, "tc")).toEqual([0, 4, 8, 12]);
    // nothing but rests in it: it replaces nothing
    const rests = chordsContent(2, undefined, [{ ...chord("r", "C", 8), rest: true }]);
    expect(of({ ...s, clips: s.clips.map((c) => (c.id === "h1" ? { ...c, content: rests } : c)) } as TimelineSong, "tc")).toEqual([0, 4, 8, 12]);
    // part-way through a chord: the chord is cut where the span starts, and what is left of it comes back where the span ends
    const half = songOf(s.tracks, { clips: [chordsClip("c1", "tc", 0, 8, { content: chordsContent(2, undefined, [chord("x", "C", 8)]) }), chordsClip("h1", "th", 2, 4, { instead: "tc", content: chordsContent(1) })] });
    expect(flatten(half, ctx).items[0].extra!.chords.filter((c) => c.track === "tc").map((c) => [c.at, c.beats])).toEqual([[0, 2], [6, 2]]);
  });
});

describe("where a clip's playing style counts from", () => {
  /** drums over bars 1 to 4 (one stretch), chords from bar 2 for two bars and on bar 4, and a second chords track from bar 1 */
  const late = (): TimelineSong =>
    songOf([chordsTrack("tc", "Chords", { lead: true }), chordsTrack("t2", "Chords 2"), drumsTrack("td", "Drums", { lead: true })], {
      clips: [chordsClip("c1", "tc", 4, 8), chordsClip("c2", "tc", 12, 4), chordsClip("e1", "t2", 0, 16), drumsClip("d1", "td", 0, 16)],
    });
  it("every chord of a clip carries the clip's start as `from`, counted like `at` from the stretch's start", () => {
    const f = flatten(late(), ctx);
    expect(new Set(f.origin)).toEqual(new Set([0]));
    const chords = f.items[0].extra!.chords;
    expect(chords.filter((c) => c.track === "tc").map((c) => [c.at, c.from])).toEqual([[4, 4], [8, 4], [12, 12]]);
    expect(chords.filter((c) => c.track === "t2").map((c) => [c.at, c.from])).toEqual([[0, 0], [4, 0], [8, 0], [12, 0]]);
  });
  it("in every song: each chord's `from` is the start of the clip it comes from", () => {
    for (const song of [late(), mixedSong(), bandSong()]) {
      const f = flatten(song, ctx);
      let seen = 0;
      f.items.forEach((item, i) => {
        for (const c of item.extra?.chords ?? []) {
          const at = f.origin[i] + c.at;
          const clip = song.clips.find((x) => x.kind === "chords" && x.track === c.track && x.start <= at + 1e-9 && x.start + x.len > at + 1e-9)!;
          expect(c.from).toBeDefined();
          expect(f.origin[i] + c.from!).toBeCloseTo(clip.start - clip.off, 9);
          seen++;
        }
      });
      expect(seen).toBeGreaterThan(0);
    }
  });
  it("a clip that runs on over a cut counts from its start in the next stretch too: from before that stretch", () => {
    // 6/8 from bar 3: the clip (written in 4/4) crosses the change, and is cut there
    const s = songOf([chordsTrack("tc", "Chords", { lead: true })], { sigs: [{ bar: 2, sig: SIG68 }], clips: [chordsClip("c1", "tc", 4, 8)] });
    const f = flatten(s, ctx);
    const second = itemAt(f, 8);
    expect(f.origin[f.at.indexOf(8)]).toBe(8);
    expect(second.extra!.chords.map((c) => [c.at, c.from])).toEqual([[0, -4]]);
  });
  it("the second piece of a split clip, and a clip whose left edge was moved, count from where their content starts: what was heard stays", () => {
    const whole = late();
    const split = splitClips(whole, ["c1"], 8, counter());
    expect(split.clips.filter((c) => c.track === "tc").map((c) => [c.start, c.off])).toEqual([[4, 0], [8, 4], [12, 0]]);
    const of = (song: TimelineSong) => flatten(song, ctx).items[0].extra!.chords.filter((c) => c.track === "tc").map((c) => [c.at, c.beats, c.from]);
    expect(of(split)).toEqual(of(whole));
    // its left edge pulled in by a bar: the chord that is left counts as it did
    const trimmed = resizeClip(whole, "c1", "left", 8);
    expect(of(trimmed)).toEqual(of(whole).filter(([at]) => at !== 4));
  });
  it("heard: a style two bars long on a clip that starts on bar 2 of its stretch starts with the clip, as it does on a clip at the start", async () => {
    const clave = (start: number) => chordsClip("c1", "tc", start, 8, { content: { ...chordsContent(2), style: "clave" } });
    const tracks = [chordsTrack("tc", "Chords", { lead: true }), drumsTrack("td", "Drums", { lead: true })];
    // (a drums clip with no hits over bars 1 to 3 keeps them one stretch)
    const quiet = drumsClip("d1", "td", 0, 12, { content: { ...groove(3), rows: emptyRows(48) } });
    const atBar2 = songOf(tracks, { clips: [clave(4), quiet] });
    const atBar1 = songOf(tracks, { clips: [clave(0), quiet] });
    expect(new Set(flatten(atBar2, ctx).origin)).toEqual(new Set([0]));
    const spb = 60 / atBar2.bpm;
    const notes = async (song: TimelineSong, shift: number) =>
      (await renderLog(flatten(song, ctx).items, song.bpm)).notes.filter((n) => n.track === "tc").map((n) => `${n.midi}@${(n.when / spb - shift).toFixed(3)}`).sort();
    const a = await notes(atBar2, 4);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(await notes(atBar1, 0));
  });
});

describe("melodies and basses", () => {
  const over = (clips: TimelineSong["clips"]) => songOf([chordsTrack("tc", "Chords", { lead: true }), tuneTrack("tm"), tuneTrack("tb", "bass")], { clips: [chordsClip("c1", "tc", 0, 16), ...clips] });
  const tuneOf = (s: TimelineSong, track: string) => flatten(s, ctx).items[0].extra!.tunes.find((t) => t.track === track)!.tune;
  it("the notes of every round, in twelfths of a beat from the stretch's start; the last note of a clip that ends early is held to the clip's end", () => {
    const s = over([melodyClip("m1", "tm", 0, 8, { content: tune(2, [[0, 64], [6, 67]]) })]);
    const t = tuneOf(s, "tm");
    expect(t.m).toEqual({ div: 4, bars: 4, notes: [{ at: 0, midi: 64 }, { at: 72, midi: 67, len: 24 }] });
    expect(t.bar).toBe(4);
    expect(t.swing).toBe(0);
    // the same clip dragged out to four bars: the notes come round again, and none needs a length (the clip ends with the stretch)
    const twice = over([melodyClip("m1", "tm", 0, 16, { content: tune(2, [[0, 64], [6, 67]]) })]);
    expect(tuneOf(twice, "tm").m.notes).toEqual([{ at: 0, midi: 64 }, { at: 72, midi: 67 }, { at: 96, midi: 64 }, { at: 168, midi: 67 }]);
  });
  it("a clip opened part-way into its content, two clips on one track, and a note with a length of its own", () => {
    const s = over([
      melodyClip("m1", "tm", 0, 4, { off: 4, content: tune(2, [[0, 60], [5, 62]]) }),
      melodyClip("m2", "tm", 8, 8, { content: { div: 2, bars: 2, notes: [{ at: 12, midi: 72, len: 6 }, { at: 48, midi: 74 }] } }),
    ]);
    // m1 shows beats 4–8 of its content at the song's start: only the note on content beat 5, at song beat 1; held to m1's end (beat 4)
    expect(tuneOf(s, "tm").m.notes).toEqual([{ at: 12, midi: 62, len: 36 }, { at: 108, midi: 72, len: 6 }, { at: 144, midi: 74 }]);
  });
  it("a bass track is a melody like any other, and a track with no notes in the stretch is not listed", () => {
    const s = over([melodyClip("b1", "tb", 0, 16, { content: tune(4, [[0, 36]]) }), melodyClip("m1", "tm", 0, 16, { content: tune(4) })]);
    expect(flatten(s, ctx).items[0].extra!.tunes.map((t) => t.track)).toEqual(["tb"]);
  });
});

describe("drums", () => {
  /** a four-bar rhythm with a snare on the first beat of its second bar, shown from its second bar for two bars, at bar 2 of the song */
  const drums = (): TimelineSong => songOf([chordsTrack("tc", "Chords", { lead: true }), drumsTrack("td", "Drums", { lead: true })], { clips: [chordsClip("c1", "tc", 0, 16), drumsClip("d1", "td", 4, 8, { off: 4, content: groove(4, SIG44, 1) })] });
  it("the rhythm is written out step by step over the stretch: each round in its place, silence elsewhere, on the track's kit", () => {
    const f = flatten(drums(), ctx);
    const { beat, track } = f.items[0].extra!.drums[0];
    expect(track).toBe("td");
    expect(beat).toMatchObject({ on: true, steps: 16, div: 4, bars: 4, swing: 0, kit: "box" });
    const bar = "2000200020002000";
    expect(beat.rows.kick).toBe("0".repeat(16) + bar + bar + "0".repeat(16));
    // the snare of the content's second bar is the first thing heard, on the song's fifth beat
    expect(beat.rows.snare).toBe("0".repeat(16) + "3" + "0".repeat(47));
    expect(Object.values(beat.rows).every((r) => r.length === 64)).toBe(true);
  });
  it("the same beat object comes back while its clips and its kit are the same objects, and only what an edit touched is made again", () => {
    const s = drums();
    const a = flatten(s, ctx);
    expect(flatten(s, ctx).items).toEqual(a.items);
    expect(flatten(s, ctx).items[0]).toBe(a.items[0]);
    // a chord changed on another track: the drums' beat is the same object, the chords are new
    const edited: TimelineSong = { ...s, clips: s.clips.map((c) => (c.id === "c1" ? { ...c, content: chordsContent(4, undefined, [chord("z", "D", 16)]) } : c)) } as TimelineSong;
    const b = flatten(edited, ctx);
    expect(b.items[0].extra!.drums[0].beat).toBe(a.items[0].extra!.drums[0].beat);
    expect(b.items[0].extra!.drums[0]).toBe(a.items[0].extra!.drums[0]);
    expect(b.items[0].extra!.chords).not.toBe(a.items[0].extra!.chords);
    // a kit knob moved: a new beat
    const knob: TimelineSong = { ...s, tracks: s.tracks.map((t) => (t.kind === "drums" ? { ...t, kit: { ...t.kit, space: 0.9 } } : t)) };
    expect(flatten(knob, ctx).items[0].extra!.drums[0].beat).not.toBe(a.items[0].extra!.drums[0].beat);
    expect(flatten(knob, ctx).items[0].extra!.drums[0].beat.space).toBe(0.9);
  });
  it("a stretch another edit did not touch keeps its very items", () => {
    const s = mixedSong();
    const a = flatten(s, ctx);
    // a chord of the last stretch changed (the song's first two stretches are as they were)
    const edited: TimelineSong = { ...s, clips: s.clips.map((c) => (c.id === "c3" ? { ...c, content: chordsContent(4, undefined, [chord("z", "D", 16)]) } : c)) } as TimelineSong;
    const b = flatten(edited, ctx);
    expect(b.items[0]).toBe(a.items[0]);
    expect(itemAt(b, 32)).toBe(itemAt(a, 32));
    expect(itemAt(b, 40)).not.toBe(itemAt(a, 40));
  });
  it("a muted drums clip is not played; a rhythm with no hits still makes a beat (the others follow its swing)", () => {
    const s = drums();
    expect(flatten({ ...s, clips: s.clips.map((c) => (c.id === "d1" ? { ...c, mute: true } : c)) }, ctx).items[0].extra!.drums).toEqual([]);
    const empty: Groove = { ...groove(1, SIG44), rows: emptyRows(16), swing: 0.5 };
    const f = flatten({ ...s, clips: s.clips.map((c) => (c.id === "d1" ? { ...c, start: 0, len: 16, off: 0, content: empty } : c)) } as TimelineSong, ctx);
    expect(f.items[0].extra!.drums[0].beat.rows.kick).toBe("0".repeat(64));
    expect(f.items[0].meter).toMatchObject({ swing: 0.5 });
  });
});

describe("recorded takes", () => {
  // 120 beats a minute: a beat is half a second, so a take of four seconds is eight beats long
  const k1 = take("k1", 4, 0);
  const k2 = take("k2", 4, 0);
  const sung = (clips: AudioClip[], o: Partial<TimelineSong> = {}) => songOf([audioTrack("tv", "vocals", "Vocal 1", [k1, k2])], { bpm: 120, clips, ...o });
  /** every take listed, in every stretch that lists it, with the song beat it starts on */
  const listed = (f: Flat) => f.items.flatMap((x, i) => (x.extra?.takes ?? []).map((k) => ({ id: k.id, start: f.origin[i] + k.at, offset: k.offset, dur: k.dur, joined: !!k.joined, buffer: label(k.buffer), stretch: f.origin[i] })));
  it("a clip dragged out past its take plays the take again: the first round has the clip's id, the next `#1`, and neither is joined", () => {
    const f = flatten(sung([audioClip("a1", "tv", k1, 0, { frames: 288000 })]), ctx);
    const all = listed(f);
    const once = (id: string) => all.find((k) => k.id === id)!;
    expect(once("a1")).toMatchObject({ start: 0, offset: 0, dur: 4, joined: false, buffer: "k1" });
    expect(once("a1#1")).toMatchObject({ start: 8, offset: 0, dur: 2, joined: false });
    // each is listed in every stretch it reaches, counted from that stretch's start (before it, after the first)
    expect(all.filter((k) => k.id === "a1").map((k) => k.stretch)).toEqual([0, 4]);
    expect(all.filter((k) => k.id === "a1#1").map((k) => k.stretch)).toEqual([8]);
    expect(itemAt(f, 4).extra!.takes!.find((k) => k.id === "a1")!.at).toBe(-4);
  });
  it("the second piece of a split is joined to the first: one sound, with no fade between", () => {
    const f = flatten(sung([audioClip("b1", "tv", k1, 16, { frames: 96000 }), audioClip("b2", "tv", k1, 20, { off: 96000, frames: 96000 })]), ctx);
    const all = listed(f);
    expect(all.find((k) => k.id === "b1")).toMatchObject({ start: 16, offset: 0, dur: 2, joined: false });
    expect(all.find((k) => k.id === "b2")).toMatchObject({ start: 20, offset: 2, dur: 2, joined: true });
    // moved apart, they are two sounds again
    const apart = flatten(sung([audioClip("b1", "tv", k1, 16, { frames: 96000 }), audioClip("b2", "tv", k1, 24, { off: 96000, frames: 96000 })]), ctx);
    expect(listed(apart).find((k) => k.id === "b2")!.joined).toBe(false);
  });
  it("a clip that runs into the next clip on its track (after a change of tempo) is cut where that one starts", () => {
    const f = flatten(sung([audioClip("c1", "tv", k1, 32), audioClip("c2", "tv", k2, 36)]), ctx);
    const all = listed(f);
    expect(all.find((k) => k.id === "c1")).toMatchObject({ start: 32, dur: 2 });
    expect(all.find((k) => k.id === "c2")).toMatchObject({ start: 36, dur: 4, buffer: "k2" });
  });
  it("a take that is not loaded yet, a muted clip and a clip of a take that is gone are not listed", () => {
    const none: FlattenCtx = { voicingsOf, buffer: () => undefined };
    expect(flatten(sung([audioClip("a1", "tv", k1, 0)]), none).any).toBe(false);
    expect(flatten(sung([audioClip("a1", "tv", k1, 0, { mute: true })]), ctx).any).toBe(false);
    expect(flatten(sung([audioClip("a1", "tv", k1, 0, { take: "gone" })]), ctx).any).toBe(false);
    expect(flatten(sung([audioClip("a1", "tv", k1, 0)]), ctx).any).toBe(true);
  });
});

describe("a range of the song", () => {
  /** lead chords, one to the bar, in two clips of four bars: two stretches */
  const two = (): TimelineSong => songOf([chordsTrack("tc", "Chords", { lead: true })], { clips: [chordsClip("c1", "tc", 0, 16), chordsClip("c2", "tc", 16, 16)] });
  it("with no range the list is the whole song", () => {
    const f = flatten(two(), ctx);
    expect(f.at).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(f.items.some((x) => x.from !== undefined || x.jump)).toBe(false);
  });
  it("each span's first item says where in its stretch it starts; the first item of each later span also says the music jumps", () => {
    const s = two();
    const f = flatten(s, ctx, { spans: [{ from: 4, to: 12 }, { from: 20, to: 28 }], loop: true });
    expect(f.loop).toBe(true);
    expect(f.at).toEqual([4, 8, 20, 24]);
    expect(f.origin).toEqual([0, 0, 16, 16]);
    expect(f.items.map((x) => [!!x.section, x.from, !!x.jump])).toEqual([[true, 4, false], [false, undefined, false], [true, 4, true], [false, undefined, false]]);
    expect(f.items.filter((x) => x.jump).length).toBe(1);
    expect(songBeat(f, { index: 2, beat: 5 })).toBe(21);
    // what rides on the items is the whole stretch's: the engine cuts it to the run it plays
    expect(f.items[0].extra).toBe(flatten(s, ctx).items[0].extra);
  });
  it("a span across two stretches: the second stretch starts as it always does, with no jump", () => {
    const s = two();
    const f = flatten(s, ctx, { spans: [{ from: 12, to: 20 }], loop: true });
    expect(f.at).toEqual([12, 16]);
    expect(f.items.map((x) => [!!x.section, x.from, !!x.jump])).toEqual([[true, 12, false], [true, undefined, false]]);
    // the untouched item is the very item of the whole list
    expect(f.items[1]).toBe(itemAt(flatten(s, ctx), 16));
  });
  it("a span that starts inside a chord cuts it there", () => {
    const f = flatten(two(), ctx, { spans: [{ from: 6, to: 12 }], loop: false });
    expect(f.at).toEqual([6, 8]);
    expect(f.items.map((x) => x.beats)).toEqual([2, 4]);
    expect(f.items[0].from).toBe(6);
  });
  it("`cut` makes an item start on that beat and gives it `from`, counted from its stretch's start: where a loop is entered part-way", () => {
    const whole = { spans: [{ from: 0, to: 32 }], loop: true };
    const f = flatten(two(), ctx, { ...whole, cut: 22 });
    expect(f.at).toEqual([0, 4, 8, 12, 16, 20, 22, 24, 28]);
    const i = f.at.indexOf(22);
    expect(f.items[i - 1].beats).toBe(2);
    expect(f.items[i]).toMatchObject({ beats: 2, from: 6 });
    expect(f.items[i].section).toBeUndefined();
    expect(f.origin[i]).toBe(16);
    // the list is as long as it was
    expect(f.items.reduce((a, x) => a + x.beats, 0)).toBe(32);
    // on a beat where an item starts already: that item gets `from`, and nothing is cut
    const on = flatten(two(), ctx, { ...whole, cut: 8 });
    expect(on.at).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(on.items[2].from).toBe(8);
    expect(on.items[3].from).toBeUndefined();
  });
});

describe("bypass: a track heard without its effects", () => {
  it("a chords or melody track plays a sound with every effect at nothing; a drums track its kit the same way; a recorded track its takes as they were sung", () => {
    const k = take("k1", 4, 0);
    const s = songOf(
      [chordsTrack("tc", "Chords", { lead: true, sound: { space: 0.8, echo: 0.5, drive: 0.4, voice: "nylon" } }), tuneTrack("tm", "melody", "Melody", { sound: { chorus: 0.6 } }), drumsTrack("td", "Drums", { lead: true }), audioTrack("tv", "vocals", "Vocal 1", [k])],
      { bpm: 120, clips: [chordsClip("c1", "tc", 0, 16), melodyClip("m1", "tm", 0, 16), drumsClip("d1", "td", 0, 16), audioClip("a1", "tv", k, 0)] },
    );
    const plain = flatten(s, ctx).items[0].extra!;
    expect(plain.chords[0].sound).toMatchObject({ space: 0.8, echo: 0.5, drive: 0.4, voice: "nylon" });
    expect(label(plain.takes![0].buffer)).toBe("k1");
    const dry = flatten(s, { ...ctx, bypass: new Set(["tc", "tm", "td", "tv"]) }).items[0].extra!;
    expect(dry.chords[0].sound).toMatchObject({ space: 0, echo: 0, drive: 0, chorus: 0, voice: "nylon" });
    expect(dry.chords[0].sound).toBe(drySound(plain.chords[0].sound));
    expect(dry.tunes[0].tune.sound).toMatchObject({ chorus: 0, space: 0 });
    expect(dry.drums[0].beat).toMatchObject({ space: 0, grit: 0, glue: 0, noise: "off", sampler: "off" });
    // every effect amount of the kit is at nothing; the machine, each drum's own sound and the drum mixer stay
    expect(dry.drums[0].beat).toMatchObject({ echo: 0, tape: 0, tone: 0, human: 0, pump: 0 });
    expect([dry.drums[0].beat.kit, dry.drums[0].beat.sounds, dry.drums[0].beat.level]).toEqual([plain.drums[0].beat.kit, plain.drums[0].beat.sounds, plain.drums[0].beat.level]);
    for (const k of ["drive", "squeeze", "tone", "chorus", "phaser", "trem", "wobble", "echo", "space", "shimmer"] as const) expect(dry.chords[0].sound[k], k).toBe(0);
    expect(dry.chords[0].sound.level).toBe(plain.chords[0].sound.level);
    expect(dry.drums[0].beat.rows).toEqual(plain.drums[0].beat.rows);
    expect(label(dry.takes![0].buffer)).toBe("k1:dry");
    // only the tracks named
    const one = flatten(s, { ...ctx, bypass: new Set(["tm"]) }).items[0].extra!;
    expect(one.chords[0].sound).toBe(plain.chords[0].sound);
    expect(one.tunes[0].tune.sound).toMatchObject({ chorus: 0 });
  });
  it("equal sounds are the same object from item to item and from call to call (one voice to a track)", () => {
    const s = mixedSong();
    const f = flatten(s, ctx);
    const sounds = new Set(f.items.flatMap((x) => x.extra!.chords.map((c) => c.sound)));
    const tones = new Set(f.items.flatMap((x) => x.extra!.chords.map((c) => c.tone)));
    expect(sounds.size).toBe(1);
    expect(tones.size).toBe(1);
    expect(flatten({ ...s, bpm: 100 }, ctx).items[0].extra!.chords[0].sound).toBe([...sounds][0]);
  });
});
