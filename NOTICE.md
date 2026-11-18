# M-Theory

Copyright (C) 2026 the M-Theory author.

M-Theory is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3 of
the License, or (at your option) any later version. See `LICENSE`.

It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even
the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

## The name and the logo

The GPL covers the code. It does not give anyone the right to use the name "M-Theory" or its
logo for their own app. A changed copy must be renamed and must not look like it comes from
this project.

## Updates

Official builds are signed. The app installs an update only if it carries this project's
signature, so a copy built by someone else cannot update your installed app.

## Third-party parts

The Windows app talks to audio interfaces through Steinberg's ASIO SDK, used under its GPLv3
option. ASIO is a trademark of Steinberg Media Technologies GmbH.

The vocal chain (`src-tauri/src/`) is written in Rust for this project. Several of its parts
are ports or re-implementations of open-source audio code, used under their licences, with
thanks to their authors:

- **Airwindows** by Chris Johnson (MIT): PurestDrive, Tube and Tube2, Channel9, ToTape6,
  Weave, the Spiral and Mojo curves (`color.rs`, `delays.rs`). Copyright (c) airwindows.
- **freeverb3** by Teru Kamogashira, as shipped in **Dragonfly Reverb** by Michael Willis
  (GPL-2.0-or-later / GPL-3.0-or-later): the "zrev2" hall network, its delay and all-pass
  lengths, and the early-reflection tap pattern (`space.rs`); "progenitor2", the room, with
  its tables, tap positions and decay law (`room.rs`; its source credits David Griesinger for
  the design it follows); "nrevb", the chamber, with its comb and all-pass lengths
  (`chamber.rs`). The hall builds on **zita-rev1** by Fons Adriaensen (GPL-2.0-or-later).
- **Cloud Seed** by Valdemar Erlingsson, **Ghost Note Audio** (CloudSeedCore, MIT): the
  design of the cloud, its random-number generator and its "Dark Plate" program (`cloud.rs`).
  Copyright (c) Ghost Note Audio.
- **Jon Dattorro**, "Effect Design, Part 1" (J. Audio Eng. Soc., 1997): the plate (`dsp.rs`).
  Its shimmer follows "Oliverb" in **Parasites** by Matthias Puech (MIT), built on the
  reverb of **Mutable Instruments Clouds** by Émilie Gillet (MIT).
- The spring reverb of **Surge XT** and **BYOD** by Jatin Chowdhury (GPL-3.0-or-later),
  itself based loosely on Välimäki, Parker and Abel, "Parametric Spring Reverberation Effect"
  (J. Audio Eng. Soc., 2010) (`spring.rs`).
- **safety-limiter** by Nathan Ho (public domain): the hold-and-release law of the output
  limiter; its attack time is that of **stmlib** by Émilie Gillet (MIT) (`dsp.rs`).
- The de-esser's ratio and knee and the gate's ratio and knee are those of the **Calf Studio
  Gear** de-esser and gate (LGPL); the gate's hold, release and two thresholds follow the
  gates of **OBS Studio** and **LSP Plugins**. No code was taken from these: only the
  numbers (`dsp.rs`).
- **HIIR** by Laurent de Soras (WTFPL): the half-band oversampling filter structure and
  designer that produced its coefficients (`os.rs`).
- **Surge XT** (GPL-3.0-or-later) and **Jatin Chowdhury**'s exciter in it: the exciter
  (`color.rs`); Surge's delay and **Cocoa Delay** by Andrew Minnich (MIT) informed the echo
  loop (`delays.rs`).
- **Squeezer** by Martin Zuther (GPL-3.0-or-later): the law of the optical gain stage
  (`dsp.rs`).
- **Luftikus** by lkjb (MIT) for the idea of the air band; **Martin Vicanek**, "Matched Second
  Order Digital Filters" (2016) for the analog-matched bell (`eqm.rs`).
- Measurements of the Juno-60 chorus published with **junox** by Andy Harman
  (GPL-3.0-or-later) (`width.rs`).

The canvas (`src/canvas/`, `src/listen/`) is written for this project. These informed it, and
where numbers or methods were taken they are used under their licences, with thanks:

- **ink-stroke-modeler** by Google (Apache-2.0): the spring a brush tip follows (its mass and
  drag constants) (`hand.ts`).
- **libmypaint** and **mypaint-brushes** (ISC; brush files CC0): how touches overlap along a
  stroke, how a brush's size and weight vary from touch to touch, and how spatter sizes are
  spread (`hand.ts`).
- **Krita**'s bristle brush (GPL-2.0-or-later) and **p5.brush** by Alejandro Campos (MIT): a
  brush that runs dry hair by hair; pressure that never jumps (`hand.ts`, `sim.ts`).
- **Fluid Paint** by David Li (MIT) and **WebGL Fluid Simulation** by Pavel Dobryakov (MIT):
  wet paint as a heavily damped flow on the graphics card, lit by its own thickness (`sim.ts`).
- Curtis, Anderson, Seims, Fleischer and Salesin, "Computer-Generated Watercolor" (1997), as
  transcribed in open ports: pigment settling as water is lost, more in the hollows of the
  paper; washes that dry from their edges (`sim.ts`).
- **spectral.js** by Ronald van Wijnen (MIT) and Kubelka and Munk's theory: mixing colours by
  what they absorb and scatter (here on three channels) (`sim.ts`).
- **aubio** (GPL-3.0-or-later), **librosa** (ISC) and **madmom** (BSD-2-Clause): the shape of
  the hit detector (the rise of a log-frequency spectrum, picked against what has been usual);
  McAulay and Quatieri's partial tracking: following each tone from frame to frame (`ear.ts`).
- Krumhansl and Kessler's key profiles: hearing the key (`mood.ts`).

The harmony engine and piano voicings (`src/theory/harmonize.ts`, `src/keys/`) and the keyboard
diagram (`src/ui/components/KeyboardDiagram.tsx`) are written for this project. Rules, numbers
and small routines were taken from these, used under their licences, with thanks:

- **Contrapunk** by Contrapunk Audio (MIT, Copyright (c) 2026 Contrapunk Audio): the ladder an
  outside note falls down when it is harmonised (the parallel modes searched in order of
  distance, then consonant intervals in its order), its voice registers, and the scoring ideas
  of its contrary-motion and counterpoint modes (`harmonize.ts`, `voicing.ts`).
- **music21** (cuthbertLab, BSD-3-Clause): the parallel fifths and octaves test (compound and
  contrary forms included) and the motion types (`harmonize.ts`, `voicing.ts`).
- **jazzband** (felixroos, ISC): voice-leading distance as the sum of semitones moved, the
  required and optional notes of a chord (the 3rd and 7th needed, the root and 5th not) and the
  available-tension rule behind the avoid notes (`harmonize.ts`, `voicing.ts`).
- **tonal.js** (tonaljs, MIT): the voicing shapes and the default comping range (`voicing.ts`).
- **harmony-ts** (Apache-2.0): the melodic intervals a line must not take, the augmented second
  among them (`harmonize.ts`).
- **Impro-Visor** (GPL-2.0-or-later): the left- and right-hand ranges, the hand span and the
  weight of a held note against a moving one (`voicing.ts`).
- **react-piano** (kevinsqi, MIT, Copyright (c) 2018): the keyboard's geometry: where each
  black key sits, its width and its height (`keyboard.ts`).
- **Open Music Theory** (v1, CC BY-SA 4.0): the species-counterpoint rules, applied chords and
  modal mixture, re-implemented as tests and costs. None of its text is used.
- The low-interval limits follow common arranging tables, read as strictly as they disagree.

Product and company names above are those of their owners and are used only to say where a
design comes from. M-Theory is not affiliated with or endorsed by any of them.

