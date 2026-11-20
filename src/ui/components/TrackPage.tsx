import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { barsOf, heardAt, type Beat } from "../../audio/beats";
import type { DrumId } from "../../audio/drums";
import { MAX_DB, MIN_DB, audible, mixWith, type TrackId, type TrackMix } from "../../audio/mix";
export type { TrackId };
import { TICKS, hasTune, type Melody } from "../../song/melody";
import { inFrame } from "../../song/frame";
import { loopKeys, type LoopBars } from "../../song/loops";
import { selectBlock } from "../../song/structure";
import { clipBars, placedClips } from "../../song/clips";
import type { Take } from "../../song/takes";
import { KIND_NAME, addTrack, allTracks, drumsOf, focusTrack, isFirst, normalize, removeTrack, type Layers, type Track, type TrackKind } from "../../song/tracks";
import { chordSymbol } from "../../theory/chords";
import { analyzeChord } from "../../theory/keys";
import { showSection, shownCount, type BarsShown } from "../../song/window";
import { letterClass } from "../letters";
import { newId, useApp, type AppState, type Pane, type ProgChord } from "../state";
import { BarsControl } from "./BarsControl";
import { InstIcon } from "./HarpPanel";
import { toneOf } from "../../audio/tone";
import { HarmonyAgain, HarmonyPicker } from "./HarmonyPicker";

/** One section as the Track page draws it. */
export interface TrackSection {
  block: string;
  /** what the section is called, and its colour */
  label: string;
  color: number;
  bars: number;
  /** beats in a bar */
  bar: number;
  chords: ProgChord[];
  melody?: Melody;
  drums: Beat;
  /** what the added tracks hold in it */
  layers?: Layers;
}

/** The page that edits each kind of track. */
const PAGE: Record<TrackKind, Pane> = { chords: "rhythm", melody: "melody", drums: "drums", vocals: "vocals" };
const KINDS: TrackKind[] = ["chords", "melody", "drums", "vocals"];

/**
 * A plain track of `kind` added as `id`. You stay where you are; it is the one its page shows
 * next time (brought forward there), and a vocal track is the one the Vocals page shows (and records onto).
 */
export function trackAdded(s: AppState, kind: TrackKind, id: string): { s: AppState; track: Track } {
  const r = addTrack(s.progression, kind, id);
  const studio = kind === "vocals" ? { studio: { ...s.studio, vocal: id } } : {};
  return { s: { ...s, progression: r.p, ...studio }, track: r.track };
}

/** What one track holds in one section (an added drums track: its rhythm there on its own kit, as it plays). */
function content(t: Track, s: TrackSection): TrackSection {
  if (isFirst(t.id)) return s;
  const l = s.layers?.[t.id];
  return { ...s, chords: l?.chords ?? [], melody: l?.melody, drums: drumsOf(t, l) ?? { ...s.drums, on: false } };
}
/** Drum rows drawn top to bottom: cymbals, then the middle of the kit, then the kick. */
const LANES: { ids: DrumId[]; y: number }[] = [
  { ids: ["hat", "open", "shaker", "bell"], y: 0.2 },
  { ids: ["snare", "clap", "rim", "tom"], y: 0.5 },
  { ids: ["kick"], y: 0.82 },
];
/** The narrowest a bar is drawn: past this the song scrolls sideways instead. */
const MIN_BAR = 12;
/** How wide a bar is before the page has been measured (it is hidden until it is first opened). */
const GUESS_BAR = 56;

/**
 * The whole song on one page, left to right in bars: one row per instrument, one block per
 * section. What is written on the section pages shows here; a tap on a block opens that
 * section's page. Each track's head sets its volume, mute and solo for the whole song.
 * As many bars as are chosen fill the width (All: the whole song); the rest scrolls sideways.
 */
export const TrackPage = memo(function TrackPage({ sections, current, loop, layout, playing, getWhere, shown, follow, active }: {
  sections: TrackSection[];
  /** the section on screen */
  current: string;
  /** the bars that loop */
  loop: LoopBars;
  layout: { block: string; bars: number }[];
  playing: boolean;
  /** which section is sounding and how many beats into it (null = stopped) */
  getWhere: () => { block: string; beat: number } | null;
  /** bars on screen (0 = the whole song) */
  shown: BarsShown;
  /** with the music: the lanes turn a page when the playhead runs off them */
  follow: boolean;
  /** the page is on screen (a hidden page does no work while the music plays) */
  active: boolean;
}) {
  const { state, set, toast, recordingTo, opened } = useApp();
  const looped = useMemo(() => loopKeys(layout, loop), [layout, loop]);
  const mix = state.progression.mix;
  const tracks = useMemo(() => allTracks(normalize(state.progression)), [state.progression]);
  const [adding, setAdding] = useState(false);
  // a harmony track written again (its ⟳)
  const [again, setAgain] = useState<Track | null>(null);
  // it belongs to this page and this idea
  useEffect(() => setAgain(null), [state.ideaId, opened, active]);
  const lineRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // the lanes' width, measured: the bars on screen share it out
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // a hidden page measures 0: it keeps the width it had, and is measured again when it is shown
    const ro = new ResizeObserver(() => el.clientWidth > 0 && setRoom(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const totalBars = sections.reduce((a, s) => a + s.bars, 0);
  const count = shownCount(shown, totalBars);
  const bw = room > 0 ? Math.max(MIN_BAR, room / count) : GUESS_BAR;
  // when the bars get wider or narrower, the bar at the left edge stays at the left edge
  const leftBar = useRef(0);
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (sc) sc.scrollLeft = leftBar.current * bw;
  }, [bw]);
  // where each section starts, in pixels
  const starts = useMemo(() => {
    const out: Record<string, number> = {};
    let x = 0;
    for (const s of sections) {
      out[s.block || "a"] = x;
      x += s.bars * bw;
    }
    return { at: out, width: x };
  }, [sections, bw]);
  // the melody's notes across the whole song, so every block draws them on the same scale
  const range = useMemo(() => {
    const all = sections.flatMap((s) => [s.melody, ...Object.values(s.layers ?? {}).map((l) => l.melody)].flatMap((m) => m?.notes.map((n) => n.midi) ?? []));
    return all.length ? { lo: Math.min(...all) - 1, hi: Math.max(...all) + 1 } : { lo: 55, hi: 79 };
  }, [sections]);

  // the playhead, moved every frame without redrawing the page. With Follow on, the lanes turn a
  // whole page (the bars on screen) when it runs off them; with Follow off they never move on their own.
  useEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    if (!playing || !active) { el.style.display = "none"; return; }
    let raf = 0;
    const tick = () => {
      const w = getWhere();
      const s = w && sections.find((x) => x.block === w.block);
      if (w && s) {
        const x = (starts.at[s.block || "a"] ?? 0) + Math.min(s.bars, w.beat / s.bar) * bw;
        el.style.display = "block";
        el.style.transform = `translateX(${x}px)`;
        const sc = scrollRef.current;
        if (follow && sc && (x < sc.scrollLeft || x >= sc.scrollLeft + sc.clientWidth - 1)) {
          const page = Math.max(1, Math.floor(sc.clientWidth / bw + 1e-6)) * bw;
          sc.scrollLeft = Math.floor(x / page) * page;
        }
      } else el.style.display = "none";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, active, follow, getWhere, sections, starts, bw]);
  // The section on screen is brought into view if it is off to one side: when it is chosen (here
  // or on another page) and whenever the page is opened, so what was just written on another page
  // (a track added there, its chords or notes) is what the page shows.
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    const x = starts.at[current || "a"];
    const sec = sections.find((s) => (s.block || "a") === (current || "a"));
    if (!active || !sc || x === undefined || !sec || !sc.clientWidth) return;
    // (the first time the page is shown, or after the window was resized while it was hidden, its
    // bars are not measured yet: they are measured now, before anything is painted, and the lanes
    // are moved once they are drawn that wide. Moving them while they are still drawn with the old
    // width would be cut short at their old end, and the bar it stopped at would be kept.)
    const w = sc.clientWidth;
    const real = Math.max(MIN_BAR, w / count);
    const left = sc.scrollLeft / bw;
    // (while the music plays the lanes turn a page at a time: a section is only gone to when its
    // start is off screen, so the lanes do not jump at every section as well)
    const to = showSection(left, w / real, x / bw, playing ? Infinity : sec.bars);
    if (Math.abs(real - bw) > 1e-6) {
      leftBar.current = to;
      setRoom(w);
    } else if (to !== left) {
      sc.scrollLeft = to * bw;
      leftBar.current = to;
    }
  }, [current, active]); // eslint-disable-line react-hooks/exhaustive-deps
  // a track added since the page was last open (on the Chords, Melody, Drums or Vocals page) is
  // brought into view too, and lit for a moment, so it is seen at once
  // (another idea opened is not a track added: its tracks are just the ones it has)
  const seen = useRef<{ idea: string | null | undefined; ids: Set<string> } | null>(null);
  seen.current ??= { idea: state.ideaId, ids: new Set(tracks.map((t) => t.id)) };
  const [fresh, setFresh] = useState<string[]>([]);
  useLayoutEffect(() => {
    if (!active) return;
    const before = seen.current;
    seen.current = { idea: state.ideaId, ids: new Set(tracks.map((t) => t.id)) };
    const added = before && before.idea === state.ideaId ? tracks.filter((t) => !before.ids.has(t.id)).map((t) => t.id) : [];
    if (!added.length) return;
    setFresh(added);
    const head = scrollRef.current?.closest(".tv")?.querySelector<HTMLElement>(`.tv-head[data-track="${CSS.escape(added[added.length - 1])}"]`);
    const r = head?.getBoundingClientRect();
    if (head && r && (r.bottom > window.innerHeight || r.top < 0)) head.scrollIntoView({ block: "nearest" });
  }, [active, tracks]);
  useEffect(() => {
    if (!fresh.length) return;
    const t = window.setTimeout(() => setFresh([]), 1600);
    return () => window.clearTimeout(t);
  }, [fresh]);

  const setTrack = (id: TrackId, patch: Partial<TrackMix>) => set((s) => ({ ...s, progression: { ...s.progression, mix: mixWith(s.progression.mix, id, patch) } }));
  /** Open a track's page on a section, with that track ready to edit. */
  const open = (block: string, t: Track) =>
    set((s) => {
      const p = block ? selectBlock(s.progression, block) : s.progression;
      if (t.kind === "vocals") return { ...s, pane: "vocals", progression: p, studio: { ...s.studio, vocal: t.id } };
      return { ...s, pane: PAGE[t.kind], progression: focusTrack(p, t.kind, t.id) };
    });
  /** A plain new track of a kind, at once: its row lights up here, and its page opens on it next time. */
  const add = (kind: TrackKind) => {
    const tid = newId();
    set((s) => trackAdded(s, kind, tid).s);
    setAdding(false);
  };
  const remove = (t: Track) => {
    // (a recording going onto it would have nowhere to go)
    if (t.id === recordingTo) return toast("Stop recording first");
    if (!window.confirm(`Remove ${t.name} and everything on it, in every section?`)) return;
    set((s) => ({ ...s, progression: removeTrack(s.progression, t.id) }));
  };
  const choose = (block: string) => block && set((s) => ({ ...s, progression: selectBlock(s.progression, block) }));
  // bar numbers: every bar while there is room for them, else every second, fourth or eighth
  const every = bw >= 40 ? 1 : bw >= 20 ? 2 : bw >= 10 ? 4 : 8;

  return (
    <section className="card track-page" aria-label="Track view: the whole song">
      <div className="dm-head">
        <span className="pill">{totalBars} bars</span>
        <span className="spacer" />
        <BarsControl />
      </div>
      <div className="tv">
        <div className="tv-heads">
          <div className="tv-corner" />
          {tracks.map((t) => {
            const m = mix?.[t.id];
            const on = audible(mix, t.id);
            const db = m?.db ?? 0;
            return (
              <div key={t.id} data-track={t.id} className={`tv-head k-${t.kind}${on ? "" : " quiet"}${t.harmony ? " hz" : ""}${fresh.includes(t.id) ? " fresh" : ""}`} role="group" aria-label={`${t.name} track`}>
                {/* one line: what plays it, its name (a long one is cut short), and ✕ for an added track */}
                <button className="tv-name" title={`Open ${t.name} for the section on screen`} onClick={() => open(current, t)}>
                  {(t.kind === "chords" || t.kind === "melody") && <InstIcon inst={toneOf(state.progression, t.id).inst} />}
                  <span className="tv-label">{t.name}</span>
                  {!isFirst(t.id) && <span className="tv-x" role="button" aria-label={`Remove ${t.name}`} title="Remove this track" onClick={(e) => { e.stopPropagation(); remove(t); }}>✕</span>}
                </button>
                {/* ⟳ beside the volume, so the name keeps the room */}
                {t.harmony && (t.kind === "chords" || t.kind === "melody") && <HarmonyAgain track={t} className="tv-hz" onOpen={() => setAgain(t)} />}
                <span className="tv-btns">
                  <button className={`tv-ms${m?.mute ? " on" : ""}`} aria-pressed={!!m?.mute} aria-label={`Mute ${t.name}`} title="Mute in every section" onClick={() => setTrack(t.id, { mute: !m?.mute })}>M</button>
                  <button className={`tv-ms solo${m?.solo ? " on" : ""}`} aria-pressed={!!m?.solo} aria-label={`Solo ${t.name}`} title="Hear only the soloed tracks" onClick={() => setTrack(t.id, { solo: !m?.solo })}>S</button>
                </span>
                <input type="range" className="tv-vol" min={MIN_DB} max={MAX_DB} step={0.5} value={db} aria-label={`${t.name} volume, every section`} onChange={(e) => setTrack(t.id, { db: Number(e.target.value) })} onDoubleClick={() => setTrack(t.id, { db: 0 })} />
                <span className="tv-db mono">{db <= MIN_DB ? "−∞" : `${db > 0 ? "+" : ""}${db.toFixed(1)}`}</span>
              </div>
            );
          })}
          <div className="tv-add">
            {adding ? (
              <span className="tv-kinds" role="group" aria-label="What kind of track">
                {KINDS.map((k) => <button key={k} className="chip" onClick={() => add(k)}>{k === "vocals" ? "Vocals" : KIND_NAME[k]}</button>)}
                <button className="chip" aria-label="Cancel" onClick={() => setAdding(false)}>✕</button>
              </span>
            ) : <button className="btn sm tv-plus" aria-label="Add a track" title="Add a track" onClick={() => setAdding(true)}>+</button>}
          </div>
        </div>
        <div className="tv-scroll" ref={scrollRef} onScroll={(e) => { leftBar.current = e.currentTarget.scrollLeft / bw; }}>
          <div className="tv-lanes" style={{ width: starts.width }}>
            <div className="tv-row tv-ruler">
              {sections.map((s) => (
                <div key={s.block || "a"} className={`tv-sec ${letterClass(s.color)}${s.block === current ? " on" : ""}`} style={{ width: s.bars * bw }}>
                  <button className="tv-letter" aria-pressed={s.block === current} aria-label={`Section ${s.label}`} title={s.label} style={{ maxWidth: s.bars * bw - 6 }} onClick={() => choose(s.block)}>{s.label}</button>
                  <span className={`tv-bars${bw < 40 ? " tight" : ""}`} aria-hidden="true">
                    {Array.from({ length: s.bars }, (_, k) => <i key={k} className={looped.has(`${s.block}:${k}`) ? "in" : ""} style={{ width: bw }}>{k % every === 0 && (k > 0 || bw >= 40) ? k + 1 : ""}</i>)}
                  </span>
                </div>
              ))}
            </div>
            {tracks.map((t) => {
              // where the vocal track's clips play, section by section
              const laid = t.kind === "vocals" ? clipBars(sections.map((s) => ({ block: s.block, bar: s.bar, beats: s.bars * s.bar })), placedClips(t), state.progression.bpm) : {};
              return (
              <div key={t.id} className={`tv-row k-${t.kind}${audible(mix, t.id) ? "" : " quiet"}${fresh.includes(t.id) ? " fresh" : ""}`}>
                {sections.map((s0) => {
                  const s = content(t, s0);
                  return (
                    <button key={s.block || "a"} className={`tv-block ${letterClass(s.color)}${s.block === current ? " on" : ""}`} style={{ width: s.bars * bw }}
                      aria-label={`${t.name} of section ${s.label}: open`} onClick={() => open(s.block, t)}>
                      {t.kind === "chords" ? <ChordBlock s={s} bw={bw} /> : t.kind === "melody" ? <MelodyBlock s={s} bw={bw} range={range} /> : t.kind === "drums" ? <DrumBlock s={s} bw={bw} /> : <TakeBlock t={t} s={s} bw={bw} laid={laid} />}
                    </button>
                  );
                })}
              </div>
              );
            })}
            <div className="tv-row tv-row-add" />
            <div className="tv-line" ref={lineRef} />
          </div>
        </div>
      </div>
      {again && <HarmonyPicker key={again.id} kind={again.kind === "melody" ? "melody" : "chords"} track={again} onClose={() => setAgain(null)} />}
    </section>
  );
});

function ChordBlock({ s, bw }: { s: TrackSection; bw: number }) {
  const { state } = useApp();
  const items = inFrame(s.chords, s.bars * s.bar);
  if (!items.some((x) => !x.item.rest)) return <span className="tv-empty">—</span>;
  return (
    <span className="tv-chords">
      {items.map(({ item: c }, i) => (
        <span key={i} className={`tv-chord${c.rest ? " rest" : ` st-${analyzeChord(c.ref, state.key).status}`}`} style={{ width: (c.beats / s.bar) * bw }}>{c.rest || bw * (c.beats / s.bar) < 22 ? "" : chordSymbol(c.ref)}</span>
      ))}
    </span>
  );
}

function MelodyBlock({ s, bw, range }: { s: TrackSection; bw: number; range: { lo: number; hi: number } }) {
  const m = s.melody;
  if (!m?.notes.length) return <span className="tv-empty">—</span>;
  const w = s.bars * bw;
  const end = s.bars * s.bar * TICKS;
  const step = TICKS / m.div;
  const y = (midi: number) => 4 + (1 - (midi - range.lo) / Math.max(1, range.hi - range.lo)) * 36;
  return (
    <svg className={`tv-svg${hasTune(m) ? "" : " off"}`} width={w} height={44} aria-hidden="true">
      {m.notes.filter((n) => n.at < end).map((n, i) => <rect key={i} x={(n.at / TICKS / s.bar) * bw} y={y(n.midi) - 2} width={Math.max(2, (step / TICKS / s.bar) * bw - 1)} height={4} rx={1.5} />)}
    </svg>
  );
}

function DrumBlock({ s, bw }: { s: TrackSection; bw: number }) {
  const d = s.drums;
  if (!d.on) return <span className="tv-empty">off</span>;
  const per = barsOf(d);
  const w = s.bars * bw;
  const marks: { x: number; y: number; o: number }[] = [];
  for (let k = 0; k < s.bars; k++) {
    const pb = k % per;
    for (let i = 0; i < d.steps; i++)
      for (const lane of LANES) {
        // (a drum muted in the kit is not heard, so it is not drawn)
        const lv = Math.max(...lane.ids.map((id) => heardAt(d, id, pb * d.steps + i)));
        if (lv) marks.push({ x: k * bw + (i / d.steps) * bw, y: lane.y * 44, o: 0.35 + lv * 0.22 });
      }
  }
  return (
    <svg className="tv-svg drums" width={w} height={44} aria-hidden="true">
      {marks.map((m, i) => <rect key={i} x={m.x} y={m.y - 3} width={Math.max(1.5, bw / d.steps - 1)} height={6} rx={1} opacity={m.o} />)}
    </svg>
  );
}


/** A vocal track's clips in a section: each part that plays there, where it plays and as long as it lasts, as edited on the Vocals lane (one running on from an earlier section shows its part here). */
function TakeBlock({ t, s, bw, laid }: { t: Track; s: TrackSection; bw: number; laid: ReturnType<typeof clipBars<Take>> }) {
  const spans = (laid[s.block] ?? []).map(({ clip, take, x, w }) => ({ id: clip.id, n: take.n, x: x * bw, w: Math.max(4, w * bw) }));
  if (!spans.length) return <span className="tv-empty">{t.takes?.length ? "" : "No takes yet"}</span>;
  return (
    <span className="tv-takes">
      {spans.map((x) => <span key={x.id} className="tv-take" style={{ left: x.x, width: x.w }} title={`Take ${x.n}`}>{x.w > 44 ? `Take ${x.n}` : x.n}</span>)}
    </span>
  );
}
