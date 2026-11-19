import { describe, expect, it } from "vitest";
import {
  HAND_MAX,
  KEY_STYLES,
  LEFT_TENTH,
  MAX_KEYS,
  REGISTERS,
  arrangeKeys,
  chordTones,
  keyCandidates,
  keyStyleOf,
  lowIntervalOk,
  matchVoices,
  moveCost,
  outerOk,
  parallelPerfects,
  pianoVoicing,
  playable,
  rubs,
  splitHands,
  totalMoveCost,
  totalMovement,
  voicingDistance,
  type KeyStyle,
} from "./voicing";
import { CHORD_TYPES, type ChordRef } from "../theory/chords";
import { mod12, pc } from "../theory/notes";
import { parseInterval, semitonesOf } from "../theory/intervals";

const ref = (root: string, typeId: string, bass?: string): ChordRef => ({ root, typeId, ...(bass ? { bass } : {}) });
const pcsOf = (v: number[]) => new Set(v.map(mod12));
const ascending = (v: number[]) => v.every((m, i) => i === 0 || m > v[i - 1]);

/** The tones a chord can't do without on a keyboard: its root (or slash bass), its 3rd-or-what-stands-for-it and its 7th or 6th. */
function mustHave(r: ChordRef): number[] {
  const t = chordTones(r);
  return [...new Set([t.root, ...t.guides])];
}

const ROOTS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

describe("piano voicings, chord by chord", () => {
  for (const style of KEY_STYLES)
    it(`${style}: every library chord on every root holds its needed tones, nothing muddy, inside the register, at most eight keys`, () => {
      for (const reg of Object.values(REGISTERS))
        for (const root of ROOTS)
          for (const t of CHORD_TYPES) {
            const r = ref(root, t.id);
            const v = pianoVoicing(r, { style, low: reg.low, high: reg.high });
            const label = `${style} ${root}${t.symbol} ${reg.low}-${reg.high}: ${v.join(",")}`;
            expect(v.length, label).toBeGreaterThan(0);
            expect(v.length, label).toBeLessThanOrEqual(MAX_KEYS);
            expect(ascending(v), label).toBe(true);
            for (const p of mustHave(r)) expect(pcsOf(v).has(p), `${label} needs ${p}`).toBe(true);
            // every note is a note of the chord
            const chordPcs = new Set(t.intervals.map((iv) => mod12(pc(root) + semitonesOf(iv))));
            for (const m of v) expect(chordPcs.has(mod12(m)), label).toBe(true);
            expect(lowIntervalOk(v), label).toBe(true);
            expect(v[0], label).toBeGreaterThanOrEqual(reg.low - 6);
            expect(v[v.length - 1], label).toBeLessThanOrEqual(reg.high + 6);
            expect(playable(v), label).toBe(true);
          }
    });

  it("no semitone between the two top or the two bottom keys, and never a colour tone (9th, 11th, 13th) in the bass", () => {
    for (const style of KEY_STYLES)
      for (const reg of Object.values(REGISTERS))
        for (const root of ROOTS)
          for (const t of CHORD_TYPES) {
            const v = pianoVoicing(ref(root, t.id), { style, low: reg.low, high: reg.high });
            const label = `${style} ${root}${t.symbol} ${reg.low}-${reg.high}: ${v.join(",")}`;
            expect(outerOk(v), label).toBe(true);
            const bass = t.intervals.find((iv) => mod12(pc(root) + semitonesOf(iv)) === mod12(v[0]));
            if (bass) expect(parseInterval(bass).number, label).toBeLessThan(8);
          }
    // the textbook cases: B♭13 never ends on G under A♭, E7♭9 never stands on F
    expect(rubs([60, 61])).toBe(1);
    expect(outerOk([58, 62, 67, 68])).toBe(false);
    expect(outerOk([52, 53, 56, 59, 62])).toBe(false);
    for (const style of KEY_STYLES) expect(mod12(pianoVoicing(ref("E", "7b9"), { style })[0]), style).not.toBe(5);
  });

  it("an eleventh chord is voiced without its 3rd (the 11th a semitone above it is the avoid note)", () => {
    for (const style of ["open", "drop2", "shell"] as KeyStyle[]) {
      const v = pianoVoicing(ref("C", "11"), { style });
      expect(pcsOf(v).has(4), style).toBe(false);
      expect(pcsOf(v).has(5), style).toBe(true);
      expect(pcsOf(v).has(10), style).toBe(true);
    }
  });

  it("a triad keeps all three notes in every style but the shell, and the shell keeps root, 3rd and 7th", () => {
    for (const style of KEY_STYLES) {
      const v = pianoVoicing(ref("C", "maj"), { style });
      expect(pcsOf(v), style).toEqual(new Set([0, 4, 7]));
    }
    const shell = pianoVoicing(ref("G", "7"), { style: "shell" });
    expect(pcsOf(shell)).toEqual(new Set([7, 11, 5]));
    expect(mod12(shell[0])).toBe(7);
  });

  it("builds the textbook shapes: close C E G B, drop 2 with the 5th dropped, shells and a spread left hand", () => {
    const cands = (style: KeyStyle) => keyCandidates(ref("C", "maj7"), { style, low: 40, high: 84 }).map((v) => v.join(","));
    expect(cands("close")).toContain("60,64,67,71");
    expect(cands("drop2")).toContain("55,60,64,71");
    expect(cands("shell")).toContain("48,52,59");
    expect(cands("shell")).toContain("48,59,64");
    expect(cands("open")).toContain("48,55,64,71");
    // spread: root (and 5th, 7th or 10th) in the left hand, the rest close in the right
    expect(cands("spread").some((v) => v.startsWith("48,") || v.startsWith("36,"))).toBe(true);
    for (const v of keyCandidates(ref("C", "maj7"), { style: "spread", low: 40, high: 84 })) expect(v[v.length - 1] - v[0]).toBeGreaterThan(12);
    for (const v of keyCandidates(ref("C", "maj7"), { style: "close", low: 40, high: 84 })) expect(v[v.length - 1] - v[0]).toBeLessThan(12);
  });

  it("puts a slash chord's bass at the bottom", () => {
    for (const style of KEY_STYLES) {
      const v = pianoVoicing(ref("C", "maj", "E"), { style });
      expect(mod12(v[0]), style).toBe(4);
      const w = pianoVoicing(ref("D", "m7", "C"), { style });
      expect(mod12(w[0]), style).toBe(0);
      expect(lowIntervalOk(w), style).toBe(true);
    }
  });

  it("never voices close seconds or thirds low down", () => {
    expect(lowIntervalOk([36, 40, 43])).toBe(false); // a third on C2 rumbles
    expect(lowIntervalOk([36, 43, 52])).toBe(false); // even a fifth is muddy under E2
    expect(lowIntervalOk([36, 48, 55, 64])).toBe(true); // an octave, then a fifth and a sixth
    expect(lowIntervalOk([45, 48])).toBe(false); // a minor third under B2
    expect(lowIntervalOk([50, 53])).toBe(true);
    expect(lowIntervalOk([50, 51])).toBe(false); // a semitone under E3
    expect(lowIntervalOk([60, 61, 62])).toBe(true); // a cluster in the middle is a choice, not mud
    for (const v of keyCandidates(ref("E", "m7"), { style: "close", low: 28, high: 60 })) expect(lowIntervalOk(v)).toBe(true);
  });

  it("keeps the register, widening it only when a style cannot fit", () => {
    for (const style of KEY_STYLES)
      for (const t of ["maj", "m7", "7", "maj9", "13"]) {
        const v = pianoVoicing(ref("F", t), { style, low: 60, high: 84 });
        expect(v[0], `${style} ${t}`).toBeGreaterThanOrEqual(54);
        expect(v[v.length - 1], `${style} ${t}`).toBeLessThanOrEqual(90);
      }
    // a register too narrow for anything still gives the chord
    const v = pianoVoicing(ref("C", "13"), { low: 60, high: 62 });
    expect(v.length).toBeGreaterThan(0);
  });

  it("leads from the chord before when given one", () => {
    const prev = [60, 64, 67];
    const v = pianoVoicing(ref("F", "maj"), { style: "close", prev });
    // C E G → C F A: the C is held
    expect(v).toEqual([60, 65, 69]);
    const g = pianoVoicing(ref("G", "7"), { style: "close", prev: [60, 65, 69] });
    expect(voicingDistance([60, 65, 69], g)).toBeLessThanOrEqual(5);
  });

  it("is the same every time", () => {
    for (const style of KEY_STYLES) expect(pianoVoicing(ref("A", "m9"), { style })).toEqual(pianoVoicing(ref("A", "m9"), { style }));
  });
});

describe("voice leading between voicings", () => {
  it("matches voices bottom to bottom, splitting or merging when the counts differ", () => {
    expect(matchVoices([60, 64, 67], [60, 65, 69])).toEqual([[60, 60], [64, 65], [67, 69]]);
    const m = matchVoices([48, 60, 64, 67], [60, 65, 69]);
    expect(m.length).toBe(4);
    expect(m.map((x) => x[1])).toEqual([60, 60, 65, 69]);
    expect(voicingDistance([60, 64, 67], [60, 65, 69])).toBe(3);
  });

  it("counts parallel fifths and octaves between voices that both move", () => {
    expect(parallelPerfects([48, 55], [50, 57])).toBe(1);
    expect(parallelPerfects([48, 60], [50, 62])).toBe(1);
    expect(parallelPerfects([48, 55], [48, 57])).toBe(0);
    expect(parallelPerfects([60, 64, 67], [62, 65, 69])).toBe(1); // C–G to D–A in root position
    expect(parallelPerfects([60, 64, 67], [60, 65, 69])).toBe(0); // the C held
    // a fifth to a twelfth is still a parallel fifth
    expect(parallelPerfects([48, 55], [50, 69])).toBe(1);
  });

  it("charges held notes less than moving ones, and parallels a lot", () => {
    expect(moveCost([60, 64, 67], [60, 65, 69])).toBeLessThan(moveCost([60, 64, 67], [65, 69, 72]));
    expect(moveCost([48, 55, 64], [50, 57, 65])).toBeGreaterThan(10);
  });
});

describe("arranging a progression", () => {
  const PROGS: { name: string; chords: ChordRef[] }[] = [
    { name: "I vi IV V", chords: [ref("C", "maj"), ref("A", "min"), ref("F", "maj"), ref("G", "maj")] },
    { name: "ii V I in sevenths", chords: [ref("D", "m7"), ref("G", "7"), ref("C", "maj7"), ref("A", "7")] },
    { name: "minor with a borrowed turn", chords: [ref("A", "min"), ref("F", "maj7"), ref("C", "maj"), ref("E", "7"), ref("A", "min")] },
    { name: "slash bass line", chords: [ref("C", "maj"), ref("G", "maj", "B"), ref("A", "m7"), ref("F", "maj", "A"), ref("G", "sus4"), ref("G", "maj")] },
    { name: "colour", chords: [ref("Eb", "maj9"), ref("C", "m11"), ref("Ab", "maj7#11"), ref("Bb", "13")] },
  ];

  for (const style of KEY_STYLES)
    for (const p of PROGS)
      it(`${style}, ${p.name}: smoother than choosing each chord on its own`, () => {
        const opts = { style, ...REGISTERS.mid };
        const dp = arrangeKeys(p.chords, opts);
        // the naive way: each chord's own best voicing, chosen without looking at its neighbours
        const naive = p.chords.map((c) => pianoVoicing(c, opts));
        expect(dp.length).toBe(p.chords.length);
        expect(totalMoveCost(dp)).toBeLessThanOrEqual(totalMoveCost(naive) + 1e-9);
        p.chords.forEach((c, i) => {
          for (const q of mustHave(c)) expect(pcsOf(dp[i]).has(q), `${c.root}${c.typeId}`).toBe(true);
          expect(lowIntervalOk(dp[i])).toBe(true);
          expect(dp[i].length).toBeLessThanOrEqual(MAX_KEYS);
        });
      });

  it("moves far less than root-position chords for a pop progression", () => {
    const chords = PROGS[0].chords;
    const dp = arrangeKeys(chords, { style: "close" });
    const naive = chords.map((c) => pianoVoicing(c, { style: "close" }));
    expect(totalMovement(dp)).toBeLessThan(totalMovement(naive));
    expect(totalMovement(dp)).toBeLessThanOrEqual(10);
  });

  it("finds the textbook ii–V–I: a step or a held note in every voice", () => {
    const dp = arrangeKeys([ref("D", "m7"), ref("G", "7"), ref("C", "maj7")], { style: "close", low: 52, high: 76 });
    for (let i = 1; i < dp.length; i++) for (const [a, b] of matchVoices(dp[i - 1], dp[i])) expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
  });

  it("beats a greedy chain (each chord led from the last one) on total cost", () => {
    let wins = 0;
    for (const p of PROGS) {
      const dp = arrangeKeys(p.chords, { style: "drop2" });
      const greedy: number[][] = [];
      for (const c of p.chords) greedy.push(pianoVoicing(c, { style: "drop2", prev: greedy[greedy.length - 1] }));
      expect(totalMoveCost(dp)).toBeLessThanOrEqual(totalMoveCost(greedy) + 1e-9);
      if (totalMoveCost(dp) < totalMoveCost(greedy) - 1e-9) wins++;
    }
    // and on some it is strictly better: looking ahead pays
    expect(wins).toBeGreaterThanOrEqual(1);
  });

  it("skips rests and leads on across them", () => {
    const dp = arrangeKeys([ref("C", "maj"), null, ref("F", "maj"), undefined], { style: "close" });
    expect(dp[1]).toEqual([]);
    expect(dp[3]).toEqual([]);
    expect(dp[0].length).toBe(3);
    expect(voicingDistance(dp[0], dp[2])).toBeLessThanOrEqual(3);
    expect(arrangeKeys([], {})).toEqual([]);
    expect(arrangeKeys([null], {})).toEqual([[]]);
  });

  it("follows on from a voicing before the first chord", () => {
    const dp = arrangeKeys([ref("F", "maj")], { style: "close", prev: [60, 64, 67] });
    expect(dp[0]).toEqual([60, 65, 69]);
  });

  it("is quick enough for a long song", () => {
    const chords = Array.from({ length: 64 }, (_, i) => PROGS[i % PROGS.length].chords[i % 4] ?? ref("C", "maj"));
    const t0 = performance.now();
    arrangeKeys(chords, { style: "spread" });
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe("hands", () => {
  it("gives the left hand the bottom and the right hand the rest, each within reach", () => {
    const h = splitHands([36, 43, 52, 59, 62, 67]);
    expect(h.left[0]).toBe(36);
    expect([...h.left, ...h.right]).toEqual([36, 43, 52, 59, 62, 67]);
    expect(h.left[h.left.length - 1] - h.left[0]).toBeLessThanOrEqual(LEFT_TENTH);
    expect(h.right[h.right.length - 1] - h.right[0]).toBeLessThanOrEqual(HAND_MAX);
    expect(Math.max(...h.left)).toBeLessThan(Math.min(...h.right));
  });

  it("plays a small voicing high up with the right hand alone, low down with the left", () => {
    expect(splitHands([64, 67, 72])).toEqual({ left: [], right: [64, 67, 72] });
    expect(splitHands([40, 47, 52]).left.length).toBeGreaterThan(0);
    expect(splitHands([])).toEqual({ left: [], right: [] });
  });

  it("every spread voicing splits into two playable hands", () => {
    for (const t of ["maj7", "m9", "13", "7b9", "69"]) {
      const v = pianoVoicing(ref("D", t), { style: "spread", low: 36, high: 79 });
      const h = splitHands(v);
      expect(h.left.length + h.right.length).toBe(v.length);
      expect(h.left.length).toBeGreaterThan(0);
      expect(h.right.length).toBeGreaterThan(0);
      expect(playable(v)).toBe(true);
    }
  });

  it("maps a harmony layer's voicing word to a keyboard style", () => {
    expect(keyStyleOf("shell")).toBe("shell");
    expect(keyStyleOf(undefined)).toBe("close");
    expect(keyStyleOf("open")).toBe("open");
    expect(keyStyleOf("spread")).toBe("spread");
  });
});
