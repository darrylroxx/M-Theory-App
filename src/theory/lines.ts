/**
 * Melody lines Harmonize writes: a second voice below or above a tune, both at once (Stacked), a
 * counter-melody, long notes, an answer in the tune's gaps, and a walk through the chord notes.
 *
 * Every line is chosen for the whole phrase at once (./search), against the notes that really
 * sound: the chords as they are voiced, their bass, the tune and any other line (`around`), with
 * the roughness model of ./consonance. The rules and their weights are the research's (its rules M1–M14):
 *  - a note's place: its interval with the tune (3rds and 6ths best, a unison or a semitone worst),
 *    the roughness it adds, whether it is a chord tone, an available tension or an "avoid" note,
 *    and its register (out of the chords' band, never a step from a chords note);
 *  - a move: steps first, the same interval family kept with the tune, the tune's direction
 *    followed, no parallel 5ths or octaves with the tune or the bass, no hidden ones into a strong
 *    beat by leap, a leap answered by a step back, no three leaps, no melodic tritone (the
 *    definitions of parallel, hidden and crossing follow music21j's voiceLeading, BSD-3; the line
 *    rules follow rl-musician's rules.py, MIT).
 * The three controls (Shape) choose how busy, how wide and how colourful a line is.
 */
import type { MelodyNote } from "../song/melody";
import { TICKS } from "../song/melody";
import type { ChordRef } from "./chords";
import { mod12 } from "./notes";
import { added } from "./consonance";
import { bestPath, bestPath1 } from "./search";
import { avoids, beatStrength, localScale, parallelPerfect, pcsOf, type Ctx, type LineNote, type Shape, type Sounding, type Span } from "./harmonize";

/** What is heard around the line being written, moment by moment. */
export interface Heard {
  /** the chords' notes sounding (the bass included), low to high */
  K: (t: number) => number[];
  /** the lowest chords note sounding */
  bass: (t: number) => number | null;
  /** the other lines sounding (tunes) */
  H: (t: number) => number[];
}
const at = (list: Sounding[], t: number) => list.filter((s) => s.at <= t && t < s.end).map((s) => s.midi);
/**
 * The notes heard around: as given, or (none given, as in an older caller) the chords as a plain
 * guitar or piano plays them: the root low, the rest just above (G3 up).
 */
export function heardOf(around: Sounding[] | undefined, spans: Span[]): Heard {
  const chords = (around ?? []).filter((s) => s.part !== "tune");
  const tunes = (around ?? []).filter((s) => s.part === "tune");
  const fallback: Sounding[] = [];
  if (!chords.length)
    for (const s of spans) {
      if (!s.ref) continue;
      const pcs = pcsOf(s.ref);
      const root = 40 + mod12(pcs[0] - 4);
      fallback.push({ at: s.start, end: s.end, midi: root, part: "bass" });
      for (const p of pcs) fallback.push({ at: s.start, end: s.end, midi: 55 + mod12(p - 7), part: "chords" });
    }
  const ks = chords.length ? chords : fallback;
  return {
    K: (t) => [...new Set(at(ks, t))].sort((a, b) => a - b),
    bass: (t) => {
      const b = at(ks.filter((s) => s.part === "bass"), t);
      const all = at(ks, t);
      return b.length ? Math.min(...b) : all.length ? Math.min(...all) : null;
    },
    H: (t) => at(tunes, t),
  };
}

const leadAt = (lead: LineNote[], t: number): number | null => {
  let m: number | null = null;
  for (const n of lead) {
    if (n.at > t) break;
    if (n.end > t) m = n.midi;
  }
  return m;
};
const refAt = (spans: Span[], t: number): ChordRef | null => spans.find((s) => s.start <= t && t < s.end)?.ref ?? null;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 64;
};

/** One place a line has a note: when, what of the lead is under it, how strong it is. */
interface Slot {
  a: number;
  b: number;
  /** the lead's notes in it: pitch, start, weight (beats, more when strong) */
  leads: { midi: number; at: number; w: number }[];
  /** the lead note sounding as it starts */
  n: number | null;
  strong: boolean;
  /** the lead note sounding as it starts is long (more than a beat): a strong one to the ear */
  nLong: boolean;
  ref: ChordRef | null;
}
function slotsAt(times: number[], ends: number[], lead: LineNote[], spans: Span[], ctx: Ctx): Slot[] {
  return times.map((a, i) => {
    const b = ends[i];
    const leads = lead
      .filter((n) => n.at < b && n.end > a)
      .map((n) => ({ midi: n.midi, at: Math.max(a, n.at), w: ((Math.min(b, n.end) - Math.max(a, n.at)) / TICKS) * (beatStrength(n.at, ctx.bar) >= 2 ? 1.5 : 1) }));
    const on = lead.find((n) => n.at <= a && n.end > a);
    return { a, b, leads, n: leadAt(lead, a), strong: beatStrength(a, ctx.bar) >= 2 || b - a >= TICKS, nLong: !!on && on.end - on.at > TICKS, ref: refAt(spans, a) };
  });
}
const boundaries = (times: number[], end: number) => times.map((_, i) => (i + 1 < times.length ? times[i + 1] : end));

/** Where a harmony line has notes, by how busy it is: every note of the lead (2), quick runs merged (1), or one per chord change and beat group (0). */
function harmonySlots(lead: LineNote[], spans: Span[], ctx: Ctx, busy: number): Slot[] {
  if (!lead.length) return [];
  const short = ctx.compound ? TICKS / 3 : TICKS / 2;
  let times: number[];
  if (busy >= 2) times = lead.map((n) => n.at);
  else if (busy === 1) times = lead.filter((n, i) => i === 0 || !(n.end - n.at < short && lead[i - 1].end - lead[i - 1].at < short && beatStrength(n.at, ctx.bar) === 0)).map((n) => n.at);
  else {
    const set = new Set<number>([lead[0].at, ...spans.map((s) => s.start)]);
    for (let t = 0; t < ctx.len; t += TICKS) if (beatStrength(t, ctx.bar) >= 2) set.add(t);
    times = [...set].filter((t) => t >= lead[0].at && t < ctx.len && leadAt(lead, t) !== null).sort((a, b) => a - b);
  }
  return slotsAt(times, boundaries(times, Math.min(ctx.len, lead[lead.length - 1].end)), lead, spans, ctx);
}

// interval with the lead, by interval class: 3rds and 6ths free, a 5th or 4th a little, a 2nd or 7th, a semitone and a unison dear
const IV = [8, 12, 4, 0, 0, 0.6, 5, 1, 0, 0, 4, 12];
// a tension on a strong note only at the colourful end (the controls: chord tones / tensions on weak notes / on strong notes too)
const T_STRONG = [4, 3, 0.8];
const W_WEAK = [2, 1, 0.6];
const family = (ic: number) => (ic === 3 || ic === 4 ? 0 : ic === 8 || ic === 9 ? 1 : ic === 5 || ic === 7 ? 2 : 3);

interface LineOpts {
  side: 1 | -1;
  band: [number, number];
  shape: Shape;
  /** the interval cost with the lead (by semitones, octaves kept) */
  iv?: (d: number) => number;
  /** extra cost for a candidate in a slot */
  extra?: (i: number, h: number) => number;
  /** other lines to hear (e.g. the other voice of a stack) */
  more?: (t: number) => number[];
  /** a counter-line: contrary motion is the aim, not following */
  counter?: boolean;
  /** extra cost for a move into slot i */
  move?: (i: number, a: number, b: number) => number;
  /** how much the roughness a note adds counts (2.5 when not set) */
  rough?: number;
}

/** The node cost of note h in a slot (see the module notes). */
function nodeCost(s: Slot, h: number, ctx: Ctx, heard: Heard, o: LineOpts, lo: number, hi: number): number {
  let c = 0;
  let wsum = 0;
  const iv = o.iv ?? ((d: number) => IV[mod12(Math.abs(d))]);
  for (const l of s.leads) {
    const sounding = [...heard.K(l.at), l.midi, ...heard.H(l.at), ...(o.more?.(l.at) ?? [])];
    // (a passing note between the strong ones may brush the chords: its roughness counts half)
    c += l.w * (iv(h - l.midi) + (o.rough ?? 2.5) * (s.strong ? 1 : 0.5) * added(h, sounding));
    wsum += l.w;
  }
  if (wsum) c /= wsum;
  else c += 2.5 * added(h, heard.K(s.a));
  const K = heard.K(s.a);
  const p = mod12(h);
  const chord = s.ref ? pcsOf(s.ref) : [];
  const local = localScale(ctx.seven, s.ref);
  const inChord = chord.includes(p);
  const rubK = K.some((k) => [1, 13].includes(Math.abs(h - k)));
  const tension = local.includes(p) && !avoids(p, chord) && !rubK;
  const colour = o.shape.colour;
  if (s.strong) c += inChord ? 0 : tension ? T_STRONG[colour] : 3;
  else c += inChord ? 0 : local.includes(p) ? 0.8 * W_WEAK[colour] : 3;
  if (!inChord && avoids(p, chord)) c += s.strong ? 3 : 1;
  const allowed = local.includes(p) || chord.includes(p);
  if (!allowed) c += 20;
  if (K.length && h >= K[0] - 1 && h <= K[K.length - 1] + 1) c += 0.8;
  if (K.some((k) => k !== h && Math.abs(h - k) <= 2)) c += s.strong ? 5 : 0.5;
  // consonant with the tune on a strong note, always
  if ((s.strong || s.nLong) && s.n !== null && [1, 2, 6, 10, 11].includes(mod12(Math.abs(h - s.n)))) c += 12;
  // the clashes the ear catches whatever the beat: a tritone over the bass, a #9 under the chord's major 3rd (outside the chord)
  // a note rings until the next one: what it clashes with while it rings (beat by beat) counts too
  for (let t = s.a; t < s.b; t += TICKS) {
    const Kt = t === s.a ? K : heard.K(t);
    const bass = t === s.a ? heard.bass(s.a) : heard.bass(t);
    const bt = Kt.length && Kt.includes(h) ? 0 : 1;
    if (bt && Kt.some((k) => h > k && mod12(h - k) === 1)) c += 2.5;
    if (bt && bass !== null && mod12(h - bass) === 6 && !Kt.some((k) => mod12(k - h) === 0)) c += 2;
  }
  if (!inChord && s.ref && chord.includes(mod12(chord[0] + 4)) && mod12(h - chord[0]) === 3) c += 3;
  if (s.n !== null) {
    const d = o.side * (h - s.n);
    c += 0.35 * Math.max(0, d - o.band[1]) + 0.6 * Math.max(0, o.band[0] - d);
    if (d < 0) c += 6;
    if (h === s.n) c += 8;
    if (o.side < 0 && s.n < 60 && [3, 4].includes(s.n - h)) c += 4;
  }
  c += Math.max(0, 50 - h);
  if (h < lo || h > hi) c += 3 + 0.15 * (h < lo ? lo - h : h - hi);
  return c + (o.extra?.(-1, h) ?? 0);
}

/** A line over the slots, by search: candidates on the line's side of the lead, priced as a whole phrase. */
function searchLine(slots: Slot[], lead: LineNote[], ctx: Ctx, heard: Heard, o: LineOpts): MelodyNote[] {
  if (!slots.length) return [];
  const leadMidis = lead.map((n) => n.midi);
  const lo0 = leadMidis.length ? Math.min(...leadMidis) : 55;
  const hi0 = leadMidis.length ? Math.max(...leadMidis) : 79;
  const lo = Math.max(36, lo0 - 12);
  const hi = Math.min(96, hi0 + 12);
  // comfortable: within a sixth of where the lead goes
  const cLo = lo0 - 9;
  const cHi = hi0 + 9;
  const cands = slots.map((s) => {
    const local = localScale(ctx.seven, s.ref);
    const chord = s.ref ? pcsOf(s.ref) : [];
    const ok = (h: number) => h >= lo && h <= hi && (local.includes(mod12(h)) || chord.includes(mod12(h)));
    const out: number[] = [];
    const n = s.n ?? Math.round((lo0 + hi0) / 2);
    for (let d = o.band[0]; d <= o.band[1] + 2; d++) if (ok(n + o.side * d)) out.push(n + o.side * d);
    for (let d = 3; d <= 5; d++) if (ok(n - o.side * d)) out.push(n - o.side * d);
    if (!out.length) for (let h = n - 12; h <= n + 12; h++) if (ok(h) && h !== n) out.push(h);
    return out.length ? out : [n + o.side * 3];
  });
  const node = (i: number, h: number) => nodeCost(slots[i], h, ctx, heard, { ...o, extra: o.extra && ((_, x) => o.extra!(i, x)) }, cLo, cHi);
  const edge = (i: number, z: number | null, a: number, b: number) => {
    const sa = slots[i - 1];
    const sb = slots[i];
    const step = Math.abs(b - a);
    let c = step <= 2 ? 0 : step <= 4 ? 0.3 : step <= 7 ? 1 : 3;
    if (step === 6) c += 2;
    const na = sa.n;
    const nb = sb.n;
    if (na !== null && nb !== null) {
      const moved = nb - na;
      if (o.counter) c += (b - a) * moved > 0 ? 0.4 : (b - a) * moved < 0 ? -0.4 : 0;
      else {
        if (family(mod12(Math.abs(b - nb))) !== family(mod12(Math.abs(a - na)))) c += 2.5;
        if ((b - a) * moved < 0) c += 0.7;
        if (b === a && moved !== 0) c += 0.3;
      }
      if (o.counter && moved === 0 && b !== a) c -= 0.3;
      if (parallelPerfect(na, a, nb, b)) c += 10;
      // a hidden 5th or octave: into one by similar motion, the line leaping, on a strong slot
      const ic = mod12(Math.abs(b - nb));
      if (sb.strong && (ic === 0 || ic === 7) && (b - a) * moved > 0 && step > 2) c += 2;
    }
    const ba = heardBass(sa);
    const bb = heardBass(sb);
    if (ba !== null && bb !== null && parallelPerfect(ba, a, bb, b) && mod12(Math.abs(b - bb)) === 7) c += 10;
    if (o.move) c += o.move(i, a, b);
    if (z !== null) {
      const l1 = a - z;
      if (Math.abs(l1) > 4 && !(Math.sign(b - a) === -Math.sign(l1) && step <= 2)) c += 1;
      // two leaps in a row
      if (Math.abs(l1) > 2 && step > 2) c += 0.5;
    }
    return c;
  };
  const heardBass = (s: Slot) => heard.bass(s.a);
  const { path } = bestPath(cands, node, edge);
  return path.map((midi, i) => ({ at: slots[i].a, midi }));
}

const BANDS: [number, number][] = [[3, 5], [3, 9], [8, 16]];

/** A second voice below (side −1) or above (+1) the lead. */
// a second voice keeps to 3rds and 6ths: a 4th or 5th with the tune is hollow there
const IV_PAIR = [8, 12, 4, 0, 0, 1.5, 5, 2, 0, 0, 4, 12];
export function harmonyLine(lead: LineNote[], spans: Span[], ctx: Ctx, heard: Heard, shape: Shape, side: 1 | -1): MelodyNote[] {
  return searchLine(harmonySlots(lead, spans, ctx, shape.busy), lead, ctx, heard, { side, band: BANDS[shape.wide], shape, iv: (d) => IV_PAIR[mod12(Math.abs(d))], rough: 5 });
}

/** A voice below and one above, in the lead's rhythm: a close triad around it (wider: a sixth below). */
export function stackLines(lead: LineNote[], spans: Span[], ctx: Ctx, heard: Heard, shape: Shape): MelodyNote[] {
  const slots = harmonySlots(lead, spans, ctx, shape.busy);
  const low = searchLine(slots, lead, ctx, heard, { side: -1, band: shape.wide >= 2 ? [8, 10] : [3, 5], shape, iv: (d) => IV_PAIR[mod12(Math.abs(d))], rough: 5 });
  const lowAt = (t: number) => {
    let m: number[] = [];
    for (const n of low) if (n.at <= t) m = [n.midi];
    return m;
  };
  const high = searchLine(slots, lead, ctx, heard, {
    side: 1, band: [3, 5], shape, more: lowAt, iv: (d) => IV_PAIR[mod12(Math.abs(d))], rough: 5,
    extra: (i, h) => {
      const l = low[i]?.midi;
      return l !== undefined && h - l > 12 ? 3 : 0;
    },
  });
  return [...low, ...high];
}

/** Counter-melody: a line of its own, on the other side of the tune, moving where the tune holds. */
export function counterLine2(lead: LineNote[], spans: Span[], ctx: Ctx, heard: Heard, shape: Shape): MelodyNote[] {
  if (!lead.length) return [];
  const onsets = new Set(lead.map((n) => n.at));
  const set = new Set<number>([lead[0].at, ...spans.filter((s) => s.ref).map((s) => s.start)]);
  const step = shape.busy >= 2 ? (ctx.compound ? TICKS / 3 : TICKS / 2) : TICKS;
  for (let t = 0; t < ctx.len; t += step) {
    const beat = t % TICKS === 0;
    if (shape.busy >= 1 && beat && beatStrength(t, ctx.bar) >= 2) set.add(t);
    // where the tune holds (no new note here), the counter-line moves
    if (shape.busy >= 1 && beat && !onsets.has(t)) set.add(t);
    if (shape.busy >= 2 && !onsets.has(t)) set.add(t);
  }
  const times = [...set].filter((t) => t >= lead[0].at && t < ctx.len).sort((a, b) => a - b);
  const slots = slotsAt(times, boundaries(times, ctx.len), lead, spans, ctx);
  const side: 1 | -1 = median(lead.map((n) => n.midi)) >= 64 ? -1 : 1;
  const band: [number, number] = ([[3, 9], [3, 12], [8, 19]] as [number, number][])[shape.wide];
  return searchLine(slots, lead, ctx, heard, {
    side, band, shape, counter: true, rough: 5,
    iv: (d) => (d === 0 ? 8 : mod12(Math.abs(d)) === 0 ? 6 : IV[mod12(Math.abs(d))]),
    extra: (i, _h) => (slots[i] && onsets.has(slots[i].a) ? 0.5 : 0),
  });
}

/** The notes of a chord a long line may hold, by colour: the 3rd, root or 5th; the 3rd and 7th; the 7th, 9th or 13th. */
function guideTones(ref: ChordRef, ctx: Ctx, colour: number): { p: number; cost: number }[] {
  const chord = pcsOf(ref);
  const r = chord[0];
  const local = localScale(ctx.seven, ref);
  const third = chord.find((p) => [3, 4].includes(mod12(p - r))) ?? chord[1] ?? r;
  const fifth = chord.find((p) => [6, 7, 8].includes(mod12(p - r))) ?? r;
  const seventh = chord.find((p) => [10, 11, 9].includes(mod12(p - r))) ?? local.find((p) => [10, 11].includes(mod12(p - r)));
  const ninth = local.find((p) => mod12(p - r) === 2);
  const thirteenth = local.find((p) => mod12(p - r) === 9);
  const safe = (p: number | undefined) => p !== undefined && !avoids(p, chord);
  if (colour <= 0) return [{ p: third, cost: 0 }, { p: r, cost: 0.4 }, { p: fifth, cost: 0.6 }];
  if (colour === 1) return [{ p: third, cost: 0 }, ...(seventh !== undefined && chord.includes(seventh) ? [{ p: seventh, cost: 0 }] : [{ p: fifth, cost: 0.5 }]), { p: r, cost: 0.8 }];
  return [
    ...(safe(seventh) ? [{ p: seventh!, cost: chord.includes(seventh!) ? 0 : 0.3 }] : []),
    ...(safe(ninth) ? [{ p: ninth!, cost: 0.2 }] : []),
    ...(safe(thirteenth) && ref.typeId !== "min" && ref.typeId !== "m7" ? [{ p: thirteenth!, cost: 0.4 }] : []),
    { p: third, cost: 0.6 },
  ];
}

/** Long notes: one held note per chord (struck again each bar, or twice in a long chord), out of the chords' and the tune's way. */
export function longLine(lead: LineNote[], spans: Span[], ctx: Ctx, heard: Heard, shape: Shape): MelodyNote[] {
  const barTicks = Math.round(ctx.bar * TICKS);
  const pieces: { a: number; b: number; ref: ChordRef }[] = [];
  for (const s of spans) {
    if (!s.ref) continue;
    const last = pieces[pieces.length - 1];
    if (shape.busy === 0 && last && last.b === s.start && pcsOf(last.ref).join() === pcsOf(s.ref).join()) {
      last.b = s.end;
      continue;
    }
    if (shape.busy === 0) {
      pieces.push({ a: s.start, b: s.end, ref: s.ref });
      continue;
    }
    for (let a = s.start; a < s.end; ) {
      const bar = Math.min(s.end, (Math.floor(a / barTicks) + 1) * barTicks);
      const half = shape.busy >= 2 && bar - a >= 2 * TICKS ? a + Math.round((bar - a) / 2 / TICKS) * TICKS : bar;
      pieces.push({ a, b: half, ref: s.ref });
      a = half;
    }
  }
  if (!pieces.length) return [];
  const tune = lead.length ? lead : [];
  const ks = pieces.map((x) => heard.K(x.a));
  const maxK = Math.max(...ks.flat(), 48);
  const med = tune.length ? median(tune.map((n) => n.midi)) : maxK + 12;
  const band: [number, number] = ([[3, 9], [3, 12], [10, 19]] as [number, number][])[shape.wide];
  // between the chords and the tune when there is room; else above the tune
  const side: 1 | -1 = !tune.length || med - band[0] >= maxK + 3 ? -1 : 1;
  const centre = tune.length ? med + side * (band[0] + band[1]) / 2 : maxK + 7;
  const cands = pieces.map((x) => {
    const out: { h: number; cost: number }[] = [];
    for (const g of guideTones(x.ref, ctx, shape.colour)) for (let h = 48; h <= 88; h++) if (mod12(h) === g.p && Math.abs(h - centre) <= 9) out.push({ h, cost: g.cost });
    return out.length ? out : [{ h: Math.round(centre), cost: 3 }];
  });
  const node = (i: number, c: { h: number; cost: number }) => {
    const x = pieces[i];
    let s = c.cost + 0.08 * Math.abs(c.h - centre);
    // never coming in on the tune's own note (or its octave)
    const on = leadAt(tune, x.a);
    if (on !== null && mod12(c.h - on) === 0) s += 5;
    if (on !== null && [1, 11, 6].includes(mod12(Math.abs(c.h - on)))) s += 5;
    const notes = tune.filter((n) => n.at < x.b && n.end > x.a);
    let w = 0;
    let v = 0;
    for (const n of notes) {
      const len = (Math.min(x.b, n.end) - Math.max(x.a, n.at)) / TICKS;
      const d = c.h - n.midi;
      const ic = mod12(Math.abs(d));
      let k = d === 0 ? 10 : ic === 0 ? 7 : IV[ic];
      if (Math.sign(d) !== side && d !== 0) k += 6;
      v += len * (k + 2.5 * added(c.h, [n.midi, ...heard.K(Math.max(x.a, n.at))]));
      w += len;
    }
    s += w ? v / w : 2.5 * added(c.h, heard.K(x.a));
    if (heard.K(x.a).some((k) => k !== c.h && Math.abs(c.h - k) <= 2)) s += 1.5;
    return s;
  };
  const edge = (i: number, a: { h: number }, b: { h: number }) => {
    const step = Math.abs(b.h - a.h);
    let c = step === 0 ? 0 : step <= 2 ? 0.2 : step <= 4 ? 0.6 : step <= 7 ? 1.5 : 3;
    if (step === 6) c += 2;
    const na = leadAt(tune, pieces[i - 1].a);
    const nb = leadAt(tune, pieces[i].a);
    if (na !== null && nb !== null && parallelPerfect(na, a.h, nb, b.h)) c += 10;
    const ba = heard.bass(pieces[i - 1].a);
    const bb = heard.bass(pieces[i].a);
    if (ba !== null && bb !== null && parallelPerfect(ba, a.h, bb, b.h)) c += 10;
    return c;
  };
  const { path } = bestPath1(cands, node, edge);
  return path.map((c, i) => ({ at: pieces[i].a, midi: c.h }));
}

/** Chord notes: a walk through each chord's notes (with 7ths, then 9ths, as colour rises), above the chords, away from the tune. */
export function chordWalk(lead: LineNote[], spans: Span[], ctx: Ctx, heard: Heard, shape: Shape): MelodyNote[] {
  const step = shape.busy === 0 ? 0 : shape.busy === 1 ? TICKS : ctx.compound ? TICKS / 3 : TICKS / 2;
  const times: number[] = [];
  for (const s of spans) {
    if (!s.ref) continue;
    if (!step) {
      let t = s.start;
      while (t < s.end) {
        times.push(t);
        let u = t + TICKS;
        while (u < s.end && beatStrength(u, ctx.bar) < 2) u += TICKS;
        t = u;
      }
    } else for (let t = s.start; t < s.end; t += step) times.push(t);
  }
  if (!times.length) return [];
  const slots = slotsAt(times, boundaries(times, ctx.len), lead, spans, ctx);
  const maxK = Math.max(48, ...times.map((t) => Math.max(...heard.K(t), 0)));
  const span = [12, 16, 24][shape.wide];
  const med = lead.length ? median(lead.map((n) => n.midi)) : maxK + 12;
  const leadHi = lead.length ? Math.max(...lead.map((n) => n.midi)) : maxK;
  const leadLo = lead.length ? Math.min(...lead.map((n) => n.midi)) : maxK + 12;
  // over the tune when there is room up there (out of the chords' way); else under it, over the chords
  const over = !lead.length || leadHi + 3 + 7 <= 88;
  const lo = over ? Math.max(52, lead.length ? leadHi + 3 : maxK + 1) : Math.max(52, Math.min(maxK + 1, leadLo - 3 - span));
  const hi = over ? Math.min(91, lo + span) : Math.max(lo + 7, leadLo - 3);
  const cands = slots.map((s) => {
    const chord = s.ref ? pcsOf(s.ref) : [];
    const local = localScale(ctx.seven, s.ref);
    const r = chord[0];
    const extra = shape.colour >= 1 ? local.filter((p) => [10, 11].includes(mod12(p - r))) : [];
    const nine = shape.colour >= 2 ? local.filter((p) => mod12(p - r) === 2 && !avoids(p, chord)) : [];
    // colour notes only between the strong beats
    const pcs = new Set(s.strong ? chord : [...chord, ...extra, ...nine]);
    const under = !over;
    const lead = [s.n, ...s.leads.map((l) => l.midi)].filter((m): m is number => m !== null);
    const out: number[] = [];
    for (let h = lo; h <= hi; h++) if (pcs.has(mod12(h)) && lead.every((l) => (under ? h <= l - 3 : h >= l + 3))) out.push(h);
    if (!out.length) for (let h = lo; h <= hi; h++) if (pcs.has(mod12(h))) out.push(h);
    return out.length ? out : [lo];
  });
  const node = (i: number, h: number) => {
    const s = slots[i];
    let c = 2.5 * added(h, [...heard.K(s.a), ...(s.n !== null ? [s.n] : []), ...heard.H(s.a)]);
    for (const l of s.leads) c += (s.strong ? 1 : 0.4) * IV[mod12(Math.abs(h - l.midi))] * Math.min(1, l.w);
    if (s.n !== null) {
      const d = Math.abs(h - s.n);
      if (d <= 2) c += 3;
      if (mod12(d) === 0) c += 4;
      if (h > s.n && med > maxK + 6) c += 2;
    }
    if (s.ref && !pcsOf(s.ref).includes(mod12(h))) c += s.strong ? 1.2 - 0.4 * shape.colour : 0.3;
    return c;
  };
  const edge = (i: number, z: number | null, a: number, b: number) => {
    const d = Math.abs(b - a);
    let c = d === 0 ? 0.8 : d <= 4 ? 0 : d <= 7 ? 0.8 : 2;
    if (z !== null && Math.sign(b - a) === Math.sign(a - z) && Math.abs(b - z) > 9) c += 0.5;
    const na = slots[i - 1].n;
    const nb = slots[i].n;
    if (na !== null && nb !== null && parallelPerfect(na, a, nb, b)) c += 10;
    const ba = heard.bass(slots[i - 1].a);
    const bb = heard.bass(slots[i].a);
    if (ba !== null && bb !== null && ba !== bb && parallelPerfect(ba, a, bb, b) && mod12(Math.abs(b - bb)) === 7) c += 10;
    return c;
  };
  return bestPath(cands, node, edge).path.map((midi, i) => ({ at: slots[i].a, midi }));
}

/**
 * Answer: the tune's last few notes echoed in its gaps (and, busier, over its long notes and at
 * the end of every second bar), in their rhythm and shape, chosen like any line against what
 * sounds there. There is always somewhere to answer: with no gap at all, it answers at the end of
 * every second bar.
 */
export function answerLine2(lead: LineNote[], spans: Span[], ctx: Ctx, heard: Heard, shape: Shape): MelodyNote[] {
  if (!lead.length) return [];
  const barTicks = Math.round(ctx.bar * TICKS);
  const windows: [number, number][] = [];
  for (const n of lead) {
    const len = n.end - n.at;
    const toBar = n.end % barTicks === 0 || n.end === ctx.len;
    if (len >= (toBar ? 2 : 3) * TICKS) windows.push([Math.ceil((n.at + TICKS) / TICKS) * TICKS, n.end]);
    else if (shape.busy >= 1 && len >= 1.5 * TICKS) windows.push([n.at + TICKS, n.end]);
  }
  const lastBeats = () => {
    for (let b = 2; b * barTicks <= ctx.len; b += 2) windows.push([b * barTicks - TICKS, b * barTicks]);
  };
  if (shape.busy >= 2 || !windows.length) lastBeats();
  const side: 1 | -1 = median(lead.map((n) => n.midi)) >= 62 ? -1 : 1;
  const band: [number, number] = ([[3, 5], [3, 9], [8, 16]] as [number, number][])[shape.wide];
  const times: number[] = [];
  const ends: number[] = [];
  const shapes: number[] = [];
  let taken = -1;
  for (const [g0, g1] of windows.sort((x, y) => x[0] - y[0])) {
    if (g0 < taken || g1 - g0 < ctx.unit) continue;
    // the motif: the last notes before the gap (up to three, within a bar), in their rhythm, squeezed to fit
    const motif = lead.filter((x) => x.at < g0 && x.at >= g0 - barTicks).slice(-3);
    const src = motif.length ? motif : [{ at: g0, end: g1, midi: leadAt(lead, g0) ?? lead[0].midi }];
    const span = src[src.length - 1].at - src[0].at;
    const room = Math.max(0, g1 - g0 - ctx.unit);
    const k = span > 0 ? Math.min(1, room / span) : 1;
    let last = -1;
    src.forEach((x, i) => {
      let t = g0 + Math.floor(((x.at - src[0].at) * k) / ctx.unit) * ctx.unit;
      // (never on a note of the tune: an answer comes in between)
      if (t >= g1 || t <= last || lead.some((n) => n.at === t)) return;
      if (times.length && last >= 0) ends[ends.length - 1] = t;
      times.push(t);
      ends.push(g1);
      shapes.push(i > 0 ? x.midi - src[i - 1].midi : NaN);
      last = t;
    });
    taken = g1;
  }
  // one line through every answer, so it also moves well from one to the next
  // (each note rings until the next: that is what it is heard against)
  void ends;
  const slots = slotsAt(times, boundaries(times, ctx.len), lead, spans, ctx);
  return searchLine(slots, lead, ctx, heard, { side, band, shape, move: (i, x, y) => (Number.isNaN(shapes[i]) ? 0 : 0.4 * Math.abs(y - x - shapes[i])) });
}
