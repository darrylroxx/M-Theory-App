import { useMemo } from "react";
import { chordNotes, chordPcs, chordSymbol, displaySuffix, getChordType, identifyChord, type ChordRef } from "../../theory/chords";
import { intervalName } from "../../theory/intervals";
import { ROLE_INFO, analyzeChord, keysContainingChord, spellInKey } from "../../theory/keys";
import { displayNote, pc } from "../../theory/notes";
import { getScale } from "../../theory/scales";
import { useApp } from "../state";
import { displayRoman, toneClass } from "./common";

/** The notes of a chord as coloured chips. */
export function ChordNotes({ chord }: { chord: ChordRef }) {
  const type = getChordType(chord.typeId);
  const notes = chordNotes(chord.root, type);
  return (
    <div className="row tight">
      {type.intervals.map((iv, i) => (
        <div key={iv} className={`note-chip sm ${toneClass(iv)}`} title={intervalName(iv)}>
          <b>{displayNote(notes[i])}</b>
          <span>{iv === "1" ? "R" : displaySuffix(iv)}</span>
        </div>
      ))}
    </div>
  );
}

/** The theory behind a chord (shown on demand). */
export function ChordTheory({ chord, onOpen }: { chord: ChordRef; onOpen?: (r: ChordRef) => void }) {
  const { state } = useApp();
  const type = getChordType(chord.typeId);
  const a = analyzeChord(chord, state.key);
  const keyName = `${displayNote(state.key.tonic)} ${getScale(state.key.scaleId).short}`;
  const aka = useMemo(
    () =>
      identifyChord(chordPcs(pc(chord.root), type), chord.bass ? pc(chord.bass) : pc(chord.root), (p) => spellInKey(p, state.key))
        .filter((m) => !(pc(m.ref.root) === pc(chord.root) && m.ref.typeId === chord.typeId) && m.omitted.length === 0)
        .slice(0, 4),
    [chord, type, state.key],
  );
  const keys = useMemo(() => keysContainingChord({ root: chord.root, typeId: chord.typeId }), [chord.root, chord.typeId]);
  return (
    <div className="info-box small">
      <p><b>{type.name}</b> · {type.feel}</p>
      <p><b>{displayRoman(a.roman)}</b> in {keyName} · {a.status === "diatonic" ? (a.role ? `${ROLE_INFO[a.role].label}: ${ROLE_INFO[a.role].blurb}` : "In key") : a.source}</p>
      <p className="muted">{type.intervals.map((iv) => intervalName(iv)).join(" + ")}</p>
      {aka.length > 0 && (
        <p className="muted">Also: {aka.map((m, i) => (
          <span key={i}>{i > 0 && ", "}{onOpen ? <a href="#" onClick={(e) => { e.preventDefault(); onOpen(m.ref); }}>{chordSymbol(m.ref)}</a> : chordSymbol(m.ref)}</span>
        ))}</p>
      )}
      {keys.length > 0 && (
        <p className="muted">Keys: {keys.slice(0, 8).map((k) => `${displayNote(k.key.tonic)}${k.key.scaleId === "ionian" ? "" : "m"} (${displayRoman(k.roman)})`).join(" · ")}</p>
      )}
    </div>
  );
}
