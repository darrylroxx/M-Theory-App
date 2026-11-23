// The track view: a top bar, a ruler, a panel for each track on the left and its lane of clips on the right.
// The panels and lanes share one box that scrolls up and down, so a row can never drift from its panel. Time is not
// scrolled by the browser: the view keeps which beat is at the left edge and how wide a beat is, and draws from that
// (so a long song at a close zoom costs no more than a short one, and only the clips on screen are mounted).
//
// It reads no app state and plays nothing: the song, what is selected, and every way to change them come in as props.
// A drag changes the song once, when it is let go; until then the clip's element is only moved on screen.
//
// On a phone (a narrow screen, or under a finger) the same view is laid out for a finger: narrow panels with four
// large buttons, taller rows, a top bar of two short rows with a ⋯ menu, menus as lists across the bottom. A finger
// swiped sideways over the lanes moves through the song, two fingers zoom it, a finger rested on a clip lifts it (drag:
// it moves; let go without moving: its menu), and nothing needs a second mouse button, a held key or a keyboard.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MAX_DB, MIN_DB, audible, mixWith, type TrackMix } from "../../audio/mix";
import { isDesktop } from "../../desktop";
import { sameSig, sigBeats, type TimeSig } from "../../song/meter";
import type { Key } from "../../theory/keys";
import { barMap } from "../../timeline/bars";
import {
  addTrack, blankContent, clipsIn, copyClips, cutTime, deleteClips, duplicateClips, duplicateTrack, insertTime, layDown, moveClips, moveTrack,
  removeTrack, renameTrack, resizeClip, setSig, setTrack, songEnd, splitClips,
} from "../../timeline/edit";
import { accepts, CLIP_OF, clipEnd, type Clip, type ClipKind, type InputRef, type NoteClip, type Session, type Take5, type TimelineSong, type TrackKind } from "../../timeline/model";
import { useSheet } from "../windows/windows";
import "../timeline.css";
import { ADD_KINDS, AddTrack } from "./AddTrack";
import type { PlayerApi } from "./api";
import { ClipActions, clipMenu, otherTakes, type ClipAct } from "./ClipActions";
import {
  MAX_PX, MIN_PX, ZOOM_STEP, barEvery, barRegion, beatOfX, boxHits, clipUnder, edgeTo, fitView, lengthText, moveBy, pageFor, pinchView, positionText, reach, repeatEnd, roomAt, snap,
  snapMode, xOfBeat, zoomAbout, type View,
} from "./gestures";
import { ESC_VIEW, listenKeys, onEscape, type KeyAction } from "./keys";
import { Lane, type LaneCtl } from "./Lane";
import { INPUTS_UNKNOWN, inputLines, metersOf, type InputLine } from "./inputs";
import { Menu, type MenuAt, type MenuItem } from "./Menu";
import { Ruler } from "./Ruler";
import { TopBar, type TopBarProps } from "./TopBar";
import { TrackHead, dbText, fxOn, inputText, type HeadCtl } from "./TrackHead";

export interface TrackViewProps {
  song: TimelineSong; keyOf: Key; session: Session;
  /** every change of the song: the host applies it and makes one undo step. `control`: quick changes from one control (a volume being dragged) are one step */
  edit(label: string, fn: (s: TimelineSong) => TimelineSong, control?: string): void;
  setSession(fn: (s: Session) => Session): void;
  player: PlayerApi;
  /** open a plugin window (the host decides what that is) */
  open(kind: "compose" | "sound", track: string, clip?: string): void;
  /** a take's waveform for the lane, when its audio is loaded: how loud it is along its length, 0 to 1, any number of values spread evenly over the take */
  peaks?(take: Take5, side?: number): Float32Array | undefined;
  clipboard: { copy(ids: string[]): void; paste(at: number, onto: string | null, insert: boolean): void; has: boolean };
  sound: { copy(track: string): void; paste(track: string): void; has(track: string): boolean };
  top: TopBarProps;
  /** which lanes a clip dragged out of a composer may land on, while one is being dragged */
  dropKind?: ClipKind | null;
  /** harmony clips whose source changed since they were written: each shows a dot */
  stale?: ReadonlySet<string>;
  /** the panel's ⟳: write the harmony again into this clip of this track */
  again?(track: string, clip: string): void;
  /**
   * Tracks that record: how many inputs there are to choose from, each one's level while the interface is open
   * (`meters`: there is an interface to show levels of, so the list of inputs has a small meter beside each), the
   * way to audio setup, and `listing`, told when a list of inputs opens and closes (the interface is opened for it
   * while the app is quiet, so the levels are live in the list).
   */
  inputs?: { count: number; level?(ch: number): number; meters?: boolean; setup?(): void; listing?(open: boolean): void };
  /** a recording that is running, drawn growing on its lane; read once a frame */
  recording?(): { track: string; from: number; to: number } | null;
  /** a short message from the view; with `undo` it carries an undo button (a track with clips or takes removed) */
  say?(msg: string, undo?: boolean): void;
  /** a draft as it is heard with the song (it is not on the timeline yet): drawn faintly on its lane, where it sounds */
  ghost?: NoteClip | null;
  /** the tracks heard without their effects just now, and the switch (Alt + click on a track's FX) */
  bypass?: { on: ReadonlySet<string>; toggle(track: string): void };
  /** the phone's layout or the desktop's, said outright (not given: by the screen, as the windows decide to be sheets) */
  phone?: boolean;
}

/** How tall a track's row is, how tall the + row is, and how wide the panels are. */
export const ROW_H = 64;
export const ADD_H = 44;
export const PANEL = 260;
/** The same on a phone: taller rows (a finger needs them), narrower panels (the lanes need the room). */
export const ROW_PHONE = 72;
export const ADD_PHONE = 56;
export const PANEL_PHONE = 132;
/** How wide the lanes are taken to be before the screen is measured (a 1280 window). */
const GUESS_W = 1020;
/** The row of buttons of a selected clip: how wide and how tall it is, and how far it stands clear of the clip. */
const ACTS_W = 160;
const ACTS_H = 26;
const ACTS_GAP = 2;
/** …and on a phone, where each of its buttons is large enough for a finger. */
const ACTS_W_PHONE = 240;
const ACTS_H_PHONE = 42;
/** Where a clip's box starts and ends inside its lane (as the stylesheet lays it). */
const CLIP_TOP = 6;
const CLIP_BOTTOM = 57;
/** A drag starts after this many pixels; less is a click. */
const TAP_PX = 4;
/** How long a finger rests on a clip before it is lifted (dragged from there it moves; let go where it is, its menu opens), and on an empty lane or the ruler before the menu of that place opens. */
const HOLD_MS = 400;
/** A finger has moved (it is a swipe, not a rest) after this many pixels. */
const SWIPE_PX = 8;
/** How near the left or right edge of the lanes a drag makes time scroll, and how far each step goes (pixels). */
const EDGE_PX = 24;
const EDGE_STEP = 14;
/** After the lanes were moved by hand, Follow waits this long before it turns a page. */
const FOLLOW_WAIT = 1500;

const fresh = (prefix: string): string => `${prefix}${Math.random().toString(36).slice(2, 10)}`;
/** Ids for the clips one edit makes: the same ones however often the edit is worked out. */
const idsFrom = (base: string) => {
  let n = 0;
  return () => `${base}-${++n}`;
};
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

type ClipDrag = {
  pointer: number; id: string; kind: "move" | "left" | "right"; x0: number; y0: number; beat0: number; moved: boolean;
  /** a finger on a clip that is not selected: the lanes scroll with it, and a tap selects */
  still: boolean; hold: number;
  /** a finger rested on it long enough: it is lifted, and moves with the finger from here on */
  lifted?: boolean;
  /** a finger swiped sideways from a clip that was not lifted: time scrolls (the view as it was when the swipe began) */
  pan?: number;
  el?: HTMLElement;
  ids: string[]; els: HTMLElement[]; stays: HTMLElement[]; oneTrack: boolean;
  by: number; to: string | null | undefined; copy: boolean; edge?: number;
};
type LaneDrag = { pointer: number; track: string; x0: number; y0: number; beat0: number; moved: boolean; add: boolean; /** a finger: a swipe sideways scrolls time (from this scroll), a rest opens the lane's menu */ touch?: boolean; pan?: number; hold?: number };

export function TrackView(props: TrackViewProps) {
  const { song, keyOf, session, setSession, player, top } = props;
  const map = barMap(song);
  const end = songEnd(song);

  const sheet = useSheet();
  const phone = props.phone ?? sheet;
  const panel = phone ? PANEL_PHONE : PANEL;
  const rowH = phone ? ROW_PHONE : ROW_H;

  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const over = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const rec = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const drop = useRef<HTMLDivElement>(null);

  // ── how wide the lanes are, and what of the song they show ──
  const [width, setWidth] = useState(GUESS_W);
  const [measured, setMeasured] = useState(false);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - panel;
      if (w > 0) {
        setWidth(w);
        setMeasured(true);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [panel]);
  // how far down the top bar reaches, for whatever is laid under it (a phone's sheets start there)
  useLayoutEffect(() => {
    const el = root.current?.querySelector<HTMLElement>(".tlv-top");
    if (!el || typeof ResizeObserver === "undefined") return;
    const say = () => document.documentElement.style.setProperty("--tlv-top-h", `${Math.round(el.getBoundingClientRect().bottom)}px`);
    say();
    const ro = new ResizeObserver(say);
    ro.observe(el);
    window.addEventListener("resize", say);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", say);
    };
  }, [phone]);
  const set = session.pxPerBeat > 0;
  const fitted = useMemo(() => fitView(end, width, sigBeats(song.meter)), [end, width, song.meter]);
  const ppb = set ? clamp(session.pxPerBeat, MIN_PX, MAX_PX) : fitted.pxPerBeat;
  const scroll = set ? Math.max(0, session.scroll) : 0;
  const view: View = useMemo(() => ({ pxPerBeat: ppb, scroll }), [ppb, scroll]);
  // an idea opens with the whole song across the lanes (a zoom of 0 in the session means "not chosen yet")
  useLayoutEffect(() => {
    if (measured && !set) setSession((s) => (s.pxPerBeat > 0 ? s : { ...s, ...fitted }));
  }, [measured, set, fitted, setSession]);
  const total = reach(song, view, width);

  // ── what only the view knows ──
  const [follow, setFollow] = useState(true);
  const [adding, setAdding] = useState(false);
  const [lit, setLit] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [marker, setMarker] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  /** the open menu. Its lines are a list, or (a track's list of inputs) worked out afresh each time it is drawn: the interface may only then say how many inputs it has */
  const [menu, setMenu] = useState<{ at: MenuAt; items: MenuItem[] | (() => MenuItem[]); label: string; inputs?: true } | null>(null);
  /** a clip as it is while its edge is dragged */
  const [preview, setPreview] = useState<Clip | null>(null);
  /** the kind of clip being dragged across lanes (the lanes that do not take it are dimmed) */
  const [dragKind, setDragKind] = useState<ClipKind | null>(null);
  const [busy, setBusy] = useState(false);
  /** how far down the track list is scrolled (to the nearest few pixels, and only kept while a clip is selected: its row of buttons must stay in sight) */
  const [scrolled, setScrolled] = useState(0);

  const live = useRef({ props, view, width, map, end, total, follow, marker, naming, renaming, preview, phone, panel, rowH });
  live.current = { props, view, width, map, end, total, follow, marker, naming, renaming, preview, phone, panel, rowH };
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(0);
  const auto = useRef<{ dir: number; timer: number; again?: () => void }>({ dir: 0, timer: 0 });
  const clipDrag = useRef<ClipDrag | null>(null);
  const laneDrag = useRef<LaneDrag | null>(null);
  /** the fingers on the lanes, and two of them zooming: where each began, and the view as it was then */
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ a: number; b: number; d0: number; mid0: number; view: View } | null>(null);

  // ── small helpers every handler uses (they read what is current, so they never go stale) ──
  const h = useMemo(() => {
    const L = () => live.current;
    const lanesLeft = () => over.current?.getBoundingClientRect().left ?? L().panel;
    const beatAt = (clientX: number) => beatOfX(L().view, clientX - lanesLeft());
    const rowAt = (clientY: number) => Math.floor((clientY - (rows.current?.getBoundingClientRect().top ?? 0)) / L().rowH);
    const laneAtY = (clientY: number): string | null => L().props.song.tracks[rowAt(clientY)]?.id ?? null;
    const setView = (v: View) => {
      const { props: p, width: w } = L();
      const screen = w / v.pxPerBeat;
      const most = Math.max(0, Math.max(songEnd(p.song), barMap(p.song).beatOfBar(32) - screen));
      const to = { pxPerBeat: clamp(v.pxPerBeat, MIN_PX, MAX_PX), scroll: clamp(v.scroll, 0, most) };
      p.setSession((s) => (s.pxPerBeat === to.pxPerBeat && s.scroll === to.scroll ? s : { ...s, ...to }));
    };
    /** the cursor placed; `show`: the lanes turn to it when it is off screen */
    const setCursor = (beat: number, show = false) => {
      const { props: p, view: v, width: w } = L();
      const to = Math.max(0, beat);
      p.setSession((s) => (s.cursor === to ? s : { ...s, cursor: to }));
      p.player.seek(to);
      if (show) {
        const page = pageFor(v, w, to);
        if (page !== null) setView({ ...v, scroll: page });
      }
    };
    const select = (clips: string[], track?: string | null) => {
      setMarker(null);
      L().props.setSession((s) => ({ ...s, sel: { clips, track: track === undefined ? s.sel.track : track } }));
    };
    const showTag = (e: { clientX: number; clientY: number }, text: string) => {
      const el = tag.current;
      if (!el) return;
      el.textContent = text;
      el.style.display = "block";
      el.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 16}px)`;
    };
    const hideTag = () => {
      if (tag.current) tag.current.style.display = "none";
    };
    /**
     * While something is dragged to the left or right edge of the lanes, time scrolls under it (so a clip or a loop
     * can be taken further than the screen shows). `again` works the drag out anew after each step. Called with no
     * pointer, it stops.
     */
    const edge = (clientX?: number, again?: () => void) => {
      const a = auto.current;
      const left = lanesLeft();
      const dir = clientX === undefined ? 0 : clientX < left + EDGE_PX ? -1 : clientX > left + L().width - EDGE_PX ? 1 : 0;
      a.again = again;
      if (dir === a.dir) return;
      a.dir = dir;
      window.clearInterval(a.timer);
      if (!dir) return;
      a.timer = window.setInterval(() => {
        const v = L().view;
        setView({ ...v, scroll: v.scroll + (dir * EDGE_STEP) / v.pxPerBeat });
        held.current = performance.now();
        a.again?.();
      }, 30);
    };
    return { L, lanesLeft, beatAt, rowAt, laneAtY, setView, setCursor, select, showTag, hideTag, edge };
  }, []);
  useEffect(() => () => window.clearInterval(auto.current.timer), []);

  // ── everything that changes the song or the selection ──
  const act = useMemo(() => {
    const { L } = h;
    const P = () => L().props;

    const zoomBy = (factor: number) => {
      const { view: v, width: w, props: p } = L();
      const x = xOfBeat(v, p.session.cursor);
      h.setView(zoomAbout(v, factor, x >= 0 && x <= w ? x : w / 2));
    };
    const fit = () => {
      const { end: e, width: w, props: p } = L();
      h.setView(fitView(e, w, sigBeats(p.song.meter)));
    };
    const setLoop = (loop: Session["loop"]) => P().setSession((s) => ({ ...s, loop }));
    const toggleLoop = () => {
      const { props: p, map: m } = L();
      const s = p.session;
      if (s.loop?.regions.length) return setLoop({ regions: s.loop.regions, on: !s.loop.on });
      // nothing marked yet: the selected clip's bars, else the bar under the cursor
      const c = p.song.clips.find((x) => s.sel.clips.includes(x.id));
      const r = c ? { from: m.floorBar(c.start), to: barRegion(m, Math.max(c.start, clipEnd(c, p.song) - 1e-6)).to } : barRegion(m, s.cursor);
      setLoop({ regions: [r], on: true });
    };

    const mute = (ids: string[]) => {
      if (!ids.length) return;
      const pick = new Set(ids);
      const all = P().song.clips.filter((c) => pick.has(c.id)).every((c) => c.mute);
      P().edit(all ? "Unmute clip" : "Mute clip", (s) => ({
        ...s,
        clips: s.clips.map((c) => {
          if (!pick.has(c.id) || !!c.mute === !all) return c;
          const { mute: _, ...rest } = c;
          return (all ? rest : { ...c, mute: true }) as Clip;
        }),
      }));
    };
    const split = (ids: string[], at: number) => {
      if (!ids.length) return;
      const base = fresh("c");
      P().edit("Split clip", (s) => splitClips(s, ids, at, idsFrom(base)));
    };
    /** S: the clip under the pointer, at the pointer; else the selected clips at the cursor; else the clip under the cursor on the selected track */
    const splitKey = () => {
      const { props: p } = L();
      const at = pointer.current;
      const el = at && typeof document !== "undefined" ? document.elementFromPoint(at.x, at.y)?.closest<HTMLElement>("[data-clip]") : null;
      if (at && el && root.current?.contains(el)) return split([el.dataset.clip!], h.beatAt(at.x));
      const s = p.session;
      if (s.sel.clips.length) return split(s.sel.clips, s.cursor);
      const under = s.sel.track ? clipUnder(p.song, s.sel.track, s.cursor) : undefined;
      if (under) split([under.id], s.cursor);
    };
    const remove = (ids: string[]) => {
      if (!ids.length) return;
      P().edit(ids.length > 1 ? "Delete clips" : "Delete clip", (s) => deleteClips(s, ids));
      P().setSession((s) => ({ ...s, sel: { ...s.sel, clips: s.sel.clips.filter((x) => !ids.includes(x)) } }));
    };
    const removeMarker = (id: string) => {
      P().edit("Delete marker", (s) => ({ ...s, markers: (s.markers ?? []).filter((m) => m.id !== id) }));
      setMarker(null);
    };
    const duplicate = (ids: string[]) => {
      if (!ids.length) return;
      const base = fresh("c");
      const after = duplicateClips(P().song, ids, idsFrom(base));
      if (after === P().song) return;
      P().edit(ids.length > 1 ? "Duplicate clips" : "Duplicate clip", (s) => duplicateClips(s, ids, idsFrom(base)));
      h.select(ids.map((_, i) => `${base}-${i + 1}`));
    };
    const openClip = (id: string) => {
      const c = P().song.clips.find((x) => x.id === id);
      if (c) P().open("compose", c.track, c.id);
    };
    /** one of the six things a clip's buttons and menu do. `at`: where a split from the menu cuts */
    const clipAct = (a: ClipAct, id: string, at?: number) => {
      const s = P().session;
      const ids = s.sel.clips.includes(id) ? s.sel.clips : [id];
      if (a === "open") openClip(id);
      else if (a === "mute") mute(ids);
      else if (a === "duplicate") duplicate(ids);
      else if (a === "copy") P().clipboard.copy(ids);
      else if (a === "delete") remove(ids);
      else if (at !== undefined) split([id], at);
      else {
        // the button: at the cursor, when that is inside the clip
        const inside = P().song.clips.filter((c) => ids.includes(c.id) && c.start < s.cursor && clipEnd(c, P().song) > s.cursor);
        if (inside.length) split(inside.map((c) => c.id), s.cursor);
        else P().say?.("Put the cursor inside the clip, where it should be cut");
      }
    };

    const addMarker = (beat: number) => {
      const id = fresh("mk");
      P().edit("Add marker", (s) => {
        const n = (s.markers?.length ?? 0) + 1;
        return { ...s, markers: [...(s.markers ?? []), { id, beat, name: `Marker ${n}` }].sort((a, b) => a.beat - b.beat) };
      });
      setMarker(id);
      setNaming(id);
    };
    const insert = (at: number, looped: boolean) => {
      const { props: p, map: m } = L();
      const regions = p.session.loop?.regions ?? [];
      const beats = looped && regions.length ? regions.reduce((a, r) => a + (r.to - r.from), 0) : sigBeats(m.sigAt(at));
      p.edit(looped ? "Insert time" : "Insert bar", (s) => insertTime(s, at, beats));
    };
    const cutLoop = () => {
      const regions = P().session.loop?.regions ?? [];
      if (!regions.length) return;
      // from the last stretch to the first, so the earlier ones are still where they were
      P().edit("Remove time", (s) => [...regions].reverse().reduce((x, r) => cutTime(x, r.from, r.to), s));
      setLoop(null);
    };
    const flag = (bar: number, sig: TimeSig | null) => {
      const { props: p, map: m } = L();
      // (taking a change away: the bars from there on get the signature of the bars before them)
      const to = sig ?? m.sigAt(m.beatOfBar(Math.max(0, bar - 1)));
      if (!sameSig(to, m.sigAt(m.beatOfBar(bar)))) p.edit("Time signature", (s) => setSig(s, bar, to, false));
    };

    const add = (kind: TrackKind) => {
      const id = fresh("t");
      P().edit("Add track", (s) => addTrack(s, kind, id));
      h.select([], id);
      setAdding(false);
      setLit(id);
    };
    /** on a phone the six kinds are a menu (the row under the tracks has no room for them) */
    const addMenu = (at: MenuAt) => setMenu({ at, label: "Add a track", items: [{ title: "Add a track" }, ...ADD_KINDS.map((k): MenuItem => ({ label: k.name, run: () => add(k.kind) }))] });
    /** ⟳: write the harmony again into the clip that is selected on the track, or the one under the cursor */
    const againOf = (id: string) => {
      const { song: s, session: se, again } = P();
      const mine = s.clips.filter((c) => c.track === id);
      const c = mine.find((x) => se.sel.clips.includes(x.id)) ?? mine.find((x) => x.start <= se.cursor && clipEnd(x, s) > se.cursor);
      if (c) again?.(id, c.id);
      else P().say?.("Select the clip to write again");
    };
    const removeTrackOf = (id: string) => {
      const { props: p } = L();
      const t = p.song.tracks.find((x) => x.id === id);
      if (!t) return;
      if (p.recording?.()?.track === id) return p.say?.("Stop recording first");
      const full = p.song.clips.some((c) => c.track === id) || ("takes" in t && t.takes.length > 0);
      p.edit("Remove track", (s) => removeTrack(s, id));
      p.setSession((s) => ({ ...s, armed: s.armed === id ? null : s.armed, sel: { clips: s.sel.clips.filter((c) => p.song.clips.find((x) => x.id === c)?.track !== id), track: s.sel.track === id ? null : s.sel.track } }));
      if (full) p.say?.(`${t.name} removed`, true);
    };
    const trackMenu = (at: MenuAt, id: string) => {
      const { props: p } = L();
      const t = p.song.tracks.find((x) => x.id === id);
      if (!t) return;
      if (L().phone) {
        // a phone's panel has room for the name, compose, M and S: everything else a panel holds is here
        const at0 = at;
        const i = p.song.tracks.findIndex((x) => x.id === id);
        const db = p.song.mix?.[id]?.db ?? 0;
        const items: MenuItem[] = [
          { title: t.name },
          { label: fxOn(t) ? "Sound and effects (some are on)" : "Sound and effects", run: () => p.open("sound", id) },
          ...(p.bypass ? [{ label: "Hear it without its effects", on: p.bypass.on.has(id), run: () => p.bypass?.toggle(id) }] : []),
          { range: { label: "Volume", min: MIN_DB, max: MAX_DB, step: 0.5, value: db, reset: 0, text: (v) => `${dbText(v)} dB`, set: (v) => P().edit("Volume", (s) => ({ ...s, mix: mixWith(s.mix, id, { db: v }) }), `mix:${id}:db`) } },
        ];
        if ("takes" in t)
          items.push(
            { sep: true },
            { label: "Record on this track", on: p.session.armed === id, run: () => p.setSession((s) => ({ ...s, armed: s.armed === id ? null : id })) },
            { label: `Input: ${inputText(t.input)}…`, run: () => inputMenu(at0, id) },
          );
        if ("role" in t && t.role === "harmony" && p.again) items.push({ label: "Write this harmony again", run: () => againOf(id) });
        items.push(
          { sep: true },
          { label: "Rename", run: () => setRenaming(id) },
          { label: "Move up", disabled: i <= 0, run: () => p.edit("Move track", (s) => moveTrack(s, id, i - 1)) },
          { label: "Move down", disabled: i >= p.song.tracks.length - 1, run: () => p.edit("Move track", (s) => moveTrack(s, id, i + 1)) },
          { label: "Duplicate track", run: () => p.edit("Duplicate track", (s) => duplicateTrack(s, id, fresh("t"))) },
          { sep: true },
          { label: "Copy sound", run: () => p.sound.copy(id) },
          { label: "Paste sound", disabled: !p.sound.has(id), run: () => p.sound.paste(id) },
          { sep: true },
          { title: "Colour" },
          { colours: true, now: t.color, pick: (n) => p.edit("Track colour", (s) => setTrack(s, id, { color: n })) },
          { sep: true },
          { label: "Remove track", danger: true, run: () => removeTrackOf(id) },
        );
        return setMenu({ at, label: `${t.name} track`, items });
      }
      setMenu({ at, label: `${t.name} track`, items: [
        { label: "Remove track", danger: true, run: () => removeTrackOf(id) },
        { label: "Duplicate track", run: () => p.edit("Duplicate track", (s) => duplicateTrack(s, id, fresh("t"))) },
        { sep: true },
        { label: "Copy sound", run: () => p.sound.copy(id) },
        { label: "Paste sound", disabled: !p.sound.has(id), run: () => p.sound.paste(id) },
        { sep: true },
        { title: "Colour" },
        { colours: true, now: t.color, pick: (n) => p.edit("Track colour", (s) => setTrack(s, id, { color: n })) },
      ] });
    };
    const inputMenu = (at: MenuAt, id: string) => {
      const { props: p } = L();
      const t = p.song.tracks.find((x) => x.id === id);
      if (!t || !("takes" in t)) return;
      // (what is being recorded stays what it is until the recording is stopped)
      if (p.recording?.()?.track === id) return p.say?.("Stop recording first");
      const items = (): MenuItem[] => {
        const { props: q } = L();
        const now = q.song.tracks.find((x) => x.id === id);
        if (!now || !("takes" in now)) return [];
        const pick = (input: InputRef) => q.edit("Input", (s) => setTrack(s, id, { input }));
        const meters = !!q.inputs?.meters;
        const level = (ch: number) => () => L().props.inputs?.level?.(ch) ?? 0;
        // every input of the interface, and every pair of neighbours; the track's own choice is always there, marked
        // when the interface turns out not to have it
        const lines = inputLines(q.inputs?.count ?? INPUTS_UNKNOWN, now.input);
        const row = (l: InputLine): MenuItem => ({ label: l.missing ? `${l.label} (not there)` : l.label, on: l.on, run: () => pick(l.input), ...(meters && !l.missing ? { levels: metersOf(l.input).map(level) } : {}) });
        const out: MenuItem[] = [{ title: "Records from" }, ...lines.singles.map(row)];
        if (lines.pairs.length) out.push({ title: "Stereo pairs" }, ...lines.pairs.map(row));
        const setup = q.inputs?.setup;
        if (setup) out.push({ sep: true }, { label: "Audio setup…", run: () => setup() });
        return out;
      };
      setMenu({ at, label: "Input", items, inputs: true });
    };

    /** a key's action (Escape is not one of them: see below) */
    const key = (a: KeyAction) => {
      const { props: p, map: m, end: e } = L();
      const s = p.session;
      switch (a) {
        case "play": return p.player.toggle();
        case "home": return h.setCursor(0, true);
        case "end": return h.setCursor(e, true);
        case "left": {
          const at = m.barAt(s.cursor);
          return h.setCursor(m.beatOfBar(at.beat > 1e-6 ? at.bar : at.bar - 1), true);
        }
        case "right": return h.setCursor(m.beatOfBar(m.barAt(s.cursor).bar + 1), true);
        case "left-beat": return h.setCursor(Math.ceil(s.cursor - 1e-6) - 1, true);
        case "right-beat": return h.setCursor(Math.floor(s.cursor + 1e-6) + 1, true);
        case "loop": return toggleLoop();
        case "record": return p.top.record?.toggle();
        case "split": return splitKey();
        case "delete": return L().marker ? removeMarker(L().marker!) : remove(s.sel.clips);
        case "mute": return mute(s.sel.clips);
        case "copy": return s.sel.clips.length ? p.clipboard.copy(s.sel.clips) : undefined;
        case "cut":
          if (!s.sel.clips.length) return;
          p.clipboard.copy(s.sel.clips);
          return remove(s.sel.clips);
        case "paste": return p.clipboard.has ? p.clipboard.paste(s.cursor, s.sel.track, false) : undefined;
        case "paste-insert": return p.clipboard.has ? p.clipboard.paste(s.cursor, s.sel.track, true) : undefined;
        case "duplicate": return duplicate(s.sel.clips);
        case "select-all": {
          const regions = s.loop?.regions ?? [];
          const ids = regions.length ? [...new Set(regions.flatMap((r) => clipsIn(p.song, r.from, r.to)))] : p.song.clips.map((c) => c.id);
          return h.select(ids);
        }
        case "cut-time": return cutLoop();
        case "insert-bar": return insert(s.cursor, false);
        case "insert-loop": return insert(s.cursor, true);
        case "undo": return p.top.canUndo ? p.top.undo() : undefined;
        case "redo": return p.top.canRedo ? p.top.redo() : undefined;
        case "add-track": return setAdding(true);
        case "save": return p.top.idea.save();
        case "marker": return addMarker(s.cursor);
        case "rename":
          if (L().marker) return setNaming(L().marker);
          return s.sel.track ? setRenaming(s.sel.track) : undefined;
        case "zoom-in": return zoomBy(ZOOM_STEP);
        case "zoom-out": return zoomBy(1 / ZOOM_STEP);
        case "open": return s.sel.clips.length ? openClip(s.sel.clips[s.sel.clips.length - 1]) : undefined;
        case "escape": return;
      }
    };
    /**
     * The phone's ⋯ menu: what the wide top bar has as buttons (Ideas, Canvas, settings, Export, how you hear yourself),
     * and what the desktop does with a right-click on the ruler or a key (Follow, fit, paste, markers, bars put in and
     * taken out, the loop).
     */
    const more = (at: MenuAt) => {
      const { props: p, follow: f, marker: mk, end: e } = L();
      const t = p.top;
      const looped = !!p.session.loop?.regions.length;
      const rec = t.record;
      const items: MenuItem[] = [
        { label: `Ideas${t.idea.count ? ` (${t.idea.count})` : ""}`, run: t.openIdeas },
        { label: "Canvas", run: t.openCanvas },
        { label: "Settings", run: t.openSettings },
        { title: "Export" },
        { label: t.exports.busy ? "WAV: being made…" : "WAV: the whole song as you hear it", disabled: !!t.exports.busy, run: t.exports.wav },
        { label: "MIDI: every track as notes", run: t.exports.midi },
        { label: "Chords + tab, as text", run: t.exports.chart },
        { title: "Timeline" },
        { label: "Follow the play line", on: f, run: () => setFollow(!f) },
        { label: "Show the whole song", run: fit },
        { label: "Paste at the cursor", disabled: !p.clipboard.has, run: () => key("paste") },
        { label: "Add a marker at the cursor", run: () => key("marker") },
        ...(mk ? [{ label: "Rename the selected marker", run: () => setNaming(mk) }, { label: "Delete the selected marker", danger: true, run: () => removeMarker(mk) }] : []),
        { label: "Insert a bar at the cursor", run: () => key("insert-bar") },
        { label: "Insert the looped length at the cursor", disabled: !looped, run: () => key("insert-loop") },
        { label: "Remove the looped time", disabled: !looped, danger: true, run: cutLoop },
        { label: "Loop the whole song", run: () => setLoop({ regions: [{ from: 0, to: e }], on: true }) },
        ...(looped ? [{ label: "Clear the loop", run: () => setLoop(null) }] : []),
      ];
      const setMonitor = rec?.setMonitor;
      if (rec && setMonitor)
        items.push(
          { title: "Hear yourself while recording" },
          { label: "Direct, from the interface", on: rec.monitor === "hardware", run: () => setMonitor("hardware") },
          { label: "Through the track's effects", on: rec.monitor === "effects", run: () => setMonitor("effects") },
        );
      setMenu({ at, label: "More", items });
    };
    return { zoomBy, fit, setLoop, toggleLoop, clipAct, openClip, addMarker, insert, cutLoop, flag, add, addMenu, againOf, trackMenu, inputMenu, key, more };
  }, [h]);

  // ── keys ──
  useEffect(() => listenKeys((a) => act.key(a), isDesktop()), [act]);
  // Escape, when nothing is open over the view and no window has the focus: deselect, then clear the loop
  useEffect(
    () => onEscape(ESC_VIEW, () => {
      const { props: p, marker: mk } = live.current;
      if (clipDrag.current?.moved || laneDrag.current?.moved) return false;
      if (p.session.sel.clips.length || mk) {
        h.select([]);
        return true;
      }
      if (p.session.loop) {
        act.setLoop(null);
        return true;
      }
      return false;
    }),
    [h, act],
  );

  // ── the wheel: plain scrolls the tracks, Shift scrolls time, Ctrl zooms about the pointer ──
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (e.target instanceof Element && e.target.closest(".tlv-pop, .tlv-menu, .tlv-top")) return;
      const v = live.current.view;
      if (e.ctrlKey || e.metaKey) {
        // (not left to the browser, which would zoom the whole page)
        e.preventDefault();
        held.current = performance.now();
        h.setView(zoomAbout(v, clamp(Math.pow(ZOOM_STEP, -e.deltaY / 100), 0.5, 2), clamp(e.clientX - h.lanesLeft(), 0, live.current.width)));
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        held.current = performance.now();
        const by = e.shiftKey ? e.deltaX || e.deltaY : e.deltaX;
        h.setView({ ...v, scroll: v.scroll + by / v.pxPerBeat });
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [h]);

  // ── the play line and a recording that is growing: moved every frame, never drawn again by React ──
  const recording = !!top.record?.on;
  useEffect(() => {
    const el = line.current;
    const grow = rec.current;
    if (!el || !grow) return;
    const hide = () => {
      el.style.display = "none";
      grow.style.display = "none";
    };
    if (!player.playing && !recording) return hide();
    let raf = 0;
    const tick = () => {
      const { props: p, view: v, width: w, follow: f } = live.current;
      const beat = p.player.playing ? p.player.getBeat() : null;
      const x = beat === null ? -1 : xOfBeat(v, beat);
      if (beat === null || x < 0 || x > w) el.style.display = "none";
      else {
        el.style.display = "block";
        el.style.transform = `translateX(${x.toFixed(2)}px)`;
      }
      // with Follow on the lanes turn a page when the line leaves them (not while they are being moved by hand)
      if (beat !== null && f && !clipDrag.current && !laneDrag.current && performance.now() > held.current + FOLLOW_WAIT) {
        const page = pageFor(v, w, beat);
        if (page !== null && Math.abs(page - v.scroll) > 1e-6) h.setView({ ...v, scroll: page });
      }
      const r = p.recording?.() ?? null;
      const row = r ? p.song.tracks.findIndex((t) => t.id === r.track) : -1;
      if (!r || row < 0) grow.style.display = "none";
      else {
        grow.style.display = "block";
        grow.style.transform = `translate(${xOfBeat(v, r.from).toFixed(2)}px, ${row * live.current.rowH}px)`;
        grow.style.width = `${Math.max(2, (r.to - r.from) * v.pxPerBeat).toFixed(2)}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      hide();
    };
  }, [player.playing, recording, h]);

  // a track just added: its row comes into view, and its compose button pulses once
  useEffect(() => {
    if (!lit) return;
    root.current?.querySelector<HTMLElement>(`.tlh[data-track="${CSS.escape(lit)}"]`)?.scrollIntoView({ block: "nearest" });
    const t = window.setTimeout(() => setLit(null), 1600);
    return () => window.clearTimeout(t);
  }, [lit]);
  useEffect(() => {
    if (adding) body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [adding]);
  // A composer window lies over the lower lanes: the rows get that much room below them, and the window's own
  // track is brought into view above it.
  const docked = [...session.windows].reverse().find((w) => w.open && w.kind === "compose");
  const dockedRow = docked ? song.tracks.findIndex((t) => t.id === docked.track) : -1;
  useLayoutEffect(() => {
    const el = body.current;
    const grid = rows.current;
    if (!el || !grid) return;
    // (a phone's composer is a sheet over the whole view: there is nothing to keep in sight beside it)
    const win = docked && !phone ? document.querySelector<HTMLElement>(`.tlw[data-win="${CSS.escape(docked.id)}"]`) : null;
    const b = el.getBoundingClientRect();
    const w = win?.getBoundingClientRect();
    // (only a window that lies across the bottom of the lanes: one dragged up into them covers what it covers)
    const cover = w && w.bottom >= b.bottom - 1 && w.top > b.top ? clamp(b.bottom - w.top, 0, Math.max(0, b.height - ROW_H)) : 0;
    grid.style.paddingBottom = cover ? `${cover}px` : "";
    if (!cover || dockedRow < 0) return;
    const seen = b.height - cover;
    if ((dockedRow + 1) * ROW_H - el.scrollTop > seen) el.scrollTop = (dockedRow + 1) * ROW_H - seen;
    else if (dockedRow * ROW_H < el.scrollTop) el.scrollTop = dockedRow * ROW_H;
  }, [docked?.id, docked?.clip, docked?.y, docked?.h, dockedRow, phone]);

  // ── clips and lanes: pressed, dragged, let go ──
  const ctl: LaneCtl = useMemo(() => {
    const { L } = h;
    const P = () => L().props;
    const clipOf = (id: string) => P().song.clips.find((c) => c.id === id);
    const elOf = (id: string) => root.current?.querySelector<HTMLElement>(`[data-clip="${CSS.escape(id)}"]`) ?? null;

    const endVisuals = (d: ClipDrag, glide: boolean) => {
      h.edge();
      for (const el of d.els) {
        el.classList.remove("dragging");
        el.closest(".tlv-lane")?.classList.remove("lifting");
        if (glide) {
          // back to where it was, in one short glide
          el.style.transition = "transform 180ms ease";
          el.style.transform = "";
          window.setTimeout(() => { el.style.transition = ""; }, 200);
        } else el.style.transform = "";
      }
      for (const s of d.stays) s.remove();
      root.current?.classList.remove("refused", "copying", "tlv-moving", "tlv-edging");
      h.hideTag();
      setDragKind(null);
      setBusy(false);
    };

    const tapClip = (e: React.PointerEvent<HTMLElement>, id: string) => {
      const c = clipOf(id);
      if (!c) return;
      const add = e.ctrlKey || e.metaKey;
      setMarker(null);
      P().setSession((s) => {
        const has = s.sel.clips.includes(id);
        return { ...s, sel: { clips: add ? (has ? s.sel.clips.filter((x) => x !== id) : [...s.sel.clips, id]) : [id], track: c.track } };
      });
    };

    const openClipMenu = (at: MenuAt, id: string, beat: number) => {
      const c = clipOf(id);
      if (!c) return;
      const p = P();
      if (!p.session.sel.clips.includes(id)) h.select([id], c.track);
      const t = p.song.tracks.find((x) => x.id === c.track);
      const end = clipEnd(c, p.song);
      const more = c.kind === "audio" && t && "takes" in t ? {
        hear: () => p.player.audition({ from: c.start, to: end }, c.track),
        takes: otherTakes(c, t.takes),
        // (numbered as the take list numbers them: the track's recordings, oldest first)
        recOf: (take: Take5) => [...new Set(t.takes.map((k) => k.group))].indexOf(take.group) + 1,
        useTake: (take: Take5) => p.edit("Use take", (s) => ({ ...s, clips: s.clips.map((x) => (x.id === id && x.kind === "audio" ? { ...x, take: take.id } : x)) })),
      } : undefined;
      const items = clipMenu(c, (a) => act.clipAct(a, id, beat), more);
      if (L().phone) {
        // what a drag of the right edge does, as two lines: the content once more, or once less
        const round = (by: 1 | -1) => {
          const q = P();
          const now = clipOf(id);
          const to = now ? repeatEnd(q.song, now, by) : null;
          if (to === null) return q.say?.("It is one round long: it cannot be shorter");
          if (resizeClip(q.song, id, "right", to) === q.song) return q.say?.(by > 0 ? "No room: the next clip is in the way" : "It cannot be shorter");
          q.edit("Change clip length", (x) => resizeClip(x, id, "right", to));
        };
        items.splice(items.length - 1, 0, { label: "Repeat once more", run: () => round(1) }, { label: "Repeat once less", run: () => round(-1) });
      }
      setMenu({ at, label: "Clip", items });
    };
    /** everything in hand is let go, changing nothing (two fingers have come down: they zoom) */
    const abort = () => {
      const d = clipDrag.current;
      clipDrag.current = null;
      if (d) {
        window.clearTimeout(d.hold);
        if (d.el) delete d.el.dataset.lifted;
        if (d.moved && !d.still) {
          endVisuals(d, true);
          setPreview(null);
        }
      }
      const l = laneDrag.current;
      laneDrag.current = null;
      if (l) window.clearTimeout(l.hold);
      if (box.current) box.current.style.display = "none";
    };
    const newClipAt = (track: string, clientX: number) => {
      const p = P();
      const t = p.song.tracks.find((x) => x.id === track);
      if (!t || "takes" in t) return;
      const kind = CLIP_OF[t.kind];
      const room = roomAt(p.song, track, h.beatAt(clientX), kind === "drums");
      if (!room) return;
      const sig = L().map.sigAt(room.from);
      const id = fresh("c");
      let content = blankContent(kind, sig);
      // (an empty tune as long as its clip, so nothing in it looks repeated)
      if (kind === "melody") content = { ...content, bars: Math.max(1, Math.round((room.to - room.from) / sigBeats(sig))) };
      const clip = { id, track, kind, start: room.from, len: room.to - room.from, off: 0, sig, content } as NoteClip;
      p.edit("New clip", (s) => layDown(s, clip));
      h.select([id], track);
      p.open("compose", track, id);
    };
    const laneMenuAt = (at: MenuAt, track: string) => {
      const p = P();
      const t = p.song.tracks.find((x) => x.id === track);
      if (!t) return;
      const beat = h.beatAt(at.x);
      const bar = L().map.snapBar(beat);
      const notes = !("takes" in t);
      setMenu({ at, label: `${t.name} lane`, items: [
        { label: "Paste here", hint: "Ctrl+V", disabled: !p.clipboard.has, run: () => p.clipboard.paste(bar, track, false) },
        ...(notes ? [{ label: "New clip here", disabled: !roomAt(p.song, track, beat, t.kind === "drums"), run: () => newClipAt(track, at.x) }] : []),
      ] });
    };

    const ctl: LaneCtl = {
      clipDown(e, id) {
        if (e.button !== 0) return;
        e.stopPropagation();
        const c = clipOf(id);
        if (!c) return;
        const edge = (e.target as HTMLElement).dataset?.edge;
        const kind = edge === "left" || edge === "right" ? edge : "move";
        const touch = e.pointerType === "touch";
        // (a second finger: the two zoom, and nothing is pressed)
        if (touch && fingers.current.size > 1) return;
        const still = touch && kind === "move" && !P().session.sel.clips.includes(id);
        const el = e.currentTarget;
        if (!still) {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* (a pretend pointer) */
          }
        }
        const beat0 = h.beatAt(e.clientX);
        // a finger rested on a clip lifts it: from then on it moves with the finger (also up and down, onto another
        // track), and let go where it is, its menu opens
        const hold = touch && kind === "move" ? window.setTimeout(() => {
          const d = clipDrag.current;
          if (!d || d.moved || d.id !== id) return;
          d.lifted = true;
          d.still = false;
          try {
            el.setPointerCapture(d.pointer);
          } catch {
            /* (a pretend pointer) */
          }
          el.dataset.lifted = "1";
          try {
            navigator.vibrate?.(8);
          } catch {
            /* (not allowed here) */
          }
          if (!P().session.sel.clips.includes(id)) h.select([id], c.track);
        }, HOLD_MS) : 0;
        clipDrag.current = { pointer: e.pointerId, id, kind, x0: e.clientX, y0: e.clientY, beat0, moved: false, still, hold, el, ids: [], els: [], stays: [], oneTrack: true, by: 0, to: undefined, copy: false };
      },
      clipMove(e) {
        const d = clipDrag.current;
        if (!d || d.pointer !== e.pointerId) return;
        const { props: p, view: v } = L();
        const c = clipOf(d.id);
        if (!c) return;
        if (!d.moved) {
          if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < (e.pointerType === "touch" ? SWIPE_PX : TAP_PX)) return;
          d.moved = true;
          window.clearTimeout(d.hold);
          // (a swipe from a clip that was not lifted moves through the song, or scrolls the tracks: see the lanes' box)
          if (d.still) return;
          // the drag begins: what moves is the selection, or this clip alone when it was not selected
          const sel = p.session.sel.clips;
          d.ids = d.kind === "move" && sel.includes(d.id) ? sel.filter((x) => clipOf(x)) : [d.id];
          if (!sel.includes(d.id)) h.select([d.id], c.track);
          d.els = d.ids.map(elOf).filter((x): x is HTMLElement => !!x);
          d.oneTrack = d.ids.every((x) => clipOf(x)?.track === c.track);
          for (const el of d.els) {
            el.classList.add("dragging");
            el.closest(".tlv-lane")?.classList.add("lifting");
          }
          root.current?.classList.add(d.kind === "move" ? "tlv-moving" : "tlv-edging");
          if (d.kind === "move" && d.oneTrack) setDragKind(c.kind);
          setBusy(true);
        }
        if (d.still) return;
        // near the left or right edge of the lanes, time scrolls under the drag
        const at = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
        h.edge(e.clientX, () => ctl.clipMove(at as React.PointerEvent<HTMLElement>));
        if (d.kind !== "move") {
          // an edge: the clip is drawn as it would be, so each repeat shows its notch as it is crossed
          const to = edgeTo(p.song, c, d.kind, h.beatAt(e.clientX), { shift: e.shiftKey });
          const now = resizeClip(p.song, c.id, d.kind, to).clips.find((x) => x.id === c.id) ?? c;
          if (to !== d.edge) {
            d.edge = to;
            setPreview(now);
          }
          return h.showTag(e, lengthText(p.song, now));
        }
        const group = d.ids.map(clipOf).filter((x): x is Clip => !!x);
        const by = Math.max(moveBy(p.song, c, h.beatAt(e.clientX) - d.beat0, { shift: e.shiftKey, alt: e.altKey }), -Math.min(...group.map((x) => x.start)));
        // up and down: onto another track, when every clip that moves is on one track and that track takes them
        let to: string | null | undefined;
        let rowsBy = 0;
        if (d.oneTrack) {
          const lane = h.laneAtY(e.clientY);
          if (lane && lane !== c.track) {
            const t = p.song.tracks.find((x) => x.id === lane);
            to = t && group.every((x) => accepts(t.kind, x.kind)) ? lane : null;
            rowsBy = p.song.tracks.findIndex((x) => x.id === lane) - p.song.tracks.findIndex((x) => x.id === c.track);
          }
        }
        d.by = by;
        d.to = to;
        d.copy = e.ctrlKey || e.metaKey;
        for (const el of d.els) el.style.transform = `translate(${(by * v.pxPerBeat).toFixed(2)}px, ${rowsBy * L().rowH}px)`;
        root.current?.classList.toggle("refused", to === null);
        root.current?.classList.toggle("copying", d.copy);
        // a copy leaves the original where it is: a still picture of it stays behind while the copy is dragged
        if (d.copy && !d.stays.length) {
          d.stays = d.els.map((el) => {
            const stay = el.cloneNode(true) as HTMLElement;
            stay.classList.remove("dragging", "sel");
            stay.classList.add("stay");
            stay.removeAttribute("data-clip");
            stay.style.transform = "";
            el.parentElement?.insertBefore(stay, el);
            return stay;
          });
        } else if (!d.copy && d.stays.length) {
          for (const s of d.stays) s.remove();
          d.stays = [];
        }
        const land = c.start + by;
        h.showTag(e, to === null ? "Not on this track" : `${d.copy ? "Copy to " : ""}${positionText(L().map, land, p.song.bpm).split(" · ")[0]}`);
      },
      clipUp(e) {
        const d = clipDrag.current;
        if (!d || d.pointer !== e.pointerId) return;
        clipDrag.current = null;
        window.clearTimeout(d.hold);
        if (d.el) delete d.el.dataset.lifted;
        // lifted and let go where it was: its menu
        if (!d.moved && d.lifted) return openClipMenu({ x: e.clientX, y: e.clientY }, d.id, d.beat0);
        if (!d.moved) return tapClip(e, d.id);
        if (d.still) return;
        const p = P();
        if (d.kind !== "move") {
          const to = d.edge;
          const kind = d.kind;
          endVisuals(d, false);
          setPreview(null);
          if (to !== undefined && resizeClip(p.song, d.id, kind, to) !== p.song) p.edit("Change clip length", (s) => resizeClip(s, d.id, kind, to));
          return;
        }
        const { ids, by } = d;
        const onto = d.to === null ? undefined : d.to;
        const base = fresh("c");
        const after = d.to === null ? p.song : d.copy ? copyClips(p.song, ids, by, onto, idsFrom(base)) : moveClips(p.song, ids, by, onto);
        if (after === p.song) return endVisuals(d, true);
        endVisuals(d, false);
        if (d.copy) {
          p.edit(ids.length > 1 ? "Copy clips" : "Copy clip", (s) => copyClips(s, ids, by, onto, idsFrom(base)));
          h.select(ids.map((_, i) => `${base}-${i + 1}`), onto);
        } else {
          p.edit(ids.length > 1 ? "Move clips" : "Move clip", (s) => moveClips(s, ids, by, onto));
          if (onto) h.select(ids, onto);
        }
      },
      clipCancel(e) {
        const d = clipDrag.current;
        if (!d || d.pointer !== e.pointerId) return;
        clipDrag.current = null;
        window.clearTimeout(d.hold);
        if (d.el) delete d.el.dataset.lifted;
        if (d.moved && !d.still) {
          endVisuals(d, true);
          setPreview(null);
        }
      },
      clipOpen(id) {
        const c = clipOf(id);
        if (!c) return;
        h.select([id], c.track);
        P().open("compose", c.track, id);
      },
      clipMenu(e, id) {
        e.preventDefault();
        e.stopPropagation();
        // (a finger rested on a clip lifts it, and its menu opens when it is let go: the browser's own long press says nothing more)
        if ((e.nativeEvent as PointerEvent).pointerType === "touch") return;
        openClipMenu({ x: e.clientX, y: e.clientY }, id, h.beatAt(e.clientX));
      },

      laneDown(e, track) {
        if (e.button !== 0 || (e.target as Element).closest("[data-clip]")) return;
        if (e.pointerType === "touch") {
          // a finger: a tap places the cursor, a swipe moves through the song or the tracks (see the lanes' box), and
          // a rest on a track's lane opens the lane's menu (paste here, a new clip here)
          if (fingers.current.size > 1) return;
          const at = { x: e.clientX, y: e.clientY };
          const hold = track ? window.setTimeout(() => {
            const d = laneDrag.current;
            if (!d || d.moved || d.pointer !== e.pointerId) return;
            laneDrag.current = null;
            laneMenuAt(at, track);
          }, HOLD_MS) : 0;
          laneDrag.current = { pointer: e.pointerId, track, x0: e.clientX, y0: e.clientY, beat0: h.beatAt(e.clientX), moved: false, add: false, touch: true, hold };
          return;
        }
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* (a pretend pointer) */
        }
        laneDrag.current = { pointer: e.pointerId, track, x0: e.clientX, y0: e.clientY, beat0: h.beatAt(e.clientX), moved: false, add: e.ctrlKey || e.metaKey };
      },
      laneMove(e) {
        const d = laneDrag.current;
        const el = box.current;
        if (!d || d.pointer !== e.pointerId || !el) return;
        if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < (d.touch ? SWIPE_PX : TAP_PX)) return;
        d.moved = true;
        window.clearTimeout(d.hold);
        // (under a finger there is no box that selects: the swipe moves through the song)
        if (d.touch) return;
        // the box that selects: from the lane it began in to the lane under the pointer
        const n = P().song.tracks.length;
        if (!n) return;
        const left = h.lanesLeft();
        const a = clamp(h.rowAt(d.y0), 0, n - 1);
        const b = clamp(h.rowAt(e.clientY), 0, n - 1);
        const x1 = Math.min(d.x0, e.clientX) - left;
        const x2 = Math.max(d.x0, e.clientX) - left;
        el.style.display = "block";
        el.style.transform = `translate(${x1}px, ${Math.min(a, b) * L().rowH}px)`;
        el.style.width = `${x2 - x1}px`;
        el.style.height = `${(Math.abs(a - b) + 1) * L().rowH}px`;
      },
      laneUp(e) {
        const d = laneDrag.current;
        if (!d || d.pointer !== e.pointerId) return;
        laneDrag.current = null;
        window.clearTimeout(d.hold);
        if (box.current) box.current.style.display = "none";
        if (d.touch && d.moved) return;
        const p = P();
        if (!d.moved) {
          // a click on an empty part: the cursor goes there, nothing is selected, that track is
          h.setCursor(snap(L().map, d.beat0, snapMode({ shift: e.shiftKey, alt: e.altKey })));
          return h.select([], d.track || null);
        }
        const n = p.song.tracks.length;
        if (!n) return;
        const a = clamp(h.rowAt(d.y0), 0, n - 1);
        const b = clamp(h.rowAt(e.clientY), 0, n - 1);
        const tracks = p.song.tracks.slice(Math.min(a, b), Math.max(a, b) + 1).map((t) => t.id);
        const hits = boxHits(p.song, { from: d.beat0, to: h.beatAt(e.clientX), tracks });
        h.select(d.add ? [...new Set([...p.session.sel.clips, ...hits])] : hits);
      },
      laneCancel(e) {
        const d = laneDrag.current;
        if (!d || d.pointer !== e.pointerId) return;
        laneDrag.current = null;
        window.clearTimeout(d.hold);
        if (box.current) box.current.style.display = "none";
      },
      laneNew(e, track) {
        if ((e.target as Element).closest("[data-clip]")) return;
        newClipAt(track, e.clientX);
      },
      laneMenu(e, track) {
        e.preventDefault();
        if ((e.target as Element).closest("[data-clip]")) return;
        // (a finger's rest has opened it already, or has lifted a clip: the browser's own long press says nothing more)
        if (L().phone && (e.nativeEvent as PointerEvent).pointerType === "touch") return;
        laneMenuAt({ x: e.clientX, y: e.clientY }, track);
      },
    };
    return Object.assign(ctl, { abort });
  }, [h, act]);

  // ── fingers on the lanes: one swiped sideways moves through the song, two zoom it ──
  // (Up and down the browser scrolls the track list itself. The clips and the lanes see the same fingers: a tap, a
  // rest and a lifted clip are theirs; this only takes the swipe they leave alone, and the second finger.)
  const swipe = useRef<{ pointer: number; x0: number; y0: number; scroll0: number; mode: "wait" | "pan" | "no" } | null>(null);
  const touch = useMemo(() => {
    const lanesOf = (t: EventTarget | null) => t instanceof Element && !!t.closest(".tlv-lane, .tlv-rest") && !t.closest(".tlc-acts");
    const end = (e: React.PointerEvent<HTMLElement>) => {
      fingers.current.delete(e.pointerId);
      if (pinch.current && (pinch.current.a === e.pointerId || pinch.current.b === e.pointerId)) pinch.current = null;
      if (swipe.current?.pointer === e.pointerId) swipe.current = null;
    };
    return {
      down(e: React.PointerEvent<HTMLElement>) {
        if (e.pointerType !== "touch" || !lanesOf(e.target)) return;
        fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (fingers.current.size === 2) {
          // the second finger: whatever the first had begun is let go, and the two zoom
          (ctl as LaneCtl & { abort(): void }).abort();
          swipe.current = null;
          const [[a, pa], [b, pb]] = [...fingers.current];
          const left = h.lanesLeft();
          pinch.current = { a, b, d0: Math.max(24, Math.hypot(pa.x - pb.x, pa.y - pb.y)), mid0: (pa.x + pb.x) / 2 - left, view: h.L().view };
          return;
        }
        if (fingers.current.size > 2) return;
        // a swipe from a clip's edge, or from a clip that is selected, is the clip's own (it is dragged)
        const clip = (e.target as Element).closest<HTMLElement>("[data-clip]");
        const own = !!clip && (!!(e.target as HTMLElement).dataset?.edge || h.L().props.session.sel.clips.includes(clip.dataset.clip ?? ""));
        swipe.current = { pointer: e.pointerId, x0: e.clientX, y0: e.clientY, scroll0: h.L().view.scroll, mode: own ? "no" : "wait" };
      },
      move(e: React.PointerEvent<HTMLElement>) {
        if (e.pointerType !== "touch") return;
        const f = fingers.current.get(e.pointerId);
        if (f) {
          f.x = e.clientX;
          f.y = e.clientY;
        }
        const z = pinch.current;
        if (z) {
          const pa = fingers.current.get(z.a);
          const pb = fingers.current.get(z.b);
          if (!pa || !pb) return;
          held.current = performance.now();
          return h.setView(pinchView(z.view, z.d0, Math.max(24, Math.hypot(pa.x - pb.x, pa.y - pb.y)), z.mid0, (pa.x + pb.x) / 2 - h.lanesLeft()));
        }
        const w = swipe.current;
        if (!w || w.pointer !== e.pointerId || w.mode === "no") return;
        const dx = e.clientX - w.x0;
        const dy = e.clientY - w.y0;
        if (w.mode === "wait") {
          if (Math.hypot(dx, dy) < SWIPE_PX) return;
          // (a clip that was lifted meanwhile moves with the finger; up and down is the browser's scroll of the tracks)
          w.mode = clipDrag.current?.lifted || Math.abs(dx) <= Math.abs(dy) ? "no" : "pan";
          if (w.mode === "no") return;
        }
        held.current = performance.now();
        const v = h.L().view;
        h.setView({ ...v, scroll: w.scroll0 - dx / v.pxPerBeat });
      },
      up: end,
      cancel: end,
    };
  }, [h, ctl]);
  // while two fingers zoom, a lifted clip is dragged or a swipe moves through the song, the page itself stays put
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const stay = (e: TouchEvent) => {
      if (!e.cancelable) return;
      if (e.touches.length > 1 || pinch.current || swipe.current?.mode === "pan" || clipDrag.current?.lifted) e.preventDefault();
    };
    el.addEventListener("touchmove", stay, { passive: false });
    return () => el.removeEventListener("touchmove", stay);
  }, []);

  // ── the track panels ──
  const head: HeadCtl = useMemo(() => {
    const P = () => h.L().props;
    return {
      select: (id) => P().setSession((s) => (s.sel.track === id ? s : { ...s, sel: { ...s.sel, track: id } })),
      grab(e, id) {
        if (e.button > 0) return;
        const grip = e.currentTarget;
        const tracks = P().song.tracks;
        const from = tracks.findIndex((t) => t.id === id);
        if (from < 0) return;
        try {
          grip.setPointerCapture(e.pointerId);
        } catch {
          /* (a pretend pointer) */
        }
        const y0 = e.clientY;
        const els = [...(root.current?.querySelectorAll<HTMLElement>(`.tlh[data-track="${CSS.escape(id)}"], .tlv-lane[data-lane="${CSS.escape(id)}"]`) ?? [])];
        let moved = false;
        let to = from;
        const move = (ev: PointerEvent) => {
          const dy = ev.clientY - y0;
          if (!moved && Math.abs(dy) < TAP_PX) return;
          if (!moved) for (const el of els) el.classList.add("lifted");
          moved = true;
          const rh = h.L().rowH;
          to = clamp(Math.round(from + dy / rh), 0, tracks.length - 1);
          const lo = -from * rh;
          const hi = (tracks.length - 1 - from) * rh;
          for (const el of els) el.style.transform = `translateY(${clamp(dy, lo, hi)}px)`;
          if (drop.current) {
            drop.current.style.display = to === from ? "none" : "block";
            drop.current.style.transform = `translateY(${(to > from ? to + 1 : to) * rh - 1}px)`;
          }
        };
        const done = (ev: PointerEvent) => {
          grip.removeEventListener("pointermove", move);
          grip.removeEventListener("pointerup", done);
          grip.removeEventListener("pointercancel", done);
          for (const el of els) {
            el.classList.remove("lifted");
            el.style.transform = "";
          }
          if (drop.current) drop.current.style.display = "none";
          if (moved && to !== from && ev.type === "pointerup") P().edit("Move track", (s) => moveTrack(s, id, to));
        };
        grip.addEventListener("pointermove", move);
        grip.addEventListener("pointerup", done);
        grip.addEventListener("pointercancel", done);
      },
      startRename: (id) => setRenaming(id),
      rename(id, name) {
        setRenaming((r) => (r === id ? null : r));
        if (name !== null) P().edit("Rename track", (s) => renameTrack(s, id, name));
      },
      // the compose button opens what is being composed on the track (its draft); a clip is opened by a double-click on it
      compose: (id) => P().open("compose", id),
      // FX opens the track's sound window; with Alt held it switches the track's effects off and on for the ear
      sound: (id, e) => (e.altKey && P().bypass ? P().bypass!.toggle(id) : P().open("sound", id)),
      mix(id, patch: Partial<TrackMix>) {
        const what = "db" in patch ? "Volume" : "mute" in patch ? "Mute track" : "Solo track";
        P().edit(what, (s) => ({ ...s, mix: mixWith(s.mix, id, patch) }), `mix:${id}:${Object.keys(patch).join()}`);
      },
      arm: (id) => P().setSession((s) => ({ ...s, armed: s.armed === id ? null : id })),
      menu: (at, id) => act.trackMenu(at, id),
      inputMenu: (at, id) => act.inputMenu(at, id),
      again: (id) => act.againOf(id),
    };
  }, [h, act]);

  const openMenu = useCallback((at: MenuAt, items: MenuItem[], label: string) => setMenu({ at, items, label }), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  // a list of inputs is open: the host is told, so the levels beside its lines are live
  const listing = !!menu?.inputs;
  const tellListing = props.inputs?.listing;
  useEffect(() => {
    if (!listing || !tellListing) return;
    tellListing(true);
    return () => tellListing(false);
  }, [listing, tellListing]);
  const onCursor = useCallback((beat: number) => h.setCursor(beat), [h]);
  const onNaming = useCallback((id: string | null) => setNaming(id), []);

  // ── what is drawn ──
  const tracks = song.tracks;
  const screen = width / ppb;
  const lines = map.lines(scroll, scroll + screen);
  const every = barEvery(ppb * sigBeats(song.meter));
  const loop = session.loop;
  const curX = xOfBeat(view, session.cursor);
  const dropKind = props.dropKind ?? dragKind;
  // the row of buttons belongs to the last clip selected, while nothing is being dragged. It stands clear of the clip,
  // so it never covers the clip's drawing: just above it, or just below when above is off the top of the list (the
  // top track) or a clip of the track above lies there and none of the track below does
  const lead = busy || props.dropKind ? undefined : [...session.sel.clips].reverse().map((id) => song.clips.find((c) => c.id === id)).find((c) => !!c);
  const leadRow = lead ? tracks.findIndex((t) => t.id === lead.track) : -1;
  const leadX = lead ? xOfBeat(view, lead.start) : 0;
  const leadEnd = lead ? xOfBeat(view, clipEnd(lead, song)) : 0;
  const actsW = phone ? Math.min(ACTS_W_PHONE, width - 6) : ACTS_W;
  const actsH = phone ? ACTS_H_PHONE : ACTS_H;
  const actsX = clamp(leadX, 3, Math.max(3, width - actsW - 3));
  const actsFree = (row: number) => row < 0 || row >= tracks.length || !song.clips.some((c) => c.track === tracks[row].id && xOfBeat(view, c.start) < actsX + actsW && xOfBeat(view, clipEnd(c, song)) > actsX);
  const actsAbove = leadRow * rowH + CLIP_TOP - ACTS_GAP - actsH;
  const actsUp = actsAbove >= scrolled && (actsFree(leadRow - 1) || !actsFree(leadRow + 1));
  const actsY = actsUp ? actsAbove : leadRow * rowH + (rowH - ROW_H + CLIP_BOTTOM) + ACTS_GAP;
  const beats: ReactNode[] = [];
  if (ppb >= 24) for (let b = Math.ceil(scroll); b < scroll + screen; b++) beats.push(<i key={b} className="tlv-gl beat" style={{ left: xOfBeat(view, b) }} />);

  return (
    <div className={`tlv${phone ? " tlv-phone" : ""}`} ref={root}
      onPointerMove={(e) => { pointer.current = { x: e.clientX, y: e.clientY }; }} onPointerLeave={() => { pointer.current = null; }}>
      <TopBar {...top} song={song} keyOf={keyOf} cursor={session.cursor} player={player} looping={!!loop?.on} onLoop={act.toggleLoop} phone={phone} onMore={act.more} />
      <Ruler song={song} view={view} width={width} session={session} follow={follow} onFollow={setFollow} onZoom={act.zoomBy} onFit={act.fit} phone={phone}
        onCursor={onCursor} onLoop={act.setLoop} edit={props.edit} marker={marker} onMarker={setMarker} naming={naming} onNaming={onNaming}
        menu={openMenu} onInsert={act.insert} onCutLoop={act.cutLoop} onAddMarker={act.addMarker} onFlag={act.flag} onEdge={h.edge} />
      <div className="tlv-body" ref={body} onPointerDownCapture={touch.down} onPointerMove={touch.move} onPointerUp={touch.up} onPointerCancel={touch.cancel} onScroll={(e) => {
        if (e.currentTarget.scrollLeft) e.currentTarget.scrollLeft = 0;
        if (live.current.props.session.sel.clips.length) setScrolled(Math.ceil(e.currentTarget.scrollTop / 4) * 4);
      }}>
        <div className={`tlv-rows${dropKind ? " dropping" : ""}`} ref={rows} style={{ gridTemplateRows: `repeat(${tracks.length}, ${rowH}px) ${phone ? ADD_PHONE : ADD_H}px minmax(0, 1fr)` }}>
          {tracks.map((t, i) => {
            const quiet = !audible(song.mix, t.id);
            const kind = CLIP_OF[t.kind];
            return [
              <TrackHead key={`h:${t.id}`} track={t} mix={song.mix?.[t.id]} quiet={quiet} selected={session.sel.track === t.id} armed={session.armed === t.id} fresh={lit === t.id} bypassed={!!props.bypass?.on.has(t.id)}
                renaming={renaming === t.id} canAgain={"role" in t && t.role === "harmony" && !!props.again} level={props.inputs?.level} row={i} rows={tracks.length} narrow={phone} ctl={head} />,
              <Lane key={`l:${t.id}`} track={t} song={song} keyOf={keyOf} view={view} width={width} selected={session.sel.clips} on={session.sel.track === t.id} quiet={quiet}
                refuse={!!dropKind && dropKind !== kind} accept={!!props.dropKind && props.dropKind === kind} stale={props.stale}
                preview={preview && preview.track === t.id ? preview : null} ghost={props.ghost && props.ghost.track === t.id ? props.ghost : null} peaks={props.peaks} ctl={ctl} />,
            ];
          })}
          <div className="tlv-addrow">
            <AddTrack open={adding && !phone} onOpen={setAdding} onAdd={act.add} onMenu={phone ? act.addMenu : undefined} />
          </div>
          <div className="tlv-rest-head" />
          <div className="tlv-rest" onPointerDown={(e) => ctl.laneDown(e, "")} onPointerMove={ctl.laneMove} onPointerUp={ctl.laneUp} onPointerCancel={ctl.laneCancel} />

          {/* under the clips: the bar lines and the loop's tint */}
          <div className="tlv-under" aria-hidden="true">
            {(loop?.regions ?? []).map((r, i) => <i key={i} className={`tlv-tint${loop?.on ? " on" : ""}`} style={{ left: xOfBeat(view, r.from), width: (r.to - r.from) * ppb }} />)}
            {beats}
            {lines.map((l) => <i key={l.bar} className={`tlv-gl${l.bar % every === 0 ? " n" : ""}`} style={{ left: xOfBeat(view, l.beat) }} />)}
            {end > scroll && end < scroll + screen && <i className="tlv-gl end" style={{ left: xOfBeat(view, end) }} />}
          </div>
          {/* over them: the cursor, the play line, a recording as it grows, the box that selects, a clip's buttons */}
          <div className="tlv-over" ref={over}>
            {curX >= 0 && curX <= width && <i className="tlv-cursor" style={{ left: curX }} />}
            <div className="tlv-line" ref={line} />
            <div className="tlv-rec" ref={rec} />
            <div className="tlv-box" ref={box} />
            {lead && leadRow >= 0 && leadEnd > 0 && leadX < width && (
              <ClipActions clip={lead} x={actsX} y={actsY} below={!actsUp} onAct={(a) => act.clipAct(a, lead.id)} />
            )}
          </div>
          <div className="tlv-drop" ref={drop} />
        </div>
      </div>
      <SideScroll view={view} width={width} total={total} onScroll={(to) => { held.current = performance.now(); h.setView({ ...view, scroll: to }); }} />
      <div className="tlv-tag mono" ref={tag} aria-hidden="true" />
      {menu && <Menu at={menu.at} items={typeof menu.items === "function" ? menu.items() : menu.items} label={menu.label} onClose={closeMenu} back={phone} />}
    </div>
  );
}

/** The sideways scroll bar under the lanes: always there, as long as the lanes reach. */
function SideScroll({ view, width, total, onScroll }: { view: View; width: number; total: number; onScroll(scroll: number): void }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x0: number; scroll0: number } | null>(null);
  const screen = width / view.pxPerBeat;
  const most = Math.max(0, total - screen);
  const size = clamp(total > 0 ? (screen / total) * width : width, 28, width);
  const at = most > 0 ? (clamp(view.scroll, 0, most) / most) * (width - size) : 0;
  const perPx = width - size > 0 ? most / (width - size) : 0;
  return (
    <div className="tlv-side">
      <div className="tlv-side-corner" />
      <div className="tlv-side-track" ref={track} role="scrollbar" aria-label="Scroll through the song" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={Math.round(most)} aria-valuenow={Math.round(view.scroll)}
        onPointerDown={(e) => {
          if (e.button > 0) return;
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - r.left;
          // a press beside the thumb: one screen that way
          if (x < at) return onScroll(Math.max(0, view.scroll - screen));
          if (x > at + size) return onScroll(Math.min(most, view.scroll + screen));
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* (a pretend pointer) */
          }
          drag.current = { pointer: e.pointerId, x0: e.clientX, scroll0: view.scroll };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d && d.pointer === e.pointerId) onScroll(clamp(d.scroll0 + (e.clientX - d.x0) * perPx, 0, most));
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <div className="tlv-side-thumb" style={{ width: size, transform: `translateX(${at.toFixed(2)}px)` }} />
      </div>
    </div>
  );
}
