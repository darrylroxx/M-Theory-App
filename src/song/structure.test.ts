import { describe, expect, it } from "vitest";
import { BEAT_LIBRARY, DEFAULT_BEAT, applyPattern, grooveOf, setStep } from "../audio/beats";
import type { ProgChord, Progression } from "../ui/state";
import { addNewSection, commit, ensureSong, letters, linkState, loadCurrent, mapAllChords, relink, moveBlock, moveBlockTo, nextLetter, removeBlock, repeatSection, reviveSong, sections, selectBlock, sharedCount, unlinkBlock } from "./structure";

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

  it("a section can have its own drum rhythm and its own drum sound; what it does not change follows the first section", () => {
    const backbeat = applyPattern({ ...DEFAULT_BEAT, kit: "808" }, BEAT_LIBRARY.find((x) => x.name === "Backbeat")!);
    let p: Progression = { ...base(["C"]), beat: backbeat };
    p = addNewSection(p, id); // B starts with A's drums
    expect(p.beat!.rows).toEqual(backbeat.rows);
    expect(p.beat!.kit).toBe("808");
    const motorik = BEAT_LIBRARY.find((x) => x.name === "Motorik")!;
    p = { ...p, beat: { ...applyPattern(p.beat!, motorik), kit: "909" } }; // B gets its own rhythm and its own kit
    expect(linkState(p).own).toMatchObject({ groove: true, kit: true, style: false, sound: false });
    p = selectBlock(p, block(p, 0));
    expect(p.beat!.name).toBe("Backbeat");
    expect(p.beat!.kit).toBe("808"); // changing B did not change A
    p = { ...p, beat: setStep(p.beat!, "bell", 3, 3) };
    p = selectBlock(p, block(p, 1));
    expect(p.beat!.name).toBe("Motorik");
    expect(p.beat!.kit).toBe("909");
    p = selectBlock(p, block(p, 0));
    expect(p.beat!.rows.bell[3]).toBe("3"); // the edit was kept with A
    // a repeat of A plays A's rhythm
    p = repeatSection(p, partId(p, "A"), id);
    expect(p.beat!.rows.bell[3]).toBe("3");
    expect(sections(p).map((s) => s.groove!.name)).toEqual(["Backbeat", "Backbeat", "Motorik"]);
    expect(sections(p).map((s) => s.kit!.kit)).toEqual(["808", "808", "909"]);
  });

  it("settings carry over: sections follow the first one, even when it changes later, until they are changed themselves", () => {
    let p: Progression = { ...base(["C"]), pattern: "strum", sound: { voice: "kora" }, beat: { ...DEFAULT_BEAT, kit: "808" } };
    p = addNewSection(p, id); // B
    p = setTray(p, ["F"]);
    p = addNewSection(p, id); // C
    p = setTray(p, ["G"]);
    // B and C have nothing of their own: they are stored as chords only
    expect(p.song!.parts.slice(1).map((x) => Object.keys(x).sort())).toEqual([["chords", "id", "letter"], ["chords", "id", "letter"]]);
    expect(linkState(p)).toMatchObject({ first: false, source: "A" });
    expect(Object.values(linkState(p).own).some(Boolean)).toBe(false);
    // change things in A afterwards: the style, the harp, the melody's harp, the kit, the rhythm, drums on
    p = selectBlock(p, block(p, 0));
    expect(linkState(p).first).toBe(true);
    p = { ...p, pattern: "pinch", feel: { speed: 2 }, sound: { voice: "koto", chorus: 0.4 }, tuneSound: { voice: "vibes" }, beat: { ...applyPattern(p.beat!, BEAT_LIBRARY.find((x) => x.name === "Motorik")!), kit: "909", grit: 0.9 } };
    for (const i of [1, 2]) {
      const q = selectBlock(p, block(p, i));
      expect([q.pattern, q.feel?.speed, q.sound?.voice, q.sound?.chorus, q.tuneSound?.voice, q.beat!.kit, q.beat!.grit, q.beat!.name, q.beat!.on], `section ${i}`).toEqual(["pinch", 2, "koto", 0.4, "vibes", "909", 0.9, "Motorik", true]);
    }
    // now C gets its own style: it keeps it, and still follows everything else
    p = selectBlock(p, block(p, 2));
    p = { ...p, pattern: "bossa" };
    expect(linkState(p).own).toEqual({ style: true, sound: false, tuneSound: false, groove: false, kit: false });
    p = selectBlock(p, block(p, 0));
    p = { ...p, pattern: "ring", sound: { voice: "lyre" } };
    expect(selectBlock(p, block(p, 1)).pattern).toBe("ring"); // B follows
    p = selectBlock(p, block(p, 2));
    expect(p.pattern).toBe("bossa"); // C keeps its own style
    expect(p.sound?.voice).toBe("lyre"); // and follows the harp
    // set back by hand to what A has, it follows again; so does "follow again"
    expect(linkState({ ...p, pattern: "ring", feel: { speed: 2 } }).own.style).toBe(false);
    p = relink(p, "style");
    expect(p.pattern).toBe("ring");
    expect(linkState(p).own.style).toBe(false);
    expect(commit(p).song!.parts[2].style).toBeUndefined();
  });

  it("the chords' harp and the melody's harp are separate, in every section", () => {
    let p: Progression = { ...base(["C"]), sound: { voice: "concert" }, tuneSound: { voice: "glass", echo: 0.5 } };
    p = addNewSection(p, id);
    p = { ...p, sound: { voice: "banjo" } }; // B: its own chord harp
    expect(linkState(p).own).toMatchObject({ sound: true, tuneSound: false });
    expect(p.tuneSound?.voice).toBe("glass");
    p = { ...p, tuneSound: { voice: "kalimba" } }; // and its own melody harp
    p = selectBlock(p, block(p, 0));
    expect([p.sound?.voice, p.tuneSound?.voice, p.tuneSound?.echo]).toEqual(["concert", "glass", 0.5]);
    expect(sections(p).map((s) => [s.sound?.voice, s.tuneSound?.voice])).toEqual([["concert", "glass"], ["banjo", "kalimba"]]);
  });

  it("drums can be off in one section and on in the others", () => {
    let p: Progression = { ...base(["C"]), beat: { ...DEFAULT_BEAT, on: true } };
    p = addNewSection(p, id);
    expect(p.beat!.on).toBe(true);
    p = { ...p, beat: { ...p.beat!, on: false } };
    expect(linkState(p).own.groove).toBe(true);
    expect(sections(p).map((s) => s.groove!.on)).toEqual([true, false]);
    expect(selectBlock(p, block(p, 0)).beat!.on).toBe(true);
  });

  it("when the first section is removed the next one leads, and nothing changes its sound", () => {
    let p: Progression = { ...base(["C"]), pattern: "strum", sound: { voice: "kora" } };
    p = addNewSection(p, id); // B: own style
    p = { ...setTray(p, ["F"]), pattern: "pinch" };
    p = addNewSection(p, id); // C: follows A
    p = setTray(p, ["G"]);
    const before = sections(p).slice(1).map((s) => [s.letter, s.style, s.sound?.voice]);
    p = removeBlock(p, block(p, 0));
    expect(sections(p).map((s) => [s.letter, s.style, s.sound?.voice])).toEqual(before);
    expect(before).toEqual([["B", "pinch", "kora"], ["C", "strum", "kora"]]);
    // B now leads: changing its harp changes C's too, but C kept the old style as its own
    p = selectBlock(p, block(p, 0));
    expect(linkState(p).first).toBe(true);
    p = { ...p, sound: { voice: "lyre" }, pattern: "ring" };
    p = selectBlock(p, block(p, 1));
    expect([p.sound?.voice, p.pattern]).toEqual(["lyre", "strum"]);
  });

  it("songs saved when every section kept its own copy are moved over: equal copies follow, different ones stay their own", () => {
    const groove = (name: string) => ({ ...grooveOf(applyPattern(DEFAULT_BEAT, BEAT_LIBRARY.find((x) => x.name === name)!)) });
    const old = {
      parts: [
        { id: "a", letter: "A", chords: [], groove: groove("Backbeat"), style: "strum" },
        { id: "b", letter: "B", chords: [], groove: groove("Backbeat"), style: "pinch" },
        { id: "c", letter: "C", chords: [], groove: groove("Motorik"), style: "strum" },
      ],
      blocks: [{ id: "1", partId: "a" }, { id: "2", partId: "b" }, { id: "3", partId: "c" }],
      current: "1",
    };
    const song = reviveSong(JSON.parse(JSON.stringify(old)))!;
    expect(song.shared).toMatchObject({ style: "strum" });
    expect(song.shared!.groove!.name).toBe("Backbeat");
    expect(song.parts.map((x) => [x.style, x.groove?.name])).toEqual([[undefined, undefined], ["pinch", undefined], [undefined, "Motorik"]]);
    // on the page it sounds exactly as it was saved
    const p = loadCurrent({ ...base(), song, beat: { ...DEFAULT_BEAT, kit: "707" } });
    expect(sections(p).map((s) => [s.style, s.groove!.name, s.kit!.kit])).toEqual([["strum", "Backbeat", "707"], ["pinch", "Backbeat", "707"], ["strum", "Motorik", "707"]]);
    // saved again and loaded again, nothing moves
    const again = reviveSong(JSON.parse(JSON.stringify(commit(p).song)))!;
    expect(again.parts.map((x) => [x.style, x.groove?.name])).toEqual([[undefined, undefined], ["pinch", undefined], [undefined, "Motorik"]]);
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
