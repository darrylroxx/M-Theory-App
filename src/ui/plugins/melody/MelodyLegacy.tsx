// The composer window of a Melody track and of a Bass track, until the Melody and Bass plugin replaces it (step 4 of
// the track view rework): the old Melody page, shown through a lens onto what the window is on (a clip, or the
// track's draft: see windows/ClipLens), inside the frame every composer window has (the title bar's tools, and the
// strip with the clip being composed). A Bass track is the same page with its grid two octaves lower.
//
// The old page's own sound panels are not shown here: the track's sound has its own window (plugins/sound).
// Harmonize is not the page's either: its button asks the track view for the one harmony sheet
// (plugins/harmonize/host), which is shown inside this window.
//
// This file is the Melody and Bass tracks' alone. The Chords track has its own (plugins/chords/ChordsLegacy).
import { memo, useMemo, useRef } from "react";
import { melodyBase } from "../../../song/melody";
import type { Key } from "../../../theory/keys";
import { openOf, type Open } from "../../../timeline/content";
import { phase } from "../../../timeline/model";
import type { PlayerApi } from "../../timeline/api";
import { GuitarView, type EmbedHost } from "../../views/GuitarView";
import { ClipLens } from "../../windows/ClipLens";
import { ComposerFrame, type ComposerCtl, type ComposerProps } from "../ComposerFrame";
import "./melody.css";

export const MelodyLegacy = memo(function MelodyLegacy(p: ComposerProps) {
  const { win, track, song, target, ctl } = p;
  const open = openOf(song, target, p.anchor);
  if ((track.kind !== "melody" && track.kind !== "bass") || !open) return null;
  return (
    <ClipLens target={target} pane="melody" onFrame={ctl.showKey}>
      <ComposerFrame p={p} open={open}>
        <div className="lc-scroll lc-nosound">
          {/* (one page for as long as the window is on this clip: opened on another, it starts afresh) */}
          <Body key={`${win.id}:${win.clip ?? ""}`} win={win.id} bass={track.kind === "bass"} keyOf={p.keyOf} open={open} player={p.player} live={!p.hidden} heard={p.heard} harmonizing={p.harmonizing} ctl={ctl} />
        </div>
      </ComposerFrame>
    </ClipLens>
  );
});

/** The old Melody page itself, told what it needs of the music by the track view's player. Drawn again only when what it is on, its player or its key changes. */
const Body = memo(function Body({ win, bass, keyOf, open, player, live: shown, heard, harmonizing, ctl }: {
  win: string; bass: boolean; keyOf: Key; open: Open; player: PlayerApi; live: boolean; heard: boolean; harmonizing: boolean; ctl: ComposerCtl;
}) {
  const live = useRef({ win, open, player, heard, ctl });
  live.current = { win, open, player, heard, ctl };
  // (a closed window does no work while the music plays: its page is told nothing is playing)
  const playing = player.playing && shown;
  // a bass is written two octaves under a melody
  const low = bass ? melodyBase(keyOf) - 24 : undefined;
  const host = useMemo<EmbedHost>(() => ({
    pane: "melody",
    playing,
    togglePlay: () => live.current.player.toggle(),
    getPos: () => {
      const { open: o, heard: on } = live.current;
      const b = live.current.player.getBeat();
      if (b === null || !on) return null;
      const c = o.clip;
      // a placed clip: how far into its content the play line is; a draft: how far past its anchor
      if (c) return b < c.start - 1e-6 || b >= c.start + c.len - 1e-6 ? null : phase(c, b);
      return b < o.span.from - 1e-6 || b >= o.span.to - 1e-6 ? null : b - o.span.from;
    },
    hearNow: () => live.current.ctl.hearNow(live.current.win),
    onHarmonize: (kind, anchor, again) => live.current.ctl.harmonize(live.current.win, kind, anchor, again),
    harmonizing,
    endHarmonize: () => live.current.ctl.endHarmonize(live.current.win),
    ...(low !== undefined ? { low } : {}),
  }), [playing, harmonizing, low]);
  return <GuitarView embedded={host} />;
});
