import { useEffect, useMemo, useRef, useState } from "react";
import { strum } from "../../audio/synth";
import { voicingsFor } from "../../guitar/arrange";
import { POSITIONS, buildShapeMap, type ShapeFilters } from "../../guitar/shapeMap";
import { voicingText, type Voicing } from "../../guitar/voicings";
import { CHORD_CATEGORIES, CHORD_TYPES, chordSymbol, displaySuffix, getChordType, type ChordRef } from "../../theory/chords";
import { intervalNote } from "../../theory/intervals";
import { chordsInScale } from "../../theory/keys";
import { displayNote, pc } from "../../theory/notes";
import { useDraggable } from "../drag";
import { useApp, type ProgChord } from "../state";
import { ChordDiagram, tokenLabel } from "./ChordDiagram";
import { ChordNotes, ChordTheory } from "./ChordInfo";
import { Seg } from "./common";

const INVERSION: Record<string, string> = { "1": "root position", "3": "1st inversion", b3: "1st inversion", "5": "2nd inversion", b5: "2nd inversion", "#5": "2nd inversion", "7": "3rd inversion", b7: "3rd inversion", bb7: "3rd inversion", "6": "3rd inversion" };

/**
 * The shape finder: one chord, every way to play it, laid out as a map.
 * Across = up the neck. Down = which note is in the bass. Tap a shape to use it,
 * drag it into the tray to add it.
 */
export function ShapeFinder({ slotShape, onPinSlot }: { slotShape: (slotId: string) => Voicing | undefined; onPinSlot: (slotId: string, voicingId: string) => void }) {
  const { sheet, openSheet, state, set, tuning, shapeOf, setShape, addChord, toast } = useApp();
  const { capo, labels, leftHanded, avoidBarre } = state.settings;
  const [strings, setStrings] = useState<ShapeFilters["strings"]>("any");
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(false);
  const [alt, setAlt] = useState<Record<string, number>>({});
  const mapRef = useRef<HTMLDivElement>(null);

  const ref = sheet?.ref;
  const refKey = ref ? `${ref.root}|${ref.typeId}|${ref.bass ?? ""}|${sheet?.slotId ?? ""}` : "";
  const chords = state.progression.chords;
  const slotIdx = sheet?.slotId ? chords.findIndex((c) => c.id === sheet.slotId) : -1;
  const slot = slotIdx >= 0 ? chords[slotIdx] : undefined;
  const picked = ref ? (slot ? slotShape(slot.id) ?? shapeOf(ref, slot.voicingId) : shapeOf(ref)) : undefined;

  const all = useMemo(() => (ref ? voicingsFor(ref, tuning, capo) : []), [ref, tuning, capo]);
  const rows = useMemo(
    () => (ref ? buildShapeMap(all, getChordType(ref.typeId), { strings, noBarre: avoidBarre, open }, picked?.id) : []),
    [all, ref, strings, avoidBarre, open, picked?.id],
  );

  useEffect(() => setAlt({}), [refKey, strings, avoidBarre, open]);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openSheet(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, openSheet]);
  // bring the shape in use into view when a chord is opened
  useEffect(() => {
    const el = mapRef.current?.querySelector<HTMLElement>(".cell.picked");
    const box = mapRef.current;
    if (el && box) box.scrollLeft = Math.max(0, el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2);
  }, [refKey]);

  if (!sheet || !ref) return null;
  const setChords = (fn: (c: ProgChord[]) => ProgChord[]) => set((s) => ({ ...s, progression: { ...s.progression, chords: fn(s.progression.chords) } }));
  const patch = (p: Partial<ProgChord>) => setChords((cs) => cs.map((c) => (c.id === sheet.slotId ? { ...c, ...p } : c)));
  const move = (d: -1 | 1) => setChords((cs) => {
    const i = cs.findIndex((c) => c.id === sheet.slotId);
    const j = i + d;
    if (i < 0 || j < 0 || j >= cs.length) return cs;
    const next = [...cs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const pick = (v: Voicing) => {
    strum(v.midi);
    if (slot) onPinSlot(slot.id, v.id);
    else setShape(ref, v.id);
  };
  // switch to another flavour of the same root (Cmaj7, Cadd9, Csus2 …)
  const flavour = (typeId: string) => {
    const next: ChordRef = { root: ref.root, typeId };
    if (slot) patch({ ref: next, voicingId: undefined });
    openSheet({ ref: next, slotId: sheet.slotId });
  };
  const inKey = chordsInScale(state.key).find((d) => pc(d.root) === pc(ref.root))?.chords.map((c) => c.type.id) ?? [];
  const flavours = [...new Set([ref.typeId, ...inKey])].sort(
    (a, b) => CHORD_CATEGORIES.indexOf(getChordType(a).category) - CHORD_CATEGORIES.indexOf(getChordType(b).category),
  );

  const bassNote = (token: string) => (token === "bass" ? ref.bass ?? "" : intervalNote(ref.root, token));
  const title = chordSymbol(ref) + (picked && picked.bassToken !== "1" && !ref.bass ? `/${displayNote(bassNote(picked.bassToken))}` : "");
  const cols = `46px repeat(${POSITIONS.length}, minmax(108px, 1fr))`;

  return (
    <section className="finder" role="dialog" aria-label={`${chordSymbol(ref)}: ways to play`}>
      <div className="finder-head">
        {picked && <NowPlaying chord={ref} v={picked} />}
        <div className="now-info">
          <div className="row tight">
            <h2>{title}</h2>
            {slot && <span className="pill">{slotIdx + 1} of {chords.length}</span>}
            <span className="spacer" />
            <button className={`icon-btn${info ? " on" : ""}`} aria-label="About this chord" title="About this chord" aria-pressed={info} onClick={() => setInfo((v) => !v)}>i</button>
            {!slot && <button className="icon-btn accent" aria-label="Add to tray" title="Add to tray" onClick={() => { addChord(ref); toast(`${chordSymbol(ref)} added`); }}>+</button>}
            <button className="icon-btn" aria-label="Close" onClick={() => openSheet(null)}>✕</button>
          </div>
          <ChordNotes chord={ref} />
          {picked && <p className="mono small muted">{voicingText(picked)}{INVERSION[picked.bassToken] ? ` · ${INVERSION[picked.bassToken]}` : ""}</p>}
          {slot && (
            <div className="row tight">
              <button className="btn sm" aria-label="Move earlier" onClick={() => move(-1)} disabled={slotIdx === 0}>◀</button>
              <button className="btn sm" aria-label="Move later" onClick={() => move(1)} disabled={slotIdx === chords.length - 1}>▶</button>
              <span className="beats">
                <button aria-label="Fewer beats" onClick={() => patch({ beats: Math.max(1, slot.beats - 1) })}>−</button>
                {slot.beats} beats
                <button aria-label="More beats" onClick={() => patch({ beats: Math.min(16, slot.beats + 1) })}>+</button>
              </span>
              <button className="btn sm danger" onClick={() => { setChords((cs) => cs.filter((c) => c.id !== sheet.slotId)); openSheet(null); }}>Remove</button>
            </div>
          )}
        </div>
      </div>
      {info && <ChordTheory chord={ref} />}

      <div className="flavours" role="radiogroup" aria-label="Chord flavour">
        {flavours.map((id) => (
          <button key={id} role="radio" aria-checked={id === ref.typeId} className={`chip${id === ref.typeId ? " on" : ""}`} title={getChordType(id).name} onClick={() => flavour(id)}>
            {chordSymbol({ root: ref.root, typeId: id })}
          </button>
        ))}
        <select className="chip-select" aria-label="Any chord type" value="" onChange={(e) => e.target.value && flavour(e.target.value)}>
          <option value="">All…</option>
          {CHORD_CATEGORIES.map((cat) => (
            <optgroup key={cat} label={cat}>
              {CHORD_TYPES.filter((t) => t.category === cat).map((t) => <option key={t.id} value={t.id}>{displayNote(ref.root)}{displaySuffix(t.symbol)} · {t.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="finder-filters">
        <span className="kb-label">Strings</span>
        <Seg value={strings} options={[{ value: "any", label: "Any" }, { value: 3, label: "3" }, { value: 4, label: "4" }, { value: 5, label: "5–6" }]} onChange={setStrings} label="Strings" />
        <button className={`chip${avoidBarre ? " on" : ""}`} aria-pressed={avoidBarre} onClick={() => set((s) => ({ ...s, settings: { ...s.settings, avoidBarre: !s.settings.avoidBarre } }))}>No barre</button>
        <button className={`chip${open ? " on" : ""}`} aria-pressed={open} onClick={() => setOpen((v) => !v)}>Open strings</button>
        <span className="spacer" />
        <Seg value={labels} options={[{ value: "fingers", label: "123" }, { value: "notes", label: "ABC" }, { value: "intervals", label: "R35" }]}
          onChange={(v) => set((s) => ({ ...s, settings: { ...s.settings, labels: v } }))} label="Dots show fingers, notes or intervals" />
      </div>

      <div className="shape-map-wrap" ref={mapRef}>
        <div className="shape-map" style={{ gridTemplateColumns: cols }}>
          <div className="sm-corner"><span>fret →</span><span>bass ↓</span></div>
          {POSITIONS.map((p) => <div key={p} className="sm-col">{p}</div>)}
          {rows.map((row) => (
            <RowCells key={row.token} label={displayNote(bassNote(row.token))} sub={row.token === "bass" ? "bass" : tokenLabel(row.token)}>
              {row.cells.map((cell, ci) => {
                const k = `${row.token}:${ci}`;
                const pi = cell.findIndex((v) => v.id === picked?.id);
                const i = Math.min(alt[k] ?? Math.max(pi, 0), cell.length - 1);
                return cell.length === 0 ? (
                  <div key={k} className="cell empty" aria-hidden="true" />
                ) : (
                  <Cell key={k} chord={ref} v={cell[i]} index={i} count={cell.length} picked={cell[i].id === picked?.id}
                    labels={labels} leftHanded={leftHanded} capo={capo} onPick={() => pick(cell[i])}
                    onStep={(d) => { const n = (i + d + cell.length) % cell.length; setAlt((a) => ({ ...a, [k]: n })); pick(cell[n]); }} />
                );
              })}
            </RowCells>
          ))}
        </div>
      </div>
    </section>
  );
}

function RowCells({ label, sub, children }: { label: string; sub: string; children: React.ReactNode }) {
  return (
    <>
      <div className="sm-row"><b>{label}</b><span>{sub}</span></div>
      {children}
    </>
  );
}

/** The shape in use, large. Drag it into the tray. */
function NowPlaying({ chord, v }: { chord: ChordRef; v: Voicing }) {
  const { state } = useApp();
  const d = useDraggable({ ref: chord, voicingId: v.id }, () => strum(v.midi));
  return (
    <div className="now draggable" role="button" tabIndex={0} aria-label="Play this shape" {...d} onKeyDown={(e) => { if (e.key === "Enter") strum(v.midi); }}>
      <ChordDiagram voicing={v} root={chord.root} bass={chord.bass} labels={state.settings.labels} width={124} compact leftHanded={state.settings.leftHanded} capo={state.settings.capo} />
    </div>
  );
}

function Cell({ chord, v, index, count, picked, labels, leftHanded, capo, onPick, onStep }: {
  chord: ChordRef; v: Voicing; index: number; count: number; picked: boolean;
  labels: "fingers" | "notes" | "intervals"; leftHanded: boolean; capo: number;
  onPick: () => void; onStep: (d: -1 | 1) => void;
}) {
  const d = useDraggable({ ref: chord, voicingId: v.id }, onPick);
  const level = v.difficulty < 3 ? "easy" : v.difficulty < 5 ? "medium" : "hard";
  return (
    <div className={`cell draggable${picked ? " picked" : ""}`}>
      <div className="cell-main" role="button" tabIndex={0} aria-pressed={picked} aria-label={`Use ${voicingText(v)}`} title={voicingText(v)} {...d} onKeyDown={(e) => { if (e.key === "Enter") onPick(); }}>
        <ChordDiagram voicing={v} root={chord.root} bass={chord.bass} labels={labels} width={112} compact leftHanded={leftHanded} capo={capo} />
      </div>
      <div className="cell-step" data-nodrag>
        {count > 1 && <button aria-label="Previous shape here" onClick={() => onStep(-1)}>‹</button>}
        <span><i className={`lvl ${level}`} title={level} />{count > 1 ? `${index + 1}/${count}` : ""}</span>
        {count > 1 && <button aria-label="Next shape here" onClick={() => onStep(1)}>›</button>}
      </div>
    </div>
  );
}
