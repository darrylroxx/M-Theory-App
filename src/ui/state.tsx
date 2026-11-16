import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PatternId } from "../audio/patterns";
import { strum } from "../audio/synth";
import { voicingsFor } from "../guitar/arrange";
import { getTuning, type Tuning } from "../guitar/tunings";
import type { Voicing } from "../guitar/voicings";
import type { ChordRef } from "../theory/chords";
import type { Key } from "../theory/keys";

export type Tab = "key" | "chords" | "compose" | "neck" | "learn";
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
  avoidBarre: boolean;
  preferOpen: boolean;
  allowInversions: boolean;
  zone: "any" | "low" | "mid" | "high";
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
}

export interface AppState {
  tab: Tab;
  key: Key;
  settings: Settings;
  progression: Progression;
  saved: SavedProgression[];
  /** Chord currently shown in the Chords tab */
  explore: ChordRef;
}

export interface SheetState {
  ref: ChordRef;
  /** When set, the sheet picks a voicing for this progression slot */
  slotId?: string;
}

const STORAGE_KEY = "m-theory-state-v1";

export const DEFAULT_STATE: AppState = {
  tab: "key",
  key: { tonic: "B", scaleId: "ionian" },
  settings: { tuningId: "standard", capo: 0, leftHanded: false, labels: "intervals", theme: "auto" },
  progression: {
    chords: [],
    bpm: 84,
    pattern: "ring",
    loop: true,
    avoidBarre: true,
    preferOpen: false,
    allowInversions: false,
    zone: "any",
  },
  saved: [],
  explore: { root: "B", typeId: "maj" },
};

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      settings: { ...DEFAULT_STATE.settings, ...parsed.settings },
      progression: { ...DEFAULT_STATE.progression, ...parsed.progression },
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
  /** Strum the friendliest voicing of a chord */
  audition: (ref: ChordRef) => void;
  /** Add a chord to the progression (optionally with a pinned voicing, after a slot) */
  addChord: (ref: ChordRef, opts?: { voicingId?: string; afterId?: string }) => void;
}

const AppCtx = createContext<Ctx | null>(null);

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
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  }, [state.settings.theme]);

  const set = useCallback((fn: (s: AppState) => AppState) => setState(fn), []);
  const tuning = useMemo(() => getTuning(state.settings.tuningId), [state.settings.tuningId]);

  const toast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);

  const audition = useCallback(
    (ref: ChordRef) => {
      const v = bestVoicing(ref, tuning, state.settings.capo);
      if (v) strum(v.midi);
    },
    [tuning, state.settings.capo],
  );

  const addChord = useCallback(
    (ref: ChordRef, opts: { voicingId?: string; afterId?: string } = {}) => {
      setState((s) => {
        const item: ProgChord = { id: newId(), ref, beats: 4, voicingId: opts.voicingId };
        const chords = [...s.progression.chords];
        const at = opts.afterId ? chords.findIndex((c) => c.id === opts.afterId) : -1;
        if (at >= 0) chords.splice(at + 1, 0, item);
        else chords.push(item);
        return { ...s, progression: { ...s.progression, chords } };
      });
      toast("Added to progression");
    },
    [toast],
  );

  const value: Ctx = { state, set, tuning, sheet, openSheet, toast, audition, addChord };
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

/** The most useful single voicing for quick auditioning. */
export function bestVoicing(ref: ChordRef, tuning: Tuning, capo: number): Voicing | undefined {
  const all = voicingsFor(ref, tuning, capo);
  return all.find((v) => v.frets.filter((f) => f !== null).length >= 4) ?? all[0];
}
