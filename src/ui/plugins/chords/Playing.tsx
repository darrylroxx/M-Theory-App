// How the chords of a clip are played: the playing style (let ring, a strum, a picking pattern …) and its feel
// (speed, swing, touch, spread, octave). Both belong to the clip that is open, so one clip can be strummed and the
// next one picked on the same track; "All clips" makes every clip of the track play this way. What the chords sound
// like (the instrument, its strings, the effects) is the track's, in its sound window.
//
// `PlayingRow` is the row over the tray: the style with ‹ › to step through its kind, and "All clips". The style's
// name opens `PlayingPanel` in the board's place: every style by kind, and the feel.
// (The top of the old Chords page's sound card, components/HarpPanel.)
//
// A track on the synth shows neither: the synth's own way of playing takes the place of style and feel.
import { useState } from "react";
import { FEEL_DEFAULT, STYLES, STYLE_GROUPS, getStyle, type Feel, type PatternId, type StyleGroup } from "../../../audio/patterns";
import { Seg } from "../../components/common";
import { Knob, Picker } from "../../components/controls";

/** The next style of the same kind, going round. */
export function stepStyle(id: PatternId, dir: -1 | 1): PatternId {
  const st = getStyle(id);
  const pool = STYLES.filter((x) => x.group === st.group);
  return pool[(pool.findIndex((x) => x.id === st.id) + dir + pool.length) % pool.length].id;
}

export function PlayingRow({ style, open, onOpen, onStyle, all }: {
  style: PatternId;
  /** the panel with every style and the feel is open */
  open: boolean;
  onOpen: () => void;
  onStyle: (id: PatternId) => void;
  /** "All clips": shown when the track has another clip; `same`: they all play this way already */
  all?: { same: boolean; run: () => void };
}) {
  const st = getStyle(style);
  return (
    <span className="cp-playing" role="group" aria-label="How the chords are played">
      <Picker label="Playing style" name={st.name} open={open} onOpen={onOpen} onStep={(dir) => onStyle(stepStyle(style, dir))} />
      {all && (
        <button className="chip cp-all" disabled={all.same} title={all.same ? "Every clip of this track is played this way" : "Play every clip of this track in this style, with this feel"} onClick={all.run}>All clips</button>
      )}
    </span>
  );
}

export function PlayingPanel({ style, onStyle, feel, setFeel, onClose }: {
  style: PatternId;
  onStyle: (id: PatternId) => void;
  /** how the style is played */
  feel: Feel;
  setFeel: (patch: Partial<Feel>) => void;
  onClose: () => void;
}) {
  const st = getStyle(style);
  const [group, setGroup] = useState<StyleGroup>(st.group);
  // (stepped to a style of another kind from the row: the list follows)
  const [was, setWas] = useState(st.group);
  if (was !== st.group) {
    setWas(st.group);
    setGroup(st.group);
  }
  return (
    <section className="card cp-play" role="region" aria-label="Playing style and feel">
      <div className="cp-play-head">
        <h3>Playing style</h3>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <div className="dm-chips" role="radiogroup" aria-label="Kind of style">
        {STYLE_GROUPS.map((g) => <button key={g.id} role="radio" aria-checked={group === g.id} className={`chip${group === g.id ? " on" : ""}`} onClick={() => setGroup(g.id)}>{g.name}</button>)}
      </div>
      <div className="dm-chips cp-styles" role="listbox" aria-label="Styles">
        {STYLES.filter((x) => x.group === group).map((x) => (
          <span key={x.id} className={`beat-item${style === x.id ? " on" : ""}`}>
            <button role="option" aria-selected={style === x.id} title={x.hint} onClick={() => onStyle(x.id)}>{x.name}</button>
          </span>
        ))}
      </div>
      <h3>Feel</h3>
      <div className="knobs feel" role="group" aria-label="Feel">
        <div className="knob wide">
          <span><i>Speed</i></span>
          <Seg value={feel.speed} options={[{ value: 0.5, label: "½×" }, { value: 1, label: "1×" }, { value: 2, label: "2×" }]} onChange={(v) => setFeel({ speed: v })} label="Speed of the pattern" />
        </div>
        <Knob label="Swing" title="How far the off-beats lean back" value={feel.swing} def={FEEL_DEFAULT.swing} onChange={(v) => setFeel({ swing: v })} />
        <Knob label="Touch" title="Left: a whisper. Right: dug in hard." value={feel.touch} def={FEEL_DEFAULT.touch} onChange={(v) => setFeel({ touch: v })} />
        <Knob label="Spread" title="How spread out strums and rolls are" value={feel.spread} def={FEEL_DEFAULT.spread} onChange={(v) => setFeel({ spread: v })} />
        <div className="knob wide">
          <span><i>Octave</i></span>
          <Seg value={feel.octave} options={[{ value: -1, label: "Low" }, { value: 0, label: "Mid" }, { value: 1, label: "High" }]} onChange={(v) => setFeel({ octave: v })} label="Octave" />
        </div>
      </div>
    </section>
  );
}
