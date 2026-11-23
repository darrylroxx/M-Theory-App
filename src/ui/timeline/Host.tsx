// The host of the track view: it reads the app's state and builds everything the view is handed. It owns the player,
// the plugin windows (a composer and a sound window for each track: see plugins/registry), what a composer has open
// (a clip, or its track's draft, which is heard with the song while its window is worked in), the drag of a
// composer's clip onto a lane, the one harmony sheet every composer asks for (plugins/harmonize/host), the recording
// engine (ui/audio/useEngine, mounted here once and for good) with the one record window and each recording track's
// sound window, the Canvas as an overlay, and the two sheets (Ideas and settings).
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { audioIfStarted } from "../../audio/context";
import { windowWants } from "../../audio/handoff";
import { saveFile } from "../../audio/midi";
import { canLoad, keepTakes as keepBuffers, loadTake, takeBuffer, type TakeRef } from "../../audio/takebuffers";
import { OVERLOAD_MESSAGE, watchOverload } from "../../audio/overload";
import { FX_DEFAULT, reviveFx } from "../../audio/vocalfx";
import { isDesktop } from "../../desktop";
import { reviveSound } from "../../audio/rack";
import { mixWith, quietWhy } from "../../audio/mix";
import { bookAhead, hearOn } from "../../audio/synth";
import { setHome } from "../../audio/trackplay";
import type { Spot } from "../../canvas/layout";
import { planKey } from "../../canvas/taps";
import { planTaps5 } from "../../canvas/taps5";
import { chordShape } from "../../guitar/arrange";
import { rewriteHarmony, setHarmonyEnv } from "../../song/harmony";
import { isCompound, sigBeats, sigName, type TimeSig } from "../../song/meter";
import type { ChordRef } from "../../theory/chords";
import type { Key } from "../../theory/keys";
import { displayNote, pc } from "../../theory/notes";
import { bestTonicSpelling, getScale } from "../../theory/scales";
import { barMap } from "../../timeline/bars";
import { fitOpen, openOf, setOpenBars, stampOpen, writeOpen, type OpenTarget } from "../../timeline/content";
import { clipboardBeats, copyOut, copySound, draftAnchor, insertTime, pasteIn, pasteSound, setContent, setDraft, setSig, setTempo, songEnd } from "../../timeline/edit";
import { chart5, hasChords5, midi5, wav5 } from "../../timeline/export";
import { flatten, type FlattenCtx } from "../../timeline/flatten";
import { harmonyState5, lensOf, transposeSong, unlens, type Target } from "../../timeline/lens";
import { CLIP_OF, contentBeats, type AudioClip, type Clip, type ClipKind, type NoteClip, type Region, type Session, type SoundCopy, type Take5, type TimelineSong, type Track, type WinState } from "../../timeline/model";
import { draftClipId, previewSong } from "../../timeline/preview";
import { voicingsFor } from "../../timeline/voicing";
import { useApp5, type App5State } from "../app5";
import { useEngine, type EngineApi, type EngineTrack } from "../audio/useEngine";
import { useWebRec } from "../audio/useWebRec";
import { CanvasPage } from "../components/CanvasPage";
import { DraftBadge } from "../components/Desktop";
import { IdeasPanel } from "../components/IdeasPanel";
import { SettingsPanel, type AudioSettings, type SettingsPart } from "../components/SettingsPanel";
import { useLive } from "../live";
import { REC_WIN, RecordHost, audioTracksOf, openRecordWin, recordSong, roundLabel, shownTrack, type RecordCtl } from "../plugins/audio/RecordHost";
import type { ComposerCtl } from "../plugins/ComposerFrame";
import { useHarmonize } from "../plugins/harmonize/host";
import { PLUGINS } from "../plugins/registry";
import type { SoundCtl } from "../plugins/SoundFrame";
import { newId, shapeKey, type Progression, type Studio } from "../state";
import { V4View } from "../windows/ClipLens";
import { useClipDrag, type ClipDragHost } from "../windows/dragging";
import { PANEL_W, TOP_H, closeWin, retargetWin, useSheet, useWindows, zOf } from "../windows/windows";
import type { PlayerApi } from "./api";
import { ESC_OPEN, onEscape, whereOf } from "./keys";
import { INPUTS_UNKNOWN, engineInputs, inputCount as countInputs } from "./inputs";
import { TrackView } from "./TrackView";
import { usePlayer, useTakes } from "./usePlayer";

/** A part of the screen that went wrong is shown as such, with a way to start it again: the rest of the app goes on. */
export class Guard extends Component<{ children: ReactNode; what: string; onClose?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card empty stack guard" role="alert">
        <h2>Something went wrong in {this.props.what}</h2>
        <p className="small muted mono">{this.state.error.message}</p>
        <div className="row tight">
          <button className="btn primary" onClick={() => this.setState({ error: null })}>Try again</button>
          {this.props.onClose && <button className="btn" onClick={() => { this.props.onClose?.(); this.setState({ error: null }); }}>Close</button>}
        </div>
      </div>
    );
  }
}

/** Edits that make the page busy for a moment: the song is booked further ahead first, so it plays on. */
const HEAVY = new Set(["Add track", "Remove track", "Duplicate track", "Paste", "Paste and make room", "Move clip", "Move clips", "Copy clip", "Copy clips", "Insert time", "Remove time", "Place clip"]);

const EPS = 1e-6;
/** A list as it was the last time, while every item in it is the same one (so what is handed on is not drawn again for nothing). */
function useSame<T>(list: T[]): T[] {
  const kept = useRef(list);
  if (kept.current !== list && (kept.current.length !== list.length || kept.current.some((x, i) => x !== list[i]))) kept.current = list;
  return kept.current;
}
/** How loud a take is along its length, for its picture on the lane: worked out once for a decoded take. */
const peaksOf = new WeakMap<AudioBuffer, { all: Float32Array; sides: Float32Array[] }>();
/**
 * `side`: none, the loudest of all its channels together (one picture); 0 or 1, the left or the right channel on its
 * own (a stereo take is drawn as two). The two sides are drawn to one scale, so a quiet side looks quiet.
 */
export function peaksFrom(b: AudioBuffer, side?: number): Float32Array {
  let out = peaksOf.get(b);
  if (!out) {
    const n = Math.max(1, Math.min(1200, Math.ceil(b.duration * 40)));
    const step = b.length / n;
    const sides: Float32Array[] = [];
    for (let ch = 0; ch < b.numberOfChannels; ch++) {
      const d = b.getChannelData(ch);
      const one = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let m = 0;
        // (every few samples is enough for a picture this small)
        const end = Math.min(b.length, Math.floor((i + 1) * step));
        const hop = Math.max(1, Math.floor(step / 64));
        for (let j = Math.floor(i * step); j < end; j += hop) {
          const v = d[j] < 0 ? -d[j] : d[j];
          if (v > m) m = v;
        }
        one[i] = m;
      }
      sides.push(one);
    }
    const all = new Float32Array(n);
    let top = 0;
    for (const one of sides) for (let i = 0; i < n; i++) if (one[i] > all[i]) all[i] = one[i];
    for (const v of all) if (v > top) top = v;
    if (top > 0) for (const list of [all, ...sides]) for (let i = 0; i < n; i++) list[i] = Math.min(1, list[i] / top);
    out = { all, sides };
    peaksOf.set(b, out);
  }
  return side === undefined ? out.all : out.sides[Math.min(side, out.sides.length - 1)] ?? out.all;
}

/** The stretches the Canvas paints one picture each for: from one marker to the next (the whole song when it has none). */
function regionsOf(song: TimelineSong): { key: string; index: number; from: number; to: number }[] {
  const end = Math.max(songEnd(song), sigBeats(song.meter));
  const marks = [...(song.markers ?? [])].sort((a, b) => a.beat - b.beat).filter((m) => m.beat < end - EPS);
  if (!marks.length) return [{ key: "song", index: 0, from: 0, to: end }];
  const out: { key: string; index: number; from: number; to: number }[] = [];
  if (marks[0].beat > EPS) out.push({ key: "start", index: 7, from: 0, to: marks[0].beat });
  marks.forEach((m, i) => out.push({ key: m.name || m.id, index: m.color ?? i % 8, from: m.beat, to: marks[i + 1]?.beat ?? end }));
  return out;
}

/** No track is heard without its effects. */
const NO_BYPASS: ReadonlySet<string> = new Set();
const NO_TAKES: TakeRef[] = [];
const NO_STUDIO: Studio = {};
/** A take as it is read from disk: its file with the track's sound on it, or (`dry`) as it was sung. */
const takeRef = (k: Take5, dry?: boolean): TakeRef => ({ wet: dry ? k.dry : k.wet, start: k.start, frames: k.frames });
/** The takes a song plays, as they are read from disk: those on its lanes, and for a bypassed track the files as they were sung. */
export function takesHeard(song: Pick<TimelineSong, "tracks" | "clips">, bypass: ReadonlySet<string>, dry: boolean): TakeRef[] {
  const out: TakeRef[] = [];
  for (const t of song.tracks) {
    if ((t.kind !== "vocals" && t.kind !== "audio") || (dry && !bypass.has(t.id))) continue;
    for (const k of t.takes) if (k.dry !== k.wet || !dry) if (song.clips.some((c) => c.kind === "audio" && c.track === t.id && c.take === k.id)) out.push(takeRef(k, dry));
  }
  return out;
}

/** What a composer window is on, as the song's functions take it. */
const targetOf = (w: Pick<WinState, "track" | "clip">): OpenTarget => (w.clip === undefined ? { track: w.track } : { track: w.track, clip: w.clip });

/** The bars a composer's ▶ goes round: all of a placed clip (a short rhythm is heard as it comes round inside it); a draft's bars at its anchor. */
export function auditSpan(s: Pick<App5State, "song" | "session">, w: Pick<WinState, "track" | "clip">): Region | null {
  const o = openOf(s.song, targetOf(w), draftAnchor(s.song, s.session));
  if (!o) return null;
  return o.clip ? { from: o.clip.start, to: o.clip.start + o.clip.len } : o.span;
}

/** The track whose draft is heard with the song: that of the composer whose ▶ runs, else of the one that has the focus, while it is on its draft. */
export function draftHeard(windows: readonly WinState[], audit: string | null, focused: string | null): string | null {
  const draft = (id: string | null) => {
    const w = id === null ? undefined : windows.find((x) => x.id === id);
    return w && w.open && w.kind === "compose" && w.clip === undefined && w.id !== REC_WIN ? w.track : null;
  };
  return draft(audit) ?? draft(focused);
}

export function Host() {
  const app = useApp5();
  const { state, edit, editKeyed, setSession, toast, undo, redo, canUndo, canRedo, idea, dirty, saveIdea, syncNow, tuning, opened, peek, set } = app;
  const { song, key, session } = state;
  const live = useRef({ state, app });
  live.current = { state, app };

  // ── the guitar's shapes, as the player and the exports need them ──
  const { capo, avoidBarre, tuningId } = state.settings;
  const shapes = state.shapes;
  const shapeOf = useCallback(
    (ref: ChordRef, voicingId?: string) => chordShape(ref, tuning, capo, avoidBarre, voicingId, shapes[shapeKey(ref, tuningId, capo)]),
    [shapes, tuning, tuningId, capo, avoidBarre],
  );
  const voicingsOf = useMemo<FlattenCtx["voicingsOf"]>(() => voicingsFor({ tuning, capo, avoidBarre, shapeOf }), [tuning, capo, avoidBarre, shapeOf]);
  // Harmonize hears the chords as this guitar plays them, and writes chords it can play
  useEffect(() => setHarmonyEnv({ tuning, capo }), [tuning, capo]);
  // a synth drone holds the song's home note
  useEffect(() => setHome(pc(key.tonic)), [key.tonic]);
  const buffer = useTakes(song);
  /** the tracks heard without their effects just now (a sound window's bypass, Alt + click on FX): never part of the idea */
  const [bypass, setBypass] = useState<ReadonlySet<string>>(NO_BYPASS);
  const toggleBypass = useCallback((track: string) => setBypass((b) => {
    const next = new Set(b);
    if (!next.delete(track)) next.add(track);
    return next.size ? next : NO_BYPASS;
  }), []);
  // (a track that is gone is not bypassed any more)
  useEffect(() => setBypass((b) => ([...b].every((id) => song.tracks.some((t) => t.id === id)) ? b : new Set([...b].filter((id) => song.tracks.some((t) => t.id === id))))), [song.tracks]);
  // a track that records, bypassed: its takes are heard as they were sung, so those files are read too (and kept
  // while they play, with the song's own)
  const dryTakes = useMemo(() => (bypass.size ? takesHeard(song, bypass, true) : NO_TAKES), [song.tracks, song.clips, bypass]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dryReady, setDryReady] = useState(0);
  useEffect(() => {
    if (!dryTakes.length) return;
    let on = true;
    keepBuffers([...takesHeard(song, bypass, false), ...dryTakes]);
    for (const tk of dryTakes) if (canLoad(tk) && !takeBuffer(tk)) void loadTake(tk).then((b) => on && b && setDryReady((n) => n + 1));
    return () => { on = false; };
  }, [dryTakes]); // eslint-disable-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ctx = useMemo<FlattenCtx>(() => ({ voicingsOf, buffer, ...(bypass.size ? { bypass } : {}) }), [voicingsOf, buffer, bypass, dryReady]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // ── windows ──
  const setSessionBusy = useCallback((fn: (s: Session) => Session) => {
    setSession((s) => {
      const next = fn(s);
      // (a zoom draws the lanes afresh: the song is booked further ahead for that moment)
      if (next.pxPerBeat !== s.pxPerBeat && s.pxPerBeat > 0) bookAhead();
      return next;
    });
  }, [setSession]);
  const wins = useWindows(session, setSession);
  /** where a draft is treated as lying: the bar line at or before the loop's start when the loop is on, else at or before the cursor */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const anchor = useMemo(() => draftAnchor(song, session), [song.meter, song.sigs, session.cursor, session.loop]);
  /** the composer whose ▶ is going round its bars, and for each composer whether ▶ plays its track alone */
  const [audit, setAuditState] = useState<string | null>(null);
  const auditRef = useRef<{ win: string; span: string; heard?: true } | null>(null);
  const [alone, setAlone] = useState<Record<string, boolean>>({});
  const aloneRef = useRef(alone);
  aloneRef.current = alone;
  /** the track whose draft is heard with the song now */
  const drafted = draftHeard(session.windows, audit, wins.focused);

  // ── what is heard: the song, or the song with a Harmonize candidate written in ──
  const [candidate, setCandidateState] = useState<{ win: string; target: Target; p: Progression } | null>(null);
  const candidateRef = useRef(candidate);
  const setCandidate = useCallback((c: { win: string; target: Target; p: Progression } | null) => {
    candidateRef.current = c;
    setCandidateState(c);
  }, []);
  const tried = useMemo(() => {
    if (!candidate) return song;
    const lens = lensOf(song, candidate.target, key, anchor);
    if (!lens) return song;
    let n = 0;
    try {
      return unlens(song, candidate.target, lens, candidate.p, () => `heard-${++n}`);
    } catch {
      return song;
    }
  }, [song, key, candidate, anchor]);
  // … and with the draft of the composer being worked in laid in at its anchor, on its own track (in this copy only)
  const heard = useMemo(() => (drafted ? previewSong(tried, drafted, anchor) : tried), [tried, drafted, anchor]);
  const heardRef = useRef(heard);
  heardRef.current = heard;
  /** the draft as it lies in what is heard: drawn faintly on its lane, so it is seen where it sounds */
  const ghost = useMemo(() => (drafted ? (heard.clips.find((c) => c.id === draftClipId(drafted) && c.kind !== "audio") as NoteClip | undefined) ?? null : null), [heard, drafted]);
  const played = usePlayer(heard, session, ctx);
  // a song this computer cannot keep up with is said so in a line, once each time it is played (see audio/overload.ts)
  useEffect(() => {
    if (!played.playing) return;
    const c = audioIfStarted();
    return c ? watchOverload(c, () => toast(OVERLOAD_MESSAGE)) : undefined;
  }, [played.playing, toast]);
  /** a recording or a rehearsal runs: the interface plays the song, so the app's own player stays silent */
  const recBusy = useRef(false);
  /** the recorder as it is this moment (the desktop app's engine, or a browser's microphone: set further down) */
  const engineNow = useRef<EngineApi>(null as unknown as EngineApi);
  const playedRef = useRef(played);
  playedRef.current = played;
  const player = useMemo(() => ({
    ...played,
    toggle: () => {
      // (in a browser the song plays under a recording through this very player: ▶ and Space then stop the recording, and the song with it)
      if (recBusy.current) return void (!isDesktop() && engineNow.current.phase === "recording" && engineNow.current.stop());
      played.toggle();
    },
    audition: (span: Parameters<typeof played.audition>[0], solo?: string) => {
      if (!span || !recBusy.current) played.audition(span, solo);
    },
  }), [played]);
  const playerRef = useRef(player);
  playerRef.current = player;
  // another idea opened: nothing of the idea left sounds on over it
  const openedNow = useRef(opened);
  /** (the harmony sheet is set up further down: this closes it) */
  const closeHarmony = useRef(() => {});
  useEffect(() => {
    if (openedNow.current === opened) return;
    openedNow.current = opened;
    playerRef.current.stop();
    setCandidate(null);
    setBypass(NO_BYPASS);
    mounted.current.clear();
    closeHarmony.current();
  }, [opened, setCandidate]);
  const playerApi = useMemo<PlayerApi>(() => ({
    ...player,
    toggle: () => {
      // (nothing to hear: it says so, instead of a play line crossing empty bars)
      if (!player.playing && !flatten(heardRef.current, ctxRef.current).any) return toast("Nothing to play yet: open a track with its compose button and write something");
      player.toggle();
    },
  }), [player, toast, peek]);

  // ── recording: the engine, the one record window, the top bar's ● and monitor control, the panels' inputs ──
  const desktop = isDesktop();
  const micLive = useLive();
  const audioTracks = useSame(useMemo(() => audioTracksOf(song), [song.tracks]));
  const audioClips = useSame(useMemo(() => song.clips.filter((c): c is AudioClip => c.kind === "audio"), [song.clips]));
  const recordingTo = app.recordingTo;
  // The track the engine is on (its input and its sound are heard through the effects, and a recording goes onto
  // it), which is also the one the record window shows: the one being recorded on while that runs; else the armed
  // track; else the selected track when it records; else the one it was on last; else the top one.
  const lastRec = useRef<string | null>(null);
  const recId = shownTrack(audioTracks, { recording: recordingTo, armed: session.armed, selected: session.sel.track, last: lastRec.current });
  lastRec.current = recId;
  const recTrack = audioTracks.find((t) => t.id === recId) ?? null;
  const recFx = useMemo(() => reviveFx(recTrack?.fx) ?? FX_DEFAULT, [recTrack?.fx]);
  // (one input, or a pair: the pair's first input is the left side, the next one the right)
  const recInput = Math.max(0, Math.round(recTrack?.input?.ch ?? 0));
  const recPair = !!recTrack?.input?.pair;
  const engineTrack = useMemo<EngineTrack | null>(
    () => (recTrack ? { id: recTrack.id, name: recTrack.name, ...engineInputs(recPair ? { ch: recInput, pair: true } : { ch: recInput }), fx: recFx } : null),
    [recTrack?.id, recTrack?.name, recInput, recPair, recFx], // eslint-disable-line react-hooks/exhaustive-deps
  );
  /** a track's list of inputs is open: the interface is wanted for it as for a window that shows it, so the levels beside its lines are live */
  const [listing, setListing] = useState(false);
  /** which part of the settings is open (false: the sheet is closed) */
  const [settings, setSettings] = useState<false | SettingsPart>(false);
  const recWin = session.windows.find((w) => w.id === REC_WIN);
  /** the song's side of a recording: what it goes round, and the finished recording laid on its track */
  const recSong = useMemo(() => recordSong({ app: () => live.current.app, ctx: () => ctxRef.current }), []);
  // K keeps a pass while the record window has the keys; while a recording runs, also from the timeline and from a
  // recording track's sound window (wherever no other window has them)
  const focusedOn = session.windows.find((w) => w.id === wins.focused);
  const keysElsewhere = !!focusedOn && focusedOn.id !== REC_WIN && !(focusedOn.kind === "sound" && audioTracks.some((t) => t.id === focusedOn.track));
  const native = useEngine({
    active: windowWants({ record: !!recWin?.open, setup: settings === "audio", armed: !!session.armed }) || listing,
    playing: played.playing,
    track: engineTrack,
    bypassed: !!recId && bypass.has(recId),
    keys: !keysElsewhere,
    plan: recSong.plan,
    onRecorded: recSong.onRecorded,
    onRecording: (on) => {
      // the interface plays the song: the app's own player stops, and stays silent meanwhile
      recBusy.current = on;
      if (on) playerRef.current.stop();
    },
  });
  // in a browser there is no such engine: the microphone is recorded as the browser gives it, while the song plays
  // through the app's own player (ui/audio/useWebRec; it does nothing in the desktop app)
  const web = useWebRec({
    on: !desktop,
    track: engineTrack,
    keys: !keysElsewhere,
    plan: recSong.plan,
    spanOf: recSong.spanOf,
    onRecorded: recSong.onRecorded,
    onRecording: (on) => {
      recBusy.current = on;
      if (on) playerRef.current.stop();
    },
    play: (from, round) => {
      const s = heardRef.current;
      if (round) {
        if (!flatten(s, ctxRef.current, { spans: [round], loop: true }).items.length) return false;
        playedRef.current.audition(round);
        return true;
      }
      if (from >= songEnd(s) - EPS) return false;
      playedRef.current.playFrom(from);
      return true;
    },
    stopSong: () => playedRef.current.stop(),
    beat: () => playedRef.current.getBeat(),
  });
  const engine = desktop ? native : web;
  engineNow.current = engine;
  /** open the record window (on a track: that track is the one shown, so the arm moves to it when another was armed) */
  const openRecord = useCallback((track?: string) => {
    const s = peek();
    const audio = audioTracksOf(s.song);
    const locked = live.current.app.recordingTo;
    const on = track && audio.some((t) => t.id === track) ? track : shownTrack(audio, { recording: locked, armed: s.session.armed, selected: s.session.sel.track, last: s.session.windows.find((w) => w.id === REC_WIN)?.track });
    bookAhead();
    setSession((x) => {
      const next = openRecordWin(x, on ?? "", { w: window.innerWidth, h: window.innerHeight, panel: PANEL_W, top: TOP_H });
      if (!track || !on || locked) return next;
      return { ...next, armed: x.armed && x.armed !== on ? on : x.armed, sel: next.sel.track === on ? next.sel : { ...next.sel, track: on } };
    });
    wins.focus(REC_WIN);
  }, [peek, setSession, wins]);
  /** the top bar's ● and Ctrl+R: stop the recording that runs; else record onto the armed track (with none armed: the selected one that records, else the top one, armed first) */
  const recordToggle = useCallback(() => {
    const ph = engineNow.current.phase;
    if (ph === "recording") return engineNow.current.toggle();
    if (ph !== "idle") return;
    const s = peek();
    const audio = audioTracksOf(s.song);
    const target = shownTrack(audio, { armed: s.session.armed, selected: s.session.sel.track });
    if (!target) return;
    bookAhead();
    setSession((x) => ({ ...openRecordWin(x, target, { w: window.innerWidth, h: window.innerHeight, panel: PANEL_W, top: TOP_H }), armed: target }));
    wins.focus(REC_WIN);
    engineNow.current.start(target);
  }, [peek, setSession, wins]);
  // Ctrl+R with the focus inside a window, in the take list or in a box (while recording it mostly is): the timeline's
  // keys leave it alone there, and the desktop app's own window would take it for "load the page again"
  const toggleNow = useRef(recordToggle);
  toggleNow.current = recordToggle;
  useEffect(() => {
    if (!desktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "r" || whereOf(e.target) === "timeline") return;
      e.preventDefault();
      if (!e.repeat) toggleNow.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop]);
  // a recording begun from the window itself arms its track too: the lit ● on the panel is always the track that records
  useEffect(() => {
    if (recordingTo) setSession((x) => (x.armed === recordingTo ? x : { ...x, armed: recordingTo }));
  }, [recordingTo, setSession]);
  const monitor = state.studio?.monitor ?? "hardware";
  const isOpen = !!engine.opened;
  const setMonitor = useCallback((m: "hardware" | "effects") => {
    set((x) => ((x.studio?.monitor ?? "hardware") === m ? x : { ...x, studio: { ...x.studio, monitor: m } }));
    // through the effects needs the interface: where it is not open yet, the record window opens, and the interface with it
    if (m === "effects" && desktop && !engineNow.current.opened) openRecord();
  }, [set, desktop, openRecord]);
  const record = useMemo(() => (audioTracks.length ? {
    on: engine.phase === "recording",
    busy: engine.phase === "preparing" || engine.phase === "saving" || engine.phase === "rehearsing",
    live: micLive,
    toggle: recordToggle,
    monitor,
    // (in a browser there is no monitoring to choose)
    ...(desktop ? { setMonitor } : {}),
    pass: engine.phase === "recording" ? engine.pass : 0,
  } : undefined), [audioTracks.length, engine.phase, engine.pass, micLive, recordToggle, monitor, setMonitor, desktop]);
  // every input the interface has: as it opened; else as the list of interfaces says of the one chosen; else as
  // many as it had when it was last open (two until one has been). In a browser: the two channels a microphone can give
  const inputCount = desktop ? countInputs({ opened: engine.opened?.inputs, device: engine.chosen?.channels, remembered: state.studio?.inputs }) : INPUTS_UNKNOWN;
  const inputs = useMemo(() => ({
    count: inputCount,
    ...(isOpen ? { level: (ch: number) => engineNow.current.level(ch) } : {}),
    ...(desktop ? {
      // a small live level beside every line of a track's input list
      meters: true,
      // "Audio setup…" in a track's input list: the Audio part of the settings
      setup: () => setSettings("audio"),
      listing: setListing,
    } : {}),
  }), [inputCount, isOpen, desktop]);
  /**
   * The recording that runs, as it grows on its lane. Round a loop: from the beat it goes round from to where the
   * music is in this pass. With the song played once: from the beat the song was played from, for as long as the
   * recording has run (on past the song's end, until it is stopped).
   */
  const growing = useCallback(() => {
    const to = live.current.app.recordingTo;
    if (!to) return null;
    const plan = engineNow.current.running();
    const span = plan && recSong.spanOf(plan);
    if (!plan || !span) return { track: to, from: 0, to: 0 };
    if (plan.once) return { track: to, from: span.from, to: span.from + ((engineNow.current.since() ?? 0) * plan.bpm) / 60 };
    const at = engineNow.current.at();
    return { track: to, from: span.from, to: span.from + (at ? at.frac * (span.to - span.from) : 0) };
  }, [recSong]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const round = useMemo(() => (audioTracks.length ? roundLabel(song, session) : ""), [audioTracks.length, song, session.loop, session.cursor]);
  /** with the loop off a recording plays the song once, from the cursor's bar */
  const recordsOnce = !(session.loop?.on && session.loop.regions.length);
  const recCtl = useMemo<RecordCtl>(() => ({
    app: () => live.current.app,
    stopSong: () => playerRef.current.stop(),
    setup: () => setSettings("audio"),
    focus: () => wins.focus(REC_WIN),
    close: () => {
      bookAhead();
      wins.close(REC_WIN);
    },
    move: (r) => wins.move(REC_WIN, r),
  }), [wins]);
  const audioSettings = useMemo<AudioSettings>(
    () => ({ engine, setNudge: recSong.setNudge, track: engineTrack ? { name: engineTrack.name, input: engineTrack.input, ...(engineTrack.inputB !== undefined ? { pair: true } : {}) } : null }),
    [engine, recSong, engineTrack],
  );

  const open = useCallback((kind: "compose" | "sound", track: string, clip?: string) => {
    // (the state as it is this moment: a clip made just now, by the same press, is in it)
    const s = peek();
    const t = s.song.tracks.find((x) => x.id === track);
    if (!t) return;
    const records = t.kind === "vocals" || t.kind === "audio";
    // a track that records: its compose button opens the one record window
    if (records && kind === "compose") return openRecord(track);
    bookAhead();
    if (kind === "sound") {
      // its FX button opens its own sound window. For a track that records, the engine goes over to it (it is
      // selected, and armed when another was), so what is turned in the window is heard at once through the effects
      if (records && !live.current.app.recordingTo) setSession((x) => ({ ...x, armed: x.armed && x.armed !== track ? track : x.armed, sel: x.sel.track === track ? x.sel : { ...x.sel, track } }));
      return wins.open("sound", track);
    }
    // the compose button opens the track's draft; a clip that was double-clicked (or just made) is opened itself
    wins.open("compose", track, clip !== undefined && s.song.clips.some((c) => c.id === clip && c.track === track && c.kind !== "audio") ? clip : undefined);
  }, [wins, peek, openRecord, setSession]);
  const setAudit = useCallback((win: string | null, span?: Region) => {
    auditRef.current = win && span ? { win, span: `${span.from}:${span.to}` } : null;
    setAuditState(win);
  }, []);
  const close = useCallback((id: string) => {
    bookAhead();
    wins.close(id);
    if (candidateRef.current?.win === id) {
      playerRef.current.audition(null);
      setCandidate(null);
    }
    if (auditRef.current?.win === id) {
      playerRef.current.audition(null);
      setAudit(null);
    }
  }, [wins, setCandidate, setAudit]);
  // (the record window is not one of these: it is drawn on its own, below)
  const all = session.windows.filter((w) => w.id !== REC_WIN);
  const sheet = useSheet();
  /** the window in front (the list's order is the stacking order) */
  const front = [...session.windows].reverse().find((w) => w.open)?.id;
  const shown = all.filter((w) => w.open);
  /** the windows that were open at some time since this idea opened: closed, they are hidden, not gone */
  const mounted = useRef(new Set<string>());
  for (const w of shown) mounted.current.add(w.id);
  // (the same object for a window while it is on the same thing, so it is not drawn again for nothing)
  const targets = useRef(new Map<string, OpenTarget>());
  const targetFor = (w: WinState): OpenTarget => {
    const was = targets.current.get(w.id);
    if (was && was.track === w.track && was.clip === w.clip) return was;
    const t = targetOf(w);
    targets.current.set(w.id, t);
    return t;
  };
  // A window whose track is gone closes. A composer whose clip is gone (an undo, a delete) closes too, and is back on
  // its track's draft the next time it is opened.
  useEffect(() => {
    const gone = all.filter((w) => !song.tracks.some((t) => t.id === w.track) || (w.kind === "compose" && w.clip !== undefined && !song.clips.some((c) => c.id === w.clip && c.track === w.track)));
    if (!gone.length) return;
    for (const w of gone) {
      if (w.open) close(w.id);
      setSession((s) => retargetWin(closeWin(s, w.id), w.id, undefined));
    }
  });
  // ▶ of a composer ends with the music; and while it runs it follows what the window is on (another clip, more bars, the anchor moved)
  useEffect(() => {
    const a = auditRef.current;
    if (!a) return;
    // (the music starts a moment after ▶ is pressed: it has ended only once it was heard)
    if (!player.playing) return a.heard ? setAudit(null) : undefined;
    a.heard = true;
    const w = session.windows.find((x) => x.id === a.win && x.open);
    const span = w ? auditSpan({ song, session }, w) : null;
    if (!w || !span) {
      playerRef.current.audition(null);
      return setAudit(null);
    }
    if (`${span.from}:${span.to}` === a.span) return;
    setAudit(a.win, span);
    playerRef.current.audition(span, aloneRef.current[a.win] ? w.track : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.playing, song, session.windows, session.cursor, session.loop]);

  // what is played to be heard goes to the track of the window that has the focus
  const focusedWin = shown.find((w) => w.id === wins.focused) ?? shown[shown.length - 1];
  // (the signature a synth's arp is fitted to in a sound window: that of the clip open in the track's composer, else at the cursor)
  const sigAtCursor = barMap(song).sigAt(Math.max(0, session.cursor) + EPS);
  const heardTrack = song.tracks.find((t) => t.id === focusedWin?.track);
  const heardKind = heardTrack?.kind;
  const heardTone = heardTrack && "tone" in heardTrack ? heardTrack.tone : undefined;
  const heardRaw = heardTrack && "tone" in heardTrack ? heardTrack.sound : undefined;
  const heardSound = useMemo(() => reviveSound(heardRaw), [heardRaw]);
  const heardId = heardTrack?.id;
  useLayoutEffect(() => {
    if (!heardId || !heardTone) return;
    if (heardKind === "chords") hearOn("chord", { track: heardId, kind: "chord", tone: heardTone, sound: heardSound });
    else if (heardKind === "melody" || heardKind === "bass") hearOn("melody", { track: heardId, kind: "melody", tone: heardTone, sound: heardSound });
  }, [heardId, heardKind, heardTone, heardSound]);

  // ── Harmonize: hearing a candidate, and writing a harmony again ──
  const onPreview = useCallback((win: string, target: Target, p: Progression | null) => {
    if (!p) {
      if (candidateRef.current?.win !== win) return;
      playerRef.current.audition(null);
      return setCandidate(null);
    }
    const s = peek();
    const o = openOf(s.song, target, draftAnchor(s.song, s.session));
    if (!o) return;
    // (the bars go round from the moment a candidate is first heard; another option then takes its place as it plays)
    if (candidateRef.current?.win !== win) {
      setAudit(null);
      playerRef.current.audition(o.span);
    }
    setCandidate({ win, target, p });
  }, [setCandidate, setAudit, peek]);
  // the one harmony sheet: a composer's Harmonize button asks for it, and it is shown inside that composer's window
  const harmony = useHarmonize({ song, windows: session.windows, focused: wins.focused, playing: player.playing, preview: onPreview, focus: wins.focus });
  closeHarmony.current = harmony.close;
  /** a composer's ▶: the bars it has open go round, with the song or (its "alone" switch) the track on its own; pressed again, they stop */
  const playWin = useCallback((id: string, toggle: boolean) => {
    if (auditRef.current?.win === id && playerRef.current.playing) {
      if (!toggle) return;
      playerRef.current.audition(null);
      return setAudit(null);
    }
    const s = peek();
    const w = s.session.windows.find((x) => x.id === id);
    const span = w ? auditSpan(s, w) : null;
    if (!w || !span) return;
    wins.focus(id);
    setAudit(id, span);
    playerRef.current.audition(span, aloneRef.current[id] ? w.track : undefined);
  }, [peek, wins, setAudit]);
  /** a rhythm or a style was picked: it is heard straight away, if nothing is playing */
  const onHearNow = useCallback((id: string) => {
    if (!playerRef.current.playing) playWin(id, false);
  }, [playWin]);
  const onAlone = useCallback((id: string, on: boolean) => {
    aloneRef.current = { ...aloneRef.current, [id]: on };
    setAlone(aloneRef.current);
    // (while its bars go round, the switch is heard at once)
    const w = peek().session.windows.find((x) => x.id === id);
    const span = w ? auditSpan(peek(), w) : null;
    if (w && span && auditRef.current?.win === id && playerRef.current.playing) playerRef.current.audition(span, on ? w.track : undefined);
  }, [peek]);
  const again = useCallback((track: string, clip: string) => {
    const s = peek();
    const target: Target = { track, clip };
    const lens = lensOf(s.song, target, s.key, 0);
    if (!lens) return;
    const id = lens.lead === track ? "chords" : lens.melody === track ? "melody" : track;
    const after = rewriteHarmony(lens.p, s.key, id);
    if (after === lens.p) return toast("There is nothing to write it from here");
    edit("Write harmony again", (x) => {
      const now = lensOf(x, target, s.key, 0);
      return now ? unlens(x, target, now, after, newId) : x;
    });
    toast("Harmony written again", { label: "↶", aria: "Undo", run: undo });
  }, [peek, edit, toast, undo]);
  /** harmony clips whose source changed since they were written (worked out a moment after the song settles) */
  const [stale, setStale] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const marked = song.clips.filter((c) => c.kind !== "audio" && c.kind !== "drums" && c.harmony);
    if (!marked.length) return setStale((s) => (s.size ? new Set() : s));
    const t = window.setTimeout(() => {
      const out = new Set<string>();
      for (const c of marked) {
        try {
          if (harmonyState5(song, key, c.id).stale) out.add(c.id);
        } catch {
          /* a clip that cannot be read this way shows no dot */
        }
      }
      setStale((s) => (s.size === out.size && [...out].every((x) => s.has(x)) ? s : out));
    }, 300);
    return () => window.clearTimeout(t);
  }, [song, key]);

  // ── copy and paste ──
  const clip = state.clip;
  const clipboard = useMemo(() => ({
    has: !!clip?.clips.length,
    copy(ids: string[]) {
      const s = peek();
      const c = copyOut(s.song, ids, s.key);
      if (!c.clips.length) return;
      set((x) => ({ ...x, clip: c }));
      toast(c.clips.length > 1 ? `${c.clips.length} clips copied` : "Clip copied");
    },
    paste(at: number, onto: string | null, insert: boolean) {
      const c = peek().clip;
      if (!c?.clips.length) return;
      const base = `p${newId()}`;
      edit(insert ? "Paste and make room" : "Paste", (s) => {
        let n = 0;
        const room = insert ? insertTime(s, at, clipboardBeats(c, s.bpm)) : s;
        return pasteIn(room, c, at, peek().key, onto, () => `${base}-${++n}`);
      });
    },
  }), [clip, peek, set, edit, toast]);
  const [soundCopy, setSoundCopy] = useState<SoundCopy | null>(null);
  const sounds = useMemo(() => {
    /** a sound to paste onto a track: the one copied on its own, else the one the clipboard's track carries */
    const forTrack = (t: Track | undefined): SoundCopy | null => {
      if (!t) return null;
      if (soundCopy && soundCopy.kind === CLIP_OF[t.kind]) return soundCopy;
      const from = clip?.tracks.find((x) => CLIP_OF[x.kind] === CLIP_OF[t.kind]);
      return from ? copySound(from) : null;
    };
    return {
      copy(track: string) {
        const t = peek().song.tracks.find((x) => x.id === track);
        if (!t) return;
        setSoundCopy(copySound(t));
        toast(`Sound of ${t.name} copied`);
      },
      paste(track: string) {
        const sc = forTrack(peek().song.tracks.find((x) => x.id === track));
        if (sc) edit("Paste sound", (s) => pasteSound(s, track, sc));
      },
      has: (track: string) => !!forTrack(peek().song.tracks.find((x) => x.id === track)),
    };
  }, [soundCopy, clip, peek, edit, toast]);
  /** ⧉ in a composer's strip: what is open, copied (a draft as a clip one round of its content long, with its track's sound) */
  const copyOpen = useCallback((id: string) => {
    const s = peek();
    const w = s.session.windows.find((x) => x.id === id);
    if (!w) return;
    if (w.clip !== undefined) return clipboard.copy([w.clip]);
    const scratch = stampOpen({ ...s.song, clips: [] }, targetOf(w), w.track, 0, 0, () => "copied");
    const c = copyOut(scratch, ["copied"], s.key);
    if (!c.clips.length) return;
    set((x) => ({ ...x, clip: c }));
    toast("Draft copied");
  }, [peek, set, toast, clipboard]);
  /** ⎘: what was copied, written into what is open (moved into this idea's key, fitted to its time signature) */
  const pasteInto = useCallback((id: string) => {
    const s = peek();
    const c = s.clip;
    const w = s.session.windows.find((x) => x.id === id);
    const t = w && s.song.tracks.find((x) => x.id === w.track);
    const from = t && c?.clips.find((x) => x.kind === CLIP_OF[t.kind]);
    if (!w || !t || !c || !from || from.kind === "audio") return;
    const target = targetOf(w);
    // the copy is moved into this idea's key on a scratch song (as any paste is), then written into what is open
    const scratch = pasteIn({ ...s.song, tracks: [t], clips: [] }, { ...c, clips: [{ ...from, start: 0 }] }, 0, s.key, t.id, () => "scratch");
    const made = scratch.clips.find((x) => x.id === "scratch") as NoteClip | undefined;
    if (!made) return;
    const moved = from.kind !== "drums" && (c.key.tonic !== s.key.tonic || c.key.scaleId !== s.key.scaleId) ? `, moved to ${displayNote(s.key.tonic)}` : "";
    const back = { label: "↶", aria: "Undo", run: undo };
    if (w.clip === undefined) {
      // into the draft: it becomes what was copied, as long as that is
      edit("Paste", (x) => writeOpen(x, target, made.content, draftAnchor(x, s.session)));
      return toast(`Pasted${moved}`, back);
    }
    const open = s.song.clips.find((x) => x.id === w.clip) as NoteClip | undefined;
    if (!open) return;
    edit("Paste", (x) => setContent(x, open.id, made.content));
    toast(`Pasted${moved}${contentBeats(made) > open.len + EPS ? ". Some of it is past the end of the clip" : ""}`, back);
  }, [peek, edit, toast, undo]);

  // ── a composer's clip dragged out of its strip onto a lane ──
  /** the kind of clip being dragged (the lanes that do not take it are dimmed) */
  const [dropKind, setDropKind] = useState<ClipKind | null>(null);
  const dragHost = useMemo<ClipDragHost>(() => ({
    view: () => {
      const s = peek();
      return { song: s.song, pxPerBeat: s.session.pxPerBeat > 0 ? s.session.pxPerBeat : 16, scroll: Math.max(0, s.session.scroll) };
    },
    begin: (p) => {
      bookAhead();
      setDropKind(p.kind);
    },
    end: () => setDropKind(null),
    scrollBy: (beats) => setSession((s) => ({ ...s, scroll: Math.max(0, s.scroll + beats) })),
    drop: (p, lane, beat) => {
      const s = peek();
      const base = `c${newId()}`;
      const ids = () => {
        let n = 0;
        return () => `${base}-${++n}`;
      };
      if (stampOpen(s.song, p.from, lane, beat, draftAnchor(s.song, s.session), ids()) === s.song) return false;
      bookAhead();
      edit("Place clip", (x) => stampOpen(x, p.from, lane, beat, draftAnchor(x, s.session), ids()));
      // the window is on the clip just placed (on another track: that track's composer), so the next change is heard in the song
      const made = `${base}-1`;
      setSession((x) => ({ ...x, sel: { clips: [made], track: lane } }));
      wins.open("compose", lane, made);
      return true;
    },
  }), [peek, edit, setSession, wins]);
  const stripDrag = useClipDrag(dragHost, key);
  /**
   * The strip's Place button (a phone): what a drop on the window's own lane at the cursor does, by a tap. The copy
   * lands on the bar the cursor is in, and the cursor goes to its end, so the next one lands after it.
   */
  const placeWin = useCallback((id: string) => {
    const s = peek();
    const w = s.session.windows.find((x) => x.id === id);
    const t = w && s.song.tracks.find((x) => x.id === w.track);
    if (!w || !t) return;
    const at = barMap(s.song).floorBar(Math.max(0, s.session.cursor));
    const before = new Set(s.song.clips.map((c) => c.id));
    if (!dragHost.drop({ type: "clip", kind: CLIP_OF[t.kind], from: targetOf(w) }, w.track, at)) return toast("Nothing to place yet");
    const now = peek();
    const made = now.song.clips.find((c): c is NoteClip => !before.has(c.id) && c.track === w.track && c.kind !== "audio");
    if (!made) return;
    const end = made.start + made.len;
    setSession((x) => ({ ...x, cursor: end }));
    playerRef.current.seek(end);
    const bar = barMap(now.song).barAt(made.start).bar + 1;
    toast(`Placed at bar ${bar}`);
  }, [peek, dragHost, setSession, toast]);
  const dragWin = useCallback((e: React.PointerEvent<HTMLElement>, id: string, look: Parameters<typeof stripDrag.start>[2]) => {
    const s = peek();
    const w = s.session.windows.find((x) => x.id === id);
    const t = w && s.song.tracks.find((x) => x.id === w.track);
    if (!w || !t) return;
    stripDrag.start(e, { type: "clip", kind: CLIP_OF[t.kind], from: targetOf(w) }, look);
  }, [peek, stripDrag]);

  // ── the top bar ──
  const [ideas, setIdeas] = useState<false | "open" | "named">(false);
  const [canvas, setCanvas] = useState<"never" | "open" | "closed">("never");
  const [rendering, setRendering] = useState(false);
  const save = useCallback(() => {
    const r = saveIdea();
    if (r === "nothing") return toast("Nothing to save yet");
    syncNow();
    // the first save opens the library so the idea can be named
    if (r === "new") setIdeas("named");
    else toast("Saved");
  }, [saveIdea, syncNow, toast]);
  const exportsOf = useMemo(() => {
    const file = () => (live.current.app.idea?.name || "m-theory-idea").replace(/[^\w-]+/g, "-");
    const none = () => toast("Nothing to export yet: write some chords, a melody or drums first");
    return {
      async wav() {
        const s = peek().song;
        const flat = flatten(s, ctx);
        if (!flat.any) return none();
        setRendering(true);
        try {
          const r = await saveFile(await wav5(s, flat, 48000), `${file()}.wav`, "audio/wav");
          toast(r === "saved" ? "Song saved as WAV" : r === "failed" ? "Can't save files here" : "Cancelled");
        } catch (e) {
          toast(`Couldn't make the WAV: ${String(e)}`);
        } finally {
          setRendering(false);
        }
      },
      async midi() {
        const s = peek().song;
        const flat = flatten(s, ctx);
        if (!flat.any) return none();
        const r = await saveFile(midi5(s, flat, live.current.app.idea?.name ?? ""), `${file()}.mid`, "audio/midi");
        toast(r === "saved" ? "MIDI saved" : r === "failed" ? "Can't save files here" : "Cancelled");
      },
      async chart() {
        const st = peek();
        if (!hasChords5(st.song)) return toast("There are no chords to copy yet");
        const text = chart5(st.song, st.key, { tuning, capo: st.settings.capo, voicingsOf, name: live.current.app.idea?.name });
        try {
          await navigator.clipboard.writeText(text);
          toast("Copied");
        } catch {
          const r = await saveFile(new TextEncoder().encode(text), "chords.txt", "text/plain");
          toast(r === "saved" ? "Chords saved as text" : r === "failed" ? "Couldn't copy here" : "Cancelled");
        }
      },
    };
  }, [ctx, peek, toast, tuning, voicingsOf]);
  // a recording keeps the key, the tempo and the time signature it was sung in: where the song differs now, the bar says so
  const sung = useMemo(() => {
    const takes: Take5[] = [];
    for (const t of song.tracks) if (t.kind === "vocals" || t.kind === "audio") for (const k of t.takes) if (song.clips.some((c) => c.kind === "audio" && c.track === t.id && c.take === k.id && !c.mute)) takes.push(k);
    if (!takes.length) return undefined;
    const map = barMap(song);
    const offTempo = [...new Set(takes.map((k) => k.bpm).filter((b): b is number => !!b && b !== song.bpm))];
    const offKey = [...new Set(takes.map((k) => k.key).filter((k): k is string => !!k))].filter((k) => {
      const [tonic, scaleId] = k.split("|");
      return pc(tonic) !== pc(key.tonic) || scaleId !== key.scaleId;
    });
    const offSig = [...new Set(takes.filter((k) => k.sig && k.at !== null && k.sig !== sigName(map.sigAt(k.at + EPS))).map((k) => k.sig!))];
    const out: { key?: string; bpm?: number; sig?: string } = {};
    if (offKey.length) out.key = offKey.map((k) => `${displayNote(k.split("|")[0])} ${getScale(k.split("|")[1]).name}`).join(", ");
    if (offTempo.length) out.bpm = offTempo[0];
    if (offSig.length) out.sig = offSig.join(", ");
    return Object.keys(out).length ? out : undefined;
  }, [song, key]);
  const count = useMemo(() => state.saved.filter((i) => !i.backup).length, [state.saved]);
  const openCanvas = useCallback(() => {
    // (the Canvas can hold the page up for a moment as it opens: the song is booked a second ahead first)
    bookAhead();
    setCanvas("open");
  }, []);
  const top = useMemo(() => ({
    badge: <DraftBadge />,
    idea: { name: idea?.name ?? null, dirty, count, save },
    onKey: (k: Key) => editKeyed("Key", (s) => ({ song: s, key: k })),
    onMove: (n: number) => editKeyed("Move song", (s, was) => {
      const to: Key = { ...was, tonic: bestTonicSpelling(pc(was.tonic) + n, getScale(was.scaleId)) };
      // (a harmony that stood as it was written still does after the move: its record follows)
      return { song: transposeSong(s, n, was, to), key: to };
    }),
    onTempo: (bpm: number) => edit("Tempo", (s) => setTempo(s, Math.max(40, Math.min(200, Math.round(bpm)))), "tempo"),
    onSig: (sig: TimeSig, fromHereOn: boolean) => edit("Time signature", (s) => setSig(s, barMap(s).barAt(peek().session.cursor).bar, sig, fromHereOn)),
    ...(sung ? { sung } : {}),
    ...(record ? { record } : {}),
    undo, redo, canUndo, canRedo,
    exports: { ...exportsOf, busy: rendering },
    openCanvas,
    openIdeas: () => setIdeas("open"),
    openSettings: () => setSettings("guitar"),
  }), [idea, dirty, count, save, editKeyed, edit, peek, sung, record, undo, redo, canUndo, canRedo, exportsOf, rendering, openCanvas]);

  const editBusy = useCallback((label: string, fn: (s: TimelineSong) => TimelineSong, control?: string) => {
    if (HEAVY.has(label)) bookAhead();
    edit(label, fn, control);
  }, [edit]);
  const say = useCallback((msg: string, withUndo?: boolean) => toast(msg, withUndo ? { label: "↶", aria: "Undo", run: undo } : undefined), [toast, undo]);
  const peaks = useCallback((take: Take5, side?: number) => {
    const b = buffer(take);
    return b ? peaksFrom(b, side) : undefined;
  }, [buffer]);

  // ── the Canvas: an overlay with the whole Canvas card; one painting for each stretch between markers ──
  const regions = useMemo(() => regionsOf(song), [song]);
  const spotRef = useRef({ regions, song, cursor: session.cursor });
  spotRef.current = { regions, song, cursor: session.cursor };
  const spotAt = useCallback((beat: number): Spot => {
    const { regions: rs, song: s } = spotRef.current;
    const r = rs.find((x) => beat >= x.from - EPS && beat < x.to - EPS) ?? rs[rs.length - 1];
    const bar = sigBeats(barMap(s).sigAt(r.from + EPS));
    return { key: r.key, index: r.index, beat: Math.max(0, beat - r.from), bar, bars: Math.max(1, Math.round((r.to - r.from) / bar)), spb: 60 / s.bpm };
  }, []);
  const getSpot = useCallback((): Spot | null => {
    const b = playerRef.current.getBeat();
    return b === null ? null : spotAt(b);
  }, [spotAt]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rest = useMemo((): Spot => ({ ...spotAt(session.cursor), beat: 0 }), [spotAt, regions, session.cursor, song.bpm]);
  /** the beat the Canvas's ears are planned for (a clip may play instead of the chords there): the cursor, or where the music is */
  const [earsAt, setEarsAt] = useState(0);
  const canvasOpen = canvas === "open";
  useEffect(() => {
    if (!canvasOpen) return;
    const look = () => {
      const b = playerRef.current.getBeat() ?? spotRef.current.cursor;
      setEarsAt((was) => (planKey(planTaps5(spotRef.current.song, b)) === planKey(planTaps5(spotRef.current.song, was)) ? was : b));
    };
    look();
    const t = window.setInterval(look, 400);
    return () => window.clearInterval(t);
  }, [canvasOpen, song]);
  const plans = useMemo(() => planTaps5(song, earsAt), [song, earsAt]);
  const closeCanvas = useCallback(() => {
    bookAhead();
    setCanvas("closed");
  }, []);
  const overlay = useRef<HTMLDivElement>(null);
  // Escape closes what lies over the view, one thing per press (the Canvas's own full screen is asked before this)
  useEffect(() => (canvasOpen ? onEscape(ESC_OPEN, () => (closeCanvas(), true)) : undefined), [canvasOpen, closeCanvas]);
  useEffect(() => (settings ? onEscape(ESC_OPEN, () => (setSettings(false), true)) : undefined), [settings]);
  // while something lies over the view the keys go to it: the timeline behind takes none of its own
  useEffect(() => {
    const el = canvasOpen ? overlay.current : ideas || settings ? document.querySelector<HTMLElement>(".sheet-backdrop .sheet") : null;
    if (!el) return;
    if (!el.hasAttribute("tabindex")) el.tabIndex = -1;
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [canvasOpen, ideas, settings]);
  /** the old pages' key chip: the key is in the top bar now, and its panel is opened from there */
  const showKey = useCallback(() => document.querySelector<HTMLButtonElement>('.tlv-top .tlv-popbtn[aria-label^="Key:"]')?.click(), []);

  const muteClip = useCallback((id: string) => edit("Clip on or off", (s) => ({ ...s, clips: s.clips.map((c): Clip => {
    if (c.id !== id) return c;
    if (!c.mute) return { ...c, mute: true };
    const { mute: _m, ...on } = c;
    return on as Clip;
  }) })), [edit]);
  /** what every composer window asks of the host: one object for all of them, the same from one draw to the next */
  const does = useRef({ wins, close, harmony, onHearNow, showKey, muteClip, copyOpen, pasteInto, open, playWin, onAlone, dragWin, placeWin, sounds, toggleBypass });
  does.current = { wins, close, harmony, onHearNow, showKey, muteClip, copyOpen, pasteInto, open, playWin, onAlone, dragWin, placeWin, sounds, toggleBypass };
  const ctl = useMemo<ComposerCtl>(() => {
    const winOf = (id: string) => peek().session.windows.find((x) => x.id === id);
    return {
      focus: (id) => does.current.wins.focus(id),
      close: (id) => does.current.close(id),
      move: (id, r) => does.current.wins.move(id, r),
      harmonize: (id, kind, anchor, again) => does.current.harmony.ask(id, kind, anchor, again),
      endHarmonize: (id) => does.current.harmony.end(id),
      hearNow: (id) => does.current.onHearNow(id),
      showKey: () => does.current.showKey(),
      mute: (id) => does.current.muteClip(id),
      hearTrack: (track) => edit("Hear track", (s) => {
        const why = quietWhy(s.mix, track);
        return why ? { ...s, mix: mixWith(s.mix, track, why === "mute" ? { mute: false } : { solo: true }) } : s;
      }),
      show: (track, clip) => does.current.open("compose", track, clip),
      sound: (track) => {
        bookAhead();
        does.current.wins.open("sound", track, undefined, true);
      },
      play: (id) => does.current.playWin(id, true),
      setAlone: (id, on) => does.current.onAlone(id, on),
      fresh: (id) => {
        const w = winOf(id);
        const s = peek();
        const t = w && s.song.tracks.find((x) => x.id === w.track);
        if (!w || !t) return;
        // the draft is emptied (one undo step), and the window is on it
        edit("New draft", (x) => setDraft(x, w.track, null, barMap(x).sigAt(0)));
        setSession((x) => retargetWin(x, id, undefined));
      },
      bars: (id, n) => {
        const w = winOf(id);
        const session = peek().session;
        if (w) edit("Length", (x) => setOpenBars(x, targetOf(w), n, draftAnchor(x, session)), `bars:${id}`);
      },
      copy: (id) => does.current.copyOpen(id),
      paste: (id) => does.current.pasteInto(id),
      fit: (id) => {
        const w = winOf(id);
        const session = peek().session;
        if (w) edit("Fit to these bars", (x) => fitOpen(x, targetOf(w), draftAnchor(x, session)));
      },
      drag: (e, id, look) => does.current.dragWin(e, id, look),
      place: (id) => does.current.placeWin(id),
    };
  }, [peek, edit, setSession]);
  const soundCtl = useMemo<SoundCtl>(() => ({
    focus: (id) => does.current.wins.focus(id),
    close: (id) => does.current.close(id),
    move: (id, r) => does.current.wins.move(id, r),
    copy: (track) => does.current.sounds.copy(track),
    paste: (track) => does.current.sounds.paste(track),
    bypass: (track) => does.current.toggleBypass(track),
  }), []);
  const bypassCtl = useMemo(() => ({ on: bypass, toggle: toggleBypass }), [bypass, toggleBypass]);

  return (
    <>
      <Guard what="the track view">
        <TrackView song={song} keyOf={key} session={session} edit={editBusy} setSession={setSessionBusy} player={playerApi} open={open} peaks={peaks}
          clipboard={clipboard} sound={sounds} top={top} stale={stale} again={again} say={say} inputs={inputs} recording={growing} dropKind={dropKind} bypass={bypassCtl} ghost={ghost} />
      </Guard>
      <Guard what="the record window" onClose={recCtl.close}>
        <RecordHost win={recWin} focused={wins.focused === REC_WIN} z={zOf(session, REC_WIN)} track={recTrack} clips={audioClips} shelf={song.shelf} inputs={inputCount}
          picked={session.sel.clips} round={round} once={recordsOnce} engine={engine} studio={state.studio ?? NO_STUDIO} setNudge={recSong.setNudge} ctl={recCtl} />
      </Guard>
      {/* (always in the same order on the page, whichever is in front: a window pressed to bring it forward must not be moved in the page under the press, or the press is lost. What is in front is the stacking number's to say) */}
      {[...all].sort((a, b) => (a.id < b.id ? -1 : 1)).map((w) => {
        const t = song.tracks.find((x) => x.id === w.track);
        if (!t || !mounted.current.has(w.id)) return null;
        // (as sheets, on a phone, one is shown at a time: the one in front; the others wait behind it as they were left)
        const frame = { win: w, track: t, song, keyOf: key, focused: wins.focused === w.id, hidden: !w.open || (sheet && w.id !== front), z: zOf(session, w.id), player: playerApi };
        if (w.kind === "sound") {
          const Sound = PLUGINS[t.kind].sound;
          if (!Sound) return null;
          const composing = all.find((x) => x.kind === "compose" && x.track === w.track && x.clip !== undefined);
          const sig = (composing && song.clips.find((c) => c.id === composing.clip && c.kind !== "audio") as NoteClip | undefined)?.sig ?? sigAtCursor;
          return (
            <Guard key={w.id} what={`the sound of ${t.name}`} onClose={() => close(w.id)}>
              <Sound {...frame} bypassed={bypass.has(t.id)} canPaste={sounds.has(t.id)} compound={isCompound(sig)} ctl={soundCtl} />
            </Guard>
          );
        }
        const Composer = PLUGINS[t.kind].compose;
        if (!Composer) return null;
        const canPaste = !!clip?.clips.some((c) => c.kind === CLIP_OF[t.kind] && c.kind !== "audio");
        return (
          <Guard key={w.id} what={`the ${t.name} window`} onClose={() => close(w.id)}>
            <Composer {...frame} target={targetFor(w)} anchor={anchor} audit={audit === w.id && player.playing} alone={!!alone[w.id]} heard={w.clip !== undefined || drafted === w.track} ctl={ctl} canPaste={canPaste} harmonizing={harmony.lit === w.id} />
          </Guard>
        );
      })}
      {harmony.sheet}
      {stripDrag.ghost}
      {canvas !== "never" && (
        <div className={`cv-over${canvasOpen ? " open" : ""}`} hidden={!canvasOpen} data-keys="own" ref={overlay} role="dialog" aria-label="Canvas" onPointerDown={(e) => { if (e.target === e.currentTarget) closeCanvas(); }}>
          <Guard what="the Canvas" onClose={closeCanvas}>
            <V4View>
              <CanvasPage active={canvasOpen} playing={player.playing} getSpot={getSpot} rest={rest} keyOf={key} onPlay={playerApi.toggle} canPlay={songEnd(song) > 0} plans={plans} onClose={closeCanvas} />
            </V4View>
          </Guard>
        </div>
      )}
      {settings && <V4View><SettingsPanel onClose={() => setSettings(false)} part={settings} onPart={setSettings} audio={audioSettings} /></V4View>}
      {ideas && <IdeasPanel onClose={() => setIdeas(false)} justSaved={ideas === "named"} />}
    </>
  );
}
