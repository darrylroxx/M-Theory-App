# Map: audio engine and recording input (as the code is today)

Read-only study of `/home/user/M-Theory-App` at commit 0f436e9. Paths are relative to the repository.
"Web side" = `src/` (Web Audio, runs in the browser and inside the desktop app's window).
"Rust side" = `src-tauri/src/` (the desktop app's own audio engine, Windows first).

Short version of the five answers:

1. Every chords/melody track has voices (instrument + effects rack) that all end in ONE fader per track id; every drums track has its own drum desk into its fader; recorded takes go straight into their track's fader with no live effects (the vocal sound is baked into a second file by the Rust side). Today the fader is per track but the sound, instrument, drum kit and playing style are per SECTION. Per-track-only is the cheap case the engine already has (one voice per track).
2. The scheduler walks a flat list of chord-length "items" of the FIRST chords track; every other track rides on those items, counted from where its section started. "Position" = item index + beats into the section. A free timeline needs "position" = beats on one song line and per-clip origins instead of per-section origins. The drum, melody and take schedulers are already window-based and adapt; the chord booking and the list-building in the view are the parts tied to sections.
3. There is NO recording in the browser. The desktop engine opens ALL input channels of the interface, but records and monitors ONE mono channel at a time, into one mono file, always round a loop from the loop's start after a count-in. The page only offers Input 1 or 2. No stereo pair, no two tracks at once, no recording from the playhead.
4. See the table in section 4.
5. See section 5; the hard numbers found are few (9-track song: 47.6 % of one core on the audio thread, 63.0 % with the Canvas open; about 10 % of a core left running after stop until tracks "rest"; vocal chain at its heaviest about 5 % of a core; page held up to 120 ms by a page switch).

---

## 1. Signal flow today

### 1.1 One sound context, one master

- One shared context, made with the browser's larger output buffer (`latencyHint: "playback"`, about 20 ms instead of 10): `src/audio/context.ts:19-34`. An offline render swaps the context in with `withContext` (`context.ts:9-17`), so every module below builds the same graph live and in a render.
- `soonest(c)` = clock + `baseLatency` + 3 ms: the first moment a change can still be heard whole; all stop-fades start there (`context.ts:43-48`).
- Master: `master(c)` is one gain per context; everything sums there, then the safety stage (an audio-thread processor with no look-ahead), then `masterOut(c)`, then the speakers: `src/audio/mix.ts:88-124`, crossover to the safety stage `mix.ts:127-144`, the stage itself `src/audio/safety.ts:1-61`, `src/audio/safetycore.ts`, `src/audio/safety.worklet.ts`. Under −1 dBFS it passes bit for bit; it adds no delay (this matters for recording alignment: `safety.ts:14-16`).
- `masterOut` is also where the mix is tapped when the app's sound is sent through the Rust engine (`src/audio/through.ts:118`).

### 1.2 Track id -> bus

- `fader(id, ctx)`: one gain per track id per context, connected to the master; made on first use: `mix.ts:156-170`. Ids: `"chords"`, `"melody"`, `"drums"` for the first tracks, and each added track's own id (`mix.ts:9-10`).
- `sendFader(id, ctx)`: a twin gain that follows the same level/mute/solo, used on the way INTO the shared reverb (`mix.ts:177-192`).
- `setMix(mix)` glides both sets (`mix.ts:195-198`); mute/solo/dB rules `mix.ts:26-54`. The mixer is per track for the whole song (`mix.ts:1-6`).
- Everything a track plays ends in `fader(trackId)`: chords/melody voices (`src/audio/synth.ts:93-94`), drum desks (`src/audio/drumbus.ts:261-263`), recorded takes (`src/audio/takeplay.ts:173`, `takeplay.ts:321`).

### 1.3 Chords and melody tracks: voice = instrument + rack

- `TrackVoice` (`src/audio/trackvoice.ts:152-215`): instrument -> its own input gain -> `rack.input` -> rack -> `out` -> `fader(track)`.
  - Instruments: plucked strings rendered to buffers (`src/audio/plucked.ts`, cache of 96 notes `plucked.ts:14`), sampled piano (64 notes at once, `src/keys/sampler.ts:69`), electric piano (32, `src/keys/epiano.ts:111`), synth (one audio-thread processor per synth voice-object holding 8 voices, `src/synth/instrument.ts:182`). Swapped with a 60 ms fade (`trackvoice.ts:284-338`).
  - Level trims per instrument so a track keeps its place when the instrument changes (`trackvoice.ts:49-53`).
- Rack (`src/audio/rack.ts:1-16`, built in `createRack` `rack.ts:183-508`), in order: compressor ("squeeze") -> saturation -> high-pass + two shelves (tone) -> phaser -> tape wobble -> chorus -> tremolo -> echo (two cross-fed delays) -> pump dip -> volume -> soft ceiling -> out. The rack takes any input node: it is not tied to the strings (`rack.ts:207`, `rack.ts:379-384`).
- Effects at 0 are disconnected, not just silent ("gates": `src/audio/gate.ts`; used at `rack.ts:240`, `251`, `272`, `282`, `310`).
- Reverb is NOT in the rack: the rack's send goes (through its level, the track's fade and `sendFader`) into a room shared by every track with the same kind and size: `src/audio/rooms.ts:1-22`, `enterRoom` `rooms.ts:65-93`, `leaveRoom` `rooms.ts:96-107`; the rack moves between rooms with a crossfade (`rack.ts:347-377`). Room chain: pre-delay 18 ms -> low cut -> convolution -> pump dip -> stop-fade -> master (`rooms.ts:71-86`).
- Pump: every kick dips every live voice's rack and every shared room (`synth.ts:101-113`, kick hook `drumbus.ts:597-599`, `drumbus.ts:654-655`). This is the one cross-track coupling in the graph.
- "Slots": each different way a track is played (track id + instrument + sound) gets its own `TrackVoice`; sections that play it the same way share one (`synth.ts:31-56`, `voiceFor` `synth.ts:74-115`, `slotsOf` `synth.ts:122-135`, `keepSlots` `synth.ts:174-204`). All slots of one track feed the same fader.

### 1.4 Drums tracks: one desk per track

- `src/audio/drumbus.ts:1-19`: each drum -> level -> pan -> dry / reverb send / echo send -> saturation -> the desk's OWN two convolution rooms -> echo -> tape -> tone -> compressor -> volume -> soft ceiling -> `tail` -> `fader(track)`. Desk per track and per context: `drumbus.ts:109-137`, built in `getBus` `drumbus.ts:170-284`, wiring to the fader `drumbus.ts:261-263`.
- Desks are NOT in the shared rooms on purpose (their reverb runs into the desk's compressor): `rooms.ts:20-21`.
- Kit, rhythm, effects and noise bed all live in a `Beat` object; `syncDrums(beat, bpm, track, at)` sets a desk to a beat from a moment on (`drumbus.ts:394`), `setBedPlaying` runs its noise bed (`drumbus.ts:577-592`), `playStep`/`playDrum` play hits (`drumbus.ts:615-672`), `keepDrums` drops desks of removed tracks (`drumbus.ts:289-312`).

### 1.5 Recorded (vocal) tracks

- A take plays as: buffer source -> its own 5 ms edge-fade gain -> `fader(track)` (`takeplay.ts:167-174`). No rack, no room, no pump.
- The "vocal sound" is a Rust chain (`src-tauri/src/fx.rs:95`, `Chain::run` mono in -> stereo out `fx.rs:279`). It is used two ways: live in the headphones while monitoring (`src-tauri/src/engine.rs:522-527`), and offline to write a second file with the sound on it (`src-tauri/src/recfile.rs:142-166`). The song plays that second ("wet") file. Changing the vocal sound later makes takes "stale" until the file is made again (`src/ui/components/VocalsPage.tsx` `applySound`, lines 649-668; `src/song/takes.ts:173-180`).

### 1.6 Other taps

- Each track is tapped after its fader for the Canvas ("stems": `src/audio/stems.ts:47-59`; hooked at `synth.ts:96` and `drumbus.ts:266`). Stem kinds are only chords / melody / drums (`stems.ts:11-12`).

### 1.7 Are effects per track, per section, or both?

Both, today:

- Per TRACK for the whole song: the fader (level, mute, solo) (`mix.ts:1-6`), and a vocal track's chain (`src/song/tracks.ts:47-48`).
- Per SECTION: instrument ("tone"), sound and effects (the rack's knobs), playing style, drum kit + drum effects, and the melody's own sound. The play list carries them on every item: `PlayItem.sound`, `.tone`, `.drums`, `.style`, `.tune.sound/.tone`, and the same on every added track's entry (`src/audio/patterns.ts:233-272`). The view fills them from each section (`src/ui/views/GuitarView.tsx:204-303`, e.g. `sec.sound`, `sec.tuneSound`, `toneOf(sec, id)`, `l.sound`, `drumsIn(sec)`).
- The engine handles "per section" by slots for chords/melody (a voice per distinct way, `synth.ts:31-38`) and by re-setting the one desk at each section start for drums (`synth.ts:904-911`).

What "per track only" means for the engine: every track has exactly one slot, so one voice, which is the case the code calls out as the original and cheapest (`synth.ts:35-36`). Nothing in the engine has to be added for it. The cost is in converting old songs: a track whose sections used different sounds must either become one track per distinct sound (sounds exactly as before, same voice count as today) or keep one of them (changes how the song sounds). That is a conversion rule to decide, not an engine change.

---

## 2. How notes and samples are scheduled

### 2.1 What the scheduler is given

`ProgressionPlayer` (`synth.ts:406-960`). `start(items, bpm, pattern, loop, beat, fromIndex, tune)` (`synth.ts:521-564`):

- `items: PlayItem[]`: a flat list. Each item is ONE CHORD of the first chords track (`midi`, `beats`) and also carries everything else that sounds in its section: the section's drums, melody, sound, instrument, meter, and `extra` = all added tracks (their chords with a start in beats into the section, their melodies, their drums, and the recorded takes lying under the section) (`patterns.ts:233-272`). A section with no chords is a silent filler item (`pad: true`).
- Flags on items: `section: true` (a section starts here: drums, melody and style count from here), `from` (this item starts that many beats into its section: used when a loop starts mid-section), `jump` (the music skips here: takes from before stop) (`patterns.ts:243-256`, `sectionStart` `patterns.ts:278`).
- One tempo for the whole list (`bpm`), one loop flag (the whole list goes round).

The list is built in the view, not in the engine: `GuitarView.tsx:204-303` (whole song), loop slicing `GuitarView.tsx:327-350` using `sliceItems` (`src/song/frame.ts:100-110`), loop choice as a set of bars (`src/song/loops.ts:10-40`, `GuitarView.tsx:310-325`).

### 2.2 What "position in the song" means to it

- Internal: `nextIndex` (which item is booked next), `nextTime` (when, on the audio clock), `passBeat` (beats since the start of this pass through the list), `origin` (where the current section started, in beats of the pass) (`synth.ts:415-418`).
- Reported: `position()` -> `{ index, beat (into its SECTION), gen }` (`synth.ts:498-507`); `onStep(index, gen)` as each item starts (`synth.ts:913-925`). The view turns index into "which section, which chord" with a map (`GuitarView.tsx:613-632`).
- There is no "seconds/beats into the song" anywhere, and no way to start mid-item: play starts at an item index (`fromIndex`, the first item of the section on screen: `GuitarView.tsx:616`).

### 2.3 Timing constants

- Two page timers: book every 25 ms, report every 30 ms (`synth.ts:560-561`).
- Start is 80 ms after ▶ (`synth.ts:556`).
- Look-ahead: everything is booked 0.25 s ahead of the clock (`synth.ts:700`).
- `bookAhead()`: around a page switch the look-ahead is 1 s for 1 s (`synth.ts:398-404`, `ahead` `synth.ts:577-583`, called from `src/ui/App.tsx:49`). Changes made meanwhile are heard that much later.
- Before ▶: pianos and synths are loaded (`readySlots`, 4 s cap, `synth.ts:158-163`; `GuitarView.tsx:594-611`), the first notes are made ready (`synth.ts:545-555`), the Rust engine is closed if it was open (`freeInterface`, `src/audio/handoff.ts:50-56`).

### 2.4 What is booked when

Per item entering the look-ahead window (`schedule`, `synth.ts:698-782`):

- First chords track: ALL notes of the chord at once, on its section's voice (`playChord`, `synth.ts:744-752`, `src/audio/trackplay.ts:78-107`). A chord can be bars long; once booked it cannot be un-booked except by stop.
- Added chords tracks: every chord that STARTS under this item (`synth.ts:754-765`), cut to the loop's edges by `clipChords` (`trackplay.ts:31-39`).
- Recorded takes: `TakeRuns.item` with the stretch this item covers and `until` = where the music runs to without a jump (`synth.ts:766-771`).
- An "anchor" (time, beat, origin, end, index) is pushed for the drums and melody schedulers (`synth.ts:738-741`, `775`).

Then, up to the same horizon:

- Drums: each drums track ("lane") steps through its grid one step at a time, re-locking to every anchor; kit changes are applied when the lane reaches an item whose section has another beat (`scheduleDrums` `synth.ts:840-897`, `syncLane` `synth.ts:904-911`). Edits are heard on the next step.
- Melodies: a twelfth of a beat at a time, each track on its voice (`scheduleTune` `synth.ts:785-830`).
- Synth "ways" (arp, pulse, drone, glide): the whole SECTION's notes are worked out once and cached by section start time, then played stretch by stretch (`trackplay.ts:54-70`, `152-164`).

### 2.5 Loop, section and list boundaries

- Loop = the list ends and `nextIndex` wraps to 0 (`synth.ts:713-722`). Loop edges are therefore item edges; the view makes them by slicing items at bar lines (`GuitarView.tsx:327-343`). A loop of bars that are not next to each other is several runs with `jump` between (`GuitarView.tsx:345-350`).
- Section boundary = an item with `section: true`: origin resets (`synth.ts:726`), groups (`sectionsOf` `synth.ts:379-393`).
- The list changing while it plays, three ways:
  - same shape: `update` (`synth.ts:586-609`), heard from the next chord/step;
  - other shape (bars added/removed): `relist`, goes on at once from the matching place, old bookings keep their own list by `gen` (`synth.ts:618-636`);
  - another loop chosen: `queue`, takes over at the END OF THE SECTION that is playing (`synth.ts:668-696`, boundary test `synth.ts:674-677`).
- End of a song that does not loop: the end is booked as a mark; the player stops when the clock reaches it (`synth.ts:703-719`, `913-925`).

### 2.6 Stop and fades

`stop()` (`synth.ts:927-959`): timers off; takes fade out over 5 ms from `soonest` (`takeplay.ts:221-229`); every voice lets its notes go and fades (its room send too), then "rests" after 2 s (12 s if its echo is on) (`trackvoice.ts:403-430`, `37-38`); drums damp (`drumbus.ts:687-693`); noise beds stop; pump dips are reset.

### 2.7 Late booking

If the page was held up past the look-ahead, a note is not started "now from its beginning": it starts as far into itself as it is late with a 4 ms fade (`src/audio/late.ts:47-62`), only the latest late hit of each drum is played (`synth.ts:843-847`, `887-896`), and a take starts that much further in (`takeplay.ts:157-160`).

### 2.8 Recorded takes inside the scheduler

`TakeRuns` (`takeplay.ts:98-235`) already works on plain time windows: for a stretch `{t, s0, s1, spb, until}` and a list of `PlayTake {track, buffer, at (beats), offset, dur (seconds), id, joined}` it starts what lies under the stretch and is not sounding there yet, part-way in if needed, and stops what the music has left. Re-check on edits while playing: `again` (`takeplay.ts:120-125`, called from `retake` `synth.ts:643-658`). Tests: `src/audio/clipplay.test.ts`, `takechain.test.ts`, `takeplay.test.ts`, `loopswitch.test.ts`.

### 2.9 The render is a second copy of the same logic

`renderSong` (`synth.ts:975-1110`) plays the same item list into an offline context: used for the WAV export (`GuitarView.tsx:1610`) and for the backing the Rust engine plays under a recording (`VocalsPage.tsx:400`). With `fold` (default) what rings past the end is added onto the start, because the engine plays it round and round (`synth.ts:1099-1109`). Anything changed in the live scheduler has to be changed here too.

### 2.10 What must change for clips on a free timeline with a ruler loop

Already fits (keep):

- The look-ahead machinery, `bookAhead`, late starts, stop fades, voices resting, `prepareNotes`/`readySlots`.
- `TakeRuns`: it only needs stretches and takes with a start in beats; nothing in it knows about sections.
- Drum lanes and the melody ticker: both book small windows from an anchor with an origin; the origin only has to become "where this clip (or this repeat of it) starts" instead of "where this section starts".
- `sliceItems` already cuts a list at any beat (not only bar lines), and `from` already means "this starts N beats into its material" (`frame.ts:100-110`, `patterns.ts:255-256`).
- One fader per track id.

Must change:

1. Position. The player needs one song line in beats: start at any beat (the playhead), report beats (for the ruler line), loop between any two beats. Today it has an item index and a per-section beat (2.2).
2. No privileged track. Today items ARE the first chords track's chords, drums re-lock to each of them, and with no chords a filler is invented (`fill`, `synth.ts:456-462`). On a free timeline every track is equal and clips on different tracks start and end at different places. The neutral form is: cut the song line at every clip edge of every track and at the loop edges into spans; each span lists what every track plays there. That is today's `ExtraPlay` made the only way in, with the item's own `midi/sound/tone/drums/tune` no longer special.
3. Per-clip origin. `section`/`from` are on the item, shared by all tracks (`sectionStart`). Each track's entry needs its own origin (the clip's start, and for a clip repeated by edge drag, the start of each repeat) and its own offset into the clip's content (left edge trimmed).
4. Whole-chord booking vs clip and loop ends. A chord is booked whole when it enters the window (2.4). With clips ending anywhere and a loop ending anywhere, chords must be cut at the clip end and loop end before booking (the pattern is there: `clipChords`, `sliceItems`), and synth "ways" must be worked out per clip instead of per section (`synthSection` cache key).
5. Loop change while playing. `queue` waits for the end of the playing section (2.5); with no sections there is no such boundary. Simplest rule: the new loop applies at once and the playhead keeps its beat (both lists are on the same song line, so no place-mapping is needed, unlike today's `entry`/`placeAfter`).
6. Clip repeats. Either expand a repeated clip into N instances when the list is built (no scheduler change), or teach the scheduler modulo. Note for audio clips: `TakeRuns` de-duplicates by clip id inside one stretch (`takeplay.ts:141-143`), so each repeat needs its own id.
7. Per-section things with no home. Time signature is per section today (`PlayItem.meter`, click accents per bar `src/song/takes.ts:144-149`); a ruler with bars needs one meter map for the song line. Playing style and "feel" are per section too.
8. `renderSong` must follow every one of the above (2.9); sharing one "what plays in this span" function between live and render would remove the double work.
9. The list builder in the view (`GuitarView.tsx:204-350`, about 150 dense lines) is replaced by a clips-to-spans builder; this is where most of the risk sits, not in the audio nodes.

A low-risk first step for release 1: keep `ProgressionPlayer` as it is and write an adapter that turns timeline clips into today's `PlayItem[]` (sections become spans; `from` carries offsets). Converted songs then play bit-for-bit as before, because conversion "in the same order" yields exactly the old list. Generalise (points 2-4) only when clips start to overlap section-free.

---

## 3. Recording

### 3.1 Web path

There is none. No `getUserMedia`, `MediaRecorder`, `enumerateDevices` or media-stream source anywhere in `src/` (searched). In the browser the vocal lane is view-only; "everything that touches the interface runs in the Windows app" (`VocalsPage.tsx:88-91`, `src/desktop.ts:1-8`). All desktop calls are loaded lazily behind `isDesktop()`, which is why the web/phone build is unaffected (`desktop.ts:8`, `15-19`).

### 3.2 Desktop path, step by step

Commands exposed to the web side (`src-tauri/src/lib.rs:29`): `audio_devices`, `meter_start`, `meter_stop`, `engine_open`, `engine_close`, `engine_set`, `engine_backing`, `engine_app`, `engine_feed`, `engine_start`, `engine_stop`, `fx_render`, `read_take`, `read_take_range` (+ stems). Web wrappers: `src/desktop.ts:78-162`.

1. Find the interface. `audio_devices` lists every audio system and device with, per direction, the MOST channels it offers and its sample-rate range (`src-tauri/src/audio.rs:8-23`, `45-67`, `70-78`). No channel names. The page keeps devices that have both inputs and outputs, low-latency driver first (`VocalsPage.tsx:218-220`); listing is done once a session and never while the app plays unless needed (`handoff.ts:30-32`, `VocalsPage.tsx:210-217`). Settings sheet shows what was found (`src/ui/components/Desktop.tsx:50-88`).
2. Open. `engine_open(host, device, buffer)` (`engine.rs:803-919`): opens the device's default input and output configurations at the output's default rate (`engine.rs:823-828`), asks the driver for a buffer size if one is chosen (`engine.rs:830-838`; choices 32-512 frames `VocalsPage.tsx:67`, `869`), one input stream + one output stream sharing a `Core` (`engine.rs:839-858`), and a status message about 30 times a second with input levels, position, latency, dropouts (`engine.rs:644-678`, `871-901`). With the low-latency driver, the default input configuration is ALL of the driver's input channels (cpal 0.18.2, `host/asio/device.rs:74-76`), so every input arrives interleaved in every block.
3. Choose input and monitoring. `engine_set(monitor, input, fx, backing_gain, click_gain, click_on)` (`engine.rs:943-949`); sent by the page whenever the track, the knobs or the sliders change (`VocalsPage.tsx:345-349`).
4. Record. `VocalsPage.go(record)` (`VocalsPage.tsx:365-415`):
   - the app's own playback stops (`GuitarView.tsx:960`);
   - the loop (or the section on screen) is rendered offline at the engine's rate, without the track being recorded (`VocalsPage.tsx:400`; plan built in `GuitarView.tsx:696-716`);
   - the whole render is handed over as raw stereo floats (`engine_backing`, `engine.rs:951-960`; held in memory, `Cmd::Backing(Vec<f32>)` `engine.rs:92`);
   - `engine_start(bpm, count_in_beats, beats_per_bar, bars, record, name)` (`engine.rs:1010-1049`): makes a file `Music/M-Theory/Recordings/<track name>-<unix time>.wav`, MONO, 32-bit float (`engine.rs:999-1005`, `1024-1030`), a 20-second queue between the audio thread and a writer thread (`engine.rs:1028`, writer `recfile.rs:44-99`, header refreshed every second).
   - On the audio thread: count-in clicks, then the backing goes round and round (`engine.rs:511-521`, click `420-449`, accents per bar `109-127`); the chosen input is written from the first click (`engine.rs:317-347`).
5. Stop. `engine_stop(fx)` (`engine.rs:1113-1131`) closes the file and makes the second file through the vocal chain (`recfile.rs:142-166`, named `…-wet-N.wav`, stereo). It returns `Recorded {dry, wet, rate, frames, offset, count_in, loop_frames, dropped, padded, note}` (`engine.rs:1051-1068`, `takes.ts:39-53`).
6. Cut into takes. `cutTakes` (`takes.ts:60-72`): first take starts at `offset + nudge + count_in`; then one take per loop length. Takes carry `at: {block (section id), bar}` = where the loop started (`takes.ts:21-22`), plus rate, tempo, key and time signature they were sung in. Passes marked while singing are keepers (`VocalsPage.tsx:506-534`). Saved onto the track (`VocalsPage.tsx:435-455`, `addRecording` in `src/song/clips.ts`).
7. A driver reset mid-recording hands the recording back and it is still cut into takes (`engine.rs:921-941`, `VocalsPage.tsx:483-504`).

### 3.3 Which input channel(s)

- Engine: `Core.input: usize`, any index below the number of input channels opened (`engine.rs:135-136`, `319-320`, `336`). One sample per frame is taken: mono only. The same index is monitored.
- Page: only Input 1 or Input 2 are offered. `Track.input?: 1 | 2` (`tracks.ts:45-46`), `channels = Math.min(2, …)` (`VocalsPage.tsx:705`), buttons `VocalsPage.tsx:879-880`. The hints ("mic", "inst / line") are written for a two-input interface.
- Meters: levels are kept for the first 8 input channels only (`src-tauri/src/meter.rs:61-62`, `take(8)`).
- Output: only outputs 1 and 2 are written; the rest are silenced (`engine.rs:531-537`).

So: can the engine list all input channels? It knows how many there are (`Opened.inputs`, `engine.rs:631-642`), not their names. Can it record a chosen mono channel? Yes, any one, today. A stereo pair? No. Two channels to two tracks at once? No: one queue, one mono writer, one "the recording" slot (`engine.rs:597-608`).

### 3.4 Arm and monitor options

- There is no "arm" as such: the vocal track shown on the Vocals page is the one recorded (`VocalsPage.tsx:112-115`, `130`, `380`).
- Monitoring, a studio-wide choice (`src/ui/state.tsx:191-192`, `VocalsPage.tsx:206`, `888-889`):
  - Direct: the interface's own monitor switch; the app sends no voice (`monitor = false`).
  - Through effects: voice -> the track's vocal chain -> headphones, in the engine (`engine.rs:337-342`, `466-490`, `522-527`); delay kept from building up (`engine.rs:542-554`); the round trip is measured from the driver's timestamps and shown (`engine.rs:491-499`, `VocalsPage.tsx:262`).
- While "through effects" is on, the engine stays open on every page and the app's own sound is sent through it so that only one program plays on the interface: `src/audio/through.ts:1-22`, tap `src/audio/through.worklet.ts`, queue `src-tauri/src/through.rs:1-18`. The app's sound is then about 0.16 s late (up to 0.4 s) (`through.rs:66-76`); the Canvas compensates (`src/audio/outdelay.ts`).
- When is the engine open at all: recording/rehearsing, or monitoring through effects, or the Vocals page is on screen and the app has been quiet for 1 s (`handoff.ts:14-22`, `VocalsPage.tsx:225-314`). A sound about to start closes it first (`handoff.ts:42-56`, `VocalsPage.tsx:325-334`).
- While recording you hear the backing, the click and your voice, never the old takes of the track being recorded (`skip`, `synth.ts:1084`, `takeplay.ts:138`).

### 3.5 Latency compensation

- Automatic: the driver's clock gives the moment the first count-in frame is heard (`play0`) and the moment the first recorded sample was captured (`cap0`); `offset = (heard − captured) × rate` (`engine.rs:452-460`, `322-328`, `1092-1095`).
- The file is kept in step with the song sample for sample: lost input becomes silence, extra input is left out (`keep_time` `engine.rs:399-418`, `missed` `349-360`, `pay_silence` `383-397`).
- Manual "timing nudge" in ms for converters the driver does not count (`state.tsx:200-201`, `VocalsPage.tsx:899`); changing it moves the takes already in the song as well (`takes.ts:75-105`, `VocalsPage.tsx:116-129`).
- A loop-back cable test is on the roadmap but not built (`docs/ROADMAP.md:44`).
- The whole scheme depends on the backing being played BY THE ENGINE on the interface's clock. The app's live Web Audio playback is on another clock and another output path; nothing recorded against it would be sample-aligned.

### 3.6 Where audio is stored, how takes play back

- Files stay in `Music/M-Theory/Recordings` and are never deleted by the app; the idea (saved in the browser's local storage: `state.tsx:281`, `406-414`) holds absolute paths `dry`/`wet`, with `start`/`frames` per take (`takes.ts:7-36`). There is no project folder yet (`docs/ROADMAP.md:68-71`).
- A WAV cannot pass 4 GiB: about 3 hours; the recording stops cleanly before (`recfile.rs:17-21`).
- Clips: `Clip {id, take, from, to, move}` in frames of the take; trim, move, split, swap take (comp), delete already exist (`clips.ts:19-28`, `114-137`), with snapping (`clips.ts:273-277`). `move` is relative to where the take was sung, and the take's place is `(section, bar)` (`layClips` `clips.ts:296-321`).
- Loading: only the take's stretch is read (`read_take_range`, `engine.rs:1151-1162`, `recfile.rs:178-218`), decoded once on the live context and cached; takes the song plays are kept, 8 others spare (`src/audio/takebuffers.ts`). Each take becomes one in-memory buffer for its whole length.
- Playing with the song: the view turns each clip into `PlayTake` entries per section (`GuitarView.tsx:186-195`, `220-227`, `256-260`), `TakeRuns` plays them (2.8).
- Alone: `hearAlone` (`takeplay.ts:301-333`), through the track's fader.
- Waveform picture from the decoded buffer (`src/audio/peaks.ts`).

---

## 4. What the blank audio track needs

| Need | Web side (`src/`) | Rust side (`src-tauri/src/`) |
|---|---|---|
| (a) Several audio tracks, each with its own chosen input | **Small change** if one track records at a time: widen `Track.input` beyond `1 \| 2` (`tracks.ts:46`), offer Input 1..N from `Opened.inputs` (`VocalsPage.tsx:705`, `879-880`), a per-track arm flag instead of "the track on screen", meters for N channels. Several vocal tracks already exist. | **Already there** for any ONE mono channel (`engine.rs:136`, `320`). **Small change**: meters beyond 8 channels (`meter.rs:61-62`). **New work**: a stereo pair (the record path is one float per frame into a mono file: `engine.rs:335-346`, `1029`; the vocal chain is mono-in: `fx.rs:279`), and recording two or more armed tracks in one pass (one queue, one writer, one result today: `engine.rs:94`, `597-608`, `1051-1068`). Channel names are not available (count only). |
| (b) Record onto the timeline at the playhead | **New work**: a take's place must be a position on the song line, not `(section, bar)` (`takes.ts:21-22`, `clips.ts:296-321`); a plan "from the playhead" (render from there; today the plan is a loop or the section on screen: `GuitarView.tsx:696-716`); a one-pass result instead of loop passes (`cutTakes` assumes a loop: `takes.ts:60-72`). Loop recording with passes and keepers should stay as the mode used when a ruler loop is set. The "preparing" wait (offline render before the count-in, `VocalsPage.tsx:398-402`) grows with the length rendered. | **Small change**: the backing always loops (`engine.rs:512-515`) and the click wraps with it (`engine.rs:426-428`); add "play once, then silence". Count-in of 0 already works. Alignment, drop-filling and the writer are unchanged. Memory: the backing is one in-memory stereo float array (about 23 MB per minute at 48 kHz). |
| (c) Audio clips moved, trimmed, looped by edge drag | **Already there**: trim/move/split/comp on clips (`clips.ts:114-137`), playback of any stretch with 5 ms edge fades, seamless joins, late starts, loop cuts (`takeplay.ts`), waveforms (`peaks.ts`). **Small change**: absolute clip position on the song line; repeats as extra instances with their own ids (see 2.10 point 6) using the existing `joined` crossfade. **New work only if wanted**: bringing in an outside audio file as a clip (nothing reads one today; the read commands only serve recordings: `recfile.rs:168-171`). | **Already there** (reads any stretch of a recording: `recfile.rs:178-218`). Nothing needed for move/trim/loop. |
| (d) Per-track effect chain on audio tracks | Two different things exist. The rack used by chords/melody tracks takes any input (`rack.ts:183`, `207`), so routing a track's takes into a rack instead of straight to the fader (`takeplay.ts:173`) is a **small change** plus rest/wake handling like `TrackVoice` has (`trackvoice.ts:403-485`); it gives live knobs, shared rooms and gates for free. The vocal chain (EQ graph, de-ess, two compressors, widths, echoes, reverbs) is NOT in the web side at all: takes carry it baked into the wet file, per track already (`tracks.ts:48`), and a changed knob needs "apply sound" to re-make files. Making that chain live in the browser is **new work** (port, or build the Rust chain for the audio thread). | **Already there** per track, as monitoring (live) and as a baked file (`engine.rs:1133-1138`, `recfile.rs:101-166`). **New work** for stereo sources (mono-in chain). A blank track can run with the chain off: `VocalFx.on` (`src/audio/vocalfx.ts:10-11`), which today still writes a second file. |

Decision the design has to make for (d): keep "vocal sound = baked by the engine" (no change, exact same sound as today, but not live), and/or give audio tracks the web rack as a live plugin. Both can coexist: baked file -> rack -> fader.

---

## 5. CPU and crackle constraints learned so far

Rules already built in (the new design must not undo them):

1. All browser sound is worked out on ONE thread, however many cores (README.md:430; `gate.ts:4-8`; `rooms.ts:4-6`).
2. Bigger output buffer: about 20 ms instead of 10 (`context.ts:23-28`). Consequence: the page's clock is a buffer behind; fades start at `soonest` (`context.ts:36-48`).
3. Booked 0.25 s ahead; 1 s around a page switch (`synth.ts:399`, `700`). Measured: a switch between the lighter pages holds the page up to 120 ms (`through.rs:68-69`); the Canvas more.
4. One voice per distinct sound of a track, never per knob step: dragging a control re-tunes the voice in place (`synth.ts:84-92`, `193-202`; before the fix a drag piled up dozens of voices, each kept 15 s: commit 193e7b2, `DROP_MS` `synth.ts:166`).
5. Resting: a voice made ahead rests until its first note (`synth.ts:98-99`); a voice whose notes are over rests (`trackvoice.ts:432-462`); after stop every track rests after 2 s, or 12 s with echo (`trackvoice.ts:37-38`, `420-429`). Measured: 12 s after stop a 9-track song still used about a tenth of a core before this (commit 36ad558). A synth that has gone quiet lets go of its output (commit 52caa98).
6. Effects at 0 are disconnected after they settle: 0.3 s, wobble 0.5 s, echo 2.2 s (`rack.ts:167-175`, `gate.ts`); saturation at drive 0 runs only its clean path.
7. Shared reverb: one convolution per kind+size for all chords/melody tracks (`rooms.ts:65-93`); "the costliest thing a track has" (`rooms.ts:4-5`; commit 3022591). Drum desks keep two convolutions each (`drumbus.ts:52-55`).
8. Safety stage on the master with no look-ahead, so nothing is delayed (`safety.ts:14-16`); same in the engine (`src-tauri/src/dsp.rs:646`, `engine.rs:528-530`).
9. Late notes fade in over 4 ms and start part-way; only the latest late hit per drum (`late.ts:20-23`, `synth.ts:843-847`).
10. Every stop and every clip edge fades (5 ms takes, 20 ms noise bed); no `cancelAndHoldAtTime` (it clicks in the browser engine used: `takeplay.ts:242-253`).
11. The interface is never played by two programs at once: the engine is open only when needed; the app waits for it to close before its first note (`handoff.ts:1-12`, `49-56`); with effects monitoring the app's sound goes through the engine instead (`through.ts`). Listing drivers is done once a session, in silence where possible (`handoff.ts:24-32`).
12. Engine audio thread never waits, allocates or frees (`engine.rs:88-107`, `733-747`), joins the pro-audio scheduler class, flushes denormals, keeps the computer awake (`src-tauri/src/rt.rs:1-10`, `67-79`, `83-99`).

Measurements found in the repository (comments, tests, README, commit notes):

| What | Number | Where |
|---|---|---|
| Audio thread, 9-track song, Track page | 47.6 % of one core (52.1 % before a change) | commit 59b19c0 |
| Same song with Canvas open | 63.0 % (66.7 % before): the Canvas "ears" cost about 15 % of a core | commits 59b19c0, 2f064e7 |
| After stop, before tracks rested | about 10 % of a core, 12 s after stop | commit 36ad558 |
| Vocal chain (Rust), heaviest settings | about 5 % of a core | commit e213306 |
| Synth | test asserts 8 voices of any sound stay under 50 % of real time; no figures are stored | `src/synth/bench.test.ts:15-46` |
| Page held up by a page switch | up to 120 ms on lighter pages | `through.rs:68-69` |
| App sound through the engine | queue starts at 0.16 s, grows by 0.04 s per dry-out to 0.4 s; blocks of 1024 frames (21 ms); gives up after 6 dry-outs in 60 s | `through.rs:66-76`, `src/audio/throughcore.ts:8`, `204-223` |
| Through path test (30 s of page switching incl. Canvas) | all sound delivered, 0 large clicks (2-4 before); earlier design delivered 18 s of 33 s | commit 8f92ce6 |
| Buffer advice | 64 frames at 48 kHz a good start, 128 safe for most computers | README.md:34 |
| Recorder queue | 20 s of voice may wait for a busy disk | `engine.rs:1027-1028` |
| Output latency | about 20 ms ("playback") vs about 10 ms | `context.ts:23` |

What this means for the rework:

- "As many tracks as they want": there is no cap today and 9 tracks already cost about half a core on the test machine. Per-track-only sound helps (one voice per track, never more). Each chords/melody track's rack has an always-on main path (compressor, saturation, three filters, a delay, a wave-shaper); each drums track has two convolutions and a compressor of its own.
- Putting a rack on audio tracks adds that always-on path per audio track; they need the same rest/wake as instrument tracks or silent audio tracks will cost CPU all the time.
- One page only: `bookAhead` is tied to page switches (`App.tsx:49`). The heavy moments become opening a composer window, opening the Canvas, zooming/scrolling a long timeline, dragging on the ruler. Those need the same "book further ahead for a moment" call, and timeline drawing must never block the page for more than the 0.25 s look-ahead.
- The Canvas from a button still costs about 15 % of a core while open.
- Recording while the song plays live cannot be aligned (3.5); the render-then-engine path must stay.

---

## Engine risks for the rework, most severe first

1. **The scheduler's input and position model is section-shaped in three places that must agree**: the list builder in the view (`GuitarView.tsx:204-350`), the live player (`synth.ts:406-960`) and the offline render (`synth.ts:975-1110`). The first chords track is privileged, origins are per section, and loop changes wait for a section end. About 2,000 lines of tests pin this behaviour (`player.test.ts`, `loopswitch.test.ts`, `relist.test.ts`, `songend.test.ts`, `clipplay.test.ts`, `takechain.test.ts`). A rewrite in one go risks every sound in the app. Safer: adapter first (clips -> today's item list), generalise later behind the same tests.
2. **A recorded take's place is `(section id, bar)` and clip moves are relative to it** (`takes.ts:21-22`, `clips.ts:26-27`, `296-321`). Removing sections without converting every existing take and clip to a song-line position makes old recordings silent (`layClips` drops clips whose section is gone: `clips.ts:307-310`). The backup copy of an old song points at the same files on disk (absolute paths), which is fine as long as files are never deleted.
3. **Recording is loop-shaped end to end** (backing always loops, takes are cut per pass, the click wraps): recording from the playhead on a free timeline needs a one-pass mode on both sides, and the wait while the backing is rendered grows with song length (and its memory: about 23 MB per minute, plus the offline render's own buffer).
4. **Sample-accurate alignment exists only when the engine plays the backing.** Any design where the user presses record while the live browser playback runs (as the reference DAW does) would lose it, or would go through the 0.16-0.4 s queue. The transport must keep "stop live playback -> render -> engine plays and records".
5. **Sharing the interface on a one-page app.** The rule "engine open while the Vocals page is on screen and the app is quiet" (`handoff.ts:20-22`) has no page to hang on. An armed track is the natural trigger, but an armed track with effects monitoring keeps the engine open always and sends all app sound through the queue (later by 0.16 s, ruler line must allow for it: `outdelay.ts`), and listing drivers at the wrong moment can upset a playing driver (`handoff.ts:24-32`).
6. **Unlimited tracks vs one audio thread** (section 5). No measurement exists beyond 9 tracks; nothing limits or warns. Rack-on-audio-tracks and several drum desks raise the floor.
7. **Stereo pairs and several armed inputs are new audio-thread code** in the engine (mono path, mono file, mono-in chain, 8-channel meter cap). Small-looking in the UI, real work and real risk underneath; one mono input at a time is nearly free.
8. **Per-section sound -> per-track sound conversion.** Songs where a track changes instrument or sound between sections cannot be represented by one chain per track without either splitting into several tracks or changing how they sound; drum kits per section the same (`synth.ts:904-911`).
9. **Per-section time signatures, styles and "feel" lose their home** (`patterns.ts:239-242`); the ruler, the click accents (`takes.ts:144-149`, `engine.rs:109-127`) and chord styles all read the meter of "their section".
10. **Long audio clips in memory.** Each take is decoded whole into one buffer (`takebuffers.ts:38-56`); fine for loop passes, heavy for a several-minute one-pass recording on several tracks (about 23 MB per stereo minute each, at the context's rate).
11. **Vocal sound is baked, not live.** "All the effects become plugins for the track" will read as live knobs; on audio tracks a knob change today means re-making files (`fx_render`), and until then takes are marked stale. Needs a clear decision (section 4d).
12. **Main-thread starvation of the 25 ms booking timer** by timeline drawing, ruler drags, zoom and open composer windows; today only page switches are covered by `bookAhead`.
13. **Clip repeats and the take de-duplication key** (`takeplay.ts:141-143`): repeats of one audio clip under one stretch would be dropped unless each instance has its own id.
14. **Smaller couplings to carry over**: pump (kick dips every instrument voice and shared room but not audio tracks: `synth.ts:101-113`); Canvas stems know only chords/melody/drums (`stems.ts:11-12`); tempo changes do not move or stretch recorded audio (`takes.ts:27`, `synth.ts:652-654`); a WAV stops at about 3 hours (`recfile.rs:17-21`); no recording at all in the browser/phone build (keep all engine calls behind `isDesktop()`).
