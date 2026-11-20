/**
 * Chords played along with another chords track: High chords, Airy, Guide tones, Top note.
 *
 * The first engine wrote these as chord names only, so the new track played the same guitar
 * shapes in the same register as the first one, plus a note or two: most of its notes doubled the
 * first track's and the rest rubbed against them. Here each layer is written as the exact notes it
 * plays (`ProgChord.notes`), chosen against the notes the first track really plays (`around`):
 *  - above them and in their gaps (never below the first track's top − 2, so there is one bass);
 *  - never a semitone above one of them (the research's rule C3), nor a minor 2nd or 9th with a
 *    strong note of the tune;
 *  - smooth from chord to chord: held notes, small moves, a top voice that moves little and
 *    never in parallel 5ths or octaves with the bass (after the pad voice-leading weights of
 *    `ekzhang/harmony`, BSD-3, and keys/voicing's `moveCost`);
 *  - the least roughness added (./consonance), so the whole is as smooth as the chords allow.
 * The chord's name then says what the two tracks make together (C with E G B on top: Cmaj7).
 */
import type { ProgChord } from "../ui/state";
import { TICKS } from "../song/melody";
import { CHORD_TYPES, getChordType, type ChordRef } from "./chords";
import { semitonesOf } from "./intervals";
import { mod12, pc } from "./notes";
import { addedSet } from "./consonance";
import { bestPath1 } from "./search";
import { lowIntervalOk, moveCost } from "../keys/voicing";
import { avoids, beatStrength, localScale, pcsOf, usable, type Ctx, type LineNote, type Shape } from "./harmonize";
import type { Heard } from "./lines";

export const LAYER_IDS = ["high", "airy", "guide", "top"] as const;

type Degree = 1 | 3 | 5 | 7 | 9 | 11 | 13;
/** A chord's stack: its 3rd, 5th and 7th (from the chord, else the scale under it) and the 9th, 11th and 13th of that scale. A member a semitone above another is left out. */
function stackOf(ref: ChordRef, ctx: Ctx): Partial<Record<Degree, number>> {
  const r = pc(ref.root);
  const own = getChordType(ref.typeId).intervals.map((iv) => mod12(semitonesOf(iv)));
  const local = localScale(ctx.seven, ref).map((p) => mod12(p - r));
  const pick = (from: number[], wants: number[]) => wants.find((w) => from.includes(w));
  const st: Partial<Record<Degree, number>> = { 1: 0 };
  st[3] = pick(own, [4, 3]) ?? pick(local, [4, 3]);
  st[5] = pick(own, [7, 6, 8]) ?? pick(local, [7, 6, 8]);
  st[7] = pick(own, [10, 11, 9]) ?? pick(local, [11, 10]);
  st[9] = pick(own, [2]) ?? pick(local, [2]);
  st[11] = pick(own, [5]) ?? pick(local, [5]);
  st[13] = pick(own, [9]) ?? pick(local, [9]);
  const members = Object.values(st).filter((x): x is number => x !== undefined);
  for (const d of [9, 11, 13] as Degree[]) if (st[d] !== undefined && members.some((m) => mod12(st[d]! - m) === 1)) delete st[d];
  return Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v === undefined ? undefined : mod12(r + v)])) as Partial<Record<Degree, number>>;
}

const isDominant = (ref: ChordRef) => {
  const own = getChordType(ref.typeId).intervals.map((iv) => mod12(semitonesOf(iv)));
  return own.includes(4) && own.includes(10);
};
const isMinor = (ref: ChordRef) => {
  const own = getChordType(ref.typeId).intervals.map((iv) => mod12(semitonesOf(iv)));
  return own.includes(3) && !own.includes(4);
};

/** The pitch classes a layer plays over a chord, by option and colour (falling back a step of colour where the chord has no such note). */
function setOf(option: string, ref: ChordRef, ctx: Ctx, colour: number): number[] {
  const st = stackOf(ref, ctx);
  const has7 = getChordType(ref.typeId).intervals.length >= 4;
  const want = (ds: Degree[]) => (ds.every((d) => st[d] !== undefined) ? [...new Set(ds.map((d) => st[d]!))] : null);
  const tries: Degree[][] =
    option === "high" ? (colour >= 2 ? [[5, 7, 9], [3, 5, 7], [1, 3, 5]] : colour === 1 ? [[3, 5, 7], [1, 3, 5]] : [has7 ? [3, 5, 7] : [1, 3, 5]])
    : option === "airy" ? (colour >= 2 ? [isMinor(ref) ? [1, 5, 9, 11] : [1, 5, 9, 13], [1, 5, 9], [1, 5]] : colour === 1 ? [[1, 5, 9], [1, 5]] : [[1, 5]])
    : option === "guide" ? (colour >= 2 ? [isDominant(ref) ? [3, 13] : [7, 9], [3, 7], [3, 1]] : colour === 1 ? [[3, 7], [3, 1]] : [[3, 1]])
    : [[1, 3, 5]];
  for (const t of tries) {
    const s = want(t);
    if (s) return s;
  }
  return pcsOf(ref);
}

/** The chord on the same root (and bass) that holds both the chord and what the layer adds, with the fewest notes more (none: null). */
export function extend(ref: ChordRef, adds: number[]): ChordRef | null {
  const r = pc(ref.root);
  const bass = ref.bass ? pc(ref.bass) : null;
  const typePcs = (id: string) => getChordType(id).intervals.map((iv) => mod12(r + semitonesOf(iv)));
  const need = new Set([...typePcs(ref.typeId), ...adds.filter((p) => p !== bass || typePcs(ref.typeId).includes(p))]);
  let best: { id: string; n: number } | null = null;
  for (const t of CHORD_TYPES) {
    if ((t as { synthetic?: boolean }).synthetic) continue;
    const ps = new Set(t.intervals.map((iv) => mod12(r + semitonesOf(iv))));
    if (![...need].every((p) => ps.has(p))) continue;
    const n = ps.size + (t.id === ref.typeId ? -0.5 : 0);
    if (!best || n < best.n) best = { id: t.id, n };
  }
  return best ? { root: ref.root, typeId: best.id, ...(ref.bass ? { bass: ref.bass } : {}) } : null;
}

/** Every way to lay out a set of pitch classes from `lo` up to `hi`, low to high, within a span. */
function layouts(pcs: number[], lo: number, hi: number, maxSpan: number): number[][] {
  const out: number[][] = [];
  const opts = pcs.map((p) => {
    const xs: number[] = [];
    for (let m = lo; m <= hi; m++) if (mod12(m) === p) xs.push(m);
    return xs;
  });
  const walk = (i: number, acc: number[]) => {
    if (i === opts.length) {
      const v = [...acc].sort((a, b) => a - b);
      if (v[v.length - 1] - v[0] <= maxSpan && v.every((m, k) => k === 0 || m - v[k - 1] >= 2) && lowIntervalOk(v)) out.push(v);
      return;
    }
    for (const m of opts[i]) if (!acc.includes(m)) walk(i + 1, [...acc, m]);
  };
  walk(0, []);
  return out;
}

interface LSlot {
  start: number;
  end: number;
  ref: ChordRef;
  K: number[];
  /** the strong tune notes in it */
  T: number[];
  /** the highest tune note in it */
  tuneTop: number | null;
}

/**
 * A layer for a row of chords: one slot per chord (two in a long one, busier), each laid out
 * against Chords 1's notes there and the tune, chosen for the whole row at once.
 */
export function layerChords(option: string, src: ProgChord[], tune: LineNote[], ctx: Ctx, heard: Heard, shape: Shape, playable?: (notes: number[]) => boolean): ProgChord[] {
  // the slots: each chord as it plays (busier: one of 2 beats or more split in two)
  const slots: (LSlot | { rest: ProgChord; start: number; end: number })[] = [];
  let t = 0;
  for (const c of src) {
    const d = Math.round((Number(c.beats) || 0) * TICKS);
    if (d <= 0) continue;
    const start = t;
    t += d;
    if (c.rest || !usable(c.ref)) {
      slots.push({ rest: c, start, end: t });
      continue;
    }
    const cut = shape.busy >= 2 && d >= 2 * TICKS ? start + Math.round(d / 2 / TICKS) * TICKS : null;
    for (const [a, b] of cut ? [[start, cut], [cut, t]] : [[start, t]]) {
      const inside = tune.filter((n) => n.at < b && n.end > a);
      const T = inside.filter((n) => n.at <= a || beatStrength(n.at, ctx.bar) >= 1 || n.end - n.at >= TICKS / 2).map((n) => n.midi);
      slots.push({ start: a, end: b, ref: c.ref, K: heard.K(a), T, tuneTop: inside.length ? Math.max(...inside.map((n) => n.midi)) : null });
    }
  }
  const live = slots.filter((s): s is LSlot => "ref" in s);
  if (!live.length) return src.map((c) => ({ ...c, id: ctx.id() }));
  const spanMax = [12, 19, 24][shape.wide];
  const spanMin = [0, 9, 14][shape.wide];
  const top = option === "top";
  const cands = live.map((s, i) => {
    const topK = s.K.length ? Math.max(...s.K) : 60;
    const chord = pcsOf(s.ref);
    const lo = Math.max(55, topK - 2);
    let sets: { pcs: number[]; cost: number }[];
    if (top) {
      // sol, then mi, then re of the key; none a semitone above a chord tone nor a ♭9 over the root
      const deg = (n: number) => mod12(ctx.tonic + [0, 0, 2, 4, 5, 7, 9, 11][n]);
      const list = [deg(5), ...(shape.colour >= 1 ? [deg(3)] : []), ...(shape.colour >= 2 ? [deg(2)] : [])];
      const ok = list.filter((p) => !avoids(p, chord) && mod12(p - chord[0]) !== 1 && localScale(ctx.seven, s.ref).includes(p));
      sets = (ok.length ? ok : [stackOf(s.ref, ctx)[3] ?? chord[0]]).map((p, k) => ({ pcs: [p], cost: k * 0.3 + (ok.length ? 0 : 1) }));
    } else {
      const own = setOf(option, s.ref, ctx, shape.colour);
      sets = [{ pcs: own, cost: 0 }];
      // a plainer set where the tune needs it (a 7th under the tune's root, say)
      for (let c = shape.colour - 1; c >= 0; c--) {
        const p = setOf(option, s.ref, ctx, c);
        if (p.join() !== own.join() && !sets.some((x) => x.pcs.join() === p.join())) sets.push({ pcs: p, cost: 1.5 * (shape.colour - c) });
      }
      // (busy 0: the set before, held over this chord when it still fits it)
      if (shape.busy === 0 && i > 0) {
        const prev = setOf(option, live[i - 1].ref, ctx, shape.colour);
        const local = localScale(ctx.seven, s.ref);
        if (prev.every((p) => chord.includes(p) || (local.includes(p) && !avoids(p, chord)))) sets.push({ pcs: prev, cost: -0.8 });
      }
    }
    const out: { v: number[]; cost: number; ref: ChordRef }[] = [];
    for (const set of sets) {
      const ref = extend(s.ref, set.pcs);
      if (!ref) continue;
      const hiTop = top ? [topK + 9, 81, 88][shape.wide] : 84;
      let vs = layouts(set.pcs, top ? Math.max(lo, [topK + 1, 72, 79][shape.wide]) : lo, hiTop, top ? 0 : spanMax);
      if (!vs.length) vs = layouts(set.pcs, lo, 88, 24);
      for (const v of vs) out.push({ v, cost: set.cost + (v[v.length - 1] - v[0] < spanMin ? 0.4 * (spanMin - (v[v.length - 1] - v[0])) : 0), ref });
    }
    const fit = playable ? out.filter((c) => playable(c.v)) : out;
    return fit.length ? fit : out.length ? out : [{ v: [Math.max(lo, 60 + mod12(chord[0]))], cost: 5, ref: s.ref }];
  });
  const node = (i: number, c: { v: number[]; cost: number }) => {
    const s = live[i];
    const K = s.K;
    const V = c.v;
    const kp = K.map(mod12);
    let x = c.cost + 10 * addedSet(V, [...K, ...s.T]);
    if (V.some((v) => !kp.includes(mod12(v)) && kp.some((k) => mod12(v - k) === 1))) x += 10;
    if (K.length && Math.min(...V) < Math.max(...K) - 2) x += 4;
    x += 8 * V.filter((v) => s.T.some((t) => [1, 11].includes(mod12(Math.abs(v - t))))).length;
    if (V.some((v) => s.T.some((t) => [0, 12, 24].includes(Math.abs(v - t))))) x += 2;
    if (s.tuneTop !== null) x += 0.3 * Math.max(0, Math.max(...V) - s.tuneTop);
    if (K.length && Math.max(...V) === Math.max(...K)) x += 1;
    x += 0.1 * Math.abs((V[0] + V[V.length - 1]) / 2 - 72);
    return x;
  };
  const edge = (i: number, a: { v: number[] }, b: { v: number[] }) => {
    if (a.v.join() === b.v.join()) return shape.busy === 0 ? -0.8 : 0;
    const dTop = b.v[b.v.length - 1] - a.v[a.v.length - 1];
    let c = moveCost(a.v, b.v) + (dTop / 3) ** 2;
    const ba = live[i - 1].K[0];
    const bb = live[i].K[0];
    const ta = a.v[a.v.length - 1];
    const tb = b.v[b.v.length - 1];
    if (ba !== undefined && bb !== undefined && ba !== bb && ta !== tb && [0, 7].includes(mod12(Math.abs(ta - ba))) && mod12(Math.abs(ta - ba)) === mod12(Math.abs(tb - bb))) c += 6;
    if (shape.busy >= 2 && live[i].ref === live[i - 1].ref && Math.abs(dTop) <= 2 && a.v.slice(0, -1).join() === b.v.slice(0, -1).join()) c -= 0.5;
    return c;
  };
  const { path } = bestPath1(cands, node, edge);
  // the row as chords: rests kept, held sets merged (named by the first chord)
  const out: ProgChord[] = [];
  let k = 0;
  let prevNotes = "";
  for (const s of slots) {
    const beats = (s.end - s.start) / TICKS;
    if ("rest" in s) {
      out.push({ ...s.rest, id: ctx.id(), beats });
      prevNotes = "";
      continue;
    }
    const c = path[k++];
    const last = out[out.length - 1];
    if (last && !last.rest && prevNotes === c.v.join() && (shape.busy === 0 || pcsOf(last.ref).join() === pcsOf(c.ref).join())) {
      last.beats += beats;
      continue;
    }
    out.push({ id: ctx.id(), ref: c.ref, beats, notes: c.v });
    prevNotes = c.v.join();
  }
  return out;
}
