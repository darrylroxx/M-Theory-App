import { useState } from "react";
import { TUNINGS } from "../../guitar/tunings";
import { displayNote, pc } from "../../theory/notes";
import { SCALE_FAMILIES, SCALES, bestTonicSpelling, enharmonicTonic, getScale } from "../../theory/scales";
import { useApp } from "../state";
import { Disclosure, Seg } from "./common";

/** The everyday scales, named by how they feel. */
export const MOOD_SCALES: { id: string; mood: string }[] = [
  { id: "ionian", mood: "Happy & bright" },
  { id: "aeolian", mood: "Sad & emotional" },
  { id: "dorian", mood: "Cool & soulful" },
  { id: "mixolydian", mood: "Bluesy & laid-back" },
  { id: "lydian", mood: "Dreamy & floating" },
  { id: "phrygian", mood: "Dark & Spanish" },
  { id: "harmonicMinor", mood: "Dramatic & exotic" },
  { id: "mixolydianb6", mood: "Bittersweet & heroic" },
];

export function moodOf(scaleId: string): string {
  return MOOD_SCALES.find((m) => m.id === scaleId)?.mood ?? getScale(scaleId).mood.split(/[,.]/)[0];
}

const PCS = Array.from({ length: 12 }, (_, i) => i);

export function KeyPicker({ onClose }: { onClose: () => void }) {
  const { state, set } = useApp();
  const scale = getScale(state.key.scaleId);
  const setKey = (tonic: string, scaleId: string) => set((s) => ({ ...s, key: { tonic, scaleId } }));
  const alt = enharmonicTonic(state.key.tonic);
  const tonicPc = pc(state.key.tonic);
  const pickScale = (id: string) => setKey(bestTonicSpelling(tonicPc, getScale(id)), id);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" style={{ maxWidth: 720 }} role="dialog" aria-modal="true" aria-label="Choose key and mood" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <h2>{displayNote(state.key.tonic)} {scale.short}</h2>
            <p className="muted small">{moodOf(scale.id)}</p>
          </div>
          <button className="icon-btn sheet-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="stack">
          <div>
            <h3 className="step"><span>1</span> Home note</h3>
            <p className="small muted" style={{ marginBottom: 8 }}>The note your song keeps coming back to.</p>
            <div className="tonic-grid">
              {PCS.map((p) => {
                const name = bestTonicSpelling(p, scale);
                return (
                  <button key={p} className={tonicPc === p ? "on" : ""} onClick={() => setKey(name, scale.id)}>{displayNote(name)}</button>
                );
              })}
            </div>
            {alt && (
              <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setKey(alt, scale.id)}>Spell it {displayNote(alt)} instead</button>
            )}
          </div>
          <div>
            <h3 className="step"><span>2</span> Mood</h3>
            <p className="small muted" style={{ marginBottom: 8 }}>Each mood is a scale (or “mode”). Same home note, different feeling.</p>
            <div className="mood-list">
              {MOOD_SCALES.map((m) => (
                <button key={m.id} className={m.id === scale.id ? "on" : ""} onClick={() => pickScale(m.id)}>
                  <b>{m.mood}</b>
                  <span>{getScale(m.id).name}</span>
                </button>
              ))}
            </div>
          </div>
          <Disclosure title="More scales" hint="Pentatonic, blues, jazz and exotic sounds">
            <MoreScales current={scale.id} onPick={pickScale} />
          </Disclosure>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MoreScales({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  const [family, setFamily] = useState(SCALES.find((s) => s.id === current)?.family ?? SCALE_FAMILIES[0]);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <Seg value={family} options={SCALE_FAMILIES.map((f) => ({ value: f, label: f }))} onChange={setFamily} label="Scale family" />
      <div className="scale-list">
        {SCALES.filter((s) => s.family === family).map((s) => (
          <button key={s.id} className={s.id === current ? "on" : ""} onClick={() => onPick(s.id)}>
            <b>{s.name}</b>
            <span>{s.mood}</span>
          </button>
        ))}
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
          <label className="toggle"><input type="checkbox" checked={st.avoidBarre} onChange={(e) => upd({ avoidBarre: e.target.checked })} /> Avoid barre chords when picking shapes for me</label>
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
          <p className="small muted">With a capo, diagrams count frets from the capo (like a normal chord chart). Chord names stay the real sounding chords.</p>
          <div className="row">
            <span className="filter-label">Dots show</span>
            <Seg value={st.labels} options={[{ value: "intervals", label: "Intervals" }, { value: "notes", label: "Note names" }, { value: "fingers", label: "Fingers" }]} onChange={(v) => upd({ labels: v })} />
          </div>
          <div className="row">
            <span className="filter-label">Theme</span>
            <Seg value={st.theme} options={[{ value: "auto", label: "Auto" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} onChange={(v) => upd({ theme: v })} />
          </div>
          <label className="toggle"><input type="checkbox" checked={st.leftHanded} onChange={(e) => upd({ leftHanded: e.target.checked })} /> Left-handed diagrams</label>
          {st.guideDismissed && (
            <button className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => upd({ guideDismissed: false })}>Show the “how it works” tips again</button>
          )}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}
