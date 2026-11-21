// A song as tracks and clips (stored version 5): the types every part of the track view shares.
// Below the types: how long a clip is and how its content comes round again (the window rule).
// The functions that change a song are in the files beside this one.
import type { ProgChord, ArrangeSettings } from "../ui/state";
import type { Melody } from "../song/melody";
import type { Groove, DrumKit } from "../audio/beats";
import type { PatternId, Feel } from "../audio/patterns";
import type { HarpSound } from "../audio/rack";
import type { Tone } from "../audio/tone";
import type { VocalFx } from "../audio/vocalfx";
import type { Mix } from "../audio/mix";
import { sigBeats, type TimeSig } from "../song/meter";
import type { Shape } from "../theory/harmonize";
import type { Key } from "../theory/keys";

export const SONG_V = 5;

// ── tracks ──────────────────────────────────────────────────
export type TrackKind = "chords" | "melody" | "bass" | "drums" | "vocals" | "audio";
/** What a clip holds. Melody and bass clips are the same thing; so are vocal and blank-audio clips. */
export type ClipKind = "chords" | "melody" | "drums" | "audio";
export const CLIP_OF: Record<TrackKind, ClipKind> =
  { chords: "chords", melody: "melody", bass: "melody", drums: "drums", vocals: "audio", audio: "audio" };
/** Can a clip of this kind lie on a track of that kind? (The only drop rule.) */
export const accepts = (track: TrackKind, clip: ClipKind): boolean => CLIP_OF[track] === clip;

interface TrackBase {
  id: string;
  kind: TrackKind;
  name: string;
  /** 0–7, the colour of its clips (the old section colours are reused as the palette) */
  color?: number;
  /** tracks that conversion split from one old row share that row's id here (one heading in the chord sheet) */
  group?: string;
}

/** The clip being composed in a plugin, not yet on the timeline. It has no place of its own: it is treated as lying at the draft anchor. */
export interface Draft<C> {
  content: C;
  /** the time signature it is written in (the one at the anchor when it was started) */
  sig: TimeSig;
}

/** A chords track: what plays it and how it sounds, on every clip. */
export interface ChordsTrack extends TrackBase {
  kind: "chords";
  tone: Tone;                      // Guitar / Piano / Synth with its settings (voicing, pedal, synth sound and way of playing)
  sound?: Partial<HarpSound>;      // strings + the whole effects rack; missing knobs are defaults
  /** a chords track the engine's bar pulse and a pedalled piano may follow; set by conversion and on the first chords track made */
  lead?: true;
  role?: "harmony";
  /** the source and option it was last harmonised with (the per-clip record is on the clip) */
  harmony?: { from: string; option: string };
  draft?: Draft<ChordsContent>;
}

/** A melody or bass track: same data, same composer. */
export interface TuneTrack extends TrackBase {
  kind: "melody" | "bass";
  tone: Tone;
  sound?: Partial<HarpSound>;
  role?: "harmony";
  harmony?: { from: string; option: string };
  draft?: Draft<Melody>;
}

export interface DrumsTrack extends TrackBase {
  kind: "drums";
  /** machine, each drum's sound, the drum mixer, every effect, Human, Pump: all of `Beat` that is not rhythm */
  kit: DrumKit;
  /** a drums track whose swing and triplet grid the chord styles and melodies may follow */
  lead?: true;
  draft?: Draft<Groove>;
}

/** Which input of the interface a track records. `ch` counts from 0 (the old `Track.input` counted from 1). A pair is `ch` and `ch + 1`, recorded in stereo. */
export interface InputRef { ch: number; pair?: true }

/** A vocal track or a blank audio track: recorded takes, one sound chain. */
export interface AudioTrack extends TrackBase {
  kind: "vocals" | "audio";
  input?: InputRef;                // none = input 1 (ch 0)
  fx: VocalFx;                     // the vocal chain (off on a new blank track)
  /** every take recorded on it; clips play stretches of these. No undo, redo or clip edit ever removes one */
  takes: Take5[];
}
export type Track = ChordsTrack | TuneTrack | DrumsTrack | AudioTrack;

// ── clip content: the shapes the composers already edit ─────
/** A chords clip's content: today's per-section chords fields, moved together. */
export interface ChordsContent {
  chords: ProgChord[];             // unchanged type; a run with no gaps, from the content's first beat
  bars: number;                    // the frame: chords past it are kept but not played (as a section's `bars` today)
  style: PatternId;                // was `pattern` / `Settings.style`
  feel?: Partial<Feel>;
  arrange?: ArrangeSettings;       // guitar neck area; none = each chord's own shape
}
// A melody or bass clip's content is `Melody` exactly as it is ({ div, bars, notes }); `on` is not used (the clip's `mute` is).
// A drums clip's content is `Groove` exactly as it is ({ patternId, name, edited, steps, div, bars, swing, rows }); `on` is not used.
// A drums content always fits its clip's signature: steps / div === sigBeats(clip.sig) (kept by `setContent`).

// ── clips ───────────────────────────────────────────────────
interface ClipBase {
  id: string;
  track: string;
  /** where its left edge is: beats from the start of the song, >= 0 */
  start: number;
  /** kept but not played (was Melody.on === false, Beat.on === false) */
  mute?: boolean;
}
/** A composed clip. All three numbers are whole beats. */
interface NoteClipBase extends ClipBase {
  /** how long it is shown and heard, in beats, > 0 */
  len: number;
  /** how far into its content the left edge is, 0 <= off < contentBeats(clip) */
  off: number;
  /** the time signature its content was written in: bar length inside the content */
  sig: TimeSig;
}
export interface ChordsClip extends NoteClipBase {
  kind: "chords";
  content: ChordsContent;
  harmony?: HarmonyMark5;
  /** it plays instead of that chords track while it sounds (a harmony written to replace chords) */
  instead?: string;
}
export interface MelodyClip extends NoteClipBase { kind: "melody"; content: Melody; harmony?: HarmonyMark5 }
export interface DrumsClip extends NoteClipBase { kind: "drums"; content: Groove }
/**
 * A stretch of a recorded take. Numbers are frames of the take's file.
 * A clip made by recording, by conversion or by a split has from = 0 and to = take.frames: its content is the whole
 * take, and `off` and `frames` say which part is shown. So an edge dragged back out first uncovers the rest of the
 * take, and only repeats it past the take's end. (Old and new clips behave the same.)
 */
export interface AudioClip extends ClipBase {
  kind: "audio";
  take: string;                    // id in its track's `takes`; any take of the same spot can be swapped in
  from: number; to: number;        // the stretch of the take that is its content (one cycle), from < to <= take.frames
  off: number;                     // frames into that stretch where the left edge is, 0 <= off < to - from
  frames: number;                  // how long it is shown and heard, in frames
}
export type NoteClip = ChordsClip | MelodyClip | DrumsClip;
export type Clip = NoteClip | AudioClip;

/** What Harmonize wrote into a clip (was `HarmonyMark`, kept per section part). */
export interface HarmonyMark5 { from: string; option: string; shape?: Shape; src: string; out: string; along?: true }

/** A take: `song/takes.ts` Take with its place as a song beat. */
export interface Take5 extends Omit<import("../song/takes").Take, "at"> {
  /** the song beat its first frame was sung on; null = unplaced (its old section is gone, or its clip was undone) */
  at: number | null;
  /** 2 = a stereo file from an input pair (none = mono) */
  channels?: 2;
}

/** The takes of an audio track that was removed (or whose making was undone): kept so no recording is lost by accident. */
export interface Shelved { track: string; name: string; kind: "vocals" | "audio"; takes: Take5[]; at: number; saves: number }

// ── the song ────────────────────────────────────────────────
export interface Marker { id: string; beat: number; name: string; color?: number }

export interface TimelineSong {
  v: 5;
  bpm: number;                     // one tempo, 40–200
  meter: TimeSig;                  // the time signature from bar 1
  /** later changes: from this bar on (0 = bar 1; sorted; bar > 0) */
  sigs?: { bar: number; sig: TimeSig }[];
  tracks: Track[];                 // top to bottom, any number
  clips: Clip[];
  mix?: Mix;                       // unchanged type, keyed by track id
  markers?: Marker[];              // names on the ruler (old section names arrive here)
  /** the song is at least this long, in beats (conversion writes the old total here so empty bars at the end are kept; cutTime and insertTime move it) */
  end?: number;
  /** removed recordings (see `Shelved`) */
  shelf?: Shelved[];
}

// ── what is open and selected: never part of an idea ──
export interface Region { from: number; to: number }   // beats, from < to
export interface Session {
  cursor: number;                                   // the edit cursor, beats
  /** the ruler's loop: one or more stretches in song order, never touching or overlapping (they are merged) */
  loop: { regions: Region[]; on: boolean } | null;
  sel: { clips: string[]; track: string | null };
  pxPerBeat: number;                                // zoom
  scroll: number;                                   // the beat at the left edge of the lanes
  /** the audio track that records. NOT stored: null at every start and when another idea opens */
  armed: string | null;
  windows: WinState[];                              // open plugin windows
}

// ── declared here so this file imports nothing from the screen code; the files that use them hand them on ──
/** One plugin window: which track it belongs to, what it has open, and where it was last left. */
export interface WinState {
  id: string;                          // "compose:<track id>" or "sound:<track id>"
  kind: "compose" | "sound";
  track: string;
  /** what the composer has open: a placed clip, or (none) the track's draft */
  clip?: string;
  x: number; y: number; w: number; h: number;
  open: boolean;
}

/** A track's sound on its own, to carry to another track or another idea. */
export interface SoundCopy { kind: ClipKind; tone?: Tone; sound?: Partial<HarpSound>; kit?: DrumKit; fx?: VocalFx }

/** What a copy holds: clips with starts counted from the first one, and each clip's track (with its sound) so a paste can make the track. */
export interface Clipboard5 { key: Key; clips: Clip[]; tracks: Track[]; takes: Take5[] }

// ── lengths and the repeat rule ─────────────────────────────
// The content of a clip repeats without end in both directions; the clip is the stretch of that which is shown.
// So one rule covers trimming and repeating: an edge drag only moves that edge of the window.

/** A number brought into 0..n (also for a negative one). */
export const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** The rate a take is read at when its record cannot be found (frames a second). */
export const DEFAULT_RATE = 48000;
/** Frames of a take as beats at a tempo, and back. Audio does not stretch, so this is the only place tempo meets frames. */
export const framesToBeats = (frames: number, rate: number, bpm: number): number => frames / rate / (60 / bpm);
export const beatsToFrames = (beats: number, rate: number, bpm: number): number => beats * (60 / bpm) * rate;

/** Length of one cycle of a clip's content. Note clips: beats. (A rhythm with no `bars` is one bar long.) */
export const contentBeats = (c: NoteClip): number => Math.max(1, c.content.bars ?? 1) * sigBeats(c.sig);
/** Audio clips: frames. */
export const contentFrames = (c: AudioClip): number => c.to - c.from;

/** The rate of the take an audio clip plays, from its track's take list. */
export function rateOf(song: Pick<TimelineSong, "tracks">, c: AudioClip): number {
  const t = song.tracks.find((x) => x.id === c.track);
  const take = t && (t.kind === "vocals" || t.kind === "audio") ? t.takes.find((k) => k.id === c.take) : undefined;
  return take && take.rate > 0 ? take.rate : DEFAULT_RATE;
}

/** A clip's length in beats at a tempo (audio does not stretch, so its length in beats follows the tempo). `rate`: its take's, for an audio clip. */
export function clipBeats(c: Clip, bpm: number, rate?: number): number {
  return c.kind === "audio" ? framesToBeats(c.frames, rate && rate > 0 ? rate : DEFAULT_RATE, bpm) : c.len;
}
/** The song beat where a clip ends. */
export const clipEnd = (c: Clip, song: TimelineSong): number => c.start + clipBeats(c, song.bpm, c.kind === "audio" ? rateOf(song, c) : undefined);

/** Which point of the content sounds at song beat x (note clips). */
export const phase = (c: NoteClip, x: number): number => mod(c.off + (x - c.start), contentBeats(c));

/** The stretches of content a clip plays, in order: clip-relative start, and the content range. */
export function cycles(c: NoteClip): { at: number; from: number; to: number }[] {
  return rounds(c.off, c.len, contentBeats(c));
}
/** The same for an audio clip, in frames: where in the clip each stretch starts, and the stretch of the take (from `c.from` on). */
export function frameCycles(c: AudioClip): { at: number; from: number; to: number }[] {
  return rounds(c.off, c.frames, contentFrames(c)).map((r) => ({ at: r.at, from: c.from + r.from, to: c.from + r.to }));
}
function rounds(off: number, len: number, size: number): { at: number; from: number; to: number }[] {
  const out: { at: number; from: number; to: number }[] = [];
  if (!(size > 0) || !(len > 0)) return out;
  let from = mod(off, size);
  for (let at = 0; at < len - 1e-9; ) {
    const to = Math.min(size, from + (len - at));
    out.push({ at, from, to });
    at += to - from;
    from = 0;
  }
  return out;
}

/** The song beats inside the clip where the content starts again: where a notch is drawn. */
export function notches(c: Clip, song: TimelineSong): number[] {
  if (c.kind !== "audio") return cycles(c).slice(1).map((r) => c.start + r.at);
  const rate = rateOf(song, c);
  return frameCycles(c).slice(1).map((r) => c.start + framesToBeats(r.at, rate, song.bpm));
}

/** How fine `zeroBeat` below is kept: 16 million steps to a beat. */
const ZERO_GRID = 2 ** 24;
/**
 * The song beat on which the first frame of an audio clip's take lies (were the take laid out from there). A tempo
 * change keeps this beat and moves the clip, so the voice stays where it was sung; two halves of a split share it.
 * It is kept to a grid far finer than a sample, so the same clip gives exactly the same beat at every tempo.
 */
export const zeroBeat = (c: AudioClip, bpm: number, rate: number): number =>
  Math.round((c.start - framesToBeats(c.from + c.off, rate, bpm)) * ZERO_GRID) / ZERO_GRID;
