/**
 * A track added on the Track page opens its page on the new track, ready to edit: the same for
 * every kind, a vocal track included (the Vocals page shows, and records onto, the one just added).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, type AppState } from "../state";
import { trackAdded } from "./TrackPage";

describe("adding a track on the Track page", () => {
  it("a second vocal track: the Vocals page opens on it, not on the first", () => {
    let s: AppState = DEFAULT_STATE;
    s = trackAdded(s, "vocals", "v1").s;
    expect(s.pane).toBe("vocals");
    expect(s.studio?.vocal).toBe("v1");
    const r = trackAdded({ ...s, pane: "track" }, "vocals", "v2");
    expect(r.track.name).toBe("Vocal 2");
    expect(r.s.pane).toBe("vocals");
    expect(r.s.studio?.vocal).toBe("v2");
    expect(r.s.progression.tracks?.filter((t) => t.kind === "vocals").map((t) => t.id)).toEqual(["v1", "v2"]);
  });

  it("keeps the rest of the recording setup as it was", () => {
    const s: AppState = { ...DEFAULT_STATE, studio: { countIn: 2, monitor: "effects", vocal: "old" } };
    expect(trackAdded(s, "vocals", "v9").s.studio).toEqual({ countIn: 2, monitor: "effects", vocal: "v9" });
    // another kind leaves the vocal track chosen alone, and is brought forward on its own page
    const d = trackAdded(s, "drums", "d2").s;
    expect(d.pane).toBe("drums");
    expect(d.studio).toBe(s.studio);
    expect(d.progression.focus?.drums).toBe("d2");
  });
});
