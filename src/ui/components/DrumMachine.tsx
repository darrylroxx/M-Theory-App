import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BEAT_GROUPS, BEAT_LIBRARY, ECHO_TIMES, FX_DEFAULTS, STEP_VELOCITY, VIBES, applyKit, applyUserKit, clearBeat, findPattern, fxOf, kitFrom, levelAt, setStep, soundOf, varyBeat, vibeOf, voiceOf, type Beat, type BeatFx, type BeatGroupId, type BeatPattern, type StepLevel } from "../../audio/beats";
import { playDrum, setDrumSolo, syncDrums } from "../../audio/drumbus";
import { DRUM_IDS, DRUM_LABEL, KITS, PUNCH_LABEL, SHAPE_KEYS, TONE_LABEL, defaultParams, getKit, renderDrum, type DrumId, type DrumParams, type KitId } from "../../audio/drums";
import { newId, useApp } from "../state";
import { Seg } from "./common";

type GroupId = BeatGroupId | "mine";

const pct = (v: number) => String(Math.round(v * 100));
const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");
const panText = (v: number) => (Math.abs(v) < 0.025 ? "C" : `${v < 0 ? "L" : "R"}${Math.round(Math.abs(v) * 100)}`);
const filterText = (v: number) => (Math.abs(v) < 0.025 ? "Off" : `${v < 0 ? "Low" : "High"} ${Math.round(Math.abs(v) * 100)}`);
const toneText = (v: number) => (Math.abs(v) < 0.025 ? "Flat" : `${v < 0 ? "Dark" : "Bright"} ${Math.round(Math.abs(v) * 100)}`);

/**
 * The drum machine, always on the page under the chords: pick a kit and a rhythm, tap squares
 * to change the beat, tap a drum's name to shape its sound, and set the effects for the whole kit.
 */
export function DrumMachine({ beat, setBeat, onPick, onStepRhythm, playing, onPlay, stepSink }: {
  beat: Beat;
  setBeat: (fn: (b: Beat) => Beat) => void;
  onPick: (p: BeatPattern) => void;
  /** previous / next rhythm of the same style */
  onStepRhythm: (dir: -1 | 1) => void;
  playing: boolean;
  onPlay: () => void;
  /** The player calls this with the step that is sounding (−1 = stopped) */
  stepSink: { current: ((step: number) => void) | null };
}) {
  const { state, set, toast } = useApp();
  const mine = state.myBeats;
  const myKits = state.myKits;
  const current = findPattern(beat.patternId, mine);
  const [group, setGroup] = useState<GroupId>(current?.group ?? "dream");
  const [brush, setBrush] = useState<StepLevel>(2);
  const [sel, setSel] = useState<DrumId>("kick");
  const [solo, setSolo] = useState<DrumId | null>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const paint = useRef<{ id: DrumId; level: StepLevel; last: number } | null>(null);
  const heard = useRef({ at: 0, timer: 0 });
  const bpm = state.progression.bpm;
  const fx = fxOf(beat);
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
  // follow the rhythm when it is changed from elsewhere (opening a saved idea)
  useEffect(() => {
    if (current) setGroup(current.group);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDrumSolo(solo);
    return () => setDrumSolo(null);
  }, [solo]);

  const hit = (id: DrumId, b: Beat = beat, velocity = 0.8) => {
    syncDrums(b, bpm);
    playDrum(b, id, undefined, velocity);
  };
  /** Hear a drum while a knob is moving, without machine-gunning it. */
  const audition = (id: DrumId, b: Beat) => {
    syncDrums(b, bpm);
    if (playing) return;
    const h = heard.current;
    window.clearTimeout(h.timer);
    const go = () => {
      h.at = performance.now();
      playDrum(b, id);
    };
    const wait = 130 - (performance.now() - h.at);
    if (wait <= 0) go();
    else h.timer = window.setTimeout(go, wait);
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

  const pickKit = (k: KitId) => {
    setBeat((b) => applyKit(b, k));
    if (!playing) hit("kick", applyKit(beat, k));
  };
  const saveKit = () => {
    const id = `kit-${newId()}`;
    const name = `My kit ${myKits.length + 1}`;
    set((s) => ({ ...s, myKits: [...s.myKits, kitFrom(beat, id, name)] }));
    setBeat((b) => ({ ...b, userKit: id }));
    toast(`Saved as ${name}`);
  };
  const setFx = (patch: Partial<BeatFx> & { swing?: number }) => {
    syncDrums({ ...beat, ...patch }, bpm);
    setBeat((b) => ({ ...b, ...patch }));
  };
  const p = soundOf(beat, sel);
  const def = defaultParams(sel);
  const setSound = (patch: Partial<DrumParams>) => {
    const id = sel;
    audition(id, { ...beat, sounds: { ...beat.sounds, [id]: { ...beat.sounds[id], ...patch } } });
    setBeat((b) => ({ ...b, sounds: { ...b.sounds, [id]: { ...b.sounds[id], ...patch } } }));
  };
  const setVoice = (k: KitId) => {
    const id = sel;
    audition(id, { ...beat, voices: { ...beat.voices, [id]: k } });
    setBeat((b) => ({ ...b, voices: { ...b.voices, [id]: k } }));
  };
  const resetSound = () => {
    const id = sel;
    const strip = <T,>(o: Partial<Record<DrumId, T>> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => k !== id)) as Partial<Record<DrumId, T>>;
    audition(id, { ...beat, sounds: strip(beat.sounds), voices: strip(beat.voices) });
    setBeat((b) => ({ ...b, sounds: strip(b.sounds), voices: strip(b.voices) }));
  };
  const toggleMute = (id: DrumId) => setBeat((b) => ({ ...b, mutes: b.mutes?.includes(id) ? b.mutes.filter((x) => x !== id) : [...(b.mutes ?? []), id] }));
  const saveRhythm = () => {
    const id = `mine-${newId()}`;
    const name = `My beat ${mine.length + 1}`;
    set((s) => ({ ...s, myBeats: [...s.myBeats, { id, name, group: "mine", steps: beat.steps, div: beat.div, bpm, swing: beat.swing, rows: beat.rows }] }));
    setBeat((b) => ({ ...b, patternId: id, name, edited: false }));
    setGroup("mine");
    toast("Saved to Mine");
  };

  const meter = beat.div === 3 ? (beat.steps === 6 ? "6/8" : "12/8") : `${beat.steps / beat.div}/4`;
  const voice = voiceOf(beat, sel);
  const muted = (id: DrumId) => (solo ? solo !== id : !!beat.mutes?.includes(id));
  const vibe = vibeOf(beat);
  const changed = !!beat.sounds[sel] && Object.keys(beat.sounds[sel]!).length > 0 || !!beat.voices?.[sel];

  return (
    <section className="card drums" aria-label="Drums">
      <div className="dm-head">
        <button className={`play-btn sm${playing ? " stop" : ""}`} onClick={onPlay} aria-label={playing ? "Stop" : "Play"}>{playing ? "■" : "▶"}</button>
        <h2>Drums</h2>
        <button className={`chip${beat.on ? " on" : ""}`} role="switch" aria-checked={beat.on} title="Play the drums under the chords" onClick={() => setBeat((b) => ({ ...b, on: !b.on }))}>{beat.on ? "On" : "Off"}</button>
        <span className="spacer" />
        <span className="pill dm-meter">{meter} · ♩ {bpm}</span>
      </div>

      <div className="beat-line">
        <span className="kb-label">Kit</span>
        <div className="beat-scroll" role="radiogroup" aria-label="Drum kit">
          {KITS.map((k) => {
            const on = beat.kit === k.id && !beat.userKit;
            return <button key={k.id} role="radio" aria-checked={on} className={`chip${on ? " on" : ""}`} title={k.hint} onClick={() => pickKit(k.id)}>{k.name}</button>;
          })}
          {myKits.map((k) => {
            const on = beat.userKit === k.id;
            return (
              <span key={k.id} className={`beat-item${on ? " on" : ""}`}>
                <button role="radio" aria-checked={on} onClick={() => { setBeat((b) => applyUserKit(b, k)); if (!playing) hit("kick", applyUserKit(beat, k)); }}>{k.name}</button>
                <button className="beat-del" aria-label={`Delete ${k.name}`} onClick={() => set((s) => ({ ...s, myKits: s.myKits.filter((x) => x.id !== k.id) }))}>✕</button>
              </span>
            );
          })}
          <button className="btn sm" title="Keep this kit, its sounds and effects for other songs" onClick={saveKit}>Save kit</button>
        </div>
      </div>

      <div className="beat-line">
        <span className="kb-label">Rhythm</span>
        <div className="beat-pick">
          <button aria-label="Previous rhythm" title="Previous rhythm" onClick={() => onStepRhythm(-1)}>‹</button>
          <b className="beat-name">{beat.name}{beat.edited ? "*" : ""}</b>
          <button aria-label="Next rhythm" title="Next rhythm" onClick={() => onStepRhythm(1)}>›</button>
        </div>
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
              {x.group === "mine" && <button className="beat-del" aria-label={`Delete ${x.name}`} onClick={() => set((s) => ({ ...s, myBeats: s.myBeats.filter((y) => y.id !== x.id) }))}>✕</button>}
            </span>
          );
        })}
        {!list.length && <span className="tiny muted">Nothing saved yet</span>}
      </div>

      <div className="beat-grid" style={{ "--steps": beat.steps } as CSSProperties}>
        <div className="bg-labels">
          {DRUM_IDS.map((id) => (
            <button key={id} className={`bg-label d-${id}${sel === id ? " on" : ""}${muted(id) ? " muted" : ""}`} aria-pressed={sel === id} title={`${getKit(voiceOf(beat, id)).names[id]}: tap to hear it and shape its sound`}
              onClick={() => { hit(id); setSel(id); }}>{DRUM_LABEL[id]}</button>
          ))}
        </div>
        <div className="bg-steps" ref={stepsRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="bg-now" />
          {DRUM_IDS.map((id) => (
            <div key={id} className={`bg-row d-${id}${sel === id ? " sel" : ""}${muted(id) ? " muted" : ""}`}>
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
        <span className="spacer" />
        <button className="btn sm" title="Small random variation" onClick={() => setBeat((b) => ({ ...varyBeat(b), on: true }))}>✨ Vary</button>
        <button className="btn sm danger" onClick={() => setBeat(clearBeat)}>Clear</button>
        <button className="btn sm" onClick={saveRhythm}>Save rhythm</button>
      </div>

      <div className="dm-panels">
        <div className={`dm-panel d-${sel}`} role="group" aria-label={`${DRUM_LABEL[sel]} sound`}>
          <div className="dm-phead">
            <button className="dm-wave" aria-label={`Hear the ${DRUM_LABEL[sel].toLowerCase()}`} title="Tap to hear it" onClick={() => hit(sel)}>
              <Wave kit={voice} id={sel} p={p} />
            </button>
            <div className="dm-title">
              <span className="kb-label">Sound</span>
              <b>{getKit(voice).names[sel]}</b>
            </div>
            <span className="spacer" />
            <button className={`chip${beat.mutes?.includes(sel) ? " on" : ""}`} aria-pressed={!!beat.mutes?.includes(sel)} onClick={() => toggleMute(sel)}>Mute</button>
            <button className={`chip${solo === sel ? " on" : ""}`} aria-pressed={solo === sel} title="Hear only this drum" onClick={() => setSolo(solo === sel ? null : sel)}>Solo</button>
            <button className="icon-btn dm-reset" disabled={!changed} aria-label={`Reset the ${DRUM_LABEL[sel].toLowerCase()}`} title="Back to this kit's own sound" onClick={resetSound}>↺</button>
          </div>
          <div className="beat-scroll dm-voices" role="radiogroup" aria-label={`Which machine the ${DRUM_LABEL[sel].toLowerCase()} comes from`}>
            {KITS.map((k) => <button key={k.id} role="radio" aria-checked={voice === k.id} className={`chip${voice === k.id ? " on" : ""}`} title={`${k.name}: ${k.names[sel]}`} onClick={() => setVoice(k.id)}>{k.name}</button>)}
          </div>
          <div className="knobs">
            <Knob label="Tune" min={-12} max={12} step={1} value={p.tune} def={0} fmt={signed} onChange={(v) => setSound({ tune: v })} />
            <Knob label="Decay" title="How long it rings" value={p.decay} def={def.decay} onChange={(v) => setSound({ decay: v })} />
            <Knob label={TONE_LABEL[sel]} value={p.tone} def={def.tone} onChange={(v) => setSound({ tone: v })} />
            <Knob label={PUNCH_LABEL[sel]} value={p.punch} def={def.punch} onChange={(v) => setSound({ punch: v })} />
            <Knob label="Drive" title="Distortion on this drum only" value={p.drive} def={0} onChange={(v) => setSound({ drive: v })} />
            <Knob label="Filter" title="Left: darker. Right: thinner." min={-1} max={1} value={p.filter} def={0} fmt={filterText} onChange={(v) => setSound({ filter: v })} />
            <Knob label="Level" value={p.level} def={def.level} onChange={(v) => setSound({ level: v })} />
            <Knob label="Pan" title="Left or right" min={-1} max={1} value={p.pan} def={def.pan} fmt={panText} onChange={(v) => setSound({ pan: v })} />
            <Knob label="Reverb" title="How much of this drum goes to the reverb" value={p.space} def={def.space} onChange={(v) => setSound({ space: v })} />
            <Knob label="Echo" title="How much of this drum goes to the echo" value={p.echo} def={def.echo} onChange={(v) => setSound({ echo: v })} />
          </div>
        </div>

        <div className="dm-panel dm-mix" role="group" aria-label="Whole kit">
          <div className="dm-phead">
            <div className="dm-title">
              <span className="kb-label">Whole kit</span>
              <b>Effects</b>
            </div>
            <div className="beat-scroll" role="radiogroup" aria-label="Vibe">
              {VIBES.map((v) => <button key={v.id} role="radio" aria-checked={vibe === v.id} className={`chip${vibe === v.id ? " on" : ""}`} title={v.hint} onClick={() => { setFx(v.fx); if (!playing) hit("snare", { ...beat, ...v.fx }); }}>{v.name}</button>)}
            </div>
          </div>
          <div className="knobs">
            <Knob wide label="Tempo" min={40} max={200} step={1} value={bpm} fmt={String} onChange={(v) => set((s) => ({ ...s, progression: { ...s.progression, bpm: v } }))}>
              {current && current.bpm !== bpm && (
                <button className="btn sm" title={`${current.name} usually sits around ${current.bpm} bpm`} onClick={() => set((s) => ({ ...s, progression: { ...s.progression, bpm: current.bpm } }))}>Try ♩ {current.bpm}</button>
              )}
            </Knob>
            <Knob label="Volume" value={fx.level} def={FX_DEFAULTS.level} onChange={(v) => setFx({ level: v })} />
            {beat.div % 2 === 0 && <Knob label="Swing" title="Delays every second step" value={beat.swing} def={0} onChange={(v) => setFx({ swing: v })} />}
            <Knob label="Human" title="Looser timing and touch, like a player" value={fx.human} def={0} onChange={(v) => setFx({ human: v })} />
            <Knob label="Reverb" value={fx.space} def={FX_DEFAULTS.space} onChange={(v) => setFx({ space: v })} />
            <Knob label="Room size" title="Small room … long hall" value={fx.size} def={FX_DEFAULTS.size} onChange={(v) => setFx({ size: v })} />
            <Knob label="Echo" value={fx.echo} def={0} onChange={(v) => setFx({ echo: v })} />
            <div className="knob wide">
              <span><i>Echo time</i></span>
              <Seg value={fx.echoTime} options={ECHO_TIMES.map((e) => ({ value: e.id, label: e.label }))} onChange={(v) => setFx({ echoTime: v })} label="Echo time" />
            </div>
            <Knob label="Grit" title="Distortion on the whole kit" value={fx.grit} def={FX_DEFAULTS.grit} onChange={(v) => setFx({ grit: v })} />
            <Knob label="Tape" title="Wobbly and dull, like an old cassette" value={fx.tape} def={0} onChange={(v) => setFx({ tape: v })} />
            <Knob label="Tone" min={-1} max={1} value={fx.tone} def={0} fmt={toneText} onChange={(v) => setFx({ tone: v })} />
            <Knob label="Glue" title="Squashes the kit together so it pumps" value={fx.glue} def={FX_DEFAULTS.glue} onChange={(v) => setFx({ glue: v })} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** A labelled slider that shows its value. Double-click puts it back to its default. */
function Knob({ label, value, onChange, min = 0, max = 1, step = 0.05, title, def, fmt = pct, wide, children }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; title?: string;
  def?: number; fmt?: (v: number) => string; wide?: boolean; children?: React.ReactNode;
}) {
  const at = ((value - min) / (max - min)) * 100;
  const mid = min < 0 ? 50 : 0;
  const style = { "--a": `${Math.min(at, mid)}%`, "--b": `${Math.max(at, mid)}%` } as CSSProperties;
  return (
    <label className={`knob${wide ? " wide" : ""}${def !== undefined && Math.abs(value - def) > 1e-6 ? " moved" : ""}`} title={title} onDoubleClick={() => def !== undefined && onChange(def)}>
      <span><i>{label}</i><b>{fmt(value)}</b>{children}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label} style={style} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/** The longest each drum can ring, in seconds: the full width of its picture. */
const WAVE_SEC: Record<DrumId, number> = { kick: 2.8, snare: 0.5, clap: 0.75, hat: 0.19, open: 1.7, tom: 0.98, rim: 0.19, shaker: 0.55, bell: 2.4 };

/** A picture of the sound: its shape changes as the knobs move. */
const Wave = memo(function Wave({ kit, id, p }: { kit: KitId; id: DrumId; p: DrumParams }) {
  const key = SHAPE_KEYS.map((k) => p[k]).join("|");
  const path = useMemo(() => {
    const sr = 16000;
    const data = renderDrum(sr, kit, id, p);
    const cols = 110;
    // time runs faster towards the right, so a short hit and a long boom both fill the picture
    const at = (c: number) => Math.floor(Math.pow(c / cols, 2) * WAVE_SEC[id] * sr);
    let peak = 0.0001;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    let d = "";
    for (let c = 0; c < cols; c++) {
      let lo = 0, hi = 0;
      for (let i = at(c); i < Math.min(data.length, Math.max(at(c) + 1, at(c + 1))); i++) {
        if (data[i] < lo) lo = data[i];
        if (data[i] > hi) hi = data[i];
      }
      d += `M${c + 0.5} ${(20 - (hi / peak) * 18 - 0.5).toFixed(1)}V${(20 - (lo / peak) * 18 + 0.5).toFixed(1)}`;
    }
    return d;
  }, [kit, id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg viewBox="0 0 110 40" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
});
