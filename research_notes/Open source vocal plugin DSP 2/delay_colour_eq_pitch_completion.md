# Completion notes: delay/modulation, colour, EQ and pitch gaps left by the cut-short study (source-level, 2026-11-18)

Status: COMPLETE — all six questions closed in priority order (2026-11-18).

Programs I wrote and ran for the [CALC] items (kept in the session scratch directory, not in the repository): `bbd_consts.py`, `bbd.cpp`, `bbd_bw.py` (section 1); `hd.cpp`, `hiir_eval.py`, `hiir_sim.py` (section 2); `weave.py`, `ch9.py`, `tt6.py` (section 3); `pultec.py` (section 5, sympy 1.14); `rt_test.cpp`, `rt_time.cpp` with `shim/fftw3.h` (section 6). Toolchain: g++ -O2 -std=c++17, Python 3 with numpy 2.5.3. Hosts that stayed blocked: dafx.de, dafx2018.web.ua.pt, hsu-hh.de, dafx25.dii.univpm.it (papers), so no paper text was read.

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
- Three departures from the paper's scheme are visible in that code: (1) `calcG()` is `Gcalc = Aplus * Gcalc` with `Aplus = (cos(angle·delta), sin(angle·delta))`, `angle = arg(pole_corr)` (radians **per sample**) and `delta = 2*Ts_bbd` (**seconds**), so each tick rotates G by a unit-modulus factor of the order of 1e-5 to 1e-4 rad (3.8e-5 rad for 4096 stages at 300 ms) instead of setting it to `p^d`; the decay `|p|^d` is never applied and G is never reset at a sample boundary. (2) `set_time(tn)` (the only place G is set absolutely, `gCoef * pow(pole_corr, tn)` with `tn` in seconds, i.e. ≈ `gCoef`) is called only from `setInputFilterFreq/setOutputFilterFreq`; the wrapper's doc comment says "@attention make sure to call `setFilterFreq()` every block". (3) The returned value sums `xOutAccum` (this sample's tick contributions) and not the output bank's state `x`, which is updated by `outputFilter->process(xOutAccum)` but never read. — [chowdsp_BBDFilterBank.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_dsp_utils/Delay/BBD/chowdsp_BBDFilterBank.h), [chowdsp_BBDDelayLine.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_dsp_utils/Delay/BBD/chowdsp_BBDDelayLine.h), [chowdsp_BBDDelayWrapper.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/master/modules/dsp/chowdsp_dsp_utils/Delay/BBD/chowdsp_BBDDelayWrapper.h)
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

## 2. HIIR half-band coefficient sets for 44.1 kHz and 96 kHz base rates, and the 48 kHz set used unchanged at 44.1 kHz

### Takeaway
For 44.1 kHz the "flat to 20 kHz, reject from 24.1 kHz" specification needs **6 coefficients for 78.2 dB, 7 for 91.1 dB or 8 for 104.1 dB**; for a 96 kHz base rate **2 coefficients give 70.9 dB and 3 give 101.7 dB** (there is no "about 80 dB" design in between). Using the existing 48 kHz five-coefficient set unchanged at 44.1 kHz is harmless in the audible band: the pass-band stays flat (−0.005 dB round trip at 20 kHz) and everything that folds below 18.4 kHz is still rejected by 80.6 dB; only fold-back into 18.4–22 kHz is weaker (54 dB at 19 kHz, 32.5 dB at 20 kHz).

### Cited Findings
- Designer used: `hiir::PolyphaseIir2Designer::compute_coefs_spec_order_tbw(coef_arr, nbr_coefs, transition)`, `compute_atten_from_order_tbw(nbr_coefs, transition)` and `compute_nbr_coefs_from_proto(attenuation, transition)` from HIIR 1.30 (readme: "Version 1.30"; licence file: "DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE Version 2, December 2004"), mirror commit 4589fedb. I compiled a 12-line driver (`hd.cpp`, `g++ -O2 -std=c++17`) against that header and ran it. [SRC for the API and licence, CALC for everything below] — [unevens/hiir PolyphaseIir2Designer.h](https://github.com/unevens/hiir/blob/master/hiir/PolyphaseIir2Designer.h), [license.txt](https://github.com/unevens/hiir/blob/master/hiir/license.txt)
- The transition bandwidth argument is the width of the transition band as a fraction of the **2× rate**, centred on a quarter of that rate. 44.1 kHz base: (24100 − 20000)/88200 = 0.046485260770975. 96 kHz base: (76000 − 20000)/192000 = 0.291666666666667. 88.2 kHz base: (68200 − 20000)/176400 = 0.273242630385488. [CALC]
- What the designer says is needed: `compute_nbr_coefs_from_proto(80, 0.046485) = 7`, `(100, 0.046485) = 8`, `(80, 0.291667) = 3`, `(100, 0.291667) = 3`. [CALC]

**Coefficients (designer output, 15 decimals), rejection, and delay.** Stop-band figures are the designer's and were confirmed by evaluating H(z) = ½(A0(z²) + z⁻¹A1(z²)) on 400 001 points (`hiir_eval.py`); pass-band ripple from 0 to 20 kHz is below 0.000001 dB for every row. "Round-trip delay" is up-sampler plus down-sampler as the HIIR pair is actually aligned (see the correction below), group delay in microseconds. [CALC]

| Base rate | n | Stop-band rejection | Coefficients (path 0 takes the even-indexed, path 1 the odd-indexed) | Round trip at 1 kHz | at 10 kHz | at 15 kHz | at 20 kHz |
|---|---|---|---|---|---|---|---|
| 44.1 kHz | 6 | 78.19 dB | 0.062824925104447, 0.223816397420371, 0.424398550207196, 0.616559435383753, 0.781885756623747, 0.927484455444490 | 52.7 µs | 71.0 µs | 111 µs | 297 µs |
| 44.1 kHz | 7 | 91.15 dB | 0.047668042515431, 0.174489415052202, 0.343093382538367, 0.516950859627934, 0.674728251071444, 0.812016321899558, 0.937005924369714 | 62.5 µs | 83.6 µs | 130 µs | 343 µs |
| 44.1 kHz | 8 | 104.10 dB | 0.037365116712056, 0.139361824799350, 0.281346011403855, 0.436261826848342, 0.584461170840528, 0.717065429699382, 0.834582043500380, 0.944304068888582 | 72.4 µs | 96.2 µs | 148 µs | 389 µs |
| 44.1 kHz | 5 (for comparison) | 65.24 dB | 0.086358766004915, 0.295263010133159, 0.532136585361510, 0.739417691942703, 0.914524957431729 | 42.9 µs | 58.3 µs | 92 µs | 251 µs |
| 96 kHz | 2 | 70.93 dB | 0.126620435698744, 0.565795715233128 | 11.0 µs | 11.6 µs | 12.5 µs | 13.9 µs |
| 96 kHz | 3 | 101.71 dB | 0.063787836824299, 0.266780962497159, 0.668548793183610 | 17.3 µs | 18.2 µs | 19.4 µs | 21.2 µs |
| 88.2 kHz | 2 | 66.92 dB | 0.131218983196992, 0.573539197251902 | 11.8 µs | 12.6 µs | 13.8 µs | 15.6 µs |
| 88.2 kHz | 3 | 96.09 dB | 0.066374826500090, 0.274208604793756, 0.675123610897147 | 18.6 µs | 19.7 µs | 21.3 µs | 23.8 µs |
| 48 kHz (existing set) | 5 | 80.63 dB | 0.061090700071086, 0.221065199762536, 0.430463831503146, 0.650964800633457, 0.876656677083713 | 45.9 µs | 58.1 µs | 81 µs | 151 µs |

- In base-rate samples the round trip at 1 kHz is 2.32 (44.1k n=6), 2.76 (n=7), 3.19 (n=8), 1.05 (96k n=2), 1.66 (96k n=3), 2.20 (48k n=5). [CALC]
- The 96 kHz sets are the same numbers the earlier notes list as the "4x<->2x" second stage for a 48 kHz base (0.291667 is the same transition fraction), so no new code path is needed: at a 96 kHz device rate the app can run its second-stage filter as the only stage. [CALC; earlier table in `saturation_character.md`]

**Correction to the earlier delay table (alignment of the HIIR pair).** In `Upsampler2xFpuTpl::process_sample` path 0 produces `out_0` (the earlier of the two output samples) and path 1 `out_1`; in `Downsampler2xFpuTpl::process_sample` `spl_0 = in_ptr[1]` (the later sample) goes to path 0 and `spl_1 = in_ptr[0]` to path 1. The decimated output is therefore taken at the odd high-rate instant, so the labelled round-trip delay is the sum of the two filters' delays **minus one high-rate sample (1/(2·fs))**. I confirmed this by simulating the exact structure sample by sample (`hiir_sim.py`: all-pass `y = a·(x − y1) + x1`, 1 kHz sine): 45.83 µs at 48 kHz with n = 5, against 56.2 µs from the transfer function alone; the difference is 10.42 µs = 1/96000 s. The earlier notes' figures (56 / 59 / 69 / 92 µs for the 48 kHz five-coefficient set, and every other row of that table) are too high by 10.4 µs for the 48↔96 kHz stage and by 5.2 µs for the 96↔192 kHz stage. [SRC for the code paths, CALC for the simulation] — [Upsampler2xFpuTpl.hpp](https://github.com/unevens/hiir/blob/master/hiir/Upsampler2xFpuTpl.hpp), [Downsampler2xFpuTpl.hpp](https://github.com/unevens/hiir/blob/master/hiir/Downsampler2xFpuTpl.hpp)

**The 48 kHz five-coefficient set run unchanged at 44.1 kHz** (2× rate 88.2 kHz; the design edges scale to a pass-band edge of 18 375 Hz and a stop-band edge of 25 725 Hz) [CALC, `hiir_eval.py`]

| Input frequency f | Round-trip gain at f | Attenuation of its image/alias partner (at 44 100 − f) by one filter |
|---|---|---|
| 10 kHz | 0.00000 dB | 81.3 dB |
| 15 kHz | 0.00000 dB | 90.7 dB |
| 18 kHz | 0.00000 dB | 81.0 dB |
| 18.375 kHz | 0.00000 dB | 80.6 dB |
| 19 kHz | −0.00004 dB | 53.9 dB |
| 20 kHz | −0.0049 dB | 32.5 dB |
| 21 kHz | −0.22 dB | 16.0 dB |
| 22.05 kHz | −6.02 dB | 3.0 dB |

- Round-trip response reaches −0.01 dB at 20.18 kHz, −0.1 dB at 20.78 kHz, −1 dB at 21.44 kHz; the single-filter attenuation reaches 60 / 70 / 80 dB at 25.31 / 25.57 / 25.72 kHz, i.e. fold-back onto frequencies below 18.79 / 18.54 / 18.38 kHz is rejected by at least those amounts; the stop band beyond 25.725 kHz stays at 80.63 dB. Round-trip delay 50.0 µs at 1 kHz and 66.3 µs at 10 kHz (2.20 samples at 1 kHz, the same count as at 48 kHz). [CALC]

### Inferences
- Because the half-band filter is power-complementary, "used at the wrong rate" never costs pass-band flatness below about 20 kHz; it only moves the band in which rejection is incomplete. With the 48 kHz set at 44.1 kHz that band is 18.4–22.05 kHz, where neither the alias products nor the loss of rejection are audible on a voice. So the app is not wrong today at 44.1 kHz; a dedicated set is a refinement, not a fix.
- If a dedicated 44.1 kHz set is added, use **n = 6** (78.2 dB, +7 µs over the current set) to keep parity with the 48 kHz stage, or **n = 8** (104 dB, 72 µs at 1 kHz, 3.2 samples) for the "about 100 dB" tier. For a 96 kHz device rate use **n = 3** (101.7 dB, 17 µs): the two-coefficient version saves almost nothing.
- Delay compensation for any dry/wet mix inside a colour stage should use the corrected figures (2.20 samples at 48 kHz for n = 5, not 2.70), and it is frequency dependent (2.2 samples at 1 kHz, 2.8 at 10 kHz), so an integer-sample dry delay can only approximately align.

### Gaps
- HIIR versions later than 1.30 were not examined (the author's site is blocked); the mirror is dated 2021.
- I did not re-run the aliasing measurements of the earlier notes with the new sets; rejection figures are filter responses, not program-material measurements.
- No f32 quantisation check of the coefficients was made (the app's precision should be confirmed; the n = 8 set has a coefficient at 0.944 and is the most sensitive).

## 3. Airwindows: Weave and the author's vocal recommendations; Channel9 at 2×; the exact ToTape6 head-bump section

### Takeaway
Weave is real and is what the earlier notes guessed: a zero-latency, memoryless-curve saturator, `sin(x·√|x|)/√|x|` on a signal clamped to ±1 and scaled by 1.27, followed by a small gain modulation from the 2nd–4th differences of the removed signal; its author calls it "the default saturation in my video-making vocal chain". For Channel9 inside a 2× oversampler, halving the slew threshold is the correct first-order compensation (trigger sensitivity and allowed step both scale with the sample period) but it is exact only below about 3 kHz and over-triggers by up to 26 % near 6–8 kHz; two further rate effects matter just as much (the Neve/API "ultrasonic" biquads switch on at 96 kHz, and ToTape6's head-bump integrator gain doubles).

### Cited Findings

**Weave (MIT; parameters A "Input" default 0.1, B "Smooth" default 0.5, C "Output" default 1.0)** [SRC] — [WeaveProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Weave/WeaveProc.cpp), [Weave.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Weave/Weave.cpp)
- Author's description: "Weave is a fancy overdrive with a good texture."; "Where Spiral scales things by the input … Weave steps back in the direction of thick and fat in a novel way: taking the square root of the control signal."; "Weave uses the derivative trick I came up with to suppress high frequencies near Nyquist, the one that isn't elliptic BLEP aliasing removal … the technique stopped brittle highs from coming forward under high gain distortion."; "Weave became the default saturation in my video-making vocal chain. It became the saturation in ConsoleX3, beating out TapeHack for that purpose … if the input drive is at 0.1 that's unity gain: this gives you ten times the gain if you want it, upwards of 18dB boost". [SRC] — [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)
- Complete per-sample algorithm as coded (one channel; the 32-bit dither at the end omitted):
```
setup per block:
  gIn  = A*10            (smoothed)        gOut = C (smoothed)
  // B only sets the speed of the control smoother ("Bezier" three-point interpolation of gIn/gOut):
  //   bezierRez = max(((1-B)*0.25)^3/(fs/44100), 0.00001) ; stepped = int(1/bezierRez) ; bezierRez = 0.99999999/stepped
state: pvA, pvB, pvC, pvD = 0
per sample:
  x = in * gIn
  dry = x
  if x != 0:
     x = clamp(x, -1, 1) * 1.27
     w = sqrt(|x|)
     s = x * w
     s = sin(s)       // coded as the odd Taylor series through s^21: 1/6, 1/120, 1/5040, 1/362880, 1/39916800, ... (true factorial reciprocals)
     x = s / w
  dvA = dry - x                      // "raw clip is position"
  dvB = pvA - dvA ; pvA = dvA        // velocity
  dvC = pvB - dvB ; pvB = dvB        // acceleration
  dvD = pvC - dvC ; pvC = dvC        // jerk
  dvE = pvD - dvD ; pvD = dvD        // snap
  x *= 1 + |dvC|*0.0618 + |dvD|*(-0.05982) + |dvE|*0.0206
  out = x * gOut
```
- No part of the audio path is sample-rate scaled (only the control smoother is). No dry/wet, no filters, no latency. [SRC] — same file
- Numbers computed from that code (`weave.py`) [CALC]: small-signal gain 1.27 (+2.08 dB) at A = 0.1; gains at input 0.25 / 0.5 / 0.75 / 1.0: 1.263 / 1.216 / 1.095 / 0.879; output ceiling 0.8787 for any |x| ≥ 1 (sin argument 1.4312 rad, below π/2, so the curve never folds over); odd harmonics only (2nd harmonic below −270 dB): 3rd harmonic −66 dB at an input of 0.25, −42 dB at 0.5, −19 dB at 1.0 (1 kHz sine, relative to full scale). The derivative term changes the fundamental by less than 0.06 dB up to an input of 1.0 and by +0.1 to +0.2 dB at an input of 2.0 (5–15 kHz at 48 kHz); its main effect is on the high harmonics of high-frequency content (e.g. 5th harmonic of a 5 kHz tone at 0.5 input: −68 dB with, −61.5 dB without).

**Which plugins the author recommends for voices (every occurrence of "vocal" in Airwindopedia.txt, 30 lines, read)** [SRC] — [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)
- Saturation: **Weave** (quote above). EQ/texture: **Silken** ("silky high frequency boosts such as you might use for lead vocals"). Ambience: **BrightAmbience2** ("this thing is bonkers at putting Star Quality Vocal Glitter on voices … use it like your lead vocals alone go into a special chamber. Might also be an inspiring thing to monitor while tracking"). De-essing: **DeBess** ("for taking the most high-end of vocal tracks and de-essing only the ess sounds out of them") and **Slew4** ("With the right kind of vocal track this is a de-esser all by itself"). Thickening: **Doublelay** ("use it to thicken vocals and things"). Reverb: **kStation** ("modeled after David Bowie's vocal reverb"). Others mention voices in passing (ResEQ2 presence peak "almost never in the same place for different instruments or vocalists"; RetroBass "hot harmonic-rich zones that make some old vocals sound so intense"; VoiceTrick is a monitoring utility; LeadAmp's "vocal tone" refers to guitar).
- **Silken is not usable in the live dry path**: it is a sparse windowed-sinc FIR (window up to 998 taps, `window = min(C²·256·(fs/44100) + 2, 998)`) whose dry signal is deliberately taken "from the middle of firBuffer … because it's an FIR filter that is phase linear by nature", plus a ClipOnly-style one-44.1k-sample delay ("Latency is however many samples equals one 44.1k sample"); the description says "It's a phase-linear filter, so it has pre-echo and it has latency. Silken does not compensate for this latency". [SRC] — [SilkenProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Silken/SilkenProc.cpp), [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)

**BrightAmbience2 (MIT; A "Start" 0.2, B "Length" 0.2, C "Feedbck" 0.0, D "Dry/Wet" 0.5) — a wet-path effect, so latency is irrelevant** [SRC] — [BrightAmbience2Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/BrightAmbience2/BrightAmbience2Proc.cpp), [BrightAmbience2.h](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/BrightAmbience2/BrightAmbience2.h)
```
tables: primeL[489], primeR[489]  (tap delays in samples; left = "super-primes", right = the neighbouring primes;
        primeL[0..5] = 5,5,13,17,37,41 ... primeL[20] = 373 ... primeL[39] = 1031 ... last = 32749; primeR[0..5] = 3,7,11,19,31,43 ... last = 32719)
start  = int(A^2*480) + 1 ; length = int(B^2*480) + 1 ; if start + length > 488: start = 488 - length
fbAmt  = 1 - (1 - C)^2
buffers pL[32768], pR[32768] (float), write index counts down
per sample:
  pL[w] = inL + sin(fbA)/sqrt(length+1) * fbAmt
  pR[w] = inR + sin(fbB)/sqrt(length+1) * fbAmt
  tL = Σ_{k=start}^{start+length-1} pL[w + primeL[k]]        (indices wrapped at 32768)
  tR = Σ_{k=start}^{start+length-1} pR[w + primeR[k]]
  wetL = tL/sqrt(length) ; wetR = tR/sqrt(length)
  fbA = fbA*(1-fbAmt) + wetR*fbAmt ; fbB = fbB*(1-fbAmt) + wetL*fbAmt      // cross-channel feedback
  out = wet*D + dry*(1-D)
```
- At the defaults start = 20 and length = 20, so the 20 taps run from primeL[20] = 373 to primeL[39] = 1031 samples (8.5–23.4 ms at 44.1 kHz; 7.8–21.5 ms at 48 kHz). The tap table is not sample-rate scaled in the code. Cost: `length` buffer reads per channel per sample (20 at default, up to 481). Author: the table took "hours of looking up and typing in specific prime numbers … It's MIT license so you only have to shout me out". [SRC for code and quote, CALC for the times] — same files, [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/master/Airwindopedia.txt)

**Channel9 when run at twice the sample rate — derived from the code** [SRC for every code line, CALC for the numbers (`ch9.py` and an inline numpy script)] — [Channel9Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Channel9/Channel9Proc.cpp), [Channel9.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Channel9/Channel9.cpp)
- The author does not scale the threshold: `double localthreshold = threshold; //we've learned not to try and adjust threshold for sample rate` (Channel8 has the same line; Channel4 has `localthreshold = threshold / overallscale`). So a native 96 kHz session of Channel9 clamps far less than a 48 kHz one; that is the author's shipped behaviour, not an oversight to "fix" unless the 48 kHz sound is the target. — [Channel4Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Channel4/Channel4Proc.cpp), [Channel8Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Channel8/Channel8Proc.cpp)
- What the clamp computes when it is not limiting (then lastA, lastB, lastC are simply the three previous samples): `clamp[n] = x[n] − 1.618034·x[n−1] + x[n−2] − 0.381966·x[n−3]` (coefficients sum to zero). For a slowly varying signal with slope s′ this is `0.764·s′/fs`. When `|clamp| > thr` the output is set to `previous (smoothed) sample ± thr`, so the largest step per sample is thr, i.e. a slew limit of `thr·fs` full-scale units per second: Neve 0.33362176 → 14 713 /s at 44.1 kHz, 16 014 /s at 48 kHz, 32 028 /s at 96 kHz unscaled, 16 014 /s at 96 kHz with thr/2.
- Both the trigger sensitivity for smooth signals and the allowed step are proportional to 1/fs, so **dividing the threshold by the oversampling factor restores the base-rate behaviour to first order**. It is not exact because the four-tap detector is not an ideal differentiator. Ratio of detector sensitivity "96 kHz with thr/2" to "48 kHz native" (2·|D(f/96k)|/|D(f/48k)|): 1.008 at 1 kHz, 1.032 at 2 kHz, 1.073 at 3 kHz, 1.129 at 4 kHz, 1.197 at 5 kHz, 1.262 at 6 kHz, 1.257 at 8 kHz, 0.987 at 10 kHz, 0.701 at 12 kHz, 0.474 at 15 kHz. Amplitude of a post-saturation sine at which the Neve clamp starts: native 48 kHz 1.22 / 0.85 / 0.62 / 0.42 / 0.16 at 3 / 5 / 8 / 10 / 15 kHz; at 96 kHz with thr/2 1.14 / 0.71 / 0.49 / 0.43 / 0.33; at 96 kHz unscaled 2.28 / 1.43 / 0.98 / 0.85 / 0.66 (i.e. it hardly ever engages on a voice).
- Simulated whole plugin, Neve voicing, Drive 0.5, 0.9-amplitude sine (fundamental level): 5 kHz: −1.95 dB native 48 kHz, −0.69 dB at 96 kHz unscaled (no clamping), −1.31 dB at 96 kHz with thr/2; 8 kHz: −2.40 / −1.45 / −2.10 dB. With a 0.5-amplitude 8 kHz sine the native 48 kHz plugin does not clamp at all (−4.21 dB) while 96 kHz with thr/2 does (−5.48 dB, clamping on 67 % of samples) — the over-trigger region predicted by the ratio table.
- Second rate effect: the two "ultrasonic" biquads are bypassed whenever `cutoff/fs ≥ 0.49999` (`if (biquadA[0] < 0.49999)`). At 44.1 and 48 kHz that removes them for Neve (28 811 Hz) and API (27 216 Hz) (and for SSL at 44.1 kHz); at 88.2/96 kHz they are active. At 96 kHz the Neve pair measures: pre-filter (Q 1.618) +0.43 / +1.08 / +2.26 dB at 10 / 15 / 20 kHz, post-filter (Q 0.618) −0.18 / −0.48 / −1.10 dB, net +0.26 / +0.61 / +1.16 dB; API net +0.32 / +0.74 / +1.38 dB; SSL net +0.54 / +1.21 / +1.68 dB (SSL at 48 kHz native: +0.01 / +0.04 / +0.25 dB).
- Third: `localiirAmount = iirAmount / overallscale` is already rate-compensated, so the dielectric high-pass needs `overallscale = (2·fs)/44100` and nothing else.

**ToTape6 head-bump section, exactly as coded** [SRC] — [ToTape6Proc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/ToTape6/ToTape6Proc.cpp), [ToTape6.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/ToTape6/ToTape6.cpp)
```
os = fs/44100
HeadBumpControl = C * 0.25 * inputgain        (C default 0.5; inputgain = 10^((A-0.5)*24/20), 1.0 at default)
HeadBumpFreq    = 0.12 / os
band-pass (two copies A and B, each with its own two state words s1, s2):
   f = 0.007/os ; Q = 0.0009 ; K = tan(pi*f) ; norm = 1/(1 + K/Q + K*K)
   b0 = K/Q*norm ; b1 = 0 (never assigned; array zero-initialised) ; b2 = -b0
   a1 = 2*(K*K - 1)*norm ; a2 = (1 - K/Q + K*K)*norm
state: hA, hB (integrators), flip (bool, toggled every sample; A is updated when flip is true, B when false)
per sample, with x = the input after the input-gain cut and the flutter delay, BEFORE the main sin/band-pass/asin path:
   on A's turn (and identically for B on the other samples):
      hA += x * 0.05
      hA -= hA*hA*hA * HeadBumpFreq
      hA  = sin(hA)
      t   = hA*b0 + s1A ;  s1A = hA*b1 - t*a1 + s2A ;  s2A = hA*b2 - t*a2          // transposed direct form II
      hA  = asin(clamp(t, -1, 1))
   ... main path produces y (sin -> band-pass C/D -> asin, input gain boost, Soften) ...
   suppress = (1 - |y|) * 0.00013
   if hA >  suppress: hA -= suppress ;  if hA < -suppress: hA += suppress        // both A and B, every sample
   if hB >  suppress: hB -= suppress ;  if hB < -suppress: hB += suppress
   y += (hA + hB) * HeadBumpControl                                              // then clamp ±1 and the Mojo curve
```
- What the constants amount to [CALC, `tt6.py`]: at 44.1 kHz the "band-pass" has b0 = 0.960671, b2 = −0.960671, a1 = −0.078581, a2 = −0.921343, i.e. zeros at z = ±1 and **real** poles at z = 0.99996 and z = −0.92138. Each copy runs on every other sample, so its centre is 0.007 × 22 050 = 154 Hz with Q 0.0009: it is in effect a DC blocker (corner about 0.14 Hz) plus a zero at its own Nyquist, not a resonator. The frequency shaping comes from the integrator (`h += 0.05·x`, a −6 dB/octave slope), bounded by `sin`, the cubic leak and the constant-rate "suppress" pull.
- Measured effect of the section alone (sum of input and bump, C = 0.5, unity input gain, 44.1 kHz): at an input amplitude of 0.1: +5.5 dB at 30 Hz, +4.2 dB at 50 Hz, +2.1 dB at 80 Hz, +1.3 dB at 100 Hz, +0.6 dB at 150 Hz, +0.4 dB at 200 Hz, +0.1 dB at 400 Hz; at 0.5: +2.4 / +2.2 / +2.0 / +1.7 / +1.1 / +0.7 / +0.1 dB at the same frequencies (it compresses); at 0.01: +8.6 / +3.7 / +2.0 / +1.6 / +1.0 / +0.8 / +0.4 dB. So it is a level-dependent low shelf that starts around 200–400 Hz, not a narrow bump.
- Sample-rate scaling in the code: the band-pass frequency and the cubic leak are divided by `os`; the integrator increment `0.05` and the suppress constant `0.00013` are **not**. Run as coded at 96 kHz the bump is about 6.6 dB stronger (bump component at 100 Hz, amplitude 0.1: −1.0 dB re input at 96 kHz against −7.0 dB at 44.1 kHz; summed level +4.2 dB against +1.3 dB). Dividing both the increment and the suppress constant by `os` reproduces the 44.1 kHz result at 96 kHz within about 0.1 dB at 80 Hz and above for 0.1–0.5 input (e.g. 100 Hz: +1.39 dB against +1.31 dB at 0.1; +1.79 against +1.73 dB at 0.5).

### Inferences
- **Weave is the one new colour worth adding**: about 15 lines, no state beyond four doubles, no latency, odd-harmonic and self-limiting (ceiling 0.879), and it is what the author uses on voice. Inside the app's 2× stage the static curve ports unchanged; the derivative term was tuned at base rates and is negligible below clipping, so it can be kept as coded or dropped. Compensate the +2.08 dB small-signal gain in the "amount" mapping.
- BrightAmbience2 is a candidate "vocal glitter" early-reflection type for the reverb section (20 prime taps, 8–23 ms); the prime tables must be copied with attribution (MIT) and should be scaled by fs/44100 and re-snapped to primes for 48/96 kHz, as with the other Airwindows tables.
- For the app's Channel9 "Neve" stage inside the 2× oversampler there are two defensible targets and the code should pick one explicitly: (a) "Channel9 as it sounds at 48 kHz": threshold ÷ 2, **and bypass the two ultrasonic biquads** (they are bypassed at 48 kHz native), `overallscale = 96000/44100` for the high-pass; accept up to ~2 dB earlier clamping around 5–8 kHz, or move the slew clamp to after the down-sampler (base rate, original threshold) for an exact match; (b) "Channel9 at 96 kHz": threshold unchanged, biquads active (+1.2 dB at 20 kHz), clamp almost inactive. Halving the threshold while leaving the biquads on mixes the two.
- To add the head bump to the simplified ToTape6 port: either run it at the base rate outside the oversampler exactly as coded, or inside the 2× stage with `0.05/os`, `0.12/os`, `0.00013/os`, `f = 0.007/os`. Two interleaved copies are required (they are summed, so dropping one halves the effect). At the default it adds roughly +1 to +2 dB at 80–100 Hz on a voice-level signal, which mostly matters for chest resonance and proximity-effect lows; the author's caution ("be cautious about pushing the head bump beyond its default halfway setting", earlier notes) fits the +8 dB it produces at 30 Hz on quiet material.

### Gaps
- airwindows.com (videos/blog) is blocked, so "recommended for vocals" rests on Airwindopedia.txt only; ConsoleX3 (which embeds Weave) was not read.
- The Weave derivative term's audible effect was not evaluated on programme material; my figures are sine tests at 48 kHz.
- The head-bump simulation used the dry input in place of the main-path sample inside the `suppress` term (the main path was not simulated); the complete ToTape6 was not run end to end.
- Slew4, DeBess, Doublelay and kStation belong to other sections of the study and were not re-read here.

## 4. Dimension-D-style and H3000-style widening with real numbers; a second open ducking implementation

### Takeaway
No circuit-level or measured open Dimension D model exists on GitHub; the one permissively licensed implementation that states numbers (octabam, MIT, 2026) gives **0.25 Hz (modes 1/2) and 0.5 Hz (modes 3/4), sweeps of 5→12, 5→10 and 6→9 ms, two lines on one triangle LFO in antiphase, each output = dry + the other side's wet inverted through a high-pass**, and says outright that its mix amounts are its own. For the H3000 only parameter ranges and preset descriptions are open, not the MicroPitchShift preset values. A second ducking implementation was found and read (Odin 2, GPL-3.0-or-later): like Cocoa Delay it ducks the wet output only, with a symmetric ~10 ms follower.

### Cited Findings

**Dimension D**
- octabam `modules/modulation` "DIM" mode (MIT, "Copyright (c) 2026 Sam Banks"): "DIM (SDD-320 service notes + measurements, Synthbuilder, Fractal): two lines on one triangle LFO in ANTIPHASE (motionless: the mean delay is constant); 0.25 Hz (modes 1/2) / 0.5 Hz (3/4); sweep 5→12, 5→10, 6→9 ms; each output = bass-boosted dry + a little same-side wet + the OTHER side's wet through a HPF, inverted; mode 4 raises same-side. The mix and HPF constants are unpublished." [SRC — text of that README; the hardware figures are that author's reading of sources I could not open] — [octabam modules/modulation/README.md](https://github.com/sambanks/octabam/blob/main/modules/modulation/README.md), [octabam LICENSE](https://github.com/sambanks/octabam/blob/main/LICENSE)
- Its reference model, exactly: `wet_L = bl*fixed_L + bd*dry_L + ff*LPo(tap_L) + kc*HP(LPo(tap_R)) + kb*LPb(dry_L)`, line input `LPi(dry_L) + fb*tap_L`, right side mirrored; for DIM `bl 0, bd 1, ff 0.25, kc -1, kb 0.5`, all multiplied by 0.39811 (−8 dB), with the comment "(OURS: the SDD-320's same-side / cross / bass-lift amounts are unpublished; the HP and the lift's LP are one-poles at 200 Hz)"; `C200 = 1 − exp(−2π·200/44100)`; tap delay `centre + depth·tri(phase + ch·width)` with width = half a cycle (antiphase) for DIM; output `dry + m·(wet − dry)`. Its third-party table lists the source as "Roland SDD-320 Dimension D service notes + published measurements | laws only" and adds "the mix amounts were voiced here, not taken from the notes". The same README states "Not found anywhere permissive: a Uni-Vibe, a Dimension D clone". [SRC] — [modulation_ref.py](https://github.com/sambanks/octabam/blob/main/modules/modulation/modulation_ref.py), [THIRD_PARTY.md](https://github.com/sambanks/octabam/blob/main/THIRD_PARTY.md)
- Two other small projects that call themselves "dimension" are not hardware models: N5SS-CHORUS (MIT) uses invented preset tables (mode 1: two sine LFOs 0.28/0.31 Hz, depths 1.8/1.5 ms, base delays 20.0/21.5 ms, cross-feedback 0.08/0.06; mode 4: 0.65/0.72 Hz, 6.0/5.5 ms, 26/30 ms, 0.25/0.22; output `A·0.6 + B·0.4` left and `A·0.4 + B·0.6` right) and describes itself as "inspired by vintage analog pedals"; BellyDSP's prototype (base 7.0 ms, depth up to 1.0 ms, wet = own voice minus the other side's high-passed at 300 Hz, gain 0.7071) is **AGPL-3.0** and must not be ported. [SRC] — [N5SS-CHORUS PluginProcessor.cpp](https://github.com/n5ssiva/N5SS-CHORUS/blob/main/Source/PluginProcessor.cpp), [BellyDSP prototypes/chorus.py](https://github.com/SeanSnaider/BellyDSP/blob/main/prototypes/chorus.py), [BellyDSP LICENSE](https://github.com/SeanSnaider/BellyDSP/blob/main/LICENSE)
- GitHub repository and code searches for "dimension chorus", "SDD-320", "SDD320", "Dimension D chorus LFO", "DC-2 dimension chorus MN3207" returned nothing else relevant (searches run in this session with `gh search repos` / `gh search code`). [CALC — negative result of my own searches] — [GitHub code search](https://github.com/search?q=SDD-320&type=code)

**Multi-voice chorus defaults that can stand in (Calf Multi Chorus)** [SRC] — [calf metadata.cpp](https://github.com/calf-studio-gear/calf/blob/master/src/metadata.cpp), [calf modules_mod.cpp](https://github.com/calf-studio-gear/calf/blob/master/src/modules_mod.cpp)
- Parameter table (default, min, max): Min Delay 5 ms (0.1–10), Mod Depth 6 ms (0.1–10), Mod Rate 0.1 Hz (0.01–20), Stereo Phase 180° (0–360), Voices 4 (1–8), Inter-Voice Phase 64° (0–360), Amount 0.5 (0–4), Dry Amount 0.5 (0–4), two post band-pass centres 100 Hz and 5000 Hz with Q 0.125 (0.125–8), Overlap 0.75.
- Licence wording (resolves an earlier gap): the file header of `modules_mod.cpp` says "GNU Lesser General Public License as published by the Free Software Foundation; either version 2 of the License, or (at your option) any later version", while the README says "This project is licensed under LGPL-2.1-only" and COPYING is the LGPL 2.1 text. The per-file grant is what governs that file; several headers (for example `calf/orfanidis_eq.h`, `calf/modules_pitch.h`) carry no "any later version" sentence and need checking individually before use.

**Open wideners with numbers**
- sst-effects voice `Widener` (GPL-3.0-or-later per file header): parameters Amplitude −24…+24 dB (default +6 dB), Delay 0…100 ms (default 30 ms), Source (Mid…Side) 0–100 % (default 50 %). Algorithm: `mid, side = encodeMS(L, R)`; `s = lerp(mid, side, source)`; `s_d = delay(s, delayTime)`; `side += amp·s_d`; `L, R = decodeMS(mid, side)`. The delayed copy is added only to the side signal, so the mono sum (mid) is untouched. [SRC] — [sst-effects Widener.h](https://github.com/surge-synthesizer/sst-effects/blob/main/include/sst/voice-effects/delay/Widener.h)
- Airwindows Wider (MIT; Width 0.5, Center 0.5, Dry/Wet 1.0): Density-curve gain on mid and on side (`sin(|x|·π/2)` blend for boost, `1 − cos` for cut) and a delay of at most `sin(offset)^4·20·(fs/44100)` samples (≤ about 0.45 ms) applied to mid or to side depending on which is boosted. It reshapes an existing stereo signal; on a mono voice (side = 0) it does nothing useful. [SRC] — [WiderProc.cpp](https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Wider/WiderProc.cpp)

**H3000**
- A web editor for the hardware (no licence file) lists factory preset 231 and 519 as "MICROPITCHSHIFT" ("This is the perfect effect to fatten up or widen a sound without adding any color."), on algorithms "LAYERED SHIFT" and "MULTI-SHIFT" respectively, and preset 514 "JUST STEREO" ("A very subtle, micro-pitch shift. Just enough to add a presence to an otherwise flat, mono sound."). Its parameter table for the two-voice shifter algorithm (id 116) gives ranges only: Left/Right Coarse/Fine −3600…+3600 cents, Left/Right Pitch Delay 0…675 ms, Left/Right Delay 0…700 ms, pitch and delay levels −100…+100 %, four feedback paths −100…+100 %, per-voice splice length 0…700 ms. **The preset's own values are not in the file.** [SRC] — [eventide-h3000-editor preset-data.js](https://github.com/saulclap/eventide-h3000-editor/blob/main/preset-data.js), [algorithm-parameters.js](https://github.com/saulclap/eventide-h3000-editor/blob/main/algorithm-parameters.js)
- GitHub searches for "micropitch", "H3000", "micro pitch shift widener plugin" found no open emulation. [CALC — negative search result] — [GitHub repository search](https://github.com/search?q=micropitch&type=repositories)

**Second open ducking implementation: Odin 2 delay (file header: GNU GPL "either version 3 of the License, or (at your option) any later version")** [SRC] — [odin2 Delay.h](https://github.com/TheWaveWarden/odin2/blob/master/Source/audio/FX/Delay.h), [odin2 Delay.cpp](https://github.com/TheWaveWarden/odin2/blob/master/Source/audio/FX/Delay.cpp)
- Constants: `MOVING_AVERAGE_SAMPLE_LENGTH 441 // 1/100 s at standard smaple rate`; `DUCKING_SCALE_FACTOR 5 // hardly ever will the average reach 1, so we scale it up`.
- Follower: `p = |input|; m_total_sum += p − m_last_mean; m_last_mean = m_total_sum/441; return min(1, 5·m_last_mean)` — algebraically a one-pole smoother with coefficient 1/441 per call (time constant 441 calls ≈ 10 ms at 44.1 kHz; not rescaled for other rates; the same state is advanced by both the left and the right call each frame, so about 5 ms in stereo). Attack and release are identical.
- Application: `wet *= (1 − follower(dry_input)·m_ducking_amount)` after the delay's high-pass and before the wet gain; the feedback path is written to the buffer before this line and is **not** ducked. Amount is 0…1, so full ducking is reached when the smoothed |input| is 0.2 or more.
- The same code base stores a ducking amount for its reverb (`SurgeReverb::setDucking`) but never uses it, and `ZitaReverb::set_ducking` is an empty function marked "//unused?". [SRC] — [odin2 SurgeReverb.cpp](https://github.com/TheWaveWarden/odin2/blob/master/Source/audio/FX/SurgeReverb.cpp), [odin2 ZitaReverb.cpp](https://github.com/TheWaveWarden/odin2/blob/master/Source/audio/FX/ZitaReverb.cpp)

### Inferences
- A "Dimension" mode can now be built on a stated (if second-hand) parameter set instead of by ear alone: mono in; two short lines fed from the voice; one triangle LFO, the two lines in antiphase; mode table {0.25 Hz, 5–12 ms}, {0.25 Hz, 5–10 ms}, {0.5 Hz, 6–9 ms}, plus a fourth mode at 0.5 Hz with more same-side wet; left = dry + a·wet_L − b·HP(wet_R), right mirrored. The high-pass on the cross term is what keeps bass in the centre. With octabam's weights (same-side +0.25, cross −1) the side signal L − R carries 1.25·(wet_L − wet_R) above the high-pass corner while the mono sum L + R carries −0.75·(wet_L + wet_R): the effect is stronger in stereo than in mono but does **not** vanish in mono, and because the two voices are detuned in opposite directions at every instant their sum has no net pitch drift (octabam's "motionless"). The amounts a, b, the bass lift and the 200 Hz corner are tuning values, not hardware facts (octabam says so of its own 0.25 / 1 / 0.5 / 200 Hz). [arithmetic on the cited weights]
- With mono input the two antiphase lines differ only in LFO phase, so the cross-subtraction is not a no-op (as it would be for identical lines) and gives a side signal proportional to the difference of two oppositely swept delays; use the app's existing BBD-less delay core or the Holters–Parker line of section 1 with 1024 stages (the stage count the earlier notes cite for the hardware).
- For an "H3000-style" widener the only numbers remain the secondary ±9 cents (earlier notes) and now the hardware's ranges; the app's existing two-head micro-pitch shifter with ±5–10 cents and 10–30 ms unequal pre-delays remains a reasonable stand-in, but it cannot be called verified.
- For mono compatibility the sst Widener structure (add the delayed copy to the side channel only) is the safest "Haas" type: a mono voice gets L = v + g·v_d, R = v − g·v_d, and the mono sum is exactly the dry voice.
- Ducking: two independent open implementations now agree on the simple design — follower on the dry input, gain applied to the wet output only, feedback untouched. Cocoa: separate attack/release, default ≈100 ms each, amount 0–10; Odin 2: symmetric ≈10 ms, fixed ×5 sensitivity. Neither uses a ratio or threshold; a dB-domain ducker with ratio remains a design choice with no open precedent among delays read.

### Gaps
- The Roland SDD-320 service notes, and the "Synthbuilder" and "Fractal" material octabam cites, were not read (no GitHub copy found; other hosts blocked). octabam is a young single-author repository; treat its Dimension figures as secondary until checked against the service manual. Which sweep belongs to which of modes 1–3 is implied by order only.
- The H3000 MicroPitchShift preset values (cents, delays, feedback) remain unverified.
- Vital's delay styles, LSP's delay routing and Surge's chorus were not re-read here; no third ducking implementation was looked for after Odin 2.

## 5. EQ characters in ready-to-code form: Pultec EQP-1A low boost + attenuate, coupled high boost, high cut; what is actually open for a Neve-1073-style band set

### Takeaway
The three Pultec closed forms in the earlier `eq.md` are correct: I re-derived the whole passive network independently (series/parallel impedances, my own nodal analysis) and sympy confirms each closed form equals the network exactly. They can be implemented from the public passive topology and resistor/capacitor values without copying any code, which matters because **EQP-WDF-1A ships only the GPLv3 licence text with no "or any later version" statement anywhere (treat as GPL-3.0-only)**. For the 1073 nothing circuit-level is open: only EQ1979's curve-fit cascade exists (same licence situation), so a Neve-style character has to be a fitted, gain-dependent-Q design.

### Cited Findings

**Licence wording of EQP-WDF-1A** [SRC] — [EQP-WDF-1A LICENSE](https://github.com/ABSounds/EQP-WDF-1A/blob/main/LICENSE), [README.md](https://github.com/ABSounds/EQP-WDF-1A/blob/main/README.md), [EQP1A.h](https://github.com/ABSounds/EQP-WDF-1A/blob/main/Source/EQP1A.h)
- The LICENSE file is the unmodified "GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007" text. The author's own source files (`EQP1A.h`, `EQP1A.cpp`, `PluginProcessor.cpp`) carry only a creation date and "Author: alber"; neither they nor the README contain a licence statement, so there is no "either version 3 of the License, or (at your option) any later version" grant. SPDX reading: GPL-3.0-only (flag). The bundled `chowdsp_wdf.h` carries its own notices (it embeds MIT-licensed code "Copyright (C) 2019 Stefano D'Angelo").
- Provenance of the component values: "To model the EQP1A circuit, first I compiled a few schematics of the unit that can be found online, and then I setup a simulation of the circuit in LTSpice"; the repository is the result of a Master's thesis at the Music Technology Group, Universitat Pompeu Fabra ("Pultec EQP-1A Modeling with Wave Digital Filters", author Alberto Barrera). — [README.md](https://github.com/ABSounds/EQP-WDF-1A/blob/main/README.md)

**The network as wired in the repository (re-read from the adaptor tree)** [SRC] — [EQP1A.h](https://github.com/ABSounds/EQP-WDF-1A/blob/main/Source/EQP1A.h), [EQP1A.cpp](https://github.com/ABSounds/EQP-WDF-1A/blob/main/Source/EQP1A.cpp), [PluginProcessor.cpp](https://github.com/ABSounds/EQP-WDF-1A/blob/main/Source/PluginProcessor.cpp)
- An ideal voltage source drives three impedances in series: `Z1 = (1−hb)·12k + [ (L + C + Rq) ∥ hb·12k ]`, `Zp = [ (1−hc)·1k + (hc·1k ∥ C_hc) ] ∥ [ (C1 ∥ lc·110k) + R2 + R3 ]`, `ZJ = lb·8.2k ∥ C2`, with `Rq = bw·3.9k + 390`, `R2 = 1k`, `R3 = 10k`. The output is `(−voltage(J) + voltage(R3)) * 15.4882` in the code's wave-variable sign convention, i.e. physically the voltage across R3 plus the voltage across ZJ, times the make-up gain ("Makeup for the insertion loss of the filter"). A 91 Ω `R1` is declared but is not connected to any adaptor.
- Switch values: low-frequency cap `C2` = 2.2 µF (20 Hz), 1.1 µF (30 Hz), 560 nF (60 Hz), 330 nF (100 Hz, the `default:` branch); `C1 = C2/30`. High-boost resonator `C = sqrt(1/(12e6·(2π·fc)²))`, `L = 12e6·C`, fc ∈ {3000, 4000, 5000, 8000, 10000, 12000, 16000}. High-cut cap 270 nF (5 k), 135 nF (10 k), 68 nF (20 k).
- Knob mapping in the plugin: every knob value is divided by 10 to give the pot fraction; Low Boost and Low Atten use `juce::NormalisableRange<float>(0.0001f, 9.9999f, 0.0001f, 0.3f, false)` (skew 0.3) with default 0.0001; the pot is then a linear resistance `fraction × R_MAX`. The plugin runs the WDF inside JUCE oversampling (x1…x16, half-band FIR equiripple, latency reported to the host).

**Low boost + attenuate as one biquad, ready to code** [CALC — closed form from the earlier notes, confirmed here: `sympy.simplify(network − closed form) == 0` in my script `pultec.py`, for symbolic lb, lc and C2]
```
inputs: lb, lc in (0, 1]  (pot fractions; clamp both to >= 1e-4), C2 from the switch, fs
Rb = lb*8200          Rc = lc*110000          C1 = C2/30
t1 = C1*Rc            t2 = C2*Rb
n2 = 1e7*t1*t2
n1 = 1e7*(t1 + t2) + 12000*Rb*t1
n0 = 1e7 + Rb*(12000 + Rc)
d2 = 155e6*t1*t2
d1 = 155e6*(t1 + t2) + 13000*Rc*t2 + 12000*Rb*t1
d0 = 155e6 + 13000*Rc + Rb*(12000 + Rc)
H(s) = g*(n2 s^2 + n1 s + n0)/(d2 s^2 + d1 s + d0)       g = 15.4882 as in the repo (HF gain 0.9992), or 15.5 for exactly 0 dB at HF
bilinear, K = 2*fs:
  a0 = d2*K*K + d1*K + d0
  b0 = g*(n2*K*K + n1*K + n0)/a0     b1 = g*(2*n0 - 2*n2*K*K)/a0     b2 = g*(n2*K*K - n1*K + n0)/a0
  a1 = (2*d0 - 2*d2*K*K)/a0          a2 = (d2*K*K - d1*K + d0)/a0
```
- Where the constants come from: 1e7 = 1k·10k (high-cut pot total × R3); 12000 = 1k + R2 + R3; 155e6 = 12k·12k + 1k·11k; 13000 = 12k + 1k. They assume the high boost and high cut are at zero. [CALC]
- Curves this produces (analog; `pultec.py`) [CALC]: boost alone at maximum: +16.43 dB at DC, +11.96 / +13.35 / +13.27 / +13.35 dB at the nominal 20 / 30 / 60 / 100 Hz, zero at 96 / 191 / 376 / 638 Hz and pole at 14 / 29 / 57 / 96 Hz. Attenuation alone at maximum: −20.11 dB at DC, −17.1 / −18.2 / −18.1 / −18.2 dB at the nominal frequency, zero at 20 / 40 / 78 / 133 Hz and pole at 202 / 404 / 793 / 1345 Hz. Both at maximum: +15.65 dB shelf and a −6.54 dB dip at 141 / 280 / 557 / 931 Hz. Both at 0.5: +11.72 dB shelf, −5.43 dB dip at 152 / 303 / 601 / 1024 Hz. Both at 0.25: +7.52 dB shelf, −4.01 dB dip at 178 / 352 / 700 / 1193 Hz.
- Bilinear accuracy at 48 kHz against the analog curve, 10 Hz–20 kHz: worst case 0.041 dB (100 Hz switch, both pots at 0.25); 0.0005–0.015 dB for the 20/30/60 Hz positions. No pre-warping or matched design is needed. Largest pole radius 0.9981 (20 Hz switch, full boost). With either pot at exactly zero the s² terms vanish and the bilinear biquad would carry a cancelling pole/zero pair on z = −1; clamping the fractions to ≥ 1e-4 (the plugin's own minimum is 0.0001/10) avoids it. [CALC]

**High boost: an exact peaking section with separate pole and zero damping** [CALC — symbolic identity confirmed in `pultec.py` with the low section and high cut at zero]
```
inputs: hb in [0,1] (boost pot), bw in [0,1] (bandwidth pot: 0 = sharp), f0 from the switch
Rq = 390 + 3900*bw        Rh = 12000*hb        Rs = 12000*(1 - hb) + 916.667        (916.667 = 1k || 11k)
Z0 = sqrt(12e6) = 3464.10
Qz = Z0/(Rq + Rh)         Qp = Z0/(Rq + Rs*Rh/(Rs + Rh))
H(s) = (s^2 + (w0/Qz) s + w0^2)/(s^2 + (w0/Qp) s + w0^2),   w0 = 2*pi*f0
peak gain G = Qp/Qz = (Rq + Rh)/(Rq + Rs||Rh)
as a conventional peaking EQ:  A = sqrt(G),  Q_rbj = sqrt(Qp*Qz)     (so "Q = Qp, gain = G" in a Vicanek/matched peaking design)
```
| Boost pot hb | Bandwidth sharp (bw 0): gain, pole Q | mid (bw 0.5) | broad (bw 1) |
|---|---|---|---|
| 0.10 | +0.63 dB, Qp 2.34 | +0.28 dB, 1.01 | +0.18 dB, 0.64 |
| 0.25 | +2.00 dB, Qp 1.29 | +1.21 dB, 0.75 | +0.87 dB, 0.53 |
| 0.50 | +4.98 dB, Qp 0.96 | +3.53 dB, 0.62 | +2.74 dB, 0.46 |
| 0.75 | +9.57 dB, Qp 1.11 | +6.99 dB, 0.68 | +5.54 dB, 0.49 |
| 1.00 | +19.98 dB, Qp 2.79 | +13.05 dB, 1.09 | +10.02 dB, 0.67 |

(The pole Q is not monotonic in the boost pot: it falls to about 0.96 at half travel and rises again, because the pot's two halves in parallel peak in resistance mid-travel.)

**High cut: first-order** [CALC — symbolic identity confirmed in `pultec.py`]
```
hc in [0,1], C from the switch (270n / 135n / 68n):   Rx = 1000*(1 - hc) ;  tau = C*1000*hc
H(s) = 155e6*(1000 + s*tau*Rx) / (1000*(155e6 + s*tau*(132e6 + 23000*Rx)))        (unity at DC)
```
- Pole frequency at hc = 0.25 / 0.5 / 0.75 / 1.0: 2449 / 1273 / 884 / 692 Hz (5 k), 4897 / 2547 / 1769 / 1384 Hz (10 k), 9723 / 5056 / 3511 / 2748 Hz (20 k); high-frequency floor −2.2 / −5.4 / −11.0 dB / none (pure one-pole low-pass at full attenuation). [CALC]

**How well three independent sections reproduce the whole network** (product of the three one-at-a-time responses against a direct evaluation of the full 5th-order network, 10 Hz–20 kHz) [CALC, `pultec.py`]
- Low section alone, any setting: error 0.00 dB. Low boost 0.5 + high boost 0.5 at 8 kHz: 0.02 dB. Low 0.5/0.3 + high boost 0.6 at 10 kHz: 0.03 dB. Low 0.7/0.2 + high boost 0.5 at 5 kHz: 0.05 dB. Everything at maximum with the high boost at 3 kHz and the low switch at 100 Hz: 0.73 dB at 2.5 kHz.
- **High boost and high cut together do interact**: low 0.5/0.3, boost 0.6 at 10 kHz, cut 0.5 at 10 k: 0.88 dB; boost and cut both at maximum (3 kHz, 5 k cap): 15 dB error at 3.2 kHz. The cut branch changes the load the resonator works into, so the separate-sections model is only valid when the high cut is off (or small).

**Neve 1073: what is open**
- EQ1979 (repository LICENSE = GPLv3 text; the `.jsfx` header has "Author: Belles Ondes", "version: 0.96" and no licence statement, so again no "or later" grant): "Frequency accurate modeling of a Neve 1073 filter stage combined with an input gain-compensated saturation. Designed by cascading ~30 peq/butterworth filters to reproduce frequency response, bumps and drops of the original console strip." Its switch positions (from the slider definitions): mid 0.36 / 0.7 / 1.6 / 3.2 / 4.8 / 7.2 kHz, ±18 dB; low shelf 35 / 60 / 110 / 220 Hz, ±16 dB; high shelf ±16 dB; high-pass 50 / 80 / 160 / 300 Hz. It is a response fit, not a circuit model; the fitted constants are already listed in the earlier `eq.md`. [SRC] — [eq1979 readme.md](https://github.com/D4p0up/eq1979/blob/main/readme.md), [bellesondes_eq1979.jsfx](https://github.com/D4p0up/eq1979/blob/main/bellesondes_eq1979.jsfx), [LICENSE](https://github.com/D4p0up/eq1979/blob/main/LICENSE)
- GitHub repository searches for "1073 eq plugin", "neve 1073 emulation", "1073 inductor eq" returned one further emulation (`bbunny669/neve1073eq`) with **no licence file** (not usable) that uses the same nominal frequency lists (HP 50/80/160/300 Hz; mid 360/700/1600/3200/4800/7200 Hz), and a GUI wrapper for the JSFX. No schematic-derived, WDF or state-space 1073 EQ was found. [SRC for the file contents, CALC for the negative search] — [neve1073eq EQFilters.h](https://github.com/bbunny669/neve1073eq/blob/main/Source/EQFilters.h)

### Inferences
- **Can the Pultec transfer functions be derived without the code? Yes.** Everything above follows from Ohm's-law series/parallel reduction of a passive ladder whose topology is the published EQP-1A passive network and whose element values are numerical facts; I did that derivation myself and only used the repository to confirm the wiring and values. Implementing the three formulas in Rust copies no expression from the WDF code (which contains no transfer function at all — it is an adaptor tree). The one judgement call is that the particular resistor/capacitor values are that author's tuned set; values are not expression, but the report should credit the thesis. This is an engineering reading, not legal advice.
- Recommended "Pultec" character for the vocal EQ: the low biquad as given (one biquad gives boost, attenuation and the dip "about an octave higher"), the high boost as a matched peaking section with `gain = Qp/Qz, Q = Qp` and the frequency list 3/4/5/8/10/12/16 kHz, and the high cut as a first-order section used only when the high boost is off, or else evaluated jointly. A mapped taper is a free choice: the plugin's is `fraction = (knob travel)^(1/0.3)` if JUCE's skew formula is as I recall it [MEM — the NormalisableRange skew law was not re-read].
- The bandwidth/boost coupling the hardware is known for is entirely in `Qp` and `Qz`: at full boost the sharp setting gives +20 dB with pole Q 2.8 and the broad setting +10 dB with Q 0.67; at half boost the three bandwidth settings differ by only 2.2 dB. A "Pultec air" preset is therefore a broad, low-Q lift rather than a narrow bell unless the boost is near maximum.
- "Neve" character: there is still no open circuit to port. The defensible design is the app's own matched bell with EQ1979-style laws (Q rising with |gain|, the two top centres sliding down with gain, a low-Q early-starting high shelf), re-fitted by the app's authors against published response plots rather than copied from the GPL-3.0-only JSFX.

### Gaps
- The Pultec thesis and SMC paper (zenodo.org, hdl.handle.net) were not opened; the statement that the values were tuned to Sound On Sound's plots comes from the earlier notes' reading of the README.
- The real unit's transformers, tube make-up stage and inductor losses are not in this model (it is the passive network only); no hardware measurement was compared here.
- The joint high-boost + high-cut section (third order) was verified numerically only through the full-network evaluation, not reduced to a closed form.
- No measured 1073 curves were available to check EQ1979's fit; its licence has no explicit "or later" grant, so treat it as GPL-3.0-only as well.

## 6. Pitch correction: the zita-at1 retuner as shipped in x42/fat1.lv2 — exact latency, complete state, resampler licence, port plan; newer open real-time tuners (2024–2026)

### Takeaway
I compiled fat1's `retuner.cc` with its embedded resampler (against a small FFT shim) and measured it: at 48 kHz the delay is **1055.5 samples (21.99 ms) in normal mode and 159.5 samples (3.32 ms) in "fast" mode** for unvoiced or in-tune input (the plugin reports 1056 and 160), and while a voiced note is being corrected the delay floats upward by up to one "jump" (an integer number of pitch periods of at least 128 samples): measured 3.3–4.8 ms at 220–452 Hz, 5.1–6.7 ms at 110 Hz and 6.4–12.3 ms at 82 Hz in fast mode. Everything needed for a port is about 12 500 floats of state and one 2048-point real FFT pair every 512 samples; all three source files are GPL-2.0-or-later or GPL-3.0-or-later. The only genuinely new low-latency open tuner found (Flayr Tune, October 2026) is AGPL-3.0 and cannot be ported.

### Cited Findings

**(c) Licences, including the embedded resampler (file headers read)** [SRC] — [retuner.cc](https://github.com/x42/fat1.lv2/blob/master/src/retuner.cc), [resampler.cc](https://github.com/x42/fat1.lv2/blob/master/src/resampler.cc), [resampler-table.cc](https://github.com/x42/fat1.lv2/blob/master/src/resampler-table.cc), [fat1.cc](https://github.com/x42/fat1.lv2/blob/master/src/fat1.cc)
- `retuner.cc` / `retuner.h`: "Copyright (C) 2009-2011 Fons Adriaensen … either version 2 of the License, or (at your option) any later version" → GPL-2.0-or-later.
- `resampler.h`, `resampler.cc`, `resampler-table.cc` (the embedded zita-resampler, in namespace `LV2AT`): "Copyright (C) 2006-2012 Fons Adriaensen … either version 3 of the License, or (at your option) any later version" → **GPL-3.0-or-later** (compatible; this closes the earlier gap).
- `fat1.cc`: "Copyright (C) 2016 Robin Gareus … either version 2, or (at your option) any later version" → GPL-2.0-or-later. Repository state read: commit 96b3da4 (8 September 2026).

**(a) Latency** 
- What the code sets up at 44.1/48 kHz: `_upsamp = true; _ipsize = 4096; _fftlen = 2048; _frsize = 128; _resampler.setup (1, 2, 1, 32); // 32 is medium quality.`; read pointer initialised to `_rindex1 = _ipsize / 2` (2048 up-sampled = 1024 input samples behind the write index); fast mode adds `_readahead = _ipsize * 7 / 16` (1792 up-sampled = 896 input samples) to every read index. The plugin reports `latency = 1024` (rate < 64000), `latency / 8` in fast mode, and "add 32 samples for resampler's latency". [SRC] — [retuner.cc](https://github.com/x42/fat1.lv2/blob/master/src/retuner.cc), [fat1.cc](https://github.com/x42/fat1.lv2/blob/master/src/fat1.cc)
- Measured (my harness `rt_test.cpp`: the repository's `retuner.cc`, `resampler.cc`, `resampler-table.cc` compiled unmodified with `g++ -O2` against a radix-2 FFT shim providing the five FFTW calls used; 64-sample blocks; delay from the cross-correlation of white noise and from a single impulse) [CALC]:

| Rate | Mode | Reported by fat1 | Measured, unvoiced input | In time |
|---|---|---|---|---|
| 48 kHz | normal | 1056 | 1055.5 samples (impulse splits equally between 1055 and 1056) | 21.99 ms |
| 48 kHz | fast | 160 | 159.5 samples | 3.32 ms |
| 44.1 kHz | normal | 1056 | 1055.5 samples | 23.93 ms |
| 44.1 kHz | fast | 160 | 159.5 samples | 3.62 ms |
| 96 kHz | normal | 2048 | 2047 samples | 21.32 ms |
| 96 kHz | fast | 256 | 255 samples | 2.66 ms |

  The half-sample (one up-sampled sample) below the reported figure comes from `cubic (v, a)` returning `v[1]` at `a = 0`.
- Delay while a voiced note is processed (same harness; harmonic test tone with a 3.1 Hz amplitude modulation, delay read from the phase of the envelope, four one-second readings; default-like settings Filter 0.1, Bias 0.5, Correction 1) [CALC]:

| Input | Output pitch | Normal mode | Fast mode |
|---|---|---|---|
| 220 Hz (in tune) | 220.00 Hz | 22.0–22.2 ms | 3.4–3.5 ms |
| 226 Hz | 220.01 Hz | 22.4–23.5 ms | 3.7–4.6 ms |
| 440 Hz (in tune) | 440.00 Hz | 22.0–22.1 ms | 3.3–3.5 ms |
| 452 Hz | 440.02 Hz | 22.2–23.5 ms | 3.5–4.8 ms |
| 110 Hz | 109.95 Hz | 23.9–24.3 ms | 5.1–5.3 ms |
| 113 Hz | 116.50 Hz | 24.5–25.5 ms | 5.7–6.7 ms |
| 82.41 Hz | 82.25 Hz | 26.1–29.8 ms | 7.5–12.3 ms |
| 84.5 Hz | 82.26 Hz | 25.4–26.5 ms | 6.4–8.9 ms |

- Why it floats — the jump rule, from the code: at each fragment boundary `dr = _cycle * (int)(ceilf (_frsize / _cycle))` (a whole number of pitch periods, at least one fragment), `ph = (r1 − _ipindex)/_frsize + 2 * _ratio − 10` (with r1 − _ipindex taken modulo the buffer and halved when up-sampling); unvoiced → cross-fade back to the nominal position ("reset playhead position and crossfade to avoid jitter and get a consistent output latency"); `ph > 0.5` → jump back by `dr`; `ph + dr/_frsize < 0.5` → jump forward by `dr`. Re-arranged [CALC]: with D the read delay in input samples before the read-ahead, `ph = 2(ratio − 1) + (1024 − D)/128`, so the pointer is held in `960 + 256(ratio − 1) ≤ D ≤ 960 + 256(ratio − 1) + J`, J = the jump length. Total latency is therefore between 992 and 992 + J samples in normal mode and between **96 and 96 + J samples in fast mode** (2.0 ms to 2.0 ms + J at 48 kHz, plus what it drifts within one fragment); J is one period for notes below 375 Hz (218 samples at 220 Hz, 436 at 110 Hz, 582 at 82.4 Hz) and two or more periods above. A signal that needs no correction (ratio exactly 1) does not drift and stays wherever the pointer is, which is why the in-tune rows sit at the nominal value. — [retuner.cc](https://github.com/x42/fat1.lv2/blob/master/src/retuner.cc)
- The "Prefeed some input samples to remove delay" block in the constructor sets `out_count = 0` before calling `_resampler.process ()`, and `Resampler::process` is one `while (out_count)` loop, so the pre-feed consumes nothing: the first 64 input samples after construction are absorbed before any output is produced (130 of the first 256 buffer slots are written, the rest stay zero once), and the steady-state delay of the up-sampler is the 32 input samples the plugin adds. [SRC for both code facts; consistent with the measured 1055.5] — [retuner.cc](https://github.com/x42/fat1.lv2/blob/master/src/retuner.cc), [resampler.cc](https://github.com/x42/fat1.lv2/blob/master/src/resampler.cc)

**(b) Complete state for a faithful port (44.1/48 kHz configuration)** [SRC] — [retuner.h](https://github.com/x42/fat1.lv2/blob/master/src/retuner.h), [retuner.cc](https://github.com/x42/fat1.lv2/blob/master/src/retuner.cc), [resampler.cc](https://github.com/x42/fat1.lv2/blob/master/src/resampler.cc), [resampler-table.cc](https://github.com/x42/fat1.lv2/blob/master/src/resampler-table.cc)
- Buffers: `_ipbuff[_ipsize + 3]` = 4099 floats (circular, at 2× rate; the 3 extra slots mirror the first three samples "for interpolation"); `_xffunc[128]` = `0.5*(1 − cos(π·i/128))` ("half of raised cosine"); `_fftTwind[2048]` = `0.5*(1 − cos(2π·i/2048))`; `_fftWcorr[2048]` = autocorrelation of that window (FFT → |X|² → inverse FFT), divided by its lag-0 value; `_fftTdata[2048]`; `_fftFdata[1025]` complex. FFTs: one real forward and one real inverse transform of length 2048 per pitch estimate (plus one pair at construction).
- Scalars: `_ipindex` (write index), `_frindex` (position in fragment), `_frcount` (0–3; estimate when it reaches 4), `_rindex1`, `_rindex2` (float read indices), `_xfade`, `_cycle` (period in input samples; reset to `_frsize` when unvoiced), `_error` (octaves), `_ratio`, `_count` (failed estimates), `_lastnote`, `_voiced`, `_readahead`, `_lastreadahead`, `_notebits`; settings `_refpitch`, `_notebias` (= v/13), `_corrfilt` (= 4·_frsize/(v·fs)), `_corrgain`, `_corroffs`, `_notemask`, `_notescale[12]`, `_fastmode`; limits `_ifmin = fs/1200`, `_ifmax = fs/60` (integer division).
- Up-sampler: `setup (1, 2, 1, 32)` → `frel = 1.0 − 2.6/hlen = 0.91875`, two phases, 32 coefficients per half (64 input samples per output); table entry `fr·sinc(t·fr)·wind(t/hl)` with `wind(x) = 0.384 + 0.500·cos(πx) + 0.116·cos(2πx)`, table size `hl·(np + 1)` = 96 floats; history buffer `2·hl − 1 + 250` = 313 floats.
- Output sample: 4-point cubic `(1 + 1.5c)(v1·b + v2·a) − 0.5c(v0·b + v1 + v2 + v3·a)`, `b = 1 − a`, `c = a·b`, read index advancing by `2·_ratio` per output sample. Cross-fades (jump, return to nominal when unvoiced, and switching the read-ahead on or off) all last exactly one fragment (128 samples = 2.67 ms at 48 kHz) and use `_xffunc`.
- Detector details that were not in the earlier notes: the analysis reads `_fftlen` samples starting at the write index with stride 2 (so the window is the whole 4096-sample buffer, i.e. the last 2048 input samples, centred 1024 samples back — exactly the normal-mode read position); the `−45 dBFS` RMS gate (`rms < _fftlen * 0.000031623f`) is compiled only when `MOD` is defined; the power spectrum is divided by `1 + (i·fs/(fftlen·3000))²`; normalisation `t = r[0] + 0.1f`.
- Total memory about 4099 + 128 + 3·2048 + 2·1025 + 96 + 313 ≈ 12 830 floats (51 kB); nothing is allocated after construction.

**CPU** [CALC] — my timing of the unmodified sources with the (slow, double-precision, radix-2) FFT shim, 64-sample blocks, one 2.1 GHz Xeon VM core: 254 ns per sample at 48 kHz (1.2 % of one core), 334 ns at 44.1 kHz, 225 ns at 96 kHz. A proper real FFT will lower this; the 64-tap up-sampler (32 multiplies per up-sampled sample) is the other main cost.

**Newer open real-time tuners, 2024–2026 (GitHub repository searches for "autotune", "auto-tune plugin", "pitch correction", "pitch-correction", "autotalent", "retuner" run in this session; licences read in each clone)**
- **Flayr Tune** (FlayrLabs, last commit 15 October 2026): "Flayr Tune is licensed under the GNU AGPLv3" → **AGPL-3.0, do not port**. Its description: Studio mode "TD-PSOLA … It has 57 ms of latency"; "LIVE is for recording and performing through the plug-in. Latency is about 1.5 ms on high notes up to about 10 ms on a low male voice"; live mode is "A pitch-synchronous delay-line shifter that splices whole periods, with no look-ahead", "It predicts the current pitch across the analysis gap, and sizes its analysis window from the voice it is tracking", "Formants come from an LPC split: the flat residual is shifted, then the spectral envelope is re-applied"; detection "YIN, computed with FFT cross-correlation". Its engine reports `liveMinDelay = liveFadeLen + 8` with `liveFadeLen = max(16, round(0.0012·sr))` and keeps "the live read head between liveMinDelay and one period above it". [SRC] — [flayr-tune README.md](https://github.com/FlayrLabs/flayr-tune/blob/main/README.md), [TuneEngine.h](https://github.com/FlayrLabs/flayr-tune/blob/main/Source/TuneEngine.h), [LICENSE](https://github.com/FlayrLabs/flayr-tune/blob/main/LICENSE)
- **OpenTune** (bemtorres, MIT, February 2026): advertised as "zero-latency"; the code is a normalised autocorrelation over a 2048-sample buffer (70–800 Hz, accept if correlation ≥ 0.6) and a single linearly interpolated read pointer in a 65 536-sample ring whose distance to the write pointer is nudged by ±2 samples when it leaves a window — no period-synchronous splice and no cross-fade. Compatible licence, but not a quality reference. [SRC] — [opentune PluginProcessor.cpp](https://github.com/bemtorres/opentune/blob/main/Source/PluginProcessor.cpp), [LICENSE](https://github.com/bemtorres/opentune/blob/main/LICENSE)
- **PytoTune** (MIT, March 2026): YIN on 4096-sample windows with stride 1024 and "a Fourier-transform-based" shifter; its README says "The project is primarily designed for **offline processing**, not real-time use". [SRC] — [PytoTune README.md](https://github.com/brokkoli71/PytoTune/blob/main/README.md)
- **MXTune-reborn** (GPLv3 LICENSE file; August 2026) and its parent MXTune (last push June 2024): "core pitch detection and correction algorithm, based on Tom Baran's Autotalent and TalentedHack" — the Autotalent family already covered (2047-sample latency). **kushview reTuner** ("Licensed under the GPL-3.0-or-later license", January 2026) is a Rubber Band pitch shifter, not a tuner. Two more recent hits have no licence at all (Sol_Voice_Tuner, AutoTuneRack). [SRC] — [MXTune-reborn README.md](https://github.com/alexander-shch/MXTune-reborn/blob/main/README.md), [kushview/retuner README.md](https://github.com/kushview/retuner/blob/main/README.md)

### Inferences
- **(d) Port plan (Rust, no per-sample allocation):**
  1. One struct holding the buffers listed above as fixed arrays; a real-FFT plan of 2048 created at start-up (for example the `realfft`/`rustfft` crates named in the earlier notes) with its scratch buffer pre-allocated.
  2. Up-sampler: either port the 96-coefficient windowed-sinc table (formula above; adds 32 samples) or reuse the app's existing 2× HIIR half-band from section 2. The analysis uses only every second up-sampled sample and only its power spectrum, which an all-pass path does not change, so the detector is unaffected by a minimum-phase interpolator; that would cut the fixed latency by roughly 31 samples (fast mode about 129 samples, 2.7 ms at 48 kHz). This substitution is my proposal and is untested.
  3. Per call: split into runs that end on the 128-sample fragment boundary; write the up-sampled input (and refresh the three mirror samples); render with the cubic reader in one of the four cases (plain, cross-fade between two read indices, read-ahead only, cross-fade between read-ahead on and off).
  4. At each fragment end: every fourth fragment run `findcycle` (window → FFT → weighted power → inverse FFT → normalise by `t·Wcorr` → skip the initial down-slope in steps of 4 → best local maximum above 0.8 between `_ifmin` and `_ifmax` → parabolic refinement) and `finderror` (nearest enabled note with bias, one-pole smoothing or jump on note change), then `_ratio = 2^(offset/12 − error·gain)`; apply the jump rule; latch the read-ahead.
  5. Acceptance tests taken from the measurements above: an impulse must come out at 1055.5 samples (normal) and 159.5 (fast) at 48 kHz; a 226 Hz test tone must come out at 220.0 Hz; unvoiced noise must return to the nominal delay within one fragment.
  6. Add the optional RMS gate from the MOD build (−45 dBFS) so room noise does not trigger corrections, and drive the 12-bit note mask from the song key.
- Fast mode is the only configuration that fits a monitoring path, and its honest specification is "3.3 ms when idle or in tune, 2 ms plus up to one pitch period while correcting" (up to about 14 ms on a low E at 82 Hz), with the pitch decision itself still based on a window centred about 19–30 ms in the past (earlier notes). The dry path must be muted while it is on.
- Flayr Tune's stated live-mode figures (1.5 ms to about 10 ms) and its "between the minimum delay and one period above it" rule are the same mechanism as zita's jump logic with a smaller floor (about 1.4 ms instead of 2.0–3.3 ms); it confirms that roughly "a couple of milliseconds plus one period" is the practical limit for splice-based live tuners, but its code is AGPL and offers nothing that can be reused. No GPL-compatible project from 2024–2026 improves on the zita/fat1 retuner.

### Gaps
- Upstream zita-at1 (kokkinizita) was still not readable; all statements are about fat1's copy. Whether upstream has the same ineffective pre-feed was not checked.
- My delay-under-correction figures come from the phase of a 3.1 Hz envelope over 1-second windows (resolution roughly ±0.3 ms, and they average over the saw-tooth drift); the bounds derived from the jump rule are the firmer statement. Real sung input, vibrato and note transitions were not tested.
- CPU was measured with a deliberately simple FFT; no FFTW or rustfft timing was taken.
- Searches were limited to GitHub; GitLab, SourceHut and forum announcements were not searched (hosts blocked or out of scope), so "no compatible newer tuner exists" is a statement about what GitHub's repository search returned.

