import { useState, type ReactNode } from "react";
import { chordSymbol, type ChordRef } from "../../theory/chords";
import { toneRole } from "../../theory/intervals";
import { ROLE_INFO, type Role } from "../../theory/keys";

export function Seg<T extends string | number>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function displayRoman(r: string): string {
  // ASCII roman numerals → pretty (bVII → ♭VII, #iv → ♯iv)
  return r.replace(/^b/, "♭").replace(/^#/, "♯").replace(/\/b/, "/♭").replace(/\/#/, "/♯").replace(/b(?=\d)/g, "♭").replace(/#(?=\d)/g, "♯");
}

export const ROLE_CLASS: Record<Role, string> = { home: "home", stable: "stable", motion: "motion", tension: "tension" };

export function RolePill({ role }: { role?: Role }) {
  if (!role) return null;
  return <span className={`pill ${ROLE_CLASS[role]}`} title={ROLE_INFO[role].blurb}>{ROLE_INFO[role].label}</span>;
}

/** One-line colour key for chord roles. */
export function RoleLegend() {
  return (
    <div className="role-legend">
      {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
        <span key={r}><i className={`dot ${ROLE_CLASS[r]}`} /><b>{ROLE_INFO[r].label}</b> {ROLE_INFO[r].blurb}</span>
      ))}
    </div>
  );
}

/** Fold-out section. Content only renders while open, so closed sections cost nothing. */
export function Disclosure({ title, hint, badge, children, defaultOpen = false, className = "" }: {
  title: ReactNode;
  hint?: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className={`disclosure ${className}`} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="disc-title">{title}{badge !== undefined && <span className="pill">{badge}</span>}</span>
        {hint && <span className="disc-hint">{hint}</span>}
      </summary>
      {open && <div className="disc-body">{children}</div>}
    </details>
  );
}

export function ChordChip({ ref: r, roman, onClick, title, on }: { ref: ChordRef; roman?: string; onClick: () => void; title?: string; on?: boolean }) {
  return (
    <button className={`chip${on ? " on" : ""}`} onClick={onClick} title={title}>
      {chordSymbol(r)}
      {roman && <span className="rn">{displayRoman(roman)}</span>}
    </button>
  );
}

export function toneClass(token: string): string {
  return `t-${toneRole(token)}`;
}

export function PlayButton({ onClick, label = "Play", className = "mini-play" }: { onClick: () => void; label?: string; className?: string }) {
  return (
    <button className={className} aria-label={label} title={label} onClick={(e) => { e.stopPropagation(); onClick(); }}>
      ▶
    </button>
  );
}

export function ToneLegend() {
  return (
    <div className="legend">
      <span className="t-root"><i />Root</span>
      <span className="t-third"><i />3rd</span>
      <span className="t-fifth"><i />5th</span>
      <span className="t-seventh"><i />7th / 6th</span>
      <span className="t-ext"><i />Colour (2, 4, 9, 11, 13)</span>
    </div>
  );
}
