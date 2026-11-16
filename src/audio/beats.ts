/**
 * Drum beats: the step-grid format, the rhythm library and the helpers shared by
 * playback, the editor and MIDI export.
 *
 * A beat is one or more bars. `steps` is the number of grid steps in one bar and `div` the
 * number of steps per beat, so 4/4 in 16ths is 16 × 4, a 12/8 shuffle is 12 × 3
 * and a 3/4 waltz is 12 × 4. Each drum's row holds `steps × bars` characters.
 */
import { DRUM_IDS, KITS, SAMPLERS, defaultParams, isMachine, type DrumId, type DrumParams, type KitId, type SamplerId, type VoiceId } from "./drums";
import { getRecipe } from "./voices";

export type BeatGroupId = "dream" | "indie" | "dark" | "box" | "808" | "rock" | "slow" | "world";

export const BEAT_GROUPS: { id: BeatGroupId; name: string }[] = [
  { id: "dream", name: "Dream pop" },
  { id: "indie", name: "Lo-fi indie" },
  { id: "dark", name: "Dark & electronic" },
  { id: "box", name: "Organ presets" },
  { id: "808", name: "808" },
  { id: "rock", name: "Rock & pop" },
  { id: "slow", name: "6/8 & shuffle" },
  { id: "world", name: "World" },
];

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
  /** saturation 0…1 */
  grit: number;
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

type Short = Partial<Record<"K" | "S" | "C" | "H" | "O" | "T" | "R" | "Sh" | "B", string>>;
const KEYS: Record<keyof Short, DrumId> = { K: "kick", S: "snare", C: "clap", H: "hat", O: "open", T: "tom", R: "rim", Sh: "shaker", B: "bell" };

function P(group: BeatGroupId, name: string, bpm: number, r: Short, o: { steps?: number; div?: number; swing?: number } = {}): BeatPattern {
  const steps = o.steps ?? 16;
  const rows = emptyRows(steps);
  for (const k of Object.keys(r) as (keyof Short)[]) rows[KEYS[k]] = row(r[k], steps);
  return { id: `${group}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, group, steps, div: o.div ?? 4, bpm, swing: o.swing ?? 0, rows };
}

const T12 = { steps: 12, div: 3 }; // four beats of triplets (12/8)
const W34 = { steps: 12, div: 4 }; // three beats of 16ths (3/4)
const E8 = "x.x.x.x.x.x.x.x."; // straight 8ths
const E8s = "x.o.x.o.x.o.x.o."; // 8ths, leaning on the beat
const S16 = "xoxoxoxoxoxoxoxo"; // 16ths
const BACK = "....x.......x..."; // 2 and 4

export const BEAT_LIBRARY: BeatPattern[] = [
  // ── Dream pop: slow, sparse, a heartbeat under the chords ──
  P("dream", "Heartbeat", 72, { K: "x..o....x..o....", R: BACK, H: "o.o.o.o.o.o.o.o." }),
  P("dream", "Slow drift", 68, { K: "x.........x.....", S: "........x.......", H: E8s, Sh: "..o...o...o...o." }),
  P("dream", "Halo", 84, { K: "x.....x.x.......", S: BACK, H: E8, Sh: BACK }),
  P("dream", "Tick-tock", 76, { K: "x.......x.......", R: BACK, H: E8s }),
  P("dream", "Night drive", 104, { K: "x...x...x...x...", S: BACK, H: "..x...x...x...x." }),
  P("dream", "Bloom", 90, { K: "x.......x.x.....", S: BACK, Sh: E8, O: "..............x." }),
  P("dream", "Velvet", 80, { K: "x..x..x...x.....", S: BACK, H: E8s }),
  P("dream", "Starlight", 96, { K: "x.........x.....", S: BACK, H: "xoxoxoxoxoxoxox.", O: "...............o" }),
  P("dream", "Underwater", 64, { K: "x......x........", S: "........x.......", T: "..............o.", H: "o...o...o...o...", Sh: "..o...o...o...o." }),
  P("dream", "Organ pulse", 88, { K: "x...x...x...x...", R: "..x...x...x...x.", Sh: S16 }),
  P("dream", "Float", 70, { K: "x.........x.....", S: BACK, H: "o.x.o.x.o.x.o.x." }),
  P("dream", "Lullaby", 60, { K: "x.....x.....", R: "...x.....x..", Sh: "x.ox.ox.ox.o" }, T12),
  P("dream", "Slow sway", 56, { K: "x.....x..x..", S: "...x.....x..", H: "xooxooxooxoo" }, T12),
  P("dream", "Slow waltz", 90, { K: "x...........", R: "....x...x...", H: "o.o.o.o.o.o." }, W34),

  // ── Lo-fi indie: simple, driving, bedroom drum machine ──
  P("indie", "Bedroom", 110, { K: "x.....x.x.......", S: BACK, H: E8 }),
  P("indie", "Driving 8ths", 140, { K: "x...x...x...x...", S: BACK, H: E8 }),
  P("indie", "Motorik", 150, { K: "x...x.x.x...x.x.", S: BACK, H: E8 }),
  P("indie", "Post-punk", 132, { K: "x.......x.x.....", S: BACK, H: S16 }),
  P("indie", "New wave", 124, { K: "x...x...x...x...", S: BACK, C: BACK, H: "..x...x...x...x." }),
  P("indie", "Jangle", 118, { K: "x..x....x.x.....", S: BACK, Sh: "o.o.x.o.o.o.x.o." }),
  P("indie", "Surf", 160, { K: "x.......x.......", S: "....x.x.....x...", H: E8 }),
  P("indie", "Garage stomp", 126, { K: "x...x...x...x...", S: BACK, T: "..............x.", H: "x...x...x...x..." }),
  P("indie", "Sad dance", 116, { K: "x...x...x...x...", C: BACK, H: "..x...x...x...x.", R: "...x..x....x..x." }),
  P("indie", "Tape hiss", 92, { K: "x..x....x.......", S: BACK, H: "x.x.x.x.x.x.x.xx" }),
  P("indie", "Half-speed", 100, { K: "x.........x.....", S: "........x.......", H: E8 }),
  P("indie", "Runner", 168, { K: "x.....x.x.....x.", S: BACK, H: E8 }),
  P("indie", "Cold wave", 120, { K: "x.....x...x.....", S: BACK, C: "............x...", H: S16 }),
  P("indie", "Floor tom", 112, { K: "x...x...x...x...", S: BACK, T: "o.o.o.o.o.o.o.o." }),

  P("indie", "Seaside", 112, { K: "x..x..x...x.x...", S: BACK, R: "..x......x......", H: E8s }),
  P("indie", "Skip", 126, { K: "x.....x..x......", S: BACK, Sh: S16, R: "..........x....." }),

  // ── Dark & electronic: cold drum machines, dance floors and broken clocks ──
  P("dark", "Cold disco", 124, { K: "x...x...x...x...", C: BACK, H: "o.x.o.x.o.x.o.x." }),
  P("dark", "Pulse", 118, { K: "x...x...x...x...", S: BACK, H: S16, R: "..x..x....x..x.." }),
  P("dark", "Leather", 110, { K: "x..x..x.x..x..x.", S: BACK, H: E8 }),
  P("dark", "Basement", 128, { K: "x...x...x...x...", S: "....x.......x.x.", O: "..x...x...x...x.", T: "..............o." }),
  P("dark", "Tower block", 156, { K: "x.x...x.x.x...x.", S: BACK, H: S16 }),
  P("dark", "Concrete", 144, { K: "x.....x.x.....x.", S: BACK, C: "............x...", H: E8 }),
  P("dark", "Night tram", 162, { K: "x...x...x...x...", S: BACK, H: "x.xxx.xxx.xxx.xx" }),
  P("dark", "Grey sky", 132, { K: "x.....x.x.x.....", S: BACK, H: S16, T: "..............xx" }),
  P("dark", "Broken clock", 136, { K: "x..x......x..x..", S: "....x..x.o..x...", H: "x.xx.xxx.x.xx.xx", R: "..x......x....x." }),
  P("dark", "Static", 152, { K: "x.....x..x.x....", S: "....x.......x..x", H: "xxoxxxoxxoxxxoxx", C: ".......x........", B: "..........o....." }),
  P("dark", "Stutter", 128, { K: "x.x......xx.....", S: "....x.....o.x...", H: "x.x.xxx.x.x.xxxx", T: "...............o" }),
  P("dark", "Ice", 100, { K: "x......x..x.....", C: BACK, R: "..x..x...x...x..", H: "o.o.o.o.oooooo.o" }),
  P("dark", "Signal", 140, { K: "x...x...x...x...", H: "..x...x...x...x.", B: "x..x..x..x..x..x", S: "............x..." }),

  // ── Organ presets: the rhythm buttons on old organs and rhythm boxes ──
  P("box", "Rock 1", 110, { K: "x.......x.x.....", S: BACK, H: E8 }),
  P("box", "Rock 2", 120, { K: "x..x....x..x....", S: BACK, H: E8 }),
  P("box", "Slow rock", 66, { K: "x.....x.....", S: "...x.....x..", H: "xooxooxooxoo" }, T12),
  P("box", "Ballad", 72, { K: "x.....x.x.......", R: BACK, H: "o.o.o.o.o.o.o.o." }),
  P("box", "Waltz", 96, { K: "x...........", S: "....x...x...", H: "x...x...x..." }, W34),
  P("box", "Bossa nova", 120, { K: "x.....x.x.....x.", R: "x..x..x...x..x..", H: E8 }),
  P("box", "Rhumba", 104, { K: "x.....x.x.......", R: "x..x..x...x.x...", T: "....o.o.....o.o.", Sh: "o.o.o.o.o.o.o.o." }),
  P("box", "Beguine", 108, { K: "x.....x.x.....x.", S: "..x.x.....x.x...", H: E8 }),
  P("box", "Samba", 104, { K: "x..xx..xx..xx..x", R: "x.x..x.x.x..x.x.", Sh: "xooxxooxxooxxoox" }),
  P("box", "Cha-cha", 116, { K: "x.......x.......", B: "x...x...x...x...", T: "............x.x.", R: BACK, Sh: "x.xxx.xxx.xxx.xx" }),
  P("box", "Tango", 112, { K: "x...x...x...x...", S: "....x.......x.xx" }),
  P("box", "Mambo", 116, { K: "x.....x.x.....x.", B: "x...x.x.x.x.x.x.", R: "..x...x...x...x." }),
  P("box", "Foxtrot", 120, { K: "x.......x.......", S: BACK, H: "x...x.x.x...x.x." }, { swing: 0.7 }),
  P("box", "Disco", 120, { K: "x...x...x...x...", S: BACK, H: "x...x...x...x...", O: "..x...x...x...x." }),
  P("box", "March", 112, { K: "x...x...x...x...", S: "o..xo..xo.x.x.xx" }),
  P("box", "Swing", 132, { K: "x.....x.....", R: "...x.....x..", H: "x..x.xx..x.x" }, T12),
  P("box", "Shuffle", 112, { K: "x.....x.....", S: "...x.....x..", H: "x.xx.xx.xx.x" }, T12),
  P("box", "Boogie", 126, { K: "x..x..x..x..", S: "...x.....x..", H: "x.xx.xx.xx.x" }, T12),

  // ── 808 ──
  P("808", "Electro", 124, { K: "x.....x...x.....", S: BACK, H: "x.xxx.xxx.xxx.xx" }),
  P("808", "Boom bap", 90, { K: "x.....x.x..x....", S: BACK, H: E8 }, { swing: 0.4 }),
  P("808", "Half-time trap", 140, { K: "x.....x...x.....", C: "........x.......", H: "x.x.x.x.x.x.xxxx" }),
  P("808", "Slow jam", 72, { K: "x......x..x.....", C: BACK, H: E8, R: "..x......x......" }),
  P("808", "Miami", 128, { K: "x..x..x...x.x...", S: BACK, H: E8, B: "..x...x...x...x." }),
  P("808", "Deep", 64, { K: "x..........x....", C: "........x.......", H: "x...x...x...x.x." }),
  P("808", "Bounce", 100, { K: "x..x....x.x.....", C: BACK, H: S16, O: "..............x." }),
  P("808", "Synth-pop", 118, { K: "x...x...x...x...", S: BACK, C: BACK, H: E8 }),
  P("808", "Cowbell groove", 108, { K: "x.....x.x.x.....", S: BACK, H: E8, B: "x.xx.x.xx.xx.x.." }),
  P("808", "Slow 12/8", 62, { K: "x....xx.....", C: "...x.....x..", H: "xooxooxooxoo" }, T12),

  // ── Rock & pop ──
  P("rock", "Backbeat", 100, { K: "x.......x.......", S: BACK, H: E8 }),
  P("rock", "Classic rock", 116, { K: "x.....x.x.x.....", S: BACK, H: E8, O: "..............x." }),
  P("rock", "Four on the floor", 122, { K: "x...x...x...x...", S: BACK, H: "x...x...x...x...", O: "..x...x...x...x." }),
  P("rock", "Half-time", 80, { K: "x.....x.......x.", S: "........x.......", H: E8 }),
  P("rock", "Funk", 100, { K: "x..x......x..x..", S: "....x..o.o..x..o", H: S16 }),
  P("rock", "Train", 128, { K: "x...x...x...x...", S: "o.ooX.ooo.ooX.oo" }),
  P("rock", "Punk", 176, { K: "x.x.....x.x.....", S: BACK, H: E8 }),
  P("rock", "Indie dance", 124, { K: "x...x...x...x...", S: BACK, C: BACK, H: "x.xxx.xxx.xxx.xx", O: "..x...x...x...x." }),
  P("rock", "Two-step", 130, { K: "x.........x.....", S: BACK, H: "x.xxx.xxx.xxx.xx" }),
  P("rock", "Stomp clap", 96, { K: "x.x.....x.x.....", C: BACK }),
  P("rock", "Big ballad", 66, { K: "x.......x.x.....", S: BACK, H: E8, T: "..............oo" }),
  P("rock", "Tom groove", 104, { K: "x.....x.x.......", S: BACK, T: "..x...x...x.x.x." }),
  P("rock", "Shaker pop", 108, { K: "x..x....x.x.....", C: BACK, Sh: S16 }),
  P("rock", "Anthem", 132, { K: "x..x..x.x..x..x.", S: BACK, C: BACK, T: "..x...x...x...xx" }),
  P("rock", "Stampede", 150, { K: "x...x...x...x...", S: BACK, T: "x.x.x.x.x.x.x.x.", Sh: S16 }),
  P("rock", "Sixteenths", 92, { K: "x.....x.x.......", S: BACK, H: S16 }),

  // ── 6/8, 12/8, waltz and shuffle ──
  P("slow", "12/8 ballad", 60, { K: "x.....x..x..", S: "...x.....x..", H: "xooxooxooxoo" }, T12),
  P("slow", "Doo-wop", 70, { K: "x....xx.....", S: "...x.....x..", H: "xxxxxxxxxxxx" }, T12),
  P("slow", "Blues shuffle", 96, { K: "x..x..x..x..", S: "...x.....x..", H: "x.xx.xx.xx.x" }, T12),
  P("slow", "Slow blues", 58, { K: "x.....x....x", S: "...x.....x..", H: "xooxooxooxoo" }, T12),
  P("slow", "Half-time shuffle", 88, { K: "x.......x...", S: "......x.....", H: "x.ox.ox.ox.o" }, T12),
  P("slow", "Tide", 66, { K: "x....x......", S: "......x.....", H: "x.xx.xx.xx.x" }, T12),
  P("slow", "6/8 sway", 54, { K: "x.....", S: "...x..", H: "xooxoo" }, { steps: 6, div: 3 }),
  P("slow", "Waltz, soft", 84, { K: "x...........", S: "....o...o...", H: "o.o.o.o.o.o." }, W34),
  P("slow", "Jazz waltz", 132, { K: "x...........", R: "....x...x...", H: "x...x.x.x..." }, { ...W34, swing: 0.7 }),
  P("slow", "Folk waltz", 108, { K: "x...........", R: "....x...x...", Sh: "x.x.x.x.x.x." }, W34),

  // ── World ──
  P("world", "One drop", 72, { K: "........x.......", R: "........x.......", H: "o.x.o.x.o.x.o.x." }),
  P("world", "Rockers", 76, { K: "x...x...x...x...", S: "........x.......", H: "o.x.o.x.o.x.o.x." }),
  P("world", "Afrobeat", 112, { K: "x..x....x.x..x..", S: "....x..x....x...", H: "x.xxx.xxx.xxx.xx" }),
  P("world", "Tresillo", 100, { K: "x..x..x.x..x..x.", C: BACK, H: E8 }),
  P("world", "Dembow", 96, { K: "x...x...x...x...", S: "...x..x....x..x.", H: E8 }),
  P("world", "Cumbia", 92, { K: "x...x...x...x...", B: "..x...x...x...x.", Sh: "x.xxx.xxx.xxx.xx" }),
  P("world", "Bolero", 84, { K: "x.......x.....x.", S: "x.oox.x.x.x.x.x.", Sh: "o.o.o.o.o.o.o.o." }),
  P("world", "Highlife", 116, { K: "x.....x.x.....x.", B: "x.x.xx.x.x.xx.x.", R: "....x.......x..." }),
  P("world", "Second line", 104, { K: "x..x..x...x.x...", S: "..o.x.o...o.x.oo" }, { swing: 0.5 }),
  P("world", "Afro-Cuban 6/8", 104, { K: "x.....x.....", B: "x.x.xx.x.x.x", T: "...o.o...o.o" }, T12),
];

export const findPattern = (id: string | null | undefined, mine: BeatPattern[] = []): BeatPattern | undefined =>
  id ? (BEAT_LIBRARY.find((p) => p.id === id) ?? mine.find((p) => p.id === id)) : undefined;

export const FX_DEFAULTS: BeatFx = { level: 0.8, space: 0.25, size: 0.45, echo: 0, echoTime: "1/8.", grit: 0.1, tape: 0, tone: 0, glue: 0.3, human: 0, verb: "room", sampler: "off", noise: "off", noiseAmt: 0.3, pump: 0 };
const FX_KEYS = Object.keys(FX_DEFAULTS) as (keyof BeatFx)[];

/** The beat's effect settings, with defaults for anything an older beat does not have. */
export function fxOf(b: Partial<BeatFx>): BeatFx {
  const out = { ...FX_DEFAULTS } as Record<keyof BeatFx, number | string>;
  for (const k of FX_KEYS) if (b[k] !== undefined) out[k] = b[k] as number | string;
  return out as unknown as BeatFx;
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
  { id: "clean", name: "Clean", hint: "Dry and clear", fx: vibe({ space: 0.12, size: 0.3 }) },
  { id: "dreamy", name: "Dreamy", hint: "A long plate, soft echo, slightly dark and wobbly", fx: vibe({ verb: "plate", space: 0.55, size: 0.8, echo: 0.22, tape: 0.35, tone: -0.25, glue: 0.35, noise: "tape", noiseAmt: 0.15 }) },
  { id: "cassette", name: "Cassette", hint: "Warm, dull and wobbly, with hiss", fx: vibe({ space: 0.2, size: 0.4, grit: 0.4, tape: 0.65, tone: -0.4, glue: 0.5, sampler: "mpc", noise: "tape", noiseAmt: 0.35 }) },
  { id: "dusty", name: "Dusty", hint: "A 12-bit sampler and a crackly record", fx: vibe({ space: 0.18, size: 0.35, grit: 0.25, tape: 0.35, tone: -0.35, glue: 0.55, sampler: "sp", noise: "vinyl", noiseAmt: 0.4 }) },
  { id: "gated", name: "Gated 80s", hint: "A big gated room that stops dead", fx: vibe({ verb: "gated", space: 0.5, size: 0.5, grit: 0.2, tone: 0.15, glue: 0.6 }) },
  { id: "big", name: "Big Room", hint: "Loud, wide and punchy", fx: vibe({ space: 0.45, size: 0.6, grit: 0.2, tone: 0.15, glue: 0.7 }) },
  { id: "crunch", name: "Crunch", hint: "Driven hard and squashed", fx: vibe({ space: 0.1, size: 0.25, grit: 0.8, tape: 0.15, tone: 0.1, glue: 0.8 }) },
  { id: "dub", name: "Dub", hint: "A spring reverb and echoes trailing off", fx: vibe({ verb: "spring", space: 0.4, size: 0.5, echo: 0.5, grit: 0.15, tape: 0.25, tone: -0.1 }) },
  { id: "pump", name: "Pump", hint: "Everything breathes with the kick", fx: vibe({ verb: "plate", space: 0.3, size: 0.5, grit: 0.3, tone: -0.1, glue: 0.65, pump: 0.6 }) },
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
    { verb: "plate", space: 0.55, size: 0.8, echo: 0.15, tape: 0.35, tone: -0.25, glue: 0.35, human: 0.12, noise: "tape", noiseAmt: 0.15 }, { open: { filter: -0.25 } }),
  kitOf("cassette", "Cassette", "A small kit recorded to a four-track: warm, wobbly, hissy", "lofi",
    ["kick.tight", "snare.acoustic", "clap.808", "hat.noise", "open.808", "tom.909", "rim.sidestick", "shaker.16th", "bell.808"],
    { space: 0.25, size: 0.4, grit: 0.35, tape: 0.6, tone: -0.35, glue: 0.55, human: 0.1, sampler: "mpc", noise: "tape", noiseAmt: 0.35 }),
  kitOf("dusty", "Dusty", "12-bit sampler, crackly record, round and soft", "lofi",
    ["kick.dusty", "snare.dusty", "clap.dusty", "hat.dusty", "open.dusty", "tom.dusty", "rim.sidestick", "shaker.egg", "bell.vibes"],
    { space: 0.18, size: 0.35, grit: 0.25, tape: 0.35, tone: -0.35, glue: 0.55, human: 0.15, sampler: "sp", noise: "vinyl", noiseAmt: 0.4 }),
  kitOf("cold", "Cold Wave", "Stiff 8-bit machine, cracking snare in a gated room", "707",
    ["kick.stiff", "snare.cold", "clap.cold", "hat.808", "open.606", "tom.cold", "rim.linn", "shaker.808", "bell.808"],
    { verb: "gated", space: 0.45, size: 0.45, grit: 0.3, tape: 0.2, tone: 0.15, glue: 0.6 }, { snare: { space: 0.8 } }),
  kitOf("dark", "Dark Club", "Hard kick, gated snare, tight hats; everything pumps", "909",
    ["kick.909hard", "snare.gated", "clap.909", "hat.909", "open.909", "tom.simmons", "rim.909", "shaker.808", "bell.clang"],
    { verb: "plate", space: 0.35, size: 0.5, echo: 0.12, echoTime: "1/8", grit: 0.35, tone: -0.2, glue: 0.65, pump: 0.5 }),
  kitOf("neon", "Neon", "Big gated snare, electronic toms, a hall and a little tape", "808",
    ["kick.909", "snare.gated", "clap.gated", "hat.808", "open.disco", "tom.simmons", "rim.808", "shaker.16th", "bell.fm"],
    { verb: "hall", space: 0.4, size: 0.6, echo: 0.15, grit: 0.2, tape: 0.3, tone: 0.1, glue: 0.55, pump: 0.35, noise: "tape", noiseAmt: 0.15 }),
  kitOf("arena", "Arena", "A real kit, hit hard, in a big room", "linn",
    ["kick.felt", "snare.acoustic", "clap.crowd", "hat.acoustic", "open.acoustic", "tom.floor", "rim.sidestick", "shaker.tamb", "bell.crash"],
    { space: 0.45, size: 0.7, grit: 0.25, tone: 0.1, glue: 0.75, human: 0.2 }, { kick: { punch: 0.7, tone: 0.6 }, snare: { punch: 0.7, decay: 0.65 } }),
  kitOf("studio", "Studio", "A real kit, close and dry", "linn",
    ["kick.felt", "snare.acoustic", "clap.crowd", "hat.acoustic", "open.acoustic", "tom.rack", "rim.sidestick", "shaker.maraca", "bell.ride"],
    { space: 0.15, size: 0.3, grit: 0.1, glue: 0.45, human: 0.25 }),
  kitOf("brushes", "Brushes", "Brushes on a snare, felt beater, a soft ride", "box",
    ["kick.felt", "snare.brush", "clap.snap", "hat.pedal", "open.half", "tom.floor", "rim.sidestick", "shaker.egg", "bell.ridebell"],
    { space: 0.25, size: 0.4, tone: -0.15, glue: 0.35, human: 0.3 }, { kick: { tone: 0.2, decay: 0.6 } }),
  kitOf("trap", "Trap", "Long sub kick, tight snare and clap, crisp hats", "808",
    ["kick.sub", "snare.tight", "clap.tight", "hat.crisp", "open.trap", "tom.808", "rim.808", "shaker.808", "bell.808"],
    { level: 0.65, space: 0.15, size: 0.3, grit: 0.2, glue: 0.5 }),
  kitOf("techno", "Techno", "Rumbling kick, 909 hats, echoes in a hall", "909",
    ["kick.rumble", "snare.909", "clap.909", "hat.909", "open.909", "tom.909", "rim.909", "shaker.16th", "bell.ride"],
    { verb: "hall", space: 0.3, size: 0.6, echo: 0.2, grit: 0.25, glue: 0.6, pump: 0.4 }),
  kitOf("industrial", "Industrial", "Distorted kick, ring-modulated snare, metal", "909",
    ["kick.industrial", "snare.industrial", "clap.crunch", "hat.grind", "open.sizzle", "tom.syn", "rim.tink", "shaker.cabasa", "bell.china"],
    { level: 0.65, verb: "dark", space: 0.3, size: 0.5, grit: 0.5, tone: -0.1, glue: 0.7 }),
  kitOf("glitch", "Glitch", "Blips, clicks and ticks, chopped by fast echoes", "mod",
    ["kick.blip", "snare.hyper", "clap.snap", "hat.tick", "open.swell", "tom.syn", "rim.tick", "shaker.cabasa", "bell.glass"],
    { space: 0.15, size: 0.25, echo: 0.35, echoTime: "1/16", grit: 0.3, glue: 0.6, sampler: "crush" }, { rim: { echo: 0.8 }, bell: { echo: 0.7 } }),
  kitOf("dub", "Dub", "Round kick, high rim snare, a spring reverb and echoes", "box",
    ["kick.round", "snare.steppers", "clap.dry", "hat.ring", "open.half", "tom.dub", "rim.dub", "shaker.16th", "bell.agogo"],
    { verb: "spring", space: 0.45, size: 0.5, echo: 0.45, tape: 0.25, tone: -0.1, glue: 0.4 }, { snare: { echo: 0.6, space: 0.7 }, rim: { echo: 0.7 } }),
  kitOf("breaks", "Breaks", "Punchy and squashed, like a sampled break", "lofi",
    ["kick.tight", "snare.crack", "clap.909", "hat.noise", "open.808", "tom.909", "rim.909", "shaker.tamb", "bell.ride"],
    { space: 0.2, size: 0.35, grit: 0.35, glue: 0.75, human: 0.1, sampler: "sp" }),
  kitOf("analog", "Analog", "Circuit-accurate 808: booming kick, snappy snare, cowbell", "808",
    ["kick.808long", "snare.808", "clap.808", "hat.808", "open.808", "tom.808", "rim.808", "shaker.808", "bell.808cym"],
    { level: 0.65, verb: "plate", space: 0.25, size: 0.45, glue: 0.4 }),
  kitOf("mallets", "Mallets", "Soft hits, marimba and sleigh bells in a long hall", "box",
    ["kick.soft", "snare.soft", "clap.soft", "hat.soft", "open.swell", "tom.conga", "rim.woodlo", "shaker.sleigh", "bell.marimba"],
    { verb: "hall", space: 0.6, size: 0.85, echo: 0.15, tone: -0.2, glue: 0.3, human: 0.15, noise: "room", noiseAmt: 0.2 }),
  kitOf("hands", "Hand Drums", "Congas, bongos, claves, guiro and agogo", "box",
    ["kick.felt", "snare.modal", "clap.snap", "hat.pedal", "open.half", "tom.conga", "rim.claves", "shaker.guiro", "bell.agogo"],
    { space: 0.25, size: 0.45, glue: 0.35, human: 0.3 }),
];

export const kitFrom = (b: Beat, id: string, name: string): UserKit => ({ id, name, kit: b.kit, voices: { ...b.voices }, sounds: JSON.parse(JSON.stringify(b.sounds)), fx: fxOf(b) });
/** Switch machine. Your knob settings stay; drums that borrowed another machine's voice go back to the kit's own. */
export const applyKit = (b: Beat, kit: KitId): Beat => ({ ...b, kit, voices: {}, userKit: null });
export const applyUserKit = (b: Beat, k: UserKit): Beat => ({ ...b, ...k.fx, kit: k.kit, voices: { ...k.voices }, sounds: JSON.parse(JSON.stringify(k.sounds)), userKit: k.id });

export function reviveUserKits(raw: unknown): UserKit[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is UserKit => !!k && typeof k === "object" && typeof (k as UserKit).id === "string" && typeof (k as UserKit).name === "string" && !!(k as UserKit).sounds)
    .map((k) => ({ ...k, voices: k.voices ?? {}, fx: fxOf(k.fx ?? {}) }));
}

export const DEFAULT_BEAT: Beat = {
  on: false,
  kit: "box",
  patternId: BEAT_LIBRARY[0].id,
  name: BEAT_LIBRARY[0].name,
  steps: BEAT_LIBRARY[0].steps,
  div: BEAT_LIBRARY[0].div,
  swing: 0,
  level: 0.8,
  space: 0.25,
  grit: 0.1,
  rows: BEAT_LIBRARY[0].rows,
  sounds: {},
};

/** Load a library rhythm into a beat. The kit, sound settings and effects stay as they are. */
export function applyPattern(beat: Beat, p: BeatPattern): Beat {
  return { ...beat, on: true, patternId: p.id, name: p.name, edited: false, steps: p.steps, div: p.div, bars: p.bars ?? 1, swing: p.swing, rows: p.rows };
}

/** Beats (quarter notes) in one bar of this rhythm. */
export const barBeats = (b: { steps: number; div: number }) => b.steps / b.div;
/**
 * How many times a section's chords play so the drum pattern can finish: a 4-bar beat under
 * 2 bars of chords plays the chords twice. With the drums off, or a pattern no longer than the
 * chords, once.
 */
export function chordRounds(chordBeats: number, b: Beat | undefined | null): number {
  if (!b?.on || chordBeats <= 0) return 1;
  return Math.max(1, Math.ceil((barBeats(b) * barsOf(b)) / chordBeats - 1e-6));
}

/** Bars in the pattern. */
export const barsOf = (b: { bars?: number }) => Math.max(1, Math.min(MAX_BARS, Math.round(b.bars ?? 1)));
/** Grid steps in the whole pattern, all bars. */
export const lenOf = (b: { steps: number; bars?: number }) => b.steps * barsOf(b);
export const MAX_BARS = 8;

/** The rhythm on its own: what each song section keeps for itself. Kit, sounds and effects are shared by the whole song. */
export const GROOVE_KEYS = ["patternId", "name", "edited", "steps", "div", "bars", "swing", "rows"] as const;
export type Groove = Pick<Beat, (typeof GROOVE_KEYS)[number]>;
export const grooveOf = (b: Beat): Groove => ({ patternId: b.patternId, name: b.name, edited: !!b.edited, steps: b.steps, div: b.div, bars: barsOf(b), swing: b.swing, rows: b.rows });

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
      if (b.mutes?.includes(id)) continue;
      const lv = levelAt(b.rows, id, step);
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
  const fx = fxOf(b);
  if (!VERBS.some((v) => v.id === fx.verb)) fx.verb = FX_DEFAULTS.verb;
  if (!SAMPLERS.some((v) => v.id === fx.sampler)) fx.sampler = FX_DEFAULTS.sampler;
  if (!NOISE_BEDS.some((v) => v.id === fx.noise)) fx.noise = FX_DEFAULTS.noise;
  return { ...DEFAULT_BEAT, ...b, ...fx, kit, ...rhythm, sounds: b.sounds ?? {}, voices };
}

/** Tidy up a section's stored rhythm. */
export function reviveGroove(raw: unknown): Groove | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const g = raw as Partial<Groove>;
  const rhythm = cleanRhythm(g);
  if (!rhythm) return undefined;
  return { patternId: typeof g.patternId === "string" ? g.patternId : null, name: typeof g.name === "string" ? g.name : "Beat", edited: !!g.edited, swing: Number(g.swing) || 0, ...rhythm };
}
