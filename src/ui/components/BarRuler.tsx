import { useEffect, useRef, useState } from "react";
import { pageStart, shownCount, type BarsShown } from "../../song/window";
import { chordSymbol } from "../../theory/chords";
import { MAX_BEATS, MIN_BEATS, fitBeats, type ProgChord } from "../state";

/** "2 beats", "1½ beats", "1 bar", "2 bars". */
export function lengthText(beats: number, bar: number): string {
  if (beats >= bar && beats % bar === 0) return beats === bar ? "1 bar" : `${beats / bar} bars`;
  const whole = Math.floor(beats);
  const half = beats % 1 ? "½" : "";
  return `${whole || ""}${half} beat${beats > 1 ? "s" : ""}`;
}

/**
 * The section drawn to scale: every chord as wide as it is long, with a line at each bar.
 * Drag the edge between two chords to move where the change falls; tap a chord to set its length exactly.
 * The ruler is as long as the section: bars with no chord in them are drawn empty (they are silent),
 * and whatever lies past the end of the section is struck out. As many bars as are chosen fill
 * the width; the rest is reached by scrolling it sideways.
 */
export function BarRuler({ chords, bar, length, letter, onFit, nowIdx, onChange, shown = 0, follow = false }: {
  chords: ProgChord[];
  /** beats in a bar */
  bar: number;
  /** how long the section lasts, in beats */
  length: number;
  /** the section's letter */
  letter: string;
  /** make the section this many bars long (offered when the chords run past its end) */
  onFit: (bars: number) => void;
  /** the chord that is sounding (−1 = none) */
  nowIdx: number;
  /** new lengths, by chord id */
  onChange: (beats: Record<string, number>) => void;
  /** bars across the width (0 = all of them) */
  shown?: BarsShown;
  /** while the music plays, the ruler turns a page to the chord that is sounding */
  follow?: boolean;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const row = useRef<HTMLDivElement>(null);
  const moved = useRef(0);
  const total = chords.reduce((a, c) => a + c.beats, 0);
  const bars = Math.max(1, Math.ceil(Math.max(total, length) / bar - 1e-6));
  const span = bars * bar;
  const across = shownCount(shown, bars);
  // with Follow on, the page with the sounding chord's first bar is brought into view (sideways only)
  useEffect(() => {
    const el = row.current;
    const sc = el?.parentElement;
    if (!follow || nowIdx < 0 || !el || !sc || el.offsetWidth <= sc.clientWidth + 1) return;
    const from = chords.slice(0, nowIdx).reduce((a, c) => a + c.beats, 0);
    const per = el.offsetWidth / bars;
    const x = Math.floor(from / bar + 1e-6) * per;
    if (x < sc.scrollLeft - 1 || x >= sc.scrollLeft + sc.clientWidth - 1) sc.scrollLeft = pageStart(Math.floor(from / bar + 1e-6), across, bars) * per;
  }, [nowIdx, follow]); // eslint-disable-line react-hooks/exhaustive-deps
  const rest = Math.max(0, span - total);
  const over = total > length + 1e-6;
  const nameOf = (c: ProgChord) => (c.rest ? "Rest" : chordSymbol(c.ref));
  const picked = chords.find((c) => c.id === sel);
  useEffect(() => {
    if (sel && !chords.some((c) => c.id === sel)) setSel(null);
  }, [chords, sel]);

  const drag = (e: React.PointerEvent, i: number) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = row.current;
    if (!el) return;
    const perBeat = el.getBoundingClientRect().width / (bars * bar);
    const x0 = e.clientX;
    const a = chords[i];
    const b = chords[i + 1];
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let last = 0;
    const move = (ev: PointerEvent) => {
      let d = Math.round(((ev.clientX - x0) / perBeat) * 2) / 2;
      // between two chords the edge moves and the two share the time; the last chord simply grows or shrinks
      d = b ? Math.max(MIN_BEATS - a.beats, Math.min(b.beats - MIN_BEATS, d)) : Math.max(MIN_BEATS - a.beats, Math.min(MAX_BEATS - a.beats, d));
      if (d === last) return;
      last = d;
      moved.current = Date.now();
      onChange(b ? { [a.id]: a.beats + d, [b.id]: b.beats - d } : { [a.id]: a.beats + d });
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const set = (c: ProgChord, beats: number) => onChange({ [c.id]: fitBeats(beats) });
  const quick = [...new Set([1, bar / 2, bar, bar * 2])].filter((n) => n >= MIN_BEATS && n <= MAX_BEATS && (n * 2) % 1 === 0);

  return (
    <div className="ruler-wrap" data-nodrag>
      <div className="ruler-scroll">
        <div className="ruler" ref={row} style={{ "--beats": bars * bar, "--bar": bar, "--bars": bars, "--across": across } as React.CSSProperties} role="group" aria-label="Chord lengths">
          {chords.map((c, i) => (
            <span key={c.id} className={`ruler-block${c.rest ? " rest" : ""}${sel === c.id ? " on" : ""}${nowIdx === i ? " now" : ""}`} style={{ flexGrow: c.beats }}>
              <button className="ruler-name" aria-pressed={sel === c.id} aria-label={`${nameOf(c)}, ${lengthText(c.beats, bar)}. Change its length`}
                onClick={() => Date.now() - moved.current > 250 && setSel(sel === c.id ? null : c.id)}>{nameOf(c)}</button>
              <i className="ruler-grip" title={i < chords.length - 1 ? "Drag to move where the chord changes" : "Drag to make the last chord longer or shorter"} onPointerDown={(e) => drag(e, i)} />
            </span>
          ))}
          {rest > 0 && <span className="ruler-rest" style={{ flexGrow: rest }} title="Empty: nothing plays here" />}
          {Array.from({ length: bars - 1 }, (_, k) => <i key={k} className="ruler-line" style={{ left: `${((k + 1) / bars) * 100}%` }} />)}
          {over && <i className="ruler-cut" style={{ left: `${(length / span) * 100}%`, right: `${(rest / span) * 100}%` }} title={`${letter} ends here`} />}
        </div>
      </div>
      {over && (
        <button className="ruler-fit" onClick={() => onFit(Math.ceil(total / bar - 1e-6))}>
          {letter} ends before these chords do · make it {Math.ceil(total / bar - 1e-6)} bars
        </button>
      )}
      {picked && (
        <div className="ruler-edit" role="group" aria-label={`Length of ${nameOf(picked)}`}>
          <b>{nameOf(picked)}</b>
          <span className="beats">
            <button aria-label="Shorter" disabled={picked.beats <= MIN_BEATS} onClick={() => set(picked, picked.beats - 0.5)}>−</button>
            <span>{lengthText(picked.beats, bar)}</span>
            <button aria-label="Longer" disabled={picked.beats >= MAX_BEATS} onClick={() => set(picked, picked.beats + 0.5)}>+</button>
          </span>
          {quick.map((n) => (
            <button key={n} className={`chip${picked.beats === n ? " on" : ""}`} aria-pressed={picked.beats === n} onClick={() => set(picked, n)}>{n === bar / 2 && n !== 1 ? "½ bar" : lengthText(n, bar)}</button>
          ))}
          <button className="icon-btn" aria-label="Done" onClick={() => setSel(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
