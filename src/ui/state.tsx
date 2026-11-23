import { createContext, useContext } from "react";
import { reviveBeat, reviveUserKits, type Beat, type BeatPattern, type UserKit } from "../audio/beats";
import { hasStyle, reviveFeel, type Feel, type PatternId } from "../audio/patterns";
import { reviveSig, sigBeats, type TimeSig } from "../song/meter";
import { conform, sectionSig } from "../song/unity";
import { reviveMelody, type Melody } from "../song/melody";
import { DEFAULT_BARS, fitBars } from "../song/frame";
import { isSurface, type Surface } from "../canvas/weave";
import { isLayoutId, type LayoutId } from "../canvas/place";
import { isLayer, type LayerKind } from "../canvas/layers";
import type { HarpSound } from "../audio/rack";
import { reviveUserSounds, type UserSound } from "../audio/sounds";
import type { Tuning } from "../guitar/tunings";
import type { Voicing } from "../guitar/voicings";
import { pc } from "../theory/notes";
import type { ChordRef } from "../theory/chords";
import { reviveIdea } from "../song/library";
import { commit, reviveSong, settle, toneIdsIn, type Song } from "../song/structure";
import { reviveClips, type Clips } from "../song/clip";
import { SOUND_V, migrateSong } from "../song/migrate";
import { reviveView, type ViewPrefs } from "../song/window";
import { reviveMix, type Mix } from "../audio/mix";
import { reviveNotes, withoutNotes } from "../song/chordnotes";
import { prune, reviveArrange, reviveFirstHarmony, reviveLayers, reviveTracks, type FirstHarmony, type Focus, type Layers, type Track } from "../song/tracks";
import { reviveSound } from "../audio/rack";
import { reviveTones, type Tones } from "../audio/tone";
import type { CloudStatus } from "./cloud";
import type { Key } from "../theory/keys";

export type Tab = "guitar" | "piano";
/** The three parts of a song section. */
/** The four pages: the frame (sections, lengths, key, tempo) and the three parts that play inside it. */
export type Pane = "track" | "frame" | "rhythm" | "melody" | "drums" | "vocals" | "canvas";
export const PANES: { id: Pane; label: string }[] = [{ id: "track", label: "Track" }, { id: "frame", label: "Frame" }, { id: "rhythm", label: "Chords" }, { id: "melody", label: "Melody" }, { id: "drums", label: "Drums" }, { id: "vocals", label: "Vocals" }, { id: "canvas", label: "Canvas" }];
/** How the canvas is set: its colours, its surface, how the paint behaves, and how fast old paint fades (0 = it stays, 3 = fast). */
export interface CanvasPrefs {
  palette: string;
  surface?: Surface;
  fade?: 0 | 1 | 2 | 3;
  /** how the paint behaves: as the music suggests, always wet, or always thick */
  style?: "auto" | "wash" | "thick";
  /** wet paint runs down the canvas */
  drips?: boolean;
  /** for a song from a file: how many seconds of it one pass across the canvas holds (0 = the whole song) */
  pass?: number;
  /** the guide over the canvas (frequencies, bars, what the mix covers): shown unless this is false */
  guide?: boolean;
  /** how the music is laid out on the canvas ("auto", or none: the music chooses) */
  layout?: LayoutId;
  /** layers of the music not painted */
  hide?: LayerKind[];
}
export type LabelMode = "intervals" | "notes" | "fingers";

export interface ProgChord {
  id: string;
  ref: ChordRef;
  /** how long it lasts, in beats (half beats allowed) */
  beats: number;
  /** Pinned voicing id (frets string). Undefined = auto-arranged. */
  voicingId?: string;
  /** a silence of this length: nothing is played (its chord is only a placeholder) */
  rest?: boolean;
  /**
   * the exact notes this chord plays (MIDI, low to high), written by Harmonize so a chords track
   * sits above and around another; none: voiced by its instrument as usual. Played only while
   * every note belongs to the chord (see song/notes' `playedNotes`).
   */
  notes?: number[];
}

export interface Progression {
  chords: ProgChord[];
  bpm: number;
  pattern: PatternId;
  loop: boolean;
  /** The chords track on screen in the section on screen, on the guitar: when set, its shapes are arranged together in one area of the neck. null = each chord uses your own shape. (Every chords track in every section has its own.) */
  arrange?: ArrangeSettings | null;
  /** The first drums track of the section on screen: its rhythm and on/off, and its kit there (undefined = never touched). */
  beat?: Beat;
  /** How the first chords track is played in the section on screen (its style is `pattern`): speed, swing, touch … */
  feel?: Partial<Feel>;
  /** The melody of the section on screen. */
  melody?: Melody;
  /** How long the section on screen lasts, in bars. */
  bars?: number;
  /** The sound and effects of the harp that plays the first chords track in the section on screen (missing knobs are at their defaults). */
  sound?: Partial<HarpSound>;
  /** The same for the harp that plays the first melody track: a separate instrument on a separate effects channel. */
  tuneSound?: Partial<HarpSound>;
  /** What ▶ does: go round the section on screen, or play on through every section of the song. */
  play?: "section" | "song";
  /** Song structure: sections in order. `chords` above are then the selected section's chords. */
  song?: Song | null;
  /** The mixer: each track's volume, mute and solo, for the whole song (set on the Track page) */
  mix?: Mix;
  /** The song's tracks beyond the first chords, melody and drums tracks (which every section has): rows of the Track page */
  tracks?: Track[];
  /** The first chords and melody tracks' harmony records, when Harmonize wrote into them (see song/tracks) */
  firstHarmony?: FirstHarmony;
  /** The added tracks in the section on screen: what each holds there and how it sounds there (see song/tracks) */
  layers?: Layers;
  /** Which track each page is editing, when it is not the first of its kind */
  focus?: Focus;
  /** Which track each page was editing in each section, the last time it was on screen (by part id): going back there brings them forward again */
  focusIn?: Record<string, Focus>;
  /** The song's time signature, set on the Frame page: how long every bar is, on every page, in every section that has no signature of its own */
  meter?: TimeSig;
  /** What plays each chords and melody track in the section on screen (Guitar, Piano or Synth) and how it is set, by track id; a track with none plays Guitar */
  tones?: Tones;
  /** How it is stored: 3 = every section has its own tracks and settings (older songs are moved over: see song/migrate) */
  v?: number;
}

export interface ArrangeSettings {
  /** neck area index (0 = open, 1 = frets 1–3, 2 = 4–6 …) */
  zone: number;
  strings: "any" | 3 | 4 | 5;
  /** allow a different note in the bass when it makes the changes smoother */
  inversions: boolean;
}

export interface SavedProgression {
  id: string;
  name: string;
  key: Key;
  progression: Progression;
  savedAt: number;
  /** last time it was saved or renamed (older ideas only have savedAt) */
  updatedAt?: number;
  capo?: number;
  tuningId?: string;
}

export interface Settings {
  tuningId: string;
  capo: number;
  leftHanded: boolean;
  labels: LabelMode;
  theme: "auto" | "dark" | "light";
  /** Prefer shapes without full barres everywhere in the app */
  avoidBarre: boolean;
  /** settings schema version */
  v?: number;
}

export interface AppState {
  tab: Tab;
  key: Key;
  settings: Settings;
  progression: Progression;
  saved: SavedProgression[];
  /** Your chosen way to play each chord (by tuning, capo and chord) */
  shapes: Record<string, string>;
  /** Rhythms you saved from the beat editor */
  myBeats: BeatPattern[];
  /** Drum setups (machine, sounds and effects) you saved */
  myKits: UserKit[];
  /** Harp sounds you saved */
  mySounds: UserSound[];
  /** Which part of the section is on screen */
  pane?: Pane;
  /** The canvas: colours, surface, fading */
  canvas?: CanvasPrefs;
  /** The saved idea that is open (null = not saved yet) */
  ideaId?: string | null;
  /** The idea not saved yet that is open, told apart from the next one (see ./openidea5) */
  draft?: string;
  /** Ideas that were deleted, and when, so other devices delete them too */
  tombs?: Record<string, number>;
  /** What was last copied on the Rhythm, Melody and Drums pages (one clipboard each), and the last whole section copied on the Frame page */
  clip?: Clips;
  /** The recording setup on this computer: which interface, the switches on it, how you listen */
  studio?: Studio;
  /** How many bars the editing pages show at once, and whether they follow the music (kept apart from the song, so it never makes an idea look changed) */
  view?: ViewPrefs;
}
/** The app's state as it is stored today (version 4), under the name the track view's code knows it by. */
export type AppStateV4 = AppState;

/** The recording setup on this computer. */
export interface Studio {
  /** the audio system and device to record from ("ASIO", "Focusrite USB ASIO") */
  host?: string;
  device?: string;
  /** the interface's switches, as you have set them (no software can read them) */
  checks?: Partial<Record<"phantom" | "air" | "inst" | "direct", boolean>>;
  /** hear yourself through the interface (Direct Monitor), or through the app's effects */
  monitor?: "hardware" | "effects";
  /** bars of count-in before recording (0 = none) */
  countIn?: 0 | 1 | 2;
  /** a click while recording, not only in the count-in */
  clickOn?: boolean;
  /** how loud the song and the click are in the headphones while recording (0..1.5) */
  backing?: number;
  click?: number;
  /** extra milliseconds to move takes by (for converters the driver does not count) */
  nudge?: number;
  /** the buffer size to ask the interface's driver for (frames); not set = the driver's own setting */
  buffer?: number;
  /** the vocal track the Vocals page shows */
  vocal?: string;
  /** how many inputs the interface had when it was last open */
  inputs?: number;
}

export interface SheetState {
  ref: ChordRef;
  /** When set, the sheet picks a voicing for this progression slot */
  slotId?: string;
}

export const STORAGE_KEY = "m-theory-state-v1";

export const DEFAULT_STATE: AppState = {
  tab: "guitar",
  pane: "frame",
  key: { tonic: "B", scaleId: "ionian" },
  settings: { tuningId: "standard", capo: 0, leftHanded: false, labels: "fingers", theme: "auto", avoidBarre: true, v: 3 },
  progression: {
    chords: [],
    bpm: 84,
    pattern: "ring",
    loop: true,
    bars: DEFAULT_BARS,
    v: SOUND_V,
  },
  saved: [],
  shapes: {},
  myBeats: [],
  myKits: [],
  mySounds: [],
};

/** The idea on the page, loaded from storage and made whole (a song saved by an older version is moved over first). */
export function reviveProgression(raw0: Partial<Progression> | undefined): Progression {
  const raw = migrateSong(raw0);
  const melody = reviveMelody(raw?.melody);
  const tracks = reviveTracks(raw?.tracks);
  const layers = reviveLayers(raw?.layers, tracks);
  const p: Progression = {
    ...DEFAULT_STATE.progression, ...raw,
    pattern: hasStyle(raw?.pattern) ? raw.pattern : "ring",
    chords: (raw?.chords ?? []).map(reviveChord),
    beat: reviveBeat(raw?.beat), song: reviveSong(raw?.song, tracks),
    tracks, layers, focus: undefined, focusIn: undefined, firstHarmony: reviveFirstHarmony(raw?.firstHarmony, tracks),
    arrange: reviveArrange(raw?.arrange) ?? null,
    feel: raw?.feel ? reviveFeel(raw.feel) : undefined,
    melody,
    bars: fitBars(raw?.bars),
    sound: raw?.sound ? reviveSound(raw.sound) : undefined,
    tuneSound: raw?.tuneSound ? reviveSound(raw.tuneSound) : undefined,
    play: raw?.play === "song" ? "song" : "section",
    mix: reviveMix(raw?.mix),
    meter: reviveSig(raw?.meter),
    tones: reviveTones(raw?.tones, toneIdsIn(layers, tracks)),
    v: SOUND_V,
  };
  // what was on screen is the newest there is: it goes back into its section, never the other way round.
  // An added track that is in no section is not part of the song.
  // Songs from before sections had lengths get them here.
  // Songs from before the time signature could be chosen get the one their first section played in.
  return conform(settle(prune(commit(p))));
}

/** A stored text made whole, with no browser needed: nothing stored, or a text that cannot be read, gives the state a new app starts with. */
export function loadV4(raw: string | null): AppState {
  try {
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<AppState> & { progression?: { avoidBarre?: boolean } };
    const tab: Tab = (parsed.tab as string) === "piano" ? "piano" : "guitar";
    return {
      ...DEFAULT_STATE,
      ...parsed,
      tab,
      pane: PANES.some((x) => x.id === parsed.pane) ? parsed.pane : "rhythm",
      canvas: parsed.canvas && typeof parsed.canvas.palette === "string" ? { palette: parsed.canvas.palette, surface: isSurface(parsed.canvas.surface) ? parsed.canvas.surface : undefined, fade: parsed.canvas.fade === 0 || parsed.canvas.fade === 2 || parsed.canvas.fade === 3 ? parsed.canvas.fade : 1, guide: parsed.canvas.guide === false ? false : undefined, style: parsed.canvas.style === "wash" || parsed.canvas.style === "thick" ? parsed.canvas.style : undefined, drips: parsed.canvas.drips === true ? true : undefined, pass: parsed.canvas.pass === 0 || parsed.canvas.pass === 8 || parsed.canvas.pass === 30 ? parsed.canvas.pass : undefined, layout: isLayoutId(parsed.canvas.layout) ? parsed.canvas.layout : undefined, hide: Array.isArray(parsed.canvas.hide) && parsed.canvas.hide.some(isLayer) ? [...new Set(parsed.canvas.hide.filter(isLayer))] : undefined } : undefined,
      // v3 shows finger numbers on the dots by default
      settings: { ...DEFAULT_STATE.settings, avoidBarre: parsed.progression?.avoidBarre ?? true, ...parsed.settings, ...(parsed.settings?.v === 3 ? {} : { labels: "fingers" as const, v: 3 }) },
      shapes: parsed.shapes ?? {},
      myBeats: Array.isArray(parsed.myBeats) ? parsed.myBeats : [],
      myKits: reviveUserKits(parsed.myKits),
      mySounds: reviveUserSounds(parsed.mySounds),
      saved: (Array.isArray(parsed.saved) ? parsed.saved : []).map(reviveIdea).filter((i): i is SavedProgression => !!i),
      tombs: parsed.tombs ?? {},
      clip: reviveClips(parsed.clip),
      studio: parsed.studio && typeof parsed.studio === "object" ? { host: typeof parsed.studio.host === "string" ? parsed.studio.host : undefined, device: typeof parsed.studio.device === "string" ? parsed.studio.device : undefined, checks: parsed.studio.checks ?? {}, monitor: parsed.studio.monitor === "effects" ? "effects" : "hardware", countIn: parsed.studio.countIn === 0 || parsed.studio.countIn === 2 ? parsed.studio.countIn : 1, clickOn: !!parsed.studio.clickOn, backing: typeof parsed.studio.backing === "number" ? parsed.studio.backing : 1, click: typeof parsed.studio.click === "number" ? parsed.studio.click : 0.5, nudge: typeof parsed.studio.nudge === "number" ? parsed.studio.nudge : 0, buffer: typeof parsed.studio.buffer === "number" && parsed.studio.buffer >= 16 && parsed.studio.buffer <= 4096 ? parsed.studio.buffer : undefined } : undefined,
      view: reviveView(parsed.view),
      progression: reviveProgression(parsed.progression),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export interface Ctx {
  state: AppState;
  set: (fn: (s: AppState) => AppState) => void;
  tuning: Tuning;
  sheet: SheetState | null;
  openSheet: (s: SheetState | null) => void;
  /** A short message. With an action (an undo), it stays for a while, with a button that does it. */
  toast: (msg: string, action?: ToastAction) => void;
  /** Strum a chord the way you've chosen to play it */
  audition: (ref: ChordRef) => void;
  /** The shape used for a chord: a slot's own shape, else your chosen shape, else the easiest one */
  shapeOf: (ref: ChordRef, slotVoicingId?: string) => Voicing | undefined;
  /** Choose how a chord is played everywhere */
  setShape: (ref: ChordRef, voicingId: string) => void;
  /** Add a chord to the progression (optionally with a pinned voicing, after a slot) */
  addChord: (ref: ChordRef, opts?: { voicingId?: string; afterId?: string }) => void;
  /** The saved idea that is open, if any */
  idea: SavedProgression | null;
  /** There is something here that the library does not have yet */
  dirty: boolean;
  /** Save to the library: updates the open idea, or adds a new one. Returns "new" the first time. */
  saveIdea: (asNew?: boolean) => "new" | "updated" | "nothing";
  openIdea: (id: string) => void;
  /** Start a blank idea (keeps the key) */
  newIdea: () => void;
  /**
   * Goes up each time an idea is opened or a new one started: what belongs to the idea on screen (a
   * loop, an undo) is let go when it changes. (ideaId cannot tell: it stays null from one idea not yet
   * saved to a new one, and every idea without sections calls its one section "".)
   */
  opened: number;
  renameIdea: (id: string, name: string) => void;
  deleteIdea: (id: string) => void;
  /** Add ideas from a backup file; returns how many were new */
  importIdeas: (ideas: SavedProgression[]) => number;
  /** Where the library lives: this browser only, or synced to the Claude account */
  cloud: CloudStatus;
  /** Connect the library to the Claude account (asks once) */
  syncNow: () => void;
  /**
   * The vocal track a recording is going onto, from ● until its takes are on it (null: none). Until
   * then the idea cannot be left, nor that track removed: its takes would have nowhere to go.
   */
  recordingTo: string | null;
  setRecordingTo: (id: string | null) => void;
}

/** What a message's button does, and what it says ("↶"), for how long it is offered. */
export interface ToastAction {
  label: string;
  aria: string;
  run: () => void;
  /** milliseconds (20 seconds if not given) */
  ms?: number;
  /** offered only while this holds (an undo, while nothing else has changed); the message goes when it stops */
  when?: (s: AppState) => boolean;
}

export const AppCtx = createContext<Ctx | null>(null);

/** Beats in a bar: what the time signature of the section on screen says, on every page. */
export function barOf(p: Progression): number {
  return sigBeats(sectionSig(p));
}

/** How long a new chord lasts: one bar. */
export const chordBeats = (p: Progression): number => (Number.isInteger(barOf(p)) ? barOf(p) : 4);

/** The shortest and longest a chord can be, in beats, and the step between lengths. */
export const MIN_BEATS = 0.5;
export const MAX_BEATS = 16;
export const fitBeats = (n: number) => Math.min(MAX_BEATS, Math.max(MIN_BEATS, Math.round(n * 2) / 2));
const reviveChord = (c0: ProgChord): ProgChord => {
  const c = c0?.notes !== undefined ? (reviveNotes(c0.notes) ? { ...c0, notes: reviveNotes(c0.notes) } : withoutNotes(c0)) : c0;
  return Number.isFinite(c?.beats) && c.beats >= MIN_BEATS && c.beats <= MAX_BEATS ? c : { ...c, beats: 4 };
};

export const newId = () => Math.random().toString(36).slice(2, 10);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

export function shapeKey(ref: ChordRef, tuningId: string, capo: number): string {
  return `${tuningId}|${capo}|${pc(ref.root)}|${ref.typeId}|${ref.bass ? pc(ref.bass) : ""}`;
}
