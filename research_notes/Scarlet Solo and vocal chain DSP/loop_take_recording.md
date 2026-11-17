# Loop ("cycle") take recording, take lanes, comping, count-in and latency compensation in DAWs

Research note (Nov 2026). Method caveat: in this session WebFetch could not reach ableton.com or soundonsound.com (blocked hosts), so full manual pages could not be read. Findings below come from search-result extracts of official manuals (Apple, Avid, Steinberg, Fender Studio Pro/PreSonus, Ableton help, BandLab help, Cockos wiki) plus some third-party tutorials and forums, which are flagged as such. FL Studio and Bitwig were not researched (no time budget left); see Gaps.

## 1. What happens at each loop boundary, partial final takes, naming, default playback, audition and pick, crossfades

### Takeaway
Every major DAW follows the same model. The transport loops over a cycle region. Each pass becomes a "take", usually sliced from one continuous recorded file. When you stop, the takes are grouped on the track (Logic take folder, Ableton take lanes, Cubase lanes, Pro Tools playlists/clips, Studio One/Fender Studio Pro takes or layers, GarageBand takes). The last complete take is what plays by default, and the earlier takes stay available to audition and comp. Partial last passes are handled differently: Pro Tools discards a pass stopped before the loop midpoint, and older Logic discarded a pass stopped inside its first bar. Other DAWs keep partial passes.

### Cited Findings
**Logic Pro (Mac / iPad)**
- After the second cycle pass, Logic creates a take folder on the track, and each later pass is added to it — [Apple Logic Pro 10.1 help](https://help.apple.com/logicpro/mac/10.1/en.lproj/lgcpb19806af.html); same behaviour on iPad: "after the second cycle pass, a take folder is created on the track, and each subsequent cycle pass is added to the take folder" — [Logic Pro for iPad guide](https://support.apple.com/guide/logicpro-ipad/lpip2825d179/ipados)
- The 9.1.6 manual places folder creation at the point where pass 2 ends and pass 3 begins (older wording) — [Logic 9.1.6 manual](https://help.apple.com/logicpro/mac/9.1.6/en/logicpro/usermanual/chapter_14_section_13.html)
- Behaviour is set in Record > Overlapping Audio Recordings > Cycle. "Create Take Folder" is the default. Alternatives include "Create Tracks and Mute", which puts each pass on a new muted track. It can also be set in File > Project Settings > Recording — [Apple Logic Pro 10.4 help](https://help.apple.com/logicpro/mac/10.4/en.lproj/lgcpb19806af.html)
- The whole cycle recording, with all takes, is stored as one audio file. Take folders are used only when Replace mode is off, which is the default — [Logic Pro 8 manual via manualsdir](https://www.manualsdir.com/manuals/548098/apple-logic-pro-8.html?page=365)
- Partial final pass: stopping inside the first bar of a new cycle repeat discards that short piece as an accidental recording. This is from the older Logic Pro 8 manual and may have changed — [Logic Pro 8 manual](https://www.manualsdir.com/manuals/548098/apple-logic-pro-8.html?page=366)
- "Auto Colorize Takes" gives each take in the folder a different palette colour — summarised from [Logic Pro for iPad guide](https://support.apple.com/guide/logicpro-ipad/lpip67576fc5/ipados) / Logic recording settings search results
- Comp sections in a take folder get automatic crossfades, using the default crossfade settings in Preferences > Audio > General — [Logic 9.1.6 Editing Comps](https://help.apple.com/logicpro/mac/9.1.6/help/English.lproj/en/logicpro/usermanual/chapter_15_section_5.html). One tutorial gives the default as 10 ms (Logic Pro X era) — [MusicTech Quick Swipe Comping](https://www.musictech.net/tutorials/logic-pu-2/)
- Long cycles produce takes that each span the full loop. Takes can be "unpacked" into separate regions on separate tracks — [Beat Kitchen guide (third-party)](https://beatkitchen.io/guides/logic/07-cycle-recording-and-comping/)

**Ableton Live (11, 12)**
- "Recording over existing clips, either by recording individual passes or by recording in a loop, adds a new take lane for each pass." In Arrangement recording, take lanes are created automatically and the clips are placed in them — [Ableton Live 12 manual: Comping (search extract)](https://www.ableton.com/en/live-manual/12/comping/)
- "Take lanes are never audible, unless Audition Mode is enabled." The main track lane is what plays — [Ableton Live 11 manual: Comping (search extract)](https://www.ableton.com/en/live-manual/11/comping/)
- Loop recording writes one long file. "All the takes are kept, as the audio is in fact recorded into one long file" — [Sound On Sound, Ableton Live recording tips (search extract)](https://www.soundonsound.com/techniques/ableton-live-recording-tips)
- Show Take Lanes: right-click the track > "Show Take Lanes", or Ctrl+Alt+U on Windows. Take lanes are hidden in Automation Mode. Comping is in Intro, Standard and Suite — [Ableton Comping FAQ](https://help.ableton.com/hc/en-us/articles/360019092580); [Sweetwater Comping in Live 11](https://www.sweetwater.com/insync/comping-in-ableton-live-11/)
- Live 12: take lanes can be duplicated with Cmd/Ctrl+D — [Ableton Live 12 manual: Comping](https://www.ableton.com/en/live-manual/12/comping/)

**Pro Tools**
- Loop record: after you stop, the most recently recorded take appears in the track. All takes appear as clips in the Clips List, numbered sequentially — [Avid Pro Tools user guide: Loop recording](https://www.avid.com/pro-tools/user-guide/loop-recording); [Pro Tools First help: Loop Recording Audio](https://apps.avid.com/proToolsFirstHelp/version12.3/enu/Pro%20Tools%20First%20Help/rec2.audio.20.48.html)
- Partial final take: "If you stop recording before you reach the midpoint of the loop, Pro Tools discards that take." If you pass the midpoint, the take is kept — [Avid loop recording guide](https://www.avid.com/pro-tools/user-guide/loop-recording); [Pro Tools First help](https://apps.avid.com/proToolsFirstHelp/version12.0/enu/Pro%20Tools%20First%20Help/rec2.audio.20.42.html)
- The preference "Automatically Create New Playlists When Loop Recording" puts each loop pass on a new playlist, so takes can be compared and comped in Playlists view — [Avid: Playlists](https://www.avid.com/pro-tools/user-guide/playlists). Sources disagree on where the preference lives: Recording section per Avid, Operation pane per [MusicTech](https://musictech.com/tutorials/pro-tools/how-to-comp-vocals-in-pro-tools/)
- Naming: new playlists are auto-named "TrackName.NN", for example "Guitar.01" and "Guitar.02" — [Avid: Playlists](https://www.avid.com/pro-tools/user-guide/playlists); [Sweetwater](https://www.sweetwater.com/sweetcare/articles/how-to-use-playlists-in-pro-tools/)

**Cubase / Nuendo**
- Audio cycle record modes include "Keep History", "Cycle History + Replace" and "Replace". In Keep History or Cycle History + Replace, "the recorded cycle laps are shown on the track with the last recorded take active and on top" — [Steinberg: Audio Record Modes (v12)](https://archive.steinberg.help/cubase_pro/v12/en/cubase_nuendo/topics/recording/recording_audio_record_modes_r.html); [Steinberg: Lanes, Takes, and Overlapping Events](https://steinberg.help/nuendo/v12/en/cubase_nuendo/topics/track_handling/track_handling_lanes_working_with_c.html)
- An audio track plays only one event at a time, so you hear the active take, for example the last lap. "Show Lanes" shows the takes on separate lanes. The Comp tool selects sections across lanes — [Steinberg: Working with Lanes (v8)](https://steinberg.help/nuendo/v8/en/cubase_nuendo/topics/track_handling/track_handling_lanes_working_with_c.html)
- One user reports that Cubase writes a single audio file for the whole cycle recording, from record start to stop — [Steinberg forum (user report)](https://forums.steinberg.net/t/cycle-recording-workflow-and-confusing-results/1039079)
- Forum reports say the partial final lap is kept as a lane unless recording is stopped early, and that Replace mode has misbehaved in some versions (keeping the first take instead of the last) — [Steinberg forum](https://forums.steinberg.net/t/cycle-recording-workflow-and-confusing-results/1039079); [Steinberg forum: cycle audio record](https://forums.steinberg.net/t/cycle-audio-record-question/627777)
- Comp crossfade lengths can be changed with the range tool or the fade handles — [Steinberg: Changing the Crossfade Length](https://steinberg.help/cubase_pro/v12/en/cubase_nuendo/topics/fades_crossfades_and_envelopes/fades_crossfades_area_resizing_without_moving_splice_points_c.html)

**REAPER**
- By default REAPER does not write a new file per pass. It writes one file when you stop. Preferences > Audio > Recording ("Loop/Lane recording") has an "add recorded media to project ... at each loop" option that writes a file per pass, which can cause a brief monitoring glitch as each file is created — [REAPER Blog: Layered Loop Recording with Fixed Item Lanes (REAPER 7)](https://reaper.blog/2023/11/layered-loop-recording/)
- REAPER can record any number of takes while cycling. By default, punching in within a cycle splits existing items and creates new takes. A "tape mode" overlap setting trims existing items instead — [Sound On Sound: Takes & Items (search extract)](https://www.soundonsound.com/techniques/takes-items)
- REAPER 7 adds fixed item lanes, so each loop pass can land on its own lane — [REAPER Blog](https://reaper.blog/2023/11/layered-loop-recording/)
- The Cockos wiki lists recording preferences that control how media is added when loop recording — [Cockos wiki: Preferences Audio Recording](https://www.cockos.com/wiki/index.php/Preferences_Audio_Recording)

**Studio One, now Fender Studio Pro**
- "When Loop Recording with Audio Tracks, multiple Takes are created. These Takes represent each recorded pass over the looped region." Takes can be unpacked to new tracks, new layers or existing layers — [Fender Studio Pro manual: Loop Recording on Audio Tracks](https://fenderstudiopromanual.fender.com/en/Content/Recording_Topics/Loop_Recording_on_Audio_Tracks.htm)
- The "Record Takes To Layers" option (Record panel, Shift+Alt/Option+R) puts each take on its own layer under the track. "Expand Layers After Recording Takes" is on by default, so the layers appear as soon as recording stops — [Fender Studio Pro manual](https://fenderstudiopromanual.fender.com/en/Content/Recording_Topics/Loop_Recording_on_Audio_Tracks.htm); [Track Layers](https://fenderstudiopromanual.fender.com/en/Content/Recording_Topics/Track_Layers.htm)
- The normal Undo does not apply to individual passes in loop mode. Special undo buttons remove passes instead — [Fender Studio Pro manual](https://fenderstudiopromanual.fender.com/en/Content/Recording_Topics/Loop_Recording_on_Audio_Tracks.htm)
- Takes are picked from a list on the event via right-click or Ctrl-click — [Fender Studio Pro manual](https://fenderstudiopromanual.fender.com/en/Content/Recording_Topics/Loop_Recording_on_Audio_Tracks.htm)
- Fender Studio Pro also has Retrospective Recording, which captures input that was played while not recording — [Fender Studio Pro: Retrospective Recording](https://fenderstudiopromanual.fender.com/en/Content/Fundamentals_Topics/Retrospective_Record.htm)
- Older Studio One quirk (forum): a second loop recording reused existing layers, which left gaps in the layer numbering — [KVR forum](https://www.kvraudio.com/forum/viewtopic.php?p=8230450)

**GarageBand (iPhone/iPad and Mac)**
- iOS: Track Settings > Recording > Multi-Take Recording on. Not available on Drummer tracks. Apple says to turn off "Automatic song section length" first. A new take is created each time the playhead starts over at the beginning of the section — [Apple: Record multiple takes in GarageBand on iPhone or iPad](https://support.apple.com/en-au/101934)
- To choose a take, double-tap the region, tap Takes and select one, which is then shown with a check mark. Takes can be switched during playback or while stopped, and unwanted takes deleted from the same menu — [Apple 101934](https://support.apple.com/en-au/101934)
- Mac: recording starts at the beginning of the cycle area. You record as many passes as you like and then choose a take — [GarageBand for Mac guide](https://support.apple.com/guide/garageband/gbndf80e7097/mac); [Choose and delete takes](https://help.apple.com/garageband/mac/10.1.5/en.lproj/gbnd5fa82adf.html)

**BandLab**
- When Cycle is enabled, "playback and recording will always begin at the cycle's starting point". The Cycle Bar is recommended for recording multiple takes — [BandLab Help: Looping Regions and Setting a Playback Cycle](https://help.bandlab.com/hc/en-us/articles/57252306473497-Looping-Regions-and-Setting-a-Playback-Cycle)
- A low-authority third-party guide says mobile BandLab keeps each take for comparison — [djkokumo BandLab tutorial](https://djkokumoproductions.netlify.app/tut-bandlab)

### Inferences
- The shared convention is one continuous file plus non-destructive slicing. Logic, Ableton and REAPER (default) all record one file and present per-pass "takes" as windows into it, and Cubase does the same per a user report. This makes boundary crossfades and later edge extensions trivial, because the audio either side of each loop point exists in the file as the end of take N and the start of take N+1.
- The default played take is the last one in Logic, Cubase, Pro Tools and Ableton (the latest pass is in the main lane, inferred from the comping model). A new app should do the same and show it as selected.
- Naming conventions are simple sequential numbers: "Take 1, 2, 3…" in take folders and lanes, "Name.01, .02" for Pro Tools playlists. A colour per take (Logic Auto Colorize) helps visually.
- Partial-pass rule: a sensible default is to keep the partial last pass only if it passed a threshold. Pro Tools uses the loop midpoint, and old Logic discarded passes under one bar. Otherwise discard it, so stray fragments from pressing stop late do not become "takes". The data should still be kept in the underlying file.
- Simple apps (GarageBand iOS) hide lanes entirely. You get one region with a "Takes" menu and a check mark. That suits a phone-first vocal app, with comping as an optional advanced view.

### Gaps
- Exact default labels in Logic ("Take 1"…) and Ableton could not be confirmed from the extracts, though tutorials refer to takes by number.
- Current (Logic 11 / 2026) behaviour for very short final passes is not confirmed. Only the Logic 8 manual describes the first-bar discard.
- Ableton's handling of a partial last pass is not documented in the extracts.
- FL Studio (Playlist loop recording / "take" behaviour) and Bitwig (comping since 5.x) were not researched in this pass.

## 2. Setting and editing the loop region; changing it while recording

### Takeaway
The loop is always a bar-snapped region on the ruler: Logic's cycle area, Ableton's loop brace, Pro Tools' timeline selection, Cubase's left/right locators, BandLab's Cycle Bar. You set it by dragging, usually snapped to bars, and recording restarts at its left edge. No source documented editing the loop length mid-recording, so this should be treated as unsupported and the region locked while recording.

### Cited Findings
- BandLab: the Cycle Bar loops the selected area. When it is on, playback and recording start at the cycle start — [BandLab Help](https://help.bandlab.com/hc/en-us/articles/57252306473497-Looping-Regions-and-Setting-a-Playback-Cycle)
- GarageBand Mac: recording starts automatically at the beginning of the cycle area — [GarageBand for Mac guide](https://support.apple.com/guide/garageband/gbndf80e7097/mac). GarageBand iOS loops over a song section, and Apple says to turn off automatic section length — [Apple 101934](https://support.apple.com/en-au/101934)
- Ableton: you set and enable the loop brace before recording, and Live records over the loop area repeatedly — [Sweetwater Comping in Live 11](https://www.sweetwater.com/insync/comping-in-ableton-live-11/); [Sound On Sound (search extract)](https://www.soundonsound.com/techniques/ableton-live-recording-tips)
- Logic iPad: recording starts automatically at the beginning of the cycle area — [Logic Pro for iPad guide](https://support.apple.com/guide/logicpro-ipad/lpip67576fc5/ipados)

### Inferences
- Recommended UX: bar-snapped loop handles on the timeline, a quick "loop this section" action (the app already has lettered song sections, so looping a section is the natural mapping, as GarageBand iOS does), and handles locked while recording. Changing the loop should require stopping first.

### Gaps
- No source found on whether any DAW allows moving the loop locators during an active cycle recording, or what happens to takes if you do.

## 3. Count-in, pre-roll and metronome

### Takeaway
Count-in is a bar-based click lead-in before the record point. Logic offers None, 1–6 bars, or a beat fraction, and Ableton defaults to 1 bar. Pre-roll is a time-based lead-in that plays the backing track before the punch point, and in Logic choosing pre-roll replaces count-in. Count-in happens once at the start, not on every loop pass. Metronome options are usually "click during recording" and "click only during count-in".

### Cited Findings
- Logic count-in choices: None, 1–6 bars, or a beat fraction. Set in Project Settings > Recording, or on iPad by touching and holding the Count-in button. Shift-K toggles count-in, and playback starts before the playhead when recording begins — [Apple: Recording project settings](https://support.apple.com/en-afri/guide/logicpro/lgcpbc10f1ea/mac); [Apple: Use the count-in (iPad)](https://support.apple.com/guide/logicpro-ipad/use-the-count-in-lpip22998eab/ipados)
- The lead-in can be set in bars/beats (count-in) or in seconds (pre-roll). When pre-roll is selected it replaces the count-in — [Apple: Recording project settings](https://support.apple.com/en-afri/guide/logicpro/lgcpbc10f1ea/mac) (the replacement statement is from a secondary source in the same search)
- Logic metronome: "Click while recording" controls clicks during count-in and recording. "Only during count-in" clicks only in the count-in, but needs "Click while recording" enabled to work — [Apple: Metronome project settings](https://support.apple.com/guide/logicpro/metronome-project-settings-lgcpe1d6118e/mac); [Apple: Use the metronome](https://support.apple.com/guide/logicpro/use-the-metronome-lgcp0534986f/10.7/mac/11.0)
- Ableton default set: count-in 1 bar, metronome "Enable Only While Recording". Users report that the first click after the count-in is sometimes skipped in that mode, still present in Live 12.0.2 — [Ableton forum (user reports)](https://forum.ableton.com/viewtopic.php?p=1830915)
- The importance of the first-beat accent and visual countdown is not documented in the extracts. The Logic iPad guide lists setting the metronome and count-in as optional steps before cycle recording — [Logic iPad guide](https://support.apple.com/guide/logicpro-ipad/lpip67576fc5/ipados)

### Inferences
- Count-in plays click only, and the backing track starts at the record point. Pre-roll plays the backing track from earlier. For a vocalist, "1 bar count-in, click only" is the standard default, with options for None, 1, 2 (and 4) bars.
- The count-in happens once before the first pass. Later loop passes run straight from the loop end to its start with no count. This matches every DAW's cycle behaviour, where the transport simply wraps.
- A visual countdown (4-3-2-1) is a common mobile-app convenience. It is not documented in these sources, so it is recommended on UX grounds only.

### Gaps
- Click sound and accent defaults (accented beat 1, separate bar and beat sounds) and routing the click to headphones only (Logic and Ableton route it to cue outputs) were not confirmed by fetched sources.
- BandLab count-in behaviour was not found.

## 4. Recording details: audio during count-in, latency compensation, handles, files

### Takeaway
Recorded audio is shifted earlier by the measured or reported round-trip latency. DAWs automate this and expose a manual trim: Logic "Recording Delay", Ableton "Driver Error Compensation". Whether audio before the punch or record point is kept varies. Logic 8 recorded about a bar before the punch-in, current Logic autopunch reportedly does not, and Quick Punch-In or retrospective recording are the ways to capture early starts. One continuous file per recording is the norm, which gives free handles at each loop boundary. In a browser, latency must be calibrated with a loopback measurement, because the reported values are unreliable.

### Cited Findings
- Logic Pro 8 began recording about a bar before the punch-in locator, so a region's start could be extended later. The 9.1.6 manual says audio before the autopunch-in point is streamed but not recorded. A Logic 10.2.4 user saw nothing recorded before the punch point even with 6 s pre-roll — [Logic 9.1.6 Audio Punch Recording](https://help.apple.com/logicpro/mac/9.1.6/en/logicpro/usermanual/chapter_14_section_15.html); [Apple Discussions thread](https://discussions.apple.com/thread/7625409); [Logic 8 manual](https://www.manualsdir.com/manuals/548098/apple-logic-pro-8.html?page=371)
- With Quick Punch-In on and the track armed, dragging a recorded region's start left reveals audio played before record was pressed — [Cult of Mac](https://www.cultofmac.com/?p=690501)
- Fender Studio Pro's Retrospective Recording captures input when not recording — [Fender Studio Pro manual](https://fenderstudiopromanual.fender.com/en/Content/Fundamentals_Topics/Retrospective_Record.htm)
- Logic "Recording Delay" (Preferences > Audio) is a manual positive/negative sample offset, normally left at 0. One user fixed a 50 ms offset with about −2500 samples — [Logic Users Group forum](https://logic-users-group.com/threads/recording-delay-not-latency.11338/); [M-Audio support](https://support.m-audio.com/en/support/solutions/articles/69000858967-m-audio-audio-recording-is-too-early-or-too-late-when-played-back-in-logic-pro)
- Logic: if streams are delayed for plug-in latency compensation while recording, the recording comes out late by that amount. Apple suggests disabling software monitoring — [Apple Logic 9.1.6: Plug-in Latency Compensation](https://help.apple.com/logicpro/mac/9.1.6/en/logicpro/usermanual/chapter_41_section_3.html)
- Ableton: Driver Error Compensation corrects errors in the latency the interface reports and is separate from Delay Compensation. Recording timing also depends on the track's Monitor setting — [Ableton Help: Recordings are out of sync](https://help.ableton.com/hc/en-us/articles/19450890686876)
- "All DAWs should automatically calculate the Record Offset … but sometimes they don't get it right. That's why they have manual adjustment" (forum) — [homerecording.com](https://homerecording.com/bbs/threads/daw-timing.398257/)
- One file per recording: Logic stores all cycle takes in one file — [Logic 8 manual](https://www.manualsdir.com/manuals/548098/apple-logic-pro-8.html?page=365); so does Ableton — [Sound On Sound extract](https://www.soundonsound.com/techniques/ableton-live-recording-tips); REAPER defaults to one file on stop, or per-loop files as an option — [REAPER Blog](https://reaper.blog/2023/11/layered-loop-recording/)
- Browser DAWs (Soundtrap talk, W3C 2021): treat `MediaStreamTrack` settings latency as a rough input-latency proxy. "There's no brilliant way" to know exactly when input data arrived — [W3C workshop talk](https://w3.org/2021/03/media-production-workshop/talks/ulf-hammarqvist-audio-latency.html)
- Round trip = input + output latency. Output can be estimated as `AudioContext.outputLatency` (+`baseLatency`), and a measured click loopback calibrates the rest — [micbuffa/WAlatencyCompensation](https://github.com/micbuffa/WAlatencyCompensation); [MDN baseLatency](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency); [web.dev audio output latency](https://web.dev/articles/audio-output-latency)
- Browser caveats: Firefox reports `baseLatency` = 0. Chrome's `outputLatency` was observed to stay constant. Firefox shipped both in v70 — [WebKit dev thread](https://lists.webkit.org/archives/list/webkit-dev@lists.webkit.org/thread/4XHD7NVSKU7HPLYDXYEWYBRFMMZPKLBZ); [Mozilla bug 1324552](https://bugzil.la/1324552); [Web Audio API issue #2467](https://github.com/WebAudio/web-audio-api/issues/2467)

### Inferences
- For a vocal app, the recommended approach is to start capturing the mic at the start of the count-in, write one continuous buffer until stop, then:
  1. shift by the latency offset (auto estimate plus a calibration "clap test", and a manual ms trim like Logic's Recording Delay);
  2. slice into takes at the loop boundaries in song time;
  3. keep everything before the first loop start (count-in audio) and after each boundary as handles. This lets a singer who starts slightly early be recovered by dragging the take start left, as with Logic Quick Punch-In or Fender Studio Pro retrospective recording.
- Handles of a few hundred ms to one bar either side of each boundary are free in a single-file design. Take N's tail beyond the loop end is take N+1's head, so a short crossfade (around 10 ms, Logic's reported default) can be applied at the comp boundary with no gaps.
- Naming files: a single file per recording session (e.g. "Vocal – Rec 3") with derived take names "Take 1…N" matches DAW practice. Per-pass files are optional (REAPER), and REAPER warns this can glitch monitoring.

### Gaps
- No fetched source gives the exact amount of pre-record or post-loop handle that Logic, Ableton or Cubase keep in current versions.
- Cubase's equivalent manual record offset setting could not be confirmed. A forum mention of "Constrain Delay Compensation" concerns plug-in latency during recording, not a record offset.

## 5. Comping basics: choosing phrases, flattening

### Takeaway
Comping means choosing the best section of each take on a lane-by-lane basis: Logic Quick Swipe in take folders, Ableton take lanes into the main lane, the Cubase Comp tool, Pro Tools playlists with promote-to-main, Fender Studio Pro layers. Each boundary gets an automatic short crossfade. Flattening commits the comp to plain regions or a new file while keeping originals recoverable.

### Cited Findings
- Logic Flatten replaces the take folder with regions matching the current comp and deletes the unused take sections. "Flatten and Merge" creates a new audio file from the comp — [Apple: Flatten and merge take folders](https://support.apple.com/en-mz/guide/logicpro/lgcpb1998a98/mac); [Logic 10.1 help](https://help.apple.com/logicpro/mac/10.1/en.lproj/lgcpb1998a98.html)
- Logic Quick Swipe Comping cannot be used while Flex Time is on for the take folder (Reddit, low authority) — [r/LogicPro thread](https://redlib.hbubli.cc/r/LogicPro/comments/1ku0q7m/can_you_quick_swipe_comp_while_in_flex_mode)
- Comp sections are crossfaded automatically using the default crossfade preference — [Logic 9.1.6 Editing Comps](https://help.apple.com/logicpro/mac/9.1.6/help/English.lproj/en/logicpro/usermanual/chapter_15_section_5.html). A Logic 10.4.4 bug removed crossfades when a comp section was moved — [Gearspace](https://gearspace.com/threads/logic-takefolder-crossfade-bug.1286802/)
- Ableton: you edit your favourite moments from each take into the main composite. Take lanes are only heard in Audition mode — [Ableton Comping FAQ](https://help.ableton.com/hc/en-us/articles/360019092580); [Live 11 manual](https://www.ableton.com/en/live-manual/11/comping/)
- Cubase: the Comp tool splits lanes and marks which parts play — [Steinberg forum](https://forums.steinberg.net/t/recording-audio-in-cycle-mode-ai7-c7-5-20-comp-tool/638833); Steinberg docs on lanes — [Working with Lanes](https://steinberg.help/nuendo/v8/en/cubase_nuendo/topics/track_handling/track_handling_lanes_working_with_c.html)
- Pro Tools: comping with playlists — [Avid: Comping with playlists](https://www.avid.com/pro-tools/user-guide/playlists); [Blackbird Academy](https://theblackbirdacademy.com/pro-tools-playlists-and-comping/)
- Fender Studio Pro / Sound On Sound: takes are stored as Takes with a choice of which to play. Comping happens on layers, so takes are often converted to layers first — [Sound On Sound: Studio Pro Comping](https://www.soundonsound.com/techniques/studio-pro-comping?amp); [Fender Studio Pro manual: Comping](https://fenderstudiopromanual.fender.com/en/Content/Editing_Topics/Comping.htm)

### Inferences
- A minimal comp UX for a vocal app: show takes stacked under the main lane, tap or swipe across a phrase in any take to make it the active source for that time range (Logic Quick Swipe model), and add automatic 10 ms-ish crossfades at every switch point. Offer "solo this take" audition. "Flatten" bounces to a single take, with the originals kept for undo.

### Gaps
- Default crossfade shapes and lengths in current Cubase, Ableton and Pro Tools were not confirmed.

## 6. Monitoring modes during recording

### Takeaway
The standard is "auto input monitoring" (tape-style): an armed track lets you hear the live mic while recording or stopped, and the existing take during playback before and after punch points. A manual "input monitoring on" overrides this and always passes the live input. Software monitoring adds latency, and plug-in delay compensation can make recordings late, so hardware or direct monitoring is preferred where available, with software monitoring turned off to avoid doubling.

### Cited Findings
- Logic: Auto Input Monitoring is on by default. You hear the input only during actual recording, and previously recorded audio before and after it. The "I" (Input Monitoring) button overrides record-enable and auto input monitoring, so input is always heard — [Logic Pro X manual (punch in/out)](https://manualsdir.com/manuals/547422/apple-logic-pro-x.html?page=206); [Logic 9 manual](https://www.manualsdir.com/manuals/547962/apple-logic-pro-9.html?page=437)
- With auto input monitoring off, input is always heard on armed tracks and hides the recorded audio — [Beat Kitchen recording guide (third-party)](https://beatkitchen.io/guides/logic/06-recording/)
- Software monitoring adds latency from effects processing. With direct monitoring on the interface you may hear yourself doubled, so use one path — [Logic Studio Training wiki: Software Monitoring](https://logicstudiotraining.com/wiki/index.php/Software_Monitoring)
- Ableton recording timing depends on the track Monitor setting (Auto/In/Off) — [Ableton Help: Recordings are out of sync](https://help.ableton.com/hc/en-us/articles/19450890686876)

### Inferences
- In loop recording the performer is on the record pass continuously, so auto input monitoring means the live mic is heard throughout. Older takes do not play back during the loop, because the new pass is replacing them in the main lane (Logic also has an option to mute previous takes on new tracks). An app should therefore play backing track + click + live mic (or direct-monitor hint) during loop recording, never the previous take.
- With a Scarlet Solo-type interface, recommend the hardware "Direct Monitor" switch and turning off software monitoring of the dry mic. Offer software monitoring only when effects such as reverb in the headphones are wanted, and warn about latency.

### Gaps
- Ableton's exact Auto/In/Off definitions were not fetched (ableton.com blocked).
- Pro Tools "Auto Input" vs "Input Only" monitoring was not researched in detail.

## 7. Mobile / simple app conventions

### Takeaway
Mobile apps strip this down to one toggle (GarageBand iOS "Multi-Take Recording") or a cycle bar (BandLab). Each pass becomes a take inside a single region, and you pick takes from a menu with a check mark. There are no visible lanes and no comping by default.

### Cited Findings
- GarageBand iOS: Multi-Take Recording toggle in track settings. A new take each time the section restarts. Double-tap region > Takes > choose (check mark), during playback or idle. Delete takes from the same menu — [Apple 101934](https://support.apple.com/en-au/101934)
- BandLab: the Cycle Bar loops during playback or recording, and recording always starts at the cycle start — [BandLab Help](https://help.bandlab.com/hc/en-us/articles/57252306473497-Looping-Regions-and-Setting-a-Playback-Cycle)
- Apple support note: loops created from multi-take recordings in GarageBand are sometimes short (a known issue) — [Apple support 101699](https://support.apple.com/en-lb/101699)

### Inferences
- Best-practice synthesis for the new app:
  - One "Loop record" button that loops the current section.
  - A 1-bar click count-in by default, once only.
  - Record continuously until stop, then auto-slice into Take 1…N.
  - Drop a final fragment shorter than half the loop, but keep it recoverable.
  - The last full take is active.
  - A takes menu or strip with a check mark, tap-to-audition, and optional swipe-comp with automatic short crossfades.
  - Latency compensation with a one-time clap or loopback calibration plus a manual trim.

### Gaps
- BandLab mobile multi-take and count-in specifics are not confirmed from official sources.
