import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Take } from "../../song/takes";
import { laneBeats, lanePos, snapMove, trimClip, type Clip } from "../../song/clips";
import { loadTake, takeBuffer, takeKey } from "../../audio/takebuffers";
import { wavePath } from "../../audio/peaks";
import { barAtFrac, clampStart, pageStart, scrolledWindow, shownCount, turnPage, type BarsShown } from "../../song/window";

/** One bar of what a recording goes round: its section, which of its bars, its letter, its beats. */
export interface LaneBar {
  block: string;
  bar: number;
  letter: string;
  beats: number;
  /** 1/16 notes in one of its beats (6 in x/8, where a beat is a dotted quarter; else 4) */
  sub?: number;
}

/** At most this many recordings are drawn one above another; the rest are counted. */
const ROWS = 4;
/** After a scroll or a page turned by hand, Follow waits this long before it turns the page (as on the grids). */
const HOLD_MS = 1500;
/** How tall a recording's row of clips is (px). */
const ROW_H = 40;
/** A pointer that moves less than this (px) taps; more, it drags. */
const TAP_PX = 5;
/** Two taps on a clip within this long hear it alone (ms). */
const DOUBLE_MS = 350;

/** One recording on the lane: its clips, each with its take. */
export interface LaneRow {
  group: string;
  /** "● 2" */
  label: string;
  clips: { clip: Clip; take: Take }[];
}
type Placed = { clip: Clip; take: Take };

/** What the lane may do to its clips (without it, they are only shown). */
export interface LaneEdit {
  selected: string | null;
  onSelect: (c: Placed | null) => void;
  /** ✂: a tap splits a clip where it lands */
  cut: boolean;
  /** moves keep to whole 1/16 notes (Alt or Shift moves freely) */
  snap: boolean;
  onTrim: (id: string, edge: "from" | "to", frame: number) => void;
  onMove: (id: string, move: number) => void;
  onSplit: (id: string, frame: number) => void;
  onDelete: (id: string) => void;
  /** hear a clip alone (two taps) */
  onHear?: (c: Placed) => void;
  /** S, Delete and Escape work (the page is on screen and nothing is being recorded) */
  keys: boolean;
}

/** `still`: a finger on a clip not selected: a tap selects it, a swipe scrolls the lane (it never moves the clip) */
type Drag = { x: Placed; kind: "from" | "to" | "move"; x0: number; pos0: number; pointer: number; moved: boolean; value: number; still?: boolean };

const TEXT_INPUTS = new Set(["text", "number", "search", "email", "url", "password", "tel"]);
const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && ((el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type)) || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

/**
 * The bars a recording goes round (the loop, or the section on screen), as many at a time as
 * Bars on screen says, across the whole width; more than that scroll sideways (by hand, or
 * with ‹ ›). Each recording is a row of clips where they play, each drawn with its waveform,
 * and a line moves with the music while it plays or records. A thin line along the top fills
 * as each pass goes by. With Follow on, the lane turns a page when the music runs off it; with
 * Follow off it never moves on its own.
 *
 * With `edit`, it is a clip editor: drag a clip's edge to trim it (the voice stays where it
 * is), drag its body to move it (to whole 1/16 notes, or freely with Alt or Shift), tap to
 * select it, tap twice to hear it alone; with ✂ on (or S, at the pointer or the playing
 * line), a tap splits it there. Delete deletes the selected clip.
 */
export function TakeLane({ bars, song, rows, bpm, where, live, shown, follow, edit }: {
  bars: LaneBar[];
  /** every bar of the song in order, of which `bars` are a run: a take sung outside them that plays in them is drawn there too */
  song?: LaneBar[];
  /** the recordings to draw (newest first), each with its clips */
  rows: LaneRow[];
  bpm: number;
  /** how far across the lane the music is (0..1), or null when it is not in these bars */
  where: () => number | null;
  /** the music is going: move the line */
  live: boolean;
  /** bars on screen (0 = all of them) */
  shown: BarsShown;
  /** the lane turns a page with the music */
  follow: boolean;
  edit?: LaneEdit;
}) {
  const headRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const n = Math.max(1, bars.length);
  const count = shownCount(shown, n);
  const paged = count < n;
  /** the first bar on screen, kept as the lane is scrolled (so a new bar count or width keeps it at the left) */
  const leftBar = useRef(0);
  /** the same, for drawing: ‹ and › are greyed at the ends, as on the grids (it changes once a page, never a frame) */
  const [first, setFirst] = useState(0);
  /** when the lane was last moved by hand */
  const held = useRef(0);
  const live$ = useRef({ count, n, follow });
  live$.current = { count, n, follow };
  const scrollToBar = (bar: number) => {
    const sc = scrollRef.current;
    if (!sc || !sc.clientWidth) return false;
    const { count, n } = live$.current;
    const to = clampStart(bar, count, n);
    sc.scrollLeft = (to * sc.clientWidth) / count;
    // known straight away, not only once the scroll event comes: the music checks it every frame
    leftBar.current = to;
    return true;
  };

  // another loop: back to its first bar
  const which = bars.length ? `${bars[0].block}:${bars[0].bar}-${bars[n - 1].block}:${bars[n - 1].bar}` : "";
  useLayoutEffect(() => {
    leftBar.current = 0;
    setFirst(0);
    scrollToBar(0);
  }, [which]); // eslint-disable-line react-hooks/exhaustive-deps
  // more or fewer bars on screen (or a wider window): the bar at the left edge stays there
  useLayoutEffect(() => {
    scrollToBar(leftBar.current);
  }, [count, n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => scrollToBar(leftBar.current));
    ro.observe(sc);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the line follows the music every frame, without drawing the lane again. Which bars are on
  // screen is kept in a ref as the lane scrolls, so a frame never has to measure anything; the
  // lane is only scrolled when the music runs off the page.
  useEffect(() => {
    const head = headRef.current;
    const fill = fillRef.current;
    if (!head || !fill) return;
    const hide = () => {
      head.style.opacity = "0";
      fill.style.transform = "scaleX(0)";
    };
    if (!live) return hide();
    let raf = 0;
    let turned = -1;
    const tick = () => {
      const x = where();
      if (x === null) hide();
      else {
        head.style.opacity = "1";
        head.style.left = `${(x * 100).toFixed(3)}%`;
        fill.style.transform = `scaleX(${x.toFixed(4)})`;
        const l = live$.current;
        const b = barAtFrac(x, l.n);
        // a whole page at a time, and only with Follow on (never a bar at a time, never while being
        // scrolled by hand); as on the grids, switching Follow on goes straight to the music
        if (b >= leftBar.current && b < leftBar.current + l.count) turned = -1;
        else if (l.follow && b !== turned && performance.now() > held.current + HOLD_MS) {
          turned = b;
          scrollToBar(pageStart(b, l.count, l.n));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); hide(); };
  }, [live, where]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Someone is moving the lane: Follow waits a moment. */
  const hold = () => {
    held.current = performance.now();
  };
  const page = (dir: -1 | 1) => {
    hold();
    scrollToBar(turnPage({ start: leftBar.current, count }, dir, n));
  };

  const index = (block: string, bar: number) => bars.findIndex((b) => b.block === block && b.bar === bar);
  /** where the lane's first bar is in the song */
  const k0 = song && bars.length ? song.findIndex((b) => b.block === bars[0].block && b.bar === bars[0].bar) : -1;
  /** beats from the lane's start to a bar of the song outside the lane (before it: less than 0), or NaN when it is not in the song */
  const fromSong = (block: string, bar: number): number => {
    const k = k0 < 0 || !song ? -1 : song.findIndex((b) => b.block === block && b.bar === bar);
    if (k < 0 || !song) return NaN;
    let at = 0;
    for (let j = Math.min(k, k0); j < Math.max(k, k0); j++) at += song[j].beats > 0 ? song[j].beats : 1;
    return k < k0 ? -at : at;
  };
  // ── where things are: the lane draws every bar the same width, whatever its beats ──
  const spb = 60 / Math.max(1, bpm);
  /** beats from the lane's start to the bar a take was sung from (in the lane's bars, or elsewhere in the song) */
  const anchor = (t: Take) => {
    const i = index(t.at.block, t.at.bar);
    return i >= 0 ? laneBeats(bars, i) : fromSong(t.at.block, t.at.bar);
  };
  /** where a clip is on the lane (in bars, as drawn) */
  const span = (c: Clip, t: Take) => {
    const a = anchor(t);
    const m = c.move ?? 0;
    return { l: lanePos(bars, a + (c.from + m) / t.rate / spb), r: lanePos(bars, a + (c.to + m) / t.rate / spb) };
  };
  // the clips of takes sung in these bars, and those sung elsewhere that play in them (the part
  // in these bars is what shows, and can be trimmed, split or moved here: they play there as here)
  const placed = rows.map((r) => ({ ...r, clips: r.clips.filter((x) => {
    if (index(x.take.at.block, x.take.at.bar) >= 0) return true;
    const { l, r: end } = span(x.clip, x.take);
    return Number.isFinite(l) && end > 1e-6 && l < n - 1e-6;
  }) })).filter((r) => r.clips.length);
  const drawn = placed.slice(0, ROWS);
  const lines = Math.max(1, drawn.length);

  // the waveforms: each take read once (the song reads the same ones), drawn when it is in
  const [, setWaves] = useState(0);
  const need = drawn.flatMap((r) => r.clips.map((x) => x.take));
  const needKey = [...new Set(need.map(takeKey))].join("|");
  useEffect(() => {
    let on = true;
    for (const t of need) if (!takeBuffer(t)) void loadTake(t).then((b) => on && b && setWaves((k) => k + 1));
    return () => { on = false; };
  }, [needKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** the place on the lane under the pointer (in bars) */
  const posAt = (clientX: number) => {
    const el = innerRef.current;
    const r = el?.getBoundingClientRect();
    return r && r.width ? ((clientX - r.left) / r.width) * n : 0;
  };
  /** the frame of a take that plays at a place on the lane, for a clip of it moved by `move` */
  const frameAt = (t: Take, move: number, pos: number) => Math.round((laneBeats(bars, pos) - anchor(t)) * spb * t.rate) - move;

  // ── editing ──
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const lastTap = useRef({ id: "", at: 0 });
  /** the clip under the pointer, and where (for S) */
  const hover = useRef<{ x: Placed; pos: number } | null>(null);
  /** a clip as it is drawn: as it is, or as it is being dragged */
  const drawnClip = (c: Clip): Clip => {
    const d = drag;
    if (!d || d.x.clip.id !== c.id || !d.moved) return c;
    return d.kind === "move" ? { ...c, move: d.value } : { ...c, [d.kind]: d.value };
  };
  const down = (e: React.PointerEvent<HTMLElement>, x: Placed) => {
    if (!edit || e.button > 0) return;
    hold();
    const edge = (e.target as HTMLElement).dataset?.edge;
    const kind = edge === "from" || edge === "to" ? edge : "move";
    // a finger on the body of a clip not selected yet: the lane scrolls with it, and a tap selects
    // it (a clip filling the lane would otherwise move with every swipe meant to scroll it)
    if (kind === "move" && e.pointerType === "touch" && edit.selected !== x.clip.id) {
      dragRef.current = { x, kind, x0: e.clientX, pos0: posAt(e.clientX), pointer: e.pointerId, moved: false, value: x.clip.move ?? 0, still: true };
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* (a pretend pointer) */
    }
    dragRef.current = { x, kind, x0: e.clientX, pos0: posAt(e.clientX), pointer: e.pointerId, moved: false, value: kind === "move" ? x.clip.move ?? 0 : x.clip[kind] };
  };
  const move = (e: React.PointerEvent<HTMLElement>, x: Placed) => {
    const d = dragRef.current;
    if (!d || d.pointer !== e.pointerId) {
      hover.current = { x, pos: posAt(e.clientX) };
      return;
    }
    if (!d.moved && Math.abs(e.clientX - d.x0) < TAP_PX) return;
    d.moved = true;
    if (d.still) return;
    const pos = posAt(e.clientX);
    const { clip: c, take: t } = d.x;
    if (d.kind === "move") {
      const raw = (c.move ?? 0) + (laneBeats(bars, pos) - laneBeats(bars, d.pos0)) * spb * t.rate;
      // to the 1/16 notes of the bar its start lands in (in 6/8 an eighth is a third of a beat)
      const k = Math.max(0, Math.min(bars.length - 1, Math.floor(lanePos(bars, anchor(t) + (c.from + raw) / t.rate / spb))));
      const origin = (laneBeats(bars, k) - anchor(t)) * spb * t.rate;
      d.value = snapMove(raw, t.rate, bpm, !edit?.snap || e.altKey || e.shiftKey, bars[k]?.sub ?? 4, origin);
    } else d.value = trimClip([c], c.id, d.kind, frameAt(t, c.move ?? 0, pos), t)[0][d.kind];
    setDrag({ ...d });
  };
  const up = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointer !== e.pointerId || !edit) return;
    dragRef.current = null;
    setDrag(null);
    const { clip: c, take: t } = d.x;
    // (a swipe that scrolled the lane)
    if (d.still && d.moved) return;
    if (!d.moved) {
      // a tap: split (✂), hear it (a second tap), or select it
      if (edit.cut) return edit.onSplit(c.id, frameAt(t, c.move ?? 0, posAt(e.clientX)));
      const now = performance.now();
      if (lastTap.current.id === c.id && now - lastTap.current.at < DOUBLE_MS && edit.onHear) {
        lastTap.current = { id: "", at: 0 };
        edit.onHear(d.x);
      } else lastTap.current = { id: c.id, at: now };
      return edit.onSelect(d.x);
    }
    if (d.kind === "move") {
      if (d.value !== (c.move ?? 0)) edit.onMove(c.id, d.value);
    } else if (d.value !== c[d.kind]) edit.onTrim(c.id, d.kind, d.value);
    if (edit.selected !== c.id) edit.onSelect(d.x);
  };
  const cancel = () => {
    dragRef.current = null;
    setDrag(null);
  };

  // S splits at the pointer (or, with it off the clips, the selected clip at the playing line);
  // Delete deletes the selected clip; Escape lets it go
  const keyed = useRef({ edit, drawn, span, frameAt, where, n });
  keyed.current = { edit, drawn, span, frameAt, where, n };
  useEffect(() => {
    if (!edit?.keys) return;
    const onKey = (e: KeyboardEvent) => {
      const { edit: ed, drawn: rs, span: sp, frameAt: fa, where: wh, n: nn } = keyed.current;
      if (!ed || e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
      if (e.key === "s" || e.key === "S") {
        let at = hover.current;
        if (!at) {
          const x = wh();
          const pos = x === null ? null : x * nn;
          const all = rs.flatMap((r) => r.clips);
          const under = (p: Placed) => pos !== null && sp(p.clip, p.take).l < pos && pos < sp(p.clip, p.take).r;
          const hit = all.find((p) => p.clip.id === ed.selected && under(p)) ?? all.find(under);
          at = hit && pos !== null ? { x: hit, pos } : null;
        }
        if (!at) return;
        e.preventDefault();
        ed.onSplit(at.x.clip.id, fa(at.x.take, at.x.clip.move ?? 0, at.pos));
      } else if ((e.key === "Delete" || e.key === "Backspace") && ed.selected) {
        e.preventDefault();
        ed.onDelete(ed.selected);
      } else if (e.key === "Escape" && ed.selected) ed.onSelect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edit?.keys]); // eslint-disable-line react-hooks/exhaustive-deps

  // when many bars are on screen at once, only every so many is numbered (and each section's first)
  const step = Math.max(1, Math.ceil(count / 16));
  const labelled = (i: number) => i === 0 || bars[i - 1].block !== bars[i].block || i % step === 0;
  /** how many bars a label has before the next one (a long section name is cut short there, never written over it) */
  const room = (i: number) => {
    let j = i + 1;
    while (j < bars.length && !labelled(j)) j++;
    return j - i;
  };
  return (
    <div className={`tl-wrap${paged ? " paged" : ""}`}>
      {paged && <button className="btn sm dm-page" aria-label="Earlier bars" disabled={first === 0} onClick={() => page(-1)}>‹</button>}
      <div className={`take-lane${edit ? " editing" : ""}${edit?.cut ? " cutting" : ""}`} role="group" aria-label="Takes in the bars recorded over" style={{ ["--rows" as string]: lines, ["--row" as string]: `${ROW_H}px` }}>
        {/* how far through the loop the music is, across the lane as it stands, whichever bars are on screen */}
        <div className="tl-fill" ref={fillRef} />
        <div className="tl-scroll" ref={scrollRef} onWheel={hold} onPointerDown={hold} onTouchStart={hold}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (!el.clientWidth) return;
            leftBar.current = scrolledWindow(el.scrollLeft, el.clientWidth, count, n).start;
            setFirst(leftBar.current);
          }}>
          {/* as wide as all the bars, at the width the bars on screen share */}
          <div className="tl-inner" ref={innerRef} style={{ width: `${(n / count) * 100}%` }}
            onPointerDown={(e) => { if (edit?.selected && !(e.target as Element).closest?.(".tl-take")) edit.onSelect(null); }}>
            <div className="tl-bars">
              {bars.map((b, i) => {
                const starts = i === 0 || bars[i - 1].block !== b.block;
                return (
                  <span key={`${b.block}:${b.bar}`} className={`tl-bar${starts ? " sec" : ""}`}>
                    {/* "A1", or for a section with a name of its own, "Chorus 1" */}
                    {labelled(i) && <i style={{ maxWidth: `calc(${room(i) * 100}% - 6px)` }}>{starts ? `${b.letter}${b.letter.length > 1 ? " " : ""}${b.bar + 1}` : b.bar + 1}</i>}
                  </span>
                );
              })}
            </div>
            <div className="tl-takes">
              {drawn.map((row, ri) =>
                row.clips.map((x) => {
                  const c = drawnClip(x.clip);
                  const { l, r } = span(c, x.take);
                  const t = x.take;
                  const sel = edit?.selected === c.id;
                  const buf = takeBuffer(t);
                  const wave = buf ? wavePath(buf) : null;
                  // (↔: moved from where it was sung)
                  const label = `${row.label} · ${t.keep ? "★" : ""}${t.n}${c.move ? " ↔" : ""}`;
                  const style = { left: `${(l / n) * 100}%`, width: `${(Math.max(0.02, r - l) / n) * 100}%`, top: ri * ROW_H };
                  return (
                    <div key={c.id} className={`tl-take${t.keep ? " keep" : ""}${sel ? " sel" : ""}${drag?.x.clip.id === c.id && drag.moved ? " drag" : ""}`} style={style} title={label}
                      data-clip={c.id} data-take={t.id}
                      {...(edit ? {
                        role: "button", tabIndex: 0, "aria-pressed": sel, "aria-label": label,
                        onPointerDown: (e: React.PointerEvent<HTMLElement>) => down(e, x),
                        onPointerMove: (e: React.PointerEvent<HTMLElement>) => move(e, x),
                        onPointerUp: up, onPointerCancel: cancel, onLostPointerCapture: () => dragRef.current && cancel(),
                        onPointerLeave: () => { if (hover.current?.x.clip.id === c.id) hover.current = null; },
                        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") edit.onSelect(x); },
                      } : {})}>
                      {wave && (
                        <svg className="tl-wave" viewBox={`${((c.from / t.rate) * 100).toFixed(2)} -1 ${(((c.to - c.from) / t.rate) * 100).toFixed(2)} 2`} preserveAspectRatio="none" aria-hidden="true">
                          <path d={wave} />
                        </svg>
                      )}
                      <span className="tl-label">{label}</span>
                      {edit && <><i className="tl-grip from" data-edge="from" /><i className="tl-grip to" data-edge="to" /></>}
                    </div>
                  );
                }),
              )}
            </div>
            <div className="tl-head" ref={headRef} />
          </div>
        </div>
        {placed.length > drawn.length && <span className="tl-more">+{placed.length - drawn.length}</span>}
      </div>
      {paged && <button className="btn sm dm-page" aria-label="Later bars" disabled={first + count >= n} onClick={() => page(1)}>›</button>}
    </div>
  );
}
