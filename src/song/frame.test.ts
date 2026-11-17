import { describe, expect, it } from "vitest";
import type { ProgChord, Progression } from "../ui/state";
import { MAX_SECTION_BARS, autoBeats, barsText, fitBars, frameBeats, frameItems, stepBars } from "./frame";
import { fingerprint, reviveIdea, snapshot } from "./library";
import { addNewSection, commit, ensureSong, repeatSection, reviveSong, sections, selectBlock, unlinkBlock } from "./structure";

const chord = (root: string, beats = 4): ProgChord => ({ id: root, ref: { root, typeId: "maj" }, beats });
const base = (roots: string[] = []): Progression => ({ chords: roots.map((r) => chord(r)), bpm: 90, pattern: "ring", loop: true });
let n = 0;
const id = () => `f${++n}`;
const total = (xs: { item: { beats: number } }[]) => xs.reduce((a, x) => a + x.item.beats, 0);

describe("the length of a section", () => {
  it("with no length set, a section is as long as what is in it", () => {
    // chords come round until the drums and the melody have finished
    expect(autoBeats(8, 16, 0)).toBe(16);
    expect(autoBeats(12, 16, 0)).toBe(24);
    expect(autoBeats(8, 0, 0)).toBe(8);
    expect(autoBeats(4, 8, 12)).toBe(12);
    // no chords: the longer of drums and melody, the melody in whole rounds of the rhythm
    expect(autoBeats(0, 8, 0)).toBe(8);
    expect(autoBeats(0, 8, 12)).toBe(16);
    expect(autoBeats(0, 0, 12)).toBe(12);
    expect(autoBeats(0, 0, 0)).toBe(0);
    expect(frameBeats(undefined, 4, 8, 16, 0)).toBe(16);
  });

  it("a set length wins over everything in the section", () => {
    expect(frameBeats(4, 4, 8, 16, 32)).toBe(16);
    expect(frameBeats(2, 4, 40, 16, 0)).toBe(8);
    expect(frameBeats(8, 3, 0, 0, 0)).toBe(24); // eight bars of three
    expect(frameBeats(3, 5, 4, 0, 0)).toBe(15);
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

  it("chords shorter than the section come round again until it is over", () => {
    const two = [chord("C"), chord("G")];
    const out = frameItems(two, 32);
    expect(out.map((x) => x.item.ref.root).join("")).toBe("CGCGCGCG");
    expect(out.map((x) => x.index)).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
    expect(total(out)).toBe(32);
    // the same objects are used when nothing is cut
    expect(out[2].item).toBe(two[0]);
  });

  it("the chord that is sounding when the section ends is cut short", () => {
    const three = [chord("C"), chord("G"), chord("F")];
    const out = frameItems(three, 16);
    expect(out.map((x) => x.item.ref.root).join("")).toBe("CGFC");
    expect(total(out)).toBe(16);
    const odd = frameItems([chord("C", 3), chord("G", 3)], 8);
    expect(odd.map((x) => x.item.beats)).toEqual([3, 3, 2]);
    // the list handed in is never changed
    expect(three.every((c) => c.beats === 4)).toBe(true);
  });

  it("chords longer than the section are cut off where it ends", () => {
    const out = frameItems([chord("C"), chord("G"), chord("F"), chord("A")], 10);
    expect(out.map((x) => x.item.ref.root).join("")).toBe("CGF");
    expect(out.map((x) => x.item.beats)).toEqual([4, 4, 2]);
    expect(frameItems([chord("C", 16)], 4).map((x) => x.item.beats)).toEqual([4]);
  });

  it("nothing to play gives nothing", () => {
    expect(frameItems([], 16)).toEqual([]);
    expect(frameItems([chord("C")], 0)).toEqual([]);
  });

  it("a length with no length set plays exactly as it always did", () => {
    const once = [chord("C"), chord("G", 2), chord("F", 2)];
    const len = frameBeats(undefined, 4, 8, 16, 0);
    expect(frameItems(once, len).map((x) => x.item)).toEqual([...once, ...once]);
  });

  it("lengths are written short, and step a bar at a time", () => {
    expect(barsText(16, 4)).toBe("4");
    expect(barsText(6, 4)).toBe("1½");
    expect(barsText(2, 4)).toBe("½");
    expect(barsText(5, 4)).toBe("1.3");
    expect(barsText(24, 3)).toBe("8");
    expect(stepBars(16, 4, 1)).toBe(5);
    expect(stepBars(16, 4, -1)).toBe(3);
    expect(stepBars(6, 4, 1)).toBe(2);
    expect(stepBars(6, 4, -1)).toBe(1);
    expect(stepBars(4, 4, -1)).toBe(1);
    expect(stepBars(32 * 4, 4, 1)).toBe(MAX_SECTION_BARS);
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

  it("a section with no length set stays that way", () => {
    let p = addNewSection(base(["C"]), id);
    expect(p.bars).toBeUndefined();
    expect(sections(p).map((s) => s.bars)).toEqual([undefined, undefined]);
    // setting one leaves the other alone
    p = { ...p, bars: 4 };
    expect(sections(p).map((s) => s.bars)).toEqual([undefined, 4]);
    // and it can be given up again
    p = { ...p, bars: undefined };
    expect(sections(p).map((s) => s.bars)).toEqual([undefined, undefined]);
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
    // songs saved before sections had lengths have none
    const old = reviveSong({ ...stored.song, parts: stored.song.parts.map(({ bars: _bars, ...x }: { bars?: number }) => x) })!;
    expect(old.parts.every((x) => x.bars === undefined)).toBe(true);
  });

  it("the page as it was left is newer than the song's copy: reopening keeps it", () => {
    let p = addNewSection(ensureSong({ ...base(["C"]), bars: 4 }, id), id);
    // changes made in B and never written back: more chords, a new length
    p = { ...p, chords: [chord("F"), chord("G")], bars: 6 };
    const stored = JSON.parse(JSON.stringify(p)) as Progression;
    const back = commit({ ...stored, song: reviveSong(stored.song) });
    expect(back.chords.map((c) => c.ref.root)).toEqual(["F", "G"]);
    expect(back.bars).toBe(6);
    expect(sections(back).map((s) => `${s.letter}${s.bars}:${s.chords.length}`)).toEqual(["A4:1", "B6:2"]);
  });

  it("a different length is a change worth saving", () => {
    const key = { tonic: "C", scaleId: "ionian" };
    const print = (p: Progression) => fingerprint(snapshot(key, p, 0, "standard"));
    expect(print({ ...base(["C"]), bars: 4 })).not.toBe(print(base(["C"])));
    const song = ensureSong(base(["C"]), id);
    expect(print({ ...song, bars: 4 })).not.toBe(print(song));
    expect(print({ ...song, bars: 4 })).toBe(print({ ...song, bars: 4 }));
    // an idea without sections keeps its length too
    const idea = reviveIdea({ id: "x", name: "n", key, progression: JSON.parse(JSON.stringify({ ...base(["C"]), bars: 6 })) })!;
    expect(idea.progression.bars).toBe(6);
  });
});
