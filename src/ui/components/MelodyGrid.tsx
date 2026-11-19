import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { playNote } from "../../audio/synth";
import { EMPTY_MELODY, GRIDS, TICKS, cellTick, clearMelody, copyMelodyBar, melodyBars, melodyRows, notesInCell, toggleNote, type Melody, type MelodyRow } from "../../song/melody";
import { barAtBeat, barWindow, inWindow, pageStart, reveal, turnPage, type BarWindow, type BarsShown } from "../../song/window";
import { chordSymbol, refPcs } from "../../theory/chords";
import type { Key } from "../../theory/keys";
import { displayNote, mod12 } from "../../theory/notes";
import type { HarpSound } from "../../audio/rack";
import { SoundControls, type Link, type ToneProps } from "./HarpPanel";
import type { ProgChord } from "../state";
import { Seg } from "./common";
import { HarmonizeButton } from "./HarmonyPicker";

/** The chord under one step: its notes, and its name where it comes in (null = no chord, or a rest). */
type Fit = { pcs: Set<number>; name: string } | null;

/** After a tap or a drag the view holds still this long, so it never moves under the pointer. */
const HOLD_MS = 1500;

/**
 * The melody: a grid of notes. Tap a square and that note plays at that moment.
 * Rows that belong to the key are lit; a dot marks the notes of the chord sounding underneath,
 * so a tune that sticks to lit rows and dots cannot sound wrong.
 * The grid has every bar of the section: a bar with notes in it plays, an empty bar is silent.
 * As many bars as are chosen sit side by side, each with its own steps, its number and its line.
 */
export const MelodyGrid = memo(function MelodyGrid({ fresh, place, melody, setMelody, keyOf, bar, chords, playing, getPos, sound, setSound, onHear, link, shown, follow, active, inst, onHarmonize, harmonizing }: {
  /** changes when another section or another melody track is shown, or something is pasted: undo starts afresh */
  fresh?: string;
  /** the melody track's instrument */
  inst?: ToneProps;
  /** changes when another section or idea is opened: the view goes back to bar 1 */
  place?: string;
  /** the section's melody, as long as the section */
  melody: Melody;
  setMelody: (fn: (m: Melody) => Melody) => void;
  keyOf: Key;
  /** beats in a bar */
  bar: number;
  /** the chords under the melody, to mark the notes that fit them */
  chords: ProgChord[];
  playing: boolean;
  /** how many beats into the section the music is (null = stopped, or another section is sounding) */
  getPos: () => number | null;
  /** the melody's own harp: its instrument and effects, apart from the chords' */
  sound: HarpSound;
  setSound: (patch: Partial<HarpSound>) => void;
  onHear: () => void;
  link?: Link;
  /** bars on screen (0 = all of them) */
  shown: BarsShown;
  /** the view turns a page when the music runs off it */
  follow: boolean;
  /** the page is on screen (a hidden page does no work while the music plays) */
  active: boolean;
  /** open (or close) the sheet that writes a new track to go with this melody */
  onHarmonize?: (el: HTMLElement | null) => void;
  harmonizing?: boolean;
}) {
  /** the first bar on screen, as last set; and the bar the bar tools act on */
  const [start, setStart] = useState(0);
  const [sel, setSel] = useState(0);
  const [keyOnly, setKeyOnly] = useState(false);
  const [past, setPast] = useState<Melody[]>([]);
  const stepsRef = useRef<HTMLDivElement>(null);
  const bars = melodyBars(melody);
  const at = Math.min(sel, bars - 1);
  const steps = Math.max(1, Math.round(bar * melody.div));
  // the window always holds the chosen bar: a change to the number of bars keeps it on screen
  const w0 = barWindow(bars, shown, start);
  const win: BarWindow = inWindow(w0, at) ? w0 : { start: pageStart(at, w0.count, bars), count: w0.count };
  const paged = win.count < bars;
  // undo only goes back through this section's own edits
  useEffect(() => setPast([]), [fresh]);
  // another section, another idea: back to bar 1
  useEffect(() => {
    setStart(0);
    setSel(0);
  }, [place]);

  // the rows: two octaves from the home note, stretched to hold any note already written outside them
  const extra = useMemo(() => {
    const have = new Set(melodyRows(keyOf, keyOnly).map((r) => r.midi));
    return [...new Set(melody.notes.map((n) => n.midi).filter((m) => !have.has(m)))].sort((a, b) => a - b).join();
  }, [keyOf, keyOnly, melody.notes]);
  const rows = useMemo(() => {
    const base = melodyRows(keyOf, keyOnly);
    if (!extra) return base;
    const all = melodyRows(keyOf);
    const more = extra.split(",").map(Number).map((midi) => all.find((r) => r.midi === midi) ?? { ...all.find((r) => mod12(r.midi) === mod12(midi))!, midi });
    return [...base, ...more].sort((a, b) => b.midi - a.midi);
  }, [keyOf, keyOnly, extra]);

  // the notes, bar by bar: what is lit in each bar, as one string, so a bar is only redrawn when its own notes change
  const size = TICKS / melody.div;
  const lit = useMemo(() => {
    const out: string[][] = Array.from({ length: bars }, () => []);
    for (const n of melody.notes) {
      const g = Math.floor(n.at / size);
      const b = Math.floor(g / steps);
      if (b >= 0 && b < bars) out[b].push(`${g - b * steps}.${n.midi}`);
    }
    return out.map((x) => [...new Set(x)].sort().join(" "));
  }, [melody.notes, size, steps, bars]);

  // which chord sounds at each step of every bar
  const fits = useMemo((): Fit[][] | null => {
    if (!chords.length) return null;
    return Array.from({ length: bars }, (_, b) => Array.from({ length: steps }, (_, k) => {
      let pos = b * bar + k / melody.div;
      for (const c of chords) {
        // the chord's name is written over the step where it comes in (a rest has no notes to fit)
        if (pos < c.beats - 1e-6) return c.rest ? null : { pcs: new Set(refPcs(c.ref)), name: pos < 1 / melody.div - 1e-6 ? chordSymbol(c.ref) : "" };
        pos -= c.beats;
      }
      return null;
    }));
  }, [chords, steps, bars, bar, melody.div]);

  /** the bar to bring into sight in the grid once it is drawn (after a bar is chosen or a page turned, never after a tap on a square) */
  const show = useRef<number | null>(null);
  /** Move the window; the chosen bar comes along when it would be left off screen. */
  const moveTo = (s: number) => {
    const w = barWindow(bars, shown, s);
    setStart(w.start);
    show.current = inWindow(w, at) ? at : w.start;
    if (!inWindow(w, at)) setSel(w.start);
  };
  /** Choose a bar (its tab or its number): it is brought on screen if it is not. */
  const choose = (b: number) => {
    hold();
    setSel(b);
    setStart(reveal(win, b, bars));
    show.current = b;
  };

  const live = useRef({ bars, steps, bar, div: melody.div, win, follow, held: 0, gen: 0, moveTo, has: lit });
  live.current = { ...live.current, bars, steps, bar, div: melody.div, win, follow, gen: live.current.gen + 1, moveTo, has: lit };
  /** Someone is working here: Follow waits a moment before it turns the page. */
  const hold = () => {
    live.current.held = performance.now();
  };

  // the moving line, on the bar that is sounding, without redrawing the grid on every frame.
  // With Follow on, a page is turned when the music runs off the end of the bars on screen.
  useEffect(() => {
    const box = stepsRef.current;
    if (!playing || !active || !box) return;
    let raf = 0;
    let key = "";
    let gen = -1;
    let mark: HTMLElement | null = null;
    let turned = -1;
    const tabs = () => tabsRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [];
    const clear = () => {
      mark?.style.setProperty("--now", "-1");
      mark?.classList.remove("sounding");
      mark = null;
    };
    const tick = () => {
      const pos = getPos();
      const l = live.current;
      let next = "";
      let b = -1;
      let step = -1;
      if (pos !== null) {
        b = barAtBeat(pos, l.bar, l.bars);
        const len = l.bars * l.bar;
        const inTune = ((pos % len) + len) % len;
        step = Math.max(0, Math.min(l.steps - 1, Math.floor((inTune - b * l.bar) * l.div + 1e-6)));
        next = `${b}:${step}`;
        if (l.follow && !inWindow(l.win, b) && turned !== b && performance.now() > l.held + HOLD_MS) {
          turned = b;
          l.moveTo(pageStart(b, l.win.count, l.bars));
        }
      }
      if (next !== key || gen !== l.gen) {
        const barChanged = next.split(":")[0] !== key.split(":")[0];
        key = next;
        gen = l.gen;
        const el = b >= 0 ? box.querySelector<HTMLElement>(`[data-gbar="${b}"]`) : null;
        if (el !== mark) clear();
        if (el) {
          mark = el;
          el.classList.add("sounding");
          el.style.setProperty("--now", String(step));
          // the bars on screen may be wider than the screen (a phone): with Follow, keep the sounding one in sight
          if (l.follow && barChanged && (el.offsetLeft < box.scrollLeft || el.offsetLeft + el.offsetWidth > box.scrollLeft + box.clientWidth + 1)) box.scrollLeft = el.offsetLeft;
        }
        // the tab of the bar that is sounding has a dot, on screen or not (set again after a redraw, which drops it)
        tabs().forEach((t, i) => t.classList.toggle("sounding", i === b));
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

  const remember = () => setPast((p) => [...p.slice(-49), melody]);
  const change = (fn: (m: Melody) => Melody) => {
    remember();
    setMelody(fn);
  };
  /** Put a note in a cell, or take it out: `add` says which, so a drag does the same all the way along. */
  const put = (b: number, k: number, midi: number, add: boolean) =>
    setMelody((m) => {
      const tick = cellTick(m, bar, b, k);
      return (notesInCell(m, tick, midi).length > 0) === add ? m : toggleNote(m, tick, midi);
    });
  const isLit = (b: number, k: number, midi: number) => (live.current.has[b] ?? "").split(" ").includes(`${k}.${midi}`);
  const tap = (b: number, k: number, midi: number) => {
    const adding = !isLit(b, k, midi);
    remember();
    put(b, k, midi, adding);
    setSel(b);
    if (adding && !playing) playNote(midi, undefined, 0.86, 48);
    return adding;
  };
  const undo = () => {
    const last = past[past.length - 1];
    if (!last) return;
    setPast((p) => p.slice(0, -1));
    setMelody(() => last);
  };

  // ── one set of handlers for every cell of every bar ──
  const cellOf = (el: Element | null) => {
    const c = el?.closest<HTMLElement>("[data-m]");
    const g = c?.closest<HTMLElement>("[data-gbar]");
    return c && g ? { b: Number(g.dataset.gbar), k: Number(c.dataset.k), midi: Number(c.dataset.m) } : null;
  };
  /** a drag with the mouse: along one row, adding (or taking out) as it goes, across bars too */
  const paint = useRef<{ midi: number; add: boolean; last: string } | null>(null);
  const pointer = useRef("mouse");
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointer.current = e.pointerType;
    hold();
    // a finger may be scrolling: its tap is taken on click, once it is clearly a tap
    if (e.pointerType === "touch" || e.button !== 0) return;
    const num = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
    if (num) return choose(Number(num.dataset.pick));
    const c = cellOf(e.target as HTMLElement);
    if (!c) return;
    e.preventDefault();
    paint.current = { midi: c.midi, add: tap(c.b, c.k, c.midi), last: `${c.b}:${c.k}` };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = paint.current;
    if (!p) return;
    hold();
    const c = cellOf(document.elementFromPoint(e.clientX, e.clientY));
    if (!c || c.midi !== p.midi || `${c.b}:${c.k}` === p.last) return;
    p.last = `${c.b}:${c.k}`;
    put(c.b, c.k, c.midi, p.add);
  };
  const onUp = () => {
    paint.current = null;
  };
  // a tap with a finger, or Enter / Space on a square
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.detail !== 0 && pointer.current !== "touch") return;
    hold();
    const num = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
    if (num) return choose(Number(num.dataset.pick));
    const c = cellOf(e.target as HTMLElement);
    if (c) tap(c.b, c.k, c.midi);
  };

  const tabsRef = useRef<HTMLDivElement>(null);
  // keep the chosen bar in view in its row of tabs, and in the grid (sideways only)
  useEffect(() => {
    const r = tabsRef.current;
    const el = r?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (r && el) {
      if (el.offsetLeft < r.scrollLeft) r.scrollLeft = el.offsetLeft - 8;
      else if (el.offsetLeft + el.offsetWidth > r.scrollLeft + r.clientWidth) r.scrollLeft = el.offsetLeft + el.offsetWidth - r.clientWidth + 8;
    }
    const box = stepsRef.current;
    const g = show.current === null ? null : box?.querySelector<HTMLElement>(`[data-gbar="${show.current}"]`);
    show.current = null;
    if (box && g && (g.offsetLeft < box.scrollLeft || g.offsetLeft + g.offsetWidth > box.scrollLeft + box.clientWidth + 1)) box.scrollLeft = g.offsetLeft;
  }, [at, win.start]);
  const on = melody.on !== false;
  const count = melody.notes.length;
  const many = win.count > 1;
  const shownBars = Array.from({ length: win.count }, (_, i) => win.start + i);

  return (
    <section className="card melody" aria-label="Melody">
      <div className="dm-head">
        {count > 0 && <button className={`chip${on ? " on" : ""}`} role="switch" aria-checked={on} title="Play the melody with the chords" onClick={() => setMelody((m) => ({ ...m, on: !on }))}>{on ? "On" : "Off"}</button>}
        {count > 0 && onHarmonize && <HarmonizeButton on={!!harmonizing} onClick={onHarmonize} title="A new track that goes with this melody" />}
        <span className="spacer" />
        <span className="dm-grid">
          <span className="kb-label" title="How many steps there are to a beat">Grid</span>
          <Seg value={melody.div} options={GRIDS.map((g) => ({ value: g.value, label: g.label }))} onChange={(v) => setMelody((m) => ({ ...m, div: v }))} label="Steps to a beat" />
        </span>
      </div>

      <div className="dm-bar">
        <div className="dm-tabrow">
          <span className="kb-label">Bar</span>
          {paged && <button className="btn sm dm-page" aria-label="Earlier bars" disabled={win.start === 0} onClick={() => { hold(); moveTo(turnPage(win, -1, bars)); }}>‹</button>}
          <div className="dm-bars" role="tablist" aria-label="Bar" ref={tabsRef}>
            {Array.from({ length: bars }, (_, b) => (
              <button key={b} role="tab" aria-selected={b === at} className={`${b === at ? "on" : ""}${lit[b] ? "" : " hollow"}${paged && inWindow(win, b) ? " inview" : ""}`} title={lit[b] ? undefined : "Empty: plays nothing"} onClick={() => choose(b)}>{b + 1}</button>
            ))}
          </div>
          {paged && <button className="btn sm dm-page" aria-label="Later bars" disabled={win.start + win.count >= bars} onClick={() => { hold(); moveTo(turnPage(win, 1, bars)); }}>›</button>}
          {bars > 1 && <button className="btn sm" title={at > 0 ? `Copy bar ${at} into bar ${at + 1}` : "Copy the bar before"} aria-label="Copy the bar before" disabled={at === 0} onClick={() => change((m) => copyMelodyBar(m, bar, at - 1, at))}>⧉</button>}
        </div>
        <span className="spacer" />
        <button className={`chip${keyOnly ? " on" : ""}`} aria-pressed={keyOnly} title="Show only the notes of the key" onClick={() => setKeyOnly(!keyOnly)}>Key only</button>
        <button className="btn sm" aria-label="Undo" title="Undo" disabled={!past.length} onClick={undo}>↶</button>
        <button className="btn sm" disabled={!lit[at]} title={`Empty bar ${at + 1}`} onClick={() => change((m) => clearMelody(m, bar, at))}>Clear</button>
      </div>

      <div className={`mg${many ? " many" : ""}`} style={{ "--steps": steps, "--div": melody.div, "--count": win.count } as CSSProperties}>
        <div className="mg-labels">
          {many && <span className="mg-label mg-corner mg-numpad" />}
          {fits && <span className="mg-label mg-corner" />}
          {rows.map((r) => (
            <button key={r.midi} className={`mg-label${r.inKey ? " in" : ""}${r.home ? " home" : ""}`} aria-label={`Hear ${displayNote(r.name)}`} onClick={() => playNote(r.midi, undefined, 0.86, 48)}>{displayNote(r.name)}</button>
          ))}
        </div>
        <div className="mg-steps" ref={stepsRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onClick={onClick}>
          {shownBars.map((b) => <MelodyBar key={b} b={b} rows={rows} steps={steps} div={melody.div} lit={lit[b] ?? ""} fits={fits?.[b] ?? null} head={many} sel={many && b === at} named={bars > 1} />)}
        </div>
      </div>
      <SoundControls sound={sound} setSound={setSound} onHear={onHear} link={link} inst={inst} />
    </section>
  );
});

/**
 * One bar of the grid: its number, the chords over it, a square for every step of every row, and
 * its own moving line. It is drawn again only when its own notes (or the rows, or the chords) change.
 */
const MelodyBar = memo(function MelodyBar({ b, rows, steps, div, lit, fits, head, sel, named }: {
  b: number;
  rows: MelodyRow[];
  steps: number;
  div: number;
  /** the lit squares, "step.midi" with spaces between */
  lit: string;
  fits: Fit[] | null;
  /** the bar's number over it (when more than one bar is on screen) */
  head: boolean;
  sel: boolean;
  /** the squares say which bar they are in (when the section has more than one) */
  named: boolean;
}) {
  const has = useMemo(() => new Set(lit ? lit.split(" ") : []), [lit]);
  return (
    <div className={`mg-bar${sel ? " sel" : ""}`} data-gbar={b} role="grid" aria-label={`Bar ${b + 1}`}>
      {head && <button className="mg-num" data-pick={b} aria-pressed={sel} aria-label={`Bar ${b + 1}`}>{b + 1}</button>}
      {fits && <div className="mg-row mg-chords" aria-hidden="true">{fits.map((f, k) => <span key={k}>{f?.name}</span>)}</div>}
      {rows.map((r) => (
        <div key={r.midi} className={`mg-row${r.inKey ? " in" : ""}${r.home ? " home" : ""}`} role="row">
          {Array.from({ length: steps }, (_, k) => {
            const on = has.has(`${k}.${r.midi}`);
            const fit = fits?.[k]?.pcs.has(mod12(r.midi));
            return <button key={k} role="gridcell" data-k={k} data-m={r.midi} aria-pressed={on} aria-label={`${displayNote(r.name)}, ${named ? `bar ${b + 1}, ` : ""}step ${k + 1}`} className={`mg-cell${on ? " on" : ""}${fit ? " fit" : ""}${k % div === 0 ? " beat" : ""}`} />;
          })}
        </div>
      ))}
      <i className="mg-now" />
    </div>
  );
});

export { EMPTY_MELODY };
