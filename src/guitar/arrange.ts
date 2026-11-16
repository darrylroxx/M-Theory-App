/**
 * Arranging chords on the neck.
 *
 * - arrangeProgression: picks one voicing per chord so the whole progression is
 *   easy to play AND flows (hand stays in one zone, top note moves smoothly).
 * - capoSuggestions: finds capo positions that turn a key full of barre chords
 *   into friendly open shapes.
 */
import { ChordRef, ChordType, getChordType } from "../theory/chords";
import { pc } from "../theory/notes";
import type { Tuning } from "./tunings";
import { Voicing, generateVoicings, voicingCenter } from "./voicings";

export interface ArrangeOptions {
  tuning: Tuning;
  capo: number;
  avoidBarre: boolean;
  preferOpen: boolean;
  /** Keep the hand near this fret (null = anywhere). */
  targetFret: number | null;
  /** Allow inversions (non-root bass) to make the movement smoother. */
  allowInversions: boolean;
}

const cache = new Map<string, Voicing[]>();

/** Memoised voicing lookup (the UI asks for the same chords a lot). */
export function voicingsFor(ref: ChordRef, tuning: Tuning, capo: number, extra: { maxFret?: number; maxSpan?: number } = {}): Voicing[] {
  const k = `${pc(ref.root)}|${ref.typeId}|${ref.bass ? pc(ref.bass) : ""}|${tuning.notes.join(".")}|${capo}|${extra.maxFret ?? ""}|${extra.maxSpan ?? ""}`;
  let v = cache.get(k);
  if (!v) {
    v = generateVoicings(pc(ref.root), getChordType(ref.typeId), {
      tuning,
      capo,
      bassPc: ref.bass && pc(ref.bass) !== pc(ref.root) ? pc(ref.bass) : undefined,
      maxFret: extra.maxFret,
      maxSpan: extra.maxSpan,
    });
    if (cache.size > 400) cache.clear();
    cache.set(k, v);
  }
  return v;
}

function unaryCost(v: Voicing, o: ArrangeOptions): number {
  let c = v.rank;
  if (o.avoidBarre && v.barreKind === "full") c += 6;
  if (o.avoidBarre && v.barreKind === "mini") c += 1;
  if (o.preferOpen && v.openStrings === 0) c += 1.2;
  if (o.targetFret !== null) c += Math.abs(voicingCenter(v) - o.targetFret) * 0.35;
  if (!o.allowInversions && v.bassToken !== "1" && v.inversion !== "Slash bass") c += 4;
  const sounding = v.frets.filter((f) => f !== null).length;
  if (sounding < 4) c += 0.6; // progressions sound fuller with 4+ strings
  return c;
}

function transitionCost(a: Voicing, b: Voicing): number {
  const ca = voicingCenter(a);
  const cb = voicingCenter(b);
  const top = (v: Voicing) => Math.max(...v.midi.filter((m): m is number => m !== null));
  const bottom = (v: Voicing) => Math.min(...v.midi.filter((m): m is number => m !== null));
  return Math.abs(ca - cb) * 0.45 + Math.abs(top(a) - top(b)) * 0.12 + Math.abs(bottom(a) - bottom(b)) * 0.04;
}

/** Choose a voicing for every chord via dynamic programming (min total cost). */
export function arrangeProgression(chords: ChordRef[], o: ArrangeOptions): Voicing[] {
  if (!chords.length) return [];
  const K = 40;
  const cands = chords.map((ref) => {
    const all = voicingsFor(ref, o.tuning, o.capo);
    return [...all].sort((x, y) => unaryCost(x, o) - unaryCost(y, o)).slice(0, K);
  });
  const n = chords.length;
  const cost: number[][] = [];
  const back: number[][] = [];
  cost[0] = cands[0].map((v) => unaryCost(v, o));
  back[0] = cands[0].map(() => -1);
  for (let i = 1; i < n; i++) {
    cost[i] = [];
    back[i] = [];
    cands[i].forEach((v, j) => {
      const u = unaryCost(v, o);
      let best = Infinity;
      let arg = 0;
      cands[i - 1].forEach((p, k) => {
        const c = cost[i - 1][k] + transitionCost(p, v);
        if (c < best) {
          best = c;
          arg = k;
        }
      });
      cost[i][j] = best + u;
      back[i][j] = arg;
    });
  }
  const last = cost[n - 1];
  if (!last.length) return [];
  let j = last.indexOf(Math.min(...last));
  const result: Voicing[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    result[i] = cands[i][j];
    j = back[i][j];
  }
  return result;
}

export interface CapoSuggestion {
  capo: number;
  /** How many of the chords get an easy open shape */
  easy: number;
  total: number;
  /** Per chord: the easiest open-ish shape with this capo (or null). */
  shapes: (Voicing | null)[];
}

/** For each capo position, how many chords become easy, no-barre open shapes? */
export function capoSuggestions(chords: { rootPc: number; type: ChordType }[], tuning: Tuning, maxCapo = 9): CapoSuggestion[] {
  const out: CapoSuggestion[] = [];
  for (let capo = 0; capo <= maxCapo; capo++) {
    const shapes = chords.map(({ rootPc, type }) => {
      const v = generateVoicings(rootPc, type, { tuning, capo, maxFret: 4 }).filter(
        (x) => x.openStrings > 0 && x.barreKind !== "full" && x.bassToken === "1" && x.maxFret <= 3 && x.difficulty < 4.2 && x.frets.filter((f) => f !== null).length >= 4,
      );
      return v[0] ?? null;
    });
    out.push({ capo, easy: shapes.filter(Boolean).length, total: chords.length, shapes });
  }
  return out.sort((a, b) => b.easy - a.easy || a.capo - b.capo);
}
