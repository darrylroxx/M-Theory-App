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

Neural stems (`src-tauri/src/stems.rs` and `src-tauri/src/stems/`, `src/listen/neuralstems.ts`)
are written for this project. The network and the runtime that runs it are **not part of the
app or its installer, and M-Theory does not redistribute them**: the desktop app downloads them
only when its user asks, from their publishers' own addresses (written in the app, over HTTPS),
checks each against its SHA-256 and keeps them in its local data folder. With thanks to their
authors:

- **Demucs** (Hybrid Transformer Demucs, v4) by Meta Platforms, Inc. (code under the MIT
  licence, "Copyright (c) Meta Platforms, Inc."): the network that splits a song into stems, and
  the way a song is cut into 7.8-second stretches, a quarter overlapping and cross-faded. Its
  trained weights carry no licence text of their own. They were trained on the MUSDB18-HQ set,
  whose tracks are licensed for non-commercial research (some under CC BY-NC-SA), and on further
  songs of its authors'; whether such terms reach a network trained on them is not settled.
  That is one more reason the weights are fetched by the user's own app for the user's own use,
  never shipped with M-Theory.
- **demucs-onnx** by StemSplit (MIT): the ONNX export of that network the app downloads, from
  its Hugging Face repositories `StemSplitio/htdemucs-onnx` (four stems,
  `htdemucs_fp16weights.onnx`) and `StemSplitio/htdemucs-6s-onnx` (six stems,
  `htdemucs_6s_fp16weights.onnx`), whose exports its README describes as MIT-licensed. Its
  interface is followed here: input `mix` (one 7.8-second stereo stretch at 44.1 kHz), output
  `stems` in Demucs's order (drums, bass, other, vocals, then guitar and piano). The file is
  checked against the SHA-256 Hugging Face states for it over its own secure connection (no
  other server's word is taken), and that value, the address and the repository's revision are
  kept beside it (`<model>.onnx.json`).
- **ONNX Runtime** by Microsoft (MIT licence, "Copyright (c) Microsoft Corporation"): runs the
  network. Downloaded on request from Microsoft's own package on the Python Package Index
  (`onnxruntime-directml` 1.24.4 on Windows, whose SHA-256 is pinned in the app); its licence and
  third-party notices are unpacked beside it (`LICENSE.txt`, `ThirdPartyNotices.txt`).
- **DirectML** by Microsoft (`DirectML.dll`, in the same package): runs the network on the
  graphics card. It is not open source: it is Microsoft's library under Microsoft's own licence
  terms for DirectML (published with its `Microsoft.AI.DirectML` package). M-Theory does not
  distribute it; the app fetches it, unchanged, from Microsoft's own package when its user asks.
  Anyone who wants to ship it with a program must follow those terms.
- Microsoft's **Visual C++ Redistributable** (x64), which ONNX Runtime needs on Windows, is not
  downloaded or shipped either: the app only checks that the computer has a recent enough one
  and says so if it does not.
- **ort** by pyke.io (MIT OR Apache-2.0): the Rust binding through which the app opens ONNX
  Runtime. It is built into the app; ONNX Runtime itself is never linked in, only opened at run time.
- **Symphonia** (MPL-2.0): reading MP3, FLAC, OGG Vorbis, M4A (AAC, ALAC) and WAV files. It is
  used unmodified, as a library; its source is at https://github.com/pdeljanov/Symphonia.
- **zip** (MIT) and **sha2** (MIT OR Apache-2.0): unpacking the runtime's package and checking
  downloads.
- **stem-splitter-core** by Gentrit Jashari (MIT OR Apache-2.0) was studied for how a Rust
  program can fetch, check and run this model; none of its code is used.
- Julius O. Smith III's description of band-limited interpolation ("Digital Audio Resampling"),
  with a Kaiser window: how a song's sample rate is changed to the network's and back. No code
  was taken.

The stems are made from the user's own file, on the user's own computer, for the user's own
study and painting. Rights in the original recording are not changed by splitting it.

Product and company names above are those of their owners and are used only to say where a
design comes from. M-Theory is not affiliated with or endorsed by any of them.

