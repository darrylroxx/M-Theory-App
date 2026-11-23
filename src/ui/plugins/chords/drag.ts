// Dragging a chord into the tray: from a card or a pill of the board, from a shape of the shape finder, or a slot of
// the tray to another place in its row. It starts after a few pixels (a long press on a touch screen), a ghost
// follows the pointer, and the tray shows where the chord would land. The click that ends a drag is not a tap.
// (The drag engine of the old Chords page, for a tray that is always in view.)
import type { DragApi, Payload } from "../../drag";

/**
 * Where among the chords of the tray a point is: how many of them come before it. `boxes`: where each chord is drawn,
 * in the order they are played, row after row.
 */
export function placeIn(boxes: readonly { left: number; top: number; width: number; bottom: number }[], x: number, y: number): number {
  if (!boxes.length) return 0;
  // (above the first row counts as on it, under the last as on that one)
  const at = Math.min(Math.max(y, boxes[0].top), boxes[boxes.length - 1].bottom - 1);
  let i = 0;
  for (const b of boxes) {
    if (at < b.top) break;
    if (at < b.bottom && x < b.left + b.width / 2) break;
    i++;
  }
  return i;
}

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
    // the place in the row: before the first chord whose middle is right of the pointer. In a tall window the chords
    // go on to more rows: a chord on a row under the pointer comes after it, one on a row above comes before it.
    const boxes = [...dock.querySelectorAll<HTMLElement>("[data-slot]")].filter((el) => el.dataset.slot !== exclude).map((el) => el.getBoundingClientRect());
    return placeIn(boxes, x, y);
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
