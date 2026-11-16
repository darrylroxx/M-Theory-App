import { useMemo, useState } from "react";
import { strum } from "../../audio/synth";
import { voicingsFor } from "../../guitar/arrange";
import { voicingText, type Voicing } from "../../guitar/voicings";
import type { ChordRef } from "../../theory/chords";
import { useApp } from "../state";
import { ChordDiagram } from "./ChordDiagram";
import { Seg } from "./common";

type Style = "all" | "nobarre" | "open" | "triad" | "top" | "barre";
type Bass = "root" | "any" | "inv";
type Zone = "all" | "low" | "mid" | "high";

const STYLE_OPTS: { value: Style; label: string }[] = [
  { value: "all", label: "All" },
  { value: "nobarre", label: "No barre" },
  { value: "open", label: "Open strings" },
  { value: "triad", label: "3-string" },
  { value: "top", label: "Top strings" },
  { value: "barre", label: "Barre" },
];

function matches(v: Voicing, style: Style, bass: Bass, zone: Zone, maxDiff: number, slash: boolean): boolean {
  if (v.difficulty > maxDiff) return false;
  const sounding = v.frets.filter((f) => f !== null).length;
  switch (style) {
    case "nobarre": if (v.barreKind === "full") return false; break;
    case "open": if (v.openStrings === 0) return false; break;
    case "triad": if (sounding !== 3) return false; break;
    case "top": if (!v.tags.includes("Top strings")) return false; break;
    case "barre": if (v.barreKind !== "full") return false; break;
  }
  if (!slash) {
    if (bass === "root" && v.bassToken !== "1") return false;
    if (bass === "inv" && v.bassToken === "1") return false;
  }
  const c = v.minFret;
  if (zone === "low" && v.maxFret > 5) return false;
  if (zone === "mid" && (c < 4 || v.maxFret > 10)) return false;
  if (zone === "high" && c < 9) return false;
  return true;
}

export function VoicingBrowser({ chord, onUse, useLabel = "Add", pickedId }: {
  chord: ChordRef;
  onUse?: (v: Voicing) => void;
  useLabel?: string;
  pickedId?: string;
}) {
  const { state, tuning, set } = useApp();
  const { capo, labels, leftHanded } = state.settings;
  const [style, setStyle] = useState<Style>("all");
  const [bass, setBass] = useState<Bass>("root");
  const [zone, setZone] = useState<Zone>("all");
  const [maxDiff, setMaxDiff] = useState(99);
  const [shown, setShown] = useState(24);
  const slash = !!chord.bass && chord.bass !== chord.root;

  const all = useMemo(() => voicingsFor(chord, tuning, capo), [chord, tuning, capo]);
  const list = useMemo(() => all.filter((v) => matches(v, style, bass, zone, maxDiff, slash)), [all, style, bass, zone, maxDiff, slash]);
  const noBarreCount = useMemo(() => all.filter((v) => v.barreKind !== "full" && (slash || v.bassToken === "1")).length, [all, slash]);

  return (
    <div>
      <div className="filters">
        <div className="row"><span className="filter-label">Style</span><Seg value={style} options={STYLE_OPTS} onChange={(v) => { setStyle(v); setShown(24); }} label="Voicing style" /></div>
        <div className="row">
          {!slash && (<><span className="filter-label">Bass</span>
            <Seg value={bass} options={[{ value: "root", label: "Root" }, { value: "any", label: "Any" }, { value: "inv", label: "Inversions" }]} onChange={(v) => { setBass(v); setShown(24); }} label="Bass note" /></>)}
          <span className="filter-label">Neck</span>
          <Seg value={zone} options={[{ value: "all", label: "All" }, { value: "low", label: "Frets 0–5" }, { value: "mid", label: "4–10" }, { value: "high", label: "9+" }]} onChange={(v) => { setZone(v); setShown(24); }} label="Neck zone" />
        </div>
        <div className="row">
          <span className="filter-label">Level</span>
          <Seg value={maxDiff} options={[{ value: 99, label: "Any" }, { value: 3, label: "Easy" }, { value: 5, label: "≤ Medium" }]} onChange={(v) => { setMaxDiff(v); setShown(24); }} label="Difficulty" />
          <span className="filter-label">Dots</span>
          <Seg value={labels} options={[{ value: "intervals", label: "Intervals" }, { value: "notes", label: "Notes" }, { value: "fingers", label: "Fingers" }]}
            onChange={(v) => set((s) => ({ ...s, settings: { ...s.settings, labels: v } }))} label="Dot labels" />
        </div>
        <p className="small muted">
          <b>{list.length}</b> of {all.length} playable voicings{capo ? ` (capo ${capo})` : ""} · {noBarreCount} need no barre. Tap a diagram to hear it.
        </p>
      </div>
      {list.length === 0 ? (
        <div className="empty">No voicings match these filters. Try “All” or a different neck zone.</div>
      ) : (
        <div className="voicing-grid">
          {list.slice(0, shown).map((v) => (
            <div key={v.id} className={`voicing-card${pickedId === v.id ? " picked" : ""}`}>
              <button className="diagram-btn" onClick={() => strum(v.midi)} aria-label={`Play ${voicingText(v)}`}>
                <ChordDiagram voicing={v} root={chord.root} bass={chord.bass} labels={labels} leftHanded={leftHanded} capo={capo} />
              </button>
              <div className="frets-text mono">{voicingText(v)}</div>
              <div className="tags">
                <span className={`pill ${v.difficulty < 3 ? "easy" : v.difficulty < 5 ? "medium" : "hard"}`}>{v.difficulty < 3 ? "Easy" : v.difficulty < 5 ? "Medium" : "Hard"}</span>
                {v.barreKind === "full" ? <span className="pill">Barre</span> : v.barreKind === "mini" ? <span className="pill">Mini-barre</span> : null}
                {v.tags.includes("Open chord") && <span className="pill">Open</span>}
                {v.tags.includes("Ringing open strings") && <span className="pill">Ringing</span>}
                {v.tags.includes("Shell") && <span className="pill">Shell</span>}
              </div>
              <div className="tiny faint" style={{ textAlign: "center" }}>
                {v.inversion}{v.omitted.length ? ` · no ${v.omitted.map((o) => o.replace(/b/g, "♭").replace(/#/g, "♯")).join(", ")}` : ""}
              </div>
              {onUse && <button className="btn sm" onClick={() => onUse(v)}>{pickedId === v.id ? "✓ In use" : useLabel}</button>}
            </div>
          ))}
        </div>
      )}
      {list.length > shown && (
        <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
          <button className="btn" onClick={() => setShown((n) => n + 36)}>Show more ({list.length - shown} left)</button>
        </div>
      )}
    </div>
  );
}
