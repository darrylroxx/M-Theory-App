// A plugin window: a box that floats over the track view, with a title bar, a body that scrolls, and room for a
// strip along the bottom. It is dragged by its title bar and made larger or smaller by its bottom-right corner, and
// cannot leave the screen; a press anywhere in it brings it to the front. Closed, it is only hidden: what is inside
// stays as it was left. On a narrow screen, or under a finger, the same window is a sheet across the bottom.
import { useRef, type ReactNode } from "react";
import type { WinState } from "../../timeline/model";
import "../timeline.css";
import { WinFocus, keepInside, resized, useSheet } from "./windows";

type Rect = Pick<WinState, "x" | "y" | "w" | "h">;

export function Window({ win, title, icon, tools, children, strip, focused, hidden, onFocus, onClose, onMove, z }: {
  win: WinState;
  title: string;
  /** a small picture before the title: the kind of track it is */
  icon?: ReactNode;
  /** what stands in the title bar before ✕ */
  tools?: ReactNode;
  children: ReactNode;
  /** a strip along the bottom, below the body */
  strip?: ReactNode;
  focused: boolean;
  /** closed: off the screen, with everything inside it kept */
  hidden?: boolean;
  onFocus(): void;
  onClose(): void;
  /** it was moved, or given another size */
  onMove(r: Rect): void;
  /** where it is in the stack (45 at the back to 59 in front) */
  z?: number;
}) {
  const sheet = useSheet();
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x0: number; y0: number; dx: number; dy: number; size: boolean } | null>(null);
  const view = typeof window === "undefined" ? { w: 1280, h: 800 } : { w: window.innerWidth, h: window.innerHeight };
  const at = keepInside(win, view);

  const grab = (e: React.PointerEvent<HTMLElement>, size: boolean) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* (a pretend pointer) */
    }
    drag.current = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, size };
  };
  const down = (e: React.PointerEvent<HTMLElement>) => {
    // (a button or a switch in the title bar is pressed, not dragged)
    if (e.button > 0 || (e.target as Element).closest("button, input, select, a, [data-nodrag]")) return;
    grab(e, false);
  };
  const corner = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button > 0) return;
    e.stopPropagation();
    grab(e, true);
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const el = box.current;
    if (!d || d.pointer !== e.pointerId || !el) return;
    const screen = { w: window.innerWidth, h: window.innerHeight };
    if (d.size) {
      // the corner: the box itself is made that size while it is dragged, and what is inside lays itself out again
      const to = resized(at, e.clientX - d.x0, e.clientY - d.y0, screen);
      d.dx = to.w - at.w;
      d.dy = to.h - at.h;
      el.style.width = `${to.w}px`;
      el.style.height = `${to.h}px`;
      return;
    }
    const to = keepInside({ ...at, x: at.x + e.clientX - d.x0, y: at.y + e.clientY - d.y0 }, screen);
    d.dx = to.x - at.x;
    d.dy = to.y - at.y;
    el.style.transform = `translate(${d.dx}px, ${d.dy}px)`;
  };
  const up = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    if (box.current) box.current.style.transform = "";
    if (!d.dx && !d.dy) return;
    onMove(d.size ? { x: at.x, y: at.y, w: at.w + d.dx, h: at.h + d.dy } : { x: at.x + d.dx, y: at.y + d.dy, w: at.w, h: at.h });
  };
  const handlers = { onPointerMove: move, onPointerUp: up, onPointerCancel: up };

  const head = (
    <header className="tlw-bar" {...(sheet ? {} : { onPointerDown: down, ...handlers })}>
      {icon && <span className="tlw-icon" aria-hidden="true">{icon}</span>}
      <h2 className="tlw-title" title={title}>{title}</h2>
      <span className="tlw-tools">{tools}</span>
      <button className="tlw-x" aria-label={`Close ${title}`} title="Close (Esc)" onClick={onClose}>✕</button>
    </header>
  );
  return (
    <WinFocus.Provider value={focused && !hidden}>
      <div ref={box} className={`tlw${sheet ? " tlw-sheet sheet" : ""}${focused ? " focused" : ""}`} role="dialog" aria-label={title} aria-hidden={hidden || undefined} hidden={hidden} data-keys="own" data-win={win.id} tabIndex={-1}
        style={sheet ? { zIndex: z } : { left: at.x, top: at.y, width: at.w, height: at.h, zIndex: z }}
        onPointerDownCapture={() => { if (!focused) onFocus(); }}>
        {head}
        <div className="tlw-body">{children}</div>
        {strip && <div className="tlw-strip">{strip}</div>}
        {!sheet && <i className="tlw-size" title="Drag to make the window larger or smaller" onPointerDown={corner} {...handlers} />}
      </div>
    </WinFocus.Provider>
  );
}
