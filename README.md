# M-Theory 🎸

**Your own guitar chord, key, mode & progression lab. No subscriptions, no ads, works offline.**

M-Theory answers the questions that matter when you're writing songs on guitar:

- *"I'm in B. What chords can I use?"* All of them: diatonic, colour chords, borrowed, chromatic.
- *"How else can I play this chord?"* The shapes guitarists really use, starting from the common ones and branching out, not just the barre shape.
- *"What could come next?"* Suggestions from safe to wild, each with a plain-English reason.
- *"What mode is this, and how do I make it sound like that mode?"*
- *"What does it sound like over a beat?"* A drum machine with 90 rhythms you can edit by tapping.

---

## What's inside

One page, very little text. (A **Piano** tab is reserved for later.)

1. **Key**: tap one of the 12 notes.
2. **Mode**: Major, Minor, Dorian, Phrygian, Lydian, Mixolydian, Locrian, Harmonic minor, Melodic minor (27 more under "More…").
3. **Chords appear**, each drawn as an easy shape with finger numbers. **Tap a chord to hear it.** Card colours show each chord's job: 🟢 Home · 🔵 Near home · 🟠 Away · 🔴 Tension; ★ = holds the mode's signature note. Small tabs switch to **7ths**, **Outside** (borrowed and surprise chords) and **Next ✨** (what could follow your last chord).
4. **Shapes** (the button on every chord) opens the shape finder: the ways guitarists really play that chord, starting from the ones everybody knows.
   - **Common**: the textbook open chord, the two movable barre shapes (root on the 6th string, root on the 5th string), the small four-string shape, and for seventh chords the standard jazz grips.
   - **Small**: three- and four-string shapes with no big barre, grouped by string set and running up the neck. The way out of playing barre chords for everything.
   - **Inversions**: the same chord with another note in the bass (C/E, C/G), grouped by bass note.
   - **All**: everything playable, grouped by where it sits on the neck.
   - Tap a shape to hear it and use it. **Flavours** along the top swap the chord itself (C → Cmaj7, Cadd9, Csus2, C6…; "All…" has all 44 types).
   - Only comfortable grips are listed: no muted strings in the middle of a chord (except the classic thumb-muted ones like 3x0003 and 5x555x), no stretch wider than four frets, no open strings mixed with notes far up the neck.
5. **Build the progression in the tray** at the bottom. Drag chords in (touch: press and hold, then drag; or tap **+**), drag to reorder, ✕ to remove. The finder stays open above the tray, so you can **drag one exact shape straight into the tray**. Tap a chord in the tray to hear it; the small grid button under it opens the finder for that spot (shape, flavour, length, position).
6. **Arrange** (the bar on top of the tray, once you have two chords): tap a neck area (**Open · 1–3 · 4–6 · 7–9 · 10–12**) and every chord in the progression is re-voiced there together, picking the set of shapes that needs the least hand movement. The bar shows the frets the whole progression now spans.
   - **Strings** (Any / 3 / 4 / 5–6) and **Inversions** (let the bass note change for smoother moves) re-deal the set.
   - **‹ ›** under each chord in the tray sifts that one chord through its other shapes, best fit with its neighbours first, while everything else stays put. Do it while the loop is playing to hear each option in context.
   - Chords you add later land in the same area. **My shapes** switches back to each chord's own shape.
7. **Beat** (the top row of the tray): a built-in drum machine that plays under your chords.
   - **Beat on / off**, and **‹ ›** to flip through rhythms while it plays. **Edit** opens the drum machine.
   - **4 kits**, all synthesized in the app (no samples): **Vintage** (the rhythm box built into old organs: soft thud, ticking hats, tambourine), **808** (long boomy kick, snappy snare, metallic hats, cowbell), **Volca** (clicky punchy analog kick, grainy hats) and **Lo-fi** (crunchy 8-bit 80s sample machine).
   - **90 rhythms** in 7 styles: Dream pop · Lo-fi indie · Organ presets (Rock, Bossa nova, Rhumba, Waltz, Samba…) · 808 · Rock & pop · 6/8 & shuffle · World. Tap one and it plays.
   - **Edit by tapping squares.** Rows are drums, columns are steps; tap to add or remove a hit, drag along a row to paint. Soft / Normal / Loud sets how hard new hits are. **✨ Vary** makes a small random change, **Save** keeps your rhythm under "Mine".
   - Tap a drum's name to hear it and shape it: **Tune, Decay, Click / Snap / Grain, Level**, Mute.
   - **Tempo, Swing, Volume, Space** (reverb) and **Grit** (saturation) for the whole kit.
   - Picking a 3/4 or 6/8 rhythm changes whole-bar chords to match (4 beats become 3 in a waltz). With no chords in the tray, ▶ plays the beat alone so you can jam over it.
8. **▶** plays it. **✨** writes a starting idea. **⋯** has tempo, rhythm, loop, idea settings, transpose, **MIDI export** (guitar + a drum track on channel 10), copy chords + tab, and saved ideas.

A **Capo** menu sits next to the scale; ★ marks the capo that removes the most barre chords (B major: capo 4).

Settings (⚙): avoid barre chords (on by default), 11 tunings, capo, dot labels, left-handed diagrams, light/dark theme.

---

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
npm test          # 79 tests: theory, voicings, progressions, synth tuning, drums, MIDI
npm run build     # production build into dist/
npm run preview   # serve the production build
```

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
    chords.ts      44 chord types, building, identification ("what chord is this?")
    scales.ts      36 scales/modes with moods, signature notes, brightness
    keys.ts        diatonic harmony, roles, every chord in a key, borrowed & chromatic chords
    progression.ts suggestion engine, Spark generator, substitutions, colourizing
  guitar/
    voicings.ts    the voicing generator: search, fingering/barre detection, difficulty, tags
    shapes.ts      the shape book: textbook open chords, playability rules, shape families
    shapeMap.ts    areas of the neck
    arrange.ts     easy default shapes, voice-leading optimizer (dynamic programming), capo finder
    tunings.ts
  audio/
    synth.ts       Karplus-Strong guitar synth + look-ahead player for chords and drums
    drums.ts       drum machine voices (4 kits × 9 drums), synthesized from oscillators and noise
    beats.ts       step-grid format, the rhythm library, swing, variation
    patterns.ts    rhythm patterns (shared by playback and MIDI export)
    midi.ts        Standard MIDI File writer
  ui/            React app: the guitar page, shape finder, tray, drag & drop
```

- **The shape book** keeps about one in six of the generated voicings. A shape has to be holdable (stretch, finger order, muted strings) and it is then filed under the families guitar teaching uses: open chords, the two barre shapes, triads on neighbouring strings, four-string shapes and shell voicings. Default shapes, Arrange and the ‹ › steppers only ever use these.
- **Voicings** are found by scanning 4-fret windows up the neck (plus open strings), trying every combination of chord tones per string, then keeping only shapes with all required tones, at most one muted string in the middle, and a feasible fingering. Each is scored for difficulty (fingers, barres, stretch, mutes) and usefulness (root position, fullness, low-end mud).
- **Suggestions** score every candidate chord by root motion (falling 5ths, steps, 3rds, chromatic slides), shared notes, voice-leading distance and resolution of tension, then group them by character.
- **Progression voicings** use dynamic programming to minimise total difficulty plus hand movement and top-note jumps across the whole progression.

- **Drums** are modelled on how the classic machines make sound: a decaying sine with a pitch blip for the kick, two tuned pings plus filtered noise for the snare, six detuned square waves through band-pass filters for 808-style hats and cowbell, three quick noise bursts for the clap. The Lo-fi kit is then reduced to 8 bits at half the sample rate. The drum grid re-locks to every chord change, so the beat and the chords cannot drift apart.

Everything runs locally in your browser. Your progressions are saved in the browser's local storage.
