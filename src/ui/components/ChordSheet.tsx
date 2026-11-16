import { useEffect } from "react";
import { chordSymbol, getChordType } from "../../theory/chords";
import { useApp } from "../state";
import { ChordInfo } from "./ChordInfo";
import { VoicingBrowser } from "./VoicingBrowser";

/** Pop-up with everything about a chord + all its voicings. */
export function ChordSheet() {
  const { sheet, openSheet, state, set, addChord, toast } = useApp();

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openSheet(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, openSheet]);

  if (!sheet) return null;
  const { ref, slotId } = sheet;
  const slot = slotId ? state.progression.chords.find((c) => c.id === slotId) : undefined;

  return (
    <div className="sheet-backdrop" onClick={() => openSheet(null)}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={chordSymbol(ref)} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <h2>{chordSymbol(ref)}</h2>
            <p className="muted small">{getChordType(ref.typeId).name}{slot ? " · choose a voicing for this slot" : ""}</p>
          </div>
          <button className="icon-btn sheet-close" aria-label="Close" onClick={() => openSheet(null)}>✕</button>
        </div>
        <div className="row tight" style={{ marginBottom: 14 }}>
          {!slot && <button className="btn primary sm" onClick={() => addChord(ref)}>+ Add to progression</button>}
          <button className="btn sm" onClick={() => { set((s) => ({ ...s, tab: "chords", explore: ref })); openSheet(null); }}>Open in Chords tab</button>
        </div>
        <div className="stack">
          <ChordInfo chord={ref} onOpen={(r) => openSheet({ ref: r, slotId })} />
          <hr className="sep" />
          <VoicingBrowser
            chord={ref}
            pickedId={slot?.voicingId}
            useLabel={slot ? "Use this" : "+ Add"}
            onUse={(v) => {
              if (slot) {
                set((s) => ({
                  ...s,
                  progression: { ...s.progression, chords: s.progression.chords.map((c) => (c.id === slot.id ? { ...c, voicingId: v.id } : c)) },
                }));
                toast("Voicing pinned");
                openSheet(null);
              } else addChord(ref, { voicingId: v.id });
            }}
          />
        </div>
      </div>
    </div>
  );
}
