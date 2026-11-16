import { useState } from "react";
import { TUNINGS } from "../../guitar/tunings";
import { displayNote, pc } from "../../theory/notes";
import { SCALE_FAMILIES, SCALES, bestTonicSpelling, enharmonicTonic, getScale } from "../../theory/scales";
import { useApp } from "../state";
import { Seg } from "./common";

const PCS = Array.from({ length: 12 }, (_, i) => i);

export function KeyPicker({ onClose }: { onClose: () => void }) {
  const { state, set } = useApp();
  const scale = getScale(state.key.scaleId);
  const [family, setFamily] = useState(scale.family);
  const setKey = (tonic: string, scaleId: string) => set((s) => ({ ...s, key: { tonic, scaleId } }));
  const alt = enharmonicTonic(state.key.tonic);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Choose key" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <h2>{displayNote(state.key.tonic)} {scale.name}</h2>
            <p className="muted small">{scale.mood}</p>
          </div>
          <button className="icon-btn sheet-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="stack">
          <div>
            <h3 style={{ marginBottom: 8 }}>Home note (tonic)</h3>
            <div className="tonic-grid">
              {PCS.map((p) => {
                const name = bestTonicSpelling(p, scale);
                return (
                  <button key={p} className={pc(state.key.tonic) === p ? "on" : ""} onClick={() => setKey(name, scale.id)}>
                    {displayNote(name)}
                  </button>
                );
              })}
            </div>
            {alt && (
              <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setKey(alt, scale.id)}>
                Spell as {displayNote(alt)} instead
              </button>
            )}
          </div>
          <div>
            <div className="section-title"><h3>Scale / mode</h3></div>
            <Seg value={family} options={SCALE_FAMILIES.map((f) => ({ value: f, label: f }))} onChange={setFamily} label="Scale family" />
            <div className="scale-list" style={{ marginTop: 10 }}>
              {SCALES.filter((s) => s.family === family).map((s) => (
                <button key={s.id} className={s.id === scale.id ? "on" : ""}
                  onClick={() => setKey(bestTonicSpelling(pc(state.key.tonic), s), s.id)}>
                  <b>{s.name}</b>
                  <span>{s.mood}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
          <p className="small muted">With a capo, diagrams show fret numbers relative to the capo (like you'd read a chord chart), while chord names stay the real sounding chords.</p>
          <div className="row">
            <span className="filter-label">Dots</span>
            <Seg value={st.labels} options={[{ value: "intervals", label: "Intervals" }, { value: "notes", label: "Note names" }, { value: "fingers", label: "Fingers" }]} onChange={(v) => upd({ labels: v })} />
          </div>
          <div className="row">
            <span className="filter-label">Theme</span>
            <Seg value={st.theme} options={[{ value: "auto", label: "Auto" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} onChange={(v) => upd({ theme: v })} />
          </div>
          <label className="toggle"><input type="checkbox" checked={st.leftHanded} onChange={(e) => upd({ leftHanded: e.target.checked })} /> Left-handed diagrams</label>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}
