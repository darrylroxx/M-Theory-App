import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Beat } from "../../audio/beats";
import { MAX_SECTION_BARS, QUICK_BARS, barsText, stepBars } from "../../song/frame";
import { hasTune } from "../../song/melody";
import { TIME_SIGS, sameSig, sigName, type TimeSig } from "../../song/meter";
import { MAX_NAME, addNewSection, letters, moveBlock, moveBlockTo, newColor, newLetter, removeBlock, renameSection, repeatSection, selectBlock, setSectionBars, sharedCount, soloSection, unlinkBlock, type Section } from "../../song/structure";
import { placedClips } from "../../song/clips";
import { allTracks, focusTrack, isFirst, normalize, type Track, type TrackKind } from "../../song/tracks";
import { copySection, keyShift, pasteSection, sectionHasContent } from "../../song/clip";
import { conform, setSectionSig, sigOf } from "../../song/unity";
import { sameMusic } from "../../song/library";
import { displayNote } from "../../theory/notes";
import { CopyIcon, GripIcon, PasteIcon } from "../icons";
import { letterClass } from "../letters";
import { newId, useApp, type AppState, type Pane, type Progression } from "../state";

type Len = { beats: number; bar: number };
/** The page that edits each kind of track. */
const TRACK_PAGE: Record<TrackKind, Pane> = { chords: "rhythm", melody: "melody", drums: "drums", vocals: "vocals" };

/** Everything a drag needs to know, taken when it starts (the rows do not move under it until it ends). */
interface Drag {
  id: string;
  from: number;
  els: HTMLElement[];
  /** each row's top (page coordinates) and height, and the space between rows */
  tops: number[];
  heights: number[];
  gap: number;
  /** the list's top, and where the pointer started (page coordinates) */
  listTop: number;
  startY: number;
  /** where the pointer is now (on screen) */
  y: number;
  /** where the row would land: its place among the others */
  to: number;
}

/**
 * The sections, in playing order. Each row: a grip to drag it anywhere (or hold it, on a phone),
 * what it is called (tap the one you are on to name it), how long it is and its time signature,
 * copy, paste and remove, and a chip for every track that opens its page there.
 */
export function FrameSections({ secs, lengths, here, beat, onPasted }: {
  secs: Section[];
  /** each section's length in beats and its bar, as it plays */
  lengths: Record<string, Len>;
  /** the section on screen, as it is now */
  here: Len;
  beat: Beat;
  /** a paste (or its undo) changed what the pages show */
  onPasted: () => void;
}) {
  const { state, set, toast } = useApp();
  const prog = state.progression;
  /** every track in its place (a page may be editing an added one) */
  const np = useMemo(() => normalize(prog), [prog]);
  const tracks = useMemo(() => allTracks(np), [np]);
  const vocals = tracks.filter((t) => t.kind === "vocals");
  const recordedIn = (block: string) => vocals.some((t) => (t.takes ?? []).some((k) => k.at.block === block));
  const change = (fn: (p: Progression) => Progression) => set((s) => ({ ...s, progression: fn(s.progression) }));
  const rows = secs.length ? secs : [soloSection(prog)];
  const songSig = sigOf(prog);
  /** the section whose lengths or time signatures are open */
  const [picking, setPicking] = useState<{ id: string; what: "bars" | "sig" } | null>(null);
  /** the section being named */
  const [naming, setNaming] = useState<string | null>(null);
  const cancelName = useRef(false);

  /** Open a track's page on a section, with that track ready to edit. */
  const open = (blockId: string, t: Track) =>
    set((s) => {
      const p = blockId ? selectBlock(s.progression, blockId) : s.progression;
      if (t.kind === "vocals") return { ...s, pane: "vocals", progression: p, studio: { ...s.studio, vocal: t.id } };
      return { ...s, pane: TRACK_PAGE[t.kind], progression: focusTrack(p, t.kind, t.id) };
    });
  const lenOf = (x: Section): Len => (x.current ? here : lengths[x.blockId] ?? here);
  const totalBars = rows.reduce((a, x) => a + lenOf(x).beats / lenOf(x).bar, 0);
  const secsLong = Math.round((rows.reduce((a, x) => a + lenOf(x).beats, 0) * 60) / prog.bpm);
  /** what one track holds in a section: how many chords, a melody, a beat, how many recordings */
  const filled = (x: Section, t: Track): number => {
    const sec = secs.find((y) => y.blockId === x.blockId);
    if (t.kind === "vocals") return new Set(placedClips(t).filter(({ take }) => take.at.block === x.blockId).map(({ take }) => take.group)).size;
    if (!isFirst(t.id)) {
      const l = (sec ? sec.layers : np.layers)?.[t.id];
      return t.kind === "chords" ? (l?.chords ?? []).filter((c) => !c.rest).length : t.kind === "melody" ? Number(hasTune(l?.melody)) : Number(!!l?.beat?.on);
    }
    if (t.kind === "chords") return (sec ? sec.chords : np.chords).filter((c) => !c.rest).length;
    if (t.kind === "melody") return Number(hasTune(sec ? sec.melody : np.melody));
    return Number(sec ? sec.groove?.on ?? beat.on : beat.on);
  };
  const remove = (x: Section) => {
    if (recordedIn(x.blockId) && !window.confirm(`Vocals were recorded in this ${x.label}. Remove it anyway? (The recordings stay in Music › M-Theory › Recordings.)`)) return;
    change((p) => removeBlock(p, x.blockId));
  };
  const addNew = () => change((p) => addNewSection(p));
  const again = (partId: string) => change((p) => repeatSection(p, partId));
  const uniq = letters(prog);

  /** Tap the name of the section you are on to rename it; any other one, to go to it. */
  const tapLabel = (x: Section) => {
    if (x.current) setNaming(x.blockId || "a");
    else change((p) => selectBlock(p, x.blockId));
  };
  const saveName = (x: Section, value: string) => {
    if (!cancelName.current) change((p) => renameSection(p, x.blockId, value));
    cancelName.current = false;
    setNaming(null);
  };

  // ── a section's own time signature: a change can be taken back for a while, as long as nothing else has changed since ──
  const [undoSig, setUndoSig] = useState<{ block: string; before: Progression; after: Progression } | null>(null);
  const undoTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);
  const canUndoSig = useMemo(() => !!undoSig && sameMusic(prog, undoSig.after), [prog, undoSig]);
  const sigOfRow = (x: Section): TimeSig => x.meter ?? songSig;
  const pickSig = (x: Section, m: TimeSig) => {
    setPicking(null);
    // the song's signature means "follow the song"; nothing to do if that is how it already is
    if (sameSig(m, sigOfRow(x)) && sameSig(m, songSig) === !x.meter) return;
    const after = conform(setSectionSig(prog, x.blockId, m));
    setUndoSig({ block: x.blockId, before: prog, after });
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndoSig(null), 20000);
    // (should the song have moved on in the meantime, the change is made to it as it is, and there is nothing to undo)
    change((p) => (p === prog ? after : setSectionSig(p, x.blockId, m)));
  };

  // ── copy and paste a whole section ──
  const clip = state.clip?.section;
  const idea = state.ideaId ?? null;
  /** the row it was copied from, or another block of the same section (it has nothing to paste into itself) */
  const isSource = (x: Section) => !!clip && clip.idea === idea && (clip.block === x.blockId || (!!clip.part && clip.part === x.partId));
  /** the very block it was copied from */
  const copied = (x: Section) => !!clip && clip.idea === idea && clip.block === x.blockId;
  const copy = (x: Section) => {
    set((s) => {
      const c = copySection(s.progression, x.blockId, s.key, s.ideaId ?? null);
      return c ? { ...s, clip: { ...s.clip, section: c } } : s;
    });
    toast(`${x.label} copied`);
  };
  const paste = (x: Section) => {
    if (!clip) return;
    if (sectionHasContent(prog, x.blockId) && !window.confirm(`Replace everything in ${x.label} with ${clip.from}?`)) return;
    const before = prog;
    const key = state.key;
    const after = conform(pasteSection(prog, x.blockId, clip, key, newId));
    set((s) => ({ ...s, progression: s.progression === prog ? after : pasteSection(s.progression, x.blockId, clip, s.key, newId) }));
    onPasted();
    setPicking(null);
    const moved = keyShift(clip.key, key) !== 0;
    // the paste can be taken back while the idea is still just as it left it
    const still = (s: AppState) => (s.ideaId ?? null) === idea && s.key.tonic === key.tonic && s.key.scaleId === key.scaleId && sameMusic(s.progression, after);
    toast(`${clip.from} → ${x.label}${moved ? ` · ${displayNote(key.tonic)}` : ""}`, {
      label: "↶", aria: "Undo the paste", when: still,
      run: () => {
        set((s) => (still(s) ? { ...s, progression: before } : s));
        onPasted();
      },
    });
  };

  // ── dragging rows ──
  const listRef = useRef<HTMLOListElement>(null);
  const slotRef = useRef<HTMLLIElement>(null);
  const drag = useRef<Drag | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  /** when the last drag ended (the click that ends it is not a tap) */
  const dropped = useRef(0);
  /** where the dropped row was on screen, so it can glide into its place */
  const flip = useRef<{ id: string; top: number } | null>(null);
  /** the row whose grip should have the keyboard after a move */
  const refocus = useRef<string | null>(null);
  const order = rows.map((x) => x.blockId).join(",");
  const canDrag = secs.length > 1;

  /** Put the slot where the row would land. */
  const placeSlot = (d: Drag) => {
    const el = slotRef.current;
    if (!el) return;
    const top = d.to <= d.from ? d.tops[d.to] : d.tops[d.to] + d.heights[d.to] - d.heights[d.from];
    el.style.height = `${d.heights[d.from]}px`;
    el.style.transform = `translateY(${top - d.listTop}px)`;
  };
  /** The row follows the pointer; the others make room where it would land. */
  const follow = (clientY: number) => {
    const d = drag.current;
    if (!d) return;
    d.y = clientY;
    const dy = clientY + window.scrollY - d.startY;
    d.els[d.from].style.transform = `translateY(${dy}px)`;
    const mid = d.tops[d.from] + d.heights[d.from] / 2 + dy;
    let to = 0;
    d.els.forEach((_, k) => {
      if (k !== d.from && d.tops[k] + d.heights[k] / 2 < mid) to++;
    });
    if (to === d.to) return;
    d.to = to;
    const room = d.heights[d.from] + d.gap;
    d.els.forEach((e, k) => {
      if (k === d.from) return;
      const shift = k > d.from && k <= to ? -room : k < d.from && k >= to ? room : 0;
      e.style.transform = shift ? `translateY(${shift}px)` : "";
    });
    placeSlot(d);
  };
  const begin = (id: string, startY: number): boolean => {
    const list = listRef.current;
    if (!list) return false;
    const els = [...list.querySelectorAll<HTMLElement>(":scope > .fr-sec")];
    const from = els.findIndex((e) => e.dataset.block === id);
    if (from < 0 || els.length < 2) return false;
    const rs = els.map((e) => e.getBoundingClientRect());
    const sy = window.scrollY;
    drag.current = { id, from, els, tops: rs.map((r) => r.top + sy), heights: rs.map((r) => r.height), gap: Math.max(0, rs[1].top - rs[0].bottom), listTop: list.getBoundingClientRect().top + sy, startY: startY + sy, y: startY, to: from };
    els.forEach((e, k) => (e.style.transition = k === from ? "none" : "transform 150ms ease"));
    // (an open length or signature picker stays open until the drop: closing it now would move the rows from under the measurements)
    setLifted(id);
    return true;
  };
  const end = (keep: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    dropped.current = Date.now();
    flip.current = { id: d.id, top: d.els[d.from].getBoundingClientRect().top };
    setLifted(null);
    setPicking(null);
    // `to` is its place among the other rows; moveBlockTo counts the rows as they are now
    if (keep && d.to !== d.from) change((p) => moveBlockTo(p, d.id, d.to > d.from ? d.to + 1 : d.to));
  };
  // the slot is drawn once the row is lifted
  useLayoutEffect(() => {
    if (lifted && drag.current) placeSlot(drag.current);
  }, [lifted]);
  // after a drop: the rows are in their new order, so nothing needs moving any more, and the dropped one glides from where it was let go
  useLayoutEffect(() => {
    const f = flip.current;
    const list = listRef.current;
    if (!f || !list) return;
    flip.current = null;
    const els = [...list.querySelectorAll<HTMLElement>(":scope > .fr-sec")];
    for (const e of els) {
      e.style.transition = "none";
      e.style.transform = "";
    }
    const el = els.find((e) => e.dataset.block === f.id);
    if (!el) return;
    const dy = f.top - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    el.style.transform = `translateY(${dy}px)`;
    void el.getBoundingClientRect(); // the glide starts from there
    el.style.transition = "transform 170ms ease";
    el.style.transform = "";
  }, [order, lifted]);
  // a row moved with the keyboard keeps the keyboard
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    listRef.current?.querySelector<HTMLElement>(`.fr-sec[data-block="${id}"] .fr-grip`)?.focus();
  }, [order]);
  // near the top or bottom of the screen the page scrolls along with a drag
  useEffect(() => {
    if (!lifted) return;
    let raf = 0;
    const tick = () => {
      const d = drag.current;
      if (d) {
        const top = (document.querySelector(".transport")?.getBoundingClientRect().bottom ?? 0) + 48;
        const bottom = window.innerHeight - 48;
        const v = d.y < top ? -Math.min(18, (top - d.y) / 3) : d.y > bottom ? Math.min(18, (d.y - bottom) / 3) : 0;
        if (v) {
          window.scrollBy(0, v);
          follow(d.y);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [lifted]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Start dragging a row. From the grip: with a mouse once it moves a little, with a finger at
   * once. Anywhere else on the row (touch only): after holding still for a moment, so a swipe
   * still scrolls the page.
   */
  const grab = (e: React.PointerEvent, x: Section, hold: boolean) => {
    if (!canDrag || !x.blockId) return;
    if (e.pointerType === "mouse" && (hold || e.button !== 0)) return;
    if (hold && (e.target as HTMLElement).closest("input, .fr-grip, .fr-pick")) return;
    if (!hold) e.stopPropagation();
    const touch = e.pointerType !== "mouse";
    const pid = e.pointerId;
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;
    let timer = 0;
    const go = (y: number) => {
      if (!begin(x.blockId, sy)) return cleanup();
      active = true;
      if (touch) navigator.vibrate?.(8);
      follow(y);
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      if (!active) {
        const far = Math.hypot(ev.clientX - sx, ev.clientY - sy);
        if (hold) {
          if (far > 10) cleanup(); // a scroll, not a hold
          return;
        }
        if (far < 4) return;
        go(ev.clientY);
      }
      follow(ev.clientY);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      cleanup();
      if (active) end(true);
    };
    const onCancel = () => {
      cleanup();
      if (active) end(false);
    };
    // once a drag is live, the page must not scroll under the finger
    const onTouchMove = (ev: TouchEvent) => {
      if (active && ev.cancelable) ev.preventDefault();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      cleanup();
      if (active) end(false);
    };
    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("touchmove", onTouchMove);
    }
    if (hold) timer = window.setTimeout(() => go(sy), 380);
    else if (touch) go(sy);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
  };
  /** ↑ ↓ on the grip (or Alt+↑ ↓ anywhere on the row) move it one place. */
  const keyMove = (e: React.KeyboardEvent, x: Section, i: number, alt: boolean) => {
    if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || (alt && !e.altKey) || !canDrag) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.key === "ArrowUp" ? -1 : 1;
    if ((dir < 0 && i === 0) || (dir > 0 && i === rows.length - 1)) return;
    refocus.current = x.blockId;
    change((p) => moveBlock(p, x.blockId, dir));
  };

  return (
    <section className="card fr-secs" aria-label="Sections">
      <div className="fr-head">
        <h2>Sections</h2>
        <span className="pill" title="How long the whole song is">{barsText(totalBars, 1)} bars · {Math.floor(secsLong / 60)}:{String(secsLong % 60).padStart(2, "0")}</span>
      </div>
      <ol className={`fr-list${lifted ? " sorting" : ""}`} ref={listRef} onClickCapture={(e) => {
        // the click that ends a drag is not a tap on whatever it ended over
        if (Date.now() - dropped.current < 350) { e.stopPropagation(); e.preventDefault(); }
      }}>
        {rows.map((x, i) => {
          const l = lenOf(x);
          const n = Math.round(l.beats / l.bar);
          const shared = !!x.partId && rows.filter((y) => y.partId === x.partId).length > 1;
          const id = x.blockId || "a";
          const sig = sigOfRow(x);
          return (
            <li key={id} className={`fr-sec ${letterClass(x.color)}${x.current ? " on" : ""}${lifted === x.blockId ? " lifted" : ""}`} data-block={x.blockId}
              onPointerDown={(e) => grab(e, x, true)} onKeyDown={(e) => keyMove(e, x, i, true)} onContextMenu={(e) => lifted && e.preventDefault()}>
              {canDrag && (
                <button className="fr-grip" aria-label={`Move ${x.label}: ${i + 1} of ${rows.length}`} title="Drag to move" onPointerDown={(e) => grab(e, x, false)} onKeyDown={(e) => keyMove(e, x, i, false)}><GripIcon /></button>
              )}
              {naming === id ? (
                <input className="fr-name" autoFocus defaultValue={x.name ?? ""} placeholder={x.letter} maxLength={MAX_NAME} aria-label={`Name of section ${x.letter}`} enterKeyHint="done"
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") e.currentTarget.blur();
                    else if (e.key === "Escape") { cancelName.current = true; e.currentTarget.blur(); }
                  }}
                  onBlur={(e) => saveName(x, e.currentTarget.value)} />
              ) : (
                <button className={`fr-letter${x.name ? " named" : ""}`} aria-pressed={x.current} title={x.current ? "Rename" : x.label}
                  aria-label={x.current ? `Section ${x.label}, the one you are working on. Rename it` : `Section ${x.label}: work on this one`} onClick={() => tapLabel(x)}>{x.label}</button>
              )}
              <span className="fr-time">
                <span className="fr-len" role="group" aria-label={`How long section ${x.label} lasts`}>
                  <button aria-label={`Make ${x.label} a bar shorter`} disabled={n <= 1} onClick={() => change((p) => setSectionBars(p, x.blockId, stepBars(l.beats, l.bar, -1)))}>−</button>
                  <button className="fr-len-n" aria-expanded={picking?.id === id && picking.what === "bars"} aria-label={`Section ${x.label}: ${n} bar${n === 1 ? "" : "s"}. Choose a length`} onClick={() => setPicking(picking?.id === id && picking.what === "bars" ? null : { id, what: "bars" })}>{barsText(l.beats, l.bar)}<small>{n === 1 ? "bar" : "bars"}</small></button>
                  <button aria-label={`Make ${x.label} a bar longer`} disabled={n >= MAX_SECTION_BARS} onClick={() => change((p) => setSectionBars(p, x.blockId, stepBars(l.beats, l.bar, 1)))}>+</button>
                </span>
                <button className={`fr-sig${x.meter ? " own" : ""}`} aria-expanded={picking?.id === id && picking.what === "sig"} aria-label={`Time signature of ${x.label}: ${sigName(sig)}${x.meter ? "" : ", the song's"}. Change it`} title={x.meter ? "Its own time signature" : "The song's time signature"}
                  onClick={() => setPicking(picking?.id === id && picking.what === "sig" ? null : { id, what: "sig" })}><b>{sig.num}</b><b>{sig.den}</b></button>
                {canUndoSig && undoSig?.block === x.blockId && <button className="fr-undo" aria-label={`Undo the time signature change in ${x.label}`} title="Undo" onClick={() => { const back = undoSig.before; setUndoSig(null); change(() => back); }}>↶</button>}
              </span>
              <span className="fr-tools">
                <button className={copied(x) ? "on" : ""} aria-label={`Copy ${x.label}: everything in it`} title="Copy" onClick={() => copy(x)}><CopyIcon /></button>
                {clip && !isSource(x) && <button className="fr-paste" aria-label={`Paste ${clip.from} into ${x.label}`} title={`Paste ${clip.from}`} onClick={() => paste(x)}><PasteIcon /></button>}
                {secs.length > 0 && <button aria-label={`Remove ${x.label}`} title="Remove" onClick={() => remove(x)}>✕</button>}
              </span>
              <span className="fr-parts">
                {tracks.map((t) => {
                  const k = filled(x, t);
                  const what = t.kind === "chords" ? `${k} chord${k === 1 ? "" : "s"}` : t.kind === "vocals" ? `${k} recording${k === 1 ? "" : "s"}` : k ? "written" : "empty";
                  return (
                    <button key={t.id} className={`fr-part k-${t.kind}${k ? " has" : ""}`} title={`${x.label} · ${t.name}: ${what}. Open it`} onClick={() => open(x.blockId, t)}>
                      {t.name}{k && (t.kind === "chords" || t.kind === "vocals") ? <small>{k}</small> : null}
                    </button>
                  );
                })}
                {shared && <button className="fr-unlink" title={`This ${x.label} is the same music as the other ${x.label}. Make it a section of its own so it can differ`} onClick={() => { change((p) => (sharedCount(p, x.blockId) > 1 ? unlinkBlock(p, x.blockId) : p)); toast("Now a section of its own"); }}>Unlink</button>}
              </span>
              {picking?.id === id && picking.what === "bars" && (
                <span className="fr-pick" role="group" aria-label={`Length of section ${x.label}, in bars`}>
                  {QUICK_BARS.map((b) => <button key={b} className={`chip${n === b ? " on" : ""}`} aria-pressed={n === b} onClick={() => { change((p) => setSectionBars(p, x.blockId, b)); setPicking(null); }}>{b}</button>)}
                </span>
              )}
              {picking?.id === id && picking.what === "sig" && (
                <span className="fr-pick fr-sigs-of" role="radiogroup" aria-label={`Time signature of section ${x.label}`}>
                  {TIME_SIGS.map((m) => (
                    <button key={sigName(m)} role="radio" aria-checked={sameSig(m, sig)} aria-label={`${sigName(m)}${sameSig(m, songSig) ? ", the song's" : ""}`} title={sameSig(m, songSig) ? "The song's" : undefined}
                      className={`sig sm${sameSig(m, sig) ? " on" : ""}${sameSig(m, songSig) ? " song" : ""}`} onClick={() => pickSig(x, m)}><b>{m.num}</b><b>{m.den}</b></button>
                  ))}
                </span>
              )}
            </li>
          );
        })}
        {lifted && <li className="fr-slot" ref={slotRef} aria-hidden="true" />}
      </ol>
      <div className="fr-add">
        <button className={`sec-add ${letterClass(newColor(prog))}`} title="A new section with its own chords, melody and length" aria-label={`New section ${newLetter(prog)}`} onClick={addNew}>+ {newLetter(prog)}</button>
        {(uniq.length ? uniq : [{ partId: "", label: "A", color: 0 }]).map((u) => (
          <button key={u.partId || "a"} className={`sec-add again ${letterClass(u.color)}`} title={`Play ${u.label} again at this point in the song`} aria-label={`${u.label} again`} onClick={() => again(u.partId)}>↻ {u.label}</button>
        ))}
      </div>
    </section>
  );
}
