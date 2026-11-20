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
  drag constants) (`strokes.ts`).
- **libmypaint** and **mypaint-brushes** (ISC; brush files CC0): how touches overlap along a
  stroke, how a brush's size and weight vary from touch to touch, and how spatter sizes are
  spread (`strokes.ts`).
- **Krita**'s bristle brush (GPL-2.0-or-later) and **p5.brush** by Alejandro Campos (MIT): a
  brush that runs dry hair by hair; pressure that never jumps (`strokes.ts`, `sim.ts`).
- **Harmony**, the procedural drawing tool by Mr.doob (GPL-3.0-or-later): its "ribbon" brush
  (strands each chasing the pointer on a damped spring: the voice's ribbon) and its "sketchy"
  brush (links drawn between nearby points of two paths, only their middles: the hatching
  between a harmony line and the melody) (`strokes.ts`).
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
- **librosa** (ISC, Copyright (c) 2013--2026, librosa development team): harmonic/percussive
  separation by median filtering with soft masks and margins (after Fitzgerald, DAFx 2010, and
  Driedger, Müller and Disch, ISMIR 2014); the REPET-SIM vocal separation of its examples
  (after Rafii and Pardo, 2012); CENS chroma and the tonnetz coordinates (`split.ts`,
  `vibe.ts`).
- **Real-Time-HPSS** by Sevag Hanssian (MIT): the sizes of the two median filters and the
  sliding (real-time) form of the separation (`split.ts`). **nussl** by the Interactive Audio
  Lab (MIT): how REPET-SIM chooses the moments it compares (`split.ts`).
- **Musly** by Dominik Schnitzer (MPL-2.0): the mel scale and the mel-cepstrum as a measure of
  timbre, leaving out the first coefficient (loudness); formulas only, the code is new
  (`ear.ts`, `vibe.ts`).
- **rp_extract** by TU Wien (GPL-3.0): the fluctuation-strength weighting of how loudness swings
  (strongest at 4 Hz) (`vibe.ts`).
- Formulas only, no code: **essentia** (AGPL-3.0) for danceability by detrended fluctuation
  analysis (Streich and Herrera), how far loudness strays (dynamic complexity) and octave-band
  spectral contrast; **MIRtoolbox** (GPL-2.0) for Plomp and Levelt's roughness curve and which
  way its emotion measures lean (`vibe.ts`).
- **fieldplay** by Andrei Kashcha (MIT) and Pardesco's generative-art notes: particles carried by
  a field with no sinks (the curl of a noise) (`place.ts`). Hertzmann's painterly rendering, as
  in **PyPainterly** (GPL-3.0), and **ofxOilPaint** by Javier Graciá Carpio: paint only where
  the canvas still differs from what is wanted, and stop where it is already painted (the
  coverage budget, `coverage.ts`).

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
  black key sits, its width and its height (`keyfaces.ts`).
- **Open Music Theory** (v1, CC BY-SA 4.0): the species-counterpoint rules, applied chords and
  modal mixture, re-implemented as tests and costs. None of its text is used.
- **dycon**, **hrep**, **har18** and **incon** (pmcharrison, MIT, Copyright (c) 2018 Peter M. C.
  Harrison): the Sethares and Hutchinson–Knopoff roughness formulas, the harmonic-tone defaults,
  the harmonicity method and the combined consonance model, ported to TypeScript
  (`src/theory/consonance.ts`). The MIT licence text is in `THIRD_PARTY_NOTICES.md`.
- **music21j** (cuthbertLab, BSD-3-Clause, Copyright (c) 2013–2026 Michael Scott Asato Cuthbert):
  the definitions of hidden and parallel motion and of crossing used in the line search
  (`src/theory/lines.ts`).
- **harmony** (ekzhang, BSD-3-Clause, Copyright (c) 2020 Eric Zhang): the voice-leading weights of
  its voicing search (the top voice's move squared, parallels), used for chord layers
  (`src/theory/layers.ts`).
- **rl-musician** (Nikolay Lysenko, MIT, Copyright (c) 2019): the line rules a leap answered by a
  step back and runs of leaps (`src/theory/lines.ts`).
- The low-interval limits follow common arranging tables, read as strictly as they disagree.

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

## Sources named in the documentation

The README describes where the app's numbers, patterns and colours come from without naming
products or publications; these are the sources it refers to.

**The harp, the playing styles and the effects** (`src/audio/`). The numbers and patterns were collected from published acoustics research, teaching material and audio-engineering references. The session that gathered them could read search-result excerpts of these pages, not always the full text, so treat the list as where to look rather than as a guarantee that every figure was checked against the original.

- Harp acoustics: Chadefaux, Le Carrou et al., *Experimentally based description of harp plucking* (JASA 2012); Le Carrou, Gautier et al. on the concert harp's soundboard and sound-hole modes and on sympathetic strings; Woodhouse, *Euphonics* (string damping, plucked-string synthesis); Waltham's harp chapters and ASA papers; UNSW Music Acoustics (harp); the Vienna Symphonic Library's harp notes; Sound On Sound, *Synthesizing plucked strings*.
- Playing styles: Wikipedia (Strum, Carter Family picking, Tresillo, Clave, Ska stroke, Banjo roll); guitar lesson sites (rhythmguitar.org, justinguitar, andyguitar, Fender, MusicRadar, Guitar World, Premier Guitar, Classical Guitar Magazine, jazzguitar.be); the Giuliani right-hand studies; harp accompaniment guides (myharpsdelight.com, harpmastery, Harp Column).
- Effects: J. O. Smith, *Physical Audio Signal Processing* (flanging and phasing); Valhalla DSP's notes on reverb types, shimmer and echo; Sound On Sound technique articles; the Web Audio API documentation (MDN); circuit analyses of classic overdrive, chorus and phaser pedals.

**The drum sounds** (`src/audio/drums.ts`): circuit studies of the TR-808; the Mutable
Instruments Plaits source (MIT); Perry Cook's PhISEM shaker models; Sound On Sound's "Synth
Secrets" series.

**The canvas's colour schemes** (`src/canvas/palettes.ts`). The *Screens* schemes are, in order,
Solarized, Nord, Gruvbox, Dracula, Catppuccin, Rosé Pine, Tokyo Night and Kanagawa; *Highway* is
the Outrun base16 scheme and *Synthwave* is SynthWave '84; *Stencil* is Risograph inks; the
*Loved* palettes are from COLOURlovers; *Lily pond*, *Woodblock*, *Wave* and *Dusk* are from
MetBrewer. Each keeps its project's values; the names in the app are this project's own.

**Credits.** The *Loved* palettes were made by members of COLOURlovers and are credited here as that site asks: "Giant Goldfish" by manekineko, "(◕〝◕)" and "(◕ ” ◕)" by sugar!, "Thought Provoking" by Miss_Anthropy, "cheer up emo kid" by electrikmonk, "let them eat cake" by lunalein, "Terra?" by GlueStudio, "Ocean Five" by DESIGNJUNKEE. Some of those palettes are shared for non-commercial use only: fine for a personal app, worth a second look if the app is ever sold. Two top-ranked palettes whose maker asks to be contacted first were left out. *Lily pond*, *Woodblock*, *Wave* and *Dusk* are from the MetBrewer palettes; *Kasane* from the Nippon Colors list; *Riso* from the riso-colors list; the Screens and Glow schemes from their own projects.

Hex values were read from each project's own files where the session could reach them (the first list), and from search-result excerpts of the pages otherwise (the second). Pigments have no single correct screen colour: the values used are the commonly published approximations.

Read directly:

- [nice-color-palettes](https://raw.githubusercontent.com/Jam3/nice-color-palettes/master/100.json): the top-loved COLOURlovers palettes
- [MetBrewer](https://raw.githubusercontent.com/BlakeRMills/MetBrewer/main/R/PaletteCode.R): palettes sampled from works in a museum collection
- [nippon-colors](https://registry.npmjs.org/nippon-colors/-/nippon-colors-1.0.0.tgz): 250 traditional Japanese colours
- [riso-colors](https://raw.githubusercontent.com/mattdesl/riso-colors/master/riso-colors.json): Risograph inks
- [color-names](https://raw.githubusercontent.com/codebrainz/color-names/master/output/colors.csv): the named colours (pigments, harvest gold, avocado …)
- [chromotome](https://raw.githubusercontent.com/kgolid/chromotome/master/readme.md): how palettes for generative art are built
- [Nord](https://raw.githubusercontent.com/nordtheme/nord/develop/src/nord.css), [Solarized](https://raw.githubusercontent.com/altercation/solarized/master/README.md), [Dracula](https://raw.githubusercontent.com/dracula/dracula-theme/master/README.md), [Gruvbox](https://raw.githubusercontent.com/morhetz/gruvbox/master/colors/gruvbox.vim), [Catppuccin](https://raw.githubusercontent.com/catppuccin/palette/main/palette.json), [Rosé Pine](https://raw.githubusercontent.com/rose-pine/palette/main/palette.json), [Tokyo Night](https://raw.githubusercontent.com/folke/tokyonight.nvim/main/lua/tokyonight/colors/storm.lua), [Kanagawa](https://raw.githubusercontent.com/rebelot/kanagawa.nvim/master/lua/kanagawa/colors.lua)
- [SynthWave '84](https://raw.githubusercontent.com/robb0wen/synthwave-vscode/master/themes/synthwave-color-theme.json), [Outrun](https://raw.githubusercontent.com/tinted-theming/schemes/spec-0.11/base16/outrun-dark.yaml)

Seen as search excerpts only:

- [COLOURlovers, most loved of all time](https://www.colourlovers.com/palettes) and its palette pages (ranks, love counts, makers)
- [Winsor & Newton oil colours as screen colours](https://color-term.com/winsornewton-colors) (a third party's conversion, not the maker's)
- [The four-colour portrait palette](https://www.naturalpigments.com/zorn-palette.html)
- [Vaporwave palette](https://www.color-hex.com/color-palette/10221)
- [Bauhaus](https://digitalheroes.co.in/styles/bauhaus-revival/), [Art Deco](https://www.eggradients.com/palette/art-deco), [mid-century](https://madegooddesigns.com/retro-color-palettes/) and [Memphis](https://newretro.net/blogs/main/80s-color-palette-hex-codes) approximations
- [Working with color in generative art](https://www.tylerxhobbs.com/words/working-with-color-in-generative-art)

Product and company names above are those of their owners and are used only to say where a
design comes from. M-Theory is not affiliated with or endorsed by any of them.

