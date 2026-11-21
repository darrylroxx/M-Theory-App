// Old-format songs (sections, each with its tracks) for the tests of the conversion to tracks and clips, and for testers.
//
// Each one is a small song that guards one thing an old song can hold (the list is in the conversion tests). They are
// written the way an old build stores a song, and loaded through the old loader, so what the tests convert is what a
// real old idea is after it has been opened. `fixtures/v4-ideas.json` beside this file is these same songs as an old
// backup file: Ideas → Restore in an old build brings them in.
import { DEFAULT_BEAT, emptyRows, kitOfBeat, type DrumKit, type Groove } from "../audio/beats";
import type { Tone } from "../audio/tone";
import type { DrumId } from "../audio/drums";
import { writeHarmony } from "../song/harmony";
import { reviveIdea, snapshot } from "../song/library";
import { selectBlock } from "../song/structure";
import type { TimeSig } from "../song/meter";
import { presetById } from "../synth/presets";
import type { Key } from "../theory/keys";
import type { ProgChord, SavedProgression } from "../ui/state";

export const FIXTURE_KEY: Key = { tonic: "C", scaleId: "ionian" };
const T0 = 1_700_000_000_000;

type Raw = Record<string, unknown>;
const ch = (id: string, root: string, beats = 4, typeId = "maj"): ProgChord => ({ id, ref: { root, typeId }, beats });
const rest = (id: string, beats: number): ProgChord => ({ id, ref: { root: "C", typeId: "maj" }, beats, rest: true });
/** a melody of so many bars: [beat, midi] pairs */
const mel = (bars: number, notes: [number, number][], div = 2, on?: boolean): Raw => ({ div, bars, notes: notes.map(([b, midi]) => ({ at: Math.round(b * 12), midi })), ...(on === false ? { on: false } : {}) });
/** a drum rhythm: `rows` by drum, each bar written out ("x" a hit, "X" a hard one, "." nothing) */
function rhythm(o: { name?: string; steps: number; div: number; bars?: number; swing?: number; on?: boolean; rows: Partial<Record<DrumId, string>>; patternId?: string | null; edited?: boolean }): Groove {
  const bars = o.bars ?? 1;
  const rows = emptyRows(o.steps * bars);
  for (const [id, r] of Object.entries(o.rows)) rows[id as DrumId] = [...r!.replace(/\s/g, "")].map((c) => (c === "X" ? "3" : c === "x" ? "2" : c === "o" ? "1" : "0")).join("").padEnd(o.steps * bars, "0").slice(0, o.steps * bars);
  return { patternId: o.patternId ?? null, name: o.name ?? "Test", edited: o.edited ?? true, steps: o.steps, div: o.div, bars, swing: o.swing ?? 0, rows, on: o.on ?? true };
}
const ROCK = rhythm({ name: "Rock", steps: 16, div: 4, rows: { kick: "X...x...X...x...", snare: "....X.......X...", hat: "x.x.x.x.x.x.x.x." } });
const HALF = rhythm({ name: "Half", steps: 16, div: 4, rows: { kick: "X.......x.......", snare: "........X.......", hat: "x...x...x...x..." } });
const SIX8 = rhythm({ name: "Six", steps: 6, div: 3, rows: { kick: "X..x..", snare: "...X..", hat: "xxxxxx" } });
const WALTZ = rhythm({ name: "Waltz", steps: 12, div: 4, rows: { kick: "X...........", snare: "....x...x...", hat: "x.x.x.x.x.x." } });
const kit = (machine: string, o: Partial<DrumKit> = {}): DrumKit => ({ ...kitOfBeat(DEFAULT_BEAT), kit: machine as DrumKit["kit"], ...o });
const PLAIN = kitOfBeat(DEFAULT_BEAT);
/** the drums a section has when nobody ever touched them: the rhythm a new idea starts with, off */
const UNTOUCHED = { patternId: DEFAULT_BEAT.patternId, name: DEFAULT_BEAT.name, edited: false, steps: DEFAULT_BEAT.steps, div: DEFAULT_BEAT.div, bars: 1, swing: 0, rows: DEFAULT_BEAT.rows, on: false };

const SIG44: TimeSig = { num: 4, den: 4 };
const SIG68: TimeSig = { num: 6, den: 8 };
const SIG34: TimeSig = { num: 3, den: 4 };

const PIANO: Tone = { inst: "piano" };
const pad = presetById("warm-pad")!.params;
const lead = presetById("pwm-lead")!.params;
const SYNTH: Tone = { inst: "synth", synth: pad };
const ARP: Tone = { inst: "synth", synth: { ...pad, play: { ...pad.play, mode: "arp", rate: "1/8" } } };
const DRONE: Tone = { inst: "synth", synth: { ...pad, play: { ...pad.play, mode: "drone" } } };
const GLIDE: Tone = { inst: "synth", synth: { ...lead, play: { ...lead.play, mode: "sustain", humanise: 0.2 } } };

/** a section as it is stored: its music, and how its first tracks sound there */
interface Part extends Raw { id: string; bars: number; chords: ProgChord[] }
/** A song as an old build stores it: the page holds a copy of the section on screen (the loader puts it there). */
function song(o: { bpm?: number; meter?: TimeSig; parts: Part[]; blocks: [string, string][]; current?: string; tracks?: Raw[]; mix?: Raw; firstHarmony?: Raw }): Raw {
  return {
    v: 4, chords: [], bpm: o.bpm ?? 96, pattern: "ring", loop: true, play: "song", meter: o.meter ?? SIG44,
    song: { parts: o.parts, blocks: o.blocks.map(([id, partId]) => ({ id, partId })), current: o.current ?? o.blocks[0][0] },
    ...(o.tracks ? { tracks: o.tracks } : {}), ...(o.mix ? { mix: o.mix } : {}), ...(o.firstHarmony ? { firstHarmony: o.firstHarmony } : {}),
  };
}
const idea = (n: number, name: string, progression: Raw): SavedProgression => reviveIdea(JSON.parse(JSON.stringify({ id: n === 18 ? "worked-example" : `fixture-${n}`, name, key: FIXTURE_KEY, savedAt: T0 + n * 1000, updatedAt: T0 + n * 1000, progression })))!;
/** A loaded idea changed by the old app's own functions, as it would be saved again. */
const saved = (i: SavedProgression): SavedProgression => reviveIdea(JSON.parse(JSON.stringify({ ...i, progression: snapshot(i.key, i.progression, 0, "standard").progression })))!;

const FOUR = [ch("c1", "C"), ch("c2", "F"), ch("c3", "G"), ch("c4", "A", 4, "min")];
const TUNE4: [number, number][] = [[0, 64], [1, 67], [2.5, 69], [4, 72], [6, 71], [8, 67], [10.5, 64], [12, 62], [14, 60], [15.5, 64]];

// 1. one section, three first tracks (a song with no sections yet: the page is the section)
const f1 = (): SavedProgression =>
  idea(1, "Fixture 1", {
    v: 4, chords: FOUR, bpm: 96, pattern: "strum", loop: true, bars: 4, meter: SIG44, play: "section",
    melody: mel(4, TUNE4), beat: { ...DEFAULT_BEAT, ...ROCK }, feel: { touch: 0.7 },
  });

// 2. three sections with a repeat
const f2 = (): SavedProgression =>
  idea(2, "Fixture 2", song({
    parts: [
      { id: "A", name: "Verse", bars: 4, chords: FOUR, melody: mel(4, TUNE4), style: "travis", groove: ROCK },
      { id: "B", name: "Chorus", bars: 2, chords: [ch("b1", "F", 4), ch("b2", "G", 2), ch("b3", "C", 2)], melody: mel(2, [[0, 72], [2, 74], [4, 76], [6, 74]]), style: "strum", groove: HALF },
    ],
    blocks: [["b1", "A"], ["b2", "B"], ["b3", "A"]],
  }));

// 3. a chords row on guitar, piano and synth (and a guitar that remembers a synth it is not playing)
const f3 = (): SavedProgression =>
  idea(3, "Fixture 3", song({
    parts: [
      { id: "A", bars: 2, chords: [ch("a1", "C"), ch("a2", "G")], style: "strum" },
      { id: "B", bars: 2, chords: [ch("b1", "F"), ch("b2", "G")], style: "block", tones: { chords: PIANO } },
      { id: "C", bars: 4, chords: [ch("k1", "A", 8, "min"), ch("k2", "F", 8)], tones: { chords: SYNTH } },
      { id: "D", bars: 2, chords: [ch("d1", "C"), ch("d2", "G")], style: "strum", tones: { chords: { inst: "guitar", synth: lead, voicing: "close" } } },
    ],
    blocks: [["b1", "A"], ["b2", "B"], ["b3", "C"], ["b4", "D"], ["b5", "B"]],
  }));

// 4. a different drum kit in each section
const f4 = (): SavedProgression =>
  idea(4, "Fixture 4", song({
    parts: [
      { id: "A", bars: 2, chords: [ch("a1", "C", 8)], groove: ROCK },
      { id: "B", bars: 2, chords: [ch("b1", "F", 8)], groove: ROCK, kit: kit("lofi", { space: 0.6 }) },
      { id: "C", bars: 2, chords: [ch("k1", "G", 8)], groove: HALF, kit: kit("mod", { grit: 0.7, human: 0.3 }) },
    ],
    blocks: [["b1", "A"], ["b2", "B"], ["b3", "C"], ["b4", "A"]],
  }));

// 5. 4/4, then 6/8, then 3/4
const f5 = (): SavedProgression =>
  idea(5, "Fixture 5", song({
    parts: [
      { id: "A", bars: 2, chords: [ch("a1", "C"), ch("a2", "G")], melody: mel(2, [[0, 64], [1.5, 67], [4, 69], [6.25, 67]], 4), style: "strum16", groove: ROCK },
      { id: "B", bars: 4, meter: SIG68, chords: [ch("b1", "A", 2, "min"), ch("b2", "F", 2), ch("b3", "C", 2), ch("b4", "G", 2)], melody: mel(4, [[0, 69], [2 / 3, 72], [4 / 3, 76], [2, 77], [4, 76], [6, 74], [7 + 1 / 3, 71]], 3), style: "pima", groove: SIX8 },
      { id: "C", bars: 3, meter: SIG34, chords: [ch("k1", "F", 3), ch("k2", "G", 3), ch("k3", "C", 3)], melody: mel(3, [[0, 65], [1, 69], [2, 72], [3, 71], [6, 72]]), style: "boomchick", groove: WALTZ },
    ],
    blocks: [["b1", "A"], ["b2", "B"], ["b3", "C"]],
  }));

// 6. added tracks in some sections only
const f6 = (): SavedProgression =>
  idea(6, "Fixture 6", song({
    parts: [
      { id: "A", bars: 2, chords: [ch("a1", "C"), ch("a2", "G")], groove: ROCK, layers: { c2: { chords: [ch("x1", "E", 8, "min")], pattern: "pima", sound: { voice: "nylon", space: 0.5 } } }, tones: { c2: PIANO } },
      { id: "B", bars: 2, chords: [ch("b1", "F"), ch("b2", "G")], groove: ROCK, layers: { m2: { melody: mel(2, [[0, 76], [2, 79], [4, 77], [6, 74]]), tuneSound: { voice: "lyre" } }, d2: { beat: { ...DEFAULT_BEAT, ...kit("mod"), ...HALF } } } },
      { id: "C", bars: 2, chords: [], layers: { c2: { chords: [ch("x2", "A", 4, "min"), ch("x3", "D", 4, "min")], pattern: "pima", sound: { voice: "nylon", space: 0.5 } }, d2: { beat: { ...DEFAULT_BEAT, ...kit("mod"), ...ROCK } } }, tones: { c2: PIANO } },
    ],
    blocks: [["b1", "A"], ["b2", "B"], ["b3", "C"]],
    tracks: [{ id: "c2", kind: "chords", name: "Chords 2" }, { id: "m2", kind: "melody", name: "Melody 2" }, { id: "d2", kind: "drums", name: "Drums 2" }],
    mix: { c2: { db: -3 }, m2: { solo: false, mute: true } },
  }));

// 7. a harmony that plays instead of the chords (in A), one that plays along (A and B), and one written from the tune
function f7(): SavedProgression {
  const base = idea(7, "Fixture 7", song({
    parts: [
      { id: "A", bars: 4, chords: [ch("a1", "C"), ch("a2", "A", 4, "min"), ch("a3", "D", 4, "min"), ch("a4", "G", 4, "7")], melody: mel(4, [[0, 64], [2, 67], [4, 69], [6, 72], [8, 74], [10, 77], [12, 74], [14, 71]]), style: "strum" },
      { id: "B", bars: 2, chords: [ch("b1", "F"), ch("b2", "G", 4, "7")], melody: mel(2, [[0, 69], [2, 72], [4, 74], [6, 71]]), style: "strum" },
    ],
    blocks: [["b1", "A"], ["b2", "B"], ["b3", "A"]],
  }));
  let p = base.progression;
  // in A: a passing chord between each pair plays instead of the chords; high chords play along; a third above the tune
  p = writeHarmony(p, FIXTURE_KEY, { kind: "chords", from: "chords", option: "passing" }, { id: "h1", isNew: true, name: "Passing dim" }).p;
  p = writeHarmony(p, FIXTURE_KEY, { kind: "chords", from: "chords", option: "high" }, { id: "h2", isNew: true, name: "High chords" }).p;
  p = writeHarmony(p, FIXTURE_KEY, { kind: "melody", from: "melody", option: "third-above" }, { id: "h3", isNew: true, name: "Third above" }).p;
  // in B: only the high chords, written again there
  p = selectBlock(p, "b2");
  p = writeHarmony(p, FIXTURE_KEY, { kind: "chords", from: "chords", option: "high" }, { id: "h2", isNew: false, name: "High chords" }).p;
  return saved({ ...base, progression: p });
}

// 8. vocal clips trimmed, moved, split and running across sections; two recordings that overlap; one moved before the first beat
const take = (id: string, seconds: number, block: string, bar: number, o: Raw = {}): Raw => ({ id, n: 1, group: `g-${id}`, dry: `${id}-dry.wav`, wet: `${id}-wet.wav`, rate: 48000, start: 0, frames: Math.round(seconds * 48000), at: { block, bar }, ...o });
const f8 = (): SavedProgression =>
  idea(8, "Fixture 8", song({
    bpm: 84,
    parts: [
      { id: "A", bars: 4, chords: FOUR, groove: ROCK },
      { id: "B", bars: 2, chords: [ch("b1", "F"), ch("b2", "G")], groove: ROCK },
    ],
    blocks: [["b1", "A"], ["b2", "B"], ["b3", "A"]],
    tracks: [
      {
        id: "v1", kind: "vocals", name: "Vocal 1", input: 2,
        takes: [
          take("t1", 9, "b1", 1), take("t2", 6, "b1", 2, { n: 2 }), take("t3", 14, "b1", 3), take("t4", 4, "b1", 0),
          take("t5", 3, "nowhere", 0), take("t6", 3, "b2", 5), take("t7", 5, "b3", 0),
        ],
        clips: [
          // trimmed at both ends, then split in two (the pieces are one sound)
          { id: "k1", take: "t1", from: 24000, to: 200000 },
          { id: "k2", take: "t1", from: 200000, to: 400000 },
          // another recording over the same bars, moved a little later: both are heard
          { id: "k3", take: "t2", from: 0, to: 288000, move: 12000 },
          // sung from the last bar of the first section on into the next two
          { id: "k4", take: "t3", from: 4800, to: 672000 },
          // moved to before the song starts: only what is left after the first beat plays
          { id: "k5", take: "t4", from: 0, to: 192000, move: -30000 },
          // a recording whose section was deleted, and one whose bar is no longer in its section
          { id: "k6", take: "t5", from: 0, to: 144000 },
          { id: "k7", take: "t6", from: 0, to: 144000 },
          { id: "k8", take: "t7", from: 12000, to: 240000, move: -6000 },
        ],
      },
      { id: "v2", kind: "vocals", name: "Vocal 2", takes: [take("u1", 4, "b2", 0)], clips: [{ id: "q1", take: "u1", from: 0, to: 192000 }] },
    ],
    mix: { v1: { db: -2, solo: true } },
  }));

// 9. synth tracks: an arpeggio in one section and a drone in the next on the first chords, a melody on a loosened lead, an added pad
const f9 = (): SavedProgression =>
  idea(9, "Fixture 9", song({
    parts: [
      { id: "A", bars: 2, chords: [ch("a1", "C"), ch("a2", "A", 4, "min")], melody: mel(2, [[0, 72], [1, 76], [2, 79], [4, 81], [6, 79]]), tones: { chords: ARP, melody: GLIDE, c2: SYNTH }, layers: { c2: { chords: [ch("x1", "E", 4, "min"), rest("x2", 2), ch("x3", "G", 2)] } } },
      { id: "B", bars: 2, chords: [ch("b1", "F", 6), ch("b2", "G", 2)], melody: mel(2, [[0, 77], [3, 74], [4, 72]]), tones: { chords: DRONE, melody: GLIDE } },
    ],
    blocks: [["b1", "A"], ["b2", "B"], ["b3", "A"]],
    tracks: [{ id: "c2", kind: "chords", name: "Chords 2" }],
  }));

// 10. a piano melody with the pedal on over sparse chords (and an added one, with chords that end early)
const f10 = (): SavedProgression =>
  idea(10, "Fixture 10", song({
    parts: [
      { id: "A", bars: 4, chords: [ch("a1", "C", 4), ch("a2", "F", 4)], melody: mel(4, [[0, 64], [2, 67], [5, 69], [8, 72], [11, 71], [13, 67]]), tones: { melody: { inst: "piano", pedal: true }, chords: { inst: "piano", pedal: true, keys: "electric" } } },
      { id: "B", bars: 4, chords: [], melody: mel(4, [[0, 60], [4, 64], [9, 67]]), tones: { melody: { inst: "piano", pedal: true }, m2: { inst: "piano", pedal: true, bright: 0.7 } }, layers: { m2: { melody: mel(4, [[2, 76], [6, 79], [12, 84]]) } } },
    ],
    blocks: [["b1", "A"], ["b2", "B"]],
    tracks: [{ id: "m2", kind: "melody", name: "Melody 2" }],
  }));

// 11. a two-bar playing style, and a style at half speed
const f11 = (): SavedProgression =>
  idea(11, "Fixture 11", song({
    parts: [
      { id: "A", bars: 4, chords: [ch("a1", "C", 8), ch("a2", "F", 4), ch("a3", "G", 4)], style: "bossa" },
      { id: "B", bars: 4, chords: [ch("b1", "A", 6, "min"), ch("b2", "E", 6, "min"), ch("b3", "F", 4)], style: "travis", feel: { speed: 0.5, swing: 0.3, octave: 1 } },
      { id: "C", bars: 2, chords: [ch("k1", "D", 4, "min"), ch("k2", "G", 4)], style: "clave", feel: { speed: 2 } },
    ],
    blocks: [["b1", "A"], ["b2", "B"], ["b3", "C"]],
  }));

// 12. a drum rhythm shorter than its section, and one longer
const f12 = (): SavedProgression =>
  idea(12, "Fixture 12", song({
    parts: [
      { id: "A", bars: 4, chords: FOUR, groove: rhythm({ name: "Two", steps: 16, div: 4, bars: 2, rows: { kick: "X...x...X...x... X.x.....X.......", snare: "....X.......X... ....X.......X.X." } }) },
      { id: "B", bars: 2, chords: [ch("b1", "F", 8)], groove: rhythm({ name: "Long", steps: 16, div: 4, bars: 4, rows: { kick: "X............... x............... X.......X....... xxxxxxxxxxxxxxxx", hat: "x.x.x.x.x.x.x.x. ..x...x...x...x. x.x.x.x.x.x.x.x. ................" } }) },
    ],
    blocks: [["b1", "A"], ["b2", "B"]],
  }));

// 13. chords running past their section's end
const f13 = (): SavedProgression =>
  idea(13, "Fixture 13", song({
    parts: [
      { id: "A", bars: 2, chords: [ch("a1", "C", 3), ch("a2", "F", 3), ch("a3", "G", 6), ch("a4", "C", 4)], style: "eighths" },
      { id: "B", bars: 1, chords: [ch("b1", "A", 8, "min")], layers: { c2: { chords: [ch("x1", "C", 2.5), ch("x2", "E", 8, "min")] } } },
    ],
    blocks: [["b1", "A"], ["b2", "B"]],
    tracks: [{ id: "c2", kind: "chords", name: "Chords 2" }],
  }));

// 14. a melody that is off, and drums that are off
const f14 = (): SavedProgression =>
  idea(14, "Fixture 14", song({
    parts: [
      { id: "A", bars: 2, chords: [ch("a1", "C"), ch("a2", "G")], melody: mel(2, [[0, 64], [4, 67]], 2, false), groove: { ...ROCK, on: false } },
      { id: "B", bars: 2, chords: [ch("b1", "F"), ch("b2", "G")], melody: mel(2, [[0, 65], [4, 67]]), groove: ROCK, layers: { m2: { melody: mel(2, [[1, 72]], 2, false) }, d2: { beat: { ...DEFAULT_BEAT, ...HALF, on: false } } } },
      { id: "C", bars: 2, chords: [ch("k1", "C", 8)], groove: UNTOUCHED },
    ],
    blocks: [["b1", "A"], ["b2", "B"], ["b3", "C"]],
    tracks: [{ id: "m2", kind: "melody", name: "Melody 2" }, { id: "d2", kind: "drums", name: "Drums 2" }],
  }));

// 15. swing on the first drums, with sixteenth-note playing styles and melodies (one on the strings, one on a piano)
const f15 = (): SavedProgression =>
  idea(15, "Fixture 15", song({
    parts: [
      { id: "A", bars: 2, chords: [ch("a1", "C"), ch("a2", "G")], melody: mel(2, [[0, 64], [0.25, 65], [0.75, 67], [2, 69], [3.25, 67], [4, 65], [5.75, 64], [7.25, 62]], 4), style: "strum16", groove: { ...ROCK, swing: 0.6 }, layers: { c2: { chords: [ch("x1", "E", 8, "min")], pattern: "pima" } } },
      { id: "B", bars: 4, chords: [ch("b1", "F", 4), ch("b2", "G", 2)], melody: mel(4, [[0, 65], [0.25, 67], [1.75, 69], [3.75, 72], [4, 74], [7.25, 72], [9.75, 69], [12, 67], [15.75, 65]], 4), style: "pop16", groove: { ...HALF, swing: 0.35 }, tones: { melody: PIANO }, layers: { m2: { melody: mel(4, [[0.75, 76], [2.25, 79], [7.75, 81], [8, 79], [11.75, 76]], 4) } } },
    ],
    blocks: [["b1", "A"], ["b2", "B"]],
    tracks: [{ id: "c2", kind: "chords", name: "Chords 2" }, { id: "m2", kind: "melody", name: "Melody 2" }],
    // (the added melody on the synth, played note for note)
  }));

// 16. the first drums on with swing but with no hits; then a triplet grid with no hits; then drums nobody ever touched
const f16 = (): SavedProgression =>
  idea(16, "Fixture 16", song({
    parts: [
      { id: "A", bars: 2, chords: [ch("a1", "C"), ch("a2", "G")], melody: mel(2, [[0, 64], [0.25, 65], [1.75, 67], [4.25, 69]], 4), style: "strum16", groove: rhythm({ name: "Empty", steps: 16, div: 4, swing: 0.5, rows: {} }) },
      { id: "B", bars: 2, chords: [ch("b1", "F"), ch("b2", "G")], style: "eighths", groove: rhythm({ name: "Triplets", steps: 12, div: 3, rows: {} }) },
      { id: "C", bars: 2, chords: [ch("k1", "A", 8, "min")], style: "strum16", groove: UNTOUCHED, kit: PLAIN },
    ],
    blocks: [["b1", "A"], ["b2", "B"], ["b3", "C"]],
  }));

// 17. a section with only vocals, and two empty sections at the end
const f17 = (): SavedProgression =>
  idea(17, "Fixture 17", song({
    parts: [
      { id: "A", bars: 2, chords: [ch("a1", "C"), ch("a2", "G")], groove: ROCK },
      { id: "B", bars: 3, chords: [] },
      { id: "C", bars: 2, chords: [] },
      { id: "D", bars: 1, meter: SIG34, chords: [] },
    ],
    blocks: [["b1", "A"], ["b2", "B"], ["b3", "C"], ["b4", "D"]],
    tracks: [{ id: "v1", kind: "vocals", name: "Vocal 1", takes: [take("t1", 6, "b2", 0)], clips: [{ id: "k1", take: "t1", from: 0, to: 288000 }] }],
  }));

// The worked example: a verse, a chorus in 6/8, the verse again. The first chords play a guitar in the verse and a piano
// in the chorus; "Chords 2" (a synth) and a recording are in the chorus only.
const f18 = (): SavedProgression =>
  idea(18, "Worked example", song({
    bpm: 96,
    parts: [
      { id: "V", name: "Verse", color: 0, bars: 8, chords: [ch("v1", "C", 8), ch("v2", "F", 8), ch("v3", "G", 8), ch("v4", "C", 8)], groove: ROCK, kit: kit("lofi") },
      {
        id: "H", name: "Chorus", color: 1, bars: 4, meter: SIG68, chords: [ch("h1", "A", 4, "min"), ch("h2", "F", 4)], groove: SIX8, kit: kit("lofi"), tones: { chords: PIANO, c7x: SYNTH },
        melody: mel(4, [[0, 69], [2 / 3, 72], [4 / 3, 76], [2, 77], [8 / 3, 76], [4, 74], [14 / 3, 72], [6, 71], [20 / 3, 72]], 3),
        layers: { c7x: { chords: [ch("y1", "A", 4, "min"), ch("y2", "F", 4)] } },
      },
    ],
    blocks: [["b1", "V"], ["b2", "H"], ["b3", "V"]],
    tracks: [{ id: "c7x", kind: "chords", name: "Chords 2" }, { id: "v1", kind: "vocals", name: "Vocal 1", takes: [take("t1", 3, "b2", 2)], clips: [{ id: "k1", take: "t1", from: 0, to: 144000 }] }],
  }));

const ALL = [f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16, f17, f18];

/** One fixture, by its number (1 to 17; 18 is the worked example). A fresh copy each time. */
export const fixture = (n: number): SavedProgression => ALL[n - 1]();
/** All eighteen, in order: "Fixture 1" to "Fixture 17", then "Worked example". */
export const fixtures = (): SavedProgression[] => ALL.map((f) => f());
/** How many of them are the numbered fixtures (the last one is the worked example). */
export const FIXTURES = 17;
