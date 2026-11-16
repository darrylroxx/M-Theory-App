# M-Theory 🎸

**Your own guitar chord, key, mode & progression lab. No subscriptions, no ads, works offline.**

M-Theory answers the questions that matter when you're writing songs on guitar:

- *"I'm in B. What chords can I use?"* All of them: diatonic, colour chords, borrowed, chromatic.
- *"How else can I play this chord?"* Every playable voicing on the neck, not just the barre shape.
- *"What could come next?"* Suggestions from safe to wild, each with a plain-English reason.
- *"What mode is this, and how do I make it sound like that mode?"*

---

## What's inside

One page, very little text. (A **Piano** tab is reserved for later.)

1. **Key**: tap one of the 12 notes.
2. **Mode**: Major, Minor, Dorian, Phrygian, Lydian, Mixolydian, Locrian, Harmonic minor, Melodic minor (27 more under "More…").
3. **Chords appear**, each drawn as an easy shape with finger numbers. Card colours show each chord's job: 🟢 Home · 🔵 Near home · 🟠 Away · 🔴 Tension; ★ = holds the mode's signature note. Small tabs switch to **7ths**, **Outside** (borrowed and surprise chords) and **Next ✨** (what could follow your last chord).
4. **Tap a chord to open the shape finder.** Every way to play it is laid out as a map:
   - **Across = up the neck**: Open · frets 1–3 · 4–6 · 7–9 · 10–12 · 13+
   - **Down = the note in the bass**: root, 3rd, 5th (7th…), i.e. root position and each inversion
   - Each square shows the best shape for that spot; ‹ › flips through the others there. Tap a shape to hear it and use it.
   - **Flavours** along the top swap the chord itself (C → Cmaj7, Cadd9, Csus2, C6…; "All…" has all 44 types).
   - Filters: strings (Any / 3 / 4 / 5–6), **No barre**, **Open strings**; dots can show fingers, notes or intervals.
5. **Build the progression in the tray** at the bottom. Drag chords in (touch: press and hold, then drag; or tap **+**), drag to reorder, ✕ to remove. The finder stays open above the tray, so you can **drag one exact shape straight into the tray**. Tap a chord in the tray to change that spot's shape, flavour, length or position.
6. **Arrange** (the bar on top of the tray, once you have two chords): tap a neck area (**Open · 1–3 · 4–6 · 7–9 · 10–12**) and every chord in the progression is re-voiced there together, picking the set of shapes that needs the least hand movement. The bar shows the frets the whole progression now spans.
   - **Strings** (Any / 3 / 4 / 5–6) and **Inversions** (let the bass note change for smoother moves) re-deal the set.
   - **‹ ›** under each chord in the tray sifts that one chord through its other shapes, best fit with its neighbours first, while everything else stays put. Do it while the loop is playing to hear each option in context.
   - Chords you add later land in the same area. **My shapes** switches back to each chord's own shape.
7. **▶** plays it. **✨** writes a starting idea. **⋯** has tempo, rhythm, loop, idea settings, transpose, **MIDI export**, copy chords + tab, and saved ideas.

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
npm test          # 52 tests: theory, voicings, progressions, synth tuning, MIDI
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
    shapeMap.ts    organises voicings into the finder map (neck position × bass note)
    arrange.ts     easy default shapes, voice-leading optimizer (dynamic programming), capo finder
    tunings.ts
  audio/
    synth.ts       Karplus-Strong guitar synth + look-ahead progression player
    patterns.ts    rhythm patterns (shared by playback and MIDI export)
    midi.ts        Standard MIDI File writer
  ui/            React app: the guitar page, shape finder, tray, drag & drop
```

- **Voicings** are found by scanning 4-fret windows up the neck (plus open strings), trying every combination of chord tones per string, then keeping only shapes with all required tones, at most one muted string in the middle, and a feasible fingering. Each is scored for difficulty (fingers, barres, stretch, mutes) and usefulness (root position, fullness, low-end mud).
- **Suggestions** score every candidate chord by root motion (falling 5ths, steps, 3rds, chromatic slides), shared notes, voice-leading distance and resolution of tension, then group them by character.
- **Progression voicings** use dynamic programming to minimise total difficulty plus hand movement and top-note jumps across the whole progression.

Everything runs locally in your browser. Your progressions are saved in the browser's local storage.
