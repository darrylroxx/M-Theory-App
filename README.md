# M-Theory 🎸

**Your own guitar chord, key, mode & progression lab. No subscriptions, no ads, works offline.**

M-Theory answers the questions that matter when you're writing songs on guitar:

- *"I'm in B. What chords can I use?"* All of them: diatonic, colour chords, borrowed, chromatic.
- *"How else can I play this chord?"* Every playable voicing on the neck, not just the barre shape.
- *"What could come next?"* Suggestions from safe to wild, each with a plain-English reason.
- *"What mode is this, and how do I make it sound like that mode?"*

---

## What's inside

### 🔑 Key: everything about the key you're writing in
- Pick any of **12 tonics × 36 scales/modes**: the 7 major modes, harmonic & melodic minor modes, pentatonics, blues, exotic (double harmonic, Hungarian minor…) and symmetric scales.
- The scale with correct spelling (B major shows A♯, not B♭), intervals, the mode's **signature note**, key signature and relative modes.
- **The chords of the key** as triads, 7ths or 9ths, with Roman numerals and the quality pattern (*Major · minor · minor · Major · Major · minor · diminished*). Each chord is tagged with its job:
  - 🟢 **Home** (tonic) · 🔵 **Soft home** (tonic substitutes) · 🟠 **Departure** · 🔴 **Tension** (pulls back home)
  - ★ **Signature** chords contain the mode's unique note (Dorian's IV, Mixolydian's ♭VII, Lydian's II…)
- **Every chord in the key**: every chord type in the library whose notes fit the scale (sus2, sus4, add9, 6/9, m11, 13…), grouped by scale degree. B major alone has 70+.
- **Borrowed chords** (modal interchange), grouped by the parallel mode they come from (B minor, B Dorian, B Mixolydian…).
- **Chromatic spice**: secondary dominants, chromatic mediants, tritone subs, passing diminished chords, the Neapolitan.
- **Escape the barre chords**: finds the capo position that turns your key into open shapes. For B major: *capo 4 + G-shapes = all 7 chords open.*

### 🎸 Chords: every variation of every chord
- **44 chord types** (triads, power/sus, 6ths, 7ths, add chords, 9/11/13ths, altered dominants) on any root, plus slash chords.
- The **voicing generator** scans the whole neck and keeps every shape a real hand can play (≤ 4 fingers, barres where needed, sensible stretches). C major has 500+ voicings.
- Filter by **No barre**, **Open strings**, **3-string triads**, **Top strings**, **Barre**, bass note / inversions, neck zone and difficulty.
- Dots are coloured by role (**root**, **3rd**, **5th**, **7th**, **colour tones**) and can show intervals, note names or finger numbers.
- "Show chord tones on the whole neck" maps every note of the chord on the fretboard, so you stop thinking in fixed shapes.
- Plain-English feel, formula, other names for the same notes (Am7 = C6/A), and which keys the chord lives in.
- **Name that shape**: tap any shape on the fretboard and it tells you what chord you're holding.

### 🎼 Compose: build progressions for your EP
- Build a progression and hear it played by a built-in plucked-string guitar synth (Karplus-Strong, tuned to within 3 cents), with 5 rhythms: let ring, strum, 8th pulse, arpeggio, fingerpick.
- **What could follow?** Suggestions in four groups (*Natural next steps*, *Smooth & dreamy*, *Borrowed colour*, *Bold & cinematic*), each with a reason ("Root falls a 5th: the strongest pull in music", "Shares 2 notes, so it glides"…). It scores every chord your key can offer by how it moves from the last one, so it isn't limited to stock progressions.
- **✨ Spark** generates new progressions with a **mood** (dreamy, melancholic, dark, uplifting, floating, tense) and an **adventure** dial from safe to wild.
- **Substitute** any chord, **add colour** (C → Cmaj7/Cadd9/C6/9…), transpose, set beats per chord.
- **Smart voicings**: picks a voicing for every chord so your hand stays in one zone and the top note moves smoothly. Barre chords are avoided by default; pin your own voicing any time.
- **Save** ideas, export **MIDI** for your DAW (same voicings and rhythm you heard), or copy a **chord chart + tab**. (Inside sandboxed viewers that don't allow `.mid` downloads, the MIDI file comes wrapped in a `.zip`.)

### 🎯 Neck
The current scale across the whole fretboard (intervals or note names), with the signature note ringed, and any chord of the key lit up inside it.

### 💡 Learn
- **How chords relate in every mode**: a table of chord qualities for all modes on your tonic, so you can see why Dorian has a major IV.
- **The mode ladder**, brightest (Lydian) → darkest (Locrian): formulas compared with major, moods, and playable vamps you can send straight to Compose.
- **Chord recipes** (how each chord is stacked from intervals), **intervals by ear**, and an interactive **circle of fifths**.

Settings (⚙): 11 tunings (Standard, Drop D, DADGAD, Open G/D/E/C, D standard…), capo, left-handed diagrams, light/dark theme.

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
npm test          # 45 tests: theory, voicings, progressions, synth tuning, MIDI
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
    arrange.ts     voice-leading voicing optimizer (dynamic programming) + capo finder
    tunings.ts
  audio/
    synth.ts       Karplus-Strong guitar synth + look-ahead progression player
    patterns.ts    rhythm patterns (shared by playback and MIDI export)
    midi.ts        Standard MIDI File writer
  ui/            React app (views + components)
```

- **Voicings** are found by scanning 4-fret windows up the neck (plus open strings), trying every combination of chord tones per string, then keeping only shapes with all required tones, at most one muted string in the middle, and a feasible fingering. Each is scored for difficulty (fingers, barres, stretch, mutes) and usefulness (root position, fullness, low-end mud).
- **Suggestions** score every candidate chord by root motion (falling 5ths, steps, 3rds, chromatic slides), shared notes, voice-leading distance and resolution of tension, then group them by character.
- **Progression voicings** use dynamic programming to minimise total difficulty plus hand movement and top-note jumps across the whole progression.

Everything runs locally in your browser. Your progressions are saved in the browser's local storage.
