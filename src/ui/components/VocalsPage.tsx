import { useEffect, useRef, useState } from "react";
import type { Beat } from "../../audio/beats";
import { dbOf, haloOf, meterPos } from "../../audio/levels";
import type { PatternId, PlayItem } from "../../audio/patterns";
import { renderSong } from "../../audio/synth";
import { loadTake } from "../../audio/takebuffers";
import { audioContext } from "../../audio/context";
import { fader } from "../../audio/mix";
import { ECHO_TIMES, FX_DEFAULT, PRESETS, echoSeconds, presetFx, type VocalFx } from "../../audio/vocalfx";
import { audioDevices, engineBacking, engineClose, engineOpen, engineSet, engineStart, engineStop, fxRender, isDesktop, type AudioHost, type EngineOpened, type EngineStatus } from "../../desktop";
import { activeTake, cutTakes, groupsOf, type Take } from "../../song/takes";
import { addTrack, renameTrack, tracksOf, type Track } from "../../song/tracks";
import { newId, useApp, type Studio } from "../state";

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
const KNOBS: { k: keyof VocalFx; label: string; min: number; max: number; step: number; unit?: string; more?: boolean; hint: string }[] = [
  { k: "warmth", label: "Warmth", min: 0, max: 1, step: 0.01, hint: "Preamp colour: thicker, rounder, a touch of drive" },
  { k: "punch", label: "Punch", min: 0, max: 1, step: 0.01, hint: "Fast compression: catches the peaks and brings the voice forward" },
  { k: "smooth", label: "Smooth", min: 0, max: 1, step: 0.01, hint: "Slow compression: evens loud and soft phrases out" },
  { k: "deess", label: "De-ess", min: 0, max: 1, step: 0.01, hint: "Tames sharp s and t sounds" },
  { k: "presence", label: "Presence", min: -6, max: 6, step: 0.5, unit: "dB", hint: "Clarity around 4 kHz" },
  { k: "air", label: "Air", min: -6, max: 6, step: 0.5, unit: "dB", hint: "Breath and sparkle above 11 kHz" },
  { k: "echo", label: "Echo", min: 0, max: 1, step: 0.01, hint: "How much echo (it dips while you sing)" },
  { k: "verb", label: "Reverb", min: 0, max: 1, step: 0.01, hint: "How much plate reverb (it dips while you sing)" },
  { k: "lowcut", label: "Low cut", min: 20, max: 300, step: 5, unit: "Hz", more: true, hint: "Removes rumble and pops below this" },
  { k: "gate", label: "Gate", min: 0, max: 1, step: 0.01, more: true, hint: "Turns the quietest moments between phrases down" },
  { k: "mud", label: "Mud cut", min: 0, max: 1, step: 0.01, more: true, hint: "Takes out the boxy 300 Hz area" },
  { k: "double", label: "Double", min: 0, max: 1, step: 0.01, more: true, hint: "Two faint copies left and right: wider and thicker" },
  { k: "echo_feedback", label: "Repeats", min: 0, max: 0.85, step: 0.01, more: true, hint: "How many times the echo comes back" },
  { k: "verb_size", label: "Size", min: 0, max: 1, step: 0.01, more: true, hint: "Reverb length" },
  { k: "verb_tone", label: "Darkness", min: 0, max: 1, step: 0.01, more: true, hint: "Reverb tone: bright to dark" },
  { k: "verb_predelay", label: "Pre-delay", min: 0, max: 0.15, step: 0.005, unit: "s", more: true, hint: "A gap before the reverb, so the words stay clear" },
  { k: "level", label: "Level", min: -12, max: 12, step: 0.5, unit: "dB", more: true, hint: "Output level of the chain" },
];
const sig = (fx: VocalFx) => JSON.stringify(fx);
const BUFFERS = [32, 48, 64, 96, 128, 192, 256, 512];
/** About how long a sound takes to go in and come back out at a buffer size (two blocks, plus the converters). */
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
  const [sel, setSel] = useState<string | null>(null);
  const track = vocals.find((t) => t.id === sel) ?? vocals[0];
  const fx: VocalFx = track?.fx ?? FX_DEFAULT;
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

  useEffect(() => {
    if (!desktop || !active) return;
    void audioDevices().then(setHosts);
  }, [desktop, active]);
  const devices = (hosts ?? []).flatMap((h) => h.devices.filter((d) => (d.input?.channels ?? 0) > 0 && (d.output?.channels ?? 0) > 0).map((d) => ({ host: h.name, name: d.name, channels: d.input!.channels })))
    .sort((a, b) => Number(b.host.toUpperCase() === "ASIO") - Number(a.host.toUpperCase() === "ASIO") || Number(/focusrite|scarlett/i.test(b.name)) - Number(/focusrite|scarlett/i.test(a.name)));
  const chosen = devices.find((d) => d.host === studio.host && d.name === studio.device) ?? devices[0];

  // the interface is open while this page is on screen (and while recording)
  const keepOpen = active || recording;
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
      if (blockRef.current && st.block) blockRef.current.textContent = `${st.block} samples · about ${roundTrip(st.block, opened?.rate ?? 48000)} ms round trip`;
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

  // what the singer hears follows the page at once
  const monitor = (studio.monitor ?? "hardware") === "effects";
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
        const takes = cutTakes(r, { group, at: plan.at, nudge, id: newId }).map((x) => ({ ...x, sound: sig(fx) }));
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
    setBusy("Putting the new sound on the takes…");
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
  const channels = Math.min(2, opened?.inputs ?? chosen?.channels ?? 2);
  const checks = studio.checks ?? {};
  const running = phase !== "idle";
  const plan = recordPlan();

  return (
    <section className="card vocals" aria-label="Vocals">
      <div className="dm-head">
        <h2>Vocals</h2>
        {vocals.length > 0 && (
          <span className="seg" role="radiogroup" aria-label="Vocal track">
            {vocals.map((t) => <button key={t.id} role="radio" aria-checked={track?.id === t.id} className={track?.id === t.id ? "on" : ""} disabled={running} onClick={() => setSel(t.id)} onDoubleClick={rename}>{t.name}</button>)}
          </span>
        )}
        <span className="spacer" />
        <button className="btn sm" onClick={add} disabled={running}>+ Vocal track</button>
      </div>

      {!desktop && <p className="small vc-note">Recording works in the Windows app (M-Theory for Windows), which talks to the audio interface directly. This version can plan the song around the vocals.</p>}

      {desktop && (
        <>
          <div className="vc-rec">
            <button className={`rec-btn${phase === "recording" ? " on" : ""}`} aria-label={phase === "recording" ? "Stop recording" : "Record"} title={phase === "recording" ? "Stop" : "Record take after take over the loop, after a count-in"} disabled={!opened || phase === "preparing" || phase === "saving" || phase === "rehearsing"} onClick={() => (phase === "recording" ? void stop() : void go(true))}>{phase === "recording" ? "■" : "●"}</button>
            <button className="btn sm" disabled={!opened || phase === "preparing" || phase === "saving" || phase === "recording"} onClick={() => (phase === "rehearsing" ? void stop() : void go(false))} title="Sing along over the loop without recording">{phase === "rehearsing" ? "■ Stop" : "▶ Rehearse"}</button>
            <span className="vc-state">
              <b ref={countRef} className="vc-count" />
              <span className="small muted">{phase === "preparing" ? "Getting the song ready…" : phase === "saving" ? "Saving…" : phase === "idle" ? `Loop: ${plan?.label ?? "—"} · set it with the bar strip above` : "The loop is locked while recording"}</span>
            </span>
            <span className="spacer" />
            <label className="vc-mini">Count-in
              <select value={studio.countIn ?? 1} disabled={running} onChange={(e) => setStudio({ countIn: Number(e.target.value) as 0 | 1 | 2 })}>
                <option value={0}>None</option><option value={1}>1 bar</option><option value={2}>2 bars</option>
              </select>
            </label>
            <label className="toggle vc-mini"><input type="checkbox" checked={!!studio.clickOn} onChange={(e) => setStudio({ clickOn: e.target.checked })} /> Click while recording</label>
          </div>

          <div className="vc-grid">
            <div className="vc-box">
              <b className="vc-title">Interface</b>
              {!hosts && <span className="small muted">Looking…</span>}
              {hosts && !devices.length && <span className="small">No interface found. Plug it in and install the Focusrite USB ASIO driver from focusrite.com.</span>}
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
                <span ref={blockRef} className="tiny muted" />
              </label>
              <span ref={slowRef} className="small vc-err" hidden>Dropouts right now: the computer is not keeping up at this buffer size. Choose a bigger buffer (128 is safe for most computers).</span>
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
              <span className="tiny muted">Sing your loudest and set the interface's gain so the meter stays green and only touches amber. Red is clipping.</span>
              <b className="vc-title">Hearing yourself</b>
              <span className="seg" role="radiogroup" aria-label="Hearing yourself">
                <button role="radio" aria-checked={!monitor} className={!monitor ? "on" : ""} onClick={() => setStudio({ monitor: "hardware" })}>Direct Monitor</button>
                <button role="radio" aria-checked={monitor} className={monitor ? "on" : ""} onClick={() => setStudio({ monitor: "effects" })}>Through my effects</button>
              </span>
              {monitor && checks.direct && <span className="small vc-err">Turn Direct Monitor off on the interface (and untick it below), or you will hear yourself twice.</span>}
              {monitor && !checks.direct && <span className="tiny muted">You hear yourself through the vocal sound below, a few milliseconds late: the buffer size above sets how many (64 is a good start; go up if there are dropouts).</span>}
              {!monitor && <span className="tiny muted">Press Direct Monitor on the interface to hear yourself, dry and with no delay.</span>}
              <div className="vc-mix">
                <label className="vc-mini">Song <input type="range" min={0} max={1.5} step={0.05} value={studio.backing ?? 1} onChange={(e) => setStudio({ backing: Number(e.target.value) })} /></label>
                <label className="vc-mini">Click <input type="range" min={0} max={1.5} step={0.05} value={studio.click ?? 0.5} onChange={(e) => setStudio({ click: Number(e.target.value) })} /></label>
              </div>
              <details className="small">
                <summary>On the interface</summary>
                <span className="tiny muted">No software can read these switches. Tick them as you have them.</span>
                {CHECKS.map((c) => <label key={c.id} className="toggle" title={c.hint}><input type="checkbox" checked={!!checks[c.id]} onChange={(e) => setStudio({ checks: { ...checks, [c.id]: e.target.checked } })} /> {c.label}</label>)}
                <label className="vc-mini" title="Takes are lined up using the delay the driver reports. If they sound early or late, move them here">Timing nudge <input type="number" step={0.5} value={studio.nudge ?? 0} onChange={(e) => setStudio({ nudge: Number(e.target.value) || 0 })} /> ms</label>
              </details>
            </div>

            <div className="vc-box">
              <div className="row"><b className="vc-title">Vocal sound</b><span className="spacer" /><span ref={grRef} className="tiny mono muted" title="How much the compressors are turning the voice down" /><label className="toggle vc-mini"><input type="checkbox" checked={fx.on} disabled={!track} onChange={(e) => setFx({ on: e.target.checked })} /> On</label></div>
              {!track && <span className="tiny muted">Add a vocal track (or press record) to shape its sound.</span>}
              <div className="vc-presets" role="group" aria-label="Starting points">
                {PRESETS.map((p) => <button key={p.id} className="chip" title={p.hint} disabled={!track} onClick={() => setTrack((t) => ({ ...t, fx: presetFx(p.id, bpm) }))}>{p.name}</button>)}
              </div>
              <div className="vc-knobs">
                {KNOBS.filter((k) => more || !k.more).map((k) => (
                  <label key={k.k} className="vc-knob" title={k.hint}>
                    <span>{k.label}<small className="mono">{(fx[k.k] as number).toFixed(k.step < 0.1 ? 2 : 1).replace(/\.?0+$/, "") || "0"}{k.unit ? ` ${k.unit}` : ""}</small></span>
                    <input type="range" min={k.min} max={k.max} step={k.step} disabled={!track} value={fx[k.k] as number} onChange={(e) => setFx({ [k.k]: Number(e.target.value) } as Partial<VocalFx>)} />
                  </label>
                ))}
              </div>
              <div className="row">
                <span className="kb-label">Echo time</span>
                <span className="seg">{ECHO_TIMES.map((e) => <button key={e.id} className={Math.abs(echoSeconds(e.id, bpm) - fx.echo_time) < 0.002 ? "on" : ""} disabled={!track} onClick={() => setFx({ echo_time: echoSeconds(e.id, bpm) })}>{e.label}</button>)}</span>
                <span className="spacer" />
                <button className="btn sm" onClick={() => setMore(!more)}>{more ? "Less" : "More"}</button>
              </div>
            </div>
          </div>
        </>
      )}

      {track && (
        <div className="vc-takes">
          <div className="row">
            <b className="vc-title">Takes · {track.name}</b>
            <span className="spacer" />
            {stale && <button className="btn sm" disabled={!!busy} onClick={() => void applySound()} title="Takes are recorded dry; this puts the vocal sound above on them">{busy ?? "Use this sound on the takes"}</button>}
            {(track.takes ?? []).some((t) => t.short) && <label className="toggle vc-mini"><input type="checkbox" checked={shorts} onChange={(e) => setShorts(e.target.checked)} /> Show cut-off takes</label>}
          </div>
          {!groups.length && <span className="small muted">No takes yet. Press ● : after the count-in, sing; every time the loop comes round is a new take, until you press ■.</span>}
          {groups.map((g, gi) => {
            const takes = (track.takes ?? []).filter((t) => t.group === g && (shorts || !t.short));
            const on = activeTake(track.takes ?? [], g, track.active?.[g]);
            return (
              <div key={g} className="vc-group">
                <span className="small"><b>Recording {groups.length - gi}</b></span>
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
