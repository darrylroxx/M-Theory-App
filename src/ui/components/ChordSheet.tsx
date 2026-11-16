import { useEffect } from "react";
import { chordSymbol, getChordType } from "../../theory/chords";
import { useApp } from "../state";
import { ChordInfo } from "./ChordInfo";
import { VoicingBrowser } from "./VoicingBrowser";

/** Pop-up with everything about a chord and every way to play it. */
export function ChordSheet() {
  const { sheet, openSheet, set, addChord, toast } = useApp();
  const { state } = useApp();

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
            <p className="muted small">{getChordType(ref.typeId).name}</p>
          </div>
          <button className="icon-btn sheet-close" aria-label="Close" onClick={() => openSheet(null)}>✕</button>
        </div>
        <div className="stack">
          {slot && <div className="callout small"><b>Pick a shape</b> for chord {state.progression.chords.indexOf(slot) + 1} of your song.</div>}
          <ChordInfo chord={ref} onOpen={(r) => openSheet({ ref: r, slotId })} showAdd={!slot} />
          <div>
            <h3 style={{ marginBottom: 8 }}>Ways to play it</h3>
            <VoicingBrowser
              chord={ref}
              pickedId={slot?.voicingId}
              useLabel={slot ? "Use this shape" : "+ Add this shape"}
              onUse={(v) => {
                if (slot) {
                  set((s) => ({
                    ...s,
                    progression: { ...s.progression, chords: s.progression.chords.map((c) => (c.id === slot.id ? { ...c, voicingId: v.id } : c)) },
                  }));
                  toast("Shape changed");
                  openSheet(null);
                } else addChord(ref, { voicingId: v.id });
              }}
            />
          </div>
          <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => { set((s) => ({ ...s, tab: "chords", explore: ref })); openSheet(null); }}>
            Open in the Chords tab →
          </button>
        </div>
      </div>
    </div>
  );
}
