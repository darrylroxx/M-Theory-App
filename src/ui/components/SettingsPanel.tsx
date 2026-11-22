import { useEffect, useRef, useState } from "react";
import { dbOf, haloOf, meterPos } from "../../audio/levels";
import { appInfo } from "../../desktop";
import { TUNINGS } from "../../guitar/tunings";
import { delayText, dropoutText, engineStatus, type EngineApi } from "../audio/useEngine";
import "../plugins/audio/audio.css";
import { useApp, type Studio } from "../state";
import { Seg } from "./common";
import { AudioSetup } from "./Desktop";

/** Which part of the settings is shown. */
export type SettingsPart = "guitar" | "audio";

/**
 * What the Audio part is handed by the host of the track view: the recording engine (it is kept open while this part
 * is on screen, as it is for the record window), and the two things that are the song's to do.
 */
export interface AudioSettings {
  engine: EngineApi;
  /** the timing nudge changed: every take moves */
  setNudge(ms: number): void;
  /** the track the engine listens to now: its name and its input (0 = Input 1; `pair`: that input and the next); null = the song has no track that records */
  track: { name: string; input: number; pair?: boolean } | null;
}

/**
 * The settings sheet. Without `audio` it is the guitar's setup, with the list of interfaces under it, as the old
 * view shows it. With `audio` (the track view) it has two parts, Guitar and Audio; `part` says which is shown and
 * `onPart` is told when the other is picked.
 */
export function SettingsPanel({ onClose, audio, part = "guitar", onPart }: { onClose: () => void; audio?: AudioSettings; part?: SettingsPart; onPart?: (p: SettingsPart) => void }) {
  const { state, set } = useApp();
  const st = state.settings;
  const upd = (patch: Partial<typeof st>) => set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const shown: SettingsPart = audio ? part : "guitar";
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{audio ? "Settings" : "Guitar setup"}</h2>
          {audio && <Seg label="Which settings" value={shown} options={[{ value: "guitar", label: "Guitar" }, { value: "audio", label: "Audio" }]} onChange={(v) => onPart?.(v)} />}
          <button className="icon-btn sheet-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="stack">
          {shown === "guitar" && (
            <>
              <label className="toggle"><input type="checkbox" checked={st.avoidBarre} onChange={(e) => upd({ avoidBarre: e.target.checked })} /> Avoid barre chords</label>
              <label className="field">Tuning
                <select value={st.tuningId} onChange={(e) => upd({ tuningId: e.target.value })}>
                  {TUNINGS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className="field">Capo
                <select value={st.capo} onChange={(e) => upd({ capo: Number(e.target.value) })}>
                  {Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{i === 0 ? "No capo" : `Fret ${i}`}</option>)}
                </select>
              </label>
              <div className="row">
                <span className="filter-label">Dots</span>
                <Seg value={st.labels} options={[{ value: "fingers", label: "Fingers" }, { value: "notes", label: "Notes" }, { value: "intervals", label: "Intervals" }]} onChange={(v) => upd({ labels: v })} />
              </div>
              <div className="row">
                <span className="filter-label">Theme</span>
                <Seg value={st.theme} options={[{ value: "auto", label: "Auto" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} onChange={(v) => upd({ theme: v })} />
              </div>
              <label className="toggle"><input type="checkbox" checked={st.leftHanded} onChange={(e) => upd({ leftHanded: e.target.checked })} /> Left-handed diagrams</label>
              {!audio && <AudioSetup />}
            </>
          )}
          {shown === "audio" && audio && <AudioPart {...audio} />}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const CHECKS: { id: keyof NonNullable<Studio["checks"]>; label: string; hint: string }[] = [
  { id: "phantom", label: "48V on", hint: "Only for condenser mics. Dynamic mics (like most stage mics) do not need it" },
  { id: "air", label: "Air on", hint: "Optional: a brighter, more open top end, built into the recording" },
  { id: "inst", label: "INST off", hint: "INST is for a guitar plugged into Input 2. For a mic on Input 1 it does nothing" },
  { id: "direct", label: "Direct Monitor on", hint: "On: you hear yourself straight from the interface, dry. Off: you hear yourself through the app's effects" },
];
const BUFFERS = [32, 48, 64, 96, 128, 192, 256, 512];
/** The engine reports the level of this many inputs at least (more when it says so). */
const METERS = 8;

/**
 * The Audio part of the settings: the interface and its buffer, the delay the driver measures and the dropouts it
 * counts, a meter for every input, how loud the song and the click are in the headphones, the reminders of the
 * interface's own switches, and the timing nudge. The interface is open while this part is on screen and the app is
 * quiet, exactly as for the record window.
 */
export function AudioPart({ engine, setNudge, track }: AudioSettings) {
  const { state, set } = useApp();
  const studio = state.studio ?? {};
  const setStudio = (patch: Partial<Studio>) => set((s) => ({ ...s, studio: { ...s.studio, ...patch } }));
  const { hosts, devices, chosen, opened, error } = engine;
  const running = engine.phase !== "idle";
  const checks = studio.checks ?? {};
  const [version, setVersion] = useState("");
  useEffect(() => {
    if (engine.desktop) void appInfo().then((i) => i && setVersion(`${i.name} ${i.version}`));
  }, [engine.desktop]);

  // ── the readouts, written as the engine reports ──
  const barsRef = useRef<HTMLDivElement>(null);
  const blockRef = useRef<HTMLSpanElement>(null);
  const dropRef = useRef<HTMLSpanElement>(null);
  const slowRef = useRef<HTMLSpanElement>(null);
  const hold = useRef<number[]>([]);
  const drops = useRef({ n: 0, at: 0 });
  /** how many inputs the engine reports a level for */
  const [metered, setMetered] = useState(METERS);
  useEffect(() => {
    hold.current = [];
    return engineStatus.subscribe((r) => {
      const st = r.st;
      if (st && st.peak.length > METERS) setMetered((n) => (n === st.peak.length ? n : st.peak.length));
      barsRef.current?.querySelectorAll<HTMLElement>("[data-ch]").forEach((bar) => {
        const c = Number(bar.dataset.ch);
        const db = dbOf(st?.peak[c] ?? 0);
        hold.current[c] = st ? Math.max(db, (hold.current[c] ?? -Infinity) - 0.6) : -Infinity;
        bar.style.setProperty("--lvl", String(meterPos(db)));
        bar.style.setProperty("--hold", String(meterPos(hold.current[c])));
        bar.dataset.halo = haloOf(db);
        const label = bar.querySelector<HTMLElement>(".vm-db");
        const text = Number.isFinite(hold.current[c]) && hold.current[c] > -60 ? `${hold.current[c].toFixed(0)} dB` : "—";
        if (label && label.textContent !== text) label.textContent = text;
      });
      // dropouts: the computer could not keep up at this buffer size
      if (st && st.xruns !== drops.current.n) drops.current = { n: st.xruns, at: performance.now() };
      if (blockRef.current) blockRef.current.textContent = delayText(r);
      if (dropRef.current && st) dropRef.current.textContent = dropoutText(st);
      if (slowRef.current) slowRef.current.hidden = !(st && st.xruns && performance.now() - drops.current.at < 6000);
    });
  }, []);

  if (!engine.desktop)
    // a browser: the microphone as the browser gives it. The one setting is where its takes land
    return (
      <section className="au" aria-label="Audio">
        <div className="au-box">
          <b className="vc-title">Microphone</b>
          <span className="small muted">In a browser, a track records the microphone the browser offers (it asks the first time). The interface, its inputs and pairs, monitoring and the vocal sound are in the desktop app.</span>
          <label className="vc-mini" title="A browser does not say how long the sound takes to come in through the microphone. If takes sound late, raise this; early, lower it. The takes already in this song move too">Timing nudge <input type="number" step={1} value={studio.nudge ?? 0} disabled={running} onChange={(e) => setNudge(Number(e.target.value) || 0)} /> ms</label>
        </div>
      </section>
    );
  /** the inputs the engine's track records: one, or the two of a pair */
  const mine = (c: number) => !!track && (c === track.input || (!!track.pair && c === track.input + 1));
  const inputs = Math.min(opened?.inputs ?? chosen?.channels ?? 2, Math.max(METERS, metered));
  /** closed only because the app is sounding */
  const resting = !!chosen && !opened && !error;
  return (
    <section className="au" aria-label="Audio">
      <div className="au-box">
        <div className="row"><b className="vc-title">Interface</b><span className="spacer" /><button className="btn sm" title="Look for the interfaces again (after plugging one in)" disabled={!hosts || running} onClick={engine.relist}>Look again</button></div>
        {!hosts && <span className="small muted">Looking…</span>}
        {hosts && !devices.length && <span className="small vc-err">No interface found. Plug it in, install its driver from its maker, then press Look again.</span>}
        {devices.length > 0 && (
          <select aria-label="Record from" disabled={running} value={chosen ? `${chosen.host}|${chosen.name}` : ""} onChange={(e) => { const [host, ...rest] = e.target.value.split("|"); setStudio({ host, device: rest.join("|") }); }}>
            {devices.map((d) => <option key={`${d.host}|${d.name}`} value={`${d.host}|${d.name}`}>{d.name} ({d.host})</option>)}
          </select>
        )}
        {opened && <span className="tiny muted">{opened.inputs} in · {opened.outputs} out · {opened.rate / 1000} kHz · <span ref={dropRef} title="Each dropout is a moment the computer could not keep up: a click or crackle">no dropouts</span></span>}
        {resting && hosts && <span className="tiny muted">Closed while the app plays: it opens again a moment after the sound stops.</span>}
        <label className="vc-mini" title="How much sound the computer handles at a time. Smaller: you hear yourself sooner. Too small: crackles and dropouts">Buffer
          <select value={studio.buffer ?? ""} disabled={running} onChange={(e) => setStudio({ buffer: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Driver's setting</option>
            {BUFFERS.filter((b) => (opened?.min_buffer ?? 0) <= b && b <= (opened?.max_buffer ?? 4096)).map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <span ref={blockRef} className="tiny muted" title="Measured from the driver: from your voice reaching the interface to hearing it in your headphones" />
        </label>
        <span ref={slowRef} className="small vc-err" hidden>Dropouts: raise the buffer</span>
        {error && <span className="small vc-err">{error}</span>}
      </div>

      <div className="au-box">
        <b className="vc-title">Inputs</b>
        <div className="vc-meters" ref={barsRef}>
          {Array.from({ length: inputs }, (_, c) => (
            <div key={c} className={`vm${mine(c) ? " mine" : ""}`} data-ch={c} data-halo="off" title={mine(c) && track ? `${track.name} records this input` : undefined}>
              <span className="vm-name">Input {c + 1}{inputs === 2 && <small>{c === 0 ? "mic" : "inst / line"}</small>}</span>
              <span className="vm-bar"><i className="vm-fill" /><i className="vm-hold" /><i className="vm-tick t24" /><i className="vm-tick t6" /></span>
              <span className="vm-db mono">—</span>
            </div>
          ))}
        </div>
        {track && <span className="tiny muted">{track.name} records {track.pair ? `Inputs ${track.input + 1} and ${track.input + 2}, in stereo` : `Input ${track.input + 1}`}. A track's input is chosen on its panel.</span>}
      </div>

      <div className="au-box">
        <b className="vc-title">Headphone mix</b>
        <div className="vc-mix">
          <label className="vc-mini" title="How loud the song is in the headphones while recording">Song <input type="range" min={0} max={1.5} step={0.05} value={studio.backing ?? 1} onChange={(e) => setStudio({ backing: Number(e.target.value) })} /></label>
          <label className="vc-mini" title="How loud the click is in the headphones">Click <input type="range" min={0} max={1.5} step={0.05} value={studio.click ?? 0.5} onChange={(e) => setStudio({ click: Number(e.target.value) })} /></label>
        </div>
      </div>

      <div className="au-box">
        <b className="vc-title">On the interface</b>
        <span className="tiny muted">Its own switches, as you have set them: the app cannot read them.</span>
        <div className="au-checks">
          {CHECKS.map((c) => <label key={c.id} className="toggle" title={c.hint}><input type="checkbox" checked={!!checks[c.id]} onChange={(e) => setStudio({ checks: { ...checks, [c.id]: e.target.checked } })} /> {c.label}</label>)}
        </div>
        {engine.monitor && checks.direct && <span className="small vc-err">Direct Monitor is on too: you hear yourself twice</span>}
        <label className="vc-mini" title="Takes are lined up using the delay the driver reports. If they sound late, raise this; early, lower it. The takes already in this song move too">Timing nudge <input type="number" step={0.5} value={studio.nudge ?? 0} onChange={(e) => setNudge(Number(e.target.value) || 0)} /> ms</label>
      </div>

      {hosts && (
        <details className="small">
          <summary>Everything the computer sees</summary>
          <ul className="audio-list">
            {hosts.map((h) => (
              <li key={h.name}><b>{h.name}</b>{h.error ? <span className="muted"> — {h.error}</span> : null}
                <ul>{h.devices.map((d, i) => <li key={i}>{d.name} <span className="muted">· {d.input?.channels ?? 0} in / {d.output?.channels ?? 0} out{d.default_rate ? ` · ${d.default_rate / 1000} kHz` : ""}</span></li>)}</ul>
              </li>
            ))}
          </ul>
        </details>
      )}
      {version && <p className="tiny muted">{version}</p>}
    </section>
  );
}
