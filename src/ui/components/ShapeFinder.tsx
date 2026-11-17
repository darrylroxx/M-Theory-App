import { useEffect, useMemo, useState } from "react";
import { strum } from "../../audio/synth";
import { voicingsFor } from "../../guitar/arrange";
import { KIND_LABEL, kindOf, openChordIds, shapeBook, type ShapeGroup } from "../../guitar/shapes";
import { voicingText, type Voicing } from "../../guitar/voicings";
import { CHORD_CATEGORIES, CHORD_TYPES, chordSymbol, displaySuffix, getChordType, type ChordRef } from "../../theory/chords";
import { intervalNote } from "../../theory/intervals";
import { chordsInScale } from "../../theory/keys";
import { displayNote, pc } from "../../theory/notes";
import { useDraggable } from "../drag";
import { barOf, fitBeats, useApp, type ProgChord } from "../state";
import { lengthText } from "./BarRuler";
import { ChordDiagram } from "./ChordDiagram";
import { ChordNotes, ChordTheory } from "./ChordInfo";

type TabId = "common" | "small" | "inversions" | "all";
const TABS: TabId[] = ["common", "small", "inversions", "all"];
const TAB_LABEL: Record<TabId, string> = { common: "Common", small: "Small", inversions: "Inversions", all: "All" };

/** A small chord-box icon: "other ways to play this". */
export function ShapesIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M3 3.5h10M3 8h10M3 12.5h10M3 3.5v9M6.33 3.5v9M9.67 3.5v9M13 3.5v9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="6.33" cy="5.75" r="1.7" fill="currentColor" />
      <circle cx="9.67" cy="10.25" r="1.7" fill="currentColor" />
    </svg>
  );
}

/**
 * The shape finder: one chord, the ways guitarists really play it.
 * It opens on the shapes everybody knows; the other tabs branch out to small shapes,
 * inversions and everything else. Tap a shape to hear and use it, or drag it into the tray.
 */
export function ShapeFinder({ slotShape, onPinSlot }: { slotShape: (slotId: string) => Voicing | undefined; onPinSlot: (slotId: string, voicingId: string) => void }) {
  const { sheet, openSheet, state, set, tuning, shapeOf, setShape, addChord, toast } = useApp();
  const { capo, labels, leftHanded } = state.settings;
  const [tab, setTab] = useState<TabId>("common");
  const [info, setInfo] = useState(false);

  const ref = sheet?.ref;
  const refKey = ref ? `${ref.root}|${ref.typeId}|${ref.bass ?? ""}|${sheet?.slotId ?? ""}` : "";
  const chords = state.progression.chords;
  const slotIdx = sheet?.slotId ? chords.findIndex((c) => c.id === sheet.slotId) : -1;
  const slot = slotIdx >= 0 ? chords[slotIdx] : undefined;
  const picked = ref ? (slot ? slotShape(slot.id) ?? shapeOf(ref, slot.voicingId) : shapeOf(ref)) : undefined;

  const book = useMemo(() => {
    if (!ref) return null;
    const bassName = (token: string) => `${displayNote(token === "bass" ? ref.bass ?? "" : intervalNote(ref.root, token))} in the bass`;
    return shapeBook(voicingsFor(ref, tuning, capo), getChordType(ref.typeId), ref.bass ? [] : openChordIds(pc(ref.root), ref.typeId, tuning.notes, capo), bassName);
  }, [ref, tuning, capo]);

  const tabs: Record<TabId, ShapeGroup[]> = useMemo(
    () => (book ? { common: [{ title: "", shapes: book.common }], small: book.small, inversions: book.inversions, all: book.all } : { common: [], small: [], inversions: [], all: [] }),
    [book],
  );
  const has = (t: TabId, id?: string) => tabs[t].some((g) => g.shapes.some((v) => !id || v.id === id));
  // always start from the shapes everybody knows
  useEffect(() => setTab("common"), [refKey]);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openSheet(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, openSheet]);

  if (!sheet || !ref || !book) return null;
  const type = getChordType(ref.typeId);
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

  const slash = (v: Voicing) => (v.bassToken !== "1" && v.bassToken !== "bass" ? `/${displayNote(intervalNote(ref.root, v.bassToken))}` : "");
  const caption = (v: Voicing) => {
    const kind = KIND_LABEL[kindOf(v, type)];
    if (v === extra && tab === "common") return "In use";
    if (tab === "small") return slash(v) || "Root";
    if (tab === "inversions") return kind;
    return kind + (slash(v) ? ` ${slash(v)}` : "");
  };
  // the shape in use always shows on the first tab, even when it lives on another one
  const extra = picked && !has("common", picked.id) ? picked : null;
  const groups: ShapeGroup[] = tab === "common" && extra ? [{ title: "", shapes: [extra, ...book.common] }] : tabs[tab];
  const shown = TABS.filter((t) => has(t));

  return (
    <section className="finder" role="dialog" aria-label={`${chordSymbol(ref)}: ways to play`}>
      <div className="finder-head">
        <h2>{chordSymbol(ref)}{picked ? slash(picked) : ""}</h2>
        <ChordNotes chord={ref} />
        <span className="spacer" />
        {!slot && <button className="btn sm primary" onClick={() => { addChord(ref); toast(`${chordSymbol(ref)} added`); }}>+ Add</button>}
        <button className={`icon-btn${info ? " on" : ""}`} aria-label="About this chord" title="About this chord" aria-pressed={info} onClick={() => setInfo((v) => !v)}>i</button>
        <button className="icon-btn" aria-label="Close" onClick={() => openSheet(null)}>✕</button>
      </div>
      {info && <ChordTheory chord={ref} />}
      {slot && (
        <div className="finder-slot">
          <span className="pill">{slotIdx + 1} of {chords.length}</span>
          <button className="btn sm" aria-label="Move earlier" onClick={() => move(-1)} disabled={slotIdx === 0}>◀</button>
          <button className="btn sm" aria-label="Move later" onClick={() => move(1)} disabled={slotIdx === chords.length - 1}>▶</button>
          <span className="beats">
            <button aria-label="Shorter" onClick={() => patch({ beats: fitBeats(slot.beats - 0.5) })}>−</button>
            {lengthText(slot.beats, barOf(state.progression))}
            <button aria-label="Longer" onClick={() => patch({ beats: fitBeats(slot.beats + 0.5) })}>+</button>
          </span>
          <span className="spacer" />
          <button className="btn sm danger" onClick={() => { setChords((cs) => cs.filter((c) => c.id !== sheet.slotId)); openSheet(null); }}>Remove</button>
        </div>
      )}

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

      <div className="seg finder-tabs" role="tablist" aria-label="Kinds of shape">
        {shown.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>)}
      </div>

      <div className="shape-grid" role="tabpanel" aria-label={TAB_LABEL[tab]}>
        {groups.map((g) => (
          <Group key={g.title} title={g.title}>
            {g.shapes.map((v) => (
              <ShapeCard key={v.id} chord={ref} v={v} caption={caption(v)} picked={v.id === picked?.id} labels={labels} leftHanded={leftHanded} capo={capo} onPick={() => pick(v)} />
            ))}
          </Group>
        ))}
      </div>
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      {title && <h3 className="sg-title">{title}</h3>}
      {children}
    </>
  );
}

function ShapeCard({ chord, v, caption, picked, labels, leftHanded, capo, onPick }: {
  chord: ChordRef; v: Voicing; caption: string; picked: boolean;
  labels: "fingers" | "notes" | "intervals"; leftHanded: boolean; capo: number; onPick: () => void;
}) {
  const d = useDraggable({ ref: chord, voicingId: v.id }, onPick);
  return (
    <div className={`shape-card draggable${picked ? " picked" : ""}`} role="button" tabIndex={0} aria-pressed={picked} aria-label={`${caption}, ${voicingText(v)}`} title={voicingText(v)} {...d}
      onKeyDown={(e) => { if (e.key === "Enter") onPick(); }}>
      <ChordDiagram voicing={v} root={chord.root} bass={chord.bass} labels={labels} width={112} compact leftHanded={leftHanded} capo={capo} />
      <span className="sc-cap">{caption}</span>
    </div>
  );
}
