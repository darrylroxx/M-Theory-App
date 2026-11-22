// Dragging the clip a composer has open out of its strip and onto the timeline.
//
// The engine is the one chords are dragged into the tray with (it starts after a few pixels, or after a long press
// under a finger; a ghost follows the pointer, moved without drawing anything again; the click that ends a drag is
// swallowed), made for a clip: over a lane that takes the clip, the ghost is the clip's real length at the
// timeline's zoom and stands on the bar under the pointer; over anything else it only follows the pointer. Near the
// edges of the lanes time scrolls, and the track list scrolls up and down. Let go on a lane that takes it, a separate
// copy lands there; anywhere else, or on Escape, the ghost glides back and nothing changes.
//
// While a clip is dragged every plugin window lets the pointer through and turns see-through (all but the strip the
// drag came from), so every lane under a window can be reached. That is done with two class names, here.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { barMap } from "../../timeline/bars";
import type { NoteClip, TimelineSong } from "../../timeline/model";
import type { Key } from "../../theory/keys";
import type { ClipPayload } from "../drag";
import { letterClass } from "../letters";
import { ChordBlock, DrumBlock, MelodyBlock } from "../timeline/draw";
import { ESC_OPEN, onEscape } from "../timeline/keys";

/** A drag starts after this many pixels; under a finger, after this long a press. */
const START_PX = 6;
const HOLD_MS = 230;
/** How near an edge of the lanes the pointer makes them scroll, how far each step goes (pixels), and how often. */
const EDGE_PX = 28;
const EDGE_STEP = 14;
const EDGE_MS = 30;

/** What the drag needs to know of the screen it is over, read afresh whenever it asks. */
export interface DragView {
  song: TimelineSong;
  /** how wide a beat is on the lanes, and which beat is at their left edge */
  pxPerBeat: number;
  scroll: number;
}

/** The clip being dragged, as it is drawn: the clip itself (a draft as a clip one round of its content long), its track's colour, and the range its notes are drawn on. */
export interface DragLook { clip: NoteClip; color: number; lo?: number; hi?: number }

export interface ClipDragHost {
  view(): DragView;
  /** a drag began: the lanes that do not take the clip are dimmed */
  begin(p: ClipPayload): void;
  /** it ended, whichever way */
  end(): void;
  /** time scrolls under the drag */
  scrollBy(beats: number): void;
  /** let go on a lane that takes it, at a beat: a separate copy lands. Says whether one did */
  drop(p: ClipPayload, lane: string, beat: number): boolean;
}

export interface ClipDragApi {
  /** press on the strip's clip: a drag may begin */
  start(e: ReactPointerEvent<HTMLElement>, p: ClipPayload, look: DragLook): void;
  /** true right after a drag, so the click that ends it is ignored */
  justDragged(): boolean;
  /** the ghost, to be drawn once by the host */
  ghost: ReactNode;
}

/** Where a dragged clip would land under a pointer: the lane, whether it takes the clip, and the beat its left edge goes to. */
export interface Landing { lane: string; ok: boolean; beat: number; left: number; top: number }

/** The beat a clip lands on when the pointer is over `beat`: the bar line at or before it (a drums clip always; with Shift a note clip lands on the beat at or before it). */
export function landBeat(song: TimelineSong, kind: ClipPayload["kind"], beat: number, shift: boolean): number {
  const at = Math.max(0, beat);
  return kind !== "drums" && shift ? Math.floor(at + 1e-6) : barMap(song).floorBar(at);
}

/** What lies under a point of the screen, for a clip of a kind (null: no lane there). Windows let the pointer through while a clip is dragged, so a lane under one is found. */
function landingAt(x: number, y: number, p: ClipPayload, v: DragView, shift: boolean): Landing | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-lane]");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const ok = el.dataset.kind === p.kind;
  const beat = landBeat(v.song, p.kind, v.scroll + (x - r.left) / v.pxPerBeat, shift);
  return { lane: el.dataset.lane ?? "", ok, beat, left: r.left + (beat - v.scroll) * v.pxPerBeat, top: r.top + 6 };
}

/** "bar 5", or "bar 5, beat 3" when it does not land on a bar line. */
function placeText(song: TimelineSong, beat: number): string {
  const at = barMap(song).barAt(beat);
  const b = Math.floor(at.beat + 1e-6);
  return b ? `bar ${at.bar + 1}, beat ${b + 1}` : `bar ${at.bar + 1}`;
}

export function useClipDrag(host: ClipDragHost, keyOf: Key): ClipDragApi {
  const [drag, setDrag] = useState<{ payload: ClipPayload; look: DragLook; ppb: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const lastDrag = useRef(0);
  const hostRef = useRef(host);
  hostRef.current = host;
  /** what to do when the page goes away mid-drag */
  const stopNow = useRef<(() => void) | null>(null);
  useEffect(() => () => stopNow.current?.(), []);

  const start = useCallback((e: ReactPointerEvent<HTMLElement>, payload: ClipPayload, look: DragLook) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    const touch = e.pointerType !== "mouse";
    const pid = e.pointerId;
    const sx = e.clientX;
    const sy = e.clientY;
    const from = e.currentTarget;
    const srcWin = from.closest<HTMLElement>(".tlw");
    let active = false;
    let timer: number | undefined;
    let auto = 0;
    let last = { x: sx, y: sy, shift: e.shiftKey };
    let land: Landing | null = null;
    let offEscape: (() => void) | null = null;

    const place = () => {
      const g = ghostRef.current;
      const tag = tagRef.current;
      const v = hostRef.current.view();
      land = landingAt(last.x, last.y, payload, v, last.shift);
      if (!g) return;
      if (land?.ok) {
        // on a lane that takes it: the clip as it will lie, on the bar under the pointer
        const lanes = document.querySelector<HTMLElement>(".tlv-over")?.getBoundingClientRect();
        const cut = lanes ? Math.max(0, lanes.left - land.left) : 0;
        g.classList.add("landing");
        g.classList.remove("refused");
        g.style.transform = `translate(${land.left.toFixed(1)}px, ${land.top.toFixed(1)}px)`;
        g.style.clipPath = cut ? `inset(0 0 0 ${cut.toFixed(1)}px)` : "";
      } else {
        // anywhere else it follows the pointer, held by its left end
        g.classList.remove("landing");
        g.classList.toggle("refused", !!land);
        g.style.transform = `translate(${(last.x - 18).toFixed(1)}px, ${(last.y - 26).toFixed(1)}px)`;
        g.style.clipPath = "";
      }
      document.body.classList.toggle("strip-refused", !!land && !land.ok);
      if (tag) {
        tag.textContent = land?.ok ? placeText(v.song, land.beat) : land ? "Not on this track" : `Drop on a ${payload.kind === "melody" ? "melody or bass" : payload.kind} lane`;
        tag.style.transform = `translate(${last.x + 14}px, ${last.y + 18}px)`;
      }
    };
    /** near the left or right edge of the lanes time scrolls under the drag; near the top or bottom of the track list, the tracks do */
    const edges = () => {
      const lanes = document.querySelector<HTMLElement>(".tlv-over")?.getBoundingClientRect();
      const body = document.querySelector<HTMLElement>(".tlv-body");
      const b = body?.getBoundingClientRect();
      if (!lanes || !body || !b) return;
      const inside = last.y > b.top - 8 && last.y < b.bottom + 8 && last.x > lanes.left - 8;
      const dx = !inside ? 0 : last.x < lanes.left + EDGE_PX ? -1 : last.x > lanes.right - EDGE_PX ? 1 : 0;
      const dy = !inside ? 0 : last.y < b.top + EDGE_PX ? -1 : last.y > b.bottom - EDGE_PX ? 1 : 0;
      if (dx) hostRef.current.scrollBy((dx * EDGE_STEP) / hostRef.current.view().pxPerBeat);
      if (dy) body.scrollTop += dy * EDGE_STEP;
      if (dx || dy) place();
    };
    const activate = (x: number, y: number) => {
      active = true;
      last = { ...last, x, y };
      document.body.classList.add("strip-drag");
      srcWin?.classList.add("strip-src");
      hostRef.current.begin(payload);
      setDrag({ payload, look, ppb: hostRef.current.view().pxPerBeat });
      // (the ghost is drawn by the next frame: it is put under the pointer then)
      requestAnimationFrame(place);
      auto = window.setInterval(edges, EDGE_MS);
      offEscape = onEscape(ESC_OPEN + 1, () => {
        finish(false);
        return true;
      });
      if (touch) navigator.vibrate?.(8);
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      window.clearInterval(auto);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("blur", onCancel);
      document.removeEventListener("touchmove", onTouchMove);
      offEscape?.();
      offEscape = null;
      stopNow.current = null;
    };
    /** the drag is over: with `landed` the copy is on its lane; without, the ghost glides back to the strip it came from */
    const finish = (landed: boolean) => {
      cleanup();
      if (!active) return;
      active = false;
      lastDrag.current = Date.now();
      document.body.classList.remove("strip-drag", "strip-refused");
      srcWin?.classList.remove("strip-src");
      hostRef.current.end();
      const g = ghostRef.current;
      if (landed || !g || !from.isConnected) return setDrag(null);
      const r = from.getBoundingClientRect();
      g.classList.remove("landing", "refused");
      g.classList.add("gliding");
      g.style.clipPath = "";
      g.style.transform = `translate(${r.left.toFixed(1)}px, ${r.top.toFixed(1)}px)`;
      if (tagRef.current) tagRef.current.style.display = "none";
      window.setTimeout(() => setDrag((d) => (d && d.payload === payload ? null : d)), 190);
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (!active) {
        const far = Math.hypot(ev.clientX - sx, ev.clientY - sy);
        if (touch) {
          if (far > 10) cleanup(); // it is a scroll, not a drag
          return;
        }
        if (far < START_PX) return;
        activate(ev.clientX, ev.clientY);
      }
      last = { x: ev.clientX, y: ev.clientY, shift: ev.shiftKey };
      place();
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (!active) return cleanup();
      last = { x: ev.clientX, y: ev.clientY, shift: ev.shiftKey };
      place();
      const to = land;
      finish(!!to?.ok && hostRef.current.drop(payload, to.lane, to.beat));
    };
    const onCancel = () => finish(false);
    // Shift pressed or let go while the pointer rests: the ghost goes to the beat, or back to the bar
    const onKey = (ev: KeyboardEvent) => {
      if (!active || ev.key !== "Shift") return;
      last = { ...last, shift: ev.type === "keydown" };
      place();
    };
    // once a drag is live, the page does not scroll under the finger
    const onTouchMove = (ev: TouchEvent) => {
      if (active && ev.cancelable) ev.preventDefault();
    };
    if (touch) timer = window.setTimeout(() => activate(sx, sy), HOLD_MS);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("blur", onCancel);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    stopNow.current = () => finish(false);
  }, []);

  const justDragged = useCallback(() => Date.now() - lastDrag.current < 150, []);
  const ghost = useMemo(() => {
    if (!drag || typeof document === "undefined") return null;
    const { look, ppb } = drag;
    const c = look.clip;
    return createPortal(
      <>
        <div ref={ghostRef} className={`sd-ghost tlc k-${c.kind} ${letterClass(look.color)}`} style={{ width: Math.max(24, c.len * ppb) }} aria-hidden="true">
          <div className="tlc-in">
            {c.kind === "chords" ? <ChordBlock clip={c} ppb={ppb} keyOf={keyOf} />
              : c.kind === "melody" ? <MelodyBlock clip={c} ppb={ppb} lo={look.lo ?? 55} hi={look.hi ?? 79} />
              : <DrumBlock clip={c} ppb={ppb} />}
          </div>
        </div>
        <div ref={tagRef} className="sd-tag mono" aria-hidden="true" />
      </>,
      document.body,
    );
  }, [drag, keyOf]);
  return useMemo(() => ({ start, justDragged, ghost }), [start, justDragged, ghost]);
}
