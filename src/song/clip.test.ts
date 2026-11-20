import { describe, expect, it } from "vitest";
import { BEAT_LIBRARY, DEFAULT_BEAT, applyPattern } from "../audio/beats";
import type { ProgChord, Progression } from "../ui/state";
import { copyDrums, copyMelody, copyRhythm, hasPart, keyShift, pasteDrums, pasteMelody, pastePart, pasteRhythm, pastFrame, reviveClips, undoFits, unpastePart } from "./clip";
import { addNewSection, ensureSong, sections, selectBlock } from "./structure";
import { TICKS } from "./melody";

const chord = (root: string, beats = 4): ProgChord => ({ id: root, ref: { root, typeId: "maj" }, beats });
const base = (roots: string[] = []): Progression => ({ chords: roots.map((r) => chord(r)), bpm: 90, pattern: "ring", loop: true, bars: 4 });
let n = 0;
const id = () => `id${++n}`;
const G = { tonic: "G", scaleId: "ionian" };
const A = { tonic: "A", scaleId: "ionian" };
const tune = { div: 2 as const, bars: 4, notes: [{ at: 0, midi: 67 }, { at: 24, midi: 71 }] };

/** A song with A (chords, style, sound, melody, drums) and an empty B on screen. */
function song(): Progression {
  const drums = { ...applyPattern(DEFAULT_BEAT, BEAT_LIBRARY[3]), on: true, kit: DEFAULT_BEAT.kit };
  let p: Progression = { ...base(["G", "C", "D", "Em"]), pattern: "pinch", feel: { swing: 0.4 }, sound: { space: 0.7 }, melody: tune, tuneSound: { space: 0.2 }, beat: drums };
  p = ensureSong(p, id);
  return addNewSection(p, id);
}

describe("copy and paste between sections", () => {
  it("rhythm: only the chords go to the section on screen, as new slots; the track keeps its own style, feel and sound", () => {
    const p0 = ensureSong({ ...base(["G", "C"]), pattern: "pinch", feel: { swing: 0.4 }, sound: { space: 0.7 } }, id);
    const clip = copyRhythm(p0, G, "A");
    expect(Object.keys(clip).sort()).toEqual(["bar", "chords", "from", "key"]);
    // the track pasted into plays another way
    const into = { ...addNewSection(p0, id), pattern: "block" as const, feel: { swing: 0.1 }, sound: { space: 0.2 } };
    const p = pasteRhythm(into, clip, G, id);
    expect(p.chords.map((c) => c.ref.root)).toEqual(["G", "C"]);
    expect(p.chords.map((c) => c.id)).not.toEqual(p0.chords.map((c) => c.id));
    expect(p.pattern).toBe("block");
    expect(p.feel).toBe(into.feel);
    expect(p.sound).toBe(into.sound);
  });

  it("a copy is a copy: changing the section afterwards leaves the clipboard alone", () => {
    const p = base(["G", "C"]);
    const clip = copyRhythm(p, G, "A");
    p.chords[0].ref.root = "F";
    expect(clip.chords[0].ref.root).toBe("G");
  });

  it("each page pastes only its own part: the other two pages and the length stay", () => {
    const p = song();
    const a = selectBlock(p, sections(p)[0].blockId);
    const r = pasteRhythm(p, copyRhythm(a, G, "A"), G, id);
    expect(r.melody).toBe(p.melody);
    expect(r.beat).toBe(p.beat);
    expect(r.bars).toBe(p.bars);
    const m = pasteMelody({ ...p, tuneSound: { space: 0.9 } }, copyMelody(a, G, "A"), G);
    expect(m.melody?.notes).toEqual(tune.notes);
    // the melody track keeps its own harp
    expect(m.tuneSound).toEqual({ space: 0.9 });
    expect(m.chords).toBe(p.chords);
    expect(m.beat).toBe(p.beat);
    // drums: the rhythm and on/off; the kit stays the one the track pasted into has
    const into = { ...p, beat: { ...p.beat!, kit: "808" as const, space: 0.9, verb: "plate" as const } };
    const d = pasteDrums(into, copyDrums(a, G, "A"));
    expect(d.beat!.rows).toEqual(a.beat!.rows);
    expect(d.beat!.on).toBe(true);
    expect(d.beat!.patternId).toBe(a.beat!.patternId);
    expect([d.beat!.kit, d.beat!.space, d.beat!.verb]).toEqual(["808", 0.9, "plate"]);
    expect(d.chords).toBe(p.chords);
    expect(d.melody).toBe(p.melody);
  });

  it("a pasted section keeps what was pasted when the song moves on to other sections", () => {
    let p = song();
    const a = selectBlock(p, sections(p)[0].blockId);
    p = pasteDrums(pasteMelody(pasteRhythm(p, copyRhythm(a, G, "A"), G, id), copyMelody(a, G, "A"), G), copyDrums(a, G, "A"));
    const [sa, sb] = sections(p);
    expect(sb.chords.map((c) => c.ref.root)).toEqual(sa.chords.map((c) => c.ref.root));
    expect(sb.melody?.notes).toEqual(sa.melody?.notes);
    expect(sb.groove).toEqual(sa.groove);
    // the first chords track plays one way in every section
    expect(p.pattern).toBe("pinch");
  });

  it("into a song in another key, the chords and the melody move to that key", () => {
    expect(keyShift(G, A)).toBe(2);
    expect(keyShift(A, G)).toBe(-2);
    expect(keyShift({ tonic: "C", scaleId: "ionian" }, { tonic: "B", scaleId: "ionian" })).toBe(-1);
    const p = { ...base(["G", "D"]), melody: tune };
    const r = pasteRhythm(base(), { ...copyRhythm(p, G, "A"), chords: [{ ...chord("G"), voicingId: "320003" }, chord("D")] }, A, id);
    expect(r.chords.map((c) => c.ref.root)).toEqual(["A", "E"]);
    expect(r.chords[0].voicingId).toBeUndefined();
    const m = pasteMelody(base(), copyMelody(p, G, "A"), A);
    expect(m.melody?.notes.map((x) => x.midi)).toEqual([69, 73]);
    // up or down, whichever keeps the tune on the new key's grid
    expect(pasteMelody(base(), copyMelody({ ...p, melody: { ...tune, notes: [{ at: 0, midi: 78 }] } }, G, "A"), { tonic: "C#", scaleId: "ionian" }).melody?.notes[0].midi).toBe(84);
    // same key: nothing moves, chosen shapes stay
    const same = pasteRhythm(base(), { ...copyRhythm(p, G, "A"), chords: [{ ...chord("G"), voicingId: "320003" }] }, G, id);
    expect(same.chords[0].voicingId).toBe("320003");
  });

  it("knows when a section already has something, and when a paste runs past its end", () => {
    expect(hasPart(base(), "rhythm")).toBe(false);
    expect(hasPart(base(["C"]), "rhythm")).toBe(true);
    expect(hasPart({ ...base(), melody: tune }, "melody")).toBe(true);
    expect(hasPart({ ...base(), beat: { ...DEFAULT_BEAT, on: false } }, "drums")).toBe(false);
    const long = base(["C", "F", "G", "C"]);
    expect(pastFrame(long, "rhythm", 16)).toBe(false);
    expect(pastFrame(long, "rhythm", 8)).toBe(true);
    // rests past the end are no loss
    expect(pastFrame({ ...base(["C", "F"]), chords: [chord("C"), chord("F"), { ...chord("G"), rest: true }] }, "rhythm", 8)).toBe(false);
    expect(pastFrame({ ...base(), melody: { ...tune, notes: [{ at: 8 * TICKS, midi: 60 }] } }, "melody", 8)).toBe(true);
    expect(pastFrame({ ...base(), melody: tune }, "melody", 8)).toBe(false);
  });

  it("clipboards survive a reload; broken ones are dropped", () => {
    const p = song();
    const a = selectBlock(p, sections(p)[0].blockId);
    const kept = reviveClips(JSON.parse(JSON.stringify({ rhythm: copyRhythm(a, G, "A"), melody: copyMelody(a, G, "A"), drums: copyDrums(a, G, "A") })));
    expect(kept.rhythm?.chords).toHaveLength(4);
    expect(kept.melody?.melody?.notes).toEqual(tune.notes);
    expect(kept.drums?.beat.on).toBe(true);
    expect(kept.drums?.from).toBe("A");
    expect(reviveClips(undefined)).toEqual({});
    expect(reviveClips({ rhythm: { from: "A", key: G, chords: "x" }, drums: { from: "A", key: G, beat: 7 }, melody: { from: 3 } })).toEqual({});
  });

  it("an old clipboard that held a sound too is still pasted, as music only", () => {
    const old = reviveClips({
      rhythm: { from: "A", key: G, chords: [chord("G"), chord("D")], pattern: "pinch", feel: { swing: 0.5 }, sound: { space: 0.9 } },
      melody: { from: "A", key: G, melody: tune, tuneSound: { space: 0.8 } },
    });
    expect(old.rhythm && Object.keys(old.rhythm).sort()).toEqual(["chords", "from", "key"]);
    expect(old.melody && "tuneSound" in old.melody).toBe(false);
    const into = { ...base(), pattern: "block" as const, sound: { space: 0.1 }, tuneSound: { space: 0.3 } };
    const r = pasteRhythm(into, old.rhythm!, G, id);
    expect(r.chords.map((c) => c.ref.root)).toEqual(["G", "D"]);
    expect([r.pattern, r.feel, r.sound]).toEqual(["block", undefined, { space: 0.1 }]);
    const m = pasteMelody(into, old.melody!, G);
    expect(m.melody?.notes).toEqual(tune.notes);
    expect(m.tuneSound).toEqual({ space: 0.3 });
  });
});

describe("taking a paste back", () => {
  it("puts back the music from before: a drums paste only its rhythm and on/off, never the kit", () => {
    const before = { ...base(), beat: { ...DEFAULT_BEAT, kit: "707" as const, on: false, name: "Before", rows: { ...DEFAULT_BEAT.rows, kick: "1000000000000000" } } };
    const copied = { ...base(), beat: { ...applyPattern(DEFAULT_BEAT, BEAT_LIBRARY[3]), on: true, kit: "box" as const } };
    const pasted = { ...before, ...pastePart(pasteDrums(before, copyDrums(copied, G, "A")), "drums") };
    expect(pasted.beat.kit).toBe("707");
    expect(pasted.beat.rows).toEqual(copied.beat.rows);
    // the kit changed after the paste: the undo keeps the new kit and puts back the old rhythm
    const now = { ...pasted, beat: { ...pasted.beat, kit: "lofi" as const, space: 0.8 } };
    const undone = { ...now, ...unpastePart(now, pastePart(before, "drums")) };
    expect(undone.beat.rows).toEqual(before.beat.rows);
    expect(undone.beat.on).toBe(false);
    expect(undone.beat.name).toBe("Before");
    expect([undone.beat.kit, undone.beat.space]).toEqual(["lofi", 0.8]);
    // chords and melody: what was there before
    expect(unpastePart(now, pastePart({ ...base(["C"]) }, "rhythm"))).toEqual({ chords: base(["C"]).chords });
    expect(Object.keys(pastePart(now, "melody"))).toEqual(["melody"]);
  });

  it("only in the section and on the track it was pasted into", () => {
    const u = { block: "a", track: "chords", before: { chords: [] } };
    expect(undoFits(u, "a", "chords")).toBe(true);
    // another chords track brought forward: the page holds its music now
    expect(undoFits(u, "a", "pad1")).toBe(false);
    expect(undoFits(u, "b", "chords")).toBe(false);
    expect(undoFits(null, "a", "chords")).toBe(false);
  });
});
