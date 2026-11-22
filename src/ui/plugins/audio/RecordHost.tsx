// The one record window of the track view, as release 1 has it: the old Vocals page in its host mode, inside a
// plugin window. The page is mounted once for the whole app and stays mounted when its window is closed (closing only
// hides it), because it owns the recording engine: so hearing yourself through the effects goes on with the window
// closed, and a recording is never cut off by closing a window.
//
// The page keeps the interface and the room; everything about the song is done here, on the song of tracks and clips:
// which track is shown, what a recording goes round, a finished recording laid on its lane, the take list and its
// edits (each one step of the one undo), the timing nudge moving every take, "Apply sound".
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { freeInterface } from "../../../audio/handoff";
import type { PlayItem } from "../../../audio/patterns";
import { hearAlone, hearingAlone, onAlone as onAloneChange, stopAlone } from "../../../audio/takeplay";
import { FX_DEFAULT, reviveFx, type VocalFx } from "../../../audio/vocalfx";
import { fxRender, isDesktop } from "../../../desktop";
import { sigName } from "../../../song/meter";
import { sameSound, soundTag, type Recorded } from "../../../song/takes";
import { dropTake5, emptyShelf5, keepTake5, removeRecording5, renudge5, renudgeTakes5, stampTakes5, useShelved5, useTake5 } from "../../../timeline/audioclips";
import { barMap } from "../../../timeline/bars";
import { addTrack, setTrack } from "../../../timeline/edit";
import { flatten, type FlattenCtx } from "../../../timeline/flatten";
import type { AudioClip, AudioTrack, Session, Shelved, Take5, TimelineSong, WinState } from "../../../timeline/model";
import { addRecording5, recordPlan5, type RecordPlan5 } from "../../../timeline/record";
import type { Ctx5 } from "../../app5";
import { VocalsPage, type RecordControl, type RecordPhase, type RecordPlan, type VocalHost } from "../../components/VocalsPage";
import { newId } from "../../state";
import { barsLabel } from "../../timeline/gestures";
import { V4View } from "../../windows/ClipLens";
import { Window } from "../../windows/Window";
import { firstPlace } from "../../windows/windows";
import { TakeList5 } from "./TakeList5";
import "./audio.css";

/** The record window's id in the session's list of windows (there is one for the whole app). */
export const REC_WIN = "record";

type Rect = Pick<WinState, "x" | "y" | "w" | "h">;
const EPS = 1e-6;

const isAudioTrack = (t: TimelineSong["tracks"][number] | undefined): t is AudioTrack => !!t && (t.kind === "vocals" || t.kind === "audio");
/** The tracks of a song that record, top to bottom. */
export const audioTracksOf = (song: TimelineSong): AudioTrack[] => song.tracks.filter(isAudioTrack);

/** The record window opened (where it was left; the first time, across the lower lanes as a composer is). `track`: the track it is opened on. */
export function openRecordWin(session: Session, track: string, view: { w: number; h: number; panel: number; top: number }): Session {
  const old = session.windows.find((w) => w.id === REC_WIN);
  const rest = session.windows.filter((w) => w.id !== REC_WIN);
  const next: WinState = old ? { ...old, track, open: true } : { id: REC_WIN, kind: "compose", track, ...firstPlace("compose", view), open: true };
  return { ...session, windows: [...rest, next] };
}

/**
 * The track the record window shows, and the one a recording goes onto: the one being recorded on while that runs;
 * else the armed track; else the selected track when it records; else the one shown last; else the top one.
 */
export function shownTrack(tracks: readonly AudioTrack[], o: { recording?: string | null; armed?: string | null; selected?: string | null; last?: string | null }): string | null {
  const has = (id: string | null | undefined): id is string => !!id && tracks.some((t) => t.id === id);
  return has(o.recording) ? o.recording : has(o.armed) ? o.armed : has(o.selected) ? o.selected : has(o.last) ? o.last : tracks[0]?.id ?? null;
}

/** What a recording would go round, in words ("bars 1–4"). */
export function roundLabel(song: TimelineSong, session: Pick<Session, "cursor" | "loop">): string {
  const p = recordPlan5(song, session);
  return barsLabel(barMap(song), p.from, p.to);
}

/** What was recorded, said in a line (as the old page said it). */
export function recordedLine(made: readonly Take5[], r: Pick<Recorded, "rate" | "padded" | "dropped" | "note">, lead = ""): string {
  if (!made.length) return `${lead}Stopped before the first take`;
  const full = made.filter((x) => !x.short).length || made.length;
  const stars = made.filter((x) => x.keep).length;
  const filled = (r.padded ?? 0) / r.rate;
  const lost = filled > 0 ? ` · ${filled < 1 ? `${Math.round(filled * 1000)} ms` : `${filled.toFixed(1)} s`} lost and filled with silence, timing kept: try a bigger buffer` : r.dropped ? " (some audio was lost: try a bigger buffer)" : "";
  return `${lead}${full} take${full === 1 ? "" : "s"} recorded${stars ? ` · ★ ${stars}` : ""}${lost}${r.note ? ` (${r.note})` : ""}`;
}

/** Ids for what one edit makes: the same ones however often the edit is worked out. */
const idsFrom = (base: string) => {
  let n = 0;
  return () => `${base}-${++n}`;
};

/** What the record window asks of the host of the track view. The same object, always. */
export interface RecordCtl {
  /** the app's state and every way to change it, as they are this moment */
  app(): Ctx5;
  /** what the song is flattened with (the guitar's shapes, the takes that are loaded) */
  ctx(): FlattenCtx;
  /** the song stops (a recording starts, a take is about to be heard alone) */
  stopSong(): void;
  /** a recording or a rehearsal began, or ended: the song cannot be played meanwhile */
  busy(on: boolean): void;
  /** where a recording is, the pass being sung, whether the interface is open */
  report(s: { phase: RecordPhase; pass: number; open: boolean }): void;
  focus(): void;
  close(): void;
  move(r: Rect): void;
}

/** What the host of the track view does with the record window. */
export interface RecordApi {
  /** record onto this track, once the window shows it (the top bar's ●) */
  start(track: string): void;
  /** stop the recording that runs */
  toggle(): void;
  /** the recording that runs, as it grows on its lane: from the beat it goes round from to where the music is in this pass */
  growing(): { track: string; from: number; to: number } | null;
  /** how loud an input is right now, 0 to 1 */
  level(ch: number): number;
}

export interface RecordHostProps {
  /** the record window as the session has it (none: it was never opened) */
  win: WinState | undefined;
  /** it has the focus */
  focused: boolean;
  /** another window has */
  otherFocused: boolean;
  z: number;
  /** the song's tracks that record, its recorded clips and its shelf (each the same list while nothing in it changed) */
  tracks: readonly AudioTrack[];
  clips: readonly AudioClip[];
  shelf: readonly Shelved[] | undefined;
  bpm: number;
  armed: string | null;
  selected: string | null;
  /** the track a recording is going onto (the app's lock on undo and on leaving the idea) */
  recordingTo: string | null;
  /** the clips selected on the lanes (the take of one on the track shown is the one selected in the take list) */
  picked: readonly string[];
  /** what a recording would go round, in words: when it changes, the window says so */
  round: string;
  /** the song is playing in the app */
  playing: boolean;
  /** asked to show the vocal sound (FX on the track): goes up each time */
  toSound?: number;
  ctl: RecordCtl;
  api: { current: RecordApi | null };
}

const NOWHERE = () => null;
const PLACE: WinState = { id: REC_WIN, kind: "compose", track: "", x: 260, y: 360, w: 1020, h: 440, open: false };

export const RecordHost = memo(function RecordHost(p: RecordHostProps) {
  const { win, tracks, ctl } = p;
  const desktop = isDesktop();
  const open = !!win?.open;
  const [phase, setPhase] = useState<RecordPhase>("idle");
  const [recording, setRecording] = useState(false);
  const control = useRef<RecordControl | null>(null);

  // ── which track is shown ──
  const last = useRef<string | null>(null);
  const shownId = shownTrack(tracks, { recording: p.recordingTo, armed: p.armed, selected: p.selected, last: last.current });
  last.current = shownId;
  const track = tracks.find((t) => t.id === shownId) ?? null;
  const fx = useMemo<VocalFx>(() => reviveFx(track?.fx) ?? FX_DEFAULT, [track?.fx]);
  const stale = !!track && track.takes.some((k) => !sameSound(k as unknown as Parameters<typeof sameSound>[0], fx));

  const live = useRef({ p, track, shownId, fx, phase });
  live.current = { p, track, shownId, fx, phase };

  // ── a take heard alone ──
  const [alone, setAlone] = useState<string | null>(null);
  const aloneRef = useRef(alone);
  aloneRef.current = alone;
  useEffect(() => onAloneChange((on) => !on && setAlone(null)), []);

  // ── what a recording goes round, kept while nothing it reads has changed ──
  const plans = useRef(new WeakMap<RecordPlan, { p5: RecordPlan5; key: string; sig: string }>());
  const planNow = useRef<{ song: TimelineSong; from: number; to: number; ctx: FlattenCtx; plan: RecordPlan } | null>(null);
  /** the recording that runs: the track it goes onto and the beats it goes round */
  const running = useRef<{ from: number; to: number } | null>(null);

  const does = useMemo(() => {
    const app = () => ctl.app();
    const now = () => live.current;
    const withUndo = (msg: string) => {
      const after = app().peek().song;
      // (offered only while the song is as this left it: after another change, undo would take that one back)
      app().toast(msg, { label: "↶", aria: "Undo", run: () => app().undo(), when: (s) => s.song === after });
    };
    const plan = (): RecordPlan | null => {
      const s = app().peek();
      const p5 = recordPlan5(s.song, s.session);
      const fctx = ctl.ctx();
      const was = planNow.current;
      if (was && was.song === s.song && was.from === p5.from && was.to === p5.to && was.ctx === fctx) return was.plan;
      const song = s.song;
      const map = barMap(song);
      let items: PlayItem[] | null = null;
      const made: RecordPlan = {
        // (worked out when a recording starts, not each time the window is drawn: every track of the song over those
        // bars, as the loop plays them; the track being recorded is left out of the render by its id)
        get items() {
          return (items ??= flatten(song, fctx, { spans: [{ from: p5.from, to: p5.to }], loop: true }).items);
        },
        at: { block: "", bar: 0 },
        beats: p5.to - p5.from,
        beatsPerBar: Math.max(1, p5.bars[0] ?? 4),
        bpm: song.bpm,
        pattern: "ring",
        beat: null,
        label: barsLabel(map, p5.from, p5.to),
        bars: p5.bars.map((beats, i) => ({ block: "", bar: i, letter: "", beats })),
      };
      plans.current.set(made, { p5, key: `${s.key.tonic}|${s.key.scaleId}`, sig: sigName(map.sigAt(p5.from + EPS)) });
      planNow.current = { song, from: p5.from, to: p5.to, ctx: fctx, plan: made };
      return made;
    };
    const takesOn = (song: TimelineSong, id: string): Take5[] => {
      const t = song.tracks.find((x) => x.id === id);
      return isAudioTrack(t) ? t.takes : [];
    };
    return {
      plan,
      setFx: (next: VocalFx) => {
        const id = now().shownId;
        if (id) app().edit("Vocal sound", (s) => setTrack<AudioTrack>(s, id, { fx: next }), `fx:${id}`);
      },
      setInput: (ch: number) => {
        const id = now().shownId;
        if (id) app().edit("Input", (s) => setTrack<AudioTrack>(s, id, { input: { ch: Math.max(0, Math.round(ch)) } }));
      },
      onRecorded: (r: Recorded, o: { kept: number[]; sound: string; plan: RecordPlan; track: string; lead?: string }) => {
        const s = app().peek();
        const st = plans.current.get(o.plan);
        const p5 = st?.p5 ?? recordPlan5(s.song, s.session);
        const base = `r${newId()}`;
        let made: Take5[] = [];
        app().edit("Record", (song) => {
          // (the track is there: it cannot be removed while it is recorded on; if it went all the same, it comes back with its takes, never lost)
          const there = song.tracks.some((t) => t.id === o.track) ? song : addTrack(song, "vocals", o.track);
          const had = new Set(takesOn(there, o.track).map((k) => k.id));
          const out = addRecording5(there, o.track, r, p5, {
            nudge: s.studio?.nudge ?? 0, kept: o.kept, id: idsFrom(base), bpm: o.plan.bpm,
            key: st?.key ?? `${s.key.tonic}|${s.key.scaleId}`, sig: st?.sig ?? sigName(barMap(song).sigAt(p5.from + EPS)), sound: o.sound,
          });
          made = takesOn(out, o.track).filter((k) => !had.has(k.id));
          return made.length ? out : song;
        });
        app().toast(recordedLine(made, r, o.lead));
      },
      setNudge: (ms: number) => {
        const to = Number.isFinite(ms) ? ms : 0;
        // not an undo step: it is a setting. Every take in the song, on the shelf and in what was copied moves with it
        app().set((s) => {
          const was = s.studio?.nudge ?? 0;
          const copied = s.clip ? renudgeTakes5(s.clip.takes, to, was) : undefined;
          // the ideas in the library move when they are opened: a take of theirs that does not say its nudge yet is
          // noted as lying with the one in use until now, so it moves rightly then
          let noted = false;
          const saved = s.saved.map((i) => {
            if (i.backup) return i;
            const song = stampTakes5(i.song, was);
            if (song === i.song) return i;
            noted = true;
            return { ...i, song };
          });
          return { ...s, studio: { ...s.studio, nudge: to }, song: renudge5(s.song, to, was), ...(noted ? { saved } : {}), ...(s.clip && copied !== s.clip.takes ? { clip: { ...s.clip, takes: copied! } } : {}) };
        });
      },
      applySound: async () => {
        const { track: t, fx: sound } = now();
        if (!t) return;
        const drys = [...new Set(t.takes.filter((k) => !sameSound(k as unknown as Parameters<typeof sameSound>[0], sound)).map((k) => k.dry))];
        if (!drys.length) return;
        try {
          const made: Record<string, string> = {};
          for (const d of drys) made[d] = await fxRender(d, sound);
          const tag = soundTag(sound);
          const id = t.id;
          // the takes that play are read again (just them) once the song sees their new files
          app().edit("Apply sound", (s) => {
            const mine = s.tracks.find((x) => x.id === id);
            return isAudioTrack(mine) ? setTrack<AudioTrack>(s, id, { takes: mine.takes.map((x) => (made[x.dry] ? { ...x, wet: made[x.dry], sound: tag } : x)) }) : s;
          });
          app().toast("Takes updated");
        } catch (e) {
          app().toast(String(e));
        }
      },
      hear: async (k: Take5) => {
        // (not over a song the interface is playing)
        if (now().phase !== "idle") return;
        if (aloneRef.current === k.id && hearingAlone()) return stopAlone();
        ctl.stopSong();
        // just this take is read from the recording; the interface's own engine closes first, so the two never play through it at once
        const ok = await hearAlone({ wet: k.wet, start: k.start, frames: k.frames, rate: k.rate }, now().shownId ?? "vocals", undefined, freeInterface);
        if (ok) setAlone(k.id);
        else if (ok === false) app().toast("Could not read the recording");
      },
      use: (k: Take5) => {
        const id = now().shownId;
        const base = `u${newId()}`;
        if (id) app().edit("Use take", (s) => useTake5(s, id, k.id, app().peek().session.cursor, idsFrom(base)));
      },
      keep: (k: Take5, keep: boolean) => {
        const id = now().shownId;
        if (id) app().edit(keep ? "Keep take" : "Let take go", (s) => keepTake5(s, id, k.id, keep));
      },
      drop: (k: Take5) => {
        const id = now().shownId;
        if (!id) return;
        const before = app().peek().song;
        app().edit("Delete take", (s) => dropTake5(s, id, k.id));
        if (app().peek().song !== before) withUndo(`Take ${k.n} deleted`);
      },
      remove: (group: string) => {
        const id = now().shownId;
        if (!id) return;
        const before = app().peek().song;
        app().edit("Remove recording", (s) => removeRecording5(s, id, group));
        if (app().peek().song !== before) withUndo("Recording removed");
      },
      shelfUse: (k: Take5) => {
        const id = now().shownId;
        const base = `u${newId()}`;
        if (id) app().edit("Use removed recording", (s) => useShelved5(s, id, k.id, app().peek().session.cursor, idsFrom(base)));
      },
      empty: () => {
        const before = app().peek().song;
        app().edit("Empty removed recordings", emptyShelf5);
        if (app().peek().song !== before) withUndo("Removed recordings emptied");
      },
      report: (s: { phase: RecordPhase; pass: number; open: boolean }) => {
        setPhase(s.phase);
        if (s.phase === "idle") running.current = null;
        else if (!running.current && planNow.current) running.current = { from: planNow.current.from, to: planNow.current.to };
        ctl.report(s);
      },
      onRecording: (on: boolean) => {
        setRecording(on);
        ctl.busy(on);
        if (on) ctl.stopSong();
      },
    };
  }, [ctl]);

  // ── what the host of the track view does with the window ──
  const pending = useRef<{ track: string; at: number } | null>(null);
  const [, setTick] = useState(0);
  p.api.current = useMemo<RecordApi>(() => ({
    start(id) {
      pending.current = { track: id, at: performance.now() };
      setTick((n) => n + 1);
    },
    toggle: () => control.current?.toggle(),
    growing() {
      const to = ctl.app().recordingTo;
      if (!to) return null;
      const r = running.current;
      if (!r) return { track: to, from: 0, to: 0 };
      const at = control.current?.at();
      return { track: to, from: r.from, to: r.from + (at ? at.frac * (r.to - r.from) : 0) };
    },
    level: (ch) => control.current?.level(ch) ?? 0,
  }), [ctl]);
  // the top bar's ●: recording starts once the window is open on the track asked for
  useEffect(() => {
    const want = pending.current;
    if (!want) return;
    if (performance.now() - want.at > 3000 || !tracks.some((t) => t.id === want.track)) pending.current = null;
    else if (open && shownId === want.track && control.current) {
      pending.current = null;
      control.current.toggle();
    }
  });
  // opened, or shown on another track: from the top (the take list is the first thing there)
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && body.current) body.current.scrollTop = 0;
  }, [open, shownId]);
  // FX on the track: the vocal sound is brought into view
  useEffect(() => {
    if (!p.toSound || !open) return;
    document.querySelector<HTMLElement>(`.tlw[data-win="${REC_WIN}"] .vc-grid > .vc-box:last-child`)?.scrollIntoView({ block: "start" });
  }, [p.toSound]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = track ? [...p.picked].reverse().map((id) => p.clips.find((c) => c.id === id && c.track === track.id)).find((c) => !!c)?.take ?? null : null;
  const takes = track ? (
    <TakeList5 key={track.id} track={track} clips={p.clips} shelf={p.shelf} alone={alone} canHear={desktop} running={phase !== "idle"} pick={pick}
      onHear={(k) => void does.hear(k)} onKeep={does.keep} onUse={does.use} onDrop={does.drop} onRemove={does.remove} onShelfUse={does.shelfUse} onEmpty={does.empty} />
  ) : null;
  const input = track?.input?.ch ?? 0;
  // K keeps a pass while the record window has the keys; while a recording runs, also from the timeline (wherever no other window has them)
  const keys = p.focused || (recording && !p.otherFocused);
  const host = useMemo<VocalHost>(() => ({
    track: track ? { id: track.id, name: track.name, input, fx, stale } : null,
    setFx: does.setFx, setInput: does.setInput,
    bpm: p.bpm,
    plan: does.plan,
    onRecorded: does.onRecorded,
    setNudge: does.setNudge,
    applySound: does.applySound,
    takes,
    control,
    focused: keys,
    report: does.report,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [track?.id, track?.name, input, fx, stale, p.bpm, does, takes, keys, p.round]);

  // (in a browser there is no interface to keep: the page is only there while its window is open)
  if (!desktop && !open) return null;
  return (
    <V4View>
      <div className="rec-dock" hidden={!open}>
        <Window win={win ?? PLACE} title={track ? `${track.name} · record` : "Record"} focused={p.focused} z={p.z} onFocus={ctl.focus} onClose={ctl.close} onMove={ctl.move}>
          <div className="lc-scroll rec-body" ref={body}>
            <VocalsPage host={host} active={open} recordPlan={does.plan} onRecording={does.onRecording} recording={recording} playing={p.playing} getWhere={NOWHERE} onAlone={ctl.stopSong} />
          </div>
        </Window>
      </div>
    </V4View>
  );
});
