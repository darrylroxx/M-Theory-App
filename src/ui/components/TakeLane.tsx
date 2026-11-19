import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { barsInto, takeBars, type Take } from "../../song/takes";
import { barAtFrac, clampStart, pageStart, scrolledWindow, shownCount, turnPage, type BarsShown } from "../../song/window";

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
 * never moves on its own. Tap a take to hear it alone (in the desktop app).
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
  /** the same, for drawing: ‹ and › are greyed at the ends, as on the grids (it changes once a page, never a frame) */
  const [first, setFirst] = useState(0);
  /** when the lane was last moved by hand */
  const held = useRef(0);
  const live$ = useRef({ count, n, follow });
  live$.current = { count, n, follow };
  const scrollToBar = (bar: number) => {
    const sc = scrollRef.current;
    if (!sc || !sc.clientWidth) return false;
    const { count, n } = live$.current;
    const to = clampStart(bar, count, n);
    sc.scrollLeft = (to * sc.clientWidth) / count;
    // known straight away, not only once the scroll event comes: the music checks it every frame
    leftBar.current = to;
    return true;
  };

  // another loop: back to its first bar
  const which = bars.length ? `${bars[0].block}:${bars[0].bar}-${bars[n - 1].block}:${bars[n - 1].bar}` : "";
  useLayoutEffect(() => {
    leftBar.current = 0;
    setFirst(0);
    scrollToBar(0);
  }, [which]); // eslint-disable-line react-hooks/exhaustive-deps
  // more or fewer bars on screen (or a wider window): the bar at the left edge stays there
  useLayoutEffect(() => {
    scrollToBar(leftBar.current);
  }, [count, n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => scrollToBar(leftBar.current));
    ro.observe(sc);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the line follows the music every frame, without drawing the lane again. Which bars are on
  // screen is kept in a ref as the lane scrolls, so a frame never has to measure anything; the
  // lane is only scrolled when the music runs off the page.
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
    let turned = -1;
    const tick = () => {
      const x = where();
      if (x === null) hide();
      else {
        head.style.opacity = "1";
        head.style.left = `${(x * 100).toFixed(3)}%`;
        fill.style.transform = `scaleX(${x.toFixed(4)})`;
        const l = live$.current;
        const b = barAtFrac(x, l.n);
        // a whole page at a time, and only with Follow on (never a bar at a time, never while being
        // scrolled by hand); as on the grids, switching Follow on goes straight to the music
        if (b >= leftBar.current && b < leftBar.current + l.count) turned = -1;
        else if (l.follow && b !== turned && performance.now() > held.current + HOLD_MS) {
          turned = b;
          scrollToBar(pageStart(b, l.count, l.n));
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
    scrollToBar(turnPage({ start: leftBar.current, count }, dir, n));
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
      {paged && <button className="btn sm dm-page" aria-label="Earlier bars" disabled={first === 0} onClick={() => page(-1)}>‹</button>}
      <div className="take-lane" role="group" aria-label="Takes in the bars recorded over" style={{ ["--rows" as string]: rows }}>
        {/* how far through the loop the music is, across the lane as it stands, whichever bars are on screen */}
        <div className="tl-fill" ref={fillRef} />
        <div className="tl-scroll" ref={scrollRef} onWheel={hold} onPointerDown={hold} onTouchStart={hold}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (!el.clientWidth) return;
            leftBar.current = scrolledWindow(el.scrollLeft, el.clientWidth, count, n).start;
            setFirst(leftBar.current);
          }}>
          {/* as wide as all the bars, at the width the bars on screen share */}
          <div className="tl-inner" style={{ width: `${(n / count) * 100}%` }}>
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
                // in bars as the lane has them, so a take that runs on into a bar of another meter is drawn to where it ends
                const w = barsInto(bars, takeBars(take, bpm, 1), i);
                const cls = `tl-take${take.keep ? " keep" : ""}`;
                const style = { left: `${(i / n) * 100}%`, width: `${(Math.max(0.15, w) / n) * 100}%`, top: r * 18 };
                // (where a take cannot be played on its own, in the browser, it is only shown)
                return onPick ? (
                  <button key={take.id} className={cls} style={style} title="Hear it alone" aria-label={`${label}: hear it alone`} onClick={() => onPick(take)}>
                    {label}
                  </button>
                ) : (
                  <span key={take.id} className={cls} style={style} title={label}>
                    {label}
                  </span>
                );
              })}
            </div>
            <div className="tl-head" ref={headRef} />
          </div>
        </div>
        {placed.length > drawn.length && <span className="tl-more">+{placed.length - drawn.length}</span>}
      </div>
      {paged && <button className="btn sm dm-page" aria-label="Later bars" disabled={first + count >= n} onClick={() => page(1)}>›</button>}
    </div>
  );
}
