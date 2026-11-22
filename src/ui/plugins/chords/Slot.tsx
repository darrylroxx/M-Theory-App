// One chord in the tray: its name and its shape (on the keys: the keys it plays). Tap to hear it, drag it to another
// place in the row, ✕ takes it out, ‹ › step through the shapes that fit between its neighbours, and the middle
// button opens the shape finder for it. A rest is a silence with a length and nothing else.
// (Copied out of the old Chords page, views/GuitarView: `Slot`.)
import { strum } from "../../../audio/synth";
import type { Voicing } from "../../../guitar/voicings";
import { chordSymbol } from "../../../theory/chords";
import { analyzeChord } from "../../../theory/keys";
import { ChordDiagram } from "../../components/ChordDiagram";
import { KeyboardDiagram } from "../../components/KeyboardDiagram";
import { ShapesIcon } from "../../components/ShapeFinder";
import { useDraggable } from "../../drag";
import { useApp, type ProgChord } from "../../state";
import { removeChord } from "./tray";

export function Slot({ c, i, v, keys, keySpan, now, dragged, out, onStep }: {
  c: ProgChord;
  i: number;
  /** its guitar shape */
  v?: Voicing;
  /** on the keys: the keys it plays, and the stretch of keys every keyboard in the tray shows */
  keys?: number[];
  keySpan?: { lo: number; hi: number };
  /** it is sounding */
  now: boolean;
  /** it is being dragged to another place */
  dragged: boolean;
  /** it starts after the end of what is open, and is never reached */
  out?: boolean;
  onStep: (d: -1 | 1) => void;
}) {
  const { state, set, openSheet } = useApp();
  // on the keys a chord plays the keys shown; on the guitar, its shape
  const play = () => (keys ? keys.length && strum(keys) : v && strum(v.midi));
  const d = useDraggable({ ref: c.ref, slotId: c.id }, play);
  const a = analyzeChord(c.ref, state.key);
  const name = chordSymbol(c.ref);
  const remove = (e: React.MouseEvent) => { e.stopPropagation(); set(removeChord(c.id)); };
  // a rest: a silence with a length, and nothing else
  if (c.rest)
    return (
      <div className={`slot rest draggable${now ? " now" : ""}${dragged ? " dragged" : ""}${out ? " out" : ""}`} data-slot={c.id} role="group" aria-label={`Rest, ${i + 1} in the row${out ? ", past the end" : ""}`} {...d}>
        <span className="sym">Rest</span>
        <span className="rest-mark" aria-hidden="true">–</span>
        <button className="slot-x" data-nodrag aria-label="Remove the rest" onClick={remove}>✕</button>
      </div>
    );
  return (
    <div className={`slot draggable st-${a.status}${now ? " now" : ""}${dragged ? " dragged" : ""}${out ? " out" : ""}`} data-slot={c.id} role="button" tabIndex={0}
      aria-label={`Chord ${i + 1}: ${name}${out ? ", past the end" : ""}. Play`} {...d} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) play(); }}>
      <span className="sym">{name}</span>
      {keys ? <KeyboardDiagram notes={keys} chord={c.ref} keyOf={state.key} labels={state.settings.labels === "fingers" ? "intervals" : state.settings.labels} width={116} compact span={keySpan} />
        : v && <ChordDiagram voicing={v} root={c.ref.root} bass={c.ref.bass} labels={state.settings.labels} width={116} compact leftHanded={state.settings.leftHanded} capo={state.settings.capo} />}
      <button className="slot-x" data-nodrag aria-label={`Remove ${name}`} onClick={remove}>✕</button>
      {/* on the keys: the chord's panel (flavour, move, length, its keys), without the guitar's shape steppers */}
      {keys ? (
        <div className="slot-step" data-nodrag onClick={(e) => e.stopPropagation()}>
          <button className="slot-more" aria-label={`${name}: flavour, length and more`} title="More" aria-haspopup="dialog" onClick={() => openSheet({ ref: c.ref, slotId: c.id })}>⋯</button>
        </div>
      ) : <div className="slot-step" data-nodrag onClick={(e) => e.stopPropagation()}>
        <button aria-label={`Previous shape for ${name}`} title="Previous shape that fits here" onClick={() => onStep(-1)}>‹</button>
        <button className="slot-shapes" aria-label={`Other ways to play ${name}`} title="All shapes, length, remove" aria-haspopup="dialog" onClick={() => openSheet({ ref: c.ref, slotId: c.id })}><ShapesIcon /></button>
        <button aria-label={`Next shape for ${name}`} title="Next shape that fits here" onClick={() => onStep(1)}>›</button>
      </div>}
    </div>
  );
}
