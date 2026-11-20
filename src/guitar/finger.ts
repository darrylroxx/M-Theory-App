/**
 * A guitar fingering for exact notes: the frets that play just these notes (each on its own
 * string, low notes on low strings), in one hand position. Harmonize writes a chords track as
 * exact notes; on the guitar it plays them with this.
 */
import type { Tuning } from "./tunings";

/**
 * Frets per string (low → high, null = not played) that sound exactly `notes`, or undefined when
 * no hand can: frets 0–17 above the capo, at most four frets between the lowest and highest
 * fretted note, at most one string skipped between two played ones. The easiest wins: the
 * smallest stretch, then nearest the middle of the neck, then the fewest strings skipped.
 */
export function fingerNotes(notes: number[], tuning: Tuning, capo = 0): (number | null)[] | undefined {
  const ns = [...new Set(notes)].sort((a, b) => a - b);
  const open = tuning.notes.map((m) => m + capo);
  const k = ns.length;
  if (!k || k > open.length) return undefined;
  let best: { frets: (number | null)[]; cost: number } | undefined;
  const pick = (from: number, chosen: number[]) => {
    if (chosen.length === k) {
      const fr = chosen.map((s, i) => ns[i] - open[s]);
      if (fr.some((f) => f < 0 || f > 17)) return;
      const fretted = fr.filter((f) => f > 0);
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
      if (span > 4) return;
      let skipped = 0;
      for (let i = 1; i < chosen.length; i++) {
        const gap = chosen[i] - chosen[i - 1] - 1;
        if (gap > 1) return;
        skipped += gap;
      }
      const mean = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : 0;
      const cost = span * 10 + Math.abs(mean - 5) + skipped * 3;
      if (!best || cost < best.cost - 1e-9) {
        const frets: (number | null)[] = open.map(() => null);
        chosen.forEach((s, i) => (frets[s] = fr[i]));
        best = { frets, cost };
      }
      return;
    }
    for (let s = from; s < open.length; s++) pick(s + 1, [...chosen, s]);
  };
  pick(0, []);
  return best?.frets;
}
