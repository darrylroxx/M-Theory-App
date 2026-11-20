/**
 * The listening review's findings, each held as a test, on the quality fixtures and the review's
 * own sections (./fixtures/harmony): what each harmony must never do, with Chords 1 on the guitar
 * and on the piano, at the middle of the controls and at their ends.
 */
import { describe, expect, it } from "vitest";
import { BUILT, REVIEW, type Built } from "./fixtures/harmony";
import { refPcs, runOn, voiceChords, type Voicer } from "./quality";
import { beatStrength, controlsFor, melodyLine, MIDDLE, type Level, type Shape } from "./harmonize";
import { mod12, pc } from "./notes";
import { fingerNotes } from "../guitar/finger";
import { getTuning } from "../guitar/tunings";
import { TICKS, type MelodyNote } from "../song/melody";
import type { ChordRef } from "./chords";

const ALL = [...BUILT, ...REVIEW];
const VOICERS: Voicer[] = ["guitar", "keys"];
const LV: Level[] = [0, 1, 2];
const SHAPES: Shape[] = LV.flatMap((busy) => LV.flatMap((wide) => LV.map((colour) => ({ busy, wide, colour }))));
const ENDS: Shape[] = SHAPES.filter((s) => [s.busy, s.wide, s.colour].every((v) => v !== 1)).concat([MIDDLE]);
const STD = getTuning("standard");

/** Chords 1 as it plays: each chord's span, name and notes. */
function chords1(b: Built, how: Voicer) {
  const vs = voiceChords(b.chords, how);
  let at = 0;
  return b.chords.map((c, i) => {
    const s = { start: at, end: at + Math.round(c.beats * TICKS), ref: c.ref, K: vs[i] };
    at = s.end;
    return s;
  });
}
const spanAt = <T extends { start: number; end: number }>(list: T[], t: number) => list.find((s) => s.start <= t && t < s.end);
const tuneAt = (b: Built, t: number) => {
  let m: number | null = null;
  for (const n of melodyLine(b.melody, b.len)) {
    if (n.at > t) break;
    m = n.midi;
  }
  return m;
};
const line = (b: Built, option: string, how: Voicer, shape: Shape = MIDDLE, from: "melody" | "chords" = "melody") => runOn(b, "melody", from, option, how, { shape }).melody?.notes ?? [];
/** A line as one voice: its notes, each ringing until the next (or the section's end). */
const rings = (notes: MelodyNote[], len: number) => notes.map((n, i) => ({ ...n, end: i + 1 < notes.length ? notes[i + 1].at : len }));
const ic = (a: number, b: number) => mod12(Math.abs(a - b));

describe("High and Low harmony are two lines, not one an octave apart", () => {
  it("at the middle setting they share a pitch class on at most a third of their common notes", () => {
    let same = 0;
    let both = 0;
    for (const b of ALL) {
      const hi = new Map(line(b, "third-above", "guitar").map((n) => [n.at, n.midi]));
      for (const n of line(b, "third-below", "guitar")) {
        const h = hi.get(n.at);
        if (h === undefined) continue;
        both++;
        if (ic(h, n.midi) === 0) same++;
      }
    }
    expect(same / both).toBeLessThanOrEqual(1 / 3);
  });
  it("the high harmony keeps to 3rds above the tune (6ths only where a 3rd cannot go), close over it", () => {
    let thirds = 0;
    let sixths = 0;
    let all = 0;
    for (const b of ALL) {
      const top = Math.max(...b.melody.notes.map((n) => n.midi));
      for (const n of line(b, "third-above", "guitar")) {
        const t = tuneAt(b, n.at)!;
        all++;
        if ([3, 4].includes(n.midi - t)) thirds++;
        if ([8, 9].includes(n.midi - t)) sixths++;
        // never far over the tune's own top (the first version reached C6 over a tune topping at E5)
        expect(n.midi - top, b.name).toBeLessThanOrEqual(5);
      }
    }
    expect(thirds / all).toBeGreaterThanOrEqual(0.55);
    expect(sixths / all).toBeLessThanOrEqual(0.2);
  });
});

describe("Answer: no note struck again, nothing held into a clash", () => {
  it("at every busy step, on both instruments: a held note never meets a strong tune note or a chord it rubs", () => {
    for (const b of ALL)
      for (const how of VOICERS)
        for (const busy of LV) {
          const notes = line(b, "answer", how, { ...MIDDLE, busy });
          expect(notes.length, `${b.name} ${busy}`).toBeGreaterThan(0);
          const c1 = chords1(b, how);
          const tune = melodyLine(b.melody, b.len);
          for (const [i, n] of rings(notes, b.len).entries()) {
            if (i > 0) expect(n.midi, `${b.name} ${how} ${busy} repeat at ${n.at / TICKS}`).not.toBe(notes[i - 1].midi);
            // every strong beat and chord change it rings over
            const times = new Set<number>([...c1.filter((s) => s.start > n.at && s.start < n.end).map((s) => s.start), ...tune.filter((x) => x.at > n.at && x.at < n.end && beatStrength(x.at, b.bar) >= 2).map((x) => x.at)]);
            for (const t of times) {
              const K = spanAt(c1, t)?.K ?? [];
              const m = tuneAt(b, t);
              const where = `${b.name} ${how} busy ${busy}: ${n.midi} from ${n.at / TICKS} at ${t / TICKS}`;
              expect(K.some((k) => [1, 13].includes(Math.abs(n.midi - k))), `${where} rubs Chords 1 ${K}`).toBe(false);
              if (m !== null && beatStrength(t, b.bar) >= 2) expect([1, 6, 11], `${where} with the tune's ${m}`).not.toContain(ic(n.midi, m));
            }
          }
        }
  });
});

describe("Counter-melody moves; it never strikes one note again and again", () => {
  it("a note is struck again only where a chord comes in, and at Wider it never doubles the tune at the octave on a strong beat", () => {
    let octaves = 0;
    let strong = 0;
    for (const b of ALL)
      for (const shape of [MIDDLE, { busy: 2, wide: 1, colour: 1 }, { busy: 1, wide: 2, colour: 1 }] as Shape[]) {
        const notes = line(b, "counter", "guitar", shape);
        const starts = new Set(chords1(b, "guitar").map((s) => s.start));
        notes.forEach((n, i) => {
          if (i > 0 && n.midi === notes[i - 1].midi) expect(starts.has(n.at), `${b.name} repeat at ${n.at / TICKS}`).toBe(true);
          const t = tuneAt(b, n.at);
          if (shape.wide === 2 && t !== null && beatStrength(n.at, b.bar) >= 2) {
            strong++;
            if (n.midi !== t && ic(n.midi, t) === 0) octaves++;
          }
        });
      }
    expect(octaves / strong).toBeLessThanOrEqual(0.05);
  });
});

describe("the second voices stay out of the chords' way at every width", () => {
  it("Low harmony and Stacked: no minor 2nd or 9th with Chords 1 on a strong beat, nothing under C3 over a tune that stays above D4", () => {
    for (const option of ["third-below", "stack"])
      for (const b of ALL)
        for (const how of VOICERS)
          for (const wide of LV) {
            const lowTune = Math.min(...b.melody.notes.map((n) => n.midi)) < 62;
            const c1 = chords1(b, how);
            let rubs = 0;
            for (const n of line(b, option, how, { ...MIDDLE, wide })) {
              if (!lowTune) expect(n.midi, `${b.name} ${option} ${wide}`).toBeGreaterThanOrEqual(48);
              if (beatStrength(n.at, b.bar) < 2) continue;
              const K = spanAt(c1, n.at)?.K ?? [];
              if (K.some((k) => [1, 13].includes(Math.abs(n.midi - k)))) rubs++;
            }
            // (a stack's two voices around a tune may meet one in a whole section, never more)
            expect(rubs, `${b.name} ${how} ${option} wide ${wide}`).toBeLessThanOrEqual(option === "stack" ? 1 : 0);
          }
  });
  it("no parallel octaves with the bass either (only 5ths were priced before)", () => {
    for (const b of ALL) {
      const c1 = chords1(b, "guitar");
      for (const option of ["third-below", "third-above", "counter", "slow-line"]) {
        const notes = line(b, option, "guitar");
        for (let i = 1; i < notes.length; i++) {
          const ba = spanAt(c1, notes[i - 1].at)?.K[0];
          const bb = spanAt(c1, notes[i].at)?.K[0];
          if (ba === undefined || bb === undefined || ba === bb || notes[i].midi === notes[i - 1].midi) continue;
          expect(ic(notes[i - 1].midi, ba) === 0 && ic(notes[i].midi, bb) === 0, `${b.name} ${option} at ${notes[i].at / TICKS}`).toBe(false);
        }
      }
    }
  });
});

/** The tune's strong notes over a row of chords that rub one of its chords: a chord tone a semitone under the note (the root over a maj7), or a tritone over the root the chord does not hold. */
function rubbed(b: Built, cs: { ref: ChordRef; beats: number; rest?: boolean }[]): string[] {
  const out: string[] = [];
  let at = 0;
  const spans = cs.map((c) => {
    const s = { start: at, end: at + Math.round(c.beats * TICKS), c };
    at = s.end;
    return s;
  });
  for (const n of melodyLine(b.melody, b.len)) {
    if (beatStrength(n.at, b.bar) < 2 && n.end - n.at < TICKS) continue;
    const s = spanAt(spans, n.at);
    if (!s || s.c.rest) continue;
    const pcs = refPcs(s.c.ref);
    const p = mod12(n.midi);
    if (pcs.includes(mod12(p - 1)) || (!pcs.includes(p) && mod12(p - pc(s.c.ref.root)) === 6)) out.push(`${n.at / TICKS}: ${n.midi} over ${s.c.ref.root}${s.c.ref.typeId}`);
  }
  return out;
}

describe("chords chosen for a tune never put a 7th under its note", () => {
  it("Best fit, Another fit and Relative, at every setting: no maj7 under the tune's root, no tritone over the root", () => {
    for (const b of ALL) {
      const own = rubbed(b, b.chords).length;
      for (const [from, option] of [["melody", "fit"], ["melody", "fit2"], ["chords", "relative"]] as const)
        for (const shape of from === "melody" ? SHAPES.filter((s) => s.wide === 1) : [MIDDLE]) {
          const cs = runOn(b, "chords", from, option, "guitar", { shape }).chords ?? [];
          // (no more than the section's own chords already do)
          expect(rubbed(b, cs).length, `${b.name} ${option} ${JSON.stringify(shape)}: ${rubbed(b, cs).join(", ")}`).toBeLessThanOrEqual(own);
        }
    }
  });
});

describe("chords played along over borrowed chords", () => {
  it("take the 7th the borrowed chord's own key gives (F minor in C: E♭, not E) and never a tritone over the root", () => {
    const b = REVIEW.find((x) => x.name === "rev-C-borrowed")!;
    for (const option of ["high", "airy", "guide", "top"])
      for (const shape of SHAPES) {
        const cs = runOn(b, "chords", "chords", option, "guitar", { shape }).chords ?? [];
        for (const c of cs) {
          if (c.rest || !c.notes) continue;
          const r = pc(c.ref.root);
          const minor = ["min", "m7", "m9", "m11", "madd9", "m6"].includes(c.ref.typeId) || refPcs(c.ref).includes(mod12(r + 3));
          for (const m of c.notes) {
            // over the borrowed iv (F minor) nothing from C major's E natural
            if (pc(c.ref.root) === 5 && minor) expect(mod12(m), `${option} ${JSON.stringify(shape)} ${c.ref.typeId}`).not.toBe(4);
            expect(mod12(m - r) === 6 && !["dim", "m7b5", "dim7"].includes(c.ref.typeId), `${option} ${JSON.stringify(shape)} ${c.ref.root}${c.ref.typeId} ${c.notes}`).toBe(false);
          }
        }
      }
  });
  it("with no tune and Chords 1 on the piano, a note a semitone under one of Chords 1's goes over it (a 7th or 9th, never a 2nd under it)", () => {
    for (const b0 of ALL) {
      const b = { ...b0, melody: { ...b0.melody, notes: [] } };
      const c1 = chords1(b, "keys");
      for (const option of ["high", "airy", "guide", "top"])
        for (const shape of ENDS) {
          let at = 0;
          for (const c of runOn(b, "chords", "chords", option, "keys", { shape }).chords ?? []) {
            const K = spanAt(c1, at)?.K ?? [];
            for (const v of c.notes ?? []) expect(K.some((k) => k > v && k - v <= 13 && mod12(k - v) === 1), `${b.name} ${option} ${JSON.stringify(shape)} at ${at / TICKS}: ${c.notes} under ${K}`).toBe(false);
            at += Math.round(c.beats * TICKS);
          }
        }
    }
  });
});

describe("the three controls", () => {
  const options: ["melody" | "chords", "melody" | "chords", string][] = [
    ["melody", "melody", "third-below"], ["melody", "melody", "third-above"], ["melody", "melody", "stack"], ["melody", "melody", "counter"], ["melody", "melody", "slow-line"], ["melody", "melody", "answer"],
    ["melody", "chords", "slow-line"], ["melody", "chords", "counter"], ["melody", "chords", "chord-tones"],
    ["chords", "chords", "high"], ["chords", "chords", "airy"], ["chords", "chords", "guide"], ["chords", "chords", "top"],
    ["chords", "melody", "fit"], ["chords", "melody", "fit2"],
  ];
  it("a control that is offered changes the harmony in most sections (one that would not is greyed out)", () => {
    const print = (o: ReturnType<typeof runOn>) => JSON.stringify(o.melody?.notes ?? o.chords?.map((c) => [c.ref, c.beats, c.notes]));
    for (const [kind, from, option] of options) {
      const on = controlsFor(kind, option);
      for (const key of ["busy", "wide", "colour"] as const) {
        if (!on[key]) continue;
        const dead = ALL.filter((b) => new Set(LV.map((v) => print(runOn(b, kind, from, option, "guitar", { shape: { ...MIDDLE, [key]: v } })))).size === 1).map((b) => b.name);
        expect(dead.length, `${kind}<-${from} ${option} ${key}: no change in ${dead.join(", ")}`).toBeLessThanOrEqual(Math.floor(ALL.length / 3));
      }
    }
    // an answer echoes the tune's notes; on the guitar, High chords and Guide tones have one place a hand
    // can play over Chords 1: those controls are not offered (on the keys they are)
    expect(controlsFor("melody", "answer").colour).toBe(false);
    expect(controlsFor("chords", "guide").wide).toBe(false);
    expect(controlsFor("chords", "high").wide).toBe(false);
    expect(controlsFor("chords", "high", false).wide).toBe(true);
  });
  it("a chords layer on the guitar is always one a hand can play, at every setting", () => {
    for (const b of ALL)
      for (const option of ["high", "airy", "guide", "top"])
        for (const shape of SHAPES)
          for (const c of runOn(b, "chords", "chords", option, "guitar", { shape }).chords ?? [])
            if (!c.rest) expect(fingerNotes(c.notes!, STD, 0), `${b.name} ${option} ${JSON.stringify(shape)} ${c.notes}`).toBeDefined();
  });
  it("Airy is open 5ths, with 9ths from the middle setting up", () => {
    let nines = 0;
    for (const b of ALL)
      for (const c of runOn(b, "chords", "chords", "airy", "guitar").chords ?? []) if (!c.rest && c.notes!.some((m) => mod12(m - pc(c.ref.root)) === 2)) nines++;
    expect(nines).toBeGreaterThan(0);
    for (const b of ALL)
      for (const c of runOn(b, "chords", "chords", "airy", "guitar", { shape: { ...MIDDLE, colour: 0 } }).chords ?? [])
        if (!c.rest) for (const m of c.notes!) expect([0, 7], b.name).toContain(mod12(m - pc(c.ref.root)));
  });
});

describe("Chord notes stays near the tune", () => {
  it("within an octave over the tune's highest note there, and never over C6, at every width", () => {
    for (const b of ALL)
      for (const wide of LV)
        for (const n of runOn(b, "melody", "chords", "chord-tones", "guitar", { shape: { ...MIDDLE, wide } }).melody?.notes ?? []) {
          expect(n.midi, b.name).toBeLessThanOrEqual(86);
          const near = b.melody.notes.filter((x) => Math.abs(x.at - n.at) <= 2 * TICKS).map((x) => x.midi);
          if (near.length) expect(n.midi - Math.max(...near), `${b.name} at ${n.at / TICKS}`).toBeLessThanOrEqual(19);
        }
  });
});
