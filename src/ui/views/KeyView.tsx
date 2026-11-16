import { useMemo, useState } from "react";
import { playSequence } from "../../audio/synth";
import { capoSuggestions } from "../../guitar/arrange";
import { voicingText } from "../../guitar/voicings";
import { chordSymbol, displaySuffix, type ChordCategory, type ChordRef } from "../../theory/chords";
import { intervalName, semitonesOf } from "../../theory/intervals";
import { ROLE_INFO, borrowedChords, chordsInScale, diatonicChords, spellInKey, spiceChords, type KeyChord } from "../../theory/keys";
import { displayNote, mod12, pc } from "../../theory/notes";
import { bestTonicSpelling, getScale, isHeptatonic, keySignature, relativeModes, scaleNotes } from "../../theory/scales";
import { ChordDiagram } from "../components/ChordDiagram";
import { ChordChip, PlayButton, RolePill, Seg, displayRoman, toneClass } from "../components/common";
import { useApp } from "../state";

export function KeyView() {
  const { state, set, openSheet, audition, tuning } = useApp();
  const key = state.key;
  const scale = getScale(key.scaleId);
  const notes = scaleNotes(key.tonic, scale);
  const sig = new Set(scale.signature ?? []);
  const [size, setSize] = useState<3 | 4 | 5>(3);
  const hepta = isHeptatonic(scale);

  const diatonic = useMemo(() => diatonicChords(key, size), [key, size]);
  const all = useMemo(() => chordsInScale(key), [key]);
  const borrowed = useMemo(() => (hepta ? borrowedChords(key) : []), [key, hepta]);
  const spice = useMemo(() => (hepta ? spiceChords(key) : []), [key, hepta]);
  const relatives = useMemo(() => relativeModes(key.tonic, scale), [key.tonic, scale]);
  const ks = keySignature(key.tonic, scale);
  const open = (ref: ChordRef) => openSheet({ ref });
  const tonicMidi = 52 + mod12(pc(key.tonic) - 4);
  const scaleMidi = [...scale.intervals.map((iv) => tonicMidi + semitonesOf(iv)), tonicMidi + 12];

  return (
    <div className="stack">
      <section className="card hero">
        <div className="row">
          <div style={{ flex: 1, minWidth: 240 }}>
            <p className="muted small" style={{ fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>Your key</p>
            <h1>{displayNote(key.tonic)} {scale.name}</h1>
            <p className="mood">{scale.mood}</p>
          </div>
          <button className="btn" onClick={() => playSequence(scaleMidi)}>▶ Hear the scale</button>
        </div>
        <p className="muted">{scale.description}</p>
        <div className="row tight">
          {notes.map((n, i) => {
            const iv = scale.intervals[i];
            return (
              <div key={i} className={`note-chip ${toneClass(iv)}${sig.has(iv) ? " sig" : ""}`} title={intervalName(iv)}>
                <b>{displayNote(n)}</b>
                <span>{iv === "1" ? "R" : displaySuffix(iv)}</span>
              </div>
            );
          })}
        </div>
        <div className="small muted stack" style={{ gap: 4 }}>
          {scale.signature && scale.signature.length > 0 && (
            <p>
              <b style={{ color: "var(--ext)" }}>Signature note{scale.signature.length > 1 ? "s" : ""}:</b>{" "}
              {scale.signature.map((iv) => `${displayNote(notes[scale.intervals.indexOf(iv)] ?? "")} (${displaySuffix(iv)})`).join(", ")}. Like {scale.compareTo}. Lean on it in melodies and chords to make the mode obvious.
            </p>
          )}
          {hepta && (
            <p>
              Key signature: {ks.sharps.length ? `${ks.sharps.length} sharp${ks.sharps.length > 1 ? "s" : ""} (${ks.sharps.map(displayNote).join(" ")})` : ks.flats.length ? `${ks.flats.length} flat${ks.flats.length > 1 ? "s" : ""} (${ks.flats.map(displayNote).join(" ")})` : "no sharps or flats"}
            </p>
          )}
          {relatives.length > 0 && (
            <div className="row tight" style={{ marginTop: 4 }}>
              <span>Same notes as:</span>
              {relatives.map((r) => (
                <button key={r.scale.id + r.tonic} className="chip" onClick={() => set((s) => ({ ...s, key: { tonic: r.tonic, scaleId: r.scale.id } }))}>
                  {displayNote(r.tonic)} {r.scale.short}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {hepta && (
        <section className="card">
          <div className="section-title">
            <h2>The chords of {displayNote(key.tonic)} {scale.short}</h2>
            <Seg value={size} options={[{ value: 3, label: "Triads" }, { value: 4, label: "7ths" }, { value: 5, label: "9ths" }]} onChange={setSize} label="Chord size" />
          </div>
          <p className="small muted" style={{ marginBottom: 10 }}>
            Built by stacking every other note of the scale. Tap a chord for all the ways to play it.
          </p>
          <div className="pattern-strip" style={{ marginBottom: 12 }}>
            {diatonic.map((c) => <span key={c.degree}>{displayRoman(c.roman)} = {c.type.name.replace(" (m7♭5)", "")}</span>)}
          </div>
          <div className="chord-grid">
            {diatonic.map((c) => (
              <button key={c.degree} className={`chord-card role-${c.role}`} onClick={() => open(c.ref)}>
                <span className="roman">{displayRoman(c.roman)}</span>
                <span className="sym">{chordSymbol(c.ref)}</span>
                <span className="notes">{c.notes.map(displayNote).join(" · ")}</span>
                <span className="row tight">
                  <RolePill role={c.role} />
                  {c.signature && <span className="pill sig" title="Contains the mode's signature note">★ signature</span>}
                </span>
                <span className="play"><PlayButton onClick={() => audition(c.ref)} label={`Play ${chordSymbol(c.ref)}`} /></span>
              </button>
            ))}
          </div>
          <div className="row small muted" style={{ marginTop: 12, gap: 16 }}>
            {(Object.keys(ROLE_INFO) as (keyof typeof ROLE_INFO)[]).map((r) => (
              <span key={r} style={{ flex: "1 1 200px" }}><RolePill role={r} /> {ROLE_INFO[r].blurb}</span>
            ))}
          </div>
        </section>
      )}

      {hepta && <CapoHelper chords={diatonicChords(key, 3)} />}

      <section className="card">
        <div className="section-title">
          <h2>Every chord in the key</h2>
          <span className="small muted">{all.reduce((n, d) => n + d.chords.length, 0)} chords use only notes from {displayNote(key.tonic)} {scale.short}</span>
        </div>
        <p className="small muted" style={{ marginBottom: 6 }}>
          All of these are “legal” in your key: sus, add9, 6ths, 9ths, 11ths, 13ths… Swap any plain chord for one of these to change the colour without leaving the key.
        </p>
        {all.map((d) => (
          <div key={d.degree} className="degree-row">
            <div className="degree-label">
              {displayRoman(d.token)}
              <small>{displayNote(d.root)}</small>
            </div>
            <DegreeChips chords={d.chords} onOpen={open} />
          </div>
        ))}
      </section>

      {borrowed.length > 0 && (
        <section className="card">
          <div className="section-title"><h2>Borrowed chords</h2><span className="pill borrowed">modal interchange</span></div>
          <p className="small muted" style={{ marginBottom: 10 }}>
            Chords from parallel modes that share your home note. They bring in one or two “wrong” notes that sound <i>right</i>: the secret behind countless emotional moments.
          </p>
          <div className="stack" style={{ gap: 12 }}>
            {[...new Set(borrowed.map((c) => c.fromIds[0]))].map((sid) => {
              const src = getScale(sid);
              const group = borrowed.filter((c) => c.fromIds[0] === sid);
              return (
                <div key={sid}>
                  <div className="row tight" style={{ marginBottom: 6 }}>
                    <b>From {displayNote(bestTonicSpelling(pc(key.tonic), src))} {src.short}</b>
                    <span className="small muted">· {src.mood}</span>
                  </div>
                  <div className="row tight">
                    {group.map((c) => (
                      <ChordChip key={c.ref.root + c.type.id} ref={c.ref} roman={c.roman} title={`${c.source}. ${c.explain ?? ""}`} onClick={() => open(c.ref)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {spice.length > 0 && (
        <section className="card">
          <div className="section-title"><h2>Chromatic spice</h2><span className="pill chromatic">outside the key, on purpose</span></div>
          <div className="stack" style={{ gap: 14 }}>
            {spice.map((g) => (
              <div key={g.group}>
                <h3>{g.group}</h3>
                <p className="small muted" style={{ margin: "2px 0 8px" }}>{g.blurb}</p>
                <div className="row tight">
                  {g.chords.map((c) => (
                    <ChordChip key={c.roman + c.ref.root} ref={c.ref} roman={c.roman} title={c.explain} onClick={() => open(c.ref)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="tiny faint" style={{ textAlign: "center" }}>Tuning: {tuning.name}{state.settings.capo ? ` · capo ${state.settings.capo}` : ""}</p>
    </div>
  );
}

const CAT_ORDER: ChordCategory[] = ["Triads", "Power & Sus", "Sixths", "Sevenths", "Added tones", "Extended (9, 11, 13)", "Altered dominants"];

function DegreeChips({ chords, onOpen }: { chords: KeyChord[]; onOpen: (r: ChordRef) => void }) {
  const sorted = [...chords].sort((a, b) => CAT_ORDER.indexOf(a.type.category) - CAT_ORDER.indexOf(b.type.category));
  return (
    <div className="row tight">
      {sorted.map((c) => (
        <ChordChip key={c.type.id} ref={c.ref} roman={c.roman} title={`${c.type.name}: ${c.type.feel}`} onClick={() => onOpen(c.ref)} />
      ))}
    </div>
  );
}

function CapoHelper({ chords }: { chords: KeyChord[] }) {
  const { state, set, tuning, toast } = useApp();
  const key = state.key;
  const scale = getScale(key.scaleId);
  const suggestions = useMemo(
    () => capoSuggestions(chords.map((c) => ({ rootPc: pc(c.ref.root), type: c.type })), tuning),
    [chords, tuning],
  );
  const none = suggestions.find((s) => s.capo === 0)!;
  const top = suggestions.filter((s) => s.capo !== 0).slice(0, 3);
  if (!top.length || top[0].easy <= none.easy) return null;

  return (
    <section className="card capo-card">
      <div className="section-title">
        <h2>Escape the barre chords</h2>
        <span className="small muted">Without a capo, {none.easy} of {none.total} chords have an easy open shape.</span>
      </div>
      {top.map((s) => {
        const shapeKey = bestTonicSpelling(mod12(pc(key.tonic) - s.capo), scale);
        const shapeName = (c: KeyChord) => displayNote(spellInKey(pc(c.ref.root) - s.capo, { tonic: shapeKey, scaleId: key.scaleId })) + displaySuffix(c.type.symbol);
        return (
          <div key={s.capo} className="capo-option">
            <div>
              <b className="big">Capo {s.capo}</b>
              <div className="small muted">play shapes from {displayNote(shapeKey)} {scale.short}</div>
            </div>
            <div className="capo-meter" title={`${s.easy}/${s.total} easy`}><div style={{ width: `${(100 * s.easy) / s.total}%` }} /></div>
            <span className="small"><b>{s.easy}/{s.total}</b> open shapes</span>
            <div className="row tight" style={{ flex: "1 1 100%" }}>
              {chords.map((c, i) => (
                <span key={i} className="pill" title={s.shapes[i] ? voicingText(s.shapes[i]!) : "needs a barre or a higher shape"} style={{ opacity: s.shapes[i] ? 1 : 0.45 }}>
                  {chordSymbol(c.ref)} → {shapeName(c)} shape
                </span>
              ))}
            </div>
            <div className="row tight" style={{ flex: "1 1 100%" }}>
              {s.shapes.slice(0, 7).map((v, i) => v && (
                <div key={i} style={{ textAlign: "center" }}>
                  <ChordDiagram voicing={v} root={chords[i].ref.root} labels={state.settings.labels} width={86} leftHanded={state.settings.leftHanded} />
                  <div className="tiny muted">{shapeName(chords[i])}</div>
                </div>
              ))}
            </div>
            <button className={`btn sm${state.settings.capo === s.capo ? " primary" : ""}`} onClick={() => { set((st) => ({ ...st, settings: { ...st.settings, capo: s.capo } })); toast(`Capo on fret ${s.capo}`); }}>
              {state.settings.capo === s.capo ? "✓ Capo on" : `Put capo on ${s.capo}`}
            </button>
          </div>
        );
      })}
      {state.settings.capo > 0 && (
        <button className="btn sm ghost" onClick={() => set((st) => ({ ...st, settings: { ...st.settings, capo: 0 } }))}>Remove capo</button>
      )}
    </section>
  );
}
