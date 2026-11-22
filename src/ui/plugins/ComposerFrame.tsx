// What every composer window has round its composer: the plugin window itself, a title that says which track and
// which bars are open ("Drums · bars 5–8", or "Drums · draft" for what is not on the timeline yet), the tools of
// the title bar (the track's mute or solo mark, "plays instead", the open clip's On / Off switch, bars on screen,
// the Sound button), and the strip along the bottom with the clip being composed.
//
// It must be drawn inside the old pages' context (`ClipLens` or `V4View`): bars on screen is one of their controls.
import type { ReactNode } from "react";
import { quietWhy } from "../../audio/mix";
import type { Key } from "../../theory/keys";
import { needsFit, type Open, type OpenTarget } from "../../timeline/content";
import type { TimelineSong, Track, WinState } from "../../timeline/model";
import { BarsControl } from "../components/BarsControl";
import { KindIcon } from "../icons";
import type { PlayerApi } from "../timeline/api";
import { ClipStrip, ClipSwitch, type StripCtl } from "../windows/ClipStrip";
import type { DragLook } from "../windows/dragging";
import { Window } from "../windows/Window";
import { openLabel } from "../windows/windows";

type Rect = Pick<WinState, "x" | "y" | "w" | "h">;

/** What a composer window is handed by the host. */
export interface ComposerProps {
  win: WinState;
  track: Track;
  song: TimelineSong;
  keyOf: Key;
  /** what the window is on: a clip of the track, or (no clip) the track's draft */
  target: OpenTarget;
  /** where the draft is treated as lying: the bar line at or before the loop's start, else the cursor's */
  anchor: number;
  focused: boolean;
  /** closed: kept as it was left, off the screen, doing no work */
  hidden: boolean;
  z: number;
  player: PlayerApi;
  /** this window's ▶ is going round its bars; and whether ▶ plays the track on its own */
  audit: boolean;
  alone: boolean;
  /** what is open is heard with the song now (a placed clip always is; a draft while its window has the focus or its ▶ runs) */
  heard: boolean;
  /** what the window asks of its host (the same object for every window, always: a window is drawn again only for what changed in it) */
  ctl: ComposerCtl;
  /** is there something copied that this track can hold? */
  canPaste: boolean;
  /** the harmony sheet is open for this window, from its Harmonize button (the button is lit) */
  harmonizing: boolean;
}

/** What a composer window asks of the host. Every function names its window, so one object serves them all. */
export interface ComposerCtl {
  focus(win: string): void;
  close(win: string): void;
  move(win: string, r: Rect): void;
  /**
   * Harmonize: the one harmony sheet of the track view (plugins/harmonize/host) is asked for, to write a new track
   * that goes with what this window has open. It is shown inside this window; `anchor` is the button that was
   * pressed (kept in sight above the sheet). Asked again by the same window, it closes. `again`: write the open
   * track's own harmony again instead (the ⟳ of a track Harmonize wrote).
   */
  harmonize(win: string, kind: "chords" | "melody", anchor: HTMLElement | null, again?: boolean): void;
  /** the window opened something of its own where the sheet is (a shape finder): the sheet gives way */
  endHarmonize(win: string): void;
  /** a rhythm or a style was picked: play what is open now if nothing is playing */
  hearNow(win: string): void;
  /** the page's key chip was pressed */
  showKey(): void;
  /** the open clip's switch: heard or not */
  mute(clip: string): void;
  /** the track's mute or solo mark was pressed: let it be heard */
  hearTrack(track: string): void;
  /** bring another track's composer forward, on one of its clips */
  show(track: string, clip: string): void;
  /** the track's sound window, standing beside this composer */
  sound(track: string): void;
  // ── the strip ──
  /** ▶: the open bars go round (pressed again: they stop) */
  play(win: string): void;
  setAlone(win: string, on: boolean): void;
  /** a fresh, empty draft */
  fresh(win: string): void;
  /** make what is open this many bars long */
  bars(win: string, n: number): void;
  copy(win: string): void;
  paste(win: string): void;
  /** refit what is open to the bars it lies in */
  fit(win: string): void;
  /** the strip's clip was pressed: it may be dragged onto the timeline */
  drag(e: React.PointerEvent<HTMLElement>, win: string, look: DragLook): void;
}

/** The track's M while it is muted, or S while others are soloed and it is not: a tap lets it be heard. Nothing while it is heard. */
function MixMark5({ song, track, ctl }: { song: TimelineSong; track: Track; ctl: ComposerCtl }) {
  const why = quietWhy(song.mix, track.id);
  if (!why) return null;
  return why === "mute" ? (
    <button className="tv-ms on mix-mark" aria-label={`Unmute ${track.name}`} title="This track is muted: tap to hear it" onClick={() => ctl.hearTrack(track.id)}>M</button>
  ) : (
    <button className="tv-ms solo mix-mark" aria-label={`Solo ${track.name} too`} title="Other tracks are soloed: tap to solo this one too" onClick={() => ctl.hearTrack(track.id)}>S</button>
  );
}

/** The picture on the Sound button: three sliders (the same as the panel's FX means). */
export const SoundIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    <path d="M3.5 2.5v11M8 2.5v11M12.5 2.5v11" />
    <circle cx="3.5" cy="10" r="1.7" fill="var(--card)" />
    <circle cx="8" cy="5.5" r="1.7" fill="var(--card)" />
    <circle cx="12.5" cy="9" r="1.7" fill="var(--card)" />
  </svg>
);

export function ComposerFrame({ p, open, tools, children }: {
  p: ComposerProps;
  /** what the window is on, read from the song (see timeline/content) */
  open: Open;
  /** more for the title bar, before the common tools */
  tools?: ReactNode;
  children: ReactNode;
}) {
  const { win, track, song, ctl } = p;
  const id = win.id;
  const clip = open.clip;
  const title = `${track.name} · ${clip ? openLabel(song, clip.id) : "draft"}`;
  // the chords on screen are not heard here when another track's clip plays instead of them: it says so, and a tap shows that one
  const by = track.kind === "chords"
    ? song.clips.find((c) => c.kind === "chords" && !c.mute && c.instead === track.id && c.start < open.span.to - 1e-6 && c.start + c.len > open.span.from + 1e-6 && !song.mix?.[c.track]?.mute)
    : undefined;
  const byName = by ? song.tracks.find((t) => t.id === by.track)?.name ?? "" : "";
  const strip: StripCtl = {
    fresh: () => ctl.fresh(id),
    play: () => ctl.play(id),
    setAlone: (on) => ctl.setAlone(id, on),
    bars: (n) => ctl.bars(id, n),
    copy: () => ctl.copy(id),
    paste: () => ctl.paste(id),
    fit: () => ctl.fit(id),
    drag: (e, look) => ctl.drag(e, id, look),
  };
  return (
    <Window win={win} focused={p.focused} hidden={p.hidden} z={p.z} title={title} icon={<KindIcon kind={track.kind} />}
      onFocus={() => ctl.focus(id)} onClose={() => ctl.close(id)} onMove={(r) => ctl.move(id, r)}
      tools={
        <>
          {tools}
          <MixMark5 song={song} track={track} ctl={ctl} />
          {by && <button className="hz-instead" aria-label={`${track.name} is not heard here: ${byName} plays instead. Show ${byName}`} title={`Not heard here: ${byName} plays instead`} onClick={() => ctl.show(by.track, by.id)}>{byName} plays instead</button>}
          <ClipSwitch clip={clip} onMute={ctl.mute} />
          <BarsControl />
          <button className="icon-btn tlw-sound" title="Sound and effects of this track" aria-label={`Sound and effects of ${track.name}`} onClick={() => ctl.sound(track.id)}><SoundIcon /></button>
        </>
      }
      strip={<ClipStrip open={open} keyOf={p.keyOf} playing={p.audit} alone={p.alone} canPaste={p.canPaste} fit={needsFit(song, p.target, p.anchor)} on={strip} />}>
      {children}
    </Window>
  );
}
