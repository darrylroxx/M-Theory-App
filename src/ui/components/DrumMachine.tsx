import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BEAT_GROUPS, BEAT_LIBRARY, ECHO_TIMES, FX_DEFAULTS, STEP_VELOCITY, BUILTIN_KITS, NOISE_BEDS, VERBS, VIBES, applyKit, applyUserKit, barHasHits, barsOf, clearBeat, copyBar, findPattern, fxOf, kitFrom, levelAt, setStep, spreadBeat, soundOf, varyBeat, vibeOf, voiceOf, type Beat, type BeatFx, type BeatGroupId, type BeatPattern, type StepLevel, type UserKit } from "../../audio/beats";
import { playDrum, setDrumSolo, syncDrums } from "../../audio/drumbus";
import { DRUM_IDS, DRUM_LABEL, KITS, PUNCH_LABEL, SAMPLERS, SHAPE_KEYS, TONE_LABEL, defaultParams, getKit, isMachine, renderDrum, type DrumId, type DrumParams, type KitId, type VoiceId } from "../../audio/drums";
import { SAT_TYPES } from "../../audio/saturation";
import { RECIPES, getRecipe } from "../../audio/voices";
import { barWindow, inWindow, pageStart, reveal, turnPage, type BarWindow, type BarsShown } from "../../song/window";
import { newId, useApp } from "../state";
import { LinkChip, type Link } from "./HarpPanel";
import { Seg } from "./common";
import { Choice, Knob, Picker, toneText } from "./controls";

type GroupId = BeatGroupId | "mine";
/** What a grid edit can change, and so what Undo and Cancel put back. */
type Snap = Pick<Beat, "rows" | "edited" | "patternId" | "name" | "on" | "bars">;
const snapOf = (b: Beat): Snap => ({ rows: b.rows, edited: b.edited, patternId: b.patternId, name: b.name, on: b.on, bars: barsOf(b) });
const sameRows = (a: Beat["rows"], b: Beat["rows"]) => DRUM_IDS.every((id) => a[id] === b[id]);

/** A drum's sound by name: a library sound ("Felt"), or the machine's ("808"). */
const soundName = (v: VoiceId) => getRecipe(v)?.name ?? (isMachine(v) ? getKit(v).name : v);
/** Every sound a drum can have: the library's for that drum, then each machine's version. */
const choicesFor = (id: DrumId): VoiceId[] => [...RECIPES[id].map((r) => r.id), ...KITS.map((k) => k.id)];
const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");
const panText = (v: number) => (Math.abs(v) < 0.025 ? "C" : `${v < 0 ? "L" : "R"}${Math.round(Math.abs(v) * 100)}`);
const filterText = (v: number) => (Math.abs(v) < 0.025 ? "Off" : `${v < 0 ? "Low" : "High"} ${Math.round(Math.abs(v) * 100)}`);
/** After a tap or a drag the view holds still this long, so it never moves under the pointer. */
const HOLD_MS = 1500;

/**
 * The drum machine, always on the page under the chords.
 * What you see first is small: play, the kit, the rhythm and the grid. The grid is locked until
 * you tap Edit. Everything deeper (a drum's sound, the effects) opens only when you ask for it.
 */
export const DrumMachine = memo(function DrumMachine({ fresh, beat, setBeat, onPick, playing, kitLink, grooveLink, frame, getPos, shown, follow, active }: {
  beat: Beat;
  setBeat: (fn: (b: Beat) => Beat) => void;
  onPick: (p: BeatPattern) => void;
  playing: boolean;
  /** how many bars the section has: the grid has every one of them */
  frame: number;
  /** how many beats into the section the music is (null = stopped, or another section is sounding) */
  getPos: () => number | null;
  /** whether this section's drum sound and drum rhythm are the song's or its own */
  kitLink?: Link;
  grooveLink?: Link;
  /** changes when something is pasted: an edit in progress is let go */
  fresh?: number;
  /** bars on screen (0 = all of them) */
  shown: BarsShown;
  /** the view turns a page when the music runs off it */
  follow: boolean;
  /** the page is on screen (a hidden page does no work while the music plays) */
  active: boolean;
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
  const [panel, setPanel] = useState<"mix" | "sound" | "fx" | null>(null);
  /** an edit in progress: where it started, and every step since */
  const [edit, setEdit] = useState<{ start: Snap; past: Snap[] } | null>(null);
  const [nudge, setNudge] = useState(false);
  /** the first bar on screen, as last set; and the bar the bar tools (✨ ⧉ Clear) act on */
  const [start, setStart] = useState(0);
  const [bar, setBar] = useState(0);
  // the grid shows the section bar for bar. A rhythm shorter than the section comes round again
  // until a bar is changed; from then on every bar is written out and stands on its own.
  const bars = Math.max(1, frame);
  const view = useMemo(() => spreadBeat(beat, bars), [beat, bars]);
  const spread = (b: Beat) => spreadBeat(b, bars);
  const shownBar = Math.min(bar, bars - 1);
  // the window always holds the chosen bar: a change to the number of bars keeps it on screen
  const w0 = barWindow(bars, shown, start);
  const win: BarWindow = inWindow(w0, shownBar) ? w0 : { start: pageStart(shownBar, w0.count, bars), count: w0.count };
  const paged = win.count < bars;
  /** the bar to bring into sight in the grid once it is drawn (after a bar is chosen or a page turned) */
  const show = useRef<number | null>(null);
  /** Move the window; the chosen bar comes along when it would be left off screen. */
  const moveTo = (s: number) => {
    const w = barWindow(bars, shown, s);
    setStart(w.start);
    show.current = inWindow(w, shownBar) ? shownBar : w.start;
    if (!inWindow(w, shownBar)) setBar(w.start);
  };
  const live = useRef({ editing: false, steps: beat.steps, div: beat.div, bars, win, follow, held: 0, gen: 0, moveTo });
  live.current = { ...live.current, editing: !!edit, steps: beat.steps, div: beat.div, bars, win, follow, gen: live.current.gen + 1, moveTo };
  /** Someone is working here: Follow waits a moment before it turns the page. */
  const hold = () => {
    live.current.held = performance.now();
  };
  /** Choose a bar (its tab or its number): it is brought on screen if it is not. */
  const choose = (b: number) => {
    hold();
    setBar(b);
    setStart(reveal(win, b, bars));
    show.current = b;
  };
  const tabsRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  // keep the chosen bar in view in its row of tabs, and in the grid (sideways only)
  useEffect(() => {
    const r = tabsRef.current;
    const el = r?.querySelector<HTMLElement>(`[data-bar="${shownBar}"]`);
    if (r && el) {
      if (el.offsetLeft < r.scrollLeft) r.scrollLeft = el.offsetLeft - 8;
      else if (el.offsetLeft + el.offsetWidth > r.scrollLeft + r.clientWidth) r.scrollLeft = el.offsetLeft + el.offsetWidth - r.clientWidth + 8;
    }
    const box = stepsRef.current;
    const g = show.current === null ? null : box?.querySelector<HTMLElement>(`[data-gbar="${show.current}"]`);
    show.current = null;
    if (box && g && (g.offsetLeft < box.scrollLeft || g.offsetLeft + g.offsetWidth > box.scrollLeft + box.clientWidth + 1)) box.scrollLeft = g.offsetLeft;
  }, [shownBar, win.start]);
  const paint = useRef<{ id: DrumId; level: StepLevel; last: number } | null>(null);
  const heard = useRef({ at: 0, timer: 0 });
  const bpm = state.progression.bpm;
  const fx = fxOf(beat);
  const editing = !!edit;
  const list = group === "mine" ? mine : BEAT_LIBRARY.filter((p) => p.group === group);

  // the moving playhead, on the bar that is sounding, without redrawing the grid on every frame.
  // With Follow on, a page is turned when the music runs off the end of the bars on screen
  // (never while editing: the grid stays where the pencil is).
  useEffect(() => {
    const box = stepsRef.current;
    if (!playing || !active || !box) return;
    let raf = 0;
    let key = "";
    let gen = -1;
    let mark: HTMLElement | null = null;
    let turned = -1;
    const tabs = () => box.closest(".drums")?.querySelectorAll<HTMLElement>("[data-bar]") ?? [];
    const clear = () => {
      mark?.classList.remove("playing");
      mark = null;
    };
    const tick = () => {
      const pos = getPos();
      const l = live.current;
      const len = l.steps / l.div;
      let next = "";
      let at = -1;
      let step = -1;
      if (pos !== null && len > 0) {
        at = Math.max(0, Math.min(l.bars - 1, Math.floor(pos / len + 1e-6)));
        step = Math.max(0, Math.min(l.steps - 1, Math.floor((pos - at * len) * l.div + 1e-6)));
        next = `${at}:${step}`;
        if (l.follow && !l.editing && !inWindow(l.win, at) && turned !== at && performance.now() > l.held + HOLD_MS) {
          turned = at;
          l.moveTo(pageStart(at, l.win.count, l.bars));
        }
      }
      if (next !== key || gen !== l.gen) {
        const barChanged = next.split(":")[0] !== key.split(":")[0];
        key = next;
        gen = l.gen;
        const el = at >= 0 ? box.querySelector<HTMLElement>(`[data-gbar="${at}"]`) : null;
        if (el !== mark) clear();
        if (el) {
          mark = el;
          el.classList.add("playing");
          el.style.setProperty("--now", String(step));
          // the bars on screen may be wider than the screen (a phone): with Follow, keep the sounding one in sight
          if (l.follow && barChanged && !l.editing && (el.offsetLeft < box.scrollLeft || el.offsetLeft + el.offsetWidth > box.scrollLeft + box.clientWidth + 1)) box.scrollLeft = el.offsetLeft;
        }
        // (set again after a redraw: a tab drawn again loses the dot)
        tabs().forEach((t) => t.classList.toggle("sounding", Number(t.dataset.bar) === at));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clear();
      tabs().forEach((t) => t.classList.remove("sounding"));
    };
  }, [playing, getPos, active]);
  // follow the rhythm when it is changed from elsewhere (opening a saved idea)
  useEffect(() => {
    if (current) setGroup(current.group);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // another idea or another section: the edit so far is kept, and the grid starts at bar 1
  const section = state.progression.song?.current;
  useEffect(() => {
    setEdit(null);
    setBar(0);
    setStart(0);
  }, [state.ideaId, section, fresh]);
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
    const same = BEAT_LIBRARY.concat(mine).find((p) => p.steps === beat.steps && p.div === beat.div && (p.bars ?? 1) === barsOf(beat) && sameRows(p.rows, beat.rows));
    setEdit(null);
    if (!hasHits) return;
    if (same) {
      // back to a rhythm that already exists: no copy needed
      setBeat((b) => ({ ...b, patternId: same.id, name: same.name, edited: false }));
      return;
    }
    if (current?.group === "mine") {
      set((s) => ({ ...s, myBeats: s.myBeats.map((p) => (p.id === current.id ? { ...p, rows: beat.rows, bars: barsOf(beat), swing: beat.swing, bpm } : p)) }));
      setBeat((b) => ({ ...b, edited: false }));
      toast(`${current.name} saved`);
      return;
    }
    const id = `mine-${newId()}`;
    let n = mine.length + 1;
    while (mine.some((p) => p.name === `My beat ${n}`)) n++;
    const name = `My beat ${n}`;
    set((s) => ({ ...s, myBeats: [...s.myBeats, { id, name, group: "mine", steps: beat.steps, div: beat.div, bars: barsOf(beat), bpm, swing: beat.swing, rows: beat.rows }] }));
    setBeat((b) => ({ ...b, patternId: id, name, edited: false }));
    setGroup("mine");
    toast(`Saved as ${name}`);
  };

  const put = (id: DrumId, i: number, level: StepLevel) => setBeat((b) => {
    const all = spread(b);
    const next = setStep(all, id, i, level);
    return next === all ? (b.on ? b : { ...b, on: true }) : { ...next, on: true };
  });
  const cellAt = (x: number, y: number) => {
    const c = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-i]");
    return c ? { id: c.dataset.d as DrumId, i: Number(c.dataset.i) } : null;
  };
  const press = (id: DrumId, i: number): StepLevel => {
    remember();
    const level: StepLevel = levelAt(view.rows, id, i) === brush ? 0 : brush;
    put(id, i, level);
    if (level && !playing) hit(id, beat, STEP_VELOCITY[level]);
    return level;
  };
  /** The grid was touched while locked: point at the Edit button. */
  const locked = () => {
    setNudge(true);
    window.setTimeout(() => setNudge(false), 700);
  };
  /** a finger on the locked grid may be scrolling it sideways: it points at Edit only once it is clearly a tap */
  const finger = useRef(false);
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    hold();
    finger.current = e.pointerType === "touch";
    // a bar's number: the mouse chooses it at once; a finger may be scrolling, so its tap is taken on click
    const num = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
    if (num) return finger.current ? undefined : choose(Number(num.dataset.pick));
    const c = cellAt(e.clientX, e.clientY);
    if (!c) return;
    if (!editing) return finger.current ? undefined : locked();
    // the bar tools now act on the bar that was touched
    setBar(Math.floor(c.i / beat.steps));
    paint.current = { id: c.id, level: press(c.id, c.i), last: c.i };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  // drag along a row to paint (or erase) several steps, from one bar into the next
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = paint.current;
    if (!p) return;
    hold();
    const c = cellAt(e.clientX, e.clientY);
    if (c && c.id === p.id && c.i !== p.last) {
      p.last = c.i;
      put(p.id, c.i, p.level);
    }
  };
  const onUp = () => {
    paint.current = null;
  };
  // Enter or Space on a square (or on a bar's number), from the keyboard; and a finger's tap on a bar's number or the locked grid
  const onKey = (e: React.MouseEvent<HTMLDivElement>) => {
    const num = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
    if (e.detail !== 0) {
      if (finger.current && num) choose(Number(num.dataset.pick));
      else if (finger.current && !editing && (e.target as HTMLElement).closest("[data-i]")) locked();
      return;
    }
    if (num) return choose(Number(num.dataset.pick));
    const c = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (!c || !editing) return;
    hold();
    setBar(Math.floor(Number(c.dataset.i) / beat.steps));
    press(c.dataset.d as DrumId, Number(c.dataset.i));
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
  /** The mixer: one drum's volume. It is heard when the fader is let go (or at once, while the beat plays). */
  const setLevel = (id: DrumId, level: number) => setBeat((b) => ({ ...b, sounds: { ...b.sounds, [id]: { ...b.sounds[id], level } } }));
  const toggleMute = (id: DrumId) => setBeat((b) => ({ ...b, mutes: b.mutes?.includes(id) ? b.mutes.filter((x) => x !== id) : [...(b.mutes ?? []), id] }));

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
        <button className={`chip${beat.on ? " on" : ""}`} role="switch" aria-checked={beat.on} title="Play the drums under the chords" onClick={() => setBeat((b) => ({ ...b, on: !b.on }))}>{beat.on ? "On" : "Off"}</button>
        <span className="pick-wrap">
          <Picker label="Kit" name={kits[kitAt]?.name ?? ""} open={drawer === "kit"} onOpen={() => setDrawer(drawer === "kit" ? null : "kit")}
          onStep={(d) => pickKit(kits[(kitAt + d + kits.length) % kits.length])} />
          <LinkChip link={kitLink} what="drum sound" />
        </span>
        <span className="pick-wrap">
          <Picker label="Rhythm" name={beat.name + (beat.edited ? "*" : "")} open={drawer === "rhythm"} disabled={editing} onOpen={() => setDrawer(drawer === "rhythm" ? null : "rhythm")} onStep={stepRhythm} />
          <LinkChip link={grooveLink} what="drum rhythm" />
        </span>
      </div>

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
            <button className="btn sm" title="A small random change" aria-label="Vary" onClick={() => { remember(); setBeat((b) => ({ ...varyBeat(spread(b), Math.random, shownBar), on: true })); }}>✨</button>
            {bars > 1 && shownBar > 0 && <button className="btn sm" title={`Copy bar ${shownBar} into bar ${shownBar + 1}`} aria-label="Copy the bar before" onClick={() => { remember(); setBeat((b) => ({ ...copyBar(spread(b), shownBar - 1, shownBar), on: true })); }}>⧉</button>}
            <button className="btn sm danger" title={bars > 1 ? `Empty bar ${shownBar + 1}: it plays nothing` : "Empty the grid"} onClick={() => { remember(); setBeat((b) => clearBeat(spread(b), shownBar)); }}>Clear</button>
            <span className="spacer" />
            <button className="btn sm" onClick={cancel}>Cancel</button>
            <button className="btn sm primary" onClick={save}>✓ Save</button>
          </>
        ) : (
          <>
            <button className={`btn sm dm-edit${nudge ? " nudge" : ""}`} onClick={startEdit}>✎ Edit</button>
            <span className="spacer" />
          </>
        )}
      </div>

      {bars > 1 && (
        <div className="dm-tabrow">
          <span className="kb-label">Bar</span>
          {paged && <button className="btn sm dm-page" aria-label="Earlier bars" disabled={win.start === 0} onClick={() => { hold(); moveTo(turnPage(win, -1, bars)); }}>‹</button>}
          <div className="dm-bars" role="tablist" aria-label="Bars" ref={tabsRef}>
            {Array.from({ length: bars }, (_, i) => (
              <button key={i} role="tab" data-bar={i} aria-selected={i === shownBar} className={`${i === shownBar ? "on" : ""}${barHasHits(view, i) ? "" : " hollow"}${paged && inWindow(win, i) ? " inview" : ""}`} title={barHasHits(view, i) ? undefined : "Empty: plays nothing"} onClick={() => choose(i)}>{i + 1}</button>
            ))}
          </div>
          {paged && <button className="btn sm dm-page" aria-label="Later bars" disabled={win.start + win.count >= bars} onClick={() => { hold(); moveTo(turnPage(win, 1, bars)); }}>›</button>}
        </div>
      )}

      <div className={`beat-grid${editing ? "" : " locked"}${win.count > 1 ? " many" : ""}`} style={{ "--steps": beat.steps, "--count": win.count } as CSSProperties}>
        <div className="bg-labels">
          {win.count > 1 && <span className="bg-numpad" />}
          {DRUM_IDS.map((id) => (
            <button key={id} className={`bg-label d-${id}${panel === "sound" && sel === id ? " on" : ""}${muted(id) ? " muted" : ""}`} aria-pressed={panel === "sound" && sel === id} title={`${soundName(voiceOf(beat, id))}: tap to hear it and shape its sound`}
              onClick={() => { hit(id); setSel(id); setPanel("sound"); }}>{DRUM_LABEL[id]}</button>
          ))}
        </div>
        <div className="bg-steps" ref={stepsRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onClick={onKey}>
          {Array.from({ length: win.count }, (_, n) => {
            const b = win.start + n;
            return <DrumBar key={b} b={b} steps={beat.steps} div={beat.div} hits={DRUM_IDS.map((id) => view.rows[id]?.slice(b * beat.steps, (b + 1) * beat.steps) ?? "").join("|")} quiet={DRUM_IDS.filter(muted).join()} editing={editing} head={win.count > 1} sel={win.count > 1 && b === shownBar} named={bars > 1} />;
          })}
        </div>
      </div>

      <div className="dm-tabs">
        <button className={`chip${panel === "mix" ? " on" : ""}`} aria-expanded={panel === "mix"} onClick={() => setPanel(panel === "mix" ? null : "mix")}>Mixer</button>
        <button className={`chip${panel === "sound" ? " on" : ""}`} aria-expanded={panel === "sound"} onClick={() => setPanel(panel === "sound" ? null : "sound")}>Sound</button>
        <button className={`chip${panel === "fx" ? " on" : ""}`} aria-expanded={panel === "fx"} onClick={() => setPanel(panel === "fx" ? null : "fx")}>Effects</button>
      </div>

      {panel === "mix" && (
        <div className="dm-panel dm-mixer" role="group" aria-label="Drum mixer">
          {DRUM_IDS.map((id) => {
            const lv = soundOf(beat, id).level;
            const quiet = muted(id);
            return (
              <div key={id} className={`dm-strip d-${id}${quiet ? " quiet" : ""}`} role="group" aria-label={DRUM_LABEL[id]}>
                <span className="dm-val mono">{Math.round(lv * 100)}</span>
                <input type="range" className="dm-fader" min={0} max={1} step={0.01} value={lv} aria-label={`${DRUM_LABEL[id]} volume`}
                  onChange={(e) => setLevel(id, Number(e.target.value))} onDoubleClick={() => setLevel(id, defaultParams(id).level)}
                  onPointerUp={() => { if (!playing) hit(id); }} onKeyUp={() => { if (!playing) hit(id); }} />
                <span className="dm-ms">
                  <button className={`tv-ms${beat.mutes?.includes(id) ? " on" : ""}`} aria-pressed={!!beat.mutes?.includes(id)} aria-label={`Mute ${DRUM_LABEL[id]}`} onClick={() => toggleMute(id)}>M</button>
                  <button className={`tv-ms solo${solo === id ? " on" : ""}`} aria-pressed={solo === id} aria-label={`Solo ${DRUM_LABEL[id]}`} onClick={() => setSolo(solo === id ? null : id)}>S</button>
                </span>
                <button className="dm-strip-name" aria-label={`Hear the ${DRUM_LABEL[id].toLowerCase()}`} onClick={() => hit(id)}>{DRUM_LABEL[id]}</button>
              </div>
            );
          })}
          <div className="dm-strip kit" role="group" aria-label="Whole kit">
            <span className="dm-val mono">{Math.round(fx.level * 100)}</span>
            <input type="range" className="dm-fader" min={0} max={1} step={0.01} value={fx.level} aria-label="Whole kit volume" onChange={(e) => setFx({ level: Number(e.target.value) })} onDoubleClick={() => setFx({ level: FX_DEFAULTS.level })} />
            <span className="dm-ms" />
            <span className="dm-strip-name">Kit</span>
          </div>
        </div>
      )}

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
            {beat.div % 2 === 0 && <Knob label="Swing" title="Delays every second step" value={beat.swing} def={0} onChange={(v) => setFx({ swing: v })} />}
            <Knob label="Human" title="Looser timing and touch, like a player" value={fx.human} def={0} onChange={(v) => setFx({ human: v })} />
          </div>
          <div className="knobs">
            <Knob label="Saturation" title="The colour of analogue gear pushed hard: a little is warmth, a lot is distortion" value={fx.grit} def={FX_DEFAULTS.grit} onChange={(v) => setFx({ grit: v })} />
            <Choice label="Colour" value={fx.color} options={SAT_TYPES} onChange={(v) => { setFx({ color: v, grit: fx.grit || 0.5 }); if (!playing) hit("snare", { ...beat, color: v }); }} />
            {fx.grit > 0 && <Knob label="Blend" title="How much of the kit goes through the saturation. Half keeps the clean punch underneath." value={fx.blend} def={1} onChange={(v) => setFx({ blend: v })} />}
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
            <Knob label="Tape" title="Wobbly and dull, like an old cassette" value={fx.tape} def={0} onChange={(v) => setFx({ tape: v })} />
          </div>
          <div className="knobs">
            <Knob label="Tone" min={-1} max={1} value={fx.tone} def={0} fmt={toneText} onChange={(v) => setFx({ tone: v })} />
            <Knob label="Glue" title="Squashes the kit together" value={fx.glue} def={FX_DEFAULTS.glue} onChange={(v) => setFx({ glue: v })} />
            <Knob label="Pump" title="The harp ducks under every kick, then swells back" value={fx.pump} def={0} onChange={(v) => setFx({ pump: v })} />
          </div>
        </div>
      )}
    </section>
  );
});

/**
 * One bar of the grid: its number, a row of steps for every drum, and its own playhead.
 * It is drawn again only when its own hits change (or the grid is locked, unlocked or muted).
 */
const DrumBar = memo(function DrumBar({ b, steps, div, hits, quiet, editing, head, sel, named }: {
  b: number;
  steps: number;
  div: number;
  /** this bar's steps for each drum, in the order of DRUM_IDS, joined by "|" */
  hits: string;
  /** the muted drums, joined by "," */
  quiet: string;
  editing: boolean;
  /** the bar's number over it (when more than one bar is on screen) */
  head: boolean;
  sel: boolean;
  /** the squares say which bar they are in (when the section has more than one) */
  named: boolean;
}) {
  const rows = hits.split("|");
  const muted = quiet.split(",");
  return (
    <div className={`bg-bar${sel ? " sel" : ""}`} data-gbar={b}>
      {head && <button className="bg-num" data-pick={b} aria-pressed={sel} aria-label={`Bar ${b + 1}`}>{b + 1}</button>}
      <div className="bg-now" />
      {DRUM_IDS.map((id, r) => (
        <div key={id} className={`bg-row d-${id}${muted.includes(id) ? " muted" : ""}`}>
          {Array.from({ length: steps }, (_, k) => {
            const i = b * steps + k;
            const lv = (Number(rows[r]?.[k] ?? 0) || 0) as StepLevel;
            return (
              <button key={k} className={`bg-cell l${lv}${k % div === 0 ? " beat" : ""}`} data-d={id} data-i={i} aria-pressed={lv > 0} tabIndex={editing ? 0 : -1} aria-disabled={!editing}
                aria-label={`${DRUM_LABEL[id]} step ${k + 1}${named ? ` of bar ${b + 1}` : ""}${lv ? [" ", " soft", "", " loud"][lv] : " off"}`} />
            );
          })}
        </div>
      ))}
    </div>
  );
});

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
