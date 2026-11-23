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
  /** `beside`: a sound window opened from its track's composer stands beside it (the composer gives up that width) */
  open(kind: "compose" | "sound", track: string, clip?: string, beside?: boolean): void;
  close(id: string): void;
  focus(id: string): void;
  focused: string | null;
}

/** The width of the track panels and the height of the top bar and the ruler together: where the lanes start. */
export const PANEL_W = 260;
export const TOP_H = 84;
/** How wide a sound window opens. */
export const SOUND_W = 420;
/** The smallest a window can be made by its corner, and the least a composer keeps when a sound window stands beside it. */
export const MIN_W = 320;
export const MIN_H = 200;
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

/** How far a window steps aside from one that stands where it would open: the height of a title bar down, and a little to the left. */
export const STEP_X = 28;
export const STEP_Y = 40;

/**
 * Where a window opens when others may already stand at its first place: stepped down and to the left until its top
 * left corner is its own (never past the panels' edge, and never lower than leaves it `MIN_H` high).
 */
export function clearOf(r: Rect, others: Rect[], view: { panel: number; h: number }): Rect {
  let at = r;
  for (let n = 0; n < 12 && others.some((o) => o.x === at.x && o.y === at.y); n++) {
    const x = Math.max(view.panel, at.x - STEP_X);
    const y = at.y + STEP_Y;
    const h = Math.min(at.h, view.h - y);
    if (h < MIN_H || (x === at.x && y === at.y)) break;
    at = { x, y, w: at.w, h };
  }
  return at;
}

/** A window's box brought back inside the screen (one larger than the screen starts at its corner). */
export function keepInside(r: Rect, view: { w: number; h: number }): Rect {
  const x = Math.max(0, Math.min(r.x, view.w - r.w));
  const y = Math.max(0, Math.min(r.y, view.h - r.h));
  return x === r.x && y === r.y ? r : { ...r, x, y };
}

/** A window's box after its bottom-right corner was dragged by so much: never smaller than the least, never past the screen's edges. */
export function resized(r: Rect, dx: number, dy: number, view: { w: number; h: number }): Rect {
  const w = Math.round(Math.max(Math.min(MIN_W, view.w - r.x), Math.min(r.w + dx, view.w - r.x)));
  const h = Math.round(Math.max(Math.min(MIN_H, view.h - r.y), Math.min(r.h + dy, view.h - r.y)));
  return w === r.w && h === r.h ? r : { ...r, w, h };
}

/** Does a sound window stand directly beside a composer (at its right edge, as tall and as high up)? */
export const isBeside = (sound: Rect, composer: Rect): boolean => sound.x === composer.x + composer.w && sound.y === composer.y && sound.h === composer.h;

/** At 760 pixels and narrower, or under a finger, a window is a sheet across the bottom of the screen. */
export const isSheet = (width: number, coarse: boolean): boolean => width <= 760 || coarse;

// ── the list, as plain changes of the session ───────────────

/**
 * A window opened: a new one at its first place, in front; one that was open before where it was left. A composer
 * opened on another clip of its track shows that clip (no clip: what is being composed, the track's draft).
 * `beside`: a sound window asked for from its track's composer stands at the composer's right end, as tall as it,
 * and the composer gives up that width (when the two already stand so, nothing moves; when the composer is too
 * narrow to share, the sound window opens where it would on its own).
 */
export function openWin(session: Session, kind: "compose" | "sound", track: string, clip: string | undefined, view: { w: number; h: number; panel: number; top: number }, beside = false): Session {
  const id = winId(kind, track);
  const old = session.windows.find((w) => w.id === id);
  let rest = session.windows.filter((w) => w.id !== id);
  let next: WinState = old ? { ...old, open: true } : { id, kind, track, ...firstPlace(kind, view), open: true };
  // a sound window opening for the first time where another already stands: a step down and to the left of it, so
  // both title bars can be reached (composers share their place on purpose: one track's is brought forward at a time)
  if (!old && kind === "sound") next = { ...next, ...clearOf(next, rest.filter((w) => w.open && w.kind === "sound"), view) };
  if (kind === "compose") {
    if (clip !== undefined) next.clip = clip;
    else delete next.clip;
  }
  const composer = kind === "sound" && beside ? rest.find((w) => w.id === winId("compose", track) && w.open) : undefined;
  if (composer && !isBeside(next, composer)) {
    const w = Math.min(SOUND_W, composer.w - MIN_W);
    if (w >= MIN_W - 40) {
      const narrower = { ...composer, w: composer.w - w };
      rest = rest.map((x) => (x === composer ? narrower : x));
      next = { ...next, x: narrower.x + narrower.w, y: narrower.y, w, h: narrower.h };
    }
  }
  return { ...session, windows: [...rest, next] };
}
/** A window closed: it keeps its place for the next time. A sound window that stood beside its composer gives the width back. */
export function closeWin(session: Session, id: string): Session {
  const w = session.windows.find((x) => x.id === id);
  if (!w || !w.open) return session;
  const composer = w.kind === "sound" ? session.windows.find((x) => x.id === winId("compose", w.track)) : undefined;
  const back = composer && isBeside(w, composer) ? composer : undefined;
  return { ...session, windows: session.windows.map((x) => (x === w ? { ...x, open: false } : x === back ? { ...x, w: x.w + w.w } : x)) };
}
/** A composer put on another clip of its track (none: on the track's draft), wherever it is and whether or not it is open. */
export function retargetWin(session: Session, id: string, clip: string | undefined): Session {
  const w = session.windows.find((x) => x.id === id);
  if (!w || w.kind !== "compose" || w.clip === clip) return session;
  const { clip: _was, ...bare } = w;
  return { ...session, windows: session.windows.map((x) => (x === w ? (clip === undefined ? bare : { ...bare, clip }) : x)) };
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
  const open = useCallback((kind: "compose" | "sound", track: string, clip?: string, beside?: boolean) => {
    setSession((s) => openWin(s, kind, track, clip, { ...screen(), panel: PANEL_W, top: TOP_H }, beside));
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
  // a press outside every window: none of them has the focus. (Not a press on the top bar or the ruler: playing,
  // moving the cursor and marking a loop are done to what the window is on, and it goes on being heard.)
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest(KEEPS_FOCUS)) return;
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

/** Where a press leaves the focused window its focus: in any window, on the top bar, on the ruler row, in a menu or a message. */
const KEEPS_FOCUS = ".tlw, .tlv-top, .tlv-rulerrow, .tlv-menu, .toast";

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
