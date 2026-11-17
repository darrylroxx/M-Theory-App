import { describe, expect, it } from "vitest";
import { BEAT_LIBRARY, DEFAULT_BEAT, applyPattern, barHasHits, barsOf, clearBeat, levelAt, patternBar, setStep, spreadBeat } from "../audio/beats";
import type { ProgChord, Progression } from "../ui/state";
import { DEFAULT_BARS, MAX_SECTION_BARS, autoBeats, barsOr, barsText, fitBars, frameBeats, frameItems, inFrame, stepBars } from "./frame";
import { fingerprint, reviveIdea, snapshot } from "./library";
import { EMPTY_MELODY, TICKS, barHasNotes, inBars, tileMelody, tuneBetween, type Melody } from "./melody";
import { addNewSection, commit, ensureSong, repeatSection, reviveSong, sections, selectBlock, setSectionBars, settle, unlinkBlock } from "./structure";

const chord = (root: string, beats = 4): ProgChord => ({ id: root, ref: { root, typeId: "maj" }, beats });
const base = (roots: string[] = []): Progression => ({ chords: roots.map((r) => chord(r)), bpm: 90, pattern: "ring", loop: true });
let n = 0;
const id = () => `f${++n}`;
const total = (xs: { item: { beats: number } }[]) => xs.reduce((a, x) => a + x.item.beats, 0);

describe("the frame of a section", () => {
  it("a section is so many bars long: four until someone says otherwise", () => {
    expect(frameBeats(8, 4)).toBe(32);
    expect(frameBeats(8, 3)).toBe(24);
    expect(frameBeats(undefined, 4)).toBe(DEFAULT_BARS * 4);
    expect(barsOr(12)).toBe(12);
    expect(barsOr(undefined)).toBe(DEFAULT_BARS);
  });

  it("only whole bars from 1 to 32 can be set", () => {
    expect(fitBars(4)).toBe(4);
    expect(fitBars(4.4)).toBe(4);
    expect(fitBars(99)).toBe(MAX_SECTION_BARS);
    expect(fitBars(0)).toBeUndefined();
    expect(fitBars(-3)).toBeUndefined();
    expect(fitBars(undefined)).toBeUndefined();
    expect(fitBars("x")).toBeUndefined();
  });

  it("chords play once, in their bars: nothing comes round again", () => {
    const two = [chord("C"), chord("G")];
    const out = inFrame(two, 32);
    expect(out.map((x) => x.item.ref.root).join("")).toBe("CG");
    expect(total(out)).toBe(8); // the other six bars are empty, and silent
    expect(out[0].item).toBe(two[0]);
  });

  it("chords that run past the end of the section are cut off there", () => {
    const out = inFrame([chord("C"), chord("G"), chord("F"), chord("A")], 10);
    expect(out.map((x) => x.item.ref.root).join("")).toBe("CGF");
    expect(out.map((x) => x.item.beats)).toEqual([4, 4, 2]);
    expect(out.map((x) => x.index)).toEqual([0, 1, 2]);
    expect(inFrame([chord("C", 16)], 4).map((x) => x.item.beats)).toEqual([4]);
    expect(inFrame([], 16)).toEqual([]);
  });

  it("lengths are written short, and step a bar at a time", () => {
    expect(barsText(16, 4)).toBe("4");
    expect(barsText(6, 4)).toBe("1½");
    expect(barsText(24, 3)).toBe("8");
    expect(stepBars(16, 4, 1)).toBe(5);
    expect(stepBars(16, 4, -1)).toBe(3);
    expect(stepBars(4, 4, -1)).toBe(1);
    expect(stepBars(32 * 4, 4, 1)).toBe(MAX_SECTION_BARS);
  });
});

describe("the melody has every bar of the section", () => {
  const m: Melody = { ...EMPTY_MELODY, bars: 2, notes: [{ at: 0, midi: 60 }, { at: 4 * TICKS, midi: 64 }] };

  it("a note plays in its own bar and nowhere else", () => {
    const eight = inBars(m, 8);
    expect(eight.bars).toBe(8);
    expect(eight.notes).toBe(m.notes);
    // over eight bars of four beats: two notes, in bars 1 and 2; bars 3 to 8 are silent
    expect(tuneBetween(eight, 4, 0, 32).map((h) => h.beat)).toEqual([0, 4]);
    expect(tuneBetween(eight, 4, 8, 32)).toEqual([]);
    expect(barHasNotes(eight, 4, 0)).toBe(true);
    expect(barHasNotes(eight, 4, 1)).toBe(true);
    expect(barHasNotes(eight, 4, 2)).toBe(false);
  });

  it("notes past the end of a shorter section are kept but not played", () => {
    const one = inBars(m, 1);
    expect(tuneBetween(one, 4, 0, 4).map((h) => h.midi)).toEqual([60]);
    expect(one.notes).toHaveLength(2);
    // make the section longer again and the note is back
    expect(tuneBetween(inBars(one, 2), 4, 0, 8).map((h) => h.midi)).toEqual([60, 64]);
  });
});

describe("the drums have every bar of the section", () => {
  const four = { ...applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((p) => p.steps === 16 && (p.bars ?? 1) === 1)!), on: true };

  it("a rhythm shorter than the section fills every bar of it", () => {
    expect(patternBar(four, 5)).toBe(0);
    expect(patternBar({ bars: 2 }, 5)).toBe(1);
    const all = spreadBeat(four, 8);
    expect(barsOf(all)).toBe(8);
    for (let b = 0; b < 8; b++) expect(barHasHits(all, b)).toBe(true);
    expect(all.rows.kick).toBe(four.rows.kick.padEnd(16, "0").slice(0, 16).repeat(8));
    // written out, it is still the same rhythm: nothing has been edited
    expect(!!all.edited).toBe(!!four.edited);
    // a rhythm already as long as the section is left alone
    expect(spreadBeat(all, 8)).toBe(all);
    expect(spreadBeat(all, 4)).toBe(all);
  });

  it("an emptied bar plays nothing; the others are untouched", () => {
    const cleared = clearBeat(spreadBeat(four, 4), 2);
    expect([0, 1, 2, 3].map((b) => barHasHits(cleared, b))).toEqual([true, true, false, true]);
    // and a hit put into one bar is in that bar alone
    const hit = setStep(clearBeat(spreadBeat(four, 4), 2), "kick", 2 * 16 + 3, 2);
    expect(levelAt(hit.rows, "kick", 2 * 16 + 3)).toBe(2);
    expect(levelAt(hit.rows, "kick", 3)).toBe(levelAt(four.rows, "kick", 3));
    expect([0, 1, 2, 3].map((b) => barHasHits(hit, b))).toEqual([true, true, true, true]);
  });
});

describe("every section keeps its own length", () => {
  it("a length belongs to its section and comes back with it", () => {
    let p = ensureSong({ ...base(["C", "G"]), bars: 8 }, id);
    expect(sections(p)[0].bars).toBe(8);
    p = addNewSection(p, id);
    // a new section starts as long as the one it was made from
    expect(p.bars).toBe(8);
    p = { ...p, bars: 2 };
    const a = sections(p)[0].blockId;
    const b = sections(p)[1].blockId;
    p = selectBlock(p, a);
    expect(p.bars).toBe(8);
    p = selectBlock(p, b);
    expect(p.bars).toBe(2);
    expect(sections(p).map((s) => s.bars)).toEqual([8, 2]);
  });

  it("any section's length can be set from the frame, whichever one is on screen", () => {
    let p = addNewSection(ensureSong({ ...base(["C"]), bars: 4 }, id), id); // on B
    const [a, b] = sections(p).map((x) => x.blockId);
    p = setSectionBars(p, a, 12);
    expect(sections(p).map((x) => x.bars)).toEqual([12, 4]);
    expect(p.bars).toBe(4); // B, on screen, is untouched
    p = setSectionBars(p, b, 2);
    expect(p.bars).toBe(2);
    expect(sections(p).map((x) => x.bars)).toEqual([12, 2]);
    // out of range is brought back in; with no song yet, the page itself is the section
    expect(sections(setSectionBars(p, a, 99))[0].bars).toBe(MAX_SECTION_BARS);
    expect(setSectionBars({ ...base(["C"]), bars: 4 }, "", 8).bars).toBe(8);
    // a repeat of A is the same section: one length for both
    p = repeatSection(p, p.song!.parts[0].id, id);
    p = setSectionBars(p, a, 5);
    expect(sections(p).map((x) => `${x.letter}${x.bars}`).sort()).toEqual(["A5", "A5", "B2"]);
  });

  it("the same letter twice has one length; a copy with its own letter keeps it and can then differ", () => {
    let p = ensureSong({ ...base(["C"]), bars: 4 }, id);
    p = repeatSection(p, p.song!.parts[0].id, id);
    expect(sections(p).map((s) => s.bars)).toEqual([4, 4]);
    p = { ...p, bars: 6 };
    expect(sections(p).map((s) => s.bars)).toEqual([6, 6]);
    p = unlinkBlock(p, sections(p)[1].blockId, id);
    expect(sections(p).map((s) => `${s.letter}${s.bars}`)).toEqual(["A6", "B6"]);
    p = { ...p, bars: 3 };
    expect(sections(p).map((s) => `${s.letter}${s.bars}`)).toEqual(["A6", "B3"]);
  });

  it("lengths are saved with the song, and bad ones are dropped", () => {
    let p = ensureSong({ ...base(["C"]), bars: 12 }, id);
    p = { ...addNewSection(p, id), bars: 5 };
    const stored = JSON.parse(JSON.stringify(snapshot({ tonic: "C", scaleId: "ionian" }, p, 0, "standard").progression));
    const song = reviveSong(stored.song)!;
    expect(song.parts.map((x) => x.bars)).toEqual([12, 5]);
    const bad = reviveSong({ ...stored.song, parts: stored.song.parts.map((x: object, i: number) => ({ ...x, bars: i ? "long" : 400 })) })!;
    expect(bad.parts.map((x) => x.bars)).toEqual([MAX_SECTION_BARS, undefined]);
  });

  it("the page as it was left is newer than the song's copy: reopening keeps it", () => {
    let p = addNewSection(ensureSong({ ...base(["C"]), bars: 4 }, id), id);
    // changes made in B and never written back: more chords, a new length
    p = { ...p, chords: [chord("F"), chord("G")], bars: 6 };
    const stored = JSON.parse(JSON.stringify(p)) as Progression;
    const back = settle(commit({ ...stored, song: reviveSong(stored.song) }));
    expect(back.chords.map((c) => c.ref.root)).toEqual(["F", "G"]);
    expect(back.bars).toBe(6);
    expect(sections(back).map((s) => `${s.letter}${s.bars}:${s.chords.length}`)).toEqual(["A4:1", "B6:2"]);
  });

  it("a different length is a change worth saving", () => {
    const key = { tonic: "C", scaleId: "ionian" };
    const print = (p: Progression) => fingerprint(snapshot(key, p, 0, "standard"));
    expect(print({ ...base(["C"]), bars: 4 })).not.toBe(print({ ...base(["C"]), bars: 8 }));
    const song = ensureSong({ ...base(["C"]), bars: 4 }, id);
    expect(print({ ...song, bars: 8 })).not.toBe(print(song));
    const idea = reviveIdea({ id: "x", name: "n", key, progression: JSON.parse(JSON.stringify({ ...base(["C"]), bars: 6 })) })!;
    expect(idea.progression.bars).toBe(6);
  });
});

describe("songs from before sections had lengths sound as they did", () => {
  const two = BEAT_LIBRARY.find((p) => (p.bars ?? 1) === 2 && p.steps === 16)!;
  const one = BEAT_LIBRARY.find((p) => (p.bars ?? 1) === 1 && p.steps === 16)!;

  it("how long they used to be", () => {
    expect(autoBeats(8, 16, 0)).toBe(16);
    expect(autoBeats(12, 16, 0)).toBe(24);
    expect(autoBeats(4, 8, 12)).toBe(12);
    expect(autoBeats(0, 8, 12)).toBe(16);
    expect(autoBeats(0, 0, 0)).toBe(0);
    expect(frameItems([chord("C"), chord("G")], 16).map((x) => x.item.ref.root).join("")).toBe("CGCG");
  });

  it("chords alone: the section is as long as they are", () => {
    const p = settle(base(["C", "G", "F"]));
    expect(p.bars).toBe(3);
    expect(p.chords.map((c) => c.ref.root)).toEqual(["C", "G", "F"]);
  });

  it("nothing in it yet: four bars", () => {
    expect(settle(base()).bars).toBe(DEFAULT_BARS);
  });

  it("one chord under a two-bar rhythm used to play twice: now it is written twice", () => {
    const p = settle({ ...base(["C"]), beat: { ...applyPattern(DEFAULT_BEAT, two), on: true } });
    expect(p.bars).toBe(2);
    expect(p.chords.map((c) => c.ref.root)).toEqual(["C", "C"]);
    expect(new Set(p.chords.map((c) => c.id)).size).toBe(2);
    // doing it again changes nothing, and gives the same ids (so a saved idea still matches itself)
    expect(settle(p)).toBe(p);
    expect(settle({ ...base(["C"]), beat: { ...applyPattern(DEFAULT_BEAT, two), on: true } }).chords.map((c) => c.id)).toEqual(p.chords.map((c) => c.id));
  });

  it("a short melody over longer chords used to come round again: now it is written out", () => {
    const m: Melody = { ...EMPTY_MELODY, bars: 1, notes: [{ at: 0, midi: 60 }, { at: 2 * TICKS, midi: 62 }] };
    const p = settle({ ...base(["C", "G", "F", "A"]), melody: m });
    expect(p.bars).toBe(4);
    expect(p.melody!.bars).toBe(4);
    expect(p.melody!.notes.map((x) => x.at / TICKS)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    // it plays exactly what it played before
    expect(tuneBetween(p.melody!, 4, 0, 16).map((h) => h.beat)).toEqual(tuneBetween(m, 4, 0, 16).map((h) => h.beat));
    expect(tileMelody(m, 4, 1)).toEqual({ ...m, bars: 1 });
  });

  it("each section of an old song gets its own length; sections that have one are left alone", () => {
    let p = ensureSong({ ...base(["C", "G"]), beat: { ...applyPattern(DEFAULT_BEAT, one), on: true } }, id);
    p = addNewSection(p, id);
    p = { ...p, chords: [chord("F"), chord("A"), chord("D")] };
    p = addNewSection(p, id);
    p = { ...p, bars: 7 };
    const q = settle(p);
    expect(sections(q).map((s) => `${s.letter}${s.bars}:${s.chords.length}`)).toEqual(["A2:2", "B3:3", "C7:0"]);
    expect(q.bars).toBe(7);
    expect(settle(q)).toEqual(q);
  });
});
