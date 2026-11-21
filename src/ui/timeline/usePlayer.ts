// What plays a song of tracks and clips: the host of the unchanged player. The track view itself never plays
// anything; it is given what this returns.
//
// The song is flattened into the list the player takes (see timeline/flatten). With no loop the music runs from the
// cursor to the song's end; with the loop on it goes round the loop's stretches, from the cursor when that is inside
// one. While it plays, every change of the song is taken in at once: by `update` when the new list has the old one's
// shape, else by `relist`, carried on from the very beat the old list would have played next, so the music goes on
// with no gap and no jump.
//
// Once for the whole app it also does what each old page did for itself: recorded takes are read from disk and kept,
// the tempo and the mixer are told to the engine, the song's voices are made ready ahead, its notes prepared.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setMix, type Mix } from "../../audio/mix";
import { freeInterface } from "../../audio/handoff";
import type { PlayItem } from "../../audio/patterns";
import { ProgressionPlayer, getAudio, keepSlots, prepFor, prepareNotes, readySlots, setTempo, slotsOf } from "../../audio/synth";
import { keepTakes as keepBuffers, loadTake, takeBuffer, takeKey, type TakeRef } from "../../audio/takebuffers";
import { stopAlone } from "../../audio/takeplay";
import { onKeys } from "../../audio/tone";
import { isDesktop } from "../../desktop";
import { songEnd } from "../../timeline/edit";
import { flatten, songBeat, type Flat, type FlattenCtx, type Range } from "../../timeline/flatten";
import type { Region, Session, Take5, TimelineSong } from "../../timeline/model";
import { lastOnly } from "../latest";
import type { PlayerApi } from "./api";

export type { PlayerApi } from "./api";

const EPS = 1e-6;

/** May `update` be used? Only when the two lists agree item by item: how many, how long each is, where in its stretch each starts, and on which beat of the song each item and its stretch start. */
export function sameShape(a: Flat, b: Flat): boolean {
  if (a.loop !== b.loop || a.items.length !== b.items.length) return false;
  for (let i = 0; i < a.items.length; i++) {
    const x = a.items[i];
    const y = b.items[i];
    if (Math.abs(x.beats - y.beats) > EPS || Math.abs(a.at[i] - b.at[i]) > EPS || Math.abs(a.origin[i] - b.origin[i]) > EPS) return false;
    if ((x.from === undefined) !== (y.from === undefined) || Math.abs((x.from ?? 0) - (y.from ?? 0)) > EPS || !!x.jump !== !!y.jump) return false;
  }
  return true;
}

/**
 * The index to hand to `relist`: where the music goes on in the new list, given the item the old one would have
 * played next. That is the item that starts on the same beat of the song. When the old list was about to end or go
 * round (`next` is its length): the loop's first item when looping (`regions`), the new list's end when not (the
 * song then ends, as it was about to). When that beat is in none of the new stretches: the first item after it in
 * song order, else the first of all; with no loop, the end.
 */
export function resumeAt(old: Flat, next: number, neu: Flat, regions: Region[] | null): number {
  const b = old.at[next];
  if (b === undefined) return regions ? 0 : neu.items.length;
  for (let i = 0; i < neu.at.length; i++) if (Math.abs(neu.at[i] - b) < EPS) return i;
  for (let i = 0; i < neu.at.length; i++) if (neu.at[i] > b) return i;
  return regions ? 0 : neu.items.length;
}

/** What is playing: from which beat it was started, a beat on which an item is kept starting (so the list keeps its shape), and the stretch being heard round and round on its own, if one is. */
export interface PlayMode { from: number; cut?: number; audition: Region | null; started?: boolean }

/** The loop's stretches when the loop is on (null: the music runs straight through). */
export const loopOf = (session: Pick<Session, "loop">): Region[] | null => (session.loop?.on && session.loop.regions.length ? session.loop.regions : null);

/** The part of the song a mode plays, as `flatten` takes it. */
export function rangeFor(m: PlayMode, session: Pick<Session, "loop">, end: number): Range {
  const cut = m.cut !== undefined ? { cut: m.cut } : {};
  if (m.audition) return { spans: [m.audition], loop: true, ...cut };
  const regions = loopOf(session);
  if (regions) return { spans: regions, loop: true, ...cut };
  return { spans: [{ from: m.from, to: end }], loop: false, ...cut };
}

/**
 * How a start at `at` plays: with the loop on (or a stretch heard on its own) and the beat inside one of the
 * stretches, the list is cut there and the music starts at that item; at or outside their edges, from the stretch
 * that starts there, else the first. With no loop, from the beat (from the first beat when it is at the song's end).
 */
export function startFor(at: number, regions: Region[] | null, audition: Region | null, end: number): PlayMode {
  const round = audition ? [audition] : regions;
  if (round) return round.some((r) => at > r.from + EPS && at < r.to - EPS) ? { from: at, cut: at, audition } : { from: at, audition };
  return { from: at >= end - EPS ? 0 : Math.max(0, at), audition: null };
}
/** The item a start at `at` begins with. */
export function startIndex(flat: Flat, m: PlayMode): number {
  if (!flat.loop) return 0;
  const i = flat.at.findIndex((b) => Math.abs(b - m.from) < EPS);
  return i > 0 ? i : 0;
}

/**
 * A change of the song (or of the loop) while it plays, worked out against the list that is playing: the list to go
 * on with, the mode from now on, and whether it has the old one's shape (then `update` takes it; otherwise `relist`,
 * at `index(next)`).
 */
export function carryOn(old: Flat, m: PlayMode, heard: TimelineSong, session: Pick<Session, "loop">, ctx: FlattenCtx): { same: true; flat: Flat } | { same: false; first: Flat; land(next: number): { flat: Flat; mode: PlayMode; index: number } } {
  const end = songEnd(heard);
  const range = rangeFor(m, session, end);
  const first = flatten(heard, ctx, range);
  if (sameShape(old, first)) return { same: true, flat: first };
  const regions = range.loop ? range.spans : null;
  return {
    same: false,
    first,
    land(next) {
      const b = old.at[next];
      // the old list was about to end or go round: the new one as it is, from its loop's first item (or its end)
      if (b === undefined) return { flat: first, mode: m, index: resumeAt(old, next, first, regions) };
      // an item of the new list is made to start on the beat the old one would have played next
      const inside = regions ? regions.some((r) => b > r.from + EPS && b < r.to - EPS) : b < end - EPS;
      const mode: PlayMode = { ...m, from: regions ? m.from : Math.min(m.from, b), ...(inside ? { cut: b } : {}) };
      if (!inside) delete mode.cut;
      const flat = flatten(heard, ctx, rangeFor(mode, session, end));
      return { flat, mode, index: resumeAt(old, next, flat, regions) };
    },
  };
}

// ── recorded takes ──────────────────────────────────────────

const refOf = (take: Take5, dry?: boolean): TakeRef => ({ wet: dry ? take.dry : take.wet, start: take.start, frames: take.frames });

/**
 * The song's recorded takes, read from disk once (in the desktop app, where the recordings are) and kept while the
 * song plays them. Returns the way `flatten` asks for a take's sound; it is a new function whenever another take has
 * arrived, so the song is flattened again with it.
 */
export function useTakes(song: TimelineSong): FlattenCtx["buffer"] {
  const played = useMemo(() => {
    const out: TakeRef[] = [];
    for (const t of song.tracks) {
      if (t.kind !== "vocals" && t.kind !== "audio") continue;
      for (const k of t.takes) if (song.clips.some((c) => c.kind === "audio" && c.track === t.id && c.take === k.id)) out.push(refOf(k));
    }
    return out;
  }, [song.tracks, song.clips]);
  const key = played.map(takeKey).join("|");
  const [ready, setReady] = useState(0);
  useEffect(() => {
    let live = true;
    keepBuffers(played);
    if (isDesktop()) for (const tk of played) if (!takeBuffer(tk)) void loadTake(tk).then((b) => live && b && setReady((n) => n + 1));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((take: Take5, dry?: boolean) => takeBuffer(refOf(take, dry)), [ready]);
}

/** The mixer with one track heard alone. */
function alone(mix: Mix | undefined, track: string): Mix {
  const out: Mix = {};
  for (const [id, m] of Object.entries(mix ?? {})) if (m) out[id] = { ...m, solo: false };
  out[track] = { ...out[track], mute: false, solo: true };
  return out;
}

// ── the player ──────────────────────────────────────────────

/** `heard` is the song as it should sound now: the stored song, or that with a candidate laid in to be heard. */
export function usePlayer(heard: TimelineSong, session: Session, ctx: FlattenCtx): PlayerApi {
  const [playing, setPlaying] = useState(false);
  /** a stretch heard round and round on its own, and the one track heard then, if only one is */
  const [audit, setAudit] = useState<{ span: Region; solo?: string } | null>(null);
  /** goes up when the mode changes with nothing else (an audition ends while the music plays on) */
  const [turn, setTurn] = useState(0);
  const player = useRef<ProgressionPlayer | null>(null);
  const live = useRef({ heard, session, ctx });
  live.current = { heard, session, ctx };
  const mode = useRef<PlayMode | null>(null);
  /** every list the player has played lately, by its count: a place it reports for an older list is read against that list */
  const lists = useRef(new Map<number, Flat>());
  /** true while ▶ waits for a piano or a synth to be ready */
  const waiting = useRef(false);
  const starts = useMemo(lastOnly, []);

  // ── the song as the engine needs to know it, also while nothing plays ──
  const whole = useMemo(() => flatten(heard, ctx), [heard, ctx]);
  const slots = useMemo(() => slotsOf(whole.items), [whole.items]);
  const trackIds = heard.tracks.map((t) => t.id).join("|");
  useEffect(() => setTempo(heard.bpm), [heard.bpm]);
  // one voice for every track, made ready ahead; a track that is removed lets go of its voice and its drum desk
  useEffect(() => keepSlots(slots, trackIds ? trackIds.split("|") : []), [slots, trackIds]);
  // every note the song will need is made ready ahead of time, once the changes have settled
  useEffect(() => {
    const t = window.setTimeout(() => prepareNotes(prepFor(whole.items, "ring", null)), 250);
    return () => window.clearTimeout(t);
  }, [whole.items]);
  // the mixer: every track's volume, mute and solo (a track heard alone for a moment is soloed only for the ear)
  const mix = heard.mix;
  const solo = audit?.solo;
  useEffect(() => setMix(solo ? alone(mix, solo) : mix), [mix, solo]);

  const stop = useCallback(() => {
    // (a start still waiting for a piano or a synth is called off)
    starts.cancel();
    waiting.current = false;
    player.current?.stop();
    // ■ stops every take, one heard alone too
    stopAlone();
    mode.current = null;
    setAudit(null);
    setPlaying(false);
  }, [starts]);

  /** Start now (the instruments are ready): from `at`, round the loop or `audition` when there is one. */
  const begin = useCallback((at: number, audition: Region | null, started = false): boolean => {
    const { heard: song, session: s, ctx: c } = live.current;
    const end = songEnd(song);
    const m: PlayMode = { ...startFor(at, loopOf(s), audition, end), ...(started ? { started } : {}) };
    const flat = flatten(song, c, rangeFor(m, s, end));
    if (!flat.items.length) return false;
    const p = (player.current ??= new ProgressionPlayer());
    p.onEnd = () => {
      mode.current = null;
      setAudit(null);
      setPlaying(false);
    };
    // (the fallback beat and tune are none: every track plays through the items themselves)
    p.start(flat.items, song.bpm, "ring", flat.loop, null, startIndex(flat, m), null);
    if (!p.playing) return false;
    lists.current.clear();
    lists.current.set(p.gen, flat);
    mode.current = m;
    setPlaying(true);
    return true;
  }, []);

  /** ▶: the tracks on a piano or the synth are made ready first (the first time, a moment), so the first chord is heard. */
  const start = useCallback((at: number, audition: Region | null, started = false) => {
    if (waiting.current) return;
    const { heard: song, ctx: c } = live.current;
    if (songEnd(song) <= 0) return;
    // a take heard alone stops: it would sound over its own copy in the song
    stopAlone();
    getAudio();
    const keys = slotsOf(flatten(song, c).items).filter((u) => u.tone && onKeys(u.tone));
    waiting.current = true;
    const mine = starts.begin();
    // (the recording engine closes first, so the interface is never played by two at once)
    void Promise.all([readySlots(keys), freeInterface()]).then(() => {
      if (!mine()) return;
      waiting.current = false;
      begin(at, audition, started);
    });
  }, [begin, starts]);

  // a change while playing: taken in at once
  useEffect(() => {
    const p = player.current;
    const m = mode.current;
    if (!p?.playing || !m) return;
    const old = lists.current.get(p.gen);
    if (!old) return;
    const r = carryOn(old, m, heard, session, ctx);
    if (r.same) {
      lists.current.set(p.gen, r.flat);
      p.update(r.flat.items, heard.bpm, "ring", r.flat.loop, null, null);
      return;
    }
    if (!r.first.items.length) return stop();
    // (the player asks where to go on only once it has the list: the list handed over is filled in when it asks)
    const items: PlayItem[] = [...r.first.items];
    let landed: Flat = r.first;
    const gen = p.relist(items, r.first.loop, (next) => {
      const to = r.land(next);
      landed = to.flat;
      mode.current = to.mode;
      items.length = 0;
      items.push(...to.flat.items);
      return to.index;
    });
    lists.current.set(gen, { ...landed, items });
    for (const g of [...lists.current.keys()]) if (g < gen - 16) lists.current.delete(g);
    p.update(items, heard.bpm, "ring", landed.loop, null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heard, session.loop, ctx, turn]);
  useEffect(() => () => player.current?.stop(), []);

  const getBeat = useCallback((): number | null => {
    const pos = player.current?.position();
    if (!pos) return null;
    const flat = lists.current.get(pos.gen);
    return flat && pos.index < flat.origin.length ? songBeat(flat, pos) : null;
  }, []);
  const toggle = useCallback(() => {
    if (player.current?.playing || waiting.current) return stop();
    start(live.current.session.cursor, null);
  }, [start, stop]);
  const seek = useCallback((beat: number) => {
    const m = mode.current;
    if (!player.current?.playing || !m || m.audition) return;
    // while looping, a cursor put outside the loop only moves: the loop plays on
    const regions = loopOf(live.current.session);
    if (regions && !regions.some((r) => beat >= r.from - EPS && beat < r.to - EPS)) return;
    begin(beat, null);
  }, [begin]);
  const audition = useCallback((span: Region | null, alone?: string) => {
    const m = mode.current;
    if (!span) {
      if (!m?.audition && !waiting.current) return setAudit(null);
      // started for the audition, the music ends with it; playing before, it goes on as it was
      if (!m || m.started) return stop();
      setAudit(null);
      mode.current = { from: m.from, audition: null };
      setTurn((n) => n + 1);
      return;
    }
    setAudit({ span, ...(alone ? { solo: alone } : {}) });
    // (heard straight away: playing already, the stretch goes round from now)
    if (player.current?.playing) begin(span.from, span, !!m?.started);
    else start(span.from, span, true);
  }, [begin, start, stop]);

  return useMemo(() => ({ playing, toggle, stop, getBeat, seek, audition }), [playing, toggle, stop, getBeat, seek, audition]);
}
