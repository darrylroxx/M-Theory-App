import type { ReactNode } from "react";
import { chordSymbol, type ChordRef } from "../../theory/chords";
import { toneRole } from "../../theory/intervals";
import type { Role } from "../../theory/keys";

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
  const label = { home: "Home", stable: "Soft home", motion: "Departure", tension: "Tension" }[role];
  return <span className={`pill ${ROLE_CLASS[role]}`}>{label}</span>;
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
