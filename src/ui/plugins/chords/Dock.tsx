// The tray of the Chords plugin: the chords of what the window has open, in the order they are played. Each chord
// is a slot with its shape; under them the ruler draws them to scale (drag an edge to move where a chord changes),
// with "+ Rest" and "Clear". Over them: how the chords are laid out, "Arrange" for a guitar (each chord in the shape
// chosen for it, or all of them in one area of the neck) and "Voicing" for the keys. A chord dragged over the tray
// shows where it will land.
//
// Copied out of the old Chords page (views/GuitarView: `Dock`). In a plugin window the tray is always in view, so it
// needs no slim stand-in while it is off screen, and it does not lift up beside the shape finder: the finder opens
// in the board's place, next to it.
import { useEffect, useRef, type ReactNode } from "react";
import { VOICINGS, type Tone } from "../../../audio/tone";
import { fretSpan } from "../../../guitar/arrange";
import { POSITIONS } from "../../../guitar/shapeMap";
import type { Voicing } from "../../../guitar/voicings";
import type { BarsShown } from "../../../song/window";
import { BarRuler } from "../../components/BarRuler";
import { Seg } from "../../components/common";
import type { Payload } from "../../drag";
import { useApp, type ArrangeSettings } from "../../state";
import { Slot } from "./Slot";
import { addRest, clearChords } from "./tray";

export function Dock({ ref, head, voicings, keys, keyStyle, onKeyStyle, nowIdx, drag, onStep, onArrange, bar, onLengths, length, label, onFit, shown, follow, resetKey }: {
  ref: React.Ref<HTMLDivElement>;
  /** the row over the tray: how the clip is played, and Harmonize */
  head?: ReactNode;
  voicings: (Voicing | undefined)[];
  /** the track plays the keys: each chord's keys (null: it plays Guitar), how they are voiced, and a way to change that */
  keys: number[][] | null;
  keyStyle: NonNullable<Tone["voicing"]>;
  onKeyStyle: (v: NonNullable<Tone["voicing"]>) => void;
  nowIdx: number;
  drag: (Payload & { index: number | null }) | null;
  onStep: (i: number, dir: -1 | 1) => void;
  onArrange: (a: ArrangeSettings | null) => void;
  /** beats in a bar */
  bar: number;
  onLengths: (beats: Record<string, number>) => void;
  /** how long what is open lasts, in beats; what it is called; and a way to make it longer */
  length: number;
  label: string;
  onFit: (bars: number) => void;
  /** bars across the ruler (0 = all of them), and whether the view goes along with the music */
  shown: BarsShown;
  follow: boolean;
  /** changes when the window is put on something else: the ruler then opens at its first bar */
  resetKey: string;
}) {
  const { state, set } = useApp();
  const chords = state.progression.chords;
  const arr = state.progression.arrange ?? null;
  const span = fretSpan(voicings);
  // every keyboard in the tray shows the same stretch of keys, so the voice leading can be seen
  const all = keys?.flat() ?? [];
  const keySpan = all.length ? { lo: Math.min(...all), hi: Math.max(...all) } : undefined;
  // with Follow on, the chord that is sounding is kept in sight in its row (sideways only)
  const slotsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = slotsRef.current;
    const el = r?.querySelector<HTMLElement>(".slot.now");
    if (!follow || !r || !el) return;
    const a = el.getBoundingClientRect();
    const b = r.getBoundingClientRect();
    if (a.left < b.left || a.right > b.right) r.scrollLeft += a.left - b.left - 8;
  }, [nowIdx, follow]);
  const marker = <span key="marker" className="drop-marker" />;
  const els: ReactNode[] = [];
  let k = 0;
  chords.forEach((c, i) => {
    const isDragged = drag?.slotId === c.id;
    if (!isDragged) {
      if (drag && drag.index === k) els.push(marker);
      k++;
    }
    // a chord that starts after the end of what is open is never reached
    const out = chords.slice(0, i).reduce((a, x) => a + x.beats, 0) >= length - 1e-6;
    els.push(<Slot key={c.id} c={c} i={i} v={voicings[i]} keys={keys ? keys[i] ?? [] : undefined} keySpan={keySpan} now={nowIdx === i} dragged={isDragged} out={out} onStep={(d) => onStep(i, d)} />);
  });
  if (drag && drag.index !== null && drag.index >= k) els.push(marker);

  return (
    <div className={`dock cp-dock${chords.length ? "" : " bare"}${drag ? " armed" : ""}${drag?.index != null ? " over" : ""}`} ref={ref} role="group" aria-label="Your chords">
      <div className="dock-inner">
        {head}
        {keys && chords.length > 0 && (
          <div className="arrange">
            <span className="kb-label">Voicing</span>
            <div className="arrange-tools">
              <div className="seg" role="radiogroup" aria-label="How the chords are laid out on the keys">
                {VOICINGS.map((x) => <button key={x.id} role="radio" aria-checked={keyStyle === x.id} className={keyStyle === x.id ? "on" : ""} title={x.hint} onClick={() => onKeyStyle(x.id)}>{x.name}</button>)}
              </div>
            </div>
          </div>
        )}
        {!keys && chords.length >= 2 && (
          <div className="arrange">
            <span className="kb-label">Arrange</span>
            <div className="arrange-tools">
              <div className="seg" role="radiogroup" aria-label="Arrange all chords in one area of the neck">
                <button role="radio" aria-checked={!arr} className={arr ? "" : "on"} onClick={() => onArrange(null)}>My shapes</button>
                {POSITIONS.slice(0, 5).map((p, z) => (
                  <button key={p} role="radio" aria-checked={arr?.zone === z} className={arr?.zone === z ? "on" : ""} title={z === 0 ? "Open position" : `Around frets ${p}`}
                    onClick={() => onArrange({ strings: arr?.strings ?? "any", inversions: arr?.inversions ?? false, zone: z })}>{p}</button>
                ))}
              </div>
              {arr && (
                <>
                  <span className="kb-label">Strings</span>
                  <Seg value={arr.strings} options={[{ value: "any", label: "Any" }, { value: 3, label: "3" }, { value: 4, label: "4" }, { value: 5, label: "5–6" }]} onChange={(v) => onArrange({ ...arr, strings: v })} label="Strings per chord" />
                  <button className={`chip${arr.inversions ? " on" : ""}`} aria-pressed={arr.inversions} title="Allow a different bass note for smoother changes" onClick={() => onArrange({ ...arr, inversions: !arr.inversions })}>Inversions</button>
                </>
              )}
              {span && <span className="span">frets {span[0]}–{span[1]}</span>}
            </div>
          </div>
        )}
        <div className="dock-main">
          <div className="dock-slots" ref={slotsRef}>
            {chords.length === 0 && !drag ? <span className="dock-empty" aria-label="No chords yet">Add a chord with its +, or drag it here</span> : els}
            {chords.length === 0 && drag && drag.index === null && <span className="dock-empty">↓</span>}
          </div>
        </div>
        <div className="dock-foot">
          {/* (put on another clip, the ruler opens at its first bar, as the melody and the drums do) */}
          <BarRuler key={resetKey} chords={chords} bar={bar} length={length} label={label} onFit={onFit} nowIdx={nowIdx} onChange={onLengths} shown={shown} follow={follow} />
          <button className="rest-add" title="Add a bar of silence after the last chord" onClick={() => set(addRest())}>+ Rest</button>
          {chords.length > 0 && <button className="rest-add clear" title="Take every chord out" onClick={() => set(clearChords)}>Clear</button>}
        </div>
      </div>
    </div>
  );
}
