import { describe, expect, it } from "vitest";
import type { Track } from "../song/tracks";
import { MAX_TAPS, handOf, heardIn, layerOf, planKey, planTaps } from "./taps";

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

  it("every track has an ear of its own; vocal takes are heard in full; every drums track is heard on its own desk's fader", () => {
    const plans = planTaps({ tracks: [t("v1", "vocals"), t("d2", "drums"), t("m2", "melody", { role: "harmony" })] });
    const by = Object.fromEntries(plans.map((p) => [p.key, p]));
    expect(by.v1.layer).toBe("vocals");
    expect(by.v1.light).toBe(false);
    expect(by.m2.layer).toBe("harmony");
    expect(by.m2.faders).toEqual(["m2"]);
    // Drums 2 has a desk of its own, out through its own fader: an ear and a hand of its own, in the drums layer
    expect(by.drums.members).toEqual(["drums"]);
    expect(by.d2).toEqual({ key: "d2", layer: "drums", faders: ["d2"], members: ["d2"], light: true });
    expect(handOf(plans)("d2")).toBe("d2");
    expect(layerOf(plans)("d2")).toBe("drums");
    expect(layerOf(plans)("m2")).toBe("harmony");
  });

  it("a muted track has no ear and no hand; when a track is soloed, only the soloed ones are heard", () => {
    const tracks = [t("d2", "drums"), t("c2", "chords", { role: "harmony" }), t("v1", "vocals")];
    const muted = planTaps({ tracks, mix: { d2: { mute: true } } });
    expect(muted.map((p) => p.key)).toEqual(["chords", "melody", "drums", "c2", "v1"]);
    expect(muted.flatMap((p) => p.members)).not.toContain("d2");
    const solo = planTaps({ tracks, mix: { d2: { solo: true }, c2: { solo: true } } });
    expect(solo.map((p) => [p.key, p.layer])).toEqual([
      ["d2", "drums"],
      ["c2", "harmony"],
    ]);
    // muting a track remakes the ears
    expect(planKey(muted)).not.toBe(planKey(planTaps({ tracks })));
  });

  it("a fader pulled all the way down is as silent as a mute: no ear, no hand, and the notes it was told of are not painted", () => {
    const tracks = [t("d2", "drums"), t("h1", "melody", { role: "harmony" })];
    const plans = planTaps({ tracks, mix: { h1: { db: -60 }, d2: { db: -12 } } });
    expect(plans.map((p) => p.key)).toEqual(["chords", "melody", "drums", "d2"]);
    const heard = heardIn(plans);
    expect(["chords", "melody", "drums", "d2"].every(heard)).toBe(true);
    expect(heard("h1")).toBe(false);
    // muted, or left out by a solo
    expect(heardIn(planTaps({ tracks, mix: { d2: { mute: true } } }))("d2")).toBe(false);
    expect(heardIn(planTaps({ tracks, mix: { h1: { solo: true } } }))("drums")).toBe(false);
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
    for (const p of plans) expect(p.faders).toEqual(p.members);
    // two drums tracks among many: they share an ear before anything else, and both are still heard
    const more = planTaps({ tracks: [t("d2", "drums"), t("c2", "chords"), t("m2", "melody"), t("h1", "melody", { role: "harmony" }), t("v1", "vocals")] });
    expect(more.length).toBe(MAX_TAPS);
    const drums = more.filter((p) => p.layer === "drums");
    expect(drums).toHaveLength(1);
    expect(drums[0].faders.sort()).toEqual(["d2", "drums"]);
    // (and the melody and the harmony keep a hand each: two lines are never one)
    expect(more.filter((p) => p.layer === "melody").map((p) => p.members)).toEqual([["melody"], ["m2"]]);
    expect(more.find((p) => p.key === "h1")!.layer).toBe("harmony");
    // the ears are made again only when the plan changes
    expect(planKey(planTaps({ tracks }))).toBe(planKey(plans));
    expect(planKey(planTaps({ tracks: tracks.slice(1) }))).not.toBe(planKey(plans));
  });

  it("a swap that plays instead of the chords is painted as the chords; a pad beside them as a harmony", () => {
    const swap = t("c2", "chords", { role: "harmony", harmony: { from: "chords", option: "tritone", marks: {} } });
    const pad = t("c3", "chords", { role: "harmony", harmony: { from: "chords", option: "pad", marks: {} } });
    const fit = t("c4", "chords", { role: "harmony", harmony: { from: "melody", option: "fit", marks: {} } });
    const plans = planTaps({ tracks: [swap, pad, fit], mix: { chords: { mute: true } } });
    const layer = layerOf(plans);
    expect(layer("c2")).toBe("chords");
    expect(layer("c3")).toBe("harmony");
    expect(layer("c4")).toBe("chords");
    // the chords it replaces are muted, so they get no hand at all
    expect(heardIn(plans)("chords")).toBe(false);
  });
});
