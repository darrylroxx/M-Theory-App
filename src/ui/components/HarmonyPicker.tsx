/**
 * Harmonize: chords or a melody line written to go with a track of the song.
 *
 * It works in the section on screen, and writes into the track on screen when that is empty here
 * (or holds a harmony just as it was written): an empty Chords 2 is filled, not left behind for a
 * third track. Only when the track on screen holds music of its own does the harmony go to
 * another empty track of the kind, or a new one (tracks' `writeTarget`); the sheet says which.
 * It asks one thing: which track to harmonize with (every chords and melody track of this section
 * that has some music). Then it offers the harmonies for that track, best first, as music theory
 * ranks them (song/harmony, theory/harmonize), only those that give something here. Tapping an
 * option plays the section on screen, round and round, with it; tapping another swaps it straight
 * away. ✓ keeps it, in this section only. Nothing about how it sounds is chosen.
 *
 * The same sheet writes an existing harmony track again (from its ⟳), in the section on screen:
 * with another option, or the same one after its source changed. A section changed by hand since
 * is only written over after a yes.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { harmonizeSources, harmonyMenu, harmonyState, isHarmony, partHere, rewriteHarmony, writeHarmony, writtenFrom, type HarmonyPlan } from "../../song/harmony";
import { sameMusic } from "../../song/library";
import { allTracks, fromIn, normalize, optionIn, shapeIn, writeTarget, type Track, type WriteTarget } from "../../song/tracks";
import { MIDDLE, controlsFor, type Level, type Shape } from "../../theory/harmonize";
import { undoTo } from "../../song/structure";
import { onKeys, toneOf } from "../../audio/tone";
import { newId, useApp, type AppState } from "../state";

/** What is being auditioned: a harmony as it would be written (or written again), and where. */
export interface Preview {
  plan: HarmonyPlan;
  target: WriteTarget;
}
/** The page's player, for auditioning: the song plays with the preview in it while one is set. */
export interface Audition {
  preview: Preview | null;
  /** hear the section on screen with this preview (null: stop auditioning and put the loop back) */
  hear: (p: Preview | null) => void;
  /** the music is playing */
  playing: boolean;
}
export const AuditionCtx = createContext<Audition>({ preview: null, hear: () => {}, playing: false });

/**
 * The sheet. With `track` it writes that harmony track again. Without, it makes a new track of
 * `kind`, asking first which track it goes with (`first`: the one on screen, listed first).
 */
export function HarmonyPicker({ kind, track, first, anchor, onClose }: {
  kind: "chords" | "melody";
  track?: Track;
  /** the track on screen: listed first (fixed while the sheet is open, so the chips never jump) */
  first?: string;
  /** the button that opened the sheet: it is kept in sight above the sheet */
  anchor?: HTMLElement | null;
  onClose: () => void;
}) {
  const { state, set, toast } = useApp();
  const { preview, hear, playing } = useContext(AuditionCtx);
  const p = state.progression;
  const [fresh] = useState(() => newId());
  const [top] = useState(() => first ?? kind);
  // where it goes: the track on screen when it is free here, another free one, or a new track (written again: the track itself)
  const target = useMemo<WriteTarget>(() => (track ? { id: track.id, isNew: false, name: track.name, over: true } : writeTarget(p, kind, fresh, "")), [track, p, kind, fresh]);
  const id = target.id;
  const sources = useMemo(() => (track ? [] : harmonizeSources(p, top, kind, id)), [track, p, top, kind, id]);
  // a track written again: the track and the option it was written with in the section on screen (each section has its own)
  const live = track ? allTracks(normalize(p)).find((x) => x.id === track.id) : undefined;
  const here = partHere(p);
  const own = live?.harmony ? optionIn(live.harmony, here) : undefined;
  // one track with music: there is only one answer, so it is already chosen
  const [picked, setPicked] = useState<string | null>(() => (live?.harmony ? fromIn(live.harmony, here) : null) ?? (sources.length === 1 ? sources[0].id : null));
  const [option, setOption] = useState<string | null>(own ?? null);
  // the three controls, remembered for each option while the sheet is open (written again: its own option starts where it was written)
  const [shapes, setShapes] = useState<Record<string, Shape>>(() => (own && live?.harmony ? { [own]: shapeIn(live.harmony, here) } : {}));
  const shape = (option && shapes[option]) || MIDDLE;
  // the chosen track went (removed, or nothing left in it) while the sheet was open: ask again
  const lost = !track && !!picked && !sources.some((t) => t.id === picked);
  useEffect(() => {
    if (!lost) return;
    setPicked(null);
    setOption(null);
    hear(null);
  }, [lost]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = lost ? null : picked;
  const names = useMemo(() => new Map(allTracks(p).map((t) => [t.id, t.name])), [p]);
  const nameOf = (tid: string | undefined) => (tid ? names.get(tid) ?? "" : "");
  const newKind = track ? (track.kind as "chords" | "melody") : kind;
  const menu = useMemo(() => (from ? harmonyMenu(p, state.key, newKind, from, id, own) : []), [p, state.key, newKind, from, id, own]);
  const status = useMemo(() => (track ? harmonyState(p, state.key, track.id) : null), [track, p, state.key]);
  const hearing = !!preview && preview.target.id === id;
  // the track it writes into changed while the sheet was open (another track came forward): nothing chosen yet
  const was = useRef(id);
  useEffect(() => {
    if (was.current === id) return;
    was.current = id;
    setOption(null);
    hear(null);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // the track went while its sheet was open (removed, or its source was): there is nothing left to write again
  const gone = !!track && !isHarmony(p, track.id);
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  const item = menu.find((x) => x.option.id === option);

  // the sheet goes: the audition stops and the loop is put back
  useEffect(() => () => hear(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  // how tall the sheet is, so an undo offered while it is open sits just above it (not over the page tabs)
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const root = document.documentElement.style;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      root.setProperty("--hz-sheet-h", `${h}px`);
      // the button that opened it stays in sight, just above the sheet, also when the sheet grows
      // (the controls of a chosen harmony): the page has room below it to scroll up into (styles.css)
      if (anchor?.isConnected) {
        anchor.style.scrollMarginBottom = `${h + 24}px`;
        const r = anchor.getBoundingClientRect();
        if (r.bottom > window.innerHeight - h - 16 || r.top < 0) anchor.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.removeProperty("--hz-sheet-h");
      if (anchor) anchor.style.scrollMarginBottom = "";
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  /** Which track to harmonize with: its harmonies are offered, nothing is chosen yet. */
  const toSource = (sid: string) => {
    if (sid === picked) return;
    setPicked(sid);
    setOption(null);
    hear(null);
  };
  const pick = (o: string) => {
    if (gone) return;
    setOption(o);
    if (from) hear({ plan: { kind: newKind, from, option: o, shape: shapes[o] ?? MIDDLE }, target });
  };
  const toggleHear = () => {
    if (hearing && playing) hear(null);
    else if (from && option) hear({ plan: { kind: newKind, from, option, shape }, target });
  };
  /** A control moved: the option is heard with it at once. */
  const reshape = (s: Shape) => {
    if (!option || gone) return;
    setShapes((m) => ({ ...m, [option]: s }));
    if (from) hear({ plan: { kind: newKind, from, option, shape: s }, target });
  };
  /** Keep it: add the track, or write it again; either can be taken back while nothing else has changed. */
  const keep = () => {
    if (!from || !option || !item || gone) return;
    const before = state.progression;
    const key = state.key;
    let after: typeof before;
    let msg: string;
    if (track) {
      if (status?.edited.length && !window.confirm(`${track.name} was changed in ${status.edited.join(", ")} since it was written. Write over it?`)) return;
      after = rewriteHarmony(before, key, track.id, option, shape);
      msg = `${after.tracks?.find((t) => t.id === track.id)?.name ?? track.name} ⟳`;
    } else {
      const r = writeHarmony(before, key, { kind: newKind, from, option, shape }, target);
      if (!r.track) return;
      after = r.p;
      msg = keptMessage(target.isNew, r.track.name, item.label, item.instead && nameOf(item.instead));
    }
    hear(null);
    set((s) => ({ ...s, progression: s.progression === before ? after : s.progression }));
    const still = (s: AppState) => s.key.tonic === key.tonic && s.key.scaleId === key.scaleId && sameMusic(s.progression, after);
    toast(msg, { label: "↶", aria: "Undo", when: still, run: () => set((s) => (still(s) ? { ...s, progression: undoTo(s.progression, before) } : s)) });
    onClose();
  };

  const hint = item ? `${item.hint}.${item.instead ? ` Plays instead of ${nameOf(item.instead)}.` : ""}` : "";
  // (written from in this section: each section has its own source)
  const srcName = track ? writtenFrom(p, track.id)?.name ?? "" : "";
  return (
    <div ref={sheet} className="hz-sheet" role="dialog" aria-label={track ? `Write ${track.name} again` : "Harmonize"}>
      <div className="hz-row">
        {track ? (
          <span className="hz-src-now" title={`Written from ${srcName}`}>
            <b>{track.name}</b> with {srcName}
            {status?.stale && <i className="hz-dot" aria-label="Its source has changed" title="Its source has changed" />}
          </span>
        ) : (
          <>
            <span className="hz-q">Harmonize {target.isNew ? <b>a new track</b> : <b className="hz-to">{target.name}</b>} with</span>
            {sources.map((t) => (
              <button key={t.id} className={`chip${from === t.id ? " on" : ""}`} aria-pressed={from === t.id} aria-label={`Harmonize with ${t.name}`} onClick={() => toSource(t.id)}>
                {t.name}
              </button>
            ))}
            {!sources.length && <span className="hz-none">Nothing to harmonize yet</span>}
          </>
        )}
        <button className="icon-btn hz-x" aria-label="Close" title="Close" onClick={onClose}>✕</button>
      </div>
      {from && (
        <>
          {menu.length ? (
            <div className="hz-opts" role="group" aria-label="Harmonies">
              {menu.map((x, i) => (
                <span key={x.option.id} className="hz-opt-wrap">
                  {/* the ones played instead of the chords stand apart */}
                  {x.option.instead && !menu[i - 1]?.option.instead && i > 0 && <span className="hz-div">Instead</span>}
                  <button className={`chip hz-opt${option === x.option.id ? " on" : ""}${own === x.option.id ? " now" : ""}`} aria-pressed={option === x.option.id} title={x.hint} onClick={() => pick(x.option.id)}>
                    {x.label}
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span className="hz-none">Nothing to add to {nameOf(from)} yet</span>
          )}
          {option && item && <ShapeControls shape={shape} on={controlsFor(newKind, option, !onKeys(toneOf(normalize(p), id)))} onChange={reshape} />}
          <div className="hz-foot">
            <span className="hz-hint">{hint}</span>
            <button className="icon-btn" disabled={!option} aria-pressed={hearing && playing} aria-label={hearing && playing ? "Stop" : "Hear it"} title={hearing && playing ? "Stop" : "Hear it"} onClick={toggleHear}>{hearing && playing ? "■" : "▶"}</button>
            {track ? (
              <button className="btn hz-keep" disabled={!item} aria-label="Write it again" title="Write it again" onClick={keep}>⟳</button>
            ) : (
              <button className="btn hz-keep" disabled={!item} aria-label="Keep it" title={target.isNew ? "Keep as a new track" : `Keep it in ${target.name}`} onClick={keep}>✓</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * What the toast says once a harmony is kept: a new track's name; else the track and the harmony
 * now in it, said once when the track is called by it (a track Harmonize made takes its option's
 * name: "Guide tones", never "Guide tones: Guide tones").
 */
export function keptMessage(isNew: boolean, name: string, label: string, instead?: string | false): string {
  const what = isNew ? `${name} added` : name === label || name.startsWith(`${label} `) ? name : `${name}: ${label}`;
  return `${what}${instead ? `, in place of ${instead} here` : ""}`;
}

const CONTROLS: { key: keyof Shape; ends: [string, string]; label: string }[] = [
  { key: "busy", ends: ["Simpler", "Busier"], label: "Simpler or busier" },
  { key: "wide", ends: ["Closer", "Wider"], label: "Closer or wider" },
  { key: "colour", ends: ["Plain", "Colourful"], label: "Plain or colourful" },
];
/**
 * The three controls on the chosen harmony: each three steps, the middle first. Tapping an end
 * word moves a step toward it; a step is heard at once. One that means nothing for this harmony is
 * greyed out. (Nothing here is about sound: these shape the notes only.)
 */
function ShapeControls({ shape, on, onChange }: { shape: Shape; on: Record<keyof Shape, boolean>; onChange: (s: Shape) => void }) {
  return (
    <div className="hz-ctls" role="group" aria-label="Shape it">
      {CONTROLS.map(({ key, ends, label }) => {
        const v = shape[key];
        const off = !on[key];
        const set = (x: number) => !off && onChange({ ...shape, [key]: Math.max(0, Math.min(2, x)) as Level });
        const names = [ends[0], "Middle", ends[1]];
        return (
          <div key={key} className="hz-ctl" role="radiogroup" aria-label={label} aria-disabled={off || undefined} title={off ? "Not for this one" : undefined}>
            <button className="hz-end" disabled={off} tabIndex={-1} aria-hidden="true" onClick={() => set(v - 1)}>{ends[0]}</button>
            {names.map((n, i) => (
              <button key={n} className={`hz-step${v === i ? " on" : ""}`} role="radio" aria-checked={v === i} aria-label={n} title={off ? "Not for this one" : n} disabled={off} onClick={() => set(i)}>
                <i aria-hidden="true" />
              </button>
            ))}
            <button className="hz-end" disabled={off} tabIndex={-1} aria-hidden="true" onClick={() => set(v + 1)}>{ends[1]}</button>
          </div>
        );
      })}
    </div>
  );
}

/** A harmony track's head control: ⟳ opens the sheet that writes it again (a dot: its source has changed since). */
export function HarmonyAgain({ track, className, onOpen }: { track: Track; className?: string; onOpen: () => void }) {
  const { state } = useApp();
  const st = useMemo(() => harmonyState(state.progression, state.key, track.id), [state.progression, state.key, track.id]);
  if (!st.source) return null;
  const label = `Write ${track.name} again`;
  return (
    <span className={`hz-again${st.stale ? " stale" : ""}${className ? ` ${className}` : ""}`} role="button" tabIndex={0} aria-label={st.stale ? `${label}: its source has changed` : label} title={st.stale ? "Its source has changed" : "Write again"}
      onClick={(e) => { e.stopPropagation(); onOpen(); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onOpen(); } }}>
      ⟳
    </span>
  );
}

/** Harmonize: opens the sheet that asks which track to harmonize with (≈: goes with). */
export function HarmonizeButton({ on, onClick }: { on: boolean; onClick: (el: HTMLElement | null) => void }) {
  return (
    <button className={`chip hz-go${on ? " on" : ""}`} aria-expanded={on} aria-haspopup="dialog" title="Harmonize with a track" onClick={(e) => onClick(e.currentTarget)}>
      <span aria-hidden="true">≈</span>Harmonize
    </button>
  );
}
