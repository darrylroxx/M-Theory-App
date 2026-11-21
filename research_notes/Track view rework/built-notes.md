# Notes from the steps already built (for the builders of later steps)

## Step 0 (groundwork)
- `loadV4` does not carry `Studio.inputs` (or `Studio.vocal`): the version 5 loader must carry `inputs` itself.
- `loadV4(null)` and a text that is not JSON return the `DEFAULT_STATE` object itself: do not mutate the result.
- `legacyPlan` expects a settled song (out of `reviveProgression` or `reviveIdea`). A song with no sections gives one `SecPlan` with `block: ""`, `partId: ""`.
- `VoicingCtx.shapeOf` for tests: `(ref, id) => chordShape(ref, tuning, capo, avoidBarre, id, shapes[shapeKey(...)])` (what the provider does at `ui/state.tsx:461`).
- Names that exist twice: `Track`, `TrackKind`, `Clip`, `ClipKind`, `voicingsFor` (also in `src/guitar/arrange.ts`), `keepTakes`. Import by path.
- `legacyplan.ts` is a frozen copy of the plan builder in `GuitarView.tsx` as of commit 0f436e9.

## Step 1a part 1 (model helpers, bar map, edits, undo)
- `model.ts` helpers beyond the spec: `mod`, `DEFAULT_RATE`, `framesToBeats`, `beatsToFrames`, `rateOf(song, clip)`, `frameCycles(clip)`, `zeroBeat(clip, bpm, rate)`. `bars.ts` extras: `ceilBar`, `onBarLine`. `edit.ts` extra: `clipboardBeats`.
- Second pieces made by `layDown`, `cutTime`, `insertTime` get ids `<id>:2`, `<id>:3`, the first free.
- `duplicateClips` copies the clips selected on one track as one run after the last of them.
- No edit function for mute, markers or the mixer: the screen writes them as `edit(label, s => ({ ...s, … }))`.
- `flatten` (part 2): use `zeroBeat`, `frameCycles`, `rateOf`, `framesToBeats`; decide `joined` with about half a frame of tolerance on `zero`.
- Screen (1b): `setSig`'s `atBar` is 0-based. Pass `toTrack` only for a single-track vertical drag. `moveClips`/`copyClips` refuse a drums clip off a bar line, so the screen snaps drums moves to bars. A new empty clip is made "shorter if another clip is in the way" by the screen (`layDown` trims the others instead). `resizeClip` rounds chords/melody edges to a whole beat and refuses a drums edge off a bar line; shortest lengths: one beat, one bar for drums, 20 ms for audio.
- Switch-over (1c): run `keepTakes(step.song, current)` after every undo and redo. Nothing increments `Shelved.saves` yet.
- `edit.ts` does not re-export `WinState` (the windows file should, spec E.1).
- `testsongs.ts` has builders and two ready songs: `bandSong()` (tracks tc/tm/tb/td/tv) and `mixedSong()` (4/4, 6/8 from bar 9, 4/4 from bar 13).
- `History.push` folds changes within 500 ms using `Date.now()`.
