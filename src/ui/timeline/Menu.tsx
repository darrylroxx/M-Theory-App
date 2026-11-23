// One small menu, used by a track's ⋯, a clip, the ruler, a marker and an empty lane.
// It opens at the pointer, stays inside the screen, and closes on Escape, on a press anywhere else, or once a line
// is chosen. Up and Down move through its lines, Enter chooses.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { letterClass } from "../letters";
import { ESC_OPEN, onEscape } from "./keys";

export type MenuItem =
  | { label: string; run(): void; /** the key that does the same, written out */ hint?: string; disabled?: boolean; danger?: boolean; /** it is the one in force */ on?: boolean;
      /** small live meters beside the line (an input's level; two for a stereo pair): each is asked every frame for a value 0 to 1 */
      levels?: (() => number)[] }
  | { sep: true }
  | { title: string }
  /** a slider in the menu (a track's volume on a phone): it does not close the menu; `text` says the value beside it */
  | { range: { label: string; min: number; max: number; step: number; value: number; set(v: number): void; text(v: number): string; /** a button beside it that puts it back to this */ reset?: number } }
  /** a row of the eight colours */
  | { colours: true; now?: number; pick(n: number): void };

export interface MenuAt { x: number; y: number }

/** A slider line of a menu: it keeps its own value while it is dragged, and tells the menu's owner each one. */
function MenuRange({ r }: { r: Extract<MenuItem, { range: unknown }>["range"] }) {
  const [v, setV] = useState(r.value);
  const to = (n: number) => {
    setV(n);
    r.set(n);
  };
  return (
    <label className="tlv-menu-range">
      <span>{r.label}</span>
      <input type="range" min={r.min} max={r.max} step={r.step} value={v} aria-label={r.label} onChange={(e) => to(Number(e.target.value))} />
      <output className="mono">{r.text(v)}</output>
      {r.reset !== undefined && <button className="tlv-menu-reset" aria-label={`${r.label}: back to ${r.text(r.reset)}`} disabled={v === r.reset} onClick={() => to(r.reset!)}>↺</button>}
    </label>
  );
}

export function Menu({ at, items, label, onClose, back }: { at: MenuAt; items: MenuItem[]; label: string; onClose(): void; /** the phone's menu: the screen behind it is dimmed, and a press there only puts the menu away */ back?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  /** when it opened: the click of the very press that opened it (a finger let go of a clip) lands on the dimmed screen, and is not a press beside the menu */
  const born = useRef(0);
  if (!born.current && typeof performance !== "undefined") born.current = performance.now();
  // inside the screen: it opens down and to the right of the pointer, and is moved back in where it would not fit
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(at.x, window.innerWidth - r.width - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(at.y, window.innerHeight - r.height - 4))}px`;
    el.focus({ preventScroll: true });
  }, [at.x, at.y, items.length]);
  useEffect(() => {
    const away = (e: Event) => {
      // (the phone's dimmed screen behind the menu closes it on the click that follows, so nothing under it is pressed)
      if (e.target instanceof Element && e.target.classList.contains("tlv-menu-back")) return;
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) onClose();
    };
    const off = onEscape(ESC_OPEN, () => (onClose(), true));
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      off();
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  // the small meters of its lines (an input list): moved every frame while it is open, never drawn again
  const live = useRef(items);
  live.current = items;
  const metered = items.some((it) => "levels" in it && !!it.levels?.length);
  useEffect(() => {
    if (!metered) return;
    let raf = 0;
    const tick = () => {
      const fns = live.current.flatMap((it) => ("levels" in it && it.levels ? it.levels : []));
      ref.current?.querySelectorAll<HTMLElement>(".tlv-menu-lv b").forEach((el, i) => {
        el.style.transform = `scaleX(${Math.max(0, Math.min(1, fns[i]?.() ?? 0)).toFixed(3)})`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [metered]);
  const step = (dir: 1 | -1) => {
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled):not(.tlv-menu-reset)") ?? [])];
    if (!all.length) return;
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(i + dir + all.length) % all.length]?.focus();
  };
  return (
    <>
    {back && <div className="tlv-menu-back" aria-hidden="true" onClick={(e) => { e.stopPropagation(); if (performance.now() - born.current > 350) onClose(); }} />}
    <div className="tlv-menu" ref={ref} role="menu" aria-label={label} tabIndex={-1} data-keys="own" style={{ left: at.x, top: at.y }}
      onContextMenu={(e) => e.preventDefault()}
      // (a finger let go of a clip opens this menu under itself: the click of that very letting go must not choose a line)
      onClickCapture={(e) => { if (back && performance.now() - born.current < 350) { e.stopPropagation(); e.preventDefault(); } }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
      }}>
      {items.map((it, i) =>
        "sep" in it ? <hr key={i} />
        : "title" in it ? <div key={i} className="tlv-menu-title">{it.title}</div>
        : "range" in it ? <MenuRange key={i} r={it.range} />
        : "colours" in it ? (
          <div key={i} className="tlv-menu-colours" role="group" aria-label="Colour">
            {Array.from({ length: 8 }, (_, n) => (
              <button key={n} role="menuitemradio" aria-checked={it.now === n} aria-label={`Colour ${n + 1}`} className={`tlv-swatch ${letterClass(n)}${it.now === n ? " on" : ""}`} onClick={() => { it.pick(n); onClose(); }} />
            ))}
          </div>
        ) : (
          <button key={i} role="menuitem" className={`tlv-menu-item${it.danger ? " danger" : ""}${it.on ? " on" : ""}`} disabled={it.disabled} onClick={() => { onClose(); it.run(); }}>
            <span>{it.label}</span>
            {it.hint && <kbd>{it.hint}</kbd>}
            {it.levels && it.levels.length > 0 && <i className="tlv-menu-lvs" aria-hidden="true">{it.levels.map((_, k) => <i key={k} className="tlv-menu-lv"><b /></i>)}</i>}
          </button>
        ),
      )}
    </div>
    </>
  );
}
