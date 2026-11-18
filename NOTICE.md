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

Product and company names above are those of their owners and are used only to say where a
design comes from. M-Theory is not affiliated with or endorsed by any of them.

