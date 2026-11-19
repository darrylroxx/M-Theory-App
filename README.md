# M-Theory 🎸

**Your own guitar chord, key, mode & progression lab. No subscriptions, no ads, works offline.**

M-Theory answers the questions that matter when you're writing songs on guitar:

- *"I'm in B. What chords can I use?"* All of them: diatonic, colour chords, borrowed, chromatic.
- *"How else can I play this chord?"* The shapes guitarists really use, starting from the common ones and branching out, not just the barre shape.
- *"What could come next?"* Suggestions from safe to wild, each with a plain-English reason.
- *"What mode is this, and how do I make it sound like that mode?"*
- *"What does it sound like over a beat?"* A drum machine with a library of about 115 synthesized sounds, 18 kits, 8 classic machines, 100+ rhythms, studio-style effects, and a separate rhythm for every section of the song.

---

## What's inside

**How the app is laid out.** Seven pages, chosen at the top: **Track**, **Frame**, **Chords**, **Melody**, **Drums**, **Vocals** and **Canvas**. The frame directs: it sets the sections, how many bars each has, the key and the tempo, for every track. Chords, Melody, Drums and Vocals are what plays inside the section you are working on. Canvas is the song as a painting, made while it plays. Under the page tabs is the play bar, the same on every page. **▶** plays the song straight through, in order, from the section you are on to the end, and the page follows along. Nothing loops unless you ask. Beside it is the **loop bar**: the whole song drawn bar by bar, section after section, which scrolls sideways. Tap a section's name to go to it. **Tap bars to loop them: every tap adds a bar** (tap 1, 2, 3 and three bars loop), and a bar further off brings everything in between with it, in the same section or across several. Tapping the bar at either end of the loop takes it off again; a bar in the middle becomes the whole loop. **↻** loops the whole section you are on, or switches looping off. Looped bars are drawn dark, and a line marks the bar that is sounding. A loop can be changed while the music plays. Both stay put as you scroll.

**The Track page.** The whole song on one page, left to right in bars, the way a studio app shows it: one row per track and one block per section, drawn from what is in it (the chords by name, the melody's notes, the drum hits). The sections and the Track page are the same song seen two ways: whatever is written on a section's pages shows up in its blocks, and a tap on a block opens that section's page for that instrument. Each row's head is the instrument for the **whole song**: its volume, **M** (mute) and **S** (solo) apply in every section at once and are saved with the idea. A muted track is not painted on the Canvas either. While the song plays a line runs across the page; looped bars are shaded. **−** and **+** zoom.

**More tracks.** A song starts with one Chords, one Melody and one Drums track. **+ Add track** (at the bottom of the Track page) asks what kind: Chords, Melody, Drums or Vocals, and the new track opens on its page, empty and ready to write. When a kind has more than one track, its page has a switch at the top (Chords · Chords 2 …) to choose which one you are writing; every section has its own part for every track. An added track has its own instrument sound, its own mixer strip (volume, M, S) and plays alongside the others. ✕ next to its name on the Track page removes it, in every section. (An added drums track shares the drum effects of the first one; its kit, sounds and rhythm are its own.)

**The Vocals page.** Recording, in the Windows app. It talks to the audio interface through its ASIO driver, playing and recording on the interface's own clock.
- **Record (●)**: the song of the loop is rendered and handed to the engine; a count-in (none, 1 or 2 bars, accented on the first beat, counted down on screen) plays **once**, and then the loop goes round and round, **every pass a new take**, for as long as you keep singing, until **■**. It is made for staying in the flow: idea after idea, pass after pass, until something comes out that you want to keep. The loop (set with the bar strip; the section on screen if none) is locked while recording, and the main **▶** cannot start a second song over it. **▶ Rehearse** sings along without recording.
- **While you sing**: the pass you are on is shown big (**Pass 7**), a thin line fills as the pass goes by, and every pass already sung waits in a row beneath. **Tap a pass to keep it ★**, or tap the big **★** for the pass you are singing, or press **K** on the keyboard (in the first moments of a pass, K keeps the one you have just finished: a pass is known to be the one only once it is over). Nothing pops up and nothing on the page moves while you sing; small notes appear beside the pass number after half an hour, when the disk has less than 2 GB left, and when the recording is near the longest a file can hold.
- **The lane**: the bars being recorded over, across the whole width, numbered, with the take that plays from each recording drawn where it sits, and a line that moves with the music while it plays or records. Tap a take in the lane to hear it alone.
- **Lined up**: the take is moved by the round trip the driver reports (when the first beat was heard against when the voice was captured), so it sits on the beat; a timing nudge corrects anything the driver does not count. The file holds one sample for every frame of song played, however long the session: wherever voice is lost (the computer could not keep up, the disk was busy for more than 20 seconds), silence takes its place, so every later pass stays exactly where it was sung. How much was filled is said when you stop.
- **Takes**: one recording is one file in *Music › M-Theory › Recordings*, cut into one take per pass at **■**. The passes you kept are marked **★**, and the last of them is the one that plays (with none kept: the last full pass); any other can be chosen (double-click to hear one alone), and ★ can be given or taken off afterwards. A session can leave hundreds of passes, so each recording lists its ★ takes, the one playing and the newest few, with **+N** for the rest; a pass stopped before half-way is kept but hidden. Takes play with the song, through the vocal track's own mixer strip, and show on the Track page.
- **Long sessions** (an hour or more) are safe: the voice is written to disk as it comes (a crash loses a second at most); the vocal sound is put on the recording a block at a time, never holding it all in memory, and the page shows how far it has got; a take is read back on its own, so playing one pass of an hour-long file costs no more than any other. If the driver resets in the middle (its buffer size or rate was changed), the recording is closed, handed back and cut into takes, and the interface opens again. A WAV file cannot be bigger than 4 GiB, so a recording stops cleanly a little before that (about 3 hours at 48 kHz) and says so; if the disk has no room left for the version with the vocal sound, the takes are kept dry and **↻ Apply sound** puts it on later.
- **Hearing yourself**: **Direct Monitor** (on the interface: dry, no delay) or **Through my effects**: the voice goes through the vocal chain to the headphones, a few milliseconds late. The **Buffer** choice on the page asks the interface's driver for a buffer size (no need for the driver's own panel): smaller is sooner, too small crackles; the page shows the round trip as measured from the driver and counts **dropouts**, and says when to go bigger. 64 at 48 kHz is a good start, 128 is safe for most computers. Through my effects stays on as you move between pages (a red dot on the Vocals tab says the mic is live).
- **Steady live sound**: the audio thread never waits, allocates or frees memory; reverb tails can't slow it down (denormals are flushed to zero); on Windows it joins the "Pro Audio" scheduler class, the app is never power-throttled, and the computer doesn't sleep while the interface is open. Extra monitoring delay left by a hiccup is taken out with a short crossfade.
- **Vocal sound** (per vocal track): a studio vocal chain with no look-ahead, so the voice is never delayed. Pick a **preset** by the kind of record (Modern pop, Ballad, R&B / soul, Rap, Melodic rap, Rock, Slapback, Punk / metal, Indie, Dream pop, Ethereal, Surf / dub, Folk / acoustic, Dance, Lo-fi, Spoken …), then shape it:
  - **Colour**: Clean, Tube, Console, Tape, Silk or Exciter, with one Amount knob that changes the tone and not the volume. The five that bend the waveform run at twice the sample rate (about 0.05 ms), so the harmonics they add never fold back as harshness.
  - **EQ**: a graph. Frequency runs left to right (20 Hz to 40 kHz, each octave as wide as the next), decibels up and down, and the curve shows everything the EQ is doing. Six points to take hold of: low cut, Body (a low shelf), Low mid and Presence (bells), Air (a gentle shelf whose corner can sit above hearing: the shaded strip) and high cut. Drag a point sideways for its frequency and up or down for its gain; the mouse wheel on a bell makes it wider or narrower; a double-click puts a band back; arrow keys work too. What is drawn is what is heard: the bells and the air shelf are analog-matched, so at 48 kHz they keep their shape right up to 20 kHz, where ordinary digital EQ is about a decibel out. Settings glide, so a preset can be changed mid-note without a click.
  - **Dynamics**: Punch (a feedback FET-style compressor), Smooth (an optical one whose release is fast at first and then takes seconds), De-ess, Gate. The **de-esser** is split-band and judges how much of the voice is "s", not how loud it is, so it works the same sung softly or belted; it sits after the brightening EQ (so it tames what Presence and Air add, and keeps esses out of the reverb), takes off at most 9 dB and lets go in 15 ms. The **gate** is a gentle 2:1 expander: gaps are turned down by 6 to 18 dB, never to silence, it waits 150 ms before closing and cannot flutter. At the very end a **limiter** holds loud passages at −3 dBFS (turned down cleanly, not clipped) under a soft ceiling at −1 dBFS; a red **LIMIT** light shows when it is working, which means the level going in is too high.
  - **Width**: Double, Micro (a few cents flat on the left and sharp on the right) or Chorus.
  - **Echo**: Slap, Tape, Analog, Digital, Ping-pong or Ambient, at a slap or at 1/8, dotted 1/8 or 1/4 of the tempo. The time glides when changed.
  - **Reverb**: seven spaces, each a different design and not one engine re-tuned: **Plate** (bright, the classic), **Room** (one dense, dark, short burst behind six wall reflections), **Hall** (late and warm, the highs fading first), **Chamber** (eighteen parallel echoes: bright, thick within a moment), **Cloud** (twelve drifting loops a side: a wide wash that arrives after the voice and hangs for seconds), **Spring** (a guitar amp's tank) and **Shimmer** (a plate whose tail climbs an octave). Size, darkness and pre-delay on each; all come back about equally loud. Echo and reverb step back while you sing (Duck) and their lows are kept out of the mix.
  The research behind it, with every source and licence, is in `reports/Open source vocal plugin DSP.md` and its follow-up `reports/Open source vocal plugin DSP 2.md`; credits are in `NOTICE.md`.
- **Interface**: the level of Input 1 (mic) and Input 2 (instrument/line) in the interface's own colours, which input the track records, the song and click levels in the headphones, and a checklist of the interface's switches (no software can read them).

**A time signature for the song, and for any section that wants its own.** The Frame page sets the song's (2/4, 3/4, 4/4, 5/4, 6/4, 7/4, 6/8, 9/8, 12/8), and every section plays in it unless it has been given one of its own: the small signature on each section's row picks it (the song's own is marked with a dot, and picking it makes the section follow the song again). A section's signature alone says how long its bars are, on every page: the chord ruler, the melody grid, the drum grid, the Track view, the loop bar, the count-in and click for vocals, and the MIDI file, which writes each section's signature where it starts (and a new tempo where the beat changes between a quarter note and a dotted quarter, since the tempo counts beats as the app does). (It used to follow the drum rhythm, or the playing style when the drums were off, so two sections or two tracks could disagree.) Changing a signature takes what it covers along: chords that lasted whole bars still do, melody notes stay in their bars, every drum rhythm on every track is fitted to the new bars (6/8, 9/8 and 12/8 turn 16ths into triplets, and back). The song's signature takes along every section that follows it; a section's own takes along only that section, and every other section sounds as it did. **↶** takes either change back for a little while. A section in another signature that follows the first section's drums plays them fitted to its own bars, and still follows them. A rhythm picked from the library, or pasted from a section in another signature, is fitted the same way. This is enforced in one place (`song/unity.ts`), on every change. Recordings keep the signature of the section they were sung in.

**Tracks from any page.** The bar above the Chords, Melody and Drums pages (and the top of Vocals) lists that kind's tracks with a **+**: another chords layer, another melody, more drums, another vocal. Whatever is added shows on the Track view and on every section row of the Frame page.

**Drum mixer.** On the Drums page, **Mixer** (before Sound and Effects) has a fader, mute and solo for each drum and one fader for the whole kit.

**The Frame page.** A row for every section in playing order: the grip **⠿** to drag it anywhere in the song (with a mouse, or a finger on the grip; on a phone, holding the row a moment and dragging works too, and the page scrolls along near the top and bottom of the screen; the other rows make room where it would land; with the keyboard, ↑ ↓ on the grip, or Alt+↑ ↓ anywhere on the row), its name (tap another section's to work on it; tap the one you are on to rename it: Enter keeps the name, Esc leaves it as it was), its length (**−**, **+**, or tap the number for 1, 2, 4, 8, 12, 16, 24, 32 bars), its time signature, **Copy**, **Paste** and **✕** (removing a section with vocals recorded in it asks first), and a chip for **every track** (Chords, Melody, Drums, the tracks added on the Track page, and each vocal track) that shows what that track holds in the section (how many chords; how many recordings) and opens its page there with that track ready. **+ B** adds a new section; **↻ A** plays a section a second time (the same music; **Unlink** makes a repeat a section of its own so it can differ).

**Letters and names.** Sections are lettered in the order they first play: whatever plays first is A, the next new one B, and so on, so dragging C to the front makes it A. Any section can be given a name of its own instead ("Verse", "Hook", up to 24 characters; an empty name gives the letter back). A name belongs to the section, so it goes with it wherever it is moved, and both blocks of a section played twice share it. Each section also keeps its own colour wherever it goes. The name is used everywhere the letter was: the play bar, the Track view, the top of the Chords, Melody and Drums pages, the **= A** chips, the chord chart and the list of ideas.

**Copy and paste a whole section.** **Copy** on a row takes everything in that section: every chords track, every melody, every drums track (rhythm and kit), every added track's part, how it sounds (style and feel, both harps), its length and its time signature, and the vocals recorded in it. Every other row then offers **Paste**, which puts all of that in place of what that section had (asking first if it has anything in it). A section played twice changes in both places, as an edit there would; the recordings go only into the block pasted into, as recordings of their own that play the same audio files (nothing is copied or deleted on disk). The pasted section keeps its own name and colour, and the other sections keep sounding as they did, even when the paste goes into the first section. A message with **↶** offers to take the paste back for about 20 seconds. The copy is kept when the app is closed, so a section can be pasted into another idea; its tracks are matched by name there (or added), and in another key the chords and melodies move to that key. Below: the **key** and mode of the whole song, **Move song** (key, chords and every melody, the added tracks' too, up or down a semitone together), the **tempo**, and **Export**: **Song as WAV** (the whole song as you hear it, every track and the recorded vocals, with the Track page's levels, mute and solo; 24-bit, 48 kHz, never clipping, the last reverb left to ring out), **MIDI file** (every track by name: chords, melodies, drums; recorded vocals are audio, so they are in the WAV), and chords and tab as text (the added chords tracks too). Recordings keep the tempo and key they were sung in: if either is changed afterwards, the page says so (and offers the tempo back).

**The frame is literal.** A section is exactly as many bars as it is set to, and Rhythm, Melody and Drums each show every one of those bars. **What is in a bar plays; an empty bar is silent.** Nothing comes round again on its own.

- **Rhythm:** the chord ruler is drawn as long as the section. Chords fill it from bar 1; bars with no chord are drawn empty and play nothing. **+ Rest** adds a bar of silence between chords (it can be dragged and resized like a chord). Chords that run past the last bar are struck out, with one tap to make the section long enough.
- **Melody:** the grid has a tab for every bar of the section. Bars with no notes are drawn hollow.
- **Drums:** the grid has a tab for every bar too. A rhythm you pick fills every bar; in Edit, **Clear** empties the bar on screen so it plays nothing, and **⧉** copies the bar before into it. Each bar can be changed on its own.

Making a section shorter never deletes anything: what lies past the end is kept and comes back if the section is made longer again. A new section starts as long as the one it was made from. Songs made before sections had lengths get one when they are opened, and anything that used to come round again in them is written out in full, so they sound as they did.

**Settings carry over.** Whatever you set in the first section (the playing style and its feel, the two harps' sounds, the drum kit, the drum rhythm, drums on or off) is what every other section uses, even if you change it later. Change one of those things in another section and that section keeps it as its own from then on; a small chip says which it is: **= A** (follows A) or **Own ↺** (tap to follow A again). Chords and melody notes always belong to their own section. The first section is always the one that plays first: drag another to the front and it leads from then on, and every section keeps sounding as it did (what a section played that the new first one does not give it, it keeps as its own).

**Copy and paste between sections, one page at a time.** The Chords, Melody and Drums pages each have **Copy** and **Paste** at the top, next to the name of the section on screen. Copy takes everything on that page of the section; Paste puts it into the section on screen, in place of what is there. Each page has a clipboard of its own, so chords only paste as chords, a melody as a melody and drums as drums, and copying drums never wipes a copied rhythm. Paste shows the section it comes from, and turns into **↶ Undo** for a little while after a paste.
- **Chords** copies the chords (lengths, rests and chosen shapes), the playing style with its feel, and the chord harp's sound.
- **Melody** copies the notes, the grid, on/off, and the melody harp's sound.
- **Drums** copies the drum rhythm, on/off, and the whole drum sound (kit, each drum's sound, mix and effects).

A paste changes only that page: the section keeps its length (the Frame decides it) and its other two pages. If what is pasted runs past the end of the section, the part past the end is kept but does not play, and you are told. Pasting into section A changes what the other sections follow, just as changing A by hand does. The clipboards are kept when the app is closed, so a part can be pasted into another idea too; if that song is in another key, the chords and the melody are moved to its key.

On the **Chords** page:

1. **Key**: tap one of the 12 notes.
2. **Mode**: Major, Minor, Dorian, Phrygian, Lydian, Mixolydian, Locrian, Harmonic minor, Melodic minor (27 more under "More…").
3. **Chords appear**: one card per note of the scale, each drawn as an easy shape with finger numbers. **Tap a card to hear it**, and everything else the key offers on that note is listed under it by kind: sus, sixths, sevenths, added notes, ninths and beyond (56 chord types are checked against the scale, so nothing that fits is left out and nothing foreign gets in). A row of ten kinds chooses what the cards show: **Triads, Power, Sus2, Sus4, 6ths, 7ths, Add9, 9ths, 11ths, 13ths**. Each kind is built on every note of the scale and shown only where it uses notes of the key alone (so there is no sus2 on the third note of a major key); a note with no chord of that kind is left hollow. Two choices follow standard practice: ninths leave out a flattened ninth over a minor chord, and elevenths use the raised eleventh on major chords and the suspended form on dominants, because a plain eleventh clashes with a major third. Card colours show each chord's job: 🟢 Home · 🔵 Near home · 🟠 Away · 🔴 Tension; ★ = holds the mode's signature note. **Outside** has borrowed and surprise chords; **Next** suggests what could follow your last chord. On a phone the cards are one row to swipe through.
4. **Shapes** (the button on every chord) opens the shape finder: the ways guitarists really play that chord, starting from the ones everybody knows.
   - **Common**: the textbook open chord, the two movable barre shapes (root on the 6th string, root on the 5th string), the small four-string shape, and for seventh chords the standard jazz grips.
   - **Small**: three- and four-string shapes with no big barre, grouped by string set and running up the neck. The way out of playing barre chords for everything.
   - **Inversions**: the same chord with another note in the bass (C/E, C/G), grouped by bass note.
   - **All**: everything playable, grouped by where it sits on the neck.
   - Tap a shape to hear it and use it. **Flavours** along the top swap the chord itself (C → Cmaj7, Cadd9, Csus2, C6…; "All…" has all 56 types).
   - Only comfortable grips are listed: no muted strings in the middle of a chord (except the classic thumb-muted ones like 3x0003 and 5x555x), no stretch wider than four frets, no open strings mixed with notes far up the neck.
5. **Build the progression in the tray.** It sits under the chords, on the Chords page. While it is off screen a slim bar at the bottom of the screen stands in for it: ▶, your chords by name (tap one to hear it, drop new ones on it), and an arrow back to the full tray. On a phone this leaves about four fifths of the screen free. Drag chords in (touch: press and hold, then drag; or tap **+**), drag to reorder, ✕ to remove. The finder stays open above the tray, so you can **drag one exact shape straight into the tray**. Tap a chord in the tray to hear it; the small grid button under it opens the finder for that spot (shape, flavour, length, position).
   - **How long each chord lasts**: the strip under the tray is the section drawn to scale, every chord as wide as it is long, with a line at each bar. **Drag the edge between two chords** to move where the change falls inside the bar (the two share the time). **Tap a chord** in the strip to set its length exactly: − / + in half beats, or 1 beat, ½ bar, 1 bar, 2 bars. A bar that is not full yet is shown hatched.
6. **Arrange** (the bar on top of the tray, once you have two chords): tap a neck area (**Open · 1–3 · 4–6 · 7–9 · 10–12**) and every chord in the progression is re-voiced there together, picking the set of shapes that needs the least hand movement. The bar shows the frets the whole progression now spans.
   - **Strings** (Any / 3 / 4 / 5–6) and **Inversions** (let the bass note change for smoother moves) re-deal the set.
   - **‹ ›** under each chord in the tray sifts that one chord through its other shapes, best fit with its neighbours first, while everything else stays put. Do it while the loop is playing to hear each option in context.
   - Chords you add later land in the same area. **My shapes** switches back to each chord's own shape.
7. **Melody** (the second part of a section): a grid of notes. **Tap a square and that note plays at that moment**; tap it again to take it out.
   - Rows are notes, two octaves from the key's home note, named the way the key names them. **Rows that belong to the key are lit** and the home note is brightest; the others are grey. **Key only** hides the grey rows, so no tap can be out of key.
   - **A dot marks the notes of the chord playing underneath**, and each chord's name sits above the step where it comes in. A tune that keeps to lit rows and dots cannot sound wrong.
   - **Grid**: ♩ ♪ ♪3 ♬ sets how many steps there are to a beat. Notes never move when you change it. **Bar** tabs, **+** to add a bar (up to 8), ⧉ to copy the bar before, ↶ Undo, Clear. A line follows the music.
   - **It has a harp of its own**, under the grid: its own instrument (any of the 22), sound, strings and effects, on a channel separate from the chords. Echo on the melody is not echo on the chords. Each note rings until the next one.
   - Every section of the song has its own melody. A melody shorter than its section comes round again; one that is longer makes the chords repeat under it. It plays without any chords too. MIDI export puts it on a track of its own.
8. **Harp** (on the Chords page, under the tray). The chords are played on a harp, built for writing with: warm, clear and never tiring.
   - **Style ‹ ›**: 136 ways to play the chords, in eleven groups. The arrows flip through a group, the name opens the list, and picking one plays it straight away.
     - **Simple** (let ring, plucked, on the beat), **Strumming** (the island strum and its relatives, sixteenth-note ballad and pop strums, strums with a muted "chuck" on two and four), **Bass & strum** (boom-chick, bluegrass, bolero), **Fingerpicking** (alternating thumb, pinches, banjo-style rolls, bass and chord), **Arpeggios** (rolling up and down, ripples, sixes, triplets), **Harp** (rolled chords, broken chords, roving thumb, cascades, glissando), **Rock** (muted eighths, gallops, stabs), **Funk & reggae** (scratched sixteenths, skank, ska, one drop), **Latin** (bossa nova, samba, rumba, tresillo, habanera, clave), **Shuffle & 6/8**, **Waltz**.
     - The pattern follows the bar, not the chord: two chords sharing a bar share one pass of the pattern, the way a player keeps the hand moving through a change. In a 3/4 or 6/8 drum rhythm every style changes to fit, and sixteenth-note styles follow the drums' swing.
     - Every section can have its own style, so a verse can be picked and a chorus strummed.
     - **Feel** (under the list): the same style at **½×, 1× or 2×** speed, with more or less **Swing**, a lighter or heavier **Touch**, tighter or wider **Spread** of the strings, and an **Octave** lower or higher. Each section keeps its own.
   - **Harp ‹ ›**: 22 instruments. *Harps*: Concert, Folk, Wire, Latin, Baroque, Bray (its strings buzz), Kora, Lyre, Electric, Harp harmonics. *Plucked*: Nylon guitar, Steel guitar, Koto, Dulcimer, Mandolin, Banjo, Ukulele, Pizzicato. *Bells*: Music box, Kalimba, Glass bells, Vibraphone.
   - **Sound ‹ ›**: 18 ready-made sounds that work on any of them (Natural, Warm, Bright, Dry and close, Dreamy, Ambient, Cathedral, Lo-fi tape, Underwater, Twelve-string, Halo, Dotted echo, Tremolo, Phaser, Valve glow, Big desk, Crunch, Fuzz). **+ Save this sound** keeps your own.
   - **Strings**: **Pluck** (the middle of the string, round and hollow … by the soundboard, thin and bright), **Soft** (nail … finger pad), **Ring** (how long the strings sing, and how far one chord runs into the next), **Body** (the soundboard's warmth and knock), **Octave** (every string doubled an octave up), **Wide**, Volume.
   - **Effects**, in the order a pedalboard is wired: **Saturation** (the same six colours as the drums: Tape, Tube, Console, Crunch, Fuzz, Clip, with a Blend knob), **Squeeze** (compressor), **Tone**, **Chorus**, **Phaser**, **Wobble** (tape wow and flutter), **Tremolo** (in time with the song), **Echo** (bouncing side to side, in time), **Reverb** (Hall, Room, Plate, Spring, Lo-fi) with Size, and **Shimmer** (a halo an octave above, heard in the reverb). The knobs change the character, not the volume. Double-click any knob to reset it.
9. **Drums** (the third part of a section). At first it shows only what you need: the kit, the rhythm and the grid.
   - **Kit ‹ ›**: the arrows flip through kits, the name opens the list.
     - 24 kits by sound and genre: Soft Box, Cassette, Dusty, Cold Wave, Dark Club, Neon, Arena, Studio, Brushes, Trap, Techno, Industrial, Glitch, Dub, Breaks, Analog, Mallets, Boom Bap, Garage, Funk, Disco, Jazz Club, Metal, Hand Drums. Each picks a sound for every drum, knob settings, effects and a colour of saturation.
     - 8 machines, each built the way the real one makes sound: **Vintage** (70s organ rhythm box), **808**, **909**, **707**, **Linn**, **Volca**, **Lo-fi** (8-bit), **Modular**.
     - **+ Save this kit** keeps your own setup for other songs.
   - Every section can have its own rhythm and its own kit, and the drums can be off in one section and on in the next.
   - **Rhythm ‹ ›**: 286 rhythms in fifteen styles: Pop, Rock, Indie, Alternative, Dream pop, Dark wave, Electronic, Hip hop, 808 & trap, Funk & soul, Jazz, Punk & metal, 6/8 & shuffle, Latin & world, Organ presets. These are the standard beats of each style (four on the floor, boom bap, trap, drill, two-step, the classic break, motorik, the swing ride pattern, bossa, the skank beat, the blast beat and so on), named for what they are. Some are two bars long, with a fill or an answering bar; some are in 3/4, 5/4, 6/8, 12/8 or a swung jazz 3/4 and 5/4. In the jazz rhythms the ride cymbal is on the Hat row and the hi-hat foot on the Shake row (the Jazz Club kit puts the right sounds there).
   - **The grid is locked**, so a stray tap changes nothing. Tap **✎ Edit**, then tap squares (or drag along a row to paint). **↶ Undo** steps back one change at a time, **Cancel** throws the changes away, **✓ Save** keeps them and locks the grid again. A rhythm you changed is also stored under "Mine". While editing: Soft / Normal / Loud for new hits, ✨ for a small random change, Clear.
   - **Bars**: while editing, **+** adds a bar (a copy of the one on screen, so you only change what should differ: a fill, a variation), ✕ removes one; up to 8 bars. While playing, the grid follows the bar that is sounding. A section lasts until its drum pattern has finished: four bars of drums under two bars of chords play the chords twice.
   - **Sound**: tap a drum's name. **‹ sound ›** flips through that drum's library (a snare has 23: 808, 909, Acoustic, Gated, Dusty, Brush, Piccolo, Crack, Modal… plus each machine's), then **Tune, Decay, Click / Snap / Bright, Punch / Body / Attack, Drive, Filter**, and its place in the mix: **Level, Pan, Reverb, Echo**. The picture shows the sound change as you move a knob. **M** mutes, **S** solos, ↺ puts it back. Double-click any knob to reset just that one.
   - **Effects** for the whole kit: one-tap vibes (**Clean, Warm, Fat, Punch, Dreamy, Cassette, Dusty, Gated 80s, Big Room, Crunch, Blown out, Dub, Pump**), or set them yourself:
     - **Saturation**, in six colours: **Tape** (soft and thick, smooths the top, adds weight below), **Tube** (warm, an octave of sweetness above each note), **Console** (fat lows, clean top), **Crunch** (barking mids, tight low end), **Fuzz** (square and blown-out), **Clip** (shaves only the peaks: louder and punchier, not dirtier). A quarter turn is colour you feel more than hear; full is distortion. **Blend** sends only part of the kit through it, which keeps the clean punch underneath.
     - **Reverb type** (Room, Hall, Plate, Spring, Gated, Lo-fi), Reverb, Size, Echo and Echo time.
     - **Sampler** (12-bit, Warm 12, 8-bit, Toy, Crushed): the grain of old sampling drum machines. **Noise** (Vinyl, Tape, Room, Hum) under the drums while they play. Tape (wobble and dullness).
     - Tone, Glue (compression), **Pump** (the harp ducks under every kick and swells back).
     - Tempo, Volume, Swing, Human (looser timing and touch).
     - The knobs change the character, not the volume.
   - Picking a 3/4 or 6/8 rhythm changes whole-bar chords to match (4 beats become 3 in a waltz). With no chords in the tray, ▶ plays the drums alone so you can jam over them.
10. **Song** (the Frame page): sections are lettered in the order they first play, **A B A C**…, or called by the names you give them. The page is section A to begin with. Tap a section in the play bar to go there.
   - **+ B** adds a section with its own chords and melody, and A's settings until you change them there; **↻ A** plays A once more. New sections land right after the one you are on.
   - The same section twice is the same music: change one A and every A changes. **Unlink** makes one of them a section of its own (with a copy of the chords, melody, style, drums and time signature), so it can differ.
   - **Drag** a section by its grip to move it anywhere (on a phone: hold the row, then drag). Whatever ends up first is A. ✕ removes it.
   - **↻ A** / **→ Song** next to ▶ choose between going round the section you are on and playing on through the song, each section with its own settings, while the page follows along.
   - MIDI export (with each section's drums) and "Copy tab" cover the whole song. Songs saved with Verse / Chorus names open with letters.
11. **Save** (top bar) puts the idea in your library. **Ideas** lists everything you have saved: tap to open, type to rename, ✕ to delete, "+ New idea" for a blank page. Save lights up whenever there are changes the library does not have. In the claude.ai version the library is also kept in your Claude account, so it follows you between devices; **Backup** and **Restore** move it as a file.
12. **▶** plays it. The Frame page has the tempo, **Move song** (the melody moves with the key) and **MIDI export** (the harp part exactly as the style plays it, the melody on its own track, and a drum track on channel 10), copy chords + tab, and saved ideas.

A **Capo** menu sits at the top of the Chords page, next to the key; ★ marks the capo that removes the most barre chords (B major: capo 4).

Settings (⚙): avoid barre chords (on by default), 11 tunings, capo, dot labels, left-handed diagrams, light/dark theme.

---

## The Canvas: music paints itself

Open **Canvas** and press ▶, or open **any song from a file** (the folder button, or drop a file on the canvas: WAV, MP3, FLAC, OGG, and whatever else the browser can read) and press its ▶. While the music plays it is painted, live, in wet paint on a woven surface. The painting is a picture of the sound you are making: every part of the music has its own kind of paint, the canvas fills only as far as the music fills it, and music of one kind paints pictures of one kind. No two paintings come out the same: press **Clear** and play the same song again for new detail on the same picture.

**The layers.** The music is heard as the parts that play together, and each part is painted in a paint you can tell from the others by its shape alone, even in grey. The row of little swatches under the canvas shows each one in the colours in use; it lights up while that part is playing, and a tap hides or shows that part.

- **Drums: impacts.** The kick is a soft round blot low down, a snare a burst of hard little drops, the hats a dry stipple of specks near the top, a cymbal a trail of specks as long as it rings.
- **Bass: broad, flat, heavy bands** along the bottom. A held note is one band; short notes are stacked slabs.
- **Chords: washes.** A held chord is a thin, wide wash from its lowest note to its highest, in the colours of its notes; a new chord is a new wash; a stabbed chord is a hard-edged block. The more a chord clashes, the more layers it has and the greyer it goes.
- **Melody: one continuous line,** as if drawn by one loaded brush. Notes that join are one curve; short notes are a dotted line along the same path; a leap starts a new stroke.
- **Harmony: a companion line** beside the melody, thinner and lighter, hatched to it where the two run close (more densely the rougher they sound together). A track marked as a harmony is painted this way.
- **Vocals: a luminous ribbon** of fine strands. Breath splays the strands, loudness makes them glow, a vibrato ripples them. On a dark ground it is laid on as light.
- **Other: fog,** edge-less haze that drifts (pads, ambience, the room).

They lie in a fixed order, as a painter would lay them: fog and washes underneath, the bass and the lines in the middle, the voice's glaze and the drums on top. A wash that dries after a spatter of drops goes in under the drops.

**The marks answer the sound.** How loud is how big and how heavily loaded. How hard a sound starts is how hard its edge is and whether it throws paint; a sound that swells in has a feathered edge. How long it rings is how long its tail is. How noisy it is is how broken and splayed the mark is, and how far its drops fly. How bright it is is how light its colour. A bend is a slope and a vibrato a ripple. The app knows every note and hit it plays before it is heard, so the marks of your own song land with their sound.

**Layouts** (**Layout**: **Auto**, or one of six). Every layout keeps a sound's height (or, in the round ones, its distance from the middle) for its frequency, so a picture can always be read. What changes is how time is spent:

- **〰 River:** the canvas itself flows slowly to the left and the paint is laid into the current; nothing sweeps across it, and the lines of the music meander a little as a river does.
- **≋ Field:** each part is carried by a current of its own across the whole canvas, back and forth, bent by a slow swirl, so the parts cross and weave over each other.
- **◎ Rings:** time goes round, frequency goes out from the middle; one turn every few bars, so the downbeats line up on spokes and a repeated groove draws the same rosette.
- **✿ Bloom:** each section opens like a flower from its own place on the canvas, turning a little as it grows, so a held note curls out like a petal.
- **☰ Lanes:** each part in a band of its own (the bass low, the chords in the middle, the melody above them, the drums at the top), flowing left like the river.
- **→ Sweep:** left to right across a page of bars, page after page, with the bar numbers and the guide: the way to read a song bar by bar.

On **Auto** the music chooses, from its vibe (below): a steady groove tends to the river or the rings, calm held music to blooms, energetic textured music to the field, a dense arrangement of many parts to lanes. It changes its mind only when another layout suits clearly better for a bar or more, and keeps its choice once it knows the song. When the layout changes, what was painted before sinks back for a few seconds under the new one, so the first picture stays as a ghost rather than a muddle.

**As full as the music.** The canvas fills in proportion to how much is playing, how loud: two quiet parts leave most of it bare ground (about a fifth covered); six loud ones cover about two thirds; some ground is always left. No part can cover the canvas on its own: a busy hi-hat gets its share and no more. When the music gets quieter nothing new is added, and paint that is more than the music now calls for sinks slowly back into the ground, so a long song never turns to mud.

**The vibe.** About seventy numbers are measured from the music as a whole (the shape of its sound, its harmony and key, its rhythm and groove, its dynamics, how its notes are held or clipped, and which parts play and how much), the way music-similarity research measures songs, and read against fixed reference figures. They set how wet the paint runs, how loose the hand is, how fast the currents move, how many marks a sound leaves, how long the strokes are, which way round the palette the parts are cast and which layout Auto chooses. The same song always gets the same vibe; a song with similar parts gets a similar one, whatever its key, tempo or mix, and so a similar painting, while every mark, which follows its own notes, is new. Write a song inspired by a favourite, run both through the canvas, and you can see how close the atmosphere is.

**Songs from files are split into layers** on your own computer, as soon as they are opened, well ahead of where they play: what is sudden is the drums, what is steady and low the bass, what is steady, in the middle of the stereo picture and does not repeat the voice, and the rest is shared out into chords, melody and fog by how its notes behave. This is plain signal processing, not a trained model, so the layers are approximate (a held synth line can pass for a voice, and a voice singing alone is painted as the other parts are). A split leaves scraps in every layer, and they are cleared away before anything is painted: a drum's ring (a kick's thump goes to the bass, a snare's body to the rest), and tones that flicker for a few hundredths of a second where the split is unsure; an overtone the ear hears as a tone of its own is part of its note, not a mark of its own; and fog comes only from noise that goes on (air, breath, a room), not from a hi-hat. So a song of drums alone is painted as drums, and a song from a file paints much closer to the way the same music written in the app does. Until the split has caught up, the whole mix is heard and its notes shared out. The vibe of the whole song is known by the time it has been heard through once (a first idea of it within a few seconds of opening it). A trained model's stems (from the desktop app) can take over from the split at any point, stretch by stretch as they are made, at their own sample rate, with a six-stem model's guitar and piano painted by hands of their own; wherever they have been heard, the painting is made from them.

**How to read it**

- **Up is frequency.** The scale runs from 32 Hz at the bottom to 16 kHz at the top and is marked down the left edge (50, 100, 200, 500, 1k, 2k, 5k, 10k) in the layouts where height is frequency; the four octaves the notes of a song live in get the biggest steps. In the sweep, the canvas is as wide as the section's bars (numbered along the bottom). For a song from a file, **Across** sets how much of it one crossing of the canvas holds (8, 15 or 30 seconds, or all of it).
- **Every tone holds a brush to the canvas for exactly as long as it sounds.** A staccato note is over before the brush has moved, so it leaves a **dab**; a held note leaves a **stroke** as long as itself; a plucked note that dies away leaves a head and a thinning tail.
- **Colour follows harmony.** The notes of the key share the palette out between them in the order of the circle of fifths, so a chord is a family of neighbouring colours; each part leans to a colour of its own within the palette. For the app's own song the key is the song's; for a song from a file it is heard.
- **Down the right edge in the sweep (the app's own song): what the mix covers,** band by band, coloured by how much of it is chords, melody and drums. The **Hz** button puts the guide away and brings it back.

**How it is painted**

- **It listens to the sound itself:** the whole mix as it leaves the mixer (for the mood, the key and the vibe), and every track through its own fader (so a muted track is not painted), each with an ear of its own. The ears take turns on the audio thread so they never hold up the sound; there are never more than six, and beyond that tracks of one kind share one. For tracks whose notes the app plays, the ear only listens for the texture (how loud, how bright, how noisy), every other hundredth of a second, and the notes themselves come exactly, a little ahead: with seven such tracks the ears take about a tenth of the audio thread's time. A song from a file is heard layer by layer in the background, ahead of playing, so each mark lands with its sound. How much of the canvas is covered is read back from the graphics card without making it wait.
- **The paint is wet.** The painting is simulated on the graphics card, point by point, sixty times a second: paint flows from where it stands deep to where it is shallow, is carried the way the brush pushed it, bleeds into wet paint beside it, and dries from its edges in; as it dries its pigment settles, more in the hollows of the surface than on its ridges. The edge of a wash holds, as water does on dry paper, unless it is so full that it spills: a bloom, or (with **Drips** on) a run down the canvas.
- **Colours mix as pigments do, not as lights.** Blue into yellow goes green, not grey. Only the voice's glaze is laid on as light, which brightens what is under it.
- **A brush is a brush.** Its hairs leave ridges, deeper the drier the paint; it carries only so much and runs dry as it goes. Its tip follows where it is sent the way a real one does, a little late and with a little overshoot, and the hand is never quite steady.
- **The mood of the music sets the manner** (**Paint: Auto**): held, quiet music runs wet and blends; loud, clipped, noisy music goes on thick, dry and loose, with more spatter. **Wash** and **Thick** hold it to one or the other.
- **Old paint** can stay, or sink back into the canvas smoothly as the music goes on (Slow, Medium, Fast), so the newest is the clearest.
- **36 colour schemes** in five families (below), three **surfaces** (canvas, linen, rough paper), **Save picture** (a PNG with the surface in it) and **⤢** to fill the screen.

**What it does not show.** Where a sound is from left to right in the stereo field. Notes less than about a semitone apart low down (below 200 Hz the ear's long look cannot separate them). Which instrument a tone came from, beyond its part. In a song from a file, the parts are only as good as the split (see above). The recorded vocal tracks of the Windows app while they are being recorded (they play through the recording engine, which the canvas cannot hear); once recorded they are painted, and an exported WAV opened here paints everything.

### The colour schemes, and where they come from

| Family | Schemes | Source |
|---|---|---|
| **Paint** | Primaries, Earth, Four tubes, Lily pond, Ink | Published screen approximations of real artists' pigments (cadmium red, yellow ochre, French ultramarine, viridian, burnt sienna, Prussian blue …). *Four tubes* is the classic limited portrait palette of yellow ochre, vermilion, ivory black and white, with three mixtures of them. *Lily pond* was sampled from a painting of a lily pond. *Ink* is sumi in four strengths with a seal red. |
| **Prints** | Woodblock, Wave, Dusk, Kasane, Riso, Blocks, Mid-century, Seventies, Memphis, Deco | *Woodblock*, *Wave* and *Dusk* were sampled from Japanese woodblock prints. *Kasane* is eight traditional Japanese colours (kurenai, yamabuki, moegi, asagi, ruri, ai, fuji, sakura) with sumi on shironeri. *Riso* is seven Risograph inks on warm white paper. *Seventies* uses the named colours of the decade (harvest gold, avocado, burnt orange, rust). *Blocks*, *Mid-century*, *Memphis* and *Deco* have no official colour chart; they are designers' approximations. |
| **Loved** | Goldfish, Coral, Plum, Sherbet, Cocoa, Tidewater, Saffron, Reef, Sundown, Shore | The most-loved palettes of all time on COLOURlovers, by its own ranking (ranks 1, 2, 3, 5, 6, 7, 9 and 11, plus one more from the same top list). *Shore* is quoted from memory and its source was not checked. |
| **Screens** | Solarized, Nord, Gruvbox, Dracula, Catppuccin, Rosé Pine, Tokyo Night, Kanagawa | The colour schemes programmers choose to look at all day, each with its project's own published values. |
| **Glow** | Synthwave, Outrun, Vapor | Schemes made for black: paint glows on these. |

How they are put together follows what working generative artists do: a ground, a line colour, and four to eight paints. In a library of 172 palettes used for generative art, the middle palette has four paints, two thirds of the grounds are light, and almost none are pure white or pure black; the schemes here keep to that (off-white or tinted near-black grounds, never `#fff` or `#000`). Where a source palette has no colour that works as a ground or a line, the nearest neutral is used: sumi black `#1c1c1c` or the off-white shironeri `#fcfaf2`.

**Credits.** The *Loved* palettes were made by members of COLOURlovers and are credited here as that site asks: "Giant Goldfish" by manekineko, "(◕〝◕)" and "(◕ ” ◕)" by sugar!, "Thought Provoking" by Miss_Anthropy, "cheer up emo kid" by electrikmonk, "let them eat cake" by lunalein, "Terra?" by GlueStudio, "Ocean Five" by DESIGNJUNKEE. Some of those palettes are shared for non-commercial use only: fine for a personal app, worth a second look if the app is ever sold. Two top-ranked palettes whose maker asks to be contacted first were left out. *Lily pond*, *Woodblock*, *Wave* and *Dusk* are from the MetBrewer palettes; *Kasane* from the Nippon Colors list; *Riso* from the riso-colors list; the Screens and Glow schemes from their own projects.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open the printed URL (usually http://localhost:5173). To open it on your phone on the same Wi-Fi, run `npm run dev -- --host` and open the "Network" URL.

Other commands:

```bash
npm test          # 485 tests: theory (incl. an audit of every key), voicings, shapes, song structure, copy and paste, melody, library, the mixer, tracks, takes, input levels, harp, styles, effects, saturation, drums, rhythms, MIDI, measuring sounds, the ear, the canvas (its layers, layouts, coverage budget and vibe), splitting a song into layers
npm run build     # production build into dist/
npm run preview   # serve the production build
```

### The Windows app (M-Theory and M-Theory Draft)

The same app, packaged as a Windows program with a native audio engine for the audio interface
(through its ASIO driver). There are two of them, installed side by side:

- **M-Theory Draft** is built from the `draft` branch. Every round of edits lands there, and the Draft app updates itself.
- **M-Theory** is built from the `main` branch. It changes only when the draft is published (the draft is merged into `main`).

Each keeps its own saved ideas, so trying a draft never touches your real work.

Install once from the repository's Releases page: `M-Theory-Draft-setup.exe` (release "Draft", tag `draft-latest`) or
`M-Theory-setup.exe` (the latest release). Windows may say "Windows protected your PC" the first
time, because the installer is not signed with a paid certificate: choose **More info → Run anyway**.
After that the app checks for a new version when it starts (and every half hour), and a bar at the
top offers **Update and restart**. Updates are signed with the project's own key, and the app installs
nothing that is not.

GitHub builds both on its Windows machines (`.github/workflows/desktop.yml`). To build it yourself on
Windows you need Node.js, Rust and LLVM; then:

```bash
npm install
```

```bash
npx tauri build
```

The Settings sheet (⚙) in the desktop app shows the audio interfaces the computer can see, so you can
check that the Scarlett and its ASIO driver are found.

### Put it on your phone (free, installable, offline)

The repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that tests, builds and publishes the app to **GitHub Pages** on every push to `main`:

1. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Merge to `main` (or run the workflow manually from the **Actions** tab).
3. Open `https://<your-username>.github.io/M-Theory-App/` on your phone and choose **Add to Home Screen**. It then works like an app, offline too.

---

## How it works (for the curious)

```
src/
  theory/        Pure music theory, no UI (fully unit-tested)
    notes.ts       pitch classes + letter-aware spelling (A♯ vs B♭)
    intervals.ts   interval tokens ("b3", "#11", "bb7") → semitones & names
    chords.ts      56 chord types, building, identification ("what chord is this?")
    scales.ts      36 scales/modes with moods, signature notes, brightness
    keys.ts        diatonic harmony, roles, every chord in a key, borrowed & chromatic chords
    progression.ts suggestion engine, Spark generator, substitutions, colourizing
  song/
    structure.ts   the sections of a song: letters by playing order, names, colours; the song's settings, and what each section has of its own
    melody.ts      the melody grid: notes in twelfths of a beat, rows in the key, playback and bars
    library.ts     saving ideas, what counts as a change, merging the library between devices
  guitar/
    voicings.ts    the voicing generator: search, fingering/barre detection, difficulty, tags
    shapes.ts      the shape book: textbook open chords, playability rules, shape families
    shapeMap.ts    areas of the neck
    arrange.ts     easy default shapes, voice-leading optimizer (dynamic programming), capo finder
    tunings.ts
  audio/
    harp.ts        the harp: every note built from its partials (pluck point, finger, string, soundboard)
    saturation.ts  six colours of saturation (tape, tube, console, crunch, fuzz, clip), shared by the drums and the harp
    rack.ts        the harp's effects chain, with loudness-compensated knobs
    sounds.ts      the ready-made harp sounds
    styles.ts      the library of 136 playing styles, written as strum and picking patterns
    patterns.ts    the style engine: turns a style and a chord into notes, bar by bar (shared by playback and MIDI export)
    synth.ts       the live harp voices + look-ahead player for chords and drums
    voices.ts      the sound library: ~105 drum recipes for one general drum synthesizer
    drums.ts       the 8 machine voices, rendering (round-robin takes, sampler grit, loudness), reverbs, noise beds
    drumbus.ts     the live mixing desk: per-drum level, pan and sends, then grit, tape, tone, glue, pump
    rhythms.ts     the rhythm library: 286 rhythms in fifteen styles, in shorthand
    beats.ts       step-grid format (multi-bar), swing, variation, vibes, kits
    midi.ts        Standard MIDI File writer
  ui/            React app: the guitar page, shape finder, tray, drag & drop
```

- **The shape book** keeps about one in six of the generated voicings. A shape has to be holdable (stretch, finger order, muted strings) and it is then filed under the families guitar teaching uses: open chords, the two barre shapes, triads on neighbouring strings, four-string shapes and shell voicings. Default shapes, Arrange and the ‹ › steppers only ever use these.
- **Voicings** are found by scanning 4-fret windows up the neck (plus open strings), trying every combination of chord tones per string, then keeping only shapes with all required tones, at most one muted string in the middle, and a feasible fingering. Each is scored for difficulty (fingers, barres, stretch, mutes) and usefulness (root position, fullness, low-end mud).
- **Suggestions** score every candidate chord by root motion (falling 5ths, steps, 3rds, chromatic slides), shared notes, voice-leading distance and resolution of tension, then group them by character.
- **Progression voicings** use dynamic programming to minimise total difficulty plus hand movement and top-note jumps across the whole progression.

- **The harp** is not a recording. Each note is a sum of fading sine waves, one per overtone, shaped by what acoustics research says makes a harp sound like a harp: harpists pluck a third to two fifths of the way along the string, which removes whole families of overtones (pluck the exact middle and only the odd ones are left); the soft finger pad rounds the attack; gut and nylon lose their high overtones quickly (a quality factor near 1000 that falls above 2–3 kHz), so the tail is pure; nothing damps the string; each overtone swings two ways at slightly different pitches, which gives the slow shimmer of a real string; a concert harp's soundboard radiates most around 148, 166, 228 and 335 Hz and little below, and answers each pluck with a soft knock; and the other strings hum along. A harder pluck is brighter as well as louder. Notes are in tune to within a few cents and all equally loud.
- **Sections and settings.** A song stores one set of settings (style and feel, the chord harp, the melody harp, the drum rhythm, the drum kit) and, for each section, only its chords, its melody and whichever of those five it has changed. The first section edits the song's set directly. Nothing is flagged by hand: a section "has its own" exactly when what it is set to differs from the song's, so turning a knob back makes it follow again. The section that plays first is always the one that leads: when another one comes to the front (moved there, or the first one removed), every section's sound is worked out first, the new first one's settings become the song's, and each other section keeps as its own exactly what now differs, so nothing changes its sound. The song's drum rhythm is kept in the first section's bars; a section in another time signature plays it fitted to its own bars at the moment it plays, and that fitted copy is never written back, so going round between signatures loses nothing. Letters are never stored: they are worked out from the playing order each time.
- **Two harps.** The chords and the melody each have their own instrument and their own effects chain, running side by side into the output; both dip under the kick when the drums' Pump is up. When the whole song plays, each note is made with the sound of its own section, so a section change is clean even though notes are scheduled a quarter of a second ahead.
- **Theory audit.** A test walks every scale in all twelve keys and checks three things: every chord the app offers on a note uses only notes of the scale; every one of the 56 chord types that does fit is offered; and each chord tone is spelled with the scale's own note name (in C major the ♭5 of F is B, not C♭: an error this audit found and fixed). The chords of major, natural, harmonic and melodic minor are compared with the textbook lists, and every degree of the seven modes has a named triad, seventh and ninth chord.
- **The instruments** share one engine. A plucked string is a sum of fading overtones shaped by where it is plucked, what plucks it, the string's material and the body it sits on; each of the 18 string instruments is a set of those numbers (a banjo's drum skin makes it short and twangy; a dulcimer and a mandolin have two strings to a note, a few cents apart; the bray harp's buzz is a slow thinning-out of overtones; harmonics sound an octave up and almost pure). The four bells are bars, whose overtones are not whole multiples of the note.
- **Playing styles** are written the way teachers write them: one symbol per step of the bar (D down, U up, X muted, p-i-m-a for the picking fingers, and so on). Down-strums cross the strings in 20 to 35 ms, low string loudest; up-strums catch only the top four and are softer; muted strums are cut after 45 ms; a rolled harp chord climbs more slowly and swells to the top. The same notes go to the MIDI file.
- **The harp's effects** are wired like a pedalboard: compressor, saturation, tone, phaser, tape wobble, chorus, tremolo, then echo and reverb. The chorus is two delayed copies drifting opposite ways, one in each speaker; the phaser is four all-pass stages swept between about 360 Hz and 2 kHz; the echo's repeats bounce from side to side and get duller each time; the reverb starts 18 ms late so the pluck stays clear. Shimmer is done without a pitch shifter: an octave-up copy of each string swells in and is sent only to the reverb. Every knob is loudness-compensated from measurements of the finished output.

- **Saturation** (drums and harp) is the bend analogue gear puts in a signal when it is pushed, plus the tone shaping the real machine does around that bend. Each colour was tuned by measuring its overtones on a test note:
  - *Tape* follows the magnetisation curve of tape (a Langevin function), which adds almost only the third overtone. Treble is boosted going in and cut coming out, so the highs saturate first and come out smoother, and the lows get a small lift like a tape head's.
  - *Tube* is a valve biased off-centre: one half of the wave rounds off sooner, which makes the second overtone, an octave above the note. It stays more than 10 dB above the others up to three quarters of the knob; at full the odd overtones overtake it and it gets an edge.
  - *Console* is a pure cubic bend with the bass boosted going in and cut coming out, as transformer iron saturates on low notes first: at half, a 60 Hz note has about three times the distortion of a 1 kHz one.
  - *Crunch* and *Fuzz* pass the bass round the bend and distort only what is above it, the way a bass-preserving overdrive does. *Clip* is a straight line with a knee near the top: ordinary hits pass untouched, peaks are shaved.
  - On every colour the overtones grow as they do on the real thing: about 1 to 2% at a quarter turn (colour you feel more than hear), 3 to 6% at half, well into distortion at full.
  - The bend runs four times oversampled so it does not alias, which in a browser delays it by about 4 ms. The clean path and the bass path go through the same stage unbent, so the three stay exactly in step and Blend never sounds hollow. The harp's chords always send their lowest notes round the bend, so they stay clear instead of turning to mud.
  - Each colour's loudness was measured on drum loops and on strummed chords at every quarter of the knob and is taken back out: turning it up changes the tone, not the volume.

- **Drum sounds** come from one general drum synthesizer, built from how the classic machines and the best drum synths work (circuit studies of the TR-808, the Mutable Instruments Plaits source, Perry Cook's PhISEM shaker models, Sound On Sound's "Synth Secrets"). Each sound is a short recipe of layers: oscillators with a fast pitch drop and a slow sag; a pulse ringing a resonant filter (the 808's bridged-T way); several drum-head modes at the ratios of a real membrane; a bank of square waves through band-pass filters for hats, cymbals and cowbell; noise that is white, pink or clocked, with clap bursts, gated tails and snare wires that follow the head; beads and jingles colliding for shakers and tambourines; and dozens of decaying partials for cymbals and bells. Each sound is rendered in three slightly different takes that are played in turn, and every sound is brought to the same loudness (over 40 ms, 300 ms and, for kicks, a second), so swapping one never upsets the mix.
- **Drum effects** are a small mixing desk of Web Audio nodes: each drum has its own level, pan, and reverb and echo sends; the kit then passes through the saturation above, a tape stage (a short delay whose length drifts), tone, a compressor and a soft ceiling that adds no delay. The reverbs are generated stereo impulse responses (a spring is an impulse sent round a loop of 60 all-pass filters; the gated room is a flat burst that stops dead). The sampler modes hold samples at a lower rate without filtering and quantise them, as the old sampling drum machines did. The noise beds (vinyl crackle, tape hiss, room tone, hum) are rendered once as seamless loops. Saturation, compression and tone are loudness-compensated from measurements of the finished output. The drum grid re-locks to every chord change, so the beat and the chords cannot drift apart.

Everything runs locally in your browser. Your ideas are saved in the browser's local storage. When the app is opened as a claude.ai artifact, each saved idea is also written to your private area of the artifact's database, so the same library shows up on your other devices.

### Where the harp, the styles and the effects come from

The numbers and patterns were collected from published acoustics research, teaching material and audio-engineering references. The session that gathered them could read search-result excerpts of these pages, not always the full text, so treat the list as where to look rather than as a guarantee that every figure was checked against the original.

- Harp acoustics: Chadefaux, Le Carrou et al., *Experimentally based description of harp plucking* (JASA 2012); Le Carrou, Gautier et al. on the concert harp's soundboard and sound-hole modes and on sympathetic strings; Woodhouse, *Euphonics* (string damping, plucked-string synthesis); Waltham's harp chapters and ASA papers; UNSW Music Acoustics (harp); the Vienna Symphonic Library's harp notes; Sound On Sound, *Synthesizing plucked strings*.
- Playing styles: Wikipedia (Strum, Carter Family picking, Tresillo, Clave, Ska stroke, Banjo roll); guitar lesson sites (rhythmguitar.org, justinguitar, andyguitar, Fender, MusicRadar, Guitar World, Premier Guitar, Classical Guitar Magazine, jazzguitar.be); the Giuliani right-hand studies; harp accompaniment guides (myharpsdelight.com, harpmastery, Harp Column).
- Effects: J. O. Smith, *Physical Audio Signal Processing* (flanging and phasing); Valhalla DSP's notes on reverb types, shimmer and echo; Sound On Sound technique articles; the Web Audio API documentation (MDN); circuit analyses of classic overdrive, chorus and phaser pedals.

### Where the canvas's colours come from

Hex values were read from each project's own files where the session could reach them (the first list), and from search-result excerpts of the pages otherwise (the second). Pigments have no single correct screen colour: the values used are the commonly published approximations.

Read directly:

- [nice-color-palettes](https://raw.githubusercontent.com/Jam3/nice-color-palettes/master/100.json): the top-loved COLOURlovers palettes
- [MetBrewer](https://raw.githubusercontent.com/BlakeRMills/MetBrewer/main/R/PaletteCode.R): palettes sampled from works in a museum collection
- [nippon-colors](https://registry.npmjs.org/nippon-colors/-/nippon-colors-1.0.0.tgz): 250 traditional Japanese colours
- [riso-colors](https://raw.githubusercontent.com/mattdesl/riso-colors/master/riso-colors.json): Risograph inks
- [color-names](https://raw.githubusercontent.com/codebrainz/color-names/master/output/colors.csv): the named colours (pigments, harvest gold, avocado …)
- [chromotome](https://raw.githubusercontent.com/kgolid/chromotome/master/readme.md): how palettes for generative art are built
- [Nord](https://raw.githubusercontent.com/nordtheme/nord/develop/src/nord.css), [Solarized](https://raw.githubusercontent.com/altercation/solarized/master/README.md), [Dracula](https://raw.githubusercontent.com/dracula/dracula-theme/master/README.md), [Gruvbox](https://raw.githubusercontent.com/morhetz/gruvbox/master/colors/gruvbox.vim), [Catppuccin](https://raw.githubusercontent.com/catppuccin/palette/main/palette.json), [Rosé Pine](https://raw.githubusercontent.com/rose-pine/palette/main/palette.json), [Tokyo Night](https://raw.githubusercontent.com/folke/tokyonight.nvim/main/lua/tokyonight/colors/storm.lua), [Kanagawa](https://raw.githubusercontent.com/rebelot/kanagawa.nvim/master/lua/kanagawa/colors.lua)
- [SynthWave '84](https://raw.githubusercontent.com/robb0wen/synthwave-vscode/master/themes/synthwave-color-theme.json), [Outrun](https://raw.githubusercontent.com/tinted-theming/schemes/spec-0.11/base16/outrun-dark.yaml)

Seen as search excerpts only:

- [COLOURlovers, most loved of all time](https://www.colourlovers.com/palettes) and its palette pages (ranks, love counts, makers)
- [Winsor & Newton oil colours as screen colours](https://color-term.com/winsornewton-colors) (a third party's conversion, not the maker's)
- [The four-colour portrait palette](https://www.naturalpigments.com/zorn-palette.html)
- [Vaporwave palette](https://www.color-hex.com/color-palette/10221)
- [Bauhaus](https://digitalheroes.co.in/styles/bauhaus-revival/), [Art Deco](https://www.eggradients.com/palette/art-deco), [mid-century](https://madegooddesigns.com/retro-color-palettes/) and [Memphis](https://newretro.net/blogs/main/80s-color-palette-hex-codes) approximations
- [Working with color in generative art](https://www.tylerxhobbs.com/words/working-with-color-in-generative-art)

The research behind the paint and the listening (open-source brush engines, wet-paint simulations, pigment mixing, live audio analysis, and what is and is not known about matching sound to picture) is in `reports/Realistic paint and sound painting.md`, with every source and licence; credits are in `NOTICE.md`.

### Where the canvas's way of turning sound into paint comes from

What it rests on, and how sure each part is:

- **Well supported by research:** higher pitch is seen as higher up, smaller and lighter; louder as bigger and heavier; harsh, rough or bright sounds as broken, angular marks; and the mood of a whole piece as colour.
- **Choices of this app, with no study behind them:** a staccato note as a dab and a held one as a stroke (it follows from holding the brush down exactly as long as the tone lasts), noise as spatter, and calm music as wet paint.
- **From open-source code** (see `NOTICE.md`): how a brush tip lags and overshoots, how touches overlap along a stroke, how spatter sizes are spread, how a brush runs dry, how wet paint is damped until it stops, and how pigments mix.
- **The layers, the layouts, the budget and the vibe** follow `research_notes/Synths harmony stems and vibe painting/vibe_painting.md` and `stems.md`. The measures of a song's vibe (timbre, harmony, rhythm, dynamics) are those music-similarity research uses; turning them into a painting smoothly, so that similar music looks similar, and the paint each part is given, are this app's own design, as are the coverage figures (a fifth for two quiet parts, two thirds for six loud ones). Splitting a file into layers uses published signal-processing methods (median-filter harmonic/percussive separation, and REPET-SIM for the voice), not a trained model; a model's stems (from the desktop app, later) can take their place. Marks are laid a hundredth of a second or so before their sound: broadcast practice finds pictures that lead the sound far easier to accept than pictures that lag it.

The full research, with every source read and its licence, is `reports/Realistic paint and sound painting.md`.
