// The plugin windows of the track view: which are open, where each was left, which is in front, and which has the focus.
//
// One composer window and one sound window per track. Where a window is, and whether it is open, is kept in the
// session (so it comes back where it was left); the order of the list is the stacking order, the last one in front.
// Which window has the focus is not stored: it is the last one pressed, and nothing once the press is outside them.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { barMap } from "../../timeline/bars";
import { clipEnd, type Session, type TimelineSong, type WinState } from "../../timeline/model";
import { barsLabel } from "../timeline/gestures";
import { ESC_WINDOW, onEscape } from "../timeline/keys";

export type { WinState } from "../../timeline/model";

export interface WindowsApi {
  open(kind: "compose" | "sound", track: string, clip?: string): void;
  close(id: string): void;
  focus(id: string): void;
  focused: string | null;
}

/** The width of the track panels and the height of the top bar and the ruler together: where the lanes start. */
export const PANEL_W = 260;
export const TOP_H = 84;
/** How wide a sound window opens. */
export const SOUND_W = 420;
/** The band of the stacking order kept for windows: above the page, below sheets and messages. */
export const Z_FIRST = 45;
export const Z_LAST = 59;

type Rect = Pick<WinState, "x" | "y" | "w" | "h">;

export const winId = (kind: "compose" | "sound", track: string): string => `${kind}:${track}`;

/**
 * Where a window opens the first time (it has no remembered place yet).
 * A composer lies across the lower part of the lanes: from the panels' right edge to the right edge of the screen,
 * 440 high or 55 % of the screen if that is less, its bottom on the bottom of the screen.
 * A sound window stands 420 wide down the right side of the lanes; `beside` a composer, it takes the right end of that.
 */
export function firstPlace(kind: "compose" | "sound", view: { w: number; h: number; panel: number; top: number }, beside?: WinState): Rect {
  if (kind === "compose") {
    const h = Math.round(Math.min(440, view.h * 0.55));
    return { x: view.panel, y: view.h - h, w: Math.max(0, view.w - view.panel), h };
  }
  const w = Math.min(SOUND_W, Math.max(0, view.w - view.panel));
  if (beside) return { x: beside.x + beside.w - w, y: beside.y, w, h: beside.h };
  return { x: view.w - w, y: view.top, w, h: Math.max(0, view.h - view.top) };
}

/** A window's box brought back inside the screen (one larger than the screen starts at its corner). */
export function keepInside(r: Rect, view: { w: number; h: number }): Rect {
  const x = Math.max(0, Math.min(r.x, view.w - r.w));
  const y = Math.max(0, Math.min(r.y, view.h - r.h));
  return x === r.x && y === r.y ? r : { ...r, x, y };
}

/** At 760 pixels and narrower, or under a finger, a window is a sheet across the bottom of the screen. */
export const isSheet = (width: number, coarse: boolean): boolean => width <= 760 || coarse;

// ── the list, as plain changes of the session ───────────────

/** A window opened: a new one at its first place, in front; one that was open before where it was left. A composer opened on another clip of its track shows that clip (no clip: what is being composed). */
export function openWin(session: Session, kind: "compose" | "sound", track: string, clip: string | undefined, view: { w: number; h: number; panel: number; top: number }): Session {
  const id = winId(kind, track);
  const old = session.windows.find((w) => w.id === id);
  const rest = session.windows.filter((w) => w.id !== id);
  const next: WinState = old ? { ...old, open: true } : { id, kind, track, ...firstPlace(kind, view), open: true };
  if (kind === "compose") {
    if (clip !== undefined) next.clip = clip;
    else delete next.clip;
  }
  return { ...session, windows: [...rest, next] };
}
/** A window closed: it keeps its place for the next time. */
export function closeWin(session: Session, id: string): Session {
  const w = session.windows.find((x) => x.id === id);
  return !w || !w.open ? session : { ...session, windows: session.windows.map((x) => (x === w ? { ...x, open: false } : x)) };
}
/** A window brought to the front. */
export function frontWin(session: Session, id: string): Session {
  const w = session.windows.find((x) => x.id === id);
  if (!w || session.windows[session.windows.length - 1] === w) return session;
  return { ...session, windows: [...session.windows.filter((x) => x !== w), w] };
}
/** A window moved (or given another size). */
export function placeWin(session: Session, id: string, r: Rect): Session {
  const w = session.windows.find((x) => x.id === id);
  if (!w || (w.x === r.x && w.y === r.y && w.w === r.w && w.h === r.h)) return session;
  return { ...session, windows: session.windows.map((x) => (x === w ? { ...x, x: r.x, y: r.y, w: r.w, h: r.h } : x)) };
}
/** The windows on screen, back to front. */
export const openWins = (session: Session): WinState[] => session.windows.filter((w) => w.open);
/** Where a window is in the stack: 45 for the one at the back, up to 59. */
export function zOf(session: Session, id: string): number {
  const open = openWins(session);
  const i = open.findIndex((w) => w.id === id);
  return Math.max(Z_FIRST, Z_LAST - (open.length - 1 - Math.max(0, i)));
}
/** What a composer has open, for its title: "bars 5–8", or "draft" when it is not on the timeline yet. */
export function openLabel(song: TimelineSong, clip: string | undefined): string {
  const c = clip === undefined ? undefined : song.clips.find((x) => x.id === clip);
  return c ? barsLabel(barMap(song), c.start, clipEnd(c, song)) : "draft";
}

// ── for the screen ──────────────────────────────────────────

const screen = () => (typeof window === "undefined" ? { w: 1280, h: 800 } : { w: window.innerWidth, h: window.innerHeight });

/**
 * The windows of a session. `open` brings a window up and gives it the focus; a press outside every window takes
 * the focus away; Escape closes the one that has it.
 */
export function useWindows(session: Session, setSession: (fn: (s: Session) => Session) => void): WindowsApi & { move(id: string, r: Rect): void } {
  const [focused, setFocused] = useState<string | null>(null);
  const now = useRef({ session, focused });
  now.current = { session, focused };
  const open = useCallback((kind: "compose" | "sound", track: string, clip?: string) => {
    setSession((s) => openWin(s, kind, track, clip, { ...screen(), panel: PANEL_W, top: TOP_H }));
    setFocused(winId(kind, track));
  }, [setSession]);
  const close = useCallback((id: string) => {
    setSession((s) => closeWin(s, id));
    setFocused((f) => (f === id ? null : f));
  }, [setSession]);
  const focus = useCallback((id: string) => {
    setSession((s) => frontWin(s, id));
    setFocused(id);
  }, [setSession]);
  const move = useCallback((id: string, r: Rect) => setSession((s) => placeWin(s, id, r)), [setSession]);
  // a press outside every window: none of them has the focus
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest(".tlw")) return;
      setFocused(null);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, []);
  // Escape closes the focused window
  useEffect(
    () => onEscape(ESC_WINDOW, () => {
      const { session: s, focused: f } = now.current;
      if (!f || !s.windows.some((w) => w.id === f && w.open)) return false;
      close(f);
      return true;
    }),
    [close],
  );
  // a window that is gone has no focus
  const shown = focused && session.windows.some((w) => w.id === focused && w.open) ? focused : null;
  return useMemo(() => ({ open, close, focus, focused: shown, move }), [open, close, focus, shown, move]);
}

/** Is this the focused window (or a place outside every window)? The pages inside windows listen for keys only while it is. */
export const WinFocus = createContext(true);
export function useWinFocus(): boolean {
  return useContext(WinFocus);
}

function subscribe(fn: () => void): () => void {
  window.addEventListener("resize", fn);
  const mq = window.matchMedia?.("(pointer: coarse)");
  mq?.addEventListener?.("change", fn);
  return () => {
    window.removeEventListener("resize", fn);
    mq?.removeEventListener?.("change", fn);
  };
}
/** Are windows sheets on this screen? */
export function useSheet(): boolean {
  return useSyncExternalStore(subscribe, () => isSheet(window.innerWidth, !!window.matchMedia?.("(pointer: coarse)").matches), () => false);
}
