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
  /** on a beat group's start, or a beat long or more (M3, M4: consonant, and a chord tone or a tension) */
  strong: boolean;
  /**
   * on the downbeat or a beat group's start, or longer than a beat: a chord tone. (A plain quarter
   * note on beat 2 or 4 is strong but not accented: a line of 3rds may pass through it on a note
   * of the scale, as a passing note does, but never rub the chords there.)
   */
  accent: boolean;
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
    const accent = beatStrength(a, ctx.bar) >= 2 || b - a > TICKS;
    return { a, b, leads, n: leadAt(lead, a), strong: accent || b - a >= TICKS, accent, nLong: !!on && on.end - on.at > TICKS, ref: refAt(spans, a) };
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
// a tension on a strong note only at the colourful end (the controls: chord tones / tensions on weak
// notes / tensions sought, on strong notes too): what a note outside the chord costs on a strong and a weak slot
const T_STRONG = [4, 3, 0.6];
const W_WEAK = [2, 0.8, -0.3];
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
  /** slots where the line may hold its last note (an answer's tail): holding costs nothing, a new note is a resolution */
  tail?: Set<number>;
  /** the candidates of a slot, when not the line's own band */
  cands?: (i: number) => number[] | null;
}

/** The moments a note from a to b is heard against: its start and every beat it rings over. */
const ringTimes = (a: number, b: number) => {
  const out = [a];
  for (let t = Math.ceil((a + 1) / TICKS) * TICKS; t < b; t += TICKS) out.push(t);
  return out;
};

/** The node cost of note h in a slot (see the module notes). */
function nodeCost(s: Slot, h: number, ctx: Ctx, heard: Heard, o: LineOpts, lo: number, hi: number): number {
  let c = 0;
  let wsum = 0;
  // a clash with a tune note that comes in on a strong beat while this note rings is heard as one,
  // however many easy notes it also rings under: it is counted whole, not averaged away
  let hit = 0;
  const iv = o.iv ?? ((d: number) => IV[mod12(Math.abs(d))]);
  for (const l of s.leads) {
    const sounding = [...heard.K(l.at), l.midi, ...heard.H(l.at), ...(o.more?.(l.at) ?? [])];
    // (a passing note between the strong ones may brush the chords: its roughness counts half)
    c += l.w * (iv(h - l.midi) + (o.rough ?? 2.5) * (s.strong ? 1 : 0.5) * added(h, sounding));
    wsum += l.w;
    if (l.at > s.a && beatStrength(l.at, ctx.bar) >= 2 && [1, 6, 11].includes(mod12(Math.abs(h - l.midi)))) hit += 8;
  }
  if (wsum) c /= wsum;
  else c += 2.5 * added(h, heard.K(s.a));
  c += hit;
  const K = heard.K(s.a);
  const p = mod12(h);
  const chord = s.ref ? pcsOf(s.ref) : [];
  const local = localScale(ctx.seven, s.ref);
  const inChord = chord.includes(p);
  const rubK = K.some((k) => [1, 13].includes(Math.abs(h - k)));
  const tension = local.includes(p) && !avoids(p, chord) && !rubK;
  const colour = o.shape.colour;
  if (s.accent) c += inChord ? 0 : tension ? T_STRONG[colour] : 3;
  else if (s.strong) c += inChord ? 0 : tension ? (T_STRONG[colour] + W_WEAK[colour]) / 2 : 3;
  else c += inChord ? 0 : local.includes(p) ? W_WEAK[colour] : 3;
  // an avoid note (a semitone above a chord tone) rubs as a minor 9th (passing between the strong beats, less: M5 prices how it is reached)
  if (!inChord && avoids(p, chord)) c += s.accent ? 3 : s.strong ? 2 : 1;
  const allowed = local.includes(p) || chord.includes(p);
  if (!allowed) c += 20;
  // out of the chords' band (M11)
  if (K.length && h >= K[0] - 1 && h <= K[K.length - 1] + 1) c += s.accent ? 1.2 : 0.8;
  if (K.some((k) => k !== h && Math.abs(h - k) <= 2)) c += s.accent ? 5 : s.strong ? 1.5 : 0.5;
  // a minor 2nd or 9th with a chords note rubs whichever is on top (B3 under C4, G4 under A♭4)
  if (K.some((k) => Math.abs(h - k) === 1 || Math.abs(h - k) === 13)) c += s.strong ? 5 : 2.5;
  // consonant with the tune on a strong note, always (crossing it is better than that)
  if ((s.strong || s.nLong) && s.n !== null && [1, 2, 6, 10, 11].includes(mod12(Math.abs(h - s.n)))) c += 20;
  // the clashes the ear catches whatever the beat: a minor 2nd or 9th with a chords note, a tritone
  // over the bass, a #9 under the chord's major 3rd (outside the chord). A note rings until the next
  // one: what it clashes with while it rings (at each beat, more on a strong one) counts too.
  for (const t of ringTimes(s.a, s.b)) {
    const Kt = t === s.a ? K : heard.K(t);
    const bass = heard.bass(t);
    // (a passing note between the beats brushes past; one still ringing on a strong beat is heard there)
    const w = t === s.a ? (s.strong ? 1 : 0.4) : beatStrength(t, ctx.bar) >= 2 ? 2.5 : 1;
    const bt = Kt.length && Kt.includes(h) ? 0 : 1;
    // (at the onset a minor 2nd or 9th with a chords note is priced above, with the other rubs)
    if (bt && Kt.some((k) => (h > k && mod12(h - k) === 1) || (t !== s.a && (Math.abs(h - k) === 1 || Math.abs(h - k) === 13)))) c += 2.5 * w;
    if (bt && bass !== null && mod12(h - bass) === 6 && !Kt.some((k) => mod12(k - h) === 0)) c += 2 * w;
  }
  if (!inChord && s.ref && chord.includes(mod12(chord[0] + 4)) && mod12(h - chord[0]) === 3) c += 3;
  if (s.n !== null) {
    const d = o.side * (h - s.n);
    c += 0.35 * Math.max(0, d - o.band[1]) + 0.6 * Math.max(0, o.band[0] - d);
    if (d < 0) c += 6;
    if (h === s.n) c += 8;
    // a 3rd under a low tune is muddy (M10)
    if (o.side < 0 && s.n < 60 && [3, 4].includes(s.n - h)) c += 4;
  }
  // a sung part's range (M10, M12): nothing under D3 (unless the tune itself goes that low), little over A5
  const floor = Math.min(50, lo);
  if (h < floor) c += 3 * (floor - h);
  if (h > 81) c += 0.8 * (h - 81) + (h > 86 ? 2 * (h - 86) : 0);
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
  const chords = slots.map((s) => (s.ref ? pcsOf(s.ref) : []));
  const cands = slots.map((s, i) => {
    const local = localScale(ctx.seven, s.ref);
    const ok = (h: number) => h >= lo && h <= hi && (local.includes(mod12(h)) || chords[i].includes(mod12(h)));
    const given = o.cands?.(i);
    if (given) {
      const g = given.filter(ok);
      if (g.length) return g;
    }
    const out: number[] = [];
    const n = s.n ?? Math.round((lo0 + hi0) / 2);
    // the band, a step either side of it (a 2nd is for passing; the tritone only when the band holds it)
    for (let d = Math.max(2, o.band[0] - 1); d <= o.band[1] + 1; d++) if ((d !== 6 || (o.band[0] <= 6 && 6 <= o.band[1])) && ok(n + o.side * d)) out.push(n + o.side * d);
    // (a wide band may close to a 3rd where nothing at its own distance fits)
    if (o.band[0] > 5) for (let d = 3; d <= 4; d++) if (ok(n + o.side * d)) out.push(n + o.side * d);
    for (let d = 3; d <= 5; d++) if (ok(n - o.side * d)) out.push(n - o.side * d);
    if (!out.length) for (let h = n - 12; h <= n + 12; h++) if (ok(h) && h !== n) out.push(h);
    return out.length ? out : [n + o.side * 3];
  });
  const node = (i: number, h: number) => nodeCost(slots[i], h, ctx, heard, { ...o, ...(o.tail?.has(i) ? { iv: TAIL_IV } : {}), extra: o.extra && ((_, x) => o.extra!(i, x)) }, cLo, cHi);
  const outside = (i: number, h: number) => !!slots[i].ref && !chords[i].includes(mod12(h));
  const edge = (i: number, z: number | null, a: number, b: number) => {
    const sa = slots[i - 1];
    const sb = slots[i];
    const step = Math.abs(b - a);
    // an answer's tail: holding on is free, a new note there is a resolution (by step, best), never into parallels
    if (o.tail?.has(i)) {
      if (b === a) return 0;
      let c = 1 + (step <= 2 ? 0 : step <= 4 ? 0.5 : 2);
      const ba = heard.bass(sa.a);
      const bb = heard.bass(sb.a);
      if (ba !== null && bb !== null && parallelPerfect(ba, a, bb, b)) c += 10;
      if (sa.n !== null && sb.n !== null && parallelPerfect(sa.n, a, sb.n, b)) c += 10;
      // (the note before was held from further back: what it began against counts too)
      if (z === a && i >= 2) {
        const bz = heard.bass(slots[i - 2].a);
        if (bz !== null && bb !== null && parallelPerfect(bz, a, bb, b)) c += 10;
      }
      return c;
    }
    let c = step <= 2 ? 0 : step <= 4 ? 0.3 : step <= 7 ? 1 : 3;
    if (step === 6) c += 2;
    const na = sa.n;
    const nb = sb.n;
    if (na !== null && nb !== null) {
      const moved = nb - na;
      if (o.counter) {
        c += (b - a) * moved > 0 ? 0.4 : (b - a) * moved < 0 ? -0.4 : 0;
        // a counter-line moves where the tune holds, and never strikes one note again and again
        if (b === a) c += moved === 0 ? 2 : 1.2;
      } else {
        // one kind kept, 3rds or 6ths (M7): a switch between them is dear; a 4th taken as an escape
        // is priced on its own, and the line goes back to its kind at the next note that allows it
        const fa = family(mod12(Math.abs(a - na)));
        const fb = family(mod12(Math.abs(b - nb)));
        if (fa !== fb) c += fa <= 1 && fb <= 1 ? 2.5 : 0.4;
        if ((b - a) * moved < 0) c += 0.7;
        // the tune moves on and the voice stays put: a drone, not a second voice
        if (b === a && moved !== 0) c += 1.2;
      }
      if (o.counter && moved === 0 && b !== a) c -= 0.3;
      if (parallelPerfect(na, a, nb, b)) c += 10;
      // (and against the tune note just before, when the tune moved on while this note was held;
      // and, for a line whose repeated notes are held, against the tune where the note before began)
      const nz = leadAt(lead, sb.a - 1);
      if (nz !== null && nz !== na && parallelPerfect(nz, a, nb, b)) c += 10;
      if (o.counter && z !== null && z === a && i >= 2) {
        const ny = slots[i - 2].n;
        if (ny !== null && parallelPerfect(ny, a, nb, b)) c += 10;
      }
      // a hidden 5th or octave: into one by similar motion, the line leaping, on a strong slot
      const ic = mod12(Math.abs(b - nb));
      if (sb.strong && (ic === 0 || ic === 7) && (b - a) * moved > 0 && step > 2) c += 2;
    }
    // parallel 5ths or octaves with the bass (M9): two voices heard as one
    const ba = heard.bass(sa.a);
    const bb = heard.bass(sb.a);
    if (ba !== null && bb !== null && parallelPerfect(ba, a, bb, b)) c += 14;
    // a note outside the chord between the strong ones is a passing or neighbour note: reached and left by step (M5)
    if (!sb.accent && outside(i, b) && step > 2) c += 1.5;
    if (!sa.accent && outside(i - 1, a) && step > 2) c += 0.8;
    if (o.move) c += o.move(i, a, b);
    if (z !== null) {
      const l1 = a - z;
      if (Math.abs(l1) > 4 && !(Math.sign(b - a) === -Math.sign(l1) && step <= 2)) c += 1;
      // two leaps in a row
      if (Math.abs(l1) > 2 && step > 2) c += 0.5;
    }
    return c;
  };
  const { path } = bestPath(cands, node, edge);
  return path.map((midi, i) => ({ at: slots[i].a, midi }));
}

// a held note under the tune: a unison or an octave is fine there (it was struck before the tune
// came to it); a 2nd, a 7th or a tritone is not
const TAIL_IV = (d: number) => [2, 12, 3, 0, 0, 0.5, 6, 0.5, 0, 0, 3, 12][mod12(Math.abs(d))];

/** A line with each note struck again on the same pitch merged into the one before it (held instead), but where a chord comes in (`again`). */
const held = (notes: MelodyNote[], again: Set<number>): MelodyNote[] => notes.filter((n, i) => i === 0 || n.midi !== notes[i - 1].midi || again.has(n.at));

// how far a second voice sits from the tune, by Closer ↔ Wider: 3rds; 3rds that open to a 6th or a
// 4th where a chord tone asks for it (M7's escapes); 6ths. A high harmony keeps above the tune and a
// low one below, in 3rds first, so the two never come out as one line an octave apart.
const BANDS: [number, number][] = [[3, 4], [3, 9], [8, 9]];

// a second voice keeps to 3rds and 6ths: a 4th or 5th with the tune is hollow there. By Closer ↔
// Wider (index: semitones, octaves folded): 3rds only (a 4th dear); 3rds first, then a 6th, then a 4th; 6ths.
const IV_PAIR: number[][] = [
  [8, 12, 4, 0, 0, 2, 5, 2.5, 3, 3, 4, 12],
  [8, 12, 4, 0, 0, 2.2, 5, 2.5, 2.2, 2.2, 4, 12],
  [8, 12, 4, 1, 1, 1.5, 5, 2, 0, 0, 4, 12],
];
const pairIv = (wide: number) => (d: number) => IV_PAIR[wide][mod12(Math.abs(d))];
/** A second voice below (side −1) or above (+1) the lead. */
export function harmonyLine(lead: LineNote[], spans: Span[], ctx: Ctx, heard: Heard, shape: Shape, side: 1 | -1): MelodyNote[] {
  return searchLine(harmonySlots(lead, spans, ctx, shape.busy), lead, ctx, heard, { side, band: BANDS[shape.wide], shape, iv: pairIv(shape.wide), rough: 3 });
}

/** A voice below and one above, in the lead's rhythm: a close triad around it, a 3rd (or a 4th) above and below (wider: a sixth below). */
export function stackLines(lead: LineNote[], spans: Span[], ctx: Ctx, heard: Heard, shape: Shape): MelodyNote[] {
  const slots = harmonySlots(lead, spans, ctx, shape.busy);
  const low = searchLine(slots, lead, ctx, heard, { side: -1, band: BANDS[shape.wide], shape, iv: pairIv(shape.wide), rough: 3 });
  const lowAt = (t: number) => {
    let m: number[] = [];
    for (const n of low) if (n.at <= t) m = [n.midi];
    return m;
  };
  const high = searchLine(slots, lead, ctx, heard, {
    side: 1, band: [3, 5], shape, more: lowAt, iv: pairIv(Math.min(1, shape.wide)), rough: 3,
    extra: (i, h) => {
      const l = low[i]?.midi;
      // the two upper voices within an octave of each other (M14)
      return l !== undefined && h - l > 12 ? 8 : 0;
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
  const side: 1 | -1 = median(lead.map((n) => n.midi)) + 9 <= 79 ? 1 : -1;
  const band: [number, number] = ([[3, 9], [3, 12], [8, 16]] as [number, number][])[shape.wide];
  return held(
    searchLine(slots, lead, ctx, heard, {
      side, band, shape, counter: true, rough: 5,
      iv: (d) => (d === 0 ? 8 : mod12(Math.abs(d)) === 0 ? 6 : IV[mod12(Math.abs(d))]),
      extra: (i, h) => {
        const s = slots[i];
        if (!s) return 0;
        // an octave with the tune on a strong beat fuses the two parts into one; inside the chords'
        // own register a line of its own is lost in them (M11: a register of its own)
        const K = heard.K(s.a);
        const inK = K.length > 1 && h > K[0] + 2 && h < K[K.length - 1] + 2;
        return (onsets.has(s.a) ? 0.5 : 0) + (s.strong && s.n !== null && h !== s.n && mod12(h - s.n) === 0 ? 6 : 0) + (inK ? 2 : 0);
      },
    }),
    new Set(spans.filter((s) => s.ref).map((s) => s.start)),
  );
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

/** Chord notes: a walk through each chord's notes (with 7ths, then 9ths, as colour rises), above the chords, close over the tune (or under it, when it sits high). */
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
  const span = [9, 12, 16][shape.wide];
  const med = lead.length ? median(lead.map((n) => n.midi)) : maxK + 12;
  const leadHi = lead.length ? Math.max(...lead.map((n) => n.midi)) : maxK;
  const leadLo = lead.length ? Math.min(...lead.map((n) => n.midi)) : maxK + 12;
  // over the tune, following it a little above (never more than about an octave over it, nor over
  // C6, M12); under it, over the chords, when the tune sits too high for that and there is room
  const over = !lead.length || leadHi + 3 + 7 <= 86 || leadLo - 3 - Math.max(52, maxK - 2) < 7;
  // the tune around a moment (a beat either side): the walk keeps clear of all of it
  const near = (t: number) => lead.filter((n) => n.at < t + TICKS && n.end > t - TICKS).map((n) => n.midi);
  const cands = slots.map((s) => {
    const chord = s.ref ? pcsOf(s.ref) : [];
    const local = localScale(ctx.seven, s.ref);
    const r = chord[0];
    const sevenths = local.filter((p) => [10, 11].includes(mod12(p - r)) && !avoids(p, chord));
    // colour: chord tones; 7ths between the strong beats; 7ths and 9ths anywhere
    const extra = shape.colour >= 2 || (shape.colour === 1 && !s.strong) ? sevenths : [];
    const nine = shape.colour >= 2 ? local.filter((p) => mod12(p - r) === 2 && !avoids(p, chord)) : [];
    const pcs = new Set([...chord, ...extra, ...nine]);
    const around = [s.n, ...s.leads.map((l) => l.midi), ...near(s.a)].filter((m): m is number => m !== null);
    const top = around.length ? Math.max(...around) : maxK + 9;
    const bottom = around.length ? Math.min(...around) : maxK + 12;
    // (over a tune that climbs past A5 there, under it)
    const up = over && top + 3 <= 84;
    const lo = up ? Math.max(52, top + 3) : Math.max(52, maxK - 2, bottom - 3 - span);
    const hi = up ? Math.min(86, lo + span) : Math.max(lo, bottom - 3);
    const out: number[] = [];
    for (let h = lo; h <= hi; h++) if (pcs.has(mod12(h))) out.push(h);
    if (!out.length) for (let h = lo; h <= Math.min(86, Math.max(hi, lo + 12)); h++) if (pcs.has(mod12(h))) out.push(h);
    return out.length ? out : [Math.min(lo, 86)];
  });
  const node = (i: number, h: number) => {
    const s = slots[i];
    let c = 2.5 * added(h, [...heard.K(s.a), ...(s.n !== null ? [s.n] : []), ...heard.H(s.a)]);
    for (const l of s.leads) c += (s.strong ? 1 : 0.4) * IV[mod12(Math.abs(h - l.midi))] * Math.min(1, l.w);
    if (s.n !== null) {
      const d = Math.abs(h - s.n);
      if (d <= 2) c += 3;
      if (mod12(d) === 0) c += 4;
      if (h > s.n && med > maxK + 6 && !over) c += 2;
    }
    if (heard.K(s.a).some((k) => Math.abs(h - k) === 1 || Math.abs(h - k) === 13)) c += 4;
    if (s.ref && !pcsOf(s.ref).includes(mod12(h))) c += shape.colour >= 2 ? (s.strong ? 0.2 : -0.3) : s.strong ? 1.2 : 0.3;
    // close to the tune: a sung or played part within about an octave of it (M12)
    if (h > 84) c += 1.5 * (h - 84);
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
    if (ba !== null && bb !== null && ba !== bb && parallelPerfect(ba, a, bb, b)) c += 10;
    return c;
  };
  return bestPath(cands, node, edge).path.map((midi, i) => ({ at: slots[i].a, midi }));
}

/**
 * Answer: the tune's last few notes echoed in its gaps (and, busier, over its long notes and at
 * the end of bars), in their rhythm and shape, chosen like any line against what sounds there.
 * There is always somewhere to answer: with no gap at all, it answers at the end of every fourth
 * bar (simpler), every second (the middle) or every bar (busier).
 * A melody note rings until the next: after an answer, where its last note would clash with a
 * chord that comes in or a tune note on a strong beat, it moves to a note that fits (by step,
 * best); where it fits, it is held.
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
  const onsets = new Set(lead.map((n) => n.at));
  const lastBeats = (every: number) => {
    for (let b = every; b * barTicks <= ctx.len; b += every) {
      const end = b * barTicks;
      // the bar's last beat; or, where the tune has a note on every step of it, the last step in the bar it leaves free
      let from = end - TICKS;
      for (let t = end - ctx.unit; t >= end - TICKS && onsets.has(t); t -= ctx.unit) from = t - ctx.unit;
      if (from < end - TICKS) {
        let f = end - ctx.unit;
        while (f >= end - barTicks && onsets.has(f)) f -= ctx.unit;
        if (f < end - barTicks) continue;
        let to = f + ctx.unit;
        while (to < end && !onsets.has(to)) to += ctx.unit;
        windows.push([f, to]);
      } else windows.push([end - TICKS, end]);
    }
  };
  if (shape.busy >= 2) lastBeats(1);
  else if (!windows.length) lastBeats(shape.busy === 0 && ctx.len >= 4 * barTicks ? 4 : 2);
  const side: 1 | -1 = median(lead.map((n) => n.midi)) >= 62 ? -1 : 1;
  const band: [number, number] = ([[3, 5], [3, 9], [8, 10]] as [number, number][])[shape.wide];
  const times: number[] = [];
  const shapes: number[] = [];
  const tail = new Set<number>();
  // the first note of each answer
  const first = new Set<number>();
  const merged: [number, number][] = [];
  for (const w of windows.sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    const last = merged[merged.length - 1];
    if (last && w[0] < last[1]) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w]);
  }
  merged.forEach(([g0, g1], wi) => {
    if (g1 - g0 < ctx.unit) return;
    // the motif: the last notes before the gap (up to three, within a bar), in their rhythm, squeezed to fit
    const motif = lead.filter((x) => x.at < g0 && x.at >= g0 - barTicks).slice(-3);
    const src = motif.length ? motif : [{ at: g0, end: g1, midi: leadAt(lead, g0) ?? lead[0].midi }];
    const span = src[src.length - 1].at - src[0].at;
    const room = Math.max(0, g1 - g0 - ctx.unit);
    const k = span > 0 ? Math.min(1, room / span) : 1;
    let last = -1;
    src.forEach((x, i) => {
      const t = g0 + Math.floor(((x.at - src[0].at) * k) / ctx.unit) * ctx.unit;
      // (never on a note of the tune: an answer comes in between)
      if (t >= g1 || t <= last || lead.some((n) => n.at === t)) return;
      if (last < 0) first.add(times.length);
      times.push(t);
      shapes.push(i > 0 && last >= 0 ? x.midi - src[i - 1].midi : NaN);
      last = t;
    });
    if (last < 0) return;
    // the tail: each chord change and downbeat until the next answer, where the last note is heard again
    const next = merged[wi + 1]?.[0] ?? ctx.len;
    const marks = new Set<number>(spans.filter((s) => s.start >= g1 && s.start < next).map((s) => s.start));
    for (let t = Math.ceil(g1 / barTicks) * barTicks; t < next; t += barTicks) marks.add(t);
    for (const t of [...marks].sort((a, b) => a - b)) {
      if (t <= last) continue;
      tail.add(times.length);
      times.push(t);
      shapes.push(NaN);
    }
  });
  if (!times.length) return [];
  // one line through every answer, so it also moves well from one to the next
  // (each note rings until the next: that is what it is heard against)
  const slots = slotsAt(times, boundaries(times, ctx.len), lead, spans, ctx);
  const leadMidis = lead.map((n) => n.midi);
  const lo = Math.max(48, Math.min(...leadMidis) - 12);
  const hi = Math.min(86, Math.max(...leadMidis) + 12);
  const all: number[] = [];
  for (let h = lo; h <= hi; h++) all.push(h);
  const line = searchLine(slots, lead, ctx, heard, {
    side, band, shape, tail,
    // a tail may hold any note the answer before it ends on
    cands: (i) => (tail.has(i) ? all : null),
    // the answer keeps the motif's shape: its steps as the tune took them, never one note struck again where the tune moved
    // (and an answer comes in on a note of its own, not the one still ringing)
    move: (i, x, y) => (first.has(i) ? (y === x ? 2.5 : 0) : Number.isNaN(shapes[i]) ? 0 : Math.min(5, 0.9 * Math.abs(y - x - shapes[i])) + (y === x && shapes[i] !== 0 ? 2.5 : 0)),
  });
  // a held note is not struck again (a motif's repeated note is held too)
  return line.filter((n, i) => !(i > 0 && n.midi === line[i - 1].midi));
}
