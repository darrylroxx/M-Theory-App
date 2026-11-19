import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { audioContext, audioIfStarted } from "../../audio/context";
import { saveFile } from "../../audio/midi";
import { lastOnly } from "../latest";
import { BANDS, F_LO, PER_OCTAVE } from "../../audio/describe";
import { fader, levelOf } from "../../audio/mix";
import { due, dropPulses, dueReleases, listen as listenPulses } from "../../audio/pulse";
import { STEMS, readStem } from "../../audio/stems";
import { songWhen, fileWhen, heardTime } from "../../canvas/clock";
import { Cover, STEM_IDS, type StemId } from "../../canvas/cover";
import { HeldCues, cueOfPulse, trackOfPulse } from "../../canvas/cues";
import { LAYER_INFO, LAYER_ORDER, type LayerKind } from "../../canvas/layers";
import { MARGIN, REGIONS, RULER_HZ, hzLabel, pageOf, yOfHz, type Spot } from "../../canvas/layout";
import { FADES, Painting, STYLES, type EarFrames, type LayerCue } from "../../canvas/painting";
import { LAYOUTS, type LayoutId } from "../../canvas/place";
import { Sim } from "../../canvas/sim";
import { paintSwatches } from "../../canvas/swatch";
import { handOf, heardIn, layerOf, planKey, planTaps } from "../../canvas/taps";
import type { Frame } from "../../listen/ear";
import { FileLayers } from "../../listen/filelayers";
import { listenLive, type Listening } from "../../listen/live";
import { VoiceRouter } from "../../listen/route";
import { Player, Reader, openSong, type Song } from "../../listen/songfile";
import { StemLink, type LinkView, type SongFile } from "../../listen/stemlink";
import { sizeLabel } from "../../listen/neuralstems";
import { isDesktop } from "../../desktop";
import { DEFAULT_PALETTE, PALETTES, PALETTE_GROUPS, getPalette, roles, trio } from "../../canvas/palettes";
import { SURFACES, surfaceRows, type Surface } from "../../canvas/weave";
import type { Key } from "../../theory/keys";
import { pc } from "../../theory/notes";
import { getScale, scalePcs } from "../../theory/scales";
import { useApp } from "../state";
import { OpenIcon } from "../icons";
import { Seg } from "./common";

/** No more real pixels than this, however sharp the screen: paint has to keep up with the music. */
const MAX_PIXELS = 1_500_000;
/**
 * How wide one thread of the cloth is, in real pixels. Whole numbers only: a weave whose threads
 * do not fall on whole pixels shimmers with bands that are not there.
 */
const thread = (surface: Surface, dpr: number) => Math.max(3, Math.round((surface === "paper" ? 3.6 : surface === "linen" ? 2.1 : 2.5) * dpr));

/** How wide the strip down the right edge is that shows what the mix covers, as a part of the canvas (it sits in the margin, clear of the paint). */
const COVER = MARGIN * 0.9;

/** For a song from a file: how much of it one pass across the canvas holds (seconds; 0 = all of it). */
const PASSES = [{ value: 8, label: "8 s" }, { value: 15, label: "15 s" }, { value: 30, label: "30 s" }, { value: 0, label: "All" }];

/** Marks land this long (seconds) before their sound is heard: the eye forgives paint a little early, never late. */
const LEAD = 0.012;

/** A six-stem model's own sources: each has a legend entry of its own when the split makes it. */
const SOURCES = ["guitar", "piano"] as const;

/**
 * The better split's one control, beside the song's name: the download it needs (its size), the
 * download going (its progress; pressed, it stops), a mark while the model's stems are in use,
 * or a way to try again. Where it cannot run, nothing in the browser; in the desktop app, a dim
 * mark whose hover says why.
 */
function Better({ view, link }: { view: LinkView; link: { current: StemLink | null } }) {
  const { phase, reason } = view;
  if (phase === "off") return reason && isDesktop() ? <span className="cv-better dim" title={reason} aria-label={reason}>◇</span> : null;
  if (phase === "need") {
    const size = sizeLabel(view.bytes);
    return (
      <button className="cv-better" title={reason ?? "Better layers"} aria-label={`Better layers: download ${size}`} onClick={() => void link.current?.fetch()}>
        ⤓ {size}
      </button>
    );
  }
  if (phase === "fetching")
    return (
      <button className="cv-better" title="Stop" aria-label={`Downloading, ${Math.round(view.fetched * 100)}%: stop`} onClick={() => link.current?.cancelFetch()}>
        <span className="cv-better-bar"><i style={{ width: `${Math.round(view.fetched * 100)}%` }} /></span>✕
      </button>
    );
  if (phase === "failed")
    return (
      <button className="cv-better dim" title={reason ?? "Try again"} aria-label="Try the better layers again" onClick={() => link.current?.retry()}>
        ↻
      </button>
    );
  if (phase === "splitting" || phase === "paused" || phase === "done") {
    const pct = view.seconds ? Math.round(Math.min(1, view.read / view.seconds) * 100) : 0;
    return <span className={`cv-better on${phase === "done" ? "" : " busy"}`} title="Better layers" aria-label={phase === "done" ? "Better layers" : `Better layers: ${pct}%`}>≋</span>;
  }
  return null;
}

/**
 * The canvas: while music plays, it paints itself.
 *
 * It hears the music layer by layer (the app's own song track by track, with every note it
 * plays; a song from a file split into drums, bass, vocals and the rest) and paints each layer
 * in its own kind of paint, as far over the canvas as there is music to fill it, in a layout the
 * vibe of the music chooses (or the painter does). The paint is wet: it runs, bleeds into its
 * neighbours, mixes as pigment does and dries. No two paintings come out the same, and music
 * of one kind paints pictures of one kind.
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
  const style = prefs.style ?? "auto";
  const drips = !!prefs.drips;
  const pass = prefs.pass ?? 15;
  const guide = prefs.guide !== false;
  const layoutPref: LayoutId | "auto" = prefs.layout ?? "auto";
  const hidePref = prefs.hide;
  const hidden = useMemo(() => new Set<LayerKind>(hidePref ?? []), [hidePref]);
  /** the ears and hands for the song's tracks */
  const plans = useMemo(() => planTaps(state.progression), [state.progression]);
  const plansId = planKey(plans);
  /** the layout the canvas is painting in now (the music's choice when on Auto) */
  const [layoutNow, setLayoutNow] = useState<LayoutId>("river");
  /** how loud each layer is now, for the legend (a few times a second) */
  const [layerLv, setLayerLv] = useState<Partial<Record<LayerKind, number>>>({});
  /** each layer's swatch: a little painting of its paint */
  const [swatches, setSwatches] = useState<Partial<Record<LayerKind, string>>>({});
  const castRef = useRef("");
  const castAt = useRef(0);
  const stage = useRef<HTMLDivElement>(null);
  /** the strip that shows what the mix covers */
  const cover = useRef<HTMLCanvasElement>(null);
  const covered = useRef(new Cover());
  /** what each part of the mix is sounding right now, band by band (read off the mixer every frame) */
  const levels = useRef<Record<StemId, Float32Array>>({ chords: new Float32Array(BANDS), melody: new Float32Array(BANDS), drums: new Float32Array(BANDS) });
  /** the bars the canvas on show holds: the number of its first (0 = bar 1), how many, and how many a full canvas holds */
  const [bars, setBars] = useState({ first: 0, count: 0, per: 1 });
  const barsId = useRef("");
  const host = useRef<HTMLDivElement>(null);
  const tex = useRef<HTMLCanvasElement>(null);
  const painter = useRef<Painting | null>(null);
  /** the ear on the app's own sound (there once sound has started) */
  const hearing = useRef<Listening | null>(null);
  /** a song opened from a file, what plays it, what hears it layer by layer, and what reads it until that has caught up */
  const [song, setSong] = useState<Song | null>(null);
  const [songOn, setSongOn] = useState(false);
  const [opening, setOpening] = useState(false);
  /** the file being read: only the last one dropped is opened */
  const opens = useMemo(lastOnly, []);
  const filePlayer = useRef<Player | null>(null);
  const reader = useRef<Reader | null>(null);
  const fileLayers = useRef<FileLayers | null>(null);
  /** the file the song was opened from (the neural split is handed it), and the link to that split */
  const songFile = useRef<SongFile | null>(null);
  const stems = useRef<StemLink | null>(null);
  const [better, setBetter] = useState<LinkView | null>(null);
  /** a model's guitar and piano stems: which are hidden, and how loud each is now (for the legend) */
  const [hideSrc, setHideSrc] = useState<string[]>([]);
  const [srcLv, setSrcLv] = useState<Record<string, number>>({});
  /** the song's time line: how far it has played, and how far the better layers reach */
  const lineAt = useRef<HTMLElement>(null);
  const lineBetter = useRef<HTMLElement>(null);
  const router = useRef(new VoiceRouter({ bass: true, drums: true, fog: "other" }));
  const pick = useRef<HTMLInputElement>(null);
  /** which weaving of the cloth is the current one (a newer one stops an older one) */
  const weaving = useRef(0);
  const [full, setFull] = useState(false);
  const [painted, setPainted] = useState(false);
  const [can] = useState(() => Sim.supported());
  const tonic = pc(keyOf.tonic);
  const scale = useMemo(() => scalePcs(tonic, getScale(keyOf.scaleId)), [tonic, keyOf.scaleId]);
  const dark = roles(pal).dark;
  /** the colours of the three parts of the mix in the strip that shows what it covers */
  const stemColors = useMemo((): Record<StemId, string> => trio(pal), [pal]);
  const live = useRef({ playing, getSpot, rest, guide, stemColors, song, pass, fade, plans, plansId, layoutNow });
  live.current = { playing, getSpot, rest, guide, stemColors, song, pass, fade, plans, plansId, layoutNow };
  const setPrefs = (patch: Partial<typeof prefs>) => set((s) => ({ ...s, canvas: { ...(s.canvas ?? { palette: DEFAULT_PALETTE }), ...patch } }));
  /** the family of colour schemes being looked through (it starts on the family of the one in use) */
  const [group, setGroup] = useState(pal.group);

  // the painter lives as long as the page does, so a painting is still there after a look at another page
  useEffect(() => {
    if (!host.current || !can) return;
    let p: Painting;
    try {
      p = new Painting(host.current, pal);
    } catch (e) {
      // (a graphics card that cannot run the paint: the page says so; while developing, say why)
      if (import.meta.env.DEV) console.error(e);
      return;
    }
    painter.current = p;
    // (while developing, the painter can be looked at from outside the page: the scripts that test the canvas in a browser do)
    if (import.meta.env.DEV) (window as unknown as { __canvas: unknown }).__canvas = { painter: p, files: fileLayers };
    return () => {
      p.destroy();
      painter.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // the colours follow the key: the song's own, or (for a song from a file) the one that is heard
  useEffect(() => {
    if (song) painter.current?.artist.hearKey();
    else painter.current?.artist.setKey(tonic, scale);
  }, [tonic, scale, song]);
  /** Paint the legend's swatches again (the colours in use changed). */
  const recast = useCallback(() => {
    const a = painter.current?.artist;
    const look = a?.look;
    const base = `${pal.id}/${tonic}/${scale.join()}`;
    const id = `${base}|${Math.round(look?.turn ?? 0)}/${(look?.light ?? 0).toFixed(1)}`;
    if (id === castRef.current) return;
    // a new palette or key at once; the music's own casting, as it settles, no more than every few seconds
    const now = performance.now();
    if (castRef.current.startsWith(`${base}|`) && now - castAt.current < 4000) return;
    castRef.current = id;
    castAt.current = now;
    const made = paintSwatches(pal, look?.turn ?? 0, look?.light ?? 0, tonic, scale);
    if (!made) return;
    const out: Partial<Record<LayerKind, string>> = {};
    for (const l of LAYER_ORDER) out[l] = made[l].toDataURL("image/png");
    setSwatches(out);
  }, [pal, tonic, scale]);
  useEffect(() => {
    if (active && can) recast();
  }, [active, can, recast]);
  useEffect(() => {
    const a = painter.current?.artist;
    if (!a) return;
    a.style = style;
    a.drips = drips;
    a.choice = layoutPref;
    a.hidden = hidden;
    a.hiddenSources = new Set(hideSrc);
  }, [style, drips, layoutPref, hidden, hideSrc]);
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
        // the paint is told the grain of what it is on: dry paint catches its ridges, wet paint settles in its hollows
        else painter.current?.sim.setPaper(t);
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
  const drawCover = useCallback(() => {
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
    const { level, share } = covered.current.coverage();
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
    let raf = 0;
    let last = performance.now();
    let drawn = 0;
    let told = 0;
    let lined = 0;
    let gone = false;
    /** the ears on the app's own sound, and the plan they were made for */
    let asking = "";
    /** the plan the hands were last kept to */
    let handsFor = "";
    /** every note and hit the app plays, collected while the page is on screen */
    const stopPulses = listenPulses();
    let cueId = 1;
    /** notes of keys held down by hand, until they come up */
    const held = new HeldCues();
    /** the app's own song: when it started (audio clock), how many times it has jumped, and where it was last */
    const clock = { start: 0, jump: 0, key: "", beat: -1, on: false };
    /** a song from a file: how far it has been painted, its jumps, and the vibe last handed on */
    const file = { to: -1, jump: 0, stems: false, vibe: null as Float32Array | null };
    const none: Frame[] = [];
    const hear = (c: AudioContext) => {
      const lv = live.current;
      if (asking === lv.plansId) return;
      asking = lv.plansId;
      hearing.current?.stop();
      hearing.current = null;
      const want = lv.plansId;
      // every track's fader is made now if it was not yet (they are made when first needed)
      const taps = lv.plans.map((p) => ({ key: p.key, nodes: p.faders.map((id) => fader(id, c)), light: p.light }));
      void listenLive(c, taps).then((l) => {
        if (gone || asking !== want) l?.stop();
        else hearing.current = l;
      });
    };
    const tick = (now: number) => {
      const p = painter.current;
      const c = audioIfStarted();
      const dt = Math.min(100, now - last);
      // an ear on everything the app plays, and on every track, from the moment there is sound
      if (c) hear(c);
      const lv = live.current;
      if (p) {
        const a = p.artist;
        const heard = hearing.current?.take() ?? { mix: none, taps: new Map<string, Frame[]>() };
        const spot = lv.playing ? lv.getSpot() : null;
        const fp = filePlayer.current;
        const pos = lv.song && fp ? fp.position() : null;
        const width = stage.current?.clientWidth ?? 600;
        let moving = false;
        let passSeconds = 16;
        if (lv.song && pos !== null && reader.current) {
          // a song from a file: heard ahead, layer by layer, and painted just as far as it has played
          passSeconds = lv.pass > 0 ? lv.pass : lv.song.duration;
          const fl = fileLayers.current;
          const upTo = pos + LEAD;
          if (file.to < 0 || upTo < file.to - 0.25) {
            // it started (again)
            file.jump++;
            file.to = Math.max(0, pos - 0.01);
            reader.current.seek(file.to);
            router.current.reset();
            a.lift();
          }
          let mix: Frame[];
          let ears: EarFrames[];
          if (fl && fl.ready(upTo)) {
            ({ mix, ears } = fl.between(file.to, upTo));
            file.stems = true;
          } else {
            // not heard ahead yet: the whole mix is read here, and its tones shared out among the layers
            if (file.stems) reader.current.seek(file.to);
            file.stems = false;
            mix = reader.current.upTo(upTo);
            const by = new Map<LayerKind, Frame[]>();
            for (const f of mix) for (const [l, part] of Object.entries(router.current.route(f)) as [LayerKind, Frame][]) by.set(l, [...(by.get(l) ?? []), part]);
            ears = [...by.entries()].map(([l, frames]) => ({ key: l, layer: l, frames }));
          }
          if (fl?.vibe && fl.vibe !== file.vibe) {
            file.vibe = fl.vibe;
            a.knowVibe(fl.vibe, fl.vibeFinal);
          }
          const bar = fl && fl.bpm > 0 ? (4 * 60) / fl.bpm : 2;
          p.hear({ now: upTo, when: fileWhen(passSeconds, bar, file.jump), mix, ears });
          file.to = upTo;
          moving = true;
        } else if (spot && c) {
          // the app's own song: what each ear heard, every note and hit it plays, each moment where the music was then
          if (!lv.song) file.to = -1;
          const at = c.currentTime;
          if (!clock.on || (spot.key === clock.key && spot.beat < clock.beat - 0.05)) {
            // it started, or came round again
            if (!clock.on) {
              clock.start = at - spot.beat * spot.spb;
              // notes played by hand before the song started (keys jammed while it was stopped) are not painted onto its start
              due(clock.start - 0.1);
              dueReleases(clock.start - 0.1);
            }
            clock.jump++;
            clock.on = true;
          }
          clock.key = spot.key;
          clock.beat = spot.beat;
          const pg = pageOf(spot, width);
          passSeconds = pg.perPage * spot.bar * spot.spb;
          const nowHeard = heardTime(c) + LEAD;
          const plans = lv.plans;
          // a track muted (or left out by a solo) stops being painted now, its held notes too
          if (handsFor !== lv.plansId) {
            handsFor = lv.plansId;
            a.keepHands(plans.map((pl) => pl.key));
          }
          const hand = handOf(plans);
          const layer = layerOf(plans);
          const heardNow = heardIn(plans);
          // (notes told of before their track was muted are not painted either)
          const cues: LayerCue[] = due(nowHeard + 0.3)
            .filter((pl) => heardNow(trackOfPulse(pl)))
            .map((pl) => held.note(pl, cueOfPulse(pl, cueId++, layer, levelOf, hand)));
          cues.push(...held.ends(dueReleases(nowHeard + 0.3)));
          const ears: EarFrames[] = plans.map((pl) => ({ key: pl.key, layer: pl.layer, frames: heard.taps.get(pl.key) ?? none, exact: pl.light }));
          p.hear({ now: nowHeard, when: songWhen(spot, at, width, clock.start, clock.jump), mix: heard.mix, ears, cues });
          for (const s of STEMS) readStem(s, levels.current[s]);
          covered.current.mix(levels.current, dt);
          moving = true;
        } else {
          if (clock.on) {
            clock.on = false;
            dropPulses();
          }
          if (!lv.song || pos === null) file.to = -1;
          a.lift();
        }
        const half = FADES[lv.fade]?.half ?? 0;
        p.fade = half > 0 ? Math.LN2 / (half * passSeconds) : 0;
        p.frame(dt / 1000, moving);
        if (p.made > 0) setPainted(true);
        if (a.layout.id !== lv.layoutNow) setLayoutNow(a.layout.id);
        // the legend: how loud each layer is now (a few times a second)
        if (now - told > 220) {
          told = now;
          const out: Partial<Record<LayerKind, number>> = {};
          for (const l of LAYER_ORDER) {
            const act = a.activity[l];
            const on = moving && act.loud > 0.04 && (a.time - act.last < 2.2 || a.handsOf(l).some((h) => h.down > 0));
            out[l] = on ? Math.round(Math.min(1, act.loud) * 10) / 10 : 0;
          }
          setLayerLv((old) => (LAYER_ORDER.every((l) => old[l] === out[l]) ? old : out));
          // each hand on the stage, as data (never shown): its layer, how loud its track is heard and how many marks it has laid
          if (stage.current) stage.current.dataset.hands = [...a.hands].map(([k, h]) => `${k}=${h.layer}:${h.texture.level.toFixed(2)}:${h.made}`).join(" ");
          const src: Record<string, number> = {};
          for (const k of SOURCES) src[k] = moving ? Math.round(Math.min(1, a.sourceLevel(k)) * 10) / 10 : 0;
          setSrcLv((old) => (SOURCES.every((k) => old[k] === src[k]) ? old : src));
          recast();
        }
        // the song's time line: where it is, and how far the better layers have been heard
        if (lv.song && now - lined > 100) {
          lined = now;
          const d = Math.max(0.01, lv.song.duration);
          const span = fileLayers.current?.stemsSpan;
          if (lineAt.current) lineAt.current.style.transform = `scaleX(${Math.min(1, Math.max(0, (pos ?? 0) / d))})`;
          if (lineBetter.current) {
            lineBetter.current.style.left = `${((span?.from ?? 0) / d) * 100}%`;
            lineBetter.current.style.width = `${span ? (Math.max(0, Math.min(d, span.to) - span.from) / d) * 100 : 0}%`;
          }
        }
        // the guide: which bars this canvas holds, and (a few times a second) what the mix covers
        const where = spot ?? lv.rest;
        const pg = pageOf(where, width);
        const id = lv.song ? "song" : `${pg.page}/${pg.perPage}/${where.bars}`;
        if (id !== barsId.current) {
          barsId.current = id;
          setBars(lv.song ? { first: 0, count: 0, per: 1 } : { first: pg.page * pg.perPage, count: Math.max(0, Math.min(pg.perPage, Math.round(where.bars) - pg.page * pg.perPage)), per: pg.perPage });
        }
        if (lv.guide && !lv.song && lv.layoutNow === "sweep" && now - drawn > 110) {
          drawn = now;
          drawCover();
        }
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      stopPulses();
      hearing.current?.stop();
      hearing.current = null;
    };
  }, [active, drawCover, recast]);

  // ── a song from a file ──
  const stopSong = useCallback(() => {
    filePlayer.current?.stop();
    setSongOn(false);
    painter.current?.lift();
  }, []);
  const playSong = (s: Song) => {
    const c = audioContext();
    const fp = (filePlayer.current ??= new Player(c));
    fp.onEnd = () => setSongOn(false);
    reader.current = new Reader(s, 0);
    painter.current?.lift();
    fp.play(s, 0);
    setSongOn(true);
  };
  const open = async (file: File | undefined | null) => {
    if (!file) return;
    stopSong();
    setOpening(true);
    // (a file still being read when another is dropped, or the song is closed, is not opened after all)
    const mine = opens.begin();
    try {
      const s = await openSong(file, audioContext());
      if (!mine()) return;
      painter.current?.fresh();
      fileLayers.current?.close();
      // heard layer by layer, ahead, from the moment it is opened
      stems.current?.stop();
      fileLayers.current = new FileLayers(s);
      songFile.current = file;
      setSong(s);
    } catch {
      if (mine()) toast("Can't read that file as sound");
    }
    if (mine()) setOpening(false);
  };
  const closeSong = () => {
    opens.cancel();
    setOpening(false);
    stems.current?.stop();
    songFile.current = null;
    stopSong();
    setSong(null);
    fileLayers.current?.close();
    fileLayers.current = null;
    painter.current?.fresh();
  };
  // the app's own song starts: the file gives way
  useEffect(() => {
    if (playing) stopSong();
  }, [playing, stopSong]);
  // leaving the page stops the file
  useEffect(() => {
    if (!active) stopSong();
  }, [active, stopSong]);
  // the neural split, for a song from a file, while the page is on screen (in the desktop app, where it can run): it
  // starts by itself if all it needs is here, and stops when the song is closed, another is opened or the page is left
  useEffect(() => {
    const file = songFile.current;
    const layers = fileLayers.current;
    if (!active || !song || !file || !layers) return;
    const link = new StemLink(file, layers, { onChange: (v) => setBetter(v) });
    stems.current = link;
    void link.start();
    return () => {
      link.stop();
      if (stems.current === link) stems.current = null;
      setBetter(null);
    };
  }, [active, song]);
  useEffect(
    () => () => {
      stems.current?.stop();
      filePlayer.current?.stop();
      fileLayers.current?.close();
    },
    [],
  );

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
    p.picture(tex.current, dark).toBlob(async (blob) => {
      if (!blob) return toast("Couldn't make the picture");
      const r = await saveFile(new Uint8Array(await blob.arrayBuffer()), "m-theory-canvas.png", "image/png");
      toast(r === "saved" ? "Picture saved" : r === "failed" ? "Can't save files here" : "Cancelled");
    }, "image/png");
  };
  const pct = (hz: number) => `${yOfHz(hz, 100)}%`;
  /** the layouts in which height is still frequency (the ruler holds), and the one that is read bar by bar */
  const ruler = layoutNow === "sweep" || layoutNow === "river" || layoutNow === "field";
  const sweep = layoutNow === "sweep";

  return (
    <section className={`card cv${full ? " full" : ""}`} aria-label="Canvas">
      <div
        className={`cv-stage${dark ? " dark" : ""}`}
        ref={stage}
        style={{ background: pal.ground }}
        data-palette={pal.id}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void open(e.dataTransfer.files[0]);
        }}
      >
        <div className="cv-host" ref={host} />
        {song && (
          <div className="cv-line" aria-hidden="true">
            <i className="cv-line-at" ref={lineAt} />
            <i className="cv-line-better" ref={lineBetter} />
          </div>
        )}
        <canvas className="cv-tex" ref={tex} />
        <div className="cv-edge" />
        {guide && ruler && (
          <div className="cv-guide" style={{ color: pal.ink, ["--cv-ground" as string]: pal.ground }} aria-hidden="true">
            {RULER_HZ.map((hz) => <span key={hz} className="cv-hz" style={{ top: pct(hz) }}>{hzLabel(hz)}</span>)}
            {sweep && REGIONS.map((reg) => (
              <span key={reg.name} className="cv-reg" style={{ top: pct(reg.to), height: `${yOfHz(reg.from, 100) - yOfHz(reg.to, 100)}%`, width: `${COVER * 100}%` }}><i>{reg.short}</i></span>
            ))}
            {sweep && Array.from({ length: bars.count }, (_, k) => (
              <span key={k} className="cv-barno" style={{ left: `${(MARGIN + (k / bars.per) * (1 - 2 * MARGIN)) * 100}%` }}>{bars.first + k + 1}</span>
            ))}
            {sweep && !song && <canvas className="cv-cover" ref={cover} style={{ width: `${COVER * 100}%` }} />}
          </div>
        )}
        {!can && <p className="cv-hint" style={{ color: pal.ink }}>This device can't run the paint (it needs WebGL 2)</p>}
        {can && !painted && !playing && !songOn && <p className="cv-hint" style={{ color: pal.ink }} aria-hidden="true">{opening ? "…" : "▶"}</p>}
        {song && (
          <div className="cv-song">
            <button className={`play-btn sm${songOn ? " stop" : ""}`} onClick={() => (songOn ? stopSong() : playSong(song))} aria-label={songOn ? "Stop the song" : "Play the song"}>{songOn ? "■" : "▶"}</button>
            <span className="cv-song-name" title={song.name}>{song.name}</span>
            {better && <Better view={better} link={stems} />}
            <button className="icon-btn" aria-label="Close the song" title="Close the song" onClick={closeSong}>✕</button>
          </div>
        )}
        <input ref={pick} type="file" accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac,.opus" hidden onChange={(e) => { void open(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="cv-tools">
          <button className="icon-btn" aria-label="Open a song from a file" title="Open a song (or drop one on the canvas)" disabled={opening || !can} onClick={() => pick.current?.click()}><OpenIcon /></button>
          {ruler && <button className={`icon-btn cv-hzbtn${guide ? " on" : ""}`} aria-pressed={guide} aria-label="Guide: frequencies, bars, and what the mix covers" title="Guide: frequencies, bars, and what the mix covers" onClick={() => setPrefs({ guide: !guide })}>Hz</button>}
          {full && !song && <button className={`play-btn sm${playing ? " stop" : ""}`} onClick={onPlay} aria-label={playing ? "Stop" : "Play"} disabled={!playing && !canPlay}>{playing ? "■" : "▶"}</button>}
          <button className="icon-btn" aria-label={full ? "Leave the full screen" : "Fill the screen"} title={full ? "Back" : "Fill the screen"} onClick={() => setFull(!full)}>{full ? "✕" : "⤢"}</button>
        </div>
      </div>
      <div className="cv-bar">
        <div className="cv-layers" role="group" aria-label="Layers">
          {LAYER_ORDER.map((l) => {
            const off = hidden.has(l);
            const lvl = layerLv[l] ?? 0;
            return (
              <button key={l} className={`cv-layer${off ? " off" : ""}${lvl > 0 ? " live" : ""}`} aria-pressed={!off} title={LAYER_INFO[l].name} aria-label={`${LAYER_INFO[l].name}: ${off ? "hidden" : "shown"}`} style={{ ["--lv" as string]: String(lvl), background: pal.ground }} onClick={() => setPrefs({ hide: off ? (hidePref ?? []).filter((x) => x !== l) : [...(hidePref ?? []), l] })}>
                {swatches[l] ? <img className="cv-layer-sw" src={swatches[l]} alt="" draggable={false} /> : <span className="cv-layer-sw" />}
                <span className="cv-layer-name" style={{ color: pal.ink }}>{LAYER_INFO[l].name}</span>
                <i className="cv-layer-lv" style={{ background: pal.ink }} />
              </button>
            );
          })}
          {SOURCES.filter((k) => better?.stems.includes(k)).map((k) => {
            const off = hideSrc.includes(k);
            const lvl = srcLv[k] ?? 0;
            const name = k === "guitar" ? "Guitar" : "Piano";
            return (
              <button key={k} className={`cv-layer${off ? " off" : ""}${lvl > 0 ? " live" : ""}`} aria-pressed={!off} title={name} aria-label={`${name}: ${off ? "hidden" : "shown"}`} style={{ ["--lv" as string]: String(lvl), background: pal.ground }} onClick={() => setHideSrc(off ? hideSrc.filter((x) => x !== k) : [...hideSrc, k])}>
                {swatches.chords ? <img className="cv-layer-sw" src={swatches.chords} alt="" draggable={false} /> : <span className="cv-layer-sw" />}
                <span className="cv-layer-name" style={{ color: pal.ink }}>{name}</span>
                <i className="cv-layer-lv" style={{ background: pal.ink }} />
              </button>
            );
          })}
        </div>
        {guide && sweep && !song && (
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
          {/* each label stays with its control when the row wraps (on a phone) */}
          <span className="cv-opt">
            <span className="kb-label">Layout</span>
            <Seg value={layoutPref} options={[{ value: "auto" as LayoutId | "auto", label: "Auto" }, ...LAYOUTS.map((x) => ({ value: x.id as LayoutId | "auto", label: <span title={x.label} aria-label={x.label}>{x.symbol}</span> }))]} onChange={(v) => setPrefs({ layout: v === "auto" ? undefined : v })} label="How the music is laid out" />
          </span>
          <span className="cv-opt">
            <span className="kb-label">Surface</span>
            <Seg value={surface} options={SURFACES.map((x) => ({ value: x.id, label: x.label }))} onChange={(v) => setPrefs({ surface: v })} label="What the paint is on" />
          </span>
          <span className="cv-opt">
            <span className="kb-label">Paint</span>
            <Seg value={style} options={STYLES.map((x) => ({ value: x.id, label: x.label }))} onChange={(v) => setPrefs({ style: v })} label="How the paint behaves" />
            <button className={`btn sm${drips ? " on" : ""}`} aria-pressed={drips} title="Wet paint runs down the canvas" onClick={() => setPrefs({ drips: !drips })}>Drips</button>
          </span>
          <span className="cv-opt">
            <span className="kb-label" title="How long old paint stays as the music goes on">Old paint</span>
            <Seg value={fade} options={FADES.map((f) => ({ value: f.id, label: f.label }))} onChange={(v) => setPrefs({ fade: v })} label="How long old paint stays" />
          </span>
          {song && (layoutNow === "sweep" || layoutNow === "river" || layoutNow === "lanes") && (
            <span className="cv-opt">
              <span className="kb-label" title="How much of the song one pass across the canvas holds">Across</span>
              <Seg value={pass} options={PASSES} onChange={(v) => setPrefs({ pass: v })} label="How much of the song one pass across the canvas holds" />
            </span>
          )}
          <span className="spacer" />
          <button className="btn sm" disabled={!painted} onClick={clear}>Clear</button>
          <button className="btn sm" disabled={!painted} onClick={save}>Save picture</button>
        </div>
      </div>
    </section>
  );
}
