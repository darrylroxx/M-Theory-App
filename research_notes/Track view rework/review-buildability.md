# Review of spec.md: will it work, and can it be built in the steps given?

Read against commit 0f436e9. Every item below was checked in the code at the place named. Nothing in the repository was changed. Paths are under `src/`.

Short verdict: the model, the edge-repeat arithmetic, the bar map, the storage key and cloud prefix, and the idea of feeding the unchanged player through one adapter all hold up. The parts that do not hold up as written are (1) how release 1 reaches the old pages, (2) the merge order and the "parallel" claims, (3) four places where an old song or an edit would not sound right, and (4) two storage traps. Each has a small, concrete fix.

Things checked and found correct (no action): the worked edge-drag example in A.3; `origin + pos.beat` as the song beat (`audio/synth.ts:499-507`, `audio/patterns.ts:278`); a loop or a start at any beat through `from` and `sliceItems` (`song/frame.ts:100`, `audio/trackplay.ts:31`); repeat ids `#k` for audio (`audio/takeplay.ts:141`); the vocal clip start formula in B.1 step 12 against `layClips` (`song/clips.ts:312`); `idea5_` is invisible to an old build (`ui/cloud.ts:61` tests `startsWith("idea_")`); an old build cannot import a version 2 backup file (`song/library.ts:95` needs `progression.chords`); harmony prints survive if the lens turns `mute` back into `on: false` (`song/prints.ts:21`); the drum noise bed and desk are not restarted by a new but equal `Beat` object (`audio/drumbus.ts:394-410, 583-592`).

---

## Blockers (release 1 does not work as written)

### 1. Merge order 1a, 1c, 1b leaves the app broken, and the three worktrees are not independent
Where: H, Release 1 table.
- 1c owns `ui/App.tsx` and `ui/plugins/LegacyComposer.tsx`. Both import things that only exist in 1b (`ui/timeline/TrackView`, `ui/windows/Window.tsx`). After "1a, then 1c" the build fails, or the state is version 5 while the screen is still the old pages reading `state.progression`.
- 1b is said to depend on `model.ts` only, but its own file list has `usePlayer.ts` (needs `flatten` from 1a and the song store from 1c) and `TopBar.tsx` (needs the key bar and the three export functions, which are private parts of `ui/views/GuitarView.tsx`: `KeyBar` at `:988` is not exported and is only mounted inside `FramePage` at `:1642`).
- 1a "moves" the plan builder and `voicingsOf` out of `GuitarView.tsx`; 1c edits the same file for `embedded`.
Fix: (a) one small commit before branching: copy (do not remove) `GuitarView.tsx:204-307` and `:94-135` into `song/legacyplan.ts` and `timeline/voicing.ts`, and export `KeyBar` and the export helpers. (b) 1b takes `song`, `session`, `dispatch`, `player` as props and never reads the app context; `usePlayer.ts` moves to 1c. (c) Merge order 1a, 1b (not mounted, shown only on a fixture page), then 1c last as the one switch-over.

### 2. The `embedded` flag and `ClipLens` are far from enough to run an old page in a window
Where: H "How the old pages are reached", E.4.
- `GuitarView` mounts every page at once and only hides them (`GuitarView.tsx:935-968`: Track, Frame, Chords, Melody, Vocals, Canvas, Drums). Each legacy window would carry a full hidden copy of the whole app and re-render it on every change.
- Effects the flag list does not switch off, all global: `keepTakes(playedTakes)` (`:191-196`; with a lens that has no vocal track it lets go of the song's decoded takes beyond 8, `audio/takebuffers.ts:59-70`, so vocals fall silent until read again); `prepareNotes(...)` on every render (`:394-397`; it replaces the one global queue, `audio/synth.ts:234-235`, so the host's song is no longer made ready ahead); both `hearOn` effects (`:391-392`; a Melody window also points chord taps at the reserved id `"chords"`, so the last window mounted wins, not the focused one); `setTempo` (`:387`), `setHome` (`:418`).
- The context is more than `state` and `set` (`ui/state.tsx:624`): `addChord` and `audition` are closures over the outer state (`:475-497`); `sheet/openSheet` is one global value, so the shape finder would open in every Chords window; `toast` keeps an action whose `when(state)` is called by the outer provider with the outer state (`:625`).
Fix: write this into the spec for release 1. `embedded` renders exactly one pane and no hidden siblings, no `Transport`, no `FramePage`/`TrackPage`/`CanvasPage`; the effects at `:187-196, :387-397, :418` are off (the host owns `keepTakes`, `loadTake`, `prepareNotes`, `hearOn`, `setTempo`, `setHome`). `ClipLens` builds a whole context of its own: its own `addChord`, `audition`, `sheet/openSheet`, a `toast` that wraps `when` and `run` through the lens, `dirty: false`, `saveIdea` passed through. `lensOf` must return the same objects while its clip and track have not changed (keep by `WeakMap`), or every hidden window recomputes its whole plan on every knob movement.

### 3. Vocals through the lens (release 1 "record vocals") breaks in five verified ways
Where: H release 1, last bullet.
- Crash: the Vocals page raises an undo message with `when: (s) => isAt(trackIn(s, id), after)` and `trackIn` reads `s.progression.tracks` (`components/VocalsPage.tsx:553, 565`). The outer provider calls it with the new state, which has no `progression`: a throw inside `AppProvider`, above every crash guard.
- Its undo compares by object identity (`isAt`, `:547`) and includes `active`; B.1 step 12 drops `Track.active`, so after any "Use take" nothing can be undone and the message never shows.
- It has its own Ctrl+Z listener on the window (`:574-583`). With the global Ctrl+Z of D.3 both fire.
- Take alternatives are decided by `sameSpot` = same section and bar (`song/clips.ts:41`). A lens that puts every take at bar 0 makes unrelated recordings "alternatives", and Use or a new recording would replace the wrong clips (`chooseTake`, `addRecording`, `:157-240`).
- The timing nudge rewrites `s.progression.tracks` (`VocalsPage.tsx:117-129`): through a lens only the one track is moved; other audio tracks keep the old nudge.
- Also unconverted: `Track.input` is 1 or 2 (`song/tracks.ts:46`, used as `input - 1` at `VocalsPage.tsx:347`); `InputRef.ch` counts from 0 and B.1 has no step for it.
Fix: do not lens the Vocals page. In release 1 build the small real path instead: bring `recordPlan`/`addRecording5` (loop mode only) and the take list forward from releases 5 and 6, mount `VocalsPage` only for its engine, meters and sound box with takes and clips passed as props; keep `active` on `AudioTrack` until release 5; add "input: old - 1" to B.1; keep `sameSpot` on the real song beat; apply the nudge in the host to every audio track and to the clipboard's takes.

---

## Major

### 4. `update` after an edit can play the wrong bars: "same number and lengths of items" is not enough
Where: C.4 "An edit while playing".
Today's test also requires the same section and the same `from` (`song/loops.ts:158-161`). `update` keeps the player's running `origin` (`audio/synth.ts:586-609`); a new item without `section: true` inherits it (`audio/patterns.ts:278`, `synth.ts:726`). In the new model a cut can move without any item changing (drag a melody clip's edge across a bar line where a cut was: the cut goes, items stay bar by bar). The rebuilt `extra` then counts from the new start while the player counts from the old one: drums, melody and chords of other bars are played until the next cut or loop turn.
Fix: use `update` only when count, lengths, `from` and `Flat.origin[i]` are all equal; otherwise `relist` (it sets `origin` from the new list, `synth.ts:634`). Also say what the host returns when `next === items.length` (`old.at[next]` is undefined): the loop's first item, or the list's length when not looping. Add both to `flatten.test.ts`.

### 5. Audio clips fixed by start beat: a tempo change tears split and trimmed vocals apart
Where: A.1 `AudioClip.start`, C.7 point 4, risk 21.
Today every clip of a take hangs from the take's bar and runs in seconds (`song/clips.ts:311-313`), so two halves of a split stay joined at any tempo. With one stored start beat per clip, 96 to 120 bpm makes a clip split at 4 s overlap itself by 0.8 s (heard doubled), 96 to 80 leaves a 0.8 s hole. It also breaks rule A.6.2, because an audio clip's length in beats grows with the tempo.
Fix: `setTempo(song, bpm)` in `edit.ts` re-places every audio clip so the beat on which its take's first frame lies stays put: `zero = start - (from + off) / rate / spbOld`, `start' = zero + (from + off) / rate / spbNew`. Then trim any overlap that still results with `layDown`. One test: split, change tempo, the halves still touch and are `joined`.

### 6. Old vocal tracks may hold clips that overlap in time; the new model forbids it and B.1 is silent
Where: B.1 step 12, A.6 rule 2.
A vocal track today is rows of recordings that all play (`components/TakeLane.tsx:65`, `layClips` lists every clip); only recordings from the same bar make way for each other (`song/clips.ts:217-240`), and a clip can be dragged over another (`moveClip`, `:123`).
Fix: in conversion, lay a vocal track's clips into lanes; lane 2 and up become tracks `<id>~2`… directly below with the same sound, input and mixer entry and the takes they play (files shared). Fixture 8 gets two recordings that overlap. This keeps "sounds the same" and the no-overlap rule.

### 7. Nothing fits a drum rhythm to its clip's signature any more
Where: A.3 `contentBeats`, A.4 last bullet, E.4.
`contentBeats = bars * sigBeats(sig)` is only true when `steps / div` equals the bar. Today that is guaranteed by `conform` on every state change (`ui/state.tsx:271, 392`); picking a rhythm writes it raw (`GuitarView.tsx:719-720`) and the library has bars of 6, 9, 12, 15 and 20 steps (`audio/rhythms.ts`). With `conform` gone, a 6/8 rhythm picked in a 4/4 clip has notches and repeats in the wrong place.
Fix: `setContent` runs `fitRhythm(g, sigBeats(sig), isCompound(sig))` for drums; `unlens` runs `conform(after)` before reading (the lens song already has `meter: clip.sig`). Test: every library rhythm into a 3/4 and a 6/8 clip keeps `steps / div === sigBeats(sig)`.

### 8. Two drum clips of different grid or swing can meet inside a bar; one flattened rhythm cannot hold both
Where: C.2 rule 3, A.6 rule 1, D.2 (Shift snaps to beats).
Cuts are only on bar lines, clips may start on any beat, and a `Beat` has one `div` and one `swing` (`audio/beats.ts:106-111`, `stepBeat` `:502`).
Fix (simplest): on drums tracks clip edges snap to bar lines only. Or: where the meeting point is inside a bar, cut the earlier clip back to the bar line when flattening and say so in C.7.

### 9. Local storage is doubled for good, and a failed write is silent
Where: B.3, B.4, risk 12.
The old blob stays and a new blob of at least the same size is written beside it (larger: repeats are separate copies now). The write is wrapped in an empty `catch` (`ui/state.tsx:403-419`). If the new key does not fit, nothing is saved, nobody is told, and the next start converts the old blob again: everything done since is gone. Not measured: how big real blobs are.
Fix: before the first write, measure; on a quota error show a plain message and keep working in memory. Move the frozen old blob into IndexedDB during conversion (write, read back, then remove the old key; an old build then just starts empty). Add "second start after a failed write does not reconvert over newer work" to `convert.test.ts`.

### 10. A stale local copy is converted before the cloud is read, and the newer old-format copy is then ignored
Where: B.3 "conversion happens once per id".
`load()` runs at start; the cloud merge runs later (`ui/state.tsx:574-601`). Device B holds an older copy of idea X than the cloud. B converts its stale X; the newer `idea_X` then "has a version 5 idea" and is skipped. B shows old music until device A is updated.
Fix: a version 5 idea made by conversion carries `from: <updatedAt of its source>`. An old-format copy that is newer than `from` replaces it by a fresh conversion as long as the idea has not been edited since (`fingerprint5` equal to the conversion of its backup). Keep the original `updatedAt` on converted ideas so no device "wins" just by converting.

### 11. Releases 3, 4 and 5 do collide
Where: H "What can be built in parallel".
All three must edit `ui/views/GuitarView.tsx`: it mounts `MelodyGrid` (`:956`, with the sound props release 4 removes), `VocalsPage` (`:960`) and `HarmonyPicker` (`:971`, also `components/TrackPage.tsx:349`). The Harmonize button of release 5 lives in the `Dock` that release 3 moves (`:1679`) and in `MelodyGrid` (release 4's file). E3 (release 3) changes `timeline/flatten.ts` and `renderSong`; all three touch `ui/styles.css`.
Fix: a short step after release 2: split `LegacyComposer` into one file per kind, each mounting only its page, and give Harmonize one entry (`onHarmonize` from the host). Then the three really are separate; `styles.css` gets one new file per plugin.

### 12. Release 1 breaks existing tests that the plan only deals with in release 7
Where: H release 1 "Tests to add", release 7.
`npm run build` type-checks the tests (`package.json:9`, `tsconfig.json` includes all of `src`). `ui/othertab.test.ts`, `ui/openidea.test.ts`, `song/library.test.ts` and others import `AppState`, `SavedProgression`, `joinOtherTab`, `reidea`, `mergeIdeas` (17 test files import from the state or library modules); 1c rewrites exactly those modules.
Fix: do not edit the version 4 modules in release 1. Add siblings (`timeline/library5.ts`, `ui/othertab5.ts`, `ui/openidea5.ts`) and keep `AppStateV4` exported under the old name for the old reader; the old tests stay green untouched and are removed with their modules in release 7. List in release 1 the three that change on purpose: `components/drumdesk.test.ts` (release 2), `song/melody.test.ts` rows (release 4), `ui/hands.test.ts` selectors.

---

## Minor

13. **Once-through recording returns no takes if `cutTakes` is used.** With `loop_frames: 0`, `loop = max(1, 0) = 1`, the first pass is one frame, under 50 ms, and the loop breaks (`song/takes.ts:60-70`). Fix: `addRecording5` builds the one take itself (`start = offset + nudge + count_in`, `frames = r.frames - start`); render that backing with `fold: false` (`audio/synth.ts:1100`) so the tail is not folded onto the start.
14. **Swing is lost where the first drums were on but empty.** Chord styles and melodies follow `drums.on && div === 4 ? swing : 0` and a triplet grid (`GuitarView.tsx:282, 288`, `audio/patterns.ts:230`), hits or not. B.1 step 5 makes a clip only when there is a hit. Fix: for the first drums row also make a (silent) clip when it is on and `swing > 0` or `div === 3`.
15. **Empty and vocal-only sections.** Rule 2 cuts at every bar line inside them, so "a converted song cuts on its old section lines" is false as a test; and trailing empty sections vanish from the song's length (`Flat.end` is the last clip end; today the list holds a pad for them, `GuitarView.tsx:296-300`), which shortens the WAV and MIDI. Fix: conversion writes `song.end` (beats) = the old total, `songEnd` is the larger of that and the last clip; word the test as "every old section line is a cut".
16. **B.5 structure test 4 cannot pass.** `slotsOf` counts a chords slot only where an item has notes and a melody slot only where a tune plays (`audio/synth.ts:129-130`); conversion always makes the three first tracks and makes clips for all-rest chords and muted melodies. Fix: compare only tracks with at least one unmuted clip that has a sounding note.
17. **Converted trims can no longer be undone by dragging the edge back.** Today an edge goes back out to the take's limits (`song/clips.ts:114-119`). Step 12 stores the trimmed stretch as the whole content, so dragging out repeats it instead. Fix: convert as `from: 0, to: take.frames, off: clip.from, frames: clip.to - clip.from`, the same shape a split in the new app gives. Also clamp a converted start below beat 0 by advancing `off`.
18. **"KeyBar mounted as is" is not possible.** It writes `s.progression` with `mapAllChords`/`mapAllMelodies` (`GuitarView.tsx:999-1009`). It also moves melodies by `melodyBase(new) - melodyBase(old)`, not by the semitone count. Fix: port it onto `transpose(song, n, key)` and state the melody rule there.
19. **An armed track makes every Play wait for the driver to close.** "Armed" replaces "the Vocals page is on screen" in `engineWanted` (`audio/handoff.ts:20-22`), `Session.armed` is saved, and every start awaits `freeInterface()` (`handoff.ts:50-56`, up to 1.5 s). Fix: the engine opens for an open record window, a recording, or monitoring through effects; arming alone only shows where ● will record. Do not restore `armed` at start.
20. **Small gaps to close in the text.** (a) Two `lead` chords or drums tracks can overlap once the user moves clips: say "the top one sounding", and item edges are the union. (b) Undo and redo are locked while recording or saving takes; a window whose clip is gone (undo, delete, laid over) closes, and `lensOf` of a missing clip returns null. (c) `cutTime` / `insertTime` / paste-with-insert work in whole bars of the bar map only. (d) Rule 1 of C.2 is also a forced cut for a clip lying across a signature change; list it in C.7. (e) Backup ids `<id>~v4` become cloud document ids; every id written so far is base 36 (`ui/state.tsx:387`), so use `-v4`. (f) The page-long `one()` store grows with every knob step; key it by the track's own sound object instead. (g) C.3 `midi`: keep the exact rule of `GuitarView.tsx:250` (keys voicing only when the tone is on the keys; guitar shape with empty strings filtered out).
