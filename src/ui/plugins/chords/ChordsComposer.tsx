// The Chords composer: the plugin window a chords track's compose button opens. Everything the Chords page had for
// writing chords is here, laid out for a window:
//
//  - the board (Board.tsx): the chords of the key, chords from outside it, and what could come next; tap to hear,
//    + or drag to add;
//  - the tray (Dock.tsx): the chords of what is open, each with its shape, the ruler with their lengths, "+ Rest",
//    "Clear", Arrange (a guitar) or Voicing (the keys), and Harmonize. It is always in view;
//  - the shape finder (components/ShapeFinder), as a panel in the board's place: its shapes drag into the tray;
//  - how the chords are played (Playing.tsx): the playing style and its feel, for this clip, with "All clips".
//
// What is written goes into the clip the window is on, or into the track's draft: the parts are the old page's, shown
// through a lens onto what is open (windows/ClipLens), so a change they make lands there as one undo step. How the
// chords are played and where on the neck stays with the clip. What they sound like is the track's: the title bar's
// Sound button opens its sound window. The strip at the bottom shows the clip being composed, to be dragged onto a
// chords lane.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reviveFeel, type Feel, type PatternId } from "../../../audio/patterns";
import { strum } from "../../../audio/synth";
import { keysVoicing, keysVoicings, onKeys, voicingOf, type Tone } from "../../../audio/tone";
import { arrangeProgression, fitAlternatives, type ArrangeOptions } from "../../../guitar/arrange";
import { fingerNotes } from "../../../guitar/finger";
import { voicingFromFrets, type Voicing } from "../../../guitar/voicings";
import { playedNotes } from "../../../song/chordnotes";
import { harmonizeSources } from "../../../song/harmony";
import { sigBeats } from "../../../song/meter";
import { allTracks, normalize } from "../../../song/tracks";
import { chordSymbol, getChordType, type ChordRef } from "../../../theory/chords";
import { pc } from "../../../theory/notes";
import { contentBars, openOf, type OpenTarget } from "../../../timeline/content";
import { draftAnchor } from "../../../timeline/edit";
import type { ChordsContent, ChordsTrack, NoteClip } from "../../../timeline/model";
import { useApp5 } from "../../app5";
import { useBarsView } from "../../components/BarsControl";
import { HarmonizeButton, HarmonyAgain } from "../../components/HarmonyPicker";
import { ShapeFinder } from "../../components/ShapeFinder";
import { DragCtx, type DragApi, type Payload } from "../../drag";
import { useApp, type ArrangeSettings, type ProgChord } from "../../state";
import type { PlayerApi } from "../../timeline/api";
import { ESC_OPEN, onEscape } from "../../timeline/keys";
import { ClipLens } from "../../windows/ClipLens";
import { useWinFocus } from "../../windows/windows";
import { ComposerFrame, type ComposerCtl, type ComposerProps } from "../ComposerFrame";
import { toneWith, withTone } from "../sound/useTone";
import { ChordBoard } from "./Board";
import { Dock } from "./Dock";
import { chordDrag, type ChordDrag } from "./drag";
import { PlayingPanel, PlayingRow } from "./Playing";
import { allPlayAs, dropChord, finderShown, litChord, pinShape, playingToAll, setArrange, setBars, setLengths, setStyle } from "./tray";
import "./chords.css";

export const ChordsComposer = memo(function ChordsComposer(p: ComposerProps) {
  const { track, song, target, ctl } = p;
  const open = openOf(song, target, p.anchor);
  if (track.kind !== "chords" || !open) return null;
  const content = open.content as ChordsContent;
  // "All clips" is offered when the track has a clip besides what is open (lit only while one of them plays another way)
  const others = song.clips.some((c) => c.kind === "chords" && c.track === track.id && c.id !== open.clip?.id);
  const allSame = !others || allPlayAs(song, track.id, content.style, content.feel);
  return (
    <ClipLens target={target} pane="rhythm" onFrame={ctl.showKey}>
      <ComposerFrame p={p} open={open}>
        <Body win={p.win.id} at={`${p.win.id}:${p.win.clip ?? ""}`} track={track} target={target} clip={open.clip} content={content} bar={sigBeats(open.sig)} from={open.span.from} to={open.span.to}
          player={p.player} shown={!p.hidden} heard={p.heard} harmonizing={p.harmonizing} others={others} allSame={allSame} ctl={ctl} />
      </ComposerFrame>
    </ClipLens>
  );
});

/** What the left side of the window shows: the board, or what was opened in its place. */
type Stage = "board" | "finder" | "playing";

/**
 * The composer itself. Drawn again only when what it is on, its track or the player changes.
 * `at`: a name for what the window is on (the ruler starts at bar 1 when it changes). `clip`, `content`, `bar`,
 * `from`, `to`: what is open, as `openOf` reads it (see timeline/content).
 */
const Body = memo(function Body({ win, at, track, target, clip, content, bar, from, to, player, shown, heard, harmonizing, others, allSame, ctl }: {
  win: string; at: string; track: ChordsTrack; target: OpenTarget; clip: NoteClip | undefined; content: ChordsContent; bar: number; from: number; to: number;
  player: PlayerApi; shown: boolean; heard: boolean; harmonizing: boolean; others: boolean; allSame: boolean; ctl: ComposerCtl;
}) {
  const { state, set, shapeOf, sheet, openSheet, tuning } = useApp();
  const app = useApp5();
  const prog = state.progression;
  const chords = prog.chords;
  const focused = useWinFocus();
  const view = useBarsView();
  // (a closed window does no work while the music plays)
  const playing = player.playing && shown;
  const live = useRef({ app, win, track, target, clip, content, bar, from, to, player, heard, ctl, playing });
  live.current = { app, win, track, target, clip, content, bar, from, to, player, heard, ctl, playing };

  // ── the shapes in the tray: each chord's own shape, or (Arrange) a set chosen together so they sit in one area of
  // the neck. A shape set by hand stays put. On the keys: the keys each chord plays, laid out together. ──
  const tone = track.tone;
  const arr = prog.arrange ?? null;
  const { capo, avoidBarre } = state.settings;
  const optsOf = useCallback(
    (a: ArrangeSettings | null | undefined): ArrangeOptions => ({ tuning, capo, avoidBarre, preferOpen: a?.zone === 0, targetFret: null, allowInversions: a?.inversions ?? false, zone: a?.zone ?? null, strings: a?.strings ?? "any" }),
    [tuning, capo, avoidBarre],
  );
  const arrOpts: ArrangeOptions = useMemo(() => optsOf(arr), [optsOf, arr]);
  const chordsKey = JSON.stringify(chords.map((c) => [c.ref, c.voicingId, !!c.rest, c.notes]));
  const voicingsOf = useCallback(
    (all: ProgChord[], a: ArrangeSettings | null | undefined): (Voicing | undefined)[] => {
      const real = all.filter((c) => !c.rest);
      const own = real.map((c) => shapeOf(c.ref, c.voicingId));
      const vs = a ? arrangeProgression(real.map((c) => c.ref), { ...optsOf(a), pinned: real.map((c, i) => (c.voicingId && own[i]?.id === c.voicingId ? own[i] : undefined)) }) : own;
      let k = 0;
      return all.map((c) => {
        if (c.rest) return undefined;
        const v = vs[k++];
        // a chord written as exact notes is shown as it is fingered
        const ns = playedNotes(c);
        const frets = ns && fingerNotes(ns, tuning, capo);
        return frets ? voicingFromFrets(frets, pc(c.ref.root), getChordType(c.ref.typeId), tuning, capo) : v;
      });
    },
    [optsOf, shapeOf, tuning, capo],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const voicings = useMemo(() => voicingsOf(chords, arr), [chordsKey, voicingsOf, arr]);
  const chordKeys = onKeys(tone);
  const keyStyle = voicingOf(tone);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const keyVs = useMemo(() => (chordKeys ? keysVoicings(chords, tone) : null), [chordsKey, chordKeys, keyStyle, tone.register]);
  const pinSlot = (slotId: string, voicingId: string) => set(pinShape(slotId, voicingId, voicings));
  const stepSlot = (i: number, dir: -1 | 1) => {
    const c = chords[i];
    const list = fitAlternatives(c.ref, arrOpts, voicings[i - 1], voicings[i + 1]);
    if (!list.length) return;
    const now = list.findIndex((v) => v.id === voicings[i]?.id);
    const next = list[(Math.max(now, 0) + dir + list.length) % list.length];
    pinSlot(c.id, next.id);
    if (!playing) strum(next.midi);
  };
  const sheetKeys = useCallback((ref: ChordRef, slotId?: string) => {
    const i = slotId ? chords.findIndex((c) => c.id === slotId) : -1;
    return i >= 0 && keyVs ? keyVs[i] : keysVoicing(ref, tone);
  }, [chords, keyVs, tone]);
  /** how the chords are laid out on the keys: the instrument's own setting, so it is the track's (every clip of it) */
  const onKeyStyle = useCallback((voicing: NonNullable<Tone["voicing"]>) => {
    const l = live.current;
    l.app.edit("Voicing", (s) => {
      const t = s.tracks.find((x) => x.id === l.track.id);
      return t && t.kind === "chords" ? withTone(s, t.id, toneWith(t.tone, { voicing }, "chords")) : s;
    });
  }, []);

  // ── the chord that is sounding, read from where the music is ──
  const [nowIdx, setNowIdx] = useState(-1);
  useEffect(() => {
    if (!playing) return setNowIdx(-1);
    let raf = 0;
    const tick = () => {
      const l = live.current;
      setNowIdx(litChord({ clip: l.clip, span: { from: l.from, to: l.to }, content: l.content }, l.player.getBeat(), l.heard, l.bar));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // ── what the left side shows: the board, the shape finder for a chord, or the playing styles ──
  const synth = tone.inst === "synth";
  const [playOpen, setPlayOpen] = useState(false);
  const stage: Stage = finderShown(sheet, chords) ? "finder" : playOpen && !synth ? "playing" : "board";
  // the shape finder opened: the styles close, and the harmony sheet (it would lie over the finder) gives way
  useEffect(() => {
    if (!sheet) return;
    setPlayOpen(false);
    live.current.ctl.endHarmonize(live.current.win);
  }, [sheet]);
  const togglePlaying = useCallback(() => {
    openSheet(null);
    setPlayOpen((v) => !v);
  }, [openSheet]);
  // Escape: one thing per press. What is open inside this window goes first, the window itself after.
  useEffect(() => {
    if (!focused || stage === "board") return;
    return onEscape(ESC_OPEN, () => {
      openSheet(null);
      setPlayOpen(false);
      return true;
    });
  }, [focused, stage, openSheet]);

  // ── how the clip is played ──
  const style = prog.pattern;
  const feel = useMemo(() => reviveFeel(prog.feel), [prog.feel]);
  const hasChords = chords.length > 0;
  const pickStyle = useCallback((id: PatternId) => {
    set(setStyle(id));
    // heard straight away
    if (!live.current.playing && hasChords) live.current.ctl.hearNow(live.current.win);
  }, [set, hasChords]);
  const setFeel = useCallback((patch: Partial<Feel>) => set((s) => ({ ...s, progression: { ...s.progression, feel: { ...reviveFeel(s.progression.feel), ...patch } } })), [set]);
  const toAll = useCallback(() => {
    const l = live.current;
    const session = l.app.peek().session;
    l.app.edit(`Playing style of ${l.track.name}`, (song) => {
      const o = openOf(song, l.target, draftAnchor(song, session));
      if (!o || o.kind !== "chords") return song;
      const c = o.content as ChordsContent;
      return playingToAll(song, l.track.id, c.style, c.feel);
    });
  }, []);

  // ── Harmonize: the window only asks for the sheet. The track view shows it, and plays a candidate ──
  const canHarmonize = useMemo(() => harmonizeSources(prog).length > 0, [prog]);
  const harmonize = useCallback((anchor: HTMLElement | null, again?: boolean) => {
    // what is open in the board's place would lie under the sheet: it gives way
    openSheet(null);
    setPlayOpen(false);
    live.current.ctl.harmonize(live.current.win, "chords", anchor, again);
  }, [openSheet]);
  const again = useCallback(() => harmonize(null, true), [harmonize]);
  /** the open track, when Harmonize wrote it: it can be written again (with another option) */
  const chordsId = prog.focus?.chords ?? "chords";
  const written = useMemo(() => allTracks(normalize(prog)).find((t) => t.id === chordsId && !!t.harmony), [prog, chordsId]);

  // ── what the tray writes ──
  const nBars = contentBars(content);
  const onLengths = useCallback((beats: Record<string, number>) => set(setLengths(beats)), [set]);
  const onFit = useCallback((n: number) => set(setBars(n)), [set]);
  const onArrange = useCallback((a: ArrangeSettings | null) => set(setArrange(a)), [set]);

  // ── dragging a chord into the tray ──
  const [drag, setDrag] = useState<ChordDrag | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const lastDrag = useRef(0);
  const drop = useCallback((p: Payload, index: number | null) => set(dropChord(p, index)), [set]);
  const api = useMemo<DragApi>(() => chordDrag({ dockRef, ghostRef, lastDrag, setDrag, drop }), [drop]);

  const head = !synth || canHarmonize || written ? (
    <div className="cp-head">
      {!synth && <PlayingRow style={style} open={stage === "playing"} onOpen={togglePlaying} onStyle={pickStyle} all={others && hasChords ? { same: allSame, run: toAll } : undefined} />}
      <span className="cp-hz">
        {written && <HarmonyAgain track={written} className="cp-again" onOpen={again} />}
        {canHarmonize && <HarmonizeButton on={harmonizing} onClick={harmonize} />}
      </span>
    </div>
  ) : null;

  return (
    <DragCtx.Provider value={api}>
      <div className={`cp${drag ? " dragging" : ""}`} data-stage={stage}>
        <div className="cp-stage">
          {/* (the board is kept as it was left while something else is shown in its place) */}
          <div className="cp-pane" hidden={stage !== "board"}>
            <ChordBoard onKey={ctl.showKey} />
          </div>
          <ShapeFinder panel slotShape={(id) => voicings[chords.findIndex((c) => c.id === id)]} onPinSlot={pinSlot} keys={chordKeys ? sheetKeys : undefined} />
          {stage === "playing" && <PlayingPanel style={style} onStyle={pickStyle} feel={feel} setFeel={setFeel} onClose={togglePlaying} />}
        </div>
        <Dock ref={dockRef} head={head} voicings={voicings} keys={keyVs} keyStyle={keyStyle} onKeyStyle={onKeyStyle} nowIdx={nowIdx} drag={drag} onStep={stepSlot} onArrange={onArrange}
          bar={bar} onLengths={onLengths} length={nBars * bar} label={clip ? "The clip" : "The draft"} onFit={onFit} shown={view.shown} follow={view.follow} resetKey={at} />
      </div>
      {/* (the ghost follows the pointer over the whole screen: it is drawn on the page, not inside the window) */}
      {drag && createPortal(<div ref={ghostRef} className="drag-ghost">{chordSymbol(drag.ref)}</div>, document.body)}
    </DragCtx.Provider>
  );
});
