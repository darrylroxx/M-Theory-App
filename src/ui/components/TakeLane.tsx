import { useEffect, useRef } from "react";
import { takeBars, type Take } from "../../song/takes";

/** One bar of what a recording goes round: its section, which of its bars, its letter, its beats. */
export interface LaneBar {
  block: string;
  bar: number;
  letter: string;
  beats: number;
}

/** At most this many recordings are drawn one above another; the rest are counted. */
const ROWS = 4;

/**
 * The bars a recording goes round (the loop, or the section on screen), across the whole
 * width, with the take that plays from each recording drawn where it sits, and a line that
 * moves with the music while it plays or records. A thin line along the top fills as each
 * pass goes by. Tap a take to hear it alone.
 */
export function TakeLane({ bars, takes, bpm, where, live, onPick }: {
  bars: LaneBar[];
  /** the takes to draw (the one that plays from each recording, newest first), with a short label */
  takes: { take: Take; label: string }[];
  bpm: number;
  /** how far across the lane the music is (0..1), or null when it is not in these bars */
  where: () => number | null;
  /** the music is going: move the line */
  live: boolean;
  onPick?: (t: Take) => void;
}) {
  const headRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const n = Math.max(1, bars.length);
  // the line follows the music every frame, without drawing the lane again
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
    const tick = () => {
      const x = where();
      if (x === null) hide();
      else {
        head.style.opacity = "1";
        head.style.left = `${(x * 100).toFixed(3)}%`;
        fill.style.transform = `scaleX(${x.toFixed(4)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); hide(); };
  }, [live, where]);

  const index = (block: string, bar: number) => bars.findIndex((b) => b.block === block && b.bar === bar);
  const placed = takes
    .map(({ take, label }) => ({ take, label, i: index(take.at.block, take.at.bar) }))
    .filter((x) => x.i >= 0);
  const drawn = placed.slice(0, ROWS);
  const rows = Math.max(1, drawn.length);
  // on a narrow lane, only every so many bars is numbered (and each section's first)
  const step = Math.max(1, Math.ceil(bars.length / 16));
  return (
    <div className="take-lane" role="group" aria-label="Takes in the bars recorded over" style={{ ["--rows" as string]: rows }}>
      <div className="tl-fill" ref={fillRef} />
      <div className="tl-bars">
        {bars.map((b, i) => {
          const starts = i === 0 || bars[i - 1].block !== b.block;
          return (
            <span key={`${b.block}:${b.bar}`} className={`tl-bar${starts ? " sec" : ""}`}>
              {(starts || i % step === 0) && <i>{starts ? `${b.letter}${b.bar + 1}` : b.bar + 1}</i>}
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
        {placed.length > drawn.length && <span className="tl-more">+{placed.length - drawn.length}</span>}
      </div>
      <div className="tl-head" ref={headRef} />
    </div>
  );
}
