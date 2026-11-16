import { useEffect, useMemo, useRef, useState } from "react";
import { downloadBytes, progressionToMidi } from "../../audio/midi";
import { PATTERNS, type PatternId } from "../../audio/patterns";
import { ProgressionPlayer, getAudio } from "../../audio/synth";
import { arrangeProgression, voicingsFor } from "../../guitar/arrange";
import { fretsFromId, voicingFromFrets, voicingText, type Voicing } from "../../guitar/voicings";
import { chordSymbol, chordSymbolAscii, getChordType, type ChordRef } from "../../theory/chords";
import { analyzeChord, transposeRef } from "../../theory/keys";
import { displayNote, pc } from "../../theory/notes";
import { MOODS, colorize, sparkProgression, substitutesFor, suggestNext, type Mood } from "../../theory/progression";
import { bestTonicSpelling, getScale } from "../../theory/scales";
import { ChordDiagram } from "../components/ChordDiagram";
import { RolePill, Seg, displayRoman } from "../components/common";
import { newId, useApp, type ProgChord, type Progression } from "../state";

const ZONE_TARGET = { any: null, low: 2, mid: 7, high: 11 } as const;

export function ComposeView() {
  const { state, set, tuning, openSheet, audition, toast } = useApp();
  const prog = state.progression;
  const key = state.key;
  const capo = state.settings.capo;
  const [sel, setSel] = useState<string | null>(null);
  const [nowIdx, setNowIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [showSubs, setShowSubs] = useState(false);
  const player = useRef<ProgressionPlayer | null>(null);

  const setProg = (fn: (p: Progression) => Progression) => set((s) => ({ ...s, progression: fn(s.progression) }));
  const setChords = (fn: (c: ProgChord[]) => ProgChord[]) => setProg((p) => ({ ...p, chords: fn(p.chords) }));

  const refs = prog.chords.map((c) => c.ref);
  const refsKey = JSON.stringify(refs);
  const arranged = useMemo(
    () =>
      arrangeProgression(refs, {
        tuning, capo, avoidBarre: prog.avoidBarre, preferOpen: prog.preferOpen, targetFret: ZONE_TARGET[prog.zone], allowInversions: prog.allowInversions,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refsKey, tuning, capo, prog.avoidBarre, prog.preferOpen, prog.zone, prog.allowInversions],
  );
  const voicings: (Voicing | undefined)[] = prog.chords.map((c, i) => {
    if (!c.voicingId) return arranged[i];
    const found = voicingsFor(c.ref, tuning, capo).find((v) => v.id === c.voicingId);
    if (found) return found;
    const frets = fretsFromId(c.voicingId);
    if (frets.length !== tuning.notes.length) return arranged[i];
    return voicingFromFrets(frets, pc(c.ref.root), getChordType(c.ref.typeId), tuning, capo);
  });
  const items = prog.chords.map((c, i) => ({ midi: voicings[i]?.midi ?? [], beats: c.beats }));

  useEffect(() => {
    if (player.current?.playing) player.current.update(items, prog.bpm, prog.pattern, prog.loop);
  });
  useEffect(() => () => player.current?.stop(), []);

  const play = () => {
    if (playing) {
      player.current?.stop();
      setPlaying(false);
      setNowIdx(-1);
      return;
    }
    if (!items.length) return;
    getAudio();
    const p = (player.current ??= new ProgressionPlayer());
    p.onStep = (i) => setNowIdx(i);
    p.onEnd = () => { setPlaying(false); setNowIdx(-1); };
    const start = sel ? Math.max(0, prog.chords.findIndex((c) => c.id === sel)) : 0;
    p.start(items, prog.bpm, prog.pattern, prog.loop, start);
    setPlaying(true);
  };

  const selIdx = prog.chords.findIndex((c) => c.id === sel);
  const selected = selIdx >= 0 ? prog.chords[selIdx] : undefined;
  const anchor = selected ?? prog.chords[prog.chords.length - 1];
  const groups = useMemo(() => suggestNext(anchor?.ref ?? null, key, refs), [anchor?.ref, key, refsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const insert = (ref: ChordRef) => {
    const item: ProgChord = { id: newId(), ref, beats: 4 };
    setChords((cs) => {
      const at = selected ? cs.findIndex((c) => c.id === selected.id) : -1;
      const next = [...cs];
      if (at >= 0) next.splice(at + 1, 0, item);
      else next.push(item);
      return next;
    });
    if (selected) setSel(item.id);
  };

  const move = (dir: -1 | 1) => setChords((cs) => {
    const i = cs.findIndex((c) => c.id === sel);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cs.length) return cs;
    const next = [...cs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  return (
    <div className="stack">
      <section className="card stack">
        <div className="transport">
          <button className={`play-btn${playing ? " stop" : ""}`} onClick={play} aria-label={playing ? "Stop" : "Play"} disabled={!items.length}>{playing ? "■" : "▶"}</button>
          <label className="field">Tempo
            <span className="row tight"><input type="range" min={40} max={180} value={prog.bpm} onChange={(e) => setProg((p) => ({ ...p, bpm: Number(e.target.value) }))} /><b className="mono">{prog.bpm}</b></span>
          </label>
          <label className="field">Rhythm
            <select value={prog.pattern} onChange={(e) => setProg((p) => ({ ...p, pattern: e.target.value as PatternId }))}>
              {PATTERNS.map((p) => <option key={p.id} value={p.id} title={p.hint}>{p.label}</option>)}
            </select>
          </label>
          <label className="toggle"><input type="checkbox" checked={prog.loop} onChange={(e) => setProg((p) => ({ ...p, loop: e.target.checked }))} /> Loop</label>
          <span className="spacer" />
          <span className="small muted">Key: <b>{displayNote(key.tonic)} {getScale(key.scaleId).short}</b>{capo ? ` · capo ${capo}` : ""}</span>
        </div>

        {prog.chords.length === 0 ? (
          <div className="empty stack" style={{ alignItems: "center" }}>
            <h2>Start your progression</h2>
            <p>Pick a starting chord from the suggestions, add chords from the Key or Chords tabs, or let M-Theory spark an idea.</p>
          </div>
        ) : (
          <div className="timeline">
            {prog.chords.map((c, i) => {
              const v = voicings[i];
              const a = analyzeChord(c.ref, key);
              return (
                <div key={c.id} className={`slot st-${a.status}${sel === c.id ? " sel" : ""}${nowIdx === i ? " now" : ""}`}
                  onClick={() => { setSel(sel === c.id ? null : c.id); setShowSubs(false); }}>
                  <span className="idx">{i + 1}</span>
                  {c.voicingId && <span className="pin" title="Voicing pinned">📌</span>}
                  <span className="sym">{chordSymbol(c.ref)}</span>
                  <span className="roman" title={a.source}>{displayRoman(a.roman)}</span>
                  {v ? (
                    <ChordDiagram voicing={v} root={c.ref.root} bass={c.ref.bass} labels={state.settings.labels} width={112} leftHanded={state.settings.leftHanded} capo={capo} />
                  ) : <span className="small muted">no voicing</span>}
                  <div className="beats" onClick={(e) => e.stopPropagation()}>
                    <button aria-label="Fewer beats" onClick={() => setChords((cs) => cs.map((x) => (x.id === c.id ? { ...x, beats: Math.max(1, x.beats - 1) } : x)))}>−</button>
                    {c.beats} beat{c.beats > 1 ? "s" : ""}
                    <button aria-label="More beats" onClick={() => setChords((cs) => cs.map((x) => (x.id === c.id ? { ...x, beats: Math.min(16, x.beats + 1) } : x)))}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {selected && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="slot-actions">
              <b style={{ alignSelf: "center", marginRight: 6 }}>{chordSymbol(selected.ref)}</b>
              <button className="btn sm" onClick={() => audition(selected.ref)}>▶</button>
              <button className="btn sm" onClick={() => openSheet({ ref: selected.ref, slotId: selected.id })}>🎸 Choose voicing</button>
              <button className={`btn sm${showSubs ? " primary" : ""}`} onClick={() => setShowSubs((x) => !x)}>⇄ Substitute</button>
              <button className="btn sm" onClick={() => setChords((cs) => cs.map((x) => (x.id === selected.id ? { ...x, ref: colorize(x.ref, key), voicingId: undefined } : x)))}>✨ Add colour</button>
              {selected.voicingId && <button className="btn sm" onClick={() => setChords((cs) => cs.map((x) => (x.id === selected.id ? { ...x, voicingId: undefined } : x)))}>Auto voicing</button>}
              <button className="btn sm" onClick={() => move(-1)} disabled={selIdx === 0}>◀</button>
              <button className="btn sm" onClick={() => move(1)} disabled={selIdx === prog.chords.length - 1}>▶︎</button>
              <button className="btn sm" onClick={() => setChords((cs) => { const i = cs.findIndex((x) => x.id === selected.id); const next = [...cs]; next.splice(i + 1, 0, { ...selected, id: newId() }); return next; })}>Duplicate</button>
              <button className="btn sm danger" onClick={() => { setChords((cs) => cs.filter((x) => x.id !== selected.id)); setSel(null); }}>Delete</button>
            </div>
            {showSubs && (
              <div className="suggest-items">
                {substitutesFor(selected.ref, key).map((s, i) => (
                  <button key={i} className="suggest-item" onClick={() => setChords((cs) => cs.map((x) => (x.id === selected.id ? { ...x, ref: s.chord.ref, voicingId: undefined } : x)))}>
                    <span className="top"><b>{chordSymbol(s.chord.ref)}</b><span className="rn">{displayRoman(s.chord.roman)}</span>
                      <span className="aud"><span className="mini-play" role="button" aria-label="Preview" onClick={(e) => { e.stopPropagation(); audition(s.chord.ref); }}>▶</span></span></span>
                    <span className="why">{s.why}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <details>
          <summary>Voicing options {prog.avoidBarre ? "· avoiding barre chords" : ""}</summary>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="toggle"><input type="checkbox" checked={prog.avoidBarre} onChange={(e) => setProg((p) => ({ ...p, avoidBarre: e.target.checked }))} /> Avoid barre chords</label>
            <label className="toggle"><input type="checkbox" checked={prog.preferOpen} onChange={(e) => setProg((p) => ({ ...p, preferOpen: e.target.checked }))} /> Prefer ringing open strings</label>
            <label className="toggle"><input type="checkbox" checked={prog.allowInversions} onChange={(e) => setProg((p) => ({ ...p, allowInversions: e.target.checked }))} /> Allow inversions (smoother bass)</label>
            <span className="filter-label">Neck</span>
            <Seg value={prog.zone} options={[{ value: "any", label: "Anywhere" }, { value: "low", label: "Low" }, { value: "mid", label: "Middle" }, { value: "high", label: "High" }]} onChange={(z) => setProg((p) => ({ ...p, zone: z }))} />
          </div>
          <p className="small muted" style={{ marginTop: 6 }}>M-Theory picks voicings that keep your hand in one area and move the top note smoothly. Pin your own with “Choose voicing”.</p>
        </details>
      </section>

      <div className="two-col">
        <section className="card">
          <div className="section-title">
            <h2>{anchor ? <>What could follow {chordSymbol(anchor.ref)}?</> : "How to start"}</h2>
            {selected && <span className="small muted">inserts after slot {selIdx + 1}</span>}
          </div>
          {groups.map((g) => (
            <div key={g.id} className="suggest-group">
              <div><h3>{g.title}</h3><p className="small muted">{g.blurb}</p></div>
              <div className="suggest-items">
                {g.items.map((s, i) => (
                  <button key={i} className="suggest-item" onClick={() => insert(s.chord.ref)}>
                    <span className="top">
                      <b>{chordSymbol(s.chord.ref)}</b>
                      <span className="rn">{displayRoman(s.chord.roman)}</span>
                      <RolePill role={s.chord.pool === "diatonic" ? s.chord.role : undefined} />
                      <span className="aud"><span className="mini-play" role="button" aria-label="Preview" onClick={(e) => { e.stopPropagation(); audition(s.chord.ref); }}>▶</span></span>
                    </span>
                    <span className="why">{s.why}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        <div className="stack">
          <Spark onGenerate={(chords, append) => {
            const items = chords.map((ref) => ({ id: newId(), ref, beats: 4 }));
            setChords((cs) => (append ? [...cs, ...items] : items));
            setSel(null);
          }} onColorAll={() => setChords((cs) => cs.map((c) => ({ ...c, ref: colorize(c.ref, key), voicingId: undefined })))} hasChords={prog.chords.length > 0} />
          <Library voicings={voicings} items={items} onClear={() => { setChords(() => []); setSel(null); }} toast={toast} />
        </div>
      </div>
    </div>
  );
}

function Spark({ onGenerate, onColorAll, hasChords }: { onGenerate: (c: ChordRef[], append: boolean) => void; onColorAll: () => void; hasChords: boolean }) {
  const { state } = useApp();
  const [length, setLength] = useState(4);
  const [mood, setMood] = useState<Mood>("any");
  const [adventure, setAdventure] = useState(0.35);
  const [startHome, setStartHome] = useState(true);
  const gen = (append: boolean) => onGenerate(sparkProgression(state.key, { length, mood, adventure, startHome }), append);
  const advLabel = adventure < 0.2 ? "Safe" : adventure < 0.45 ? "Colourful" : adventure < 0.75 ? "Adventurous" : "Wild";
  return (
    <section className="card stack" style={{ gap: 10 }}>
      <div className="section-title"><h2>✨ Spark an idea</h2></div>
      <p className="small muted">Generates a fresh progression from <i>every</i> chord your key can offer, not a list of clichés. Hit it again and again until something grabs you.</p>
      <div className="row"><span className="filter-label">Length</span><Seg value={length} options={[3, 4, 5, 6, 8].map((n) => ({ value: n, label: String(n) }))} onChange={setLength} /></div>
      <div className="row"><span className="filter-label">Mood</span>
        <select value={mood} onChange={(e) => setMood(e.target.value as Mood)}>
          {MOODS.map((m) => <option key={m.id} value={m.id}>{m.label}: {m.hint}</option>)}
        </select>
      </div>
      <div className="row"><span className="filter-label">Adventure</span>
        <input type="range" min={0} max={1} step={0.05} value={adventure} onChange={(e) => setAdventure(Number(e.target.value))} style={{ flex: 1 }} />
        <b style={{ minWidth: 92 }}>{advLabel}</b>
      </div>
      <label className="toggle"><input type="checkbox" checked={startHome} onChange={(e) => setStartHome(e.target.checked)} /> Start on the home chord</label>
      <div className="row">
        <button className="btn primary" onClick={() => gen(false)}>✨ Generate</button>
        <button className="btn" onClick={() => gen(true)}>+ Append</button>
        <button className="btn" onClick={onColorAll} disabled={!hasChords}>🎨 Colour all chords</button>
      </div>
    </section>
  );
}

function tabText(vs: (Voicing | undefined)[], names: string[], stringNames: string[]): string {
  const width = 8;
  const lines = stringNames.map((n) => `${n.padEnd(2)}|`).reverse();
  const header = "   " + names.map((n) => n.padEnd(width)).join("");
  vs.forEach((v) => {
    for (let s = 0; s < stringNames.length; s++) {
      const f = v?.frets[s];
      const cell = f === null || f === undefined ? "x" : String(f);
      lines[stringNames.length - 1 - s] += ("-" + cell).padEnd(width - 1, "-") + "|";
    }
  });
  return [header, ...lines].join("\n");
}

function Library({ voicings, items, onClear, toast }: { voicings: (Voicing | undefined)[]; items: { midi: (number | null)[]; beats: number }[]; onClear: () => void; toast: (m: string) => void }) {
  const { state, set, tuning } = useApp();
  const prog = state.progression;
  const [name, setName] = useState("");
  const names = prog.chords.map((c) => chordSymbolAscii(c.ref));
  const scale = getScale(state.key.scaleId);
  const stringNames = tuning.notes.map((m) => ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][(m + state.settings.capo) % 12]);

  const chart = () => {
    const romans = prog.chords.map((c) => analyzeChord(c.ref, state.key).roman);
    return [
      `${name || "Untitled"} | Key: ${state.key.tonic} ${scale.name} | ${prog.bpm} bpm${state.settings.capo ? ` | Capo ${state.settings.capo}` : ""}`,
      "",
      "| " + names.map((n, i) => `${n} (${prog.chords[i].beats})`).join(" | ") + " |",
      "  " + romans.join("  "),
      "",
      tabText(voicings, names, stringNames),
      "",
      "Made with M-Theory",
    ].join("\n");
  };

  const copy = async () => {
    const text = chart();
    try {
      await navigator.clipboard.writeText(text);
      toast("Chord chart copied");
    } catch {
      downloadBytes(new TextEncoder().encode(text), "progression.txt", "text/plain");
    }
  };

  const save = () => {
    const nm = name.trim() || `Idea ${state.saved.length + 1}`;
    set((s) => ({ ...s, saved: [{ id: newId(), name: nm, key: s.key, progression: s.progression, savedAt: Date.now() }, ...s.saved] }));
    toast(`Saved “${nm}”`);
    setName("");
  };

  const transpose = (n: number) =>
    set((s) => {
      const tonic = bestTonicSpelling(pc(s.key.tonic) + n, getScale(s.key.scaleId));
      const newKey = { ...s.key, tonic };
      return { ...s, key: newKey, progression: { ...s.progression, chords: s.progression.chords.map((c) => ({ ...c, ref: transposeRef(c.ref, n, newKey), voicingId: undefined })) } };
    });

  return (
    <section className="card stack" style={{ gap: 10 }}>
      <div className="section-title"><h2>💾 Save & export</h2></div>
      <div className="row">
        <input type="text" placeholder="Name this idea…" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
        <button className="btn primary" onClick={save} disabled={!prog.chords.length}>Save</button>
      </div>
      <div className="row">
        <button className="btn" disabled={!items.length} onClick={() => downloadBytes(progressionToMidi(items, prog.bpm, prog.pattern, name || "M-Theory idea"), `${(name || "m-theory-idea").replace(/[^\w-]+/g, "-")}.mid`)}>⬇ MIDI for your DAW</button>
        <button className="btn" disabled={!items.length} onClick={copy}>📋 Copy chart + tab</button>
      </div>
      <div className="row">
        <span className="filter-label">Transpose</span>
        <button className="btn sm" onClick={() => transpose(-1)}>−1</button>
        <button className="btn sm" onClick={() => transpose(1)}>+1</button>
        <span className="spacer" />
        <button className="btn sm danger" onClick={onClear} disabled={!prog.chords.length}>Clear</button>
      </div>
      {prog.chords.length > 0 && (
        <details>
          <summary>Preview chart</summary>
          <pre className="mono small" style={{ overflowX: "auto", background: "var(--bg-2)", padding: 10, borderRadius: 10 }}>{chart()}</pre>
        </details>
      )}
      {state.saved.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h3>Your ideas</h3>
          {state.saved.map((sv) => (
            <div key={sv.id} className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: 6 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <b>{sv.name}</b>
                <div className="tiny muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {displayNote(sv.key.tonic)} {getScale(sv.key.scaleId).short} · {sv.progression.chords.map((c) => chordSymbol(c.ref)).join(" → ")}
                </div>
              </div>
              <button className="btn sm" onClick={() => { set((s) => ({ ...s, key: sv.key, progression: sv.progression })); toast(`Loaded “${sv.name}”`); }}>Load</button>
              <button className="btn sm danger" aria-label={`Delete ${sv.name}`} onClick={() => set((s) => ({ ...s, saved: s.saved.filter((x) => x.id !== sv.id) }))}>✕</button>
            </div>
          ))}
        </div>
      )}
      <p className="tiny faint">Voicings shown: {voicings.map((v) => (v ? voicingText(v) : "-")).join("  ")}</p>
    </section>
  );
}
