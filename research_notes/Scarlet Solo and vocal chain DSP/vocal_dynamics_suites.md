# Vocal dynamics processors and all-in-one vocal suites (for a zero-lookahead live vocal chain)

Research note on method: search worked, but this session could fetch almost nothing. izotope.com, soundonsound.com, uaudio.com and josephnilo.com all failed DNS. The only page I read in full was iZotope's official Nectar 3 help (the printable version on iZotope's S3 download bucket). Everything else comes from search-result summaries of manufacturer manuals and reviews. Facts marked "(snippet)" were not checked against the full page. Formulas I give from Giannoulis/Massberg/Reiss and from standard DSP texts are written from knowledge of those publications, and are labelled that way.

## 1. iZotope Nectar (3 / 3 Plus / 4): modules, controls, Vocal Assistant, order, latency

### Takeaway
Nectar 4 is the current major version, as far as I could find. It came out on 6 September 2023 as part of Native Instruments Music Production Suite 6, in Elements, Standard and Advanced editions, and I found no Nectar 5 by November 2026. Most of its dynamics modules are ordinary feedforward designs, and you can copy their parameter ranges. The documented Nectar 3 compressor modes are a good template: Digital, Vintage, Optical at a fixed 4:1, and Solid-state at 4 to 12:1. The parts that bring big latency are pitch correction, harmony and Breath Control, which is built on RX. A KVR user saw about 194 ms reported for Nectar 3 with pitch processing.

### Cited Findings
**Release and editions**
- Nectar 4 was released in early September 2023. iZotope's blog post is dated 6 Sept 2023, and third-party news reported the release on 9 Sept 2023. It shipped with NI Music Production Suite 6, after iZotope joined Native Instruments in June 2023. Introductory prices were Advanced $224 (regular $299) and Standard $149 (regular $199) until 11 Oct 2023 (snippet) — [The Beat Community](https://thebeatcommunity.com/2023/09/09/izotope-release-nectar-4/); [MMR Magazine](https://mmrmagazine.com/article.php?id=85244); [iZotope "Why upgrade to Nectar 4"](https://www.izotope.com/en/learn/why-upgrade-to-nectar-4)
- There are three editions: Elements, Standard and Advanced. Elements includes the Vocal Assistant. Standard adds modules such as Audiolens referencing and Voices. Its listed modules are Compressor, De-esser, Delay, Dimension, EQ, Gate, Reverb, Saturation and Voices. Advanced adds Auto-Level, Backer, Pitch and Breath Control (Breath Control is "Advanced only"). Note: these listings come from resellers and the feature tables were garbled (snippet) — [Plugin Boutique Nectar 4 Standard](https://pluginboutique.com/products/11117-Nectar-4-Standard); [Native Instruments Nectar 4 Advanced](https://native-instruments.com/en/products/izotope/nectar-4-advanced)
- Modules new in Nectar 4: Auto-Level (for consistency), Voices (harmonic layers), Backer (background singer, best blended low under the lead), a new De-esser module, and Audiolens referencing (snippet) — [iZotope Nectar features](https://www.izotope.com/en/products/nectar/features); [Sound On Sound review](https://soundonsound.com/reviews/izotope-nectar-4-advanced); [Plugin Boutique](https://pluginboutique.com/products/11118)
- One reviewer says Nectar can sound "processed and dense" when you lean on presets, and that it is CPU-hungry when several instances run (snippet) — [Dubspot](https://blog.dubspot.com/it/plugins/nectar-4)

**Nectar 3 / 3 Plus module detail (official help)** — [Nectar 3 Help (print)](https://s3.amazonaws.com/izotopedownloads/docs/nectar300/en/print/index.html)
- **Vocal Assistant, what it analyses:** input level (it switches on ALM and sets input gain), vocal character, vocal register (from pitch), frequencies for subtractive EQ, sibilance, and output level.
- **Vocal Assistant, what it sets:** an EQ "character" curve, Dynamics, the Pitch module's vocal register, subtractive EQ bands, the De-esser cutoff and threshold, the Compressor settings, and a light Reverb mix.
- **Vocal Assistant, user controls:** "Vibes" (shapes the starting EQ and dynamics) and "Intensity" (how much processing). The help text I read does not list the values. It needs time to analyse, and clips shorter than 20 s should be looped. In Nectar 4 the DAW must be playing for analysis to work — [Nectar 3 VA help (JA)](https://s3.amazonaws.com/izotopedownloads/docs/nectar300/ja/vocal-assistant/index.html)
- **Unmask** (Plus): needs an IPC source (Relay, Nectar or Neutron) on the masking track and applies an EQ cut to that source. Plus adds Amount, Dynamic and Sidechain controls.
- **Breath Control:** this is the RX 8 Breath Control algorithm bundled in. It detects breaths and turns them down.
- **Pitch:** Vocal Register Low, Mid (default) or High. Scale by key (Chromatic, Major or Minor), Custom, or Auto Detect (Plus). Transpose ±12 st. Correction Strength. **Speed 0–200 ms.** Formant shift and scale. Reference A = 440 Hz. Melodyne 4 Essential is included. **Pitch is always the first module and cannot be moved.**
- **De-esser:** detection-filter cutoff **800 Hz – 8 kHz**, Threshold (the reduction depends on how far sibilance goes above threshold), and Listen (hear only what is removed). It is described as hardware-modelled and level-independent.
- **EQ (×2, up to 24 bands each):** Bell (Bell, Proportional Q, Vintage, Band Shelf); Low and High Shelf (Analog, Resonant, Vintage, Baxandall); HP and LP (Flat, Resonant). Frequency 20 Hz – 20 kHz, gain −30 to +15 dB. Each band can be dynamic in Gain mode (boost or cut above a threshold) or Frequency mode (follows the nearest harmonic).
- **Compressor (×2, in series):**
  - Digital: ratio 1:1–50:1, attack 0.1–300 ms, release 1–1200 ms.
  - Vintage: same ranges, with a program-dependent, non-linear release.
  - Optical: **fixed 4:1**, attack 1–100 ms, release 40–200 ms.
  - Solid-state: ratio 4:1–12:1, attack 0.2–80 ms, release 50–1200 ms.
  - Level detection Peak or RMS (RMS suggested for Optical, Peak for Solid-state). Threshold, Makeup, Auto Gain.
- **Gate:** separate Open and Close thresholds (hysteresis), Ratio, Attack, Release.
- **Saturation:** seven modes. Analog (mild, gritty, odd harmonics), Retro (sharp, odd), Tape (short harmonic slope), Tube (odd + even), Warm (subtle, even), Decimate (sample-rate reduction with aliasing), Distort. Amount, plus a post high-shelf on the wet signal only.
- **Dimension:** Chorus, Flanger or Phaser. Rate 0.01–4 Hz or tempo-synced, Depth 0–100 %, Width 0–100 %, Feedback, and Freq (Phaser only).
- **Delay:** Mono or Stereo, 1–3500 ms or synced, Feedback, saturation modes (Digital, Tape, Analog, Grunge, Echo), modulation (Rate and Depth), post HP and LP on the wet signal.
- **Reverb:** pre-delay 0–200 ms, decay 1–5 s, Width, Saturation, post HP, LP and bell on the wet signal.
- **Harmony:** up to 8 voices. Each voice has interval ±12, fine ±100 c, delay 0–100 ms, gain −20–0 dB and pan. Time and Pitch variation. MIDI mode.
- **Auto Level Mode (ALM):** an input-gain stage that moves gain toward a target based on input RMS, **only when the level is within 3 dB of target, and by at most ±3 dB.** The help does not give its speed.
- **Order:** modules are added in the last slot and can be dragged to reorder. Compressor and EQ can appear twice, everything else once. Each module has Enable, Solo, Remove and Mix (a parallel blend on every module). **The output limiter is a "brickwall, zero latency limiter" after the output gain.**

**Latency**
- Nectar 3 users on KVR report high latency when pitch tuning is on. One DAW showed 194 ms. They found no low-latency mode, and the DAW's low-latency mode just switched the plug-in off (forum, anecdotal) — [KVR forum](https://www.kvraudio.com/forum/viewtopic.php?p=7721761)
- Nectar 2 had a "Tracking Mode" that forced low-latency processing, using "less transparent processing" (snippet) — [Nectar 2 Delay Compensation help](https://help.izotope.com/nectar2/content/nectar%202%20help%20documentation/delay%20compensation.htm)

### Inferences
- A good live template is the Nectar 3 chain with Pitch removed: Gate → EQ1 (subtractive) → Compressor 1 (Solid-state or Digital, Peak) → De-esser → Compressor 2 (Optical, RMS, 4:1) → EQ2 (tone) → Saturation → Dimension → sends to Delay and Reverb → zero-latency limiter. Every one of these can be built as a causal IIR or sample-by-sample process with 0 samples of lookahead.
- The per-module "Mix" knob is a cheap way to get parallel ("NY") compression and parallel saturation. With no lookahead and only minimum-phase IIR filters, dry and wet stay time-aligned apart from small filter phase shifts.
- The ALM rule (±3 dB at most, only within 3 dB of target, RMS-based) is a safe pattern for a live "auto-level". It cannot pump a quiet passage up into feedback.
- The modules that bring latency are Pitch, Harmony/Voices/Backer (block-based pitch shifting), Breath Control (RX spectral detection) and probably the Frequency-mode dynamic EQ (harmonic tracking). For live use, leave them out or swap in the low-latency alternatives in section 8.

### Gaps
- I could not read the official Nectar 4 help (docs.izotope.com was not reachable). Missing: exact Nectar 4 compressor modes, the De-esser modes (Nectar 4 reportedly added split-band or wideband options; not verified), Auto-Level speed and range, Voices and Backer controls, the "styles" or Vibes list, and the default chain the Vocal Assistant builds.
- I found no per-module latency figures in any iZotope source.
- I found nothing about a Nectar 5 or a 2025–2026 update. Treat Nectar 4 as current, but this is not confirmed.

## 2. Waves CLA Vocals and other simplified vocal chains

### Takeaway
CLA Vocals has six faders, each with a three-way "colour" switch: Bass, Treble, Compress (Push, Spank or Wall), Reverb, Delay (tempo-synced) and Pitch (doubling or chorus). It shows that a one-knob-per-function design with a few voiced presets behind each knob works for vocals.

### Cited Findings
- Six processing faders: Bass, Treble, Compress, Reverb, Delay, Pitch. Each has a fader and colour selectors (snippet) — [B&H Waves CLA Vocals](https://www.bhphotovideo.com/c/product/845448-REG/Waves_CLVCLNA_CLA_Vocals_Vocal.html/overview); [Production Expert tutorial](https://www.production-expert.com/home-page/2017/8/15/free-tutorial-how-to-use-waves-cla-vocals-plug-in?format=amp)
- Compressor colours are Push, Spank or Wall, or bypass. A blog calls it a one-knob compressor with three flavours (snippet) — [Waves CLA Vocals explained (J. Nilo)](https://josephnilo.com/blog/waves-cla-vocals-explained/)
- Bass sets low-frequency gain (depth, proximity-effect control). Treble sets high-frequency gain. Reverb is the wet mix, with a colour switch between environments. Delay follows session BPM. Pitch is the wet mix of pitch-modulation doubling. Sources disagree on whether it is "chorusing/doubling" or a "stereo spreader" (snippet) — [Production Expert](https://www.production-expert.com/home-page/2017/8/15/free-tutorial-how-to-use-waves-cla-vocals-plug-in?format=amp); [Waves CLA Vocals user guide (mirror)](https://manualmachine.com/wavesaudio/clavocals/6482902-user-guide)

### Inferences
- How the controls could map to DSP: Bass is a low-shelf ±dB, with colour choosing the corner (for example sub, lower or upper). Treble is a high-shelf or presence bell, with colour choosing the corner. Compress is one macro that raises ratio and lowers threshold together, with colour choosing attack, release and knee: Push is gentle and slow-ish, Spank is fast-attack FET-like, Wall is limiting. Reverb and Delay are send levels with three presets. Pitch is a ±cents detuned short-delay doubler. These corner and time values are design choices, not published Waves figures.

### Gaps
- I could not confirm whether CLA Vocals has a de-esser, or its colour labels and frequencies, because the official Waves guide was not reachable.
- I found no sourced detail on Slate (for example Virtual Mix Rack vocal chains) or UAD channel-strip "simplified controls" mappings, apart from the FG-Stress note in section 5.

## 3. Teletronix LA-2A and modelling the T4 cell

### Takeaway
The LA-2A has an average attack of about 10 ms and a two-stage release. It recovers about 50 % in about 60 ms, then the rest over 1–15 s according to the original manual (0.5–5 s in UA's modern spec). The slow tail gets longer the more, and the longer, it has been compressing. That program dependence comes from the T4 cell (an electroluminescent panel driving a photoresistor), so model it as a two-time-constant envelope whose slow tail depends on history.

### Cited Findings
- The original Teletronix manual (quoted by UA) gives a release of "about 60 milliseconds for 50% release, and then a gradual release over a period of 1 to 15 seconds". Average attack is 10 ms (snippet) — [UA WebZine 2003](https://www.uaudio.com/webzine/2003/july/text/content4.html)
- UA's current spec: about 0.06 s for 50 % release, and 0.5 to 5 s for complete release "depending upon the amount of previous reduction". The Warm Audio WA-2A clone quotes 10 ms attack, 60 ms to 50 %, and 500 ms to 5 s or longer for full recovery (snippet) — [UA LA-2A spec via Mediacast](https://www.mediacastsys.com/universal-audio/la-2a.html); [Warm Audio WA-2A via zZounds](https://www.zzounds.com/item--WAUWA2A?siid=184382)
- The T4A was the original module. The T4B is a later version with a shorter canister and is used in the WA-2A, which can reach up to 40 dB of gain reduction (snippet) — [UA WebZine 2003](https://www.uaudio.com/webzine/2003/july/text/content4.html); [MusicTech WA-2A review](https://musictech.com/2016/10/wa-2a-optical-compressor-review/)
- Attack and release are not fixed. They "emerge from the physical properties of the optical components". The release is slower when compression is heavy and/or the signal has been over threshold for a long time (snippet) — [LWMR wiki: Teletronix LA-2A](https://tuttopassastudios.github.io/LWMR-wiki/Gear/Compressors/Teletronix-LA-2A)

### Inferences (modelling recipe, my design, not from a source)
- Detector: rectified or RMS side-chain → "panel brightness" L(t) with a fast rise of about 10 ms and the same fast fall. The cell's conductance G(t) follows L through two parallel states:
  - a fast state, τ about 60–90 ms, carrying about 50 % of the weight;
  - a slow state, τ_slow about 0.5–5 s, that charges only while gain reduction is high. Raise τ_slow, or the slow state's weight, with an integrator of recent gain reduction (a "memory" variable). This reproduces "60 ms to 50 %, then seconds".
- Gain = 1/(1 + k·G) style soft curve. That gives the soft, ratio-free knee: about 3:1 in Compress, about 10:1 or more in Limit. Limit can be done by adding part of the side-chain pre-emphasis and a harder curve.
- Colour: a light even-order (tube-like) waveshaper on the output, with drive tied to the output gain knob.
- Zero lookahead: a 10 ms attack means peaks pass. Put a fast peak stage (the 1176-style stage below, or a soft clipper) before or after it.

### Gaps
- I could not get primary measurements of the T4 cell (CdS photoresistor rise and decay curves) or the LA-2A's THD figures. The ratio values (about 3:1 Compress, about ∞ Limit) are widely quoted, but I could not verify them against a primary source this session.

## 4. UREI / UA 1176 (FET)

### Takeaway
The 1176 has a 20–800 µs attack, a 50 ms–1.1 s release, ratios of 4, 8, 12 and 20:1, and the "all-buttons" (British) mode, which sharply increases distortion. The knobs run backwards: higher numbers mean faster. Because it is fast enough to catch peaks without lookahead, it suits the first stage of a serial vocal chain ahead of a slower opto stage.

### Cited Findings
- Attack goes from "a lightning-fast, 20 microsecond attack time to a fast 800 microseconds". Release runs from 50 ms at the fastest to 1.1 s at the slowest. Turning the knobs toward higher values shortens the times — [UA 1176 Classic FET Compressor Manual](https://help.uaudio.com/hc/en-us/articles/34530260482324-1176-Classic-FET-Compressor-Manual); [UA 1176 history](https://www.uaudio.com/blog/analog-obsession-1176-history)
- Setting attack and release to their fastest adds distortion, "especially pronounced in all-buttons mode". In all-buttons ("British") mode, "compression distortion increases radically" — [UA 1176 tips](https://www.uaudio.com/blogs/ua/1176-collection-tips); [UA 1176 manual](https://help.uaudio.com/hc/en-us/articles/34530260482324-1176-Classic-FET-Compressor-Manual)
- The original 1176LN manual (ratios 4, 8, 12, 20) — [1176LN manual PDF](https://c3.zzounds.com/media/1176LN_manual-1a90c9dff91ec30316551923e877c4d0.pdf)

### Inferences
- How to model it: a feedback-style peak detector with attack 20–800 µs and release 50 ms–1.1 s, with program-dependent release (faster recovery from short peaks). Fast attack plus fast release lets the envelope follow single waveform cycles, which is where the low-frequency distortion comes from. Add a light odd/even FET waveshaper.
- All-buttons mode: raise the ratio toward about 20:1 or more, add a "knee overshoot" (more gain reduction at moderate levels) and more distortion. These values are design choices, not published.
- Why 1176 then LA-2A on vocals: the FET catches fast peaks (consonants, shouts) with 3–6 dB of reduction, so the slow opto can level the phrase evenly (another 2–4 dB) without being driven by transients. This is common engineering lore; I did not get a direct source citation this session.

### Gaps
- I did not fetch primary THD figures, the exact program-dependent release law, or the all-buttons transfer curve.

## 5. Empirical Labs Distressor

### Takeaway
The Distressor's ratios are 1:1 (saturation only), 2, 3, 4, 6, 10 (Opto), 20 and Nuke (brickwall). It has two distortion emphases: Dist 2 (2nd harmonic) and Dist 3 (3rd harmonic, tape-like). The 10:1 Opto mode uses separate detector circuitry and can release over up to 20 s.

### Cited Findings
- Ratios are 1:1, 2:1, 3:1, 4:1, 6:1, 10:1, 20:1 and Nuke. 1:1 gives saturation or warmth with no compression. Nuke is a brickwall limiting curve — [Distressor manual (barryrudolph.com)](https://www.barryrudolph.com/recall/manuals/distressor1.pdf); [UA EL8 Distressor manual](https://help.uaudio.com/hc/en-us/articles/18741515014676-Empirical-Labs-EL8-Distressor-Manual)
- 10:1 is the "Opto" ratio. Separate detector circuitry is switched in, and release extends up to 20 s in 10:1 opto mode (snippet) — [EL-8 manual (manualsdir p.10–11)](https://www.manualsdir.com/manuals/674530/empirical-labs-el-8.html?page=10)
- Dist 2 (yellow LED) emphasises the 2nd harmonic. Dist 3 (red LED) emphasises the 3rd and is "more similar to tape". Slate's FG-Stress emulation says the two cannot be on at the same time (that is the plug-in; not verified for hardware) — [EL-8 manual p.11](https://www.manualsdir.com/manuals/674530/empirical-labs-el-8.html?page=11); [Slate FG-Stress docs](https://docs.slatedigital.com/VMR/FG-Stress.html)
- Community suggestion for an optical feel: attack 10, release 0, detector HP on (community source) — [LWMR wiki: Distressor](https://tuttopassastudios.github.io/LWMR-wiki/Gear/Compressors/Empirical-Labs-Distressor)

### Gaps
- Exact attack and release ranges in ms, the detector HPF corner, and the "band emphasis" side-chain EQ were not extracted.

## 6. Compressor design for DSP (zero lookahead)

### Takeaway
Use a feedforward, log-domain design: level detector (peak or RMS) → static gain computer with a quadratic soft knee → smoothing in the gain domain ("smooth decoupled" or branching peak detector) → make-up gain. This is the structure Giannoulis, Massberg and Reiss (JAES 2012) recommend. All of it is causal, adds 0 samples of latency, and lets you vary attack and release per stage to imitate FET and opto behaviour.

### Cited Findings
- Paper: D. Giannoulis, M. Massberg, J. D. Reiss, "Digital Dynamic Range Compressor Design—A Tutorial and Analysis", JAES vol. 60 no. 6, pp. 399–408, 2012. It treats compressors as nonlinear systems with memory, and the source code and audio examples are published — [AES E-Library 16354](https://www.aes.org/e-lib/browse.cfm?elib=16354); [academia.edu copy](https://www.academia.edu/31481096/Digital_Dynamic_Range_Compressor_Design_A_Tutorial_and_Analysis)
- A typical feedforward DRC is a chain of modules starting with a level detector. Libraries implement "configurable knee curves and envelope following methods" — [vocal.com DRC principles](https://vocal.com/voice-quality-enhancement/dynamic-range-compression-principles-practical-implementation/); [diffFx compressor source](https://difffx-pytorch.readthedocs.io/en/latest/_modules/diffFx_pytorch/processors/dynamics/compressor.html); [Faust compressors.lib](https://sources.debian.org/src/faust/2.30.5~ds0-2/libraries/compressors.lib); [MathWorks Dynamic Range Control](https://www.mathworks.com/help/audio/ug/dynamic-range-control.html)

**Formulas from the paper.** These are written from knowledge of the paper; I could not open the full text this session, so check them against the AES PDF.
- **Gain computer, soft knee.** Threshold T, ratio R and knee width W, all in dB, with input x_G in dB:
  - if 2(x_G − T) < −W, then y_G = x_G
  - if 2|x_G − T| ≤ W, then y_G = x_G + (1/R − 1)(x_G − T + W/2)² / (2W)
  - if 2(x_G − T) > W, then y_G = T + (x_G − T)/R
  - The gain-reduction control signal is x_L = x_G − y_G.
- **Coefficients:** α = exp(−1/(τ·fs)). The paper defines time constant τ as the time to reach 1 − 1/e, about 63 %. Some definitions use 10 %→90 %, with τ scaled by about 2.2.
- **Smooth branching peak detector**, operating on x_L:
  - if x_L[n] > y_L[n−1]: y_L[n] = α_A·y_L[n−1] + (1 − α_A)·x_L[n]
  - otherwise: y_L[n] = α_R·y_L[n−1] + (1 − α_R)·x_L[n]
- **Smooth decoupled detector:**
  - y1[n] = max(x_L[n], α_R·y1[n−1] + (1 − α_R)·x_L[n])
  - y_L[n] = α_A·y_L[n−1] + (1 − α_A)·y1[n]
  - The paper favours log-domain, post-gain-computer smoothing with the smooth branching or decoupled detector for artefact-free results. Feedback topologies cannot do an exact soft knee or very fast attack, and their effective ratio is limited.
- **Make-up gain:** the paper's auto make-up compensates for the gain reduction at 0 dBFS, M = −y_G(0 dB).

### Inferences (practical recipe for the live chain)
- **Feedforward vs feedback:** use feedforward, because it is exact, stable and allows any ratio. Emulate the "feedback" sound of the 1176 or LA-2A by running the detector on the output, y[n−1]. That is causal, with one sample of delay. Alternatively, shape the attack and release curves.
- **Peak vs RMS:** use a peak detector, i.e. the branching detector above, for the FET-style stage. Use RMS, a one-pole on x² with τ about 5–30 ms followed by a log, for the opto or leveling stage. Nectar suggests the same split.
- **Program-dependent release:**
  - (a) Two-stage release: y = max(fast-release branch, slow-release branch), or a weighted sum.
  - (b) Release time that scales with how long or how deeply gain reduction has been held (LA-2A memory).
  - (c) "Auto-release" that blends τ_R between 50 ms and 1 s based on crest factor.
- **Without lookahead,** overshoots of about 1–3 ms are unavoidable with any attack longer than about 0.1 ms. Catch them with a final zero-latency soft clipper or limiter, e.g. tanh or cubic, with ≥2× oversampling. Note that polyphase IIR halfband oversampling adds well under 1 ms of latency, but a linear-phase FIR does not.
- **Parallel (NY) compression:** dry plus a heavily compressed copy (e.g. 10:1, fast attack, about 10 dB GR) mixed at −10 to −6 dB. Keep both paths minimum-phase and equal-latency.
- **Serial compression on vocals:** two gentle stages, each doing 3–6 dB of GR, sound more natural than one stage doing 10 dB. FET peak stage first, then opto leveler (sections 3 and 4).

### Gaps
- I did not get exact text from Pirkle, Zölzer (DAFX) or Reiss and McPherson's "Audio Effects" this session. Their RMS-detector and program-dependent-release variants are not cited here.

## 7. De-esser, gate/expander, breath control, auto-level

### Takeaway
Split-band (dynamic-EQ-style) de-essing is the usual transparent default. Sibilance sits at about 4–7 kHz for male voices and about 7–10 kHz for female and child voices. A band-passed side-chain with a fast peak detector, about 0.1–1 ms attack, works without lookahead; the first ~1 ms of an "s" leaks, but sibilants build up over tens of ms. A gate needs separate open and close thresholds (hysteresis), as in Nectar. Auto-level should be gentle and limited in range (Nectar ALM: ±3 dB at most, RMS-based).

### Cited Findings
- Wideband de-essing lowers the whole signal when sibilance is detected. Split-band lowers only the problem range. Split-band is the more transparent default, though some engineers prefer wideband because it keeps EQ behaviour predictable, and it can sound more natural on full mixes — [Unison: What is a de-esser](https://unison.audio/what-is-a-de-esser/); [eMastered de-esser](https://emastered.com/blog/what-is-a-de-esser); [Violet Recording](https://violetrecording.com/what-is-a-de-esser/)
- Male voices sibilate lower, at about 4–7 kHz (other sources say 5–6 or 6–7 kHz). Female and child voices sibilate at about 7–10 kHz. Overall the range is about 4–10 kHz, and the exact peak depends on singer, mic and room. Sweep with a Listen/solo function, because the wrong frequency dulls the vocal without fixing the "s" — [Unison: De-essing](https://unison.audio/de-essing/); [Violet Recording: how to de-ess](https://violetrecording.com/blog/how-to-de-ess-vocals/); [Headliner Hub](https://headlinerhub.com/how-to-de-ess-vocals.html)
- Nectar 3's de-esser: detection cutoff 800 Hz–8 kHz, threshold-relative reduction, Listen — [Nectar 3 Help](https://s3.amazonaws.com/izotopedownloads/docs/nectar300/en/print/index.html)
- Nectar's gate uses separate Open and Close thresholds to reduce chatter, plus Ratio (depth), Attack and Release. Nectar's ALM changes input gain by at most ±3 dB, only within 3 dB of target, based on RMS — [Nectar 3 Help](https://s3.amazonaws.com/izotopedownloads/docs/nectar300/en/print/index.html)
- Breath Control in Nectar is RX 8's breath detector, a detection-based spectral process — [Nectar 3 Help](https://s3.amazonaws.com/izotopedownloads/docs/nectar300/en/print/index.html)

### Inferences (zero-lookahead designs)
- **De-esser:**
  - Side-chain: a 2nd-order band-pass, or a high-pass at about 4–5 kHz, centred about 6 kHz (male) or 8 kHz (female).
  - Compare side-chain energy with full-band energy (a ratio or "relative" detector). This makes the de-esser level-independent, as Nectar describes, and stops it triggering on loud bright vowels.
  - Detector: peak, attack 0.1–0.5 ms, release 30–80 ms.
  - Action: a dynamic high-shelf or bell (split-band), up to −6 to −10 dB.
  - Split-band filtering: avoid FIR crossovers. Use a complementary pair, low = x − high, with an IIR high-pass, or a dynamic peaking or shelving biquad whose gain is modulated. Both are 0-latency.
- **Gate/expander:**
  - Use downward expansion (ratio 1:2–1:4, range 6–15 dB) instead of a hard gate, to avoid chopping word tails.
  - Open threshold about 4–6 dB above close threshold, attack 0.5–2 ms, hold 20–80 ms, release 100–250 ms.
  - Put a high-pass filter (about 100 Hz) in the side-chain.
- **Breath control without spectral analysis:** an expander keyed on a "breathiness" feature. Breaths are broadband noise with little low-mid energy and no pitch. One option: when the level is low and spectral flatness or zero-crossing rate is high, reduce gain by 6–10 dB. This runs in a few ms of buffered analysis, so apply it with a short attack and accept a slight onset leak.
- **Vocal riding / auto level:** a slow RMS (τ about 200–500 ms) toward a target, gain limited to about ±6 dB, frozen when the signal is below a noise floor (so it does not lift breaths or room noise). Use the Nectar ALM ±3 dB idea as a safe default for live monitoring.

### Gaps
- I found no authoritative source giving numeric de-esser attack and release defaults, or describing Waves Vocal Rider's algorithm.

## 8. Low-latency pitch correction and doubling/"Dimension"

### Takeaway
Live pitch correction can be done in principle, but not inside a 2 ms budget with high quality. UAD Auto-Tune Realtime's Classic mode is the best-documented low figure at 1–2 ms extra at 44.1 kHz. Modern mode adds 4–7 ms. Antares does not publish a figure for Auto-Tune 2026's Low Latency mode. Doubling, chorus and Dimension effects (short modulated delays) add no latency and fit the budget.

### Cited Findings
- UAD Auto-Tune Realtime: "Classic Mode has the lowest latency, with 1–2 ms of additional latency at 44.1 kHz". Modern Mode adds 4–7 ms. This latency is not compensated by the DAW or UAD Console (snippet) — [UA help: Considerations with Auto-Tune](https://help.uaudio.com/hc/en-us/articles/43460658366612)
- Auto-Tune 2026 has HQ and Low Latency modes. Antares notes that latency is reported correctly only while Input Monitoring is enabled. There is a known bug where Low Latency mode does not engage or appears inverted in EFX+/Pro X (snippet) — [Antares: Incorrect latency numbers in AutoTune 2026](https://help.antarestech.com/hc/en-us/articles/47422439594132-Incorrect-Latency-Numbers-Reported-in-AutoTune-2026); [Antares: Low Latency Mode not working](https://help.antarestech.com/hc/en-us/articles/47201781644948-Low-Latency-Mode-Not-Working); [Antares blog: low latency monitoring](https://www.antarestech.com/blog/low-latency-monitoring-in-daws-what-it-is-and-why-it-matters)
- Slate MetaTune has a latency FAQ (content not extracted) — [Slate MetaTune Latency FAQ](https://support.slatedigital.com/hc/en-us/articles/4410723092115-MetaTune-Latency-FAQs)
- Nectar 3 Dimension is chorus, flanger or phaser with rate 0.01–4 Hz, depth, width and feedback. Nectar 3 Harmony voices add 0–100 ms delay per voice and ±100 c fine detune. A KVR user saw about 194 ms with Nectar 3 pitch processing — [Nectar 3 Help](https://s3.amazonaws.com/izotopedownloads/docs/nectar300/en/print/index.html); [KVR forum](https://www.kvraudio.com/forum/viewtopic.php?p=7721761)

### Inferences
- **Why pitch correction costs latency:** a pitch detector needs at least one period of the lowest note (80 Hz is 12.5 ms) to be confident. Classic-mode low latency is possible because it uses a time-domain, PSOLA- or resampling-style shifter whose correction is applied to the current grain from a pitch estimate that lags. Only the shifter's own buffer, about 1–2 ms, adds latency. For this app, offer pitch correction only as an "off by default, adds ~2–5 ms" option, or not at all for monitoring.
- **"Dimension" or doubler at zero latency:**
  - 2–4 voices of delay lines at 8–30 ms (the dry signal still comes through at 0 ms), each modulated ±0.5–2 ms by slow (0.1–1 Hz) random or sine LFOs. That modulation produces a micro pitch shift of about ±5–15 cents.
  - Pan the voices L and R and high-pass them at about 150 Hz.
  - This is the classic micro-shift and ADT recipe. Only the wet copy is delayed, so monitoring latency is still 0.

### Gaps
- I found no official Antares millisecond figure for the Auto-Tune 2026 Low Latency mode, and did not extract the MetaTune figure.

## 9. Typical vocal chain order and settings

### Takeaway
The engineer-standard order, also reflected in how Nectar is built:
HPF 80–100 Hz → subtractive EQ (200–500 Hz mud, harsh resonances) → fast FET compressor (peaks) → de-esser → opto leveler → tone EQ (presence 3–5 kHz, air shelf 10–12 kHz) → saturation → sends to delay and reverb (pre-filtered) → safety limiter.
The FET-then-opto pairing and de-esser placement are widely recommended. I could not fetch interview sources this session, so the specific figures below are engineering convention, not cited quotations.

### Cited Findings
- Nectar's architecture follows this flow: Pitch is fixed first; two EQs and two serial compressors; De-esser; Saturation; Dimension, Delay and Reverb with wet-only post filters; a zero-latency brickwall limiter at the output. The Vocal Assistant sets subtractive EQ, de-esser, compressor and a "subtle" reverb mix — [Nectar 3 Help](https://s3.amazonaws.com/izotopedownloads/docs/nectar300/en/print/index.html)
- CLA Vocals collapses the chain into Bass, Treble, Compress, Reverb, Delay and Pitch, in that order on the panel — [Production Expert](https://www.production-expert.com/home-page/2017/8/15/free-tutorial-how-to-use-waves-cla-vocals-plug-in?format=amp)
- The 1176 and LA-2A behaviour that justifies FET-before-opto (fast µs attack vs ~10 ms attack and a slow, program-dependent release) — [UA 1176 manual](https://help.uaudio.com/hc/en-us/articles/34530260482324-1176-Classic-FET-Compressor-Manual); [UA WebZine LA-2A](https://www.uaudio.com/webzine/2003/july/text/content4.html)

### Inferences (suggested live defaults; all 0-lookahead, minimum-phase)
1. HPF, 2nd–4th order, 80 Hz (male) to 100 Hz (female).
2. Expander: threshold about −50 dBFS, 1:2, range 10 dB, with hysteresis.
3. Subtractive bell: −2 to −4 dB around 250–400 Hz, Q about 1.5.
4. FET stage: peak detection, attack about 0.2–0.8 ms, release about 60–150 ms, 4:1, soft knee 6 dB, 3–5 dB GR.
5. De-esser: 6 kHz (male) or 8 kHz (female), relative detection, up to −8 dB split-band.
6. Opto stage: RMS detection, about 10 ms attack, 60 ms plus a 1–3 s two-stage release, about 3:1, 2–4 dB GR.
7. Tone EQ: presence +2 to +3 dB at 3–5 kHz, air shelf +2 to +3 dB at 10–12 kHz.
8. Saturation: about 5–15 % "warm" even-order.
9. Doubler or Dimension: optional.
10. Sends: slap delay of 80–120 ms or 1/8 note, HP 200 Hz and LP 6 kHz on the return; plate or hall of 1.2–2 s with 20–40 ms pre-delay, wet-only filters.
11. Output: zero-latency soft-clip limiter at −1 dBFS.

Total added latency: 0 samples, apart from optional IIR oversampling of a fraction of 1 ms. This fits the <2 ms budget.

### Gaps
- No Sound On Sound or mix-engineer interview quotes could be fetched (the site was unreachable), so the specific numeric conventions above (HPF 80–100 Hz, 200–500 Hz cut, 3–5 kHz presence, 10–12 kHz air) are uncited and should be treated as common practice, not sourced fact.

---

## Verification pass (Nov 2026): corrections and confirmations

- **Nectar 4 manual [read]** — [Nectar 4 Help](https://docs.izotope.com/nectar4/en/print/index.html):
  - modules: "EQ, Auto-Level, Breath Control, Backer, Pitch, Compressor, Voices, De-Esser, Saturation, Reverb, Gate, Delay, and Dimension";
  - output limiter: "a brickwall, zero latency limiter".
  - Compressor modes and ranges are identical to Nectar 3: Digital and Vintage 1:1–50:1, 0.1–300 ms attack, 1–1200 ms release; Optical fixed 4:1, 1–100 ms attack, 40–200 ms release; Solid-State 4:1–12:1, 0.2–80 ms attack, 50–1200 ms release; RMS advised for Optical and Peak for Solid-State.
- **Correction / clarification (de-esser):** in Nectar 4 the 800 Hz–8 kHz value is the "lower frequency boundary for the detection filter frequency band". When triggered, "the De-esser will apply reduction to the entire bandwidth of the incoming signal". That makes it wideband reduction with level-independent detection, not split-band.
- **Added (Nectar 4 Auto-Level, ALM):**
  - Learn (sets an RMS target), Target, Mix, Tame Noise, Listen and Strength (speed);
  - Range: "a setting of 6 decibels will limit the amount of leveling to a maximum of +6 or -6 dB", with 12 "extreme" and 1 "subtle";
  - side-chain mode.
- **iZotope product page [read]:** Nectar 4 is still current in Nov 2026. Voices and Backer are in Standard and Advanced; ALM, the 13 component plug-ins and the Breath Control plug-in are Advanced only. The release date (6 Sep 2023) is still [excerpt]. — [iZotope Nectar features](https://www.izotope.com/en/products/nectar/features)
- **LA-2A [read]:**
  - UA spec: "Attack Time 10 milliseconds"; "0.06 seconds for 50% release; 0.5 to 5 seconds for complete release". — [UA LA-2A product page](https://www.uaudio.com/products/teletronix-la-2a-classic-leveling-amplifier)
  - UA article: ratio "roughly 3:1", attack 10 ms, "about 60 milliseconds for 50% of the release, and anywhere from 1 to 15 seconds for the rest". — [UA LA-2A tips & tricks](https://www.uaudio.com/blogs/ua/la-2a-collection-tips-tricks)
  - The UA WebZine 2003 URL now returns 404.
- **1176 [read]:** attack 20–800 µs; release 50 ms–1.1 s; ratios 4:1 and 8:1 for compression, 12:1 and 20:1 for limiting. In "All Buttons In", "distortion increases, along with a plateaued slope and a lag time in response to initial transients". help.uaudio.com (the plug-in manual) was refused. — [UA 1176LN product page](https://www.uaudio.com/products/1176ln-classic-limiting-amplifier)
- **Giannoulis/Massberg/Reiss:** still [recall]. The AES E-Library is paywalled, and the open copies (QMUL, academia.edu, university mirrors) are on hosts this session cannot reach.
- **KVR Nectar 3 194 ms report:** still [excerpt]. kvraudio.com serves a Cloudflare challenge.
