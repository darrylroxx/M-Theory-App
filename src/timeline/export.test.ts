// The ways out of a song of tracks and clips: the chord sheet and the MIDI file.
import { describe, expect, it } from "vitest";
import { GUITAR } from "../audio/tone";
import { getTuning } from "../guitar/tunings";
import { chart5, hasChords5, midi5 } from "./export";
import { flatten, type FlattenCtx } from "./flatten";
import { midiTracks } from "./renderlog";
import { KEY_C, bandSong, chord, chordsClip, chordsContent, chordsTrack, drumsClip, drumsTrack, melodyClip, songOf, tuneTrack } from "./testsongs";
import type { TimelineSong } from "./model";

const ctx: FlattenCtx = { voicingsOf: (chords) => chords.map(() => undefined), buffer: () => undefined };
const sheet = (song: TimelineSong, name = "Song") => chart5(song, KEY_C, { tuning: getTuning("standard"), capo: 0, voicingsOf: ctx.voicingsOf, name });
const verse = () => chordsContent(4);
const chorus = () => chordsContent(2, undefined, [chord("x1", "F"), chord("x2", "G")]);

/** Verse, Chorus, Verse, Verse: the three verses hold the same chords in separate clips. */
const song = (): TimelineSong => songOf([chordsTrack("tc", "Chords", { lead: true }), drumsTrack("td")], {
  clips: [
    chordsClip("v1", "tc", 0, 16, { content: verse() }), chordsClip("ch", "tc", 16, 8, { content: chorus() }),
    chordsClip("v2", "tc", 24, 16, { content: verse() }), chordsClip("v3", "tc", 40, 16, { content: verse() }),
    drumsClip("d1", "td", 0, 56),
  ],
  markers: [{ id: "m1", beat: 0, name: "Verse" }, { id: "m2", beat: 16, name: "Chorus" }, { id: "m3", beat: 24, name: "Verse" }, { id: "m4", beat: 40, name: "Verse" }],
  end: 56,
});

describe("Chords + tab", () => {
  it("prints the marker names in running order, then each different stretch once", () => {
    const text = sheet(song());
    const lines = text.split("\n");
    expect(lines[0]).toBe("Song | C Major (Ionian) | 96 bpm");
    expect(lines[2]).toBe("Verse Chorus Verse Verse");
    // three equal verses print one
    expect(lines.filter((l) => l.startsWith("[Verse]")).length).toBe(1);
    expect(lines.filter((l) => l.startsWith("[Chorus]")).length).toBe(1);
    expect(text).toContain("[Verse] 4 bars");
    expect(text).toContain("| C | F | G | Am |");
    expect(text).toContain("[Chorus] 2 bars");
    expect(text).toContain("| F | G |");
    // the guitar tab has a line for each string
    expect(lines.filter((l) => /^[A-G][b#]? ?\|/.test(l)).length).toBe(12);
  });

  it("a verse whose chords were changed is printed again; a stretch with no chords says so", () => {
    const s = song();
    const changed: TimelineSong = { ...s, clips: s.clips.map((c) => (c.id === "v3" && c.kind === "chords" ? { ...c, content: chordsContent(4, undefined, [chord("y1", "D", 16, "min")]) } : c)) };
    expect(sheet(changed).split("\n").filter((l) => l.startsWith("[Verse]")).length).toBe(2);
    const gap: TimelineSong = { ...s, clips: s.clips.filter((c) => c.id !== "ch") };
    expect(sheet(gap)).toContain("[Chorus] 2 bars\n(no chords)");
  });

  it("with no markers the whole song is one stretch; what lies before the first marker is a stretch too", () => {
    const s = song();
    const plain = sheet({ ...s, markers: undefined });
    expect(plain.split("\n")[2]).toBe("| C | F | G | Am | F | G | C | F | G | Am | C | F | G | Am |");
    const late = sheet({ ...s, markers: [{ id: "m2", beat: 16, name: "Chorus" }] });
    expect(late.split("\n")[2]).toBe("Start Chorus");
    expect(late).toContain("[Start] 4 bars");
  });

  it("two tracks with one group are under one heading; another chords track has its own", () => {
    // the old first chords track, split by sound: a guitar in the verse, a piano in the chorus
    const s = songOf([
      chordsTrack("t-chords", "Chords", { lead: true, group: "t-chords" }), chordsTrack("t-chords~2", "Chords · Chorus", { lead: true, group: "t-chords", tone: { ...GUITAR, inst: "piano" } }),
      chordsTrack("c7", "Pad"),
    ], {
      clips: [chordsClip("a", "t-chords", 0, 16, { content: verse() }), chordsClip("b", "t-chords~2", 16, 8, { content: chorus() }), chordsClip("p", "c7", 0, 24, { content: chordsContent(6, undefined, [chord("p1", "A", 24, "min")]) })],
      markers: [{ id: "m1", beat: 0, name: "Verse" }, { id: "m2", beat: 16, name: "Chorus" }],
      end: 24,
    });
    const text = sheet(s);
    const lines = text.split("\n");
    expect(lines.filter((l) => l === "Chords:").length).toBe(2);
    expect(lines.filter((l) => l === "Pad:").length).toBe(2);
    expect(text).not.toContain("Chords · Chorus:");
    // the piano's chords are written as keys, by name
    expect(text).toMatch(/F: [A-G]/);
    // a song with one group has no headings
    expect(sheet(song())).not.toContain("Chords:");
    expect(hasChords5(s)).toBe(true);
    expect(hasChords5(songOf([drumsTrack("td")]))).toBe(false);
  });
});

describe("MIDI", () => {
  it("has one MIDI track for each track that plays notes, under its name", () => {
    const s: TimelineSong = { ...bandSong(), tracks: bandSong().tracks.map((t) => (t.id === "tb" ? { ...t, name: "Low end" } : t)) };
    const tracks = midiTracks(midi5(s, flatten(s, ctx), "Band"));
    // (the file's first track holds the tempo and the bars, and no notes)
    expect(tracks[0].notes.length).toBe(0);
    const named = tracks.filter((t) => t.notes.length).map((t) => t.name);
    expect(named.sort()).toEqual(["Drums", "Low end", "Melody"].sort());
    expect(new Set(named).size).toBe(named.length);
    // a second melody track comes on a track of its own
    const more: TimelineSong = { ...s, tracks: [...s.tracks, tuneTrack("t2", "melody", "Counter")], clips: [...s.clips, melodyClip("m9", "t2", 0, 16)] };
    expect(midiTracks(midi5(more, flatten(more, ctx), "Band")).filter((t) => t.notes.length).map((t) => t.name)).toContain("Counter");
  });
});
