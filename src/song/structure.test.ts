import { describe, expect, it } from "vitest";
import { BEAT_LIBRARY, DEFAULT_BEAT, applyPattern, setStep } from "../audio/beats";
import type { ProgChord, Progression } from "../ui/state";
import { addNewSection, ensureSong, letters, mapAllChords, moveBlock, moveBlockTo, nextLetter, removeBlock, repeatSection, reviveSong, sections, selectBlock, sharedCount, unlinkBlock } from "./structure";

const chord = (root: string): ProgChord => ({ id: root, ref: { root, typeId: "maj" }, beats: 4 });
const base = (roots: string[] = []): Progression => ({ chords: roots.map(chord), bpm: 90, pattern: "ring", loop: true });
let n = 0;
const id = () => `id${++n}`;
const order = (p: Progression) => sections(p).map((s) => s.letter).join("");
const roots = (p: Progression) => p.chords.map((c) => c.ref.root);
const setTray = (p: Progression, rs: string[]): Progression => ({ ...p, chords: rs.map(chord) });
const partId = (p: Progression, letter: string) => p.song!.parts.find((x) => x.letter === letter)!.id;
const block = (p: Progression, i: number) => sections(p)[i].blockId;
const cur = (p: Progression) => sections(p).findIndex((s) => s.current);

describe("song structure", () => {
  it("the tray becomes section A; a new section gets the next letter and starts empty", () => {
    let p = ensureSong(base(["C", "G"]), id);
    expect(order(p)).toBe("A");
    expect(roots(p)).toEqual(["C", "G"]);
    p = addNewSection(p, id);
    expect(order(p)).toBe("AB");
    expect(roots(p)).toEqual([]);
    expect(cur(p)).toBe(1);
    // straight from a plain tray: A is made first
    expect(order(addNewSection(base(["C"]), id))).toBe("AB");
  });

  it("the same letter again is the same music: edit one, both change", () => {
    let p = addNewSection(base(["C"]), id);
    p = setTray(p, ["F", "G"]);
    p = repeatSection(p, partId(p, "A"), id);
    expect(order(p)).toBe("ABA");
    expect(roots(p)).toEqual(["C"]);
    p = setTray(p, ["A", "D"]); // edit the second A in the tray
    const s = sections(p);
    expect(s[0].chords.map((c) => c.ref.root)).toEqual(["A", "D"]);
    expect(s[1].chords.map((c) => c.ref.root)).toEqual(["F", "G"]);
    expect(p.song!.parts).toHaveLength(2);
  });

  it("new and pasted sections land right after the selected one", () => {
    let p = addNewSection(base(["C"]), id); // A B, B selected
    p = addNewSection(p, id); // A B C
    p = selectBlock(p, block(p, 0));
    p = repeatSection(p, partId(p, "C"), id);
    expect(order(p)).toBe("ACBC");
    expect(cur(p)).toBe(1);
    p = addNewSection(p, id);
    expect(order(p)).toBe("ACDBC");
  });

  it("letters: first free one, reused after a section is gone", () => {
    expect(nextLetter([])).toBe("A");
    expect(nextLetter([{ letter: "A" }, { letter: "C" }])).toBe("B");
    expect(nextLetter("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => ({ letter })))).toBe("A2");
    let p = addNewSection(addNewSection(base(["C"]), id), id); // A B C
    p = removeBlock(p, block(p, 1));
    expect(order(p)).toBe("AC");
    expect(order(addNewSection(p, id))).toBe("ACB");
  });

  it("each letter once, for the drum section picker", () => {
    let p = addNewSection(base(["C"]), id);
    p = repeatSection(p, partId(p, "A"), id);
    const l = letters(p);
    expect(l.map((x) => [x.letter, x.current])).toEqual([["A", true], ["B", false]]);
    // the selected block is the one picked for its letter
    expect(l[0].blockId).toBe(block(p, 2));
  });

  it("a block can be unlinked into a letter of its own", () => {
    let p = ensureSong(base(["C"]), id);
    p = repeatSection(p, partId(p, "A"), id);
    const second = block(p, 1);
    expect(sharedCount(p, second)).toBe(2);
    p = unlinkBlock(p, second, id);
    expect(order(p)).toBe("AB");
    p = setTray(p, ["E"]);
    expect(sections(p).map((x) => x.chords.map((c) => c.ref.root))).toEqual([["C"], ["E"]]);
    expect(unlinkBlock(p, second, id).song!.parts).toHaveLength(2); // already on its own: nothing to do
  });

  it("moves a block anywhere", () => {
    let p = addNewSection(addNewSection(addNewSection(base(["C"]), id), id), id); // ABCD
    const [a, b, c, d] = sections(p).map((s) => s.blockId);
    p = moveBlockTo(p, d, 0);
    expect(order(p)).toBe("DABC");
    p = moveBlockTo(p, d, 4);
    expect(order(p)).toBe("ABCD");
    p = moveBlockTo(p, a, 2);
    expect(order(p)).toBe("BACD");
    expect(moveBlockTo(p, a, 1)).toBe(p); // dropped where it already is
    expect(moveBlockTo(p, a, 2)).toBe(p);
    p = moveBlock(p, c, -1);
    expect(order(p)).toBe("BCAD");
    expect(moveBlock(p, b, -1)).toBe(p);
    p = moveBlock(p, b, 1);
    expect(order(p)).toBe("CBAD");
    expect(sections(p).find((s) => s.current)!.blockId).toBe(d); // the selection does not move
  });

  it("remove: the neighbour takes over; removing the last one leaves the tray", () => {
    let p = addNewSection(base(["C"]), id);
    p = setTray(p, ["G"]);
    p = addNewSection(p, id); // ABC, C selected
    const [a, b, c] = sections(p).map((s) => s.blockId);
    p = removeBlock(p, c);
    expect(order(p)).toBe("AB");
    expect(sections(p).find((s) => s.current)!.blockId).toBe(b);
    expect(roots(p)).toEqual(["G"]);
    expect(p.song!.parts).toHaveLength(2); // the unused part is gone
    p = removeBlock(removeBlock(p, a), b);
    expect(p.song).toBeNull();
    expect(roots(p)).toEqual(["G"]);
  });

  it("each section keeps its own drum rhythm", () => {
    const backbeat = applyPattern({ ...DEFAULT_BEAT, kit: "808" }, BEAT_LIBRARY.find((x) => x.name === "Backbeat")!);
    let p: Progression = { ...base(["C"]), beat: backbeat };
    p = addNewSection(p, id); // B starts with A's rhythm
    expect(p.beat!.rows).toEqual(backbeat.rows);
    const motorik = BEAT_LIBRARY.find((x) => x.name === "Motorik")!;
    p = { ...p, beat: { ...applyPattern(p.beat!, motorik), kit: "909" } }; // B gets its own rhythm; the kit is the song's
    p = selectBlock(p, block(p, 0));
    expect(p.beat!.name).toBe("Backbeat");
    expect(p.beat!.kit).toBe("909");
    p = { ...p, beat: setStep(p.beat!, "bell", 3, 3) };
    p = selectBlock(p, block(p, 1));
    expect(p.beat!.name).toBe("Motorik");
    p = selectBlock(p, block(p, 0));
    expect(p.beat!.rows.bell[3]).toBe("3"); // the edit was kept with A
    // a repeat of A plays A's rhythm
    p = repeatSection(p, partId(p, "A"), id);
    expect(p.beat!.rows.bell[3]).toBe("3");
    expect(sections(p).map((s) => s.groove!.name)).toEqual(["Backbeat", "Backbeat", "Motorik"]);
  });

  it("changes every chord of the song at once", () => {
    let p = addNewSection(base(["C"]), id);
    p = setTray(p, ["F"]);
    p = mapAllChords(p, (c) => ({ ...c, beats: 3 }));
    expect(sections(p).flatMap((s) => s.chords.map((c) => c.beats))).toEqual([3, 3]);
    expect(p.chords[0].beats).toBe(3);
    expect(mapAllChords(base(["C"]), (c) => ({ ...c, beats: 2 })).chords[0].beats).toBe(2);
  });

  it("revives stored songs safely, and gives old named sections letters", () => {
    expect(reviveSong(undefined)).toBeNull();
    expect(reviveSong({ parts: [], blocks: [] })).toBeNull();
    const p = addNewSection(base(["C"]), id);
    const again = reviveSong(JSON.parse(JSON.stringify({ ...p.song, current: "nope", blocks: [...p.song!.blocks, { id: "x", partId: "missing" }] })))!;
    expect(again.blocks).toHaveLength(2);
    expect(again.current).toBe(again.blocks[0].id);
    // a song saved with Intro / Verse / Chorus: letters in playing order
    const old = {
      parts: [{ id: "v", kind: "verse", chords: [chord("C")] }, { id: "c", kind: "chorus", chords: [chord("F")] }, { id: "i", kind: "intro", chords: [] }],
      blocks: [{ id: "1", partId: "i" }, { id: "2", partId: "v" }, { id: "3", partId: "c" }, { id: "4", partId: "v" }],
      current: "3",
    };
    const s = reviveSong(old)!;
    expect(s.blocks.map((b) => s.parts.find((x) => x.id === b.partId)!.letter).join("")).toBe("ABCB");
    expect(s.current).toBe("3");
    expect(s.parts.find((x) => x.id === "c")!.chords[0].ref.root).toBe("F");
  });

  it("each section keeps its own playing style, and a new section carries the current one on", () => {
    let p = ensureSong({ ...base(["C", "G"]), pattern: "strum" }, id);
    p = addNewSection(p, id);
    expect(p.pattern).toBe("strum");
    p = { ...setTray(p, ["F"]), pattern: "pinch" };
    p = selectBlock(p, block(p, 0));
    expect(p.pattern).toBe("strum");
    p = selectBlock(p, block(p, 1));
    expect(p.pattern).toBe("pinch");
    expect(sections(p).map((x) => x.style)).toEqual(["strum", "pinch"]);
    // a block given its own letter takes a copy of the style with it
    p = repeatSection(p, partId(p, "B"), id);
    p = unlinkBlock(p, block(p, 2), id);
    expect(sections(p).map((x) => `${x.letter}:${x.style}`)).toEqual(["A:strum", "B:pinch", "C:pinch"]);
    // saved and loaded: known styles stay, unknown ones are dropped (the section then follows the song)
    const saved = JSON.parse(JSON.stringify(p.song));
    saved.parts[0].style = "nonsense";
    const back = reviveSong(saved)!;
    expect(back.parts.map((x) => x.style)).toEqual([undefined, "pinch", "pinch"]);
  });

  it("chord lengths in half beats travel with their section", () => {
    let p = ensureSong({ ...base(["C", "G"]), chords: [{ ...chord("C"), beats: 2.5 }, { ...chord("G"), beats: 1.5 }] }, id);
    p = addNewSection(p, id);
    p = selectBlock(p, block(p, 0));
    expect(p.chords.map((c) => c.beats)).toEqual([2.5, 1.5]);
  });
});
