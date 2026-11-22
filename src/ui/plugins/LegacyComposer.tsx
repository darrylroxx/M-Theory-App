// A composer window for a Chords, Melody or Bass track, as release 2 has it: the old page for that kind of track,
// shown through a lens onto what the window is on (a clip, or the track's draft: see windows/ClipLens), inside the
// frame every composer window has (the title bar's tools, and the strip with the clip being composed).
//
// The old page's own sound panels are not shown here: the track's sound has its own window (plugins/sound).
// A track that records has no composer: it opens the one record window (plugins/audio/RecordHost).
import { memo, useMemo, useRef } from "react";
import { melodyBase } from "../../song/melody";
import type { Key } from "../../theory/keys";
import { openOf, type Open, type OpenTarget } from "../../timeline/content";
import { phase, type Track } from "../../timeline/model";
import type { PlayerApi } from "../timeline/api";
import { GuitarView, type EmbedHost } from "../views/GuitarView";
import { ClipLens } from "../windows/ClipLens";
import { ComposerFrame, type ComposerCtl, type ComposerProps } from "./ComposerFrame";

export type { ComposerCtl, ComposerProps } from "./ComposerFrame";

const PANE = { chords: "rhythm", melody: "melody", bass: "melody", drums: "drums" } as const;

export const LegacyComposer = memo(function LegacyComposer(p: ComposerProps) {
  const { win, track, song, target, ctl } = p;
  const open = openOf(song, target, p.anchor);
  // (a track that records is shown in the record window, never here)
  if (track.kind === "vocals" || track.kind === "audio" || !open) return null;
  return (
    <ClipLens target={target} pane={PANE[track.kind]} onFrame={ctl.showKey}>
      <ComposerFrame p={p} open={open}>
        <div className="lc-scroll lc-nosound">
          {/* (one page for as long as the window is on this clip: opened on another, it starts afresh) */}
          <Body key={`${win.id}:${win.clip ?? ""}`} win={win.id} kind={track.kind} keyOf={p.keyOf} open={open} target={target} player={p.player} live={!p.hidden} heard={p.heard} ctl={ctl} />
        </div>
      </ComposerFrame>
    </ClipLens>
  );
});

/** The old page itself, told what it needs of the music by the track view's player. Drawn again only when what it is on, its player or its key changes. */
const Body = memo(function Body({ win, kind, keyOf, open, target, player, live: shown, heard, ctl }: {
  win: string; kind: Track["kind"]; keyOf: Key; open: Open; target: OpenTarget; player: PlayerApi; live: boolean; heard: boolean; ctl: ComposerCtl;
}) {
  const live = useRef({ win, open, target, player, heard, ctl });
  live.current = { win, open, target, player, heard, ctl };
  // (a closed window does no work while the music plays: its page is told nothing is playing)
  const playing = player.playing && shown;
  const low = kind === "bass" ? melodyBase(keyOf) - 24 : undefined;
  const host = useMemo<EmbedHost>(() => ({
    pane: PANE[kind as "chords" | "melody" | "bass" | "drums"],
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
    preview: (song) => live.current.ctl.preview(live.current.win, live.current.target, song),
    hearNow: () => live.current.ctl.hearNow(live.current.win),
    ...(low !== undefined ? { low } : {}),
  }), [kind, playing, low]);
  return <GuitarView embedded={host} />;
});
