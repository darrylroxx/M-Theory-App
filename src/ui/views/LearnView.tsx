import { useMemo, useState } from "react";
import { ProgressionPlayer, getAudio, playNote } from "../../audio/synth";
import { arrangeProgression } from "../../guitar/arrange";
import { chordSymbol, getChordType, type ChordRef } from "../../theory/chords";
import { INTERVAL_SOUNDS, intervalName } from "../../theory/intervals";
import { diatonicChords, type Key } from "../../theory/keys";
import { displayNote, pc } from "../../theory/notes";
import { MAJOR_MODE_IDS, MODES_BY_BRIGHTNESS, bestTonicSpelling, getScale, scaleNotes, type ScaleType } from "../../theory/scales";
import { Seg, displayRoman } from "../components/common";
import { newId, useApp } from "../state";

const learnPlayer = { current: null as ProgressionPlayer | null };

function romanToChord(roman: string, key: Key): ChordRef | null {
  for (const size of [3, 4] as const) {
    const c = diatonicChords(key, size).find((d) => d.roman === roman);
    if (c) return c.ref;
  }
  return null;
}

export function LearnView() {
  return (
    <div className="stack">
      <QualityTable />
      <ModeLadder />
      <ChordRecipes />
      <Intervals />
      <CircleOfFifths />
    </div>
  );
}

function qualityClass(typeId: string): string {
  const t = getChordType(typeId);
  if (t.intervals.includes("#5")) return "q-aug";
  if (t.intervals.includes("b5")) return "q-dim";
  if (t.intervals.includes("b3")) return "q-min";
  return "q-maj";
}

function QualityTable() {
  const { state, set } = useApp();
  const [size, setSize] = useState<3 | 4>(3);
  const pcT = pc(state.key.tonic);
  const families: { title: string; ids: string[] }[] = [
    { title: "Modes of the major scale", ids: MAJOR_MODE_IDS },
    { title: "Minor-key colours", ids: ["harmonicMinor", "melodicMinor", "phrygianDominant", "lydianDominant", "mixolydianb6", "harmonicMajor"] },
  ];
  return (
    <section className="card">
      <div className="section-title">
        <h2>How chords relate in every mode</h2>
        <Seg value={size} options={[{ value: 3, label: "Triads" }, { value: 4, label: "7ths" }]} onChange={setSize} />
      </div>
      <p className="small muted" style={{ marginBottom: 10 }}>
        Every major key follows the pattern <b>Major · minor · minor · Major · Major · minor · diminished</b> (in 7ths: maj7 · m7 · m7 · maj7 · 7 · m7 · m7♭5).
        Each mode is the same pattern <i>started from a different step</i>, which is why Dorian has a major IV and Mixolydian a major ♭VII.
        Rows use {displayNote(state.key.tonic)} as home; tap one to switch your key.
      </p>
      <div className="legend" style={{ marginBottom: 8 }}>
        <span className="q-maj">● Major</span><span className="q-min">● Minor</span><span className="q-dim">● Diminished / ø</span><span className="q-aug">● Augmented</span>
      </div>
      {families.map((fam) => (
        <div key={fam.title} className="table-wrap" style={{ marginBottom: 12 }}>
          <table className="mode-table">
            <thead><tr><th>{fam.title}</th>{["1", "2", "3", "4", "5", "6", "7"].map((d) => <th key={d}>{d}</th>)}</tr></thead>
            <tbody>
              {fam.ids.map((id) => {
                const sc = getScale(id);
                const key: Key = { tonic: bestTonicSpelling(pcT, sc), scaleId: id };
                const ch = diatonicChords(key, size);
                return (
                  <tr key={id} className={state.key.scaleId === id ? "cur" : ""} onClick={() => set((s) => ({ ...s, key }))}>
                    <td><b>{sc.short}</b></td>
                    {ch.map((c) => (
                      <td key={c.degree} className={qualityClass(c.type.id)} title={`${chordSymbol(c.ref)} (${c.type.name})`}>
                        {displayRoman(c.roman)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

function ModeLadder() {
  const { state, set, tuning, toast } = useApp();
  const pcT = pc(state.key.tonic);
  const major = getScale("ionian");
  const [playingId, setPlayingId] = useState<string | null>(null);

  const play = (chords: ChordRef[], id: string) => {
    getAudio();
    learnPlayer.current?.stop();
    if (playingId === id) { setPlayingId(null); return; }
    const vs = arrangeProgression([...chords, ...chords], { tuning, capo: state.settings.capo, avoidBarre: true, preferOpen: false, targetFret: null, allowInversions: false });
    const p = (learnPlayer.current ??= new ProgressionPlayer());
    p.onStep = () => {};
    p.onEnd = () => setPlayingId(null);
    p.start(vs.map((v) => ({ midi: v.midi, beats: 4 })), 100, "strum", false);
    setPlayingId(id);
  };

  return (
    <section className="card">
      <div className="section-title"><h2>The mode ladder: brightest → darkest</h2></div>
      <p className="small muted" style={{ marginBottom: 12 }}>
        All seven modes on {displayNote(state.key.tonic)}. Each step down the ladder flattens one more note. To make a mode obvious:
        <b> 1)</b> stay on the home chord a lot, <b>2)</b> rock between it and the chord holding the signature note, <b>3)</b> land melodies on the signature note.
      </p>
      <div className="mode-cards">
        {MODES_BY_BRIGHTNESS.map((sc) => {
          const tonic = bestTonicSpelling(pcT, sc);
          const key: Key = { tonic, scaleId: sc.id };
          const notes = scaleNotes(tonic, sc);
          const vamps = (sc.vamps ?? []).map((v) => v.map((r) => romanToChord(r, key))).filter((v): v is ChordRef[] => v.every(Boolean));
          return (
            <div key={sc.id} className="mode-card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3>{displayNote(tonic)} {sc.name}</h3>
                {state.key.scaleId === sc.id && pc(state.key.tonic) === pcT && <span className="pill home">current</span>}
              </div>
              <div className="brightness" title={`Brightness ${sc.brightness}/7`}><i style={{ left: `${(((sc.brightness ?? 1) - 1) / 6) * 100}%` }} /></div>
              <p className="small" style={{ color: "var(--accent-2)", fontWeight: 650 }}>{sc.mood}</p>
              <Formula scale={sc} major={major} />
              <p className="small muted">{notes.map(displayNote).join(" ")}</p>
              <p className="small">{sc.description}</p>
              {vamps.slice(0, 2).map((v, i) => (
                <div key={i} className="row tight">
                  <button className="btn sm" onClick={() => play(v, sc.id + i)}>{playingId === sc.id + i ? "■" : "▶"} {v.map((r) => chordSymbol(r)).join(" → ")}</button>
                  <button className="btn sm ghost" title="Send to Compose" onClick={() => {
                    set((s) => ({ ...s, key, tab: "compose", progression: { ...s.progression, chords: v.map((ref) => ({ id: newId(), ref, beats: 4 })) } }));
                    toast("Vamp sent to Compose");
                  }}>→ Compose</button>
                </div>
              ))}
              <button className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => set((s) => ({ ...s, key, tab: "key" }))}>Explore {displayNote(tonic)} {sc.short} chords →</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Formula({ scale, major }: { scale: ScaleType; major: ScaleType }) {
  return (
    <div className="formula">
      {scale.intervals.map((iv, i) => (
        <span key={i} className={iv !== major.intervals[i] ? "changed" : ""} title={intervalName(iv)}>{iv === "1" ? "1" : iv.replace(/b/g, "♭").replace(/#/g, "♯")}</span>
      ))}
    </div>
  );
}

function ChordRecipes() {
  const { state, openSheet } = useApp();
  const recipes: { id: string; stack: string }[] = [
    { id: "maj", stack: "Major 3rd + minor 3rd" },
    { id: "min", stack: "minor 3rd + Major 3rd" },
    { id: "dim", stack: "minor 3rd + minor 3rd" },
    { id: "aug", stack: "Major 3rd + Major 3rd" },
    { id: "sus2", stack: "3rd replaced by the 2nd" },
    { id: "sus4", stack: "3rd replaced by the 4th" },
    { id: "maj7", stack: "Major triad + Major 7th" },
    { id: "7", stack: "Major triad + minor 7th" },
    { id: "m7", stack: "minor triad + minor 7th" },
    { id: "m7b5", stack: "diminished triad + minor 7th" },
    { id: "dim7", stack: "diminished triad + diminished 7th" },
    { id: "add9", stack: "Major triad + 9th (2nd an octave up)" },
    { id: "6", stack: "Major triad + Major 6th" },
    { id: "m9", stack: "minor 7th + 9th" },
    { id: "mMaj7", stack: "minor triad + Major 7th" },
  ];
  return (
    <section className="card">
      <div className="section-title"><h2>Chord recipes</h2><span className="small muted">on {displayNote(state.key.tonic)}. Tap for every voicing</span></div>
      <div className="recipe">
        {recipes.map((r) => {
          const t = getChordType(r.id);
          const ref = { root: state.key.tonic, typeId: r.id };
          return (
            <button key={r.id} className="recipe-item" onClick={() => openSheet({ ref })}>
              <b style={{ fontSize: "1.05rem" }}>{chordSymbol(ref)} <span className="muted small">{t.name}</span></b>
              <span className="mono small">{t.intervals.map((i) => (i === "1" ? "1" : i.replace(/b/g, "♭").replace(/#/g, "♯"))).join(" – ")}</span>
              <span className="small muted">{r.stack}</span>
              <span className="small">{t.feel}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Intervals() {
  const { state } = useApp();
  const root = 48 + pc(state.key.tonic);
  const play = (semis: number) => {
    getAudio();
    const t = getAudio().currentTime + 0.05;
    playNote(root, t, 0.8, 0, 1.4);
    playNote(root + semis, t + 0.5, 0.8, 1, 1.6);
    playNote(root, t + 1.2, 0.6, 2, 1.6);
    playNote(root + semis, t + 1.2, 0.6, 3, 1.6);
  };
  return (
    <section className="card">
      <div className="section-title"><h2>Intervals by ear</h2><span className="small muted">from {displayNote(state.key.tonic)}: melodic, then together</span></div>
      <div className="interval-list">
        {INTERVAL_SOUNDS.filter((i) => i.semis > 0).map((i) => (
          <div key={i.semis} className="interval-item">
            <button className="mini-play" onClick={() => play(i.semis)} aria-label={`Play ${i.name}`}>▶</button>
            <div>
              <b>{i.name}</b> <span className="pill">{i.semis} fret{i.semis > 1 ? "s" : ""}</span>
              <p className="small muted">{i.sound}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CircleOfFifths() {
  const { state, set } = useApp();
  const MAJ = ["C", "G", "D", "A", "E", "B", "F#", "Db", "Ab", "Eb", "Bb", "F"];
  const MIN = ["A", "E", "B", "F#", "C#", "G#", "D#", "Bb", "F", "C", "G", "D"];
  const cur = pc(state.key.tonic);
  const isMinorish = useMemo(() => getScale(state.key.scaleId).intervals.includes("b3"), [state.key.scaleId]);
  const size = 320;
  const c = size / 2;
  const pos = (i: number, r: number) => [c + r * Math.sin((i * Math.PI) / 6), c - r * Math.cos((i * Math.PI) / 6)];
  const curIdx = isMinorish ? MIN.findIndex((n) => pc(n) === cur) : MAJ.findIndex((n) => pc(n) === cur);

  return (
    <section className="card">
      <div className="section-title"><h2>Circle of fifths</h2><span className="small muted">neighbours share 6 of 7 notes: perfect for key changes</span></div>
      <div className="circle-wrap">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Circle of fifths">
          <circle cx={c} cy={c} r={150} fill="var(--card-2)" stroke="var(--border)" />
          <circle cx={c} cy={c} r={92} fill="var(--bg-2)" stroke="var(--border)" />
          {curIdx >= 0 && [-1, 0, 1].map((d) => {
            const i = (curIdx + d + 12) % 12;
            const [x, y] = pos(i, 121);
            return <circle key={d} cx={x} cy={y} r={d === 0 ? 25 : 21} fill={d === 0 ? "var(--accent)" : "color-mix(in srgb, var(--accent) 22%, transparent)"} />;
          })}
          {MAJ.map((n, i) => {
            const [x, y] = pos(i, 121);
            const [x2, y2] = pos(i, 68);
            const on = !isMinorish && i === curIdx;
            const onMin = isMinorish && i === curIdx;
            return (
              <g key={n}>
                <text x={x} y={y + 5} textAnchor="middle" fontSize={15} fontWeight={800} fill={on ? "var(--accent-ink)" : "var(--text)"} style={{ cursor: "pointer" }}
                  onClick={() => set((s) => ({ ...s, key: { tonic: n, scaleId: "ionian" } }))}>{displayNote(n)}</text>
                <text x={x2} y={y2 + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={onMin ? "var(--accent)" : "var(--muted)"} style={{ cursor: "pointer" }}
                  onClick={() => set((s) => ({ ...s, key: { tonic: MIN[i], scaleId: "aeolian" } }))}>{displayNote(MIN[i])}m</text>
              </g>
            );
          })}
          <text x={c} y={c + 4} textAnchor="middle" fontSize={11} fill="var(--faint)" fontWeight={700}>outer: major</text>
          <text x={c} y={c + 18} textAnchor="middle" fontSize={11} fill="var(--faint)" fontWeight={700}>inner: minor</text>
        </svg>
      </div>
      <p className="small muted" style={{ textAlign: "center" }}>
        Highlighted: your key and its two neighbours. Moving one step clockwise adds a ♯ (or removes a ♭). Each major key shares all its notes with the relative minor printed inside it. Tap any key to switch.
      </p>
    </section>
  );
}
