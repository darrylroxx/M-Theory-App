import { describe, expect, it } from "vitest";
import type { AppState, ProgChord, Progression, SavedProgression } from "./state";
import { joinOtherTab } from "./othertab";

const chord = (root: string): ProgChord => ({ id: root, ref: { root, typeId: "maj" }, beats: 4 });
const prog = (roots: string[] = []): Progression => ({ chords: roots.map(chord), bpm: 90, pattern: "ring", loop: true });
const key = { tonic: "C", scaleId: "ionian" };
const idea = (id: string, at: number, roots = ["C"]): SavedProgression => ({ id, name: `Idea ${id}`, key, progression: prog(roots), savedAt: at, updatedAt: at });
const tab = (o: Partial<AppState> = {}): AppState => ({ key, progression: prog(["C"]), saved: [], tombs: {}, shapes: {}, myBeats: [], myKits: [], mySounds: [], ideaId: null, ...o }) as AppState;
/** what a tab leaves in storage, read back */
const stored = (s: AppState) => JSON.parse(JSON.stringify(s));
const ids = (s: AppState) => s.saved.map((i) => i.id);

describe("the app open in two tabs", () => {
  it("an idea saved in one tab is kept by the other, whose next change would otherwise write it away", () => {
    const one = tab({ saved: [idea("x", 100)], ideaId: "x" });
    const two = tab({ progression: { ...prog(["C"]), bpm: 91 } });
    // tab 2 hears that tab 1 wrote (or finds it in storage before it writes)
    for (const how of ["theirs", "both"] as const) {
      const after = joinOtherTab(two, stored(one), how, () => "d");
      expect(ids(after)).toEqual(["x"]);
      // its own idea on screen is untouched
      expect(after.progression.bpm).toBe(91);
      expect(after.ideaId).toBeNull();
    }
  });

  it("a deletion in one tab reaches the other; a copy edited later is kept", () => {
    const two = tab({ saved: [idea("x", 100), idea("y", 100)], ideaId: "x" });
    const one = tab({ saved: [idea("y", 100)], tombs: { x: 200 } });
    const after = joinOtherTab(two, stored(one), "theirs", () => "d2");
    expect(ids(after)).toEqual(["y"]);
    expect(after.tombs).toEqual({ x: 200 });
    // the idea open here was the one deleted: it stays on screen, not saved
    expect(after.ideaId).toBeNull();
    expect(after.draft).toBe("d2");
    // edited here after it was deleted there: kept
    const edited = tab({ saved: [idea("x", 300)] });
    expect(ids(joinOtherTab(edited, stored(one), "theirs", () => "d"))).toEqual(["x", "y"]);
    // the newer copy of an idea wins
    const newer = joinOtherTab(tab({ saved: [idea("y", 100, ["C"])] }), stored(tab({ saved: [idea("y", 150, ["G"])] })), "theirs", () => "d");
    expect(newer.saved[0].progression.chords.map((c) => c.ref.root)).toEqual(["G"]);
  });

  it("rhythms, kits and sounds kept in the other tab come over too (as it left them, or with this tab's when both changed)", () => {
    const beat = (id: string) => ({ id, name: id, group: "mine", steps: 16, div: 4, rows: {} });
    const sound = (id: string) => ({ id, name: id, sound: {} });
    const two = tab({ myBeats: [beat("a")] as never, mySounds: [sound("s1")] as never });
    const one = tab({ myBeats: [beat("a"), beat("b")] as never, mySounds: [] });
    const theirs = joinOtherTab(two, stored(one), "theirs", () => "d");
    expect(theirs.myBeats.map((b) => b.id)).toEqual(["a", "b"]);
    // deleted there, it goes here too
    expect(theirs.mySounds).toEqual([]);
    // neither has seen the other's: both kept
    const both = joinOtherTab(two, stored(one), "both", () => "d");
    expect(both.myBeats.map((b) => b.id)).toEqual(["a", "b"]);
    expect(both.mySounds.map((s) => s.id)).toEqual(["s1"]);
  });

  it("nothing new: the same state, so nothing is drawn or written again", () => {
    const s = tab({ saved: [idea("x", 100)], tombs: { z: 5 }, shapes: { a: "1" } });
    expect(joinOtherTab(s, stored(s), "theirs", () => "d")).toBe(s);
    expect(joinOtherTab(s, stored(s), "both", () => "d")).toBe(s);
    expect(joinOtherTab(s, null, "theirs", () => "d")).toBe(s);
  });
});
