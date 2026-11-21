// The app's state once a song is tracks and clips, what the screens are handed to read and change it, and the
// provider that holds it: loading and the one-time move from the old storage, writing (a moment after each change),
// other tabs, the cloud, undo for the whole idea, and the ideas list.
//
// The state is kept in one place the provider can read at any moment (not only when the screen is drawn), so two
// changes made one straight after the other each see what the one before did, and a change is made exactly once.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BeatPattern, UserKit } from "../audio/beats";
import type { UserSound } from "../audio/sounds";
import { stopAlone } from "../audio/takeplay";
import { getTuning, type Tuning } from "../guitar/tunings";
import { autoName } from "../song/library";
import type { ViewPrefs } from "../song/window";
import type { Key } from "../theory/keys";
import { arrive, backupId, backupSource, besideId, convertIdea, keepOriginal, newSession, setStores, stemOf } from "../timeline/convert";
import { renudge5 } from "../timeline/audioclips";
import { keepTakes, makeHistory, type History } from "../timeline/history";
import { fingerprint5, importIdeas5, isBlank5, mergeIdeas5, reviveIdea5, toPush5, type SavedIdea } from "../timeline/library5";
import { unplacedTakes } from "../timeline/migrate5";
import type { Clipboard5, Session, TimelineSong } from "../timeline/model";
import { KEY_V1, KEY_V2, freshState, hashText, load5, recover5, save5, settleConversion, takeLate, type KV, type Loaded } from "../timeline/store5";
import { cloudReady, connectCloud, type Cloud, type CloudStatus } from "./cloud";
import { openBlobs } from "./idb";
import { reidea5 } from "./openidea5";
import { joinOtherTab5 } from "./othertab5";
import { DEFAULT_STATE, loadV4, newId, type CanvasPrefs, type SavedProgression, type Settings, type Studio } from "./state";

export interface App5State {
  key: Key; settings: Settings;
  song: TimelineSong; saved: SavedIdea[]; session: Session;
  shapes: Record<string, string>; myBeats: BeatPattern[]; myKits: UserKit[]; mySounds: UserSound[];
  canvas?: CanvasPrefs; ideaId?: string | null; draft?: string; tombs?: Record<string, number>;
  clip?: Clipboard5; studio?: Studio; view?: ViewPrefs;
  /** what was converted from version 4, and from what */
  converted?: { at: number; blob?: { len: number; hash: string; where: "idb" | "local" }; ideas: Record<string, number>; /** how long the new state's text was when it was first written */ size?: number };
  /** the last write to storage failed; never stored */
  unsaved?: true;
}

/** What a message's button does ("↶"), and for how long it is offered. */
export interface Toast5 { label: string; aria: string; run(): void; ms?: number; when?(s: App5State): boolean }

/** What the screens get: the state, and every way to change it. */
export interface Ctx5 {
  state: App5State;
  /** the state as it is this very moment (also between two draws of the screen) */
  peek(): App5State;
  /** a change that is not an undo step: settings, the libraries, studio, view, the clipboard */
  set(fn: (s: App5State) => App5State): void;
  /** a change of the song: one undo step. `control` folds quick changes from one control into one step */
  edit(label: string, fn: (s: TimelineSong) => TimelineSong, control?: string): void;
  /** a change of the song and the key together ("Move song"): one undo step */
  editKeyed(label: string, fn: (song: TimelineSong, key: Key) => { song: TimelineSong; key: Key }): void;
  setSession(fn: (s: Session) => Session): void;
  undo(): void; redo(): void; canUndo: boolean; canRedo: boolean;
  tuning: Tuning;
  toast(msg: string, action?: Toast5): void;
  idea: SavedIdea | null; dirty: boolean; opened: number;
  saveIdea(asNew?: boolean): "new" | "updated" | "nothing";
  openIdea(id: string): void; newIdea(): void; renameIdea(id: string, name: string): void; deleteIdea(id: string): void;
  /** a backup file's text, version 1 or 2; returns how many ideas were new */
  importIdeas(text: string): number;
  cloud: CloudStatus; syncNow(): void;
  recordingTo: string | null; setRecordingTo(id: string | null): void;
}

// ── the plain rules (no screen needed) ──────────────────────

/**
 * Every song that comes back (an undo, a redo, an idea opened) passes through here before it is shown: its takes are
 * moved to the timing nudge in use (`nudge`, in milliseconds). The nudge is a setting, outside undo, and each take
 * remembers the one it was cut with; so a song from before the nudge was changed still plays in time. The same song
 * back when nothing moves.
 */
export const afterRestore = (song: TimelineSong, nudge: number | undefined): TimelineSong => renudge5(song, nudge ?? 0);

/** What an idea's session is when it opens: nothing selected or looped, no track armed, no window open, the whole song across the lanes. */
export const openSession = (): Session => ({ ...newSession(), pxPerBeat: 0 });

/** A change of the song: the state after it, with the song as it was noted as one undo step. The same state back when nothing changed. */
export function editIn(s: App5State, h: History, label: string, fn: (song: TimelineSong) => TimelineSong, control?: string): App5State {
  const song = fn(s.song);
  if (song === s.song) return s;
  h.push({ song: s.song, key: s.key, label }, control);
  return { ...s, song };
}
/** A change of the song and the key together, as one undo step. */
export function editKeyedIn(s: App5State, h: History, label: string, fn: (song: TimelineSong, key: Key) => { song: TimelineSong; key: Key }): App5State {
  const next = fn(s.song, s.key);
  if (next.song === s.song && next.key === s.key) return s;
  h.push({ song: s.song, key: s.key, label });
  return { ...s, song: next.song, key: next.key };
}
/** One step back (or forward again): the song and the key together, with every recording the song had still in it. Nothing while a recording runs (`locked`). */
export function stepIn(s: App5State, h: History, back: boolean, locked: boolean): App5State {
  if (locked) return s;
  const now = { song: s.song, key: s.key, label: "" };
  const to = back ? h.undo(now) : h.redo(now);
  if (!to) return s;
  return { ...s, song: afterRestore(keepTakes(to.song, s.song), s.studio?.nudge), key: to.key };
}
/** Another idea opened: its song, key, capo and tuning; no undo steps, a new session, nothing armed. The same state back when there is no such idea (or it is a backup entry). */
export function openIn(s: App5State, h: History, id: string): App5State {
  const found = s.saved.find((i) => i.id === id);
  const it = found && !found.backup ? reviveIdea5(found) : null;
  if (!it) return s;
  h.clear();
  return { ...s, ideaId: id, key: it.key, song: afterRestore(it.song, s.studio?.nudge), session: openSession(), settings: { ...s.settings, capo: it.capo ?? s.settings.capo, tuningId: it.tuningId ?? s.settings.tuningId } };
}
/** A blank idea started (the key and the tempo stay): the three tracks every idea starts with, and nothing on them. */
export function newIn(s: App5State, h: History, draft: string): App5State {
  h.clear();
  return { ...s, ideaId: null, draft, song: { ...freshState().song, bpm: s.song.bpm }, session: openSession() };
}
/** Is there something on screen the library does not have? (What is open, selected or looped is not part of an idea.) */
export function dirtyOf(s: Pick<App5State, "key" | "song" | "saved" | "ideaId" | "settings"> & Partial<App5State>, savedPrint?: string): boolean {
  const idea = s.saved.find((i) => i.id === s.ideaId && !i.backup);
  if (!idea) return !isBlank5(s.song);
  const { capo, tuningId } = s.settings;
  return fingerprint5({ key: s.key, song: s.song, capo, tuningId }) !== (savedPrint ?? fingerprint5({ key: idea.key, song: idea.song, capo: idea.capo ?? capo, tuningId: idea.tuningId ?? tuningId }));
}
/** Save to the library: the open idea is updated, or a new one is added (`asNew`: a copy under another name). */
export function saveIn(s: App5State, asNew: boolean, id: string, now: number): { state: App5State; result: "new" | "updated" | "nothing" } {
  const open = s.saved.find((i) => i.id === s.ideaId && !i.backup);
  const update = !asNew && !!open;
  if (!update && isBlank5(s.song)) return { state: s, result: "nothing" };
  const snap = { key: s.key, song: s.song, capo: s.settings.capo, tuningId: s.settings.tuningId };
  if (open && update) return { state: { ...s, saved: s.saved.map((i) => (i.id === open.id ? { ...i, ...snap, updatedAt: now } : i)) }, result: "updated" };
  const name = asNew && open ? `${open.name} copy` : autoName(s.key, s.saved as unknown as SavedProgression[]);
  // (saved for the first time, it is the same idea: a copy is another one)
  const next = asNew && open ? { ...s, ideaId: id } : reidea5(s, id);
  return { state: { ...next, saved: [{ id, name, ...snap, savedAt: now, updatedAt: now }, ...s.saved] }, result: "new" };
}
/** An idea deleted (a backup entry too): it leaves the list and its deletion is noted, so it stays deleted in other tabs and on other devices. The idea open stays on screen, not saved. */
export function deleteIn(s: App5State, id: string, draft: string, now: number): App5State {
  return { ...(s.ideaId === id ? reidea5(s, null, draft) : s), saved: s.saved.filter((i) => i.id !== id), tombs: { ...s.tombs, [id]: now } };
}
/** A backup entry opened: a fresh conversion of its original as a new idea, "<name> (restored)", on screen. The entry stays. */
export function restoreIn(s: App5State, h: History, original: SavedProgression, id: string, now: number): App5State {
  const { idea } = convertIdea({ ...original, id, name: `${original.name.replace(/ \(unsaved\)$/, "")} (restored)`, savedAt: now, updatedAt: now });
  const { from: _from, ...mine } = idea;
  return openIn({ ...s, saved: [mine, ...s.saved] }, h, id);
}
/**
 * A backup file read into the library. A version 2 file's ideas that are not here yet are added (its backup entries
 * too; `originals` are what those stand for, to be kept by the caller). A version 1 file holds old ideas: each is
 * taken in as an old copy that turned up; those already here in a copy that may be newer are handed back (`later`),
 * for the caller to take in once it has read what they were converted from.
 */
export function importIn(s: App5State, text: string): { state: App5State; added: number; originals: Record<string, SavedProgression>; later: SavedProgression[] } {
  const file = importIdeas5(text);
  if (file.version === 2) {
    const have = new Set(s.saved.map((i) => i.id));
    const fresh = file.ideas.filter((i) => !have.has(i.id));
    if (!fresh.length) return { state: s, added: 0, originals: file.originals, later: [] };
    const tombs = { ...s.tombs };
    for (const i of fresh) delete tombs[i.id];
    const mine = fresh.filter((i) => !i.backup);
    return { state: { ...s, saved: [...mine, ...s.saved, ...fresh.filter((i) => i.backup)], tombs }, added: mine.length, originals: file.originals, later: [] };
  }
  let out = s;
  let added = 0;
  const later: SavedProgression[] = [];
  for (const old of file.old) {
    if (out.saved.some((i) => i.id === old.id && !i.backup)) {
      later.push(old);
      continue;
    }
    // (asked for by hand: an idea deleted here before comes back)
    const tombs = { ...out.tombs };
    delete tombs[old.id];
    delete tombs[backupId(old.id)];
    const r = arrive({ ...out, tombs }, old, () => null);
    if (r.added) {
      out = r.state;
      added++;
    }
  }
  return { state: out, added, originals: {}, later };
}
/**
 * Old-format copies of ideas that turned up (the cloud, an old tab, a backup file), each taken in by the one rule
 * (`arrive`). `original` reads what an idea here was converted from. Returns the state, the old ideas to keep on
 * their own from now on (by the stem their backup entry reads them under), and how many were added beside an idea.
 */
export function arriveAll(s: App5State, olds: SavedProgression[], original: (id: string) => SavedProgression | null): { state: App5State; keep: { stem: string; idea: SavedProgression }[]; beside: number; refreshed: string[] } {
  let out = s;
  const keep: { stem: string; idea: SavedProgression }[] = [];
  const refreshed: string[] = [];
  let beside = 0;
  for (const old of olds) {
    const r = arrive(out, old, original);
    out = r.state;
    if (r.added === "refreshed") {
      keep.push({ stem: old.id, idea: old });
      refreshed.push(old.id);
    } else if (r.added === "beside") {
      keep.push({ stem: besideId(old.id), idea: { ...old, id: besideId(old.id), name: `${old.name} (edited in the old version)` } });
      beside++;
    }
  }
  return { state: out, keep, beside, refreshed };
}
/** Could an old copy change anything here? (The cheap part of the rule: read before the copy is loaded in full.) */
export function mayArrive(s: App5State, id: string, t: number): boolean {
  if ((s.tombs?.[id] ?? 0) >= t) return false;
  const mine = s.saved.find((i) => i.id === id && !i.backup);
  return !mine || !mine.from || t > mine.from.at;
}

// ── the provider ────────────────────────────────────────────

/** Theme attribute set by an embedding host, captured before we touch it. */
const HOST_THEME = typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : null;

/** The browser's local storage, as the storage code wants it. */
const localKV = (): KV => ({
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
  remove: (k) => localStorage.removeItem(k),
});

/** What is said while changes cannot be saved, by why. */
const WARN = {
  full: "This device's storage is full, so changes are not being saved. They are safe while the app stays open. Ideas → Backup saves them to a file.",
  stuck: "The ideas stored on this device could not be read. They have been left exactly as they are, and nothing is being saved over them. What you do now is kept only while the app stays open: Ideas → Backup saves it to a file.",
  storage: "This browser is not letting the app store anything, so changes are not being saved. They are safe while the app stays open. Ideas → Backup saves them to a file.",
};

export const App5Ctx = createContext<Ctx5 | null>(null);

/** How long after a change the state is written (a knob being turned writes once, not at every step). */
const WRITE_MS = 400;

export function App5Provider({ children }: { children: ReactNode }) {
  const [boot] = useState<Loaded>(() => {
    try {
      return load5(localKV(), newId());
    } catch {
      return { state: freshState(newId()), stuck: "storage" };
    }
  });
  const now = useRef<App5State>(boot.state);
  const [state, setState] = useState<App5State>(boot.state);
  const [failed, setFailed] = useState(false);
  const history = useMemo(() => makeHistory(), []);
  const kv = useMemo(localKV, []);
  const blobs = useMemo(openBlobs, []);
  /** may the new key be written? Not until the move from the old storage is settled; never when what is stored could not be read */
  const mayWrite = useRef(!boot.v1 && !boot.stuck && !boot.fresh);
  /** what was last written to the new key, or read from it (by this tab, or by another and taken in) */
  const seen = useRef<string | null>(null);
  const written = useRef<App5State | null>(boot.v1 || boot.fresh ? null : boot.state);
  const takenIn = useRef<App5State | null>(null);
  const timer = useRef(0);

  const commit = useCallback((next: App5State) => {
    if (next === now.current) return;
    now.current = next;
    setState(next);
  }, []);
  const peek = useCallback(() => now.current, []);
  const set = useCallback((fn: (s: App5State) => App5State) => commit(fn(now.current)), [commit]);

  // ── messages ──
  const [toastMsg, setToast] = useState<{ msg: string; action?: Toast5 } | null>(null);
  const toastTimer = useRef(0);
  const toast = useCallback((msg: string, action?: Toast5) => {
    setToast({ msg, action });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), action ? action.ms ?? 20000 : msg.length > 60 ? 9000 : 1800);
  }, []);

  // ── writing ──
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    if (!mayWrite.current) return;
    let s = now.current;
    if (s === written.current || s === takenIn.current) return;
    try {
      // another tab wrote since, and this one has not taken it in yet: its library is kept, with this tab's
      const there = kv.get(KEY_V2);
      if (there !== null && seen.current !== null && there !== seen.current) {
        const joined = joinOtherTab5(s, JSON.parse(there), "both", newId);
        if (joined !== s) {
          s = joined;
          commit(s);
        }
      }
    } catch {
      /* what is there cannot be read: this tab's state is written all the same */
    }
    const ok = save5(kv, s);
    if (ok) {
      written.current = s;
      try {
        seen.current = kv.get(KEY_V2);
      } catch {
        /* read again at the next write */
      }
    }
    setFailed(!ok);
  }, [kv, commit]);
  useEffect(() => {
    if (!mayWrite.current || state === written.current || state === takenIn.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, WRITE_MS);
  }, [state, flush]);
  // nothing waits to be written when the page goes away
  useEffect(() => {
    const leave = () => flush();
    const hide = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [flush]);

  // ── old copies of ideas that turn up later ──
  /** the old cloud's copies, by id, as last listed (an idea's original is read from here when nothing nearer has it) */
  const oldCloud = useRef(new Map<string, SavedProgression>());
  useEffect(() => setStores({ kv, blobs, cloud: (id) => oldCloud.current.get(id) ?? null }), [kv, blobs]);
  const takeOld = useCallback(async (olds: SavedProgression[]) => {
    const worth = olds.filter((o) => mayArrive(now.current, o.id, o.updatedAt ?? o.savedAt));
    if (!worth.length) return;
    // what the ideas here were converted from is read first (it is kept apart from the state)
    const originals = new Map<string, SavedProgression | null>();
    for (const o of worth)
      if (now.current.saved.some((i) => i.id === o.id && !i.backup))
        for (const id of [o.id, besideId(o.id)]) originals.set(id, await backupSource(backupId(id)).catch(() => null));
    const before = now.current;
    const wasDirty = dirtyOf(before);
    const r = arriveAll(before, worth, (id) => originals.get(id) ?? null);
    if (r.state === before) return;
    // the idea on screen was replaced by a newer copy and had no changes of its own: the newer one is shown
    const open = before.ideaId;
    const next = open && r.refreshed.includes(open) && !wasDirty ? openIn(r.state, history, open) : r.state;
    commit(next);
    for (const k of r.keep) await keepOriginal(k.stem, k.idea);
    if (r.beside) toast("An idea changed in the old version was added beside yours.");
  }, [commit, history, toast]);
  /** the old key holds a text again (an old tab wrote it): its ideas are taken in, and it is put away */
  const lateBusy = useRef(false);
  const late = useCallback(async () => {
    if (lateBusy.current || !mayWrite.current) return;
    lateBusy.current = true;
    try {
      const s = now.current;
      let text: string | null = null;
      try {
        text = kv.get(KEY_V1);
      } catch {
        /* nothing to read */
      }
      // (where the old key is the backup store it is always there: only a text that is not the one converted is news)
      if (!text || (s.converted?.blob?.where === "local" && hashText(text) === s.converted.blob.hash && text.length === s.converted.blob.len)) return;
      const taken = await takeLate(kv, blobs, s);
      if (!taken) return;
      const old = loadV4(taken);
      if (old !== DEFAULT_STATE) await takeOld(old.saved);
    } finally {
      lateBusy.current = false;
    }
  }, [kv, blobs, takeOld]);

  // ── the first start of this build: the move from the old storage is settled once the app is on screen ──
  const settled = useRef(false);
  useEffect(() => {
    if (settled.current) return;
    settled.current = true;
    const settle = async (st: App5State, v1: string) => {
      const out = await settleConversion(kv, blobs, st, v1);
      // (the app may have been used meanwhile: only what the move itself notes is taken from it)
      commit({ ...now.current, converted: out.converted });
      if (out.unsaved) {
        // the old data is where it was (or safe in the larger store); the next change tries the write again
        setFailed(true);
        mayWrite.current = true;
        return;
      }
      try {
        seen.current = kv.get(KEY_V2);
      } catch {
        /* read at the next write */
      }
      mayWrite.current = true;
      if (st.saved.some((i) => i.backup)) {
        const lost = st.saved.filter((i) => !i.backup).reduce((n, i) => n + unplacedTakes(i.song), 0);
        toast(`Your ideas now open in the track view. The originals are in Ideas, under 'Before track view'.${lost ? ` ${lost} recording${lost === 1 ? "" : "s"} whose section was deleted ${lost === 1 ? "is" : "are"} in the take list.` : ""}`);
      }
    };
    if (boot.v1) void settle(boot.state, boot.v1);
    else if (boot.fresh)
      // nothing stored: unless a move was made before whose result could never be written
      void recover5(blobs).then((r) => {
        if (r && now.current === boot.state) {
          commit({ ...r.state, draft: r.state.draft ?? boot.state.draft });
          return settle(r.state, r.v1);
        }
        mayWrite.current = true;
      });
    else if (!boot.stuck) {
      try {
        seen.current = kv.get(KEY_V2);
      } catch {
        /* read at the next write */
      }
      void late();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // an idea saved (or deleted, or a rhythm, kit or sound kept) in another tab is here too, at once
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === KEY_V1 && e.newValue) return void late();
      if (e.key !== KEY_V2 || !e.newValue) return;
      seen.current = e.newValue;
      let theirs: unknown;
      try {
        theirs = JSON.parse(e.newValue);
      } catch {
        return;
      }
      const next = joinOtherTab5(now.current, theirs as Parameters<typeof joinOtherTab5>[1], "theirs", newId);
      if (next === now.current) return;
      // (it is not written back: storage has the other tab's idea on screen, and no more)
      takenIn.current = next;
      commit(next);
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, [commit, late]);

  useEffect(() => {
    const t = state.settings.theme;
    // "auto" hands control back to whatever the host page set (or the OS setting)
    if (t === "auto") {
      if (HOST_THEME) document.documentElement.setAttribute("data-theme", HOST_THEME);
      else document.documentElement.removeAttribute("data-theme");
    } else document.documentElement.setAttribute("data-theme", t);
  }, [state.settings.theme]);

  // ── the song: every change is one undo step ──
  const [recordingTo, setRec] = useState<string | null>(null);
  const recRef = useRef(recordingTo);
  recRef.current = recordingTo;
  const setRecordingTo = useCallback((id: string | null) => {
    // (before a recording starts, what there is is written: the takes are about to go into this idea)
    if (id) flush();
    recRef.current = id;
    setRec(id);
  }, [flush]);
  const edit = useCallback((label: string, fn: (s: TimelineSong) => TimelineSong, control?: string) => commit(editIn(now.current, history, label, fn, control)), [commit, history]);
  const editKeyed = useCallback((label: string, fn: (song: TimelineSong, key: Key) => { song: TimelineSong; key: Key }) => commit(editKeyedIn(now.current, history, label, fn)), [commit, history]);
  const setSession = useCallback((fn: (s: Session) => Session) => {
    const s = now.current;
    const session = fn(s.session);
    if (session !== s.session) commit({ ...s, session });
  }, [commit]);
  const undo = useCallback(() => {
    commit(stepIn(now.current, history, true, !!recRef.current));
    setToast((t) => (t?.action ? null : t));
  }, [commit, history]);
  const redo = useCallback(() => commit(stepIn(now.current, history, false, !!recRef.current)), [commit, history]);

  const tuning = useMemo(() => getTuning(state.settings.tuningId), [state.settings.tuningId]);

  // ── the ideas list ──
  const idea = useMemo(() => state.saved.find((i) => i.id === state.ideaId && !i.backup) ?? null, [state.saved, state.ideaId]);
  const { capo, tuningId } = state.settings;
  const savedPrint = useMemo(() => (idea ? fingerprint5({ key: idea.key, song: idea.song, capo: idea.capo ?? capo, tuningId: idea.tuningId ?? tuningId }) : undefined), [idea, capo, tuningId]);
  const dirty = useMemo(
    () => dirtyOf({ key: state.key, song: state.song, saved: state.saved, ideaId: state.ideaId, settings: state.settings }, savedPrint),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.key, state.song, idea, capo, tuningId, savedPrint],
  );
  const [opened, setOpened] = useState(0);
  const saveIdea = useCallback((asNew = false): "new" | "updated" | "nothing" => {
    const r = saveIn(now.current, asNew, newId(), Date.now());
    commit(r.state);
    if (r.result !== "nothing") flush();
    return r.result;
  }, [commit, flush]);
  /** leaving the idea on screen for another: the music of the one left stops, and what there is is written first */
  const leave = useCallback((next: App5State) => {
    if (next === now.current) return;
    stopAlone();
    setOpened((n) => n + 1);
    commit(next);
    flush();
  }, [commit, flush]);
  const openIdea = useCallback((id: string) => {
    if (recRef.current) return toast("Stop recording first");
    const s = now.current;
    const it = s.saved.find((i) => i.id === id);
    if (!it?.backup) return leave(openIn(s, history, id));
    // a backup entry: its original is converted afresh into a new idea; the entry stays
    void backupSource(id).catch(() => null).then((orig) => {
      if (!orig) return toast("That original cannot be read on this device");
      if (recRef.current) return toast("Stop recording first");
      leave(restoreIn(now.current, history, orig, newId(), Date.now()));
    });
  }, [history, leave, toast]);
  const newIdea = useCallback(() => {
    if (recRef.current) return toast("Stop recording first");
    leave(newIn(now.current, history, newId()));
  }, [history, leave, toast]);
  const renameIdea = useCallback((id: string, name: string) => set((s) => ({ ...s, saved: s.saved.map((i) => (i.id === id ? { ...i, name, updatedAt: Date.now() } : i)) })), [set]);
  const deleteIdea = useCallback((id: string) => set((s) => deleteIn(s, id, newId(), Date.now())), [set]);
  const importIdeas = useCallback((text: string): number => {
    const r = importIn(now.current, text);
    commit(r.state);
    for (const [id, orig] of Object.entries(r.originals)) void keepOriginal(stemOf(id), orig);
    // (old ideas already here, in a copy that may be newer: taken in once what they were converted from has been read)
    if (r.later.length) void takeOld(r.later);
    return r.added;
  }, [commit, takeOld]);

  // ── sync with the account the app is opened under (only where the page is given one) ──
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
        const c = await connectCloud("idea5_");
        if (!c) return setCloud("local");
        const remote = await c.list();
        remote.forEach((r) => known.current.set(r.id, r.deleted ? -r.updatedAt : r.updatedAt));
        const s = now.current;
        const m = mergeIdeas5(s.saved, s.tombs ?? {}, remote);
        const gone = !!s.ideaId && !m.ideas.some((i) => i.id === s.ideaId);
        commit({ ...(gone ? reidea5(s, null, newId()) : s), saved: m.ideas, tombs: m.tombs });
        cloudRef.current = c;
        setCloud("synced");
        // the old library is only ever read: every copy in it that may be newer than what is here is taken in
        const old = await connectCloud("idea_");
        const olds: SavedProgression[] = [];
        for (const r of old ? await old.list() : []) {
          if (r.deleted || !r.json) continue;
          try {
            const [i] = importIdeas5(JSON.stringify({ ideas: [{ ...JSON.parse(r.json), id: r.id, updatedAt: r.updatedAt }] })).old;
            if (i) {
              oldCloud.current.set(i.id, i);
              olds.push(i);
            }
          } catch {
            /* a copy that cannot be read is passed over */
          }
        }
        await takeOld(olds);
      } catch {
        setCloud((c) => (c === "synced" ? c : "error"));
      } finally {
        busy.current = false;
      }
    })();
  }, [commit, takeOld]);
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
        for (const r of toPush5(state.saved, state.tombs ?? {}, known.current)) {
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

  const shown = useMemo<App5State>(() => (failed || boot.stuck ? { ...state, unsaved: true } : state), [state, failed, boot.stuck]);
  const canUndo = history.canUndo;
  const canRedo = history.canRedo;
  const value = useMemo<Ctx5>(
    () => ({ state: shown, peek, set, edit, editKeyed, setSession, undo, redo, canUndo, canRedo, tuning, toast, idea, dirty, opened, saveIdea, openIdea, newIdea, renameIdea, deleteIdea, importIdeas, cloud, syncNow, recordingTo, setRecordingTo }),
    [shown, peek, set, edit, editKeyed, setSession, undo, redo, canUndo, canRedo, tuning, toast, idea, dirty, opened, saveIdea, openIdea, newIdea, renameIdea, deleteIdea, importIdeas, cloud, syncNow, recordingTo, setRecordingTo],
  );
  const toastLive = useMemo(() => !toastMsg?.action?.when || toastMsg.action.when(state), [toastMsg, state]);
  const warn = boot.stuck === "storage" ? WARN.storage : boot.stuck ? WARN.stuck : failed ? WARN.full : null;
  return (
    <App5Ctx.Provider value={value}>
      {children}
      {warn && <div className="store-warn" role="alert">{warn}</div>}
      {toastMsg && toastLive && (
        <div className={`toast${toastMsg.action ? " act" : ""}${toastMsg.msg.length > 60 ? " long" : ""}`} role="status">
          <span>{toastMsg.msg}</span>
          {toastMsg.action && <button aria-label={toastMsg.action.aria} title={toastMsg.action.aria} onClick={() => { toastMsg.action!.run(); setToast(null); }}>{toastMsg.action.label}</button>}
        </div>
      )}
    </App5Ctx.Provider>
  );
}

export function useApp5(): Ctx5 {
  const c = useContext(App5Ctx);
  if (!c) throw new Error("useApp5 outside provider");
  return c;
}
