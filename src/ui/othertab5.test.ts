import { describe, expect, it } from "vitest";
import { backupId, convertAll, convertIdea } from "../timeline/convert";
import { fixture } from "../timeline/fixtures5";
import { emptySong5, type SavedIdea } from "../timeline/library5";
import type { App5State } from "./app5";
import { joinOtherTab5 } from "./othertab5";
import { DEFAULT_STATE } from "./state";

const key = { tonic: "C", scaleId: "ionian" };
const idea = (id: string, at: number, bpm = 90): SavedIdea => ({ id, name: `Idea ${id}`, key, song: emptySong5(bpm), savedAt: at, updatedAt: at });
const tab = (o: Partial<App5State> = {}): App5State => ({ ...convertAll(DEFAULT_STATE, 1), tombs: {}, ideaId: null, ...o });
/** what a tab leaves in storage, read back */
const stored = (s: App5State) => JSON.parse(JSON.stringify(s));
const ids = (s: App5State) => s.saved.map((i) => i.id);

describe("the app open in two tabs", () => {
  it("an idea saved in one tab is kept by the other, whose next change would otherwise write it away", () => {
    const one = tab({ saved: [idea("x", 100)], ideaId: "x" });
    const two = tab({ song: emptySong5(91) });
    // tab 2 hears that tab 1 wrote (or finds it in storage before it writes)
    for (const how of ["theirs", "both"] as const) {
      const after = joinOtherTab5(two, stored(one), how, () => "d");
      expect(ids(after)).toEqual(["x"]);
      // its own idea on screen is untouched
      expect(after.song).toBe(two.song);
      expect(after.session).toBe(two.session);
      expect(after.ideaId).toBeNull();
    }
  });

  it("a deletion in one tab reaches the other; a copy edited later is kept", () => {
    const two = tab({ saved: [idea("x", 100), idea("y", 100)], ideaId: "x" });
    const one = tab({ saved: [idea("y", 100)], tombs: { x: 200 } });
    const after = joinOtherTab5(two, stored(one), "theirs", () => "d2");
    expect(ids(after)).toEqual(["y"]);
    expect(after.tombs).toEqual({ x: 200 });
    // the idea open here was the one deleted: it stays on screen, not saved
    expect(after.ideaId).toBeNull();
    expect(after.draft).toBe("d2");
    // edited here after it was deleted there: kept
    const edited = tab({ saved: [idea("x", 300)] });
    expect(ids(joinOtherTab5(edited, stored(one), "theirs", () => "d"))).toEqual(["x", "y"]);
    // the newer copy of an idea wins
    const newer = joinOtherTab5(tab({ saved: [idea("y", 100, 90)] }), stored(tab({ saved: [idea("y", 150, 120)] })), "theirs", () => "d");
    expect(newer.saved[0].song.bpm).toBe(120);
  });

  it("saving a rhythm in one tab reaches the other; kits and sounds too (as it left them, or with this tab's when both changed)", () => {
    const beat = (id: string) => ({ id, name: id, group: "mine", steps: 16, div: 4, rows: {} });
    const sound = (id: string) => ({ id, name: id, sound: {} });
    const two = tab({ myBeats: [beat("a")] as never, mySounds: [sound("s1")] as never });
    const one = tab({ myBeats: [beat("a"), beat("b")] as never, mySounds: [] });
    const theirs = joinOtherTab5(two, stored(one), "theirs", () => "d");
    expect(theirs.myBeats.map((b) => b.id)).toEqual(["a", "b"]);
    // deleted there, it goes here too
    expect(theirs.mySounds).toEqual([]);
    // neither has seen the other's: both kept
    const both = joinOtherTab5(two, stored(one), "both", () => "d");
    expect(both.myBeats.map((b) => b.id)).toEqual(["a", "b"]);
    expect(both.mySounds.map((s) => s.id)).toEqual(["s1"]);
    // a chord shape chosen there is here too
    expect(joinOtherTab5(tab({ shapes: { a: "1" } }), stored(tab({ shapes: { b: "2" } })), "both", () => "d").shapes).toEqual({ a: "1", b: "2" });
  });

  it("nothing new: the same state, so nothing is drawn or written again", () => {
    const one = tab({ saved: [idea("x", 100)], myBeats: [{ id: "a", name: "a" }] as never });
    expect(joinOtherTab5(one, stored(one), "theirs", () => "d")).toBe(one);
    expect(joinOtherTab5(one, stored(one), "both", () => "d")).toBe(one);
    expect(joinOtherTab5(one, null, "theirs", () => "d")).toBe(one);
    expect(joinOtherTab5(one, "rubbish" as never, "both", () => "d")).toBe(one);
  });

  it("a backup entry is not doubled by a second tab, and one deleted in either tab stays deleted", () => {
    const c = convertIdea(fixture(1));
    const one = tab({ saved: [c.idea, c.backup] });
    // both tabs converted the same old data: the same entries, once
    const two = tab({ saved: [c.idea, c.backup] });
    expect(joinOtherTab5(two, stored(one), "both", () => "d")).toBe(two);
    expect(joinOtherTab5(two, stored(one), "theirs", () => "d")).toBe(two);
    // a tab that has not got them yet takes them in, once each
    const empty = joinOtherTab5(tab(), stored(one), "theirs", () => "d");
    expect(ids(empty).sort()).toEqual(["fixture-1", backupId("fixture-1")].sort());
    expect(empty.saved.find((i) => i.id === backupId("fixture-1"))!.backup).toEqual({ of: "fixture-1" });
    // deleted in the other tab: gone here, and noted
    const deleted = tab({ saved: [c.idea], tombs: { [backupId("fixture-1")]: c.backup.updatedAt! + 10 } });
    const after = joinOtherTab5(one, stored(deleted), "theirs", () => "d");
    expect(ids(after)).toEqual(["fixture-1"]);
    expect(after.tombs).toEqual({ [backupId("fixture-1")]: c.backup.updatedAt! + 10 });
  });
});
