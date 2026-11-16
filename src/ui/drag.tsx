import { createContext, useContext, type PointerEvent as ReactPointerEvent } from "react";
import type { ChordRef } from "../theory/chords";

/** What is being dragged: a chord (optionally one exact shape), or a chord already in the tray. */
export interface Payload {
  ref: ChordRef;
  voicingId?: string;
  slotId?: string;
}

export interface DragApi {
  start: (e: ReactPointerEvent, p: Payload) => void;
  /** true right after a drag, so the click that ends it is ignored */
  justDragged: () => boolean;
}

export const DragCtx = createContext<DragApi | null>(null);

/** Props that make an element draggable into the tray (mouse: drag; touch: press and hold) and tappable. */
export function useDraggable(payload: Payload, onTap: () => void) {
  const api = useContext(DragCtx)!;
  return {
    onPointerDown: (e: ReactPointerEvent) => api.start(e, payload),
    onClick: () => { if (!api.justDragged()) onTap(); },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}
