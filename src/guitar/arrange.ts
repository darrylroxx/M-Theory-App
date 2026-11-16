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
import { positionOf } from "./shapeMap";
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
  /** Neck area to gather the chords in: 0 = open position, 1 = frets 1–3, 2 = 4–6 … (see POSITIONS). */
  zone?: number | null;
  /** How many strings each shape uses. */
  strings?: "any" | 3 | 4 | 5;
  /** Shapes that are already decided (one per chord, undefined = free). The rest flow around them. */
  pinned?: (Voicing | undefined)[];
}

/** Fret each neck area is centred on. */
const ZONE_CENTER = [1, 2, 5, 8, 11, 14];

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

/**
 * The friendliest single shape for a chord: 4+ strings, root in the bass, no full
 * barre when asked, and low on the neck where most players are at home.
 */
export function easyVoicing(ref: ChordRef, tuning: Tuning, capo: number, avoidBarre = true): Voicing | undefined {
  const all = voicingsFor(ref, tuning, capo);
  const ok = (v: Voicing, barreOk: boolean) =>
    v.frets.filter((f) => f !== null).length >= 4 && (v.bassToken === "1" || v.bassToken === "bass") && (barreOk || v.barreKind !== "full");
  const score = (v: Voicing) => v.rank + 0.2 * Math.max(0, v.minFret - 4);
  const best = (list: Voicing[]) => list.reduce<Voicing | undefined>((b, v) => (!b || score(v) < score(b) ? v : b), undefined);
  return best(all.filter((v) => ok(v, !avoidBarre))) ?? best(all.filter((v) => ok(v, true))) ?? all[0];
}

function unaryCost(v: Voicing, o: ArrangeOptions): number {
  let c = v.rank;
  if (o.avoidBarre && v.barreKind === "full") c += 6;
  if (o.avoidBarre && v.barreKind === "mini") c += 1;
  if (o.preferOpen && v.openStrings === 0) c += 1.2;
  const target = o.zone != null ? ZONE_CENTER[o.zone] : o.targetFret;
  if (target !== null && target !== undefined) c += Math.abs(voicingCenter(v) - target) * 0.35;
  if (o.zone != null) c += Math.abs(positionOf(v) - o.zone) * 2.5; // stay in the chosen area
  if (!o.allowInversions && v.bassToken !== "1" && v.inversion !== "Slash bass") c += 4;
  const sounding = v.frets.filter((f) => f !== null).length;
  if ((o.strings ?? "any") === "any" && sounding < 4) c += 0.6; // progressions sound fuller with 4+ strings
  return c;
}

function sized(all: Voicing[], strings: ArrangeOptions["strings"]): Voicing[] {
  if (!strings || strings === "any") return all;
  const hit = all.filter((v) => {
    const n = v.frets.filter((f) => f !== null).length;
    return strings === 5 ? n >= 5 : n === strings;
  });
  return hit.length ? hit : all;
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
  const cands = chords.map((ref, i) => {
    const pin = o.pinned?.[i];
    if (pin) return [pin];
    const all = sized(voicingsFor(ref, o.tuning, o.capo), o.strings);
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

/**
 * Every shape for one chord, ordered by how well it fits between its neighbours
 * (closest hand position and smoothest top note first). Used to sift through
 * alternatives for one spot in a progression.
 */
export function fitAlternatives(ref: ChordRef, o: ArrangeOptions, prev?: Voicing, next?: Voicing): Voicing[] {
  const all = sized(voicingsFor(ref, o.tuning, o.capo), o.strings);
  const cost = (v: Voicing) => unaryCost(v, o) + (prev ? transitionCost(prev, v) : 0) + (next ? transitionCost(v, next) : 0);
  return all.map((v) => [cost(v), v] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

/** Lowest and highest fretted fret used across a set of shapes (null when everything is open). */
export function fretSpan(vs: (Voicing | undefined)[]): [number, number] | null {
  const lows = vs.filter((v): v is Voicing => !!v && v.minFret > 0).map((v) => v.minFret);
  const highs = vs.filter((v): v is Voicing => !!v).map((v) => v.maxFret);
  return lows.length ? [Math.min(...lows), Math.max(...highs)] : null;
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
