/**
 * Drum beats: the step-grid format, the rhythm library and the helpers shared by
 * playback, the editor and MIDI export.
 *
 * A beat is one or more bars. `steps` is the number of grid steps in one bar and `div` the
 * number of steps per beat, so 4/4 in 16ths is 16 × 4, a 12/8 shuffle is 12 × 3
 * and a 3/4 waltz is 12 × 4. Each drum's row holds `steps × bars` characters.
 */
import { DRUM_IDS, KITS, SAMPLERS, defaultParams, isMachine, type DrumId, type DrumParams, type KitId, type SamplerId, type VoiceId } from "./drums";
import { isSatType, type SatType } from "./saturation";
import { getRecipe } from "./voices";
import { RHYTHMS, type BeatGroupId, type RhythmSpec, type Short } from "./rhythms";

export type { BeatGroupId } from "./rhythms";
export { BEAT_GROUPS } from "./rhythms";

export interface BeatPattern {
  id: string;
  name: string;
  group: BeatGroupId | "mine";
  steps: number;
  div: number;
  /** bars in the pattern (missing = 1) */
  bars?: number;
  /** tempo this rhythm usually sits at */
  bpm: number;
  swing: number;
  /** One string per drum, one character per step: 0 off, 1 soft, 2 normal, 3 loud */
  rows: Record<DrumId, string>;
}

export type EchoTime = "1/16" | "1/8" | "1/8." | "1/4";
/** Echo repeat lengths, in beats. */
export const ECHO_TIMES: { id: EchoTime; beats: number; label: string }[] = [
  { id: "1/16", beats: 0.25, label: "Fast" },
  { id: "1/8", beats: 0.5, label: "8th" },
  { id: "1/8.", beats: 0.75, label: "Dotted" },
  { id: "1/4", beats: 1, label: "Beat" },
];

export type VerbId = "room" | "hall" | "plate" | "spring" | "gated" | "dark";
export const VERBS: { id: VerbId; name: string; hint: string }[] = [
  { id: "room", name: "Room", hint: "A real room around the kit" },
  { id: "hall", name: "Hall", hint: "Long and smooth" },
  { id: "plate", name: "Plate", hint: "Dense, bright and immediate: the classic studio drum reverb" },
  { id: "spring", name: "Spring", hint: "Boingy and drippy, like a guitar amp's reverb" },
  { id: "gated", name: "Gated", hint: "A big burst that stops dead: the 80s snare" },
  { id: "dark", name: "Lo-fi", hint: "Dark and grainy, like a cheap old digital reverb" },
];
export type NoiseBed = "off" | "vinyl" | "tape" | "room" | "hum";
export const NOISE_BEDS: { id: NoiseBed; name: string; hint: string }[] = [
  { id: "off", name: "None", hint: "Silence between the hits" },
  { id: "vinyl", name: "Vinyl", hint: "Crackle, pops and surface noise" },
  { id: "tape", name: "Tape", hint: "Cassette hiss" },
  { id: "room", name: "Room", hint: "The air of a quiet room" },
  { id: "hum", name: "Hum", hint: "Old amp hum" },
];

/** The effects every drum passes through. */
export interface BeatFx {
  /** drum volume 0…1 */
  level: number;
  /** reverb amount 0…1 */
  space: number;
  /** reverb length: 0 small room … 1 long hall */
  size: number;
  /** echo amount 0…1 */
  echo: number;
  echoTime: EchoTime;
  /** saturation 0…1, its colour, and how much of the kit goes through it (1 = all of it) */
  grit: number;
  color: SatType;
  blend: number;
  /** tape wobble and dullness 0…1 */
  tape: number;
  /** −1 dark … 1 bright */
  tone: number;
  /** compression 0…1 */
  glue: number;
  /** loose, human timing and touch 0…1 */
  human: number;
  /** the kind of reverb */
  verb: VerbId;
  /** sampler character for every drum */
  sampler: SamplerId;
  /** a bed of noise under the drums while they play */
  noise: NoiseBed;
  noiseAmt: number;
  /** the guitar ducks under every kick 0…1 */
  pump: number;
}

export interface Beat extends Partial<Omit<BeatFx, "level" | "space" | "grit">> {
  on: boolean;
  /** the machine every drum uses… */
  kit: KitId;
  /** …unless a drum has been given another sound (another machine's, or one from the library) */
  voices?: Partial<Record<DrumId, VoiceId>>;
  /** the saved kit this came from, if any */
  userKit?: string | null;
  /** library (or saved) pattern this started from */
  patternId: string | null;
  name: string;
  edited?: boolean;
  /** steps in one bar */
  steps: number;
  div: number;
  /** how many bars the pattern lasts before it repeats (missing = 1) */
  bars?: number;
  /** 0 = straight … 1 = full triplet swing (16th grids only) */
  swing: number;
  /** drum volume 0…1 */
  level: number;
  /** reverb amount 0…1 */
  space: number;
  /** saturation / lo-fi amount 0…1 */
  grit: number;
  rows: Record<DrumId, string>;
  /** per-drum sound tweaks (missing = default) */
  sounds: Partial<Record<DrumId, Partial<DrumParams>>>;
  mutes?: DrumId[];
}

export type StepLevel = 0 | 1 | 2 | 3;
export const STEP_VELOCITY = [0, 0.42, 0.78, 1];

const emptyRow = (steps: number) => "0".repeat(steps);
export const emptyRows = (steps: number): Record<DrumId, string> => Object.fromEntries(DRUM_IDS.map((d) => [d, emptyRow(steps)])) as Record<DrumId, string>;

/** Library shorthand: "." off, "o" soft, "x" normal, "X" loud; "|" and spaces are ignored. */
function row(src: string | undefined, steps: number): string {
  if (!src) return emptyRow(steps);
  const s = src.replace(/[|\s]/g, "");
  let out = "";
  for (let i = 0; i < steps; i++) out += { ".": "0", o: "1", x: "2", X: "3" }[s[i] ?? "."] ?? "0";
  return out;
}

const KEYS: Record<keyof Short, DrumId> = { K: "kick", S: "snare", C: "clap", H: "hat", O: "open", T: "tom", R: "rim", Sh: "shaker", B: "bell" };

/** Build a library rhythm from its shorthand. A row that is not exactly as long as its bars is a typing mistake. */
function build([group, name, bpm, r, o = {}]: RhythmSpec): BeatPattern {
  const steps = o.steps ?? 16;
  const bars = o.bars ?? 1;
  const rows = emptyRows(steps * bars);
  for (const k of Object.keys(r) as (keyof Short)[]) {
    const len = (r[k] ?? "").replace(/[|\s]/g, "").length;
    if (len !== steps * bars) throw new Error(`${group} / ${name}: row ${k} has ${len} steps, not ${steps * bars}`);
    rows[KEYS[k]] = row(r[k], steps * bars);
  }
  return { id: `${group}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, group, steps, div: o.div ?? 4, ...(bars > 1 ? { bars } : {}), bpm, swing: o.swing ?? 0, rows };
}

export const BEAT_LIBRARY: BeatPattern[] = RHYTHMS.map(build);

export const findPattern = (id: string | null | undefined, mine: BeatPattern[] = []): BeatPattern | undefined =>
  id ? (BEAT_LIBRARY.find((p) => p.id === id) ?? mine.find((p) => p.id === id)) : undefined;

export const FX_DEFAULTS: BeatFx = { level: 0.8, space: 0.25, size: 0.45, echo: 0, echoTime: "1/8.", grit: 0.4, color: "tape", blend: 1, tape: 0, tone: 0, glue: 0.3, human: 0, verb: "room", sampler: "off", noise: "off", noiseAmt: 0.3, pump: 0 };
const FX_KEYS = Object.keys(FX_DEFAULTS) as (keyof BeatFx)[];

/** The beat's effect settings, with defaults for anything an older beat does not have. */
export function fxOf(b: Partial<BeatFx>): BeatFx {
  const out = { ...FX_DEFAULTS } as Record<keyof BeatFx, number | string>;
  for (const k of FX_KEYS) if (b[k] !== undefined) out[k] = b[k] as number | string;
  return out as unknown as BeatFx;
}

/**
 * Saturation used to be one colour on a much coarser knob: a tenth of a turn was already clearly
 * driven. Beats and kits saved back then are moved to the same sound on today's knob.
 */
export function oldGrit(g: number): number {
  const pts: [number, number][] = [[0, 0], [0.1, 0.4], [0.25, 0.67], [0.5, 0.95], [0.8, 1], [1, 1]];
  const x = Math.min(1, Math.max(0, g));
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) return +(pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * (x - pts[i - 1][0])) / (pts[i][0] - pts[i - 1][0])).toFixed(3);
  return 1;
}
/** Effect settings loaded from storage, made whole: older ones get today's saturation, unknown names their defaults. */
function reviveFx(raw: Partial<BeatFx>): BeatFx {
  const fx = fxOf(raw);
  if (raw.color === undefined && typeof raw.grit === "number") fx.grit = oldGrit(raw.grit);
  if (!isSatType(fx.color)) fx.color = FX_DEFAULTS.color;
  if (!VERBS.some((v) => v.id === fx.verb)) fx.verb = FX_DEFAULTS.verb;
  if (!SAMPLERS.some((v) => v.id === fx.sampler)) fx.sampler = FX_DEFAULTS.sampler;
  if (!NOISE_BEDS.some((v) => v.id === fx.noise)) fx.noise = FX_DEFAULTS.noise;
  return fx;
}

/** Which sound a drum plays: its own choice, or the kit machine's. */
export const voiceOf = (b: Pick<Beat, "kit" | "voices">, id: DrumId): VoiceId => b.voices?.[id] ?? b.kit;
export const knownVoice = (v: unknown): v is VoiceId => typeof v === "string" && (isMachine(v) || !!getRecipe(v));
/** A drum's full sound settings. */
export const soundOf = (b: Pick<Beat, "sounds">, id: DrumId): DrumParams => ({ ...defaultParams(id), ...b.sounds[id] });

/** One-tap effect settings for the whole kit. Volume and feel are left alone. */
type VibeFx = Omit<BeatFx, "level" | "human">;
const vibe = (fx: Partial<VibeFx>): VibeFx => {
  const { level: _l, human: _h, ...rest } = { ...FX_DEFAULTS, ...fx };
  return rest;
};
export const VIBES: { id: string; name: string; hint: string; fx: VibeFx }[] = [
  { id: "clean", name: "Clean", hint: "Dry and clear, barely coloured", fx: vibe({ space: 0.12, size: 0.3, grit: 0.15, color: "console" }) },
  { id: "warm", name: "Warm", hint: "Valves: round and sweet", fx: vibe({ space: 0.2, size: 0.4, grit: 0.6, color: "tube", tone: -0.1, glue: 0.4 }) },
  { id: "fat", name: "Fat", hint: "A desk pushed into the red: thick kick, glued kit", fx: vibe({ space: 0.18, size: 0.35, grit: 0.65, color: "console", glue: 0.55 }) },
  { id: "punch", name: "Punch", hint: "Peaks shaved off: loud and tight", fx: vibe({ space: 0.15, size: 0.3, grit: 0.6, color: "clip", tone: 0.1, glue: 0.5 }) },
  { id: "dreamy", name: "Dreamy", hint: "A long plate, soft echo, slightly dark and wobbly", fx: vibe({ verb: "plate", space: 0.55, size: 0.8, echo: 0.22, tape: 0.35, tone: -0.25, glue: 0.35, noise: "tape", noiseAmt: 0.15 }) },
  { id: "cassette", name: "Cassette", hint: "Warm, dull and wobbly, with hiss", fx: vibe({ space: 0.2, size: 0.4, grit: 0.8, color: "tape", tape: 0.65, tone: -0.4, glue: 0.5, sampler: "mpc", noise: "tape", noiseAmt: 0.35 }) },
  { id: "dusty", name: "Dusty", hint: "A 12-bit sampler and a crackly record", fx: vibe({ space: 0.18, size: 0.35, grit: 0.65, color: "tube", tape: 0.35, tone: -0.35, glue: 0.55, sampler: "sp", noise: "vinyl", noiseAmt: 0.4 }) },
  { id: "gated", name: "Gated 80s", hint: "A big gated room that stops dead", fx: vibe({ verb: "gated", space: 0.5, size: 0.5, grit: 0.55, color: "console", tone: 0.15, glue: 0.6 }) },
  { id: "big", name: "Big Room", hint: "Loud, wide and punchy", fx: vibe({ space: 0.45, size: 0.6, grit: 0.55, color: "clip", tone: 0.15, glue: 0.7 }) },
  { id: "crunch", name: "Crunch", hint: "Overdriven mids, squashed hard", fx: vibe({ space: 0.1, size: 0.25, grit: 0.7, color: "crunch", tape: 0.15, tone: 0.1, glue: 0.8 }) },
  { id: "blown", name: "Blown out", hint: "Fuzz on half the kit: broken speakers, the punch kept", fx: vibe({ space: 0.15, size: 0.3, grit: 0.5, color: "fuzz", blend: 0.5, glue: 0.7 }) },
  { id: "dub", name: "Dub", hint: "A spring reverb and echoes trailing off", fx: vibe({ verb: "spring", space: 0.4, size: 0.5, echo: 0.5, grit: 0.5, tape: 0.25, tone: -0.1 }) },
  { id: "pump", name: "Pump", hint: "Everything breathes with the kick", fx: vibe({ verb: "plate", space: 0.3, size: 0.5, grit: 0.7, tone: -0.1, glue: 0.65, pump: 0.6 }) },
];

/** The vibe whose settings the beat has right now, if any. */
export function vibeOf(b: Beat): string | null {
  const fx = fxOf(b);
  return VIBES.find((v) => (Object.keys(v.fx) as (keyof VibeFx)[]).every((k) => v.fx[k] === fx[k]))?.id ?? null;
}

/** A whole drum setup: a machine, a sound for each drum, knob settings and effects. Built in, or saved by you. */
export interface UserKit {
  id: string;
  name: string;
  /** the machine any drum without its own sound falls back on */
  kit: KitId;
  voices: Partial<Record<DrumId, VoiceId>>;
  sounds: Partial<Record<DrumId, Partial<DrumParams>>>;
  fx: BeatFx;
}

type Nine = [VoiceId, VoiceId, VoiceId, VoiceId, VoiceId, VoiceId, VoiceId, VoiceId, VoiceId];
/** A built-in kit: one sound for each of the nine drums (kick, snare, clap, hat, open, tom, rim, shaker, perc), in that order. */
const kitOf = (id: string, name: string, hint: string, base: KitId, nine: Nine, fx: Partial<BeatFx>, sounds: UserKit["sounds"] = {}): UserKit & { hint: string } => ({
  id: `kit-${id}`,
  name,
  hint,
  kit: base,
  voices: Object.fromEntries(DRUM_IDS.map((d, i) => [d, nine[i]])) as UserKit["voices"],
  sounds,
  fx: { ...FX_DEFAULTS, ...fx },
});

/** Kits by sound and genre, built from the library. */
export const BUILTIN_KITS: (UserKit & { hint: string })[] = [
  kitOf("soft", "Soft Box", "Soft kick, brushy snare, airy hats, a long plate", "box",
    ["kick.soft", "snare.soft", "clap.soft", "hat.soft", "open.808", "tom.808", "rim.claves", "shaker.maraca", "bell.vibes"],
    { grit: 0.3, verb: "plate", space: 0.55, size: 0.8, echo: 0.15, tape: 0.35, tone: -0.25, glue: 0.35, human: 0.12, noise: "tape", noiseAmt: 0.15 }, { open: { filter: -0.25 } }),
  kitOf("cassette", "Cassette", "A small kit recorded to a four-track: warm, wobbly, hissy", "lofi",
    ["kick.tight", "snare.acoustic", "clap.808", "hat.noise", "open.808", "tom.909", "rim.sidestick", "shaker.16th", "bell.808"],
    { space: 0.25, size: 0.4, grit: 0.76, color: "tape", tape: 0.6, tone: -0.35, glue: 0.55, human: 0.1, sampler: "mpc", noise: "tape", noiseAmt: 0.35 }),
  kitOf("dusty", "Dusty", "12-bit sampler, crackly record, round and soft", "lofi",
    ["kick.dusty", "snare.dusty", "clap.dusty", "hat.dusty", "open.dusty", "tom.dusty", "rim.sidestick", "shaker.egg", "bell.vibes"],
    { space: 0.18, size: 0.35, grit: 0.62, color: "tube", tape: 0.35, tone: -0.35, glue: 0.55, human: 0.15, sampler: "sp", noise: "vinyl", noiseAmt: 0.4 }),
  kitOf("cold", "Cold Wave", "Stiff 8-bit machine, cracking snare in a gated room", "707",
    ["kick.stiff", "snare.cold", "clap.cold", "hat.808", "open.606", "tom.cold", "rim.linn", "shaker.808", "bell.808"],
    { verb: "gated", space: 0.45, size: 0.45, grit: 0.6, color: "console", tape: 0.2, tone: 0.15, glue: 0.6 }, { snare: { space: 0.8 } }),
  kitOf("dark", "Dark Club", "Hard kick, gated snare, tight hats; everything pumps", "909",
    ["kick.909hard", "snare.gated", "clap.909", "hat.909", "open.909", "tom.simmons", "rim.909", "shaker.808", "bell.clang"],
    { verb: "plate", space: 0.35, size: 0.5, echo: 0.12, echoTime: "1/8", grit: 0.6, color: "clip", tone: -0.2, glue: 0.65, pump: 0.5 }),
  kitOf("neon", "Neon", "Big gated snare, electronic toms, a hall and a little tape", "808",
    ["kick.909", "snare.gated", "clap.gated", "hat.808", "open.disco", "tom.simmons", "rim.808", "shaker.16th", "bell.fm"],
    { verb: "hall", space: 0.4, size: 0.6, echo: 0.15, grit: 0.58, color: "tape", tape: 0.3, tone: 0.1, glue: 0.55, pump: 0.35, noise: "tape", noiseAmt: 0.15 }),
  kitOf("arena", "Arena", "A real kit, hit hard, in a big room", "linn",
    ["kick.felt", "snare.acoustic", "clap.crowd", "hat.acoustic", "open.acoustic", "tom.floor", "rim.sidestick", "shaker.tamb", "bell.crash"],
    { space: 0.45, size: 0.7, grit: 0.6, color: "console", tone: 0.1, glue: 0.75, human: 0.2 }, { kick: { punch: 0.7, tone: 0.6 }, snare: { punch: 0.7, decay: 0.65 } }),
  kitOf("studio", "Studio", "A real kit, close and dry", "linn",
    ["kick.felt", "snare.acoustic", "clap.crowd", "hat.acoustic", "open.acoustic", "tom.rack", "rim.sidestick", "shaker.maraca", "bell.ride"],
    { space: 0.15, size: 0.3, grit: 0.35, color: "console", glue: 0.45, human: 0.25 }),
  kitOf("brushes", "Brushes", "Brushes on a snare, felt beater, a soft ride", "box",
    ["kick.felt", "snare.brush", "clap.snap", "hat.pedal", "open.half", "tom.floor", "rim.sidestick", "shaker.egg", "bell.ridebell"],
    { grit: 0.25, space: 0.25, size: 0.4, tone: -0.15, glue: 0.35, human: 0.3 }, { kick: { tone: 0.2, decay: 0.6 } }),
  kitOf("trap", "Trap", "Long sub kick, tight snare and clap, crisp hats", "808",
    ["kick.sub", "snare.tight", "clap.tight", "hat.crisp", "open.trap", "tom.808", "rim.808", "shaker.808", "bell.808"],
    { level: 0.65, space: 0.15, size: 0.3, grit: 0.5, color: "clip", glue: 0.5 }),
  kitOf("techno", "Techno", "Rumbling kick, 909 hats, echoes in a hall", "909",
    ["kick.rumble", "snare.909", "clap.909", "hat.909", "open.909", "tom.909", "rim.909", "shaker.16th", "bell.ride"],
    { verb: "hall", space: 0.3, size: 0.6, echo: 0.2, grit: 0.62, color: "tube", glue: 0.6, pump: 0.4 }),
  kitOf("industrial", "Industrial", "Distorted kick, ring-modulated snare, metal", "909",
    ["kick.industrial", "snare.industrial", "clap.crunch", "hat.grind", "open.sizzle", "tom.syn", "rim.tink", "shaker.cabasa", "bell.china"],
    { level: 0.65, verb: "dark", space: 0.3, size: 0.5, grit: 0.45, color: "fuzz", blend: 0.7, tone: -0.1, glue: 0.7 }),
  kitOf("glitch", "Glitch", "Blips, clicks and ticks, chopped by fast echoes", "mod",
    ["kick.blip", "snare.hyper", "clap.snap", "hat.tick", "open.swell", "tom.syn", "rim.tick", "shaker.cabasa", "bell.glass"],
    { level: 0.95, space: 0.15, size: 0.25, echo: 0.35, echoTime: "1/16", grit: 0.5, color: "crunch", glue: 0.6, sampler: "crush" }, { rim: { echo: 0.8 }, bell: { echo: 0.7 } }),
  kitOf("dub", "Dub", "Round kick, high rim snare, a spring reverb and echoes", "box",
    ["kick.round", "snare.steppers", "clap.dry", "hat.ring", "open.half", "tom.dub", "rim.dub", "shaker.16th", "bell.agogo"],
    { grit: 0.5, verb: "spring", space: 0.45, size: 0.5, echo: 0.45, tape: 0.25, tone: -0.1, glue: 0.4 }, { snare: { echo: 0.6, space: 0.7 }, rim: { echo: 0.7 } }),
  kitOf("breaks", "Breaks", "Punchy and squashed, like a sampled break", "lofi",
    ["kick.tight", "snare.crack", "clap.909", "hat.noise", "open.808", "tom.909", "rim.909", "shaker.tamb", "bell.ride"],
    { space: 0.2, size: 0.35, grit: 0.8, color: "tape", glue: 0.75, human: 0.1, sampler: "sp" }),
  kitOf("analog", "Analog", "Circuit-accurate 808: booming kick, snappy snare, cowbell", "808",
    ["kick.808long", "snare.808", "clap.808", "hat.808", "open.808", "tom.808", "rim.808", "shaker.808", "bell.808cym"],
    { grit: 0.45, color: "console", level: 0.65, verb: "plate", space: 0.25, size: 0.45, glue: 0.4 }),
  kitOf("mallets", "Mallets", "Soft hits, marimba and sleigh bells in a long hall", "box",
    ["kick.soft", "snare.soft", "clap.soft", "hat.soft", "open.swell", "tom.conga", "rim.woodlo", "shaker.sleigh", "bell.marimba"],
    { grit: 0.2, verb: "hall", space: 0.6, size: 0.85, echo: 0.15, tone: -0.2, glue: 0.3, human: 0.15, noise: "room", noiseAmt: 0.2 }),
  kitOf("boombap", "Boom Bap", "Round kick and a cracking snare off a sampler, warmed by valves", "lofi",
    ["kick.round", "snare.crack", "clap.dry", "hat.dusty", "open.dusty", "tom.dusty", "rim.sidestick", "shaker.egg", "bell.vibes"],
    { grit: 0.7, color: "tube", space: 0.15, size: 0.3, tone: -0.2, glue: 0.65, human: 0.15, sampler: "sp", noise: "vinyl", noiseAmt: 0.2 }),
  kitOf("garage", "Garage", "A live kit in a small room, the microphones overdriven", "linn",
    ["kick.tight", "snare.crack", "clap.crowd", "hat.acoustic", "open.sizzle", "tom.floor", "rim.sidestick", "shaker.tamb", "bell.crash"],
    { grit: 0.55, color: "crunch", blend: 0.6, space: 0.4, size: 0.55, glue: 0.7, human: 0.25 }),
  kitOf("funk", "Funk", "Tight and dry: piccolo snare, crisp hats, a cowbell", "linn",
    ["kick.tight", "snare.piccolo", "clap.dry", "hat.acoustic", "open.half", "tom.rack", "rim.sidestick", "shaker.cabasa", "bell.808"],
    { grit: 0.55, color: "console", space: 0.12, size: 0.3, glue: 0.5, human: 0.2 }),
  kitOf("disco", "Disco", "Round kick, tight snare, sizzling open hats, on tape", "linn",
    ["kick.round", "snare.tight", "clap.909", "hat.acoustic", "open.disco", "tom.syn", "rim.sidestick", "shaker.tamb", "bell.808"],
    { grit: 0.6, color: "tape", verb: "plate", space: 0.3, size: 0.45, glue: 0.5, human: 0.1 }),
  kitOf("jazz", "Jazz Club", "Sticks on a small kit: the ride cymbal is on the Hat row, the hi-hat foot on Shake", "box",
    ["kick.felt", "snare.acoustic", "clap.snap", "bell.ride", "open.half", "tom.rack", "rim.sidestick", "hat.pedal", "bell.ridebell"],
    { grit: 0.3, color: "console", space: 0.3, size: 0.45, tone: -0.1, glue: 0.3, human: 0.35 }, { kick: { tone: 0.25, decay: 0.55, level: 0.6 }, snare: { level: 0.6 } }),
  kitOf("metal", "Metal", "Clicky kick, cracking snare, china cymbal; clipped hard", "linn",
    ["kick.click", "snare.crack", "clap.crunch", "hat.metal", "open.sizzle", "tom.floor", "rim.tink", "shaker.tamb", "bell.china"],
    { grit: 0.7, color: "clip", space: 0.25, size: 0.4, tone: 0.15, glue: 0.8, human: 0.1 }),
  kitOf("hands", "Hand Drums", "Congas, bongos, claves, guiro and agogo", "box",
    ["kick.felt", "snare.modal", "clap.snap", "hat.pedal", "open.half", "tom.conga", "rim.claves", "shaker.guiro", "bell.agogo"],
    { grit: 0.3, color: "console", space: 0.25, size: 0.45, glue: 0.35, human: 0.3 }),
];

export const kitFrom = (b: Beat, id: string, name: string): UserKit => ({ id, name, kit: b.kit, voices: { ...b.voices }, sounds: JSON.parse(JSON.stringify(b.sounds)), fx: fxOf(b) });
/** Switch machine. Your knob settings stay; drums that borrowed another machine's voice go back to the kit's own. */
export const applyKit = (b: Beat, kit: KitId): Beat => ({ ...b, kit, voices: {}, userKit: null });
export const applyUserKit = (b: Beat, k: UserKit): Beat => ({ ...b, ...k.fx, kit: k.kit, voices: { ...k.voices }, sounds: JSON.parse(JSON.stringify(k.sounds)), userKit: k.id });

export function reviveUserKits(raw: unknown): UserKit[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is UserKit => !!k && typeof k === "object" && typeof (k as UserKit).id === "string" && typeof (k as UserKit).name === "string" && !!(k as UserKit).sounds)
    .map((k) => ({ ...k, voices: k.voices ?? {}, fx: reviveFx(k.fx ?? {}) }));
}

/** The rhythm a new idea starts with: a slow heartbeat, whatever order the library is in. */
const FIRST = BEAT_LIBRARY.find((p) => p.id === "dream-heartbeat") ?? BEAT_LIBRARY[0];
export const DEFAULT_BEAT: Beat = {
  on: false,
  kit: "box",
  patternId: FIRST.id,
  name: FIRST.name,
  steps: FIRST.steps,
  div: FIRST.div,
  swing: 0,
  level: 0.8,
  space: 0.25,
  grit: FX_DEFAULTS.grit,
  color: FX_DEFAULTS.color,
  blend: FX_DEFAULTS.blend,
  rows: FIRST.rows,
  sounds: {},
};

const DEFAULT_KIT_BEAT = () => DEFAULT_BEAT;
/** A drum sound loaded from storage, made safe. */
export function reviveKit(raw: unknown): DrumKit | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = reviveBeat({ ...DEFAULT_BEAT, ...(raw as object), on: false, steps: DEFAULT_BEAT.steps, div: DEFAULT_BEAT.div, bars: 1, rows: DEFAULT_BEAT.rows });
  return b ? kitOfBeat(b) : undefined;
}

/** Load a library rhythm into a beat. The kit, sound settings and effects stay as they are. */
export function applyPattern(beat: Beat, p: BeatPattern): Beat {
  return { ...beat, on: true, patternId: p.id, name: p.name, edited: false, steps: p.steps, div: p.div, bars: p.bars ?? 1, swing: p.swing, rows: p.rows };
}

/** Beats (quarter notes) in one bar of this rhythm. */
export const barBeats = (b: { steps: number; div: number }) => b.steps / b.div;
/**
 * How many times a section's chords play so the drum pattern can finish: a 4-bar beat under
 * 2 bars of chords plays the chords twice. The same goes for a melody longer than the chords.
 * With the drums off, or nothing longer than the chords, once.
 */
export function chordRounds(chordBeats: number, b: Beat | undefined | null, tuneBeats = 0): number {
  if (chordBeats <= 0) return 1;
  const drums = b?.on ? barBeats(b) * barsOf(b) : 0;
  return Math.max(1, Math.ceil(Math.max(drums, tuneBeats) / chordBeats - 1e-6));
}

/** Bars in the pattern. */
export const barsOf = (b: { bars?: number }) => Math.max(1, Math.min(MAX_BARS, Math.round(b.bars ?? 1)));
/** Grid steps in the whole pattern, all bars. */
export const lenOf = (b: { steps: number; bars?: number }) => b.steps * barsOf(b);
export const MAX_BARS = 32;

/** The rhythm on its own (a section keeps it apart from the kit: see song/structure's Settings). */
export const GROOVE_KEYS = ["patternId", "name", "edited", "steps", "div", "bars", "swing", "rows"] as const;
/** A section's drum rhythm: the pattern, and whether the drums play at all there. */
export type Groove = Pick<Beat, (typeof GROOVE_KEYS)[number]> & { on?: boolean };
export const grooveOf = (b: Beat): Groove => ({ patternId: b.patternId, name: b.name, edited: !!b.edited, steps: b.steps, div: b.div, bars: barsOf(b), swing: b.swing, rows: b.rows, on: b.on });
export const sameGroove = (a: Groove | undefined, b: Groove | undefined): boolean =>
  !!a && !!b && a.patternId === b.patternId && a.name === b.name && !!a.edited === !!b.edited && a.steps === b.steps && a.div === b.div && barsOf(a) === barsOf(b) && a.swing === b.swing && (a.on ?? null) === (b.on ?? null) && DRUM_IDS.every((d) => a.rows[d] === b.rows[d]);

/** The drum sound: the machine, each drum's own sound, the mix and the effects. Everything about a beat that is not its rhythm. */
export type DrumKit = Omit<Beat, (typeof GROOVE_KEYS)[number] | "on">;
export function kitOfBeat(b: Beat): DrumKit {
  const { patternId: _p, name: _n, edited: _e, steps: _s, div: _d, bars: _b, swing: _w, rows: _r, on: _o, ...kit } = b;
  return kit;
}
/** A beat's rhythm and on/off played on another kit: all of the kit is that one's (nothing of its own kit is kept). */
export function onKit(b: Beat, kit: DrumKit): Beat {
  const rhythm = Object.fromEntries(Object.entries(b).filter(([k]) => k === "on" || (GROOVE_KEYS as readonly string[]).includes(k)));
  return { ...kit, ...rhythm } as Beat;
}
/** A drum sound as one string, the same for the same sound (a missing effect setting is its default). */
export const kitSig = (k: DrumKit): string => {
  const full = { ...kitOfBeat(DEFAULT_KIT_BEAT()), ...k, ...fxOf(k), voices: k.voices ?? {}, mutes: [...(k.mutes ?? [])].sort(), userKit: k.userKit ?? null };
  return JSON.stringify(Object.entries(full).sort(([a], [b]) => (a < b ? -1 : 1)));
};

/**
 * Make the pattern longer or shorter. New bars start as a copy of the last bar, so the beat carries
 * on and you only change what should be different.
 */
export function setBars(beat: Beat, n: number): Beat {
  const to = Math.max(1, Math.min(MAX_BARS, Math.round(n)));
  const from = barsOf(beat);
  if (to === from) return beat;
  const rows = {} as Record<DrumId, string>;
  for (const id of DRUM_IDS) {
    const r = (beat.rows[id] ?? "").padEnd(beat.steps * from, "0").slice(0, beat.steps * from);
    const last = r.slice((from - 1) * beat.steps);
    rows[id] = to < from ? r.slice(0, to * beat.steps) : r + last.repeat(to - from);
  }
  return { ...beat, bars: to, rows, edited: true };
}

/**
 * One bar of the rhythm as it plays in a section: a pattern shorter than the section comes round
 * again, so bar 5 of a two-bar pattern is its first bar.
 */
export const patternBar = (beat: { bars?: number }, bar: number) => ((bar % barsOf(beat)) + barsOf(beat)) % barsOf(beat);

/**
 * Write the rhythm out over a whole section, bar for bar, so that each bar can be changed (or
 * emptied) on its own. Nothing sounds different until a bar is changed.
 */
export function spreadBeat(beat: Beat, bars: number): Beat {
  const to = Math.max(1, Math.min(MAX_BARS, Math.round(bars)));
  const from = barsOf(beat);
  if (to <= from) return beat;
  const rows = {} as Record<DrumId, string>;
  for (const id of DRUM_IDS) {
    const r = (beat.rows[id] ?? "").padEnd(beat.steps * from, "0").slice(0, beat.steps * from);
    rows[id] = r.repeat(Math.ceil(to / from)).slice(0, to * beat.steps);
  }
  return { ...beat, bars: to, rows };
}

/** Does a bar of the rhythm have any hits in it? */
export function barHasHits(beat: Beat, bar: number): boolean {
  const b = patternBar(beat, bar);
  return DRUM_IDS.some((id) => /[1-9]/.test((beat.rows[id] ?? "").slice(b * beat.steps, (b + 1) * beat.steps)));
}

/** Take out one bar of the pattern (never the last one left). */
export function removeBar(beat: Beat, bar: number): Beat {
  const n = barsOf(beat);
  if (n <= 1 || bar < 0 || bar >= n) return beat;
  const rows = {} as Record<DrumId, string>;
  for (const id of DRUM_IDS) {
    const r = (beat.rows[id] ?? "").padEnd(beat.steps * n, "0");
    rows[id] = r.slice(0, bar * beat.steps) + r.slice((bar + 1) * beat.steps, n * beat.steps);
  }
  return { ...beat, bars: n - 1, rows, edited: true };
}

/** Copy one bar over another. */
export function copyBar(beat: Beat, from: number, to: number): Beat {
  const n = barsOf(beat);
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return beat;
  const rows = {} as Record<DrumId, string>;
  for (const id of DRUM_IDS) {
    const r = (beat.rows[id] ?? "").padEnd(beat.steps * n, "0");
    rows[id] = r.slice(0, to * beat.steps) + r.slice(from * beat.steps, (from + 1) * beat.steps) + r.slice((to + 1) * beat.steps);
  }
  return { ...beat, rows, edited: true };
}

export const levelAt = (rows: Record<DrumId, string>, id: DrumId, step: number): StepLevel => (Number(rows[id]?.[step] ?? 0) || 0) as StepLevel;
/** A step as it is heard: a drum muted in its kit plays nothing (what plays it, and what draws it, both ask this). */
export const heardAt = (b: Pick<Beat, "rows" | "mutes">, id: DrumId, step: number): StepLevel => (b.mutes?.includes(id) ? 0 : levelAt(b.rows, id, step));

export function setStep(beat: Beat, id: DrumId, step: number, level: StepLevel): Beat {
  const len = lenOf(beat);
  const cur = (beat.rows[id] ?? emptyRow(len)).padEnd(len, "0");
  if (step < 0 || step >= len || Number(cur[step]) === level) return beat;
  return { ...beat, edited: true, rows: { ...beat.rows, [id]: cur.slice(0, step) + level + cur.slice(step + 1) } };
}

/** Empty the whole pattern, or just one bar of it. */
export function clearBeat(beat: Beat, bar?: number): Beat {
  if (bar === undefined) return { ...beat, edited: true, rows: emptyRows(lenOf(beat)) };
  const rows = {} as Record<DrumId, string>;
  for (const id of DRUM_IDS) {
    const r = (beat.rows[id] ?? "").padEnd(lenOf(beat), "0");
    rows[id] = r.slice(0, bar * beat.steps) + "0".repeat(beat.steps) + r.slice((bar + 1) * beat.steps);
  }
  return { ...beat, edited: true, rows };
}

/** Time of a step inside the bar, in beats, including swing (which delays every second 16th). */
export function stepBeat(step: number, div: number, swing: number): number {
  const late = div % 2 === 0 && step % 2 === 1 ? swing / (3 * div) : 0;
  return step / div + late;
}

/** A small random variation (in one bar, or the first): nudges kicks, adds ghost notes, opens a hat. Keeps the feel. */
export function varyBeat(beat: Beat, rand: () => number = Math.random, bar = 0): Beat {
  const pick = (n: number) => Math.floor(rand() * n);
  let b = beat;
  const onBeat = (s: number) => s % beat.div === 0;
  const moves = 2 + pick(2);
  const at = Math.min(bar, barsOf(beat) - 1) * beat.steps;
  for (let m = 0; m < moves; m++) {
    const s = at + pick(beat.steps);
    const kind = pick(4);
    if (kind === 0 && !onBeat(s)) b = setStep(b, "kick", s, levelAt(b.rows, "kick", s) ? 0 : 2);
    else if (kind === 1 && !levelAt(b.rows, "snare", s)) b = setStep(b, "snare", s, 1);
    else if (kind === 2) {
      const id: DrumId = /[123]/.test(b.rows.hat) ? "hat" : /[123]/.test(b.rows.shaker) ? "shaker" : "hat";
      const cur = levelAt(b.rows, id, s);
      b = setStep(b, id, s, cur === 0 ? 1 : cur === 1 ? 2 : onBeat(s) ? 2 : 0);
    } else if (kind === 3 && !onBeat(s)) {
      b = setStep(b, "open", s, levelAt(b.rows, "open", s) ? 0 : 2);
      if (levelAt(b.rows, "open", s)) b = setStep(b, "hat", s, 0);
    }
  }
  const end = at + beat.steps - 1;
  return b === beat ? setStep(beat, "snare", end, levelAt(beat.rows, "snare", end) ? 0 : 1) : b;
}

export interface DrumHit {
  /** beats from the start */
  beat: number;
  id: DrumId;
  velocity: number;
}

/** Every drum hit in `totalBeats` of this rhythm (the pattern repeats). Shared by playback tests and MIDI export. */
export function beatHits(b: Beat, totalBeats: number): DrumHit[] {
  return beatHitsBetween(b, 0, totalBeats);
}

/** Drum hits from `from` up to (not including) `to`, in beats from the start of the pattern. */
export function beatHitsBetween(b: Beat, from: number, to: number): DrumHit[] {
  const out: DrumHit[] = [];
  const len = lenOf(b);
  const first = Math.ceil(from * b.div - 1e-6);
  const end = Math.ceil(to * b.div - 1e-6);
  for (let n = first; n < end; n++) {
    const step = n % len;
    for (const id of DRUM_IDS) {
      const lv = heardAt(b, id, step);
      if (lv) out.push({ beat: stepBeat(n, b.div, b.swing), id, velocity: STEP_VELOCITY[lv] });
    }
  }
  return out;
}

/** Check the rhythm fields of a stored beat or groove. Returns null when they make no sense. */
function cleanRhythm(b: Partial<Beat>): Pick<Beat, "steps" | "div" | "bars" | "rows"> | null {
  const steps = Number(b.steps);
  const div = Number(b.div);
  if (!Number.isInteger(steps) || steps < 1 || steps > 32 || !Number.isInteger(div) || div < 1 || !b.rows || typeof b.rows !== "object") return null;
  const bars = barsOf({ bars: Number(b.bars) || 1 });
  const len = steps * bars;
  const rows = emptyRows(len);
  for (const id of DRUM_IDS) {
    const r = (b.rows as Record<string, unknown>)[id];
    if (typeof r === "string") rows[id] = r.replace(/[^0-3]/g, "0").slice(0, len).padEnd(len, "0");
  }
  return { steps, div, bars, rows };
}

/** Tidy up a beat loaded from storage (older or partial data). */
export function reviveBeat(raw: unknown): Beat | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = raw as Partial<Beat>;
  const rhythm = cleanRhythm(b);
  if (!rhythm) return undefined;
  const kit: KitId = KITS.some((k) => k.id === b.kit) ? (b.kit as KitId) : DEFAULT_BEAT.kit;
  const voices = Object.fromEntries(Object.entries(b.voices ?? {}).filter(([d, v]) => (DRUM_IDS as string[]).includes(d) && knownVoice(v)));
  const fx = reviveFx(b);
  return { ...DEFAULT_BEAT, ...b, ...fx, kit, ...rhythm, sounds: b.sounds ?? {}, voices };
}

/** Tidy up a section's stored rhythm. */
export function reviveGroove(raw: unknown): Groove | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const g = raw as Partial<Groove>;
  const rhythm = cleanRhythm(g);
  if (!rhythm) return undefined;
  return { patternId: typeof g.patternId === "string" ? g.patternId : null, name: typeof g.name === "string" ? g.name : "Beat", edited: !!g.edited, swing: Number(g.swing) || 0, ...rhythm, ...(typeof g.on === "boolean" ? { on: g.on } : {}) };
}
