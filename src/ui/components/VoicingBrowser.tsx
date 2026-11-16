import { useMemo, useState } from "react";
import { strum } from "../../audio/synth";
import { voicingsFor } from "../../guitar/arrange";
import { voicingText, type Voicing } from "../../guitar/voicings";
import { chordSymbol, type ChordRef } from "../../theory/chords";
import { useApp } from "../state";
import { ChordDiagram } from "./ChordDiagram";
import { Seg } from "./common";

type Style = "best" | "nobarre" | "open" | "small" | "high" | "all";
type Bass = "root" | "any" | "inv";

const STYLES: { value: Style; label: string; hint: string }[] = [
  { value: "best", label: "Best", hint: "The most useful shapes first" },
  { value: "nobarre", label: "No barre", hint: "Nothing that needs a full barre" },
  { value: "open", label: "Open strings", hint: "Shapes that let open strings ring" },
  { value: "small", label: "Small (3 strings)", hint: "Compact triads, great for riffs and layering" },
  { value: "high", label: "Up the neck", hint: "Shapes from fret 5 and higher" },
  { value: "all", label: "Everything", hint: "Every playable shape, including inversions" },
];

function matches(v: Voicing, style: Style, bass: Bass, maxDiff: number, slash: boolean): boolean {
  if (v.difficulty > maxDiff) return false;
  const sounding = v.frets.filter((f) => f !== null).length;
  switch (style) {
    case "nobarre": if (v.barreKind === "full") return false; break;
    case "open": if (v.openStrings === 0) return false; break;
    case "small": if (sounding !== 3) return false; break;
    case "high": if (v.minFret < 5) return false; break;
  }
  if (!slash && style !== "all") {
    if (bass === "root" && v.bassToken !== "1") return false;
    if (bass === "inv" && v.bassToken === "1") return false;
  }
  return true;
}

/** Every way to play a chord, with one row of simple filters. */
export function VoicingBrowser({ chord, onUse, useLabel = "+ Add", pickedId }: {
  chord: ChordRef;
  onUse?: (v: Voicing) => void;
  useLabel?: string;
  pickedId?: string;
}) {
  const { state, tuning, set } = useApp();
  const { capo, labels, leftHanded, avoidBarre } = state.settings;
  const [style, setStyle] = useState<Style>(avoidBarre ? "nobarre" : "best");
  const [bass, setBass] = useState<Bass>("root");
  const [maxDiff, setMaxDiff] = useState(99);
  const [more, setMore] = useState(false);
  const [shown, setShown] = useState(12);
  const slash = !!chord.bass && chord.bass !== chord.root;

  const all = useMemo(() => voicingsFor(chord, tuning, capo), [chord, tuning, capo]);
  const list = useMemo(() => all.filter((v) => matches(v, style, bass, maxDiff, slash)), [all, style, bass, maxDiff, slash]);
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setShown(12); };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row tight">
        <Seg value={style} options={STYLES.map((s) => ({ value: s.value, label: s.label }))} onChange={reset(setStyle)} label="Shape style" />
        <button className="btn sm ghost" onClick={() => setMore((m) => !m)} aria-expanded={more}>{more ? "Fewer options" : "More options"}</button>
      </div>
      {more && (
        <div className="filters-more">
          {!slash && (
            <div className="row tight"><span className="filter-label">Lowest note</span>
              <Seg value={bass} options={[{ value: "root", label: "Root" }, { value: "any", label: "Any" }, { value: "inv", label: "Inversions only" }]} onChange={reset(setBass)} label="Bass note" />
            </div>
          )}
          <div className="row tight"><span className="filter-label">Difficulty</span>
            <Seg value={maxDiff} options={[{ value: 99, label: "Any" }, { value: 3, label: "Easy" }, { value: 5, label: "Easy + medium" }]} onChange={reset(setMaxDiff)} label="Difficulty" />
          </div>
          <div className="row tight"><span className="filter-label">Dots show</span>
            <Seg value={labels} options={[{ value: "intervals", label: "Intervals" }, { value: "notes", label: "Notes" }, { value: "fingers", label: "Fingers" }]}
              onChange={(v) => set((s) => ({ ...s, settings: { ...s.settings, labels: v } }))} label="Dot labels" />
          </div>
        </div>
      )}
      <p className="small muted">
        {STYLES.find((s) => s.value === style)?.hint}. Showing <b>{Math.min(shown, list.length)}</b> of {list.length} ways to play {chordSymbol(chord)}{capo ? ` (capo ${capo})` : ""}. Tap a shape to hear it.
      </p>
      {list.length === 0 ? (
        <div className="empty">No shapes match. Try “Best” or “Everything”.</div>
      ) : (
        <div className="voicing-grid">
          {list.slice(0, shown).map((v) => {
            const level = v.difficulty < 3 ? "Easy" : v.difficulty < 5 ? "Medium" : "Hard";
            return (
              <div key={v.id} className={`voicing-card${pickedId === v.id ? " picked" : ""}`}>
                <button className="diagram-btn" onClick={() => strum(v.midi)} aria-label={`Play ${voicingText(v)}`}>
                  <ChordDiagram voicing={v} root={chord.root} bass={chord.bass} labels={labels} leftHanded={leftHanded} capo={capo} />
                </button>
                <div className="tags">
                  <span className={`pill ${level.toLowerCase()}`}>{level}</span>
                  {v.barreKind === "full" ? <span className="pill">Barre</span> : v.openStrings > 0 ? <span className="pill">Open strings</span> : null}
                </div>
                {v.bassToken !== "1" && !slash && <div className="tiny faint">{v.inversion}</div>}
                {onUse && <button className={`btn sm${pickedId === v.id ? " primary" : ""}`} onClick={() => onUse(v)}>{pickedId === v.id ? "✓ Using" : useLabel}</button>}
              </div>
            );
          })}
        </div>
      )}
      {list.length > shown && (
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn" onClick={() => setShown((n) => n + 12)}>Show more ({list.length - shown} left)</button>
        </div>
      )}
    </div>
  );
}
