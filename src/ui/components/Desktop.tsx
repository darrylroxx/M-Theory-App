import { useEffect, useState } from "react";
import { appInfo, audioDevices, checkUpdate, isDesktop, type AudioHost, type Update } from "../../desktop";

/** In the desktop app: a slim bar when a new version is ready, with one button to install it. */
export function UpdateBar() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!isDesktop()) return;
    let live = true;
    // when the app opens and a new version is waiting, it is installed straight away (nothing is in progress yet)
    void checkUpdate().then((u) => {
      if (!live || !u) return;
      setUpdate(u);
      setBusy("Updating…");
      u.install((done, total) => setBusy(total ? `Updating… ${Math.round((done / total) * 100)}%` : "Updating…")).catch(() => setBusy(null));
    });
    // while it stays open, a new version is only offered, so nothing restarts in the middle of a take
    const look = () => void checkUpdate().then((u) => live && u && setUpdate(u));
    // look again every half hour while the app stays open
    const t = window.setInterval(look, 30 * 60 * 1000);
    return () => { live = false; window.clearInterval(t); };
  }, []);
  if (!update) return null;
  const go = async () => {
    setBusy("Downloading…");
    try {
      await update.install((done, total) => setBusy(total ? `Downloading… ${Math.round((done / total) * 100)}%` : "Downloading…"));
    } catch {
      setBusy(null);
    }
  };
  return (
    <div className="update-bar" role="status">
      <span>Version {update.version} is ready.{update.notes ? <small> {update.notes}</small> : null}</span>
      <button className="btn sm primary" disabled={!!busy} onClick={go}>{busy ?? "Update and restart"}</button>
      {!busy && <button className="icon-btn" aria-label="Later" title="Later" onClick={() => setUpdate(null)}>✕</button>}
    </div>
  );
}

/** "Draft" next to the name in the draft app, so the two installed apps are never mixed up. */
export function DraftBadge() {
  const [draft, setDraft] = useState(false);
  useEffect(() => void appInfo().then((i) => setDraft(!!i?.name.includes("Draft"))), []);
  return draft ? <span className="draft-badge" title="This is the draft app: it updates with every round of edits">Draft</span> : null;
}

/** The interfaces the computer can see, for the settings sheet. Shown only in the desktop app. */
export function AudioSetup() {
  const [hosts, setHosts] = useState<AudioHost[] | null>(null);
  const [version, setVersion] = useState("");
  const look = () => { setHosts(null); void audioDevices().then(setHosts); };
  useEffect(() => {
    if (!isDesktop()) return;
    look();
    void appInfo().then((i) => i && setVersion(`${i.name} ${i.version}`));
  }, []);
  if (!isDesktop()) return null;
  const asio = hosts?.find((h) => h.name.toUpperCase() === "ASIO");
  const scarlett = hosts?.flatMap((h) => h.devices.map((d) => ({ host: h.name, d }))).find((x) => /focusrite|scarlett/i.test(x.d.name));
  return (
    <section className="audio-setup" aria-label="Audio interface">
      <div className="row"><b>Audio interface</b><span className="spacer" /><button className="btn sm" onClick={look} disabled={!hosts}>Look again</button></div>
      {!hosts && <p className="small muted">Looking…</p>}
      {hosts && (
        <p className="small">
          {scarlett ? <>Found <b>{scarlett.d.name}</b> ({scarlett.host}): {scarlett.d.input?.channels ?? 0} in, {scarlett.d.output?.channels ?? 0} out.</>
            : asio && asio.devices.length ? <>No Scarlett found. ASIO drivers: {asio.devices.map((d) => d.name).join(", ")}.</>
            : <>No Scarlett found. Plug it in, install the Focusrite USB ASIO driver from focusrite.com, then press Look again.</>}
        </p>
      )}
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
