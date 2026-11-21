// The ruler row over the lanes. At its left, over the track panels: Follow, and − fit +. Then the ruler itself:
// marker names over the bar numbers, a flag where the time signature changes, a band for each stretch of the loop,
// and a small label at the song's end that says how long it is.
// A drag across it loops that stretch (Ctrl: one more stretch); a click places the cursor; a band is moved by its
// middle and stretched by its ends; a marker is dragged, renamed and removed here.
import { useRef, useState } from "react";
import { TIME_SIGS, sameSig, sigBeats, sigName, type TimeSig } from "../../song/meter";
import { barMap } from "../../timeline/bars";
import { songEnd } from "../../timeline/edit";
import type { Region, Session, TimelineSong } from "../../timeline/model";
import { ZOOM_STEP, barEvery, barsText, beatOfX, dragRegion, markerRegion, mergeRegions, snap, snapMode, xOfBeat, type View } from "./gestures";
import type { MenuAt, MenuItem } from "./Menu";

export interface RulerProps {
  song: TimelineSong;
  view: View;
  /** how wide the lanes are on screen */
  width: number;
  session: Session;
  follow: boolean;
  onFollow(on: boolean): void;
  /** − and +: zoom about the cursor */
  onZoom(factor: number): void;
  onFit(): void;
  /** a click: the cursor goes there */
  onCursor(beat: number): void;
  onLoop(loop: Session["loop"]): void;
  edit(label: string, fn: (s: TimelineSong) => TimelineSong): void;
  /** the selected marker */
  marker: string | null;
  onMarker(id: string | null): void;
  /** the marker whose name is being typed */
  naming: string | null;
  onNaming(id: string | null): void;
  menu(at: MenuAt, items: MenuItem[], label: string): void;
  /** from the right-click menu: empty bars put in at a beat (one bar, or as long as the loop) */
  onInsert(at: number, looped: boolean): void;
  /** …the looped time taken out of every track */
  onCutLoop(): void;
  onAddMarker(beat: number): void;
  /** a signature flag: the signature from that bar on (null: the change is taken away) */
  onFlag(bar: number, sig: TimeSig | null): void;
}

type Drag =
  | { kind: "new"; pointer: number; x0: number; beat0: number; moved: boolean; add: boolean }
  | { kind: "move" | "from" | "to"; pointer: number; x0: number; beat0: number; moved: boolean; index: number }
  | { kind: "marker"; pointer: number; x0: number; beat0: number; moved: boolean; id: string };

/** A drag starts after this many pixels; less is a click. */
const TAP_PX = 4;

export function Ruler(p: RulerProps) {
  const { song, view, width, session } = p;
  const map = barMap(song);
  const end = songEnd(song);
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** the loop as it is being dragged, and a marker as it is being dragged */
  const [ghost, setGhost] = useState<Region[] | null>(null);
  const [moving, setMoving] = useState<{ id: string; beat: number } | null>(null);

  const beatAt = (clientX: number) => beatOfX(view, clientX - (el.current?.getBoundingClientRect().left ?? 0));
  const regions = ghost ?? session.loop?.regions ?? [];
  const looping = !!ghost || !!session.loop?.on;

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, input")) return;
    const base = { pointer: e.pointerId, x0: e.clientX, beat0: beatAt(e.clientX), moved: false };
    const mk = t.closest<HTMLElement>("[data-marker]");
    const band = t.closest<HTMLElement>("[data-band]");
    if (mk) drag.current = { ...base, kind: "marker", id: mk.dataset.marker! };
    else if (band && !e.ctrlKey && !e.metaKey) drag.current = { ...base, kind: t.dataset.end === "from" ? "from" : t.dataset.end === "to" ? "to" : "move", index: Number(band.dataset.band) };
    else drag.current = { ...base, kind: "new", add: e.ctrlKey || e.metaKey };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* (a pretend pointer) */
    }
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < TAP_PX) return;
    d.moved = true;
    const beat = beatAt(e.clientX);
    const mode = e.altKey ? "free" : e.shiftKey ? "beat" : "bar";
    if (d.kind === "marker") return setMoving({ id: d.id, beat: snap(map, beat, mode) });
    const old = session.loop?.regions ?? [];
    if (d.kind === "new") {
      const r = dragRegion(map, d.beat0, beat, mode === "free" ? "beat" : mode);
      return setGhost(d.add ? mergeRegions([...old, r]) : [r]);
    }
    const r = old[d.index];
    if (!r) return;
    const least = mode === "bar" ? sigBeats(map.sigAt(r.from)) : 1;
    let next: Region;
    if (d.kind === "move") {
      const from = snap(map, r.from + beat - d.beat0, mode);
      next = { from, to: from + (r.to - r.from) };
    } else if (d.kind === "from") next = { from: Math.min(snap(map, beat, mode), r.to - least), to: r.to };
    else next = { from: r.from, to: Math.max(snap(map, beat, mode), r.from + least) };
    setGhost(old.map((x, i) => (i === d.index ? next : x)));
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) {
      if (d.kind === "marker") {
        const m = song.markers?.find((x) => x.id === d.id);
        p.onMarker(d.id);
        if (m) p.onCursor(m.beat);
      } else {
        p.onMarker(null);
        p.onCursor(snap(map, d.beat0, snapMode({ shift: e.shiftKey, alt: e.altKey })));
      }
      return;
    }
    if (d.kind === "marker") {
      const to = moving?.beat;
      setMoving(null);
      p.onMarker(d.id);
      if (to !== undefined) p.edit("Move marker", (s) => ({ ...s, markers: (s.markers ?? []).map((m) => (m.id === d.id ? { ...m, beat: to } : m)).sort((a, b) => a.beat - b.beat) }));
      return;
    }
    if (ghost) p.onLoop({ regions: mergeRegions(ghost), on: true });
    setGhost(null);
  };
  const cancel = () => {
    drag.current = null;
    setGhost(null);
    setMoving(null);
  };

  const dbl = (e: React.MouseEvent<HTMLDivElement>) => {
    // (the ruler holds the pointer while it is pressed, so the event names the ruler: what is under the pointer is looked up)
    const t = (document.elementFromPoint(e.clientX, e.clientY) ?? e.target) as HTMLElement;
    if (t.closest("button, input, [data-band]")) return;
    const mk = t.closest<HTMLElement>("[data-marker]");
    if (!mk) return p.onLoop({ regions: [{ from: 0, to: end }], on: true });
    const r = markerRegion(song.markers, mk.dataset.marker!, end);
    if (!r) return;
    const old = e.ctrlKey || e.metaKey ? session.loop?.regions ?? [] : [];
    p.onLoop({ regions: mergeRegions([...old, r]), on: true });
  };

  const context = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const t = e.target as HTMLElement;
    const at = { x: e.clientX, y: e.clientY };
    const mk = t.closest<HTMLElement>("[data-marker]");
    if (mk) {
      const id = mk.dataset.marker!;
      p.onMarker(id);
      return p.menu(at, [
        { label: "Rename", hint: "F2", run: () => p.onNaming(id) },
        { label: "Delete", hint: "Del", danger: true, run: () => p.edit("Delete marker", (s) => ({ ...s, markers: (s.markers ?? []).filter((m) => m.id !== id) })) },
      ], "Marker");
    }
    const beat = map.snapBar(beatAt(e.clientX));
    const has = !!session.loop?.regions.length;
    p.menu(at, [
      { label: "Insert a bar here", hint: "Ins", run: () => p.onInsert(beat, false) },
      { label: "Insert the looped length here", hint: "Shift+Ins", disabled: !has, run: () => p.onInsert(beat, true) },
      { label: "Remove the looped time", hint: "Ctrl+Shift+Del", disabled: !has, danger: true, run: p.onCutLoop },
      { sep: true },
      { label: "Add marker", hint: "M", run: () => p.onAddMarker(beat) },
      { label: "Loop the whole song", run: () => p.onLoop({ regions: [{ from: 0, to: end }], on: true }) },
    ], "Ruler");
  };

  const flagMenu = (e: React.MouseEvent<HTMLElement>, bar: number, now: TimeSig) => {
    const r = e.currentTarget.getBoundingClientRect();
    p.menu({ x: r.left, y: r.bottom + 4 }, [
      { title: `From bar ${bar + 1} on` },
      ...TIME_SIGS.map((m): MenuItem => ({ label: sigName(m), on: sameSig(m, now), run: () => p.onFlag(bar, m) })),
      { sep: true },
      { label: "Remove this change", danger: true, run: () => p.onFlag(bar, null) },
    ], "Time signature");
  };

  const rename = (id: string, name: string | null) => {
    p.onNaming(null);
    const to = name?.trim().slice(0, 32);
    if (to) p.edit("Rename marker", (s) => ({ ...s, markers: (s.markers ?? []).map((m) => (m.id === id && m.name !== to ? { ...m, name: to } : m)) }));
  };

  // ── what is drawn: only what is on screen ──
  const from = view.scroll;
  const to = view.scroll + width / view.pxPerBeat;
  const lines = map.lines(from, to);
  const every = barEvery(view.pxPerBeat * sigBeats(song.meter));
  // what stands at each beat over the numbers: marker names, then the flag of a change of signature
  const at = new Map<number, { markers: { id: string; name: string }[]; flag?: { bar: number; sig: TimeSig } }>();
  const spot = (beat: number) => {
    let x = at.get(beat);
    if (!x) at.set(beat, (x = { markers: [] }));
    return x;
  };
  for (const m of song.markers ?? []) spot(moving?.id === m.id ? moving.beat : m.beat).markers.push(m);
  for (const s of song.sigs ?? []) spot(map.beatOfBar(s.bar)).flag = s;
  const spots = [...at.entries()].sort((a, b) => a[0] - b[0]);
  const endX = xOfBeat(view, end);
  const bars = map.barAt(end).bar;
  const cur = xOfBeat(view, session.cursor);

  return (
    <div className="tlv-rulerrow">
      <div className="tlv-corner">
        <button className={`tlv-follow${p.follow ? " on" : ""}`} aria-pressed={p.follow} title="Follow: the view turns a page when the play line leaves it" onClick={() => p.onFollow(!p.follow)}>Follow</button>
        <span className="tlv-zoom" role="group" aria-label="Zoom">
          <button aria-label="Zoom out" title="Zoom out (−)" onClick={() => p.onZoom(1 / ZOOM_STEP)}>−</button>
          <button className="fit" aria-label="Fit the whole song" title="Show the whole song" onClick={p.onFit}>fit</button>
          <button aria-label="Zoom in" title="Zoom in (+)" onClick={() => p.onZoom(ZOOM_STEP)}>+</button>
        </span>
      </div>
      <div className={`tlv-ruler${looping ? " looping" : ""}`} ref={el} role="group" aria-label="Ruler: drag across it to loop, click to place the cursor"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onDoubleClick={dbl} onContextMenu={context}>
        {lines.map((l) => {
          const numbered = l.bar % every === 0;
          return <i key={l.bar} className={`tlv-tick${numbered ? " n" : ""}`} style={{ left: xOfBeat(view, l.beat) }}>{numbered ? l.bar + 1 : ""}</i>;
        })}
        {regions.map((r, i) => {
          const x = xOfBeat(view, r.from);
          const w = (r.to - r.from) * view.pxPerBeat;
          if (x + w < 0 || x > width) return null;
          return (
            <div key={i} className="tlv-band" data-band={i} style={{ left: x, width: w }} title={`Loop: ${barsText(map, r.from, r.to)}. Drag to move it, drag an end to change it`}>
              <i className="tlv-band-end l" data-end="from" />
              <i className="tlv-band-end r" data-end="to" />
              <button className={`tlv-band-x${w < 30 ? " out" : ""}`} aria-label="Take this stretch out of the loop" title="Take this stretch out of the loop"
                onClick={() => {
                  const rest = (session.loop?.regions ?? []).filter((_, k) => k !== i);
                  p.onLoop(rest.length ? { regions: rest, on: !!session.loop?.on } : null);
                }}>✕</button>
            </div>
          );
        })}
        {spots.map(([beat, at]) => {
          const x = xOfBeat(view, beat);
          if (x < -200 || x > width) return null;
          return (
            <div key={beat} className="tlv-at" style={{ left: x }}>
              {at.markers.map((m) => (
                <div key={m.id} className={`tlv-marker${p.marker === m.id ? " on" : ""}`} data-marker={m.id} title={`${m.name}: double-click to loop from here to the next marker`}>
                  {p.naming === m.id ? (
                    <input className="tlv-marker-name" autoFocus defaultValue={m.name} maxLength={32} aria-label="Marker name" enterKeyHint="done"
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") rename(m.id, e.currentTarget.value);
                        else if (e.key === "Escape") rename(m.id, null);
                      }}
                      onBlur={(e) => { if (p.naming === m.id) rename(m.id, e.currentTarget.value); }} />
                  ) : m.name}
                </div>
              ))}
              {at.flag && (
                <button className="tlv-flag" aria-label={`Time signature ${sigName(at.flag.sig)} from bar ${at.flag.bar + 1}`} title={`${sigName(at.flag.sig)} from bar ${at.flag.bar + 1}: click to change`} onClick={(e) => flagMenu(e, at.flag!.bar, at.flag!.sig)}>{sigName(at.flag.sig)}</button>
              )}
            </div>
          );
        })}
        {/* how long the song is: at its end, or at the ruler's right edge while the end is off screen */}
        {endX > 0 && endX <= width + 1
          ? <span className={`tlv-end${endX + 64 > width ? " left" : ""}`} style={{ left: endX }} title="Where the song ends"><b>{bars} bar{bars === 1 ? "" : "s"}</b></span>
          : <span className="tlv-end left off" style={{ left: width }} title="How long the song is"><b>{bars} bar{bars === 1 ? "" : "s"}</b></span>}
        {cur >= 0 && cur <= width && <i className="tlv-cur-head" style={{ left: cur }} />}
      </div>
    </div>
  );
}
