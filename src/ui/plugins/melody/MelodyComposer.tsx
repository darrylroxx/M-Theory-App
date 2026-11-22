// The Melody and Bass composer: the plugin window a melody track's compose button opens, and a bass track's. One
// composer serves both: the note grid of the old Melody page, here with every octave a melody may hold (seven, C1
// to C8) in a box that scrolls. A bass opens low (on its E1), a melody on its home note, a clip with notes on those
// notes; one press moves the view a whole octave, and a small overview of the whole range stands beside the grid.
//
// Everything the Melody page had for writing a tune is here: tap and drag to place notes, the grid's steps (with
// triplets), a tab for every bar, copy the bar before, the notes of the key only, hear a note by its name, the
// chords of the song over the grid with a dot on the notes that fit them, the moving line and Follow, undo, Clear,
// and Harmonize. New here: a note's right end can be dragged to give it a length, and every note can be moved an
// octave up or down. What is written goes into the clip the window is on, or into the track's draft. The sound has
// its own window (plugins/sound); the strip at the bottom shows the clip being composed, to be dragged onto a melody
// or a bass lane.
import { memo, useCallback, useMemo, useRef } from "react";
import type { Melody } from "../../../song/melody";
import { sigBeats } from "../../../song/meter";
import type { Key } from "../../../theory/keys";
import { openOf, writeOpen, type Open, type OpenTarget } from "../../../timeline/content";
import { draftAnchor } from "../../../timeline/edit";
import { chordsUnderSpan, harmonyState5 } from "../../../timeline/lens";
import { phase, type TimelineSong, type TuneTrack } from "../../../timeline/model";
import { useApp5 } from "../../app5";
import { useBarsView } from "../../components/BarsControl";
import { MelodyGrid } from "../../components/MelodyGrid";
import type { PlayerApi } from "../../timeline/api";
import { V4View } from "../../windows/ClipLens";
import { ComposerFrame, type ComposerCtl, type ComposerProps } from "../ComposerFrame";
import { canHarmonize } from "../harmonize/host";
import { GRID_OCTAVES, emptySpan } from "./range";
import "./melody.css";

export const MelodyComposer = memo(function MelodyComposer(p: ComposerProps) {
  const { track, song, target } = p;
  const open = openOf(song, target, p.anchor);
  if ((track.kind !== "melody" && track.kind !== "bass") || !open || open.kind !== "melody") return null;
  return (
    <V4View>
      <ComposerFrame p={p} open={open}>
        <Body win={p.win.id} track={track} open={open} target={target} song={song} keyOf={p.keyOf} anchor={p.anchor} player={p.player} shown={!p.hidden} heard={p.heard} harmonizing={p.harmonizing} ctl={p.ctl} />
      </ComposerFrame>
    </V4View>
  );
});

/** A melody as a clip keeps it: whether it is heard is the clip's own switch, not part of the notes. */
function plain(m: Melody): Melody {
  if (!("on" in m)) return m;
  const { on: _on, ...notes } = m;
  return notes;
}

/** The grid itself, as the composer. Its own parts are drawn again only for what changed in them (see `MelodyGrid`). */
const Body = memo(function Body({ win, track, open, target, song, keyOf, anchor, player, shown, heard, harmonizing, ctl }: {
  win: string; track: TuneTrack; open: Open; target: OpenTarget; song: TimelineSong; keyOf: Key; anchor: number; player: PlayerApi; shown: boolean; heard: boolean; harmonizing: boolean; ctl: ComposerCtl;
}) {
  const app = useApp5();
  const view = useBarsView();
  const live = useRef({ app, win, target, open, player, heard, ctl });
  live.current = { app, win, target, open, player, heard, ctl };
  const melody = open.content as Melody;
  const bass = track.kind === "bass";

  /** every change the grid makes: worked out on the song as it is this moment, and written into the open clip or the draft */
  const setMelody = useCallback((fn: (m: Melody) => Melody, control?: string) => {
    const l = live.current;
    const s = l.app.peek();
    const now = openOf(s.song, l.target, draftAnchor(s.song, s.session));
    if (!now || now.kind !== "melody") return;
    const before = now.content as Melody;
    const after = plain(fn(before));
    if (after === before) return;
    l.app.edit(`Edit ${now.track.name}`, (x) => writeOpen(x, l.target, after, draftAnchor(x, s.session)), control ? `tune:${now.track.id}:${control}` : undefined);
  }, []);
  const getPos = useCallback(() => {
    const { open: o, heard: h, player: pl } = live.current;
    const b = pl.getBeat();
    if (b === null || !h) return null;
    const c = o.clip;
    // a placed clip: how far into its content the play line is; a draft: how far past its anchor
    if (c) return b < c.start - 1e-6 || b >= c.start + c.len - 1e-6 ? null : phase(c, b);
    return b < o.span.from - 1e-6 || b >= o.span.to - 1e-6 ? null : b - o.span.from;
  }, []);

  // the chords the song plays under the open bars stand over the grid (the same list while they say the same, so the grid is not drawn again for nothing)
  const { from, to } = open.span;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const under = useMemo(() => chordsUnderSpan(song, { from, to }), [song.clips, song.tracks, song.mix, from, to]);
  const underKey = JSON.stringify(under.map((c) => [c.ref, c.beats, !!c.rest]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chords = useMemo(() => under, [underKey]);

  // Harmonize: its button asks the track view for the one harmony sheet, which is shown inside this window
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const can = useMemo(() => canHarmonize(song, target, keyOf, anchor), [song.clips, song.tracks, song.meter, song.sigs, target, keyOf, anchor]);
  const onHarmonize = useCallback((el: HTMLElement | null) => live.current.ctl.harmonize(live.current.win, "melody", el), []);
  // a clip Harmonize wrote can be written again (with another option), while what it was written from is still there
  const clip = open.clip;
  const written = !!clip && clip.kind === "melody" && !!clip.harmony && !!track.harmony;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const again = useMemo(() => (written && clip ? harmonyState5(song, keyOf, clip.id) : null), [written, clip?.id, song.clips, song.tracks, keyOf]);
  const tools = again?.source ? (
    <button className={`hz-again mel-again${again.stale ? " stale" : ""}`} aria-label={again.stale ? `Write ${track.name} again: its source has changed` : `Write ${track.name} again`}
      title={again.stale ? "Written by Harmonize, and its source has changed: write it again, or choose another harmony" : "Written by Harmonize: write it again, or choose another harmony"}
      onClick={() => live.current.ctl.harmonize(live.current.win, "melody", null, true)}>⟳</button>
  ) : undefined;

  // The view and the grid's own undo belong to what the window is on. Put on another clip they start afresh; not
  // when the new clip is a copy just laid on a lane from here (the same tune: the work goes on in it, where it was).
  const was = useRef({ clip: target.clip, content: melody, n: 0 });
  if (was.current.clip !== target.clip) {
    const same = was.current.content === melody || JSON.stringify(plain(was.current.content)) === JSON.stringify(plain(melody));
    was.current = { clip: target.clip, content: melody, n: was.current.n + (same ? 0 : 1) };
  } else was.current.content = melody;
  const place = `${win}:${was.current.n}`;
  const opens = useMemo(() => emptySpan(bass, keyOf), [bass, keyOf]);

  return (
    <MelodyGrid octaves={GRID_OCTAVES} opens={opens} name={track.name} tools={tools} fresh={place} place={place} melody={melody} setMelody={setMelody} keyOf={keyOf}
      bar={sigBeats(open.sig)} chords={chords} playing={player.playing && shown} getPos={getPos} shown={view.shown} follow={view.follow} active={shown}
      onHarmonize={onHarmonize} canHarmonize={can} harmonizing={harmonizing} />
  );
});
