# Open-source algorithmic reverbs for a vocal chain: completion notes (Room, Chamber, Cloud, Spring, Shimmer, density, CPU, shortlist)

**Scope and method.** This file completes `research_notes/Open source vocal plugin DSP/reverbs.md` (called "the earlier notes" below; its sections A-L are not repeated). Everything marked *[src]* was read by me line by line in fresh clones made on 2026-11-18 (commits: dragonfly-reverb `faf0322`, CloudSeedCore `deb21de`, airwindows `143a86d`, surge `78f07b1`; others are named where used). *[measured]* means I compiled the original C++ in this sandbox and ran it. *[secondary]* means I did not open the primary source. No constant below is invented; where I did not read something, the Gaps say so.

Notation: "N @ F" = N samples stored at reference rate F Hz. `p_(x, f)` = freeverb3's "floor(x*f), at least 1, then increment until prime"; `f_(x, f)` = the same without the prime search.

## Room: the complete per-sample algorithm of freeverb3 `progenitor2` as shipped in Dragonfly Room

### Takeaway
The earlier notes (section D) already hold every table and default correctly; what was missing is the exact element equations, the order of operations inside one sample, the tap read semantics, the modulation/noise sources and the per-rate integer sizes. All of that is below, so Room can be ported without opening the C++ again. Three details matter most: the 15/16 output taps are read *after* the delay writes with `get_z(k)` = "written k-1 samples ago"; the nested all-passes carry their own decay gains (0.938/0.844/0.906 per second, not just a loop gain); and the code's left tap list deviates from its own comment in one tap.

### Cited Findings

**What in the earlier notes is complete and correct (section D of reverbs.md):** the reference rate (34125 Hz); all six tables (`allpassLCo`, `allpassRCo`, `delayLCo`, `delayRCo`, `idxOutCo`, `idxOutCo2`), the 10-stage input chains, the 4-stage cross-feed chains; all defaults (`diff1..4`, `decay0..3`, `damp`, `damp2`, `bassboost`, `spin`, `wander`, `modnoise1/2`, `crossfeed`, `idiff1`, `odiff1`); the decay law; the Dragonfly Room wrapper mapping; `LATE_GAIN` being unused. I re-read all of them against the source and found no error. What follows is only what was missing. — [progenitor.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/progenitor.cpp), [progenitor2.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/progenitor2.cpp)

**Element equations *[src]*** — [allpass_t.hpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/allpass_t.hpp), [allpass.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/allpass.cpp), [delay_t.hpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/delay_t.hpp), [comb_t.hpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/comb_t.hpp)
- Plain delay `process(x)`: `out = buf[i]; buf[i] = x; i = (i+1) % size`. `getlast()` = `buf[i]` (the sample that is `size` samples old, read *before* this sample's write). `get_z(k)` = `buf[i - k]` (wrapped once): when called **after** the write of the current sample, `get_z(1)` is the sample just written, so `get_z(k)` is the line input delayed by `k-1` samples. No bounds check in the `_get_z` variant the reverb uses.
- Plain all-pass `_process(x)`: `z = buf[i]; x += fb*z; out = z - fb*x; buf[i] = x`. (Used by the 4 cross-feed all-passes.)
- Modulated all-pass `allpassm._process_dc(x, mod, fmod)` (the 10 input all-passes use the non-decay form `_process`, i.e. `decay = 1`): buffer length `size + modsize`, `writeidx = 0`, `readidx = 2*modsize` at reset, so the nominal delay is `size - modsize` samples plus the modulation offset `(mod+1)*modsize` in `[0, 2*modsize]` (centre = `size`). Per sample: `m = (mod + 1)*modsize; fl = floor(m); frac = 1 - (m - fl); a = readidx - fl; b = a - 1` (both wrapped); `z1 = buf[b] + frac*(buf[a] - z1)` (first-order all-pass interpolation with state `z1`); `readidx++`; `feedback_mod = feedback + fmod`; `buf[writeidx] = x + z1*feedback_mod; out = decay*z1 - buf[writeidx]*feedback_mod; writeidx++`.
- Double-nested all-pass `allpass2._process(x)` (`buffer1` = inner, size1; `buffer2` = outer, size2): `x += fb2*b2; out = decay2*b2 - x*fb2; x += fb1*b1; buffer2[i2] = decay1*b1 - x*fb1; buffer1[i1] = x` where `b1 = buffer1[i1]`, `b2 = buffer2[i2]` are the oldest samples; both indices then advance.
- Triple-nested all-pass `allpass3._process(x, mod)` (`buffer1` innermost and modulated, length `size1 + size1mod`, `readidx1 = 2*size1mod`; `buffer2` middle; `buffer3` outermost): `x += fb3*b3; out = decay3*b3 - fb3*x; x += fb2*b2; buffer3[i3] = decay2*b2 - fb2*x; t = buffer1[b]*frac + buffer1[a]*(1-frac)` (**linear** interpolation here, with `m = (mod+1)*size1mod`, `fl = floor(m)`, `frac = m - fl`, `a = readidx1 - fl`, `b = a - 1`); `x += fb1*t; buffer2[i2] = decay1*t - fb1*x; buffer1[writeidx1] = x`.
- `get_z1/2/3(k)` on the nested all-passes read `bufferN[idx - k]` with the same "after the write" semantics (for `buffer1` of `allpass3` the reference index is `readidx1`).
- Output comb `_process_ff(x, g)`: `out = buf[i]*g + x; buf[i] = x` (feed-forward echo with LFO-controlled gain).

**Filters, LFOs and noise *[src]*** — [efilter.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/efilter.cpp), [efilter_t.hpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/efilter_t.hpp), [biquad.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/biquad.cpp), [biquad_t.hpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/biquad_t.hpp), [fv3_defs.h](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/fv3_defs.h)
- DC cut: `out = x - x1 + g*y1` with `c = 2*fc/fs`, `g = (sqrt(3) - 2*sin(pi*c)) / (sin(pi*c) + sqrt(3)*cos(pi*c))`; default 5 Hz.
- First-order filters (`iir_1st`, direct form I: `out = x*b1 + y1; y1 = out*a2 + x*b2`). `setLPF_BW`: `t = tan(pi*fc/fs); b1 = b2 = t/(1+t); a2 = (1-t)/(1+t)`. `setHPF_BW`: `b1 = 1/(1+t); b2 = -b1; a2 = (1-t)/(1+t)`. These are the input LPF (`inputdamp`, 20 kHz, clamped to fs/2), the two loop dampers (`damp`) and the LFO smoothers.
- Biquads are RBJ, direct form I (`y = b0*x + b1*x1 + b2*x2 - a1*y1 - a2*y2`), bandwidth mode: `w = 2*pi*fc/fs; alpha = sin(w)*sinh(ln2/2 * bw * w/sin(w))`. LPF: `b0 = b2 = (1-cos w)/2/(1+alpha), b1 = (1-cos w)/(1+alpha), a1 = -2cos w/(1+alpha), a2 = (1-alpha)/(1+alpha)`. APF: `b0 = (1-alpha)/(1+alpha), b1 = -2cos w/(1+alpha), b2 = 1, a1 = b1, a2 = b0`. Used for: bass-boost LPF (`damp2` 500 Hz default, bw 2 octaves), bass all-pass (150 Hz, bw 4), output LPF (`outputdamp`, bw 2; clamped to `fs/2.5`).
- LFO = unit phasor rotated by `2*pi*f/fs` each sample (`re,im` rotation, output `im`, renormalised every 10000 samples), i.e. a sine starting at 0. `lfo1` at `spin` Hz then scaled and smoothed by a first-order LPF at `spinlimit` (20 Hz); `lfo2` at `spin2` (2.4 Hz), LPF at `spinlimit2` (12 Hz).
- `noise1` is `noisegen_pink_frac`: a table of `2^15` samples built by midpoint displacement with Hurst constant 0.5 (`r = 2*H^2 + 0.3` initial amplitude, divided by `2^H` per level, values clamped to +/-1, random numbers from C `rand()`), consumed one value per audio sample. In the original library the whole 32768-point table is regenerated in one call when it runs out (once every 0.68 s at 48 kHz); Dragonfly merged a change on 2026-11-14 (PR #191 "amortise-pink-noise") that spreads the regeneration over the block (two steps per sample).

**Per-sample order of operations (late reverb, both channels) *[src]*** — [progenitor2.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/progenitor2.cpp)
1. `outL = dccutL(inL); outR = dccutR(inR)`.
2. `mnoise = noise1(); lfo = lfo1_lpf((lfo1() + 0.09*mnoise) * wander); mnoise *= 0.06` (modnoise1 = 0.09, modnoise2 = 0.06). One LFO and one noise value serve both channels.
3. Input diffusion, 10 stages, `sign = -1` initially and flipped after every stage: `outL = iAllpassL[i](outL, mod = lfo*sign, fmod = mnoise)`; `outR = iAllpassR[i](outR, mod = lfo, fmod = mnoise*sign)`. Coefficient `-idiff1`; excursion `p_(32/3 = 10, fs/34125)` samples (17 at 48 kHz).
4. Cross-feed: `crossL = CL3(CL2(CL1(CL0(outL))))`, same for R with the CR table, plain all-passes with coefficient `+odiff1`. Then `outL = lpf_in(outL + 0.4*crossR); outR = lpf_in(outR + 0.4*crossL)` (crossfeed = 0.4; `lpf_in` = first-order LPF at `inputdamp`).
5. Loop re-entry: `crossR = delayR_58.getlast(); crossL = delayL_37.getlast()` (the full-length outputs of the last delay of each half, read before they are written this sample); `outL += loopdecay * (crossR + bassb * lpfBassL(bassAPL(crossR)))`; `outR += loopdecay * (crossL + bassb * lpfBassR(bassAPR(crossL)))`.
6. First half of each side: `outL = APm_L2.process_dc( delayL_16( APm_L1.process_dc( dampL(outL), lfo, mnoise ) ), -lfo, -mnoise )`; `outR = APm_R2.process_dc( delayR_ts( APm_R1.process_dc( dampR(outR), -lfo, -mnoise ) ), lfo, mnoise )`. `APm_L1` = 239 (coef diff1, decay d2), `APm_L2` = 392 (coef diff2, decay d3), `delayL_16` = 2; `APm_R1` = 205, `APm_R2` = 329, `delayR_ts` = 1; excursion `p_(32, fs/34125)` (47 at 48 kHz).
7. Second half: `delayL_37( AP3_L( delayL_31( AP2_L( delayL_23(outL) ) ), lfo ) )` and `delayR_58( AP3_R( delayR_49( AP2_R( delayR_40(outR) ) ), -lfo ) )`. Sizes @ 34125: `delayL_23` 1055, `AP2_L` (inner 1944, outer 612), `delayL_31` 344, `AP3_L` (inner 1212 with modulation excursion 121, middle 816, outer 1264), `delayL_37` 1572; `delayR_40` 1460, `AP2_R` (2032, 368), `delayR_49` 500, `AP3_R` (1452 with excursion 5, 688, 1340), `delayR_58` 16.
8. Coefficients/decays: `AP2`: `fb1 (inner) = diff4 = 0.25`, `fb2 (outer) = diff3 = 0.406`, `decay1 = d1`, `decay2 = d2`. `AP3`: `fb1 = fb2 = diff4`, `fb3 = diff3`, `decay1 = decay2 = d1`, `decay3 = d2`. With `T = rt60/RSFactor`: `loopdecay = 0.237^(1/T)`, `d1 = 0.938^(1/(T*decayf))`, `d2 = 0.844^(1/(T*decayf))`, `d3 = 0.906^(1/(T*decayf))`, `decayf = 1`.
9. Output taps (read after step 7; indices are the tables scaled with `f_`, see below). Left = "Dout":
   `0.469 * dL23[1]`
   `+ 0.219 * ( dL31[40] - dR49[192] + dL31[276] - dR40[110] - dR49[468] )`
   `+ 0.064 * ( dL37[1572] + AP2_L.z1[121] + AP2_L.z2[480] - AP2_R.z2[103] + AP3_L.z1[26] + AP3_L.z2[780] + AP3_L.z3[1200] - AP3_R.z2[310] )`
   `+ 0.045 * dL37[780]`
   Right = "Bout":
   `0.469 * dR40[625]`
   `+ 0.219 * ( dR49[468] - dL31[312] + dR49[24] - dL37[36] - dL23[790] - dL31[189] )`
   `+ 0.064 * ( dR58[8] + AP2_R.z1[10] + AP2_R.z2[359] - AP2_L.z2[30] + AP3_R.z1[10] + AP3_R.z2[109] + AP3_R.z3[1310] - AP3_L.z2[800] )`
   `+ 0.045 * dR58[10]`
   (numbers in brackets are @ 34125 Hz; `z1/z2/z3` = inner/middle-or-outer/outer buffer of the nested all-pass as defined above). The left side has 15 taps and the right side 16. The source comment above the left expression lists `node45_49[2] * -0.438` as the sixth tap, but the code reads `delayR_49` at `iOutC[1]` (= 468), not at `iOutC2[2]` (= 2); `idxOutCo2[2]` is never used. A faithful port follows the code.
10. `lfo = lfo2_lpf(lfo2() * wander2); outL = outCombL.process_ff(Dout, lfo); outR = outCombR.process_ff(Bout, -lfo)` (comb length `p_(22, fs*0.001)` = 1061 samples at 48 kHz, the "spin2wander" 22 ms).
11. `wetL = predelayL(out_lpfL(outL))`, same for R; `outputL = wetL*wet1 + wetR*wet2 (+ dry)`, with `wet1 = wet*(width/2 + 0.5)`, `wet2 = wet*(1 - width)/2`.

**Integer sizes after prime rounding (my arithmetic with `p_`/`f_` exactly as coded; the factor is `fs*RSFactor/34125`)** — [revbase.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/revbase.cpp), [utils.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/utils.cpp)

| Element (@ 34125) | 48 kHz, RS 1.0 (Size 10 m) | 48 kHz, RS 1.2 (Size 12 m) | 44.1 kHz, RS 1.0 | 96 kHz, RS 1.0 |
|---|---|---|---|---|
| iAllpassL 617,535,434,347,218,162,144,122,109,74 | 877,757,613,491,307,227,211,173,157,107 | 1049,907,733,587,367,277,251,211,191,127 | 797,691,563,449,281,211,191,157,149,97 | 1741,1511,1223,977,613,457,409,347,307,211 |
| iAllpassR 603,547,416,364,236,162,140,131,111,79 | 853,769,587,521,331,227,197,191,157,113 | 1019,929,709,617,401,277,239,223,191,137 | 787,709,541,479,307,211,181,173,149,103 | 1697,1543,1171,1031,673,457,397,373,313,223 |
| cross-feed L 430,341,264,174 | 607,479,373,251 | 727,577,449,293 | 557,443,347,227 | 1213,967,743,491 |
| cross-feed R 447,324,247,191 | 631,457,347,269 | 757,547,419,331 | 577,419,331,251 | 1259,911,701,541 |
| allpassL 239,392,1944,612,1212,(121),816,1264 | 337,557,2741,863,1709,(173),1151,1777 | 409,661,3299,1033,2053,(211),1381,2137 | 311,509,2521,797,1567,(157),1061,1637 | 673,1103,5471,1721,3413,(347),2297,3557 |
| allpassR 205,329,2032,368,1452,(5),688,1340 | 293,463,2861,521,2053,(7),967,1889 | 347,557,3433,631,2459,(11),1163,2267 | 269,431,2633,479,1877,(7),907,1733 | 577,929,5717,1039,4091,(17),1949,3769 |
| delays L (16, 23, 31, 37) 2,1055,344,1572 | 2,1483,487,2213 | 3,1783,587,2657 | 2,1367,449,2039 | 5,2969,967,4423 |
| delays R (ts, 40, 49, 58) 1,1460,500,16 | 1,2053,709,23 | 1,2467,853,29 | 1,1889,647,23 | 2,4111,1409,47 |
| modulation excursion 32 / 10 | 47 / 17 | 47 / 17 | 41 / 13 | 97 / 29 |
| output comb 22 ms | 1061 | 1061 | 971 | 2113 |

(The bracketed all-pass entry is the modulation excursion of the innermost stage of the triple-nested all-pass; note it scales with `RSFactor` too, unlike the other excursions, because it goes through `totalFactor`.) `isPrime(1)` returns true in this library, so 1 stays 1.

Tap indices are scaled with `f_` (no prime search): at 48 kHz, RS 1.0, `idxOutCo` {276, 468, 625, 312, 8, 24, 36, 40, 1, 192, 1572} becomes {388, 658, 879, 438, 11, 33, 50, 56, 1, 270, 2211} and `idxOutCo2` {110, 790, 2, 189, 121, 10, 480, 359, 103, 30, 26, 10, 780, 109, 1200, 1310, 780, 10, 310, 800} becomes {154, 1111, 2, 265, 170, 14, 675, 504, 144, 42, 36, 14, 1097, 153, 1687, 1842, 1097, 14, 436, 1125} (my arithmetic). All stay inside their buffers at the four configurations in the table.

**Decay gains at typical vocal settings (my arithmetic from the law above):** decay 0.3 s at 8 m (RS 0.8): `loopdecay 0.0215, d1 0.843, d2 0.636, d3 0.769`; 0.6 s at 12 m: `0.0562, 0.880, 0.712, 0.821`; 1.0 s at 15 m: `0.115, 0.908, 0.775, 0.862`; 2.0 s at 10 m: `0.487, 0.969, 0.919, 0.952`. — [progenitor.cpp `resetdecay`](https://github.com/michaelwillis/dragonfly-reverb/blob/master/common/freeverb/progenitor.cpp)

**Dragonfly Room wrapper, items not in the earlier notes *[src]*** — [dragonfly-room-reverb/DSP.cpp](https://github.com/michaelwillis/dragonfly-reverb/blob/master/plugins/dragonfly-room-reverb/DSP.cpp), [DistrhoPluginInfo.h](https://github.com/michaelwillis/dragonfly-reverb/blob/master/plugins/dragonfly-room-reverb/DistrhoPluginInfo.h)
- Signal order: `filtered = inLPF(inHPF(input))` (first-order Butterworth each, per channel) -> `early = earlyref(filtered)` -> `lateIn = early_send*early + filtered` -> `late = progenitor2(lateIn)` -> `out = dry*input + earlyLevel*early + lateLevel*late`. Processed in chunks of the plugin's internal `BUFFER_SIZE`; no latency.
- The wrapper never calls `setReverbType`, so the default (`FV3_REVTYPE_SELF`) selects the progenitor2 path described above (not the plain `progenitor` path, which has no input diffusion and only 4 taps per side).
- Late block is set up with `setwet(0 dB)`, `setdryr(0)`, `setwidth(1.0)`; the Width parameter sets `late.setwidth(v/100)` and `early.setwidth(v/120)`; pre-delay values under 0.1 ms are replaced by 0.1 ms ("Freeverb doesn't handle zero predelay properly").
- Parameter ranges: Size 8-32 m; Width 50-150 %; Predelay 0-100 ms; Decay 0.1-10 s; Diffuse 0-100 %; Spin 0-5 Hz; Wander 0-100 %; High Cut / Early Damp / Late Damp 1-16 kHz; Low Boost 0-100 %; Boost Freq 50-1050 Hz; Low Cut 0-200 Hz. Levels in the factory presets: Dry 80, Early 10, Early Send 20, Late 20.
- Besides the vocal presets listed in the earlier notes, the Room plugin ships an "Echo Chamber" effect preset: size 12 m, width 120, pre-delay 10 ms, decay 4.0 s, diffuse 24 %, spin 2.3 Hz, wander 80 %, early damp 12 kHz, late damp 9 kHz, low boost 20 % at 500 Hz.

**Measured cost *[measured]*:** see the CPU section; progenitor2 alone ran at 185-345 ns per stereo sample at 48 kHz depending on compiler flags (0.9-1.7 % of one core), about 4-5x the Dattorro plate.

### Inferences
- Because the two modulated all-passes at the head of each half-loop and the nested all-passes all apply `decay` to their delayed path only (not to the feed-through path), they are not true all-passes when `decay < 1`: they are lossy, and at short decay settings they do most of the damping of the tail while `loopdecay` (as low as 0.02 at 0.3 s) barely recirculates anything. The Room sound at vocal settings (0.3-1.0 s) is therefore largely one pass through 10 + 2 + nested 5 all-pass stages per side plus cross-feed: a dense burst rather than a recirculating tail. That is structurally unlike the 8-line FDN the app currently re-voices as "Room".
- The Diffuse control maps to `idiff1 = odiff1 = diffuse/120`, so the vocal presets (86-98 %) run the 10 input all-passes at 0.72-0.82: very high diffusion, which is what gives the room its smooth, non-fluttery onset on consonants.
- For a Rust port: all sizes can be computed at parameter-change time with `p_`; buffers should be pre-allocated for the largest case (Size 32 m at 96 kHz gives a factor of 9.0, so the longest all-pass, 2032, needs about 18.3k samples plus the excursion); the `floor()` in the modulated all-passes can be an integer truncation because the modulation offset is never negative; and the pink-noise table should be generated incrementally or replaced by a cheap smoothed noise, since the original regenerates 32768 values in one call.
- A mono-in port can keep both input chains: the same mono signal through the L and R input all-pass tables already gives decorrelated L/R injection, which is how Dragonfly behaves with a mono source on both inputs.

### Gaps
- I did not diff Dragonfly's vendored freeverb3 against the latest upstream freeverb3 release (nongnu.org is not reachable from this sandbox); the only local change I can see is the amortised noise generator merged on 2026-11-14.
- The exact random sequence of the modulation noise depends on C `rand()` and cannot be reproduced bit-for-bit in Rust; it does not need to be (it is a +/-9 % perturbation of the LFO and +/-0.06 of the all-pass coefficients).
- The origin of the tap weights and of the "normalized decay attenuation for 1 s" constants is only documented by the source comment citing the Lexicon 224 manual; I did not consult the manual.

