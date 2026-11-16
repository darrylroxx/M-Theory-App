import { useMemo, useState } from "react";
import { strum } from "../../audio/synth";
import { voicingsFor } from "../../guitar/arrange";
import { voicingText, type Voicing } from "../../guitar/voicings";
import type { ChordRef } from "../../theory/chords";
import { parseInterval } from "../../theory/intervals";
import { useApp } from "../state";
import { ChordDiagram } from "./ChordDiagram";
import { Seg } from "./common";

type Filter = "all" | "open" | "nobarre" | "barre" | "inv" | "small";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "nobarre", label: "No barre" },
  { value: "barre", label: "Barre" },
  { value: "inv", label: "Inversions" },
  { value: "small", label: "3-string" },
];

function matches(v: Voicing, f: Filter): boolean {
  switch (f) {
    case "open": return v.openStrings > 0;
    case "nobarre": return v.barreKind !== "full";
    case "barre": return v.barreKind === "full";
    case "inv": return v.bassToken !== "1";
    case "small": return v.frets.filter((x) => x !== null).length === 3;
    default: return true;
  }
}

/** Short label for what's in the bass: "" for root position, "1st inv", "2nd inv"… */
export function inversionTag(v: Voicing): string {
  if (v.bassToken === "1" || v.bassToken === "bass") return "";
  const n = parseInterval(v.bassToken).number;
  return n === 3 ? "1st inv" : n === 5 ? "2nd inv" : n === 7 || n === 6 ? "3rd inv" : `${v.bassToken.replace(/b/g, "♭").replace(/#/g, "♯")} bass`;
}

/** Every way to play a chord. Tap a shape to hear it and choose it. */
export function VoicingBrowser({ chord, pickedId, onPick }: { chord: ChordRef; pickedId?: string; onPick: (v: Voicing) => void }) {
  const { state, tuning, set } = useApp();
  const { capo, labels, leftHanded } = state.settings;
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(12);

  const all = useMemo(() => voicingsFor(chord, tuning, capo), [chord, tuning, capo]);
  const list = useMemo(() => {
    const l = all.filter((v) => matches(v, filter));
    // keep the chosen shape first so it's always in view
    const i = l.findIndex((v) => v.id === pickedId);
    return i > 0 ? [l[i], ...l.slice(0, i), ...l.slice(i + 1)] : l;
  }, [all, filter, pickedId]);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row tight" style={{ justifyContent: "space-between" }}>
        <Seg value={filter} options={FILTERS} onChange={(f) => { setFilter(f); setShown(12); }} label="Filter shapes" />
        <Seg value={labels} options={[{ value: "fingers", label: "Fingers" }, { value: "notes", label: "Notes" }, { value: "intervals", label: "Intervals" }]}
          onChange={(v) => set((s) => ({ ...s, settings: { ...s.settings, labels: v } }))} label="Dots show" />
      </div>
      {list.length === 0 ? (
        <div className="empty">None</div>
      ) : (
        <div className="voicing-grid">
          {list.slice(0, shown).map((v) => {
            const level = v.difficulty < 3 ? "easy" : v.difficulty < 5 ? "medium" : "hard";
            const inv = inversionTag(v);
            return (
              <button key={v.id} className={`voicing-card${pickedId === v.id ? " picked" : ""}`} aria-pressed={pickedId === v.id}
                aria-label={`${voicingText(v)}${inv ? `, ${inv}` : ""}`} onClick={() => { strum(v.midi); onPick(v); }}>
                {pickedId === v.id && <span className="check">✓</span>}
                <ChordDiagram voicing={v} root={chord.root} bass={chord.bass} labels={labels} leftHanded={leftHanded} capo={capo} />
                <span className="frets-text mono"><i className={`lvl ${level}`} title={level} />{voicingText(v)}</span>
                {(inv || v.barreKind === "full") && <span className="tiny faint">{[inv, v.barreKind === "full" ? "barre" : ""].filter(Boolean).join(" · ")}</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="row" style={{ justifyContent: "center" }}>
        {list.length > shown
          ? <button className="btn" onClick={() => setShown((n) => n + 24)}>More ({list.length - shown})</button>
          : <span className="tiny faint">{list.length} shape{list.length === 1 ? "" : "s"}</span>}
      </div>
    </div>
  );
}
