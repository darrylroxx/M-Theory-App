/**
 * Harmony tracks: a new chords or melody track written to go with another track of the song.
 *
 * theory/harmonize writes one section at a time; this writes the new track into every section
 * the chosen track plays in, each in its own time signature, length and chords, and remembers on
 * the track where it came from (which track, which option) and what it wrote in each section.
 * That is what lets it be written again later (with another option, or because its source
 * changed) without quietly writing over notes that were changed by hand: a section whose notes
 * no longer match what was written is reported, and the page asks first.
 *
 * Everything is deterministic: the seed comes from the track and the section, so the same song
 * always gets the same harmony (an audition and the track it then adds are the same notes).
 */
import type { ProgChord, Progression } from "../ui/state";
import type { Key } from "../theory/keys";
import { HARMONY_OPTIONS, harmonize, harmonyOptions, type HarmonizeInput, type HarmonizeOutput, type HarmonyKind, type HarmonyOption, type SourceKind } from "../theory/harmonize";
import { TICKS, hasTune, type Melody, type MelodyNote } from "./melody";
import { barsOr } from "./frame";
import { isCompound, sigBeats, type TimeSig } from "./meter";
import { sigOf } from "./unity";
import { commit, letters, type SongPart } from "./structure";
import { allTracks, insteadTarget, muteInstead, normalize, refocus, unmuteInstead, type HarmonyMark, type Layer, type Layers, type Track } from "./tracks";
import { onKeys, synthOf, toneOf, type Tone } from "../audio/tone";
import { keyStyleOf } from "../keys/voicing";
import { chordPrint, fnv, outPrint, tunePrint } from "./prints";

/** What a harmony track is written from and how. */
export interface HarmonyPlan {
  /** the new track's kind */
  kind: HarmonyKind;
  /** the track it goes with */
  from: string;
  /** a theory/harmonize option id */
  option: string;
}

/**
 * Where a written melody may sit: two octaves either side of middle C at most. Every instrument
 * a melody track can play (the strings, the pianos, the synth) sounds there, and the melody grid
 * stretches to show it. A note outside is moved by octaves, not dropped.
 */
export const MELODY_RANGE = { lo: 36, hi: 96 };
/** The shortest and longest a chord can be (as on the Chords page: half beats, up to 16 beats). */
const MIN_BEATS = 0.5;
/** Where a new melody harmony's fader starts, in dB: a little under the tune it sings with. */
export const HARMONY_DB = -4;
const MAX_BEATS = 16;

/** The option behind an id, for a kind of track. */
export const optionOf = (kind: HarmonyKind, id: string): HarmonyOption | undefined => HARMONY_OPTIONS.find((o) => o.kind === kind && o.id === id);

/** The tracks a new harmony can be written from: every chords and melody track of the song. */
export function harmonySources(p: Progression): Track[] {
  return allTracks(normalize(p)).filter((t) => t.kind === "chords" || t.kind === "melody");
}
/**
 * What a page's Harmonize button writes from: the track the page is editing (the chords or the
 * melody brought forward), else the first track of that kind, else any track there is (null: none).
 */
export function harmonizeFrom(p: Progression, page: SourceKind): string | null {
  const list = harmonySources(p);
  const on = p.focus?.[page] ?? page;
  return (list.find((t) => t.id === on) ?? list.find((t) => t.kind === page) ?? list[0])?.id ?? null;
}
/**
 * The track a sheet writes from, as the song now stands: the one chosen while it is still a chords
 * or melody track of the song, else `fallback` (the track on the page) if that is, else none.
 */
export function liveSource(p: Progression, from: string | null, fallback?: string | null): string | null {
  const ids = new Set(harmonySources(p).map((t) => t.id));
  return from && ids.has(from) ? from : fallback && ids.has(fallback) ? fallback : null;
}
const kindOf = (p: Progression, id: string): SourceKind | undefined => {
  const k = allTracks(p).find((t) => t.id === id)?.kind;
  return k === "chords" || k === "melody" ? k : undefined;
};

// ── Sections ───────────────────────────────────────────────────

/** One section as the harmony is written into it (with no song yet, the page is the only one, part ""). */
interface Spot {
  part: string;
  chords: ProgChord[];
  melody?: Melody;
  layers?: Layers;
  bars?: number;
  meter: TimeSig;
}
/** Every section of the song once (a section played twice is the same music). `p` has every track in its place. */
function spots(p: Progression): Spot[] {
  const sig = sigOf(p);
  if (!p.song) return [{ part: "", chords: p.chords, melody: p.melody, layers: p.layers, bars: p.bars, meter: sig }];
  return p.song.parts.map((x) => ({ part: x.id, chords: x.chords, melody: x.melody, layers: x.layers, bars: x.bars, meter: x.meter ?? sig }));
}
/** The song with every track in its place and the page written back into it. */
const flat = (p: Progression): Progression => commit(normalize(p));

/** What the source track holds in a section. */
function sourceIn(s: Spot, from: string, kind: SourceKind): { chords?: ProgChord[]; melody?: Melody } {
  if (kind === "chords") return { chords: from === "chords" ? s.chords : s.layers?.[from]?.chords };
  return { melody: from === "melody" ? s.melody : s.layers?.[from]?.melody };
}
const sounds = (cs: ProgChord[] | undefined) => !!cs?.some((c) => !c.rest && c.beats > 0);
const plays = (src: { chords?: ProgChord[]; melody?: Melody }, kind: SourceKind) => (kind === "chords" ? sounds(src.chords) : hasTune(src.melody));

/**
 * The chords track a new chords track would play instead of (undefined: it plays with its
 * source). The Instead options replace what they re-harmonise: the chords they were written from,
 * or, written from a tune, the song's chords. Best fit chooses its own chords for the tune; where
 * the song has chords too the two would clash wherever they differ, so it replaces them as well.
 */
function insteadOf(p: Progression, kind: HarmonyKind, option: string, from: string, srcKind: SourceKind): string | undefined {
  if (kind !== "chords") return undefined;
  const opt = optionOf(kind, option);
  const target = srcKind === "chords" ? from : "chords";
  if (opt?.instead) return target;
  return option === "fit" && spots(p).some((s) => sounds(s.chords)) ? target : undefined;
}

/**
 * The chords heard in a section: the song's, or, when they are muted because a re-harmonisation
 * plays instead of them, that track's (so a line written to bend to the chords bends to the ones
 * that sound). `self` is the track being written, never its own chords.
 */
function heardChords(p: Progression, s: Spot, self: string): ProgChord[] {
  if (!p.mix?.chords?.mute) return s.chords;
  for (const t of p.tracks ?? []) {
    if (t.id === self || p.mix?.[t.id]?.mute || insteadTarget(t, p.tracks ?? []) !== "chords") continue;
    const cs = s.layers?.[t.id]?.chords;
    if (sounds(cs)) return cs!;
  }
  return s.chords;
}

/** The seed for one track in one section: the same harmony every time it is written there. */
export const seedOf = (track: string, part: string): number => fnv(`${track}|${part}`) || 1;

/**
 * What harmonize is asked for in a section, or null when the source does not play there. A
 * melody harmony bends to the song's chords there, and a chords layer written from a melody sits
 * on them; a chords layer written from chords is checked against the song's melody (so a swap
 * never clashes with a strong note of the tune).
 */
function inputIn(p: Progression, s: Spot, key: Key, kind: HarmonyKind, from: string, srcKind: SourceKind, option: string, track: string): HarmonizeInput | null {
  const src = sourceIn(s, from, srcKind);
  const swap = !!insteadOf(p, kind, option, from, srcKind);
  // a track that replaces the song's chords is written on them as they are; anything else on the chords that sound
  const under = swap ? s.chords : heardChords(p, s, track);
  // written from a tune, a replacement still carries the song's chords through a section with no
  // tune (re-voiced its way), so muting them leaves nothing silent there
  const carry = !plays(src, srcKind) && swap && srcKind === "melody" && sounds(s.chords);
  if (!plays(src, srcKind) && !carry) return null;
  const tune = kind === "chords" && srcKind === "chords" && hasTune(s.melody) ? { melody: s.melody } : {};
  return {
    kind, option, key,
    source: carry ? { chords: s.chords } : srcKind === "melody" ? { melody: src.melody } : { chords: src.chords, ...tune },
    ...(kind === "melody" || srcKind === "melody" ? { under } : {}),
    bar: sigBeats(s.meter),
    bars: barsOr(s.bars),
    compound: isCompound(s.meter),
    seed: seedOf(track, s.part),
  };
}

// ── Fingerprints ───────────────────────────────────────────────

/** What the source and the section were when the harmony was written (everything that decides it, but the option). */
const srcPrint = (input: HarmonizeInput | null): string =>
  input ? fnv(JSON.stringify([input.key.tonic, input.key.scaleId, chordPrint(input.source.chords), tunePrint(input.source.melody), chordPrint(input.under), input.bar, input.bars, !!input.compound])).toString(36) : "-";
const emptyLayer = (l: Layer | undefined) => !l?.chords?.some((c) => !c.rest) && !l?.melody?.notes.length;

// ── Writing ────────────────────────────────────────────────────

/** A written melody made safe to keep: inside the range, on its own grid, in the section. */
function fitMelody(m: Melody, bars: number, len: number): Melody | undefined {
  const step = TICKS / m.div;
  const seen = new Set<string>();
  const notes: MelodyNote[] = [];
  for (const n of m.notes) {
    let midi = n.midi;
    while (midi < MELODY_RANGE.lo) midi += 12;
    while (midi > MELODY_RANGE.hi) midi -= 12;
    // every harmonize line sits on the grid it names; a note that does not is put on the nearest step, never lost
    const at = Math.min(len - step, Math.round(n.at / step) * step);
    const k = `${at}.${midi}`;
    if (at < 0 || seen.has(k)) continue;
    seen.add(k);
    notes.push({ at, midi });
  }
  if (!notes.length) return undefined;
  return { div: m.div, bars, notes: notes.sort((a, b) => a.at - b.at || a.midi - b.midi) };
}

/**
 * Chords made safe to keep: lengths in half beats (rounded where they fall, so the changes stay
 * where they were) and none longer than the Chords page allows (a long held chord is struck again
 * on a bar line).
 */
function fitChords(cs: ProgChord[], bar: number): ProgChord[] {
  const out: ProgChord[] = [];
  const piece = bar <= MAX_BEATS ? Math.floor(MAX_BEATS / bar) * bar : MAX_BEATS;
  let t = 0;
  for (const c of cs) {
    const start = Math.round(t * 2) / 2;
    t += Number(c.beats) || 0;
    let len = Math.round(t * 2) / 2 - start;
    if (len < MIN_BEATS) continue;
    let k = 0;
    while (len > MAX_BEATS) {
      out.push({ ...c, id: `${c.id}-${k++}`, beats: piece });
      len -= piece;
    }
    out.push({ ...c, id: k ? `${c.id}-${k}` : c.id, beats: len });
  }
  return out;
}

/** The new track's part of a section, from what harmonize wrote (nothing written: no part). */
function layerOf(out: HarmonizeOutput, kind: HarmonyKind, input: HarmonizeInput): Layer | undefined {
  if (kind === "melody") {
    const m = out.melody && fitMelody(out.melody, input.bars, Math.round(input.bars * input.bar * TICKS));
    return m ? { melody: m } : undefined;
  }
  const cs = fitChords(out.chords ?? [], input.bar);
  return cs.some((c) => !c.rest) ? { chords: cs } : undefined;
}

interface Written {
  /** the new part of each section, by part id (undefined: nothing there) */
  layers: Map<string, Layer | undefined>;
  marks: Record<string, HarmonyMark>;
  /** how the first section written says it should be played (register and voicing) */
  hint: HarmonizeOutput;
}
/** Write a harmony track into every section. `p` has every track in its place. */
function writeAll(p: Progression, key: Key, kind: HarmonyKind, from: string, srcKind: SourceKind, option: string, track: string): Written {
  const layers = new Map<string, Layer | undefined>();
  const marks: Record<string, HarmonyMark> = {};
  let hint: HarmonizeOutput | null = null;
  for (const s of spots(p)) {
    const input = inputIn(p, s, key, kind, from, srcKind, option, track);
    const out = input ? harmonize(input) : {};
    const l = input ? layerOf(out, kind, input) : undefined;
    layers.set(s.part, l);
    marks[s.part] = { src: srcPrint(input), out: outPrint(l) };
    if (l && !hint) hint = out;
  }
  return { layers, marks, hint: hint ?? {} };
}

/** The song with one track's part of every section replaced (and the page's, for the section on screen). */
function put(p: Progression, id: string, by: Map<string, Layer | undefined>): Progression {
  const swap = (ls: Layers | undefined, l: Layer | undefined): Layers | undefined => {
    const { [id]: _, ...rest } = ls ?? {};
    const out = l ? { ...rest, [id]: l } : rest;
    return Object.keys(out).length ? out : undefined;
  };
  const song = p.song;
  if (!song) return { ...p, layers: swap(p.layers, by.get("")) };
  const parts = song.parts.map((x): SongPart => {
    const { layers: _, ...rest } = x;
    const ls = swap(x.layers, by.get(x.id));
    return ls ? { ...rest, layers: ls } : rest;
  });
  const cur = parts.find((x) => x.id === song.blocks.find((b) => b.id === song.current)?.partId);
  return { ...p, song: { ...song, parts }, layers: cur ? cur.layers : p.layers };
}

/** A name for a harmony track: the option's ("Third above"), with a number when the song has one already. */
function freeName(p: Progression, label: string, self?: string): string {
  const taken = new Set(allTracks(p).filter((t) => t.id !== self).map((t) => t.name));
  if (!taken.has(label)) return label;
  for (let n = 2; ; n++) if (!taken.has(`${label} ${n}`)) return `${label} ${n}`;
}

/** How a keyboard plays a chords layer, from what harmonize says about it. */
function keysWay(hint: HarmonizeOutput): Pick<Tone, "voicing" | "register"> {
  const r = hint.register === "high" || hint.register === "low" ? hint.register : undefined;
  return { voicing: keyStyleOf(hint.voicing), ...(r ? { register: r } : {}) };
}
const withoutRegister = (t: Tone): Tone => {
  const { register: _, ...rest } = t;
  return rest;
};

/**
 * What a new harmony track plays. A melody harmony sings on the same instrument as its tune (two
 * voices of one kind blend). A chords layer that changes how the chords are voiced (higher, a
 * shell, a pedal under them) is only heard as such on the keys, so it goes to the piano (or the
 * source's own keyboard) in that voicing; a pad goes to the synth's warm pad, held high above.
 * A re-harmonisation plays instead of its source, so it takes the source's instrument. Anything
 * else starts on the strings, as every new track does.
 */
function toneFor(p: Progression, kind: HarmonyKind, from: string, srcKind: SourceKind, opt: HarmonyOption, hint: HarmonizeOutput): Tone | undefined {
  if (kind === "melody") return srcKind === "melody" && p.tones?.[from] ? { ...p.tones[from] } : undefined;
  const srcId = srcKind === "chords" ? from : "chords";
  const src = toneOf(p, srcId);
  if (opt.instead) return p.tones?.[srcId] ? { ...src } : undefined;
  const way = keysWay(hint);
  if (opt.id === "pad") return { inst: "synth", synth: synthOf({ inst: "synth" }, "chords"), ...way };
  if (onKeys(src)) return { ...withoutRegister(src), ...way };
  if (way.voicing !== "close" || way.register) return { inst: "piano", ...way };
  return undefined;
}

/** The song's mixer with the source of a re-harmonisation muted (it plays instead), or unmuted again (only if it was muted for that). */
const muteFor = (p: Progression, from: string, mute: boolean): Progression["mix"] => (mute ? muteInstead(p.mix, from) : unmuteInstead(p.mix, from));

/**
 * Add a harmony track: written from `plan.from` with `plan.option` in every section that track
 * plays in, with an instrument that suits the option, brought forward for editing (unless
 * `focus` is false: an audition leaves the page as it is). A re-harmonisation mutes the chords it
 * replaces; a new melody line starts a little quieter than the tune.
 */
export function addHarmony(p0: Progression, key: Key, plan: HarmonyPlan, id: string, opts: { focus?: boolean } = {}): { p: Progression; track?: Track } {
  const p = flat(p0);
  const opt = optionOf(plan.kind, plan.option);
  const srcKind = kindOf(p, plan.from);
  if (!opt || !srcKind || !opt.from.includes(srcKind) || allTracks(p).some((t) => t.id === id)) return { p: p0 };
  const w = writeAll(p, key, plan.kind, plan.from, srcKind, plan.option, id);
  const track: Track = { id, kind: plan.kind, name: freeName(p, opt.label), role: "harmony", harmony: { from: plan.from, option: plan.option, marks: w.marks } };
  const tone = toneFor(p, plan.kind, plan.from, srcKind, opt, w.hint);
  const target = insteadOf(p, plan.kind, plan.option, plan.from, srcKind);
  // a second voice sits under the lead in the mix (at the same level, a line above the tune is heard as the tune)
  const mix0 = plan.kind === "melody" ? { ...p.mix, [id]: { db: HARMONY_DB } } : p.mix;
  const mix = target ? muteFor({ ...p, mix: mix0 }, target, true) : mix0;
  const q: Progression = {
    ...put(p, id, w.layers),
    tracks: [...(p.tracks ?? []), track],
    ...(tone ? { tones: { ...p.tones, [id]: tone } } : {}),
    ...(mix ? { mix } : {}),
  };
  return { p: refocus(q, opts.focus === false ? p0.focus : { ...p0.focus, [plan.kind]: id }), track };
}

/**
 * Write a harmony track again, in every section: with another option, or with the same one after
 * its source changed. Every section is written over, so the page asks first when some were
 * changed by hand (see `harmonyState`). A keyboard track takes the new option's voicing; a track
 * still called by its option's name takes the new one's.
 */
export function rewriteHarmony(p0: Progression, key: Key, id: string, option?: string): Progression {
  const p = flat(p0);
  const t = p.tracks?.find((x) => x.id === id);
  const h = t?.harmony;
  if (!t || !h || (t.kind !== "chords" && t.kind !== "melody")) return p0;
  const kind: HarmonyKind = t.kind;
  const next = option ?? h.option;
  const opt = optionOf(kind, next);
  const was = optionOf(kind, h.option);
  const srcKind = kindOf(p, h.from);
  if (!opt || !srcKind || !opt.from.includes(srcKind)) return p0;
  const w = writeAll(p, key, kind, h.from, srcKind, next, id);
  const renamed = was && next !== h.option && (t.name === was.label || t.name.startsWith(`${was.label} `)) ? freeName(p, opt.label, id) : t.name;
  const tracks = (p.tracks ?? []).map((x) => (x.id === id ? { ...x, name: renamed, role: "harmony" as const, harmony: { from: h.from, option: next, marks: w.marks } } : x));
  const tone = p.tones?.[id];
  // a track whose instrument was never chosen starts on the one that suits the new option, as a new track would
  const fresh = !tone && next !== h.option ? toneFor(p, kind, h.from, srcKind, opt, w.hint) : undefined;
  const tones = fresh ? { ...p.tones, [id]: fresh } : kind === "chords" && tone && onKeys(tone) && next !== h.option ? { ...p.tones, [id]: { ...withoutRegister(tone), ...keysWay(w.hint) } } : p.tones;
  // a re-harmonisation plays instead of the chords it replaces; going back to a layer lets them play again
  const before = insteadOf(p, kind, h.option, h.from, srcKind);
  const after = insteadOf(p, kind, next, h.from, srcKind);
  const others = (p.tracks ?? []).filter((x) => x.id !== id);
  const freed = before && !after && !others.some((x) => insteadTarget(x, p.tracks ?? []) === before);
  // (chords this track already played instead of, unmuted by hand since, stay heard: that is the songwriter's choice)
  const theirs = after === before && p.mix?.[after ?? ""]?.mute === false;
  const mix = after && !theirs ? muteFor(p, after, true) : freed ? muteFor(p, before, false) : p.mix;
  const q: Progression = { ...put(p, id, w.layers), tracks, ...(tones ? { tones } : {}), ...(mix ? { mix } : {}) };
  return refocus(q, p0.focus);
}

/**
 * How a harmony track was last written (empty for any other track): it changes when the track is
 * written again, or that is taken back, and never with a change made by hand. A page's undo
 * starts afresh when it changes, so it never puts back notes from before the track was rewritten.
 */
export function writtenAs(p: Progression, id: string): string {
  const h = p.tracks?.find((t) => t.id === id)?.harmony;
  return h ? JSON.stringify(h) : "";
}

/** Is this still a harmony track of the song, there to be written again? (Removed, or its source removed: no.) */
export const isHarmony = (p: Progression, id: string): boolean => !!p.tracks?.some((t) => t.id === id && !!t.harmony);

/** Hear a harmony before it is kept: the song with it added (or written again), the page left as it is. */
export function previewHarmony(p: Progression, key: Key, plan: HarmonyPlan, id: string): Progression {
  const t = p.tracks?.find((x) => x.id === id);
  if (t) return t.harmony && t.harmony.from === plan.from && t.kind === plan.kind ? rewriteHarmony(p, key, id, plan.option) : p;
  return addHarmony(p, key, plan, id, { focus: false }).p;
}

/**
 * The options for a new track written from `from`, each with whether it writes anything in this
 * song (for greying out the ones that don't). An option is useful when some section gets
 * something to hear from it: notes, or chords that differ from the source's (a voicing-only layer
 * always counts). The section on screen is tried first. `instead`: it plays in place of chords
 * of the song (which are muted when it is added), so it is offered apart.
 */
export function harmonyMenu(p0: Progression, key: Key, kind: HarmonyKind, from: string, track = "new"): { option: HarmonyOption; useful: boolean; instead: boolean }[] {
  const p = flat(p0);
  const srcKind = kindOf(p, from);
  if (!srcKind) return [];
  const cur = p.song?.blocks.find((b) => b.id === p.song?.current)?.partId ?? "";
  const all = spots(p).sort((a, b) => (a.part === cur ? -1 : b.part === cur ? 1 : 0));
  return harmonyOptions(kind, srcKind).map((option) => ({
    option,
    instead: !!insteadOf(p, kind, option.id, from, srcKind),
    // (each option asks for its own sections: one that replaces the chords is written where they play without the tune too)
    useful: all.some((s) => {
      const input = inputIn(p, s, key, kind, from, srcKind, option.id, track);
      if (!input) return false;
      const out = harmonize(input);
      const l = layerOf(out, kind, input);
      if (!l) return false;
      if (kind === "melody" || ["pad", "higher", "shell", "fit"].includes(option.id)) return true;
      const before = srcKind === "chords" ? input.source.chords : input.under;
      return !before?.some((c) => !c.rest) || chordPrint(l.chords) !== chordPrint(fitChords(before, input.bar).map((c) => ({ ...c, voicingId: undefined })));
    }),
  }));
}

/** Where a harmony track stands: the sections changed by hand since it was written, and whether its source has changed since. */
export interface HarmonyState {
  /** the labels of the sections whose notes are no longer what was written */
  edited: string[];
  /** the source (or a section's chords, length, time signature, or the key) changed since */
  stale: boolean;
  /** the source track is still there to write from */
  source: boolean;
}
export function harmonyState(p0: Progression, key: Key, id: string): HarmonyState {
  const p = flat(p0);
  const t = p.tracks?.find((x) => x.id === id);
  const h = t?.harmony;
  const srcKind = h && kindOf(p, h.from);
  if (!t || !h || !srcKind || (t.kind !== "chords" && t.kind !== "melody")) return { edited: [], stale: false, source: false };
  const label = new Map(letters(p).map((x) => [x.partId, x.label]));
  const all = spots(p);
  // a song that got its sections after the harmony was written: its one section is the page it was written on
  const markOf = (part: string) => h.marks?.[part] ?? (all.length === 1 ? h.marks?.[""] : undefined);
  const edited: string[] = [];
  let stale = false;
  for (const s of all) {
    const l = s.layers?.[id];
    const m = markOf(s.part);
    const now = outPrint(l);
    const input = inputIn(p, s, key, t.kind, h.from, srcKind, h.option, id);
    const sameOut = m ? m.out === now : emptyLayer(l);
    const sameSrc = m ? m.src === srcPrint(input) : !input;
    if (sameOut && sameSrc) continue;
    // what writing it now would give: when that is what the section holds (the whole song was
    // moved to another key, say, the harmony with it), nothing would be lost and nothing is out of date
    const fresh = input ? outPrint(layerOf(harmonize(input), t.kind, input)) : outPrint(undefined);
    if (fresh === now) continue;
    if (!sameOut) edited.push(label.get(s.part) ?? "A");
    // the source changed here: out of date only if writing it again would give something else
    // (a pad does not care that the tune changed; a swap checked against the tune might)
    if (!sameSrc && fresh !== m?.out) stale = true;
  }
  return { edited, stale, source: true };
}
