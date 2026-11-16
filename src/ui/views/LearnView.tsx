import { useMemo, useState } from "react";
import { ProgressionPlayer, getAudio, playNote } from "../../audio/synth";
import { arrangeProgression } from "../../guitar/arrange";
import { chordSymbol, getChordType, type ChordRef } from "../../theory/chords";
import { INTERVAL_SOUNDS, intervalName } from "../../theory/intervals";
import { diatonicChords, type Key } from "../../theory/keys";
import { displayNote, pc } from "../../theory/notes";
import { MAJOR_MODE_IDS, MODES_BY_BRIGHTNESS, bestTonicSpelling, getScale, scaleNotes, type ScaleType } from "../../theory/scales";
import { moodOf } from "../components/KeyPicker";
import { Disclosure, Seg, displayRoman } from "../components/common";
import { newId, useApp } from "../state";
import { ScaleOnNeck } from "./NeckView";

const learnPlayer = { current: null as ProgressionPlayer | null };

function romanToChord(roman: string, key: Key): ChordRef | null {
  for (const size of [3, 4] as const) {
    const c = diatonicChords(key, size).find((d) => d.roman === roman);
    if (c) return c.ref;
  }
  return null;
}

export function LearnView() {
  const { state } = useApp();
  const name = `${displayNote(state.key.tonic)} ${getScale(state.key.scaleId).short}`;
  return (
    <div className="stack">
      <Disclosure className="topic" title="🌗 Modes">
        <ModeLadder />
      </Disclosure>
      <Disclosure className="topic" title="🎯 Fretboard" hint={name}>
        <ScaleOnNeck />
      </Disclosure>
      <Disclosure className="topic" title="🧱 Chord recipes">
        <ChordRecipes />
      </Disclosure>
      <Disclosure className="topic" title="📊 Chords in each mode">
        <QualityTable />
      </Disclosure>
      <Disclosure className="topic" title="👂 Intervals">
        <Intervals />
      </Disclosure>
      <Disclosure className="topic" title="⭕ Circle of fifths">
        <CircleOfFifths />
      </Disclosure>
    </div>
  );
}

// ── Modes ──────────────────────────────────────────────────

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
    <div className="stack" style={{ gap: 12 }}>
      <p className="small muted">
        Same notes, different home. Brightest to darkest; highlighted steps differ from major.
      </p>
      <div className="mode-cards">
        {MODES_BY_BRIGHTNESS.map((sc) => {
          const tonic = bestTonicSpelling(pcT, sc);
          const key: Key = { tonic, scaleId: sc.id };
          const vamp = (sc.vamps ?? []).map((v) => v.map((r) => romanToChord(r, key))).find((v): v is ChordRef[] => v.every(Boolean));
          const current = state.key.scaleId === sc.id && pc(state.key.tonic) === pcT;
          return (
            <div key={sc.id} className={`mode-card${current ? " current" : ""}`}>
              <div>
                <h3>{moodOf(sc.id)}</h3>
                <p className="small muted">{displayNote(tonic)} {sc.name}{current ? " · your key" : ""}</p>
              </div>
              <div className="brightness" title={`Brightness ${sc.brightness} of 7`}><i style={{ left: `${(((sc.brightness ?? 1) - 1) / 6) * 100}%` }} /></div>
              <Formula scale={sc} major={major} />
              {sc.compareTo && sc.id !== "ionian" && <p className="small"><b>{sc.compareTo.charAt(0).toUpperCase() + sc.compareTo.slice(1)}.</b></p>}
              <p className="small muted">{scaleNotes(tonic, sc).map(displayNote).join(" ")}</p>
              <div className="row tight">
                {vamp && <button className="btn sm" onClick={() => play(vamp, sc.id)}>{playingId === sc.id ? "■ Stop" : `▶ ${vamp.map((r) => chordSymbol(r)).join(" → ")}`}</button>}
                {!current && <button className="btn sm ghost" onClick={() => { set((s) => ({ ...s, key, tab: "write" })); toast(`Now writing in ${displayNote(tonic)} ${sc.short}`); }}>Write in this mode →</button>}
                {current && vamp && (
                  <button className="btn sm ghost" onClick={() => { set((s) => ({ ...s, tab: "write", progression: { ...s.progression, chords: vamp.map((ref) => ({ id: newId(), ref, beats: 4 })) } })); toast("Loaded into your song"); }}>Use as my song →</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Formula({ scale, major }: { scale: ScaleType; major: ScaleType }) {
  return (
    <div className="formula" aria-label="Scale steps compared with major">
      {scale.intervals.map((iv, i) => (
        <span key={i} className={iv !== major.intervals[i] ? "changed" : ""} title={intervalName(iv)}>{iv.replace(/b/g, "♭").replace(/#/g, "♯")}</span>
      ))}
    </div>
  );
}

// ── Chord recipes ──────────────────────────────────────────

function ChordRecipes() {
  const { state, openSheet } = useApp();
  const recipes: { id: string; how: string }[] = [
    { id: "maj", how: "Root + big 3rd + 5th" },
    { id: "min", how: "Root + small 3rd + 5th" },
    { id: "sus2", how: "Swap the 3rd for the 2nd" },
    { id: "sus4", how: "Swap the 3rd for the 4th" },
    { id: "add9", how: "Major + the 9th (the 2nd, an octave up)" },
    { id: "maj7", how: "Major + the note just below the root" },
    { id: "7", how: "Major + the note a whole step below the root" },
    { id: "m7", how: "Minor + the note a whole step below the root" },
    { id: "m7b5", how: "Minor with a lowered 5th, plus ♭7" },
    { id: "dim", how: "Small 3rd + small 3rd" },
    { id: "aug", how: "Big 3rd + big 3rd" },
    { id: "6", how: "Major + the 6th" },
  ];
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="small muted">
        Root + notes counted up the scale. The 3rd decides major or minor.
      </p>
      <div className="recipe">
        {recipes.map((r) => {
          const t = getChordType(r.id);
          const ref = { root: state.key.tonic, typeId: r.id };
          return (
            <button key={r.id} className="recipe-item" onClick={() => openSheet({ ref })}>
              <b style={{ fontSize: "1.05rem" }}>{chordSymbol(ref)} <span className="muted small">{t.name}</span></b>
              <span className="small">{r.how}</span>
              <span className="mono tiny muted">{t.intervals.map((i) => i.replace(/b/g, "♭").replace(/#/g, "♯")).join(" · ")}</span>
              <span className="small muted">{t.feel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Mode chord table ───────────────────────────────────────

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
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="small muted">
        <b>Major, minor, minor, Major, Major, minor, diminished</b>: each mode starts that pattern from a different step.
      </p>
      <div className="row tight">
        <Seg value={size} options={[{ value: 3, label: "Simple" }, { value: 4, label: "7ths" }]} onChange={setSize} />
        <div className="legend"><span className="q-maj">● Major</span><span className="q-min">● Minor</span><span className="q-dim">● Diminished</span><span className="q-aug">● Augmented</span></div>
      </div>
      <div className="table-wrap">
        <table className="mode-table">
          <thead><tr><th>Mood</th>{[1, 2, 3, 4, 5, 6, 7].map((d) => <th key={d}>{d}</th>)}</tr></thead>
          <tbody>
            {[...MAJOR_MODE_IDS, "harmonicMinor"].map((id) => {
              const sc = getScale(id);
              const key: Key = { tonic: bestTonicSpelling(pcT, sc), scaleId: id };
              return (
                <tr key={id} className={state.key.scaleId === id ? "cur" : ""} onClick={() => set((s) => ({ ...s, key, tab: "write" }))}>
                  <td><b>{moodOf(id)}</b><div className="tiny muted">{sc.short}</div></td>
                  {diatonicChords(key, size).map((c) => (
                    <td key={c.degree} className={qualityClass(c.type.id)} title={`${chordSymbol(c.ref)} (${c.type.name})`}>{displayRoman(c.roman)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Intervals ──────────────────────────────────────────────

function Intervals() {
  const { state } = useApp();
  const root = 48 + pc(state.key.tonic);
  const play = (semis: number) => {
    const t = getAudio().currentTime + 0.05;
    playNote(root, t, 0.8, 0, 1.4);
    playNote(root + semis, t + 0.5, 0.8, 1, 1.6);
    playNote(root, t + 1.2, 0.6, 2, 1.6);
    playNote(root + semis, t + 1.2, 0.6, 3, 1.6);
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="small muted">The distance between two notes, in frets.</p>
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
    </div>
  );
}

// ── Circle of fifths ───────────────────────────────────────

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
    <div className="stack" style={{ gap: 10 }}>
      <p className="small muted">Neighbours share 6 of 7 notes. Outside: major. Inside: minor.</p>
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
            return (
              <g key={n}>
                <text x={x} y={y + 5} textAnchor="middle" fontSize={15} fontWeight={800} fill={!isMinorish && i === curIdx ? "var(--accent-ink)" : "var(--text)"} style={{ cursor: "pointer" }}
                  onClick={() => set((s) => ({ ...s, key: { tonic: n, scaleId: "ionian" }, tab: "write" }))}>{displayNote(n)}</text>
                <text x={x2} y={y2 + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={isMinorish && i === curIdx ? "var(--accent)" : "var(--muted)"} style={{ cursor: "pointer" }}
                  onClick={() => set((s) => ({ ...s, key: { tonic: MIN[i], scaleId: "aeolian" }, tab: "write" }))}>{displayNote(MIN[i])}m</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
