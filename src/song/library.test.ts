import { describe, expect, it } from "vitest";
import type { ProgChord, Progression, SavedProgression } from "../ui/state";
import { autoName, describeIdea, exportIdeas, fingerprint, importIdeas, isBlank, mergeIdeas, reviveIdea, snapshot, toPush } from "./library";
import { addNewSection, ensureSong, repeatSection, sections, selectBlock } from "./structure";

const chord = (root: string): ProgChord => ({ id: root, ref: { root, typeId: "maj" }, beats: 4 });
const prog = (roots: string[] = []): Progression => ({ chords: roots.map(chord), bpm: 90, pattern: "ring", loop: true });
const key = { tonic: "B", scaleId: "ionian" };
const idea = (id: string, at: number, roots = ["C"]): SavedProgression => ({ id, name: `Idea ${id}`, key, progression: prog(roots), savedAt: at, updatedAt: at });
const remote = (i: SavedProgression) => ({ id: i.id, updatedAt: i.updatedAt!, json: JSON.stringify(i) });
const fp = (p: Progression, capo = 0) => fingerprint(snapshot(key, p, capo, "standard"));

describe("what counts as a change", () => {
  it("chords, tempo, capo and structure do; the selected section does not", () => {
    const a = prog(["C", "G"]);
    expect(fp(a)).toBe(fp(prog(["C", "G"])));
    expect(fp(a)).not.toBe(fp(prog(["C", "F"])));
    expect(fp(a)).not.toBe(fp({ ...a, bpm: 120 }));
    expect(fp(a)).not.toBe(fp(a, 2));
    let song = ensureSong(a);
    expect(fp(song)).not.toBe(fp(a));
    song = addNewSection(song);
    const first = sections(song)[0].blockId;
    expect(fp(selectBlock(song, first))).toBe(fp(song));
    // edits in the tray count even before they are written back into the song
    expect(fp({ ...song, chords: [chord("A")] })).not.toBe(fp(song));
  });
  it("knows a blank page", () => {
    expect(isBlank(prog())).toBe(true);
    expect(isBlank(prog(["C"]))).toBe(false);
    expect(isBlank(ensureSong(prog()))).toBe(false);
  });
});

describe("names and summaries", () => {
  it("numbers ideas per key", () => {
    expect(autoName(key, [])).toBe("B Major idea 1");
    expect(autoName(key, [{ ...idea("a", 1), name: "B Major idea 1" }])).toBe("B Major idea 2");
    expect(autoName({ tonic: "F#", scaleId: "dorian" }, [])).toBe("F♯ Dorian idea 1");
  });
  it("describes an idea by its sections, else its chords", () => {
    expect(describeIdea(idea("a", 1, ["C", "G"]))).toBe("C · G");
    const ab = addNewSection(prog(["C"]));
    const song = repeatSection(ab, ab.song!.parts[0].id);
    expect(describeIdea({ ...idea("a", 1), progression: song })).toBe("A B A");
    expect(describeIdea(idea("a", 1, []))).toBe("Empty");
  });
});

describe("syncing between devices", () => {
  it("adds ideas from the cloud and keeps the newer copy", () => {
    const m = mergeIdeas([idea("a", 10, ["C"]), idea("b", 50, ["D"])], {}, [remote(idea("a", 20, ["E"])), remote(idea("b", 40, ["F"])), remote(idea("c", 5, ["G"]))]);
    const by = Object.fromEntries(m.ideas.map((i) => [i.id, i.progression.chords[0].ref.root]));
    expect(by).toEqual({ a: "E", b: "D", c: "G" });
    expect(m.ideas.map((i) => i.id)).toEqual(["b", "a", "c"]); // newest first
  });
  it("a deletion beats older copies, on either side", () => {
    // deleted on another device
    expect(mergeIdeas([idea("a", 10)], {}, [{ id: "a", updatedAt: 20, deleted: true }]).ideas).toEqual([]);
    // …unless it was edited here afterwards
    expect(mergeIdeas([idea("a", 30)], {}, [{ id: "a", updatedAt: 20, deleted: true }]).ideas).toHaveLength(1);
    // deleted here: the cloud's older copy does not come back
    const m = mergeIdeas([], { a: 20 }, [remote(idea("a", 10))]);
    expect(m.ideas).toEqual([]);
    expect(m.tombs).toEqual({ a: 20 });
    // …but a newer cloud copy does
    expect(mergeIdeas([], { a: 20 }, [remote(idea("a", 30))]).ideas).toHaveLength(1);
  });
  it("ignores unreadable cloud copies", () => {
    expect(mergeIdeas([idea("a", 1)], {}, [{ id: "z", updatedAt: 9, json: "{nope" }, { id: "y", updatedAt: 9, json: "{}" }]).ideas).toHaveLength(1);
  });
  it("sends only what the cloud is missing", () => {
    const ideas = [idea("a", 10), idea("b", 20)];
    const known = new Map([["a", 10], ["b", 5], ["gone", -7]]);
    const push = toPush(ideas, { gone: 7, dead: 9 }, known);
    expect(push.map((r) => [r.id, r.updatedAt, !!r.deleted])).toEqual([["b", 20, false], ["dead", 9, true]]);
    expect(JSON.parse(push[0].json!).id).toBe("b");
    expect(toPush(ideas, {}, new Map([["a", 10], ["b", 20]]))).toEqual([]);
  });
});

describe("backups", () => {
  it("round-trips ideas, including song structure", () => {
    const song = addNewSection(prog(["C"]));
    const back = importIdeas(exportIdeas([{ ...idea("a", 3), progression: song, capo: 2, tuningId: "standard" }, idea("b", 4)]));
    expect(back.map((i) => i.id)).toEqual(["a", "b"]);
    expect(describeIdea(back[0])).toBe("A B");
    expect(back[0].capo).toBe(2);
  });
  it("rejects files that are not backups", () => {
    expect(importIdeas("hello")).toEqual([]);
    expect(importIdeas('{"ideas":[{"id":1}]}')).toEqual([]);
    expect(reviveIdea(null)).toBeNull();
  });
  it("a revived song shows the selected section's chords", () => {
    const song = addNewSection(prog(["C"])); // B selected, empty
    const stored = { ...idea("a", 1), progression: { ...song, chords: [chord("X")] } }; // stale tray chords in the file
    expect(reviveIdea(JSON.parse(JSON.stringify(stored)))!.progression.chords).toEqual([]);
  });
});
