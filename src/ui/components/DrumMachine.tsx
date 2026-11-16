import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BEAT_GROUPS, BEAT_LIBRARY, ECHO_TIMES, FX_DEFAULTS, MAX_BARS, STEP_VELOCITY, BUILTIN_KITS, NOISE_BEDS, VERBS, VIBES, applyKit, applyUserKit, barsOf, clearBeat, copyBar, findPattern, fxOf, kitFrom, levelAt, removeBar, setBars, setStep, soundOf, varyBeat, vibeOf, voiceOf, type Beat, type BeatFx, type BeatGroupId, type BeatPattern, type StepLevel, type UserKit } from "../../audio/beats";
import { playDrum, setDrumSolo, syncDrums } from "../../audio/drumbus";
import { DRUM_IDS, DRUM_LABEL, KITS, PUNCH_LABEL, SAMPLERS, SHAPE_KEYS, TONE_LABEL, defaultParams, getKit, isMachine, renderDrum, type DrumId, type DrumParams, type KitId, type VoiceId } from "../../audio/drums";
import { RECIPES, getRecipe } from "../../audio/voices";
import { newId, useApp } from "../state";
import { letterClass } from "../letters";
import { Seg } from "./common";

type GroupId = BeatGroupId | "mine";
/** What a grid edit can change, and so what Undo and Cancel put back. */
type Snap = Pick<Beat, "rows" | "edited" | "patternId" | "name" | "on" | "bars">;
const snapOf = (b: Beat): Snap => ({ rows: b.rows, edited: b.edited, patternId: b.patternId, name: b.name, on: b.on, bars: barsOf(b) });
const sameRows = (a: Beat["rows"], b: Beat["rows"]) => DRUM_IDS.every((id) => a[id] === b[id]);

const pct = (v: number) => String(Math.round(v * 100));
/** A drum's sound by name: a library sound ("Felt"), or the machine's ("808"). */
const soundName = (v: VoiceId) => getRecipe(v)?.name ?? (isMachine(v) ? getKit(v).name : v);
/** Every sound a drum can have: the library's for that drum, then each machine's version. */
const choicesFor = (id: DrumId): VoiceId[] => [...RECIPES[id].map((r) => r.id), ...KITS.map((k) => k.id)];
const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");
const panText = (v: number) => (Math.abs(v) < 0.025 ? "C" : `${v < 0 ? "L" : "R"}${Math.round(Math.abs(v) * 100)}`);
const filterText = (v: number) => (Math.abs(v) < 0.025 ? "Off" : `${v < 0 ? "Low" : "High"} ${Math.round(Math.abs(v) * 100)}`);
const toneText = (v: number) => (Math.abs(v) < 0.025 ? "Flat" : `${v < 0 ? "Dark" : "Bright"} ${Math.round(Math.abs(v) * 100)}`);

/**
 * The drum machine, always on the page under the chords.
 * What you see first is small: play, the kit, the rhythm and the grid. The grid is locked until
 * you tap Edit. Everything deeper (a drum's sound, the effects) opens only when you ask for it.
 */
export function DrumMachine({ beat, setBeat, onPick, playing, onPlay, stepSink, letters, onLetter }: {
  beat: Beat;
  setBeat: (fn: (b: Beat) => Beat) => void;
  onPick: (p: BeatPattern) => void;
  playing: boolean;
  onPlay: () => void;
  /** The player calls this with the step that is sounding (−1 = stopped) */
  stepSink: { current: ((step: number) => void) | null };
  /** the song's sections, each letter once: every section has its own rhythm */
  letters: { partId: string; letter: string; blockId: string; current: boolean }[];
  onLetter: (blockId: string) => void;
}) {
  const { state, set, toast } = useApp();
  const mine = state.myBeats;
  const myKits = state.myKits;
  const current = findPattern(beat.patternId, mine);
  const [group, setGroup] = useState<GroupId>(current?.group ?? "dream");
  const [brush, setBrush] = useState<StepLevel>(2);
  const [sel, setSel] = useState<DrumId>("kick");
  const [solo, setSolo] = useState<DrumId | null>(null);
  /** one of the two pickers under the header */
  const [drawer, setDrawer] = useState<"kit" | "rhythm" | null>(null);
  /** one of the two deep panels under the grid */
  const [panel, setPanel] = useState<"sound" | "fx" | null>(null);
  /** an edit in progress: where it started, and every step since */
  const [edit, setEdit] = useState<{ start: Snap; past: Snap[] } | null>(null);
  const [nudge, setNudge] = useState(false);
  /** the bar shown in the grid */
  const [bar, setBar] = useState(0);
  const bars = barsOf(beat);
  const shownBar = Math.min(bar, bars - 1);
  const live = useRef({ bar: shownBar, editing: false, steps: beat.steps });
  live.current = { bar: shownBar, editing: !!edit, steps: beat.steps };
  const stepsRef = useRef<HTMLDivElement>(null);
  const paint = useRef<{ id: DrumId; level: StepLevel; last: number } | null>(null);
  const heard = useRef({ at: 0, timer: 0 });
  const bpm = state.progression.bpm;
  const fx = fxOf(beat);
  const editing = !!edit;
  const list = group === "mine" ? mine : BEAT_LIBRARY.filter((p) => p.group === group);

  // moving playhead, without re-rendering the grid on every step
  useEffect(() => {
    stepSink.current = (n) => {
      const el = stepsRef.current;
      if (!el) return;
      const { bar: on, editing: busy, steps } = live.current;
      const at = n >= 0 ? Math.floor(n / steps) : -1;
      // while listening, the grid follows the bar that is playing; while editing it stays put
      if (at >= 0 && at !== on && !busy) setBar(at);
      el.classList.toggle("playing", n >= 0 && (at === on || !busy));
      if (n >= 0) el.style.setProperty("--now", String(n % steps));
      el.closest(".drums")?.querySelectorAll<HTMLElement>("[data-bar]").forEach((t) => t.classList.toggle("sounding", Number(t.dataset.bar) === at));
    };
    return () => {
      stepSink.current = null;
    };
  }, [stepSink]);
  // follow the rhythm when it is changed from elsewhere (opening a saved idea)
  useEffect(() => {
    if (current) setGroup(current.group);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // another idea or another section: the edit so far is kept, and the grid starts at bar 1
  const section = letters.find((l) => l.current)?.partId;
  useEffect(() => {
    setEdit(null);
    setBar(0);
  }, [state.ideaId, section]);
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

  // ── Editing the grid: Edit, then Undo / Cancel / Save ──
  const startEdit = () => {
    setEdit({ start: snapOf(beat), past: [] });
    setDrawer(null);
  };
  /** Remember the beat as it is now, so the next change can be undone. */
  const remember = () => setEdit((e) => (e ? { ...e, past: [...e.past.slice(-99), snapOf(beat)] } : e));
  const undo = () => {
    const last = edit?.past[edit.past.length - 1];
    if (!edit || !last) return;
    setBeat((b) => ({ ...b, ...last }));
    setEdit({ ...edit, past: edit.past.slice(0, -1) });
  };
  const cancel = () => {
    if (edit) setBeat((b) => ({ ...b, ...edit.start }));
    setEdit(null);
  };
  /** Keep the changes and lock the grid. A changed rhythm also goes into "Mine", so it can be used again. */
  const save = () => {
    const hasHits = DRUM_IDS.some((id) => /[123]/.test(beat.rows[id]));
    const same = BEAT_LIBRARY.concat(mine).find((p) => p.steps === beat.steps && p.div === beat.div && (p.bars ?? 1) === bars && sameRows(p.rows, beat.rows));
    setEdit(null);
    if (!hasHits) return;
    if (same) {
      // back to a rhythm that already exists: no copy needed
      setBeat((b) => ({ ...b, patternId: same.id, name: same.name, edited: false }));
      return;
    }
    if (current?.group === "mine") {
      set((s) => ({ ...s, myBeats: s.myBeats.map((p) => (p.id === current.id ? { ...p, rows: beat.rows, bars, swing: beat.swing, bpm } : p)) }));
      setBeat((b) => ({ ...b, edited: false }));
      toast(`${current.name} saved`);
      return;
    }
    const id = `mine-${newId()}`;
    let n = mine.length + 1;
    while (mine.some((p) => p.name === `My beat ${n}`)) n++;
    const name = `My beat ${n}`;
    set((s) => ({ ...s, myBeats: [...s.myBeats, { id, name, group: "mine", steps: beat.steps, div: beat.div, bars, bpm, swing: beat.swing, rows: beat.rows }] }));
    setBeat((b) => ({ ...b, patternId: id, name, edited: false }));
    setGroup("mine");
    toast(`Saved as ${name}`);
  };

  const put = (id: DrumId, i: number, level: StepLevel) => setBeat((b) => ({ ...setStep(b, id, i, level), on: true }));
  const cellAt = (x: number, y: number) => {
    const c = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-i]");
    return c ? { id: c.dataset.d as DrumId, i: Number(c.dataset.i) } : null;
  };
  // ── bars ──
  const addBar = () => {
    if (bars >= MAX_BARS) return;
    remember();
    setBeat((b) => {
      const longer = setBars(b, barsOf(b) + 1);
      return copyBar(longer, shownBar, barsOf(longer) - 1);
    });
    setBar(bars);
  };
  const dropBar = () => {
    remember();
    setBeat((b) => removeBar(b, shownBar));
    setBar(Math.max(0, shownBar - 1));
  };

  const press = (id: DrumId, i: number): StepLevel => {
    remember();
    const level: StepLevel = levelAt(beat.rows, id, i) === brush ? 0 : brush;
    put(id, i, level);
    if (level && !playing) hit(id, beat, STEP_VELOCITY[level]);
    return level;
  };
  /** The grid was touched while locked: point at the Edit button. */
  const locked = () => {
    setNudge(true);
    window.setTimeout(() => setNudge(false), 700);
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const c = cellAt(e.clientX, e.clientY);
    if (!c) return;
    if (!editing) return locked();
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

  // ── Kits ──
  const kits = useMemo(() => [
    ...BUILTIN_KITS.map((k) => ({ id: k.id, name: k.name, hint: k.hint, preset: k as UserKit })),
    ...KITS.map((k) => ({ id: k.id as string, name: k.name, hint: k.hint, preset: null })),
    ...myKits.map((k) => ({ id: k.id, name: k.name, hint: "Saved by you", preset: k as UserKit | null })),
  ], [myKits]);
  // a kit that was saved and later deleted falls back to the machine it was built on
  const preset = beat.userKit ? kits.findIndex((k) => k.preset && k.id === beat.userKit) : -1;
  const kitAt = preset >= 0 ? preset : Math.max(0, kits.findIndex((k) => !k.preset && k.id === beat.kit));
  const pickKit = (k: (typeof kits)[number]) => {
    const next = k.preset ? applyUserKit(beat, k.preset) : applyKit(beat, k.id as KitId);
    setBeat((b) => (k.preset ? applyUserKit(b, k.preset) : applyKit(b, k.id as KitId)));
    syncDrums(next, bpm);
    if (!playing) hit("kick", next);
  };
  const saveKit = () => {
    const id = `kit-${newId()}`;
    let n = myKits.length + 1;
    while (myKits.some((k) => k.name === `My kit ${n}`)) n++;
    set((s) => ({ ...s, myKits: [...s.myKits, kitFrom(beat, id, `My kit ${n}`)] }));
    setBeat((b) => ({ ...b, userKit: id }));
    toast(`Saved as My kit ${n}`);
  };

  // ── Rhythms ──
  const stepRhythm = (dir: -1 | 1) => {
    const pool = current?.group === "mine" ? mine : BEAT_LIBRARY.filter((x) => x.group === (current?.group ?? "dream"));
    if (!pool.length) return;
    const at = pool.findIndex((x) => x.id === beat.patternId);
    onPick(pool[(Math.max(at, 0) + dir + pool.length) % pool.length]);
  };

  // ── Sound and effects ──
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
  const setVoice = (k: VoiceId) => {
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

  const meter = beat.div === 3 ? (beat.steps === 6 ? "6/8" : "12/8") : `${beat.steps / beat.div}/4`;
  const voice = voiceOf(beat, sel);
  const muted = (id: DrumId) => (solo ? solo !== id : !!beat.mutes?.includes(id));
  const vibe = vibeOf(beat);
  const changed = Object.keys(beat.sounds[sel] ?? {}).length > 0 || !!beat.voices?.[sel];
  const tile = (k: (typeof kits)[number], onDelete?: () => void) => (
    <span key={k.id} className={`dm-tile${kits[kitAt]?.id === k.id ? " on" : ""}`}>
      <button role="radio" aria-checked={kits[kitAt]?.id === k.id} title={k.hint} onClick={() => { pickKit(k); setDrawer(null); }}>
        <b>{k.name}</b>
      </button>
      {onDelete && <button className="dm-x" aria-label={`Delete ${k.name}`} onClick={onDelete}>✕</button>}
    </span>
  );

  return (
    <section className={`card drums${editing ? " editing" : ""}`} aria-label="Drums">
      <div className="dm-head">
        <button className={`play-btn sm${playing ? " stop" : ""}`} onClick={onPlay} aria-label={playing ? "Stop" : "Play"}>{playing ? "■" : "▶"}</button>
        <h2>Drums</h2>
        <button className={`chip${beat.on ? " on" : ""}`} role="switch" aria-checked={beat.on} title="Play the drums under the chords" onClick={() => setBeat((b) => ({ ...b, on: !b.on }))}>{beat.on ? "On" : "Off"}</button>
        <Picker label="Kit" name={kits[kitAt]?.name ?? ""} open={drawer === "kit"} onOpen={() => setDrawer(drawer === "kit" ? null : "kit")}
          onStep={(d) => pickKit(kits[(kitAt + d + kits.length) % kits.length])} />
        <Picker label="Rhythm" name={beat.name + (beat.edited ? "*" : "")} open={drawer === "rhythm"} disabled={editing} onOpen={() => setDrawer(drawer === "rhythm" ? null : "rhythm")} onStep={stepRhythm} />
      </div>

      {letters.length > 1 && (
        <div className="dm-secs" role="radiogroup" aria-label="Section">
          <span className="kb-label">Section</span>
          {letters.map((l) => (
            <button key={l.partId} role="radio" aria-checked={l.current} className={`sec-chip ${letterClass(l.letter)}${l.current ? " on" : ""}`} title={`Drums for section ${l.letter}`} onClick={() => !l.current && onLetter(l.blockId)}>{l.letter}</button>
          ))}
        </div>
      )}

      {drawer === "kit" && (
        <div className="dm-drawer" role="radiogroup" aria-label="Drum kit">
          <div className="dm-tiles">{kits.slice(0, BUILTIN_KITS.length).map((k) => tile(k))}</div>
          <span className="kb-label">Machines</span>
          <div className="dm-tiles">{kits.slice(BUILTIN_KITS.length, BUILTIN_KITS.length + KITS.length).map((k) => tile(k))}</div>
          <span className="kb-label">Mine</span>
          <div className="dm-tiles">
            {kits.slice(BUILTIN_KITS.length + KITS.length).map((k) => tile(k, () => set((s) => ({ ...s, myKits: s.myKits.filter((x) => x.id !== k.id) }))))}
            <button className="dm-tile add" title="Keep this kit, its sounds and effects for other songs" onClick={saveKit}>+ Save this kit</button>
          </div>
        </div>
      )}
      {drawer === "rhythm" && (
        <div className="dm-drawer">
          <div className="dm-chips" role="radiogroup" aria-label="Rhythm style">
            {BEAT_GROUPS.map((g) => <button key={g.id} role="radio" aria-checked={group === g.id} className={`chip${group === g.id ? " on" : ""}`} onClick={() => setGroup(g.id)}>{g.name}</button>)}
            {mine.length > 0 && <button role="radio" aria-checked={group === "mine"} className={`chip${group === "mine" ? " on" : ""}`} onClick={() => setGroup("mine")}>Mine</button>}
          </div>
          <div className="dm-chips" role="listbox" aria-label="Rhythms">
            {list.map((x) => {
              const on = beat.patternId === x.id;
              return (
                <span key={x.id} className={`beat-item${on ? " on" : ""}`}>
                  <button role="option" aria-selected={on} onClick={() => { onPick(x); setDrawer(null); }}>{x.name}</button>
                  {x.group === "mine" && <button className="beat-del" aria-label={`Delete ${x.name}`} onClick={() => set((s) => ({ ...s, myBeats: s.myBeats.filter((y) => y.id !== x.id) }))}>✕</button>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="dm-bar">
        {editing ? (
          <>
            <button className="btn sm" onClick={undo} disabled={!edit.past.length} aria-label="Undo">↶ Undo</button>
            <Seg value={brush} options={[{ value: 1 as StepLevel, label: "Soft" }, { value: 2 as StepLevel, label: "Normal" }, { value: 3 as StepLevel, label: "Loud" }]} onChange={setBrush} label="How hard new hits are" />
            <button className="btn sm" title="A small random change" aria-label="Vary" onClick={() => { remember(); setBeat((b) => ({ ...varyBeat(b, Math.random, shownBar), on: true })); }}>✨</button>
            <button className="btn sm danger" title={bars > 1 ? "Empty this bar" : "Empty the grid"} onClick={() => { remember(); setBeat((b) => clearBeat(b, barsOf(b) > 1 ? shownBar : undefined)); }}>Clear</button>
            <span className="spacer" />
            <button className="btn sm" onClick={cancel}>Cancel</button>
            <button className="btn sm primary" onClick={save}>✓ Save</button>
          </>
        ) : (
          <>
            <button className={`btn sm dm-edit${nudge ? " nudge" : ""}`} onClick={startEdit}>✎ Edit</button>
            {nudge && <span className="tiny muted">Tap Edit to change the beat</span>}
            <span className="spacer" />
            <span className="pill dm-meter">{meter}{bars > 1 ? ` · ${bars} bars` : ""} · {bpm} bpm</span>
          </>
        )}
      </div>

      {(bars > 1 || editing) && (
        <div className="dm-bars" role="tablist" aria-label="Bars">
          <span className="kb-label">Bar</span>
          {Array.from({ length: bars }, (_, i) => (
            <button key={i} role="tab" data-bar={i} aria-selected={i === shownBar} className={i === shownBar ? "on" : ""} onClick={() => setBar(i)}>{i + 1}</button>
          ))}
          {editing && bars < MAX_BARS && <button className="dm-bar-add" title="Add a bar: a copy of this one" aria-label="Add a bar" onClick={addBar}>+</button>}
          {editing && bars > 1 && <button className="dm-bar-del" title={`Remove bar ${shownBar + 1}`} aria-label={`Remove bar ${shownBar + 1}`} onClick={dropBar}>✕</button>}
        </div>
      )}

      <div className={`beat-grid${editing ? "" : " locked"}`} style={{ "--steps": beat.steps } as CSSProperties}>
        <div className="bg-labels">
          {DRUM_IDS.map((id) => (
            <button key={id} className={`bg-label d-${id}${panel === "sound" && sel === id ? " on" : ""}${muted(id) ? " muted" : ""}`} aria-pressed={panel === "sound" && sel === id} title={`${soundName(voiceOf(beat, id))}: tap to hear it and shape its sound`}
              onClick={() => { hit(id); setSel(id); setPanel("sound"); }}>{DRUM_LABEL[id]}</button>
          ))}
        </div>
        <div className="bg-steps" ref={stepsRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="bg-now" />
          {DRUM_IDS.map((id) => (
            <div key={id} className={`bg-row d-${id}${muted(id) ? " muted" : ""}`}>
              {Array.from({ length: beat.steps }, (_, k) => {
                const i = shownBar * beat.steps + k;
                const lv = levelAt(beat.rows, id, i);
                return (
                  <button key={k} className={`bg-cell l${lv}${k % beat.div === 0 ? " beat" : ""}`} data-d={id} data-i={i} aria-pressed={lv > 0} tabIndex={editing ? 0 : -1} aria-disabled={!editing}
                    aria-label={`${DRUM_LABEL[id]} step ${k + 1}${bars > 1 ? ` of bar ${shownBar + 1}` : ""}${lv ? [" ", " soft", "", " loud"][lv] : " off"}`}
                    onClick={(e) => { if (e.detail === 0 && editing) press(id, i); }} />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="dm-tabs">
        <button className={`chip${panel === "sound" ? " on" : ""}`} aria-expanded={panel === "sound"} onClick={() => setPanel(panel === "sound" ? null : "sound")}>Sound</button>
        <button className={`chip${panel === "fx" ? " on" : ""}`} aria-expanded={panel === "fx"} onClick={() => setPanel(panel === "fx" ? null : "fx")}>Effects</button>
      </div>

      {panel === "sound" && (
        <div className={`dm-panel d-${sel}`} role="group" aria-label={`${DRUM_LABEL[sel]} sound`}>
          <div className="dm-phead">
            <button className="dm-wave" aria-label={`Hear the ${DRUM_LABEL[sel].toLowerCase()}`} title="Tap to hear it" onClick={() => hit(sel)}>
              <Wave voice={voice} id={sel} p={p} />
            </button>
            <select className="dm-drum" aria-label="Drum" value={sel} onChange={(e) => { const id = e.target.value as DrumId; setSel(id); hit(id); }}>
              {DRUM_IDS.map((id) => <option key={id} value={id}>{DRUM_LABEL[id]}</option>)}
            </select>
            <div className="beat-pick dm-sound">
              <button aria-label="Previous sound" onClick={() => { const c = choicesFor(sel); setVoice(c[(c.indexOf(voice) - 1 + c.length) % c.length]); }}>‹</button>
              <select aria-label="Sound" title="Which sound this drum plays" value={voice} onChange={(e) => setVoice(e.target.value)}>
                <optgroup label="Sounds">{RECIPES[sel].map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>
                <optgroup label="Machines">{KITS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</optgroup>
                {!choicesFor(sel).includes(voice) && <option value={voice}>{soundName(voice)}</option>}
              </select>
              <button aria-label="Next sound" onClick={() => { const c = choicesFor(sel); setVoice(c[(c.indexOf(voice) + 1) % c.length]); }}>›</button>
            </div>
            <span className="spacer" />
            <button className={`chip${beat.mutes?.includes(sel) ? " on" : ""}`} aria-pressed={!!beat.mutes?.includes(sel)} aria-label="Mute" title="Mute" onClick={() => toggleMute(sel)}>M</button>
            <button className={`chip${solo === sel ? " on" : ""}`} aria-pressed={solo === sel} aria-label="Solo" title="Hear only this drum" onClick={() => setSolo(solo === sel ? null : sel)}>S</button>
            <button className="icon-btn dm-reset" disabled={!changed} aria-label={`Reset the ${DRUM_LABEL[sel].toLowerCase()}`} title="Back to this kit's own sound" onClick={resetSound}>↺</button>
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
      )}

      {panel === "fx" && (
        <div className="dm-panel dm-mix" role="group" aria-label="Effects for the whole kit">
          <div className="dm-chips" role="radiogroup" aria-label="Vibe">
            {VIBES.map((v) => <button key={v.id} role="radio" aria-checked={vibe === v.id} className={`chip${vibe === v.id ? " on" : ""}`} title={v.hint} onClick={() => { setFx(v.fx); if (!playing) hit("snare", { ...beat, ...v.fx }); }}>{v.name}</button>)}
          </div>
          <div className="knobs">
            <Knob wide label="Tempo" min={40} max={200} step={1} value={bpm} fmt={String} onChange={(v) => set((s) => ({ ...s, progression: { ...s.progression, bpm: v } }))}>
              {current && current.bpm !== bpm && (
                <button className="btn sm" title={`${current.name} usually sits around ${current.bpm} bpm`} onClick={() => set((s) => ({ ...s, progression: { ...s.progression, bpm: current.bpm } }))}>Try {current.bpm}</button>
              )}
            </Knob>
            <Knob label="Volume" value={fx.level} def={FX_DEFAULTS.level} onChange={(v) => setFx({ level: v })} />
            {beat.div % 2 === 0 && <Knob label="Swing" title="Delays every second step" value={beat.swing} def={0} onChange={(v) => setFx({ swing: v })} />}
            <Knob label="Human" title="Looser timing and touch, like a player" value={fx.human} def={0} onChange={(v) => setFx({ human: v })} />
          </div>
          <div className="knobs">
            <Choice label="Reverb type" value={fx.verb} options={VERBS} onChange={(v) => { setFx({ verb: v }); if (!playing) window.setTimeout(() => hit("snare"), 180); }} />
            <Knob label="Reverb" value={fx.space} def={FX_DEFAULTS.space} onChange={(v) => setFx({ space: v })} />
            <Knob label="Size" title="Small and short … big and long" value={fx.size} def={FX_DEFAULTS.size} onChange={(v) => setFx({ size: v })} />
            <Knob label="Echo" value={fx.echo} def={0} onChange={(v) => setFx({ echo: v })} />
            <div className="knob wide">
              <span><i>Echo time</i></span>
              <Seg value={fx.echoTime} options={ECHO_TIMES.map((e) => ({ value: e.id, label: e.label }))} onChange={(v) => setFx({ echoTime: v })} label="Echo time" />
            </div>
          </div>
          <div className="knobs">
            <Choice label="Sampler" value={fx.sampler} options={SAMPLERS} onChange={(v) => { setFx({ sampler: v }); if (!playing) hit("snare", { ...beat, sampler: v }); }} />
            <Choice label="Noise" value={fx.noise} options={NOISE_BEDS} onChange={(v) => setFx({ noise: v })} />
            {fx.noise !== "off" && <Knob label="Noise level" value={fx.noiseAmt} def={FX_DEFAULTS.noiseAmt} onChange={(v) => setFx({ noiseAmt: v })} />}
            <Knob label="Grit" title="Distortion on the whole kit" value={fx.grit} def={FX_DEFAULTS.grit} onChange={(v) => setFx({ grit: v })} />
            <Knob label="Tape" title="Wobbly and dull, like an old cassette" value={fx.tape} def={0} onChange={(v) => setFx({ tape: v })} />
          </div>
          <div className="knobs">
            <Knob label="Tone" min={-1} max={1} value={fx.tone} def={0} fmt={toneText} onChange={(v) => setFx({ tone: v })} />
            <Knob label="Glue" title="Squashes the kit together" value={fx.glue} def={FX_DEFAULTS.glue} onChange={(v) => setFx({ glue: v })} />
            <Knob label="Pump" title="The guitar ducks under every kick, then swells back" value={fx.pump} def={0} onChange={(v) => setFx({ pump: v })} />
          </div>
        </div>
      )}
    </section>
  );
}

/** A small labelled menu, the same size as a knob. */
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; name: string; hint: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="knob choice" title={options.find((o) => o.id === value)?.hint}>
      <span><i>{label}</i></span>
      <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.id} value={o.id} title={o.hint}>{o.name}</option>)}
      </select>
    </label>
  );
}

/** ‹ name ›: the arrows flip through, the name opens the full list. */
function Picker({ label, name, open, onOpen, onStep, disabled }: { label: string; name: string; open: boolean; onOpen: () => void; onStep: (dir: -1 | 1) => void; disabled?: boolean }) {
  return (
    <div className={`beat-pick${open ? " open" : ""}${disabled ? " off" : ""}`}>
      <button aria-label={`Previous ${label.toLowerCase()}`} disabled={disabled} onClick={() => onStep(-1)}>‹</button>
      <button className="beat-name" aria-expanded={open} aria-label={`${label}: ${name}`} disabled={disabled} onClick={onOpen}>
        <span>{label}</span>
        <b>{name}</b>
      </button>
      <button aria-label={`Next ${label.toLowerCase()}`} disabled={disabled} onClick={() => onStep(1)}>›</button>
    </div>
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
const Wave = memo(function Wave({ voice, id, p }: { voice: VoiceId; id: DrumId; p: DrumParams }) {
  const key = SHAPE_KEYS.map((k) => p[k]).join("|");
  const path = useMemo(() => {
    const sr = 16000;
    const data = renderDrum(sr, voice, id, p);
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
  }, [voice, id, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg viewBox="0 0 110 40" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
});
