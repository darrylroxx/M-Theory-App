import type { Tuning } from "../../guitar/tunings";
import { defaultName, displayNote } from "../../theory/notes";

export interface FretDot {
  string: number; // 0 = lowest string
  fret: number;
  label: string;
  color: string;
  /** visual weight: 2 = big/emphasised, 1 = normal, 0 = ghost */
  weight?: 0 | 1 | 2;
  ring?: boolean;
}

interface Props {
  tuning: Tuning;
  capo?: number;
  frets?: number;
  dots: FretDot[];
  onCell?: (string: number, fret: number) => void;
  leftHanded?: boolean;
  showStringNames?: boolean;
}

const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21];

/** Horizontal fretboard (high E on top, like tab). Scrolls sideways on phones. */
export function Fretboard({ tuning, capo = 0, frets = 15, dots, onCell, leftHanded, showStringNames = true }: Props) {
  const n = tuning.notes.length;
  const fw = (f: number) => 58 - f * 1.3; // frets get narrower up the neck
  const xs: number[] = [0];
  for (let f = 1; f <= frets; f++) xs.push(xs[f - 1] + fw(f));
  const padL = showStringNames ? 34 : 10;
  const openW = 34;
  const totalW = padL + openW + xs[frets] + 12;
  const sh = 26;
  const padT = 12;
  const h = padT + (n - 1) * sh + 34;
  const flipX = (v: number) => (leftHanded ? totalW - v : v);
  const fx = (f: number) => flipX(f === 0 ? padL + openW / 2 : padL + openW + (xs[f - 1] + xs[f]) / 2);
  const wireX = (f: number) => flipX(padL + openW + xs[f]);
  const sy = (s: number) => padT + (n - 1 - s) * sh;

  return (
    <div className="fretboard-wrap">
      <svg width={totalW} height={h} viewBox={`0 0 ${totalW} ${h}`} role="img" aria-label="Fretboard">
        <rect x={Math.min(flipX(padL + openW), flipX(padL + openW + xs[frets]))} y={padT - 8} width={xs[frets]} height={(n - 1) * sh + 16} fill="var(--wood)" rx={4} />
        {INLAYS.filter((f) => f <= frets).map((f) => (
          <circle key={f} cx={fx(f)} cy={padT + ((n - 1) * sh) / 2} r={6} fill="var(--inlay)" />
        ))}
        {frets >= 12 && (
          <>
            <circle cx={fx(12)} cy={padT + sh * 1.5} r={6} fill="var(--inlay)" />
            <circle cx={fx(12)} cy={padT + sh * (n - 2.5)} r={6} fill="var(--inlay)" />
          </>
        )}
        {Array.from({ length: frets + 1 }, (_, f) => (
          <line key={f} x1={wireX(f)} x2={wireX(f)} y1={padT - 8} y2={padT + (n - 1) * sh + 8} stroke={f === 0 ? "var(--text)" : "var(--fret)"} strokeWidth={f === 0 ? 5 : 2} opacity={f === 0 ? 0.7 : 1} />
        ))}
        {Array.from({ length: n }, (_, s) => (
          <g key={s}>
            <line x1={flipX(padL)} x2={flipX(padL + openW + xs[frets])} y1={sy(s)} y2={sy(s)} stroke="var(--string)" strokeWidth={0.8 + (n - 1 - s) * 0.3} opacity={0.8} />
            {showStringNames && (
              <text x={flipX(12)} y={sy(s) + 4} fontSize={11} fill="var(--muted)" fontWeight={700} textAnchor="middle">
                {displayNote(defaultName(tuning.notes[s] + capo, false))}
              </text>
            )}
          </g>
        ))}
        {Array.from({ length: frets }, (_, i) => i + 1)
          .filter((f) => [1, 3, 5, 7, 9, 12, 15, 17, 19, 21].includes(f))
          .map((f) => (
            <text key={f} x={fx(f)} y={h - 6} fontSize={11} textAnchor="middle" fill="var(--faint)" fontWeight={700}>{f + capo}</text>
          ))}
        {onCell &&
          Array.from({ length: n }, (_, s) =>
            Array.from({ length: frets + 1 }, (_, f) => {
              const left = f === 0 ? padL : padL + openW + xs[f - 1];
              const w = f === 0 ? openW : xs[f] - xs[f - 1];
              const xx = leftHanded ? totalW - left - w : left;
              return (
                <g key={`${s}-${f}`} className="fret-cell" onClick={() => onCell(s, f)}>
                  <rect x={xx} y={sy(s) - sh / 2} width={w} height={sh} fill="transparent" rx={6} />
                </g>
              );
            }),
          )}
        {dots.map((d, i) => {
          const r = d.weight === 2 ? 11.5 : d.weight === 0 ? 8 : 10;
          return (
            <g key={i} pointerEvents="none" opacity={d.weight === 0 ? 0.38 : 1}>
              <circle cx={fx(d.fret)} cy={sy(d.string)} r={r} fill={d.color} stroke={d.ring ? "var(--text)" : "none"} strokeWidth={d.ring ? 2 : 0} strokeDasharray={d.ring ? "3 2" : undefined} />
              <text x={fx(d.fret)} y={sy(d.string) + 4} fontSize={d.label.length > 2 ? 8.5 : 10.5} textAnchor="middle" fill="#111" fontWeight={800}>{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
