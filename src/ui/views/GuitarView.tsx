import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_BEAT, applyPattern, barBeats, type Beat, type BeatPattern } from "../../audio/beats";
import { progressionToMidi, saveFile } from "../../audio/midi";
import { reviveFeel, styleBar, type Feel, type PatternId, type PlayItem, type PlayTune } from "../../audio/patterns";
import { reviveSound, type HarpSound } from "../../audio/rack";
import { ProgressionPlayer, getAudio, playNote, playSequence, prepFor, prepareNotes, setHarpSound, setTuneSound, strum } from "../../audio/synth";
import { arrangeProgression, capoSuggestions, fitAlternatives, fretSpan, type ArrangeOptions } from "../../guitar/arrange";
import { POSITIONS } from "../../guitar/shapeMap";
import type { Voicing } from "../../guitar/voicings";
import { EMPTY_MELODY, hasTune, inBars, melodyBase, transposeMelody, type Melody } from "../../song/melody";
import { QUICK_BARS, MAX_SECTION_BARS, barsOr, barsText, frameBeats, inFrame, stepBars } from "../../song/frame";
import { addNewSection, ensureSong, letters, linkState, nextLetter, mapAllChords, moveBlock, setSectionBars, relink, removeBlock, repeatSection, sections, selectBlock, sharedCount, unlinkBlock, type Section, type SettingGroup } from "../../song/structure";
import { CHORD_CATEGORIES, chordSymbol, chordSymbolAscii, displaySuffix, type ChordRef } from "../../theory/chords";
import { intervalName, semitonesOf } from "../../theory/intervals";
import { ROLE_INFO, analyzeChord, borrowedChords, chordsInScale, diatonicChords, spiceChords, transposeRef, type KeyChord, type Role } from "../../theory/keys";
import { displayNote, mod12, pc } from "../../theory/notes";
import { suggestNext, type SuggestionGroup } from "../../theory/progression";
import { SCALES, SCALE_FAMILIES, bestTonicSpelling, getScale, isHeptatonic, scaleNotes } from "../../theory/scales";
import { ChordDiagram } from "../components/ChordDiagram";
import { ROLE_CLASS, Seg, displayRoman, toneClass } from "../components/common";
import { BarRuler } from "../components/BarRuler";
import { DrumMachine } from "../components/DrumMachine";
import { HarpPanel, type Link } from "../components/HarpPanel";
import { MelodyGrid } from "../components/MelodyGrid";
import { letterClass } from "../letters";
import { ShapeFinder, ShapesIcon } from "../components/ShapeFinder";
import { DragCtx, useDraggable, type DragApi, type Payload } from "../drag";
import { barOf, chordBeats, fitBeats, newId, useApp, type ArrangeSettings, type Pane, type ProgChord, type Progression } from "../state";

/** Guitar: key → mode → chords → shapes → your progression. */
export function GuitarView() {
  const { state, set, shapeOf, sheet, openSheet, tuning, toast } = useApp();
  const prog = state.progression;
  const beat = prog.beat ?? DEFAULT_BEAT;
  const stepSink = useRef<((step: number) => void) | null>(null);
  const [nowIdx, setNowIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  /** true while the whole song is playing (the tray follows it section by section) */
  const [songMode, setSongMode] = useState(false);
  const [drag, setDrag] = useState<(Payload & { index: number | null }) | null>(null);
  const player = useRef<ProgressionPlayer | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  /** the slim bar that stands in for the tray while the tray itself is off screen */
  const miniRef = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = dockRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setAway(!e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const ghostRef = useRef<HTMLDivElement>(null);
  const lastDrag = useRef(0);
  /** the tray's height, so the page keeps its shape while the tray is lifted up next to the shape finder */
  const dockH = useRef(0);
  useLayoutEffect(() => {
    if (!sheet && dockRef.current) dockH.current = dockRef.current.getBoundingClientRect().height;
  });

  // Shapes in the tray: either each chord's own shape, or (when Arrange is on) a set
  // chosen together so they sit in one area of the neck. Shapes you set by hand stay put.
  const arr = prog.arrange ?? null;
  const { capo, avoidBarre } = state.settings;
  const arrOpts: ArrangeOptions = useMemo(
    () => ({ tuning, capo, avoidBarre, preferOpen: arr?.zone === 0, targetFret: null, allowInversions: arr?.inversions ?? false, zone: arr?.zone ?? null, strings: arr?.strings ?? "any" }),
    [tuning, capo, avoidBarre, arr],
  );
  const chordsKey = JSON.stringify(prog.chords.map((c) => [c.ref, c.voicingId, !!c.rest]));
  const voicingsOf = useCallback(
    (all: ProgChord[]): (Voicing | undefined)[] => {
      // a rest has no shape, and the chords either side of it are arranged as neighbours
      const chords = all.filter((c) => !c.rest);
      const own = chords.map((c) => shapeOf(c.ref, c.voicingId));
      const vs = arr ? arrangeProgression(chords.map((c) => c.ref), { ...arrOpts, pinned: chords.map((c, i) => (c.voicingId ? own[i] : undefined)) }) : own;
      let k = 0;
      return all.map((c) => (c.rest ? undefined : vs[k++]));
    },
    [arr, arrOpts, shapeOf],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const voicings = useMemo(() => voicingsOf(prog.chords), [chordsKey, voicingsOf]);

  /** Set one spot's shape by hand. Everything else keeps the shape it has now. */
  const pinSlot = (slotId: string, voicingId: string) =>
    set((s) => ({
      ...s,
      progression: {
        ...s.progression,
        chords: s.progression.chords.map((c, i) => (c.id === slotId ? { ...c, voicingId } : s.progression.arrange && !c.voicingId ? { ...c, voicingId: voicings[i]?.id } : c)),
      },
    }));
  /** Step one spot to the next shape that fits best between its neighbours. */
  const stepSlot = (i: number, dir: -1 | 1) => {
    const c = prog.chords[i];
    const list = fitAlternatives(c.ref, arrOpts, voicings[i - 1], voicings[i + 1]);
    if (!list.length) return;
    const at = list.findIndex((v) => v.id === voicings[i]?.id);
    const next = list[(Math.max(at, 0) + dir + list.length) % list.length];
    pinSlot(c.id, next.id);
    if (!playing) strum(next.midi);
  };
  /** Turn Arrange on/off or change its settings: deals a fresh set of shapes. */
  const setArrange = (a: ArrangeSettings | null) =>
    set((s) => ({ ...s, progression: { ...s.progression, arrange: a, chords: s.progression.chords.map((c) => ({ ...c, voicingId: undefined })) } }));
  // the section on screen, played until its drum pattern has finished (the chords repeat if the beat is longer)
  const bar = barOf(prog);
  const swing = beat.on && beat.div === 4 ? beat.swing : 0;
  // the melody of the section on screen (its notes are read as it plays, so a note tapped in is heard next time round)
  // the section's frame: so many bars, and everything in it is written into those bars
  const nBars = barsOr(prog.bars);
  const frame = nBars * bar;
  // the melody has every bar of the section; an empty bar is silent
  const melody = useMemo(() => inBars(prog.melody ?? EMPTY_MELODY, nBars), [prog.melody, nBars]);
  const tune: PlayTune | null = useMemo(() => (hasTune(prog.melody) ? { m: melody, bar, swing } : null), [prog.melody, melody, bar, swing]);
  /** The section as it plays: its chords once, in their bars, then silence to the end of the last bar. */
  const fill = useCallback((chords: ProgChord[], vs: (Voicing | undefined)[], b: Beat, style: PatternId = prog.pattern): PlayItem[] => {
    const len = frameBeats(prog.bars, b.on ? barBeats(b) : styleBar(style));
    const list: PlayItem[] = inFrame(chords, len).map(({ item: c, index: i }) => ({ midi: c.rest ? [] : vs[i]?.midi ?? [], beats: c.beats, feel: prog.feel }));
    const played = list.reduce((a, x) => a + x.beats, 0);
    const any = chords.some((c) => !c.rest) || b.on || !!tune;
    if (!any) return [];
    if (played < len - 1e-6) list.push({ midi: [], beats: len - played, pad: true });
    return list;
  }, [prog.bars, prog.pattern, prog.feel, tune]);
  const items = fill(prog.chords, voicings, beat);

  // The whole song, section after section. A section with no chords is one bar of the beat on its own.
  const secs = useMemo(() => sections(prog), [prog]);
  // Each section plays with its own settings where it has them, and the song's (the first section's) everywhere else.
  const plan = useMemo(() => {
    const list: PlayItem[] = [];
    const map: { block: string; idx: number }[] = [];
    const parts: { sec: Section; voicings: (Voicing | undefined)[] }[] = [];
    const lengths: Record<string, { beats: number; bar: number }> = {};
    /** is there anything in the song to hear? */
    let any = false;
    for (const sec of secs) {
      const vs = sec.current ? voicings : voicingsOf(sec.chords);
      const drums: Beat = { ...beat, ...sec.kit, ...sec.groove, on: sec.groove?.on ?? beat.on };
      const style = sec.style ?? prog.pattern;
      const feel = sec.feel;
      const harp = reviveSound(sec.sound);
      // each section has its own melody, over bars as long as its own drums (or its style) make them
      const secBar = drums.on ? barBeats(drums) : styleBar(style);
      const secTune: PlayTune | null = hasTune(sec.melody) ? { m: inBars(sec.melody, barsOr(sec.bars)), bar: secBar, swing: drums.on && drums.div === 4 ? drums.swing : 0, sound: reviveSound(sec.tuneSound) } : null;
      parts.push({ sec, voicings: vs });
      // the section's frame: everything in it plays in its own bar, for exactly this long
      const len = frameBeats(sec.bars, secBar);
      lengths[sec.blockId] = { beats: len, bar: secBar };
      const inside = inFrame(sec.chords, len);
      inside.forEach(({ item: c, index: i }, k) => {
        list.push({ midi: c.rest ? [] : vs[i]?.midi ?? [], beats: c.beats, drums, style, feel, sound: harp, tune: secTune, section: k === 0 });
        map.push({ block: sec.blockId, idx: i });
      });
      // after the last chord the section goes on to the end of its last bar: drums and melody carry on, the harp is silent
      const played = inside.reduce((a, x) => a + x.item.beats, 0);
      if (played < len - 1e-6) {
        list.push({ midi: [], beats: len - played, drums, tune: secTune, section: !inside.length, pad: true });
        map.push({ block: sec.blockId, idx: -1 });
      }
      if (sec.chords.some((c) => !c.rest) || drums.on || secTune) any = true;
    }
    return { items: list, map, parts, lengths, any };
  }, [secs, voicings, voicingsOf, beat, prog.pattern]);
  const planRef = useRef(plan);
  planRef.current = plan;

  // ── the harp's sound ──
  const sound = useMemo(() => reviveSound(prog.sound), [prog.sound]);
  const hear = useRef(0);
  const voicingsRef = useRef(voicings);
  voicingsRef.current = voicings;
  useEffect(() => setHarpSound(sound, prog.bpm), [sound, prog.bpm]);
  // the melody has a harp of its own, with its own effects
  const tuneSound = useMemo(() => reviveSound(prog.tuneSound), [prog.tuneSound]);
  useEffect(() => setTuneSound(tuneSound, prog.bpm), [tuneSound, prog.bpm]);
  // every note the section (and the song) will need is made ready ahead of time
  useEffect(() => {
    const t = window.setTimeout(() => prepareNotes([...prepFor(items, prog.pattern, beat, tune), ...prepFor(plan.items, prog.pattern, beat)]), 250);
    return () => window.clearTimeout(t);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const playingRef = useRef(false);
  /** Roll the first chord once the knobs have settled, so a change can be heard without pressing play. */
  const hearSoon = useCallback(() => {
    window.clearTimeout(hear.current);
    hear.current = window.setTimeout(() => {
      const v = voicingsRef.current.find((x) => x);
      if (!playingRef.current) strum(v?.midi ?? [48, 55, 60, 64, 67, 72]);
    }, 240);
  }, []);
  const setSound = useCallback((patch: Partial<HarpSound>) => set((s) => ({ ...s, progression: { ...s.progression, sound: { ...reviveSound(s.progression.sound), ...patch } } })), [set]);
  const setTune = useCallback((patch: Partial<HarpSound>) => set((s) => ({ ...s, progression: { ...s.progression, tuneSound: { ...reviveSound(s.progression.tuneSound), ...patch } } })), [set]);
  const keyRef = useRef(state.key);
  keyRef.current = state.key;
  /** One note on the melody's harp, once its knobs have settled. */
  const hearTune = useCallback(() => {
    window.clearTimeout(hear.current);
    hear.current = window.setTimeout(() => !playingRef.current && playNote(melodyBase(keyRef.current) + 12, undefined, 0.86, 48), 240);
  }, []);
  // what the section on screen has of its own, and which section the rest follows
  const linked = useMemo(() => linkState(prog), [prog]);
  const link = (g: SettingGroup): Link => ({ source: linked.source, first: linked.first, own: linked.own[g], onReset: () => set((s) => ({ ...s, progression: relink(s.progression, g) })) });
  const mode = prog.play === "song" ? "song" : "section";
  const pane: Pane = state.pane ?? "frame";

  useEffect(() => {
    if (player.current?.playing) player.current.update(songMode ? plan.items : items, prog.bpm, prog.pattern, !songMode, beat, songMode ? null : tune);
  });
  useEffect(() => () => player.current?.stop(), []);
  playingRef.current = playing;

  const startPlay = (list: PlayItem[], b: Beat, style: PatternId = prog.pattern) => {
    if (!list.length && !b.on && !tune) return;
    getAudio();
    const p = (player.current ??= new ProgressionPlayer());
    p.onStep = (i) => setNowIdx(list[i] && !list[i].pad ? i : -1);
    p.onDrumStep = (n) => stepSink.current?.(n);
    p.onEnd = () => { setPlaying(false); setNowIdx(-1); };
    p.start(list, prog.bpm, style, true, b, 0, tune);
    setSongMode(false);
    setPlaying(true);
  };
  const stopPlay = () => {
    player.current?.stop();
    setPlaying(false);
    setSongMode(false);
    setNowIdx(-1);
  };
  /** Play on through every section, from the one on screen to the end. The page follows along. */
  const startSong = () => {
    if (!plan.any) return toast("Add chords, a melody or drums first");
    getAudio();
    const p = (player.current ??= new ProgressionPlayer());
    p.onStep = (i) => {
      const at = planRef.current.map[i];
      if (!at) return;
      set((s) => (s.progression.song && s.progression.song.current !== at.block ? { ...s, progression: selectBlock(s.progression, at.block) } : s));
      setNowIdx(at.idx);
    };
    p.onDrumStep = (n) => stepSink.current?.(n);
    p.onEnd = () => { setPlaying(false); setSongMode(false); setNowIdx(-1); };
    const from = Math.max(0, plan.map.findIndex((m) => m.block === prog.song?.current));
    p.start(plan.items, prog.bpm, prog.pattern, false, beat, from);
    setSongMode(true);
    setPlaying(true);
  };
  /** ▶ everywhere on the page: round the section on screen, or on through the song, as the song frame says. */
  const togglePlay = () => (playing ? stopPlay() : mode === "song" && secs.length > 1 ? startSong() : startPlay(items, beat));

  const setBeat = useCallback((fn: (b: Beat) => Beat) => set((s) => ({ ...s, progression: { ...s.progression, beat: fn(s.progression.beat ?? DEFAULT_BEAT) } })), [set]);
  /** Load a rhythm. Chords that lasted whole bars keep lasting whole bars (4 beats become 3 in a waltz). */
  const pickBeat = (p: BeatPattern) => {
    const from = barBeats(beat);
    const to = barBeats(p);
    const resize = from !== to && Number.isInteger(from) && Number.isInteger(to);
    const fit = (c: ProgChord) => (c.beats % from === 0 ? { ...c, beats: Math.min(16, (c.beats / from) * to) } : c);
    const chords = resize ? prog.chords.map(fit) : prog.chords;
    const next = applyPattern(beat, p);
    // the rhythm belongs to the section on screen, so only its chords are fitted to the new bar length
    set((s) => ({ ...s, progression: { ...s.progression, chords: resize ? s.progression.chords.map(fit) : s.progression.chords, beat: next } }));
    if (resize && chords.some((c, i) => c.beats !== prog.chords[i].beats)) toast(`Chords: ${to} beats each`);
    // hear it straight away
    if (!playing) {
      startPlay(fill(chords, voicings, next), next);
    }
  };
  /** Choose how the section on screen is played. With the drums off, a waltz style makes the bars three beats long. */
  const pickStyle = (id: PatternId) => {
    const from = barOf(prog);
    const to = barOf({ ...prog, pattern: id });
    const fit = (c: ProgChord) => (from !== to && c.beats % from === 0 ? { ...c, beats: fitBeats((c.beats / from) * to) } : c);
    const chords = prog.chords.map(fit);
    set((s) => ({ ...s, progression: { ...s.progression, pattern: id, chords: s.progression.chords.map(fit) } }));
    if (from !== to && chords.some((c, i) => c.beats !== prog.chords[i].beats)) toast(`Chords: ${to} beats each`);
    // hear it straight away
    if (!playing && chords.length) {
      startPlay(fill(chords, voicings, beat, id), beat, id);
    }
  };
  const setMelody = useCallback((fn: (m: Melody) => Melody) => set((s) => ({ ...s, progression: { ...s.progression, melody: fn(s.progression.melody ?? EMPTY_MELODY) } })), [set]);
  const setFeel = useCallback((patch: Partial<Feel>) => set((s) => ({ ...s, progression: { ...s.progression, feel: { ...reviveFeel(s.progression.feel), ...patch } } })), [set]);
  /** Set how long the section on screen lasts, in bars. */
  const setBars = useCallback((n: number) => set((s) => ({ ...s, progression: { ...s.progression, bars: barsOr(n) } })), [set]);
  const curLetter = secs.find((x) => x.current)?.letter ?? "A";
  const getPos = useCallback(() => player.current?.sectionBeat() ?? null, []);
  const setLengths = useCallback((beats: Record<string, number>) => set((s) => ({ ...s, progression: { ...s.progression, chords: s.progression.chords.map((c) => (beats[c.id] !== undefined ? { ...c, beats: fitBeats(beats[c.id]) } : c)) } })), [set]);
  const drop = useCallback((p: Payload, index: number | null) => {
    if (index === null) return;
    set((s) => {
      const cs = [...s.progression.chords];
      let item: ProgChord;
      if (p.slotId) {
        const from = cs.findIndex((c) => c.id === p.slotId);
        if (from < 0) return s;
        [item] = cs.splice(from, 1);
      } else item = { id: newId(), ref: p.ref, beats: chordBeats(s.progression), voicingId: p.voicingId };
      cs.splice(Math.min(index, cs.length), 0, item);
      return { ...s, progression: { ...s.progression, chords: cs } };
    });
  }, [set]);

  const api = useMemo<DragApi>(() => {
    const indexAt = (x: number, y: number, exclude?: string): number | null => {
      const dock = miniRef.current ?? dockRef.current;
      if (!dock) return null;
      const r = dock.getBoundingClientRect();
      if (y < r.top - 28 || y > r.bottom + 28 || x < r.left - 28 || x > r.right + 28) return null;
      const scroller = dock.querySelector<HTMLElement>(".dock-slots");
      if (scroller) {
        const sr = scroller.getBoundingClientRect();
        if (x > sr.right - 36) scroller.scrollLeft += 14;
        else if (x < sr.left + 36) scroller.scrollLeft -= 14;
      }
      let i = 0;
      for (const el of dock.querySelectorAll<HTMLElement>("[data-slot]")) {
        if (el.dataset.slot === exclude) continue;
        const b = el.getBoundingClientRect();
        if (x < b.left + b.width / 2) break;
        i++;
      }
      return i;
    };
    return {
      justDragged: () => Date.now() - lastDrag.current < 150,
      start: (e, payload) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
        const touch = e.pointerType !== "mouse";
        const pid = e.pointerId;
        const sx = e.clientX;
        const sy = e.clientY;
        let active = false;
        let index: number | null = null;
        let timer: number | undefined;
        const moveGhost = (x: number, y: number) => {
          if (ghostRef.current) ghostRef.current.style.transform = `translate(${x}px, ${y}px)`;
        };
        const activate = (x: number, y: number) => {
          active = true;
          index = indexAt(x, y, payload.slotId);
          setDrag({ ...payload, index });
          requestAnimationFrame(() => moveGhost(x, y));
          if (touch) navigator.vibrate?.(8);
        };
        const cleanup = () => {
          window.clearTimeout(timer);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onCancel);
          document.removeEventListener("touchmove", onTouchMove);
        };
        const onMove = (ev: PointerEvent) => {
          if (ev.pointerId !== pid) return;
          if (!active) {
            const far = Math.hypot(ev.clientX - sx, ev.clientY - sy);
            if (touch) {
              if (far > 10) cleanup(); // it's a scroll, not a drag
              return;
            }
            if (far < 6) return;
            activate(ev.clientX, ev.clientY);
          }
          moveGhost(ev.clientX, ev.clientY);
          const next = indexAt(ev.clientX, ev.clientY, payload.slotId);
          if (next !== index) {
            index = next;
            setDrag({ ...payload, index });
          }
        };
        const onUp = (ev: PointerEvent) => {
          if (ev.pointerId !== pid) return;
          cleanup();
          if (!active) return;
          lastDrag.current = Date.now();
          setDrag(null);
          drop(payload, index);
        };
        const onCancel = () => {
          cleanup();
          if (active) lastDrag.current = Date.now();
          setDrag(null);
        };
        // once a drag is live, stop the page from scrolling under the finger
        const onTouchMove = (ev: TouchEvent) => {
          if (active && ev.cancelable) ev.preventDefault();
        };
        if (touch) timer = window.setTimeout(() => activate(sx, sy), 230);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
        document.addEventListener("touchmove", onTouchMove, { passive: false });
      },
    };
  }, [drop]);

  return (
    <DragCtx.Provider value={api}>
      <div className={`page write${drag ? " dragging" : ""}`}>
        <Transport secs={secs} lengths={plan.lengths} here={{ beats: frame, bar }} playing={playing} following={playing && songMode} onPlay={togglePlay} canPlay={items.length > 0 || plan.any}
          mode={mode} onMode={(m) => set((s) => ({ ...s, progression: { ...s.progression, play: m } }))} />
        <div className="pane" hidden={pane !== "frame"}>
          <FramePage secs={secs} lengths={plan.lengths} here={{ beats: frame, bar }} voicings={voicings} items={items} beat={beat} tune={tune} plan={secs.length ? plan : null} />
        </div>
        <div className="pane" hidden={pane !== "rhythm"}>
          <ChordBoard />
          {/* The tray is part of the page. With the shape finder open it is lifted to the bottom of the screen, so shapes can be dragged straight in. */}
          {sheet && <div style={{ height: dockH.current }} />}
          <div className={`bottom-layer${sheet ? " open" : ""}${drag ? " dragging" : ""}`}>
            {sheet && <div className="finder-backdrop" onClick={() => openSheet(null)} />}
            <ShapeFinder slotShape={(id) => voicings[prog.chords.findIndex((c) => c.id === id)]} onPinSlot={pinSlot} />
            <Dock ref={dockRef} voicings={voicings} nowIdx={nowIdx} drag={drag} onStep={stepSlot} onArrange={setArrange} bar={bar} onLengths={setLengths} length={frame} letter={curLetter} onFit={setBars} />
          </div>
          <HarpPanel sound={sound} setSound={setSound} style={prog.pattern} onStyle={pickStyle} feel={reviveFeel(prog.feel)} setFeel={setFeel} onHear={hearSoon} styleLink={link("style")} soundLink={link("sound")} />
        </div>
        <div className="pane" hidden={pane !== "melody"}>
          <MelodyGrid melody={melody} setMelody={setMelody} keyOf={state.key} bar={bar} chords={prog.chords} playing={playing} getPos={getPos}
            sound={tuneSound} setSound={setTune} onHear={hearTune} link={link("tuneSound")} />
        </div>
        <div className="pane" hidden={pane !== "drums"}>
          <DrumMachine beat={beat} setBeat={setBeat} onPick={pickBeat} playing={playing} stepSink={stepSink} kitLink={link("kit")} grooveLink={link("groove")} frame={nBars} getPos={getPos} />
        </div>
      </div>
      {pane === "rhythm" && away && !sheet && (
        <MiniTray ref={miniRef} chords={prog.chords} voicings={voicings} nowIdx={nowIdx} playing={playing} onPlay={togglePlay} drag={drag} canPlay={prog.chords.length > 0 || beat.on || !!tune}
          onOpen={() => dockRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })} />
      )}
      {drag && <div ref={ghostRef} className="drag-ghost">{chordSymbol(drag.ref)}</div>}
    </DragCtx.Provider>
  );
}

// ── Key & mode ───────────────────────────────────────────────

const MAIN_MODES = ["ionian", "aeolian", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "harmonicMinor", "melodicMinor"];
const PCS = Array.from({ length: 12 }, (_, i) => i);

const KeyBar = memo(function KeyBar() {
  const { state, set } = useApp();
  const key = state.key;
  const scale = getScale(key.scaleId);
  const tonicPc = pc(key.tonic);
  const notes = scaleNotes(key.tonic, scale);
  const sig = scale.signature ?? [];
  const setKey = (tonic: string, scaleId: string) => set((s) => ({ ...s, key: { tonic, scaleId } }));
  const pickScale = (id: string) => setKey(bestTonicSpelling(tonicPc, getScale(id)), id);
  const tonicMidi = 52 + mod12(tonicPc - 4);
  /** Move the whole song up or down: the key, every chord and every melody. */
  const transpose = (n: number) =>
    set((s) => {
      const tonic = bestTonicSpelling(pc(s.key.tonic) + n, getScale(s.key.scaleId));
      const newKey = { ...s.key, tonic };
      // the melody moves with the key, by as much as its grid does (so it stays on the same rows)
      const by = melodyBase(newKey) - melodyBase(s.key);
      const p = mapAllChords(s.progression, (c) => ({ ...c, ref: transposeRef(c.ref, n, newKey), voicingId: undefined }));
      const move = (m: Melody | undefined) => (m ? transposeMelody(m, by) : m);
      return { ...s, key: newKey, progression: { ...p, melody: move(p.melody), song: p.song ? { ...p.song, parts: p.song.parts.map((x) => ({ ...x, melody: move(x.melody) })) } : p.song } };
    });

  return (
    <section className="card keybar">
      <div className="kb-row">
        <span className="kb-label">Key</span>
        <div className="tonics" role="radiogroup" aria-label="Key">
          {PCS.map((p) => {
            const name = bestTonicSpelling(p, scale);
            return <button key={p} role="radio" aria-checked={tonicPc === p} className={tonicPc === p ? "on" : ""} onClick={() => setKey(name, scale.id)}>{displayNote(name)}</button>;
          })}
        </div>
      </div>
      <div className="kb-row">
        <span className="kb-label">Mode</span>
        <div className="modes" role="radiogroup" aria-label="Mode">
          {MAIN_MODES.map((id) => {
            const sc = getScale(id);
            return <button key={id} role="radio" aria-checked={scale.id === id} className={`chip${scale.id === id ? " on" : ""}`} title={sc.mood} onClick={() => pickScale(id)}>{sc.short}</button>;
          })}
          <select className={`chip-select${MAIN_MODES.includes(scale.id) ? "" : " on"}`} aria-label="More scales" value={MAIN_MODES.includes(scale.id) ? "" : scale.id} onChange={(e) => e.target.value && pickScale(e.target.value)}>
            <option value="">More…</option>
            {SCALE_FAMILIES.map((f) => (
              <optgroup key={f} label={f}>
                {SCALES.filter((s) => s.family === f && !MAIN_MODES.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      <div className="kb-row kb-notes">
        <div className="row tight">
          {notes.map((n, i) => {
            const iv = scale.intervals[i];
            return (
              <div key={i} className={`note-chip sm ${toneClass(iv)}${sig.includes(iv) ? " sig" : ""}`} title={intervalName(iv) + (sig.includes(iv) ? " (signature note)" : "")}>
                <b>{displayNote(n)}</b>
                <span>{iv === "1" ? "R" : displaySuffix(iv)}</span>
              </div>
            );
          })}
          <button className="mini-play" aria-label="Play scale" title="Play scale" onClick={() => playSequence([...scale.intervals.map((iv) => tonicMidi + semitonesOf(iv)), tonicMidi + 12])}>▶</button>
        </div>
        <span className="spacer" />
        <span className="kb-move" role="group" aria-label="Move the whole song up or down">
          <span className="kb-label" title="Moves the key, every chord and every melody together">Move song</span>
          <button className="btn sm" aria-label="Down a semitone" onClick={() => transpose(-1)}>− ½</button>
          <button className="btn sm" aria-label="Up a semitone" onClick={() => transpose(1)}>+ ½</button>
        </span>
      </div>
    </section>
  );
});

// ── Chords ───────────────────────────────────────────────────

type View = "key" | "outside" | "next";
const GROUP_LABEL: Record<SuggestionGroup["id"], string> = { natural: "Safe", smooth: "Smooth", color: "Colorful", bold: "Bold" };
/** Short names for the kinds of chord. */
const KIND: Record<string, string> = { Triads: "Triads", "Power & Sus": "Sus", Sixths: "6ths", Sevenths: "7ths", "Added tones": "Added", "Extended (9, 11, 13)": "Extended", "Altered dominants": "Altered" };
/** The plainest chord a note offers, for its card. */
const PLAIN = ["maj", "min", "dim", "aug", "5", "sus2", "sus4", "majb5"];

/** The chord last tapped in one of the chord lists: it gets the Shapes and + buttons. */
const PickCtx = createContext<{ sel: ChordRef | null; setSel: (r: ChordRef) => void }>({ sel: null, setSel: () => {} });
const sameRef = (a: ChordRef | null, b: ChordRef) => !!a && a.root === b.root && a.typeId === b.typeId && a.bass === b.bass;

/**
 * The chords of the key. One card per note of the scale; tap a card and everything the key
 * offers on that note is listed under it (sus, sixths, sevenths, ninths …).
 */
/** The capo: which fret it is on, with the fret that gives the most open shapes in this key marked. */
function CapoPick() {
  const { state, set, tuning } = useApp();
  const key = state.key;
  const hepta = isHeptatonic(getScale(key.scaleId));
  const capo = state.settings.capo;
  // which capo gives the most open (no-barre) shapes in this key
  const bestCapo = useMemo(() => {
    if (!hepta) return null;
    const chords = diatonicChords(key, 3).map((c) => ({ rootPc: pc(c.ref.root), type: c.type }));
    const s = capoSuggestions(chords, tuning);
    const none = s.find((x) => x.capo === 0);
    return none && s[0].capo !== 0 && s[0].easy - none.easy >= 2 ? s[0].capo : null;
  }, [key, tuning, hepta]);
  return (
    <label className="capo">
      Capo
      <select value={capo} onChange={(e) => set((s) => ({ ...s, settings: { ...s.settings, capo: Number(e.target.value) } }))}>
        {Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{i === 0 ? "None" : i}{i === bestCapo ? " ★ no barres" : ""}</option>)}
      </select>
    </label>
  );
}

const ChordBoard = memo(function ChordBoard() {
  const { state, set, openSheet, addChord, toast } = useApp();
  const [sel, setSel] = useState<ChordRef | null>(null);
  const pickCtx = useMemo(() => ({ sel, setSel }), [sel]);
  const key = state.key;
  const scale = getScale(key.scaleId);
  const hepta = isHeptatonic(scale);
  const [view, setView] = useState<View>("key");
  const [size, setSize] = useState<3 | 4>(3);
  const [deg, setDeg] = useState(1);
  const all = useMemo(() => chordsInScale(key), [key]);
  // each note's card: its triad (or seventh chord) built from the scale; in other scales, the plainest chord that fits
  const cards = useMemo(() => {
    const stacked = hepta ? diatonicChords(key, size).filter((c) => !c.type.synthetic) : [];
    return all.map((d) => stacked.find((c) => c.degree === d.degree) ?? [...d.chords].sort((x, y) => (PLAIN.indexOf(x.type.id) + 99) % 99 - (PLAIN.indexOf(y.type.id) + 99) % 99)[0] ?? null);
  }, [all, key, size, hepta]);
  const degree = all.find((d) => d.degree === deg) ?? all[0];
  const picked = sel && view === "key" ? degree?.chords.some((c) => sameRef(sel, c.ref)) : !!sel;

  return (
    <section className="card board">
      <div className="board-head">
        <Seg value={view} options={[{ value: "key", label: "In key" }, { value: "outside", label: "Outside" }, { value: "next", label: "Next" }]} onChange={setView} label="Which chords" />
        {view === "key" && hepta && <Seg value={size} options={[{ value: 3, label: "Triads" }, { value: 4, label: "7ths" }]} onChange={setSize} label="Cards show" />}
        <span className="board-set">
          <button className="key-chip" title="The key of the song: change it on the Frame page" onClick={() => set((s) => ({ ...s, pane: "frame" }))}>{displayNote(key.tonic)} {scale.short}</button>
          <CapoPick />
        </span>
        {sel && picked && (
          <div className="pick-bar">
            <b>{chordSymbol(sel)}</b>
            <button className="shapes-btn" onClick={() => openSheet({ ref: sel })}><ShapesIcon />Shapes</button>
            <button className="kc-add" aria-label={`Add ${chordSymbol(sel)}`} onClick={() => { addChord(sel); toast(`${chordSymbol(sel)} added`); }}>+</button>
          </div>
        )}
      </div>
      <PickCtx.Provider value={pickCtx}>
        {view === "key" && (
          <>
            <div className="key-chords">
              {cards.map((c, i) =>
                c ? <ChordCard key={`${all[i].degree}-${c.type.id}`} c={c} on={degree?.degree === all[i].degree} onPick={() => setDeg(all[i].degree)} />
                  : <button key={all[i].degree} className={`kc bare${degree?.degree === all[i].degree ? " on" : ""}`} onClick={() => setDeg(all[i].degree)}><span className="kc-name">{displayNote(all[i].root)}</span></button>,
              )}
            </div>
            {degree && (
              <div className="deg-all" role="group" aria-label={`Every chord in the key on ${displayNote(degree.root)}`}>
                {CHORD_CATEGORIES.filter((cat) => degree.chords.some((c) => c.type.category === cat)).map((cat) => (
                  <div key={cat} className="degree-row wide">
                    <div className="degree-label">{KIND[cat] ?? cat}</div>
                    <div className="row tight">{degree.chords.filter((c) => c.type.category === cat).map((c) => <Pill key={c.type.id} chord={c.ref} title={c.type.name} />)}</div>
                  </div>
                ))}
                {!degree.chords.length && <span className="faint tiny">No chord fits on {displayNote(degree.root)} in this scale</span>}
              </div>
            )}
            {hepta && (
              <div className="role-legend">
                {(Object.keys(ROLE_INFO) as Role[]).map((r) => <span key={r} title={ROLE_INFO[r].blurb}><i className={`dot ${ROLE_CLASS[r]}`} />{ROLE_INFO[r].label}</span>)}
                <span title="Contains the mode's signature note"><b style={{ color: "var(--ext)" }}>★</b> Signature</span>
              </div>
            )}
          </>
        )}
        {view === "outside" && <OutsideChords />}
        {view === "next" && <NextChords />}
      </PickCtx.Provider>
    </section>
  );
});

function ChordCard({ c, on, onPick }: { c: KeyChord; on: boolean; onPick: () => void }) {
  const { state, openSheet, audition, addChord, shapeOf } = useApp();
  const { capo, labels, leftHanded } = state.settings;
  const v = shapeOf(c.ref);
  const tap = () => { audition(c.ref); onPick(); };
  const d = useDraggable({ ref: c.ref }, tap);
  const name = chordSymbol(c.ref);
  return (
    <div className={`kc draggable role-${c.role}${on ? " on" : ""}`} role="button" tabIndex={0} aria-pressed={on} aria-label={`${name}${c.role ? `, ${ROLE_INFO[c.role].label}` : ""}. Play, and list its other chords`} title={c.role ? ROLE_INFO[c.role].label : undefined} {...d}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) tap(); }}>
      <span className="kc-head">
        <span className="kc-roman">{displayRoman(c.roman)}</span>
        {c.signature && <span className="kc-star">★</span>}
      </span>
      <span className="kc-name">{name}</span>
      {v && <ChordDiagram voicing={v} root={c.ref.root} labels={labels} width={120} leftHanded={leftHanded} capo={capo} />}
      <div className="kc-actions" data-nodrag>
        <button className="shapes-btn" aria-label={`Other ways to play ${name}`} title="Other ways to play it" aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); openSheet({ ref: c.ref }); }}><ShapesIcon />Shapes</button>
        <button className="kc-add" aria-label={`Add ${name}`} onClick={(e) => { e.stopPropagation(); addChord(c.ref); }}>+</button>
      </div>
    </div>
  );
}

/** A chord as a small draggable pill: tap to hear it (Shapes and + then appear at the top), drag to add. */
function Pill({ chord, tone, title }: { chord: ChordRef; tone?: string; title?: string }) {
  const { audition } = useApp();
  const { sel, setSel } = useContext(PickCtx);
  const d = useDraggable({ ref: chord }, () => { audition(chord); setSel(chord); });
  return <button className={`chip draggable${tone ? ` ${tone}` : ""}${sameRef(sel, chord) ? " sel" : ""}`} title={title} aria-pressed={sameRef(sel, chord)} {...d}>{chordSymbol(chord)}</button>;
}

function OutsideChords() {
  const { state } = useApp();
  const key = state.key;
  const borrowed = useMemo(() => borrowedChords(key), [key]);
  const spice = useMemo(() => spiceChords(key), [key]);
  const sources = [...new Set(borrowed.map((c) => c.fromIds[0]))];
  return (
    <div>
      {sources.map((sid) => (
        <div key={sid} className="degree-row wide">
          <div className="degree-label">{getScale(sid).short}</div>
          <div className="row tight">
            {borrowed.filter((c) => c.fromIds[0] === sid).map((c) => <Pill key={c.ref.root + c.type.id} chord={c.ref} title={c.explain} />)}
          </div>
        </div>
      ))}
      {spice.map((g) => (
        <div key={g.group} className="degree-row wide">
          <div className="degree-label" title={g.blurb}>{g.group.replace("Secondary dominants", "Lead-ins").replace("Chromatic mediants", "Cinematic").replace("Tritone substitutions", "Jazz swaps").replace("Passing diminished", "Passing")}</div>
          <div className="row tight">
            {g.chords.map((c) => <Pill key={c.roman + c.ref.root} chord={c.ref} title={c.short ?? c.explain} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function NextChords() {
  const { state } = useApp();
  const chords = state.progression.chords.filter((c) => !c.rest);
  const last = chords[chords.length - 1]?.ref ?? null;
  const refsKey = JSON.stringify(chords.map((c) => c.ref));
  const groups = useMemo(() => suggestNext(last, state.key, chords.map((c) => c.ref), 8), [refsKey, state.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      {groups.map((g) => (
        <div key={g.id} className="degree-row wide">
          <div className={`degree-label g-${g.id}`} title={g.blurb}><i className="gdot" />{GROUP_LABEL[g.id]}</div>
          <div className="row tight">
            {g.items.map((s, i) => <Pill key={i} chord={s.chord.ref} title={s.why} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Progression dock ─────────────────────────────────────────


/**
 * The song as a row of lettered blocks: A B A C … Tap one to work on it. Drag it (or use ◀ ▶) to move it.
 * Copy and Paste repeat a section; the same letter twice is the same music.
 */
/**
 * The song: its sections in order, what ▶ does (go round the section on screen, or play on through
 * the song), and the three things each section is made of. It stays at the top of the screen.
 */
type Lengths = Record<string, { beats: number; bar: number }>;
type Len = { beats: number; bar: number };
/** A section's length in bars, small, beside its letter. */
const lenTag = (l?: Len) => (l && l.beats > 0 ? <small className="sec-len">{barsText(l.beats, l.bar)}</small> : null);
type Row = { blockId: string; partId: string; letter: string; current: boolean };
/** The sections in playing order. With no song yet, what is on the page is section A. */
const rowsOf = (secs: Section[]): Row[] => (secs.length ? secs : [{ blockId: "", partId: "", letter: "A", current: true }]);

/**
 * Play, on every page: the one ▶ button, what it does (go round this section, or play on through
 * the song), and the sections, to move from one to another.
 */
function Transport({ secs, lengths, here, playing, following, onPlay, canPlay, mode, onMode }: {
  secs: Section[];
  /** how long every section lasts, by block */
  lengths: Lengths;
  /** how long the section on screen lasts */
  here: Len;
  playing: boolean;
  /** the whole song is playing: the page is following it from section to section */
  following: boolean;
  onPlay: () => void;
  canPlay: boolean;
  mode: "section" | "song";
  onMode: (m: "section" | "song") => void;
}) {
  const { state, set } = useApp();
  const rows = rowsOf(secs);
  const cur = rows.find((x) => x.current) ?? rows[0];
  const row = useRef<HTMLDivElement>(null);
  // keep the selected section in view (sideways only: the page itself must not jump)
  useEffect(() => {
    const r = row.current;
    const el = r?.querySelector<HTMLElement>(".sec.on");
    if (!r || !el) return;
    if (el.offsetLeft < r.scrollLeft) r.scrollLeft = el.offsetLeft - 8;
    else if (el.offsetLeft + el.offsetWidth > r.scrollLeft + r.clientWidth) r.scrollLeft = el.offsetLeft + el.offsetWidth - r.clientWidth + 8;
  }, [cur.blockId, rows.length]);
  return (
    <section className={`song-frame transport${following ? " following" : ""}`} aria-label="Play">
      <button className={`play-btn sm${playing ? " stop" : ""}`} onClick={onPlay} aria-label={playing ? "Stop" : mode === "song" ? "Play the song" : `Play section ${cur.letter}`} disabled={!playing && !canPlay}>{playing ? "■" : "▶"}</button>
      <div className="seg sf-mode" role="radiogroup" aria-label="What play does">
        <button role="radio" aria-checked={mode === "section"} className={mode === "section" ? "on" : ""} title={`Go round section ${cur.letter} again and again`} onClick={() => onMode("section")}>↻ {cur.letter}</button>
        <button role="radio" aria-checked={mode === "song"} className={mode === "song" ? "on" : ""} title="Play on through every section to the end of the song" onClick={() => onMode("song")}>→ Song</button>
      </div>
      <div className="arrange songbar" ref={row} role="group" aria-label="Sections">
        {rows.map((x) => (
          <span key={x.blockId || "a"} className={`sec ${letterClass(x.letter)}${x.current ? " on" : ""}`}>
            <button className="sec-name" aria-pressed={x.current} aria-label={`Section ${x.letter}`} onClick={() => x.blockId && !x.current && set((s) => ({ ...s, progression: selectBlock(s.progression, x.blockId) }))}>{x.letter}{lenTag(x.current ? here : lengths[x.blockId])}</button>
          </span>
        ))}
      </div>
      <button className="sf-sum" title="Key and tempo: change them on the Frame page" onClick={() => set((s) => ({ ...s, pane: "frame" }))}>{displayNote(state.key.tonic)} {getScale(state.key.scaleId).short} · {state.progression.bpm}</button>
    </section>
  );
}

/**
 * The frame: everything that the three parts play inside. The sections in order and how many
 * bars each one has, the key, the tempo, and the way out (MIDI, chords and tab).
 */
function FramePage({ secs, lengths, here, voicings, items, beat, tune, plan }: {
  secs: Section[];
  lengths: Lengths;
  here: Len;
  voicings: (Voicing | undefined)[];
  items: PlayItem[];
  beat: Beat;
  tune: PlayTune | null;
  plan: SongPlan | null;
}) {
  const { state, set, tuning, toast, idea } = useApp();
  const prog = state.progression;
  /** the section whose quick lengths are open */
  const [picking, setPicking] = useState<string | null>(null);
  const change = (fn: (p: Progression) => Progression) => set((s) => ({ ...s, progression: fn(s.progression) }));
  const open = (blockId: string, pane: Pane) => set((s) => ({ ...s, pane, progression: blockId ? selectBlock(s.progression, blockId) : s.progression }));
  const rows = rowsOf(secs);
  const song = prog.song;
  const nextFree = song ? nextLetter(song.parts) : "B";
  const uniq = letters(prog);
  const lenOf = (x: Row): Len => (x.current ? here : lengths[x.blockId] ?? here);
  const totalBars = rows.reduce((a, x) => a + lenOf(x).beats / lenOf(x).bar, 0);
  const secsLong = Math.round((rows.reduce((a, x) => a + lenOf(x).beats, 0) * 60) / prog.bpm);
  /** what a section has in it: chords, a melody, drums */
  const filled = (x: Row) => {
    const sec = secs.find((y) => y.blockId === x.blockId);
    const chords = (sec ? sec.chords : prog.chords).filter((c) => !c.rest).length;
    return { rhythm: chords, melody: hasTune(sec ? sec.melody : prog.melody), drums: sec ? sec.groove?.on ?? beat.on : beat.on };
  };
  const addNew = () => change((p) => addNewSection(p));
  const again = (partId: string) => change((p) => repeatSection(p, partId || ensureSong(p).song!.parts[0].id));

  // ── the way out ──
  const name = idea?.name ?? "";
  const scale = getScale(state.key.scaleId);
  const hasChords = prog.chords.length > 0 || !!plan?.parts.some((x) => x.sec.chords.length);
  const chart = () => {
    const stringNames = tuning.notes.map((m) => ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][(m + state.settings.capo) % 12]);
    const head = `${name || "Untitled"} | ${state.key.tonic} ${scale.name} | ${prog.bpm} bpm${state.settings.capo ? ` | Capo ${state.settings.capo}` : ""}`;
    const block = (chords: ProgChord[], vs: (Voicing | undefined)[]) => {
      const names = chords.map((c) => (c.rest ? "-" : chordSymbolAscii(c.ref)));
      const real = chords.map((c, i) => ({ c, v: vs[i], name: names[i] })).filter((x) => !x.c.rest);
      return ["| " + names.join(" | ") + " |", "  " + chords.map((c) => (c.rest ? "-" : analyzeChord(c.ref, state.key).roman)).join("  "), "", tabText(real.map((x) => x.v), real.map((x) => x.name), stringNames)];
    };
    if (!plan) return [head, "", ...block(prog.chords, voicings)].join("\n");
    // a song: the running order, then each different section once
    const out = [head, "", plan.parts.map((x) => x.sec.letter).join(" "), ""];
    const done = new Set<string>();
    for (const { sec, voicings: vs } of plan.parts) {
      if (done.has(sec.partId)) continue;
      done.add(sec.partId);
      out.push(`[${sec.letter}] ${barsOr(sec.bars)} bars`, ...(sec.chords.length ? block(sec.chords, vs) : ["(no chords)"]), "");
    }
    return out.join("\n");
  };
  const copy = async () => {
    const text = chart();
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      const r = await saveFile(new TextEncoder().encode(text), "chords.txt", "text/plain");
      if (r === "failed") toast("Couldn't copy here");
    }
  };
  const midi = async () => {
    const r = await saveFile(progressionToMidi(plan ? plan.items : items, prog.bpm, prog.pattern, name || "M-Theory idea", beat, plan ? null : tune), `${(name || "m-theory-idea").replace(/[^\w-]+/g, "-")}.mid`, "audio/midi");
    toast(r === "saved" ? "MIDI saved" : r === "failed" ? "Can't save files here" : "Cancelled");
  };
  const canExport = plan ? plan.any : items.length > 0;
  const setBpm = (n: number) => change((p) => ({ ...p, bpm: Math.max(40, Math.min(200, Math.round(n))) }));

  return (
    <>
      <section className="card fr-secs" aria-label="Sections">
        <div className="fr-head">
          <h2>Sections</h2>
          <span className="pill" title="How long the whole song is">{barsText(totalBars, 1)} bars · {Math.floor(secsLong / 60)}:{String(secsLong % 60).padStart(2, "0")}</span>
        </div>
        <ol className="fr-list">
          {rows.map((x, i) => {
            const l = lenOf(x);
            const n = Math.round(l.beats / l.bar);
            const f = filled(x);
            const shared = !!x.partId && rows.filter((y) => y.partId === x.partId).length > 1;
            const id = x.blockId || "a";
            return (
              <li key={id} className={`fr-sec ${letterClass(x.letter)}${x.current ? " on" : ""}`} data-block={x.blockId}>
                <button className="fr-letter" aria-pressed={x.current} aria-label={`Section ${x.letter}${x.current ? ", the one you are working on" : ": work on this one"}`} onClick={() => x.blockId && change((p) => selectBlock(p, x.blockId))}>{x.letter}</button>
                <span className="fr-len" role="group" aria-label={`How long section ${x.letter} lasts`}>
                  <button aria-label={`Make ${x.letter} a bar shorter`} disabled={n <= 1} onClick={() => change((p) => setSectionBars(p, x.blockId, stepBars(l.beats, l.bar, -1)))}>−</button>
                  <button className="fr-len-n" aria-expanded={picking === id} aria-label={`Section ${x.letter}: ${n} bar${n === 1 ? "" : "s"}. Choose a length`} onClick={() => setPicking(picking === id ? null : id)}>{barsText(l.beats, l.bar)}<small>{n === 1 ? "bar" : "bars"}</small></button>
                  <button aria-label={`Make ${x.letter} a bar longer`} disabled={n >= MAX_SECTION_BARS} onClick={() => change((p) => setSectionBars(p, x.blockId, stepBars(l.beats, l.bar, 1)))}>+</button>
                </span>
                <span className="fr-tools">
                  {rows.length > 1 && <button aria-label={`Move ${x.letter} earlier`} disabled={i === 0} onClick={() => change((p) => moveBlock(p, x.blockId, -1))}>↑</button>}
                  {rows.length > 1 && <button aria-label={`Move ${x.letter} later`} disabled={i === rows.length - 1} onClick={() => change((p) => moveBlock(p, x.blockId, 1))}>↓</button>}
                  {secs.length > 0 && <button aria-label={`Remove ${x.letter}`} title="Remove" onClick={() => change((p) => removeBlock(p, x.blockId))}>✕</button>}
                </span>
                <span className="fr-parts">
                  <button className={`fr-part${f.rhythm ? " has" : ""}`} title={`${x.letter}: chords and how they are played`} onClick={() => open(x.blockId, "rhythm")}>Rhythm{f.rhythm ? <small>{f.rhythm}</small> : null}</button>
                  <button className={`fr-part${f.melody ? " has" : ""}`} title={`${x.letter}: melody`} onClick={() => open(x.blockId, "melody")}>Melody</button>
                  <button className={`fr-part${f.drums ? " has" : ""}`} title={`${x.letter}: drums`} onClick={() => open(x.blockId, "drums")}>Drums</button>
                  {shared && <button className="fr-unlink" title={`This ${x.letter} is the same music as the other ${x.letter}. Give it its own letter so it can differ`} onClick={() => { change((p) => (sharedCount(p, x.blockId) > 1 ? unlinkBlock(p, x.blockId) : p)); toast("Now a section of its own"); }}>Unlink</button>}
                </span>
                {picking === id && (
                  <span className="fr-pick" role="group" aria-label={`Length of section ${x.letter}, in bars`}>
                    {QUICK_BARS.map((b) => <button key={b} className={`chip${n === b ? " on" : ""}`} aria-pressed={n === b} onClick={() => { change((p) => setSectionBars(p, x.blockId, b)); setPicking(null); }}>{b}</button>)}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <div className="fr-add">
          <button className={`sec-add ${letterClass(nextFree)}`} title="A new section with its own chords, melody and length" onClick={addNew}>+ New section {nextFree}</button>
          {(uniq.length ? uniq : [{ partId: "", letter: "A" }]).map((u) => (
            <button key={u.partId || "a"} className={`sec-add again ${letterClass(u.letter)}`} title={`Play ${u.letter} again at this point in the song`} onClick={() => again(u.partId)}>{u.letter} again</button>
          ))}
        </div>
      </section>

      <KeyBar />

      <section className="card fr-tempo" aria-label="Tempo">
        <div className="fr-head"><h2>Tempo</h2><b className="mono fr-bpm">{prog.bpm}<small>bpm</small></b></div>
        <div className="fr-row fr-slide">
          <button className="btn sm" aria-label="Slower" onClick={() => setBpm(prog.bpm - 1)}>−</button>
          <input type="range" min={40} max={200} value={prog.bpm} aria-label="Tempo" onChange={(e) => setBpm(Number(e.target.value))} />
          <button className="btn sm" aria-label="Faster" onClick={() => setBpm(prog.bpm + 1)}>+</button>
        </div>
      </section>

      <section className="card fr-out" aria-label="Export">
        <div className="fr-head"><h2>Export</h2></div>
        <div className="fr-row">
          <button className="btn" disabled={!canExport} title="The chords as the harp plays them, the melody and the drums, each on its own track" onClick={midi}>MIDI file</button>
          <button className="btn" disabled={!hasChords} title="Chord names and guitar tab, as text" onClick={copy}>Copy chords + tab</button>
        </div>
      </section>
    </>
  );
}

function Dock({ ref, voicings, nowIdx, drag, onStep, onArrange, bar, onLengths, length, letter, onFit }: {
  ref: React.Ref<HTMLDivElement>;
  voicings: (Voicing | undefined)[];
  nowIdx: number;
  drag: (Payload & { index: number | null }) | null;
  onStep: (i: number, dir: -1 | 1) => void;
  onArrange: (a: ArrangeSettings | null) => void;
  /** beats in a bar */
  bar: number;
  onLengths: (beats: Record<string, number>) => void;
  /** how long the section lasts, in beats; its letter; and a way to make it longer */
  length: number;
  letter: string;
  onFit: (bars: number) => void;
}) {
  const { state, set } = useApp();
  const chords = state.progression.chords;
  const arr = state.progression.arrange ?? null;
  const span = fretSpan(voicings);
  /** A silence, one bar long, after the last chord. (Its chord is only a placeholder: nothing is played.) */
  const addRest = () => set((s) => ({ ...s, progression: { ...s.progression, chords: [...s.progression.chords, { id: newId(), ref: { root: s.key.tonic, typeId: "maj" }, beats: chordBeats(s.progression), rest: true }] } }));
  const marker = <span key="marker" className="drop-marker" />;
  const els: React.ReactNode[] = [];
  let k = 0;
  chords.forEach((c, i) => {
    const isDragged = drag?.slotId === c.id;
    if (!isDragged) {
      if (drag && drag.index === k) els.push(marker);
      k++;
    }
    // a chord that starts after the section has ended is never reached
    const out = chords.slice(0, i).reduce((a, x) => a + x.beats, 0) >= length - 1e-6;
    els.push(<Slot key={c.id} c={c} i={i} v={voicings[i]} now={nowIdx === i} dragged={isDragged} out={out} onStep={(d) => onStep(i, d)} />);
  });
  if (drag && drag.index !== null && drag.index >= k) els.push(marker);

  return (
    <div className={`dock${chords.length ? "" : " bare"}${drag ? " armed" : ""}${drag?.index != null ? " over" : ""}`} ref={ref}>
      <div className="dock-inner">
        {chords.length >= 2 && (
          <div className="arrange">
            <span className="kb-label">Arrange</span>
            <div className="seg" role="radiogroup" aria-label="Arrange all chords in one area of the neck">
              <button role="radio" aria-checked={!arr} className={arr ? "" : "on"} onClick={() => onArrange(null)}>My shapes</button>
              {POSITIONS.slice(0, 5).map((p, z) => (
                <button key={p} role="radio" aria-checked={arr?.zone === z} className={arr?.zone === z ? "on" : ""} title={z === 0 ? "Open position" : `Around frets ${p}`}
                  onClick={() => onArrange({ strings: arr?.strings ?? "any", inversions: arr?.inversions ?? false, zone: z })}>{p}</button>
              ))}
            </div>
            {arr && (
              <>
                <span className="kb-label">Strings</span>
                <Seg value={arr.strings} options={[{ value: "any", label: "Any" }, { value: 3, label: "3" }, { value: 4, label: "4" }, { value: 5, label: "5–6" }]} onChange={(v) => onArrange({ ...arr, strings: v })} label="Strings per chord" />
                <button className={`chip${arr.inversions ? " on" : ""}`} aria-pressed={arr.inversions} title="Allow a different bass note for smoother changes" onClick={() => onArrange({ ...arr, inversions: !arr.inversions })}>Inversions</button>
              </>
            )}
            {span && <span className="span">frets {span[0]}–{span[1]}</span>}
          </div>
        )}
        <div className="dock-main">
        <div className="dock-slots">
          {chords.length === 0 && !drag ? <span className="dock-empty">Drag chords here</span> : els}
          {chords.length === 0 && drag && drag.index === null && <span className="dock-empty">Drop here</span>}
        </div>
        </div>
        <div className="dock-foot">
          <BarRuler chords={chords} bar={bar} length={length} letter={letter} onFit={onFit} nowIdx={nowIdx} onChange={onLengths} />
          <button className="rest-add" title="Add a bar of silence after the last chord" onClick={addRest}>+ Rest</button>
          {chords.length > 0 && <button className="rest-add clear" title="Take every chord out of this section" onClick={() => set((s) => ({ ...s, progression: { ...s.progression, chords: [] } }))}>Clear</button>}
        </div>
      </div>
    </div>
  );
}

/**
 * The tray in one line, shown while the tray itself is off screen: play, the chords by name, and a way back.
 * Chords can be dropped on it; tap a name to hear it.
 */
function MiniTray({ ref, chords, voicings, nowIdx, playing, onPlay, drag, canPlay, onOpen }: {
  ref: React.Ref<HTMLDivElement>;
  chords: ProgChord[];
  voicings: (Voicing | undefined)[];
  nowIdx: number;
  playing: boolean;
  onPlay: () => void;
  drag: (Payload & { index: number | null }) | null;
  canPlay: boolean;
  onOpen: () => void;
}) {
  const { state } = useApp();
  const marker = <span key="marker" className="drop-marker" />;
  const els: React.ReactNode[] = [];
  chords.forEach((c, i) => {
    if (drag && drag.index === i) els.push(marker);
    const st = c.rest ? "rest" : analyzeChord(c.ref, state.key).status;
    els.push(<button key={c.id} data-slot={c.id} className={`mini-chip st-${st}${nowIdx === i ? " now" : ""}`} aria-label={c.rest ? "Rest" : undefined} onClick={() => { const v = voicings[i]; if (v) strum(v.midi); }}>{c.rest ? "–" : chordSymbol(c.ref)}</button>);
  });
  if (drag && drag.index !== null && drag.index >= chords.length) els.push(marker);
  return (
    <div className={`mini-tray${drag ? " armed" : ""}`} ref={ref} role="group" aria-label="Your chords">
      <button className={`play-btn sm${playing ? " stop" : ""}`} onClick={onPlay} aria-label={playing ? "Stop" : "Play"} disabled={!canPlay}>{playing ? "■" : "▶"}</button>
      <div className="dock-slots mini-slots">{els.length ? els : <span className="dock-empty">{drag ? "Drop here" : "Tap + on a chord"}</span>}</div>
      <button className="icon-btn" aria-label="Open the tray" title="Shapes, lengths and sections" onClick={onOpen}>⌃</button>
    </div>
  );
}

function Slot({ c, i, v, now, dragged, out, onStep }: { c: ProgChord; i: number; v?: Voicing; now: boolean; dragged: boolean; out?: boolean; onStep: (d: -1 | 1) => void }) {
  const { state, set, openSheet } = useApp();
  const play = () => v && strum(v.midi);
  const d = useDraggable({ ref: c.ref, slotId: c.id }, play);
  const a = analyzeChord(c.ref, state.key);
  const name = chordSymbol(c.ref);
  const remove = (e: React.MouseEvent) => { e.stopPropagation(); set((s) => ({ ...s, progression: { ...s.progression, chords: s.progression.chords.filter((x) => x.id !== c.id) } })); };
  // a rest: a silence with a length, and nothing else
  if (c.rest)
    return (
      <div className={`slot rest draggable${now ? " now" : ""}${dragged ? " dragged" : ""}${out ? " out" : ""}`} data-slot={c.id} role="group" aria-label={`Rest, ${i + 1} in the row${out ? ", past the end of the section" : ""}`} {...d}>
        <span className="sym">Rest</span>
        <span className="rest-mark" aria-hidden="true">–</span>
        <button className="slot-x" data-nodrag aria-label="Remove the rest" onClick={remove}>✕</button>
      </div>
    );
  return (
    <div className={`slot draggable st-${a.status}${now ? " now" : ""}${dragged ? " dragged" : ""}${out ? " out" : ""}`} data-slot={c.id} role="button" tabIndex={0}
      aria-label={`Chord ${i + 1}: ${name}${out ? ", past the end of the section" : ""}. Play`} {...d} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) play(); }}>
      <span className="sym">{name}</span>
      {v && <ChordDiagram voicing={v} root={c.ref.root} bass={c.ref.bass} labels={state.settings.labels} width={116} compact leftHanded={state.settings.leftHanded} capo={state.settings.capo} />}
      <button className="slot-x" data-nodrag aria-label={`Remove ${name}`} onClick={remove}>✕</button>
      <div className="slot-step" data-nodrag onClick={(e) => e.stopPropagation()}>
        <button aria-label={`Previous shape for ${name}`} title="Previous shape that fits here" onClick={() => onStep(-1)}>‹</button>
        <button className="slot-shapes" aria-label={`Other ways to play ${name}`} title="All shapes, length, remove" aria-haspopup="dialog" onClick={() => openSheet({ ref: c.ref, slotId: c.id })}><ShapesIcon /></button>
        <button aria-label={`Next shape for ${name}`} title="Next shape that fits here" onClick={() => onStep(1)}>›</button>
      </div>
    </div>
  );
}

// ── Song menu ────────────────────────────────────────────────

function tabText(vs: (Voicing | undefined)[], names: string[], stringNames: string[]): string {
  const width = 8;
  const lines = stringNames.map((n) => `${n.padEnd(2)}|`).reverse();
  const header = "   " + names.map((n) => n.padEnd(width)).join("");
  vs.forEach((v) => {
    for (let s = 0; s < stringNames.length; s++) {
      const f = v?.frets[s];
      const cell = f === null || f === undefined ? "x" : String(f);
      lines[stringNames.length - 1 - s] += ("-" + cell).padEnd(width - 1, "-") + "|";
    }
  });
  return [header, ...lines].join("\n");
}

type SongPlan = { items: PlayItem[]; parts: { sec: Section; voicings: (Voicing | undefined)[] }[]; any: boolean };
