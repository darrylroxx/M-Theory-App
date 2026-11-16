import { useEffect, useMemo, useRef, useState } from "react";
import { progressionToMidi, saveFile } from "../../audio/midi";
import { PATTERNS, type PatternId } from "../../audio/patterns";
import { ProgressionPlayer, getAudio, playSequence } from "../../audio/synth";
import { arrangeProgression, capoSuggestions, voicingsFor } from "../../guitar/arrange";
import { fretsFromId, voicingFromFrets, type Voicing } from "../../guitar/voicings";
import { CHORD_CATEGORIES, chordSymbol, chordSymbolAscii, displaySuffix, getChordType, type ChordRef } from "../../theory/chords";
import { intervalName, semitonesOf } from "../../theory/intervals";
import { ROLE_INFO, analyzeChord, borrowedChords, chordsInScale, diatonicChords, spiceChords, transposeRef, type KeyChord } from "../../theory/keys";
import { displayNote, mod12, pc } from "../../theory/notes";
import { MOODS, colorize, sparkProgression, substitutesFor, suggestNext, type Mood, type Suggestion, type SuggestionGroup } from "../../theory/progression";
import { bestTonicSpelling, getScale, isHeptatonic, scaleNotes } from "../../theory/scales";
import { ChordDiagram } from "../components/ChordDiagram";
import { moodOf } from "../components/KeyPicker";
import { Disclosure, RoleLegend, Seg, displayRoman, toneClass } from "../components/common";
import { easyVoicing, newId, useApp, type ProgChord, type Progression } from "../state";

const ZONE_TARGET = { any: null, low: 2, mid: 7, high: 11 } as const;

/** The main screen: pick a key, meet its chords, build a song. */
export function WriteView() {
  const { state, set, tuning } = useApp();
  const prog = state.progression;
  const capo = state.settings.capo;
  const [sel, setSel] = useState<string | null>(null);
  const [nowIdx, setNowIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const player = useRef<ProgressionPlayer | null>(null);

  const refs = prog.chords.map((c) => c.ref);
  const refsKey = JSON.stringify(refs);
  const arranged = useMemo(
    () => arrangeProgression(refs, {
      tuning, capo, avoidBarre: state.settings.avoidBarre, preferOpen: prog.preferOpen, targetFret: ZONE_TARGET[prog.zone], allowInversions: prog.allowInversions,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refsKey, tuning, capo, state.settings.avoidBarre, prog.preferOpen, prog.zone, prog.allowInversions],
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

  const togglePlay = () => {
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

  const selected = prog.chords.find((c) => c.id === sel);
  const anchor = selected ?? prog.chords[prog.chords.length - 1];

  const setChords = (fn: (c: ProgChord[]) => ProgChord[]) => set((s) => ({ ...s, progression: { ...s.progression, chords: fn(s.progression.chords) } }));
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

  return (
    <div className="stack write">
      {!state.settings.guideDismissed && <Guide />}
      <KeyCard />
      <ChordsCard />
      <SongCard voicings={voicings} sel={sel} setSel={setSel} nowIdx={nowIdx} playing={playing} onPlay={togglePlay} setChords={setChords} />
      <div className="two-col">
        <NextCard anchor={anchor?.ref ?? null} refs={refs} onInsert={insert} />
        <SaveCard voicings={voicings} items={items} onClear={() => { setChords(() => []); setSel(null); }} />
      </div>
    </div>
  );
}

// ── 1. Guide ───────────────────────────────────────────────

function Guide() {
  const { set } = useApp();
  return (
    <div className="guide">
      <div className="guide-steps">
        <div><b>1</b><span>Pick a <strong>key and mood</strong></span></div>
        <div><b>2</b><span>Tap <strong>▶</strong> to hear a chord, <strong>+</strong> to add it to your song</span></div>
        <div><b>3</b><span>Press <strong>play</strong>, then pick from <strong>What sounds good next?</strong></span></div>
      </div>
      <button className="icon-btn" aria-label="Hide tips" title="Hide tips" onClick={() => set((s) => ({ ...s, settings: { ...s.settings, guideDismissed: true } }))}>✕</button>
    </div>
  );
}

// ── 2. Key ─────────────────────────────────────────────────

function KeyCard() {
  const { state, openKeyPicker } = useApp();
  const key = state.key;
  const scale = getScale(key.scaleId);
  const notes = scaleNotes(key.tonic, scale);
  const sig = scale.signature ?? [];
  const tonicMidi = 52 + mod12(pc(key.tonic) - 4);
  return (
    <section className="card key-card">
      <div className="key-card-top">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">Writing in</div>
          <h1>{displayNote(key.tonic)} {scale.short}</h1>
          <p className="mood">{moodOf(scale.id)}</p>
        </div>
        <button className="btn primary" onClick={() => openKeyPicker(true)}>Change key or mood</button>
      </div>
      <div className="row tight">
        {notes.map((n, i) => {
          const iv = scale.intervals[i];
          return (
            <div key={i} className={`note-chip ${toneClass(iv)}${sig.includes(iv) ? " sig" : ""}`} title={intervalName(iv)}>
              <b>{displayNote(n)}</b>
              <span>{iv === "1" ? "Home" : displaySuffix(iv)}</span>
            </div>
          );
        })}
        <button className="btn sm ghost" onClick={() => playSequence([...scale.intervals.map((iv) => tonicMidi + semitonesOf(iv)), tonicMidi + 12])}>▶ Hear the scale</button>
      </div>
      {sig.length > 0 && (
        <p className="small muted">
          <b style={{ color: "var(--ext)" }}>★ Signature note:</b> {sig.map((iv) => displayNote(notes[scale.intervals.indexOf(iv)] ?? "")).join(" & ")}. It's what makes {scale.short} sound like {scale.short}; lean on it in melodies and chords.
        </p>
      )}
      <CapoTip />
    </section>
  );
}

function CapoTip() {
  const { state, set, tuning, toast } = useApp();
  const key = state.key;
  const scale = getScale(key.scaleId);
  const capo = state.settings.capo;
  const chords = useMemo(() => (isHeptatonic(scale) ? diatonicChords(key, 3) : []), [key, scale]);
  const sugg = useMemo(
    () => (chords.length && capo === 0 ? capoSuggestions(chords.map((c) => ({ rootPc: pc(c.ref.root), type: c.type })), tuning) : []),
    [chords, tuning, capo],
  );
  const setCapo = (n: number) => { set((s) => ({ ...s, settings: { ...s.settings, capo: n } })); toast(n ? `Capo on fret ${n}` : "Capo removed"); };
  if (capo > 0)
    return (
      <div className="tip">
        <span>🎯 <b>Capo on fret {capo}.</b> Diagrams count frets from the capo.</span>
        <button className="btn sm ghost" onClick={() => setCapo(0)}>Remove capo</button>
      </div>
    );
  const none = sugg.find((s) => s.capo === 0);
  const best = sugg.find((s) => s.capo !== 0);
  if (!none || !best || best.easy - none.easy < 2) return null;
  const shapeKey = bestTonicSpelling(mod12(pc(key.tonic) - best.capo), scale);
  return (
    <div className="tip">
      <span>💡 <b>Fewer barre chords:</b> with a capo on fret {best.capo}, {best.easy} of {best.total} chords become easy open shapes (play them like {displayNote(shapeKey)} {scale.short}). Without it, only {none.easy}.</span>
      <button className="btn sm" onClick={() => setCapo(best.capo)}>Use capo {best.capo}</button>
    </div>
  );
}

// ── 3. Chords ──────────────────────────────────────────────

function ChordsCard() {
  const { state } = useApp();
  const key = state.key;
  const scale = getScale(key.scaleId);
  const hepta = isHeptatonic(scale);
  const [size, setSize] = useState<3 | 4>(3);
  const chords = useMemo(() => (hepta ? diatonicChords(key, size) : []), [key, size, hepta]);
  const all = useMemo(() => chordsInScale(key), [key]);
  const total = all.reduce((n, d) => n + d.chords.length, 0);

  return (
    <section className="card">
      <div className="section-title">
        <h2>Your chords</h2>
        {hepta && <Seg value={size} options={[{ value: 3, label: "Simple" }, { value: 4, label: "Richer (7ths)" }]} onChange={setSize} label="Chord size" />}
      </div>
      <p className="small muted" style={{ marginBottom: 12 }}>
        {hepta
          ? <>The 7 chords that belong to {displayNote(key.tonic)} {scale.short}, each with an easy shape. <b>▶</b> hear it · <b>+</b> add it to your song · tap the chord for other shapes.</>
          : <>This scale has fewer than 7 notes, so instead of a fixed set of chords, here's every chord that fits it.</>}
      </p>
      {hepta && (
        <>
          <div className="key-chords">{chords.map((c) => <KeyChordCard key={`${c.degree}-${size}`} c={c} />)}</div>
          <RoleLegend />
        </>
      )}
      <div className="stack" style={{ gap: 8, marginTop: 14 }}>
        <Disclosure title="More chords that fit this key" badge={total} hint="sus, add9, 6, 9, 11 and 13 versions of each chord" defaultOpen={!hepta}>
          <FitChords />
        </Disclosure>
        {hepta && (
          <Disclosure title="Twist chords from outside the key" hint="Borrowed and surprise chords for emotional moments">
            <TwistChords />
          </Disclosure>
        )}
      </div>
    </section>
  );
}

function KeyChordCard({ c }: { c: KeyChord }) {
  const { state, tuning, openSheet, audition, addChord } = useApp();
  const { capo, avoidBarre, labels, leftHanded } = state.settings;
  const v = useMemo(() => easyVoicing(c.ref, tuning, capo, avoidBarre), [c.ref, tuning, capo, avoidBarre]);
  return (
    <div className={`kc role-${c.role}`}>
      <button className="kc-main" onClick={() => openSheet({ ref: c.ref })} title="Tap for other ways to play it">
        <span className="kc-head">
          <span className="kc-roman">{displayRoman(c.roman)}</span>
          {c.signature && <span className="kc-star" title="Contains the signature note">★</span>}
        </span>
        <span className="kc-name">{chordSymbol(c.ref)}</span>
        <span className="kc-role">{c.role ? ROLE_INFO[c.role].label : ""}</span>
        {v && <ChordDiagram voicing={v} root={c.ref.root} labels={labels} width={92} leftHanded={leftHanded} capo={capo} />}
      </button>
      <div className="kc-actions">
        <button className="mini-play" aria-label={`Hear ${chordSymbol(c.ref)}`} onClick={() => audition(c.ref)}>▶</button>
        <button className="kc-add" aria-label={`Add ${chordSymbol(c.ref)} to your song`} onClick={() => addChord(c.ref)}>+</button>
      </div>
    </div>
  );
}

function FitChords() {
  const { state, openSheet } = useApp();
  const all = useMemo(() => chordsInScale(state.key), [state.key]);
  return (
    <div>
      <p className="small muted" style={{ marginBottom: 6 }}>Swap any plain chord for one of these to change its colour without leaving the key.</p>
      {all.map((d) => (
        <div key={d.degree} className="degree-row">
          <div className="degree-label">{displayNote(d.root)}<small>step {d.degree}</small></div>
          <div className="row tight">
            {[...d.chords]
              .sort((a, b) => CHORD_CATEGORIES.indexOf(a.type.category) - CHORD_CATEGORIES.indexOf(b.type.category))
              .map((c) => (
                <button key={c.type.id} className="chip" title={c.type.feel} onClick={() => openSheet({ ref: c.ref })}>{chordSymbol(c.ref)}</button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TwistChords() {
  const { state, openSheet } = useApp();
  const key = state.key;
  const borrowed = useMemo(() => borrowedChords(key), [key]);
  const spice = useMemo(() => spiceChords(key).flatMap((g) => g.chords), [key]);
  const sources = [...new Set(borrowed.map((c) => c.fromIds[0]))];
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <h3>Borrowed chords</h3>
        <p className="small muted" style={{ margin: "2px 0 8px" }}>Chords from another mood with the same home note. They bring in one “wrong” note that sounds right.</p>
        <div className="stack" style={{ gap: 10 }}>
          {sources.map((sid) => {
            const src = getScale(sid);
            return (
              <div key={sid}>
                <div className="small" style={{ marginBottom: 4 }}><b>From {displayNote(bestTonicSpelling(pc(key.tonic), src))} {src.short}</b> <span className="muted">({moodOf(sid).toLowerCase()})</span></div>
                <div className="row tight">
                  {borrowed.filter((c) => c.fromIds[0] === sid).map((c) => (
                    <button key={c.ref.root + c.type.id} className="chip" title={c.explain} onClick={() => openSheet({ ref: c.ref })}>{chordSymbol(c.ref)}</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {spice.length > 0 && (
        <div>
          <h3>Surprise chords</h3>
          <p className="small muted" style={{ margin: "2px 0 8px" }}>Each one leads somewhere. Play it just before the chord it points to.</p>
          <div className="row tight">
            {spice.map((c) => (
              <button key={c.roman + c.ref.root} className="chip" title={c.explain} onClick={() => openSheet({ ref: c.ref })}>
                {chordSymbol(c.ref)} <span className="rn">{c.short}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 4. Song ────────────────────────────────────────────────

function SongCard({ voicings, sel, setSel, nowIdx, playing, onPlay, setChords }: {
  voicings: (Voicing | undefined)[];
  sel: string | null;
  setSel: (id: string | null) => void;
  nowIdx: number;
  playing: boolean;
  onPlay: () => void;
  setChords: (fn: (c: ProgChord[]) => ProgChord[]) => void;
}) {
  const { state, set, openSheet, audition } = useApp();
  const prog = state.progression;
  const key = state.key;
  const setProg = (fn: (p: Progression) => Progression) => set((s) => ({ ...s, progression: fn(s.progression) }));
  const [swap, setSwap] = useState(false);
  const selIdx = prog.chords.findIndex((c) => c.id === sel);
  const selected = selIdx >= 0 ? prog.chords[selIdx] : undefined;
  const update = (id: string, patch: Partial<ProgChord>) => setChords((cs) => cs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const move = (dir: -1 | 1) => setChords((cs) => {
    const i = cs.findIndex((c) => c.id === sel);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cs.length) return cs;
    const next = [...cs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  return (
    <section className="card stack">
      <div className="section-title">
        <h2>Your song</h2>
        {prog.chords.length > 0 && <span className="small muted">{prog.chords.length} chord{prog.chords.length > 1 ? "s" : ""} · tap one to change it</span>}
      </div>

      {prog.chords.length === 0 ? (
        <div className="empty-song">
          <p><b>No chords yet.</b> Tap <b>+</b> on a chord above, pick a starting chord from <i>What sounds good next?</i>, or let M-Theory write you a starting idea:</p>
        </div>
      ) : (
        <>
          <div className="transport">
            <button className={`play-btn${playing ? " stop" : ""}`} onClick={onPlay} aria-label={playing ? "Stop" : "Play"}>{playing ? "■" : "▶"}</button>
            <label className="field">Speed
              <span className="row tight"><input type="range" min={40} max={180} value={prog.bpm} onChange={(e) => setProg((p) => ({ ...p, bpm: Number(e.target.value) }))} aria-label="Tempo" /><b className="mono">{prog.bpm}</b></span>
            </label>
            <label className="field">Rhythm
              <select value={prog.pattern} onChange={(e) => setProg((p) => ({ ...p, pattern: e.target.value as PatternId }))}>
                {PATTERNS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="toggle"><input type="checkbox" checked={prog.loop} onChange={(e) => setProg((p) => ({ ...p, loop: e.target.checked }))} /> Loop</label>
          </div>
          <div className="timeline">
            {prog.chords.map((c, i) => {
              const v = voicings[i];
              const a = analyzeChord(c.ref, key);
              return (
                <div key={c.id} className={`slot st-${a.status}${sel === c.id ? " sel" : ""}${nowIdx === i ? " now" : ""}`}
                  role="button" tabIndex={0} aria-pressed={sel === c.id}
                  onClick={() => { setSel(sel === c.id ? null : c.id); setSwap(false); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(sel === c.id ? null : c.id); } }}>
                  <span className="idx">{i + 1}</span>
                  <span className="sym">{chordSymbol(c.ref)}</span>
                  <span className="roman" title={a.source}>{displayRoman(a.roman)}</span>
                  {v ? <ChordDiagram voicing={v} root={c.ref.root} bass={c.ref.bass} labels={state.settings.labels} width={104} leftHanded={state.settings.leftHanded} capo={state.settings.capo} /> : <span className="small muted">no shape</span>}
                  <div className="beats" onClick={(e) => e.stopPropagation()}>
                    <button aria-label="Shorter" onClick={() => update(c.id, { beats: Math.max(1, c.beats - 1) })}>−</button>
                    {c.beats} beat{c.beats > 1 ? "s" : ""}
                    <button aria-label="Longer" onClick={() => update(c.id, { beats: Math.min(16, c.beats + 1) })}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {selected && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="edit-bar">
            <b>{chordSymbol(selected.ref)}</b>
            <button className="btn sm" onClick={() => audition(selected.ref)}>▶ Hear</button>
            <button className="btn sm" onClick={() => openSheet({ ref: selected.ref, slotId: selected.id })}>🎸 Change shape</button>
            <button className={`btn sm${swap ? " primary" : ""}`} onClick={() => setSwap((x) => !x)}>⇄ Swap chord</button>
            <button className="btn sm" title="Turn it into a richer version that still fits" onClick={() => update(selected.id, { ref: colorize(selected.ref, key), voicingId: undefined })}>✨ Fancier</button>
            <span className="row tight">
              <button className="btn sm" aria-label="Move left" onClick={() => move(-1)} disabled={selIdx === 0}>◀</button>
              <button className="btn sm" aria-label="Move right" onClick={() => move(1)} disabled={selIdx === prog.chords.length - 1}>▶︎</button>
            </span>
            <button className="btn sm danger" onClick={() => { setChords((cs) => cs.filter((x) => x.id !== selected.id)); setSel(null); }}>Remove</button>
          </div>
          {swap && (
            <>
              <p className="small muted">Chords that could do the same job with a different colour:</p>
              <div className="next-grid">
                {substitutesFor(selected.ref, key, 9).map((s, i) => (
                  <NextItem key={i} s={s} group={s.chord.pool === "diatonic" ? "natural" : s.chord.pool === "borrowed" ? "color" : s.chord.pool === "spice" ? "bold" : "smooth"}
                    onPick={() => { update(selected.id, { ref: s.chord.ref, voicingId: undefined }); setSwap(false); }} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <Surprise onGenerate={(chords) => { setChords(() => chords.map((ref) => ({ id: newId(), ref, beats: 4 }))); setSel(null); }} />

      {prog.chords.length > 0 && (
        <Disclosure title="Shape options" hint={state.settings.avoidBarre ? "Avoiding barre chords" : "Any shapes allowed"}>
          <div className="stack" style={{ gap: 8 }}>
            <label className="toggle"><input type="checkbox" checked={state.settings.avoidBarre} onChange={(e) => set((s) => ({ ...s, settings: { ...s.settings, avoidBarre: e.target.checked } }))} /> Avoid barre chords</label>
            <label className="toggle"><input type="checkbox" checked={prog.preferOpen} onChange={(e) => setProg((p) => ({ ...p, preferOpen: e.target.checked }))} /> Prefer shapes with ringing open strings</label>
            <label className="toggle"><input type="checkbox" checked={prog.allowInversions} onChange={(e) => setProg((p) => ({ ...p, allowInversions: e.target.checked }))} /> Allow a different bass note for smoother changes</label>
            <div className="row tight"><span className="filter-label">Neck area</span>
              <Seg value={prog.zone} options={[{ value: "any", label: "Anywhere" }, { value: "low", label: "Low" }, { value: "mid", label: "Middle" }, { value: "high", label: "High" }]} onChange={(z) => setProg((p) => ({ ...p, zone: z }))} />
            </div>
            <p className="small muted">M-Theory picks shapes that keep your hand in one area. Use “Change shape” on any chord to choose your own.</p>
          </div>
        </Disclosure>
      )}
    </section>
  );
}

function Surprise({ onGenerate }: { onGenerate: (c: ChordRef[]) => void }) {
  const { state, set, toast } = useApp();
  const [length, setLength] = useState(4);
  const [mood, setMood] = useState<Mood>("any");
  const [adventure, setAdventure] = useState(0.3);
  const [undo, setUndo] = useState<ProgChord[] | null>(null);
  const gen = () => {
    if (state.progression.chords.length) setUndo(state.progression.chords);
    onGenerate(sparkProgression(state.key, { length, mood, adventure, startHome: true }));
  };
  return (
    <div className="surprise">
      <button className="btn primary" onClick={gen}>✨ {state.progression.chords.length ? "Try a new idea" : "Write me a starting idea"}</button>
      <select value={length} onChange={(e) => setLength(Number(e.target.value))} aria-label="Number of chords">
        {[3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n} chords</option>)}
      </select>
      <select value={mood} onChange={(e) => setMood(e.target.value as Mood)} aria-label="Mood">
        {MOODS.map((m) => <option key={m.id} value={m.id}>{m.id === "any" ? "Any mood" : m.label}</option>)}
      </select>
      <label className="adventure">
        <span>Safe</span>
        <input type="range" min={0} max={1} step={0.05} value={adventure} onChange={(e) => setAdventure(Number(e.target.value))} aria-label="How adventurous" />
        <span>Wild</span>
      </label>
      {undo && (
        <button className="btn sm ghost" onClick={() => { set((s) => ({ ...s, progression: { ...s.progression, chords: undo } })); setUndo(null); toast("Previous song restored"); }}>↶ Undo</button>
      )}
    </div>
  );
}

// ── 5. What next? ──────────────────────────────────────────

type Filter = "all" | SuggestionGroup["id"];
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "natural", label: "Safe" },
  { value: "smooth", label: "Smooth" },
  { value: "color", label: "Colorful" },
  { value: "bold", label: "Bold" },
];

function NextItem({ s, group, onPick }: { s: Suggestion; group: SuggestionGroup["id"]; onPick: () => void }) {
  const { audition } = useApp();
  return (
    <div className={`next-item g-${group}`}>
      <button className="next-main" onClick={onPick} title={s.why}>
        <span className="next-top"><b>{chordSymbol(s.chord.ref)}</b><span className="rn">{displayRoman(s.chord.roman)}</span></span>
        <span className="next-short">{s.short}</span>
      </button>
      <button className="mini-play" aria-label={`Hear ${chordSymbol(s.chord.ref)}`} onClick={() => audition(s.chord.ref)}>▶</button>
    </div>
  );
}

function NextCard({ anchor, refs, onInsert }: { anchor: ChordRef | null; refs: ChordRef[]; onInsert: (r: ChordRef) => void }) {
  const { state, toast } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const refsKey = JSON.stringify(refs);
  const groups = useMemo(() => suggestNext(anchor, state.key, refs, 9), [anchor, state.key, refsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const list: { s: Suggestion; group: SuggestionGroup["id"] }[] = useMemo(() => {
    if (filter !== "all") return (groups.find((g) => g.id === filter)?.items ?? []).map((s) => ({ s, group: filter }));
    // a few of each flavour, safest first
    const out: { s: Suggestion; group: SuggestionGroup["id"] }[] = [];
    for (let round = 0; round < 3; round++) for (const g of groups) if (g.items[round]) out.push({ s: g.items[round], group: g.id });
    return out.slice(0, 9);
  }, [groups, filter]);
  const blurb = filter === "all" ? "A mix from safe to bold. Hover or long-press for the reason." : groups.find((g) => g.id === filter)?.blurb;

  return (
    <section className="card stack" style={{ gap: 10 }}>
      <h2>{anchor ? <>What sounds good after {chordSymbol(anchor)}?</> : "Where to start?"}</h2>
      <Seg value={filter} options={FILTERS} onChange={setFilter} label="Kind of suggestion" />
      <p className="small muted">{blurb}</p>
      <div className="next-grid">
        {list.map(({ s, group }, i) => (
          <NextItem key={i} s={s} group={group} onPick={() => { onInsert(s.chord.ref); toast(`Added ${chordSymbol(s.chord.ref)} · ${s.short}`); }} />
        ))}
      </div>
    </section>
  );
}

// ── 6. Save & export ───────────────────────────────────────

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

function SaveCard({ voicings, items, onClear }: { voicings: (Voicing | undefined)[]; items: { midi: (number | null)[]; beats: number }[]; onClear: () => void }) {
  const { state, set, tuning, toast } = useApp();
  const prog = state.progression;
  const [name, setName] = useState("");
  const scale = getScale(state.key.scaleId);
  const has = prog.chords.length > 0;
  const names = prog.chords.map((c) => chordSymbolAscii(c.ref));
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
      const r = await saveFile(new TextEncoder().encode(text), "chord-chart.txt", "text/plain");
      if (r === "failed") toast("Couldn't copy here. Use “Preview the chart” and select the text.");
    }
  };
  const exportMidi = async () => {
    const r = await saveFile(progressionToMidi(items, prog.bpm, prog.pattern, name || "M-Theory idea"), `${(name || "m-theory-idea").replace(/[^\w-]+/g, "-")}.mid`, "audio/midi");
    if (r === "saved") toast("MIDI saved");
    else if (r === "failed") toast("Saving files isn't available here");
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
      <h2>Save & export</h2>
      <div className="row">
        <input type="text" id="idea-name" placeholder="Name this idea…" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
        <button className="btn primary" onClick={save} disabled={!has}>Save</button>
      </div>
      <div className="row tight">
        <button className="btn" disabled={!has} onClick={exportMidi} title="Drag it into GarageBand, Logic, Ableton, Reaper…">⬇ MIDI file</button>
        <button className="btn" disabled={!has} onClick={copy}>📋 Copy chords + tab</button>
      </div>
      {has && (
        <div className="row tight">
          <span className="small muted">Move the whole song</span>
          <button className="btn sm" onClick={() => transpose(-1)} aria-label="Down a half step">− ½ step</button>
          <button className="btn sm" onClick={() => transpose(1)} aria-label="Up a half step">+ ½ step</button>
          <span className="spacer" />
          <button className="btn sm danger" onClick={onClear}>Clear song</button>
        </div>
      )}
      {has && (
        <Disclosure title="Preview the chart">
          <pre className="mono small chart-pre">{chart()}</pre>
        </Disclosure>
      )}
      {state.saved.length > 0 ? (
        <Disclosure title="My saved ideas" badge={state.saved.length} defaultOpen={!has}>
          <div className="stack" style={{ gap: 6 }}>
            {state.saved.map((sv) => (
              <div key={sv.id} className="saved-row">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>{sv.name}</b>
                  <div className="tiny muted ellipsis">{displayNote(sv.key.tonic)} {getScale(sv.key.scaleId).short} · {sv.progression.chords.map((c) => chordSymbol(c.ref)).join(" → ")}</div>
                </div>
                <button className="btn sm" onClick={() => { set((s) => ({ ...s, key: sv.key, progression: { ...s.progression, ...sv.progression } })); toast(`Loaded “${sv.name}”`); }}>Open</button>
                <button className="btn sm danger" aria-label={`Delete ${sv.name}`} onClick={() => set((s) => ({ ...s, saved: s.saved.filter((x) => x.id !== sv.id) }))}>✕</button>
              </div>
            ))}
          </div>
        </Disclosure>
      ) : (
        <p className="tiny faint">Saved ideas stay in this browser.</p>
      )}
    </section>
  );
}
