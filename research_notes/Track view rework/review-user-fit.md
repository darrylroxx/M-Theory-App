# Review: is the spec what the user asked for, and is it simple to use?

Reviewed: `spec.md` (all 1392 lines) against the user's request and answers, `reaper.md`, `map-ui.md` section 3 and 4, and the code at commit `0f436e9` where a claim was in doubt. Nothing in the repository was changed. "The reference program" is the track-view program the user asked us to study.

## Verdict

The spec delivers every line of the request in its final form (release 6 or 7). No line is missing outright. But twelve points would leave the user stuck, surprised or one wrong key away from losing work, and several of them sit in release 1 or 2, the first drafts the user will test. Fix the twelve "major" points before building; the "minor" ones can be folded in as the releases go.

## Request, line by line

| What was asked | Where in the spec | Delivered? |
|---|---|---|
| Compose button: icon, bass clef, no text | D.1 track panel | Yes. See minor 18 (no such drawing exists yet; the Bass track's own icon must not look the same) |
| Compose opens the drum features as a plugin "with all the effects, rhythms and more" | E.2, E.3 | **Partly.** Kit, mixer, per-drum sound and effects are in a second window reached only from the track panel's FX button. Major 1 |
| Clip being composed shown at the bottom, dragged onto the timeline | E.2 clip strip | Yes from release 2. Major 2, 3, 11 are about using it |
| Only onto a track of its kind | A.1 `accepts`, E.2 | Yes for drums and chords. Melody and bass share clips, vocal and blank audio share clips (risk 9): sensible, say so in the release notes |
| Anywhere on the timeline | E.2, D.2 | Yes, but how far the empty timeline reaches is not defined. Minor 13 |
| Unlimited tracks | A.1, risk 24 | Yes (no cap found in the code either) |
| Blank track takes every interface input | F.1, F.2 | Yes in release 6. Major 10 (the list is empty until the interface is open), minor 16 to 18 |
| Free timeline, no sections | A, D | Yes |
| Copies separate | A.7, D.2 | Yes |
| Edge drag repeats | A.3 | Yes for new clips. **Converted vocal clips behave differently from today.** Major 9 |
| Bass on the melody composer, easy octaves, wide range | E.2, release 4 | Yes in release 4. **A Bass track can be added from release 1 but cannot hold a low note until release 4.** Major 8 |
| Old songs converted with a backup in the ideas list | B.3, B.4 | Yes. Minor 24 |
| Windows first, phone not broken | E.1, risk 32 | Windows yes. Phone: major 7 |
| Draft steps: track view, then composers, then blank track | H | Yes, same order |
| Easy loop and moving around a long song | D.1 ruler | Yes: drag on the ruler, scroll bar, zoom, fit. Minor 14, 20 |
| Minimal, no questions or popups | throughout | Yes: no confirm box anywhere. Two silent traps replace them: major 4 and 5 |

## Major problems

**1. The drum composer has no kit and no effects.**
Where: E.2 table (Drums row), E.3, G.7 rows 145, 157 to 159.
The user wrote: compose opens the drum features "letting the user compose drums like we already do, with all the effects, rhythms and more". Today's Drums page starts with play, the kit, the rhythm and the grid together (`DrumMachine.tsx:44`). In the spec the kit picker, mixer, drum sounds and effects are a separate window opened only from the FX button on the track panel; from inside the composer the only way there is tapping a drum's name.
Fix: give every composer window a Sound button in its title bar (same icon as the panel's FX) that opens the track's sound window docked beside it. In the Drums composer also keep the Kit picker next to the Rhythm picker (it writes `track.kit`, as in the sound window).

**2. A draft cannot be heard with the song, and has no bars under it.**
Where: E.2 ("▶ plays this clip alone"; "`chords = chordsUnderSpan(song, clip)`"), E.5 Harmonize ("the bars the open clip covers").
The compose button opens the track's draft, which is not on the timeline. The strip's ▶ plays it alone; the main ▶ plays the song without it. So a bass line or drum beat composed the way the user described can never be heard against the chords until it is dropped. For a draft there are also no "bars it covers", so the chord names over the melody grid and Harmonize's sources are undefined.
Fix: a draft has an assumed place: the loop region's start when the loop is on, else the cursor's bar. While a draft window has the focus, the main ▶ plays the song with the draft sounding at that place (a preview song through `flatten`, as Harmonize's audition already does). Use the same span for `chordsUnderSpan` and Harmonize.

**3. After a drop, edits silently stop reaching the song.**
Where: E.2 ("On release a separate copy lands there… The strip can be dragged again and again").
The window stays on the draft after the drop. The user keeps tweaking the beat, presses play, and the song still plays the copy made at drop time. Nothing on screen says why.
Fix: after a drop the window switches to the clip just placed (title "bars 1–4"). Dragging the strip still stamps separate copies (`copyClips`). The draft is kept as it was and the compose button returns to it.

**4. One Delete too many removes a whole track.**
Where: D.2 (a click on a clip "selects it and its track"; a click on an empty lane selects that track), D.3 (Delete: "the selected track when no clip is selected"), D.1 ("No confirm box").
Delete a clip, press Delete again, and the track with every clip on it is gone. It can also happen after any click on an empty lane. Ctrl+Z brings it back, but the user may not see it go.
Fix: Delete removes a track only when the last click was on that track's panel (the reference program does the same: the panel must have the focus). A click in a lane never makes Delete act on the track.

**5. Release 1: the compose and FX buttons lay an empty clip over existing music.**
Where: H release 1 ("the compose button with no clip of that track selected makes an empty 4-bar clip at the cursor and opens it; FX opens the same window"), A.6 rule 2 (`layDown` trims what it covers).
With the cursor on bar 1 and the drum clip not selected, pressing FX to tweak the drum sound (task 5 below) puts an empty 4-bar clip on bars 1 to 4 and cuts the drum clip there. Pressing compose twice leaves two clips. The button also changes meaning in release 2 (it then opens the draft).
Fix for release 1: the button opens, in this order, the selected clip of the track, else the clip under the cursor, else the track's first clip. Only a track with no clip at all gets a new empty clip, placed in free space. Never lay one over existing material.

**6. Space inside a composer presses the last button instead of playing.**
Where: D.3 ("Space … not while typing in a text field"; "plugin windows get keys first when they have the focus").
The drum and melody grids are made of buttons (`DrumMachine.tsx:343, 670`). After clicking a square, Space clicks that square again: a hit is removed or added and nothing plays. There is no Space handler in the app today, so this is new. The reference program's first rule is that Space plays wherever the focus is.
Fix: the one key handler takes Space in the capture phase, on key down and key up, and prevents the default unless the target is a text field or a select. Buttons keep Enter.

**7. With a mouse alone, or on a phone, a clip cannot be deleted, split, duplicated or muted.**
Where: D.2 and D.3 (Split = S, Delete = Delete, Mute = 0, Duplicate = Ctrl+D, marker = M, remove track = Delete or right-click); E.2 ("On is gone (clip mute)"); H release 7 (phone layout last); risk 32.
Every clip action except move, copy-drag and edge drag is a key. The visible On / Off switch of Melody and Drums becomes the unlabelled key 0. On a phone (the web build, which works fully today) none of these exist until release 7, and plugin windows only become sheets in release 2.
Fix: a small menu on right-click of a clip (long-press on touch): Open, Split at cursor, Duplicate, Mute, Delete. Keep an On / Off switch in the composer's title bar for the open clip. Show each key in the menu and in tooltips. Bring "window = bottom sheet on a phone" forward into release 1.

**8. A Bass track cannot hold a bass note until release 4.**
Where: D.1 (Bass is in the add-track row from release 1), H release 1 ("a Bass track uses the Melody page"; "Still old: two-octave grid for bass").
Today's grid starts at the home note nearest middle C and goes up two octaves (`melodyBase`, `song/melody.ts:117-128`: notes 48 to 84 at the lowest). For three releases the Bass track plays a bass sound in the melody's register.
Fix: add the `low` prop to `MelodyGrid` in release 1 (rows from `low` for two octaves, two octaves down for a Bass track), which is what D.4 already promises. Or leave Bass out of the add-track row until release 4.

**9. Converted vocal clips loop a fragment where today they uncover the rest of the take.**
Where: B.1 step 12 (`{ take, from, to, off: 0, frames: to - from }`), A.1 (`from`/`to` = "one cycle"), G.8 row 170.
Today an edge trimmed inwards can be dragged back out to the take's full length (`trimClip`, `song/clips.ts:114-119`, clamps to 0 and `take.frames`). After conversion the trimmed stretch is the whole content, so dragging the edge out repeats that fragment. The spec's own split rule keeps the whole take as content, so old and new clips would behave differently.
Fix: convert as `from: 0, to: take.frames, off: clip.from, frames: clip.to - clip.from`, same start beat. What plays is identical; an edge dragged out first uncovers the take and only repeats past its end, as in the reference program.

**10. The input list is empty until the interface is open.**
Where: F.2 ("The input list is built from `EngineOpened.inputs`"), F.5 (the interface is open only while a track is armed or a record window is open, and closes for playback), D.1 ("Arm, input and monitor are always visible").
The obvious order is add track, choose input, arm. Before arming, and whenever the song plays, there is no count to build the list from. Today's page already falls back to the device list (`VocalsPage.tsx:705`).
Fix: remember the last opened input count with the studio settings and build the list from: the open engine, else the listed device, else the remembered count. Always show the track's saved choice.

**11. Where a plugin window opens is not defined, and it can cover the lane it must be dragged onto.**
Where: E.1 (`x, y, w, h` remembered; no first position or size given), E.2 (a drop anywhere but an accepting lane "glides back").
The Drums page is tall. A window in the middle of the screen hides the drum lane, so the first drag from the strip has nowhere to land.
Fix: first open docks the window to the lower part of the screen at full width of the lanes, and the track list scrolls so the window's own track is visible above it. During a strip drag the window turns see-through and lets the pointer through everywhere except the strip.

**12. R starts a recording.**
Where: D.3 (`R` = record, `L` = loop).
In the reference program R switches repeat on and off and Ctrl+R records. A user from that program who presses R to loop, with a track armed, starts a recording (the player stops, the backing renders).
Fix: R and L both switch the loop; Ctrl+R records.

## Minor problems

13. **Empty timeline and first zoom are undefined** (D.1; `Session.pxPerBeat` has no starting value; `songEnd` is the last clip's end, so a new song is zero long). Fix: the lanes always reach at least one screen (and at least 32 bars) past the last clip; a song opens on "fit", never showing fewer than 16 bars.
14. **Double-click on a marker means two things** (D.1 ruler: "double-click = loop from this marker to the next" and "double-click its name to rename"). A marker is mostly its name. Fix: double-click loops; rename with F2 or from the marker's right-click menu, and type the name straight away when M makes one.
15. **An armed track stays armed for ever** (`Session.armed` is saved with the app; F.5). While armed, the interface is reopened one second after every stop and every play waits for it to close (`freeInterface`, up to 1.5 s, `audio/handoff.ts:50-56`), and the mic-live dot stays on. Today leaving the Vocals page ends this. Fix: do not save `armed`; clear it on idea change and at start.
16. **Monitor looks per track but is one setting** (D.1: "the one studio setting, shown on each audio track"). Changing it on one track changes all; the reference program's is per track. Fix: show it once, beside the top bar's record button and in the record window.
17. **The audio track panel does not fit** (D.1: 220 × 64 px for grip, icon, name, compose, FX, M, S, volume, dB, arm, input with meter, monitor; today's 212 px head holds six of these). Fix: 260 px wide, monitor moved out (16), input shown as a short chip ("2", "1+2").
18. **Names and icon.** The add-track row says "Audio"; the user calls it the blank track: label it "Blank". No bass-clef drawing exists in `ui/icons.tsx`: specify a drawn SVG (not a font character, which is missing on some systems), and give the Bass track kind a different icon.
19. **Three plus and minus signs side by side in the strip** (E.2: "4 bars − +   ＋", where ＋ wipes the draft). Fix: call it "New", put it at the left end.
20. **With the loop on, Space always starts at the loop's start** (C.4), and a click on the ruler outside the loop while looping is not defined. In the reference program play starts at the cursor. Fix: cursor inside the region: play from the cursor; outside: from the region's start. A click outside the region while looping moves the cursor only.
21. **Picking a rhythm into an empty 4-bar clip** (D.2 "New empty clip"; `applyPattern` sets `bars` to the rhythm's own, usually 1, `audio/beats.ts:362`). The spec gives a length rule only for the "N bars" control. Fix: state it: picking a rhythm never changes the clip's length on the timeline; the rhythm repeats inside it.
22. **Dragging on an empty lane does nothing**, and several clips can only be chosen with Ctrl+click or loop region plus Ctrl+A. Fix: a drag on empty lane draws a box that selects the clips it touches.
23. **A vocal clip dragged to another audio track loses its take** (`AudioClip.take` is "id in its track's `takes`"; `moveClips` does not carry takes, only `pasteIn` does). Fix: `moveClips` and `copyClips` across tracks copy the take record (the file is shared) and light "Apply sound" when the chains differ.
24. **Backups.** (a) The ideas list doubles in length: fold backups under one closed "Before track view (N)" row. (b) A backup entry holds no song; on another device or after "Restore from file" its source may not exist: write the original into backup files, hide an entry whose source is missing. (c) The new state is stored beside the old blob, so local storage use roughly doubles after all, and a failed write is swallowed today (`ui/state.tsx:416`): after the first conversion check the write succeeded and say so plainly if it did not.
25. **No way to switch a track's effects off to compare** (E.3: fixed chain, no bypass; the reference program has a bypass beside FX). Fix: Alt+click on FX (and a switch in the sound window) plays the track with effects at zero; nothing is stored.
26. **Songs that never used drums get a faint drum clip in every section** (B.1 step 5: drums that are off but have hits become muted clips; the default beat is off and carries the first library rhythm, `audio/beats.ts:336-350`). Fix: skip a drums part that is off, unedited and still on the default rhythm.
27. **Release 1 and 2: parts of the old Chords page are pinned to the screen, not to the window** (`.mini-tray` fixed at the screen's bottom, `.bottom-layer.open` fixed full screen, `.hz-sheet` fixed bottom centre, `styles.css:221-223, 517, 1324`). The spec says only "a plain floating window". Fix: the window's body is made the anchor for fixed children (a transform on it) and the three cases are on the release 1 checklist.
28. **Browser build keys.** Ctrl+T cannot be taken from a browser, and Ctrl+wheel zooms the page unless the wheel listener is non-passive and prevents it. Fix: note both; the + row and the − / + buttons are the browser's way.

## Differences from the reference program that are deliberate (fine, keep them, list them in the release notes)

Plain wheel scrolls tracks (there: zooms). A click on a clip does not move the cursor. S with nothing selected cuts only the selected track. Clips never overlap. No pause key (Enter opens the clip). Shift means "snap to beats", not "no snap". The effects chain is fixed. One armed track. No box after a recording.

## The five everyday tasks, click by click (final UI unless a release is named)

1. **New song, drum beat for 16 bars.** Ideas, New idea (2). Bass-clef on Drums (1). Rhythm picker, pick one (2). Drag the strip to bar 1 of the drum lane (1 drag). Drag the clip's right edge to bar 17 (1 drag). Space. Trouble: the window may cover the lane (major 11); the 16 bars may not be on screen (minor 13); a tweak after the drop goes to the draft (major 3); Space after touching the grid presses a square (major 6). In release 1 the second press of compose lays an empty clip over the beat (major 5).
2. **Chords and a bass line under it.** Bass-clef on Chords, tap chords, drag the strip, drag the edge (4 steps). "+", Bass (2). Bass-clef, write notes, drag the strip. Trouble: the bass draft shows no chords over the grid and cannot be heard with the drums and chords (major 2); before release 4 the grid has no low notes (major 8).
3. **Guitar from input 2 on a blank track (release 6).** "+", Audio (2). Input list, "In 2" (2). Arm (1). Record or the key (1). Stop. Trouble: the row is called Audio, not Blank (minor 18); the list has nothing in it before arming (major 10); R is the reference program's loop key (major 12); the track stays armed afterwards and every later play waits (minor 15).
4. **Old song, one chord in the second chorus.** Ideas, the idea (2). Double-click the chords clip under the second "Chorus" marker (1). Change the chord. Trouble: the first chorus no longer follows (accepted, risk 13: Ctrl+drag the fixed clip onto the first chorus replaces it in one move, worth a line in the release notes); the song may open at a zoom where the chorus is off screen (minor 13); in release 1 the tray and shape finder are pinned to the screen (minor 27).
5. **Loop bars 9 to 16 and tweak the drum effects while it plays.** Drag across the ruler from bar 9 to the end of bar 16 (1 drag). Space. FX on Drums (1). Turn knobs. Works as hoped in release 2 on. Trouble: in release 1 FX with no drum clip selected lays an empty clip at the cursor (major 5); there is no way to hear the track without its effects (minor 25).

## Text with a product name in the planned UI

The spec's own new wording contains none. It carries three existing labels into the drum windows unchanged (E.3 "Kit picker", E.2 "every library group"): the kit names **"808"**, **"909"**, **"707"** (`audio/drums.ts:92-94`) and the rhythm group **"808 & trap"** (`audio/rhythms.ts:26`). These are another maker's drum machine model numbers. The neighbouring kits were already renamed in plain words ("Sampled", "Pocket", "Lo-fi"). Fix: rename the three kits and the group in plain words (for example "Boom", "Punch", "Tight", and "Trap & electro"), keeping the ids so saved songs still load.
