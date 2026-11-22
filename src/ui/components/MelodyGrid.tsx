import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { playNote } from "../../audio/synth";
import { EMPTY_MELODY, GRIDS, GRID_LOW, TICKS, canShift, cellTick, clearMelody, copyMelodyBar, gridRows, melodyBars, melodyBase, melodyRows, notesInCell, setNoteLen, shiftOctave, toggleNote, type Melody, type MelodyRow } from "../../song/melody";
import { barAtBeat, barWindow, inWindow, pageStart, reveal, turnPage, type BarWindow, type BarsShown } from "../../song/window";
import { chordSymbol, refPcs } from "../../theory/chords";
import type { Key } from "../../theory/keys";
import { displayNote, mod12 } from "../../theory/notes";
import type { HarpSound } from "../../audio/rack";
import { SoundControls, type ToneProps } from "./HarpPanel";
import type { ProgChord } from "../state";
import { Seg } from "./common";
import { HarmonizeButton } from "./HarmonyPicker";
import { Overview } from "../plugins/melody/Overview";
import { centreTop, clampTop, octaveOf, octaveTop, openTop, rowAt, rowInView, spanOf, type Span } from "../plugins/melody/range";

/** The chord under one step: its notes, and its name where it comes in (null = no chord, or a rest). */
type Fit = { pcs: Set<number>; name: string } | null;

/** After a tap or a drag the view holds still this long, so it never moves under the pointer. */
const HOLD_MS = 1500;

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** Would the person rather things did not glide about? */
const still = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The melody: a grid of notes. Tap a square and that note plays at that moment.
 * Rows that belong to the key are lit; a dot marks the notes of the chord sounding underneath,
 * so a tune that sticks to lit rows and dots cannot sound wrong.
 * The grid has every bar of the section: a bar with notes in it plays, an empty bar is silent.
 * As many bars as are chosen sit side by side, each with its own steps, its number and its line.
 *
 * With `octaves` it is the wide grid of the Melody and Bass composer (plugins/melody): every row of that many
 * octaves, in a box that scrolls up and down under row names and bar numbers that stay put, with one row of tools
 * over it and a small overview of the whole range beside it. There a note can also be given a length, by dragging
 * its right end; every note can be moved an octave up or down; and the view jumps a whole octave at one press.
 */
export const MelodyGrid = memo(function MelodyGrid({ fresh, place, melody, setMelody: write, keyOf, bar, chords, playing, getPos, sound, setSound, onHear, shown, follow, active, inst, onHarmonize, canHarmonize, harmonizing, onAll, low, octaves, opens, name }: {
  /** the lowest row of the grid (a bass track's is two octaves under a melody's); none: two octaves from the home note */
  low?: number;
  /** the wide grid: this many octaves from `low` up (no `low`: from the lowest note a melody may hold) */
  octaves?: number;
  /** the wide grid: the notes in view when what is open has none of its own (a bass: E1 to E3). None: the two octaves from the home note */
  opens?: Span;
  /** the wide grid: what it is called ("Melody", "Bass") */
  name?: string;
  /** changes when another section or another melody track is shown, or something is pasted: undo starts afresh */
  fresh?: string;
  /** the melody track's instrument */
  inst?: ToneProps;
  /** changes when another section or idea is opened: the view goes back to bar 1 */
  place?: string;
  /** the section's melody, as long as the section */
  melody: Melody;
  /** `control`: a name for the gesture a change belongs to (one drag along a row is one step to undo) */
  setMelody: (fn: (m: Melody) => Melody, control?: string) => void;
  keyOf: Key;
  /** beats in a bar */
  bar: number;
  /** the chords under the melody, to mark the notes that fit them */
  chords: ProgChord[];
  playing: boolean;
  /** how many beats into the section the music is (null = stopped, or another section is sounding) */
  getPos: () => number | null;
  /** the melody's own harp in this section: its instrument and effects, apart from the chords'. None: the sound is set somewhere else (a track's sound window), and no sound controls are drawn here */
  sound?: HarpSound;
  /** copy the melody track's sound to the same track in every other section that has it */
  onAll?: () => void;
  setSound?: (patch: Partial<HarpSound>) => void;
  onHear?: () => void;
  /** bars on screen (0 = all of them) */
  shown: BarsShown;
  /** the view turns a page when the music runs off it */
  follow: boolean;
  /** the page is on screen (a hidden page does no work while the music plays) */
  active: boolean;
  /** open (or close) the sheet that writes a new track to go with a track of the song (shown when some track has music) */
  onHarmonize?: (el: HTMLElement | null) => void;
  canHarmonize?: boolean;
  harmonizing?: boolean;
}) {
  const wide = octaves !== undefined;
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
  // ... and only while the melody is as they left it: changed on another page (moved to another key,
  // fitted to another time signature), it is let go, so an undo never puts back notes from before that
  /** the notes this page's own edits wrote (whichever of them React keeps) */
  const mine = useRef(new WeakSet<object>());
  const setMelody = useCallback((fn: (m: Melody) => Melody, control?: string) => write((m) => {
    const r = fn(m);
    if (r.notes !== m.notes) mine.current.add(r.notes);
    return r;
  }, control), [write]);
  const seen = useRef(melody.notes);
  // another section, another idea: back to bar 1
  useEffect(() => {
    setStart(0);
    setSel(0);
  }, [place]);

  // the rows: two octaves from the home note (the wide grid: every octave it has), stretched to hold any note already written outside them
  const rowsOf = useCallback((k: Key, only: boolean) => (wide ? gridRows(k, low ?? GRID_LOW, octaves ?? 2, only) : low === undefined ? melodyRows(k, only) : gridRows(k, low, 2, only)), [wide, low, octaves]);
  const base = useMemo(() => rowsOf(keyOf, keyOnly), [rowsOf, keyOf, keyOnly]);
  const extra = useMemo(() => {
    const have = new Set(base.map((r) => r.midi));
    return [...new Set(melody.notes.map((n) => n.midi).filter((m) => !have.has(m)))].sort((a, b) => a - b).join();
  }, [base, melody.notes]);
  const rows = useMemo(() => {
    if (!extra) return base;
    const all = rowsOf(keyOf, false);
    const more = extra.split(",").map(Number).map((midi) => all.find((r) => r.midi === midi) ?? { ...all.find((r) => mod12(r.midi) === mod12(midi))!, midi });
    return [...base, ...more].sort((a, b) => b.midi - a.midi);
  }, [base, keyOf, extra, rowsOf]);

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
  // the wide grid draws a note as long as it is: bar by bar, each piece of each note as "step:note:squares:first-step:marks".
  // Marks: s, the note starts in this piece; e, it ends in it (a note held over a bar line goes on in the next bar); l, it has a length of its own
  const pieces = useMemo(() => {
    if (!wide) return null;
    const out: string[][] = Array.from({ length: bars }, () => []);
    for (const n of melody.notes) {
      const g = Math.floor(n.at / size);
      let b = Math.floor(g / steps);
      if (b < 0 || b >= bars) continue;
      let k = g - b * steps;
      let left = n.len === undefined ? 1 : Math.max(0.5, n.len / size);
      let first = true;
      while (left > 1e-6 && b < bars) {
        const w = Math.min(left, steps - k);
        left -= w;
        const last = left <= 1e-6 || b === bars - 1;
        out[b].push(`${k}:${n.midi}:${+w.toFixed(3)}:${g}:${first ? "s" : ""}${last ? "e" : ""}${n.len === undefined ? "" : "l"}`);
        first = false;
        b++;
        k = 0;
      }
    }
    return out.map((x) => [...new Set(x)].sort().join(" "));
  }, [wide, melody.notes, size, steps, bars]);

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

  const live = useRef({ bars, steps, bar, div: melody.div, win, follow, held: 0, gen: 0, moveTo, has: lit, m: melody });
  live.current = { ...live.current, bars, steps, bar, div: melody.div, win, follow, gen: live.current.gen + 1, moveTo, has: lit, m: melody };
  /** Someone is working here: Follow waits a moment before it turns the page. */
  const hold = () => {
    live.current.held = performance.now();
  };

  // ── the wide grid: which rows are in view ──
  const namesRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLElement>(null);
  /** what the view is worked out from, as it is this moment */
  const wl = useRef({ rows, notes: melody.notes, opens: opens ?? { low: melodyBase(keyOf), high: melodyBase(keyOf) + 24 } });
  wl.current = { rows, notes: melody.notes, opens: opens ?? { low: melodyBase(keyOf), high: melodyBase(keyOf) + 24 } };
  /**
   * Where the view stands: the first row in view (it may be part of a row) and how many fit; the note of that row;
   * the place a glide is on its way to; whether the view has still to be put where the notes are (the box had no
   * size yet); and whether the box was off the screen (its window closed) since it was last looked at.
   */
  const view = useRef({ top: 0, n: 1, midi: 60, kept: 0, goal: null as number | null, pending: true, zero: false, frame: 0 });
  /** how tall a row and what stands over the rows are, and how many rows fit under it (null: the box is not on screen) */
  const geom = useCallback(() => {
    const box = stepsRef.current;
    const labels = namesRef.current?.querySelectorAll<HTMLElement>("[data-m]");
    if (!box || !labels?.length || !box.clientHeight) return null;
    const pitch = labels.length > 1 ? labels[1].offsetTop - labels[0].offsetTop : labels[0].offsetHeight + 2;
    const head = labels[0].offsetTop;
    return pitch > 0 ? { pitch, head, inView: Math.max(1, (box.clientHeight - head) / pitch) } : null;
  }, []);
  /** Read where the view stands, and show it on the overview: the box round what is in view, and whether notes lie above or below it. */
  const sync = useCallback(() => {
    const box = stepsRef.current;
    const g = geom();
    if (!box || !g) return;
    const v = view.current;
    const { rows: rs, notes } = wl.current;
    v.top = box.scrollTop / g.pitch;
    v.n = g.inView;
    v.kept = box.scrollTop;
    v.midi = rs[clamp(Math.round(v.top), 0, rs.length - 1)]?.midi ?? v.midi;
    if (v.goal !== null && Math.abs(v.top - v.goal) < 0.05) v.goal = null;
    const el = viewRef.current;
    if (el && rs.length) {
      el.style.top = `${(v.top / rs.length) * 100}%`;
      el.style.height = `${(Math.min(v.n, rs.length) / rs.length) * 100}%`;
    }
    const span = spanOf(notes);
    railRef.current?.classList.toggle("above", !!span && rowAt(rs, span.high) + 0.5 < v.top);
    railRef.current?.classList.toggle("below", !!span && rowAt(rs, span.low) + 0.5 > v.top + v.n);
  }, [geom]);
  /** Put a row first in view: at once, or gliding there. */
  const goTop = useCallback((top: number, glide: boolean) => {
    const box = stepsRef.current;
    const g = geom();
    if (!box || !g) return;
    const t = clampTop(wl.current.rows, top, g.inView);
    const smooth = glide && !still();
    view.current.goal = smooth ? t : null;
    box.scrollTo({ top: t * g.pitch, behavior: smooth ? "smooth" : "auto" });
    if (!smooth) sync();
  }, [geom, sync]);
  /** The view a whole octave up or down: one press, twelve notes (pressed again while it glides, it goes on from where it is heading). */
  const jump = useCallback((dir: 1 | -1) => {
    const g = geom();
    if (!g) return;
    const v = view.current;
    goTop(octaveTop(wl.current.rows, v.goal ?? v.top, dir, g.inView), true);
  }, [geom, goTop]);
  /** A press on the overview: that place of the range in the middle of the view. */
  const goMap = useCallback((where: number, glide: boolean) => {
    const g = geom();
    if (g) goTop(centreTop(wl.current.rows, where * wl.current.rows.length, g.inView), glide);
  }, [geom, goTop]);
  /** The wheel turned over the overview: the rows scroll, as under the wheel in the grid. */
  const wheelBy = useCallback((dy: number) => {
    view.current.goal = null;
    stepsRef.current?.scrollBy({ top: dy });
  }, []);
  /** Put the view where the notes are (a clip with none: where its kind of track starts). False: the box is not on screen yet. */
  const placeView = useCallback(() => {
    const box = stepsRef.current;
    const g = geom();
    if (!box || !g) return false;
    const l = wl.current;
    box.scrollTop = openTop(l.rows, l.notes, l.opens, g.inView) * g.pitch;
    view.current.goal = null;
    sync();
    return true;
  }, [geom, sync]);
  /** A row brought wholly into view when some of it is not (a note just placed is never left half under the edge). */
  const showRow = (midi: number) => {
    const box = stepsRef.current;
    const g = geom();
    if (!box || !g) return;
    const y = rowAt(wl.current.rows, midi) * g.pitch;
    const h = box.clientHeight - g.head;
    if (y < box.scrollTop) box.scrollTop = y;
    else if (y + g.pitch - 2 > box.scrollTop + h) box.scrollTop = y + g.pitch - 2 - h;
  };
  // opened on something else: the view goes where its notes are
  useLayoutEffect(() => {
    if (wide) view.current.pending = !placeView();
  }, [wide, place, placeView]);
  // the box is given a size (its window is opened, or made larger): the view is put right once it can be
  useEffect(() => {
    const box = stepsRef.current;
    if (!wide || !box) return;
    const end = () => {
      view.current.goal = null;
    };
    box.addEventListener("scrollend", end);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const v = view.current;
      if (!box.clientHeight) {
        v.zero = true;
        return;
      }
      if (v.pending) v.pending = !placeView();
      else if (v.zero) box.scrollTop = v.kept;
      v.zero = false;
      sync();
    });
    ro?.observe(box);
    return () => {
      box.removeEventListener("scrollend", end);
      ro?.disconnect();
      cancelAnimationFrame(view.current.frame);
      view.current.frame = 0;
    };
  }, [wide, placeView, sync]);
  // other rows (the rows of the key only, or all of them again): the same note stays first in view
  const rowsWas = useRef(rows);
  useLayoutEffect(() => {
    if (rowsWas.current === rows) return;
    rowsWas.current = rows;
    const box = stepsRef.current;
    const g = wide ? geom() : null;
    if (!box || !g) return;
    box.scrollTop = rowAt(rows, view.current.midi) * g.pitch;
    sync();
  }, [wide, rows, geom, sync]);
  const onScroll = () => {
    const v = view.current;
    if (v.frame) return;
    v.frame = requestAnimationFrame(() => {
      v.frame = 0;
      sync();
    });
  };

  useEffect(() => {
    if (melody.notes === seen.current) return;
    seen.current = melody.notes;
    if (!mine.current.has(melody.notes)) {
      setPast([]);
      // the notes were changed somewhere else (pasted, written by Harmonize, undone): when none of them is in view any more, the view goes to them
      const v = view.current;
      if (wide && melody.notes.length && !melody.notes.some((n) => rowInView(wl.current.rows, n.midi, v.top, v.n))) placeView();
    }
    if (wide) sync();
  }, [melody.notes, wide, placeView, sync]);

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
    /** where the line's place is written: on the bar; in the wide grid on the line itself (a bar there holds many more rows) */
    const lineOf = (el: HTMLElement) => (wide ? el.querySelector<HTMLElement>(".mg-now") ?? el : el);
    const clear = () => {
      if (mark) lineOf(mark).style.setProperty("--now", "-1");
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
          lineOf(el).style.setProperty("--now", String(step));
          // the bars on screen may be wider than the screen (a phone): with Follow, keep the sounding one in sight
          if (l.follow && barChanged) {
            if (wide) showBar(box, el, namesRef.current);
            else if (el.offsetLeft < box.scrollLeft || el.offsetLeft + el.offsetWidth > box.scrollLeft + box.clientWidth + 1) box.scrollLeft = el.offsetLeft;
          }
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
  }, [playing, getPos, active, wide]);

  /** one press, and the drag that follows it, is one gesture: its changes are one step to undo */
  const gesture = useRef(0);
  const control = () => `notes:${gesture.current}`;
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
    }, control());
  const isLit = (b: number, k: number, midi: number) => (live.current.has[b] ?? "").split(" ").includes(`${k}.${midi}`);
  const tap = (b: number, k: number, midi: number) => {
    const adding = !isLit(b, k, midi);
    remember();
    put(b, k, midi, adding);
    setSel(b);
    if (adding && !playing) playNote(midi, undefined, 0.86, 48);
    if (wide) showRow(midi);
    return adding;
  };
  const undo = () => {
    const last = past[past.length - 1];
    if (!last) return;
    setPast((p) => p.slice(0, -1));
    setMelody(() => last);
  };
  /** Every note an octave up or down. The view goes with them, so they are where they were on screen. */
  const shift = (dir: 1 | -1) => {
    if (!melody.notes.length || !canShift(melody, 12 * dir)) return;
    hold();
    change((m) => shiftOctave(m, dir));
    jump(dir);
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
    gesture.current++;
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
    gesture.current++;
    const c = cellOf(e.target as HTMLElement);
    if (c) tap(c.b, c.k, c.midi);
  };

  // ── the wide grid's own handlers: its squares are not elements, so the square under the pointer is worked out ──
  /**
   * What is under a point of the wide grid: the bar, the step and the row; and, on a note, the square that note
   * starts in (a press anywhere on a long note is a press on the note).
   */
  const cellAt = (el: Element | null, x: number, y: number) => {
    const g = el?.closest<HTMLElement>("[data-gbar]");
    const body = g?.querySelector<HTMLElement>(".mel-rows");
    if (!el || !g || !body) return null;
    const r = body.getBoundingClientRect();
    if (y < r.top || y >= r.bottom || !r.width) return null;
    const l = live.current;
    const rs = wl.current.rows;
    const k = clamp(Math.floor((x - r.left) / ((r.width + 2) / l.steps)), 0, l.steps - 1);
    const b = Number(g.dataset.gbar);
    const note = el.closest<HTMLElement>(".mel-note");
    if (note) {
      const from = Number(note.dataset.g);
      return { b, k, midi: Number(note.dataset.m), b0: Math.floor(from / l.steps), k0: from % l.steps, on: true };
    }
    const row = rs[Math.floor((y - r.top) / ((r.height + 2) / Math.max(1, rs.length)))];
    return row ? { b, k, midi: row.midi, b0: b, k0: k, on: false } : null;
  };
  /** the step of the whole clip that is under a place across the screen (counted from its first bar), whatever row it is on */
  const stepAt = (x: number): number | null => {
    const l = live.current;
    let best: number | null = null;
    for (const g of stepsRef.current?.querySelectorAll<HTMLElement>("[data-gbar]") ?? []) {
      const r = g.getBoundingClientRect();
      const b = Number(g.dataset.gbar);
      if (x < r.left) return best ?? b * l.steps;
      best = b * l.steps + clamp(Math.floor((x - r.left) / ((r.width + 2) / l.steps)), 0, l.steps - 1);
      if (x < r.right) return best;
    }
    return best;
  };
  /** a note's right end being dragged: the note (by the square it starts in), the step the drag began on, and how long it has been made */
  const stretch = useRef<{ b: number; k: number; midi: number; from: number | null; cells: number | null; moved: boolean } | null>(null);
  /** the square the pointer is over is outlined, as a square of the plain grid is */
  const hovered = useRef<{ el: HTMLElement; key: string } | null>(null);
  const hover = (el: HTMLElement | null, c: { b: number; k: number; midi: number } | null) => {
    const mark = c && el ? el.closest<HTMLElement>("[data-gbar]")?.querySelector<HTMLElement>(".mel-hover") ?? null : null;
    const key = c ? `${c.b}:${c.k}:${c.midi}` : "";
    const was = hovered.current;
    if (was && was.el !== mark) was.el.classList.remove("on");
    if (!mark || !c) {
      hovered.current = null;
      return;
    }
    if (was?.el === mark && was.key === key) return;
    mark.style.setProperty("--k", String(c.k));
    mark.style.setProperty("--i", String(rowAt(wl.current.rows, c.midi)));
    mark.classList.add("on");
    hovered.current = { el: mark, key };
  };
  /** the square the keys act on (arrows move it, Enter puts a note there or takes it out): a step of the whole clip, and a note */
  const cursor = useRef<{ g: number; midi: number } | null>(null);
  const drawCursor = () => {
    const box = stepsRef.current;
    if (!box) return;
    box.querySelectorAll<HTMLElement>(".mel-cur.on").forEach((x) => x.classList.remove("on"));
    const c = cursor.current;
    if (!c) return;
    const l = live.current;
    const el = box.querySelector<HTMLElement>(`[data-gbar="${Math.floor(c.g / l.steps)}"] .mel-cur`);
    if (!el) return;
    el.style.setProperty("--k", String(c.g % l.steps));
    el.style.setProperty("--i", String(rowAt(wl.current.rows, c.midi)));
    el.classList.add("on");
  };
  // (after every draw: the bar it is in may have just come on screen)
  useLayoutEffect(() => {
    if (wide) drawCursor();
  });
  // another grid, another length, another clip: the square the keys act on starts afresh
  useEffect(() => {
    cursor.current = null;
  }, [melody.div, bars, place]);

  const wDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointer.current = e.pointerType;
    hold();
    // (whoever presses here has taken over: a glide on its way is no longer where the view is going)
    view.current.goal = null;
    if (cursor.current) {
      cursor.current = null;
      drawCursor();
    }
    // a finger may be scrolling: its tap is taken on click, once it is clearly a tap
    if (e.pointerType === "touch" || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("button")) {
      const num = t.closest<HTMLElement>("[data-pick]");
      if (num) choose(Number(num.dataset.pick));
      return;
    }
    const c = cellAt(t, e.clientX, e.clientY);
    if (!c) return;
    e.preventDefault();
    // the keys of the grid (an octave up or down, the arrows) go on working after a press in it
    e.currentTarget.focus({ preventScroll: true });
    gesture.current++;
    if (c.on && t.closest(".mel-grip")) stretch.current = { b: c.b0, k: c.k0, midi: c.midi, from: stepAt(e.clientX), cells: null, moved: false };
    else paint.current = { midi: c.midi, add: tap(c.b0, c.k0, c.midi), last: `${c.b0}:${c.k0}` };
    hover(null, null);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* (a pretend pointer) */
    }
  };
  const wMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = stretch.current;
    const p = paint.current;
    if (s) {
      hold();
      const to = stepAt(e.clientX);
      if (to === null || (!s.moved && to === s.from)) return;
      const l = live.current;
      const first = s.b * l.steps + s.k;
      const cells = clamp(to - first + 1, 1, l.bars * l.steps - first);
      if (!s.moved) remember();
      s.moved = true;
      if (cells === s.cells) return;
      s.cells = cells;
      setMelody((m) => setNoteLen(m, cellTick(m, bar, s.b, s.k), s.midi, Math.round((cells * TICKS) / m.div)), control());
      return;
    }
    if (p) {
      hold();
      const c = cellAt(document.elementFromPoint(e.clientX, e.clientY), e.clientX, e.clientY);
      if (!c || c.midi !== p.midi || `${c.b0}:${c.k0}` === p.last) return;
      p.last = `${c.b0}:${c.k0}`;
      put(c.b0, c.k0, c.midi, p.add);
      return;
    }
    if (e.pointerType === "touch") return;
    const t = e.target as HTMLElement;
    hover(t, t.closest("button") ? null : cellAt(t, e.clientX, e.clientY));
  };
  const wUp = () => {
    const s = stretch.current;
    stretch.current = null;
    paint.current = null;
    // its end pressed and let go where it was: a press on the note, which takes it out
    if (s && !s.moved) tap(s.b, s.k, s.midi);
  };
  const wCancel = () => {
    stretch.current = null;
    paint.current = null;
  };
  // a tap with a finger
  const wClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (pointer.current !== "touch") return;
    hold();
    const t = e.target as HTMLElement;
    if (t.closest("button")) {
      const num = t.closest<HTMLElement>("[data-pick]");
      if (num) choose(Number(num.dataset.pick));
      return;
    }
    gesture.current++;
    const c = cellAt(t, e.clientX, e.clientY);
    if (c) tap(c.b0, c.k0, c.midi);
  };
  // the keys: Page Up and Page Down move the view an octave, from anywhere in the composer; while the grid itself has
  // the focus the arrows move a square about, and Enter puts a note in it or takes it out
  const wKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const l = live.current;
    const rs = wl.current.rows;
    if (!rs.length) return;
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      e.stopPropagation();
      const dir = e.key === "PageUp" ? 1 : -1;
      if (cursor.current) {
        cursor.current = { g: cursor.current.g, midi: clamp(cursor.current.midi + 12 * dir, rs[rs.length - 1].midi, rs[0].midi) };
        drawCursor();
      }
      jump(dir);
      return;
    }
    if (!stepsRef.current?.contains(e.target as Node)) return;
    const by = e.key === "ArrowUp" ? [0, -1] : e.key === "ArrowDown" ? [0, 1] : e.key === "ArrowLeft" ? [-1, 0] : e.key === "ArrowRight" ? [1, 0] : null;
    if (!by && e.key !== "Enter") return;
    // (Enter on a row's name or a bar's number presses it)
    if (!by && (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    hold();
    view.current.goal = null;
    let c = cursor.current;
    if (!c) {
      // it starts in the chosen bar, on the row in the middle of the view
      const v = view.current;
      c = { g: at * l.steps, midi: rs[clamp(Math.round(v.top + v.n / 2 - 0.5), 0, rs.length - 1)].midi };
      cursor.current = c;
      if (by) return drawCursor();
    }
    if (by) {
      const g = clamp(c.g + by[0], 0, l.bars * l.steps - 1);
      const midi = rs[clamp(rowAt(rs, c.midi) + by[1], 0, rs.length - 1)].midi;
      cursor.current = { g, midi };
      const b = Math.floor(g / l.steps);
      if (b !== at) choose(b);
      showRow(midi);
      drawCursor();
      return;
    }
    gesture.current++;
    tap(Math.floor(c.g / l.steps), c.g % l.steps, c.midi);
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
    if (!box || !g) return;
    if (wide) showBar(box, g, namesRef.current);
    else if (g.offsetLeft < box.scrollLeft || g.offsetLeft + g.offsetWidth > box.scrollLeft + box.clientWidth + 1) box.scrollLeft = g.offsetLeft;
  }, [at, win.start, wide]);
  const on = melody.on !== false;
  const count = melody.notes.length;
  const many = win.count > 1;
  const shownBars = Array.from({ length: win.count }, (_, i) => win.start + i);

  const tabRow = (
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
  );
  const gridPick = (
    <span className="dm-grid">
      <span className="kb-label" title="How many steps there are to a beat">Grid</span>
      <Seg value={melody.div} options={GRIDS.map((g) => ({ value: g.value, label: g.label }))} onChange={(v) => setMelody((m) => ({ ...m, div: v }))} label="Steps to a beat" />
    </span>
  );
  const keyChip = <button className={`chip${keyOnly ? " on" : ""}`} aria-pressed={keyOnly} title="Show only the notes of the key" onClick={() => setKeyOnly(!keyOnly)}>Key only</button>;
  const undoButton = <button className="btn sm" aria-label="Undo" title="Undo" disabled={!past.length} onClick={undo}>↶</button>;
  const clearButton = <button className="btn sm" disabled={!lit[at]} title={`Empty bar ${at + 1}`} onClick={() => change((m) => clearMelody(m, bar, at))}>Clear</button>;

  // the composer of a plugin window: one row of tools, and under it the grid of every octave with its overview
  if (wide) {
    const called = name ?? "Melody";
    const first = spanOf(melody.notes) ?? wl.current.opens;
    return (
      <section className="mel" aria-label={called} style={{ "--steps": steps, "--div": melody.div, "--count": win.count } as CSSProperties} onKeyDown={wKey}>
        <div className="mel-tools">
          {canHarmonize && onHarmonize && <HarmonizeButton on={!!harmonizing} onClick={onHarmonize} />}
          {tabRow}
          {gridPick}
          {keyChip}
          <span className="mel-shift" role="group" aria-label="Move every note an octave">
            <span className="kb-label" title="Moves every note of what is open (the buttons beside the grid move only the view)">Move notes</span>
            <button className="btn sm" aria-label="Every note an octave down" title="Every note an octave down" disabled={!count || !canShift(melody, -12)} onClick={() => shift(-1)}>Octave ↓</button>
            <button className="btn sm" aria-label="Every note an octave up" title="Every note an octave up" disabled={!count || !canShift(melody, 12)} onClick={() => shift(1)}>Octave ↑</button>
          </span>
          {undoButton}
          {clearButton}
        </div>
        <div className="mel-main">
          <div className={`mel-box${many ? " many" : ""}`} ref={stepsRef} tabIndex={0} role="group" aria-label={`${called}: the notes. Page Up and Page Down show an octave higher or lower`}
            data-low={first.low} data-high={first.high}
            onScroll={onScroll} onPointerDown={wDown} onPointerMove={wMove} onPointerUp={wUp} onPointerCancel={wCancel} onPointerLeave={() => hover(null, null)} onClick={wClick}>
            <div className="mel-in">
              <div className="mel-names" ref={namesRef}>
                <span className="mel-head">
                  {many && <span className="mg-numpad" />}
                  {fits && <span className="mg-corner" />}
                </span>
                <RowNames rows={rows} />
              </div>
              <div className="mel-bars">
                {shownBars.map((b) => <WideBar key={b} b={b} rows={rows} steps={steps} notes={pieces?.[b] ?? ""} fits={fits?.[b] ?? null} head={many} sel={many && b === at} />)}
              </div>
            </div>
          </div>
          <Overview rows={rows} notes={melody.notes} ticks={bars * bar * TICKS} size={size} rootRef={railRef} viewRef={viewRef} onOctave={jump} onGo={goMap} onWheel={wheelBy} />
        </div>
      </section>
    );
  }

  return (
    <section className="card melody" aria-label="Melody">
      <div className="dm-head">
        {count > 0 && <button className={`chip${on ? " on" : ""}`} role="switch" aria-checked={on} title="Play the melody with the chords" onClick={() => setMelody((m) => ({ ...m, on: !on }))}>{on ? "On" : "Off"}</button>}
        {canHarmonize && onHarmonize && <HarmonizeButton on={!!harmonizing} onClick={onHarmonize} />}
        <span className="spacer" />
        {gridPick}
      </div>

      <div className="dm-bar">
        {tabRow}
        <span className="spacer" />
        {keyChip}
        {undoButton}
        {clearButton}
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
      {sound && setSound && onHear && <SoundControls sound={sound} setSound={setSound} onHear={onHear} inst={inst} onAll={onAll} />}
    </section>
  );
});

/** Bring a bar of the wide grid into sight sideways when some of it is not (the row names stand over the left of the box). */
function showBar(box: HTMLElement, el: HTMLElement, names: HTMLElement | null) {
  const pad = names ? names.offsetWidth + 6 : 0;
  const left = el.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
  if (left - pad < box.scrollLeft || left + el.offsetWidth > box.scrollLeft + box.clientWidth + 1) box.scrollLeft = left - pad;
}

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

/** The names of the wide grid's rows, each with its octave: a tap plays the note. Drawn again only when the rows change. */
const RowNames = memo(function RowNames({ rows }: { rows: MelodyRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <button key={r.midi} data-m={r.midi} className={`mg-label${r.inKey ? " in" : ""}${r.home ? " home" : ""}`} aria-label={`Hear ${displayNote(r.name)}${octaveOf(r.midi)}`} onClick={() => playNote(r.midi, undefined, 0.86, 48)}>{displayNote(r.name)}<small>{octaveOf(r.midi)}</small></button>
      ))}
    </>
  );
});

/** What does not change when a note does: a bar's stripes, one for every row, and the dots of the chords under it. */
const BarCells = memo(function BarCells({ rows, fits }: { rows: MelodyRow[]; fits: Fit[] | null }) {
  // the stretches of the bar under one chord, and for each the rows that are a note of it
  const dots = useMemo(() => {
    if (!fits) return null;
    const runs: { from: number; to: number; pcs: Set<number> }[] = [];
    let was = "";
    fits.forEach((f, k) => {
      const sig = f ? [...f.pcs].join() : "";
      if (sig && sig === was) runs[runs.length - 1].to = k + 1;
      else if (sig) runs.push({ from: k, to: k + 1, pcs: f!.pcs });
      was = sig;
    });
    return runs.flatMap((r) => rows.map((row, i) => (r.pcs.has(mod12(row.midi)) ? <i key={`${r.from}:${row.midi}`} className="mel-fit" style={{ "--k": r.from, "--n": r.to - r.from, "--i": i } as CSSProperties} /> : null)));
  }, [fits, rows]);
  return (
    <div className="mel-cells">
      {rows.map((r) => <i key={r.midi} className={`mel-row${r.inKey ? " in" : ""}${r.home ? " home" : ""}`} />)}
      {dots}
    </div>
  );
});

/**
 * One bar of the wide grid. With seven octaves a square for every step of every row would be thousands of
 * elements, so here a row is one stripe and the squares are cut out of the stripes by the look of the bar (see
 * plugins/melody/melody.css); only the notes are elements of their own, each as long as it is held. A dot marks the
 * squares that are notes of the chord sounding underneath, as in the plain grid. Drawn again only when its own notes
 * (or the rows, or the chords) change.
 */
const WideBar = memo(function WideBar({ b, rows, steps, notes, fits, head, sel }: {
  b: number;
  rows: MelodyRow[];
  steps: number;
  /** the notes drawn in this bar, piece by piece: "step:note:squares:first-step:marks" with spaces between (see `pieces`) */
  notes: string;
  fits: Fit[] | null;
  /** the bar's number over it (when more than one bar is on screen) */
  head: boolean;
  sel: boolean;
}) {
  const index = useMemo(() => new Map(rows.map((r, i) => [r.midi, i])), [rows]);
  const drawn = useMemo(() => (notes ? notes.split(" ") : []).map((x) => {
    const [k, midi, w, g, marks] = x.split(":");
    return { k: Number(k), midi: Number(midi), w: Number(w), g: Number(g), marks: marks ?? "", id: x };
  }), [notes]);
  return (
    <div className={`mg-bar mel-bar${sel ? " sel" : ""}`} data-gbar={b} role="group" aria-label={`Bar ${b + 1}`}>
      <div className="mel-head">
        {head && <button className="mg-num" data-pick={b} aria-pressed={sel} aria-label={`Bar ${b + 1}`}>{b + 1}</button>}
        {fits && <div className="mg-chords mel-chords" aria-hidden="true">{fits.map((f, k) => (f?.name ? <span key={k} style={{ gridColumn: k + 1 }}>{f.name}</span> : null))}</div>}
      </div>
      <div className="mel-rows">
        <BarCells rows={rows} fits={fits} />
        {drawn.map((n) => {
          const i = index.get(n.midi);
          if (i === undefined) return null;
          const row = rows[i];
          const starts = n.marks.includes("s");
          const ends = n.marks.includes("e");
          const fit = fits?.[n.k]?.pcs.has(mod12(n.midi));
          return (
            <i key={n.id} className={`mel-note${fit ? " fit" : ""}${starts ? "" : " from"}${ends ? "" : " on"}${n.marks.includes("l") ? " len" : ""}`} data-g={n.g} data-m={n.midi} role="button" aria-pressed="true"
              aria-label={`${displayNote(row.name)}${octaveOf(n.midi)}, bar ${Math.floor(n.g / steps) + 1}, step ${(n.g % steps) + 1}`} style={{ "--k": n.k, "--n": n.w, "--i": i } as CSSProperties}>
              {ends && <b className="mel-grip" title="Drag to make the note longer or shorter" />}
            </i>
          );
        })}
        <i className="mel-hover" />
        <i className="mel-cur" />
        <i className="mg-now" />
      </div>
    </div>
  );
});

export { EMPTY_MELODY };
