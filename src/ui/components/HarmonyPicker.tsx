/**
 * Harmonize: a new chords or melody track written to go with a track of the song.
 *
 * It asks one thing: which track to harmonize with (every chords and melody track that has some
 * music, the one on screen first). Then it offers the harmonies for that track, best first, as
 * music theory ranks them (song/harmony, theory/harmonize), only those that give something in
 * this song. The new track is the page's kind: harmonized on the Chords page it is chords, on the
 * Melody page a melody line. Tapping an option plays the section on screen, round and round,
 * with that option added; tapping another swaps it straight away. ✓ keeps it, in every section.
 * Nothing about how it sounds is chosen: it starts as a plain track, like any new one.
 *
 * The same sheet writes an existing harmony track again (from its ⟳): with another option, or
 * the same one after its source changed. Sections changed by hand since are only written over
 * after a yes.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { addHarmony, harmonizeSources, harmonyMenu, harmonySources, harmonyState, isHarmony, rewriteHarmony, type HarmonyPlan } from "../../song/harmony";
import { sameMusic } from "../../song/library";
import { allTracks, type Track } from "../../song/tracks";
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
  const [id] = useState(() => track?.id ?? newId());
  const [top] = useState(() => first ?? kind);
  const sources = useMemo(() => (track ? [] : harmonizeSources(p, top)), [track, p, top]);
  // one track with music: there is only one answer, so it is already chosen
  const [picked, setPicked] = useState<string | null>(() => track?.harmony?.from ?? (sources.length === 1 ? sources[0].id : null));
  const [option, setOption] = useState<string | null>(track?.harmony?.option ?? null);
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
  const menu = useMemo(() => (from ? harmonyMenu(p, state.key, newKind, from, id, track?.harmony?.option) : []), [p, state.key, newKind, from, id, track]);
  const status = useMemo(() => (track ? harmonyState(p, state.key, track.id) : null), [track, p, state.key]);
  const hearing = !!preview && preview.id === id;
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
    let firstTime = true;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      root.setProperty("--hz-sheet-h", `${h}px`);
      // the button that opened it stays in sight, just above the sheet
      if (firstTime && anchor?.isConnected) {
        anchor.style.scrollMarginBottom = `${h + 24}px`;
        const r = anchor.getBoundingClientRect();
        if (r.bottom > window.innerHeight - h - 16 || r.top < 0) anchor.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      firstTime = false;
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
    if (from) hear({ plan: { kind: newKind, from, option: o }, id });
  };
  const toggleHear = () => {
    if (hearing && playing) hear(null);
    else if (from && option) hear({ plan: { kind: newKind, from, option }, id });
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
      after = rewriteHarmony(before, key, track.id, option);
      msg = `${after.tracks?.find((t) => t.id === track.id)?.name ?? track.name} ⟳`;
    } else {
      const r = addHarmony(before, key, { kind: newKind, from, option }, id);
      if (!r.track) return;
      after = r.p;
      const muted = item.instead && after.mix?.[item.instead]?.mute ? item.instead : undefined;
      msg = `${r.track.name} added${muted ? `, ${nameOf(muted)} muted` : ""}`;
    }
    hear(null);
    set((s) => ({ ...s, progression: s.progression === before ? after : s.progression }));
    const still = (s: AppState) => s.key.tonic === key.tonic && s.key.scaleId === key.scaleId && sameMusic(s.progression, after);
    toast(msg, { label: "↶", aria: "Undo", when: still, run: () => set((s) => (still(s) ? { ...s, progression: before } : s)) });
    onClose();
  };

  const hint = item ? `${item.hint}.${item.instead ? ` Plays instead of ${nameOf(item.instead)}.` : ""}` : "";
  const srcName = track ? harmonySources(p).find((t) => t.id === track.harmony?.from)?.name ?? "" : "";
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
            <span className="hz-q">Harmonize with</span>
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
              {menu.map((x) => (
                <button key={x.option.id} className={`chip hz-opt${option === x.option.id ? " on" : ""}${track?.harmony?.option === x.option.id ? " now" : ""}`} aria-pressed={option === x.option.id} title={x.hint} onClick={() => pick(x.option.id)}>
                  {x.label}
                </button>
              ))}
            </div>
          ) : (
            <span className="hz-none">Nothing to add to {nameOf(from)} yet</span>
          )}
          <div className="hz-foot">
            <span className="hz-hint">{hint}</span>
            <button className="icon-btn" disabled={!option} aria-pressed={hearing && playing} aria-label={hearing && playing ? "Stop" : "Hear it"} title={hearing && playing ? "Stop" : "Hear it"} onClick={toggleHear}>{hearing && playing ? "■" : "▶"}</button>
            {track ? (
              <button className="btn hz-keep" disabled={!item} aria-label="Write it again" title="Write it again" onClick={keep}>⟳</button>
            ) : (
              <button className="btn hz-keep" disabled={!item} aria-label="Keep it" title="Keep as a new track" onClick={keep}>✓</button>
            )}
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

/** Harmonize: opens the sheet that asks which track to harmonize with (≈: goes with). */
export function HarmonizeButton({ on, onClick }: { on: boolean; onClick: (el: HTMLElement | null) => void }) {
  return (
    <button className={`chip hz-go${on ? " on" : ""}`} aria-expanded={on} aria-haspopup="dialog" title="Harmonize with a track" onClick={(e) => onClick(e.currentTarget)}>
      <span aria-hidden="true">≈</span>Harmonize
    </button>
  );
}
