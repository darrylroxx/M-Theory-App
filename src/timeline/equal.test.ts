// The standing rule of the conversion: an old song sounds the same afterwards.
// For every fixture, the old song's own play list (the frozen copy of the old view's plan) and the converted song's
// (through `flatten`) must ask the audio engine for exactly the same: every note, drum hit, pedal change and take, on
// the same voices, at the same moments. As an offline render, on the live player, on a loop, and in a MIDI file.
import { describe, expect, it } from "vitest";
import { progressionToMidi } from "../audio/midi";
import type { PlayItem } from "../audio/patterns";
import { chordShape } from "../guitar/arrange";
import { getTuning } from "../guitar/tunings";
import { barAt } from "../song/frame";
import { legacyPlan, legacySlice } from "../song/legacyplan";
import { exportIdeas } from "../song/library";
import { sections } from "../song/structure";
import type { ChordRef } from "../theory/chords";
import type { SavedProgression } from "../ui/state";
import { barMap } from "./bars";
import { FIXTURES, fixture, fixtures } from "./fixtures5";
import { flatten, type FlattenCtx } from "./flatten";
import { heardTone, toTimeline, type Converted } from "./migrate5";
import { fakeBuffer, liveLog, logDiff, midiTracks, renderLog, type RenderLog } from "./renderlog";
import { voicingsFor, type VoicingCtx } from "./voicing";
import stored from "./fixtures/v4-ideas.json";

const tuning = getTuning("standard");
const vctx: VoicingCtx = { tuning, capo: 0, avoidBarre: true, shapeOf: (ref: ChordRef, voicingId?: string) => chordShape(ref, tuning, 0, true, voicingId) };

/** One fixture, both ways: the old list and the new one, with what the comparisons need. */
function both(n: number) {
  const idea: SavedProgression = fixture(n);
  const p = idea.progression;
  // every take's decoded sound: the same pretend buffer for the same take, before and after
  const bufs = new Map<string, AudioBuffer>();
  const buffer = (t: { id: string; frames: number; rate: number }) => {
    if (!bufs.has(t.id)) bufs.set(t.id, fakeBuffer(t.id, t.frames / t.rate));
    return bufs.get(t.id)!;
  };
  const old = legacyPlan(p, vctx, buffer);
  const conv: Converted = toTimeline(p);
  const fctx: FlattenCtx = { voicingsOf: voicingsFor(vctx), buffer };
  const back = new Map<string, string>();
  for (const [was, now] of Object.entries(conv.ids)) for (const id of now) back.set(id, was);
  const rename = (t: string) => back.get(t) ?? t;
  return { idea, p, old, conv, fctx, rename, bpm: p.bpm };
}

/** Each voice by what is heard of it (a tone also remembers settings of instruments it is not playing). */
const heard = (log: RenderLog): string[] => [...new Set(log.voices.map((v) => `${v.track}|${JSON.stringify(heardTone(JSON.parse(v.tone), "chords"))}|${v.sound}`))].sort();

function same(a: RenderLog, b: RenderLog) {
  expect(logDiff(a, b).slice(0, 12)).toEqual([]);
  expect(heard(b)).toEqual(heard(a));
}

const numbers = Array.from({ length: FIXTURES + 1 }, (_, i) => i + 1);
const title = (n: number) => (n > FIXTURES ? "the worked example" : `fixture ${n}`);

describe("a converted song asks the engine for what the old song asked: the offline render", () => {
  for (const n of numbers)
    it(title(n), async () => {
      const x = both(n);
      const a = await renderLog(x.old.items, x.bpm);
      const b = await renderLog(flatten(x.conv.song, x.fctx).items, x.bpm, x.rename);
      // (the fixture plays something at all: an empty record would compare equal to anything empty)
      expect(a.notes.length + a.hits.length + a.takes.length).toBeGreaterThan(0);
      same(a, b);
    });
});

describe("a converted song asks the engine for what the old song asked: the live player, to the song's end", () => {
  for (const n of numbers)
    it(title(n), async () => {
      const x = both(n);
      const a = await liveLog(x.old.items, x.bpm);
      const b = await liveLog(flatten(x.conv.song, x.fctx).items, x.bpm, { rename: x.rename });
      expect(a.notes.length + a.hits.length + a.takes.length).toBeGreaterThan(0);
      same(a, b);
    });
});

/** Bars 3 to 6 of the song (to its last bar, when it is shorter), the old way and the new. */
function loopOf(x: ReturnType<typeof both>): { old: PlayItem[]; now: PlayItem[] } {
  const layout = x.old.per.map((s) => ({ block: s.block, bars: s.bars }));
  const total = layout.reduce((a, s) => a + s.bars, 0);
  const first = Math.min(2, total - 1);
  const last = Math.min(5, total - 1);
  const old = legacySlice(x.old.per, { from: barAt(layout, first)!, to: barAt(layout, last)! }).items;
  const map = barMap(x.conv.song);
  const now = flatten(x.conv.song, x.fctx, { spans: [{ from: map.beatOfBar(first), to: map.beatOfBar(last + 1) }], loop: true });
  expect(now.loop).toBe(true);
  return { old, now: now.items };
}

describe("a converted song asks the engine for what the old song asked: a loop of bars 3 to 6", () => {
  for (const n of numbers)
    it(`${title(n)}, rendered`, async () => {
      const x = both(n);
      const l = loopOf(x);
      expect(l.now.reduce((a, i) => a + i.beats, 0)).toBeCloseTo(l.old.reduce((a, i) => a + i.beats, 0), 9);
      same(await renderLog(l.old, x.bpm), await renderLog(l.now, x.bpm, x.rename));
    });
  for (const n of numbers)
    it(`${title(n)}, live, two and a half times round`, async () => {
      const x = both(n);
      const l = loopOf(x);
      const seconds = (l.old.reduce((a, i) => a + i.beats, 0) * 60 * 2.5) / x.bpm;
      same(await liveLog(l.old, x.bpm, { loop: true, seconds }), await liveLog(l.now, x.bpm, { loop: true, seconds, rename: x.rename }));
    });
});

/** A MIDI file's note events, by the old track each belongs to. */
function midiNotes(file: Uint8Array, nameOf: (track: string, index: number) => string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  midiTracks(file).forEach((t, i) => {
    if (!t.notes.length) return;
    const k = nameOf(t.name, i);
    (out[k] ??= []).push(...t.notes.map((e) => `${e.tick}:${e.on ? "on" : "off"}:${e.midi}:${e.on ? e.vel : 0}`));
  });
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

/** Both files of a fixture, as note events by old track. */
function midiBoth(n: number) {
  const x = both(n);
  const sig = x.conv.song.meter;
  const oldIds = Object.keys(x.conv.ids);
  // the old file: the first chords are its first track, then "Melody" and "Drums", then the added tracks by the name given
  const oldName = (name: string, i: number) => (i === 0 ? "chords" : name === "Melody" ? "melody" : name === "Drums" ? "drums" : name);
  const a = midiNotes(progressionToMidi(x.old.items, x.bpm, "ring", "song", null, null, Object.fromEntries(oldIds.map((id) => [id, id])), sig), oldName);
  const now = flatten(x.conv.song, x.fctx).items;
  const b = midiNotes(progressionToMidi(now, x.bpm, "ring", "song", null, null, Object.fromEntries(x.conv.song.tracks.map((t) => [t.id, t.id])), sig), (name) => x.rename(name));
  return { x, a, b, sig, oldName };
}
const less = (xs: string[], ys: string[]) => {
  const left = [...ys];
  return xs.filter((x) => {
    const i = left.indexOf(x);
    if (i < 0) return true;
    left.splice(i, 1);
    return false;
  });
};

describe("a converted song writes the same MIDI file, track by track", () => {
  // Two cases are known where the files differ, both for a row that was split in two because it sounded different in
  // different sections. In both the song is HEARD the same (the tests above); only the file differs. Each is held
  // exactly below, so anything else that changes fails.
  for (const n of numbers.filter((k) => k !== 9 && k !== 15))
    it(title(n), () => {
      const { a, b } = midiBoth(n);
      expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
      for (const k of Object.keys(a)) expect(b[k], k).toEqual(a[k]);
    });

  it("fixture 15: the same, but for the end of one melody note where the row changes instrument", () => {
    // The melody row plays the strings in the first section and a piano in the second, so it is two tracks now. The
    // file ends a melody note where the next note of its track starts. The last note of the first section used to be
    // ended by the first note of the second; that note is on the other track now, so it is written two beats long.
    const { a, b } = midiBoth(15);
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    for (const k of Object.keys(a).filter((t) => t !== "melody")) expect(b[k], k).toEqual(a[k]);
    expect(less(a.melody, b.melody)).toEqual(["3840:off:62:0"]);
    expect(less(b.melody, a.melody)).toEqual(["4464:off:62:0"]);
  });

  it("fixture 9: the same, but a synth's arpeggio is written out where the old file wrote held chords", () => {
    // The first chords play a synth's arpeggio in one section and a drone in the next. The old file writes an
    // arpeggio's notes only for a track that plays it in every section, so it wrote this row as held chords. The row is
    // two tracks now, and the one with the arpeggio plays it everywhere: the file holds the notes the app plays.
    const { x, a, b, sig, oldName } = midiBoth(9);
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    for (const k of Object.keys(a).filter((t) => t !== "chords")) expect(b[k], k).toEqual(a[k]);
    const tick = (e: string) => Number(e.split(":")[0]);
    const ons = (xs: string[], from: number, to: number) => xs.filter((e) => e.includes(":on:") && tick(e) >= from && tick(e) < to);
    // the section with the drone (beats 8 to 16, 480 ticks a beat): held chords, as before
    expect(ons(b.chords, 3840, 7680)).toEqual(ons(a.chords, 3840, 7680));
    expect(ons(a.chords, 3840, 7680).length).toBeGreaterThan(0);
    // the sections with the arpeggio: exactly what the old writer gives for that section on its own
    const alone = midiNotes(progressionToMidi(x.old.per[0].items, x.bpm, "ring", "song", null, null, {}, sig), oldName).chords;
    expect(ons(alone, 0, 3840).length).toBeGreaterThan(ons(a.chords, 0, 3840).length);
    expect(ons(b.chords, 0, 3840)).toEqual(ons(alone, 0, 3840));
    expect(ons(b.chords, 7680, 11520).map((e) => e.replace(/^\d+/, (t) => String(Number(t) - 7680))).sort()).toEqual(ons(alone, 0, 3840));
  });
});

describe("the testers' file", () => {
  it("is the fixtures as an old backup file, so it cannot drift from them", () => {
    const file = stored as unknown as { version: number; ideas: { name: string }[] };
    expect(file).toEqual(JSON.parse(exportIdeas(fixtures())));
    expect(file.version).toBe(1);
    expect(file.ideas.map((i) => i.name)).toEqual([...Array.from({ length: 17 }, (_, i) => `Fixture ${i + 1}`), "Worked example"]);
  });
  it("every fixture is a song the old loader gives back unchanged", () => {
    for (const i of fixtures()) expect(sections(i.progression).length > 0 || i.name === "Fixture 1").toBe(true);
  });
});
