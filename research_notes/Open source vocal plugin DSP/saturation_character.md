# Saturation / preamp / tape / console "analog character" processors for a zero-latency vocal chain, and the anti-aliasing that makes them studio-grade (source-level notes, Nov 2026)

Evidence tags used on every line:
- **[SRC]** = I read the actual source file in this session (repos cloned 2026-11-18; Airwindows HEAD dated 2026-11-14, chowdsp_utils 2025-12-09, AnalogTapeModel 2023-11-05, BYOD 2025-08-13, sst-waveshapers 2026-02-25).
- **[CALC]** = number computed by me in this session from the cited source formulas (scripts were throw-away; the method is stated). Not a published figure.
- **[2ND]** = secondary: search-result snippet or vendor/forum text; I did not open the primary document.
- **[MEM]** = from memory, not verified in this session. Treat as unverified.

Hosts I could NOT reach from this sandbox (so nothing from them is first-hand): dafx.de, ccrma.stanford.edu, normankoren.com, airwindows.com, arxiv.org, gearspace.com, ldesoras.fr/free.fr, kvraudio.com (403), api.github.com. The Parker 2016 and Bilbao 2017 papers, Koren's article, and Chris Johnson's blog posts were therefore not read directly; I used the code that implements them, the Airwindopedia text in the Airwindows repo, and the DAFx-19 tape paper's LaTeX source that ships in the CHOW Tape repo.

Short URL prefixes used below:
- `AW/` = https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/
- `CT/` = https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Plugin/Source/Processors/
- `CU/` = https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/

---

## 1. For each candidate: licence (SPDX, GPL-3.0-or-later compatibility), author, repo, and how engineers regard it on vocals

### Takeaway
Everything needed can be taken from MIT / BSD / WTFPL / LGPL / GPL-2.0-or-later / GPL-3.0 sources: Airwindows (MIT) supplies the best ready-made zero-latency tube, console and tape curves; CHOW Tape (GPL-3.0) supplies the only open physically based tape hysteresis; HIIR (WTFPL) supplies the oversampler. I found no reliable, vocal-specific engineer ranking of these plugins: the praise I could source is general, so "most praised on vocals" is not established by evidence.

### Cited Findings

Licence table (what the repo itself says):

| Candidate | Author | Licence as found | Usable in GPL-3.0-or-later project? | Evidence |
|---|---|---|---|---|
| Airwindows (all plugins: ToTape5-9, TapeHack, IronOxide5, Tube/Tube2, Channel4-9, Console*, PurestDrive, Density2, Spiral2, Mojo, Dyno, UnBox, Focus, Interstage, Coils2, Exciter, ClipOnly2...) | Chris Johnson | MIT ("MIT License, Copyright (c) 2018 Chris Johnson") | Yes | [SRC] [LICENSE](https://github.com/airwindows/airwindows/blob/master/LICENSE) |
| CHOW Tape Model | Jatin Chowdhury | GPL-3.0 (README: "licensed under the GNU General Public License (GPLv3)"; LICENSE is the GPLv3 text; I did not find "or later" wording) | Yes, but treat as GPL-3.0-only: the combined binary is then GPL-3.0 | [SRC] [README](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/README.md) |
| chowdsp_utils | Chowdhury-DSP | Per module. `chowdsp_waveshapers`, `chowdsp_dsp_utils`, `chowdsp_filters`: GPLv3. `chowdsp_math` (tanh antiderivatives), `chowdsp_simd`, `chowdsp_core`: BSD 3-clause | Yes. Note the GPL modules sit on JUCE; port the maths, do not link | [SRC] [LICENSE.md](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/LICENSE.md), module headers e.g. [chowdsp_waveshapers.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_waveshapers/chowdsp_waveshapers.h) |
| ADAA (demo plugin: hard clip, tanh, 1st/2nd order, LUT variants) | Jatin Chowdhury | BSD-3-Clause | Yes | [SRC] [repo](https://github.com/jatinchowdhury18/ADAA) |
| chowdsp_wdf (wave digital filters) | Chowdhury-DSP | BSD-3-Clause | Yes | [SRC] [LICENSE](https://github.com/Chowdhury-DSP/chowdsp_wdf/blob/main/LICENSE) |
| ChowCentaur / KlonCentaur | Jatin Chowdhury | BSD-3-Clause | Yes | [SRC] [README](https://github.com/jatinchowdhury18/KlonCentaur/blob/master/README.md) |
| BYOD (Dirty Tube, Junior B, Blonde, Warp, Centaur, hysteresis...) | Chowdhury-DSP | GPL-3.0 (README says "dual-licensed under the General Public License Version 3" plus a commercial option) | Yes (GPL-3.0) | [SRC] [README](https://github.com/Chowdhury-DSP/BYOD/blob/main/README.md) |
| Surge XT effects (Exciter, Tape, Neuron) | Surge Synth Team; Exciter and Tape by Jatin Chowdhury | GPL-3.0-or-later (file header: "released under the GNU General Public Licence v3 or later") | Yes | [SRC] [ExciterEffect.cpp](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/ExciterEffect.cpp) |
| sst-waveshapers (Surge's 40-odd shapers, SIMD first-order ADAA) | Surge Synth Team | GPL-3.0-or-later (header: "GNU General Public License 3 or later") | Yes | [SRC] [ADAA.h](https://github.com/surge-synthesizer/sst-waveshapers/blob/main/include/sst/waveshapers/ADAA.h) |
| Calf Saturator / Exciter / (tap_distortion) | Krzysztof Foltman, Markus Schmidt, Thor Harald Johansen; distortion core "by Tom Szilagyi" | LGPL-2.1 text; file header "version 2 of the License, or (at your option) any later version" (LGPL-2.0-or-later) | Yes | [SRC] [audio_fx.cpp](https://github.com/calf-studio-gear/calf/blob/master/src/audio_fx.cpp) |
| TAP TubeWarmth (original LADSPA) | Tom Szilagyi | GPL-2.0-or-later [MEM]; I could not fetch the original file, only Calf's port | Yes if "or later" holds; verify before copying from the original | gap, see below |
| Guitarix (12AX7/6V6 table-based tube stages) | Guitarix devs (Hermann Meyer, James Warden, Andreas Degert, Pete Shorthose...) | "GPL version 2 or later" for Guitarix's own code; some bundled files GPL-3+ / LGPL-3+ | Yes | [SRC] [COPYING](https://github.com/brummer10/guitarix/blob/master/trunk/COPYING) |
| HIIR (polyphase half-band IIR oversampling) | Laurent de Soras | WTFPL v2 | Yes | [SRC] license.txt in mirror [unevens/hiir](https://github.com/unevens/hiir) (mirror is HIIR 1.30, header-only) |
| Wolf Shaper | Patrick Desaulniers | GPL-3.0 (LICENSE text) | Yes | [SRC] [LICENSE](https://github.com/wolf-plugins/wolf-shaper/blob/master/LICENSE) |
| Temper (Creative Intent) | Nick Thompson | GPL-3.0 (LICENSE text); DSP is a Faust file | Yes | [SRC] [temper.dsp](https://github.com/creativeintent/temper/blob/master/Dsp/temper.dsp) |
| zam-plugins (ZamTube etc.) | Damien Zammit | COPYING is GPLv2 text; "or later" not checked | Check per-file headers before use | [SRC] [COPYING](https://github.com/zamaudio/zam-plugins/blob/master/COPYING) |
| JUCE (dependency of all chowdsp/Surge plugin code) | Raw Material / PACE | JUCE 8 is AGPLv3 or commercial [MEM] | Flag: do not pull JUCE into a Rust GPL project; port formulas only | not verified this session |
| Klanghelm IVGI | Klanghelm | Freeware, no source found | NOT usable (closed) | [2ND] [klanghelm.com/IVGI](https://klanghelm.com/IVGI) |
| Tritik Krush | Tritik | Freeware, no source found | NOT usable (closed) | [2ND] [BPB](https://bedroomproducersblog.com/2016/03/13/tritik-krush-bitcrusher/) |
| BPB Saturator | Bedroom Producers Blog | Freeware; no repository or licence found | NOT usable unless a source release is located | [2ND] search only |

Regard / reputation findings:
- The Airwindows author's own "Starter Kit" places Channel9 in the tone-colour group and treats Console as its own category; forum users call the Channel / BussColors family "meat-and-potatoes console/media/hardware emulations or approximations". [2ND] [Airwindows Starter Kit](https://airwindows.com/airwindows-plugins-starter-kit), [KVR thread](https://www.kvraudio.com/forum/viewtopic.php?p=7528438)
- Chris Johnson states that Weave "became the default saturation in my video-making vocal chain" and replaced TapeHack as the saturation inside ConsoleX3. This is the only explicit vocal-chain statement by the author that I found in the Airwindopedia. [SRC] [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)
- Author's descriptions (same file): ToTape6 "perhaps THE killer tape emulation to beat for all that it's an abstraction and not meant to be any specific tape machine"; ToTape8 "tape emulation with gain staging, bias and optimized Dubly"; Channel9 "the same calibrated Airwindows algorithms to not clone, but give you the general sense of various fancy name brand consoles in a cleaner, less 'emulated' way"; PurestDrive "the magic saturation plugin of subtlety"; Mojo "thickens and fattens the sound without any real EQ change"; Focus "brings out clarity by distorting"; UnBox "a distortion where only the harmonics that don't alias are allowed to distort". [SRC] [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)
- CHOW Tape: KVR user reviews call it "by far the closest to actual tape 'vibe' that I've come across in a plugin" and "probably the most versatile and brilliant sounding tape simulator out there at the moment". These are user opinions from 2020-2022, not vocal-specific. [2ND] [KVR reviews](https://www.kvraudio.com/product/chow-tape-model-by-chowdhury-dsp/reviews)
- Surge's Exciter is, per its code, an Aphex-style side chain (high-pass, level detector, tanh, mix); the Sound On Sound description of the hardware matches that topology. [SRC] [ExciterEffect.h](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/ExciterEffect.h); [2ND] [SOS: How enhancers work](https://www.soundonsound.com/techniques/how-enhancers-work)

### Inferences
- Because Airwindows is MIT and written as plain per-sample C++ with no framework dependency, it is the lowest-risk source to port line-for-line to Rust. CHOW Tape's hysteresis core (`HysteresisOps.h`) is also framework-free apart from xsimd and can be ported under GPL-3.0.
- A GPL-3.0-or-later project that includes GPL-3.0-only code (CHOW Tape, BYOD, Temper, Wolf Shaper) can still be released, but the "or later" option is lost for the combined work. If keeping "or later" matters, port only from MIT/BSD/WTFPL/LGPL/"GPL-2+ or 3+" sources (Airwindows, ADAA repo, chowdsp_math, HIIR, Surge, Calf, Guitarix) and re-derive the Jiles-Atherton solver from the DAFx paper's equations (formulas are not copyrightable).

### Gaps
- No trustworthy source ranks these plugins specifically on vocals. Gearspace/KVR threads were unreachable (403 / DNS), so "most praised on vocals" stays unanswered.
- Original TAP TubeWarmth source and licence header not read (three GitHub mirrors returned nothing). I only read Calf's port.
- Not read: Airwindows Air/Air2-4, IronOxide5 body, Console5-9 encode/decode pairs in full, Drive, Distortion, Hermepass; BYOD Junior B (neural triode + WDF), Warp, the Centaur gain stage internals; Surge "Tape" and "Neuron"; Wolf Shaper DSP.
- JUCE's current licence was not checked this session.

---

## 2. Concrete per-sample algorithms (equations, constants, order of stages) for the best open implementations: tube, console/transformer, tape, exciter

### Takeaway
Each character is a short chain of (filter, memoryless curve, small amount of memory such as slew or hysteresis): the exact curves and constants below are copied from source. The single most reusable building blocks are Airwindows' Spiral curve `sin(x|x|)/|x|`, the Tube/Tube2 polynomial pair, Channel9's signal-modulated high-pass plus slew clamp, ToTape's split-band "soften" plus head-bump integrator, CHOW's Jiles-Atherton solver, and the chowdsp/Surge exciter side chain.

### Cited Findings

#### 2.1 TUBE

**Airwindows Tube** (one knob A in 0..1; MIT). [SRC] [Tube/TubeProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Tube/TubeProc.cpp)
```
gain          = 1.0 + A*0.2246161992650486          // max +1.76 dB (author: sine vs triangle crest difference)
iterations    = 1.0 - A
powerfactor   = int(5.0*iterations) + 1             // 6 at A=0 ... 1 at A=1
gainscaling   = 1/(powerfactor+1)
outputscaling = 1 + 1/powerfactor
per sample:
  x = clamp(x*gain, -1, 1)
  factor = x^(powerfactor+1)                        // loop multiplies powerfactor times
  if powerfactor is odd: factor = (factor/x)*|x|    // keep the curve odd-symmetric
  x = (x - factor*gainscaling) * outputscaling
at sample rates >= 88.2k: average each sample with the previous one before and after the curve
```
Author's comment gives the "fattest" form explicitly: `y = (x - x*|x|*0.5)*2` on [-1,1].

**Airwindows Tube2** (A = input pad, default 0.5; B = "Tube", default 0.5; MIT). Order: pad, asymmetric stage, original Tube stage, slew-dependent "hysteresis" stage, clip. [SRC] [Tube2/Tube2Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Tube2/Tube2Proc.cpp)
```
powerfactor = int(9.0*(1-B)) + 1 ; asymPad = powerfactor
gainscaling = 1/(powerfactor+1) ; outputscaling = 1 + 1/powerfactor
x *= A (only if A < 1); x = clamp(x,-1,1)
// 1) asymmetric: "flatten bottom, point top"
x /= asymPad
sharpen = -x
sharpen = (sharpen > 0) ? 1 + sqrt(sharpen) : 1 - sqrt(-sharpen)
x -= x*|x|*sharpen*0.25
x *= asymPad
// 2) original Tube curve
factor = x^(powerfactor+1) (odd-symmetrised as above) ; x = (x - factor*gainscaling)*outputscaling
// 3) "hysteresis and spiky fuzz": curve strength depends on the direction of travel
slew = prev - x ; prev = x
slew = (slew > 0) ? 1 + sqrt(slew)*0.5 : 1 - sqrt(-slew)*0.5
x -= x*|x|*slew*gainscaling
x = clamp(x, -0.52, 0.52) * 1.923076923076923
```
Author's stated intent: "second harmonics both on the low end and as higher harmonics... algorithms that'd sharpen corners going one direction and loosen them going the other"; "pretty close to level matched if you have the input trim at 0.5". [SRC] [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)

**TAP TubeWarmth as ported in Calf** (`tap_distortion`; drive 0.1..10, blend -10 (tape) .. +10 (tube); LGPL). `D(x)` is a macro in `calf/audio_fx.h` that I did not read; in the TAP original it is a guarded `sqrt(fabs(x))` [MEM]. [SRC] [calf/src/audio_fx.cpp](https://github.com/calf-studio-gear/calf/blob/master/src/audio_fx.cpp)
```
rdrive = 12/drive
rbdr   = rdrive/(10.5 - blend) * 780/33
kpa = D(2*rdrive^2 - 1) + 1 ;  kpb = (2 - kpa)/2 ;  ap = (rdrive^2 - kpa + 1)/2
kc  = kpa / D(2*D(2*rdrive^2 - 1) - 2*rdrive^2)
sq  = kc^2 + 1 ; knb = -rbdr/D(sq) ; kna = 2*kc*rbdr/D(sq) ; an = rbdr^2/sq
imr = 2*knb + D(2*kna + 4*an - 1) ; pwrq = 2/(imr + 1)
srct = (0.1*fs)/(0.1*fs + 1)                       // DC-blocker pole
per (2x oversampled) sample:
  med = (x >= 0) ?  (D(ap + x*(kpa - x)) + kpb)*pwrq
                 : -(D(an - x*(kna + x)) + knb)*pwrq
  y   = srct*(med - prev_med + prev_out) ; prev_med = med ; prev_out = y     // 1-pole DC blocker
```
Calf runs this inside a 2x resampler below 96 kHz (`over = srate*2 > 96000 ? 1 : 2`). Calf Saturator chain: input level, 2x 12 dB LP (pre), 2x 12 dB HP (pre), tap_distortion, peak EQ "tone", 2x LP and 2x HP (post), then `proc *= 1/level_in; if level_in > 1: proc *= 1 + (level_in - 1)/32`, dry/wet mix, output level. All biquads are RBJ with Q 0.707. [SRC] [calf/src/modules_dist.cpp](https://github.com/calf-studio-gear/calf/blob/master/src/modules_dist.cpp)

**Koren triode model, as coded in Guitarix's table generator** (GPL-2.0-or-later). [SRC] [guitarix tools/tube_transfer.py](https://github.com/brummer10/guitarix/blob/master/trunk/tools/tube_transfer.py)
```
Ipk_triode(Vgk, Vpk):  E1 = Vpk/kp * ln(1 + exp(kp*(1/mu + Vgk/sqrt(kvb + Vpk^2))))
                       Ip = 2*E1^kx/kg1   (0 if E1 <= 0)
Igk(Vgk) = exp(7.75*Vgk - 10.3)                              // grid current
12AX7 : mu=100.0  kx=1.4   kg1=1060.0  kp=600.0   kvb=300.0   (ccg 2.3, cpg 2.4, ccp 0.9 pF, rgi 2.0)
12AU7 : mu=21.5   kx=1.3   kg1=1180.0  kp=84.0    kvb=300.0
12AT7 : mu=60.0   kx=1.35  kg1=460.0   kp=300.0   kvb=300.0
6V6   : mu=12.67  kx=1.198 kg1=915.0   kg2=4500.0 kp=38.07 kvb=30.2
triode stage used to build the table: Vp(B+) = 250 V, Rp = 100k, Ri in {68k, 250k}, input range -5..+5 V, 2001-point table
```
The same 12AX7 set (MU=100 EX=1.4 KG1=1060 KP=600 KVB=300 RGI=2000) is what Koren's own page lists. [2ND] [Koren, Improved vacuum tube models for SPICE simulations](https://www.normankoren.com/Audio/Tubemodspice_article.html). Guitarix's header says "lots of hints and some numerical values taken from Virtual Air Guitar (Karjalainen, Maki-Patola, Kanerva, Huovilainen)". [SRC] same file.

**BYOD "Dirty Tube"** (GPL-3.0): a wave-digital triode stage. Plate current source `I = 2.0e-9 * sgn(v)*|v|^0.33` with `v = 0.1*Vg - 0.01*Vp`; capacitors Cpk 0.33 pF, Cgp 1.7 pF, Cgk 1.6 pF (alpha-transform caps, alpha 0.4), Rgk 2.7k, a WDF diode (Is 1e-10) at the root. Drive mapping: `d8 = drive^8; gainIn = 5.9*d8 + 0.1; gainOut = 1/(5.0*d8 + 1.0)`. [SRC] [TubeProc.h](https://github.com/Chowdhury-DSP/BYOD/blob/main/src/processors/drive/tube_amp/TubeProc.h), [TubeAmp.cpp](https://github.com/Chowdhury-DSP/BYOD/blob/main/src/processors/drive/tube_amp/TubeAmp.cpp)

**Airwindows SingleEndedTriode** (bias-shifted sine shaper): `x *= intensity; x -= 0.5; x = sgn(x)*sin(min(|x|, pi/2)); x += postsine; x /= intensity`, with `intensity = A^2*8 + 0.001`; plus optional class-AB / class-B crossover dead zones `|x| -= soft*(|x| + sqrt|x|)`, `soft = B^3/8`, and `|x| -= hard`, `hard = C^7/8`. (`postsine` is set outside the loop; presumably sin(0.5), not checked.) [SRC] [SingleEndedTriodeProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/SingleEndedTriode/SingleEndedTriodeProc.cpp)

#### 2.2 CONSOLE / TRANSFORMER

**Airwindows Channel9** (A = console type, B = Drive 0..1 (default 0), C = Output; MIT). [SRC] [Channel9.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Channel9/Channel9.cpp), [Channel9Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Channel9/Channel9Proc.cpp)

| Voicing | iirAmount (high-pass coeff @44.1k) | slew threshold (per sample) | ultrasonic low-pass cutoff |
|---|---|---|---|
| Neve | 0.005832 | 0.33362176 | 28811 Hz |
| API | 0.004096 | 0.59969536 | 27216 Hz |
| SSL | 0.004913 | 0.84934656 | 23011 Hz |
| Teac | 0.009216 | 0.149 | 18544 Hz |
| Mackie | 0.011449 | 0.092 | 19748 Hz |

(Channel4-8 use the same Neve/API/SSL iirAmount and threshold values; verified by grep in each.)
```
setup:
  localiir = iirAmount/(fs/44100) ; thr = threshold (NOT sample-rate scaled in 8/9; Channel4 scales it)
  density = 2*B ; phattity = max(density-1, 0) ; density = min(density, 1)
  nonLin = 5 - density
  biquadA: 2-pole low-pass at cutoff/fs, Q = 1.618033988749894  (pre, slightly resonant)
  biquadB: 2-pole low-pass at cutoff/fs, Q = 0.618033988749894  (post)   [both skipped if cutoff/fs >= 0.5]
per sample:
  x = biquadA(x)
  // "dielectric" high-pass: 1-pole low-pass subtracted from the signal, coefficient modulated by the signal
  dielectricScale = |2 - (x + nonLin)/nonLin|                 // = |1 - x/nonLin|
  iir = iir*(1 - localiir*dielectricScale) + x*localiir*dielectricScale ; x -= iir
        (two filter states iirA / iirB used on alternate samples: "flip")
  dry = x
  x = clamp(x, -1, 1)
  phat = sin(x * 1.57079633)                                   // "Density"
  x *= 1.2533141373155
  dist = sin(x*|x|)/|x|   (x if |x| == 0)                      // "Spiral"
  x = dist ; if density < 1: x = dry*(1-density) + dist*density
  if phattity > 0: x = x*(1-phattity) + phat*phattity
  // golden-ratio slew clamp
  clamp = (lastB - lastC)*0.381966011250105 - (lastA - lastB)*0.6180339887498948 + (x - lastA)
  lastC = lastB ; lastB = lastA ; lastA = x
  if  clamp > thr: x = lastB + thr
  if -clamp > thr: x = lastB - thr
  lastA = lastA*0.381966011250105 + x*0.6180339887498948
  x *= C (if C < 1)
  x = biquadB(x)
```
Author on the filters: Channel9 "steepens its filter with a teeny resonant peak at this cutoff point... The Neve is the most extended, well beyond 20k. The SSL cuts off tighter... The lift at the peak comes before the saturation stage, for better smoothness when the console is being driven." [SRC] [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)

**Airwindows Console7Channel** curve (for a console "encode" stage): `x = clamp(x, -1.097, 1.097); y = 0.8*sin(x*|x|)/|x| + 0.2*sin(x)`, input gain `A*1.272019649514069`, preceded by a Q = 1.618 low-pass. (The matching Console7Buss decode was not read.) [SRC] [Console7ChannelProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Console7Channel/Console7ChannelProc.cpp)

**Airwindows Coils2** ("a transformer overdrive emulator"; A = Saturate, B = Cheapness; MIT). [SRC] [Coils2Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Coils2/Coils2Proc.cpp)
```
distScaling = max((1-A)^2, 0.0001)
biquadA: band-pass at 600 Hz, Q = 0.01 + B^2*0.5            // the "clean, resonant band"
biquadB: low-pass at (21890 - Q*890) Hz, Q = 0.89
iirAmount = Q/(fs/44100)
per sample:
  bp   = biquadA(x)
  diff = (x - bp)/distScaling                                 // everything outside the band, boosted
  diff = biquadB(diff)
  hyst = hyst*(1-iirAmount) + diff*iirAmount ; diff -= hyst
  diff = clamp(diff, -1.571, 1.571) ; hystC = clamp(hyst, -1.571, 1.571)
  y = bp + (sin(diff) - sin(hystC))*distScaling
```

**Airwindows Interstage** ("subtle and sophisticated analogifier", no controls). [SRC] [InterstageProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Interstage/InterstageProc.cpp)
```
firstStage = 0.381966011250105/(fs/44100) ; iirAmount = 0.00295/(fs/44100) ; threshold = 0.381966011250105
x = (in + last)*0.5
A = lp(x, firstStage) ; C = lp(A, iirAmount) ; E = lp(C, iirAmount)   (interleaved A/B state pairs on alternate samples)
y = in - E                                             // 2-pole DC removal
y = clamp(y, A - threshold, A + threshold)             // slew limit relative to the smoothed signal
last = y
```

**Airwindows PurestDrive**: `s = sin(x); apply = |prevS + s|/2 * intensity; y = x*(1-apply) + s*apply; prevS = sin(x)`. Saturates less when the previous sample was small or of opposite polarity, which "lets through highs and brightness more". [SRC] [PurestDriveProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/PurestDrive/PurestDriveProc.cpp)

**Airwindows Mojo**: `g = 10^((A*24-12)/20); m = |x|^0.25; y = sin(x*m*pi/2)/m * 0.987654321`. **Dyno**: `d = |x|^4; y = sin(x*d)/d * 1.1654321`. **Spiral2**: gain `(2A)^2`, optional interleaved 1-pole high-pass `B^3/(fs/44100)`, `y = sin(x*|x|)/|x|`, "presence" variant `sin(x*|prevDry|)/|prevDry|`. **Density2** (density = 5A-1): repeated `sgn(x)*sin(min(|x|*pi/2, pi/2))`, or `1 - cos(.)` for negative density ("starved"), computed on the sample and on an interpolated half-sample, with the difference to dry averaged (a 2-point anti-alias trick). [SRC] [MojoProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Mojo/MojoProc.cpp), [DynoProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Dyno/DynoProc.cpp), [Spiral2Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Spiral2/Spiral2Proc.cpp), [Density2Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Density2/Density2Proc.cpp)

**Neve 1073 hardware facts (no open DSP model found):** AMS Neve says the 1073 uses the LO1166 gapped output transformer with the Marinair-designed 10468 mic-input and 31267 line-input transformers, which contribute "harmonic richness, low-frequency weight, and subtle saturation". [2ND] [AMS Neve](https://www.ams-neve.com/about-marinair/). An SOS review of a 1073 emulation describes its saturation as "mostly odd-order harmonics in both line and mic mode". [2ND] [SOS, Kit Plugins BB N73](https://www.soundonsound.com/reviews/kit-plugins-bb-n73). **JHS Colour Box:** only forum-level circuit talk found: two Neve-style gain circuits in series, a Lundahl transformer said to be 1:10 where the 1073 mic input is 1:4. [2ND] [GearNews](https://www.gearnews.com/jhs-makes-good-things-better-with-color-box-version-2-preamp-pedal), [madbeanpedals forum](https://madbeanpedals.com/forum/index.php?msg=211459)

#### 2.3 TAPE

**Airwindows TapeHack** (zero latency, memoryless; A input default 0.1, B output, C dry/wet; MIT). [SRC] [TapeHackProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/TapeHack/TapeHackProc.cpp)
```
x = clamp(in * A*10, -2.305929007734908, 2.305929007734908)
y = x - x^3/6 + x^5/69 - x^7/2530.08 + x^9/224985.6 - x^11/9979200
out = y * (B*0.9239) * wet + in*(1-wet)
```
(A deliberately "detuned" sine series: true sine would use 120, 5040, 362880, 39916800.) **PurestSaturation** is the companion: clamp to +/-2.032610446872596, `y = x - x^3*0.125 + x^5*0.0078125 - x^7*0.000244140625 + x^9*0.000003814697265625 - x^11*0.0000000298023223876953125`. [SRC] [PurestSaturationProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/PurestSaturation/PurestSaturationProc.cpp)

**Airwindows ToTape6** (Input, Soften, Head B, Flutter, Output, Dry/Wet; all default 0.5 except wet 1.0; MIT). [SRC] [ToTape6Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/ToTape6/ToTape6Proc.cpp)
```
os = fs/44100
inputgain = 10^((A-0.5)*24/20) ; outputgain = 10^((E-0.5)*24/20)
RollAmount = (1 - B^2*0.45)/os            // 1-pole coefficient of the "mid roller"
HeadBumpControl = C*0.25*inputgain ; HeadBumpFreq = 0.12/os
flutter: depth = D^2*os*70 samples, fluttertrim = 0.0024*D^2/os   (modulated delay; D = 0 removes the delay line)
biquad A/B (head bump): band-pass, f/fs = 0.007/os, Q = 0.0009
biquad C/D (main path): band-pass, f/fs = 0.032/os, Q = 0.0007     (A/B and C/D alternate samples: "interleaved")
per sample:
  x *= inputgain (if < 1)
  [flutter delay]
  vibDry = x
  mid   = mid*(1-RollAmount) + x*RollAmount ; Highs = x - mid
  bump += x*0.05 ; bump -= bump^3*HeadBumpFreq ; bump = sin(bump)
  bump  = asin(clamp(biquadAB(bump), -1, 1))
  x     = asin(clamp(biquadCD(sin(x)), -1, 1))                    // sin -> ultra-wide band-pass -> asin
  ground = vibDry - x                                             // "UnBox": what the band-pass removed
  x *= inputgain (if > 1)
  soften = 1 - cos(min(|Highs|*1.57079633, 1.57079633)) ; x -= sgn(Highs)*soften   // HF self-compression
  suppress = (1 - |x|)*0.00013 ; pull both bump states toward 0 by suppress        // "servo damping"
  x += (bumpA + bumpB)*HeadBumpControl
  x = clamp(x, -1, 1)
  m = |x|^0.25 ; x = sin(x*m*pi/2)/m                               // Mojo curve as the tape saturator
  x += ground
  x *= outputgain
  ADClip-style soft clip at refclip = 0.99, softness = 0.618033988749894
  out = x*wet + dry*(1-wet)
```
Author: ToTape6 "brings in tech from UnBox, from Mojo, from BiquadOneHalf"; "thanks to the interleaved biquad filters it cuts [subs] right off and doesn't let DC through"; "be cautious about pushing the head bump beyond its default halfway setting". [SRC] [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)

**Airwindows ToTape8** (Input, Tilt, Shape, Flutter, FlutSpd, Bias, HeadBmp, HeadFrq, Output; all default 0.5; MIT). [SRC] [ToTape8Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/ToTape8/ToTape8Proc.cpp)
```
os = fs/44100
inputGain = (2A)^2 ; outputGain = 2I
dublyAmount = 2B ; outlyAmount = max(-2(1-B), -1)                 // "Tilt": HF encode vs decode amount
iirEncFreq = (1-C)/os ; iirDecFreq = C/os ; iirMidFreq = (0.618C + 0.382)/os      // "Shape"
bias = 2F-1 ; underBias = bias^4*0.25/os (only if bias < 0) ; overBias = (1-bias)^3/os (1/os if bias < 0)
   9 slew thresholds: overBias, then each *1.618033988749894
headBumpDrive = 0.1G/os ; headBumpMix = 0.5G ; iirSubFreq = sin(G*pi)*0.008/os
head-bump biquads: two cascaded band-passes, Q = 0.618033988749894,
   fA = (H^2*175 + 25) Hz  (25..200 Hz, 68.75 Hz at default), fB = 0.9375*fA
per sample:
  x *= inputGain
  // Dubly encode (HF compander)
  enc = lp1(x, iirEncFreq) ; hp = (x-enc)*2.848 + avgEnc ; avgEnc = (x-enc)*1.152 ; hp = clamp(hp,-1,1)
  d = |hp| ; d /= ln(1 + 255d)/2.40823996531 ; compEnc = lp1(d, iirEncFreq) ; x += hp*compEnc*dublyAmount
  [flutter: modulated delay, depth D^6*os*50 samples, rate 0.02*E^3/os]
  // bias: chain of 9 slew clamps (golden-ratio thresholds); "underbias" adds a sticky dead zone
  for each stage: if underBias > 0: stuck = |x - g/0.975|/underBias ; if stuck < 1: x = x*stuck + (g/0.975)*(1-stuck)
                  x = clamp(x, g - thr, g + thr) ; g = x*0.975
  // split and saturate
  mid = lp1(x, iirMidFreq) ; Highs = x - mid ; Lows = mid
  if iirSubFreq > 0: Lows -= lp1(Lows, iirSubFreq)
  Lows = sin(clamp(Lows, -pi/2, pi/2))
  thin = sgn(Highs)*(1 - cos(min(|Highs|*pi/2, pi/2))) ; Highs -= thin
  // head bump
  hb += Lows*headBumpDrive ; hb -= hb^3*(0.0618/sqrt(os)) ; bumpOut = bandpassB(bandpassA(hb))
  x = Lows + Highs + bumpOut*headBumpMix
  // Dubly decode: same detector with 2.628 / 1.372 and iirDecFreq, x += hp*compDec*outlyAmount
  x *= outputGain
  ClipOnly2 (below)
```
**ClipOnly2 / ToTape8 output clipper adds latency:** the code comment reads "Latency is however many samples equals one 44.1k sample" (1 sample at 44.1/48k, 2 at 88.2/96k). Constants: threshold 0.9549925859; on clip `x = 0.7058208 + last*0.2609148`; on release `last = 0.7058208 + x*0.2609148` or `0.2491717 + last*0.7390851`; hard limit +/-4.0 first. [SRC] [ClipOnly2Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/ClipOnly2/ClipOnly2Proc.cpp)

**CHOW Tape Model** (GPL-3.0). Signal order in the plugin: input gain, input filters, (mid/side), tone-in, compression, hysteresis, tone-out, chew, degrade, wow/flutter, loss filter, latency compensation, makeup, output gain, dry/wet. [SRC] [PluginProcessor.cpp](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Plugin/Source/PluginProcessor.cpp)

Jiles-Atherton hysteresis, exactly as coded. [SRC] [HysteresisOps.h](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Plugin/Source/Processors/Hysteresis/HysteresisOps.h), [HysteresisProcessing.cpp](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Plugin/Source/Processors/Hysteresis/HysteresisProcessing.cpp), [HysteresisProcessing.h](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Plugin/Source/Processors/Hysteresis/HysteresisProcessing.h)
```
user params (all 0..1, default 0.5): drive, sat ("Tape Saturation"), bias ("Tape Bias"); the code passes width = 1 - bias
cook(drive, width, sat):
  M_s   = 0.5 + 1.5*(1 - sat)
  a     = M_s/(0.01 + 6.0*drive)
  c     = sqrt(1 - width) - 0.01
  k     = 0.47875
  alpha = 1.6e-3                      (constant)
  upperLim = 20
  "V1" mode instead: k = 27.0e3, c = 1.7e-1, M_s *= 50000, a = M_s/(0.01 + 40*drive), upperLim = 100000,
        input scaled by 10000 and output by 1.414/10000, plus an explicit bias sine (below)
T = 1/(fs*OS)
derivative (alpha transform, dAlpha = 0.75):  H_d = ((1 + 0.75)/T)*(H - H_n1) - 0.75*H_d_n1
dM/dt = f(M, H, H_d):
  Q      = (H + alpha*M)/a
  L(Q)   = coth(Q) - 1/Q            (Q/3 when |Q| < 0.001)
  L'(Q)  = 1/Q^2 - coth(Q)^2 + 1    (1/3 when |Q| < 0.001)
  M_diff = M_s*L(Q) - M
  delta  = (H_d >= 0) ? +1 : -1
  kap1   = (sign(delta) == sign(M_diff)) ? (1 - c) : 0
  f1     = kap1*M_diff / ((1 - c)*delta*k - alpha*M_diff)
  f2     = L'(Q)*c*M_s/a
  f3     = 1 - L'(Q)*alpha*c*M_s/a
  return H_d*(f1 + f2)/f3
solvers:
  RK2:  k1 = T*f(M_n1, H_n1, H_d_n1) ; k2 = T*f(M_n1 + k1/2, (H+H_n1)/2, (H_d+H_d_n1)/2) ; M = M_n1 + k2
  RK4:  classic 4-stage with the same midpoint H and H_d ; M = M_n1 + k1/6 + k2/3 + k3/3 + k4/6
  NR4 / NR8: 4 or 8 Newton iterations on the trapezoidal rule with Talpha = T/1.9:
        delta = (M - M_n1 - Talpha*(f(M,H,H_d) + f(M_n1,H_n1,H_d_n1))) / (1 - Talpha*f'(M)) ; M -= delta
  STN:  a small neural "state transition network", one JSON weight set per width step (hyst_width_0..100.json)
safety: if isnan(M) or M > upperLim: M = 0 and H_d = 0
input clip before the solver: +/-8 (RK2), +/-10 (RK4), +/-12.5 (NR4/NR8), +/-20 (STN)
makeup = (1 + 0.6*width) / (0.5 + 1.5*(1 - sat))
after downsampling: DC blocker = 4th-order Butterworth high-pass at 35 Hz (two biquads)
bias signal exists only in V1 mode: bias = 10.0*(1 - width)*sin(phase), frequency = fs*OS/2
reported latency: oversampler latency + 1.4 samples
```
[SRC] [HysteresisProcessor.cpp](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Plugin/Source/Processors/Hysteresis/HysteresisProcessor.cpp), [HysteresisProcessor.h](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Plugin/Source/Processors/Hysteresis/HysteresisProcessor.h), [DCBlocker.h](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Plugin/Source/Processors/Hysteresis/DCBlocker.h)

Physical constants in the DAFx-19 paper (the "V1" numbers): M_s = 3.5e5 A/m, k = 27 kA/m, a = 22 kA/m, c = 1.7e-1, alpha = 1.6e-3 (ferric oxide; from Jiles 1992); example play-head values spacing 20 um, gap 5 um, thickness 35 um, speed 15 ips; Sony TC-260 bias 55 kHz; the paper's real-time system used 16x oversampling ("a minimum oversampling factor of 3x is required" just to represent the bias). The differential equation printed in the paper is the same as the code above. [SRC] [Paper/420_paper.tex](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Paper/420_paper.tex)

Other CHOW Tape stages:
- Oversampling default: 2x, minimum-phase (`OSFactor::TwoX, OSMode::MinPhase`). The manual says the RK solvers are "computationally cheaper, but somewhat less accurate than the Newton-Raphson solvers" and STN is a "cheaper approximation of the NR8 solver". [SRC] [HysteresisProcessor.cpp](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Plugin/Source/Processors/Hysteresis/HysteresisProcessor.cpp), [Manual/ChowTapeManual.tex](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Manual/ChowTapeManual.tex)
- Loss filter (play head): `k = 2*pi*max(f, 20)/(speed_ips*0.0254)`; `H(f) = exp(-k*d) * (1 - exp(-k*delta))/(k*delta) * sin(k*g/2)/(k*g/2)` with spacing d, thickness delta, gap g in metres (parameters in microns: spacing 0.1..20, thickness 0.1..50, gap 1..50; speed 1..50 ips, default 30). Implemented as a **linear-phase FIR** sampled from H(f); its latency is `order/2` samples, so it is not zero-latency. Head bump: peak filter at `f = speed_ips*0.0254/(gap_m*500)`, Q = 2.0, gain = `max(1.5*(1000 - |f - 100|)/1000, 1.0)`. [SRC] [LossFilter.cpp](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Plugin/Source/Processors/Loss_Effects/LossFilter.cpp)
- Pre/de-emphasis ("Tone"): complementary shelves around a transition frequency, default 500 Hz (range 100..4000 Hz); the same bass/treble amounts are applied before the hysteresis and inverted after it. [SRC] [ToneControl.cpp](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Plugin/Source/Processors/Hysteresis/ToneControl.cpp)
- Compander ("Compression"): gain in dB `= dbPlus` below the window, else `log(xDB + 2*dbPlus + 1) - dbPlus - xDB`; attack 0.1..50 ms (default 5), release 10..1000 ms (default 200). [SRC] [CompressionProcessor.cpp](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Plugin/Source/Processors/Compression/CompressionProcessor.cpp)

#### 2.4 EXCITER / DRIVE

**Surge XT "Exciter" (chowdsp; GPL-3.0-or-later).** [SRC] [ExciterEffect.cpp](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/ExciterEffect.cpp), [ExciterEffect.h](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/ExciterEffect.h), [LevelDetector.h](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/exciter/LevelDetector.h)
```
params (all default 0.5): drive, tone, attack, release, mix
cutoff      = 500 * (10000/500)^tone   Hz   (clamped 10 .. 0.48*fs) ; 2-pole high-pass, Q = 0.7071
drive_makeup= 0.2^(1 - tone)
drive       = 8 * drive_param^1.5 * drive_makeup
attack 2.5..40 ms, release 25..400 ms
block:  dry = x ; x *= drive ; upsample (Oversampling<1,...>, i.e. one 2x stage)
per oversampled sample:
  x     = highpass(x)
  r     = 25*0.2*(exp((0.05/0.0259)*x) - 1)                 // diode rectifier
  z     = r + tau*(z - r), tau = (r > z) ? tau_attack : tau_release,
          tau = exp(-2*pi*1000/(fs*time_ms))                // one-pole level detector
  x     = tanh(x) * z                                       // harmonics scaled by the detected level
downsample ; out = dry + x*mix
```
**Calf Exciter** (LGPL): two cascaded RBJ high-passes (Q 0.707) at `freq`, `tap_distortion` (the TubeWarmth curve above, 2x oversampled), two more high-passes at `freq`, optional 2x low-pass "ceiling", then `out = (proc*amount + in)*level_out`. [SRC] [calf/src/modules_dist.cpp](https://github.com/calf-studio-gear/calf/blob/master/src/modules_dist.cpp)

**Airwindows Focus** (band-focused drive; MIT): band-pass fixed at 3515.775 Hz, Q = `(B^3*2)^2 + 0.0001`, wrapped as `asin(clamp(bandpass(sin(x)),-1,1))`; `ground = dry - band`; band boosted 0..+12 dB (`10^(A*12/20)`) then shaped by one of Density `sin(clamp(x, +/-pi/2))`, Drive `x = clamp(x,-1,1); x -= x*(|x|*0.6)^2; x *= 1.6`, Spiral, Mojo or Dyno; then `out = shaped*output + ground`. [SRC] [FocusProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Focus/FocusProc.cpp)

**Temper** (GPL-3.0, Faust): resonant low-pass pre-filter, then a first-order all-pass whose coefficient is modulated by the shaped signal: `m(x) = 0.24 * transfer(drive(x))`, `transfer(x) = tanh(curve*x)/tanh(curve)`, tanh approximated as `x*(27 + x^2)/(27 + 9x^2)`, `drive(x) = clamp(x*pdrive + ampFollower_40ms(x), -3, 3)`; a "phase distortion" rather than plain waveshaping. [SRC] [temper.dsp](https://github.com/creativeintent/temper/blob/master/Dsp/temper.dsp)

**Aphex hardware topology** (for reference): input split; a side chain through a high-pass filter (Tune, 600 Hz..5 kHz per one manual; "usually somewhere between 3 and 8 kHz" per SOS's FAQ) into a level-dependent harmonics generator; harmonics mixed back at low level. [2ND] [SOS: How enhancers work](https://www.soundonsound.com/techniques/how-enhancers-work), [SOS: enhancers FAQ](https://www.soundonsound.com/sound-advice/enhancers), [muzines: Aphex Aural Exciter Type B](https://www.muzines.co.uk/articles/aphex-aural-exciter-type-b/2850)

### Inferences
- Channel9's high-pass corner follows from its coefficient: a 1-pole with coefficient a updated on alternate samples has fc ~ a*(fs/2)/(2*pi). At 44.1 kHz that gives about 20 Hz (Neve), 14 Hz (API), 17 Hz (SSL), 32 Hz (Teac), 40 Hz (Mackie). [CALC] The signal-dependent factor |1 - x/nonLin| (nonLin 4..5) moves that corner by up to roughly +/-20-25% with signal polarity, which is a mild low-frequency asymmetry.
- Channel9's slew threshold, read as a plain first-difference limit, starts acting on a full-scale sine above about thr*fs/(2*pi): at 48 kHz roughly 2.5 kHz (Neve), 4.6 kHz (API), 6.5 kHz (SSL), 1.1 kHz (Teac), 0.7 kHz (Mackie); at -12 dBFS these are four times higher. [CALC] (approximate: the real clamp uses a three-point golden-ratio weighting). So "Neve" is the voicing that rounds loud sibilance earliest among the three big-console settings.
- For a zero-latency live chain, ToTape6/8 must be used without flutter (delay line) and without ClipOnly2 (one-sample look-behind); everything else in them is zero-latency. CHOW Tape must be used without the FIR loss filter; substitute its head-bump peak filter plus a minimum-phase high shelf.
- CHOW Tape's default ("V2") mode has no bias oscillator; "bias" is only the J-A parameter c. That is why 2x oversampling is enough there, whereas the paper's biased V1 system needed 16x.

### Gaps
- No open, measured model of Marinair/Neve or API 2520 transformer saturation was found; Coils2 and Channel9 are stylised, not circuit-derived. No schematic-level analysis of the Colour Box was reachable.
- D() and M() macros of the Calf/TAP distortion were not read.
- BYOD Junior B (neural triode in a WDF), Blonde (bias constant 8.2, 685 Hz "character" shelf seen in a grep only), Warp, and Surge's Tape/Neuron were not analysed.
- Pakarinen & Karjalainen's WDF tube stage and the Holters-Zolzer hysteresis paper were not read.

---

## 3. Harmonic signatures of tube, transformer and tape, and how the open models produce them

### Takeaway
Even-order "warmth" only appears when the curve is asymmetric (Tube2's sharpen stage, TAP's two different half-curves, a bias offset); every symmetric curve here (tanh, Spiral, Mojo, TapeHack, unbiased Jiles-Atherton) is purely odd-order, differing mainly in how fast the third harmonic rises with level. Transformer and tape character in the open models comes from making the saturation frequency-dependent (split bands, slew clamps, integrators, hysteresis), not from the static curve.

### Cited Findings
Measured by me: 220 Hz sine through each static curve exactly as coded above, 65536-point FFT, harmonic level relative to the fundamental. [CALC] from the source files cited in section 2.

| Curve (source) | Input peak | H2 | H3 | H4 | H5 | Gain of fundamental |
|---|---|---|---|---|---|---|
| tanh(2x)/2 (reference) | -18 / -12 / -6 dBFS | none | -45.7 / -34.1 / -23.5 dB | none | -89.8 / -66.5 / -45.0 | -0.1 / -0.5 / -1.8 dB |
| (tanh(2(x+0.2)) - tanh(0.4))/2 (bias 0.2) | -18 / -12 / -6 | -26.6 / -21.2 / -17.3 | -50.4 / -38.4 / -26.5 | -68.3 / -51.0 / -35.7 | -110 / -83 / -55 | -1.4 / -1.7 / -2.6 |
| Airwindows Spiral (Channel8/9 at Drive 50%) | -18 / -12 / -6 | none | -89.8 / -65.8 / -41.8 | none | -103.8 / -79.8 / -55.8 | +1.96 / +1.95 / +1.82 |
| Airwindows Density sine sin(pi/2 x) | -18 / -12 / -6 | none | -55.7 / -43.7 / -31.4 | none | -122 / -98 / -73.5 | +3.9 / +3.75 / +3.2 |
| Airwindows Mojo | -18 / -12 / -6 | none | -64.0 / -48.9 / -33.7 | none | -88.6 / -73.7 / -59.2 | +3.8 / +3.7 / +3.4 |
| Airwindows TapeHack (input gain 1) | -18 / -12 / -6 | none | -63.6 / -51.6 / -39.6 | none | -133 / -109 / -85 | -0.7 / -0.8 / -1.0 |
| Airwindows PurestSaturation (gain 1) | -18 / -12 / -6 | none | -66.1 / -54.1 / -42.1 | none | -138 / -114 / -90 | 0.0 / -0.05 / -0.2 |
| Airwindows Tube, A = 0 | -18 / -12 / -6 | none | -134.6 / -98.6 / -62.6 | none | -144 / -108 / -72 | +1.34 |
| Airwindows Tube, A = 1 | -18 / -12 / -6 | none | -37.1 / -30.4 / -23.0 | none | -54.0 / -47.4 / -39.9 | +7.2 / +6.6 / +5.2 |
| Airwindows Tube2 asymmetric stage alone, Tube = 1.0 (powerfactor 1) | -18 / -12 / -6 | -44.7 / -35.4 / -25.9 | -45.2 / -39.0 / -32.5 | -67.0 / -57.7 / -48.2 | -62.1 / -55.9 / -49.4 | -0.2 / -0.5 / -1.0 |
| Tube2 asymmetric stage alone, Tube ~0.5 (powerfactor 5) | -18 / -12 / -6 | -65.8 / -56.8 / -47.7 | -59.4 / -53.3 / -47.2 | -88 / -79 / -70 | -76 / -70 / -64 | ~0 |
| TAP/Calf, drive 5, blend +10 ("tube") | -18 / -12 / -6 | -30.8 / -25.7 / -21.1 | -40.4 / -35.8 / -31.9 | -62.8 / -53.2 / -45.0 | -55.4 / -49.8 / -44.8 | +2.0 / +1.6 / +1.0 |
| TAP/Calf, drive 5, blend -10 ("tape") | -18 / -12 / -6 | -49.1 / -44.6 / -40.8 | -34.7 / -29.7 / -25.2 | -75.9 / -67.1 / -59.9 | -49.8 / -43.8 / -38.0 | +3.3 / +2.6 / +1.4 |
| CHOW J-A, RK2 at 2x, drive 0.5, sat 0.5, bias 0.5, with makeup (my scalar re-implementation of the code above) | -18 / -12 / -6 / 0 | none | -44.7 / -39.3 / -31.7 / -22.7 | none | -62.9 / -60.8 / -59.0 / -40.8 | -2.6 / -2.4 / -2.3 / -2.7 |
| CHOW J-A, same, drive 1.0 | -18 / -12 / -6 / 0 | none | -45.0 / -34.5 / -24.1 / -16.9 | none | -63 / -68 / -44 / -29 | +3.3 / +3.2 / +2.4 / +0.4 |

("none" = below -190 dB, i.e. numerically zero. The TAP rows assume D(x) = sqrt(|x|). RK2 and RK4 gave identical harmonic levels to 0.1 dB in this test.)

Other sourced statements:
- Rupert Neve (interview): odd harmonics "are much more readily perceived and are usually destructive to listening pleasure", even harmonics "tend to be benign". [2ND] [ProSoundWeb, Talking with Rupert Neve](https://www.prosoundweb.com/chat-from-the-past-talking-with-rupert-neve/4/)
- A 1073 emulation review describes "mostly odd-order harmonics in both line and mic mode". [2ND] [SOS](https://www.soundonsound.com/reviews/kit-plugins-bb-n73)
- Tube2's author on intent: "There's good reason to expect second harmonics both on the low end and as higher harmonics". [SRC] [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)
- TapeHack's author on tape: without bias "there was a dead spot"; with bias "that dead spot is still there... The recording is sweeping back and forth across it at 100 kHz". ToTape7/8 let you "dial in a section of Type AB distortion if it was 'underbiased'". [SRC] [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)
- Tape playback losses are frequency-dependent by physics: spacing loss exp(-kd), thickness loss (1 - exp(-k*delta))/(k*delta), gap loss sin(kg/2)/(kg/2), k = 2*pi*f/v. [SRC] [420_paper.tex](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Paper/420_paper.tex)

### Inferences
- Tube: the audible signature is H2 at roughly -45..-20 dB with H3 below it at low level and catching up at high level. Tube2's asymmetric stage (H2 ~ H3 at low drive, H2 leading by ~6 dB when hot) and TAP "tube" (H2 leading H3 by ~10 dB) both produce it; a plain bias offset into tanh gives a much stronger H2 (-27 dB already at -18 dBFS) and an asymmetric DC shift, so it needs a DC blocker and less bias (0.05..0.1) for vocals.
- Airwindows Tube at A = 1 (`x - x|x|/2`) has a kink in its second derivative at zero, so H3 is already -37 dB at -18 dBFS and rises only ~7 dB per 6 dB of level: an "always on" thickness. Tube at A = 0 (`x - x^7/7`) is the opposite: essentially clean until near full scale. Spiral behaves like A = 0 (H3 -90 dB at -18 dBFS, rising 24 dB per 6 dB), which is why Channel9 sounds clean until pushed.
- Tape (J-A) differs from tanh in level dependence: H3 rises only ~5-8 dB per 6 dB of input at vocal levels (tanh: ~11 dB per 6 dB), and the fundamental's gain stays almost constant, i.e. distortion that is present at low level and grows gently: the "soft compression" signature. The hysteresis width also makes the harmonic phase frequency-dependent.
- Transformer: none of the open code models flux (integral of voltage) explicitly. The low-frequency-dependent thickening is approximated by saturating a low band harder (ToTape8 `Lows = sin(Lows)`, head-bump integrator `hb += x*k; hb -= hb^3*c`) or by distorting everything outside a clean mid band (Coils2). An integrator-saturate-differentiator structure is the physically motivated way to get "more H3 the lower the note"; that is my design suggestion, not something found in source.
- High-frequency softening on tape is produced in ToTape6/8 by subtracting `1 - cos(|Highs|*pi/2)` from the high band: quadratic at low level, so it only bites on loud sibilance: effectively a built-in de-esser.

### Gaps
- No measured hardware harmonic-versus-frequency data (1073, tape machine, 12AX7 preamp) was reachable to validate these signatures; the table characterises the open code only.
- Tube2's slew-dependent third stage and the full Channel9 chain (dielectric high-pass + slew) were not measured dynamically; the table covers static curves and the J-A solver only.

---

## 4. Zero-latency constraint: which anti-aliasing gives the best quality with no (or under ~0.5 ms) added latency; concrete design and CPU cost at 48 kHz

### Takeaway
Use 2x (clean/tube/console/tape) or 4x (hard drive) oversampling with minimum-phase polyphase half-band IIR filters (HIIR design, WTFPL): round-trip delay is about 0.05-0.09 ms at voice frequencies, 100+ dB alias rejection is available, and the cost is a fraction of a percent of one core. First-order ADAA is a useful add-on inside the 2x stage for hard curves but is not sufficient alone and costs half a sample plus high-frequency droop.

### Cited Findings

**HIIR facts.** "The filter (a two-path polyphase IIR) is very efficient and can be used to achieve high-quality oversampling or phase shift at a low CPU cost. It is made of a symetric half-band elliptic low-pass filter, hence having an extremely flat frequency response in the passband." Designer call: `PolyphaseIir2Designer::compute_coefs_spec_order_tbw(coefs, nbr_coefs, transition_bw)`. Cascading rule for higher ratios: `TBW[stage] = (TBW[stage-1] + 0.5)/2`, so later (higher-rate) stages need far fewer coefficients. Licence WTFPL v2. [SRC] readme.txt, PolyphaseIir2Designer.h, license.txt in [unevens/hiir](https://github.com/unevens/hiir) (HIIR 1.30 mirror; original at ldesoras.fr was unreachable)

**Structure (from the HIIR sources):** each coefficient a_i is a first-order all-pass run at the low rate, `y[n] = a*(x[n] - y[n-1]) + x[n-1]`. Even-indexed coefficients form path 0, odd-indexed form path 1. Upsample: `out[2n] = path0(x[n])`, `out[2n+1] = path1(x[n])`. Downsample: `y[n] = 0.5*(path0(in[2n+1]) + path1(in[2n]))`. [SRC] same repo (Upsampler2xFpu / Downsampler2xFpu)

**Coefficients I generated with the HIIR designer** (compiled `PolyphaseIir2Designer` in this session), for a 48 kHz base rate with the pass-band kept flat to 20 kHz (stage-0 transition bandwidth = (28k - 20k)/96k = 0.08333; stage-1 = 0.29167). Stop-band figures are the designer's and were confirmed by evaluating the half-band response numerically; delays are the round trip (up + down) evaluated numerically from the transfer function. [CALC]

| Stage | n coefs | Stop-band rejection | Coefficients | Round-trip delay @48k: 1 kHz / 5 kHz / 10 kHz / 15 kHz |
|---|---|---|---|---|
| 2x<->1x | 3 | 49.1 dB | 0.143436416471938, 0.461816363311925, 0.810517970072603 | 36 / 38 / 44 / 59 us |
| 2x<->1x | 4 | 64.9 dB | 0.089698028237028, 0.310919387420167, 0.577350269189626, 0.850669771418376 | 46 / 48 / 56 / 75 us |
| 2x<->1x | 5 | 80.6 dB | 0.061090700071086, 0.221065199762536, 0.430463831503146, 0.650964800633457, 0.876656677083713 | 56 / 59 / 69 / 92 us |
| 2x<->1x | 6 | 96.4 dB | 0.044181909085212, 0.164188859726300, 0.330744161707643, 0.515086942508888, 0.702052852077365, 0.894889642203568 | 67 / 70 / 81 / 108 us |
| 2x<->1x | 8 | 127.9 dB | 0.026113009717563, 0.099935239175956, 0.209791082811053, 0.341324470687336, 0.482162493245922, 0.624974210454096, 0.768689960392823, 0.918825871448632 | 87 / 91 / 106 / 142 us |
| 4x<->2x | 1 | 40.2 dB | 0.372950323414084 | 10 / 10 / 10 / 11 us |
| 4x<->2x | 2 | 70.9 dB | 0.126620435698744, 0.565795715233128 | 16 / 16 / 17 / 18 us |
| 4x<->2x | 3 | 101.7 dB | 0.063787836824299, 0.266780962497159, 0.668548793183610 | 22 / 23 / 23 / 25 us |
| 8x<->4x | 2 | 102.3 dB | 0.110301209912267, 0.536772123666462 | not computed |

- Pass-band ripple to 20 kHz is below 0.00005 dB for n >= 3. [CALC]
- Complete 4x chain (stage-0 n = 5, stage-1 n = 2): 72 us at 1 kHz, 85 us at 10 kHz, 110 us at 15 kHz, 181 us at 20 kHz. With n = 6 and 3: 89 / 104 / 133 / 217 us. All far below 0.5 ms; a 64-sample buffer at 48 kHz is 1333 us. [CALC]
- Caution: `compute_group_delay(coef_arr, ...)` in the 1.30 mirror sums the delay of every coefficient (it printed 4.40 samples at the 96 kHz rate for n = 5), which is about twice the delay of the half-band filter itself when evaluated from H(z) = 0.5*(A0(z^2) + z^-1*A1(z^2)) (2.70 base-rate samples round trip). My table uses the direct evaluation. [CALC]/[SRC]

**ADAA formulas as implemented in open code.**
- First order (BSD-3): `y[n] = (F1(x[n]) - F1(x[n-1]))/(x[n] - x[n-1])`; if `|x[n] - x[n-1]| < 1e-5` use `f((x[n] + x[n-1])/2)`. [SRC] [ADAA/src/ADAA/ADAA1.h](https://github.com/jatinchowdhury18/ADAA/blob/master/src/ADAA/ADAA1.h). Surge's SIMD version is the same formula with tolerance 1e-4 and falls back to f(x). [SRC] [sst-waveshapers ADAA.h](https://github.com/surge-synthesizer/sst-waveshapers/blob/main/include/sst/waveshapers/ADAA.h)
- Second order (GPLv3 module): `D1(x0, x1) = (F2(x0) - F2(x1))/(x0 - x1)` (or `F1((x0 + x1)/2)` when ill-conditioned); `y[n] = 2/(x[n] - x[n-2]) * (D1(x[n], x[n-1]) - D1(x[n-1], x[n-2]))`; tolerance 1e-2 by default; class comment: "this processor will always add exactly one sample of latency to the signal, even when bypassed". It uses 2^18-point lookup tables for f, F1, F2 and an optional high-shelf "compensateHighFreqs" filter. [SRC] [chowdsp_ADAAWaveshaper.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_waveshapers/Waveshapers/chowdsp_ADAAWaveshaper.h)
- Antiderivatives: tanh: `F1 = ln(cosh x)`, `F2 = 0.5*(Li2(-e^(-2x)) - x*(x + 2*ln(e^(-2x) + 1) ...` (dilogarithm; the line was truncated in my read, take it from the file). [SRC] [chowdsp_TanhIntegrals.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_math/Math/chowdsp_TanhIntegrals.h) (BSD module)
- Hard clip to +/-1: `F1 = x^2/2` for |x| <= 1 else `x*sgn(x) - 0.5`; `F2 = x^3/6` for |x| <= 1 else `(x^2/2 + 1/6)*sgn(x) - x/2`. [SRC] [chowdsp_ADAAHardClipper.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_waveshapers/Waveshapers/chowdsp_ADAAHardClipper.h)
- Polynomial soft clip of degree d: `f(x) = (xn - xn^d/d)/norm` with `xn = clamp(x*norm, -1, 1)`; `F1 = (norm*x^2/2 - norm^d*x^(d+1)/(d*(d+1)))/norm` inside the knee. [SRC] [chowdsp_ADAASoftClipper.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_waveshapers/Waveshapers/chowdsp_ADAASoftClipper.h), [chowdsp_SoftClipper.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_waveshapers/Waveshapers/chowdsp_SoftClipper.h)
- Provenance: Parker, Zavalishin, Le Bivic, DAFx-16 (continuous-time convolution view); Bilbao, Esqueda, Parker, Valimaki, IEEE SPL 24(7) 2017, whose abstract says the method is "suitable for operation at reduced oversampling rates" and "the first-order form of the new method is equivalent to a technique proposed recently by Parker et al."; a 2025 DAFx paper describes ADAA as usable "without recurring to oversampling, or... in conjunction with mild oversampling". [2ND] [DAFx archive entry](https://dafx.de/paper-archive/details/vem_XXF5qBbfiWOH2RVVAA), [Bilbao et al. accepted version](https://core.ac.uk/download/322479137.pdf), [DAFx25 paper 30](https://dafx25.dii.univpm.it/wp-content/uploads/2025/09/DAFx25_paper_30.pdf)

**What the open plugins actually use.** CHOW Tape: 2x minimum-phase by default, user-selectable factor and linear-phase option. Surge Exciter: one 2x stage. Calf tap_distortion: 2x below 96 kHz. Airwindows: no oversampling; instead ultrasonic low-pass before the curve (Channel9), half-sample interpolation averaging (Density2), "only distort what won't alias" band splitting (UnBox, Focus), and 2-sample averaging at 88.2k+ (Tube). sst-waveshapers: first-order ADAA on selected shapes. [SRC] files cited in section 2

**Aliasing actually produced (my measurement).** Sine through `tanh(g*x)` at 48 kHz, 16384-point coherent FFT; "aliasing" = all non-harmonic energy below 20 kHz relative to the fundamental. HIIR filters as in the table above. [CALC]

| Test | naive 1x | ADAA1 at 1x | 2x HIIR n=4 | 2x HIIR n=6 | 2x n=5 + ADAA1 | 4x n=5,2 | 4x n=6,3 |
|---|---|---|---|---|---|---|---|
| 1 kHz, -6 dBFS, 12 dB drive | -178 dB | -185 | -223 | -250 | -247 | -240 | -253 |
| 3 kHz, -12 dBFS, 12 dB drive | -109 | -119 | -154 | -184 | -178 | -171 | -186 |
| 5 kHz, -12 dBFS, 12 dB drive | -66 | -79 | -116 | -149 | -139 | -133 | -150 |
| 7 kHz, -18 dBFS, 12 dB drive | -66 | -82 | -125 | -158 | -162 | -158 | -160 |
| 5 kHz, -6 dBFS, 18 dB drive (near-square) | -25 | -37 | -58 | -58 | -78 | -92 | -110 |

**CPU cost (my benchmark).** Scalar f64 C++ at -O2 on a 2.1 GHz Xeon VM core, mono, per base-rate sample at 48 kHz. [CALC]

| Process | ns per sample | Share of one core | Time per 64-sample block |
|---|---|---|---|
| tanh, no oversampling | 14.6 | 0.07% | 0.9 us |
| first-order ADAA tanh (ln cosh), 1x | 20.8 | 0.10% | 1.3 us |
| 2x HIIR (n = 5) up + down, no nonlinearity | 10.7 | 0.05% | 0.7 us |
| 2x HIIR (n = 5) + tanh | 38.4 | 0.18% | 2.5 us |
| 4x HIIR (n = 5, 2) + tanh | 78.8 | 0.38% | 5.0 us |
| 2x HIIR (n = 5) + Jiles-Atherton RK2 | 316 | 1.5% | 20 us |
| 2x HIIR (n = 5) + Jiles-Atherton RK4 | 623 | 3.0% | 40 us |
| 4x HIIR (n = 5, 2) + Jiles-Atherton RK2 | 623 | 3.0% | 40 us |

(The 64-sample ASIO period at 48 kHz is 1333 us.)

### Inferences
- Recommended design: one shared oversampler per character stage. Stage 0 (48k<->96k): n = 6 (96 dB) or n = 5 (81 dB); optional stage 1 (96k<->192k): n = 2 (71 dB) or n = 3 (102 dB). Clean/tube/console/tape run at 2x; the hard drive/exciter runs at 4x, or at 2x with first-order ADAA inside (the table shows 2x + ADAA1 at -78 dB versus 4x at -92 dB in the worst case). Total added delay 0.06-0.09 ms through the vocal band, i.e. 3-4 samples at 48 kHz. At 44.1 kHz recompute stage 0 with TBW = (24.1k - 20k)/88.2k = 0.0465 (needs more coefficients; not computed here); at 96 kHz base rate a single 2x stage with a wide transition band is enough.
- For vocal-level drive, aliasing is not the dominant quality issue: in the mild tests even the naive curve is 66 dB or more down, and 2x is over 115 dB down. It becomes audible only when sibilance is driven toward clipping (the -25 dB row). So 2x minimum-phase is sufficient for the four gentle characters; spend the extra on the drive stage only.
- First-order ADAA is mathematically a one-sample box average of the continuous-time output: it adds exactly 0.5 sample of delay and a sinc-shaped roll-off, about -0.6 dB at 10 kHz and -2.6 dB at 20 kHz when run at 48 kHz, but only about -0.16 dB at 10 kHz and -0.6 dB at 20 kHz when run inside a 2x stage. [CALC] from sinc(f/fs). This is why it should live inside the oversampled section, and why chowdsp offers a compensation shelf.
- Linear-phase FIR half-bands (CHOW's "linear phase" option, the FIR loss filter) add tens of samples of latency and pre-ringing: unsuitable for live monitoring. Minimum-phase IIR half-bands add phase rotation near 20 kHz instead (delay rising from ~56 us to ~160 us at 20 kHz for n = 5), which is inaudible on a solo voice but matters when a dry copy is mixed in (see section 5).
- Stateful nonlinear stages (J-A solver, slew clamps, signal-modulated one-poles) cannot use ADAA; oversampling is the only general tool for them.
- Per-sample state is a handful of f64 values per stage (2 per all-pass, 3 for the J-A solver), so no heap allocation is needed anywhere.

### Gaps
- I did not read the Parker 2016 or Bilbao 2017 papers themselves; the half-sample (first order) and one-sample (second order) delays come from the code comment (second order) and from my own derivation (first order), not from the papers.
- The benchmark is C++ on a shared VM, not Rust on the target Windows machine; treat it as an order-of-magnitude figure. SIMD or f32 would be faster.
- The STN neural solver's cost and CHOW Tape's own published CPU figures were not found.
- HIIR versions after 1.30 (and their group-delay helper) were not inspected.

---

## 5. Mapping drive, output compensation and mix to one "amount" knob so level stays constant and the result stays flattering on voice

### Takeaway
Open plugins use three patterns that combine well: a closed-form makeup tied to the curve's small-signal gain, a drive taper that is strongly non-linear in the knob (power 1.5 to 8) with inverse output gain, and a wet/dry blend whose dry path shares the wet path's delay. For a voice, keep the knob's whole range inside the region where the fundamental's gain changes by less than about 2 dB and H3 stays below about -30 dB.

### Cited Findings
- CHOW Tape makeup: `makeup = (1 + 0.6*width)/(0.5 + 1.5*(1 - sat))` (compensates saturation level M_s and loop width), parameters smoothed over 500 steps. [SRC] [HysteresisProcessor.cpp](https://github.com/jatinchowdhury18/AnalogTapeModel/blob/master/Plugin/Source/Processors/Hysteresis/HysteresisProcessor.cpp)
- BYOD Dirty Tube: `d8 = drive^8; gainIn = 5.9*d8 + 0.1; gainOut = 1/(5.0*d8 + 1.0)` with 10 ms gain ramps. [SRC] [TubeAmp.cpp](https://github.com/Chowdhury-DSP/BYOD/blob/main/src/processors/drive/tube_amp/TubeAmp.cpp)
- Surge Exciter: `drive = 8*knob^1.5 * 0.2^(1 - tone)` (less drive when the high-pass is set low, because more signal reaches the shaper); harmonics are added to an untouched dry path, `out = dry + wet*mix`. [SRC] [ExciterEffect.cpp](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/ExciterEffect.cpp)
- Calf Saturator: `proc *= 1/level_in; if level_in > 1: proc *= 1 + (level_in - 1)/32`, then `out = (proc*mix + in*(1 - mix))*level_out`. [SRC] [modules_dist.cpp](https://github.com/calf-studio-gear/calf/blob/master/src/modules_dist.cpp)
- Airwindows Tube: input gain rises only to +1.76 dB (`1 + A*0.2246161992650486`) while the curve order drops from 7 to 2; Tube2 is "pretty close to level matched if you have the input trim at 0.5". [SRC] [TubeProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Tube/TubeProc.cpp), [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)
- Airwindows Channel9: one Drive knob crossfades dry -> Spiral over 0..50% and Spiral -> Density sine over 50..100% (`density = 2B`, `phattity = density - 1`), with no input gain change at all. [SRC] [Channel9Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Channel9/Channel9Proc.cpp)
- Airwindows fixed trims: TapeHack output `B*0.9239`, Mojo `*0.987654321`, Dyno `*1.1654321`, Tube2 final `*1.923076923076923` after a 0.52 clamp. [SRC] files cited in section 2
- Small-signal gains I measured for the curves (needed for compensation): Spiral +1.96 dB, Density sine +3.9 dB, Mojo +3.8 dB, Tube A = 0 +1.34 dB, Tube A = 1 +7.2 dB, TapeHack -0.7 dB, PurestSaturation 0 dB, J-A default (with CHOW makeup) -2.6 dB at drive 0.5 and +3.3 dB at drive 1.0. [CALC]

### Inferences
- Recipe for one "amount" knob a in 0..1 (my synthesis of the patterns above):
  1. `drive_dB = D_max * a^p` with p between 1.5 and 2 (Surge uses 1.5) so the first half of the travel is subtle; D_max about 12 dB for tube/console/tape, about 18 dB for the drive stage.
  2. `out_gain = 1/(g0 * drive_lin^c)` where g0 is the curve's small-signal gain (table above) and c is about 0.6-0.8: compensate most but not all of the drive, because the curve itself compresses peaks. Calibrate c offline so that speech-shaped noise at -18 dBFS RMS reads the same loudness (within 0.5 dB) at a = 0, 0.5 and 1; the ready-made fundamental-gain numbers in section 3 give the starting points.
  3. `mix`: 100% wet for tube/console/tape (they are near-transparent at low amount, as in Channel9's internal crossfade); for the exciter keep dry at unity and add `wet * a` (Surge/Calf pattern), so "amount" is literally the added harmonic level.
  4. Smooth every derived gain over about 10 ms (BYOD) to avoid zipper noise.
- The dry path must be time-aligned with the wet path. A 2x IIR oversampler delays the wet signal about 2.7 samples at low frequencies and more near 20 kHz, and first-order ADAA adds 0.5 sample; mixing an undelayed dry copy would comb-filter (first notch near fs/(2*2.7) ~ 8.9 kHz at equal mix). Do the blend inside the oversampled domain (dry and wet both pass the same down-sampler), as the Airwindows code does by mixing `drySample` before its output filter, or run the dry signal through an identical up/down pair. [CALC]/reasoning
- Voice-flattering ranges, from the measured table: keep tube H2 between about -40 and -25 dB with H3 at least 6 dB below it; keep console/tape H3 below about -30 dB at -12 dBFS peaks; let the tape stage's high-band "soften" term, not the main curve, deal with sibilance. Put a DC blocker (1-pole at ~2-5 Hz as in TAP's `srct`, or CHOW's 35 Hz 4th-order) after any asymmetric curve.
- Channel9's approach (no input gain; morph the curve shape with the knob) is the most level-stable of all and needs only a fixed -2 to -4 dB trim.

### Gaps
- No published loudness-matched calibration data for any of these plugins; the exponents p and c above are proposals to be tuned by measurement.
- I found no source with listening-test evidence for the "flattering" harmonic ranges on voice; they are engineering judgement from the measured curves.

---

## 6. Recommended minimal set of 4-5 vocal character models with parameter values and justification

### Takeaway
Five stages cover the brief, each a port or light adaptation of verified open code: Clean (PurestDrive-style), Tube (Tube2 asymmetric stage + Tube curve), Console (Channel9 Neve voicing), Tape (ToTape-style split-band tape, with CHOW's Jiles-Atherton solver as the higher-fidelity option), and Drive/Exciter (chowdsp exciter side chain, optionally Focus). All run in one shared 2x minimum-phase HIIR oversampler (4x for Drive) for about 0.06-0.09 ms of delay.

### Cited Findings
All formulas and constants referenced here are the ones cited with sources in sections 2 and 4; licences in section 1. Nothing new is asserted in this subsection.

### Inferences
Proposed set (my recommendation, built only from the verified material above):

| # | Character | Core algorithm (source) | Suggested fixed values | "Amount" 0..1 maps to | Oversampling | Why |
|---|---|---|---|---|---|---|
| 1 | Clean | Airwindows PurestDrive: `s = sin(x); apply = |prevS + s|/2 * intensity; y = x*(1-apply) + s*apply` (MIT) | none | intensity = a | 1x (no oversampler needed; sin of a sub-unity signal adds only low-order H3) | Almost inaudible glue that backs off on bright, low-level and alternating-polarity content; zero latency, about one sin() per sample |
| 2 | Tube / valve preamp | Tube2 asymmetric "sharpen" stage followed by the Tube polynomial, then a DC blocker (MIT). Optional alternative: static 12AX7 table from the Koren equation with Guitarix's parameters (GPL-2+) | powerfactor 3..5 (Tube about 0.5-0.7) so H2 sits near -55..-45 dB at -12 dBFS and rises with level; DC blocker 1-pole about 5 Hz | input trim +0..+9 dB with 0.7 power makeup; at a > 0.7 lower powerfactor toward 1 for more H2 (-35 dB) | 2x HIIR n = 5 or 6 | Only verified open curve with level-dependent even harmonics and no gross DC shift; the slew-dependent third Tube2 stage can be added later for "edge" |
| 3 | Console / transformer (Neve-style) | Channel9, Neve voicing: pre low-pass 28811 Hz Q 1.618 (skip if above Nyquist at the working rate), dielectric high-pass coefficient 0.005832*(44100/fs_work), Spiral then Density crossfade, slew clamp 0.33362176, post low-pass Q 0.618 (MIT). Add a low-band thickener after it: ToTape8's `Lows = sin(Lows)` on a ~150-250 Hz one-pole split, or Coils2 with Cheapness about 0.2 | as listed | density = 2a (0..0.5 = Spiral blend, 0.5..1 = Density blend); fixed -2..-4 dB trim | 2x. Note the slew threshold is per sample and is not rate-scaled in Channel8/9: at 2x halve it (0.1668) to keep the 48 kHz behaviour | Gives the three things associated with a transformer-coupled preamp in the open code: gentle sub filtering that moves with signal, odd-order thickening that is clean until pushed, and HF slew rounding that tames sibilance |
| 4 | Tape machine | Option A (lightweight, MIT): ToTape6/8 core without flutter and without ClipOnly2: mid/high split, `Highs -= sgn*(1 - cos(|Highs|*pi/2))`, `Lows = sin(Lows)` (or the Mojo curve), head-bump integrator with two band-passes at about 69 Hz and 64 Hz (Q 0.618), mix 0.25. Option B (physical, GPL-3.0): CHOW J-A RK2 with drive 0.5-0.8, sat 0.5, bias 0.5, makeup formula, 35 Hz DC blocker, head-bump peak filter instead of the FIR loss filter | A: ToTape8 defaults (Shape 0.5 gives iirMidFreq 0.691/os); B: as stated | A: input gain (2a)^2-style taper limited to about +9 dB, inverse output; B: drive = 0.3 + 0.5a with CHOW makeup plus a small trim | A: 2x. B: 2x (CHOW default), RK2 | A is cheap and has the built-in HF softening that suits voice; B is the only open model with real hysteresis, at about 1.5% of a core (my benchmark) and odd-harmonic distortion that rises gently with level |
| 5 | Drive / exciter | chowdsp/Surge exciter: 2-pole high-pass (Q 0.7071) at 3-5 kHz, diode-rectifier level detector (attack about 5-10 ms, release about 100 ms), `tanh(x)*level`, added to dry (GPL-3.0-or-later). Harder alternative: Airwindows Focus (3515.775 Hz band, Mojo or Density mode, MIT) | tone 0.55-0.7 (cutoff about 2.6-4 kHz), drive law `8*a^1.5*0.2^(1 - tone)` | wet level = a (dry untouched) | 4x HIIR (n = 5 or 6, then n = 2 or 3), or 2x with first-order ADAA on the tanh | This is the Aphex topology; because only high-passed content is distorted and its harmonics land above 6 kHz, it is the stage where aliasing control matters most |

Implementation notes that follow from the sources:
- Order inside each stage: (pre filter / emphasis) -> upsample -> nonlinear core -> wet/dry blend at the high rate -> downsample -> DC blocker -> output trim.
- Latency budget: 2x n = 6 round trip about 3.2 samples at 48 kHz (67 us at 1 kHz); 4x n = 6,3 about 4.3 samples (89 us). No look-ahead anywhere if flutter, ClipOnly2, second-order ADAA, and FIR loss filters are left out.
- CPU budget from my benchmark: characters 1-3 and 4A are in the 20-80 ns per sample class (well under 0.5% of a core each); 4B about 320 ns per sample; all five in series would still be under 5% of one core, against a 1333 us period for 64 samples.
- Keep "or later": options 1, 2, 3, 4A and the Focus variant of 5 are MIT-derived; the chowdsp exciter is GPL-3.0-or-later (Surge); only option 4B (CHOW Tape) is GPL-3.0 without an explicit "or later".

### Gaps
- None of the five has been listened to or measured in this configuration; parameter values are starting points derived from the static-curve measurements, and need ear-tuning on real vocals.
- The "low-band thickener" for the console stage is my adaptation; there is no verified open transformer model behind it.
- Whether halving Channel9's slew threshold at 2x reproduces its 44.1/48 kHz sound exactly is untested (the clamp is a three-point formula, not a plain difference).
- 44.1 kHz and 96 kHz base-rate coefficient sets were not generated (method given in section 4).
