/**
 * What plays a chords or melody track: the plucked strings (Guitar), a piano (the grand or the
 * electric one) or the synth, with that instrument's own settings. Every track has its own, so
 * tracks can be layered: a piano under a synth pad under a guitar.
 *
 * The choice belongs to the track, the same in every section (so a track's chord pictures never
 * flip between guitar boxes and keyboards from one section to the next). It is kept in
 * `Progression.tones`, by track id; a track with nothing there plays Guitar, which is how every
 * song made before this sounds.
 */
import { KEY_STYLES, REGISTERS, arrangeKeys, pianoVoicing, type KeyStyle, type Register } from "../keys/voicing";
import type { ChordRef } from "../theory/chords";
import { reviveSynth, type SynthParams } from "../synth/params";
import { presetById, type PresetCategory } from "../synth/presets";

export type InstId = "guitar" | "piano" | "synth";
export const INSTRUMENTS: { id: InstId; name: string }[] = [
  { id: "guitar", name: "Guitar" },
  { id: "piano", name: "Piano" },
  { id: "synth", name: "Synth" },
];
export type KeysModel = "grand" | "electric";
export const KEYS_MODELS: { id: KeysModel; name: string }[] = [
  { id: "grand", name: "Grand" },
  { id: "electric", name: "Electric" },
];

export interface Tone {
  inst: InstId;
  /** the piano: which one */
  keys?: KeysModel;
  /** the piano: duller … brighter (0.5 = as recorded) */
  bright?: number;
  /** the piano: the sustain pedal, changed with every chord */
  pedal?: boolean;
  /** the synth's sound and way of playing (kept while the track plays something else, so going back finds it) */
  synth?: SynthParams;
  /** how chords are laid out on the keys (piano and synth) */
  voicing?: KeyStyle;
  /** where its chords sit on the keys: a pad above the comping band, or low under it (not set = the comping band, C3–C5); a harmony layer sets it */
  register?: Exclude<Register, "mid">;
}
export type Tones = Record<string, Tone>;

export const GUITAR: Tone = { inst: "guitar" };

/** The voicing styles, in the order offered. */
export const VOICINGS: { id: KeyStyle; name: string; hint: string }[] = [
  { id: "close", name: "Close", hint: "Every note within an octave" },
  { id: "open", name: "Open", hint: "Spread a little wider" },
  { id: "spread", name: "Spread", hint: "Root low in the left hand, the rest above" },
  { id: "drop2", name: "Drop 2", hint: "The second voice from the top dropped an octave" },
  { id: "shell", name: "Shell", hint: "Root, third and seventh only" },
];

/** What a track plays, from the song (Guitar when nothing was chosen). */
export const toneOf = (p: { tones?: Tones }, id: string): Tone => p.tones?.[id] ?? GUITAR;
/** Does the track play keys (a piano or the synth), and so show keyboards for its chords? */
export const onKeys = (t: Tone) => t.inst !== "guitar";

/** How a track's chords are voiced on the keys: its own choice, else Spread on the piano (the root in the left hand) and Open on the synth. */
export const voicingOf = (t: Tone): KeyStyle => t.voicing ?? (t.inst === "synth" ? "open" : "spread");

/** The sound a track starts with on the synth: a warm pad for chords, a soft lead for a melody. */
export const SYNTH_START: Record<"chords" | "melody", string> = { chords: "warm-pad", melody: "pwm-lead" };
export function synthOf(t: Tone, kind: "chords" | "melody"): SynthParams {
  return t.synth ?? reviveSynth(presetById(SYNTH_START[kind])?.params);
}

const unit = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

/** A tone loaded from storage, made safe: anything broken or unknown plays Guitar. */
export function reviveTone(raw: unknown): Tone {
  const r = raw as Partial<Tone> | null | undefined;
  if (!r || typeof r !== "object") return GUITAR;
  const inst: InstId = r.inst === "piano" || r.inst === "synth" ? r.inst : "guitar";
  return {
    inst,
    ...(r.keys === "electric" || r.keys === "grand" ? { keys: r.keys } : {}),
    ...(r.bright !== undefined ? { bright: unit(r.bright, 0.5) } : {}),
    ...(r.pedal ? { pedal: true } : {}),
    ...(r.synth && typeof r.synth === "object" ? { synth: reviveSynth(r.synth) } : {}),
    ...(KEY_STYLES.includes(r.voicing as KeyStyle) ? { voicing: r.voicing } : {}),
    ...(r.register === "high" || r.register === "low" ? { register: r.register } : {}),
  };
}

/** Tones loaded from storage: only for tracks that exist and can have one (chords and melody tracks). */
export function reviveTones(raw: unknown, ids: string[]): Tones | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Tones = {};
  for (const id of ids) {
    const t = (raw as Record<string, unknown>)[id];
    if (t === undefined) continue;
    const tone = reviveTone(t);
    // plain Guitar with nothing kept is the same as no tone at all
    if (tone.inst !== "guitar" || Object.keys(tone).length > 1) out[id] = tone;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The song with one track's tone changed. */
export function withTone<P extends { tones?: Tones }>(p: P, id: string, patch: Partial<Tone>): P {
  return { ...p, tones: { ...p.tones, [id]: { ...toneOf(p, id), ...patch } } };
}
/** The song without a track's tone (the track is gone). */
export function withoutTone<P extends { tones?: Tones }>(p: P, id: string): P {
  if (!p.tones || !(id in p.tones)) return p;
  const { [id]: _, ...rest } = p.tones;
  return { ...p, tones: Object.keys(rest).length ? rest : undefined };
}

/** The keys a run of chords is played with on a keyboard track, laid out together so the hands move least. */
export function keysVoicings(chords: { ref: ChordRef; rest?: boolean }[], t: Tone): number[][] {
  const band = t.register ? REGISTERS[t.register] : null;
  return arrangeKeys(chords.map((c) => (c.rest ? null : c.ref)), { style: voicingOf(t), ...(band ? { low: band.low, high: band.high } : {}) });
}

/**
 * One chord on a track's keys on its own (tapped to be heard, drawn on its card, or in the sheet
 * before it is in the tray): in the track's voicing and its register, where its tray plays it.
 */
export function keysVoicing(ref: ChordRef, t: Tone): number[] {
  const band = t.register ? REGISTERS[t.register] : null;
  return pianoVoicing(ref, { style: voicingOf(t), ...(band ? { low: band.low, high: band.high } : {}) });
}

/** Which instrument a key of the instrument switch is: one name for each sound, so a change of model is a change of instrument. */
export const instKey = (t: Tone): string => (t.inst === "piano" ? `piano:${t.keys ?? "grand"}` : t.inst);

/** The General MIDI program a track is written with in a MIDI file, so a DAW opens it on something close. */
const SYNTH_PROGRAM: Record<PresetCategory, number> = { bass: 38, lead: 81, pad: 89, keys: 5, pluck: 84, brass: 62, strings: 50, bells: 98, drone: 95, fx: 99, arp: 81, init: 81 };
export function midiProgram(t: Tone): number {
  if (t.inst === "piano") return t.keys === "electric" ? 4 : 0;
  if (t.inst === "synth") return SYNTH_PROGRAM[presetById(t.synth?.preset ?? "")?.category ?? "pad"];
  return 46; // the strings: Orchestral Harp, as always
}
