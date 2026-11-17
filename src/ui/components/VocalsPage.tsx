import { useEffect, useRef, useState } from "react";
import { dbOf, haloOf, meterPos } from "../../audio/levels";
import { audioDevices, isDesktop, meterStart, meterStop, type AudioHost, type Opened } from "../../desktop";
import { addTrack, renameTrack, tracksOf } from "../../song/tracks";
import { newId, useApp, type Studio } from "../state";


const CHECKS: { id: keyof NonNullable<Studio["checks"]>; label: string; hint: string }[] = [
  { id: "phantom", label: "48V on", hint: "Only for condenser mics. Dynamic mics (like most stage mics) do not need it" },
  { id: "air", label: "Air on", hint: "Optional: a brighter, more open top end, built into the recording" },
  { id: "inst", label: "INST off", hint: "INST is for a guitar plugged into Input 2. For a mic on Input 1 it does nothing; for a keyboard or line source on Input 2, leave it off" },
  { id: "direct", label: "Direct Monitor", hint: "On: you hear yourself straight from the interface, with no delay and no effects. Off: you hear yourself through the app's effects" },
];

/**
 * Vocals: the vocal tracks, the interface they record from and how loud each input is right now.
 * The meter runs in the Windows app, straight from the interface's ASIO driver.
 */
export function VocalsPage({ active }: { active: boolean }) {
  const { state, set, toast } = useApp();
  const studio = state.studio ?? {};
  const setStudio = (patch: Partial<Studio>) => set((s) => ({ ...s, studio: { ...s.studio, ...patch } }));
  const vocals = tracksOf(state.progression, "vocals");
  const [sel, setSel] = useState<string | null>(null);
  const track = vocals.find((t) => t.id === sel) ?? vocals[0];
  const desktop = isDesktop();

  const [hosts, setHosts] = useState<AudioHost[] | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [error, setError] = useState<string | null>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const hold = useRef<number[]>([]);

  // the devices that can record: ASIO first (the interface's own driver), then the rest
  useEffect(() => {
    if (!desktop || !active) return;
    void audioDevices().then(setHosts);
  }, [desktop, active]);
  const inputs = (hosts ?? []).flatMap((h) => h.devices.filter((d) => (d.input?.channels ?? 0) > 0).map((d) => ({ host: h.name, name: d.name, channels: d.input!.channels })))
    .sort((a, b) => Number(b.host.toUpperCase() === "ASIO") - Number(a.host.toUpperCase() === "ASIO") || Number(/focusrite|scarlett/i.test(b.name)) - Number(/focusrite|scarlett/i.test(a.name)));
  const chosen = inputs.find((d) => d.host === studio.host && d.name === studio.device) ?? inputs[0];

  // the meter runs while this page is on screen
  useEffect(() => {
    if (!desktop || !active || !chosen) return;
    let live = true;
    setError(null);
    meterStart(chosen.host, chosen.name, (l) => {
      const el = barsRef.current;
      if (!el || !live) return;
      el.querySelectorAll<HTMLElement>("[data-ch]").forEach((bar) => {
        const c = Number(bar.dataset.ch);
        const db = dbOf(l.peak[c] ?? 0);
        hold.current[c] = Math.max(db, (hold.current[c] ?? -Infinity) - 0.6);
        bar.style.setProperty("--lvl", String(meterPos(db)));
        bar.style.setProperty("--hold", String(meterPos(hold.current[c])));
        bar.dataset.halo = haloOf(db);
        const label = bar.querySelector<HTMLElement>(".vm-db");
        if (label) label.textContent = Number.isFinite(hold.current[c]) && hold.current[c] > -60 ? `${hold.current[c].toFixed(0)} dB` : "—";
      });
    }).then((o) => live && setOpened(o)).catch((e) => live && (setOpened(null), setError(String(e))));
    return () => { live = false; void meterStop(); };
  }, [desktop, active, chosen?.host, chosen?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => {
    const id = newId();
    set((s) => ({ ...s, progression: addTrack(s.progression, "vocals", id).p }));
    setSel(id);
  };
  const setInput = (input: 1 | 2) => track && set((s) => ({ ...s, progression: { ...s.progression, tracks: (s.progression.tracks ?? []).map((t) => (t.id === track.id ? { ...t, input } : t)) } }));
  const rename = () => {
    if (!track) return;
    const name = window.prompt("Name this vocal track", track.name);
    if (name) set((s) => ({ ...s, progression: renameTrack(s.progression, track.id, name) }));
  };
  const channels = Math.min(2, opened?.channels ?? chosen?.channels ?? 2);
  const checks = studio.checks ?? {};
  const monitor = studio.monitor ?? "hardware";

  return (
    <section className="card vocals" aria-label="Vocals">
      <div className="dm-head">
        <h2>Vocals</h2>
        {vocals.length > 0 && (
          <span className="seg" role="radiogroup" aria-label="Vocal track">
            {vocals.map((t) => <button key={t.id} role="radio" aria-checked={track?.id === t.id} className={track?.id === t.id ? "on" : ""} onClick={() => setSel(t.id)} onDoubleClick={rename}>{t.name}</button>)}
          </span>
        )}
        <span className="spacer" />
        <button className="btn sm" onClick={add}>+ Vocal track</button>
      </div>

      {!vocals.length && <p className="small muted">No vocal track yet. Add one here, or with + Add track on the Track page.</p>}

      {!desktop && <p className="small vc-note">Recording works in the Windows app (M-Theory for Windows), which talks to the audio interface directly. This version can plan the song around the vocals.</p>}

      {desktop && (
        <div className="vc-grid">
          <div className="vc-box">
            <b className="vc-title">Interface</b>
            {!hosts && <span className="small muted">Looking…</span>}
            {hosts && !inputs.length && <span className="small">No input found. Plug in the interface and install the Focusrite USB ASIO driver from focusrite.com.</span>}
            {inputs.length > 0 && (
              <select aria-label="Record from" value={chosen ? `${chosen.host}|${chosen.name}` : ""} onChange={(e) => { const [host, ...rest] = e.target.value.split("|"); setStudio({ host, device: rest.join("|") }); }}>
                {inputs.map((d) => <option key={`${d.host}|${d.name}`} value={`${d.host}|${d.name}`}>{d.name} ({d.host})</option>)}
              </select>
            )}
            {opened && <span className="tiny muted">{opened.channels} inputs · {opened.sample_rate / 1000} kHz · {opened.format}</span>}
            {error && <span className="small vc-err">{error}</span>}
            <div className="vc-meters" ref={barsRef}>
              {Array.from({ length: channels }, (_, c) => (
                <div key={c} className={`vm${track?.input === c + 1 ? " mine" : ""}`} data-ch={c} data-halo="off">
                  <button className="vm-name" aria-pressed={track?.input === c + 1} title={track ? `Record ${track.name} from Input ${c + 1}` : undefined} disabled={!track} onClick={() => setInput((c + 1) as 1 | 2)}>Input {c + 1}<small>{c === 0 ? "mic" : "inst / line"}</small></button>
                  <span className="vm-bar"><i className="vm-fill" /><i className="vm-hold" /><i className="vm-tick t24" /><i className="vm-tick t6" /></span>
                  <span className="vm-db mono">—</span>
                </div>
              ))}
            </div>
            <span className="tiny muted">Sing at your loudest and set the gain on the interface so the meter stays green and only touches amber. Red is clipping.</span>
          </div>

          <div className="vc-box">
            <b className="vc-title">On the interface</b>
            <span className="tiny muted">No software can read these switches. Tick them as you have them set.</span>
            {CHECKS.map((c) => (
              <label key={c.id} className="toggle" title={c.hint}><input type="checkbox" checked={!!checks[c.id]} onChange={(e) => setStudio({ checks: { ...checks, [c.id]: e.target.checked } })} /> {c.label}</label>
            ))}
            <b className="vc-title">Hearing yourself</b>
            <span className="seg" role="radiogroup" aria-label="Hearing yourself">
              <button role="radio" aria-checked={monitor === "hardware"} className={monitor === "hardware" ? "on" : ""} onClick={() => setStudio({ monitor: "hardware" })}>Direct Monitor</button>
              <button role="radio" aria-checked={monitor === "effects"} className={monitor === "effects" ? "on" : ""} onClick={() => { setStudio({ monitor: "effects" }); toast("Live effects come with the recording engine, in the next draft"); }}>Through my effects</button>
            </span>
            {monitor === "effects" && checks.direct && <span className="small vc-err">Turn Direct Monitor off on the interface, or you will hear yourself twice.</span>}
            {monitor === "hardware" && !checks.direct && <span className="small muted">Press Direct Monitor on the interface to hear yourself.</span>}
          </div>
        </div>
      )}

      <div className="vc-rec">
        <button className="rec-btn" disabled title="Recording comes in the next draft: count-in, loop takes, live effects">●</button>
        <span className="small muted">Recording, with a count-in and take after take over a loop, comes in the next draft. This one sets up the interface and checks the levels.</span>
      </div>
    </section>
  );
}
