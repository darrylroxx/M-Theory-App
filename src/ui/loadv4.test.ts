import { describe, expect, it } from "vitest";
import { reviveIdea } from "../song/library";
import { SOUND_V } from "../song/migrate";
import { DEFAULT_STATE, STORAGE_KEY, loadV4, type AppStateV4, type ProgChord, type SavedProgression } from "./state";

let n = 0;
const chord = (root: string): ProgChord => ({ id: `c${++n}`, ref: { root, typeId: "maj" }, beats: 4 });
const idea = (id: string, name: string, roots: string[]): SavedProgression => ({
  id, name, key: { tonic: "C", scaleId: "ionian" }, savedAt: 1000, updatedAt: 2000,
  progression: { chords: roots.map(chord), bpm: 96, pattern: "ring", loop: true, bars: 2 },
});
const rootsOf = (i: SavedProgression) => i.progression.chords.map((c) => c.ref.root);

describe("reading a stored version 4 state from a text", () => {
  it("nothing stored gives the state a new app starts with", () => {
    expect(loadV4(null)).toBe(DEFAULT_STATE);
    expect(loadV4("")).toBe(DEFAULT_STATE);
  });

  it("a stored text with two saved ideas gives both back, revived", () => {
    const a = idea("a", "First", ["C", "G"]);
    const b = idea("b", "Second", ["A", "F", "E"]);
    const stored = { ...DEFAULT_STATE, key: { tonic: "D", scaleId: "dorian" }, saved: [a, b], ideaId: "b", tombs: { gone: 5 } };
    const s: AppStateV4 = loadV4(JSON.stringify(stored));
    expect(s.saved.map((i) => [i.id, i.name])).toEqual([["a", "First"], ["b", "Second"]]);
    expect(s.saved.map(rootsOf)).toEqual([["C", "G"], ["A", "F", "E"]]);
    // revived: each is what the library's own reader makes of it, a whole song of today's kind
    expect(s.saved).toEqual([reviveIdea(JSON.parse(JSON.stringify(a))), reviveIdea(JSON.parse(JSON.stringify(b)))]);
    for (const i of s.saved) expect(i.progression.v).toBe(SOUND_V);
    // the rest of the state comes back too
    expect(s.key).toEqual({ tonic: "D", scaleId: "dorian" });
    expect(s.ideaId).toBe("b");
    expect(s.tombs).toEqual({ gone: 5 });
    expect(s.progression.v).toBe(SOUND_V);
  });

  it("an entry in the list that is not an idea is left out, the others stay", () => {
    const s = loadV4(JSON.stringify({ saved: [idea("a", "First", ["C"]), { id: 7 }, null] }));
    expect(s.saved.map((i) => i.id)).toEqual(["a"]);
  });

  it("the same text read twice gives equal states", () => {
    const text = JSON.stringify({ ...DEFAULT_STATE, saved: [idea("a", "First", ["C", "G"])] });
    expect(loadV4(text)).toEqual(loadV4(text));
  });

  it("a text that is not JSON gives the starting state and does not throw", () => {
    expect(() => loadV4("{ not json")).not.toThrow();
    expect(loadV4("{ not json")).toBe(DEFAULT_STATE);
    expect(loadV4("<html>")).toBe(DEFAULT_STATE);
  });

  it("the key the old state is stored under is the one it always was", () => {
    expect(STORAGE_KEY).toBe("m-theory-state-v1");
  });
});
