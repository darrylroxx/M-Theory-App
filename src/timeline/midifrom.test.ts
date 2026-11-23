// The MIDI file holds what is heard: a chords clip's playing style counts from where the clip's content starts, as it
// does when the song plays, also when the clip starts part-way through a stretch (another track's clip began before it).
import { describe, expect, it } from "vitest";
import { flatten, type FlattenCtx } from "./flatten";
import { midi5 } from "./export";
import type { TimelineSong } from "./model";
import { midiTracks } from "./renderlog";
import { chordsClip, chordsContent, chordsTrack, drumsClip, drumsTrack, songOf } from "./testsongs";
import { voicingsFor, type VoicingCtx } from "./voicing";
import { chordShape } from "../guitar/arrange";
import { getTuning } from "../guitar/tunings";

const tuning = getTuning("standard");
const v: VoicingCtx = { tuning, capo: 0, avoidBarre: true, shapeOf: (ref, id) => chordShape(ref, tuning, 0, true, id) };
const ctx: FlattenCtx = { voicingsOf: voicingsFor(v), buffer: () => undefined };

/** two bars of chords in a style that is two bars long, at a beat; the drums run from the song's start, so all of it is one stretch */
const song = (at: number): TimelineSong =>
  songOf([chordsTrack("tc", "Chords", { lead: true }), drumsTrack("td", "Drums", { lead: true })], {
    clips: [chordsClip("c1", "tc", at, 8, { content: { ...chordsContent(2), style: "clave" } }), drumsClip("d1", "td", 0, 16)],
  });
/** the chords track's notes, as "tick:pitch" counted from a beat */
const notes = (s: TimelineSong, from: number): string[] => {
  const file = midi5(s, flatten(s, ctx), "song");
  const tpq = (file[12] << 8) | file[13];
  const track = midiTracks(file).find((t) => t.name === "Chords");
  return (track?.notes ?? []).filter((n) => n.on).map((n) => `${n.tick - from * tpq}:${n.midi}`);
};

describe("a chords clip in a MIDI file", () => {
  it("is one stretch with the drums, the clip starting a bar into it", () => {
    const f = flatten(song(4), ctx);
    expect(new Set(f.origin)).toEqual(new Set([0]));
    expect(f.items[0].extra!.chords.filter((c) => c.track === "tc").map((c) => [c.at, c.from])).toEqual([[4, 4], [8, 4]]);
  });
  it("plays its style from the clip's own start: the same notes as the same clip at the start of a stretch", () => {
    const early = notes(song(0), 0);
    const late = notes(song(4), 4);
    expect(early.length).toBeGreaterThan(4);
    expect(late).toEqual(early);
  });
  it("the style's two bars are not alike (so counting from the stretch's start would have been heard as another rhythm)", () => {
    const file = midi5(song(0), flatten(song(0), ctx), "song");
    const bar = 4 * ((file[12] << 8) | file[13]);
    const ticks = notes(song(0), 0).map((n) => Number(n.split(":")[0]));
    const first = [...new Set(ticks.filter((t) => t < bar))];
    const second = [...new Set(ticks.filter((t) => t >= bar).map((t) => t - bar))];
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(first).not.toEqual(second);
  });
});
