import { useMemo, useState } from "react";
import { playSequence } from "../../audio/synth";
import { chordSymbol, chordToneMap, type ChordRef } from "../../theory/chords";
import { semitonesOf } from "../../theory/intervals";
import { diatonicChords } from "../../theory/keys";
import { displayNote, mod12, pc } from "../../theory/notes";
import { getScale, isHeptatonic, scaleNotes } from "../../theory/scales";
import { toneColor, tokenLabel } from "../components/ChordDiagram";
import { Fretboard, type FretDot } from "../components/Fretboard";
import { Seg, ToneLegend, displayRoman } from "../components/common";
import { useApp } from "../state";

/** The current key's scale across the whole fretboard (a Learn topic). */
export function ScaleOnNeck() {
  const { state, tuning, openSheet } = useApp();
  const key = state.key;
  const scale = getScale(key.scaleId);
  const notes = scaleNotes(key.tonic, scale);
  const capo = state.settings.capo;
  const [labels, setLabels] = useState<"intervals" | "notes">("intervals");
  const [frets, setFrets] = useState(15);
  const [size, setSize] = useState<3 | 4>(3);
  const [hl, setHl] = useState<ChordRef | null>(null);
  const [showSig, setShowSig] = useState(true);
  const chords = useMemo(() => (isHeptatonic(scale) ? diatonicChords(key, size) : []), [key, scale, size]);
  const active = hl && chords.some((c) => c.ref.root === hl.root && c.ref.typeId === hl.typeId) ? hl : null;

  const dots = useMemo<FretDot[]>(() => {
    const tonicPc = pc(key.tonic);
    const byPc = new Map<number, { token: string; name: string }>();
    scale.intervals.forEach((iv, i) => byPc.set(mod12(tonicPc + semitonesOf(iv)), { token: iv, name: notes[i] }));
    const sig = new Set((scale.signature ?? []).map((iv) => mod12(tonicPc + semitonesOf(iv))));
    const hlChord = hl ? chords.find((c) => c.ref.root === hl.root && c.ref.typeId === hl.typeId) : undefined;
    const chordTones = hlChord ? chordToneMap(pc(hlChord.ref.root), hlChord.type) : null;
    const out: FretDot[] = [];
    tuning.notes.forEach((open, s) => {
      for (let f = 0; f <= frets; f++) {
        const p = mod12(open + capo + f);
        const info = byPc.get(p);
        if (!info) continue;
        const ct = chordTones?.get(p);
        const label = labels === "notes" ? displayNote(info.name) : ct ? tokenLabel(ct) : tokenLabel(info.token);
        out.push({
          string: s,
          fret: f,
          label,
          color: chordTones ? (ct ? toneColor(ct) : "var(--other)") : toneColor(info.token),
          weight: chordTones ? (ct ? (ct === "1" ? 2 : 1) : 0) : info.token === "1" ? 2 : 1,
          ring: showSig && sig.has(p),
        });
      }
    });
    return out;
  }, [key.tonic, scale, notes, tuning, capo, frets, labels, hl, chords, showSig]);

  const tonicMidi = 52 + mod12(pc(key.tonic) - 4);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row tight">
        <button className="btn sm" onClick={() => playSequence([...scale.intervals.map((iv) => tonicMidi + semitonesOf(iv)), tonicMidi + 12])}>▶ Hear the scale</button>
        <Seg value={labels} options={[{ value: "intervals", label: "Intervals" }, { value: "notes", label: "Note names" }]} onChange={setLabels} />
        <Seg value={frets} options={[{ value: 12, label: "12 frets" }, { value: 15, label: "15" }, { value: 22, label: "22" }]} onChange={setFrets} />
      </div>
      <Fretboard tuning={tuning} capo={capo} frets={frets} dots={dots} leftHanded={state.settings.leftHanded} />
      <ToneLegend />
      {(scale.signature?.length ?? 0) > 0 && <label className="toggle"><input type="checkbox" checked={showSig} onChange={(e) => setShowSig(e.target.checked)} /> Signature note</label>}
      {chords.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row tight">
            <b>Chord</b>
            <Seg value={size} options={[{ value: 3, label: "Simple" }, { value: 4, label: "7ths" }]} onChange={(v) => { setSize(v); setHl(null); }} />
          </div>
          <div className="row tight">
            <button className={`chip${active === null ? " on" : ""}`} onClick={() => setHl(null)}>Whole scale</button>
            {chords.map((c) => (
              <button key={c.degree} className={`chip${active?.root === c.ref.root && active.typeId === c.ref.typeId ? " on" : ""}`} onClick={() => setHl(c.ref)}>
                {chordSymbol(c.ref)} <span className="rn">{displayRoman(c.roman)}</span>
              </button>
            ))}
          </div>
          {active && <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => openSheet({ ref: active })}>Ways to play {chordSymbol(active)}</button>}
        </div>
      )}
    </div>
  );
}
