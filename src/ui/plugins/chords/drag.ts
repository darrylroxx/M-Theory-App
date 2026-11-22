// Dragging a chord into the tray: from a card or a pill of the board, from a shape of the shape finder, or a slot of
// the tray to another place in its row. It starts after a few pixels (a long press on a touch screen), a ghost
// follows the pointer, and the tray shows where the chord would land. The click that ends a drag is not a tap.
// (The engine of the old Chords page, views/GuitarView: `dragApi`, for a tray that is always in view.)
import type { DragApi, Payload } from "../../drag";

/** What is being dragged, and where in the row it would land now (null: outside the tray). */
export type ChordDrag = Payload & { index: number | null };

export function chordDrag({ dockRef, ghostRef, lastDrag, setDrag, drop }: {
  dockRef: React.RefObject<HTMLDivElement | null>;
  ghostRef: React.RefObject<HTMLDivElement | null>;
  lastDrag: React.RefObject<number>;
  setDrag: (d: ChordDrag | null) => void;
  drop: (p: Payload, index: number | null) => void;
}): DragApi {
  const indexAt = (x: number, y: number, exclude?: string): number | null => {
    const dock = dockRef.current;
    if (!dock) return null;
    const r = dock.getBoundingClientRect();
    if (y < r.top - 28 || y > r.bottom + 28 || x < r.left - 28 || x > r.right + 28) return null;
    const scroller = dock.querySelector<HTMLElement>(".dock-slots");
    if (scroller) {
      const sr = scroller.getBoundingClientRect();
      if (x > sr.right - 36) scroller.scrollLeft += 14;
      else if (x < sr.left + 36) scroller.scrollLeft -= 14;
    }
    let i = 0;
    for (const el of dock.querySelectorAll<HTMLElement>("[data-slot]")) {
      if (el.dataset.slot === exclude) continue;
      const b = el.getBoundingClientRect();
      if (x < b.left + b.width / 2) break;
      i++;
    }
    return i;
  };
  return {
    justDragged: () => Date.now() - lastDrag.current < 150,
    start: (e, payload) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
      const touch = e.pointerType !== "mouse";
      const pid = e.pointerId;
      const sx = e.clientX;
      const sy = e.clientY;
      let active = false;
      let index: number | null = null;
      let timer: number | undefined;
      const moveGhost = (x: number, y: number) => {
        if (ghostRef.current) ghostRef.current.style.transform = `translate(${x}px, ${y}px)`;
      };
      const activate = (x: number, y: number) => {
        active = true;
        index = indexAt(x, y, payload.slotId);
        setDrag({ ...payload, index });
        requestAnimationFrame(() => moveGhost(x, y));
        if (touch) navigator.vibrate?.(8);
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        document.removeEventListener("touchmove", onTouchMove);
      };
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        if (!active) {
          const far = Math.hypot(ev.clientX - sx, ev.clientY - sy);
          if (touch) {
            if (far > 10) cleanup(); // it's a scroll, not a drag
            return;
          }
          if (far < 6) return;
          activate(ev.clientX, ev.clientY);
        }
        moveGhost(ev.clientX, ev.clientY);
        const next = indexAt(ev.clientX, ev.clientY, payload.slotId);
        if (next !== index) {
          index = next;
          setDrag({ ...payload, index });
        }
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pid) return;
        cleanup();
        if (!active) return;
        lastDrag.current = Date.now();
        setDrag(null);
        drop(payload, index);
      };
      const onCancel = () => {
        cleanup();
        if (active) lastDrag.current = Date.now();
        setDrag(null);
      };
      // once a drag is live, stop the page from scrolling under the finger
      const onTouchMove = (ev: TouchEvent) => {
        if (active && ev.cancelable) ev.preventDefault();
      };
      if (touch) timer = window.setTimeout(() => activate(sx, sy), 230);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      document.addEventListener("touchmove", onTouchMove, { passive: false });
    },
  };
}
