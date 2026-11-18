# Open-source vocal dynamics — completion notes (de-essers, gates/expanders, zero-latency limiting, auto-level, open compressor points, licence check, recommended design) — 18 Nov 2026

**Evidence tags used throughout**

- `[SRC]` = repository cloned in this session and the cited file read; constants and formulas are copied from that file.
- `[WEB]` = page fetched and read in this session.
- `[SEC]` = secondary: only a search-engine summary of the page was seen (the page itself was not reachable from this sandbox). Treat numbers as "reported".
- `[DERIVED]` = my own arithmetic or reasoning from `[SRC]` facts; not stated by any source.
- Commits read: airwindows 143a86df, calf a1b72e1, lsp-dsp-units b7a2475, zam-plugins 7ebdb5a, safety-limiter 91b13d9, stmlib d18def8, faustlibraries 1afe09a, Squeezer 632f2bb, chowdsp_utils e97b826 (others are named where used).
- Network limits this session: `www.soundonsound.com` did not resolve (ENOTFOUND) for page fetches, so SOS statements are `[SEC]` unless the earlier notes already verified them.
- These notes do NOT repeat the earlier file `research_notes/Open source vocal plugin DSP/dynamics.md` (gain computer, CTAGDRC, Squeezer, chowdsp, Faust, LSP/Calf compressors, darc, Pressure4/Pop2/ButterComp2/curve, hardware facts, make-up laws, time-constant conventions, ripple control).

---

## 1. De-essers at source level; which design is most transparent; one recommended algorithm

### Takeaway
(Section being written — see "Cited Findings" below; takeaway and recommendation are completed at the end of the file.)

### Cited Findings

#### 1.1 Airwindows DeEss (MIT) — complete per-sample algorithm `[SRC]`
Source: [DeEssProc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/DeEss/DeEssProc.cpp), defaults in [DeEss.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/DeEss/DeEss.cpp).

- Controls: A "Intense" (default 0.0), B "Max DS" (default 0.5, shown as −48…0 dB), C "Freq" (default 0.5).
- Per block: `overallscale = fs/44100`; `intensity = A^5 · (8192/overallscale)`; `maxdess = 1 / 10^((B−1)·48/20)` (B = 0.5 → 24 dB maximum ducking ratio, i.e. `maxdess = 15.85`); `iirAmount = C² / overallscale`.
- Per sample (one channel shown; state `s1,s2,s3` = last three inputs):
  1. `s3 = s2; s2 = s1; s1 = x`
  2. `m1 = (s1−s2)·((s1−s2)/1.3)`; `m2 = (s2−s3)·((s1−s2)/1.3)` — i.e. the squared newest slew, and the product of the two newest slews, both divided by 1.3.
  3. `sense = |(m1−m2)·((m1−m2)/1.3)|` — comment: "this will be 0 for smooth, high for SSS". Since `m1−m2 = (d1/1.3)·(d1−d2)` with `d1,d2` the two most recent first differences, `sense = d1²·(d1−d2)²/1.3³`: slew squared × second-difference squared (4th power of amplitude) `[DERIVED from the code]`.
  4. `attackspeed = 7 + sense·1024` — "does not vary with intensity, but it does react to onset transients".
  5. `sense = 1 + intensity²·sense; if sense > intensity: sense = intensity` — "this will be 1 for smooth, 'intensity' for SSS".
  6. `recovery = 1 + 0.01/sense` — "this will be 1.1 for smooth, 1.0000000...1 for SSS" (the comment says 1.1; the arithmetic gives 1.01 at sense = 1).
  7. `offset = 1 − |x|`
  8. Two independent cells A/B are updated on alternate samples (`flip`). In the active cell:
     - `iir = iir·(1 − offset·iirAmount) + x·(offset·iirAmount)` (a one-pole low-pass of the input whose coefficient shrinks as |x| approaches full scale)
     - `if ratio < sense: ratio = (ratio·attackspeed + sense)/(attackspeed + 1)` else `ratio = 1 + (ratio − 1)/recovery`
     - `if ratio > maxdess: ratio = maxdess`
     - `y = iir + (x − iir)/ratio`
  9. `flip = !flip`
- So the action is a **dynamic high-shelf cut**: the part of the signal above the one-pole low-pass (`x − iir`) is divided by `ratio`, the low-passed part passes unchanged. No band-pass detector, no threshold in dB, no look-ahead, zero latency.
- Sample-rate handling: only `intensity` (÷ overallscale) and `iirAmount` (÷ overallscale) are scaled. The detector itself is a product of first and second differences, which fall roughly as 1/fs and 1/fs² for a fixed waveform, so `sense` falls roughly as fs⁻⁶ while `intensity²` only compensates fs⁻² `[DERIVED]`. The attack (`7 + sense·1024` samples) and the recovery divisor are per-sample constants with no rate scaling `[SRC]`.
- The trigger is level-dependent (4th power of signal amplitude): the same "ess" 6 dB quieter gives 1/16 of the `sense` value `[DERIVED]`. The author's instruction is to set it by ear: "just crank up the effect so you can plainly hear where it hits and use that (don't overtrigger …)" `[SRC]` — [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/HEAD/Airwindopedia.txt).
- Author's description of the method: "works by tracking slew rates, not by filtering and frequencies. It keeps a string of recent slew rates, and if it sees high slews that keep going back and forth (flipping direction) that's how it triggers. It doesn't trigger on things like square wave or sawtooth waves, because those aren't going back and forth fast enough to be an ess" `[SRC]` — same file.

#### 1.2 Airwindows DeBess (MIT) — complete per-sample algorithm `[SRC]`
Source: [DeBessProc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/DeBess/DeBessProc.cpp), defaults in [DeBess.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/DeBess/DeBess.cpp).

- Controls: A "Intense" (0.0), B "Sharp" (0.5), C "Depth" (0.5), D "Filter" (0.5), E "Sense" monitor switch (0.0).
- Per block: `intensity = A^5·(8192/overallscale)`; `sharpness = B·40` (minimum 2; an integer count of samples in the comparison window, so 20 at default); `speed = 0.1/sharpness`; `depth = 1/(C + 0.0001)` (maximum ratio: C = 0.5 → 2.0, i.e. about 6 dB; C → 0 → 10000); `iirAmount = D` (not scaled by sample rate).
- Per sample:
  1. shift the input into a history `s[1..sharpness]`.
  2. `m[1] = (s1−s2)·((s1−s2)/1.3)`; for x = sharpness−1 … 2: `m[x] = (s[x]−s[x+1])·((s[x−1]−s[x])/1.3)` ("slews of slews").
  3. `sense = |m[1]−m[2]|·sharpness²`; then for every x: `mult = |m[x]−m[x+1]|·sharpness²; if mult < 1: sense *= mult` — the detector is a **product over the whole window**, so it stays high only if every adjacent pair of slew-products in the window keeps changing (sustained hiss), and collapses if any stretch of the window is smooth.
  4. `sense = 1 + intensity²·sense`, clamped to `intensity`.
  5. Active cell (alternating A/B): `iir = iir·(1−iirAmount) + x·iirAmount`; `ratio = ratio·(1−speed) + sense·speed` (a symmetric one-pole, no separate attack/release); `ratio = min(ratio, depth)`; `if ratio > 1: y = iir + (x − iir)/ratio`.
  6. If the "Sense" monitor is on, output `x − y` (what is being removed).
- Code quirk worth knowing before porting: in the B cell the condition tests the A cell's ratio (`if (ratioAL > 1.0) inputSampleL = iirSampleBL+((inputSampleL-iirSampleBL)/ratioBL);`) — lines 82–83 and 184–185 of the file `[SRC]`.
- Author's own limits `[SRC]` — [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/HEAD/Airwindopedia.txt): "If you are recording on prosumer equipment or using moving-coil microphones, you might not get enough change between samples to engage DeBess. Same if you're using high sample rates and your mics do NOT extend right up as far as the sampling lets you: DeBess is not for taking stage mics and making them lisp. It is very distinctly for taking the most high-end of vocal tracks"; and "If you're using high sample rate and struggling to get DeBess action … try brightening BEFORE DeBess". DeEss itself: "some folks had trouble getting it to engage".

#### 1.3 Calf Deesser (LGPL-2.0-or-later; "DEESSER by Markus Schmidt") `[SRC]`
Source: [modules_comp.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/modules_comp.cpp) (`deesser_audio_module`, `gain_reduction_audio_module`), parameters in [metadata.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/metadata.cpp), knee helper in [primitives.h](https://github.com/calf-studio-gear/calf/blob/HEAD/src/calf/primitives.h).

- Filters (all RBJ biquads, `q = 0.707`):
  - `hp`: high-pass at `f1·(1 − 0.17)` with gain `f1_level` ("Split" default 6000 Hz → 4980 Hz; "Gain" default 1 = 0 dB).
  - `lp`: low-pass at `f1·(1 + 0.17)` (default 7020 Hz).
  - `p`: peaking EQ at `f2` ("Peak" default 4500 Hz), Q `f2_q` (default 1), gain `f2_level` (default 4 = +12 dB).
- Side-chain (both modes): `SC = p( hp( in ) )` — 12 dB/oct high-pass followed by a +12 dB bell.
- Mode `WIDE` (the default): `compressor.process(in, &SC)` — the **whole signal** is turned down by the gain computed from the filtered side-chain.
- Mode `SPLIT`: `RC = hp(in)`; `compressor.process(RC, &SC)` (only the high band is turned down); `AC = lp(in)`; `out = AC + RC`. The two bands are 2nd-order filters at 0.83·f and 1.17·f, not a complementary (allpass-summing) crossover.
- Code quirk: in SPLIT mode the *same* biquad object `hpL` is called twice per sample (once for the side-chain, once for the audio band): `leftSC = pL.process(hpL.process(leftSC));` … `leftRC = hpL.process(leftRC);` `[SRC]`. Do not copy this structure.
- The gain-reduction object and how the de-esser drives it: `compressor.set_params(attack = laxity, release = laxity·1.33, threshold, ratio, knee = 2.8, makeup, detection, stereo_link = 0, bypass, mute = 0)`.
  - "Laxity" default 15 (range 1–100) → attack 15 ms, release 19.95 ms in Calf's own convention `coeff = min(1, 1/(t_ms·fs/4000))`, i.e. roughly τ ≈ t/4: about 3.75 ms attack τ and 5 ms release τ at the default `[DERIVED from the formula]`.
  - Detector: `a = |SC|` (average of L/R), squared when detection = RMS (the default, index 0); `linSlope += (a − linSlope)·(a > linSlope ? attack_coeff : release_coeff)`.
  - Curve (natural-log domain): if `linSlope > kneeStart` then `slope = ln(linSlope)` (×0.5 in RMS mode); `gain = (slope − thres)/ratio + thres`; inside the knee (`slope < kneeStop`) `gain = hermite(slope, kneeStart, kneeStop, kneeStart, compressedKneeStop, 1, 1/ratio)`; return `exp(gain − slope)`. Knee limits `threshold/√knee … threshold·√knee`; knee fixed at 2.8 (≈ ±4.5 dB).
  - Defaults: threshold 0.125 (−18 dBFS), ratio 3 (range 1–20 and ∞), make-up 1, detection RMS, mode Wide.
- **The threshold is absolute** (a fixed level on the filtered side-chain), not relative to the full-band level.
- An "Active" LED lights when the gain falls below 0.89 (≈ −1 dB).

#### 1.4 LSP, x42, zam-plugins, Faust: no dedicated de-esser `[SRC]`
- `lsp-dsp-units/src/main/dynamics/` contains only AutoGain, Compressor, DynamicProcessor, Expander, Gate, Limiter, SimpleAutoGain, SurgeProtector — [directory](https://github.com/lsp-plugins/lsp-dsp-units/tree/HEAD/src/main/dynamics). De-essing in LSP is done by the user with a side-chain compressor (its side-chain has an equaliser) or a multiband compressor; there is no de-esser algorithm to port.
- zam-plugins ships ZaMaximX2, ZaMultiComp(X2), ZamAutoSat, ZamChild670, ZamComp(X2), ZamDelay, ZamDynamicEQ, ZamEQ2, ZamEcho, ZamGEQ31, ZamGate(X2), ZamGrains, ZamHeadX2, ZamNoise, ZamPhono, ZamPiano, ZamSFZ, ZamSynth, ZamTube, ZamVerb — no de-esser; the nearest tool is ZamDynamicEQ — [plugins directory](https://github.com/zamaudio/zam-plugins/tree/HEAD/plugins).
- `grep -i "de-ess|deess|sibil"` over all of faustlibraries returns nothing relevant: Faust's standard library has no de-esser — [faustlibraries](https://github.com/grame-cncm/faustlibraries).

#### 1.5 Closed tools named in the brief
- Techivation T-De-Esser: the vendor page lists it as "FREE" with "No License Required"; a search found no source repository or open-source licence `[SEC]` — [techivation.com/t-de-esser](https://techivation.com/t-de-esser). Treat as closed freeware: not usable.
- digitalfishphones Spitfish: listed everywhere as freeware (32-bit VST, part of "the fish fillets"); a search found no source release or licence `[SEC]` — [KVR product page](https://www.kvraudio.com/product/spitfish_by_digitalfishphones), [plugins4free](https://plugins4free.com/plugin/537/). Treat as closed freeware: not usable.


---

## 2. Gates / expanders at source level; a breath-friendly downward expander for sung vocals

### Takeaway
(completed at the end of the file)

### Cited Findings

#### 2.1 Calf Gate (LGPL-2.0-or-later; "GATE AUDIO MODULE Damien Zammit", expander "based on Thor's compressor") `[SRC]`
Source: [modules_comp.cpp `expander_audio_module`](https://github.com/calf-studio-gear/calf/blob/HEAD/src/modules_comp.cpp), parameters in [metadata.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/metadata.cpp).

- Detector: `a = |x|` (stereo: average or maximum), squared when detection = RMS (default); `linSlope += (a − linSlope)·(a > linSlope ? attack_coeff : release_coeff)`, with `coeff = min(1, 1/(t_ms·fs/4000))`.
- Curve (natural log domain; `thres = ln(threshold)`, threshold squared in RMS mode): below `linKneeStop = threshold·√knee`: `gain = (slope − thres)·ratio + thres` (output level falls `ratio` dB per dB below threshold); inside the knee (`slope > kneeStart = ln(threshold/√knee)`) a cubic Hermite from slope `ratio` to slope 1; result `max(range, exp(gain − slope))`. Above `linKneeStop` the gain is 1.
- So it is a **downward expander with a range floor**; "infinite" ratio is coded as 1000.
- Defaults: range ("Max Gain Reduction") 0.06125 (≈ −24 dB; minimum 0.000015849 = −96 dB), threshold 0.125 (−18 dBFS), ratio 2 (1–20, ∞), attack 20 ms, release 250 ms (both 0.01–2000 ms), knee 2.828 (≈ 9 dB), detection RMS, make-up 1.
- **No hysteresis and no hold** anywhere in the object. The only chatter protection is the detector release time (250 ms default, τ ≈ 62 ms in the common convention).
- In RMS mode the ratio is applied to the log of the *squared* envelope without the 0.5 factor the compressor uses (the line `//float tratio = rms ? sqrt(ratio) : ratio;` is commented out), so the effective dB slope in RMS mode is not the same as in peak mode `[SRC, observation]`.

#### 2.2 LSP Gate (LGPL-3.0-or-later) `[SRC]`
Sources: DSP unit [Gate.cpp](https://github.com/lsp-plugins/lsp-dsp-units/blob/HEAD/src/main/dynamics/Gate.cpp); plugin defaults [lsp-plugins-gate meta/gate.h](https://github.com/lsp-plugins/lsp-plugins-gate/blob/HEAD/include/private/meta/gate.h) and mapping in [gate.cpp](https://github.com/lsp-plugins/lsp-plugins-gate/blob/HEAD/src/main/plug/gate.cpp) (commit 4b5c5b8).

- Envelope (linear domain, per sample): `d = s − e`; if `d < 0`: if the hold counter > 0 decrement it, else `e += τ_release·d; peak = e`; if `d ≥ 0`: `e += τ_attack·d; if e ≥ peak: peak = e; hold = nHold`. `τ = 1 − exp(ln(1 − 1/√2)/samples(t_ms))`; `nHold = samples(hold_ms)`.
- **Two curves = hysteresis.** Curve 0 ("open") and curve 1 ("close") each have a threshold and a "zone": `knee.start = threshold·zone`, `knee.end = threshold`. Gain is `reduction` below `start`, 1 above `end`, and a cubic Hermite in log–log space with zero slope at both ends in between.
- State switching (single-sample version): `if e < curve.start: use curve 0; else if e > curve.end: use curve 1` — i.e. the gate uses the open-curve until the envelope exceeds the open threshold, then switches to the close-curve and stays on it until the envelope drops below the close-curve's zone start.
- Plugin mapping: `hthresh = hysteresis_on ? thresh · H_THRESHOLD : thresh` (the hysteresis control is *relative* to the open threshold); separate zone for each curve.
- Plugin defaults: threshold −24 dB; hysteresis threshold −12 dB (so the close curve sits 12 dB below the open one when hysteresis is enabled); zone −6 dB; reduction −24 dB (range −72…+72 dB — a positive value makes it an upward gate); attack 20 ms; release 100 ms; hold 0 ms (0–1000 ms); side-chain reactivity 10 ms; look-ahead 0 ms (0–20 ms); side-chain high-pass/low-pass available (defaults 10 Hz / 20 kHz, i.e. off).
- LSP times are "time to 70.7 %" (see earlier notes), so 20 ms / 100 ms ≈ τ 16 ms / 81 ms `[DERIVED]`.

#### 2.3 ZamGate (GPL-2.0-or-later) `[SRC]`
Source: [ZamGatePlugin.cpp](https://github.com/zamaudio/zam-plugins/blob/HEAD/plugins/ZamGate/ZamGatePlugin.cpp), [ZamGatePlugin.hpp](https://github.com/zamaudio/zam-plugins/blob/HEAD/plugins/ZamGate/ZamGatePlugin.hpp).

- Detector: true RMS over a fixed ring buffer of `MAX_GATE = 400` samples (9.1 ms at 44.1 kHz, 8.3 ms at 48 kHz, 4.2 ms at 96 kHz — **not rate-scaled**), recomputed in full every sample (400 multiply-adds per sample).
- Side-chain switch: the detector reads input 2 instead of input 1.
- Gain state `gl` is a **linear ramp**: if `rms > threshold`: `gl += 1000/(attack_ms·fs)` (clamped to 1) else `gl −= 1000/(release_ms·fs)` (clamped to `mingate`). Output = `gl · makeup · in`.
- "Max gate close" (`gateclose`, −50…0 dB, default −50): `mingate = (gateclose == −50) ? 0 : 10^(gateclose/20)` — this is the range floor; at the default the gate closes fully.
- "Mode open/shut" inverts the logic (ducking).
- Defaults: attack 50 ms, release 100 ms (0.1–500 ms), threshold −60 dB (−60…0), make-up 0 dB.
- **No hysteresis, no hold, no ratio** — a hard gate with a linear fade; the ramp is linear in *gain*, not in dB.

#### 2.4 Faust `ef.gate_mono` (Julius O. Smith III, `LicenseRef-STK-4.3`, MIT-style) `[SRC]`
Source: [misceffects.lib](https://github.com/grame-cncm/faustlibraries/blob/HEAD/misceffects.lib).

```
gate_gain_mono(thresh,att,hold,rel,x) = x : extendedrawgate : an.amp_follower_ar(att,rel) with {
  extendedrawgate(x) = max(float(rawgatesig(x)),holdsig(x));
  rawgatesig(x) = inlevel(x) > ba.db2linear(thresh);
  minrate = min(att,rel);
  inlevel = an.amp_follower_ar(minrate,minrate);
  holdcounter(x) = (max(holdreset(x) * holdsamps,_) ~-(1));
  holdsig(x) = holdcounter(x) > 0;
  holdreset(x) = rawgatesig(x) < rawgatesig(x)'; // reset hold when raw gate falls
  holdsamps = int(hold*ma.SR);
};
```
- Level = `|x|` through a symmetric one-pole with time constant `min(att, rel)`; a binary gate signal (level > threshold); when the binary signal falls, a hold counter of `hold·fs` samples keeps it at 1; the 0/1 signal is then smoothed by an attack/release one-pole (`amp_follower_ar(att,rel) = abs : si.onePoleSwitching(att,rel)`, [analyzers.lib](https://github.com/grame-cncm/faustlibraries/blob/HEAD/analyzers.lib)).
- Documented example values: threshold −60 dB, attack 0.0001 s (0.1 ms), hold 0.1 s, release 0.020 s (20 ms).
- A full gate (gain 0…1): no range, no ratio, no hysteresis; hold only.

#### 2.5 Faust `co.peak_expansion_gain_mono_db` / `expander_N_chan` (Bart Brouns; **GPL-3.0-only — formula study only**) `[SRC]`
Source: [compressors.lib](https://github.com/grame-cncm/faustlibraries/blob/HEAD/compressors.lib).

- Level = `|x| : slidingMax(hold·SR, maxHold)` (the **hold is a sliding maximum of the rectified input**, so short dips never reach the gain computer), then either pre-smoothing `si.lag_ud(attack, release)` on the linear level, or post-smoothing of the dB gain ("turns it from a linear return-to-zero detector into a log domain return-to-range detector").
- Gain computer in dB: `(level − thresh)` below `thresh − knee/2`; `(level − thresh − knee/2)² / (−2·knee)` inside the knee; 0 above `thresh + knee/2`; times `strength`, floored at `−|range|`.
- Parameter meanings: `strength` 0 = no expansion, 100 = gating; `range` = maximum attenuation in dB; `attack` = time constant "coming out of expansion", `release` = "going into expansion".
- The library's own test call: `peak_expansion_gain_mono_db(2048, 0.5, -40, 20, 0.05, 0.01, 0.02, 6, 0)` — strength 0.5, threshold −40 dB, range 20 dB, attack 50 ms, hold 10 ms, release 20 ms, knee 6 dB.

#### 2.6 Airwindows gates (MIT) `[SRC]`
- **Gatelope** ([GatelopeProc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/Gatelope/GatelopeProc.cpp)) is a *filter* gate: `threshold = A²`; while `|x| > threshold` it opens a low-pass coefficient (`treblefreq += attackSpeed`, max 2) and closes a high-pass coefficient (`bassfreq −= 2·attackSpeed`, min 0), with `attackSpeed = slowAttack − |x|·slowAttack·0.5`, `slowAttack = (D³·3 + 0.003)/overallscale`; below threshold the two coefficients converge on each other (`treblefreq = (treblefreq − bassfreq)/trebledecay + bassfreq`, `bassfreq = (bassfreq − treblefreq)/bassdecay + treblefreq`, with `trebledecay = 1 + (1−B)²/4196/overallscale`, `bassdecay = 1 + (1−C)²/8192/overallscale`); output = `lowpass − highpass` of the input, or 0 once `treblefreq ≤ bassfreq`; then a dry/wet mix `E` (default 1) acts as the "range". Defaults A 0, B 1, C 0.5, D 0, E 1. It triggers on the **instantaneous sample** (no envelope follower), so it relies on the decaying filters to bridge zero crossings. The author built it for tom mics: "can you gate a tom mic in such a way that it rejects cymbal bleed, but lets the lows sustain longer" — [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/HEAD/Airwindopedia.txt). "Gatelinked" is only the stereo-linked AU twin (same file).
- **SoftGate** ([SoftGateProc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/SoftGate/SoftGateProc.cpp)): `threshold = A⁶`, `recovery = (B·0.5)⁶/overallscale`, `baseline = C⁶`; the gate opens to 1.1 when the **sample-to-sample difference** exceeds the threshold, otherwise decays (`gate *= 1 − recovery`) while being fed by `|x|/threshold·recovery`; when `gate < 1` the output is cross-faded toward a slew-limited copy of the signal (so it darkens before it mutes). The author: "Today's Airwindows tool is for sample makers … take the noise floor of a recording … and fade it into darkness" — Airwindopedia. Slew-triggered, so rate-dependent.
- **DustBunny** is not a gate: it zeroes samples whose float bit pattern ANDed with a mask is 0 ("unpredictable distorty noise, like dust wedged under your turntable needle") — [DustBunnyProc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/DustBunny/DustBunnyProc.cpp), Airwindopedia. Irrelevant for vocals.
- None of the three is a conventional level-envelope expander; none suits a breath-friendly vocal expander.

#### 2.7 Related: x42 darc's noise-floor hold `[SRC]` (already in the earlier notes)
- darc freezes its release while the detector is under twice the threshold power: "Retain current attenuation when the signal subceeds the threshold. This prevents modulation of the noise-floor" — [darc.lv2 lv2.c](https://github.com/x42/darc.lv2/blob/HEAD/src/lv2.c). x42 publishes no gate/expander plugin of its own that I found; its dynamics plugins are darc (compressor) and dpl (look-ahead limiter).

---

## 3. Zero-latency limiting and output protection

### Takeaway
(completed at the end of the file)

### Cited Findings

#### 3.1 nhthn/safety-limiter (Unlicense / public domain) — complete algorithm `[SRC]`
Source: [safety_limiter.hpp](https://github.com/nhthn/safety-limiter/blob/HEAD/safety_limiter.hpp), [README](https://github.com/nhthn/safety-limiter/blob/HEAD/README.md).

- State: `lastAmplitude` (float, initial 0), `holdTimer` (int, initial 0). Constants from the constructor: release time 0.1 s, hold time 0.1 s. `kRelease = 0.001^(1/(releaseTime·fs))` (or 0 if release = 0); `holdTime = int(fs·holdSeconds)`.
- Per sample (`in` = audio, `sidechain` = detector input, normally the same):
  1. `a = |sanitize(sidechain)|` (inf, NaN and denormals → 0)
  2. `if holdTimer > 0: follower = lastAmplitude; holdTimer −= 1` else `follower = lastAmplitude·kRelease + a·(1 − kRelease)`
  3. `if follower > a: amplitude = follower` else `amplitude = a; holdTimer = holdTime`
  4. `lastAmplitude = sanitize(amplitude)`
  5. `gain = amplitude > 1 ? 1/amplitude : 1`; `out = in·gain`
- Properties: instantaneous attack (the gain for the current sample is computed from the current sample), so the output can never exceed ±1 in the sample domain; fixed ceiling of 1.0 (scale in and out for another ceiling); the envelope tracks the signal at *all* levels (not only above the ceiling), so after a loud passage ends the "amplitude" stays held for 100 ms and then decays with a −60 dB time of 100 ms (τ = 14.5 ms) toward the current |x|.
- Because the hold is re-armed by every sample that exceeds the decaying follower, during sustained over-level material the gain is constant for at least 100 ms after each new maximum — this is what keeps the gain from following the waveform (low THD on steady tones).
- README claims and caveats, verbatim: "Zero latency, and therefore no lookahead"; "Strictly compresses audio to the [-1, 1] range, no matter how loud or how fast the attack"; "Completely transparent if input audio is already within [-1, 1]"; "Nearly colorless, with low THD tested on sine tones"; "DC removal should be done prior to using this plugin"; "Some pumping effects are audible if the limiter is pushed hard"; "Use 4x oversampling outside the limiter for true peak limiting".

#### 3.2 stmlib `Limiter` (Émilie Gillet, MIT) `[SRC]`
Source: [limiter.h](https://github.com/pichenettes/stmlib/blob/HEAD/dsp/limiter.h), [dsp.h](https://github.com/pichenettes/stmlib/blob/HEAD/dsp/dsp.h).

- `s = in·pre_gain; SLOPE(peak, |s|, 0.05, 0.00002); gain = peak ≤ 1 ? 1 : 1/peak; out = s·gain·0.8`, where `SLOPE(out,in,pos,neg): error = in − out; out += (error > 0 ? pos : neg)·error`. `peak` starts at 0.5.
- The attack coefficient is 0.05 per sample (τ ≈ 19.5 samples ≈ 0.41 ms at 48 kHz), **not instantaneous**, so transients overshoot; the fixed `·0.8` (−1.9 dB) output scale is the only headroom, and nothing clips afterwards in this class. Release coefficient 0.00002 per sample (τ = 50 000 samples ≈ 1.04 s at 48 kHz). Both are per-sample constants, not rate-scaled `[DERIVED from the constants]`.
- Same file family: `SoftLimit(x) = x·(27 + x²)/(27 + 9x²)` and `SoftClip(x)` = ±1 beyond |x| > 3, else `SoftLimit(x)` — a memoryless rational soft clipper that reaches exactly ±1 at x = ±3.

#### 3.3 Airwindows clippers (MIT) `[SRC]`
- **ClipOnly2** ([ClipOnly2Proc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/ClipOnly2/ClipOnly2Proc.cpp)): constants from the source comments — `refclip = 0.9549925859` (−0.2 dB), `hardness = 0.7390851332151606` ("x == cos(x)"), `softness = 0.260914866784839`; `refclip·hardness = 0.7058208`, `refclip·softness = 0.2491717`. Per sample: clamp input to ±4; if the previous sample was a clip, re-shape the *stored previous* sample (`if x < last: last = 0.7058208 + x·0.2609148 else last = 0.2491717 + last·0.7390851`); if `x > 0.9549925859`: mark clip and set `x = 0.7058208 + last·0.2609148`; (mirror for negative); then **output the stored previous sample** through a delay of `spacing = floor(fs/44100)` samples (clamped 1…16). Comment in code: "Latency is however many samples equals one 44.1k sample". So latency = 1 sample at 44.1 and 48 kHz, 2 at 88.2/96 kHz, 4 at 176.4/192 kHz. Author: "passes through ALL nonclipped samples totally untouched… it takes the sample entering clipping, and the sample exiting clipping, and it interpolates between the last unclipped sample and the clipped stuff … purely 'bypass' (plus a one sample delay to allow for the processing)" — [Airwindopedia.txt](https://github.com/airwindows/airwindows/blob/HEAD/Airwindopedia.txt).
- **ClipSoftly** ([ClipSoftlyProc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/ClipSoftly/ClipSoftlyProc.cpp)): `softSpeed = |x| < 1 ? 1 : 1/|x|`; clamp x to ±π/2; `x = sin(x)·0.9549925859`; `x = x·softSpeed + last·(1 − softSpeed)`; then the same `spacing`-sample delay as ClipOnly2 (same latency). It reshapes *every* sample (sine waveshaper), ceiling −0.2 dBFS. Author: "ClipSoftly is different: it will touch the values of ALL samples, reshaping the whole sound to make it bigger, fatter, tubier" — Airwindopedia.
- **ClipOnly (v1)** ([ClipOnlyProc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/ClipOnly/ClipOnlyProc.cpp)): same idea with `refclip = 0.9549925859`; "a one sample delay". Author on inter-sample peaks: "the clip level combined with the anti-glare prevents any 'digital reconstruction overs' in normal use" — Airwindopedia (author's claim, not a measurement).
- **ADClip7** ([ADClip7Proc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/ADClip7/ADClip7Proc.cpp), clip stage lines ~343–400 read; the rest only skimmed): adaptive clip level `refclip` that drops by 0.01 per clipped sample down to 0.9 and recovers by 0.00001 per sample up to 0.99; entry softening `x = refclip·hardness + last·softness` with `softness = B·fpNew`; the stage outputs the *current* sample (no ClipOnly-style output delay in the lines read). It is a loudness maximiser with boost/soften/enhance controls ("If you have dense, busy mixes and you want to push their loudness to the max" — Airwindopedia), not a safety stage.
- **ADClip8, ClipOnly3, FinalClip** carry the same "Latency is however many samples equals one 44.1k sample" comment (ADClip8 runs several stages in series, so several samples) — [ADClip8Proc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/ADClip8/ADClip8Proc.cpp), [ClipOnly3Proc.cpp](https://github.com/airwindows/airwindows/blob/HEAD/plugins/LinuxVST/src/ClipOnly3/ClipOnly3Proc.cpp). ADClip8/9 and ClipOnly3 were not read line by line.
- Pressure4's built-in output stage (already in the earlier notes) is a zero-latency sine clip: `y = sin(x)` for `|x| ≤ π/2`, else ±1.

#### 3.4 Limiters that are look-ahead only (not usable in the zero-latency chain) `[SRC]`
- Calf: "Lookahead Limiter by Markus Schmidt and Christian Holschuh" — the buffer is sized from the attack time (`buffer_size = srate·attack·channels`), so latency equals the attack setting; there is no zero-look-ahead mode — [audio_fx.h](https://github.com/calf-studio-gear/calf/blob/HEAD/src/calf/audio_fx.h), [audio_fx.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/audio_fx.cpp).
- LSP `Limiter`: twelve modes (`LM_HERM_*`, `LM_EXP_*`, `LM_LINE_*` × THIN/WIDE/TAIL/DUCK), all built around `fLookahead`/`nLookahead` patches applied to a delayed signal — [Limiter.h](https://github.com/lsp-plugins/lsp-dsp-units/blob/HEAD/include/lsp-plug.in/dsp-units/dynamics/Limiter.h). Not zero-latency.
- LSP `SurgeProtector` is not a limiter: it is an on/off fade (gain `sqrt(t/T)`) that mutes output when the input stays below an "off" threshold for a set time and fades in when it exceeds an "on" threshold — [SurgeProtector.cpp](https://github.com/lsp-plugins/lsp-dsp-units/blob/HEAD/src/main/dynamics/SurgeProtector.cpp).
- Faust `limiter_lad_*` (Dario Sanfilippo, GPL-3.0-only) and x42 dpl are look-ahead (earlier notes).
