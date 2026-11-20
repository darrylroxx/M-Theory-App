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
  // Closer ↔ Wider: how far the layer's notes spread (close, open, spread over more than an octave), and how high it sits
  const SPANS: [number, number][] = [[0, 9], [7, 16], [12, 24]];
  const [spanMin0, spanMax] = SPANS[shape.wide];
  // (two notes may be a 4th apart and still be open)
  const spanMin = (n: number) => (n <= 2 && shape.wide === 1 ? 0 : spanMin0);
  // and how high it sits
  const centre = [69, 74, 78][shape.wide];
  const top = option === "top";
  // a pitch class that rubs a strong tune note here (a minor 2nd or 9th either way)
  const rubsTune = (p: number, T: number[]) => T.some((t) => [1, 11].includes(mod12(p - t)));
  const cands = live.map((s, i) => {
    const topK = s.K.length ? Math.max(...s.K) : 60;
    const chord = pcsOf(s.ref);
    const root = chord[0];
    const bassK = s.K.length ? Math.min(...s.K) : null;
    // never a tritone over the root or Chords 1's bass that the chord does not hold (a #11 over a major chord sounds wrong held)
    const tritone = (p: number) => !chord.includes(p) && (mod12(p - root) === 6 || (bassK !== null && mod12(p - bassK) === 6));
    const lo = Math.max(55, topK - 2);
    let sets: { pcs: number[]; cost: number }[];
    if (top) {
      // one note over Chords 1, by colour: the key's 5th first (steady), its 3rd (warmer), its 2nd (open); none a
      // semitone above a chord tone, a ♭9 over the root, a tritone over the root, or out of the chord's scale
      const deg = (n: number) => pc(ctx.seven[n - 1]);
      const order = [[5, 3, 2], [3, 5, 2], [2, 3, 5]][shape.colour].map(deg);
      const local = localScale(ctx.seven, s.ref);
      const ok = order.filter((p) => !avoids(p, chord) && mod12(p - root) !== 1 && !tritone(p) && local.includes(p) && !rubsTune(p, s.T));
      const st = stackOf(s.ref, ctx);
      const safe = [st[3], st[5], root].filter((p): p is number => p !== undefined && !rubsTune(p, s.T));
      sets = ok.length ? ok.map((p, k) => ({ pcs: [p], cost: k * 3 })) : [{ pcs: [safe[0] ?? root], cost: 2 }];
    } else {
      const own = setOf(option, s.ref, ctx, shape.colour).filter((p) => !tritone(p));
      sets = [{ pcs: own, cost: 0 }];
      // a plainer set where the colour cannot sit (it rubs a strong tune note, a 7th under the tune's
      // root say, or Chords 1 leaves it no place): cheap where the tune asks for it, else dear, so the
      // colour asked for is what is heard wherever it fits
      const asked = own.some((p) => rubsTune(p, s.T));
      for (let c = shape.colour - 1; c >= 0; c--) {
        const p = setOf(option, s.ref, ctx, c).filter((x) => !tritone(x));
        if (p.length && p.join() !== own.join() && !sets.some((x) => x.pcs.join() === p.join())) sets.push({ pcs: p, cost: (asked ? 2 : 7) * (shape.colour - c) });
      }
      // Airy without its root (Chords 1 has it): the 5th and the colour, open, where a hand cannot hold all of them up there
      if (option === "airy" && own.length >= 3) {
        const rootless = own.filter((p) => p !== root);
        if (!sets.some((y) => y.pcs.join() === rootless.join())) sets.push({ pcs: rootless, cost: 1.5 });
      }
      // and with any note that still rubs the tune left out
      for (const x of [...sets]) {
        const kept = x.pcs.filter((p) => !rubsTune(p, s.T));
        if (kept.length && kept.length < x.pcs.length && !sets.some((y) => y.pcs.join() === kept.join())) sets.push({ pcs: kept, cost: x.cost + 2.5 });
      }
      // (busy 0: the set before, held over this chord when it still fits it)
      if (shape.busy === 0 && i > 0) {
        const prev = setOf(option, live[i - 1].ref, ctx, shape.colour);
        const local = localScale(ctx.seven, s.ref);
        if (prev.every((p) => chord.includes(p) || (local.includes(p) && !avoids(p, chord) && !tritone(p)))) sets.push({ pcs: prev, cost: -0.8 });
      }
    }
    const out: { v: number[]; cost: number; ref: ChordRef }[] = [];
    for (const set of sets) {
      const ref = extend(s.ref, set.pcs);
      if (!ref) continue;
      // the top note: strictly over Chords 1's top, higher as it widens
      const from = top ? topK + [1, 5, 10][shape.wide] : lo;
      const to = top ? topK + [9, 14, 24][shape.wide] : 84;
      let vs = layouts(set.pcs, from, to, top ? 0 : spanMax).filter((v) => top || v[v.length - 1] - v[0] >= spanMin(v.length));
      if (!vs.length) vs = layouts(set.pcs, from, top ? 88 : 86, top ? 0 : 24);
      for (const v of vs) out.push({ v, cost: set.cost, ref });
    }
    if (playable) {
      const fit = out.filter((c) => playable(c.v));
      // and, as a way out, the same sets anywhere over Chords 1 a hand can reach (the shape asked for may have no fingering up there)
      const more: typeof out = [];
      for (const set of sets) {
        const ref = extend(s.ref, set.pcs);
        if (!ref) continue;
        for (const v of layouts(set.pcs, top ? topK + 1 : Math.max(52, topK - 2), 88, top ? 0 : 24)) if (playable(v) && !fit.some((c) => c.v.join() === v.join())) more.push({ v, cost: set.cost + 8, ref });
      }
      if (fit.length || more.length) return [...fit, ...more];
      // nor there: a plainer set the hand can play (a 4-note colour drops its colour note)
      for (let c = shape.colour - 1; c >= 0 && !top; c--) {
        const p = setOf(option, s.ref, ctx, c).filter((x) => !tritone(x));
        const ref = extend(s.ref, p);
        if (!ref) continue;
        for (const v of layouts(p, Math.max(52, topK - 2), 88, 24)) if (playable(v)) more.push({ v, cost: 3 * (shape.colour - c), ref });
        if (more.length) return more;
      }
      // Chords 1 sits so high that a guitar reaches only a note or two over it: fewer notes, still over it
      for (const set of sets) {
        for (const drop of set.pcs) {
          const fewer = set.pcs.filter((p) => p !== drop);
          if (!fewer.length) continue;
          const ref = extend(s.ref, fewer);
          if (!ref) continue;
          for (const v of layouts(fewer, Math.max(52, topK - 2), 88, 24)) if (playable(v)) more.push({ v, cost: set.cost + 4, ref });
        }
      }
      if (more.length) return more;
      // nor that: the layer goes in its gaps, as high as a hand can play it
      for (const set of sets) {
        const ref = extend(s.ref, set.pcs);
        if (!ref) continue;
        for (const v of layouts(set.pcs, 52, 88, top ? 0 : 24)) if (playable(v)) more.push({ v, cost: set.cost + 8, ref });
      }
      if (more.length) return more;
    }
    return out.length ? out : [{ v: [Math.max(lo, 60 + mod12(chord[0]))], cost: 5, ref: s.ref }];
  });
  const node = (i: number, c: { v: number[]; cost: number }) => {
    const s = live[i];
    const K = s.K;
    const V = c.v;
    const kp = K.map(mod12);
    let x = c.cost + 10 * addedSet(V, [...K, ...s.T]);
    // never a semitone above a note of Chords 1 (C3), nor a minor 2nd or 9th with one either way
    if (V.some((v) => !kp.includes(mod12(v)) && kp.some((k) => mod12(v - k) === 1))) x += 10;
    if (V.some((v) => K.some((k) => Math.abs(v - k) === 1 || Math.abs(v - k) === 13))) x += 10;
    // a note a semitone under one of Chords 1's goes over it (a major 7th or 9th), never under it (C3)
    if (V.some((v) => K.some((k) => k > v && mod12(k - v) === 1))) x += 10;
    if (K.length && Math.min(...V) < Math.max(...K) - 2) x += 4;
    // a note Chords 1 already plays, on the same key, adds nothing to hear
    x += 3 * V.filter((v) => K.includes(v)).length;
    x += 50 * V.filter((v) => s.T.some((t) => [1, 11].includes(mod12(Math.abs(v - t))))).length;
    // a colour note (one Chords 1's chord does not hold) is heard over Chords 1, not inside it
    const own = pcsOf(s.ref);
    if (K.length && V.some((v) => !own.includes(mod12(v)) && v <= Math.max(...K))) x += 6;
    if (V.some((v) => s.T.some((t) => [0, 12, 24].includes(Math.abs(v - t))))) x += 2;
    if (s.tuneTop !== null) x += 0.3 * Math.max(0, Math.max(...V) - s.tuneTop);
    if (K.length && Math.max(...V) === Math.max(...K)) x += 1;
    // (Guide tones have no closer or wider: they sit where they fit best, around C5)
    // (the top note: just over Chords 1, a little higher, or high over it)
    const mid = top ? Math.min(81, (K.length ? Math.max(...K) : 64) + [4, 8, 12][shape.wide]) : centre;
    x += option === "guide" ? 0.1 * Math.abs((V[0] + V[V.length - 1]) / 2 - 72) : 0.45 * Math.abs((V[0] + V[V.length - 1]) / 2 - mid);
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
    // the top voice never in parallel 5ths or octaves with the bass
    if (ba !== undefined && bb !== undefined && ba !== bb && ta !== tb && [0, 7].includes(mod12(Math.abs(ta - ba))) && mod12(Math.abs(ta - ba)) === mod12(Math.abs(tb - bb))) c += 12;
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
