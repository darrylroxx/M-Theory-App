import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { playNote } from "../../audio/synth";
import { EMPTY_MELODY, GRIDS, barHasNotes, cellTick, clearMelody, copyMelodyBar, melodyBars, melodyRows, notesInCell, toggleNote, type Melody } from "../../song/melody";
import { chordSymbol, refPcs } from "../../theory/chords";
import type { Key } from "../../theory/keys";
import { displayNote, mod12 } from "../../theory/notes";
import type { HarpSound } from "../../audio/rack";
import { SoundControls, type Link } from "./HarpPanel";
import type { ProgChord } from "../state";
import { Seg } from "./common";

/**
 * The melody: a grid of notes. Tap a square and that note plays at that moment.
 * Rows that belong to the key are lit; a dot marks the notes of the chord sounding underneath,
 * so a tune that sticks to lit rows and dots cannot sound wrong.
 * The grid has every bar of the section: a bar with notes in it plays, an empty bar is silent.
 */
export function MelodyGrid({ fresh, melody, setMelody, keyOf, bar, chords, playing, getPos, sound, setSound, onHear, link }: {
  /** changes when another section is shown or something is pasted: undo starts afresh */
  fresh?: string;
  /** the section's melody, as long as the section */
  melody: Melody;
  setMelody: (fn: (m: Melody) => Melody) => void;
  keyOf: Key;
  /** beats in a bar */
  bar: number;
  /** the chords under the melody, to mark the notes that fit them */
  chords: ProgChord[];
  playing: boolean;
  /** how many beats into the section the music is (null = stopped) */
  getPos: () => number | null;
  /** the melody's own harp: its instrument and effects, apart from the chords' */
  sound: HarpSound;
  setSound: (patch: Partial<HarpSound>) => void;
  onHear: () => void;
  link?: Link;
}) {
  const [shown, setShown] = useState(0);
  const [keyOnly, setKeyOnly] = useState(false);
  const [past, setPast] = useState<Melody[]>([]);
  const stepsRef = useRef<HTMLDivElement>(null);
  const bars = melodyBars(melody);
  const at = Math.min(shown, bars - 1);
  const steps = Math.max(1, Math.round(bar * melody.div));
  // undo only goes back through this section's own edits
  useEffect(() => setPast([]), [fresh]);
  const live = useRef({ at, bars, steps, bar, div: melody.div });
  live.current = { at, bars, steps, bar, div: melody.div };

  // the rows: two octaves from the home note, stretched to hold any note already written outside them
  const rows = useMemo(() => {
    const base = melodyRows(keyOf, keyOnly);
    const all = melodyRows(keyOf);
    const extra = melody.notes.filter((n) => !base.some((r) => r.midi === n.midi)).map((n) => n.midi);
    if (!extra.length) return base;
    const have = new Set(base.map((r) => r.midi));
    const more = [...new Set(extra)].map((midi) => all.find((r) => r.midi === midi) ?? { ...all.find((r) => mod12(r.midi) === mod12(midi))!, midi });
    return [...base, ...more.filter((r) => !have.has(r.midi))].sort((a, b) => b.midi - a.midi);
  }, [keyOf, keyOnly, melody.notes]);

  // which chord sounds at each step of the bar on screen
  const fits = useMemo(() => {
    return Array.from({ length: steps }, (_, k) => {
      let pos = at * bar + k / melody.div;
      for (const c of chords) {
        // the chord's name is written over the step where it comes in (a rest has no notes to fit)
        if (pos < c.beats - 1e-6) return c.rest ? null : { pcs: new Set(refPcs(c.ref)), name: pos < 1 / melody.div - 1e-6 ? chordSymbol(c.ref) : "" };
        pos -= c.beats;
      }
      return null;
    });
  }, [chords, steps, at, bar, melody.div]);

  // the moving line, and following the bar that is playing, without redrawing the grid on every frame
  useEffect(() => {
    if (!playing) {
      stepsRef.current?.style.setProperty("--now", "-1");
      return;
    }
    let raf = 0;
    const tick = () => {
      const pos = getPos();
      const el = stepsRef.current;
      const l = live.current;
      if (pos !== null && el) {
        const inTune = ((pos % (l.bars * l.bar)) + l.bars * l.bar) % (l.bars * l.bar);
        const b = Math.floor(inTune / l.bar + 1e-6);
        if (b !== l.at) setShown(b);
        el.style.setProperty("--now", b === l.at ? String(Math.floor((inTune - b * l.bar) * l.div + 1e-6)) : "-1");
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, getPos]);

  const change = (fn: (m: Melody) => Melody) => {
    setPast((p) => [...p.slice(-49), melody]);
    setMelody(fn);
  };
  const tap = (midi: number, k: number) => {
    const tick = cellTick(melody, bar, at, k);
    const adding = !notesInCell(melody, tick, midi).length;
    change((m) => toggleNote(m, tick, midi));
    if (adding && !playing) playNote(midi, undefined, 0.86, 48);
  };
  const undo = () => {
    const last = past[past.length - 1];
    if (!last) return;
    setPast((p) => p.slice(0, -1));
    setMelody(() => last);
  };
  const tabsRef = useRef<HTMLDivElement>(null);
  // keep the bar on screen in view in its row (sideways only)
  useEffect(() => {
    const r = tabsRef.current;
    const el = r?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!r || !el) return;
    if (el.offsetLeft < r.scrollLeft) r.scrollLeft = el.offsetLeft - 8;
    else if (el.offsetLeft + el.offsetWidth > r.scrollLeft + r.clientWidth) r.scrollLeft = el.offsetLeft + el.offsetWidth - r.clientWidth + 8;
  }, [at]);
  const on = melody.on !== false;
  const count = melody.notes.length;

  return (
    <section className="card melody" aria-label="Melody">
      <div className="dm-head">
        <h2>Melody</h2>
        {count > 0 && <button className={`chip${on ? " on" : ""}`} role="switch" aria-checked={on} title="Play the melody with the chords" onClick={() => setMelody((m) => ({ ...m, on: !on }))}>{on ? "On" : "Off"}</button>}
        <span className="spacer" />
        <span className="kb-label" title="How many steps there are to a beat">Grid</span>
        <Seg value={melody.div} options={GRIDS.map((g) => ({ value: g.value, label: g.label }))} onChange={(v) => setMelody((m) => ({ ...m, div: v }))} label="Steps to a beat" />
      </div>

      <div className="dm-bar">
        <span className="kb-label">Bar</span>
        <div className="dm-bars" role="tablist" aria-label="Bar" ref={tabsRef}>
          {Array.from({ length: bars }, (_, b) => <button key={b} role="tab" aria-selected={b === at} className={`${b === at ? "on" : ""}${barHasNotes(melody, bar, b) ? "" : " hollow"}`} title={barHasNotes(melody, bar, b) ? undefined : "Empty: plays nothing"} onClick={() => setShown(b)}>{b + 1}</button>)}
        </div>
        {bars > 1 && <button className="btn sm" title="Copy the bar before this one into it" disabled={at === 0} onClick={() => change((m) => copyMelodyBar(m, bar, at - 1, at))}>⧉</button>}
        <span className="spacer" />
        <button className={`chip${keyOnly ? " on" : ""}`} aria-pressed={keyOnly} title="Show only the notes of the key" onClick={() => setKeyOnly(!keyOnly)}>Key only</button>
        <button className="btn sm" aria-label="Undo" title="Undo" disabled={!past.length} onClick={undo}>↶</button>
        <button className="btn sm" disabled={!barHasNotes(melody, bar, at)} title="Empty this bar" onClick={() => change((m) => clearMelody(m, bar, at))}>Clear</button>
      </div>

      <div className="mg" style={{ "--steps": steps, "--div": melody.div } as CSSProperties}>
        <div className="mg-labels">
          {chords.length > 0 && <span className="mg-label mg-corner" />}
          {rows.map((r) => (
            <button key={r.midi} className={`mg-label${r.inKey ? " in" : ""}${r.home ? " home" : ""}`} aria-label={`Hear ${displayNote(r.name)}`} onClick={() => playNote(r.midi, undefined, 0.86, 48)}>{displayNote(r.name)}</button>
          ))}
        </div>
        <div className="mg-steps" ref={stepsRef} role="grid" aria-label="Melody notes">
          {chords.length > 0 && <div className="mg-row mg-chords" aria-hidden="true">{fits.map((f, k) => <span key={k}>{f?.name}</span>)}</div>}
          {rows.map((r) => (
            <div key={r.midi} className={`mg-row${r.inKey ? " in" : ""}${r.home ? " home" : ""}`} role="row">
              {Array.from({ length: steps }, (_, k) => {
                const has = notesInCell(melody, cellTick(melody, bar, at, k), r.midi).length > 0;
                const fit = fits[k]?.pcs.has(mod12(r.midi));
                return <button key={k} role="gridcell" aria-pressed={has} aria-label={`${displayNote(r.name)}, step ${k + 1}`} className={`mg-cell${has ? " on" : ""}${fit ? " fit" : ""}${k % melody.div === 0 ? " beat" : ""}`} onClick={() => tap(r.midi, k)} />;
              })}
            </div>
          ))}
          <i className="mg-now" />
        </div>
      </div>
      <SoundControls sound={sound} setSound={setSound} onHear={onHear} link={link} />
    </section>
  );
}

export { EMPTY_MELODY };
