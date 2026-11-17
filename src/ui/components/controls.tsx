/** The small controls shared by the harp and the drum machine. */
import type { CSSProperties } from "react";

export const pct = (v: number) => String(Math.round(v * 100));
export const toneText = (v: number) => (Math.abs(v) < 0.025 ? "Flat" : `${v < 0 ? "Dark" : "Bright"} ${Math.round(Math.abs(v) * 100)}`);

/** A small labelled menu, the same size as a knob. */
export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; name: string; hint: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="knob choice" title={options.find((o) => o.id === value)?.hint}>
      <span><i>{label}</i></span>
      <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.id} value={o.id} title={o.hint}>{o.name}</option>)}
      </select>
    </label>
  );
}

/** ‹ name ›: the arrows flip through, the name opens the full list. */
export function Picker({ label, name, open, onOpen, onStep, disabled }: { label: string; name: string; open: boolean; onOpen: () => void; onStep: (dir: -1 | 1) => void; disabled?: boolean }) {
  return (
    <div className={`beat-pick${open ? " open" : ""}${disabled ? " off" : ""}`}>
      <button aria-label={`Previous ${label.toLowerCase()}`} disabled={disabled} onClick={() => onStep(-1)}>‹</button>
      <button className="beat-name" aria-expanded={open} aria-label={`${label}: ${name}`} disabled={disabled} onClick={onOpen}>
        <span>{label}</span>
        <b>{name}</b>
      </button>
      <button aria-label={`Next ${label.toLowerCase()}`} disabled={disabled} onClick={() => onStep(1)}>›</button>
    </div>
  );
}

/** A labelled slider that shows its value. Double-click puts it back to its default. */
export function Knob({ label, value, onChange, min = 0, max = 1, step = 0.05, title, def, fmt = pct, wide, children }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; title?: string;
  def?: number; fmt?: (v: number) => string; wide?: boolean; children?: React.ReactNode;
}) {
  const at = ((value - min) / (max - min)) * 100;
  const mid = min < 0 ? 50 : 0;
  const style = { "--a": `${Math.min(at, mid)}%`, "--b": `${Math.max(at, mid)}%` } as CSSProperties;
  return (
    <label className={`knob${wide ? " wide" : ""}${def !== undefined && Math.abs(value - def) > 1e-6 ? " moved" : ""}`} title={title} onDoubleClick={() => def !== undefined && onChange(def)}>
      <span><i>{label}</i><b>{fmt(value)}</b>{children}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} style={style} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

