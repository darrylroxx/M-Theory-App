/**
 * Piano voicings: which keys to press for a chord, and how to get from one chord to the next
 * with the hands moving as little as they can.
 *
 * A chord symbol says which notes, not where. On a guitar the neck decides most of that; on a
 * piano almost anything is possible, so a few shapes that players actually use are built here:
 *
 *   close   every note inside one octave, in any inversion          C4 E4 G4 B4
 *   open    spread past the octave (a triad's middle note dropped; drop 3 or drop 2+4 for
 *           four-note chords)                                       C3 G3 E4 B4
 *   drop2   the second note from the top dropped an octave          G3 C4 E4 B4
 *   shell   root, 3rd and 7th only (the 5th and colours left out)    C3 E3 B3 / C3 B3 E4
 *   spread  left hand root (+ 5th, 7th or 10th), right hand the rest close together
 *
 * Every shape is placed at every height inside a register and filtered by the rules a pianist
 * or arranger follows: nothing muddy low down (a third under E3 rumbles, a fifth under E2
 * does), no semitone between the two top or the two bottom keys (and as few as can be inside),
 * at most a ninth-ish stretch per hand, and never more than eight notes. Then a
 * dynamic-programming search (Viterbi) picks one candidate per chord so that the whole
 * progression moves least: semitones of movement cost 1, a held note is a bonus, a big leap in
 * the top voice and parallel fifths or octaves cost extra.
 *
 * The constants and rules come from open code and textbooks, re-implemented here (see NOTICE.md):
 * register bands and hand spans from Impro-Visor (GPL-2.0-or-later) and Contrapunk (MIT);
 * shapes and rootless/shell ideas from tonal.js (MIT); the L1 "difference", required notes and
 * spacing validators from jazzband (ISC); the parallel-fifth test from music21 (BSD-3); the
 * edge-cost weights from the voice-leading research in research_notes/.
 */
import { chordTypeOf, type ChordRef } from "../theory/chords";
import { parseInterval, semitonesOf } from "../theory/intervals";
import { mod12, pc } from "../theory/notes";

export type KeyStyle = "close" | "open" | "drop2" | "shell" | "spread";
export const KEY_STYLES: KeyStyle[] = ["close", "open", "drop2", "shell", "spread"];

export type Register = "low" | "mid" | "high";
/**
 * Where a part sits (MIDI note numbers). Mid is the comping band most voicing code defaults to
 * (C3–C5); high is a pad above it (C4–C6), where a second chord layer stays out of the first's
 * way; low is the bass-and-left-hand band (E2–E4).
 */
export const REGISTERS: Record<Register, { low: number; high: number }> = {
  low: { low: 40, high: 64 },
  mid: { low: 48, high: 72 },
  high: { low: 60, high: 84 },
};

/** The most keys a voicing presses: two hands of four. */
export const MAX_KEYS = 8;
/** How far one hand reaches comfortably (a 6th), and at most (an octave); a left-hand 10th in the spread style. */
export const HAND_SPAN = 9;
export const HAND_MAX = 12;
export const LEFT_TENTH = 16;

export interface KeyOptions {
  style?: KeyStyle;
  /** lowest and highest key allowed (MIDI) */
  low?: number;
  high?: number;
  /** the voicing before, so this one can move least from it */
  prev?: number[];
}

// ── Low-interval limits ─────────────────────────────────────────

/**
 * Two notes close together sound muddy low down. The limits disagree by a few semitones between
 * sources, so the strictest reading is used: under E2 (40) only octaves or wider, under B2 (47)
 * a fifth or wider, under E3 (52) a minor third or wider. Checked for every neighbouring pair.
 */
export function lowIntervalOk(midi: number[]): boolean {
  const s = [...midi].sort((a, b) => a - b);
  for (let i = 0; i + 1 < s.length; i++) {
    const lo = s[i];
    const iv = s[i + 1] - lo;
    if (lo < 40 && iv < 12) return false;
    if (lo < 47 && iv < 7) return false;
    if (lo < 52 && iv < 3) return false;
  }
  return true;
}

/**
 * The outer pairs keep a tone apart: a semitone between the two top notes hides the melody note
 * on top, and one between the two bottom notes blurs the bass (jazzband's smallest top and
 * bottom distances). A semitone inside the voicing is allowed but costs (Impro-Visor keeps
 * neighbouring keys of one hand a tone apart): see `rubs`.
 */
export function outerOk(midi: number[]): boolean {
  const s = [...midi].sort((a, b) => a - b);
  const n = s.length;
  return n < 2 || (s[1] - s[0] !== 1 && s[n - 1] - s[n - 2] !== 1);
}

/** How many neighbouring keys of a voicing sit a semitone apart. */
export function rubs(midi: number[]): number {
  const s = [...midi].sort((a, b) => a - b);
  let n = 0;
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] === 1) n++;
  return n;
}

// ── Hands ───────────────────────────────────────────────────────

export interface Hands {
  left: number[];
  right: number[];
}

/**
 * Split a voicing between the hands: the left takes the bottom (the root, or root and 7th or
 * 10th, below about middle C), the right the rest, each within reach. The split that keeps both
 * hands comfortable and closest to middle C wins; a voicing one hand can hold (up to four keys
 * inside an octave) is played by one hand: the right when it sits high, the left when low.
 */
export function splitHands(midi: number[], opts: { middle?: number; leftMax?: number } = {}): Hands {
  const s = [...new Set(midi)].sort((a, b) => a - b);
  const middle = opts.middle ?? 60;
  const leftMax = opts.leftMax ?? LEFT_TENTH;
  if (!s.length) return { left: [], right: [] };
  let best: Hands | null = null;
  let bestCost = Infinity;
  for (let k = 0; k <= s.length; k++) {
    const left = s.slice(0, k);
    const right = s.slice(k);
    if (left.length > 4 || right.length > 5) continue;
    const ls = left.length ? left[left.length - 1] - left[0] : 0;
    const rs = right.length ? right[right.length - 1] - right[0] : 0;
    let cost = 0;
    // a hand stretched past the octave is a last resort (the left may reach a 10th)
    cost += Math.max(0, ls - HAND_MAX) * (ls > leftMax ? 20 : 3) + Math.max(0, rs - HAND_MAX) * 20;
    cost += Math.max(0, ls - HAND_SPAN) * 0.5 + Math.max(0, rs - HAND_SPAN) * 0.5;
    // the left lives below middle C, the right at or above it
    for (const n of left) cost += Math.max(0, n - middle) * 0.6;
    for (const n of right) cost += Math.max(0, middle - 5 - n) * 0.6;
    // a lone hand is fine for up to four keys; for more, share the load
    if (!left.length || !right.length) cost += Math.max(0, s.length - 4) * 2;
    // and two hands for a shape one hand could hold is effort for nothing
    else if (s.length <= 4 && s[s.length - 1] - s[0] <= HAND_MAX) cost += 1.5;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = { left, right };
    }
  }
  return best ?? { left: [], right: s };
}

/** Can two hands play it: each hand within its reach (the left up to a 10th)? */
export function playable(midi: number[]): boolean {
  const h = splitHands(midi);
  const span = (x: number[]) => (x.length ? x[x.length - 1] - x[0] : 0);
  return span(h.left) <= LEFT_TENTH && span(h.right) <= HAND_MAX && h.left.length <= 4 && h.right.length <= 5;
}

// ── The chord's tones ──────────────────────────────────────────

interface Tone {
  pc: number;
  token: string;
  /** 1, 3, 5, 7 or a colour (9, 11, 13, 2, 4, 6) */
  num: number;
  required: boolean;
}

interface ChordTones {
  root: number;
  bass?: number;
  tones: Tone[];
  /** the 3rd (or what stands for it in sus chords) and the 7th (or 6th) */
  guides: number[];
}

/** The notes a chord needs, the ones it can lose, and its guide tones. */
export function chordTones(ref: ChordRef): ChordTones {
  const type = chordTypeOf(ref);
  const root = pc(ref.root);
  const optional = new Set(type.optional ?? []);
  const seen = new Set<number>();
  const tones: Tone[] = [];
  for (const iv of type.intervals) {
    const p = mod12(root + semitonesOf(iv));
    if (seen.has(p)) continue;
    seen.add(p);
    tones.push({ pc: p, token: iv, num: parseInterval(iv).number, required: !optional.has(iv) });
  }
  const has = (num: number) => tones.find((t) => t.num === num);
  // what stands for the 3rd in a sus chord is its 4th or 2nd (or the 11th of an eleventh chord,
  // which is played without its 3rd); for the 7th, a 6th (or a 13th)
  const third = (has(3)?.required ? has(3) : undefined) ?? has(4) ?? has(2) ?? has(11) ?? has(9) ?? has(3);
  const seventh = has(7) ?? has(6) ?? has(13);
  const guides = [third, seventh].filter((t): t is Tone => !!t).map((t) => t.pc);
  const bass = ref.bass && pc(ref.bass) !== root ? pc(ref.bass) : undefined;
  return { root, bass, tones, guides };
}

/**
 * The tones a style voices, at most five: big chords lose their optional tones first (the 3rd
 * under a natural 11th, the 5th, then the 9th under an 11th or 13th), the way pianists thin out
 * a thirteenth chord.
 */
function voiced(ct: ChordTones, max: number): Tone[] {
  const list = [...ct.tones];
  const drop = (pred: (t: Tone) => boolean) => {
    const i = list.findIndex((t) => !t.required && pred(t));
    if (i >= 0) list.splice(i, 1);
    return i >= 0;
  };
  while (list.length > max) {
    // an eleventh chord sheds its major 3rd first: the 11th a semitone above it is the avoid note
    if (list.some((t) => t.token === "11") && drop((t) => t.token === "3")) continue;
    if (drop((t) => t.num === 5)) continue;
    if (drop((t) => t.num === 9)) continue;
    if (drop((t) => t.num !== 1)) continue;
    // still too many required tones: lose the 5th, then a colour below the top one
    const i = list.findIndex((t) => t.num === 5);
    if (i >= 0) list.splice(i, 1);
    else list.splice(list.length - 2, 1);
  }
  return list;
}

/** Pitch-class distance above the root: the order of a close root-position stack. */
const above = (root: number, p: number) => mod12(p - root);

/** Stack pitch classes upward in the order given, the first at or above `from`. */
function stack(order: number[], from: number): number[] {
  const out: number[] = [];
  let at = from;
  for (const p of order) {
    let m = at + mod12(p - at);
    if (out.length && m <= out[out.length - 1]) m += 12;
    out.push(m);
    at = m;
  }
  return out;
}

const rotations = <T,>(xs: T[]): T[][] => xs.map((_, i) => [...xs.slice(i), ...xs.slice(0, i)]);

/** Every way of placing a style's shapes, at every height from `low` to `high`. */
function shapes(ct: ChordTones, style: KeyStyle, low: number, high: number): number[][] {
  const out: number[][] = [];
  const add = (v: number[]) => {
    if (v.length && v[0] >= low && v[v.length - 1] <= high) out.push(v);
  };
  const close = (ts: Tone[]) => ts.map((t) => t.pc).sort((a, b) => above(ct.root, a) - above(ct.root, b));
  const starts = (fn: (start: number) => void) => {
    for (let s = low - 24; s <= high; s++) fn(s);
  };

  if (style === "close" || style === "drop2" || style === "open") {
    const ts = voiced(ct, style === "close" ? 5 : 4);
    for (const rot of rotations(close(ts))) {
      for (let s = low; s <= high; s++) {
        if (mod12(s) !== rot[0]) continue;
        const v = stack(rot, s);
        if (style === "close") add(v);
        else if (style === "drop2") {
          if (v.length < 3) continue;
          const w = [...v];
          w[w.length - 2] -= 12;
          add(w.sort((a, b) => a - b));
        } else {
          // open: a triad's middle note goes down an octave (1-5-3); four or more: drop 3, drop 2 and 4
          if (v.length === 3) {
            const w = [v[0], v[2], v[1] + 12];
            add(w.sort((a, b) => a - b));
          } else if (v.length >= 4) {
            const d3 = [...v];
            d3[d3.length - 3] -= 12;
            add(d3.sort((a, b) => a - b));
            const d24 = [...v];
            d24[d24.length - 2] -= 12;
            d24[d24.length - 4] -= 12;
            add(d24.sort((a, b) => a - b));
          }
        }
      }
    }
  } else if (style === "shell") {
    // root at the bottom, then the 3rd and 7th either way round; a triad keeps its 5th (1-5-10 or 1-3-5)
    const g = ct.guides.filter((p) => p !== ct.root);
    const fifth = ct.tones.find((t) => t.num === 5)?.pc;
    const pairs: number[][] = g.length >= 2 ? [[g[0], g[1]], [g[1], g[0]]] : g.length === 1 ? (fifth !== undefined ? [[fifth, g[0]], [g[0], fifth]] : [[g[0]]]) : fifth !== undefined ? [[fifth]] : [[]];
    // a chord whose name depends on an altered 5th (dim, aug, ♭5) keeps it
    const altered = ct.tones.find((t) => t.num === 5 && (t.token === "b5" || t.token === "#5"));
    starts((s) => {
      if (mod12(s) !== ct.root) return;
      for (const p of pairs) {
        const order = altered && !p.includes(altered.pc) ? [...p, altered.pc] : p;
        add(stack([ct.root, ...order], s));
      }
    });
  } else {
    // spread: the left hand plays the root with the 5th, 7th or 10th; the right hand the rest, close
    const ts = voiced(ct, 5);
    const rest = ts.filter((t) => t.pc !== ct.root);
    const third = ct.guides[0];
    // the left hand's 5th only when the chord has a perfect one (not over a ♭5 or ♯5)
    const lefts: number[][] = [[0], [0, 12]];
    if (ct.tones.some((t) => t.pc === mod12(ct.root + 7))) lefts.push([0, 7]);
    const sev = ct.guides[1];
    if (sev !== undefined) lefts.push([0, above(ct.root, sev)]);
    if (third !== undefined) lefts.push([0, 12 + above(ct.root, third)]);
    starts((s) => {
      if (mod12(s) !== ct.root) return;
      for (const lh of lefts) {
        const left = lh.map((d) => s + d);
        const lhPcs = new Set(left.map(mod12));
        const right = rest.filter((t) => !lhPcs.has(t.pc));
        if (!right.length) continue;
        for (const rot of rotations(close(right))) {
          const r = stack(rot, left[left.length - 1] + 1);
          if (r[0] - left[left.length - 1] > 12) continue;
          // spread means wider than an octave; anything narrower is a close chord with a new name
          if (r[r.length - 1] - left[0] <= 12) continue;
          add([...left, ...r]);
        }
      }
    });
  }
  return out;
}

/** Put a slash chord's bass under a voicing (or keep a voicing that already has it at the bottom). */
function withBass(v: number[], ct: ChordTones): number[] | null {
  if (ct.bass === undefined) return v;
  if (mod12(v[0]) === ct.bass) return v;
  const bass = v[0] - 1 - mod12(v[0] - 1 - ct.bass);
  const role = ct.tones.find((t) => t.pc === ct.bass);
  // don't double a 3rd or 7th that is now in the bass
  const upper = role && (role.num === 3 || role.num === 7) ? v.filter((m) => mod12(m) !== ct.bass) : v;
  return upper.length ? [bass, ...upper] : null;
}

/** Does a voicing hold every tone its chord can't do without? */
function complete(v: number[], ct: ChordTones, style: KeyStyle): boolean {
  const have = new Set(v.map(mod12));
  for (const t of ct.tones) {
    if (!t.required) continue;
    if (have.has(t.pc)) continue;
    // a shell may lose the 5th; big chords thinned by `voiced` may lose a non-guide colour
    if (t.num === 5 && t.token === "5") continue;
    if (style === "shell" && t.num !== 1 && !ct.guides.includes(t.pc) && t.num !== 5) continue;
    if (ct.tones.length > 5 && !ct.guides.includes(t.pc) && t.num !== 1) continue;
    return false;
  }
  for (const g of ct.guides) if (!have.has(g)) return false;
  return true;
}

/**
 * Is the key at the bottom one the chord can stand on: its root or slash bass, or its 3rd, 5th, 7th
 * (an inversion)? A 9th, 11th or 13th in the bass turns it into another chord (E7♭9 over F is
 * heard as an F chord), so a colour tone never goes at the bottom.
 */
function bassOk(v: number[], ct: ChordTones): boolean {
  const p = mod12(v[0]);
  if (p === ct.root || p === ct.bass) return true;
  const t = ct.tones.find((x) => x.pc === p);
  return !t || t.num < 8;
}

/**
 * Every voicing of a chord in one style inside a register, each a list of MIDI notes from the
 * bottom up, already checked for muddiness and reach. Empty when the style can't fit.
 */
export function keyCandidates(ref: ChordRef, opts: KeyOptions = {}): number[][] {
  const style = opts.style ?? "close";
  const low = opts.low ?? REGISTERS.mid.low;
  const high = opts.high ?? REGISTERS.mid.high;
  const ct = chordTones(ref);
  const seen = new Set<string>();
  const out: number[][] = [];
  // the bass may sit up to an octave under the register, as a pianist's left hand would
  for (const v0 of shapes(ct, style, low, high)) {
    const v = withBass(v0, ct);
    if (!v || v.length > MAX_KEYS) continue;
    if (v[0] < low - (ct.bass !== undefined ? 12 : 0) || v[v.length - 1] > high) continue;
    if (!lowIntervalOk(v) || !outerOk(v) || !bassOk(v, ct) || !playable(v) || !complete(v, ct, style)) continue;
    const k = v.join(",");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

// ── Voice leading ──────────────────────────────────────────────

/**
 * Which voice goes where between two voicings. With the same number of notes, bottom to bottom
 * and top to top (for sorted notes that is the least total movement, and voices never cross).
 * With different numbers, the closest voice splits in two or two voices merge: an alignment
 * that keeps the order and uses every note.
 */
export function matchVoices(a: number[], b: number[]): [number, number][] {
  const A = [...a].sort((x, y) => x - y);
  const B = [...b].sort((x, y) => x - y);
  if (!A.length || !B.length) return [];
  if (A.length === B.length) return A.map((x, i) => [x, B[i]]);
  const big = A.length > B.length ? A : B;
  const small = A.length > B.length ? B : A;
  const n = big.length;
  const m = small.length;
  // f[i][j]: the cheapest way to match big[0..i] with small[0..j], big[i] going to small[j]
  const f: number[][] = Array.from({ length: n }, () => new Array(m).fill(Infinity));
  const from: number[][] = Array.from({ length: n }, () => new Array(m).fill(-1));
  f[0][0] = Math.abs(big[0] - small[0]);
  for (let i = 1; i < n; i++)
    for (let j = 0; j < m; j++) {
      const c = Math.abs(big[i] - small[j]);
      const stay = f[i - 1][j];
      const step = j > 0 ? f[i - 1][j - 1] : Infinity;
      if (stay <= step) {
        f[i][j] = stay + c;
        from[i][j] = j;
      } else {
        f[i][j] = step + c;
        from[i][j] = j - 1;
      }
    }
  const pairs: [number, number][] = [];
  let j = m - 1;
  for (let i = n - 1; i >= 0; i--) {
    pairs.push(A.length > B.length ? [big[i], small[j]] : [small[j], big[i]]);
    j = from[i][j] < 0 ? 0 : from[i][j];
  }
  return pairs.reverse();
}

/** How far the hands travel between two voicings: semitones summed over matched voices (L1). */
export function voicingDistance(a: number[], b: number[]): number {
  return matchVoices(a, b).reduce((s, [x, y]) => s + Math.abs(x - y), 0);
}

/** Parallel fifths or octaves between any two voices that both move (compound intervals count). */
export function parallelPerfects(a: number[], b: number[]): number {
  const pairs = matchVoices(a, b);
  let n = 0;
  for (let i = 0; i < pairs.length; i++)
    for (let j = i + 1; j < pairs.length; j++) {
      const [a1, b1] = pairs[i];
      const [a2, b2] = pairs[j];
      if (a1 === b1 || a2 === b2) continue;
      if (a1 === a2 || b1 === b2) continue;
      const before = mod12(a2 - a1);
      const after = mod12(b2 - b1);
      if ((before === 7 && after === 7) || (before === 0 && after === 0)) n++;
    }
  return n;
}

/** What it costs to move from one voicing to the next (lower is smoother). */
export function moveCost(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const pairs = matchVoices(a, b);
  let cost = pairs.reduce((s, [x, y]) => s + Math.abs(x - y), 0);
  // a held key is worth two semitones of movement
  const held = b.filter((m) => a.includes(m)).length;
  cost -= 2 * held;
  // a smooth top line: leaps of more than a major third in the top voice cost extra
  const top = Math.abs(a[a.length - 1] - b[b.length - 1]);
  if (top > 4) cost += 0.5 * (top - 4);
  cost += 10 * parallelPerfects(a, b);
  // every voice moving the same way at once sounds like the chord sliding, not voices leading
  const dirs = pairs.map(([x, y]) => Math.sign(y - x));
  if (pairs.length > 1 && (dirs.every((d) => d > 0) || dirs.every((d) => d < 0))) cost += 3;
  return cost;
}

/** The note a chord wants at the bottom: its slash bass, or its root. */
const bottomOf = (ref: ChordRef) => pc(ref.bass ?? ref.root);
const isSlash = (ref: ChordRef) => !!ref.bass && pc(ref.bass) !== pc(ref.root);

/**
 * What a voicing costs by itself: distance from the middle of its register, keys outside the
 * register (only a widened search finds those; a slash bass may sit under it), an inversion (a
 * chord is clearest with its root, or its slash bass, at the bottom; `alone`: the chord is shown
 * on its own, with nothing to lead from, where that clarity matters most), and semitone rubs.
 */
function placeCost(v: number[], low: number, high: number, bottom: number, alone = false, slash = false): number {
  const centre = (low + high) / 2;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  let cost = Math.abs(mean - centre) * 0.1;
  const lowest = slash && v.length > 1 ? v[1] : v[0];
  cost += 0.5 * (Math.max(0, low - lowest) + Math.max(0, v[v.length - 1] - high));
  if (mod12(v[0]) !== bottom) cost += alone ? 1.5 : 0.6;
  // a semitone between neighbouring keys rubs: allowed, but a voicing without one is clearer
  cost += 1.5 * rubs(v);
  return cost;
}

function bounds(opts: KeyOptions): { low: number; high: number } {
  const low = opts.low ?? REGISTERS.mid.low;
  const high = Math.max(low + 12, opts.high ?? REGISTERS.mid.high);
  return { low, high };
}

/** Candidates, widening the search when a style can't fit: the register an octave wider, then close position. */
function candidatesOrFallback(ref: ChordRef, opts: KeyOptions): number[][] {
  const style = opts.style ?? "close";
  const { low, high } = bounds(opts);
  let c = keyCandidates(ref, { style, low, high });
  if (!c.length) c = keyCandidates(ref, { style, low: low - 6, high: high + 6 });
  if (!c.length && style !== "close") c = keyCandidates(ref, { style: "close", low, high });
  if (!c.length) c = keyCandidates(ref, { style: "close", low: low - 12, high: high + 12 });
  if (!c.length) {
    // nothing passes the rules (a very narrow register): the chord stacked from its root near the middle
    const ct = chordTones(ref);
    const order = voiced(ct, 5).map((t) => t.pc).sort((a, b) => above(ct.root, a) - above(ct.root, b));
    const mid = Math.round((low + high) / 2) - 6;
    const v = stack(order, mid);
    c = [withBass(v, ct) ?? v];
  }
  return c;
}

const lexLess = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i];
  return a.length < b.length;
};

/**
 * One voicing for a chord: the candidate in the chosen style and register that moves least from
 * `prev` (or, with nothing before it, sits nearest the middle of the register, root at the
 * bottom). Notes from the bottom up, at most eight.
 */
export function pianoVoicing(ref: ChordRef, opts: KeyOptions = {}): number[] {
  const { low, high } = bounds(opts);
  const bottom = bottomOf(ref);
  const slash = isSlash(ref);
  const cands = candidatesOrFallback(ref, opts);
  let best = cands[0];
  let bestCost = Infinity;
  for (const v of cands) {
    const cost = opts.prev?.length ? placeCost(v, low, high, bottom, false, slash) * 0.5 + moveCost(opts.prev, v) : placeCost(v, low, high, bottom, true, slash);
    if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) < 1e-9 && lexLess(v, best))) {
      best = v;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * Voicings for a whole progression, chosen together (Viterbi over every candidate of every chord)
 * so the total cost (movement, held notes, top-line leaps, parallels, distance from the register's
 * middle) is the least possible. A rest (null) gets no keys; the next chord leads on from the one
 * before the rest.
 */
export function arrangeKeys(chords: (ChordRef | null | undefined)[], opts: KeyOptions = {}): number[][] {
  const { low, high } = bounds(opts);
  const idx = chords.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  const out: number[][] = chords.map(() => []);
  if (!idx.length) return out;
  const cands = idx.map((i) => candidatesOrFallback(chords[i]!, opts));
  const node = idx.map((i, k) => cands[k].map((v) => placeCost(v, low, high, bottomOf(chords[i]!), false, isSlash(chords[i]!))));
  // cost[k][j]: the best total ending with candidate j of the k-th chord
  let cost = cands[0].map((v, j) => node[0][j] + (opts.prev?.length ? moveCost(opts.prev, v) : 0));
  const back: number[][] = [cands[0].map(() => -1)];
  for (let k = 1; k < idx.length; k++) {
    const next: number[] = [];
    const from: number[] = [];
    for (let j = 0; j < cands[k].length; j++) {
      let best = Infinity;
      let arg = 0;
      for (let i = 0; i < cands[k - 1].length; i++) {
        const c = cost[i] + moveCost(cands[k - 1][i], cands[k][j]);
        if (c < best - 1e-9) {
          best = c;
          arg = i;
        }
      }
      // node costs count for half once there is a chord before: smoothness matters more than height
      next.push(best + node[k][j] * 0.5);
      from.push(arg);
    }
    cost = next;
    back.push(from);
  }
  let j = 0;
  for (let i = 1; i < cost.length; i++) if (cost[i] < cost[j] - 1e-9) j = i;
  for (let k = idx.length - 1; k >= 0; k--) {
    out[idx[k]] = cands[k][j];
    j = back[k][j];
  }
  return out;
}

/** The total cost a set of voicings pays, as `arrangeKeys` counts it (rests skipped). */
export function totalMoveCost(voicings: number[][]): number {
  const v = voicings.filter((x) => x.length);
  let s = 0;
  for (let i = 1; i < v.length; i++) s += moveCost(v[i - 1], v[i]);
  return s;
}

/** The total distance the hands travel through a set of voicings (rests skipped). */
export function totalMovement(voicings: number[][]): number {
  const v = voicings.filter((x) => x.length);
  let s = 0;
  for (let i = 1; i < v.length; i++) s += voicingDistance(v[i - 1], v[i]);
  return s;
}

/** The keyboard style for a harmony layer's voicing word. */
export function keyStyleOf(voicing: "close" | "open" | "spread" | "shell" | undefined): KeyStyle {
  return voicing ?? "close";
}
