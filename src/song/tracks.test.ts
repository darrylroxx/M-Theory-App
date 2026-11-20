import { describe, expect, it } from "vitest";
import { DEFAULT_BEAT, kitOfBeat, sameKit } from "../audio/beats";
import type { ProgChord, Progression } from "../ui/state";
import { addNewSection, commit, ensureSong, mapAllChords, mapAllMelodies, sections, selectBlock, unlinkBlock, repeatSection } from "./structure";
import { PLAIN_KIT, PLAIN_STYLE, addTrack, allTracks, drumsOf, focusTrack, nextName, normalize, refocus, removeTrack, renameTrack, reviveLayers, reviveTracks, tracksOf } from "./tracks";
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

  it("an added drums track has one kit, kept on the track: a new section starts on it, not on the first drums' one", () => {
    let p: Progression = { ...base(["G"]), beat: { ...DEFAULT_BEAT, on: true, kit: "909" } };
    p = addTrack(p, "drums", "d2").p;
    // Drums 2 is given a kit of its own in A
    p = { ...p, beat: { ...p.beat!, kit: "mod", on: true } };
    p = addNewSection(p, id); // B, still on Drums 2
    expect(p.focus?.drums).toBe("d2");
    expect(p.beat?.kit).toBe("mod");
    expect(p.beat?.on).toBe(false);
    expect(normalize(p).tracks!.find((t) => t.id === "d2")!.kit!.kit).toBe("mod");
    // and the first drums keep theirs
    expect(focusTrack(p, "drums", "drums").beat?.kit).toBe("909");
  });

  it("an added drums track's kit changed in one section is its kit in every section", () => {
    let p: Progression = { ...base(["G"]), beat: { ...DEFAULT_BEAT, on: true, kit: "909" } };
    p = addTrack(p, "drums", "d2").p;
    p = { ...p, beat: { ...p.beat!, on: true, rows: { ...p.beat!.rows, kick: "1000100010001000" } } };
    p = addNewSection(p, id); // B
    p = { ...p, beat: { ...p.beat!, on: true, rows: { ...p.beat!.rows, snare: "0000100000001000" } } };
    // Lo-fi chosen with Drums 2 in A
    p = selectBlock(p, sections(p)[0].blockId);
    expect(p.focus?.drums).toBe("d2");
    p = { ...p, beat: { ...p.beat!, kit: "lofi", grit: 0.7 } };
    // B again, Drums 2 brought forward again
    p = focusTrack(selectBlock(focusTrack(p, "drums", "drums"), sections(p)[1].blockId), "drums", "d2");
    expect([p.beat?.kit, p.beat?.grit]).toEqual(["lofi", 0.7]);
    expect(p.beat?.rows.snare).toBe("0000100000001000");
    const q = normalize(p);
    const t = q.tracks!.find((x) => x.id === "d2")!;
    expect(t.kit!.kit).toBe("lofi");
    // what plays: each section's rhythm on the track's one kit
    const [a, b] = sections(q);
    expect([drumsOf(t, a.layers?.d2)!.kit, drumsOf(t, b.layers?.d2)!.kit]).toEqual(["lofi", "lofi"]);
    expect(drumsOf(t, a.layers?.d2)!.rows.kick).toBe("1000100010001000");
    expect(drumsOf(t, b.layers?.d2)!.rows.snare).toBe("0000100000001000");
    expect(drumsOf(t, undefined)).toBeUndefined();
    // kept through saving and loading
    expect(sameKit(reviveTracks(JSON.parse(JSON.stringify(q.tracks)))!.find((x) => x.id === "d2")!.kit, t.kit)).toBe(true);
  });

  it("a new chords track is plain: nothing is copied from the first one", () => {
    const p0: Progression = { ...base(["G"]), pattern: "block", feel: { swing: 0.4 }, sound: { space: 0.9 }, tones: { chords: { inst: "piano" } } };
    const { p } = addTrack(p0, "chords", "c2");
    expect([p.pattern, p.feel, p.sound]).toEqual([PLAIN_STYLE, undefined, undefined]);
    expect(PLAIN_STYLE).toBe("ring");
    expect(p.tones?.c2).toBeUndefined();
    expect(p.mix).toBeUndefined();
    const t = normalize(p).tracks!.find((x) => x.id === "c2")!;
    expect(t.style).toBe("ring");
    expect([t.feel, t.sound]).toEqual([undefined, undefined]);
    // the first track kept its own
    expect([normalize(p).pattern, normalize(p).feel, normalize(p).sound, p.tones?.chords]).toEqual(["block", { swing: 0.4 }, { space: 0.9 }, { inst: "piano" }]);
    // a new melody track: plain too
    const m = addTrack({ ...p0, tuneSound: { voice: "lyre" }, tones: { melody: { inst: "synth" } } }, "melody", "m2").p;
    expect(m.tuneSound).toBeUndefined();
    expect(m.tones?.m2).toBeUndefined();
  });

  it("a new drums track is plain: the default kit, sounds, desk and swing, empty and off", () => {
    const first = { ...DEFAULT_BEAT, on: true, kit: "linn" as const, swing: 0.6, space: 0.55, verb: "plate" as const, sounds: { kick: { tune: 3 } } };
    const { p } = addTrack({ ...base(["G"]), beat: first }, "drums", "d2");
    const b = p.beat!;
    expect(kitOfBeat(b)).toEqual(PLAIN_KIT);
    expect(PLAIN_KIT).toEqual(kitOfBeat(DEFAULT_BEAT));
    expect(b.swing).toBe(0);
    expect(b.on).toBe(false);
    expect(Object.values(b.rows).every((r) => !/[1-9]/.test(r))).toBe(true);
    // the first drums keep theirs
    expect(focusTrack(p, "drums", "drums").beat).toEqual(first);
  });

  it("every track's sound is its own: changing one never changes another, and a round trip keeps them all", () => {
    let p: Progression = { ...base(["G"]), pattern: "block", feel: { swing: 0.2 }, sound: { space: 0.6 }, tuneSound: { voice: "lyre" }, melody: { div: 2, bars: 1, notes: [{ at: 0, midi: 60 }] }, beat: { ...DEFAULT_BEAT, on: true, kit: "909" } };
    p = ensureSong(p, id);
    p = addNewSection(p, id);
    for (const [kind, tid] of [["chords", "c2"], ["melody", "m2"], ["drums", "d2"]] as const) p = addTrack(p, kind, tid).p;
    // Chords 2, Melody 2 and Drums 2 are on the pages: give each a sound
    p = { ...p, pattern: "pinch", feel: { speed: 2 }, sound: { voice: "koto" }, tuneSound: { voice: "kora" }, beat: { ...p.beat!, kit: "707", grit: 0.8 }, tones: { c2: { inst: "synth" }, m2: { inst: "piano" } } };
    const firsts = (q: Progression) => {
      const n0 = normalize(q);
      return [n0.pattern, n0.feel, n0.sound, n0.tuneSound, n0.beat?.kit, n0.tones?.chords, n0.tones?.melody];
    };
    expect(firsts(p)).toEqual(["block", { swing: 0.2 }, { space: 0.6 }, { voice: "lyre" }, "909", undefined, undefined]);
    // the first tracks brought forward again and changed: the added ones keep theirs
    p = focusTrack(focusTrack(focusTrack(p, "chords", "chords"), "melody", "melody"), "drums", "drums");
    p = { ...p, pattern: "strum", sound: { space: 0.1 }, tuneSound: { voice: "folk" }, beat: { ...p.beat!, kit: "linn" }, tones: { ...p.tones, chords: { inst: "piano" } } };
    const tracks = normalize(p).tracks!;
    expect(tracks.find((t) => t.id === "c2")).toMatchObject({ style: "pinch", feel: { speed: 2 }, sound: { voice: "koto" } });
    expect(tracks.find((t) => t.id === "m2")).toMatchObject({ sound: { voice: "kora" } });
    expect(tracks.find((t) => t.id === "d2")!.kit).toMatchObject({ kit: "707", grit: 0.8 });
    expect([p.tones?.c2, p.tones?.m2]).toEqual([{ inst: "synth" }, { inst: "piano" }]);
    // in the other section, every one of them is the same
    const other = selectBlock(p, sections(p)[0].blockId);
    expect(firsts(other)).toEqual(["strum", { swing: 0.2 }, { space: 0.1 }, { voice: "folk" }, "linn", { inst: "piano" }, undefined]);
    const c2 = focusTrack(other, "chords", "c2");
    expect([c2.pattern, c2.feel, c2.sound]).toEqual(["pinch", { speed: 2 }, { voice: "koto" }]);
    expect(focusTrack(other, "melody", "m2").tuneSound).toEqual({ voice: "kora" });
    expect(focusTrack(other, "drums", "d2").beat).toMatchObject({ kit: "707", grit: 0.8 });
    // normalize and refocus there and back keep every sound
    const round = refocus(normalize(c2), c2.focus);
    expect([round.pattern, round.feel, round.sound]).toEqual([c2.pattern, c2.feel, c2.sound]);
    expect(firsts(round)).toEqual(firsts(other));
  });

  it("a track removed takes its instrument with it", () => {
    let p = addTrack(base(["G"]), "chords", "c2").p;
    p = { ...p, tones: { chords: { inst: "piano" }, c2: { inst: "synth" } } };
    const q = removeTrack(p, "c2");
    expect(q.tones).toEqual({ chords: { inst: "piano" } });
  });
});
