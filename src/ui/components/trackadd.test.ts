/**
 * A track added on the Track page is added plainly and you stay on the Track page; its own page
 * shows it next time, a vocal track included (the Vocals page shows, and records onto, the one just added).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, type AppState } from "../state";
import { trackAdded } from "./TrackPage";

describe("adding a track on the Track page", () => {
  it("a second vocal track: the Vocals page shows it, not the first, and you stay on the Track page", () => {
    let s: AppState = { ...DEFAULT_STATE, pane: "track" };
    s = trackAdded(s, "vocals", "v1").s;
    expect(s.pane).toBe("track");
    expect(s.studio?.vocal).toBe("v1");
    const r = trackAdded({ ...s, pane: "track" }, "vocals", "v2");
    expect(r.track.name).toBe("Vocal 2");
    expect(r.s.pane).toBe("track");
    expect(r.s.studio?.vocal).toBe("v2");
    expect(r.s.progression.tracks?.filter((t) => t.kind === "vocals").map((t) => t.id)).toEqual(["v1", "v2"]);
  });

  it("keeps the rest of the recording setup as it was", () => {
    const s: AppState = { ...DEFAULT_STATE, studio: { countIn: 2, monitor: "effects", vocal: "old" } };
    expect(trackAdded(s, "vocals", "v9").s.studio).toEqual({ countIn: 2, monitor: "effects", vocal: "v9" });
    // another kind leaves the vocal track chosen alone, and is brought forward on its own page
    const d = trackAdded({ ...s, pane: "track" }, "drums", "d2").s;
    expect(d.pane).toBe("track");
    expect(d.studio).toBe(s.studio);
    expect(d.progression.focus?.drums).toBe("d2");
  });
});
