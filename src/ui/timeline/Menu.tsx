// One small menu, used by a track's ⋯, a clip, the ruler, a marker and an empty lane.
// It opens at the pointer, stays inside the screen, and closes on Escape, on a press anywhere else, or once a line
// is chosen. Up and Down move through its lines, Enter chooses.
import { useEffect, useLayoutEffect, useRef } from "react";
import { letterClass } from "../letters";
import { ESC_OPEN, onEscape } from "./keys";

export type MenuItem =
  | { label: string; run(): void; /** the key that does the same, written out */ hint?: string; disabled?: boolean; danger?: boolean; /** it is the one in force */ on?: boolean;
      /** small live meters beside the line (an input's level; two for a stereo pair): each is asked every frame for a value 0 to 1 */
      levels?: (() => number)[] }
  | { sep: true }
  | { title: string }
  /** a row of the eight colours */
  | { colours: true; now?: number; pick(n: number): void };

export interface MenuAt { x: number; y: number }

export function Menu({ at, items, label, onClose }: { at: MenuAt; items: MenuItem[]; label: string; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
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
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (!all.length) return;
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(i + dir + all.length) % all.length]?.focus();
  };
  return (
    <div className="tlv-menu" ref={ref} role="menu" aria-label={label} tabIndex={-1} data-keys="own" style={{ left: at.x, top: at.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); step(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
      }}>
      {items.map((it, i) =>
        "sep" in it ? <hr key={i} />
        : "title" in it ? <div key={i} className="tlv-menu-title">{it.title}</div>
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
            {it.levels && it.levels.length > 0 && <span className="tlv-menu-lvs" aria-hidden="true">{it.levels.map((_, k) => <i key={k} className="tlv-menu-lv"><b /></i>)}</span>}
          </button>
        ),
      )}
    </div>
  );
}
