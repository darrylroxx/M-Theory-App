# Song data model and playback plan: a map before the track-view rework

Read-only study of `/home/user/M-Theory-App` at commit `0f436e9`. All paths are under `src/`.
Line numbers are from that commit. Nothing in the repository was changed.

Short version of the findings:

- A song today is a **row of sections**. Every note-based track (chords, melody, drums) keeps its
  music **and its sound** per section. Only vocal tracks, the mixer and the tempo are per song.
- The audio engine never sees sections. It consumes a flat list of `PlayItem` (one chord, or one
  silence, of a given length in beats) where each item carries references to everything else that
  sounds around it. Live play, the WAV, the recording backing and the MIDI file all take that list.
- A free timeline of clips **can** be flattened into the same list by an adapter, with no change
  to the engine for a first version. The exact output is in section 2.4. There are three places
  where the list's "one shared start point per section" idea leaks through; they are listed there.
- The biggest conversion problem is not time, it is **sound**: old songs may give one track a
  different instrument, effects or drum kit in each section, and the new rule is one chain per track.

---

## 1. What a song is made of today

### 1.1 The containers, outermost first

| Container | Where | What it holds |
|---|---|---|
| `AppState` | `ui/state.tsx:152-182` | Everything the app stores: the open idea, the library, user libraries, settings |
| `SavedProgression` (an "idea") | `ui/state.tsx:128-138` | `id`, `name`, `key`, `progression`, `savedAt`, `updatedAt`, `capo`, `tuningId` |
| `Progression` (the song) | `ui/state.tsx:77-118` | Song-wide fields **plus a live copy of the section on screen** (see 1.4) |
| `Song` | `song/structure.ts:81-86` | `parts: SongPart[]`, `blocks: SongBlock[]`, `current` (the block on screen) |
| `SongBlock` | `song/structure.ts:77-80` | One step of the playing order: `{ id, partId }` |
| `SongPart` (a section) | `song/structure.ts:58-75` | The section's music and all its settings; shared by every block that names it |
| `Layer` | `song/tracks.ts:115-125` | One **added** track's content and sound in one section |
| `Track` | `song/tracks.ts:41-61` | A row of the song: `id`, `kind`, `name`; vocal tracks also hold their audio |

Two blocks with the same `partId` are the *same music* (edit one, both change). A block gets its own
copy with `unlinkBlock` (`song/structure.ts:315`). A song with no sections yet has `song: null` and
the page itself is "section A" (`soloSection`, `song/structure.ts:443`); its section id is `""`.

### 1.2 Per section, per track, per song

**Per song** (one value for the whole song):

- `bpm`: one number (`ui/state.tsx:79`). Clamped 40 to 200 where it is set (`ui/views/GuitarView.tsx:1620`).
- `meter`: the song's time signature (`ui/state.tsx:113`).
- `mix`: volume in dB, mute, solo per track id (`audio/mix.ts:12-20`, `ui/state.tsx:101`).
- `tracks`: the added rows (`ui/state.tsx:103`). The first chords, melody and drums tracks are
  **not** in this list; they are implied, with the fixed ids `"chords"`, `"melody"`, `"drums"`
  (`allTracks`, `song/tracks.ts:133-141`; `isFirst`, `song/tracks.ts:130`).
- `firstHarmony`: the Harmonize record of the first chords and melody tracks, kept here because
  those two have no `Track` row (`song/tracks.ts:106`, `ui/state.tsx:105`).
- `song`: the sections and their order.
- `play`, `loop`: old flags, still stored and fingerprinted, no longer driving playback
  (`ui/state.tsx:80,97`; only read in `song/library.ts:57,104,108`).
- `v`: the storage version (`ui/state.tsx:117`).
- Outside `Progression` but saved with the idea: `key`, `capo`, `tuningId`.

**Per section** (`SongPart`, `song/structure.ts:58-75`, with `Settings` at `:43-52`):

- `id`, `name`, `color` (0 to 7).
- `bars` (1 to 32, `song/frame.ts:9,16`) and optional `meter` of its own.
- First chords track: `chords: ProgChord[]`, and its settings `arrange`, `style`, `feel`, `sound`.
- First melody track: `melody: Melody`, and `tuneSound`.
- First drums track: `kit` (machine, each drum's sound, effects) and `groove` (rhythm, swing, on/off).
- `layers`: every added track's `Layer` here, keyed by track id.
- `tones`: the instrument (Guitar, Piano, Synth and its settings) of every chords and melody track
  here, keyed by track id (`Tone`, `Tones`, `audio/tone.ts:29-44`).

**Per track per section** (`Layer`, `song/tracks.ts:115-125`): an added chords track's `chords`,
`arrange`, `pattern`, `feel`, `sound`; an added melody's `melody`, `tuneSound`; an added drums
track's `beat` (rhythm and kit together, `audio/beats.ts:93-121`). A track is "in" a section only
when that section has a `layers` entry for it (`inSection`, `song/tracks.ts:266`).

**Per track for the whole song**: `Track.name`, `kind`; the mixer entry; the Harmonize record
(`harmony`, `role`, `replaces`, `replacesIn`, `song/tracks.ts:53-60`). **Vocal tracks only**:
`input` (1 or 2), `fx` (the vocal chain), `takes`, `active`, `clips` (`song/tracks.ts:45-52`).
Vocal tracks already run across the whole song and already have one effects chain per track.

**Per app, not per song** (`AppState`): `settings` (tuning, capo, left-handed, labels, theme),
`shapes` (the chord shape chosen for each chord, by tuning and capo, `ui/state.tsx:159,645`),
`myBeats`, `myKits`, `mySounds` (the user's libraries), `clip` (clipboards), `studio` (recording
setup, including the timing `nudge`), `view` (bars on screen, Follow), `canvas`, `pane`, `ideaId`,
`draft`, `tombs`, `saved`.

Note that `shapes`, `tuningId` and `capo` change **what notes a guitar chord plays**. They sit
outside the song, so the same stored song can sound different on another device.

### 1.3 The content types

- `ProgChord` (`ui/state.tsx:60-75`): `id`, `ref` (root, type, bass), `beats` (0.5 to 16 in half
  beats, `:379-381`), optional `voicingId` (a pinned guitar shape), `rest`, `notes` (exact MIDI
  notes written by Harmonize, 36 to 96, `reviveNotes`, `song/chordnotes.ts:32-36`).
  Chords are a **run with no gaps**: a chord's position is the sum of the lengths before it.
- `Melody` (`song/melody.ts:22-30`): `div` (grid), `bars`, `notes: { at, midi }[]`, `on`. `at` is in
  **twelfths of a beat from the start of the section** (`TICKS`, `:13`). A note has **no length**:
  it sounds until the next note. Stored notes may be MIDI 24 to 108 (`:178`); the grid shows only
  two octaves from the key's home note (`melodyBase`, `melodyRows`, `:117-135`).
- `Beat` (`audio/beats.ts:93-121`): rhythm (`steps` per bar, `div` steps per beat, `bars` in the
  pattern, `swing`, `rows` one string per drum) **and** kit and effects in the same object. It is
  split in two for storage on a section: `Groove` and `DrumKit` (`audio/beats.ts:386-400`).
- `Feel` (`audio/patterns.ts:42-53`): speed, swing, touch, spread, octave of a playing style.
- `HarpSound` (`audio/rack.ts:73`): the string settings plus the whole effects chain of a chords
  or melody track.
- `Tone` (`audio/tone.ts:29-43`): which instrument, and the piano's or the synth's own settings.
- `ArrangeSettings` (`ui/state.tsx:120-126`): where on the neck a guitar track's chords are arranged.
- `Take` and `Clip` for audio: see section 5.

### 1.4 The live copy, and "focus"

The page never edits a section in place. The selected section is **copied onto the top level** of
`Progression` (`chords`, `melody`, `bars`, `layers`, `pattern`, `feel`, `sound`, `tuneSound`,
`beat`, `tones`, `arrange`) by `show` (`song/structure.ts:178-181`) and written back by `commit`
(`:154-163`) whenever another block is chosen, or the song is played, saved or exported.

On top of that, each page edits **one track of its kind**. `focus` (`song/tracks.ts:127`,
`ui/state.tsx:109`) says which. When an added track is "brought forward", its content is swapped
into the top-level fields and the first track's content waits in `layers` under the kind's own
name (`refocus`, `song/tracks.ts:230-250`; `normalize` undoes it, `:210-222`). `focusIn` remembers
the focus per section (`song/structure.ts:668-678`). Almost every change is wrapped in `settled`
(`song/tracks.ts:258-263`) so it runs on the un-swapped song.

Neither `focus` nor `focusIn` is part of a saved idea (`ui/state.tsx:250`, `song/library.ts:33`),
and storage always gets the normalized song (`ui/state.tsx:413`).

This copy-and-swap machinery is the hardest part of the current model to reason about. A composer
that opens one clip by id needs none of it.

---

## 2. How a song becomes sound

### 2.1 The chain

1. **State to sections.** `sections(prog)` (`song/structure.ts:430-440`) gives the song in playing
   order, each block with its part's content and settings.
2. **Sections to plan.** One `useMemo` in the main view builds the plan
   (`ui/views/GuitarView.tsx:204-307`). It returns
   `{ items, map, parts, lengths, any, per }`:
   - `items: PlayItem[]`: the whole song, flat.
   - `map: { block, idx }[]`: for each item, its section and which chord it is.
   - `per: SecPlan[]`: each section on its own (`SecPlan`, `:1280`).
   - `parts`: sections with their chord shapes, for the text sheet (`SongPlan`, `:1887`).
   Guitar shapes and keyboard voicings are worked out here (`voicingsOf`, `keysVoicings`), so the
   plan is the first place where a chord has actual notes.
3. **Plan to play list.** `playList` (`:345-350`) is the whole plan, or the looped bars cut out of
   it by `sliceLoop` (`:327-343`, using `sliceItems`, `song/frame.ts:100-110`).
4. **Play list to the player.** `ProgressionPlayer` (`audio/synth.ts:406`):
   `start(items, bpm, pattern, loop, beat, fromIndex)` (`:521`, called at
   `ui/views/GuitarView.tsx:632`), then on every later render one of `update` (`:586`, same shape),
   `relist` (`:618`, shape changed, go on at once) or `queue` (`:668`, loop changed, take over at
   the end of the section playing). The choice is made at `ui/views/GuitarView.tsx:541-570`.
5. **The player books sound** a quarter of a second ahead (`schedule`, `audio/synth.ts:698-782`):
   chords through `playChord` (`audio/trackplay.ts:78`) on a `TrackVoice` found by `voiceFor`
   (`audio/synth.ts:74`); melodies a twelfth of a beat at a time (`scheduleTune`, `:785`); drums
   step by step (`scheduleDrums`, `:840`, `playStep` in `audio/drumbus.ts:663`); recorded audio
   through `TakeRuns.item` (`audio/takeplay.ts:110`).
6. **Offline.** `renderSong(items, { bpm, pattern, beat, rate, skip, tail, fold })`
   (`audio/synth.ts:975-1110`) walks the same list into an offline context. Used for the WAV
   (`ui/views/GuitarView.tsx:1610`) and for the recording backing
   (`ui/components/VocalsPage.tsx:400`), which is handed to the Rust engine as plain stereo samples
   (`engine_backing`, `src-tauri/src/engine.rs:953`) and looped there. The Rust engine knows
   nothing about sections, tracks or clips.
7. **MIDI file.** `progressionToMidi(items, bpm, …)` (`audio/midi.ts:92`) takes the same list.
8. **Other readers of the list:** `slotsOf` and `keepSlots` (which voices the song needs,
   `audio/synth.ts:122,174`), `prepFor` and `prepareNotes` (notes made ready ahead, `:314,234`).

### 2.2 The smallest unit: `PlayItem`

`PlayItem` (`audio/patterns.ts:233-259`) is **one chord of the first chords track, or one silence,
with a length in beats**. It is the only thing the player, the render and the MIDI writer step
through. Everything else rides on it:

| Field | Meaning |
|---|---|
| `midi`, `beats` | The first chords track's notes for this stretch (empty for silence), and how long |
| `style`, `feel`, `sound`, `tone` | How the first chords track plays here and on what |
| `drums` | The first drums track's `Beat` here |
| `tune` | The first melody track here (`PlayTune`, `:281-289`: melody, bar length, swing, sound, tone) |
| `meter` | Bar length in beats, triplet flag, and the signature (for MIDI) |
| `section` | A section starts here: drums, melody and style count from this point |
| `from` | This item starts this many beats into its section (used when a loop starts part-way) |
| `jump` | The music jumps here (a loop run that does not follow on) |
| `pad` | Not a chord: the silence after a section's last chord |
| `extra` | Everything the **added** tracks play in this item's section (`ExtraPlay`, `:262-272`) |

`ExtraPlay` holds, for one section: `chords[]` (each with `track`, `at` in beats into the
section, `beats`, `midi`, `style`, `feel`, `sound`, `tone`), `tunes[]` (`track` + `PlayTune`),
`drums[]` (`track` + `Beat`), and `takes[]` (`PlayTake`, `audio/takeplay.ts:26-36`: `track`,
`buffer`, `at` in beats into the section and possibly negative, `offset` and `dur` in seconds,
`id`, `joined`).

The player also takes a few outer values: `bpm`, a fallback `pattern`, `loop`, a fallback `beat`
and `tune`. Today the view passes the first drums track's beat and no tune; every item carries
its own (`ui/views/GuitarView.tsx:632`).

**The one idea of time the engine has** is `sectionStart` (`audio/patterns.ts:278`): each item
belongs to a section, and the drum step, the melody tick, the playing-style pattern and the
synth's way of playing are all counted from that section's start. Items of one section form a
"group" (`sectionsOf`, `audio/synth.ts:379-393`). All tracks share that one start point.

### 2.3 Can a free timeline be flattened into `PlayItem[]`? Yes.

The engine does not care where the list came from. The existing tests in `audio/` build
`PlayItem[]` by hand and never touch `Progression`, which is good evidence of the boundary.

What makes it work:

- Added tracks are already "content at a position, on a track id, with its own sound"
  (`ExtraPlay`). Any number of tracks of any kind fit there.
- Recorded audio is already "a buffer at a position, part of it playing" (`PlayTake`), carried
  across item boundaries by `TakeRuns`.
- An item may be a pure silence (`midi: []`), so the list can be a plain time grid.
- `renderSong` and the MIDI writer take the same list, so the WAV, the recording backing and the
  MIDI file follow for free.

### 2.4 What the adapter must output, precisely

Input: the tracks, their clips on the timeline, the song's bar map (time signature per bar),
the tempo, the play range (from the playhead to the end, or the looped stretch), and the app's
guitar settings for voicings.

Output: `{ items: PlayItem[], at: number[], loop: boolean, any: boolean }` where `at[i]` is the
song beat item `i` starts on (it replaces today's `map` of block and chord index).

**The time grid.** One item per bar of the range, each `{ midi: [], beats: <that bar's beats>,
pad: true, meter: { bar, triplet, sig }, extra }`. Reasons for a bar grid: the playhead and
Follow get a mark per bar (`onStep`), an edit is heard from the next bar, a tempo change takes
effect at the next bar, drums re-lock every bar, and a list whose bars did not change keeps the
same "shape" so the cheap `update` path is used (`sameShape`, `song/loops.ts:158`).

**Pseudo-sections.** The engine needs a shared start point per group of items. The adapter cuts
the range into pseudo-sections:

- at every change of time signature (a `PlayTune`, a `Beat` and the style meter each assume one
  bar length), and
- at every bar line that **no note clip crosses** on any track (audio clips do not count), and
- if a pseudo-section would still be longer than a chosen limit, at the bar line crossed by the
  fewest clips.

The first item of a pseudo-section gets `section: true`. For a song converted from sections this
rule cuts exactly at the old section boundaries, so it plays as it does today.

**Starting part-way.** When playing starts inside a pseudo-section (playhead, or a loop's first
bar), cut the list there and give the first item `from: <beats into the pseudo-section>` and
`section: true`, as `sliceLoop` does today. Do **not** use `start(…, fromIndex)` for this: with
`from`, a chord already sounding at the start point is heard and a recorded clip comes in
part-way (`audio/player.test.ts:86,162`); with `fromIndex` the chord is skipped.

**The loop.** One stretch chosen on the ruler is one cut of the list with `loop: true`. No
`jump` flags are needed (they exist only for loops made of sections that are apart).

**Per pseudo-section, one `ExtraPlay` object** shared by its items:

- `chords`: for every chords clip (and every bass or other note clip that plays chords) that
  overlaps the pseudo-section, each chord as `{ track, at, beats, midi, style, feel, sound, tone }`
  with `at` in beats from the pseudo-section's start, cut at the clip's edges and repeated where
  the clip is looped. `midi` comes from the same voicing code the plan uses today
  (`playedNotes`, `keysVoicings`, guitar shapes; `ui/views/GuitarView.tsx:246-250`).
- `tunes`: per melody or bass track **one** `PlayTune` whose `Melody` holds every note of every
  clip of that track in the pseudo-section, with `at` rewritten to ticks from the
  pseudo-section's start, `bars` set to the pseudo-section's bars, `bar` its bar length.
- `drums`: per drums track **one** `Beat`: the track's kit, and `rows` written out step by step
  for the whole pseudo-section (`steps` = all its steps, `bars: 1`), so the pattern position no
  longer depends on where the pseudo-section starts.
- `takes`: per audio clip a `PlayTake` with `at` in beats from the pseudo-section's start
  (negative when the clip began earlier), `offset` and `dur` in seconds, `id` the clip id.
  This is what `layClips` (`song/clips.ts:296-321`) produces today, per section.

**The first-track channels stay empty.** `midi: []`, `tune: null`, `drums` unset, and the player's
fallback `beat` null. Two rules follow from how the engine treats the three old ids:

- A track whose id is `"drums"` must **not** be put in `extra.drums`. The live player would
  ignore it (the first lane already has that key, `audio/synth.ts:773-774`, `beatOf` `:510-514`)
  while the render would play it (`:1061`). Either route that track through `item.drums`, or give
  the first three tracks new ids when converting (then `mix`, harmony records and `tones` must be
  re-keyed too).
- Ids `"chords"` and `"melody"` work in `extra` but get "first track" treatment in a few places
  (`isFirstTrack`, `audio/synth.ts:65`; `keepSlots` never drops them, `:177`). Simplest is new ids.

**Object sharing.** Sounds, tones and beats that are equal must be the **same object** across
items (the plan does this with `one()`, `ui/views/GuitarView.tsx:230-235`). The engine keys voices
by track, tone and sound (`slotOf`, `audio/synth.ts:56`) and re-syncs a drum desk when the `Beat`
object changes (`syncLane`, `:904-911`). With one sound per track there is then exactly one voice
per track, which is cheaper than today.

### 2.5 Where the shared start point still leaks (adapter limits)

1. **Chord playing styles.** A style's pattern position is `at` beats from the pseudo-section's
   start (`styleNotes`, `audio/patterns.ts:108`, called with `c.at` at `audio/synth.ts:760`). For
   one-bar patterns this only needs bar alignment. It matters for the 7 of 147 styles written
   over more than one bar, and for any style at half speed (`feel.speed: 0.5`, `:113-118`): those follow
   the bar count of the pseudo-section, not of the clip. Accept that, or add one optional field
   (a pattern start per chord) to `ExtraPlay.chords`. That would be a two-line engine change.
2. **Swing and grid per drum track.** A `Beat` has one `div` and one `swing`. Two drum clips on
   one track with different grids or swing cannot share a flattened `Beat`. Either make swing and
   grid a setting of the track, or force a pseudo-section cut between such clips.
3. **Whose swing the others follow.** Today a 16th-note chord style and the melody follow the
   swing of the **first drums track of the section** (`meterOf(item.drums …)`,
   `audio/patterns.ts:227-231`; `ui/views/GuitarView.tsx:282`). With several equal drum tracks a
   rule is needed (for example: the top drums track with a clip there). To feed it to chord
   styles without touching the engine, `item.drums` can carry a silent beat (`on: true`, empty
   rows, noise off) that only supplies `div` and `swing`.
4. **Held notes stop at a pseudo-section's end.** On the piano and the synth a melody note is
   held until the next note "and never past the section's end" (`playTuneNote`,
   `audio/trackplay.ts:167-170`). A synth's arpeggio or drone is worked out per section
   (`synthSection`, `:54`). So every forced cut is audible on those instruments. Cut only where
   nothing crosses.
5. **Length limits.** `melodyBars` and `inBars` clamp a melody to 32 bars
   (`song/melody.ts:14,40,75`); past that `tuneBetween` wraps round (`:147-160`). So a
   pseudo-section must stay at 32 bars or less, or that clamp must be lifted for play-time
   melodies. Cost also argues for a limit: `tuneBetween` scans every note for every twelfth of a
   beat, and `prepFor` runs it for every item (`audio/synth.ts:320-333`).
6. **A loop change while playing.** `queue` waits for the end of the *section* playing
   (`atBoundary`, `audio/synth.ts:674-677`). With long pseudo-sections that could be a long
   wait. For a ruler loop use `relist` (goes on at once) or restart; do not use `queue`.

None of these needs an engine change to ship a first version. Points 1 and 5 are the two places
where a very small engine change would remove a limit.

---

## 3. Everything that assumes sections

"Block" is one step of the song; "part" is the section's content. Things keyed on either:

| Feature | Where | Keyed on | On a free timeline |
|---|---|---|---|
| The live copy of the selected section | `show`, `commit`, `song/structure.ts:154-181` | `song.current` | Gone. A composer opens one clip by id |
| Focus: which track a page edits, remembered per section | `song/tracks.ts:210-263`, `song/structure.ts:668-678` | part id | Gone. The selected track and the open clip replace it |
| Add, repeat, remove, move, rename, colour, unlink a section | `song/structure.ts:217-327`, `ui/components/FrameSections.tsx:97-109,234,365,428` | block, part | Add, duplicate, delete, move a **clip**. "Repeat" as linked copies goes away (copies are separate) |
| Letters A, B, C in playing order | `letterAt`, `playOrder`, `letters`, `song/structure.ts:93-103,449-462` | part | Gone, or optional ruler markers. Old names can become markers |
| Section length in bars | `setSectionBars`, `song/structure.ts:268`; `song/frame.ts` | part | A clip's length; the song's length is where the last clip ends |
| Per-section time signature | `SongPart.meter`; `setSectionSig`, `retime`, `song/unity.ts:128`, `song/structure.ts:335-369` | part | A bar map on the ruler (signature changes at bar N), or one signature per song. See section 4 |
| Per-section instrument, effects, style, kit | `Settings`, `tones`, `Layer` | part × track | One chain per track. See risks |
| "All sections" (copy a track's sound to every section) | `soundToAll`, `sectionsWith`, `song/structure.ts:606-639`; `ui/views/GuitarView.tsx:455-474` | part | Not needed: the sound already belongs to the track |
| A track being "in" a section, the faint + on the Track page | `inSection`, `addTrackHere`, `addTrackTo`, `removeHere`, `prune`, `freeRows` (`song/tracks.ts:266-420`, `song/structure.ts:642`) | part | Gone. A track simply has clips or not. An empty track stays (no pruning) |
| Copy and paste one page (chords, melody, drums) | `song/clip.ts:125-169` | section on screen | Copy and paste a clip |
| Copy and paste a whole section | `copySection`, `pasteSection`, `song/clip.ts:178-331`; `clipSource` `:201` | block, part, idea | A time-range copy across tracks (later), or dropped |
| Paste undo | `PasteUndo`, `undoFits`, `song/clip.ts:349-364` | block + track | Keyed on clip id, or one general undo |
| Undo after a change | `undoTo`, `song/structure.ts:693-698`; used at `ui/views/GuitarView.tsx:465`, `ui/components/HarmonyPicker.tsx:178`, `ui/components/FrameSections.tsx:161` | keeps section on screen | Keep the pattern (whole song before and after, offered while `sameMusic` holds) without the "stay on this section" part |
| Vocal edit undo | `UndoStep`, `popUndo`, `song/clips.ts:245-255` | track | Unchanged |
| Loop by bars of sections | `LoopBars`, `song/loops.ts`; `BarRef`, `LoopSpan`, `tapLoop`, `song/frame.ts:113-183`; state `chosen`, `ui/views/GuitarView.tsx:310-350` | block + bar | One range in song bars, set by dragging on the ruler. Not stored today (component state); can stay unstored |
| Loop change while playing | `entryOf`, `placeAfter`, `sameShape`, `song/loops.ts:104-195` | block | Simple arithmetic on song beats |
| The strip of sections with the loop buttons | `Transport`, `ui/views/GuitarView.tsx:1419-1500` | block | The ruler |
| Bars on screen, page turning, Follow | `song/window.ts`; `followTo`, `ui/views/GuitarView.tsx:502-526,621-630` | section's bars | The timeline scrolls and zooms; Follow scrolls it. A composer can keep the bar window over its clip |
| "Show the section being worked on" | `showSection`, `song/window.ts:112` | section | Scroll to the selected clip |
| Where the music is | `position()` gives beats into its section, `audio/synth.ts:499`; `getPos`, `getSpot`, `getBar`, `getWhere`, `ui/views/GuitarView.tsx:744-803` | block via `map` | Song beat = `at[index]` + beats into the pseudo-section |
| The lit chord in the tray | `now: { block, idx }`, `ui/views/GuitarView.tsx:629,769` | block + chord index | Worked out from the song beat and the open clip |
| Canvas: one painting per section, its colour | `Spot.key` = part id, `canvas/layout.ts:12-24` | part | Needs another key: the pseudo-section, a ruler marker, or a fixed number of bars |
| Harmonize: sources, where it wrote, "changed by hand" | `HarmonyOf.marks` by part id, `song/tracks.ts:69-104`; `partHere`, `chordsUnder`, `harmonySources`, `seedOf`, `harmonyState` (`song/harmony.ts:79-136,214,533`) | part | Marks keyed by clip id; the source is "what the other track plays under this clip's bars" |
| A harmony that plays instead of chords, per section | `insteadHere`, `insteadIn`, `replacesIn`, `song/tracks.ts:487-523` | part | A muted clip, or dropped |
| Recorded takes are placed in a section | `Take.at: { block, bar }`, `song/takes.ts:22` | block | An absolute bar on the timeline. See section 5 |
| The Vocals lane's bars | `RecordPlan.bars`, `ui/components/VocalsPage.tsx:25-38`; `ui/components/TakeLane.tsx:198-210` | block + bar | Song bars |
| What a recording goes round | `recordPlan`, `ui/views/GuitarView.tsx:696-715` | loop or section on screen | The ruler's loop range (or the clip being recorded into) |
| Which section a time signature mismatch is reported for | `ui/views/GuitarView.tsx:1636` | block | Bar map lookup |
| "Is the idea changed", "is the music the same" | `fingerprint`, `sameMusic`, `song/library.ts:55-72` | parts and blocks | Rewrite over tracks and clips |
| An idea's one-line summary | `describeIdea`, `song/library.ts:86-90` | section labels | Track names or bar count |
| The text chord sheet and MIDI names | `ui/views/GuitarView.tsx:1555-1600` | `plan.parts` | Per track, by bars |
| Key change of the whole song | `mapAllChords`, `mapAllMelodies`, `song/structure.ts:487-508` | every part and layer | Every clip |
| Time signature fitting of everything | `conform`, `mapSong`, `song/unity.ts:20-95`; run on **every** state change (`ui/state.tsx:271-274,392`) | every part | Every clip, or dropped if clips keep their own grid |
| Legacy "write repeats out in full" | `settle`, `song/structure.ts:532-549` | part | Only inside the old-song reader |

---

## 4. Time

- **Beat.** The pulse the tempo counts: a quarter note in x/4, a dotted quarter in x/8
  (`song/meter.ts:8-9,30`). So 6/8 is two beats to the bar.
- **Time signatures.** Nine are offered (`TIME_SIGS`, `song/meter.ts:21-24`). The song has one
  (`Progression.meter`); a section may have its own (`SongPart.meter`). `sectionSig`
  (`song/unity.ts:69`) is the single source of bar length for a section. So **yes, sections can be
  in different signatures**, and the playback list already handles it per item (`PlayItem.meter`),
  as does the MIDI clock (`clockOf`, `audio/midi.ts:59-76`).
- **Bars.** A section is 1 to 32 whole bars (`song/frame.ts:9-22`). Sections can each have a
  different length. Chords play once and are cut at the section's end (`inFrame`,
  `song/frame.ts:41-50`); a melody has every bar of the section (`inBars`); a drum rhythm shorter
  than the section comes round again inside it (`audio/synth.ts:879`).
- **Positions.** Chords: lengths in beats, half-beat steps. Melody: twelfths of a beat from the
  section start. Drums: steps, `div` per beat, counted from the section start. Vocal audio: an
  anchor bar plus frames (seconds), see section 5.
- **Tempo.** One `bpm` for the whole song. No tempo map. The player takes a new tempo from the
  next item on (`update`, `audio/synth.ts:586-609`). Recorded audio does not stretch: a take keeps
  the tempo it was sung at as a note only (`Take.bpm`, `song/takes.ts:27-28`), and its position
  after the anchor bar is in seconds, so it drifts against the grid if the tempo changes later.
- **Other limits that matter for clips:** a chord is at most 16 beats (`ui/state.tsx:380`), a
  melody at most 32 bars (`song/melody.ts:14`), a drum pattern at most 32 bars
  (`audio/beats.ts:383`).

For the timeline this means the ruler needs a **bar map** (which signature each bar has) if old
songs with mixed signatures are to convert without change. A song in one signature is the
trivial case of the same structure.

---

## 5. Vocals: recorded audio as it is placed today

Audio clips already exist, and they are the closest thing in the app to the target model.

- **A recording** is one file from the first count-in click to Stop. The Rust engine plays the
  rendered backing round and round and reports `Recorded` (`song/takes.ts:39-53`): file paths
  `dry` and `wet`, `rate`, `frames`, `offset` (the round trip), `count_in`, `loop_frames`.
- **Takes.** `cutTakes` (`song/takes.ts:60-72`) cuts the file into one `Take` per time round the
  loop. A `Take` (`:7-36`) has `id`, `n`, `group` (its recording), the two file paths, `rate`,
  `start` and `frames` within the file, **`at: { block, bar }`** (the section and bar the loop
  started on), `short`, `keep` (the ★), `sound` (a tag of the vocal chain the wet file was made
  with), `bpm`, `key`, `sig`, `nudge`.
- **Nudge.** `Studio.nudge` (milliseconds, per computer, `ui/state.tsx:200-201`) is folded into
  each take's `start`; `renudge` moves existing takes when it changes (`song/takes.ts:75-105`).
- **Clips.** A vocal track plays `clips` (`song/clips.ts:19-28`): `{ id, take, from, to, move }`,
  all in frames of the take. `from..to` is the stretch of the take; `move` is how far it was
  dragged from where it was sung. Trim, split, move, delete, comp (swap in another take of the
  same recording), "Use", delete a take, add a recording with punch-in are all pure functions
  (`:114-240`). A track saved before clips existed gets one whole clip per recording
  (`migrateClips`, `:51-58`). `placedClips` (`:64-70`) pairs each clip with its take.
- **Where a clip lies in the song.** `layClips` (`song/clips.ts:296-321`): section start in
  beats + `take.at.bar` × bar length + the clip's start in seconds turned into beats at the
  current tempo. A clip that runs across sections is listed in each one it reaches. A clip whose
  anchor bar no longer exists (section made shorter) is silently left out and comes back if the
  bar does (`:309-310`).
- **Playing.** The plan loads the take's buffer (`audio/takebuffers.ts:28-58`, only on the
  desktop app) and emits `PlayTake`s (`ui/views/GuitarView.tsx:220-227,257-260`). `TakeRuns`
  (`audio/takeplay.ts:98-235`) makes sure each clip is heard once, in place, with short fades,
  across item boundaries, loop turns and live edits.
- **Effects.** The vocal chain is `Track.fx` (`audio/vocalfx.ts:10`), one per track. It is **not**
  run live at playback: the Rust engine writes a `wet` file when the recording stops
  (`engine_stop(fx)`) and again on "Apply sound" (`fx_render`). Playback reads the wet file
  straight into the track's fader. Live monitoring through the chain exists while recording.
- **Input.** `Track.input` is 1 or 2 (`song/tracks.ts:45-46`); the engine takes an input index
  (`engine_set`, `src-tauri/src/engine.rs:945`) and reports how many inputs the device has
  (`EngineOpened.inputs`, `desktop.ts:86`).
- **Copies share files.** Pasting a section makes new takes that point at the same files; nothing
  is copied or deleted on disk (`song/clip.ts:273-293`).

For the timeline: replace `at: { block, bar }` with an absolute song bar; `layClips`, `clipBars`,
`sameSpot` (`song/clips.ts:41`) and the lane helpers then lose their section argument. Keep the
"anchor bar plus frames" form so placement stays sample-exact, as the tests require.

---

## 6. Storage and versions

- **Where.** One JSON blob in `localStorage` under `"m-theory-state-v1"` (`ui/state.tsx:214`),
  the whole `AppState`, rewritten on every change (`:402-419`) with the song normalized.
- **Loading.** `load()` (`ui/state.tsx:279-308`) → `reviveProgression` (`:240-268`) →
  `migrateSong` on the raw JSON (`song/migrate.ts:86-92`) → the `revive…` functions make every
  field safe → `conform(settle(prune(commit(p))))`.
- **The library.** `saved: SavedProgression[]` in the same blob. Each idea goes through
  `reviveIdea` (`song/library.ts:93-117`), which also calls `migrateSong`. This happens for
  **every** saved idea at load (`ui/state.tsx:298`), on cloud merge, on import, and on open.
- **Saving an idea.** `snapshot` (`song/library.ts:31-35`) commits and normalizes; `fingerprint`
  (`:55-61`) decides whether the idea changed. `saveIdea`, `openIdea`, `newIdea`
  (`ui/state.tsx:506-547`).
- **Cloud.** Only when the app runs as a hosted page. One document per idea at
  `data/users/<viewer>/idea_<id>` holding `{ updatedAt, deleted, json }` (`connectCloud`,
  `ui/cloud.ts:46-71`). `mergeIdeas` (`song/library.ts:140-166`): the newer copy wins, a deletion wins
  over older copies (`tombs`). `toPush` (`:169-174`) sends what is missing.
- **Two tabs.** `joinOtherTab` (`ui/othertab.ts:33-60`) merges the library the same way.
- **Backup file.** `exportIdeas` writes `{ app: "m-theory", version: 1, ideas }`; `importIdeas`
  reads it through `reviveIdea` (`song/library.ts:178-190`).
- **Clipboards.** `AppState.clip` (`Clips`, `song/clip.ts:104-109`), revived by `reviveClips`
  (`:388-421`); an old section clipboard is moved over by `migrateSectionClip`
  (`song/migrate.ts:243-255`).
- **Audio files** are referenced by path in `Take.dry` and `Take.wet`. They are never embedded.
- **Version.** `Progression.v`, written as `SOUND_V = 4` (`song/migrate.ts:35`). (The unrelated
  `Settings.v = 3` is for app settings, `ui/state.tsx:223`.)

**The existing migration pattern** (`song/migrate.ts`):

1. It works on **raw JSON, before revive**, and returns the same type.
2. It is gated on the version: `v >= SOUND_V` returns the input untouched (`:89`).
3. It is staged: no version or 2 → `toSections` (`:109-235`); then `arrangeEverywhere` (`:98-106`)
   for anything below 4; then `v` is stamped.
4. It is safe to run twice (tests under "moved over once", `song/migrate.test.ts:204`).
5. Its goal is stated as "an old song sounds as it did", and tested per section.

**What a version 5 step with a backup has to add:**

- The conversion needs the song *as it plays* (repeats written out, drums fitted to their bars,
  a signature inferred for very old songs). Those steps run on the revived song, not on raw JSON
  (`settle`, `conform`, `inferSig`). So convert **after** the full version 4 load, from a typed
  version 4 `Progression`, and keep today's `structure`, `tracks`, `unity`, `migrate` code as a
  frozen "old song reader".
- `migrateSong` cannot make the backup: it sees one song and has no access to the library. The
  backup must be made where the library is in hand: in `load()` for the blob, and wherever
  `reviveIdea` feeds the library (cloud merge, other tab, import).
- Give the backup a **stable id derived from the original** (for example the idea's id plus a
  fixed suffix). Then two tabs, two devices and repeated loads all produce the same backup once,
  and a backup the user deleted stays deleted (its tombstone matches).
- The open idea that was never saved has no library entry. Its backup needs one made for it.
- Backups hold the version 4 JSON untouched. They must be **skipped by the converter** (a flag on
  the saved idea), or they will be converted too on the next load.
- **Old app versions must not read version 5 songs.** An older build treats `v >= 4` as "already
  current" and its revive functions drop what they do not know, so it would open a converted song
  as nearly empty and could save that back (newer copy wins in the cloud and across tabs). This
  affects the phone web build and any desktop install not yet updated. Safest: store new songs
  under a new storage key and a new cloud document prefix, leaving the old ones in place.

---

## 7. Invariants the tests rely on

109 test files, about 1,280 tests. The ones that touch this model:

### Keep unchanged (the engine contract)

These build `PlayItem[]` by hand. If the adapter is the only new code on the audio side, they
should pass without edits; any edit needed is a sign the engine was changed.

- `audio/player.test.ts`: a loop on its second bar hears the chord that started in the first; a
  chord is cut at the loop's end; the recording backing does the same as live; first notes are
  ready before the clock starts; a take stops where the loop ends; each way a track is played has
  its own voice and equal ways share one; a knob turned never makes a new voice; noise beds
  follow the section playing; late hits are not piled up.
- `audio/relist.test.ts`, `audio/loopswitch.test.ts`, `audio/songend.test.ts`: the list changing
  shape or loop while playing; the end of a song that does not go round.
- `audio/clipplay.test.ts`, `audio/takeplay.test.ts`, `audio/takechain.test.ts`: recorded clips
  play exactly their stretch, to the sample; fades; split pieces are one sound; live edits; a
  take is heard on the beat it was sung on.
- `audio/rendertime.test.ts`, `audio/trackvoice.test.ts`, `audio/trackplay.test.ts`,
  `audio/midi.test.ts`: the offline render, the synth's way of playing, MIDI export including a
  signature per section and an instrument per section.

### Keep, with their section argument removed

- `song/takes.test.ts`: cutting a recording into takes, the count-in, the nudge, the ★, the click
  across meters (`clickPlan`), `barsInto`.
- `song/clips.test.ts`: trim, split, move on the 1/16 grid (and in 6/8), comp, Use, delete,
  punch-in, undo per track; "laid in the song across sections, sample-exact" becomes "laid on
  the timeline, sample-exact"; a clip whose bar is gone is left out, not moved.
- `ui/components/takelane.test.ts`, `ui/components/trackadd.test.ts`.
- `song/meter.test.ts`: fitting a rhythm, a chord length and a melody to another signature.
- `song/melody.test.ts`: tap in and out, grids, bars; "shows two octaves from the home note" is
  to be **replaced** by the wide range for bass.
- `song/library.test.ts`: newer copy wins, a deletion beats older copies, unreadable copies are
  ignored, only missing ideas are sent, backups round-trip. Its "what counts as a change" cases
  are rewritten for clips.
- `ui/othertab.test.ts`, `ui/latest.test.ts`, `robustness.test.ts`.

### Keep as they are, for the old-song reader

- `song/migrate.test.ts`: songs with no version and version 2 and 3 arrive at version 4 with
  every section sounding as it did; running twice changes nothing. Version 5 conversion tests are
  added after these, starting from their outputs.
- `song/unity.test.ts`, the "songs from before sections had lengths" block of
  `song/frame.test.ts:215-270`: old songs get a signature and lengths.

### Replace on purpose (they describe sections)

- `song/structure.test.ts`, `song/sections.test.ts`: letters, repeat, unlink, move, remove,
  per-section signature, copy and paste a section.
- `song/sectiontracks.test.ts`: tracks per section, settings per section, "All sections", focus
  per section, a harmony that plays instead of chords per section.
- `song/tracks.test.ts`: bring a track forward, the first track kept safe, pruning.
- `song/clip.test.ts`, `ui/openidea.test.ts`: page clipboards and the section clipboard's source.
- `song/loops.test.ts`, the looping block of `song/frame.test.ts:272-380`: loops by section bars.
- `song/window.test.ts`: bar windows and page turning (may stay for use inside a composer).
- `song/harmony.test.ts` (46 tests): the harmony engine itself is unaffected, but every test that
  reads or writes `marks` by section must move to clips.

### Rules worth carrying into the new model whatever its shape

- A converted song sounds as it did (the standing rule of every migration so far).
- Loading twice changes nothing; an idea just opened is not "changed".
- What is on screen is the newest copy and is never overwritten by a stored one.
- Anything broken in storage is dropped quietly, never thrown on.
- Which clip or track is selected, and view settings, are not part of the idea.
- Recorded files are never copied, cut or deleted by an edit.
- An undo is offered only while nothing else has changed since.

---

## Risks for a free-timeline model

1. **Sound per section becomes sound per track.** Old songs can play one track on the piano in
   one section and the guitar in the next, with different effects, styles or drum kits. One chain
   per track cannot hold that. Options: split such a track into one track per distinct sound when
   converting (nothing lost, more rows), or keep an optional per-clip override (the engine
   already supports it), or pick one and accept the change. Playing style, feel and neck area are
   arguably part of the composition and can stay on the clip.
2. **Old app versions can damage version 5 songs** through cloud sync, a second tab or an
   un-updated install (section 6). Use a new storage key and document prefix.
3. **The backup must be made exactly once** across tabs and devices, and must not itself be
   converted. Stable ids and a flag.
4. **Linked repeats disappear.** Today a repeated section is one piece of music; converted, each
   repeat is a separate clip. That matches the chosen rule, but a fix made in one chorus no
   longer reaches the others.
5. **One shared start point per pseudo-section** (section 2.5): multi-bar and half-speed styles,
   swing and grid per drum track, held notes at forced cuts, and the 32-bar melody clamp.
6. **The three reserved ids** `"chords"`, `"melody"`, `"drums"` get special treatment in the
   engine; a track with id `"drums"` in the wrong channel plays in the WAV but not live.
7. **Which drum track sets the swing** for chord styles and melodies needs a rule now that no
   drums track is "the first".
8. **Mixed time signatures** need a bar map on the ruler, or old songs with a section in another
   signature cannot convert unchanged. Clip lengths and the grid then depend on where a clip sits.
9. **Tempo changes move recorded audio** against the grid (it is anchored at a bar and then runs
   in seconds). This is true today but far more visible on a timeline with a ruler.
10. **Vocal effects are baked into files**, not run live at playback. A "plugin window" for a
    vocal track changes the sound only after a re-render of its takes. The blank audio track
    inherits this.
11. **Takes whose section or bar is gone** are hidden today and can come back. Conversion must
    decide: keep them unplaced, or drop them.
12. **Harmonize records are keyed by section** (what was written where, and whether it was
    changed by hand). They must be re-keyed to clips or the "write again" and "changed by hand"
    checks break. A harmony that plays "instead of" chords in a section needs a clip-level meaning.
13. **The canvas paints one picture per section** in that section's colour. It needs a new unit.
14. **Performance of long flat songs.** The plan is rebuilt on most state changes and `conform`
    runs on every change. Flattening a long timeline (drum rows written out, melodies merged)
    on every keystroke may be slow; build per track and reuse unchanged pseudo-sections.
15. **Guitar shapes live outside the song** (`shapes`, tuning, capo). Unchanged by the rework, but
    it means "the same clip" can play different notes on another device.
16. **Chords have no gaps and melody notes have no length.** Fine inside a composer, but a chords
    clip is a run from its start, and a bass line written in the melody composer cannot have
    short and long notes unless note length is added.
17. **Phone web build.** Recording, take playback and the vocal chain exist only in the desktop
    app. The timeline must degrade the same way the Vocals page does today.
