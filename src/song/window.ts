/**
 * Bars on screen: how much of a section the editing pages show at once.
 *
 * The Chords, Melody, Drums and Track pages show a window of bars: 1, 2, 4 or 8 of them, or the
 * whole thing. The window only moves when someone moves it, or, with Follow on, when the music
 * leaves it: then it turns a whole page, never a bar at a time. Everything here is plain
 * arithmetic on bar numbers (counted from 0), so the pages can share it.
 */

/** How many bars can be chosen. 0 is "All": the whole section (the whole song on the Track page). */
export const BARS_SHOWN = [1, 2, 4, 8, 0] as const;
export type BarsShown = (typeof BARS_SHOWN)[number];

/** How the editing pages are set to look, kept with the app (never with a song). */
export interface ViewPrefs {
  /** bars on screen; not set = what suits the screen (see defaultShown) */
  bars?: BarsShown;
  /** the view moves with the music while it plays */
  follow?: boolean;
}

export const isShown = (v: unknown): v is BarsShown => BARS_SHOWN.includes(v as BarsShown);

/** Until someone picks: four bars on a wide screen, two on a tablet, one on a phone. */
export const defaultShown = (width: number): BarsShown => (width >= 1000 ? 4 : width >= 640 ? 2 : 1);

/** The setting loaded from storage, made safe. Follow is off unless it was switched on. */
export function reviveView(raw: unknown): ViewPrefs | undefined {
  const v = raw as Partial<ViewPrefs> | null | undefined;
  if (!v || typeof v !== "object") return undefined;
  return { ...(isShown(v.bars) ? { bars: v.bars } : {}), follow: v.follow === true };
}

/** How many bars are actually on screen out of so many: "All" is every one of them. */
export const shownCount = (shown: BarsShown, total: number): number => {
  const all = Math.max(1, Math.round(total) || 1);
  return shown === 0 ? all : Math.max(1, Math.min(shown, all));
};

/** A run of bars: the first one on screen, and how many. */
export interface BarWindow {
  start: number;
  count: number;
}

/** A first bar that keeps the window inside the section, and full wherever the section is long enough. */
export const clampStart = (start: number, count: number, total: number): number => Math.max(0, Math.min(Math.floor(start) || 0, Math.max(0, total - count)));

/** The window that shows `shown` bars of a section of `total`, starting as near `start` as it can. */
export function barWindow(total: number, shown: BarsShown, start: number): BarWindow {
  const all = Math.max(1, Math.round(total) || 1);
  const count = shownCount(shown, all);
  return { start: clampStart(start, count, all), count };
}

export const inWindow = (w: BarWindow, bar: number): boolean => bar >= w.start && bar < w.start + w.count;

/**
 * The page a bar is on: windows are laid edge to edge from bar 1, so bar 5 of a four-bar view is
 * on the page of bars 5 to 8. The last page is moved back to stay full (bars 3 to 6 of six).
 */
export const pageStart = (bar: number, count: number, total: number): number => clampStart(Math.floor(Math.max(0, bar) / Math.max(1, count)) * Math.max(1, count), count, total);

/** Where the window goes so that a bar is on screen: nowhere if it already is, else to that bar's page. */
export const reveal = (w: BarWindow, bar: number, total: number): number => (inWindow(w, bar) ? w.start : pageStart(bar, w.count, total));

/** One page earlier (−1) or later (+1). */
export const turnPage = (w: BarWindow, dir: -1 | 1, total: number): number => clampStart(w.start + dir * w.count, w.count, total);

/** The bar of a section that is sounding, `beat` beats in (a section that comes round again is folded back). */
export function barAtBeat(beat: number, bar: number, total: number): number {
  const all = Math.max(1, Math.round(total) || 1);
  const len = all * bar;
  if (!(bar > 0) || !Number.isFinite(beat)) return 0;
  const at = ((beat % len) + len) % len;
  return Math.max(0, Math.min(all - 1, Math.floor(at / bar + 1e-6)));
}

/** The bar a point `x` of the way across a run of `total` bars is in (the Vocals lane's line, 0..1). */
export function barAtFrac(x: number, total: number): number {
  const all = Math.max(1, Math.round(total) || 1);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(all - 1, Math.floor(x * all + 1e-9)));
}

/**
 * The bars a sideways scroll shows: `left` pixels scrolled, `width` pixels on screen for `count`
 * bars. The lane of takes scrolls by hand as well as by page, so its window is read from where
 * it has been scrolled to (to the nearest whole bar).
 */
export function scrolledWindow(left: number, width: number, count: number, total: number): BarWindow {
  const all = Math.max(1, Math.round(total) || 1);
  const n = Math.max(1, Math.min(Math.round(count) || 1, all));
  const bw = width / n;
  return { start: bw > 0 && Number.isFinite(left) ? clampStart(Math.round(left / bw), n, all) : 0, count: n };
}
