import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { audioIfStarted } from "../../audio/context";
import { saveFile } from "../../audio/midi";
import { due, listen } from "../../audio/pulse";
import type { Spot } from "../../canvas/layout";
import { FADES, Painter } from "../../canvas/painter";
import { DEFAULT_PALETTE, PALETTES, PALETTE_GROUPS, getPalette, roles } from "../../canvas/palettes";
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

/**
 * The canvas: while the song plays, it paints itself.
 *
 * Time runs across, pitch runs up. Every section has its own painting; chords are brush strokes,
 * the melody is a line of ink with a bead on every note, and each drum has a mark of its own.
 */
export function CanvasPage({ active, playing, getSpot, keyOf, onPlay, canPlay }: {
  /** the page is on screen */
  active: boolean;
  playing: boolean;
  /** where the music is (null = stopped) */
  getSpot: () => Spot | null;
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
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const tex = useRef<HTMLCanvasElement>(null);
  const painter = useRef<Painter | null>(null);
  /** which weaving of the cloth is the current one (a newer one stops an older one) */
  const weaving = useRef(0);
  const [full, setFull] = useState(false);
  const [painted, setPainted] = useState(false);
  const tonic = pc(keyOf.tonic);
  const scale = useMemo(() => scalePcs(tonic, getScale(keyOf.scaleId)), [tonic, keyOf.scaleId]);
  const live = useRef({ playing, getSpot });
  live.current = { playing, getSpot };
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
      p.clear();
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

  // while the page is on screen: hear what sounds, and paint it
  useEffect(() => {
    if (!active) return;
    const stop = listen();
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const p = painter.current;
      const c = audioIfStarted();
      if (p) {
        p.at(live.current.playing ? live.current.getSpot() : null);
        if (c) {
          // what is heard comes out of the speakers a moment after it is scheduled
          const heard = c.currentTime - (c.outputLatency || 0);
          for (const hit of due(heard)) p.hit(hit);
        }
        p.frame(now - last);
        if (p.made > 0) setPainted(true);
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stop();
    };
  }, [active]);

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
  const dark = roles(pal).dark;

  return (
    <section className={`card cv${full ? " full" : ""}`} aria-label="Canvas">
      <div className={`cv-stage${dark ? " dark" : ""}`} ref={stage} style={{ background: pal.ground }} data-palette={pal.id}>
        <div className="cv-host" ref={host} />
        <canvas className="cv-tex" ref={tex} />
        <div className="cv-edge" />
        {!painted && <p className="cv-hint" style={{ color: pal.ink }}>{playing ? "Listening…" : "Press ▶ and the song paints itself"}</p>}
        <div className="cv-tools">
          {full && <button className={`play-btn sm${playing ? " stop" : ""}`} onClick={onPlay} aria-label={playing ? "Stop" : "Play"} disabled={!playing && !canPlay}>{playing ? "■" : "▶"}</button>}
          <button className="icon-btn" aria-label={full ? "Leave the full screen" : "Fill the screen"} title={full ? "Back" : "Fill the screen"} onClick={() => setFull(!full)}>{full ? "✕" : "⤢"}</button>
        </div>
      </div>
      <div className="cv-bar">
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
