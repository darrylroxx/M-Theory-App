// The + row under the last track: it opens, in place, the six kinds of track to choose from.
import { useEffect } from "react";
import type { TrackKind } from "../../timeline/model";
import { KindIcon } from "../icons";
import { ESC_OPEN, onEscape } from "./keys";

/** The six choices, in the order they are offered. "Blank" is an empty audio track that records any input. */
export const ADD_KINDS: { kind: TrackKind; name: string; hint: string }[] = [
  { kind: "chords", name: "Chords", hint: "A track of chords" },
  { kind: "melody", name: "Melody", hint: "A track for a tune" },
  { kind: "bass", name: "Bass", hint: "A track for a bass line" },
  { kind: "drums", name: "Drums", hint: "A track of drums" },
  { kind: "vocals", name: "Vocals", hint: "A track to sing on" },
  { kind: "audio", name: "Blank", hint: "An empty audio track: it records any input" },
];

export function AddTrack({ open, onOpen, onAdd }: { open: boolean; onOpen(open: boolean): void; onAdd(kind: TrackKind): void }) {
  // Escape puts the choices away
  useEffect(() => (open ? onEscape(ESC_OPEN, () => (onOpen(false), true)) : undefined), [open, onOpen]);
  return (
    <div className={`tlv-add${open ? " open" : ""}`}>
      {open ? (
        <span className="tlv-kinds" role="group" aria-label="What kind of track">
          {ADD_KINDS.map((k) => (
            <button key={k.kind} className="chip" title={k.hint} autoFocus={k.kind === "chords"} onClick={() => onAdd(k.kind)}><KindIcon kind={k.kind} />{k.name}</button>
          ))}
          <button className="chip tlv-kinds-x" aria-label="Cancel" onClick={() => onOpen(false)}>✕</button>
        </span>
      ) : (
        <button className="btn sm tlv-plus" aria-label="Add a track" aria-expanded={false} title="Add a track" onClick={() => onOpen(true)}>+ <span>Add track</span></button>
      )}
    </div>
  );
}
