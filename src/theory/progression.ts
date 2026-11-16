/**
 * Progression engine: suggests where to go next (and *why*), generates fresh
 * progressions with a mood + adventurousness dial, and finds substitutions.
 *
 * It deliberately does NOT hard-code "I–V–vi–IV". Instead it scores every chord the
 * key can offer (diatonic, colour, borrowed, chromatic) by how it *moves* from the
 * previous chord, so you get options from safe to wild with an explanation for each.
 */
import { ChordRef, ChordType, chordPcs, getChordType, isMinorish } from "./chords";
import { Key, KeyChord, borrowedChords, chordsInScale, diatonicChords, spiceChords } from "./keys";
import { mod12, pc } from "./notes";

export type Pool = "diatonic" | "color" | "borrowed" | "spice";

export interface Candidate extends KeyChord {
  pool: Pool;
}

const COLOR_TYPES = [
  "sus2", "sus4", "add9", "madd9", "6", "m6", "69", "maj9", "m9", "9", "7sus4", "9sus4",
  "m11", "maj7#11", "add11", "madd11", "13", "m13", "maj13",
];

const keyOf = (c: { ref: ChordRef }) => `${pc(c.ref.root)}:${c.ref.typeId}`;

/** Every chord worth considering in a key, tagged by where it comes from. */
export function candidatePool(key: Key): Candidate[] {
  const out = new Map<string, Candidate>();
  const add = (c: KeyChord, pool: Pool) => {
    const k = keyOf(c);
    if (!out.has(k)) out.set(k, { ...c, pool });
  };
  const triads = diatonicChords(key, 3);
  const roleByRoot = new Map(triads.map((t) => [pc(t.ref.root), t.role]));
  for (const c of triads) add(c, "diatonic");
  for (const c of diatonicChords(key, 4)) add(c, "diatonic");
  for (const deg of chordsInScale(key)) {
    for (const c of deg.chords) {
      if (COLOR_TYPES.includes(c.type.id)) add({ ...c, role: roleByRoot.get(pc(c.ref.root)) }, "color");
      else if (triads.length === 0 && ["maj", "min", "dim", "aug", "7", "m7", "maj7", "5"].includes(c.type.id)) add(c, "diatonic");
    }
  }
  for (const c of borrowedChords(key)) add(c, "borrowed");
  for (const g of spiceChords(key)) for (const c of g.chords) add(c, "spice");
  return [...out.values()];
}

/** How far the fingers/voices have to move between two chords (smaller = smoother). */
export function voiceLeadingDistance(a: number[], b: number[]): number {
  const dist = (x: number, y: number) => {
    const d = mod12(x - y);
    return Math.min(d, 12 - d);
  };
  const one = (from: number[], to: number[]) => from.reduce((s, x) => s + Math.min(...to.map((y) => dist(x, y))), 0);
  return (one(a, b) + one(b, a)) / 2;
}

export const isDominantType = (t: ChordType) =>
  t.intervals.includes("3") && t.intervals.includes("b7") && !t.intervals.includes("7");

export interface Suggestion {
  chord: Candidate;
  why: string;
  score: number;
}

export interface SuggestionGroup {
  id: "natural" | "smooth" | "color" | "bold";
  title: string;
  blurb: string;
  items: Suggestion[];
}

const GROUP_INFO: Record<SuggestionGroup["id"], { title: string; blurb: string }> = {
  natural: { title: "Natural next steps", blurb: "Strong, satisfying moves inside the key." },
  smooth: { title: "Smooth & dreamy", blurb: "Share notes with your last chord, so the change glides." },
  color: { title: "Borrowed colour", blurb: "Notes from outside your key that change the mood without breaking it." },
  bold: { title: "Bold & cinematic", blurb: "Chromatic surprises. Use one to make a moment unforgettable." },
};

function describeMove(prev: ChordRef, prevType: ChordType, c: Candidate, common: number): { text: string; strength: number } {
  const move = mod12(pc(c.ref.root) - pc(prev.root));
  const shares = common === 1 ? "shares 1 note" : `shares ${common} notes`;
  if (isDominantType(prevType) && move === 5)
    return { text: "Resolves the 7th chord's tension: the textbook release.", strength: 1.4 };
  switch (move) {
    case 0:
      return { text: `Same root, new colour (${shares}). Great for movement without changing chord.`, strength: 0.5 };
    case 5:
      return { text: "Root falls a 5th: the strongest, most natural pull in music.", strength: 1.1 };
    case 7:
      return { text: "Root rises a 5th: bright, opening-up feeling.", strength: 0.75 };
    case 2:
      return { text: "Steps up a whole tone: forward, rising energy.", strength: 0.8 };
    case 10:
      return { text: "Steps down a whole tone: relaxed, rock-friendly motion.", strength: 0.75 };
    case 3:
    case 4:
    case 8:
    case 9:
      return {
        text: `Root moves a 3rd and ${shares}${common >= 2 ? ", so it glides" : ": a cinematic shift"}.`,
        strength: common >= 2 ? 0.85 : 0.6,
      };
    case 1:
    case 11:
      return { text: `Slides a half step ${move === 1 ? "up" : "down"}: slinky, chromatic drama.`, strength: 0.5 };
    default:
      return { text: "Tritone leap: as far away as you can get. Unstable and dramatic.", strength: 0.3 };
  }
}

/**
 * Suggest what could come next after `prev` (or how to start, when prev is null).
 * `used` lets the engine nudge you away from repeating yourself.
 */
export function suggestNext(prev: ChordRef | null, key: Key, used: ChordRef[] = [], perGroup = 6): SuggestionGroup[] {
  const pool = candidatePool(key);
  const groups: Record<SuggestionGroup["id"], Suggestion[]> = { natural: [], smooth: [], color: [], bold: [] };
  const usedCount = (c: Candidate) => used.filter((u) => pc(u.root) === pc(c.ref.root) && u.typeId === c.ref.typeId).length;

  if (!prev) {
    for (const c of pool) {
      let group: SuggestionGroup["id"] | null = null;
      let why = "";
      let score = 0;
      if (c.pool === "diatonic" && c.role === "home") {
        group = "natural";
        why = "Start at home: the clearest way to establish the key.";
        score = c.type.intervals.length === 3 ? 2 : 1.6;
      } else if (c.pool === "diatonic" && c.role === "stable") {
        group = "smooth";
        why = "Start on a 'soft home' chord: it sets the key but with more mystery.";
        score = 1.2;
      } else if (c.pool === "diatonic" && c.role === "motion") {
        group = "natural";
        why = "Start away from home: the song feels like it's already in motion.";
        score = 1;
      } else if (c.pool === "color" && c.role === "home") {
        group = "smooth";
        why = `A richer home chord: ${c.type.feel.split(".")[0].toLowerCase()}.`;
        score = 1.1;
      } else if (c.pool === "borrowed") {
        group = "color";
        why = "Open on borrowed colour: instantly unexpected.";
        score = 0.6;
      }
      if (group) groups[group].push({ chord: c, why, score });
    }
  } else {
    const prevType = getChordType(prev.typeId);
    const prevPcs = chordPcs(pc(prev.root), prevType);
    for (const c of pool) {
      if (pc(c.ref.root) === pc(prev.root) && c.ref.typeId === prev.typeId) continue;
      const pcs = chordPcs(pc(c.ref.root), c.type);
      const common = pcs.filter((p) => prevPcs.includes(p)).length;
      const vl = voiceLeadingDistance(prevPcs, pcs);
      const move = describeMove(prev, prevType, c, common);
      let score = move.strength + common * 0.2 - vl * 0.05 - usedCount(c) * 0.5;
      if (c.type.synthetic) score -= 1;
      let why = move.text;
      if (c.role === "home" && c.pool === "diatonic" && c.type.intervals.length === 3) {
        score += 0.4;
        why = "Back home. " + why;
      }
      if (c.explain && c.pool === "spice") why = `${c.explain} ${why}`;
      if (c.pool === "borrowed") why = `${c.source}. ${why}`;

      let group: SuggestionGroup["id"];
      const m = mod12(pc(c.ref.root) - pc(prev.root));
      if (c.pool === "spice") group = "bold";
      else if (c.pool === "borrowed") group = [1, 6, 11].includes(m) ? "bold" : "color";
      else if (c.pool === "color") group = "smooth";
      else if ([0, 3, 4, 8, 9].includes(m) && common >= 2) group = "smooth";
      else group = "natural";
      if (c.pool === "color") score -= 0.15;
      groups[group].push({ chord: c, why, score });
    }
  }

  return (Object.keys(groups) as SuggestionGroup["id"][])
    .map((id) => {
      const items = groups[id].sort((a, b) => b.score - a.score);
      // keep variety: at most two chords on the same root per group
      const perRoot = new Map<number, number>();
      const picked: Suggestion[] = [];
      for (const s of items) {
        const r = pc(s.chord.ref.root);
        const n = perRoot.get(r) ?? 0;
        if (n >= 2) continue;
        perRoot.set(r, n + 1);
        picked.push(s);
        if (picked.length >= perGroup) break;
      }
      return { id, ...GROUP_INFO[id], items: picked };
    })
    .filter((g) => g.items.length > 0);
}

// ── Generator ────────────────────────────────────────────────

export type Mood = "any" | "dreamy" | "dark" | "uplifting" | "tense" | "melancholic" | "floating";

export const MOODS: { id: Mood; label: string; hint: string }[] = [
  { id: "any", label: "Surprise me", hint: "No mood bias" },
  { id: "dreamy", label: "Dreamy", hint: "maj7, add9, sus2, Lydian colour" },
  { id: "melancholic", label: "Melancholic", hint: "minor 7ths, ♭VI, iv" },
  { id: "dark", label: "Dark", hint: "minor, ♭II, ♭VI, diminished" },
  { id: "uplifting", label: "Uplifting", hint: "major, sus4, rising moves" },
  { id: "floating", label: "Floating", hint: "sus chords, no strong 3rds" },
  { id: "tense", label: "Tense", hint: "dim, altered dominants, chromatic" },
];

function moodWeight(c: Candidate, mood: Mood): number {
  const id = c.type.id;
  const minor = isMinorish(c.type);
  switch (mood) {
    case "dreamy":
      return ["maj7", "add9", "sus2", "maj9", "69", "maj7#11", "add#11", "6", "maj13"].includes(id) ? 3 : minor ? 0.8 : 1;
    case "melancholic":
      return ["m7", "m9", "min", "madd9", "m11"].includes(id) ? 2.5 : c.roman.startsWith("bVI") || c.roman === "iv" ? 2.5 : !minor ? 0.7 : 1;
    case "dark":
      return minor || ["dim", "dim7", "m7b5"].includes(id) ? 2.2 : /^b(II|VI)/.test(c.roman) ? 2.5 : 0.5;
    case "uplifting":
      return ["maj", "add9", "sus4", "sus2", "6"].includes(id) ? 2.2 : minor ? 0.6 : 1;
    case "floating":
      return ["sus2", "sus4", "7sus4", "9sus4", "add9", "m11", "11", "add11"].includes(id) ? 3.2 : 0.7;
    case "tense":
      return ["dim", "dim7", "m7b5", "7b9", "7#9", "7alt", "aug", "7#5", "7b5"].includes(id) || c.pool === "spice" ? 3 : 0.8;
    default:
      return 1;
  }
}

function poolWeight(pool: Pool, adventure: number): number {
  switch (pool) {
    case "diatonic":
      return 1 - adventure * 0.6;
    case "color":
      return 0.25 + adventure * 0.6;
    case "borrowed":
      return 0.08 + adventure * 0.8;
    case "spice":
      return 0.01 + adventure * 0.55;
  }
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rng: () => number): T | null {
  const ws = items.map((t) => Math.max(0, weight(t)));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export interface SparkOptions {
  length: number;
  adventure: number; // 0 (safe) … 1 (wild)
  mood: Mood;
  startHome: boolean;
}

/** Generate a fresh progression. Weighted-random walk through the scored suggestions. */
export function sparkProgression(key: Key, opts: SparkOptions, rng: () => number = Math.random): ChordRef[] {
  const pool = candidatePool(key);
  const flat = (prev: ChordRef | null, used: ChordRef[]) =>
    suggestNext(prev, key, used, 40).flatMap((g) => g.items);
  const out: ChordRef[] = [];

  const firstOpts = flat(null, []).filter((s) => (opts.startHome ? s.chord.role === "home" : true));
  const first =
    weightedPick(firstOpts, (s) => Math.exp(s.score) * moodWeight(s.chord, opts.mood) * poolWeight(s.chord.pool, opts.adventure), rng) ??
    { chord: pool[0] };
  out.push(first.chord.ref);

  for (let i = 1; i < opts.length; i++) {
    const prev = out[out.length - 1];
    const isLast = i === opts.length - 1;
    const opt = flat(prev, out).filter((s) => !(isLast && pc(s.chord.ref.root) === pc(out[0].root) && s.chord.ref.typeId === out[0].typeId));
    const pick = weightedPick(
      opt,
      (s) => {
        let w = Math.exp(s.score * 1.3) * moodWeight(s.chord, opts.mood) * poolWeight(s.chord.pool, opts.adventure);
        if (out.some((u) => pc(u.root) === pc(s.chord.ref.root) && u.typeId === s.chord.ref.typeId)) w *= 0.25;
        if (isLast) {
          // loop-friendly ending: something that leads back to the first chord
          const back = mod12(pc(out[0].root) - pc(s.chord.ref.root));
          const sharesWithFirst = chordPcs(pc(s.chord.ref.root), s.chord.type).filter((p) =>
            chordPcs(pc(out[0].root), getChordType(out[0].typeId)).includes(p),
          ).length;
          if (back === 5 || back === 2 || back === 10 || back === 1) w *= 2;
          if (sharesWithFirst >= 2) w *= 0.6; // too similar to the first chord blurs the loop
        }
        return w;
      },
      rng,
    );
    if (!pick) break;
    out.push(pick.chord.ref);
  }
  return out;
}

/** Replace plain triads with richer chords that still fit the key (or the chord's own colour). */
export function colorize(ref: ChordRef, key: Key, rng: () => number = Math.random): ChordRef {
  const type = getChordType(ref.typeId);
  const deg = chordsInScale(key).find((d) => pc(d.root) === pc(ref.root));
  const options: Record<string, string[]> = {
    maj: ["maj7", "add9", "6", "maj9", "69", "sus2", "maj7#11"],
    min: ["m7", "m9", "madd9", "m11", "m6"],
    "7": ["9", "13", "7sus4", "7b9", "7#9"],
    dim: ["dim7", "m7b5"],
    m7: ["m9", "m11"],
    maj7: ["maj9", "maj7#11", "69"],
    "5": ["sus2", "sus4"],
  };
  const choices = options[type.id];
  if (!choices) return ref;
  const fits = (id: string) => {
    if (!deg) return true;
    return deg.chords.some((c) => c.type.id === id);
  };
  const inKey = choices.filter(fits);
  const list = inKey.length ? inKey : deg ? [] : choices.slice(0, 2);
  if (!list.length) return ref;
  return { ...ref, typeId: list[Math.floor(rng() * list.length)] };
}

/** Chords that could replace `ref` (share notes / function), with reasons. */
export function substitutesFor(ref: ChordRef, key: Key, limit = 12): Suggestion[] {
  const type = getChordType(ref.typeId);
  const pcs = chordPcs(pc(ref.root), type);
  const out: Suggestion[] = [];
  for (const c of candidatePool(key)) {
    if (pc(c.ref.root) === pc(ref.root) && c.ref.typeId === ref.typeId) continue;
    const cp = chordPcs(pc(c.ref.root), c.type);
    const common = cp.filter((p) => pcs.includes(p)).length;
    const tritone = isDominantType(type) && isDominantType(c.type) && mod12(pc(c.ref.root) - pc(ref.root)) === 6;
    if (!tritone && common < Math.min(2, pcs.length)) continue;
    let why = `Shares ${common} of ${pcs.length} notes, so it can do a similar job with a different colour.`;
    let score = common / Math.max(pcs.length, cp.length);
    if (pc(c.ref.root) === pc(ref.root)) {
      why = "Same root, different colour.";
      score += 0.2;
    }
    if (tritone) {
      why = "Tritone substitution: shares the same tension notes (3rd & 7th), resolves by half step.";
      score += 0.6;
    }
    if (c.pool === "borrowed") why += ` (${c.source})`;
    if (c.pool === "color" || c.pool === "spice") score -= 0.1;
    if (c.pool === "borrowed") score -= 0.05;
    // a different root doing the same job is the classic substitution
    if (pc(c.ref.root) !== pc(ref.root) && c.pool === "diatonic") score += 0.3;
    out.push({ chord: c, why, score });
  }
  out.sort((a, b) => b.score - a.score);
  const sameRoot = out.filter((s) => pc(s.chord.ref.root) === pc(ref.root)).slice(0, 3);
  const other = out.filter((s) => pc(s.chord.ref.root) !== pc(ref.root));
  return [...other.slice(0, limit - sameRoot.length), ...sameRoot].sort((a, b) => b.score - a.score);
}

/** Simple seeded RNG so a progression can be re-generated. */
export function seededRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}
