import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { reviveBeat, type Beat, type BeatPattern } from "../audio/beats";
import type { PatternId } from "../audio/patterns";
import { strum } from "../audio/synth";
import { easyVoicing, voicingsFor } from "../guitar/arrange";
import { getTuning, type Tuning } from "../guitar/tunings";
import { fretsFromId, voicingFromFrets, type Voicing } from "../guitar/voicings";
import { getChordType } from "../theory/chords";
import { pc } from "../theory/notes";
import type { ChordRef } from "../theory/chords";
import type { Key } from "../theory/keys";

export type Tab = "guitar" | "piano";
export type LabelMode = "intervals" | "notes" | "fingers";

export interface ProgChord {
  id: string;
  ref: ChordRef;
  beats: number;
  /** Pinned voicing id (frets string). Undefined = auto-arranged. */
  voicingId?: string;
}

export interface Progression {
  chords: ProgChord[];
  bpm: number;
  pattern: PatternId;
  loop: boolean;
  /** When set, shapes are arranged together in one area of the neck. null = each chord uses your own shape. */
  arrange?: ArrangeSettings | null;
  /** The drum beat under the chords (undefined = never touched). */
  beat?: Beat;
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
}

export interface SheetState {
  ref: ChordRef;
  /** When set, the sheet picks a voicing for this progression slot */
  slotId?: string;
}

const STORAGE_KEY = "m-theory-state-v1";

/** Theme attribute set by an embedding host (e.g. the claude.ai artifact viewer), captured before we touch it. */
const HOST_THEME = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : null;

export const DEFAULT_STATE: AppState = {
  tab: "guitar",
  key: { tonic: "B", scaleId: "ionian" },
  settings: { tuningId: "standard", capo: 0, leftHanded: false, labels: "fingers", theme: "auto", avoidBarre: true, v: 3 },
  progression: {
    chords: [],
    bpm: 84,
    pattern: "ring",
    loop: true,
  },
  saved: [],
  shapes: {},
  myBeats: [],
};

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<AppState> & { progression?: { avoidBarre?: boolean } };
    const tab: Tab = (parsed.tab as string) === "piano" ? "piano" : "guitar";
    return {
      ...DEFAULT_STATE,
      ...parsed,
      tab,
      // v3 shows finger numbers on the dots by default
      settings: { ...DEFAULT_STATE.settings, avoidBarre: parsed.progression?.avoidBarre ?? true, ...parsed.settings, ...(parsed.settings?.v === 3 ? {} : { labels: "fingers" as const, v: 3 }) },
      shapes: parsed.shapes ?? {},
      myBeats: Array.isArray(parsed.myBeats) ? parsed.myBeats : [],
      progression: { ...DEFAULT_STATE.progression, ...parsed.progression, beat: reviveBeat(parsed.progression?.beat) },
    };
  } catch {
    return DEFAULT_STATE;
  }
}

interface Ctx {
  state: AppState;
  set: (fn: (s: AppState) => AppState) => void;
  tuning: Tuning;
  sheet: SheetState | null;
  openSheet: (s: SheetState | null) => void;
  toast: (msg: string) => void;
  /** Strum a chord the way you've chosen to play it */
  audition: (ref: ChordRef) => void;
  /** The shape used for a chord: a slot's own shape, else your chosen shape, else the easiest one */
  shapeOf: (ref: ChordRef, slotVoicingId?: string) => Voicing | undefined;
  /** Choose how a chord is played everywhere */
  setShape: (ref: ChordRef, voicingId: string) => void;
  /** Add a chord to the progression (optionally with a pinned voicing, after a slot) */
  addChord: (ref: ChordRef, opts?: { voicingId?: string; afterId?: string }) => void;
}

const AppCtx = createContext<Ctx | null>(null);

/** How long a new chord lasts: one bar of the current beat (3 in a waltz), otherwise 4 beats. */
export function chordBeats(p: Progression): number {
  const n = p.beat?.on ? p.beat.steps / p.beat.div : 4;
  return Number.isInteger(n) && n >= 1 ? n : 4;
}

export const newId = () => Math.random().toString(36).slice(2, 10);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(load);
  const [sheet, openSheet] = useState<SheetState | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable (private mode) — app still works */
    }
  }, [state]);

  useEffect(() => {
    const t = state.settings.theme;
    // "auto" hands control back to whatever the host page set (or the OS setting)
    if (t === "auto") {
      if (HOST_THEME) document.documentElement.setAttribute("data-theme", HOST_THEME);
      else document.documentElement.removeAttribute("data-theme");
    } else document.documentElement.setAttribute("data-theme", t);
  }, [state.settings.theme]);

  const set = useCallback((fn: (s: AppState) => AppState) => setState(fn), []);
  const tuning = useMemo(() => getTuning(state.settings.tuningId), [state.settings.tuningId]);

  const toast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);

  const { capo, avoidBarre, tuningId } = state.settings;
  const shapes = state.shapes;
  const shapeOf = useCallback(
    (ref: ChordRef, slotVoicingId?: string) => {
      const id = slotVoicingId ?? shapes[shapeKey(ref, tuningId, capo)];
      if (id) {
        const found = voicingsFor(ref, tuning, capo).find((v) => v.id === id);
        if (found) return found;
        const frets = fretsFromId(id);
        if (slotVoicingId && frets.length === tuning.notes.length) return voicingFromFrets(frets, pc(ref.root), getChordType(ref.typeId), tuning, capo);
      }
      return easyVoicing(ref, tuning, capo, avoidBarre);
    },
    [shapes, tuning, tuningId, capo, avoidBarre],
  );
  const setShape = useCallback(
    (ref: ChordRef, voicingId: string) => setState((s) => ({ ...s, shapes: { ...s.shapes, [shapeKey(ref, s.settings.tuningId, s.settings.capo)]: voicingId } })),
    [],
  );
  const audition = useCallback(
    (ref: ChordRef) => {
      const v = shapeOf(ref);
      if (v) strum(v.midi);
    },
    [shapeOf],
  );

  const addChord = useCallback(
    (ref: ChordRef, opts: { voicingId?: string; afterId?: string } = {}) => {
      setState((s) => {
        const item: ProgChord = { id: newId(), ref, beats: chordBeats(s.progression), voicingId: opts.voicingId };
        const chords = [...s.progression.chords];
        const at = opts.afterId ? chords.findIndex((c) => c.id === opts.afterId) : -1;
        if (at >= 0) chords.splice(at + 1, 0, item);
        else chords.push(item);
        return { ...s, progression: { ...s.progression, chords } };
      });
    },
    [],
  );

  const value: Ctx = { state, set, tuning, sheet, openSheet, toast, audition, shapeOf, setShape, addChord };
  return (
    <AppCtx.Provider value={value}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

export function shapeKey(ref: ChordRef, tuningId: string, capo: number): string {
  return `${tuningId}|${capo}|${pc(ref.root)}|${ref.typeId}|${ref.bass ? pc(ref.bass) : ""}`;
}
