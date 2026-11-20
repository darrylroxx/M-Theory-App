import { describe, expect, it } from "vitest";
import { DEFAULT_BEAT, kitOfBeat, kitSig } from "../audio/beats";
import type { ProgChord, Progression } from "../ui/state";
import { addNewSection, commit, ensureSong, mapAllChords, mapAllMelodies, sections, selectBlock, unlinkBlock, repeatSection } from "./structure";
import { PLAIN_KIT, PLAIN_STYLE, addTrack, addTrackHere, allTracks, drumsOf, firstLayer, focusTrack, nextName, normalize, refocus, removeTrack, renameTrack, reviveLayers, reviveTracks, tracksOf } from "./tracks";
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

  it("an extra chords track keeps its own style and harp in its part of the section; the first track keeps its own", () => {
    let p = addTrack({ ...base(["G"]), pattern: "pinch", sound: { space: 0.7 } }, "chords", "c2").p;
    p = { ...p, pattern: "strum", sound: { space: 0.1 } };
    const n1 = normalize(p);
    expect(n1.pattern).toBe("pinch");
    expect(n1.sound).toEqual({ space: 0.7 });
    expect(n1.layers?.c2).toMatchObject({ pattern: "strum", sound: { space: 0.1 } });
    expect(n1.tracks?.[0]).toEqual({ id: "c2", kind: "chords", name: "Chords 2" });
    const again = focusTrack(n1, "chords", "c2");
    expect(again.pattern).toBe("strum");
  });

  it("each section keeps what every track holds in it", () => {
    let p = ensureSong(base(["G", "C"]), id);
    p = addTrack(p, "chords", "c2").p;
    p = { ...p, chords: [chord("E")] }; // A: Chords 2 = E
    p = addNewSection(p, id); // B: no Chords 2 there, the page edits the first chords track
    expect(p.focus).toBeUndefined();
    expect(p.chords).toEqual([]);
    p = { ...p, chords: [chord("A")] }; // B: Chords = A (an empty Chords here would be the one + brings forward)
    p = addTrackHere(p, "chords", "x").p; // Chords 2 in B too: the same row
    expect(p.focus).toEqual({ chords: "c2" });
    p = { ...p, chords: [chord("D")] }; // B: Chords 2 = D
    const [a, b] = sections(p);
    expect(roots(a.chords)).toEqual(["G", "C"]);
    expect(roots(a.layers?.c2.chords)).toEqual(["E"]);
    expect(roots(b.chords)).toEqual(["A"]);
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
    const tracks = reviveTracks([{ id: "c2", kind: "chords", name: "Pad" }, { id: "chords", kind: "chords" }, { id: "x", kind: "kazoo" }, { id: "v", kind: "vocals", input: 2 }]);
    expect(tracks).toEqual([{ id: "c2", kind: "chords", name: "Pad" }, { id: "v", kind: "vocals", name: "Vocal", input: 2 }]);
    const ls = reviveLayers({ c2: { chords: [chord("E"), { ref: null }], pattern: "strum", sound: { space: 2 }, feel: "x" }, ghost: { chords: [] } }, tracks);
    expect(ls?.c2.chords).toHaveLength(1);
    expect(ls?.c2.pattern).toBe("strum");
    expect(ls?.c2.feel).toBeUndefined();
    expect(Object.keys(ls ?? {})).toEqual(["c2"]);
    // a track in a section with nothing in it yet is still there
    expect(reviveLayers({ c2: {} }, tracks)).toEqual({ c2: { chords: [] } });
    expect(renameTrack({ ...base(), tracks }, "c2", "  Keys  ").tracks?.[0].name).toBe("Keys");
  });

  it("moving every melody moves the added melody tracks too, in every section, whichever track is on the page", () => {
    const tune = (midi: number): Melody => ({ div: 2, bars: 1, notes: [{ at: 0, midi }] });
    let p = ensureSong({ ...base(["G"]), melody: tune(60) }, id);
    p = addTrack(p, "melody", "m2").p;
    p = { ...p, melody: tune(67) }; // A: Melody 2
    p = addNewSection(p, id);
    p = { ...p, melody: tune(62) }; // B: Melody (an empty one here would be the one + brings forward)
    p = addTrackHere(p, "melody", "x").p;
    p = { ...p, melody: tune(64) }; // B: Melody 2
    const moved = mapAllMelodies(p, (m) => transposeMelody(m, 2));
    expect(moved.focus).toEqual({ melody: "m2" });
    expect(moved.melody?.notes[0].midi).toBe(66);
    const [a, b] = sections(moved);
    expect(a.melody?.notes[0].midi).toBe(62);
    expect(a.layers?.m2.melody?.notes[0].midi).toBe(69);
    expect(b.layers?.m2.melody?.notes[0].midi).toBe(66);
  });

  it("an added drums track's kit is its own in each section: a new section has no added tracks", () => {
    let p: Progression = { ...base(["G"]), beat: { ...DEFAULT_BEAT, on: true, kit: "909" } };
    p = addTrack(p, "drums", "d2").p;
    // Drums 2 is given a kit of its own in A
    p = { ...p, beat: { ...p.beat!, kit: "mod", on: true } };
    p = addNewSection(p, id); // B: the page edits the first drums, on the kit they had in A
    expect(p.focus).toBeUndefined();
    expect(p.beat?.kit).toBe("909");
    p = addTrackHere(p, "drums", "x").p; // Drums 2 in B: plain
    expect(p.focus?.drums).toBe("d2");
    expect(p.beat?.kit).toBe(PLAIN_KIT.kit);
    expect(p.beat?.on).toBe(false);
    p = { ...p, beat: { ...p.beat!, kit: "lofi", grit: 0.7, on: true, rows: { ...p.beat!.rows, snare: "0000100000001000" } } };
    const [a, b] = sections(normalize(p));
    expect([drumsOf(a.layers?.d2)!.kit, drumsOf(b.layers?.d2)!.kit]).toEqual(["mod", "lofi"]);
    expect(drumsOf(b.layers?.d2)!.rows.snare).toBe("0000100000001000");
    expect(drumsOf(undefined)).toBeUndefined();
    // and the first drums keep theirs
    expect(focusTrack(p, "drums", "drums").beat?.kit).toBe("909");
    // kept through saving and loading
    const back = reviveLayers(JSON.parse(JSON.stringify(b.layers)), normalize(p).tracks)!;
    expect(kitSig(kitOfBeat(back.d2.beat!))).toBe(kitSig(kitOfBeat(b.layers!.d2.beat!)));
  });

  it("a new chords track is plain: nothing is copied from the first one", () => {
    const p0: Progression = { ...base(["G"]), pattern: "block", feel: { swing: 0.4 }, sound: { space: 0.9 }, tones: { chords: { inst: "piano" } } };
    const { p } = addTrack(p0, "chords", "c2");
    expect([p.pattern, p.feel, p.sound]).toEqual([PLAIN_STYLE, undefined, undefined]);
    expect(PLAIN_STYLE).toBe("ring");
    expect(p.tones?.c2).toBeUndefined();
    expect(p.mix).toBeUndefined();
    const l = normalize(p).layers!.c2;
    expect(l.pattern).toBe("ring");
    expect([l.feel, l.sound]).toEqual([undefined, undefined]);
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
    const ls = normalize(p).layers!;
    expect(ls.c2).toMatchObject({ pattern: "pinch", feel: { speed: 2 }, sound: { voice: "koto" } });
    expect(ls.m2).toMatchObject({ tuneSound: { voice: "kora" } });
    expect(ls.d2.beat).toMatchObject({ kit: "707", grit: 0.8 });
    expect([p.tones?.c2, p.tones?.m2]).toEqual([{ inst: "synth" }, { inst: "piano" }]);
    // a new section: a copy of the first tracks' sounds, then its own
    const other = addNewSection(p, id);
    expect(firsts(other)).toEqual(["strum", { swing: 0.2 }, { space: 0.1 }, { voice: "folk" }, "linn", { inst: "piano" }, undefined]);
    const back = selectBlock({ ...other, pattern: "quarters" }, sections(other)[0].blockId);
    expect(back.pattern).toBe("strum");
    const c2 = focusTrack(back, "chords", "c2");
    expect([c2.pattern, c2.feel, c2.sound]).toEqual(["pinch", { speed: 2 }, { voice: "koto" }]);
    expect(focusTrack(back, "melody", "m2").tuneSound).toEqual({ voice: "kora" });
    expect(focusTrack(back, "drums", "d2").beat).toMatchObject({ kit: "707", grit: 0.8 });
    // normalize and refocus there and back keep every sound
    const round = refocus(normalize(c2), c2.focus);
    expect([round.pattern, round.feel, round.sound]).toEqual([c2.pattern, c2.feel, c2.sound]);
    expect(firsts(round)).toEqual(firsts(back));
  });

  it("a track removed takes its instrument with it", () => {
    let p = addTrack(base(["G"]), "chords", "c2").p;
    p = { ...p, tones: { chords: { inst: "piano" }, c2: { inst: "synth" } } };
    const q = removeTrack(p, "c2");
    expect(q.tones).toEqual({ chords: { inst: "piano" } });
  });

  it("the first track of a kind is never stood in for by the added track its page has brought forward", () => {
    // a song whose first tracks never had a sound or a beat set: the defaults, until they are set
    let p = base(["G"]);
    p = addTrack(p, "chords", "c2").p;
    p = addTrack(p, "melody", "m2").p;
    p = addTrack(p, "drums", "d2").p;
    // the added tracks get sounds and a beat of their own, on the pages
    const d2 = { ...DEFAULT_BEAT, on: true, kit: "909" as const, rows: { ...DEFAULT_BEAT.rows, kick: "3000300030003000" } };
    p = { ...p, sound: { voice: "wire", space: 0.9 }, tuneSound: { voice: "bray" }, beat: d2 };
    expect(p.focus).toEqual({ chords: "c2", melody: "m2", drums: "d2" });
    expect(firstLayer(p, "chords").sound).toBeUndefined();
    expect(firstLayer(p, "chords").chords?.map((c) => c.ref.root)).toEqual(["G"]);
    expect(firstLayer(p, "melody").tuneSound).toBeUndefined();
    expect(firstLayer(p, "drums").beat).toBeUndefined();
    // each is what the first track has once everything is back in its place
    const n0 = normalize(p);
    expect(n0.sound).toBeUndefined();
    expect(n0.tuneSound).toBeUndefined();
    expect(n0.beat).toBeUndefined();
    // with the first tracks on their pages, it is what the page holds
    const back = normalize({ ...n0, sound: { space: 0.3 }, beat: { ...DEFAULT_BEAT, on: true } });
    expect(firstLayer(back, "chords").sound).toEqual({ space: 0.3 });
    expect(firstLayer(back, "drums").beat?.on).toBe(true);
    // and it stays the same when an added track is brought forward again
    const again = focusTrack(focusTrack(back, "chords", "c2"), "drums", "d2");
    expect(again.sound).toEqual({ voice: "wire", space: 0.9 });
    expect(firstLayer(again, "chords").sound).toEqual({ space: 0.3 });
    expect(firstLayer(again, "drums").beat?.on).toBe(true);
    expect(firstLayer(again, "drums").beat?.kit).toBe(DEFAULT_BEAT.kit);
  });
});
