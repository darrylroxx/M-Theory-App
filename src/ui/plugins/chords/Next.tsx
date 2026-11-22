// "Next": chords that could follow the last chord in the tray, in four groups from safe to bold. It reads the chords
// of what the window has open. (Copied out of the old Chords page, views/GuitarView.)
import { useMemo } from "react";
import { suggestNext, type SuggestionGroup } from "../../../theory/progression";
import { useApp } from "../../state";
import { Pill } from "./parts";

const GROUP_LABEL: Record<SuggestionGroup["id"], string> = { natural: "Safe", smooth: "Smooth", color: "Colorful", bold: "Bold" };

export function NextChords() {
  const { state } = useApp();
  const chords = state.progression.chords.filter((c) => !c.rest);
  const last = chords[chords.length - 1]?.ref ?? null;
  const refsKey = JSON.stringify(chords.map((c) => c.ref));
  const groups = useMemo(() => suggestNext(last, state.key, chords.map((c) => c.ref), 8), [refsKey, state.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      {groups.map((g) => (
        <div key={g.id} className="degree-row wide">
          <div className={`degree-label g-${g.id}`} title={g.blurb}><i className="gdot" />{GROUP_LABEL[g.id]}</div>
          <div className="row tight">
            {g.items.map((s, i) => <Pill key={i} chord={s.chord.ref} title={s.why} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
