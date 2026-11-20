import { describe, expect, it } from "vitest";
import { DEFAULT_BEAT, kitOfBeat, kitSig, type DrumKit } from "../audio/beats";
import { reviveFeel } from "../audio/patterns";
import { reviveSound } from "../audio/rack";
import { reviveProgression, type ProgChord, type Progression } from "../ui/state";
import { fingerprint, mergeIdeas, reviveIdea, sameMusic, snapshot } from "./library";
import { SOUND_V, migrateSectionClip, migrateSound } from "./migrate";
import { reviveClips } from "./clip";
import { sections } from "./structure";
import { focusTrack, normalize } from "./tracks";

const C = { tonic: "C", scaleId: "ionian" };
const ch = (id: string, root: string, beats = 4): ProgChord => ({ id, ref: { root, typeId: "maj" }, beats });
const mel = (notes: [number, number][]) => ({ div: 2, bars: 2, notes: notes.map(([at, midi]) => ({ at, midi })) });
const RHY = { kick: "3000300030003000", snare: "0000300000003000", hat: "2020202020202020" };
const groove = { patternId: null, name: "Test", edited: true, steps: 16, div: 4, bars: 1, swing: 0, rows: RHY, on: true };
const kit = (k: string, space: number): DrumKit => ({ ...kitOfBeat(DEFAULT_BEAT), kit: k as DrumKit["kit"], space });
const X = { voice: "nylon", space: 0.9, verb: "plate", echo: 0.4 };
const Y = { voice: "lyre", space: 0.6 };
const K = kit("909", 0.55);

/** As an older version saved it: the song's sound shared from A, B with a style of its own and on the page; added tracks with no style and no kit. */
function oldSong(): Record<string, unknown> {
  const A = {
    id: "A", bars: 2, chords: [ch("a1", "C"), ch("a2", "G")], melody: mel([[0, 64], [24, 67]]),
    layers: {
      c2: { chords: [ch("c21", "D")] },
      // Drums 2 looked at in A (off, on the kit that was showing), and played in B and C
      d2: { beat: { ...DEFAULT_BEAT, ...groove, kit: "707", on: false } },
    },
  };
  const Blayers = { c2: { chords: [ch("c22", "F", 8)] }, d2: { beat: { ...DEFAULT_BEAT, ...groove, kit: "lofi", space: 0.7, on: true } } };
  const B = { id: "B", bars: 2, chords: [ch("b1", "F"), ch("b2", "G")], melody: mel([[0, 69]]), style: "quarters", layers: Blayers };
  const Cc = { id: "C", bars: 2, chords: [ch("c1", "A")], layers: { d2: { beat: { ...DEFAULT_BEAT, ...groove, kit: "808", on: true } } } };
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
      { id: "p1", kind: "chords", name: "Pad", role: "harmony", harmony: { from: "chords", option: "pad" } },
    ],
    tones: { chords: { inst: "piano" }, p1: { inst: "synth", register: "high", voicing: "close" } },
    mix: { p1: { db: -4 } },
  };
}
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** revive a stored progression as the page does */
const rp = (raw: unknown) => reviveProgression(JSON.parse(JSON.stringify(raw)) as Partial<Progression>);
/** move one over, and look inside */
const mig = (raw: unknown) => migrateSound(raw) as Record<string, unknown>;
const SOUND_KEYS = ["style", "feel", "sound", "tuneSound", "kit"];

describe("songs from before one sound per track", () => {
  it("the first tracks take the sound the lead section played; sections keep only their drum rhythm", () => {
    const p = rp(oldSong());
    expect(p.v).toBe(SOUND_V);
    expect(p.pattern).toBe("block");
    expect(reviveFeel(p.feel)).toMatchObject({ swing: 0.3, touch: 0.7 });
    expect(reviveSound(p.sound)).toEqual(reviveSound(X));
    expect(reviveSound(p.tuneSound)).toEqual(reviveSound(Y));
    expect(kitSig(kitOfBeat(p.beat!))).toBe(kitSig(K));
    for (const x of [p.song!.shared!, ...p.song!.parts]) for (const k of SOUND_KEYS) expect(k in x, k).toBe(false);
    expect(Object.keys(p.song!.shared!)).toEqual(["groove"]);
    // B is on the page (its notes), playing the song's sound
    expect(p.chords.map((c) => c.ref.root)).toEqual(["F", "G"]);
  });

  it("with the lead section on the page, the page is the newest there is: its values win over the song's", () => {
    const raw = oldSong() as { song: { current: string }; pattern: string; sound: unknown; chords: ProgChord[]; melody: unknown; layers: unknown; beat: object };
    raw.song.current = "ba";
    const A = (raw.song as unknown as { parts: { chords: ProgChord[]; melody: unknown; layers: unknown }[] }).parts[0];
    Object.assign(raw, { chords: A.chords, melody: A.melody, layers: A.layers, pattern: "strum", sound: { voice: "koto" }, beat: { ...raw.beat, kit: "linn" } });
    const p = rp(raw);
    expect(p.pattern).toBe("strum");
    expect(reviveSound(p.sound).voice).toBe("koto");
    expect(p.beat!.kit).toBe("linn");
  });

  it("an older song with no `shared` (every section its own copy) takes the lead's, in playing order", () => {
    const raw = {
      chords: [ch("b1", "F")], bpm: 100, pattern: "quarters", loop: true, bars: 2, sound: { voice: "koto" }, beat: { ...DEFAULT_BEAT, ...groove, kit: "volca" },
      song: {
        // the parts are stored out of playing order: B (on the page) first
        parts: [
          { id: "B", bars: 2, chords: [ch("b1", "F")], style: "quarters", sound: { voice: "koto" }, kit: kit("volca", 0.1), groove },
          { id: "A", bars: 2, chords: [ch("a1", "C")], style: "block", feel: { speed: 2 }, sound: { voice: "wire" }, kit: kit("linn", 0.4), groove },
        ],
        blocks: [{ id: "ba", partId: "A" }, { id: "bb", partId: "B" }], current: "bb",
      },
    };
    const p = rp(raw);
    expect([p.pattern, reviveFeel(p.feel).speed, reviveSound(p.sound).voice, p.beat!.kit, p.beat!.space]).toEqual(["block", 2, "wire", "linn", 0.4]);
    expect(sections(p).map((s) => s.label)).toEqual(["A", "B"]);
  });

  it("a melody from before the melody had a harp of its own keeps the chords' harp; never again once moved over", () => {
    const old = { chords: [ch("a", "C")], bpm: 90, pattern: "ring", loop: true, bars: 2, melody: mel([[0, 64]]), sound: { voice: "folk", space: 0.8 } };
    const p = rp(old);
    expect(reviveSound(p.tuneSound)).toEqual(reviveSound(old.sound));
    // the same data, already moved over (v 2): no melody harp was chosen, so none is taken
    const now = rp({ ...old, v: 2 });
    expect(now.tuneSound).toBeUndefined();
    // a melody in a section counts too
    const inSong = mig({ chords: [], sound: { voice: "folk" }, song: { parts: [{ id: "A", chords: [], melody: mel([[0, 60]]) }], blocks: [{ id: "a", partId: "A" }], current: "a" } });
    expect(inSong.tuneSound).toEqual({ voice: "folk" });
    // no melody anywhere: nothing to keep
    expect(mig({ chords: [], sound: { voice: "folk" } }).tuneSound).toBeUndefined();
  });

  it("an added chords track with no style keeps the lead's; one with a style keeps its own", () => {
    const p = normalize(rp(oldSong()));
    expect(p.tracks!.find((t) => t.id === "c2")!.style).toBe("block");
    expect(p.tracks!.find((t) => t.id === "c3")!.style).toBe("pinch");
    // with no song: the page's style
    expect(mig({ chords: [], pattern: "strum", tracks: [{ id: "c", kind: "chords", name: "Chords 2" }] }).tracks).toEqual([{ id: "c", kind: "chords", name: "Chords 2", style: "strum" }]);
  });

  it("an added drums track keeps the kit of the first section it plays in (the page's for the section on it); one with a kit keeps it", () => {
    const p = normalize(rp(oldSong()));
    // A only looked at it (off); B plays it, and B is on the page: the page's layers count for B
    const d2 = p.tracks!.find((t) => t.id === "d2")!;
    expect([d2.kit!.kit, d2.kit!.space]).toEqual(["lofi", 0.7]);
    // B's stored part said otherwise: the page is what counts
    const raw = oldSong() as { song: { parts: { layers: object }[] } };
    raw.song.parts[1].layers = { ...raw.song.parts[1].layers, d2: { beat: { ...DEFAULT_BEAT, ...groove, kit: "mod", on: true } } };
    expect(normalize(rp(raw)).tracks!.find((t) => t.id === "d2")!.kit!.kit).toBe("lofi");
    // nowhere on: the first it has
    const off = mig({ chords: [], layers: { d: { beat: { ...DEFAULT_BEAT, kit: "707", on: false } } }, tracks: [{ id: "d", kind: "drums", name: "Drums 2" }] });
    expect((off.tracks as { kit: { kit: string } }[])[0].kit.kit).toBe("707");
    const own = mig({ chords: [], layers: { d: { beat: { ...DEFAULT_BEAT, kit: "707", on: true } } }, tracks: [{ id: "d", kind: "drums", name: "Drums 2", kit: kit("box", 0.2) }] });
    expect((own.tracks as { kit: { kit: string } }[])[0].kit.kit).toBe("box");
  });

  it("what an old harmony track plays with is left as it was: its instrument, its register and its level", () => {
    const p = rp(oldSong());
    expect(p.tones?.p1).toMatchObject({ inst: "synth", register: "high", voicing: "close" });
    expect(p.tones?.chords).toEqual({ inst: "piano" });
    expect(p.mix?.p1).toEqual({ db: -4 });
  });

  it("moving over twice changes nothing, and an idea opened that way is not taken for changed", () => {
    const once = rp(oldSong());
    const twice = reviveProgression(json(normalize(once)));
    expect(normalize(twice)).toEqual(normalize(once));
    expect(migrateSound(json(normalize(once)))).toEqual(json(normalize(once)));
    // the idea in the library and the one on the page, from the same stored song
    const idea = reviveIdea({ id: "i", name: "Old", key: C, savedAt: 1, progression: json(oldSong()) })!;
    expect(fingerprint(snapshot(C, once, 0, "standard"))).toBe(fingerprint(snapshot(idea.key, idea.progression, 0, "standard")));
    expect(idea.progression.v).toBe(SOUND_V);
    // opened again from the library: the same
    const again = reviveIdea(json(idea))!;
    expect(fingerprint(snapshot(C, again.progression, 0, "standard"))).toBe(fingerprint(snapshot(C, idea.progression, 0, "standard")));
  });

  it("the page and the library move an old song over the same way", () => {
    for (const raw of [oldSong(), { chords: [ch("a", "C")], bpm: 90, pattern: "ring", loop: true, melody: mel([[0, 64]]), sound: { voice: "folk" } }]) {
      const a = normalize(rp(raw));
      const b = normalize(reviveIdea({ id: "i", name: "x", key: C, savedAt: 1, progression: json(raw) })!.progression);
      expect([b.pattern, reviveFeel(b.feel), reviveSound(b.sound), reviveSound(b.tuneSound), b.beat?.kit, b.tracks, b.tones]).toEqual([a.pattern, reviveFeel(a.feel), reviveSound(a.sound), reviveSound(a.tuneSound), a.beat?.kit, a.tracks, a.tones]);
      expect(sameMusic(a, b)).toBe(true);
    }
  });

  it("an old section clipboard: its added tracks keep the sound they played there; its settings keep only the rhythm", () => {
    const clip = {
      from: "B", key: C, block: "bb", part: "B", idea: null, meter: { num: 4, den: 4 }, bars: 2, chords: [ch("x", "C")],
      settings: { style: "pinch", sound: { voice: "koto" }, groove, kit: K },
      layers: { c2: { chords: [ch("y", "F")] }, d2: { beat: { ...DEFAULT_BEAT, ...groove, kit: "lofi" } } },
      tracks: [{ id: "c2", kind: "chords", name: "Chords 2" }, { id: "d2", kind: "drums", name: "Drums 2" }],
    };
    const moved = migrateSectionClip(json(clip));
    expect(moved.tracks.map((t) => (t as { style?: string }).style)).toEqual(["pinch", undefined]);
    const back = reviveClips({ section: json(clip) }).section!;
    expect(Object.keys(back.settings)).toEqual(["groove"]);
    expect(back.tracks.find((t) => t.id === "c2")!.style).toBe("pinch");
    expect(back.tracks.find((t) => t.id === "d2")!.kit!.kit).toBe("lofi");
  });
});

describe("one sound per track in the library", () => {
  it("a change to the first tracks' sound is a change to save, in a song too", () => {
    const p0 = rp(oldSong());
    const fp = (p: Progression) => fingerprint(snapshot(C, p, 0, "standard"));
    const base = fp(p0);
    expect(fp({ ...p0, sound: { ...p0.sound, space: 0.2 } })).not.toBe(base);
    expect(fp({ ...p0, tuneSound: { ...p0.tuneSound, voice: "folk" } })).not.toBe(base);
    expect(fp({ ...p0, beat: { ...p0.beat!, kit: "mod" } })).not.toBe(base);
    expect(fp({ ...p0, pattern: "pinch" })).not.toBe(base);
    expect(sameMusic(p0, { ...p0, sound: { ...p0.sound, space: 0.2 } })).toBe(false);
    expect(sameMusic(p0, { ...p0, beat: { ...p0.beat!, kit: "mod" } })).toBe(false);
    // a change to the drum rhythm on the page counts, a section shown does not
    expect(sameMusic(p0, focusTrack(p0, "chords", "c2"))).toBe(true);
    // a sound written whole or with only some knobs is the same sound
    expect(fp({ ...p0, sound: reviveSound(p0.sound) })).toBe(base);
  });

  it("an old idea from the cloud opens moved over", () => {
    const { ideas } = mergeIdeas([], {}, [{ id: "c1", updatedAt: 5, json: JSON.stringify({ id: "c1", name: "Cloud", key: C, savedAt: 5, progression: oldSong() }) }]);
    const p = ideas[0].progression;
    expect(p.v).toBe(SOUND_V);
    expect(p.pattern).toBe("block");
    for (const x of [p.song!.shared!, ...p.song!.parts]) for (const k of SOUND_KEYS) expect(k in x, k).toBe(false);
    expect(normalize(p).tracks!.find((t) => t.id === "d2")!.kit!.kit).toBe("lofi");
  });
});
