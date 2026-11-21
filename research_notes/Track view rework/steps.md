# Track view rework: the delivery steps

These are the build briefs for `spec.md` (beside this file). Section H of the spec is the map; this file is the detail. Each step below can be handed to a builder who has read nothing else: it says what to build, in which files, with which function signatures, what to leave alone, how a tester checks it in the real app, and when it is done. Where a step says "A.7" or "C.3", that is a section of `spec.md`; read it before writing code. Signatures here are copied from the spec. If the two ever differ, the spec wins and this file is corrected.

## The plan in ten lines

1. The app becomes one page, the track view: a top bar, a ruler, track panels, lanes with clips. Sections go.
2. A song is tracks plus clips (stored version 5). A clip is a window onto content that repeats, so one edge drag both trims and repeats.
3. Sound belongs to the track. How chords are played stays on the clip.
4. The audio engine is kept. One new pure function, `flatten`, turns tracks and clips into the list the player, the WAV render and the MIDI writer already take.
5. Old songs are converted once, after a full old-format load, into a new storage key and a new cloud prefix. The old data is never written again and is the backup; every converted idea gets a backup entry in Ideas.
6. Release 1 (steps 0 to 1d) switches the app over in one moment, step 1c. Before it, everything new sits beside the old code and nothing on screen changes.
7. In release 1 the old composer pages still do the composing, each shown in a simple window through a "lens" that presents one clip as a one-section old song. Vocals use the old page in a host mode.
8. Releases 2 to 5 replace those windows with real plugins: drums and sound windows first, then chords, then melody and bass, then recording.
9. Release 6 is the blank audio track (any input or stereo pair, record once from the cursor, the browser's microphone). Its desktop engine work (6r) can be built from day one.
10. Release 7 deletes the leftovers and tunes the phone layout. Nothing is lost on the way: table G of the spec gives every one of today's 218 features its new home.

## Merge order

```
0  →  1a part 1  →  1a part 2  →  1b  →  1c  →  1d          = release 1
→  2                                                        = release 2
→  2b  →  3, 4 and 5 in any order                           = releases 3, 4, 5
→  6  (needs 6r)                                            = release 6
→  7                                                        = release 7

6r: built any time from now; merged before 6
```

| Step | Starts when | May be built beside | Merges after |
|---|---|---|---|
| 0 | now | 6r | nothing |
| 1a part 1 | 0 is merged | 1b, 6r | 0 |
| 1a part 2 | 1a part 1 is merged | 1b, 6r | 1a part 1 |
| 1b | 0 is merged (its gestures need 1a part 1) | 1a, 6r | 1a part 2 (nothing in the app imports it yet) |
| 1c | 1a and 1b are merged | the pure half of 1d, 6r | 1b |
| 1d | its pure half: 1a is merged. Its screen half: 1c is merged | 1c (pure half only), 6r | 1c |
| 2 | 1d is merged | 6r | 1d |
| 2b | 2 is merged | 6r | 2 |
| 3, 4, 5 | 2b is merged | each other, 6r | 2b |
| 6r | now | everything | before 6 |
| 6 | 5 and 6r are merged | nothing | 5, 6r |
| 7 | 6 is merged | nothing | 6 |

The app that users see changes exactly once, at 1c. Steps 0, 1a and 1b add files that nothing on screen uses. 1c is the only step that edits `src/ui/App.tsx` and `src/ui/views/GuitarView.tsx`.

## What the user gets, release by release

| Release | Steps | What the user can do that they could not before | What still runs on old code |
|---|---|---|---|
| 1 | 0, 1a, 1b, 1c, 1d | Every old idea opens as tracks and clips and plays as before. Clips move, copy, split, and repeat or trim by their edges. The ruler loops any stretch, or several. The timeline scrolls and zooms. Space plays from anywhere. One undo for everything. Six kinds of track, any number. Every composer and sound panel opens from its track in a window. Vocals record round the loop. Markers, exports and the Canvas work. The originals are in Ideas under "Before track view" | Composers and sound panels are the old pages, one window per track. No clip strip, no drafts. Bass has a two-octave grid, two octaves down. Inputs 1 and 2 only |
| 2 | 2 | The bass-clef button opens a real plugin with the clip being composed at the bottom, which drags onto lanes of its own kind only. Every track has its own sound window, with bypass and copy and paste of a sound. The Drums plugin is complete | Chords, Melody and Vocals composers are the old pages |
| 3 | 2b, 3 | The Chords plugin, with playing style and feel per clip and "All clips" | Melody and Vocals composers |
| 4 | 4 | Bass and melody over seven octaves, with one-press octave jumps | The Vocals composer |
| 5 | 5 | Recording and comping as a plugin. Audio setup in Settings | Inputs 1 and 2 only; recording goes round a loop |
| 6 | 6r, 6 | The blank track: any input or stereo pair, record once from the cursor. Microphone recording in the browser | Leftover files that nothing mounts |
| 7 | 7 | The leftovers are gone. A layout made for the phone | nothing |

## Rough size of release 1

Counted as new lines written, tests included. These are estimates to plan with, not limits.

| Step | New lines | Files (new + edited) | Where the risk is |
|---|---|---|---|
| 0 | about 700 | 10 new, 1 edited | The frozen copy of the plan builder drifting from the original while it is copied by hand |
| 1a part 1 | about 2,100 | 7 new, 2 edited | `layDown` and the edge rules (off-by-one at clip edges); `setTempo` for split audio clips |
| 1a part 2 | about 4,700 | 17 new, 5 edited | Render equality on all 17 fixtures is the hard gate: splitting by sound, the pedal and pad rule, swing with empty drums. The lens's reserved chords track. Two touches of the audio engine |
| 1b | about 4,700 | 22 new, 2 edited | Pointer work (drag, edges, box select) and the key rules. Drawing only what is in view |
| 1c | about 4,600 | 18 new, 15 edited | The one moment old data is converted and stored. The embedded mode of a 1,900-line view. Edits while playing (`update` against `relist`). Storage that is full |
| 1d | about 2,100 | 8 new, 4 edited | The recording engine's owner must stay single. Needs a real interface to test. Takes surviving undo |
| **Release 1** | **about 19,000** | **about 110** | |

## Rules for every step

- **Checks before a step is called done:** `npx tsc --noEmit` is clean; `npm test` is all green; `npm run build` passes; the test count in `README.md` (the line that starts `npm test          # 1545 tests:`) is updated to the new number, with a few words for what was added.
- **Tests** run in node. Only files named `*.test.ts` under `src/` are run (`vite.config.ts`). A component is tested by rendering it to text with `renderToStaticMarkup` from `react-dom/server`, as `src/ui/components/takelane.test.ts` does. Audio is tested on the pretend context in `src/audio/fakectx.ts`, as `src/audio/player.test.ts` does. No new packages.
- **Every existing test in `src/audio/` other than `handoff.test.ts` passes unedited in every step.** If one fails, the step has changed the engine and must be put right, not the test.
- **Commit messages** end with the two trailer lines the repository's recent commits end with: a `Co-Authored-By:` line and a `Claude-Session:` line. Run `git log -3` and use the same form.
- **Words on screen** are plain. No product, maker or model names. The program that was studied is "the reference program" in notes and is never named on screen.
- **The old view is type-checked until step 7**, also where it is no longer mounted. `src/ui/views/GuitarView.tsx` imports `DrumMachine`, `MelodyGrid`, `HarmonyPicker`, `ShapeFinder`, `HarpPanel`, `VocalsPage`, `CanvasPage`, `TrackPage` and `FrameSections`. So a prop added to one of those is optional, the component behaves as before without it, and none of those files is deleted before `GuitarView.tsx` is.
- **Names that exist twice.** The new model has `Track`, `TrackKind`, `Clip` and `ClipKind` in `src/timeline/model.ts`; the old code has types of the same names in `src/song/tracks.ts`, `src/song/clips.ts` and `src/song/clip.ts`. `keepTakes` is a new function in `src/timeline/history.ts` and an old one in `src/audio/takebuffers.ts`. Import by path, and rename on import where one file needs both.
- **The window to test in** is the desktop app (`npx tauri dev`) with its window sized 1280 × 800, or `npm run dev` and a browser window whose page area is 1280 × 800. Checks that need the audio interface say so.

---

## Step 0: groundwork

**Goal.** One small commit that copies two pieces of code out of the big view, adds a few exports, and declares the types every later step shares. Nothing on screen changes and nothing new is used yet.

**Depends on:** nothing. **May run beside it:** 6r. Steps 1a and 1b wait for it.

**Read first:** spec A.1 (types), A.7 (only `SoundCopy` and `Clipboard5`), B.5 (the block that starts `// src/timeline/voicing.ts`), C.4 (`PlayerApi`), E.1 (`WinState`).

### Create

| File | Holds |
|---|---|
| `src/timeline/model.ts` | Every type of A.1 exactly as written there: `TrackKind`, `ClipKind`, `ChordsTrack`, `TuneTrack`, `DrumsTrack`, `InputRef`, `AudioTrack`, `Track`, `Draft<C>`, `ChordsContent`, `ChordsClip`, `MelodyClip`, `DrumsClip`, `AudioClip`, `NoteClip`, `Clip`, `HarmonyMark5`, `Take5`, `Shelved`, `Marker`, `TimelineSong`, `Region`, `Session`. The constants `SONG_V = 5`, `CLIP_OF` and the function `accepts`. Also declared here (so this file imports nothing from the new screen code): `WinState` (E.1), `SoundCopy` and `Clipboard5` (A.7). No other functions: the helpers of A.3 are step 1a part 1 |
| `src/timeline/library5.ts` | The type `SavedIdea` (A.1) and nothing else. Its functions are step 1a part 2 |
| `src/ui/app5.tsx` | The types `App5State` and `Ctx5` (A.1) and nothing else. The provider is step 1c |
| `src/ui/timeline/api.ts` | The type `PlayerApi` (C.4) and nothing else |
| `src/timeline/voicing.ts` | `VoicingCtx` and `voicingsFor`, copied from `src/ui/views/GuitarView.tsx:96-125` (`optsOf` and `voicingsOf`) with the hook's values turned into the argument |
| `src/song/legacyplan.ts` | `SecPlan` (from `GuitarView.tsx:1280`), `legacyPlan` (from `:204-307`), `legacySlice` (from `:327-343`) |

Signatures (from the spec):

```ts
// src/timeline/voicing.ts
export interface VoicingCtx { tuning: Tuning; capo: number; avoidBarre: boolean; shapeOf(ref: ChordRef, voicingId?: string): Voicing | undefined }
export function voicingsFor(ctx: VoicingCtx): (chords: ProgChord[], arrange: ArrangeSettings | null | undefined) => (Voicing | undefined)[];

// src/song/legacyplan.ts
export type SecPlan = { block: string; partId: string; label: string; color: number; bars: number; bar: number; items: PlayItem[]; idx: number[] };
export function legacyPlan(p: Progression, ctx: VoicingCtx, buffer: (t: Take) => AudioBuffer | undefined): { items: PlayItem[]; map: { block: string; idx: number }[]; per: SecPlan[]; any: boolean };
export function legacySlice(per: SecPlan[], loop: LoopSpan): { items: PlayItem[]; map: { block: string; idx: number }[]; loop: true };

// src/ui/timeline/api.ts
export interface PlayerApi {
  playing: boolean;
  toggle(): void;
  stop(): void;
  getBeat(): number | null;
  seek(beat: number): void;
  audition(span: Region | null, solo?: string): void;
}

// src/timeline/model.ts (the three that the spec shows in other sections)
export interface WinState { id: string; kind: "compose" | "sound"; track: string; clip?: string; x: number; y: number; w: number; h: number; open: boolean }
export interface SoundCopy { kind: ClipKind; tone?: Tone; sound?: Partial<HarpSound>; kit?: DrumKit; fx?: VocalFx }
export interface Clipboard5 { key: Key; clips: Clip[]; tracks: Track[]; takes: Take5[] }
```

How to copy `legacyPlan`. The original is a `useMemo` inside the view. In the copy: the song passed in is the song heard (`heard` and `prog` are both `p`; there is no audition); `secs` is `sections(p)`; `songSig` is `sigOf(p)` (`src/song/unity.ts:66`); every `voicingsOf(...)` call uses `voicingsFor(ctx)`, also for the section on screen (the original's shortcut `sec.current ? voicings : …` gives the same shapes for a settled song); `takeBuffer(tk)` becomes `buffer(tk)`. Keep everything else line for line, comments included, and put one comment at the top: "Frozen copy of GuitarView.tsx:204-307 at commit 0f436e9. The reference a converted song is compared with. Do not improve it."

### Edit (additions only)

| File | Change |
|---|---|
| `src/ui/state.tsx` | Add the word `export` to `const AppCtx` (line 368), `interface Ctx` (line 310) and `const STORAGE_KEY` (line 214). Add `export type AppStateV4 = AppState;`. Split `load` (line 279) in two without changing what it does: an exported `loadV4(raw)`, which takes the stored text (or null) and returns an `AppState`, holds everything after the read (the parse and the revive, in its own `try`, giving `DEFAULT_STATE` on a fault), and `load()` reads the key, notes `loadedRaw` and returns `loadV4(raw)`. The new code needs the parse on its own because its tests hand it a text, not a browser. Add the optional field `inputs?: number` to `Studio` (line 185) with the comment "how many inputs the interface had when it was last open". Nothing else |

### Do not touch

`src/ui/views/GuitarView.tsx` (the originals stay where they are until step 7), `src/ui/App.tsx`, everything under `src/audio/`, every existing test, `src/ui/styles.css`.

### Acceptance checks (1280 × 800)

1. Start the app. Open an idea that has sections, chords, a melody and drums. Expected: every page looks as it did before this step.
2. Press ▶ on the Track page, let two sections play, press ■. Expected: it sounds as before.
3. Reload the app with ideas saved. Expected: the same idea is on screen and the Ideas list is the same (the split loader reads as before).
4. Run `git diff --stat` against the commit before. Expected: only the seven files above (six new, one edited) and the new tests; the diff of `src/ui/state.tsx` shows added exports, one added optional field, and `load` split in two with the same lines in the same order.

### Automated tests to add

| File | Asserts |
|---|---|
| `src/timeline/model.test.ts` | `accepts`: all 24 pairs of track kind and clip kind (a melody clip on a bass track and an audio clip on a vocals track are accepted; a drums clip on a chords track is not) |
| `src/timeline/voicing.test.ts` | A rest gets no shape and the chords either side keep theirs; with `arrange` set the result has one entry per chord; a chord with written notes gets the shape that plays exactly those notes where a hand can |
| `src/ui/loadv4.test.ts` | `loadV4(null)` is the default state; a stored text with two saved ideas gives both back revived; a text that is not JSON gives the default state and does not throw |
| `src/song/legacyplan.test.ts` | For a song with no sections, one with three sections and a repeat, and one with a 6/8 section: the items' beats add up to the sum of the sections' beats; the first item of each section has `section: true`; a section whose chords end early ends in one `pad` item; `map` has one entry per item; the same input twice gives deep-equal output. `legacySlice` over bars 3 to 6 of a two-section song gives items whose beats add up to four bars, the first with `from` set |

### Existing tests that change on purpose

None.

### Left for later

Every function of the new model (1a), every screen (1b), the provider (1c).

### Done means

- [ ] The six files exist and export exactly the names listed.
- [ ] `src/ui/state.tsx` differs only by the added exports, the one optional field and the split of `load`; every existing test passes unedited.
- [ ] `npx tsc --noEmit` clean, `npm test` green, `npm run build` passes.
- [ ] README test count line updated.
- [ ] Commit message ends with the two trailer lines.

---

## Step 1a, part 1: the model's helpers, the bar map, the edits, undo

**Goal.** The pure functions that change a version 5 song: lengths and the repeat rule, bars and time signatures, every edit a user can make, and the undo history. No screen, no storage, no audio.

**Depends on:** 0. **May run beside it:** 1b (which waits for this part before writing its gestures), 6r. **Lands first, on its own**, so 1b can call it.

**Read first:** spec A.3 (lengths and the repeat rule, with its worked example), A.4 (key, tempo, signature), A.5 (loop and draft anchor), A.6 (the eight rules), A.7 (edits), A.8 (undo), D.4 (a new track's defaults).

### Create

| File | Holds |
|---|---|
| `src/timeline/bars.ts` | `BarMap`, `barMap` |
| `src/timeline/edit.ts` | every function of A.7; re-exports the types `SoundCopy` and `Clipboard5` from `./model` |
| `src/timeline/history.ts` | `Step`, `History`, `makeHistory`, `keepTakes` |
| `src/timeline/testsongs.ts` | small hand-built songs used by this step's tests and the next part's (not by the screen: 1b has its own fixture) |

### Edit

| File | Change |
|---|---|
| `src/timeline/model.ts` | Add the helpers of A.3 below the types. This part is the only step that edits this file after step 0 |

Signatures (from the spec):

```ts
// src/timeline/model.ts (A.3)
export const contentBeats = (c: NoteClip): number => c.content.bars * sigBeats(c.sig);
export const contentFrames = (c: AudioClip): number => c.to - c.from;
export function clipBeats(c: Clip, bpm: number, rate?: number): number;
export const clipEnd = (c: Clip, song: TimelineSong): number;
export const phase = (c: NoteClip, x: number): number => mod(c.off + (x - c.start), contentBeats(c));
export function notches(c: Clip, song: TimelineSong): number[];
export function cycles(c: NoteClip): { at: number; from: number; to: number }[];

// src/timeline/bars.ts (A.4)
export interface BarMap {
  beatOfBar(bar: number): number;
  barAt(beat: number): { bar: number; beat: number; sig: TimeSig };
  sigAt(beat: number): TimeSig;
  lines(from: number, to: number): { beat: number; bar: number }[];
  snapBar(beat: number): number; snapBeat(beat: number): number; floorBar(beat: number): number;
}
export function barMap(song: Pick<TimelineSong, "meter" | "sigs">): BarMap;

// src/timeline/edit.ts (A.7; `song` is a TimelineSong everywhere)
export function addTrack(song, kind: TrackKind, id: string, at?: number): TimelineSong;
export function removeTrack(song, id: string): TimelineSong;
export function duplicateTrack(song, id: string, newId: string): TimelineSong;
export function moveTrack(song, id: string, toIndex: number): TimelineSong;
export function renameTrack(song, id: string, name: string): TimelineSong;
export function setTrack<T extends Track>(song, id: string, patch: Partial<T>): TimelineSong;
export const copySound: (t: Track) => SoundCopy;
export function pasteSound(song, id: string, s: SoundCopy): TimelineSong;
export function layDown(song, clip: Clip): TimelineSong;
export function moveClips(song, ids: string[], dBeats: number, toTrack?: string): TimelineSong;
export function copyClips(song, ids: string[], dBeats: number, toTrack: string | undefined, id: () => string): TimelineSong;
export function duplicateClips(song, ids: string[], id: () => string): TimelineSong;
export function resizeClip(song, id: string, edge: "left" | "right", toBeat: number): TimelineSong;
export function splitClips(song, ids: string[], atBeat: number, id: () => string): TimelineSong;
export function deleteClips(song, ids: string[]): TimelineSong;
export function setContent(song, id: string, content: NoteClip["content"]): TimelineSong;
export function setDraft(song, track: string, content: NoteClip["content"] | null, sig: TimeSig): TimelineSong;
export function placeDraft(song, track: string, atBeat: number, id: () => string): TimelineSong;
export const blankContent: (kind: ClipKind, sig: TimeSig) => NoteClip["content"];
export const draftAnchor: (song: TimelineSong, session: Pick<Session, "cursor" | "loop">) => number;
export function setSig(song, atBar: number, sig: TimeSig, fromHereOn: boolean): TimelineSong;
export function setTempo(song, bpm: number): TimelineSong;
export function transpose(song, n: number, from: Key, to: Key): TimelineSong;
export function songEnd(song): number;
export function clipsIn(song, from: number, to: number): string[];
export function cutTime(song, from: number, to: number): TimelineSong;
export function insertTime(song, at: number, beats: number): TimelineSong;
export function copyOut(song, ids: string[], key: Key): Clipboard5;
export function pasteIn(song, c: Clipboard5, atBeat: number, key: Key, onto: string | null, id: () => string): TimelineSong;

// src/timeline/history.ts (A.8)
export interface Step { song: TimelineSong; key: Key; label: string }
export interface History {
  push(before: Step, control?: string): void;
  undo(now: Step): Step | null; redo(now: Step): Step | null;
  clear(): void; canUndo: boolean; canRedo: boolean;
}
export function makeHistory(limit = 100): History;
export function keepTakes(restored: TimelineSong, current: TimelineSong): TimelineSong;
```

What each must do is in the spec; the points a builder most easily gets wrong:

- **Every function is pure** and returns the same song object when nothing changes (the screen relies on this to skip work).
- **`layDown`** trims what the new clip covers and splits a clip it lands inside (A.6 rule 2). Every function that puts a clip somewhere (`moveClips`, `copyClips`, `duplicateClips`, `placeDraft`, `pasteIn`, `resizeClip` when it grows) goes through it.
- **`resizeClip`** follows A.3: the right edge only changes `len`; the left edge changes `start`, `len` and `off = mod(off + (s - start), contentBeats)`. For an audio clip the numbers are frames and the edge first uncovers the rest of the take, then repeats (A.1, the comment on `AudioClip`). An edge stops at the next clip on the track and at beat 0. Note clips stay on whole beats; drums clips on bar lines (A.6 rule 1).
- **`splitClips`**: a note clip gives two clips with separate deep copies of the content, the right one with `off = phase(x)`. An audio clip keeps `take`, `from`, `to` and advances `off` (A.7, "Split").
- **`setContent`** runs `fitRhythm(groove, sigBeats(clip.sig), isCompound(clip.sig))` (`src/song/meter.ts:59`) on a drums content, so `steps / div === sigBeats(clip.sig)` always holds (A.4). `setDraft` does the same with the draft's `sig`.
- **`setTempo`** re-places every audio clip with the formula in A.7 (`zero` stays put), clamps at beat 0 by advancing `off`, and trims nothing.
- **`transpose`**: chords by `transposeChord` (`src/song/chordnotes.ts:51`); melody and bass notes by `melodyBase(to) - melodyBase(from)` (`src/song/melody.ts:117`); a note that would leave 24..108 moves one more octave back in (A.4). Drafts move too.
- **`removeTrack`** moves an audio track's takes to `song.shelf` (A.8). When the removed track had `lead`, the top track of its kind gets it (D.4).
- **`addTrack`** uses the defaults of D.4: `GUITAR` (`src/audio/tone.ts:46`), `SOUND_DEFAULT` (`src/audio/rack.ts:79`), `PLAIN_KIT` and `PLAIN_STYLE` (`src/song/tracks.ts:155-157`), the first preset of `presetsIn("bass")` (`src/synth/presets.ts:378`) for a Bass track, `presetFx` or `FX_DEFAULT` (`src/audio/vocalfx.ts`) for Vocals and the same with the chain off for Blank. The first chords track and the first drums track get `lead: true`. Track ids `"chords"`, `"melody"`, `"drums"` are refused (A.6 rule 4).
- **`cutTime`, `insertTime`** and a paste with insert snap to bar lines first and move markers, signature changes and `end` too (A.6 rule 8).
- **`pasteIn`**, `moveClips` and `copyClips` across audio tracks carry the take records; files are shared, never copied (A.7).
- **`blankContent("melody", sig)`** is on the triplet grid in 6/8, 9/8 and 12/8 (copied from `blankMelody`, `GuitarView.tsx:1510`).
- **`keepTakes`**: for each audio track the takes list is the restored one plus every take the current one has, by id; if the restored song has no such track, its takes go to `shelf` (A.8).
- **`History.push`** folds changes from one `control` within 500 ms into one step.

### Do not touch

Anything outside `src/timeline/`. In particular no file under `src/ui/`, `src/audio/` or `src/song/`. In `src/timeline/`: not `library5.ts`.

### Acceptance checks

There is no screen. The check is the test run, plus one reading check: open `src/timeline/edit.ts` and confirm no function reads `Date`, `Math.random`, storage or the DOM (ids come in through the `id` argument).

### Automated tests to add

| File | Asserts |
|---|---|
| `src/timeline/model.test.ts` (extend) | The worked example of A.3, number for number: `cycles` of the 40-beat clip, notches at 32 and 48, then the left-edge drag gives `off 8, len 48, start 8` and a notch at 16. `phase` for a negative distance. `clipBeats` of an audio clip follows the tempo |
| `src/timeline/bars.test.ts` | A song `4/4, sigs [{bar 8, 6/8}, {bar 12, 4/4}]`: `beatOfBar(8) = 32`, `beatOfBar(12) = 40`; `barAt(33)` is bar 8 with 6/8; `lines` between two beats; `snapBar`, `snapBeat`, `floorBar` on both sides of a change; no `sigs` at all |
| `src/timeline/edit.test.ts` | One block per function of A.7. At least: `layDown` over the start, the end, the middle (split in two) and the whole of a clip; `moveClips` of two selected clips keeps their spacing and never goes before 0; a move onto a track that does not accept the clip changes nothing; `copyClips` gives a new id and a content that is equal but not the same object; `resizeClip` both edges, a drums clip refusing a beat that is not a bar line, an audio edge uncovering the take and then repeating; `splitClips` halves of a note clip and of an audio clip; `setContent` with every rhythm of `BEAT_LIBRARY` into a 3/4 and a 6/8 clip keeps `steps / div === sigBeats(sig)`; `setSig` refits the clips of the stretch and keeps their bar numbers; `setTempo`: split an audio clip, go 96 → 120 → 80 → 96, the halves share `zero` at every tempo and the final song deep-equals the first; `transpose`: a bass clip on E1 moved −1 twelve times keeps every note, and +1 then −1 gives the first song back when no note wrapped; `cutTime` and `insertTime` move markers, `sigs` and `end`, and split a clip that lies across; `copyOut` then `pasteIn` into a song with no track of that kind makes the track with the copied sound; `pasteSound` onto another kind changes nothing; `removeTrack` of an audio track puts its takes on the shelf and passes `lead` on; `duplicateTrack` has the sound and no clips; `draftAnchor` with the loop on and off; `songEnd` with `end` beyond the last clip |
| `src/timeline/history.test.ts` | Push, undo, redo; a new push clears redo; the limit of 100; two pushes from one control inside 500 ms are one step, from two controls are two; a step holds the key (undo after "move song" gives the old key back); `keepTakes`: a recording's takes are still on the track after undo and after one more edit; an undone track's takes are on the shelf |

### Existing tests that change on purpose

None.

### Left for later

`flatten`, conversion, the lens (part 2). The recording edits `record.ts` and `audioclips.ts` (1d). Storage and the provider that owns the history (1c).

### Done means

- [ ] Every signature above is exported with exactly that name and shape.
- [ ] Nothing outside `src/timeline/` changed.
- [ ] `npx tsc --noEmit` clean, `npm test` green, `npm run build` passes.
- [ ] README test count line updated.
- [ ] Commit messages end with the two trailer lines.

---

## Step 1a, part 2: cuts, `flatten`, conversion, the library, the lens, two engine touches

**Goal.** Everything between a version 5 song and the unchanged audio engine, and everything between an old song and a version 5 song, proved by a test that a converted song asks the engine for exactly what the old song asked for. Still no screen.

**Depends on:** 1a part 1. **May run beside it:** 1b, 6r.

**Read first:** spec B.1 to B.5 (conversion, all of it), C.1 to C.3, C.6, C.7 (playback), E.4 up to "What `unlens` writes back" (the lens), E.2 "Bass" (only `gridRows`). Also `map-audio.md` section 3 for how the player reads a `PlayItem`.

### Create

| File | Holds |
|---|---|
| `src/timeline/cuts.ts` | `cutPoints` (C.2, five rules) |
| `src/timeline/flatten.ts` | `FlattenCtx`, `Range`, `Flat`, `flatten`, `songBeat` (C.1, C.3) |
| `src/timeline/migrate5.ts` | `Converted`, `toTimeline` (B.1, eighteen steps) |
| `src/timeline/convert.ts` | `convertAll`, `convertIdea`, `arrive` (B.3). `backupSource` is added in 1c, with storage |
| `src/timeline/lens.ts` | `Target`, `Lens`, `lensOf`, `unlens`, `chordsUnderSpan`, `harmonyState5` (E.4) |
| `src/timeline/renderlog.ts` | the test helper `RenderLog`, `renderLog` (B.5) |
| `src/timeline/fixtures5.ts` | the 17 old-format fixture songs of B.5 and the worked example of B.2, as functions that build them |
| `src/timeline/fixtures/v4-ideas.json` | the same 18 songs as a version 1 backup file (what `exportIdeas` in `src/song/library.ts:178` writes), named "Fixture 1" to "Fixture 17" and "Worked example", for testers to restore into an old build |

### Edit

| File | Change |
|---|---|
| `src/timeline/library5.ts` | add `reviveIdea5`, `reviveSong5`, `reviveMelody5`, `fingerprint5`, `describeIdea5`, `mergeIdeas5`, `toPush5`, `exportIdeas5`, `importIdeas5` (B.3, B.4), modelled one for one on `src/song/library.ts` |
| `src/song/melody.ts` | E1: the optional field `len?: number` on `MelodyNote` (line 16), carried on each hit by `tuneBetween` (line 147). `reviveMelody` stays as it is (the old stored format has no lengths; `reviveMelody5` keeps `len`). Also `gridRows`, `GRID_LOW`, `GRID_HIGH` (E.2). `melodyRows` stays as it is |
| `src/audio/trackplay.ts` | E1: `playTuneNote` (line 167 region) and `tuneSection` (line 126) hold a note for `min(len, time to the next note)` when `len` is given |
| `src/audio/synth.ts` | E1 at the melody scheduling (line 826 region) and in `renderSong` (line 975): pass the note's `len` on |
| `src/audio/patterns.ts` | E2: `PlayItem.meter` gets `swing?: number` (line 242), and so does the `own` argument of `meterOf` (lines 227-231), which returns it when given instead of the drums' swing. Every caller already passes `item.meter` as `own` (`patterns.ts:312`, `synth.ts:331`, `trackplay.ts:94`), so nothing else changes |

Signatures (from the spec):

```ts
// src/timeline/cuts.ts
export function cutPoints(song: TimelineSong): number[];   // beats, sorted, the first one 0, the song's end not included

// src/timeline/flatten.ts
export interface FlattenCtx {
  voicingsOf(chords: ProgChord[], arrange: ArrangeSettings | undefined): (Voicing | undefined)[];
  buffer(take: Take5, dry?: boolean): AudioBuffer | undefined;
  bypass?: ReadonlySet<string>;
}
export interface Range { spans: Region[]; loop: boolean; cut?: number }
export interface Flat { items: PlayItem[]; at: number[]; origin: number[]; loop: boolean; any: boolean; end: number }
export function flatten(song: TimelineSong, ctx: FlattenCtx, range?: Range): Flat;
export const songBeat = (flat: Flat, pos: { index: number; beat: number }): number => flat.origin[pos.index] + pos.beat;

// src/timeline/migrate5.ts
export interface Converted { song: TimelineSong; ids: Record<string, string[]>; }
export function toTimeline(p: Progression): Converted;

// src/timeline/convert.ts
export function convertAll(old: AppStateV4): App5State;
export function convertIdea(i: SavedProgression): { idea: SavedIdea; backup: SavedIdea };
export function arrive(s: App5State, old: SavedProgression, original: (id: string) => SavedProgression | null): { state: App5State; added?: "new" | "refreshed" | "beside" };

// src/timeline/lens.ts
export interface Target { track: string; clip?: string; fresh?: { id: string; at: number; sig: TimeSig } }
export interface Lens { p: Progression; span: Region; lead: string | null }
export function lensOf(song: TimelineSong, target: Target, key: Key, anchor: number): Lens | null;
export function unlens(song: TimelineSong, target: Target, lens: Lens, after: Progression, id: () => string): TimelineSong;
export function chordsUnderSpan(song: TimelineSong, span: Region): ProgChord[];
export function harmonyState5(song: TimelineSong, key: Key, clip: string): HarmonyState;

// src/timeline/renderlog.ts (test helper)
export interface RenderLog {
  notes: { track: string; midi: number; when: number; velocity: number; length: number; slot?: number }[];
  voices: { track: string; tone: string; sound: string }[];
  hits: { track: string; drum: string; level: number; when: number; kit: string }[];
  pedals: { track: string; when: number }[];
  takes: { track: string; take: string; when: number; offset: number; dur: number }[];
}
export async function renderLog(items: PlayItem[], bpm: number, rename?: (track: string) => string): Promise<RenderLog>;

// src/song/melody.ts
export function gridRows(key: Key, low: number, octaves: number, keyOnly?: boolean): MelodyRow[];
export const GRID_LOW = 24, GRID_HIGH = 108;
```

Points a builder most easily gets wrong:

- **`toTimeline` takes a fully loaded old song**: after `migrateSong`, revive, and `conform(settle(prune(commit(p))))` (B, first paragraph). It never reads raw JSON. `convertIdea` and `convertAll` do that settling themselves before they call it, so no caller can forget. All ids are derived from old ids (B.1 step 7), so the same input gives the same output on every device.
- **Split by what is heard, not by the whole instrument object** (B.1 step 6, `heardTone`). A guitar that remembers a synth it is not playing must not become two tracks.
- **Drums:** no clip for a part that is off, unedited and on the default rhythm; an empty clip for the first drums row that is on with swing or the triplet grid (B.1 step 5).
- **Vocal clips** become `{ from: 0, to: take.frames, off: clip.from, frames: clip.to - clip.from }` at the same sample as `layClips` gives (`src/song/clips.ts:296`), and overlapping clips become lanes, each lane a track (B.1 step 12).
- **`flatten` writes silent items.** Every track, the lead ones too, plays through `extra` (C.3). The chord note rule is copied exactly from `GuitarView.tsx:250` (C.3, `midi`). Sounds, tones and kits are the same object across items, kept in a `WeakMap` keyed by the track's own object (C.3, "Shared objects"). The result is kept per pseudo-section in a `WeakMap`, so an edit rebuilds one part (C.3, "Cost").
- **`Range`**: the first item of each span has `section: true` and `from`; the first item of each later span has `jump: true`; `cut` makes an item start on that beat and gives it `from` (C.3, "Range").
- **`ctx.bypass`** is honoured from the start (a sound with every effect amount at zero, a kit with its effects at zero, a take's dry file), though no screen sets it before step 2.
- **`lensOf` returns the same object** while the clip, its track, the key and what it read under the span are the same objects (E.4). The reserved id `chords` in the lens song is the song's lead chords under the span; `Lens.lead` remembers the real track.
- **`unlens` runs `conform(normalize(after))` first**, then the six rules of E.4.
- **`arrive`** follows the table in B.3 row by row. A converted idea keeps the old `updatedAt` and records it in `from.at`.
- **E1 and E2 are additive.** Write each one's test first, see it fail, then make the change. Every existing audio test must pass unedited afterwards.

### Do not touch

Anything under `src/ui/` (including `src/ui/app5.tsx`: import its type, do not add to it). `src/song/structure.ts`, `tracks.ts`, `unity.ts`, `migrate.ts`, `library.ts` (the frozen old-song reader). `src/timeline/edit.ts`, `bars.ts`, `history.ts`, `model.ts` except to fix a fault found, in its own commit. In `src/audio/`: only the four places named for E1 and E2.

### Acceptance checks

No screen. Besides the test run:

1. In an old build (the commit before this step, or any build before 1c), open Ideas → Restore and choose `src/timeline/fixtures/v4-ideas.json`. Expected: 18 ideas appear ("Fixture 1" to "Fixture 17" and "Worked example") and each opens. (This proves the tester's file is a real backup file; it is used again in step 1c.)
2. Play fixture 5 (4/4, then 6/8, then 3/4) in the old build before and after this step is merged. Expected: no difference. (E1 and E2 add nothing to an old song.)

### Automated tests to add

| File | Asserts |
|---|---|
| `src/timeline/cuts.test.ts` | Each of the five rules of C.2 on a hand-built song; a drums clip of one rhythm stamped bar after bar forces no cut; the 32-bar rule picks the bar line the fewest clips cross |
| `src/timeline/flatten.test.ts` | Item edges for a lead chords track with a gap (a pad per bar); the pad is not cut per bar under a pedalled piano melody; `extra.chords` across two cycles of a clip with an offset; a clip with `instead` silences its target only over its own span; drums rows written out step by step over a pseudo-section, the same `Beat` object back when nothing changed; `extra.takes` ids `clip` and `clip#1` for a repeat, `joined` for two halves of a split, `dur` cut where a clip runs into the next; a melody's last note gets `len` to the clip's end; a range with two spans gives one `jump`; `cut` gives an item on that beat with `from`; `bypass` gives the dry buffer and a zeroed sound; a muted clip sounds nowhere but a mixer-muted lead track still makes the grid |
| `src/timeline/migrate5.test.ts` | Structure tests 1 to 14 of B.5, one `it` each, in that order |
| `src/timeline/equal.test.ts` | Render equality (B.5): for each of the 17 fixtures, `renderLog(legacyPlan(p).items)` equals `renderLog(flatten(toTimeline(p).song).items)` with ids mapped back through `Converted.ids`, times within 1e-6 s, voices compared by the reduced sound key. The same on the live player (`ProgressionPlayer.start` on the pretend live context, the clock run to the song's end). The same on a loop: `legacySlice` over bars 3 to 6 against `flatten` with `{ spans: [{ from, to }], loop: true }`. `progressionToMidi` from both lists gives the same notes per track. Also: `fixtures/v4-ideas.json` equals `exportIdeas` of the fixtures, so the tester's file cannot drift |
| `src/timeline/convert.test.ts` | `convertAll`: every saved idea and the idea on screen converted, a backup entry for each (ids `<id>-v4`, `draft-<draft id>-v4`, `<id>-u-v4`), every other field equal before and after (B.5 test 14), the old chords clipboard becomes a clipboard whose track carries the copied sound. `arrive`: every row of the table in B.3; a second arrival of the same copy adds nothing; two devices that both converted keep the same `updatedAt`. Library: `fingerprint5` of an idea just opened equals its saved one; `mergeIdeas5` newer wins and a tombstone wins over an older copy; `exportIdeas5` writes file version 2 with the originals; `importIdeas5` reads version 1 and version 2; `reviveSong5` drops a clip whose track is gone and never throws on rubbish; `reviveMelody5` folds a note at 20 up to 32 |
| `src/timeline/lens.test.ts` | The first half of the list at the end of E.4: `unlens(lensOf(x))` changes nothing, for every kind; a chord added, a slot removed, a sound knob, a rhythm picked and a melody note each land in the right clip or track and nowhere else; a melody clip over lead chords gets its chord names (`chordsUnder` of the lens song); Best fit from a melody gives `clip.instead` = the lead chords track; `writeHarmony` into a new track and into an empty track both arrive as real clips with their marks; `rewriteHarmony` through the lens; every library rhythm picked into a 3/4 and a 6/8 clip keeps `steps / div === sigBeats(sig)`; `lensOf` returns the same object when an unrelated track changes; `lensOf` of a missing clip is `null`; `harmonyState5` reads the same as `harmonyState` did before conversion (B.5 test 9) |
| `src/audio/notelen.test.ts` | E1: a keys note with `len` 6 before a note two beats later is held half a beat; without `len` it is held as today; a strings note ignores it; `renderSong` does the same |
| `src/audio/meterswing.test.ts` | E2: an item with `meter.swing` 0.6 and no drums delays a 16th-note style's off-steps as a drums part with that swing does today; an item without it behaves as today |
| `src/song/gridrows.test.ts` | `gridRows(key, melodyBase(key), 2)` equals `melodyRows(key)`; `gridRows(key, melodyBase(key) - 24, 2)` starts two octaves lower; `keyOnly` hides the same rows |

### Existing tests that change on purpose

None. In particular every test in `src/audio/` and `src/song/melody.test.ts` passes unedited.

### Left for later

`usePlayer`, storage and `backupSource` (1c). `player5.test.ts` (the tests of C.4, with the player host, 1c). E3 (step 3). `record.ts` and `audioclips.ts` (1d).

### Done means

- [ ] All 17 fixtures pass render equality on the offline render, the live player and the loop, and MIDI equality.
- [ ] Every existing `src/audio/*.test.ts` passes unedited.
- [ ] The frozen reader files under `src/song/` are unchanged except `melody.ts` (the `len` field, `gridRows`).
- [ ] `npx tsc --noEmit` clean, `npm test` green, `npm run build` passes.
- [ ] README test count line updated.
- [ ] Commit messages end with the two trailer lines.

---
## Step 1b: the shell (the whole track view, on props, on a fixture page)

**Goal.** Build every part of the track view the user will see and touch: top bar, ruler, track panels, lanes, clips, every gesture and key, and the plain floating window. It reads no app state, so it is shown and tested on a fixture page. The app itself does not mount it yet.

**Depends on:** 0 for its types; 1a part 1 for the edit functions its gestures call. **May run beside it:** 1a, 6r. Start as soon as step 0 is merged with the parts that need only types (layout, ruler, panels, drawings, the window); rebase onto 1a part 1 before writing the gestures. **Merges after 1a part 2.** Nothing in the app imports it until 1c.

**Read first:** spec D (all of it: layout, the track panel table, D.2 every clip action, D.3 the keys and "Who gets a key", D.4, D.5), E.1 (the window; the points marked "from release 2" are not this step), A.3 (the repeat rule, for notches and edge drags), A.5 (loop and selection).

### Create

| File | Holds |
|---|---|
| `src/ui/timeline/TrackView.tsx` | `TrackViewProps`, `TrackView`: the layout of D.1, one vertical scroll box for panels and lanes, the sideways scroll bar, the cursor and the play line |
| `src/ui/timeline/TopBar.tsx` | `TopBarProps`, `TopBar`: every control of the D.1 top-bar table. It keeps the class `topbar`, and its ▶ ↻ ● group is a `section` with the class `transport` (D.5) |
| `src/ui/timeline/KeyPopover.tsx` | the key popover, ported from `KeyBar` (`src/ui/views/GuitarView.tsx:988-1061`). It takes `keyOf`, `onKey`, `onMove` and the "sung in" note as props and writes nothing itself. Its ▶ for the scale calls `playSequence` (`src/audio/synth.ts:303`) as today |
| `src/ui/timeline/Ruler.tsx` | the ruler row of D.1: Follow, − fit +, bar numbers, the end label, loop bands, markers, signature flags, the right-click menu |
| `src/ui/timeline/TrackHead.tsx` | one track panel, both lines of the D.1 table, with the ⋯ menu |
| `src/ui/timeline/Lane.tsx` | one lane: mounts the clips in view, box select, double-click for a new clip, `data-lane="<track id>" data-kind="<clip kind>"` on its element |
| `src/ui/timeline/ClipView.tsx` | one clip: drawing, notches, signature tag, harmony dot, faint when muted; `memo`'d on the clip object and the zoom |
| `src/ui/timeline/ClipActions.tsx` | the row of buttons on a selected clip and the same list as a right-click menu (D.2) |
| `src/ui/timeline/AddTrack.tsx` | the + row with its six choices |
| `src/ui/timeline/Menu.tsx` | one small menu used by the ⋯ menu, the clip menu, the ruler menu and the lane menu (opens at the pointer, closes on Escape or a click elsewhere) |
| `src/ui/timeline/gestures.ts` | pure arithmetic for pointer work: beats to pixels and back, zoom about a point, fit, snapping, which clips are in view, lane hit test, box select, merging loop regions |
| `src/ui/timeline/keys.ts` | the one key listener and the pure table behind it (D.3) |
| `src/ui/timeline/draw.tsx` | the four small drawings, copied from `src/ui/components/TrackPage.tsx:354-413` (`ChordBlock`, `MelodyBlock`, `DrumBlock`, `TakeBlock`) and given a clip's content and its cycles instead of a section. The original `ChordBlock` calls `useApp()`; the copy takes what it needs as props |
| `src/ui/timeline.css` | every style of the track view and the window. Imported by `TrackView.tsx` |
| `src/ui/windows/Window.tsx` | `Window` (E.1) |
| `src/ui/windows/windows.tsx` | `WindowsApi`, `firstPlace`, the windows hook, the focus context; re-exports the type `WinState` from `src/timeline/model.ts` |
| `src/ui/timeline/fixture.ts` | the fixture song (below) |
| `src/ui/timeline/FixturePage.tsx` | the page that shows `TrackView` on the fixture song with local state |

### Edit

| File | Change |
|---|---|
| `src/ui/icons.tsx` | add `ClefIcon` (a bass clef drawn as an SVG path: the curl and the two dots, no font character) and six track-kind icons. The Bass kind's icon is four strings, not a clef (D.1 "Icons") |
| `src/main.tsx` | when the address has `?fixture=timeline`, render `FixturePage` in place of `App`. Nothing else |

Signatures (from the spec):

```ts
// src/ui/timeline/TrackView.tsx
export interface TrackViewProps {
  song: TimelineSong; keyOf: Key; session: Session;
  edit(label: string, fn: (s: TimelineSong) => TimelineSong): void;
  setSession(fn: (s: Session) => Session): void;
  player: PlayerApi;
  open(kind: "compose" | "sound", track: string, clip?: string): void;
  peaks?(take: Take5): Float32Array | undefined;
  clipboard: { copy(ids: string[]): void; paste(at: number, onto: string | null, insert: boolean): void; has: boolean };
  sound: { copy(track: string): void; paste(track: string): void; has(track: string): boolean };
  top: TopBarProps;
  dropKind?: ClipKind | null;
  stale?: ReadonlySet<string>;
  again?(track: string, clip: string): void;
  inputs?: { count: number; level?(ch: number): number; setup(): void };
  recording?(): { track: string; from: number; to: number } | null;
  say?(msg: string, undo?: boolean): void;
}

// src/ui/timeline/TopBar.tsx
export interface TopBarProps {
  badge?: ReactNode;
  idea: { name: string | null; dirty: boolean; count: number; save(): void };
  onKey(key: Key): void;
  onMove(semitones: number): void;
  onTempo(bpm: number): void;
  onSig(sig: TimeSig, fromHereOn: boolean): void;
  sung?: { key?: string; bpm?: number; sig?: string };
  undo(): void; redo(): void; canUndo: boolean; canRedo: boolean;
  exports: { wav(): void; midi(): void; chart(): void; busy?: boolean };
  openCanvas(): void; openIdeas(): void; openSettings(): void;
  record?: { on: boolean; busy: boolean; live: boolean; toggle(): void; monitor: "hardware" | "effects"; setMonitor(m: "hardware" | "effects"): void };
}

// src/ui/windows/Window.tsx, src/ui/windows/windows.tsx
export interface WindowsApi {
  open(kind: "compose" | "sound", track: string, clip?: string): void;
  close(id: string): void;
  focus(id: string): void;
  focused: string | null;
}
export function Window(props: { win: WinState; title: string; tools?: ReactNode; children: ReactNode; strip?: ReactNode; focused: boolean; onFocus(): void; onClose(): void; onMove(r: Pick<WinState, "x" | "y" | "w" | "h">): void }): JSX.Element;
export function firstPlace(kind: "compose" | "sound", view: { w: number; h: number; panel: number; top: number }, beside?: WinState): Pick<WinState, "x" | "y" | "w" | "h">;
```

This step's own helpers (the spec does not fix their names; keep them or pick better ones, but keep the tests):

```ts
// src/ui/windows/windows.tsx
export function useWindows(session: Session, setSession: (fn: (s: Session) => Session) => void): WindowsApi;   // one composer and one sound window per track; opening another clip of the track retargets
export function useWinFocus(): boolean;   // true inside the focused window, and anywhere outside a window (old listeners are gated on it in 1c)

// src/ui/timeline/gestures.ts
export interface View { pxPerBeat: number; scroll: number }
export const xOfBeat: (v: View, beat: number) => number;
export const beatOfX: (v: View, x: number) => number;
export function zoomAbout(v: View, factor: number, atX: number): View;          // the beat under atX stays under it; 2 to 320 px a beat
export function fitView(end: number, width: number, barBeats: number): View;    // the whole song, never fewer than 16 bars
export function snap(map: BarMap, beat: number, mode: "bar" | "beat" | "free"): number;
export function inView(song: TimelineSong, v: View, width: number): Clip[];     // clips that touch the screen, plus one screen each side
export function laneAt(lanes: { track: string; top: number; bottom: number }[], y: number): string | null;
export function boxHits(song: TimelineSong, box: { from: number; to: number; tracks: string[] }): string[];
export function mergeRegions(rs: Region[]): Region[];                           // sorted; touching or overlapping stretches become one

// src/ui/timeline/keys.ts
export type KeyAction = "play" | "home" | "end" | "left" | "right" | "left-beat" | "right-beat" | "loop" | "record" | "split" | "delete" | "mute" | "copy" | "cut" | "paste" | "paste-insert" | "duplicate" | "select-all" | "cut-time" | "insert-bar" | "insert-loop" | "undo" | "redo" | "add-track" | "save" | "marker" | "rename" | "zoom-in" | "zoom-out" | "open" | "escape";
export function keyAction(e: { key: string; ctrl: boolean; shift: boolean; alt: boolean; repeat: boolean }, where: "timeline" | "text" | "control" | "takes", desktop: boolean): KeyAction | null;
```

What must hold (each is a line of the spec; the section is named so the detail is found fast):

- **No app state.** `TrackView` and everything under it take props only. No `useApp`, no storage, no audio except `playSequence` in the key popover (D, the paragraph above `TrackViewProps`).
- **Sizes at 1280 × 800:** top bar 48 px, ruler row 36 px, panel column 260 px, lanes 1020 px, a track row 64 px (D.1).
- **The lanes reach** at least one screen past the song's end and never fewer than 32 bars; an idea opens on "fit", never showing fewer than 16 bars (D.1).
- **Wheel:** plain wheel scrolls the tracks; Shift + wheel scrolls time; Ctrl + wheel zooms about the pointer. The wheel listener is not passive and prevents the default (D.1 "Zoom").
- **Only clips in view are mounted.** The play line is one element moved by one `requestAnimationFrame` loop that reads `player.getBeat()`; no React state per frame. The growing clip of a recording is drawn the same way from `recording()` (D.5).
- **A drag changes the song once, on release.** While dragging, the element is moved with `transform` (D.2, last paragraph). The pattern to reuse is `src/ui/components/TakeLane.tsx:236-312` (tap against drag, pointer capture, grips with `data-edge`).
- **Snapping** differs for note clips and audio clips: read the Move, Repeat or trim, and Split rows of D.2 word for word. Audio moves use `snapMove` (`src/song/clips.ts:273`) and the shortest audio clip is `MIN_CLIP` (`src/song/clips.ts:38`).
- **Nothing is a key only** (D.2): the row of buttons on a selected clip, the right-click menus (long-press on touch), ↶ ↷ in the top bar, the ⋯ menu.
- **The Delete key never removes a track.** "Remove track" is in the ⋯ menu and nowhere else; a held key counts once (D.1, D.3).
- **Who gets a key** (D.3, five rules): Space is taken in the capture phase on key-down and key-up unless the target is a text field, a select or the take list; with the focus inside a window, a sheet, a popover or any control, only Space, undo, redo, Ctrl+S and Escape are handled.
- **Track reorder** by dragging the grip: reuse the pointer pattern of the section sorter in `src/ui/components/FrameSections.tsx` (the `grab` handlers at lines 386-388 and the code they call).
- **The window in this release** (E.1): title bar with the tools slot, a body that scrolls and carries a `transform` (so `position: fixed` children stay inside it), drag by the title bar, kept inside the screen, `firstPlace` for a first opening, a press brings it to the front and gives it the focus, Escape closes the focused one, z-index 45 to 59, and at widths up to 760 px (or a coarse pointer) it renders as a bottom sheet with the existing `.sheet` look. A closed window is unmounted. Resize, hide-not-unmount, docking a sound window beside a composer and the see-through drag are step 2.
- **Markers** are edited here in full: M adds one and its name is typed at once, F2 or the right-click menu renames, drag moves, Delete removes the selected one (D.1).

### The fixture

`fixture.ts` builds one song by hand, 96 bpm, key B major:

- 4/4 from bar 1; 6/8 from bar 17; 4/4 again from bar 21; `end` = 88 beats (24 bars).
- Markers: "Verse" at bar 1, "Chorus" at bar 9, "Bridge" at bar 17, "Out" at bar 21.
- Tracks, top to bottom: **Chords** (guitar, `lead`) with clips over bars 1–8 and 9–16; **Melody** with a clip over bars 9–16; **Bass** with a clip over bars 1–8; **Drums** (`lead`) with one 4-bar clip at bars 5–8 holding a 4-bar rhythm and nothing after it; **Drums 2** with a clip over bars 1–4 holding a 1-bar rhythm (three notches); **Vocal 1** with one take 12 s long and one audio clip at bar 9 that shows its first 8 s (made-up peaks).

`FixturePage` keeps the song, the key and the session in `useState`, makes undo with `makeHistory`, wires `clipboard` to `copyOut` and `pasteIn`, gives a pretend `PlayerApi` (a clock: the beat runs at the song's tempo, round the loop when it is on; no sound), a pretend `record` prop so ● and the monitor control show, and `open` mounts a `Window` whose body is a few buttons and a text field (to test the key rules).

### Do not touch

`src/ui/App.tsx`, `src/ui/views/GuitarView.tsx`, `src/ui/state.tsx`, `src/ui/app5.tsx`, `src/ui/styles.css` (this step's styles go in `src/ui/timeline.css`), everything under `src/ui/components/`, `src/timeline/`, `src/song/`, `src/audio/`. If an edit function of 1a part 1 is wrong or missing, say so to its builder; do not patch `src/timeline/edit.ts` in this branch.

### Acceptance checks (1280 × 800, at `http://localhost:5173/?fixture=timeline` after `npm run dev`)

Reload the page before each group, so every group starts from the fixture as built.

Layout and moving around

1. Load the page. Expected: a top bar, a ruler row, six track rows, all visible without scrolling; the lanes start 260 px from the left; the whole song (24 bars) fits across the lanes; a small label "24 bars" stands at the song's end; four marker names stand over the bar numbers; "6/8" stands at bar 17 and "4/4" at bar 21.
2. Click an empty part of the Bass lane at bar 5. Expected: the cursor line stands on bar 5; the position readout says `5.1 · 0:10`; nothing is selected except the Bass track's panel.
3. Press Space. Expected: the play line runs from bar 5 and the readout counts. Press Space again. Expected: it stops and the play line is back on bar 5.
4. Hold Ctrl and turn the wheel up over bar 9. Expected: time zooms in and bar 9 stays under the pointer. Press "fit". Expected: the whole song is across the lanes again.
5. Turn the wheel with no key held. Expected: nothing moves sideways (six rows fit, so nothing moves at all). Hold Shift and turn it after zooming in. Expected: time scrolls; the sideways scroll bar's thumb moves with it.

Loop

6. Drag across the ruler from bar 9 to the end of bar 12. Expected: a band over bars 9–12, a faint tint down the lanes, ↻ lit. Press Space. Expected: the play line goes round bars 9–12.
7. Hold Ctrl and drag across the ruler over bars 17–18. Expected: a second band; playing goes 9–12, jumps to 17–18, and back.
8. Click the ✕ on the second band. Expected: it goes. Press Escape with nothing selected. Expected: the loop is cleared.
9. Double-click the marker "Chorus". Expected: the loop is bars 9–16 (to the next marker).

Clips

10. Click the Melody clip. Expected: it is outlined, a row of six buttons stands on its top edge (Open, Mute, Split, Duplicate, Copy, Delete, each with its key in the tooltip), and the cursor has not moved.
11. Drag the Melody clip's body one bar to the right and let go. Expected: it now covers bars 10–17, moved in one go at release. Press Ctrl+Z. Expected: back at 9–16.
12. Drag the 4-bar Drums clip's right edge from bar 9 to bar 15. Expected: while dragging, its length shows beside the pointer; after release it covers bars 5–14 and has notches at bars 9 and 13.
13. Drag the same clip's left edge from bar 5 to bar 3. Expected: it covers bars 3–14 and has a notch at bar 5, exactly where the rhythm started before. (This is the worked example of A.3.)
14. Put the pointer over the Chords clip at bar 5 and press S. Expected: two clips, 1–4 and 5–8. Press Ctrl+Z.
15. Select the Bass clip, press Ctrl+D. Expected: a copy straight after it, bars 9–16. Click the copy and press 0. Expected: it turns faint. Press Delete. Expected: it is gone and nothing else moved. Press Delete again, and hold it. Expected: nothing happens; six tracks remain.
16. Hold Ctrl and drag the "Drums 2" clip onto the Drums lane at bar 21. Expected: while dragging, the Chords, Melody, Bass and Vocal lanes are dimmed with the "not allowed" pointer; a separate copy lands at bar 21 and the original stays. Drag it onto the Chords lane instead. Expected: it glides back.
17. Press on the empty part of the Melody lane at bar 2 and drag down and right to bar 12 on the Bass lane. Expected: a box is drawn; the Melody clip and the Bass clip are both selected.
18. Select the Chords clip of bars 1–8, press Ctrl+C, click the Chords lane at bar 21, press Ctrl+V. Expected: a copy starts at bar 21 and the end label now says "28 bars".
19. Drag the Vocal clip by its body a little. Expected: it moves in steps of a sixteenth, not to the bar line. Drag its right edge outward. Expected: it first uncovers more of the take, to 12 s; past that the clip shows a notch and the take's start again. Put the pointer inside it and press S. Expected: it is cut exactly under the pointer.
20. Double-click an empty part of the Melody lane at bar 17. Expected: an empty 4-bar clip at bar 17 and a window opens on it.

Tracks

21. Double-click the name "Bass", type "Low", press Enter. Expected: the panel says "Low".
22. Press M on the Drums panel, then S on the Chords panel, then drag the Chords volume, then double-click it. Expected: M and S light; the dB readout follows; the double-click puts it back to 0.0.
23. Open the ⋯ menu on "Drums 2". Expected: Remove track, Duplicate track, Copy sound, Paste sound, Colour. Choose Remove track. Expected: the row and its clip go, and a message with an undo button shows. Press Ctrl+Z. Expected: it is back with its clip.
24. Drag the Melody panel's grip below Bass. Expected: the two rows swap, panels and lanes together.
25. Click the + row. Expected: six choices: Chords, Melody, Bass, Drums, Vocals, Blank. Choose Blank. Expected: a new row at the bottom, selected, with ● arm and an input chip "1"; its compose button pulses once; no window opens.
26. Look at the Vocal 1 and the new Blank panel, then at the Chords panel. Expected: only the first two have ● arm and the input chip. Click ● on Vocal 1, then on the Blank track. Expected: only one is armed at a time; nothing opens.

Markers, time, top bar

27. Click the ruler at bar 13, press M, type "Solo", press Enter. Expected: a marker "Solo" at bar 13. Select it and press F2, type "Break", Enter. Expected: renamed. Drag it to bar 14. Press Delete. Expected: the marker goes; no clip is deleted.
28. Right-click the ruler at bar 9 and choose "Insert a bar here". Expected: everything from bar 9 on is one bar later, the markers too, and the end label says "25 bars". Press Ctrl+Z.
29. Click the key in the top bar. Expected: a popover under it with the home notes, the modes, "More…", the scale's notes with ▶, and "Move song" − ½ / + ½. Press + ½. Expected: the key reads C major and the chord names in the clips are a semitone up. Press ↶ in the top bar. Expected: key and names are back together.
30. Click the time signature. Expected: nine signatures and "from this bar on". Click Export. Expected: WAV, MIDI, Chords + tab.

Windows and keys

31. Click the compose button (the bass clef) on Drums. Expected: a window whose left edge is at 260 px, top at 360 px, 1020 wide and 440 high, with the track's name and "bars 5–8" in its title. Drag it by the title bar. Expected: it moves and cannot leave the screen.
32. Click a button inside the window, then press Space. Expected: playing starts or stops; the button is not pressed. Press Delete. Expected: no clip is deleted. Click into the window's text field and press Space. Expected: a space is typed and playing does not change.
33. Press Escape. Expected: the window closes. Press Escape again. Expected: the selection is cleared.
34. Make the browser window 700 px wide and press a compose button. Expected: the window is a sheet across the bottom of the screen; a selected clip still shows its row of buttons; ↶ ↷ and the + row are there.

### Automated tests to add

| File | Asserts |
|---|---|
| `src/ui/timeline/gestures.test.ts` | `zoomAbout` keeps the beat under the pointer and stays within 2 to 320; `fitView` of an empty song shows 16 bars; `snap` in its three modes on both sides of a signature change; a note clip's start snaps to bars and a drums clip never to a beat; an audio move snaps the distance to sixteenths; an edge stops at the next clip and at beat 0; `inView` leaves out a clip two screens away; `laneAt`; `boxHits`; `mergeRegions` joins touching stretches and sorts them |
| `src/ui/timeline/keys.test.ts` | Every row of the D.3 table gives its action on the timeline; with `where: "control"` only play, undo, redo, save and escape come back; Space in a text field gives nothing; Delete with `repeat` gives nothing; no key gives a "remove track" action (the type has none); Ctrl+T and Ctrl+R give nothing when `desktop` is false; R and L both give "loop" |
| `src/ui/timeline/trackview.test.ts` | `renderToStaticMarkup` of `TrackView` on the fixture: there is an element with the class `topbar` and a `section` with the class `transport`; one `data-lane` per track with the right `data-kind`; the compose buttons have `aria-label="Compose"`; only the two audio tracks have an arm button and an input chip; a clip id in `stale` has the dot; the 4-bar Drums clip stretched to 10 bars has two notch elements; with `scroll` far to the right, the clips of bar 1 are not in the markup; no `record` prop means no ● |
| `src/ui/windows/windows.test.ts` | `firstPlace("compose", { w: 1280, h: 800, panel: 260, top: 84 })` is `{ x: 260, y: 360, w: 1020, h: 440 }`; a sound window is 420 wide down the right side of the lanes; opening a second clip of one track keeps one window and changes its `clip`; focus order follows the last press; closing removes it; the sheet variant is chosen at 760 px and below |

### Existing tests that change on purpose

None.

### Left for later

The real player, storage, conversion, the composer pages inside the windows, Canvas, Ideas (all 1c). The record window and the growing clip's data (1d). The clip strip, drafts, drag from a strip (`dropKind` is honoured by the lanes already, but nothing sets it), resize and hide-not-unmount, Alt + click on FX (step 2).

### Done means

- [ ] All 34 checks pass on the fixture page.
- [ ] `grep -rn "useApp\|localStorage" src/ui/timeline src/ui/windows` finds nothing.
- [ ] The app without `?fixture=timeline` is exactly as before.
- [ ] `npx tsc --noEmit` clean, `npm test` green, `npm run build` passes.
- [ ] README test count line updated.
- [ ] Commit messages end with the two trailer lines.

---

## Step 1c: the switch-over

**Goal.** The single moment the app changes: new state and storage, old ideas converted with backups, the track view mounted with a real player, every old composer reachable in a window, the top bar's functions, the Canvas as an overlay, Ideas on the new library. After it, sections are gone from the screen.

**Depends on:** 1a (both parts), 1b. **May run beside it:** the pure half of 1d, 6r. **This is the only step that edits `src/ui/App.tsx` and `src/ui/views/GuitarView.tsx`.**

**Read first:** spec A.1 (`App5State`, `Ctx5`), A.8 (undo), B.3 and B.4 (storage, backups, old copies that turn up later), C.4 and C.5 (the player host), C.8 (crackle rules), E.1, E.2 "What the compose button opens", E.4 (all of it), E.5 (Canvas, exports, Ideas), D.3 rule 4. Also `map-ui.md` section 6 and `map-audio.md` section 5.

### Create

| File | Holds |
|---|---|
| `src/timeline/store5.ts` | `KV`, `Blobs`, `KEY_V1`, `KEY_V2`, `load5`, `settleConversion`, `save5` (B.3) |
| `src/ui/idb.ts` | the real `Blobs` over IndexedDB (database `m-theory`, store `backup`); gives `null` where IndexedDB cannot be used |
| `src/ui/othertab5.ts` | `joinOtherTab5`, modelled on `src/ui/othertab.ts:33` |
| `src/ui/openidea5.ts` | `ideaKey5`, `reidea5`, modelled on `src/ui/openidea.ts` |
| `src/ui/timeline/usePlayer.ts` | `usePlayer` (C.4); re-exports the type `PlayerApi` |
| `src/ui/timeline/Host.tsx` | the host: reads `useApp5()`, builds every prop of `TrackView`, owns the player, the windows, the Canvas overlay and the two sheets |
| `src/ui/windows/ClipLens.tsx` | `ClipLens` and `V4View` (E.4) |
| `src/ui/plugins/LegacyComposer.tsx` | one composer window for a Chords, Melody, Bass or Drums track: `ClipLens` round a `Window` round `GuitarView` in its embedded mode |
| `src/timeline/export.ts` | `chart5`, `midi5`, `wav5` (E.5), from `GuitarView.tsx:1556-1618` |
| `src/canvas/taps5.ts` | `planTaps5` (E.5) |

### Edit

| File | Change |
|---|---|
| `src/ui/app5.tsx` | add `App5Provider` and `useApp5` to the types that are there |
| `src/timeline/convert.ts` | add `backupSource` (B.4) |
| `src/ui/App.tsx` | mount `App5Provider` and the host in place of `AppProvider` and the old shell. `UpdateBar` stays; `DraftBadge` goes into the top bar's `badge`. A crash guard round the track view and one round each window |
| `src/ui/views/GuitarView.tsx` | the prop `embedded?: EmbedHost` (E.4, "The embedded page"). Without the prop the component behaves exactly as today |
| `src/ui/components/MelodyGrid.tsx` | the optional prop `low?: number`: its rows are `gridRows(key, low ?? melodyBase(key), 2, keyOnly)` (E.2 "Bass", release 1) |
| `src/ui/components/CanvasPage.tsx` | an optional prop `plans?: TapPlan[]`, used in place of `planTaps(state.progression)` (line 138) when given; an optional `onClose` prop that shows a close button; its window key listener (lines 677-682) is gated on `useWinFocus()` |
| `src/canvas/layers.ts` | add `layerOfTrack5` (E.5). `layerOfTrack` stays |
| `src/ui/components/IdeasPanel.tsx` | reads `useApp5()`; lists `SavedIdea`s with `describeIdea5`; folds the backups under one closed row "Before track view (N)"; Backup writes file version 2 and Restore reads versions 1 and 2 (B.4); its key listener (lines 26-30) is gated |
| `src/ui/components/ShapeFinder.tsx`, `src/ui/components/HarmonyPicker.tsx` | their window key listeners (`ShapeFinder.tsx:72-77`, `HarmonyPicker.tsx:130-134`) are gated on `useWinFocus()` |
| `src/ui/cloud.ts` | `connectCloud(prefix = "idea_")`: the prefix replaces the two literals at lines 60 and 68 (and the `slice(5)` beside the first becomes the prefix's length) |
| `public/sw.js` | `const CACHE = "m-theory-v2";` (line 2) |
| `src/ui/styles.css` | only what the embedded pane and the overlay need (the Canvas card inside an overlay; no page tabs) |

Signatures (from the spec):

```ts
// src/timeline/store5.ts
export interface KV { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void }
export interface Blobs { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> }
export const KEY_V1 = "m-theory-state-v1", KEY_V2 = "m-theory-state-v2";
export function load5(kv: KV): { state: App5State; v1?: string };
export function settleConversion(kv: KV, blobs: Blobs | null, state: App5State, v1: string): Promise<App5State>;
export function save5(kv: KV, state: App5State): boolean;

// src/timeline/convert.ts
export function backupSource(id: string): Promise<SavedProgression | null>;

// src/ui/app5.tsx
export function App5Provider(props: { children: ReactNode }): JSX.Element;
export function useApp5(): Ctx5;

// src/ui/timeline/usePlayer.ts
export function usePlayer(heard: TimelineSong, session: Session, ctx: FlattenCtx): PlayerApi;

// src/ui/views/GuitarView.tsx
export interface EmbedHost {
  pane: "rhythm" | "melody" | "drums";
  playing: boolean; togglePlay(): void;
  getPos(): number | null;
  preview(heard: Progression | null): void;
  hearNow(): void;
  onHarmonize?(kind: "chords" | "melody", anchor: HTMLElement | null): void;
  low?: number;
  toSound?: boolean;
}
```

This step's own shapes (the spec names the functions, not their arguments):

```ts
// src/timeline/export.ts
export function chart5(song: TimelineSong, key: Key, ctx: { tuning: Tuning; capo: number; voicingsOf: FlattenCtx["voicingsOf"] }): string;
export function midi5(song: TimelineSong, flat: Flat, name: string): Uint8Array;
export function wav5(song: TimelineSong, flat: Flat, rate: number): Promise<Uint8Array>;
// src/canvas/taps5.ts and src/canvas/layers.ts
export function planTaps5(song: TimelineSong, at?: number): TapPlan[];
export function layerOfTrack5(t: Pick<Track, "kind"> & { role?: string }): LayerKind;
// src/ui/timeline/usePlayer.ts (pure, exported for the tests of C.4)
export function sameShape(a: Flat, b: Flat): boolean;                                   // count, lengths, `from`, `at` and `origin` all equal: `update` may be used
export function resumeAt(old: Flat, next: number, neu: Flat, regions: Region[] | null): number;   // the index to hand to `relist`
// src/ui/windows/ClipLens.tsx
export function ClipLens(props: { target: Target; children: ReactNode }): JSX.Element;
export function V4View(props: { children: ReactNode }): JSX.Element;
```

### What to build, in the order that keeps the app working on the branch

1. **Storage and state** (`store5.ts`, `idb.ts`, `app5.tsx`). The seven numbered steps of B.3 "The first start of the new build", exactly. The old key is never written; it is removed only after its copy in IndexedDB and the new key have both been read back equal. Writes of the new key are debounced to 400 ms and flushed on `pagehide`, on idea change and before a recording (C.8). A failed write sets `unsaved` and shows the plain message of B.3 step 6 until a later write works. `edit` pushes one history step (A.8); `undo` and `redo` restore song and key together, run `keepTakes` (from `src/timeline/history.ts`), and do nothing while `recordingTo` is set. Opening another idea clears the history, resets the session and sets `armed` to null. The session is stored with the app except `armed`. Leave one named function, `afterRestore(song)`, that undo, redo and idea-open pass the song through; it returns the song as it is until 1d fills it.
2. **Other tabs and the cloud** (`othertab5.ts`, `openidea5.ts`, `cloud.ts`). The new library syncs under `connectCloud("idea5_")`. The old documents are listed with `connectCloud("idea_")` on every sync and never written; each goes through `arrive` (B.3, the table). Backup entries are not sent to the cloud (B.4). When the old key appears again (an old tab wrote it), its ideas go through `arrive` and its text is kept as `v4-blob-late` (B.3, last paragraph).
3. **The player host** (`usePlayer.ts`, C.4). It takes over what `GuitarView.tsx:531-638` does today: `readySlots`, `freeInterface`, `start`, `update` or `relist`, stop. `update` only when `sameShape`; else `relist` with the index from `resumeAt` (C.4, "An edit while playing", five bullets). A start inside a loop region uses `cut` and the item's index (C.4, "Starting"). Once for the whole app the host also does what the embedded pages no longer do: read takes from disk and keep them (`loadTake`, `keepTakes` in `src/audio/takebuffers.ts`), `setTempo`, `keepSlots(slotsOf(flat.items), trackIds)`, `setMix(song.mix)`, `prepareNotes`, `setHome`, and `hearOn` pointed at the focused window's track (C.5). `bookAhead()` at the moments listed in C.8.
4. **The host** (`Host.tsx`). Builds `TrackViewProps`: `edit`, `setSession`, `player`, `open`, `peaks` (from the take's decoded buffer), `clipboard` (`copyOut`, `pasteIn`, kept in `state.clip`, so it outlives an idea change), `sound` (`copySound`, `pasteSound`), `stale` (`harmonyState5` for each harmony clip), `again` (`rewriteHarmony` through `lensOf` and `unlens`), `say` (the toast; with `undo`, its button calls `undo`), and `top`: key (`onMove` calls `editKeyed` with `transpose`), tempo (`setTempo`), signature (`setSig`), the three vocals notes (the checks of `GuitarView.tsx:1542-1549` and `:1635`, on the new takes), undo and redo, Save, the exports, Canvas, Ideas, Settings. `top.record`, `inputs` and `recording` stay unset until 1d.
5. **Legacy composer windows** (`ClipLens.tsx`, `LegacyComposer.tsx`, the `embedded` prop). What the compose button opens in this release: the track's selected clip, else the clip under the cursor, else its first clip; a track with no clip opens on nothing and the first thing written makes a 4-bar clip in free space at or after the cursor's bar. It never lays a clip over existing material. FX opens the same window scrolled to the sound panels (`toSound`). `ClipLens` is a complete context of its own, every bullet of E.4 "`<ClipLens target>`": the lens song as `progression`, every other field passed through both ways, `addChord`, `audition` and `shapeOf` rebuilt against the lens, its own `sheet` and `openSheet`, a `toast` whose `when` gets the old-format view, and the real idea functions. `GuitarView` with `embedded` renders exactly one pane and switches off the effects listed in E.4 "The embedded page". The window's title carries: track name, "bars 5–8", `MixMark`, the "X plays instead" chip, the clip's On / Off switch, `BarsControl`, ⧉ and ⎘ (copy and paste of the open content, E.5), ✕. A Bass track passes `low: melodyBase(key) - 24`. Compose on a Vocals or Blank track opens a window that says "Recording arrives with the next step" until 1d replaces it.
6. **Old components that are not composers.** `SettingsPanel`, `BarsControl` and `CanvasPage` are mounted inside `V4View` (E.4). `IdeasPanel` is ported.
7. **Canvas** (E.5). An overlay with the normal Canvas card: the stage and its whole control bar, plus a close button. ⤢ inside it still gives true full screen. Escape leaves full screen first, then the overlay. Mounted once; `active` only while open. Its spot comes from the marker region the play line is in (the whole song when there are no markers); its plans from `planTaps5`.
8. **Exports** (`export.ts`). WAV and MIDI from `flatten`'s list; Chords + tab prints the marker names in running order, then each marker region once, and tracks with one `group` under one heading (E.5).
9. **`App.tsx`** last, so the branch works until this commit.

### Do not touch

Everything under `src/audio/`. The frozen reader: `src/song/structure.ts`, `tracks.ts`, `unity.ts`, `migrate.ts`, `library.ts`, and `src/ui/state.tsx`, `src/ui/othertab.ts`, `src/ui/openidea.ts` (new files stand beside them; their tests must stay green untouched). `src/ui/components/VocalsPage.tsx` and `TakeLane.tsx` (1d). `src/ui/components/DrumMachine.tsx`, `HarpPanel.tsx`, `SynthPanel.tsx` (they run as they are inside the embedded page). `src/ui/timeline/*` other than `usePlayer.ts` and `Host.tsx`: a fault in the shell is fixed in its own small commit, not folded into this one. `src-tauri/`.

### Acceptance checks (1280 × 800)

Getting old data in. In a checkout of the commit before this step, run `npm run dev`, open Ideas → Restore and choose `src/timeline/fixtures/v4-ideas.json` (18 ideas). Open "Fixture 2" (three sections with a repeat), change one chord, do not save. Close the tab. Now run this step's build on the same address. (The fixture ideas with vocals have no audio files on a tester's machine; for vocals use an idea of your own that has recordings.)

Conversion and storage

1. Open the app. Expected: the track view, showing Fixture 2 as tracks and clips with three markers, and one message: "Your ideas now open in the track view. The originals are in Ideas, under 'Before track view'." No box to answer.
2. Open Ideas. Expected: 18 ideas, each described by its track names and bar count, then one closed row "Before track view (19)". Open the row. Expected: one entry per idea named "… (before track view)" and one named "Fixture 2 (unsaved, before track view)".
3. Open one backup entry. Expected: a new idea "… (restored)" opens in the track view; the backup entry is still there.
4. Open the developer tools, Application, Local Storage. Expected: the key `m-theory-state-v2` is there; `m-theory-state-v1` is not. Under IndexedDB: database `m-theory`, store `backup`, key `v4-blob`. The console shows the old and new sizes once.
5. Reload. Expected: no message, nothing converted again, the same idea on screen.
6. Open the app in a second tab, save a rhythm to "Mine" there (Drums composer). Go back to the first tab and open the Rhythm picker. Expected: the rhythm is under "Mine".
7. Ideas → Backup. Expected: a file is saved. Ideas → Restore with `v4-ideas.json` again. Expected: nothing is doubled.

It sounds the same

8. In the old build, play "Fixture 1", "Fixture 3" (guitar, piano, synth) and "Fixture 5" (4/4, 6/8, 3/4) from the start and listen. Play the same three in the new build. Expected: the same notes, drums, sounds and timing. "Fixture 3" shows three Chords tracks, one per instrument.
9. Open "Worked example" (the three-section song of spec B.2). Expected: the six tracks of the B.2 table, top to bottom, with their clips at the bars the table gives; the Chords row is split in two ("Chords" and "Chords · Chorus"); "6/8" stands on the ruler at bar 9 and "4/4" at bar 13.
10. Play "Fixture 4" (a different drum kit in each section) from start to end. Expected: no crackle. Note the audio thread's load from the browser's performance tools in the commit message.

Playing and editing

11. Click a lane at bar 5 and press Space. Expected: the music starts at bar 5, with sound, within a moment. Press Space. Expected: it stops; the play line is back on bar 5.
12. Drag a loop over bars 3–6 and press Space; while it plays, drag a chords clip one bar later. Expected: the music goes on without a gap or a jump and the moved clip is heard from its new place on the next round.
13. While looping, click the ruler outside the loop. Expected: the cursor moves; the loop plays on. Click inside the loop. Expected: the music restarts there.
14. Change the tempo while playing. Expected: heard from the next bar.

Composer windows

15. Click the compose button on Chords. Expected: a window at the bottom of the lanes titled with the track's name and "bars 1–8", holding the chord board, the tray and the sound panels; the track list has scrolled so the Chords track shows above it. No page tabs, no second transport, no track tabs inside it.
16. Tap a chord card and add it. Expected: the clip on the lane shows the new chord at once. Press Ctrl+Z. Expected: it is gone from the tray and the clip.
17. Open the shape finder for a slot. Expected: it opens inside the window, not across the whole screen. Scroll the window so the tray leaves view. Expected: the small tray stays inside the window. Press Escape. Expected: the finder closes. Press Escape again. Expected: the window closes.
18. Put the cursor on bar 1, select nothing, and click FX on Drums. Expected: the Drums window opens on the track's first clip, scrolled to the sound panels. No new clip appears on the lane.
19. In the Drums window pick another rhythm while nothing plays. Expected: it plays at once; the clip on the lane keeps its length and shows the rhythm repeated with notches.
20. Switch the On / Off switch in the window's title off. Expected: the clip turns faint and is not heard.
21. Double-click a Melody clip that lies over chords. Expected: the chord names stand over the grid. Press Harmonize, choose an option, press ✓. Expected: a new track appears directly below with a clip over the same bars, and its panel has ⟳.
22. Add a Bass track with the + row and click its compose button. Expected: a window with the melody grid whose rows start two octaves lower than a Melody track's. Tap a square. Expected: a 4-bar clip appears on the Bass lane at the cursor's bar, in free space.
23. Click a button in a composer window, then press Space. Expected: the song plays or stops; the square or button is not pressed.
24. With two composer windows open, tap a chord in one and a drum in the other. Expected: each is heard on its own track's sound.

Top bar, Canvas, Ideas

25. Key popover → Move song + ½. Expected: every chords clip and melody clip moves; ↶ puts notes and key back together.
26. Export → WAV, then MIDI, then Chords + tab, on an idea with a repeated verse. Expected: a WAV as long as the song; a MIDI file with one track per track; text that lists the marker names in order and prints the verse once.
27. Click Canvas. Expected: an overlay with the stage and every control of the bar: the layer legend, the colour families and schemes, Layout, Surface, Paint, Drips, Old paint, Across, Clear, Save picture, open a file, Hz, and a close button. Press ▶. Expected: it paints; a Bass track's notes are painted as broad low bands. Press ⤢. Expected: full screen. Press Escape. Expected: full screen ends, the overlay stays. Press Escape. Expected: the overlay closes.
28. Change something, press Save. Expected: "Saved". Open another idea. Expected: the loop is gone, nothing is armed, Ctrl+Z does nothing.
29. Open ⚙. Expected: the settings sheet as before; a changed capo is heard on the next chord.
30. Make the window 700 px wide. Expected: a composer opens as a bottom sheet; everything in checks 15 to 20 can still be done.

### Automated tests to add

| File | Asserts |
|---|---|
| `src/timeline/convert.test.ts` (extend) | The "Storage" paragraph of B.5, with a pretend `KV` and a pretend `Blobs`: the old text is byte-identical in its new place; the old key is removed only after both read-backs matched; with `Blobs` failing the old key is left alone and `where` is `"local"`; with the first write of the new key failing for lack of room the old key is removed (its copy verified) and the write tried again; with it still failing the state says `unsaved`, and a later `load5` never converts over a v2 key that exists; loading twice changes nothing; a deleted backup stays deleted; a backup opens as a new restored idea; `backupSource` finds a saved idea, the never-saved idea on screen and the unsaved changes of a saved one; Restore of a version 2 file brings the originals back where there is no old blob |
| `src/ui/app5.test.ts` | The provider's pure parts (export them): an edit is one undo step; two edits from one control inside 500 ms are one; undo restores song and key together and keeps takes; undo does nothing while `recordingTo` is set; opening another idea clears the history, resets the session and disarms; a session change or a window moved does not make an idea dirty (`fingerprint5`); `armed` is not in what is stored |
| `src/ui/othertab5.test.ts`, `src/ui/openidea5.test.ts` | The cases of `src/ui/othertab.test.ts` and `src/ui/openidea.test.ts` on the new state; saving a rhythm in one tab reaches the other; a backup entry is not doubled by a second tab |
| `src/ui/timeline/player5.test.ts` | On the pretend live context (C.4, last paragraph): two lists that differ only in `origin` are not `sameShape`, `relist` is used and the drums heard after it are the right bars; `resumeAt` with `next` equal to the list's length gives the loop's first item when looping and the new length when not; a start inside a loop region is in phase on the first pass and on the second; two regions give one `jump`; a beat outside the new loop resumes at the next region |
| `src/ui/windows/cliplens.test.ts` | The second half of the list at the end of E.4: saving a rhythm inside the lens grows `myBeats`; a capo change inside reaches the real settings; a toast action's `when` does not throw and is given a state with `progression`; `openSheet` in one lens does not open in another; `V4View` drops a change to `progression` and passes a change to `studio` through |
| `src/ui/components/embedded.test.ts` | `GuitarView` with `embedded` inside a `ClipLens`, rendered to text: exactly one pane; no element with the class `transport`; no hidden panes; no track tabs. `MelodyGrid` with `low` 24 under the home row shows rows two octaves lower |
| `src/timeline/export.test.ts` | The chord sheet prints the marker names in running order, then each different region once (three equal verses print one); two tracks with one `group` are under one heading; `midi5` has one MIDI track per track with its name |
| `src/canvas/taps5.test.ts`, `src/canvas/layers.test.ts` (extend) | Bass → the bass layer, a blank audio track → other, vocals → vocals, a harmony track → harmony; a track whose clip plays instead of the chords at the play line is painted as chords; a muted track is not heard by the Canvas |

### Existing tests that change on purpose

None. `src/ui/hands.ts` is not edited: it looks for `section.transport`, which the new top bar keeps, and `src/ui/hands.test.ts` passes as it is. The 16 test files that import the old state and library modules pass untouched, because those modules are not edited.

### Left for later

Recording, the record window, the take list, the top bar's ● and monitor control, the input chip's list (1d). The clip strip, drafts, real sound windows, bypass, resize and hide-not-unmount (2). Deleting the old shell, `AppProvider` and the pages nothing mounts (7).

### Done means

- [ ] All 30 checks pass; checks 8 to 10 are written up in the commit message (what was listened to, the measured load for "Fixture 4").
- [ ] `src/ui/state.tsx`, `src/ui/othertab.ts`, `src/ui/openidea.ts`, `src/song/library.ts` and everything under `src/audio/` are unchanged.
- [ ] `GuitarView` without `embedded` still type-checks and renders (it is no longer mounted, but stays until step 7).
- [ ] `npx tsc --noEmit` clean, `npm test` green, `npm run build` passes.
- [ ] README: test count line updated, and the user-facing sections that describe pages and sections say what the track view does now.
- [ ] Commit messages end with the two trailer lines.

---

## Step 1d: recording in the track view

**Goal.** Vocals record again, now onto the timeline: one record window for the whole app (the old Vocals page in a host mode), the take list on the new model, recording round the loop, and no way to lose a take by accident. This completes release 1.

**Depends on:** 1c. Its pure half (`record.ts`, `audioclips.ts` and their tests) needs only 1a and may be built beside 1c. **May run beside it:** 6r.

**Read first:** spec F.2, F.3 (all of it, with the `VocalHost` block), F.5, A.8 (takes and undo, the shelf, the nudge), D.1 (● and "mon" in the top-bar table; arm and input chip in the panel table), D.3 rule 4, `map-audio.md` section 3.5.

### Create

| File | Holds |
|---|---|
| `src/timeline/record.ts` | `RecordPlan5`, `recordPlan5`, `addRecording5` (F.3) |
| `src/timeline/audioclips.ts` | `sameSpot5`, `useTake5`, `keepTake5`, `dropTake5`, `removeRecording5`, `renudge5` (F.3), from `src/song/clips.ts:114-240` with a song beat in place of block and bar |
| `src/ui/plugins/audio/TakeList5.tsx` | the take list: All / ★, hear, ★, Use, delete, remove a recording, show short takes, and the "Removed recordings" shelf with Use and Empty |
| `src/ui/plugins/audio/RecordHost.tsx` | mounts `VocalsPage` once, always, on the desktop, in host mode, inside `V4View`, as the body of the one record window; builds its `VocalHost`; closing the window hides it |

### Edit

| File | Change |
|---|---|
| `src/ui/components/VocalsPage.tsx` | the prop `host?: VocalHost` and the exported type. With it the page keeps the engine and the room and gives up the song (F.3, the two bullet lists under the `VocalHost` block). Without it, it behaves as today |
| `src/ui/timeline/Host.tsx` | mount `RecordHost`; supply `top.record` (●, the mic-live dot, the monitor control), `inputs`, `recording`; open the record window for compose on an audio track and for a double-click on an audio clip; "Hear alone" and "Take ▸" in the audio clip's menu |
| `src/ui/app5.tsx` | `afterRestore` runs `renudge5(song, studio.nudge)`; a nudge change runs it over every audio track, the shelf and the clipboard's takes (A.8) |

Signatures (from the spec):

```ts
// src/timeline/record.ts
export interface RecordPlan5 { from: number; to: number; loop: boolean; bars: number[] }
export function recordPlan5(song: TimelineSong, session: Session): RecordPlan5;
export function addRecording5(song: TimelineSong, track: string, r: Recorded, plan: RecordPlan5, o: { nudge: number; kept: number[]; id: () => string; bpm: number; key: string; sig: string; sound: string }): TimelineSong;

// src/timeline/audioclips.ts
export const sameSpot5: (a: Take5, b: Take5) => boolean;
export function useTake5(song, track: string, take: string, at: number, id: () => string): TimelineSong;
export function keepTake5(song, track: string, take: string, keep: boolean): TimelineSong;
export function dropTake5(song, track: string, take: string): TimelineSong;
export function removeRecording5(song, track: string, group: string): TimelineSong;
export function renudge5(song: TimelineSong, ms: number): TimelineSong;

// src/ui/components/VocalsPage.tsx
export interface VocalHost {
  track: { id: string; name: string; input: number; fx: VocalFx; stale: boolean } | null;
  setFx(fx: VocalFx): void; setInput(ch: number): void;
  bpm: number;
  plan(): RecordPlan | null;
  onRecorded(r: Recorded, o: { kept: number[]; sound: string }): void;
  setNudge(ms: number): void;
  applySound(): void;
  takes: ReactNode;
  control: RefObject<{ toggle(): void } | null>;
  focused: boolean;
}
```

What must hold:

- **One owner of the engine.** The page is mounted once for the whole app and stays mounted when its window is closed, so monitoring through the effects goes on (F.2, "Who owns the recording engine"). The engine is wanted while a recording or rehearsal runs, or monitoring through effects is on, or the record window is open and the app has been quiet for a second. **An armed track is not a reason** (F.5). The page's `active` prop becomes "the record window is open"; `src/audio/handoff.ts` is not edited.
- **Arm** is `session.armed`: it opens nothing and is forgotten at the next start (F.2). The top bar's ● records onto the armed track; with none armed it arms the selected audio track, else the top one, opens the record window if it is closed, and goes on.
- **What a recording goes round** (`recordPlan5`, F.3 step 1): with the loop on, from the first region's start to the last region's end, bars snapped; with no loop, the bars in view from the cursor's bar, at most 8. Once-through recording is step 6. `host.plan()` turns this into the page's own `RecordPlan` (`src/ui/components/VocalsPage.tsx:25`): the items are `flatten` of the song without the armed track's clips over that stretch.
- **A finished recording** (`addRecording5`, F.3 steps 5 and 6): `cutTakes` (`src/song/takes.ts:60`) cuts one take per pass, each with `at = plan.from`; one clip is laid at the loop start with `layDown`, playing the active take; the other passes are alternatives. The loop-off branch of `addRecording5` is written and tested here too, though nothing calls it before step 6.
- **Alternatives** are takes sung from the same song beat at the same rate (`sameSpot5`), so recordings in different bars never replace each other.
- **Takes are never lost** (A.6 rule 7, A.8): Ctrl+Z after a recording takes the clip off the lane and leaves the takes in the list, unplaced; "Use" lays one back at the cursor. Removing a recording or deleting a take shows the 20-second undo message, not a question box. A removed track's takes are on the shelf.
- **In host mode the page does not** read `state.progression`, cut or add takes itself, draw its own lane or take browser, keep its own undo stack or Ctrl+Z listener, or call `window.confirm` (F.3). Its Ctrl+Z listener (`VocalsPage.tsx:586-595`) is off, and its other window keys (K, at `:527`) act only while `host.focused`.
- **Inputs:** the panel's chip lists "In 1" and "In 2" in this release, with "Audio setup…" at the end, which opens the record window. The count offered comes from the open engine, else the chosen device, else `studio.inputs` (F.2); the page stores `studio.inputs` whenever the interface opens.
- **In the browser** there is no recording yet: ● opens the record window, which says "Recording: in the desktop app" (table G row 180).

### Do not touch

Everything under `src/audio/` (`handoff.ts` and `through.ts` included; their tests pass unedited). `src/song/takes.ts` and `src/song/clips.ts` (read and call them; the new functions live in `src/timeline/`). `src/ui/components/TakeLane.tsx` (not used in host mode; it stays for the page without a host). `src/ui/views/GuitarView.tsx`, `src/ui/App.tsx`. `src-tauri/` and `src/desktop.ts` (6r).

### Acceptance checks (1280 × 800, desktop app, an audio interface with a microphone on input 1)

1. Open an idea of your own that has vocal recordings from before the update. Expected: each vocal track is a lane with its clips where they were sung; they play in time with the song.
2. Add a Vocals track with the + row. Expected: its panel has ● arm and an input chip "1". Click the chip. Expected: "In 1", "In 2", "Audio setup…".
3. Click ● arm on the panel. Expected: it lights; nothing opens; the top bar's ● shows no mic-live dot. Press Space. Expected: the song starts at once (no wait for the interface).
4. Drag a loop over bars 1–4. Click the top bar's ●. Expected: the record window opens with the interface, the meters and the vocal sound box; "Preparing…" shows, then the count-in; a clip grows on the armed lane while you sing; the pass readout counts in the window and beside ●.
5. Sing three passes, press K during the second, then stop. Expected: one clip on the lane over bars 1–4; the take list in the window shows three takes, the second with ★; no box to answer.
6. Press Ctrl+Z. Expected: the clip leaves the lane; the three takes are still in the list, marked unplaced. Click Use on one. Expected: a clip is back on the lane at the cursor.
7. Record again over the same bars. Expected: the new clip replaces what it covers; right-click the clip → "Take ▸" lists the earlier takes; choosing one swaps it in place.
8. During a recording press Ctrl+Z. Expected: nothing happens.
9. In the take list delete a take, then remove a recording. Expected: each time a message with an undo button for 20 seconds; no question box.
10. Open the ⋯ menu on the vocal track and choose Remove track. Expected: the track goes with an undo message. Open the record window on another audio track. Expected: "Removed recordings" lists the takes, with Use and Empty.
11. Set the monitor control beside ● to "Through effects". Expected: you hear yourself with the vocal sound; the mic-live dot shows on ● and on the monitor control. Close the record window. Expected: you still hear yourself. Set it back to "Direct".
12. Change the timing nudge in the record window by 10 ms. Expected: every vocal clip in the song moves by that much; Ctrl+Z does not undo the nudge.
13. Put the pointer over a vocal clip between two words, zoom in with Ctrl + wheel as far as it goes, press S. Expected: the clip is cut exactly there. Drag the new edge outward. Expected: it uncovers the take again.
14. Close and reopen the app. Expected: no track is armed.
15. In a browser (`npm run dev`), click ● on an idea with a Vocals track. Expected: the record window says "Recording: in the desktop app".

### Automated tests to add

| File | Asserts |
|---|---|
| `src/timeline/record.test.ts` | `recordPlan5`: one loop region; two regions give one stretch from the first start to the last end; edges snapped to bars; no loop gives the cursor's bar and at most 8 bars; `bars` holds each bar's beats across a signature change. `addRecording5`, loop: three passes give three takes with `at = plan.from`, the kept pass is ★, one clip at the loop start, what it covers is trimmed, `offset + nudge + count_in` is in each take's `start`. Loop off: `loop_frames` 0 gives one take built by the function itself (not by `cutTakes`) with `frames = r.frames - start` |
| `src/timeline/audioclips.test.ts` | `sameSpot5` is true for one recording and for two sung from the same beat at the same rate, false for different bars; `useTake5` swaps every clip of that spot and lays an unplaced take at the given beat; `dropTake5` makes what played it play the next best take and never leaves a clip without a take; `removeRecording5` removes the group's takes and clips only; `renudge5` moves every take of every audio track and the shelf from its own nudge to the new one and returns the same song when nothing moves |
| `src/timeline/history.test.ts` (extend) | Record (`addRecording5`), undo, one more edit: the takes are still listed; the undone clip's take is unplaced |
| `src/ui/plugins/audio/takelist5.test.ts` | Rendered to text: takes grouped by recording, ★ on kept ones, short takes hidden until asked for, an unplaced take offers Use, the shelf section shows only when the shelf has entries |
| `src/ui/components/vocalhost.test.ts` | `VocalsPage` with a `host`, rendered to text: no lane and no take browser of its own, the host's `takes` node is in the markup, the track's name and input come from `host.track`; with `host.track` null it shows the "add a vocal track" state and no record button |

### Existing tests that change on purpose

None. `src/audio/handoff.test.ts` changes in step 5, not here: the rule's inputs are the same, only what the host passes as `active` differs.

### Left for later

Splitting the page into a real plugin, `useEngine`, Settings → Audio (5). Every input and stereo pairs, once-through recording from the cursor, recording in the browser (6r, 6).

### Done means

- [ ] All 15 checks pass on a machine with an interface; check 15 in a browser.
- [ ] `VocalsPage` without `host` still type-checks and renders.
- [ ] Nothing under `src/audio/`, `src-tauri/` or `src/desktop.ts` changed.
- [ ] `npx tsc --noEmit` clean, `npm test` green, `npm run build` passes.
- [ ] README test count line updated; the recording section says how to record in the track view.
- [ ] Commit messages end with the two trailer lines.
- [ ] **Release 1 is cut from this commit.**

---
## Step 2: windows in full, drafts and the clip strip, sound windows, the Drums plugin

**Goal.** The bass-clef button opens a real plugin: the clip being composed is shown at the bottom of the window and is dragged onto any lane of its own kind. Every track gets its own sound window, and Drums is the first composer rebuilt as a plugin. This is release 2.

**Depends on:** 1d. **May run beside it:** 6r.

**Read first:** spec A.1 (`Draft`), A.5 (draft anchor), E.1 (the points marked "from release 2"), E.2 (all of it), E.3 (all of it), C.4 (`audition`, and `heard` with a focused draft), C.5 (`hearOn`).

### Create

| File | Holds |
|---|---|
| `src/ui/windows/ClipStrip.tsx` | the strip of E.2: New, ▶ and "alone", the clip's drawing, "N bars − +" with the quick lengths, ⧉ ⎘, "Fit to these bars" |
| `src/ui/windows/dragging.tsx` | the drag engine, copied from `src/ui/views/GuitarView.tsx:836-928`, for clip payloads (ghost, auto-scroll near edges, the click that ends a drag swallowed) |
| `src/timeline/preview.ts` | `previewSong`: the song with a draft laid in at its anchor on its own track (E.2 "Hearing it with the song") |
| `src/ui/plugins/registry.ts` | which composer and which sound component each track kind mounts. One line per kind; later steps change one line each |
| `src/ui/plugins/drums/DrumsComposer.tsx`, `DrumSound.tsx`, `store.ts`, `drums.css` | the Drums plugin (E.2 table, Drums row; E.3 table, Drums row); `store.ts` holds `sel`, `solo` and `hit` per track for both windows |
| `src/ui/plugins/sound/TrackSound.tsx`, `useTone.ts`, `sound.css` | the sound window for Chords, Melody and Bass tracks: `SoundControls` (`src/ui/components/HarpPanel.tsx:60`) and `SynthPanel`, with `toneSetter` copied from `GuitarView.tsx:426-446` |

### Edit

| File | Change |
|---|---|
| `src/ui/windows/Window.tsx`, `windows.tsx` | resize by the bottom-right corner; closing hides, it does not unmount; a hidden window stops its frame loop; a sound window opened from a composer's Sound button docks beside it; during a strip drag the window lets the pointer through and turns 35 % see-through except its strip |
| `src/ui/drag.tsx` | `Payload` becomes the union of E.2: the chord payload as it is with `type: "chord"` added, or `{ type: "clip", kind: ClipKind, from: { track: string; clip?: string } }` |
| `src/ui/components/DrumMachine.tsx` | optional props `trackId`, `resetKey` and `show` (`"compose"` or `"sound"`). When `trackId` is given they replace its reads of `state.progression.focus.drums` and `song.current` (lines 139, 206-212); without them it behaves as before (the old view still imports it). `deskFollowsPage` (line 40) becomes "always" |
| `src/ui/timeline/Host.tsx` | the compose button opens the track's draft, a double-click opens that clip; `heard` is `previewSong` while a draft's window has the focus; sets `dropKind` during a strip drag; `player.audition`; bypass (`FlattenCtx.bypass`) from Alt + click on FX and from the sound window's switch |
| `src/ui/timeline/usePlayer.ts` | `audition(span, solo)` |
| `src/ui/timeline/Lane.tsx`, `TrackHead.tsx` | the drop ghost on an accepting lane; Alt + click on FX |
| `src/ui/plugins/LegacyComposer.tsx` | gets the strip (it is part of the window); its sound panels are hidden for kinds that now have a sound window |
| `src/audio/drums.ts` (lines 92-94), `src/audio/rhythms.ts` (line 26) | the three kits and the one rhythm group still named by another maker's model numbers get plain names: "Boom", "Punch", "Tight", and "Trap & electro". Ids stay, so saved songs load |

Signature this step adds (named in E.2, shaped here):

```ts
// src/timeline/preview.ts
export function previewSong(song: TimelineSong, track: string, anchor: number): TimelineSong;   // in the copy only, the draft covers that track's clips over its bars
```

`setDraft`, `placeDraft` and `draftAnchor` exist since 1a part 1; `copySound`, `pasteSound` too.

### Do not touch

`src/ui/views/GuitarView.tsx` (copy from it, do not edit it), `src/ui/App.tsx`, everything under `src/audio/` except the names in the two files listed, `src/timeline/flatten.ts`, the Chords, Melody and Vocals components.

### Acceptance checks (1280 × 800)

1. New idea. Click the bass clef on Drums. Expected: the Drums plugin opens across the bottom of the lanes, titled "Drums · draft", with the Kit picker beside the Rhythm picker, the grid, Swing, and a strip at the bottom.
2. Pick a rhythm. Expected: it plays at once; the strip shows it drawn as it will look on the timeline.
3. Drag the strip's drawing up over the lanes. Expected: the Drums lane gets an outline, every other lane dims to 40 % with the "not allowed" pointer, the window turns see-through except its strip, and a ghost of the clip's real length snaps to the bar under the pointer. Drop on bar 1. Expected: a clip lands on bars 1–4 and the window's title changes to "bars 1–4".
4. Change a hit in the grid and press Space. Expected: the change is heard in the song (the window is on the placed clip).
5. Drag the strip again to bar 9. Expected: a second, separate clip. Change it. Expected: the first one does not change.
6. Drop the strip on the Chords lane. Expected: the ghost glides back; nothing changes.
7. Click the bass clef again. Expected: the window is back on the draft, as it was left.
8. Add a Bass track, click its bass clef, loop bars 1–4 over some chords, write notes and press Space. Expected: the song plays with the bass draft sounding at the loop's start, though it is not on the timeline yet.
9. Press the strip's ▶ with "alone" on. Expected: only that track goes round its bars.
10. Click FX on Drums. Expected: a 420 px sound window down the right side with Kit, Mixer, Sound and Effects; no "All sections" button. Click the Sound button in the Drums composer's title. Expected: the same window, docked beside the composer.
11. Hold Alt and click FX on a track with reverb. Expected: the track is heard dry while the switch is on; nothing in the idea is changed.
12. Sound window → "Copy sound"; on another track of the same kind, ⋯ → "Paste sound". Expected: it sounds the same. On a Drums track "Paste sound" of a chords sound is greyed.
13. Close a Drums window in the middle of an unsaved grid edit and open it again. Expected: the edit and the grid's place are as they were left.
14. Drag a window's bottom-right corner. Expected: it resizes; after a reload it opens where and how it was left.
15. Open the Kit picker and the Rhythm drawer. Expected: no kit and no group is named by a model number.

### Automated tests to add

| File | Asserts |
|---|---|
| `src/timeline/preview.test.ts` | The draft sounds at its anchor and covers that track's clips there, in the copy only; with no draft the same song object comes back |
| `src/timeline/edit.test.ts` (extend) | `placeDraft` lands a separate copy and keeps the draft; a second drop gives a second separate copy |
| `src/ui/windows/clipstrip.test.ts` | Rendered to text: "Fit to these bars" only when the clip's signature differs from its bars; the On / Off switch is not shown for a draft; "N bars" follows the clip's length only when the clip showed its whole content once |
| `src/ui/windows/windows.test.ts` (extend) | A closed window stays in the list with `open: false`; a sound window opened from a composer takes its width from it; the stored place survives a reload of the session |
| `src/ui/plugins/drums/drums.test.ts` | `DrumMachine` with `trackId` reads no `focus` and no `song.current`; a rhythm picked into a 3/4 clip is fitted; `grooveOf` and `kitOfBeat` split a `Beat` and `onKit` joins them back equal; a drum picked in the composer is the drum the sound window shows |
| `src/timeline/flatten.test.ts` (extend) | A track in `bypass` gets a sound with every effect amount at zero and a kit with its effects at zero |

### Existing tests that change on purpose

`src/ui/components/drumdesk.test.ts`: the two tests under "the drum page's changes on the track's desk" become one, "are always heard at once" (there is one desk per track).

### Left for later

The Chords, Melody and Vocals plugins (3, 4, 5); they keep running as old pages, now with the strip.

### Done means

- [ ] All 15 checks pass.
- [ ] The audio thread is measured with 16 and with 24 tracks and the numbers are written into the README (spec C.8, risk 24).
- [ ] `npx tsc --noEmit` clean, `npm test` green, `npm run build` passes; README test count line updated.
- [ ] Commit messages end with the two trailer lines. **Release 2 is cut from this commit.**

---

## Step 2b: split for parallel work

**Goal.** A short step with nothing new on screen. It separates the files the next three steps would otherwise all edit, so steps 3, 4 and 5 can be built at the same time.

**Depends on:** 2. **May run beside it:** 6r.

**Read first:** spec H ("Why 3, 4 and 5 really are separate after 2b"), E.4 (`EmbedHost.onHarmonize`), E.5 (the Harmonize row).

### Create

| File | Holds |
|---|---|
| `src/ui/plugins/chords/ChordsLegacy.tsx`, `src/ui/plugins/melody/MelodyLegacy.tsx` | one legacy host per kind, each mounting only its own pane of the embedded page (Bass uses the melody one) |
| `src/ui/plugins/harmonize/host.tsx` | the one place `HarmonyPicker` is mounted, by the track view's host; composers call `onHarmonize(kind, anchor)` |
| `src/ui/plugins/chords/chords.css`, `src/ui/plugins/melody/melody.css`, `src/ui/plugins/audio/audio.css` | one stylesheet per plugin, empty but imported, so no later step adds to `src/ui/styles.css` |

### Edit

| File | Change |
|---|---|
| `src/ui/plugins/LegacyComposer.tsx` | deleted; `src/ui/plugins/registry.ts` points at the new host files |
| `src/ui/views/GuitarView.tsx` | **the last edit of this file before it is deleted:** in embedded mode the Harmonize buttons call `embedded.onHarmonize` and the page mounts no `HarmonyPicker` of its own (today at line 971) |
| `src/ui/timeline/Host.tsx` | mounts `harmonize/host.tsx` once |

### Do not touch

Everything else. In particular no behaviour changes.

### Acceptance checks (1280 × 800)

1. Open a Chords composer, add chords, press Harmonize, choose an option, hear it, press ✓. Expected: exactly as in release 2.
2. The same from a Melody composer, into a new track. Expected: a new track with a clip at the same bars.
3. Open a Bass composer. Expected: the low grid, as before.
4. With two composer windows open, press Harmonize in one. Expected: one picker, anchored to that window's button.

### Automated tests to add

| File | Asserts |
|---|---|
| `src/ui/plugins/registry.test.ts` | every track kind has a composer and a sound component; Bass and Melody share a composer; Vocals and Blank share one |
| `src/ui/components/embedded.test.ts` (extend) | with `onHarmonize` set, the embedded page's markup holds no harmony sheet |

### Existing tests that change on purpose

None.

### Left for later

Nothing of its own.

### Done means

- [ ] After this step, steps 3, 4 and 5 share exactly one file, `src/ui/plugins/registry.ts`, one line each. Check it by listing the files each of their briefs names.
- [ ] `npx tsc --noEmit` clean, `npm test` green, `npm run build` passes; README test count line updated; trailer lines.

---

## Step 3: the Chords plugin

**Goal.** Chords are built in a plugin of their own: the board, the tray, the shape finder as a panel inside the window, and a "Playing" row that sets style and feel per clip. Playing styles longer than a bar count from their clip's start. This is release 3.

**Depends on:** 2b. **May run beside it:** 4, 5, 6r.

**Read first:** spec E.2 (table, Chords row), E.3 (what moves to the sound window), E.4 (the lens stays in use here), C.6 (E3), C.7 point 3, table G rows 74 to 127.

### Create

| File | Holds |
|---|---|
| `src/ui/plugins/chords/ChordsComposer.tsx` | the composer, mounted inside `ClipLens` without `GuitarView` |
| `src/ui/plugins/chords/Board.tsx`, `Dock.tsx`, `Slot.tsx`, `Next.tsx` | `ChordBoard`, `Dock`, `Slot`, `NextChords` and the small parts they use, copied out of `src/ui/views/GuitarView.tsx:1110-1268` and `:1679-1869` |
| `src/ui/plugins/chords/Playing.tsx` | the style picker and Feel (the top of `HarpPanel`, `src/ui/components/HarpPanel.tsx:254-298`) with "All clips"; hidden on a synth track |

### Edit

| File | Change |
|---|---|
| `src/ui/components/ShapeFinder.tsx` | a panel mode behind an optional prop: it opens inside the window instead of lifting to the screen's bottom |
| `src/audio/patterns.ts`, `src/audio/synth.ts` (and `renderSong` in it) | E3: `ExtraPlay.chords[].from?: number`, the beat the style's pattern counts from (C.6). Additive; its test is written first |
| `src/timeline/flatten.ts` | writes `from` for each chords clip's chords |
| `src/ui/plugins/registry.ts` | the Chords line |
| `src/ui/plugins/chords/chords.css` | this plugin's styles |

### Do not touch

`src/ui/views/GuitarView.tsx` (copy only), `src/ui/components/MelodyGrid.tsx`, `VocalsPage.tsx`, `HarmonyPicker.tsx`, `src/ui/styles.css`, `src/ui/plugins/melody/`, `src/ui/plugins/audio/`.

### Acceptance checks (1280 × 800)

1. Click the bass clef on a Chords track. Expected: a plugin with the chord board, the tray with its slots and length ruler, + Rest, Clear, Arrange (guitar) or Voicing (keys), Harmonize, the "Playing" row, and the strip. No sound panels (they are under FX).
2. Tap chords, change a slot's shape with its steppers, open the shape finder for a slot. Expected: the finder is a panel inside the window; a shape dragged from it lands in the tray.
3. Pick a playing style and a feel. Expected: heard at once on this clip only; another clip of the track keeps its own. Press "All clips". Expected: every clip of the track now plays that style.
4. Give the track a synth in its sound window. Expected: the "Playing" row is hidden.
5. Pick a two-bar playing style on a clip that starts on bar 2 and loop it. Expected: the pattern starts with the clip, not with the bar before it.
6. Drag the strip to a Chords lane, then to a Melody lane. Expected: it lands on the first and glides back from the second.

### Automated tests to add

| File | Asserts |
|---|---|
| `src/audio/stylefrom.test.ts` | E3: a two-bar style and a half-speed feel on a chord with `from` count from there; without `from` they count as today |
| `src/timeline/flatten.test.ts` (extend) | every `extra.chords` entry of a clip carries the clip's start as `from` |
| `src/timeline/equal.test.ts` | still green for all fixtures (fixture 11 guards style position) |
| `src/ui/plugins/chords/chords.test.ts` | each chord edit (add, remove, reorder, length, rest, clear, arrange) through the lens lands in the open clip; the lit chord follows the song beat; the finder closes when its chord is gone; "All clips" writes style and feel to every clip of the track and nothing else |

### Existing tests that change on purpose

None.

### Left for later

Melody and Vocals plugins.

### Done means

- [ ] All checks pass; every existing `src/audio/*.test.ts` passes unedited.
- [ ] `npx tsc --noEmit` clean, `npm test` green, `npm run build` passes; README test count line updated; trailer lines. **Release 3 is cut from here.**

---

## Step 4: the Melody and Bass plugin

**Goal.** One composer for melody and bass with every note from C1 to C8, a grid that scrolls, and one-press octave jumps. This is release 4.

**Depends on:** 2b. **May run beside it:** 3, 5, 6r.

**Read first:** spec E.2 (table, Melody and Bass rows; "Bass: the Melody composer with a wide range"), A.4 (the range rule for notes), C.6 (E1, for the optional note lengths), table G rows 128 to 142.

### Create

| File | Holds |
|---|---|
| `src/ui/plugins/melody/MelodyComposer.tsx` | mounts `MelodyGrid` with props only: `melody = clip.content`, `setMelody`, `keyOf`, `bar = sigBeats(clip.sig)`, `chords = chordsUnderSpan(song, span)`, `getPos`, `fresh = place = clip.id`; a Bass track adds `low` and `octaves` |

### Edit

| File | Change |
|---|---|
| `src/ui/components/MelodyGrid.tsx` | rows come from `gridRows` over seven octaves; the grid sits in a box that scrolls up and down with sticky row names and bar tabs; ▲ ▼ and Page Up / Page Down jump an octave; home-note rows are marked; on open it scrolls to the clip's notes (an empty bass clip: E1 to E3; an empty melody clip: the two octaves from the home note). Its own sound block (line 352) is not rendered when no `sound` prop is given. Every new prop is optional (the old view still imports the grid) |
| `src/song/melody.ts` | only if `gridRows` needs an `octaves` detail it lacks |
| `src/ui/plugins/registry.ts` | the Melody and Bass lines |
| `src/ui/plugins/melody/melody.css` | the scroll box (today `src/ui/styles.css:546` has `overflow-y: hidden`; the new rule lives in this plugin's file) |

Optional in this step: drag a note's right end to give it a length (`MelodyNote.len`, E1).

### Do not touch

`src/ui/views/GuitarView.tsx`, `src/ui/styles.css`, `src/ui/plugins/chords/`, `src/ui/plugins/audio/`, `src/audio/`.

### Acceptance checks (1280 × 800)

1. Open a Bass composer on an empty clip. Expected: the grid shows E1 to E3; home-note rows are marked. Press ▼. Expected: one octave lower. Press Page Up twice. Expected: two octaves higher. Turn the wheel. Expected: the grid scrolls; the row names and the bar tabs stay in place.
2. Write a note on C1 and one on C8 (scroll between them). Expected: both are kept, shown on the clip in the lane, and heard.
3. Open a Melody composer on a clip with notes. Expected: the grid opens scrolled to those notes; the chords under the clip's bars stand over the grid.
4. Switch "Key only" on. Expected: the rows outside the scale are hidden in every octave.
5. Key popover → Move song − ½ twelve times on an idea with a bass line on E1, then reload. Expected: the same number of notes as before.

### Automated tests to add

| File | Asserts |
|---|---|
| `src/song/gridrows.test.ts` (extend) | seven octaves from 24 to 108, highest first; `keyOnly`; home-note rows flagged |
| `src/ui/plugins/melody/melody.test.ts` | rendered to text: a Bass composer's first rows are low; the scroll target for an empty bass clip is E1 to E3 and for a clip with notes is around them; an octave step moves the target by twelve rows; `chordsUnderSpan` feeds the chord names |

### Existing tests that change on purpose

`src/song/melody.test.ts`: "shows two octaves from the home note, highest first, and knows which notes are in the key" becomes a test of `gridRows` with two octaves (same expectations) plus one with seven.

### Left for later

The Vocals plugin.

### Done means

- [ ] All checks pass.
- [ ] `npx tsc --noEmit` clean, `npm test` green, `npm run build` passes; README test count line updated; trailer lines. **Release 4 is cut from here.**

---

## Step 5: the Vocals plugin, the engine hook, Settings → Audio

**Goal.** The old Vocals page is split for good into a record window, a vocal sound window and a take browser; one hook owns the recording engine; audio setup moves into Settings. Harmonize is polished to work on a clip's bars. This is release 5.

**Depends on:** 2b. **May run beside it:** 3, 4, 6r.

**Read first:** spec F.2 ("Who owns the recording engine", from release 5), F.3 (last paragraph), F.4, F.5, E.3 (table, Vocals row), E.5 (Harmonize, Audio setup), risk 35, table G parts G.8 and G.10.

### Create

| File | Holds |
|---|---|
| `src/ui/audio/useEngine.ts` | the hook, mounted once by the host: open and close, the hand-off, the salvage of a recording after a reset; publishes the status to a small store, `engineStatus`, that every readout reads. The code is moved from `src/ui/components/VocalsPage.tsx:210-342`, not rewritten |
| `src/ui/plugins/audio/RecordWindow.tsx` | Record and Rehearse, the pass readout, ★ and K, count-in and click, the row of passes, the take list |
| `src/ui/plugins/audio/VocalSound.tsx` | the vocal sound box (`VocalsPage.tsx:903-925`, `EqGraph`), its LIMIT lamp, "Apply sound"; the sound window of Vocals and Blank tracks |
| `src/ui/plugins/audio/TakeBrowser.tsx` | `TakeList5` grown into the browser (All / ★, hear, ★, Use, delete, remove, short takes, the shelf) |

### Edit

| File | Change |
|---|---|
| `src/ui/components/SettingsPanel.tsx` | a new "Audio" part: interface, buffer, measured delay, dropouts, every input's meter, headphone mix, the four reminders, the timing nudge; reached also from "Audio setup…" in a track's input list |
| `src/audio/handoff.ts` | the "wanted" rule of F.5: `active` means "the record window or Settings → Audio is open" |
| `src/ui/components/HarmonyPicker.tsx` | works on the open clip's bars directly (sources are the tracks with music under those bars), through optional props, so the old view that still imports it compiles |
| `src/ui/plugins/audio/RecordHost.tsx` | mounts the new parts in place of `VocalsPage` |
| `src/ui/timeline/Host.tsx` | mounts `useEngine`; the panel's input meter and the top bar's pass readout read `engineStatus` |
| `src/ui/plugins/registry.ts` | the Vocals and Blank lines |
| `src/ui/plugins/audio/audio.css` | this plugin's styles |

### Do not touch

`src/ui/views/GuitarView.tsx`, `src/ui/components/MelodyGrid.tsx`, `src/ui/styles.css`, `src/ui/plugins/chords/`, `src/ui/plugins/melody/`, `src/audio/` other than `handoff.ts`, `src-tauri/`.

### Acceptance checks (1280 × 800, desktop app with an interface)

1. Repeat checks 2 to 12 of step 1d. Expected: the same results, in the new windows.
2. Open ⚙ → Audio with no record window open. Expected: the interface opens after a second of quiet; every input shows a meter; the measured delay and the dropout count show. Close Settings and press Space. Expected: the song starts; Play waits for the interface only because it was open.
3. Click FX on a Vocals track. Expected: the vocal sound box as a sound window, with the LIMIT lamp live while you sing through the effects.
4. Change a knob after recording. Expected: "Apply sound" lights; pressing it re-makes the takes' sound.
5. Pull the interface's cable during a take. Expected: the recording made so far is kept as takes.
6. In a Melody composer press Harmonize on a clip over bars 9–12. Expected: the sources offered are the tracks with music under bars 9–12; the audition loops those bars with the candidate in place.

### Automated tests to add

| File | Asserts |
|---|---|
| `src/ui/audio/engine.test.ts` | the status store: one subscriber list, the last status is given to a late subscriber; a salvage result reaches `onRecorded` once |
| `src/ui/plugins/audio/audio.test.ts` | rendered to text: the record window has no lane; the sound window of a stereo track shows only Output level; the browser is grouped by recording |

### Existing tests that change on purpose

| Test | Why |
|---|---|
| `src/audio/handoff.test.ts` | the "wanted" rule of F.5 (the cases that name the Vocals page now name the two windows) |
| `src/ui/components/harmonypicker.test.ts` | the picker reads a clip's bars |

`src/song/takes.test.ts`, `src/song/clips.test.ts` and `src/ui/components/takelane.test.ts` do **not** change here: `VocalsPage.tsx`, `TakeLane.tsx` and the functions they call stay on disk, unmounted, until step 7, because the old view imports them.

### Left for later

Every input and pairs, once-through recording, the browser's microphone (6).

### Done means

- [ ] All checks pass; `src/audio/through.test.ts` passes unedited.
- [ ] `npx tsc --noEmit` clean, `npm test` green, `npm run build` passes; README test count line updated; trailer lines. **Release 5 is cut from here.**

---

## Step 6r: desktop engine work (Rust)

**Goal.** Four additions to the desktop recording engine that the blank audio track needs. Nothing on screen uses them until step 6, so this can be built from day one.

**Depends on:** nothing. **May run beside it:** everything.

**Read first:** spec F.1 (the table: R1 to R4), `map-audio.md` section 4.

### Edit

| File | Change |
|---|---|
| `src-tauri/src/engine.rs` | **R1:** `engine_set` (line 945) gets `input_b: Option<usize>`; with it the record path writes two samples per frame; `Recorded` (line 1052) gets `channels`; `read_take_range` (line 1156) returns both channels. **R3:** a pair is monitored dry in stereo. **R4:** `engine_start` (line 1011) gets `once: bool`: the backing plays once, then silence; recording runs until Stop; `Recorded.loop_frames` is 0 |
| `src-tauri/src/recfile.rs` | **R1:** the writer takes a channel count |
| `src-tauri/src/meter.rs` | **R2:** meters for every input channel, up to 32 (today the first 8, line 61) |
| `src/desktop.ts` | the new arguments and fields on `engineSet`, `engineStart`, `Recorded`; all optional, so today's callers compile unchanged |

### Do not touch

Anything under `src/` other than `src/desktop.ts`.

### Acceptance checks (desktop app, an interface with at least two inputs)

1. Record a vocal as in step 1d. Expected: exactly as before (mono, round the loop).
2. From the developer console call the engine with `input_b` set and record a few seconds. Expected: a stereo WAV on disk with input 1 on the left and input 2 on the right.
3. Start with `once: true` over a 4-bar backing and stop after 10 bars. Expected: the backing is heard once, then silence; the file is 10 bars long.
4. Open the meter stream on an interface with more than 8 inputs. Expected: a level for every input.

### Automated tests to add

Rust unit tests, run by `cargo test --manifest-path src-tauri/Cargo.toml`: the stereo writer writes interleaved frames and a correct header; a once-through backing gives silence after its last frame and `loop_frames` 0; the meter gives one value per channel up to 32; `read_take_range` of a stereo file returns two channels.

### Existing tests that change on purpose

None.

### Left for later

Using any of it (6).

### Done means

- [ ] `cargo test` green; `npx tsc --noEmit` clean; `npm test` green; `npm run build` passes; trailer lines.

---

## Step 6: the blank audio track

**Goal.** An audio track that records any input or stereo pair of the interface, once from the cursor or round the loop; and simple microphone recording in the browser. This is release 6.

**Depends on:** 5, 6r. **May run beside it:** nothing.

**Read first:** spec F (all of it), A.1 (`InputRef`, `Take5.channels`), risks 18 to 20.

### Create

| File | Holds |
|---|---|
| `src/audio/webrec.ts` | the browser's recorder (F.6): `getUserMedia` with echo cancelling, noise suppression and gain control off; an audio-thread recorder into memory; the latency arithmetic |

### Edit

| File | Change |
|---|---|
| `src/ui/timeline/TrackHead.tsx` | the input list offers every input and every pair ("In 1" … "In N", "In 1+2", "In 3+4" …); the chip shows "1+2" for a pair |
| `src/timeline/record.ts` | `recordPlan5` with the loop off: from the bar line at or before the cursor to the song's end plus 8 bars, `loop: false` |
| `src/ui/plugins/audio/RecordWindow.tsx`, `RecordHost.tsx` | `engineStart({ …, once: !plan.loop })`; the backing for `loop: false` is rendered with `fold: false` and the last render is kept by a fingerprint; a stereo track records and plays dry; in the browser, the recorder of `webrec.ts` and its one-line note about timing |
| `src/audio/takebuffers.ts` | reads takes kept in IndexedDB (`idb:<id>`) and stereo files |
| `src/ui/plugins/audio/VocalSound.tsx` | on a stereo track only Output level |

### Do not touch

`src/audio/handoff.ts`, `src/audio/through.ts`, the composers, `src-tauri/` (6r is done).

### Acceptance checks (1280 × 800)

Desktop, an interface with a guitar on input 2:

1. + → Blank. Expected: a new audio track with the vocal chain off.
2. Click its input chip before arming. Expected: the list has every input and pair of the interface, also while the song plays. Choose "In 2". Expected: the chip says "2".
3. Arm it, switch the loop off, click bar 5, press Ctrl+R. Expected: "Preparing…" with progress, a count-in, then the song plays once from bar 5 while a clip grows on the lane; it goes on recording past the song's end until Stop.
4. Stop. Expected: one clip from bar 5, sitting where it was played; one take in the list.
5. Choose "In 1+2", record again. Expected: a stereo take; it plays back with input 1 on the left.
6. Record a second take from bar 5 at once. Expected: it starts without "Preparing…".

Browser:

7. Click ● on an idea with a Blank track and allow the microphone. Expected: the song plays while a clip grows; after Stop the take is on the lane, close to in time; a line says the timing can be set with the nudge. Reload. Expected: the take is still there.

### Automated tests to add

| File | Asserts |
|---|---|
| `src/timeline/record.test.ts` (extend) | loop off: from the cursor's bar line to the end plus 8 bars; the fingerprint of the backing changes when another track's clip changes and not when the armed track's does |
| `src/ui/timeline/inputs.test.ts` | the list builder: count from the open engine, else the device, else `studio.inputs`; a saved choice beyond the count is listed and marked "not there"; pairs are 1+2, 3+4 … |
| `src/audio/webrec.test.ts` | the latency arithmetic: a take is moved earlier by `baseLatency + outputLatency` plus the nudge |
| `src/audio/takebuffers.test.ts` (extend) | an `idb:` take and a stereo take load |

### Existing tests that change on purpose

None.

### Left for later

Clean-up and the phone (7).

### Done means

- [ ] All checks pass on a real interface and in a browser.
- [ ] `npx tsc --noEmit` clean, `npm test` green, `cargo test` green, `npm run build` passes; README test count line updated; trailer lines. **Release 6 is cut from here.**

---

## Step 7: clean-up and the phone

**Goal.** Delete what nothing mounts any more, with the tests that only tested it, and give the phone a layout of its own. This is release 7.

**Depends on:** 6. **May run beside it:** nothing.

**Read first:** spec H (the table of tests, last row), `map-model.md` section 7 (the tests listed "replace on purpose"), D.5 (the phone), E.1 (the phone sheet), risk 32.

### Delete

`src/ui/views/GuitarView.tsx` first, then what only it imported: `src/ui/components/FrameSections.tsx`, `TrackPage.tsx`, `VocalsPage.tsx`, `TakeLane.tsx`; the legacy host files under `src/ui/plugins/`, `src/ui/windows/ClipLens.tsx` once no plugin mounts through it, `AppProvider` and the old state's provider code in `src/ui/state.tsx`, `src/ui/othertab.ts`, `src/ui/openidea.ts`, the page styles in `src/ui/styles.css`, the section mutators nobody calls in `src/song/structure.ts` and `src/song/tracks.ts`, and `src/main.tsx`'s fixture switch if the fixture page is no longer wanted.

**Keep:** the old-song reader (`sections`, `commit`, `normalize`, `settle`, `conform`, `migrateSong`, `reviveProgression`, `reviveIdea`, `loadV4`), because conversion still reads old ideas and backups; `src/song/legacyplan.ts`, `src/timeline/voicing.ts` and `src/timeline/equal.test.ts`, because they are the proof that conversion sounds the same.

### Edit

| File | Change |
|---|---|
| `src/ui/timeline.css`, `src/ui/timeline/*` | at widths up to 760 px or with a coarse pointer: panels shrink to name, compose, M, S; pinch zooms the timeline; a long-press moves a clip; windows are bottom sheets one at a time |
| `src/ui/app5.tsx` | a selector hook so a window re-renders only for its own clip and track |

### Do not touch

`src/audio/`, `src-tauri/`, the conversion.

### Acceptance checks

Desktop, 1280 × 800: run checks 1 to 15 of step 2 and the checks of steps 3 to 6 once more. Expected: unchanged.

Phone (a real phone, or a 390 × 844 window with touch):

1. Open an idea. Expected: the track view fits; each panel shows name, the bass clef, M and S.
2. Pinch on the lanes. Expected: time zooms. Long-press a clip and drag. Expected: it moves. Long-press without moving. Expected: the clip's menu.
3. Tap the bass clef. Expected: the composer is a sheet from the bottom; its strip can be dragged onto a lane above it.
4. Open an old idea that was never opened in the new version (restore a version 1 backup file). Expected: it is converted and plays.

### Automated tests

Remove with their modules: the section tests listed "replace on purpose" in `map-model.md` section 7; the tests of the old state modules (`src/ui/othertab.test.ts`, `src/ui/openidea.test.ts`, `src/ui/components/trackadd.test.ts`, and the section cases in `src/song/sections.test.ts`, `sectiontracks.test.ts`, `structure.test.ts`); `src/ui/components/takelane.test.ts`; and the block-and-bar cases of `src/song/takes.test.ts` and `src/song/clips.test.ts` whose functions go (the cases that still matter already live in `src/timeline/audioclips.test.ts`). Keep every test of the old-song reader that conversion depends on (`src/song/migrate.test.ts`, `unity.test.ts`, `library.test.ts`'s reading cases). Add `src/ui/timeline/phone.test.ts`: the narrow layout's markup has the four panel controls and no dB readout.

### Existing tests that change on purpose

The removals above. Nothing in `src/audio/`.

### Done means

- [ ] `grep -rn "GuitarView\|FrameSections\|TrackPage" src` finds only `legacyplan.ts`'s header comment.
- [ ] The audio thread is measured again with 24 tracks and the number is in the README.
- [ ] `npx tsc --noEmit` clean, `npm test` green, `npm run build` passes; README test count line updated (it goes down here); trailer lines. **Release 7 is cut from here.**
