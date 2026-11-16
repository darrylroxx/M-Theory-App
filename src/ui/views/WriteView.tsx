import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { progressionToMidi, saveFile } from "../../audio/midi";
import { PATTERNS, type PatternId } from "../../audio/patterns";
import { ProgressionPlayer, getAudio, playSequence } from "../../audio/synth";
import { arrangeProgression, capoSuggestions } from "../../guitar/arrange";
import type { Voicing } from "../../guitar/voicings";
import { CHORD_CATEGORIES, chordSymbol, chordSymbolAscii, displaySuffix, type ChordRef } from "../../theory/chords";
import { intervalName, semitonesOf } from "../../theory/intervals";
import { ROLE_INFO, analyzeChord, borrowedChords, chordsInScale, diatonicChords, spiceChords, transposeRef, type KeyChord, type Role } from "../../theory/keys";
import { displayNote, mod12, pc } from "../../theory/notes";
import { MOODS, sparkProgression, suggestNext, type Mood, type SuggestionGroup } from "../../theory/progression";
import { SCALES, SCALE_FAMILIES, bestTonicSpelling, getScale, isHeptatonic, scaleNotes } from "../../theory/scales";
import { ChordDiagram } from "../components/ChordDiagram";
import { ROLE_CLASS, Seg, displayRoman, toneClass } from "../components/common";
import { newId, useApp, type ProgChord, type Progression } from "../state";

// ── Drag & drop (mouse: drag; touch: press and hold, then drag) ──────────

interface Payload { ref: ChordRef; slotId?: string }
interface DragApi {
  start: (e: ReactPointerEvent, p: Payload) => void;
  /** true right after a drag, so the click that follows it is ignored */
  justDragged: () => boolean;
}
const DragCtx = createContext<DragApi | null>(null);

function useDraggable(payload: Payload, onTap: () => void) {
  const api = useContext(DragCtx)!;
  return {
    onPointerDown: (e: ReactPointerEvent) => api.start(e, payload),
    onClick: () => { if (!api.justDragged()) onTap(); },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}

/** The whole app in one screen: key → mode → chords → your progression. */
export function WriteView() {
  const { state, set, shapeOf } = useApp();
  const prog = state.progression;
  const [nowIdx, setNowIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState<(Payload & { index: number | null }) | null>(null);
  const player = useRef<ProgressionPlayer | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const lastDrag = useRef(0);

  const voicings: (Voicing | undefined)[] = prog.chords.map((c) => shapeOf(c.ref, c.voicingId));
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
    p.start(items, prog.bpm, prog.pattern, prog.loop);
    setPlaying(true);
  };

  const drop = useCallback((p: Payload, index: number | null) => {
    if (index === null) return;
    set((s) => {
      const cs = [...s.progression.chords];
      let item: ProgChord;
      if (p.slotId) {
        const from = cs.findIndex((c) => c.id === p.slotId);
        if (from < 0) return s;
        [item] = cs.splice(from, 1);
      } else item = { id: newId(), ref: p.ref, beats: 4 };
      cs.splice(Math.min(index, cs.length), 0, item);
      return { ...s, progression: { ...s.progression, chords: cs } };
    });
  }, [set]);

  const api = useMemo<DragApi>(() => {
    const indexAt = (x: number, y: number, exclude?: string): number | null => {
      const dock = dockRef.current;
      if (!dock) return null;
      const r = dock.getBoundingClientRect();
      if (y < r.top - 28 || x < r.left - 28 || x > r.right + 28) return null;
      const scroller = dock.querySelector<HTMLElement>(".dock-slots");
      if (scroller) {
        const sr = scroller.getBoundingClientRect();
        if (x > sr.right - 36) scroller.scrollLeft += 14;
        else if (x < sr.left + 36) scroller.scrollLeft -= 14;
      }
      let i = 0;
      for (const el of dock.querySelectorAll<HTMLElement>("[data-slot]")) {
        if (el.dataset.slot === exclude) continue;
        const b = el.getBoundingClientRect();
        if (x < b.left + b.width / 2) break;
        i++;
      }
      return i;
    };
    return {
      justDragged: () => Date.now() - lastDrag.current < 150,
      start: (e, payload) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
        const touch = e.pointerType !== "mouse";
        const pid = e.pointerId;
        const sx = e.clientX;
        const sy = e.clientY;
        let active = false;
        let index: number | null = null;
        let timer: number | undefined;
        const moveGhost = (x: number, y: number) => {
          if (ghostRef.current) ghostRef.current.style.transform = `translate(${x}px, ${y}px)`;
        };
        const activate = (x: number, y: number) => {
          active = true;
          index = indexAt(x, y, payload.slotId);
          setDrag({ ...payload, index });
          requestAnimationFrame(() => moveGhost(x, y));
          if (touch) navigator.vibrate?.(8);
        };
        const cleanup = () => {
          window.clearTimeout(timer);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onCancel);
          document.removeEventListener("touchmove", onTouchMove);
        };
        const onMove = (ev: PointerEvent) => {
          if (ev.pointerId !== pid) return;
          if (!active) {
            const far = Math.hypot(ev.clientX - sx, ev.clientY - sy);
            if (touch) {
              if (far > 10) cleanup(); // it's a scroll, not a drag
              return;
            }
            if (far < 6) return;
            activate(ev.clientX, ev.clientY);
          }
          moveGhost(ev.clientX, ev.clientY);
          const next = indexAt(ev.clientX, ev.clientY, payload.slotId);
          if (next !== index) {
            index = next;
            setDrag({ ...payload, index });
          }
        };
        const onUp = (ev: PointerEvent) => {
          if (ev.pointerId !== pid) return;
          cleanup();
          if (!active) return;
          lastDrag.current = Date.now();
          setDrag(null);
          drop(payload, index);
        };
        const onCancel = () => {
          cleanup();
          if (active) lastDrag.current = Date.now();
          setDrag(null);
        };
        // once a drag is live, stop the page from scrolling under the finger
        const onTouchMove = (ev: TouchEvent) => {
          if (active && ev.cancelable) ev.preventDefault();
        };
        if (touch) timer = window.setTimeout(() => activate(sx, sy), 230);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
        document.addEventListener("touchmove", onTouchMove, { passive: false });
      },
    };
  }, [drop]);

  return (
    <DragCtx.Provider value={api}>
      <div className={`stack write${drag ? " dragging" : ""}`}>
        <KeyBar />
        <ChordBoard />
      </div>
      <Dock ref={dockRef} voicings={voicings} nowIdx={nowIdx} playing={playing} onPlay={togglePlay} drag={drag} onMenu={() => setMenu(true)} />
      {drag && <div ref={ghostRef} className="drag-ghost">{chordSymbol(drag.ref)}</div>}
      {menu && <SongMenu voicings={voicings} items={items} onClose={() => setMenu(false)} />}
    </DragCtx.Provider>
  );
}

// ── Key & mode ───────────────────────────────────────────────

const MAIN_MODES = ["ionian", "aeolian", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonicMinor", "melodicMinor"];
const PCS = Array.from({ length: 12 }, (_, i) => i);

const KeyBar = memo(function KeyBar() {
  const { state, set, tuning } = useApp();
  const key = state.key;
  const scale = getScale(key.scaleId);
  const tonicPc = pc(key.tonic);
  const notes = scaleNotes(key.tonic, scale);
  const sig = scale.signature ?? [];
  const capo = state.settings.capo;
  const setKey = (tonic: string, scaleId: string) => set((s) => ({ ...s, key: { tonic, scaleId } }));
  const pickScale = (id: string) => setKey(bestTonicSpelling(tonicPc, getScale(id)), id);
  const tonicMidi = 52 + mod12(tonicPc - 4);
  const hepta = isHeptatonic(scale);
  // which capo gives the most open (no-barre) shapes in this key
  const bestCapo = useMemo(() => {
    if (!hepta) return null;
    const chords = diatonicChords(key, 3).map((c) => ({ rootPc: pc(c.ref.root), type: c.type }));
    const s = capoSuggestions(chords, tuning);
    const none = s.find((x) => x.capo === 0);
    return none && s[0].capo !== 0 && s[0].easy - none.easy >= 2 ? s[0].capo : null;
  }, [key, tuning, hepta]);

  return (
    <section className="card keybar">
      <div className="kb-row">
        <span className="kb-label">Key</span>
        <div className="tonics" role="radiogroup" aria-label="Key">
          {PCS.map((p) => {
            const name = bestTonicSpelling(p, scale);
            return <button key={p} role="radio" aria-checked={tonicPc === p} className={tonicPc === p ? "on" : ""} onClick={() => setKey(name, scale.id)}>{displayNote(name)}</button>;
          })}
        </div>
      </div>
      <div className="kb-row">
        <span className="kb-label">Mode</span>
        <div className="modes" role="radiogroup" aria-label="Mode">
          {MAIN_MODES.map((id) => {
            const sc = getScale(id);
            return <button key={id} role="radio" aria-checked={scale.id === id} className={`chip${scale.id === id ? " on" : ""}`} title={sc.mood} onClick={() => pickScale(id)}>{sc.short}</button>;
          })}
          <select className={`chip-select${MAIN_MODES.includes(scale.id) ? "" : " on"}`} aria-label="More scales" value={MAIN_MODES.includes(scale.id) ? "" : scale.id} onChange={(e) => e.target.value && pickScale(e.target.value)}>
            <option value="">More…</option>
            {SCALE_FAMILIES.map((f) => (
              <optgroup key={f} label={f}>
                {SCALES.filter((s) => s.family === f && !MAIN_MODES.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      <div className="kb-row kb-notes">
        <div className="row tight">
          {notes.map((n, i) => {
            const iv = scale.intervals[i];
            return (
              <div key={i} className={`note-chip sm ${toneClass(iv)}${sig.includes(iv) ? " sig" : ""}`} title={intervalName(iv) + (sig.includes(iv) ? " (signature note)" : "")}>
                <b>{displayNote(n)}</b>
                <span>{iv === "1" ? "R" : displaySuffix(iv)}</span>
              </div>
            );
          })}
          <button className="mini-play" aria-label="Play scale" title="Play scale" onClick={() => playSequence([...scale.intervals.map((iv) => tonicMidi + semitonesOf(iv)), tonicMidi + 12])}>▶</button>
        </div>
        <span className="mood-line">{scale.mood}</span>
        <label className="capo">
          Capo
          <select value={capo} onChange={(e) => set((s) => ({ ...s, settings: { ...s.settings, capo: Number(e.target.value) } }))}>
            {Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{i === 0 ? "None" : i}{i === bestCapo ? " ★ no barres" : ""}</option>)}
          </select>
        </label>
      </div>
    </section>
  );
});

// ── Chords ───────────────────────────────────────────────────

type View = "triads" | "sevenths" | "more" | "outside" | "next";
const GROUP_LABEL: Record<SuggestionGroup["id"], string> = { natural: "Safe", smooth: "Smooth", color: "Colorful", bold: "Bold" };

const ChordBoard = memo(function ChordBoard() {
  const { state } = useApp();
  const key = state.key;
  const scale = getScale(key.scaleId);
  const hepta = isHeptatonic(scale);
  const [picked, setView] = useState<View>("triads");
  const view: View = !hepta && picked !== "next" ? "more" : picked;
  const options: { value: View; label: string }[] = hepta
    ? [{ value: "triads", label: "Chords" }, { value: "sevenths", label: "7ths" }, { value: "more", label: "More" }, { value: "outside", label: "Outside" }, { value: "next", label: "Next ✨" }]
    : [{ value: "more", label: "Chords" }, { value: "next", label: "Next ✨" }];

  return (
    <section className="card board">
      <Seg value={view} options={options} onChange={setView} label="Which chords" />
      {(view === "triads" || view === "sevenths") && <KeyChords size={view === "triads" ? 3 : 4} />}
      {view === "more" && <MoreChords />}
      {view === "outside" && <OutsideChords />}
      {view === "next" && <NextChords />}
    </section>
  );
});

function KeyChords({ size }: { size: 3 | 4 }) {
  const { state } = useApp();
  const chords = useMemo(() => diatonicChords(state.key, size), [state.key, size]);
  return (
    <>
      <div className="key-chords">{chords.map((c) => <ChordCard key={`${c.degree}-${size}`} c={c} />)}</div>
      <div className="role-legend">
        {(Object.keys(ROLE_INFO) as Role[]).map((r) => <span key={r} title={ROLE_INFO[r].blurb}><i className={`dot ${ROLE_CLASS[r]}`} />{ROLE_INFO[r].label}</span>)}
        <span title="Contains the mode's signature note"><b style={{ color: "var(--ext)" }}>★</b> Signature</span>
      </div>
    </>
  );
}

function ChordCard({ c }: { c: KeyChord }) {
  const { state, openSheet, audition, addChord, shapeOf } = useApp();
  const { capo, labels, leftHanded } = state.settings;
  const v = shapeOf(c.ref);
  const d = useDraggable({ ref: c.ref }, () => openSheet({ ref: c.ref }));
  const name = chordSymbol(c.ref);
  return (
    <div className={`kc draggable role-${c.role}`} role="button" tabIndex={0} aria-label={`${name}: ways to play`} {...d}
      onKeyDown={(e) => { if (e.key === "Enter") openSheet({ ref: c.ref }); }}>
      <span className="kc-head">
        <span className="kc-roman">{displayRoman(c.roman)}</span>
        {c.signature && <span className="kc-star">★</span>}
      </span>
      <span className="kc-name">{name}</span>
      {v && <ChordDiagram voicing={v} root={c.ref.root} labels={labels} width={120} leftHanded={leftHanded} capo={capo} />}
      <div className="kc-actions" data-nodrag>
        <button className="mini-play" aria-label={`Play ${name}`} onClick={(e) => { e.stopPropagation(); audition(c.ref); }}>▶</button>
        <button className="kc-add" aria-label={`Add ${name}`} onClick={(e) => { e.stopPropagation(); addChord(c.ref); }}>+</button>
      </div>
    </div>
  );
}

/** A chord as a small draggable pill: tap for shapes, drag to add. */
function Pill({ chord, tone, title }: { chord: ChordRef; tone?: string; title?: string }) {
  const { openSheet } = useApp();
  const d = useDraggable({ ref: chord }, () => openSheet({ ref: chord }));
  return <button className={`chip draggable${tone ? ` ${tone}` : ""}`} title={title} {...d}>{chordSymbol(chord)}</button>;
}

function MoreChords() {
  const { state } = useApp();
  const all = useMemo(() => chordsInScale(state.key), [state.key]);
  return (
    <div>
      {all.map((d) => (
        <div key={d.degree} className="degree-row">
          <div className="degree-label">{displayNote(d.root)}</div>
          <div className="row tight">
            {[...d.chords]
              .sort((a, b) => CHORD_CATEGORIES.indexOf(a.type.category) - CHORD_CATEGORIES.indexOf(b.type.category))
              .map((c) => <Pill key={c.type.id} chord={c.ref} title={c.type.name} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function OutsideChords() {
  const { state } = useApp();
  const key = state.key;
  const borrowed = useMemo(() => borrowedChords(key), [key]);
  const spice = useMemo(() => spiceChords(key), [key]);
  const sources = [...new Set(borrowed.map((c) => c.fromIds[0]))];
  return (
    <div>
      {sources.map((sid) => (
        <div key={sid} className="degree-row wide">
          <div className="degree-label">{getScale(sid).short}</div>
          <div className="row tight">
            {borrowed.filter((c) => c.fromIds[0] === sid).map((c) => <Pill key={c.ref.root + c.type.id} chord={c.ref} title={c.explain} />)}
          </div>
        </div>
      ))}
      {spice.map((g) => (
        <div key={g.group} className="degree-row wide">
          <div className="degree-label" title={g.blurb}>{g.group.replace("Secondary dominants", "Lead-ins").replace("Chromatic mediants", "Cinematic").replace("Tritone substitutions", "Jazz swaps").replace("Passing diminished", "Passing")}</div>
          <div className="row tight">
            {g.chords.map((c) => <Pill key={c.roman + c.ref.root} chord={c.ref} title={c.short ?? c.explain} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function NextChords() {
  const { state } = useApp();
  const chords = state.progression.chords;
  const last = chords[chords.length - 1]?.ref ?? null;
  const refsKey = JSON.stringify(chords.map((c) => c.ref));
  const groups = useMemo(() => suggestNext(last, state.key, chords.map((c) => c.ref), 8), [refsKey, state.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <p className="tiny faint next-after">{last ? `After ${chordSymbol(last)}` : "To start"}</p>
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

// ── Progression dock ─────────────────────────────────────────

function Dock({ ref, voicings, nowIdx, playing, onPlay, drag, onMenu }: {
  ref: React.Ref<HTMLDivElement>;
  voicings: (Voicing | undefined)[];
  nowIdx: number;
  playing: boolean;
  onPlay: () => void;
  drag: (Payload & { index: number | null }) | null;
  onMenu: () => void;
}) {
  const { state, set, toast } = useApp();
  const chords = state.progression.chords;
  const [undo, setUndo] = useState<ProgChord[] | null>(null);
  const idea = () => {
    if (chords.length) setUndo(chords);
    const refs = sparkProgression(state.key, { length: 4, mood: "any", adventure: 0.3, startHome: true });
    set((s) => ({ ...s, progression: { ...s.progression, chords: refs.map((r) => ({ id: newId(), ref: r, beats: 4 })) } }));
  };
  const marker = <span key="marker" className="drop-marker" />;
  const els: React.ReactNode[] = [];
  let k = 0;
  chords.forEach((c, i) => {
    const isDragged = drag?.slotId === c.id;
    if (!isDragged) {
      if (drag && drag.index === k) els.push(marker);
      k++;
    }
    els.push(<Slot key={c.id} c={c} i={i} v={voicings[i]} now={nowIdx === i} dragged={isDragged} />);
  });
  if (drag && drag.index !== null && drag.index >= k) els.push(marker);

  return (
    <div className={`dock${chords.length ? "" : " empty"}${drag ? " armed" : ""}${drag?.index != null ? " over" : ""}`} ref={ref}>
      <div className="dock-inner">
        <button className={`play-btn${playing ? " stop" : ""}`} onClick={onPlay} aria-label={playing ? "Stop" : "Play"} disabled={!chords.length}>{playing ? "■" : "▶"}</button>
        <div className="dock-slots">
          {chords.length === 0 && !drag ? <span className="dock-empty">Drag chords here</span> : els}
          {chords.length === 0 && drag && drag.index === null && <span className="dock-empty">Drop here</span>}
        </div>
        <div className="dock-tools">
          <button className="icon-btn" aria-label="Generate an idea" title="Generate an idea" onClick={idea}>✨</button>
          {undo && <button className="icon-btn" aria-label="Undo" title="Undo" onClick={() => { set((s) => ({ ...s, progression: { ...s.progression, chords: undo } })); setUndo(null); toast("Restored"); }}>↶</button>}
          <button className="icon-btn" aria-label="Song options" title="Tempo, save, export" onClick={onMenu}>⋯</button>
        </div>
      </div>
    </div>
  );
}

function Slot({ c, i, v, now, dragged }: { c: ProgChord; i: number; v?: Voicing; now: boolean; dragged: boolean }) {
  const { state, set, openSheet } = useApp();
  const d = useDraggable({ ref: c.ref, slotId: c.id }, () => openSheet({ ref: c.ref, slotId: c.id }));
  const a = analyzeChord(c.ref, state.key);
  const name = chordSymbol(c.ref);
  return (
    <div className={`slot draggable st-${a.status}${now ? " now" : ""}${dragged ? " dragged" : ""}`} data-slot={c.id} role="button" tabIndex={0}
      aria-label={`Chord ${i + 1}: ${name}. Change shape`} {...d} onKeyDown={(e) => { if (e.key === "Enter") openSheet({ ref: c.ref, slotId: c.id }); }}>
      <span className="sym">{name}</span>
      {v && <ChordDiagram voicing={v} root={c.ref.root} bass={c.ref.bass} labels={state.settings.labels} width={116} compact leftHanded={state.settings.leftHanded} capo={state.settings.capo} />}
      <button className="slot-x" data-nodrag aria-label={`Remove ${name}`}
        onClick={(e) => { e.stopPropagation(); set((s) => ({ ...s, progression: { ...s.progression, chords: s.progression.chords.filter((x) => x.id !== c.id) } })); }}>✕</button>
    </div>
  );
}

// ── Song menu ────────────────────────────────────────────────

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

function SongMenu({ voicings, items, onClose }: { voicings: (Voicing | undefined)[]; items: { midi: (number | null)[]; beats: number }[]; onClose: () => void }) {
  const { state, set, tuning, toast } = useApp();
  const prog = state.progression;
  const has = prog.chords.length > 0;
  const [name, setName] = useState("");
  const [length, setLength] = useState(4);
  const [mood, setMood] = useState<Mood>("any");
  const [adventure, setAdventure] = useState(0.3);
  const setProg = (fn: (p: Progression) => Progression) => set((s) => ({ ...s, progression: fn(s.progression) }));
  const scale = getScale(state.key.scaleId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chart = () => {
    const names = prog.chords.map((c) => chordSymbolAscii(c.ref));
    const stringNames = tuning.notes.map((m) => ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][(m + state.settings.capo) % 12]);
    return [
      `${name || "Untitled"} | ${state.key.tonic} ${scale.name} | ${prog.bpm} bpm${state.settings.capo ? ` | Capo ${state.settings.capo}` : ""}`,
      "",
      "| " + names.join(" | ") + " |",
      "  " + prog.chords.map((c) => analyzeChord(c.ref, state.key).roman).join("  "),
      "",
      tabText(voicings, names, stringNames),
    ].join("\n");
  };
  const copy = async () => {
    const text = chart();
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      const r = await saveFile(new TextEncoder().encode(text), "chords.txt", "text/plain");
      if (r === "failed") toast("Couldn't copy here");
    }
  };
  const midi = async () => {
    const r = await saveFile(progressionToMidi(items, prog.bpm, prog.pattern, name || "M-Theory idea"), `${(name || "m-theory-idea").replace(/[^\w-]+/g, "-")}.mid`, "audio/midi");
    toast(r === "saved" ? "MIDI saved" : r === "failed" ? "Can't save files here" : "Cancelled");
  };
  const save = () => {
    const nm = name.trim() || `Idea ${state.saved.length + 1}`;
    set((s) => ({ ...s, saved: [{ id: newId(), name: nm, key: s.key, progression: s.progression, savedAt: Date.now() }, ...s.saved] }));
    toast("Saved");
    setName("");
  };
  const transpose = (n: number) =>
    set((s) => {
      const tonic = bestTonicSpelling(pc(s.key.tonic) + n, getScale(s.key.scaleId));
      const newKey = { ...s.key, tonic };
      return { ...s, key: newKey, progression: { ...s.progression, chords: s.progression.chords.map((c) => ({ ...c, ref: transposeRef(c.ref, n, newKey), voicingId: undefined })) } };
    });
  const smooth = () => {
    const vs = arrangeProgression(prog.chords.map((c) => c.ref), { tuning, capo: state.settings.capo, avoidBarre: state.settings.avoidBarre, preferOpen: false, targetFret: null, allowInversions: false });
    setProg((p) => ({ ...p, chords: p.chords.map((c, i) => ({ ...c, voicingId: vs[i]?.id })) }));
    toast("Shapes arranged");
  };
  const generate = () => {
    const refs = sparkProgression(state.key, { length, mood, adventure, startHome: true });
    setProg((p) => ({ ...p, chords: refs.map((r) => ({ id: newId(), ref: r, beats: 4 })) }));
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" style={{ maxWidth: 520 }} role="dialog" aria-modal="true" aria-label="Song options" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Song</h2>
          <button className="icon-btn sheet-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="menu">
          <div className="menu-row">
            <span className="kb-label">Tempo</span>
            <input type="range" min={40} max={180} value={prog.bpm} aria-label="Tempo" onChange={(e) => setProg((p) => ({ ...p, bpm: Number(e.target.value) }))} />
            <b className="mono">{prog.bpm}</b>
          </div>
          <div className="menu-row">
            <span className="kb-label">Rhythm</span>
            <select value={prog.pattern} aria-label="Rhythm" onChange={(e) => setProg((p) => ({ ...p, pattern: e.target.value as PatternId }))}>
              {PATTERNS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <label className="toggle"><input type="checkbox" checked={prog.loop} onChange={(e) => setProg((p) => ({ ...p, loop: e.target.checked }))} /> Loop</label>
          </div>
          <div className="menu-row">
            <span className="kb-label">Idea</span>
            <select value={length} aria-label="Chords" onChange={(e) => setLength(Number(e.target.value))}>{[3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            <select value={mood} aria-label="Mood" onChange={(e) => setMood(e.target.value as Mood)}>{MOODS.map((m) => <option key={m.id} value={m.id}>{m.id === "any" ? "Any mood" : m.label}</option>)}</select>
            <label className="adventure"><span>Safe</span><input type="range" min={0} max={1} step={0.05} value={adventure} aria-label="Adventure" onChange={(e) => setAdventure(Number(e.target.value))} /><span>Wild</span></label>
            <button className="btn sm primary" onClick={generate}>✨</button>
          </div>
          <div className="menu-row">
            <span className="kb-label">Shapes</span>
            <button className="btn sm" disabled={!has} onClick={smooth} title="Pick shapes that sit close together on the neck">Arrange smoothly</button>
            <button className="btn sm" disabled={!has} onClick={() => setProg((p) => ({ ...p, chords: p.chords.map((c) => ({ ...c, voicingId: undefined })) }))}>Reset</button>
          </div>
          <div className="menu-row">
            <span className="kb-label">Move</span>
            <button className="btn sm" disabled={!has} onClick={() => transpose(-1)}>− ½</button>
            <button className="btn sm" disabled={!has} onClick={() => transpose(1)}>+ ½</button>
            <span className="spacer" />
            <button className="btn sm danger" disabled={!has} onClick={() => setProg((p) => ({ ...p, chords: [] }))}>Clear</button>
          </div>
          <div className="menu-row">
            <span className="kb-label">Export</span>
            <button className="btn sm" disabled={!has} onClick={midi}>MIDI</button>
            <button className="btn sm" disabled={!has} onClick={copy}>Copy tab</button>
          </div>
          <div className="menu-row">
            <span className="kb-label">Save</span>
            <input type="text" id="idea-name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 100 }} />
            <button className="btn sm primary" disabled={!has} onClick={save}>Save</button>
          </div>
          {state.saved.map((sv) => (
            <div key={sv.id} className="saved-row">
              <div style={{ minWidth: 0, flex: 1 }}>
                <b>{sv.name}</b>
                <div className="tiny muted ellipsis">{sv.progression.chords.map((c) => chordSymbol(c.ref)).join(" · ")}</div>
              </div>
              <button className="btn sm" onClick={() => { set((s) => ({ ...s, key: sv.key, progression: { ...s.progression, ...sv.progression } })); onClose(); }}>Open</button>
              <button className="btn sm danger" aria-label={`Delete ${sv.name}`} onClick={() => set((s) => ({ ...s, saved: s.saved.filter((x) => x.id !== sv.id) }))}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
