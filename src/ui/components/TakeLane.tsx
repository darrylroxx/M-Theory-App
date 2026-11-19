import { useEffect, useLayoutEffect, useRef } from "react";
import { takeBars, type Take } from "../../song/takes";
import { barAtFrac, clampStart, reveal, scrolledWindow, shownCount, turnPage, type BarsShown } from "../../song/window";

/** One bar of what a recording goes round: its section, which of its bars, its letter, its beats. */
export interface LaneBar {
  block: string;
  bar: number;
  letter: string;
  beats: number;
}

/** At most this many recordings are drawn one above another; the rest are counted. */
const ROWS = 4;
/** After a scroll or a page turned by hand, Follow waits this long before it turns the page (as on the grids). */
const HOLD_MS = 1500;

/**
 * The bars a recording goes round (the loop, or the section on screen), as many at a time as
 * Bars on screen says, across the whole width; more than that scroll sideways (by hand, or
 * with ‹ ›). The take that plays from each recording is drawn where it sits, and a line moves
 * with the music while it plays or records. A thin line along the top fills as each pass goes
 * by. With Follow on, the lane turns a page when the music runs off it; with Follow off it
 * never moves on its own. Tap a take to hear it alone.
 */
export function TakeLane({ bars, takes, bpm, where, live, onPick, shown, follow }: {
  bars: LaneBar[];
  /** the takes to draw (the one that plays from each recording, newest first), with a short label */
  takes: { take: Take; label: string }[];
  bpm: number;
  /** how far across the lane the music is (0..1), or null when it is not in these bars */
  where: () => number | null;
  /** the music is going: move the line */
  live: boolean;
  onPick?: (t: Take) => void;
  /** bars on screen (0 = all of them) */
  shown: BarsShown;
  /** the lane turns a page with the music */
  follow: boolean;
}) {
  const headRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const n = Math.max(1, bars.length);
  const count = shownCount(shown, n);
  const paged = count < n;

  /** the first bar on screen, kept as the lane is scrolled (so a new bar count or width keeps it at the left) */
  const leftBar = useRef(0);
  /** when the lane was last moved by hand */
  const held = useRef(0);
  const live$ = useRef({ count, n, follow });
  live$.current = { count, n, follow };
  /** The bars on screen, read from the scroll (only when the music enters a new bar, or a page is turned). */
  const windowNow = () => {
    const sc = scrollRef.current;
    return sc ? scrolledWindow(sc.scrollLeft, sc.clientWidth, live$.current.count, live$.current.n) : { start: 0, count };
  };
  const scrollToBar = (bar: number, smooth = false) => {
    const sc = scrollRef.current;
    if (!sc || !sc.clientWidth) return;
    const left = (clampStart(bar, live$.current.count, live$.current.n) * sc.clientWidth) / live$.current.count;
    if (smooth && typeof sc.scrollTo === "function") sc.scrollTo({ left, behavior: "smooth" });
    else sc.scrollLeft = left;
  };

  // another loop: back to its first bar
  const which = bars.length ? `${bars[0].block}:${bars[0].bar}-${bars[n - 1].block}:${bars[n - 1].bar}` : "";
  useLayoutEffect(() => {
    leftBar.current = 0;
    scrollToBar(0);
  }, [which]); // eslint-disable-line react-hooks/exhaustive-deps
  // more or fewer bars on screen (or a wider window): the bar at the left edge stays there
  useLayoutEffect(() => scrollToBar(leftBar.current), [count, n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => scrollToBar(leftBar.current));
    ro.observe(sc);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the line follows the music every frame, without drawing the lane again. The scroll is only
  // looked at when the music enters another bar, so recording is never slowed by it.
  useEffect(() => {
    const head = headRef.current;
    const fill = fillRef.current;
    if (!head || !fill) return;
    const hide = () => {
      head.style.opacity = "0";
      fill.style.transform = "scaleX(0)";
    };
    if (!live) return hide();
    let raf = 0;
    let bar = -1;
    const tick = () => {
      const x = where();
      if (x === null) {
        hide();
        bar = -1;
      } else {
        head.style.opacity = "1";
        head.style.left = `${(x * 100).toFixed(3)}%`;
        fill.style.transform = `scaleX(${x.toFixed(4)})`;
        const l = live$.current;
        const b = barAtFrac(x, l.n);
        if (b !== bar) {
          bar = b;
          // a whole page at a time, and only with Follow on (never a bar at a time, never while being scrolled by hand)
          if (l.follow && l.count < l.n && performance.now() > held.current + HOLD_MS) {
            const w = windowNow();
            const to = reveal(w, b, l.n);
            if (to !== w.start) scrollToBar(to);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); hide(); };
  }, [live, where]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Someone is moving the lane: Follow waits a moment. */
  const hold = () => {
    held.current = performance.now();
  };
  const page = (dir: -1 | 1) => {
    hold();
    scrollToBar(turnPage(windowNow(), dir, n), true);
  };

  const index = (block: string, bar: number) => bars.findIndex((b) => b.block === block && b.bar === bar);
  const placed = takes
    .map(({ take, label }) => ({ take, label, i: index(take.at.block, take.at.bar) }))
    .filter((x) => x.i >= 0);
  const drawn = placed.slice(0, ROWS);
  const rows = Math.max(1, drawn.length);
  // when many bars are on screen at once, only every so many is numbered (and each section's first)
  const step = Math.max(1, Math.ceil(count / 16));
  const labelled = (i: number) => i === 0 || bars[i - 1].block !== bars[i].block || i % step === 0;
  /** how many bars a label has before the next one (a long section name is cut short there, never written over it) */
  const room = (i: number) => {
    let j = i + 1;
    while (j < bars.length && !labelled(j)) j++;
    return j - i;
  };
  return (
    <div className={`tl-wrap${paged ? " paged" : ""}`}>
      {paged && <button className="btn sm dm-page" aria-label="Earlier bars" onClick={() => page(-1)}>‹</button>}
      <div className="take-lane" role="group" aria-label="Takes in the bars recorded over" style={{ ["--rows" as string]: rows }}>
        <div className="tl-scroll" ref={scrollRef} onWheel={hold} onPointerDown={hold} onTouchStart={hold}
          onScroll={(e) => { const el = e.currentTarget; if (el.clientWidth) leftBar.current = Math.round((el.scrollLeft * count) / el.clientWidth); }}>
          {/* as wide as all the bars, at the width the bars on screen share */}
          <div className="tl-inner" style={{ width: `${(n / count) * 100}%` }}>
            <div className="tl-fill" ref={fillRef} />
            <div className="tl-bars">
              {bars.map((b, i) => {
                const starts = i === 0 || bars[i - 1].block !== b.block;
                return (
                  <span key={`${b.block}:${b.bar}`} className={`tl-bar${starts ? " sec" : ""}`}>
                    {/* "A1", or for a section with a name of its own, "Chorus 1" */}
                    {labelled(i) && <i style={{ maxWidth: `calc(${room(i) * 100}% - 6px)` }}>{starts ? `${b.letter}${b.letter.length > 1 ? " " : ""}${b.bar + 1}` : b.bar + 1}</i>}
                  </span>
                );
              })}
            </div>
            <div className="tl-takes">
              {drawn.map(({ take, label, i }, r) => {
                const w = Math.min(n - i, takeBars(take, bpm, bars[i].beats));
                return (
                  <button key={take.id} className={`tl-take${take.keep ? " keep" : ""}`} style={{ left: `${(i / n) * 100}%`, width: `${(Math.max(0.15, w) / n) * 100}%`, top: r * 18 }} title="Hear it alone" aria-label={`${label}: hear it alone`} onClick={() => onPick?.(take)}>
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="tl-head" ref={headRef} />
          </div>
        </div>
        {placed.length > drawn.length && <span className="tl-more">+{placed.length - drawn.length}</span>}
      </div>
      {paged && <button className="btn sm dm-page" aria-label="Later bars" onClick={() => page(1)}>›</button>}
    </div>
  );
}
