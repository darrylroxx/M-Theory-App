# How REAPER's track view behaves (research note, public sources only)

Research note for the track-view rework. Behaviour only, in my own words. Nothing here comes from the program's source code. This file is a research note: product names appear here and must not be copied into text meant for the app.

## How far to trust each line

Direct page fetches were blocked in this environment (`www.reaper.fm` and `www.cockos.com` did not resolve; they would have to be allowed in the session's network settings). So **no page was read in full**. Every sourced fact below was confirmed only from web-search summaries of the named page.

| Tag | Meaning |
|---|---|
| **[SEC]** | Confirmed only from a search summary of the source named next to it. |
| **[SEC-weak]** | Search summary of a forum post or a single user's report; not official. |
| **[MEM]** | From general knowledge of the program; **no source confirmed it in this session**. Check in the real program before relying on it. |
| **[IDEA]** | My suggestion for the simpler app, not a fact about the program. |

All shortcuts are factory defaults on Windows. The program lets users rebind every key and every mouse gesture, so screenshots and videos often show non-default behaviour [SEC: Cockos wiki "Preferences Mouse Behavior"; kvraudio.com forum "The hell of using multiple DAWs: mouse wheel gestures"].

Source short names used below:

| Short | Site / page title |
|---|---|
| QS | reaper.fm, "REAPER Quick Start" (one-sheet PDF) |
| WN7 | reaper.fm, "What's New in REAPER 7 Summary" (PDF) |
| TS | reaper.fm, "Appendix: Troubleshooting REAPER" (PDF) |
| ABOUT | reaper.fm, about page ("Digital Audio Workstation") |
| FXG | reaper.fm, "ReaEffects Guide" (PDF) |
| UPD | dlz.reaper.fm, "REAPER Update Summary Guide" / "REAPER main changes 665 to 668" (PDF) |
| GK | user.cockos.com, "ReaperKeyboardShortcuts.pdf" (old default-key summary) |
| CW:<page> | Cockos wiki, page title given after the colon |
| RB:<post> | reaper.blog, post title given after the colon |
| SOS:<article> | soundonsound.com technique article, title given |
| TUTS:<article> | music.tutsplus.com tutorial, title given |
| ASK | ask.audio, "Ripple Editing in Reaper" |
| VPL | vpl.ca guide, "Recording Audio with REAPER" |
| HR | homerecording.com forum, "What does this record monitoring switch do?" |
| PRO | ProRec.com article on loading a virtual instrument (title not shown in the search result) |
| AG | forum.audiogames.net post on the virtual-instrument command |
| DSU | dsu-digital-sound-design.github.io course pages ("MIDI Introduction in Reaper", "Basic Voice Recording in Reaper") |
| KVR:<thread> | kvraudio.com forum thread, title given |
| AUD | audeobox.com, "Reaper MIDI Editor: Complete Guide to the Piano Roll" and "Reaper keyboard shortcuts cheat sheet" |
| RA | reaperaccessibility.com wiki ("Reaper Preferences General", "Reaper shortcut key list by headings") |
| OBS | publish.obsidian.md notes ("Pre-roll in Reaper", "Markers and regions in Reaper") |
| ECO | ecomap.tistory.com translated guide pages |
| UNT | untidymusic.com, "Markers and Regions" |
| GM | groovemonkee.com, "How to install and use Reaper drum maps (MIDI Note Names)" |
| MA | powerdrumkit.com help page on drum maps |

---

## 1. Screen layout

### 1.1 The parts of the main window

- **Track control panel** on the left: one row per track, lined up with that track's lane in the arrange view. Commonly shortened to "TCP" [SEC: RB "REAPER 101: the track control panel"].
- **Arrange view** to the right of it: the timeline. Each track's lane holds its media items (clips). A **ruler** runs along the top [SEC: CW "Main Edit View", CW "Time Ruler"].
- **Transport**: play, stop, pause, record, a repeat (loop) toggle, go-to-start and go-to-end, plus readouts for position, tempo, time signature and the current selection [MEM for the full list]. Right-clicking the record button chooses the record mode [SEC: summary of VPL / QS]. The repeat button can also be toggled with `R` [SEC: QS].
- **Mixer**: one vertical strip per track plus the master, for volume, pan and inserting effects [SEC: CW "Mixer Control Panel (MCP)"]. Shown and hidden with `Ctrl+M`, usually docked along the bottom [MEM]. The mixer and the track panel are two views of the same track; changing volume in one changes the other [MEM].
- A main toolbar with toggles users rely on: snap (magnet), grid settings, ripple editing, auto-crossfade, metronome [SEC: SOS "Reaper: best ways of hiding an edit" for the snap magnet; TUTS "How to use Reaper tempo, grid and snap settings" for the grid button; ASK for the ripple button; OBS for the metronome button].

### 1.2 What a track row shows

Confirmed pieces [SEC unless noted]:

- **Name field**. Double-click it to type a name [SEC: QS "Name tracks: double-click track name area"].
- **Record-arm button** (round, red when armed). Click to arm. Right-click opens a menu for the input and for monitoring [SEC: QS].
- **Input chooser** and **monitoring button**. In version 7 these two are only visible once the track is armed [SEC: WN7].
- **Mute** and **Solo** buttons. Alt-click on solo switches between plain solo and "solo in place" [SEC: summary of a user-guide copy]. Ctrl-click on mute or solo makes it exclusive (clears the others) [MEM].
- **Volume**: a knob in a narrow panel that turns into a horizontal fader when the panel is made wider [SEC: summary citing the user guide]. Drag to change [SEC: RB track control panel]. Double-click resets to 0 dB [MEM].
- **Pan** control, with a right-click menu for pan mode and pan law [SEC: CW "Mixer Control Panel (MCP)"].
- **FX button**, with a small **chain bypass button right next to it** [SEC: QS "Bypass track FX: click the track FX bypass button, next to the FX button"]. The FX button is lit (green in the default look) when the chain is not empty [MEM].
- **Level meter** [SEC: RB track control panel].
- Also present in the default look: track number, routing/sends button, automation (envelope) button, phase-invert button, folder button [MEM, except the folder button which is SEC: CW "Folders"].
- Right-clicking almost any control opens a menu of that control's options [SEC: RB track control panel].
- Which controls are visible depends on the row's height and width: small rows hide controls [MEM; one forum user notes the monitor icon is hard to see unless the lane is made bigger, SEC-weak: HR].

There are **no track types**. Any track can hold audio items and MIDI items, record either, and carry any effects or instruments [SEC: ABOUT].

### 1.3 Adding, naming, ordering, sizing, colouring, folders

- **Add a track**: `Ctrl+T`, or the Insert/Track menu, or **double-click the empty area below the last track row** [SEC: QS]. The new track goes below the selected track [SEC: CW "Track Menu Bar"].
- **Name**: double-click the name area, type, Enter [SEC: QS].
- **Reorder**: drag a track row up or down by an empty part of its panel; a line shows where it will land [MEM].
- **Resize height**: drag the bottom edge of one track row [MEM]. All rows at once: `Ctrl+mouse wheel`, or `Page Up` / `Page Down` [SEC: QS].
- **Colour**: right-click the track row, choose a track colour (custom or random). Items on the track take the track colour unless given their own [MEM].
- **Delete a track**: select it and press `Delete` while the track panel has focus, or use the right-click menu [MEM].
- **Folders**: a folder is just a track whose following tracks are marked as its children. Clicking the small folder button on a row cycles it through "normal track", "folder parent" and "last track in the folder" [SEC: CW "Folders"]. Dragging tracks onto another track is the other way to make a folder [SEC: SOS "Groups, folders, matrices"]. Children's sound passes through the parent, so the parent's volume, mute, solo and effects act on the whole group [MEM]. A collapse button on the parent cycles the children between normal, small and hidden [SEC: WN7 lists "Folder collapse track cycle options"; detail MEM].

---

## 2. Media items (clips)

### 2.1 Select

- Click an item to select it. Ctrl-click adds or removes one; Shift-click selects a range [MEM].
- By default a click on an item **also moves the edit cursor** to the clicked time [MEM]. (This surprises new users, see section 7.)
- **Right-drag in the arrange view draws a marquee** that selects every item it touches [SEC: QS "Marquee select items: right-drag"].
- Left-click in an empty area selects nothing and moves the edit cursor there [SEC: GK].
- `Ctrl+A` selects all items [MEM].

### 2.2 Move and copy

- **Drag the body** of an item to move it. The drag is free in both directions at once: sideways changes the time, up or down changes the track [SEC: QS lists moving items by drag; detail MEM]. All selected items move together and keep their spacing [MEM].
- **Ctrl+drag makes a copy** and drags the copy [SEC: TUTS "How to edit audio in Reaper"].
- **Shift held during a drag ignores snapping** [SEC: a copy of QS]. Another copy of the same sheet gives Shift+Ctrl for "ignore snap" when moving a time selection, so the exact key differs by context [SEC: QS].
- **Alt+drag on the body slips the contents**: the item stays put and the sound inside it slides [SEC: QS "slip item contents"].
- Dragging an item below the last track creates a new track for it [MEM].
- Copy, cut, paste are `Ctrl+C`, `Ctrl+X`, `Ctrl+V`; paste lands at the edit cursor on the selected (last-touched) track [MEM].
- **Duplicate** is `Ctrl+D`: the copy is placed straight after the original [SEC: summary of cheat sheets, e.g. AUD].

### 2.3 Split and delete

- **`S` splits at the edit cursor.** If items are selected, only those are split. **If nothing is selected, every item under the cursor on every track is split** [SEC: CW "Item Editing"].
- After a split both halves stay; by default the right-hand piece ends up selected [MEM].
- `Shift+S` splits at both ends of the time selection [MEM].
- **`Delete` removes the selected items** [MEM; standard default, but the search only confirmed `Ctrl+Delete` for "cut the selected area of items", SEC: summary of a cheat sheet].
- Splits get a tiny automatic fade on each side (see 2.6).

### 2.4 Trim by dragging an edge

- Hover near an item's left or right edge: the pointer turns into a double-headed arrow. Drag to move that edge [SEC: CW "Item Editing"; QS "Edit item start/end: drag item left or right edge"].
- Trimming never moves the sound in time. Dragging the **left** edge to the right hides the start of the sound; the rest stays where it was on the timeline [MEM].
- Edges snap to the grid when snap is on; Shift frees them [SEC for snap bypass with Shift: QS copy; MEM for edges].
- An edge cannot cross the other edge: the item cannot be dragged to zero or negative length [MEM; no documented minimum found].
- Trimming does not change the file: edits belong to the item, the source is untouched [SEC: CW "Item Editing"].
- Alt+drag on an edge stretches the item (changes its speed) instead of trimming [MEM].

### 2.5 Looping by dragging an edge past the source end ("loop item source")

This is the behaviour the rework most needs to match.

- Every item has a **"Loop source" switch**. It lives in the item-properties window and in the item's right-click "Item settings" menu, and **it is on by default** [SEC: CW "Loop Source"]. There are separate defaults for imported items, new MIDI items, recorded items and glued items [SEC: summary of a settings tutorial; an MIT course handout tells students to untick "Loop source for imported items"].
- With the switch on: **drag the right edge further right, past the end of the source, and the item keeps growing and the content starts again from the source's beginning** [SEC: QS "Loop item: drag item right edge further right"; CW "Item Editing"]. It repeats as many times as the item is long; the last repeat can be partial [MEM].
- **Each point where the source restarts is drawn as a notch in the item's edges** (small cut-ins at the top and bottom border) [SEC: CW "Item Editing": each loop point is "indicated by a notch in the edges of the Item"].
- **The repeat length is the length of the source, not the length of the item as trimmed** [SEC: CW "Item Editing": the loop point "is defined by the duration of the source Media"]. Consequence [MEM]: if an item was trimmed to show only the middle of its source, dragging the right edge out first reveals the hidden tail of the source, and only then wraps to the source's start. The trimmed-off beginning comes back in every repeat.
- To loop only a part of the source: slip or trim to the wanted part, then turn on **"Loop section of item"** [SEC: CW "Loop Source"]. The other common way is to "glue" the item, which writes a new source exactly the item's length, and then loop that [MEM].
- **Left edge**: dragging the left edge to the left extends the item backwards. The sound already visible stays fixed in time. Past the source's start, the item shows the **end** of the source again, so it loops backwards too [SEC-weak: one user in KVR "waveform: moving the start of a clip TO THE LEFT" says that in this program "you can drag the start left and it loops and duplicates the contents"; rest MEM]. A notch marks that boundary as well [MEM].
- With the switch **off**: the item can still be dragged longer than its source, but the extra part is empty and silent [MEM; a KVR "Newbie Reaper Question" thread recommends unticking "Loop item source" before dragging the edge, SEC-weak].
- All items except "empty items" can loop [SEC: CW "Item Editing"]. That includes MIDI items (section 6).
- Snap applies to the dragged edge as for any trim, so a loop can end mid-repeat on any grid line [MEM].
- Fades stay attached to the item's two ends; they are not repeated at each notch [MEM].

### 2.6 Fades

- Each item has a fade-in and a fade-out. The handle is at the top corner of each end; drag it inwards to lengthen the fade [SEC: QS "drag item fade handle"; "top corner" is MEM].
- New items and both sides of a split get a short automatic fade. **The default is 10 ms** [SEC: RA "Reaper Preferences General"; CW "Preferences Editing Behavior" says the default fade length applies to splits].
- With **auto-crossfade** on (a toolbar toggle, `Alt+X`), dragging one item so it overlaps another on the same track creates a crossfade across the overlap [SEC: SOS drum-editing articles]. Without it, overlapping items on one track simply both play [MEM].
- Right-clicking a fade offers curve shapes [MEM; CW "Preferences Mouse Behavior" confirms fades have their own click/drag/double-click options, SEC].

### 2.7 Snap and the grid

- Snap is one toggle: the magnet button or `Alt+S` [SEC: SOS "Reaper: best ways of hiding an edit"].
- Grid spacing is chosen in a snap/grid settings window, opened by right-clicking the grid button [SEC: TUTS tempo/grid/snap tutorial; SOS]. Spacing is a note value (1/4, 1/8, 1/16, triplets and so on) [MEM].
- Snap targets can include the grid, item edges, markers, the cursor and the time selection, and there is a "snap distance" in pixels so snapping only pulls when close [MEM].
- An item snaps by its start (or by a "snap offset" point set inside it) [MEM].
- Holding Shift while dragging ignores snap [SEC: QS copy].
- Grid lines are thinned out when zoomed far out so they never get too dense on screen [MEM].
- Inserting a note or item by action obeys snap: with snap on it lands exactly on the grid [SEC: CW "MIDI event insertion actions"].

### 2.8 Ripple editing, briefly

- Three states, cycled by one toolbar button: **off** (the default), **per track**, **all tracks** [SEC: ASK; CW "Options Menu Bar"]. Shortcut `Alt+P` [MEM].
- Per track: deleting, moving or inserting an item shifts every later item on that track by the same amount. All tracks: later material on every track shifts, markers included [SEC for the states: ASK; shifting detail MEM].
- Left on by accident it moves things the user did not mean to move (section 7).

### 2.9 Item properties

- `F2`, or right-click then "Item properties" [SEC: summary of QS and a cheat sheet].
- The window holds, among other things: position, length, fade in/out lengths and shapes, the **loop source** tick box, mute, lock, take name, start offset into the source, pitch shift, playback rate with "preserve pitch", volume and pan, reverse [SEC for loop source and mute: CW "Item Properties"; rest MEM].

### 2.10 Double-click

- **Double-clicking a MIDI item opens it in the MIDI (piano-roll) editor** [SEC: AUD MIDI editor guide]. `Ctrl+Alt+E` does the same from the keyboard [SEC: AUD].
- **Double-clicking an audio item opens item properties** by default [MEM].
- What double-click does is a preference, and Shift+double-click triggers the alternative [SEC: CW "Preferences Mouse Behavior"].
- `Shift+double-click` on an item sets the time selection to that item [SEC: QS].

---

## 3. Time selection, loop, cursor, zoom, markers

### 3.1 Time selection and loop points

- **Drag in the ruler** to set the loop range [SEC: QS "click and drag the timeline to define a loop selection"; CW "Main Edit View"].
- **Drag in an empty part of a track lane** to set the time selection [SEC: QS "click and drag an empty track area for a time selection"; ECO].
- An option, **"Loop points linked to time selection"** (Options menu), makes the two the same thing: setting either sets both. With it off they are two separate ranges [SEC: QS; CW "Reaper for Post Production"]. It is on in a fresh install [MEM].
- The ends of the selection can be dragged in the ruler to adjust it [SEC: CW "Reaper for Post Production"]. Shift+drag moves the whole selection [SEC: QS]. `Esc` clears it [MEM].
- Both snap to the grid when snap is on [MEM].
- The selection is drawn as a lighter band down the whole arrange view; the loop range is a marked stretch of the ruler [MEM].
- Double-clicking a region's bar in the ruler sets the selection to that region [SEC: UNT; TUTS "How to use Reaper markers and regions"]. Double-clicking in the ruler between two markers selects the stretch between them [MEM].

### 3.2 Repeat

- The **repeat toggle** is a transport button and the `R` key [SEC: QS].
- With repeat on, playback that reaches the loop end jumps back to the loop start and carries on until stopped [SEC: SOS "Loop recorder"]. If playback starts after the loop end, it just plays on [MEM].
- With repeat off the loop range is ignored by playback [MEM].
- `Alt+Space` plays just the time selection [SEC: summary of a cheat sheet].

### 3.3 Edit cursor and playing

- The **edit cursor** is a vertical line. Click in the ruler or in any empty lane area to put it there [SEC: GK "left click empty: select none, move edit cursor"].
- **`Space` starts playing from the edit cursor; `Space` again stops** [SEC: QS]. On stop the play position goes back to the edit cursor, so pressing Space again replays the same spot [MEM].
- **Pause** keeps the position: `Enter` [SEC: QS] (also `Ctrl+Space`, MEM).
- `Home` moves the cursor to the project start; `W` goes to the start as well; `End` goes to the end [SEC: cheat-sheet summaries; `End` is MEM].
- Clicking in the ruler or an empty lane while playing makes playback jump there (a preference, on by default) [MEM].
- During playback a separate play cursor moves; the view follows it page by page unless auto-scroll is switched off [MEM].

### 3.4 Scroll and zoom

Default wheel bindings in the arrange view [SEC: QS, also GK]:

| Gesture | Result |
|---|---|
| Wheel | Zoom horizontally (time) |
| `Ctrl` + wheel | Zoom vertically (track heights) |
| `Alt` + wheel | Scroll horizontally |
| `Ctrl+Alt` + wheel | Scroll vertically |

- Keys: `+` / `-` zoom horizontally, `Page Up` / `Page Down` zoom vertically [SEC: QS].
- Horizontal zoom is centred on the mouse pointer or the edit cursor, by preference [MEM].
- These wheel defaults are the opposite of most other programs (where plain wheel scrolls), and many users swap them [SEC: KVR "The hell of using multiple DAWs: mouse wheel gestures"; a shared key map in the results overrides them].

### 3.5 Markers and regions

- **Marker**: a named point. `M` drops one at the cursor; `Shift+M` drops one and asks for a name [SEC: QS].
- **Region**: a named range. Make a time selection, then `Shift+R` (or right-click, "add region from selection") [SEC: UNT; OBS].
- Both show in lanes at the top of the ruler, each with a number [MEM for layout].
- **Jumping**: number keys `1`…`0` jump to markers 1–10 [SEC: UNT; TUTS]. `[` and `]` step to the previous/next marker (sources differ: one cheat sheet gives those keys to "set selection start/end") [SEC, conflicting]. `Ctrl+J` opens a jump-to box [SEC: cheat-sheet summary].
- Rename: Shift+double-click the marker or region number. Delete: Alt+click it [SEC: OBS / cheat-sheet summary].
- Drag a marker to move it. **Dragging a region's bar moves the region and every item inside it**; Ctrl+drag copies the lot [MEM]. This is how people rearrange song sections.
- A list window (region/marker manager) shows them all for renaming and jumping [MEM].

---

## 4. Effects (FX)

### 4.1 The per-track FX button and chain window

- Clicking a track's **FX button** opens that track's **FX chain window**. If the chain is empty the add-effect browser opens straight away [MEM].
- Layout: **the list of effects on the left, the selected plugin's own interface on the right**; add and remove buttons under the list [MEM; CW "Effects Dialog" confirms "Add FX" and "Remove selected FX", SEC].
- **Add**: the Add button, the `A` or `Insert` key, or a double-click in the blank space under the list. That opens the browser; double-click a plugin there to add it [SEC: RB "Did you know there are a bunch of keyboard shortcuts for the FX chain window?"; UPD]. The browser has a search box and folders by type [MEM].
- **Remove**: select and press `Delete`, or the Remove button [SEC: RB; CW "Effects Dialog"].
- **Reorder**: drag an entry up or down in the list. Ctrl+drag copies it [SEC: CW "Effects Tips"]. Sound runs through the list from top to bottom [MEM].
- **Bypass one effect**: each entry has a tick box, ticked means working [SEC: FXG; MEM for it being in the list row]. `Ctrl+B` toggles the selected one [SEC: UPD; RB]. A bypassed effect makes no sound change and uses no processor time [SEC: CW "Effects Dialog"].
- **Bypass the whole chain**: the small button beside the track's FX button [SEC: QS].
- Dragging an effect from the list onto another track's FX button moves it there; with Ctrl it copies [MEM].
- Chains can be saved and loaded as presets [MEM].

### 4.2 Floating plugin windows

- Any effect can be opened in **its own separate window** instead of inside the chain window ("float") [SEC: CW "Effects Dialog": "window float selected FX"]. Double-clicking the entry in the list does it [MEM]. In the mixer, clicking an effect's name in a strip opens it floating [MEM].
- Several floating windows can be open at once, each titled with the plugin and track name [MEM].

### 4.3 Instruments

- An instrument plugin is an ordinary entry in a track's FX chain, normally the first one. MIDI items on that track, and live MIDI input when the track is armed and monitored, play it. Effects after it process its sound [SEC: CW "Using VSTs with REAPER" appears in results; mechanism MEM].
- **Creating an instrument track in one step**: the command "Insert virtual instrument on new track" (Insert menu, or right-click the empty track-panel area) [SEC: forum summaries]. It opens the plugin browser; after choosing, the program makes a new track, puts the instrument on it, **arms it, turns monitoring on, and sets its input to all MIDI inputs, all channels, including the on-screen keyboard** [SEC: PRO; AG; DSU "MIDI Introduction in Reaper"]. The track is named after the instrument [MEM, not confirmed]. A plugin with many outputs triggers a question about building extra output tracks [SEC-weak: forum summary].
- So the user can play straight away, press record, and get a MIDI item.

### 4.4 Input FX

- Each track has a **second, separate chain for the incoming signal**. It runs only while the track is armed and acts only on what is coming in [SEC: CW "Track input FX"]. Opened by right-clicking the input-FX button or the input area of the track row [SEC: same page].
- Because it sits before the recorder, what it does is baked into the recording; the normal FX chain is not (unless the track is set to record its output) [MEM; ABOUT confirms recording "before or after effects processing", SEC].

---

## 5. Recording

- **Arm**: click the track's record-arm button. Any number of tracks can be armed [SEC: QS].
- **Choose an input** from the track's input chooser (or the arm button's right-click menu): one mono hardware input, a stereo pair, or a MIDI device and channel (including "all inputs, all channels" and the on-screen keyboard) [SEC: QS for where; PRO for the MIDI wording; mono/stereo list MEM].
- **What gets recorded** is a per-track choice in the same menu: the input (audio or MIDI), the track's processed output, MIDI overdub/replace into existing items, or nothing (monitor only) [SEC: ABOUT "any track can record audio or MIDI input, or record that track's processed … output"; option names MEM].
- **Monitoring** (hearing the input through the track and its effects) has three states, cycled by the small speaker button [SEC: VPL]:
  - **Off**: input not heard through the program.
  - **On**: input always heard.
  - **Auto** ("tape style"): heard while stopped and while recording, muted during plain playback [SEC: VPL; HR].
  - Arming a track turns monitoring on by default in recent versions, which can cause feedback or an audible delay [SEC: VPL; DSU "Basic Voice Recording in Reaper"].
- **Start**: `Ctrl+R` or the transport record button; `Space` stops [SEC: QS]. Recording starts **at the edit cursor**. On every armed track a **new item appears at the cursor and grows** as time passes [MEM for the growing item].
- On stop, a box asks whether to keep or delete the new recordings (by default) [MEM].
- **Recording over existing material**: by default the old item is split at the edges of the new one and the new recording becomes a new **take** stacked in the same place. The other option is tape mode: the old material is trimmed away behind the new [SEC: OBS / Options-menu summary "New recording that overlaps existing media items"; QS mentions the trim option].
- **Takes**: one item can hold several takes; only the chosen one plays. They show as lanes inside the item and clicking a lane picks it [SEC: SOS "Takes & Items" for takes living inside the parent item's bounds; lanes MEM]. `T` steps to the next take [MEM].
- **Loop recording**: with repeat on and a loop set, each pass adds a take [SEC: SOS "Loop recorder"; KVR "Loop Recording in Reaper and Blending notes"].
- **Record modes** (right-click the transport record button): normal; auto-punch on the time selection (only the selection is recorded); auto-punch on selected items [SEC: Options summary; VPL].
- **Count-in and pre-roll**: right-click the metronome button. Count-in plays clicks for a set number of bars before recording starts and records nothing during it. Pre-roll plays the project for a set number of bars before the cursor, then recording begins at the cursor [SEC: OBS "Pre-roll in Reaper"].
- **Latency**: recordings are shifted earlier by the delay the audio driver reports, so they line up with what the player heard. There is a tick box for "use the driver's reported latency" and a manual offset in samples for interfaces that report wrongly [SEC: CW "How to Compensate for Interface Latency"; CW "Preferences Audio Recording"]. Delay added by plugins is compensated automatically on playback [MEM].
- Classic beginner trap: an instrument track makes no sound from the keyboard unless it is armed with monitoring on [SEC: TS; DSU].

---

## 6. MIDI items and the piano-roll editor

- **Creating**: either record MIDI onto an armed track, or insert an empty MIDI item (Insert menu, "new MIDI item"). An empty one fills the time selection, or is one bar long at the cursor if there is none [SEC-weak: KVR "Newbie Reaper Question" reports a new blank item of one bar; rest MEM].
- **Opening**: double-click the item [SEC: AUD].
- **Editor layout**: a piano keyboard down the left edge, note rows across, a ruler on top, and a lane at the bottom showing each note's velocity (0–127) as a bar that can be dragged [SEC: AUD]. Clicking a piano key plays that note [MEM].
- **Range**: all 128 MIDI notes, more than ten octaves; the view scrolls vertically and zooms vertically [MEM].
- **Notes**: drag left-to-right in an empty row to draw a note; double-click inserts one of grid length; `I` inserts at the pointer [SEC: CW "Note Creation and Editing"; KVR "how can I insert a note into the piano roll with a left click"]. Drag a note to move it, drag its edge to change length, double-click a note to delete it, `Delete` removes selected notes [MEM]. Right-drag is a marquee here too [MEM]. The editor has its own snap and grid [MEM].
- **Wheel in the editor**: same scheme as the arrange view (wheel zooms time, Ctrl+wheel zooms pitch, Alt+wheel scrolls time, Ctrl+Alt+wheel scrolls pitch) [MEM]. One third-party guide instead says plain wheel scrolls pitch and Ctrl+wheel zooms time [SEC: AUD], so treat this as unsettled.
- **Editor versus item**:
  - The editor's time axis is the project's timeline. The item's start and end are shown; time outside the item is shaded [MEM].
  - Notes can exist past the item's end. They are kept but do not play until the item is dragged longer in the arrange view [SEC: CW "Other MIDI editing actions": with loop off, pasted content after the right border needs the border dragged out "to make the added content visible and played"].
  - A MIDI item has a **source length** of its own. The editor shows an end marker for the sequence, and that marker is where the loop wraps [SEC: summary of CW MIDI editor pages: the end marker "defines the end of a particular midi sequence/loop"].
  - With loop source on, **dragging the MIDI item's right edge past the source end repeats the notes**, with notches, exactly like audio [SEC: QS; CW "Item Editing" says all items except empty ones loop]. Editing a note in the editor changes it in every repeat, because the repeats are one source played again [MEM].
  - An action "double length of MIDI (repeating contents)" turns two repeats into one longer source [SEC: CW "Other MIDI editing actions"].
- **Named-notes / drum-map view**:
  - The editor has view modes: piano roll, **named notes**, event list, notation [SEC: CW "MIDI Editor Menus"; GM "Mode: named notes"].
  - In named-notes mode the piano keys are replaced by a list of row names (kick, snare, and so on) [SEC: GM; RB "rename MIDI"].
  - Names come from a note-names file loaded from the editor's File menu, or typed per row; they are remembered with the track [SEC: MA; RB; SOS "Set Reaper's MIDI editor for drums"].
  - Notes can be drawn as rectangles, **triangles or diamonds**; the last two are the drum looks, where only the start matters [SEC: CW "MIDI editor display actions"].
  - "Hide unused note rows" collapses the grid to only rows that have notes; a second option keeps rows that have a name. "Show all rows" restores [SEC: CW "MIDI editor display actions"].

---

## 7. Conventions worth copying, and traps to avoid

### 7.1 Defaults users will expect

| Action | Default | Trust |
|---|---|---|
| Play / stop | `Space` | SEC: QS |
| Stop returns to where play began; pause stays put | `Space` vs `Enter` | SEC for keys (QS); return-to-start MEM |
| Record | `Ctrl+R` | SEC: QS |
| Toggle repeat | `R` | SEC: QS |
| Go to project start | `Home` (also `W`) | SEC: cheat sheets |
| Split at cursor | `S` (selected items, or all under the cursor if none selected) | SEC: CW "Item Editing" |
| Delete selected items | `Delete` | MEM |
| Duplicate | `Ctrl+D`, copy lands right after the original | SEC: cheat sheets |
| Copy by drag | `Ctrl`+drag an item | SEC: TUTS |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` | SEC: cheat sheet for undo; redo MEM |
| Copy / cut / paste | `Ctrl+C` / `X` / `V`, paste at edit cursor | MEM |
| New track | `Ctrl+T`, or double-click below the last track | SEC: QS |
| Rename track | double-click its name | SEC: QS |
| Toggle snap | `Alt+S`; hold `Shift` during a drag to ignore snap | SEC: SOS; QS copy |
| Zoom time | wheel, `+` / `-` | SEC: QS |
| Zoom track height | `Ctrl`+wheel, `Page Up/Down` | SEC: QS |
| Scroll time / tracks | `Alt`+wheel / `Ctrl+Alt`+wheel | SEC: QS |
| Marker / named marker | `M` / `Shift+M` | SEC: QS |
| Region from selection | `Shift+R` | SEC: UNT, OBS |
| Jump to marker n | number keys | SEC: UNT, TUTS |
| Item properties | `F2` | SEC: cheat sheets |
| Open MIDI editor | double-click a MIDI item | SEC: AUD |
| Show mixer | `Ctrl+M` | MEM |
| Clear time selection | `Esc` | MEM |
| Click empty lane | deselect all, move edit cursor | SEC: GK |
| Left-drag empty lane | time selection | SEC: QS |
| Left-drag in ruler | loop range (and selection when linked) | SEC: QS |
| Right-drag in lanes | marquee-select items | SEC: QS |
| Slip contents | `Alt`+drag item body | SEC: QS |

### 7.2 Things new users find confusing (a simpler app should avoid these)

1. **Three kinds of "selection" at once**: selected items, the time selection, and the loop range, plus a link option between the last two [SEC for the option: QS, CW "Reaper for Post Production"; that it confuses is MEM]. [IDEA] Have one range only: the loop.
2. **Looping the source by accident**. Dragging an edge a little too far makes the content start again, and users do not know why or how to remove it [SEC-weak: KVR "Newbie Reaper Question"; KVR "waveform: moving the start of a clip TO THE LEFT" where the user has to "glue" and delete the extra]. [IDEA] Keep the gesture but make the notch obvious, show a count of repeats while dragging, and make a hard "stop" at the source end that needs a little extra pull to pass.
3. **Loop length is the whole source, not what is visible** (2.5), so trimmed-away material reappears in repeats [MEM]. [IDEA] Loop exactly what the clip shows.
4. **Clicking an item moves the edit cursor**, so selecting a clip changes where playback starts [MEM].
5. **Stop jumps back, pause does not**, and they are different keys [SEC keys: QS].
6. **Wheel zooms instead of scrolling**, the reverse of nearly every other program [SEC: KVR mouse-wheel thread]. [IDEA] Decide deliberately; do not copy this without a reason.
7. **Right-drag is a tool** (marquee) while right-click is a menu, so a slightly shaky right-click draws a box [SEC for marquee: QS; trouble MEM].
8. **No sound when playing an instrument** until the track is armed and monitoring is on [SEC: TS; DSU]. And the reverse: arming a microphone track turns monitoring on and causes feedback or echo [SEC: VPL].
9. **Input and monitoring controls are hidden until the track is armed** (version 7) [SEC: WN7]; and controls vanish when a track row is small [SEC-weak: HR].
10. **Ripple editing left on** silently shifts later material [SEC for modes: ASK; trouble MEM].
11. **Hidden takes**: recording over something stacks takes inside one item; users think the old recording is gone, or cannot find the new one [SEC for default behaviour: OBS; trouble MEM].
12. **A box after every recording** asking to keep or delete files [MEM].
13. **Overlapping items**: one item can sit on top of another on the same track, both sound, and the lower one is hard to see or grab [MEM].
14. **Tiny hit zones**: on a small item the trim edge, fade handle, volume handle and body are a few pixels apart [MEM].
15. **Everything is configurable** (keys, every mouse gesture with every modifier, thousands of actions), so advice from one user does not match another's setup, and the screen feels crowded [SEC: KVR threads; CW "Preferences Mouse Behavior"].
16. **MIDI notes outside the item** exist but are silent, and a new empty MIDI item is only one bar [SEC: CW "Other MIDI editing actions"; SEC-weak: KVR "Newbie Reaper Question"].
17. **Dragging a region moves everything in it** [MEM]. Powerful, but a surprise the first time.
18. **`S` with nothing selected cuts every track** at the cursor [SEC: CW "Item Editing"].

---

## 8. The 15 behaviours a simpler app must get right

Ordered by importance. Each line gives the gesture, the result, and edge cases. Numbers for minimum sizes are [IDEA]: no documented values were found.

1. **Space plays from the cursor and stops.**
   Press `Space`: play from the edit cursor. Press again: stop, and the play position returns to where it started, so repeated presses audition the same spot. A separate pause keeps the position. `Space` must work wherever focus is, except while typing in a text box. [SEC: QS; return-to-start MEM]

2. **Click to place the cursor.**
   Click in the ruler or in an empty lane: the edit cursor jumps there (snapped when snap is on) and items are deselected. If playing, playback jumps too. [SEC: GK; snap and seek MEM]

3. **Drag a clip to move it, in time and between tracks, in one gesture.**
   Press on the clip body and drag: time follows the pointer sideways, track follows it up and down. The clip start snaps to the grid when snap is on; `Shift` frees it. All selected clips move together. Clips cannot go before time zero. A small dead zone (a few pixels) before the drag starts stops a click from nudging the clip. [SEC: QS; details MEM/IDEA]

4. **Drag an edge to trim.**
   Near either edge the pointer becomes a double arrow. Dragging moves only that edge; the sound stays fixed in time. Snaps to grid; `Shift` frees it. The edge stops before crossing the other edge ([IDEA] keep at least one grid step, or a few pixels, of length). The file is never changed. [SEC: CW "Item Editing", QS]

5. **Drag the right edge past the content's end to loop it, with a notch at every repeat.**
   Keep dragging the right edge beyond the end of the content: the clip grows and the content begins again; each restart is marked by a notch in the top and bottom border. The last repeat may be cut short at any grid line. Dragging back shortens it and removes repeats. Fades stay at the clip's two ends. Works the same for audio and note clips. [SEC: QS "drag item right edge further right"; CW "Item Editing" on notches; CW "Loop Source" that it is on by default]

6. **The left edge mirrors it.**
   Dragging the left edge to the left reveals earlier content; past the content's start it wraps to show the end of the content (looping backwards), again with a notch. What is already visible never moves in time. [SEC-weak: KVR thread; MEM]. [IDEA] If this is too odd for the app, stop at the content start instead, but never shift the audible material.

7. **A per-clip "loop" switch.**
   One tick box in clip properties turns looping off; then dragging past the end gives silent empty space instead of repeats. Default on. [SEC: CW "Loop Source"; empty space MEM]

8. **Split with `S`, delete with `Delete`.**
   `S` cuts selected clips at the edit cursor (if none are selected, every clip under the cursor). Both halves remain, each with a tiny fade (10 ms default) so the cut does not click. If the cursor is not inside a clip, nothing happens. `Delete` removes the selected clips and leaves a gap (nothing shifts unless ripple is on). [SEC: CW "Item Editing"; RA for 10 ms; Delete MEM]

9. **Ctrl+drag copies; `Ctrl+D` duplicates right after.**
   `Ctrl`+drag leaves the original and drags a copy. `Ctrl+D` places a copy starting exactly where the original ends, so pressing it repeatedly builds a run. [SEC: TUTS; cheat sheets]

10. **Drag in the ruler to set the loop; `R` toggles repeat.**
    Left-drag along the ruler marks a range (snapped). With repeat on, playback wraps from the range's end to its start. The range's ends can be dragged later; `Esc` clears it. Starting playback after the range just plays on. [SEC: QS; SOS "Loop recorder"; MEM for the last two]

11. **Wheel zooms time around the pointer; modifiers scroll.**
    Wheel: zoom time. `Ctrl`+wheel: track height. `Alt`+wheel: scroll time. `Ctrl+Alt`+wheel: scroll tracks. The time under the pointer should stay under the pointer while zooming. Grid lines thin out when zoomed far out. [SEC: QS; centring and thinning MEM]. [IDEA] Offer the common alternative (wheel scrolls, Ctrl+wheel zooms) as a setting, since this default is disliked by people coming from other programs.

12. **Track row with the expected controls, in the expected order of use.**
    Name (double-click to rename), arm, input chooser and monitor, mute, solo, volume, pan, FX button with a bypass beside it. `Ctrl+T` or double-click under the last row adds a track; drag a row to reorder; drag its bottom edge to resize. [SEC: QS, RB track control panel, WN7; reorder and resize MEM]

13. **FX button opens a chain: list left, plugin right.**
    Add via a browser (double-click to add), drag to reorder, tick box to bypass, `Delete` to remove, double-click an entry to float the plugin in its own window. An instrument is simply the first entry. [SEC: CW "Effects Tips", CW "Effects Dialog", RB FX-chain shortcuts, FXG; float-by-double-click MEM]

14. **Arm, pick input, record lands at the cursor on the armed track.**
    Click arm; choose mono input, stereo pair or MIDI. Record starts at the edit cursor and a new clip grows there on each armed track. Recorded audio is shifted earlier by the driver's reported delay. Recording over an existing clip must have one clear rule ([IDEA] the simplest: the new recording replaces what is under it, with undo; the program's own default is to stack takes). An instrument track made in one step is armed, monitored and listening to all MIDI inputs. [SEC: QS; CW latency pages; PRO; OBS]

15. **Double-click opens the right editor; undo covers everything.**
    Double-click a note clip: piano-roll editor for that clip, showing the clip's bounds, with notes past the end kept but silent, and a named-rows view for drums. Double-click an audio clip: its properties. Every edit above (move, trim, loop, split, delete, record, FX add/remove) is one step of `Ctrl+Z`. [SEC: AUD; CW "Other MIDI editing actions"; CW "MIDI editor display actions"; audio double-click and undo scope MEM]

Also expected, lower priority: right-drag marquee select [SEC: QS]; snap toggle `Alt+S` with `Shift` to bypass [SEC: SOS, QS copy]; fade handles at the clip's top corners [SEC: QS]; markers with `M` and number-key jumps [SEC: QS, UNT]; `Alt`+drag to slip content inside a clip [SEC: QS].

---

## 9. What could not be confirmed

Worth checking in the real program before the design is fixed:

- Exactly what the **left edge** does on a looped item (only one user's forum remark found), and whether notches are drawn for backward repeats.
- Whether **fades** are repeated at loop notches (believed not).
- Default state of each **loop-source preference** (imported, new MIDI, recorded, glued).
- The **minimum item length** when trimming, and the pixel width of edge and fade hit zones.
- Default **double-click on an audio item** (believed: item properties).
- Default **wheel behaviour inside the MIDI editor** (two accounts disagree).
- Whether a new **virtual-instrument track is auto-named** after the plugin.
- `[` / `]` default meaning (two cheat sheets disagree).
- The plain **`Delete` key** for items, `Alt+P` for ripple, `Ctrl+M` for the mixer, `Esc` for clearing the selection (all from memory).
- The official user guide PDF (reaper.fm, "REAPER User Guide", versions 6.81 and 7.x appear in search results) was never opened; it is the place to settle all of the above once `www.reaper.fm` is reachable.
