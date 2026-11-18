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

The synth (`src/synth/`) is written for this project. It is modelled on the Yamaha reface CS,
and these informed it; where numbers or methods were taken they are used under their licences,
with thanks to their authors:

- The reface CS's controls, their ranges and what Texture and Mod do for each oscillator, as
  transcribed from Yamaha's data list in **reface-cs-live** by harpomaxx (MIT), **cs-control** by
  cfenell (GPL-3.0) and the **pencilresearch/midi** tables (facts only) (`params.ts`).
- Band-limited oscillators after the PolyBLEP idea of Välimäki and Huovilainen ("Antialiasing
  oscillators in subtractive synthesis", 2007) and **PolyBLEP** by Tale, ported by Martin Finke
  (zlib); here with a four-point kernel from the cubic B-spline (`kernel.ts`).
- The supersaw: Adam Szabo, "How to Emulate the Super Saw" (KTH, 2010): the detune curve, the
  seven saws' offsets and the mix curves, as published in a SuperCollider transcription (numbers
  only) and in the supersaw of the **Deluge firmware** by Synthstrom Audible (GPL-3.0-or-later).
- **VCV Rack**'s Fundamental VCO by Andrew Belt (GPL-3.0-or-later): the 9th-order polynomial sine.
- Vadim Zavalishin, *The Art of VA Filter Design*: the zero-delay-feedback (topology-preserving)
  ladder; **Vital** by Matt Tytel (GPL-3.0): where the ladder's input saturation sits, and running
  the filter at twice the sample rate; **HIIR** by Laurent de Soras (WTFPL): the half-band
  filters (the same coefficients as the vocal chain's `os.rs`).
- **OB-Xf** by the Surge Synth Team, the successor of OB-Xd (GPL-3.0-or-later): the
  analogue envelope that aims past the top, glide as an RC circuit on pitch, last-note priority
  and stealing the oldest voice; **Surge XT** and its **sst-basic-blocks** (GPL-3.0-or-later):
  the slow random drift of pitch.
- **Dexed** and its engine **MSFA** (GPL-3.0 / Apache-2.0): FM as phase modulation (method only).
- Parker, Zavalishin and Le Bivic, "Reducing the aliasing of nonlinear waveshaping using
  continuous-time convolution" (DAFx 2016), as used in **chowdsp_utils** by Jatin Chowdhury
  (GPL-3.0): the first-order anti-aliased distortion.
- **Odin 2** by TheWaveWarden (GPL-3.0) and the **Faust** libraries (STK and LGPL with
  exception): the ranges of the chorus, flanger, phaser and delay (numbers as reference), and
  Odin 2's crawl arpeggio.
- Jot and Chaigne, and Stautner and Puckette: the feedback-delay-network reverb.
- **Drone Machine π** by Kalitragus (GPL-3.0): the idea of a drone as a few slightly detuned layers
  that slowly wander (`play.ts`).
- The preset recipes are this project's own, informed by decoded factory sounds of **Surge XT**
  (GPL-3.0) and **Helm** by Matt Tytel (presets CC BY 4.0); no preset was copied value for value.
- The idea of one knob moving many (the macros) after the "SuperKnob" of the refaceCS web editor
  by sterudo (idea only; no code) and the macro sources of Surge XT and Vital.
- ITU-R BS.1770: the loudness measure the presets were levelled with (`measure.ts`).

The piano and the electric piano (`src/keys/`, `public/keys/`, `scripts/piano-pack.py`,
`scripts/epiano-pack.py`):

- **Salamander Grand Piano V3** by Alexander Holm, mapped to SFZ by kinwie
  (<https://github.com/sfzinstruments/SalamanderGrandPiano>), licensed under **CC BY 3.0**
  (<https://creativecommons.org/licenses/by/3.0/>). The piano's recordings in
  `public/keys/piano/` are derived from it: 30 keys at 5 of its 16 velocity layers and its
  string-resonance release samples, trimmed, faded, level-matched and encoded as MP3. This
  instrument is derived from the SFZ instrument in that repository. Its mapping also gave the
  numbers for the damper sounds (their level against the note, how much quieter they get the
  longer a note was held) and which keys have no dampers. The full licence and the list of
  changes are in `public/keys/piano/LICENSE.md`.
- **mda ePiano** by Paul Kellett (MIT, or GPL-2.0-or-later): the electric piano's sample table
  (`public/keys/epiano/tines.bin`, unchanged) and its whole design, ported to Web Audio nodes:
  key groups and their loops, the loop crossfade, the velocity curve, decay and release, the
  stereo spread, the treble control and the tremolo / autopan (`tines.ts`, `epiano.ts`).
  Copyright (c) 2008 Paul Kellett; the MIT notice is in `public/keys/epiano/LICENSE.md`.
- **smplr** by danigb (MIT): the shape of the sampler (one source and gain per note, notes cut
  with a short fade when voices run out, releases faded from wherever the note has got to, only
  the recordings a song needs loaded before a bounce). No code was copied.
- Loudness is measured with the K-weighting and gating of **ITU-R BS.1770**.

Product and company names above are those of their owners and are used only to say where a
design comes from. M-Theory is not affiliated with or endorsed by any of them.

