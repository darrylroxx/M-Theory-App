import { useMemo } from "react";
import { playSequence } from "../../audio/synth";
import { chordNotes, chordPcs, chordSymbol, displaySuffix, getChordType, identifyChord, type ChordRef } from "../../theory/chords";
import { intervalName, semitonesOf } from "../../theory/intervals";
import { analyzeChord, keysContainingChord, spellInKey } from "../../theory/keys";
import { displayNote, pc } from "../../theory/notes";
import { useApp } from "../state";
import { RolePill, displayRoman, toneClass } from "./common";

/** Everything about one chord in plain English. */
export function ChordInfo({ chord, onOpen }: { chord: ChordRef; onOpen?: (r: ChordRef) => void }) {
  const { state } = useApp();
  const type = getChordType(chord.typeId);
  const notes = chordNotes(chord.root, type);
  const analysis = analyzeChord(chord, state.key);
  const aka = useMemo(() => {
    const pcs = chordPcs(pc(chord.root), type);
    return identifyChord(pcs, chord.bass ? pc(chord.bass) : pc(chord.root), (p) => spellInKey(p, state.key))
      .filter((m) => !(pc(m.ref.root) === pc(chord.root) && m.ref.typeId === chord.typeId) && m.omitted.length === 0)
      .slice(0, 4);
  }, [chord, type, state.key]);
  const keys = useMemo(() => keysContainingChord({ root: chord.root, typeId: chord.typeId }), [chord.root, chord.typeId]);
  const statusClass = analysis.status === "diatonic" ? "home" : analysis.status === "borrowed" ? "borrowed" : "chromatic";
  const midi = type.intervals.map((iv) => 48 + pc(chord.root) + semitonesOf(iv));

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row">
        <span className="pill" title="Roman numeral in your current key">{displayRoman(analysis.roman)} in {displayNote(state.key.tonic)}</span>
        <span className={`pill ${statusClass}`}>{analysis.source}</span>
        <RolePill role={analysis.role} />
      </div>
      <p><b>{type.name}.</b> <span className="muted">{type.feel}</span></p>
      <div className="row tight">
        {type.intervals.map((iv, i) => (
          <div key={iv} className={`note-chip ${toneClass(iv)}`} title={intervalName(iv)}>
            <b>{displayNote(notes[i])}</b>
            <span>{iv === "1" ? "R" : displaySuffix(iv)}</span>
          </div>
        ))}
        <button className="btn sm ghost" onClick={() => playSequence(midi, 0.22)}>▶ Arpeggiate</button>
      </div>
      <p className="small muted">
        Formula: {type.intervals.map((iv) => intervalName(iv)).join(" + ")}
        {type.optional?.length ? `. Guitarists often leave out the ${type.optional.map((o) => intervalName(o).toLowerCase()).join(" / ")}.` : "."}
      </p>
      {aka.length > 0 && (
        <p className="small">
          <span className="muted">Same notes can also be named: </span>
          {aka.map((m, i) => (
            <span key={i}>
              {i > 0 && ", "}
              {onOpen ? <a href="#" onClick={(e) => { e.preventDefault(); onOpen(m.ref); }}>{chordSymbol(m.ref)}</a> : chordSymbol(m.ref)}
            </span>
          ))}
        </p>
      )}
      {keys.length > 0 && (
        <p className="small">
          <span className="muted">Lives naturally in: </span>
          {keys.slice(0, 8).map((k, i) => (
            <span key={i}>{i > 0 && " · "}{displayNote(k.key.tonic)} {k.key.scaleId === "ionian" ? "major" : "minor"} ({displayRoman(k.roman)})</span>
          ))}
        </p>
      )}
    </div>
  );
}
