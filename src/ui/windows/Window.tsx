// A plugin window: a box that floats over the track view, with a title bar, a body that scrolls, and room for a
// strip along the bottom. It is dragged by its title bar and cannot leave the screen; a press anywhere in it brings
// it to the front. On a narrow screen, or under a finger, the same window is a sheet across the bottom.
import { useRef, type ReactNode } from "react";
import type { WinState } from "../../timeline/model";
import "../timeline.css";
import { WinFocus, keepInside, useSheet } from "./windows";

type Rect = Pick<WinState, "x" | "y" | "w" | "h">;

export function Window({ win, title, tools, children, strip, focused, onFocus, onClose, onMove, z }: {
  win: WinState;
  title: string;
  /** what stands in the title bar before ✕ */
  tools?: ReactNode;
  children: ReactNode;
  /** a strip along the bottom, below the body */
  strip?: ReactNode;
  focused: boolean;
  onFocus(): void;
  onClose(): void;
  onMove(r: Rect): void;
  /** where it is in the stack (45 at the back to 59 in front) */
  z?: number;
}) {
  const sheet = useSheet();
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x0: number; y0: number; dx: number; dy: number } | null>(null);
  const view = typeof window === "undefined" ? { w: 1280, h: 800 } : { w: window.innerWidth, h: window.innerHeight };
  const at = keepInside(win, view);

  const down = (e: React.PointerEvent<HTMLElement>) => {
    // (a button or a switch in the title bar is pressed, not dragged)
    if (e.button > 0 || (e.target as Element).closest("button, input, select, a, [data-nodrag]")) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* (a pretend pointer) */
    }
    drag.current = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const el = box.current;
    if (!d || d.pointer !== e.pointerId || !el) return;
    const to = keepInside({ ...at, x: at.x + e.clientX - d.x0, y: at.y + e.clientY - d.y0 }, { w: window.innerWidth, h: window.innerHeight });
    d.dx = to.x - at.x;
    d.dy = to.y - at.y;
    el.style.transform = `translate(${d.dx}px, ${d.dy}px)`;
  };
  const up = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    if (box.current) box.current.style.transform = "";
    if (d.dx || d.dy) onMove({ x: at.x + d.dx, y: at.y + d.dy, w: at.w, h: at.h });
  };

  const head = (
    <header className="tlw-bar" {...(sheet ? {} : { onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up })}>
      <h2 className="tlw-title" title={title}>{title}</h2>
      <span className="tlw-tools">{tools}</span>
      <button className="tlw-x" aria-label={`Close ${title}`} title="Close (Esc)" onClick={onClose}>✕</button>
    </header>
  );
  return (
    <WinFocus.Provider value={focused}>
      <div ref={box} className={`tlw${sheet ? " tlw-sheet sheet" : ""}${focused ? " focused" : ""}`} role="dialog" aria-label={title} data-keys="own" data-win={win.id} tabIndex={-1}
        style={sheet ? { zIndex: z } : { left: at.x, top: at.y, width: at.w, height: at.h, zIndex: z }}
        onPointerDownCapture={() => { if (!focused) onFocus(); }}>
        {head}
        <div className="tlw-body">{children}</div>
        {strip && <div className="tlw-strip">{strip}</div>}
      </div>
    </WinFocus.Provider>
  );
}
