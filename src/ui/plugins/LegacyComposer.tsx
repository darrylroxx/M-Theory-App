// A composer window for a Chords, Melody, Bass or Drums track, as release 1 has it: the old page for that kind of
// track, shown through a lens onto one clip (windows/ClipLens), inside a plugin window. The window's title bar holds
// what the old page's top strip held: which bars are open, the mute or solo mark, "plays instead", the clip's On / Off
// switch, bars on screen, and copy and paste of what is open.
//
// A track that records gets a window that says recording is on its way (it arrives with the next step).
import { useMemo, useRef, type ReactNode } from "react";
import { melodyBase } from "../../song/melody";
import type { Key } from "../../theory/keys";
import type { Target } from "../../timeline/lens";
import { phase, type NoteClip, type TimelineSong, type Track, type WinState } from "../../timeline/model";
import { BarsControl } from "../components/BarsControl";
import { MixMark } from "../components/MixMark";
import { CopyIcon, PasteIcon } from "../icons";
import type { Progression } from "../state";
import type { PlayerApi } from "../timeline/api";
import { GuitarView, type EmbedHost } from "../views/GuitarView";
import { ClipLens, useLens } from "../windows/ClipLens";
import { Window } from "../windows/Window";
import { openLabel } from "../windows/windows";

type Rect = Pick<WinState, "x" | "y" | "w" | "h">;

export interface ComposerProps {
  win: WinState;
  track: Track;
  song: TimelineSong;
  keyOf: Key;
  /** what the window is on: a clip of the track, or a track with nothing on it yet (null: a track that records) */
  target: Target | null;
  focused: boolean;
  z: number;
  /** opened by FX: the sound panels are brought into view (a number that goes up each time it is asked for) */
  toSound?: number;
  player: PlayerApi;
  onFocus(): void;
  onClose(): void;
  onMove(r: Rect): void;
  /** hear a Harmonize candidate: the lens song with it written in (null ends it) */
  onPreview(target: Target, heard: Progression | null): void;
  /** a rhythm or a style was picked: play the clip's bars now if nothing is playing */
  onHearNow(target: Target): void;
  /** the page's key chip was pressed */
  onKey(): void;
  /** the open clip's switch: heard or not */
  onMute(clip: string): void;
  onCopy(clip: string): void;
  /** paste what was copied into what is open; null: there is nothing to paste that this track can hold */
  onPaste: (() => void) | null;
  /** bring another track's composer forward, on one of its clips */
  onShow(track: string, clip: string): void;
}

const PANE = { chords: "rhythm", melody: "melody", bass: "melody", drums: "drums" } as const;

export function LegacyComposer(p: ComposerProps) {
  const { win, track, song, target } = p;
  const frame = { win: p.win, focused: p.focused, z: p.z, onFocus: p.onFocus, onClose: p.onClose, onMove: p.onMove };
  if (track.kind === "vocals" || track.kind === "audio" || !target) {
    return (
      <Window {...frame} title={`${track.name} · recording`}>
        <div className="lc-wait">
          <p><b>Recording arrives with the next step.</b></p>
          <p className="muted small">What is recorded on this track plays with the song, and its clips can be moved, cut and copied on the timeline.</p>
        </div>
      </Window>
    );
  }
  const clip = target.clip === undefined ? undefined : (song.clips.find((c) => c.id === target.clip && c.kind !== "audio") as NoteClip | undefined);
  const title = `${track.name} · ${clip ? openLabel(song, clip.id) : "new clip"}`;
  return (
    <ClipLens target={target} pane={PANE[track.kind]} onFrame={p.onKey}>
      <Window {...frame} title={title} tools={<Tools {...p} clip={clip} />}>
        <div className="lc-scroll">
          <Body {...p} clip={clip} target={target} key={`${win.id}:${target.clip ?? "new"}`} />
        </div>
      </Window>
    </ClipLens>
  );
}

/** What stands in the title bar before ✕. */
function Tools({ track, song, clip, onMute, onCopy, onPaste, onShow }: ComposerProps & { clip: NoteClip | undefined }): ReactNode {
  const info = useLens();
  // the chords on screen are not heard here when another track's clip plays instead of them: it says so, and a tap shows that one
  const by = track.kind === "chords" && info
    ? song.clips.find((c) => c.kind === "chords" && !c.mute && c.instead === track.id && c.start < info.lens.span.to - 1e-6 && c.start + c.len > info.lens.span.from + 1e-6 && !song.mix?.[c.track]?.mute)
    : undefined;
  const byName = by ? song.tracks.find((t) => t.id === by.track)?.name ?? "" : "";
  return (
    <>
      {info && <MixMark id={info.openId} name={track.name} />}
      {by && <button className="hz-instead" aria-label={`${track.name} is not heard here: ${byName} plays instead. Show ${byName}`} title={`Not heard here: ${byName} plays instead`} onClick={() => onShow(by.track, by.id)}>{byName} plays instead</button>}
      {clip && <button className={`chip lc-on${clip.mute ? "" : " on"}`} role="switch" aria-checked={!clip.mute} aria-label={`This clip is ${clip.mute ? "off" : "on"}`} title={clip.mute ? "Off: kept, but not heard" : "On: heard with the song"} onClick={() => onMute(clip.id)}>{clip.mute ? "Off" : "On"}</button>}
      <BarsControl />
      <button className="icon-btn" title="Copy what is open" aria-label={`Copy this clip of ${track.name}`} disabled={!clip} onClick={() => clip && onCopy(clip.id)}><CopyIcon /></button>
      <button className="icon-btn clip-paste" title="Paste into what is open" aria-label={onPaste ? `Paste into this clip of ${track.name}` : "Paste: copy a clip of this kind first"} disabled={!onPaste} onClick={() => onPaste?.()}><PasteIcon /></button>
    </>
  );
}

/** The old page itself, told what it needs of the music by the track view's player. */
function Body({ track, keyOf, clip, target, player, toSound, onPreview, onHearNow }: ComposerProps & { clip: NoteClip | undefined; target: Target }) {
  const live = useRef({ clip, target, player, onPreview, onHearNow });
  live.current = { clip, target, player, onPreview, onHearNow };
  const playing = player.playing;
  const low = track.kind === "bass" ? melodyBase(keyOf) - 24 : undefined;
  const host = useMemo<EmbedHost>(() => ({
    pane: PANE[track.kind as "chords" | "melody" | "bass" | "drums"],
    playing,
    togglePlay: () => live.current.player.toggle(),
    getPos: () => {
      const c = live.current.clip;
      const b = live.current.player.getBeat();
      if (!c || b === null || b < c.start - 1e-6 || b >= c.start + c.len - 1e-6) return null;
      return phase(c, b);
    },
    preview: (heard) => live.current.onPreview(live.current.target, heard),
    hearNow: () => live.current.onHearNow(live.current.target),
    ...(low !== undefined ? { low } : {}),
    ...(toSound ? { toSound } : {}),
  }), [track.kind, playing, low, toSound]);
  return <GuitarView embedded={host} />;
}
