// Recording in a browser, where there is no desktop engine: the microphone as the browser gives it (audio/webrec),
// while the song plays live through the app's own player. The host of the track view mounts this beside `useEngine`
// and uses the one that fits: it answers to the same names (Record, Stop, the passes and ★, where the music is, the
// level), so the record window, the top bar's ● and the clip that grows on the lane do not care which is behind them.
//
// What is different from the desktop app, and why: there is no count-in and no click (nothing here plays on the
// microphone's clock), no monitoring and no vocal sound (the browser hands the sound over too late to hear yourself
// through it), and a take lands close to in time, not to the sample: the browser says how late its own output is, not
// how late the microphone is. The timing nudge is the correction, and the record window says so in one line.
//
// The finished recording is kept in the browser's own store (audio/takestore) and laid on its track exactly as the
// desktop app's is: round a loop, one take a pass; with the loop off, one take from the cursor's bar until Stop.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { audioContext } from "../../audio/context";
import { dbOf, meterPos } from "../../audio/levels";
import { putSound, storedName } from "../../audio/takestore";
import { stopAlone } from "../../audio/takeplay";
import { canWebRec, micProblem, startWebRec, webOffset, type WebRecorder } from "../../audio/webrec";
import { passAt, passToMark, soundTag, toggled, type Recorded } from "../../song/takes";
import type { Region } from "../../timeline/model";
import { useApp5 } from "../app5";
import { newId } from "../state";
import { engineStatus, type EngineApi, type EngineNow, type EngineTrack, type RecordPhase, type RecordPlan } from "./useEngine";

/** What the host of the track view hands the browser's recorder. */
export interface WebRecHost {
  /** this is a browser (in the desktop app this hook does nothing: the engine records there) */
  on: boolean;
  /** the track that is recorded onto: its input says which of the microphone's channels are kept (null: the song has no track that records) */
  track: EngineTrack | null;
  /** K keeps a pass */
  keys: boolean;
  /** what a recording goes round, or is played once from */
  plan(): RecordPlan | null;
  /** where a plan lies on the timeline, in beats */
  spanOf(plan: RecordPlan): Region | null;
  /** a finished recording: the host cuts it into takes and lays it on the track */
  onRecorded(r: Recorded, o: { kept: number[]; sound: string; plan: RecordPlan; track: string }): void;
  /** a recording began (whatever the app was playing stops), or ended */
  onRecording(on: boolean): void;
  /** play the song under the recording: from `from`, round `round` when one is given. False when there is nothing there to play. */
  play(from: number, round: Region | null): boolean;
  stopSong(): void;
  /** the song beat that sounds now, by the audio clock (null: none) */
  beat(): number | null;
}

/** The frames a second the readouts count in (they are told a position in frames; any rate does, as long as it is one). */
const TICKS = 48000;
/** The first moments of a pass in which K marks the pass that has just ended (s), as in the desktop app. */
const GRACE_S = 2;
const NO_HOSTS = null;
const NO_DEVICES: EngineApi["devices"] = [];

export function useWebRec(host: WebRecHost): EngineApi {
  const { toast, setRecordingTo } = useApp5();
  const [phase, setPhase] = useState<RecordPhase>("idle");
  const [pass, setPass] = useState(0);
  const [marks, setMarks] = useState<Set<number>>(() => new Set());
  const [flash, setFlash] = useState(0);
  const [once, setOnce] = useState(false);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const hostRef = useRef(host);
  hostRef.current = host;
  /** the recording that runs: the recorder, what it goes round, and the audio clock at the song's first beat (null until that is known) */
  const run = useRef<{ rec: WebRecorder; plan: RecordPlan; track: EngineTrack; from: number; loop: number; songAt: number | null } | null>(null);
  const ready = useMemo(() => host.on && canWebRec(), [host.on]);

  /** seconds since the song's first beat (null: nothing runs, or the song has not begun) */
  const since = () => {
    const r = run.current;
    return r && r.songAt !== null ? Math.max(0, audioContext().currentTime - r.songAt) : null;
  };
  /** which pass the loop is in, and how far into it */
  const at = () => {
    const r = run.current;
    const s = since();
    return r && s !== null && r.loop > 0 ? passAt(s * TICKS, 0, r.loop * TICKS) : null;
  };

  const go = async () => {
    const h = hostRef.current;
    const t = h.track;
    if (!h.on || phaseRef.current !== "idle") return;
    if (!t) return toast("Add a Vocals or a Blank track first: the + row under the tracks");
    if (!canWebRec()) return toast("This browser cannot record here");
    const plan = h.plan();
    const span = plan && h.spanOf(plan);
    if (!plan || !span) return;
    setRecordingTo(t.id);
    setMarks(new Set());
    setPass(0);
    setOnce(!!plan.once);
    stopAlone();
    h.onRecording(true);
    setPhase("preparing");
    let rec: WebRecorder;
    try {
      // (the app's own sound and the microphone on one clock: the browser asks for the microphone here, the first time)
      rec = await startWebRec(audioContext(), t.inputB !== undefined ? { ch: t.input, pair: true } : { ch: t.input });
    } catch (e) {
      setPhase("idle");
      h.onRecording(false);
      return toast(micProblem(e));
    }
    const c = audioContext();
    const me = { rec, plan, track: t, from: span.from, loop: plan.once ? 0 : (plan.beats * 60) / plan.bpm, songAt: null as number | null };
    run.current = me;
    // the song starts under it; where there is nothing to play, the recording simply counts from now
    if (!hostRef.current.play(span.from, plan.once ? null : span)) me.songAt = c.currentTime + 0.05;
    setPhase("recording");
  };

  const stop = async () => {
    const me = run.current;
    if (!me || phaseRef.current !== "recording") return;
    setPhase("saving");
    const h = hostRef.current;
    const c = audioContext();
    // (the song never began: stopped at once)
    const songAt = me.songAt ?? c.currentTime;
    h.stopSong();
    try {
      const got = await me.rec.stop();
      const frames = got.channels[0]?.length ?? 0;
      const id = `w${newId()}`;
      if (frames > 0) await putSound(id, { rate: got.rate, channels: got.channels });
      const name = storedName(id);
      const out = c as AudioContext & { outputLatency?: number };
      const r: Recorded = {
        dry: name, wet: name, rate: got.rate, frames,
        // where the song's first beat lies in it: moved earlier by what the browser says of its own lateness
        offset: webOffset({ rate: got.rate, recAt: got.at, songAt, baseLatency: out.baseLatency, outputLatency: out.outputLatency }),
        count_in: 0,
        loop_frames: me.loop > 0 ? Math.max(1, Math.round(me.loop * got.rate)) : 0,
        dropped: 0, padded: 0, note: null, channels: got.channels.length,
      };
      // (nothing is put on a browser's take, so it has the sound of the track as it is: nothing to apply)
      h.onRecorded(r, { kept: [...marksRef.current], sound: soundTag(me.track.fx), plan: me.plan, track: me.track.id });
    } catch (e) {
      toast(`The recording could not be kept (${String((e as { message?: string } | null)?.message ?? e)})`);
    } finally {
      run.current = null;
      setPhase("idle");
      setPass(0);
      setMarks(new Set());
      h.onRecording(false);
      engineStatus.publish({ st: null, now: nowRef.current });
    }
  };
  const goRef = useRef(go);
  goRef.current = go;
  const stopRef = useRef(stop);
  stopRef.current = stop;

  // the takes are on their track (or there were none): the idea can be left again
  useEffect(() => {
    if (host.on && phase === "idle") setRecordingTo(null);
  }, [host.on, phase, setRecordingTo]);

  // ── what the readouts read, while it records: the level, the pass or the time ──
  const trackId = host.track?.id ?? null;
  const now = useMemo<EngineNow>(() => ({ opened: null, phase, pass, track: trackId, bpm: phase === "idle" ? 0 : run.current?.plan.bpm ?? 0 }), [phase, pass, trackId]);
  const nowRef = useRef(now);
  nowRef.current = now;
  useEffect(() => {
    if (!host.on || phase !== "recording") return;
    const tick = () => {
      const me = run.current;
      if (!me) return;
      const c = audioContext();
      // the first time the song is heard to be somewhere: when its first beat was (the beat and the clock are read together)
      if (me.songAt === null) {
        const b = hostRef.current.beat();
        if (b !== null) me.songAt = c.currentTime - ((b - me.from) * 60) / me.plan.bpm;
      }
      const s = since();
      const where = at();
      const n = where ? where.n : 0;
      setPass((was) => (was === n ? was : n));
      const peak = [me.rec.level(0), me.rec.level(1)];
      engineStatus.publish({
        st: { peak, rms: peak, pos: Math.round((s ?? 0) * TICKS), count_in: 0, length: Math.round(me.loop * TICKS), running: s !== null, reduction: 0, invalid: false, xruns: 0, block: 0, latency: 0 },
        now: nowRef.current,
      });
    };
    const t = window.setInterval(tick, 40);
    return () => window.clearInterval(t);
  }, [host.on, phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (host.on) engineStatus.publish({ st: phase === "recording" ? engineStatus.last().st : null, now });
  }, [host.on, now]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── marking passes ★ ──
  const mark = useCallback((n: number, on?: boolean) => {
    if (n < 1) return;
    setMarks((m) => (on === undefined || m.has(n) !== on ? toggled(m, n) : m));
  }, []);
  const markNow = useCallback(() => {
    const me = run.current;
    const where = at();
    if (!me || !where) return;
    const n = passToMark(where, Math.min(0.125, GRACE_S / Math.max(0.001, me.loop)));
    mark(n, true);
    setFlash(n);
  }, [mark]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(0), 700);
    return () => window.clearTimeout(t);
  }, [flash]);
  const keysMine = host.keys;
  useEffect(() => {
    if (!host.on || phase !== "recording" || !keysMine) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      const typing = el instanceof HTMLElement && ((el instanceof HTMLInputElement && el.type !== "checkbox" && el.type !== "range") || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.key !== "k" && e.key !== "K") || e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing) return;
      e.preventDefault();
      markNow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [host.on, phase, markNow, keysMine]);

  // ── the top bar's ●: recording starts once the track asked for is the one shown ──
  const pending = useRef<{ track: string; at: number } | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const want = pending.current;
    if (!want) return;
    if (performance.now() - want.at > 3000) pending.current = null;
    else if (trackId === want.track) {
      pending.current = null;
      if (phaseRef.current === "idle") void goRef.current();
    }
  });

  const does = useMemo(() => ({
    record: () => void goRef.current(),
    rehearse: () => {},
    stop: () => void stopRef.current(),
    toggle: () => {
      const ph = phaseRef.current;
      if (ph === "recording") void stopRef.current();
      else if (ph === "idle") void goRef.current();
    },
    start: (id: string) => {
      pending.current = { track: id, at: performance.now() };
      setTick((n) => n + 1);
    },
    at: () => at(),
    since: () => since(),
    // (a level as the meters draw it: the microphone's loudest sample lately, 0 to 1)
    level: (ch: number) => (run.current ? meterPos(dbOf(run.current.rec.level(ch))) : 0),
    running: () => (phaseRef.current === "idle" ? null : run.current?.plan ?? null),
    relist: () => {},
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo<EngineApi>(
    () => ({ desktop: false, hosts: NO_HOSTS, devices: NO_DEVICES, chosen: undefined, opened: null, error: null, phase, pass, marks, flash, ready, monitor: false, once, again: false, mark, markNow, ...does }),
    [phase, pass, marks, flash, ready, once, mark, markNow, does],
  );
}
