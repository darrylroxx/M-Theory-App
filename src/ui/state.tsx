import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { reviveBeat, reviveUserKits, type Beat, type BeatPattern, type UserKit } from "../audio/beats";
import { barBeats } from "../audio/beats";
import { hasStyle, reviveFeel, styleBar, type Feel, type PatternId } from "../audio/patterns";
import { reviveMelody, type Melody } from "../song/melody";
import type { HarpSound } from "../audio/rack";
import { reviveUserSounds, type UserSound } from "../audio/sounds";
import { strum } from "../audio/synth";
import { easyVoicing, voicingsFor } from "../guitar/arrange";
import { getTuning, type Tuning } from "../guitar/tunings";
import { fretsFromId, voicingFromFrets, type Voicing } from "../guitar/voicings";
import { getChordType } from "../theory/chords";
import { pc } from "../theory/notes";
import type { ChordRef } from "../theory/chords";
import { autoName, fingerprint, isBlank, mergeIdeas, reviveIdea, snapshot, toPush } from "../song/library";
import { reviveSong, type Song } from "../song/structure";
import { cloudReady, connectCloud, type Cloud, type CloudStatus } from "./cloud";
import type { Key } from "../theory/keys";

export type Tab = "guitar" | "piano";
export type LabelMode = "intervals" | "notes" | "fingers";

export interface ProgChord {
  id: string;
  ref: ChordRef;
  /** how long it lasts, in beats (half beats allowed) */
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
  /** How the style is played in the section on screen: speed, swing, touch … */
  feel?: Partial<Feel>;
  /** The melody of the section on screen. */
  melody?: Melody;
  /** The harp's sound and effects (missing knobs are at their defaults). */
  sound?: Partial<HarpSound>;
  /** Song structure: sections in order. `chords` above are then the selected section's chords. */
  song?: Song | null;
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
  /** The saved idea that is open (null = not saved yet) */
  ideaId?: string | null;
  /** Ideas that were deleted, and when, so other devices delete them too */
  tombs?: Record<string, number>;
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
  myKits: [],
  mySounds: [],
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
      myKits: reviveUserKits(parsed.myKits),
      mySounds: reviveUserSounds(parsed.mySounds),
      saved: (Array.isArray(parsed.saved) ? parsed.saved : []).map(reviveIdea).filter((i): i is SavedProgression => !!i),
      tombs: parsed.tombs ?? {},
      progression: {
        ...DEFAULT_STATE.progression, ...parsed.progression,
        pattern: hasStyle(parsed.progression?.pattern) ? parsed.progression.pattern : "ring",
        chords: (parsed.progression?.chords ?? []).map(reviveChord),
        beat: reviveBeat(parsed.progression?.beat), song: reviveSong(parsed.progression?.song),
        ...(parsed.progression?.feel ? { feel: reviveFeel(parsed.progression.feel) } : {}),
        melody: reviveMelody(parsed.progression?.melody),
      },
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
  /** The saved idea that is open, if any */
  idea: SavedProgression | null;
  /** There is something here that the library does not have yet */
  dirty: boolean;
  /** Save to the library: updates the open idea, or adds a new one. Returns "new" the first time. */
  saveIdea: (asNew?: boolean) => "new" | "updated" | "nothing";
  openIdea: (id: string) => void;
  /** Start a blank idea (keeps the key) */
  newIdea: () => void;
  renameIdea: (id: string, name: string) => void;
  deleteIdea: (id: string) => void;
  /** Add ideas from a backup file; returns how many were new */
  importIdeas: (ideas: SavedProgression[]) => number;
  /** Where the library lives: this browser only, or synced to the Claude account */
  cloud: CloudStatus;
  /** Connect the library to the Claude account (asks once) */
  syncNow: () => void;
}

const AppCtx = createContext<Ctx | null>(null);

/** Beats in a bar: the drums' when they are on, otherwise the playing style's (3 for a waltz, else 4). */
export function barOf(p: Progression): number {
  const n = p.beat?.on ? barBeats(p.beat) : styleBar(p.pattern);
  return n >= 1 && n <= 16 ? n : 4;
}

/** How long a new chord lasts: one bar. */
export const chordBeats = (p: Progression): number => (Number.isInteger(barOf(p)) ? barOf(p) : 4);

/** The shortest and longest a chord can be, in beats, and the step between lengths. */
export const MIN_BEATS = 0.5;
export const MAX_BEATS = 16;
export const fitBeats = (n: number) => Math.min(MAX_BEATS, Math.max(MIN_BEATS, Math.round(n * 2) / 2));
const reviveChord = (c: ProgChord): ProgChord => (Number.isFinite(c?.beats) && c.beats >= MIN_BEATS && c.beats <= MAX_BEATS ? c : { ...c, beats: 4 });

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

  // ── Idea library ──
  const idea = useMemo(() => state.saved.find((i) => i.id === state.ideaId) ?? null, [state.saved, state.ideaId]);
  const dirty = useMemo(() => {
    const now = fingerprint(snapshot(state.key, state.progression, capo, tuningId));
    if (!idea) return !isBlank(state.progression);
    return now !== fingerprint(snapshot(idea.key, idea.progression, idea.capo ?? capo, idea.tuningId ?? tuningId));
  }, [idea, state.key, state.progression, capo, tuningId]);

  const saveIdea = useCallback(
    (asNew = false): "new" | "updated" | "nothing" => {
      const update = !asNew && state.saved.some((i) => i.id === state.ideaId);
      if (!update && isBlank(state.progression)) return "nothing";
      setState((s) => {
        const snap = snapshot(s.key, s.progression, s.settings.capo, s.settings.tuningId);
        const at = Date.now();
        const open = s.saved.find((i) => i.id === s.ideaId);
        if (open && !asNew) return { ...s, saved: s.saved.map((i) => (i.id === open.id ? { ...i, ...snap, updatedAt: at } : i)) };
        const id = newId();
        const name = asNew && open ? `${open.name} copy` : autoName(s.key, s.saved);
        return { ...s, ideaId: id, saved: [{ id, name, ...snap, savedAt: at, updatedAt: at }, ...s.saved] };
      });
      return update ? "updated" : "new";
    },
    [state.saved, state.ideaId, state.progression],
  );
  const openIdea = useCallback((id: string) => {
    setState((s) => {
      const it = reviveIdea(s.saved.find((i) => i.id === id));
      if (!it) return s;
      return { ...s, ideaId: id, key: it.key, progression: { ...DEFAULT_STATE.progression, ...it.progression }, settings: { ...s.settings, capo: it.capo ?? s.settings.capo, tuningId: it.tuningId ?? s.settings.tuningId } };
    });
    openSheet(null);
  }, []);
  const newIdea = useCallback(() => {
    setState((s) => ({ ...s, ideaId: null, progression: { ...DEFAULT_STATE.progression, bpm: s.progression.bpm, beat: s.progression.beat ? { ...s.progression.beat, on: false } : undefined } }));
    openSheet(null);
  }, []);
  const renameIdea = useCallback((id: string, name: string) => setState((s) => ({ ...s, saved: s.saved.map((i) => (i.id === id ? { ...i, name, updatedAt: Date.now() } : i)) })), []);
  const deleteIdea = useCallback(
    (id: string) => setState((s) => ({ ...s, ideaId: s.ideaId === id ? null : s.ideaId, saved: s.saved.filter((i) => i.id !== id), tombs: { ...s.tombs, [id]: Date.now() } })),
    [],
  );
  const importIdeas = useCallback(
    (incoming: SavedProgression[]) => {
      const have = new Set(state.saved.map((i) => i.id));
      const fresh = incoming.filter((i) => !have.has(i.id));
      if (fresh.length)
        setState((s) => {
          const tombs = { ...s.tombs };
          fresh.forEach((i) => delete tombs[i.id]);
          return { ...s, saved: [...fresh.filter((i) => !s.saved.some((x) => x.id === i.id)).map((i) => ({ ...i, updatedAt: Date.now() })), ...s.saved], tombs };
        });
      return fresh.length;
    },
    [state.saved],
  );

  // ── Sync with the Claude account (only when the app runs as a claude.ai artifact) ──
  const [cloud, setCloud] = useState<CloudStatus>("local");
  const cloudRef = useRef<Cloud | null>(null);
  const known = useRef(new Map<string, number>()); // what the cloud holds: id → time (negative = deleted)
  const busy = useRef(false);
  const syncNow = useCallback(() => {
    if (cloudRef.current || busy.current) return;
    busy.current = true;
    setCloud("connecting");
    (async () => {
      try {
        const c = await connectCloud();
        if (!c) return setCloud("local");
        const remote = await c.list();
        remote.forEach((r) => known.current.set(r.id, r.deleted ? -r.updatedAt : r.updatedAt));
        setState((s) => {
          const m = mergeIdeas(s.saved, s.tombs ?? {}, remote);
          return { ...s, saved: m.ideas, tombs: m.tombs, ideaId: m.ideas.some((i) => i.id === s.ideaId) ? s.ideaId : null };
        });
        cloudRef.current = c;
        setCloud("synced");
      } catch {
        setCloud("error");
      } finally {
        busy.current = false;
      }
    })();
  }, []);
  // connect quietly on load when the viewer has already allowed it
  useEffect(() => {
    void cloudReady().then((r) => r === "granted" && syncNow());
  }, [syncNow]);
  // send changes, one document at a time
  useEffect(() => {
    const c = cloudRef.current;
    if (!c || cloud !== "synced") return;
    const t = window.setTimeout(async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        for (const r of toPush(state.saved, state.tombs ?? {}, known.current)) {
          await c.put(r);
          known.current.set(r.id, r.deleted ? -r.updatedAt : r.updatedAt);
        }
      } catch {
        setCloud("error");
        cloudRef.current = null; // "Sync" in the library tries again
      } finally {
        busy.current = false;
      }
    }, 700);
    return () => window.clearTimeout(t);
  }, [state.saved, state.tombs, cloud]);

  const value: Ctx = { state, set, tuning, sheet, openSheet, toast, audition, shapeOf, setShape, addChord, idea, dirty, saveIdea, openIdea, newIdea, renameIdea, deleteIdea, importIdeas, cloud, syncNow };
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
