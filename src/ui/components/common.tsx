import type { ReactNode } from "react";
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

export function toneClass(token: string): string {
  return `t-${toneRole(token)}`;
}
