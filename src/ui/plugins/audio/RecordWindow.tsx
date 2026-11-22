// What is inside the record window: Record and Rehearse, the big readout (the count-in, then the pass being sung),
// ★ and K to keep a pass, the count-in and the click, the row of passes, and under them the take browser. Below
// that, how you hear yourself (straight from the interface, or through the effects) and how loud the song and the
// click are in the headphones.
//
// It has no lane of its own: the track's lane on the timeline is the only one, and the recording grows there. It
// owns nothing of the engine either (see ui/audio/useEngine): closing the window stops nothing. The interface, its
// buffer, every input's meter, the reminders and the timing nudge are in the settings, under Audio; the track's
// sound is its own window, behind its FX button.
import { useEffect, useRef, type ReactNode } from "react";
import { dbOf, haloOf, meterPos } from "../../../audio/levels";
import { countText, engineStatus, sessionNotes, type EngineApi } from "../../audio/useEngine";
import { EarIcon } from "../../icons";
import type { Studio } from "../../state";

/** What the window reads of the engine, and what it asks of it. */
export type RecordEngine = Pick<EngineApi, "desktop" | "hosts" | "devices" | "error" | "phase" | "pass" | "marks" | "flash" | "ready" | "monitor" | "record" | "rehearse" | "stop" | "mark" | "markNow">;

export interface RecordWindowProps {
  /** the track that is recorded onto: its name and its input (0 = Input 1); null = the song has no track that records */
  track: { id: string; name: string; input: number } | null;
  /** how many inputs can be chosen from */
  inputs: number;
  engine: RecordEngine;
  studio: Studio;
  setStudio(patch: Partial<Studio>): void;
  /** what a recording would go round, in words ("bars 1–4") */
  round: string;
  /** the window is on screen: its readouts are written only then */
  open: boolean;
  /** another input for the track */
  onInput(ch: number): void;
  /** the Audio part of the settings: the interface, its buffer, every input's meter */
  onSetup(): void;
  /** the take browser */
  children?: ReactNode;
}

export function RecordWindow({ track, inputs, engine, studio, setStudio, round, open, onInput, onSetup, children }: RecordWindowProps) {
  const { phase, pass, marks, flash, monitor } = engine;
  const desktop = engine.desktop;
  const running = phase !== "idle";
  const input = track?.input ?? 0;
  const count = Math.max(inputs, input + 1);

  // ── the readouts, written as the engine reports (nothing is drawn again for a report) ──
  const countRef = useRef<HTMLElement>(null);
  const warnRef = useRef<HTMLSpanElement>(null);
  const renderRef = useRef<HTMLSpanElement>(null);
  const meterRef = useRef<HTMLDivElement>(null);
  const hold = useRef(-Infinity);
  useEffect(() => {
    if (!open) return;
    hold.current = -Infinity;
    return engineStatus.subscribe((r) => {
      const st = r.st;
      const big = countText(r);
      if (countRef.current && countRef.current.textContent !== big) countRef.current.textContent = big;
      if (warnRef.current) {
        const notes = sessionNotes(r);
        if (warnRef.current.textContent !== notes.text) warnRef.current.textContent = notes.text;
        warnRef.current.classList.toggle("warn", notes.warn);
      }
      if (renderRef.current) renderRef.current.textContent = st?.render ? `${Math.round(st.render * 100)}%` : "";
      // the level of the track's own input, with its peak held for a moment
      const bar = meterRef.current;
      if (bar) {
        const db = dbOf(st?.peak[input] ?? 0);
        hold.current = st ? Math.max(db, hold.current - 0.6) : -Infinity;
        bar.style.setProperty("--lvl", String(meterPos(db)));
        bar.style.setProperty("--hold", String(meterPos(hold.current)));
        bar.dataset.halo = haloOf(db);
        const label = bar.querySelector<HTMLElement>(".vm-db");
        const text = Number.isFinite(hold.current) && hold.current > -60 ? `${hold.current.toFixed(0)} dB` : "—";
        if (label && label.textContent !== text) label.textContent = text;
      }
    });
  }, [open, input]);

  // the newest pass stays in view, unless the row was scrolled back to find an older one
  const rowRef = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  useEffect(() => {
    if (phase === "preparing") atEnd.current = true;
  }, [phase]);
  useEffect(() => {
    const el = rowRef.current;
    if (el && atEnd.current) el.scrollLeft = el.scrollWidth;
  }, [pass]);

  const checks = studio.checks ?? {};
  const none = !!engine.hosts && !engine.devices.length;
  const problem = engine.error ?? (none ? "No interface found" : null);
  return (
    <section className="rw vocals" aria-label="Record">
      {track ? (
        // the track is chosen on the timeline (its ● is lit there): here it is named, with the input it records
        <div className="rw-head">
          <b className="vc-track">{track.name}</b>
          <label className="vc-mini">Input
            <select aria-label={`Input of ${track.name}`} value={input} disabled={running} onChange={(e) => onInput(Number(e.target.value))}>
              {Array.from({ length: count }, (_, c) => <option key={c} value={c}>{c + 1}</option>)}
            </select>
          </label>
          {desktop && (
            <div className="rw-meter" ref={meterRef} data-halo="off" title={`How loud Input ${input + 1} is`}>
              <span className="vm-bar"><i className="vm-fill" /><i className="vm-hold" /><i className="vm-tick t24" /><i className="vm-tick t6" /></span>
              <span className="vm-db mono">—</span>
            </div>
          )}
        </div>
      ) : (
        <p className="small vc-note">Add a Vocals track to record on: the + row under the tracks.</p>
      )}

      {!desktop && <p className="small vc-note">Recording: in the desktop app.</p>}

      {desktop && track && (
        <div className="vc-rec">
          <button className={`rec-btn${phase === "recording" ? " on" : ""}`} aria-label={phase === "recording" ? "Stop recording" : "Record"} title={phase === "recording" ? "Stop" : "Record take after take over the loop, after a count-in"} disabled={!engine.ready || phase === "preparing" || phase === "saving" || phase === "rehearsing"} onClick={() => (phase === "recording" ? engine.stop() : engine.record())}>{phase === "recording" ? "■" : "●"}</button>
          <button className="btn sm" disabled={!engine.ready || phase === "preparing" || phase === "saving" || phase === "recording"} onClick={() => (phase === "rehearsing" ? engine.stop() : engine.rehearse())} title="Sing along over the loop without recording" aria-label={phase === "rehearsing" ? "Stop" : "Rehearse: sing over the loop without recording"}>{phase === "rehearsing" ? "■" : <><EarIcon /> ▶</>}</button>
          <span className="vc-state">
            <b ref={countRef} className="vc-count" />
            <span className="small muted vc-sub">{phase === "preparing" || phase === "saving" ? <>{phase === "preparing" ? "Preparing… " : "Saving… "}<span ref={renderRef} /></> : phase === "idle" ? `↻ ${round || "—"}` : <span ref={warnRef} className="vc-warn" />}</span>
          </span>
          {/* always in its place (hidden until recording), so nothing shifts when recording starts */}
          {/* the same as K: a press a moment after a seam keeps the pass just sung; a pass is let go from the row below */}
          <button className={`vc-star${marks.has(pass) ? " on" : ""}`} style={phase === "recording" ? undefined : { visibility: "hidden" }} disabled={phase !== "recording" || !pass} aria-pressed={marks.has(pass)} aria-label="Keep this pass (K)" title="Keep this pass ★ (K). In the first moments of a pass, the one just sung" onClick={engine.markNow}>★</button>
          <span className="spacer" />
          <label className="vc-mini">Count-in
            <select value={studio.countIn ?? 1} disabled={running} onChange={(e) => setStudio({ countIn: Number(e.target.value) as 0 | 1 | 2 })}>
              <option value={0}>None</option><option value={1}>1 bar</option><option value={2}>2 bars</option>
            </select>
          </label>
          <label className="toggle vc-mini"><input type="checkbox" checked={!!studio.clickOn} onChange={(e) => setStudio({ clickOn: e.target.checked })} /> Click</label>
        </div>
      )}
      {desktop && problem && (
        <div className="rw-problem small" role="status">
          <span className="vc-err">{problem}</span>
          <button className="btn sm" onClick={onSetup}>Audio setup…</button>
        </div>
      )}
      {desktop && phase === "recording" && (
        // every pass sung so far, and the one being sung: tap to keep ★. One row that scrolls, never grows.
        <div className="vc-passes" ref={rowRef} role="group" aria-label="Passes: tap to keep" onScroll={(e) => { const el = e.currentTarget; atEnd.current = el.scrollWidth - el.scrollLeft - el.clientWidth < 60; }}>
          {Array.from({ length: pass }, (_, i) => i + 1).map((n) => (
            <button key={n} className={`vc-pass${marks.has(n) ? " on" : ""}${n === pass ? " sing" : ""}${flash === n ? " just" : ""}`} aria-pressed={marks.has(n)} aria-label={`Pass ${n}${n === pass ? ", being sung" : ""}`} onClick={() => engine.mark(n)}>
              {marks.has(n) ? "★" : ""}{n}
            </button>
          ))}
        </div>
      )}

      {/* the takes, right under: what was just sung is the first thing to hear */}
      {children}

      {desktop && (
        <div className="rw-hear" role="group" aria-label="What you hear while recording">
          <b className="vc-title">Monitor</b>
          <span className="seg" role="radiogroup" aria-label="Hearing yourself">
            <button role="radio" aria-checked={!monitor} className={!monitor ? "on" : ""} title="You hear yourself straight from the interface, dry" onClick={() => setStudio({ monitor: "hardware" })}>Direct</button>
            <button role="radio" aria-checked={monitor} className={monitor ? "on" : ""} title="You hear yourself through the track's effects" onClick={() => setStudio({ monitor: "effects" })}>Effects</button>
          </span>
          <label className="vc-mini" title="How loud the song is in the headphones while recording">Song <input type="range" min={0} max={1.5} step={0.05} value={studio.backing ?? 1} onChange={(e) => setStudio({ backing: Number(e.target.value) })} /></label>
          <label className="vc-mini" title="How loud the click is in the headphones">Click <input type="range" min={0} max={1.5} step={0.05} value={studio.click ?? 0.5} onChange={(e) => setStudio({ click: Number(e.target.value) })} /></label>
          {monitor && checks.direct && <span className="small vc-err">Direct Monitor is on too: you hear yourself twice</span>}
        </div>
      )}
    </section>
  );
}
