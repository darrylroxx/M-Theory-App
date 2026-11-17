# Vocal reverbs, delays and modulation effects: algorithms and parameters for a real-time Rust build

Research conditions, so the report writer knows how far to trust this: in this session the network blocked ccrma.stanford.edu (the Dattorro PDF and JOS's PASP book), dsprelated.com (the PASP mirror), signalsmith-audio.co.uk, valhalladsp.com and kaseypocius.github.io. Neither WebFetch nor curl could reach them. These notes therefore rely on:
- **Source code I read directly** from raw.githubusercontent.com: Valley Audio "Plateau" (a Dattorro implementation), Jezar's Freeverb `tuning.h`, `freeverb-rs`, and Signalsmith's own ADC 2021 example code.
- **Web-search snippets** for everything else (EMT, Lexicon, RE-201, Dimension D, H3000, Valhalla). These are search-engine summaries, not full pages I read myself.

Values I remember but could not check against a source are marked **[unverified recall]** and kept in Gaps or Inferences.

---

## 1. EMT 140 plate: decay range, frequency response, damping, why vocalists love it, and how plate algorithms model it

### Takeaway
The EMT 140 is a large steel plate driven by a transducer. A movable felt damper sets the decay, from short up to about 5 s undamped. Highs decay faster than lows at every setting. Its dense, fast-building, slightly bright and "zingy" tail with no discrete early reflections is why it sits so well on vocals. Digital "plate" algorithms copy it with very high diffusion, no room-like early reflections, a fast echo-density build-up and a high-frequency damping filter inside the loop.

### Cited Findings
- EMT (Elektromesstechnik, Germany) introduced the 140 in 1957 as the first plate reverb. — [UA: Origins of EMT Reverb](https://www.uaudio.com/blogs/ua/emt-reverb-history); [Vintage King: history of reverb](https://vintageking.com/blog/the-history-of-reverb/)
- Damping is a felt pad that moves toward the plate. The closer the pad, the shorter the reverb, and the pad never touches the plate. The undamped maximum is about 5 s. — [Vintage King: replicating plate reverb](https://vintageking.com/blogs/guitar/replicating-plate-reverb) (search summary)
- An older translated technical text gives the undamped decay as "about 5 seconds at 500 cps", comparable to an empty stone hall or church. — search-result summary of [vintagedigital.com.au](https://vintagedigital.com.au/?p=144376) / EMT material (secondary, translated)
- The Soundtoys Little Plate manual says that at every decay setting, high frequencies fade faster than lows. iZotope's Nectar docs say damping changes decay time unevenly across frequency. — [Little Plate manual (Scribd)](https://www.scribd.com/document/693711338/Little-Plate-Manual); [iZotope Nectar 2 Reverb module](https://help.izotope.com/nectar2/content/nectar%202%20help%20documentation/reverb%20module.htm)
- Sound On Sound (Paul White) says plate emulations work particularly well on vocals and were used on "virtually all the classic records in the '60s and '70s". His typical vocal setting is a plate with about 1.2 s decay and 60–80 ms pre-delay. — [SOS: Choosing the right reverb](https://www.soundonsound.com/techniques/choosing-right-reverb)
- The later EMT 250/251 added features, and the 251 extended the frequency response. — search summary of [UA EMT history](https://www.uaudio.com/blog/emt-reverb-history/)
- Dattorro's 1997 paper is the standard algorithmic "plate". Valhalla notes that the paper gives complete delay lengths and coefficients and that many plugins recreate it exactly. A Reaktor "Standard Issue Plate" implementation rescales Dattorro's times from 29,761 Hz to 48 kHz. — [Valhalla: Getting Started With Reverb Design Pt 2](https://valhalladsp.com/2021/09/22/getting-started-with-reverb-design-part-2-the-foundations/) (snippet); [NI Reaktor User Library: Standard Issue Plate](https://www.native-instruments.com/en/reaktor-community/reaktor-user-library/entry/show/15657) (snippet)
- There is physical-model research on plate reverberation (finite-difference plate simulation) by Stefan Bilbao. — [Bilbao, Plate Reverberation page](https://www2.ph.ed.ac.uk/~sbilbao/platerevpage.htm) (link only, not read)

### Inferences
- For a vocal plate in Rust, a Dattorro-style tank (section 3) is the established choice. Map "decay" to the tank gain and "damping" to the in-loop one-pole lowpass, so highs decay faster than lows, as on the hardware.
- No measured frequency curve of the 140 was found. A plausible return EQ is a high-pass around 100–200 Hz and a low-pass or shelf around 6–10 kHz. This comes from common mixing practice, not a measured spec.
- The plate has no discrete early reflections and a fast density build-up. That is probably why it flatters vocals: the tail blends in without the slapback cues of a room. Pre-delay then separates the dry vocal from the bloom.

### Gaps
- No measured EMT 140 frequency response or RT60-versus-frequency curve per damper setting was found. Vendor pages are promotional.
- The UA/Plate-140 plugin manuals were not opened, so their exact damper-position-to-RT60 table is missing.

---

## 2. Lexicon 224 / 480L: tank modulation ("chorus"), Hall/Plate programs, what makes them lush, reverse engineering

### Takeaway
Much of the Lexicon lushness comes from time-varying (randomly modulated) delays in the reverb tank. These smear the modal resonances so a long tail doesn't ring metallically. The 480L "Random Hall" family exposes this as **Spin** and **Wander**. Valhalla's Sean Costello says the old units modulated far more than any real room would, and the modulation source also added to their noise and grit. No authoritative published topology of the 224 or 480L tank was found.

### Cited Findings
- The 480L "Random" algorithm is like the Reverb algorithm plus random delay elements, which produce its "long and otherworldly" tails. **Spin** and **Wander** give its modulated, swimmy sound. — [UA Lexicon 480L product page](https://www.uaudio.com/products/lexicon-480l-digital-reverb-effects) (snippet); [UA 480L manual](https://help.uaudio.com/hc/en-us/articles/33194625601044-Lexicon-480L-Digital-Reverb-and-Effects-Manual)
- The 224 introduced split (bass/mid) decay, which the 480L kept. The 480L added randomization algorithms to reduce metallic ringing. — [Recording Magazine review of UA 480L](https://www.recordingmag.com/resources/featured-reviews/universal-audio-lexicon-480l/) (snippet)
- The 224's input stage used transformers and early 12-bit gain-stepping converters. — search summary of [Mix: UAD Lexicon 480L review](https://www.mixonline.com/technology/review-universal-audio-uad-lexicon-480l-plug-in) / [Recording Mag](https://recordingmag.com/?p=7746)
- Valhalla, "Modulation in reverbs: reality and unreality": the modulation depth in the old units "goes far beyond what can be heard in any 'real world' acoustic space". — [Valhalla DSP](https://valhalladsp.com/?p=1563) (snippet)
- Valhalla, "Algorithmic reverbs, distortion and noise": the modulation source in older Lexicons "had a lot more to do with the noise performance" than Costello first thought. — [Valhalla DSP](https://valhalladsp.com/2011/07/07/algorithmic-reverbs-distortion-and-noise/) (snippet)
- Valhalla, "Reverbs: diffusion, allpass delays, and metallic artifacts": recommends modulating allpass delay lengths, which reduces coloration in longer allpasses. Schroeder's 1962 short series allpasses are the starting point. — [Valhalla DSP](https://valhalladsp.com/?p=647) (snippet)
- A Lexicon 480L manual PDF is mirrored at freeverb3. — [freeverb3 docs](https://freeverb3-vst.sourceforge.io/doc/Lexicon/lexicon_480l.pdf) (not opened)

### Inferences
- To get a "Lexicon-like" vocal hall or plate in Rust:
  1. Modulate the delay *within* the tank (allpass or delay read positions) with slow, smoothed-random or multi-phase LFOs, not one shared sine.
  2. Use 2–3 band decay (split bass/mid decay, plus a high cut).
  3. Use interpolated reads, as in section 8.
- Spin probably equals modulation rate and Wander modulation depth. That matches how the control names are generally understood, but no Lexicon document confirmed it.

### Gaps
- No verified reverse engineering (block diagram, delay lengths, modulation rates) of the 224 or 480L tank was found. Costello's blog posts on Lexicon-style reverbs could not be opened.
- The UA manual's actual Spin/Wander ranges (Hz and ms) were not read.

---

## 3. Dattorro 1997 "Effect Design Part 1" plate: topology, delay lengths at 29,761 Hz, coefficients, rescaling, tank modulation

### Takeaway
The topology is: input band-limiting one-pole → pre-delay → 4 series input-diffusion allpasses → a "figure-8" tank of two cross-coupled halves. Each half is a modulated allpass → long delay → damping lowpass → decay gain → a second allpass → a second long delay → decay gain, which then feeds the *other* half.

Output is built from 7 signed taps per channel, read from inside the tank. All lengths are in samples at 29,761 Hz. Multiply by fs/29,761 to rescale (×1.4818 at 44.1 kHz, ×1.6128 at 48 kHz).

The lengths and signs below were confirmed from Valley Audio's Plateau source code and from a course implementation's tap list. The paper's own coefficient values could not be read here.

### Cited Findings
**Sample rate and scaling**
- Reference rate: `dattorroSampleRate = 29761.0`. Plateau scales every length by `sampleRate / dattorroSampleRate`. — [Plateau Dattorro.hpp (main)](https://github.com/ValleyAudio/ValleyRackFree/blob/main/src/Plateau/Dattorro.hpp); [Plateau Dattorro.cpp](https://github.com/ValleyAudio/ValleyRackFree/blob/main/src/Plateau/Dattorro.cpp)

**Delay and allpass lengths**
- Input diffuser allpass lengths in Plateau: **141, 107, 379, 277**. The first two use coefficient `inputDiffusion1`, the last two `inputDiffusion2`. — [Plateau Dattorro.hpp (master)](https://github.com/ValleyAudio/ValleyRackFree/blob/master/src/Plateau/Dattorro.hpp)
- Tank, left half: modulated allpass **672**, delay **4453**, allpass **1800**, delay **3720**. Right half: modulated allpass **908**, delay **4217**, allpass **2656**, delay **3163**. — [Plateau Dattorro.hpp (main)](https://github.com/ValleyAudio/ValleyRackFree/blob/main/src/Plateau/Dattorro.hpp)

**Tank wiring**
- In Plateau's `process()`:
  - `leftSum = rightDelay2.output * decay` and `rightSum = leftDelay2.output * decay`. This is the figure-8 cross-feed.
  - The first tank allpass in each half uses gain **−plateDiffusion1**, the second **+plateDiffusion2**.
  - The input to the second allpass is (delay1 output through the damping filter) × decay.
  - The tank is fed from the pre-delayed, input-diffused signal. — [Plateau Dattorro.cpp](https://github.com/ValleyAudio/ValleyRackFree/blob/main/src/Plateau/Dattorro.cpp)

**Output taps**
- One output (Plateau's "left") sums:

  | Sign | Source | Tap |
  |---|---|---|
  | + | same-side first allpass output | – |
  | + | Delay1 | 266 |
  | + | Delay1 | 2974 |
  | − | Apf2's internal delay | 1913 |
  | + | Delay2 | 1996 |
  | − | opposite Delay1 | 1990 |
  | − | opposite Apf2 | 187 |
  | − | opposite Delay2 | 1066 |

  Plateau uses the same tap positions for both outputs and scales the result by 0.5. — [Plateau Dattorro.cpp](https://github.com/ValleyAudio/ValleyRackFree/blob/main/src/Plateau/Dattorro.cpp); [Dattorro.hpp (master) `_kLeftTaps == _kRightTaps`](https://github.com/ValleyAudio/ValleyRackFree/blob/master/src/Plateau/Dattorro.hpp)
- A McGill MUMT618 implementation uses the 14-tap list `{266, 2974, 1913, 1996, 1990, 187, 1066, 353, 3627, 1228, 2673, 2111, 335, 121}`. The last seven feed the **other** output, also scaled by **0.6**, with the same + + − + − − − sign pattern. So the paper's second output uses different taps from Plateau's. — [kaseypocius MUMT618-DREV "how"](https://kaseypocius.github.io/MUMT618-DREV/how) (search snippet only; page blocked)

**Modulation and other details**
- Plateau's tank modulation: max excursion **16 samples** at 29,761 Hz, scaled like every other length. That is about 0.54 ms, or about 24 samples at 44.1 kHz and 26 at 48 kHz. The four LFOs run at **0.10, 0.15, 0.12, 0.18 Hz** with phases 0, 0.25, 0.5, 0.75. All four tank allpasses are modulated in Plateau. — [Plateau Dattorro.hpp/.cpp](https://github.com/ValleyAudio/ValleyRackFree/blob/main/src/Plateau/Dattorro.hpp)
- Plateau caps diffusion at 0.7 (`maxDiffusion1/2 = 0.7`). It adds 20 Hz DC blockers on input and output, and uses a crossfade for freeze. — same source
- CAPS "Plate" (Debian) cites the September 1997 JAES paper but notes its delay lengths are "fiddled with". Its right output uses 12 taps with a different arrangement. — [Debian CAPS Reverb.cc](https://sources.debian.org/src/caps/0.9.26-1/Reverb.cc/) (snippet)
- SpinCAD has an intro to the Dattorro structure. — [Holy City Audio SpinCAD: Intro to the Dattorro reverb structure](https://holy-city-audio.gitbook.io/spincad-designer/design-concepts/intro-to-the-dattorro-reverb-structure) (not opened)

**Lengths rescaled** (computed from the values above; ms = samples / 29,761):

| Element | @29,761 | ms | @44.1k | @48k |
|---|---|---|---|---|
| in AP1 (142 per paper [unverified recall]; Plateau 141) | 142 / 141 | 4.77 | 210 / 209 | 229 / 227 |
| in AP2 | 107 | 3.60 | 159 | 173 |
| in AP3 | 379 | 12.73 | 562 | 611 |
| in AP4 | 277 | 9.31 | 410 | 447 |
| L mod AP | 672 | 22.58 | 996 | 1084 |
| L delay 1 | 4453 | 149.63 | 6598 | 7182 |
| L AP 2 | 1800 | 60.48 | 2667 | 2903 |
| L delay 2 | 3720 | 125.00 | 5512 | 6000 |
| R mod AP | 908 | 30.51 | 1345 | 1464 |
| R delay 1 | 4217 | 141.70 | 6249 | 6801 |
| R AP 2 | 2656 | 89.24 | 3936 | 4284 |
| R delay 2 | 3163 | 106.28 | 4687 | 5101 |
| excursion | 16 | 0.54 | 24 | 26 |

Output taps rescaled:

| Output | @29,761 | @44.1k | @48k |
|---|---|---|---|
| Output A | 266, 2974, 1913, 1996, 1990, 187, 1066 | 394, 4407, 2835, 2958, 2949, 277, 1580 | 429, 4797, 3085, 3219, 3210, 302, 1719 |
| Output B (MUMT618) | 353, 3627, 1228, 2673, 2111, 335, 121 | 523, 5375, 1820, 3961, 3128, 496, 179 | 569, 5850, 1981, 4311, 3405, 540, 195 |

### Inferences
- **Rescaling.** Use fractional lengths with interpolation, or round to integers (rounding is fine for the fixed delays). Keep the modulated allpasses on fractional, interpolated reads. Scaling everything by fs/29,761 keeps the same time-domain behaviour; the paper's coefficients do not need to change.
- **Size control.** Plateau's "timeScale" multiplies all tank lengths. That is a cheap "size" control for a vocal plate: smaller for tight pop vocals, larger for ballads.
- **Allpass tap point.** A tap "inside an allpass" is a read from that allpass's internal delay line, not from its output. Implement allpasses as explicit delay buffers so these taps can be read.
- **CPU cost.** The structure is stereo-out from mono-in, about 12 delay lines in total. It costs very little: well under 1% of one modern core at 48 kHz, so it suits live use.

### Gaps
- **Paper coefficients [unverified recall; check against the PDF].**

  | Parameter | Value |
  |---|---|
  | decay | 0.50 |
  | bandwidth (input one-pole) | 0.9995 |
  | damping (in-tank one-pole) | 0.0005 |
  | input diffusion 1 | 0.750 |
  | input diffusion 2 | 0.625 |
  | decay diffusion 1 | 0.70 |
  | decay diffusion 2 | clamp(decay + 0.15, 0.25, 0.50) |
  | output gain | 0.6 per tap |

  The 0.6 output gain is corroborated by the MUMT618 snippet; the other values are not.
- The paper's LFO rate and waveform for EXCURSION (recalled as about 1 Hz sine on the two decay-diffusion-1 allpasses only) could not be checked. Plateau's 0.10–0.18 Hz, 4-LFO scheme is Plateau's own choice.
- Whether the first input allpass is 142 or 141 is unresolved. Plateau uses 141; 142 is commonly cited, but I could not verify it.
- The paper's guidance on allpass interpolation for the modulated lines (Part 2 of the paper deals with chorus, flanger and vibrato) was not read.

---

## 4. FDNs (Jot/Chaigne), mixing matrices, delay-length choice, frequency-dependent decay, modulation; Freeverb and Signalsmith baselines

### Takeaway
An FDN is N delay lines whose outputs are mixed by a lossless (orthogonal or unitary) matrix and fed back with a per-line gain or absorption filter. Jot's method sets each line's loss from its length and the target RT60, so all modes decay at the same rate per band. A "tonal correction" filter then evens out the spectrum.

Signalsmith's ADC 2021 design is a clean modern template: 8 channels, a 4-step Hadamard diffuser with random delays and polarity flips, then a Householder-mixed feedback loop with lengths spread exponentially over one octave. Freeverb is the 8-comb + 4-allpass Schroeder/Moorer baseline.

### Cited Findings
**Jot / JOS**
- Jot developed a systematic FDN design that sets reverberation time in different frequency bands largely independently. JOS calls it among the best choices for high-quality artificial reverb. Jot's "tonal correction" filter equalises modal energy whatever the per-band RT. — [JOS PASP: FDN Reverberation (dsprelated mirror)](https://www.dsprelated.com/freebooks/pasp/FDN_Reverberation.html) (search snippet; page blocked)

**Signalsmith "Let's Write a Reverb" (ADC 2021), read directly from the code**
- **Diffusion step:** 8 channels. Each channel gets a random delay inside its own sub-range of `delayMsRange` (channel c in [range·c/N, range·(c+1)/N)). The step mixes with a **Hadamard** matrix, then flips polarity on a random subset of channels.
- **Diffuser:** `DiffuserHalfLengths` chains 4 steps whose ranges halve each step, starting from half the room size. An equal-lengths variant also exists.
- **Feedback loop:** 8 delays spread **exponentially** between `delayMs` and `2·delayMs` (`delay_c = 2^(c/N)·base`). The loop mixes with a **Householder** matrix and multiplies by `decayGain`.
- **RT60 mapping:** `typicalLoopMs = roomSizeMs·1.5`; `loopsPerRt60 = rt60 / typicalLoop`; `dbPerCycle = −60 / loopsPerRt60`; `decayGain = 10^(dbPerCycle/20)`. Default `delayMs` is 150 ms, and the diffusion range default is 50 ms.
- **Output:** dry/wet mix of the multichannel output.
- Source for all of the above: [Signalsmith reverb-example-code.h](https://github.com/Signalsmith-Audio/reverb-example-code/blob/main/reverb-example-code.h); [README](https://github.com/Signalsmith-Audio/reverb-example-code)

**Freeverb (Jezar, 2000, public domain)**
- Structure: 8 parallel lowpass-feedback combs and 4 series allpasses per channel.
  - Comb lengths L: **1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617**.
  - Allpass lengths: **556, 441, 341, 225**.
  - The right channel adds **stereospread = 23** samples to every length.
  - Parameters: `fixedgain = 0.015` (input gain), `scalewet = 3`, `scaledry = 2`, `scaledamp = 0.4`, `scaleroom = 0.28`, `offsetroom = 0.7`. So comb feedback = room·0.28 + 0.7, which is 0.84 at room = 0.5.
  - [sinshu/freeverb tuning.h](https://github.com/sinshu/freeverb/blob/master/Components/tuning.h)
- Lengths are tuned at 44.1 kHz. `freeverb-rs` rescales with `length·sr/44100`. Its comb runs a one-pole lowpass in the loop: `filter_state = out·(1−damp) + filter_state·damp; write(input + filter_state·feedback)`. Stereo width is a wet cross-mix: `outL = wetL·w1 + wetR·w2`. — [irh/freeverb-rs freeverb.rs](https://github.com/irh/freeverb-rs/blob/master/freeverb/src/freeverb.rs); [comb.rs](https://github.com/irh/freeverb-rs/blob/master/freeverb/src/comb.rs)

**Valhalla on modulation**
- Modulate allpass delay lengths to cut metallic coloration. The old Lexicon modulation depths go beyond real acoustics. — [Valhalla ?p=647](https://valhalladsp.com/?p=647); [Valhalla ?p=1563](https://valhalladsp.com/?p=1563) (snippets)

### Inferences
**A recommended vocal FDN for Rust**, based on Signalsmith's template plus Jot's per-line loss:
1. **Pre-delay**, then a **diffuser** of 3–4 Hadamard steps on 8 channels.
2. **Feedback:** 8 lines (or 16 for long halls), lengths spread over about 1 octave. Bump each to a nearby **prime** sample count so the lengths are mutually prime.
3. **Mixing:** a Householder matrix (`y = x − (2/N)·Σx`, O(N)) in the loop. A fast Walsh–Hadamard transform (O(N log N)) in the diffuser.
4. **Per-line loss:** gain `g_i = 10^(−3·d_i/(fs·RT60))`, the standard Jot relation (consistent with Signalsmith's dB-per-loop derivation above). Make it frequency-dependent with a one-pole shelf or a low/high two-band filter whose per-band gains come from each band's RT60.
5. **Modulation:** 2–8 lines at 0.1–2 Hz, depth ±0.5–2 ms (slow, decorrelated phases), read with interpolation.
6. **Stereo out:** two different orthogonal combinations of the channels, e.g. even channels to L and odd to R, or two rows of a Hadamard matrix.

**Cost.** About 8 delay reads and writes plus O(N) mixing per sample. That is trivially real-time and adds no latency, since FDNs are purely causal recursive structures with no block convolution.

**Freeverb** is a useful correctness baseline and A/B reference. Its fixed comb lengths cause audible metallic ringing on vocals, which motivates the FDN and modulation upgrades.

### Gaps
- The exact JOS/Jot absorption-filter formulas, i.e. the per-line one-pole design from RT60(0) and RT60(π), the "ratio" parameter and the tonal-correction filter coefficients, could not be read because the CCRMA and dsprelated pages were blocked.
- The Signalsmith article/talk text (signalsmith-audio.co.uk) was blocked. Only the code was read, so the talk's guidance on early reflections, multi-channel output and modulation is missing.
- Valhalla's full posts were blocked, so only the snippet-level claims above are available.

---

## 5. Early reflections, pre-delay (20–120 ms, tempo-synced) and ducking reverb or delay on vocals

### Takeaway
Pre-delay keeps the vocal's consonants dry and intelligible before the tail blooms. SOS suggests 60–80 ms with a 1.2 s plate as a typical vocal setting. Tempo-syncing pre-delay to a note division is common practice.

Ducking means compressing the reverb or delay return with a sidechain from the dry vocal. It keeps throws and tails out of the way while the singer is singing and lets them bloom in the gaps. It can be done with zero added latency: a feed-forward envelope follower on the dry signal drives a gain on the wet path in the same sample.

### Cited Findings
- Typical vocal treatment: plate emulation, decay about 1.2 s, pre-delay **60–80 ms**. — [SOS, Paul White: Choosing the right reverb](https://www.soundonsound.com/techniques/choosing-right-reverb)
- In Signalsmith's design the diffuser's cumulative random delays (default range 50 ms, halving per step) form the early, diffuse part, and the feedback loop is the late tail. — [Signalsmith reverb-example-code.h](https://github.com/Signalsmith-Audio/reverb-example-code/blob/main/reverb-example-code.h)

### Inferences
- **Pre-delay range** for a vocal reverb: 0–250 ms, with a tempo-sync option.
- **Pre-delay tempo math:** 1/64 note = 60000/BPM/16 ms, 1/32 = /8. At 120 BPM, 1/32 = 62.5 ms and 1/64 = 31.25 ms.
- **Delay tempo math:** 1/4 = 60000/BPM ms; 1/8 = half that; dotted 1/8 = 0.75 × the quarter. At 120 BPM: 1/4 = 500 ms, 1/8 = 250 ms, dotted 1/8 = 375 ms. At 90 BPM: 667 / 333 / 500 ms.
- **Ducker design.** Peak or RMS detector on the dry vocal (attack 1–10 ms, release 150–400 ms), then a gain computer (threshold, 3–10 dB range), applied to the wet return before or after the reverb.
  - Placing the ducker after the reverb ducks tails smoothly.
  - Placing it before the reverb mutes what goes in but lets existing tails ring.
  - Either way it adds no latency, because there's no look-ahead.
- **Early reflections for vocals.** Plates have no discrete ERs, so many vocal plates skip an ER stage. For a room or hall, use a sparse tapped delay of 6–12 taps over 5–60 ms with decreasing gains and alternating L/R panning, feeding the late FDN.

### Gaps
- I found no authoritative surveys of typical vocal pre-delay ranges beyond the SOS figure. The "20–120 ms" range in the brief is not confirmed by a source here.
- I found no source specs for commercial ducking-delay attack, release or threshold defaults (e.g. TC 2290-style dynamic delay).

---

## 6. Tape echo (Roland RE-201, Echoplex), BBD delays, ping-pong, slapback versus 1/4 and dotted-1/8 throws

### Takeaway
The RE-201 has one record head and three playback heads at fixed, evenly spaced positions, so the delays are in ratio 1:2:3. A Repeat Rate (motor speed) knob scales all three. A 12-position Mode Selector picks the head combinations, with or without the spring reverb.

Its character comes from wow and flutter (slow and fast pitch wobble), tape saturation, and the progressive loss of high (and low) end each time the signal goes round the feedback loop. Exact millisecond figures for the original were not found.

### Cited Findings
- **Heads and controls.** Three playback heads give Short, Medium and Long delays at once. Repeat Rate changes tape speed; slower tape means a longer delay. The 12-position Mode Selector picks the heads. — [BOSS: Space Echo sounds and how to use them](https://articles.boss.info/space-echo-sounds-and-how-to-use-them/); [BOSS: History of the Space Echo](https://articles.boss.info/history-of-the-space-echo/)
- **Head spacing.** One source says the original's heads are evenly spaced. Roland's own GX-10 emulation documents heads 2 and 3 as 2× and 3× head 1. — [Roland GX-10 parameter guide: SPACE ECHO](https://static.roland.com/manuals/gx-10_parameter/en-US/95886987161270155.html); [animagraffs: RE-201](https://animagraffs.com/roland-re-201-space-echo)
- **Wow and flutter.** These are pitch variations from tape wear and irregular rotation. Wow is the slower one; flutter is faster and more random. The RE-201 had modest wow and flutter, but enough to add character. — [BOSS articles](https://articles.boss.info/space-echo-sounds-and-how-to-use-them/) (snippet)
- **Character emulations.** UA's RE-201 plugin manual exists. Roland's MV-8000 manual lists a "Tape Echo 201" effect. — [UA help: RE-201](https://help.uaudio.com/hc/en-us/articles/33538271334164); [Roland MV-8000 manual p.407](https://www.manualslib.com/manual/142007/Roland-Mv-8000.html?page=407) (not opened)

### Inferences
**Rust tape-echo model**

*Signal path:* write head → one circular buffer → 3 read heads at offsets d, 2d, 3d (d = base delay set by "rate"). Feedback goes back to the write head through the loop below.

*Feedback loop, in order:*
1. Tape saturation: soft clip, e.g. `tanh` or asymmetric polynomial with drive.
2. Band-limit: HPF about 80–150 Hz, LPF about 2.5–5 kHz.
3. Optional mild noise.
4. Feedback gain, which may exceed 1 into the saturator for self-oscillation.

*Wow and flutter:* modulate the **read position** (or the whole-buffer time base, which better models tape speed) with:
- wow: about 0.5–2 Hz, about 0.1–0.5% speed;
- flutter: about 6–15 Hz, plus filtered random, about 0.05–0.2%.

Because the time base varies, all heads stay in their 1:2:3 relationship. These rates are typical modelling values, not sourced measurements.

*Rate changes:* sweeping the delay time should *pitch-shift* (slew the read pointer smoothly) rather than crossfade, like moving tape. Use a cubic or Lagrange fractional read.

**BBD (analog chorus/delay) character:** companding noise, clock-dependent bandwidth (longer delay means lower clock, so a darker sound), and anti-alias/reconstruction lowpass filters. Model it as delay + LPF whose cutoff falls with delay time, + soft clip + a little noise.

**Vocal settings:**
- **Slapback:** a single repeat, 60–140 ms, little or no feedback, darkened.
- **Throws:** 1/4 or dotted-1/8 synced, 20–40% feedback, HPF/LPF on the return, often ducked (section 5) and automated per phrase.
- **Ping-pong:** two delays with cross-feedback (L→R→L), the input fed only to one side or panned. For dotted-1/8 ping-pong, the time per side equals the note value.

### Gaps
- Original RE-201 tape speed range, head spacing in mm and absolute delay range: no reliable figure was found. Commonly cited figures (roughly 50–600 ms) are unverified.
- Echoplex head mechanism (movable record head) and its delay range: not researched in the available calls.
- No measured RE-201 wow/flutter spectra or feedback-loop frequency response was found.

---

## 7. Doublers, chorus, Dimension D-style widening, and micro-shift (H910/H3000-style detune with short delays)

### Takeaway
Two vocal-widening families matter here.

**Dimension D (Roland SDD-320).** Two BBD lines with companders and pre/de-emphasis, driven by a shared LFO with a trapezoidal shape. The two modulated copies are cross-mixed so the pitch wobble largely cancels in the centre. This gives width without obvious chorus warble.

**Micro-pitch shift (Eventide H3000 or MicroPitch).** Each side gets a small detune and its own short delay. Commonly cited values: ±7 to ±11 cents, delays of about 10–25 ms.

### Cited Findings
- **Dimension D topology.** It uses two bucket-brigade delay lines with companders and pre/de-emphasis. It is a "fixed chorus" built from dual synchronised delay lines driven by a trapezoidal LFO, to avoid warble; the LFO shape audibly affects the tone. It widens subtly without the extreme modulation of a typical chorus. — [muzines: Roland Dimension D](https://www.muzines.co.uk/articles/roland-dimension-d/4054); [Synthpedia: SDD-320](https://synthpedia.net/roland/sdd-320-dimension-d); [UA WebZine](https://www.uaudio.com/webzine/2004/september/text/content4.html) (snippets)
- **Dimension D presets.** Klark Teknik's BBD-320 clone mirrors its four-button preset scheme. Roland's SH-4d documents an "SDD-320 (DIMENSION D)" model. — [MusicTech: Klark Teknik BBD-320](https://www.musictech.com/news/klark-teknik-bbd-320/); [Roland SH-4d: SDD-320](https://static.roland.com/manuals/sh-4d_v200/en-US/8698023586253067.html)
- **H3000 / MicroPitch ranges.**
  - The original H3000 MicroPitch is described as two voices, one 0 to −50 cents and one 0 to +50 cents, each with up to 2 s delay. — [Plugin Boutique: MicroPitch](https://www.pluginboutique.com/product/2-Effects/35-Pitch-Shifter/6350-MicroPitch)
  - Eventide's MicroPitch plugin offers Pitch A 0 to +50 cents and Pitch B 0 to −50 cents, with Delay A/B in ms or tempo values. — [Eventide MicroPitch User Guide (Scribd)](https://www.scribd.com/document/510321440/MicroPitch-User-Guide) (snippet)
- **H3000-based preset.** An H9000 preset modelled on the H3000 shifts **+9 cents left / −9 cents right** with sine-wave modulation. — [Eventide H9000 manual: Vintage Emulations](https://cdn.eventideaudio.com/manuals/h9000/2.0/content/appendix/algorithms/96_H9000_Vintage_Emulations.html)
- **Producer recipes.**
  - Splice tutorial: detune one side −7 cents and the other +7 cents (the "H3000 trick"). — [Splice blog: the classic vocal mix trick](https://splice.com/blog/the-classic-vocal-mix-trick-every-producer-should-know)
  - Forum user (one person's setting): −9 cents at 15 ms on one side, +11 cents at 25 ms on the other. — [Neural DSP Unity forum: H3000 MicroPitch detune](https://unity.neuraldsp.com/t/eventide-h3000-micropitch-detune/9643)

### Inferences
**Micro-shift in Rust with zero added latency.** Use a **delay-line pitch shifter**: two read taps sweeping through a short window (about 20–50 ms) with sawtooth delay modulation, crossfaded with complementary windows (Hann or triangular).

- **Read-pointer rate:** for a shift of c cents, the read pointer moves at ratio r = 2^(c/1200); +9 cents gives r ≈ 1.0052.
- **Why it adds no latency:** the shifter is causal. Its "latency" is just the base delay, which is part of the effect anyway (10–25 ms).
- **Layout:** two instances (L +c, R −c) with different base delays, mixed about −6 to −12 dB under the dry vocal.
- **Avoid granular or phase-vocoder shifters here.** They add block latency.

**Dimension-style widener.** Two short delays (about 5–15 ms) modulated by the *same* slow LFO (about 0.2–0.5 Hz, trapezoidal or softened triangle), one in antiphase to the other. Output L = dry + a·(tap1 − tap2), R = dry − a·(tap1 − tap2) or a similar cross-mix, so the modulation sums toward mono-neutral. Darken the taps with about 8–10 kHz LPFs to mimic the BBD. The structure is inferred from the "dual synched lines, trapezoidal LFO, no warble" description; the exact mixing matrix is not sourced.

**Classic chorus for vocals.** Base delay 10–25 ms, depth 1–5 ms, rate 0.2–1.5 Hz, with L and R LFOs 90° apart. Typical values; not sourced here.

**Doubler (ADT-style).** One delayed copy at 20–40 ms with slow random delay modulation (± a few ms) and a few cents of drift, panned opposite or both sides. Typical values; not sourced here.

### Gaps
- Exact SDD-320 delay times, LFO rate per button (1–4) and the cross-mix matrix were not found. A service manual or schematic is needed.
- The H910 (original Harmonizer) splice/deglitch method and the H3000's exact MicroPitch delay defaults were not found in primary Eventide docs.

---

## 8. Real-time and CPU constraints: denormals, interpolation for modulated delays, stereo decorrelation

### Takeaway
All the effects here (Dattorro plate, an 8–16 line FDN, tape echo, chorus, micro-shift) are recursive or short-delay structures. They need no look-ahead or block FFTs, so they add zero latency beyond the audio buffer.

The main real-time hazards:
- **Denormals** in decaying feedback loops.
- **Interpolation artefacts** on modulated reads.
- **Allocation or locking** in the audio thread.

### Cited Findings
- Plateau uses `InterpDelay` (fractional, interpolated delay lines) for tank delays and modulated allpasses. It adds 20 Hz one-pole DC blockers on input and output, and uses a short (2 ms) fade for freeze transitions. — [Plateau Dattorro.cpp](https://github.com/ValleyAudio/ValleyRackFree/blob/main/src/Plateau/Dattorro.cpp); [Dattorro.hpp](https://github.com/ValleyAudio/ValleyRackFree/blob/main/src/Plateau/Dattorro.hpp)
- Plateau allocates delay buffers at construction for a maximum sample rate and time scale (e.g. a 192,010-sample pre-delay buffer; tank buffers sized at 40× the base length in an older version). So size changes need no reallocation at runtime. — same source
- Freeverb and freeverb-rs rescale lengths to the running sample rate at construction (`length·sr/44100`). — [freeverb-rs](https://github.com/irh/freeverb-rs/blob/master/freeverb/src/freeverb.rs)
- Valhalla suggests modulating allpass delays to reduce metallic coloration. — [Valhalla ?p=647](https://valhalladsp.com/?p=647) (snippet)

### Inferences
These are standard DSP practice; I couldn't check them against sources in this session.

**Denormals**
- On x86, set the FTZ and DAZ bits (MXCSR) at the start of each audio callback, e.g. with `std::arch::x86_64::_mm_setcsr` (deprecated but available), or a crate such as `no_denormals`.
- On AArch64, set FPCR.FZ.
- In addition, or as a portable fallback, add a tiny DC or alternating offset (about 1e-18 to 1e-20) inside each feedback loop, or flush |x| < 1e-15 to 0 after the loop filters.
- DC blockers in the loop also stop DC build-up.

**Interpolation for modulated delays**

| Method | Character | Use for |
|---|---|---|
| Linear | Cheap; a modulation-dependent lowpass (worst at half-sample offsets) | Fine for small-excursion reverb-tank modulation |
| First-order allpass interpolation (Dattorro's recommendation for chorus/flanger) | Flat magnitude; phase-only error. Has a state transient when the delay jumps, so only use it for slowly changing delays | — |
| 4-point cubic Hermite / 3rd-order Lagrange | Good quality at moderate cost | Default for audible pitch-modulating effects (chorus, tape wow/flutter, micro-shift) |
| Windowed-sinc (8–16 taps) | Highest quality | Only if the CPU budget allows |

**Delay buffers**
- Use power-of-two circular buffers with a bit-mask index, preallocated for the maximum delay at the maximum sample rate (e.g. 192 kHz).
- Never allocate, lock or do I/O in the callback. Smooth all parameters with one-pole or linear ramps over 10–50 ms to avoid zipper noise.
- A delay-time change in a non-tape-style delay should crossfade between two read heads. A change in a tape-style delay should slew the read pointer.

**Stereo decorrelation**
- Use different tap sets for L and R (Dattorro: two 7-tap sets), or different matrix rows in an FDN.
- Offset L/R delay lengths (Freeverb: +23 samples).
- Give LFOs different phases (Plateau: 0, 0.25, 0.5, 0.75) and different rates (0.10, 0.12, 0.15, 0.18 Hz in Plateau).

**Precision.** f32 is generally enough for delay-line audio. Long high-feedback FDN loops and the loop filters may benefit from f64 state (Plateau uses `double`).

**Rough CPU budget per instance at 48 kHz:** Dattorro plate about 12 delay ops + 4 interpolations; 8-line FDN about 8–16 delay ops + O(N) mixing; tape echo about 3 interpolated reads. A whole vocal FX chain should fit comfortably within a few percent of one core.

### Gaps
- No source was retrieved comparing interpolation quality or CPU numbers (e.g. JOS "Delay-Line Interpolation", Laakso et al. 1996 "Splitting the unit delay"). The CCRMA and dsprelated pages were blocked.
- The Dattorro paper's own section on allpass interpolation and its transient problem could not be read.

---

## 9. Presets vocal producers commonly use

### Takeaway
The one sourced anchor is SOS's plate at about 1.2 s with 60–80 ms pre-delay. Other "standard" vocal FX settings (bright plate 1.2–2 s with HPF/LPF on the return, slapback 60–140 ms, 1/4 and dotted-1/8 throws, ±7–11 cent micro-shift) are well-established practice. Only some are backed by sources found here.

### Cited Findings
- Plate about 1.2 s decay with 60–80 ms pre-delay as a typical vocal reverb. — [SOS: Choosing the right reverb](https://www.soundonsound.com/techniques/choosing-right-reverb)
- Micro-shift detune: ±7 cents (Splice); ±9 cents with sine modulation (Eventide H9000 H3000-style preset); −9 / +11 cents at 15 / 25 ms (forum). — [Splice](https://splice.com/blog/the-classic-vocal-mix-trick-every-producer-should-know); [Eventide H9000 manual](https://cdn.eventideaudio.com/manuals/h9000/2.0/content/appendix/algorithms/96_H9000_Vintage_Emulations.html); [Neural DSP forum](https://unity.neuraldsp.com/t/eventide-h3000-micropitch-detune/9643)
- Plate emulations are favoured on vocals and were used on most classic '60s and '70s records. — [SOS](https://www.soundonsound.com/techniques/choosing-right-reverb)

### Inferences
Suggested built-in presets for the app. These are a starting set synthesised from the above and normal practice, not sourced as such.

1. **"Bright Vocal Plate"** (Dattorro):
   - decay → RT60 about 1.4 s;
   - pre-delay 30 ms or a tempo 1/64;
   - input bandwidth high; damping low-to-moderate;
   - mod depth about 50% of 16-sample excursion;
   - return HPF 150 Hz and LPF 9 kHz;
   - ducking 3 dB.
2. **"Classic Plate"**: RT60 about 1.2 s, pre-delay 60–80 ms (the SOS anchor), LPF 7 kHz.
3. **"Lush Hall"** (8-line modulated FDN): RT60 2.5–3.5 s, pre-delay 40–80 ms, mod rate about 0.5 Hz / depth about 1 ms, low-frequency RT 1.2× and high-frequency RT 0.5× the mid, HPF 200 Hz, ducking 4–6 dB.
4. **"Slapback"**: tape echo, single head, 90–120 ms (or 1/16 at tempo), feedback 0–10%, LPF 3.5 kHz, HPF 150 Hz, light saturation and wow.
5. **"Quarter Throw" / "Dotted Eighth Throw"**: synced 1/4 or dotted-1/8 ping-pong, feedback 25–35%, HPF 250 Hz / LPF 5 kHz in the loop, ducked 6–10 dB from the dry vocal.
6. **"Vocal Doubler / Widener"**: micro-shift L +9 c at 13 ms and R −9 c at 21 ms, mixed −10 dB. Alternatively, Dimension-style antiphase short delays.
7. **"Space Echo"**: three heads at d, 2d, 3d with d about 120–180 ms, feedback near self-oscillation, darkening loop filters, wow/flutter on.

### Gaps
- I found no survey data (e.g. SOS "Inside Track" or Mix with the Masters) tying specific named engineers to specific decay, pre-delay or EQ numbers, beyond the SOS guideline above.
- The "bright plate 1.2–2 s with 30 ms pre-delay" in the brief is consistent with the SOS anchor but not directly confirmed by a source here.

---

## Verification pass (Nov 2026): corrections and confirmations

- **Dattorro 1997 paper read** — [EffectDesignPart1.pdf](https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf):
  - **Table 1 coefficients [read]:**
    - Fs = 29761 Hz;
    - EXCURSION = 16 ("Maximum peak sample excursion of delay modulation");
    - decay = 0.50; decay diffusion 1 = 0.70;
    - decay diffusion 2 = 0.50, described as "decay + 0.15, floor = 0.25, ceiling = 0.50";
    - input diffusion 1 = 0.750 and input diffusion 2 = 0.625;
    - bandwidth = 0.9995 ("full bandwidth = 0.9999999");
    - damping = 0.0005 ("no damping = 0.0").
  - **Correction (first input allpass):** Fig. 1 labels it **142** samples (Plateau uses 141). The others are 107, 379 and 277. Input diffusion 1 applies to 142 and 107; input diffusion 2 to 379 and 277.
  - **Fig. 1 tank lengths [read]:** left: 672 + EXCURSION (allpass, decay diffusion 1, "note sign"), z^-4453, damping, ×decay, 1800 (allpass, decay diffusion 2), z^-3720. Right: 908 + EXCURSION, z^-4217, 2656, z^-3163. All match the notes.
  - **Correction (modulation):** "Delay-line taps at nodes 24 and 48 are modulating", i.e. only the two decay-diffusion-1 allpasses. Footnote 14: "At a rate on the order of 1 Hz, and at a peak excursion of about 8 samples for a sample rate of about 29.8 kHz." Plateau's four LFOs (0.10–0.18 Hz) on all four tank allpasses are Plateau's choice, not the paper's.
  - **Table 2 output taps [read], each × 0.6:**
    - yL = +node48_54[266] + node48_54[2974] − node55_59[1913] + node59_63[1996] − node24_30[1990] − node31_33[187] − node33_39[1066].
    - yR = +node24_30[353] + node24_30[3627] − node31_33[1228] + node33_39[2673] − node48_54[2111] − node55_59[335] − node59_63[121].
    - This confirms the MUMT618 right-output set (previously [excerpt]) and gives its signs, + + − + − − −.
- **JOS PASP (Jot absorption) [read]:**
  - per-sample loss G = 10^(−3/n60);
  - for a delay of M_i samples, 20·log10|H_i| = −60·M_i·T/T60(ω), "the same formula derived by Jot";
  - first-order filter H_i(z) = g_i/(1 − p_i z⁻¹), with R0 = 10^(−3·M_i·T/T60(0)) and Rπ = 10^(−3·M_i·T/T60(π/T)): p_i = (R0 − Rπ)/(R0 + Rπ) and g_i = 2·R0·Rπ/(R0 + Rπ).

  — [Achieving Desired Reverberation Times](https://ccrma.stanford.edu/~jos/pasp/Achieving_Desired_Reverberation_Times.html); [Delay-Line Damping Filter Design](https://ccrma.stanford.edu/~jos/pasp/Delay_Line_Damping_Filter_Design.html); [First-Order Delay-Filter Design](https://ccrma.stanford.edu/~jos/pasp/First_Order_Delay_Filter_Design.html)
- **SOS [read]:**
  - "Undamped, the reverb time could be as long as five seconds or more";
  - "a plate reverb emulation with a decay time of 1.2 seconds or so and a pre-delay of 60-80ms";
  - plates "would have been used on virtually all the classic records in the '60s and '70s";
  - a plate "has no discernable early reflections".

  — [SOS: Choosing the right reverb](https://www.soundonsound.com/techniques/choosing-right-reverb)
- **UA [read]:**
  - EMT 140 released 1957, with "a fiber board damper" adjusting reverb time — [UA EMT history](https://www.uaudio.com/blogs/ua/emt-reverb-history);
  - 480L Random algorithm "Spin and Wander parameters control how much the reverb tail moves over time"; no numeric ranges are given — [UA 480L](https://www.uaudio.com/products/lexicon-480l-digital-reverb-effects).
  - "Highs decay faster than lows at every setting" is not stated by UA or SOS, so it is still [excerpt] (Vintage King).
- **Signalsmith ADC21 article [read]:** Householder recommended for 8+ channel feedback loops; Hadamard plus shuffle/polarity flips per diffusion step. This is consistent with the code notes. — [Let's write a reverb](https://signalsmith-audio.co.uk/writing/2021/lets-write-a-reverb/)
- **Still unverified:** the Valhalla quotes (valhalladsp.com serves a Cloudflare challenge), and the Roland RE-201 and Dimension D details (hosts not allowed).
