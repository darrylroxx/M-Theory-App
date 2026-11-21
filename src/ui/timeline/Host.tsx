// The host of the track view: it reads the app's state and builds everything the view is handed. It owns the player,
// the plugin windows (in this release each one is an old composer page behind a lens), the one record window (the old
// Vocals page, mounted once and for good), the Canvas as an overlay, and the two sheets (Ideas and settings).
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { saveFile } from "../../audio/midi";
import { isDesktop } from "../../desktop";
import { reviveSound } from "../../audio/rack";
import { bookAhead, hearOn } from "../../audio/synth";
import { setHome } from "../../audio/trackplay";
import type { Spot } from "../../canvas/layout";
import { planKey } from "../../canvas/taps";
import { planTaps5 } from "../../canvas/taps5";
import { chordShape } from "../../guitar/arrange";
import { rewriteHarmony, setHarmonyEnv } from "../../song/harmony";
import { sigBeats, sigName, type TimeSig } from "../../song/meter";
import type { ChordRef } from "../../theory/chords";
import type { Key } from "../../theory/keys";
import { displayNote, pc } from "../../theory/notes";
import { bestTonicSpelling, getScale } from "../../theory/scales";
import { barMap } from "../../timeline/bars";
import { clipboardBeats, copyOut, copySound, insertTime, pasteIn, pasteSound, setContent, setSig, setTempo, songEnd, transpose } from "../../timeline/edit";
import { chart5, hasChords5, midi5, wav5 } from "../../timeline/export";
import { flatten, type FlattenCtx } from "../../timeline/flatten";
import { harmonyState5, lensOf, unlens, type Target } from "../../timeline/lens";
import { CLIP_OF, clipEnd, contentBeats, type AudioClip, type Clip, type NoteClip, type Session, type SoundCopy, type Take5, type TimelineSong, type Track } from "../../timeline/model";
import { voicingsFor } from "../../timeline/voicing";
import { useApp5 } from "../app5";
import { CanvasPage } from "../components/CanvasPage";
import { DraftBadge } from "../components/Desktop";
import { IdeasPanel } from "../components/IdeasPanel";
import { SettingsPanel } from "../components/SettingsPanel";
import type { RecordPhase } from "../components/VocalsPage";
import { useLive } from "../live";
import { REC_WIN, RecordHost, audioTracksOf, openRecordWin, roundLabel, shownTrack, type RecordApi, type RecordCtl } from "../plugins/audio/RecordHost";
import { LegacyComposer, type ComposerCtl } from "../plugins/LegacyComposer";
import { newId, shapeKey, type Progression } from "../state";
import { V4View, lensIn } from "../windows/ClipLens";
import { PANEL_W, TOP_H, openWins, useWindows, zOf } from "../windows/windows";
import type { PlayerApi } from "./api";
import { ESC_OPEN, onEscape, whereOf } from "./keys";
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
const HEAVY = new Set(["Add track", "Remove track", "Duplicate track", "Paste", "Paste and make room", "Move clip", "Move clips", "Copy clip", "Copy clips", "Insert time", "Remove time"]);

const EPS = 1e-6;
/** A list as it was the last time, while every item in it is the same one (so what is handed on is not drawn again for nothing). */
function useSame<T>(list: T[]): T[] {
  const kept = useRef(list);
  if (kept.current !== list && (kept.current.length !== list.length || kept.current.some((x, i) => x !== list[i]))) kept.current = list;
  return kept.current;
}
/** How loud a take is along its length, for its picture on the lane: worked out once for a decoded take. */
const peaksOf = new WeakMap<AudioBuffer, Float32Array>();
function peaksFrom(b: AudioBuffer): Float32Array {
  let out = peaksOf.get(b);
  if (out) return out;
  const n = Math.max(1, Math.min(1200, Math.ceil(b.duration * 40)));
  out = new Float32Array(n);
  const step = b.length / n;
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      let m = out[i];
      // (every few samples is enough for a picture this small)
      const end = Math.min(b.length, Math.floor((i + 1) * step));
      const hop = Math.max(1, Math.floor(step / 64));
      for (let j = Math.floor(i * step); j < end; j += hop) {
        const v = d[j] < 0 ? -d[j] : d[j];
        if (v > m) m = v;
      }
      out[i] = m;
    }
  }
  let top = 0;
  for (const v of out) if (v > top) top = v;
  if (top > 0) for (let i = 0; i < n; i++) out[i] = Math.min(1, out[i] / top);
  peaksOf.set(b, out);
  return out;
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
  const ctx = useMemo<FlattenCtx>(() => ({ voicingsOf, buffer }), [voicingsOf, buffer]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // ── what is heard: the song, or the song with a Harmonize candidate written in ──
  const [candidate, setCandidateState] = useState<{ win: string; target: Target; p: Progression } | null>(null);
  const candidateRef = useRef(candidate);
  const setCandidate = useCallback((c: { win: string; target: Target; p: Progression } | null) => {
    candidateRef.current = c;
    setCandidateState(c);
  }, []);
  const heard = useMemo(() => {
    if (!candidate) return song;
    const lens = lensOf(song, candidate.target, key, 0);
    if (!lens) return song;
    let n = 0;
    try {
      return unlens(song, candidate.target, lens, candidate.p, () => `heard-${++n}`);
    } catch {
      return song;
    }
  }, [song, key, candidate]);
  const played = usePlayer(heard, session, ctx);
  /** a recording or a rehearsal runs: the interface plays the song, so the app's own player stays silent */
  const recBusy = useRef(false);
  const player = useMemo(() => ({
    ...played,
    toggle: () => {
      if (!recBusy.current) played.toggle();
    },
    audition: (span: Parameters<typeof played.audition>[0], solo?: string) => {
      if (!span || !recBusy.current) played.audition(span, solo);
    },
  }), [played]);
  const playerRef = useRef(player);
  playerRef.current = player;
  // another idea opened: nothing of the idea left sounds on over it
  const openedNow = useRef(opened);
  useEffect(() => {
    if (openedNow.current === opened) return;
    openedNow.current = opened;
    playerRef.current.stop();
    setCandidate(null);
  }, [opened, setCandidate]);
  const playerApi = useMemo<PlayerApi>(() => ({
    ...player,
    toggle: () => {
      // (nothing to hear: it says so, instead of a play line crossing empty bars)
      if (!player.playing && !flatten(peek().song, ctxRef.current).any) return toast("Nothing to play yet: open a track with its compose button and write something");
      player.toggle();
    },
  }), [player, toast, peek]);

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

  // ── recording: the one record window, the top bar's ● and monitor control, the panels' inputs ──
  const desktop = isDesktop();
  const recApi = useRef<RecordApi | null>(null);
  const [rec, setRec] = useState<{ phase: RecordPhase; pass: number; open: boolean }>({ phase: "idle", pass: 0, open: false });
  const recNow = useRef(rec);
  recNow.current = rec;
  const [recSound, setRecSound] = useState(0);
  const micLive = useLive();
  const audioTracks = useSame(useMemo(() => audioTracksOf(song), [song.tracks]));
  const audioClips = useSame(useMemo(() => song.clips.filter((c): c is AudioClip => c.kind === "audio"), [song.clips]));
  /** open the record window (on a track: that track is the one shown, so the arm moves to it when another was armed) */
  const openRecord = useCallback((track?: string, toSound = false) => {
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
    if (toSound) setRecSound((n) => n + 1);
  }, [peek, setSession, wins]);
  /** the top bar's ● and Ctrl+R: stop the recording that runs; else record onto the armed track (with none armed: the selected one that records, else the top one, armed first) */
  const recordToggle = useCallback(() => {
    const ph = recNow.current.phase;
    if (ph === "recording") return recApi.current?.toggle();
    if (ph !== "idle") return;
    const s = peek();
    const audio = audioTracksOf(s.song);
    const target = shownTrack(audio, { armed: s.session.armed, selected: s.session.sel.track });
    if (!target) return;
    bookAhead();
    setSession((x) => ({ ...openRecordWin(x, target, { w: window.innerWidth, h: window.innerHeight, panel: PANEL_W, top: TOP_H }), armed: target }));
    wins.focus(REC_WIN);
    // (in a browser there is no recording yet: the window says so)
    if (desktop) recApi.current?.start(target);
  }, [peek, setSession, wins, desktop]);
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
  const recordingTo = app.recordingTo;
  useEffect(() => {
    if (recordingTo) setSession((x) => (x.armed === recordingTo ? x : { ...x, armed: recordingTo }));
  }, [recordingTo, setSession]);
  const monitor = state.studio?.monitor ?? "hardware";
  const setMonitor = useCallback((m: "hardware" | "effects") => {
    set((x) => ((x.studio?.monitor ?? "hardware") === m ? x : { ...x, studio: { ...x.studio, monitor: m } }));
    // through the effects needs the interface: where it is not open yet, the record window opens, and the interface with it
    if (m === "effects" && desktop && !recNow.current.open) openRecord();
  }, [set, desktop, openRecord]);
  const record = useMemo(() => (audioTracks.length ? {
    on: rec.phase === "recording",
    busy: rec.phase === "preparing" || rec.phase === "saving" || rec.phase === "rehearsing",
    live: micLive,
    toggle: recordToggle,
    monitor,
    setMonitor,
    pass: rec.phase === "recording" ? rec.pass : 0,
  } : undefined), [audioTracks.length, rec.phase, rec.pass, micLive, recordToggle, monitor, setMonitor]);
  // inputs 1 and 2 in this release (as many as the interface had when it was last open, two until it has been)
  const inputCount = Math.max(1, Math.min(2, state.studio?.inputs ?? 2));
  const inputs = useMemo(() => ({
    count: inputCount,
    ...(rec.open ? { level: (ch: number) => recApi.current?.level(ch) ?? 0 } : {}),
    setup: () => openRecord(),
  }), [inputCount, rec.open, openRecord]);
  const growing = useCallback(() => recApi.current?.growing() ?? null, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const round = useMemo(() => (audioTracks.length ? roundLabel(song, session) : ""), [audioTracks.length, song, session.loop, session.cursor]);
  const recCtl = useMemo<RecordCtl>(() => ({
    app: () => live.current.app,
    ctx: () => ctxRef.current,
    stopSong: () => playerRef.current.stop(),
    busy: (on) => { recBusy.current = on; },
    report: (r) => setRec((was) => (was.phase === r.phase && was.pass === r.pass && was.open === r.open ? was : r)),
    focus: () => wins.focus(REC_WIN),
    close: () => {
      bookAhead();
      wins.close(REC_WIN);
    },
    move: (r) => wins.move(REC_WIN, r),
  }), [wins]);

  /** windows opened by FX: their sound panels are brought into view (a count for each, so asking again scrolls again) */
  const [toSound, setToSound] = useState<Record<string, number>>({});
  const open = useCallback((kind: "compose" | "sound", track: string, clip?: string) => {
    // (the state as it is this moment: a clip made just now, by the same press, is in it)
    const s = peek();
    const t = s.song.tracks.find((x) => x.id === track);
    if (!t) return;
    // a track that records: the one record window (FX: at its vocal sound)
    if (t.kind === "vocals" || t.kind === "audio") return openRecord(track, kind === "sound");
    bookAhead();
    // what a track's buttons open: its selected clip; else the clip under the cursor; else its first clip; with no
    // clip at all, nothing yet (the first thing written makes one)
    let on = clip;
    if (on === undefined || !s.song.clips.some((c) => c.id === on && c.track === track)) {
      const mine = s.song.clips.filter((c) => c.track === track).sort((a, b) => a.start - b.start);
      const was = s.session.windows.find((w) => w.id === `compose:${track}`)?.clip;
      on = (mine.find((x) => s.session.sel.clips.includes(x.id)) ?? mine.find((x) => x.start <= s.session.cursor && clipEnd(x, s.song) > s.session.cursor) ?? mine[0])?.id
        // (the id the first clip will have: the same one while the window stays on the empty track)
        ?? (clip === undefined && was && !s.song.clips.some((c) => c.id === was) ? was : `c${newId()}`);
    }
    // (in this release the sound panels are part of the composer's page: FX opens the same window, at the sound)
    wins.open("compose", track, on);
    if (kind === "sound") setToSound((m) => ({ ...m, [`compose:${track}`]: (m[`compose:${track}`] ?? 0) + 1 }));
  }, [wins, peek, openRecord]);
  const close = useCallback((id: string) => {
    bookAhead();
    wins.close(id);
    if (candidateRef.current?.win === id) {
      playerRef.current.audition(null);
      setCandidate(null);
    }
  }, [wins, setCandidate]);
  /** what a composer window is on (null: a track that records; undefined: its clip is gone, and it closes) */
  const targetOf = useCallback((s: TimelineSong, cursor: number, track: Track, clip: string | undefined): Target | null | undefined => {
    if (track.kind === "vocals" || track.kind === "audio") return null;
    if (clip !== undefined && s.clips.some((c) => c.id === clip && c.track === track.id)) return { track: track.id, clip };
    if (s.clips.some((c) => c.track === track.id)) return undefined;
    // a track with nothing on it: the first thing written lands on the bar the cursor is in
    const map = barMap(s);
    const at = map.floorBar(Math.max(0, cursor));
    return { track: track.id, fresh: { id: clip ?? "c-new", at, sig: map.sigAt(at + EPS) } };
  }, []);
  // (the record window is not a composer: it is drawn on its own, below)
  const shown = openWins(session).filter((w) => w.id !== REC_WIN);
  const targets = useMemo(() => {
    const out = new Map<string, Target | null | undefined>();
    for (const w of shown) {
      const t = song.tracks.find((x) => x.id === w.track);
      out.set(w.id, t ? targetOf(song, session.cursor, t, w.clip) : undefined);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.map((w) => `${w.id}:${w.clip ?? ""}`).join("|"), song.tracks, song.clips, song.sigs, song.meter, session.cursor, targetOf]);
  // (the same object while it says the same, so a window is not drawn again for nothing)
  const kept = useRef(new Map<string, Target | null | undefined>());
  const stable = useMemo(() => {
    const out = new Map<string, Target | null | undefined>();
    for (const [id, t] of targets) {
      const was = kept.current.get(id);
      out.set(id, was !== undefined && was !== null && t && JSON.stringify(was) === JSON.stringify(t) ? was : t);
    }
    kept.current = out;
    return out;
  }, [targets]);
  // a window whose clip or track is gone (an undo, a delete) closes; so does a composer left open on a track that records
  // (kept from before recording had its window)
  useEffect(() => {
    for (const w of shown) if (stable.get(w.id) === undefined || stable.get(w.id) === null) close(w.id);
  });

  // what is played to be heard goes to the track of the window that has the focus
  const focusedWin = shown.find((w) => w.id === wins.focused) ?? shown[shown.length - 1];
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
    const lens = lensIn(peek(), target);
    if (!lens) return;
    // (the bars go round from the moment a candidate is first heard; another option then takes its place as it plays)
    if (candidateRef.current?.win !== win) playerRef.current.audition(lens.span);
    setCandidate({ win, target, p });
  }, [setCandidate, peek]);
  const onHearNow = useCallback((target: Target) => {
    if (playerRef.current.playing) return;
    const s = peek();
    // the clip's own bars go round (all of them: a short rhythm is heard as it comes round inside its clip)
    const c = target.clip === undefined ? undefined : s.song.clips.find((x) => x.id === target.clip);
    const lens = lensIn(s, target);
    if (c && c.kind !== "audio") playerRef.current.audition({ from: c.start, to: c.start + c.len });
    else if (lens) playerRef.current.audition(lens.span);
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
  /** ⧉ and ⎘ in a composer's title bar: what is open, copied; and what was copied, written into what is open */
  const pasteInto = useCallback((track: string, target: Target) => {
    const s = peek();
    const c = s.clip;
    const t = s.song.tracks.find((x) => x.id === track);
    const from = t && c?.clips.find((x) => x.kind === CLIP_OF[t.kind]);
    if (!t || !c || !from || from.kind === "audio") return;
    if (target.clip === undefined) {
      // nothing open yet: the copy lands as a clip of its own where the first one would
      const base = `p${newId()}`;
      let n = 0;
      return edit("Paste", (x) => pasteIn(x, { ...c, clips: [{ ...from, start: 0 }] }, target.fresh?.at ?? s.session.cursor, s.key, track, () => `${base}-${++n}`));
    }
    // the copy is moved into this idea's key on a scratch song (as any paste is), then written into the open clip
    const scratch = pasteIn({ ...s.song, tracks: [t], clips: [] }, { ...c, clips: [{ ...from, start: 0 }] }, 0, s.key, track, () => "scratch");
    const made = scratch.clips.find((x) => x.id === "scratch") as NoteClip | undefined;
    const open = s.song.clips.find((x) => x.id === target.clip) as NoteClip | undefined;
    if (!made || !open) return;
    edit("Paste", (x) => setContent(x, open.id, made.content));
    const past = contentBeats(made) > open.len + EPS;
    toast(`Pasted${from.kind !== "drums" && (c.key.tonic !== s.key.tonic || c.key.scaleId !== s.key.scaleId) ? `, moved to ${displayNote(s.key.tonic)}` : ""}${past ? ". Some of it is past the end of the clip" : ""}`, { label: "↶", aria: "Undo", run: undo });
  }, [peek, edit, toast, undo]);

  // ── the top bar ──
  const [ideas, setIdeas] = useState<false | "open" | "named">(false);
  const [settings, setSettings] = useState(false);
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
      return { song: transpose(s, n, was, to), key: to };
    }),
    onTempo: (bpm: number) => edit("Tempo", (s) => setTempo(s, Math.max(40, Math.min(200, Math.round(bpm)))), "tempo"),
    onSig: (sig: TimeSig, fromHereOn: boolean) => edit("Time signature", (s) => setSig(s, barMap(s).barAt(peek().session.cursor).bar, sig, fromHereOn)),
    ...(sung ? { sung } : {}),
    ...(record ? { record } : {}),
    undo, redo, canUndo, canRedo,
    exports: { ...exportsOf, busy: rendering },
    openCanvas,
    openIdeas: () => setIdeas("open"),
    openSettings: () => setSettings(true),
  }), [idea, dirty, count, save, editKeyed, edit, peek, sung, record, undo, redo, canUndo, canRedo, exportsOf, rendering, openCanvas]);

  const editBusy = useCallback((label: string, fn: (s: TimelineSong) => TimelineSong, control?: string) => {
    if (HEAVY.has(label)) bookAhead();
    edit(label, fn, control);
  }, [edit]);
  const say = useCallback((msg: string, withUndo?: boolean) => toast(msg, withUndo ? { label: "↶", aria: "Undo", run: undo } : undefined), [toast, undo]);
  const peaks = useCallback((take: Take5) => {
    const b = buffer(take);
    return b ? peaksFrom(b) : undefined;
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
  const does = useRef({ wins, close, onPreview, onHearNow, showKey, muteClip, clipboard, pasteInto, open });
  does.current = { wins, close, onPreview, onHearNow, showKey, muteClip, clipboard, pasteInto, open };
  const ctl = useMemo<ComposerCtl>(() => ({
    focus: (id) => does.current.wins.focus(id),
    close: (id) => does.current.close(id),
    move: (id, r) => does.current.wins.move(id, r),
    preview: (id, target, p) => does.current.onPreview(id, target, p),
    hearNow: (target) => does.current.onHearNow(target),
    showKey: () => does.current.showKey(),
    mute: (id) => does.current.muteClip(id),
    copy: (id) => does.current.clipboard.copy([id]),
    paste: (track, target) => does.current.pasteInto(track, target),
    show: (track, clip) => does.current.open("compose", track, clip),
  }), []);

  return (
    <>
      <Guard what="the track view">
        <TrackView song={song} keyOf={key} session={session} edit={editBusy} setSession={setSessionBusy} player={playerApi} open={open} peaks={peaks}
          clipboard={clipboard} sound={sounds} top={top} stale={stale} again={again} say={say} inputs={inputs} recording={growing} />
      </Guard>
      <Guard what="the record window" onClose={recCtl.close}>
        <RecordHost win={session.windows.find((w) => w.id === REC_WIN)} focused={wins.focused === REC_WIN} otherFocused={!!wins.focused && wins.focused !== REC_WIN} z={zOf(session, REC_WIN)}
          tracks={audioTracks} clips={audioClips} shelf={song.shelf} bpm={song.bpm} armed={session.armed} selected={session.sel.track} recordingTo={recordingTo}
          round={round} playing={player.playing} toSound={recSound} ctl={recCtl} api={recApi} />
      </Guard>
      {shown.map((w) => {
        const t = song.tracks.find((x) => x.id === w.track);
        const target = stable.get(w.id);
        if (!t || !target) return null;
        const canPaste = !!clip?.clips.some((c) => c.kind === CLIP_OF[t.kind] && c.kind !== "audio");
        return (
          <Guard key={w.id} what={`the ${t.name} window`} onClose={() => close(w.id)}>
            <LegacyComposer win={w} track={t} song={song} keyOf={key} target={target} focused={wins.focused === w.id} z={zOf(session, w.id)} toSound={toSound[w.id]} player={playerApi} ctl={ctl} canPaste={canPaste} />
          </Guard>
        );
      })}
      {canvas !== "never" && (
        <div className={`cv-over${canvasOpen ? " open" : ""}`} hidden={!canvasOpen} data-keys="own" ref={overlay} role="dialog" aria-label="Canvas" onPointerDown={(e) => { if (e.target === e.currentTarget) closeCanvas(); }}>
          <Guard what="the Canvas" onClose={closeCanvas}>
            <V4View>
              <CanvasPage active={canvasOpen} playing={player.playing} getSpot={getSpot} rest={rest} keyOf={key} onPlay={playerApi.toggle} canPlay={songEnd(song) > 0} plans={plans} onClose={closeCanvas} />
            </V4View>
          </Guard>
        </div>
      )}
      {settings && <V4View><SettingsPanel onClose={() => setSettings(false)} /></V4View>}
      {ideas && <IdeasPanel onClose={() => setIdeas(false)} justSaved={ideas === "named"} />}
    </>
  );
}
