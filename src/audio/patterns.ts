/**
 * Playing styles: how a chord is strummed, picked or rolled.
 *
 * A style is written the way guitarists write them down, one symbol per step of the bar:
 *
 *   strums   D down · U up (top strings) · X muted "chuck" · S short stab · s short up-stab
 *            H the upper strings without the bass ("chick") · h the same, softer, upwards
 *            K palm-muted low strings · R roll upwards (a harpist's rolled chord) · L roll downwards
 *            T all strings plucked together · G a sweep up through two octaves · g the same, downwards
 *   picking  p thumb on the bass note · q thumb on the other bass string · r a third bass string
 *            i m a  first, middle and ring finger on the three highest strings
 *            (several together are a pinch: "pa")
 *            1 2 3 …  the chord's notes counted up from the bass, carrying on into the next octave
 *   others   . nothing · > after a symbol = accent · < = soft
 *
 * The pattern is tied to the bar, not to the chord: two chords sharing a bar share one pass of
 * the pattern, just as a player would keep the hand moving through the change.
 *
 * Shared by the player and the MIDI exporter, so what you hear is what lands in your DAW.
 */
import { barBeats, type Beat } from "./beats";
import { tuneBetween, type Melody, type TuneHit } from "../song/melody";
import type { HarpSound } from "./rack";
import type { Tone } from "./tone";
import { STYLES, type Style } from "./styles";
import type { TimeSig } from "../song/meter";
import type { PlayTake } from "./takeplay";

export type PatternId = string;

/** The bar the pattern is laid over. */
export interface Meter {
  /** beats in a bar (0 = the style's own) */
  bar: number;
  /** the beat divides in three (6/8, 12/8): straight styles are bent to fit */
  triplet?: boolean;
  /** the drums' swing, which the 16th-note styles follow */
  swing?: number;
}

/** How a style is played: the same pattern, faster or slower, straighter or lazier, gentler or harder. */
export interface Feel {
  /** the pattern at half speed, as written, or twice as fast */
  speed: 0.5 | 1 | 2;
  /** how far the off-beats lean back, 0…1 (on top of the style's own swing) */
  swing: number;
  /** 0 a whisper … 0.5 as written … 1 dug in hard */
  touch: number;
  /** how spread out strums and rolls are: 0 almost together … 0.5 as written … 1 slow and wide */
  spread: number;
  /** the whole pattern an octave lower or higher */
  octave: -1 | 0 | 1;
}
export const FEEL_DEFAULT: Feel = { speed: 1, swing: 0, touch: 0.5, spread: 0.5, octave: 0 };
const unit = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
/** A feel loaded from storage, made whole. */
export function reviveFeel(raw: unknown): Feel {
  const r = (raw ?? {}) as Partial<Feel>;
  return { speed: r.speed === 0.5 || r.speed === 2 ? r.speed : 1, swing: unit(r.swing, 0), touch: unit(r.touch, 0.5), spread: unit(r.spread, 0.5), octave: r.octave === -1 || r.octave === 1 ? r.octave : 0 };
}

export interface NoteEvent {
  /** beats after the start of the chord */
  beat: number;
  /** seconds after that (one string after another in a strum) */
  delay: number;
  midi: number;
  /** which string plays it: a new note on the same string stops the old one */
  slot: number;
  /** 0..1 */
  velocity: number;
  /** how long it rings, in beats (Infinity = until the chord ends) */
  length: number;
  /** and never longer than this many seconds (muted strums) */
  cut?: number;
}

const byId = new Map(STYLES.map((s) => [s.id, s]));
export const getStyle = (id: PatternId): Style => byId.get(id) ?? byId.get("ring")!;
export const hasStyle = (id: unknown): id is PatternId => typeof id === "string" && byId.has(id);

/** Beats in the bar this style is written for: 3 for a waltz, otherwise 4. */
export const styleBar = (id: PatternId): number => (getStyle(id).four ? 4 : 3);

const STRUMS = "DUXSsHhKRLTGg";
const hasStrum = (st: Style) => [...(st.four ?? []), ...(st.three ?? [])].some((bar) => [...bar].some((ch) => STRUMS.includes(ch)));

/** Where a step falls inside its beat. */
function inBeat(k: number, div: number, st: Style, meter: Meter, lean: number): number {
  if (div === 3) return k / 3;
  if (meter.triplet) return div === 2 ? [0, 2 / 3][k] : [0, 1 / 3, 2 / 3, 5 / 6][k];
  const swing = Math.max(div === 4 ? (meter.swing ?? 0) : 0, st.swing ?? 0, lean);
  return k / div + (k % 2 === 1 ? swing / (3 * div) : 0);
}

/** A small, repeatable wobble in loudness, so no two strums are exactly alike. */
const wobble = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return 0.97 + (x - Math.floor(x)) * 0.06;
};

interface Str {
  m: number;
  s: number;
}

/** Turn one chord (the note on each string, null = not played) into notes, for a chord that starts `at` beats into its section. */
export function styleNotes(midi: (number | null)[], beats: number, styleId: PatternId, at = 0, meter: Meter = { bar: 0 }, feel: Partial<Feel> = FEEL_DEFAULT, waltz?: boolean): NoteEvent[] {
  const st = getStyle(styleId);
  const native = st.four ? 4 : 3;
  const three = waltz ?? (!!st.three && (Math.abs((meter.bar > 0 ? meter.bar : native) - 3) < 1e-6 || !st.four));
  const speed = feel.speed ?? 1;
  if (speed !== 1) {
    // another speed: lay the pattern over time stretched the other way, then put the notes back.
    // Slowed down, the pattern runs on across the bar lines (four beats of it now take two bars).
    const bar = speed > 1 && meter.bar > 0 ? meter.bar * speed : 0;
    return styleNotes(midi, beats * speed, styleId, at * speed, { ...meter, bar }, { ...feel, speed: 1 }, three).map((e) => ({ ...e, beat: e.beat / speed, length: e.length / speed }));
  }
  const shift = 12 * (feel.octave ?? 0);
  const strings: Str[] = midi.map((m, s) => ({ m, s })).filter((x): x is Str => x.m !== null).map((x) => ({ m: x.m + shift, s: x.s }));
  if (!strings.length || beats <= 0) return [];
  const touch = 0.55 + 0.9 * (feel.touch ?? 0.5);
  const wide = Math.pow(2, ((feel.spread ?? 0.5) - 0.5) * 3);
  const lean = feel.swing ?? 0;
  const L = meter.bar > 0 ? meter.bar : native;
  const grid = (three ? st.three! : st.four!).map((b) => b.trim().split(/\s+/));
  const P = three ? 3 : 4;
  const div = st.div;
  // a strum crosses six strings in about 20 to 35 ms: quicker when the hand is moving fast
  const spread = (st.spread ?? (div === 2 ? 0.007 : 0.0045)) * wide;
  const roll = (st.roll ?? 0.03) * wide;

  const K = strings.length;
  const bass = strings[0];
  // the thumb's strings: a chord rooted on the 6th string alternates 6 and 4, one on the 5th alternates 5 and 4
  const alt = strings[K >= 6 ? 2 : Math.min(1, K - 1)];
  const third = strings[K >= 6 ? 1 : Math.min(2, K - 1)];
  const up = (x: Str, oct = 1): Str => ({ m: x.m + 12 * oct, s: x.s + 6 * oct });
  // on a four-string chord the thumb takes two of them, so the fingers move up to the two that are left
  const thumbs = K === 4 && grid.some((bar) => bar.some((t) => t.includes("q")));
  const top = strings.slice(thumbs ? 2 : Math.max(1, K - 3));
  /** the nth note counted up from the bass; past the top string it starts again an octave higher (two octaves at most) */
  const nth = (n: number): Str => up(strings[(n - 1) % K], Math.floor((n - 1) / K) % 3);
  const sweep = Array.from({ length: Math.min(12, K * 2) + 1 }, (_, j) => nth(j + 1));
  const fingers: Record<string, Str> =
    top.length >= 3 ? { i: top[0], m: top[1], a: top[2] } : top.length === 2 ? { i: top[0], m: top[1], a: up(bass) } : top.length === 1 ? { i: top[0], m: up(bass), a: up(top[0]) } : { i: up(bass), m: up(bass), a: up(bass, 2) };

  const out: NoteEvent[] = [];
  const strum = (beat: number, list: Str[], velocity: number, gap: number, length = Infinity, cut?: number, lift = -0.03) =>
    list.forEach((x, j) => out.push({ beat, delay: j * gap, midi: x.m, slot: x.s, velocity: Math.min(1, velocity * (1 + j * lift)), length, cut }));

  /** Play one token. Returns false when it was a rest. */
  const play = (tok: string, beat: number, weight: number): boolean => {
    if (!tok || tok === ".") return false;
    const accent = tok.includes(">") ? 1.2 : tok.includes("<") ? 0.62 : 1;
    const v = weight * accent * touch;
    const high = strings.slice(-Math.min(4, K));
    const chick = K > 2 ? strings.slice(1) : strings;
    let any = false;
    for (const ch of tok) {
      if (ch === ">" || ch === "<") continue;
      any = true;
      if (ch >= "1" && ch <= "9") {
        const y = nth(Number(ch));
        out.push({ beat, delay: 0, midi: y.m, slot: y.s, velocity: Math.min(1, (ch === "1" ? 0.78 : 0.66) * v), length: Infinity });
        continue;
      }
      switch (ch) {
        case "D": strum(beat, strings, 0.84 * v, spread); break;
        case "U": strum(beat, [...high].reverse(), 0.7 * v, spread * 0.8); break;
        case "X": strum(beat, strings, 0.38 * v, 0.003, 0.12, 0.045); break;
        case "S": strum(beat, strings, 0.8 * v, spread * 0.6, 0.3, 0.16); break;
        case "s": strum(beat, [...high].reverse(), 0.68 * v, spread * 0.6, 0.3, 0.16); break;
        case "H": strum(beat, chick, 0.68 * v, spread); break;
        case "h": strum(beat, [...chick.slice(-3)].reverse(), 0.56 * v, spread * 0.8); break;
        case "K": strum(beat, strings.slice(0, Math.min(3, K)), 0.74 * v, 0.006, 0.42, 0.2); break;
        // a rolled chord swells a little towards its top note
        case "R": strum(beat, strings, 0.74 * v, roll, Infinity, undefined, 0.025); break;
        case "L": strum(beat, [...strings].reverse(), 0.72 * v, roll, Infinity, undefined, -0.02); break;
        case "T": strum(beat, strings, 0.76 * v, 0.002, Infinity, undefined, 0); break;
        case "G": strum(beat, sweep, 0.5 * v, 0.032, Infinity, undefined, 0.035); break;
        case "g": strum(beat, [...sweep].reverse(), 0.62 * v, 0.032, Infinity, undefined, -0.03); break;
        case "p": case "q": case "r": case "i": case "m": case "a": {
          const y = ch === "p" ? bass : ch === "q" ? alt : ch === "r" ? third : fingers[ch];
          out.push({ beat, delay: 0, midi: y.m, slot: y.s, velocity: Math.min(1, (ch === "p" ? 0.8 : ch === "q" || ch === "r" ? 0.72 : 0.64) * v), length: Infinity });
          break;
        }
      }
    }
    return any;
  };

  const entry = st.entry ?? (hasStrum(st) ? "D" : /[1-9]/.test(grid[0].join("")) ? "1" : "p");
  let started = false;
  for (let g = Math.ceil(at * div - 1e-6); g / div < at + beats - 1e-6; g++) {
    const whole = Math.floor(g / div + 1e-9);
    const k = g - whole * div;
    const rel = whole + inBeat(k, div, st, meter, lean) - at;
    if (rel >= beats - 1e-6) continue;
    const straight = g / div;
    const barIdx = Math.floor(straight / L + 1e-6);
    const inBar = straight - barIdx * L;
    const step = Math.round((inBar % P) * div);
    let tok = grid[barIdx % grid.length][step] ?? ".";
    const first = Math.abs(straight - at) < 1e-6;
    if (first) {
      started = true;
      // a chord that arrives part-way through the pattern is always heard: the bass under a picked note, a strum where the hand would rest
      if (entry && step !== 0) {
        if (tok === ".") tok = entry;
        else if (!hasStrumChar(tok) && !/[1-9]/.test(tok)) tok = tok.includes("p") ? tok : /[qr]/.test(tok) ? tok.replace(/[qr]/, "p") : "p" + tok;
        else if (/^[2-9]/.test(tok)) tok = "1";
      }
    }
    const weight = (k === 0 ? (inBar < 1e-6 ? 1 : 0.94) : div === 4 ? (k === 2 ? 0.86 : 0.78) : div === 3 ? 0.82 : 0.86) * wobble(g);
    play(tok, Math.max(0, rel), weight);
  }
  // the chord starts between two steps of the pattern
  if (!started && entry) play(entry, 0, 0.94);
  return out.sort((x, y) => x.beat - y.beat || x.delay - y.delay);
}

const hasStrumChar = (tok: string) => [...tok].some((ch) => STRUMS.includes(ch));


/** The bar a style is laid over: the drums' when they are on, otherwise the style's own. */
export function meterOf(b: Beat | null | undefined, own?: { bar: number; triplet?: boolean; swing?: number }): Meter {
  const on = !!b?.on;
  // the song's time signature says how long the bar is; the drums add their swing (and a triplet grid, their shuffle).
  // (A swing given with the bars is the one played with, whatever the drums': the item then says whose swing it follows.)
  return { bar: own?.bar ?? (on ? barBeats(b!) : 0), triplet: !!own?.triplet || (on && b!.div === 3), swing: own?.swing ?? (on && b!.div === 4 ? b!.swing : 0) };
}

export interface PlayItem {
  midi: (number | null)[];
  beats: number;
  /** the drum rhythm under this chord (missing = the player's own beat) */
  drums?: Beat;
  /** the playing style of this chord (missing = the player's own), and how it is played */
  style?: PatternId;
  feel?: Partial<Feel>;
  /** the bars this chord is played in: their length in beats (its section's time signature), whether each beat divides in three, the signature itself (for MIDI files), and the swing the sixteenth-note styles follow (not set = the drums') */
  meter?: { bar: number; triplet?: boolean; sig?: TimeSig; swing?: number };
  /** a song section starts here: its drum pattern and its playing style start again from bar 1 */
  section?: boolean;
  /** the music jumps here: a run of a loop starts that is not next to the one before it in the song (what sounds from before stops here) */
  jump?: boolean;
  /** the melody over this chord's section (missing = the player's own) */
  tune?: PlayTune | null;
  /** the harp this chord is played on: its track's sound (missing = the harp as it is set) */
  sound?: HarpSound;
  /** the instrument the track plays (missing = as it is set) */
  tone?: Tone;
  /** not a chord: the silence between a section's last chord and its end */
  pad?: boolean;
  /** how many beats into its section this item starts (given when playing starts or loops part-way through a section) */
  from?: number;
  /** the extra tracks of this item's section (the same object on every item of the section) */
  extra?: ExtraPlay;
}

/** What the tracks added on the Track page play in one section. */
export interface ExtraPlay {
  /** extra chords tracks: each chord with where it starts in the section, in beats */
  chords: { track: string; at: number; beats: number; midi: (number | null)[]; style: PatternId; feel?: Partial<Feel>; sound: HarpSound; tone?: Tone }[];
  /** extra melody tracks */
  tunes: { track: string; tune: PlayTune }[];
  /** extra drum tracks */
  drums: { track: string; beat: Beat }[];
  /** recorded takes that sound in this section: where each starts (beats into the section: before it, for one
   * that began in a section before and runs on into this one), and which part of its buffer plays */
  takes?: PlayTake[];
}

/**
 * Where the section an item belongs to started, in beats from the start of the list. The drums,
 * the melody and the playing style all count from there.
 */
export const sectionStart = (item: PlayItem, i: number, at: number, origin: number): number => (item.from !== undefined ? at - item.from : i === 0 || item.section ? at : origin);

/** A melody ready to play: its notes, the length of a bar under it, and the drums' swing. */
export interface PlayTune {
  m: Melody;
  bar: number;
  swing: number;
  /** the melody harp's sound in this section (missing = as it is set) */
  sound?: HarpSound;
  /** the instrument the melody track plays (missing = as it is set) */
  tone?: Tone;
}

/** Every melody note of a run of chords, with the time (in beats from the start) each one sounds. */
export function itemTune(items: PlayItem[], tune: PlayTune | null = null): TuneHit[] {
  const out: TuneHit[] = [];
  let at = 0;
  let origin = 0;
  items.forEach((item, i) => {
    origin = sectionStart(item, i, at, origin);
    const t = item.tune === undefined ? tune : item.tune;
    if (t && t.m.on !== false) for (const h of tuneBetween(t.m, t.bar, at - origin, at - origin + item.beats, t.swing)) out.push({ beat: h.beat + origin, midi: h.midi });
    at += item.beats;
  });
  return out;
}

/** Every note of a run of chords, with the time (in beats from the start) each one sounds. */
export function itemNotes(items: PlayItem[], pattern: PatternId, beat: Beat | null = null) {
  const out: { at: number; item: number; e: NoteEvent; beats: number }[] = [];
  let at = 0;
  let origin = 0;
  items.forEach((item, i) => {
    origin = sectionStart(item, i, at, origin);
    for (const e of styleNotes(item.midi, item.beats, item.style ?? pattern, at - origin, meterOf(item.drums ?? beat, item.meter), item.feel)) out.push({ at, item: i, e, beats: item.beats });
    at += item.beats;
  });
  return out;
}

export { STYLES, STYLE_GROUPS, type Style, type StyleGroup } from "./styles";
