import { describe, expect, it } from "vitest";
import { BEAT_LIBRARY, DEFAULT_BEAT, applyPattern, barHasHits, barsOf, clearBeat, levelAt, patternBar, setStep, spreadBeat } from "../audio/beats";
import type { ProgChord, Progression } from "../ui/state";
import { itemTune, sectionStart, type PlayItem } from "../audio/patterns";
import { DEFAULT_BARS, MAX_SECTION_BARS, autoBeats, barAt, chordAt, barIndex, barsOr, barsText, fitBars, fitLoop, frameBeats, frameItems, inFrame, inLoop, loopSection, sliceItems, stepBars, tapLoop, type LoopSpan } from "./frame";
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

  it("the chord sounding at a beat of the section: an added chords track's own, not the first track's", () => {
    // Chords 2 (Am Dm F G, half a bar each) under Chords 1 (C G, a bar each): at beat 4.5 F sounds, not Dm
    const two = [{ beats: 2 }, { beats: 2 }, { beats: 2 }, { beats: 2 }];
    expect([0, 1.9, 2, 4.5, 7.9].map((b) => chordAt(two, b, 8))).toEqual([0, 0, 1, 2, 3]);
    // past the last chord, past the end of the section, before it starts: none
    expect(chordAt([{ beats: 8 }, { beats: 8 }], 9, 32)).toBe(1);
    expect(chordAt([{ beats: 8 }, { beats: 8 }], 17, 32)).toBe(-1);
    expect(chordAt([{ beats: 8 }, { beats: 8 }], 12, 12)).toBe(-1);
    expect(chordAt([{ beats: 8 }], -0.1, 12)).toBe(-1);
    expect(chordAt([], 0, 12)).toBe(-1);
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

  it("an idea opened again is the idea that was saved, whatever order its fields were set in", () => {
    const key = { tonic: "C", scaleId: "ionian" };
    const print = (p: Progression) => fingerprint(snapshot(key, p, 0, "standard"));
    // the piano, then Bright, then the electric piano: set in that order, loaded back in another
    const p: Progression = { ...base(["C"]), bars: 4, tones: { chords: { inst: "piano", bright: 0.7, keys: "electric" } } };
    const back = reviveIdea({ id: "x", name: "n", key, progression: JSON.parse(JSON.stringify(p)) })!.progression;
    expect(print(back)).toBe(print(p));
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

describe("looping bars", () => {
  // A has 4 bars, B has 8, and A comes again at the end
  const layout = [{ block: "a1", bars: 4 }, { block: "b", bars: 8 }, { block: "a2", bars: 4 }];
  const bar = (block: string, n: number) => ({ block, bar: n });
  /** tap one bar after another, starting with no loop */
  const taps = (...bars: { block: string; bar: number }[]) => bars.reduce<LoopSpan | null>((sp, b) => tapLoop(layout, sp, b), null);
  const count = (sp: LoopSpan | null) => (sp ? barIndex(layout, sp.to) - barIndex(layout, sp.from) + 1 : 0);

  it("every bar has its place in the song", () => {
    expect(barIndex(layout, bar("a1", 0))).toBe(0);
    expect(barIndex(layout, bar("b", 0))).toBe(4);
    expect(barIndex(layout, bar("a2", 3))).toBe(15);
    expect(barIndex(layout, bar("gone", 0))).toBe(-1);
    expect(barAt(layout, 0)).toEqual(bar("a1", 0));
    expect(barAt(layout, 4)).toEqual(bar("b", 0));
    expect(barAt(layout, 15)).toEqual(bar("a2", 3));
    expect(barAt(layout, 16)).toBeNull();
  });

  it("tap bar 1, bar 2, bar 3: three bars loop", () => {
    expect(taps(bar("b", 0))).toEqual({ from: bar("b", 0), to: bar("b", 0) });
    expect(taps(bar("b", 0), bar("b", 1))).toEqual({ from: bar("b", 0), to: bar("b", 1) });
    expect(taps(bar("b", 0), bar("b", 1), bar("b", 2))).toEqual({ from: bar("b", 0), to: bar("b", 2) });
    // and a fourth, a fifth … as many as are tapped
    expect(count(taps(...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => bar("b", n))))).toBe(8);
    // in any order
    expect(taps(bar("b", 2), bar("b", 1), bar("b", 3), bar("b", 0))).toEqual({ from: bar("b", 0), to: bar("b", 3) });
  });

  it("a bar further off brings everything in between with it", () => {
    const sp = taps(bar("b", 1), bar("b", 6));
    expect(sp).toEqual({ from: bar("b", 1), to: bar("b", 6) });
    expect([0, 1, 4, 6, 7].map((n) => inLoop(layout, sp, bar("b", n)))).toEqual([false, true, true, true, false]);
  });

  it("a loop can run across sections", () => {
    const sp = taps(bar("b", 6), bar("a1", 2));
    expect(sp).toEqual({ from: bar("a1", 2), to: bar("b", 6) });
    expect(inLoop(layout, sp, bar("a1", 3)) && inLoop(layout, sp, bar("b", 0)) && !inLoop(layout, sp, bar("a2", 0))).toBe(true);
    // whole sections: first bar of one to the last bar of another
    expect(count(taps(bar("a1", 0), bar("b", 7)))).toBe(12);
    // and on into a third
    expect(count(taps(bar("a1", 0), bar("b", 7), bar("a2", 3)))).toBe(16);
  });

  it("a bar at either end of the loop comes off again; the last one lets the loop go", () => {
    const three = taps(bar("b", 0), bar("b", 1), bar("b", 2));
    expect(tapLoop(layout, three, bar("b", 2))).toEqual({ from: bar("b", 0), to: bar("b", 1) });
    expect(tapLoop(layout, three, bar("b", 0))).toEqual({ from: bar("b", 1), to: bar("b", 2) });
    // across a section boundary too
    const across = taps(bar("a1", 3), bar("b", 0));
    expect(tapLoop(layout, across, bar("b", 0))).toEqual({ from: bar("a1", 3), to: bar("a1", 3) });
    expect(tapLoop(layout, across, bar("a1", 3))).toEqual({ from: bar("b", 0), to: bar("b", 0) });
    expect(taps(bar("b", 2), bar("b", 2))).toBeNull();
  });

  it("a bar in the middle of the loop becomes the whole loop", () => {
    const five = taps(bar("b", 0), bar("b", 4));
    expect(tapLoop(layout, five, bar("b", 2))).toEqual({ from: bar("b", 2), to: bar("b", 2) });
  });

  it("a whole section at once", () => {
    const span = loopSection("b", 8);
    expect(span).toEqual({ from: bar("b", 0), to: bar("b", 7) });
    expect(inLoop(layout, span, bar("b", 7)) && !inLoop(layout, span, bar("a2", 0)) && !inLoop(layout, span, bar("a1", 3))).toBe(true);
    // the two A's are different places in the song
    expect(inLoop(layout, loopSection("a1", 4), bar("a2", 0))).toBe(false);
    expect(inLoop(layout, null, bar("b", 0))).toBe(false);
  });

  it("a loop keeps up with the song: shorter sections, moved sections, removed sections", () => {
    const span = { from: bar("b", 2), to: bar("b", 7) };
    // B cut to 4 bars: the loop ends where B now ends
    expect(fitLoop([{ block: "a1", bars: 4 }, { block: "b", bars: 4 }], span)).toEqual({ from: bar("b", 2), to: bar("b", 3) });
    // sections swapped: the loop still runs forwards
    const across = { from: bar("a1", 2), to: bar("b", 1) };
    expect(fitLoop([{ block: "b", bars: 8 }, { block: "a1", bars: 4 }], across)).toEqual({ from: bar("b", 1), to: bar("a1", 2) });
    // a section it needs is gone: so is the loop
    expect(fitLoop([{ block: "a1", bars: 4 }], span)).toBeNull();
    expect(fitLoop(layout, null)).toBeNull();
  });

  it("the looped bars are cut out of the section exactly, and know where in it they start", () => {
    const sec = [chord("C", 8), chord("G", 4), chord("F", 4)]; // four bars of four
    // bar 2 alone: the second half of C
    const one = sliceItems(sec, 4, 8);
    expect(one.map((x) => [x.item.ref.root, x.item.beats, x.from, x.index])).toEqual([["C", 4, 4, 0]]);
    // bars 2 and 3
    expect(sliceItems(sec, 4, 12).map((x) => [x.item.ref.root, x.item.beats, x.from])).toEqual([["C", 4, 4], ["G", 4, 8]]);
    // the whole section is the section itself
    const all = sliceItems(sec, 0, 16);
    expect(all.map((x) => x.item)).toEqual(sec);
    expect(all.map((x) => x.from)).toEqual([0, 8, 12]);
    expect(sliceItems(sec, 16, 20)).toEqual([]);
    expect(sec.map((c) => c.beats)).toEqual([8, 4, 4]);
  });

  it("drums, melody and style count from the start of the section, wherever playing starts", () => {
    const item = (beats: number, more: Partial<PlayItem> = {}): PlayItem => ({ midi: [], beats, ...more });
    // a new section starts the count again
    expect(sectionStart(item(4), 0, 0, 0)).toBe(0);
    expect(sectionStart(item(4), 1, 4, 0)).toBe(0);
    expect(sectionStart(item(4, { section: true }), 2, 8, 0)).toBe(8);
    // starting two bars into a section: the section began two bars before
    expect(sectionStart(item(4, { from: 8 }), 0, 0, 0)).toBe(-8);
    // looping bar 3 of a melody plays bar 3's note, not bar 1's
    const m: Melody = { ...EMPTY_MELODY, bars: 4, notes: [{ at: 0, midi: 60 }, { at: 8 * TICKS, midi: 67 }] };
    const tune = { m, bar: 4, swing: 0 };
    expect(itemTune([item(4, { from: 8, tune })]).map((h) => [h.beat, h.midi])).toEqual([[0, 67]]);
    expect(itemTune([item(4, { from: 4, tune })])).toEqual([]);
    expect(itemTune([item(16, { tune })]).map((h) => h.midi)).toEqual([60, 67]);
  });
});
