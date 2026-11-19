/**
 * Keys to play a piano or synth track by hand: one to three octaves (as many as fit the width),
 * ‹ › to move up and down, and the computer keyboard while the keys have focus (A W S E D F T G Y
 * H U J K, Z and X for the octave). Press lower on a key to play it harder. Sliding a finger or
 * the mouse along the keys plays each one it crosses.
 *
 * On the synth the notes are played its way (see synth/live.ts): held, latched for a drone, or
 * walked as an arpeggio. A piano's are held while the key is down, as on a piano.
 */
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { LiveKeys, type LiveOut } from "../../synth/live";
import { DEFAULT_PLAY, type PlaySettings } from "../../synth/params";
import { liveKeys } from "../../audio/synth";
import { onKeys, synthOf, type Tone } from "../../audio/tone";

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);
/** the computer keys, from C up: the home row for the white keys, the row above for the black ones */
const COMPUTER = "awsedftgyhujkolp;";
/** narrowest a white key may be (px), so a fingertip finds it */
const MIN_WHITE = 30;
const LOW = 24;
const HIGH = 96;
/** a piano's keys: each sounds while it is held */
const HELD: PlaySettings = { ...DEFAULT_PLAY, mode: "sustain" };

/** The lowest key shown: as asked, but low enough that the top one is no higher than HIGH, however many octaves fit. */
export const lowest = (base: number, octaves: number) => Math.max(LOW, Math.min(HIGH - 12 * octaves, base));

type Act = { kind: "shift"; dir: -1 | 1 } | { kind: "press" | "lift"; midi: number } | { kind: "eat" } | null;
/**
 * What a computer key does on the keys (null: nothing, it is left to the page). A key going up
 * always lets its note go, even with Ctrl held by then, or the note would be stuck sounding; a
 * key past the top one shown plays nothing, since nothing would light for it.
 */
export function computerKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean }, isDown: boolean, base: number, top: number): Act {
  const mod = e.ctrlKey || e.metaKey || e.altKey;
  const k = e.key.toLowerCase();
  if (k === "z" || k === "x") return mod ? null : isDown ? { kind: "shift", dir: k === "z" ? -1 : 1 } : { kind: "eat" };
  const i = COMPUTER.indexOf(k);
  if (i < 0) return null;
  if (!isDown) return { kind: "lift", midi: base + i };
  if (mod) return null;
  if (e.repeat || base + i > top) return { kind: "eat" };
  return { kind: "press", midi: base + i };
}

export function SynthKeys({ out, play = HELD, className }: { out: LiveOut; play?: PlaySettings; className?: string }) {
  const playRef = useRef(play);
  playRef.current = play;
  const live = useMemo(() => new LiveKeys(out, () => playRef.current), [out]);
  const [lit, setLit] = useState<number[]>([]);
  const [wish, setBase] = useState(48);
  const [octaves, setOctaves] = useState(2);
  // (more octaves fitting after a move up, a phone turned on its side, brings the keys down rather than past the top)
  const base = lowest(wish, octaves);
  const top = base + 12 * octaves;
  const box = useRef<HTMLDivElement>(null);
  /** which key each finger (pointer) is on */
  const fingers = useRef(new Map<number, number>());
  const show = () => setLit(live.keys);

  // as many octaves as fit
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setOctaves(Math.max(1, Math.min(3, Math.floor(el.clientWidth / (MIN_WHITE * 7)))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // an arpeggio needs its steps scheduled while keys are down
  useEffect(() => {
    if (!lit.length) return;
    const id = window.setInterval(() => live.tick(), 25);
    return () => window.clearInterval(id);
  }, [lit.length, live]);

  // a new way of playing (or leaving the page) lets every key go, latched ones too
  useEffect(() => {
    live.releaseAll();
    setLit([]);
  }, [play.mode, live]);
  useEffect(() => () => live.releaseAll(), [live]);
  // every sound stopped (the transport), or another page shown: the keys go up, so none stays lit over a silenced note
  useEffect(
    () =>
      out.onCut?.(() => {
        live.releaseAll();
        setLit([]);
      }),
    [out, live],
  );

  const press = (midi: number, vel = 0.8) => {
    live.press(midi, vel);
    show();
  };
  const lift = (midi: number) => {
    live.release(midi);
    show();
  };

  /** the key under a point, and how hard (lower on the key is harder) */
  const keyAt = (x: number, y: number): { midi: number; vel: number } | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const k = el?.closest<HTMLElement>("[data-midi]");
    if (!k || !box.current?.contains(k)) return null;
    const r = k.getBoundingClientRect();
    return { midi: Number(k.dataset.midi), vel: 0.4 + 0.55 * Math.max(0, Math.min(1, (y - r.top) / Math.max(1, r.height))) };
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    const k = keyAt(e.clientX, e.clientY);
    if (!k) return;
    e.preventDefault();
    // (held off above, focus is given by hand: the computer keyboard plays once the keys are touched)
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    fingers.current.set(e.pointerId, k.midi);
    press(k.midi, k.vel);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const was = fingers.current.get(e.pointerId);
    if (was === undefined) return;
    const k = keyAt(e.clientX, e.clientY);
    if (!k || k.midi === was) return;
    // a drone's keys latch: sliding across them would latch them all
    if (playRef.current.mode === "drone") return;
    fingers.current.set(e.pointerId, k.midi);
    lift(was);
    press(k.midi, k.vel);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const was = fingers.current.get(e.pointerId);
    fingers.current.delete(e.pointerId);
    if (was !== undefined) lift(was);
  };

  const shift = (dir: -1 | 1) => {
    live.releaseAll();
    setLit([]);
    setBase(lowest(base + 12 * dir, octaves));
  };
  const computer = (e: KeyboardEvent<HTMLDivElement>, isDown: boolean) => {
    const a = computerKey(e, isDown, base, top);
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    if (a.kind === "shift") shift(a.dir);
    else if (a.kind === "press") press(a.midi);
    else if (a.kind === "lift") lift(a.midi);
  };

  const whites: number[] = [];
  for (let m = base; m <= top; m++) if (!BLACK.has(m % 12)) whites.push(m);
  const wPct = 100 / whites.length;
  const on = new Set(lit);

  return (
    <div className={`syn-keys-row${className ? ` ${className}` : ""}`}>
      <button className="icon-btn" aria-label="Octave down" disabled={base <= LOW} onClick={() => shift(-1)}>‹</button>
      <div ref={box} className="syn-keys" role="group" aria-label="Keys" tabIndex={0}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onKeyDown={(e) => computer(e, true)} onKeyUp={(e) => computer(e, false)} onBlur={() => { if (playRef.current.mode !== "drone") { live.releaseAll(); setLit([]); } }}>
        {whites.map((m, i) => (
          <span key={m} data-midi={m} className={`syn-key white${on.has(m) ? " on" : ""}`} style={{ left: `${i * wPct}%`, width: `${wPct}%` }}>
            {m % 12 === 0 && <i>{`C${Math.floor(m / 12) - 1}`}</i>}
          </span>
        ))}
        {whites.map((m, i) => (BLACK.has((m + 1) % 12) && m + 1 <= top ? (
          <span key={m + 1} data-midi={m + 1} className={`syn-key black${on.has(m + 1) ? " on" : ""}`} style={{ left: `${(i + 1) * wPct - wPct * 0.31}%`, width: `${wPct * 0.62}%` }} title={NAMES[(m + 1) % 12]} />
        ) : null))}
      </div>
      <button className="icon-btn" aria-label="Octave up" disabled={top >= HIGH} onClick={() => shift(1)}>›</button>
    </div>
  );
}

/**
 * The keys of the track the pages edit, on a page with no instrument of its own (the Canvas, which
 * paints the notes as they sound): the chords track's when it is on the piano or the synth, else
 * the melody's. None when both are on the strings, which have no keys.
 */
export function TrackKeys({ chords, melody }: { chords: Tone; melody: Tone }) {
  const kind = onKeys(chords) ? "chord" : onKeys(melody) ? "melody" : null;
  const out = useMemo(() => (kind ? liveKeys(kind) : null), [kind]);
  if (!kind || !out) return null;
  const tone = kind === "chord" ? chords : melody;
  return tone.inst === "synth" ? <SynthKeys out={out} play={synthOf(tone, kind === "chord" ? "chords" : "melody").play} /> : <SynthKeys out={out} className="piano" />;
}
