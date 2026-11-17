/**
 * The live vocal chain's settings, as the engine takes them (see src-tauri/src/fx.rs), and the
 * starting points to choose from. Amounts are 0..1 unless noted.
 */
export interface VocalFx {
  on: boolean;
  /** preamp colour */
  warmth: number;
  /** low cut, Hz */
  lowcut: number;
  gate: number;
  mud: number;
  /** fast compression: catches peaks */
  punch: number;
  /** slow compression: evens the level out */
  smooth: number;
  deess: number;
  /** dB at 4 kHz */
  presence: number;
  /** dB, shelf from 11 kHz */
  air: number;
  double: number;
  echo: number;
  /** seconds */
  echo_time: number;
  echo_feedback: number;
  verb: number;
  verb_size: number;
  verb_predelay: number;
  verb_tone: number;
  /** dB */
  level: number;
}

export const FX_DEFAULT: VocalFx = { on: true, warmth: 0.2, lowcut: 90, gate: 0, mud: 0.3, punch: 0.4, smooth: 0.4, deess: 0.4, presence: 2, air: 2, double: 0, echo: 0, echo_time: 0.11, echo_feedback: 0.15, verb: 0.25, verb_size: 0.5, verb_predelay: 0.03, verb_tone: 0.3, level: 0 };

/** Echo times: a fixed slap, or a note length at the song's tempo (in beats). */
export const ECHO_TIMES: { id: string; label: string; beats?: number; secs?: number }[] = [
  { id: "slap", label: "Slap", secs: 0.11 },
  { id: "8", label: "1/8", beats: 0.5 },
  { id: "8d", label: "1/8 dotted", beats: 0.75 },
  { id: "4", label: "1/4", beats: 1 },
];
export const echoSeconds = (id: string, bpm: number) => {
  const e = ECHO_TIMES.find((x) => x.id === id) ?? ECHO_TIMES[0];
  return e.secs ?? Math.min(2, ((e.beats ?? 0.5) * 60) / bpm);
};

export const PRESETS: { id: string; name: string; hint: string; fx: Partial<VocalFx>; echo?: string }[] = [
  { id: "natural", name: "Natural", hint: "Gently levelled, a small plate: the voice as it is, a little more polished", fx: {} },
  { id: "warm", name: "Warm preamp", hint: "Driven a little through a class-A style preamp: thicker lows, softer top", fx: { warmth: 0.65, mud: 0.45, punch: 0.35, smooth: 0.5, presence: 1.5, air: 1, verb: 0.15 } },
  { id: "bright", name: "Bright pop", hint: "Firm, close and bright, with the esses kept in check", fx: { punch: 0.65, smooth: 0.55, deess: 0.65, presence: 3, air: 4, verb: 0.2, verb_size: 0.4 } },
  { id: "plate", name: "Plate", hint: "A classic bright plate behind the voice, held back while you sing", fx: { verb: 0.5, verb_size: 0.55, verb_predelay: 0.04, verb_tone: 0.2, air: 3 } },
  { id: "slap", name: "Slapback", hint: "One quick echo, like an old tape machine", fx: { echo: 0.45, echo_feedback: 0.08, verb: 0.1, warmth: 0.35 }, echo: "slap" },
  { id: "dream", name: "Dream", hint: "Wide and washed: doubled, a long dark hall and a dotted echo", fx: { double: 0.5, verb: 0.65, verb_size: 0.9, verb_tone: 0.5, verb_predelay: 0.06, echo: 0.3, echo_feedback: 0.35 }, echo: "8d" },
  { id: "dry", name: "Dry", hint: "Levelled and cleaned up, with no space at all", fx: { verb: 0, echo: 0, double: 0 } },
];

/** A preset's full settings at a tempo. */
export function presetFx(id: string, bpm: number): VocalFx {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return { ...FX_DEFAULT, ...p.fx, echo_time: echoSeconds(p.echo ?? "slap", bpm) };
}

/** Settings loaded from storage, made safe. */
export function reviveFx(raw: unknown): VocalFx | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out = { ...FX_DEFAULT };
  for (const k of Object.keys(FX_DEFAULT) as (keyof VocalFx)[]) {
    const v = r[k];
    if (k === "on") out.on = v !== false;
    else if (typeof v === "number" && Number.isFinite(v)) (out[k] as number) = v;
  }
  return out;
}
