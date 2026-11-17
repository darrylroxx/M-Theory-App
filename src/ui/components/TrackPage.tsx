import { useEffect, useMemo, useRef, useState } from "react";
import { barsOf, levelAt, type Beat } from "../../audio/beats";
import type { DrumId } from "../../audio/drums";
import { MAX_DB, MIN_DB, audible, type Mix, type TrackId, type TrackMix } from "../../audio/mix";
export type { TrackId };
import { TICKS, hasTune, type Melody } from "../../song/melody";
import { inFrame, inLoop, type LoopSpan } from "../../song/frame";
import { selectBlock } from "../../song/structure";
import { KIND_NAME, addTrack, allTracks, focusTrack, isFirst, normalize, removeTrack, type Layers, type Track, type TrackKind } from "../../song/tracks";
import { chordSymbol } from "../../theory/chords";
import { analyzeChord } from "../../theory/keys";
import { letterClass } from "../letters";
import { newId, useApp, type Pane, type ProgChord } from "../state";

/** One section as the Track page draws it. */
export interface TrackSection {
  block: string;
  letter: string;
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

/** What one track holds in one section. */
function content(t: Track, s: TrackSection): TrackSection {
  if (isFirst(t.id)) return s;
  const l = s.layers?.[t.id];
  return { ...s, chords: l?.chords ?? [], melody: l?.melody, drums: l?.beat ?? { ...s.drums, on: false } };
}
/** Drum rows drawn top to bottom: cymbals, then the middle of the kit, then the kick. */
const LANES: { ids: DrumId[]; y: number }[] = [
  { ids: ["hat", "open", "shaker", "bell"], y: 0.2 },
  { ids: ["snare", "clap", "rim", "tom"], y: 0.5 },
  { ids: ["kick"], y: 0.82 },
];
const ZOOMS = [28, 40, 56, 80, 112];

/**
 * The whole song on one page, left to right in bars: one row per instrument, one block per
 * section. What is written on the section pages shows here; a tap on a block opens that
 * section's page. Each track's head sets its volume, mute and solo for the whole song.
 */
export function TrackPage({ sections, current, loop, layout, playing, getWhere }: {
  sections: TrackSection[];
  /** the section on screen */
  current: string;
  loop: LoopSpan | null;
  layout: { block: string; bars: number }[];
  playing: boolean;
  /** which section is sounding and how many beats into it (null = stopped) */
  getWhere: () => { block: string; beat: number } | null;
}) {
  const { state, set, toast } = useApp();
  const mix = state.progression.mix;
  const tracks = useMemo(() => allTracks(normalize(state.progression)), [state.progression]);
  const [adding, setAdding] = useState(false);
  const [zoom, setZoom] = useState(2);
  const bw = ZOOMS[zoom];
  const lineRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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

  // the playhead, moved every frame without redrawing the page
  useEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    if (!playing) { el.style.display = "none"; return; }
    let raf = 0;
    const tick = () => {
      const w = getWhere();
      const s = w && sections.find((x) => x.block === w.block);
      if (w && s) {
        const x = (starts.at[s.block || "a"] ?? 0) + Math.min(s.bars, w.beat / s.bar) * bw;
        el.style.display = "block";
        el.style.transform = `translateX(${x}px)`;
        // keep the playhead in view
        const sc = scrollRef.current;
        if (sc && (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 24)) sc.scrollLeft = Math.max(0, x - 24);
      } else el.style.display = "none";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, getWhere, sections, starts, bw]);

  const setTrack = (id: TrackId, patch: Partial<TrackMix>) =>
    set((s) => {
      const t: TrackMix = { ...s.progression.mix?.[id], ...patch };
      const next: Mix = { ...s.progression.mix, [id]: t };
      return { ...s, progression: { ...s.progression, mix: next } };
    });
  /** Open a track's page on a section, with that track ready to edit. */
  const open = (block: string, t: Track) =>
    set((s) => {
      const p = block ? selectBlock(s.progression, block) : s.progression;
      return { ...s, pane: PAGE[t.kind], progression: t.kind === "vocals" ? p : focusTrack(p, t.kind, t.id) };
    });
  const add = (kind: TrackKind) => {
    const tid = newId();
    let name = "";
    set((s) => {
      const r = addTrack(s.progression, kind, tid);
      name = r.track.name;
      return { ...s, pane: PAGE[kind], progression: r.p };
    });
    setAdding(false);
    queueMicrotask(() => name && toast(`${name} added`));
  };
  const remove = (t: Track) => {
    if (!window.confirm(`Remove ${t.name} and everything on it, in every section?`)) return;
    set((s) => ({ ...s, progression: removeTrack(s.progression, t.id) }));
  };
  const choose = (block: string) => block && set((s) => ({ ...s, progression: selectBlock(s.progression, block) }));
  const totalBars = sections.reduce((a, s) => a + s.bars, 0);

  return (
    <section className="card track-page" aria-label="Track view: the whole song">
      <div className="dm-head">
        <h2>Track</h2>
        <span className="pill">{totalBars} bars · {sections.length} section{sections.length === 1 ? "" : "s"}</span>
        <span className="spacer" />
        <span className="kb-label">Zoom</span>
        <button className="btn sm" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}>−</button>
        <button className="btn sm" aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)}>+</button>
      </div>
      <div className="tv">
        <div className="tv-heads">
          <div className="tv-corner" />
          {tracks.map((t) => {
            const m = mix?.[t.id];
            const on = audible(mix, t.id);
            const db = m?.db ?? 0;
            return (
              <div key={t.id} className={`tv-head k-${t.kind}${on ? "" : " quiet"}`} role="group" aria-label={`${t.name} track`}>
                <button className="tv-name" title={`Open ${t.name} for the section on screen`} onClick={() => open(current, t)}>{t.name}{!isFirst(t.id) && <span className="tv-x" role="button" aria-label={`Remove ${t.name}`} title="Remove this track" onClick={(e) => { e.stopPropagation(); remove(t); }}>✕</span>}</button>
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
            ) : <button className="btn sm" onClick={() => setAdding(true)}>+ Add track</button>}
          </div>
        </div>
        <div className="tv-scroll" ref={scrollRef}>
          <div className="tv-lanes" style={{ width: starts.width }}>
            <div className="tv-row tv-ruler">
              {sections.map((s) => (
                <div key={s.block || "a"} className={`tv-sec ${letterClass(s.letter)}${s.block === current ? " on" : ""}`} style={{ width: s.bars * bw }}>
                  <button className="tv-letter" aria-pressed={s.block === current} aria-label={`Section ${s.letter}`} onClick={() => choose(s.block)}>{s.letter}</button>
                  <span className="tv-bars" aria-hidden="true">
                    {Array.from({ length: s.bars }, (_, k) => <i key={k} className={inLoop(layout, loop, { block: s.block, bar: k }) ? "in" : ""} style={{ width: bw }}>{bw >= 40 || k % 2 === 0 ? k + 1 : ""}</i>)}
                  </span>
                </div>
              ))}
            </div>
            {tracks.map((t) => (
              <div key={t.id} className={`tv-row k-${t.kind}${audible(mix, t.id) ? "" : " quiet"}`}>
                {sections.map((s0) => {
                  const s = content(t, s0);
                  return (
                    <button key={s.block || "a"} className={`tv-block ${letterClass(s.letter)}${s.block === current ? " on" : ""}`} style={{ width: s.bars * bw }}
                      aria-label={`${t.name} of section ${s.letter}: open`} onClick={() => open(s.block, t)}>
                      {t.kind === "chords" ? <ChordBlock s={s} bw={bw} /> : t.kind === "melody" ? <MelodyBlock s={s} bw={bw} range={range} /> : t.kind === "drums" ? <DrumBlock s={s} bw={bw} /> : <span className="tv-empty">No takes yet</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="tv-row tv-row-add" />
            <div className="tv-line" ref={lineRef} />
          </div>
        </div>
      </div>
      <p className="tiny muted">Tap a block to open that section&rsquo;s page for that track. A track&rsquo;s volume, M (mute) and S (solo) apply to the whole song; double-tap a volume to set it back to 0 dB. + Add track adds chords, a melody, drums or vocals.</p>
    </section>
  );
}

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
        const lv = Math.max(...lane.ids.map((id) => levelAt(d.rows, id, pb * d.steps + i)));
        if (lv) marks.push({ x: k * bw + (i / d.steps) * bw, y: lane.y * 44, o: 0.35 + lv * 0.22 });
      }
  }
  return (
    <svg className="tv-svg drums" width={w} height={44} aria-hidden="true">
      {marks.map((m, i) => <rect key={i} x={m.x} y={m.y - 3} width={Math.max(1.5, bw / d.steps - 1)} height={6} rx={1} opacity={m.o} />)}
    </svg>
  );
}

