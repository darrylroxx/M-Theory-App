import { TUNINGS } from "../../guitar/tunings";
import { useApp } from "../state";
import { Seg } from "./common";
import { AudioSetup } from "./Desktop";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { state, set } = useApp();
  const st = state.settings;
  const upd = (patch: Partial<typeof st>) => set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" style={{ maxWidth: 560 }} role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Guitar setup</h2>
          <button className="icon-btn sheet-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="stack">
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
          <AudioSetup />
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}
