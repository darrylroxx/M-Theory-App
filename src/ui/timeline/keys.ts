// The track view's keys: one listener on the window, and the plain table behind it.
//
// The old pages listen on the window too, and a focused knob or slider uses some of the same keys, so who gets a
// key is written down here once:
//  1. Space is taken first (in the capture phase, on the way down and on the way up) and always plays or stops,
//     unless the focus is in a box to type in, a list to choose from, or the list of takes.
//  2. A key that something else already handled is left alone.
//  3. With the focus inside a plugin window, a sheet, a popover or on a control, only Space, undo, redo, save and
//     Escape are handled here. Every other key belongs to what has the focus.
//  4. Escape does one thing per press, the first that applies: whoever may want it says so with `onEscape`.

export type KeyAction =
  | "play" | "home" | "end" | "left" | "right" | "left-beat" | "right-beat" | "loop" | "record" | "split" | "delete" | "mute"
  | "copy" | "cut" | "paste" | "paste-insert" | "duplicate" | "select-all" | "cut-time" | "insert-bar" | "insert-loop"
  | "undo" | "redo" | "add-track" | "save" | "marker" | "rename" | "zoom-in" | "zoom-out" | "open" | "escape";

/** Where the focus is when a key comes: on the timeline, in a box to type in, on a control (or inside a window, a sheet or a popover), or in the list of takes. */
export type Where = "timeline" | "text" | "control" | "takes";

/** What may be done from anywhere that is not a box to type in. */
const ANYWHERE = new Set<KeyAction>(["play", "undo", "redo", "save", "escape"]);

/** The table itself: what a key does on the timeline (null: nothing). */
function onTimeline(e: { key: string; ctrl: boolean; shift: boolean; alt: boolean; repeat: boolean }, desktop: boolean): KeyAction | null {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // a key held down counts once, except the ones that step
  const steps = k === "ArrowLeft" || k === "ArrowRight" || k === "+" || k === "=" || k === "-" || k === "_";
  if (e.repeat && !steps) return null;
  if (e.alt) return null;
  if (e.ctrl) {
    switch (k) {
      case "z": return e.shift ? "redo" : "undo";
      case "y": return e.shift ? null : "redo";
      case "s": return e.shift ? null : "save";
      case "c": return e.shift ? null : "copy";
      case "x": return e.shift ? null : "cut";
      case "v": return e.shift ? "paste-insert" : "paste";
      case "d": return e.shift ? null : "duplicate";
      case "a": return e.shift ? null : "select-all";
      // (a browser keeps these two for itself: the + row and the ● button are the way there)
      case "t": return desktop && !e.shift ? "add-track" : null;
      case "r": return desktop && !e.shift ? "record" : null;
      case "Delete": case "Backspace": return e.shift ? "cut-time" : null;
      default: return null;
    }
  }
  switch (k) {
    case " ": case "Spacebar": return "play";
    case "Home": return "home";
    case "End": return "end";
    case "ArrowLeft": return e.shift ? "left-beat" : "left";
    case "ArrowRight": return e.shift ? "right-beat" : "right";
    case "l": case "r": return "loop";
    case "s": return "split";
    case "Delete": case "Backspace": return "delete";
    case "0": return "mute";
    case "Insert": return e.shift ? "insert-loop" : "insert-bar";
    case "m": return "marker";
    case "F2": return "rename";
    case "+": case "=": return "zoom-in";
    case "-": case "_": return "zoom-out";
    case "Enter": return "open";
    case "Escape": return "escape";
    default: return null;
  }
}

/**
 * What a key press does, or null when it is not the timeline's to take.
 * `where`: in a box to type in, only save and Escape are taken (Space types a space, Ctrl+Z is the box's own undo);
 * in the list of takes Space is the list's; on a control or inside a window only Space, undo, redo, save and Escape.
 * `desktop`: the desktop app also takes Ctrl+T and Ctrl+R.
 */
export function keyAction(e: { key: string; ctrl: boolean; shift: boolean; alt: boolean; repeat: boolean }, where: Where, desktop: boolean): KeyAction | null {
  const a = onTimeline(e, desktop);
  if (!a || where === "timeline") return a;
  if (where === "text") return a === "save" || a === "escape" ? a : null;
  if (where === "takes") return a !== "play" && ANYWHERE.has(a) ? a : null;
  return ANYWHERE.has(a) ? a : null;
}

const TEXT_INPUTS = new Set(["text", "search", "url", "tel", "email", "password", "number"]);

/** Where a key event's target is, for the rules above. */
export function whereOf(target: EventTarget | null): Where {
  if (typeof Element === "undefined" || !(target instanceof Element)) return "timeline";
  const el = target as HTMLElement;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || (el.tagName === "INPUT" && TEXT_INPUTS.has((el as HTMLInputElement).type))) return "text";
  if (el.closest('[data-keys="takes"]')) return "takes";
  if (el.tagName === "INPUT" || el.getAttribute("role") === "slider" || el.closest('[data-keys="own"], .sheet, .sheet-backdrop')) return "control";
  return "timeline";
}

// ── Escape: one thing per press ─────────────────────────────

/** Who is asked first: something open over everything (a menu, a popover, a sheet), then the focused window, then the view itself. */
export const ESC_OPEN = 3;
export const ESC_WINDOW = 2;
export const ESC_VIEW = 1;

const askers: { level: number; fn: () => boolean }[] = [];

/** Ask for Escape. `fn` says whether it had something to do with it (then nobody else is asked). Returns how to stop asking. */
export function onEscape(level: number, fn: () => boolean): () => void {
  const entry = { level, fn };
  askers.push(entry);
  return () => {
    const i = askers.indexOf(entry);
    if (i >= 0) askers.splice(i, 1);
  };
}
/** One press of Escape: the highest level first, and within a level whoever asked last. */
export function runEscape(): boolean {
  const order = askers.map((a, i) => ({ a, i })).sort((p, q) => q.a.level - p.a.level || q.i - p.i);
  return order.some(({ a }) => a.fn());
}

// ── the listener ────────────────────────────────────────────

const isButton = (t: EventTarget | null): boolean => typeof Element !== "undefined" && t instanceof Element && !!t.closest("button, a, summary, [role='button']");

/**
 * Start listening on the window. `run` is called with every action but Escape (that goes to whoever asked for it).
 * Returns how to stop.
 */
export function listenKeys(run: (action: KeyAction, e: KeyboardEvent) => void, desktop: boolean): () => void {
  if (typeof window === "undefined") return () => {};
  const read = (e: KeyboardEvent) => ({ key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, repeat: e.repeat });
  const isSpace = (e: KeyboardEvent) => e.key === " " || e.key === "Spacebar";
  // Space, before anything else sees it: it never "clicks" the button or grid square that happens to have the focus
  const spaceDown = (e: KeyboardEvent) => {
    if (!isSpace(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const where = whereOf(e.target);
    if (where === "text" || where === "takes") return;
    e.preventDefault();
    e.stopPropagation();
    if (keyAction(read(e), where, desktop) === "play") run("play", e);
  };
  const spaceUp = (e: KeyboardEvent) => {
    if (!isSpace(e)) return;
    const where = whereOf(e.target);
    if (where === "text" || where === "takes") return;
    e.preventDefault();
  };
  const down = (e: KeyboardEvent) => {
    if (e.defaultPrevented || isSpace(e)) return;
    const action = keyAction(read(e), whereOf(e.target), desktop);
    if (!action) return;
    // Enter on a button presses the button
    if (action === "open" && isButton(e.target)) return;
    if (action === "escape") {
      if (runEscape()) e.preventDefault();
      return;
    }
    e.preventDefault();
    run(action, e);
  };
  window.addEventListener("keydown", spaceDown, true);
  window.addEventListener("keyup", spaceUp, true);
  window.addEventListener("keydown", down);
  return () => {
    window.removeEventListener("keydown", spaceDown, true);
    window.removeEventListener("keyup", spaceUp, true);
    window.removeEventListener("keydown", down);
  };
}
