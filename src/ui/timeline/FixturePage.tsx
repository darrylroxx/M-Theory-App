// The page that shows the track view on a song built by hand, before the app itself uses the view
// (open the app with ?fixture=timeline). The song, the key and the session live here; undo is the real one;
// what plays is a clock that only pretends (no sound); a window opened from a track holds a few buttons and a
// box to type in, enough to try the key rules. Nothing is stored. (?theme=light or ?theme=dark picks the colours.)
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { barMap } from "../../timeline/bars";
import { clipboardBeats, copyOut, copySound, insertTime, pasteIn, pasteSound, setSig, setTempo, songEnd, transpose } from "../../timeline/edit";
import { keepTakes, makeHistory } from "../../timeline/history";
import { CLIP_OF, type Clipboard5, type Region, type Session, type SoundCopy, type TimelineSong } from "../../timeline/model";
import { pc } from "../../theory/notes";
import type { Key } from "../../theory/keys";
import { bestTonicSpelling, getScale } from "../../theory/scales";
import { Window } from "../windows/Window";
import { openLabel, openWins, useWindows, zOf } from "../windows/windows";
import type { PlayerApi } from "./api";
import { FIXTURE_KEY, fixturePeaks, fixtureSession, fixtureSong } from "./fixture";
import { TrackView } from "./TrackView";

type Idea = { song: TimelineSong; key: Key };

export default function FixturePage() {
  const [idea, setIdea] = useState<Idea>(() => ({ song: fixtureSong(), key: FIXTURE_KEY }));
  const [session, setSession] = useState<Session>(fixtureSession);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const history = useMemo(() => makeHistory(), []);
  /** the idea and the session as they are right now, also between two draws */
  const now = useRef({ idea, session });
  now.current.session = session;

  // the colours asked for in the address
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  }, []);

  // ── messages ──
  const [toast, setToast] = useState<{ msg: string; undo: boolean; n: number } | null>(null);
  const say = useCallback((msg: string, undo = false) => setToast((t) => ({ msg, undo, n: (t?.n ?? 0) + 1 })), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.undo ? 20000 : 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  // ── changes and undo ──
  const apply = useCallback((label: string, next: Idea, control?: string) => {
    const was = now.current.idea;
    if (next.song === was.song && next.key === was.key) return;
    history.push({ song: was.song, key: was.key, label }, control);
    now.current.idea = next;
    setIdea(next);
    redraw();
  }, [history]);
  const edit = useCallback((label: string, fn: (s: TimelineSong) => TimelineSong, control?: string) => {
    const was = now.current.idea;
    apply(label, { song: fn(was.song), key: was.key }, control);
  }, [apply]);
  const step = useCallback((back: boolean) => {
    const was = now.current.idea;
    const to = back ? history.undo({ ...was, label: "" }) : history.redo({ ...was, label: "" });
    if (!to) return;
    // (no recording is lost by an undo)
    const next = { song: keepTakes(to.song, was.song), key: to.key };
    now.current.idea = next;
    setIdea(next);
    setToast(null);
    redraw();
  }, [history]);
  const undo = useCallback(() => step(true), [step]);
  const redo = useCallback(() => step(false), [step]);

  // ── a clock in place of the music ──
  const [playing, setPlaying] = useState(false);
  const clock = useRef<{ at: number; from: number; span: Region | null } | null>(null);
  const getBeat = useCallback((): number | null => {
    const c = clock.current;
    if (!c) return null;
    const { idea: i, session: s } = now.current;
    const gone = ((performance.now() - c.at) / 1000) * (i.song.bpm / 60);
    const regions = c.span ? [c.span] : s.loop?.on ? s.loop.regions : [];
    if (!regions.length) return c.from + gone;
    // round the stretches, one after another; from the cursor when it is inside one, else from the first
    const lens = regions.map((r) => r.to - r.from);
    const total = lens.reduce((a, b) => a + b, 0);
    const k = regions.findIndex((r) => c.from >= r.from && c.from < r.to);
    const lead = k < 0 ? 0 : lens.slice(0, k).reduce((a, b) => a + b, 0) + (c.from - regions[k].from);
    let at = (lead + gone) % total;
    for (let n = 0; n < regions.length; n++) {
      if (at < lens[n]) return regions[n].from + at;
      at -= lens[n];
    }
    return regions[0].from;
  }, []);
  const start = useCallback((from: number, span: Region | null = null) => {
    clock.current = { at: performance.now(), from, span };
    setPlaying(true);
  }, []);
  const stop = useCallback(() => {
    clock.current = null;
    setPlaying(false);
  }, []);
  // with no loop the music stops at the song's end
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      const { idea: i, session: s } = now.current;
      const b = getBeat();
      if (b !== null && !clock.current?.span && !s.loop?.on && b >= songEnd(i.song)) stop();
    }, 100);
    return () => window.clearInterval(t);
  }, [playing, getBeat, stop]);
  const player: PlayerApi = useMemo(() => ({
    playing,
    toggle: () => (clock.current ? stop() : start(now.current.session.cursor)),
    stop,
    getBeat,
    seek: (beat) => { if (clock.current) start(beat, clock.current.span); },
    audition: (span) => (span ? start(span.from, span) : stop()),
  }), [playing, start, stop, getBeat]);

  // ── a pretend recording, so ● and the monitor control show ──
  const [rec, setRec] = useState<{ on: boolean; monitor: "hardware" | "effects" }>({ on: false, monitor: "hardware" });
  const recAt = useRef<{ track: string; from: number; at: number } | null>(null);
  const toggleRec = useCallback(() => {
    if (recAt.current) {
      recAt.current = null;
      setRec((r) => ({ ...r, on: false }));
      return say("Recording stopped (this page only pretends)");
    }
    const { idea: i, session: s } = now.current;
    const audio = i.song.tracks.filter((t) => t.kind === "vocals" || t.kind === "audio");
    // the armed track; else the selected audio track; else the top one
    const track = audio.find((t) => t.id === s.armed) ?? audio.find((t) => t.id === s.sel.track) ?? audio[0];
    if (!track) return;
    setSession((x) => ({ ...x, armed: track.id }));
    recAt.current = { track: track.id, from: s.cursor, at: performance.now() };
    setRec((r) => ({ ...r, on: true }));
  }, [say]);
  const recording = useCallback(() => {
    const r = recAt.current;
    if (!r) return null;
    return { track: r.track, from: r.from, to: r.from + ((performance.now() - r.at) / 1000) * (now.current.idea.song.bpm / 60) };
  }, []);

  // ── copy and paste ──
  const [clip, setClip] = useState<Clipboard5 | null>(null);
  const [sound, setSound] = useState<SoundCopy | null>(null);
  const clipboard = useMemo(() => ({
    has: !!clip,
    copy(ids: string[]) {
      const { song, key } = now.current.idea;
      const c = copyOut(song, ids, key);
      if (!c.clips.length) return;
      setClip(c);
      say(c.clips.length > 1 ? `${c.clips.length} clips copied` : "Clip copied");
    },
    paste(at: number, onto: string | null, insert: boolean) {
      if (!clip) return;
      const base = `p${Math.random().toString(36).slice(2, 8)}`;
      edit(insert ? "Paste and make room" : "Paste", (s) => {
        let n = 0;
        const room = insert ? insertTime(s, at, clipboardBeats(clip, s.bpm)) : s;
        return pasteIn(room, clip, at, now.current.idea.key, onto, () => `${base}-${++n}`);
      });
    },
  }), [clip, edit, say]);
  const sounds = useMemo(() => ({
    copy(track: string) {
      const t = now.current.idea.song.tracks.find((x) => x.id === track);
      if (!t) return;
      setSound(copySound(t));
      say(`Sound of ${t.name} copied`);
    },
    paste(track: string) {
      if (sound) edit("Paste sound", (s) => pasteSound(s, track, sound));
    },
    has(track: string) {
      const t = now.current.idea.song.tracks.find((x) => x.id === track);
      return !!sound && !!t && CLIP_OF[t.kind] === sound.kind;
    },
  }), [sound, edit, say]);

  // ── windows ──
  const wins = useWindows(session, setSession);

  const { song, key } = idea;
  const top = useMemo(() => ({
    badge: <span className="draft-badge" title="A song built by hand: nothing here is saved">Fixture</span>,
    idea: { name: "Fixture song", dirty: history.canUndo, count: 3, save: () => say("Saved (this page only pretends)") },
    onKey: (k: Key) => apply("Key", { song: now.current.idea.song, key: k }),
    onMove: (n: number) => {
      const was = now.current.idea;
      const to: Key = { ...was.key, tonic: bestTonicSpelling(pc(was.key.tonic) + n, getScale(was.key.scaleId)) };
      apply("Move song", { song: transpose(was.song, n, was.key, to), key: to });
    },
    onTempo: (bpm: number) => edit("Tempo", (s) => setTempo(s, bpm), "tempo"),
    onSig: (sig: Parameters<typeof setSig>[2], fromHereOn: boolean) => edit("Time signature", (s) => setSig(s, barMap(s).barAt(now.current.session.cursor).bar, sig, fromHereOn)),
    undo, redo, canUndo: history.canUndo, canRedo: history.canRedo,
    exports: { wav: () => say("WAV (this page only pretends)"), midi: () => say("MIDI (this page only pretends)"), chart: () => say("Chords and tab (this page only pretends)") },
    openCanvas: () => say("The Canvas opens here"),
    openIdeas: () => say("Ideas open here"),
    openSettings: () => say("Settings open here"),
    record: { on: rec.on, busy: false, live: rec.on, toggle: toggleRec, monitor: rec.monitor, setMonitor: (monitor: "hardware" | "effects") => setRec((r) => ({ ...r, monitor })) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [apply, edit, undo, redo, say, rec, toggleRec, history, history.canUndo, history.canRedo]);
  const inputs = useMemo(() => ({ count: 4, setup: () => say("Audio setup opens here") }), [say]);

  return (
    <>
      <TrackView song={song} keyOf={key} session={session} edit={edit} setSession={setSession} player={player} open={wins.open} peaks={fixturePeaks}
        clipboard={clipboard} sound={sounds} top={top} inputs={inputs} recording={recording} say={say} />
      {openWins(session).map((w) => {
        const t = song.tracks.find((x) => x.id === w.track);
        if (!t) return null;
        const title = w.kind === "compose" ? `${t.name} · ${openLabel(song, w.clip)}` : `${t.name} · sound`;
        return (
          <Window key={w.id} win={w} title={title} focused={wins.focused === w.id} z={zOf(session, w.id)} onFocus={() => wins.focus(w.id)} onClose={() => wins.close(w.id)} onMove={(r) => wins.move(w.id, r)}
            tools={<span className="pill">{w.kind === "compose" ? "Composer" : "Sound"}</span>}>
            <WindowBody what={w.kind === "compose" ? "The composer of this track goes here." : "The sound and effects of this track go here."} />
          </Window>
        );
      })}
      {toast && (
        <div className={`toast${toast.undo ? " act" : ""}`} role="status" key={toast.n}>
          <span>{toast.msg}</span>
          {toast.undo && <button aria-label="Undo" onClick={undo}>↶</button>}
        </div>
      )}
    </>
  );
}

/** What stands in a window on this page: a few buttons and a box to type in, to try which keys go where. */
function WindowBody({ what }: { what: string }) {
  const [presses, setPresses] = useState(0);
  const [on, setOn] = useState(false);
  return (
    <div className="stack">
      <p className="muted small">{what}</p>
      <div className="row">
        <button className="btn" data-test="press" onClick={() => setPresses((n) => n + 1)}>Pressed {presses} times</button>
        <button className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setOn((x) => !x)}>A switch</button>
        <input type="text" aria-label="A box to type in" placeholder="Type here" data-test="type" />
        <input type="range" aria-label="A slider" min={0} max={10} defaultValue={5} />
      </div>
    </div>
  );
}
