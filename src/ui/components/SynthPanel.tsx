/**
 * The synth's panel. On top, ready-made sounds by kind (with ‹ › to step and a die for a surprise
 * in the same kind), six big macro knobs and how the notes are played. Underneath, the whole
 * panel of the instrument it is modelled on, section by section (Osc, LFO, Filter, EG, Effect,
 * Voice), with sliders that move as the macros turn, so turning a macro shows what it does.
 *
 * Self-contained: it is handed the sound and gives back a changed one; whoever holds the sound
 * decides where it lives and plays it (see SynthInstrument.set).
 */
import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
import { MACROS, type MacroInfo, applyMacros, macroOffsets, macroChoices, setChoice, setKnob, setMacro } from "../../synth/macros";
import {
  DEFAULT_PARAMS,
  type FxType,
  type LfoDest,
  type LfoShape,
  OSC_INFO,
  OSC_TYPES,
  type OscType,
  type PlayMode,
  type PlaySettings,
  type StrumDir,
  type SynthParams,
  type UnitKey,
  type VoiceMode,
  sameSynth,
  valueText,
} from "../../synth/params";
import { RANGES, SPEEDS, fitMeter, speedName, speedOf, styleOf, stylesFor, withRange, withSpeed, withStyle } from "../../synth/arpstyles";
import { CATEGORIES, type PresetCategory, type SynthPreset, pickPreset, presetById, presetsIn } from "../../synth/presets";
import { Seg } from "./common";

export interface SynthPanelProps {
  params: SynthParams;
  onChange: (params: SynthParams) => void;
  /** play something short to hear the sound (called after a new sound is chosen, and by ▶) */
  onAudition?: () => void;
  /** small: the presets, the macros and the way of playing; the panel opens on request */
  compact?: boolean;
  /** the song is in 6/8, 9/8 or 12/8: an arp's or a pulse's steps are fitted to it */
  compound?: boolean;
}

export function SynthPanel({ params, onChange, onAudition, compact, compound = false }: SynthPanelProps) {
  const preset = presetById(params.preset);
  const [cat, setCat] = useState<PresetCategory>(preset?.category ?? "pad");
  // a sound handed in from outside (another track's, say) brings its own kind with it, so ‹ › and
  // the chips step through that kind and not the one browsed before
  const [seen, setSeen] = useState(params.preset);
  if (params.preset !== seen) {
    setSeen(params.preset);
    if (preset) setCat(preset.category);
  }
  const [list, setList] = useState(!compact);
  const [open, setOpen] = useState(!compact);
  // what is heard: the sound's own knobs pushed by the macros (the panel shows this)
  const shown = applyMacros(params);
  const pushed = macroOffsets(params.macros, params.osc, macroChoices(params).fx);
  const pool = presetsIn(cat);
  const at = pool.findIndex((x) => x.id === params.preset);
  // (the way of playing is not the sound: a pad played as an arp is still that pad)
  const edited = preset ? !sameSynth({ ...preset.params, volume: params.volume, play: params.play }, params) : false;

  const choose = (x: SynthPreset) => {
    setCat(x.category);
    const next = pickPreset(params, x);
    onChange({ ...next, play: fitMeter(next.play, compound) });
    onAudition?.();
  };
  const step = (dir: -1 | 1) => choose(pool[(Math.max(at, dir > 0 ? -1 : 0) + dir + pool.length) % pool.length]);
  const surprise = () => {
    const others = pool.filter((x) => x.id !== params.preset);
    const pick = others[Math.floor(Math.random() * others.length)] ?? pool[0];
    if (pick) choose(pick);
  };
  const knob = (k: UnitKey, v: number) => onChange(setKnob(params, k, v));
  const choice = (patch: Partial<Pick<SynthParams, "osc" | "lfoDest" | "lfoShape" | "fx" | "voice">>) => onChange(setChoice(params, patch));
  /** a double-click puts a slider back where the ready-made sound had it */
  const home = (k: UnitKey) => (preset ? preset.params[k] : DEFAULT_PARAMS[k]);
  const fader = (k: UnitKey, label: string, title?: string) => (
    <Fader key={k} label={label} title={title} value={shown[k]} text={valueText(k, shown[k], shown)} pushed={Math.abs(pushed[k] ?? 0) > 1e-3} onChange={(v) => knob(k, v)} onReset={() => knob(k, home(k) + (pushed[k] ?? 0))} />
  );

  return (
    <section className={`card synth${compact ? " compact" : ""}`} aria-label="Synth">
      <div className="syn-head">
        {!compact && <h2>Synth</h2>}
        <div className="beat-pick syn-name">
          <button aria-label="Previous sound" onClick={() => step(-1)}>‹</button>
          <button className="beat-name" aria-expanded={list} aria-label={`Sound: ${preset?.name ?? "Custom"}`} title={preset?.hint} onClick={() => setList(!list)}>
            <span>{CATEGORIES.find((c) => c.id === (preset?.category ?? cat))?.name}</span>
            <b>{preset ? preset.name : "Custom"}{edited ? " •" : ""}</b>
          </button>
          <button aria-label="Next sound" onClick={() => step(1)}>›</button>
        </div>
        <button className="icon-btn" title="Another sound of this kind" aria-label="Random sound of this kind" onClick={surprise}>⚄</button>
        {onAudition && <button className="icon-btn accent" title="Hear it" aria-label="Hear it" onClick={onAudition}>▶</button>}
      </div>

      {list && (
        <div className="syn-browser">
          <div className="syn-cats" role="tablist" aria-label="Kind of sound">
            {CATEGORIES.map((c) => (
              <button key={c.id} role="tab" aria-selected={cat === c.id} className={`chip${cat === c.id ? " on" : ""}`} onClick={() => setCat(c.id)}>{c.name}</button>
            ))}
          </div>
          <div className="dm-tiles" role="radiogroup" aria-label="Sounds">
            {pool.map((x) => (
              <span key={x.id} className={`dm-tile${x.id === params.preset ? " on" : ""}`}>
                <button role="radio" aria-checked={x.id === params.preset} title={x.hint} onClick={() => choose(x)}><b>{x.name}</b></button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="syn-macros" role="group" aria-label="Macros">
        {MACROS.map((m) => <MacroKnob key={m.id} info={m} value={params.macros[m.id]} onChange={(v) => onChange(setMacro(params, m.id, v))} />)}
      </div>

      <PlayPicker play={params.play} compound={compound} onChange={(p) => onChange({ ...params, play: p })} />

      {compact && (
        <div className="dm-tabs">
          <button className={`chip${open ? " on" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>Panel</button>
        </div>
      )}

      {open && (
        <div className="syn-panel">
          <Section name="Osc" color="var(--accent)" pick={<Seg value={params.osc} label="Oscillator" onChange={(v: OscType) => choice({ osc: v })} options={OSC_TYPES.map((o) => ({ value: o, label: <Icon d={OSC_ICON[o]} title={OSC_INFO[o].name} /> }))} />}>
            {fader("texture", OSC_INFO[params.osc].texture, OSC_INFO[params.osc].hint)}
            {fader("mod", OSC_INFO[params.osc].mod, OSC_INFO[params.osc].hint)}
            {fader("noise", "Noise", "Breath and hiss; past half, only noise")}
          </Section>
          <Section name="LFO" color="var(--seventh)" pick={
            <>
              <Seg value={shown.lfoDest} label="LFO to" onChange={(v: LfoDest) => choice({ lfoDest: v })} options={LFO_DEST_LABELS} />
              <Seg value={params.lfoShape} label="LFO shape" onChange={(v: LfoShape) => choice({ lfoShape: v })} options={(Object.keys(LFO_ICON) as LfoShape[]).map((s) => ({ value: s, label: <Icon d={LFO_ICON[s]} title={s} /> }))} />
            </>
          }>
            {fader("lfoDepth", "Depth")}
            {fader("lfoSpeed", "Speed")}
            {fader("lfoFade", "Fade", "How long the LFO takes to come in after each note")}
          </Section>
          <Section name="Filter" color="var(--third)">
            {fader("cutoff", "Cutoff")}
            {fader("resonance", "Reso", "Resonance: a peak at the cutoff; at the top it sings on its own")}
            {fader("keyTrack", "Key", "How far the cutoff follows the keyboard")}
            {fader("drive", "Drive", "Warmth, then growl")}
          </Section>
          <Section name="EG" color="var(--fifth)">
            {fader("balance", "Amp⇄Flt", "Bottom: the envelope shapes the loudness. Top: it sweeps the filter (the loudness just opens and closes).")}
            {fader("attack", "A")}
            {fader("decay", "D")}
            {fader("sustain", "S")}
            {fader("release", "R")}
          </Section>
          <Section name="Effect" color="var(--ext)" pick={<Seg value={shown.fx} label="Effect" onChange={(v: FxType) => choice({ fx: v })} options={FX_LABELS} />}>
            {fader("fxDepth", "Depth")}
            {fader("fxRate", shown.fx === "delay" ? "Time" : shown.fx === "dist" ? "Tone" : "Rate")}
            {fader("reverb", "Reverb")}
          </Section>
          <Section name="Voice" color="var(--chromatic)" pick={<Seg value={params.voice} label="Voices" onChange={(v: VoiceMode) => choice({ voice: v })} options={VOICE_LABELS} />}>
            {fader("glide", "Glide", "Slide from note to note")}
            {fader("velocity", "Velo", "How much playing harder makes a note louder and brighter")}
            {fader("drift", "Drift", "Slow wandering of pitch and tone, as old circuits do")}
            {fader("width", "Width")}
            {fader("volume", "Vol")}
          </Section>
        </div>
      )}
    </section>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────────────────────

function Section({ name, color, pick, children }: { name: string; color: string; pick?: ReactNode; children: ReactNode }) {
  return (
    <div className="syn-sec" role="group" aria-label={name} style={{ "--sc": color } as CSSProperties}>
      <h3>{name}</h3>
      {pick && <div className="syn-pick">{pick}</div>}
      <div className="syn-faders">{children}</div>
    </div>
  );
}

/** A vertical slider, as on the hardware. Double-click puts it back where the ready-made sound had it. */
function Fader({ label, title, value, text, pushed, onChange, onReset }: { label: string; title?: string; value: number; text: string; pushed: boolean; onChange: (v: number) => void; onReset: () => void }) {
  return (
    <label className={`syn-fader${pushed ? " pushed" : ""}`} title={title} onDoubleClick={onReset}>
      <b>{text}</b>
      <input type="range" min={0} max={1} step={0.005} value={value} aria-label={label} aria-valuetext={text} onChange={(e) => onChange(Number(e.target.value))} />
      <i>{label}</i>
    </label>
  );
}

/** Where on the circle (degrees from the top, clockwise) a point lies. */
function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [32 + r * Math.cos(a), 32 + r * Math.sin(a)];
}
function arc(r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** A big round knob, centred at zero: drag up or down (Shift for fine), arrow keys, double-click for the centre. */
function MacroKnob({ info, value, onChange }: { info: MacroInfo; value: number; onChange: (v: number) => void }) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const set = (v: number) => onChange(Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, v: value };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    set(drag.current.v + ((drag.current.y - e.clientY) / 140) * (e.shiftKey ? 0.2 : 1));
  };
  const up = () => {
    drag.current = null;
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05, PageUp: 0.25, PageDown: -0.25 };
    if (e.key in steps) set(value + steps[e.key]);
    else if (e.key === "Home") set(-1);
    else if (e.key === "End") set(1);
    else if (e.key === "0" || e.key === "Delete" || e.key === "Backspace") set(0);
    else return;
    e.preventDefault();
  };
  const deg = value * 135;
  // the pointer is a short mark by the rim, so the symbol in the middle stays readable
  const [px0, py0] = polar(13, deg);
  const [px, py] = polar(20, deg);
  return (
    <div className={`syn-macro${Math.abs(value) > 1e-3 ? " moved" : ""}`} role="slider" tabIndex={0} aria-label={info.name} aria-valuemin={-1} aria-valuemax={1} aria-valuenow={value}
      aria-valuetext={`${value > 0 ? "+" : ""}${Math.round(value * 100)}`} title={info.hint} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key} onDoubleClick={() => set(0)}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path className="syn-track" d={arc(27, -135, 135)} />
        {Math.abs(deg) > 0.5 && <path className="syn-arc" d={arc(27, Math.min(0, deg), Math.max(0, deg))} />}
        <circle className="syn-cap" cx="32" cy="32" r="21" />
        <line className="syn-tick" x1={px0.toFixed(2)} y1={py0.toFixed(2)} x2={px.toFixed(2)} y2={py.toFixed(2)} />
        <text x="32" y="37.5" textAnchor="middle">{info.symbol}</text>
      </svg>
      <span className="syn-mname">{info.name}</span>
      <span className="syn-mval">{Math.abs(value) < 1e-3 ? "·" : `${value > 0 ? "+" : ""}${Math.round(value * 100)}`}</span>
    </div>
  );
}

const PLAY_LABELS: { value: PlayMode; label: ReactNode }[] = [
  { value: "sustain", label: <span title="Hold: the notes as written">Hold</span> },
  { value: "arp", label: <span title="Arp: the chord's notes one after another">Arp</span> },
  { value: "strum", label: <span title="Strum: the chord spread out like a hand across strings">Strum</span> },
  { value: "pulse", label: <span title="Pulse: the whole chord struck again on every step">Pulse</span> },
  { value: "drone", label: <span title="Drone: the home note and its fifth held under everything">Drone</span> },
  { value: "glide", label: <span title="Glide: one line, sliding from note to note">Glide</span> },
];
const DIR_LABELS: { value: StrumDir; label: string }[] = [
  { value: "down", label: "↓" },
  { value: "up", label: "↑" },
  { value: "alternate", label: "↕" },
];

/** How the written chords and notes are played, with the few settings each way needs. */
function PlayPicker({ play, compound, onChange }: { play: PlaySettings; compound: boolean; onChange: (play: PlaySettings) => void }) {
  const m = play.mode;
  const set = (patch: Partial<PlaySettings>) => onChange({ ...play, ...patch });
  return (
    <div className="syn-play" role="group" aria-label="How it plays">
      <Seg value={m} label="Way of playing" onChange={(v: PlayMode) => onChange(fitMeter({ ...play, mode: v }, compound))} options={PLAY_LABELS} />
      {m === "pulse" && (
        <>
          <SpeedPicker play={play} compound={compound} onChange={onChange} />
          <MiniSlider label="Gate" title="How long each step is held" value={play.gate} min={0.1} onChange={(v) => set({ gate: v })} />
        </>
      )}
      {m === "strum" && (
        <>
          <Seg value={play.direction} label="Direction" onChange={(v: StrumDir) => set({ direction: v })} options={DIR_LABELS} />
          <MiniSlider label="Spread" value={play.spread} onChange={(v) => set({ spread: v })} />
        </>
      )}
      <MiniSlider label="Loose" title="Humanise: looser timing and touch" value={play.humanise} onChange={(v) => set({ humanise: v })} />
      {m === "arp" && <ArpControls play={play} compound={compound} onChange={onChange} />}
    </div>
  );
}

/**
 * The arpeggiator: a ready style (each one a whole set of the arp's settings), how fast and over
 * how many octaves. Settings that match no style (an older song's, or a sound's own) show as
 * Custom and play as they are until a style is picked. In 6/8, 9/8 and 12/8 every style is fitted
 * to the meter (see arpstyles.ts).
 */
export function ArpControls({ play, compound = false, onChange }: { play: PlaySettings; compound?: boolean; onChange: (play: PlaySettings) => void }) {
  const style = styleOf(play, compound);
  return (
    <div className="syn-arp" role="group" aria-label="Arpeggiator">
      <div className="seg syn-styles" role="radiogroup" aria-label="Arp style">
        {stylesFor(compound).map((s) => (
          <button key={s.id} role="radio" aria-checked={style?.id === s.id} className={style?.id === s.id ? "on" : ""} title={s.hint} onClick={() => onChange(withStyle(play, s, compound))}>{s.name}</button>
        ))}
        {!style && <span className="syn-custom" title="Settings of its own: pick a style to change them">Custom</span>}
      </div>
      <div className="syn-row">
        <SpeedPicker play={play} compound={compound} onChange={onChange} />
        <span className="syn-ctl" title="Range: how many octaves the arp climbs">
          <i>Range</i>
          <Seg value={play.octaves} label="Range" onChange={(v: number) => onChange(withRange(play, v))} options={RANGES.map((o) => ({ value: o as number, label: String(o) }))} />
        </span>
      </div>
    </div>
  );
}

/** Speed: a step of a quarter, an eighth or a sixteenth (in threes or dotted if it was; in 6/8, 9/8 and 12/8 a beat, an eighth or a sixteenth). */
function SpeedPicker({ play, compound, onChange }: { play: PlaySettings; compound: boolean; onChange: (play: PlaySettings) => void }) {
  return (
    <span className="syn-ctl" title="Speed: how long each step is">
      <i>Speed</i>
      <Seg value={speedOf(play, compound) ?? ""} label="Speed" onChange={(v: string) => onChange(withSpeed(play, v, compound))} options={SPEEDS.map((s) => ({ value: s.value as string, label: <span title={s.name}>{speedName(s.value, compound)}</span> }))} />
    </span>
  );
}

function MiniSlider({ label, title, value, min = 0, max = 1, onChange }: { label: string; title?: string; value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <label className="syn-mini" title={title}>
      <i>{label}</i>
      <input type="range" min={min} max={max} step={0.01} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

// ── Symbols ────────────────────────────────────────────────────────────────────────────────

function Icon({ d, title }: { d: string; title: string }) {
  return (
    <svg className="syn-icon" viewBox="0 0 24 14" role="img" aria-label={title}>
      <title>{title}</title>
      <path d={d} />
    </svg>
  );
}

/** A small picture of a wave, drawn from the function that makes it (x and the result both 0..1). */
function wave(f: (x: number) => number, n = 48): string {
  let d = "";
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    d += `${i ? "L" : "M"}${(1 + 22 * x).toFixed(2)} ${(12 - 10 * f(x)).toFixed(2)}`;
  }
  return d;
}
const frac = (x: number) => x - Math.floor(x);
const OSC_ICON: Record<OscType, string> = {
  saw: `${wave((x) => frac(2.5 * x), 120)} ${wave((x) => 0.15 + 0.7 * frac(2.5 * x + 0.35), 120)}`,
  pulse: "M1 12V2H6V12H12V2H17V12H23",
  sync: wave((x) => frac(1.7 * frac(2 * x)), 160),
  ring: wave((x) => 0.5 + 0.45 * Math.sin(2 * Math.PI * 6 * x) * Math.sin(Math.PI * 2 * x)),
  fm: wave((x) => 0.5 + 0.45 * Math.sin(2 * Math.PI * (2 * x + 0.5 * Math.sin(2 * Math.PI * 2 * x))), 96),
};
const LFO_ICON: Record<LfoShape, string> = {
  sine: wave((x) => 0.5 + 0.45 * Math.sin(2 * Math.PI * x)),
  triangle: "M1 7L6.5 2L17.5 12L23 7",
  square: "M1 12V2H12V12H23V2",
  saw: "M1 12L12 2V12L23 2",
  random: "M1 8H5V3H9V11H13V5H17V9H21V4H23",
};
const LFO_DEST_LABELS: { value: LfoDest; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "amp", label: "Amp" },
  { value: "filter", label: "Filter" },
  { value: "pitch", label: "Pitch" },
  { value: "osc", label: "Osc" },
];
const FX_LABELS: { value: FxType; label: string }[] = [
  { value: "dist", label: "Dist" },
  { value: "chorus", label: "Chorus" },
  { value: "phaser", label: "Phaser" },
  { value: "delay", label: "Delay" },
  { value: "off", label: "Off" },
];
const VOICE_LABELS: { value: VoiceMode; label: string }[] = [
  { value: "poly", label: "Poly" },
  { value: "mono", label: "Mono" },
  { value: "legato", label: "Legato" },
];
