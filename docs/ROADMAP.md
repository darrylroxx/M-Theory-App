# M-Theory: the road to a DAW

How the app grows from a songwriting tool into a studio. Each step lands in **M-Theory Draft**
first and reaches **M-Theory** only when it is published.

## 1. The Windows app (done)

The app as a Windows program that updates itself, in two copies (Draft and published), with a
first native audio step: Settings lists every audio interface the computer sees, through ASIO.

## 2. The Track view

One page for the whole song, left to right in bars, the way a DAW shows a song:

```
            | A (8 bars)        | B (4 bars)  | A (8 bars)        | C (8 bars)        |
 Chords     | G   C   D   Em    | C     D     | G   C   D   Em    | Em  C   G   D     |
 Melody     | ▪ ▪▪  ▪ ▪▪ ▪      |             | ▪ ▪▪  ▪ ▪▪ ▪      | ▪▪▪ ▪ ▪▪          |
 Drums      | ████████████████  | ██████      | ████████████████  | ████████████████  |
 Vocal 1    | ~~~~~~~ take 3    |             |                   | ~~~~~~ take 1     |
 Vocal 2 …  |                   |             |                   |                   |
```

- **The sections and the Track view are the same song, seen two ways.** Whatever is made on the
  Frame, Rhythm, Melody, Drums and Vocals pages for a section shows up in its blocks on the Track
  view, and whatever is changed on the Track view changes the sections.
- **A track is one instrument for the whole song.** Its head (left) holds what applies everywhere:
  volume, pan, mute, solo, its sound and effects, and record-arm for vocal tracks. Changing a
  track's head changes that instrument in every section.
- **The blocks** are the sections. Tap one to open that section's page for that track; drag a
  section to move it; drag its end to change its length (the Frame's rule: everything inside
  plays in its bars, an empty bar is silent).
- The play bar, the loop bar and the playhead are shared with every page, so the Track view and
  the Canvas follow the same music.

## 3. The audio engine

Native, in Rust, on the interface's ASIO driver: the song (chords, melody, drums, earlier takes)
is rendered and played by the engine on the interface's own clock, and the interface's inputs are
read by it, so recordings land exactly on the beat.

- Input 1 (mic) and Input 2 (instrument/line) as separate mono sources; meters with the
  interface's own colours (green from −24 dBFS, amber from −6, red at 0).
- A one-time latency test (a cable from Output 1 to Input 2), plus a manual nudge.
- A hardware checklist before recording (48V, Air, INST, Direct Monitor), because no software can
  read those switches.

## 4. Live vocal sound

Every stage runs with no look-ahead, so it adds no delay to what you hear:
preamp colour → low cut → gate → mud cut → fast (FET) compressor → de-esser → smooth (opto)
compressor → presence and air → warmth → doubler → delay and reverb sends (ducked under the voice)
→ safety limiter. Takes are recorded dry; the sound can be changed afterwards.

Monitoring modes: **Hardware** (Direct Monitor on, dry) or **Hear my effects** (Direct Monitor off).

## 5. Loop recording

- Set the loop on the bar strip before recording (it is locked while recording).
- Record → a count-in (1 bar by default; none, 1, 2 or 4) with an accented click → the loop
  goes round; every pass is a new take, until Stop.
- One continuous file from the start of the count-in; sliced into Take 1, 2, 3 … after the
  latency shift. The last full take plays; tap through the others to pick; a short last pass is
  hidden but kept.
- You hear the song, the click and your live voice, never the old takes.

## 6. Projects on disk

A project is a folder on the PC: the song (sections, tracks, settings) and its recordings as WAV
files. Readable later by iPhone/iPad versions through iCloud Drive or OneDrive.
