# Track view with a free timeline: buildable specification

Written against commit `0f436e9` of `/home/user/M-Theory-App`. Revised after three reviews (section J says what changed and why); the delivery steps are in `steps.md` beside this file. Sources: the three maps and the research memo in this folder, plus the code read where a decision depended on it. Paths are under `src/` unless they start with `src-tauri/`. Nothing in the repository was changed.

"The reference program" below means the track-view program the user asked us to study. Its name is kept out of this file on purpose.

## The design in one page

1. **One page: the track view.** A top bar, a ruler, track panels on the left, lanes with clips. No sections. Chords, Melody, Bass, Drums and Vocals open as floating plugin windows from their track.
2. **A song is tracks plus clips.** A clip sits on one track at a beat, has a length, and holds the same shapes the composers edit today (chords list, `Melody`, drum `Groove`, or a stretch of a recorded take). Copies are separate.
3. **A clip is a window onto its content repeating end to end.** Dragging either edge only moves that edge of the window. Past the content's end (or start) the content comes round again, and each restart is drawn as a notch. One rule covers trim and repeat.
4. **Sound belongs to the track.** Instrument, strings/keys/synth settings, effects, drum kit and drum effects, vocal chain: one set per track. Old songs whose track sounded different in different sections are split into one track per distinct sound, so nothing changes how it sounds.
5. **How chords are played (style, feel, neck area) stays on the clip.** It is part of the composition. Otherwise a verse picked and a chorus strummed would split one guitar track in two.
6. **The audio engine is kept.** A new pure function, `flatten`, turns tracks and clips into the `PlayItem[]` list the player, the WAV render, the recording backing and the MIDI writer already take. Three tiny additive engine touches are listed in C.6; everything else in `audio/` is untouched and its tests must pass unedited.
7. **Old songs are converted once, after a full version 4 load.** New songs are stored under a new storage key and a new cloud prefix so an older build can never open or overwrite them. The old storage blob is never written again; it is moved, checked, into the browser's larger store and is the backup store. Each converted idea gets a backup entry in the ideas list, folded under one row. An old copy that turns up newer later (another device still on the old version) is never ignored.
8. **Seven draft releases, twelve steps.** Release 1 already gives the track view, converted songs that play the same, clip move/copy/edge-repeat/split, the ruler loop (one stretch or several) with scroll and zoom, global undo, and every existing composer reachable in a simple window. Chords, Melody, Bass and Drums get there through a "lens" that presents one clip as a one-section old song; Vocals through the old page in a host mode that hands its takes to the new model. Releases 2 to 5 turn each composer into a proper plugin. Release 6 is the blank audio track. Release 7 removes the leftovers and does the phone layout.
9. **No recording can be lost by accident, and nothing is a key only.** Undo never removes a take. Every action has a button on screen (and so works on a phone); keys are shortcuts.

---

## A. New song model (stored version 5)

New folder `src/timeline/`. The old `song/structure.ts`, `song/tracks.ts`, `song/unity.ts`, `song/migrate.ts` stay as a frozen **old-song reader**; nothing new imports their mutators.

### A.1 Types (`src/timeline/model.ts`)

```ts
import type { ProgChord, ArrangeSettings } from "../ui/state";
import type { Melody } from "../song/melody";
import type { Groove, DrumKit } from "../audio/beats";
import type { PatternId, Feel } from "../audio/patterns";
import type { HarpSound } from "../audio/rack";
import type { Tone } from "../audio/tone";
import type { VocalFx } from "../audio/vocalfx";
import type { Mix } from "../audio/mix";
import type { TimeSig } from "../song/meter";
import type { Shape } from "../theory/harmonize";

export const SONG_V = 5;

// ── tracks ──────────────────────────────────────────────────
export type TrackKind = "chords" | "melody" | "bass" | "drums" | "vocals" | "audio";
/** What a clip holds. Melody and bass clips are the same thing; so are vocal and blank-audio clips. */
export type ClipKind = "chords" | "melody" | "drums" | "audio";
export const CLIP_OF: Record<TrackKind, ClipKind> =
  { chords: "chords", melody: "melody", bass: "melody", drums: "drums", vocals: "audio", audio: "audio" };
/** Can a clip of this kind lie on a track of that kind? (The only drop rule.) */
export const accepts = (track: TrackKind, clip: ClipKind): boolean => CLIP_OF[track] === clip;

interface TrackBase {
  id: string;
  kind: TrackKind;
  name: string;
  /** 0–7, the colour of its clips (the old section colours are reused as the palette) */
  color?: number;
  /** tracks that conversion split from one old row share that row's id here (one heading in the chord sheet, B.1 steps 6 and 12) */
  group?: string;
}

/** The clip being composed in a plugin, not yet on the timeline. It has no place of its own: it is treated as lying at `draftAnchor` (A.5). */
export interface Draft<C> {
  content: C;
  /** the time signature it is written in (the one at the anchor when it was started) */
  sig: TimeSig;
}

/** A chords track: what plays it and how it sounds, on every clip. */
export interface ChordsTrack extends TrackBase {
  kind: "chords";
  tone: Tone;                      // Guitar / Piano / Synth with its settings (voicing, pedal, synth sound and way of playing)
  sound?: Partial<HarpSound>;      // strings + the whole effects rack; missing knobs are defaults
  /** a chords track the engine's bar pulse and a pedalled piano may follow (see C.3); set by conversion and on the first chords track made */
  lead?: true;
  role?: "harmony";
  /** the source and option it was last harmonised with (the per-clip record is on the clip) */
  harmony?: { from: string; option: string };
  draft?: Draft<ChordsContent>;
}

/** A melody or bass track: same data, same composer. */
export interface TuneTrack extends TrackBase {
  kind: "melody" | "bass";
  tone: Tone;
  sound?: Partial<HarpSound>;
  role?: "harmony";
  harmony?: { from: string; option: string };
  draft?: Draft<Melody>;
}

export interface DrumsTrack extends TrackBase {
  kind: "drums";
  /** machine, each drum's sound, the drum mixer, every effect, Human, Pump: all of `Beat` that is not rhythm */
  kit: DrumKit;
  /** a drums track whose swing and triplet grid the chord styles and melodies may follow (see C.3) */
  lead?: true;
  draft?: Draft<Groove>;
}

/** Which input of the interface a track records. `ch` counts from 0 (the old `Track.input` counted from 1). A pair is `ch` and `ch + 1`, recorded in stereo. */
export interface InputRef { ch: number; pair?: true }

/** A vocal track or a blank audio track: recorded takes, one sound chain. */
export interface AudioTrack extends TrackBase {
  kind: "vocals" | "audio";
  input?: InputRef;                // none = input 1 (ch 0)
  fx: VocalFx;                     // the vocal chain (off on a new blank track)
  /** every take recorded on it; clips play stretches of these. No undo, redo or clip edit ever removes one (A.8) */
  takes: Take5[];
}
export type Track = ChordsTrack | TuneTrack | DrumsTrack | AudioTrack;

// ── clip content: the shapes the composers already edit ─────
/** A chords clip's content: today's per-section chords fields, moved together. */
export interface ChordsContent {
  chords: ProgChord[];             // unchanged type; a run with no gaps, from the content's first beat
  bars: number;                    // the frame: chords past it are kept but not played (as a section's `bars` today)
  style: PatternId;                // was `pattern` / `Settings.style`
  feel?: Partial<Feel>;
  arrange?: ArrangeSettings;       // guitar neck area; none = each chord's own shape
}
// A melody or bass clip's content is `Melody` exactly as it is ({ div, bars, notes }); `on` is not used (the clip's `mute` is).
// A drums clip's content is `Groove` exactly as it is ({ patternId, name, edited, steps, div, bars, swing, rows }); `on` is not used.
// A drums content always fits its clip's signature: steps / div === sigBeats(clip.sig) (kept by `setContent`, A.7).

// ── clips ───────────────────────────────────────────────────
interface ClipBase {
  id: string;
  track: string;
  /** where its left edge is: beats from the start of the song, >= 0 */
  start: number;
  /** kept but not played (was Melody.on === false, Beat.on === false) */
  mute?: boolean;
}
/** A composed clip. All three numbers are whole beats. */
interface NoteClipBase extends ClipBase {
  /** how long it is shown and heard, in beats, > 0 */
  len: number;
  /** how far into its content the left edge is, 0 <= off < contentBeats(clip) */
  off: number;
  /** the time signature its content was written in: bar length inside the content */
  sig: TimeSig;
}
export interface ChordsClip extends NoteClipBase {
  kind: "chords";
  content: ChordsContent;
  harmony?: HarmonyMark5;
  /** it plays instead of that chords track while it sounds (a harmony written to replace chords) */
  instead?: string;
}
export interface MelodyClip extends NoteClipBase { kind: "melody"; content: Melody; harmony?: HarmonyMark5 }
export interface DrumsClip extends NoteClipBase { kind: "drums"; content: Groove }
/**
 * A stretch of a recorded take. Numbers are frames of the take's file.
 * A clip made by recording, by conversion or by a split has from = 0 and to = take.frames: its content is the whole
 * take, and `off` and `frames` say which part is shown. So an edge dragged back out first uncovers the rest of the
 * take, and only repeats it past the take's end. (Old and new clips behave the same.)
 */
export interface AudioClip extends ClipBase {
  kind: "audio";
  take: string;                    // id in its track's `takes`; any take of the same spot can be swapped in
  from: number; to: number;        // the stretch of the take that is its content (one cycle), from < to <= take.frames
  off: number;                     // frames into that stretch where the left edge is, 0 <= off < to - from
  frames: number;                  // how long it is shown and heard, in frames
}
export type NoteClip = ChordsClip | MelodyClip | DrumsClip;
export type Clip = NoteClip | AudioClip;

/** What Harmonize wrote into a clip (was `HarmonyMark`, kept per section part). */
export interface HarmonyMark5 { from: string; option: string; shape?: Shape; src: string; out: string; along?: true }

/** A take: `song/takes.ts` Take with its place as a song beat. */
export interface Take5 extends Omit<import("../song/takes").Take, "at"> {
  /** the song beat its first frame was sung on; null = unplaced (its old section is gone, or its clip was undone) */
  at: number | null;
  /** 2 = a stereo file from an input pair (none = mono) */
  channels?: 2;
}

/** The takes of an audio track that was removed (or whose making was undone): kept so no recording is lost by accident (A.8). */
export interface Shelved { track: string; name: string; kind: "vocals" | "audio"; takes: Take5[]; at: number; saves: number }

// ── the song ────────────────────────────────────────────────
export interface Marker { id: string; beat: number; name: string; color?: number }

export interface TimelineSong {
  v: 5;
  bpm: number;                     // one tempo, 40–200
  meter: TimeSig;                  // the time signature from bar 1
  /** later changes: from this bar on (0 = bar 1; sorted; bar > 0) */
  sigs?: { bar: number; sig: TimeSig }[];
  tracks: Track[];                 // top to bottom, any number
  clips: Clip[];
  mix?: Mix;                       // unchanged type, keyed by track id
  markers?: Marker[];              // names on the ruler (old section names arrive here)
  /** the song is at least this long, in beats (conversion writes the old total here so empty bars at the end are kept; cutTime and insertTime move it) */
  end?: number;
  /** removed recordings (see `Shelved`) */
  shelf?: Shelved[];
}

// ── what is open and selected: never part of an idea ──
export interface Region { from: number; to: number }   // beats, from < to
export interface Session {
  cursor: number;                                   // the edit cursor, beats
  /** the ruler's loop: one or more stretches in song order, never touching or overlapping (they are merged) */
  loop: { regions: Region[]; on: boolean } | null;
  sel: { clips: string[]; track: string | null };
  pxPerBeat: number;                                // zoom
  scroll: number;                                   // the beat at the left edge of the lanes
  /** the audio track that records. NOT stored: null at every start and when another idea opens */
  armed: string | null;
  windows: WinState[];                              // open plugin windows (see E.1)
}
```

The key, capo and tuning stay beside the song on the saved idea, as today (`SavedProgression` in `ui/state.tsx:128`). A saved idea becomes:

```ts
// src/timeline/library5.ts
export interface SavedIdea {
  id: string; name: string; key: Key; savedAt: number; updatedAt?: number; capo?: number; tuningId?: string;
  song: TimelineSong;
  /** it was converted from a version 4 idea: that copy's own `updatedAt` (B.3) */
  from?: { at: number };
  /** a backup entry: the version 4 idea it stands for (its JSON is read by `backupSource`, B.4) */
  backup?: { of: string; unsaved?: true };
}
```

The new app state is a new type in a new file. **The version 4 modules are not edited**: `ui/state.tsx` keeps its types (`AppState`, `Progression`, `SavedProgression`, `Ctx`), its pure functions and its provider (no longer mounted), so the 15 test files that import them stay green untouched until release 7 removes them with their modules.

```ts
// src/ui/app5.tsx
export interface App5State {
  key: Key; settings: Settings;
  song: TimelineSong; saved: SavedIdea[]; session: Session;
  shapes: Record<string, string>; myBeats: BeatPattern[]; myKits: UserKit[]; mySounds: UserSound[];
  canvas?: CanvasPrefs; ideaId?: string | null; draft?: string; tombs?: Record<string, number>;
  clip?: Clipboard5; studio?: Studio; view?: ViewPrefs;
  /** what was converted from version 4, and from what (B.3) */
  converted?: { at: number; blob?: { len: number; hash: string; where: "idb" | "local" }; ideas: Record<string, number> };
  /** the last write to storage failed (B.3); never stored */
  unsaved?: true;
}
export function App5Provider(props: { children: ReactNode }): JSX.Element;
export function useApp5(): Ctx5;   // state, set, edit(label, fn), setSession, undo, redo, toast, idea functions, cloud, recordingTo
```

`Studio` gains one field, `inputs?: number` (how many inputs the interface had when it was last open, F.2). `tab` and `pane` are not carried over (there is one page).

### A.2 Which existing types become clip content unchanged

| Old place | Type | New place | Changed? |
|---|---|---|---|
| `SongPart.chords`, `Layer.chords` | `ProgChord[]` (`ui/state.tsx:60`) | `ChordsContent.chords` | no |
| `SongPart.arrange/style/feel`, `Layer.arrange/pattern/feel` | `ArrangeSettings`, `PatternId`, `Feel` | `ChordsContent.arrange/style/feel` | no (only grouped) |
| `SongPart.melody`, `Layer.melody` | `Melody` (`song/melody.ts:22`) | `MelodyClip.content` | no (`on` moves to `clip.mute`) |
| `SongPart.groove`, rhythm half of `Layer.beat` | `Groove` (`audio/beats.ts:386`) | `DrumsClip.content` | no (`on` moves to `clip.mute`) |
| `SongPart.kit`, kit half of `Layer.beat` | `DrumKit` (`audio/beats.ts:394`) | `DrumsTrack.kit` | no |
| `SongPart.sound/tuneSound`, `Layer.sound/tuneSound` | `Partial<HarpSound>` | `Track.sound` | no |
| `SongPart.tones[id]` | `Tone` | `Track.tone` | no |
| `Track.fx` | `VocalFx` | `AudioTrack.fx` | no |
| `Track.clips[]` | `Clip {take, from, to, move}` (`song/clips.ts:19`) | `AudioClip` | `move` becomes `start` in beats; `from`/`to` become the whole take and the trimmed stretch is `off` and `frames` (so an edge can be dragged back out) |
| `Track.takes[]` | `Take` | `Take5` | `at: {block, bar}` becomes a song beat |
| `Track.input` (1 or 2) | number | `AudioTrack.input` | `{ ch: old - 1 }` |
| `Progression.mix` | `Mix` | `TimelineSong.mix` | no |

So `MelodyGrid` keeps editing a `Melody`, `DrumMachine` keeps editing a `Beat` (built with `onKit(groove, kit)` and split back with `grooveOf` / `kitOfBeat`, both exist in `audio/beats.ts:386-400`), and the chord tray keeps editing `ProgChord[]`.

### A.3 Lengths and the looping rule

```ts
// src/timeline/model.ts
/** Length of one cycle of a clip's content. Note clips: beats. */
export const contentBeats = (c: NoteClip): number => c.content.bars * sigBeats(c.sig);
/** Audio clips: frames. */
export const contentFrames = (c: AudioClip): number => c.to - c.from;
/** A clip's length in beats at a tempo (audio does not stretch, so its length in beats follows the tempo). */
export function clipBeats(c: Clip, bpm: number, rate?: number): number;
export const clipEnd = (c: Clip, song: TimelineSong): number;   // start + clipBeats
/** Which point of the content sounds at song beat x (note clips). */
export const phase = (c: NoteClip, x: number): number => mod(c.off + (x - c.start), contentBeats(c));
/** The song beats inside the clip where the content starts again: where a notch is drawn. */
export function notches(c: Clip, song: TimelineSong): number[];
/** The stretches of content a clip plays, in order: clip-relative start, and the content range. */
export function cycles(c: NoteClip): { at: number; from: number; to: number }[];
```

Rule: **the content repeats without end in both directions; the clip is the stretch of that which is shown.**

- Right edge to beat `e`: `len = e - start`. Nothing else changes.
- Left edge to beat `s`: `off = mod(off + (s - start), contentBeats)`, `len = len - (s - start)`, `start = s`. What was already heard stays where it was.
- A notch is drawn at every song beat `x` with `start < x < start + len` and `phase(x) === 0`.
- There is no separate "loop" switch. To have silence after the content, make the clip shorter.

Worked example, an edge drag from 4 bars to 10 bars. A drums clip in 4/4 holds a 4-bar rhythm: `contentBeats = 16`, `start = 16` (bar 5), `len = 16`, `off = 0`.

1. Drag the right edge from bar 9 to bar 15: `len = 40`. `cycles` gives `[{at 0, 0..16}, {at 16, 0..16}, {at 32, 0..8}]`: the rhythm twice, then its first two bars. Notches at song beats 32 and 48 (bars 9 and 13).
2. Now drag the left edge two bars earlier, from bar 5 to bar 3 (`s = 8`): `off = mod(0 + (8 - 16), 16) = 8`, `len = 48`, `start = 8`. The clip now opens with bars 3–4 of the rhythm, then a notch at beat 16 where the rhythm starts, exactly where it started before.

### A.4 Key, tempo, time signature

- **Key**: one per idea, outside the song, as today. "Move song" changes the key and transposes every chords and melody/bass clip and every draft in one step: `transpose(song, n, from, to)` (A.7). The rule, stated once: chords move by `n` semitones (`transposeChord`, written notes included). Melody and bass notes move by `melodyBase(to) - melodyBase(from)`, which is today's rule (`GuitarView.tsx:1004`: `n`, or `n ∓ 12` when the home row wraps, so the notes stay on the same rows of the grid). A note that would leave the stored range 24..108 moves by one more octave back into it instead of being dropped (as `shiftNotes` does for written chord notes). The loader does the same: `reviveMelody5` folds a note outside 24..108 by octaves instead of dropping it (`song/melody.ts:178` drops; it is left as it is for the old reader).
- **Tempo**: one `bpm`. No tempo map. A change goes through `setTempo(song, bpm)` (A.7), which keeps recorded audio where it was sung.
- **Time signature**: a **bar map**. `meter` holds from bar 1; `sigs` lists later changes by bar. Every note clip also records the signature it was written in (`sig`), which fixes the bar length inside its content.

```ts
// src/timeline/bars.ts
export interface BarMap {
  beatOfBar(bar: number): number;                       // bar 0 = the first bar
  barAt(beat: number): { bar: number; beat: number; sig: TimeSig };   // which bar, how far into it
  sigAt(beat: number): TimeSig;
  /** bar lines between two beats (for the ruler and the grid) */
  lines(from: number, to: number): { beat: number; bar: number }[];
  /** nearest bar line / nearest beat / the bar line at or before */
  snapBar(beat: number): number; snapBeat(beat: number): number; floorBar(beat: number): number;
}
export function barMap(song: Pick<TimelineSong, "meter" | "sigs">): BarMap;
```

**Songs whose sections had different signatures convert exactly like this:** each section keeps its signature. Where a section's signature differs from the one before it, a change is written into `sigs` at that section's first bar. Each clip gets its section's signature as `sig`. Nothing is refitted and no note moves. A song A (4/4, 8 bars), B (6/8, 4 bars), A again converts to `meter: 4/4, sigs: [{ bar: 8, sig: 6/8 }, { bar: 12, sig: 4/4 }]`.

After conversion, in the new app:

- The signature control in the top bar sets the signature of the stretch the cursor is in (the whole song when `sigs` is empty). Every clip that starts in that stretch is refitted with the functions that exist (`fitRhythm`, `refit`, `song/meter.ts`), and clips keep their bar numbers (their `start` and `len` are recomputed from the new bar lengths). One undo step.
- "From this bar on" in the same popover adds a change at the cursor's bar. A small flag on the ruler shows each change; click it to change or remove it.
- A clip moved into a stretch with another signature is **not** changed. It plays its content as written, and shows a small tag with its own signature. "Fit to these bars" in the composer's strip refits it. No question is asked.
- **What keeps a rhythm in its bars.** Today `conform` runs on the whole song after every change (`ui/state.tsx:271, 392`) and is what fits a picked library rhythm to the bars; `applyPattern` only copies the library's steps, and the library has bars of 6, 9, 12, 15 and 20 steps. In the new model the same guarantee is local:
  - `setContent` (A.7) runs `fitRhythm(groove, sigBeats(clip.sig), isCompound(clip.sig))` on every drums content it is given, so `steps / div === sigBeats(clip.sig)` always holds and `contentBeats` is right. The same holds for a draft (its own `sig`).
  - `unlens` (E.4) runs `conform` on the one-section lens song before it reads it (the lens song has `meter: clip.sig`).
  - The Drums composer's pick, a "Mine" rhythm, and a paste into the open clip all go through `setContent`, so they are fitted too.
  - A new empty melody in 6/8, 9/8 or 12/8 starts on the triplet grid (`blankMelody`, `GuitarView.tsx:1510`, copied to `timeline/edit.ts` as `blankContent(kind, sig)`).
- Picking a rhythm never changes the clip's length on the timeline. The rhythm repeats inside the clip, as it filled a section before.

### A.5 Loop, draft anchor and selection

All live in `Session`, not in the song, so moving the loop or selecting a clip never makes an idea look changed (the rule the tests already hold for the section on screen). A session belongs to the open idea and is reset when another idea opens (as the loop is today, `GuitarView.tsx:310-325`). It is stored with the app, except `armed`.

- **Loop**: `{ regions, on }`. A plain drag on the ruler replaces the list with one stretch and turns the loop on. **Ctrl + drag adds another stretch**: the music then plays the stretches one after another in song order and jumps from the end of one to the start of the next (today's "loop sections that are apart", `GuitarView.tsx:345-350`, kept). Stretches that touch or overlap are merged. The loop button toggles `on` and keeps the list.
- **Draft anchor**: `draftAnchor(song, session)` (`timeline/edit.ts`) is where a draft is treated as lying: the bar line at or before the first loop region's start when the loop is on, else at or before the cursor. A draft's bars are `[anchor, anchor + contentBeats)`.
- **Selection**: clip ids and one track id.

### A.6 Rules the model keeps

1. Note clips start, end and are offset on whole beats (so drum steps and melody ticks always line up). **Drums clips start and end on bar lines** (a flattened drum part has one grid and one swing per bar, C.2). Audio clips may sit anywhere.
2. Clips on one track never overlap. A clip put down over others trims what it covers (splitting one it lands inside). This is `layDown` in A.7 and is one undo step. One exception: after a tempo change two audio clips may overlap; the later one is heard and drawn from its start and nothing stored is cut (A.7 `setTempo`).
3. A track only holds clips it `accepts`.
4. Track ids `"chords"`, `"melody"`, `"drums"` are never used (the engine treats them specially, `audio/synth.ts:65`, `audio/drumbus.ts:103`).
5. Anything broken in storage is dropped quietly (`reviveSong5`), never thrown on.
6. Recorded files are never copied, cut or deleted by an edit.
7. A take never leaves the song by an undo, a redo, a clip edit or a track removal. Only the take browser's own "delete" and "remove recording" do that, each with the 20-second undo toast (A.8).
8. Edits of time (`cutTime`, `insertTime`, paste with insert) work in whole bars of the bar map.

### A.7 Edits (`src/timeline/edit.ts`, all pure, all `(song, …) => song`)

```ts
export function addTrack(song, kind: TrackKind, id: string, at?: number): TimelineSong;      // plain defaults per kind (D.4)
export function removeTrack(song, id: string): TimelineSong;                                  // with its clips and mix entry; an audio track's takes go to `song.shelf`
export function duplicateTrack(song, id: string, newId: string): TimelineSong;                // same kind, sound, input and mixer entry; no clips, no takes; directly below
export function moveTrack(song, id: string, toIndex: number): TimelineSong;
export function renameTrack(song, id: string, name: string): TimelineSong;
export function setTrack<T extends Track>(song, id: string, patch: Partial<T>): TimelineSong; // sound, tone, kit, fx, input, draft

/** A track's sound on its own, to carry to another track or another idea. */
export interface SoundCopy { kind: ClipKind; tone?: Tone; sound?: Partial<HarpSound>; kit?: DrumKit; fx?: VocalFx }
export const copySound: (t: Track) => SoundCopy;
export function pasteSound(song, id: string, s: SoundCopy): TimelineSong;                     // only onto a track of the same clip kind; else the song as it was

export function layDown(song, clip: Clip): TimelineSong;                                      // add, trimming what it covers
export function moveClips(song, ids: string[], dBeats: number, toTrack?: string): TimelineSong;
export function copyClips(song, ids: string[], dBeats: number, toTrack: string | undefined, id: () => string): TimelineSong;
export function duplicateClips(song, ids: string[], id: () => string): TimelineSong;          // straight after each
export function resizeClip(song, id: string, edge: "left" | "right", toBeat: number): TimelineSong;
export function splitClips(song, ids: string[], atBeat: number, id: () => string): TimelineSong;
export function deleteClips(song, ids: string[]): TimelineSong;
export function setContent(song, id: string, content: NoteClip["content"]): TimelineSong;     // from a composer; drums are fitted to the clip's signature (A.4)
export function setDraft(song, track: string, content: NoteClip["content"] | null, sig: TimeSig): TimelineSong;
export function placeDraft(song, track: string, atBeat: number, id: () => string): TimelineSong; // a copy of the track's draft as a clip; the draft stays
export const blankContent: (kind: ClipKind, sig: TimeSig) => NoteClip["content"];
export const draftAnchor: (song: TimelineSong, session: Pick<Session, "cursor" | "loop">) => number;
export function setSig(song, atBar: number, sig: TimeSig, fromHereOn: boolean): TimelineSong;
export function setTempo(song, bpm: number): TimelineSong;
export function transpose(song, n: number, from: Key, to: Key): TimelineSong;                 // the rule in A.4
export function songEnd(song): number;                                                        // the larger of `song.end` and the last clip end, up to the bar line

// a stretch of time on every track (what "a whole section" was); `from`, `to`, `at` and `beats` are snapped to bar lines first
export function clipsIn(song, from: number, to: number): string[];                            // ids of the clips that lie in it
export function cutTime(song, from: number, to: number): TimelineSong;                        // remove it and close the gap; markers, signature changes and `end` move too
export function insertTime(song, at: number, beats: number): TimelineSong;                    // push everything from `at` later (a clip across `at` is split)

/** What Ctrl+C holds: clips with starts counted from the first one, and each clip's track (with its sound) so a paste can make the track. */
export interface Clipboard5 { key: Key; clips: Clip[]; tracks: Track[]; takes: Take5[] }
export function copyOut(song, ids: string[], key: Key): Clipboard5;
export function pasteIn(song, c: Clipboard5, atBeat: number, key: Key, onto: string | null, id: () => string): TimelineSong;
```

- `pasteIn`: one clip goes onto `onto` when that track accepts it, else onto the first track that does; **when no track accepts it, the track is made from the clipboard's copy, with its sound** (so a clip carried to another idea brings its sound, as a page's Copy and Paste do today, `song/clip.ts:7-15, 125-131`). Several clips each go to the track they were copied from (matched by id, then by kind and name); a track that does not exist in this idea is made from the clipboard's copy of it. Audio clips bring their takes; the files are shared, never copied (as `song/clip.ts:273-293` does today).
- `moveClips` and `copyClips` to another audio track carry the take record with the clip (the file is shared), so a vocal clip dragged onto a blank track still sounds. "Apply sound" lights there when the two chains differ.
- **Split.** A note clip split at beat `x` gives two clips with separate deep copies of the content; the right one has `start = x`, `off = phase(x)`. An audio clip split keeps `take`, `from`, `to` and advances `off`, so the two halves are one continuous sound (played `joined`, without a fade between).
- **`setTempo(song, bpm)`** sets the tempo and re-places every audio clip so that the beat on which its take's first frame lies stays put, which is what holds today (every clip of a take hangs from the take's bar and runs in seconds, `song/clips.ts:311-313`). With `spb = 60 / bpm`: `zero = start - ((from + off) / rate) / spbOld`, then `start' = zero + ((from + off) / rate) / spbNew` (clamped at beat 0 by advancing `off`). Two halves of a split share `zero`, so they still touch and are still `joined` at any tempo. Nothing stored is trimmed: where a faster tempo makes one clip run into the next, `flatten` and the lane cut the earlier one at the later one's start, and going back to the recorded tempo brings everything back. The next edit of either clip goes through `layDown` as usual.

### A.8 Undo (`src/timeline/history.ts`)

```ts
export interface Step { song: TimelineSong; key: Key; label: string }
export interface History {
  push(before: Step, control?: string): void;     // changes from one control within 500 ms fold into one step
  undo(now: Step): Step | null; redo(now: Step): Step | null;
  clear(): void; canUndo: boolean; canRedo: boolean;
}
export function makeHistory(limit = 100): History;
/** After an undo or a redo: every take the song had just before is still in it. */
export function keepTakes(restored: TimelineSong, current: TimelineSong): TimelineSong;
```

- One history for the whole idea, 100 steps, in memory, cleared when another idea opens. **A step holds the song and the key together**, so Ctrl+Z after "Move song" puts back the notes and the key (scale rows, chord board, Canvas colours) as one.
- It covers clips, tracks, mixer, sounds and everything a composer writes. ↶ and ↷ in the top bar do the same as Ctrl+Z and Ctrl+Shift+Z. The composers' own undo buttons keep working as they are; each of their steps is also a history step.
- **Recordings survive it.** `keepTakes` runs on every undo and redo: for each audio track, the takes list is the restored one plus every take the current one has (by id). So Ctrl+Z after a recording takes the new clip off the lane and puts back what it trimmed, but the takes stay in the take browser, unplaced, and "Use" lays one back. If the undo removes the track itself, its takes go to `song.shelf`.
- **Removing an audio track that has takes** (`removeTrack`) moves its takes to `song.shelf` and shows the 20-second undo toast. The take browser of any audio track lists the shelf under "Removed recordings" with Use (lays the take at the cursor on this track) and Empty. A shelf entry is dropped when the idea has been saved twice since (`saves`), or by Empty.
- **The timing nudge is outside history.** It is a studio setting. Each take remembers the nudge it was cut with (`Take.nudge`, `song/takes.ts:34`), so after every undo, redo and idea open the host runs `renudge5(song, studio.nudge)`, which moves every take from its own nudge to the current one (the same list back when nothing moves). A nudge change itself runs `renudge5` over every audio track, the shelf and the clipboard's takes.
- **Locked** while a recording runs or its takes are being saved (`recordingTo`): undo and redo do nothing then.
- A window whose clip is gone after an undo closes (`lensOf` returns `null`, E.4).

---

## B. Migration, version 4 to version 5

File `src/timeline/migrate5.ts`:

```ts
export interface Converted { song: TimelineSong; ids: Record<string, string[]>; }   // old track id -> the new track ids it became
/** A fully loaded version 4 song (after reviveProgression / reviveIdea) as tracks and clips. Pure, deterministic. */
export function toTimeline(p: Progression): Converted;
```

It runs **after** the complete version 4 load (`migrateSong` → revive → `conform(settle(prune(commit(p))))`), because repeats written out, drums fitted to their bars and inferred signatures only exist on the revived song. The old reader is not touched.

### B.1 Steps

1. **Sections in running order.** `secs = sections(p)`, or `[soloSection(p)]` when the song has none. For section `k`: signature `sig_k = sec.meter ?? p.meter`, bar length `bar_k = sigBeats(sig_k)`, length `beats_k = barsOr(sec.bars) * bar_k`, start beat `B_k = sum of beats before it`, start bar `N_k = sum of bars before it`.
2. **Bar map and length.** `meter = sig_0`; for every `k > 0` where `sig_k` differs from `sig_{k-1}`, push `{ bar: N_k, sig: sig_k }`. `end = sum of all beats_k`, so empty sections at the end of the song keep their length in the WAV and the MIDI (today the play list holds a pad for them, `GuitarView.tsx:296-300`).
3. **Markers.** One per section at `B_k` with the section's label (its name, or its letter) and colour. Marker id = the block id.
4. **Old rows.** `allTracks(normalize(p))`: the three first tracks, then the added ones, in that order.
5. **Where each row has music.** A row gets a clip in section `k` when: chords row, `chords.length > 0`; melody row, `melody.notes.length > 0`; drums row, any hit in `rows`. (The first three rows read the section itself, added rows read `sec.layers[id]`.) A melody with `on === false` or drums with `on === false` still get a clip, with `mute: true`. Two exceptions for drums:
   - A drums part that is **off, not edited, and still on the rhythm a new idea starts with** (`on === false && !edited && patternId === DEFAULT_BEAT.patternId`, `audio/beats.ts:335-350`) gets no clip. Every old song that never used drums has one of these in every section; they would otherwise all arrive as faint drum clips.
   - The **first drums row that is on but has no hits** still gets a clip (with empty rows) when its `swing > 0` or its `div === 3`, because chord styles and melodies follow the first drums' swing and triplet grid whether or not it has hits (`GuitarView.tsx:282, 288`, `audio/patterns.ts:230`).
6. **One sound per track: split by what is heard.** For each row, give every section where it has a clip a sound key:
   - chords and melody: `JSON.stringify([heardTone(toneOf(sec, id)), reviveSound(sound or tuneSound)])`, where `heardTone` keeps only the settings the instrument in use plays with: a guitar is `{ inst }`; a piano is `{ inst, keys, bright, pedal, voicing, register }`; a synth is `{ inst, synth, voicing, register }`. (A `Tone` also remembers the settings of the instruments it is not playing, "so going back finds it", `audio/tone.ts:29-43`; those must not split a track.)
   - drums: `kitSig(kit)` (`audio/beats.ts`, already "the same for the same sound")

   Group the row's sections by key. The group covering the most bars (first one on a tie) keeps the row's name and base id; every other group becomes a **new track directly below it**, named `<name> · <label of its first section>`, with a copy of the row's mixer entry and `group: <base id>`. Each track keeps the fullest tone object of its group (the one with the most settings), so nothing remembered is lost. The number of chords and melody voices after conversion is **at most** the number the engine runs today (`slotOf`, `audio/synth.ts:56`, keys on the whole object).
7. **Ids.** First tracks: `t-chords`, `t-melody`, `t-drums`. Added tracks keep their id. Extra groups: `<base>~2`, `<base>~3`, in order of first appearance. Clip id: `<block id>.<old track id>` (a song with no sections uses `a` for the block id). All ids are derived, so the same old song always gives the same new song, on every device.
8. **Track sound.** Each new track takes the tone, sound or kit of its group. A row with no clip anywhere still becomes one track (the first three always exist), with the sound of the section that was on screen.
9. **Clips.** For row `r`, section `k`:
   - chords: `{ kind: "chords", start: B_k, len: beats_k, off: 0, sig: sig_k, content: { chords, bars: barsOr(sec.bars), style, feel, arrange } }`
   - melody: `{ kind: "melody", start: B_k, len: beats_k, off: 0, sig: sig_k, content: inBars(melody, bars) without on }`
   - drums: `{ kind: "drums", start: B_k, len: beats_k, off: 0, sig: sig_k, content: grooveOf(beat) without on }`. A rhythm shorter than its section becomes a clip that repeats (notches), which is how it plays today (`audio/synth.ts:879`); a longer one is cut at the section's end.

   A section played twice (two blocks, one part) gives two separate clips with separate copies. Linked repeats end here.
10. **Lead flags.** Every track made from the old first chords row gets `lead: true`; so does every track made from the old first drums row. Straight after conversion they never overlap in time. Once the user moves clips they may: then, at any beat, the topmost lead track with an unmuted clip sounding there is the lead (C.3).
11. **Mixer.** `mix` is re-keyed; every split track gets a copy of its row's entry. `TrackMix.instead` is dropped (step 13 replaces it); its `mute` stays.
12. **Takes and vocal clips.** For each vocal track:
    - **Input.** The old `input` is 1 or 2 (`song/tracks.ts:46`); the new one counts from 0: `input: 2` becomes `{ ch: 1 }`, `1` or none becomes none.
    - **Takes.** `at = B_k + take.at.bar * bar_k` for its block `k`. A take whose block is gone gets `at: null` and stays in the track's take list (unplaced, still in the take browser); its clips are not made, and the conversion toast adds "N recordings whose section was deleted are in the take list". A take whose bar is past its section's end keeps its computed beat, and its clips are made with `mute: true` (today they are silent and come back if the bar does; now they are on the lane, silent, to unmute or move).
    - **Clips.** For each `placedClips(track)` entry: `start = take.at + ((clip.from + (clip.move ?? 0)) / take.rate) / spb` with `spb = 60 / bpm`, and the clip is `{ kind: "audio", take, from: 0, to: take.frames, off: clip.from, frames: clip.to - clip.from, start }`. This is the same arithmetic as `layClips` (`song/clips.ts:314`), so every clip starts on the same sample, and it is the same shape a split in the new app gives: a trimmed edge can still be dragged back out to uncover the rest of the take (`song/clips.ts:114-119`). A start before beat 0 is brought to 0 by advancing `off` (and shortening `frames`). A track saved before clips existed goes through `clipsOf` first (it already handles that). `Track.active` is dropped.
    - **Overlaps become lanes.** An old vocal track may hold clips that overlap in time and all play (rows of recordings; only recordings from the same bar make way for each other, `song/clips.ts:123, 217-240`). Sort the track's clips by start and lay them into lanes: each clip goes into the first lane where it overlaps nothing (two halves of a split that touch do not overlap). Lane 1 is the track. Lane `n >= 2` becomes a track `<id>~n` directly below, named `<name> · n`, with the same chain, input and mixer entry, `group: <id>`, and the take records its clips play (the files are shared). So the song sounds the same and the no-overlap rule holds from the start.
13. **Harmony records.** `Track.harmony` keeps `{ from, option }` with `from` re-keyed. Each section mark (`markIn`) becomes the `harmony` field of the clip that section's part produced, on every block of that part, with `from` re-keyed to the split track that holds the source's clip in that block. `firstHarmony` is handled the same way on the first tracks. Where `insteadHere(t, tracks, partId)` names a target today, that clip gets `instead: <the split of the target that has a clip in that block>`. `role` is kept.
14. **Loops.** The loop is not stored today, so there is nothing to convert. The dead flags `play` and `loop` are dropped.
15. **Clipboards** (`AppState.clip`). The chords, melody and drums clipboards each become a clipboard of one clip: `{ key, clips: [the clip at start 0, built as in step 9], tracks: [a track of that kind holding the copied instrument and sound, or kit], takes: [] }`. So a paste where no such track exists makes the track with the copied sound, and "Paste sound" can take the sound alone. The last one copied wins (there is one clipboard now). The whole-section clipboard is dropped (it stays in the old blob).
16. **Drafts.** None are made.
17. **Everything else in the app state is copied unchanged**: `key`, `settings`, `shapes`, `myBeats`, `myKits`, `mySounds`, `canvas`, `studio`, `view`, `tombs`, `ideaId`, `draft` (`convertAll`, B.3).
18. **Stamp** `v: 5`.

### B.2 Worked example: a three-section song

Before (version 4), 96 bpm, song signature 4/4:

| Block | Part | Bars | Signature | First chords | First melody | First drums | Added "Chords 2" (`c7x`) | "Vocal 1" (`v1`) |
|---|---|---|---|---|---|---|---|---|
| b1 | Verse | 8 | 4/4 | 4 chords, Guitar, style "ring" | none | 1-bar rhythm, kit K1 | not in it | |
| b2 | Chorus | 4 | 6/8 | 2 chords, **Piano**, style "ring" | 9 notes | 1-bar rhythm, kit K1 | 2 chords, Synth | a take sung from bar 3 |
| b3 | Verse (same part as b1) | 8 | 4/4 | same | none | same | not in it | |

Beats: Verse = 8 × 4 = 32, Chorus = 4 × 2 = 8. Starts: b1 at 0, b2 at 32, b3 at 40. End at 72 beats, 20 bars.

After (version 5):

- `meter: 4/4`, `sigs: [{ bar: 8, sig: 6/8 }, { bar: 12, sig: 4/4 }]`, `end: 72`
- `markers`: Verse at 0, Chorus at 32, Verse at 40
- Tracks, top to bottom:

| Track | Kind | Sound | Clips (start, len in beats) |
|---|---|---|---|
| `t-chords` "Chords" (`lead`) | chords | Guitar | `b1.chords` (0, 32), `b3.chords` (40, 32) |
| `t-chords~2` "Chords · Chorus" (`lead`) | chords | Piano | `b2.chords` (32, 8) |
| `t-melody` "Melody" | melody | as it was | `b2.melody` (32, 8) |
| `t-drums` "Drums" (`lead`) | drums | K1 | `b1.drums` (0, 32, repeats 8 times), `b2.drums` (32, 8, repeats 4 times), `b3.drums` (40, 32) |
| `c7x` "Chords 2" | chords | Synth | `b2.c7x` (32, 8) |
| `v1` "Vocal 1" | vocals | its chain | take `at = 32 + 2 × 2 = 36`; its clip starts at 36 (plus its trim and move) |

The first chords row was split in two because it was a guitar in the verse and a piano in the chorus. The drums row was not split: one kit. The two verses are separate clips now.

### B.3 Where it runs, storage, and old builds

**New names, old ones frozen.**

- **New storage key** `m-theory-state-v2` holds `App5State` (A.1). **The old key `m-theory-state-v1` is never written by the new build.**
- **New cloud prefix** `idea5_<id>` (`ui/cloud.ts:60,68` use `idea_` today; `connectCloud` gets a prefix argument). Old `idea_<id>` documents are listed on every sync and never written.
- Why: an older build treats `v >= 4` as current and its revive drops what it does not know (map-model section 6), so it would open a converted song as nearly empty and save that back. With a new key and prefix it cannot see the new songs at all.
- **New modules beside the old ones** (the old ones are not edited, so their tests stay green): `src/ui/app5.tsx` (state, provider, storage), `src/timeline/library5.ts` (`SavedIdea`, `reviveIdea5`, `fingerprint5`, `describeIdea5`, `mergeIdeas5`, `toPush5`, `exportIdeas5`, `importIdeas5`), `src/ui/othertab5.ts` (`joinOtherTab5`: the other tab's saved ideas, tombstones, `myBeats`, `myKits`, `mySounds` are taken in, as `ui/othertab.ts:13, 50-56` does today), `src/ui/openidea5.ts`.
- **The offline cache name is bumped** (`public/sw.js`, `CACHE = "m-theory-v2"`), so a phone or tab still running cached old code gets the new code at its next visit instead of going on saving old-format ideas for days.

```ts
// src/timeline/convert.ts
/** The whole old app state as the new one: every saved idea and the idea on screen converted, a backup entry for each, every other field copied unchanged. */
export function convertAll(old: AppStateV4): App5State;
/** One old idea as a new one, with its backup entry. The converted idea keeps the old `updatedAt` and records it in `from.at`. */
export function convertIdea(i: SavedProgression): { idea: SavedIdea; backup: SavedIdea };
/** An old-format copy of an idea turns up (the cloud, a version 1 backup file, an old key written again): what the library becomes. */
export function arrive(s: App5State, old: SavedProgression, original: (id: string) => SavedProgression | null): { state: App5State; added?: "new" | "refreshed" | "beside" };
/** The version 4 original a backup entry stands for. */
export function backupSource(id: string): Promise<SavedProgression | null>;
```

**The first start of the new build** (`load5()` in `ui/app5.tsx`, then `settleConversion()` once the app is on screen):

1. If the v2 key exists, load it. Conversion never runs over an existing v2 key.
2. Otherwise read the v1 text, load it with the existing code (exported from `ui/state.tsx` as `loadV4`), and `convertAll` it in memory. The app shows this at once.
3. Copy the v1 text, byte for byte, into IndexedDB (database `m-theory`, store `backup`, key `v4-blob`), read it back and compare.
4. Write the v2 key, read it back and compare. If the write fails for lack of room and step 3 succeeded, remove the v1 key and try once more.
5. When 3 and 4 both succeeded, remove the v1 key (its copy is in IndexedDB) and note `converted.blob = { len, hash, where: "idb" }`. So local storage is **not doubled**. If IndexedDB cannot be used (some private windows and embedded viewers), the v1 key stays where it is as the backup store (`where: "local"`) and storage is doubled; that is the only case.
6. If the v2 write still fails: the state gets `unsaved`, and a plain message stays on screen until a later write works: "This device's storage is full, so changes are not being saved. They are safe while the app stays open. Ideas → Backup saves them to a file." The app keeps working in memory and tries again on every change. The same message is used for any later failed write (today the write sits in an empty `catch`, `ui/state.tsx:414-418`, and nobody is told).
7. The sizes of the old and the new text are kept in `converted` and printed once to the console, so real sizes are known from the first testers.

One plain toast after the first conversion: "Your ideas now open in the track view. The originals are in Ideas, under 'Before track view'." No dialog.

**An old-format copy turns up later** (`arrive`). This is one rule for every way it can happen: the first cloud sync after conversion, every later cloud sync (a phone still on the old build), a version 1 backup file restored, and the v1 key appearing again (an old tab that was open during the update wrote it). For an old copy with time `t = updatedAt ?? savedAt`:

| Case | What happens |
|---|---|
| a tombstone for its id is newer than `t` | ignored |
| no version 5 idea has its id | converted and added; a backup entry is made |
| a version 5 idea has its id and `t <= idea.from.at` | ignored (it is the copy that idea came from, or an older one) |
| `t > idea.from.at`, and the idea has not been edited since it was converted (`fingerprint5(idea)` equals `fingerprint5` of a fresh conversion of its backup's original) | the idea is **replaced** by a fresh conversion of the newer copy, and the backup now stands for the newer copy. Nothing is said. This is the device that held a stale copy when it converted |
| `t > idea.from.at`, and the idea has been edited in the new app | the newer old copy is converted and added **beside** it as its own idea, id `<id>-o`, named `<name> (edited in the old version)`, with one toast: "An idea changed in the old version was added beside yours." |

A converted idea keeps the `updatedAt` of the copy it came from, so no device's copy wins a cloud merge just by having converted. When the v1 key appears again, its saved ideas go through `arrive`, its text replaces IndexedDB key `v4-blob-late`, and the key is removed again (only when `where` is `"idb"`). It is never loaded as the app's state.

### B.4 The backup copies in the ideas list

- For every converted idea there is a backup entry with id `<id>-v4` (letters, digits and `-` only, like every id so far, `ui/state.tsx:387`), name `<name> (before track view)`, `backup: { of: <id> }`, an empty `song`, and the original's dates.
- **The idea on screen is covered too.** Its music is in the old blob's `progression`, not in its `saved` list (`ui/state.tsx:500-504`):
  - an idea that was never saved gets the entry `draft-<draft id>-v4`, "Unsaved idea (before track view)", unless it was blank;
  - a saved idea that was open with unsaved changes gets a second entry `<id>-u-v4`, `<name> (unsaved, before track view)`, with `backup.unsaved`.
- **The version 4 JSON is not copied into the entries.** `backupSource(id)` reads the original from, in order: the side store (IndexedDB key `idea:<id>`, used for old ideas that arrived later from the cloud or a file; the local key `m-theory-backup-v4` when IndexedDB cannot be used), the old blob (`v4-blob-late`, `v4-blob`, or the v1 key): its `saved` list, or its `progression` for the two "unsaved" kinds, then the old cloud document.
- A backup is never converted on load. "Open" on a backup converts a fresh copy into a new idea named `<name> (restored)`; the backup stays. So a conversion fault found later can be fixed and the song converted again from the untouched original.
- **In the list** the backups are folded under one closed row at the end, "Before track view (N)", so the list does not double in length. An entry whose original cannot be read on this device is not shown.
- Backup entries are not sent to the cloud (the old `idea_<id>` document is already the cloud's copy of the original; every device makes the same entry from it). Deleting a backup works like deleting any idea (a tombstone), so it stays deleted across tabs and devices.
- **Backup files.** "Backup" writes file version 2: `{ app, version: 2, ideas: SavedIdea[], originals: Record<string, SavedProgression> }`, with the original of every backup entry inside. "Restore" puts those originals into the side store, so the backup entries open on another computer too. Version 1 files are still read; each idea in them goes through `arrive`.

### B.5 Tests the migration needs

New test files `src/timeline/migrate5.test.ts`, `src/timeline/equal.test.ts`, `src/timeline/convert.test.ts`.

**Structure**

1. The three-section example above gives exactly the tracks, clips, bar map and markers listed.
2. A song with no sections converts as one section at beat 0.
3. Running `toTimeline` twice on the same input gives deep-equal output; a version 5 song is never converted.
4. A row with one sound everywhere is one track; a row with N sounds that are heard differently is N tracks; two sections that differ only in settings of an instrument not in use (a guitar's remembered synth) stay one track. Counting only tracks with at least one unmuted clip that has a sounding note, the number of chords and melody tracks is **at most** `slotsOf(legacyPlan(p).items).length`.
5. A repeated section gives two clips whose contents are equal but not the same object.
6. Mixed signatures give the right `sigs`, and `barMap(song).beatOfBar(N_k) === B_k` for every section.
7. Every take's `at` and every audio clip's `start` equal what `layClips` gives today plus the section start, to 1e-9 beats, and each clip has `from: 0, to: take.frames` with the old trim in `off` and `frames`. A take whose section is gone is unplaced and has no clip; one whose bar is gone has a muted clip. `input: 2` becomes `{ ch: 1 }`. A clip moved before beat 0 starts at 0 with `off` advanced.
8. Mixer entries are copied to every split; mute and solo survive.
9. Harmony marks land on the right clips; `harmonyState` (changed by hand / source changed) reads the same before and after for every harmony track and section.
10. Muted melodies and drums that are off become muted clips, except a drums part that is off, unedited and on the default rhythm, which gives no clip. A first drums row that is on, has no hits, and has swing or the triplet grid gives an empty clip.
11. Two recordings that overlap on one old vocal track land on two tracks (`v1`, `v1~2`) with the same chain, input and mixer entry, and no two clips on either overlap.
12. `song.end` equals the old total, also when the last sections are empty.
13. **Every old section line is a cut** (`cutPoints` of the converted song contains every `B_k`).
14. The other fields of the app state are equal before and after `convertAll`: `key`, `settings`, `shapes`, `myBeats`, `myKits`, `mySounds`, `canvas`, `studio`, `view`, `tombs`. An old chords clipboard becomes a clipboard whose track carries the copied sound.

**Render equality (the standing rule: a converted song sounds as it did)**

The plan builder inside `GuitarView.tsx:204-307` is copied, unchanged, into a pure function (step 0; the original stays where it is until release 7) so it can be called from a test and kept as the frozen reference:

```ts
// src/song/legacyplan.ts
export function legacyPlan(p: Progression, ctx: VoicingCtx, buffer: (t: Take) => AudioBuffer | undefined): { items: PlayItem[]; map: { block: string; idx: number }[]; per: SecPlan[]; any: boolean };
```

A helper records everything a render asks for, on the pretend audio context the audio tests already use (`audio/fakectx.ts`, the `notes()` and `starts` pattern of `audio/player.test.ts:20-80`):

```ts
// src/timeline/renderlog.ts (test helper)
export interface RenderLog {
  notes: { track: string; midi: number; when: number; velocity: number; length: number; slot?: number }[];  // spy on TrackVoice.prototype.note
  voices: { track: string; tone: string; sound: string }[];                                                 // each voice's tone and sound, as JSON
  hits: { track: string; drum: string; level: number; when: number; kit: string }[];                        // spy on playStep; kit = kitSig
  pedals: { track: string; when: number }[];                                                                // spy on TrackVoice.prototype.repedal
  takes: { track: string; take: string; when: number; offset: number; dur: number }[];                      // buffer sources started
}
export async function renderLog(items: PlayItem[], bpm: number, rename?: (track: string) => string): Promise<RenderLog>;
```

The test: for each fixture `p`, `A = renderLog(legacyPlan(p).items)` and `B = renderLog(flatten(toTimeline(p).song).items, rename new ids back to old ids)`. After sorting, `A` and `B` must be equal, with times within 1e-6 s. Voices are compared by the reduced sound key of B.1 step 6. Old drums id `drums` and first-track labels are mapped through `Converted.ids`. The same comparison is run on the live player (`ProgressionPlayer.start` on the pretend live context, clock advanced to the song's end), and on a loop: old `sliceLoop` over bars 3–6 against `flatten` with `range = { from, to, loop: true }`.

Fixtures (each a small version 4 song; start from the outputs of `song/migrate.test.ts` and add):

| # | Fixture | What it guards |
|---|---|---|
| 1 | one section, three first tracks | the base case |
| 2 | three sections with a repeat | positions, separate copies |
| 3 | a chords row on guitar, piano, synth in three sections | split by sound |
| 4 | a different drum kit in each section | drum split, kit per track |
| 5 | 4/4 then 6/8 then 3/4 | bar map, triplet feel, drum grid |
| 6 | added tracks in some sections only | empty stretches |
| 7 | a harmony that plays instead of the chords, and one that plays along | `instead` |
| 8 | vocal clips trimmed, moved, split, running across sections; two recordings that overlap in time; one clip moved before beat 0 | sample-exact audio, lanes |
| 9 | synth tracks with arp and drone | per-section synth playing |
| 10 | a piano melody with the pedal on over sparse chords | pedal changes (C.3) |
| 11 | a two-bar playing style and a half-speed feel | style position |
| 12 | a drum rhythm shorter, and one longer, than its section | repeat and cut |
| 13 | chords running past their section's end | frame cut |
| 14 | melody off, drums off | muted clips |
| 15 | swing on the first drums with 16th-note chord styles and a melody | whose swing is followed |
| 16 | the first drums on with swing but no hits; another song with the drums never touched | the silent swing clip; no faint default clips |
| 17 | two empty sections at the end, and a section with only vocals | the song's length; extra cuts change nothing |

Honest limit of this test: it compares what is asked of the audio graph (every note, hit, pedal change, take start, and each voice's settings), not samples, because the tests have no real audio engine and plucked strings and "Human" drums use random numbers. One real difference is known and accepted: a drums row that was split now has one desk per kit, so the reverb tail of one kit rings out on its own desk instead of being switched to the next kit's settings at the section line.

**MIDI**: `progressionToMidi` from both lists gives the same note events per track (names mapped).

**Storage** (`convert.test.ts`, with pretend local storage and a pretend IndexedDB): the old text is byte-identical in its new place after the move, and the old key is removed only after both read-backs matched; with IndexedDB failing, the old key is left alone; with the new key's first write failing for lack of room, the old key is removed (its copy verified) and the write tried again; with it still failing, the state says `unsaved` and **a later start never converts over a v2 key that exists**; loading twice changes nothing; a backup entry exists for each idea once, also after a second tab and a cloud merge; the idea on screen has its own backup entry (never saved, and saved with unsaved changes); a deleted backup stays deleted; a backup opens as a new restored idea; a version 2 backup file carries the originals and Restore brings them back on a machine with no old blob; an idea just opened is not "changed" (`fingerprint5`); saving a rhythm in a second tab reaches the first (`joinOtherTab5`).

**Old copies that turn up later** (`arrive`, each row of the table in B.3): an older copy is ignored; a newer copy replaces an idea that was not edited since conversion, silently; a newer copy of an idea that was edited arrives beside it once, named "(edited in the old version)", and a second sync does not add it again; a converted idea keeps the old `updatedAt`, so two devices that both converted do not overwrite each other.

---

## C. Playback

### C.1 The chain

`TimelineSong` → `flatten` → `PlayItem[]` → `ProgressionPlayer.start / update / relist` → `schedule()` (unchanged). `renderSong` (WAV, recording backing) and `progressionToMidi` take the same list, so they follow for free. The Rust engine still only gets rendered stereo samples.

```ts
// src/timeline/flatten.ts
export interface FlattenCtx {
  /** guitar shapes for a clip's chords (copied from GuitarView.tsx:94-135 into src/timeline/voicing.ts in step 0; needs tuning, capo, the user's shapes) */
  voicingsOf(chords: ProgChord[], arrange: ArrangeSettings | undefined): (Voicing | undefined)[];
  /** a take's decoded audio, when it is loaded (audio/takebuffers.ts) */
  buffer(take: Take5, dry?: boolean): AudioBuffer | undefined;
  /** tracks to be heard without their effects (the sound window's bypass, E.3); never stored */
  bypass?: ReadonlySet<string>;
}
export interface Range {
  /** the stretches to play, in song order (one for plain play; the loop's regions when looping) */
  spans: Region[];
  loop: boolean;
  /** make sure an item starts exactly on this beat, and give it `from` (used to start inside a loop, and by relist while playing) */
  cut?: number;
}
export interface Flat {
  items: PlayItem[];
  /** the song beat each item starts on (replaces today's block-and-chord `map`) */
  at: number[];
  /** the song beat on which each item's pseudo-section starts */
  origin: number[];
  loop: boolean;
  /** is there anything to hear? */
  any: boolean;
  /** where the song ends: `songEnd(song)` */
  end: number;
}
export function flatten(song: TimelineSong, ctx: FlattenCtx, range?: Range): Flat;
/** Where the music is on the song line, from the player's own report. */
export const songBeat = (flat: Flat, pos: { index: number; beat: number }): number => flat.origin[pos.index] + pos.beat;
```

`ProgressionPlayer.position()` reports beats into the item's section (`audio/synth.ts:499-507`); for an item given `from` the engine counts from `at - from`, so `origin + pos.beat` is the song beat in every case.

### C.2 Pseudo-sections (`src/timeline/cuts.ts`)

The engine counts drum steps, melody ticks and playing styles from one shared start per group of items (`sectionStart`, `audio/patterns.ts:278`). `cutPoints(song)` chooses those starts. A cut is always on a bar line. There is a cut at bar line `L` when any of these holds:

1. the time signature changes at `L` (a clip that lies across the change is cut there too, see C.7);
2. no unmuted note clip on any track crosses `L` (audio clips do not count);
3. on some drums track, the rhythm sounding before `L` and the one after it differ in steps per beat (`div`) or in swing (a flattened drum part has one of each);
4. the swing or the triplet grid that the lead drums track gives the other tracks (C.3) is different just before and just after `L`;
5. the stretch since the last cut would pass 32 bars (the limit of `melodyBars` and of a drum pattern, `song/melody.ts:14`, `audio/beats.ts:383`): cut at the bar line in the last 32 bars that the fewest clips cross, the latest on a tie.

Rule 3 can only be met on a bar line because drums clips start and end on bar lines (A.6 rule 1). One case can still put two rhythms into one bar: a drums clip moved into a stretch with another signature, whose length is then not a whole number of those bars. `flatten` then gives that bar to the clip that starts in it: the earlier clip is silent from the bar line before the meeting point (C.7).

For a converted song **every old section line is a cut** (rule 2, since no clip crosses a section line), so it plays as today. Rule 2 also cuts at the bar lines inside a stretch where no note clip plays at all (an old section that was empty or held only vocals); those extra cuts change nothing that is heard. Rules 3 to 5 are "forced" cuts and are only reached by new arrangements (drum clips of one rhythm stamped bar after bar force none). What a forced cut costs: a chord, a held note, a synth arp or a drone that crosses it is struck again at the cut (C.7).

### C.3 What `flatten` writes

For each pseudo-section `P` (start `P0`, signature `sig`, bar length `bar`, `n` bars):

**Items (the time grid).** All items are silent: `midi: []`, `tune: null`, no `drums`; the host passes `null` for the player's fallback beat and tune. Every track, the lead ones included, plays through `extra`. They are cut like this:

- one item for each chord (rests too) of the **lead chords track** in `P` (the tracks with `lead`; clip edges and repeats applied; a clip silenced by `instead` or by the mixer still counts, a muted clip does not), each as long as that chord. Where two lead chords tracks sound at once (only after the user has moved clips), the topmost one is the lead for the pulse and the pedal, and the item edges are the union of both tracks' chord edges;
- a `pad` item for every stretch of `P` where the lead chords track is silent;
- a pad is cut again at every bar line, **unless** a melody or bass track in `P` plays a piano with the pedal on (the engine changes such a pedal at every item, `audio/synth.ts:833`; for those the old cut is kept so the pedalling is exactly as today).

This reproduces the old list's item boundaries for a converted song (the old items are the first chords track's chords plus one pad), and gives a bar-by-bar grid everywhere else, so an edit or a tempo change is heard from the next bar. The first item of `P` has `section: true`. Every item has `meter: { bar, triplet, sig, swing }` and the same `extra` object.

**`meter.triplet` and `meter.swing`** come from the lead drums clip sounding at `P0`, if it is not muted: `triplet = isCompound(sig) || div === 3`, `swing = div === 4 ? groove.swing : 0`. With no such clip: `isCompound(sig)` and `0`. This is today's rule (`meterOf`, `audio/patterns.ts:227`) with "the first drums track of the section" replaced by "the lead drums track". `meter.swing` is engine touch E2 (C.6).

**`extra.chords`**: for every unmuted chords clip that reaches `P`, every cycle (`cycles(clip)`), every chord of the content inside the frame (`inFrame`, `song/frame.ts:41`): `{ track, at, beats, midi, style, feel, sound, tone }`.
- `at` = song beat of the chord minus `P0`; chords are cut at the clip's edges and at the end of `P`. A chord that began before `P0` is listed at `at: 0` with what is left of it.
- `midi` is exactly the rule of `GuitarView.tsx:250`: a rest is `[]`; else the chord's written notes (`playedNotes(chord)`); else, **only when the track's tone is on the keys** (`onKeys(tone)`), `keysVoicings(chords, tone)[i]`; else the guitar shape's notes **with the unplayed strings filtered out** (`voicingsOf(...)[i]?.midi?.filter((m) => m !== null)`); else `[]`. Worked out once per clip content and tone, kept in a `WeakMap`.
- `style`, `feel` from the clip's content; `sound = one(reviveSound(track.sound))`, `tone = one(track.tone)`.
- A clip with `instead: U` silences the chords of track `U` over its own span while its own track is not muted and it has a chord that is not a rest (today's `insteadIn`, `song/tracks.ts:514`).

**`extra.tunes`**: one `PlayTune` per melody or bass track with unmuted clips in `P`: `{ m: { div: 4, bars: n, notes }, bar, swing, sound, tone }`. `notes` holds every note of every cycle of every such clip that falls inside both the clip and `P`, with `at` rewritten to twelfths of a beat from `P0`. A note that would be held past the end of its clip gets `len` = the ticks to the clip's end (engine touch E1).

**`extra.drums`**: one `Beat` per drums track with unmuted clips in `P`: `onKit({ steps: bar * div, div, bars: n, swing, rows, on: true, patternId: null, name: "" }, track.kit)`, where `rows` is each clip's rhythm written out step by step over `P` (cycles and offsets applied, silence elsewhere). Its position no longer depends on where `P` starts. The `Beat` object is kept per `(track, P)` while its inputs are the same objects, so the player's "did the beat change" test (`syncLane`, `audio/synth.ts:904`) stays cheap.

**`extra.takes`**: for every unmuted audio clip that reaches `P`, one `PlayTake` per cycle: `{ track, buffer, at, offset, dur, id, joined }` with `at` in beats from `P0` (negative when it began earlier), `offset` and `dur` in seconds. `id` is the clip id for the first cycle and `<clip id>#k` for repeat `k`, because the player lets each id sound once per stretch (`audio/takeplay.ts:141`). Repeats are not `joined`, so each restart gets the usual 5 ms fades. Two clips of one take that touch in time and in the take (the same `zero` beat of A.7, and one's `off + frames` equal to the other's `off`) are `joined`, as today. Where a clip runs into the next clip on its track (after a tempo change), its `dur` is cut at the next clip's start. A track in `ctx.bypass` plays its takes' dry files.

**Shared objects.** Equal sounds, tones and kits must be the same object across items (`one()`, today at `GuitarView.tsx:230`). With one sound per track this needs no growing store: the played sound is `reviveSound(track.sound)` remembered in a `WeakMap` keyed by the track's own `sound` object (and the same for `tone` and `kit`), so a knob step makes one new object and the old one is let go with the old track object.

**Range.** With no range the list is the whole song. With a range, each span's items are cut with `sliceItems` (`song/frame.ts:100`); the first item of each span gets `section: true` and `from` = its beat minus `P0`, so a chord, a rhythm or a take already under way is heard from there (`audio/player.test.ts:86,162`); the first item of each span after the first also gets `jump: true`. `cut` makes an item start on that beat and gives it `from` too. `start(…, fromIndex)` is used only to start inside a loop region, always at an item that carries `from` (C.4).

**Cost.** `flatten` is built per pseudo-section and each part is kept in a `WeakMap` keyed by the clip and track objects it read, so an edit rebuilds one pseudo-section of one track. The whole song is not walked on every knob movement (map-ui 6.2 names that as today's main cost).

### C.4 Loop, play from the cursor, and edits while playing

Host: `src/ui/timeline/usePlayer.ts`, built in step 1c (it takes over `GuitarView.tsx:531-638` and the update effect at `:541-570`). The track view itself never plays anything: it is given a `PlayerApi`.

```ts
export interface PlayerApi {
  playing: boolean;
  toggle(): void;                       // Space
  stop(): void;
  /** the song beat that is sounding, or null */
  getBeat(): number | null;
  /** move the cursor; while playing, the music restarts from there */
  seek(beat: number): void;
  /** go round these bars of the song as it is heard now (the composer strip's ▶); `solo`: only that track is heard. null ends it */
  audition(span: Region | null, solo?: string): void;
}
/** `heard` is the song as it should sound now: the stored song, or that with a focused draft or a Harmonize candidate laid in (E.2, E.5). */
export function usePlayer(heard: TimelineSong, session: Session, ctx: FlattenCtx): PlayerApi;
```

**Starting.**

- Loop off: `flatten(heard, ctx, { spans: [{ from: cursor, to: end }], loop: false })`. The music stops at the song's end. On stop the play line goes back to the cursor, so Space twice replays the same spot.
- Loop on, cursor outside every region: `{ spans: regions, loop: true }`, from the first region's start.
- Loop on, **cursor inside a region: from the cursor**, then round the regions as usual (as the reference program does). `flatten` is called with `cut: cursor`, which makes an item start exactly there and gives it `from` (its beat counted from its pseudo-section's start); the player is started at that item's index. An item with `from` sets its own section start (`sectionStart`, `audio/patterns.ts:278`), so drums, melody and styles are in phase from the first step and stay so on every later round. The host keeps the same `cut` in every re-flatten until the music stops, so the list keeps its shape.
- Loop edges are any beat (the ruler snaps to bars; Shift snaps to beats). With several regions the first item of each later region carries `jump: true` (the flag the engine already has for a seam, `GuitarView.tsx:349`).
- Before the first note the host does what `togglePlay` does today: instruments ready (`readySlots`), the recording engine closed (`freeInterface`).

**An edit while playing.** Every item of the new model is silent (C.3), so a cut costs nothing audible; what matters is that the player's running section start stays true.

- Use `update` (heard from the next step or chord) **only when the two lists agree item by item in count, length, `from`, `Flat.at[i]` and `Flat.origin[i]`**. Today's test also needs the same section and the same `from` (`song/loops.ts:158-161`); `origin` is the new model's "same section". Without it a cut can move while no item changes (a melody clip's edge dragged across a bar line where a cut was), the rebuilt `extra` then counts from the new start while the player counts from the old one, and other bars' drums and chords play until the next cut.
- Otherwise use `relist(items, loop, at)` (it sets the origin from the new list, `audio/synth.ts:618-637`): the host takes the song beat `b` the old list would have played next (`old.at[next]`), flattens the new song with `cut: b`, and returns the index of the item that starts at `b`. The music goes on with no gap and no jump.
- **`next` may equal the old list's length** (it was about to end or go round; `old.at[next]` is then undefined). The host returns the index of the loop's first item when looping, and the new list's length when not (the song then ends, as it was about to).
- **The loop changed or was switched while playing**: also `relist`, mapped by song beat. When `b` lies in no region of the new loop: the first item of the next region after `b` in song order, else index 0. `queue` is not used (it waits for the end of the section playing, `audio/synth.ts:674`, which could be 32 bars).
- **A click on the ruler while playing**: with the loop off, or inside a loop region, the music restarts there (80 ms, as any start). **Outside the regions while looping, the click only moves the cursor**; the loop plays on.
- Lists by generation are kept as today (`GuitarView.tsx:357`), holding `Flat` instead of the block map, so a position reported for an older list is read against that list.

Tests for this section go into `flatten.test.ts` and `player5.test.ts` (on the pretend live context): the moved-cut case above (the lists differ only in `origin`: `relist` is chosen, and the drums heard after it are the right bars); `next === length` looping and not; a start inside a region is in phase on the first pass and on the second; two regions give one `jump`.

### C.5 Per-track effects on the existing buses

| Track kind | Bus today | In the new model |
|---|---|---|
| chords, melody, bass | `TrackVoice` (instrument → rack → `fader(id)`), one per (track, tone, sound) slot (`audio/synth.ts:31-56`) | one slot per track, so exactly one voice per track; reverb through the shared rooms as today |
| drums | one desk per track (`audio/drumbus.ts:109`) set to the kit | one desk per track, set once (the kit no longer changes at section lines) |
| vocals, audio | take buffer → 5 ms fades → `fader(id)`; the vocal chain is baked into the take's second file by the desktop engine | unchanged |

The host calls `keepSlots(slotsOf(flat.items), trackIds)`, `setMix(song.mix)`, `setTempo`, `prepareNotes` exactly as `GuitarView.tsx:383-397` does. `hearOn(kind, { track, kind, tone, sound })` is pointed at the track of the plugin window that has the focus, so a tap in a composer and a knob turned in a sound window are heard on that track, and a knob drag re-tunes the track's one voice in place (`audio/synth.ts:84-92`).

### C.6 Engine touches (three, all additive; old tests pass unedited)

| | Change | Where | Why | When |
|---|---|---|---|---|
| E1 | `MelodyNote.len?: number` (twelfths of a beat). When present a note on the keys or synth is held `min(len, time to the next note)`; `tuneSection` uses it too | `song/melody.ts`, `audio/trackplay.ts:167`, `audio/synth.ts:826`, `renderSong` | a melody clip's last note must stop at the clip's end, not at the next bar-line cut; later the same field gives bass notes a length | release 1 |
| E2 | `PlayItem.meter.swing?: number`; `meterOf` uses it when given | `audio/patterns.ts:227-242` | chord styles follow the lead drums' swing without routing a drums track through the reserved first-drums channel | release 1 |
| E3 | `ExtraPlay.chords[].from?: number`: the beat the style's pattern counts from (default: the pseudo-section start, as now) | `audio/patterns.ts:264`, `audio/synth.ts:760`, `renderSong` | the 7 playing styles longer than one bar, and half-speed feel, count from their clip's start | release 3 |

Each has its own test, written before the change. If E2 is refused, the fallback with no engine change is a silent `Beat` on `item.drums` carrying only `div` and `swing`; it works but keeps an unused drum desk alive.

Known and accepted with no change: the player makes one resting voice for the reserved id `"chords"` (it calls `voiceFor` for every item, `audio/synth.ts:744`). It never plays and a resting voice costs nothing (`audio/synth.ts:98`).

### C.7 Limits that remain after release 1

1. A clip that lies across a time-signature change is cut at the change (C.2 rule 1): what crosses is struck again there, like any forced cut.
2. A chord, a held note, an arp or a drone that crosses a forced cut (C.2 rules 3 to 5) is struck again there.
3. Multi-bar and half-speed styles count from the pseudo-section start until E3 (release 3).
4. A drum kit's noise bed runs for the whole pseudo-section its track plays in, not only under its clips.
5. Two drums clips of different grid or swing that meet inside a bar (only possible for a clip moved into another signature and not refitted): that bar belongs to the clip that starts in it; the earlier one is silent from the bar line before.
6. A tempo change does not stretch recorded audio. `setTempo` keeps each clip where it was sung, counted from its take's first frame (A.7), so split halves stay joined; the clip's length in beats changes, and where it then runs into the next clip it is cut there in playback (nothing stored is lost). This is today's behaviour (the anchor bar holds and the rest drifts).
7. Two lead chords tracks that overlap in time: the topmost one sounding sets the bar pulse and the piano pedal; item edges are the union of both tracks' chord edges.

### C.8 Crackle rules (from map-audio section 5) and how this design keeps them

| Rule | Kept by |
|---|---|
| One voice per distinct sound, never per knob step | sound per track = one slot per track; `hearOn` follows the focused window |
| Booked 0.25 s ahead; 1 s around heavy page work | `bookAhead()` (`audio/synth.ts:402`) is called when a plugin window opens or closes, the Canvas opens, a zoom or ruler drag starts, a clip is dropped, a track is added |
| Nothing on the page may run longer than the look-ahead | only clips in view are drawn; the play line is one element moved by `requestAnimationFrame` with no React state per frame (the pattern at `TrackPage.tsx:156-178`); a closed or covered window stops its own frame loop |
| Voices rest; effects at 0 are disconnected; shared reverb rooms | untouched engine code |
| The interface is never played by two programs | the hand-off rules in `audio/handoff.ts` stay; "the Vocals page is on screen" becomes "the record window is open" (F.5). An armed track alone never opens the interface |
| Storage writes on every knob movement | writing the state to local storage is debounced to 400 ms and flushed on `pagehide`, on idea change and before a recording starts |

Before release 2 is cut, measure the audio thread with 16 and 24 tracks (the only figure today is 9 tracks, 47.6 % of one core). No cap is built in.

---

## D. Track view (Windows desktop first)

Files: `src/ui/timeline/TrackView.tsx`, `TopBar.tsx`, `KeyPopover.tsx`, `Ruler.tsx`, `TrackHead.tsx`, `Lane.tsx`, `ClipView.tsx`, `ClipActions.tsx`, `AddTrack.tsx`, `gestures.ts`, `keys.ts`, `draw.tsx` (the four small drawings copied from `TrackPage.tsx:354-413`), and `src/ui/timeline.css`.

**The track view reads no app state.** Everything comes in as props, so it can be built and shown on a fixture page before the app is switched over, and tested without storage:

```ts
// src/ui/timeline/TrackView.tsx
export interface TrackViewProps {
  song: TimelineSong; keyOf: Key; session: Session;
  /** every change of the song: the host applies it and makes one undo step */
  edit(label: string, fn: (s: TimelineSong) => TimelineSong): void;
  setSession(fn: (s: Session) => Session): void;
  player: PlayerApi;                                   // C.4
  /** open a plugin window (the host decides what that is in each release) */
  open(kind: "compose" | "sound", track: string, clip?: string): void;
  /** a take's waveform peaks for the lane, when its audio is loaded */
  peaks?(take: Take5): Float32Array | undefined;
  clipboard: { copy(ids: string[]): void; paste(at: number, onto: string | null, insert: boolean): void; has: boolean };
  sound: { copy(track: string): void; paste(track: string): void; has(track: string): boolean };
  top: TopBarProps;                                    // key, tempo, signature, undo/redo, save, export, Canvas, Ideas, Settings, record: values and callbacks
  /** which lanes a strip drag may land on, while one is going (E.2) */
  dropKind?: ClipKind | null;
}
```

### D.1 Layout

```
┌ top bar ────────────────────────────────────────────────────────────────────────────────────┐
│ ▶ ↻ ● mon │ 5.1 · 0:12 │ B major │ 96 │ 4/4 │ ↶ ↷ │ Idea name  Save │ Export │ Canvas │ Ideas │ ⚙ │
├───────────────┬─────────────────────────────────────────────────────────────────────────────┤
│ Follow − fit +│ ruler: markers · bar numbers · signature flags · ▓▓ loop regions ▓▓   ┤ 20 bars │
├───────────────┼─────────────────────────────────────────────────────────────────────────────┤
│ track panel   │ lane with clips                                                             │
│ track panel   │ lane with clips                                      ┆ cursor   │ play line │
│ + add track   │                                                                             │
├───────────────┴─────────────────────────────────────────────────────────────────────────────┤
│ sideways scroll bar (always shown)                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

Sizes on a 1280 × 800 window: top bar 48 px high, ruler row 36 px, panel column 260 px, so the lanes are 1020 px wide; a track row is 64 px, so ten tracks show without scrolling. The track panels and lanes share one vertical scroll box, so rows cannot drift apart (today they are two columns kept in line by equal heights, `styles.css:885-908`). The ruler and the panel column are sticky.

**How far the timeline reaches.** The lanes always run to at least one screen width past the song's end, and never to fewer than 32 bars, so a new song has somewhere to put a clip. An idea opens on "fit" (the whole song across the lanes), but never showing fewer than 16 bars: an empty song opens at 16 bars across, about 16 px a beat in 4/4.

**Top bar, left to right**

| Control | Does | Comes from |
|---|---|---|
| ▶ / ■ | play from the cursor (or round the loop) / stop | `togglePlay`, `GuitarView.tsx:574` |
| ↻ | loop on/off; with no region yet, loops the selected clip's bars, else the bar under the cursor | `GuitarView.tsx:649` |
| ● | record onto the armed track; with none armed it first arms the selected audio track, else the top one. Shown when the song has an audio track. Carries the mic-live dot | `VocalsPage.tsx:365` |
| mon | monitor: Direct / Through effects. One control for the whole app (it is one studio setting), shown beside ●; carries the mic-live dot too | `VocalsPage.tsx`, `studio.monitor` |
| position | bar.beat and minutes:seconds; song length in its tooltip | `FrameSections.tsx:372` |
| key | opens the key popover: home note, mode, "More…", scale notes with ▶, "Move song" − ½ / + ½, and the note "Vocals: sung in …" when the takes that play were sung in another key | new `KeyPopover.tsx`, **ported** from `KeyBar` (`GuitarView.tsx:988-1061`): the old one writes `s.progression` with the old mutators, so it cannot be mounted as it is. It takes `keyOf`, `onKey(key)` and `onMove(n)`; the host's `onMove` calls `transpose` (A.4) and sets the key in the same undo step |
| tempo | drag the number or click for the slider and − / +; shows "Vocals: recorded at N bpm" with a button back to that tempo when the takes that play were sung at another | `GuitarView.tsx:1543-1549, 1646-1664`; `setTempo` (A.7) |
| time signature | popover with the nine signatures and "from this bar on"; shows "Vocals: recorded in 3/4" when it applies | `GuitarView.tsx:1636, 1652-1658` |
| ↶ ↷ | undo, redo (greyed when there is nothing) | A.8 |
| idea name, Save | as today | `App.tsx:78` |
| Export | popover: WAV, MIDI, Chords + tab | `GuitarView.tsx:1667-1674` |
| Canvas | opens the Canvas **overlay** (E.5) | `CanvasPage` |
| Ideas, ⚙ | the two sheets as today | `IdeasPanel`, `SettingsPanel`, `Desktop.tsx:50` |

Popovers are the app's quiet inline kind: opened under their button, closed by Escape or a click elsewhere. No modal.

**Ruler row**

- At its left, over the panel column: the **Follow** switch (the view turns a page when the play line leaves it, as `TrackPage.tsx:169`) and − / fit / +.
- Bar numbers thin out when bars are narrow (every 1, 2, 4, 8, 16), as `TrackPage.tsx:260`. A small label at the song's end says how long the song is ("20 bars").
- **Drag** across it: sets the loop to that stretch (snaps to bars; Shift: beats) and turns the loop on. **Ctrl + drag adds another stretch** to the loop. Each region is a band on the ruler and a faint tint down the lanes. Drag either end of a band to adjust; drag its middle to move it. A click on a band's ✕ removes that region; Escape with nothing selected clears the loop.
- **Click**: moves the cursor there (snaps to bars; Shift: beats; **Alt: no snap**). While playing, the music restarts there, except for a click outside the loop while looping, which only moves the cursor (C.4).
- **Double-click** an empty part: the loop becomes the whole song.
- **Markers** above the numbers: click = cursor to the marker; double-click = loop from this marker to the next (Ctrl + double-click adds that stretch); this replaces "tap a section's name to loop it". `M` adds one at the cursor and its name is typed straight away (Enter saves, Escape leaves the default name). **F2**, or "Rename" in the marker's right-click menu, renames; drag moves; Delete removes the selected one. Marker editing is in release 1, because the Canvas paints per marker region and the chord sheet is written marker by marker from release 1 on.
- **Signature flags**: a small "6/8" where the signature changes.
- **Right-click on the ruler**: "Insert a bar here", "Insert the looped length here", "Remove the looped time", "Add marker", "Loop the whole song".
- **Sideways scroll**: the scroll bar, Shift + wheel, a trackpad's sideways gesture, or dragging the ruler's empty edge zones.
- **Zoom**: Ctrl + wheel zooms around the pointer (the beat under the pointer stays under it); `+` / `−` keys and the − / + buttons zoom around the cursor; "fit" shows the whole song. Range 2 to 320 pixels per beat (the top end is for cutting a vocal between two words). The wheel listener is not passive and prevents the default, or the browser build would zoom the whole page.
- Plain wheel scrolls the tracks up and down, as every other page does. (The reference program's wheel-zooms default is not copied; its own users complain about it.)

**Track panel** (260 px wide, 64 px high; one row per track; two lines)

| Line | Control | Shown on | Does |
|---|---|---|---|
| 1 | colour strip / grip | all | click selects the track; drag reorders tracks (the sorter from `FrameSections.tsx:167-366`) |
| 1 | kind icon + name | all | double-click the name, or F2, to rename in place (Enter saves, Escape cancels) |
| 1 | dB readout | all | the fader's value |
| 1 | ⋯ | all | a small menu: **Remove track**, Duplicate track (same sound, no clips), Copy sound, Paste sound (lit when the clipboard's sound fits this kind), Colour. Right-click on the panel opens the same menu |
| 2 | **compose** (bass-clef icon, no text, `aria-label="Compose"`) | all | opens the track's composer window (E.2) |
| 2 | **FX** | all | opens the track's sound window (E.3); lit when any effect is on. Alt + click: hear the track without its effects (E.3) |
| 2 | M, S | all | mute, solo (`mix`) |
| 2 | volume | all | −60 … +6 dB, double-click resets (`TrackPage.tsx:293`) |
| 2 | ⟳ | harmony tracks | writes the harmony again for the selected clip of this track (else the clip under the cursor). A clip whose source changed since it was written shows a dot on the clip itself |
| 2 | ● arm | vocals, audio | this track is the one that records; arming one disarms the others. Arming alone opens nothing and is forgotten at the next start (F.2) |
| 2 | input chip | vocals, audio | a short chip ("1", "2", "1+2"); click for the list of inputs and pairs, with "Audio setup…" at its end; a small meter beside it while the interface is open |

Arm and input are always visible on audio tracks (the reference program hides them until armed, which its users trip over). **Removing a track is only ever "Remove track" in the ⋯ menu.** The Delete key never removes a track (D.3). No confirm box: Ctrl+Z brings the track back with its clips, and a track that has clips or takes also shows the 20-second undo toast. Blocked while recording onto it.

**Icons.** The compose button is a bass clef drawn as an SVG in `ui/icons.tsx` (`ClefIcon`: the curl, the two dots, no font character, so it looks the same on every machine). The Bass track's kind icon is a different drawing (four strings), so the two are never confused.

**Add track**: a "+" row under the last panel opens an inline row of six choices: **Chords, Melody, Bass, Drums, Vocals, Blank**. ("Blank" is the audio kind: an empty audio track that records any input.) `Ctrl+T` opens it in the desktop app (a browser keeps Ctrl+T for itself; the + row is the route there). A new track is always a new row with plain defaults (D.4), is selected, and its compose button pulses once. Nothing else opens.

### D.2 Clips: every interaction

A clip shows its small drawing (chord names to scale, melody notes, drum hits in three lanes, waveform), its notches, a signature tag when its `sig` differs from the bars it lies in, a dot when it is a harmony whose source changed, and is faint when muted or when another clip plays instead of it.

**Nothing is a key only.** A selected clip shows a small row of buttons at its top edge (`ClipActions.tsx`): Open, Mute, Split, Duplicate, Copy, Delete, each with its key in the tooltip. Right-click on a clip (long-press on touch) opens the same list as a menu with the names and keys written out, plus, on audio clips, "Hear alone" and "Take ▸" (the other takes of the same spot). Right-click on an empty lane: "Paste here", "New clip here".

| Action | Gesture | Exact rule |
|---|---|---|
| Select | click a clip | selects it and its track. Ctrl + click adds or removes one. A click on a clip does **not** move the cursor. |
| Box select | drag on an empty lane | draws a box; the clips it touches are selected (Ctrl: added to the selection). |
| Deselect, place cursor | click empty lane | cursor to that beat (snaps to bars; Shift: beats; Alt: no snap), nothing selected, that track selected |
| Move | drag the body | starts after 4 px. **Note clips**: the clip's start snaps to bar lines (Shift: beats; drums clips always bar lines). **Audio clips**: the *distance moved* snaps to sixteenths of the bar the clip lands in (`snapMove`, `song/clips.ts:268-277`: sung on the beat, it stays on a beat, and a clip that starts on a breath before the bar is not pulled out of time); Alt or Shift: free. Up and down moves to another track that `accepts` it; lanes that do not are dimmed and show the "not allowed" pointer, and a drop there puts the clip back. Never before beat 0. All selected clips move together and keep their spacing. On drop, `layDown` trims what it covers. |
| Copy | Ctrl + drag | the original stays, a separate copy lands (new id, own content). `Ctrl+D`: a copy straight after each selected clip. `Ctrl+C` / `Ctrl+X` / `Ctrl+V`: copy, cut, paste at the cursor (`copyOut`, `pasteIn`, A.7): one clip onto the selected track if it accepts it, else the first track that does, else a new track made with the copied sound; several clips each onto their own track. A paste moves the content to the current key (`keyShift`, `song/clip.ts:115`). The clipboard outlives an idea change, so clips, and their sound, can be carried between ideas. |
| Repeat or trim | drag the left or right edge (8 px zone, double-arrow pointer) | the window rule of A.3. **Note clips** snap to bar lines and to the points where the content starts again (Shift: beats; drums clips always bar lines); shortest 1 beat. **Audio clips: the edge is free by default** (to the sample, shortest 20 ms, `MIN_CLIP`); Shift snaps to beats. An audio edge dragged outward first uncovers the rest of the take, and repeats only past the take's end. An edge stops at the next clip on the track and at beat 0. While dragging, the clip's length is shown beside the pointer and notches appear as they are crossed. |
| Split | `S`, or Split in the clip's row | with the pointer over a clip: that clip, **at the pointer** (audio: exactly there; note clips: the nearest beat). Otherwise the selected clips at the cursor; with none selected, the clip under the cursor on the selected track. Not inside a clip: nothing happens. |
| Delete | `Delete`, `Backspace`, or Delete in the clip's row | removes the selected clips. Nothing else moves. With no clip selected the key does nothing. A key held down counts once. |
| Mute | `0`, or Mute in the clip's row, or the On / Off switch in its composer's title bar | toggles `mute` on the selected clips (was the Melody and Drums On / Off) |
| New empty clip | double-click empty lane (note tracks) | an empty 4-bar clip at that bar (shorter if another clip is in the way), opened in its composer |
| Open | double-click a clip, Enter, or Open in the clip's row | its composer window opens on that clip (audio: the record window, with that clip selected) |
| Undo, redo | `Ctrl+Z`, `Ctrl+Shift+Z` or `Ctrl+Y`, or ↶ ↷ | every action above, every composer edit, every sound change, the mixer, the key |

Gesture code: the clip drag and edge grips reuse the pointer-capture pattern of `TakeLane.tsx:236-312` (tap versus drag threshold, `data-edge` grips, snap with a modifier to free). Positions are set on the element by `transform` during the drag; the song changes once, on release.

### D.3 Keyboard

| Key | Does |
|---|---|
| Space | play from the cursor / stop |
| Home / End | cursor to the start / the end |
| ← / → | cursor one bar (Shift: one beat) |
| L, R | loop on/off (R is what the reference program's users press) |
| Ctrl+R | record on the armed track / stop (desktop app; in a browser the ● button is the route, the browser keeps Ctrl+R) |
| S | split (D.2) |
| Delete, Backspace | delete the selected clips (or the selected marker). **Never a track.** Key repeats are ignored |
| 0 | mute the selected clips |
| Ctrl+C, X, V, D | copy, cut, paste, duplicate |
| Ctrl+A | select every clip inside the loop regions (with no loop: every clip) |
| Ctrl+Shift+V | paste at the cursor, first pushing everything after it later by the clipboard's length |
| Ctrl+Shift+Delete | remove the looped time on every track and close the gap |
| Insert, Shift+Insert | add one empty bar at the cursor on every track (Shift: the looped length) (`insertTime`) |
| Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y | undo, redo |
| Ctrl+T | add a track (desktop app) |
| Ctrl+S | save the idea |
| M | marker at the cursor, name typed at once |
| F2 | rename the selected marker, else the selected track |
| + / − | zoom in / out |
| Enter | open the selected clip in its composer |
| Escape | one thing per press, the first that applies: leave the Canvas's full screen; close the open sheet or popover; close the shape finder; close the focused window; deselect; clear the loop |
| K, and the take list's keys | as today inside the record window (`VocalsPage.tsx:527`) |

**Who gets a key** (`src/ui/timeline/keys.ts`, one listener on the window). The old components listen on the window too, not by focus (`VocalsPage.tsx:586-595`, `TakeLane.tsx:318-343`, `ShapeFinder.tsx:72-77`, `HarmonyPicker.tsx:130-134`, `IdeasPanel.tsx:26-30`, `CanvasPage.tsx:677-682`), and focused controls use the same keys as the timeline (a synth knob resets on 0, Delete or Backspace, `SynthPanel.tsx:226-234`; sliders and EQ points use the arrows, Home and End, `EqGraph.tsx:64-67`). So the rule is written down:

1. **Space** is taken in the capture phase, on key-down and on key-up, and its default is prevented, unless the target is a text field, a select, or the take list (where Space hears the selected take, as today). So Space always plays and stops, and never "clicks" the grid square or button that happens to have the focus (the drum and melody grids are made of buttons, `DrumMachine.tsx:343, 670`, `MelodyGrid.tsx:385`). Buttons keep Enter.
2. The global listener ignores any event that is already handled (`defaultPrevented`).
3. When the focus is inside a plugin window, a sheet, a popover or any control (input, select, slider, a button inside a window), the global listener handles **only Space, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, Ctrl+S and Escape**. Every other key belongs to what has the focus.
4. Every old window-level listener is gated on "my window has the focus" (a `focused` flag from the window manager replaces `active`). The Vocals page's own Ctrl+Z listener and undo stack are switched off in host mode (F.3): its edits are global history steps.
5. Escape is owned by the window manager (the order in the table); the separate Escape listeners of the old sheets are gated the same way, so one press does one thing.

### D.4 A new track's defaults

| Kind | Defaults |
|---|---|
| Chords | Guitar, `SOUND_DEFAULT`, new clips: style "ring" (`PLAIN_STYLE`) |
| Melody | Guitar, `SOUND_DEFAULT` |
| Bass | Synth on the first preset of the "bass" category (`synth/presets.ts`). Its grid is two octaves lower than a melody's **from release 1** (`MelodyGrid`'s `low` prop, E.2), so a low note can be written the day the track can be added; the seven-octave grid comes in release 4 |
| Drums | `PLAIN_KIT` (`song/tracks.ts:157`) |
| Vocals | vocal chain on with its default preset, input 1 |
| Blank | vocal chain **off**, input 1 |

The first chords track and the first drums track of a song get `lead: true`. When a lead track is removed, the top track of its kind becomes the lead.

### D.5 What is drawn, and when

- Only clips that intersect the visible beats (plus one screen each side) are mounted. Each `ClipView` is `memo`'d on the clip object and the zoom.
- The four small drawings are today's (`ChordBlock`, `MelodyBlock`, `DrumBlock`, `TakeBlock`), given a clip's content and its cycles instead of a section.
- The play line and the cursor are two absolutely placed elements; the play line is moved by one `requestAnimationFrame` loop reading `player.getBeat()`.
- `hands.ts:43` and `App.tsx:60` look for `section.transport`, `nav.tabs` and `.topbar`; the top bar keeps the class `topbar`, its transport group keeps the class `transport` on a `section`, and `ui/hands.test.ts` is the one existing test changed on purpose in release 1.
- **On a phone** (width up to 760 px or a coarse pointer) the same view works from release 1: every action has a button (the clip's row, the ⋯ menu, ↶ ↷, the + row), a long-press opens the clip menu, and plugin windows are bottom sheets (E.1). The tuned phone layout is release 7.

---

## E. Plugin windows

### E.1 The window (`src/ui/windows/Window.tsx`, `src/ui/windows/windows.tsx`)

```ts
export interface WinState {
  id: string;                          // "compose:<track id>" or "sound:<track id>"
  kind: "compose" | "sound";
  track: string;
  /** what the composer has open: a placed clip, or (none) the track's draft */
  clip?: string;
  x: number; y: number; w: number; h: number;
  open: boolean;
}
export interface WindowsApi {
  open(kind: "compose" | "sound", track: string, clip?: string): void;
  close(id: string): void;
  focus(id: string): void;
  focused: string | null;
}
export function Window(props: { win: WinState; title: string; tools?: ReactNode; children: ReactNode; strip?: ReactNode; focused: boolean; onFocus(): void; onClose(): void; onMove(r: Pick<WinState, "x" | "y" | "w" | "h">): void }): JSX.Element;
/** Where a window opens the first time (it has no remembered place yet). */
export function firstPlace(kind: "compose" | "sound", view: { w: number; h: number; panel: number; top: number }, beside?: WinState): Pick<WinState, "x" | "y" | "w" | "h">;
```

- A fixed-position box: a title bar, the body (scrolls), an optional strip at the bottom.
- **Title bar**, left to right: kind icon, track name, what is open ("bars 5–8" or "draft"), the mute/solo mark (`MixMark`), the "X plays instead" chip (a click brings that track's window forward), then the tools: the open clip's **On / Off switch** (the clip's mute; not shown for a draft), **bars on screen** (`BarsControl`, the same control the old strip had), the **Sound** button (same icon as the panel's FX; opens the track's sound window docked beside this one), ✕.
- **Where it first opens** (`firstPlace`). A composer docks across the lower part of the lanes: left edge at the panel column's right edge, full width of the lanes, height the smaller of 440 px and 55 % of the window, bottom edge at the bottom of the window (on 1280 × 800: x 260, y 360, w 1020, h 440). The track list then scrolls so the window's own track is in view above it. A sound window opens 420 px wide down the right side of the lanes; opened from a composer's Sound button it sits beside the composer, which gives up that width. After that a window opens where it was last left.
- **Drag** by the title bar, **resize** by the bottom-right corner; both by pointer capture and `transform`, written to `WinState` on release. Kept inside the screen. Positions are remembered per window id in `Session.windows`.
- **Stacking**: z-index 45 to 59 (the free band between the lifted tray at 40 and sheets at 60, map-ui 4.2). A press anywhere in a window brings it to the front and gives it the focus. The drag ghost (90), toasts and sheets stay above.
- **The body is the anchor for pinned children.** The old Chords page pins its mini tray, its lifted shape finder (full screen) and the harmony sheet to the screen (`styles.css:221-223, 517, 1324`). The window body carries a `transform`, which makes `position: fixed` children lay out inside it, so those three stay in their window.
- **One composer window and one sound window per track.** Opening another clip of the same track retargets its composer window.
- **Escape** closes the focused window (after anything open inside it, D.3). The manager owns Escape.
- **Closing hides, it does not unmount** (from release 2), while the idea is open, so a drum edit in progress and the grid's place survive (map-ui 6.3 point 7). A hidden window stops its frame loop (`active = false`) and does no work: its lens returns the same objects while its clip and track are unchanged (E.4). In release 1 a closed window is unmounted.
- `bookAhead()` is called on open and close.
- Focus sets `hearOn` to the window's track (C.5); the host owns `hearOn`, never the page inside.
- **During a drag from the clip strip** the window lets the pointer through and turns 35 % see-through everywhere except its strip, so every lane under it can be reached (E.2).
- **Phone** (width up to 760 px, or a coarse pointer), **from release 1**: the same component renders as a full-width bottom sheet with the existing `.sheet` look, one at a time, no drag or resize.

### E.2 Composer plugins

**What the compose button opens.**

- Release 1 (no drafts yet): the track's selected clip; else the clip under the cursor; else its first clip. Only a track with no clips at all opens on nothing, and the first thing written makes a 4-bar clip in free space at or after the cursor's bar. **It never lays a clip over existing material.** FX follows the same rule.
- From release 2: the compose button opens the track's **draft**. Double-clicking a clip opens **that clip**. Whatever is open is edited in place: there is no "apply".

**A draft has an assumed place** (A.5): the bar line at or before the loop's start when the loop is on, else at or before the cursor. Everything that needs to know "where" uses it:

- **Hearing it with the song.** While a draft's window has the focus, what plays is the song with the draft laid in at its anchor on its own track (`previewSong`, the same kind of preview song Harmonize's audition builds; in the preview only, it covers that track's clips there). So Space and ▶ play the song with the draft in it, and a bass line can be written against the chords before it is dropped.
- **The chords over the melody and bass grid** and **Harmonize's sources** are read under the draft's bars.
- **Its time signature** is the one at the anchor when the draft was started (`Draft.sig`); "Fit to these bars" refits it if the anchor has moved to another signature.

**The clip strip** (`src/ui/windows/ClipStrip.tsx`), at the bottom of every composer window, from release 2:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ New │ ▶  alone │ [ the clip, drawn as it will look on the timeline ] │ 4 bars − + │ ⧉ ⎘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

- **New** (at the left end, away from − and +) starts a fresh empty draft. It is one undo step.
- **▶** goes round the open clip's bars (a draft: its bars at the anchor) **with the rest of the song** (`player.audition(span)`); the **alone** switch beside it makes that the track on its own (`player.audition(span, track)`). A rhythm, a kit or a playing style just picked plays at once, as today (`GuitarView.tsx:719-729`): if nothing is playing, ▶ starts.
- The middle shows the clip being composed with the same small drawing the timeline uses.
- **Drag it onto the timeline.** The moment the drag starts, every lane that accepts the clip gets an accent outline, every other lane dims to 40 % with the "not allowed" pointer, and the window lets the pointer through (E.1). Over an accepting lane a ghost of the clip's real length snaps to the bar under the pointer (Shift: beats, not for drums). On release a **separate copy** lands there (`placeDraft` for a draft, `copyClips` for a placed clip) and trims what it covers. Released anywhere else, the ghost glides back and nothing changes. A drums clip can therefore only land on a drums track.
- **After a drop the window is on the clip just placed** (its title changes to "bars 9–12"), so the next change is heard in the song. The strip still stamps separate copies when dragged again. The draft is kept as it was; the compose button goes back to it.
- "N bars − +" sets the content's length (`setBars` for drums, `setMelodyBars`, the frame for chords), with the quick lengths 1 2 4 8 12 16 24 32. When the open clip showed its whole content once (`off === 0 && len === contentBeats`), its length follows; otherwise only the content changes.
- ⧉ copies the open content to the clipboard; ⎘ pastes the clipboard's content into the open clip (moved to the key, fitted to the clip's signature, with the "past the end" warning).
- "Fit to these bars" appears in the strip only when the open clip's signature differs from the bars it lies in.
- The drag reuses the chord-drag engine (`ui/drag.tsx`, `GuitarView.tsx:836-928`: 6 px start, long-press on touch, ghost moved by `transform`, auto-scroll near edges, the click that ends a drag swallowed). `Payload` becomes a union: `{ type: "chord", ref, voicingId?, slotId? } | { type: "clip", kind: ClipKind, from: { track: string; clip?: string } }`. Lanes carry `data-lane="<track id>" data-kind="<clip kind>"` for the hit test.

**What each composer mounts and edits** (final form; release 1 reaches the same components through the legacy window, H)

| Track kind | Mounted | Edits | Notes |
|---|---|---|---|
| Drums | `DrumMachine` with `show="compose"`: the **Kit picker** beside the Rhythm picker (as the Drums page starts today, `DrumMachine.tsx:44`; it writes `track.kit`), the Rhythm drawer with every library group and "Mine", Edit / Undo / Cancel / Save, brush, Vary, copy bar, clear bar, bar tabs, the nine-drum grid, Swing. On / Off is the title bar's switch | `beat = onKit(clip.content, track.kit)`; `setBeat` writes `grooveOf(beat)` to the clip through `setContent` (fitted to `clip.sig`) and the kit half to the track | adapter: `trackId` and `resetKey` props replace `state.progression.focus.drums` and `song.current` (`DrumMachine.tsx:139, 206-212`). A drum name tapped opens that drum in the sound window; so does the title bar's Sound button. Saved rhythms and kits (`myBeats`, `myKits`) are read and saved as today. A picked rhythm repeats inside the clip; it never changes the clip's length |
| Chords | `ChordBoard`, `Dock` (tray, slots, shape steppers, length ruler, + Rest, Clear, Arrange / Voicing, Harmonize), `ShapeFinder` as a panel inside the window, `NextChords`, and a "Playing" row: style picker and Feel (the top of `HarpPanel`, `HarpPanel.tsx:254-298`) | `clip.content` (`chords`, `bars`, `style`, `feel`, `arrange`) | the chord components read `state.progression.chords` directly, so they are mounted inside `ClipLens` (E.4). "All clips" beside the style picker copies this clip's style and feel to every clip on the track. **The "Playing" row is hidden on a synth track** (the synth's own way of playing replaces style and feel, `HarpPanel.tsx:35-36, 256`). Capo stays the global setting |
| Melody | `MelodyGrid` with props only: `melody = clip.content`, `setMelody`, `keyOf`, `bar = sigBeats(clip.sig)`, `chords = chordsUnderSpan(song, span)`, `getPos`, `fresh = place = clip.id` | `clip.content` | its sound controls (`MelodyGrid.tsx:352`) are not rendered here; they are the track's sound window |
| Bass | the same `MelodyGrid` with `low` (release 1) and `octaves` (release 4) | `clip.content` | see below |
| Vocals, Blank | the record window (F.3) | the track's takes and audio clips | one record window for the whole app; it shows the armed track, else the selected audio track |

**Bass: the Melody composer with a wide range and fast octave moves.** Changes are local to `song/melody.ts` and `MelodyGrid.tsx:98-109`:

```ts
// song/melody.ts (added in release 1; `melodyRows` stays as it is)
/** Rows from `low` up, `octaves` octaves, highest first. */
export function gridRows(key: Key, low: number, octaves: number, keyOnly?: boolean): MelodyRow[];
export const GRID_LOW = 24, GRID_HIGH = 108;      // the range stored notes may already have (reviveMelody)
```

- **Release 1**: `MelodyGrid` gets a `low?: number` prop. A Bass track passes `melodyBase(key) - 24`, so its two octaves start two octaves under a melody's (today's grid cannot go below note 48, `song/melody.ts:117-128`). Notes outside the rows still get rows of their own, as today (`MelodyGrid.tsx:98-109`).
- **Release 4**: the grid has every row from C1 to C8 (seven octaves). It sits in a box that scrolls up and down, with the row names sticky at the left and the bar tabs sticky at the top (`styles.css:546` has `overflow-y: hidden` today). ▲ and ▼ beside the bar tabs jump one octave; so do Page Up and Page Down; the wheel scrolls. Rows that are a home note are marked so octaves are easy to see. On open the grid scrolls to the clip's notes; an empty bass clip opens on E1 to E3, an empty melody clip on the two octaves from the home note it shows today. "Key only" still hides the rows outside the scale.
- Optional improvement in release 4 (uses E1): drag a note's right end to give it a length.

### E.3 Sound plugins (the track's one chain)

Opened by FX on the panel, by the Sound button in a composer's title bar, or by tapping a drum name. The chain's order is fixed (it is the engine's order, `audio/rack.ts:1-16`); an effect at zero is off. There is no add, remove or reorder: that keeps it minimal and the engine untouched.

| Track kind | Window body, top to bottom | Existing component | Writes |
|---|---|---|---|
| Chords, Melody, Bass | Instrument (Guitar / Piano / Synth) → sound presets and "Mine" → Strings panel or Keys panel or the synth (sounds, six knobs, way of playing, full panel) → Effects panel (Saturation, Squeeze, Tone, Chorus, Phaser, Wobble, Tremolo, Echo, Reverb, Shimmer) | `SoundControls` (`HarpPanel.tsx:60-232`), `SynthPanel`, with `toneSetter` (`GuitarView.tsx:426-446`) copied to `src/ui/plugins/sound/useTone.ts` | `track.tone`, `track.sound` |
| Drums | Kit picker and drawer with "Mine" → Mixer panel → Sound panel (per drum) → Effects panel (Vibes, Human, Saturation, Reverb, Echo, Sampler, Noise, Tape, Tone, Glue, Pump) | `DrumMachine` with `show="sound"` (`DrumMachine.tsx:525-634` and the Kit picker) | `track.kit` |
| Vocals, Blank | Vocal sound box: On, Preset, Colour, EQ graph, Dynamics, Width, Echo, Reverb, Output, More / Less, LIMIT lamp; and "Apply sound" lit when takes were recorded with an older sound | `VocalsPage.tsx:903-925`, `EqGraph` | `track.fx` |

- **Every sound window has, in its title bar:** "Copy sound", "Paste sound" (same kind only; also in the track's ⋯ menu from release 1), and a **bypass** switch.
- **Bypass** (also Alt + click on FX): the track is heard without its effects while the switch is on. Nothing is stored. `FlattenCtx.bypass` names the tracks; `flatten` gives those a sound with every effect amount at zero (`dryOf`), a drums track its kit with the effects at zero, and an audio track its take's dry file.
- The compose-versus-sound split follows map-ui section 3. `onAll` ("All sections") is not passed to any sound panel: the sound already belongs to the whole track. `DrumMachine`'s rule `deskFollowsPage` (`DrumMachine.tsx:40`) becomes "always": there is one desk per track. The drum solo while working stays a listening aid of the drum sound window.
- The synth panel's `compound` flag (it fits arp and pulse speeds to 6/8, 9/8 and 12/8, `GuitarView.tsx:447`) is the signature of the clip open in that track's composer, else the signature at the cursor.
- `DrumMachine` is one component with a `show: "compose" | "sound"` prop, mounted twice, with `sel`, `solo` and `hit` lifted into a small shared store per track (`src/ui/plugins/drums/store.ts`), so a drum picked in the grid is the drum shown in the sound window.
- **Names in the drum windows.** Three kits are still named by another maker's model numbers and one rhythm group carries one of them (`audio/drums.ts:92-94`, `audio/rhythms.ts:28`); their neighbours were already renamed in plain words. Release 2 renames them in plain words ("Boom", "Punch", "Tight"; the group "Trap & electro"), keeping the ids so saved songs load.

### E.4 The lens (`src/timeline/lens.ts`, `src/ui/windows/ClipLens.tsx`)

The cheapest way to reuse code written against "the section on screen": one clip is shown to the old pages as a version 4 song with one section. It is used for the **Chords, Melody, Bass and Drums** pages. **The Vocals page is never put behind a lens** (F.3 says how it is hosted instead; a lens there crashes and mixes up takes).

```ts
/** What a window is on: a placed clip; or nothing yet (release 1); or the track's draft (from release 2). */
export interface Target { track: string; clip?: string; fresh?: { id: string; at: number; sig: TimeSig } }
export interface Lens { p: Progression; span: Region; lead: string | null /* the real track behind the reserved id "chords" */ }
/** One clip (or draft) as a one-section version 4 song. null: the clip or its track is gone. The same object comes back while what it read is unchanged. */
export function lensOf(song: TimelineSong, target: Target, key: Key, anchor: number): Lens | null;
/** What the old code changed, written back into the song. */
export function unlens(song: TimelineSong, target: Target, lens: Lens, after: Progression, id: () => string): TimelineSong;
```

**What the lens song holds.** No sections (`song` unset: the old code's "no sections yet" case, where the top-level fields are the one section), `meter: clip.sig`, `bars: content.bars`, `bpm`.

- **Its span** is one cycle of the content: the first cycle that starts inside the clip, else the cycle the clip's left edge lies in (a draft: its bars at the anchor).
- **The open track** is an added track brought forward (`focus: { [kind]: its id }`): its content on the top-level fields, its sound in `sound` / `tuneSound` / `beat` / `tones[id]`. The old pages already handle that case. Exception: when the open track is itself the lead chords track there, it is the reserved first track.
- **The reserved first chords track (id `chords`) is the song's lead chords under the span.** The old code treats that id as "the song's chords": `chordsUnder` reads only it or a harmony that replaces it (`song/harmony.ts:109-112`), and a harmony written with an Instead option, or Best fit, replaces the track with id `chords` (`song/harmony.ts:150-157`). So the lead chords track's chords over the span are presented under that id (rests where it has none), and `Lens.lead` remembers which real track that is. Without this the chord names over the melody grid show nothing and "Instead" replaces nothing.
- **Every other chords, melody and bass track of the song** is there as an added track, with its music under the span in its layer (empty when it has none there). So Harmonize sees its sources, and an empty track it may write into.
- The first drums track carries the lead drums' rhythm under the span; vocal tracks are left out.
- `lensOf` remembers its last result per target and returns **the same objects** while the clip, its track, the key, and the clips and tracks it read under the span are the same objects. A hidden window therefore re-renders nothing when a knob moves elsewhere.

**What `unlens` writes back.** It runs `conform(normalize(after))` first (so a picked rhythm is fitted to `clip.sig`, A.4), then:

1. The open track: content fields to the clip or draft (`setContent` / `setDraft`); sound, instrument or kit to the track (`setTrack`). With a `fresh` target and content that is no longer empty, the clip is made (`layDown` in free space).
2. **A track added inside the lens** (Harmonize's ✓ into a new track): a real track of that kind directly below the open one, with its name, `role` and `harmony`, and a clip over the span holding its layer, with its `HarmonyMark5`.
3. **A track that was empty under the span and now has music** (Harmonize's ✓ into an empty track): a clip over the span on that real track, with its mark.
4. "Plays instead" marks become `clip.instead`, with the reserved id `chords` mapped back to `Lens.lead`.
5. Changes of the mixer made inside (a mute set by a write) go to the real mixer, ids mapped the same way.
6. Changes to another track that already had music under the span are ignored (the old pages never make one).

**`<ClipLens target>` is a complete app context of its own**, not only `state` and `set`:

- `state` is a version 4 `AppState` made from the new one: `progression` is the lens song; **every other top-level field passes straight through** (`key`, `settings`, `shapes`, `myBeats`, `myKits`, `mySounds`, `canvas`, `studio`, `view`). `set(fn)` runs `fn` on that view; a changed `progression` goes through `unlens` as one undo step; every other changed field is written to the real state as it is. So saving a rhythm, a kit or a sound to "Mine", deleting one, the capo, a chosen chord shape, bars on screen, Follow and studio settings all still work from inside a legacy window.
- `addChord`, `audition` and `shapeOf` are rebuilt against the lens (the outer ones close over the outer state, `ui/state.tsx:475-497`).
- `sheet` / `openSheet` are this window's own (one global value would open the shape finder in every Chords window).
- `toast(msg, action)` passes to the real toast with `when` and `run` wrapped: `when` is given the version 4 view of the new state, never the new state itself (the old pages' `when` reads `s.progression`, which the new state does not have; called raw it throws inside the provider, above every crash guard).
- `idea`, `dirty`, `opened`, `recordingTo` come from the real context; `saveIdea`, `openIdea`, `newIdea` are the real ones.

**The embedded page.** `GuitarView` gets `embedded?: EmbedHost`:

```ts
export interface EmbedHost {
  pane: "rhythm" | "melody" | "drums";
  playing: boolean; togglePlay(): void;
  /** beats into the open content while the play line is inside it, else null */
  getPos(): number | null;
  /** hear a Harmonize candidate: the lens song with it written in (null ends it) */
  preview(heard: Progression | null): void;
  /** a rhythm or a style was picked: play now if nothing is playing */
  hearNow(): void;
  onHarmonize?(kind: "chords" | "melody", anchor: HTMLElement | null): void;   // from step 2b: Harmonize is hosted outside the page
  low?: number;          // a Bass track's lowest grid row
  toSound?: boolean;     // opened by FX: scroll to the sound panels
}
```

With it set, `GuitarView` **renders exactly one pane and nothing else**: no hidden sibling panes, no `Transport`, no `FramePage`, `TrackPage`, `VocalsPage` or `CanvasPage` (today it mounts all seven pages and only hides them, `GuitarView.tsx:935-968`, so every legacy window would carry a hidden copy of the whole app). Its own player is never made. These effects are off, and the host does their work once for the whole app: reading takes from disk and `keepTakes` (`:187-196`; left on, a lens's short take list would let go of the song's decoded takes beyond eight, `takebuffers.ts:59-70`, and vocals fall silent), `setTempo`, `keepSlots`, both `hearOn` effects and `prepareNotes` (`:387-397`; it replaces the one global queue, `synth.ts:234`), `setHome` (`:418`), the loop state and Follow-by-section. The page's top strip (`ClipBar`: track tabs, +, ✕, Copy, Paste) is not rendered: tracks are chosen on the timeline, and copy, paste, the mute/solo mark and the "plays instead" chip are in the window's title bar. The key chip opens the key popover.

Tests (`lens.test.ts`, `cliplens.test.tsx`): `unlens(lensOf(x))` changes nothing, for every kind; every old mutator (`addChord`, a slot removed, a knob, a rhythm picked, a melody note) lands in the right clip or track and nowhere else; a melody clip over lead chords gets its chord names (`chordsUnder`); Best fit from a melody gives `clip.instead` = the lead chords track; `writeHarmony` into a new track and into an empty track both arrive as real clips with their marks; `rewriteHarmony` through the lens; every library rhythm picked into a 3/4 and a 6/8 clip keeps `steps / div === sigBeats(sig)`; saving a rhythm inside the lens grows `myBeats`; a toast action's `when` does not throw; `lensOf` returns the same object when an unrelated track changes.

### E.5 Where the other things go

| Thing | New home |
|---|---|
| Harmonize | the button in the Chords and Melody composers, and ⟳ on a harmony track's panel (it acts on the selected clip of that track, else the clip under the cursor). It works on **the bars the open clip covers** (a draft: its bars at the anchor): sources are the tracks with music under those bars; the result is written into the open clip or draft when it is empty, else into a new clip at the same bars on an empty track of the right kind or a new track. The record is kept on the clip (`HarmonyMark5`); a clip whose source has changed since shows a dot (`harmonyState5`). Audition loops those bars with the candidate in place (`flatten` of a preview song, as `previewHarmony` today). Built through `lensOf` over the clip's span, so `song/harmony.ts` is unchanged. From step 2b the picker is hosted once by the track view (`ui/plugins/harmonize/host.tsx`) and every composer only calls `onHarmonize`. |
| Copy / paste | clips on the timeline (D.2); in a composer, the ⧉ ⎘ buttons (title bar in release 1, strip from release 2). The clipboard carries the track's sound; "Copy sound" / "Paste sound" move a sound alone. |
| Canvas | the Canvas button opens an **overlay**: the normal Canvas card, its stage **and its whole control bar** (layer legend, colour families and schemes, Layout, Surface, Paint, Drips, Old paint, Across, Clear, Save picture, open a file, Hz), with a close button. The ⤢ button inside it still gives true full screen (which hides the control bar, `styles.css:834-837`, as today). Escape leaves full screen first, then the overlay. Mounted once, `active` only while open. One painting per marker region (the stretch from one marker to the next; the whole song when there are none), coloured by the marker. |
| Canvas: what it listens to | `layerOfTrack5` (`canvas/layers.ts`): a Bass track paints in the **bass** layer (it has its own paint, "broad, flat, heavy bands", `canvas/layers.ts:9-11`), a blank audio track in **other**, vocals in vocals, a harmony track in harmony. `planTaps5(song)` (`canvas/taps5.ts`) is `planTaps` for the new song: tracks, mixer, and a track whose clip plays instead of the chords at the play line is painted as chords. The old `planTaps(state.progression)` has nothing to read once the app is switched over. |
| Frame: key, tempo, time signature, export | top-bar popovers (D.1), with the three vocals notes. `chart5()`, `midi5()`, `wav5()` (`src/timeline/export.ts`, from `GuitarView.tsx:1556-1618`) take `flatten`'s list. **Chords + tab** prints the marker names in running order first, then each marker region once: a region whose chords (names and lengths, on every chords track) equal an earlier region's is not printed again, so three verses print one verse, as today (`GuitarView.tsx:1577-1584`). Tracks with the same `group` are printed under one heading. |
| Frame: sections | gone. Their names and colours are markers; their order is the clips' positions. Insert adds an empty bar on every track; Ctrl+Shift+Delete removes the looped time. |
| Ideas | the sheet as today, with the backups folded under one row (B.4). |
| Audio setup | releases 1 to 4: inside the record window, as on the Vocals page today. From release 5: Settings → Audio: interface, buffer, measured delay, dropouts, every input's meter, headphone mix, the four reminders, the timing nudge. Also reached from "Audio setup…" in a track's input list. |
| Mixer | the track panels (M, S, volume). Per-drum faders are in the drum sound window. |
| Follow and "bars on screen" | Follow is the switch at the left of the ruler row, for the timeline and the grids. "Bars on screen" is in every composer's title bar (`BarsControl`; today it is mounted in the old strip, the Track page and the Vocals page, which all go). The timeline has zoom instead. |

---

## F. Blank audio track

"Blank" is the Audio kind: an audio track that starts with no effects and records any input of the interface. A Vocals track is the same thing with the vocal chain on.

### F.1 What the desktop engine does today and what is added

| Need | Today (`src-tauri/src`) | To add |
|---|---|---|
| List every input | the device is opened with all its input channels; `EngineOpened.inputs` gives the count (`engine.rs:631`); no names | nothing in the engine. The page lists "In 1" … "In N" and pairs "In 1+2", "In 3+4" … |
| Record one chosen mono input | yes, any channel (`engine.rs:135, 319`); the page only offers 1 or 2 (`VocalsPage.tsx:705`) | page only: `Track.input` becomes `InputRef` |
| Record a stereo pair | no: one sample per frame into a mono file (`engine.rs:335-346, 1029`) | **R1**: `engine_set` gets `input_b: Option<usize>`; with it the record path writes two samples per frame into a stereo WAV (`recfile.rs` writer takes a channel count); `Recorded` gets `channels`; `read_take_range` returns both channels |
| Meters for every input | first 8 only (`meter.rs:61`) | **R2**: all channels, up to 32 |
| Monitor | Direct, or through the vocal chain (mono in, stereo out, `fx.rs:279`) | **R3**: a pair is monitored dry in stereo. The vocal chain stays mono: on a stereo track it is off and its window shows only Output level. |
| Record from the cursor, once through | no: the backing always goes round (`engine.rs:512`) | **R4**: `engine_start` gets `once: bool`: the backing plays once, then silence; recording runs until Stop; `Recorded.loop_frames` is 0 |
| Count-in, click, accents per bar | yes (`engine.rs:109-127, 420-449`) | nothing |
| Latency compensation | yes: the driver's clocks give `offset`; lost input is padded; manual nudge (`engine.rs:452-460`, `song/takes.ts:75`) | nothing |
| Two or more tracks recording at once | no (one queue, one writer) | not in this plan: one armed track at a time |

R1 to R4 are audio-thread and file work in Rust and can be built in parallel with everything else from day one (only `src-tauri/` and `src/desktop.ts` are touched).

### F.2 Arm, input, monitor, and who owns the engine

- **Arm.** ● on the panel makes this the track that records (`Session.armed`); arming another disarms it. **Arming opens nothing by itself** and is not stored: no track is armed at a start or after another idea opens. (If "armed" stood in for "the Vocals page is on screen", every Play would wait up to 1.5 s for the driver to close, and the interface would reopen a second after every stop, for ever, `audio/handoff.ts:20-22, 50-56`.)
- **The top bar's ●** records onto the armed track. With none armed it arms the selected audio track, else the top one, and goes on. It opens the record window if it is closed.
- **The input list** never depends on the interface being open. It is built from, in order: the open engine's input count (`EngineOpened.inputs`); else the chosen device's channel count from the device list; else the count remembered from the last time the interface was open (`studio.inputs`). The track's saved choice is always in the list, marked "not there" if the interface turns out to have fewer inputs. So "add a track, pick input 2, arm" works in that order. A meter with peak hold sits beside the chip while the interface is open.
- **Monitor**: Direct (the interface's own switch; the app sends no voice) or Through effects (voice → a track's chain → headphones, in the engine). It is one studio setting (`studio.monitor`) and one control: beside the top bar's ●, and in the record window. **Whose input and chain are heard through the effects:** the armed track's; with none armed, the selected audio track's; else the top audio track's. The warning when both are on stays.
- **The mic-live dot** is on the top bar's ● and on the monitor control, whenever the mic is live, armed or not.
- **Who owns the recording engine.**
  - *Releases 1 to 4:* the Vocals page does, as today (it opens and closes the interface, receives the one status stream, and takes a recording back after a driver reset, `VocalsPage.tsx:210-342`). It is mounted **once for the whole app, always, on the desktop**, in host mode (F.3), as the body of the one record window; closing the window hides it. So monitoring through the effects goes on with the window closed, exactly as it goes on today on other pages. Every readout (input meters, LIMIT lamp, gain reduction, dropouts, measured delay, pass count, render progress) is in that window.
  - *From release 5:* `src/ui/audio/useEngine.ts`, a hook mounted by the app's host, owns open and close, the hand-off, the salvage of a recording after a reset, and publishes the status to a small store (`engineStatus`) that every readout reads: the panel's input meter, the sound window's LIMIT lamp, Settings → Audio, the record window, the top bar's pass readout.

### F.3 Recording onto the timeline

The scheme "stop live playback → render the backing offline → the engine plays it on the interface's clock and records" is kept, because it is the only path that is sample-aligned (map-audio 3.5). Recording never runs against the live browser playback on the desktop.

```ts
// src/timeline/record.ts
export interface RecordPlan5 { from: number; to: number; loop: boolean; bars: number[] /* beats in each bar, for the click */ }
export function recordPlan5(song: TimelineSong, session: Session): RecordPlan5;
/** A finished recording as takes and one audio clip, laid down on the track. */
export function addRecording5(song: TimelineSong, track: string, r: Recorded, plan: RecordPlan5, o: { nudge: number; kept: number[]; id: () => string; bpm: number; key: string; sig: string; sound: string }): TimelineSong;

// src/timeline/audioclips.ts (the take list's edits, on beats instead of block and bar; from song/clips.ts:114-240)
export const sameSpot5: (a: Take5, b: Take5) => boolean;   // one recording, or sung from the same song beat at the same rate
export function useTake5(song, track: string, take: string, at: number, id: () => string): TimelineSong;   // every clip of that spot plays it; an unplaced take is laid at `at`
export function keepTake5(song, track: string, take: string, keep: boolean): TimelineSong;
export function dropTake5(song, track: string, take: string): TimelineSong;          // whatever played it plays the next best take
export function removeRecording5(song, track: string, group: string): TimelineSong;
export function renudge5(song: TimelineSong, ms: number): TimelineSong;              // every audio track and the shelf
```

1. ● or Ctrl+R: the live player stops. `recordPlan5`: with the loop on, from the first region's start to the last region's end, bars snapped, `loop: true` (several regions are recorded as one stretch with all between, as today, `GuitarView.tsx:691-695`); with it off (**from release 6**), from the bar line at or before the cursor to the song's end plus 8 bars, `loop: false`. In releases 1 to 5, with no loop set, it goes round the bars in view from the cursor's bar (at most 8).
2. The backing is `renderSong(flatten(song without the armed track's clips over the range).items, …)`; for `loop: false` it is rendered with `fold: false`, so the tail is not folded back onto the start. The last render is kept, keyed by a fingerprint of the song without the armed track and the range, so a second take starts at once. "Preparing…" with progress is shown as today.
3. `engineBacking`, then `engineStart({ …, once: !plan.loop })`. Count-in: none, 1 or 2 bars (`studio.countIn`); the click accents each bar in its own signature (`clickPlan`).
4. While recording, a growing clip is drawn on the armed lane from the engine's reported position (no state change per frame).
5. Stop: `engineStop(fx)` returns `Recorded`.
   - Loop on: `cutTakes` cuts one take per pass, each with `at = plan.from`; ★ passes are keepers. One clip is laid at the loop start playing the active take (`activeTake`), whole. The other passes are alternatives.
   - Loop off: **`addRecording5` builds the single take itself** (`start = offset + nudge + count_in`, `frames = r.frames - start`, `at = plan.from`). `cutTakes` cannot be used here: with `loop_frames` 0 its loop length becomes one frame, the first pass is under 50 ms and it returns nothing (`song/takes.ts:60-70`).
   - In both cases `offset + nudge + count_in` is folded into the take's `start` exactly as today, so the clip sits where it was sung.
6. **Recording over material**: the new clip is laid with `layDown`, so it trims what it covers on that track. Nothing is deleted from disk. Takes sung from the same song beat at the same rate are alternatives of each other (`sameSpot5`; the real beat, so recordings in different bars never replace each other), and the clip's take chooser offers the earlier ones in the same place (comping). This is the simple rule the research note recommends; stacked hidden takes are a known trap of the reference program.
7. **A recording is never lost to an undo** (A.8): Ctrl+Z takes the new clip off the lane and puts back what it trimmed, but the takes stay in the take list.
8. No box after a recording. A driver reset mid-take still keeps the recording (`engine_close` hands it back), a full file stops cleanly, and the idea cannot be left while takes are being saved (all existing, `VocalsPage.tsx:483-504`).

**The record window in releases 1 to 4: the Vocals page in host mode.** `VocalsPage` gets one new prop. With it, the page keeps everything about the engine and the room and gives up everything about the song:

```ts
export interface VocalHost {
  /** the track shown: its name, input (0-based) and chain; null = the song has no audio track */
  track: { id: string; name: string; input: number; fx: VocalFx; stale: boolean /* takes recorded with an older sound */ } | null;
  setFx(fx: VocalFx): void; setInput(ch: number): void;
  bpm: number;
  /** what a recording goes round, in the page's own RecordPlan shape (items, beats, bars, label…), built from recordPlan5 */
  plan(): RecordPlan | null;
  /** a finished recording: the host cuts and lays it (addRecording5) */
  onRecorded(r: Recorded, o: { kept: number[]; sound: string }): void;
  /** the timing nudge changed: the host moves every take (renudge5) and stores the setting */
  setNudge(ms: number): void;
  applySound(): void;
  /** the take list, drawn by the host (TakeList5) */
  takes: ReactNode;
  /** lets the top bar's ● and Ctrl+R start and stop */
  control: RefObject<{ toggle(): void } | null>;
  /** this window has the focus (gates the page's own keys) */
  focused: boolean;
}
```

- Kept and unchanged in the page: the interface (open, close, list, hand-off, salvage), Record and Rehearse, the pass readout, ★ and K, count-in and click, the row of passes, input meters and choice, monitor, headphone mix, the four reminders, the timing nudge control, the vocal sound box with its LIMIT lamp, "Apply sound", every safety net.
- Not used in host mode: `tracksOf(state.progression)`, `cutTakes` and `addRecording` on the page, its own lane, its own take browser, its own undo stack and its Ctrl+Z listener, its `window.confirm`. Their work is done by the host on the new model: `addRecording5`, the track's own lane on the timeline (D.2), `TakeList5` (`src/ui/plugins/audio/TakeList5.tsx`: All / ★, hear, ★, Use, delete, remove a recording, show short takes, the "Removed recordings" shelf), and global history. Removing a recording and deleting a take show the 20-second undo toast instead of a confirm box.
- **There is one lane.** Clip editing on audio clips is the timeline's own, with the audio rules of D.2 (a move keeps to sixteenths, edges free to the sample, S at the pointer, zoom to 320 px a beat). The record window has no second lane, in any release.

From release 5 the page is split for good (`RecordWindow`, `VocalSound`, `TakeBrowser`, `useEngine`), and from release 6 any input or pair and once-through recording are added.

### F.4 Sound on audio tracks

The vocal chain stays as it is: live in the headphones while monitoring through effects, and baked into each take's second file, which the song plays. A changed knob marks older takes; "Apply sound" re-makes their files (`fx_render`). This keeps today's sound exactly and adds no load to the page's audio thread. A blank track starts with the chain off.

Optional later (not in the seven releases): the web effects rack on audio tracks (`createRack` takes any input, `audio/rack.ts:207`), with the same rest and wake a `TrackVoice` has.

### F.5 When the interface is open

Today: while the Vocals page is on screen and the app is quiet, or while recording, or while monitoring through effects (`audio/handoff.ts:14-22`). New: "the Vocals page is on screen" becomes **"the record window is open, or (from release 5) Settings → Audio is open"**. So the engine is wanted while: a recording or a rehearsal runs; or monitoring through effects is on; or one of those two windows is open and the app has been quiet for a second. **An armed track is not a reason.** Everything else in `handoff.ts` and `through.ts` stays, including "close the engine before the app's first note": Play only waits for the driver when the engine is actually open. With Through effects on, the app's sound goes through the engine and is about 0.16 s late; the play line allows for it with `audio/outdelay.ts`, as the Canvas does.

### F.6 In the browser (web fallback)

Today the browser cannot record at all. Added last, behind `!isDesktop()`:

- `src/audio/webrec.ts`: `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`, captured by an audio-thread recorder into memory, mono (or stereo when the device gives two channels). The input list is `enumerateDevices()`'s audio inputs.
- The song plays live while recording (there is no engine to play a backing). The take is moved earlier by `baseLatency + outputLatency` of the context plus the timing nudge. It is not sample-aligned; the nudge is the user's correction, and the window says so in one line.
- Takes are kept in IndexedDB (`dry = wet = "idb:<id>"`); `audio/takebuffers.ts` learns to read them. No vocal chain, no monitoring through effects, no stereo pairs beyond what the device offers.
- The phone and web build never import the desktop calls (they stay behind `isDesktop()`, `desktop.ts:8`).

---

## G. Nothing-lost table

Every row of the inventory in `map-ui.md` section 1 (218 rows), by its number there. "Composer" = the track's composer window; "Sound" = the track's sound window; "Record" = the record window (one for the whole app; it shows the armed track, else the selected audio track). A changed meaning is in **bold**.

### G.1 Shell and top bar

| # | Feature | New home |
|---|---|---|
| 1 | Page tabs | Gone. The track view is the only page; the old pages open as windows from their track; Canvas from its button |
| 2 | Book ahead on page change | `bookAhead()` when a window opens or closes, the Canvas opens, a zoom or ruler drag starts |
| 3 | Open page at its top | A window opens scrolled to its top |
| 4 | Save | Top bar, unchanged; also Ctrl+S |
| 5 | Ideas button with count | Top bar, unchanged |
| 6 | Settings gear | Top bar, unchanged |
| 7 | Mic-live dot | On the top bar's ● and on the monitor control beside it, whenever the mic is live |
| 8 | Draft badge | Unchanged |
| 9 | Update bar | Unchanged |
| 10 | Crash guard | Around the track view, and one around each window |
| 11 | Wide layout | The track view always takes the whole window |
| 12 | Toast and undo toast | Unchanged; an undo toast does the same as Ctrl+Z for that step |
| 13 | Theme | Unchanged |
| 14 | Storage and other tabs | New key, writes debounced, a failed write is said plainly (B.3); other-tab merge on the new key, saved rhythms, kits and sounds included |
| 15 | Cloud sync | New document prefix; old documents are read on every sync and never written; a newer old copy is never ignored (B.3) |
| 16 | Offline cache | Unchanged, with the cache name bumped once so old code is replaced at the next visit |

### G.2 Transport and loop

| # | Feature | New home |
|---|---|---|
| 17 | Play / Stop | Top bar ▶ and Space. **Plays from the cursor** (was: from the section on screen) |
| 18 | Wait for instruments | Unchanged, in `usePlayer` |
| 19 | "Nothing to play" message | Unchanged (`Flat.any`) |
| 20 | Loop button | Top bar ↻, and L or R. **Switches the ruler's loop on and off**; with no region: the selected clip's bars, else the cursor's bar |
| 21 | Tap bars to loop | **Drag across the ruler**; Ctrl + drag adds another stretch; drag a region's ends to adjust |
| 22 | Section name: go there | Click a marker: the cursor goes there |
| 23 | Section name: loop it too | Double-click a marker: loop to the next marker; Ctrl + double-click adds that stretch to the loop |
| 24 | All | Double-click empty ruler: the region is the whole song |
| 25 | Loop of separate runs | **Kept**: the loop is a list of stretches. Ctrl + drag on the ruler adds one; they play in song order and the music jumps from the end of one to the start of the next |
| 26 | Loop change while playing | Takes over **at once, in time** (was: at the end of the section playing) |
| 27 | Sounding-bar mark | The play line across ruler and lanes |
| 28 | Strip keeps place, no scroll bar, no zoom | The ruler: visible scroll bar, Shift + wheel, zoom, fit; Follow turns the page. This is the fix for "the strip ran off the screen" |
| 29 | Key · meter · tempo summary | The key, tempo and signature controls themselves, in the top bar |
| 30 | Locked while recording | Unchanged: ▶ and the loop are locked while recording |
| 31 | Loop belongs to the idea | `Session` is reset when another idea opens |
| 32 | Stop on idea change | Unchanged |
| 33 | Follow | The timeline and the grids turn their page with the music. **It no longer changes what is being edited**: a window stays on its clip |

### G.3 Frame

| # | Feature | New home |
|---|---|---|
| 34 | Song length pill | Tooltip of the position readout, and a label at the song's end on the ruler |
| 35 | Go to a section / rename it | Markers, from release 1: click to go; F2 or right-click to rename; M adds one and its name is typed at once; drag to move; Delete removes |
| 36 | Section length | **A clip's length** (edge drag) and its content's length ("N bars − +" in the strip, with the quick lengths 1 2 4 8 12 16 24 32). For every track at once: Insert adds an empty bar at the cursor, Ctrl+Shift+Delete removes the looped time |
| 37 | Section's own time signature | **A signature change on the ruler** ("from this bar on"); Ctrl+Z in place of the 20 s ↶ |
| 38 | Copy a whole section | **Ctrl+A with a loop region selects every clip in it; Ctrl+C.** The clipboard keeps each clip's track and that track's sound |
| 39 | Paste a whole section | Ctrl+V at the cursor: each clip to its own track (a missing track is made, with its sound), moved to the key. Ctrl+Shift+V first makes room (inserts time). No confirm; Ctrl+Z |
| 40 | Remove a section | Select its clips and Delete; **Ctrl+Shift+Delete removes the loop region's time and closes the gap** on every track |
| 41 | Reorder sections | Select the clips of a stretch and drag them together; or cut time and paste with insert. (Its drag code now reorders tracks.) |
| 42 | Track chips per section | The lanes show which tracks play where; double-click a clip to open it |
| 43 | Unlink | **Not needed**: copies are always separate |
| 44 | New section | Not needed: put clips anywhere; M names a spot |
| 45 | Play a section again | Ctrl+D or Ctrl+drag. **The copy is separate** (a change in one no longer reaches the other) |
| 46 | Key | Key popover |
| 47 | Mode | Key popover |
| 48 | Scale notes and play scale | Key popover |
| 49 | Move song | Key popover; moves the key, every clip and every draft as one undo step. A note that would leave the range moves by an octave instead of being lost |
| 50 | Vocals key note | Key popover: "Vocals: sung in …" when the takes that play were sung in another key |
| 51 | Tempo | Top bar |
| 52 | Song time signature | Top bar popover; refits the clips of that stretch; Ctrl+Z |
| 53 | Vocals tempo and signature notes | Tempo popover: "Vocals: recorded at N bpm" with the button back to that tempo; signature popover: "Vocals: recorded in 3/4" |
| 54 | Export WAV | Export popover |
| 55 | Export MIDI | Export popover; one MIDI track per track |
| 56 | Chords + tab | Export popover. The marker names in running order, then each marker region once (one whose chords equal an earlier region's is not printed again); tracks that were one row before are under one heading |

### G.4 Track page

| # | Feature | New home |
|---|---|---|
| 57 | Total bars pill | As 34 |
| 58 | Bars on screen + Follow | Zoom on the timeline; the Follow switch at the left of the ruler row; a bars-on-screen control in every composer's title bar |
| 59 | Track head: name | Double-click renames. **Opening is the compose button** |
| 60 | Instrument icon | On the panel |
| 61 | Remove a track | "Remove track" in the panel's ⋯ menu (also right-click). **Never the Delete key.** No confirm: Ctrl+Z, and a 20-second undo toast when the track had clips or takes; an audio track's takes are kept on the shelf |
| 62 | Mute | Panel |
| 63 | Solo | Panel |
| 64 | Volume | Panel |
| 65 | Harmony ⟳ on a head | Panel ⟳: writes again the selected clip of that track (else the clip under the cursor); the "source changed" dot is drawn on the clip |
| 66 | Add a track | The + row, six kinds. **Always a new row** (was: reuse an empty one) |
| 67 | Ruler | The new ruler; the loop is set on it |
| 68 | Blocks | Clips |
| 69 | Add track to a section (faint +) | Double-click empty lane for a new clip, or drop one from a composer's strip |
| 70 | Small pictures | Inside clips, unchanged drawings |
| 71 | Playhead and page turn | Play line; Follow |
| 72 | Keep section in view / light up new track | A new track flashes; opening a clip scrolls it into view |
| 73 | "Plays instead" | The replaced clip is faint with the same hint |

### G.5 Chords

| # | Feature | New home |
|---|---|---|
| 74 | Section label | The window's title: track name and "bars 5–8", or "draft" |
| 75 | Track tabs of this kind | **One composer window per track**; choose the track on the timeline |
| 76 | Add a track of this kind here | The + row |
| 77 | Remove from this section | Delete the clip |
| 78 | Harmony ⟳ on the tab | Panel ⟳ (acts on the selected clip) and the composer's Harmonize |
| 79 | Mute / solo mark | In the window's title (`MixMark`), from release 1 |
| 80 | "X plays instead" chip | In the window's title, from release 1; a click brings that track's window forward |
| 81 | Copy | Ctrl+C on the clip; ⧉ in the composer. Copies the music and how it is played, **and the clipboard carries the track's sound**: pasted where no track of that kind exists, the track is made with it. "Copy sound" / "Paste sound" (⋯ menu, sound window) move a sound between tracks and ideas; "Duplicate track" makes another track with the same sound |
| 82 | Paste | Ctrl+V on the timeline; ⎘ in the composer (into the open clip, moved to the key, fitted to the clip's signature, with the "past the end" warning) |
| 83 | Undo paste | Ctrl+Z |
| 84 | In key / Outside / Next | Composer, unchanged |
| 85 | Kind of chord | Composer, unchanged |
| 86 | Key chip | Composer; opens the key popover |
| 87 | Capo | Composer, unchanged (global) |
| 88 | Chord cards | Composer, unchanged |
| 89 | Every chord on a degree | Composer, unchanged |
| 90 | Role legend | Composer, unchanged |
| 91 | Outside chords | Composer, unchanged |
| 92 | Next chords | Composer, unchanged (reads the open clip's chords) |
| 93 | Pills | Composer, unchanged |
| 94 | Arrange (guitar) | Composer, per clip |
| 95 | Voicing (keys) | Composer; it is the track's instrument setting, so **it changes every clip of the track** |
| 96 | Harmonize button | Composer |
| 97 | Chord slots | Composer; a chord past the content's last bar is struck through |
| 98 | Shape steppers | Composer, unchanged |
| 99 | Open the shape finder for a slot | Composer, unchanged |
| 100 | Drop marker | Composer, unchanged |
| 101 | Length ruler | Composer; "make it N bars" lengthens the content |
| 102 | + Rest | Composer |
| 103 | Clear | Composer; clears the open clip |
| 104 | Mini tray | **Retired**: the tray is always in view at the bottom of the window, and the strip shows the clip in one line with ▶ |
| 105 | Sticky tray | The tray is fixed above the strip |
| 106 | Shape finder header | A panel inside the Chords window, unchanged |
| 107 | Chord theory | Same panel |
| 108 | Slot tools | Same panel |
| 109 | Flavours | Same panel |
| 110 | Shape tabs | Same panel; shapes still drag into the tray |
| 111 | Keys version | Same panel |
| 112 | Close | Escape closes the finder first, then the window |
| 113 | Instrument | Sound |
| 114 | Playing style | Composer, "Playing" row, per clip, with "All clips" |
| 115 | Feel | Composer, "Playing" row, per clip |
| 116 | Harp voice | Sound |
| 117 | Ready-made sound, "Mine" | Sound |
| 118 | Piano model | Sound |
| 119 | Strings panel | Sound |
| 120 | Keys panel | Sound |
| 121 | Effects panel | Sound |
| 122 | All sections | **Sound: not needed, a track's sound is on every clip. Playing style and feel: "All clips"** |
| 123 | Hear a change | Unchanged |
| 124 | Synth: sounds | Sound |
| 125 | Synth: six macro knobs | Sound |
| 126 | Synth: way of playing | Sound (per track) |
| 127 | Synth: full panel | Sound |

### G.6 Melody (and Bass)

| # | Feature | New home |
|---|---|---|
| 128 | Top strip | As 74–83 |
| 129 | On / Off | **The clip's mute**: the On / Off switch in the composer's title bar, Mute in the clip's row of buttons, key 0 |
| 130 | Harmonize | Composer |
| 131 | Grid | Composer |
| 132 | Bar tabs | Composer: one per bar of the content |
| 133 | Copy the bar before | Composer |
| 134 | Key only | Composer |
| 135 | Undo | Composer's ↶ as today, and Ctrl+Z |
| 136 | Clear bar | Composer |
| 137 | Note names | Composer |
| 138 | Squares | Composer |
| 139 | Rows | **Every row from C1 to C8, scrolling, with octave steps** (was two octaves) |
| 140 | Chords over the grid | Composer: the chords other tracks play under the clip's bars |
| 141 | Moving line | Composer, while the play line is inside the clip |
| 142 | Sound | Sound |

### G.7 Drums

| # | Feature | New home |
|---|---|---|
| 143 | Top strip | As 74–83 |
| 144 | On / Off | **The clip's mute**: the On / Off switch in the composer's title bar, Mute in the clip's row of buttons, key 0 |
| 145 | Kit | Composer (beside the Rhythm picker, as today) and Sound; both set the track's kit |
| 146 | Rhythm | Composer: every library group and "Mine" |
| 147 | Edit lock | Composer |
| 148 | Undo / Cancel / Save | Composer |
| 149 | Brush | Composer |
| 150 | Vary | Composer |
| 151 | Copy the bar before | Composer |
| 152 | Clear bar | Composer |
| 153 | Bar tabs | Composer: one per bar of the content |
| 154 | Drum names | Composer; a tap plays the drum and shows it in the sound window, which also opens from the composer's Sound button |
| 155 | Grid | Composer. **A short rhythm repeats by making its clip longer** (notches) instead of filling its section |
| 156 | Playhead | Composer, while the play line is inside the clip |
| 157 | Mixer panel | Sound |
| 158 | Sound panel | Sound |
| 159 | Effects panel | Sound; **Swing moves to the composer** (it belongs to the rhythm and is kept with the clip) |
| 160 | All sections | **Not needed**: the kit belongs to the track |
| 161 | Drum solo while working | Sound |

### G.8 Vocals

| # | Feature | New home |
|---|---|---|
| 162 | Vocal track tabs | Tracks on the timeline; + adds; double-click renames |
| 163 | Record | Top bar ● and Ctrl+R, onto the armed track. **Round the loop** (releases 1 to 5), **or once from the cursor** (release 6) |
| 164 | Rehearse | Record window |
| 165 | Pass readout | Record window, and beside the top bar's ● |
| 166 | Keep a pass | Record; K |
| 167 | Count-in and click | Record |
| 168 | Row of passes | Record |
| 169 | Lane | The track's own lane on the timeline (waveforms, play line). There is one lane; the record window has none of its own |
| 170 | Clip editing | The timeline's gestures with the audio rules of D.2: a move keeps to sixteenths (Alt: free), edges are free to the sample (Shift: beats), S splits at the pointer. **An edge dragged outward first uncovers the rest of the take, and repeats it only past the take's end** |
| 171 | Clip tools | On the timeline: S, Delete, Ctrl+Z, and the clip's row of buttons; snap is the Shift / Alt keys; the take chooser and "Hear alone" are in the clip's menu and in the record window |
| 172 | Take browser | Record |
| 173 | Apply sound | Sound |
| 174 | Interface | Record window (releases 1 to 4), then Settings → Audio |
| 175 | Input meters and input choice | The panel's input chip and list (inputs 1 and 2 until release 6, then every input and pair), with its meter while the interface is open; all meters in the record window, then Settings → Audio |
| 176 | Monitor | One control beside the top bar's ●, and in the record window |
| 177 | Headphone mix | Record window; also Settings → Audio from release 5 |
| 178 | On the interface, timing nudge | Record window (releases 1 to 4), then Settings → Audio. A nudge change moves every take in the song, the shelf and the clipboard |
| 179 | Vocal sound | Sound |
| 180 | In the browser | "Recording: in the desktop app" until release 6, then simple microphone recording |
| 181 | Safety nets | Unchanged |

### G.9 Canvas

| # | Feature | New home |
|---|---|---|
| 182 | The painting | Canvas overlay; **one painting per marker region** (was per section); a Bass track paints in the bass layer, a blank audio track in "other", vocals in vocals |
| 183 | Open a song from a file | Unchanged |
| 184 | Better layers | Unchanged |
| 185 | Guide | Unchanged |
| 186 | Full screen | The ⤢ button inside the overlay, as today; Escape leaves full screen first, then the overlay |
| 187 | Layer legend | Unchanged, in the overlay's control bar |
| 188 | Colours | Unchanged, in the overlay's control bar |
| 189 | Layout, Surface, Paint, Drips, Old paint, Across | Unchanged, in the overlay's control bar |
| 190 | Clear and Save picture | Unchanged, in the overlay's control bar |

### G.10 Ideas, Settings, Harmonize, cross-cutting

| # | Feature | New home |
|---|---|---|
| 191 | List | Unchanged; the one-line description is the track names and the bar count; backups are folded under one row, "Before track view (N)" |
| 192 | Rename | Unchanged |
| 193 | Open | Unchanged; a backup opens as a restored copy |
| 194 | New idea | Unchanged; starts with empty Chords, Melody and Drums tracks |
| 195 | Delete | Unchanged |
| 196 | Save a copy | Unchanged |
| 197 | Backup and Restore | File version 2 (version 5 ideas, with the original of every backup entry inside); version 1 files are still read and converted |
| 198 | Where it is kept | Unchanged |
| 199 | Avoid barre chords | Unchanged |
| 200 | Tuning | Unchanged |
| 201 | Capo | Unchanged |
| 202 | Dots | Unchanged |
| 203 | Theme | Unchanged |
| 204 | Left-handed diagrams | Unchanged |
| 205 | Audio interface | Settings → Audio, with rows 174–178 |
| 206 | Open Harmonize | The button in the Chords and Melody composers |
| 207 | Which track to go with | **Tracks with music under the open clip's bars** (was: in this section) |
| 208 | Options | Unchanged |
| 209 | Three controls | Unchanged |
| 210 | Hear it | **Loops the open clip's bars** with the candidate in it |
| 211 | Keep | Writes into the open clip when empty, else a new clip at the same bars on an empty or new track; Ctrl+Z |
| 212 | Write again | ⟳ on the panel, for the selected clip; the dot on the clip when its source changed; no confirm before writing over hand edits, Ctrl+Z instead |
| 213 | Your own libraries | Unchanged |
| 214 | Clipboards | **One clipboard of clips** (one or many, with their tracks' sound), and "Copy sound" for a sound alone |
| 215 | Undo | One Ctrl+Z, and ↶ ↷ in the top bar, for everything: the song and the key together. The composers' own buttons stay. A recording's takes are never removed by it |
| 216 | Keyboard | D.3. **Space plays and stops**, wherever the focus is; every key also has a button |
| 217 | Native confirm and prompt boxes (seven) | **None left**: every one is replaced by Ctrl+Z, the 20-second undo toast, and names typed in place |
| 218 | Song voices kept ready | Unchanged, in `usePlayer` |

---

## H. Delivery: seven draft releases, built in twelve steps

Each release is shippable alone; the app works at every merge. The full brief for each step (goal, files, signatures, acceptance checks on a 1280 × 800 window, tests, what is left for later) is in `steps.md` beside this file. This section is the map.

| Step | What it is | Needs | May run beside | Ends in |
|---|---|---|---|---|
| 0 | Groundwork: one small commit that only copies and exports, so the next three steps do not touch the same lines | nothing | | |
| 1a | Core, no screen. Part 1 (lands first, on its own): model helpers, bar map, edits, history. Part 2: cuts, `flatten`, conversion, library, lens, engine touches E1 and E2 | 0 | 1b, 6r | |
| 1b | Shell: the whole track view, built on props and shown on a fixture page. Not mounted in the app | 0 (its gestures call the edits of 1a part 1) | 1a, 6r | |
| 1c | Switch-over: new state and storage, conversion with backups, the player host, the legacy composer windows, top-bar functions, Canvas overlay, Ideas. The single moment the app changes | 1a, 1b | the pure parts of 1d, 6r | |
| 1d | Recording in the track view: the one record window (Vocals page in host mode), the take list, recording round the loop | 1c (its pure parts need only 1a) | 1c for its pure parts, 6r | **Release 1** |
| 2 | The window manager in full, drafts and the clip strip for every composer, sound windows, the Drums plugin | 1d | 6r | **Release 2** |
| 2b | Split for parallel work: one legacy host file per kind, Harmonize hosted once, a stylesheet per plugin | 2 | 6r | |
| 3 | The Chords plugin (with engine touch E3) | 2b | 4, 5, 6r | **Release 3** |
| 4 | The Melody and Bass plugin (seven-octave grid) | 2b | 3, 5, 6r | **Release 4** |
| 5 | The Vocals plugin: record window split, `useEngine`, Settings → Audio, Harmonize polish | 2b | 3, 4, 6r | **Release 5** |
| 6r | Desktop engine work R1 to R4 (Rust) | nothing | everything | |
| 6 | The blank audio track: any input or pair, record once from the cursor, the browser's microphone | 5, 6r | | **Release 6** |
| 7 | Clean-up and the phone layout | 6 | | **Release 7** |

**Merge order inside release 1: 0, then 1a, then 1b (still not mounted: nothing in the app imports it), then 1c, then 1d.** The app that users see changes exactly once, at 1c. 1b needs the types in `model.ts` and the `PlayerApi` type, both fixed by step 0, and the pure edit functions of 1a part 1 for its gestures; it never reads the app's context and owns no player. 1c is the only step that edits `App.tsx` and `GuitarView.tsx`.

**Why 3, 4 and 5 really are separate after 2b.** Before it they all had to edit `GuitarView.tsx` (it mounts `MelodyGrid`, `VocalsPage` and `HarmonyPicker`, `:956, 960, 971`), the Harmonize button lives in the `Dock` (step 3's) and in `MelodyGrid` (step 4's), and all three would add to `ui/styles.css`. After 2b: each kind has its own host file; nobody edits `GuitarView.tsx` again (it is simply no longer mounted, and is deleted in step 7); Harmonize has one entry point (`onHarmonize`, supplied by the host); each plugin has its own stylesheet; E3 (`timeline/flatten.ts`, `renderSong`) belongs to step 3 alone. The one shared file is `ui/plugins/registry.ts`, one line each.

**Existing tests.** The build type-checks tests (`package.json:9`, `tsconfig.json`), and 15 test files import the version 4 state and library modules. Those modules are not edited before step 7 (B.3), so those tests stay green untouched. The tests changed on purpose, and when:

| Test | Step | Why |
|---|---|---|
| `ui/hands.test.ts` | 1c | the selectors it names (transport, page tabs) |
| `ui/components/drumdesk.test.ts` | 2 | "the desk follows the page" becomes "always" |
| `song/melody.test.ts` ("shows two octaves") | 4 | the grid's rows come from `gridRows` |
| `song/takes.test.ts`, `song/clips.test.ts`, `ui/components/takelane.test.ts`, `ui/components/harmonypicker.test.ts` | 5 | block-and-bar arguments go; the lane retires |
| `audio/handoff.test.ts` | 5 | the "wanted" rule of F.5 |
| the section tests listed "replace on purpose" in map-model section 7, and the tests of the version 4 state modules | 7 | removed with their modules |

All `audio/*.test.ts` other than `handoff` pass unedited in every step.

**What the user gets, release by release**

1. Every old idea opens as tracks and clips and plays as before; clips move, copy, split, repeat by their edges; the ruler loops any stretch (or several), scrolls and zooms; Space plays from anywhere; one undo for everything; six kinds of track; every composer and sound panel opens from its track in a window; vocals record; exports and the Canvas work; the originals are in Ideas.
2. The bass-clef button opens a real plugin with the clip being composed at the bottom, which drags onto same-kind lanes only; every track has its own sound window; the Drums plugin is complete.
3. The Chords plugin, with playing style per clip.
4. Bass and melody over seven octaves with one-press octave jumps.
5. Recording and comping as a plugin; audio setup in Settings.
6. The blank track: any input or stereo pair, record once from the cursor; microphone recording in the browser.
7. The leftovers removed; a layout made for the phone.

---

## I. Risks and open choices, each with the default to build

| # | Risk or choice | Default (build this without asking) |
|---|---|---|
| 1 | A track that sounded different per section becomes several tracks: more rows than the user remembers | Split, as in B.1 step 6. It is the only way nothing changes in sound. Rows sit together and are named after their section. The user can merge by dragging clips onto one track and deleting the other |
| 2 | A drums row split by kit runs one desk per kit (two reverbs each) where one desk ran before | Accept; measure a five-kit song in release 1. If it is too heavy, let a desk rest while its track has no clip within two bars (engine work, not planned) |
| 3 | Playing style and feel: per clip or per track | Per clip, edited in the Chords composer, with "All clips". Per track would split every picked-verse, strummed-chorus guitar |
| 4 | Swing: per clip or per track | Per clip (it is saved with a rhythm). A cut is forced between two rhythms of one track that differ in swing or grid |
| 5 | Which drums track the others' swing follows, and which chords track sets the pulse and the piano pedal | The `lead` tracks: set by conversion (the old first tracks) and on the first chords and drums track of a new song; when a lead track is deleted the top track of its kind takes over. No control for it on screen |
| 6 | Mixed time signatures | A bar map plus each clip's own `sig` (A.4). A clip moved across a change is not refitted; it shows a tag |
| 7 | Edge drag: loop the whole content or only what is shown | The whole content (the window rule), on both edges, as the reference program does. No per-clip loop switch |
| 8 | Two clips at the same place on one track | Not allowed: the later one trims what it covers. No hidden overlaps, one undo step |
| 9 | Melody clips on bass tracks and vocal clips on blank audio tracks | Allowed both ways (same content). Everything else is same kind only |
| 10 | Mouse wheel | Wheel scrolls tracks, Shift + wheel scrolls time, Ctrl + wheel zooms time around the pointer |
| 11 | Old builds and version 5 songs | New storage key and cloud prefix; the old data is never written. An old-format copy that turns up newer later (a device still on the old version) is converted again: over the idea if that was not edited since, else beside it as "(edited in the old version)" (B.3). The offline cache name is bumped so old code is replaced at the next visit |
| 12 | Backups doubling local storage | The old blob is moved into IndexedDB, read back, and only then removed from local storage, so nothing is doubled; where IndexedDB cannot be used it stays and storage is doubled. A write that fails is said plainly and the app keeps working in memory (B.3). Real sizes are printed once at conversion |
| 13 | Linked repeats disappear | Accepted (the user chose separate copies). A fix made in one chorus must be copied to the others |
| 14 | Engine changes | Only E1, E2, E3 (C.6), each additive with its own test. Anything more needs a new decision |
| 15 | Pseudo-sections: 32-bar limit and forced cuts | Keep the limit; whatever crosses a forced cut is struck again there. They only arise where rhythms of different swing or grid meet under a clip that crosses, or after 32 bars with no free bar line. Lifting the melody clamp for play-time melodies is a later option |
| 16 | The render-equality test compares requests, not samples | Accepted and stated (B.5); add one real-browser listening check of three fixtures to the release 1 checklist |
| 17 | Vocal effects are baked into files, so the vocal sound window is not live on playback | Keep baked, with the existing lit "Apply sound". A live rack on audio tracks is an optional later step |
| 18 | Stereo pairs and the mono vocal chain | A stereo track records and plays dry; its chain is off |
| 19 | Several tracks recording at once | Not built: one armed track at a time |
| 20 | Recording from the cursor needs the song rendered first; long songs wait | Render from the cursor's bar, keep the last render for the next take, show progress. Memory is about 23 MB a minute |
| 21 | Tempo changed after recording | `setTempo` keeps each audio clip where it was sung (counted from its take's first frame), so split halves stay joined; nothing stretches; the tempo popover shows "recorded at N bpm" with the way back, as today |
| 22 | Takes whose section or bar is gone | Section gone: kept as unplaced takes in the take browser ("Use" lays one at the cursor), and the conversion toast says how many. Bar gone: kept on the lane as muted clips (B.1 step 12) |
| 23 | Main-thread work starving the 25 ms booking timer (timeline drawing, drags, windows) | Draw only clips in view; no React state per frame; `bookAhead` at the listed moments; debounced storage; `flatten` rebuilt per pseudo-section |
| 24 | Many tracks on one audio thread | No cap. Measure 16 and 24 tracks before release 2 and write the numbers into the README |
| 25 | The legacy window of release 1 is throw-away work | Accepted: an `embedded` mode in `GuitarView` (one pane, its global effects off), a host mode in `VocalsPage`, and small host files. It is what lets release 1 keep every feature; both are deleted in release 7 |
| 26 | Canvas paintings were per section | Per marker region; the whole song when there are no markers |
| 27 | Guitar shapes, tuning and capo live outside the song | Unchanged (the same clip can play other notes on another device, as today) |
| 28 | Notes in the melody composer have no length | E1 gives the engine a length; drawing lengths in the grid is the optional part of release 4 |
| 29 | Dropping a strip on empty space below the tracks | Does nothing in this plan (a new track is made with +). Could later make a track of that kind |
| 30 | Track height and track folders | One height; no folders |
| 31 | Parts of the reference program's behaviour could not be confirmed (left-edge wrap, whether fades repeat) | Our own rule is fixed in A.3 and does not depend on them: both edges wrap, 5 ms fades at every restart |
| 32 | The phone | The web build keeps working from release 1: windows are bottom sheets, every action has a button (no key-only and no hover-only control), a long-press opens the clip menu. The tuned phone layout is release 7 |
| 33 | Several loop stretches: more to explain than one | Kept, because it exists today and was asked for. A plain drag still makes one stretch; only Ctrl + drag adds. Recording goes from the first stretch's start to the last one's end |
| 34 | A removed audio track's takes pile up on the shelf | Dropped after the idea has been saved twice, or by Empty. The files on disk are never touched |
| 35 | The engine's owner changes in step 5 (`useEngine`) | Until then the Vocals page owns it, mounted once, as today. Step 5 moves the same code, with `audio/handoff.test.ts` and `audio/through.test.ts` as the guard |
| 36 | Starting inside a loop region uses `start(…, fromIndex)` on an item that carries `from` | It rests on `sectionStart` (`audio/patterns.ts:278`); a test on the pretend live context holds it. If it fails, start from the region's start instead (the old behaviour) |
| 37 | Bypass makes a second voice for a moment (the dry sound is another slot) | Accepted: it is a listening aid; the old voice fades as on any sound change |
| 38 | IndexedDB is not there in some private windows and embedded viewers | The old key then stays as the backup store and is never written; everything else works the same |

---

## J. Review notes

Three reviews (architecture, nothing lost, user intent) raised 65 findings. Each was checked against the code at commit `0f436e9`; all of them describe the code truthfully. Every blocker and major finding is resolved in the text above, and so are the minor ones. This section lists where each went, and the few places where the design differs from the fix a reviewer proposed, with the reason.

### Where the design differs from a proposed fix

1. **Who owns the recording engine in release 1** (nothing-lost review: "add a host-level engine hook in release 1"). Kept inside the Vocals page for releases 1 to 4, and moved into `useEngine` in step 5 (F.2). Reason: the open/close, hand-off and salvage code is the most fragile in the app and release 1 already changes everything around it. The gaps the review listed are closed another way: the page is mounted once for the whole app, always, in host mode, as the one record window, so there is exactly one owner, monitoring goes on with the window closed, the top bar's ● opens the window, and every readout has one place until step 5.
2. **"A track armed" as a reason to open the interface** (nothing-lost review). Not taken; the other two reviews show what it costs (every Play waits for the driver, the mic stays live for ever). Arming only says where a recording goes (F.2, F.5).
3. **Delete on a selected track** (user-intent review: allow it when the last click was on the panel). The stricter fix of the nothing-lost review is taken: the Delete key never removes a track; "Remove track" is in the panel's ⋯ menu (D.1, D.3). One rule, no way to lose a track by a second key press.
4. **Keeping `active` on audio tracks until release 5** (architecture review). Dropped at conversion instead. It was needed only if the Vocals page ran behind a lens; in host mode the page's own take edits and undo are off and the take list works on the new model from release 1 (F.3), so nothing reads it.
5. **`setTempo` trimming overlaps with `layDown`** (architecture review). The re-placing formula is taken as proposed; the trimming is done in playback and drawing only, not in the stored clips (A.7). Reason: a tempo slider dragged up and back must not eat the end of a vocal clip.
6. **The lane inside the record window** (nothing-lost review asked that it be stated). There is no second lane: the timeline's lane gets the audio rules (sixteenth-note moves, free edges, split at the pointer, zoom to 320 px a beat), and the record window keeps the take list (D.2, F.3).
7. **Vocal clips whose section was deleted** (nothing-lost review: keep them as muted clips, or note the loss). The second option: their takes stay in the take list, unplaced, and the conversion toast says how many. Clips whose bar (not section) is gone are kept as muted clips (B.1 step 12).
8. **Moving the old storage blob** (architecture review: move it to IndexedDB; nothing-lost review: consider it). Taken, with one addition: it is removed from local storage only after its IndexedDB copy has been read back equal; where IndexedDB cannot be used it stays put and storage is doubled (B.3). A start can therefore never be left with no copy of the old data.
9. **Bass in release 1** (user-intent review: add the `low` prop or hold Bass back). The `low` prop is added in release 1; Bass stays in the add-track row from the start.

### Where each finding went

| Finding | Resolved in |
|---|---|
| Merge order and worktree independence | H; steps 0, 1a, 1b, 1c |
| The embedded page is a hidden copy of the whole app; the context is more than state and set | E.4 ("The embedded page", "a complete app context") |
| Vocals behind a lens breaks | E.4 (never lensed), F.3 (host mode), B.1 step 12 (input) |
| `update` against `relist`; `next` at the list's end | C.4 |
| Tempo change tears split vocals apart | A.7 `setTempo`, C.7 |
| Old vocal clips overlap | B.1 step 12 (lanes), B.5 fixture 8 |
| Nothing fits a rhythm to its clip's signature | A.4, A.7 `setContent`, E.4 `unlens`, E.2 |
| Drum clips of different grid meeting in a bar | A.6 rule 1, C.2, C.7 |
| Storage doubled; failed write silent | B.3 |
| Stale local copy converted before the cloud is read; work done later in an old build | B.3 (`arrive`), sw cache name |
| Releases 3, 4, 5 collide | H; step 2b |
| Release 1 breaks existing tests | A.1 (new modules beside the old), H (the table of tests) |
| Once-through recording returns no takes | F.3 step 5 |
| Swing lost where the first drums were on but empty; faint default drum clips | B.1 step 5 |
| Empty sections, the cut test, the track-count test | B.1 step 2 (`end`), C.2, B.5 |
| Converted trims cannot be dragged back out | A.1 `AudioClip`, B.1 step 12 |
| The key bar cannot be mounted as is; bass notes lost on a key change | D.1 (`KeyPopover`), A.4, A.7 `transpose` |
| Armed keeps the interface open; armed for ever | A.1 `Session.armed`, F.2, F.5 |
| Small gaps (two leads, undo lock, whole bars, ids with `~`, the shared store, the chord note rule) | B.1 step 10 and C.7; A.8; A.6 rule 8; B.4; C.3; C.3 |
| Canvas opened without its controls; Canvas inputs | E.5, G.9 |
| Takes lost to undo or track removal | A.6 rule 7, A.8, F.3 |
| Delete removes a track | D.1, D.3 |
| Undo and the key; undo and the nudge | A.8 |
| The lens and the reserved chords track; Harmonize into another track; writes to the rest of the state | E.4 |
| A draft lies nowhere; cannot be heard with the song; window stays on the draft after a drop | A.1 `Draft`, A.5, E.2 |
| Vocal clip editing loses precision | D.2 |
| Nobody owns the engine | F.2 |
| Keys only, nothing on screen; the phone | D.2 (`ClipActions`, menus), D.1 (↶ ↷, ⋯), E.1 (sheet from release 1) |
| One key acting twice; Space clicking a grid square | D.3 ("Who gets a key") |
| The sound is not carried by copy and paste | A.7 (`SoundCopy`, `pasteIn`, `duplicateTrack`), B.1 step 15, E.3 |
| Loop of separate stretches removed | A.1 `Session.loop`, A.5, C.4, D.1 |
| Marker editing only in release 5 | D.1; step 1b |
| Backups: the idea on screen, files, the list doubling | B.4 |
| Controls with a home but no builder (Follow, bars on screen, marks in the title, length label, vocals notes, ⟳) | D.1, E.1, E.5; steps 1b and 1c |
| Chords + tab prints every repeat | E.5, G row 56 |
| The other fields of the app state | A.1 `App5State`, B.1 step 17, B.5 |
| Small conversions (input, nudge, compound, "Playing" on synth) | B.1 step 12, A.8, E.3, E.2 |
| No way to add empty bars | D.1, D.3 (Insert) |
| Tracks split by settings that are not heard | B.1 step 6 |
| The drum composer has no kit and no effects | E.1 (Sound button), E.2 (Kit picker) |
| Compose lays an empty clip over music in release 1 | E.2 ("What the compose button opens") |
| Input list empty before arming | F.2 |
| Where a window first opens | E.1 (`firstPlace`) |
| R records | D.3 |
| Timeline extent and first zoom; marker double-click; monitor per track; panel width; "Blank" and the clef; "New"; play inside the loop; rhythm and clip length; box select; takes across tracks; bypass; pinned children; browser keys; kit names | D.1; D.1; D.1 and F.2; D.1; D.1; E.2; C.4; A.4; D.2; A.7; E.3; E.1; D.1 and D.3; E.3 |
