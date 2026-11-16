import { useMemo, useState } from "react";
import { strum } from "../../audio/synth";
import { CHORD_CATEGORIES, CHORD_TYPES, chordSymbol, chordToneMap, displaySuffix, getChordType, identifyChord, type ChordCategory, type ChordRef } from "../../theory/chords";
import { spellInKey } from "../../theory/keys";
import { displayNote, mod12, pc } from "../../theory/notes";
import { ChordInfo } from "../components/ChordInfo";
import { toneColor, tokenLabel } from "../components/ChordDiagram";
import { Fretboard, type FretDot } from "../components/Fretboard";
import { Seg, ToneLegend } from "../components/common";
import { VoicingBrowser } from "../components/VoicingBrowser";
import { useApp } from "../state";

export function ChordsView() {
  const [mode, setMode] = useState<"find" | "name">("find");
  return (
    <div className="stack">
      <Seg value={mode} options={[{ value: "find", label: "🔎 Chord finder" }, { value: "name", label: "✋ Name that shape" }]} onChange={setMode} label="Chords mode" />
      {mode === "find" ? <Finder /> : <NameThatShape />}
    </div>
  );
}

function Finder() {
  const { state, set, addChord, openSheet, tuning } = useApp();
  const chord = state.explore;
  const type = getChordType(chord.typeId);
  const [cat, setCat] = useState<ChordCategory>(type.category);
  const setChord = (patch: Partial<ChordRef>) => set((s) => ({ ...s, explore: { ...s.explore, ...patch } }));
  const roots = Array.from({ length: 12 }, (_, i) => spellInKey(pc(state.key.tonic) + i, state.key));
  const [showNeck, setShowNeck] = useState(false);

  const neckDots = useMemo<FretDot[]>(() => {
    const tones = chordToneMap(pc(chord.root), type);
    const dots: FretDot[] = [];
    tuning.notes.forEach((open, s) => {
      for (let f = 0; f <= 15; f++) {
        const tok = tones.get(mod12(open + state.settings.capo + f));
        if (tok) dots.push({ string: s, fret: f, label: state.settings.labels === "notes" ? displayNote(spellInKey(open + state.settings.capo + f, state.key)) : tokenLabel(tok), color: toneColor(tok), weight: tok === "1" ? 2 : 1 });
      }
    });
    return dots;
  }, [chord.root, type, tuning, state.settings.capo, state.settings.labels, state.key]);

  return (
    <>
      <section className="card stack" style={{ gap: 12 }}>
        <div>
          <div className="filter-label" style={{ marginBottom: 6 }}>Root</div>
          <div className="row tight">
            {roots.map((r) => (
              <button key={r} className={`chip${pc(r) === pc(chord.root) ? " on" : ""}`} onClick={() => setChord({ root: r, bass: undefined })}>{displayNote(r)}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="filter-label" style={{ marginBottom: 6 }}>Type</div>
          <Seg value={cat} options={CHORD_CATEGORIES.map((c) => ({ value: c, label: c }))} onChange={setCat} label="Chord category" />
          <div className="row tight" style={{ marginTop: 8 }}>
            {CHORD_TYPES.filter((t) => t.category === cat).map((t) => (
              <button key={t.id} className={`chip${t.id === chord.typeId ? " on" : ""}`} title={t.feel} onClick={() => setChord({ typeId: t.id })}>
                {displayNote(chord.root)}{displaySuffix(t.symbol)} <span className="rn">{t.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            Bass note (slash chord)
            <select value={chord.bass ?? ""} onChange={(e) => setChord({ bass: e.target.value || undefined })}>
              <option value="">Root ({displayNote(chord.root)})</option>
              {roots.filter((r) => pc(r) !== pc(chord.root)).map((r) => <option key={r} value={r}>/{displayNote(r)}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="card stack">
        <div className="section-title">
          <h2 style={{ fontSize: "1.8rem" }}>{chordSymbol(chord)}</h2>
          <button className="btn" onClick={() => openSheet({ ref: chord })}>Pop out</button>
          <button className="btn primary" onClick={() => addChord(chord)}>+ Add to progression</button>
        </div>
        <ChordInfo chord={chord} onOpen={(r) => set((s) => ({ ...s, explore: r }))} />
      </section>

      <section className="card">
        <div className="section-title">
          <h2>Every way to play it</h2>
          <button className="btn sm" onClick={() => setShowNeck((v) => !v)}>{showNeck ? "Hide" : "Show"} chord tones on the whole neck</button>
        </div>
        {showNeck && (
          <div className="stack" style={{ gap: 8, marginBottom: 14 }}>
            <p className="small muted">Every {chordSymbol(chord)} note on the fretboard. Any 3–4 of these you can grab at once (with the root, 3rd and 7th) is a valid voicing. This is how you stop thinking in fixed shapes.</p>
            <Fretboard tuning={tuning} capo={state.settings.capo} dots={neckDots} leftHanded={state.settings.leftHanded} />
            <ToneLegend />
          </div>
        )}
        <VoicingBrowser chord={chord} onUse={(v) => addChord(chord, { voicingId: v.id })} useLabel="+ Add" />
      </section>
    </>
  );
}

function NameThatShape() {
  const { state, tuning, openSheet, addChord } = useApp();
  const n = tuning.notes.length;
  const [frets, setFrets] = useState<(number | null)[]>(() => [null, 3, 2, 0, 1, 0]);
  const capo = state.settings.capo;
  const midi = frets.map((f, s) => (f === null ? null : tuning.notes[s] + capo + f));
  const sounding = midi.filter((m): m is number => m !== null);
  const matches = useMemo(() => {
    if (sounding.length < 2) return [];
    const pcs = sounding.map(mod12);
    return identifyChord(pcs, mod12(sounding[0]), (p) => spellInKey(p, state.key)).slice(0, 8);
  }, [sounding.join(","), state.key]);

  const best = matches[0];
  const tones = best ? chordToneMap(pc(best.ref.root), best.type) : null;
  const dots: FretDot[] = frets.flatMap((f, s) => {
    if (f === null) return [];
    const p = mod12(tuning.notes[s] + capo + f);
    const tok = tones?.get(p);
    return [{ string: s, fret: f, label: tok ? tokenLabel(tok) : displayNote(spellInKey(p, state.key)), color: tok ? toneColor(tok) : "var(--other)", weight: 2 as const }];
  });

  const tap = (s: number, f: number) => setFrets((cur) => cur.map((x, i) => (i === s ? (x === f ? null : f) : x)));

  return (
    <section className="card stack">
      <div>
        <h2>Name that shape</h2>
        <p className="small muted">Tap the fretboard to place one finger per string (tap again to mute that string, tap the left column for an open string). M-Theory tells you what chord you're holding and every name it goes by. Perfect for naming those “happy accident” shapes you stumble on.</p>
      </div>
      <Fretboard tuning={tuning} capo={capo} dots={dots} onCell={tap} leftHanded={state.settings.leftHanded} />
      <div className="row">
        <span className="mono">{frets.map((f) => (f === null ? "x" : f)).join(" ")}</span>
        <button className="btn sm" onClick={() => strum(midi)} disabled={!sounding.length}>▶ Strum</button>
        <button className="btn sm ghost" onClick={() => setFrets(new Array(n).fill(null))}>Clear</button>
        <button className="btn sm ghost" onClick={() => setFrets(new Array(n).fill(0))}>All open</button>
      </div>
      {sounding.length < 2 ? (
        <p className="muted">Place at least two notes.</p>
      ) : matches.length === 0 ? (
        <p className="muted">No standard chord name for these notes ({[...new Set(sounding.map((m) => displayNote(spellInKey(m, state.key))))].join(", ")}). It's a cluster or an unusual voicing: if it sounds good, it <i>is</i> good.</p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <h3>You're playing <span style={{ color: "var(--accent)" }}>{chordSymbol(matches[0].ref)}</span></h3>
          <p className="small muted">{matches[0].type.name}{matches[0].omitted.length ? ` (without the ${matches[0].omitted.map((o) => displaySuffix(o)).join(", ")})` : ""}. {matches[0].type.feel}</p>
          {matches.length > 1 && (
            <div className="row tight">
              <span className="small muted">Also could be called:</span>
              {matches.slice(1).map((m, i) => (
                <button key={i} className="chip" onClick={() => openSheet({ ref: m.ref })}>{chordSymbol(m.ref)}</button>
              ))}
            </div>
          )}
          <div className="row tight">
            <button className="btn sm" onClick={() => openSheet({ ref: matches[0].ref })}>See all voicings</button>
            <button className="btn sm primary" onClick={() => addChord(matches[0].ref, { voicingId: frets.map((f) => (f === null ? "x" : f)).join(",") })}>+ Add this exact shape</button>
          </div>
        </div>
      )}
    </section>
  );
}
