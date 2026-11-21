// One clip on its lane: its small drawing, a notch wherever its content starts again, a tag when it is written in
// another time signature than the bars it lies in, a dot when it is a harmony whose source has changed, and faint
// when it is muted or not heard. It is drawn again only when the clip itself or the zoom changes.
import { memo } from "react";
import type { DrumId } from "../../audio/drums";
import type { Key } from "../../theory/keys";
import { clipBeats, cycles, frameCycles, framesToBeats, type Clip, type Take5 } from "../../timeline/model";
import { letterClass } from "../letters";
import { ChordBlock, DrumBlock, MelodyBlock, TakeBlock } from "./draw";

/** What a clip tells the view when it is pressed, dragged, double-clicked or right-clicked. The same object for every clip, always. */
export interface ClipCtl {
  clipDown(e: React.PointerEvent<HTMLElement>, id: string): void;
  clipMove(e: React.PointerEvent<HTMLElement>): void;
  clipUp(e: React.PointerEvent<HTMLElement>): void;
  clipCancel(e: React.PointerEvent<HTMLElement>): void;
  clipOpen(id: string): void;
  clipMenu(e: React.MouseEvent<HTMLElement>, id: string): void;
}

/** Where, inside a clip, its content starts again (beats from its left edge). */
export function notchesIn(clip: Clip, bpm: number, rate: number): number[] {
  return clip.kind === "audio" ? frameCycles(clip).slice(1).map((r) => framesToBeats(r.at, rate, bpm)) : cycles(clip).slice(1).map((r) => r.at);
}

export const ClipView = memo(function ClipView({ clip, ppb, bpm, color, label, selected, quiet, stale, tag, cut, keyOf, lo, hi, mutes, take, peaks, ctl }: {
  clip: Clip;
  /** pixels to a beat */
  ppb: number;
  bpm: number;
  /** its track's colour, 0–7 */
  color: number;
  /** what it is, said aloud: "Chords clip, bars 1–8" */
  label: string;
  selected: boolean;
  /** not heard: another clip plays instead of it */
  quiet?: boolean;
  /** a harmony whose source changed since it was written */
  stale?: boolean;
  /** its own time signature, when the bars it lies in have another */
  tag?: string;
  /** another clip starts over its end (after a tempo change): it is drawn only this many beats long */
  cut?: number;
  keyOf: Key;
  /** the lowest and highest note of its track (melody and bass) */
  lo: number; hi: number;
  /** the drums its track's kit keeps silent */
  mutes?: DrumId[];
  /** the take it plays, and how loud that is along its length (a recorded clip) */
  take?: Take5; peaks?: Float32Array;
  ctl: ClipCtl;
}) {
  const rate = take && take.rate > 0 ? take.rate : 48000;
  const len = clipBeats(clip, bpm, rate);
  const shown = cut !== undefined ? Math.min(len, cut) : len;
  const w = Math.max(3, shown * ppb);
  return (
    <div className={`tlc k-${clip.kind} ${letterClass(color)}${selected ? " sel" : ""}${clip.mute ? " muted" : ""}${quiet ? " quiet" : ""}`} data-clip={clip.id}
      role="button" aria-pressed={selected} aria-label={label} title={clip.mute ? "Muted" : quiet ? "Not heard here: another clip plays instead" : undefined}
      style={{ left: clip.start * ppb, width: w }}
      onPointerDown={(e) => ctl.clipDown(e, clip.id)} onPointerMove={ctl.clipMove} onPointerUp={ctl.clipUp} onPointerCancel={ctl.clipCancel}
      onDoubleClick={(e) => { e.stopPropagation(); ctl.clipOpen(clip.id); }} onContextMenu={(e) => ctl.clipMenu(e, clip.id)}>
      <div className="tlc-in">
        {clip.kind === "chords" ? <ChordBlock clip={clip} ppb={ppb} keyOf={keyOf} />
          : clip.kind === "melody" ? <MelodyBlock clip={clip} ppb={ppb} lo={lo} hi={hi} />
          : clip.kind === "drums" ? <DrumBlock clip={clip} ppb={ppb} mutes={mutes} />
          : <TakeBlock clip={clip} take={take} peaks={peaks} ppb={ppb} bpm={bpm} />}
      </div>
      {notchesIn(clip, bpm, rate).filter((x) => x < shown - 1e-6).map((x) => <i key={x} className="tlc-notch" style={{ left: x * ppb }} />)}
      {tag && <span className="tlc-sig" title={`Written in ${tag}`}>{tag}</span>}
      {stale && <i className="tlc-dot" title="What it was written from has changed: ⟳ on the track writes it again" />}
      <i className="tlc-grip l" data-edge="left" />
      <i className="tlc-grip r" data-edge="right" />
    </div>
  );
});
