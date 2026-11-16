# M-Theory 🎸

**Your own guitar chord, key, mode & progression lab. No subscriptions, no ads, works offline.**

M-Theory answers the questions that matter when you're writing songs on guitar:

- *"I'm in B. What chords can I use?"* All of them: diatonic, colour chords, borrowed, chromatic.
- *"How else can I play this chord?"* Every playable voicing on the neck, not just the barre shape.
- *"What could come next?"* Suggestions from safe to wild, each with a plain-English reason.
- *"What mode is this, and how do I make it sound like that mode?"*

---

## What's inside

One clean screen, three steps, very little text.

### Write
1. **Key**: tap one of the 12 notes.
2. **Mode**: Major, Minor, Dorian, Phrygian, Lydian, Mixolydian, Locrian, Harmonic minor, Melodic minor (27 more under "More…").
3. **Chords appear**, each drawn as an easy shape with finger numbers. Tabs switch between the 7 **Chords** of the key, their **7ths**, **More** (every sus/add/9/11/13 chord that fits: 73 in B major), **Outside** (borrowed and surprise chords) and **Next ✨** (what could follow your last chord: Safe, Smooth, Colorful, Bold).
   - Card colours show each chord's job: 🟢 Home · 🔵 Near home · 🟠 Away · 🔴 Tension. ★ = holds the mode's signature note.
4. **Tap a chord** to see every way to play it: open shapes, barre and no-barre shapes, inversions, 3-string triads, all over the neck. Each shows finger numbers, the frets (e.g. `x2444x`) and a difficulty dot. Tap a shape to hear it and make it *your* way of playing that chord.
5. **Drag chords into the tray** at the bottom (touch: press and hold, then drag; or tap **+**). Drag to reorder, ✕ to remove. The tray shows each chord with your chosen shape and plays it back. Tap a chord in the tray to give that spot its own shape, length or position.
6. **✨** writes a starting idea. **⋯** has tempo, rhythm, loop, idea settings, smooth shape arranging, transpose, **MIDI export**, copy chords + tab, and saved ideas.

A **Capo** menu sits next to the scale; ★ marks the capo that removes the most barre chords (B major: capo 4).

### Chords
Look up any of the 44 chord types on any root (plus slash chords) and browse its shapes the same way, or **name a shape** by tapping it on a fretboard.

### Learn
Fold-out topics: modes, your scale on the fretboard, chord recipes, chords in each mode, intervals by ear, circle of fifths.

Settings (⚙): avoid barre chords (on by default), 11 tunings, capo, dot labels (fingers / notes / intervals), left-handed diagrams, light/dark theme.

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
npm test          # 46 tests: theory, voicings, progressions, synth tuning, MIDI
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
