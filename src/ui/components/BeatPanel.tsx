import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BEAT_GROUPS, BEAT_LIBRARY, STEP_VELOCITY, clearBeat, findPattern, levelAt, setStep, varyBeat, type Beat, type BeatGroupId, type BeatPattern, type StepLevel } from "../../audio/beats";
import { DEFAULT_PARAMS, DRUM_IDS, DRUM_LABEL, KITS, TONE_LABEL, getKit, type DrumId, type DrumParams, type KitId } from "../../audio/drums";
import { playDrum, setDrumFx } from "../../audio/synth";
import { newId, useApp } from "../state";
import { Seg } from "./common";

type GroupId = BeatGroupId | "mine";

/**
 * The drum machine: pick a kit, pick a rhythm from the library, tap squares to change it.
 * Sits on top of the tray (like the shape finder) so the chords stay in view.
 */
export function BeatPanel({ beat, setBeat, onPick, playing, onPlay, onClose, stepSink }: {
  beat: Beat;
  setBeat: (fn: (b: Beat) => Beat) => void;
  onPick: (p: BeatPattern) => void;
  playing: boolean;
  onPlay: () => void;
  onClose: () => void;
  /** The player calls this with the step that is sounding (−1 = stopped) */
  stepSink: { current: ((step: number) => void) | null };
}) {
  const { state, set, toast } = useApp();
  const mine = state.myBeats;
  const current = findPattern(beat.patternId, mine);
  const [group, setGroup] = useState<GroupId>(current?.group ?? "dream");
  const [brush, setBrush] = useState<StepLevel>(2);
  const [sel, setSel] = useState<DrumId | null>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const paint = useRef<{ id: DrumId; level: StepLevel; last: number } | null>(null);
  const kit = getKit(beat.kit);
  const bpm = state.progression.bpm;
  const list = group === "mine" ? mine : BEAT_LIBRARY.filter((p) => p.group === group);

  // moving playhead, without re-rendering the grid on every step
  useEffect(() => {
    stepSink.current = (n) => {
      const el = stepsRef.current;
      if (!el) return;
      el.classList.toggle("playing", n >= 0);
      if (n >= 0) el.style.setProperty("--now", String(n));
    };
    return () => {
      stepSink.current = null;
    };
  }, [stepSink]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hit = (id: DrumId, b: Beat = beat, velocity = 0.8) => {
    setDrumFx(b);
    playDrum(b.kit, id, b.sounds[id], undefined, velocity);
  };
  const put = (id: DrumId, i: number, level: StepLevel) => setBeat((b) => ({ ...setStep(b, id, i, level), on: true }));

  const cellAt = (x: number, y: number) => {
    const c = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-i]");
    return c ? { id: c.dataset.d as DrumId, i: Number(c.dataset.i) } : null;
  };
  const press = (id: DrumId, i: number): StepLevel => {
    const level: StepLevel = levelAt(beat.rows, id, i) === brush ? 0 : brush;
    put(id, i, level);
    if (level && !playing) hit(id, beat, STEP_VELOCITY[level]);
    return level;
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const c = cellAt(e.clientX, e.clientY);
    if (!c) return;
    paint.current = { id: c.id, level: press(c.id, c.i), last: c.i };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  // drag along a row to paint (or erase) several steps
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = paint.current;
    if (!p) return;
    const c = cellAt(e.clientX, e.clientY);
    if (c && c.id === p.id && c.i !== p.last) {
      p.last = c.i;
      put(p.id, c.i, p.level);
    }
  };
  const onUp = () => {
    paint.current = null;
  };

  const setKit = (k: KitId) => {
    setBeat((b) => ({ ...b, kit: k }));
    if (!playing) hit("kick", { ...beat, kit: k });
  };
  const setFx = (patch: Partial<Pick<Beat, "swing" | "level" | "space" | "grit">>) => {
    setDrumFx({ ...beat, ...patch });
    setBeat((b) => ({ ...b, ...patch }));
  };
  const sound = (id: DrumId): DrumParams => ({ ...DEFAULT_PARAMS, ...beat.sounds[id] });
  const setSound = (id: DrumId, patch: Partial<DrumParams>) => {
    const next = { ...beat, sounds: { ...beat.sounds, [id]: { ...beat.sounds[id], ...patch } } };
    setBeat((b) => ({ ...b, sounds: { ...b.sounds, [id]: { ...b.sounds[id], ...patch } } }));
    if (!playing) hit(id, next);
  };
  const toggleMute = (id: DrumId) => setBeat((b) => ({ ...b, mutes: b.mutes?.includes(id) ? b.mutes.filter((x) => x !== id) : [...(b.mutes ?? []), id] }));
  const save = () => {
    const id = `mine-${newId()}`;
    const name = `My beat ${mine.length + 1}`;
    set((s) => ({ ...s, myBeats: [...s.myBeats, { id, name, group: "mine", steps: beat.steps, div: beat.div, bpm, swing: beat.swing, rows: beat.rows }] }));
    setBeat((b) => ({ ...b, patternId: id, name, edited: false }));
    setGroup("mine");
    toast("Saved to Mine");
  };
  const remove = (id: string) => set((s) => ({ ...s, myBeats: s.myBeats.filter((p) => p.id !== id) }));

  const p = sel ? sound(sel) : null;
  const meter = beat.div === 3 ? (beat.steps === 6 ? "6/8" : "12/8") : `${beat.steps / beat.div}/4`;

  return (
    <section className="finder beat-panel" role="dialog" aria-label="Beat">
      <div className="beat-head">
        <button className={`play-btn sm${playing ? " stop" : ""}`} onClick={onPlay} aria-label={playing ? "Stop" : "Play"}>{playing ? "■" : "▶"}</button>
        <h2>Beat</h2>
        <button className={`chip${beat.on ? " on" : ""}`} aria-pressed={beat.on} onClick={() => setBeat((b) => ({ ...b, on: !b.on }))}>{beat.on ? "On" : "Off"}</button>
        <div className="seg beat-kits" role="radiogroup" aria-label="Drum kit">
          {KITS.map((k) => <button key={k.id} role="radio" aria-checked={beat.kit === k.id} className={beat.kit === k.id ? "on" : ""} title={k.hint} onClick={() => setKit(k.id)}>{k.name}</button>)}
        </div>
        <span className="spacer" />
        <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
      </div>

      <div className="beat-line">
        <span className="kb-label">Rhythm</span>
        <div className="beat-scroll" role="radiogroup" aria-label="Rhythm style">
          {BEAT_GROUPS.map((g) => <button key={g.id} role="radio" aria-checked={group === g.id} className={`chip${group === g.id ? " on" : ""}`} onClick={() => setGroup(g.id)}>{g.name}</button>)}
          {mine.length > 0 && <button role="radio" aria-checked={group === "mine"} className={`chip${group === "mine" ? " on" : ""}`} onClick={() => setGroup("mine")}>Mine</button>}
        </div>
      </div>
      <div className="beat-scroll beat-list" role="listbox" aria-label="Rhythms">
        {list.map((x) => {
          const on = beat.patternId === x.id;
          return (
            <span key={x.id} className={`beat-item${on ? " on" : ""}`}>
              <button role="option" aria-selected={on} onClick={() => onPick(x)}>{x.name}{on && beat.edited ? "*" : ""}</button>
              {x.group === "mine" && <button className="beat-del" aria-label={`Delete ${x.name}`} onClick={() => remove(x.id)}>✕</button>}
            </span>
          );
        })}
        {!list.length && <span className="tiny muted">Nothing saved yet</span>}
      </div>

      <div className="beat-grid" style={{ "--steps": beat.steps } as CSSProperties}>
        <div className="bg-labels">
          {DRUM_IDS.map((id) => (
            <button key={id} className={`bg-label d-${id}${sel === id ? " on" : ""}${beat.mutes?.includes(id) ? " muted" : ""}`} aria-pressed={sel === id} title={`${kit.names[id]}: tap to hear and adjust`}
              onClick={() => { hit(id); setSel(sel === id ? null : id); }}>{DRUM_LABEL[id]}</button>
          ))}
        </div>
        <div className="bg-steps" ref={stepsRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="bg-now" />
          {DRUM_IDS.map((id) => (
            <div key={id} className={`bg-row d-${id}${beat.mutes?.includes(id) ? " muted" : ""}`}>
              {Array.from({ length: beat.steps }, (_, i) => {
                const lv = levelAt(beat.rows, id, i);
                return (
                  <button key={i} className={`bg-cell l${lv}${i % beat.div === 0 ? " beat" : ""}`} data-d={id} data-i={i} aria-pressed={lv > 0}
                    aria-label={`${DRUM_LABEL[id]} step ${i + 1}${lv ? [" ", " soft", "", " loud"][lv] : " off"}`}
                    onClick={(e) => { if (e.detail === 0) press(id, i); }} />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="beat-line">
        <Seg value={brush} options={[{ value: 1 as StepLevel, label: "Soft" }, { value: 2 as StepLevel, label: "Normal" }, { value: 3 as StepLevel, label: "Loud" }]} onChange={setBrush} label="How hard new hits are" />
        <span className="tiny muted beat-meter">{meter}</span>
        <span className="spacer" />
        <button className="btn sm" title="Small random variation" onClick={() => setBeat((b) => ({ ...varyBeat(b), on: true }))}>✨ Vary</button>
        <button className="btn sm danger" onClick={() => setBeat(clearBeat)}>Clear</button>
        <button className="btn sm" onClick={save}>Save</button>
      </div>

      {sel && p && (
        <div className={`beat-sound d-${sel}`}>
          <b className="bs-name">{kit.names[sel]}</b>
          <Knob label="Tune" min={-12} max={12} step={1} value={p.tune} onChange={(v) => setSound(sel, { tune: v })} />
          <Knob label="Decay" value={p.decay} onChange={(v) => setSound(sel, { decay: v })} />
          <Knob label={TONE_LABEL[sel]} value={p.tone} onChange={(v) => setSound(sel, { tone: v })} />
          <Knob label="Level" value={p.level} onChange={(v) => setSound(sel, { level: v })} />
          <button className={`chip${beat.mutes?.includes(sel) ? " on" : ""}`} aria-pressed={!!beat.mutes?.includes(sel)} onClick={() => toggleMute(sel)}>Mute</button>
          <button className="btn sm" onClick={() => setSound(sel, DEFAULT_PARAMS)}>Reset</button>
        </div>
      )}

      <div className="beat-fx">
        <label className="knob wide">
          <span>Tempo <b className="mono">{bpm}</b></span>
          <input type="range" min={40} max={200} value={bpm} aria-label="Tempo" onChange={(e) => set((s) => ({ ...s, progression: { ...s.progression, bpm: Number(e.target.value) } }))} />
        </label>
        {current && current.bpm !== bpm && (
          <button className="btn sm" title={`${current.name} usually sits around ${current.bpm} bpm`} onClick={() => set((s) => ({ ...s, progression: { ...s.progression, bpm: current.bpm } }))}>Try ♩ {current.bpm}</button>
        )}
        {beat.div % 2 === 0 && <Knob label="Swing" value={beat.swing} onChange={(v) => setFx({ swing: v })} />}
        <Knob label="Volume" value={beat.level} onChange={(v) => setFx({ level: v })} />
        <Knob label="Space" title="Reverb" value={beat.space} onChange={(v) => setFx({ space: v })} />
        <Knob label="Grit" title="Saturation, lo-fi" value={beat.grit} onChange={(v) => setFx({ grit: v })} />
      </div>
    </section>
  );
}

function Knob({ label, value, onChange, min = 0, max = 1, step = 0.05, title }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; title?: string }) {
  return (
    <label className="knob" title={title}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
