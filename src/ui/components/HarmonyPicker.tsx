/**
 * Harmonize: a new chords or melody track written to go with a track of the song.
 *
 * The sheet first asks what the new track goes with (or Empty, for a plain track), then offers
 * the harmony options for that track (song/harmony, theory/harmonize): the ones that would write
 * nothing in this song are greyed, and the ones that replace the source rather than play with it
 * stand apart. Tapping an option plays the section on screen, round and round, with that option
 * added; tapping another swaps it straight away. ✓ keeps it, in every section.
 *
 * The same sheet writes an existing harmony track again (from its track head): with another
 * option, or the same one after its source changed. Sections changed by hand since are only
 * written over after a yes.
 */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { addHarmony, harmonyMenu, harmonySources, harmonyState, optionOf, rewriteHarmony, type HarmonyPlan } from "../../song/harmony";
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
 * The sheet. With `track` it writes that harmony track again; without, it makes a new track of
 * `kind` (Empty calls `onEmpty`).
 */
export function HarmonyPicker({ kind, track, onEmpty, onClose, onAdded }: {
  kind: "chords" | "melody";
  track?: Track;
  onEmpty?: () => void;
  onClose: () => void;
  /** a harmony track was added (its name) */
  onAdded?: (name: string) => void;
}) {
  const { state, set, toast } = useApp();
  const { preview, hear, playing } = useContext(AuditionCtx);
  const p = state.progression;
  const [id] = useState(() => track?.id ?? newId());
  const [from, setFrom] = useState<string | null>(track?.harmony?.from ?? null);
  const [option, setOption] = useState<string | null>(track?.harmony?.option ?? null);
  const sources = useMemo(() => harmonySources(p), [p]);
  const menu = useMemo(() => (from ? harmonyMenu(p, state.key, kind, from, id) : []), [p, state.key, kind, from, id]);
  const status = useMemo(() => (track ? harmonyState(p, state.key, track.id) : null), [track, p, state.key]);
  const hearing = !!preview && preview.id === id;
  const opt = option ? optionOf(kind, option) : undefined;

  // the sheet goes: the audition stops and the loop is put back
  useEffect(() => () => hear(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const pick = (o: string) => {
    setOption(o);
    if (from) hear({ plan: { kind, from, option: o }, id });
  };
  const toggleHear = () => {
    if (hearing && playing) hear(null);
    else if (from && option) hear({ plan: { kind, from, option }, id });
  };
  /** Keep it: add the track, or write it again; either can be taken back while nothing else has changed. */
  const keep = () => {
    if (!from || !option || !opt) return;
    const before = state.progression;
    const key = state.key;
    let after: typeof before;
    let msg: string;
    if (track) {
      if (status?.edited.length && !window.confirm(`${track.name} was changed by hand in ${status.edited.join(", ")}. Write over it?`)) return;
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
  return (
    <div className="hz-sheet" role="dialog" aria-label={track ? `Write ${track.name} again` : `New ${KIND_WORD[kind]} track`}>
      <div className="hz-row">
        {track ? (
          <span className="hz-src-now" title={`Written from ${srcName(track.harmony?.from ?? "")}`}>
            <b>{track.name}</b> ≈ {srcName(track.harmony?.from ?? "")}
            {status?.stale && <i className="hz-dot" aria-label="Its source has changed" title="Its source has changed" />}
          </span>
        ) : (
          <>
            <button className="chip" onClick={() => { onEmpty?.(); onClose(); }}>Empty</button>
            <span className="hz-with" title="Harmonize with" aria-hidden="true">≈</span>
            {sources.map((t) => (
              <button key={t.id} className={`chip${from === t.id ? " on" : ""}`} aria-pressed={from === t.id} aria-label={`Harmonize with ${t.name}`} onClick={() => { setFrom(t.id); setOption(null); hear(null); }}>
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
