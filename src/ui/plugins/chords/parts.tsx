// Small parts the chord board and its lists share: a chord as a pill, which chord was tapped last, and whether the
// chords track that is open plays the keys. (Copied out of the old Chords page, which is gone.)
import { createContext, useContext } from "react";
import { onKeys, toneOf, type Tone } from "../../../audio/tone";
import { chordSymbol, type ChordRef } from "../../../theory/chords";
import { useDraggable } from "../../drag";
import { useApp } from "../../state";

/** The chord last tapped in one of the chord lists: it gets the Shapes and + buttons. */
export const PickCtx = createContext<{ sel: ChordRef | null; setSel: (r: ChordRef) => void }>({ sel: null, setSel: () => {} });
export const sameRef = (a: ChordRef | null, b: ChordRef) => !!a && a.root === b.root && a.typeId === b.typeId && a.bass === b.bass;

/** The chords track the window edits, when it plays on the keys (its voicing and register); null: it plays Guitar. */
export function useKeys(): Tone | null {
  const { state } = useApp();
  const t = toneOf(state.progression, state.progression.focus?.chords ?? "chords");
  return onKeys(t) ? t : null;
}

/** A chord as a small draggable pill: tap to hear it (Shapes and + then appear at the top), drag to add. */
export function Pill({ chord, tone, title }: { chord: ChordRef; tone?: string; title?: string }) {
  const { audition } = useApp();
  const { sel, setSel } = useContext(PickCtx);
  const d = useDraggable({ ref: chord }, () => { audition(chord); setSel(chord); });
  return <button className={`chip draggable${tone ? ` ${tone}` : ""}${sameRef(sel, chord) ? " sel" : ""}`} title={title} aria-pressed={sameRef(sel, chord)} {...d}>{chordSymbol(chord)}</button>;
}
