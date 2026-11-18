import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { audioIfStarted } from "../../audio/context";
import { saveFile } from "../../audio/midi";
import { BANDS, F_LO, PER_OCTAVE } from "../../audio/describe";
import { due, listen } from "../../audio/pulse";
import { STEMS, readStem } from "../../audio/stems";
import { MARGIN, REGIONS, RULER_HZ, hzLabel, pageOf, yOfHz, type Spot } from "../../canvas/layout";
import { FADES, Painter, STEM_IDS, type StemId } from "../../canvas/painter";
import { DEFAULT_PALETTE, PALETTES, PALETTE_GROUPS, getPalette, roles, trio } from "../../canvas/palettes";
import { SURFACES, surfaceRows, type Surface } from "../../canvas/weave";
import type { Key } from "../../theory/keys";
import { pc } from "../../theory/notes";
import { getScale, scalePcs } from "../../theory/scales";
import { useApp } from "../state";
import { Seg } from "./common";

/** No more real pixels than this, however sharp the screen: paint has to keep up with the music. */
const MAX_PIXELS = 2_400_000;
/**
 * How wide one thread of the cloth is, in real pixels. Whole numbers only: a weave whose threads
 * do not fall on whole pixels shimmers with bands that are not there.
 */
const thread = (surface: Surface, dpr: number) => Math.max(3, Math.round((surface === "paper" ? 3.6 : surface === "linen" ? 2.1 : 2.5) * dpr));

/** How wide the strip down the right edge is that shows what the mix covers, as a part of the canvas (it sits in the margin, clear of the paint). */
const COVER = MARGIN * 0.9;

/**
 * The canvas: while the song plays, it paints itself.
 *
 * Time runs across, frequency runs up, an octave to every equal step. Every sound is painted
 * where it is, as long as it lasts and as heavy as it is loud: short sounds are dabs, sounds
 * that last are strokes, noise is spray. The guide marks the frequencies, the bars, and what
 * the mix has lately covered.
 */
export function CanvasPage({ active, playing, getSpot, rest, keyOf, onPlay, canPlay }: {
  /** the page is on screen */
  active: boolean;
  playing: boolean;
  /** where the music is (null = stopped) */
  getSpot: () => Spot | null;
  /** where the music would start: the bars are marked for it before anything plays */
  rest: Spot;
  /** the key of the song: the note colours follow it */
  keyOf: Key;
  onPlay: () => void;
  canPlay: boolean;
}) {
  const { state, set, toast } = useApp();
  const prefs = state.canvas ?? { palette: DEFAULT_PALETTE };
  const pal = getPalette(prefs.palette);
  const surface: Surface = prefs.surface ?? pal.surface;
  const fade = prefs.fade ?? 1;
  const guide = prefs.guide !== false;
  const stage = useRef<HTMLDivElement>(null);
  /** the strip that shows what the mix covers */
  const cover = useRef<HTMLCanvasElement>(null);
  /** what each part of the mix is sounding right now, band by band (read off the mixer every frame) */
  const levels = useRef<Record<StemId, Float32Array>>({ chords: new Float32Array(BANDS), melody: new Float32Array(BANDS), drums: new Float32Array(BANDS) });
  /** the bars the canvas on show holds: the number of its first (0 = bar 1), how many, and how many a full canvas holds */
  const [bars, setBars] = useState({ first: 0, count: 0, per: 1 });
  const barsId = useRef("");
  const host = useRef<HTMLDivElement>(null);
  const tex = useRef<HTMLCanvasElement>(null);
  const painter = useRef<Painter | null>(null);
  /** which weaving of the cloth is the current one (a newer one stops an older one) */
  const weaving = useRef(0);
  const [full, setFull] = useState(false);
  const [painted, setPainted] = useState(false);
  const tonic = pc(keyOf.tonic);
  const scale = useMemo(() => scalePcs(tonic, getScale(keyOf.scaleId)), [tonic, keyOf.scaleId]);
  const dark = roles(pal).dark;
  /** the colours of the three parts of the mix in the strip that shows what it covers */
  const stemColors = useMemo((): Record<StemId, string> => trio(pal), [pal]);
  const live = useRef({ playing, getSpot, rest, guide, stemColors });
  live.current = { playing, getSpot, rest, guide, stemColors };
  const setPrefs = (patch: Partial<typeof prefs>) => set((s) => ({ ...s, canvas: { ...(s.canvas ?? { palette: DEFAULT_PALETTE }), ...patch } }));
  /** the family of colour schemes being looked through (it starts on the family of the one in use) */
  const [group, setGroup] = useState(pal.group);

  // the painter lives as long as the page does, so a painting is still there after a look at another page
  useEffect(() => {
    if (!host.current) return;
    const p = new Painter(host.current, pal, FADES[fade].keep);
    p.setKey(tonic, scale);
    painter.current = p;
    return () => {
      p.destroy();
      painter.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => painter.current?.setKey(tonic, scale), [tonic, scale]);
  useEffect(() => painter.current?.setKeep(FADES[fade].keep), [fade]);
  // new colours: a new canvas
  const first = useRef(true);
  useEffect(() => {
    painter.current?.setPalette(pal);
    if (first.current) {
      first.current = false;
      return;
    }
    painter.current?.clear();
    setPainted(false);
  }, [pal]);

  /** Fit the painting, and the cloth under it, to the size the stage has now. */
  const fit = useCallback(() => {
    const el = stage.current;
    const t = tex.current;
    const p = painter.current;
    if (!el || !t || !p) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w < 8 || h < 8) return;
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3, Math.sqrt(MAX_PIXELS / (w * h))));
    p.size(w, h, dpr);
    const tw = Math.round(w * dpr);
    const th = Math.round(h * dpr);
    if (t.width !== tw || t.height !== th || t.dataset.kind !== surface) {
      t.width = tw;
      t.height = th;
      t.dataset.kind = surface;
      // the cloth is woven a strip at a time, so the music is never kept waiting
      const job = ++weaving.current;
      const g = t.getContext("2d")!;
      g.fillStyle = "rgb(128,128,128)";
      g.fillRect(0, 0, tw, th);
      const img = new ImageData(tw, th);
      const per = thread(surface, dpr);
      let y = 0;
      const strip = () => {
        if (job !== weaving.current) return;
        const t0 = performance.now();
        const from = y;
        while (y < th && performance.now() - t0 < 7) {
          surfaceRows(surface, tw, th, per, 0.5, 1, y, y + 24, img.data);
          y += 24;
        }
        g.putImageData(img, 0, 0, 0, from, tw, Math.min(th, y) - from);
        if (y < th) requestAnimationFrame(strip);
      };
      strip();
    }
  }, [surface]);
  useEffect(() => {
    if (!active) return;
    fit();
    const el = stage.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(fit, 120);
    });
    ro.observe(el);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [active, fit, full]);

  /** Draw what the mix has lately covered: for every band a bar, as long as the mix is strong there, in the colours of the parts that make it up. */
  const drawCover = useCallback((p: Painter) => {
    const cv = cover.current;
    const el = stage.current;
    if (!cv || !el) return;
    const w = Math.max(8, Math.round(el.clientWidth * COVER));
    const h = el.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const { level, share } = p.coverage();
    for (let b = 0; b < BANDS; b++) {
      if (level[b] < 0.01) continue;
      const y1 = yOfHz(F_LO * Math.pow(2, b / PER_OCTAVE), h);
      const y0 = yOfHz(F_LO * Math.pow(2, (b + 1) / PER_OCTAVE), h);
      // the bar grows leftwards from the edge
      let x = w;
      const len = level[b] * (w - 1);
      for (const s of STEM_IDS) {
        const part = len * share[s][b];
        if (part < 0.2) continue;
        g.fillStyle = live.current.stemColors[s];
        g.fillRect(x - part, y0 + 0.5, part, Math.max(1, y1 - y0 - 1));
        x -= part;
      }
    }
  }, []);

  // while the page is on screen: hear what sounds, and paint it
  useEffect(() => {
    if (!active) return;
    const stop = listen();
    let raf = 0;
    let last = performance.now();
    let drawn = 0;
    const tick = (now: number) => {
      const p = painter.current;
      const c = audioIfStarted();
      if (p) {
        const spot = live.current.playing ? live.current.getSpot() : null;
        p.at(spot);
        if (c) {
          // what is heard comes out of the speakers a moment after it is scheduled
          const heard = c.currentTime - (c.outputLatency || 0);
          for (const hit of due(heard)) p.hit(hit, heard - hit.time);
          if (spot) {
            // what the mixer is putting out right now, part by part
            for (const s of STEMS) readStem(s, levels.current[s]);
            p.mix(levels.current, now - last);
          }
        }
        p.frame(now - last);
        if (p.made > 0) setPainted(true);
        // the guide: which bars this canvas holds, and (a few times a second) what the mix covers
        const where = spot ?? live.current.rest;
        const pg = pageOf(where, stage.current?.clientWidth ?? 600);
        const id = `${pg.page}/${pg.perPage}/${where.bars}`;
        if (id !== barsId.current) {
          barsId.current = id;
          setBars({ first: pg.page * pg.perPage, count: Math.max(0, Math.min(pg.perPage, Math.round(where.bars) - pg.page * pg.perPage)), per: pg.perPage });
        }
        if (live.current.guide && now - drawn > 110) {
          drawn = now;
          drawCover(p);
        }
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stop();
    };
  }, [active, drawCover]);

  // Escape leaves the full screen
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const clear = () => {
    painter.current?.clear();
    setPainted(false);
  };
  const save = () => {
    const p = painter.current;
    if (!p) return;
    p.picture(tex.current).toBlob(async (blob) => {
      if (!blob) return toast("Couldn't make the picture");
      const r = await saveFile(new Uint8Array(await blob.arrayBuffer()), "m-theory-canvas.png", "image/png");
      toast(r === "saved" ? "Picture saved" : r === "failed" ? "Can't save files here" : "Cancelled");
    }, "image/png");
  };
  const pct = (hz: number) => `${yOfHz(hz, 100)}%`;

  return (
    <section className={`card cv${full ? " full" : ""}`} aria-label="Canvas">
      <div className={`cv-stage${dark ? " dark" : ""}`} ref={stage} style={{ background: pal.ground }} data-palette={pal.id}>
        <div className="cv-host" ref={host} />
        <canvas className="cv-tex" ref={tex} />
        <div className="cv-edge" />
        {guide && (
          <div className="cv-guide" style={{ color: pal.ink, ["--cv-ground" as string]: pal.ground }} aria-hidden="true">
            {RULER_HZ.map((hz) => <span key={hz} className="cv-hz" style={{ top: pct(hz) }}>{hzLabel(hz)}</span>)}
            {REGIONS.map((reg) => (
              <span key={reg.name} className="cv-reg" style={{ top: pct(reg.to), height: `${yOfHz(reg.from, 100) - yOfHz(reg.to, 100)}%`, width: `${COVER * 100}%` }}><i>{reg.short}</i></span>
            ))}
            {Array.from({ length: bars.count }, (_, k) => (
              <span key={k} className="cv-barno" style={{ left: `${(MARGIN + (k / bars.per) * (1 - 2 * MARGIN)) * 100}%` }}>{bars.first + k + 1}</span>
            ))}
            <canvas className="cv-cover" ref={cover} style={{ width: `${COVER * 100}%` }} />
          </div>
        )}
        {!painted && !playing && <p className="cv-hint" style={{ color: pal.ink }} aria-hidden="true">▶</p>}
        <div className="cv-tools">
          <button className={`icon-btn cv-hzbtn${guide ? " on" : ""}`} aria-pressed={guide} aria-label="Guide: frequencies, bars, and what the mix covers" title="Guide: frequencies, bars, and what the mix covers" onClick={() => setPrefs({ guide: !guide })}>Hz</button>
          {full && <button className={`play-btn sm${playing ? " stop" : ""}`} onClick={onPlay} aria-label={playing ? "Stop" : "Play"} disabled={!playing && !canPlay}>{playing ? "■" : "▶"}</button>}
          <button className="icon-btn" aria-label={full ? "Leave the full screen" : "Fill the screen"} title={full ? "Back" : "Fill the screen"} onClick={() => setFull(!full)}>{full ? "✕" : "⤢"}</button>
        </div>
      </div>
      <div className="cv-bar">
        {guide && (
          <p className="cv-key">
            {STEM_IDS.map((id) => <span key={id}><i style={{ background: stemColors[id] }} />{id}</span>)}
          </p>
        )}
        <div className="cv-pick">
          <Seg value={group} options={PALETTE_GROUPS.map((g) => ({ value: g, label: g }))} onChange={setGroup} label="Families of colour schemes" />
          <div className="cv-pals" role="radiogroup" aria-label={`${group} colour schemes`}>
            {PALETTES.filter((p) => p.group === group).map((p) => (
              <button key={p.id} role="radio" aria-checked={p.id === pal.id} className={`cv-pal${p.id === pal.id ? " on" : ""}`} title={p.name} onClick={() => setPrefs({ palette: p.id, surface: undefined })}>
                <span className="cv-sw" style={{ background: p.ground }}>
                  {p.colors.slice(0, 6).map((c) => <i key={c} style={{ background: c }} />)}
                </span>
                <span className="cv-pal-name">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="cv-opts">
          <span className="kb-label">Surface</span>
          <Seg value={surface} options={SURFACES.map((x) => ({ value: x.id, label: x.label }))} onChange={(v) => setPrefs({ surface: v })} label="What the paint is on" />
          <span className="kb-label" title="How long old paint stays when the music comes round again">Old paint</span>
          <Seg value={fade} options={FADES.map((f) => ({ value: f.id, label: f.label }))} onChange={(v) => setPrefs({ fade: v })} label="How long old paint stays" />
          <span className="spacer" />
          <button className="btn sm" disabled={!painted} onClick={clear}>Clear</button>
          <button className="btn sm" disabled={!painted} onClick={save}>Save picture</button>
        </div>
      </div>
    </section>
  );
}
