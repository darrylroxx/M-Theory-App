// The small picture of the whole range that stands beside the note grid of the Melody and Bass composer: every
// octave the grid has from top to bottom, a mark for every note of the clip where it lies, and a box round the rows
// that are in view. A press on it brings that part of the range into view; the box can be dragged. At its two ends,
// the two buttons that move the view a whole octave.
//
// It only shows and asks: the grid moves the view, and moves the box as it scrolls (so nothing here is drawn again
// while the grid scrolls).
import { memo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { MelodyNote, MelodyRow } from "../../../song/melody";
import { displayNote } from "../../../theory/notes";
import { octaveOf, rowAt } from "./range";

export const Overview = memo(function Overview({ rows, notes, ticks, size, rootRef, viewRef, onOctave, onGo, onWheel }: {
  /** the grid's rows, highest first */
  rows: MelodyRow[];
  notes: readonly MelodyNote[];
  /** how long what is open is, and how long one square of the grid is, in twelfths of a beat */
  ticks: number;
  size: number;
  /** the rail itself: the grid marks on it whether notes lie above or below what is in view */
  rootRef: RefObject<HTMLDivElement | null>;
  /** the box round what is in view: the grid moves it */
  viewRef: RefObject<HTMLElement | null>;
  /** the view a whole octave up (1) or down (-1) */
  onOctave(dir: 1 | -1): void;
  /** bring a place of the range into view: 0 is the top row, 1 the bottom one. `glide`: move there smoothly (a press), or at once (a drag) */
  onGo(at: number, glide: boolean): void;
  /** the wheel turned over the overview: the grid scrolls as if it had been turned over the grid */
  onWheel(dy: number): void;
}) {
  const drag = useRef<number | null>(null);
  const n = Math.max(1, rows.length);
  const at = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = (e.currentTarget.firstElementChild ?? e.currentTarget).getBoundingClientRect();
    return r.height > 0 ? Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) : 0;
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button > 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* (a pretend pointer) */
    }
    drag.current = e.pointerId;
    onGo(at(e), true);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current === e.pointerId) onGo(at(e), false);
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current === e.pointerId) drag.current = null;
  };
  const w = Math.max(1, ticks);
  return (
    <div className="mel-rail" ref={rootRef} onWheel={(e) => onWheel(e.deltaY)}>
      <button className="mel-oct up" aria-label="Show an octave higher" title="Show an octave higher (Page Up)" onClick={() => onOctave(1)}><span aria-hidden="true">▲</span></button>
      <div className="mel-map" title="The whole range: press where you want to be" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="mel-map-in">
          <svg viewBox={`0 0 100 ${n}`} preserveAspectRatio="none" aria-hidden="true">
            {rows.map((r, i) => (r.home ? <rect key={r.midi} className="mel-map-home" x={0} y={i} width={100} height={1} /> : null))}
            {notes.map((x, i) => {
              const row = rowAt(rows, x.midi);
              const left = Math.max(0, Math.min(98, (x.at / w) * 100));
              const wide = Math.max(4, ((x.len ?? size) / w) * 100);
              return <rect key={i} className="mel-map-note" x={left} y={row - 0.4} width={Math.min(100 - left, wide)} height={1.8} />;
            })}
          </svg>
          {rows.map((r, i) => (r.home ? <span key={r.midi} className="mel-map-oct" style={{ top: `${((i + 0.5) / n) * 100}%` }} aria-hidden="true">{displayNote(r.name)}{octaveOf(r.midi)}</span> : null))}
          <i className="mel-view" ref={viewRef} />
        </div>
      </div>
      <button className="mel-oct down" aria-label="Show an octave lower" title="Show an octave lower (Page Down)" onClick={() => onOctave(-1)}><span aria-hidden="true">▼</span></button>
    </div>
  );
});
