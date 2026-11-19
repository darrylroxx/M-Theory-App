/**
 * The synth's panel. On top, ready-made sounds by kind (with ‹ › to step and a die for a surprise
 * in the same kind), six big macro knobs, how the notes are played, and keys to play it. Underneath, the whole
 * panel of the instrument it is modelled on, section by section (Osc, LFO, Filter, EG, Effect,
 * Voice), with sliders that move as the macros turn, so turning a macro shows what it does.
 *
 * Self-contained: it is handed the sound and gives back a changed one; whoever holds the sound
 * decides where it lives and plays it (see SynthInstrument.set).
 */
import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
import { MACROS, type MacroInfo, applyMacros, macroOffsets, macroChoices, setChoice, setKnob, setMacro } from "../../synth/macros";
import {
  ARP_PATTERNS,
  DEFAULT_PARAMS,
  type ArpPattern,
  type FxType,
  type LfoDest,
  type LfoShape,
  OCT_MOVES,
  type OctMove,
  OSC_INFO,
  OSC_TYPES,
  type OscType,
  type PlayMode,
  type PlaySettings,
  RATES,
  RHYTHMS,
  type Rate,
  SWING_MAX,
  type StrumDir,
  type SynthParams,
  type UnitKey,
  type VoiceMode,
  sameSynth,
  valueText,
} from "../../synth/params";
import { CATEGORIES, type PresetCategory, type SynthPreset, presetById, presetsIn } from "../../synth/presets";
import { Seg } from "./common";
import type { LiveOut } from "../../synth/live";
import { SynthKeys } from "./SynthKeys";

export interface SynthPanelProps {
  params: SynthParams;
  onChange: (params: SynthParams) => void;
  /** play something short to hear the sound (called after a new sound is chosen, and by ▶) */
  onAudition?: () => void;
  /** small: the presets, the macros and the way of playing; the panel opens on request */
  compact?: boolean;
  /** where notes played on the on-screen keys go (no keys without it) */
  keys?: LiveOut;
}

export function SynthPanel({ params, onChange, onAudition, compact, keys }: SynthPanelProps) {
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
  const edited = preset ? !sameSynth({ ...preset.params, volume: params.volume }, params) : false;

  const choose = (x: SynthPreset) => {
    setCat(x.category);
    // a ready-made sound replaces everything but how loud this track is
    onChange({ ...x.params, volume: params.volume });
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
  const play = (patch: Partial<PlaySettings>) => onChange({ ...params, play: { ...params.play, ...patch } });
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

      <PlayPicker play={params.play} onChange={play} />

      {keys && <SynthKeys out={keys} play={params.play} />}

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
  { value: "arp", label: <span title="Arpeggiator: the chord's notes one after another, with a pattern, octaves, a rhythm and swing">Arp</span> },
  { value: "strum", label: <span title="Strum: the chord spread out like a hand across strings">Strum</span> },
  { value: "pulse", label: <span title="Pulse: the whole chord struck again on every step">Pulse</span> },
  { value: "drone", label: <span title="Drone: the home note and its fifth held under everything">Drone</span> },
  { value: "glide", label: <span title="Glide: one line, sliding from note to note">Glide</span> },
];
const PATTERN_LABELS: Record<ArpPattern, { label: string; hint: string }> = {
  up: { label: "↑", hint: "Up" },
  down: { label: "↓", hint: "Down" },
  updown: { label: "↕", hint: "Up and down" },
  played: { label: "♪", hint: "As played: the order the notes are written or pressed" },
  converge: { label: "><", hint: "Converge: from the outside notes in" },
  diverge: { label: "<>", hint: "Diverge: from the middle note out" },
  thumb: { label: "⊥", hint: "Thumb: the lowest note between each of the others" },
  pinky: { label: "⊤", hint: "Pinky: the highest note between each of the others" },
  crawl: { label: "⤴", hint: "Crawl: creep up the chord" },
  chord: { label: "≡", hint: "The whole chord, jumping octaves" },
  random: { label: "⚄", hint: "Random" },
};
const MOVE_LABELS: Record<OctMove, { label: string; hint: string }> = {
  span: { label: "All", hint: "The pattern runs across every octave at once" },
  up: { label: "⇈", hint: "The pattern again an octave higher each time round" },
  down: { label: "⇊", hint: "The pattern from the top octave, an octave lower each time round" },
  bounce: { label: "⇅", hint: "The pattern climbs the octaves and comes back down" },
};
const DIR_LABELS: { value: StrumDir; label: string }[] = [
  { value: "down", label: "↓" },
  { value: "up", label: "↑" },
  { value: "alternate", label: "↕" },
];
/** A step is a note value and how it is felt: straight, dotted or triplet. */
const NOTE_VALUES = ["1/4", "1/8", "1/16", "1/32"] as const;
const FEELS: { value: "" | "D" | "T"; label: ReactNode }[] = [
  { value: "", label: <span title="Straight" aria-label="Straight">–</span> },
  { value: "D", label: <span title="Dotted: half as long again" aria-label="Dotted: half as long again">•</span> },
  { value: "T", label: <span title="Triplet: three in the time of two" aria-label="Triplet: three in the time of two">3</span> },
];
const splitRate = (r: Rate): { value: (typeof NOTE_VALUES)[number]; feel: "" | "D" | "T" } => {
  const m = /^(1\/\d+)([DT]?)$/.exec(r);
  return { value: (m?.[1] ?? "1/16") as (typeof NOTE_VALUES)[number], feel: (m?.[2] ?? "") as "" | "D" | "T" };
};
const rateOf = (value: string, feel: string): Rate => {
  const r = `${value}${feel}` as Rate;
  return RATES.includes(r) ? r : "1/16";
};

/** How the written chords and notes are played, with the few settings each way needs. */
function PlayPicker({ play, onChange }: { play: PlaySettings; onChange: (patch: Partial<PlaySettings>) => void }) {
  const m = play.mode;
  return (
    <div className="syn-play" role="group" aria-label="How it plays">
      <Seg value={m} label="Way of playing" onChange={(v: PlayMode) => onChange({ mode: v })} options={PLAY_LABELS} />
      {m === "pulse" && (
        <>
          <RatePicker rate={play.rate} onChange={(rate) => onChange({ rate })} />
          <MiniSlider label="Gate" title="How long each step is held" value={play.gate} min={0.1} onChange={(v) => onChange({ gate: v })} />
        </>
      )}
      {m === "strum" && (
        <>
          <Seg value={play.direction} label="Direction" onChange={(v: StrumDir) => onChange({ direction: v })} options={DIR_LABELS} />
          <MiniSlider label="Spread" value={play.spread} onChange={(v) => onChange({ spread: v })} />
        </>
      )}
      <MiniSlider label="Loose" title="Humanise: looser timing and touch" value={play.humanise} onChange={(v) => onChange({ humanise: v })} />
      {m === "arp" && <ArpControls play={play} onChange={onChange} />}
    </div>
  );
}

/** The arpeggiator: pattern, octaves, step, gate, swing, repeats, and a rhythm of steps. */
function ArpControls({ play, onChange }: { play: PlaySettings; onChange: (patch: Partial<PlaySettings>) => void }) {
  return (
    <div className="syn-arp" role="group" aria-label="Arpeggiator">
      <Seg value={play.pattern} label="Pattern" onChange={(v: ArpPattern) => onChange({ pattern: v })} options={ARP_PATTERNS.map((p) => ({ value: p, label: <span title={PATTERN_LABELS[p].hint} aria-label={PATTERN_LABELS[p].hint}>{PATTERN_LABELS[p].label}</span> }))} />
      <div className="syn-row">
        <span className="syn-ctl" title="Octaves: how far the arpeggio climbs">
          <i>Oct</i>
          <Seg value={play.octaves} label="Octaves" onChange={(v: 1 | 2 | 3 | 4) => onChange({ octaves: v })} options={([1, 2, 3, 4] as const).map((o) => ({ value: o, label: String(o) }))} />
        </span>
        {play.octaves > 1 && (
          <Seg value={play.octMove} label="Octave movement" onChange={(v: OctMove) => onChange({ octMove: v })} options={OCT_MOVES.map((o) => ({ value: o, label: <span title={MOVE_LABELS[o].hint} aria-label={MOVE_LABELS[o].hint}>{MOVE_LABELS[o].label}</span> }))} />
        )}
      </div>
      <div className="syn-row">
        <RatePicker rate={play.rate} onChange={(rate) => onChange({ rate })} />
        <span className="syn-ctl" title="Repeat: each step struck once, or quickly two to four times">
          <i>Rpt</i>
          <Seg value={play.ratchet} label="Repeat" onChange={(v: 1 | 2 | 3 | 4) => onChange({ ratchet: v })} options={([1, 2, 3, 4] as const).map((r) => ({ value: r, label: `×${r}` }))} />
        </span>
      </div>
      <div className="syn-row">
        <MiniSlider label="Gate" title="How long each step is held" value={play.gate} min={0.1} onChange={(v) => onChange({ gate: v })} />
        <MiniSlider label="Swing" title="Push every second step late: half way is a triplet lilt" value={play.swing} max={SWING_MAX} onChange={(v) => onChange({ swing: v })} />
      </div>
      <RhythmSteps rhythm={play.rhythm} onChange={(rhythm) => onChange({ rhythm })} />
    </div>
  );
}

function RatePicker({ rate, onChange }: { rate: Rate; onChange: (r: Rate) => void }) {
  const { value, feel } = splitRate(rate);
  return (
    <span className="syn-ctl" title="Step: how long each step of the arpeggio or pulse is">
      <i>Step</i>
      <Seg value={value} label="Step" onChange={(v: string) => onChange(rateOf(v, feel))} options={NOTE_VALUES.map((r) => ({ value: r, label: r }))} />
      <Seg value={feel} label="Feel" onChange={(f: string) => onChange(rateOf(value, f))} options={FEELS} />
    </span>
  );
}

/** The next state of a step when tapped: plays, plays harder, rests. */
const NEXT_STEP: Record<string, string> = { x: "X", X: ".", ".": "x" };

/**
 * The arp's rhythm: a ready one to pick, and its steps to tap (each tap: plays → accented →
 * rest). 8 or 16 steps, starting again on the first bar line after they have all played.
 */
function RhythmSteps({ rhythm, onChange }: { rhythm: string; onChange: (r: string) => void }) {
  const steps = rhythm || "x".repeat(8);
  // (every step playing, 8 or 16 of them, is the even rhythm)
  const ready = /^x*$/.test(rhythm) ? RHYTHMS[0] : RHYTHMS.find((r) => r.steps === rhythm);
  const tap = (i: number) => {
    const next = steps.slice(0, i) + NEXT_STEP[steps[i]] + steps.slice(i + 1);
    // a rhythm that rests on every step would play nothing at all: the last step left keeps playing
    const r = /[xX]/.test(next) ? next : steps.slice(0, i) + "x" + steps.slice(i + 1);
    onChange(/^x+$/.test(r) && r.length === 8 ? "" : r);
  };
  const resize = (n: number) => {
    const r = n > steps.length ? steps.repeat(Math.ceil(n / steps.length)).slice(0, n) : steps.slice(0, n);
    onChange(/[xX]/.test(r) ? (/^x{8}$/.test(r) ? "" : r) : "x".repeat(n));
  };
  return (
    <div className="syn-rhythm">
      <span className="syn-ctl" title="Rhythm: which steps play, which lean harder, which rest">
        <i>Rhythm</i>
        <select aria-label="Rhythm" value={ready?.id ?? "own"} onChange={(e) => onChange(RHYTHMS.find((r) => r.id === e.target.value)?.steps ?? rhythm)}>
          {RHYTHMS.map((r) => <option key={r.id} value={r.id} title={r.hint}>{r.name}</option>)}
          {!ready && <option value="own">Own</option>}
        </select>
        <Seg value={steps.length > 8 ? 16 : 8} label="Steps in the rhythm" onChange={(n: number) => resize(n)} options={[8, 16].map((n) => ({ value: n, label: String(n) }))} />
      </span>
      <div className={`syn-steps${steps.length > 8 ? " long" : ""}`} role="group" aria-label="Steps">
        {[...steps].map((c, i) => (
          <button key={i} className={`syn-step${c === "X" ? " acc" : c === "x" ? " on" : ""}${i % 4 === 0 ? " beat" : ""}`} aria-label={`Step ${i + 1}: ${c === "X" ? "accent" : c === "x" ? "plays" : "rest"}`}
            title="Tap: plays, then accented, then a rest" onClick={() => tap(i)} />
        ))}
      </div>
    </div>
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
