/**
 * How good a harmony sounds, in numbers (test-only): the measures the quality tests hold the
 * harmony engine to, on the sections in ./fixtures/harmony. Chords 1 of each fixture is voiced as
 * the app plays it, on the guitar (the stock shapes, standard tuning) and on the piano (Spread),
 * and each measure counts the worse of the two.
 *
 * The measures come from the diagnosis of the first engine and the harmony research: clash time against the chords, rubs, the roughness a note adds
 * (Sethares, ./consonance), unisons and crossings with the tune, parallels, melodic tritones; and
 * for a chords track played along with Chords 1: Hutchinson–Knopoff roughness against Chords 1
 * alone, notes a semitone above Chords 1, notes doubled exactly, a second bass under it.
 */
import type { ProgChord } from "../ui/state";
import { TICKS, type MelodyNote } from "../song/melody";
import { getTuning } from "../guitar/tunings";
import { easyVoicing } from "../guitar/arrange";
import { fingerNotes } from "../guitar/finger";
import { keysVoicings } from "../audio/tone";
import { getChordType } from "./chords";
import { semitonesOf } from "./intervals";
import { mod12, pc } from "./notes";
import type { ChordRef } from "./chords";
import { added, addedSet, roughness } from "./consonance";
import { beatStrength, harmonize, melodyLine, parallelPerfect, type HarmonizeOutput, type HarmonyKind, type Shape, type SourceKind, type Sounding } from "./harmonize";
import type { Built } from "./fixtures/harmony";

export type Voicer = "guitar" | "keys";
export const VOICERS: Voicer[] = ["guitar", "keys"];
const STANDARD = getTuning("standard");

export const refPcs = (ref: ChordRef): number[] => {
  const r = pc(ref.root);
  const out = getChordType(ref.typeId).intervals.map((iv) => mod12(r + semitonesOf(iv)));
  if (ref.bass) out.push(pc(ref.bass));
  return [...new Set(out)];
};
/** The notes a chord plays on a voicer: its own `notes` when every one belongs to it, else the instrument's stock voicing. */
export function voiceChords(chords: ProgChord[], how: Voicer): number[][] {
  const kv = how === "keys" ? keysVoicings(chords, { inst: "piano", voicing: "spread" }) : null;
  return chords.map((c, i) => {
    if (c.rest) return [];
    const own = (c as ProgChord & { notes?: number[] }).notes;
    if (own?.length && own.every((m) => refPcs(c.ref).includes(mod12(m)))) return [...own].sort((a, b) => a - b);
    if (kv) return kv[i];
    return (easyVoicing(c.ref, STANDARD, 0)?.midi.filter((m): m is number => m !== null) ?? []).sort((a, b) => a - b);
  });
}

interface VSpan {
  start: number;
  end: number;
  ref: ChordRef;
  K: number[];
}
function spansOf(chords: ProgChord[], how: Voicer, len: number): VSpan[] {
  const vs = voiceChords(chords, how);
  const out: VSpan[] = [];
  let at = 0;
  chords.forEach((c, i) => {
    const d = Math.round(c.beats * TICKS);
    if (!c.rest && at < len) out.push({ start: at, end: Math.min(len, at + d), ref: c.ref, K: vs[i] });
    at += d;
  });
  return out;
}

/** Everything heard in a fixture but the new track: Chords 1 as voiced (and its bass), and the tune unless `noTune`. */
export function aroundOf(b: Built, how: Voicer, noTune = false): Sounding[] {
  const out: Sounding[] = [];
  for (const s of spansOf(b.chords, how, b.len)) {
    s.K.forEach((m, i) => out.push({ at: s.start, end: s.end, midi: m, part: i === 0 ? "bass" : "chords" }));
  }
  if (!noTune) for (const n of melodyLine(b.melody, b.len)) out.push({ at: n.at, end: n.end, midi: n.midi, part: "tune" });
  return out;
}

/**
 * Run one option on a fixture, as the app asks for it (source, the chords under it, everything heard
 * around). `empty`: the section has no chords yet (how a first Chords track is filled from a tune).
 */
export function runOn(b: Built, kind: HarmonyKind, from: SourceKind, option: string, how: Voicer, extra: { shape?: Shape; seed?: number; empty?: boolean } = {}): HarmonizeOutput {
  const common = {
    kind, option, key: b.key, bar: b.bar, bars: b.bars, compound: b.compound, seed: extra.seed ?? 1, ...(extra.shape ? { shape: extra.shape } : {}),
    // a new chords track plays the guitar: what it writes must be playable there, as in the app
    ...(kind === "chords" ? { playable: (n: number[]) => !!fingerNotes(n, STANDARD, 0) } : {}),
  };
  if (from === "melody" && extra.empty) return harmonize({ ...common, source: { melody: b.melody }, under: [], around: [] });
  if (from === "melody") return harmonize({ ...common, source: { melody: b.melody }, under: b.chords, around: aroundOf(b, how, true) });
  return harmonize({ ...common, source: { chords: b.chords, ...(kind === "chords" ? { melody: b.melody } : {}) }, ...(kind === "melody" ? { under: b.chords } : {}), around: aroundOf(b, how) });
}

// ── Melody lines ───────────────────────────────────────────────

export interface LineScore {
  notes: number;
  /** beats the line spends clashing with the chords (an m9 above a chords note, a #9 under a major 3rd, a tritone over the bass) */
  clash: number;
  /** the same for the tune itself */
  tuneClash: number;
  /** notes on strong slots that rub a chords note (1–2 semitones from one, or an m9 above) */
  rub: number;
  /** strong slots */
  strong: number;
  /** mean roughness each note adds to the chords, the bass and the tune note at its start */
  added: number;
  /** m2, M7 or tritone with the tune on strong slots */
  leadDiss: number;
  /** onsets in unison or at the octave with the tune */
  unison: number;
  /** onsets with the tune sounding */
  moments: number;
  /** onsets on the other side of the tune from the line's usual side */
  cross: number;
  /** parallel 5ths or 8ves with the tune or the bass (octaves with the bass included) */
  parallels: number;
  /** a leap of a tritone inside the line */
  tritones: number;
  /** notes in the line's main interval family with the tune (3rds/6ths, 4ths/5ths …) */
  family: number;
}
const famOf = (ic: number) => (ic === 3 || ic === 4 ? 0 : ic === 8 || ic === 9 ? 1 : ic === 5 || ic === 7 ? 2 : 3);

function clashTime(h: number, a: number, e: number, spans: VSpan[]): number {
  let t = 0;
  for (const s of spans) {
    const lo = Math.max(a, s.start);
    const hi = Math.min(e, s.end);
    if (hi <= lo) continue;
    const pcs = refPcs(s.ref);
    const r = pc(s.ref.root);
    const third = pcs.includes(mod12(r + 4)) ? mod12(r + 4) : null;
    const bass = s.K[0];
    const out = !pcs.includes(mod12(h));
    const bad = s.K.some((k) => h > k && mod12(h - k) === 1) || (out && third !== null && mod12(h) === mod12(third - 1)) || (out && bass !== undefined && mod12(h - bass) === 6);
    if (bad) t += hi - lo;
  }
  return t / TICKS;
}

/** The voices of a written melody: one line, or two (a stack: the top and the bottom note at each onset). */
function voicesOf(notes: MelodyNote[], len: number): { at: number; end: number; midi: number }[][] {
  const by = new Map<number, number[]>();
  for (const n of notes) by.set(n.at, [...(by.get(n.at) ?? []), n.midi]);
  const ats = [...by.keys()].sort((a, b) => a - b);
  const two = ats.some((a) => by.get(a)!.length > 1);
  const line = (pick: (ms: number[]) => number) => ats.map((at, i) => ({ at, end: i + 1 < ats.length ? ats[i + 1] : len, midi: pick(by.get(at)!) }));
  return two ? [line((ms) => Math.max(...ms)), line((ms) => Math.min(...ms))] : [line((ms) => ms[0])];
}

export function scoreLine(b: Built, how: Voicer, notes: MelodyNote[]): LineScore {
  const spans = spansOf(b.chords, how, b.len);
  const tune = melodyLine(b.melody, b.len);
  const lead = (t: number) => {
    let m: number | null = null;
    for (const n of tune) {
      if (n.at > t) break;
      m = n.midi;
    }
    return m;
  };
  const kAt = (t: number) => spans.find((s) => s.start <= t && t < s.end);
  const s: LineScore = { notes: notes.length, clash: 0, tuneClash: 0, rub: 0, strong: 0, added: 0, leadDiss: 0, unison: 0, moments: 0, cross: 0, parallels: 0, tritones: 0, family: 0 };
  for (const n of tune) s.tuneClash += clashTime(n.midi, n.at, n.end, spans);
  const fams = [0, 0, 0, 0];
  for (const v of voicesOf(notes, b.len)) {
    let side = 0;
    for (const n of v) {
      const l = lead(n.at);
      if (l !== null && n.midi !== l) side += Math.sign(n.midi - l);
    }
    const usual = Math.sign(side) || 1;
    v.forEach((n, i) => {
      s.clash += clashTime(n.midi, n.at, n.end, spans);
      const sp = kAt(n.at);
      const K = sp?.K ?? [];
      const l = lead(n.at);
      const strong = beatStrength(n.at, b.bar) >= 2 || n.end - n.at >= TICKS;
      if (strong) {
        s.strong++;
        if (K.some((k) => (k !== n.midi && Math.abs(k - n.midi) <= 2) || (n.midi - k >= 13 && mod12(n.midi - k) === 1))) s.rub++;
        if (l !== null && [1, 11, 6].includes(mod12(Math.abs(n.midi - l)))) s.leadDiss++;
      }
      s.added += added(n.midi, [...K, ...(l !== null ? [l] : [])]);
      if (l !== null) {
        s.moments++;
        const ic = mod12(Math.abs(n.midi - l));
        if (ic === 0) s.unison++;
        if (n.midi !== l && Math.sign(n.midi - l) !== usual) s.cross++;
        fams[famOf(ic)]++;
      }
      if (i > 0) {
        const p = v[i - 1];
        const lp = lead(p.at);
        if (l !== null && lp !== null && parallelPerfect(lp, p.midi, l, n.midi)) s.parallels++;
        const bp = kAt(p.at)?.K[0];
        const bn = sp?.K[0];
        // (5ths and octaves with the bass alike)
        if (bp !== undefined && bn !== undefined && bp !== bn && parallelPerfect(bp, p.midi, bn, n.midi)) s.parallels++;
        if (Math.abs(n.midi - p.midi) === 6) s.tritones++;
      }
    });
  }
  s.added = notes.length ? s.added / notes.length : 0;
  s.family = Math.max(...fams);
  return s;
}

// ── Chords played along with Chords 1 ─────────────────────────

export interface LayerScore {
  chords: number;
  /** mean of HK roughness (Chords 1 + layer) ÷ Chords 1 alone */
  hkRatio: number;
  /** mean Sethares roughness the layer adds to Chords 1 */
  added: number;
  /** layer notes a semitone (or an m9 …) above a Chords 1 note */
  semitoneAbove: number;
  /** layer notes a semitone (or an m9) from a Chords 1 note, either way */
  rubs: number;
  /** layer notes on exactly the same MIDI note as Chords 1 */
  doubled: number;
  notes: number;
  /** chords whose lowest layer note is at least Chords 1's top − 2 */
  above: number;
  /** chords with a layer note under Chords 1's bass */
  secondBass: number;
  /** layer notes an m2/m9 (either way) from a strong tune note in the chord */
  tuneRub: number;
}
export function scoreLayer(b: Built, how: Voicer, out: ProgChord[]): LayerScore {
  const src = spansOf(b.chords, how, b.len);
  // the layer as it plays: its own notes, or (no notes) a second guitar in the stock shapes
  const lay = spansOf(out, "guitar", b.len);
  const tune = melodyLine(b.melody, b.len);
  const s: LayerScore = { chords: 0, hkRatio: 0, added: 0, semitoneAbove: 0, rubs: 0, doubled: 0, notes: 0, above: 0, secondBass: 0, tuneRub: 0 };
  for (const l of lay) {
    const k = src.find((x) => x.start <= l.start && l.start < x.end);
    if (!k || !l.K.length) continue;
    const K = k.K;
    s.chords++;
    s.hkRatio += roughness([...K, ...l.K]) / Math.max(1e-6, roughness(K));
    s.added += addedSet(l.K, K);
    s.notes += l.K.length;
    for (const v of l.K) {
      if (K.some((x) => v > x && mod12(v - x) === 1)) s.semitoneAbove++;
      if (K.some((x) => [1, 13].includes(Math.abs(v - x)))) s.rubs++;
      if (K.includes(v)) s.doubled++;
    }
    if (Math.min(...l.K) >= Math.max(...K) - 2) s.above++;
    if (Math.min(...l.K) < Math.min(...K)) s.secondBass++;
    const strongT = tune.filter((n) => n.at >= l.start && n.at < l.end && (beatStrength(n.at, b.bar) >= 2 || n.end - n.at >= TICKS));
    for (const v of l.K) if (strongT.some((t) => [1, 11].includes(mod12(Math.abs(v - t.midi))))) s.tuneRub++;
  }
  if (s.chords) {
    s.hkRatio /= s.chords;
    s.added /= s.chords;
  }
  return s;
}

/** The tune's clash time over a row of chords (for options that play instead of Chords 1). */
export function tuneClashOver(b: Built, how: Voicer, chords: ProgChord[]): number {
  const spans = spansOf(chords, how, b.len);
  return melodyLine(b.melody, b.len).reduce((t, n) => t + clashTime(n.midi, n.at, n.end, spans), 0);
}

// ── Totals over the fixtures ───────────────────────────────────

/** A line option's totals over every fixture, on one voicer of Chords 1. */
export interface LineTotal extends LineScore {
  /** the fixtures it wrote something in */
  wrote: number;
  /** mean added roughness per fixture, by name */
  perFixture: Record<string, number>;
}
export interface LayerTotal extends LayerScore {
  wrote: number;
}
const sumInto = <T extends object>(a: T, b: T, skip: string[] = []) => {
  for (const k of Object.keys(b) as (keyof T)[]) if (!skip.includes(k as string) && typeof b[k] === "number") (a as Record<keyof T, number>)[k] = ((a[k] as number) ?? 0) + (b[k] as number);
};
/** The totals of a melody option on every fixture: on each voicer, then the worse of the two for each measure. */
export function lineTotals(fixtures: Built[], from: SourceKind, option: string, extra: { shape?: Shape; seed?: number } = {}): LineTotal {
  const per = VOICERS.map((how) => {
    const t = { notes: 0, clash: 0, tuneClash: 0, rub: 0, strong: 0, added: 0, leadDiss: 0, unison: 0, moments: 0, cross: 0, parallels: 0, tritones: 0, family: 0, wrote: 0, perFixture: {} as Record<string, number> };
    for (const b of fixtures) {
      const notes = runOn(b, "melody", from, option, how, extra).melody?.notes ?? [];
      const s = scoreLine(b, how, notes);
      t.perFixture[b.name] = s.added;
      s.added *= s.notes;
      sumInto(t, s);
      if (notes.length) t.wrote++;
    }
    t.added = t.notes ? t.added / t.notes : 0;
    return t;
  });
  return worse(per, ["family", "wrote", "notes", "moments", "strong", "tuneClash"]) as LineTotal;
}
export function layerTotals(fixtures: Built[], option: string, extra: { shape?: Shape; seed?: number } = {}): LayerTotal {
  const per = VOICERS.map((how) => {
    const t = { chords: 0, hkRatio: 0, added: 0, semitoneAbove: 0, rubs: 0, doubled: 0, notes: 0, above: 0, secondBass: 0, tuneRub: 0, wrote: 0 };
    for (const b of fixtures) {
      const out = runOn(b, "chords", "chords", option, how, extra).chords ?? [];
      const s = scoreLayer(b, how, out);
      s.hkRatio *= s.chords;
      s.added *= s.chords;
      sumInto(t, s);
      if (out.some((c) => !c.rest)) t.wrote++;
    }
    t.hkRatio = t.chords ? t.hkRatio / t.chords : 0;
    t.added = t.chords ? t.added / t.chords : 0;
    return t;
  });
  return worse(per, ["chords", "notes", "above", "wrote"]) as LayerTotal;
}
/** Tune clash beats over an option that plays instead of Chords 1 (or chosen for the tune), and over Chords 1 itself. */
export function insteadTotals(fixtures: Built[], from: SourceKind, option: string, extra: { shape?: Shape; empty?: boolean } = {}): { clash: number; own: number } {
  const per = VOICERS.map((how) => {
    let clash = 0;
    let own = 0;
    for (const b of fixtures) {
      const out = runOn(b, "chords", from, option, how, extra).chords ?? [];
      clash += tuneClashOver(b, how, out.length ? out : b.chords);
      own += tuneClashOver(b, how, b.chords);
    }
    return { clash, own };
  });
  return per[0].clash - per[0].own >= per[1].clash - per[1].own ? per[0] : per[1];
}
/** The worse of the two voicers, measure by measure (`good` measures: the smaller is worse; `keep`: the first's). */
function worse<T extends Record<string, unknown>>(per: T[], keep: string[]): T {
  const out = { ...per[0] } as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    if (keep.includes(k) || typeof out[k] !== "number") continue;
    out[k] = Math.max(...per.map((p) => p[k] as number));
  }
  if ("family" in out) out.family = Math.min(...per.map((p) => (p.family as number) / Math.max(1, p.moments as number)));
  if ("above" in out) out.above = Math.min(...per.map((p) => (p.above as number) / Math.max(1, p.chords as number)));
  if ("perFixture" in out) out.perFixture = Object.fromEntries(Object.keys(per[0].perFixture as object).map((n) => [n, Math.max(...per.map((p) => (p.perFixture as Record<string, number>)[n]))]));
  return out as T;
}
/** How many different results an option gives for seeds 1–8 on a fixture (1: it does not depend on the track). */
export function seedSpread(b: Built, kind: HarmonyKind, from: SourceKind, option: string): number {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 8; seed++) {
    const o = runOn(b, kind, from, option, "guitar", { seed });
    seen.add(JSON.stringify(o.melody?.notes ?? o.chords?.map((c) => [c.ref, c.beats, (c as { notes?: number[] }).notes])));
  }
  return seen.size;
}
