import { describe, expect, it } from "vitest";
import { audioTrack, chordsClip, chordsTrack, drumsTrack, songOf, tuneTrack } from "../timeline/testsongs";
import type { TimelineSong } from "../timeline/model";
import { layerOfTrack5 } from "./layers";
import { MAX_TAPS, heardIn, layerOf } from "./taps";
import { planTaps5 } from "./taps5";

const band = (): TimelineSong => songOf([
  chordsTrack("tc", "Chords", { lead: true }), tuneTrack("tm"), tuneTrack("tb", "bass"), drumsTrack("td"),
  audioTrack("tv", "vocals"), audioTrack("ta", "audio"), tuneTrack("th", "melody", "Harmony", { role: "harmony" }), chordsTrack("tx", "Swap"),
]);

describe("which layer each track of the track view's song is painted in", () => {
  it("a bass track in the bass layer, a blank audio track as other, vocals as vocals, a harmony track as harmony", () => {
    const kinds = Object.fromEntries(band().tracks.map((t) => [t.id, layerOfTrack5(t)]));
    expect(kinds).toEqual({ tc: "chords", tm: "melody", tb: "bass", td: "drums", tv: "vocals", ta: "other", th: "harmony", tx: "chords" });
    expect(layerOfTrack5({ kind: "chords", role: "harmony" })).toBe("harmony");
    expect(layerOfTrack5({ kind: "drums", role: "harmony" })).toBe("drums");
  });

  it("every heard track has an ear; recorded tracks are only heard; beyond six, tracks of one layer share", () => {
    const plans = planTaps5(band());
    // (eight tracks in seven layers: the two chords tracks share an ear; tracks of different layers never do)
    expect(MAX_TAPS).toBe(6);
    expect(plans.length).toBe(7);
    const of = layerOf(plans);
    expect(of("tb")).toBe("bass");
    expect(of("ta")).toBe("other");
    expect(of("tv")).toBe("vocals");
    expect(of("th")).toBe("harmony");
    expect(plans.find((p) => p.members.includes("tv"))!.light).toBe(false);
    expect(plans.find((p) => p.members.includes("tb"))!.light).toBe(true);
    expect(plans.find((p) => p.members.includes("tc"))!.members).toContain("tx");
    expect(heardIn(plans)("tm")).toBe(true);
  });

  it("a muted track is not heard by the Canvas, nor one with its fader down, nor the others while one is soloed", () => {
    const s = band();
    expect(heardIn(planTaps5({ ...s, mix: { tm: { mute: true } } }))("tm")).toBe(false);
    expect(heardIn(planTaps5({ ...s, mix: { tm: { db: -60 } } }))("tm")).toBe(false);
    const solo = planTaps5({ ...s, mix: { tb: { solo: true } } });
    expect(solo.map((p) => p.key)).toEqual(["tb"]);
  });

  it("a harmony track whose clip plays instead of the chords at the play line is painted as chords there, and as a harmony elsewhere", () => {
    const s: TimelineSong = { ...songOf([chordsTrack("tc", "Chords", { lead: true }), chordsTrack("th", "Fitted", { role: "harmony" })]), clips: [chordsClip("c1", "tc", 0, 32), chordsClip("h1", "th", 16, 8, { instead: "tc" })] };
    expect(layerOf(planTaps5(s, 18))("th")).toBe("chords");
    expect(layerOf(planTaps5(s, 4))("th")).toBe("harmony");
    expect(layerOf(planTaps5(s, 24))("th")).toBe("harmony");
    // a muted clip plays instead of nothing
    const muted: TimelineSong = { ...s, clips: s.clips.map((c) => (c.id === "h1" ? { ...c, mute: true } : c)) };
    expect(layerOf(planTaps5(muted, 18))("th")).toBe("harmony");
  });
});
