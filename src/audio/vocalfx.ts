/**
 * The live vocal chain's settings, as the engine takes them (see src-tauri/src/fx.rs), and the
 * starting points to choose from. Amounts are 0..1 unless noted.
 */
export type ColorKind = "clean" | "tube" | "console" | "tape" | "drive";
export type WidthKind = "double" | "micro" | "chorus";
export type EchoKind = "slap" | "tape" | "analog" | "digital" | "pingpong" | "ambient";
export type SpaceKind = "plate" | "room" | "hall" | "chamber" | "cloud";

export interface VocalFx {
  on: boolean;
  /** preamp colour: which, and how much */
  color: ColorKind;
  warmth: number;
  /** low cut, Hz */
  lowcut: number;
  gate: number;
  /** dB, shelf below 120 Hz */
  low: number;
  /** the boxy area turned down, and where it is (Hz) */
  mud: number;
  mud_freq: number;
  /** fast compression: catches peaks */
  punch: number;
  /** slow compression: evens the level out */
  smooth: number;
  deess: number;
  deess_freq: number;
  /** dB, and where (Hz) */
  presence: number;
  presence_freq: number;
  /** dB, from the air band's corner (Hz) */
  air: number;
  air_freq: number;
  /** everything above is rolled off (Hz; 20000 = off) */
  highcut: number;
  /** width: which kind, and how much */
  width: WidthKind;
  double: number;
  echo_type: EchoKind;
  echo: number;
  /** seconds */
  echo_time: number;
  echo_feedback: number;
  verb_type: SpaceKind;
  verb: number;
  verb_size: number;
  verb_predelay: number;
  verb_tone: number;
  /** how far the echo and reverb step back while the voice sings */
  duck: number;
  /** dB */
  level: number;
}

export const FX_DEFAULT: VocalFx = {
  on: true, color: "tube", warmth: 0.2, lowcut: 90, gate: 0, low: 0, mud: 0.3, mud_freq: 320, punch: 0.4, smooth: 0.4, deess: 0.4, deess_freq: 6500,
  presence: 2, presence_freq: 4000, air: 2, air_freq: 12000, highcut: 20000, width: "double", double: 0,
  echo_type: "tape", echo: 0, echo_time: 0.11, echo_feedback: 0.15, verb_type: "plate", verb: 0.25, verb_size: 0.5, verb_predelay: 0.03, verb_tone: 0.3, duck: 0.45, level: 0,
};

export const COLORS: { id: ColorKind; name: string; hint: string }[] = [
  { id: "clean", name: "Clean", hint: "Glue you barely hear" },
  { id: "tube", name: "Tube", hint: "Valve warmth: second harmonics that grow as you sing louder" },
  { id: "console", name: "Console", hint: "A transformer-coupled desk: thick, with the hardest edges rounded" },
  { id: "tape", name: "Tape", hint: "Tape: quiet detail lifted, peaks held, the top softened" },
  { id: "drive", name: "Exciter", hint: "Sparkle: harmonics added only above 3 kHz" },
];
export const WIDTHS: { id: WidthKind; name: string; hint: string }[] = [
  { id: "double", name: "Double", hint: "Two slightly late copies, like a second take" },
  { id: "micro", name: "Micro", hint: "A few cents flat on the left, sharp on the right: wide and glossy" },
  { id: "chorus", name: "Chorus", hint: "The slow, lush chorus of a classic string synth" },
];
export const ECHOES: { id: EchoKind; name: string; hint: string }[] = [
  { id: "slap", name: "Slap", hint: "One quick repeat" },
  { id: "tape", name: "Tape", hint: "Each repeat duller and rounder, the time wavering a little" },
  { id: "analog", name: "Analog", hint: "Dark repeats that sink into the track" },
  { id: "digital", name: "Digital", hint: "Clean repeats" },
  { id: "pingpong", name: "Ping-pong", hint: "Repeats bounce from side to side" },
  { id: "ambient", name: "Ambient", hint: "Repeats smear into each other, almost a reverb" },
];
export const SPACES: { id: SpaceKind; name: string; hint: string }[] = [
  { id: "plate", name: "Plate", hint: "The classic vocal reverb: bright and dense at once" },
  { id: "room", name: "Room", hint: "A live room: walls you can hear, a short tail" },
  { id: "hall", name: "Hall", hint: "A concert hall: late, warm, the highs fade first" },
  { id: "chamber", name: "Chamber", hint: "An echo chamber: dense and bright" },
  { id: "cloud", name: "Cloud", hint: "A long wash that hangs behind the voice" },
];
/** The air band's corners: the higher, the gentler and silkier. */
export const AIR_BANDS = [{ hz: 10000, label: "10k" }, { hz: 20000, label: "20k" }, { hz: 40000, label: "40k" }];

/** Echo times: a fixed slap, or a note length at the song's tempo (in beats). */
export const ECHO_TIMES: { id: string; label: string; beats?: number; secs?: number }[] = [
  { id: "slap", label: "Slap", secs: 0.11 },
  { id: "8", label: "1/8", beats: 0.5 },
  { id: "8d", label: "1/8 dotted", beats: 0.75 },
  { id: "4", label: "1/4", beats: 1 },
];
export const echoSeconds = (id: string, bpm: number) => {
  const e = ECHO_TIMES.find((x) => x.id === id) ?? ECHO_TIMES[0];
  return e.secs ?? Math.min(1.6, ((e.beats ?? 0.5) * 60) / bpm);
};

/** Starting points, by the kind of record. None is named after a person or a song. */
export const PRESETS: { id: string; name: string; hint: string; fx: Partial<VocalFx>; echo?: string }[] = [
  { id: "natural", name: "Natural", hint: "Gently levelled, a small plate: the voice as it is, a little more polished", fx: {} },
  { id: "pop", name: "Modern pop", hint: "Bright, tight and close: a plate held back behind the voice, a clean eighth-note echo, a touch of width",
    fx: { color: "tube", warmth: 0.15, lowcut: 100, mud: 0.4, mud_freq: 300, presence: 2, presence_freq: 3500, air: 3, punch: 0.5, smooth: 0.35, deess: 0.55, verb_type: "plate", verb: 0.22, verb_size: 0.5, verb_predelay: 0.07, echo_type: "digital", echo: 0.15, echo_feedback: 0.22, width: "micro", double: 0.3 }, echo: "8" },
  { id: "ballad", name: "Ballad", hint: "Lush: tape, a long plate after a clear gap, a quarter-note tape echo feeding it",
    fx: { color: "tape", warmth: 0.25, presence: 2, air: 2, punch: 0.35, smooth: 0.5, verb_type: "plate", verb: 0.36, verb_size: 0.75, verb_predelay: 0.09, echo_type: "tape", echo: 0.12, echo_feedback: 0.3 }, echo: "4" },
  { id: "rnb", name: "R&B / soul", hint: "Smooth and airy: optical levelling, the silkiest air band, a darker plate, a slow chorus",
    fx: { color: "tape", warmth: 0.3, lowcut: 80, mud: 0.4, mud_freq: 300, presence: 1.5, presence_freq: 3000, air: 4, air_freq: 20000, punch: 0.3, smooth: 0.6, deess: 0.6, deess_freq: 7000, verb_type: "plate", verb: 0.3, verb_size: 0.65, verb_predelay: 0.09, verb_tone: 0.45, echo_type: "analog", echo: 0.12, echo_feedback: 0.25, width: "chorus", double: 0.15 }, echo: "8d" },
  { id: "rap", name: "Rap", hint: "Dry and forward: a console pushed, firm fast compression, a small room, a slap",
    fx: { color: "console", warmth: 0.5, low: -2, mud: 0.4, mud_freq: 350, presence: 2, presence_freq: 4500, air: 3, air_freq: 10000, punch: 0.75, smooth: 0.35, deess: 0.3, deess_freq: 5500, verb_type: "room", verb: 0.15, verb_size: 0.4, verb_predelay: 0.015, echo_type: "slap", echo: 0.12, echo_feedback: 0 }, echo: "slap" },
  { id: "trap", name: "Melodic rap", hint: "Wide and glossy: doubled, a quarter-note echo, a short bright plate",
    fx: { color: "tube", warmth: 0.4, lowcut: 100, low: -1, mud: 0.4, mud_freq: 350, presence: 2, presence_freq: 4500, air: 3.5, air_freq: 10000, punch: 0.8, smooth: 0.4, deess: 0.55, deess_freq: 6000, verb_type: "plate", verb: 0.2, verb_size: 0.4, verb_predelay: 0.014, echo_type: "digital", echo: 0.18, echo_feedback: 0.3, width: "double", double: 0.5 }, echo: "4" },
  { id: "rock", name: "Rock", hint: "Grit: a valve stage driven, hard fast compression, a room and a tape slap",
    fx: { color: "tube", warmth: 0.7, lowcut: 100, mud: 0.4, mud_freq: 400, presence: 3, presence_freq: 3000, air: 1.5, air_freq: 10000, punch: 0.75, smooth: 0.25, verb_type: "room", verb: 0.2, verb_size: 0.55, verb_predelay: 0.02, echo_type: "slap", echo: 0.25, echo_feedback: 0.4 }, echo: "slap" },
  { id: "slapback", name: "Slapback", hint: "Old rock'n'roll: one loud tape repeat, a short chamber, the top rolled off",
    fx: { color: "tape", warmth: 0.55, lowcut: 120, presence: 3, presence_freq: 2000, air: 0, highcut: 8000, punch: 0.3, smooth: 0.5, deess: 0.2, verb_type: "chamber", verb: 0.12, verb_size: 0.2, verb_predelay: 0, echo_type: "slap", echo: 0.5, echo_feedback: 0 }, echo: "slap" },
  { id: "heavy", name: "Punk / metal", hint: "Aggressive: a console at its limit, two compressors working hard, the esses clamped",
    fx: { color: "console", warmth: 0.85, lowcut: 80, mud: 0.6, mud_freq: 600, presence: 2.5, presence_freq: 4500, air: 3, air_freq: 10000, punch: 0.9, smooth: 0.6, deess: 0.8, deess_freq: 7500, verb_type: "plate", verb: 0.15, verb_size: 0.45, verb_predelay: 0, echo_type: "digital", echo: 0.1, echo_feedback: 0.15 }, echo: "8" },
  { id: "indie", name: "Indie", hint: "Character: tape, a dark chamber, a dotted tape echo whose repeats fade into the dark, a little chorus",
    fx: { color: "tape", warmth: 0.5, mud: 0.4, mud_freq: 300, presence: 2, presence_freq: 2500, air: 0, highcut: 12000, punch: 0.2, smooth: 0.6, deess: 0.35, deess_freq: 6000, verb_type: "chamber", verb: 0.3, verb_size: 0.6, verb_predelay: 0.04, verb_tone: 0.6, echo_type: "tape", echo: 0.2, echo_feedback: 0.35, width: "chorus", double: 0.15 }, echo: "8d" },
  { id: "dream", name: "Dream pop", hint: "A wash: a very long cloud almost as loud as the voice, a long tape echo, chorus",
    fx: { color: "tape", warmth: 0.45, lowcut: 120, mud: 0.6, mud_freq: 300, presence: 2, presence_freq: 5000, air: 0, highcut: 10000, punch: 0, smooth: 0.5, deess: 0.5, verb_type: "cloud", verb: 0.7, verb_size: 0.7, verb_predelay: 0.03, verb_tone: 0.55, duck: 0.2, echo_type: "tape", echo: 0.3, echo_feedback: 0.5, width: "chorus", double: 0.4 }, echo: "4" },
  { id: "folk", name: "Folk / acoustic", hint: "Natural: barely coloured, light optical levelling, a real-sounding room",
    fx: { color: "clean", warmth: 0.3, lowcut: 80, mud: 0.3, mud_freq: 250, presence: 1, presence_freq: 3000, air: 1.5, air_freq: 10000, punch: 0, smooth: 0.35, deess: 0.2, verb_type: "room", verb: 0.2, verb_size: 0.7, verb_predelay: 0.025 } },
  { id: "dance", name: "Dance", hint: "Bright and pumped: the exciter, a big hall that ducks hard under the voice, ping-pong echoes",
    fx: { color: "drive", warmth: 0.45, lowcut: 120, mud: 0.6, mud_freq: 300, presence: 3, air: 4, punch: 0.8, smooth: 0.4, deess: 0.65, deess_freq: 7000, verb_type: "hall", verb: 0.35, verb_size: 0.7, verb_predelay: 0.03, verb_tone: 0.2, duck: 0.75, echo_type: "pingpong", echo: 0.22, echo_feedback: 0.38, width: "micro", double: 0.5 }, echo: "8d" },
  { id: "lofi", name: "Lo-fi", hint: "A cassette in a bedroom: heavy tape, the lows and highs cut away, a dark space, a wobbling echo",
    fx: { color: "tape", warmth: 0.9, lowcut: 220, highcut: 4200, mud: 0.2, presence: 2, presence_freq: 1500, air: 0, punch: 0, smooth: 0.7, deess: 0, verb_type: "chamber", verb: 0.25, verb_size: 0.5, verb_tone: 0.8, echo_type: "tape", echo: 0.2, echo_feedback: 0.3, width: "chorus", double: 0.2 }, echo: "8" },
  { id: "spoken", name: "Spoken", hint: "Clean and even, no space at all: for speech",
    fx: { color: "clean", warmth: 0.2, lowcut: 80, mud: 0.4, mud_freq: 250, presence: 2, air: 1, punch: 0.4, smooth: 0.5, deess: 0.5, verb: 0, echo: 0 } },
  { id: "dry", name: "Dry", hint: "Levelled and cleaned up, with no space at all", fx: { verb: 0, echo: 0, double: 0 } },
];

/** A preset's full settings at a tempo. */
export function presetFx(id: string, bpm: number): VocalFx {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return { ...FX_DEFAULT, ...p.fx, echo_time: echoSeconds(p.echo ?? "slap", bpm) };
}

const KINDS: { [K in "color" | "width" | "echo_type" | "verb_type"]: readonly string[] } = {
  color: COLORS.map((x) => x.id), width: WIDTHS.map((x) => x.id), echo_type: ECHOES.map((x) => x.id), verb_type: SPACES.map((x) => x.id),
};

/** Settings loaded from storage, made safe. A sound saved before a setting existed gets its default. */
export function reviveFx(raw: unknown): VocalFx | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: VocalFx = { ...FX_DEFAULT };
  for (const k of Object.keys(FX_DEFAULT) as (keyof VocalFx)[]) {
    const v = r[k];
    if (k === "on") out.on = v !== false;
    else if (k in KINDS) {
      if (typeof v === "string" && KINDS[k as keyof typeof KINDS].includes(v)) (out as unknown as Record<string, unknown>)[k] = v;
    } else if (typeof v === "number" && Number.isFinite(v)) (out as unknown as Record<string, unknown>)[k] = v;
  }
  return out;
}
