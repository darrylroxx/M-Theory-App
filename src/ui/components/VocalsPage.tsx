import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Beat } from "../../audio/beats";
import { dbOf, haloOf, meterPos } from "../../audio/levels";
import type { PatternId, PlayItem } from "../../audio/patterns";
import { renderSong } from "../../audio/synth";
import { loadTake } from "../../audio/takebuffers";
import { audioContext } from "../../audio/context";
import { fader } from "../../audio/mix";
import { AIR_BANDS, COLORS, ECHOES, ECHO_TIMES, FX_DEFAULT, PRESETS, SPACES, WIDTHS, echoSeconds, presetFx, reviveFx, type VocalFx } from "../../audio/vocalfx";
import { audioDevices, engineBacking, engineClose, engineOpen, engineSet, engineStart, engineStop, fxRender, isDesktop, type AudioHost, type EngineOpened, type EngineStatus } from "../../desktop";
import { activeTake, clickPlan, cutTakes, groupsOf, passAt, passToMark, sameSound, shownTakes, soundTag, toggled, type Recorded, type Take } from "../../song/takes";
import { TakeLane, type LaneBar } from "./TakeLane";
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
export function VocalsPage({ active, recordPlan, onRecording, recording, playing, getWhere }: {
  active: boolean;
  recordPlan: () => RecordPlan | null;
  onRecording: (on: boolean) => void;
  recording: boolean;
  /** the song is playing in the app (not through the interface) */
  playing: boolean;
  /** which section is sounding and how far into it, while the song plays in the app */
  getWhere: () => { block: string; beat: number } | null;
}) {
  const { state, set, toast } = useApp();
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

  const [hosts, setHosts] = useState<AudioHost[] | null>(null);
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
  /** recordings whose takes are all listed ("+N" was opened) */
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const setTrack = (patch: (t: Track) => Track) => track && set((s) => ({ ...s, progression: { ...s.progression, tracks: (s.progression.tracks ?? []).map((t) => (t.id === track.id ? patch(t) : t)) } }));
  const setFx = (patch: Partial<VocalFx>) => setTrack((t) => ({ ...t, fx: { ...(t.fx ?? FX_DEFAULT), ...patch } }));

  // the list of interfaces: once, and again only after a problem (never while the interface is
  // being opened, which can upset a driver)
  useEffect(() => {
    if (!desktop || !active || (hosts && !error)) return;
    void audioDevices().then(setHosts);
  }, [desktop, active, !!error]); // eslint-disable-line react-hooks/exhaustive-deps
  const devices = (hosts ?? []).flatMap((h) => h.devices.filter((d) => (d.input?.channels ?? 0) > 0 && (d.output?.channels ?? 0) > 0).map((d) => ({ host: h.name, name: d.name, channels: d.input!.channels })))
    .sort((a, b) => Number(b.host.toUpperCase() === "ASIO") - Number(a.host.toUpperCase() === "ASIO") || Number(/focusrite|scarlett/i.test(b.name)) - Number(/focusrite|scarlett/i.test(a.name)));
  const chosen = devices.find((d) => d.host === studio.host && d.name === studio.device) ?? devices[0];

  // the interface is open while this page is on screen, while recording, and whenever you hear
  // yourself through the effects: then it stays open on every page
  const monitor = (studio.monitor ?? "hardware") === "effects";
  const keepOpen = active || recording || monitor;
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
    }).then((o) => { if (live) { rate.current = o.rate; setOpened(o); } }).catch((e) => live && (setOpened(null), setError(String(e))));
    // closing: a recording still going (the driver was reset mid-session) comes back, and its takes are kept
    return () => { live = false; void engineClose().then((r) => r && salvageRef.current(r)); setOpened(null); };
  }, [desktop, keepOpen, chosen?.host, chosen?.name, reopen, studio.buffer]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!opened) return toast("The interface is not open");
    const plan = recordPlan();
    if (!plan || plan.beats <= 0) return toast("Nothing to sing over: set a loop or pick a section");
    const t = record ? ensureTrack() : track;
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
    onRecording(true);
    setPhase("preparing");
    try {
      const [l, r] = await renderSong(plan.items, { bpm: plan.bpm, pattern: plan.pattern, beat: plan.beat, rate: opened.rate, skip: record ? t?.id : undefined });
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
    set((s) => ({ ...s, progression: { ...s.progression, tracks: (s.progression.tracks ?? []).map((x) => (x.id === c.track.id ? { ...x, takes: [...(x.takes ?? []), ...takes] } : x)) } }));
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

  // ── takes ──
  const groups = groupsOf(track?.takes).reverse();
  const choose = (g: string, id: string) => setTrack((t) => ({ ...t, active: { ...t.active, [g]: id } }));
  /** ★ a take afterwards (or take the ★ off) */
  const setKeep = (id: string, keep: boolean) => setTrack((t) => ({ ...t, takes: (t.takes ?? []).map((x) => (x.id !== id ? x : keep ? { ...x, keep: true } : (({ keep: _, ...rest }) => rest)(x))) }));
  const removeGroup = (g: string) => {
    if (!window.confirm("Remove this recording and all its takes? (The files stay in Music › M-Theory › Recordings.)")) return;
    setTrack((t) => ({ ...t, takes: (t.takes ?? []).filter((x) => x.group !== g), active: Object.fromEntries(Object.entries(t.active ?? {}).filter(([k]) => k !== g)) }));
  };
  const listen = useRef<AudioBufferSourceNode | null>(null);
  const preview = async (tk: Take) => {
    listen.current?.stop();
    // just this take is read from the recording, so it plays from its own start
    const buf = await loadTake(tk);
    if (!buf) return toast("Could not read the recording");
    const c = audioContext();
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(fader(track?.id ?? "vocals", c));
    src.start(c.currentTime + 0.02, 0, tk.frames / tk.rate);
    listen.current = src;
  };
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
  const laneTakes = groups.map((g, gi) => ({ g, gi, tk: activeTake(track?.takes ?? [], g, track?.active?.[g]) }))
    .filter((x): x is { g: string; gi: number; tk: Take } => !!x.tk)
    .map(({ gi, tk }) => ({ take: tk, label: `● ${groups.length - gi} · ${tk.keep ? "★" : ""}${tk.n}` }));
  /** How far across the lane the music is: from the engine while singing over the loop, from the app's player while the song plays. */
  const where = useCallback((): number | null => {
    const s = status.current;
    if (s) {
      // between the engine's reports, the music has moved on at its rate
      const pos = s.pos + Math.min(0.1, (performance.now() - s.at) / 1000) * rate.current;
      const at = passAt(pos, s.count_in, s.length);
      return at ? at.frac : null;
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

  const lane = laneBars.length > 0 ? (
    <TakeLane bars={laneBars} takes={laneTakes} bpm={bpm} where={where} shown={shown} follow={follow}
      live={active && (playing || phase === "recording" || phase === "rehearsing")} onPick={desktop ? (t) => void preview(t) : undefined} />
  ) : null;

  const takesBox = track && groups.length > 0 ? (
    <TakeList track={track} groups={groups} running={running} stale={stale} busy={busy} shorts={shorts} setShorts={setShorts} open={open} setOpen={setOpen}
      applySound={() => void applySound()} choose={choose} setKeep={setKeep} preview={(t) => void preview(t)} removeGroup={removeGroup} />
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
      {!desktop && lane}

      {desktop && (
        <>
          <div className="vc-rec">
            <button className={`rec-btn${phase === "recording" ? " on" : ""}`} aria-label={phase === "recording" ? "Stop recording" : "Record"} title={phase === "recording" ? "Stop" : "Record take after take over the loop, after a count-in"} disabled={!opened || phase === "preparing" || phase === "saving" || phase === "rehearsing"} onClick={() => (phase === "recording" ? void stop() : void go(true))}>{phase === "recording" ? "■" : "●"}</button>
            <button className="btn sm" disabled={!opened || phase === "preparing" || phase === "saving" || phase === "recording"} onClick={() => (phase === "rehearsing" ? void stop() : void go(false))} title="Sing along over the loop without recording" aria-label={phase === "rehearsing" ? "Stop" : "Rehearse: sing over the loop without recording"}>{phase === "rehearsing" ? "■" : <><EarIcon /> ▶</>}</button>
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

/** The recordings on a track and their takes (one per pass), each recording on a line. */
function TakeList({ track, groups, running, stale, busy, shorts, setShorts, open, setOpen, applySound, choose, setKeep, preview, removeGroup }: {
  track: Track;
  groups: string[];
  running: boolean;
  stale: boolean;
  busy: string | null;
  shorts: boolean;
  setShorts: (on: boolean) => void;
  open: Set<string>;
  setOpen: (fn: (o: Set<string>) => Set<string>) => void;
  applySound: () => void;
  choose: (g: string, id: string) => void;
  setKeep: (id: string, keep: boolean) => void;
  preview: (t: Take) => void;
  removeGroup: (g: string) => void;
}) {
  return (
    <div className="vc-takes">
      <div className="row">
        <b className="vc-title">Takes</b>
        <span className="spacer" />
        {stale && <button className="btn sm" disabled={!!busy || running} onClick={() => void applySound()} title="Takes are recorded dry; this puts the vocal sound above on them">{busy ? "…" : "↻ Apply sound"}</button>}
        {(track.takes ?? []).some((t) => t.short) && <label className="toggle vc-mini"><input type="checkbox" checked={shorts} onChange={(e) => setShorts(e.target.checked)} /> Short takes</label>}
      </div>
      {groups.map((g, gi) => {
        const on = activeTake(track.takes ?? [], g, track.active?.[g]);
        // a long session leaves many passes: the keepers, the one playing and the newest show; "+N" for the rest
        const all = open.has(g);
        const { shown, more } = shownTakes(track.takes ?? [], g, { active: on?.id, shorts, all });
        return (
          <div key={g} className="vc-group">
            <span className="small"><b>● {groups.length - gi}</b></span>
            <span className="seg vc-takelist" role="radiogroup" aria-label="Which take plays">
              {shown.map((t) => <button key={t.id} role="radio" aria-checked={on?.id === t.id} aria-label={`Take ${t.n}${t.keep ? ", kept" : ""}${t.short ? ", short" : ""}`} className={`${on?.id === t.id ? "on" : ""}${t.keep ? " keep" : ""}`} title="Play this take with the song; double-click to hear it alone" onClick={() => choose(g, t.id)} onDoubleClick={() => preview(t)}>{t.keep ? "★" : ""}{t.n}{t.short ? "·" : ""}</button>)}
              {(more > 0 || all) && <button className="vc-more" aria-label={all ? "Show fewer takes" : `Show ${more} more takes`} onClick={() => setOpen((o) => { const n = new Set(o); if (all) n.delete(g); else n.add(g); return n; })}>{all ? "−" : `+${more}`}</button>}
            </span>
            {/* kept together, so on a phone they never break apart onto lines of their own */}
            <span className="vc-group-acts">
              <button className={`icon-btn vc-keep${on?.keep ? " on" : ""}`} aria-pressed={!!on?.keep} aria-label="Keep the chosen take ★" title="Keep ★" disabled={!on} onClick={() => on && setKeep(on.id, !on.keep)}>★</button>
              <button className="icon-btn" aria-label="Hear the chosen take alone" title="Hear the chosen take alone" onClick={() => on && preview(on)}>▶</button>
              <button className="icon-btn" aria-label="Remove this recording" title="Remove this recording" disabled={running} onClick={() => removeGroup(g)}>✕</button>
            </span>
          </div>
        );
      })}
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
