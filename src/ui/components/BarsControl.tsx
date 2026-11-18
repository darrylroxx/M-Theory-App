import { useCallback, useSyncExternalStore } from "react";
import { BARS_SHOWN, defaultShown, type BarsShown } from "../../song/window";
import { useApp } from "../state";
import { Seg } from "./common";

/** How many bars suit the screen as it is now (it changes when the window is resized or the phone turned). */
function useScreenShown(): BarsShown {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("resize", cb);
      return () => window.removeEventListener("resize", cb);
    },
    () => defaultShown(window.innerWidth),
    () => 4,
  );
}

/**
 * Bars on screen and Follow, as every editing page reads them: the bars someone picked (or what
 * suits the screen until they pick), and whether the view moves with the music.
 */
export function useBarsView() {
  const { state, set } = useApp();
  const fit = useScreenShown();
  const shown: BarsShown = state.view?.bars ?? fit;
  const follow = state.view?.follow === true;
  const setShown = useCallback((bars: BarsShown) => set((s) => ({ ...s, view: { ...s.view, bars } })), [set]);
  const setFollow = useCallback((on: boolean) => set((s) => ({ ...s, view: { ...s.view, follow: on } })), [set]);
  return { shown, follow, setShown, setFollow };
}

/** A line with an arrow off it: the view goes along with the playhead. */
function FollowIcon() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
      <path d="M2.5 1v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 7h7.5M10.5 4l3 3-3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/**
 * The one control for every editing page: how many bars are on screen (1, 2, 4, 8 or All), and
 * Follow. With Follow off the music never moves the view; with it on the view turns a page when
 * the music runs off the end of it. On a phone the numbers fold into a menu.
 */
export function BarsControl() {
  const { shown, follow, setShown, setFollow } = useBarsView();
  return (
    <span className="bars-ctl">
      <span className="kb-label">Bars</span>
      <Seg value={shown} options={BARS_SHOWN.map((n) => ({ value: n, label: n || "All" }))} onChange={setShown} label="Bars on screen" />
      <select className="bars-pick" aria-label="Bars on screen" value={shown} onChange={(e) => setShown(Number(e.target.value) as BarsShown)}>
        {BARS_SHOWN.map((n) => <option key={n} value={n}>{n ? `${n} bar${n === 1 ? "" : "s"}` : "All"}</option>)}
      </select>
      <button className={`chip bars-follow${follow ? " on" : ""}`} role="switch" aria-checked={follow} aria-label="Follow" title="Follow the music" onClick={() => setFollow(!follow)}>
        <FollowIcon /><span>Follow</span>
      </button>
    </span>
  );
}
