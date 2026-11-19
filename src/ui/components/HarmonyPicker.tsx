/**
 * Harmonize: a new chords or melody track written to go with a track of the song.
 *
 * From a page's Harmonize button the sheet opens already set to the track on that page, with a
 * two-way choice of what the new track is (Chords or Melody) and the source as a small menu. From
 * an Add track + it first asks what the new track goes with (or Empty, for a plain track). Either
 * way it offers the harmony options for that track (song/harmony, theory/harmonize): the ones that would write
 * nothing in this song are greyed, and the ones that replace the source rather than play with it
 * stand apart. Tapping an option plays the section on screen, round and round, with that option
 * added; tapping another swaps it straight away. ✓ keeps it, in every section.
 *
 * The same sheet writes an existing harmony track again (from its track head): with another
 * option, or the same one after its source changed. Sections changed by hand since are only
 * written over after a yes.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { addHarmony, harmonyMenu, harmonySources, harmonyState, isHarmony, optionOf, rewriteHarmony, type HarmonyPlan } from "../../song/harmony";
import { sameMusic } from "../../song/library";
import type { Track } from "../../song/tracks";
import { newId, useApp, type AppState } from "../state";

/** What is being auditioned: a harmony track as it would be added (or written again), by id. */
export interface Preview {
  plan: HarmonyPlan;
  id: string;
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

const KIND_WORD = { chords: "chords", melody: "melody" } as const;

/**
 * The sheet. With `track` it writes that harmony track again. Without, it makes a new track of
 * `kind`: given `source` it starts on that track and the kind can be changed; else it first asks
 * for a source (Empty calls `onEmpty`).
 */
export function HarmonyPicker({ kind: kind0, track, source, anchor, onEmpty, onClose, onAdded }: {
  kind: "chords" | "melody";
  track?: Track;
  /** the track to harmonize, already chosen (a page's Harmonize button) */
  source?: string;
  /** the button that opened the sheet: it is kept in sight above the sheet */
  anchor?: HTMLElement | null;
  onEmpty?: () => void;
  onClose: () => void;
  /** a harmony track was added (its name) */
  onAdded?: (name: string) => void;
}) {
  const { state, set, toast } = useApp();
  const { preview, hear, playing } = useContext(AuditionCtx);
  const p = state.progression;
  const [id] = useState(() => track?.id ?? newId());
  const [kind, setKind] = useState(kind0);
  const [from, setFrom] = useState<string | null>(track?.harmony?.from ?? source ?? null);
  const [option, setOption] = useState<string | null>(track?.harmony?.option ?? null);
  const sources = useMemo(() => harmonySources(p), [p]);
  const menu = useMemo(() => (from ? harmonyMenu(p, state.key, kind, from, id) : []), [p, state.key, kind, from, id]);
  const status = useMemo(() => (track ? harmonyState(p, state.key, track.id) : null), [track, p, state.key]);
  const hearing = !!preview && preview.id === id;
  // the track went while its sheet was open (removed, or its source was): there is nothing left to write again
  const gone = !!track && !isHarmony(p, track.id);
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  const opt = option ? optionOf(kind, option) : undefined;

  // the sheet goes: the audition stops and the loop is put back
  useEffect(() => () => hear(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  // how tall the sheet is, so an undo offered while it is open sits just above it (not over the page tabs)
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const root = document.documentElement.style;
    let first = true;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      root.setProperty("--hz-sheet-h", `${h}px`);
      // the button that opened it stays in sight, just above the sheet
      if (first && anchor?.isConnected) {
        anchor.style.scrollMarginBottom = `${h + 24}px`;
        const r = anchor.getBoundingClientRect();
        if (r.bottom > window.innerHeight - h - 16 || r.top < 0) anchor.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      first = false;
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

  const pick = (o: string) => {
    if (gone) return;
    setOption(o);
    if (from) hear({ plan: { kind, from, option: o }, id });
  };
  const toggleHear = () => {
    if (hearing && playing) hear(null);
    else if (from && option) hear({ plan: { kind, from, option }, id });
  };
  /** Keep it: add the track, or write it again; either can be taken back while nothing else has changed. */
  const keep = () => {
    if (!from || !option || !opt || gone) return;
    const before = state.progression;
    const key = state.key;
    let after: typeof before;
    let msg: string;
    if (track) {
      if (status?.edited.length && !window.confirm(`${track.name} was changed in ${status.edited.join(", ")} since it was written. Write over it?`)) return;
      after = rewriteHarmony(before, key, track.id, option);
      msg = `${after.tracks?.find((t) => t.id === track.id)?.name ?? track.name} ⟳`;
    } else {
      const r = addHarmony(before, key, { kind, from, option }, id);
      if (!r.track) return;
      after = r.p;
      msg = `${r.track.name} added`;
      onAdded?.(r.track.name);
    }
    hear(null);
    set((s) => ({ ...s, progression: s.progression === before ? after : s.progression }));
    const still = (s: AppState) => s.key.tonic === key.tonic && s.key.scaleId === key.scaleId && sameMusic(s.progression, after);
    toast(msg, { label: "↶", aria: "Undo", when: still, run: () => set((s) => (still(s) ? { ...s, progression: before } : s)) });
    onClose();
  };

  const layered = menu.filter((x) => !x.instead);
  const instead = menu.filter((x) => x.instead);
  const chip = (x: (typeof menu)[number]) => (
    <button key={x.option.id} className={`chip hz-opt${option === x.option.id ? " on" : ""}${track?.harmony?.option === x.option.id ? " now" : ""}`} disabled={!x.useful} aria-pressed={option === x.option.id} title={x.option.hint} onClick={() => pick(x.option.id)}>
      {x.option.label}
    </button>
  );
  const srcName = (sid: string) => sources.find((t) => t.id === sid)?.name ?? "";
  /** another kind of new track, from the same source: its own options */
  const toKind = (k: "chords" | "melody") => {
    if (k === kind) return;
    setKind(k);
    setOption(null);
    hear(null);
  };
  const toSource = (sid: string) => {
    setFrom(sid);
    setOption(null);
    hear(null);
  };
  return (
    <div ref={sheet} className="hz-sheet" role="dialog" aria-label={track ? `Write ${track.name} again` : `New ${KIND_WORD[kind]} track`}>
      <div className="hz-row">
        {track ? (
          <span className="hz-src-now" title={`Written from ${srcName(track.harmony?.from ?? "")}`}>
            <b>{track.name}</b> ≈ {srcName(track.harmony?.from ?? "")}
            {status?.stale && <i className="hz-dot" aria-label="Its source has changed" title="Its source has changed" />}
          </span>
        ) : source ? (
          <>
            <span className="seg hz-kind" role="radiogroup" aria-label="The new track">
              {(["chords", "melody"] as const).map((k) => (
                <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => toKind(k)}>{k === "chords" ? "Chords" : "Melody"}</button>
              ))}
            </span>
            <span className="hz-with" title="Harmonize with" aria-hidden="true">≈</span>
            {sources.length > 1 ? (
              <select className="chip-select hz-src" aria-label="Harmonize with" value={from ?? ""} onChange={(e) => toSource(e.target.value)}>
                {sources.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            ) : (
              <span className="hz-src-now"><b>{srcName(from ?? "")}</b></span>
            )}
          </>
        ) : (
          <>
            <button className="chip" onClick={() => { onEmpty?.(); onClose(); }}>Empty</button>
            <span className="hz-with" title="Harmonize with" aria-hidden="true">≈</span>
            {sources.map((t) => (
              <button key={t.id} className={`chip${from === t.id ? " on" : ""}`} aria-pressed={from === t.id} aria-label={`Harmonize with ${t.name}`} onClick={() => toSource(t.id)}>
                {t.name}
              </button>
            ))}
          </>
        )}
        <button className="icon-btn hz-x" aria-label="Close" title="Close" onClick={onClose}>✕</button>
      </div>
      {from && (
        <>
          <div className="hz-opts" role="group" aria-label="With">{layered.map(chip)}</div>
          {instead.length > 0 && (
            <div className="hz-opts hz-instead" role="group" aria-label="Instead of it">
              <span className="hz-tag" title="Played instead of the chords: they are muted">Instead</span>
              {instead.map(chip)}
            </div>
          )}
          <div className="hz-foot">
            <span className="hz-hint">{opt?.hint ?? ""}</span>
            <button className="icon-btn" disabled={!option} aria-pressed={hearing && playing} aria-label={hearing && playing ? "Stop" : "Hear it in this section"} title={hearing && playing ? "Stop" : "Hear"} onClick={toggleHear}>{hearing && playing ? "■" : "▶"}</button>
            <button className="btn hz-keep" disabled={!option || !opt} aria-label={track ? "Write it again" : "Add this track"} onClick={keep}>{track ? "⟳" : "✓"}</button>
          </div>
        </>
      )}
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

/** Harmonize: opens the sheet that writes a new track to go with the one on the page (≈: goes with). */
export function HarmonizeButton({ on, onClick, title }: { on: boolean; onClick: (el: HTMLElement | null) => void; title: string }) {
  return (
    <button className={`chip hz-go${on ? " on" : ""}`} aria-expanded={on} aria-haspopup="dialog" title={title} onClick={(e) => onClick(e.currentTarget)}>
      <span aria-hidden="true">≈</span>Harmonize
    </button>
  );
}
