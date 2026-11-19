import { describe, expect, it } from "vitest";
import { DEFAULT_BEAT } from "../audio/beats";
import type { ProgChord, Progression } from "../ui/state";
import { addNewSection, commit, ensureSong, mapAllChords, mapAllMelodies, sections, selectBlock, unlinkBlock, repeatSection } from "./structure";
import { addTrack, allTracks, focusTrack, nextName, normalize, removeTrack, renameTrack, reviveLayers, reviveTracks, tracksOf } from "./tracks";
import { transposeRef } from "../theory/keys";
import { transposeMelody, type Melody } from "./melody";

const chord = (root: string): ProgChord => ({ id: root + Math.random(), ref: { root, typeId: "maj" }, beats: 4 });
const base = (roots: string[] = []): Progression => ({ chords: roots.map(chord), bpm: 90, pattern: "ring", loop: true, bars: 4 });
let n = 0;
const id = () => `id${++n}`;
const roots = (cs: ProgChord[] | undefined) => (cs ?? []).map((c) => c.ref.root);

describe("tracks", () => {
  it("a song starts with one chords, one melody and one drums track", () => {
    expect(allTracks(base()).map((t) => t.id)).toEqual(["chords", "melody", "drums"]);
    expect(nextName(base(), "chords")).toBe("Chords 2");
    expect(nextName(base(), "vocals")).toBe("Vocal 1");
  });

  it("a new chords track comes forward empty, and the first track's chords are kept safe", () => {
    const p0 = base(["G", "C"]);
    const { p, track } = addTrack(p0, "chords", "c2");
    expect(track.name).toBe("Chords 2");
    expect(p.focus).toEqual({ chords: "c2" });
    expect(p.chords).toEqual([]);
    // write into the new track, then look at the first one again
    const written = { ...p, chords: [chord("E"), chord("A")] };
    const back = focusTrack(written, "chords", "chords");
    expect(roots(back.chords)).toEqual(["G", "C"]);
    expect(roots(back.layers?.c2.chords)).toEqual(["E", "A"]);
    expect(back.focus).toBeUndefined();
    // and forward again
    expect(roots(focusTrack(back, "chords", "c2").chords)).toEqual(["E", "A"]);
  });

  it("an extra chords track keeps its own style and harp; the first track keeps its own", () => {
    let p = addTrack({ ...base(["G"]), pattern: "pinch", sound: { space: 0.7 } }, "chords", "c2").p;
    p = { ...p, pattern: "strum", sound: { space: 0.1 } };
    const n1 = normalize(p);
    expect(n1.pattern).toBe("pinch");
    expect(n1.sound).toEqual({ space: 0.7 });
    expect(n1.tracks?.[0]).toMatchObject({ id: "c2", style: "strum", sound: { space: 0.1 } });
    const again = focusTrack(n1, "chords", "c2");
    expect(again.pattern).toBe("strum");
  });

  it("each section keeps what every track holds in it", () => {
    let p = ensureSong(base(["G", "C"]), id);
    p = addTrack(p, "chords", "c2").p;
    p = { ...p, chords: [chord("E")] }; // A: Chords 2 = E
    p = addNewSection(p, id); // B, still editing Chords 2
    expect(p.focus).toEqual({ chords: "c2" });
    expect(p.chords).toEqual([]);
    p = { ...p, chords: [chord("D")] }; // B: Chords 2 = D
    const [a, b] = sections(p);
    expect(roots(a.chords)).toEqual(["G", "C"]);
    expect(roots(a.layers?.c2.chords)).toEqual(["E"]);
    expect(roots(b.chords)).toEqual([]);
    expect(roots(b.layers?.c2.chords)).toEqual(["D"]);
    // going back to A shows A's Chords 2
    p = selectBlock(p, a.blockId);
    expect(roots(p.chords)).toEqual(["E"]);
    expect(roots(normalize(p).chords)).toEqual(["G", "C"]);
  });

  it("an extra melody and an extra drum track", () => {
    let p = addTrack({ ...base(), melody: { div: 2, bars: 2, notes: [{ at: 0, midi: 60 }] }, beat: { ...DEFAULT_BEAT, on: true } }, "melody", "m2").p;
    expect(p.melody).toBeUndefined();
    p = { ...p, melody: { div: 2, bars: 2, notes: [{ at: 12, midi: 67 }] } };
    p = addTrack(p, "drums", "d2").p;
    expect(p.focus).toEqual({ melody: "m2", drums: "d2" });
    expect(p.beat?.on).toBe(false);
    expect(Object.values(p.beat!.rows).every((r) => !/[123]/.test(r))).toBe(true);
    const q = normalize(p);
    expect(q.melody?.notes[0].midi).toBe(60);
    expect(q.layers?.m2.melody?.notes[0].midi).toBe(67);
    expect(q.beat?.on).toBe(true);
  });

  it("a vocal track is listed but not brought forward", () => {
    const { p, track } = addTrack(base(["G"]), "vocals", "v1");
    expect(track).toMatchObject({ kind: "vocals", name: "Vocal 1", input: 1 });
    expect(p.focus).toBeUndefined();
    expect(tracksOf(p, "vocals")).toHaveLength(1);
  });

  it("removing a track takes it out of every section and the mixer", () => {
    let p = ensureSong(base(["G"]), id);
    p = addTrack(p, "chords", "c2").p;
    p = { ...p, chords: [chord("E")], mix: { c2: { db: -6 }, chords: { mute: true } } };
    p = addNewSection(p, id);
    p = removeTrack(p, "c2");
    expect(p.focus).toBeUndefined();
    expect(roots(p.chords)).toEqual([]);
    expect(p.tracks).toBeUndefined();
    expect(sections(p).every((s) => !s.layers?.c2)).toBe(true);
    expect(p.mix).toEqual({ chords: { mute: true } });
    expect(removeTrack(p, "chords")).toBe(p);
  });

  it("moving the song to another key moves every chords track", () => {
    let p = ensureSong(base(["G"]), id);
    p = addTrack(p, "chords", "c2").p;
    p = { ...p, chords: [chord("E")] };
    const key = { tonic: "A", scaleId: "ionian" };
    p = mapAllChords(p, (c) => ({ ...c, ref: transposeRef(c.ref, 2, key) }));
    expect(roots(p.chords)).toEqual(["F#"]);
    expect(roots(normalize(p).chords)).toEqual(["A"]);
  });

  it("a repeated letter shares its tracks; an unlinked copy gets its own", () => {
    let p = ensureSong(base(["G"]), id);
    p = addTrack(p, "chords", "c2").p;
    p = { ...p, chords: [chord("E")] };
    const a = sections(p)[0];
    p = repeatSection(p, a.partId, id);
    expect(roots(p.chords)).toEqual(["E"]);
    p = unlinkBlock(p, sections(p)[1].blockId, id);
    p = { ...p, chords: [chord("B")] };
    const [s1, s2] = sections(p);
    expect(roots(s1.layers?.c2.chords)).toEqual(["E"]);
    expect(roots(s2.layers?.c2.chords)).toEqual(["B"]);
  });

  it("commit keeps the track being edited in front", () => {
    let p = ensureSong(base(["G"]), id);
    p = addTrack(p, "chords", "c2").p;
    p = { ...p, chords: [chord("E")] };
    const c = commit(p);
    expect(roots(c.chords)).toEqual(["E"]);
    expect(roots(c.song!.parts[0].chords)).toEqual(["G"]);
  });

  it("tracks and their notes survive a reload; anything broken is dropped", () => {
    const tracks = reviveTracks([{ id: "c2", kind: "chords", name: "Pad", style: "strum" }, { id: "chords", kind: "chords" }, { id: "x", kind: "kazoo" }, { id: "v", kind: "vocals", input: 2 }]);
    expect(tracks).toEqual([{ id: "c2", kind: "chords", name: "Pad", style: "strum" }, { id: "v", kind: "vocals", name: "Vocal", input: 2 }]);
    expect(reviveLayers({ c2: { chords: [chord("E"), { ref: null }] }, ghost: { chords: [] } }, tracks)?.c2.chords).toHaveLength(1);
    expect(renameTrack({ ...base(), tracks }, "c2", "  Keys  ").tracks?.[0].name).toBe("Keys");
  });

  it("moving every melody moves the added melody tracks too, in every section, whichever track is on the page", () => {
    const tune = (midi: number): Melody => ({ div: 2, bars: 1, notes: [{ at: 0, midi }] });
    let p = ensureSong({ ...base(["G"]), melody: tune(60) }, id);
    p = addTrack(p, "melody", "m2").p;
    p = { ...p, melody: tune(67) }; // A: Melody 2
    p = addNewSection(p, id);
    p = { ...p, melody: tune(64) }; // B: Melody 2 (still on the page)
    const moved = mapAllMelodies(p, (m) => transposeMelody(m, 2));
    expect(moved.focus).toEqual({ melody: "m2" });
    expect(moved.melody?.notes[0].midi).toBe(66);
    const [a, b] = sections(moved);
    expect(a.melody?.notes[0].midi).toBe(62);
    expect(a.layers?.m2.melody?.notes[0].midi).toBe(69);
    expect(b.layers?.m2.melody?.notes[0].midi).toBe(66);
  });

  it("an added drums track starts a new section on its own kit, not on the first drums' one", () => {
    let p: Progression = { ...base(["G"]), beat: { ...DEFAULT_BEAT, on: true, kit: "909" } };
    p = addTrack(p, "drums", "d2").p;
    // Drums 2 is given a kit of its own in A
    p = { ...p, beat: { ...p.beat!, kit: "mod", on: true } };
    p = addNewSection(p, id); // B, still on Drums 2
    expect(p.focus?.drums).toBe("d2");
    expect(p.beat?.kit).toBe("mod");
    expect(p.beat?.on).toBe(false);
    // and the first drums keep theirs
    expect(focusTrack(p, "drums", "drums").beat?.kit).toBe("909");
  });

  it("a track removed takes its instrument with it", () => {
    let p = addTrack(base(["G"]), "chords", "c2").p;
    p = { ...p, tones: { chords: { inst: "piano" }, c2: { inst: "synth" } } };
    const q = removeTrack(p, "c2");
    expect(q.tones).toEqual({ chords: { inst: "piano" } });
  });
});
