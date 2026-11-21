// The key, under its button in the top bar: the home note, the mode, the notes of the scale with a ▶ to hear them,
// and "Move song", which moves the key and every note together.
// It writes nothing itself: what is picked is handed to whoever shows it.
import { playSequence } from "../../audio/synth";
import { intervalName, semitonesOf } from "../../theory/intervals";
import type { Key } from "../../theory/keys";
import { displayNote, mod12, pc } from "../../theory/notes";
import { SCALES, SCALE_FAMILIES, bestTonicSpelling, getScale, scaleNotes } from "../../theory/scales";
import { displaySuffix } from "../../theory/chords";
import { toneClass } from "../components/common";

const MAIN_MODES = ["ionian", "aeolian", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonicMinor", "melodicMinor"];
const PCS = Array.from({ length: 12 }, (_, i) => i);

/** A key as it is written in the top bar: "B major", "A dorian". */
export const keyText = (key: Key): string => `${displayNote(key.tonic)} ${getScale(key.scaleId).short.toLowerCase()}`;

export function KeyPopover({ keyOf, onKey, onMove, sung }: {
  keyOf: Key;
  /** a home note or a mode picked */
  onKey(key: Key): void;
  /** "Move song": the key and every note, up or down by so many semitones */
  onMove(semitones: number): void;
  /** the key the recordings that play were sung in, when it is another one */
  sung?: string;
}) {
  const scale = getScale(keyOf.scaleId);
  const tonicPc = pc(keyOf.tonic);
  const notes = scaleNotes(keyOf.tonic, scale);
  const sig = scale.signature ?? [];
  const pickScale = (id: string) => onKey({ tonic: bestTonicSpelling(tonicPc, getScale(id)), scaleId: id });
  const tonicMidi = 52 + mod12(tonicPc - 4);
  return (
    <div className="keybar tlv-key">
      <div className="kb-row">
        <span className="kb-label">Key</span>
        <div className="tonics" role="radiogroup" aria-label="Key">
          {PCS.map((p) => {
            const name = bestTonicSpelling(p, scale);
            return <button key={p} role="radio" aria-checked={tonicPc === p} className={tonicPc === p ? "on" : ""} onClick={() => onKey({ tonic: name, scaleId: scale.id })}>{displayNote(name)}</button>;
          })}
        </div>
      </div>
      <div className="kb-row">
        <span className="kb-label">Mode</span>
        <div className="modes" role="radiogroup" aria-label="Mode">
          {MAIN_MODES.map((id) => {
            const sc = getScale(id);
            return <button key={id} role="radio" aria-checked={scale.id === id} className={`chip${scale.id === id ? " on" : ""}`} title={sc.mood} onClick={() => pickScale(id)}>{sc.short}</button>;
          })}
          <select className={`chip-select${MAIN_MODES.includes(scale.id) ? "" : " on"}`} aria-label="More scales" value={MAIN_MODES.includes(scale.id) ? "" : scale.id} onChange={(e) => e.target.value && pickScale(e.target.value)}>
            <option value="">More…</option>
            {SCALE_FAMILIES.map((f) => (
              <optgroup key={f} label={f}>
                {SCALES.filter((s) => s.family === f && !MAIN_MODES.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      <div className="kb-row kb-notes">
        <div className="row tight">
          {notes.map((n, i) => {
            const iv = scale.intervals[i];
            return (
              <div key={i} className={`note-chip sm ${toneClass(iv)}${sig.includes(iv) ? " sig" : ""}`} title={intervalName(iv) + (sig.includes(iv) ? " (signature note)" : "")}>
                <b>{displayNote(n)}</b>
                <span>{iv === "1" ? "R" : displaySuffix(iv)}</span>
              </div>
            );
          })}
          <button className="mini-play" aria-label="Play scale" title="Play scale" onClick={() => playSequence([...scale.intervals.map((iv) => tonicMidi + semitonesOf(iv)), tonicMidi + 12])}>▶</button>
        </div>
        <span className="spacer" />
        <span className="kb-move" role="group" aria-label="Move the whole song up or down">
          <span className="kb-label" title="Moves the key, every chord and every melody together">Move song</span>
          <button className="btn sm" aria-label="Down a semitone" onClick={() => onMove(-1)}>− ½</button>
          <button className="btn sm" aria-label="Up a semitone" onClick={() => onMove(1)}>+ ½</button>
        </span>
      </div>
      {sung && <p className="small fr-note" role="note">Vocals: sung in {sung}</p>}
    </div>
  );
}
