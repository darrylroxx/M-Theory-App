// The strip along the bottom of every composer window: the clip being composed, drawn as it will look on the
// timeline, to be dragged onto any lane of its own kind. Beside it: New (a fresh empty draft), ▶ (its bars go round,
// with the song or alone), how many bars it is long, copy and paste, and "Fit to these bars" when it is written in
// another time signature than the bars it lies in.
//
// The strip changes nothing itself: everything it can do comes in as `on`.
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MAX_BARS } from "../../audio/beats";
import { QUICK_BARS } from "../../song/frame";
import type { Melody } from "../../song/melody";
import type { Key } from "../../theory/keys";
import { contentBars, contentHas, type Open } from "../../timeline/content";
import { contentBeats, cycles, type NoteClip } from "../../timeline/model";
import { CopyIcon, GripIcon, PasteIcon } from "../icons";
import { letterClass } from "../letters";
import { ChordBlock, DrumBlock, MelodyBlock } from "../timeline/draw";
import { colorOf } from "../timeline/TrackHead";
import type { DragLook } from "./dragging";

/** What the strip asks of its window. */
export interface StripCtl {
  /** a fresh, empty draft */
  fresh(): void;
  /** ▶: its bars go round (again: they stop) */
  play(): void;
  setAlone(on: boolean): void;
  /** make what is open this many bars long */
  bars(n: number): void;
  copy(): void;
  paste(): void;
  /** refit what is open to the bars it lies in */
  fit(): void;
  /** the clip was pressed: it may be dragged onto the timeline */
  drag(e: ReactPointerEvent<HTMLElement>, look: DragLook): void;
}

/** What is open as it is drawn: a placed clip as it lies (from beat 0), a draft as a clip one round of its content long. */
export function lookOf(open: Open): NoteClip {
  if (open.clip) return { ...open.clip, start: 0 };
  const clip = { id: "draft", track: open.track.id, kind: open.kind, start: 0, len: 1, off: 0, sig: open.sig, content: open.content } as NoteClip;
  return { ...clip, len: contentBeats(clip) };
}
/** The lowest and highest note a melody is drawn between. */
function rangeOf(c: NoteClip): { lo: number; hi: number } {
  const all = c.kind === "melody" ? (c.content as Melody).notes.map((n) => n.midi) : [];
  return all.length ? { lo: Math.min(...all) - 1, hi: Math.max(...all) + 1 } : { lo: 55, hi: 79 };
}

/** How wide the clip is drawn before the strip is measured. */
const GUESS_W = 420;

export function ClipStrip({ open, keyOf, playing, alone, canPaste, fit, on }: {
  /** what the window is on (see timeline/content) */
  open: Open;
  keyOf: Key;
  /** this window's ▶ is going round its bars */
  playing: boolean;
  /** ▶ plays the track on its own */
  alone: boolean;
  /** is there something copied that this track can hold? */
  canPaste: boolean;
  /** it is written in another time signature than the bars it lies in */
  fit: boolean;
  on: StripCtl;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(GUESS_W);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const look = lookOf(open);
  const { lo, hi } = rangeOf(look);
  const color = colorOf(open.track);
  const ppb = width / Math.max(1, look.len);
  const bars = contentBars(open.content);
  const name = open.track.name;
  const what = open.clip ? "clip" : "draft";
  const empty = !contentHas(open.kind, open.content);
  const lane = open.kind === "melody" ? "melody or bass" : open.kind;
  return (
    <div className="cs" role="group" aria-label={`The ${what} of ${name}`}>
      <button className="btn sm cs-new" title="Start a fresh, empty draft (what is on the timeline stays)" aria-label={`New draft on ${name}`} onClick={on.fresh}>New</button>
      <span className="cs-play">
        <button className={`cs-go${playing ? " on" : ""}`} aria-pressed={playing} aria-label={playing ? "Stop" : `Hear these bars go round${alone ? ", this track alone" : " with the song"}`} title={playing ? "Stop" : "Hear these bars go round"} onClick={on.play}>{playing ? "■" : "▶"}</button>
        <button className={`chip cs-alone${alone ? " on" : ""}`} role="switch" aria-checked={alone} title={alone ? "▶ plays this track on its own" : "▶ plays it with the rest of the song"} onClick={() => on.setAlone(!alone)}>alone</button>
      </span>
      <div className={`cs-clip tlc k-${look.kind} ${letterClass(color)}${open.clip?.mute ? " muted" : ""}`} ref={box} role="button" tabIndex={0}
        aria-label={`${name} ${what}, ${bars} bar${bars === 1 ? "" : "s"}: drag it onto a ${lane} lane`} title={`Drag onto a ${lane} lane: a separate copy lands on the bar under the pointer`}
        onPointerDown={(e) => on.drag(e, { clip: look, color, lo, hi })} onContextMenu={(e) => e.preventDefault()}>
        <i className="cs-grip" aria-hidden="true"><GripIcon /></i>
        <div className="tlc-in">
          {look.kind === "chords" ? <ChordBlock clip={look} ppb={ppb} keyOf={keyOf} />
            : look.kind === "melody" ? <MelodyBlock clip={look} ppb={ppb} lo={lo} hi={hi} />
            : <DrumBlock clip={look} ppb={ppb} />}
        </div>
        {cycles(look).slice(1).map((r) => <i key={r.at} className="tlc-notch" style={{ left: r.at * ppb }} />)}
        {empty && <span className="cs-hint">Nothing in it yet</span>}
      </div>
      {fit && <button className="btn sm cs-fit" title="It is written in another time signature than the bars it lies in: fit it to them" onClick={on.fit}>Fit to these bars</button>}
      <span className="cs-len" role="group" aria-label="Length">
        <button aria-label="One bar shorter" disabled={bars <= 1} onClick={() => on.bars(bars - 1)}>−</button>
        <select aria-label="Length in bars" title="How many bars it is long" value={bars} onChange={(e) => on.bars(Number(e.target.value))}>
          {[...new Set([...QUICK_BARS, bars])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>{n} bar{n === 1 ? "" : "s"}</option>)}
        </select>
        <button aria-label="One bar longer" disabled={bars >= MAX_BARS} onClick={() => on.bars(bars + 1)}>+</button>
      </span>
      <span className="cs-clipb">
        <button className="icon-btn" title="Copy what is open" aria-label={`Copy this ${what} of ${name}`} onClick={on.copy}><CopyIcon /></button>
        <button className="icon-btn clip-paste" title="Paste into what is open" aria-label={canPaste ? `Paste into this ${what} of ${name}` : "Paste: copy a clip of this kind first"} disabled={!canPaste} onClick={on.paste}><PasteIcon /></button>
      </span>
    </div>
  );
}

/** The open clip's switch in the title bar: heard or not. A draft has none (it is not on the timeline yet). */
export function ClipSwitch({ clip, onMute }: { clip: NoteClip | undefined; onMute(id: string): void }) {
  if (!clip) return null;
  return (
    <button className={`chip lc-on${clip.mute ? "" : " on"}`} role="switch" aria-checked={!clip.mute} aria-label={`This clip is ${clip.mute ? "off" : "on"}`} title={clip.mute ? "Off: kept, but not heard" : "On: heard with the song"} onClick={() => onMute(clip.id)}>{clip.mute ? "Off" : "On"}</button>
  );
}
