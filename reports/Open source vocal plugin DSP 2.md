# Second research pass corrects and completes the chain

The follow-up closes every gap the first report left open, and it changes the build plan in four places. For reverb, the six vocal types should be six different machines, not six voicings of one network: the Dattorro plate and the `zrev2` hall already built, a nested-all-pass **Room** (freeverb3 `progenitor2`), a parallel-comb **Chamber** (freeverb3 `nrevb`, ported from the library file because the shipped Dragonfly plugin no longer runs it), a long modulated **Cloud** (CloudSeedCore's one open program, rebuilt lean), and an optional mono **Spring**, with **Shimmer** as a switch on the plate. Rendered from the original C++, those engines differ measurably in how fast they turn dense, how bright they are and where the first sound lands, and the heaviest shipped program costs under 6 % of one processor core. For dynamics, none of the open de-essers, gates or limiters is right as shipped, so the recommended zero-latency chain is a synthesis with every constant traced to a source or marked as a design choice: static input trim, a 2:1 expander limited to 10 dB, a split-band de-esser with a level-independent trigger and a 15 ms release, the two compressors, then a hold-and-release limiter at −3 dBFS feeding a soft clip at −1 dBFS. The smaller gaps closed cleanly: the bucket-brigade disagreement is resolved in favour of the string-machine code, oversampler coefficient sets now exist for 44.1 and 96 kHz, Airwindows Weave is a fifteen-line zero-latency saturator, the Pultec formulas are confirmed symbolically, and the live tuner's delay is measured at **3.32 ms** idle. The earlier report needs six corrections, listed first below. Licences hold no surprises: everything recommended can be ported into GPL-3.0-or-later code, six sources are formula-reference only, and three are AGPL and must not be touched. **Nothing in either report has been listened to**; several forum, vendor and paper hosts stayed unreachable; and all timings are C++ on a shared virtual machine.

**How to read the evidence.** This report builds on `reports/Open source vocal plugin DSP.md` (the "earlier report") and does not repeat it. Three kinds of number appear, and they are kept apart throughout. **Source** means a researcher cloned the repository on 18 November 2026 and read the value in the linked file; a figure followed only by a code link is of this kind. **Measured** or **computed** means a researcher compiled the original C++ and ran it, or did arithmetic or a simulation on the cited formulas; it is not a published figure. **Design choice** means a recommendation that no source states and nobody has heard. **Secondary** means only a search-engine summary of a page was seen. The full working, including per-rate size tables too long for this report, is in `research_notes/Open source vocal plugin DSP 2/`.

## Six statements in the earlier report were wrong

Six points need fixing before any code is written from the earlier report. None overturns its architecture, but two of them (the Dragonfly "Nested" plate and the bucket-brigade constants) would have sent a line-for-line port to the wrong file.

| # | Earlier report | What the follow-up found | Kind of evidence | Consequence |
|---|---|---|---|---|
| 1 | Dragonfly Plate's "Nested" mode runs 18 parallel combs per channel | In Dragonfly's vendored freeverb3 the 18-comb loop is dead code. Since commit `a60bef8` (30 June 2020) the base class runs its own inline loop with six combs, and `nrevb` does not override it. Built from that repository with identical parameters, the "Simple" and "Nested" engines produce bit-identical output (sum of absolute differences 0 over two seconds); the two modes differ only in default damping and feedback values | Source and measured | Port the 18-comb design from `nrevb.cpp` (`processloop2`), not from what the plugin plays |
| 2 | The spring has 16 cascaded all-passes, so one loop trip is 32 stages | Each of the 16 stages is a second-order nested all-pass. One pass is 32 first-order sections and one trip round the loop is 64. The output is also dual mono (left/right correlation 1.00) | Source and measured | The dispersion was understated by a factor of two; a mono core is enough |
| 3 | kChamberAR shares kPlateA's nine 0.5-coefficient all-passes (earlier notes) | kPlateA's nine early elements are all-passes; kChamberAR's nine are plain delays in a 3×3 feed-forward grid with no feedback terms. The two share only the 5×5 tank framework | Source | Matters only if kChamberAR is ever ported |
| 4 | Oversampler round trip for the 48 kHz five-coefficient set: 56 µs at 1 kHz, 69 µs at 10 kHz | The up-sampler and down-sampler are aligned so the pair's delay is the two filters' delays minus one high-rate sample. Correct figures: **45.9 µs at 1 kHz, 58.1 µs at 10 kHz (2.20 samples, not 2.70)**. Every row of the earlier delay table is too high by 10.4 µs for a 48↔96 kHz stage and by 5.2 µs for a 96↔192 kHz stage | Source and simulated | Use the corrected figure for any dry/wet alignment inside a colour stage |
| 5 | Airwindows DeEss "compensates only partly" for sample rate | It does not compensate. The raw detector falls roughly with the sixth power of sample rate (derived from the code), and the one scaling the code applies lowers both the detector gain and its ceiling at higher rates | Source and derived | Do not use a slew-triggered de-esser in a chain that must behave the same at 44.1, 48 and 96 kHz |
| 6 | The chowdsp and string-machine bucket-brigade constants disagree and the paper is needed to settle it | Both start from the same Juno-60 poles. string-machine carries the full five-term sets and follows its own formulas; chowdsp and Surge keep only four complex terms, with every input residue divided by 12.6270 and one output pair sign-flipped, and their loop departs from the fractional-time scheme in three ways | Source and computed | Port string-machine (BSL-1.0). The paper itself is still unread, so this rests on internal consistency |

Sources for the table: [nrev.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/nrev.cpp), [commit a60bef8](https://github.com/michaelwillis/dragonfly-reverb/commit/a60bef8), [SpringReverbProc.cpp](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/spring_reverb/SpringReverbProc.cpp), [kChamberARProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/kChamberAR/kChamberARProc.cpp), [Downsampler2xFpuTpl.hpp](https://github.com/unevens/hiir/blob/master/hiir/Downsampler2xFpuTpl.hpp), [DeEssProc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/DeEss/DeEssProc.cpp), [chowdsp_BBDFilterBank.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_dsp_utils/Delay/BBD/chowdsp_BBDFilterBank.h), [bbd_filter.cpp](https://github.com/jpcima/string-machine/blob/master/sources/bbd/bbd_filter.cpp).

Five smaller statements also change. The room's output is 15 signed taps on the left and 16 on the right, not 15 each, and the code reads one left tap at a different index from the one its own comment names; a faithful port follows the code ([progenitor2.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/progenitor2.cpp)). The spring lives in the Surge repository, not in sst-effects. The retuner's embedded resampler is GPL-3.0-or-later, so the advice to write a new up-sampler for licence reasons no longer applies ([resampler.cc](https://github.com/x42/fat1.lv2/blob/master/src/resampler.cc)). The earlier claims that reverb cost "was never measured", that "a shimmer option is not available" and that Chamber is "a voicing of the hall engine" are all superseded below. And halving Channel9's slew threshold inside a 2× oversampler is only half of the fix.

**What still stands.** The Dattorro plate, the `zrev2` hall and the early-reflection block; the one-core, six-skin delay; the matched-filter EQ and the first-order air band; the soft-knee gain computer and the four compressor characters; the five colour models and the oversampling approach; the fixed module order; and the genre preset table, which remains mostly interpolation. The follow-up re-read every `progenitor2` table and default in the earlier notes against the source and found no error.

## Six reverb types, each a different machine, all under 6 % of a core

**In plain words:** the app currently re-voices one eight-line network as Room, Chamber and Cloud, so all three share that network's fingerprint. Replacing each with a different structure is what makes them sound like different reverbs, and the measurements below show the differences are large. Only one reverb runs at a time on the send, so the processor budget is the single most expensive type, not the sum.

### Three density groups, three brightness bands

A researcher compiled each original C++ engine, fed it a single click at 48 kHz and analysed four seconds of wet output. "Fully dense" is the time, counted from the first sound, at which the separate echoes have blurred into a wash as smooth as random noise (normalised echo density of 0.9 on a 20 ms window, after Abel and Huang; the window cannot resolve below 10 ms). Decay time is the time for the tail to fall by 60 dB. Left/right correlation is 1.00 for a mono output and near 0 for a fully wide one. "Brightness" is the spectral centroid of the first 200 ms. Cost is nanoseconds per stereo sample on one 2.1 GHz virtualised Xeon core; one sample period at 48 kHz is 20,833 ns. **Every figure in this table is measured, not published.**

| Engine and program | First sound | Fully dense after | Decay time | L/R correlation | Brightness | Cost, ns (% of a core) |
|---|---|---|---|---|---|---|
| Dattorro plate (freeverb3 `strev`, 1.0 s setting) | 9 ms | 201 ms | 1.73 s | 0.01 | 4.8 kHz | 56–80 (0.27–0.39) |
| `zrev2` hall, "Small Vocal Hall" values | 1 ms | 23 ms | 1.25 s | −0.02 | 2.2 kHz | 202–403 (0.97–1.94) |
| `progenitor2` room, "Medium Vocal Room" values | 0.1 ms | 24 ms | 0.95 s | −0.04 | 2.7 kHz | 185–345 (0.89–1.66) |
| `nrevb` real 18-comb loop, 1.0 s setting | 0.1 ms | 71 ms | 0.91 s | 0.05 | 12.0 kHz | 74 (0.36) |
| Dragonfly's shipped six-comb path, same setting | 56 ms | 37 ms | 0.95 s | 0.00 | 6.7 kHz | 31–50 (0.15–0.24) |
| Airwindows Chamber, defaults | 24 ms | 252 ms | 3.99 s | 1.00 | 9.0 kHz | 80 (0.38) |
| Airwindows kChamberAR, defaults | 92 ms | 31 ms | 1.01 s | 0.14 | 3.3 kHz | 229 (1.10) |
| Airwindows kPlateA, defaults | 4 ms | 21 ms | 1.77 s | 0.01 | 3.4 kHz | 253 (1.22) |
| CloudSeedCore "Dark Plate" | 53 ms | 123 ms | 6.92 s | −0.01 | 4.1 kHz | 1198 (5.75) |
| chowdsp spring (Surge), defaults | 15 ms | 1575 ms | 1.20 s | 1.00 | 4.9 kHz | 627 (3.01) |

The room and hall rows are the late reverb only, without Dragonfly's early-reflection block (26–38 ns extra). Ranges span four compiler configurations; removing the library's own denormal checks alone cut the plain-optimised times by 22–25 %. Sources compiled: [progenitor2.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/progenitor2.cpp), [zrev2.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/zrev2.cpp), [strev.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/strev.cpp), [nrevb.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/nrevb.cpp), [ChamberProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Chamber/ChamberProc.cpp), [ReverbChannel.h](https://github.com/GhostNoteAudio/CloudSeedCore/blob/master/DSP/ReverbChannel.h), [SpringReverbProc.cpp](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/spring_reverb/SpringReverbProc.cpp).

The engines fall into three groups. The hall, the room, kPlateA, kChamberAR and the real `nrevb` loop are **immediately dense**. The Dattorro plate, Cloud Seed and Airwindows Chamber are **slowly dense** (0.1–0.25 s). The spring is **deliberately sparse**. A listener will therefore hear, in order of strength: spring against everything else; the long, late-arriving washes (Cloud) against the rest; plate (bright, slow to fill) against room and hall (dark and instantly smooth at their vocal settings); and room against hall, which are nearly identical in density and differ in length, bass behaviour and early pattern. That ordering is the researcher's inference from the table, not a listening result. At a 64-sample buffer the heaviest shipped program (Cloud Seed) uses about 77 µs per buffer on this processor and the room or hall 13–26 µs (computed).

### Room: freeverb3 `progenitor2`, now specified down to the sample

**In plain words:** this is the largest audible upgrade over the current re-voiced network, and everything needed to port it without reopening the C++ is now written down. At vocal settings it behaves less like a recirculating tail and more like one dense burst through about twenty all-pass stages per side, which is why consonants come out smooth and not fluttery.

Three details decide whether a port matches. The output taps are read after the delay writes, with `get_z(k)` meaning "written k−1 samples ago". The nested all-passes carry their own decay gains on the delayed path only, so at short settings they do most of the damping while the loop gain barely recirculates. And the left tap list follows the code, not the comment above it ([progenitor2.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/progenitor2.cpp); [allpass_t.hpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/allpass_t.hpp)). Lengths below are samples at the library's 34,125 Hz reference rate.

```
1  L, R = dc_cut(inL), dc_cut(inR)                                   // 5 Hz
2  n = pink_noise() ; lfo = lowpass20Hz((sine(spin) + 0.09·n)·wander) ; n *= 0.06     // one LFO and one noise value for both sides
3  ten modulated input all-passes per side, coefficient −idiff1, sign of the modulation flipped after every stage
     L table 617,535,434,347,218,162,144,122,109,74 ; R table 603,547,416,364,236,162,140,131,111,79
4  crossL/R = four plain all-passes (+odiff1): L 430,341,264,174 ; R 447,324,247,191
     L = lowpass_in(L + 0.4·crossR) ; R = lowpass_in(R + 0.4·crossL)
5  L += loopdecay·(yR + bassb·lowpassBass(allpassBass(yR)))          // yR = oldest sample of the right side's last delay; mirror for R
6  L: damper → mod. all-pass 239 (diff1, decay d2) → delay 2 → mod. all-pass 392 (diff2, decay d3)
   R: damper → mod. all-pass 205 → delay 1 → mod. all-pass 329
7  L: delay 1055 → double-nested all-pass (inner 1944, outer 612) → delay 344 → triple-nested (1212 modulated ±121, 816, 1264) → delay 1572
   R: delay 1460 → double-nested (2032, 368) → delay 500 → triple-nested (1452 modulated ±5, 688, 1340) → delay 16
8  outL = 0.469·dL23[1]
        + 0.219·(dL31[40] − dR49[192] + dL31[276] − dR40[110] − dR49[468])
        + 0.064·(dL37[1572] + AP2L.z1[121] + AP2L.z2[480] − AP2R.z2[103] + AP3L.z1[26] + AP3L.z2[780] + AP3L.z3[1200] − AP3R.z2[310])
        + 0.045·dL37[780]
   outR = 0.469·dR40[625]
        + 0.219·(dR49[468] − dL31[312] + dR49[24] − dL37[36] − dL23[790] − dL31[189])
        + 0.064·(dR58[8] + AP2R.z1[10] + AP2R.z2[359] − AP2L.z2[30] + AP3R.z1[10] + AP3R.z2[109] + AP3R.z3[1310] − AP3L.z2[800])
        + 0.045·dR58[10]
9  22 ms feed-forward comb whose gain is a 2.4 Hz LFO, opposite sign per side → output low-pass → pre-delay → width mix
nested coefficients: inner 0.25 (diff4), outer 0.406 (diff3) ; nested decays: double-nested inner d1, outer d2 ; triple-nested inner and middle d1, outer d2
decay, with T = rt60/(size/10): loopdecay = 0.237^(1/T) ; d1 = 0.938^(1/T) ; d2 = 0.844^(1/T) ; d3 = 0.906^(1/T)
```

In step 8, `dL23`, `dL31` and `dL37` are the three left delays of step 7 in order (1055, 344, 1572) and `dR40`, `dR49`, `dR58` the three right ones (1460, 500, 16); `z1`, `z2`, `z3` are the inner, middle and outer buffers of a nested all-pass. Every length is scaled by `fs·(size/10)/34125` and then raised to the next prime; tap indices are scaled without the prime search. For the default "Medium Vocal Room" (12 m at 48 kHz) the researcher's arithmetic gives the integer sizes below, which serve as a check on a port.

| Element | Samples at 48 kHz, size 12 m (computed) |
|---|---|
| Input all-passes, left | 1049, 907, 733, 587, 367, 277, 251, 211, 191, 127 |
| Input all-passes, right | 1019, 929, 709, 617, 401, 277, 239, 223, 191, 137 |
| Cross-feed all-passes, left / right | 727, 577, 449, 293 / 757, 547, 419, 331 |
| Loop all-passes, left (239, 392, 1944, 612, 1212, ±121, 816, 1264) | 409, 661, 3299, 1033, 2053, ±211, 1381, 2137 |
| Loop all-passes, right (205, 329, 2032, 368, 1452, ±5, 688, 1340) | 347, 557, 3433, 631, 2459, ±11, 1163, 2267 |
| Plain delays, left (2, 1055, 344, 1572) / right (1, 1460, 500, 16) | 3, 1783, 587, 2657 / 1, 2467, 853, 29 |
| Modulation excursion, loop / input all-passes; output comb | 47 / 17; 1061 |

The decay law gives small loop gains at vocal lengths: at 0.6 s and 12 m, `loopdecay` is 0.0562 with `d1` 0.880, `d2` 0.712 and `d3` 0.821; at 0.3 s and 8 m `loopdecay` is 0.0215 (computed from [progenitor.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/progenitor.cpp)). Dragonfly's Diffuse control maps to `idiff1 = odiff1 = diffuse/120`, so the vocal presets at 86–98 % run the ten input all-passes at 0.72–0.82. The wrapper's signal order is input high-pass and low-pass, then early reflections, then `late input = early_send·early + filtered`, then `out = dry·input + earlyLevel·early + lateLevel·late`, with no latency ([dragonfly-room DSP.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/plugins/dragonfly-room-reverb/DSP.cpp)). Its three vocal presets are: Small (8 m, 0.3 s, pre-delay 0 ms, diffuse 86, late damping 6.4 kHz, low boost 20 % at 400 Hz), Medium (12 m, 0.6 s, 2 ms, diffuse 92, spin 2.7 Hz, wander 12 %, early damping 8 kHz, late 6 kHz, boost 25 %) and Large (15 m, 1.0 s, 4 ms, diffuse 98, late 5 kHz, boost 30 %), all at dry 80, early 10, early send 20, late 20 ([room DistrhoPluginInfo.h](https://github.com/michaelwillis/dragonfly-reverb/blob/master/plugins/dragonfly-room-reverb/DistrhoPluginInfo.h)).

Three hazards in the original must not be copied into a real-time port. The modulation-noise generator rebuilt a 32,768-point table in a single call whenever it ran out (Dragonfly merged an amortised version on 14 November 2026); the library re-allocates buffers on every size change; and its default denormal macro is pure overhead once flush-to-zero is set ([efilter_t.hpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/efilter_t.hpp); [revbase.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/revbase.cpp); [fv3_defs.h](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/fv3_defs.h)). Buffers sized for the largest case (32 m at 96 kHz) need about 18,300 samples for the longest all-pass (computed). A mono vocal feeds both input chains, which already yields decorrelated left and right.

### Chamber: the real 18-comb `nrevb` loop, taken from the library file

**In plain words:** no open reverb models a physical echo chamber, so the Chamber was chosen by measurement: the one algorithm that is dense from the first milliseconds, the brightest of everything tested, has a real decay control and costs about as much as the plate. It is small to build, being combs and all-passes only.

The loop sums the mono input into 18 parallel damped combs per side, keeps the direct signal in that sum, and smears the result through eight series all-passes, so it has no single loop period and no early/late split ([nrevb.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/nrevb.cpp)):

```
hpf = damp3_1·dc_cut(inL + inR) − damp3·hpf
per side:
  out  = hpf + apfeedback·last ; last −= apfeedback·out           // one-sample outer all-pass, apfeedback 0.2
  out += sum of 18 low-pass-feedback combs(hpf)                   // feedback = 10^(−3·length/(rt60·fs)), comb damping 0.1
  three series all-passes (347, 113, 37 at 25,641 Hz), three more (57, 87, 103), coefficient 0.5
  lpf = damp2·lpf + (1 − damp2)·out ; all-pass (59) ; all-pass 43 (left) or 37 (right) ; dc_cut
  output = 0.4·predelay(last) ; last = out
right-side comb lengths = left lengths + 13 samples at 25,641 Hz, then prime-rounded
```

The comb-length table and remaining defaults are in section E of the earlier notes (`research_notes/Open source vocal plugin DSP/reverbs.md`). The structural weakness is that 18 fixed parallel combs of 49–98 ms can ring metallically at long settings; capping decay near 2 s is the researcher's judgement from the structure, not a measurement.

Two alternatives were specified in full and set aside. **Airwindows Chamber** is the one its author says will "always sound like a chamber": twelve delays, each the golden ratio shorter than the last (19,900 × size samples down to 98 at full size), in three feed-forward banks of four mixed as `y_i = x_i − (sum of the other three)`, with only the final bank fed back at a gain of at most 0.123 against a lossless value of 0.125 ([ChamberProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Chamber/ChamberProc.cpp); [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)). It measured as mono (left and right differ only at dither level) and slow to fill (0.1–0.4 s), so it is an optional "slap chamber" at Bigness 0.1–0.2 and Longness about 0.2, where it measured 0.85 s of decay at 0.20/0.20; a right channel de-tuned by a few percent in size would give stereo and is a design choice the original does not make. **kChamberAR** has its decay fixed in code at about 1 s, a tape-echo front end, saturation and a level-dependent gain element in the path, and its own author calls it "dirty, aggressive, and wild"; it is not recommended as a vocal type ([kChamberARProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/kChamberAR/kChamberARProc.cpp)). Dragonfly's own "chamber" presets are the hall and room engines again.

### Cloud: one open program, a reproducible generator, and a rebuild that should cost far less

**In plain words:** Cloud Seed is the long ambient wash, not a room. Its open core ships exactly one program, "Dark Plate", and that program can be reproduced exactly because the generator that picks its delay lengths is now pinned down. As shipped it is the most expensive reverb by a wide margin, for reasons a rebuild removes without changing the sound.

Each channel is up to twelve independent delay loops, each containing a modulated delay, an optional chain of all-pass diffusers, optional shelves and a low-pass, all fed the same input and summed at `1/sqrt(lines)`. Every length comes from a seeded pseudo-random sequence, which the researcher re-implemented and matched against the compiled C++ to all printed digits ([LcgRandom.h](https://github.com/GhostNoteAudio/CloudSeedCore/blob/master/DSP/LcgRandom.h); [RandomBuffer.cpp](https://github.com/GhostNoteAudio/CloudSeedCore/blob/master/DSP/RandomBuffer.cpp); [ReverbChannel.h](https://github.com/GhostNoteAudio/CloudSeedCore/blob/master/DSP/ReverbChannel.h); [AllpassDiffuser.h](https://github.com/GhostNoteAudio/CloudSeedCore/blob/master/DSP/AllpassDiffuser.h)):

```
x = seed (64-bit) ; each draw: x = (22695477·x + 1) & 0xFFFFFFFF ; value = (float)x / (float)UINT_MAX
Generate(seed, count, cross): series A from seed, B from ~seed ; r[i] = A[i]·(1 − cross) + B[i]·cross
seed = floor(parameter·999.999) ; cross = 0.5·CrossSeed (right), 1 − 0.5·CrossSeed (left)
check: seed 1 → 0.005284203, 0.501993477, 0.667579949
line i, r = Generate(SeedDelay, 36):     delay_i = int((0.5 + r[24+i])·lineSizeSamples) ; feedback_i = 10^(−3·delay_i/decaySamples)
                                         modAmount_i = lineMod·(0.7 + 0.3·r[i]) ; modRate_i = lineRate·(0.7 + 0.3·r[12+i])/fs
diffuser stage k, r = Generate(seed, 36): delay_k = int(delaySamples·10^r[k]·0.1)
                                         modAmount_k = mod·(0.85 + 0.3·r[12+k]) ; modRate_k = rate·(0.85 + 0.3·r[24+k])/fs
                                         (the diffuser inside line i uses seed SeedPostDiffusion·(i+1))
all-pass stage: z = read(delay) ; v = in + z·fb ; write v ; out = z − v·fb
```

"Dark Plate" in physical units at 48 kHz (computed from [Programs.h](https://github.com/GhostNoteAudio/CloudSeedCore/blob/master/Programs.h) and [Parameters.h](https://github.com/GhostNoteAudio/CloudSeedCore/blob/master/Parameters.h)): 12 lines; line size 96.08 ms; decay 4.80 s; line modulation 0.68 ms at 0.095 Hz; four in-line diffuser stages of 31.6 ms base at feedback 0.8507, modulated 0.367 ms at 0.058 Hz; input low cut at 340 Hz; an in-loop high shelf of −4.64 dB at 4518 Hz; no early stages; cross seed 0; seeds 333 (tap), 184 (diffusion), 218 (delay) and 365 (post-diffusion). The generator then yields left line lengths of 2953, 3955, 5778, 5824, 6034, 4131, 4926, 2826, 3844, 2620, 3335 and 2565 samples and right lengths of 2413, 5308, 2510, 5608, 3144, 6816, 4646, 2672, 5953, 4128, 5992 and 4202, which a port can use as its acceptance test. The measured decay was 6.9 s against the nominal 4.8 s because the in-line all-passes lengthen the loops, and with no early path the shortest line acts as a pre-delay of about 50 ms.

The cost has identifiable causes. Every modulated delay holds 384,000 floats and every all-pass 19,200, so the stereo reverb allocates about 67 MB (computed from the declared sizes); the multitap evaluates an `exp()` per tap per sample; and the loop output passes through a block buffer, so the real loop time is the delay plus one host block. Right-sizing each buffer, precomputing tap weights and processing sample by sample should bring the cost into the range of the other engines; **that estimate is the researcher's and is unmeasured**. Two further details matter for a port: LFO start phases come from C `rand()` and are not seeded, and the random-buffer generator allocates on the parameter path ([ModulatedAllpass.h](https://github.com/GhostNoteAudio/CloudSeedCore/blob/master/DSP/ModulatedAllpass.h)). The nine legacy v1 programs use a different (SHA-256-based) generator, so they transfer as structure only: for a darker, slower bloom the "Rubi-Ka Fields" recipe is four lines of 242 ms, six in-line stages of 72 ms at 0.715 and seven early stages of 61 ms at 0.76, with its 18.5 s decay brought down to taste ([legacy Factory Programs](https://github.com/ValdemarOrn/CloudSeed/tree/legacy-v1/Factory%20Programs)). The short legacy programs use only three lines, which amounts to three diffused echoes per side; that is why Cloud Seed stays in the long ambient role.

### Spring: an optional mono character effect, last in the build order

**In plain words:** the spring is sparse and "boingy" on purpose, unlike every other type here. It suits lo-fi, surf, dub and rockabilly treatments at low mix and is not a general vocal reverb. Build it last.

The code is GPL-3.0-or-later and describes itself as "based loosely" on two published parametric-spring papers. Per channel it keeps a main lane and a feedback lane ([SpringReverbProc.cpp](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/spring_reverb/SpringReverbProc.cpp); [SchroederAllpass.h](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/spring_reverb/SchroederAllpass.h); [ReflectionNetwork.h](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/spring_reverb/ReflectionNetwork.h)):

```
main = highpass40Hz(tanh(in − feedbackGain·longDelay.read())) + knock
both lanes → 16 stages, each a nested all-pass of order 2 with one delay length (0.35 + 3·size) ms
             and gain g = 0.5 − 0.4·spin (+g on the main lane, −g on the feedback lane)
longDelay.write(feedback lane) ; main −= reflections.read() ; reflections.write(main)
main = lowpass(main) = OUTPUT ; feedback lane = main for the next sample
T60 = 0.5·9^(0.95·decay − 0.7·(1 − size²)) s ; long delay = 1000 + size·0.099·fs samples ; feedbackGain = 0.001^(delay/(T60·fs))
damping low-pass = 4000·4.5^(1 − damping) Hz
reflections: four delays of 0.07, 0.17, 0.23, 0.29 s × size, Householder-mixed, then a shelf with −(1 + 9·damping) dB above 800 Hz
```

At the Surge defaults (size, decay, damping and spin all 0.5, reflections 1.0) and 48 kHz the element delay is 1.85 ms, `g` is 0.30, the long delay is 3376 samples (70.3 ms), the main-loop `T60` is 0.448 s and the damping corner is 8485 Hz (computed). The measured decay was 1.20 s because the reflection network recirculates. Most of the measured 627 ns is implementation overhead: every delay line is allocated at 2¹⁸ samples and four lanes run although the two channels are identical. A mono two-lane port with right-sized buffers should cost a fraction of that, which again is an estimate. One constant does not scale: the `1000` in the long delay is in samples, so the echo spacing is 22.7 ms at 44.1 kHz, 20.8 ms at 48 kHz and 10.4 ms at 96 kHz unless the port fixes it as a time.

### Shimmer: two open sources, best added as a switch on the plate

**In plain words:** the earlier report said no open shimmer existed. Two do, both small and correctly licensed. Neither is a famous studio shimmer, and neither was rendered to audio. The cheapest route adds two moving read taps to the plate already built, with no new buffers and no latency, because the pitch shifter sits in the feedback path and never touches the direct sound.

**Oliverb**, from the Parasites alternative firmware for the Clouds module (MIT), is a Dattorro-style loop whose feedback is read from the loop delays through a two-tap cross-faded shifter ([oliverb.h](https://github.com/mqtthiqs/parasites/blob/master/clouds/dsp/fx/oliverb.h); [granular_processor.cc](https://github.com/mqtthiqs/parasites/blob/master/clouds/dsp/granular_processor.cc)):

```
ps_size = 128 + (3410 − 128)·size ; phase += (1 − ratio)/ps_size, wrapped to [0, 1) ; ratio = 2^(semitones/12)
tri = raised-cosine window of 2·min(phase, 1 − phase)
feedback into each half = delay[normal read]·decay·(1 − shift)
                        + delay[phase·ps_size]·tri·decay·shift + delay[phase·ps_size + ps_size/2]·(1 − tri)·decay·shift
then one-pole low-pass → one-pole high-pass → soft limit x·(27 + x²)/(27 + 9x²) → the two loop all-passes
shift is 0 below 0.3 semitones of offset and reaches 1 at 0.7 ; decay = density·1.3 + 0.15·|pitch|/24
```

Its tables are for a 32 kHz module (input all-passes 113, 162, 241, 399; loop delays 3411 and 4782 samples), and its filters and shifter window are raw per-sample values, so all of them must be converted to times and frequencies for 48 kHz. **Guitarix GxShimmizita** (GPL-2.0-or-later) is the zita-rev1 network with one shifter in each of its eight feedback lines (window 2048 samples, cross-fade 1024, shift ±6 semitones), which maps one-to-one onto the `zrev2` hall ([shimmizita.dsp](https://github.com/brummer10/guitarix/blob/master/trunk/src/LV2/faust/shimmizita.dsp)). A crude two-tap shifter is acceptable here because the loop's diffusion hides its artefacts; that is an inference from both sources using the simplest possible shifter. The low-pass and high-pass in the loop are needed because each trip adds an octave. Starting values of +12 semitones, a shifted-feedback blend of 0.3–0.5, a loop low-pass around 5–6 kHz and a high-pass around 150 Hz are design choices.

### The shortlist, with what is sourced and what is not

| Type | Algorithm to port | Default vocal settings | Basis of the defaults |
|---|---|---|---|
| Plate (default) | Dattorro tank, as built | Decay 1.2 s; pre-delay 10–20 ms live, 60–80 ms playback; loop damping 7–10 kHz; send high-pass 150–200 Hz; return low-pass 9–10 kHz | Ranges follow Dragonfly Plate presets (source); the single values are design choices |
| Room | `progenitor2` plus early taps | "Medium Vocal Room": 12 m, 0.6 s, pre-delay 2 ms, diffuse 92 %, spin 2.7 Hz, wander 12 %, damping 8 / 6 kHz, low boost 25 % at 400 Hz | Source preset; return high-pass 120–150 Hz is a design choice |
| Hall | `zrev2` plus early taps, as built | "Small/Medium Vocal Hall": 24–32 m, 1.2–1.3 s, pre-delay 4–8 ms, diffuse 60–75 %, high-frequency decay ×0.35–0.40, high cut 5.8–6.25 kHz, modulation 10 % | Source presets |
| Chamber | `nrevb::processloop2` from the library file | Decay 1.0–1.4 s, capped near 2 s; pre-delay 10–20 ms; comb damping 0.1–0.3; all-pass feedback 0.5, outer 0.2; return low-pass 8–10 kHz, high-pass 200 Hz | Feedbacks and damping 0.1 are source defaults; everything else is a design choice |
| Cloud | CloudSeedCore topology, "Dark Plate" program and seeds, rebuilt sample-accurate | Decay 4.8 s (3–6 s useful), 12 lines of 96 ms, four in-line stages at 0.85, low cut 340 Hz, in-loop shelf −4.6 dB at 4.5 kHz; return 6–10 dB below the plate | Source program; the useful range and return level are design choices |
| Spring (optional) | chowdsp spring, one mono core | Size, decay, damping, spin 0.5; reflections 1.0; return high-pass 250 Hz; low send | Source defaults; return filter is a design choice |
| Shimmer (switch on Plate) | Oliverb-style shifted feedback taps | +12 semitones, blend 0.3–0.5, loop low-pass 5–6 kHz, high-pass 150 Hz | Structure from source; all values are design choices |

Preset sources: [plate DistrhoPluginInfo.h](https://github.com/michaelwillis/dragonfly-reverb/blob/master/plugins/dragonfly-plate-reverb/DistrhoPluginInfo.h), [hall DistrhoPluginInfo.h](https://github.com/michaelwillis/dragonfly-reverb/blob/master/plugins/dragonfly-hall-reverb/DistrhoPluginInfo.h), [nrevb.hpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/nrevb.hpp), [SpringReverbEffect.cpp](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/SpringReverbEffect.cpp). The recommended build order by value for effort is Room, Chamber, Cloud, shimmer taps, Spring. kPlateA remains a candidate second plate: it is as dense as the hall almost at once and darker than the Dattorro tank.

One caution spans all of these. The sources use four incompatible sample-rate conventions: freeverb3 stores tables at a reference rate and rounds to primes (which distorts short elements most: a table value of 5 becomes 7 at 48 kHz and 17 at 96 kHz); Airwindows stores raw 44.1 kHz sample counts and runs them unscaled at 48 kHz, so times are 8.1 % shorter; Cloud Seed and the spring use times, with exceptions; Oliverb is fixed for 32 kHz hardware ([revbase.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/revbase.cpp); [kChamberARProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/kChamberAR/kChamberARProc.cpp)). The researcher's recommended convention is to store every table as seconds, convert once per rate or size change, and apply prime rounding only where the source does and only to elements longer than a few tens of samples. No program was rendered at 44.1, 48 and 96 kHz to quantify the differences.

## A zero-latency dynamics chain in which every constant has a named origin

**In plain words:** the first report's dynamics design was assembled from fragments. The follow-up read the open de-essers, gates, limiters and levellers line by line and found that none should be copied whole, but together they supply almost every constant needed. The chain order is unchanged. Four things change relative to the app as described in the brief: the expander gets a range limit, hysteresis and hold; the de-esser's release drops from 60 ms to about 15 ms and its hard clamp becomes a soft ratio with a depth cap; the FET compressor's feedback loop gets a stability guard; and a hold-and-release limiter goes in front of the soft clip. Every stage has zero samples of latency and no state beyond a handful of numbers. The app's own code was not inspected; where "app today" appears, the values come from the brief.

### De-esser: keep the level-independent trigger, shorten the release

**In plain words:** the app's existing idea, comparing high-band energy with full-band energy, is better than anything in open code, because it gives the same decision whether the singer is loud or quiet. What the open code teaches is that the release should be about four times shorter than the app's, or the treble stays held down into the vowel after each "s".

The three open designs each fail a live chain in a specific way. **Calf's** de-esser uses an absolute threshold (−18 dBFS by default) on a filtered side-chain, so it works at one input level only, and its split mode sums a high-pass at 0.83 f and a low-pass at 1.17 f that are not a matched crossover: with nothing happening, the sum has a computed **−7.3 dB dip near 5.9 kHz**. Its split mode also calls the same filter object twice per sample, a quirk not to copy ([Calf modules_comp.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/modules_comp.cpp); [Calf metadata.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/metadata.cpp)). **Airwindows DeEss and DeBess** trigger on products of sample-to-sample differences; the trigger depends on the fourth power of signal level (the same "s" 6 dB quieter gives one sixteenth of the detector value, derived) and on sample rate, and the author warns that DeBess may not engage "if you're using high sample rates and your mics do NOT extend right up as far as the sampling lets you" ([DeBessProc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/DeBess/DeBessProc.cpp); [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/HEAD/Airwindopedia.txt)). What is worth taking from DeEss is its action, not its trigger: it turns down only the part of the signal above a low-pass and caps the depth. LSP, x42, zam-plugins and the Faust library contain no de-esser at all, and the two closed tools named in the brief (T-De-Esser and Spitfish) are freeware without source (secondary).

The open code's own time constants are short: Calf's default works out to about 3.7 ms attack and 5.0 ms release as true time constants, DeEss recovers in about 4.6 ms and DeBess in about 9 ms at 44.1 kHz (derived from the code). The app's 60 ms release is an order of magnitude longer.

```
// prepare(fs)                                                       basis
split  : 4th-order Linkwitz–Riley at fc ; lo + hi sums flat           app design; fc 5.0 / 6.5 / 8.0 kHz for low / default / high voice
aDet   = exp(−1/(0.003·fs))    // one coefficient for BOTH detectors  design choice (Calf's RMS detector is about 4–5 ms)
aAtt   = exp(−1/(0.001·fs))    // 1 ms                                app today 0.8 ms; Calf about 3.7 ms
aRel   = exp(−1/(0.015·fs))    // 15 ms                               app today 60 ms; Calf about 5 ms, DeBess about 8 ms
thrDb  = −9 ; slope = 0.667 ; kneeDb = 9 ; maxRedDb = 9               threshold and cap: design choice; slope and knee: Calf ratio 3, knee 2.8
floorDb = −50 dBFS             // idle below this                     design choice (= expander threshold)
// per sample
(lo, hi) = lr4(x)
pH = aDet·pH + (1 − aDet)·hi·hi ; pF = aDet·pF + (1 − aDet)·x·x
o  = 10·log10((pH + 1e-12)/(pF + 1e-12)) − thrDb          // "sibilance index", independent of input level
gr = 0 if o ≤ −kneeDb/2 ; slope·(o + kneeDb/2)²/(2·kneeDb) if |o| < kneeDb/2 ; slope·o otherwise
gr = min(gr, maxRedDb) ; if 10·log10(pF + 1e-12) < floorDb { gr = 0 }
g  = (gr > g) ? aAtt·g + (1 − aAtt)·gr : aRel·g + (1 − aRel)·gr
y  = lo + hi·10^(−g/20)
```

A numerical check of exactly this pseudo-code on synthetic signals at 48 kHz gave 0.00 dB of reduction on a 150 Hz harmonic "vowel", 3.99 dB on 4.5–11 kHz noise standing in for an "s", the same 3.99 dB with the input 20 dB lower, 1.35 dB remaining 20 ms after the "s" ended and 0.09 dB after 60 ms (computed; not a listening test). The design limits itself: white noise through the 6.5 kHz split has 0.81 of the full-band level, so the index cannot exceed about −1.8 dB and the deepest possible cut is about 2 dB at a −5 dB threshold, 4.8 dB at −9 dB and 8 dB at −14 dB (computed). One "De-ess amount" knob sweeping the threshold from −5 to −14 dB is the suggested control, and a "Listen" output of what is being removed follows Calf's and DeBess's monitor switches. The split frequency should sit just below the singer's "s" energy; because the detector is a high-band share and not a narrow band, the exact value is forgiving. Calf's defaults (split 6 kHz, emphasis 4.5 kHz) and the frequency ranges carried over from the earlier report support the three positions; the two blog sources for male and female ranges are low-authority.

### Expander: turn breaths down by a fixed, modest amount

**In plain words:** a full gate either chops breaths off or passes them at full level, and on a dry voice the switch is audible. A 2:1 expander limited to about 10 dB turns breaths and room tone down gently, never to silence, and is far more forgiving of a badly placed threshold, which matters when the singer cannot tune a gate while singing. That reasoning is the researcher's; no source gives numbers for breath level.

Open gates fall into three groups. Soft expanders with a floor: Calf's "Gate" is a 2:1 expander with a roughly 9 dB knee and a −24 dB floor, and OBS Studio's "expander" preset is 2:1 with a 50 ms release. True hysteresis gates: LSP uses two curves with the close threshold set relative to the open one (12 dB lower by default) plus a hold counter, and the OBS noise gate opens at −26 dB, closes at −32 dB and holds for 200 ms. Hard on/off gates: ZamGate and Faust's `gate_mono` ([Calf modules_comp.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/modules_comp.cpp); [LSP Gate.cpp](https://github.com/lsp-plugins/lsp-dsp-units/blob/HEAD/src/main/dynamics/Gate.cpp); [OBS expander-filter.c](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/expander-filter.c); [OBS noise-gate-filter.c](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/noise-gate-filter.c); [ZamGatePlugin.cpp](https://github.com/zamaudio/zam-plugins/blob/HEAD/plugins/ZamGate/ZamGatePlugin.cpp); [Faust misceffects.lib](https://github.com/grame-cncm/faustlibraries/blob/HEAD/misceffects.lib)). The Airwindows gates (Gatelope, SoftGate, DustBunny) are a filter gate for drum microphones, a noise-floor fader for sample makers and a deliberate distortion; none is a conventional expander.

| Parameter | Value | Basis |
|---|---|---|
| Side-chain filter | 2nd-order high-pass at 100 Hz, detector only | LSP offers side-chain filters (source); the frequency is a design choice |
| Detector | Power one-pole, 10 ms, read in dB | OBS "10 ms RMS window", LSP reactivity 10 ms, ZamGate about 8–9 ms (source) |
| Open threshold | Noise floor + 10 dB, clamped to −60…−35 dBFS; −45 dBFS uncalibrated | OBS default −40 dB, ZamGate and Faust −60 dB (source); "+10 dB" is a design choice |
| Hysteresis | Close 4 dB below open | OBS 6 dB, LSP 12 dB (source); 4 dB is a design choice |
| Ratio / knee | 2:1 / 9 dB | Calf defaults; OBS expander preset (source) |
| Range | 10 dB (user 0–24 dB) | Calf and LSP default 24 dB (source); 10 dB is the breath-friendly design choice |
| Hold | 150 ms | OBS 200 ms; Faust example 100 ms (source) |
| Opening / closing time | 3 ms / 150 ms | OBS gate release 150 ms, LSP 100 ms (source); 3 ms is a design choice |

```
s = highpass100(x) ; p = aRms·p + (1 − aRms)·s·s ; L = 10·log10(p + 1e-12)
if !open && L > T { open = true } ; if open && L < T − H { open = false }
u = (open ? T − H : T) − L                                    // dB below the threshold in force
a = 0 if u ≤ −W/2 ; (R − 1)·(u + W/2)²/(2·W) if |u| < W/2 ; (R − 1)·u otherwise ; a = min(a, rangeDb)
if a <= g { hold = holdN } else if hold > 0 { hold −= 1 ; a = g }
g = (a < g) ? aOpen·g + (1 − aOpen)·a : aClose·g + (1 − aClose)·a
y = x·10^(−g/20)
```

Three things in the open code should not be copied: ZamGate recomputes a 400-sample RMS window in full every sample and does not scale it with rate; Calf's RMS mode does not apply the same dB slope as its peak mode; and the Faust expander by Bart Brouns is GPL-3.0-only.

### Output protection: a limiter for sustained level, then a clip for the first millisecond

**In plain words:** a limiter with no look-ahead cannot see a peak coming, so by itself it flat-tops the rising edge. A soft clip by itself distorts a held loud note for its whole length. Using both, with the limiter aimed 2 dB below the clip's ceiling, lets each do the part it is good at. When the chain is set up correctly this stage should show no reduction almost all the time.

Only a handful of readable zero-look-ahead peak controllers exist. Nathan Ho's public-domain safety limiter has an instant attack, a 100 ms hold re-armed by every new maximum and a 100 ms release, and its README states "Strictly compresses audio to the [-1, 1] range" and "Some pumping effects are audible if the limiter is pushed hard" ([safety_limiter.hpp](https://github.com/nhthn/safety-limiter/blob/HEAD/safety_limiter.hpp); [README](https://github.com/nhthn/safety-limiter/blob/HEAD/README.md)). The stmlib limiter uses fixed per-sample slopes (0.05 up, 0.00002 down) and a fixed 0.8 output scale ([limiter.h](https://github.com/pichenettes/stmlib/blob/HEAD/dsp/limiter.h)). master_me's "no latency" brickwall has attack 0, release 75 ms and a −1 dB ceiling but rests on GPL-3.0-only functions, and the OBS limiter has a fixed 1 ms attack and 60 ms release ([master_me.dsp](https://github.com/trummerschlunk/master_me/blob/HEAD/master_me.dsp); [OBS limiter-filter.c](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/limiter-filter.c)). Airwindows ClipOnly2, ClipSoftly, ADClip8 and ClipOnly3 each cost one 44.1 kHz sample of delay, and the Calf and LSP limiters are look-ahead designs, so none qualifies ([ClipOnly2Proc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/ClipOnly2/ClipOnly2Proc.cpp)). A simulation confirmed what "instant attack" really does: every sample of a rising edge lands exactly on the ceiling, so the first cycle is hard-clipped, and only then does the held gain give clean reduction (residual below −300 dB on the sustained part, computed).

```
C_out = 0.8913 (−1.0 dBFS ceiling) ; T_lim = 0.7079 (−3.0 dBFS limiter target)      // design choices
aAtt  = exp(−1/(0.0004·fs))      // 0.4 ms          stmlib's 0.05 per sample is about 0.41 ms at 48 kHz
holdN = round(0.100·fs)          // 100 ms          safety-limiter default; never below about 15 ms
k     = 0.001^(1/(0.100·fs))     // −60 dB in 100 ms  safety-limiter default
a = |x|/T_lim
if hold > 0 { f = last ; hold −= 1 } else { f = last·k + a·(1 − k) }
if f > a { amp = f } else { amp = a ; hold = holdN }
last = amp ; target = amp > 1 ? 1/amp : 1
g = (target < g) ? aAtt·g + (1 − aAtt)·target : target
y = x·g ; ay = |y|
if ay > T_lim { y = sign(y)·(T_lim + (C_out − T_lim)·tanh((ay − T_lim)/(C_out − T_lim))) }
if !is_finite(y) { y = 0 }
```

Simulated at 48 kHz with a 220 Hz sine stepping from −12 to +6 dBFS (hold shortened to 30 ms for the test), the output never exceeded 0.8888 against the 0.8913 ceiling, and from 20 ms after the step the peaks sat exactly at −3 dBFS (computed). The arrangement and its level constants are a synthesis; no open project was found that ships exactly this.

The 1 dB of headroom is for peaks between samples. A sample-peak reading under-reads a full-scale sine at 48 kHz by 0.02 dB at 1 kHz, 0.69 dB at 6 kHz and 3.01 dB at 12 kHz (derived). In the researcher's synthetic test, voiced-like noise driven 6–12 dB over the ceiling overshot by at most 0.7 dB even when hard-clipped, but clipped or limited "s"-like noise overshot by 1.5–4 dB (computed). With the de-esser upstream and the limiter target 3 dB down, only a grossly overdriven "s" reaches the clipper; for exported takes, measure true peak offline with 4× oversampling, where latency does not matter. The underlying broadcast standard was not opened, and the reported true-peak figures are secondary.

### Auto-level: measure once, set a trim, then leave it alone

**In plain words:** the earlier report switched a gain rider on by default. The follow-up advises against that for a singer monitoring live: a rider pushes quiet phrases up and pulls loud ones down in the headphones, and the singer starts fighting it. Calibrate at sound-check, set one fixed trim, and offer the rider only as an off-by-default option. No source studied whether riding disturbs performers; this is reasoning plus one author's warning that a time-varying gain "may introduce unwanted volume changes" ([CTAGDRC README](https://github.com/p-hlp/CTAGDRC/blob/HEAD/README.md)).

Open levellers share four safeguards: a slow rate (WebRTC's speech gain control moves 3 dB/s; master_me smooths its gain with a time constant of roughly 5 s; LSP's default is a fast 24 dB/s), a range limit (master_me ±20 dB), a freeze below a silence or voice threshold (LSP −72 LUFS; master_me's "brake"; WebRTC needs 120 ms of confident speech before raising gain), and a faster path downward for surges ([LSP AutoGain.cpp](https://github.com/lsp-plugins/lsp-dsp-units/blob/HEAD/src/main/dynamics/AutoGain.cpp); [lsp autogain.h](https://github.com/lsp-plugins/lsp-plugins-autogain/blob/HEAD/include/private/meta/autogain.h); [master_me.dsp](https://github.com/trummerschlunk/master_me/blob/HEAD/master_me.dsp); [WebRTC agc2_common.h](https://github.com/webrtc-sdk/webrtc/blob/master/modules/audio_processing/agc2/agc2_common.h)). Those defaults are tuned for speech or broadcast loudness, not for preserving musical dynamics.

The recommended calibration measures level while the user sings a loud phrase for a few seconds, using a 400 ms power detector (LSP's long period; master_me's window) that counts only samples above the expander threshold, then sets a static trim so that level lands at −18 dBFS (master_me's default target), clamped to ±12 dB, and checks that peaks stay below about −6 dBFS. The optional rider is a gated integrator: rise 1 dB/s, fall 4 dB/s, a ±1.5 dB dead band, a ±6 dB range, frozen whenever the 10 ms level is under the expander threshold plus 6 dB. The rider's rate, dead band and range are design choices with no measured basis.

### Four open compressor questions, answered as far as the sources allow

**The LA-2A is best read as mainly feedback with a feed-forward share, but no schematic was opened.** A manual reproduction reportedly calls it "a feed-back style compressor" (secondary) ([manualsonline LA-2A page](https://manualsonline.com/manuals/mfg/inova/la2a.html?p=13)); a builders' forum thread reportedly contains both views (secondary) ([GroupDIY thread](https://groupdiy.com/threads/la2a-feedforward-feedback-design.50129/)); and an open fitted model treats the cell as feedback plus an input share that differs between Compress and Limit ([MultiCompOptoCell.hpp](https://github.com/dusk-audio/dusk-audio-plugins/blob/main/plugins/multi-comp/core/MultiCompOptoCell.hpp)). The app's feed-forward optical stage is a legitimate simplification; a feedback blend is optional and its amount is unverified.

**The 1176's release has a fast part and a slow part, and its "colour" is mostly gain ripple.** The manufacturer's manual reportedly describes "a fast release-time, a slow release-time, and a transition-time" (secondary) ([UA 1176AE manual](https://www.manualsdir.com/manuals/293279/universal-audio-1176ae.html?page=22)). One developer's fitted model adds that release slows as reduction deepens (386 ms at 14 dB against 512 ms at 22 dB at 4:1) and describes the harmonics as a small static second- and third-order part that changes sign with the amount of reduction, plus side-chain ripple ([MultiCompModes.hpp](https://github.com/dusk-audio/dusk-audio-plugins/blob/main/plugins/multi-comp/core/MultiCompModes.hpp)). That model is a curve fit to its author's own captures, sampled and not audited. A separate FET waveshaper is therefore optional, and no verified constants exist for one.

**A feedback loop with one sample of delay needs a guard, and open code mostly avoids the issue by accepting a weaker ratio.** With a one-pole coefficient α and a loop slope L (dB of reduction per dB of output overshoot), the loop pole is `1 − (1−α)(1+L)`: stable if `(1−α)(1+L) < 2`, free of alternation if `≤ 1`, with an effective ratio of `1 + L` (derived, then checked by simulation). Squeezer, ZL Compressor and the Faust feedback compressor all reuse the feed-forward slope `1 − 1/R` inside the loop, which can never run away but delivers at most 2:1 (1.75:1 at a nominal 4:1) ([Squeezer compressor.cpp](https://github.com/mzuther/Squeezer/blob/HEAD/Source/compressor.cpp); [Faust compressors.lib](https://github.com/grame-cncm/faustlibraries/blob/HEAD/compressors.lib)). For a true ratio use slope `R − 1` and limit the attack coefficient to `min(nominal, 1/R)`. The shortest clean attack at 48 kHz is then 72 µs at 4:1, 156 µs at 8:1, 239 µs at 12:1 and 406 µs at 20:1 (derived). With the app's 0.4 ms nominal attack at 4:1 the effective attack is about 92 µs, inside the hardware's documented 20–800 µs. Which slope the app's FET stage uses today was not inspected.

**The make-up constant lands at k = 0.8 with the pivot at −12 dBFS.** No source measures it. Energy bookkeeping on an assumed normal distribution of vocal levels gives k between 0.7 and 1.0 for a normally levelled vocal, moving with how dynamic the singer is (computed). The recommendation is a static law smoothed over 30 ms, never driven by programme, with a ±6 dB output trim; the earlier report's 0.7 sits inside the same band. It needs a loudness-meter check in the app.

### The final chain and the four compressor characters

| # | Stage | Why here |
|---|---|---|
| 0 | Static input trim to −18 dBFS gated RMS (rider optional, off) | Every later threshold is defined against a known level |
| 1 | High-pass, then expander | Works on the uncompressed signal, where the gap between voice and noise is largest |
| 2 | De-esser | Before compression, which would otherwise emphasise sibilance; a relative trigger also survives level changes around it |
| 3 | Compressor A, fast (FET) | Catches peaks so the slow stage sees a steadier signal |
| 4 | Compressor B, slow (optical) | Levels the phrase |
| 5 | Static make-up, then tone and colour | Never programme-driven |
| 6 | Limiter, soft clip, finite check | Absolute protection, last |

The order matches the published reference chain the earlier report cited and one complete open chain built for live streaming ([SOS: Vocal Processing](https://www.soundonsound.com/techniques/vocal-processing); [master_me.dsp](https://github.com/trummerschlunk/master_me/blob/HEAD/master_me.dsp)). Thresholds below assume the trimmed −18 dBFS input and are untested starting points.

| | FET (slot A) | Opto (slot B) | VCA / clean | Vari-mu / glue |
|---|---|---|---|---|
| Topology | Feedback from the previous output sample | Feed-forward | Feed-forward | Feed-forward, power-additive law |
| Static law | Soft knee 6 dB; loop slope R − 1 | Soft knee 12 dB (design choice) | Soft knee 6 dB | `gain = exp(−r·ln(20·z))`, `r = 0.5·(1 − 1/R)` |
| Ratio | 4:1; 8, 12, 20 selectable | 3:1 | 3:1 (2–4) | 3:1 nominal, rising with level |
| Attack | Nominal 0.4 ms with the 1/R guard | 10 ms average; plus `48/(3 + GR)` ms | 10 ms (5–20) | 10 ms setting |
| Release | 80 ms (app today); range 50 ms–1.1 s | `480/(3 + GR)` ms, plus the app's 1.5 s tail on a quarter of the reduction | 150 ms (100–250), 10 ms hold | 300 ms setting, two cascaded stages, frozen below threshold |
| Threshold | −18 dBFS at half travel | −22 dBFS | −20 dBFS | −30 dB setting |
| Typical reduction | 3–6 dB on peaks | 2–4 dB average | 3–5 dB | 2–4 dB, slow |
| Make-up | Pivot law, k = 0.8 at −12 dBFS | Same | Same | Built into the law |
| Source | Manufacturer figures; Squeezer feedback switch; stability rule above | Squeezer optical stage | CTAGDRC | x42 darc |

Sources: [Squeezer gain_stage_optical.cpp](https://github.com/mzuther/Squeezer/blob/HEAD/Source/gain_stage_optical.cpp), [CTAGDRC Constants.h](https://github.com/p-hlp/CTAGDRC/blob/HEAD/Source/util/include/Constants.h), [darc lv2.c](https://github.com/x42/darc.lv2/blob/HEAD/src/lv2.c), [UA 1176 tips](https://www.uaudio.com/blogs/ua/1176-collection-tips), [UA LA-2A tips](https://www.uaudio.com/blog/la-2a-collection-tips-tricks/). No colour is added in any character; in the FET, the loop's own ripple at fast settings is the sound.

## The delay, colour, EQ and pitch gaps close with one new port each

### Bucket-brigade delay: port string-machine, 4096 stages short and 8192 long

**In plain words:** the faithful "analog echo" model is no more expensive than the simple one, so cost is not a reason to avoid it. What it adds over a filtered delay is the chip's own aliasing, which on a voice should matter only on sibilants and at long settings; that is reasoning from measured attenuations, and no source reports a listening comparison.

string-machine's constants form two clean fifth-order low-pass filters: the input filter is −3 dB at 6514 Hz and the output filter −3 dB at 8755 Hz, with DC gains of 0.96776 and 0.91384 (computed from the tables). chowdsp's four-term set, taken as an analog filter, is not a low-pass of that order at all: its input "filter" has an inverted DC gain of −0.360 and falls only 6 dB per octave. Its loop also never applies the decay factor inside a sample, sets its gain vector absolutely only when the filter frequency is set, and returns the tick contributions instead of the output bank's state. In a scalar copy of that loop the gain drifted by several dB over successive two-second windows unless the filter frequency was re-set every block, which the wrapper's own comment tells callers to do ([chowdsp_BBDDelayLine.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_dsp_utils/Delay/BBD/chowdsp_BBDDelayLine.h); [chowdsp_BBDDelayWrapper.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_dsp_utils/Delay/BBD/chowdsp_BBDDelayWrapper.h)). It works as a musical effect but should not be described as the published model. The algorithm to port, with conjugate pairs folded into real arithmetic ([bbd_line.cpp](https://github.com/jpcima/string-machine/blob/master/sources/bbd/bbd_line.cpp); [bbd_filter.cpp](https://github.com/jpcima/string-machine/blob/master/sources/bbd/bbd_filter.cpp)):

```
constants (s-plane, rad/s; each complex term has an implied conjugate):
  input : r0 = 251589         p0 = −46580
          r1 = −130428−4165j  p1 = −55482+25082j        r2 = 4634−22873j     p2 = −26292−59437j
  output: r0 = 5092           p0 = −176261
          r1 = 11256−99566j   p1 = −51468+21437j        r2 = −13802−24606j   p2 = −26276−59699j
  H0 = 0.913843 (output DC gain) ; input DC gain 0.967761 ; cascade 0.884382
setup: Ts = 1/fs ; P_m = exp(Ts·k·p_m) ; tables over d = 0..1:
       Gin_m(d) = Ts·k_in·r_m·exp(k_in·p_m·Ts·d) ; Gout_m(d) = (r_m/p_m)·exp(k_out·p_m·Ts·(1 − d))
per sample x, with f = ticks per sample = 2·N/(delay_seconds·fs):
  old = phase ; phase += f ; n = floor(phase) ; phase −= n ; acc = 0
  for t in 0..n−1:
     d = frac((1 − old + t)/f)
     even tick: mem[w] = Gin_0(d)·Xin_0 + 2·Re(Gin_1(d)·Xin_1) + 2·Re(Gin_2(d)·Xin_2) ; w = (w + 1) mod N
     odd tick : y = mem[w] ; delta = y − y_last ; y_last = y ; acc_m += Gout_m(d)·delta
  Xin_m = P_in_m·Xin_m + x ; Xout_m = P_out_m·Xout_m + acc_m
  out = H0·y_last + Xout_0 + 2·Re(Xout_1) + 2·Re(Xout_2)            // divide by 0.88438 for unity gain
```

The researcher's own implementation of this scheme reproduced the predicted DC gain (0.88437) and the nominal delay plus about 0.12 ms of filter delay (300.133 ms for a nominal 300 ms on 4096 stages). With the unscaled filters at 300 ms it measured −1.26 dB at 1 kHz, −4.04 dB at 4 kHz and −13.5 dB at 8 kHz per pass.

| Stages | Delay | Chip write rate | Fixed filters: −3 dB point, protection at half the write rate | Tracking filters: −3 dB point, protection |
|---|---|---|---|---|
| 4096 | 40 ms | 102.4 kHz | 5.37 kHz, −74 dB | Same |
| 4096 | 200 ms | 20.48 kHz | 4.64 kHz, −8.4 dB | 3.50 kHz, −20 dB |
| 4096 | 300 ms | 13.65 kHz | 4.02 kHz, −3.3 dB | 2.33 kHz, −20 dB |
| 8192 | 300 ms | 27.31 kHz | 4.93 kHz, −17.5 dB | 4.66 kHz, −20 dB |
| 8192 | 450 ms | 18.20 kHz | 4.48 kHz, −6.2 dB | 3.11 kHz, −20 dB |
| 8192 | 600 ms | 13.65 kHz | 4.02 kHz, −3.3 dB | 2.33 kHz, −20 dB |

All figures in the table are computed from the analog prototype. The tracking law, `k = min(1, (N/delay)/29200)`, places half the write rate at the input filter's −20 dB point and is a design choice. The recommendation replaces the earlier report's "2048–4096 stages": **4096 stages for 40–300 ms and 8192 for 300–600 ms**, offered as a "short/long" mode and not switched automatically, because the tone jumps at the switch point. Leaving the filters fixed reproduces the sound of a pedal turned past its design range. The faithful model cost 13–24 ns per sample at vocal echo times (0.06–0.12 % of a core) against 16 ns for a plain interpolated delay with four filters and a `tanh` (measured). Companding is still absent from every open delay read; Surge holds the only open compander pair, a `|x|^1.25` detector with divide and multiply, and its own effect does not use it ([Surge BBDCompander.h](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/bbd_utils/BBDCompander.h)).

### Oversampling: new coefficient sets, and the 48 kHz set is safe at 44.1 kHz

**In plain words:** the app is not wrong today when it runs its 48 kHz filter at 44.1 kHz. The audible band stays flat and clean; only the top 18.4–22 kHz band has weaker protection, where nothing on a voice is audible. A dedicated 44.1 kHz set is a refinement, not a fix.

The designer in HIIR 1.30 (a "do what you want" public licence) was compiled and run; pass-band ripple to 20 kHz is below 0.000001 dB for every row, and all values are computed ([PolyphaseIir2Designer.h](https://github.com/unevens/hiir/blob/master/hiir/PolyphaseIir2Designer.h); [license.txt](https://github.com/unevens/hiir/blob/master/hiir/license.txt)).

| Base rate | n | Rejection | Coefficients (even-indexed to path 0, odd-indexed to path 1) | Round trip at 1 / 10 kHz |
|---|---|---|---|---|
| 44.1 kHz | 6 | 78.19 dB | 0.062824925104447, 0.223816397420371, 0.424398550207196, 0.616559435383753, 0.781885756623747, 0.927484455444490 | 52.7 / 71.0 µs |
| 44.1 kHz | 7 | 91.15 dB | 0.047668042515431, 0.174489415052202, 0.343093382538367, 0.516950859627934, 0.674728251071444, 0.812016321899558, 0.937005924369714 | 62.5 / 83.6 µs |
| 44.1 kHz | 8 | 104.10 dB | 0.037365116712056, 0.139361824799350, 0.281346011403855, 0.436261826848342, 0.584461170840528, 0.717065429699382, 0.834582043500380, 0.944304068888582 | 72.4 / 96.2 µs |
| 88.2 kHz | 2 | 66.92 dB | 0.131218983196992, 0.573539197251902 | 11.8 / 12.6 µs |
| 88.2 kHz | 3 | 96.09 dB | 0.066374826500090, 0.274208604793756, 0.675123610897147 | 18.6 / 19.7 µs |
| 96 kHz | 2 | 70.93 dB | 0.126620435698744, 0.565795715233128 | 11.0 / 11.6 µs |
| 96 kHz | 3 | 101.71 dB | 0.063787836824299, 0.266780962497159, 0.668548793183610 | 17.3 / 18.2 µs |
| 48 kHz (existing) | 5 | 80.63 dB | 0.061090700071086, 0.221065199762536, 0.430463831503146, 0.650964800633457, 0.876656677083713 | 45.9 / 58.1 µs |

The 96 kHz sets are the same numbers the earlier report listed as the second stage of a 4× chain, so at a 96 kHz device rate the app can run its second-stage filter as the only stage. Run unchanged at 44.1 kHz, the 48 kHz set loses 0.0049 dB at 20 kHz round trip and still rejects by 80.6 dB everything that would fold below 18.4 kHz; fold-back at 19 kHz is rejected by 53.9 dB and at 20 kHz by 32.5 dB (computed). If a dedicated set is added, use n = 6 for parity or n = 8 for the 100 dB tier; at 96 kHz use n = 3. The delay depends on frequency (2.2 samples at 1 kHz, 2.8 at 10 kHz at 48 kHz), so an integer-sample dry delay can only approximately align a dry/wet mix. Single-precision rounding of the coefficients was not checked.

### Colour: add Weave, fix Channel9 at 2×, scale the tape head bump

**In plain words:** one new colour is worth adding. Weave is what the Airwindows author uses on voice, it is about fifteen lines with no latency, and it limits itself. Two existing colours need a correction when run inside the 2× oversampler.

**Weave** (MIT) is a memoryless curve plus a small correction from the differences of what the curve removed ([WeaveProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Weave/WeaveProc.cpp)):

```
x = in·gIn ; dry = x                      // gIn = A·10 ; A = 0.1 is unity drive
if x != 0 { x = clamp(x, −1, 1)·1.27 ; w = sqrt(|x|) ; x = sin(x·w)/w }
dvA = dry − x ; dvB = pvA − dvA ; pvA = dvA ; dvC = pvB − dvB ; pvB = dvB
dvD = pvC − dvC ; pvC = dvC ; dvE = pvD − dvD ; pvD = dvD
x *= 1 + |dvC|·0.0618 − |dvD|·0.05982 + |dvE|·0.0206
out = x·gOut
```

Its author writes that it "became the default saturation in my video-making vocal chain" ([Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)). Computed from the code: small-signal gain 1.27 (+2.08 dB, to be compensated in the amount mapping), an output ceiling of 0.8787 for any input at or above full scale, odd harmonics only, and a third harmonic of −66 dB at an input of 0.25, −42 dB at 0.5 and −19 dB at 1.0. The curve ports unchanged into the 2× stage; the difference term changes the fundamental by less than 0.06 dB below clipping and can be kept or dropped. Of the other plugins the author recommends for voice, **Silken** cannot go in the live path because it is a phase-linear filter with latency and pre-echo, and **BrightAmbience2**, twenty prime-spaced taps from 8.5 to 23.4 ms at 44.1 kHz, is a candidate "vocal glitter" early-reflection type whose tap tables must be copied with attribution ([SilkenProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Silken/SilkenProc.cpp); [BrightAmbience2Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/BrightAmbience2/BrightAmbience2Proc.cpp)).

**Channel9 inside a 2× oversampler** has three rate effects, not one. Halving the slew threshold restores the base-rate behaviour to first order, because both the trigger sensitivity and the allowed step scale with the sample period, but the four-tap detector is not an ideal differentiator: the match is within about 3 % up to 2 kHz and the clamp over-triggers by up to 26 % around 6–8 kHz (computed). Second, the two "ultrasonic" filters are bypassed at 44.1 and 48 kHz in the Neve and API voicings and switch on at 96 kHz, adding a net +1.16 dB at 20 kHz in the Neve voicing (computed). Third, the high-pass is already rate-compensated ([Channel9Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Channel9/Channel9Proc.cpp)). The code should pick one target explicitly. For "Channel9 as it sounds at 48 kHz": halve the threshold **and bypass the two ultrasonic filters**, or move the slew clamp after the down-sampler at the original threshold for an exact match. For "Channel9 at 96 kHz": leave the threshold alone, in which case the clamp hardly ever engages on a voice. The author deliberately does not scale the threshold, so the second is the shipped behaviour and not a bug.

**ToTape6's head bump**, exactly as coded, is two interleaved copies of an integrator bounded by `sin`, a cubic leak and a slow pull toward zero, followed by what is in effect a DC blocker ([ToTape6Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/ToTape6/ToTape6Proc.cpp)):

```
os = fs/44100 ; control = C·0.25·inputgain ; leak = 0.12/os
band-pass: f = 0.007/os, Q = 0.0009 (two copies A and B, updated on alternate samples)
on A's turn: hA += x·0.05 ; hA −= hA³·leak ; hA = sin(hA) ; hA = asin(clamp(bandpassA(hA), −1, 1))
every sample: pull = (1 − |y|)·0.00013 ; move hA and hB toward zero by pull
y += (hA + hB)·control
```

Measured in isolation at 44.1 kHz it is a level-dependent low shelf starting around 200–400 Hz, not a narrow bump: +1.3 dB at 100 Hz for an input of 0.1 and +1.7 dB for 0.5 at the default, but +8.6 dB at 30 Hz on very quiet material (computed). The increment 0.05 and the pull 0.00013 are not rate-scaled in the code, so run as coded at 96 kHz the bump is about 6.6 dB stronger; dividing both by `os` restores the 44.1 kHz result within about 0.1 dB (computed). Either run it at the base rate outside the oversampler exactly as coded, or inside the 2× stage with all four constants divided by `os`. Both copies are required.

### Width and ducking: a Dimension mode on stated numbers, and a mono-safe widener

**In plain words:** the earlier report said a "Dimension" chorus would have to be tuned entirely by ear. There is now a stated, if second-hand, parameter set to start from. The micro-pitch widener still has no verified hardware values.

No circuit-level or measured open model of the hardware exists. One MIT project, octabam, states numbers it attributes to the service notes and published measurements: two delay lines on one triangle LFO in antiphase, 0.25 Hz in modes 1 and 2 and 0.5 Hz in modes 3 and 4, sweeps of 5→12, 5→10 and 6→9 ms, and each output built from the dry signal plus the other side's wet signal inverted through a high-pass. It says outright that its mix amounts (same-side 0.25, cross −1, bass lift 0.5, 200 Hz corners) "were voiced here, not taken from the notes" ([octabam modulation README](https://github.com/sambanks/octabam/blob/main/modules/modulation/README.md); [modulation_ref.py](https://github.com/sambanks/octabam/blob/main/modules/modulation/modulation_ref.py)). Those service notes were not read, and which sweep belongs to which mode is implied by order only, so treat the figures as secondary. With those weights the effect is stronger in stereo than in mono but does not vanish in mono, and because the two voices move in opposite directions their sum has no net pitch drift (arithmetic on the cited weights). For the H3000, only parameter ranges and preset descriptions are open, not the preset's values, so the existing ±5–10 cent two-head shifter remains an unverified stand-in ([eventide-h3000-editor preset-data.js](https://github.com/saulclap/eventide-h3000-editor/blob/main/preset-data.js)).

The safest "Haas" widener for mono compatibility is the sst-effects structure: add a delayed copy (default 30 ms, +6 dB) to the side channel only, so left is voice plus delayed copy, right is voice minus delayed copy, and the mono sum is exactly the dry voice ([sst-effects Widener.h](https://github.com/surge-synthesizer/sst-effects/blob/main/include/sst/voice-effects/delay/Widener.h)). Airwindows Wider reshapes an existing stereo signal and does nothing useful on a mono voice.

A second open ducking implementation was found, in the Odin 2 delay. Like Cocoa Delay it follows the dry input and scales the wet output only, leaving feedback untouched; its follower is a symmetric one-pole of about 10 ms, not rescaled for other sample rates, with full ducking once the smoothed level reaches 0.2 ([odin2 Delay.cpp](https://github.com/TheWaveWarden/odin2/blob/master/Source/audio/FX/Delay.cpp)). Two independent sources now agree on the simple design. Neither uses a ratio or threshold, so a dB-domain ducker remains a design choice.

### EQ characters: the Pultec formulas are confirmed; the Neve stays a fitted style

**In plain words:** the three Pultec formulas in the earlier report are correct and can be coded from the public passive circuit without copying anyone's code. Nothing circuit-level is open for a 1073-style EQ, so a "Neve" character must remain a fitted style and should be named as one.

The researcher re-derived the whole passive network independently and a symbolic check confirmed each closed form equals the network exactly. That matters for licensing: the wave-digital model that supplied the component values ships the GPL version 3 text with no "or any later version" statement anywhere, so it is read as GPL-3.0-only, and it contains no transfer function to copy in any case, only an adaptor tree ([EQP-WDF-1A LICENSE](https://github.com/ABSounds/EQP-WDF-1A/blob/main/LICENSE); [EQP1A.h](https://github.com/ABSounds/EQP-WDF-1A/blob/main/Source/EQP1A.h)). The component values are that author's tuned set from a Master's thesis, which the app should credit. This is an engineering reading, not legal advice.

The low boost-and-attenuate biquad stands exactly as printed in the earlier report. New details for coding it: clamp both pot fractions to at least 1e-4, because at exactly zero the bilinear form carries a cancelling pole-zero pair at the top of the band; the plain bilinear transform at 48 kHz is within 0.041 dB of the analog curve from 10 Hz to 20 kHz, so no pre-warping is needed; and a make-up of 15.5 instead of the repository's 15.4882 gives exactly 0 dB at high frequencies (computed). With both pots at half travel the section gives an +11.72 dB shelf with a −5.43 dB dip at 601 Hz on the 60 Hz switch. The high boost is the peaking section already given, with pole and zero damping set separately; the pole Q is not monotonic in the boost pot, falling to about 0.96 at half travel and rising to 2.79 at full boost on the sharp setting, and at half boost the three bandwidth settings differ by only 2.2 dB, so a "Pultec air" preset is a broad low-Q lift unless the boost is near maximum. The high cut now has a closed form:

```
hc in [0, 1] ; C = 270 nF (5 k), 135 nF (10 k), 68 nF (20 k) ; Rx = 1000·(1 − hc) ; tau = C·1000·hc
H(s) = 155e6·(1000 + s·tau·Rx) / (1000·(155e6 + s·tau·(132e6 + 23000·Rx)))
```

One interaction limits the three-separate-sections approach. Low and high boost combine within 0.05 dB at normal settings, but **high boost and high cut together do interact**: 0.88 dB of error at moderate settings and 15 dB with both at maximum, because the cut changes the load the resonator works into (computed). Use the high cut only when the high boost is off, or evaluate the pair jointly.

For the 1073, the only open source is still EQ1979, a response fit of about thirty cascaded filters with the same licence situation, and the one further emulation found has no licence file at all ([eq1979 readme](https://github.com/D4p0up/eq1979/blob/main/readme.md); [neve1073eq EQFilters.h](https://github.com/bbunny669/neve1073eq/blob/main/Source/EQFilters.h)). The defensible route is the app's own matched bell with gain-dependent Q, re-fitted against published response plots and not copied.

### Live pitch correction: 3.3 ms idle, about 2 ms plus one pitch period while correcting

**In plain words:** the tuner's "fast" mode is still the only open design that fits a monitoring path, and its delay has now been measured, not just derived. The honest label is "3.3 ms when idle or in tune, rising by up to one cycle of the sung note while it corrects", which reaches about 12 ms on a very low note. The dry path must be muted while it is on.

The researcher compiled the retuner and its embedded resampler unmodified against a small FFT shim and measured the delay with noise and with a single impulse ([retuner.cc](https://github.com/x42/fat1.lv2/blob/master/src/retuner.cc); [fat1.cc](https://github.com/x42/fat1.lv2/blob/master/src/fat1.cc)).

| Condition at 48 kHz | Normal mode | Fast mode |
|---|---|---|
| Reported by the plugin | 1056 samples | 160 samples |
| Measured, unvoiced or in-tune input | 1055.5 samples (21.99 ms) | **159.5 samples (3.32 ms)** |
| 226 Hz corrected to 220 Hz | 22.4–23.5 ms | 3.7–4.6 ms |
| 452 Hz corrected to 440 Hz | 22.2–23.5 ms | 3.5–4.8 ms |
| 113 Hz corrected to 116.5 Hz | 24.5–25.5 ms | 5.7–6.7 ms |
| 82.41 Hz | 26.1–29.8 ms | 7.5–12.3 ms |

At 44.1 kHz the fast-mode figure is 3.62 ms and at 96 kHz 2.66 ms (measured). The delay floats because, at each 128-sample fragment boundary, the read pointer jumps by a whole number of pitch periods to stay inside a window; rearranged, the total latency in fast mode lies between 96 and 96 + J samples, where J is the jump length: one period below 375 Hz (218 samples at 220 Hz, 582 at 82.4 Hz) (derived from the code). Those bounds are firmer than the measured rows, which have a resolution of roughly ±0.3 ms and used steady test tones, not sung input.

A faithful port needs about 12,830 floats of state (51 kB), nothing allocated after start-up, and one 2048-point real FFT pair every 512 samples. The unmodified code cost 254 ns per sample at 48 kHz (1.2 % of a core) with a deliberately slow FFT (measured). The port's acceptance tests come straight from the measurements: an impulse must emerge at 1055.5 samples in normal mode and 159.5 in fast mode, a 226 Hz tone must emerge at 220.0 Hz, and unvoiced noise must return to the nominal delay within one fragment. Two details are worth knowing. The −45 dBFS level gate that would stop room noise triggering corrections is compiled only in a special build, so the port should add it. And the constructor's "pre-feed" that claims to remove delay consumes nothing as written. Replacing the 64-tap up-sampler with the app's existing half-band filter would cut roughly 31 samples from the fixed latency; **that substitution is the researcher's proposal and is untested**.

No GPL-compatible tuner from 2024–2026 improves on this. The one genuinely new low-latency design, Flayr Tune, describes a live mode of "about 1.5 ms on high notes up to about 10 ms on a low male voice" with formant handling, which confirms that a couple of milliseconds plus one period is the practical floor for splice-based tuners; but it is AGPL-3.0 and nothing in it can be reused ([flayr-tune README](https://github.com/FlayrLabs/flayr-tune/blob/main/README.md)). OpenTune (MIT) advertises zero latency but has no period-synchronous splice and no cross-fade, so it is not a quality reference ([opentune PluginProcessor.cpp](https://github.com/bemtorres/opentune/blob/main/Source/PluginProcessor.cpp)).

## Licences: everything recommended can be ported, six sources are formula-only, AGPL code stays off limits

**In plain words:** nothing found in the follow-up blocks the build. The two open licence questions from the earlier report (Calf, and one Chowdhury module) are settled, and the new sources sort cleanly into three groups. This is a reading of licence texts, not legal advice.

| Verdict | Sources | Licence as found | Note |
|---|---|---|---|
| **Port, keep the notices** | freeverb3 `progenitor2` and `nrevb`; Guitarix GxShimmizita; ZamGate; x42 darc; fat1 `retuner.cc` and `fat1.cc` | GPL-2.0-or-later | `progenitor` also credits David Griesinger in its header |
| | chowdsp spring and BBD copy in Surge; sst-effects Widener; Odin 2 delay; Squeezer; CTAGDRC; dusk-audio; fat1's embedded resampler | GPL-3.0-or-later | dusk-audio used as knowledge only: a fitted model far too large to port |
| | Airwindows (Chamber, kChamberAR, DeEss, DeBess, Weave, BrightAmbience2, ClipOnly2, ToTape6, Channel9); CloudSeedCore; Oliverb; stmlib; octabam; OpenTune | MIT | CloudSeedCore's README asks for credit; BrightAmbience2's prime tables need attribution |
| | nhthn safety-limiter; HIIR; string-machine | Unlicense; WTFPL; BSL-1.0 | |
| | LSP Gate, AutoGain; Calf Deesser, Gate | LGPL-3.0-or-later; LGPL "version 2 or later" per file | See the Calf paragraph below |
| | Faust `gate_mono`; WebRTC AGC2 | MIT-style; BSD-style with a patent grant | AGC2 supplied constants only |
| **Formula reference only: re-implement from the mathematics** | chowdsp_utils modules (`chowdsp_compressor`, the BBD in `chowdsp_dsp_utils`) | "GPLv3", no "or later" wording found | Combinable, but copying would pin the combined work to version 3 |
| | Faust expander and feedback compressors by Bart Brouns; master_me | GPL-3.0-only; "GPLv3" resting on those functions | |
| | EQP-WDF-1A; EQ1979 | GPL version 3 text with no "or later" grant | Treat as GPL-3.0-only |
| | OBS expander, gate and limiter filters | No per-file header; repository is GPL-2.0 with "or later" in core files | Inferred, so safest to re-implement |
| **Do not port** | ZL Compressor; Flayr Tune; BellyDSP chorus prototype | AGPL-3.0 | Study at most |
| | Cloud Seed 2 preset bank; T-De-Esser; Spitfish | Proprietary or closed freeware (the last two secondary) | |
| | `neve1073eq`; two recent tuner repositories; the H3000 editor | No licence file | Published ranges and frequency lists are facts; the code is not usable |

Sources: [Calf modules_comp.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/modules_comp.cpp), [Calf README](https://github.com/calf-studio-gear/calf/blob/HEAD/README.md), [Calf COPYING](https://github.com/calf-studio-gear/calf/blob/HEAD/COPYING), [chowdsp_compressor.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/HEAD/modules/dsp/chowdsp_compressor/chowdsp_compressor.h), [chowdsp LICENSE.md](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/HEAD/LICENSE.md), [parasites README](https://github.com/mqtthiqs/parasites/blob/master/README.md), [gx_shimmizita.cpp](https://github.com/brummer10/guitarix/blob/master/trunk/src/LV2/gx_shimmizita.lv2/gx_shimmizita.cpp), [string-machine LICENSE](https://github.com/jpcima/string-machine/blob/master/LICENSE), [flayr-tune LICENSE](https://github.com/FlayrLabs/flayr-tune/blob/main/LICENSE), [BellyDSP LICENSE](https://github.com/SeanSnaider/BellyDSP/blob/main/LICENSE), [faust compressors.lib](https://github.com/grame-cncm/faustlibraries/blob/HEAD/compressors.lib).

**Calf is settled.** Its DSP files still carry "either version 2 of the License, or (at your option) any later version" in their headers, while the project README and licence summary now say "LGPL-2.1-only". The contradiction does not matter for this app: LGPL 2.1 section 3, quoted from Calf's own licence file, lets a copy be converted to the ordinary GPL "version 2" or "a newer version". When porting a specific Calf file, cite its per-file header and keep the notice. Several Calf headers carry no LGPL notice at all and need checking individually before use.

**chowdsp_compressor is settled conservatively.** Its module header says only "license: GPLv3", the files beneath it contain no licence text, and neither the repository licence file nor the README adds "or later". Its header also warns "This module is currently unfinished!". Read it for ideas and write the code from the formulas. The author was not asked what "GPLv3" is meant to cover.

## What this research cannot tell you

**Nothing was listened to.** Every "default vocal setting" outside the Dragonfly, CloudSeedCore and Surge presets is a starting point for tuning in the app. The transparency ranking of de-essers, the breath-friendly range, the advice against live gain riding, the audibility of bucket-brigade aliasing and the claim that six topologies will sound like six reverbs are all reasoning from code and measurements. No readable source ranks any of these designs on voice by listening test, and the two shimmers were not even rendered to audio.

**Many hosts were unreachable, so several facts are second-hand.** For page content only GitHub could be opened. Forum and vendor pages stayed blocked (KVR, Gearspace, airwindows.com, valhalladsp.com, soundonsound.com, uaudio.com, groupdiy.com and the manual-hosting sites), so there is still no independent evidence of which engines engineers prefer on vocals, and the LA-2A topology, the 1176 release description and the inter-sample-peak figures are secondary. The paper hosts stayed blocked too, so none of these was read: the Holters and Parker bucket-brigade paper, the two spring-reverb papers, the compander paper Surge cites, the echo-density paper (its method was applied from memory), the soft-knee compressor paper, the true-peak standard and the Lexicon manual behind the room's tap weights. The claim that string-machine carries the paper's numbers is an inference from internal consistency. The Dimension figures are one young single-author repository's reading of service notes nobody here opened. Searches for newer tuners, wideners and console EQs covered GitHub only.

**Timings are C++ on a shared virtual machine.** They come from the reference code on one core of a 2.1 GHz virtualised Xeon with one compiler. Ratios between engines are the useful part; absolute numbers will differ on the target PC and in Rust, and nothing was profiled, so statements about where the time goes (`floor()` calls, denormal checks, cache misses, dither) are inferences from flag-to-flag differences. The Cloud and Spring rebuild savings are estimates. The tuner was timed with a deliberately slow FFT.

**The measurements have their own limits.** Echo density is one proxy with a 20 ms window; modal density and colouration were not computed. No reverb was rendered at all three sample rates. The de-esser, limiter and feedback-loop checks used synthetic tones and noise, not recordings, and whether real sung vowels stay under the de-esser's threshold was not measured. The tuner's delay under correction was read from the phase of a slow envelope on steady tones; vibrato and note transitions were not tested. The oversampler's rejection figures are filter responses, not programme measurements, and single-precision coefficient rounding was not checked. The tape head bump was simulated in isolation, not inside the complete plugin.

**Some code was not read.** The newer Airwindows plates and rooms, kPlateA's siblings, several Airwindows clippers, LSP's loudness meters and expander, the legacy Cloud Seed generator, the original spring implementation the Surge copy derives from, and upstream zita-at1 (all statements are about the copy in fat1) remain unread. Dragonfly's vendored freeverb3 was not compared with the latest upstream release. The fitted compressor model was sampled, not audited. **The app's own code was not part of this task**: every "app today" value comes from the brief, and three questions about it stay open, namely whether its soft clip is linear below its knee, which slope its FET loop uses, and how the de-esser's phase rotation interacts with the compressor's peak detection.

## Conclusion

The follow-up moves the project from "what could be built" to "what to build next and how to know it worked". Two things are new in kind, not just in quantity. First, the ports now come with acceptance tests drawn from the original code: the Cloud generator's check values and line lengths, the room's integer sizes at the default preset, the tuner's impulse at 159.5 samples, the bucket-brigade line's DC gain of 0.884. A port either reproduces those numbers or it is wrong, which replaces a good deal of ear-guessing with arithmetic. Second, the measurements exposed how often the shipped behaviour of respected open code differs from its description: a plugin mode that no longer runs its named algorithm, a model whose constants do not form the filters it cites, a "delay-removing" pre-feed that consumes nothing, a de-esser that cannot work at high sample rates. Reading descriptions was never enough, and the same scepticism should now be turned on the app's own code, which neither pass inspected.

The remaining risk has shifted from availability to taste. Every design choice in the dynamics chain, every non-preset reverb default and both rebuild cost estimates wait on a listening session and a benchmark on the target machine. A sensible order is the cheap, high-certainty changes first (de-esser release and soft law, expander range and hold, limiter ahead of the clip, the FET guard, the corrected oversampler delay), then the Room and Chamber ports that give the largest audible change per line of code, then Cloud, the bucket-brigade line and the shimmer taps, with the Spring last. Three areas remain without any open circuit-level source and should be labelled as styles in the interface until that changes: the 1073-style EQ, the Dimension chorus mix and the micro-pitch widener's values.
