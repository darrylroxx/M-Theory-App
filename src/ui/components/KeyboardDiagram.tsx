import type { CSSProperties } from "react";
import { splitHands } from "../../keys/voicing";
import { keyCentre, keyRects, keyboardWindow } from "../../keys/keyfaces";
import { chordNotes, chordSymbol, chordToneMap, chordTypeOf, findChordType, type ChordRef } from "../../theory/chords";
import { mod12, midiToName, pc } from "../../theory/notes";
import { spellInKey, type Key } from "../../theory/keys";
import type { LabelMode } from "../state";
import { tokenLabel, toneColor } from "./ChordDiagram";

interface Props {
  /** the keys pressed, as MIDI notes */
  notes: number[];
  /** the chord they spell: colours each key by its part in the chord and names it */
  chord?: ChordRef;
  /** spells note names the key's way (B♭ rather than A♯) */
  keyOf?: Key;
  /** what is written under the pressed keys: their part in the chord, their names, or nothing ("fingers" shows the parts: a keyboard shape has no fret fingering) */
  labels?: LabelMode | "none";
  /** the same widths as the guitar chord box, so one can stand in for the other */
  width?: number;
  /** shorter keys and no hand marks, for tight spaces */
  compact?: boolean;
  /** mark which keys the left hand and the right hand play, when the shape is too wide for one */
  hands?: boolean;
  /** draw at least this many white keys (default: as many as fit the width comfortably) */
  minWhite?: number;
  /** keys the window must reach too: give a row of diagrams the same span (a progression's lowest and highest key) and they line up, so the voice leading shows */
  span?: { lo: number; hi: number };
  className?: string;
}

/** A note's part in a chord ("1", "b3", "9" …), or null when it isn't one of its notes. */
function tokenOf(chord: ChordRef | undefined, midi: number): string | null {
  if (!chord || !findChordType(chord.typeId)) return null;
  const tok = chordToneMap(pc(chord.root), chordTypeOf(chord)).get(mod12(midi));
  if (tok) return tok;
  if (chord.bass && pc(chord.bass) === mod12(midi)) return "bass";
  return null;
}

/**
 * A chord on a piano keyboard: the keys of a voicing pressed and coloured by their part in the
 * chord (the same colours as the guitar boxes, the root its own), named underneath, with the
 * hands marked when the shape needs both. The keyboard is cut to fit the voicing, at least an
 * octave, so a shape is as easy to read in a chord card as on a wide screen.
 */
export function KeyboardDiagram({ notes, chord, keyOf, labels = "intervals", width = 132, compact, hands = true, minWhite, span, className }: Props) {
  const keys = [...new Set(notes.filter((n) => Number.isFinite(n)).map(Math.round))].sort((a, b) => a - b);
  const pad = 4;
  // as many white keys as stay at least ~16px wide, an octave at the least
  const fit = minWhite ?? Math.max(7, Math.min(14, Math.floor((width - 2 * pad) / 16)));
  const win = keyboardWindow(span ? [...keys, span.lo, span.hi] : keys, fit, 28);
  const ww = (width - 2 * pad) / win.whites;
  const keyH = Math.round(Math.min(compact ? 56 : 72, Math.max(compact ? 34 : 42, ww * (compact ? 3.2 : 4))));
  const top = 4;
  // the hands are marked only when one hand can't hold the shape
  const split = hands && !compact && keys.length > 1 && (keys[keys.length - 1] - keys[0] > 12 || keys.length > 5) ? splitHands(keys) : null;
  const twoHands = !!split && split.left.length > 0 && split.right.length > 0;
  const labelRow = labels === "none" ? 0 : 13;
  // a second row of labels when two pressed keys sit too close for both names on one line
  const xs = keys.map((m) => pad + keyCentre(m, win.lo) * ww);
  const rows: number[] = [];
  const lastX = [-Infinity, -Infinity];
  const room = labels === "notes" ? 17 : 13;
  for (const x of xs) {
    const row = x - lastX[0] >= room ? 0 : x - lastX[1] >= room ? 1 : 0;
    rows.push(row);
    lastX[row] = x;
  }
  const labelRows = labelRow ? (rows.includes(1) ? 2 : 1) : 0;
  const handsRow = twoHands ? 12 : 0;
  const height = top + keyH + 3 + labelRows * labelRow + handsRow + 2;
  const pressed = new Set(keys);
  const rootPc = chord ? pc(chord.root) : null;
  const tok = (m: number) => tokenOf(chord, m);
  const colour = (m: number) => (chord ? toneColor(tok(m)) : "var(--accent)");
  // names spelled the chord's way (B♭ in B♭13, not A♯), else the key's, else plainly
  const spelled = new Map<number, string>();
  if (chord && findChordType(chord.typeId)) for (const n of [...chordNotes(chord.root, chordTypeOf(chord)), ...(chord.bass ? [chord.bass] : [])]) if (!spelled.has(pc(n))) spelled.set(pc(n), n);
  const plain = (m: number) => spelled.get(mod12(m)) ?? (keyOf ? spellInKey(mod12(m), keyOf) : midiToName(m).replace(/-?\d+$/, ""));
  const nameOf = (m: number) => plain(m).replace(/b/g, "♭").replace(/#/g, "♯");
  const text = (m: number) => {
    if (labels === "none") return "";
    if (labels === "notes") return nameOf(m);
    const t = tok(m);
    return t === "bass" ? nameOf(m) : t ? tokenLabel(t) : nameOf(m);
  };
  // read out as the chord and its keys, low to high: "B♭maj7 on piano: B♭3 D4 F4 A4"
  const spoken = keys.map((m) => nameOf(m) + (Math.floor(m / 12) - 1)).join(" ");
  const named = chord && findChordType(chord.typeId) ? `${chordSymbol(chord)} on piano` : "Piano keys";

  return (
    <svg className={`kbd${compact ? " compact" : ""}${className ? " " + className : ""}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={keys.length ? `${named}: ${spoken}` : `${named}, no keys pressed`}>
      {keyRects(win.lo, win.hi).map((k) => {
        const on = pressed.has(k.midi);
        const root = on && rootPc !== null && mod12(k.midi) === rootPc;
        const style: CSSProperties | undefined = on ? { fill: `color-mix(in srgb, ${colour(k.midi)} ${k.black ? 80 : 62}%, var(--kb-${k.black ? "black" : "white"}))` } : undefined;
        return (
          <rect key={k.midi} className={`kbd-key ${k.black ? "black" : "white"}${on ? " on" : ""}${root ? " root" : ""}`}
            x={pad + k.x * ww + (k.black ? 0 : 0.5)} y={top} width={k.w * ww - (k.black ? 0 : 1)} height={k.h * keyH} rx={k.black ? 1.5 : 2.5} style={style} />
        );
      })}
      {/* middle C: a small mark at the foot of the key, to find your place */}
      {win.lo <= 60 && win.hi >= 60 && !pressed.has(60) && <circle className="kbd-mid" cx={pad + keyCentre(60, win.lo) * ww} cy={top + keyH - 5} r={1.6} />}
      {/* a dot on each pressed key; the root's is ringed */}
      {keys.map((m, i) => {
        const black = [1, 3, 6, 8, 10].includes(mod12(m));
        const cy = top + (black ? keyH * 0.66 - 6 : keyH - 7);
        const r = Math.max(2.6, Math.min(5, ww * (black ? 0.24 : 0.3)));
        const root = rootPc !== null && mod12(m) === rootPc;
        return <circle key={`d${m}`} className={`kbd-dot${root ? " root" : ""}`} cx={xs[i]} cy={cy} r={r} style={{ fill: colour(m) }} />;
      })}
      {labels !== "none" &&
        keys.map((m, i) => (
          <text key={`t${m}`} className="kbd-label" x={xs[i]} y={top + keyH + 3 + 10 + rows[i] * labelRow} textAnchor="middle" style={{ fill: colour(m) }}>
            {text(m)}
          </text>
        ))}
      {twoHands &&
        (["left", "right"] as const).map((h) => {
          const ks = split![h];
          const x1 = pad + (keyCentre(ks[0], win.lo) - 0.35) * ww;
          const x2 = pad + (keyCentre(ks[ks.length - 1], win.lo) + 0.35) * ww;
          const y = height - handsRow + 3;
          return (
            <g key={h} className="kbd-hand">
              <path d={`M${x1} ${y - 2}v2h${Math.max(0, x2 - x1)}v-2`} />
              <text x={(x1 + x2) / 2} y={y + 9} textAnchor="middle">{h === "left" ? "L" : "R"}</text>
            </g>
          );
        })}
    </svg>
  );
}
