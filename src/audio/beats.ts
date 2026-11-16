/**
 * Drum beats: the step-grid format, the rhythm library and the helpers shared by
 * playback, the editor and MIDI export.
 *
 * A beat is one bar. `steps` is the number of grid steps in the bar and `div` the
 * number of steps per beat, so 4/4 in 16ths is 16 × 4, a 12/8 shuffle is 12 × 3
 * and a 3/4 waltz is 12 × 4.
 */
import { DRUM_IDS, defaultParams, type DrumId, type DrumParams, type KitId } from "./drums";

export type BeatGroupId = "dream" | "indie" | "box" | "808" | "rock" | "slow" | "world";

export const BEAT_GROUPS: { id: BeatGroupId; name: string }[] = [
  { id: "dream", name: "Dream pop" },
  { id: "indie", name: "Lo-fi indie" },
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
}

export interface Beat extends Partial<Omit<BeatFx, "level" | "space" | "grit">> {
  on: boolean;
  /** the machine every drum uses… */
  kit: KitId;
  /** …unless a drum has been given another machine's voice */
  voices?: Partial<Record<DrumId, KitId>>;
  /** the saved kit this came from, if any */
  userKit?: string | null;
  /** library (or saved) pattern this started from */
  patternId: string | null;
  name: string;
  edited?: boolean;
  steps: number;
  div: number;
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

export const FX_DEFAULTS: BeatFx = { level: 0.8, space: 0.25, size: 0.45, echo: 0, echoTime: "1/8.", grit: 0.1, tape: 0, tone: 0, glue: 0.3, human: 0 };
const FX_KEYS = Object.keys(FX_DEFAULTS) as (keyof BeatFx)[];

/** The beat's effect settings, with defaults for anything an older beat does not have. */
export function fxOf(b: Partial<BeatFx>): BeatFx {
  const out = { ...FX_DEFAULTS } as Record<keyof BeatFx, number | string>;
  for (const k of FX_KEYS) if (b[k] !== undefined) out[k] = b[k] as number | string;
  return out as unknown as BeatFx;
}

/** Which machine a drum's voice comes from. */
export const voiceOf = (b: Pick<Beat, "kit" | "voices">, id: DrumId): KitId => b.voices?.[id] ?? b.kit;
/** A drum's full sound settings. */
export const soundOf = (b: Pick<Beat, "sounds">, id: DrumId): DrumParams => ({ ...defaultParams(id), ...b.sounds[id] });

/** One-tap effect settings for the whole kit. Volume, swing and feel are left alone. */
export const VIBES: { id: string; name: string; hint: string; fx: Omit<BeatFx, "level" | "human"> }[] = [
  { id: "clean", name: "Clean", hint: "Dry and clear", fx: { space: 0.12, size: 0.3, echo: 0, echoTime: "1/8.", grit: 0.05, tape: 0, tone: 0, glue: 0.25 } },
  { id: "dreamy", name: "Dreamy", hint: "Long reverb, soft echo, slightly dark and wobbly", fx: { space: 0.55, size: 0.8, echo: 0.25, echoTime: "1/8.", grit: 0.1, tape: 0.35, tone: -0.25, glue: 0.35 } },
  { id: "tape", name: "Bedroom tape", hint: "Warm, dull and wobbly, like a four-track cassette", fx: { space: 0.2, size: 0.4, echo: 0, echoTime: "1/8.", grit: 0.45, tape: 0.7, tone: -0.4, glue: 0.5 } },
  { id: "big", name: "Big room", hint: "Loud, wide and punchy", fx: { space: 0.45, size: 0.6, echo: 0, echoTime: "1/8.", grit: 0.2, tape: 0, tone: 0.15, glue: 0.7 } },
  { id: "crunch", name: "Crunchy", hint: "Driven hard and squashed", fx: { space: 0.1, size: 0.25, echo: 0, echoTime: "1/8.", grit: 0.8, tape: 0.15, tone: 0.1, glue: 0.8 } },
  { id: "dub", name: "Echoes", hint: "Repeats trailing off into a room", fx: { space: 0.3, size: 0.5, echo: 0.5, echoTime: "1/8.", grit: 0.15, tape: 0.25, tone: -0.1, glue: 0.3 } },
];

/** The vibe whose settings the beat has right now, if any. */
export function vibeOf(b: Beat): string | null {
  const fx = fxOf(b);
  return VIBES.find((v) => (Object.keys(v.fx) as (keyof typeof v.fx)[]).every((k) => v.fx[k] === fx[k]))?.id ?? null;
}

/** A whole drum setup you saved: machine, per-drum voices and sounds, and the effects. */
export interface UserKit {
  id: string;
  name: string;
  kit: KitId;
  voices: Partial<Record<DrumId, KitId>>;
  sounds: Partial<Record<DrumId, Partial<DrumParams>>>;
  fx: BeatFx;
}

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
  return { ...beat, on: true, patternId: p.id, name: p.name, edited: false, steps: p.steps, div: p.div, swing: p.swing, rows: p.rows };
}

/** Beats (quarter notes) in one bar of this rhythm. */
export const barBeats = (b: { steps: number; div: number }) => b.steps / b.div;

export const levelAt = (rows: Record<DrumId, string>, id: DrumId, step: number): StepLevel => (Number(rows[id]?.[step] ?? 0) || 0) as StepLevel;

export function setStep(beat: Beat, id: DrumId, step: number, level: StepLevel): Beat {
  const cur = (beat.rows[id] ?? emptyRow(beat.steps)).padEnd(beat.steps, "0");
  if (step < 0 || step >= beat.steps || Number(cur[step]) === level) return beat;
  return { ...beat, edited: true, rows: { ...beat.rows, [id]: cur.slice(0, step) + level + cur.slice(step + 1) } };
}

export const clearBeat = (beat: Beat): Beat => ({ ...beat, edited: true, rows: emptyRows(beat.steps) });

/** Time of a step inside the bar, in beats, including swing (which delays every second 16th). */
export function stepBeat(step: number, div: number, swing: number): number {
  const late = div % 2 === 0 && step % 2 === 1 ? swing / (3 * div) : 0;
  return step / div + late;
}

/** A small random variation: nudges kicks, adds ghost notes, opens a hat. Keeps the feel. */
export function varyBeat(beat: Beat, rand: () => number = Math.random): Beat {
  const pick = (n: number) => Math.floor(rand() * n);
  let b = beat;
  const onBeat = (s: number) => s % beat.div === 0;
  const moves = 2 + pick(2);
  for (let m = 0; m < moves; m++) {
    const s = pick(beat.steps);
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
  return b === beat ? setStep(beat, "snare", beat.steps - 1, levelAt(beat.rows, "snare", beat.steps - 1) ? 0 : 1) : b;
}

export interface DrumHit {
  /** beats from the start */
  beat: number;
  id: DrumId;
  velocity: number;
}

/** Every drum hit in `totalBeats` of this rhythm (the bar repeats). Shared by playback tests and MIDI export. */
export function beatHits(b: Beat, totalBeats: number): DrumHit[] {
  const out: DrumHit[] = [];
  const total = Math.ceil(totalBeats * b.div - 1e-6);
  for (let n = 0; n < total; n++) {
    const step = n % b.steps;
    const bar = Math.floor(n / b.steps);
    for (const id of DRUM_IDS) {
      if (b.mutes?.includes(id)) continue;
      const lv = levelAt(b.rows, id, step);
      if (lv) out.push({ beat: bar * barBeats(b) + stepBeat(step, b.div, b.swing), id, velocity: STEP_VELOCITY[lv] });
    }
  }
  return out;
}

/** Tidy up a beat loaded from storage (older or partial data). */
export function reviveBeat(raw: unknown): Beat | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = raw as Partial<Beat>;
  const steps = Number(b.steps);
  const div = Number(b.div);
  if (!Number.isInteger(steps) || steps < 1 || steps > 32 || !Number.isInteger(div) || div < 1 || !b.rows) return undefined;
  const rows = emptyRows(steps);
  for (const id of DRUM_IDS) {
    const r = (b.rows as Record<string, unknown>)[id];
    if (typeof r === "string") rows[id] = r.replace(/[^0-3]/g, "0").slice(0, steps).padEnd(steps, "0");
  }
  const kit: KitId = (["box", "808", "909", "linn", "volca", "lofi"] as KitId[]).includes(b.kit as KitId) ? (b.kit as KitId) : DEFAULT_BEAT.kit;
  return { ...DEFAULT_BEAT, ...b, kit, steps, div, rows, sounds: b.sounds ?? {}, voices: b.voices ?? {} };
}
