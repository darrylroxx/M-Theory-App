import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Beat } from "../../audio/beats";
import { dbOf, haloOf, meterPos } from "../../audio/levels";
import type { PatternId, PlayItem } from "../../audio/patterns";
import { renderSong } from "../../audio/synth";
import { hearAlone, hearingAlone, onAlone as onAloneChange, stopAlone } from "../../audio/takeplay";
import { Quiet, engineWanted, freeInterface, holdInterface, mayList } from "../../audio/handoff";
import { AIR_BANDS, COLORS, ECHOES, ECHO_TIMES, FX_DEFAULT, PRESETS, SPACES, WIDTHS, echoSeconds, presetFx, reviveFx, type VocalFx } from "../../audio/vocalfx";
import { audioDevices, engineBacking, engineClose, engineOpen, engineSet, engineStart, engineStop, fxRender, isDesktop, type AudioHost, type EngineOpened, type EngineStatus } from "../../desktop";
import { barsInto, clickPlan, cutTakes, groupsOf, passAt, passToMark, sameSound, soundTag, toggled, type Recorded, type Take } from "../../song/takes";
import { addRecording, chooseTake, clipsOf, sameSpot, compClip, deleteClip, deleteTake, inUse, moveClip, placedClips, popUndo, removeRecording, splitClip, trimClip, type Clip, type UndoStep } from "../../song/clips";
import { TakeLane, type LaneBar, type LaneRow } from "./TakeLane";
import { addTrack, renameTrack, tracksOf, type Track } from "../../song/tracks";
import { newId, useApp, type Studio } from "../state";
import { setLive } from "../live";
import { EqGraph } from "./EqGraph";
import { EarIcon } from "../icons";
import { BarsControl, useBarsView } from "./BarsControl";
import { sigName } from "../../song/meter";
import { sectionSig } from "../../song/unity";

/** What a recording goes round, and the song to play under it. */
export interface RecordPlan {
  items: PlayItem[];
  at: { block: string; bar: number };
  beats: number;
  beatsPerBar: number;
  bpm: number;
  pattern: PatternId;
  beat: Beat;
  label: string;
  /** every bar that goes round, in order (for the lane of takes) */
  bars?: LaneBar[];
}

const CHECKS: { id: keyof NonNullable<Studio["checks"]>; label: string; hint: string }[] = [
  { id: "phantom", label: "48V on", hint: "Only for condenser mics. Dynamic mics (like most stage mics) do not need it" },
  { id: "air", label: "Air on", hint: "Optional: a brighter, more open top end, built into the recording" },
  { id: "inst", label: "INST off", hint: "INST is for a guitar plugged into Input 2. For a mic on Input 1 it does nothing" },
  { id: "direct", label: "Direct Monitor on", hint: "On: you hear yourself straight from the interface, dry. Off: you hear yourself through the app's effects" },
];
type Group = "color" | "eq" | "dyn" | "width" | "echo" | "verb" | "out";
const KNOBS: { k: keyof VocalFx; g: Group; label: string; min: number; max: number; step: number; unit?: string; more?: boolean; hint: string }[] = [
  { k: "warmth", g: "color", label: "Amount", min: 0, max: 1, step: 0.01, hint: "How hard the voice is pushed into the colour (the volume stays put)" },
  { k: "mid_q", g: "eq", label: "Low-mid width", min: 0.3, max: 6, step: 0.1, more: true, hint: "How narrow the low-mid bell is (higher = narrower). The mouse wheel on its point does the same" },
  { k: "presence_q", g: "eq", label: "Presence width", min: 0.3, max: 6, step: 0.1, more: true, hint: "How narrow the presence bell is (higher = narrower)" },
  { k: "punch", g: "dyn", label: "Punch", min: 0, max: 1, step: 0.01, hint: "Fast compression (the FET kind): catches peaks, brings the voice forward" },
  { k: "smooth", g: "dyn", label: "Smooth", min: 0, max: 1, step: 0.01, hint: "Slow compression (the optical kind): evens loud and soft phrases out" },
  { k: "deess", g: "dyn", label: "De-ess", min: 0, max: 1, step: 0.01, hint: "Tames sharp s and t sounds" },
  { k: "gate", g: "dyn", label: "Gate", min: 0, max: 1, step: 0.01, more: true, hint: "Turns the quietest moments between phrases down" },
  { k: "deess_freq", g: "dyn", label: "De-ess at", min: 3000, max: 10000, step: 100, unit: "Hz", more: true, hint: "Where the esses are: lower for a deep voice, higher for a bright one" },
  { k: "double", g: "width", label: "Amount", min: 0, max: 1, step: 0.01, hint: "How much width is added beside the voice" },
  { k: "echo", g: "echo", label: "Amount", min: 0, max: 1, step: 0.01, hint: "How loud the echo is" },
  { k: "echo_feedback", g: "echo", label: "Repeats", min: 0, max: 1, step: 0.01, hint: "How many times the echo comes back" },
  { k: "verb", g: "verb", label: "Amount", min: 0, max: 1, step: 0.01, hint: "How loud the reverb is" },
  { k: "verb_size", g: "verb", label: "Size", min: 0, max: 1, step: 0.01, hint: "How big the space is and how long it rings" },
  { k: "verb_tone", g: "verb", label: "Darkness", min: 0, max: 1, step: 0.01, more: true, hint: "Bright to dark" },
  { k: "verb_predelay", g: "verb", label: "Pre-delay", min: 0, max: 0.15, step: 0.005, unit: "s", more: true, hint: "A gap before the reverb, so the words stay clear" },
  { k: "duck", g: "verb", label: "Duck", min: 0, max: 0.9, step: 0.01, more: true, hint: "How far the echo and reverb step back while you sing" },
  { k: "level", g: "out", label: "Level", min: -12, max: 12, step: 0.5, unit: "dB", more: true, hint: "Output level of the chain" },
];
const sig = (fx: VocalFx) => JSON.stringify(fx);
const BUFFERS = [32, 48, 64, 96, 128, 192, 256, 512];
/** the interfaces found, kept for the session: listing them loads every driver in turn, which can upset one that is playing */
let listed: AudioHost[] | null = null;
/** Until the driver's own figure is in: about how long a sound takes to go in and come back out at a buffer size. */
const roundTrip = (block: number, rate: number) => Math.round(((2 * block) / rate) * 1000 + 2);
/** A long session is noted from this many minutes on (small, beside the pass number). */
const LONG_MIN = 30;
/** Less than this much room on the disk is noted too (bytes). */
const LOW_DISK = 2e9;
/** And less than this many minutes before the file is as big as a WAV can be. */
const ROOM_MIN = 10;
/** The first moments of a pass in which K marks the pass that has just ended: at most this long (s), and at most an eighth of the pass. */
const GRACE_S = 2;
/** Only a box that takes words keeps K to itself: a slider, a tick box or a list touched mid-session must not stop K from keeping a pass. */
const TEXT_INPUTS = new Set(["text", "number", "search", "email", "url", "password", "tel"]);
const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && ((el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type)) || el.tagName === "TEXTAREA" || el.isContentEditable);

/**
 * Vocals: the vocal tracks, the interface, the live vocal sound, and recording take after take
 * over a loop. Everything that touches the interface runs in the Windows app.
 *
 * Recording is made for staying in the flow: the loop goes round and round, as long as the
 * singer wants, until ■. The pass being sung is shown big, a thin line fills as it goes by,
 * and every pass already sung waits in a row: tap one (or press K) to keep it ★. Nothing
 * pops up and nothing moves while singing.
 */
export function VocalsPage({ active, recordPlan, onRecording, recording, playing, getWhere, onAlone }: {
  active: boolean;
  recordPlan: () => RecordPlan | null;
  onRecording: (on: boolean) => void;
  recording: boolean;
  /** the song is playing in the app (not through the interface) */
  playing: boolean;
  /** which section is sounding and how far into it, while the song plays in the app */
  getWhere: () => { block: string; beat: number } | null;
  /** a take is about to be heard alone: the song stops */
  onAlone: () => void;
}) {
  const { state, set, toast, setRecordingTo } = useApp();
  const studio = state.studio ?? {};
  const setStudio = (patch: Partial<Studio>) => set((s) => ({ ...s, studio: { ...s.studio, ...patch } }));
  const vocals = tracksOf(state.progression, "vocals");
  // which vocal track is shown (the Frame and Track pages can open one)
  const sel = studio.vocal ?? null;
  const setSel = (id: string) => setStudio({ vocal: id });
  const track = vocals.find((t) => t.id === sel) ?? vocals[0];
  // a sound saved before colours, spaces and echo types existed gets their defaults
  const fx: VocalFx = useMemo(() => reviveFx(track?.fx) ?? FX_DEFAULT, [track?.fx]);
  const desktop = isDesktop();
  const bpm = state.progression.bpm;
  // bars on screen and Follow, shared with every other page
  const { shown, follow } = useBarsView();

  const [hosts, setHosts] = useState<AudioHost[] | null>(listed);
  const [opened, setOpened] = useState<EngineOpened | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "preparing" | "rehearsing" | "recording" | "saving">("idle");
  const rate = useRef(48000);
  const [more, setMore] = useState(false);
  const [shorts, setShorts] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const grRef = useRef<HTMLSpanElement>(null);
  const limRef = useRef<HTMLSpanElement>(null);
  const dropRef = useRef<HTMLSpanElement>(null);
  const slowRef = useRef<HTMLSpanElement>(null);
  const drops = useRef({ n: 0, at: 0 });
  const blockRef = useRef<HTMLSpanElement>(null);
  const hold = useRef<number[]>([]);
  const planRef = useRef<RecordPlan | null>(null);
  const trackRef = useRef<Track | null>(null);
  // ── the flow while recording ──
  /** the pass being sung (0 in the count-in, or when not recording); it changes once a pass */
  const [pass, setPass] = useState(0);
  /** passes marked ★ in this recording */
  const [marks, setMarks] = useState<Set<number>>(() => new Set());
  const marksRef = useRef(marks);
  marksRef.current = marks;
  /** a pass just marked with K, shown for a moment */
  const [flash, setFlash] = useState(0);
  /** the last report from the engine, and when it came (the line between reports is worked out from the rate) */
  const status = useRef<{ pos: number; count_in: number; length: number; at: number } | null>(null);
  const warnRef = useRef<HTMLSpanElement>(null);
  const renderRef = useRef<HTMLSpanElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef("idle");
  const fullRef = useRef(false);
  /** the recording begun last has been cut into takes (it is never saved twice, nor lost between a stop and a reset) */
  const savedRef = useRef(true);
  /** its file, as the engine named it: a recording handed back is kept only if it is this one */
  const pathRef = useRef<string | null>(null);
  /** counts every start: work left over from an earlier recording never touches a later one */
  const session = useRef(0);
  /** the key and the section's own time signature when it began: its takes keep them */
  const sungIn = useRef({ key: "", sig: "" });
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const salvageRef = useRef<(r: Recorded) => void>(() => {});
  const fxRef = useRef<VocalFx>(fx);
  fxRef.current = fx;
  phaseRef.current = phase;

  const setTrack = (patch: (t: Track) => Track) => track && set((s) => ({ ...s, progression: { ...s.progression, tracks: (s.progression.tracks ?? []).map((t) => (t.id === track.id ? patch(t) : t)) } }));
  const setFx = (patch: Partial<VocalFx>) => setTrack((t) => ({ ...t, fx: { ...(t.fx ?? FX_DEFAULT), ...patch } }));

  // the app's own sound (the song, a take heard alone): the engine waits until it has been quiet
  // for a moment, and the song waits for the engine to close first (see handoff.ts)
  const [aloneOn, setAloneOn] = useState(hearingAlone);
  useEffect(() => onAloneChange(setAloneOn), []);
  const [quiet, setQuiet] = useState(() => !playing && !hearingAlone());
  const quietRef = useRef<Quiet | null>(null);
  quietRef.current ??= new Quiet(setQuiet);
  useEffect(() => quietRef.current!.sound(playing || aloneOn), [playing, aloneOn]);
  useEffect(() => () => quietRef.current?.dispose(), []);
  /** waiting for the engine to close (a sound about to start), and to open (a recording about to start) */
  const closers = useRef<(() => void)[]>([]);
  const openers = useRef<((o: EngineOpened | null) => void)[]>([]);

  const monitor = (studio.monitor ?? "hardware") === "effects";
  // the list of interfaces: once a session, and again only after a problem (never while the
  // interface is being opened, nor while the app plays unless you hear yourself through the
  // effects: listing loads every driver in turn; see handoff.ts mayList)
  const listNow = mayList({ active, recording, busy: phase !== "idle", monitor, quiet });
  useEffect(() => {
    if (!desktop || !listNow || (hosts && !error)) return;
    void audioDevices().then((h) => {
      listed = h;
      setHosts(h);
    });
  }, [desktop, listNow, !!error]); // eslint-disable-line react-hooks/exhaustive-deps
  const devices = (hosts ?? []).flatMap((h) => h.devices.filter((d) => (d.input?.channels ?? 0) > 0 && (d.output?.channels ?? 0) > 0).map((d) => ({ host: h.name, name: d.name, channels: d.input!.channels })))
    .sort((a, b) => Number(b.host.toUpperCase() === "ASIO") - Number(a.host.toUpperCase() === "ASIO") || Number(/focusrite|scarlett/i.test(b.name)) - Number(/focusrite|scarlett/i.test(a.name)));
  const chosen = devices.find((d) => d.host === studio.host && d.name === studio.device) ?? devices[0];

  // the interface is open while recording or rehearsing, whenever you hear yourself through the
  // effects (then it stays open on every page), and while this page is on screen once the app's
  // own sound has stopped (see handoff.ts)
  const keepOpen = engineWanted({ recording, busy: phase !== "idle", monitor, active, quiet });
  /** closed only because the app is sounding: Record and Rehearse open it again at once */
  const resting = desktop && !!chosen && !opened && !keepOpen && active && !error;
  /** bumped when the driver resets (its buffer size or rate was changed in the Focusrite Notifier): the interface is opened again */
  const [reopen, setReopen] = useState(0);
  useEffect(() => {
    if (!desktop || !keepOpen || !chosen) return;
    let live = true;
    setError(null);
    engineOpen(chosen.host, chosen.name, studio.buffer ?? null, (st: EngineStatus) => {
      if (!live) return;
      if (st.invalid) {
        live = false;
        toast("The interface's settings changed: opening it again");
        // a rehearsal simply ends (a recording comes back as the interface closes, and is kept)
        if (phaseRef.current === "rehearsing") {
          setPhase("idle");
          onRecording(false);
        }
        window.setTimeout(() => setReopen((n) => n + 1), 300);
        return;
      }
      const el = barsRef.current;
      el?.querySelectorAll<HTMLElement>("[data-ch]").forEach((bar) => {
        const c = Number(bar.dataset.ch);
        const db = dbOf(st.peak[c] ?? 0);
        hold.current[c] = Math.max(db, (hold.current[c] ?? -Infinity) - 0.6);
        bar.style.setProperty("--lvl", String(meterPos(db)));
        bar.style.setProperty("--hold", String(meterPos(hold.current[c])));
        bar.dataset.halo = haloOf(db);
        const label = bar.querySelector<HTMLElement>(".vm-db");
        if (label) label.textContent = Number.isFinite(hold.current[c]) && hold.current[c] > -60 ? `${hold.current[c].toFixed(0)} dB` : "—";
      });
      if (grRef.current) grRef.current.textContent = st.reduction > 0.5 ? `−${st.reduction.toFixed(1)} dB` : "";
      if (limRef.current) limRef.current.hidden = !((st.limit ?? 0) > 0.5);
      // dropouts: the computer could not keep up at this buffer size
      if (st.xruns !== drops.current.n) drops.current = { n: st.xruns, at: performance.now() };
      if (blockRef.current && st.block) blockRef.current.textContent = st.latency > 0 ? `${st.latency.toFixed(1)} ms` : `~${roundTrip(st.block, opened?.rate ?? 48000)} ms`;
      if (dropRef.current) dropRef.current.textContent = st.xruns ? `${st.xruns} dropout${st.xruns === 1 ? "" : "s"}` : "no dropouts";
      if (slowRef.current) slowRef.current.hidden = !(st.xruns && performance.now() - drops.current.at < 6000);
      const going = phaseRef.current === "recording" || phaseRef.current === "rehearsing";
      status.current = going && st.running ? { pos: st.pos, count_in: st.count_in, length: st.length, at: performance.now() } : null;
      const at = going && st.running ? passAt(st.pos, st.count_in, st.length) : null;
      if (countRef.current) {
        const p = planRef.current;
        if (!st.running || !p) countRef.current.textContent = "";
        else if (st.pos < st.count_in) {
          // the count-in, once, at the very start: one number a beat
          const beatLen = (rate.current * 60) / Math.max(1, p.bpm);
          countRef.current.textContent = `${Math.ceil((st.count_in - st.pos) / beatLen)}`;
        } else if (at) countRef.current.textContent = `Pass ${at.n}`;
      }
      // the row of passes grows once a pass (the only thing that redraws while singing)
      const n = phaseRef.current === "recording" && at ? at.n : 0;
      setPass((was) => (was === n ? was : n));
      if (warnRef.current) {
        // small notes for a long session: how long it has run, and what room is left
        const r = rate.current;
        const min = st.running && phaseRef.current === "recording" ? st.pos / r / 60 : 0;
        // the most pressing first (the line is short, and its end may not show)
        const warns: string[] = [];
        if (phaseRef.current === "recording" && st.room != null && st.recorded && st.room / r < ROOM_MIN * 60) warns.push(`${Math.max(0, Math.floor(st.room / r / 60))} min left`);
        if (phaseRef.current === "recording" && st.free != null && st.free < LOW_DISK) warns.push(`${(st.free / 1e9).toFixed(1)} GB free`);
        const notes = warns.length ? [`⚠ ${warns.join(" · ")}`] : [];
        if (min >= LONG_MIN) notes.push(`${Math.floor(min)} min`);
        const text = notes.join(" · ");
        if (warnRef.current.textContent !== text) warnRef.current.textContent = text;
        warnRef.current.classList.toggle("warn", warns.length > 0);
      }
      if (renderRef.current) renderRef.current.textContent = st.render ? `${Math.round(st.render * 100)}%` : "";
      // the file cannot take any more (it is as big as a WAV can be, or the disk is full): stop and keep what there is
      if (st.full && phaseRef.current === "recording" && !fullRef.current) {
        fullRef.current = true;
        void stopRef.current();
      }
    }).then((o) => { if (live) { rate.current = o.rate; setOpened(o); openers.current.splice(0).forEach((f) => f(o)); } }).catch((e) => { if (live) { setOpened(null); setError(String(e)); openers.current.splice(0).forEach((f) => f(null)); } });
    // closing: a recording still going (the driver was reset mid-session) comes back, and its takes are kept
    return () => {
      live = false;
      void engineClose()
        .then((r) => r && salvageRef.current(r), () => {})
        .then(() => closers.current.splice(0).forEach((f) => f()));
      setOpened(null);
    };
  }, [desktop, keepOpen, chosen?.host, chosen?.name, reopen, studio.buffer]); // eslint-disable-line react-hooks/exhaustive-deps

  // open only because this page is on screen: a sound about to start closes it first (see handoff.ts)
  useEffect(() => {
    if (!opened || monitor || recording || phase !== "idle") return;
    return holdInterface(
      () =>
        new Promise<void>((done) => {
          closers.current.push(done);
          quietRef.current!.handOff();
        }),
    );
  }, [opened, monitor, recording, phase]);

  // the takes are on their track (or there were none): the idea can be left again
  useEffect(() => {
    if (phase === "idle") setRecordingTo(null);
  }, [phase, setRecordingTo]);
  useEffect(() => () => setRecordingTo(null), [setRecordingTo]);
  useEffect(() => setLive(!!opened && monitor), [opened, monitor]);
  useEffect(() => () => setLive(false), []);

  // what the singer hears follows the page at once
  useEffect(() => {
    if (!opened) return;
    const t = window.setTimeout(() => void engineSet({ monitor, input: (track?.input ?? 1) - 1, fx, backingGain: studio.backing ?? 1, clickGain: studio.click ?? 0.5, clickOn: !!studio.clickOn }).catch(() => {}), 30);
    return () => window.clearTimeout(t);
  }, [opened, monitor, track?.input, sig(fx), studio.backing, studio.click, studio.clickOn]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureTrack = (): Track => {
    if (track) return track;
    const id = newId();
    let made: Track | null = null;
    set((s) => {
      const r = addTrack(s.progression, "vocals", id);
      made = r.track;
      return { ...s, progression: r.p };
    });
    setSel(id);
    return made ?? { id, kind: "vocals", name: "Vocal 1", input: 1 };
  };

  /** Render the loop's song, hand it to the engine, and start (recording or just singing along). */
  const go = async (record: boolean) => {
    let o = opened;
    if (!o && resting) {
      // closed while the app played: the song stops (as it does for a recording) and the interface opens at once
      onRecording(true);
      o = await new Promise<EngineOpened | null>((done) => {
        openers.current.push(done);
        window.setTimeout(() => done(null), 8000);
      });
      if (!o) onRecording(false);
    }
    if (!o) return toast("The interface is not open");
    const rateNow = o.rate;
    const plan = recordPlan();
    if (!plan || plan.beats <= 0) return toast("Nothing to sing over: set a loop or pick a section");
    const t = record ? ensureTrack() : track;
    // until its takes are on the track, the idea stays open and the track stays (see recordingTo)
    if (record && t) setRecordingTo(t.id);
    planRef.current = plan;
    trackRef.current = t ?? null;
    fullRef.current = false;
    savedRef.current = !record;
    pathRef.current = null;
    session.current += 1;
    sungIn.current = { key: `${state.key.tonic}|${state.key.scaleId}`, sig: sigName(sectionSig(state.progression, plan.at.block)) };
    atEnd.current = true;
    setMarks(new Set());
    setPass(0);
    stopAlone();
    onRecording(true);
    setPhase("preparing");
    try {
      const [l, r] = await renderSong(plan.items, { bpm: plan.bpm, pattern: plan.pattern, beat: plan.beat, rate: rateNow, skip: record ? t?.id : undefined });
      await engineBacking(l, r);
      // the count-in is in the meter of the loop's first bar; after it, every bar clicks in its own
      const click = clickPlan(plan.bars, plan.beatsPerBar, studio.countIn ?? 1);
      const path = await engineStart({ bpm: plan.bpm, countInBeats: click.countInBeats, beatsPerBar: click.beatsPerBar, bars: click.bars, record, name: t?.name ?? "Vocal" });
      pathRef.current = record ? path : null;
      setPhase(record ? "recording" : "rehearsing");
    } catch (e) {
      setPhase("idle");
      onRecording(false);
      toast(String(e));
    }
  };

  /**
   * The recording begun last, claimed by whichever hands it over first (a stop, or a close after
   * the driver reset): what it went round, on which track, and the passes marked ★. Only that
   * recording, and only once; an older one handed back stays on disk, untouched.
   */
  const claim = (r: Recorded) => {
    const plan = planRef.current;
    const track = trackRef.current;
    if (savedRef.current || !plan || !track || r.dry !== pathRef.current) return null;
    savedRef.current = true;
    return { plan, track, kept: marksRef.current, session: session.current, ...sungIn.current };
  };

  /**
   * A recording that has ended, cut into one take per pass. The passes marked ★ are the
   * keepers, and the last of them is the one that plays (else the last full pass). `used`: the
   * vocal sound its file was made with (the knobs may have moved while it was being made).
   */
  const save = (r: Recorded, c: NonNullable<ReturnType<typeof claim>>, used: VocalFx, lead = "") => {
    const group = newId();
    const nudge = Math.round(((studio.nudge ?? 0) / 1000) * r.rate);
    // with no vocal sound on it (no room for that file), a take plays dry and "Apply sound" is offered
    const sound = r.wet === r.dry ? "" : soundTag(used);
    // the tempo, key and time signature it was sung in
    const takes = cutTakes(r, { group, at: c.plan.at, nudge, id: newId, kept: c.kept }).map((x) => ({ ...x, sound, bpm: c.plan.bpm, key: c.key, sig: c.sig }));
    if (!takes.length) return toast("Stopped before the first take");
    // the take that plays (the last ★, else the last full pass) is laid whole where it was sung
    // (sung again over the same bars, it plays there instead of what played: the earlier takes are a Use away)
    set((s) => {
      // (the track is there: it cannot be removed while it is recorded on; if it went all the same, it comes back with its takes, never lost)
      const p = (s.progression.tracks ?? []).some((x) => x.id === c.track.id) ? s.progression : addTrack(s.progression, "vocals", c.track.id).p;
      return { ...s, progression: { ...p, tracks: (p.tracks ?? []).map((x) => (x.id === c.track.id ? { ...x, ...addRecording(x, takes, newId) } : x)) } };
    });
    const full = takes.filter((x) => !x.short).length || takes.length;
    const stars = takes.filter((x) => x.keep).length;
    const filled = (r.padded ?? 0) / r.rate;
    const lost = filled > 0 ? ` · ${filled < 1 ? `${Math.round(filled * 1000)} ms` : `${filled.toFixed(1)} s`} lost and filled with silence, timing kept: try a bigger buffer` : r.dropped ? " (some audio was lost: try a bigger buffer)" : "";
    toast(`${lead}${full} take${full === 1 ? "" : "s"} recorded${stars ? ` · ★ ${stars}` : ""}${lost}${r.note ? ` (${r.note})` : ""}`);
  };

  const stop = async () => {
    const used = fx;
    setPhase("saving");
    try {
      const r = await engineStop(used);
      const c = r && claim(r);
      if (r && c) save(r, c, used);
    } catch (e) {
      toast(String(e));
    } finally {
      setPhase("idle");
      onRecording(false);
      setMarks(new Set());
    }
  };
  stopRef.current = stop;

  /**
   * The driver was reset in the middle of a recording, and the interface closed under it: the
   * recording came back (dry), so the session is kept. The vocal sound is put on it here, while
   * the interface opens again.
   */
  const salvage = async (r: Recorded) => {
    // claimed at once: a new recording begun while this one is being made is never mixed up with it
    const c = claim(r);
    if (!c) return;
    const mine = () => session.current === c.session;
    const used = fxRef.current;
    setPhase("saving");
    let wet = r.dry;
    let note = r.note ?? null;
    try {
      wet = await fxRender(r.dry, used);
    } catch (e) {
      note = `no vocal sound (${String(e)})`;
    }
    save({ ...r, wet, note }, c, used, "The interface reset; the recording is kept: ");
    if (mine()) {
      setPhase("idle");
      onRecording(false);
      setMarks(new Set());
    }
  };
  salvageRef.current = (r) => void salvage(r);

  // ── marking passes ★ ──
  const mark = useCallback((n: number, on?: boolean) => {
    if (n < 1) return;
    setMarks((m) => (on === undefined || m.has(n) !== on ? toggled(m, n) : m));
  }, []);
  /** K: keep the pass being sung, or, in its first moments, the one that has just ended */
  const markNow = useCallback(() => {
    const s = status.current;
    const at = s && passAt(s.pos, s.count_in, s.length);
    if (!s || !at) return;
    const n = passToMark(at, Math.min(0.125, (GRACE_S * rate.current) / Math.max(1, s.length)));
    mark(n, true);
    setFlash(n);
  }, [mark]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(0), 700);
    return () => window.clearTimeout(t);
  }, [flash]);
  useEffect(() => {
    if (phase !== "recording") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "k" && e.key !== "K") || e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      markNow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, markNow]);
  // the newest pass stays in view, unless the row was scrolled back to find an older one
  const atEnd = useRef(true);
  useEffect(() => {
    const el = rowRef.current;
    if (el && atEnd.current) el.scrollLeft = el.scrollWidth;
  }, [pass]);

  // ── takes and clips ──
  const groups = groupsOf(track?.takes).reverse();
  /** what an edit changes on a track (and an undo puts back) */
  type Snap = Pick<Track, "takes" | "clips" | "active">;
  const snapOf = (t: Track): Snap => ({ takes: t.takes, clips: t.clips, active: t.active });
  const isAt = (t: Track | undefined, x: Snap) => !!t && t.takes === x.takes && t.clips === x.clips && t.active === x.active;
  /** the edits made on this page, newest last: Ctrl+Z (or ↶) takes back the last one made on the track shown */
  const undoRef = useRef<UndoStep<Snap>[]>([]);
  const [, setUndoN] = useState(0);
  /** can the track shown have an edit taken back? */
  const undoN = track ? undoRef.current.filter((x) => x.track === track.id).length : 0;
  const trackIn = (s: { progression: { tracks?: Track[] } }, id: string) => (s.progression.tracks ?? []).find((t) => t.id === id);
  const putSnap = (id: string, x: Snap) => set((s) => ({ ...s, progression: { ...s.progression, tracks: (s.progression.tracks ?? []).map((t) => (t.id === id ? { ...t, ...x } : t)) } }));
  /** Change the takes or clips of the track shown; `undo`: a message offering ↶ */
  const edit = (fn: (t: Track) => Partial<Snap>, undo?: string) => {
    if (!track) return;
    const before = snapOf(track);
    const after = { ...before, ...fn(track) };
    if (isAt({ ...track, ...after }, before)) return;
    undoRef.current = [...undoRef.current.slice(-99), { track: track.id, before, after }];
    setUndoN((n) => n + 1);
    putSnap(track.id, after);
    const id = track.id;
    if (undo) toast(undo, { label: "↶", aria: "Undo", when: (s) => isAt(trackIn(s, id), after), run: () => undoKey.current(id) });
  };
  /** Take back the last edit made on a track (the one shown, unless said) */
  const takeBack = (id = track?.id) => {
    if (!id) return;
    const { step: last, rest } = popUndo(undoRef.current, id);
    undoRef.current = rest;
    setUndoN((n) => n + 1);
    if (!last) return;
    // only onto what it left: if something else changed it since (a new recording, say), nothing is undone over that
    if (!isAt(trackIn(state, last.track), last.after)) {
      undoRef.current = rest.filter((x) => x.track !== id);
      return toast("Nothing to undo");
    }
    putSnap(last.track, last.before);
  };
  // Ctrl+Z on this page (not while recording, nor in a box being typed in)
  const undoKey = useRef(takeBack);
  undoKey.current = takeBack;
  const shownRef = useRef(track?.id);
  shownRef.current = track?.id;
  useEffect(() => {
    if (!active || phase !== "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || (e.key !== "z" && e.key !== "Z") || isTyping(e.target) || !undoRef.current.some((x) => x.track === shownRef.current)) return;
      e.preventDefault();
      undoKey.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, phase]);

  /** Use a take: it plays wherever its recording does (in every clip of it) */
  const choose = (id: string) => edit((t) => chooseTake(t, id, newId()));
  /** ★ a take afterwards (or take the ★ off) */
  const setKeep = (id: string, keep: boolean) => edit((t) => ({ takes: (t.takes ?? []).map((x) => (x.id !== id ? x : keep ? { ...x, keep: true } : (({ keep: _, ...rest }) => rest)(x))) }));
  const removeGroup = (g: string) => {
    if (!window.confirm("Remove this recording and all its takes? (The files stay in Music › M-Theory › Recordings.)")) return;
    edit((t) => removeRecording(t, g), "Recording removed");
  };
  /** Delete a take from the song (its file stays on disk); whatever played it plays the next best take */
  const dropTake = (tk: Take) => {
    if (selTake === tk.id) {
      // the selection moves on to the next take in the list
      const list = browseList();
      const i = list.findIndex((x) => x.id === tk.id);
      setSelTake((list[i + 1] ?? list[i - 1])?.id ?? null);
    }
    edit((t) => deleteTake(t, tk.id), `Take ${tk.n} deleted`);
  };
  // ── the clip editor ──
  const [selClip, setSelClip] = useState<string | null>(null);
  const [selTake, setSelTake] = useState<string | null>(null);
  const [cut, setCut] = useState(false);
  const [snap, setSnap] = useState(true);
  const setClips = (fn: (cs: Clip[], t: Track) => Clip[], undo?: string) => edit((t) => ({ clips: fn(clipsOf(t), t) }), undo);
  const placed = track ? placedClips(track) : [];
  const selPlaced = placed.find((x) => x.clip.id === selClip) ?? null;
  // ── hearing takes alone ──
  /** the take being heard alone */
  const [alone, setAlone] = useState<string | null>(null);
  useEffect(() => onAloneChange((on) => !on && setAlone(null)), []);
  /** Hear a take alone (or a clip's stretch of it): the song stops, and so does any take heard alone before (only one is ever heard). */
  const preview = async (tk: Take, part?: { from: number; to: number }) => {
    // (not over a song the interface is playing)
    if (phaseRef.current !== "idle") return;
    onAlone();
    // the interface's own engine closes first, so it is not playing through the interface at the same time (see handoff.ts)
    await freeInterface();
    // just this take is read from the recording, so it plays from its own start
    const ok = await hearAlone(tk, track?.id ?? "vocals", part);
    if (ok) setAlone(tk.id);
    else if (ok === false) toast("Could not read the recording");
  };
  const playStop = (tk: Take) => (alone === tk.id ? stopAlone() : void preview(tk));
  // a take heard alone stops when the page is left (or goes away)
  useEffect(() => {
    if (!active) stopAlone();
  }, [active]);
  useEffect(() => () => stopAlone(), []);
  // ── sifting through the takes ──
  const [starOnly, setStarOnly] = useState(false);
  /** the takes listed, in order: newest recording first, its passes as they were sung */
  const browseList = () => groups.flatMap((g) => (track?.takes ?? []).filter((t) => t.group === g && (!starOnly || t.keep) && (shorts || !t.short || t.keep || (track && inUse(track, t.id)))));
  const stale = (track?.takes ?? []).some((t) => !sameSound(t, fx));
  const applySound = async () => {
    if (!track?.takes?.length) return;
    setBusy("…");
    try {
      const drys = [...new Set(track.takes.filter((t) => !sameSound(t, fx)).map((t) => t.dry))];
      const made: Record<string, string> = {};
      for (const d of drys) made[d] = await fxRender(d, fx);
      // the takes that play are read again (just them) once the song sees their new files
      setTrack((t) => ({ ...t, takes: (t.takes ?? []).map((x) => (made[x.dry] ? { ...x, wet: made[x.dry], sound: soundTag(fx) } : x)) }));
      toast("Takes updated");
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(null);
    }
  };

  const rename = () => {
    if (!track) return;
    const name = window.prompt("Name this vocal track", track.name);
    if (name) set((s) => ({ ...s, progression: renameTrack(s.progression, track.id, name) }));
  };
  const add = () => {
    const id = newId();
    set((s) => ({ ...s, progression: addTrack(s.progression, "vocals", id).p }));
    setSel(id);
  };
  /** One part of the vocal sound: its name, its choice of type, its knobs. */
  const group = (g: Group, title: string, picker: React.ReactNode, body?: React.ReactNode) => (
    <div className="vc-group-box" role="group" aria-label={title}>
      <div className="vc-group-head"><b className="vc-title">{title}</b>{picker}</div>
      {body}
      <div className="vc-knobs">
        {KNOBS.filter((k) => k.g === g && (more || !k.more)).map((k) => (
          <label key={k.k} className="vc-knob" title={k.hint}>
            <span>{k.label}<small className="mono">{(fx[k.k] as number).toFixed(k.step < 0.1 ? 2 : k.step < 1 ? 1 : 0).replace(/\.0+$|(\.\d*?)0+$/, "$1") || "0"}{k.unit ? ` ${k.unit}` : ""}</small></span>
            <input type="range" min={k.min} max={k.max} step={k.step} disabled={!track} value={fx[k.k] as number} aria-label={`${title}: ${k.label}`} onChange={(e) => setFx({ [k.k]: Number(e.target.value) } as Partial<VocalFx>)} />
          </label>
        ))}
      </div>
    </div>
  );
  const channels = Math.min(2, opened?.inputs ?? chosen?.channels ?? 2);
  const checks = studio.checks ?? {};
  const running = phase !== "idle";
  const plan = recordPlan();
  // the lane: the bars being recorded over (while recording, exactly those the engine goes round)
  const laneBars = (running ? planRef.current?.bars : undefined) ?? plan?.bars ?? [];
  const laneRef = useRef(laneBars);
  laneRef.current = laneBars;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  /** "● 2 · ": which recording a take is from (in the take picker, when it offers takes of more than one) */
  const recNo = (g: string, other: boolean) => (other && groups.length > 1 ? `● ${groups.length - groups.indexOf(g)} · ` : "");
  // each recording a row of its clips, newest first
  const laneRows: LaneRow[] = groups.map((g, gi) => ({ group: g, label: `● ${groups.length - gi}`, clips: placed.filter((x) => x.take.group === g) }));
  /** How far across the lane the music is: from the engine while singing over the loop, from the app's player while the song plays. */
  const where = useCallback((): number | null => {
    const s = status.current;
    if (s) {
      // between the engine's reports, the music has moved on at its rate
      const pos = s.pos + Math.min(0.1, (performance.now() - s.at) / 1000) * rate.current;
      const at = passAt(pos, s.count_in, s.length);
      if (!at) return null;
      // the lane draws every bar the same width: a loop from a 4/4 section into a 3/4 one is
      // further on the lane than in time once it is in the shorter bars
      const bars = laneRef.current;
      let total = 0;
      for (const b of bars) total += b.beats;
      return total > 0 ? barsInto(bars, at.frac * total) / bars.length : at.frac;
    }
    if (!playingRef.current) return null;
    const w = getWhere();
    const bars = laneRef.current;
    const per = w ? bars.find((b) => b.block === w.block)?.beats : undefined;
    if (!w || !per) return null;
    const k = Math.floor(w.beat / per + 1e-9);
    const i = bars.findIndex((b) => b.block === w.block && b.bar === k);
    return i < 0 ? null : (i + (w.beat / per - k)) / bars.length;
  }, [getWhere]);

  /** the take a clip plays, from a track's own takes */
  const takeIn = (cs: Clip[], t: Track, id: string) => {
    const c = cs.find((x) => x.id === id);
    return c ? (t.takes ?? []).find((k) => k.id === c.take) : undefined;
  };
  const laneEdit = track && !running ? {
    selected: selClip,
    onSelect: (x: { clip: Clip; take: Take } | null) => {
      setSelClip(x?.clip.id ?? null);
      if (x) setSelTake(x.take.id);
    },
    cut, snap,
    onTrim: (id: string, edge: "from" | "to", frame: number) => setClips((cs, t) => { const tk = takeIn(cs, t, id); return tk ? trimClip(cs, id, edge, frame, tk) : cs; }),
    onMove: (id: string, m: number) => setClips((cs) => moveClip(cs, id, m)),
    onSplit: (id: string, frame: number) => {
      const nid = newId();
      setClips((cs, t) => { const tk = takeIn(cs, t, id); return tk ? splitClip(cs, id, frame, tk, nid) : cs; });
      // ✂ cuts once: the next tap picks a piece
      setCut(false);
    },
    onDelete: (id: string) => {
      setClips((cs) => deleteClip(cs, id), "Clip deleted");
      setSelClip(null);
    },
    onHear: desktop ? (x: { clip: Clip; take: Take }) => void preview(x.take, x.clip) : undefined,
    keys: active,
  } : undefined;
  const lane = laneBars.length > 0 ? (
    <TakeLane bars={laneBars} rows={laneRows} bpm={bpm} where={where} shown={shown} follow={follow}
      live={active && (playing || phase === "recording" || phase === "rehearsing")} edit={laneEdit} />
  ) : null;
  /** the takes the selected clip can play instead (of its recording, or another sung from the same bar) */
  const swaps = selPlaced ? (track?.takes ?? []).filter((t) => sameSpot(t, selPlaced.take)) : [];
  const manyRecs = new Set(swaps.map((t) => t.group)).size > 1;
  // the editor's tools: ✂, Snap, and for the clip selected, which take it plays, hear it, delete it
  const tools = laneBars.length > 0 && (placed.length > 0 || undoN > 0) && !running && track ? (
    <div className="tl-tools" role="toolbar" aria-label="Edit clips">
      <button className={`icon-btn${cut ? " on" : ""}`} aria-pressed={cut} aria-label="Cut: tap a clip to split it (S)" title="Cut: tap a clip to split it (S)" onClick={() => setCut(!cut)}>✂</button>
      <button className={`btn sm${snap ? " on" : ""}`} aria-pressed={snap} title="Moves keep to 1/16 notes (hold Alt or Shift to move freely)" onClick={() => setSnap(!snap)}>Snap</button>
      <button className="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!undoN} onClick={() => takeBack()}>↶</button>
      {selPlaced && (
        <span className="tl-sel">
          <select aria-label="Take in this clip" value={selPlaced.take.id} onChange={(e) => { const to = e.target.value; setClips((_, t) => compClip(t, selPlaced.clip.id, to)); setSelTake(to); }}>
            {swaps.map((t) => <option key={t.id} value={t.id}>{recNo(t.group, manyRecs)}Take {t.keep ? "★" : ""}{t.n}{t.short ? " ·" : ""}</option>)}
          </select>
          {desktop && <button className="icon-btn" aria-label="Hear this clip alone" title="Hear this clip alone" onClick={() => void preview(selPlaced.take, selPlaced.clip)}>▶</button>}
          <button className="icon-btn" aria-label="Delete this clip" title="Delete this clip (Delete)" onClick={() => laneEdit?.onDelete(selPlaced.clip.id)}>✕</button>
        </span>
      )}
    </div>
  ) : null;

  const list = browseList();
  const takesBox = track && groups.length > 0 ? (
    <TakeBrowser track={track} groups={groups} list={list} sel={selTake} setSel={setSelTake} alone={alone} canHear={desktop} playStop={playStop} starOnly={starOnly} setStarOnly={setStarOnly}
      running={running} stale={stale} busy={busy} shorts={shorts} setShorts={setShorts} applySound={() => void applySound()} choose={choose} setKeep={setKeep} drop={dropTake} removeGroup={removeGroup} />
  ) : null;

  return (
    <section className="card vocals" aria-label="Vocals">
      <div className="dm-head">
        <span className="seg clip-tracks" role="radiogroup" aria-label="Vocal track">
          {vocals.map((t) => <button key={t.id} role="radio" aria-checked={track?.id === t.id} className={track?.id === t.id ? "on" : ""} disabled={running} onClick={() => setSel(t.id)} onDoubleClick={rename}>{t.name}</button>)}
          <button className="clip-add" aria-label="Add a vocal track" title="Add a vocal track" onClick={add} disabled={running}>+</button>
        </span>
        <span className="spacer" />
        {laneBars.length > 0 && <BarsControl />}
      </div>

      {!desktop && <p className="small vc-note">Recording: in the Windows app.</p>}
      {/* in the browser too: the takes already made, and the line while the song plays */}
      {!desktop && tools}
      {!desktop && lane}

      {desktop && (
        <>
          <div className="vc-rec">
            <button className={`rec-btn${phase === "recording" ? " on" : ""}`} aria-label={phase === "recording" ? "Stop recording" : "Record"} title={phase === "recording" ? "Stop" : "Record take after take over the loop, after a count-in"} disabled={!(opened || resting) || phase === "preparing" || phase === "saving" || phase === "rehearsing"} onClick={() => (phase === "recording" ? void stop() : void go(true))}>{phase === "recording" ? "■" : "●"}</button>
            <button className="btn sm" disabled={!(opened || resting) || phase === "preparing" || phase === "saving" || phase === "recording"} onClick={() => (phase === "rehearsing" ? void stop() : void go(false))} title="Sing along over the loop without recording" aria-label={phase === "rehearsing" ? "Stop" : "Rehearse: sing over the loop without recording"}>{phase === "rehearsing" ? "■" : <><EarIcon /> ▶</>}</button>
            <span className="vc-state">
              <b ref={countRef} className="vc-count" />
              <span className="small muted vc-sub">{phase === "preparing" || phase === "saving" ? <>… <span ref={renderRef} /></> : phase === "idle" ? `↻ ${plan?.label ?? "—"}` : <span ref={warnRef} className="vc-warn" />}</span>
            </span>
            {/* always in its place (hidden until recording), so nothing shifts when recording starts */}
            {/* the same as K (on a phone there is no K): a tap a moment after a seam keeps the pass just sung; a pass is let go from the row below */}
            <button className={`vc-star${marks.has(pass) ? " on" : ""}`} style={phase === "recording" ? undefined : { visibility: "hidden" }} disabled={phase !== "recording" || !pass} aria-pressed={marks.has(pass)} aria-label="Keep this pass (K)" title="Keep this pass ★ (K). In the first moments of a pass, the one just sung" onClick={markNow}>★</button>
            <span className="spacer" />
            <label className="vc-mini">Count-in
              <select value={studio.countIn ?? 1} disabled={running} onChange={(e) => setStudio({ countIn: Number(e.target.value) as 0 | 1 | 2 })}>
                <option value={0}>None</option><option value={1}>1 bar</option><option value={2}>2 bars</option>
              </select>
            </label>
            <label className="toggle vc-mini"><input type="checkbox" checked={!!studio.clickOn} onChange={(e) => setStudio({ clickOn: e.target.checked })} /> Click</label>
          </div>

          {tools}
          {lane}
          {phase === "recording" && (
            // every pass sung so far, and the one being sung: tap to keep ★. One row that scrolls, never grows.
            <div className="vc-passes" ref={rowRef} role="group" aria-label="Passes: tap to keep" onScroll={(e) => { const el = e.currentTarget; atEnd.current = el.scrollWidth - el.scrollLeft - el.clientWidth < 60; }}>
              {Array.from({ length: pass }, (_, i) => i + 1).map((n) => (
                <button key={n} className={`vc-pass${marks.has(n) ? " on" : ""}${n === pass ? " sing" : ""}${flash === n ? " just" : ""}`} aria-pressed={marks.has(n)} aria-label={`Pass ${n}${n === pass ? ", being sung" : ""}`} onClick={() => mark(n)}>
                  {marks.has(n) ? "★" : ""}{n}
                </button>
              ))}
            </div>
          )}

          {/* the takes, right under the lane: what was just sung is the first thing to hear */}
          {takesBox}

          <div className="vc-grid">
            <div className="vc-box">
              <b className="vc-title">Interface</b>
              {!hosts && <span className="small muted">Looking…</span>}
              {hosts && !devices.length && <span className="small vc-err">No interface found</span>}
              {devices.length > 0 && (
                <select aria-label="Record from" disabled={running} value={chosen ? `${chosen.host}|${chosen.name}` : ""} onChange={(e) => { const [host, ...rest] = e.target.value.split("|"); setStudio({ host, device: rest.join("|") }); }}>
                  {devices.map((d) => <option key={`${d.host}|${d.name}`} value={`${d.host}|${d.name}`}>{d.name} ({d.host})</option>)}
                </select>
              )}
              {opened && <span className="tiny muted">{opened.inputs} in · {opened.outputs} out · {opened.rate / 1000} kHz · <span ref={dropRef} title="Each dropout is a moment the computer could not keep up: a click or crackle">no dropouts</span></span>}
              <label className="vc-mini" title="How much sound the computer handles at a time. Smaller: you hear yourself sooner. Too small: crackles and dropouts">Buffer
                <select value={studio.buffer ?? ""} disabled={running} onChange={(e) => setStudio({ buffer: e.target.value ? Number(e.target.value) : undefined })}>
                  <option value="">Driver's setting</option>
                  {BUFFERS.filter((b) => (opened?.min_buffer ?? 0) <= b && b <= (opened?.max_buffer ?? 4096)).map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <span ref={blockRef} className="tiny muted" title="Measured from the driver: from your voice reaching the interface to hearing it in your headphones" />
              </label>
              <span ref={slowRef} className="small vc-err" hidden>Dropouts: raise the buffer</span>
              {error && <span className="small vc-err">{error}</span>}
              <div className="vc-meters" ref={barsRef}>
                {Array.from({ length: channels }, (_, c) => (
                  <div key={c} className={`vm${track?.input === c + 1 ? " mine" : ""}`} data-ch={c} data-halo="off">
                    <button className="vm-name" aria-pressed={track?.input === c + 1} disabled={!track || running} title={track ? `Record ${track.name} from Input ${c + 1}` : undefined} onClick={() => setTrack((t) => ({ ...t, input: (c + 1) as 1 | 2 }))}>Input {c + 1}<small>{c === 0 ? "mic" : "inst / line"}</small></button>
                    <span className="vm-bar"><i className="vm-fill" /><i className="vm-hold" /><i className="vm-tick t24" /><i className="vm-tick t6" /></span>
                    <span className="vm-db mono">—</span>
                  </div>
                ))}
              </div>
              <b className="vc-title">Monitor</b>
              <span className="seg" role="radiogroup" aria-label="Hearing yourself">
                <button role="radio" aria-checked={!monitor} className={!monitor ? "on" : ""} onClick={() => setStudio({ monitor: "hardware" })}>Direct</button>
                <button role="radio" aria-checked={monitor} className={monitor ? "on" : ""} onClick={() => setStudio({ monitor: "effects" })}>Effects</button>
              </span>
              {monitor && checks.direct && <span className="small vc-err">Direct Monitor is on too: you hear yourself twice</span>}
              <div className="vc-mix">
                <label className="vc-mini">Song <input type="range" min={0} max={1.5} step={0.05} value={studio.backing ?? 1} onChange={(e) => setStudio({ backing: Number(e.target.value) })} /></label>
                <label className="vc-mini">Click <input type="range" min={0} max={1.5} step={0.05} value={studio.click ?? 0.5} onChange={(e) => setStudio({ click: Number(e.target.value) })} /></label>
              </div>
              <details className="small">
                <summary>On the interface</summary>
                {CHECKS.map((c) => <label key={c.id} className="toggle" title={c.hint}><input type="checkbox" checked={!!checks[c.id]} onChange={(e) => setStudio({ checks: { ...checks, [c.id]: e.target.checked } })} /> {c.label}</label>)}
                <label className="vc-mini" title="Takes are lined up using the delay the driver reports. If they sound early or late, move them here">Timing nudge <input type="number" step={0.5} value={studio.nudge ?? 0} onChange={(e) => setStudio({ nudge: Number(e.target.value) || 0 })} /> ms</label>
              </details>
            </div>

            <div className="vc-box">
              <div className="row"><b className="vc-title">Vocal sound</b><span className="spacer" /><span ref={limRef} className="vc-limit" hidden title="Too loud: the limiter is holding the level back. Turn Level, or the interface's gain, down.">LIMIT</span><span ref={grRef} className="tiny mono muted" title="How much the compressors are turning the voice down" /><label className="toggle vc-mini"><input type="checkbox" checked={fx.on} disabled={!track} onChange={(e) => setFx({ on: e.target.checked })} /> On</label></div>
              <label className="vc-preset">
                <select aria-label="Starting point" disabled={!track} value="" onChange={(e) => { const id = e.target.value; if (id) setTrack((t) => ({ ...t, fx: presetFx(id, bpm) })); }}>
                  <option value="" disabled>Preset…</option>
                  {PRESETS.map((p) => <option key={p.id} value={p.id} title={p.hint}>{p.name}</option>)}
                </select>
              </label>
              {group("color", "Colour", <Pick label="Preamp colour" value={fx.color} options={COLORS} off={!track} onPick={(v) => setFx({ color: v })} />)}
              {group("eq", "EQ", more ? <span className="seg" role="radiogroup" aria-label="Air band" title="Where the air band starts: the higher, the silkier">{AIR_BANDS.map((b) => <button key={b.hz} role="radio" aria-checked={fx.air_freq === b.hz} className={fx.air_freq === b.hz ? "on" : ""} disabled={!track} onClick={() => setFx({ air_freq: b.hz })}>{b.label}</button>)}</span> : null, <EqGraph fx={fx} set={setFx} disabled={!track} />)}
              {group("dyn", "Dynamics", null)}
              {group("width", "Width", <Pick label="Width" value={fx.width} options={WIDTHS} off={!track} onPick={(v) => setFx({ width: v })} />)}
              {group("echo", "Echo", <>
                <Pick label="Echo type" value={fx.echo_type} options={ECHOES} off={!track} onPick={(v) => setFx({ echo_type: v })} />
                <span className="seg" role="radiogroup" aria-label="Echo time">{ECHO_TIMES.map((e) => <button key={e.id} role="radio" aria-checked={Math.abs(echoSeconds(e.id, bpm) - fx.echo_time) < 0.002} className={Math.abs(echoSeconds(e.id, bpm) - fx.echo_time) < 0.002 ? "on" : ""} disabled={!track} onClick={() => setFx({ echo_time: echoSeconds(e.id, bpm) })}>{e.label}</button>)}</span>
              </>)}
              {group("verb", "Reverb", <Pick label="Reverb type" value={fx.verb_type} options={SPACES} off={!track} onPick={(v) => setFx({ verb_type: v })} />)}
              {more && group("out", "Output", null)}
              <div className="row">
                <span className="spacer" />
                <button className="btn sm" onClick={() => setMore(!more)}>{more ? "Less" : "More"}</button>
              </div>
            </div>
          </div>
        </>
      )}

      {!desktop && takesBox}
    </section>
  );
}

/** How long a take is, as m:ss. */
const lengthOf = (t: Take) => {
  const sec = Math.round(t.frames / t.rate);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

/**
 * Every take of every recording on a track, newest recording first, its passes as they were
 * sung, to sift through: hear each alone, ★ the keepers, use one, delete the rest. One is
 * selected: ‹ › or the arrow keys step through them (hearing each in turn while one is being
 * heard), Space hears it or stops, Enter uses it, K ★s it, Delete deletes it.
 */
function TakeBrowser({ track, groups, list, sel, setSel, alone, canHear, playStop, starOnly, setStarOnly, running, stale, busy, shorts, setShorts, applySound, choose, setKeep, drop, removeGroup }: {
  track: Track;
  groups: string[];
  /** the takes listed, in order */
  list: Take[];
  sel: string | null;
  setSel: (id: string | null) => void;
  /** the take being heard alone */
  alone: string | null;
  canHear: boolean;
  playStop: (t: Take) => void;
  starOnly: boolean;
  setStarOnly: (on: boolean) => void;
  running: boolean;
  stale: boolean;
  busy: string | null;
  shorts: boolean;
  setShorts: (on: boolean) => void;
  applySound: () => void;
  choose: (id: string) => void;
  setKeep: (id: string, keep: boolean) => void;
  drop: (t: Take) => void;
  removeGroup: (g: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const at = list.findIndex((t) => t.id === sel);
  const cur = at >= 0 ? list[at] : undefined;
  const step = (d: 1 | -1) => {
    const next = list[at < 0 ? (d > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, at + d))];
    if (!next) return;
    setSel(next.id);
    // stepping while one is heard hears the next
    if (alone && alone !== next.id && canHear) playStop(next);
  };
  // the selected take stays in view
  useEffect(() => {
    if (!sel) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-take="${CSS.escape(sel)}"]`);
    const box = listRef.current;
    if (!el || !box) return;
    // scrolled within the list only (never the page)
    if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight;
  }, [sel]);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || (e.target as HTMLElement).tagName === "SELECT") return;
    const k = e.key;
    let done = true;
    if (k === "ArrowDown" || k === "ArrowRight") step(1);
    else if (k === "ArrowUp" || k === "ArrowLeft") step(-1);
    else if (k === " " && cur && canHear) playStop(cur);
    else if (k === "Enter" && cur && (e.target as HTMLElement) === listRef.current) choose(cur.id);
    else if ((k === "k" || k === "K") && cur) setKeep(cur.id, !cur.keep);
    else if ((k === "Delete" || k === "Backspace") && cur && !running) drop(cur);
    else done = false;
    if (done) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const count = (g: string) => (track.takes ?? []).filter((t) => t.group === g).length;
  /** after a button in the list, the keys go to the list again (Space plays, not presses the button again) */
  const focus = () => listRef.current?.focus({ preventScroll: true });
  return (
    <div className="vc-takes">
      <div className="row tb-head">
        <b className="vc-title">Takes</b>
        <span className="seg" role="radiogroup" aria-label="Which takes">
          <button role="radio" aria-checked={!starOnly} className={!starOnly ? "on" : ""} onClick={() => setStarOnly(false)}>All</button>
          <button role="radio" aria-checked={starOnly} className={starOnly ? "on" : ""} onClick={() => setStarOnly(true)} aria-label="Kept only">★</button>
        </span>
        <span className="tb-step">
          <button className="btn sm" aria-label="Previous take" title="Previous take (←)" disabled={!list.length} onClick={() => step(-1)}>‹</button>
          <button className="btn sm" aria-label="Next take" title="Next take (→)" disabled={!list.length} onClick={() => step(1)}>›</button>
        </span>
        <span className="spacer" />
        {stale && <button className="btn sm" disabled={!!busy || running} onClick={() => void applySound()} title="Takes are recorded dry; this puts the vocal sound above on them">{busy ? "…" : "↻ Apply sound"}</button>}
        {(track.takes ?? []).some((t) => t.short) && <label className="toggle vc-mini"><input type="checkbox" checked={shorts} onChange={(e) => setShorts(e.target.checked)} /> Short takes</label>}
      </div>
      <div className="tb-list" ref={listRef} role="listbox" aria-label="Takes" tabIndex={0} onKeyDown={onKey}>
        {groups.map((g, gi) => {
          const mine = list.filter((t) => t.group === g);
          return (
            <div key={g} className="tb-group" role="group" aria-label={`Recording ${groups.length - gi}`}>
              <div className="tb-rec">
                <b>● {groups.length - gi}</b>
                <span className="tiny muted">{count(g)} take{count(g) === 1 ? "" : "s"}</span>
                <span className="spacer" />
                <button className="btn sm" aria-label="Remove this recording" title="Remove this recording and all its takes" disabled={running} onClick={() => removeGroup(g)}>Remove</button>
              </div>
              {mine.map((t) => {
                const used = inUse(track, t.id);
                return (
                  <div key={t.id} data-take={t.id} role="option" aria-selected={t.id === sel} className={`tb-take${t.id === sel ? " sel" : ""}${used ? " used" : ""}${alone === t.id ? " heard" : ""}`}
                    onClick={() => { setSel(t.id); focus(); }}>
                    {canHear && <button className="icon-btn tb-play" aria-label={alone === t.id ? "Stop" : `Hear take ${t.n} alone`} title={alone === t.id ? "Stop (Space)" : "Hear it alone (Space)"} onClick={(e) => { e.stopPropagation(); setSel(t.id); playStop(t); focus(); }}>{alone === t.id ? "■" : "▶"}</button>}
                    <span className="tb-n">Take {t.n}{t.short ? " ·" : ""}</span>
                    <span className="tb-len tiny muted mono">{lengthOf(t)}</span>
                    <button className={`icon-btn vc-keep${t.keep ? " on" : ""}`} aria-pressed={!!t.keep} aria-label={`Keep take ${t.n} ★`} title="Keep ★ (K)" onClick={(e) => { e.stopPropagation(); setSel(t.id); setKeep(t.id, !t.keep); focus(); }}>★</button>
                    <button className={`btn sm tb-use${used ? " on" : ""}`} aria-pressed={used} aria-label={`Use take ${t.n}`} title="This take plays here (Enter)" onClick={(e) => { e.stopPropagation(); setSel(t.id); choose(t.id); focus(); }}>Use</button>
                    <button className="icon-btn" aria-label={`Delete take ${t.n}`} title="Delete this take (the file stays)" disabled={running} onClick={(e) => { e.stopPropagation(); drop(t); focus(); }}>✕</button>
                  </div>
                );
              })}
              {!mine.length && <div className="tiny muted tb-none">{starOnly ? "No ★ takes" : "—"}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A row of choices (the types of colour, echo, reverb …). */
function Pick<T extends string>({ label, value, options, off, onPick }: { label: string; value: T; options: { id: T; name: string; hint: string }[]; off: boolean; onPick: (v: T) => void }) {
  return (
    <span className="seg vc-pick" role="radiogroup" aria-label={label}>
      {options.map((o) => <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? "on" : ""} title={o.hint} disabled={off} onClick={() => onPick(o.id)}>{o.name}</button>)}
    </span>
  );
}
