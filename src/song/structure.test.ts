import { describe, expect, it } from "vitest";
import type { ProgChord, Progression } from "../ui/state";
import { addSection, mapAllChords, moveBlock, removeBlock, reviveSong, sections, selectBlock, sharedCount, unlinkBlock } from "./structure";

const chord = (root: string): ProgChord => ({ id: root, ref: { root, typeId: "maj" }, beats: 4 });
const base = (roots: string[] = []): Progression => ({ chords: roots.map(chord), bpm: 90, pattern: "ring", loop: true });
let n = 0;
const id = () => `id${++n}`;
const names = (p: Progression) => sections(p).map((s) => s.name);
const roots = (p: Progression) => p.chords.map((c) => c.ref.root);
const setTray = (p: Progression, rs: string[]): Progression => ({ ...p, chords: rs.map(chord) });

describe("song structure", () => {
  it("the first section names the chords already in the tray", () => {
    const p = addSection(base(["C", "G"]), "verse", id);
    expect(names(p)).toEqual(["Verse"]);
    expect(roots(p)).toEqual(["C", "G"]);
    expect(sections(p)[0].chords.map((c) => c.ref.root)).toEqual(["C", "G"]);
  });

  it("a new kind starts empty, a repeated kind reuses its chords and gets numbers", () => {
    let p = addSection(base(["C", "G"]), "verse", id);
    p = addSection(p, "chorus", id);
    expect(roots(p)).toEqual([]);
    p = setTray(p, ["F", "G"]);
    p = addSection(p, "verse", id);
    expect(roots(p)).toEqual(["C", "G"]);
    p = addSection(p, "chorus", id);
    expect(roots(p)).toEqual(["F", "G"]);
    expect(names(p)).toEqual(["Verse 1", "Chorus 1", "Verse 2", "Chorus 2"]);
    expect(p.song!.parts).toHaveLength(2);
  });

  it("editing one chorus changes every chorus", () => {
    let p = addSection(base(["C"]), "chorus", id);
    p = addSection(p, "verse", id);
    p = addSection(p, "chorus", id);
    p = setTray(p, ["A", "D"]); // edit chorus 2 in the tray
    const s = sections(p);
    expect(s[0].chords.map((c) => c.ref.root)).toEqual(["A", "D"]);
    expect(s[2].chords.map((c) => c.ref.root)).toEqual(["A", "D"]);
    p = selectBlock(p, s[1].blockId);
    expect(roots(p)).toEqual([]);
    p = selectBlock(p, s[0].blockId);
    expect(roots(p)).toEqual(["A", "D"]);
  });

  it("a block can be given its own chords", () => {
    let p = addSection(base(["C"]), "verse", id);
    p = addSection(p, "verse", id);
    const second = sections(p)[1].blockId;
    expect(sharedCount(p, second)).toBe(2);
    p = unlinkBlock(p, second, id);
    expect(sharedCount(p, second)).toBe(1);
    p = setTray(p, ["E"]);
    const s = sections(p);
    expect(s.map((x) => x.chords.map((c) => c.ref.root))).toEqual([["C"], ["E"]]);
    expect(s.map((x) => x.name)).toEqual(["Verse 1", "Verse 2"]);
    expect(unlinkBlock(p, second, id).song!.parts).toHaveLength(2); // already on its own: nothing to do
  });

  it("move and remove", () => {
    let p = addSection(base(["C"]), "intro", id);
    p = addSection(p, "verse", id);
    p = setTray(p, ["G"]);
    p = addSection(p, "outro", id);
    const [intro, verse, outro] = sections(p).map((s) => s.blockId);
    p = moveBlock(p, outro, -1);
    expect(names(p)).toEqual(["Intro", "Outro", "Verse"]);
    expect(moveBlock(p, intro, -1)).toBe(p);
    p = removeBlock(p, outro); // it was selected: the neighbour takes over
    expect(names(p)).toEqual(["Intro", "Verse"]);
    expect(sections(p).find((s) => s.current)!.blockId).toBe(verse);
    expect(roots(p)).toEqual(["G"]);
    expect(p.song!.parts).toHaveLength(2); // the unused part is gone
    p = removeBlock(p, intro);
    p = removeBlock(p, verse);
    expect(p.song).toBeNull();
    expect(roots(p)).toEqual(["G"]); // the tray keeps its chords
  });

  it("changes every chord of the song at once", () => {
    let p = addSection(base(["C"]), "verse", id);
    p = addSection(p, "chorus", id);
    p = setTray(p, ["F"]);
    p = mapAllChords(p, (c) => ({ ...c, beats: 3 }));
    expect(sections(p).flatMap((s) => s.chords.map((c) => c.beats))).toEqual([3, 3]);
    expect(p.chords[0].beats).toBe(3);
    expect(mapAllChords(base(["C"]), (c) => ({ ...c, beats: 2 })).chords[0].beats).toBe(2);
  });

  it("revives stored songs safely", () => {
    expect(reviveSong(undefined)).toBeNull();
    expect(reviveSong({ parts: [], blocks: [] })).toBeNull();
    const p = addSection(addSection(base(["C"]), "verse", id), "chorus", id);
    const again = reviveSong(JSON.parse(JSON.stringify({ ...p.song, current: "nope", blocks: [...p.song!.blocks, { id: "x", partId: "missing" }] })))!;
    expect(again.blocks).toHaveLength(2);
    expect(again.current).toBe(again.blocks[0].id);
  });
});
