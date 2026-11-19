import { describe, expect, it } from "vitest";
import type { Track } from "../song/tracks";
import { MAX_TAPS, handOf, layerOf, planKey, planTaps } from "./taps";

const t = (id: string, kind: Track["kind"], o: Partial<Track> = {}): Track => ({ id, kind, name: id, ...o });

describe("which parts of the app's own song the canvas listens to", () => {
  it("a song as it begins: an ear each on the chords, the melody and the drums, listening only for their texture (their notes are known)", () => {
    const plans = planTaps({});
    expect(plans.map((p) => [p.key, p.layer, p.light])).toEqual([
      ["chords", "chords", true],
      ["melody", "melody", true],
      ["drums", "drums", true],
    ]);
    expect(plans.find((p) => p.key === "drums")!.faders).toEqual(["drums"]);
  });

  it("every track has an ear of its own; vocal takes are heard in full; added drum tracks are heard on the one drum bus", () => {
    const plans = planTaps({ tracks: [t("v1", "vocals"), t("d2", "drums"), t("m2", "melody", { role: "harmony" })] });
    const by = Object.fromEntries(plans.map((p) => [p.key, p]));
    expect(by.v1.layer).toBe("vocals");
    expect(by.v1.light).toBe(false);
    expect(by.m2.layer).toBe("harmony");
    expect(by.drums.members).toEqual(["drums", "d2"]);
    expect(by.d2).toBeUndefined();
    expect(handOf(plans)("d2")).toBe("drums");
    expect(layerOf(plans)("m2")).toBe("harmony");
  });

  it("never more than six ears: past that, tracks of one layer share one", () => {
    const tracks = [t("c2", "chords"), t("c3", "chords"), t("m2", "melody"), t("m3", "melody"), t("v1", "vocals"), t("v2", "vocals")];
    const plans = planTaps({ tracks });
    expect(plans.length).toBeLessThanOrEqual(MAX_TAPS);
    // every track is still heard, and painted in its own layer
    const all = plans.flatMap((p) => p.members).sort();
    expect(all).toEqual(["c2", "c3", "chords", "drums", "m2", "m3", "melody", "v1", "v2"]);
    for (const p of plans) for (const id of p.members) expect(layerOf(plans)(id)).toBe(p.layer);
    // a shared ear hears every fader it stands for
    for (const p of plans) expect(p.faders.length).toBeGreaterThanOrEqual(p.layer === "drums" ? 1 : p.members.length);
    // the ears are made again only when the plan changes
    expect(planKey(planTaps({ tracks }))).toBe(planKey(plans));
    expect(planKey(planTaps({ tracks: tracks.slice(1) }))).not.toBe(planKey(plans));
  });
});
