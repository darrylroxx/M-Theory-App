// Which plugin each kind of track mounts: a composer and a sound window for every kind, and which kinds share one.
// (It names no component: a later step that changes a line of the registry does not have to change this.)
import { describe, expect, it } from "vitest";
import { CLIP_OF, type TrackKind } from "../../timeline/model";
import { PLUGINS } from "./registry";

const KINDS = Object.keys(CLIP_OF) as TrackKind[];
/** the kinds that are written, not recorded */
const WRITTEN = KINDS.filter((k) => CLIP_OF[k] !== "audio");
const mounts = (x: unknown): boolean => typeof x === "function" || (typeof x === "object" && x !== null);

describe("the registry of plugins", () => {
  it("has a line for every kind of track, and for nothing else", () => {
    expect(Object.keys(PLUGINS).sort()).toEqual([...KINDS].sort());
    expect(KINDS.length).toBe(6);
  });

  it("every kind of track has a composer and a sound window", () => {
    for (const k of KINDS) {
      // (both are said for every kind; a track that records says "the record window" with null)
      expect(Object.keys(PLUGINS[k]).sort(), k).toEqual(["compose", "sound"]);
      for (const part of ["compose", "sound"] as const) {
        const c = PLUGINS[k][part];
        expect(c === null || mounts(c), `${k}.${part}`).toBe(true);
      }
    }
    // a track that is written has both as windows of its own
    for (const k of WRITTEN) {
      expect(mounts(PLUGINS[k].compose), `${k}: composer`).toBe(true);
      expect(mounts(PLUGINS[k].sound), `${k}: sound window`).toBe(true);
    }
  });

  it("Bass and Melody share a composer, and a sound window", () => {
    expect(PLUGINS.bass.compose).toBe(PLUGINS.melody.compose);
    expect(PLUGINS.bass.sound).toBe(PLUGINS.melody.sound);
  });

  it("Vocals and Blank share one: both open the same window to record in, and the same sound", () => {
    expect(PLUGINS.audio.compose).toBe(PLUGINS.vocals.compose);
    expect(PLUGINS.audio.sound).toBe(PLUGINS.vocals.sound);
  });

  it("Chords, Melody and Drums each have a composer of their own (so one can be rebuilt without the others)", () => {
    const own = new Set([PLUGINS.chords.compose, PLUGINS.melody.compose, PLUGINS.drums.compose]);
    expect(own.size).toBe(3);
    // (and the drums a sound window of their own: a kit is not an instrument)
    expect(PLUGINS.drums.sound).not.toBe(PLUGINS.chords.sound);
  });
});
