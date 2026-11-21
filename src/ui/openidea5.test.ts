import { describe, expect, it } from "vitest";
import { convertAll } from "../timeline/convert";
import type { App5State } from "./app5";
import { ideaKey5, reidea5 } from "./openidea5";
import { DEFAULT_STATE } from "./state";

const app = (o: Partial<App5State> = {}): App5State => ({ ...convertAll(DEFAULT_STATE, 1), ...o });

describe("the idea on screen, told apart from every other", () => {
  it("an idea is known by its id once saved, and before that by the id it was started with", () => {
    expect(ideaKey5(app({ ideaId: null, draft: "d1" }))).toBe("d1");
    expect(ideaKey5(app({ ideaId: "idea-1", draft: "d1" }))).toBe("idea-1");
    expect(ideaKey5(app({ ideaId: null, draft: undefined }))).toBeNull();
    // + New idea: not saved either, but another idea
    expect(ideaKey5(app({ ideaId: null, draft: "d2" }))).not.toBe(ideaKey5(app({ ideaId: null, draft: "d1" })));
  });

  it("saved for the first time, or gone from the library while open, it is the same idea: its song and what is open stay", () => {
    const one = app({ ideaId: null, draft: "d1" });
    const saved = reidea5(one, "idea-1");
    expect(saved.ideaId).toBe("idea-1");
    expect(saved.draft).toBe("d1");
    expect(saved.song).toBe(one.song);
    expect(saved.session).toBe(one.session);
    expect(saved.clip).toBe(one.clip);
    const deleted = reidea5(saved, null, "d3");
    expect(deleted.ideaId).toBeNull();
    expect(deleted.draft).toBe("d3");
    expect(deleted.song).toBe(one.song);
    // nothing to change: the same state back
    expect(reidea5(saved, "idea-1")).toBe(saved);
  });
});
