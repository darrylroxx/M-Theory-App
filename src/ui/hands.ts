/**
 * Someone is changing something by hand: a pointer held down (a knob being dragged, a finger on a
 * grid), a moment after it was let go (taps one after another), or keys on a control a moment
 * ago (arrows on a knob). With Follow on, the page waits to turn to the next section until they
 * stop: every control writes to the section on screen, so a change begun in one section must
 * never go on in the next. (The grids and the Vocals lane hold their own pages the same way.)
 */

/** How long after the last touch or key the page may turn (as on the grids). */
export const HOLD_MS = 1500;

/** a key on something that changes a value (a slider, a list, a box to type in) */
const onControl = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA" || el.isContentEditable || el.getAttribute("role") === "slider");

export interface Hands {
  press: (id: number, t: number) => void;
  release: (id: number, t: number) => void;
  key: (t: number) => void;
  /** every pointer let go at once (the window lost focus) */
  clear: (t: number) => void;
  /** is something being changed by hand at `t`? */
  busy: (t: number) => boolean;
}

export function makeHands(hold = HOLD_MS): Hands {
  const down = new Set<number>();
  let last = -Infinity;
  return {
    press: (id, t) => { down.add(id); last = t; },
    release: (id, t) => { if (down.delete(id)) last = t; },
    key: (t) => { last = t; },
    clear: (t) => { if (down.size) last = t; down.clear(); },
    busy: (t) => down.size > 0 || t < last + hold,
  };
}

/** The app's hands, watched on the whole window. */
const hands = makeHands();
let watching = 0;
const now = () => performance.now();
/** (▶, the loop strip and the page tabs change nothing in a section: the page may turn under them) */
const offHands = (el: EventTarget | null) => el instanceof Element && !!el.closest("section.transport, nav.tabs");
const onDown = (e: PointerEvent) => { if (!offHands(e.target)) hands.press(e.pointerId, now()); };
const onUp = (e: PointerEvent) => hands.release(e.pointerId, now());
/** (a mouse let go outside the window sends no pointerup: the next move with no button down says so) */
const onMove = (e: PointerEvent) => { if (e.buttons === 0) hands.release(e.pointerId, now()); };
const onKey = (e: KeyboardEvent) => { if (onControl(e.target)) hands.key(now()); };
const onBlur = () => hands.clear(now());

/** Start watching (once for the whole app); returns how to stop. */
export function watchHands(): () => void {
  if (typeof window === "undefined") return () => {};
  if (!watching++) {
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
  }
  return () => {
    if (--watching) return;
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onBlur);
  };
}

/** Is something being changed by hand right now? */
export const handsBusy = (): boolean => hands.busy(now());
