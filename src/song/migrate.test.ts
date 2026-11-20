import { describe, expect, it } from "vitest";
import { DEFAULT_BEAT, kitOfBeat, kitSig, type DrumKit } from "../audio/beats";
import { reviveFeel } from "../audio/patterns";
import { reviveSound } from "../audio/rack";
import { toneOf } from "../audio/tone";
import { reviveProgression, type ProgChord, type Progression } from "../ui/state";
import { fingerprint, mergeIdeas, reviveIdea, sameMusic, snapshot } from "./library";
import { SOUND_V, migrateSectionClip, migrateSong } from "./migrate";
import { pasteDrums, pasteMelody, pasteRhythm, pasteSection, reviveClips } from "./clip";
import { drumsIn, sections, type Section } from "./structure";
import { PLAIN_KIT, allTracks, focusTrack, normalize } from "./tracks";

const C = { tonic: "C", scaleId: "ionian" };
const ch = (id: string, root: string, beats = 4): ProgChord => ({ id, ref: { root, typeId: "maj" }, beats });
const mel = (notes: [number, number][]) => ({ div: 2, bars: 2, notes: notes.map(([at, midi]) => ({ at, midi })) });
const RHY = { kick: "3000300030003000", snare: "0000300000003000", hat: "2020202020202020" };
const groove = { patternId: null, name: "Test", edited: true, steps: 16, div: 4, bars: 1, swing: 0, rows: RHY, on: true };
const groove2 = { ...groove, name: "Two", swing: 0.4, rows: { ...RHY, kick: "3000000030000000" } };
const kit = (k: string, space: number): DrumKit => ({ ...kitOfBeat(DEFAULT_BEAT), kit: k as DrumKit["kit"], space });
const X = { voice: "nylon", space: 0.9, verb: "plate", echo: 0.4 };
const Y = { voice: "lyre", space: 0.6 };
const K = kit("909", 0.55);
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** revive a stored progression as the page does */
const rp = (raw: unknown) => reviveProgression(json(raw) as Partial<Progression>);
const idea = (raw: unknown) => reviveIdea({ id: "i", name: "Old", key: C, savedAt: 1, progression: json(raw) })!;
const fp = (p: Progression) => fingerprint(snapshot(C, p, 0, "standard"));

/**
 * What the player is handed for every section: how each of its tracks sounds there (as GuitarView's
 * plan reads it), and which added tracks it has. Two songs that play the same give the same.
 */
function played(p: Progression) {
  const style = (s: Section) => s.style ?? "ring";
  return sections(p).map((s) => ({
    chords1: { style: style(s), feel: reviveFeel(s.feel), sound: reviveSound(s.sound), tone: toneOf(s, "chords") },
    melody1: { sound: reviveSound(s.tuneSound), tone: toneOf(s, "melody") },
    drums1: { kit: kitSig(kitOfBeat(drumsIn(s))), groove: s.groove?.name, on: s.groove?.on, swing: s.groove?.swing },
    added: Object.fromEntries(
      allTracks(p)
        .filter((t) => s.layers?.[t.id])
        .map((t) => {
          const l = s.layers![t.id];
          if (t.kind === "chords") return [t.id, { style: l.pattern ?? "ring", feel: reviveFeel(l.feel), sound: reviveSound(l.sound), tone: toneOf(s, t.id) }];
          if (t.kind === "melody") return [t.id, { sound: reviveSound(l.tuneSound), tone: toneOf(s, t.id) }];
          return [t.id, { kit: kitSig(kitOfBeat(l.beat!)), on: l.beat!.on }];
        }),
    ),
  }));
}

/**
 * Stored with no version: the song's sound from A (`shared`), B with a style of its own and on
 * the page; added tracks with no style; Drums 2 looked at in A (off, on the kit showing then),
 * played in B and C on kits of their own; Chords 3 and the pad in no section.
 */
function v1(): Record<string, unknown> {
  const A = {
    id: "A", bars: 2, chords: [ch("a1", "C"), ch("a2", "G")], melody: mel([[0, 64], [24, 67]]),
    layers: { c2: { chords: [ch("c21", "D")] }, d2: { beat: { ...DEFAULT_BEAT, ...groove, kit: "707", on: false } } },
  };
  const Blayers = { c2: { chords: [ch("c22", "F", 8)] }, d2: { beat: { ...DEFAULT_BEAT, ...groove, kit: "lofi", space: 0.7, on: true } } };
  const B = { id: "B", bars: 2, chords: [ch("b1", "F"), ch("b2", "G")], melody: mel([[0, 69]]), style: "quarters", layers: Blayers };
  const Cc = { id: "C", bars: 2, chords: [ch("c1", "A")], kit: kit("linn", 0.2), layers: { d2: { beat: { ...DEFAULT_BEAT, ...groove, kit: "808", on: true } } } };
  return {
    chords: B.chords, melody: B.melody, layers: Blayers, bpm: 100, pattern: "quarters", loop: true, bars: 2, meter: { num: 4, den: 4 }, play: "song",
    sound: X, tuneSound: Y, beat: { ...DEFAULT_BEAT, ...K, ...groove },
    song: {
      parts: [A, B, Cc], blocks: [{ id: "ba", partId: "A" }, { id: "bb", partId: "B" }, { id: "bc", partId: "C" }], current: "bb",
      shared: { style: "block", feel: { swing: 0.3, touch: 0.7 }, sound: X, tuneSound: Y, groove, kit: K },
    },
    tracks: [
      { id: "c2", kind: "chords", name: "Chords 2" },
      { id: "c3", kind: "chords", name: "Chords 3", style: "pinch" },
      { id: "d2", kind: "drums", name: "Drums 2" },
      { id: "m2", kind: "melody", name: "Melody 2", sound: { voice: "kora" } },
      { id: "p1", kind: "chords", name: "Pad", role: "harmony", harmony: { from: "chords", option: "pad" } },
    ],
    tones: { chords: { inst: "piano" }, p1: { inst: "synth", register: "high", voicing: "close" } },
    mix: { p1: { db: -4 } },
  };
}

/** Version 2 (one sound per track): A on the page; B with a drum rhythm of its own; the added tracks' sound on them. */
function v2(): Record<string, unknown> {
  const Alayers = { c2: { chords: [ch("c21", "D")] } };
  const A = { id: "A", bars: 2, chords: [ch("a1", "C")], layers: Alayers };
  const B = { id: "B", bars: 2, chords: [ch("b1", "F")], groove: groove2, layers: { c2: { chords: [ch("c22", "E")] }, d2: { beat: { ...DEFAULT_BEAT, ...groove2, on: true } } } };
  const Cc = { id: "C", bars: 2, chords: [ch("c1", "G")], layers: { d2: { beat: { ...DEFAULT_BEAT, ...groove, on: false } }, m2: { melody: mel([]) } } };
  return {
    v: 2, chords: A.chords, layers: Alayers, bpm: 100, pattern: "strum", feel: { speed: 2 }, loop: true, bars: 2, meter: { num: 4, den: 4 },
    sound: X, tuneSound: Y, beat: { ...DEFAULT_BEAT, ...K, ...groove },
    song: { parts: [A, B, Cc], blocks: [{ id: "ba", partId: "A" }, { id: "bb", partId: "B" }, { id: "bc", partId: "C" }], current: "ba", shared: { groove } },
    tracks: [
      { id: "c2", kind: "chords", name: "Chords 2", style: "pinch", sound: { voice: "koto" } },
      { id: "d2", kind: "drums", name: "Drums 2", kit: kit("lofi", 0.8) },
      { id: "m2", kind: "melody", name: "Melody 2", sound: { voice: "kora" } },
    ],
    tones: { chords: { inst: "piano" }, melody: { inst: "synth" }, c2: { inst: "piano", keys: "electric" } },
  };
}

describe("songs saved with no version: every section plays what it played", () => {
  it("each section gets the settings it played, links resolved: A and C the song's, B its own style (and the default feel)", () => {
    const s = played(rp(v1()));
    const song = { style: "block", feel: reviveFeel({ swing: 0.3, touch: 0.7 }), sound: reviveSound(X), tone: { inst: "piano" } };
    expect(s[0].chords1).toEqual(song);
    expect(s[1].chords1).toEqual({ ...song, style: "quarters", feel: reviveFeel(undefined) });
    expect(s[2].chords1).toEqual(song);
    for (const x of s) expect(x.melody1).toEqual({ sound: reviveSound(Y), tone: { inst: "guitar" } });
    // C had a kit of its own; A and B played the song's
    expect(s.map((x) => x.drums1.kit)).toEqual([kitSig(K), kitSig(K), kitSig(kit("linn", 0.2))]);
    expect(s.map((x) => x.drums1.groove)).toEqual(["Test", "Test", "Test"]);
  });

  it("added tracks: where they have music, with the sound they played there", () => {
    const p = rp(v1());
    const [a, b, c] = played(p);
    // Chords 2 had no style of its own: it played its section's
    expect(a.added.c2).toMatchObject({ style: "block", sound: reviveSound(undefined) });
    expect(b.added.c2).toMatchObject({ style: "quarters" });
    // Drums 2: off in A (it leaves A), on its own kit in B and C
    expect(a.added.d2).toBeUndefined();
    expect(b.added.d2).toEqual({ kit: kitSig(kitOfBeat({ ...DEFAULT_BEAT, kit: "lofi", space: 0.7 })), on: true });
    expect(c.added.d2).toEqual({ kit: kitSig(kitOfBeat({ ...DEFAULT_BEAT, kit: "808" })), on: true });
    // empty everywhere: they stay in the section the song was on (B), as they played
    expect(Object.keys(b.added).sort()).toEqual(["c2", "c3", "d2", "m2", "p1"]);
    expect(b.added.c3).toMatchObject({ style: "pinch" });
    expect(b.added.m2).toMatchObject({ sound: reviveSound({ voice: "kora" }) });
    expect(b.added.p1).toMatchObject({ tone: { inst: "synth", register: "high", voicing: "close" } });
    expect(Object.keys(c.added)).toEqual(["d2"]);
    // rows only now: no sound on the tracks; the mixer as it was
    expect(normalize(p).tracks!.map((t) => Object.keys(t).filter((k) => ["style", "feel", "sound", "kit"].includes(k)))).toEqual([[], [], [], [], []]);
    expect(p.mix?.p1).toEqual({ db: -4 });
    // nothing is shared any more
    expect("shared" in p.song!).toBe(false);
  });

  it("an older song with no `shared` (every section its own copy, stored out of order): each keeps its own", () => {
    const raw = {
      chords: [ch("b1", "F")], bpm: 100, pattern: "quarters", loop: true, bars: 2, sound: { voice: "koto" }, beat: { ...DEFAULT_BEAT, ...groove, kit: "volca" },
      song: {
        parts: [
          { id: "B", bars: 2, chords: [ch("b1", "F")], style: "quarters", sound: { voice: "koto" }, kit: kit("volca", 0.1), groove },
          { id: "A", bars: 2, chords: [ch("a1", "C")], style: "block", feel: { speed: 2 }, sound: { voice: "wire" }, kit: kit("linn", 0.4), groove },
        ],
        blocks: [{ id: "ba", partId: "A" }, { id: "bb", partId: "B" }], current: "bb",
      },
    };
    const p = rp(raw);
    const s = sections(p);
    expect(s.map((x) => x.label)).toEqual(["A", "B"]);
    expect(s.map((x) => [x.style, reviveFeel(x.feel).speed, reviveSound(x.sound).voice, x.kit?.kit])).toEqual([["block", 2, "wire", "linn"], ["quarters", 1, "koto", "volca"]]);
    expect([p.pattern, reviveSound(p.sound).voice]).toEqual(["quarters", "koto"]);
  });

  it("a melody from before the melody had a harp of its own keeps the chords' harp; never with a version", () => {
    const old = { chords: [ch("a", "C")], bpm: 90, pattern: "ring", loop: true, bars: 2, melody: mel([[0, 64]]), sound: { voice: "folk", space: 0.8 } };
    expect(reviveSound(rp(old).tuneSound)).toEqual(reviveSound(old.sound));
    expect(rp({ ...old, v: 2 }).tuneSound).toBeUndefined();
    const inSong = migrateSong({ chords: [], sound: { voice: "folk" }, song: { parts: [{ id: "A", chords: [], melody: mel([[0, 60]]) }], blocks: [{ id: "a", partId: "A" }], current: "a" } }) as Record<string, unknown>;
    expect(reviveSound(inSong.tuneSound)).toEqual(reviveSound({ voice: "folk" }));
    expect((migrateSong({ chords: [], sound: { voice: "folk" } }) as Record<string, unknown>).tuneSound).toBeUndefined();
  });

  it("with no song: the page's tracks all stay; an added chords track plays the page's style", () => {
    const p = rp({ chords: [ch("a", "C")], bpm: 90, pattern: "strum", loop: true, bars: 2, layers: { c: { chords: [] } }, tracks: [{ id: "c", kind: "chords", name: "Chords 2" }, { id: "d", kind: "drums", name: "Drums 2" }] });
    expect(normalize(p).layers?.c.pattern).toBe("strum");
    expect(normalize(p).layers?.d.beat?.on).toBe(false);
  });
});

describe("songs saved by version 2 (one sound per track): every section plays what it played", () => {
  it("every section gets a copy of each first track's sound, and the drum rhythm it played", () => {
    const s = played(rp(v2()));
    for (const x of s) {
      expect(x.chords1).toEqual({ style: "strum", feel: reviveFeel({ speed: 2 }), sound: reviveSound(X), tone: { inst: "piano" } });
      expect(x.melody1).toEqual({ sound: reviveSound(Y), tone: { inst: "synth" } });
      expect(x.drums1.kit).toBe(kitSig(K));
    }
    expect(s.map((x) => [x.drums1.groove, x.drums1.swing])).toEqual([["Test", 0], ["Two", 0.4], ["Test", 0]]);
  });

  it("added tracks: each section that has music on one gets a copy of its one sound", () => {
    const s = played(rp(v2()));
    const c2 = { style: "pinch", feel: reviveFeel(undefined), sound: reviveSound({ voice: "koto" }), tone: { inst: "piano", keys: "electric" } };
    expect([s[0].added.c2, s[1].added.c2, s[2].added.c2]).toEqual([c2, c2, undefined]);
    expect(s[1].added.d2).toEqual({ kit: kitSig(kit("lofi", 0.8)), on: true });
    // C's Drums 2 was off: it leaves C (and no section is left without it: B has it)
    expect(s[2].added.d2).toBeUndefined();
    // Melody 2 has no notes anywhere: it stays in A, the section the song was on, with its harp
    expect(s[0].added.m2).toEqual({ sound: reviveSound({ voice: "kora" }), tone: { inst: "guitar" } });
    expect(s[2].added.m2).toBeUndefined();
  });

  it("a v2 drums track with no kit plays the plain kit", () => {
    const raw = v2() as { tracks: Record<string, unknown>[] };
    raw.tracks = raw.tracks.map((t) => (t.id === "d2" ? { id: "d2", kind: "drums", name: "Drums 2" } : t));
    expect(played(rp(raw))[1].added.d2).toEqual({ kit: kitSig(PLAIN_KIT), on: true });
  });
});

describe("moved over once", () => {
  for (const [name, make] of [["no version", v1], ["version 2", v2]] as const) {
    it(`${name}: moving over twice changes nothing, and an idea opened that way is not taken for changed`, () => {
      const once = rp(make());
      expect(once.v).toBe(SOUND_V);
      const twice = reviveProgression(json(normalize(once)));
      expect(played(twice)).toEqual(played(once));
      expect(fp(twice)).toBe(fp(once));
      expect(migrateSong(json(normalize(once)))).toEqual(json(normalize(once)));
      // the idea in the library and the one on the page, from the same stored song
      const i = idea(make());
      expect(fp(i.progression)).toBe(fp(once));
      expect(sameMusic(i.progression, once)).toBe(true);
      expect(i.progression.v).toBe(SOUND_V);
      // opened again from the library: the same
      expect(fp(reviveIdea(json(i))!.progression)).toBe(fp(i.progression));
      // and from the cloud
      const { ideas } = mergeIdeas([], {}, [{ id: "c1", updatedAt: 5, json: JSON.stringify({ id: "c1", name: "Cloud", key: C, savedAt: 5, progression: make() }) }]);
      expect(played(ideas[0].progression)).toEqual(played(once));
    });
  }

  it("a change to any section's sound is a change to save; a section shown or a track brought forward is not", () => {
    const p0 = rp(v2());
    const base = fp(p0);
    expect(fp({ ...p0, sound: { ...p0.sound, space: 0.2 } })).not.toBe(base);
    expect(fp({ ...p0, tuneSound: { ...p0.tuneSound, voice: "folk" } })).not.toBe(base);
    expect(fp({ ...p0, beat: { ...p0.beat!, kit: "mod" } })).not.toBe(base);
    expect(fp({ ...p0, pattern: "pinch" })).not.toBe(base);
    expect(sameMusic(p0, focusTrack(p0, "chords", "c2"))).toBe(true);
    // a sound written whole or with only some knobs is the same sound
    expect(fp({ ...p0, sound: reviveSound(p0.sound) })).toBe(base);
  });
});

describe("clipboards from before", () => {
  it("an old section clipboard: its added tracks keep the sound they played there", () => {
    const clip = {
      from: "B", key: C, block: "bb", part: "B", idea: null, meter: { num: 4, den: 4 }, bars: 2, chords: [ch("x", "C")],
      settings: { style: "pinch", sound: { voice: "koto" }, groove, kit: K },
      layers: { c2: { chords: [ch("y", "F")] }, d2: { beat: { ...DEFAULT_BEAT, ...groove, kit: "lofi" } } },
      tracks: [{ id: "c2", kind: "chords", name: "Chords 2" }, { id: "d2", kind: "drums", name: "Drums 2", kit: kit("box", 0.3) }],
    };
    const moved = migrateSectionClip(json(clip)) as { layers: Record<string, { pattern?: string; beat?: { kit: string } }> };
    expect(moved.layers.c2.pattern).toBe("pinch");
    expect(moved.layers.d2.beat?.kit).toBe("box");
    const back = reviveClips({ section: json(clip) }).section!;
    expect(back.whole).toBeUndefined();
    expect(back.layers?.c2.pattern).toBe("pinch");
    // pasted, the first tracks take what it held, and keep the rest of their own
    const p = rp(v2());
    const q = pasteSection(p, "bb", back, C, () => `n${Math.random()}`);
    const b = sections(q)[1];
    expect([b.style, reviveSound(b.sound).voice, b.kit?.kit]).toEqual(["pinch", "koto", "909"]);
    expect(toneOf(b, "chords").inst).toBe("piano");
  });

  it("an old page clipboard brings only its music: the track keeps how it sounds", () => {
    const old = reviveClips({ rhythm: { from: "A", key: C, chords: [ch("q", "D")], pattern: "pinch" }, melody: { from: "A", key: C, melody: mel([[0, 60]]), tuneSound: { voice: "x" } }, drums: { from: "A", key: C, beat: { ...DEFAULT_BEAT, ...groove, kit: "lofi" } } });
    const p = rp(v2());
    const r = pasteRhythm(p, old.rhythm!, C);
    expect([r.pattern, r.tones?.chords]).toEqual(["strum", { inst: "piano" }]);
    expect(pasteMelody(p, old.melody!, C).tuneSound).toEqual(p.tuneSound);
    expect(pasteDrums(p, old.drums!).beat?.kit).toBe("909");
  });
});
