import { describe, expect, it } from "vitest";
import { CLIP_OF, SONG_V, accepts, type ClipKind, type TrackKind } from "./model";

const TRACKS: TrackKind[] = ["chords", "melody", "bass", "drums", "vocals", "audio"];
const CLIPS: ClipKind[] = ["chords", "melody", "drums", "audio"];

describe("the track view's song model", () => {
  it("is stored as version 5", () => {
    expect(SONG_V).toBe(5);
  });

  it("which clip may lie on which track: all 24 pairs", () => {
    // rows: the kind of track; columns: chords, melody, drums, audio
    const table: Record<TrackKind, [boolean, boolean, boolean, boolean]> = {
      chords: [true, false, false, false],
      melody: [false, true, false, false],
      bass: [false, true, false, false],
      drums: [false, false, true, false],
      vocals: [false, false, false, true],
      audio: [false, false, false, true],
    };
    let pairs = 0;
    for (const t of TRACKS) {
      CLIPS.forEach((c, i) => {
        expect(accepts(t, c), `${c} clip on a ${t} track`).toBe(table[t][i]);
        pairs++;
      });
    }
    expect(pairs).toBe(24);
  });

  it("a melody clip lies on a bass track, an audio clip on a vocals track, and a drums clip not on a chords track", () => {
    expect(accepts("bass", "melody")).toBe(true);
    expect(accepts("vocals", "audio")).toBe(true);
    expect(accepts("chords", "drums")).toBe(false);
  });

  it("every kind of track takes exactly one kind of clip: the one it makes", () => {
    for (const t of TRACKS) {
      expect(CLIPS.filter((c) => accepts(t, c))).toEqual([CLIP_OF[t]]);
    }
  });
});
