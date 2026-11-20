import { describe, expect, it } from "vitest";
import { DEFAULT_BEAT, kitOfBeat, kitSig, type Beat } from "../audio/beats";
import { reviveSound } from "../audio/rack";
import { toneOf, withTone } from "../audio/tone";
import { reviveProgression, type ProgChord, type Progression } from "../ui/state";
import { addNewSection, addTrackTo, commit, ensureSong, removeBlock, repeatSection, sections, sectionsWith, selectBlock, soundToAll, unlinkBlock } from "./structure";
import { addTrack, addTrackHere, allTracks, focusTrack, inSection, insteadIn, normalize, removeHere, removeTrack, tracksHere } from "./tracks";
import { copyDrums, copyMelody, copyRhythm, copySection, pasteDrums, pasteMelody, pastePart, pasteRhythm, pasteSection, unpastePart } from "./clip";
import { addHarmony, harmonizeSources, rewriteHarmony } from "./harmony";
import { fingerprint, sameMusic, snapshot } from "./library";

const C = { tonic: "C", scaleId: "ionian" };
let n = 0;
const id = () => `id${++n}`;
const chord = (root: string, beats = 4): ProgChord => ({ id: root + ++n, ref: { root, typeId: "maj" }, beats });
const roots = (cs: ProgChord[] | undefined) => (cs ?? []).map((c) => c.ref.root);
const mel = (notes: [number, number][]) => ({ div: 2 as const, bars: 2, notes: notes.map(([at, midi]) => ({ at, midi })) });
const ROWS = { kick: "3000300030003000", snare: "0000300000003000", hat: "2020202020202020" } as Beat["rows"];
const drums = (kit: string, space = 0.3): Beat => ({ ...DEFAULT_BEAT, kit: kit as Beat["kit"], space, on: true, rows: { ...DEFAULT_BEAT.rows, ...ROWS } });

/** A song of two sections, A and B, each with chords and a melody, the page on A. */
function song(): Progression {
  let p: Progression = { chords: [chord("C"), chord("G")], melody: mel([[0, 64], [24, 67]]), bpm: 100, pattern: "ring", loop: true, bars: 2, meter: { num: 4, den: 4 }, beat: drums("909"), v: 4 };
  p = ensureSong(p, id);
  p = addNewSection(p, id);
  p = { ...p, chords: [chord("A"), chord("F")], melody: mel([[0, 69]]) };
  const a = p.song!.blocks[0].id;
  return selectBlock(p, a);
}
const blockOf = (p: Progression, i: number) => p.song!.blocks[i].id;
const go = (p: Progression, i: number) => selectBlock(p, blockOf(p, i));
const tabs = (p: Progression, kind: "chords" | "melody" | "drums") => tracksHere(p, kind).map((t) => t.name);

describe("every section has its own tracks", () => {
  it("a chords track added in A is in A only: B shows only its own tracks", () => {
    let p = song();
    p = addTrackHere(p, "chords", "c2").p;
    p = addTrackHere(p, "melody", "m2").p;
    expect(tabs(p, "chords")).toEqual(["Chords", "Chords 2"]);
    expect(tabs(p, "melody")).toEqual(["Melody", "Melody 2"]);
    expect(p.focus).toEqual({ chords: "c2", melody: "m2" });
    p = { ...p, chords: [chord("E")] };
    p = go(p, 1);
    // B: only its own; the page edits the first track there
    expect(tabs(p, "chords")).toEqual(["Chords"]);
    expect(tabs(p, "melody")).toEqual(["Melody"]);
    expect(p.focus).toBeUndefined();
    expect(roots(p.chords)).toEqual(["A", "F"]);
    // visiting B never puts the track there
    const [a, b] = sections(p);
    expect(Object.keys(a.layers ?? {})).toEqual(["c2", "m2"]);
    expect(b.layers).toBeUndefined();
    expect(roots(a.layers?.c2.chords)).toEqual(["E"]);
    // back in A it is still there
    p = focusTrack(go(p, 0), "chords", "c2");
    expect(roots(p.chords)).toEqual(["E"]);
  });

  it("+ in B reuses the row A has, lowest number first; with none free, a new row", () => {
    let p = song();
    p = addTrackHere(p, "chords", "c2").p;
    p = addTrackHere(p, "chords", "c3").p;
    expect(tabs(p, "chords")).toEqual(["Chords", "Chords 2", "Chords 3"]);
    p = go(p, 1);
    const r1 = addTrackHere(p, "chords", "x1");
    expect(r1.reused).toBe(true);
    expect(r1.track.id).toBe("c2");
    expect(r1.p.focus).toEqual({ chords: "c2" });
    // plain and empty here: nothing of A's comes along
    expect(r1.p.chords).toEqual([]);
    expect(r1.p.pattern).toBe("ring");
    const r2 = addTrackHere(r1.p, "chords", "x2");
    expect(r2.track.id).toBe("c3");
    const r3 = addTrackHere(r2.p, "chords", "c4");
    expect(r3.reused).toBe(false);
    expect(r3.track.name).toBe("Chords 4");
    expect(allTracks(r3.p).filter((t) => t.kind === "chords").map((t) => t.name)).toEqual(["Chords", "Chords 2", "Chords 3", "Chords 4"]);
    // A never got Chords 4
    expect(tabs(go(r3.p, 0), "chords")).toEqual(["Chords", "Chords 2", "Chords 3"]);
  });

  it("2 melody tracks in A, 1 chords and 1 drums in B", () => {
    let p = song();
    p = addTrackHere(p, "melody", "m2").p;
    p = go(p, 1);
    p = addTrackHere(p, "drums", "d2").p;
    expect([tabs(p, "chords"), tabs(p, "melody"), tabs(p, "drums")]).toEqual([["Chords"], ["Melody"], ["Drums", "Drums 2"]]);
    p = go(p, 0);
    expect([tabs(p, "chords"), tabs(p, "melody"), tabs(p, "drums")]).toEqual([["Chords"], ["Melody", "Melody 2"], ["Drums"]]);
  });

  it("✕ on a page takes a track out of the section on screen only; the Track page's ✕ out of the song", () => {
    let p = song();
    p = addTrackHere(p, "chords", "c2").p;
    p = { ...p, chords: [chord("E")] };
    p = go(p, 1);
    p = addTrackHere(p, "chords", "x").p;
    p = { ...p, chords: [chord("D")] };
    // out of B only
    const q = removeHere(p, "c2");
    expect(tabs(q, "chords")).toEqual(["Chords"]);
    expect(q.focus).toBeUndefined();
    expect(roots(sections(q)[0].layers?.c2.chords)).toEqual(["E"]);
    expect(allTracks(q).some((t) => t.id === "c2")).toBe(true);
    // out of A too: in no section, it leaves the song (and the mixer)
    const r = removeHere(go({ ...q, mix: { c2: { db: -3 } } }, 0), "c2");
    expect(allTracks(r).some((t) => t.id === "c2")).toBe(false);
    expect(r.mix).toBeUndefined();
    // the Track page's ✕: every section at once
    const s = removeTrack(p, "c2");
    expect(sections(s).every((x) => !x.layers?.c2)).toBe(true);
    expect(allTracks(s).some((t) => t.id === "c2")).toBe(false);
  });

  it("the first three are in every section and cannot be taken out of one", () => {
    const p = song();
    expect(removeHere(p, "chords")).toBe(p);
    for (const k of ["chords", "melody", "drums"]) expect(inSection(go(p, 1), k)).toBe(true);
  });

  it("the Track page's + makes a new row in the section on screen; its faint + puts a row into another section, plain", () => {
    let p = song();
    p = addTrack(p, "drums", "d2").p;
    expect(tabs(p, "drums")).toEqual(["Drums", "Drums 2"]);
    expect(tabs(go(p, 1), "drums")).toEqual(["Drums"]);
    p = { ...p, beat: drums("lofi", 0.9) };
    p = addTrackTo(p, blockOf(p, 1), "d2");
    const b = sections(p)[1].layers?.d2;
    expect(b?.beat?.on).toBe(false);
    expect(b?.beat?.kit).toBe(DEFAULT_BEAT.kit);
    // vocal tracks run across the whole song
    const v = addTrack(p, "vocals", "v1").p;
    expect(inSection(go(v, 1), "v1")).toBe(true);
  });

  it("a section no block plays any more takes its tracks with it", () => {
    let p = song();
    p = go(p, 1);
    p = addTrackHere(p, "melody", "m2").p;
    p = removeBlock(p, blockOf(p, 1));
    expect(allTracks(p).some((t) => t.id === "m2")).toBe(false);
  });
});

describe("every track in every section has its own settings", () => {
  it("the first chords track: style, feel, harp and instrument changed in B leave A as it was", () => {
    let p = go(song(), 1);
    p = { ...p, pattern: "strum", feel: { swing: 0.4 }, sound: { voice: "koto", space: 0.9 } };
    p = withTone(p, "chords", { inst: "piano" });
    const [a, b] = sections(go(p, 0));
    expect([a.style, a.feel, a.sound, toneOf(a, "chords").inst]).toEqual(["ring", undefined, undefined, "guitar"]);
    expect([b.style, b.feel, reviveSound(b.sound).voice, toneOf(b, "chords").inst]).toEqual(["strum", { swing: 0.4 }, "koto", "piano"]);
    // and back on B, the page shows B's
    const q = go(go(p, 0), 1);
    expect([q.pattern, reviveSound(q.sound).voice, toneOf(q, "chords").inst]).toEqual(["strum", "koto", "piano"]);
  });

  it("the melody's harp and instrument, the drums' kit and rhythm, each per section", () => {
    let p = go(song(), 1);
    p = { ...p, tuneSound: { voice: "lyre" }, beat: { ...drums("808", 0.7), swing: 0.5 } };
    p = withTone(p, "melody", { inst: "synth" });
    const [a, b] = sections(go(p, 0));
    expect(a.tuneSound).toBeUndefined();
    expect(toneOf(a, "melody").inst).toBe("guitar");
    expect(a.kit?.kit).toBe("909");
    expect(a.groove?.swing).toBe(0);
    expect(reviveSound(b.tuneSound).voice).toBe("lyre");
    expect(toneOf(b, "melody").inst).toBe("synth");
    expect([b.kit?.kit, b.kit?.space, b.groove?.swing]).toEqual(["808", 0.7, 0.5]);
  });

  it("drums off in one section, on in another", () => {
    let p = go(song(), 1);
    p = { ...p, beat: { ...p.beat!, on: false } };
    const [a, b] = sections(p);
    expect([a.groove?.on, b.groove?.on]).toEqual([true, false]);
  });

  it("Chords 1 and Chords 2 in one section, and Chords 2 in two sections, each have their own sound", () => {
    let p = song();
    p = addTrackHere(p, "chords", "c2").p;
    p = { ...p, chords: [chord("E")], pattern: "pinch", sound: { voice: "wire" } };
    p = withTone(p, "c2", { inst: "piano" });
    p = go(p, 1);
    p = addTrackHere(p, "chords", "x").p;
    p = { ...p, chords: [chord("D")], pattern: "quarters", sound: { voice: "koto" } };
    const [a, b] = sections(p);
    expect([a.style, a.sound]).toEqual(["ring", undefined]);
    expect([a.layers?.c2.pattern, reviveSound(a.layers?.c2.sound).voice, toneOf(a, "c2").inst]).toEqual(["pinch", "wire", "piano"]);
    expect([b.layers?.c2.pattern, reviveSound(b.layers?.c2.sound).voice, toneOf(b, "c2").inst]).toEqual(["quarters", "koto", "guitar"]);
    // the first chords track in A was never touched
    expect(normalize(go(p, 0)).pattern).toBe("ring");
  });

  it("an added drums track's kit and an added melody's harp, per section", () => {
    let p = song();
    p = addTrackHere(p, "drums", "d2").p;
    p = { ...p, beat: drums("lofi", 0.8) };
    p = addTrackHere(p, "melody", "m2").p;
    p = { ...p, melody: mel([[0, 72]]), tuneSound: { voice: "kora" } };
    p = go(p, 1);
    p = addTrackHere(p, "drums", "x").p;
    p = { ...p, beat: drums("707", 0.1) };
    const [a, b] = sections(p);
    expect([a.layers?.d2.beat?.kit, b.layers?.d2.beat?.kit]).toEqual(["lofi", "707"]);
    expect(reviveSound(a.layers?.m2.tuneSound).voice).toBe("kora");
    expect(b.layers?.m2).toBeUndefined();
  });

  it("a new section starts with a copy of the first tracks' settings of the section it was made from, no added tracks", () => {
    let p = go(song(), 1);
    p = { ...p, pattern: "strum", sound: { voice: "koto" }, tuneSound: { voice: "lyre" }, beat: drums("808", 0.6) };
    p = withTone(withTone(p, "chords", { inst: "piano" }), "melody", { inst: "synth" });
    p = addTrackHere(p, "chords", "c2").p;
    p = withTone(p, "c2", { inst: "synth" });
    p = addNewSection(p, id);
    const c = sections(p)[2];
    expect(c.current).toBe(true);
    expect(c.chords).toEqual([]);
    expect(c.melody).toBeUndefined();
    expect(c.layers).toBeUndefined();
    expect([c.style, reviveSound(c.sound).voice, reviveSound(c.tuneSound).voice, c.kit?.kit, c.groove?.on]).toEqual(["strum", "koto", "lyre", "808", true]);
    expect(c.tones).toEqual({ chords: { inst: "piano" }, melody: { inst: "synth" } });
    expect(tabs(p, "chords")).toEqual(["Chords"]);
    // then it is its own
    const q: Progression = { ...p, sound: { voice: "wire" } };
    expect(reviveSound(sections(q)[1].sound).voice).toBe("koto");
  });

  it("a block given its own section is an exact copy (added tracks too), then separate", () => {
    let p = song();
    p = addTrackHere(p, "chords", "c2").p;
    p = { ...p, chords: [chord("E")], sound: { voice: "wire" } };
    p = repeatSection(p, sections(p)[0].partId, id);
    const copyBlock = p.song!.blocks.find((b, i) => i > 0 && b.partId === p.song!.blocks[0].partId)!.id;
    p = unlinkBlock(p, copyBlock, id);
    const secs = sections(p);
    const copy = secs.find((s) => s.blockId === copyBlock)!;
    expect(roots(copy.layers?.c2.chords)).toEqual(["E"]);
    expect(reviveSound(copy.layers?.c2.sound).voice).toBe("wire");
    expect(copy.partId).not.toBe(secs[0].partId);
  });

  it("All sections copies a track's sound (not its music, not the drum rhythm) to the same track in every other section that has it", () => {
    let p = song();
    p = addTrackHere(p, "chords", "c2").p;
    p = { ...p, chords: [chord("E")] };
    p = go(p, 1);
    p = addTrackHere(p, "chords", "x").p;
    p = { ...p, chords: [chord("D")], pattern: "quarters", feel: { swing: 0.2 }, sound: { voice: "koto" } };
    p = withTone(p, "c2", { inst: "piano" });
    expect(sectionsWith(p, "c2")).toBe(1);
    const q = soundToAll(p, "chords", "c2");
    const [a] = sections(q);
    expect([a.layers?.c2.pattern, a.layers?.c2.feel, reviveSound(a.layers?.c2.sound).voice, toneOf(a, "c2").inst]).toEqual(["quarters", { swing: 0.2 }, "koto", "piano"]);
    expect(roots(a.layers?.c2.chords)).toEqual(["E"]);
    // the first drums: the kit goes, never the rhythm or on/off
    let d: Progression = { ...go(song(), 1), beat: { ...drums("lofi", 0.9), on: false, swing: 0.6 } };
    d = soundToAll(d, "drums", "drums");
    const [da] = sections(d);
    expect([da.kit?.kit, da.kit?.space, da.groove?.on, da.groove?.swing]).toEqual(["lofi", 0.9, true, 0]);
    // the first melody: its harp and instrument
    let m: Progression = withTone({ ...go(song(), 1), tuneSound: { voice: "lyre" } } as Progression, "melody", { inst: "synth" });
    m = soundToAll(m, "melody", "melody");
    expect(reviveSound(sections(m)[0].tuneSound).voice).toBe("lyre");
    expect(toneOf(sections(m)[0], "melody").inst).toBe("synth");
    expect(sections(m)[0].melody?.notes.length).toBe(2);
  });

  it("a whole song's sounds survive a reload, section by section", () => {
    let p = song();
    p = addTrackHere(p, "chords", "c2").p;
    p = { ...p, chords: [chord("E")], sound: { voice: "wire" } };
    p = go(p, 1);
    p = { ...p, sound: { voice: "koto" }, beat: drums("808") };
    p = withTone(p, "chords", { inst: "piano" });
    const back = reviveProgression(JSON.parse(JSON.stringify(normalize(p))));
    const [a, b] = sections(back);
    expect(reviveSound(a.layers?.c2.sound).voice).toBe("wire");
    expect([reviveSound(b.sound).voice, b.kit?.kit, toneOf(b, "chords").inst]).toEqual(["koto", "808", "piano"]);
    expect(toneOf(a, "chords").inst).toBe("guitar");
    expect(b.layers).toBeUndefined();
    // the same idea: not changed by being saved and opened
    const snap = (x: Progression) => fingerprint(snapshot(C, x, 0, "standard"));
    expect(snap(back)).toBe(snap(p));
    expect(sameMusic(back, p)).toBe(true);
  });
});

describe("copy and paste carry a track's settings", () => {
  it("chords: the music and the track's style, harp and instrument go to the track on screen in the section on screen", () => {
    let p = song();
    p = { ...p, pattern: "pinch", feel: { swing: 0.3 }, sound: { voice: "wire" } };
    p = withTone(p, "chords", { inst: "piano" });
    const clip = copyRhythm(p, C, "A");
    let q = go(p, 1);
    q = addTrackHere(q, "chords", "c2").p;
    const before = pastePart(q, "rhythm");
    q = pasteRhythm(q, clip, C, id);
    expect(roots(q.chords)).toEqual(["C", "G"]);
    expect([q.pattern, q.feel, reviveSound(q.sound).voice, toneOf(q, "c2").inst]).toEqual(["pinch", { swing: 0.3 }, "wire", "piano"]);
    // Chords 1 in B kept its own
    expect(toneOf(q, "chords").inst).toBe("guitar");
    // undo puts back the music and the sound
    const u = { ...q, ...unpastePart(q, before, "c2") };
    expect(u.chords).toEqual([]);
    expect([u.pattern, u.sound, toneOf(u, "c2").inst]).toEqual(["ring", undefined, "guitar"]);
  });

  it("melody and drums: the music and the sound", () => {
    let p: Progression = withTone({ ...song(), tuneSound: { voice: "lyre" }, beat: { ...drums("lofi", 0.9), swing: 0.2 } } as Progression, "melody", { inst: "synth" });
    const m = copyMelody(p, C, "A");
    const d = copyDrums(p, C, "A");
    p = go(p, 1);
    p = pasteDrums(pasteMelody(p, m, C), d);
    expect([reviveSound(p.tuneSound).voice, toneOf(p, "melody").inst, p.beat?.kit, p.beat?.space, p.beat?.swing]).toEqual(["lyre", "synth", "lofi", 0.9, 0.2]);
  });

  it("a copy made by an older version brings only its music", () => {
    const p = go(song(), 1);
    const q = pasteRhythm({ ...p, pattern: "strum" }, { from: "A", key: C, chords: [chord("D")] }, C, id);
    expect(q.pattern).toBe("strum");
    expect(pasteDrums(p, { from: "A", key: C, beat: drums("lofi") }).beat?.kit).toBe("909");
  });

  it("a whole section pasted brings its tracks and how they sound, in place of the target's", () => {
    let p = song();
    p = addTrackHere(p, "chords", "c2").p;
    p = { ...p, chords: [chord("E")], sound: { voice: "wire" } };
    p = withTone(p, "c2", { inst: "piano" });
    const clip = copySection(p, blockOf(p, 0), C)!;
    p = go(p, 1);
    p = addTrackHere(p, "melody", "m2").p;
    p = { ...p, melody: mel([[0, 60]]) };
    p = pasteSection(p, blockOf(p, 1), clip, C, id);
    const b = sections(p)[1];
    expect(Object.keys(b.layers ?? {})).toEqual(["c2"]);
    expect(reviveSound(b.layers?.c2.sound).voice).toBe("wire");
    expect(toneOf(b, "c2").inst).toBe("piano");
    // Melody 2 was in B only: it left the song
    expect(allTracks(p).some((t) => t.id === "m2")).toBe(false);
  });
});

describe("Harmonize works in the section on screen", () => {
  it("lists only this section's tracks with music, writes this section only, adds the track here only", () => {
    let p = song();
    p = go(p, 1);
    p = addTrackHere(p, "melody", "m2").p;
    p = { ...p, melody: mel([[0, 72], [12, 74]]) };
    expect(harmonizeSources(p).map((t) => t.id)).toEqual(["chords", "melody", "m2"]);
    expect(harmonizeSources(go(p, 0)).map((t) => t.id)).toEqual(["chords", "melody"]);
    const r = addHarmony(normalize(p), C, { kind: "melody", from: "melody", option: "third-above" }, "h1");
    expect(r.track).toBeDefined();
    const [a, b] = sections(r.p);
    expect(a.layers?.h1).toBeUndefined();
    expect(b.layers?.h1?.melody?.notes.length).toBeGreaterThan(0);
    expect(Object.keys(r.track!.harmony!.marks ?? {})).toEqual([b.partId]);
    // it comes on plain settings
    expect(b.layers?.h1?.tuneSound).toBeUndefined();
    expect(toneOf(b, "h1").inst).toBe("guitar");
    // written again in A after it was put there, B keeps what it has
    let q = addTrackTo(r.p, blockOf(r.p, 0), "h1");
    q = go(q, 0);
    q = rewriteHarmony(q, C, "h1");
    const [a2, b2] = sections(q);
    expect(a2.layers?.h1?.melody?.notes.length).toBeGreaterThan(0);
    expect(b2.layers?.h1?.melody).toEqual(b.layers?.h1?.melody);
    expect(Object.keys(q.tracks!.find((t) => t.id === "h1")!.harmony!.marks ?? {}).sort()).toEqual([a.partId, b.partId].sort());
  });

  it("one that plays instead of chords is heard in their place in its section only; the mixer is left alone", () => {
    const p = song();
    const r = addHarmony(normalize(p), C, { kind: "chords", from: "chords", option: "relative" }, "h1");
    expect(r.track).toBeDefined();
    expect(r.p.mix).toBeUndefined();
    const [a, b] = sections(r.p);
    expect(insteadIn(a.partId, a.layers, r.p.tracks, r.p.mix).has("chords")).toBe(true);
    expect(insteadIn(b.partId, b.layers, r.p.tracks, r.p.mix).has("chords")).toBe(false);
    // muted by hand, the chords it replaces are heard again
    expect(insteadIn(a.partId, a.layers, r.p.tracks, { h1: { mute: true } }).has("chords")).toBe(false);
  });
});

describe("the page keeps one track of a kind in front", () => {
  it("a track brought forward in A is not brought forward in B (B has none)", () => {
    let p = addTrackHere(song(), "chords", "c2").p;
    p = go(p, 1);
    expect(p.focus).toBeUndefined();
    expect(commit(p).song!.parts[1].layers).toBeUndefined();
  });
  it("a kit changed on the drums page belongs to the section on screen", () => {
    let p = go(song(), 1);
    p = { ...p, beat: { ...p.beat!, kit: "lofi" } };
    expect(kitSig(sections(p)[0].kit!)).toBe(kitSig(kitOfBeat(drums("909"))));
  });
});

describe("Arrange is each chords track's own, in each section", () => {
  const SEVEN = { zone: 3, strings: "any" as const, inversions: false };
  it("set on Chords 1 in A: not B's, not Chords 3's in A; it plays with A's Chords 1 only", () => {
    let p = song();
    p = { ...p, arrange: SEVEN };
    p = addTrackHere(p, "chords", "c3").p;
    p = { ...p, chords: [chord("D")] };
    // the page shows the track on screen: Chords 3 is on its own shapes
    expect(p.arrange ?? null).toBeNull();
    p = focusTrack(p, "chords", "chords");
    expect(p.arrange).toEqual(SEVEN);
    const b = go(p, 1);
    expect(b.arrange ?? null).toBeNull();
    const [sa, sb] = sections(p);
    expect(sa.arrange).toEqual(SEVEN);
    expect(sa.layers?.c3.arrange).toBeUndefined();
    expect(sb.arrange).toBeUndefined();
    // changed in B, A keeps its own
    const q = go({ ...b, arrange: { zone: 0, strings: 4, inversions: true } }, 0);
    expect(q.arrange).toEqual(SEVEN);
    expect(sections(q)[1].arrange).toEqual({ zone: 0, strings: 4, inversions: true });
    // which section is on screen is not a change to the idea
    expect(sameMusic(go(q, 1), q)).toBe(true);
  });
  it("on an added chords track, kept with its part of the section while another is in front", () => {
    let p = addTrackHere(song(), "chords", "c2").p;
    p = { ...p, chords: [chord("E")], arrange: SEVEN };
    p = focusTrack(p, "chords", "chords");
    expect(p.arrange ?? null).toBeNull();
    expect(normalize(p).layers?.c2.arrange).toEqual(SEVEN);
    expect(focusTrack(p, "chords", "c2").arrange).toEqual(SEVEN);
  });
  it("a new section starts with Chords 1's Arrange; All sections, copy and paste and a reload carry it", () => {
    let p: Progression = { ...song(), arrange: SEVEN };
    p = addNewSection(p, id);
    expect(p.arrange).toEqual(SEVEN);
    // All sections: the same track in every other section gets it, music left alone
    let q = go(song(), 1);
    q = soundToAll({ ...q, arrange: SEVEN }, "chords", "chords");
    expect(sections(q)[0].arrange).toEqual(SEVEN);
    expect(roots(sections(q)[0].chords)).toEqual(["C", "G"]);
    // copy on A's Chords 1, paste into B's
    const clip = copyRhythm({ ...song(), arrange: SEVEN }, C, "A");
    expect(clip.arrange).toEqual(SEVEN);
    const pasted = pasteRhythm(go(song(), 1), { ...clip, tone: { inst: "guitar" } }, C, id);
    expect(pasted.arrange).toEqual(SEVEN);
    expect(pastePart(pasted, "rhythm").arrange).toEqual(SEVEN);
    // saved and opened again
    const back = reviveProgression(JSON.parse(JSON.stringify(normalize(go(q, 1)))));
    expect(sections(back).map((s) => s.arrange)).toEqual([SEVEN, SEVEN]);
  });
});

describe("each section remembers the track a page was editing there", () => {
  it("Chords 2 in A, over to B (which has none) and back: Chords 2 again", () => {
    let p = addTrackHere(song(), "chords", "c2").p;
    p = addTrackHere(p, "melody", "m2").p;
    expect(p.focus).toEqual({ chords: "c2", melody: "m2" });
    p = go(p, 1);
    expect(p.focus).toBeUndefined();
    p = go(p, 0);
    expect(p.focus).toEqual({ chords: "c2", melody: "m2" });
    // what was chosen in A by hand comes back, Chords 1 included
    p = focusTrack(p, "chords", "chords");
    p = go(go(p, 1), 0);
    expect(p.focus).toEqual({ melody: "m2" });
  });
  it("a section not seen yet keeps the track in front where it has it; a track gone from a section is not brought back", () => {
    let p = addTrackHere(song(), "chords", "c2").p;
    // C: made from A, then given Chords 2 by hand; opened again (nothing remembered), Chords 2 in front in A
    p = addNewSection(p, id);
    p = addTrackTo(p, blockOf(p, 2), "c2");
    p = { ...focusTrack(go(p, 0), "chords", "c2"), focusIn: undefined };
    const c = selectBlock(p, blockOf(p, 2));
    expect(c.focus).toEqual({ chords: "c2" });
    // seen in this session, C shows what was last edited there: Chords 1
    let seen = addNewSection(addTrackHere(song(), "chords", "c2").p, id);
    seen = addTrackTo(seen, blockOf(seen, 2), "c2");
    expect(go(go(seen, 0), 2).focus).toBeUndefined();
    // Chords 2 taken out of A while away: A shows Chords 1
    let q = go(p, 1);
    q = { ...q, song: { ...q.song!, parts: q.song!.parts.map((x, i) => (i === 0 ? { ...x, layers: undefined } : x)) } };
    expect(go(q, 0).focus).toBeUndefined();
  });
  it("is not part of the idea", () => {
    let p = addTrackHere(song(), "chords", "c2").p;
    p = go(go(p, 1), 0);
    expect(p.focusIn).toBeDefined();
    expect(snapshot(C, p, 0, "standard").progression.focusIn).toBeUndefined();
    expect(sameMusic(p, song())).toBe(false);
    expect(fingerprint(snapshot(C, go(p, 1), 0, "standard"))).toBe(fingerprint(snapshot(C, p, 0, "standard")));
  });
});

describe("a harmony that plays instead of chords does so in the sections it was written to", () => {
  /** A played twice (one section), then B */
  const twice = () => {
    let p = song();
    p = repeatSection(p, p.song!.blocks[0].partId, id);
    return go(p, 0);
  };
  const heardIn = (p: Progression, i: number, tid = "chords") => {
    const s = sections(p)[i];
    return !insteadIn(s.partId, s.layers, normalize(p).tracks, normalize(p).mix).has(tid);
  };
  it("written again with a layer in a copy of the section, the original still plays instead of its chords", () => {
    let p = addHarmony(normalize(twice()), C, { kind: "chords", from: "chords", option: "borrowed" }, "h1").p;
    expect([heardIn(p, 0), heardIn(p, 1)]).toEqual([false, false]);
    // the repeat gets a section of its own (h1 with it), and there Darker is written again as a Pad
    const rep = p.song!.blocks.findIndex((b, i) => i > 0 && b.partId === p.song!.blocks[0].partId);
    p = unlinkBlock(p, p.song!.blocks[rep].id, id);
    p = selectBlock(p, p.song!.blocks[rep].id);
    p = rewriteHarmony(p, C, "h1", "pad");
    const order = sections(p);
    const a = order.findIndex((s) => s.partId === p.song!.blocks[0].partId);
    expect(heardIn(p, a)).toBe(false);
    expect(heardIn(p, rep)).toBe(true);
    expect(p.mix).toBeUndefined();
    // each section says what it was written with
    const h = p.tracks!.find((t) => t.id === "h1")!.harmony!;
    expect(h.marks?.[order[a].partId]?.option).toBe("borrowed");
    expect(h.marks?.[order[rep].partId]?.option).toBe("pad");
    // written again in A with nothing said, it keeps A's own option
    const again = rewriteHarmony(go(p, 0), C, "h1");
    expect(again.tracks!.find((t) => t.id === "h1")!.harmony!.marks?.[order[a].partId]?.option).toBe("borrowed");
    expect(heardIn(again, a)).toBe(false);
  });
  it("says which track plays instead", () => {
    const p = addHarmony(normalize(song()), C, { kind: "chords", from: "chords", option: "relative" }, "h1").p;
    const s = sections(p)[0];
    expect(insteadIn(s.partId, s.layers, p.tracks, p.mix).get("chords")).toBe("h1");
  });
  it("its source gone, it still plays instead of the song's chords in the same sections only", () => {
    let p = addTrackHere(song(), "melody", "m2").p;
    p = { ...p, melody: mel([[0, 72], [12, 74]]) };
    p = addHarmony(normalize(p), C, { kind: "chords", from: "m2", option: "relative" }, "h1").p;
    expect(heardIn(p, 0)).toBe(false);
    p = removeTrack(p, "m2");
    const t = p.tracks!.find((x) => x.id === "h1")!;
    expect(t.harmony).toBeUndefined();
    expect(t.replaces).toBe("chords");
    expect(t.replacesIn).toEqual([sections(p)[0].partId]);
    expect(heardIn(p, 0)).toBe(false);
    // B has no part of it: its chords are heard; put there by hand and written in, they still are
    let q = addTrackTo(p, blockOf(p, 1), "h1");
    q = go(q, 1);
    q = focusTrack(q, "chords", "h1");
    q = { ...q, chords: [chord("D")] };
    expect(heardIn(q, 1)).toBe(true);
    // a copy of A plays instead of them too
    const twiceA = repeatSection(p, p.song!.blocks[0].partId, id);
    const r = unlinkBlock(twiceA, blockOf(twiceA, 1), id);
    expect(sections(r).length).toBe(3);
    expect(sections(r).map((_, i) => heardIn(r, i))).toEqual([false, false, true]);
  });
});

describe("All sections on an added drums track", () => {
  it("copies the whole kit: what the other section's kit had of its own (mutes, echo, a drum's sound) goes", () => {
    let p = addTrackHere(song(), "drums", "d2").p;
    p = { ...p, beat: { ...drums("909"), on: true } };
    p = go(p, 1);
    p = addTrackHere(p, "drums", "x").p;
    expect(p.focus?.drums).toBe("d2");
    p = { ...p, beat: { ...drums("808", 0.6), mutes: ["hat"], echo: 0.5, voices: { snare: "lofi" } } as Beat };
    p = go(p, 0);
    p = focusTrack(p, "drums", "d2");
    p = soundToAll(p, "drums", "d2");
    const b = sections(p)[1].layers!.d2.beat!;
    expect(kitSig(kitOfBeat(b))).toBe(kitSig(kitOfBeat(drums("909"))));
    expect([b.mutes, b.echo, b.voices]).toEqual([undefined, undefined, undefined]);
    // its rhythm and on/off stay B's
    expect([b.on, b.rows.kick]).toEqual([true, ROWS.kick]);
  });
});
