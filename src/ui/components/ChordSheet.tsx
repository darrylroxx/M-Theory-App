import { useEffect, useState } from "react";
import { chordSymbol } from "../../theory/chords";
import { useApp, type ProgChord } from "../state";
import { ChordNotes, ChordTheory } from "./ChordInfo";
import { VoicingBrowser } from "./VoicingBrowser";

/** Pop-up for one chord: every way to play it. Tap a shape to choose it. */
export function ChordSheet() {
  const { sheet, openSheet, state, set, addChord, audition, shapeOf, setShape, toast } = useApp();
  const [info, setInfo] = useState(false);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openSheet(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, openSheet]);

  if (!sheet) return null;
  const { ref, slotId } = sheet;
  const chords = state.progression.chords;
  const idx = slotId ? chords.findIndex((c) => c.id === slotId) : -1;
  const slot = idx >= 0 ? chords[idx] : undefined;
  const picked = shapeOf(ref, slot?.voicingId);
  const setChords = (fn: (c: ProgChord[]) => ProgChord[]) => set((s) => ({ ...s, progression: { ...s.progression, chords: fn(s.progression.chords) } }));
  const patch = (p: Partial<ProgChord>) => setChords((cs) => cs.map((c) => (c.id === slotId ? { ...c, ...p } : c)));
  const move = (d: -1 | 1) => setChords((cs) => {
    const i = cs.findIndex((c) => c.id === slotId);
    const j = i + d;
    if (i < 0 || j < 0 || j >= cs.length) return cs;
    const next = [...cs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  return (
    <div className="sheet-backdrop" onClick={() => openSheet(null)}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={chordSymbol(ref)} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{chordSymbol(ref)}</h2>
          <ChordNotes chord={ref} />
          <div className="row tight sheet-close">
            <button className="icon-btn" aria-label="Play" title="Play" onClick={() => audition(ref)}>▶</button>
            <button className={`icon-btn${info ? " on" : ""}`} aria-label="About this chord" title="About this chord" aria-pressed={info} onClick={() => setInfo((v) => !v)}>i</button>
            {!slot && <button className="icon-btn accent" aria-label="Add to progression" title="Add to progression" onClick={() => { addChord(ref); toast(`${chordSymbol(ref)} added`); }}>+</button>}
            <button className="icon-btn" aria-label="Close" onClick={() => openSheet(null)}>✕</button>
          </div>
        </div>
        <div className="stack" style={{ gap: 12 }}>
          {info && <ChordTheory chord={ref} onOpen={(r) => openSheet({ ref: r, slotId })} />}
          {slot && (
            <div className="row tight slot-tools">
              <span className="pill">Chord {idx + 1}</span>
              <button className="btn sm" aria-label="Move earlier" onClick={() => move(-1)} disabled={idx === 0}>◀</button>
              <button className="btn sm" aria-label="Move later" onClick={() => move(1)} disabled={idx === chords.length - 1}>▶</button>
              <span className="beats">
                <button aria-label="Fewer beats" onClick={() => patch({ beats: Math.max(1, slot.beats - 1) })}>−</button>
                {slot.beats} beats
                <button aria-label="More beats" onClick={() => patch({ beats: Math.min(16, slot.beats + 1) })}>+</button>
              </span>
              <span className="spacer" />
              <button className="btn sm danger" onClick={() => { setChords((cs) => cs.filter((c) => c.id !== slotId)); openSheet(null); }}>Remove</button>
            </div>
          )}
          <VoicingBrowser
            chord={ref}
            pickedId={picked?.id}
            onPick={(v) => (slot ? patch({ voicingId: v.id }) : setShape(ref, v.id))}
          />
        </div>
      </div>
    </div>
  );
}
