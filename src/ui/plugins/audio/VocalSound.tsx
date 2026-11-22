// The sound window of a Vocals or Blank audio track: the plugin window its FX button opens, apart from the record
// window. The vocal sound box: On, a preset to start from, Colour, the EQ as a graph, Dynamics, Width, Echo, Reverb,
// Output, More / Less. While you hear yourself through the effects on this track the knobs are heard at once, the
// LIMIT lamp shows when the level is too high, and the figure beside it how much the compressors turn the voice down.
//
// Takes are recorded dry, and each has a second file with the sound on it, which the song plays. A knob changed
// after recording marks the takes made with the older sound: "Apply sound" lights, and makes their files again.
//
// Like every sound window it has Bypass, "Copy sound" and "Paste sound" in its title bar (see SoundFrame).
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AIR_BANDS, COLORS, ECHOES, ECHO_TIMES, FX_DEFAULT, PRESETS, SPACES, WIDTHS, echoSeconds, presetFx, reviveFx, type VocalFx } from "../../../audio/vocalfx";
import { isStored } from "../../../audio/takestore";
import { fxRender } from "../../../desktop";
import { sameSound, soundTag } from "../../../song/takes";
import { setTrack } from "../../../timeline/edit";
import type { AudioTrack, TimelineSong } from "../../../timeline/model";
import { useApp5, type Ctx5 } from "../../app5";
import { engineStatus, useEngineNow } from "../../audio/useEngine";
import { EqGraph } from "../../components/EqGraph";
import { SoundFrame, type SoundProps } from "../SoundFrame";
import "./audio.css";

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

/** A track's vocal sound, with what a sound saved before colours, spaces and echo types existed is missing filled in. */
export const fxOf = (track: Pick<AudioTrack, "fx">): VocalFx => reviveFx(track.fx) ?? FX_DEFAULT;
/** Were some of a track's takes made with another sound than it has now? ("Apply sound" is offered then.) */
export const staleTakes = (track: Pick<AudioTrack, "takes">, fx: VocalFx): boolean => track.takes.some((k) => canApply(k) && !sameSound(k as unknown as Parameters<typeof sameSound>[0], fx));
/** Can a sound be put on this take at all? Not on one recorded in a browser: it is kept there as it came in, and only the desktop app's engine makes a take's second file. */
const canApply = (k: { dry: string }): boolean => !isStored(k.dry);
/** Is the track recorded from a pair of inputs? (The vocal sound takes one voice: such a track has only its level.) */
export const isStereo = (track: Pick<AudioTrack, "input">): boolean => !!track.input?.pair;

/** Put a track's sound as it is now on its takes made with an older one: their files are made again, and the song plays the new ones. */
export async function applySound(app: () => Ctx5, track: AudioTrack): Promise<void> {
  const sound = fxOf(track);
  const drys = [...new Set(track.takes.filter((k) => canApply(k) && !sameSound(k as unknown as Parameters<typeof sameSound>[0], sound)).map((k) => k.dry))];
  if (!drys.length) return;
  try {
    const made: Record<string, string> = {};
    for (const d of drys) made[d] = await fxRender(d, sound);
    const tag = soundTag(sound);
    const id = track.id;
    // the takes that play are read again (just them) once the song sees their new files
    app().edit("Apply sound", (s) => {
      const mine = s.tracks.find((x) => x.id === id);
      return mine && (mine.kind === "vocals" || mine.kind === "audio") ? setTrack<AudioTrack>(s, id, { takes: mine.takes.map((x) => (made[x.dry] ? { ...x, wet: made[x.dry], sound: tag } : x)) }) : s;
    });
    app().toast("Takes updated");
  } catch (e) {
    app().toast(String(e));
  }
}

export const VocalSound = memo(function VocalSound(p: SoundProps) {
  const { track } = p;
  if (track.kind !== "vocals" && track.kind !== "audio") return null;
  return (
    <SoundFrame p={p}>
      <VocalBox track={track} bpm={p.song.bpm} hidden={p.hidden} />
    </SoundFrame>
  );
});

/** The vocal sound of one track. `hidden`: its window is closed (nothing is read from the engine meanwhile). */
export function VocalBox({ track, bpm, hidden }: { track: AudioTrack; bpm: number; hidden?: boolean }) {
  const app = useApp5();
  const live = useRef({ app, track });
  live.current = { app, track };
  const fx = useMemo(() => fxOf(track), [track.fx]); // eslint-disable-line react-hooks/exhaustive-deps
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const engine = useEngineNow();
  /** a recording or a rehearsal runs */
  const running = engine.phase !== "idle";
  const stale = staleTakes(track, fx);
  const stereo = isStereo(track);
  const id = track.id;

  /** a change of the sound: folded into one undo step while one control is held */
  const setFx = (patch: Partial<VocalFx>) =>
    live.current.app.edit("Vocal sound", (s: TimelineSong) => {
      const t = s.tracks.find((x) => x.id === id);
      return t && (t.kind === "vocals" || t.kind === "audio") ? setTrack<AudioTrack>(s, id, { fx: { ...fxOf(t), ...patch } }) : s;
    }, `fx:${id}`);
  const apply = async () => {
    setBusy(true);
    try {
      await applySound(() => live.current.app, live.current.track);
    } finally {
      setBusy(false);
    }
  };

  // the LIMIT lamp and how much the compressors turn the voice down: live while the engine has this track's sound
  const limRef = useRef<HTMLSpanElement>(null);
  const grRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (hidden) return;
    return engineStatus.subscribe((r) => {
      const st = r.now.track === id ? r.st : null;
      if (limRef.current) limRef.current.hidden = !((st?.limit ?? 0) > 0.5);
      const gr = st && st.reduction > 0.5 ? `−${st.reduction.toFixed(1)} dB` : "";
      if (grRef.current && grRef.current.textContent !== gr) grRef.current.textContent = gr;
    });
  }, [id, hidden]);

  /** One part of the vocal sound: its name, its choice of type, its knobs. */
  const group = (g: Group, title: string, picker: ReactNode, body?: ReactNode) => (
    <div className="vc-group-box" role="group" aria-label={title}>
      <div className="vc-group-head"><b className="vc-title">{title}</b>{picker}</div>
      {body}
      <div className="vc-knobs">
        {KNOBS.filter((k) => k.g === g && (more || !k.more || stereo)).map((k) => (
          <label key={k.k} className="vc-knob" title={k.hint}>
            <span>{k.label}<small className="mono">{(fx[k.k] as number).toFixed(k.step < 0.1 ? 2 : k.step < 1 ? 1 : 0).replace(/\.0+$|(\.\d*?)0+$/, "$1") || "0"}{k.unit ? ` ${k.unit}` : ""}</small></span>
            <input type="range" min={k.min} max={k.max} step={k.step} value={fx[k.k] as number} aria-label={`${title}: ${k.label}`} onChange={(e) => setFx({ [k.k]: Number(e.target.value) } as Partial<VocalFx>)} />
          </label>
        ))}
      </div>
    </div>
  );
  const applyBtn = stale && (
    <button className="btn sm vs-apply" disabled={busy || running} onClick={() => void apply()} title="Takes are recorded dry; this puts the vocal sound as it is now on the takes made with an older one">{busy ? "…" : "↻ Apply sound"}</button>
  );

  if (stereo) {
    // a pair of inputs: the vocal sound takes one voice, so it is off, and only the level is set
    return (
      <section className="vs vc-box" aria-label={`Sound of ${track.name}`}>
        <div className="row"><b className="vc-title">Sound</b><span className="spacer" />{applyBtn}</div>
        <p className="small muted">A track recorded from two inputs is heard as it was recorded. Only its level is set here.</p>
        {group("out", "Output", null)}
      </section>
    );
  }
  return (
    <section className="vs vc-box" aria-label={`Sound of ${track.name}`}>
      <div className="row">
        <b className="vc-title">Vocal sound</b>
        <span className="spacer" />
        <span ref={limRef} className="vc-limit" hidden title="Too loud: the limiter is holding the level back. Turn Level, or the interface's gain, down.">LIMIT</span>
        <span ref={grRef} className="tiny mono muted" title="How much the compressors are turning the voice down" />
        {applyBtn}
        <label className="toggle vc-mini"><input type="checkbox" checked={fx.on} onChange={(e) => setFx({ on: e.target.checked })} /> On</label>
      </div>
      <label className="vc-preset">
        <select aria-label="Starting point" value="" onChange={(e) => { const p = e.target.value; if (p) setFx(presetFx(p, bpm)); }}>
          <option value="" disabled>Preset…</option>
          {PRESETS.map((p) => <option key={p.id} value={p.id} title={p.hint}>{p.name}</option>)}
        </select>
      </label>
      {group("color", "Colour", <Pick label="Preamp colour" value={fx.color} options={COLORS} onPick={(v) => setFx({ color: v })} />)}
      {group("eq", "EQ", more ? <span className="seg" role="radiogroup" aria-label="Air band" title="Where the air band starts: the higher, the silkier">{AIR_BANDS.map((b) => <button key={b.hz} role="radio" aria-checked={fx.air_freq === b.hz} className={fx.air_freq === b.hz ? "on" : ""} onClick={() => setFx({ air_freq: b.hz })}>{b.label}</button>)}</span> : null, <EqGraph fx={fx} set={setFx} />)}
      {group("dyn", "Dynamics", null)}
      {group("width", "Width", <Pick label="Width" value={fx.width} options={WIDTHS} onPick={(v) => setFx({ width: v })} />)}
      {group("echo", "Echo", <>
        <Pick label="Echo type" value={fx.echo_type} options={ECHOES} onPick={(v) => setFx({ echo_type: v })} />
        <span className="seg" role="radiogroup" aria-label="Echo time">{ECHO_TIMES.map((e) => <button key={e.id} role="radio" aria-checked={Math.abs(echoSeconds(e.id, bpm) - fx.echo_time) < 0.002} className={Math.abs(echoSeconds(e.id, bpm) - fx.echo_time) < 0.002 ? "on" : ""} onClick={() => setFx({ echo_time: echoSeconds(e.id, bpm) })}>{e.label}</button>)}</span>
      </>)}
      {group("verb", "Reverb", <Pick label="Reverb type" value={fx.verb_type} options={SPACES} onPick={(v) => setFx({ verb_type: v })} />)}
      {more && group("out", "Output", null)}
      <div className="row">
        <span className="spacer" />
        <button className="btn sm" onClick={() => setMore(!more)}>{more ? "Less" : "More"}</button>
      </div>
    </section>
  );
}

/** A row of choices (the types of colour, echo, reverb …). */
function Pick<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { id: T; name: string; hint: string }[]; onPick: (v: T) => void }) {
  return (
    <span className="seg vc-pick" role="radiogroup" aria-label={label}>
      {options.map((o) => <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? "on" : ""} title={o.hint} onClick={() => onPick(o.id)}>{o.name}</button>)}
    </span>
  );
}
