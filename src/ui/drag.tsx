import { createContext, useContext, type PointerEvent as ReactPointerEvent } from "react";
import type { ChordRef } from "../theory/chords";
import type { ClipKind } from "../timeline/model";

/** What is being dragged into the tray: a chord (optionally one exact shape), or a chord already in the tray. */
export interface Payload {
  type?: "chord";
  ref: ChordRef;
  voicingId?: string;
  slotId?: string;
}

/**
 * What is dragged out of a composer's strip onto the timeline: what the composer has open (a placed clip, or with no
 * `clip` its track's draft), and the kind of clip it is. Only a lane that takes clips of that kind lets it land.
 */
export interface ClipPayload {
  type: "clip";
  kind: ClipKind;
  from: { track: string; clip?: string };
}

/** Anything that can be dragged: a chord into the tray, or a composer's clip onto a lane. */
export type AnyPayload = Payload | ClipPayload;

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
