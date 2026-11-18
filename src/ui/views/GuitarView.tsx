import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_BEAT, applyPattern, grooveOf, kitOfBeat, type Beat, type BeatPattern } from "../../audio/beats";
import { progressionToMidi, saveFile } from "../../audio/midi";
import { reviveFeel, type ExtraPlay, type Feel, type PatternId, type PlayItem, type PlayTune } from "../../audio/patterns";
import { reviveSound, type HarpSound } from "../../audio/rack";
import { ProgressionPlayer, getAudio, hearOn, playNote, playSequence, prepFor, prepareNotes, renderSong, setHarpSound, setTuneSound, strum } from "../../audio/synth";
import { arrangeProgression, capoSuggestions, fitAlternatives, fretSpan, type ArrangeOptions } from "../../guitar/arrange";
import { POSITIONS } from "../../guitar/shapeMap";
import type { Voicing } from "../../guitar/voicings";
import { EMPTY_MELODY, hasTune, inBars, melodyBase, transposeMelody, type Melody } from "../../song/melody";
import { barsOr, fitLoop, frameBeats, inFrame, inLoop, loopSection, sliceItems, tapLoop, type BarRef, type LoopSpan } from "../../song/frame";
import { linkState, mapAllChords, mapAllMelodies, relink, sections, selectBlock, soloSection, type Section, type SettingGroup } from "../../song/structure";
import { CHORD_CATEGORIES, chordSymbol, chordSymbolAscii, displaySuffix, type ChordRef } from "../../theory/chords";
import { intervalName, semitonesOf } from "../../theory/intervals";
import { CHORD_ROWS, ROLE_INFO, analyzeChord, borrowedChords, chordRow, chordsInScale, diatonicChords, spiceChords, transposeRef, type Key, type KeyChord, type Role } from "../../theory/keys";
import { displayNote, mod12, pc } from "../../theory/notes";
import { suggestNext, type SuggestionGroup } from "../../theory/progression";
import { SCALES, SCALE_FAMILIES, bestTonicSpelling, getScale, isHeptatonic, scaleNotes } from "../../theory/scales";
import { ChordDiagram } from "../components/ChordDiagram";
import { ROLE_CLASS, Seg, displayRoman, toneClass } from "../components/common";
import { BarRuler } from "../components/BarRuler";
import { BarsControl, useBarsView } from "../components/BarsControl";
import type { BarsShown } from "../../song/window";
import { CanvasPage } from "../components/CanvasPage";
import type { Spot } from "../../canvas/layout";
import { DrumMachine } from "../components/DrumMachine";
import { HarpPanel, type Link } from "../components/HarpPanel";
import { MelodyGrid } from "../components/MelodyGrid";
import { TrackPage, type TrackSection } from "../components/TrackPage";
import { VocalsPage, type RecordPlan } from "../components/VocalsPage";
import { setMix } from "../../audio/mix";
import { addTrack, allTracks, focusTrack, isFirst, normalize, removeTrack, tracksOf, type EditKind, type Layers, type Track } from "../../song/tracks";
import { CopyIcon, PasteIcon } from "../icons";
import { activeTake, groupsOf, type Take } from "../../song/takes";
import { encodeWav, safeGain, trimEnd } from "../../audio/wav";
import { keepTakes, loadTake, takeBuffer, takeKey } from "../../audio/takebuffers";
import { letterClass } from "../letters";
import { TIME_SIGS, isCompound, sameSig, sigBeats, sigName, type TimeSig } from "../../song/meter";
import { sectionSig, setSig, sigOf } from "../../song/unity";
import { FrameSections } from "../components/FrameSections";
import { ShapeFinder, ShapesIcon } from "../components/ShapeFinder";
import { DragCtx, useDraggable, type DragApi, type Payload } from "../drag";
import { chordBeats, fitBeats, newId, useApp, type ArrangeSettings, type Pane, type ProgChord, type Progression } from "../state";
import { copyDrums, copyMelody, copyRhythm, keyShift, pasteDrums, pasteMelody, pasteRhythm, pastFrame, type ClipKind, type Clips } from "../../song/clip";

/** Guitar: key → mode → chords → shapes → your progression. */
export function GuitarView() {
  const { state, set, shapeOf, sheet, openSheet, tuning, toast } = useApp();
  const prog = state.progression;
  const beat = prog.beat ?? DEFAULT_BEAT;
  const [nowIdx, setNowIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  /** true while the whole song is playing (the tray follows it section by section) */
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
  // its time signature (its own, or the song's) says how long a bar is, on every page
  const songSig = sigOf(prog);
  const sig = sectionSig(prog);
  const bar = sigBeats(sig);
  const meter = useMemo(() => ({ bar, triplet: isCompound(sig), sig }), [bar, sig.num, sig.den]); // eslint-disable-line react-hooks/exhaustive-deps
  const swing = beat.on && beat.div === 4 ? beat.swing : 0;
  // the melody of the section on screen (its notes are read as it plays, so a note tapped in is heard next time round)
  // the section's frame: so many bars, and everything in it is written into those bars
  const nBars = barsOr(prog.bars);
  const frame = nBars * bar;
  // the melody has every bar of the section; an empty bar is silent
  const melody = useMemo(() => inBars(prog.melody ?? blankMelody(sig), nBars), [prog.melody, nBars, sig.den]); // eslint-disable-line react-hooks/exhaustive-deps
  const tune: PlayTune | null = useMemo(() => (hasTune(prog.melody) ? { m: melody, bar, swing } : null), [prog.melody, melody, bar, swing]);
  /** The section as it plays: its chords once, in their bars, then silence to the end of the last bar. */
  const fill = useCallback((chords: ProgChord[], vs: (Voicing | undefined)[], b: Beat, style: PatternId = prog.pattern): PlayItem[] => {
    void style;
    const len = frameBeats(prog.bars, bar);
    const list: PlayItem[] = inFrame(chords, len).map(({ item: c, index: i }) => ({ midi: c.rest ? [] : vs[i]?.midi ?? [], beats: c.beats, feel: prog.feel, meter }));
    const played = list.reduce((a, x) => a + x.beats, 0);
    const any = chords.some((c) => !c.rest) || b.on || !!tune;
    if (!any) return [];
    if (played < len - 1e-6) list.push({ midi: [], beats: len - played, pad: true, meter });
    return list;
  }, [prog.bars, prog.pattern, prog.feel, tune, bar, meter]);
  const items = fill(prog.chords, voicings, beat);

  // recorded takes are read from disk once (just the take, not the whole recording), then play with the song
  const [takesReady, setTakesReady] = useState(0);
  const playedTakes = useMemo(() => (prog.tracks ?? []).flatMap((t) => (t.kind === "vocals" ? groupsOf(t.takes).map((g) => activeTake(t.takes ?? [], g, t.active?.[g])) : [])).filter((x): x is Take => !!x), [prog.tracks]);
  const playedKey = playedTakes.map(takeKey).join("|");
  useEffect(() => {
    let live = true;
    keepTakes(playedTakes);
    for (const tk of playedTakes) if (!takeBuffer(tk)) void loadTake(tk).then((b) => live && b && setTakesReady((n) => n + 1));
    return () => { live = false; };
  }, [playedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The whole song, section after section. A section with no chords is one bar of the beat on its own.
  const secs = useMemo(() => sections(prog), [prog]);
  // Each section plays with its own settings where it has them, and the song's (the first section's) everywhere else.
  const plan = useMemo(() => {
    const list: PlayItem[] = [];
    const map: { block: string; idx: number }[] = [];
    const parts: { sec: Section; voicings: (Voicing | undefined)[] }[] = [];
    const lengths: Record<string, { beats: number; bar: number }> = {};
    /** every section on its own: what it plays, start to end, and which chord each item is */
    const per: SecPlan[] = [];
    /** is there anything in the song to hear? */
    let any = false;
    // with no song yet, what is on the page is section A (every track in its place: a page may be editing an added track)
    const np = normalize(prog);
    const nBeat = np.beat ?? DEFAULT_BEAT;
    const row: Section[] = secs.length ? secs : [soloSection(np)];
    const editingOther = np !== prog && !!prog.focus?.chords;
    /** What the tracks added on the Track page play in a section. */
    const extrasOf = (sec: Section, len: number, secBar: number, style: PatternId, swing: number): ExtraPlay | undefined => {
      const ex: ExtraPlay = { chords: [], tunes: [], drums: [] };
      for (const t of np.tracks ?? []) {
        const l = sec.layers?.[t.id];
        if (!l) continue;
        if (t.kind === "chords" && l.chords?.length) {
          const vs = voicingsOf(l.chords);
          let at = 0;
          for (const { item: c, index: i } of inFrame(l.chords, len)) {
            ex.chords.push({ track: t.id, at, beats: c.beats, midi: c.rest ? [] : vs[i]?.midi ?? [], style: t.style ?? style, feel: t.feel, sound: reviveSound(t.sound) });
            at += c.beats;
          }
        } else if (t.kind === "melody" && hasTune(l.melody)) ex.tunes.push({ track: t.id, tune: { m: inBars(l.melody, barsOr(sec.bars)), bar: secBar, swing, sound: reviveSound(t.sound) } });
        else if (t.kind === "drums" && l.beat?.on) ex.drums.push({ track: t.id, beat: l.beat });
      }
      // recorded takes that start in this section (the take chosen from each recording)
      for (const t of np.tracks ?? []) {
        if (t.kind !== "vocals") continue;
        for (const g of groupsOf(t.takes)) {
          const tk = activeTake(t.takes ?? [], g, t.active?.[g]);
          const buffer = tk && tk.at.block === sec.blockId ? takeBuffer(tk) : undefined;
          // the buffer holds just the take, so it plays from its start
          if (tk && buffer) (ex.takes ??= []).push({ track: t.id, buffer, at: tk.at.bar * secBar, offset: 0, dur: tk.frames / tk.rate });
        }
      }
      return ex.chords.length || ex.tunes.length || ex.drums.length || ex.takes?.length ? ex : undefined;
    };
    for (const sec of row) {
      const vs = sec.current && !editingOther ? voicings : voicingsOf(sec.chords);
      const drums: Beat = { ...nBeat, ...sec.kit, ...sec.groove, on: sec.groove?.on ?? nBeat.on };
      const style = sec.style ?? prog.pattern;
      const feel = sec.feel;
      const harp = reviveSound(sec.sound);
      // every section plays in its own time signature (the song's, unless it has one of its own)
      const secSig = sec.meter ?? songSig;
      const secBar = sigBeats(secSig);
      const secMeter = { bar: secBar, triplet: isCompound(secSig), sig: secSig };
      const secTune: PlayTune | null = hasTune(sec.melody) ? { m: inBars(sec.melody, barsOr(sec.bars)), bar: secBar, swing: drums.on && drums.div === 4 ? drums.swing : 0, sound: reviveSound(sec.tuneSound) } : null;
      parts.push({ sec, voicings: vs });
      // the section's frame: everything in it plays in its own bar, for exactly this long
      const len = frameBeats(sec.bars, secBar);
      lengths[sec.blockId] = { beats: len, bar: secBar };
      const inside = inFrame(sec.chords, len);
      const extra = extrasOf(sec, len, secBar, style, drums.on && drums.div === 4 ? drums.swing : 0);
      const own: PlayItem[] = [];
      const idx: number[] = [];
      inside.forEach(({ item: c, index: i }, k) => {
        own.push({ midi: c.rest ? [] : vs[i]?.midi ?? [], beats: c.beats, drums, style, feel, sound: harp, tune: secTune, section: k === 0, extra, meter: secMeter });
        idx.push(i);
      });
      // after the last chord the section goes on to the end of its last bar: drums and melody carry on, the harp is silent
      const played = inside.reduce((a, x) => a + x.item.beats, 0);
      if (played < len - 1e-6) {
        own.push({ midi: [], beats: len - played, drums, style, tune: secTune, section: !inside.length, pad: true, extra, meter: secMeter });
        idx.push(-1);
      }
      per.push({ block: sec.blockId, partId: sec.partId, label: sec.label, color: sec.color, bars: barsOr(sec.bars), bar: secBar, items: own, idx });
      list.push(...own);
      map.push(...idx.map((i) => ({ block: sec.blockId, idx: i })));
      if (sec.chords.some((c) => !c.rest) || drums.on || secTune || extra) any = true;
    }
    return { items: list, map, parts: secs.length ? parts : [], lengths, any, per };
  }, [secs, voicings, voicingsOf, beat, songSig.num, songSig.den, prog.pattern, prog.chords, prog.melody, prog.bars, prog.feel, prog.sound, prog.tuneSound, prog.tracks, takesReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── looping: nothing loops until some bars are chosen; then those bars go round and round ──
  const [span, setSpan] = useState<LoopSpan | null>(null);
  const layout = useMemo(() => plan.per.map((x) => ({ block: x.block, bars: x.bars })), [plan.per]);
  const loop = useMemo(() => fitLoop(layout, span), [layout, span]);
  // a loop whose bars are gone (a section removed) is let go
  useEffect(() => {
    if (span && !loop) setSpan(null);
  }, [span, loop]);
  /** What ▶ plays: the whole song in order, or just the bars of the loop. */
  /** The bars of a loop, as items to play (or to render for the recording engine). */
  const sliceLoop = useCallback((loop: LoopSpan) => {
    const a = plan.per.findIndex((x) => x.block === loop.from.block);
    const b = plan.per.findIndex((x) => x.block === loop.to.block);
    const items: PlayItem[] = [];
    const map: { block: string; idx: number }[] = [];
    for (let k = a; k <= b; k++) {
      const x = plan.per[k];
      const from = k === a ? loop.from.bar * x.bar : 0;
      const to = k === b ? (loop.to.bar + 1) * x.bar : x.bars * x.bar;
      // every item says how far into its section it starts, so the drums, the melody and the style pick up at the right bar
      sliceItems(x.items, from, to).forEach((c, n) => {
        items.push({ ...c.item, from: c.from, section: n === 0 });
        map.push({ block: x.block, idx: x.idx[c.index] });
      });
    }
    return { items, map, loop: true };
  }, [plan]);
  const playList = useMemo(() => (loop ? sliceLoop(loop) : { items: plan.items, map: plan.map, loop: false }), [plan, loop, sliceLoop]);
  const listRef = useRef(playList);
  listRef.current = playList;
  /** the section that is sounding right now (it need not be the one on screen) */
  const playBlock = useRef<string | null>(null);
  const curBlock = prog.song?.current ?? "";
  const curRef = useRef(curBlock);
  curRef.current = curBlock;
  const planRef = useRef(plan);
  planRef.current = plan;

  // ── the harp's sound ──
  // (the page's knobs set the track being edited; the first tracks' harps always keep their own sound)
  const sound = useMemo(() => reviveSound(prog.sound), [prog.sound]);
  const hear = useRef(0);
  const voicingsRef = useRef(voicings);
  voicingsRef.current = voicings;
  const editChords = prog.focus?.chords && prog.focus.chords !== "chords" ? prog.focus.chords : null;
  const editTune = prog.focus?.melody && prog.focus.melody !== "melody" ? prog.focus.melody : null;
  const firstSound = editChords ? (prog.layers?.chords?.sound ?? prog.sound) : prog.sound;
  const firstTune = editTune ? (prog.layers?.melody?.tuneSound ?? prog.tuneSound) : prog.tuneSound;
  useEffect(() => setHarpSound(reviveSound(firstSound), prog.bpm), [firstSound, prog.bpm]);
  // the melody has a harp of its own, with its own effects
  const tuneSound = useMemo(() => reviveSound(prog.tuneSound), [prog.tuneSound]);
  useEffect(() => setTuneSound(reviveSound(firstTune), prog.bpm), [firstTune, prog.bpm]);
  // a track added on the Track page is heard on its own harp while it is being edited
  useEffect(() => hearOn("chord", editChords ? { id: editChords, sound } : null), [editChords, sound]);
  useEffect(() => hearOn("melody", editTune ? { id: editTune, sound: tuneSound } : null), [editTune, tuneSound]);
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
  const editDrums = prog.focus?.drums && prog.focus.drums !== "drums" ? prog.focus.drums : null;
  /** (A track added on the Track page sounds the same in every section: it has no "follows A" chip.) */
  const link = (g: SettingGroup): Link | undefined =>
    (editChords && (g === "style" || g === "sound")) || (editTune && g === "tuneSound") || (editDrums && (g === "groove" || g === "kit")) ? undefined
    : { source: linked.source, first: linked.first, own: linked.own[g], onReset: () => set((s) => ({ ...s, progression: relink(s.progression, g) })) };
  // the same chips from one render to the next, so the editors are not drawn again for nothing while the music plays
  const links = useMemo(() => ({ style: link("style"), sound: link("sound"), tuneSound: link("tuneSound"), kit: link("kit"), groove: link("groove") }), [linked, editChords, editTune, editDrums]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The first drums track's beat, even while the Drums page edits another one (it sets the drum sound's effects). */
  const firstBeat = editDrums ? prog.layers?.drums?.beat ?? beat : beat;
  const pane: Pane = state.pane ?? "frame";
  // bars on screen and Follow, the same on every editing page
  const { shown, follow } = useBarsView();
  const followRef = useRef(follow);
  followRef.current = follow;
  // Follow switched on while the music is in another section: the page goes to where the music is
  useEffect(() => {
    const at = playBlock.current;
    if (follow && playingRef.current && at && at !== curRef.current) set((s) => (s.progression.song && s.progression.song.current !== at ? { ...s, progression: selectBlock(s.progression, at) } : s));
  }, [follow, set]);

  useEffect(() => {
    if (player.current?.playing) player.current.update(playList.items, prog.bpm, prog.pattern, playList.loop, firstBeat, null);
  });
  useEffect(() => () => player.current?.stop(), []);
  playingRef.current = playing;

  const stopPlay = () => {
    player.current?.stop();
    playBlock.current = null;
    setPlaying(false);
    setNowIdx(-1);
  };
  /**
   * Play. With no loop: from the section on screen, on through the song to its end (with Follow
   * on, the page goes along). With a loop: the looped bars, round and round.
   */
  const startPlay = () => {
    // while the Vocals page records, the song plays through the interface: a second one here would sound over it
    if (recording) return;
    const list = listRef.current;
    if (!planRef.current.any || !list.items.length) return toast("Add chords, a melody or drums first");
    getAudio();
    const p = (player.current ??= new ProgressionPlayer());
    const from = list.loop ? 0 : Math.max(0, list.map.findIndex((m) => m.block === curRef.current));
    playBlock.current = list.map[from]?.block ?? null;
    p.onStep = (i) => {
      const at = listRef.current.map[i];
      if (!at) return;
      // a new section has started: with Follow on the page goes there too; with it off the page stays where it is
      if (at.block !== playBlock.current) {
        playBlock.current = at.block;
        if (at.block && followRef.current) set((s) => (s.progression.song && s.progression.song.current !== at.block ? { ...s, progression: selectBlock(s.progression, at.block) } : s));
      }
      setNowIdx(at.block === curRef.current ? at.idx : -1);
    };
    p.onEnd = () => { playBlock.current = null; setPlaying(false); setNowIdx(-1); };
    p.start(list.items, prog.bpm, prog.pattern, list.loop, firstBeat, from);
    setPlaying(true);
  };
  const togglePlay = () => (playing ? stopPlay() : startPlay());
  // the loop was changed while playing: start again with the new bars
  const loopKey = loop ? `${loop.from.block}:${loop.from.bar}-${loop.to.block}:${loop.to.bar}` : "";
  const lastLoop = useRef(loopKey);
  useEffect(() => {
    if (lastLoop.current === loopKey) return;
    lastLoop.current = loopKey;
    if (playingRef.current) startPlay();
  }); // eslint-disable-line react-hooks/exhaustive-deps
  /** Play once the page has caught up with a change just made (a rhythm or a style picked). */
  const [audition, setAudition] = useState(0);
  useEffect(() => {
    if (audition && !playingRef.current) startPlay();
  }, [audition]); // eslint-disable-line react-hooks/exhaustive-deps
  /** A bar of the strip was tapped: it joins the loop (or, at an end of the loop, leaves it). */
  /** true while the Vocals page is recording: the loop cannot change under the singer */
  const [recording, setRecording] = useState(false);
  const onLoopBar = (bar: BarRef) => !recording && setSpan((sp) => tapLoop(layout, sp, bar));
  /** ↻: loop the section on screen, or let the loop go. */
  const toggleLoop = () => !recording && setSpan(loop ? null : loopSection(curBlock, nBars));
  /** What a recording goes round: the loop if there is one, else the section on screen. */
  const recordPlan = useCallback(() => {
    const span = loop ?? fitLoop(layout, loopSection(curBlock, nBars));
    if (!span) return null;
    const list = sliceLoop(span);
    const first = plan.per.find((x) => x.block === span.from.block);
    const beats = list.items.reduce((a, x) => a + x.beats, 0);
    // every bar that goes round, for the Vocals page's lane
    const bars: RecordPlan["bars"] = [];
    const a = plan.per.findIndex((x) => x.block === span.from.block);
    const b = plan.per.findIndex((x) => x.block === span.to.block);
    for (let k = Math.max(0, a); k <= b; k++) {
      const x = plan.per[k];
      for (let i = k === a ? span.from.bar : 0; i <= (k === b ? span.to.bar : x.bars - 1); i++) bars.push({ block: x.block, bar: i, letter: x.label, beats: x.bar });
    }
    return { items: list.items, at: { block: span.from.block, bar: span.from.bar }, beats, beatsPerBar: Math.max(1, Math.round(first?.bar ?? bar)), bpm: prog.bpm, pattern: prog.pattern, beat: firstBeat, label: `${first?.label ?? "A"} ${span.from.block === span.to.block ? `bars ${span.from.bar + 1}–${span.to.bar + 1}` : "and on"}`, bars };
  }, [loop, layout, curBlock, nBars, sliceLoop, plan.per, bar, prog.bpm, prog.pattern, firstBeat]);

  const setBeat = useCallback((fn: (b: Beat) => Beat) => set((s) => ({ ...s, progression: { ...s.progression, beat: fn(s.progression.beat ?? DEFAULT_BEAT) } })), [set]);
  /** Load a rhythm. One written for other bars is fitted to the song's time signature (see song/unity). */
  const pickBeat = useCallback((p: BeatPattern) => {
    set((s) => ({ ...s, progression: { ...s.progression, beat: applyPattern(s.progression.beat ?? DEFAULT_BEAT, p) } }));
    // hear it straight away
    if (!playingRef.current) setAudition((n) => n + 1);
  }, [set]);
  /** Choose how the section on screen is played. The bars stay as the time signature has them. */
  const pickStyle = (id: PatternId) => {
    set((s) => ({ ...s, progression: { ...s.progression, pattern: id } }));
    // hear it straight away
    if (!playing && prog.chords.length) setAudition((n) => n + 1);
  };
  const setMelody = useCallback((fn: (m: Melody) => Melody) => set((s) => ({ ...s, progression: { ...s.progression, melody: fn(s.progression.melody ?? blankMelody(sectionSig(s.progression))) } })), [set]);
  const setFeel = useCallback((patch: Partial<Feel>) => set((s) => ({ ...s, progression: { ...s.progression, feel: { ...reviveFeel(s.progression.feel), ...patch } } })), [set]);
  /** Set how long the section on screen lasts, in bars. */
  const setBars = useCallback((n: number) => set((s) => ({ ...s, progression: { ...s.progression, bars: barsOr(n) } })), [set]);
  /** what the section on screen is called, and its colour */
  const curSec = secs.find((x) => x.current);
  const curLabel = curSec?.label ?? "A";
  const curColor = curSec?.color ?? 0;
  /** how many pastes there have been: a paste starts the melody's and the drums' editing afresh */
  const [pasted, setPasted] = useState(0);
  const onPasted = useCallback(() => setPasted((n) => n + 1), []);
  /** How far into its section the music is, while the section on screen is the one sounding. */
  // (the section is read from the same moment as the beat: the player says a section has started a
  // little after the music is in it, and the grids must not take B's first bar for A's)
  const getPos = useCallback(() => {
    const pos = player.current?.position();
    return pos && listRef.current.map[pos.index]?.block === curRef.current ? pos.beat : null;
  }, []);
  /** Where the music is, for the canvas: which section, and how far into it. */
  const bpmRef = useRef(prog.bpm);
  bpmRef.current = prog.bpm;
  const getSpot = useCallback((): Spot | null => {
    const pos = player.current?.position();
    const block = pos ? listRef.current.map[pos.index]?.block : undefined;
    const per = planRef.current.per;
    const i = block === undefined ? -1 : per.findIndex((x) => x.block === block);
    if (!pos || i < 0) return null;
    const sec = per[i];
    // each section is its own painting, in colours of its own that go with it wherever it is moved
    return { key: sec.partId || "A", index: sec.color, beat: pos.beat, bar: sec.bar, bars: sec.bars, spb: 60 / bpmRef.current };
  }, []);
  /** Where the music would start if it were started now (the canvas marks its bars before anything plays). */
  const restSpot = useMemo((): Spot => {
    const sec = plan.per.find((x) => x.block === curBlock) ?? plan.per[0];
    return { key: sec?.partId || "A", index: sec?.color ?? 0, beat: 0, bar: sec?.bar ?? 4, bars: sec?.bars ?? 4, spb: 60 / prog.bpm };
  }, [plan, curBlock, prog.bpm]);
  /** The bar of the song that is sounding: its section and which of its bars. */
  const getBar = useCallback((): BarRef | null => {
    // the section and the place in it are read together, so the mark never shows one with the other's bar
    const pos = player.current?.position();
    const block = pos ? listRef.current.map[pos.index]?.block : undefined;
    const sec = block === undefined ? undefined : planRef.current.per.find((x) => x.block === block);
    return !pos || !sec ? null : { block: sec.block, bar: Math.max(0, Math.min(sec.bars - 1, Math.floor(pos.beat / sec.bar + 1e-6))) };
  }, []);
  /** Which section is sounding and how far into it, for the Track page's playhead. */
  const getWhere = useCallback((): { block: string; beat: number } | null => {
    const pos = player.current?.position();
    const block = pos ? listRef.current.map[pos.index]?.block : undefined;
    return !pos || block === undefined ? null : { block, beat: pos.beat };
  }, []);
  /** The song as the Track page draws it: every section in playing order, with what it holds. */
  const trackSecs = useMemo((): TrackSection[] => {
    const np = normalize(prog);
    const row: Section[] = secs.length ? secs : [{ ...soloSection(np), groove: grooveOf(firstBeat), kit: kitOfBeat(firstBeat) }];
    return row.map((sec, i) => {
      const per = plan.per[i];
      return { block: sec.blockId, label: sec.label, color: sec.color, bars: per?.bars ?? barsOr(sec.bars), bar: per?.bar ?? bar, chords: sec.chords, melody: sec.melody, layers: sec.layers, drums: { ...firstBeat, ...sec.kit, ...sec.groove, on: sec.groove?.on ?? firstBeat.on } };
    });
  }, [secs, plan.per, prog, firstBeat, bar]);
  // the mixer: every track's volume, mute and solo, for the whole song
  useEffect(() => setMix(prog.mix), [prog.mix]);
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
        <Transport locked={recording} per={plan.per} current={curBlock} loop={loop} layout={layout} onBar={onLoopBar} onLoop={toggleLoop} getBar={getBar} playing={playing} onPlay={togglePlay} canPlay={plan.any} />
        <div className="pane" hidden={pane !== "track"}>
          <TrackPage sections={trackSecs} current={curBlock} loop={loop} layout={layout} playing={playing} getWhere={getWhere} shown={shown} follow={follow} active={pane === "track"} />
        </div>
        <div className="pane" hidden={pane !== "frame"}>
          <FramePage secs={secs} lengths={plan.lengths} here={{ beats: frame, bar }} voicings={voicings} voicingsOf={voicingsOf} song={plan.items} any={plan.any} beat={beat} plan={secs.length ? plan : null} onPasted={onPasted} />
        </div>
        <div className="pane" hidden={pane !== "rhythm"}>
          <ClipBar kind="rhythm" label={curLabel} color={curColor} frame={frame} onPasted={onPasted} />
          <ChordBoard />
          {/* The tray is part of the page. With the shape finder open it is lifted to the bottom of the screen, so shapes can be dragged straight in. */}
          {sheet && <div style={{ height: dockH.current }} />}
          <div className={`bottom-layer${sheet ? " open" : ""}${drag ? " dragging" : ""}`}>
            {sheet && <div className="finder-backdrop" onClick={() => openSheet(null)} />}
            <ShapeFinder slotShape={(id) => voicings[prog.chords.findIndex((c) => c.id === id)]} onPinSlot={pinSlot} />
            <Dock ref={dockRef} voicings={voicings} nowIdx={nowIdx} drag={drag} onStep={stepSlot} onArrange={setArrange} bar={bar} onLengths={setLengths} length={frame} label={curLabel} onFit={setBars} shown={shown} follow={follow} />
          </div>
          <HarpPanel sound={sound} setSound={setSound} style={prog.pattern} onStyle={pickStyle} feel={reviveFeel(prog.feel)} setFeel={setFeel} onHear={hearSoon} styleLink={links.style} soundLink={links.sound} />
        </div>
        <div className="pane" hidden={pane !== "melody"}>
          <ClipBar kind="melody" label={curLabel} color={curColor} frame={frame} onPasted={onPasted} />
          <MelodyGrid fresh={`${curBlock}:${pasted}`} place={`${state.ideaId ?? ""}:${curBlock}`} melody={melody} setMelody={setMelody} keyOf={state.key} bar={bar} chords={prog.chords} playing={playing} getPos={getPos}
            sound={tuneSound} setSound={setTune} onHear={hearTune} link={links.tuneSound} shown={shown} follow={follow} active={pane === "melody"} />
        </div>
        <div className="pane" hidden={pane !== "vocals"}>
          <VocalsPage active={pane === "vocals"} recordPlan={recordPlan} onRecording={(on) => { setRecording(on); if (on) stopPlay(); }} recording={recording} playing={playing} getWhere={getWhere} />
        </div>
        <div className="pane" hidden={pane !== "canvas"}>
          <CanvasPage active={pane === "canvas"} playing={playing} getSpot={getSpot} rest={restSpot} keyOf={state.key} onPlay={togglePlay} canPlay={plan.any} />
        </div>
        <div className="pane" hidden={pane !== "drums"}>
          <ClipBar kind="drums" label={curLabel} color={curColor} frame={frame} onPasted={onPasted} />
          <DrumMachine fresh={pasted} beat={beat} setBeat={setBeat} onPick={pickBeat} playing={playing} kitLink={links.kit} grooveLink={links.groove} frame={nBars} getPos={getPos} shown={shown} follow={follow} active={pane === "drums"} />
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
      // every melody moves too, the added melody tracks' as well
      return { ...s, key: newKey, progression: mapAllMelodies(p, (m) => transposeMelody(m, by)) };
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
  /** which kind of chord the cards show: triads, sevenths, sus chords … */
  const [kind, setKind] = useState("triads");
  const [deg, setDeg] = useState(1);
  const all = useMemo(() => chordsInScale(key), [key]);
  // each note's card: the chord of this kind that uses only notes of the key (none where it does not fit)
  const cards = useMemo(() => chordRow(key, kind), [key, kind]);
  const row = CHORD_ROWS.find((r) => r.id === kind) ?? CHORD_ROWS[0];
  const fits = cards.filter((c) => c).length;
  const degree = all.find((d) => d.degree === deg) ?? all[0];
  const picked = sel && view === "key" ? degree?.chords.some((c) => sameRef(sel, c.ref)) : !!sel;

  return (
    <section className="card board">
      <div className="board-head">
        <Seg value={view} options={[{ value: "key", label: "In key" }, { value: "outside", label: "Outside" }, { value: "next", label: "Next" }]} onChange={setView} label="Which chords" />
        {view === "key" && (
          <div className="seg kinds" role="radiogroup" aria-label="Which kind of chord the cards show">
            {CHORD_ROWS.map((r) => <button key={r.id} role="radio" aria-checked={kind === r.id} className={kind === r.id ? "on" : ""} title={r.hint} onClick={() => setKind(r.id)}>{r.label}</button>)}
          </div>
        )}
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
                  : <button key={all[i].degree} className={`kc bare${degree?.degree === all[i].degree ? " on" : ""}`} title={`No ${row.label} chord on ${displayNote(all[i].root)} stays in the key. Tap for the chords that do`} onClick={() => setDeg(all[i].degree)}><span className="kc-name">{displayNote(all[i].root)}</span><span className="kc-none">—</span></button>,
              )}
            </div>
            {fits === 0 && <span className="faint tiny">No {row.label} chords fit this scale</span>}
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
 * The song: its sections in order, what ▶ does (go round the section on screen, or play on through
 * the song), and the three things each section is made of. It stays at the top of the screen.
 */
type Lengths = Record<string, { beats: number; bar: number }>;
type Len = { beats: number; bar: number };
/** One section as it plays: which it is, what it is called and its colour, its bars, how long a bar is, its items from start to end, and which chord each item is (−1 = none). */
type SecPlan = { block: string; partId: string; label: string; color: number; bars: number; bar: number; items: PlayItem[]; idx: number[] };

// ── Copy and paste between sections ─────────────────────────

const CLIP_NAME: Record<ClipKind, string> = { rhythm: "chords", melody: "melody", drums: "drums" };
/** The fields of the page that a paste replaces (and an undo puts back). */
const pageOf = (p: Progression, kind: ClipKind): Partial<Progression> =>
  kind === "rhythm" ? { chords: p.chords, pattern: p.pattern, feel: p.feel, sound: p.sound } : kind === "melody" ? { melody: p.melody, tuneSound: p.tuneSound } : { beat: p.beat };
function copyOf(kind: ClipKind, p: Progression, key: Key, label: string): Clips {
  return kind === "rhythm" ? { rhythm: copyRhythm(p, key, label) } : kind === "melody" ? { melody: copyMelody(p, key, label) } : { drums: copyDrums(p, key, label) };
}
function pasteOf(kind: ClipKind, p: Progression, clips: Clips, key: Key): Progression {
  if (kind === "rhythm") return clips.rhythm ? pasteRhythm(p, clips.rhythm, key, newId) : p;
  if (kind === "melody") return clips.melody ? pasteMelody(p, clips.melody, key) : p;
  return clips.drums ? pasteDrums(p, clips.drums) : p;
}

/**
 * Copy and Paste for one page. Copy takes everything on this page of the section on screen; Paste
 * puts the last thing copied on this same page into the section on screen, in place of what is
 * there. Rhythm only goes to Rhythm, Melody to Melody, Drums to Drums. Undo takes a paste back.
 */
function ClipBar({ kind, label, color, frame, onPasted }: { kind: ClipKind; label: string; color: number; frame: number; onPasted: () => void }) {
  const { state, set, toast } = useApp();
  const clip = state.clip?.[kind];
  const block = state.progression.song?.current ?? "";
  const pane = state.pane;
  const what = CLIP_NAME[kind];
  /** what the page held before the last paste, while it can still be taken back */
  const [undo, setUndo] = useState<{ block: string; before: Partial<Progression> } | null>(null);
  // the undo belongs to the section and the page it was pasted into
  useEffect(() => setUndo(null), [block, pane, state.ideaId]);
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 20000);
    return () => window.clearTimeout(t);
  }, [undo]);
  const copy = () => {
    set((s) => ({ ...s, clip: { ...s.clip, ...copyOf(kind, s.progression, s.key, label) } }));
    setUndo(null);
    toast(`${label}: ${what} copied`);
  };
  const paste = () => {
    if (!clip) return;
    const before = state.progression;
    const next = pasteOf(kind, before, state.clip ?? {}, state.key);
    set((s) => ({ ...s, progression: { ...s.progression, ...pageOf(pasteOf(kind, s.progression, s.clip ?? {}, s.key), kind) } }));
    setUndo({ block, before: pageOf(before, kind) });
    onPasted();
    const moved = kind !== "drums" && keyShift(clip.key, state.key) !== 0;
    const lost = pastFrame(next, kind, frame);
    toast(`${clip.from}'s ${what} pasted into ${label}${moved ? `, moved to ${displayNote(state.key.tonic)}` : ""}${lost ? `. Some is past the end of ${label}` : ""}`);
  };
  const takeBack = () => {
    if (!undo) return;
    set((s) => ({ ...s, progression: { ...s.progression, ...undo.before } }));
    setUndo(null);
    onPasted();
    toast("Paste undone");
  };
  // the tracks of this kind: the page edits one of them at a time
  const ek: EditKind = kind === "rhythm" ? "chords" : kind;
  const list = tracksOf(normalize(state.progression), ek);
  const on = state.progression.focus?.[ek] ?? ek;
  /** Another track of this kind (a second set of chords, another melody, more drums), ready to write in. */
  const add = () => {
    const id = newId();
    set((s) => ({ ...s, progression: addTrack(s.progression, ek, id).p }));
  };
  const drop = (t: Track) => {
    if (!window.confirm(`Remove ${t.name} from every section?`)) return;
    set((s) => ({ ...s, progression: removeTrack(s.progression, t.id) }));
  };
  return (
    <div className={`clip-bar${list.length > 1 ? " many" : ""}`} role="group" aria-label={`The ${what} tracks, copy and paste`}>
      <span className={`clip-of ${letterClass(color)}`}><b title={label}>{label}</b></span>
      <span className="seg clip-tracks" role="radiogroup" aria-label={`Which ${what} track`}>
        {list.map((t) => (
          <button key={t.id} role="radio" aria-checked={on === t.id} className={on === t.id ? "on" : ""} onClick={() => set((s) => ({ ...s, progression: focusTrack(s.progression, ek, t.id) }))}>
            {t.name}
            {on === t.id && !isFirst(t.id) && <i className="clip-x" role="button" aria-label={`Remove ${t.name}`} title="Remove" onClick={(e) => { e.stopPropagation(); drop(t); }}>✕</i>}
          </button>
        ))}
        <button className="clip-add" aria-label={`Add a ${what} track`} title={`Add a ${what} track`} onClick={add}>+</button>
      </span>
      <span className="spacer" />
      <BarsControl />
      <button className="icon-btn" title="Copy" aria-label={`Copy the ${what} of ${label}`} onClick={copy}><CopyIcon /></button>
      {undo && undo.block === block ? (
        <button className="icon-btn" aria-label="Undo the paste" title="Undo" onClick={takeBack}>↶</button>
      ) : (
        <button className="icon-btn clip-paste" disabled={!clip} aria-label={clip ? `Paste the ${what} of ${clip.from} into ${label}` : `Paste: copy a ${what} first`} title={clip ? `Paste ${clip.from}` : "Paste"} onClick={paste}>
          <PasteIcon />{clip ? <small className="clip-from">{clip.from}</small> : null}
        </button>
      )}
    </div>
  );
}

/**
 * Play, on every page. ▶ plays the song in order from the section on screen. The strip beside it
 * is the whole song, bar by bar: tap a section to go to it; tap bars to loop them (each
 * tap adds a bar, and the bars between; a tap on either end of the loop takes that bar off again).
 * ↻ loops the section on screen, or lets the loop go.
 */
function Transport({ locked, per, current, loop, layout, onBar, onLoop, getBar, playing, onPlay, canPlay }: {
  /** recording: the loop cannot be changed */
  locked?: boolean;
  per: SecPlan[];
  /** the section on screen */
  current: string;
  loop: LoopSpan | null;
  layout: { block: string; bars: number }[];
  /** a bar was tapped */
  onBar: (bar: BarRef) => void;
  /** ↻ was tapped */
  onLoop: () => void;
  /** the bar that is sounding (null = stopped) */
  getBar: () => BarRef | null;
  playing: boolean;
  onPlay: () => void;
  canPlay: boolean;
}) {
  const { state, set } = useApp();
  const row = useRef<HTMLDivElement>(null);
  const cur = per.find((x) => x.block === current) ?? per[0];
  /** bring something in the strip into view (sideways only: the page itself must not jump) */
  const reveal = (el: HTMLElement | null | undefined) => {
    const r = row.current;
    if (!r || !el) return;
    const a = el.offsetLeft - r.offsetLeft;
    if (a < r.scrollLeft) r.scrollLeft = a - 8;
    else if (a + el.offsetWidth > r.scrollLeft + r.clientWidth) r.scrollLeft = a + el.offsetWidth - r.clientWidth + 8;
  };
  useEffect(() => reveal(row.current?.querySelector<HTMLElement>(".lb-sec.on .lb-letter")), [current, per.length]);
  // the bar that is sounding is marked, without redrawing the strip on every frame
  useEffect(() => {
    const r = row.current;
    if (!r) return;
    const clear = () => r.querySelectorAll(".lb-bar.now").forEach((e) => e.classList.remove("now"));
    if (!playing) return clear();
    let raf = 0;
    let last = "";
    const tick = () => {
      const b = getBar();
      const key = b ? `${b.block}:${b.bar}` : "";
      if (key !== last) {
        last = key;
        clear();
        const el = key ? r.querySelector<HTMLElement>(`[data-bar="${key}"]`) : null;
        el?.classList.add("now");
        reveal(el);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); clear(); };
  }, [playing, getBar]);
  return (
    <section className={`song-frame transport${loop ? " looping" : ""}${locked ? " locked" : ""}`} aria-label="Play" title={locked ? "Recording: the loop is locked until you stop" : undefined}>
      <button className={`play-btn sm${playing ? " stop" : ""}`} onClick={onPlay} aria-label={playing ? "Stop" : loop ? "Play the loop" : "Play"} disabled={!playing && (!canPlay || !!locked)}>{playing ? "■" : "▶"}</button>
      <button className={`loop-btn${loop ? " on" : ""}`} aria-pressed={!!loop} aria-label={loop ? "Stop looping" : `Loop section ${cur?.label ?? "A"}`} title={loop ? "Stop looping: play straight through" : `Loop section ${cur?.label ?? "A"}. Or tap bars to loop just those`} onClick={onLoop}>↻</button>
      <div className="loopbar" ref={row} role="group" aria-label="The song, bar by bar. Tap a section to go to it; tap bars to loop them">
        {per.map((x) => (
          <span key={x.block || "a"} className={`lb-sec ${letterClass(x.color)}${x.block === current ? " on" : ""}`}>
            <button className="lb-letter" aria-pressed={x.block === current} aria-label={`Section ${x.label}`} title={x.label} onClick={() => x.block && x.block !== current && set((s) => ({ ...s, progression: selectBlock(s.progression, x.block) }))}>{x.label}</button>
            {Array.from({ length: x.bars }, (_, k) => {
              const on = inLoop(layout, loop, { block: x.block, bar: k });
              return <button key={k} data-bar={`${x.block}:${k}`} className={`lb-bar${on ? " in" : ""}`} aria-pressed={on} aria-label={`Bar ${k + 1} of ${x.label}${on ? ", looping" : ": add to the loop"}`} onClick={() => onBar({ block: x.block, bar: k })}>{k + 1}</button>;
            })}
          </span>
        ))}
      </div>
      <button className="sf-sum" title="Key and tempo: change them on the Frame page" onClick={() => set((s) => ({ ...s, pane: "frame" }))}>{displayNote(state.key.tonic)} {getScale(state.key.scaleId).short} · {sigName(sectionSig(state.progression))} · {state.progression.bpm}</button>
    </section>
  );
}

/** A melody with nothing in it yet: on a grid of triplets when every beat divides in three. */
const blankMelody = (sig: TimeSig): Melody => (isCompound(sig) ? { ...EMPTY_MELODY, div: 3 } : EMPTY_MELODY);

const keyName = (tonic: string, scaleId: string) => `${displayNote(tonic)} ${getScale(scaleId).name}`;

/**
 * The frame: everything every track plays inside. The sections in order, how many bars each one
 * has and what each track holds in it, the key, the tempo, and the way out (the song as a WAV
 * file, MIDI with every track, chords and tab).
 */
function FramePage({ secs, lengths, here, voicings, voicingsOf, song: all, any, beat, plan, onPasted }: {
  secs: Section[];
  lengths: Lengths;
  here: Len;
  voicings: (Voicing | undefined)[];
  voicingsOf: (chords: ProgChord[]) => (Voicing | undefined)[];
  /** the whole song as it plays (every track), and whether there is anything in it */
  song: PlayItem[];
  any: boolean;
  beat: Beat;
  plan: SongPlan | null;
  /** a section was pasted (the pages start their editing afresh) */
  onPasted: () => void;
}) {
  const { state, set, tuning, toast, idea } = useApp();
  const prog = state.progression;
  /** every track in its place (a page may be editing an added one) */
  const np = useMemo(() => normalize(prog), [prog]);
  const tracks = useMemo(() => allTracks(np), [np]);
  const vocals = tracks.filter((t) => t.kind === "vocals");
  /** the takes that play (one from each recording) */
  const playing = vocals.flatMap((t) => groupsOf(t.takes).map((g) => activeTake(t.takes ?? [], g, t.active?.[g])).filter((x): x is Take => !!x));
  const change = (fn: (p: Progression) => Progression) => set((s) => ({ ...s, progression: fn(s.progression) }));
  // a recording keeps the tempo and key it was sung in
  const sungAt = [...new Set(playing.map((k) => k.bpm).filter((b): b is number => !!b))];
  const offTempo = sungAt.filter((b) => b !== prog.bpm);
  const sungIn = [...new Set(playing.map((k) => k.key).filter((k): k is string => !!k))];
  const offKey = sungIn.filter((k) => {
    const [tonic, scaleId] = k.split("|");
    return pc(tonic) !== pc(state.key.tonic) || scaleId !== state.key.scaleId;
  });

  // ── the way out ──
  const name = idea?.name ?? "";
  const scale = getScale(state.key.scaleId);
  const chordTracks = tracks.filter((t) => t.kind === "chords" && !isFirst(t.id));
  const hasChords = np.chords.length > 0 || !!plan?.parts.some((x) => x.sec.chords.length) || chordTracks.some((t) => (plan ? plan.parts.map((x) => x.sec.layers) : [np.layers]).some((l) => l?.[t.id]?.chords?.length));
  const chart = () => {
    const stringNames = tuning.notes.map((m) => ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][(m + state.settings.capo) % 12]);
    const head = `${name || "Untitled"} | ${state.key.tonic} ${scale.name} | ${prog.bpm} bpm${state.settings.capo ? ` | Capo ${state.settings.capo}` : ""}`;
    const block = (chords: ProgChord[], vs: (Voicing | undefined)[]) => {
      const names = chords.map((c) => (c.rest ? "-" : chordSymbolAscii(c.ref)));
      const real = chords.map((c, i) => ({ c, v: vs[i], name: names[i] })).filter((x) => !x.c.rest);
      return ["| " + names.join(" | ") + " |", "  " + chords.map((c) => (c.rest ? "-" : analyzeChord(c.ref, state.key).roman)).join("  "), "", tabText(real.map((x) => x.v), real.map((x) => x.name), stringNames)];
    };
    /** the added chords tracks in a section, each under its name */
    const added = (layers: Layers | undefined) => chordTracks.flatMap((t) => {
      const cs = layers?.[t.id]?.chords ?? [];
      return cs.length ? [`${t.name}:`, ...block(cs, voicingsOf(cs))] : [];
    });
    if (!plan) return [head, "", ...block(np.chords, np === prog ? voicings : voicingsOf(np.chords)), ...added(np.layers)].join("\n");
    // a song: the running order, then each different section once
    const out = [head, "", plan.parts.map((x) => x.sec.label).join(" "), ""];
    const done = new Set<string>();
    for (const { sec, voicings: vs } of plan.parts) {
      if (done.has(sec.partId)) continue;
      done.add(sec.partId);
      out.push(`[${sec.label}] ${barsOr(sec.bars)} bars${sec.meter ? ` in ${sigName(sec.meter)}` : ""}`,...(sec.chords.length ? block(sec.chords, vs) : ["(no chords)"]), ...added(sec.layers), "");
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
  const file = (name || "m-theory-idea").replace(/[^\w-]+/g, "-");
  const midi = async () => {
    const names = Object.fromEntries(tracks.map((t) => [t.id, t.name]));
    const r = await saveFile(progressionToMidi(all, prog.bpm, prog.pattern, name || "M-Theory idea", beat, null, names, sigOf(prog)), `${file}.mid`, "audio/midi");
    toast(r === "saved" ? "MIDI saved" : r === "failed" ? "Can't save files here" : "Cancelled");
  };
  /** the whole song as you hear it, every track and the recorded vocals, through the mixer */
  const [rendering, setRendering] = useState(false);
  const wav = async () => {
    setRendering(true);
    try {
      const rate = 48000;
      const songFrames = Math.round((all.reduce((a, x) => a + x.beats, 0) * 60 * rate) / prog.bpm);
      const ch = trimEnd(await renderSong(all, { bpm: prog.bpm, pattern: prog.pattern, beat, rate, tail: 6, fold: false }), rate, songFrames);
      const r = await saveFile(encodeWav(ch, rate, safeGain(ch)), `${file}.wav`, "audio/wav");
      toast(r === "saved" ? "Song saved as WAV" : r === "failed" ? "Can't save files here" : "Cancelled");
    } catch (e) {
      toast(`Couldn't make the WAV: ${String(e)}`);
    } finally {
      setRendering(false);
    }
  };
  const canExport = any;
  const setBpm = (n: number) => change((p) => ({ ...p, bpm: Math.max(40, Math.min(200, Math.round(n))) }));
  // the song's time signature: every section plays in it unless it has its own. A change can be taken back for a while.
  const sig = sigOf(prog);
  const [undoSig, setUndoSig] = useState<Progression | null>(null);
  const undoTimer = useRef(0);
  const pickSig = (m: TimeSig) => {
    if (sameSig(m, sig)) return;
    setUndoSig(prog);
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndoSig(null), 20000);
    change((p) => setSig(p, m));
  };
  // a recording keeps the time signature of the section it was sung in
  const offSig = [...new Set(playing.filter((k) => k.sig && k.sig !== sigName(sectionSig(prog, k.at.block))).map((k) => k.sig!))];

  return (
    <>
      <FrameSections secs={secs} lengths={lengths} here={here} beat={beat} onPasted={onPasted} />

      <KeyBar />
      {offKey.length > 0 && <p className="small fr-note" role="note">Vocals: sung in {offKey.map((k) => keyName(...(k.split("|") as [string, string]))).join(", ")}</p>}

      <section className="card fr-tempo" aria-label="Tempo and time signature">
        <div className="fr-head"><h2>Time</h2><b className="mono fr-bpm">{prog.bpm}<small>bpm</small></b></div>
        <div className="fr-row fr-slide">
          <button className="btn sm" aria-label="Slower" onClick={() => setBpm(prog.bpm - 1)}>−</button>
          <input type="range" min={40} max={200} value={prog.bpm} aria-label="Tempo" onChange={(e) => setBpm(Number(e.target.value))} />
          <button className="btn sm" aria-label="Faster" onClick={() => setBpm(prog.bpm + 1)}>+</button>
        </div>
        <div className="fr-row fr-sigs" role="radiogroup" aria-label="The song's time signature: every section plays in it unless it has its own">
          {TIME_SIGS.map((m) => (
            <button key={sigName(m)} role="radio" aria-checked={sameSig(m, sig)} aria-label={sigName(m)} className={`sig${sameSig(m, sig) ? " on" : ""}`} onClick={() => pickSig(m)}><b>{m.num}</b><b>{m.den}</b></button>
          ))}
          {undoSig && <button className="btn sm" aria-label="Undo the time signature change" title="Undo" onClick={() => { const back = undoSig; setUndoSig(null); change(() => back); }}>↶</button>}
        </div>
        {offSig.length > 0 && <p className="small fr-note" role="note">Vocals: recorded in {offSig.join(", ")}</p>}
        {offTempo.length > 0 && (
          <p className="small fr-note" role="note">
            Vocals: recorded at {offTempo.join(", ")} bpm
            {offTempo.length === 1 && <button className="btn sm" aria-label={`Back to ${offTempo[0]} bpm`} onClick={() => setBpm(offTempo[0])}>↶ {offTempo[0]}</button>}
          </p>
        )}
      </section>

      <section className="card fr-out" aria-label="Export">
        <div className="fr-head"><h2>Export</h2></div>
        <div className="fr-row">
          <button className="btn" disabled={!canExport || rendering} title="The whole song as you hear it: every track and the recorded vocals, with the Track page's levels, mute and solo (24-bit WAV)" onClick={() => void wav()}>{rendering ? "…" : "WAV"}</button>
          <button className="btn" disabled={!canExport} title="Every track as notes, each on its own MIDI track with its name: the chords as the harp plays them, the melodies and the drums (recorded vocals are audio, so they are in the WAV)" onClick={midi}>MIDI</button>
          <button className="btn" disabled={!hasChords} title="Chord names and guitar tab, as text (the added chords tracks too)" onClick={copy}><CopyIcon /> Chords + tab</button>
        </div>
      </section>
    </>
  );
}

function Dock({ ref, voicings, nowIdx, drag, onStep, onArrange, bar, onLengths, length, label, onFit, shown, follow }: {
  ref: React.Ref<HTMLDivElement>;
  voicings: (Voicing | undefined)[];
  nowIdx: number;
  drag: (Payload & { index: number | null }) | null;
  onStep: (i: number, dir: -1 | 1) => void;
  onArrange: (a: ArrangeSettings | null) => void;
  /** beats in a bar */
  bar: number;
  onLengths: (beats: Record<string, number>) => void;
  /** how long the section lasts, in beats; what it is called; and a way to make it longer */
  length: number;
  label: string;
  onFit: (bars: number) => void;
  /** bars across the ruler (0 = all of them), and whether the view goes along with the music */
  shown: BarsShown;
  follow: boolean;
}) {
  const { state, set } = useApp();
  const chords = state.progression.chords;
  const arr = state.progression.arrange ?? null;
  const span = fretSpan(voicings);
  // with Follow on, the chord that is sounding is kept in sight in its row (sideways only)
  const slotsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = slotsRef.current;
    const el = r?.querySelector<HTMLElement>(".slot.now");
    if (!follow || !r || !el) return;
    const a = el.getBoundingClientRect();
    const b = r.getBoundingClientRect();
    if (a.left < b.left || a.right > b.right) r.scrollLeft += a.left - b.left - 8;
  }, [nowIdx, follow]);
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
        <div className="dock-slots" ref={slotsRef}>
          {chords.length === 0 && !drag ? <span className="dock-empty" aria-label="No chords yet">+</span> : els}
          {chords.length === 0 && drag && drag.index === null && <span className="dock-empty">↓</span>}
        </div>
        </div>
        <div className="dock-foot">
          {/* another section opens at its first bar, as the melody and the drums do */}
          <BarRuler key={state.progression.song?.current ?? ""} chords={chords} bar={bar} length={length} label={label} onFit={onFit} nowIdx={nowIdx} onChange={onLengths} shown={shown} follow={follow} />
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
      <div className="dock-slots mini-slots">{els.length ? els : <span className="dock-empty">{drag ? "↓" : "+"}</span>}</div>
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
