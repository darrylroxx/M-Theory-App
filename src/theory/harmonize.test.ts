import { describe, expect, it } from "vitest";
import {
  CHORD_HARMONY,
  HARMONY_OPTIONS,
  MELODY_HARMONY,
  beatGroups,
  beatStrength,
  chordSpans,
  harmonize,
  HARMONY_MENU,
  hintFor,
  isMinorKey,
  labelFor,
  harmonyOptions,
  melodyLine,
  parallelPerfect,
  parentScale,
  type HarmonizeInput,
  type Shape,
} from "./harmonize";
import { CHORD_TYPES, refPcs, type ChordRef } from "./chords";
import { diatonicChords, keyScale, type Key } from "./keys";
import { mod12, pc } from "./notes";
import { getScale, scalePcs } from "./scales";
import { seededRng } from "./progression";
import { TICKS, type Melody } from "../song/melody";
import type { ProgChord } from "../ui/state";

// ── Helpers ───────────────────────────────────────────────────

/** "C Am:2 F G7 -:4" → chords (4 beats each unless a length is given; "-" is a rest). */
const P = (s: string, beats = 4): ProgChord[] =>
  s.split(" ").map((x, i) => {
    const [sym, b] = x.split(":");
    const len = b ? Number(b) : beats;
    if (sym === "-") return { id: "r" + i, ref: { root: "C", typeId: "maj" }, beats: len, rest: true };
    const m = /^([A-G][b#]?)([^/]*)(?:\/([A-G][b#]?))?$/.exec(sym)!;
    const t = CHORD_TYPES.find((t) => t.symbol === m[2])!;
    const ref: ChordRef = { root: m[1], typeId: t.id, ...(m[3] ? { bass: m[3] } : {}) };
    return { id: "c" + i, ref, beats: len };
  });
/** [beat, midi][] → a melody */
const M = (notes: [number, number][], bars = 4, div: Melody["div"] = 2): Melody => ({ div, bars, notes: notes.map(([b, m]) => ({ at: Math.round(b * TICKS), midi: m })) });

const C: Key = { tonic: "C", scaleId: "ionian" };
const Am: Key = { tonic: "A", scaleId: "aeolian" };

interface Case {
  name: string;
  key: Key;
  chords: ProgChord[];
  tune: Melody;
  bar: number;
  bars: number;
  compound?: boolean;
}

const CASES: Case[] = [
  {
    name: "C major, I–vi–IV–V",
    key: C,
    chords: P("C Am F G"),
    tune: M([[0, 64], [1, 65], [2, 67], [3, 69], [4, 72], [6, 71], [8, 69], [9, 67], [10, 65], [12, 62], [14, 67]]),
    bar: 4,
    bars: 4,
  },
  {
    name: "A minor with the major V",
    key: Am,
    chords: P("Am Dm E Am"),
    tune: M([[0, 69], [1, 72], [2, 71], [3, 68], [4, 69], [6, 65], [8, 64], [9, 68], [10, 71], [12, 69]]),
    bar: 4,
    bars: 4,
  },
  {
    name: "C major with borrowed chords",
    key: C,
    chords: P("C Fm Ab G"),
    tune: M([[0, 67], [2, 64], [4, 68], [6, 65], [8, 63], [10, 72], [12, 71], [14, 74]]),
    bar: 4,
    bars: 4,
  },
  {
    name: "D dorian in 6/8",
    key: { tonic: "D", scaleId: "dorian" },
    chords: P("Dm:2 G:2 Dm:2 G:2"),
    tune: M([[0, 62], [1 / 3, 64], [2 / 3, 65], [1, 69], [2, 71], [3, 67], [4, 69], [5, 65], [6, 62], [7, 64]], 4, 3),
    bar: 2,
    bars: 4,
    compound: true,
  },
  {
    name: "E minor in 7/4 with a rest",
    key: { tonic: "E", scaleId: "aeolian" },
    chords: P("Em:7 -:3 C:4 D:7"),
    tune: M([[0, 64], [2, 67], [4, 71], [5, 69], [7, 72], [9, 71], [14, 74], [16, 71], [18, 67]], 3),
    bar: 7,
    bars: 3,
  },
  {
    name: "G mixolydian, one chord",
    key: { tonic: "G", scaleId: "mixolydian" },
    chords: P("G:16"),
    tune: M([[0, 67], [1, 71], [2, 74], [3, 77], [4, 76], [8, 74], [12, 72]]),
    bar: 4,
    bars: 4,
  },
  {
    name: "F major waltz",
    key: { tonic: "F", scaleId: "ionian" },
    chords: P("F:3 Bb:3 C7:3 F:3"),
    tune: M([[0, 69], [1, 70], [2, 72], [3, 74], [5, 70], [6, 67], [7, 64], [8, 67], [9, 65]]),
    bar: 3,
    bars: 4,
  },
  {
    name: "E minor pentatonic key",
    key: { tonic: "E", scaleId: "minorPentatonic" },
    chords: P("Em Am Em B7"),
    tune: M([[0, 64], [1, 67], [2, 69], [4, 71], [6, 74], [8, 76], [12, 71]]),
    bar: 4,
    bars: 4,
  },
  {
    name: "Bb major, sevenths and a slash chord",
    key: { tonic: "Bb", scaleId: "ionian" },
    chords: P("Bbmaj7 Gm7 Cm7:2 F7:2 Bb/D"),
    tune: M([[0, 74], [1, 72], [2, 70], [4, 70], [5, 67], [6, 69], [8, 67], [10, 69], [12, 70], [13, 72], [14, 74]]),
    bar: 4,
    bars: 4,
  },
];

/** A pair line note for note, a third away: the busiest and closest setting of the controls. */
const PAIR: Shape = { busy: 2, wide: 0, colour: 1 };
const input = (c: Case, kind: "melody" | "chords", option: string, from: "melody" | "chords" | "both", seed = 1, shape?: Shape): HarmonizeInput => ({
  ...(shape ? { shape } : {}),
  kind,
  option,
  source: from === "melody" ? { melody: c.tune } : from === "chords" ? { chords: c.chords } : { melody: c.tune, chords: c.chords },
  under: from === "melody" ? c.chords : undefined,
  key: c.key,
  bar: c.bar,
  bars: c.bars,
  compound: c.compound,
  seed,
});

const len = (c: Case) => c.bars * c.bar * TICKS;
/** The chord under a moment (null: a rest or past the end). */
const chordAt = (chords: ProgChord[], t: number): ChordRef | null => {
  let at = 0;
  for (const ch of chords) {
    const d = ch.beats * TICKS;
    if (t >= at && t < at + d) return ch.rest ? null : ch.ref;
    at += d;
  }
  return null;
};
const keyPcs = (k: Key) => scalePcs(pc(k.tonic), getScale(parentScale(k)));
const sounding = (notes: { at: number; midi: number }[], t: number) => {
  let m: number | null = null;
  for (const n of [...notes].sort((a, b) => a.at - b.at)) {
    if (n.at > t) break;
    m = n.midi;
  }
  return m;
};
const ic = (a: number, b: number) => mod12(Math.abs(a - b));
const CONSONANT = [0, 3, 4, 5, 7, 8, 9];
const strong = (at: number, bar: number) => beatStrength(at, bar) >= 2;

/** Is a note in the key, in the chord under it, or one the tune itself uses (a borrowed note it asks for)? */
function fits(c: Case, at: number, midi: number, chords = c.chords): boolean {
  const p = mod12(midi);
  const ref = chordAt(chords, at);
  if (keyPcs(c.key).includes(p)) return true;
  if (ref && refPcs(ref).map(mod12).includes(p)) return true;
  return c.tune.notes.some((n) => mod12(n.midi) === p);
}

const bounds = (chords: ProgChord[]) => {
  const out: number[] = [];
  let at = 0;
  for (const ch of chords) {
    out.push(Math.round(at * TICKS));
    at += ch.beats;
  }
  return { starts: out, total: at };
};
const sym = (chords: ProgChord[] | undefined) => (chords ?? []).map((c) => (c.rest ? "-" : `${c.ref.root}:${c.ref.typeId}${c.ref.bass ? "/" + c.ref.bass : ""}`) + "@" + c.beats).join(" ");

// ── The menus ─────────────────────────────────────────────────

describe("harmony menus", () => {
  it("has the research's melody and chord options, each with a short label, a hint and its sources", () => {
    expect(MELODY_HARMONY.length).toBeGreaterThanOrEqual(9);
    expect(CHORD_HARMONY.length).toBeGreaterThanOrEqual(13);
    const ids = HARMONY_OPTIONS.map((o) => `${o.kind}:${o.id}`);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of HARMONY_OPTIONS) {
      expect(o.label.split(" ").length).toBeLessThanOrEqual(2);
      expect(o.hint.length).toBeGreaterThan(8);
      expect(o.hint).not.toMatch(/\n/);
      expect(o.from.length).toBeGreaterThan(0);
      for (const f of o.from) expect(["chords", "melody"]).toContain(f);
    }
    for (const l of ["High harmony", "Low harmony", "Counter-melody", "Long notes", "Answer", "Chord notes"]) expect(MELODY_HARMONY.map((o) => o.label)).toContain(l);
    for (const l of ["Best fit", "Richer", "Sus", "Darker", "Relative", "Pedal bass", "Lead-ins"]) expect(CHORD_HARMONY.map((o) => o.label)).toContain(l);
    // older options are kept, under the names they had, so the tracks written with them can be written again
    for (const l of ["Pad", "Higher voicing", "Shell", "Smooth inversions", "Passing dim", "Tritone swap"]) expect(CHORD_HARMONY.map((o) => o.label)).toContain(l);
    for (const l of ["Sixth below", "Octave", "Drone"]) expect(MELODY_HARMONY.map((o) => o.label)).toContain(l);
  });

  it("offers, best first, only harmonies a track of that kind can be written from", () => {
    for (const kind of ["melody", "chords"] as const)
      for (const from of ["melody", "chords"] as const) {
        const ids = HARMONY_MENU[kind][from];
        expect(harmonyOptions(kind, from).map((o) => o.id)).toEqual(ids);
        for (const id of ids) {
          const o = HARMONY_OPTIONS.find((x) => x.kind === kind && x.id === id);
          expect(o, `${kind} ${id}`).toBeDefined();
          expect(o!.from, `${kind} ${id}`).toContain(from);
        }
      }
    expect(harmonyOptions("melody", "melody").map((o) => o.id)).toEqual(["third-below", "third-above", "stack", "counter", "slow-line", "answer"]);
    // under a low tune the high harmony comes first
    expect(harmonyOptions("melody", "melody", true).map((o) => o.id).slice(0, 2)).toEqual(["third-above", "third-below"]);
    expect(harmonyOptions("melody", "chords").map((o) => o.id)).toEqual(["slow-line", "counter", "chord-tones"]);
    expect(harmonyOptions("chords", "chords").map((o) => o.id)).toEqual(["high", "airy", "guide", "top", "relative", "borrowed", "lead-in"]);
    expect(harmonyOptions("chords", "melody").map((o) => o.id)).toEqual(["fit", "fit2"]);
    expect(harmonyOptions("chords").every((o) => o.kind === "chords")).toBe(true);
  });

  it("the swaps that replace the chords are played instead of them: borrowed chords, relatives, lead-ins", () => {
    const instead = CHORD_HARMONY.filter((o) => o.instead && HARMONY_MENU.chords.chords.includes(o.id)).map((o) => o.id);
    expect(instead).toEqual(["borrowed", "relative", "lead-in"]);
    expect(CHORD_HARMONY.find((o) => o.id === "relative")!.instead).toBe(true);
  });

  it("names the borrowed chords by the key: darker in major, brighter in minor", () => {
    const b = CHORD_HARMONY.find((o) => o.id === "borrowed")!;
    expect([labelFor(b, C), hintFor(b, C)]).toEqual(["Darker", "Some chords from the minor key"]);
    expect([labelFor(b, { tonic: "A", scaleId: "aeolian" }), hintFor(b, { tonic: "A", scaleId: "aeolian" })]).toEqual(["Brighter", "Some chords from the major key"]);
    expect(labelFor(b, { tonic: "D", scaleId: "dorian" })).toBe("Brighter");
    expect(labelFor(b, { tonic: "G", scaleId: "mixolydian" })).toBe("Darker");
    expect(isMinorKey({ tonic: "E", scaleId: "phrygian" })).toBe(true);
    const sus = CHORD_HARMONY.find((o) => o.id === "sus")!;
    expect(labelFor(sus, { tonic: "A", scaleId: "aeolian" })).toBe("Sus");
  });
});

// ── Time ──────────────────────────────────────────────────────

describe("beats and bars", () => {
  it("groups the beats of odd bars the usual way", () => {
    expect(beatGroups(4)).toEqual([2, 2]);
    expect(beatGroups(3)).toEqual([3]);
    expect(beatGroups(5)).toEqual([3, 2]);
    expect(beatGroups(7)).toEqual([2, 2, 3]);
    expect(beatGroups(2)).toEqual([1, 1]);
  });
  it("knows the strong moments of 4/4, 3/4, 6/8 and 7/4", () => {
    expect(beatStrength(0, 4)).toBe(3);
    expect(beatStrength(2 * TICKS, 4)).toBe(2);
    expect(beatStrength(1 * TICKS, 4)).toBe(1);
    expect(beatStrength(6, 4)).toBe(0);
    expect(beatStrength(3 * TICKS, 3)).toBe(3);
    expect(beatStrength(1 * TICKS, 3)).toBe(1);
    // 6/8: two beats a bar, the second the start of a group
    expect(beatStrength(1 * TICKS, 2)).toBe(2);
    expect(beatStrength(4, 2)).toBe(0);
    // 7/4 as 2+2+3
    expect(beatStrength(2 * TICKS, 7)).toBe(2);
    expect(beatStrength(4 * TICKS, 7)).toBe(2);
    expect(beatStrength(5 * TICKS, 7)).toBe(1);
    expect(beatStrength(7 * TICKS, 7)).toBe(3);
  });
  it("reads a section's chords and melody as they play", () => {
    const spans = chordSpans(P("C:2 -:2 G:8"), 8 * TICKS);
    expect(spans.map((s) => [s.start / TICKS, s.end / TICKS, s.ref?.root ?? null])).toEqual([[0, 2, "C"], [2, 4, null], [4, 8, "G"]]);
    const line = melodyLine({ div: 2, bars: 1, notes: [{ at: 0, midi: 60 }, { at: 0, midi: 64 }, { at: 24, midi: 62 }, { at: 99, midi: 70 }] }, 48);
    expect(line).toEqual([{ at: 0, end: 24, midi: 64 }, { at: 24, end: 48, midi: 62 }]);
  });
  it("tests parallel fifths and octaves the way counterpoint does", () => {
    expect(parallelPerfect(60, 67, 62, 69)).toBe(true); // C–G to D–A
    expect(parallelPerfect(60, 72, 62, 74)).toBe(true); // octaves
    expect(parallelPerfect(60, 67, 62, 81)).toBe(true); // a fifth to a twelfth
    expect(parallelPerfect(60, 67, 60, 67)).toBe(false); // nothing moves
    expect(parallelPerfect(60, 67, 62, 67)).toBe(false); // oblique
    expect(parallelPerfect(60, 64, 62, 66)).toBe(false); // thirds are fine
  });
});

// ── A new melody track ────────────────────────────────────────

describe("melody harmony from a melody", () => {
  for (const c of CASES)
    describe(c.name, () => {
      const tune = melodyLine(c.tune, len(c));

      for (const [id, side] of [["third-above", 1], ["third-below", -1], ["sixth-below", -1]] as const)
        it(`${id}: one note per tune note, in the key or the chord, consonant on strong beats, on its side`, () => {
          const out = harmonize(input(c, "melody", id, "melody", 1, PAIR)).melody!;
          expect(out.notes.map((n) => n.at)).toEqual(tune.map((n) => n.at));
          let onSide = 0;
          out.notes.forEach((h, i) => {
            const n = tune[i];
            expect(fits(c, h.at, h.midi), `${h.at}:${h.midi}`).toBe(true);
            if (strong(n.at, c.bar) || n.end - n.at > TICKS) expect(CONSONANT, `strong ${n.at}: ${n.midi}/${h.midi}`).toContain(ic(h.midi, n.midi));
            if (Math.sign(h.midi - n.midi) === side) onSide++;
            expect(h.midi).not.toBe(n.midi);
            if (i > 0) expect(parallelPerfect(tune[i - 1].midi, out.notes[i - 1].midi, n.midi, h.midi), `parallel at ${n.at}`).toBe(false);
          });
          expect(onSide / out.notes.length).toBeGreaterThanOrEqual(0.8);
          // a third or a sixth away most of the time: the interval the option names
          const sized = out.notes.filter((h, i) => {
            const d = Math.abs(h.midi - tune[i].midi);
            return id === "sixth-below" ? d >= 7 && d <= 10 : d >= 3 && d <= 5;
          }).length;
          expect(sized / out.notes.length).toBeGreaterThanOrEqual(0.5);
        });

      it("chord-tones: a walk through the chord notes, never a rub with the tune", () => {
        const out = harmonize(input(c, "melody", "chord-tones", "melody")).melody!;
        expect(out.notes.length).toBeGreaterThan(0);
        for (const h of out.notes) {
          const n = sounding(tune, h.at);
          const ref = chordAt(c.chords, h.at);
          expect(fits(c, h.at, h.midi), `${h.at}:${h.midi}`).toBe(true);
          if (n !== null && strong(h.at, c.bar)) expect([1, 11, 6]).not.toContain(ic(h.midi, n));
          if (ref && strong(h.at, c.bar)) expect(refPcs(ref).map(mod12)).toContain(mod12(h.midi));
        }
      });

      it("counter-line: its own slower line, consonant on strong beats, no parallels, leaps recovered", () => {
        const out = harmonize(input(c, "melody", "counter", "melody")).melody!;
        const notes = out.notes;
        expect(notes.length).toBeGreaterThan(0);
        for (const h of notes) expect(fits(c, h.at, h.midi), `${h.at}:${h.midi}`).toBe(true);
        // consonant with the tune wherever a strong beat falls
        for (let t = 0; t < len(c); t += TICKS / 2) {
          if (!strong(t, c.bar)) continue;
          const a = sounding(notes, t);
          const b = sounding(tune, t);
          if (a === null || b === null || !chordAt(c.chords, t)) continue;
          expect(CONSONANT, `strong ${t / TICKS}: ${b}/${a}`).toContain(ic(a, b));
        }
        // no parallel fifths or octaves at any moment either line moves
        const moments = [...new Set([...notes.map((n) => n.at), ...tune.map((n) => n.at)])].sort((a, b) => a - b);
        for (let i = 1; i < moments.length; i++) {
          const a1 = sounding(notes, moments[i - 1]);
          const b1 = sounding(tune, moments[i - 1]);
          const a2 = sounding(notes, moments[i]);
          const b2 = sounding(tune, moments[i]);
          if (a1 === null || b1 === null || a2 === null || b2 === null) continue;
          expect(parallelPerfect(b1, a1, b2, a2), `parallel at ${moments[i] / TICKS}`).toBe(false);
        }
        // the two lines take turns: between the strong beats and chord changes the counter-line
        // moves only where the tune holds; and it stays within a twelfth of the tune
        // at most one note a beat (the middle setting), moving where the tune holds
        expect(notes.length).toBeLessThanOrEqual(c.bars * Math.ceil(c.bar) + 1);
        for (const h of notes) {
          const m = sounding(tune, h.at);
          if (m !== null) expect(Math.abs(h.midi - m)).toBeLessThanOrEqual(19);
        }
        // mostly steps; a leap of a fourth or more is not followed by another leap the same way
        for (let i = 2; i < notes.length; i++) {
          const prev = notes[i - 1].midi - notes[i - 2].midi;
          const d = notes[i].midi - notes[i - 1].midi;
          if (Math.abs(prev) >= 7) expect(Math.abs(d) >= 5 && Math.sign(d) === Math.sign(prev), `leap at ${notes[i].at / TICKS}`).toBe(false);
        }
      });

      it("octave: the tune doubled an octave away", () => {
        const out = harmonize(input(c, "melody", "octave", "melody")).melody!;
        expect(out.notes.length).toBeGreaterThan(0);
        const d = out.notes[0].midi - tune.find((n) => n.at === out.notes[0].at)!.midi;
        expect(Math.abs(d)).toBe(12);
        for (const h of out.notes) expect(h.midi - tune.find((n) => n.at === h.at)!.midi).toBe(d);
      });

      it("answer: only in the gaps the tune leaves", () => {
        const out = harmonize(input(c, "melody", "answer", "melody")).melody!;
        // it always answers somewhere, in the key or the chord, never with a strong tune note
        expect(out.notes.length).toBeGreaterThan(0);
        for (const h of out.notes) {
          expect(fits(c, h.at, h.midi), `${h.at}:${h.midi}`).toBe(true);
          expect(tune.some((n) => n.at === h.at && strong(h.at, c.bar)), `${h.at}`).toBe(false);
        }
      });

      it("drone: one note, home or its fifth", () => {
        const res = harmonize(input(c, "melody", "drone", "melody"));
        const out = res.melody!;
        expect(out.notes.length).toBeGreaterThan(0);
        const pcs = new Set(out.notes.map((n) => mod12(n.midi)));
        expect(pcs.size).toBe(1);
        expect([pc(c.key.tonic), mod12(pc(c.key.tonic) + 7)]).toContain([...pcs][0]);
      });

      it("slow-line: a guide tone of each chord, moving little", () => {
        const out = harmonize(input(c, "melody", "slow-line", "melody")).melody!;
        expect(out.notes.length).toBeGreaterThan(0);
        for (const h of out.notes) {
          const ref = chordAt(c.chords, h.at)!;
          expect(refPcs(ref).map(mod12)).toContain(mod12(h.midi));
        }
        for (let i = 1; i < out.notes.length; i++) expect(Math.abs(out.notes[i].midi - out.notes[i - 1].midi)).toBeLessThanOrEqual(7);
      });

      it("every line stays singable: near the tune and inside a voice's range", () => {
        const lo = Math.min(...tune.map((n) => n.midi));
        const hi = Math.max(...tune.map((n) => n.midi));
        for (const o of MELODY_HARMONY) {
          const out = harmonize(input(c, "melody", o.id, "melody")).melody!;
          for (const h of out.notes) {
            expect(h.midi, o.id).toBeGreaterThanOrEqual(Math.max(36, lo - 19));
            expect(h.midi, o.id).toBeLessThanOrEqual(Math.min(96, hi + 19));
            expect(h.at).toBeGreaterThanOrEqual(0);
            expect(h.at).toBeLessThan(len(c));
          }
          // a written line's span is a voice's, not a keyboard's (a drone and an octave copy follow the tune)
          if (out.notes.length > 1 && o.id !== "octave" && o.id !== "stack") {
            const span = Math.max(...out.notes.map((n) => n.midi)) - Math.min(...out.notes.map((n) => n.midi));
            expect(span, o.id).toBeLessThanOrEqual(Math.max(19, hi - lo + 5));
          }
          expect(out.bars).toBe(c.bars);
          expect([1, 2, 3, 4]).toContain(out.div);
          for (const h of out.notes) expect(h.at % (TICKS / out.div), `${o.id} on its grid`).toBe(0);
        }
      });
    });

  it("bends a third to the chord on a strong beat (the worked example: E–F–G over C gives G–A–E or G–A–C)", () => {
    const out = harmonize({ kind: "melody", option: "third-above", source: { melody: M([[1, 64], [1.5, 65], [2, 67]], 1) }, under: P("C"), key: C, bar: 4, bars: 1, shape: PAIR }).melody!;
    expect(out.notes.slice(0, 2).map((n) => n.midi)).toEqual([67, 69]);
    // B over a C chord on beat 3 would rub: it bends to a chord note instead
    expect([64, 72]).toContain(out.notes[2].midi);
  });

  it("follows the key's scale: a third is three or four semitones, as the key says", () => {
    // (a tune clear of the chords' own register, so the third is free to be a third)
    const tune = M([[0, 72], [0.5, 74], [1, 76], [1.5, 77], [2, 79]], 1);
    const out = harmonize({ kind: "melody", option: "third-above", source: { melody: tune }, key: C, bar: 4, bars: 1, shape: PAIR }).melody!;
    const d = out.notes.map((n, i) => n.midi - tune.notes[i].midi);
    expect(d.slice(0, 4)).toEqual([4, 3, 3, 4]); // C→E, D→F, E→G, F→A
  });

  it("uses a borrowed chord's own notes over it (F minor in C major: A♭, not A)", () => {
    const out = harmonize({ kind: "melody", option: "third-below", source: { melody: M([[0, 72], [2, 72]], 1) }, under: P("Fm"), key: C, bar: 4, bars: 1 }).melody!;
    expect(out.notes.map((n) => mod12(n.midi))).toContain(8);
    expect(out.notes.map((n) => mod12(n.midi))).not.toContain(9);
  });

  it("chooses its own chords to bend to when the song has none", () => {
    const c = CASES[0];
    const out = harmonize({ kind: "melody", option: "third-above", source: { melody: c.tune }, key: c.key, bar: 4, bars: 4 }).melody!;
    expect(out.notes.length).toBe(c.tune.notes.length);
    for (const h of out.notes) expect(keyPcs(c.key)).toContain(mod12(h.midi));
  });
});

describe("melody harmony from chords", () => {
  for (const c of CASES)
    it(`${c.name}: chord tones, counter-line, slow line and drone written from the chords alone`, () => {
      for (const id of ["chord-tones", "counter", "slow-line", "drone"]) {
        const out = harmonize(input(c, "melody", id, "chords")).melody!;
        expect(out.notes.length, id).toBeGreaterThan(0);
        for (const h of out.notes) {
          const ref = chordAt(c.chords, h.at);
          // nothing is written over a rest
          expect(ref, `${id} at ${h.at / TICKS}`).not.toBeNull();
          if (id === "drone") continue;
          if (id === "counter") expect(fits(c, h.at, h.midi)).toBe(true);
          else expect(refPcs(ref!).map(mod12), `${id} at ${h.at / TICKS}`).toContain(mod12(h.midi));
        }
        // inside the melody grid's reach: around the key's home note
        for (const h of out.notes) {
          expect(h.midi).toBeGreaterThanOrEqual(36);
          expect(h.midi).toBeLessThanOrEqual(96);
        }
        // a chord tone on every chord change (the line follows the harmony)
        if (id === "chord-tones" || id === "counter")
          for (const s of chordSpans(c.chords, len(c))) {
            if (!s.ref) continue;
            const m = sounding(out.notes, s.start);
            expect(m, `${id} at ${s.start / TICKS}`).not.toBeNull();
            expect(refPcs(s.ref).map(mod12), `${id} at ${s.start / TICKS}`).toContain(mod12(m!));
          }
      }
    });

  it("options that need a tune give nothing from chords alone", () => {
    for (const id of ["third-above", "third-below", "sixth-below", "octave", "answer"]) expect(harmonize(input(CASES[0], "melody", id, "chords")).melody!.notes).toEqual([]);
  });
});

// ── A new chords track ────────────────────────────────────────

const LAYERS = ["pad", "higher", "shell", "smooth", "colour", "sus", "relative", "pedal"];
const INSTEAD = ["borrowed", "lead-in", "passing", "tritone"];

describe("chord harmony from chords", () => {
  for (const c of CASES)
    describe(c.name, () => {
      const src = bounds(c.chords);
      const srcPcs = (t: number) => refPcs(chordAt(c.chords, t)!).map(mod12);

      it("layers keep the harmonic rhythm: the same changes at the same moments, the same length", () => {
        for (const id of LAYERS) {
          const out = harmonize(input(c, "chords", id, "chords")).chords!;
          const b = bounds(out);
          expect(b.total, id).toBe(src.total);
          if (id === "pad") for (const s of b.starts) expect(src.starts, id).toContain(s);
          else expect(b.starts, id).toEqual(src.starts);
          // rests stay rests
          out.forEach((ch, i) => id !== "pad" && expect(!!ch.rest, id).toBe(!!c.chords[i].rest));
        }
      });

      it("re-harmonisations keep every change of the source and its length", () => {
        for (const id of INSTEAD) {
          const out = harmonize(input(c, "chords", id, "chords")).chords!;
          const b = bounds(out);
          expect(b.total, id).toBe(src.total);
          for (const s of src.starts) expect(b.starts, id).toContain(s);
        }
      });

      it("same chords for pad, higher and shell; smooth keeps each chord's notes, only its bass moves", () => {
        for (const id of ["pad", "higher", "shell", "smooth"]) {
          const out = harmonize(input(c, "chords", id, "chords")).chords!;
          let at = 0;
          for (const ch of out) {
            if (!ch.rest) {
              const want = srcPcs(at * TICKS).sort();
              expect([...new Set(refPcs(ch.ref).map(mod12))].sort(), `${id} at ${at}`).toEqual([...new Set(want)].sort());
              expect(pc(ch.ref.root)).toBe(pc(chordAt(c.chords, at * TICKS)!.root));
            }
            at += ch.beats;
          }
        }
      });

      it("colour adds a tone that fits the key and the chord's job, never an avoid note", () => {
        const out = harmonize(input(c, "chords", "colour", "chords")).chords!;
        let at = 0;
        for (const ch of out) {
          if (!ch.rest) {
            const old = srcPcs(at * TICKS);
            const now = refPcs(ch.ref).map(mod12);
            for (const p of old) expect(now, `colour at ${at}`).toContain(p);
            for (const p of now.filter((x) => !old.includes(x))) {
              expect(keyPcs(c.key).includes(p) || c.chords.some((x) => !x.rest && refPcs(x.ref).map(mod12).includes(p)), `colour ${p} at ${at}`).toBe(true);
              // a minor ninth over a chord tone is the avoid note
              for (const o of old) expect(mod12(p - o), `avoid at ${at}`).not.toBe(1);
            }
          }
          at += ch.beats;
        }
        expect(sym(out)).not.toBe(sym(c.chords));
      });

      it("sus keeps the root and the 5th and puts a 2nd or 4th for the 3rd, inside the scale", () => {
        const out = harmonize(input(c, "chords", "sus", "chords")).chords!;
        let at = 0;
        for (const ch of out) {
          if (!ch.rest) {
            const old = chordAt(c.chords, at * TICKS)!;
            expect(pc(ch.ref.root)).toBe(pc(old.root));
            if (ch.ref.typeId !== old.typeId) {
              expect(ch.ref.typeId).toMatch(/sus/);
              for (const p of refPcs(ch.ref).map(mod12)) expect(fits(c, at * TICKS, p + 60)).toBe(true);
            }
          }
          at += ch.beats;
        }
      });

      it("relative swap shares two notes with each chord it replaces", () => {
        const out = harmonize(input(c, "chords", "relative", "chords")).chords!;
        let at = 0;
        for (const ch of out) {
          if (!ch.rest) {
            const old = srcPcs(at * TICKS);
            const shared = refPcs(ch.ref).map(mod12).filter((p) => old.includes(p)).length;
            expect(shared, `relative at ${at}`).toBeGreaterThanOrEqual(2);
          }
          at += ch.beats;
        }
      });

      it("pedal holds home or its fifth in the bass under every chord", () => {
        const out = harmonize(input(c, "chords", "pedal", "chords")).chords!;
        const basses = new Set(out.filter((x) => !x.rest).map((x) => pc(x.ref.bass ?? x.ref.root)));
        expect(basses.size).toBe(1);
        expect([pc(c.key.tonic), mod12(pc(c.key.tonic) + 7)]).toContain([...basses][0]);
      });

      it("borrowed chords come from the parallel key, tritone swaps are dominants a tritone away", () => {
        const borrowed = harmonize(input(c, "chords", "borrowed", "chords")).chords!;
        const parallel = new Set(["aeolian", "ionian", "harmonicMinor", "dorian", "mixolydian"].flatMap((id) => scalePcs(pc(c.key.tonic), getScale(id))));
        for (const ch of borrowed) if (!ch.rest) for (const p of refPcs(ch.ref)) expect(parallel.has(mod12(p))).toBe(true);
        const tri = harmonize(input(c, "chords", "tritone", "chords")).chords!;
        let at = 0;
        for (const ch of tri) {
          const old = chordAt(c.chords, at * TICKS);
          if (old && !ch.rest && ch.ref.typeId !== old.typeId) {
            expect(ch.ref.typeId).toBe("7");
            expect(mod12(pc(ch.ref.root) - pc(old.root))).toBe(6);
          }
          at += ch.beats;
        }
      });
    });

  it("lead-ins put the dominant 7th of the next chord in the second half of a long chord", () => {
    const out = harmonize({ kind: "chords", option: "lead-in", source: { chords: P("C Am F G") }, key: C, bar: 4, bars: 4 }).chords!;
    // C → E7 → Am, Am → C7 → F, F → D7 → G: each the V7 of the chord it leads into
    expect(sym(out)).toBe("C:maj@2 E:7@2 A:min@2 C:7@2 F:maj@2 D:7@2 G:maj@4");
  });

  it("passing diminished chords slide up into the next chord a step above", () => {
    const out = harmonize({ kind: "chords", option: "passing", source: { chords: P("C Dm Em F") }, key: C, bar: 4, bars: 4 }).chords!;
    expect(sym(out)).toContain("C#:dim7@2");
    expect(sym(out)).toContain("D#:dim7@2");
  });

  it("the tritone swap turns G7 before C into D♭7", () => {
    const out = harmonize({ kind: "chords", option: "tritone", source: { chords: P("Dm7 G7 Cmaj7:8") }, key: C, bar: 4, bars: 4 }).chords!;
    expect(sym(out)).toBe("D:m7@4 Db:7@4 C:maj7@8");
  });

  it("borrows iv, ♭VI and ♭VII in a major key, and a major IV in a minor one", () => {
    const maj = harmonize({ kind: "chords", option: "borrowed", source: { chords: P("C F Am G") }, key: C, bar: 4, bars: 4 }).chords!;
    expect(sym(maj)).toContain("F:min");
    const min = harmonize({ kind: "chords", option: "borrowed", source: { chords: P("Am Dm Em Am") }, key: Am, bar: 4, bars: 4 }).chords!;
    expect(sym(min)).toMatch(/D:maj|E:maj/);
  });

  it("the swaps are checked against the tune: a clash with a strong melody note is not offered", () => {
    // over A in the tune, F minor (A♭) would be a cross-relation: the F chord stays
    const tune = M([[4, 69], [6, 69]], 4);
    const out = harmonize({ kind: "chords", option: "borrowed", source: { chords: P("C F G C"), melody: tune }, key: C, bar: 4, bars: 4 }).chords!;
    expect(out[1].ref.typeId).toBe("maj");
  });
});

describe("chord harmony from a melody", () => {
  for (const c of CASES)
    it(`${c.name}: chords chosen to carry the tune`, () => {
      const out = harmonize(input(c, "chords", "fit", "melody")).chords!;
      expect(out.length).toBeGreaterThan(0);
      expect(bounds(out).total).toBe(c.bars * c.bar);
      // chords change on the bar or a strong beat, never in the middle of a beat
      for (const s of bounds(out).starts) expect(strong(s, c.bar), `change at ${s / TICKS}`).toBe(true);
      // most strong melody notes are notes of the chord chosen under them
      const tune = melodyLine(c.tune, len(c)).filter((n) => strong(n.at, c.bar));
      const held = tune.filter((n) => refPcs(chordAt(out, n.at)!).map(mod12).includes(mod12(n.midi))).length;
      expect(held / tune.length, sym(out)).toBeGreaterThanOrEqual(0.7);
      // starts and ends at home when the tune does
      const first = out[0].ref;
      expect([pc(c.key.tonic), mod12(pc(c.key.tonic) + 7), mod12(pc(c.key.tonic) + 5), mod12(pc(c.key.tonic) + 9), mod12(pc(c.key.tonic) + 8)]).toContain(pc(first.root));
    });

  it("C–E–G and G–B–D in the tune get C and G", () => {
    const out = harmonize({ kind: "chords", option: "fit", source: { melody: M([[0, 60], [1, 64], [2, 67], [4, 67], [5, 71], [6, 74], [8, 72], [10, 64], [12, 67], [13, 65], [14, 62], [15, 71]]) }, key: C, bar: 4, bars: 4 }).chords!;
    expect(sym(out).split(" ")[0]).toMatch(/^C:maj/);
    expect(sym(out)).toMatch(/G:(maj|7)/);
  });

  it("brings in a borrowed chord only where the tune asks for one", () => {
    const out = harmonize({ kind: "chords", option: "fit", source: { melody: M([[0, 60], [2, 64], [4, 68], [5, 65], [6, 60], [8, 67], [10, 71], [12, 72]]) }, key: C, bar: 4, bars: 4 }).chords!;
    // the A♭ in bar 2 is held by F minor (or A♭); the rest stays in the key
    const bar2 = chordAt(out, 4 * TICKS)!;
    expect(refPcs(bar2).map(mod12)).toContain(8);
    expect(refPcs(chordAt(out, 0)!).map(mod12).every((p) => keyPcs(C).includes(p))).toBe(true);
  });

  it("every layer option also works from a melody alone (chords are chosen first)", () => {
    const c = CASES[0];
    for (const o of CHORD_HARMONY) {
      const out = harmonize(input(c, "chords", o.id, "melody")).chords!;
      expect(out.length, o.id).toBeGreaterThan(0);
      expect(bounds(out).total, o.id).toBe(c.bars * c.bar);
    }
  });
});

// ── Edge cases ────────────────────────────────────────────────

describe("edge cases", () => {
  it("an empty source gives an empty track, not an error", () => {
    for (const o of HARMONY_OPTIONS) {
      const out = harmonize({ kind: o.kind, option: o.id, source: {}, key: C, bar: 4, bars: 4 });
      if (o.kind === "melody") expect(out.melody!.notes).toEqual([]);
      else expect(out.chords).toEqual([]);
      const out2 = harmonize({ kind: o.kind, option: o.id, source: { chords: [], melody: { div: 2, bars: 4, notes: [] } }, key: C, bar: 4, bars: 4 });
      if (o.kind === "melody") expect(out2.melody!.notes).toEqual([]);
      else expect(out2.chords).toEqual([]);
    }
  });

  it("an unknown option, or one for the other kind, gives nothing", () => {
    expect(harmonize({ kind: "melody", option: "nope", source: { melody: CASES[0].tune }, key: C, bar: 4, bars: 4 })).toEqual({});
    expect(harmonize({ kind: "melody", option: "pad", source: { melody: CASES[0].tune }, key: C, bar: 4, bars: 4 })).toEqual({});
  });

  it("all rests: nothing to harmonise", () => {
    for (const o of HARMONY_OPTIONS) {
      const out = harmonize({ kind: o.kind, option: o.id, source: { chords: P("-:8 -:8") }, key: C, bar: 4, bars: 4 });
      if (o.kind === "melody") expect(out.melody!.notes, o.id).toEqual([]);
      else expect((out.chords ?? []).every((c) => c.rest), o.id).toBe(true);
    }
  });

  it("one chord, one note", () => {
    for (const o of HARMONY_OPTIONS) {
      const a = harmonize({ kind: o.kind, option: o.id, source: { melody: M([[0, 67]], 1) }, key: C, bar: 4, bars: 1 });
      const b = harmonize({ kind: o.kind, option: o.id, source: { chords: P("C") }, key: C, bar: 4, bars: 1 });
      expect(a.melody ?? a.chords, o.id).toBeDefined();
      expect(b.melody ?? b.chords, o.id).toBeDefined();
    }
    expect(harmonize({ kind: "melody", option: "third-above", source: { melody: M([[0, 67]], 1) }, key: C, bar: 4, bars: 1 }).melody!.notes.length).toBe(1);
    expect(sym(harmonize({ kind: "chords", option: "fit", source: { melody: M([[0, 67]], 1) }, key: C, bar: 4, bars: 1 }).chords)).toBe("C:maj@4");
  });

  it("broken input (unknown chord types, no length, notes past the end) is ignored, not thrown", () => {
    const bad: ProgChord[] = [
      { id: "a", ref: { root: "C", typeId: "nope" }, beats: 4 },
      { id: "b", ref: { root: "H", typeId: "maj" }, beats: 4 },
      { id: "c", ref: { root: "G", typeId: "maj" }, beats: NaN },
      { id: "d", ref: { root: "F", typeId: "maj" }, beats: 4 },
    ];
    const tune = { div: 2 as const, bars: 2, notes: [{ at: 0, midi: 60 }, { at: 9999, midi: 64 }, { at: NaN, midi: 62 }, { at: 24, midi: NaN }] };
    for (const o of HARMONY_OPTIONS) {
      expect(() => harmonize({ kind: o.kind, option: o.id, source: { chords: bad }, key: C, bar: 4, bars: 2 }), o.id).not.toThrow();
      expect(() => harmonize({ kind: o.kind, option: o.id, source: { melody: tune }, under: bad, key: C, bar: 4, bars: 2 }), o.id).not.toThrow();
      expect(() => harmonize({ kind: o.kind, option: o.id, source: { melody: tune }, key: C, bar: NaN, bars: 0 }), o.id).not.toThrow();
    }
  });

  it("works in every mode and scale family the app offers", () => {
    const ids = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian", "harmonicMinor", "melodicMinor", "majorPentatonic", "minorPentatonic", "blues"];
    for (const scaleId of ids) {
      if (!getScaleSafe(scaleId)) continue;
      const key = { tonic: "D", scaleId };
      const notes = scalePcs(pc("D"), keyScale(key));
      const tune = M(notes.slice(0, 5).map((p, i) => [i, 62 + mod12(p - 2)] as [number, number]), 2);
      for (const o of HARMONY_OPTIONS) {
        const out = harmonize({ kind: o.kind, option: o.id, source: { melody: tune }, key, bar: 4, bars: 2 });
        if (o.kind === "melody") for (const n of out.melody!.notes) expect(Number.isInteger(n.midi), `${scaleId} ${o.id}`).toBe(true);
        else for (const ch of out.chords!) expect(CHORD_TYPES.some((t) => t.id === ch.ref.typeId), `${scaleId} ${o.id} ${ch.ref.typeId}`).toBe(true);
      }
    }
  });

  it("is the same for the same seed", () => {
    for (const c of CASES.slice(0, 4))
      for (const o of HARMONY_OPTIONS) {
        for (const from of ["melody", "chords"] as const) {
          const a = harmonize(input(c, o.kind, o.id, from, 7));
          const b = harmonize(input(c, o.kind, o.id, from, 7));
          expect(a, `${c.name} ${o.id} ${from}`).toEqual(b);
        }
      }
  });

  it("never changes its input", () => {
    const c = CASES[2];
    const chords = structuredClone(c.chords);
    const tune = structuredClone(c.tune);
    for (const o of HARMONY_OPTIONS) harmonize({ kind: o.kind, option: o.id, source: { chords, melody: tune }, under: chords, key: c.key, bar: 4, bars: 4 });
    expect(chords).toEqual(c.chords);
    expect(tune).toEqual(c.tune);
  });

  it("gives every new chord a fresh id", () => {
    const out = harmonize(input(CASES[0], "chords", "lead-in", "chords")).chords!;
    const ids = out.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(CASES[0].chords.map((c) => c.id)).not.toContain(id);
  });

  it("a melody harmony in 6/8 sits on the triplet grid", () => {
    const c = CASES[3];
    for (const o of MELODY_HARMONY) {
      const out = harmonize(input(c, "melody", o.id, "melody")).melody!;
      expect(out.div, o.id).toBe(3);
      for (const n of out.notes) expect(n.at % 4, o.id).toBe(0);
    }
  });
});

// ── Musical checks found in review ────────────────────────────

describe("the lines a musician would expect", () => {
  it("chord notes: chord tones of the chord under them, never a 2nd, 7th or tritone with the tune", () => {
    for (const [tune, under, key] of [[M([[0, 72], [1, 76], [2, 79]], 1), P("C"), C], [M([[0, 69]], 1), P("Adim"), { tonic: "Bb", scaleId: "ionian" }], [M([[0, 72]], 1), P("Eb"), { tonic: "Ab", scaleId: "ionian" }]] as const) {
      const out = harmonize({ kind: "melody", option: "chord-tones", source: { melody: tune }, under, key, bar: 4, bars: 1 }).melody!;
      expect(out.notes.length).toBeGreaterThan(0);
      for (const h of out.notes) {
        expect(refPcs(under[0].ref).map(mod12)).toContain(mod12(h.midi));
        const n = sounding(melodyLine(tune, 4 * TICKS), h.at);
        if (n !== null) expect([1, 11, 6]).not.toContain(ic(h.midi, n));
      }
    }
  });

  it("a harmony under a low tune goes under it (the range reaches a sixth below the tune's lowest note)", () => {
    const tune = M([[0, 48], [2, 52], [4, 53], [6, 57], [8, 55], [10, 59], [12, 60]]);
    for (const id of ["third-below", "sixth-below"]) {
      const out = harmonize({ kind: "melody", option: id, source: { melody: tune }, under: P("C F G C"), key: C, bar: 4, bars: 4, shape: PAIR }).melody!;
      out.notes.forEach((h, i) => expect(h.midi, `${id} at ${h.at / TICKS}`).toBeLessThan(tune.notes[i].midi));
      for (const h of out.notes) expect(h.midi).toBeGreaterThanOrEqual(36);
    }
  });

  it("a counter-line stays consonant when the tune sits on a colour note (no chord note fits: a tension does)", () => {
    // the tune holds G over F (its 9th), then A over G (its 9th): C under G then D under A would be
    // parallel fifths, and every other chord note clashes, so a tension is used instead
    const tune = M([[0, 72], [1, 71], [1.5, 69], [2, 67], [8, 69], [9, 71], [10, 72]]);
    const notes = harmonize({ kind: "melody", option: "counter", source: { melody: tune }, under: P("C F G C"), key: C, bar: 4, bars: 4 }).melody!.notes;
    const line = melodyLine(tune, 16 * TICKS);
    for (let t = 0; t < 16 * TICKS; t += TICKS) {
      if (!strong(t, 4)) continue;
      const a = sounding(notes, t);
      const b = sounding(line, t);
      if (a !== null && b !== null) expect(CONSONANT, `beat ${t / TICKS}: ${b}/${a}`).toContain(ic(a, b));
    }
    // and the tune starting low in its range still gets a consonance on the line's own side
    const low = harmonize({ kind: "melody", option: "counter", source: { melody: M([[0, 67], [2, 79], [4, 82], [6, 84], [8, 82], [10, 79], [12, 84], [14, 82]]) }, under: P("Eb Ab Bb Eb"), key: { tonic: "Eb", scaleId: "ionian" }, bar: 4, bars: 4 }).melody!;
    expect(CONSONANT).toContain(ic(low.notes[0].midi, 67));
    expect(low.notes[0].midi).toBeLessThan(67);
  });

  it("an answer starts on a new note and echoes as much of the last phrase as fits the gap", () => {
    const tune = M([[0, 72], [1, 71], [1.5, 69], [2, 67], [8, 69], [9, 71], [10, 72]]);
    const out = harmonize({ kind: "melody", option: "answer", source: { melody: tune }, under: P("C F G C"), key: C, bar: 4, bars: 4 }).melody!;
    // the phrase comes back in the gap after it (as much of it as fits)
    expect(out.notes.filter((n) => n.at > 2 * TICKS && n.at < 8 * TICKS).length).toBeGreaterThanOrEqual(2);
    // where no two notes fit, a run of chord notes answers, starting on a note other than the one just sung
    const d = { tonic: "D", scaleId: "ionian" };
    const tune2 = M([[0, 66], [1, 69], [2, 74], [3, 73], [5, 71], [7, 74], [10, 71], [12, 67], [15, 69], [17, 73]]);
    const out2 = harmonize({ kind: "melody", option: "answer", source: { melody: tune2 }, under: P("D:5 Bm:5 G:5 A:5"), key: d, bar: 5, bars: 4 }).melody!;
    const line2 = melodyLine(tune2, 20 * TICKS);
    let gaps = 0;
    for (const n of out2.notes) {
      const before = line2.filter((x) => x.at < n.at).pop()!;
      const prev = out2.notes.filter((x) => x.at < n.at && x.at > before.at);
      if (!prev.length) {
        gaps++;
        expect(n.midi, `answer at ${n.at / TICKS}`).not.toBe(before.midi);
      }
    }
    expect(gaps).toBeGreaterThanOrEqual(3);
  });

  it("an answer in 6/8, 9/8 or 12/8 moves in triplet eighths, on the triplet grid", () => {
    const tune = M([[0, 71], [2 / 3, 72], [4 / 3, 71], [2, 67], [4, 72], [5, 71], [6, 69], [8, 67], [9, 71], [10, 74], [12, 74], [13, 72], [14, 71]], 4, 3);
    const out = harmonize({ kind: "melody", option: "answer", source: { melody: tune }, under: P("Em C G D"), key: { tonic: "E", scaleId: "aeolian" }, bar: 4, bars: 4, compound: true }).melody!;
    expect(out.notes.length).toBeGreaterThan(0);
    expect(out.div).toBe(3);
    for (const n of out.notes) expect(n.at % 4).toBe(0);
  });
});

describe("chords slipped in fall on a beat", () => {
  const cuts = (chords: ProgChord[]) => bounds(chords).starts.map((t) => t / TICKS);
  it("3/4 splits 2+1, 5/4 3+2, 7/4 4+3, 4/4 2+2", () => {
    expect(sym(harmonize({ kind: "chords", option: "lead-in", source: { chords: P("G:3 C:3 D7:3 G:3") }, key: { tonic: "G", scaleId: "ionian" }, bar: 3, bars: 4 }).chords)).toBe("G:maj@3 C:maj@2 A:7@1 D:7@3 G:maj@3");
    expect(sym(harmonize({ kind: "chords", option: "passing", source: { chords: P("D:5 Bm:5 G:5 A:5") }, key: { tonic: "D", scaleId: "ionian" }, bar: 5, bars: 4 }).chords)).toContain("G:maj@3 G#:dim7@2");
    expect(sym(harmonize({ kind: "chords", option: "lead-in", source: { chords: P("C:7 Am:7") }, key: C, bar: 7, bars: 2 }).chords)).toBe("C:maj@4 E:7@3 A:min@7");
    expect(sym(harmonize({ kind: "chords", option: "lead-in", source: { chords: P("C Am") }, key: C, bar: 4, bars: 2 }).chords)).toBe("C:maj@2 E:7@2 A:min@4");
  });
  it("never between beats, in any meter", () => {
    for (const bar of [2, 3, 4, 5, 6, 7])
      for (const id of ["lead-in", "passing"]) {
        const src = P("C Dm Em F G Am", bar);
        for (const t of cuts(harmonize({ kind: "chords", option: id, source: { chords: src }, key: C, bar, bars: 6 }).chords!)) expect(Number.isInteger(t), `${id} in ${bar}: ${t}`).toBe(true);
      }
  });
});

describe("chord layers written from a melody", () => {
  it("sit on the song's own chords when the section has some (so the layer sounds with them)", () => {
    const c = CASES[0];
    for (const id of ["pad", "higher", "shell", "colour", "sus", "pedal"]) {
      const out = harmonize({ kind: "chords", option: id, source: { melody: c.tune }, under: c.chords, key: c.key, bar: 4, bars: 4 }).chords!;
      let at = 0;
      for (const ch of out) {
        if (!ch.rest) expect(pc(ch.ref.root), `${id} at ${at}`).toBe(pc(chordAt(c.chords, at * TICKS)!.root));
        at += ch.beats;
      }
    }
  });
  it("best fit uses V7 where the tune sings the key's 4th over V", () => {
    const out = harmonize({ kind: "chords", option: "fit", source: { melody: M([[0, 60], [1, 64], [2, 67], [4, 67], [5, 71], [6, 65], [7, 74], [8, 72]], 3) }, key: C, bar: 4, bars: 3 }).chords!;
    expect(sym(out)).toContain("G:7");
  });
  it("relative swap never turns V into vii° by chance", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const out = harmonize({ kind: "chords", option: "relative", source: { chords: P("D Bm G A") }, key: { tonic: "D", scaleId: "ionian" }, bar: 4, bars: 4, seed }).chords!;
      expect(out[3].ref.typeId, `seed ${seed}`).not.toBe("dim");
    }
  });
});

describe("random tunes over random progressions", () => {
  const KEYS: Key[] = [C, Am, { tonic: "D", scaleId: "dorian" }, { tonic: "G", scaleId: "mixolydian" }, { tonic: "E", scaleId: "phrygian" }, { tonic: "F", scaleId: "lydian" }, { tonic: "Bb", scaleId: "ionian" }, { tonic: "B", scaleId: "harmonicMinor" }];
  const METERS = [{ bar: 4 }, { bar: 3 }, { bar: 2, compound: true }, { bar: 4, compound: true }, { bar: 5 }, { bar: 7 }];
  it("third, sixth and chord-tone lines never clash with the tune on a strong note; counter-lines are consonant there with no parallels; everything sits on the grid", () => {
    const rng = seededRng(2026);
    for (let it = 0; it < 120; it++) {
      const key = KEYS[it % KEYS.length];
      const { bar, compound } = METERS[Math.floor(rng() * METERS.length)];
      const bars = 2 + Math.floor(rng() * 3);
      const diat = diatonicChords(key, rng() < 0.3 ? 4 : 3).filter((c) => !c.type.synthetic);
      const chords: ProgChord[] = Array.from({ length: bars }, (_, i) => ({ id: "c" + i, ref: diat[Math.floor(rng() * diat.length)].ref, beats: bar }));
      const scale = scalePcs(pc(key.tonic), keyScale(key));
      const ladder: number[] = [];
      for (let m = 55; m <= 81; m++) if (scale.includes(mod12(m))) ladder.push(m);
      const div = compound ? 3 : 2;
      const notes: { at: number; midi: number }[] = [];
      let idx = Math.floor(ladder.length / 2);
      for (let t = 0; t < bars * bar * TICKS; t += TICKS / div)
        if (rng() < (t % TICKS === 0 ? 0.6 : 0.25)) {
          idx = Math.max(0, Math.min(ladder.length - 1, idx + Math.round((rng() - 0.5) * 5)));
          notes.push({ at: t, midi: ladder[idx] });
        }
      if (!notes.length) continue;
      const tune: Melody = { div: div as Melody["div"], bars, notes };
      const len = bars * bar * TICKS;
      const line = melodyLine(tune, len);
      const tag = `${key.tonic} ${key.scaleId} ${bar}${compound ? "c" : ""} #${it}`;
      const run = (option: string, shape?: Shape) => harmonize({ kind: "melody", option, source: { melody: tune }, under: chords, key, bar, bars, compound, seed: it, ...(shape ? { shape } : {}) }).melody!;
      for (const id of ["third-above", "third-below", "sixth-below"]) {
        const out = run(id, PAIR);
        out.notes.forEach((h, i) => {
          const n = line[i];
          if (beatStrength(n.at, bar) >= 2 || n.end - n.at > TICKS) expect(CONSONANT, `${tag} ${id} at ${n.at / TICKS}: ${n.midi}/${h.midi}`).toContain(ic(h.midi, n.midi));
          if (i > 0) expect(parallelPerfect(line[i - 1].midi, out.notes[i - 1].midi, n.midi, h.midi), `${tag} ${id} parallel at ${n.at / TICKS}`).toBe(false);
        });
      }
      const counter = run("counter").notes;
      for (let t = 0; t < len; t += TICKS / div) {
        if (!strong(t, bar)) continue;
        // (a note struck there; one held over from before may be a suspension, dissonant on purpose)
        const a = counter.find((x) => x.at === t)?.midi ?? null;
        const b = sounding(line, t);
        if (a !== null && b !== null) expect(CONSONANT, `${tag} counter at ${t / TICKS}: ${b}/${a}`).toContain(ic(a, b));
      }
      const moments = [...new Set([...counter.map((n) => n.at), ...line.map((n) => n.at)])].sort((a, b) => a - b);
      for (let i = 1; i < moments.length; i++) {
        const [a1, b1, a2, b2] = [sounding(counter, moments[i - 1]), sounding(line, moments[i - 1]), sounding(counter, moments[i]), sounding(line, moments[i])];
        if (a1 !== null && b1 !== null && a2 !== null && b2 !== null) expect(parallelPerfect(b1, a1, b2, a2), `${tag} counter parallel at ${moments[i] / TICKS}`).toBe(false);
      }
      for (const o of MELODY_HARMONY) {
        const out = run(o.id);
        if (compound) expect([1, 3], `${tag} ${o.id}`).toContain(out.div);
        for (const n of out.notes) expect(n.at % (TICKS / out.div), `${tag} ${o.id} grid`).toBe(0);
      }
    }
  });
});

function getScaleSafe(id: string) {
  try {
    return getScale(id);
  } catch {
    return null;
  }
}
