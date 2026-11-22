// One track's lane: the clips of the track that are on screen (and a screen either side), each where it plays.
// A press on its empty part places the cursor; a drag there draws the box that selects; a double-click makes a new
// clip on a track of notes. Its element says which track it is and which kind of clip it takes, for anything dropped.
import { memo, useMemo } from "react";
import { sameSig, sigName } from "../../song/meter";
import type { Key } from "../../theory/keys";
import { barMap } from "../../timeline/bars";
import { CLIP_OF, clipEnd, type Clip, type NoteClip, type Take5, type TimelineSong, type Track } from "../../timeline/model";
import { letterClass } from "../letters";
import { ClipView, type ClipCtl } from "./ClipView";
import { ChordBlock, DrumBlock, MelodyBlock } from "./draw";
import { barsLabel, inView, type View } from "./gestures";
import { colorOf } from "./TrackHead";

/** What a lane tells the view (and, through it, what its clips do). The same object for every lane, always. */
export interface LaneCtl extends ClipCtl {
  laneDown(e: React.PointerEvent<HTMLElement>, track: string): void;
  laneMove(e: React.PointerEvent<HTMLElement>): void;
  laneUp(e: React.PointerEvent<HTMLElement>): void;
  laneCancel(e: React.PointerEvent<HTMLElement>): void;
  laneNew(e: React.MouseEvent<HTMLElement>, track: string): void;
  laneMenu(e: React.MouseEvent<HTMLElement>, track: string): void;
}

export const Lane = memo(function Lane({ track, song, keyOf, view, width, selected, on, quiet, refuse, accept, stale, preview, ghost, peaks, ctl }: {
  track: Track;
  song: TimelineSong;
  keyOf: Key;
  view: View;
  /** how wide the lanes are on screen */
  width: number;
  /** the selected clips */
  selected: readonly string[];
  /** its track is the selected one */
  on: boolean;
  /** its track is not heard */
  quiet: boolean;
  /** a clip is being dragged that this track does not take */
  refuse: boolean;
  /** …or that it does */
  accept: boolean;
  stale?: ReadonlySet<string>;
  /** a clip of this track as it is while its edge is being dragged */
  preview?: Clip | null;
  /** what is being composed on this track, where it is heard with the song (it is not on the timeline: it only shows where it sounds) */
  ghost?: NoteClip | null;
  peaks?: (take: Take5) => Float32Array | undefined;
  ctl: LaneCtl;
}) {
  const map = barMap(song);
  const mine = useMemo(() => song.clips.filter((c) => c.track === track.id), [song.clips, track.id]);
  // every melody clip of the track is drawn on one scale
  const range = useMemo(() => {
    const all = mine.flatMap((c) => (c.kind === "melody" ? c.content.notes.map((n) => n.midi) : []));
    return all.length ? { lo: Math.min(...all) - 1, hi: Math.max(...all) + 1 } : { lo: 55, hi: 79 };
  }, [mine]);
  const takes = "takes" in track ? track.takes : undefined;
  const shown = inView(song, view, width).filter((c) => c.track === track.id);
  const color = colorOf(track);
  return (
    <div className={`tlv-lane k-${track.kind}${on ? " on" : ""}${quiet ? " quiet" : ""}${refuse ? " refuse" : ""}${accept ? " accept" : ""}`} data-lane={track.id} data-kind={CLIP_OF[track.kind]}
      onPointerDown={(e) => ctl.laneDown(e, track.id)} onPointerMove={ctl.laneMove} onPointerUp={ctl.laneUp} onPointerCancel={ctl.laneCancel}
      onDoubleClick={(e) => ctl.laneNew(e, track.id)} onContextMenu={(e) => ctl.laneMenu(e, track.id)}>
      <div className="tlv-strip" style={{ transform: `translateX(${(-view.scroll * view.pxPerBeat).toFixed(2)}px)` }}>
        {shown.map((c0) => {
          const c = preview && preview.id === c0.id ? preview : c0;
          const end = clipEnd(c, song);
          // a harmony written to play instead of this track is heard here, not this clip
          const covered = c.kind === "chords" && song.clips.some((o) => o.kind === "chords" && o.instead === track.id && !o.mute && o.start < end && clipEnd(o, song) > c.start);
          // after a tempo change a later recording may start over this one's end: it is drawn up to there
          const over = c.kind === "audio" ? Math.min(Infinity, ...mine.filter((o) => o.id !== c.id && o.start > c.start && o.start < end - 1e-6).map((o) => o.start)) : Infinity;
          const take = c.kind === "audio" ? takes?.find((k) => k.id === c.take) : undefined;
          return (
            <ClipView key={c.id} clip={c} ppb={view.pxPerBeat} bpm={song.bpm} color={color} ctl={ctl} keyOf={keyOf} lo={range.lo} hi={range.hi}
              label={`${track.name} clip, ${barsLabel(map, c.start, end)}`}
              selected={selected.includes(c.id)} quiet={covered} stale={!!stale?.has(c.id)}
              tag={c.kind !== "audio" && !sameSig(c.sig, map.sigAt(c.start)) ? sigName(c.sig) : undefined}
              cut={over < Infinity ? over - c.start : undefined}
              mutes={"kit" in track ? track.kit.mutes : undefined}
              take={take} peaks={take && peaks ? peaks(take) : undefined} />
          );
        })}
        {ghost && (
          <div className={`tlc k-${ghost.kind} ${letterClass(color)} tlc-draft`} style={{ left: ghost.start * view.pxPerBeat, width: Math.max(3, ghost.len * view.pxPerBeat) }} aria-hidden="true" title="The draft, where it is heard. Drag it from its window to place it">
            <div className="tlc-in">
              {ghost.kind === "chords" ? <ChordBlock clip={ghost} ppb={view.pxPerBeat} keyOf={keyOf} />
                : ghost.kind === "melody" ? <MelodyBlock clip={ghost} ppb={view.pxPerBeat} lo={range.lo} hi={range.hi} />
                : <DrumBlock clip={ghost} ppb={view.pxPerBeat} mutes={"kit" in track ? track.kit.mutes : undefined} />}
            </div>
            <span className="tlc-draft-tag">draft</span>
          </div>
        )}
      </div>
    </div>
  );
});
