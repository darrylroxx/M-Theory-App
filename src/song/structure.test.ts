import { describe, expect, it } from "vitest";
import { BEAT_LIBRARY, DEFAULT_BEAT, applyPattern, grooveOf, setStep } from "../audio/beats";
import type { ProgChord, Progression } from "../ui/state";
import { addNewSection, commit, ensureSong, letterAt, letters, linkState, loadCurrent, mapAllChords, relink, moveBlock, moveBlockTo, removeBlock, repeatSection, reviveSong, sections, selectBlock, sharedCount, unlinkBlock, type Song } from "./structure";

const chord = (root: string): ProgChord => ({ id: root, ref: { root, typeId: "maj" }, beats: 4 });
const base = (roots: string[] = []): Progression => ({ chords: roots.map(chord), bpm: 90, pattern: "ring", loop: true });
let n = 0;
const id = () => `id${++n}`;
/** the letters in playing order (they follow the order the sections first play in) */
const order = (p: Progression) => sections(p).map((s) => s.letter).join("");
const roots = (p: Progression) => p.chords.map((c) => c.ref.root);
const setTray = (p: Progression, rs: string[]): Progression => ({ ...p, chords: rs.map(chord) });
const partId = (p: Progression, letter: string) => sections(p).find((s) => s.letter === letter)!.partId;
/** a stored song's letters in playing order */
const lettersOf = (s: Song) => sections({ ...base(), song: s }).map((x) => x.letter).join("");
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
    p = setTray(p, ["F"]);
    p = addNewSection(p, id); // A B C
    p = setTray(p, ["G"]);
    p = selectBlock(p, block(p, 0));
    p = repeatSection(p, partId(p, "C"), id);
    // C now plays second, so it is B; the old B plays third and is C
    expect(order(p)).toBe("ABCB");
    expect(sections(p).map((s) => s.chords[0]?.ref.root).join("")).toBe("CGFG");
    expect(cur(p)).toBe(1);
    p = addNewSection(p, id);
    expect(order(p)).toBe("ABCDB");
    expect(sections(p).map((s) => s.chords[0]?.ref.root ?? "-").join("")).toBe("CG-FG");
  });

  it("letters follow the playing order: A to Z, then A2 …; after a section is gone the rest close up", () => {
    expect([0, 1, 25, 26, 27, 52].map(letterAt)).toEqual(["A", "B", "Z", "A2", "B2", "A3"]);
    let p = addNewSection(addNewSection(base(["C"]), id), id); // A B C
    p = removeBlock(p, block(p, 1));
    expect(order(p)).toBe("AB");
    expect(order(addNewSection(p, id))).toBe("ABC");
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

  it("moves a block anywhere; whatever plays first is A", () => {
    let p = addNewSection(addNewSection(addNewSection(base(["C"]), id), id), id); // ABCD
    const [a, b, c, d] = sections(p).map((s) => s.blockId);
    const blocks = (q: Progression) => sections(q).map((s) => [a, b, c, d].indexOf(s.blockId)).join("");
    p = moveBlockTo(p, d, 0);
    expect(blocks(p)).toBe("3012");
    expect(order(p)).toBe("ABCD");
    p = moveBlockTo(p, d, 4);
    expect(blocks(p)).toBe("0123");
    p = moveBlockTo(p, a, 2);
    expect(blocks(p)).toBe("1023");
    expect(moveBlockTo(p, a, 1)).toBe(p); // dropped where it already is
    expect(moveBlockTo(p, a, 2)).toBe(p);
    p = moveBlock(p, c, -1);
    expect(blocks(p)).toBe("1203");
    expect(moveBlock(p, b, -1)).toBe(p);
    p = moveBlock(p, b, 1);
    expect(blocks(p)).toBe("2103");
    expect(order(p)).toBe("ABCD");
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

  it("a section can have its own drum rhythm; the kit is the drums track's own, one for the whole song", () => {
    const backbeat = applyPattern({ ...DEFAULT_BEAT, kit: "808" }, BEAT_LIBRARY.find((x) => x.name === "Backbeat")!);
    let p: Progression = { ...base(["C"]), beat: backbeat };
    p = addNewSection(p, id); // B starts with A's drums
    expect(p.beat!.rows).toEqual(backbeat.rows);
    expect(p.beat!.kit).toBe("808");
    const motorik = BEAT_LIBRARY.find((x) => x.name === "Motorik")!;
    p = { ...p, beat: { ...applyPattern(p.beat!, motorik), kit: "909" } }; // B gets its own rhythm, and the kit is changed there
    expect(linkState(p)).toEqual({ first: false, source: "A", own: true });
    p = selectBlock(p, block(p, 0));
    expect(p.beat!.name).toBe("Backbeat"); // changing B's rhythm did not change A's
    expect(p.beat!.kit).toBe("909"); // the kit is one for the whole song
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
    // the song keeps rhythms only: no kit anywhere in it
    expect(JSON.stringify(commit(p).song)).not.toMatch(/"kit"/);
  });

  it("every first track has one sound in every section: changed in any section, it changes for the whole song", () => {
    let p: Progression = { ...base(["C"]), pattern: "strum", sound: { voice: "kora" }, beat: { ...DEFAULT_BEAT, kit: "808" } };
    p = addNewSection(p, id); // B
    p = setTray(p, ["F"]);
    p = addNewSection(p, id); // C
    p = setTray(p, ["G"]);
    // B and C have nothing of their own: they are stored as chords only (and their colours)
    expect(p.song!.parts.slice(1).map((x) => Object.keys(x).sort())).toEqual([["chords", "color", "id"], ["chords", "color", "id"]]);
    // change the style, the chords' harp, the melody's harp and the kit in B
    p = selectBlock(p, block(p, 1));
    p = { ...p, pattern: "pinch", feel: { speed: 2 }, sound: { voice: "koto", chorus: 0.4 }, tuneSound: { voice: "lyre" }, beat: { ...p.beat!, kit: "909", grit: 0.9 } };
    for (const i of [0, 1, 2]) {
      const q = selectBlock(p, block(p, i));
      expect([q.pattern, q.feel?.speed, q.sound?.voice, q.sound?.chorus, q.tuneSound?.voice, q.beat!.kit, q.beat!.grit], `section ${i}`).toEqual(["pinch", 2, "koto", 0.4, "lyre", "909", 0.9]);
    }
    // and in A: the same everywhere again
    p = selectBlock(p, block(p, 0));
    p = { ...p, pattern: "ring", sound: { voice: "folk" } };
    expect(selectBlock(p, block(p, 2)).pattern).toBe("ring");
    expect(selectBlock(p, block(p, 2)).sound?.voice).toBe("folk");
    // nothing about the sound is kept in the song's sections
    const song = commit(p).song!;
    for (const x of [song.shared!, ...song.parts]) for (const k of ["style", "feel", "sound", "tuneSound", "kit"]) expect(k in x, k).toBe(false);
    // no chip for the sound: the only thing a section can have of its own is its drum rhythm
    expect(linkState(selectBlock(p, block(p, 1)))).toEqual({ first: false, source: "A", own: false });
  });

  it("the drum rhythm carries over: sections follow the first one, even when it changes later, until changed themselves", () => {
    let p: Progression = { ...base(["C"]), beat: { ...DEFAULT_BEAT, on: true } };
    p = addNewSection(p, id); // B
    p = addNewSection(p, id); // C
    p = selectBlock(p, block(p, 0));
    expect(linkState(p).first).toBe(true);
    p = { ...p, beat: applyPattern(p.beat!, BEAT_LIBRARY.find((x) => x.name === "Motorik")!) };
    for (const i of [1, 2]) expect(selectBlock(p, block(p, i)).beat!.name, `section ${i}`).toBe("Motorik");
    // C gets its own rhythm: it keeps it
    p = selectBlock(p, block(p, 2));
    p = { ...p, beat: applyPattern(p.beat!, BEAT_LIBRARY.find((x) => x.name === "Backbeat")!) };
    expect(linkState(p).own).toBe(true);
    p = selectBlock(p, block(p, 0));
    p = { ...p, beat: { ...p.beat!, swing: 0.3 } };
    expect(selectBlock(p, block(p, 1)).beat!.swing).toBe(0.3); // B follows
    p = selectBlock(p, block(p, 2));
    expect(p.beat!.name).toBe("Backbeat"); // C keeps its own
    // "follow again" puts A's rhythm back
    p = relink(p);
    expect(p.beat!.name).toBe("Motorik");
    expect(p.beat!.swing).toBe(0.3);
    expect(linkState(p).own).toBe(false);
    expect(commit(p).song!.parts[2].groove).toBeUndefined();
  });

  it("the chords' harp and the melody's harp are separate, and each is one for the whole song", () => {
    let p: Progression = { ...base(["C"]), sound: { voice: "concert" }, tuneSound: { voice: "glass", echo: 0.5 } };
    p = addNewSection(p, id);
    p = { ...p, sound: { voice: "folk" } }; // in B: the chord harp
    expect(p.tuneSound?.voice).toBe("glass");
    p = selectBlock(p, block(p, 0));
    expect([p.sound?.voice, p.tuneSound?.voice, p.tuneSound?.echo]).toEqual(["folk", "glass", 0.5]);
    p = { ...p, tuneSound: { voice: "lyre" } }; // in A: the melody harp
    p = selectBlock(p, block(p, 1));
    expect([p.sound?.voice, p.tuneSound?.voice]).toEqual(["folk", "lyre"]);
  });

  it("drums can be off in one section and on in the others", () => {
    let p: Progression = { ...base(["C"]), beat: { ...DEFAULT_BEAT, on: true } };
    p = addNewSection(p, id);
    expect(p.beat!.on).toBe(true);
    p = { ...p, beat: { ...p.beat!, on: false } };
    expect(linkState(p).own).toBe(true);
    expect(sections(p).map((s) => s.groove!.on)).toEqual([true, false]);
    expect(selectBlock(p, block(p, 0)).beat!.on).toBe(true);
  });

  it("when the first section is removed or moved, the next one leads, and every section keeps its rhythm", () => {
    const rhythm = (name: string) => BEAT_LIBRARY.find((x) => x.name === name)!;
    let p: Progression = { ...base(["C"]), pattern: "strum", sound: { voice: "kora" }, beat: { ...applyPattern(DEFAULT_BEAT, rhythm("Backbeat")), on: true } };
    p = addNewSection(p, id); // B: own rhythm
    p = { ...setTray(p, ["F"]), beat: applyPattern(p.beat!, rhythm("Motorik")) };
    p = addNewSection(p, id); // C: follows A
    p = setTray(p, ["G"]);
    const before = sections(p).slice(1).map((s) => [s.partId, s.groove!.name]);
    expect(before.map((x) => x[1])).toEqual(["Motorik", "Backbeat"]);
    // moved to the front: each still plays what it did
    const moved = moveBlockTo(p, block(p, 2), 0);
    expect(sections(moved).map((s) => s.groove!.name)).toEqual(["Backbeat", "Backbeat", "Motorik"]);
    p = removeBlock(p, block(p, 0));
    expect(sections(p).map((s) => [s.partId, s.groove!.name])).toEqual(before);
    // the two that are left are now A and B, and the sound is the song's as it was
    expect(order(p)).toBe("AB");
    expect([p.pattern, p.sound?.voice]).toEqual(["strum", "kora"]);
    // B now leads: changing its rhythm changes C's too
    p = selectBlock(p, block(p, 0));
    expect(linkState(p).first).toBe(true);
    p = { ...p, beat: { ...p.beat!, swing: 0.4 } };
    p = selectBlock(p, block(p, 1));
    expect(p.beat!.name).toBe("Backbeat"); // C kept A's old rhythm as its own
  });

  it("songs saved when every section kept its own copy are moved over: equal rhythms follow, different ones stay their own", () => {
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
    expect(Object.keys(song.shared!)).toEqual(["groove"]);
    expect(song.shared!.groove!.name).toBe("Backbeat");
    expect(song.parts.map((x) => [x.groove?.name, "style" in x])).toEqual([[undefined, false], [undefined, false], ["Motorik", false]]);
    // on the page it plays the rhythms it was saved with
    const p = loadCurrent({ ...base(), song, beat: { ...DEFAULT_BEAT, kit: "707" } });
    expect(sections(p).map((s) => s.groove!.name)).toEqual(["Backbeat", "Backbeat", "Motorik"]);
    // saved again and loaded again, nothing moves
    const again = reviveSong(JSON.parse(JSON.stringify(commit(p).song)))!;
    expect(again.parts.map((x) => x.groove?.name)).toEqual([undefined, undefined, "Motorik"]);
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
    expect(lettersOf(s)).toBe("ABCB");
    expect(s.current).toBe("3");
    expect(s.parts.find((x) => x.id === "c")!.chords[0].ref.root).toBe("F");
  });

  it("the playing style is the chords track's own: one for the whole song, wherever it is changed", () => {
    let p = ensureSong({ ...base(["C", "G"]), pattern: "strum" }, id);
    p = addNewSection(p, id);
    expect(p.pattern).toBe("strum");
    p = { ...setTray(p, ["F"]), pattern: "pinch" };
    p = selectBlock(p, block(p, 0));
    expect(p.pattern).toBe("pinch");
    // a block given its own letter: the style is still the one
    p = repeatSection(p, partId(p, "B"), id);
    p = unlinkBlock(p, block(p, 2), id);
    expect(sections(p).map((x) => x.letter)).toEqual(["A", "B", "C"]);
    expect(selectBlock(p, block(p, 2)).pattern).toBe("pinch");
    // an old song's per-section styles are let go when it is loaded (see song/migrate for what plays)
    const saved = JSON.parse(JSON.stringify(p.song));
    saved.parts[1].style = "bossa";
    saved.shared.style = "strum";
    const back = reviveSong(saved)!;
    expect(back.parts.map((x) => "style" in x)).toEqual([false, false, false]);
    expect("style" in back.shared!).toBe(false);
  });

  it("chord lengths in half beats travel with their section", () => {
    let p = ensureSong({ ...base(["C", "G"]), chords: [{ ...chord("C"), beats: 2.5 }, { ...chord("G"), beats: 1.5 }] }, id);
    p = addNewSection(p, id);
    p = selectBlock(p, block(p, 0));
    expect(p.chords.map((c) => c.beats)).toEqual([2.5, 1.5]);
  });
});
