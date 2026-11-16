# M-Theory 🎸

**Your own guitar chord, key, mode & progression lab. No subscriptions, no ads, works offline.**

M-Theory answers the questions that matter when you're writing songs on guitar:

- *"I'm in B. What chords can I use?"* All of them: diatonic, colour chords, borrowed, chromatic.
- *"How else can I play this chord?"* Every playable voicing on the neck, not just the barre shape.
- *"What could come next?"* Suggestions from safe to wild, each with a plain-English reason.
- *"What mode is this, and how do I make it sound like that mode?"*

---

## What's inside

Three tabs. Everything starts simple; the deeper material is one tap away in fold-out sections.

### 🎼 Write: pick a key, meet its chords, build your song
1. **Pick a key and a mood.** Moods come first, scale names second: *Happy & bright* (Major), *Sad & emotional* (Minor), *Cool & soulful* (Dorian), *Bluesy & laid-back* (Mixolydian), *Dreamy & floating* (Lydian), *Dark & Spanish* (Phrygian), *Dramatic & exotic* (Harmonic minor)… plus 28 more scales under "More scales".
2. **Your chords.** The 7 chords of the key, each with an easy shape already drawn (no barre chords unless you allow them), its job in the key, and ▶ / + buttons:
   - 🟢 **Home** · 🔵 **Near home** · 🟠 **Away** · 🔴 **Tension** (wants to fall back home)
   - ★ marks chords holding the mode's **signature note** (Dorian's IV, Mixolydian's ♭VII…)
   - Fold-outs: **More chords that fit this key** (sus, add9, 6, 9, 11, 13 versions: 73 in B major) and **Twist chords** from outside the key (borrowed chords grouped by mood, plus surprise chords that each "lead into" a chord of your key).
   - **Capo tip**: when a key is full of barre chords it offers the fix. *B major: capo 4 makes all 7 chords easy open shapes.*
3. **Your song.** Add chords, press play (plucked-guitar synth, 5 rhythms), tap a chord to **hear it, change its shape, swap it, make it fancier, move or remove it**. ✨ **Write me a starting idea** generates a progression with a mood and a Safe ↔ Wild dial (with undo).
4. **What sounds good next?** Nine suggestions after your last (or selected) chord, colour-coded **Safe**, **Smooth**, **Colorful**, **Bold**, each with a two-word reason ("Strong pull", "Glides", "Borrowed from minor"). It scores every chord the key can offer, so it isn't limited to stock progressions.
5. **Save & export**: save ideas, export a **MIDI file** for your DAW (same shapes and rhythm you heard), copy a **chord chart + tab**, transpose the whole song.

### 🎸 Chords: every way to play any chord
- **Look up a chord**: root, then a kind (*Basic, 7ths, Sus & add, Lush 9/11/13, Spicy*) covering all 44 chord types, plus slash chords.
- **Ways to play it**: one row of filters (*Best, No barre, Open strings, Small (3 strings), Up the neck, Everything*) over every playable shape the generator finds (C major has 500+). "More options" adds bass note, difficulty and dot labels.
- Plain-English "Sounds:", the notes, and what the chord does in your key; formula, other names and parent keys sit in "Theory details".
- **What chord is this?** Tap a shape on the fretboard and it names it.

### 💡 Learn: short lessons in your current key
Fold-out topics: **Modes in plain English** (brightest to darkest, with a vamp to hear and "Write in this mode"), **Your scale on the fretboard**, **How chords are built**, **Which chords each mode gives you**, **Train your ear** (intervals), **Circle of fifths**.

Settings (⚙): avoid barre chords (on by default), 11 tunings (Standard, Drop D, DADGAD, Open G/D/E/C…), capo, dot labels, left-handed diagrams, light/dark theme.

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
