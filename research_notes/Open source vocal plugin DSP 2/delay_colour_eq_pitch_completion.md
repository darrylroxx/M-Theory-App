# Completion notes: delay/modulation, colour, EQ and pitch gaps left by the cut-short study (source-level, 2026-11-18)

Status: IN PROGRESS — sections are appended in priority order as each question is closed.

Evidence tags used throughout: **[SRC]** = read directly in the cited source file in this session; **[CALC]** = computed/measured by me in this session from that source (program named); **[2ND]** = secondary (article, forum, search summary); **[MEM]** = from my own background knowledge, not re-verified here (never used for constants to port).

Earlier notes this builds on (not repeated): `research_notes/Open source vocal plugin DSP/{delays_modulation,saturation_character,eq,pitch_and_vocal_chain}.md`.

## 1. Bucket-brigade delay: the Holters–Parker constant disagreement, one self-consistent algorithm, stage counts, bandwidth, CPU

### Takeaway
The two code bases do **not** model different chips: both start from the same Juno-60 filter poles, but **string-machine carries the complete 5-term partial-fraction sets (one real pole + two complex pairs per filter) and implements the paper's fractional-time algorithm exactly, whereas chowdsp/Surge keep only the four complex terms (one SIMD register), with altered residues, and their loop neither re-synchronises the gain vector to the intra-sample tick time nor uses the output bank's state**. Port the string-machine form (BSL-1.0); a faithful scalar version costs 13–57 ns per sample (0.06–0.27 % of one core at 48 kHz) for a 4096-stage line between 600 ms and 40 ms, i.e. about the same as a plain interpolated delay with four biquads at long delay times.

### Cited Findings

**The two constant sets, verbatim**
- string-machine, `namespace j60` [SRC]: `R_in[5] = {{251589, 0}, {-130428, -4165}, {-130428, 4165}, {4634, -22873}, {4634, 22873}}`; `P_in[5] = {{-46580, 0}, {-55482, 25082}, {-55482, -25082}, {-26292, -59437}, {-26292, 59437}}`; `R_out[5] = {{5092, 0}, {11256, -99566}, {11256, 99566}, {-13802, -24606}, {-13802, 24606}}`; `P_out[5] = {{-176261, 0}, {-51468, 21437}, {-51468, -21437}, {-26276, -59699}, {-26276, 59699}}` (pairs are (re, im); element m of R belongs to element m of P). Header comment: "Analog specifications of BBD filters, input and output. M=order R=numerator P=denominator. Analog transfer: H(s)=sum(m:1→M) (R[m]/(s-P[m]))" and "The model of BBD input and output filters from Juno 60." — [bbd_filter.cpp](https://github.com/jpcima/string-machine/blob/master/sources/bbd/bbd_filter.cpp), [bbd_filter.h](https://github.com/jpcima/string-machine/blob/master/sources/bbd/bbd_filter.h)
- chowdsp_utils [SRC]: `iFiltRoot[4] = {{-10329.2715, -329.848}, {-10329.2715, +329.848}, {366.990557, -1811.4318}, {366.990557, +1811.4318}}`; `iFiltPole[4] = {{-55482, -25082}, {-55482, +25082}, {-26292, -59437}, {-26292, +59437}}`; `oFiltRoot[4] = {{-11256, -99566}, {-11256, +99566}, {-13802, -24606}, {-13802, +24606}}`; `oFiltPole[4] = {{-51468, -21437}, {-51468, +21437}, {-26276, -59699}, {-26276, +59699}}`; `inputFilterOriginalCutoff = 9900.0f`, `outputFilterOriginalCutoff = 9500.0f`; comment "Anti-aliasing/reconstruction filters used by JUNO-60 chorus. Root/Pole analysis borrowed from the above paper." — [chowdsp_BBDFilterBank.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_dsp_utils/Delay/BBD/chowdsp_BBDFilterBank.h)
- Surge XT's copy has the identical four-term constants and the identical loop (`N_filt = 4`; `originalCutoff = 9900.0f` / `9500.0f`); it is under "GPL-3.0-or-later" per its file header. [SRC] — [Surge BBDFilterBank.h](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/bbd_utils/BBDFilterBank.h), [Surge BBDDelayLine.h](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/bbd_utils/BBDDelayLine.h)
- Licences: string-machine's LICENSE is the "Boost Software License - Version 1.0" (compatible; keep the notice in source). chowdsp's `chowdsp_dsp_utils` module header says `license: GPLv3` (no "or later" wording in that header line). [SRC] — [string-machine LICENSE](https://github.com/jpcima/string-machine/blob/master/LICENSE), [chowdsp_dsp_utils.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_dsp_utils/chowdsp_dsp_utils.h)

**What the difference is (computed from the two tables; program `bbd_consts.py`, numpy, evaluating H(j2πf) = Σ R/(j2πf − P))** [CALC]
- string-machine input filter: a 5th-order all-pole low-pass. The partial-fraction numerator collapses to a constant (residues sum to 1 against magnitudes of 2.5e5, i.e. zero within the table's integer rounding). DC gain 0.96776 (−0.28 dB); −1/−3/−20/−40 dB (relative to DC) at 3558 / 6514 / 14548 / 23453 Hz; −103 dB at 100 kHz. Pole natural frequencies and Q: 7413 Hz (real), 9691 Hz Q 0.549, 10344 Hz Q 1.236.
- string-machine output filter: 5th-order all-pole low-pass, DC gain 0.91384 (−0.78 dB); −1/−3/−20/−40 dB at 5789 / 8755 / 16560 / 27826 Hz. Poles: 28053 Hz (real), 8874 Hz Q 0.542, 10381 Hz Q 1.241. Product of DC gains 0.88438.
- chowdsp input set: the complex pole pairs are the same numbers, the real pole −46580 is absent, and every residue equals the string-machine residue divided by **12.6270** (all four ratios agree to 7 digits); the first pair is also attached to the conjugate pole relative to string-machine. As an analog prototype this 4-term sum is **not** a 4th- or 5th-order low-pass: DC gain −0.360 (inverted, −8.9 dB), falling only 6 dB/octave at high frequency (−30 dB at 100 kHz) because the residues no longer sum to zero.
- chowdsp output set: real pole −176261 absent; second pair identical to string-machine; first pair has the sign of its real part flipped (−11256 instead of +11256) and is attached to the conjugate pole, which makes `R/P` the negated conjugate of string-machine's value. DC "gain" −Σ R/P = **−2.607** (string-machine: +0.914). The product of chowdsp's two DC gains is (−0.360)(−2.607) = +0.939, so the two sign inversions cancel and the cascade is near unity.
- Dropping a real pole from a partial-fraction expansion does not give "the same filter without one pole": it gives a different transfer function. So the chowdsp table is a re-tuned 4-term variant made to fit one 4-wide SIMD register ("We need SIMD size 4 (for now)" is the comment in the class), not a transcription of a different chip. I could not find where the factor 12.627 comes from (no derivation in chowdsp_utils, Surge, or the author's NonIntegerSRC repo, which re-uses the same numbers). — [chowdsp_BBDFilterBank.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_dsp_utils/Delay/BBD/chowdsp_BBDFilterBank.h), [NonIntegerSRC HPFilters.h](https://github.com/jatinchowdhury18/NonIntegerSRC/blob/main/src/src_utils/HPFilters.h)

**What the two loops do (read line by line)** [SRC]
- string-machine `compute_filter`: `pm[m] = exp(ts*P[m])`; input gains for fractional position d∈[0,1]: `G_in[m](d) = ts * R[m] * pm[m]^d`; output gains: `G_out[m](d) = (R[m]/P[m]) * pm[m]^(1-d)`; `H = -Σ R[m]/P[m]` (real part). Tables of 128 rows (`interp_size = 128`), linearly interpolated per tick. — [bbd_filter.cpp](https://github.com/jpcima/string-machine/blob/master/sources/bbd/bbd_filter.cpp), [bbd_line.cpp](https://github.com/jpcima/string-machine/blob/master/sources/bbd/bbd_line.cpp)
- string-machine `process` per audio sample i (clock given as `fclk` = ticks per audio sample): `pclk_old = pclk; pclk += fclk; tick_count = floor(pclk); pclk -= tick_count;` for each tick: `d = (1 - pclk_old + tick)/fclk; d -= floor(d)`; **even tick** (write): `mem[imem] = Re Σ G_in[m](d)·Xin[m]`, advance `imem` modulo `ns`; **odd tick** (read): `ybbd = mem[imem]; delta = ybbd - ybbd1; ybbd1 = ybbd; Xout[m] += G_out[m](d)·delta`. After the ticks: `Xin[m] = Pin[m]·Xin[m] + input[i]`; `xout = Pout[m]·Xout1[m] + Xout[m]; Xout1[m] = xout`; `output[i] = Re(H·ybbd1 + Σ xout)`. Delay relation: `hz_rate_for_delay(delay, stages) = 2*stages/delay` (tick rate; one write per two ticks). — [bbd_line.cpp](https://github.com/jpcima/string-machine/blob/master/sources/bbd/bbd_line.cpp), [bbd_line.h](https://github.com/jpcima/string-machine/blob/master/sources/bbd/bbd_line.h)
- chowdsp `process` (non-"alien"): `while (tn < Ts) { if (evenOn) { inputFilter->calcG(); buffer[bufferPtr++] = Σ Re(Gcalc·x); wrap at STAGES } else { yBBD = buffer[bufferPtr]; delta = yBBD - yBBD_old; yBBD_old = yBBD; outputFilter->calcG(); xOutAccum += Gcalc*delta; } evenOn = !evenOn; tn += Ts_bbd; } tn -= Ts; inputFilter->process(u); outputFilter->process(xOutAccum); sumOut = Σ Re(xOutAccum); return H0*yBBD_old + sumOut;` — [chowdsp_BBDDelayLine.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_dsp_utils/Delay/BBD/chowdsp_BBDDelayLine.h)
- Three departures from the paper's scheme are visible in that code: (1) `calcG()` is `Gcalc = Aplus * Gcalc` with `Aplus = (cos(angle·delta), sin(angle·delta))`, `angle = arg(pole_corr)` (radians **per sample**) and `delta = 2*Ts_bbd` (**seconds**), so each tick rotates G by a unit-modulus factor of about 1e-5 rad instead of setting it to `p^d`; the decay `|p|^d` is never applied and G is never reset at a sample boundary. (2) `set_time(tn)` (the only place G is set absolutely, `gCoef * pow(pole_corr, tn)` with `tn` in seconds, i.e. ≈ `gCoef`) is called only from `setInputFilterFreq/setOutputFilterFreq`; the wrapper's doc comment says "@attention make sure to call `setFilterFreq()` every block". (3) The returned value sums `xOutAccum` (this sample's tick contributions) and not the output bank's state `x`, which is updated by `outputFilter->process(xOutAccum)` but never read. — [chowdsp_BBDFilterBank.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_dsp_utils/Delay/BBD/chowdsp_BBDFilterBank.h), [chowdsp_BBDDelayLine.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_dsp_utils/Delay/BBD/chowdsp_BBDDelayLine.h), [chowdsp_BBDDelayWrapper.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_dsp_utils/Delay/BBD/chowdsp_BBDDelayWrapper.h)
- Consequence measured with a scalar copy of that loop (my program `bbd.cpp`, `struct ChowBBD`, 4096 stages, 300 ms, 48 kHz) [CALC]: if the filter frequency is set once and never again, the gain drifts (1 kHz sine at filter freq 9900/9500: +3.4, −0.1, +2.9, +1.3, −2.6, +4.5, +1.7, −4.6 dB in successive 2 s windows; the DC gain changed from +1.48 to −1.32 between 1 s and 6 s). With G re-initialised every 128 samples (as the "call every block" instruction implies) the response is stable: DC gain 1.563 (+3.9 dB) and −3.7 dB at 8 kHz / −9.3 dB at 10 kHz with the "original" cutoffs; DC gain 1.051 and −2.0 dB at 2 kHz / −8.8 dB at 4 kHz / −19.5 dB at 8 kHz with ChowMatrix's 2000 Hz setting. Because G then never depends on where inside the sample a tick falls, tick instants are effectively quantised to the host sample grid.

**Surge's BBD compander file (earlier gap)** [SRC]
- `BBDAverager::process(x) = onePole(|x|^1.25)` (first-order low-pass, cutoff set by caller); `BBDExpander::process(x) = BBDAverager::process(x) * x`; `BBDCompressor::process(x): y = x / max(BBDAverager::process(y1), 0.0001); y1 = y` (feedback detector, one-sample delay); comment: "Signal averager used for BBD companding. Borrowed from Fig. 11, from Huovilainen's DAFx-05 paper". No cutoff value is in the file. — [Surge BBDCompander.h](https://github.com/surge-synthesizer/surge/blob/main/src/common/dsp/effects/chowdsp/bbd_utils/BBDCompander.h)

**One complete algorithm (string-machine's scheme with the conjugate pairs folded into real arithmetic; verified by my own implementation `bbd.cpp`, `struct HPBBD`)** [SRC for the scheme, CALC for the verification]
```
constants (string-machine j60; s-plane, rad/s):
  input : r0=251589      p0=-46580
          r1=-130428-4165j   p1=-55482+25082j      (conjugate term implied)
          r2=4634-22873j     p2=-26292-59437j      (conjugate term implied)
  output: r0=5092        p0=-176261
          r1=11256-99566j    p1=-51468+21437j
          r2=-13802-24606j   p2=-26276-59699j
  H0 = -Re Σ_all5 r/p = 0.913843 (output filter DC gain);  input DC gain 0.967761;  cascade 0.884382
setup(fs, N stages, k_in, k_out):          // k scales a filter's cut-off: p -> k*p ; input r -> k*r ; output r/p unchanged
  Ts = 1/fs ;  P_m = exp(Ts*k*p_m)  for each of the 3 stored poles of each bank (1 real + 2 complex)
  table over d = 0..1 (I used 257 rows, linear interpolation; string-machine uses 128):
     Gin_m(d)  = Ts * k_in*r_m * exp(k_in*p_m*Ts*d)
     Gout_m(d) = (r_m/p_m) * exp(k_out*p_m*Ts*(1-d))
  mem[N] = 0 ; w = 0 ; phase = 0 ; tick = 0 ; y_last = 0 ; Xin[3] = 0 ; Xout[3] = 0
per audio sample x, with f = ticks per sample = 2*N/(delay_seconds*fs):
  acc[3] = 0
  old = phase ; phase += f ; n = floor(phase) ; phase -= n
  for t in 0..n-1:
     d = frac((1 - old + t)/f)                               // position of the tick inside the sample period
     if tick even:  mem[w] = Gin_0(d)*Xin_0 + 2*Re(Gin_1(d)*Xin_1) + 2*Re(Gin_2(d)*Xin_2) ; w = (w+1) mod N
     else:          y = mem[w] ; delta = y - y_last ; y_last = y ; acc_m += Gout_m(d)*delta   (m = 0,1,2)
     tick += 1
  Xin_m  = P_in_m *Xin_m  + x            (m = 0 real, 1..2 complex)
  Xout_m = P_out_m*Xout_m + acc_m
  out = H0*y_last + Xout_0 + 2*Re(Xout_1) + 2*Re(Xout_2)
```
(The read on an odd tick takes `mem[w]`, the oldest cell, immediately before it is overwritten by the next even tick; N stages therefore give a delay of N write periods = N/(N/delay) = delay.)
- Verification of that implementation at 48 kHz [CALC]: steady-state DC gain 0.88437 (= 0.96776 × 0.91384, the two analog DC gains); impulse-response centroid delay 3.615 ms for a nominal 3.5 ms (256 stages), 40.115 / 120.115 / 300.133 ms for nominal 40 / 120 / 300 ms (4096 stages) — i.e. the nominal delay plus about 0.12 ms of filter group delay; sine response with the unscaled Juno filters, 4096 stages at 300 ms: −1.07 dB at 100 Hz, −1.26 dB at 1 kHz, −1.83 dB at 2 kHz, −4.04 dB at 4 kHz, −7.69 dB at 6 kHz, −13.5 dB at 8 kHz, −23.6 dB at 10 kHz. To make the line unity-gain divide the output by 0.88438.

**Bandwidth and alias protection for a 40–600 ms vocal echo (from the analog prototype: |H_in(f/k)|·|H_out(f/k)|·|sinc(f/f_write)|, f_write = N/delay)** [CALC, `bbd_bw.py`]

| Stages | Delay | Write rate N/D | Ticks per 48 kHz sample | Filters fixed at Juno values (k = 1): −3 dB / −6 dB | Input-filter attenuation at write-Nyquist | With tracking k = min(1, f_write/29200): −3 dB / −6 dB | Attenuation at write-Nyquist |
|---|---|---|---|---|---|---|---|
| 4096 | 40 ms | 102.4 kHz | 4.27 | 5.37 / 7.56 kHz | −74 dB | same (k = 1) | −74 dB |
| 4096 | 100 ms | 40.96 kHz | 1.71 | 5.18 / 7.34 kHz | −34 dB | same (k = 1) | −34 dB |
| 4096 | 200 ms | 20.48 kHz | 0.85 | 4.64 / 6.62 kHz | −8.4 dB | 3.50 / 4.98 kHz (k = 0.701) | −20 dB |
| 4096 | 300 ms | 13.65 kHz | 0.57 | 4.02 / 5.72 kHz | −3.3 dB | 2.33 / 3.32 kHz (k = 0.468) | −20 dB |
| 4096 | 450 ms | 9.10 kHz | 0.38 | 3.22 / 4.52 kHz | −1.6 dB | 1.55 / 2.21 kHz (k = 0.312) | −20 dB |
| 4096 | 600 ms | 6.83 kHz | 0.28 | 2.63 / 3.65 kHz | −0.9 dB | 1.17 / 1.66 kHz (k = 0.234) | −20 dB |
| 8192 | 40 ms | 204.8 kHz | 8.53 | 5.40 / 7.59 kHz | −104 dB | same | −104 dB |
| 8192 | 200 ms | 40.96 kHz | 1.71 | 5.18 / 7.34 kHz | −34 dB | same | −34 dB |
| 8192 | 300 ms | 27.31 kHz | 1.14 | 4.93 / 7.03 kHz | −17.5 dB | 4.66 / 6.64 kHz (k = 0.935) | −20 dB |
| 8192 | 450 ms | 18.20 kHz | 0.76 | 4.48 / 6.40 kHz | −6.2 dB | 3.11 / 4.42 kHz (k = 0.623) | −20 dB |
| 8192 | 600 ms | 13.65 kHz | 0.57 | 4.02 / 5.72 kHz | −3.3 dB | 2.33 / 3.32 kHz (k = 0.468) | −20 dB |

(The tracking law puts the write-Nyquist frequency at the Juno input filter's −20 dB point, 14.55 kHz·k; this is my design choice, not a sourced value. Per-repeat loss is the single-pass figure; n repeats multiply it.)

**CPU cost (my benchmark of `HPBBD`, scalar double arithmetic, `g++ -O2`, one core of a 2.1 GHz Xeon VM, white-noise input, mono, 48 kHz)** [CALC]

| Configuration | Ticks/sample | ns per sample | Share of one core |
|---|---|---|---|
| 4096 stages, 600 ms | 0.28 | 13.1 | 0.063 % |
| 4096 stages, 300 ms | 0.57 | 14.8 | 0.071 % |
| 4096 stages, 120 ms | 1.42 | 23.9 | 0.115 % |
| 4096 stages, 40 ms | 4.27 | 56.7 | 0.272 % |
| 8192 stages, 600 ms | 0.57 | 14.5 | 0.070 % |
| 8192 stages, 300 ms | 1.14 | 20.4 | 0.098 % |
| 8192 stages, 40 ms | 8.53 | 107.1 | 0.514 % |
| 1024 stages, 40 ms | 1.07 | 19.8 | 0.095 % |
| 256 stages, 3.5 ms (Juno chorus) | 3.05 | 43.0 | 0.206 % |
| reference: linear-interpolated delay + 4 biquads + tanh | — | 16.1 | 0.077 % |

- Operation count per audio sample (real multiplies, folded form): fixed part 19 (input states 1 + 2×4, output states 1 + 2×4, one for H0) plus about 10 per tick (5 table interpolations + 5 products for a write, the same for a read, plus one divide-free position computation); two delay-memory accesses per two ticks. Memory: N floats + 2 × 257 × 5 table floats + 10 state doubles; no allocation after setup. [CALC from the code above]
- ChowMatrix's own settings for reference (already in the earlier notes): short BBD 4096 stages at filter 2000 Hz, long BBD 16384 stages at 9000 Hz. — [VariableDelay.cpp](https://github.com/Chowdhury-DSP/ChowMatrix/blob/main/src/dsp/Delay/VariableDelay.cpp)

**Is a much cheaper approximation audibly comparable according to any source?**
- I found no source that reports a listening comparison between the Holters–Parker model and a plain delay line with tracking low-pass filters and soft saturation. The only relevant statement retrieved (search summary of a 2025 DAFx paper whose host is blocked here) separates "BBD-generated aliasing" (the chip sampling at its clock rate, part of the device's sound) from "simulation-generated aliasing", and treats a "trivial discrete-time simulation" as the baseline that needs correcting. [2ND] — [DAFx25 paper 29 (search summary only)](https://dafx25.dii.univpm.it/wp-content/uploads/2025/09/DAFx25_paper_29.pdf)

### Inferences
- Use the string-machine table and scheme. It is the only one of the two whose numbers form the stated filters (5th-order low-passes with −3 dB at 6.5 kHz in and 8.8 kHz out), whose loop matches its own formulas, and whose licence is permissive. The chowdsp/Surge variant works as a musical effect but should not be described as "the Holters–Parker model", and its constants should not be mixed with string-machine's loop (its output set gives H0 = −2.6 and inverts polarity).
- Recommended configuration for a vocal echo of 40–600 ms: **4096 stages for 40–300 ms** (the range where the write rate stays at or above 13.65 kHz) and **8192 stages for 300–600 ms**, with both filter cut-offs scaled by `k = min(1, (N/delay)/29200)` and the output divided by 0.88438. That gives a single-pass bandwidth (−3 dB) of about 5.2–5.4 kHz below 200 ms falling to 2.3 kHz at the long end of each range, with at least 20 dB of input-filter attenuation at the write-Nyquist frequency. Running with fixed (k = 1) filters instead reproduces the "aliasing at long settings" behaviour of a pedal turned past its design range (only 3.3 dB of protection at 300 ms / 4096 stages). Switching stage count changes the tone at the switch point (5.4 kHz versus 2.3 kHz at 300 ms), so the switch should be a mode ("short" / "long"), not automatic.
- CPU is not a reason to avoid the faithful model: at vocal-echo delay times it is 13–24 ns per sample per line, the same order as the existing echo core; only very short delays on a long line (8192 stages at 40 ms: 107 ns) are wasteful.
- What a filters-plus-saturation approximation cannot produce is the fold-back of input energy above the write-Nyquist frequency and the staircase reconstruction; with the tracking law above those products are at least 20 dB (typically 25–40 dB) below the signal that causes them, and a sung voice has little energy above 5 kHz apart from sibilance. So for the "analog echo" type the approximation already in the app is likely to differ audibly only on sibilants and at long delay settings with untracked filters. This is my reasoning from the measured attenuations, not a sourced listening result.
- Companding is still absent from every open delay read; the Surge file gives the only open compander pair (|x|^1.25 detector, divide/multiply), and it is unused by Surge's own ensemble effect (earlier notes).

### Gaps
- The Holters & Parker DAFx-2018 paper itself (dafx.de, dafx2018.web.ua.pt, hsu-hh.de all blocked): I could not compare either table with the paper's Table 1, so "string-machine carries the paper's numbers" is inferred from internal consistency (the 5-term sets form clean all-pole filters), not from the paper. The origin of chowdsp's 1/12.627 residue scaling and sign changes is unknown.
- No listening test exists in any source I could reach; my statements on audibility are inferences.
- Clock feed-through, bucket leakage/charge-transfer loss and compander time constants: no open model with numbers found. The Huovilainen DAFx-05 paper cited by Surge's compander was not readable (host blocked).
- Timings are C++ on a shared VM core; a Rust port on the target machine should be re-timed. I did not test time-varying delay (modulated clock) for zipper noise, nor measure the alias spectrum of the faithful model directly.

