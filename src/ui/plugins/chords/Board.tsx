// The chord board of the Chords plugin: the chords to pick from. "In key": one card for each note of the scale (tap
// a card to hear it and to list everything the key offers on that note: sus, sixths, sevenths, ninths …). "Outside":
// chords borrowed from other scales, lead-ins and swaps. "Next": what could follow the last chord in the tray.
// A chord is added with its + or by dragging it into the tray; "Shapes" opens the shape finder for it.
//
// Copied out of the old Chords page (its board, its chord cards, the chords outside the key, the capo picker), and
// laid out for a plugin window: the lists scroll inside the board, and the bar for the chord last tapped (its name,
// Shapes and +) stays in sight at the board's lower edge. It reads the open clip's key, capo and shapes through the
// old pages' context (windows/ClipLens).
import { memo, useMemo, useState } from "react";
import { keysVoicing } from "../../../audio/tone";
import { capoSuggestions } from "../../../guitar/arrange";
import { CHORD_CATEGORIES, chordSymbol, type ChordRef } from "../../../theory/chords";
import { CHORD_ROWS, ROLE_INFO, borrowedChords, chordRow, chordsInScale, diatonicChords, spiceChords, type KeyChord, type Role } from "../../../theory/keys";
import { displayNote, pc } from "../../../theory/notes";
import { getScale, isHeptatonic } from "../../../theory/scales";
import { ChordDiagram } from "../../components/ChordDiagram";
import { ROLE_CLASS, Seg, displayRoman } from "../../components/common";
import { KeyboardDiagram } from "../../components/KeyboardDiagram";
import { ShapesIcon } from "../../components/ShapeFinder";
import { useDraggable } from "../../drag";
import { useApp } from "../../state";
import { NextChords } from "./Next";
import { PickCtx, Pill, sameRef, useKeys } from "./parts";

type View = "key" | "outside" | "next";
/** Short names for the kinds of chord. */
const KIND: Record<string, string> = { Triads: "Triads", "Power & Sus": "Sus", Sixths: "6ths", Sevenths: "7ths", "Added tones": "Added", "Extended (9, 11, 13)": "Extended", "Altered dominants": "Altered" };

/** The capo: which fret it is on, with the fret that gives the most open shapes in this key marked. */
function CapoPick() {
  const { state, set, tuning } = useApp();
  const key = state.key;
  const hepta = isHeptatonic(getScale(key.scaleId));
  const capo = state.settings.capo;
  // which capo gives the most open (no-barre) shapes in this key
  const bestCapo = useMemo(() => {
    if (!hepta) return null;
    const chords = diatonicChords(key, 3).map((c) => ({ rootPc: pc(c.ref.root), type: c.type }));
    const s = capoSuggestions(chords, tuning);
    const none = s.find((x) => x.capo === 0);
    return none && s[0].capo !== 0 && s[0].easy - none.easy >= 2 ? s[0].capo : null;
  }, [key, tuning, hepta]);
  return (
    <label className="capo">
      Capo
      <select value={capo} onChange={(e) => set((s) => ({ ...s, settings: { ...s.settings, capo: Number(e.target.value) } }))}>
        {Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{i === 0 ? "None" : i}{i === bestCapo ? " ★ no barres" : ""}</option>)}
      </select>
    </label>
  );
}

/**
 * The chords of the key. One card per note of the scale; tap a card and everything the key
 * offers on that note is listed under it (sus, sixths, sevenths, ninths …).
 * `onKey`: the key chip was pressed (the key is the whole song's: it is changed in the top bar).
 */
export const ChordBoard = memo(function ChordBoard({ onKey }: { onKey: () => void }) {
  const { state, openSheet, addChord, toast } = useApp();
  const keys = useKeys();
  const [sel, setSel] = useState<ChordRef | null>(null);
  const pickCtx = useMemo(() => ({ sel, setSel }), [sel]);
  const key = state.key;
  const scale = getScale(key.scaleId);
  const hepta = isHeptatonic(scale);
  const [view, setView] = useState<View>("key");
  /** which kind of chord the cards show: triads, sevenths, sus chords … */
  const [kind, setKind] = useState("triads");
  const [deg, setDeg] = useState(1);
  const all = useMemo(() => chordsInScale(key), [key]);
  // each note's card: the chord of this kind that uses only notes of the key (none where it does not fit)
  const cards = useMemo(() => chordRow(key, kind), [key, kind]);
  const row = CHORD_ROWS.find((r) => r.id === kind) ?? CHORD_ROWS[0];
  const fits = cards.filter((c) => c).length;
  const degree = all.find((d) => d.degree === deg) ?? all[0];
  const picked = sel && view === "key" ? degree?.chords.some((c) => sameRef(sel, c.ref)) : !!sel;

  return (
    <section className={`card board cp-board${sel && picked ? " picking" : ""}`} aria-label="Chords to pick from">
      <div className="cp-scroll">
        <div className="board-head">
          <Seg value={view} options={[{ value: "key", label: "In key" }, { value: "outside", label: "Outside" }, { value: "next", label: "Next" }]} onChange={setView} label="Which chords" />
          <span className="board-set">
            <button className="key-chip" title="The key of the song" aria-label={`The key of the song: ${displayNote(key.tonic)} ${scale.short}. Change it`} onClick={onKey}>{displayNote(key.tonic)} {scale.short}</button>
            {/* the capo is a guitar's: a chords track on the keys has none */}
            {!keys && <CapoPick />}
          </span>
          {view === "key" && (
            <div className="seg kinds" role="radiogroup" aria-label="Which kind of chord the cards show">
              {CHORD_ROWS.map((r) => <button key={r.id} role="radio" aria-checked={kind === r.id} className={kind === r.id ? "on" : ""} title={r.hint} onClick={() => setKind(r.id)}>{r.label}</button>)}
            </div>
          )}
        </div>
        <PickCtx.Provider value={pickCtx}>
          {view === "key" && (
            <>
              <div className="key-chords">
                {cards.map((c, i) =>
                  c ? <ChordCard key={`${all[i].degree}-${c.type.id}`} c={c} on={degree?.degree === all[i].degree} onPick={() => setDeg(all[i].degree)} />
                    : <button key={all[i].degree} className={`kc bare${degree?.degree === all[i].degree ? " on" : ""}`} title={`No ${row.label} chord on ${displayNote(all[i].root)} stays in the key. Tap for the chords that do`} onClick={() => setDeg(all[i].degree)}><span className="kc-name">{displayNote(all[i].root)}</span><span className="kc-none">—</span></button>,
                )}
              </div>
              {fits === 0 && <span className="faint tiny">No {row.label} chords fit this scale</span>}
              {degree && (
                <div className="deg-all" role="group" aria-label={`Every chord in the key on ${displayNote(degree.root)}`}>
                  {CHORD_CATEGORIES.filter((cat) => degree.chords.some((c) => c.type.category === cat)).map((cat) => (
                    <div key={cat} className="degree-row wide">
                      <div className="degree-label">{KIND[cat] ?? cat}</div>
                      <div className="row tight">{degree.chords.filter((c) => c.type.category === cat).map((c) => <Pill key={c.type.id} chord={c.ref} title={c.type.name} />)}</div>
                    </div>
                  ))}
                  {!degree.chords.length && <span className="faint tiny">No chord fits on {displayNote(degree.root)} in this scale</span>}
                </div>
              )}
              {hepta && (
                <div className="role-legend">
                  {(Object.keys(ROLE_INFO) as Role[]).map((r) => <span key={r} title={ROLE_INFO[r].blurb}><i className={`dot ${ROLE_CLASS[r]}`} />{ROLE_INFO[r].label}</span>)}
                  <span title="Contains the mode's signature note"><b style={{ color: "var(--ext)" }}>★</b> Signature</span>
                </div>
              )}
            </>
          )}
          {view === "outside" && <OutsideChords />}
          {view === "next" && <NextChords />}
        </PickCtx.Provider>
      </div>
      {/* the chord last tapped in a list: kept in sight, wherever the lists are scrolled to */}
      {sel && picked && (
        <div className="pick-bar" role="group" aria-label={`${chordSymbol(sel)}: its shapes, or add it`}>
          <b>{chordSymbol(sel)}</b>
          {!keys && <button className="shapes-btn" onClick={() => openSheet({ ref: sel })}><ShapesIcon /><span>Shapes</span></button>}
          <button className="kc-add" aria-label={`Add ${chordSymbol(sel)}`} onClick={() => { addChord(sel); toast(`${chordSymbol(sel)} added`); }}>+</button>
        </div>
      )}
    </section>
  );
});

function ChordCard({ c, on, onPick }: { c: KeyChord; on: boolean; onPick: () => void }) {
  const { state, openSheet, audition, addChord, shapeOf } = useApp();
  const { capo, labels, leftHanded } = state.settings;
  const v = shapeOf(c.ref);
  const keys = useKeys();
  const tap = () => { audition(c.ref); onPick(); };
  const d = useDraggable({ ref: c.ref }, tap);
  const name = chordSymbol(c.ref);
  return (
    <div className={`kc draggable role-${c.role}${on ? " on" : ""}`} role="button" tabIndex={0} aria-pressed={on} aria-label={`${name}${c.role ? `, ${ROLE_INFO[c.role].label}` : ""}. Play, and list its other chords`} title={c.role ? ROLE_INFO[c.role].label : undefined} {...d}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) tap(); }}>
      <span className="kc-head">
        <span className="kc-roman">{displayRoman(c.roman)}</span>
        {c.signature && <span className="kc-star">★</span>}
      </span>
      <span className="kc-name">{name}</span>
      {keys ? <KeyboardDiagram notes={keysVoicing(c.ref, keys)} chord={c.ref} keyOf={state.key} labels={labels === "fingers" ? "intervals" : labels} width={120} compact />
        : v && <ChordDiagram voicing={v} root={c.ref.root} labels={labels} width={120} leftHanded={leftHanded} capo={capo} />}
      <div className="kc-actions" data-nodrag>
        {!keys && <button className="shapes-btn" aria-label={`Other ways to play ${name}`} title="Other ways to play it" aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); openSheet({ ref: c.ref }); }}><ShapesIcon /><span>Shapes</span></button>}
        <button className="kc-add" aria-label={`Add ${name}`} onClick={(e) => { e.stopPropagation(); addChord(c.ref); }}>+</button>
      </div>
    </div>
  );
}

function OutsideChords() {
  const { state } = useApp();
  const key = state.key;
  const borrowed = useMemo(() => borrowedChords(key), [key]);
  const spice = useMemo(() => spiceChords(key), [key]);
  const sources = [...new Set(borrowed.map((c) => c.fromIds[0]))];
  return (
    <div>
      {sources.map((sid) => (
        <div key={sid} className="degree-row wide">
          <div className="degree-label">{getScale(sid).short}</div>
          <div className="row tight">
            {borrowed.filter((c) => c.fromIds[0] === sid).map((c) => <Pill key={c.ref.root + c.type.id} chord={c.ref} title={c.explain} />)}
          </div>
        </div>
      ))}
      {spice.map((g) => (
        <div key={g.group} className="degree-row wide">
          <div className="degree-label" title={g.blurb}>{g.group.replace("Secondary dominants", "Lead-ins").replace("Chromatic mediants", "Cinematic").replace("Tritone substitutions", "Jazz swaps").replace("Passing diminished", "Passing")}</div>
          <div className="row tight">
            {g.chords.map((c) => <Pill key={c.roman + c.ref.root} chord={c.ref} title={c.short ?? c.explain} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
