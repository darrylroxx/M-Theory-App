// The one record window of the track view: a plugin window with the record window's own parts inside it
// (RecordWindow: Record and Rehearse, the passes, the monitor; TakeBrowser: the takes). It owns nothing of the
// recording engine: the host of the track view runs that (ui/audio/useEngine), so closing this window stops nothing,
// and it is there only once it has been opened.
//
// Also here, as plain functions for the host: which track the window shows, what a recording goes round, and what
// is done to the song when the engine hands a recording over (it is cut into takes and laid on its lane, one step of
// the one undo) or when the timing nudge is changed (every take moves).
import { memo, useEffect, useRef } from "react";
import type { PlayItem } from "../../../audio/patterns";
import { canLoad } from "../../../audio/takebuffers";
import { stopAlone } from "../../../audio/takeplay";
import { isDesktop } from "../../../desktop";
import { sigName } from "../../../song/meter";
import type { Recorded } from "../../../song/takes";
import { renudge5, renudgeTakes5, stampTakes5 } from "../../../timeline/audioclips";
import { barMap } from "../../../timeline/bars";
import { addTrack, setTrack } from "../../../timeline/edit";
import { flatten, type FlattenCtx } from "../../../timeline/flatten";
import type { AudioClip, AudioTrack, InputRef, Session, Shelved, Take5, TimelineSong, WinState } from "../../../timeline/model";
import { addRecording5, backingKey, recordPlan5, type RecordPlan5 } from "../../../timeline/record";
import type { Ctx5 } from "../../app5";
import type { EngineApi, RecordPlan } from "../../audio/useEngine";
import { KindIcon } from "../../icons";
import { newId, type Studio } from "../../state";
import { barsLabel } from "../../timeline/gestures";
import { Window } from "../../windows/Window";
import { firstPlace } from "../../windows/windows";
import { RecordWindow } from "./RecordWindow";
import { TakeBrowser, idsFrom } from "./TakeBrowser";
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

/** What a recording would go round, in words ("bars 1–4"); with the loop off, where the song is played from, once ("from bar 5"). */
export function roundLabel(song: TimelineSong, session: Pick<Session, "cursor" | "loop">): string {
  const p = recordPlan5(song, session);
  const map = barMap(song);
  return p.loop ? barsLabel(map, p.from, p.to) : `from bar ${map.barAt(p.from + EPS).bar + 1}`;
}

/** a number for each thing that can only be told apart by being the same one (a function, a decoded take) */
const marks = new WeakMap<object, number>();
let marked = 0;
const markOf = (o: object | undefined): number => {
  if (!o) return 0;
  let n = marks.get(o);
  if (!n) marks.set(o, (n = ++marked));
  return n;
};

/**
 * What the song is flattened with, as far as it is heard under a recording, as a text: the guitar's shapes (they are
 * the same while the function that gives them is), the tracks heard without their effects, and for every recorded
 * clip of another track whether its sound is loaded (one that is not yet is not in the render).
 */
function heardWith(song: TimelineSong, fctx: FlattenCtx, skip: string | null): string {
  const takes: number[] = [];
  for (const t of song.tracks) {
    if (!isAudioTrack(t) || t.id === skip) continue;
    const dry = !!fctx.bypass?.has(t.id);
    for (const c of song.clips) {
      if (c.kind !== "audio" || c.track !== t.id) continue;
      const k = t.takes.find((x) => x.id === c.take);
      takes.push(markOf(k ? fctx.buffer(k, dry) : undefined));
    }
  }
  return `${markOf(fctx.voicingsOf)}|${[...(fctx.bypass ?? [])].filter((id) => id !== skip).sort().join(",")}|${takes.join(",")}`;
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

/** What the song's side of a recording needs of the host. The same object, always. */
export interface RecordSongCtl {
  /** the app's state and every way to change it, as they are this moment */
  app(): Ctx5;
  /** what the song is flattened with (the guitar's shapes, the takes that are loaded) */
  ctx(): FlattenCtx;
}

/**
 * The song's side of a recording, for the engine: what it goes round (`plan`), where that lies on the timeline
 * (`spanOf`, for the clip that grows on the lane), the finished recording cut into takes and laid on its track
 * (`onRecorded`), and the timing nudge (`setNudge`). Made once by the host.
 */
export function recordSong(ctl: RecordSongCtl) {
  const app = () => ctl.app();
  // what a recording goes round, kept while nothing it reads has changed
  const plans = new WeakMap<RecordPlan, { p5: RecordPlan5; key: string; sig: string }>();
  let planNow: { song: TimelineSong; key: unknown; from: number; to: number; loop: boolean; ctx: FlattenCtx; plan: RecordPlan } | null = null;
  const takesOn = (song: TimelineSong, id: string): Take5[] => {
    const t = song.tracks.find((x) => x.id === id);
    return isAudioTrack(t) ? t.takes : [];
  };
  return {
    plan(): RecordPlan | null {
      const s = app().peek();
      const p5 = recordPlan5(s.song, s.session);
      const fctx = ctl.ctx();
      const was = planNow;
      if (was && was.song === s.song && was.key === s.key && was.from === p5.from && was.to === p5.to && was.loop === p5.loop && was.ctx === fctx) return was.plan;
      const song = s.song;
      const map = barMap(song);
      let items: PlayItem[] | null = null;
      const key = `${s.key.tonic}|${s.key.scaleId}`;
      const made: RecordPlan = {
        // (worked out when a recording starts, not each time it is asked for: every track of the song over those
        // bars, as the loop plays them; the track being recorded is left out of the render by its id)
        get items() {
          return (items ??= flatten(song, fctx, { spans: [{ from: p5.from, to: p5.to }], loop: p5.loop }).items);
        },
        beats: p5.to - p5.from,
        beatsPerBar: Math.max(1, p5.bars[0] ?? 4),
        bpm: song.bpm,
        pattern: "ring",
        beat: null,
        label: barsLabel(map, p5.from, p5.to),
        bars: p5.bars.map((beats) => ({ beats })),
        // with the loop off the song is played once, from the cursor's bar, and the recording goes on until Stop
        ...(p5.loop ? {} : { once: true }),
        // (a synth's drone holds the key's home note, so the key is in what is heard too)
        backing: (skip) => `${backingKey(song, skip, p5)}|${key}|${heardWith(song, fctx, skip)}`,
      };
      plans.set(made, { p5, key, sig: sigName(map.sigAt(p5.from + EPS)) });
      planNow = { song, key: s.key, from: p5.from, to: p5.to, loop: p5.loop, ctx: fctx, plan: made };
      return made;
    },
    /** the beats a plan goes round (null: not one of these plans) */
    spanOf(plan: RecordPlan): { from: number; to: number } | null {
      const st = plans.get(plan);
      return st ? { from: st.p5.from, to: st.p5.to } : null;
    },
    onRecorded(r: Recorded, o: { kept: number[]; sound: string; plan: RecordPlan; track: string; lead?: string }): void {
      const s = app().peek();
      const st = plans.get(o.plan);
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
    /** The timing nudge: every take in the song, on the shelf and in what was copied moves with it, and every recording after it is cut with it. */
    setNudge(ms: number): void {
      const to = Number.isFinite(ms) ? ms : 0;
      // not an undo step: it is a setting
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
  };
}
export type RecordSong = ReturnType<typeof recordSong>;

/** What the record window asks of the host of the track view. The same object, always. */
export interface RecordCtl {
  /** the app's state and every way to change it, as they are this moment */
  app(): Ctx5;
  /** the song stops (a take is about to be heard alone) */
  stopSong(): void;
  /** the Audio part of the settings */
  setup(): void;
  focus(): void;
  close(): void;
  move(r: Rect): void;
}

export interface RecordHostProps {
  /** the record window as the session has it (none: it was never opened) */
  win: WinState | undefined;
  /** it has the focus */
  focused: boolean;
  z: number;
  /** the track it shows: the one a recording goes onto (null: the song has no track that records) */
  track: AudioTrack | null;
  /** the song's recorded clips and its shelf (each the same list while nothing in it changed) */
  clips: readonly AudioClip[];
  shelf: readonly Shelved[] | undefined;
  /** how many inputs a track's input is chosen from */
  inputs: number;
  /** with the loop off: the song is played once, from the cursor's bar */
  once: boolean;
  /** the clips selected on the lanes (the take of one on the track shown is the one selected in the take list) */
  picked: readonly string[];
  /** what a recording would go round, in words */
  round: string;
  engine: EngineApi;
  studio: Studio;
  /** the timing nudge changed (set in the window itself in a browser): every take moves */
  setNudge(ms: number): void;
  ctl: RecordCtl;
}

const PLACE: WinState = { id: REC_WIN, kind: "compose", track: "", x: 260, y: 360, w: 1020, h: 440, open: false };

export const RecordHost = memo(function RecordHost(p: RecordHostProps) {
  const { win, track, engine, ctl } = p;
  const desktop = isDesktop();
  const open = !!win?.open;
  /** it has been open since the app started: from then on it is only hidden when closed, with everything in it as it was left */
  const seen = useRef(false);
  if (open) seen.current = true;
  // opened, or shown on another track: from the top (Record is the first thing there)
  const body = useRef<HTMLDivElement>(null);
  const shownId = track?.id ?? null;
  useEffect(() => {
    if (open && body.current) body.current.scrollTop = 0;
  }, [open, shownId]);
  // a take heard alone stops when the window is closed
  useEffect(() => {
    if (!open && seen.current) stopAlone();
  }, [open]);

  if (!seen.current || (!desktop && !open)) return null;
  const setStudio = (patch: Partial<Studio>) => ctl.app().set((s) => ({ ...s, studio: { ...s.studio, ...patch } }));
  const setInput = (input: InputRef) => {
    if (shownId) ctl.app().edit("Input", (s) => setTrack<AudioTrack>(s, shownId, { input: { ch: Math.max(0, Math.round(input.ch)), ...(input.pair ? { pair: true as const } : {}) } }));
  };
  return (
    <div className="rec-dock" hidden={!open}>
      <Window win={win ?? PLACE} title={track ? `${track.name} · record` : "Record"} icon={track ? <KindIcon kind={track.kind} /> : undefined} focused={p.focused} z={p.z} onFocus={ctl.focus} onClose={ctl.close} onMove={ctl.move}
        tools={desktop ? <button className="chip rw-setup" title="The interface, its buffer, every input's meter" onClick={ctl.setup}>Audio setup…</button> : undefined}>
        <div className="lc-scroll rec-body" ref={body}>
          <RecordWindow track={track ? { id: track.id, name: track.name, input: track.input?.ch ?? 0, ...(track.input?.pair ? { pair: true } : {}) } : null} inputs={p.inputs} engine={engine} studio={p.studio} setStudio={setStudio} round={p.round} once={p.once} open={open} onInput={setInput} onNudge={p.setNudge} onSetup={ctl.setup}>
            {track && (
              <TakeBrowser track={track} clips={p.clips} shelf={p.shelf} picked={p.picked} canHear={desktop || track.takes.some((k) => canLoad(k))} running={engine.phase !== "idle"} app={ctl.app} stopSong={ctl.stopSong} />
            )}
          </RecordWindow>
        </div>
      </Window>
    </div>
  );
});
