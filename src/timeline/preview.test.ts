import { describe, expect, it } from "vitest";
import { setDraft } from "./edit";
import { flatten, type FlattenCtx } from "./flatten";
import type { DrumsClip, MelodyClip } from "./model";
import { draftClipId, previewSong } from "./preview";
import { SIG34, SIG44, bandSong, chordsContent, groove, tune } from "./testsongs";

const ctx: FlattenCtx = { voicingsOf: (chords) => chords.map(() => undefined), buffer: () => undefined };
const spans = (song: ReturnType<typeof bandSong>, track: string) => song.clips.filter((c) => c.track === track && c.kind !== "audio").map((c) => [c.start, c.start + (c as MelodyClip).len]).sort((a, b) => a[0] - b[0]);

describe("hearing a draft with the song", () => {
  it("with no draft the same song object comes back", () => {
    const band = bandSong();
    expect(previewSong(band, "td", 0)).toBe(band);
    expect(previewSong(band, "nope", 0)).toBe(band);
    // a track that records has none
    expect(previewSong(band, "tv", 0)).toBe(band);
  });

  it("a draft with nothing in it yet is not laid in: nothing is covered", () => {
    const band = setDraft(setDraft(setDraft(bandSong(), "td", { ...groove(1), rows: { ...groove(1).rows, kick: "0".repeat(16), snare: "0".repeat(16) } }, SIG44), "tm", tune(2), SIG44), "tc", chordsContent(2, SIG44, []), SIG44);
    expect(previewSong(band, "td", 16)).toBe(band);
    expect(previewSong(band, "tm", 32)).toBe(band);
    expect(previewSong(band, "tc", 0)).toBe(band);
  });

  it("the draft lies at its anchor on its own track, one round of its content long, and covers that track's clips there, in the copy only", () => {
    const g = groove(2);
    const band = setDraft(bandSong(), "td", g, SIG44);
    // (the drums clip of the song lies on bars 5 to 8: beats 16 to 32)
    const heard = previewSong(band, "td", 24);
    expect(heard).not.toBe(band);
    const laid = heard.clips.find((c) => c.id === draftClipId("td")) as DrumsClip;
    expect(laid).toMatchObject({ track: "td", kind: "drums", start: 24, len: 8, off: 0 });
    expect(laid.content).toBe(g);
    expect(spans(heard, "td")).toEqual([[16, 24], [24, 32]]);
    // the stored song is as it was, and so is every other track
    expect(spans(band, "td")).toEqual([[16, 32]]);
    expect(heard.tracks).toBe(band.tracks);
    expect(heard.clips.filter((c) => c.track !== "td")).toEqual(band.clips.filter((c) => c.track !== "td"));
  });

  it("it sounds at its anchor: the drums of the bars it lies on are the draft's", () => {
    // (the song's own rhythm has a snare on the first beat of its first bar only; the draft's on its second bar)
    const band = setDraft(bandSong(), "td", groove(2, SIG44, 1), SIG44);
    const rows = (song: ReturnType<typeof bandSong>, from: number) => {
      const f = flatten(song, ctx, { spans: [{ from, to: from + 8 }], loop: true });
      const beat = f.items[0].extra!.drums[0].beat;
      const at = Math.round((from - f.origin[0]) * beat.div);
      return beat.rows.snare.slice(at, at + 32);
    };
    expect(rows(band, 16)).toBe("3" + "0".repeat(31));
    expect(rows(previewSong(band, "td", 16), 16)).toBe("0".repeat(16) + "3" + "0".repeat(15));
    // where the track has nothing, the draft is heard on its own
    const far = flatten(previewSong(band, "td", 48), ctx, { spans: [{ from: 48, to: 56 }], loop: true });
    expect(far.items[0].extra!.drums.length).toBe(1);
    expect(flatten(band, ctx, { spans: [{ from: 48, to: 56 }], loop: true }).items[0].extra!.drums.length).toBe(0);
  });

  it("a melody draft is laid in the signature it was written in", () => {
    const band = setDraft(bandSong(), "tm", tune(2, [[0, 60]]), SIG34);
    const laid = previewSong(band, "tm", 0).clips.find((c) => c.id === draftClipId("tm")) as MelodyClip;
    expect(laid).toMatchObject({ start: 0, len: 6, sig: SIG34 });
  });

  it("asked again for the same song, track and anchor, the very same song comes back", () => {
    const band = setDraft(bandSong(), "td", groove(1), SIG44);
    const a = previewSong(band, "td", 8);
    expect(previewSong(band, "td", 8)).toBe(a);
    expect(previewSong(band, "td", 12)).not.toBe(a);
  });
});
