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

## Step 1b (the track view on props, the plugin window, the fixture page)
Files: `src/ui/timeline/` (`TrackView.tsx`, `TopBar.tsx`, `KeyPopover.tsx`, `Ruler.tsx`, `TrackHead.tsx`, `Lane.tsx`, `ClipView.tsx`, `ClipActions.tsx`, `AddTrack.tsx`, `Menu.tsx`, `gestures.ts`, `keys.ts`, `draw.tsx`, `fixture.ts`, `FixturePage.tsx`), `src/ui/timeline.css`, `src/ui/windows/` (`Window.tsx`, `windows.tsx`). Seen at `?fixture=timeline`.

`TrackView` props: `song`, `keyOf`, `session`, `edit(label, fn, control?)`, `setSession(fn)`, `player: PlayerApi`, `open(kind, track, clip?)`, `peaks?(take)`, `clipboard { copy(ids), paste(at, onto, insert), has }`, `sound { copy(track), paste(track), has(track) }`, `top: TopBarProps`, `dropKind?`, `stale?`, `again?(track, clip)`, `inputs? { count, level?(ch), setup() }`, `recording?()`, `say?(msg, undo?)`. Constants `ROW_H = 64`, `ADD_H = 44`, `PANEL = 260`.

What the host (step 1c) must know:
- `session.pxPerBeat <= 0` means "no zoom chosen yet": the view fits the song and writes the fit into the session. Set it to 0 whenever an idea opens.
- The view writes `session.cursor` itself and then calls `player.seek(beat)`.
- When the view needs ids of new clips it works them out so calling `fn` twice gives the same ids. `edit` must do nothing when `fn` returns the same song.
- `peaks`: any number of values 0 to 1, spread evenly over the take's frames.
- Local to the view (not in `Session`): Follow, the selected marker, renaming, the open menu.
- Mixer writes: `edit(…, s => ({ ...s, mix: mixWith(s.mix, id, patch) }), "mix:<id>:<field>")`.
- `bookAhead()` is not called by the windows code: the host calls it on open and close.
- Root element `.tlv`, `100dvh` high; top bar `header.topbar`; transport `section.transport`.
- `TopBar` also takes `TopBarLive` from the view: `song`, `keyOf`, `cursor`, `player`, `looping`, `onLoop`.
- `Window({ win, title, tools?, children, strip?, focused, onFocus, onClose, onMove, z? })`; root has `.tlw`, `data-keys="own"`, `data-win="<id>"`; below 761 px or under a coarse pointer it is a bottom sheet.
- `useWindows(session, setSession)` returns `{ open, close, focus, focused, move }`; plain functions `firstPlace`, `keepInside`, `isSheet`, `openWin`, `closeWin`, `frontWin`, `placeWin`, `openWins`, `zOf` (45 to 59), `openLabel(song, clip)`, `winId`; also `useWinFocus()`, `useSheet()`, `PANEL_W = 260`, `TOP_H = 84`, `SOUND_W = 420`. A closed window stays in `session.windows` with `open: false`.
- Keys: `keyAction(e, where, desktop)`, `whereOf(target)`, `listenKeys(run, desktop)`. Escape is a registry: `onEscape(level, fn)` with `ESC_OPEN = 3`, `ESC_WINDOW = 2`, `ESC_VIEW = 1`, run by `runEscape()`; sheets, the Canvas and the shape finder should register there. A container that carries `data-keys="own"` (or class `.sheet`) gets only Space, undo, redo, save, Escape. The take list should carry `data-keys="takes"`.
- Rough edges left: the clip's button row covers the top of a selected clip (and overhangs clips narrower than about 160 px); the box select does not scroll at the edges; a new blank track is named "Audio 1" by `addTrack` while the chooser says "Blank"; touch is basic; `TrackView.tsx` is about 1,050 lines.

## Step 1a part 2 (cuts, flatten, conversion, library, lens, engine touches E1 and E2)
Render equality: all 17 fixtures and the worked example ask the engine for exactly what the old song asked (offline, live, on a loop, after store-and-load). MIDI differs in two documented cases only (a row split by sound), asserted exactly in `equal.test.ts`.

Exports:
- `cuts.ts`: `cutPoints(song)`, `stretches(song)`, `noteClips`, `drumsClipsOf`, `barOwner`, `gridOf`, `leadDrums`, `leadFeel`, `MAX_STRETCH_BARS = 32`.
- `flatten.ts`: `FlattenCtx { voicingsOf(chords, arrange); buffer(take, dry?); bypass? }`, `Range { spans; loop; cut? }`, `Flat { items; at; origin; loop; any; end }`, `flatten(song, ctx, range?)`, `songBeat(flat, { index, beat })`, `drySound`, `dryKit`, `beatOf`.
- `migrate5.ts`: `toTimeline(p): { song; ids }`, `heardTone`, `soundKey`, `unplacedTakes(song)`, `FIRST_IDS = { chords: "t-chords", melody: "t-melody", drums: "t-drums" }`, `SOLO_BLOCK = "a"`.
- `convert.ts`: `convertAll(old: AppStateV4, now?)`, `convertIdea(i): { idea; backup }`, `arrive(s, old, original): { state; added? }`, `clipboard5`, `newSession()`, `backupId(id) => id + "-v4"`, `besideId(id) => id + "-o"`.
- `library5.ts`: `reviveSong5`, `reviveIdea5`, `reviveMelody5`, `fingerprint5`, `describeIdea5`, `mergeIdeas5`, `toPush5` (never sends a backup entry), `exportIdeas5(ideas, originals)` (file version 2), `importIdeas5(text): { version; ideas; originals; old }`, `emptySong5`, `ideaTime5`, `isBlank5`, `rhythmOf`.
- `lens.ts`: `Target { track; clip?; fresh? }`, `Lens { p; span; lead; melody }`, `lensOf(song, target, key, anchor)`, `unlens(song, target, lens, after, id)`, `chordsUnderSpan`, `harmonyState5`.
- `renderlog.ts` (test helper): `renderLog`, `liveLog`, `logDiff`, `midiTracks`, `fakeBuffer`.
- `song/melody.ts`: `MelodyNote.len?`, `TuneHit.len?`, `gridRows(key, low, octaves, keyOnly?)`, `GRID_LOW = 24`, `GRID_HIGH = 108`. Audio: `playTuneNote(..., as?, len?)`, `PlayItem.meter.swing?`, `meterOf(b, own?)`.
- Tester's data: `src/timeline/fixtures/v4-ideas.json` (18 old-format ideas).

What the switch-over (1c) must know:
- `flatten` keeps its work per `ctx.voicingsOf` function: keep that function stable (memo on tuning, capo, shapes). `ctx.buffer` must return the same object for the same take, or takes restart.
- Pass `null` for the player's fallback beat and tune. Use `keepSlots(slotsOf(flat.items), trackIds)` as before.
- MIDI export: pass `names` as track id → name; the file's first track is empty.
- `arrive` leaves storing the newer original to the caller: after `"refreshed"` under the idea's id, after `"beside"` under `<id>-o`. If `original(id)` returns null the idea counts as edited and the copy goes beside it.
- Conversion toast count: `unplacedTakes(song)`.
- Lens targets: `{track, clip}` for a clip; `{track, fresh}` for an empty track; `{track}` alone for the draft. `unlens` returns the same song object when nothing changed. `Lens.melody` presents the top melody track under the old id "melody" so harmony checks read as before.
- `transpose` in `edit.ts` does not update a clip's harmony fingerprints, so after "Move song" a harmony may read as changed (the old app followed the marks): fix in 1c or note it.
- `store5.ts` and `backupSource` are NOT built yet: they belong to 1c. "A version 5 song is never converted" is to be tested on `load5` in 1c.
- `renderLog` and `liveLog` are ready for `player5.test.ts`.

What recording (1d) must know:
- Lane tracks (`v1~2`, …) hold copies of the take records their clips play; the same take id can be on two tracks. `joined` is decided across all audio clips of the song.
- E1 `len` is in twelfths of a beat; `flatten` sets it only where a note would otherwise be held past its clip's end.

## Step 1c (the switch-over)
Files: `src/timeline/store5.ts`, `export.ts`; `src/ui/app5.tsx` (provider), `idb.ts`, `othertab5.ts`, `openidea5.ts`; `src/ui/timeline/usePlayer.ts`, `Host.tsx`; `src/ui/windows/ClipLens.tsx`; `src/ui/plugins/LegacyComposer.tsx`; `src/canvas/taps5.ts`. `App.tsx` mounts `App5Provider` and `Host`.

What later steps must know:
- **State.** `useApp5()` also has `peek()`: the state as it is this moment (the provider keeps it outside React's draw, so two changes in one handler each see the one before). `edit` is one undo step; `set` is none. `afterRestore(song)` in `app5.tsx` is where 1d runs `renudge5` (undo, redo, idea open all pass through it).
- **Storage.** `load5` never writes. `settleConversion` is the only code that removes the old key. A text that cannot be read (`stuck`) freezes writing for the session. The provider writes 400 ms after a change and at once on `pagehide`, on idea change, on save and in `setRecordingTo(id)`. `Shelved.saves` is still never counted (nothing drops a shelf entry yet): 1d decides.
- **Originals.** `backupSource(backupEntryId, stores?)` reads: the idea kept on its own (`idea:<stem>` in the larger store, where `stem` is the entry's id without `-v4`), then `v4-blob`, then `v4-blob-late`, then the old key, then the old cloud list. (The first text before the late one: a backup entry stands for the copy its idea was converted from.) `setStores` is called once by the provider.
- **Player.** `usePlayer(heard, session, ctx)` also does the engine's housekeeping (tempo, mixer, voices, notes ahead). `useTakes(song)` gives `ctx.buffer`; takes are read only in the desktop app. `player.audition(span, solo?)` goes round a stretch (it restarts the music there); `audition(null)` ends it (and stops the music if the audition started it). The pure parts are `sameShape`, `resumeAt`, `rangeFor`, `startFor`, `startIndex`, `carryOn`. `relist` asks where to go on only after it has the list, so the host hands it an array and fills it inside the callback (the engine keeps that very array).
- **Windows.** In this release `open("sound", track)` opens the same composer window with `toSound`. A composer window always has `win.clip`: an id that does not exist yet on a track with no clips (the first thing written makes the clip under that id). A window whose clip is gone closes. All composers dock in the same place; the track's compose button brings its window to the front.
- **Recording (1d).** Compose on a Vocals or Audio track opens `LegacyComposer`'s holding message: replace that branch (`target === null`) with the record window. `Host` passes no `top.record`, `inputs` or `recording` yet. `session.armed` already toggles from the panel and is never stored. `recordingTo` locks undo, redo and idea changes. The Canvas, settings and `BarsControl` are mounted inside `V4View`; the Vocals page needs the same in host mode.
- **Escape.** Old sheets register with `onEscape(ESC_OPEN, …)` while open (the embedded page does it for its shape finder and harmony sheet; the Canvas for its full screen; `IdeasPanel` and the host for the sheets).
- **Known and not fixed.** (1) After "Move song" a harmony clip may show the "source changed" dot (`transpose` does not rewrite the marks). (2) The old engine sends a track's reverb once for every sound slot the track has (`rack.ts`: each rack connects the track's shared send to its room), so a track that sounded N ways across sections had N times the reverb; converted, each of its N tracks has one. Measured as WAV level, old against new: 15 of 18 fixtures within 2 %, fixtures 8 and 15 about 4 to 5 % lower, fixture 3 (one chords track on four sounds, nothing else playing) 41 % lower. Not changed here: it needs a decision (keep what the knobs say, or raise Reverb on split tracks in the conversion).
