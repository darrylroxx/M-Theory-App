import { useEffect, useMemo, useRef, useState } from "react";
import type { Beat } from "../../audio/beats";
import { dbOf, haloOf, meterPos } from "../../audio/levels";
import type { PatternId, PlayItem } from "../../audio/patterns";
import { renderSong } from "../../audio/synth";
import { loadTake } from "../../audio/takebuffers";
import { audioContext } from "../../audio/context";
import { fader } from "../../audio/mix";
import { AIR_BANDS, COLORS, ECHOES, ECHO_TIMES, FX_DEFAULT, PRESETS, SPACES, WIDTHS, echoSeconds, presetFx, reviveFx, type VocalFx } from "../../audio/vocalfx";
import { audioDevices, engineBacking, engineClose, engineOpen, engineSet, engineStart, engineStop, fxRender, isDesktop, type AudioHost, type EngineOpened, type EngineStatus } from "../../desktop";
import { activeTake, cutTakes, groupsOf, type Take } from "../../song/takes";
import { addTrack, renameTrack, tracksOf, type Track } from "../../song/tracks";
import { newId, useApp, type Studio } from "../state";
import { setLive } from "../live";
import { EqGraph } from "./EqGraph";
import { EarIcon } from "../icons";
import { sigName } from "../../song/meter";
import { sigOf } from "../../song/unity";

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

/**
 * Vocals: the vocal tracks, the interface, the live vocal sound, and recording take after take
 * over a loop. Everything that touches the interface runs in the Windows app.
 */
export function VocalsPage({ active, recordPlan, onRecording, recording }: { active: boolean; recordPlan: () => RecordPlan | null; onRecording: (on: boolean) => void; recording: boolean }) {
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

  const [hosts, setHosts] = useState<AudioHost[] | null>(null);
  const [opened, setOpened] = useState<EngineOpened | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "preparing" | "rehearsing" | "recording" | "saving">("idle");
  const [more, setMore] = useState(false);
  const [shorts, setShorts] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const grRef = useRef<HTMLSpanElement>(null);
  const dropRef = useRef<HTMLSpanElement>(null);
  const slowRef = useRef<HTMLSpanElement>(null);
  const drops = useRef({ n: 0, at: 0 });
  const blockRef = useRef<HTMLSpanElement>(null);
  const hold = useRef<number[]>([]);
  const planRef = useRef<RecordPlan | null>(null);
  const trackRef = useRef<Track | null>(null);

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
      // dropouts: the computer could not keep up at this buffer size
      if (st.xruns !== drops.current.n) drops.current = { n: st.xruns, at: performance.now() };
      if (blockRef.current && st.block) blockRef.current.textContent = st.latency > 0 ? `${st.latency.toFixed(1)} ms` : `~${roundTrip(st.block, opened?.rate ?? 48000)} ms`;
      if (dropRef.current) dropRef.current.textContent = st.xruns ? `${st.xruns} dropout${st.xruns === 1 ? "" : "s"}` : "no dropouts";
      if (slowRef.current) slowRef.current.hidden = !(st.xruns && performance.now() - drops.current.at < 6000);
      if (countRef.current) {
        const p = planRef.current;
        if (!st.running || !p) countRef.current.textContent = "";
        else if (st.pos < st.count_in) {
          const beatLen = st.count_in / Math.max(1, (studio.countIn ?? 1) * p.beatsPerBar);
          countRef.current.textContent = `${Math.ceil((st.count_in - st.pos) / beatLen)}`;
        } else countRef.current.textContent = `Take ${Math.floor((st.pos - st.count_in) / Math.max(1, st.length)) + 1}`;
      }
    }).then((o) => live && setOpened(o)).catch((e) => live && (setOpened(null), setError(String(e))));
    return () => { live = false; void engineClose(); setOpened(null); };
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
    onRecording(true);
    setPhase("preparing");
    try {
      const [l, r] = await renderSong(plan.items, { bpm: plan.bpm, pattern: plan.pattern, beat: plan.beat, rate: opened.rate, skip: record ? t?.id : undefined });
      await engineBacking(l, r);
      await engineStart({ bpm: plan.bpm, countInBeats: (studio.countIn ?? 1) * plan.beatsPerBar, beatsPerBar: plan.beatsPerBar, record, name: t?.name ?? "Vocal" });
      setPhase(record ? "recording" : "rehearsing");
    } catch (e) {
      setPhase("idle");
      onRecording(false);
      toast(String(e));
    }
  };

  const stop = async () => {
    const wasRecording = phase === "recording";
    setPhase("saving");
    try {
      const r = await engineStop(fx);
      const plan = planRef.current;
      const t = trackRef.current;
      if (wasRecording && r && plan && t) {
        const group = newId();
        const nudge = Math.round(((studio.nudge ?? 0) / 1000) * r.rate);
        const takes = cutTakes(r, { group, at: plan.at, nudge, id: newId }).map((x) => ({ ...x, sound: sig(fx), bpm: plan.bpm, key: `${state.key.tonic}|${state.key.scaleId}`, sig: sigName(sigOf(state.progression)) }));
        if (!takes.length) toast("Stopped before the first take");
        else {
          set((s) => ({ ...s, progression: { ...s.progression, tracks: (s.progression.tracks ?? []).map((x) => (x.id === t.id ? { ...x, takes: [...(x.takes ?? []), ...takes] } : x)) } }));
          const full = takes.filter((x) => !x.short).length;
          toast(`${full || takes.length} take${(full || takes.length) === 1 ? "" : "s"} recorded${r.dropped ? " (some audio was lost: try a bigger buffer)" : ""}`);
          void loadTake(r.wet);
        }
      }
    } catch (e) {
      toast(String(e));
    } finally {
      setPhase("idle");
      onRecording(false);
    }
  };

  // ── takes ──
  const groups = groupsOf(track?.takes).reverse();
  const choose = (g: string, id: string) => setTrack((t) => ({ ...t, active: { ...t.active, [g]: id } }));
  const removeGroup = (g: string) => {
    if (!window.confirm("Remove this recording and all its takes? (The files stay in Music › M-Theory › Recordings.)")) return;
    setTrack((t) => ({ ...t, takes: (t.takes ?? []).filter((x) => x.group !== g), active: Object.fromEntries(Object.entries(t.active ?? {}).filter(([k]) => k !== g)) }));
  };
  const listen = useRef<AudioBufferSourceNode | null>(null);
  const preview = async (tk: Take) => {
    listen.current?.stop();
    const buf = await loadTake(tk.wet);
    if (!buf) return toast("Could not read the recording");
    const c = audioContext();
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(fader(track?.id ?? "vocals", c));
    src.start(c.currentTime + 0.02, tk.start / tk.rate, tk.frames / tk.rate);
    listen.current = src;
  };
  const stale = (track?.takes ?? []).some((t) => t.sound !== sig(fx));
  const applySound = async () => {
    if (!track?.takes?.length) return;
    setBusy("…");
    try {
      const drys = [...new Set(track.takes.filter((t) => t.sound !== sig(fx)).map((t) => t.dry))];
      const made: Record<string, string> = {};
      for (const d of drys) made[d] = await fxRender(d, fx);
      await Promise.all(Object.values(made).map((p) => loadTake(p)));
      setTrack((t) => ({ ...t, takes: (t.takes ?? []).map((x) => (made[x.dry] ? { ...x, wet: made[x.dry], sound: sig(fx) } : x)) }));
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

  return (
    <section className="card vocals" aria-label="Vocals">
      <div className="dm-head">
        <span className="seg clip-tracks" role="radiogroup" aria-label="Vocal track">
          {vocals.map((t) => <button key={t.id} role="radio" aria-checked={track?.id === t.id} className={track?.id === t.id ? "on" : ""} disabled={running} onClick={() => setSel(t.id)} onDoubleClick={rename}>{t.name}</button>)}
          <button className="clip-add" aria-label="Add a vocal track" title="Add a vocal track" onClick={add} disabled={running}>+</button>
        </span>
      </div>

      {!desktop && <p className="small vc-note">Recording: in the Windows app.</p>}

      {desktop && (
        <>
          <div className="vc-rec">
            <button className={`rec-btn${phase === "recording" ? " on" : ""}`} aria-label={phase === "recording" ? "Stop recording" : "Record"} title={phase === "recording" ? "Stop" : "Record take after take over the loop, after a count-in"} disabled={!opened || phase === "preparing" || phase === "saving" || phase === "rehearsing"} onClick={() => (phase === "recording" ? void stop() : void go(true))}>{phase === "recording" ? "■" : "●"}</button>
            <button className="btn sm" disabled={!opened || phase === "preparing" || phase === "saving" || phase === "recording"} onClick={() => (phase === "rehearsing" ? void stop() : void go(false))} title="Sing along over the loop without recording" aria-label={phase === "rehearsing" ? "Stop" : "Rehearse: sing over the loop without recording"}>{phase === "rehearsing" ? "■" : <><EarIcon /> ▶</>}</button>
            <span className="vc-state">
              <b ref={countRef} className="vc-count" />
              <span className="small muted">{phase === "preparing" || phase === "saving" ? "…" : phase === "idle" ? `↻ ${plan?.label ?? "—"}` : ""}</span>
            </span>
            <span className="spacer" />
            <label className="vc-mini">Count-in
              <select value={studio.countIn ?? 1} disabled={running} onChange={(e) => setStudio({ countIn: Number(e.target.value) as 0 | 1 | 2 })}>
                <option value={0}>None</option><option value={1}>1 bar</option><option value={2}>2 bars</option>
              </select>
            </label>
            <label className="toggle vc-mini"><input type="checkbox" checked={!!studio.clickOn} onChange={(e) => setStudio({ clickOn: e.target.checked })} /> Click</label>
          </div>

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
              <div className="row"><b className="vc-title">Vocal sound</b><span className="spacer" /><span ref={grRef} className="tiny mono muted" title="How much the compressors are turning the voice down" /><label className="toggle vc-mini"><input type="checkbox" checked={fx.on} disabled={!track} onChange={(e) => setFx({ on: e.target.checked })} /> On</label></div>
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

      {track && groups.length > 0 && (
        <div className="vc-takes">
          <div className="row">
            <b className="vc-title">Takes</b>
            <span className="spacer" />
            {stale && <button className="btn sm" disabled={!!busy} onClick={() => void applySound()} title="Takes are recorded dry; this puts the vocal sound above on them">{busy ? "…" : "↻ Apply sound"}</button>}
            {(track.takes ?? []).some((t) => t.short) && <label className="toggle vc-mini"><input type="checkbox" checked={shorts} onChange={(e) => setShorts(e.target.checked)} /> Short takes</label>}
          </div>
          {groups.map((g, gi) => {
            const takes = (track.takes ?? []).filter((t) => t.group === g && (shorts || !t.short));
            const on = activeTake(track.takes ?? [], g, track.active?.[g]);
            return (
              <div key={g} className="vc-group">
                <span className="small"><b>● {groups.length - gi}</b></span>
                <span className="seg" role="radiogroup" aria-label="Which take plays">
                  {takes.map((t) => <button key={t.id} role="radio" aria-checked={on?.id === t.id} className={on?.id === t.id ? "on" : ""} title="Play this take with the song; double-click to hear it alone" onClick={() => choose(g, t.id)} onDoubleClick={() => void preview(t)}>Take {t.n}{t.short ? "·" : ""}</button>)}
                </span>
                <button className="icon-btn" aria-label="Hear the chosen take alone" title="Hear the chosen take alone" onClick={() => on && void preview(on)}>▶</button>
                <button className="icon-btn" aria-label="Remove this recording" title="Remove this recording" onClick={() => removeGroup(g)}>✕</button>
              </div>
            );
          })}
        </div>
      )}
    </section>
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
