// The track view: a top bar, a ruler, a panel for each track on the left and its lane of clips on the right.
// The panels and lanes share one box that scrolls up and down, so a row can never drift from its panel. Time is not
// scrolled by the browser: the view keeps which beat is at the left edge and how wide a beat is, and draws from that
// (so a long song at a close zoom costs no more than a short one, and only the clips on screen are mounted).
//
// It reads no app state and plays nothing: the song, what is selected, and every way to change them come in as props.
// A drag changes the song once, when it is let go; until then the clip's element is only moved on screen.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { audible, mixWith, type TrackMix } from "../../audio/mix";
import { isDesktop } from "../../desktop";
import { sameSig, sigBeats, type TimeSig } from "../../song/meter";
import type { Key } from "../../theory/keys";
import { barMap } from "../../timeline/bars";
import {
  addTrack, blankContent, clipsIn, copyClips, cutTime, deleteClips, duplicateClips, duplicateTrack, insertTime, layDown, moveClips, moveTrack,
  removeTrack, renameTrack, resizeClip, setSig, setTrack, songEnd, splitClips,
} from "../../timeline/edit";
import { accepts, CLIP_OF, clipEnd, type Clip, type ClipKind, type InputRef, type NoteClip, type Session, type Take5, type TimelineSong, type TrackKind } from "../../timeline/model";
import "../timeline.css";
import { AddTrack } from "./AddTrack";
import type { PlayerApi } from "./api";
import { ClipActions, clipMenu, otherTakes, type ClipAct } from "./ClipActions";
import {
  MAX_PX, MIN_PX, ZOOM_STEP, barEvery, barRegion, beatOfX, boxHits, clipUnder, edgeTo, fitView, lengthText, moveBy, pageFor, positionText, reach, roomAt, snap,
  snapMode, xOfBeat, zoomAbout, type View,
} from "./gestures";
import { ESC_VIEW, listenKeys, onEscape, type KeyAction } from "./keys";
import { Lane, type LaneCtl } from "./Lane";
import { Menu, type MenuAt, type MenuItem } from "./Menu";
import { Ruler } from "./Ruler";
import { TopBar, type TopBarProps } from "./TopBar";
import { TrackHead, inputText, type HeadCtl } from "./TrackHead";

export interface TrackViewProps {
  song: TimelineSong; keyOf: Key; session: Session;
  /** every change of the song: the host applies it and makes one undo step. `control`: quick changes from one control (a volume being dragged) are one step */
  edit(label: string, fn: (s: TimelineSong) => TimelineSong, control?: string): void;
  setSession(fn: (s: Session) => Session): void;
  player: PlayerApi;
  /** open a plugin window (the host decides what that is) */
  open(kind: "compose" | "sound", track: string, clip?: string): void;
  /** a take's waveform for the lane, when its audio is loaded: how loud it is along its length, 0 to 1, any number of values spread evenly over the take */
  peaks?(take: Take5): Float32Array | undefined;
  clipboard: { copy(ids: string[]): void; paste(at: number, onto: string | null, insert: boolean): void; has: boolean };
  sound: { copy(track: string): void; paste(track: string): void; has(track: string): boolean };
  top: TopBarProps;
  /** which lanes a clip dragged out of a composer may land on, while one is being dragged */
  dropKind?: ClipKind | null;
  /** harmony clips whose source changed since they were written: each shows a dot */
  stale?: ReadonlySet<string>;
  /** the panel's ⟳: write the harmony again into this clip of this track */
  again?(track: string, clip: string): void;
  /** tracks that record: how many inputs there are to choose from, each one's level while the interface is open, and the way to audio setup */
  inputs?: { count: number; level?(ch: number): number; setup(): void };
  /** a recording that is running, drawn growing on its lane; read once a frame */
  recording?(): { track: string; from: number; to: number } | null;
  /** a short message from the view; with `undo` it carries an undo button (a track with clips or takes removed) */
  say?(msg: string, undo?: boolean): void;
}

/** How tall a track's row is, how tall the + row is, and how wide the panels are. */
export const ROW_H = 64;
export const ADD_H = 44;
export const PANEL = 260;
/** How wide the lanes are taken to be before the screen is measured (a 1280 window). */
const GUESS_W = 1020;
/** A drag starts after this many pixels; less is a click. */
const TAP_PX = 4;
/** How long a finger rests on a clip before its menu opens. */
const HOLD_MS = 500;
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
  ids: string[]; els: HTMLElement[]; stays: HTMLElement[]; oneTrack: boolean;
  by: number; to: string | null | undefined; copy: boolean; edge?: number;
};
type LaneDrag = { pointer: number; track: string; x0: number; y0: number; beat0: number; moved: boolean; add: boolean };

export function TrackView(props: TrackViewProps) {
  const { song, keyOf, session, setSession, player, top } = props;
  const map = barMap(song);
  const end = songEnd(song);

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
      const w = el.clientWidth - PANEL;
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
  }, []);
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
  const [menu, setMenu] = useState<{ at: MenuAt; items: MenuItem[]; label: string } | null>(null);
  /** a clip as it is while its edge is dragged */
  const [preview, setPreview] = useState<Clip | null>(null);
  /** the kind of clip being dragged across lanes (the lanes that do not take it are dimmed) */
  const [dragKind, setDragKind] = useState<ClipKind | null>(null);
  const [busy, setBusy] = useState(false);

  const live = useRef({ props, view, width, map, end, total, follow, marker, naming, renaming, preview });
  live.current = { props, view, width, map, end, total, follow, marker, naming, renaming, preview };
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(0);
  const clipDrag = useRef<ClipDrag | null>(null);
  const laneDrag = useRef<LaneDrag | null>(null);

  // ── small helpers every handler uses (they read what is current, so they never go stale) ──
  const h = useMemo(() => {
    const L = () => live.current;
    const lanesLeft = () => over.current?.getBoundingClientRect().left ?? PANEL;
    const beatAt = (clientX: number) => beatOfX(L().view, clientX - lanesLeft());
    const rowAt = (clientY: number) => Math.floor((clientY - (rows.current?.getBoundingClientRect().top ?? 0)) / ROW_H);
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
    return { L, lanesLeft, beatAt, rowAt, laneAtY, setView, setCursor, select, showTag, hideTag };
  }, []);

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
      const count = Math.max(1, p.inputs?.count ?? 2);
      const now = inputText(t.input);
      const pick = (input: InputRef) => p.edit("Input", (s) => setTrack(s, id, { input }));
      const items: MenuItem[] = [{ title: "Records from" }];
      for (let ch = 0; ch < count; ch++) items.push({ label: `Input ${ch + 1}`, on: now === `${ch + 1}`, run: () => pick({ ch }) });
      for (let ch = 0; ch + 1 < count; ch += 2) items.push({ label: `Inputs ${ch + 1}+${ch + 2} (stereo)`, on: now === `${ch + 1}+${ch + 2}`, run: () => pick({ ch, pair: true }) });
      if (p.inputs) items.push({ sep: true }, { label: "Audio setup…", run: () => p.inputs?.setup() });
      setMenu({ at, label: "Input", items });
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
    return { zoomBy, fit, setLoop, toggleLoop, clipAct, openClip, addMarker, insert, cutLoop, flag, add, trackMenu, inputMenu, key };
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
        grow.style.transform = `translate(${xOfBeat(v, r.from).toFixed(2)}px, ${row * ROW_H}px)`;
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
    const win = docked ? document.querySelector<HTMLElement>(`.tlw[data-win="${CSS.escape(docked.id)}"]`) : null;
    const b = el.getBoundingClientRect();
    const w = win?.getBoundingClientRect();
    // (only a window that lies across the bottom of the lanes: one dragged up into them covers what it covers)
    const cover = w && w.bottom >= b.bottom - 1 && w.top > b.top ? clamp(b.bottom - w.top, 0, Math.max(0, b.height - ROW_H)) : 0;
    grid.style.paddingBottom = cover ? `${cover}px` : "";
    if (!cover || dockedRow < 0) return;
    const seen = b.height - cover;
    if ((dockedRow + 1) * ROW_H - el.scrollTop > seen) el.scrollTop = (dockedRow + 1) * ROW_H - seen;
    else if (dockedRow * ROW_H < el.scrollTop) el.scrollTop = dockedRow * ROW_H;
  }, [docked?.id, docked?.clip, docked?.y, docked?.h, dockedRow]);

  // ── clips and lanes: pressed, dragged, let go ──
  const ctl: LaneCtl = useMemo(() => {
    const { L } = h;
    const P = () => L().props;
    const clipOf = (id: string) => P().song.clips.find((c) => c.id === id);
    const elOf = (id: string) => root.current?.querySelector<HTMLElement>(`[data-clip="${CSS.escape(id)}"]`) ?? null;

    const endVisuals = (d: ClipDrag, glide: boolean) => {
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
        useTake: (take: Take5) => p.edit("Use take", (s) => ({ ...s, clips: s.clips.map((x) => (x.id === id && x.kind === "audio" ? { ...x, take: take.id } : x)) })),
      } : undefined;
      setMenu({ at, label: "Clip", items: clipMenu(c, (a) => act.clipAct(a, id, beat), more) });
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
        const still = touch && kind === "move" && !P().session.sel.clips.includes(id);
        if (!still) {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* (a pretend pointer) */
          }
        }
        const at = { x: e.clientX, y: e.clientY };
        const beat0 = h.beatAt(e.clientX);
        const hold = touch ? window.setTimeout(() => {
          const d = clipDrag.current;
          if (!d || d.moved || d.id !== id) return;
          clipDrag.current = null;
          openClipMenu(at, id, beat0);
        }, HOLD_MS) : 0;
        clipDrag.current = { pointer: e.pointerId, id, kind, x0: e.clientX, y0: e.clientY, beat0, moved: false, still, hold, ids: [], els: [], stays: [], oneTrack: true, by: 0, to: undefined, copy: false };
      },
      clipMove(e) {
        const d = clipDrag.current;
        if (!d || d.pointer !== e.pointerId) return;
        const { props: p, view: v } = L();
        const c = clipOf(d.id);
        if (!c) return;
        if (!d.moved) {
          if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < TAP_PX) return;
          d.moved = true;
          window.clearTimeout(d.hold);
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
        for (const el of d.els) el.style.transform = `translate(${(by * v.pxPerBeat).toFixed(2)}px, ${rowsBy * ROW_H}px)`;
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
        openClipMenu({ x: e.clientX, y: e.clientY }, id, h.beatAt(e.clientX));
      },

      laneDown(e, track) {
        if (e.button !== 0 || (e.target as Element).closest("[data-clip]")) return;
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
        if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < TAP_PX) return;
        d.moved = true;
        // the box that selects: from the lane it began in to the lane under the pointer
        const n = P().song.tracks.length;
        if (!n) return;
        const left = h.lanesLeft();
        const a = clamp(h.rowAt(d.y0), 0, n - 1);
        const b = clamp(h.rowAt(e.clientY), 0, n - 1);
        const x1 = Math.min(d.x0, e.clientX) - left;
        const x2 = Math.max(d.x0, e.clientX) - left;
        el.style.display = "block";
        el.style.transform = `translate(${x1}px, ${Math.min(a, b) * ROW_H}px)`;
        el.style.width = `${x2 - x1}px`;
        el.style.height = `${(Math.abs(a - b) + 1) * ROW_H}px`;
      },
      laneUp(e) {
        const d = laneDrag.current;
        if (!d || d.pointer !== e.pointerId) return;
        laneDrag.current = null;
        if (box.current) box.current.style.display = "none";
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
        if (box.current) box.current.style.display = "none";
      },
      laneNew(e, track) {
        if ((e.target as Element).closest("[data-clip]")) return;
        const p = P();
        const t = p.song.tracks.find((x) => x.id === track);
        if (!t || "takes" in t) return;
        const kind = CLIP_OF[t.kind];
        const room = roomAt(p.song, track, h.beatAt(e.clientX), kind === "drums");
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
      },
      laneMenu(e, track) {
        e.preventDefault();
        if ((e.target as Element).closest("[data-clip]")) return;
        const p = P();
        const t = p.song.tracks.find((x) => x.id === track);
        if (!t) return;
        const beat = h.beatAt(e.clientX);
        const at = L().map.snapBar(beat);
        const notes = !("takes" in t);
        const event = e;
        setMenu({ at: { x: e.clientX, y: e.clientY }, label: `${t.name} lane`, items: [
          { label: "Paste here", hint: "Ctrl+V", disabled: !p.clipboard.has, run: () => p.clipboard.paste(at, track, false) },
          ...(notes ? [{ label: "New clip here", disabled: !roomAt(p.song, track, beat, t.kind === "drums"), run: () => ctl.laneNew(event, track) }] : []),
        ] });
      },
    };
    return ctl;
  }, [h, act]);

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
          to = clamp(Math.round(from + dy / ROW_H), 0, tracks.length - 1);
          const lo = -from * ROW_H;
          const hi = (tracks.length - 1 - from) * ROW_H;
          for (const el of els) el.style.transform = `translateY(${clamp(dy, lo, hi)}px)`;
          if (drop.current) {
            drop.current.style.display = to === from ? "none" : "block";
            drop.current.style.transform = `translateY(${(to > from ? to + 1 : to) * ROW_H - 1}px)`;
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
      compose(id) {
        // the track's selected clip; else the clip under the cursor; else its first clip; else nothing yet
        const { song: s, session: se } = P();
        const mine = s.clips.filter((c) => c.track === id).sort((a, b) => a.start - b.start);
        const c = mine.find((x) => se.sel.clips.includes(x.id)) ?? mine.find((x) => x.start <= se.cursor && clipEnd(x, s) > se.cursor) ?? mine[0];
        P().open("compose", id, c?.id);
      },
      sound: (id) => P().open("sound", id),
      mix(id, patch: Partial<TrackMix>) {
        const what = "db" in patch ? "Volume" : "mute" in patch ? "Mute track" : "Solo track";
        P().edit(what, (s) => ({ ...s, mix: mixWith(s.mix, id, patch) }), `mix:${id}:${Object.keys(patch).join()}`);
      },
      arm: (id) => P().setSession((s) => ({ ...s, armed: s.armed === id ? null : id })),
      menu: (at, id) => act.trackMenu(at, id),
      inputMenu: (at, id) => act.inputMenu(at, id),
      again(id) {
        const { song: s, session: se, again } = P();
        const mine = s.clips.filter((c) => c.track === id);
        const c = mine.find((x) => se.sel.clips.includes(x.id)) ?? mine.find((x) => x.start <= se.cursor && clipEnd(x, s) > se.cursor);
        if (c) again?.(id, c.id);
        else P().say?.("Select the clip to write again");
      },
    };
  }, [h, act]);

  const openMenu = useCallback((at: MenuAt, items: MenuItem[], label: string) => setMenu({ at, items, label }), []);
  const closeMenu = useCallback(() => setMenu(null), []);
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
  // the row of buttons stands on the last clip selected, while nothing is being dragged
  const lead = busy ? undefined : [...session.sel.clips].reverse().map((id) => song.clips.find((c) => c.id === id)).find((c) => !!c);
  const leadRow = lead ? tracks.findIndex((t) => t.id === lead.track) : -1;
  const leadX = lead ? xOfBeat(view, lead.start) : 0;
  const leadEnd = lead ? xOfBeat(view, clipEnd(lead, song)) : 0;
  const beats: ReactNode[] = [];
  if (ppb >= 24) for (let b = Math.ceil(scroll); b < scroll + screen; b++) beats.push(<i key={b} className="tlv-gl beat" style={{ left: xOfBeat(view, b) }} />);

  return (
    <div className="tlv" ref={root}
      onPointerMove={(e) => { pointer.current = { x: e.clientX, y: e.clientY }; }} onPointerLeave={() => { pointer.current = null; }}>
      <TopBar {...top} song={song} keyOf={keyOf} cursor={session.cursor} player={player} looping={!!loop?.on} onLoop={act.toggleLoop} />
      <Ruler song={song} view={view} width={width} session={session} follow={follow} onFollow={setFollow} onZoom={act.zoomBy} onFit={act.fit}
        onCursor={onCursor} onLoop={act.setLoop} edit={props.edit} marker={marker} onMarker={setMarker} naming={naming} onNaming={onNaming}
        menu={openMenu} onInsert={act.insert} onCutLoop={act.cutLoop} onAddMarker={act.addMarker} onFlag={act.flag} />
      <div className="tlv-body" ref={body} onScroll={(e) => { if (e.currentTarget.scrollLeft) e.currentTarget.scrollLeft = 0; }}>
        <div className={`tlv-rows${dropKind ? " dropping" : ""}`} ref={rows} style={{ gridTemplateRows: `repeat(${tracks.length}, ${ROW_H}px) ${ADD_H}px minmax(0, 1fr)` }}>
          {tracks.map((t, i) => {
            const quiet = !audible(song.mix, t.id);
            const kind = CLIP_OF[t.kind];
            return [
              <TrackHead key={`h:${t.id}`} track={t} mix={song.mix?.[t.id]} quiet={quiet} selected={session.sel.track === t.id} armed={session.armed === t.id} fresh={lit === t.id}
                renaming={renaming === t.id} canAgain={"role" in t && t.role === "harmony" && !!props.again} level={props.inputs?.level} row={i} rows={tracks.length} ctl={head} />,
              <Lane key={`l:${t.id}`} track={t} song={song} keyOf={keyOf} view={view} width={width} selected={session.sel.clips} on={session.sel.track === t.id} quiet={quiet}
                refuse={!!dropKind && dropKind !== kind} accept={!!props.dropKind && props.dropKind === kind} stale={props.stale}
                preview={preview && preview.track === t.id ? preview : null} peaks={props.peaks} ctl={ctl} />,
            ];
          })}
          <div className="tlv-addrow">
            <AddTrack open={adding} onOpen={setAdding} onAdd={act.add} />
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
              <ClipActions clip={lead} x={clamp(leadX + 3, 3, Math.max(3, width - 166))} y={leadRow * ROW_H + 4} onAct={(a) => act.clipAct(a, lead.id)} />
            )}
          </div>
          <div className="tlv-drop" ref={drop} />
        </div>
      </div>
      <SideScroll view={view} width={width} total={total} onScroll={(to) => { held.current = performance.now(); h.setView({ ...view, scroll: to }); }} />
      <div className="tlv-tag mono" ref={tag} aria-hidden="true" />
      {menu && <Menu at={menu.at} items={menu.items} label={menu.label} onClose={closeMenu} />}
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
