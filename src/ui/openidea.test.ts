import { describe, expect, it } from "vitest";
import { clipSource, copySection } from "../song/clip";
import { soloSection } from "../song/structure";
import type { AppState, Progression } from "./state";
import { ideaKey, reidea } from "./openidea";

const C = { tonic: "C", scaleId: "ionian" };
const prog = (roots: string[]): Progression => ({ chords: roots.map((root, i) => ({ id: `c${i}`, ref: { root, typeId: "maj" }, beats: 4 })), bpm: 100, pattern: "ring", loop: true, bars: 2 }) as Progression;
const app = (p: Progression, o: Partial<AppState> = {}): AppState => ({ key: C, progression: p, saved: [], ...o }) as AppState;
/** Section A of an idea with no sections yet (block ""), copied: is A the copy's source, in the idea on screen? */
const isSource = (s: AppState) => clipSource(s.clip?.section, ideaKey(s), soloSection(s.progression));
const copyA = (s: AppState): AppState => ({ ...s, clip: { section: copySection(s.progression, "", s.key, ideaKey(s))! } });

describe("the idea on screen, told apart from every other", () => {
  it("a section copied in one idea not saved yet can be pasted into the next one (its A is not taken for the source)", () => {
    const one = copyA(app(prog(["C", "G"]), { ideaId: null, draft: "d1" }));
    expect(isSource(one)).toBe(true);
    // + New idea (not saved either, no sections either): its A is called "" too, but it is another idea
    const next: AppState = { ...one, ideaId: null, draft: "d2", progression: prog([]) };
    expect(isSource(next)).toBe(false);
    // a copy kept from before ideas not saved had an id, in such an idea: still its own
    const old = copyA(app(prog(["C"]), { ideaId: null }));
    expect(old.clip?.section?.idea).toBeNull();
    expect(isSource(old)).toBe(true);
  });

  it("saved for the first time, or gone from the library while open, it is the same idea: the copy is still its own", () => {
    const one = copyA(app(prog(["C", "G"]), { ideaId: null, draft: "d1" }));
    const saved = reidea(one, "idea-1");
    expect(saved.ideaId).toBe("idea-1");
    expect(saved.clip?.section?.idea).toBe("idea-1");
    expect(isSource(saved)).toBe(true);
    const deleted = reidea(saved, null, "d3");
    expect(isSource(deleted)).toBe(true);
    // a copy from another idea stays that idea's
    const other = { ...one, clip: { section: { ...one.clip!.section!, idea: "idea-9" } } };
    expect(reidea(other, "idea-1").clip?.section?.idea).toBe("idea-9");
  });

  it("the very block, or any block of the same section", () => {
    const c = { ...copySection(prog(["C"]), "", C, "i")!, block: "b1", part: "A" };
    expect(clipSource(c, "i", { blockId: "b2", partId: "A" })).toBe(true);
    expect(clipSource(c, "i", { blockId: "b2", partId: "A" }, true)).toBe(false);
    expect(clipSource(c, "i", { blockId: "b1", partId: "A" }, true)).toBe(true);
    expect(clipSource(c, "j", { blockId: "b1", partId: "A" })).toBe(false);
    expect(clipSource(undefined, "i", { blockId: "b1", partId: "A" })).toBe(false);
  });
});
