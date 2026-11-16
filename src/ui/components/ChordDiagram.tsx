import type { Voicing } from "../../guitar/voicings";
import { intervalNote, toneRole } from "../../theory/intervals";
import { displayNote } from "../../theory/notes";
import type { LabelMode } from "../state";

const ROLE_VAR: Record<string, string> = {
  root: "var(--root)",
  third: "var(--third)",
  fifth: "var(--fifth)",
  seventh: "var(--seventh)",
  ext: "var(--ext)",
  other: "var(--other)",
};

export function toneColor(token: string | null): string {
  if (!token || token === "bass") return ROLE_VAR.other;
  return ROLE_VAR[toneRole(token)];
}

export function tokenLabel(token: string): string {
  if (token === "1") return "R";
  return token.replace(/b/g, "♭").replace(/#/g, "♯");
}

interface Props {
  voicing: Voicing;
  root: string;
  bass?: string;
  labels: LabelMode;
  leftHanded?: boolean;
  width?: number;
  capo?: number;
  /** Shorter frets, for tight spaces */
  compact?: boolean;
}

/** Classic vertical chord box: strings top-to-bottom, nut at the top. */
export function ChordDiagram({ voicing, root, bass, labels, leftHanded, width = 132, capo = 0, compact }: Props) {
  const n = voicing.frets.length;
  const span = Math.max(4, voicing.maxFret - voicing.minFret + 1);
  const showNut = voicing.maxFret <= Math.max(4, span);
  const base = showNut ? 1 : voicing.minFret;
  const rows = showNut ? Math.max(4, voicing.maxFret) : span;
  const padL = 22;
  const padR = 10;
  const padT = 26;
  const gridW = width - padL - padR;
  const sx = gridW / (n - 1);
  const sy = compact ? Math.min(20, sx) : Math.min(26, sx * 1.25);
  const height = padT + rows * sy + 14;
  const x = (s: number) => padL + (leftHanded ? n - 1 - s : s) * sx;
  const y = (f: number) => padT + (f - base + 0.5) * sy;
  const r = Math.min(sx, sy) * 0.4;

  const label = (s: number): string => {
    const tok = voicing.tokens[s];
    if (labels === "fingers") return voicing.fingers[s] ? String(voicing.fingers[s]) : "";
    if (!tok) return "";
    if (tok === "bass") return bass ? displayNote(bass) : "";
    if (labels === "notes") return displayNote(intervalNote(root, tok));
    return tokenLabel(tok);
  };

  return (
    <svg className="diagram-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`Chord diagram ${voicing.frets.map((f) => (f === null ? "x" : f)).join(" ")}`}>
      {/* frets */}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <line key={`f${i}`} x1={padL} x2={padL + gridW} y1={padT + i * sy} y2={padT + i * sy}
          stroke="var(--fret)" strokeWidth={i === 0 && showNut ? 4 : 1.2} />
      ))}
      {/* strings */}
      {Array.from({ length: n }, (_, s) => (
        <line key={`s${s}`} x1={x(s)} x2={x(s)} y1={padT} y2={padT + rows * sy} stroke="var(--string)" strokeWidth={1 + (leftHanded ? s : n - 1 - s) * 0.18} opacity={0.75} />
      ))}
      {!showNut && (
        <text x={padL - 6} y={y(base) + 4} fontSize={11} textAnchor="end" fill="var(--muted)" fontWeight={700}>{base}</text>
      )}
      {capo > 0 && showNut && (
        <text x={padL - 6} y={padT + 4} fontSize={9} textAnchor="end" fill="var(--accent)" fontWeight={800}>C{capo}</text>
      )}
      {/* open / muted markers */}
      {voicing.frets.map((f, s) =>
        f === null ? (
          <text key={`m${s}`} x={x(s)} y={padT - 9} fontSize={12} textAnchor="middle" fill="var(--faint)" fontWeight={700}>×</text>
        ) : f === 0 ? (
          <circle key={`o${s}`} cx={x(s)} cy={padT - 13} r={r * 0.62} fill="none" stroke={toneColor(voicing.tokens[s])} strokeWidth={2} />
        ) : null,
      )}
      {/* barres */}
      {voicing.barres.map((b, i) => {
        const x1 = Math.min(x(b.from), x(b.to));
        const x2 = Math.max(x(b.from), x(b.to));
        return <rect key={`b${i}`} x={x1 - r} y={y(b.fret) - r} width={x2 - x1 + 2 * r} height={2 * r} rx={r} fill="var(--border-2)" opacity={0.9} />;
      })}
      {/* dots */}
      {voicing.frets.map((f, s) => {
        if (f === null || f === 0) return null;
        const col = toneColor(voicing.tokens[s]);
        const t = r >= 5.2 ? label(s) : "";
        return (
          <g key={`d${s}`}>
            <circle cx={x(s)} cy={y(f)} r={r} fill={col} />
            <text x={x(s)} y={y(f) + r * 0.38} fontSize={t.length > 2 ? r * 0.8 : r * 1.0} textAnchor="middle" fill="#111" fontWeight={800}>{t}</text>
          </g>
        );
      })}
      {/* bottom labels for open strings */}
      {voicing.frets.map((f, s) =>
        f === 0 && labels !== "fingers" ? (
          <text key={`ol${s}`} x={x(s)} y={height - 2} fontSize={9} textAnchor="middle" fill={toneColor(voicing.tokens[s])} fontWeight={800}>{label(s)}</text>
        ) : null,
      )}
    </svg>
  );
}
