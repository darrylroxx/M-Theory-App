import { useMemo } from "react";
import { playSequence } from "../../audio/synth";
import { chordNotes, chordPcs, chordSymbol, displaySuffix, getChordType, identifyChord, type ChordRef } from "../../theory/chords";
import { intervalName, semitonesOf } from "../../theory/intervals";
import { ROLE_INFO, analyzeChord, keysContainingChord, spellInKey } from "../../theory/keys";
import { displayNote, pc } from "../../theory/notes";
import { getScale } from "../../theory/scales";
import { useApp } from "../state";
import { Disclosure, RolePill, displayRoman, toneClass } from "./common";

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** A chord explained in plain English: how it sounds, its notes, its place in your key. */
export function ChordInfo({ chord, onOpen, showAdd = true }: { chord: ChordRef; onOpen?: (r: ChordRef) => void; showAdd?: boolean }) {
  const { state, audition, addChord } = useApp();
  const type = getChordType(chord.typeId);
  const notes = chordNotes(chord.root, type);
  const analysis = analyzeChord(chord, state.key);
  const scale = getScale(state.key.scaleId);
  const midi = type.intervals.map((iv) => 48 + pc(chord.root) + semitonesOf(iv));

  const inKeyText =
    analysis.status === "diatonic"
      ? `In your key (${displayNote(state.key.tonic)} ${scale.short}) it's chord ${displayRoman(analysis.roman)}${analysis.role ? `: ${lowerFirst(ROLE_INFO[analysis.role].blurb)}` : "."}`
      : analysis.status === "borrowed"
        ? `Not in ${displayNote(state.key.tonic)} ${scale.short}, but you can borrow it (${analysis.source.replace("Borrowed from ", "from ")}) for an emotional twist.`
        : `Outside ${displayNote(state.key.tonic)} ${scale.short}. Use it as a surprise (${analysis.source.toLowerCase()}).`;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row tight">
        <button className="btn" onClick={() => audition(chord)}>▶ Strum</button>
        <button className="btn ghost" onClick={() => playSequence(midi, 0.22)}>▶ One note at a time</button>
        {showAdd && <button className="btn primary" onClick={() => addChord(chord)}>+ Add to song</button>}
      </div>
      <p><b>Sounds:</b> <span className="muted">{type.feel}</span></p>
      <div className="row tight">
        {type.intervals.map((iv, i) => (
          <div key={iv} className={`note-chip ${toneClass(iv)}`} title={intervalName(iv)}>
            <b>{displayNote(notes[i])}</b>
            <span>{iv === "1" ? "Root" : displaySuffix(iv)}</span>
          </div>
        ))}
      </div>
      <p className="small">
        {analysis.status === "diatonic" ? <RolePill role={analysis.role} /> : <span className={`pill ${analysis.status === "borrowed" ? "borrowed" : "chromatic"}`}>{analysis.status === "borrowed" ? "Borrowed" : "Outside the key"}</span>}{" "}
        {inKeyText}
      </p>
      <Disclosure title="Theory details" hint="Formula, other names, keys it belongs to">
        <TheoryDetails chord={chord} onOpen={onOpen} />
      </Disclosure>
    </div>
  );
}

function TheoryDetails({ chord, onOpen }: { chord: ChordRef; onOpen?: (r: ChordRef) => void }) {
  const { state } = useApp();
  const type = getChordType(chord.typeId);
  const aka = useMemo(
    () =>
      identifyChord(chordPcs(pc(chord.root), type), chord.bass ? pc(chord.bass) : pc(chord.root), (p) => spellInKey(p, state.key))
        .filter((m) => !(pc(m.ref.root) === pc(chord.root) && m.ref.typeId === chord.typeId) && m.omitted.length === 0)
        .slice(0, 4),
    [chord, type, state.key],
  );
  const keys = useMemo(() => keysContainingChord({ root: chord.root, typeId: chord.typeId }), [chord.root, chord.typeId]);
  return (
    <div className="stack small" style={{ gap: 8 }}>
      <p><b>{type.name}</b> = {type.intervals.map((iv) => intervalName(iv)).join(" + ")}.
        {type.optional?.length ? ` Guitarists often leave out the ${type.optional.map((o) => intervalName(o).toLowerCase()).join(" / ")}.` : ""}</p>
      {aka.length > 0 && (
        <p>
          <span className="muted">Same notes, other names: </span>
          {aka.map((m, i) => (
            <span key={i}>
              {i > 0 && ", "}
              {onOpen ? <a href="#" onClick={(e) => { e.preventDefault(); onOpen(m.ref); }}>{chordSymbol(m.ref)}</a> : chordSymbol(m.ref)}
            </span>
          ))}
        </p>
      )}
      {keys.length > 0 && (
        <p>
          <span className="muted">Belongs to: </span>
          {keys.slice(0, 8).map((k, i) => (
            <span key={i}>{i > 0 && " · "}{displayNote(k.key.tonic)} {k.key.scaleId === "ionian" ? "major" : "minor"} ({displayRoman(k.roman)})</span>
          ))}
        </p>
      )}
    </div>
  );
}
