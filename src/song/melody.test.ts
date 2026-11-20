import { describe, expect, it } from "vitest";
import { progressionToMidi } from "../audio/midi";
import { FEEL_DEFAULT, itemTune, reviveFeel, styleNotes, type PlayItem } from "../audio/patterns";
import { chordRounds, DEFAULT_BEAT } from "../audio/beats";
import type { ProgChord, Progression } from "../ui/state";
import { fingerprint, reviveIdea, snapshot } from "./library";
import { EMPTY_MELODY, MELODY_MAX_BARS, TICKS, cellTick, clearMelody, copyMelodyBar, hasTune, melodyBase, melodyBeats, melodyRows, notesInCell, reviveMelody, setMelodyBars, toggleNote, transposeMelody, tuneBetween, type Melody } from "./melody";
import { addNewSection, ensureSong, reviveSong, sections, selectBlock, unlinkBlock, repeatSection } from "./structure";

const C = { tonic: "C", scaleId: "ionian" };
const chord = (root: string): ProgChord => ({ id: root, ref: { root, typeId: "maj" }, beats: 4 });
const base = (roots: string[] = []): Progression => ({ chords: roots.map(chord), bpm: 90, pattern: "ring", loop: true });
let n = 0;
const id = () => `m${++n}`;

describe("the melody grid", () => {
  it("shows two octaves from the home note, highest first, and knows which notes are in the key", () => {
    const rows = melodyRows(C);
    expect(rows.length).toBe(25);
    expect(rows[0].midi).toBe(84);
    expect(rows[24].midi).toBe(60);
    expect(rows.filter((r) => r.inKey).map((r) => r.name).slice(-8).reverse()).toEqual(["C", "D", "E", "F", "G", "A", "B", "C"]);
    expect(rows.filter((r) => r.home).map((r) => r.midi)).toEqual([84, 72, 60]);
    expect(rows.filter((r) => !r.inKey).length).toBe(10);
    // "key only" leaves just the scale: no wrong notes to tap
    const only = melodyRows(C, true);
    expect(only.length).toBe(15);
    expect(only.every((r) => r.inKey)).toBe(true);
    // every key starts on its own home note, near middle C, and spells its notes its own way
    for (const [tonic, low] of [["C", 60], ["G", 67], ["Ab", 68], ["A", 57], ["B", 59], ["F#", 66]] as const) expect(melodyBase({ tonic, scaleId: "ionian" }), tonic).toBe(low);
    expect(melodyRows({ tonic: "F", scaleId: "ionian" }).find((r) => r.midi === 70)!.name).toBe("Bb");
    expect(melodyRows({ tonic: "B", scaleId: "ionian" }).find((r) => r.midi === 70)!.name).toBe("A#");
    // a five-note scale lights five rows to the octave
    expect(melodyRows({ tonic: "A", scaleId: "minorPentatonic" }, true).length).toBe(11);
  });

  it("a tap puts a note in, a second tap takes it out", () => {
    let m: Melody = EMPTY_MELODY;
    m = toggleNote(m, cellTick(m, 4, 0, 0), 60);
    m = toggleNote(m, cellTick(m, 4, 0, 3), 64);
    m = toggleNote(m, cellTick(m, 4, 1, 0), 67);
    expect(m.notes).toEqual([{ at: 0, midi: 60 }, { at: 18, midi: 64 }, { at: 48, midi: 67 }]);
    expect(hasTune(m)).toBe(true);
    m = toggleNote(m, 18, 64);
    expect(m.notes.length).toBe(2);
    // two notes at once are a harmony
    m = toggleNote(m, 0, 64);
    expect(notesInCell(m, 0, 60).length + notesInCell(m, 0, 64).length).toBe(2);
    expect(hasTune({ ...m, on: false })).toBe(false);
    expect(hasTune(EMPTY_MELODY)).toBe(false);
  });

  it("a finer grid shows more steps; notes never move, and a coarse grid still shows the fine ones", () => {
    let m: Melody = { div: 4, bars: 1, notes: [] };
    m = toggleNote(m, cellTick(m, 4, 0, 1), 62); // the second sixteenth
    expect(m.notes[0].at).toBe(3);
    const coarse: Melody = { ...m, div: 2 };
    expect(notesInCell(coarse, cellTick(coarse, 4, 0, 0), 62).length).toBe(1);
    // tapping that cell on the coarse grid removes it rather than adding a second note
    expect(toggleNote(coarse, 0, 62).notes.length).toBe(0);
    // triplets and sixteenths both land on whole ticks
    expect(cellTick({ ...m, div: 3 }, 4, 0, 1)).toBe(4);
    expect(cellTick({ ...m, div: 4 }, 3, 2, 5)).toBe((6 + 1.25) * TICKS);
  });

  it("bars can be added, copied, cleared and removed", () => {
    let m: Melody = { div: 2, bars: 1, notes: [{ at: 0, midi: 60 }, { at: 24, midi: 64 }] };
    m = setMelodyBars(m, 2, 4);
    m = copyMelodyBar(m, 4, 0, 1);
    expect(m.notes.map((x) => x.at)).toEqual([0, 24, 48, 72]);
    expect(melodyBeats(m, 4)).toBe(8);
    expect(clearMelody(m, 4, 0).notes.map((x) => x.at)).toEqual([48, 72]);
    expect(clearMelody(m, 4).notes).toEqual([]);
    expect(setMelodyBars(m, 1, 4).notes.length).toBe(2);
    expect(setMelodyBars(m, 99, 4).bars).toBe(MELODY_MAX_BARS);
    expect(transposeMelody(m, 2).notes[0].midi).toBe(62);
  });

  it("comes round again when it is shorter than its section, and follows the drums' swing", () => {
    const m: Melody = { div: 4, bars: 1, notes: [{ at: 0, midi: 60 }, { at: 3, midi: 62 }, { at: 24, midi: 64 }] };
    expect(tuneBetween(m, 4, 0, 4)).toEqual([{ beat: 0, midi: 60 }, { beat: 0.25, midi: 62 }, { beat: 2, midi: 64 }]);
    // second time round, in the next bar
    expect(tuneBetween(m, 4, 4, 5).map((h) => h.beat)).toEqual([4, 4.25]);
    // half-open: a note on the boundary belongs to what follows
    expect(tuneBetween(m, 4, 0, 2).length).toBe(2);
    expect(tuneBetween(m, 4, 2, 4).length).toBe(1);
    // swing delays every second sixteenth, exactly as the drum grid does
    expect(tuneBetween(m, 4, 0, 1, 1)[1].beat).toBeCloseTo(0.25 + 1 / 12);
    expect(tuneBetween(m, 4, 0, 1, 1)[0].beat).toBe(0);
  });

  it("chords repeat until the melody has finished, as they do for a long drum pattern", () => {
    expect(chordRounds(8, null, 16)).toBe(2);
    expect(chordRounds(8, null, 8)).toBe(1);
    expect(chordRounds(4, { ...DEFAULT_BEAT, on: true }, 12)).toBe(3);
    expect(chordRounds(0, null, 8)).toBe(1);
  });

  it("stored melodies are made safe", () => {
    expect(reviveMelody(undefined)).toBeUndefined();
    expect(reviveMelody({ notes: "x" })).toBeUndefined();
    expect(reviveMelody({ div: 7, bars: 99, notes: [{ at: 0, midi: 60 }, { at: -1, midi: 60 }, { at: 1.5, midi: 60 }, { at: 3, midi: 200 }, null], on: false })).toEqual({ div: 2, bars: MELODY_MAX_BARS, notes: [{ at: 0, midi: 60 }], on: false });
  });
});

describe("melody and feel travel with the song", () => {
  const tune: Melody = { div: 2, bars: 1, notes: [{ at: 0, midi: 72 }, { at: 24, midi: 76 }] };

  it("each section keeps its own melody and its own feel; a new section starts with an empty grid and a copy of the feel", () => {
    let p = ensureSong({ ...base(["C", "G"]), melody: tune, feel: { speed: 2 } }, id);
    p = addNewSection(p, id);
    expect(p.melody).toBeUndefined();
    expect(reviveFeel(p.feel).speed).toBe(2);
    p = { ...p, chords: [chord("F")], melody: toggleNote(EMPTY_MELODY, 12, 65), feel: { speed: 0.5, octave: 1 } };
    p = selectBlock(p, sections(p)[0].blockId);
    expect(p.melody).toEqual(tune);
    expect(reviveFeel(p.feel)).toMatchObject({ speed: 2 });
    p = selectBlock(p, sections(p)[1].blockId);
    expect(p.melody!.notes).toEqual([{ at: 12, midi: 65 }]);
    expect(reviveFeel(p.feel)).toMatchObject({ speed: 0.5, octave: 1 });
    // a block given its own letter takes a copy
    p = repeatSection(p, p.song!.parts[1].id, id);
    p = unlinkBlock(p, sections(p)[2].blockId, id);
    expect(sections(p).map((s) => s.melody?.notes.length ?? 0)).toEqual([2, 1, 1]);
    // and it all survives saving and loading
    const back = reviveSong(JSON.parse(JSON.stringify(p.song)))!;
    expect(back.parts.map((x) => x.melody?.notes.length ?? 0)).toEqual([2, 1, 1]);
  });

  it("writing a melody counts as a change to save; an idea can be a melody alone", () => {
    const key = { tonic: "C", scaleId: "ionian" };
    const a = fingerprint(snapshot(key, base(["C"]), 0, "standard"));
    const b = fingerprint(snapshot(key, { ...base(["C"]), melody: tune }, 0, "standard"));
    expect(a).not.toBe(b);
    expect(fingerprint(snapshot(key, { ...base(["C"]), feel: { touch: 0.9 } }, 0, "standard"))).not.toBe(a);
    // default feel and an empty melody are nothing to save
    expect(fingerprint(snapshot(key, { ...base(["C"]), feel: FEEL_DEFAULT, melody: EMPTY_MELODY }, 0, "standard"))).toBe(a);
    const idea = reviveIdea({ id: "i", name: "Tune", key, savedAt: 1, progression: { ...base(), melody: tune, feel: { speed: 2 } } })!;
    expect(idea.progression.melody).toEqual(tune);
    expect(idea.progression.feel).toMatchObject({ speed: 2 });
  });

  it("plays over the chords of its own section, and lands in the MIDI file on its own track", () => {
    const items: PlayItem[] = [
      { midi: [48, 52, 55], beats: 4, section: true, tune: { m: tune, bar: 4, swing: 0 } },
      { midi: [43, 47, 50], beats: 4, tune: { m: tune, bar: 4, swing: 0 } },
      { midi: [41, 45, 48], beats: 4, section: true, tune: null },
    ];
    // one bar of melody under two bars of chords plays twice; the next section has none
    expect(itemTune(items)).toEqual([{ beat: 0, midi: 72 }, { beat: 2, midi: 76 }, { beat: 4, midi: 72 }, { beat: 6, midi: 76 }]);
    // the player's own melody is used where a chord names none
    expect(itemTune([{ midi: [48], beats: 4 }], { m: tune, bar: 4, swing: 0 }).length).toBe(2);
    const midi = progressionToMidi(items, 100, "ring");
    expect((midi[10] << 8) | midi[11]).toBe(2); // two tracks: harp and melody
    expect(String.fromCharCode(...midi).includes("Melody")).toBe(true);
    let on = 0;
    for (let i = 14; i < midi.length - 2; i++) if (midi[i] === 0x91 && midi[i + 2] === 104) on++;
    expect(on).toBe(4);
    // a melody with no chords at all still exports
    const solo = progressionToMidi([], 100, "ring", "x", null, { m: tune, bar: 4, swing: 0 });
    expect(String.fromCharCode(...solo).includes("Melody")).toBe(true);
    // with drums as well: three tracks
    expect(progressionToMidi(items, 100, "ring", "x", { ...DEFAULT_BEAT, on: true })[11]).toBe(3);
  });
});

describe("feel", () => {
  const Cm = [null, 48, 52, 55, 60, 64];
  it("speed plays the same pattern twice as fast or half as fast", () => {
    const plain = styleNotes(Cm, 4, "pima", 0, { bar: 4 });
    const fast = styleNotes(Cm, 4, "pima", 0, { bar: 4 }, { speed: 2 });
    const slow = styleNotes(Cm, 4, "pima", 0, { bar: 4 }, { speed: 0.5 });
    expect(fast.length).toBe(plain.length * 2);
    expect(slow.length).toBe(plain.length / 2);
    expect(fast[1].beat).toBeCloseTo(plain[1].beat / 2);
    expect(slow[1].beat).toBeCloseTo(plain[1].beat * 2);
    // slowed down, the pattern carries on across the bar line instead of starting again
    const two = styleNotes(Cm, 4, "strum", 4, { bar: 4 }, { speed: 0.5 });
    // (the chord arriving on a rest is still strummed, so it is heard: that is the 0)
    expect([...new Set(two.map((e) => e.beat))]).toEqual([0, 1, 2, 3]);
    expect(Math.max(...fast.map((e) => e.beat))).toBeLessThan(4);
  });
  it("touch, spread, octave and swing shape it", () => {
    const at = (f: object) => styleNotes(Cm, 4, "strum", 0, { bar: 4 }, f);
    expect(at({ touch: 1 })[0].velocity).toBeGreaterThan(at({ touch: 0 })[0].velocity * 1.8);
    expect(at({ spread: 1 })[4].delay).toBeGreaterThan(at({ spread: 0 })[4].delay * 6);
    expect(at({ octave: 1 })[0].midi).toBe(at({})[0].midi + 12);
    expect(at({ octave: -1 })[0].midi).toBe(at({})[0].midi - 12);
    const swung = [...new Set(at({ swing: 1 }).map((e) => +e.beat.toFixed(3)))];
    expect(swung).toContain(1.667);
    expect(at({})).toEqual(styleNotes(Cm, 4, "strum", 0, { bar: 4 }));
    expect(reviveFeel({ speed: 3, swing: 9, touch: "x", octave: 2 })).toEqual({ ...FEEL_DEFAULT, swing: 1 });
  });
});
