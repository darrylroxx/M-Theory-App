// The Drums composer: the plugin window a drums track's compose button opens. Everything the drum page had for
// writing a rhythm is here: the kit beside the rhythm, every rhythm of the library by style and the user's own, the
// grid with Edit, Undo, Cancel and Save, the brush, Vary, copy the bar before, Clear, a tab for every bar, and
// Swing. What is written goes into the clip the window is on, or into the track's draft; the kit is the track's.
// The strip at the bottom shows the clip being composed, to be dragged onto a drums lane.
import { memo, useCallback, useMemo, useRef } from "react";
import type { Beat, BeatPattern, Groove } from "../../../audio/beats";
import type { DrumId } from "../../../audio/drums";
import { contentBars, openOf, type Open, type OpenTarget } from "../../../timeline/content";
import { draftAnchor } from "../../../timeline/edit";
import { phase, type DrumsTrack } from "../../../timeline/model";
import { useApp5 } from "../../app5";
import { useBarsView } from "../../components/BarsControl";
import { DrumMachine } from "../../components/DrumMachine";
import type { PlayerApi } from "../../timeline/api";
import { V4View } from "../../windows/ClipLens";
import { ComposerFrame, type ComposerCtl, type ComposerProps } from "../ComposerFrame";
import { beatOf, controlOf, pickRhythm, writeBeat } from "./beat";
import "./drums.css";

export const DrumsComposer = memo(function DrumsComposer(p: ComposerProps) {
  const { track, song, target } = p;
  const open = openOf(song, target, p.anchor);
  if (track.kind !== "drums" || !open) return null;
  return (
    <V4View>
      <ComposerFrame p={p} open={open}>
        <Body win={p.win.id} track={track} open={open} target={target} bpm={song.bpm} player={p.player} shown={!p.hidden} heard={p.heard} ctl={p.ctl} />
      </ComposerFrame>
    </V4View>
  );
});

/** The machine itself, as the composer. Drawn again only when what it is on, its kit or the player changes. */
const Body = memo(function Body({ win, track, open, target, bpm, player, shown, heard, ctl }: {
  win: string; track: DrumsTrack; open: Open; target: OpenTarget; bpm: number; player: PlayerApi; shown: boolean; heard: boolean; ctl: ComposerCtl;
}) {
  const app = useApp5();
  const view = useBarsView();
  const live = useRef({ app, win, target, open, player, heard, ctl });
  live.current = { app, win, target, open, player, heard, ctl };
  const content = open.content as Groove;
  const on = !open.clip?.mute;
  const beat = useMemo(() => beatOf(content, track.kit, on), [content, track.kit, on]);

  /** every change the machine makes: worked out on the song as it is this moment, and written where each part belongs */
  const setBeat = useCallback((fn: (b: Beat) => Beat) => {
    const l = live.current;
    const s = l.app.peek();
    const anchor = draftAnchor(s.song, s.session);
    const now = openOf(s.song, l.target, anchor);
    const t = now?.track;
    if (!now || !t || t.kind !== "drums") return;
    const before = beatOf(now.content as Groove, t.kit, !now.clip?.mute);
    const after = fn(before);
    if (after === before) return;
    l.app.edit(`Edit ${t.name}`, (song) => writeBeat(song, l.target, draftAnchor(song, s.session), before, after), controlOf(t.id, before, after));
  }, []);
  const onPick = useCallback((p: BeatPattern) => {
    setBeat((b) => pickRhythm(b, p));
    // heard straight away
    live.current.ctl.hearNow(live.current.win);
  }, [setBeat]);
  const getPos = useCallback(() => {
    const { open: o, heard: h, player: pl } = live.current;
    const b = pl.getBeat();
    if (b === null || !h) return null;
    const c = o.clip;
    // a placed clip: how far into its content the play line is; a draft: how far past its anchor
    if (c) return b < c.start - 1e-6 || b >= c.start + c.len - 1e-6 ? null : phase(c, b);
    return b < o.span.from - 1e-6 || b >= o.span.to - 1e-6 ? null : b - o.span.from;
  }, []);
  const onSound = useCallback((_id: DrumId) => live.current.ctl.sound(track.id), [track.id]);

  // An edit in progress belongs to what the window is on. Put on another clip, the edit is let go and the grid starts
  // at bar 1; not when the new clip is a copy just laid on a lane from here (the same rhythm: the edit goes on in it).
  const was = useRef({ clip: target.clip, content, n: 0 });
  if (was.current.clip !== target.clip) {
    const same = was.current.content === content || JSON.stringify(was.current.content) === JSON.stringify(content);
    was.current = { clip: target.clip, content, n: was.current.n + (same ? 0 : 1) };
  } else was.current.content = content;

  return (
    <DrumMachine trackId={track.id} resetKey={was.current.n} show="compose" bpm={bpm} beat={beat} setBeat={setBeat} onPick={onPick} onSound={onSound}
      playing={player.playing && shown} frame={contentBars(content)} getPos={getPos} shown={view.shown} follow={view.follow} active={shown} />
  );
});
