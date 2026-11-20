import { describe, expect, it } from "vitest";
import { BEAT_LIBRARY, DEFAULT_BEAT, applyPattern, barBeats, type Beat } from "../audio/beats";
import type { ProgChord, Progression } from "../ui/state";
import { sigName } from "./meter";
import { addNewSection, ensureSong, sections } from "./structure";
import { addTrack, focusTrack, normalize } from "./tracks";
import { conform, setSig, sigOf } from "./unity";

const chord = (root: string, beats = 4): ProgChord => ({ id: root + Math.random(), ref: { root, typeId: "maj" }, beats });
const base = (roots: string[] = []): Progression => ({ chords: roots.map((r) => chord(r)), bpm: 90, pattern: "ring", loop: true, bars: 4 });
let n = 0;
const id = () => `u${++n}`;
const rock = BEAT_LIBRARY.find((p) => p.steps === 16 && p.div === 4 && (p.bars ?? 1) === 1)!;
const waltz = BEAT_LIBRARY.find((p) => p.steps === 12 && p.div === 4)!;
const on = (p: typeof rock): Beat => applyPattern(DEFAULT_BEAT, p);
/** every drum rhythm kept anywhere in the song */
const rhythms = (p: Progression) => [p.beat, ...Object.values(p.layers ?? {}).map((l) => l.beat), ...(p.song?.parts ?? []).flatMap((x) => [x.groove, ...Object.values(x.layers ?? {}).map((l) => l.beat)])].filter((g): g is NonNullable<typeof g> => !!g);

describe("one time signature for the whole song", () => {
  it("an older song gets the signature its first section played in", () => {
    expect(sigName(sigOf(base(["G"])))).toBe("4/4");
    expect(sigName(sigOf({ ...base(["G"]), beat: on(waltz) }))).toBe("3/4");
    // drums off: it used to follow the playing style, so a waltz style meant 3/4
    expect(sigName(sigOf({ ...base(["G"]), beat: { ...on(rock), on: false }, pattern: "waltz" }))).toBe("3/4");
    const six = BEAT_LIBRARY.find((p) => p.steps === 6 && p.div === 3)!;
    expect(sigName(sigOf({ ...base(["G"]), beat: on(six) }))).toBe("6/8");
  });

  it("a song that already agrees is left exactly as it is", () => {
    const p = conform({ ...base(["G"]), beat: on(rock) });
    expect(p.meter).toEqual({ num: 4, den: 4 });
    expect(conform(p)).toBe(p);
  });

  it("sections whose drums were in other bars are brought into the song's", () => {
    let p = ensureSong({ ...base(["G", "C"]), beat: on(rock) }, id);
    p = addNewSection(p, id);
    p = { ...p, beat: on(waltz) }; // B used to become a waltz by picking a waltz rhythm
    const q = conform(p);
    expect(sigName(q.meter!)).toBe("4/4");
    for (const g of rhythms(q)) expect(barBeats(g)).toBe(4);
    for (const s of sections(q)) expect(barBeats(s.groove!)).toBe(4);
  });

  it("choosing a rhythm written for other bars fits it to the song", () => {
    const p = conform({ ...base(["G"]), beat: on(rock) });
    const q = conform({ ...p, beat: applyPattern(p.beat!, waltz) });
    expect(barBeats(q.beat!)).toBe(4);
    expect(q.beat!.rows.kick.slice(0, 12)).toBe(waltz.rows.kick);
  });

  it("changing the signature takes every section and every track along", () => {
    let p = ensureSong({ ...base(["G", "C"]), beat: on(rock), melody: { div: 2, bars: 2, notes: [{ at: 0, midi: 60 }, { at: 48, midi: 62 }] } }, id);
    p = addTrack(p, "chords", "c2").p;
    p = { ...p, chords: [chord("E", 8), chord("A", 2)] };
    p = addTrack(p, "drums", "d2").p;
    p = { ...p, beat: { ...on(rock), name: "Second" } };
    p = addTrack(p, "melody", "m2").p;
    p = { ...p, melody: { div: 2, bars: 1, notes: [{ at: 36, midi: 72 }] } };
    p = addNewSection(p, id); // B, with every added track still on the pages
    p = conform(p);
    const q = setSig(p, { num: 3, den: 4 });
    expect(sigName(q.meter!)).toBe("3/4");
    expect(q.focus).toEqual(p.focus);
    for (const g of rhythms(q)) expect(barBeats(g)).toBe(3);
    const [a] = sections(q);
    // whole-bar chords are still whole bars; the half-bar chord keeps its two beats
    expect(a.chords.map((c) => c.beats)).toEqual([3, 3]);
    expect(a.layers?.c2.chords?.map((c) => c.beats)).toEqual([6, 2]);
    // bar 2 of the melody still starts bar 2; Melody 2's note on beat 4 has no bar to be in
    expect(a.melody?.notes.map((x) => x.at)).toEqual([0, 36]);
    expect(a.layers?.m2.melody?.notes).toEqual([]);
    expect(barBeats(a.layers!.d2.beat!)).toBe(3);
    // and it is the same song whichever tracks are on the pages
    expect(sections(setSig(normalize(p), { num: 3, den: 4 }))).toEqual(sections(q));
    expect(barBeats(focusTrack(q, "drums", "drums").beat!)).toBe(3);
  });

  it("to 6/8 and back: two beats to the bar, in triplets", () => {
    const p = conform({ ...base(["G"]), beat: on(rock) });
    const q = setSig(p, { num: 6, den: 8 });
    expect([q.beat!.steps, q.beat!.div]).toEqual([6, 3]);
    expect(q.chords[0].beats).toBe(2);
    const back = setSig(q, { num: 4, den: 4 });
    expect([back.beat!.steps, back.beat!.div]).toEqual([16, 4]);
    expect(barBeats(back.beat!)).toBe(4);
    expect(back.chords[0].beats).toBe(4);
  });
});
