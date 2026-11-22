// What every sound window has round its sound: the plugin window, a title that says whose sound it is, and in the
// title bar "Copy sound", "Paste sound" (only a sound of the same kind of track) and the bypass switch: while that
// is on, the track is heard without its effects, and nothing in the idea is changed.
import type { ReactNode } from "react";
import type { Key } from "../../theory/keys";
import type { TimelineSong, Track, WinState } from "../../timeline/model";
import { CopyIcon, KindIcon, PasteIcon } from "../icons";
import type { PlayerApi } from "../timeline/api";
import { Window } from "../windows/Window";

type Rect = Pick<WinState, "x" | "y" | "w" | "h">;

/** What a sound window is handed by the host. */
export interface SoundProps {
  win: WinState;
  track: Track;
  song: TimelineSong;
  keyOf: Key;
  focused: boolean;
  /** closed: kept as it was left, off the screen, doing no work */
  hidden: boolean;
  z: number;
  player: PlayerApi;
  /** the track is heard without its effects just now */
  bypassed: boolean;
  /** is there a copied sound this track can take? */
  canPaste: boolean;
  /** every beat divides in three where the track is being worked on (6/8, 9/8, 12/8): a synth's arp is fitted to it */
  compound: boolean;
  ctl: SoundCtl;
}

/** What a sound window asks of the host. Every function names its window or its track, so one object serves them all. */
export interface SoundCtl {
  focus(win: string): void;
  close(win: string): void;
  move(win: string, r: Rect): void;
  copy(track: string): void;
  paste(track: string): void;
  bypass(track: string): void;
}

export function SoundFrame({ p, children }: { p: SoundProps; children: ReactNode }) {
  const { win, track, ctl } = p;
  return (
    <Window win={win} focused={p.focused} hidden={p.hidden} z={p.z} title={`${track.name} · sound`} icon={<KindIcon kind={track.kind} />}
      onFocus={() => ctl.focus(win.id)} onClose={() => ctl.close(win.id)} onMove={(r) => ctl.move(win.id, r)}
      tools={
        <>
          <button className={`chip sw-bypass${p.bypassed ? " on" : ""}`} role="switch" aria-checked={p.bypassed} aria-label={`Bypass the effects of ${track.name}`}
            title={p.bypassed ? "Bypassed: heard without its effects. Nothing in the idea is changed" : "Bypass: hear this track without its effects"} onClick={() => ctl.bypass(track.id)}>Bypass</button>
          <button className="icon-btn" title="Copy sound" aria-label={`Copy the sound of ${track.name}`} onClick={() => ctl.copy(track.id)}><CopyIcon /></button>
          <button className="icon-btn clip-paste" title={p.canPaste ? "Paste sound" : "Paste sound: copy the sound of a track of this kind first"} aria-label={`Paste a sound onto ${track.name}`} disabled={!p.canPaste} onClick={() => ctl.paste(track.id)}><PasteIcon /></button>
        </>
      }>
      {children}
    </Window>
  );
}
