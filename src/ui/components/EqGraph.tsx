import { useEffect, useMemo, useRef, useState } from "react";
import { EQ_DB, EQ_FMAX, EQ_FMIN, EQ_NODES, eqDb, fOf, hz, tidyHz, xOf, type EqNode, type EqNodeId, type EqSettings } from "../../audio/eqcurve";

const W = 640;
const H = 270;
const PAD = { l: 30, r: 8, t: 10, b: 20 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;
const X = (f: number) => PAD.l + xOf(f) * IW;
const Y = (db: number) => PAD.t + (0.5 - db / (2 * EQ_DB)) * IH;
const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const MINOR_HZ = [30, 40, 60, 70, 80, 90, 300, 400, 600, 700, 800, 900, 3000, 4000, 6000, 7000, 8000, 9000, 30000];
const GRID_DB = [-12, -6, 0, 6, 12];
const round = (v: number, step: number) => Math.round(v / step) * step;

/**
 * The EQ as a graph: frequency left to right (each octave as wide as the next), decibels up
 * and down, the curve of everything the EQ does, and a point for each band. Drag a point
 * sideways for its frequency and up or down for its gain; the wheel (or the Width slider)
 * makes a bell wider or narrower; a double-click puts a band back. The shaded strip on the
 * right is above hearing: an air band up there only sends its gentle lower slope down.
 */
export function EqGraph({ fx, set, disabled }: { fx: EqSettings; set: (patch: Partial<EqSettings>) => void; disabled?: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<EqNodeId | null>(null);
  const drag = useRef<EqNodeId | null>(null);

  const path = useMemo(() => {
    const pts: string[] = [];
    const n = 200;
    for (let i = 0; i <= n; i++) {
      const f = fOf(i / n);
      const y = Math.min(H - PAD.b + 4, Math.max(PAD.t - 4, Y(eqDb(fx, f))));
      pts.push(`${i ? "L" : "M"}${X(f).toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join("");
  }, [fx]);

  const gainOf = (n: EqNode) => (n.gain ? (n.id === "mid" ? fx.mid - 5 * fx.mud : (fx[n.gain] as number)) : 0);
  const freqOf = (n: EqNode) => fx[n.freq] as number;
  // a high cut at the top of its range is off: its point waits at the edge
  const shownAt = (n: EqNode) => ({ x: X(Math.min(EQ_FMAX, Math.max(EQ_FMIN, freqOf(n)))), y: Y(Math.max(-EQ_DB, Math.min(EQ_DB, gainOf(n)))) });

  const move = (n: EqNode, e: { clientX: number; clientY: number }) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    const py = ((e.clientY - box.top) / box.height) * H;
    const f = Math.min(n.fmax, Math.max(n.fmin, tidyHz(fOf((px - PAD.l) / IW))));
    const patch: Partial<EqSettings> = { [n.freq]: f };
    if (n.gain) {
      const g = Math.min(12, Math.max(-12, round((0.5 - (py - PAD.t) / IH) * 2 * EQ_DB, 0.5)));
      Object.assign(patch, { [n.gain]: g }, n.id === "mid" ? { mud: 0 } : {});
    }
    set(patch);
  };
  const widen = (n: EqNode, by: number) => {
    if (!n.q) return;
    const q = Math.min(6, Math.max(0.3, (fx[n.q] as number) * by));
    set({ [n.q]: +q.toFixed(2) });
  };
  const key = (n: EqNode, e: React.KeyboardEvent) => {
    const f = freqOf(n);
    const step = e.shiftKey ? 1.12 : 1.03;
    if (e.key === "ArrowLeft") set({ [n.freq]: Math.max(n.fmin, tidyHz(f / step)) });
    else if (e.key === "ArrowRight") set({ [n.freq]: Math.min(n.fmax, tidyHz(f * step) === f ? f + 1 : tidyHz(f * step)) });
    else if (n.gain && (e.key === "ArrowUp" || e.key === "ArrowDown")) set({ [n.gain]: Math.min(12, Math.max(-12, gainOf(n) + (e.key === "ArrowUp" ? 0.5 : -0.5))), ...(n.id === "mid" ? { mud: 0 } : {}) });
    else return;
    e.preventDefault();
  };

  // the wheel over a bell changes its width, and must not scroll the page while it does
  const live = useRef({ widen, disabled });
  live.current = { widen, disabled };
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const id = (e.target as Element | null)?.closest?.("[data-node]")?.getAttribute("data-node");
      const n = EQ_NODES.find((x) => x.id === id);
      if (!n?.q || live.current.disabled) return;
      e.preventDefault();
      live.current.widen(n, e.deltaY > 0 ? 1 / 1.12 : 1.12);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const shown = EQ_NODES.find((n) => n.id === active);
  const readout = shown ? `${shown.name} · ${shown.id === "highcut" && freqOf(shown) >= 18000 ? "off" : hz(freqOf(shown))}${shown.gain ? ` · ${gainOf(shown) > 0 ? "+" : ""}${gainOf(shown).toFixed(1)} dB` : ""}${shown.q ? ` · Q ${(fx[shown.q] as number).toFixed(1)}` : ""}` : "";

  return (
    <div className={`eq${disabled ? " off" : ""}`}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="EQ graph" onPointerLeave={() => !drag.current && setActive(null)}>
        <rect className="eq-bg" x={PAD.l} y={PAD.t} width={IW} height={IH} rx={6} />
        <rect className="eq-beyond" x={X(20000)} y={PAD.t} width={X(EQ_FMAX) - X(20000)} height={IH} />
        {MINOR_HZ.map((f) => <line key={f} className="eq-minor" x1={X(f)} x2={X(f)} y1={PAD.t} y2={PAD.t + IH} />)}
        {GRID_HZ.map((f) => (
          <g key={f}>
            <line className="eq-line" x1={X(f)} x2={X(f)} y1={PAD.t} y2={PAD.t + IH} />
            <text className="eq-label" x={X(f)} y={H - 6} textAnchor="middle">{f >= 1000 ? `${f / 1000}k` : f}</text>
          </g>
        ))}
        {GRID_DB.map((d) => (
          <g key={d}>
            <line className={d === 0 ? "eq-zero" : "eq-line"} x1={PAD.l} x2={PAD.l + IW} y1={Y(d)} y2={Y(d)} />
            <text className="eq-label" x={PAD.l - 5} y={Y(d) + 3} textAnchor="end">{d > 0 ? `+${d}` : d}</text>
          </g>
        ))}
        <path className="eq-fill" d={`${path}L${X(EQ_FMAX)},${Y(0)}L${X(EQ_FMIN)},${Y(0)}Z`} />
        <path className="eq-curve" d={path} />
        {EQ_NODES.map((n, i) => {
          const p = shownAt(n);
          const on = active === n.id;
          return (
            <g key={n.id} data-node={n.id} className={`eq-node b${i}${on ? " on" : ""}`} transform={`translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`} role="slider" tabIndex={disabled ? -1 : 0}
              aria-label={`${n.name}: ${hz(freqOf(n))}${n.gain ? `, ${gainOf(n).toFixed(1)} dB` : ""}`} aria-valuenow={freqOf(n)} aria-valuemin={n.fmin} aria-valuemax={n.fmax}
              onPointerDown={(e) => { if (disabled) return; drag.current = n.id; setActive(n.id); (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId); e.preventDefault(); }}
              onPointerMove={(e) => { if (drag.current === n.id) move(n, e); }}
              onPointerUp={(e) => { drag.current = null; (e.currentTarget as SVGGElement).releasePointerCapture(e.pointerId); }}
              onPointerEnter={() => !drag.current && setActive(n.id)}
              onFocus={() => setActive(n.id)}
              onDoubleClick={() => !disabled && set(n.rest)}
              onKeyDown={(e) => !disabled && key(n, e)}>
              <circle className="eq-hit" r={18} />
              <circle className="eq-dot" r={on ? 11 : 9.5} />
              <text className="eq-glyph" y={3.6} textAnchor="middle">{["◢", "B", "M", "P", "A", "◣"][i]}</text>
            </g>
          );
        })}
      </svg>
      <span className="eq-read mono" aria-live="polite">{readout}</span>
    </div>
  );
}
