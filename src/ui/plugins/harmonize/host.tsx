// Harmonize, hosted once for the whole track view: the one place the harmony sheet (components/HarmonyPicker) is
// mounted. A composer window does not show a sheet of its own: its Harmonize button asks for this one
// (`ComposerCtl.harmonize`), and the sheet is shown inside the window that asked, where it always was: across the
// bottom of that window's body, over the page, with the button that opened it kept in sight above it.
//
// There is one sheet at a time. Asked for by another window, it moves there; asked for again by the same window's
// Harmonize button, it closes. It works on what that window has open (a clip, or the track's draft) through the
// same lens the old pages use (windows/ClipLens), so the sheet itself is the old one, unchanged: it reads the lens
// song, and what it keeps goes back into the real song as one undo step. While an option is chosen the track view's
// player plays the open bars round with it written in (`preview`).
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { previewHarmony } from "../../../song/harmony";
import { allTracks, normalize, type Track as OldTrack } from "../../../song/tracks";
import type { OpenTarget } from "../../../timeline/content";
import type { TimelineSong, WinState } from "../../../timeline/model";
import { AuditionCtx, HarmonyPicker, type Audition, type Preview } from "../../components/HarmonyPicker";
import { useApp, type Progression } from "../../state";
import { ESC_OPEN, onEscape } from "../../timeline/keys";
import { ClipLens } from "../../windows/ClipLens";
import { WinFocus } from "../../windows/windows";

/** What the sheet is open for. */
export interface HarmonyOpen {
  /** the composer window that asked: the sheet is shown inside it */
  win: string;
  /** what that window writes: a new chords track, or a new melody track, to go with a track of the song */
  kind: "chords" | "melody";
  /** the button that opened it: kept in sight above the sheet */
  anchor: HTMLElement | null;
  /** write the open track's own harmony again (its ⟳), instead of a new track */
  again: boolean;
  /** the clip that window was on when it asked (none: its track's draft). Put on another, the sheet closes */
  clip: string | undefined;
}

/**
 * What the sheet is open for once a window has asked. The same window's Harmonize button pressed again closes it;
 * ⟳ always opens the sheet that writes again; another window takes the sheet over.
 */
export function asked(now: HarmonyOpen | null, ask: HarmonyOpen): HarmonyOpen | null {
  if (!ask.again && now && now.win === ask.win && !now.again) return null;
  return ask;
}

/** What the host of the track view gets back: how composers ask, and the sheet to draw. */
export interface HarmonizeApi {
  /** the window whose Harmonize button is lit: the sheet is open for it, to write a new track (null: for none) */
  lit: string | null;
  /** a composer's Harmonize button, or (`again`) the ⟳ of a track Harmonize wrote */
  ask(win: string, kind: "chords" | "melody", anchor: HTMLElement | null, again?: boolean): void;
  /** that window opened something of its own where the sheet is: the sheet gives way */
  end(win: string): void;
  close(): void;
  /** the sheet itself: drawn once, by the host */
  sheet: ReactNode;
}

/**
 * The harmony sheet of the track view. Call it once, in the host, and draw `sheet` once.
 * `preview`: hear a candidate (the lens song of what that window has open, with the harmony written in; null ends it).
 */
export function useHarmonize(o: {
  song: TimelineSong;
  /** the windows of the session */
  windows: readonly WinState[];
  /** the window that has the focus */
  focused: string | null;
  playing: boolean;
  preview(win: string, target: OpenTarget, heard: Progression | null): void;
  /** give a window the focus (a press on the sheet is a press in its window) */
  focus(win: string): void;
}): HarmonizeApi {
  const [open, setOpen] = useState<HarmonyOpen | null>(null);
  const live = useRef(o);
  live.current = o;
  const ask = useCallback((win: string, kind: "chords" | "melody", anchor: HTMLElement | null, again = false) => {
    const w = live.current.windows.find((x) => x.id === win);
    if (w) setOpen((now) => asked(now, { win, kind, anchor, again, clip: w.clip }));
  }, []);
  const end = useCallback((win: string) => setOpen((now) => (now && now.win === win ? null : now)), []);
  const close = useCallback(() => setOpen(null), []);

  // The sheet belongs to what its window was on when it asked: the window gone, its track gone, or the window put on
  // another clip, and the sheet closes. (A window that is only closed keeps its sheet, hidden with it.)
  const w = open ? o.windows.find((x) => x.id === open.win && x.kind === "compose") : undefined;
  const track = w ? o.song.tracks.find((t) => t.id === w.track) : undefined;
  const lens = track && (track.kind === "chords" || track.kind === "melody" || track.kind === "bass") ? (track.kind === "chords" ? "rhythm" : "melody") : null;
  const on = !!open && !!w && w.clip === open.clip && !!lens;
  useEffect(() => {
    if (open && !on) setOpen(null);
  }, [open, on]);
  const shown = on && !!w && w.open;
  const focused = shown && o.focused === open?.win;
  // (the same object while the window is on the same thing: the lens is not made again for nothing)
  const wTrack = w?.track;
  const wClip = w?.clip;
  const target = useMemo<OpenTarget | null>(() => (wTrack === undefined ? null : wClip === undefined ? { track: wTrack } : { track: wTrack, clip: wClip }), [wTrack, wClip]);

  // where it is drawn: in the body of the window that asked (looked for after every draw: a window may be made again)
  const [found, setFound] = useState<{ win: string; el: HTMLElement } | null>(null);
  const win = on ? open?.win : undefined;
  useLayoutEffect(() => {
    const el = win === undefined ? null : [...document.querySelectorAll<HTMLElement>(".tlw")].find((x) => x.dataset.win === win)?.querySelector<HTMLElement>(":scope > .tlw-body") ?? null;
    setFound((was) => (win === undefined || !el ? null : was && was.win === win && was.el === el ? was : { win, el }));
  });
  const body = found && found.win === win ? found.el : null;
  // a press on the sheet is a press in its window: the window comes to the front and has the focus
  useEffect(() => {
    if (!body || win === undefined) return;
    const down = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest(".hz-sheet") && live.current.focused !== win) live.current.focus(win);
    };
    body.addEventListener("pointerdown", down, true);
    return () => body.removeEventListener("pointerdown", down, true);
  }, [body, win]);
  // Escape: one thing per press. The sheet goes first, its window after.
  useEffect(() => (focused ? onEscape(ESC_OPEN, () => (setOpen(null), true)) : undefined), [focused]);

  const sheet = on && open && body && target && lens ? createPortal(
    <Fence key={`${open.win}:${open.kind}:${open.again ? "again" : "new"}`} onClose={close}>
      <WinFocus.Provider value={focused}>
        <ClipLens target={target} pane={lens}>
          <HarmonySheet kind={open.kind} again={open.again} anchor={open.anchor} playing={o.playing && shown}
            onPreview={(heard) => live.current.preview(open.win, target, heard)} onClose={close} />
        </ClipLens>
      </WinFocus.Provider>
    </Fence>,
    body,
  ) : null;
  return { lit: on && open && !open.again ? open.win : null, ask, end, close, sheet };
}

/**
 * The sheet on the lens song of what its window has open (it must be drawn inside that window's `ClipLens`): which
 * track is the open one, and hearing a candidate, which the old page did for the sheet when it showed it itself.
 */
export function HarmonySheet({ kind, again, anchor, playing, onPreview, onClose }: {
  kind: "chords" | "melody";
  again: boolean;
  anchor: HTMLElement | null;
  /** the music is playing (and the sheet's window is on screen) */
  playing: boolean;
  /** hear the lens song with a candidate written in (null: stop hearing it) */
  onPreview(heard: Progression | null): void;
  onClose(): void;
}) {
  const { state } = useApp();
  const prog = state.progression;
  // the open track, as the lens song names it: listed first among the tracks to harmonize with
  const openId = prog.focus?.[kind] ?? kind;
  // written again: the open track, when Harmonize wrote it (as it was when ⟳ was pressed)
  const [track] = useState<OldTrack | undefined>(() => (again ? allTracks(normalize(prog)).find((t) => t.id === openId && !!t.harmony) : undefined));
  const lost = again && !track;
  useEffect(() => {
    if (lost) onClose();
  }, [lost, onClose]);

  // a candidate being heard: the host plays the open bars round with it written in; the page stays as it is
  const [preview, setPreview] = useState<Preview | null>(null);
  const hear = useCallback((pv: Preview | null) => setPreview(pv), []);
  const ask = useRef(onPreview);
  ask.current = onPreview;
  const heardNow = useRef(false);
  useEffect(() => {
    if (!preview) {
      if (heardNow.current) ask.current(null);
      heardNow.current = false;
      return;
    }
    heardNow.current = true;
    ask.current(previewHarmony(prog, state.key, preview.plan, preview.target));
  }, [preview, prog, state.key]);
  useEffect(() => () => {
    if (heardNow.current) ask.current(null);
  }, []);
  const audition = useMemo<Audition>(() => ({ preview, hear, playing }), [preview, hear, playing]);
  if (lost) return null;
  return (
    <AuditionCtx.Provider value={audition}>
      <HarmonyPicker kind={kind} track={track} first={openId} anchor={anchor} onClose={onClose} />
    </AuditionCtx.Provider>
  );
}

/** If the sheet goes wrong it says so where it stands, with a way to close it: the window it is in, and the rest of the app, go on. */
class Fence extends Component<{ children: ReactNode; onClose(): void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="hz-sheet" role="alert">
        <div className="hz-row">
          <span className="hz-q">Something went wrong in Harmonize</span>
          <button className="icon-btn hz-x" aria-label="Close" title="Close" onClick={this.props.onClose}>✕</button>
        </div>
        <span className="hz-none mono">{this.state.error.message}</span>
      </div>
    );
  }
}
