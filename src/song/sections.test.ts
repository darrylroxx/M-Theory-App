import { describe, expect, it } from "vitest";
import { BEAT_LIBRARY, DEFAULT_BEAT, applyPattern, barBeats, grooveOf, type Beat } from "../audio/beats";
import type { ProgChord, Progression } from "../ui/state";
import { letterClass } from "../ui/letters";
import { addNewSection, commit, ensureSong, fitName, leadFirst, letters, linkState, loadCurrent, moveBlockTo, newLetter, removeBlock, renameSection, repeatSection, reviveSong, sections, selectBlock, setSectionBars, unlinkBlock, type Section } from "./structure";
import { addTrack, normalize, type Track } from "./tracks";
import { conform, sectionSig, setSectionSig, setSig } from "./unity";
import { sigName } from "./meter";
import { copySection, pasteSection, reviveClips, sectionHasContent } from "./clip";
import type { Take } from "./takes";

const chord = (root: string, beats = 4): ProgChord => ({ id: `${root}${Math.random()}`, ref: { root, typeId: "maj" }, beats });
const base = (roots: string[] = [], more: Partial<Progression> = {}): Progression => ({ chords: roots.map((r) => chord(r)), bpm: 90, pattern: "ring", loop: true, bars: 2, meter: { num: 4, den: 4 }, ...more });
let n = 0;
const id = () => `s${++n}`;
const rock = BEAT_LIBRARY.find((p) => p.steps === 16 && p.div === 4 && (p.bars ?? 1) === 1)!;
const motorik = BEAT_LIBRARY.find((x) => x.name === "Motorik")!;
const on = (p = rock): Beat => applyPattern({ ...DEFAULT_BEAT, on: true }, p);
const C = { tonic: "C", scaleId: "ionian" };
const D = { tonic: "D", scaleId: "ionian" };
const labels = (p: Progression) => sections(p).map((s) => s.label).join(" ");
const roots = (s: Section | undefined) => (s?.chords ?? []).map((c) => c.ref.root).join("");
/** what every section plays, apart from which block it is: so two songs that sound the same compare equal */
const sound = (p: Progression) => sections(p).map((s) => ({ part: s.partId, chords: roots(s), beats: s.chords.map((c) => c.beats), style: s.style, feel: s.feel, sound: s.sound, tune: s.tuneSound, groove: s.groove && { rows: s.groove.rows, steps: s.groove.steps, div: s.groove.div, on: s.groove.on }, kit: s.kit?.kit, bars: s.bars, meter: s.meter && sigName(s.meter) }));

/** A B C, each with its own chords; B with its own style and drums. C is on screen. */
function abc(): Progression {
  let p = ensureSong(base(["C", "G"], { pattern: "strum", beat: on() }), id);
  p = addNewSection(p, id);
  p = { ...p, chords: [chord("F"), chord("A")], pattern: "pinch", beat: { ...on(motorik), kit: "909" } };
  p = addNewSection(p, id);
  p = { ...p, chords: [chord("D"), chord("E")] };
  return conform(p);
}

describe("section names and letters", () => {
  it("a name: one line, at most 24 characters; empty means the letter", () => {
    expect(fitName("  Verse  ")).toBe("Verse");
    expect(fitName("a\nb\t c")).toBe("a b c");
    expect(fitName("x".repeat(40))).toHaveLength(24);
    expect(fitName("🎸".repeat(30))).toBe("🎸".repeat(24));
    expect(fitName("   ")).toBeUndefined();
    expect(fitName(7)).toBeUndefined();
  });

  it("letters follow the order sections first play in; a name stays with its section wherever it goes", () => {
    let p = abc();
    const [a, b, c] = sections(p).map((s) => s.blockId);
    p = renameSection(p, b, "Chorus");
    expect(labels(p)).toBe("A Chorus C");
    p = repeatSection(p, sections(p)[1].partId, id); // after C: A Chorus C Chorus
    expect(labels(p)).toBe("A Chorus C Chorus");
    p = moveBlockTo(p, c, 0);
    expect(labels(p)).toBe("A B Chorus Chorus");
    expect(sections(p).map((s) => roots(s)).join(" ")).toBe("DE CG FA FA");
    p = moveBlockTo(p, b, 0);
    expect(labels(p)).toBe("Chorus B C Chorus");
    expect(sections(p).map((s) => s.letter).join("")).toBe("ABCA");
    // a name back to nothing: its letter again
    p = renameSection(p, b, "");
    expect(labels(p)).toBe("A B C A");
    expect(renameSection(p, a, "")).toBe(p);
  });

  it("colours go with the sections, not with their places", () => {
    let p = abc();
    const before = Object.fromEntries(sections(p).map((s) => [s.partId, s.color]));
    expect(Object.values(before)).toEqual([0, 1, 2]);
    p = moveBlockTo(p, sections(p)[2].blockId, 0);
    p = moveBlockTo(p, sections(p)[2].blockId, 1);
    for (const s of sections(p)) expect(s.color).toBe(before[s.partId]);
    // a new section gets a colour no one has; so does an unlinked copy
    p = addNewSection(p, id);
    expect(sections(p).find((s) => s.current)!.color).toBe(3);
    p = repeatSection(p, sections(p)[0].partId, id);
    p = unlinkBlock(p, sections(p).find((s) => s.current)!.blockId, id);
    expect(sections(p).find((s) => s.current)!.color).toBe(4);
    // the class works for any name, and for numbers
    expect([0, 7, 8, -1].map(letterClass)).toEqual(["L0", "L7", "L0", "L7"]);
    for (const name of ["Verse", "1", "über", "ä", "", "🎸 riff"]) expect(letterClass(name)).toMatch(/^L[0-7]$/);
    expect(letterClass("Verse")).toBe(letterClass("Verse"));
  });

  it("an unlinked copy has no name: it has its own letter", () => {
    let p = renameSection(ensureSong(base(["C"]), id), "", "Hook");
    p = repeatSection(p, sections(p)[0].partId, id);
    expect(labels(p)).toBe("Hook Hook");
    p = unlinkBlock(p, sections(p)[1].blockId, id);
    expect(labels(p)).toBe("Hook B");
  });

  it("the letter a new section will have", () => {
    let p = abc(); // C on screen, last
    expect(newLetter(p)).toBe("D");
    p = selectBlock(p, sections(p)[0].blockId);
    expect(newLetter(p)).toBe("B");
    expect(newLetter(base(["C"]))).toBe("B");
    p = addNewSection(p, id);
    expect(labels(p)).toBe("A B C D");
    expect(roots(sections(p)[2])).toBe("FA");
  });

  it("names, colours and signatures are saved; old songs keep the colours their letters had", () => {
    let p = renameSection(abc(), "", "Outro");
    p = setSectionSig(p, sections(p)[1].blockId, { num: 3, den: 4 });
    const back = reviveSong(JSON.parse(JSON.stringify(commit(p).song)))!;
    const q = loadCurrent({ ...p, song: back });
    expect(labels(q)).toBe("A B Outro");
    expect(sections(q).map((s) => s.color)).toEqual([0, 1, 2]);
    expect(sections(q).map((s) => s.meter && sigName(s.meter))).toEqual([undefined, "3/4", undefined]);
    // names that are not names are dropped
    expect(reviveSong({ ...back, parts: back.parts.map((x) => ({ ...x, name: 42, meter: { num: 5, den: 2 } })) })!.parts.every((x) => !x.name && !x.meter)).toBe(true);
    // a song from before: stored letters (any order), no colours; letters follow the playing order, colours the old letters
    const old = {
      parts: [{ id: "x", letter: "C", chords: [chord("C")] }, { id: "y", letter: "A", chords: [chord("F")] }, { id: "z", chords: [] }],
      blocks: [{ id: "1", partId: "x" }, { id: "2", partId: "y" }, { id: "3", partId: "z" }],
      current: "1",
    };
    const s = sections({ ...base(), song: reviveSong(old) });
    expect(s.map((x) => x.label).join("")).toBe("ABC");
    expect(s.map((x) => x.color)).toEqual([2, 0, 1]);
  });

  it("whatever plays first leads: '= A' is always the first section, and nothing changes its sound", () => {
    let p = abc();
    const before = sound(p);
    const [, b] = sections(p).map((s) => s.blockId);
    p = moveBlockTo(p, b, 0); // B to the front: it leads now
    expect(p.song!.parts[0].id).toBe(sections(p)[0].partId);
    expect(sound(p).sort((x, y) => x.part.localeCompare(y.part))).toEqual(before.sort((x, y) => x.part.localeCompare(y.part)));
    expect(linkState(selectBlock(p, sections(p)[1].blockId)).source).toBe("A");
    // the old first section kept what it had (now as its own): the strum and the rock beat
    expect(linkState(selectBlock(p, sections(p)[1].blockId)).own).toMatchObject({ style: true, groove: true, kit: true });
    // the new leader's settings are the song's: a new section starts with them
    p = addNewSection(selectBlock(p, sections(p)[0].blockId), id);
    expect(p.pattern).toBe("pinch");
    expect(p.beat!.kit).toBe("909");
    // named, the leader's name is what the others follow
    p = renameSection(p, sections(p)[0].blockId, "Intro");
    expect(linkState(p).source).toBe("Intro");
  });

  it("a song saved with another section leading is led by the first one when it opens, sounding the same", () => {
    const p = abc();
    const song = commit(p).song!;
    // as an older build left it: the leader moved to the back
    const moved = { ...song, blocks: [song.blocks[2], song.blocks[0], song.blocks[1]] };
    const q0 = loadCurrent({ ...p, song: reviveSong(JSON.parse(JSON.stringify(moved)))! });
    const q = leadFirst(q0);
    expect(q.song!.parts[0].id).toBe(moved.blocks[0].partId);
    expect(sound(q)).toEqual(sound(q0));
    expect(leadFirst(q)).toBe(q);
  });

  it("removing the first block of a section that plays again later hands the lead to what now plays first", () => {
    let p = abc();
    p = repeatSection(selectBlock(p, sections(p)[1].blockId), sections(p)[0].partId, id); // A B A C
    const before = sound(p).slice(1);
    p = removeBlock(p, sections(p)[0].blockId); // B A C
    expect(labels(p)).toBe("A B C");
    expect(p.song!.parts[0].id).toBe(sections(p)[0].partId);
    expect(sound(p)).toEqual(before);
  });

  it("letters() lists each section once, with its name and colour", () => {
    const p = renameSection(abc(), "", "Out");
    expect(letters(p).map((x) => [x.letter, x.label, x.color])).toEqual([["A", "A", 0], ["B", "B", 1], ["C", "Out", 2]]);
  });
});

describe("a time signature for each section", () => {
  it("only that section is fitted to its new bars; the others sound as they did", () => {
    let p = abc();
    p = addTrack(p, "chords", "c2").p;
    p = { ...p, chords: [chord("B", 8)] }; // Chords 2 in C
    p = { ...p, focus: undefined, ...normalize(p) };
    p = conform(normalize(p));
    const [a, b, c] = sections(p);
    const q = setSectionSig(p, b.blockId, { num: 3, den: 4 });
    const [qa, qb, qc] = sections(q);
    expect(sigName(sectionSig(q, b.blockId))).toBe("3/4");
    expect(qb.meter).toEqual({ num: 3, den: 4 });
    expect(qb.chords.map((x) => x.beats)).toEqual([3, 3]);
    expect(barBeats(qb.groove!)).toBe(3);
    expect(qb.bars).toBe(b.bars);
    // the others: exactly as before
    expect([qa, qc].map((s) => ({ ...s, current: false }))).toEqual([a, c].map((s) => ({ ...s, current: false })));
    expect(q.song!.parts.find((x) => x.id === c.partId)!.layers?.c2.chords?.map((x) => x.beats)).toEqual([8]);
    // back to the song's signature: it follows the song again
    const r = setSectionSig(q, b.blockId, { num: 4, den: 4 });
    expect(sections(r)[1].meter).toBeUndefined();
    expect(sections(r)[1].chords.map((x) => x.beats)).toEqual([4, 4]);
    // the same signature again changes nothing
    expect(setSectionSig(q, b.blockId, { num: 3, den: 4 })).toBe(q);
  });

  it("a section in another signature that follows the song's drums plays them in its own bars, and still follows", () => {
    let p = abc();
    const c = sections(p)[2];
    p = setSectionSig(p, c.blockId, { num: 3, den: 4 });
    expect(sections(p)[2].groove!.steps).toBe(12);
    // C is on screen: it does not have the drums as its own
    expect(linkState(p).own.groove).toBe(false);
    p = selectBlock(selectBlock(p, sections(p)[0].blockId), c.blockId);
    expect(linkState(p).own.groove).toBe(false);
    expect(p.song!.parts.find((x) => x.id === c.partId)!.groove).toBeUndefined();
    expect(barBeats(p.beat!)).toBe(3);
    // A's drums change: C follows, in its bars
    p = selectBlock(p, sections(p)[0].blockId);
    p = { ...p, beat: { ...applyPattern(p.beat!, motorik), kit: p.beat!.kit } };
    p = conform(p);
    expect(sections(p)[2].groove!.name).toBe("Motorik");
    expect(sections(p)[2].groove!.steps).toBe(12);
  });

  it("the first section's own signature: the others keep sounding the same", () => {
    let p = abc();
    const before = sound(p).slice(1);
    p = setSectionSig(p, sections(p)[0].blockId, { num: 6, den: 8 });
    expect(sections(p)[0].groove!.div).toBe(3);
    expect(sound(p).slice(1)).toEqual(before);
    // and the song's 4/4 groove is kept for C, which followed it
    expect(sections(p)[2].groove!.steps).toBe(16);
  });

  it("the song's signature takes along only the sections that follow it", () => {
    let p = abc();
    const b = sections(p)[1];
    p = setSectionSig(p, b.blockId, { num: 6, den: 8 });
    const keep = sound(p)[1];
    const q = setSig(p, { num: 3, den: 4 });
    expect(sigName(q.meter!)).toBe("3/4");
    expect(sound(q)[1]).toEqual(keep);
    expect([0, 2].map((i) => sections(q)[i].chords.map((x) => x.beats).join())).toEqual(["3,3", "3,3"]);
    expect([0, 2].map((i) => barBeats(sections(q)[i].groove!))).toEqual([3, 3]);
  });

  it("conform stays cheap: a song with sections in several signatures comes back as it is", () => {
    let p = abc();
    p = setSectionSig(p, sections(p)[1].blockId, { num: 7, den: 4 });
    p = setSectionSig(p, sections(p)[2].blockId, { num: 12, den: 8 });
    const q = conform(p);
    expect(conform(q)).toBe(q);
    // a rhythm picked for other bars is fitted to the section on screen
    const r = conform({ ...q, beat: { ...q.beat!, ...grooveOf(on(rock)) } });
    expect([r.beat!.steps, r.beat!.div]).toEqual([12, 3]);
    expect(conform(r)).toBe(r);
  });

  it("with no song yet, the page's signature is the song's", () => {
    const p = setSectionSig(conform(base(["C"])), "", { num: 3, den: 4 });
    expect(sigName(p.meter!)).toBe("3/4");
    expect(p.chords[0].beats).toBe(3);
  });
});

describe("copy and paste a whole section", () => {
  const take = (k: Partial<Take> & { id: string; group: string; block: string }): Take => ({ n: 1, dry: `C:/rec/${k.group}.wav`, wet: `C:/rec/${k.group}-wet.wav`, rate: 48000, start: 0, frames: 48000, ...k, at: { block: k.block, bar: 1 } });
  /** abc, with Chords 2, Melody 2 and Drums 2 written in B, and a vocal track with recordings in B and C */
  function full(): Progression {
    let p = abc();
    p = selectBlock(p, sections(p)[1].blockId);
    p = { ...p, melody: { div: 2, bars: 2, notes: [{ at: 0, midi: 64 }, { at: 24, midi: 67 }] }, tuneSound: { voice: "glass" } };
    p = addTrack(p, "chords", "c2").p;
    p = { ...p, chords: [chord("D", 2)] };
    p = addTrack(p, "melody", "m2").p;
    p = { ...p, melody: { div: 2, bars: 2, notes: [{ at: 12, midi: 71 }] } };
    p = addTrack(p, "drums", "d2").p;
    p = { ...p, beat: { ...on(motorik), name: "Second" } };
    p = normalize(p);
    const [, b, c] = sections(p);
    const vocal: Track = {
      id: "v1", kind: "vocals", name: "Vocal 1", input: 1,
      takes: [take({ id: "t1", group: "g1", block: b.blockId }), take({ id: "t2", n: 2, group: "g1", block: b.blockId }), take({ id: "t3", group: "g2", block: c.blockId })],
      active: { g1: "t1", g2: "t3" },
    };
    return conform({ ...p, tracks: [...(p.tracks ?? []), vocal] });
  }

  it("everything in it, every track, into another section; its name and colour stay", () => {
    let p = full();
    const [a, b, c] = sections(p);
    const clip = copySection(p, b.blockId, C, null)!;
    expect(clip.from).toBe("B");
    expect(Object.keys(clip.layers ?? {}).sort()).toEqual(["c2", "d2", "m2"]);
    expect(clip.tracks.map((t) => t.id).sort()).toEqual(["c2", "d2", "m2", "v1"]);
    expect(clip.tracks.find((t) => t.id === "v1")!.takes!.map((t) => t.id)).toEqual(["t1", "t2"]);
    p = renameSection(p, c.blockId, "Out");
    const q = pasteSection(p, c.blockId, clip, C, id);
    const [qa, qb, qc] = sections(q);
    expect(qc.label).toBe("Out");
    expect(qc.color).toBe(c.color);
    expect(roots(qc)).toBe(roots(qb));
    expect(qc.chords.map((x) => x.id)).not.toEqual(qb.chords.map((x) => x.id));
    expect(qc.melody?.notes).toEqual(qb.melody?.notes);
    expect(qc.layers?.c2.chords?.map((x) => x.ref.root)).toEqual(["D"]);
    expect(qc.layers?.m2.melody?.notes).toEqual([{ at: 12, midi: 71 }]);
    expect(qc.layers?.d2.beat?.name).toBe("Second");
    expect([qc.style, qc.groove?.name, qc.kit?.kit, qc.tuneSound?.voice]).toEqual([qb.style, qb.groove?.name, qb.kit?.kit, "glass"]);
    // A and B: untouched
    expect(sound(q).slice(0, 2)).toEqual(sound(p).slice(0, 2));
    expect([qa.blockId, qb.blockId]).toEqual([a.blockId, b.blockId]);
    // the recordings: C's own makes way, B's come in as recordings of their own, of the same files
    const v = q.tracks!.find((t) => t.id === "v1")!;
    const inC = v.takes!.filter((t) => t.at.block === c.blockId);
    expect(inC).toHaveLength(2);
    expect(inC.some((t) => t.id === "t3")).toBe(false);
    expect(new Set(inC.map((t) => t.group)).size).toBe(1);
    expect(inC[0].group).not.toBe("g1");
    expect(inC.map((t) => t.dry)).toEqual(["C:/rec/g1.wav", "C:/rec/g1.wav"]);
    expect(inC.map((t) => t.at.bar)).toEqual([1, 1]);
    expect(v.active![inC[0].group]).toBe(inC.find((t) => t.n === 1)!.id);
    expect(v.active!.g2).toBeUndefined();
    expect(v.takes!.filter((t) => t.at.block === b.blockId).map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(sectionHasContent(q, c.blockId)).toBe(true);
  });

  it("into the first section: it changes, the others keep sounding as they did", () => {
    const p = full();
    const [a, b] = sections(p);
    const q = pasteSection(p, a.blockId, copySection(p, b.blockId, C)!, C, id);
    const s = sections(q);
    expect(roots(s[0])).toBe("FA");
    expect([s[0].style, s[0].groove?.name, s[0].kit?.kit]).toEqual(["pinch", "Motorik", "909"]);
    expect(sound(q).slice(1)).toEqual(sound(p).slice(1));
    expect(q.song!.parts[0].id).toBe(a.partId);
  });

  it("into a section that plays twice: both blocks change, the recordings go into the one pasted into", () => {
    let p = full();
    const [a, b] = sections(p);
    p = repeatSection(selectBlock(p, sections(p)[2].blockId), a.partId, id); // A B C A
    const last = sections(p)[3];
    const q = pasteSection(p, last.blockId, copySection(p, b.blockId, C)!, C, id);
    const s = sections(q);
    expect([roots(s[0]), roots(s[3])]).toEqual(["FA", "FA"]);
    const v = q.tracks!.find((t) => t.id === "v1")!;
    expect(v.takes!.filter((t) => t.at.block === last.blockId)).toHaveLength(2);
    expect(v.takes!.filter((t) => t.at.block === s[0].blockId)).toHaveLength(0);
  });

  it("keeps the copy's signature and length", () => {
    let p = full();
    const [, b, c] = sections(p);
    p = setSectionSig(p, b.blockId, { num: 6, den: 8 });
    p = setSectionBars(p, b.blockId, 5);
    const q = pasteSection(p, c.blockId, copySection(p, b.blockId, C)!, C, id);
    const qc = sections(q)[2];
    expect(qc.meter).toEqual({ num: 6, den: 8 });
    expect(qc.bars).toBe(5);
    expect(qc.groove!.div).toBe(3);
    expect(conform(q)).toBe(q);
  });

  it("into another idea in another key: the chords and melodies move to its key, the tracks are found by name or made", () => {
    const p = full();
    const clip = copySection(p, sections(p)[1].blockId, C)!;
    // the other idea: one section, a Chords 2 of its own (another id), no melody or drums tracks
    let o = ensureSong(base(["G"], { meter: { num: 3, den: 4 } }), id);
    o = addTrack(o, "chords", "x9").p;
    o = conform(normalize(o));
    const q = pasteSection(o, sections(o)[0].blockId, JSON.parse(JSON.stringify(clip)), D, id);
    const s = sections(q)[0];
    expect(roots(s)).toBe("GB");
    expect(s.melody?.notes.map((x) => x.midi)).toEqual([66, 69]);
    expect(s.layers?.x9.chords?.map((x) => x.ref.root)).toEqual(["E"]);
    expect(s.layers?.m2.melody?.notes.map((x) => x.midi)).toEqual([73]);
    expect(q.tracks!.map((t) => `${t.id}:${t.name}`).sort()).toEqual(["d2:Drums 2", "m2:Melody 2", "v1:Vocal 1", "x9:Chords 2"]);
    // it was written in 4/4; this song is in 3/4: the section keeps its 4/4
    expect(s.meter).toEqual({ num: 4, den: 4 });
    expect(s.chords.map((x) => x.beats)).toEqual([4, 4]);
  });

  it("with no song yet, the page is section A", () => {
    const p = full();
    const q = pasteSection(conform(base()), "", copySection(p, sections(p)[1].blockId, C)!, C, id);
    expect(sections(q)).toHaveLength(1);
    expect(roots(sections(q)[0])).toBe("FA");
    expect(roots(sections(q)[0])).toBe(q.chords.map((c) => c.ref.root).join(""));
    expect(copySection(base(["E"]), "", C)!.chords.map((c) => c.ref.root)).toEqual(["E"]);
  });

  it("knows when a section has something in it", () => {
    let p = abc();
    p = addNewSection(p, id);
    const fresh = sections(p).find((s) => s.current)!;
    expect(sectionHasContent(p, fresh.blockId)).toBe(false); // it follows A's drums: nothing of its own
    expect(sectionHasContent(p, sections(p)[0].blockId)).toBe(true);
    expect(sectionHasContent({ ...p, melody: { div: 2, bars: 2, notes: [{ at: 0, midi: 60 }] } }, fresh.blockId)).toBe(true);
  });

  it("the copy is kept with the app; a broken one is dropped", () => {
    const p = full();
    const clip = copySection(p, sections(p)[1].blockId, C, "idea-1")!;
    const back = reviveClips(JSON.parse(JSON.stringify({ section: clip }))).section!;
    expect([back.from, back.block, back.part, back.idea, back.bars, sigName(back.meter)]).toEqual(["B", clip.block, clip.part, "idea-1", 2, "4/4"]);
    expect(back.chords).toEqual(clip.chords);
    expect(back.melody).toEqual(clip.melody);
    expect([back.layers?.c2, back.layers?.m2, back.layers?.d2.beat?.rows]).toEqual([clip.layers?.c2, clip.layers?.m2, clip.layers?.d2.beat?.rows]);
    expect(back.tracks.map((t) => [t.id, t.takes?.length ?? 0])).toEqual(clip.tracks.map((t) => [t.id, t.takes?.length ?? 0]));
    // pasted, it is the same as the copy before it was put away
    const target = sections(p)[2].blockId;
    expect(sound(pasteSection(p, target, back, C, id))).toEqual(sound(pasteSection(p, target, clip, C, id)));
    expect(reviveClips({ section: { ...clip, meter: { num: 5, den: 3 } } }).section).toBeUndefined();
    expect(reviveClips({ section: { ...clip, block: 4 } }).section).toBeUndefined();
    const odd = reviveClips({ section: { ...clip, tracks: [{ id: "chords", kind: "chords", name: "x" }, "nope"], layers: { c2: { chords: [] }, ghost: { chords: [] } }, chords: [{ id: 1 }] } }).section!;
    expect(odd.tracks).toEqual([]);
    expect(odd.layers).toBeUndefined();
    expect(odd.chords).toEqual([]);
  });
});
