import { describe, expect, it } from "vitest";
import type { ProgChord, Progression } from "../ui/state";
import type { Key } from "../theory/keys";
import { keyScale, transposeRef } from "../theory/keys";
import { pc } from "../theory/notes";
import { scalePcs } from "../theory/scales";
import { TICKS, melodyBase, transposeMelody, type Melody } from "./melody";
import { addNewSection, loadCurrent, mapAllChords, mapAllMelodies, removeBlock, sections, selectBlock, unlinkBlock, type Song } from "./structure";
import { addTrack, focusTrack, normalize, removeTrack, reviveTracks } from "./tracks";
import { setSig } from "./unity";
import { HARMONY_DB, MELODY_RANGE, addHarmony, harmonyMenu, harmonyState, harmonySources, isHarmony, previewHarmony, rewriteHarmony, writtenAs } from "./harmony";
import { reviveIdea, sameMusic } from "./library";
import { copySection, pasteSection, reviveClips, undoFits } from "./clip";
import { keysVoicings, reviveTones } from "../audio/tone";

const C: Key = { tonic: "C", scaleId: "ionian" };
const Em: Key = { tonic: "E", scaleId: "aeolian" };
let n = 0;
const id = () => `id${++n}`;
const ch = (root: string, beats: number, typeId = "maj"): ProgChord => ({ id: `${root}${++n}`, ref: { root, typeId }, beats });
/** A tune: one note per beat, walking the given notes. */
const tune = (midis: number[], step = TICKS): Melody => ({ div: 2, bars: 4, notes: midis.map((midi, i) => ({ at: i * step, midi })) });

/**
 * A song of four sections: A in 4/4 (4 bars), B in 6/8 (2 bars), C in 3/4 (3 bars) and D with
 * chords but no tune. A plays twice (it is one section, written once).
 */
function song(key: Key = C): Progression {
  const major = key.scaleId === "ionian";
  const A = { id: "A", bars: 4, chords: major ? [ch("C", 4), ch("G", 4), ch("A", 4, "min"), ch("F", 4)] : [ch("E", 4, "min"), ch("C", 4), ch("G", 4), ch("D", 4)], melody: tune(major ? [64, 65, 67, 67, 67, 69, 67, 64, 65, 64, 62, 60, 65, 69, 72, 69] : [67, 66, 64, 67, 64, 67, 71, 67, 67, 71, 74, 71, 69, 66, 62, 66]) };
  // 6/8: two beats to a bar, each in three: notes on the triplet grid
  const B = { id: "B", bars: 2, meter: { num: 6, den: 8 as const }, chords: major ? [ch("F", 2), ch("G", 2)] : [ch("C", 2), ch("D", 2)], melody: { div: 3 as const, bars: 2, notes: (major ? [65, 64, 65, 69, 67, 65, 67, 71, 74, 72, 71, 67] : [64, 66, 67, 64, 66, 69, 66, 69, 74, 72, 69, 66]).map((midi, i) => ({ at: i * 4, midi })) } };
  const Cc = { id: "C", bars: 3, meter: { num: 3, den: 4 as const }, chords: major ? [ch("A", 3, "min"), ch("D", 3, "min"), ch("G", 3)] : [ch("A", 3, "min"), ch("B", 3, "min"), ch("E", 3, "min")], melody: tune(major ? [72, 71, 69, 65, 64, 62, 67, 65, 62] : [72, 71, 69, 66, 64, 62, 71, 69, 67]) };
  const D = { id: "D", bars: 2, chords: major ? [ch("F", 4), ch("C", 4)] : [ch("C", 4), ch("E", 4, "min")] };
  const s: Song = { parts: [A, B, Cc, D], blocks: [{ id: "a", partId: "A" }, { id: "b", partId: "B" }, { id: "c", partId: "C" }, { id: "d", partId: "D" }, { id: "a2", partId: "A" }], current: "a" };
  return loadCurrent({ chords: [], bpm: 90, pattern: "ring", loop: true, bars: 4, meter: { num: 4, den: 4 }, song: s });
}
const parts = (p: Progression) => normalize(p).song!.parts;
const layer = (p: Progression, part: string, tid: string) => parts(p).find((x) => x.id === part)?.layers?.[tid];
const len = (p: Progression, part: string) => {
  const x = parts(p).find((y) => y.id === part)!;
  const bar = x.meter ? (x.meter.den === 8 ? x.meter.num / 3 : x.meter.num) : 4;
  return x.bars! * bar;
};
const inKey = (midi: number, key: Key) => scalePcs(pc(key.tonic), keyScale(key)).includes(((midi % 12) + 12) % 12);

describe("a harmony track across the song", () => {
  for (const key of [C, Em]) {
    it(`third above in ${key.tonic} ${key.scaleId}: every section with a tune gets one, in key, on its grid, in range, nothing lost`, () => {
      const p0 = song(key);
      const { p, track } = addHarmony(p0, key, { kind: "melody", from: "melody", option: "third-above" }, "h1");
      expect(track).toMatchObject({ id: "h1", kind: "melody", role: "harmony", name: "Third above", harmony: { from: "melody", option: "third-above" } });
      for (const part of ["A", "B", "C"]) {
        const m = layer(p, part, "h1")?.melody;
        const src = parts(p).find((x) => x.id === part)!.melody!;
        expect(m, part).toBeDefined();
        // a note of harmony for every note of the tune, at the same moment
        expect(new Set(m!.notes.map((x) => x.at))).toEqual(new Set(src.notes.map((x) => x.at)));
        for (const x of m!.notes) {
          expect(inKey(x.midi, key), `${part} ${x.midi}`).toBe(true);
          expect(x.midi).toBeGreaterThanOrEqual(MELODY_RANGE.lo);
          expect(x.midi).toBeLessThanOrEqual(MELODY_RANGE.hi);
          expect(x.at % (TICKS / m!.div)).toBe(0);
          expect(x.at).toBeLessThan(len(p, part) * TICKS);
        }
        expect(m!.bars).toBe(parts(p).find((x) => x.id === part)!.bars);
      }
      // 6/8 stays on the triplet grid
      expect(layer(p, "B", "h1")!.melody!.div).toBe(3);
      // D has no tune: nothing is written there
      expect(layer(p, "D", "h1")).toBeUndefined();
      // the new track comes forward on the Melody page, and the first melody is kept safe
      expect(p.focus).toEqual({ melody: "h1" });
      expect(p.melody).toEqual(layer(p, "A", "h1")!.melody);
    });
  }

  it("is the same every time for the same song and track", () => {
    const p0 = song();
    for (const option of ["counter", "answer", "slow-line"]) {
      const a = addHarmony(p0, C, { kind: "melody", from: "melody", option }, "h1").p;
      const b = addHarmony(p0, C, { kind: "melody", from: "melody", option }, "h1").p;
      expect(JSON.stringify(normalize(a))).toBe(JSON.stringify(normalize(b)));
    }
    for (const option of ["relative", "lead-in"]) {
      const a = addHarmony(p0, C, { kind: "chords", from: "chords", option }, "h1").p;
      expect(JSON.stringify(normalize(a))).toBe(JSON.stringify(normalize(addHarmony(p0, C, { kind: "chords", from: "chords", option }, "h1").p)));
    }
  });

  it("a pad from the chords: the same changes in every section, held high on the synth, never longer than a chord can be", () => {
    // eight bars of one chord: the pad joins them, and is struck again within the Chords page's 16 beats
    let p0 = song();
    p0 = { ...normalize(p0), song: { ...p0.song!, parts: p0.song!.parts.map((x) => (x.id === "D" ? { ...x, bars: 8, chords: Array.from({ length: 8 }, () => ch("F", 4)) } : x)) } };
    p0 = loadCurrent(p0);
    const { p } = addHarmony(p0, C, { kind: "chords", from: "chords", option: "pad" }, "pad");
    for (const part of ["A", "B", "C", "D"]) {
      const cs = layer(p, part, "pad")!.chords!;
      const total = cs.reduce((a, c) => a + c.beats, 0);
      expect(total, part).toBe(len(p, part));
      for (const c of cs) {
        expect(c.beats).toBeGreaterThanOrEqual(0.5);
        expect(c.beats).toBeLessThanOrEqual(16);
        expect(c.beats * 2).toBe(Math.round(c.beats * 2));
      }
    }
    expect(layer(p, "D", "pad")!.chords!.length).toBeGreaterThan(1);
    expect(p.tones?.pad).toMatchObject({ inst: "synth", register: "high", voicing: "close" });
    // the pad's keys sit above the comping band
    const keys = keysVoicings(layer(p, "A", "pad")!.chords!, p.tones!.pad).flat();
    expect(Math.min(...keys)).toBeGreaterThanOrEqual(55);
    expect(p.focus).toEqual({ chords: "pad" });
  });

  it("a shell goes to the piano in its voicing; a re-harmonisation takes its source's instrument and mutes the source", () => {
    const shell = addHarmony(song(), C, { kind: "chords", from: "chords", option: "shell" }, "s").p;
    expect(shell.tones?.s).toEqual({ inst: "piano", voicing: "shell" });
    const p0 = { ...song(), tones: { chords: { inst: "piano" as const, keys: "electric" as const } } };
    const lead = addHarmony(p0, C, { kind: "chords", from: "chords", option: "lead-in" }, "l").p;
    expect(lead.tones?.l).toEqual({ inst: "piano", keys: "electric" });
    expect(lead.mix?.chords?.mute).toBe(true);
    // a melody harmony sings on its tune's instrument
    const tuneOnSynth = { ...song(), tones: { melody: { inst: "synth" as const } } };
    expect(addHarmony(tuneOnSynth, C, { kind: "melody", from: "melody", option: "sixth-below" }, "x").p.tones?.x).toEqual({ inst: "synth" });
  });

  it("a chords layer from a melody sits on the section's chords; a melody from chords works where there is no tune", () => {
    const { p } = addHarmony(song(), C, { kind: "chords", from: "melody", option: "colour" }, "col");
    // A's chords keep their roots and changes, with colour added
    expect(layer(p, "A", "col")!.chords!.map((c) => c.ref.root)).toEqual(["C", "G", "A", "F"]);
    expect(layer(p, "D", "col")).toBeUndefined();
    const fromChords = addHarmony(song(), C, { kind: "melody", from: "chords", option: "slow-line" }, "sl").p;
    expect(layer(fromChords, "D", "sl")!.melody!.notes.length).toBeGreaterThan(0);
  });

  it("keeps where it came from through saving and loading; old songs and broken data load safely", () => {
    const { p } = addHarmony(song(), C, { kind: "melody", from: "melody", option: "third-below" }, "h1");
    const saved = JSON.parse(JSON.stringify({ id: "i", name: "x", key: C, progression: normalize(p), savedAt: 1 }));
    const back = reviveIdea(saved)!.progression;
    const t = back.tracks!.find((x) => x.id === "h1")!;
    expect(t.role).toBe("harmony");
    expect(t.harmony).toEqual(p.tracks!.find((x) => x.id === "h1")!.harmony);
    expect(layer(back, "B", "h1")).toEqual(layer(p, "B", "h1"));
    expect(harmonyState(back, C, "h1")).toEqual({ edited: [], stale: false, source: true });
    // an older song: a harmony track with no source; broken or unknown harmony data is dropped
    expect(reviveTracks([{ id: "o", kind: "melody", name: "Old", role: "harmony" }])).toEqual([{ id: "o", kind: "melody", name: "Old", role: "harmony" }]);
    expect(reviveTracks([{ id: "o", kind: "melody", name: "Old", harmony: { from: "melody", option: "pad" } }])![0].harmony).toBeUndefined();
    expect(reviveTracks([{ id: "o", kind: "melody", name: "Old", harmony: { from: "gone", option: "octave" } }])![0].harmony).toBeUndefined();
    expect(reviveTracks([{ id: "o", kind: "melody", name: "Old", harmony: { from: "o", option: "octave" } }])![0].harmony).toBeUndefined();
    expect(reviveTracks([{ id: "o", kind: "drums", name: "D", harmony: { from: "melody", option: "octave" } }])![0].harmony).toBeUndefined();
    expect(reviveTracks([{ id: "o", kind: "melody", name: "M", harmony: { from: "melody", option: "octave", marks: { A: { src: 1, out: "x" }, B: { src: "a", out: "b" } } } }])![0].harmony).toEqual({ from: "melody", option: "octave", marks: { B: { src: "a", out: "b" } } });
    // a keyboard pad's register is kept
    expect(reviveTones({ x: { inst: "piano", register: "high" }, y: { inst: "piano", register: "mid" } }, ["x", "y"])).toEqual({ x: { inst: "piano", register: "high" }, y: { inst: "piano" } });
  });

  it("re-writes with another option, keeps its name in step, and can be put back exactly", () => {
    const p1 = addHarmony(song(), C, { kind: "melody", from: "melody", option: "third-above" }, "h1").p;
    const p2 = rewriteHarmony(p1, C, "h1", "sixth-below");
    const t = p2.tracks!.find((x) => x.id === "h1")!;
    expect(t.name).toBe("Sixth below");
    expect(t.harmony!.option).toBe("sixth-below");
    expect(layer(p2, "A", "h1")).not.toEqual(layer(p1, "A", "h1"));
    // the page keeps editing the same track, now holding the new line
    expect(p2.focus).toEqual({ melody: "h1" });
    expect(p2.melody).toEqual(layer(p2, "A", "h1")!.melody);
    // back to the first option: the same notes as before
    expect(sameMusic(rewriteHarmony(p2, C, "h1", "third-above"), p1)).toBe(true);
    // a renamed track keeps its name
    const named = { ...p1, tracks: p1.tracks!.map((x) => ({ ...x, name: "High" })) };
    expect(rewriteHarmony(named, C, "h1", "octave").tracks![0].name).toBe("High");
  });

  it("knows which sections were changed by hand, and when its source changed", () => {
    const p1 = addHarmony(song(), C, { kind: "melody", from: "melody", option: "third-above" }, "h1").p;
    expect(harmonyState(p1, C, "h1")).toEqual({ edited: [], stale: false, source: true });
    // a note changed by hand in section A (on the page, as the Melody grid does)
    const edited = { ...p1, melody: { ...p1.melody!, notes: [...p1.melody!.notes.slice(1), { at: 1 * TICKS, midi: 84 }] } };
    expect(harmonyState(edited, C, "h1").edited).toEqual(["A"]);
    expect(harmonyState(edited, C, "h1").stale).toBe(false);
    // the tune in C changed: the harmony is out of date there (and nowhere was it changed by hand)
    let q = selectBlock(focusTrack(p1, "melody", "melody"), "c");
    q = { ...q, melody: { ...q.melody!, notes: q.melody!.notes.map((x, i) => (i === 0 ? { ...x, midi: 74 } : x)) } };
    expect(harmonyState(q, C, "h1")).toEqual({ edited: [], stale: true, source: true });
    // written again from the new tune: in step again
    const r = rewriteHarmony(q, C, "h1");
    expect(harmonyState(r, C, "h1")).toEqual({ edited: [], stale: false, source: true });
    expect(layer(r, "C", "h1")).not.toEqual(layer(p1, "C", "h1"));
    expect(layer(r, "A", "h1")).toEqual(layer(p1, "A", "h1"));
    // a new key makes it out of date too
    expect(harmonyState(p1, { tonic: "D", scaleId: "ionian" }, "h1").stale).toBe(true);
    // a pad on the chords does not care that the tune changed (only what it would write counts)
    const pad = addHarmony(p1, C, { kind: "chords", from: "chords", option: "pad" }, "pad").p;
    let q2 = selectBlock(focusTrack(pad, "melody", "melody"), "c");
    q2 = { ...q2, melody: { ...q2.melody!, notes: q2.melody!.notes.map((x, i) => (i === 0 ? { ...x, midi: 74 } : x)) } };
    expect(harmonyState(q2, C, "pad").stale).toBe(false);
    expect(harmonyState(q2, C, "h1").stale).toBe(true);
  });

  it("can be undone: the song before it was added is the song after it is taken away", () => {
    const p0 = song();
    const p1 = addHarmony(p0, C, { kind: "chords", from: "chords", option: "borrowed" }, "b").p;
    // the source was muted for the re-harmonisation; taking it away lets the source be heard again
    expect(p1.mix?.chords?.mute).toBe(true);
    expect(removeTrack(p1, "b").mix?.chords?.mute).toBe(false);
    const p2 = addHarmony(p0, C, { kind: "chords", from: "chords", option: "higher" }, "h").p;
    expect(sameMusic(removeTrack(p2, "h"), p0)).toBe(true);
    // switching a layer to a swap mutes the source, and back unmutes it
    const swap = rewriteHarmony(p2, C, "h", "tritone");
    expect(swap.mix?.chords?.mute).toBe(true);
    expect(rewriteHarmony(swap, C, "h", "higher").mix?.chords?.mute).toBe(false);
  });

  it("an audition hears the track it will add, and leaves the page alone", () => {
    const p0 = focusTrack(song(), "melody", "melody");
    const pre = previewHarmony(p0, C, { kind: "melody", from: "melody", option: "counter" }, "h9");
    const add = addHarmony(p0, C, { kind: "melody", from: "melody", option: "counter" }, "h9").p;
    expect(pre.focus).toEqual(p0.focus);
    expect(pre.melody).toBe(p0.melody);
    expect(sameMusic(pre, add)).toBe(true);
    // on an existing harmony track it is a re-write
    expect(sameMusic(previewHarmony(add, C, { kind: "melody", from: "melody", option: "octave" }, "h9"), rewriteHarmony(add, C, "h9", "octave"))).toBe(true);
  });

  it("menus: every option a source can feed, the ones with nothing to write greyed, swaps marked", () => {
    const p = song();
    const fromTune = harmonyMenu(p, C, "melody", "melody");
    expect(fromTune.map((x) => x.option.id)).toEqual(["third-above", "third-below", "sixth-below", "chord-tones", "counter", "answer", "octave", "drone", "slow-line"]);
    // these tunes never take a breath, so there is nothing to answer
    expect(fromTune.filter((x) => !x.useful).map((x) => x.option.id)).toEqual(["answer"]);
    // a tune with a gap in any section has something to answer
    const gap = { ...p, melody: { ...p.melody!, notes: p.melody!.notes.filter((x) => x.at < 4 * TICKS || x.at >= 8 * TICKS) } };
    expect(harmonyMenu(gap, C, "melody", "melody").find((x) => x.option.id === "answer")!.useful).toBe(true);
    // from chords alone only the lines that need no tune
    expect(harmonyMenu(p, C, "melody", "chords").map((x) => x.option.id)).toEqual(["chord-tones", "counter", "drone", "slow-line"]);
    const chords = harmonyMenu(p, C, "chords", "chords");
    expect(chords.filter((x) => x.option.instead).map((x) => x.option.id)).toEqual(["borrowed", "lead-in", "passing", "tritone"]);
    // there is no dominant 7th to swap in this song
    expect(chords.find((x) => x.option.id === "tritone")!.useful).toBe(false);
    expect(chords.find((x) => x.option.id === "pad")!.useful).toBe(true);
    expect(harmonySources(p).map((t) => t.id)).toEqual(["chords", "melody"]);
  });

  it("a source taken away leaves the harmony's notes, but it can no longer be written again", () => {
    let p = addHarmony(song(), C, { kind: "melody", from: "melody", option: "octave" }, "o").p;
    p = addHarmony(p, C, { kind: "melody", from: "o", option: "third-below" }, "t").p;
    expect(harmonyState(p, C, "t").source).toBe(true);
    const q = removeTrack(p, "o");
    expect(q.tracks!.find((x) => x.id === "t")!.harmony).toBeUndefined();
    expect(q.tracks!.find((x) => x.id === "t")!.role).toBe("harmony");
    expect(layer(q, "A", "t")).toEqual(layer(p, "A", "t"));
    expect(harmonyState(q, C, "t").source).toBe(false);
  });

  it("copy and paste of sections keeps it whole: in the same song, and into another one", () => {
    const p = addHarmony(song(), C, { kind: "melody", from: "melody", option: "third-above" }, "h1").p;
    const clip = copySection(p, "c", C)!;
    // into D in the same song: D now holds C's harmony as it was written, so nothing counts as changed by hand
    const same = pasteSection(p, "d", clip, C, id);
    expect(layer(same, "D", "h1")).toEqual(layer(p, "C", "h1"));
    expect(harmonyState(same, C, "h1").edited).toEqual([]);
    // into another song: the harmony track comes along, written from that song's melody
    const other = loadCurrent({ chords: [ch("C", 4)], bpm: 90, pattern: "ring", loop: true, bars: 1, meter: { num: 4, den: 4 }, song: { parts: [{ id: "X", chords: [ch("C", 4)], bars: 1 }], blocks: [{ id: "x", partId: "X" }], current: "x" } });
    const into = pasteSection(other, "x", clip, C, id);
    const t = into.tracks!.find((x) => x.kind === "melody" && x.role === "harmony")!;
    expect(t.harmony!.from).toBe("melody");
    expect(Object.keys(t.harmony!.marks ?? {})).toEqual(["X"]);
    expect(harmonyState(into, C, t.id)).toMatchObject({ edited: [], source: true });
    expect(sections(into)).toHaveLength(1);
  });
});

describe("a harmony against what is heard", () => {
  /** C major: A has a tune over C F G C; D has chords and no tune; E a tune over F and C that leaves room for F minor. */
  function plain(): Progression {
    const at = (ms: number[]) => ms.map((midi, i) => ({ at: i * TICKS, midi }));
    const s: Song = {
      parts: [
        { id: "A", bars: 4, chords: [ch("C", 4), ch("F", 4), ch("G", 4), ch("C", 4)], melody: { div: 2, bars: 4, notes: at([64, 67, 72, 67, 69, 72, 69, 65, 67, 71, 74, 71, 72, 67, 64, 60]) } },
        { id: "D", bars: 2, chords: [ch("F", 4), ch("C", 4)] },
        { id: "E", bars: 2, chords: [ch("F", 4), ch("C", 4)], melody: { div: 2, bars: 2, notes: at([72, 65, 72, 65, 64, 67, 72, 67]) } },
      ],
      blocks: [{ id: "a", partId: "A" }, { id: "d", partId: "D" }, { id: "e", partId: "E" }],
      current: "a",
    };
    return loadCurrent({ chords: [], bpm: 90, pattern: "ring", loop: true, bars: 4, meter: { num: 4, den: 4 }, song: s });
  }

  it("a swap written from the tune mutes the song's chords, not the tune, and carries them where there is no tune", () => {
    const p = addHarmony(plain(), C, { kind: "chords", from: "melody", option: "borrowed" }, "b").p;
    expect(p.mix?.chords?.mute).toBe(true);
    expect(p.mix?.melody?.mute).toBeFalsy();
    // D has no tune: with its chords muted it would go silent, so the swap is written there too
    expect(layer(p, "D", "b")!.chords!.map((c) => c.ref.root)).toEqual(["F", "C"]);
    // E's tune leaves room for the borrowed F minor
    expect(layer(p, "E", "b")!.chords![0].ref).toMatchObject({ root: "F", typeId: "min" });
    expect(harmonyMenu(plain(), C, "chords", "melody").find((x) => x.option.id === "borrowed")).toMatchObject({ instead: true, useful: true });
    // undone by taking it away: the chords play again; with another swap still in place they stay muted
    expect(removeTrack(p, "b").mix?.chords?.mute).toBe(false);
    const two = addHarmony(p, C, { kind: "chords", from: "chords", option: "lead-in" }, "l").p;
    expect(removeTrack(two, "b").mix?.chords?.mute).toBe(true);
    expect(removeTrack(removeTrack(two, "b"), "l").mix?.chords?.mute).toBe(false);
  });

  it("Best fit plays instead of the song's chords when there are some (its own chords would clash with them), and with nothing otherwise", () => {
    const menu = harmonyMenu(plain(), C, "chords", "melody");
    expect(menu.find((x) => x.option.id === "fit")!.instead).toBe(true);
    expect(menu.find((x) => x.option.id === "pad")!.instead).toBe(false);
    const p = addHarmony(plain(), C, { kind: "chords", from: "melody", option: "fit" }, "f").p;
    expect(p.mix?.chords?.mute).toBe(true);
    // the section without a tune keeps its chords in the new track
    expect(layer(p, "D", "f")!.chords!.map((c) => `${c.ref.root}${c.ref.typeId}`)).toEqual(["Fmaj", "Cmaj"]);
    // a tune with no chords anywhere: Best fit is simply added
    const bare = loadCurrent({ chords: [], bpm: 90, pattern: "ring", loop: true, bars: 2, meter: { num: 4, den: 4 }, song: { parts: [{ id: "X", bars: 2, chords: [], melody: tune([60, 64, 67, 72, 71, 67, 62, 59]) }], blocks: [{ id: "x", partId: "X" }], current: "x" } });
    expect(harmonyMenu(bare, C, "chords", "melody").find((x) => x.option.id === "fit")!.instead).toBe(false);
    const q = addHarmony(bare, C, { kind: "chords", from: "melody", option: "fit" }, "f").p;
    expect(q.mix?.chords?.mute).toBeFalsy();
    expect(layer(q, "X", "f")!.chords!.length).toBeGreaterThan(0);
    // switching to a layer that plays with the chords lets them be heard again
    expect(rewriteHarmony(p, C, "f", "pad").mix?.chords?.mute).toBe(false);
  });

  it("a line written to the chords bends to the swapped chords that sound, and an older one says it is out of date", () => {
    const sw = addHarmony(plain(), C, { kind: "chords", from: "melody", option: "borrowed" }, "b").p;
    const after = addHarmony(sw, C, { kind: "melody", from: "melody", option: "third-above" }, "t").p;
    // over F minor the third above F is A flat, never the A natural that rubs against it
    const e = layer(after, "E", "t")!.melody!.notes;
    expect(e.filter((x) => x.at < 4 * TICKS).some((x) => x.midi % 12 === 8)).toBe(true);
    expect(e.filter((x) => x.at < 4 * TICKS).some((x) => x.midi % 12 === 9)).toBe(false);
    // written before the swap: the A natural is there, and ⟳ says it would now come out differently
    const before = addHarmony(plain(), C, { kind: "melody", from: "melody", option: "third-above" }, "t").p;
    expect(layer(before, "E", "t")!.melody!.notes.some((x) => x.midi % 12 === 9)).toBe(true);
    const later = addHarmony(before, C, { kind: "chords", from: "melody", option: "borrowed" }, "b").p;
    expect(harmonyState(later, C, "t").stale).toBe(true);
    expect(layer(rewriteHarmony(later, C, "t"), "E", "t")).toEqual(layer(after, "E", "t"));
  });

  it("a new melody harmony starts a little under the tune in the mix; a chords layer at its own level", () => {
    expect(addHarmony(plain(), C, { kind: "melody", from: "melody", option: "third-above" }, "t").p.mix?.t).toEqual({ db: HARMONY_DB });
    expect(HARMONY_DB).toBeLessThan(0);
    expect(addHarmony(plain(), C, { kind: "chords", from: "chords", option: "pad" }, "p").p.mix?.p).toBeUndefined();
  });
});

describe("a harmony as the song around it grows", () => {
  /** An old song: one page, no sections yet. */
  const page = (): Progression => ({ chords: [ch("G", 4), ch("E", 4, "min"), ch("C", 4), ch("D", 4)], bpm: 100, pattern: "ring", loop: true, bars: 4, melody: tune([67, 71, 74, 71, 72, 71, 69, 67, 66, 67, 69, 71, 72, 74, 69, 66]) });
  const G: Key = { tonic: "G", scaleId: "ionian" };

  it("written on a page that then gets sections: section A is what was written, not changed by hand or out of date", () => {
    const p = addHarmony(page(), G, { kind: "melody", from: "melody", option: "third-above" }, "h").p;
    const q = addNewSection(p);
    expect(harmonyState(q, G, "h")).toEqual({ edited: [], stale: false, source: true });
    // and a copy of A pasted into the new section is what was written there too
    const a = q.song!.blocks[0].id;
    const b = q.song!.blocks[1].id;
    const r = pasteSection(q, b, copySection(q, a, G, null)!, G, id);
    expect(layer(r, r.song!.blocks[1].partId, "h")).toBeDefined();
    expect(harmonyState(r, G, "h")).toEqual({ edited: [], stale: false, source: true });
    // a real change by hand is still caught
    const s = focusTrack(selectBlock(r, a), "melody", "h");
    const edited = { ...s, melody: { ...s.melody!, notes: [...s.melody!.notes, { at: 0, midi: 50 }] } };
    expect(harmonyState(edited, G, "h").edited).toEqual(["A"]);
  });

  it("given sections that are then all removed, the page is what was written again: a change to its source is not a change by hand", () => {
    const p = addHarmony(page(), G, { kind: "melody", from: "melody", option: "third-above" }, "h").p;
    const q = addNewSection(p);
    const [a, b] = q.song!.blocks.map((x) => x.id);
    const back = removeBlock(removeBlock(q, b), a);
    expect(back.song).toBeNull();
    // a few notes of the tune it follows changed
    const edit = (x: Progression) => {
      const s = focusTrack(x, "melody", "melody");
      return { ...s, melody: { ...s.melody!, notes: s.melody!.notes.map((n, i) => (i < 3 ? { ...n, midi: n.midi + 2 } : n)) } };
    };
    expect(harmonyState(edit(p), G, "h").edited).toEqual([]);
    expect(harmonyState(edit(back), G, "h").edited).toEqual([]);
  });

  it("a section played twice and then given its own copy keeps what was written in both", () => {
    const p = addHarmony(song(), C, { kind: "melody", from: "melody", option: "counter" }, "h").p;
    // A plays twice; the second time becomes a section of its own
    const q = unlinkBlock(p, "a2");
    expect(normalize(q).song!.parts.length).toBe(5);
    expect(harmonyState(q, C, "h")).toEqual({ edited: [], stale: false, source: true });
  });

  it("the whole song moved to another key (the harmony with it): still what was written, nothing to ask about", () => {
    const p = addHarmony(addHarmony(song(), C, { kind: "melody", from: "melody", option: "third-above" }, "h").p, C, { kind: "chords", from: "chords", option: "pad" }, "pad").p;
    // as the page's − ½ / + ½ does it: every chord and every melody, the added tracks' too
    const D: Key = { tonic: "D", scaleId: "ionian" };
    const by = melodyBase(D) - melodyBase(C);
    const q = mapAllMelodies(mapAllChords(p, (c) => ({ ...c, ref: transposeRef(c.ref, 2, D), voicingId: undefined })), (m) => transposeMelody(m, by));
    expect(harmonyState(q, D, "h")).toEqual({ edited: [], stale: false, source: true });
    expect(harmonyState(q, D, "pad")).toEqual({ edited: [], stale: false, source: true });
    // a note changed by hand after that is still caught
    const s = focusTrack(q, "melody", "h");
    expect(harmonyState({ ...s, melody: { ...s.melody!, notes: [...s.melody!.notes, { at: 0, midi: 50 }] } }, D, "h").edited).toEqual(["A"]);
    // and a later change to what it was written from leaves it out of date, not changed by hand
    const m = focusTrack(q, "melody", "melody");
    const tuned = { ...m, melody: { ...m.melody!, notes: m.melody!.notes.map((x, i) => (i === 1 ? { ...x, midi: x.midi + 2 } : x)) } };
    expect(harmonyState(tuned, D, "h")).toEqual({ edited: [], stale: true, source: true });
    const c = focusTrack(q, "chords", "chords");
    const chorded = { ...c, chords: c.chords.map((x, i) => (i === 0 ? { ...x, ref: transposeRef(x.ref, 5, D) } : x)) };
    expect(harmonyState(chorded, D, "pad")).toEqual({ edited: [], stale: true, source: true });
  });

  it("written again with another option, a track whose instrument was never chosen moves to the one that suits it; a chosen one stays", () => {
    const p = addHarmony(song(), C, { kind: "chords", from: "chords", option: "sus" }, "s").p;
    expect(p.tones?.s).toBeUndefined();
    const shell = rewriteHarmony(p, C, "s", "shell");
    expect(shell.tones?.s).toMatchObject({ inst: "piano", voicing: "shell" });
    // the strings chosen by hand are kept
    const chosen = rewriteHarmony({ ...p, tones: { ...p.tones, s: { inst: "guitar" } } }, C, "s", "shell");
    expect(chosen.tones?.s).toEqual({ inst: "guitar" });
  });
});

describe("the chords a re-harmonisation mutes", () => {
  it("are heard again when it goes, though its source went first", () => {
    for (const option of ["borrowed", "fit"]) {
      // a tune on Melody 2, chords written from it in place of the song's
      const base = addTrack(song(), "melody", "m2").p;
      const withTune = { ...base, melody: tune([64, 65, 67, 69, 67, 65, 64, 62]) };
      const p = addHarmony(withTune, C, { kind: "chords", from: "m2", option }, "b").p;
      expect(p.mix?.chords?.mute, option).toBe(true);
      const q = removeTrack(removeTrack(p, "m2"), "b");
      expect(q.mix?.chords?.mute, option).toBeFalsy();
    }
  });
  it("stay muted when they were muted by hand before it came", () => {
    const p0 = { ...song(), mix: { chords: { mute: true } } };
    const p = addHarmony(p0, C, { kind: "chords", from: "chords", option: "borrowed" }, "b").p;
    expect(removeTrack(p, "b").mix?.chords?.mute).toBe(true);
    expect(rewriteHarmony(p, C, "b", "pad").mix?.chords?.mute).toBe(true);
    // muted by the harmony itself: heard again when it goes
    const q = addHarmony(song(), C, { kind: "chords", from: "chords", option: "borrowed" }, "b").p;
    expect(removeTrack(q, "b").mix?.chords?.mute).toBe(false);
  });
});

describe("a harmony track through a change of time signature", () => {
  for (const option of ["third-above", "counter"]) {
    it(`${option}: nothing looks changed by hand that was not`, () => {
      const p = addHarmony(song(), C, { kind: "melody", from: "melody", option }, "h1").p;
      expect(harmonyState(p, C, "h1").edited).toEqual([]);
      const q = setSig(p, { num: 3, den: 4 });
      expect(harmonyState(q, C, "h1").edited).toEqual([]);
    });
  }
  for (const option of ["third-above", "counter"]) {
    it(`${option}, in an idea with no sections yet: nothing looks changed by hand that was not`, () => {
      const page: Progression = { chords: [ch("C", 4), ch("G", 4), ch("A", 4, "min"), ch("F", 4)], melody: tune([64, 65, 67, 67, 67, 69, 67, 64, 65, 64, 62, 60, 65, 69, 72, 69]), bpm: 90, pattern: "ring", loop: true, bars: 4, meter: { num: 4, den: 4 } };
      const p = addHarmony(page, C, { kind: "melody", from: "melody", option }, "h1").p;
      expect(harmonyState(p, C, "h1").edited).toEqual([]);
      for (const sig of [{ num: 3, den: 4 as const }, { num: 6, den: 8 as const }]) expect(harmonyState(setSig(p, sig), C, "h1").edited).toEqual([]);
    });
  }
  it("a section changed by hand before still shows", () => {
    const p = addHarmony(song(), C, { kind: "melody", from: "melody", option: "third-above" }, "h1").p;
    const m = p.melody!;
    const edited = { ...p, melody: { ...m, notes: m.notes.slice(1) } };
    expect(harmonyState(setSig(edited, { num: 3, den: 4 }), C, "h1").edited).toEqual(["A"]);
  });
});

describe("a harmony track as the pages see it", () => {
  it("how it was written changes when it is written again, not with a change by hand", () => {
    const p = addHarmony(song(), C, { kind: "melody", from: "melody", option: "third-above" }, "h1").p;
    const was = writtenAs(p, "h1");
    expect(was).not.toBe("");
    const tapped = { ...p, melody: { ...p.melody!, notes: p.melody!.notes.slice(1) } };
    expect(writtenAs(tapped, "h1")).toBe(was);
    expect(writtenAs(rewriteHarmony(tapped, C, "h1", "sixth-below"), "h1")).not.toBe(was);
    expect(writtenAs(p, "melody")).toBe("");
  });
  it("a paste into it can no longer be taken back once it is written again", () => {
    const p = addHarmony(song(), C, { kind: "chords", from: "chords", option: "colour" }, "h1").p;
    const u = { block: "a", track: "h1", before: { chords: p.chords }, written: writtenAs(p, "h1") };
    expect(undoFits(u, "a", "h1", writtenAs(p, "h1"))).toBe(true);
    const q = rewriteHarmony(p, C, "h1", "sus");
    expect(undoFits(u, "a", "h1", writtenAs(q, "h1"))).toBe(false);
  });
  it("one removed is no longer there to write again", () => {
    const p = addHarmony(song(), C, { kind: "melody", from: "melody", option: "counter" }, "h1").p;
    expect(isHarmony(p, "h1")).toBe(true);
    expect(isHarmony(removeTrack(p, "h1"), "h1")).toBe(false);
  });
});

describe("a re-harmonisation written again", () => {
  it("leaves the chords it plays instead of heard when the songwriter unmuted them", () => {
    const p = addHarmony(song(), C, { kind: "chords", from: "chords", option: "tritone" }, "tt").p;
    expect(p.mix?.chords).toEqual({ mute: true, instead: true });
    // unmuted by hand on the Track page: the mute is theirs now
    const heard = { ...p, mix: { ...p.mix, chords: { mute: false } } };
    for (const option of ["tritone", "borrowed"]) expect(rewriteHarmony(heard, C, "tt", option).mix?.chords?.mute).toBe(false);
    // and still theirs once the idea has been saved and opened again
    const back = reviveIdea(JSON.parse(JSON.stringify({ id: "i", name: "x", key: C, savedAt: 0, progression: heard })))!.progression;
    expect(rewriteHarmony(back, C, "tt").mix?.chords?.mute).toBe(false);
    // never muted (pasted into a song whose other sections play those chords): writing it across the song mutes them
    expect(rewriteHarmony({ ...p, mix: undefined }, C, "tt").mix?.chords).toEqual({ mute: true, instead: true });
  });
});

describe("a re-harmonisation pasted into another idea", () => {
  it("comes on its instrument, and in place of that idea's chords", () => {
    const p0 = addHarmony(song(), C, { kind: "chords", from: "chords", option: "tritone" }, "tt").p;
    const p = { ...p0, tones: { ...p0.tones, tt: { inst: "piano" as const } } };
    const clip = copySection(p, "a", C, "idea-1")!;
    const other = loadCurrent({ chords: [ch("C", 4)], bpm: 90, pattern: "ring", loop: true, bars: 1, meter: { num: 4, den: 4 }, song: { parts: [{ id: "X", chords: [ch("C", 4)], bars: 1 }], blocks: [{ id: "x", partId: "X" }], current: "x" } });
    // (the clipboard is kept between sessions: the instrument with it)
    expect(reviveClips(JSON.parse(JSON.stringify({ section: clip }))).section?.tones).toEqual({ tt: { inst: "piano" } });
    const into = pasteSection(other, "x", clip, C, id);
    const t = into.tracks!.find((x) => x.name === "Tritone swap")!;
    expect(into.tones?.[t.id]).toEqual({ inst: "piano" });
    expect(into.mix?.chords?.mute).toBe(true);
    // and taking it away lets the chords be heard again
    expect(removeTrack(into, t.id).mix?.chords?.mute).toBe(false);
  });
  it("copied from an idea with no sections yet, keeps its record of what was written, so it is not taken for changed by hand", () => {
    for (const option of ["relative", "colour"]) {
      const page: Progression = { chords: [ch("C", 4), ch("G", 4), ch("A", 4, "min"), ch("F", 4)], melody: tune([64, 65, 67, 67, 67, 69, 67, 64, 65, 64, 62, 60, 65, 69, 72, 69]), bpm: 90, pattern: "ring", loop: true, bars: 4, meter: { num: 4, den: 4 } };
      const p = addHarmony(page, C, { kind: "chords", from: "chords", option }, "hx").p;
      const clip = copySection(p, "", C, "idea-1")!;
      const other = loadCurrent({ chords: [ch("C", 4)], bpm: 90, pattern: "ring", loop: true, bars: 1, meter: { num: 4, den: 4 }, song: { parts: [{ id: "X", chords: [ch("C", 4)], bars: 1 }], blocks: [{ id: "x", partId: "X" }], current: "x" } });
      const into = pasteSection(other, "x", clip, C, id);
      const t = into.tracks!.find((x) => x.harmony?.option === option)!;
      expect(harmonyState(into, C, t.id).edited, option).toEqual([]);
    }
  });
  it("into one section of several, leaves the chords playing in the others (the pasted track plays only there)", () => {
    const p = addHarmony(song(), C, { kind: "chords", from: "chords", option: "borrowed" }, "bw").p;
    const clip = copySection(p, "a", C, "idea-1")!;
    const other = loadCurrent({
      chords: [ch("C", 4)], bpm: 90, pattern: "ring", loop: true, bars: 1, meter: { num: 4, den: 4 },
      song: { parts: [{ id: "X", chords: [ch("C", 4)], bars: 1 }, { id: "Y", chords: [ch("E", 2), ch("A", 2)], bars: 1 }, { id: "Z", chords: [ch("F", 2), ch("G", 2)], bars: 1 }], blocks: [{ id: "x", partId: "X" }, { id: "y", partId: "Y" }, { id: "z", partId: "Z" }], current: "x" },
    });
    const into = pasteSection(other, "x", clip, C, id);
    expect(into.tracks!.some((x) => x.name === "Borrowed")).toBe(true);
    expect(into.mix?.chords?.mute).toBeFalsy();
  });
});
