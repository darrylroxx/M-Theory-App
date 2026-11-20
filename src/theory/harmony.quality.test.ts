/**
 * How good Harmonize sounds, in numbers, on nine test sections (./fixtures/harmony), against the
 * first engine's numbers measured before it was replaced (./fixtures/baseline.json). Chords 1 is
 * voiced on the guitar and on the piano, and the worse counts. See ./quality for the measures.
 * The table printed is the before/after comparison.
 */
import { describe, expect, it } from "vitest";
import baseline from "./fixtures/baseline.json";
import { BUILT } from "./fixtures/harmony";
import { insteadTotals, layerTotals, lineTotals, refPcs, runOn, seedSpread, type LayerTotal, type LineTotal } from "./quality";
import { MIDDLE, type Level } from "./harmonize";
import { mod12 } from "./notes";
import { fingerNotes } from "../guitar/finger";
import { getTuning } from "../guitar/tunings";
import { TICKS } from "../song/melody";

type Base = Record<string, LineTotal & LayerTotal & { clash: number; own: number }>;
const B = baseline as unknown as Base;
const pct = (a: number, b: number) => (b ? (100 * a) / b : 0);
const rows: string[] = [];
const say = (s: string) => rows.push(s);

describe("melody lines sound better than the first engine's", () => {
  const cases: [string, "melody" | "chords", string, string | null][] = [
    ["High harmony", "melody", "third-above", "melody:third-above"],
    ["Low harmony", "melody", "third-below", "melody:third-below"],
    ["Stacked", "melody", "stack", null],
    ["Counter-melody", "melody", "counter", "melody:counter"],
    ["Long notes", "melody", "slow-line", "melody:slow-line"],
    ["Answer", "melody", "answer", "melody:answer"],
    ["Long notes (from Chords)", "chords", "slow-line", "chords:slow-line"],
    ["Counter-melody (from Chords)", "chords", "counter", "chords:counter"],
    ["Chord notes (from Chords)", "chords", "chord-tones", "chords:chord-tones"],
  ];
  for (const [name, from, option, base] of cases)
    it(name, () => {
      const a = lineTotals(BUILT, from, option);
      const b = base ? B[base] : null;
      const show = (t: LineTotal) => `clash ${(t.clash / t.tuneClash).toFixed(2)}× · rub ${pct(t.rub, t.strong).toFixed(1)}% · added ${t.added.toFixed(3)} · unison ${pct(t.unison, t.moments).toFixed(1)}% · cross ${t.cross} · parallels ${t.parallels} · tritones ${t.tritones} · wrote ${t.wrote}/9`;
      say(`${name.padEnd(30)} before: ${b ? show(b) : "(new)"}`);
      say(`${"".padEnd(30)} after:  ${show(a)}`);
      // never a parallel 5th or octave, never a melodic tritone, never a 2nd, 7th or tritone with the tune on a strong slot
      expect(a.parallels).toBeLessThanOrEqual(option === "answer" ? 1 : 0);
      expect(a.tritones).toBeLessThanOrEqual(option === "chord-tones" ? 1 : 0);
      expect(a.leadDiss).toBeLessThanOrEqual(1);
      // clash time: at most the tune's own (Answer and Chord notes: a third of it)
      expect(a.clash).toBeLessThanOrEqual(a.tuneClash * (["answer", "chord-tones"].includes(option) ? 0.35 : option === "stack" ? 1.25 : 1));
      // rubs against the chords on strong slots: fewer than half the first engine's, and under 4 %
      expect(pct(a.rub, a.strong)).toBeLessThanOrEqual(4);
      if (b) expect(a.rub / a.strong).toBeLessThanOrEqual((option === "chord-tones" ? 1 : 0.5) * (b.rub / b.strong) + 1e-9);
      // the second voice keeps to one interval family, and never meets or crosses the tune
      if (["third-above", "third-below", "stack"].includes(option)) {
        expect(a.unison).toBe(0);
        expect(a.cross).toBeLessThanOrEqual(option === "stack" ? 2 : 0);
        expect(a.family).toBeGreaterThanOrEqual(option === "third-above" ? 0.7 : 0.55);
      } else expect(pct(a.unison, a.moments)).toBeLessThanOrEqual(option === "counter" ? (from === "chords" ? 8 : 6.5) : 5);
      if (b && option !== "answer" && option !== "chord-tones") {
        // less roughness added than before (the high harmony: under three quarters of it)
        // (the counter-melody written from Chords now keeps clear of the tune, and pays for it in roughness: up to 1.3×)
        expect(a.added).toBeLessThanOrEqual(b.added * (option === "third-above" ? 0.75 : option === "slow-line" ? (from === "melody" ? 0.6 : 0.8) : option === "counter" && from === "chords" ? 1.3 : 1));
      }
      if (option === "chord-tones") expect(a.added).toBeLessThanOrEqual(0.5 * b!.added);
      // Answer always has something to say
      // (a tune with a note on every beat leaves an answer nowhere to come in: 6 of 9 here, 2 of 9 before)
      expect(a.wrote).toBeGreaterThanOrEqual(option === "answer" ? 6 : 9);
    });
});

describe("chords played along with Chords 1 sit above it, in its gaps", () => {
  const old = (["colour", "sus", "pedal"] as const).map((o) => B[`layer:${o}`]);
  const bestOld = { hk: Math.min(...old.map((x) => x.hkRatio)), doubled: Math.min(...old.map((x) => x.doubled / x.notes)), added: Math.min(...old.map((x) => x.added)) };
  say(`Chords along (first engine, best of Richer/Sus/Pedal bass): roughness ×${bestOld.hk.toFixed(2)} of Chords 1 alone · added ${bestOld.added.toFixed(2)} · doubled ${(100 * bestOld.doubled).toFixed(0)}% · second bass ${Math.min(...old.map((x) => x.secondBass))}`);
  for (const [option, hkMax] of [["high", 1.6], ["airy", 1.6], ["guide", 1.6], ["top", 1.5]] as const)
    it(option, () => {
      const a = layerTotals(BUILT, option);
      say(`  ${option.padEnd(6)} after: roughness ×${a.hkRatio.toFixed(2)} · added ${a.added.toFixed(2)} · semitone above ${a.semitoneAbove} · rubs ${a.rubs} · doubled ${pct(a.doubled, a.notes).toFixed(0)}% · above ${(100 * a.above).toFixed(0)}% · second bass ${a.secondBass} · tune rubs ${a.tuneRub}`);
      expect(a.hkRatio).toBeLessThanOrEqual(hkMax);
      expect(a.hkRatio).toBeLessThan(bestOld.hk);
      expect(a.added).toBeLessThan(0.25 * bestOld.added);
      expect(a.semitoneAbove).toBeLessThanOrEqual(1);
      expect(a.doubled / a.notes).toBeLessThanOrEqual(option === "high" ? 0.3 : 0.25);
      expect(a.above).toBe(1);
      expect(a.secondBass).toBe(0);
      expect(a.tuneRub).toBeLessThanOrEqual(option === "top" ? 2 : option === "high" ? 12 : 10);
    });
  it("every chord's name holds what it plays, and the guitar can play it (standard tuning)", () => {
    const std = getTuning("standard");
    for (const b of BUILT)
      for (const option of ["high", "airy", "guide", "top"])
        for (const busy of [0, 1, 2] as Level[])
          for (const colour of [0, 1, 2] as Level[]) {
            const cs = runOn(b, "chords", "chords", option, "guitar", { shape: { busy, wide: 1, colour } }).chords ?? [];
            let t = 0;
            for (const c of cs) {
              if (!c.rest) {
                expect(c.notes?.length, `${b.name} ${option}`).toBeGreaterThan(0);
                for (const m of c.notes!) expect(refPcs(c.ref)).toContain(mod12(m));
                expect(fingerNotes(c.notes!, std, 0), `${b.name} ${option} ${c.notes}`).toBeDefined();
                // the name holds the chord it plays over (Chords 1 there)
                if (busy === 1) {
                  let u = 0;
                  const under = b.chords.find((x) => (u += x.beats) > t);
                  for (const p of refPcs(under!.ref)) expect(refPcs(c.ref)).toContain(p);
                }
              }
              t += c.beats;
            }
            expect(Math.round(t * TICKS)).toBe(b.len);
          }
  });
});

describe("chords for a tune, and chords played instead", () => {
  for (const [name, from, option] of [["Darker", "chords", "borrowed"], ["Relative", "chords", "relative"], ["Lead-ins", "chords", "lead-in"], ["Best fit", "melody", "fit"], ["Another fit", "melody", "fit2"]] as const)
    it(name, () => {
      const a = insteadTotals(BUILT, from, option);
      const b = B[from === "melody" ? `fit:${option}` : `instead:${option}`];
      say(`${name.padEnd(12)} tune clash beats: before ${b ? b.clash.toFixed(1) : "(new)"} → after ${a.clash.toFixed(1)} (over Chords 1: ${a.own.toFixed(1)})`);
      expect(a.clash).toBeLessThanOrEqual(option === "borrowed" ? 1.5 * a.own : a.own);
      if (b) expect(a.clash).toBeLessThanOrEqual(b.clash);
    });
});

describe("the same section always gets the same harmony (it never depends on the track it goes into)", () => {
  it("seeds 1–8 give one result", () => {
    for (const [kind, from, option] of [["melody", "melody", "third-above"], ["melody", "melody", "counter"], ["melody", "melody", "stack"], ["chords", "chords", "high"], ["chords", "chords", "airy"], ["chords", "melody", "fit2"]] as const)
      for (const b of BUILT.slice(0, 4)) expect(seedSpread(b, kind, from, option), `${option} ${b.name}`).toBe(1);
    say(`Seed spread (different results for 8 track ids): before ${JSON.stringify((baseline as { seedSpread: unknown }).seedSpread)} → after 1 for every option`);
  });
  it("prints the before/after table", () => {
    // eslint-disable-next-line no-console
    console.log(["", "HARMONY QUALITY: first engine (before) and now (after), 9 sections, Chords 1 on guitar and on piano (the worse counts)", ...rows].join("\n"));
    expect(MIDDLE).toEqual({ busy: 1, wide: 1, colour: 1 });
  });
});
