import { DEFAULT_BEAT } from "../../audio/beats";
/**
 * A track added on the Track page is added plainly and you stay on the Track page; its own page
 * shows it next time, a vocal track included (the Vocals page shows, and records onto, the one just added).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_STATE, type AppState } from "../state";
import { trackAdded } from "./TrackPage";
import { emptyVocal } from "./VocalsPage";

describe("adding a track on the Track page", () => {
  it("a second vocal track: the Vocals page shows it, not the first, and you stay on the Track page", () => {
    let s: AppState = { ...DEFAULT_STATE, pane: "track" };
    s = trackAdded(s, "vocals", "v1").s;
    expect(s.pane).toBe("track");
    expect(s.studio?.vocal).toBe("v1");
    // Vocal 1 has nothing recorded yet: + uses it, no second empty one
    const same = trackAdded({ ...s, pane: "track" }, "vocals", "v2");
    expect(same.existing).toBe(true);
    expect(same.s.progression.tracks?.filter((t) => t.kind === "vocals").map((t) => t.id)).toEqual(["v1"]);
    s = { ...s, progression: { ...s.progression, tracks: s.progression.tracks!.map((t) => (t.id === "v1" ? { ...t, takes: [{ id: "k" } as never] } : t)) } };
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
    // (the first drums track is empty in a new idea: + brings it forward instead of making a second)
    const d0 = trackAdded({ ...s, pane: "track" }, "drums", "d2");
    expect(d0.existing).toBe(true);
    expect(d0.track.id).toBe("drums");
    const full: AppState = { ...s, progression: { ...s.progression, beat: { ...DEFAULT_BEAT, on: true, rows: { ...DEFAULT_BEAT.rows, kick: "1000100010001000" } } } };
    const d = trackAdded({ ...full, pane: "track" }, "drums", "d2").s;
    expect(d.pane).toBe("track");
    expect(d.studio).toBe(s.studio);
    expect(d.progression.focus?.drums).toBe("d2");
  });
});

describe("+ on the Vocals page", () => {
  it("uses the vocal track on screen when nothing is recorded on it (its tab lights up), else another empty one, else none", () => {
    const v1 = { id: "v1", kind: "vocals" as const, name: "Vocal 1" };
    const v2 = { id: "v2", kind: "vocals" as const, name: "Vocal 2" };
    const took = (t: typeof v1) => ({ ...t, takes: [{ id: "k" } as never] });
    expect(emptyVocal([v1, v2], v1)?.id).toBe("v1");
    expect(emptyVocal([took(v1), v2], took(v1))?.id).toBe("v2");
    expect(emptyVocal([took(v1)], took(v1))).toBeUndefined();
  });
});
