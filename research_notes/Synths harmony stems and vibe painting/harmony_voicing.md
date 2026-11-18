# Auto-harmonizing tracks, chord layering, piano voicing and keyboard display (research notes, 18 Nov 2026)

Markers: [SRC] = read from the source file or page; [CALC] = worked out or measured by me (scripts in the session scratchpad); [SEC] = secondary source or search-engine summary (page not opened).
Licence tags: PORT = code may be ported into M-Theory (GPL-3.0-or-later) if its notice is kept; REF = use as formula or idea reference only and re-implement from scratch.
Network in this sandbox: raw.githubusercontent.com and registry.npmjs.org worked. api.github.com, github.com HTML pages and gist.githubusercontent.com returned 403. wikipedia.org, viva.pressbooks.pub (Open Music Theory v2), sweetwater.com, harmonious.nfshost.com and cdn.eventideaudio.com failed DNS. Facts from those hosts are [SEC] only.
Naming rule followed: no musicians, bands, songs or labels are named. Style presets that carry composers' names in the source are described by period instead ("Renaissance-strict", "Baroque-chorale"). A scale named after a person is described as the "6th-diminished 8-note scale".

## 1. Melody harmony: a new melody track that harmonizes an existing melody (or the chords)

### Takeaway
The standard engine is diatonic-interval harmony: move each note a fixed number of scale steps (3rd or 6th, above or below). On strong beats, check the result against the chord underneath and switch to the other interval or the nearest chord tone when it clashes. A counter-melody mode can be built directly from species-counterpoint rules. An MIT-licensed Rust/Tauri/WASM engine (Contrapunk) already implements the fallback ladder, a contrary-motion mode and a counterpoint mode that can be ported.

### Cited Findings
- [SEC] Hardware "intelligent" or diatonic harmonizers: the user picks a key, a scale or mode (major, minor, church modes, harmonic minor) and an interval (typically from a 2nd up to an octave, above or below). Each note is moved to the scale note that many steps away, so a "3rd above" is 3 or 4 semitones depending on the scale degree, whereas a chromatic shift is always the same number of semitones. Pitch tracking is monophonic. — [Lexicon MPX G2 manual](https://www.manualsdir.com/manuals/167187/lexicon-mpx-g2.html?page=101); [Korg Pa800 Scale mode](https://www.manualslib.com/manual/523477/Korg-Pa800.html?page=245); [Rocktron Intellipitch Key/Mode](https://www.manualsdir.com/manuals/741256/rocktron-intellipitch.html?page=25); [DigiTech RP155 Harmony](https://www.manualslib.com/manual/380812/Digitech-Rp155.html?page=39); [Eventide H90 pitch algorithms](https://cdn.eventideaudio.com/manuals/h90/1.5.2/content/algorithms/pitch.html)
- [SRC] Contrapunk, an in-scale note: `transpose_diatonic(note, +2 degrees)` gives the diatonic 3rd (D4 in C major gives F4, 5 semitones). — [ENGINE_DEEP_DIVE.md](https://github.com/contrapunk-audio/contrapunk/blob/main/docs/ENGINE_DEEP_DIVE.md)
- [SRC] Contrapunk, an out-of-key note, as a 3-level fallback:
  - (1) Modal interchange: search parallel modes that contain the note, widening the "borrowing range" step by step (Range 1 Aeolian and HarmonicMinor; Range 2 adds Dorian and MelodicMinor; Range 3 adds Mixolydian and Phrygian; Range 4 adds Lydian and PhrygianDominant; Range 5 is all 11 modes), then take that mode's diatonic 3rd.
  - (2) Chromatic consonance: try intervals above in the order [4,3,9,8,7,5] semitones (M3, m3, M6, m6, P5, P4), or below in the order [-3,-4,-8,-9,-5,-7]. The first pass prefers a result that is a scale tone; the second pass takes the first consonant interval.
  - (3) Otherwise, return the original note.
  — [same file](https://github.com/contrapunk-audio/contrapunk/blob/main/docs/ENGINE_DEEP_DIVE.md)
- [SRC] Contrapunk modes:
  - PassThrough.
  - DiatonicThirds (+2 degrees).
  - DiatonicFourths (+3 degrees).
  - ContraryMotion, which keeps state: if the melody moves up, the harmony uses −2 degrees; if it moves down, +2; if it repeats, the preferred interval is used.
  - StrictCounterpoint keeps a 3-note history. After a leap of more than 2 semitones the harmony steps or leaps the opposite way. It avoids the same interval 3 times in a row and avoids an all-rising or all-falling contour. It scores interval variety, recovery after a leap, opposite direction and smoothness.
  - The 6th-diminished 8-note scale used with DiatonicThirds keeps chord tones on even degrees and passing tones on odd degrees.
  — [same file](https://github.com/contrapunk-audio/contrapunk/blob/main/docs/ENGINE_DEEP_DIVE.md)
- [SRC] Contrapunk OctaveMode options:
  - None.
  - Spread: harmony voice k is raised k octaves.
  - BassTrebleSplit: harmonies below the melody go down an octave, those above go up an octave.
  - Mirror: each harmony note is also doubled ±1 octave, so E4 becomes E3, E4, E5.
  This is the "octave doubling" option. — [same file](https://github.com/contrapunk-audio/contrapunk/blob/main/docs/ENGINE_DEEP_DIVE.md)
- [SRC] First-species rules (Open Music Theory v1, CC BY-SA 4.0):
  - A counterpoint above starts on a P1, P5 or P8; one below must start on do.
  - It ends on do, approached by contrary stepwise motion, so the penultimate interval is an m3 or M6.
  - The two lines' climaxes must not coincide. No voice crossing or overlap.
  - The voices stay at most a P12 apart; prefer within an octave and exceed a 10th only briefly.
  - Unisons only at the start and end. Prefer imperfect consonances in the middle.
  - Never P5–P5 or P8–P8 in a row, including compound intervals (P5–P12 counts).
  - "Do not use more than three of the same imperfect consonance type in a row."
  - Never move into a perfect consonance by similar motion. Avoid similar motion combined with leaps. Prefer contrary motion.
  — [firstSpecies.md](https://github.com/openmusictheory/openmusictheory.github.io/blob/master/firstSpecies.md)
- [SRC] Second species (2 notes against 1):
  - Strong beats are always consonant.
  - A dissonance on a weak beat is allowed only as a passing tone filling a third between two consonant downbeats by step. Never leap into or out of it, and never change direction on it.
  - Hidden 5ths and 8ves between successive downbeats are acceptable. Unisons are OK on weak beats.
  - Leap from strong to weak beat inside a bar rather than across the barline.
  — [secondSpecies.md](https://github.com/openmusictheory/openmusictheory.github.io/blob/master/secondSpecies.md)
- [SRC] Fourth species (suspensions):
  - A consonant weak-beat preparation is tied into a dissonant strong beat, which resolves down by step.
  - Allowed above: 7–6, 4–3, 9–8. Allowed below: 2–3, 5–6, 4–5.
  - Do not chain 9–8 or 4–5 suspensions, and avoid 5ths or 8ves on consecutive weak beats ("after-beat").
  — [fourthSpecies.md](https://github.com/openmusictheory/openmusictheory.github.io/blob/master/fourthSpecies.md)
- [SRC] Melodic line rules:
  - Range of at most a 10th, usually less than an octave. A single climax. Mostly steps.
  - "Any large leaps (fourth or larger) are followed by step in opposite direction."
  - "No more than two leaps in a row; no consecutive leaps in the same direction."
  - The leading tone goes to the tonic.
  - It also lists general melodic tendencies: pitch proximity, step declination, step inertia, melodic regression, melodic arch.
  — [cantusFirmus.md](https://github.com/openmusictheory/openmusictheory.github.io/blob/master/cantusFirmus.md)
- [SRC] music21 `VoiceLeadingQuartet`:
  - Motion types: oblique (one voice holds), parallel (similar motion keeping the same generic interval), similar, contrary.
  - Anti-parallel motion (e.g. a 5th becoming a 12th by contrary motion) counts as a parallel fifth.
  - A hidden interval means arriving at it by similar, non-parallel motion.
  - `leapNotSetWithStep`: a skip must be preceded or followed by a step or a unison (except two 3rds in contrary motion).
  — [voiceLeading.py](https://github.com/cuthbertLab/music21/blob/master/music21/voiceLeading.py)
- [SRC] harmony-ts `voiceJumpStepsOpposite`: after a leap larger than a 3rd, the next motion must be a step in the opposite direction. `invalidIntervals` bans a melodic A2 or d7 and any leap over 7 semitones, except a bass dropping a perfect octave. — harmony-ts 0.14.6 `dist/part-writing/part-writing.js` (npm tarball, [registry](https://registry.npmjs.org/harmony-ts))
- [SEC] Band-in-a-Box stores melody-harmony settings per song and per "Melodist". One preference lets harmony notes change so they stay correct when the underlying chord changes. The exact names of the harmony types were not confirmed. — [PG Music manual ch. 9](https://www.pgmusic.com/manuals/bbw2026full/chapter9.htm)

### Inferences
- [CALC] **Algorithm "3rd/6th that fits the chord".** Inputs: the melody notes (pitch, start, length), the key scale S, and the chord pitch-class set C(t) from the chords track. Without a chords track, use the diatonic triad whose root best covers the strong-beat melody notes.
  1. Candidate h = diatonic transpose of the note n by k steps: k = +2 (3rd above), −2 (3rd below), −5 (6th below, the 3rd above dropped an octave) or +5 (6th above).
  2. Strong-note test: the note is on beat 1 or 3 in 4/4, or on beat 1 in 3/4, or lasts at least 1 beat. The harmony must then be a chord tone of C(t), or a consonant interval with n (3, 4, 8 or 9 semitones mod 12; 0, 5 and 7 allowed but penalised), and not an avoid note (section 2).
  3. If it fails, try in order: the same interval class in the other register (3rd above to 6th below); the other 3rd (above or below); the nearest chord tone on the same side of n; then holding the previous harmony note (oblique motion).
  4. Weak or short notes (under half a beat) accept the parallel result even when it clashes with the chord, as long as the harmony moves by step. This is the passing-tone rule of second species.
  5. Reject a candidate that makes P5→P5 or P8→P8 with the previous pair while both voices move. That is the same test as Contrapunk's (interval class (|a−b| mod 12) == 7 before and after, both voices moved).
  6. Keep the harmony on its side of the melody (no crossing) and within the instrument range. If it would leave the range, flip between a 3rd above and a 6th below.
  Worked example in C major over a C chord: melody E–F–G with a 3rd above gives G–A–B. B on a strong beat is not in C–E–G, so step 3 switches to a 3rd below, E. Result: G–A–E.
- [CALC] **"Stick to the chord" (chord-tone harmony).** The harmony is the nearest chord tone strictly below n with a different pitch class. If n is a non-chord tone, use rule 1's diatonic 3rd below. Over C major: C→G below, E→C, G→E. This always gives a 3rd, 4th or 6th and never clashes on strong beats. Mirror it for "above".
- [CALC] **Counter-melody.** Build a slower line (one note per chord or per half bar):
  - Chord tones on strong beats, preferring the 3rd and 7th (the required notes in section 4).
  - Stepwise passing tones between them.
  - Choose candidates by first-species rules: prefer contrary or oblique motion against the source melody, at most 3 identical imperfect intervals in a row, no parallel or hidden perfect intervals into strong beats, after a leap of 5 semitones or more step back the opposite way, and climax away from the source melody's climax.
  - Contrapunk's StrictCounterpoint scoring is a portable reference.
- [CALC] **Call-and-response.** Find gaps in the source melody (a rest of at least 1 beat, or the end of a 2- or 4-bar phrase). Fill only the gaps, either with the last motif moved by a diatonic step (a sequence) or with an arpeggio of the current chord. While the source sounds, stay silent or hold one long note.
- [CALC] **Pedal or drone.** Hold the tonic (or the 5th) for the whole section. A tonic pedal in C major is a chord tone of C, F, Am and Dm7, and clashes with G, Em and Bdim. Offer the 5th (G) when the progression is mostly I–V. The listening convention that a pedal may clash is not sourced here (see Gaps).
- [CALC] **Octave doubling.** Copy the melody ±12 semitones. Skip it if the copy leaves the instrument range, following Contrapunk's Mirror and Spread logic.

### Gaps
- No fetched primary source describes the pedal-point "tolerated dissonance" convention or call-and-response technique (Wikipedia blocked). Both algorithms above are my inference.
- Vendor descriptions of melody-harmony modes in Logic, Captain Chords and Band-in-a-Box were not readable (vendor hosts blocked). Searches found no confirmed list of Band-in-a-Box harmony type names, and nothing on Captain Chords' melody harmony.

## 2. Chord harmony: a second chords track that layers with or re-harmonizes an existing progression

### Takeaway
A second chord layer should keep the same chord symbols but change register, voicing and colour. Colour tones come from a mechanical "available tension" rule: no minor 9th above a chord tone, and the tension must be in the key for a diatonic layer. Reharmonization options (relative substitution, secondary dominants, modal mixture, passing diminished, tritone substitution, pedal) each come with a simple applicability test against the melody note on the strong beat.

### Cited Findings
- [SRC] jazzband `getAvailableTensions` (ISC licence):
  - Dominant chords: start from [b9, 9, #9, 3, 11, #11, b13, 13, 7], drop chord tones, drop any tension 1 semitone above the 3rd (the natural 11), any 1 semitone above the 4th in sus chords, and any 1 semitone above the b7.
  - Other chords: the tensions are "a major second above a chord note", skipping notes under 3 semitones from the root and any result that would be a b7 below the root.
  — [Voicing.ts](https://github.com/felixroos/jazzband/blob/master/src/harmony/Voicing.ts)
- [SEC] Avoid notes: over a major (Ionian) chord the natural 11 is the avoid note, because it is a minor 9th above the 3rd and makes the chord sound like a suspension or a dominant. Available tensions on Ionian are 9 and 13; #11 is the Lydian colour. A natural 11 on a major chord is accepted when the 3rd is left out. One search summary said the natural 11 is "available" on dominant 7 chords. That conflicts with the minor-9th rule and with jazzband's code above, so treat it as unreliable. — [Avoid note](https://en.wikipedia.com/wiki/Avoid_note); [harmonious glossary](https://harmonious.nfshost.com/p/05/Extensions-Avoid-Notes); [jazz piano site](https://www.thejazzpianosite.com/?p=435)
- [SRC] Rootless left-hand voicings, read as data from tonal.js (MIT). A = built from the 3rd, B = built from the 7th:
  - m7: A "3m 5P 7m 9M", B "7m 9M 10m 12P"
  - 7: A "3M 6M 7m 9M", B "7m 9M 10M 13M"
  - maj7: A "3M 5P 7M 9M", B "7M 9M 10M 12P"
  - 69: "3M 5P 6A 9M"
  - m7b5: A "3m 5d 7m 8P", B "7m 8P 10m 12d"
  - 7b9 and 7b13: A "3M 6m 7m 9m", B "7m 9m 10M 13m"
  - o7: A "1P 3m 5d 6M", B "5d 6M 8P 10m"
  - 7#11: "7m 9M 11A 13A"
  - 7#9: "3M 7m 9A"
  - mM7: A "3m 5P 7M 9M", B "7M 9M 10m 12P"
  - m6: A "3m 5P 6M 9M", B "6M 9M 10m 12P"
  - Triads: root position, 1st inversion, 2nd inversion.
  — [voicing-dictionary/data.ts](https://github.com/tonaljs/tonal/blob/main/packages/voicing-dictionary/data.ts)
- [SRC] Impro-Visor automatic voicing gives "colour" (extension) notes their own priority in each hand, `leftColorPriority` and `rightColorPriority` (both 0 by default, so extensions are off unless raised), separate from the chord-tone priority array. It also has `rootless` and `invertM9`. The latter turns a minor-9th-apart pair (13 semitones) into a major 7th. — [AutomaticVoicingSettings.java](https://github.com/Impro-Visor/Impro-Visor/blob/master/src/imp/voicing/AutomaticVoicingSettings.java); [VoicingGenerator.java](https://github.com/Impro-Visor/Impro-Visor/blob/master/src/imp/voicing/VoicingGenerator.java)
- [SRC] Applied chords (secondary dominants), from Open Music Theory:
  - "Any diatonic triad can take an applied chord", meaning any major or minor triad of the key, tonicized by its own V or vii°.
  - The applied chord is an altered form of the function that precedes the target: altered T leads to S, altered S to D, altered D to T. Example: F#dim–G–C in C is viio/V.
  - Chromatic degrees per target are listed. For example, D/V uses fi, la, do, re, me; D/IV uses mi, sol, te, do, ra.
  — [appliedChords.md](https://github.com/openmusictheory/openmusictheory.github.io/blob/master/appliedChords.md)
- [SRC] Modal mixture: chords from the parallel key, without a cadence in the new key. Altered roots get a flat or sharp prefix (le–do–me in major is bVI). A Picardy third is a major I ending a minor piece. — [modalMixture.md](https://github.com/openmusictheory/openmusictheory.github.io/blob/master/modalMixture.md)
- [SRC] Pop and rock chords "are almost always root-position triads or seventh chords". The usual chord for each bass degree: do I, re II, mi/me [III] or I6, fa IV, sol V, la/le VI or [IV6], te VII, ti V6. — [popRockHarmony.md](https://github.com/openmusictheory/openmusictheory.github.io/blob/master/popRockHarmony.md)
- [SEC] Upper-structure triads over a dominant 7th: a left-hand shell plus a right-hand major triad on II, bIII, bV, bVI or VI. Pianists exclude triads that contain avoid notes. — [upper-structure triad PDF](https://www.ejazzlines.com/wp-files/2/shhtvs.pdf)
- [SEC] Logic Pro Session Player (Keyboard):
  - Left Hand and Right Hand range sliders.
  - Left-hand options include Root Only, Root & Octave, Root & Fifth and Steady 8ths.
  - A Right-Hand Voicing menu "influences the voicing number, common tones, and chord extensions". Synth styles add "1 Voice".
  - The player follows region chords, else the Chord track, else the key's tonic chord.
  — [Apple Logic Pro for iPad guide](https://support.apple.com/guide/logicpro-ipad/lpip5e3e59c4/ipados); [Sound On Sound](https://www.soundonsound.com/techniques/logic-pro-session-players)
- [SEC] Scaler 3: "Voice Grouping" with drop voicings, guitar voicings and range-based shaping, applied per clip or per note; automatic voice leading across selected chords; "Divisi" splits upper and lower chord voices onto separate instruments; "Keys Lock" constrains melodies and basslines to scale and chord. — [Scaler 3 product page](https://www.scalermusic.com/products/scaler-3); [Sound On Sound news](https://www.soundonsound.com/news/scaler-music-introduce-scaler-3)
- [SRC] M-Theory already has `borrowedChords(key)`, `spiceChords(key)` and a pitch-class `voiceLeadingDistance` in `src/theory/progression.ts`, which can feed the reharmonization menu.

### Inferences
- [CALC] **Avoid-note rule, coded.** A tension t is unavailable over chord C if (t − c) mod 12 == 1 for the chord's 3rd or 7th, or for its root or 5th. The b9 on a dominant is exempt when the user picks "altered". For a diatonic layer, t must also be in the key scale. Applied to C major diatonic 7th chords:
  - I maj7: 9, 13 (F avoid)
  - ii m7: 9, 11, 13 (13 is often avoided in practice because of the tritone with the 3rd)
  - iii m7: 11 only (F = b9 and C = b13 avoid)
  - IV maj7: 9, #11, 13
  - V 7: 9, 13 (C avoid; use sus4 instead)
  - vi m7: 9, 11 (F = b13 avoid)
  - vii m7b5: 11, b13 (C = b9 avoid)
- [CALC] **Diatonic sus chords in C major.** sus2 exists on C, D, F, G, A (not E or B). sus4 exists on C, D, E, G, A (not F or B). This is the rule for offering "sus2/sus4" on each chord.
- [CALC] **Add9 / 6 / 7 colour by chord.** I: add9, 6, 6/9, maj7. IV: add9, 6, maj7, maj7#11. V: 7, 9, 13, sus4. ii: m7, m9, m11, m6 (B is in the key). vi: m7, m9, m11 (Am6 needs F#, so it is not offered in a diatonic layer). iii: m7, m7(11). Only offer an extension if it passes the avoid rule and, on a strong beat, is not a semitone away from the current melody note (no minor 9th or minor 2nd against the melody).
- [CALC] **Upper-structure triads on C7**, by the tensions they add:
  - II (D F# A) = 9, #11, 13
  - bIII (Eb G Bb) = #9, 5, b7
  - bV (Gb Bb Db) = b5/#11, b7, b9
  - bVI (Ab C Eb) = b13, root, #9
  - VI (A C# E) = 13, b9, 3
  Only II is "safe" (natural tensions). The others are altered colours, fitting before a minor-key I or for a dark feel.
- [CALC] **Reharmonization options and their tests.** All use the melody note m on the chord's strong beat:
  - Relative swap (I↔vi, I↔iii, IV↔ii, V↔vii°, V↔iii): these pairs share 2 of 3 notes. Allow it if m is a chord tone or an available tension of the new chord.
  - Secondary dominant: insert V7/X before a target X ∈ {ii, iii, IV, V, vi}, which in C gives A7, B7, C7, D7, E7. It takes half of the preceding chord's length. Allow it if m is in the V7/X chord or is its 9 or 13, and if the preceding chord lasts at least 2 beats.
  - Passing diminished: insert vii°7/X a semitone below the target root, e.g. C – C#°7 – Dm7. This is the applied vii° of the OMT rule. Allow it when the bass would move up by step anyway (I→ii, ii→iii, IV→V).
  - Tritone substitution: replace V7/X with the dominant 7th a tritone away. G7 (guide tones B and F) and Db7 (guide tones F and Cb = B) share the same tritone. Melody notes from G7 take these roles over Db7: B → b7, F → 3, G → #11, D → b9. Allow it plainly when m is the 3rd or 7th of the original dominant. Allow it only under a "jazzy / altered" setting when m is the original root (#11) or 5th (b9).
  - Modal interchange in major: iv, bVI, bVII, bIII, ii°, v from the parallel minor. Reject it if m is the natural form of a degree the borrowed chord lowers (e.g. A natural in the melody over Fm). That is a cross-relation.
  - Pedal point: keep the bass on the tonic or 5th while the upper chords follow the original. Offer it when at least half of the chords contain the pedal pitch class.
- [CALC] **Second layer as a pad.**
  - Same chord symbols, with the voicing kept above C4. Use Contrapunk's soprano register 60–81 or Impro-Visor's right hand 60–81 as the band.
  - 3 or 4 notes built from 3rd, 7th and one or two available tensions (no root, because the first layer or the bass has it).
  - Voice-led with the section 3 cost and long notes (one per chord, tied across repeated chords).
  - Rhythmic counterpoint: if layer 1 plays on beats, layer 2 sustains or plays off-beats. Never both on every attack, except on the downbeat of a new chord.

### Gaps
- No fetched primary source states the tritone-substitution or passing-diminished rules in words (the Wikipedia and Open Music Theory v2 jazz chapters were blocked). The tests above are derived from the applied-chord rule and from common tones I computed.
- The ejazzlines PDF and the upper-structure lesson pages were not opened. The upper-structure list relies on a search summary plus my own interval arithmetic.
- No source was found on rhythmic interplay between two chord layers. The rule above is an inference.

## 3. Voice-leading algorithms: minimal movement, common tones, parallels, range; search over voicings

### Takeaway
Three families exist in readable open code:
- Filter, then sort by total movement: tonal.js, jazzband.
- Weighted random sampling: Impro-Visor.
- Hard rules plus a scored best-first or cartesian search: harmony-ts, Contrapunk.

For M-Theory, the simplest robust choice is a Viterbi (dynamic-programming) search over pre-generated candidate voicings. The cost is total semitone movement (L1, as in jazzband) plus penalties and bonuses taken from Contrapunk and Impro-Visor. The hard rules come from music21 and harmony-ts. For two chords with the same number of notes, the minimal L1 voice leading can be found in O(n²) by checking rotations; I verified this against brute force.

### Cited Findings
- [SEC] The geometric voice-leading model (Science 313:72–74, 2006, "The Geometry of Musical Chords") finds every voice leading between pitch-class sets. For distance measures that obey a "distribution constraint", a minimal one-to-one voice leading always exists that is crossing-free, i.e. it keeps the scale order. The R package musicMCT `minimize_vl` implements the crossing-free search with taxicab (default), euclidean, chebyshev or hamming metrics. — [musicMCT minimize_vl](https://rdrr.io/cran/musicMCT/man/minimize_vl.html); [glossary](https://harmonious.nfshost.com/p/cb/Glossary-Voice-Leading)
- [SRC] musicMCT 0.5.0 is licensed "GPL (>= 3)", published 2026-06-21, and exports `minimize_vl`. — [DESCRIPTION](https://raw.githubusercontent.com/cran/musicMCT/master/DESCRIPTION)
- [CALC] Verification script: for random pitch-class multisets of size 2–5 (20,000 trials), the brute-force minimum over all n! pairings always equalled the best of the n rotations (0 mismatches). A rotation means: sort both chords, rotate the target by k, lift wrapped notes an octave, try whole-chord octave offsets. Examples: C→F triad 3 semitones; G7→Cmaj7 3; Dm7→G7 3.
- [SRC] tonal.js `voicing.get`/`sequence`: candidate voicings are dictionary shapes placed at every valid start note in range (default C3–C5). The first chord takes the lowest voicing. After that, the default `topNoteDiff` picks the voicing whose top note is closest to the previous top note, so only the top voice is considered. — [voicing/index.ts](https://github.com/tonaljs/tonal/blob/main/packages/voicing/index.ts); [voice-leading/index.ts](https://github.com/tonaljs/tonal/blob/main/packages/voice-leading/index.ts)
- [SRC] jazzband `getNextVoicing`:
  - Enumerate permutations of required plus optional notes that pass interval validators.
  - Analyse each against the previous voicing: `difference` = sum of |semitone movement| (L1), `movement` = signed sum, oblique (held) notes, similar, parallel and contrary flags.
  - Sort by `difference`. By default the top voice may not be added or dropped.
  - If the previous voicing's bottom is within 3 semitones of the range floor (or its top within 3 of the ceiling), pick the smallest-|movement| choice that moves up (or down).
  - Defaults: range C3–C5, rangeBorders [3,3], maxVoices 4.
  — [Voicing.ts](https://github.com/felixroos/jazzband/blob/master/src/harmony/Voicing.ts)
- [SRC] Impro-Visor weights for following the previous voicing (multiplicative, used in random sampling): held note ×4 (`previousVoicingMultiplier`), ±1 semitone ×3 (`halfStepAwayMultiplier`), ±2 semitones ×2 (`fullStepAwayMultiplier`). Within a hand, after a note is chosen its neighbours are scaled: ±1 ×0 (`halfStepReducer`, so no semitone clusters), ±2 ×0.7 (`fullStepReducer`), and the same pitch class in other octaves ×0.3 (`repeatMultiplier`). — [AutomaticVoicingSettings.java](https://github.com/Impro-Visor/Impro-Visor/blob/master/src/imp/voicing/AutomaticVoicingSettings.java)
- [SRC] harmony-ts:
  - Hard rules: range, spelling, doubling, completeness, spacing (adjacent upper voices ≤ 12 semitones, no crossing), parallels, contrary 5ths/8ves, overlap, hidden 5ths in the outer voices, resolution of leading tone and 7th, invalid melodic intervals.
  - Soft preferences are compared lexicographically in this order: fewerModulations, modulationToPredominant, checkSequence, checkSequenceTarget, checkRepetition, checkRange, checkDoubling, checkVoiceCrossing, checkVoiceOverlap, checkBassOctaveJump, checkVoiceDisjunction, checkSharedPitch.
  - checkVoiceDisjunction = −Σ(jump²) over the upper voices, an L2 cost.
  - Search: candidates per voice are sorted by distance to the previous note of that voice, and a lazy min-generator yields voicings best-first. `depthOrdering` looks one chord ahead.
  — harmony-ts 0.14.6 `dist/part-writing/part-writing.js` and `part-writer.js` ([npm](https://registry.npmjs.org/harmony-ts))
- [SRC] Contrapunk `VoiceLeadingProcessor`:
  - Pipeline: placements of each pitch class inside each voice's register, cartesian product, hard rules, holistic score, deterministic tie-break.
  - Hard rules: parallel 5ths/8ves (when the style says hard), max leap, the user-anchor constraint.
  - Penalties: spacing (−80 to −200); crossing (−2 to −150); parallels when soft (−2 to −100 each); all voices in parallel motion (−5 to −120); leap (0 to −15 per semitone).
  - Bonuses: steps of 1–2 semitones (+1 to +60); common tones (+1 to +70); contrary motion (+3 to +40); spread (−4 to +5 per semitone); distance from the register centre on the first chord.
  - Tie-break order: score, common tones, steps down, steps up, total movement (ascending), lexicographic MIDI.
  - Style presets (Renaissance-strict / Baroque-chorale / Jazz / Free):
    | Setting | Renaissance-strict | Baroque-chorale | Jazz | Free |
    |---|---|---|---|---|
    | Hard-reject 5ths and 8ves | yes | yes | no | no |
    | Max leap (semitones) | 5 | 12 | 127 | 127 |
    | Step bonus | 60 | 25 | 3 | 1 |
    | Common-tone bonus | 45 | 70 | 2 | 1 |
    | Leap penalty per semitone | −15 | −4 | 0 | 0 |
    | Crossing penalty | −150 | −80 | −10 | −2 |
    | Spread preference per semitone | −4 | −1 | +5 | 0 |
    | Contrary-motion bonus | +40 | +20 | +3 | 0 |
  — [ENGINE_DEEP_DIVE.md](https://github.com/contrapunk-audio/contrapunk/blob/main/docs/ENGINE_DEEP_DIVE.md)
- [SRC] music21 figured-bass `Rules()` defaults:
  - forbidIncompletePossibilities = True
  - upperPartsMaxSemitoneSeparation = 12
  - forbidVoiceCrossing, forbidParallelFifths, forbidParallelOctaves, forbidHiddenFifths, forbidHiddenOctaves, forbidVoiceOverlap all True
  - partMovementLimits = [] (pairs of (part, max semitones))
  - DEFAULT_MAX_PITCH = B5
  - Parallel 5ths are tested for every pair of voices (|interval| mod 12 == 7 in both chords, then confirmed). Hidden 5ths and 8ves only for the outer pair.
  — [rules.py](https://github.com/cuthbertLab/music21/blob/master/music21/figuredBass/rules.py); [possibility.py](https://github.com/cuthbertLab/music21/blob/master/music21/figuredBass/possibility.py)
- [SRC] Keyboard-style voice leading (Open Music Theory):
  - "The law of the shortest way ... move each voice as little as possible. Prefer repetition to steps, steps to leaps, and one leap at a time to several voices leaping at the same time."
  - Move the right hand in contrary or oblique motion to the bass; this may be ignored when the bass leaps a 4th or 5th.
  - No parallel 5ths or 8ves between any pair. No contrary 5ths or 8ves between the outer voices.
  - No octave between the outer voices approached by similar motion unless the melody moves by step.
  — [bassoContinuo.md](https://github.com/openmusictheory/openmusictheory.github.io/blob/master/bassoContinuo.md)
- [SRC] M-Theory's current `voiceLeadingDistance(a,b)` works on pitch classes only: for each pitch class, the nearest pitch class in the other chord (min(d, 12−d)), summed in both directions and halved. It knows nothing about register or voices. — `src/theory/progression.ts` lines 49–57 (this repo)

### Inferences
- [CALC] **Recommended chooser: Viterbi over candidate voicings.**
  1. For each chord, generate K candidates (typically 20–150). Do this from shape tables (section 4: close, drop 2, drop 3, shell, rootless A/B, spread) at every transposition inside the layer's range, or from Contrapunk-style placements per voice.
  2. Node cost = register-centre distance × 0.1 per semitone, plus a low-interval-limit violation × 5, plus "missing 3rd or 7th" × 10.
  3. Edge cost:
     - Σ|movement| per matched voice (L1), using the rotation matching when note counts are equal. When they differ, duplicate the closest voice.
     - −2 per held common tone.
     - +0.5 per semitone of top-voice leap above 4 semitones (a smooth top line).
     - +10 per parallel 5th or 8ve between any pair where both voices move. Make it a hard rule in a "classical" style, following the Contrapunk presets.
     - +3 if all voices move in the same direction.
  4. Hard rules: no crossing; adjacent upper voices ≤ 12 semitones apart; inside the hand-span limit; bass equals the required bass note.
  5. Solve with DP: O(N·K²). For 64 chords × 100² that is 640,000 edge evaluations, well under 50 ms in JS.
  Ties break as Contrapunk does: common tones, then total movement, then lowest MIDI. This is deterministic, so it is easy to unit-test.
- [CALC] The weights are chosen so that 1 semitone of movement costs 1, matching jazzband's L1 `difference`. A held note is worth 2 semitones, roughly matching Impro-Visor's ×4 held vs ×3 semitone attraction. Parallels cost more than any normal move, mirroring the size of Contrapunk's penalties.
- [CALC] For the existing pitch-class score, keep `voiceLeadingDistance` for chord suggestions, and add a separate register-aware `voicingDistance(prevMidi[], nextMidi[])` for the new voicing chooser.

### Gaps
- The 2006 paper itself and the musicMCT R source were not readable (no raw file path found; the paper host was not tried because of the network rules). The O(n²) rotation claim is backed by my brute-force test, not by the paper text.
- FourVoices' constraint model (GPL-3.0) could not be read: its source paths returned 404 by raw URL and the GitHub API was blocked.

## 4. Piano voicings: shapes, hands, registers, low-interval limits, hand span

### Takeaway
A small set of shapes covers what users need:
- Close and open triads with inversions.
- Drop 2 and drop 3.
- Shells (1-3-7, 1-7-3).
- Rootless A/B (from tonal.js data).
- Spread 10ths.
- Upper-structure triads.

Fix them with register bands from open code: left hand about MIDI 46–67 and right hand about 60–81 (Impro-Visor), with C3–C5 for comping (tonal.js and jazzband). Add a 9-semitone default hand window (Impro-Visor), an upper-voice span of at most an octave (music21, Open Music Theory, harmony-ts), and a low-interval rule. Sources disagree by a few semitones on the low-interval limits.

### Cited Findings
- [SRC] Impro-Visor defaults (`AutomaticVoicingSettings.java`):
  - Left hand: MIDI 46–67 (Bb2–G4), right hand: MIDI 60–81 (C4–A5).
  - Hand spread: 9 semitones each hand (window above the hand's lowest note).
  - Notes per hand: left 1–2, right 1–4.
  - maxPriority 6, priorityMultiplier 0.667, invertM9 false, rootless false, leftMinInterval and rightMinInterval 0.
  — [AutomaticVoicingSettings.java](https://github.com/Impro-Visor/Impro-Visor/blob/master/src/imp/voicing/AutomaticVoicingSettings.java)
- [SRC] Contrapunk registers (MIDI): soprano 60–81, alto 55–76, tenor 48–69, bass 40–64. Centres: 70.5, 65.5, 58.5, 52. — [ENGINE_DEEP_DIVE.md](https://github.com/contrapunk-audio/contrapunk/blob/main/docs/ENGINE_DEEP_DIVE.md)
- [SRC] harmony-ts voice ranges, given as [hard low, preferred low, preferred high, hard high]:
  - Soprano B3, C4, G5, A5
  - Alto G3, G3, C5, D5
  - Tenor C3, C3, G4, A4
  - Bass D2, E2, C4, D4
  — harmony-ts 0.14.6 part-writing.js ([npm](https://registry.npmjs.org/harmony-ts))
- [SRC] Keyboard style: the three upper voices are played by one hand and "should never span more than an octave". Doubling rules:
  - In 5/3 or 6/4 chords, double the bass.
  - In a 6/3 chord over do, re, fa or sol, double the bass.
  - In a 6/3 chord over a variable degree, double an upper voice.
  - Never double a variable or chromatic degree.
  — [bassoContinuo.md](https://github.com/openmusictheory/openmusictheory.github.io/blob/master/bassoContinuo.md)
- [SRC] harmony-ts doubling preferences: root position doubles the root; 2nd inversion doubles the 5th; a 7th chord without its 5th doubles the root; never double a 7th or the leading tone. — part-writing.js (npm harmony-ts)
- [SRC] jazzband spacing defaults:
  - `minBottomDistance` 3 ("min semitones between the two bottom notes")
  - `minTopDistance` 2
  - `maxDistance` 6 in the validator (7 in getNextVoicing's defaults) between neighbouring notes
  - Required notes, in order: 3, 7, b5, 6; the 4th in sus chords. The root and the 5th are optional, which is the shell-voicing idea.
  — [Voicing.ts](https://github.com/felixroos/jazzband/blob/master/src/harmony/Voicing.ts)
- [SRC] tonal.js rootless A/B and triad-inversion data: see section 2. Default voicing range C3–C5. — [data.ts](https://github.com/tonaljs/tonal/blob/main/packages/voicing-dictionary/data.ts)
- [SEC] Low-interval limits, as summarised from Sweetwater (that page uses middle C = "C3"): m2 E2–F2, m3 C2–Eb2, M3 B1–D#2, tritone B0–F1, P5 C#1–G#1, and a M7 can sit on F1. Larger intervals can go lower; the tritone holds up low. — [Sweetwater InSync](https://www.sweetwater.com/insync/low-interval-limit/)
- [SEC] Logic left-hand patterns: Root Only, Root & Octave, Root & Fifth, Steady 8ths. — [Apple guide](https://support.apple.com/guide/logicpro-ipad/lpip5e3e59c4/ipados)

### Inferences
- [CALC] **Shape definitions**, with Cmaj7 as the example (close position from the top down: B4 G4 E4 C4):
  - Close position: all notes within an octave, in any inversion. Cmaj7 = C4 E4 G4 B4.
  - Open position: spread over more than an octave.
  - Drop 2: lower the 2nd-highest note an octave → G3 C4 E4 B4.
  - Drop 3: lower the 3rd-highest → E3 C4 G4 B4.
  - Drop 2+4: → C3 G3 E4 B4.
  - Shell 1-3-7: C3 E3 B3. Shell 1-7-3: C3 B3 E4.
  - Spread 10ths: left hand root + 10th (C3 E4) or root + 7th; right hand 3rd/7th/9th above.
  - Rootless ii–V–I in C, alternating A–B–A forms: Dm7 A (F3 A3 C4 E4) → G7 B (F3 A3 B3 E4) → Cmaj7 A (E3 G3 B3 D4). Movements are 1 semitone, then 5 semitones: 6 in total for 3 chords.
- [CALC] **Converted Sweetwater figures** in scientific pitch (middle C = C4): m2 E3–F3 (MIDI 52), m3 C3–Eb3 (48), M3 B2–D#3 (47), tritone B1–F2 (35), P5 C#2–G#2 (37), M7 on F2 (41). An often-repeated arranging table puts M3 at Bb2 and P5 at Bb1. That is my memory, not fetched, so treat it as unverified. Either way the disagreement is 1–3 semitones.
- [CALC] **Conservative coding rule** that satisfies both versions. For the two lowest sounding notes (lower note L, interval i):
  - L < 40 (E2): i must be 12 or more.
  - L < 47: i must be 7 or more.
  - L < 52: i must be 3 or more.
  - Otherwise any interval.
  Apply it to every adjacent pair, not only the bottom two.
- [CALC] **Register targets.**
  - Comping or chord layer: C3–C5 (MIDI 48–72), the tonal.js and jazzband default.
  - Pad layer: C4–C6 (60–84), matching Contrapunk's soprano band and Impro-Visor's right hand.
  - Bass or left hand: MIDI 40–64 (Contrapunk's bass band) or the Impro-Visor left hand 46–67.
  - Pads should avoid tensions below MIDI 52 (by the rule above, an m2 or M2 there is muddy).
- [CALC] **Hand span.** Default 9 semitones per hand (Impro-Visor, about a 6th). Allow up to 12 (one octave, as in Open Music Theory and music21 `upperPartsMaxSemitoneSeparation`) when the user picks "wide". Offer a 10th (15–16 semitones) only in the left hand of the "spread" style.
- [CALC] **Left/right split.**
  - Left hand: the root, or root + 7th or root + 10th, below about C4.
  - Right hand: the remaining notes within 9–12 semitones, at or above about C4.
  - For rootless styles the left hand plays the A/B shape (C3–C5), and the bass instrument or the bass layer supplies the root.

### Gaps
- No primary data on average hand span was fetched. The 9- and 12-semitone limits come from software defaults and textbook spacing rules, not from measured hands.
- The full low-interval table was not readable (Sweetwater was blocked). Only the search summary's numbers are available, and they conflict with the commonly repeated table.

## 5. Showing chords on a keyboard diagram

### Takeaway
The MIT-licensed react-piano gives exact key geometry: uneven black-key offsets, black keys 0.65 of a white key's width and 66% of its height. A chord view should auto-fit the octave window to the voicing, colour root, chord tones and tensions differently, label each key with its chord degree, and mark the hand split.

### Cited Findings
- [SRC] react-piano (MIT): key positions in white-key widths from C are C 0, Db 0.55, D 1, Eb 1.8, E 2, F 3, Gb 3.5, G 4, Ab 4.7, A 5, Bb 5.85, B 6. Other defaults: `accidentalWidthRatio` 0.65; `keyWidthToHeight` 0.33 for white keys; black keys at 66% height; pressed keys drawn 2% shorter. — [Key.js](https://github.com/kevinsqi/react-piano/blob/master/src/Key.js); [Keyboard.js](https://github.com/kevinsqi/react-piano/blob/master/src/Keyboard.js); [styles.css](https://github.com/kevinsqi/react-piano/blob/master/src/styles.css)
- [SRC] M-Theory already draws guitar chord diagrams (`src/ui/components/ChordDiagram.tsx`) and has guitar voicing code (`src/guitar/voicings.ts`). A keyboard view would sit beside these. (This repo, file list only.)

### Inferences
- [CALC] **Window.** Start at the C at or below the lowest voiced note and end at the B at or above the highest note. Use at least 2 octaves (14 white keys) and at most 4 (28 white keys); a phone shows 2. Mark middle C (MIDI 60) with a small dot.
- [CALC] **Colours.**
  - Root: accent fill.
  - Other chord tones (3, 5, 7): a second fill.
  - Added colours or tensions (9, 11, 13, sus): an outline or a third tint.
  - Melody or top note: a ring.
  - Two layers, such as "original" and "new layer", use the same scheme at two opacities.
  - Use the app's existing theme tokens.
- [CALC] **Labels.** Write the degree (R, 3, 5, b7, 9…) on the key, with the note name below on wider screens. Show "LH" and "RH" brackets under the keys when the voicing has a split. Optional fingering: left hand 5-3-1 or 5-2-1 for 3-note shells; right hand 1-2-3-5 or 1-2-4-5 for 4-note shapes. That fingering rule is untested and unsourced.
- [CALC] **Animation.** When stepping through a progression, keep held notes lit and fade notes that move. This shows the voice leading.

### Gaps
- No source on colouring or labelling conventions for chord keyboards was read. Teaching-site pages were blocked or not found. Piano fingering rules were not researched.

## 6. Harmony options to offer users, in plain words, each tied to the theory

### Takeaway
Two short menus cover the theory: about 9 melody-harmony options and about 13 chord-layer options. Each maps to one algorithm in sections 1–3 and one cited rule set, so every option can be explained and tested.

### Cited Findings
These are the grounding sources for the options below, each already cited in sections 1–4:
- Diatonic interval harmonizing: harmonizer manuals [SEC]; Contrapunk DiatonicThirds [SRC].
- Contrary motion and counterpoint: Contrapunk ContraryMotion and StrictCounterpoint [SRC]; Open Music Theory species rules [SRC].
- Octave doubling: Contrapunk OctaveMode [SRC].
- Rootless, shell and drop shapes: tonal.js data and jazzband required notes [SRC].
- Applied chords and modal mixture: Open Music Theory [SRC].
- Available tensions: jazzband [SRC] and avoid-note summaries [SEC].
- Voice-leading search: jazzband, Impro-Visor, harmony-ts, Contrapunk [SRC].
- Section 1 links: [Contrapunk deep dive](https://github.com/contrapunk-audio/contrapunk/blob/main/docs/ENGINE_DEEP_DIVE.md); [firstSpecies.md](https://github.com/openmusictheory/openmusictheory.github.io/blob/master/firstSpecies.md)
- Section 2 links: [appliedChords.md](https://github.com/openmusictheory/openmusictheory.github.io/blob/master/appliedChords.md); [modalMixture.md](https://github.com/openmusictheory/openmusictheory.github.io/blob/master/modalMixture.md)
- Section 4 links: [tonal voicing data](https://github.com/tonaljs/tonal/blob/main/packages/voicing-dictionary/data.ts); [jazzband Voicing.ts](https://github.com/felixroos/jazzband/blob/master/src/harmony/Voicing.ts)

### Inferences
- [CALC] **Melody track menu** (plain label → technique → theory):
  1. "Third above" → diatonic +2 steps, with the chord check on strong beats → parallel imperfect consonances. The species "max 3 in a row" rule is relaxed in pop.
  2. "Third below" → diatonic −2 steps, same checks.
  3. "Sixth below" (warm) → diatonic −5 steps; this is the inversion of a 3rd above.
  4. "Follow the chord" → nearest chord tone below or above → always consonant on strong beats.
  5. "Against the tune" → counter-melody: contrary or oblique motion, chord tones on strong beats, passing tones by step, leap recovery, no parallel perfect intervals.
  6. "Answer in the gaps" → call-and-response: fills rests only, with a sequenced echo of the last motif.
  7. "Octave up / down" → ±12 semitones (Contrapunk Mirror and Spread).
  8. "Hold one note" → tonic or 5th pedal; offered with a hint when most chords contain that note.
  9. "Slow line" → guide-tone line: the 3rd or 7th of each chord, chosen by smallest movement.
- [CALC] **Chords track menu:**
  1. "Same chords, higher" → pad layer C4–C6 without the root.
  2. "Smooth" → inversions chosen by minimum movement (Viterbi, section 3).
  3. "Add colour" → add9, 6, maj7, m7, 7, 9, sus2 or sus4, filtered by the avoid-note rule and the key.
  4. "Open and wide" → drop 2, drop 3 or spread 10ths.
  5. "Jazz piano" → rootless A/B, alternating for ii–V–I.
  6. "Just the shell" → 1-3-7 or 1-7-3.
  7. "Lead into each chord" → secondary dominants (V7/X).
  8. "Borrow darker chords" → modal interchange (iv, bVI, bVII…).
  9. "Slide between" → passing diminished (vii°7/X).
  10. "Swap for a cousin" → relative substitution (shares 2 notes).
  11. "Jazz swap" → tritone substitution of dominants.
  12. "Stay on one bass note" → pedal point.
  13. "Play in the spaces" → rhythm offset against the first layer.
- [CALC] Every reharmonization option should run the melody-note test from section 2. Hide or grey out chords where the melody's strong-beat note fails, so the user never gets a clash they did not ask for.

### Gaps
- Exact option names used by commercial tools (Captain Chords, Band-in-a-Box harmony types, Logic's full right-hand voicing list) were not confirmed, because vendor hosts were blocked or no results were found.

## 7. Open-source code and licences: what can be ported into GPL-3.0-or-later

### Takeaway
Every code source read is permissive or GPL-compatible, so it can be ported if its notice is kept:
- MIT: Contrapunk, tonal.js, react-piano.
- ISC: jazzband.
- BSD-3: music21.
- Apache-2.0: harmony-ts.
- GPL-2.0-or-later: Impro-Visor.
- GPL-3.0: FourVoices.
- GPL ≥ 3: musicMCT.

Open Music Theory prose is CC BY-SA 4.0. Use its rules as facts and re-implement them; do not paste its text into the app.

### Cited Findings
| Source | Licence (how verified) | Language | What it gives | Tag |
|---|---|---|---|---|
| [Contrapunk](https://github.com/contrapunk-audio/contrapunk) | MIT ([SRC] LICENSE, "Copyright (c) 2026 Contrapunk Audio") | Rust core, Tauri, WASM | Diatonic and chromatic fallback harmony, contrary motion, counterpoint, scored voicing search, style presets, anchors | PORT |
| [tonal.js](https://github.com/tonaljs/tonal) | MIT ([SEC]: root LICENSE path returned 404, API blocked) | TypeScript | Voicing dictionary (rootless A/B, triads), range search, top-note voice leading | PORT |
| [jazzband](https://github.com/felixroos/jazzband) | ISC ([SRC] package.json) | TypeScript | Validator constants, L1 voice-leading analysis, available tensions, range-border steering | PORT |
| [music21](https://github.com/cuthbertLab/music21) | BSD-3-Clause ([SRC] LICENSE, 2006–2026) | Python | Parallel, hidden, overlap and crossing tests; figured-bass rule defaults; motion types | PORT |
| [harmony-ts](https://registry.npmjs.org/harmony-ts) 0.14.6 | Apache-2.0 ([SRC] npm package.json) | TypeScript | Four-part rules, voice ranges, doubling preferences, best-first search | PORT (Apache-2.0 is compatible with GPLv3, not with GPLv2-only) |
| [Impro-Visor](https://github.com/Impro-Visor/Impro-Visor) | GPL-2.0-or-later ([SRC] file header) | Java | Hand ranges and spreads, weighting constants, rootless, minor-9th inversion | PORT |
| [FourVoices](https://raw.githubusercontent.com/erickim555/FourVoices/master/README.md) | GPL-3.0 ([SRC] README) | Python 2.7 | Four-part writing as a constraint problem (source unread) | PORT |
| [musicMCT](https://raw.githubusercontent.com/cran/musicMCT/master/DESCRIPTION) | GPL (>= 3) ([SRC] DESCRIPTION) | R | `minimize_vl` crossing-free minimal voice leading (source unread) | PORT |
| [react-piano](https://github.com/kevinsqi/react-piano) | MIT ([SRC] LICENSE 2018) | JS/React | Keyboard geometry constants | PORT |
| [Open Music Theory v1](https://github.com/openmusictheory/openmusictheory.github.io) | CC BY-SA 4.0 ([SRC] footer.html) | Markdown | Species, keyboard-style, applied-chord, mixture and pop-harmony rules | REF |
| Neural chorale model ([arXiv 1612.01010](https://arxiv.org/abs/1612.01010)), HMM chorale model ([arXiv 2109.07623](https://arxiv.org/abs/2109.07623)) | not checked | Python/ML | Data-driven chorale harmonization | REF (not read) |

- [SRC] Contrapunk's build layout matches M-Theory closely:
  - `src-tauri/`: Tauri desktop app.
  - `wasm/` + `ui/`: browser app with Web MIDI and Web Audio.
  - Crates: `crates/contrapunk-harmony` and `crates/contrapunk-chord`.
  Its harmony core could be compiled to WASM for the browser, or linked into M-Theory's Rust backend. — [README](https://github.com/contrapunk-audio/contrapunk/blob/main/README.md); [Cargo.toml](https://raw.githubusercontent.com/contrapunk-audio/contrapunk/main/Cargo.toml)

### Inferences
- [CALC] Fastest route for M-Theory:
  1. Port the small, pure functions to TypeScript under `src/theory/`, keeping each licence notice in a header comment: the tonal.js voicing table (MIT), jazzband tension and validator logic (ISC), the music21 parallel and hidden tests (BSD-3), and the Contrapunk fallback ladder and scoring constants (MIT).
  2. Write the Viterbi chooser from scratch.
  3. Optionally, later, compile Contrapunk's `contrapunk-harmony` crate to WASM (it already ships a WASM target) for live MIDI harmonizing.
- [CALC] Keep a THIRD_PARTY_NOTICES file listing MIT, ISC, BSD-3 and Apache-2.0 notices. Apache-2.0 also requires carrying any NOTICE file; none was seen in the harmony-ts tarball listing I printed, but the full file list was truncated (unverified).

### Gaps
- tonal.js's licence file was not read (404 at /LICENSE, API blocked). MIT is from general knowledge and the npm ecosystem, so it is [SEC].
- I recall that Creative Commons declared CC BY-SA 4.0 one-way compatible with GPLv3, which would allow adapting OMT text into GPLv3 material. This was not verified from a fetched page, so the notes treat OMT as reference only.
- The Strudel voicing code (AGPL-family LICENSE file of 661 lines seen at tidalcycles/strudel; text not read) and the neural and HMM chorale models were not examined.
