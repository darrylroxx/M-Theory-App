# Map of the app's pages, panels and controls (before the track-view rework)

Read-only survey of `/home/user/M-Theory-App` at commit `0f436e9`. Nothing in the repository was changed.

Short names used for files:

| Short | File |
|---|---|
| APP | `src/ui/App.tsx` (97 lines) |
| GV | `src/ui/views/GuitarView.tsx` (1887 lines: the host of every page, the transport, the play plan) |
| ST | `src/ui/state.tsx` (647 lines: app state, storage, ideas library, toast) |
| CSS | `src/ui/styles.css` (1389 lines) |
| C/Name | `src/ui/components/Name.tsx` |

How the app is put together today, in one paragraph: `APP` draws a top bar with seven page tabs and mounts one component, `GuitarView`, which keeps **every page mounted at once** and hides all but one with the `hidden` attribute (GV:935-968). `GuitarView` owns the player, the loop, the play plan (the whole song turned into a list of things to play), and the drag-and-drop of chords. All song data lives in one object, `state.progression` (ST:77-118). The top-level fields of that object (`chords`, `melody`, `beat`, `bars`, `sound`, `tuneSound`, `pattern`, `feel`, `arrange`, `tones`) always mean **"the section on screen, and the track of each kind that is being edited"**. Other sections are stored in `progression.song`; other tracks of the same kind in `progression.layers`. Choosing a section (`selectBlock`) or a track (`focusTrack`) swaps that content into the top-level fields. Almost every page is written against those top-level fields. This is the single most important fact for the rework.

---

## 1. Inventory of every user-facing feature today ("nothing may be lost" checklist)

State column: R = reads, W = writes. `prog` = `state.progression`.

### 1.1 Shell and top bar

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 1 | Page tabs | Seven pages: Track, Frame, Chords, Melody, Drums, Vocals, Canvas | APP:73-77, list at ST:38-39 | R/W `state.pane` |
| 2 | Book ahead on page change | Before a page opens, the playing song is booked one second ahead so the switch cannot starve the audio | APP:49-53, `bookAhead` in `src/audio/synth.ts:402` | none |
| 3 | Open page at its top | Changing page scrolls the window to the top (phone keeps the tab row) | APP:57-65 | none |
| 4 | Save | Saves the idea; lit when something changed; first save opens the library to name it | APP:35-43, 78; `saveIdea` ST:506-524 | W `saved`, `ideaId` |
| 5 | Ideas button with count | Opens the library sheet | APP:79 | R `saved.length` |
| 6 | Settings gear | Opens the settings sheet | APP:80 | local |
| 7 | Mic-live dot | Red dot on the Vocals tab while the mic is heard through the effects on every page | APP:75, `src/ui/live.ts` | external store |
| 8 | Draft badge | Shows "Draft" beside the name in the draft desktop app | C/Desktop:43-48 | none |
| 9 | Update bar | Desktop: installs a waiting update at start; later only offers it, with progress and "Later" | C/Desktop:5-40 | local |
| 10 | Crash guard | "Something went wrong in this view" card with "Reload view" | APP:13-29 | local |
| 11 | Wide layout | Pages that show more than one bar take the whole window width | APP:46-48, `widePage` in `src/song/window.ts:33`, CSS:1195-1198 | R `view.bars`, `prog.bars` |
| 12 | Toast and undo toast | Short message; with an action it stays 20 s with a ↶ button, and goes away when the undo no longer fits | ST:453-457, 625-634 | local |
| 13 | Theme | Auto / Dark / Light | ST:441-448 | R `settings.theme` |
| 14 | Storage and other tabs | Everything is written to local storage on each change; another browser tab's library is merged in | ST:400-439, `src/ui/othertab.ts` | all |
| 15 | Cloud sync of the library | When hosted where an account store exists, ideas follow the account | ST:569-622, `src/ui/cloud.ts` | R/W `saved`, `tombs` |
| 16 | Offline cache | Web build registers a service worker (not in the desktop app) | `src/main.tsx:14-20` | none |

### 1.2 Transport and loop strip (on every page)

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 17 | Play / Stop | ▶ plays from the section on screen to the end of the song, or the loop round and round; ■ stops everything including a take heard alone | GV:574-638, button GV:1483 | local `playing`, player ref |
| 18 | Wait for instruments | ▶ first makes pianos and synths ready and closes the recording engine, then starts | GV:603-611 | none |
| 19 | "Nothing to play" message | "Add chords, a melody or drums first" | GV:597 | R plan |
| 20 | Loop button ↻ | Loops the section on screen, or lets the loop go | GV:649, 1484 | local `chosen` (loop bars) |
| 21 | Tap bars to loop | Each bar of the song is a small button: a tap adds it (and the bars between) to the loop; a tap on either end removes it | GV:647, 1496-1499; `tapBar` `src/song/loops.ts:84` | local `chosen` |
| 22 | Section name: go there | Not looping: a tap on a section's name puts that section on screen | GV:1494 | W `prog.song.current` |
| 23 | Section name: loop it too | While looping: a tap puts the section in the loop or takes it out (sections apart from each other can loop together) | GV:651, 1492 | local `chosen` |
| 24 | All | While looping: loop the whole song | GV:653, 1485 | local `chosen` |
| 25 | Loop of separate runs | Runs not next to each other play one after another with a jump | GV:345-350 | derived |
| 26 | Loop change while playing | The new loop takes over where the section playing ends, in time; edits that change the shape of the list are swapped in at once | GV:538-570 | player |
| 27 | Sounding-bar mark | The bar that is sounding is marked on the strip (class toggled each frame, no redraw) | GV:1457-1480 | reads player |
| 28 | Strip keeps place | The strip scrolls sideways by itself to the section on screen and to the sounding bar. **There is no scroll bar and no zoom** (CSS:768-769 hides the bar): this is the "strip ran off the screen" complaint | GV:1449-1456, CSS:768 | none |
| 29 | Key · meter · tempo summary | Button at the right end; opens the Frame page (hidden on a phone, CSS:655) | GV:1504 | R key, meter, bpm; W pane |
| 30 | Locked while recording | Loop cannot change, ▶ is off while the Vocals page records | GV:646-653, 1482; CSS:1064 | local `recording` |
| 31 | Loop belongs to the idea | Opening another idea clears the loop; bars that no longer exist drop out | GV:310-325 | R `opened` |
| 32 | Stop on idea change | The song stops when another idea is opened | GV:531-536 | R `opened` |
| 33 | Follow | With Follow on, the page on screen goes to the section the music has reached; it waits while a control is being held | GV:502-526; `src/ui/hands.ts` | R `view.follow`; W `song.current` |

### 1.3 Frame page (sections, key, time, export)

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 34 | Song length pill | Total bars and minutes:seconds | C/FrameSections:372 | R |
| 35 | Go to a section / rename it | Tap a name to work on it; tap the current one to type a name (Enter saves, Escape cancels) | C/FrameSections:104-112, 390-402 | W `song.current`, part name |
| 36 | Section length | − / + one bar; tap the number for quick lengths 1, 2, 4, 8, 12, 16, 24, 32 | C/FrameSections:404-408, 430-434; `src/song/frame.ts:9-13` | W part `bars` |
| 37 | Section's own time signature | Per section, with ↶ for 20 s | C/FrameSections:114-130, 409-411, 435-442 | W part `meter` |
| 38 | Copy a whole section | Everything in it, every track | C/FrameSections:139-145, 414 | W `state.clip.section` |
| 39 | Paste a whole section | Replaces the section (asks first if it has content), moves to the current key, undo toast | C/FrameSections:146-165, 415 | W `prog` |
| 40 | Remove a section | Blocked while recording; asks if vocals were recorded in it | C/FrameSections:93-98, 416 | W `prog.song` |
| 41 | Reorder sections | Drag by the grip (mouse), hold a row (touch), arrow keys on the grip or Alt+arrows; the page scrolls near the edges; the row glides into place | C/FrameSections:167-366 | W `song.blocks` order |
| 42 | Track chips per section | One chip per track in that section with a count; a tap opens that track's page on that section | C/FrameSections:72-92, 418-427 | W `pane`, `song.current`, `focus` |
| 43 | Unlink | A repeated section becomes a section of its own | C/FrameSections:428 | W `prog.song` |
| 44 | New section | "+ B": a new empty section | C/FrameSections:99, 449 | W `prog.song` |
| 45 | Play a section again | "↻ A": the same section again later in the song (shared music) | C/FrameSections:100, 450-452 | W `prog.song` |
| 46 | Key | Twelve home-note buttons | GV:1013-1021 | W `state.key` |
| 47 | Mode | Nine common modes as chips, plus "More…" with every scale by family | GV:1022-1038 | W `state.key.scaleId` |
| 48 | Scale notes and play scale | The notes of the scale as coloured chips, signature notes marked, ▶ plays it | GV:1039-1051 | R key |
| 49 | Move song | − ½ / + ½ moves the key, every chord and every melody together | GV:999-1009, 1053-1057 | W key, every section |
| 50 | Vocals key note | "Vocals: sung in …" when takes were sung in another key | GV:1543-1549, 1643 | R takes |
| 51 | Tempo | Slider 40-200 and − / + | GV:1620, 1646-1651 | W `prog.bpm` |
| 52 | Song time signature | Nine signatures as buttons (2/4 to 7/4, 6/8, 9/8, 12/8); ↶ for 20 s | GV:1622-1634, 1652-1657; `src/song/meter.ts` | W `prog.meter`, conforms all sections |
| 53 | Vocals tempo and signature notes | "recorded at N bpm" with a button back to that tempo; "recorded in 3/4" | GV:1636, 1658-1664 | R takes; W bpm |
| 54 | Export WAV | The whole song as heard, through the mixer, 24-bit, 48 kHz | GV:1604-1618, 1670; `renderSong` `src/audio/synth.ts:975` | R plan |
| 55 | Export MIDI | Every track on its own MIDI track with its name and instrument | GV:1598-1602, 1671; `src/audio/midi.ts` | R plan |
| 56 | Chords + tab | Chord names, roman numerals and guitar tab (or key names for keyboard tracks) copied as text, section by section | GV:1556-1596, 1672, `tabText` GV:1873 | R |

### 1.4 Track page (the seed of the new view; detail in section 5)

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 57 | Total bars pill | "N bars" | C/TrackPage:265 | R |
| 58 | Bars on screen + Follow | 1 / 2 / 4 / 8 / All and the Follow switch (shared by every page) | C/TrackPage:267; C/BarsControl:47-61 | R/W `state.view` |
| 59 | Track head: name | Opens that track's page on the section on screen (or the first section that has it) | C/TrackPage:231-236, 282-286 | W `pane`, `song.current`, `focus`, `studio.vocal` |
| 60 | Instrument icon | Guitar / piano / synth picture beside chords and melody tracks | C/TrackPage:283; `InstIcon` C/HarpPanel:15-25 | R `tones` |
| 61 | Remove a track | ✕ on added tracks; asks first; blocked while recording onto it | C/TrackPage:252-257, 285 | W `prog.tracks`, layers |
| 62 | Mute | M, for the whole song | C/TrackPage:290 | W `prog.mix[id].mute` |
| 63 | Solo | S | C/TrackPage:291 | W `prog.mix[id].solo` |
| 64 | Volume | Slider −60 … +6 dB, double-click resets, dB readout | C/TrackPage:293-294; `src/audio/mix.ts:22-23` | W `prog.mix[id].db` |
| 65 | Harmony ⟳ on a head | Opens the sheet that writes a harmony track again | C/TrackPage:288, 349 | local `again` |
| 66 | Add a track | "+" then Chords / Melody / Drums / Vocals; reuses an empty track of the kind instead of making a second empty one | C/TrackPage:238-249, 298-305; `trackAdded` C/TrackPage:52-63 | W `prog.tracks`, layers |
| 67 | Ruler | Section names (tap to choose) and bar numbers; looped bars are shaded | C/TrackPage:309-318 | W `song.current` |
| 68 | Blocks | One block per track per section, drawn small; a tap opens that page there | C/TrackPage:324-340 | W pane etc. |
| 69 | Add track to a section | Faint "+" where a track is not in a section | C/TrackPage:251, 325-330 | W layers |
| 70 | Small pictures | Chord names to scale, melody notes, drum hits in three lanes, vocal clips | C/TrackPage:354-413 | R |
| 71 | Playhead and page turn | A line moved every frame; with Follow the lanes turn a page | C/TrackPage:156-178 | reads player |
| 72 | Keep section in view / light up new track | The section on screen is scrolled into view; a track added elsewhere flashes | C/TrackPage:182-227 | local |
| 73 | "Plays instead" | A chords track a harmony replaces in a section is drawn faint with a hint | C/TrackPage:333-336 | R |

### 1.5 Chords page

Top strip, shared with Melody and Drums (`ClipBar`, GV:1307-1409):

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 74 | Section label | The name and colour of the section on screen | GV:1379 | R |
| 75 | Track tabs of this kind | Which chords (or melody, or drums) track the page edits, in this section | GV:1380-1387 | W `prog.focus` |
| 76 | Add a track of this kind here | "+"; an empty one comes forward and flashes instead | GV:1364-1370, 1388 | W tracks, layers |
| 77 | Remove from this section | ✕ on the tab; asks if it has music | GV:1372-1375, 1385 | W layers |
| 78 | Harmony ⟳ on the tab | Write a harmony track again | GV:1384 | opens sheet |
| 79 | Mute / solo mark | Shows M or S when the track on the page cannot be heard; a tap lets it be heard | GV:1390; C/MixMark:10-20 | W `prog.mix` |
| 80 | "X plays instead" chip | Says a harmony replaces these chords here; a tap shows that track | GV:1351-1356, 1391-1395 | W focus |
| 81 | Copy | Copies this page's content of the section (chords with their playing style and sound) | GV:1325-1329, 1398; `src/song/clip.ts:125-131` | W `state.clip` |
| 82 | Paste | Puts the last copy of the same kind here, moved to the key; warns when some is past the end | GV:1330-1340, 1402-1404 | W prog |
| 83 | Undo paste | ↶ for 20 s, only on the same section and track | GV:1341-1347, 1399-1400 | local |

Chord board (`ChordBoard`, GV:1110-1186):

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 84 | In key / Outside / Next | Three lists of chords to pick from | GV:1133 | local |
| 85 | Kind of chord | Triads, sevenths, sus … for the cards | GV:1134-1138; `CHORD_ROWS` `src/theory/keys.ts` | local |
| 86 | Key chip | Shows the key; opens the Frame page | GV:1140 | W pane |
| 87 | Capo | 0-9 with a star on the fret that gives the most open shapes (guitar tracks only) | GV:1079-1100, 1142 | W `settings.capo` |
| 88 | Chord cards | One per note of the scale: roman numeral, signature star, name, guitar shape or keyboard picture; tap to hear and list its other chords; drag into the tray; "Shapes" and "+" | GV:1188-1212 | W chords |
| 89 | Every chord on a degree | Rows by kind (sus, sixths, sevenths …) as pills | GV:1162-1172 | local |
| 90 | Role legend | Home / stable / motion / tension and the signature star | GV:1173-1178 | none |
| 91 | Outside chords | Borrowed chords by the scale they come from; lead-ins, cinematic, jazz swaps, passing | GV:1222-1248 | R key |
| 92 | Next chords | Suggestions after the last chord: Safe, Smooth, Colorful, Bold | GV:1250-1268; `src/theory/progression.ts` | R chords, key |
| 93 | Pills | Tap to hear and select (then "Shapes" and "+" show at the top), drag to add | GV:1144-1150, 1215-1220 | local |

The tray (`Dock`, GV:1679-1797) and its parts:

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 94 | Arrange (guitar) | "My shapes" or one of five neck areas; then strings per chord and Inversions; shows the fret span | GV:1755-1781; logic GV:94-125, 158-159 | W `prog.arrange` |
| 95 | Voicing (keys) | How chords are laid out on the keyboard | GV:1742-1754; `VOICINGS` `src/audio/tone.ts` | W `prog.tones[id].voicing` |
| 96 | Harmonize button | Opens the harmony sheet | GV:1752, 1779 | local `hz` |
| 97 | Chord slots | Each chord as a card with its shape; tap to hear; drag to reorder; ✕ removes; the sounding chord is lit; a chord past the section's end is struck | GV:1833-1869 | W chords |
| 98 | Shape steppers | ‹ › step to the next shape that fits between the neighbours | GV:148-156, 1862-1866 | W chord `voicingId` |
| 99 | Open the shape finder for a slot | Middle button (guitar) or ⋯ (keys) | GV:1860, 1864 | W `sheet` |
| 100 | Drop marker | Shows where a dragged chord will land | GV:1724-1737 | local `drag` |
| 101 | Length ruler | Chords to scale with bar lines; drag the edge between two chords; tap a chord for exact length (− / +, quick lengths); "make it N bars" when chords run past the end | C/BarRuler:21-137 | W chord `beats`, `prog.bars` |
| 102 | + Rest | A bar of silence after the last chord | GV:1723, 1791 | W chords |
| 103 | Clear | Empties the section's chords | GV:1792 | W chords |
| 104 | Mini tray | When the tray is off screen: a slim bar with ▶, chord names (tap to hear, drop target) and a way back | GV:1803-1831, shown at GV:973-976 | R |
| 105 | Sticky tray | The tray sticks to the bottom of the window until scrolled to | CSS:221 | none |

Shape finder (`ShapeFinder`, C/ShapeFinder:37-186):

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 106 | Header | Chord name, its notes, "+ Add", "i" (theory), ✕ | C/ShapeFinder:122-131 | W chords |
| 107 | Chord theory | Type, feel, roman numeral and role in the key, other names, keys that hold it | C/ChordInfo:27-55 | R key |
| 108 | Slot tools | "3 of 5", move earlier / later, length − / +, Remove | C/ShapeFinder:132-144 | W chords |
| 109 | Flavours | Switch to another kind of chord on the same root; "All…" lists every type | C/ShapeFinder:147-161 | W chord ref |
| 110 | Shape tabs | Common / Small / Inversions / All; tap a shape to hear and use it, or drag it into the tray | C/ShapeFinder:169-181, 197-209 | W `state.shapes` or slot `voicingId` |
| 111 | Keys version | For a keyboard track: the keys the chord plays, tap to hear | C/ShapeFinder:163-167 | R |
| 112 | Close | Escape or a tap on the dimmed page | C/ShapeFinder:72-77; GV:947 | W `sheet` |

How the chords are played and how they sound (`HarpPanel`, C/HarpPanel:239-305, with `SoundControls` C/HarpPanel:60-232):

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 113 | Instrument | Guitar / Piano / Synth, with a loading mark | C/HarpPanel:40-52; GV:426-448 | W `prog.tones[id]` |
| 114 | Playing style | A picker with ‹ › and a drawer of styles by group | C/HarpPanel:254-285; `STYLES` `src/audio/patterns.ts` | W `prog.pattern` |
| 115 | Feel | Speed ½×/1×/2×, Swing, Touch, Spread, Octave Low/Mid/High | C/HarpPanel:286-298 | W `prog.feel` |
| 116 | Harp voice | Which string instrument | C/HarpPanel:111, 126-141 | W `prog.sound.voice` |
| 117 | Ready-made sound | Presets, plus "Mine" with save and delete | C/HarpPanel:87-98, 112-116, 142-162 | W `prog.sound`, `state.mySounds` |
| 118 | Piano model | Which piano | C/HarpPanel:118-120 | W tone `keys` |
| 119 | Strings panel | Pluck, Soft, Ring, Body, Octave, Wide, Volume | C/HarpPanel:183-197 | W `prog.sound` |
| 120 | Keys panel | Bright, Volume, Pedal | C/HarpPanel:170-181 | W tone, sound |
| 121 | Effects panel | Saturation + Colour + Blend, Squeeze, Tone, Chorus, Phaser, Wobble, Tremolo + speed, Echo + time, Reverb + type + Size, Shimmer | C/HarpPanel:199-229 | W `prog.sound` |
| 122 | All sections | Copies this track's sound and playing to the same track in every other section | C/HarpPanel:167; GV:458-474 | W every section |
| 123 | Hear a change | A chord is rolled once the knobs settle | GV:399-406 | none |
| 124 | Synth: sounds | Presets by kind, ‹ ›, a die for a random one, ▶ to hear | C/SynthPanel:86-115 | W tone `synth` |
| 125 | Synth: six macro knobs | Big round knobs (drag, Shift for fine, arrows, double-click to centre) | C/SynthPanel:117-119, 212-253 | W tone `synth.macros` |
| 126 | Synth: way of playing | Hold / Arp / Strum / Pulse / Drone / Glide with their few settings; arp styles, speed, range | C/SynthPanel:121, 270-329 | W tone `synth.play` |
| 127 | Synth: full panel | Osc, LFO, Filter, EG, Effect, Voice sections of faders, opened with "Panel" | C/SynthPanel:123-172 | W tone `synth` |

### 1.6 Melody page (`MelodyGrid`, C/MelodyGrid:27-355)

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 128 | Top strip | Same as rows 74-83, for melody tracks | GV:954 | as above |
| 129 | On / Off | Mute the melody without deleting it | C/MelodyGrid:313 | W `prog.melody.on` |
| 130 | Harmonize | Opens the harmony sheet | C/MelodyGrid:314 | parent |
| 131 | Grid | Steps to a beat | C/MelodyGrid:316-319; `GRIDS` `src/song/melody.ts:33` | W `melody.div` |
| 132 | Bar tabs | One tab per bar (hollow when empty), ‹ › pages when not all bars fit | C/MelodyGrid:322-333 | local |
| 133 | Copy the bar before | ⧉ | C/MelodyGrid:332 | W melody |
| 134 | Key only | Show only the rows of the scale | C/MelodyGrid:335 | local |
| 135 | Undo | Up to 50 steps, only this page's own edits; cleared when the melody changes elsewhere | C/MelodyGrid:66, 76-91, 220, 240-245, 336 | local `past` |
| 136 | Clear bar | Empties the chosen bar | C/MelodyGrid:337 | W melody |
| 137 | Note names | A tap on a row's name plays that note | C/MelodyGrid:341-347 | none |
| 138 | Squares | Tap to add or remove a note; drag along a row to paint or erase across bars; a finger's tap is taken on click so scrolling still works | C/MelodyGrid:226-289 | W `melody.notes` |
| 139 | Rows | Two octaves up from the home note (25 rows), stretched by any note already written outside them | C/MelodyGrid:98-109; `melodyRows` `src/song/melody.ts:123-135` | R key |
| 140 | Chords over the grid | The chord's name where it comes in, and a dot on every square that is a note of the chord sounding | C/MelodyGrid:124-135, 379, 384 | R `chordsUnder(prog)` |
| 141 | Moving line | On the sounding bar; the bar's tab has a dot; with Follow the page turns | C/MelodyGrid:163-218 | reads player |
| 142 | Sound | Instrument, harp voice, sound preset, strings / keys / synth, effects, "All sections" | C/MelodyGrid:352 → C/HarpPanel:60-232 | W `prog.tuneSound`, `tones` |

### 1.7 Drums page (`DrumMachine`, C/DrumMachine:47-637)

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 143 | Top strip | Same as rows 74-83, for drums tracks (no harmony) | GV:966 | as above |
| 144 | On / Off | Play the drums or not | C/DrumMachine:434 | W `beat.on` |
| 145 | Kit | Picker with ‹ ›; drawer with the built-in kits, the drum machines, and "Mine" (save this kit, delete) | C/DrumMachine:360-381, 436-455 | W beat kit, `state.myKits` |
| 146 | Rhythm | Picker with ‹ ›; drawer with groups of styles and "Mine" (delete); a picked rhythm plays at once | C/DrumMachine:384-389, 440, 456-474; GV:719-723 | W beat rows, `state.myBeats` |
| 147 | Edit lock | The grid is locked until "Edit"; touching it while locked nudges the Edit button | C/DrumMachine:248-251, 308-311, 490 | local `edit` |
| 148 | Undo / Cancel / Save | Undo each step (100), Cancel puts the grid back, Save keeps it and files a changed rhythm under "Mine" (or recognises an existing one) | C/DrumMachine:253-289, 479-486 | W beat, `myBeats` |
| 149 | Brush | Soft / Normal / Loud hits | C/DrumMachine:480 | local |
| 150 | Vary | ✨ a small random change to the bar | C/DrumMachine:481 | W beat |
| 151 | Copy the bar before | ⧉ | C/DrumMachine:482 | W beat |
| 152 | Clear bar | | C/DrumMachine:483 | W beat |
| 153 | Bar tabs | One per bar of the section, ‹ › pages | C/DrumMachine:496-507 | local |
| 154 | Drum names | A tap plays the drum and opens its sound | C/DrumMachine:512-515 | local |
| 155 | Grid | Nine drums by steps; tap or drag to paint with the brush; a short rhythm repeats until a bar is changed, then every bar stands alone | C/DrumMachine:291-357, 509-523; `spreadBeat` `src/audio/beats.ts` | W `beat.rows` |
| 156 | Playhead | On the sounding bar; page turns with Follow (never while editing) | C/DrumMachine:144-197 | reads player |
| 157 | Mixer panel | A fader, M and S for each drum, tap the name to hear it, a fader for the whole kit | C/DrumMachine:532-558 | W `beat.sounds`, `mutes`, `level` |
| 158 | Sound panel | Picture of the sound that changes with the knobs; which drum; which sound (library or machine) with ‹ ›; M, S, reset; Tune, Decay, Tone, Punch, Drive, Filter, Level, Pan, Reverb send, Echo send | C/DrumMachine:560-596, 684-710 | W `beat.sounds`, `voices` |
| 159 | Effects panel | Vibes (one-tap moods); Swing, Human; Saturation + Colour + Blend; Reverb type + amount + Size; Echo + time; Sampler; Noise + level; Tape; Tone; Glue; Pump | C/DrumMachine:598-634 | W beat fx |
| 160 | All sections | The kit sounds like this in every section that has it (the rhythm stays each section's own) | C/DrumMachine:529 | W every section |
| 161 | Drum solo while working | A soloed drum is only for this page and is dropped on leaving it | C/DrumMachine:216-223 | audio only |

### 1.8 Vocals page (`VocalsPage`, C/VocalsPage:97-933; lane in C/TakeLane)

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 162 | Vocal track tabs | Choose, add (reuses an empty one), rename by double-click | C/VocalsPage:667-689, 806-809 | W `studio.vocal`, `prog.tracks` |
| 163 | Record | ● records take after take over the loop (or the section on screen) after a count-in, until ■ | C/VocalsPage:365-415, 457-472, 823 | W track `takes`, `clips` |
| 164 | Rehearse | Sing over the loop without recording | C/VocalsPage:824 | none |
| 165 | Pass readout | Count-in numbers, then "Pass N"; what loops; notes for a long session, low disk, little room left; render progress | C/VocalsPage:266-294, 825-828 | refs |
| 166 | Keep a pass | ★ button or the K key marks the pass being sung (or the one just ended) | C/VocalsPage:507-534, 831 | local `marks` |
| 167 | Count-in and click | None / 1 bar / 2 bars; click while recording | C/VocalsPage:833-838 | W `studio` |
| 168 | Row of passes | Every pass so far; tap to keep or let go | C/VocalsPage:843-852 | local |
| 169 | Lane | The bars recorded over; each recording a row of clips with waveforms; a moving line and a thin fill; ‹ › pages; Follow | C/TakeLane:75-424 | R takes |
| 170 | Clip editing | Drag an edge to trim; drag the body to move (snaps to sixteenths, Alt or Shift for free); tap to select; two taps to hear alone; ✂ or the S key splits; Delete removes; Escape lets go | C/TakeLane:236-343; C/VocalsPage:750-771 | W track `clips` |
| 171 | Clip tools | ✂, Snap, ↶ (Ctrl+Z), which take the clip plays (comping), hear the clip, delete it | C/VocalsPage:780-795 | W clips |
| 172 | Take browser | Every take, newest recording first: All / ★ filter, ‹ › and arrow keys, hear alone (Space), ★ (K), Use (Enter), delete, remove a recording, show short takes | C/VocalsPage:947-1058 | W takes |
| 173 | Apply sound | Puts the current vocal sound onto takes recorded with an older one | C/VocalsPage:649-665, 1023 | W takes `wet` |
| 174 | Interface | Which device; ins / outs / rate; dropouts; buffer size; measured delay; error text | C/VocalsPage:858-876 | W `studio.host`, `device`, `buffer` |
| 175 | Input meters and input choice | A meter per input with peak hold; choose Input 1 (mic) or 2 (instrument / line) for the track | C/VocalsPage:247-257, 877-885 | W track `input` |
| 176 | Monitor | Direct or through the Effects; a warning when both are on | C/VocalsPage:886-891 | W `studio.monitor` |
| 177 | Headphone mix | Song level and Click level | C/VocalsPage:892-895 | W `studio.backing`, `click` |
| 178 | On the interface | Four reminders (48V, Air, INST, Direct Monitor) and the timing nudge in ms | C/VocalsPage:40-45, 117-129, 896-900 | W `studio.checks`, `nudge` |
| 179 | Vocal sound | On, Preset, Colour (preamp), EQ graph with six draggable points and the air band, Dynamics (Punch, Smooth, De-ess, Gate, De-ess at), Width, Echo (type, time, amount, repeats), Reverb (type, amount, size, darkness, pre-delay, duck), Output level, More / Less, LIMIT lamp and gain-reduction readout | C/VocalsPage:47-65, 691-704, 903-925; C/EqGraph:23-135 | W track `fx` |
| 180 | In the browser | "Recording: in the desktop app"; the lane, tools and takes still show | C/VocalsPage:815-818, 930 | R |
| 181 | Safety nets | A driver reset mid-take keeps the recording; a full file stops and keeps what there is; the idea cannot be left while takes are still being saved | C/VocalsPage:236-245, 298-301, 483-504; ST:525-547 | `recordingTo` |

### 1.9 Canvas page (`CanvasPage`, C/CanvasPage:112-830)

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 182 | The painting | Paints while music plays, layer by layer, from the app's own tracks | C/CanvasPage:399-586 | reads audio |
| 183 | Open a song from a file | Button or drop a file on the canvas; play / stop / close; a time line | C/CanvasPage:589-637, 716-721, 738-748 | local |
| 184 | Better layers | Desktop: download and run the better split, with progress | C/CanvasPage:62-90, 648-666 | local |
| 185 | Guide | "Hz": frequency ruler, bar numbers, what the mix covers | C/CanvasPage:724-735, 749 | W `canvas.guide` |
| 186 | Full screen | ⤢, with its own ▶; Escape leaves | C/CanvasPage:677-682, 750-751; CSS:834-837 | local |
| 187 | Layer legend | A swatch per layer with a live level; tap to hide or show | C/CanvasPage:755-779 | W `canvas.hide` |
| 188 | Colours | Families of colour schemes and the schemes in each | C/CanvasPage:785-797 | W `canvas.palette` |
| 189 | Layout, Surface, Paint, Drips, Old paint, Across | How it is laid out, what it is painted on, how the paint behaves, how fast it fades, how much of a file one pass holds | C/CanvasPage:798-822 | W `state.canvas` |
| 190 | Clear and Save picture | | C/CanvasPage:684-696, 824-825 | none |

### 1.10 Ideas library (`IdeasPanel`, C/IdeasPanel:17-115)

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 191 | List | Every saved idea, newest first, with a one-line description, key, tempo and age | C/IdeasPanel:24, 79-98 | R `saved` |
| 192 | Rename | Type in the name | C/IdeasPanel:85 | W `saved` |
| 193 | Open | Asks "Save what you have first?" when there are changes; blocked while recording | C/IdeasPanel:42-43, 67-76, 91 | W whole progression |
| 194 | New idea | Same question first; keeps key and tempo | C/IdeasPanel:44, 63; ST:541-547 | W |
| 195 | Delete | ✕ then "Delete?" within 3.5 s | C/IdeasPanel:92-94 | W `saved`, `tombs` |
| 196 | Save a copy | "Save a copy of …" | C/IdeasPanel:100; ST:506-524 | W `saved` |
| 197 | Backup and Restore | All ideas to a file; add ideas from a file | C/IdeasPanel:45-56, 108-110 | W `saved` |
| 198 | Where it is kept | Says whether the library is only in this browser or synced; "Try again" | C/IdeasPanel:103-106 | R `cloud` |

### 1.11 Settings and audio setup (`SettingsPanel`, C/SettingsPanel:6-46)

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 199 | Avoid barre chords | | C/SettingsPanel:18 | W `settings.avoidBarre` |
| 200 | Tuning | | C/SettingsPanel:19-23 | W `settings.tuningId` |
| 201 | Capo | | C/SettingsPanel:24-28 | W `settings.capo` |
| 202 | Dots | Fingers / Notes / Intervals on chord diagrams | C/SettingsPanel:29-32 | W `settings.labels` |
| 203 | Theme | | C/SettingsPanel:33-36 | W `settings.theme` |
| 204 | Left-handed diagrams | | C/SettingsPanel:37 | W `settings.leftHanded` |
| 205 | Audio interface | Desktop: what was found, "Look again", everything the computer sees, app version | C/Desktop:50-88 | none |

### 1.12 Harmonize (`HarmonyPicker`, C/HarmonyPicker:46-237)

| # | Feature | What it does | Where | State |
|---|---|---|---|---|
| 206 | Open | From the Harmonize button on Chords and Melody; a second tap closes | GV:481-500 | local `hz` |
| 207 | Which track to go with | Chips of every track with music in this section | C/HarmonyPicker:195-201 | local |
| 208 | Options | The harmonies that fit, best first; an "Instead" group for ones that replace the chords | C/HarmonyPicker:208-222 | local |
| 209 | Three controls | Simpler / Busier, Closer / Wider, Plain / Colourful (three steps each; greyed when they mean nothing) | C/HarmonyPicker:249-281 | local |
| 210 | Hear it | The section on screen loops with the candidate in it; swapping options swaps while it plays; the loop is put back after | GV:655-690; C/HarmonyPicker:143-157, 226 | preview |
| 211 | Keep | ✓ writes it into the empty track on screen, another empty one, or a new track; undo toast | C/HarmonyPicker:159-180 | W prog |
| 212 | Write again | ⟳ on a harmony track; a dot when its source changed; asks before writing over hand edits | C/HarmonyPicker:165-168, 284-295 | W prog |

### 1.13 Things that cut across pages

| # | Feature | Where |
|---|---|---|
| 213 | Your own libraries kept across ideas: rhythms, kits, sounds, chosen chord shapes | ST:157-165 |
| 214 | Per-idea clipboard: one for chords, one for melody, one for drums, one whole section | ST:177; `src/song/clip.ts:104` |
| 215 | Undo, as it exists today (there is **no global undo**): melody grid ↶; drum edit Undo / Cancel; vocal clips ↶ and Ctrl+Z; paste ↶; time-signature ↶; harmony ↶ toast; "All sections" ↶ toast; section paste ↶ toast | C/MelodyGrid:240; C/DrumMachine:254; C/VocalsPage:568; GV:1341, 1656, 465; C/FrameSections:158, 411; C/HarmonyPicker:178 |
| 216 | Keyboard: K (keep pass / take), Ctrl+Z (vocal clips), S / Delete / Escape (lane), arrows / Space / Enter (take list), Escape (sheets, full-screen canvas), arrows on knobs and EQ points, Alt+arrows (section order). **Space does not play / stop today.** | C/VocalsPage:527, 588, 991; C/TakeLane:320; C/FrameSections:358 |
| 217 | Native confirm and prompt boxes (seven): remove track, remove track from section, remove section, replace on paste, write over harmony, remove recording, name vocal track | C/TrackPage:255; GV:1373; C/FrameSections:96, 148; C/HarmonyPicker:166; C/VocalsPage:602, 669 |
| 218 | Song voices kept ready: one voice per track per way it is played, made ahead; notes prepared ahead | GV:383-397 |

Total: 218 rows.

---

## 2. Each page component: what it needs, and how hard it is to put in a floating window that edits one clip

Scale: **easy** (mount as is with new props), **needs adapter** (a thin layer that feeds it a clip instead of a section), **needs rewrite** (its inner logic is tied to sections).

### 2.1 `MelodyGrid` (C/MelodyGrid:27) — **easy**

- Props: `melody`, `setMelody(fn)`, `keyOf`, `bar` (beats in a bar), `chords` (the chords heard underneath), `playing`, `getPos()` (beats into the content, or null), `sound`, `setSound`, `onHear`, `inst` (instrument props), `shown`, `follow`, `active`, `fresh`, `place`, `onHarmonize`, `canHarmonize`, `harmonizing`, `onAll`.
- Does **not** call `useApp()` at all. Everything comes through props. It is the cleanest component to move.
- Section assumptions: only through the meaning of its props. `melody` must be as long as the content (`inBars`, GV:172). `getPos` must return null when the playhead is outside this clip (today: when another section sounds, GV:744-747). `fresh` and `place` are strings that reset undo and the view: give them the clip's id.
- Sound controls are drawn inside it (C/MelodyGrid:352). For the rework that one line moves out to the track's effect plugin.
- For bass: the rows are fixed at two octaves above the key's home note near middle C (`src/song/melody.ts:117-135`), plus any stray notes. A bass line needs lower rows. The grid's rows are built in one place (C/MelodyGrid:98-109) so an "octave shift" and "how many octaves" input is a small, local change; the notes themselves are plain MIDI numbers with no range limit in the data (`MelodyNote`, `src/song/melody.ts:16`). Harmonize already works over 36-96 (`src/song/harmony.ts:70`).
- Vertical scroll: the grid does not scroll up and down today (`overflow-y: hidden`, CSS:546); every row is on the page. A wide range in a window needs a scrolling box and sticky row names.

### 2.2 `DrumMachine` (C/DrumMachine:47) — **needs adapter** (small)

- Props: `beat`, `setBeat(fn)`, `onPick(pattern)`, `playing`, `frame` (bars), `getPos()`, `shown`, `follow`, `active`, `fresh`, `onAll`.
- Also reads the app state directly (C/DrumMachine:67): `state.myBeats`, `state.myKits` (fine, these are libraries), `state.progression.bpm` (line 134), **`state.progression.focus.drums`** as the id of the track whose audio desk it drives (line 139), **`state.progression.song.current`** and the section's time signature to reset an edit (lines 206-212).
- Section assumptions: the reset effect at 208-212; `deskFollowsPage` (line 40) decides whether a knob change goes to the audio desk now, based on "is this section the one sounding". With one desk per track for the whole song this rule becomes "always".
- Adapter: pass the track id and a reset key as props instead of reading `focus` and `song.current` (four lines). The grid, kits, rhythms, edit / undo / save, mixer, sound and effects panels all work unchanged.
- Split needed: the grid half (lines 433-523) is composing; the three panels (525-634) and the Kit picker are sound. They are in one component and share `beat`, `sel`, `solo`, `hit`. Cutting it in two means lifting `sel` / `solo` / `hit` or keeping one component with a `show` prop.
- Note: a `Beat` object holds rhythm **and** kit **and** effects together (`src/audio/beats.ts`). With sound per track, a drum clip should hold only the rows / steps / bars part (the `Snap` type at C/DrumMachine:19 is exactly that subset) and the track holds the rest.

### 2.3 Chords page = `ChordBoard` + `Dock` + `Slot` + `BarRuler` + `ShapeFinder` + `MiniTray` + `HarpPanel` — **needs adapter** (largest of the three)

- These are functions inside GV (not separate files, except BarRuler, ShapeFinder, HarpPanel) and lean on GV for a lot:
  - `ChordBoard` (GV:1110) takes no props; reads `state.key`, `state.progression` (to know guitar or keys), calls `addChord`, `audition`, `openSheet`.
  - `Dock` (GV:1679) props: `voicings`, `keys`, `keyStyle`, `onKeyStyle`, `nowIdx`, `drag`, `onStep`, `onArrange`, `bar`, `onLengths`, `length`, `label`, `onFit`, `shown`, `follow`, `onHarmonize`, `canHarmonize`, `harmonizing`. It also reads **`state.progression.chords` and `.arrange` directly** (GV:1706-1707) and writes chords directly (GV:1723, 1792).
  - `Slot` (GV:1833) writes `state.progression.chords` directly (GV:1840).
  - `ShapeFinder` (C/ShapeFinder:37) props: `slotShape`, `onPinSlot`, `keys`; reads and writes `state.progression.chords` directly (lines 50, 82-91) and the global `sheet` state.
  - `NextChords` (GV:1250) reads `state.progression.chords`.
  - `addChord` in ST:484-496 appends to `state.progression.chords`; `audition` in ST:475-482 reads `progression.focus.chords`.
  - Derived data computed in GV and passed down: `voicings` (guitar shapes arranged together, GV:105-125), `keyVs` (keyboard voicings, GV:133), `trayMidi` (GV:135), `nowIdx` (GV:752-769), `pinSlot` / `stepSlot` / `setArrange` (GV:138-159), `setLengths` / `drop` (GV:820-834), and the whole drag system (GV:836-928).
- Section assumptions: "the chords" always means `progression.chords`. The tray's length is the section's length (`frame`, GV:170). The shape finder closes itself when its chord is no longer on the page (C/ShapeFinder:56-57).
- Adapter, two workable shapes:
  1. **Lens**: keep the existing trick. While a chords plugin window is open on a clip, present that clip's chords / bars / arrange as `progression.chords` etc. to this subtree, and write changes back to the clip. The cleanest way is a second provider of the app context around the window whose `state.progression` and `set` are mapped to the clip. `AppCtx` is not exported today (ST:368), so one export is needed. Nothing inside the chord components changes.
  2. **Props**: give `Dock`, `Slot`, `ShapeFinder`, `NextChords`, `addChord` a `chords` value and a `setChords` writer. About ten call sites. More honest, a bit more work.
- The drag system must be reachable from inside the window (see section 4).
- The sticky tray, the mini tray and the "lifted" tray (CSS:221-225, GV:944-950, 973-976) exist because the Chords page is a long scrolling page. In a window they are not needed: the tray can simply sit at the bottom of the window. `MiniTray` and the `away` observer (GV:75-82) can retire with the page (their job, "the chords in one line", is done by the clip strip at the bottom of the plugin).

### 2.4 `HarpPanel` / `SoundControls` / `SynthPanel` — **easy**

- `SoundControls` (C/HarpPanel:60): `sound`, `setSound`, `onHear`, `inst`, `onAll`, and a slot for extra pickers. Reads only `state.mySounds`. Pure value-in, patch-out.
- `HarpPanel` (C/HarpPanel:239) adds `style`, `onStyle`, `feel`, `setFeel`.
- `SynthPanel` (C/SynthPanel:44): `params`, `onChange`, `onAudition`, `compact`, `compound`. Fully self-contained (its header says so, lines 7-8).
- No section assumptions inside. The parent decides where the sound lives. These become the track's instrument and effects plugins directly; only `onAll` ("All sections") has no meaning any more and its prop is simply not passed.
- What the parent must supply (today GV:369-448): the revived sound, a `setSound` patcher, a `ToneProps` object from `toneSetter` (which also loads the instrument and tells the voice, GV:426-446), and `onHear`.

### 2.5 `VocalsPage` (C/VocalsPage:97) + `TakeLane` (C/TakeLane:75) — **needs adapter for the page, needs rework of how takes are placed**

- Props: `active`, `recordPlan()`, `onRecording(on)`, `recording`, `playing`, `getWhere()`, `onAlone()`.
- Reads directly: `state.studio`, `state.progression.tracks` (vocal tracks, their takes, clips, fx), `bpm`, `key`, `sectionSig`, `opened`, `setRecordingTo`.
- Section assumptions, and they are deep:
  - A recording goes round "the loop, or the section on screen" (`recordPlan`, GV:696-715). The plan lists bars as `{block, bar}`.
  - A take remembers where it was sung as `at: {block, bar}` (`src/song/takes.ts:22`), and clips are laid in the song from there (`layClips`, GV:220-227; `clipBars`, C/TrackPage:321). With no sections, that anchor has to become a place on the timeline (a bar number or a time).
  - The lane draws bars by `{block, bar, letter}` (C/TakeLane:9-16) and finds takes by that pair (C/TakeLane:183-200).
  - `where()` maps the player's `{block, beat}` onto the lane (C/VocalsPage:721-743).
- What is already clip-shaped and reusable: vocal clips are true clips today (a stretch of a take with `from`, `to`, `move`; trim, move, split, delete, swap take: `src/song/clips.ts`). The lane's pointer handling (C/TakeLane:236-312) is the only real "drag a clip, trim its edge, snap to the grid" code in the app.
- Verdict: the recording controls, interface box, vocal sound box and take browser can mount in a window nearly as they are (they talk to the track, not to a section). The lane and the record plan need the timeline's bars instead of section bars: that is an adapter for the lane (`bars` becomes "bars 9 to 16 of the song") and a real change to how takes are anchored.
- Engine life cycle is tied to `active` (C/VocalsPage:210, 225): the interface is kept open "while this page is on screen". In the new world `active` means "a vocals or blank-audio window is open (or recording)". Take care: these rules were tuned against driver crackle (`src/audio/handoff.ts`).

### 2.6 `TrackPage` (C/TrackPage:91) — **needs rewrite into the new track view** (but much carries over; see section 5)

- Props: `sections` (built in GV:805-816), `current`, `loop`, `layout`, `playing`, `getWhere()`, `shown`, `follow`, `active`.
- Everything about it is section-shaped: widths, the ruler, the blocks, the playhead maths.

### 2.7 `FrameSections` (C/FrameSections:45) and the Frame page (GV:1519) — **retires as a page; parts move**

- Sections go away with the free timeline. The key bar (`KeyBar`, GV:988-1061, no props, reads / writes `state.key` and the whole song for transpose), the tempo and time-signature card (GV:1645-1665) and the export card (GV:1667-1674) are independent blocks that can be lifted into a top-bar popover almost unchanged. `chart()`, `midi()`, `wav()` (GV:1556-1618) need the play plan and the list of sections; they will need the new timeline's plan.
- The drag-to-reorder code (C/FrameSections:167-366) is a self-contained vertical list sorter; it could reorder **tracks** in the new view.

### 2.8 `CanvasPage` (C/CanvasPage:112) — **easy**

- Props: `active`, `playing`, `getSpot()`, `rest`, `keyOf`, `onPlay`, `canPlay`.
- `Spot` is `{key, index, beat, bar, bars, spb}` (which painting, colour index, where in it). Today the key is a section's part id (GV:773-787). With no sections it can be one painting for the song, or one per so many bars. It already has a full-screen mode at z-index 80 (CSS:834), so "opens from a button" can reuse that directly.
- It keeps a WebGL painter alive as long as it is mounted (C/CanvasPage:202-219) and only runs its frame loop while `active` (line 399-400). Mount it once, toggle `active`.

### 2.9 `HarmonyPicker` (C/HarmonyPicker:46) — **needs adapter**

- Props: `kind`, `track`, `first`, `anchor`, `onClose`. Uses `AuditionCtx` (GV:690, 931) to audition, and `state.progression` for everything else.
- It "works in the section on screen" (file header, lines 4-12): sources are tracks with music **in this section**, the result is written **in this section**, the record of what was written is kept per section part id (`HarmonyOf.marks`, `src/song/tracks.ts:73-95`), and audition loops the section on screen (GV:669-688).
- In the new world the natural unit is "the bars this clip covers": sources are the clips of other tracks that overlap it. The engine functions (`harmonyMenu`, `writeHarmony`, `rewriteHarmony`, `harmonyState` in `src/song/harmony.ts`) take a whole `Progression`, so the same lens idea as for chords applies: present "this clip's span" as a one-section song to them.

### 2.10 Small shared pieces — **easy, reuse as is**

`Seg` (C/common:5), `Knob`, `Picker`, `Choice` (C/controls:8-48), `BarsControl` / `useBarsView` (C/BarsControl:22-61), `BarRuler` (C/BarRuler:21; props only), `MixMark` (C/MixMark:10), `EqGraph` (C/EqGraph:23; props only), `ChordDiagram`, `KeyboardDiagram`, `ChordNotes` / `ChordTheory`, `InstIcon`, icons, `IdeasPanel`, `SettingsPanel`, `UpdateBar`, `DraftBadge`, `AudioSetup`.

### 2.11 What GV itself does that every composer window will still need from a host

| Need | Today | Lines |
|---|---|---|
| Is it playing; start / stop | `playing`, `togglePlay` | GV:68, 574-638 |
| Where the playhead is inside this content | `getPos()` | GV:744-747 |
| Where it is in the song | `getWhere()`, `getBar()`, `getSpot()` | GV:773-803 |
| The chord lit in the tray | `nowIdx` | GV:752-769 |
| The chords under a melody | `chordsUnder(prog)` | GV:478 |
| Guitar shapes / keyboard voicings for the chords | `voicingsOf`, `keysVoicings` | GV:105-135 |
| The track's sound object and writer | `sound`, `setSound`, `tuneSound`, `setTune` | GV:371, 380, 407-408 |
| The track's instrument and loader | `toneSetter`, `chordInst`, `tuneInst` | GV:426-448 |
| Where a tap is heard | `hearOn("chord" / "melody", …)`: **one global target per kind** | GV:391-392 |
| Audition after picking a rhythm or style | `setAudition` | GV:640-643, 719-729 |
| Reset counters after a paste | `pasted` / `onPasted` | GV:739-740 |

`hearOn` matters: `strum()` and `playNote()` (called from many components) sound on "the track the page shows". With two melody windows open at once (melody and bass) there is still only one "heard melody track". The host should point `hearOn` at the window that has the focus.

---

## 3. "Compose the music" versus "sound and effects": the split, panel by panel

Rule used: if it changes **which notes or hits happen and when**, it is composing and belongs in the composer plugin (and is stored in the clip). If it changes **how the track sounds or is played back**, it belongs to the track's plugins (stored once per track).

### Chords

| Compose (in the Chords composer, stored in the clip) | Sound and effects (track plugins) |
|---|---|
| Chord board: In key / Outside / Next, kinds, cards, pills (rows 84-93) | Instrument switch Guitar / Piano / Synth (113) |
| Tray: slots, order, remove, + Rest, Clear (97, 102, 103) | Harp voice, sound presets, "Mine" (116, 117) |
| Length ruler (101) | Piano model, Keys panel (118, 120) |
| Shape steppers and shape finder: which shape or flavour each chord uses (98, 99, 106-112) | Strings panel (119) |
| Arrange (neck area, strings, inversions) and keyboard Voicing (94, 95). These choose notes, so they are composing, but see the note below | Effects panel (121) |
| Harmonize (96, 206-212) | Synth sounds, macros, full panel (124, 125, 127) |
| Capo (87): a guitar setting that changes shapes; today global | |
| **Judgement calls** | |
| Playing style and Feel (114, 115): they decide strum / pick pattern, speed, swing, octave. Stored per section today. "How it is played" is closer to performance than to sound. Recommended: **per track**, in a "Playing" plugin, because the user said effects and settings live per track and are "heard on every clip". | Synth "way of playing" and arp (126): same reasoning, per track with the synth |

Note on Arrange and Voicing: today the keyboard voicing lives in the track's tone (`tones[id].voicing`) while guitar Arrange lives with the section. If Arrange is per clip, two clips on one track can sit in different neck areas (good for a guitarist reading the chart). If per track, simpler. Either works; per clip keeps today's behaviour.

### Melody (and Bass, which uses the same composer)

| Compose | Sound and effects |
|---|---|
| Grid division (131) | Instrument switch, harp voice, presets, strings / keys panel, effects, synth (142) |
| Bar tabs, copy bar, clear bar, undo (132-136) | |
| Squares: add, remove, paint (138) | |
| Key only, note-name taps (134, 137) | |
| Chord names and fit dots (140): a composing aid, read-only | |
| On / Off (129): today mutes the melody of one section. Becomes "mute this clip" (a clip property) | |
| Harmonize (130) | |
| New for bass: octave scroll and wider range | |

### Drums

| Compose | Sound and effects |
|---|---|
| Rhythm picker and drawer, "Mine" rhythms (146) | Kit picker and drawer, "Mine" kits, save kit (145) |
| Edit, Undo / Cancel / Save, brush, vary, copy bar, clear (147-152) | Mixer panel: drum faders, mutes, kit level (157) |
| Bar tabs and grid (153, 155) | Sound panel: voice per drum and its ten knobs (158) |
| Drum-name tap to hear (154) | Effects panel: vibes, saturation, reverb, echo, sampler, noise, tape, tone, glue, pump (159) |
| On / Off (144): becomes "mute this clip" | Human (159): timing looseness, a playback setting → track |
| **Judgement call**: Swing (159). It is saved with a rhythm in "Mine" (C/DrumMachine:276, 285) and the melody borrows the drums' swing (GV:166, 282). Recommended: keep it with the **clip** (it is part of the groove), default from the rhythm picked. | Drum solo while working (161): stays a listening aid of the kit plugin |

### Vocals (and the blank audio track)

| Compose (here: record and edit) | Sound and effects |
|---|---|
| Record, Rehearse, count-in, click, ★ passes (163-168) | Vocal sound: On, preset, Colour, EQ, Dynamics, Width, Echo, Reverb, Output (179) |
| Lane and clip editing: trim, move, split, delete, comp (169-171) | Apply sound to old takes (173): a consequence of the sound → sits with the sound |
| Take browser (172) | |
| **Neither: device setup** (belongs in audio settings, reachable from the top bar and from the record window) | |
| Interface, buffer, delay, dropouts (174) | |
| Input meters and which input the track records (175): the input choice is per track; the meters are setup | |
| Monitor Direct / Effects, headphone mix, interface reminders, timing nudge (176-178) | |

For the blank track ("accepts all input options from my audio interface"): today a track can only choose Input 1 or 2 (`Track.input?: 1 | 2`, `src/song/tracks.ts:46`; C/VocalsPage:878-880 draws at most two meters, `channels = Math.min(2, …)` at line 705). More inputs and stereo pairs are new work in the page and in the engine.

---

## 4. Sheets, popovers, drag-and-drop, layering, desktop versus phone

### 4.1 There is no floating-window primitive today

Nothing in the app can be dragged around the screen or resized, and nothing uses a portal (`createPortal` does not appear in `src/ui`). The plugin window is new. What exists:

| Kind | How it is done | Where |
|---|---|---|
| Modal sheet | `.sheet-backdrop` (fixed, dim, z-index 60) holding `.sheet`; bottom-anchored on a phone, centred from 761 px; closes on backdrop click and Escape; rendered at the end of the app shell | CSS:269-274; C/IdeasPanel:59-60; C/SettingsPanel:11-12; APP:89-90 |
| Bottom sheet without a backdrop | `.hz-sheet`: fixed at the bottom centre, z-index 60, max 560 px wide, the page stays usable behind it. It measures its own height into a CSS variable so the page gets padding and the undo toast sits above it; it keeps the button that opened it in view | CSS:1324, 1375, 1384; C/HarmonyPicker:107-129 |
| Lifted layer | `.bottom-layer.open`: a fixed full-screen flex column (z-index 40) that holds the shape finder **and** the chord tray together over a dim backdrop, so shapes can be dragged from one into the other. A spacer keeps the page from jumping | CSS:221-225; GV:944-950, 85-89 |
| Inline drawers | Opened under their button, in the flow of the page (`.dm-drawer`, `.dm-panel`, `.fr-pick`, `.ruler-edit`). No positioning, no outside-click handling. This is the app's main "popover" style: quiet and simple | CSS:368, 424, 490; C/DrumMachine:444-474; C/HarpPanel:126-162 |
| Full screen | `.cv.full`: the canvas card becomes fixed, inset 0, z-index 80 | CSS:834-837 |
| Toast | Fixed, z-index 80; plain ones at the top, action ones at the bottom | CSS:157-160 |
| Native boxes | `window.confirm` (six places) and `window.prompt` (one) — see row 217. These are the "popups" to design away | |

Global sheet state: only the shape finder uses app-level state (`sheet` / `openSheet`, ST:393). The other sheets are local `useState` in whoever opens them. Escape handling is repeated per sheet (five separate `keydown` listeners). A window manager should own Escape and focus.

### 4.2 z-index ladder in use

| z | What | CSS line |
|---|---|---|
| 20 | sticky chord tray | 221 |
| 25 | mini tray | 517 |
| 28 | transport strip (sticky under the top bar) | 568, 635 |
| 30 | top bar | 102 |
| 31 | cover for the phone's status-bar area | 81 |
| 40 | lifted shape finder + tray | 223 |
| 60 | modal sheets and the harmony sheet | 269, 1324 |
| 70 | update bar | 871 |
| 80 | toast; full-screen canvas | 157, 834 |
| 90 | drag ghost | 215 |

A free band exists between 40 and 60 for plugin windows (for example 45-59, one step per window for stacking), which keeps sheets, toasts and the drag ghost above them without touching anything else. A clip being dragged out of a plugin onto the timeline must draw above the windows: the existing ghost at 90 already would.

### 4.3 Drag and drop: four separate hand-written systems, all pointer events (no HTML5 drag, except dropping a file on the canvas)

1. **Chord drag** (cards, pills, shape cards, tray slots → tray). A small context: `DragCtx` and `useDraggable(payload, onTap)` in `src/ui/drag.tsx:15-27`; the engine is in GV:836-928. Features worth keeping: mouse drag starts after 6 px, touch after a 230 ms hold with a buzz, a scroll cancels a touch drag, a ghost follows the pointer by setting `transform` on a ref (no re-render per move; React state changes only when the drop index changes), the target row auto-scrolls near its edges, the click that ends a drag is swallowed (`justDragged`), `data-nodrag` opts children out. Limits: the payload type is a chord only (`Payload`, `src/ui/drag.tsx:5-9`), and the drop target is found by querying the DOM for the one tray (`dockRef` / `miniRef` and `[data-slot]`, GV:837-856). **This is the nearest thing to "drag the composed clip from the plugin onto a track"**: generalise the payload (a clip with its kind) and the hit test (track lanes of the matching kind, with a time position), keep the gesture rules.
2. **Section reorder** (C/FrameSections:167-366): vertical list sorting done with direct style changes, a dashed slot, auto-scroll, FLIP glide, keyboard moves, Escape to cancel. Reusable for reordering tracks.
3. **Clip trim / move** on the vocal lane (C/TakeLane:236-312): pointer capture on the clip, edge grips (`data-edge`), tap versus drag at 5 px, snap to sixteenths with Alt / Shift to go free, touch rule "first tap selects, then it can move" so a swipe still scrolls. Positions are fractions of the lane width. **This is the template for moving clips on the timeline and for edge drags**; the new edge drag means "repeat the clip", not "trim", so only the gesture carries over.
4. **Chord-edge drag** on the length ruler (C/BarRuler:65-95): pointer capture, half-beat steps.

Also pointer-capture patterns in: grid painting (C/MelodyGrid:256-280, C/DrumMachine:314-342), macro knobs (C/SynthPanel:215-225), EQ points with wheel (C/EqGraph:72-87, 118-120).

There is **no drag-across-a-ruler-to-select-a-range** anywhere yet (the loop is set by tapping bars), no zoom, and no wheel handling for sideways scroll. The new ruler is new code.

### 4.4 Selectors other code depends on (will break silently if the markup changes)

- `hands.ts:43` treats presses inside `section.transport` and `nav.tabs` as "not editing" (for Follow).
- C/FrameSections:274 measures `.transport` for auto-scroll.
- APP:60 reads `.topbar`.
- C/TrackPage:222 looks up `.tv` and `.tv-head[data-track]`.
- CSS variable `--bar-h` (CSS:625, 643) positions the transport under the top bar.

### 4.5 Desktop versus phone, as built

- Breakpoints by width: 520, 620, 640, 720, 760 / 761, 900, 960 px; and `pointer: coarse` for touch sizes (bigger knobs, grips and hit areas: CSS:461, 495, 903, 964, 1126, 1276, 1350).
- At 960 px and below the top bar wraps: the page tabs get their own row and the name and buttons scroll away (CSS:640-651). At 620 px the key / tempo summary hides (CSS:655) and "Bars on screen" folds into a menu (CSS:1148-1152).
- Default bars on screen: 4 on a wide screen, 2 on a tablet, 1 on a phone (`defaultShown`, `src/song/window.ts:25`).
- Track page on a phone: track heads shrink from 212 to 132 px and re-flow (CSS:885, 938-951).
- Grids on a phone: wider cells and scroll-snap per bar (CSS:1188-1192).
- Touch-specific behaviour is in the code, not only the CSS: long-press to drag chords (GV:921), hold a row to reorder (C/FrameSections:349), a finger's tap on a grid is taken on click so it can scroll (C/MelodyGrid:260; C/DrumMachine:317-323), a finger must select a clip before moving it (C/TakeLane:255-258).
- `isDesktop()` (`src/desktop.ts:8`) switches on: recording (C/VocalsPage:133, 815-820), the audio-interface box (C/Desktop:59), updates (C/Desktop:9), better canvas layers (C/CanvasPage:64). The web build must keep working without any of them.
- Safe-area insets for phones are handled throughout (CSS:80-81, 102-105, 223-224).
- For the rework: "Windows desktop first" fits how things are (one wide layout plus overrides). For the phone, the simplest path that does not break the web build is to present a plugin as a full-width bottom sheet (the existing `.sheet` pattern) instead of a floating window, using the same component inside.

---

## 5. The current Track page in detail

File: C/TrackPage (413 lines). Mounted at GV:935-937 with data prepared at GV:805-816.

### 5.1 Data it draws

- `sections: TrackSection[]` (C/TrackPage:24-41): for each section in playing order: `block` id, `label`, `color`, `bars`, `bar` (beats per bar), the first chords track's `chords`, the first melody, the first drums `Beat`, `layers` (the added tracks' content in that section), `tones`, and `instead` (which chords tracks a harmony replaces there). Built from `secs` and `plan.per` so lengths match what plays.
- `tracks = allTracks(normalize(prog))` (C/TrackPage:111): always "Chords", "Melody", "Drums" first (the fixed first tracks with ids `chords`, `melody`, `drums`), then added tracks in the order they were added (`src/song/tracks.ts:133-141`). **There is no way to reorder tracks and no track without a kind.**
- A track "is in" a section when it is one of the first three, or a vocal track, or the section has a layer for it (`isIn`, C/TrackPage:66).

### 5.2 Layout

- A flex row (`.tv`, CSS:883): a fixed column of heads (`.tv-heads`, 212 px, CSS:885) and a sideways-scrolling box (`.tv-scroll`, CSS:906) holding `.tv-lanes`, whose width is the whole song in pixels.
- Row heights are fixed: ruler 34 px (CSS:886, 916), each track 52 px (CSS:887, 908), add row 44 px. Heads and lanes are two separate columns kept in line only by those equal heights. There is **no vertical scrolling of tracks inside the view**: the page itself scrolls.
- Bar width `bw` = lane width ÷ bars on screen, never under 12 px (`MIN_BAR`, C/TrackPage:80, 129-131). "Zoom" today is only the 1 / 2 / 4 / 8 / All choice. The bar at the left edge is kept when the width changes (C/TrackPage:133-137).
- Bar numbers thin out as bars get narrow: every 1, 2, 4 or 8 (C/TrackPage:260).
- Width is measured with a `ResizeObserver`; a hidden page keeps its last width (C/TrackPage:121-128).

### 5.3 Track head (C/TrackPage:279-296)

One grid cell per track: instrument icon + name button (opens the page) + ✕ for added tracks; M and S buttons; a volume slider with a dB readout; ⟳ for a harmony track when it is in the section on screen. Faint when not audible (`quiet`). A phone layout re-flows it (CSS:938-951, 1366-1369). Mixer state is `prog.mix[trackId] = {db, mute, solo, instead}` for the whole song (`src/audio/mix.ts:11-19`), pushed to the audio faders by GV:819. This already matches "per track for the whole song".

### 5.4 Ruler and blocks

- Ruler: one cell per section, tinted with the section's colour, its name as a button (choose the section), bar numbers, looped bars shaded (C/TrackPage:309-318). **The loop cannot be set here**; it is only shown.
- Blocks: `content(t, s)` picks the right data for an added track (C/TrackPage:68-72). Each block is a `<button>` the width of its section. Inside:
  - `ChordBlock` (354-365): a span per chord, as wide as it is long, with its name when there is room, coloured by in-key / borrowed / chromatic.
  - `MelodyBlock` (367-379): an SVG of small rectangles; the vertical scale is shared by the whole song (`range`, 149-152).
  - `DrumBlock` (381-401): an SVG with three lanes (cymbals, middle, kick); the pattern is repeated across the section's bars; opacity by hit strength.
  - `TakeBlock` (405-413): the vocal clips that lie under this section, positioned by `clipBars` (`src/song/clips.ts`).
- Where a track is not in a section: a faint "+" to put it there (325-330).
- These four mini drawings are exactly what a clip on the new timeline should show. They take `{s, bw}`; changing `s` from "a section" to "a clip's content and length" is a small edit.

### 5.5 Playhead and following

- One absolutely positioned line (`.tv-line`, CSS:937). A `requestAnimationFrame` loop reads `getWhere()` → `{block, beat}`, converts to pixels with the section's start, and sets `transform` directly on the element. No React state per frame (C/TrackPage:156-178). The loop only runs while the page is `active` and `playing`.
- With Follow on, when the line leaves the visible lanes the scroll jumps a whole page (169-172). With Follow off it never moves by itself.
- Choosing a section (anywhere) scrolls it into view (182-204); a track added on another page flashes and is scrolled to (208-227).

### 5.6 What is missing compared with the target view

No clips (blocks are tied one-to-one to sections); no drag of anything; no click-to-place playhead (play always starts at the section on screen, GV:616); no range selection on the ruler; no zoom beyond the bars-on-screen choice; no visible scroll bar on the lanes on some systems (the transport's strip hides its bar outright, CSS:768-769; the track lanes use the default); no track reordering; no per-track "open composer" or "open effects" buttons (the name does both by switching page); no blank / audio track kind (`TrackKind` is `chords | melody | drums | vocals`, `src/song/tracks.ts:35`; there is no bass kind either); adding a track gives it only to the section on screen.

### 5.7 What carries over

The two-column structure, the head controls and their mixer wiring, the `ResizeObserver` width logic, the keep-left-bar rule, bar-number thinning, the rAF playhead with page-turn follow, the four mini drawings, `trackAdded` (with its test, `src/ui/components/trackadd.test.ts`), the "new track flashes" cue, and the add-track chooser (needs more kinds).

---

## 6. Performance notes (the app has had audio crackle tied to main-thread work)

### 6.1 How playback depends on the main thread

- The song is scheduled from a timer on the page, a quarter of a second ahead (`src/audio/synth.ts:698-701`). If the page is busy for longer than that, notes are booked late. Safeguards already built, all worth keeping:
  - `bookAhead()` books one second ahead around a page switch (APP:49-53; `src/audio/synth.ts:399-404, 566-583`). **Opening a plugin window is the new "page switch": call it there too.**
  - Late notes start part-way into their sound instead of piling up (`src/audio/late.ts:1-14`).
  - The audio context asks for the larger buffer (`latencyHint: "playback"`, `src/audio/context.ts:23-28`).
  - Effects turned to zero are disconnected so the audio thread does less (`src/audio/gate.ts:1-19`).
  - A safety limiter on the master (`src/audio/safety.ts`).
- A voice is made for each track **for each different instrument-and-sound setting it has** (`slotOf`, `src/audio/synth.ts:56`; `keepSlots`, GV:386-388): a track that sounds different in two sections has two voices alive. Sound per track for the whole song means one voice per track and less audio-thread work: the rework should help here.

### 6.2 What re-renders, and when

- **During play, nothing re-renders per frame.** Every moving thing is a `requestAnimationFrame` loop that touches the DOM directly: transport bar mark (GV:1458-1480), track playhead (C/TrackPage:156-178), melody line (C/MelodyGrid:163-218), drum playhead (C/DrumMachine:144-197), vocal lane line (C/TakeLane:140-172), canvas (C/CanvasPage:433-578). Loops on hidden pages do not run (`active` flag). Keep this pattern for the timeline playhead and every plugin window, and stop a window's loop when it is closed or covered.
- **Per chord while playing**: `setNow` (GV:629) re-renders `GuitarView` at every chord change of the first chords track. Because the heavy children are wrapped in `memo` (`KeyBar`, `ChordBoard`, `MelodyGrid`, `DrumMachine`, `TrackPage`) and GV takes care to keep their props stable (about 70 `memo` / `useMemo` / `useCallback` uses in GV; comment at GV:467), they skip. `Dock`, `FramePage`, `VocalsPage`, `CanvasPage`, `Transport`, `ClipBar` and `HarpPanel` are **not** memoised and do re-render on each chord change, hidden or not. Another chords track on screen polls with its own rAF and `setOtherNow` (GV:758-768), which only changes state when the chord index changes.
- **Per edit**: every edit replaces `state` (ST:392), and `useApp()` hands the whole state to every consumer, so **every component that calls `useApp()` re-renders on every edit**, on every page, because all seven pages are always mounted (GV:935-968). There are no selectors. With several plugin windows open plus the track view this is the main cost to watch.
- **The play plan is rebuilt on every edit**: `plan` (GV:204-307) walks every section and every track, runs guitar-shape arranging (`voicingsOf` → `arrangeProgression`) and keyboard voicing for each chords track in each section, and de-duplicates shared objects with `JSON.stringify` (GV:231-235). It depends on `prog` as a whole through `secs` (GV:198). Then `slotsOf`, `keepSlots`, `p.update(...)` (an effect with **no dependency list**, GV:541-570, so it runs after every render) and a 250 ms-debounced `prepareNotes` (GV:394-397, also every render) follow. Dragging a knob produces a stream of these.
- **Every edit also writes the whole app state to local storage**, synchronously, with two `JSON.stringify` passes including the whole library of saved ideas (ST:402-419), and computes `dirty` by fingerprinting the song (ST:500-504). On a large library this is real main-thread time on every knob movement. It is not debounced.
- Per-bar memo in the grids: a bar re-renders only when its own notes change (the bar's content is passed as one string: C/MelodyGrid:113-121, 361; C/DrumMachine:520, 643). Good, keep.
- `Wave` in the drum sound panel renders a drum offline at 16 kHz in a `useMemo` on the main thread whenever a shape knob moves (C/DrumMachine:684-704). Small but synchronous.
- Canvas: the cloth texture is woven in 7 ms slices (C/CanvasPage:324-345), swatches are painted in idle time (252-266), legend state updates are throttled to about 4 per second (535-550). It is the heaviest page; GV's comment and `bookAhead` exist mostly because of it.
- Track page: every block is re-rendered when `sections` changes (any edit), with one DOM node or SVG rect per chord, note and drum hit. Fine at today's sizes (sections up to 32 bars); a long free timeline with many clips will want each clip memoised by its content, and probably only the clips in view drawn.

### 6.3 Fragile spots to respect

1. The no-deps effect at GV:541-570 and the bookkeeping of "lists by generation" (GV:351-360, 538-570) are what make loop changes and live edits seamless. They assume the plan's `map` entries are `{block, idx}`. A new timeline plan must give the same guarantees (position survives an edit; a queued change lands on a boundary).
2. `deskFollowsPage` (C/DrumMachine:40, tested in `drumdesk.test.ts`): drum knob changes go to the audio desk only if this section is the one sounding. With per-track kits this rule should go, but something must still stop a stream of `syncDrums` calls from thrashing the desk while a knob is dragged (today `audition` throttles the audible hit to one per 130 ms, C/DrumMachine:233-245).
3. Interface hand-off rules for recording (`src/audio/handoff.ts`, `src/audio/through.ts`; used at C/VocalsPage:193-334): the app's own sound and the recording engine must not both play through the interface. They hinge on `active`, `playing`, `recording`, `monitor`. Re-mapping `active` to "window open" must keep "close the engine before the app plays".
4. Instrument loading races are guarded with `lastOnly` / `lastOnlyEach` (`src/ui/latest.ts`; GV:424, 593). Keep using them when a window changes an instrument.
5. `hearOn` is global per kind (GV:391-392): see 2.11.
6. Follow and "hands busy" (GV:508-526, `src/ui/hands.ts`): pages wait to turn while a control is held, because every control writes to "the section on screen". Once a window is bound to one clip this danger goes away, and so can the cross-section Follow. The per-view Follow (timeline scroll, grid page turn) stays.
7. All pages stay mounted so their local state survives a tab change (grid position, open drawers, drum edit in progress, vocal undo list, the canvas painting). Windows that unmount on close will lose that unless it is lifted or the window is hidden instead of removed. The drum "edit in progress" and the vocal undo stack are the ones a user would notice.

---

## What can be reused as is

- All small controls: `Seg`, `Knob`, `Picker`, `Choice`, `MixMark`, `InstIcon`, icons, `EqGraph`, `ChordDiagram`, `KeyboardDiagram`, `ChordNotes`, `ChordTheory`.
- `SoundControls`, `HarpPanel`, `SynthPanel` (all value-in, patch-out): they become the track's instrument and effect plugins.
- `MelodyGrid`: takes a melody and a writer; no app-state reads. Also the Bass composer once its rows can shift octave.
- `BarRuler` (chord lengths) and the bar-window arithmetic in `src/song/window.ts`.
- `IdeasPanel`, `SettingsPanel`, `AudioSetup`, `UpdateBar`, `DraftBadge`, the toast and undo-toast.
- `KeyBar`, the tempo / time-signature card and the export card from the Frame page, lifted into the top bar.
- `CanvasPage`, opened from a button using its existing full-screen mode.
- The mixer model (`prog.mix`, `src/audio/mix.ts`) and the track head controls.
- The track view's mini drawings (`ChordBlock`, `MelodyBlock`, `DrumBlock`, `TakeBlock`), its rAF playhead, width logic and bar-number thinning.
- Vocal clips as a data model (`src/song/clips.ts`) and the take browser, record controls, interface box and vocal sound box.
- Libraries: saved rhythms, kits, sounds, chord shapes.
- Safeguards: `bookAhead`, late-note handling, effect gates, `lastOnly`, the sheet and z-index conventions, safe-area handling.

## What needs an adapter

- **Chords composer** (`ChordBoard`, `Dock`, `Slot`, `ShapeFinder`, `NextChords`, `addChord`, `audition`): they read and write `state.progression.chords` directly. Feed them a clip through a lens (a nested app-context provider mapped onto the clip) or through `chords` / `setChords` props.
- **`DrumMachine`**: pass the track id and a reset key instead of reading `focus.drums` and `song.current`; split the grid half from the kit / mixer / sound / effects half; separate "rhythm" (clip) from "kit and effects" (track) inside `Beat`.
- **`HarmonyPicker`** and the harmony functions: "this section" becomes "the bars this clip covers".
- **`VocalsPage` / `TakeLane`**: lane bars become timeline bars; `active` becomes "window open"; the record plan comes from the ruler's loop range.
- **The chord drag system** (`DragCtx`, GV:836-928): widen the payload beyond chords and the hit test beyond the one tray, so a clip can be dragged from a plugin onto a lane of the matching kind.
- **The lane's clip gestures** (C/TakeLane:236-312): reuse for moving timeline clips and for edge drags (with "repeat" in place of "trim").
- **Section reorder code** (C/FrameSections:167-366): reuse to reorder tracks.
- **Copy / paste** (`src/song/clip.ts`, `ClipBar`): the per-kind clipboards already hold "a chords clip", "a melody clip", "a drum clip" with their key; they map naturally onto timeline clips.
- **Per-section sound → per-track sound**: every "All sections" button goes; the one-time conversion must choose one sound per track where sections differed (a visible decision, since differences would otherwise be lost).
- **Playhead getters** (`getPos`, `getWhere`, `getBar`, `getSpot`): same shape, fed from timeline time instead of `{block, beat}`.
- **Chart, MIDI and WAV export**: same functions, fed from the new plan.

## What must be new

- The **floating plugin window**: draggable, stackable, closable, focus-aware, with a phone fallback as a bottom sheet; a small window manager that owns Escape, stacking order (a free z-index band exists between 40 and 60), and which window `hearOn` points at.
- The **timeline with clips**: a clip model for chords, melody / bass and drums (vocals already have one), free placement, move, copy as separate copies, edge drag to repeat, double-click to reopen in its composer, kind-checked drops.
- The **ruler**: drag across it to set the loop range, click to place the playhead, sideways scroll with a visible scroll bar, zoom (wheel and buttons). None of this exists; today's loop is "tap bars on a strip with a hidden scroll bar".
- The **play plan from clips** in place of the plan from sections (GV:204-307), keeping live-edit and loop-change behaviour.
- The **clip strip at the bottom of each composer** showing the clip being made, draggable onto the timeline.
- **Track kinds**: Bass and a blank audio track; more than two inputs and stereo for the blank track; an "open composer" icon button and an "effects" entry per track head; track reordering.
- The **top bar**: key, tempo, time signature and export as compact controls or popovers; a Canvas button; no page tabs.
- **One-time conversion** of section songs into clips in the same order, with the original kept as a backup copy in the ideas list.
- Decisions the old model answered by section and the new one must answer some other way: per-section time signatures (a free timeline has no sections to hang them on), where take anchors live, what a harmony track's "source" is.
- Worth adding while here, because the new view makes their absence obvious: Space to play / stop, a global undo, and debounced saving to storage (today every knob movement rewrites the whole library synchronously).
