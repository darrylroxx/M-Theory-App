# Open-source vocal dynamics — completion notes (de-essers, gates/expanders, zero-latency limiting, auto-level, open compressor points, licence check, recommended design) — 18 Nov 2026

**Evidence tags used throughout**

- `[SRC]` = repository cloned in this session and the cited file read; constants and formulas are copied from that file.
- `[WEB]` = page fetched and read in this session.
- `[SEC]` = secondary: only a search-engine summary of the page was seen (the page itself was not reachable from this sandbox). Treat numbers as "reported".
- `[DERIVED]` = my own arithmetic or reasoning from `[SRC]` facts; not stated by any source.
- Commits read: airwindows 143a86df, calf a1b72e1, lsp-dsp-units b7a2475, lsp-plugins-gate 4b5c5b8, lsp-plugins-autogain 89d49d4, zam-plugins 7ebdb5a, safety-limiter 91b13d9, stmlib d18def8, faustlibraries 1afe09a, Squeezer 632f2bb, chowdsp_utils e97b826, ZLCompressor 6b2b231 (AGPL, study only), master_me ea93d78, dusk-audio-plugins 3d23fa1; OBS Studio filter files and the WebRTC AGC2 files were fetched from the `master` branch of `obsproject/obs-studio` and of the `webrtc-sdk/webrtc` mirror on 18 Nov 2026.
- Network limits this session: only GitHub was reachable for page content. `soundonsound.com`, `uaudio.com`, `manualsdir.com`, `manualsonline.com`, `groupdiy.com`, `tangible-technology.com`, `eprints.hud.ac.uk` and `core.ac.uk` all failed to resolve, so everything from those hosts is `[SEC]` (search summary only) unless the earlier notes had already read the page. Web search itself worked.
- Numerical checks marked "computed" were run by me in Python/NumPy in this session on synthetic signals; they are arithmetic on the cited formulas, not measurements of any plugin and not listening tests.
- These notes do NOT repeat the earlier file `research_notes/Open source vocal plugin DSP/dynamics.md` (gain computer, CTAGDRC, Squeezer, chowdsp, Faust, LSP/Calf compressors, darc, Pressure4/Pop2/ButterComp2/curve, hardware facts, make-up laws, time-constant conventions, ripple control).

---

## 1. De-essers at source level; which design is most transparent; one recommended algorithm

### Takeaway
None of the open de-essers read is ideal as it stands: Calf's uses an absolute threshold and a split whose two bands do not sum flat (a computed −7.3 dB dip at the split point when idle), and Airwindows DeEss/DeBess trigger on products of sample differences that depend on signal level to the fourth power and on sample rate. The most transparent zero-latency design is the one the app already approximates — a Linkwitz–Riley split with a level-independent (high-band-to-full-band) detector — improved with a soft ratio law, a depth cap, a much shorter release (about 15 ms; the open code's own constants are 5–9 ms) and a voice-type frequency switch (5 / 6.5 / 8 kHz).

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
- Sample-rate handling: only `intensity` (÷ overallscale) and `iirAmount` (÷ overallscale) are scaled `[SRC]`. The detector itself is a product of first and second differences, which fall roughly as 1/fs and 1/fs² for a fixed band-limited waveform, so the raw `sense` falls roughly as fs⁻⁶ `[DERIVED]`. Dividing `intensity` by `overallscale` *lowers* both the detector gain (`intensity²`) and the ceiling of `sense` at higher rates, so it does not compensate for that fall (this corrects the earlier notes' phrase "only partly compensates"); the trigger stays comparable across rates only when the source has real energy right up to each rate's Nyquist frequency. The attack (`7 + sense·1024` samples) and the recovery divisor are per-sample constants with no rate scaling `[SRC]`. This is consistent with the author's own warning, quoted under DeBess, that it may not engage at high sample rates.
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


#### 1.6 Frequency, mode and timing facts used for the recommendation
- Calf's own defaults place the split at 6 kHz and the detector emphasis at 4.5 kHz (+12 dB, Q 1) `[SRC]` — [metadata.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/metadata.cpp).
- Carried over from the earlier report (those pages were read in the earlier session; the host did not resolve in this one): sibilance is "usually focused somewhere in a region from 4-10kHz", the side-chain is high-passed "at around 4kHz", and most de-essers are "a single band of dynamic EQ" — [SOS: vocal de-essing](https://www.soundonsound.com/techniques/techniques-vocal-de-essing); the Cubase de-esser's male/female presets sit "between 6kHz and 7kHz", and a 9.3 kHz case is documented — [SOS: Vocal Processing](https://www.soundonsound.com/techniques/vocal-processing).
- Low-authority blog summaries `[SEC]`: male voices "around 4–7 kHz", brighter female and child voices "7–10 kHz"; split-band "usually the cleaner, more transparent choice" because only the offending band is turned down, while wideband "can sound more natural for mild sibilance" — [violetrecording.com: How to use a de-esser](https://violetrecording.com/how-to-use-a-de-esser/), [unison.audio: de-essing](https://unison.audio/de-essing/). These are mixing-advice blogs, not measurements.
- "De-essing is a threshold-based effect" that stops working when the level ahead of it changes (earlier report, secondary) — [SOS Mix Rescue: Mixing Metal](https://www.soundonsound.com/techniques/mix-rescue-mixing-metal). None of the three open de-essers read here has a level-independent threshold `[SRC]` (Calf: absolute threshold; Airwindows: 4th-power level dependence).
- Time constants implied by the open code `[DERIVED from SRC, computed]`: Calf "laxity" 15 → coefficient 0.00556 (attack) and 0.00418 (release) per sample at 48 kHz = τ 3.7 ms / 5.0 ms; Airwindows DeEss recovery at ratio ≈ 1 (`recovery = 1.01`, each cell updated every second sample) ≈ 201 samples = 4.6 ms at 44.1 kHz (slower while `sense` is high, because `recovery → 1`); DeBess `speed = 0.1/20`, every second sample ≈ 399 samples = 9.0 ms at 44.1 kHz, 8.3 ms at 48 kHz, 4.2 ms at 96 kHz (a per-sample constant, not rate-scaled).
- Calf SPLIT mode is not flat when idle `[DERIVED, computed from the RBJ formulas at 48 kHz]`: the sum of a Q 0.707 high-pass at 0.83·f and a Q 0.707 low-pass at 1.17·f (f = 6 kHz) has a dip of −7.3 dB at about 5.9 kHz. (Two 2nd-order Butterworth sections at the same frequency would sum to a full notch; Calf's ±17 % offset turns the notch into a dip.) A 4th-order Linkwitz–Riley pair sums to an all-pass with flat magnitude (standard property; this is what the target app already uses).
- A subtractive "dynamic shelf" `y = x − (1 − g)·HP2(x)` (the Airwindows `iir + (x − iir)/ratio` idea with a 2nd-order Butterworth high-pass) is bit-exact when idle (g = 1) but, while reducing, shows a bump just below the corner: +0.55 dB at 3 dB of reduction, +0.97 dB at 6 dB, +1.28 dB at 9 dB, +1.51 dB at 12 dB, and does not reach full depth until well above the corner (at 15 kHz with a 6 kHz corner: −4.8 dB for a nominal 6 dB, −7.4 dB for a nominal 12 dB) `[DERIVED, computed]`.
- White noise through the app's 4th-order Linkwitz–Riley high-pass at 6.5 kHz (fs 48 kHz) has an RMS of 0.81 of the full-band RMS (−1.8 dB) `[DERIVED, computed]` — the upper bound of the "HF share" any real sibilant can approach; the app's 45 % threshold is −6.9 dB.

### Inferences

**Which design is the most transparent on voice, and why**

1. **Level-independent (relative) detection matters most.** An absolute threshold (Calf) only works at one input level: quiet esses pass, loud vowels with some HF trigger. A detector that compares high-band energy with full-band energy gives the same decision at any level, so it keeps working ahead of the compressors and regardless of the singer's distance from the microphone. No open de-esser read here does this; the target app's existing design (HF envelope vs. 45 % of the full-band envelope) already does, and should be kept.
2. **Split-band beats wideband for a solo voice.** Wideband (Calf "Wide") ducks the whole voice during an ess, which is audible as a level dip on a dry, exposed monitor signal; split-band leaves the body untouched. The price is the crossover: Calf's own split is not flat when idle (−7.3 dB dip, computed), whereas a 4th-order Linkwitz–Riley split is magnitude-flat. The remaining cost of LR4 is phase rotation around the split frequency, which changes peak shape slightly but not tone.
3. **Slew/sample-difference detection (Airwindows) is not a safe default for this app.** It is elegant and very selective on bright condenser recordings at 44.1 kHz, but it depends on signal level to the 4th power, on sample rate (the author says it may not engage at high rates or with dull microphones), and has no calibrated threshold. A live chain that must behave identically at 44.1/48/96 kHz with an unknown microphone should use band energy. DeEss's *action* (reduce only the part of the signal above a low-pass, cap the depth with "Max DS") is worth copying; its *trigger* is not.
4. **Open-code time constants are short.** Calf's default is about 4 ms attack / 5 ms release (true τ), DeEss about 4–5 ms recovery, DeBess about 8–9 ms. The app's 60 ms release is an order of magnitude longer and will hold the treble down into the vowel that follows each ess (the classic "lisp"/dulling artefact). Shorten it to about 10–20 ms.

**Recommended de-esser (zero latency, mono, any sample rate)** — synthesis; constants are either copied from the sources named or marked as design choices.

```
// ---- prepare(fs) ----
fc       : split = detector frequency. Low voice 5.0 kHz | default 6.5 kHz | high voice 8.0 kHz (range 3.5–10 kHz)
split    : 4th-order Linkwitz–Riley = two cascaded Butterworth biquads (Q = 0.7071) per branch;
           lo = LP(LP(x)), hi = HP(HP(x)); lo + hi is all-pass (flat magnitude when idle)
aDet     = exp(-1/(0.003·fs))    // 3 ms power smoothing, the SAME coefficient for both detectors  (design choice;
                                 //   Calf's default detector is RMS with τ ≈ 4–5 ms)
aAtt     = exp(-1/(0.001·fs))    // gain attack τ 1 ms   (app today: 0.8 ms; Calf ≈ 3.7 ms)
aRel     = exp(-1/(0.015·fs))    // gain release τ 15 ms (app today: 60 ms; Calf ≈ 5 ms, DeBess ≈ 8 ms)
thrDb    = -9 dB                 // relative threshold (design choice). The app today: 45 % = −6.9 dB with a hard clamp
slope    = 0.667                 // = 1 − 1/3, Calf's default ratio 3
kneeDb   = 9                     // Calf's fixed knee 2.8 (≈ ±4.5 dB)
maxRedDb = 9                     // depth cap (design choice; DeBess default cap 6 dB, DeEss default cap 24 dB)
floorDb  = -50 dBFS              // below this full-band RMS the stage does nothing (design choice; = expander threshold)

// ---- per sample ----
(lo, hi) = lr4(x)
pH = aDet·pH + (1 − aDet)·hi·hi
pF = aDet·pF + (1 − aDet)·x·x
rDb = 10·log10((pH + 1e-12)/(pF + 1e-12))          // "sibilance index", independent of input level
o   = rDb − thrDb
gr  = 0                                  if o ≤ −kneeDb/2
      slope·(o + kneeDb/2)²/(2·kneeDb)   if |o| < kneeDb/2
      slope·o                            otherwise
gr  = min(gr, maxRedDb);  if 10·log10(pF + 1e-12) < floorDb { gr = 0 }
g   = (gr > g) ? aAtt·g + (1 − aAtt)·gr : aRel·g + (1 − aRel)·gr      // dB-domain, branching
y   = lo + hi·10^(−g/20)
```

- One user control ("De-ess amount") should move `thrDb` from about −5 dB (light) to −14 dB (heavy); because the index cannot exceed about −2 dB, the depth is self-limiting: the largest possible reduction is ≈ 0.667·(−1.8 − thrDb), i.e. about 2 dB at −5 dB, 4.8 dB at −9 dB and 8 dB at −14 dB `[DERIVED]`. These mappings are design choices to be tuned by ear.
- Numerical sanity test of exactly this pseudo-code (my own Python run at 48 kHz, synthetic signals: a 150 Hz harmonic "vowel" and 4.5–11 kHz noise as the "ess", both at −20 dBFS RMS): 0.00 dB reduction on the vowel, 3.99 dB on the ess, the same 3.99 dB with the input 20 dB lower (level independence), 1.35 dB left 20 ms after the ess and 0.09 dB after 60 ms; with no ess present the output magnitude spectrum equals the input's `[DERIVED, computed; not a listening test]`.
- Use the same smoothing coefficient on both power detectors: with different time constants the ratio is biased during onsets and the stage misfires on consonant attacks `[reasoning]`.
- A "Listen" output (`hi·(1 − 10^(−g/20))`, i.e. what is being removed) follows Calf's S/C-listen switch and DeBess's "Sense" monitor.
- Sample-rate handling: every constant is a time in seconds or a frequency in Hz; recompute the biquads and the three coefficients at prepare time. At 96 kHz the high band extends to 48 kHz; if ultrasonic noise from a converter misleads the index, low-pass the *detector copy* of `hi` at 16 kHz (design choice, untested).
- **Choosing the frequency for low vs. high voices:** default 6.5 kHz (the app's current value; between Calf's 6 kHz and the 6–7 kHz Cubase presets); 5 kHz for low/dark voices (the 4–7 kHz region blogs give for male voices; Calf's detector emphasis is at 4.5 kHz); 8 kHz for high/bright voices (7–10 kHz region; the documented 9.3 kHz case). Because the detector is a high-pass share and not a narrow band-pass, the exact value is forgiving; the split should sit just *below* the ess energy so that the reduced band contains all of it. An automatic choice (measure, during frames where the index exceeds the threshold, which of 5 / 6.5 / 8 kHz gives the largest index drop per dB removed) is possible but unsourced.
- If bit-exact idle behaviour is wanted instead of LR4's all-pass phase, use the subtractive form `y = x − (1 − 10^(−g/20))·HP2(x)`; accept a bump of up to +1.3 dB below the corner at 9 dB of reduction (computed above).

### Gaps
- No readable source ranks de-esser designs on voice by listening test; the transparency ranking above is reasoning from code and from general mixing advice.
- Sound On Sound's de-essing article could not be re-opened, so no attack/release figures from it are quoted; the two blog sources for male/female frequency ranges are low-authority.
- The de-essers with relative thresholds that I know of are closed (commercial); none could be read, so the relative-threshold detector is the app's own design plus my reasoning, not a ported algorithm.
- Whether typical sung vowels stay below the −9 dB default (or the app's present −6.9 dB) high-band share with a 6.5 kHz split was not measured on real recordings; the numbers `thrDb`, `slope`, `maxRedDb`, `aDet`, `floorDb` need ear-tuning.
- T-De-Esser and Spitfish were checked only through search summaries and the vendor/aggregator listings; no licence text was opened.
- Airwindows DeBess at 96 kHz was not run; its rate behaviour is read from code only.

---

## 2. Gates / expanders at source level; a breath-friendly downward expander for sung vocals

### Takeaway
Open gates fall into three groups: soft downward expanders with a range floor (Calf "Gate", OBS expander, Brouns' Faust function), true hysteresis gates (LSP: two curves with the close threshold set relative to the open one, plus a hold counter; OBS noise gate: open −26 dB / close −32 dB, hold 200 ms) and hard on/off gates (ZamGate, Faust `gate_mono`). For sung vocals the breath-friendly choice is a 2:1 soft-knee downward expander limited to about 10 dB of range, with a 10 ms RMS detector, a few dB of hysteresis, a 100–200 ms hold and a fast-open / slow-close gain smoother.

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

#### 2.8 OBS Studio audio filters (expander and noise gate) `[SRC]`
Sources: [expander-filter.c](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/expander-filter.c), [noise-gate-filter.c](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/noise-gate-filter.c) (fetched from `master`, 18 Nov 2026). These two files carry no licence header; the repository's COPYING is GPL v2 and core files such as `libobs/obs.c` say "either version 2 of the License, or (at your option) any later version". Treat as GPL-2.0-or-later, and as a formula reference.

- **Expander**: detector = RMS with a "10 ms RMS window" coded as a one-pole on x² with `rmscoef = 2^(−100/fs)` (power halves every 10 ms, τ = 14.4 ms), or peak (`|x|`). Gain computer in dB: `diff = threshold − env_dB; gain = diff > 0 ? max(slope·diff, −60) : 0`, `slope = 1 − ratio` (so 2:1 gives −1 dB of gain per dB below threshold; hard knee; fixed floor −60 dB). Ballistics on the dB gain: `if gain > prev: g = attack_gain·prev + (1 − attack_gain)·gain else g = release_gain·prev + (1 − release_gain)·gain`, coefficients `exp(−1/(fs·t))`.
- Expander presets: "expander" = ratio 2:1, release 50 ms; "gate" = ratio 10:1, release 125 ms; both threshold −40 dB, attack 10 ms, detector RMS. Ranges: ratio 1–20, threshold −60…0 dB, attack 1–100 ms, release 1–1000 ms.
- **Noise gate** (a true hysteresis gate): `level = max(level, |x|) − decay_rate`, where `decay_rate = (open_threshold − close_threshold)/(fs/75)` (the follower falls by the open/close difference in 1/75 s = 13.3 ms); `if |x| > open && !is_open: is_open = true`; `if level < close && is_open: held_time = 0; is_open = false`; open: `att = min(1, att + 1/(attack_s·fs))`; closed: `held_time += 1/fs; if held_time > hold: att = max(0, att − 1/(release_s·fs))`; output `x·att`.
- Noise-gate defaults: open −26 dB, close −32 dB (6 dB hysteresis), attack 25 ms, hold 200 ms, release 150 ms; linear gain ramps; closes fully (no range control).

### Inferences

**What the sources agree on**
- A *soft* expander is the vocal-friendly form: Calf ships its "Gate" as a 2:1 expander with a 9 dB knee and a −24 dB range floor; OBS's "expander" preset is 2:1 with a 50 ms release; LSP's default reduction is −24 dB, not silence; Brouns' own test uses strength 0.5 with a 20 dB range. Hard gates (ZamGate, Faust `gate_mono`, OBS noise gate) close fully and are meant for drums or speech pauses.
- Chatter is prevented three ways in open code: hysteresis (LSP: a second curve, by default 12 dB lower; OBS: close threshold 6 dB below open), hold (OBS 200 ms; Faust example 100 ms; master_me's leveller brake 100 ms; LSP 0–1000 ms; Brouns: a sliding maximum of |x| over the hold time), and a slow release (Calf 250 ms; OBS 150 ms; LSP 100 ms).
- Detectors are short RMS: OBS 10 ms, ZamGate 400 samples (≈ 8–9 ms), LSP side-chain "reactivity" 10 ms, Calf RMS by default.

**Why range-limited expansion is "breath-friendly"** `[reasoning]`: a breath sits well below sung level but above the room noise. A full gate either chops breaths off (threshold above them) or passes them at full level (threshold below them), and the transition is audible on a dry voice. A 2:1 expander with a ~10 dB range turns breaths and room tone down by a fixed, modest amount, so the noise floor never drops to digital silence and the gate's opening is a 10 dB change instead of an on/off switch. With so small a range, errors in threshold placement are far less audible, which matters when the user cannot tune a gate by ear while singing.

**Recommended breath-friendly downward expander (zero latency, mono)** — synthesis; each value shows the source it leans on, or "design choice".

| Parameter | Value | Basis |
|---|---|---|
| Side-chain filter | 2nd-order high-pass, 100 Hz, Q 0.707 (detector only) | LSP gate offers side-chain HPF/LPF; keeps rumble and plosives from holding it open (design choice for the frequency) |
| Detector | power one-pole, τ 10 ms, read in dB | OBS "10 ms RMS window"; LSP reactivity 10 ms; ZamGate ≈ 8–9 ms |
| Threshold (open) | noise floor + 10 dB, clamped to −60…−35 dBFS; default −45 dBFS when no calibration | OBS default −40 dB; ZamGate −60 dB; Faust example −60 dB; master_me's unused gate −70 dB; "+10 dB above the floor" is a design choice |
| Hysteresis | close threshold 4 dB below open | OBS 6 dB; LSP 12 dB (optional). Smaller here because the knee and the range already soften the action (design choice) |
| Ratio | 2:1 (1 dB extra attenuation per dB below threshold) | Calf default, OBS expander preset |
| Knee | 9 dB | Calf default 2.83 (≈ 9 dB); Brouns' test 6 dB; master_me 12 dB |
| Range (maximum attenuation) | 10 dB (user range 0–24 dB) | Calf and LSP default 24 dB; Brouns' test 20 dB; 10 dB is the breath-friendly design choice |
| Hold | 150 ms | OBS 200 ms; Faust and master_me 100 ms |
| Attack (opening) | τ 3 ms | Faust example 0.1 ms; OBS 10 ms; LSP 20 ms; a fast open protects consonant onsets, and with a 10 dB range no click results (design choice) |
| Release (closing) | τ 150 ms | OBS gate 150 ms; LSP 100 ms; Calf 250 ms (≈ 62 ms as a true τ) |

```
// ---- prepare(fs) ----
aRms = exp(-1/(0.010·fs));  aOpen = exp(-1/(0.003·fs));  aClose = exp(-1/(0.150·fs))
holdN = round(0.150·fs);  T = thresholdDb;  H = 4;  R = 2;  W = 9;  rangeDb = 10
// ---- per sample ----
s  = hp100(x)                                   // detector copy only
p  = aRms·p + (1 − aRms)·s·s
L  = 10·log10(p + 1e-12)
// hysteresis: the threshold in force depends on the state
if !open && L > T        { open = true }
if  open && L < T − H    { open = false }
Te = open ? T − H : T
// static curve (dB of attenuation, ≥ 0), mirror image of the compressor knee
u  = Te − L                                      // how far below threshold
a  = 0                         if u ≤ −W/2
     (R − 1)·(u + W/2)²/(2·W)  if |u| < W/2
     (R − 1)·u                 otherwise
a  = min(a, rangeDb)
// hold: do not start closing until the target has asked for it for holdN samples
if a <= g { hold = holdN }  else if hold > 0 { hold −= 1; a = g }
// ballistics on the dB attenuation: opening = attenuation falling
g  = (a < g) ? aOpen·g + (1 − aOpen)·a : aClose·g + (1 − aClose)·a
y  = x·10^(−g/20)
```

- **Threshold placement relative to the noise floor:** measure the floor as the lowest 10 ms-RMS reading over about one second of "silence" at set-up (or track a slow running minimum), then put the open threshold about 10 dB above it. Quiet sung notes are normally 20 dB or more above a home-studio floor, so the knee region (±4.5 dB) stays below them. If the measured floor is above about −45 dBFS, the room or gain staging is the problem and more range will only make pumping audible; cap the threshold at −35 dBFS `[design choice]`.
- With a relative-threshold de-esser next in the chain, set its `floorDb` equal to this expander threshold so both stages agree on what "silence" is.
- Sample-rate handling: all times are seconds; `holdN` is recomputed at prepare time; no buffers are needed (the hold is a counter, not a delay line).
- Do not copy: ZamGate's 400-sample RMS loop (O(400) per sample and not rate-scaled), Calf's RMS-mode ratio (not the same dB slope as its peak mode), Brouns' function (GPL-3.0-only; its sliding-maximum hold also needs a buffer).

### Gaps
- No readable source gives numbers for breath level relative to sung level or recommends a specific range for breaths; 10 dB is a design choice. A search found only general statements (hold "prevents the gate from chattering", hysteresis lets the close point sit below the open point) on pages I could not open — [SOS: Using your DAW's gates & expanders](https://www.soundonsound.com/techniques/using-your-daws-gates-expanders) `[SEC]`.
- The OBS filter files have no per-file licence header; their "or later" status is inferred from the project's core files.
- LSP's expander unit (`Expander.cpp`) was not re-read in this session (the earlier notes cover its time-constant convention only).
- None of these designs was listened to; hold, hysteresis and attack values need ear-tuning with a real singer.

---

## 3. Zero-latency limiting and output protection

### Takeaway
Only a handful of zero-look-ahead peak controllers exist in readable open code: Nathan Ho's public-domain safety limiter (instant attack, 100 ms hold, 100 ms release, output strictly within the ceiling), the stmlib limiter (fixed per-sample slopes 0.05 / 0.00002 and a fixed 0.8 output scale), master_me's "no latency" brickwall (attack 0, release 75 ms, ceiling −1 dB) and the OBS limiter (1 ms attack, 60 ms release). Airwindows ClipOnly2, ClipSoftly, ADClip8 and ClipOnly3 each cost one 44.1 kHz-sample of delay, and the Calf and LSP limiters are look-ahead designs. For a live monitor path the recommended protection is both: a hold-and-release limiter aimed at −3 dBFS that does the sustained work, followed by a memoryless soft clip that is exactly linear below −3 dBFS and saturates at −1 dBFS.

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
- LSP `Limiter`: twelve modes (`LM_HERM_*`, `LM_EXP_*`, `LM_LINE_*` × THIN/WIDE/TAIL/DUCK), and the class is organised around a look-ahead time (`fLookahead`, `nLookahead`, `init(max_sr, max_lookahead)`); only the header was re-read in this session and no zero-look-ahead mode appears in it — [Limiter.h](https://github.com/lsp-plugins/lsp-dsp-units/blob/HEAD/include/lsp-plug.in/dsp-units/dynamics/Limiter.h). Not zero-latency.
- LSP `SurgeProtector` is not a limiter: it is an on/off fade (gain `sqrt(t/T)`) that mutes output when the input stays below an "off" threshold for a set time and fades in when it exceeds an "on" threshold — [SurgeProtector.cpp](https://github.com/lsp-plugins/lsp-dsp-units/blob/HEAD/src/main/dynamics/SurgeProtector.cpp).
- Faust `limiter_lad_*` (Dario Sanfilippo, GPL-3.0-only) and x42 dpl are look-ahead (earlier notes).

#### 3.5 Two more zero-look-ahead limiters in open code `[SRC]`
- **master_me "LIMITER NO LATENCY"** (Klaus Scheuermann; file declares `license "GPLv3"`, repository LICENSE is GPL v3; commit ea93d78): `brickwall_no_latency = co.FFcompressor_N_chan(1, threshLim, att, rel, knee, 0, link, meter, 2)` with strength 1 (limiting), `att = 0` (instant), release slider default 75 ms (5–100 ms), `knee = 0`, ceiling default −1 dB (−6…0), detector before the gain computer (`prePost = 0`: "linear return-to-zero detector") — [master_me.dsp](https://github.com/trummerschlunk/master_me/blob/HEAD/master_me.dsp). It rests on Bart Brouns' `FFcompressor_N_chan` (GPL-3.0-only), so it is a formula reference. It is the last stage of a chain made for live streaming, after a soft "RMS limiter" (`RMS_FBFFcompressor_N_chan`, strength 80 %, threshold target + 6 dB, attack 1 ms, release 40 ms, knee 8 dB, FF/FB blend 50 %). No hold.
- **OBS limiter filter**: branching one-pole on `|x|` with a *fixed 1 ms attack* (`ATK_TIME 0.001f`) and release default 60 ms (1–1000 ms), coefficients `exp(−1/(fs·t))`; `gain_dB = min(0, slope·(threshold − env_dB))` with `slope = 1`; default threshold −6 dB — [limiter-filter.c](https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/limiter-filter.c). Because the attack is 1 ms, not instant, the first millisecond of a transient overshoots the threshold; nothing clips it afterwards in this filter.
- WebRTC's AGC2 fixed-digital limiter (BSD-style licence with a patent grant; read from the `webrtc-sdk/webrtc` GitHub mirror, `master`) works on 10 ms frames split into 20 sub-frames: level estimator with "Instant attack" (`kAttackFilterConstant = 0`) and decay constant `0.9998848773724686` per sub-frame step ("computed from kDecayMs by 10 ** (-1/20 * subframe_duration / kDecayMs)", `kDecayMs = 500`), curve constants `kLimiterMaxInputLevelDbFs = 1`, `kLimiterKneeSmoothnessDb = 1`, `kLimiterCompressionRatio = 5` — [fixed_digital_level_estimator.cc](https://github.com/webrtc-sdk/webrtc/blob/master/modules/audio_processing/agc2/fixed_digital_level_estimator.cc), [agc2_testing_common.h](https://github.com/webrtc-sdk/webrtc/blob/master/modules/audio_processing/agc2/agc2_testing_common.h). It is frame-based (the whole 10 ms frame is analysed before gain is applied), so it is not a per-sample zero-latency design.

#### 3.6 Inter-sample peaks at 48 kHz
- Reported `[SEC]`: a sample-peak reading can under-read a tone at one quarter of the sample rate by up to 3 dB; ITU-R BS.1770 true-peak metering uses 4× oversampling (192 kHz for 48 kHz material) and can still under-read by up to 0.688 dB; 8× reduces that to 0.169 dB — [voxbooster.com summary citing BS.1770-5](https://voxbooster.com/blog/mastering-limiter-true-peak-inter-sample-clipping-statistics-2026/). The standard itself was not opened.
- Worst-case under-read of a full-scale sine sampled at 48 kHz, from `−20·log10(cos(π·f/fs))` `[DERIVED]`: 1 kHz 0.02 dB; 3 kHz 0.17 dB; 6 kHz 0.69 dB; 8 kHz 1.25 dB; 10 kHz 2.01 dB; 12 kHz 3.01 dB. (The 3.01 dB and 0.69 dB values match the reported figures above, which are the same formula at fs/4 and at 4× oversampling.)
- My own synthetic test at 48 kHz (band-limited noise, FFT-interpolated 8×; **computed, not from a source**): true peak above the sample ceiling after (a) hard clipping, (b) the safety-limiter algorithm, (c) a sine soft clip — for "voiced-like" noise (80 Hz–3 kHz) driven 6 dB / 12 dB over the ceiling: hard clip +0.32 / +0.68 dB, safety limiter +0.17 / +0.29 dB, sine clip +0.02 / +0.18 dB; for "ess-like" noise (5–10 kHz): hard clip +2.5 / +4.2 dB, safety limiter +1.5 / +1.5 dB, sine clip +2.0 / +3.9 dB. Unprocessed ess-like noise already reads 0.66 dB over its own sample peak.
- The safety limiter's README states the remedy: "Use 4x oversampling outside the limiter for true peak limiting" `[SRC]` — [README](https://github.com/nhthn/safety-limiter/blob/HEAD/README.md). Oversampling filters add latency (linear-phase) or phase shift (minimum-phase), so this conflicts with the zero-look-ahead constraint.

### Inferences

**What "instant attack" really does.** In the safety limiter the gain for the current sample is `1/|x|` whenever the sample exceeds the held envelope. While a signal is still rising, every new sample therefore lands exactly on the ceiling: the rising edge is hard-clipped, and only after the peak has passed does the held gain turn the rest of the note into clean gain reduction. Verified by simulation: a sine stepped 9 dB over the target shows a residual below −300 dB on the sustained part (the gain is constant), so all the distortion is in the first cycle `[DERIVED, computed]`.

**Limiter, soft clip, or both?** Both, in this order and with separated thresholds:
1. A hold-and-release limiter does the *sustained* work, so a held loud note is turned down instead of being clipped for its whole length (safety-limiter: "Nearly colorless, with low THD tested on sine tones").
2. A memoryless soft clip *after* it is the absolute ceiling and shapes the first millisecond that a zero-look-ahead limiter cannot catch gracefully. Open precedents for "dynamics stage, then clipper": Airwindows Pop2 ends in ClipOnly2 and Pressure4 in a sine clip (earlier notes); stmlib's limiter uses a 0.05-per-sample attack and leaves 0.8 (−1.9 dB) of fixed headroom; master_me puts a soft RMS limiter ahead of its instant brickwall.
3. Give the limiter a very short, non-zero attack so the transient passes into the clipper's rounded knee instead of being flat-topped by the limiter itself; set the limiter target *below* the clipper's knee so sustained material sits in the clipper's exactly-linear region.

**Recommended output protection (zero latency, mono; per sample).** Sourced values: hold and release from the safety limiter (100 ms, 100 ms to −60 dB), attack from stmlib (0.05 per sample ≈ 19.5 samples ≈ 0.4 ms at 48 kHz). The two level constants and the knee shape are design choices.

```
// ---- constants ----
C_out = 10^(−1/20) = 0.8913     // absolute ceiling −1.0 dBFS      (design choice: 1 dB for inter-sample overshoot)
T_lim = 10^(−3/20) = 0.7079     // limiter target −3.0 dBFS        (design choice: 2 dB of clipper knee above it)
aAtt  = exp(−1/(0.0004·fs))     // gain attack τ 0.4 ms            (stmlib 0.05/sample ≈ 0.41 ms at 48 kHz)
holdN = round(0.100·fs)         // hold 100 ms                     (safety-limiter default; do not go below ≈ 15 ms,
                                //                                   one period of an 80 Hz fundamental = 12.5 ms)
k     = 0.001^(1/(0.100·fs))    // release: −60 dB in 100 ms (τ = 14.5 ms)   (safety-limiter default)
// ---- state: last = 0, hold = 0, g = 1 ----
a = |x| / T_lim
if hold > 0 { f = last; hold −= 1 } else { f = last·k + a·(1 − k) }
if f > a { amp = f } else { amp = a; hold = holdN }
last = amp
target = amp > 1 ? 1/amp : 1
g = (target < g) ? aAtt·g + (1 − aAtt)·target : target       // smooth only the downward step
y = x·g
// soft clip: exactly linear below T_lim, saturating at C_out, slope-continuous at the joint
ay = |y|
if ay > T_lim { y = sign(y)·(T_lim + (C_out − T_lim)·tanh((ay − T_lim)/(C_out − T_lim))) }
if !is_finite(y) { y = 0 }                                   // safety-limiter's sanitize(): inf/NaN → 0
```

- Behaviour checked by simulation at 48 kHz (220 Hz sine stepping from −12 dBFS to +6 dBFS and back; hold set to 30 ms for the test): output never above 0.8888 (ceiling 0.8913); from 20 ms after the step the peaks sit exactly at the −3 dBFS target; the gain is back to 0 dB about 45 ms after the loud part ends (30 ms hold + ≈ 15 ms release) `[DERIVED, computed]`. With the recommended 100 ms hold the recovery takes about 115 ms.
- A DC blocker must precede the stage (safety-limiter: "DC removal should be done prior"); the chain's high-pass does this.
- Rate handling: `aAtt`, `holdN`, `k` are computed from seconds at prepare time; the clip is memoryless. Latency: 0 samples at every rate. (ClipOnly2 would add 1 sample at 44.1/48 kHz and 2 at 96 kHz for a slightly smoother clip edge; not worth breaking the zero-latency rule.)
- **Inter-sample peaks:** with the ceiling at −1 dBFS, voiced material stays under 0 dBTP by the computed margins above (≤ 0.7 dB of overshoot even when hard-clipped). Clipped or limited sibilance can overshoot by 1.5–4 dB in the synthetic test, i.e. exceed 0 dBTP — but the de-esser sits upstream and the limiter target is 3 dB down, so only a grossly overdriven ess reaches the clipper. For headphone monitoring this is acceptable; for *exported* takes, measure true peak offline (4× oversampling) and trim, because that step has no latency constraint.
- When the chain upstream is set correctly this stage should show 0 dB of reduction almost always; show its gain reduction on a meter and treat regular activity as a gain-staging error, not as a sound.

### Gaps
- The limiter-plus-knee arrangement and its constants (−3 dBFS target, −1 dBFS ceiling, tanh knee, 0.4 ms attack) are a synthesis; no open project was found that ships exactly this, and it has not been listened to.
- ADClip7's enhancement path, ADClip8/9 and ClipOnly3 were not read line by line; their latency statements come from in-code comments.
- The inter-sample figures for clipped and limited noise are my own synthetic computation; BS.1770 itself could not be opened.
- THD versus hold/release for the safety limiter is not published (README says only "low THD tested on sine tones").
- Whether the app's existing soft-clip curve is linear below its knee was not checked (the app's code was not part of this task).

---

## 4. Auto-level / leveller ahead of the chain

### Takeaway
Open auto-levellers all share four safeguards: a slow gain rate (WebRTC AGC2 3 dB/s; master_me a one-pole of roughly 5 s on the gain; LSP separate "long" and "short" speeds), a gain range limit (master_me ±20 dB; AGC2 30 dB maximum; LSP optional), a freeze below a silence or voice-activity threshold (LSP −72 LUFS; master_me a "brake" expander; AGC2 a voice detector plus a noise cap of −50 dBFS), and a fast path downward for surges. For a singer monitoring live, continuous riding is not advisable — it changes the level the performer hears in response to their own dynamics; the safer design is "measure, set a static trim, then freeze", with an optional very slow, gated, ±6 dB rider.

### Cited Findings

#### 4.1 LSP `SimpleAutoGain` and `AutoGain` (lsp-dsp-units, LGPL-3.0-or-later) `[SRC]`
- **SimpleAutoGain** — [SimpleAutoGain.cpp](https://github.com/lsp-plugins/lsp-dsp-units/blob/HEAD/src/main/dynamics/SimpleAutoGain.cpp): `ksr = (ln 10 · 0.05)/fs; kGrow = exp(grow·ksr); kFall = exp(−fall·ksr)` (grow and fall are speeds in dB per second); per sample `s = level_in·gain; if s < threshold: gain *= kGrow; else if s > threshold: gain *= kFall; gain = clamp(gain, minGain, maxGain)`. A bang-bang integrator: the gain creeps up or down at a fixed dB/s rate until the measured level equals the target. No silence handling of its own.
- **AutoGain** — [AutoGain.cpp](https://github.com/lsp-plugins/lsp-dsp-units/blob/HEAD/src/main/dynamics/AutoGain.cpp): inputs per sample are a *long-term* loudness `sl`, a *short-term* loudness `ss` and the target `le`.
  - Silence: `if ss <= fSilence: return current gain unchanged` ("Do not perform any gain adjustment if we are in silence").
  - Normal riding: `if sl·gain > le: gain *= long.kFall; else if sl·gain < le: gain *= long.kGrow` (same dB/s integrator as above).
  - Surge protection: a small compressor curve on `ss·gain/le`; if the short-term level jumps more than the "deviation" above target, a surge flag switches to the fast `short.kFall` rate until the level is back within the deviation; optional "quick amplifier" does the same upward with `short.kGrow`.
  - A second curve clamps the output so a surge cannot exceed target·deviation; optional maximum gain; when the max-gain limit is off, the make-up after a clamp recovers at the long grow rate ("Do not grow the gain rapidly, do it smoothly").
- **Plugin defaults** (lsp-plugins-autogain, commit 89d49d4) — [meta/autogain.h](https://github.com/lsp-plugins/lsp-plugins-autogain/blob/HEAD/include/private/meta/autogain.h), [autogain.cpp](https://github.com/lsp-plugins/lsp-plugins-autogain/blob/HEAD/src/main/plug/autogain.cpp): target −23 LUFS (range −60…0); weighting K by default (None/A/B/C/D/K selectable); long measuring period 400 ms (100–2000), short 20 ms (5–100); "drift" (deviation) 12 dB (0–24); silence threshold −72 LUFS (−84…−36); maximum gain 36 dB, switch off by default; look-ahead 0 ms by default (0–40 available); speeds are entered as "N dB per T ms" with N default 12 dB: long grow 12 dB/500 ms, long fall 12 dB/500 ms (24 dB/s), short grow 12 dB/40 ms, short fall 12 dB/10 ms (`calc_gain_speed` returns `numerator·0.1/time` "in dB/s").
- At 24 dB/s the LSP default is a fast loudness leveller, close to a slow compressor, not a "set and forget" rider `[DERIVED from the defaults]`.

#### 4.2 master_me leveller (Klaus Scheuermann, Faust, GPLv3; made for live streaming) `[SRC]`
Source: [master_me.dsp](https://github.com/trummerschlunk/master_me/blob/HEAD/master_me.dsp).
- Structure: a feedback loop around the whole downstream chain — the leveller reads the K-weighted loudness of the chain's *output* over a 0.4 s sliding window (`lk2_short = lk2_var(0.4)`: K pre-filter, mean square, `4.342944819·ln(·) − 0.691`).
- Gain recursion in dB: `FB(lufs, prev_gain) = (target − lufs) + prev_gain : limit(limit_neg, limit_pos) : lp1p(speed·brake)` — the loudness error is added to the previous gain (an integrator), clamped, and smoothed by a one-pole low-pass whose cut-off is `leveler_speed · brake`.
- Constants: target −18 (`init_leveler_target`), maximum boost +20 dB, maximum cut −20 dB (each 0–60), speed slider default 20 % × 0.0015 = 0.03 Hz cut-off (τ = 1/(2π·0.03) ≈ 5.3 s `[DERIVED]`), brake threshold −14 dB.
- "Brake" = a downward expander on `|l| + |r|` whose 0…1 gain multiplies the cut-off: `peak_expansion_gain_mono_db(maxHold, strength = 2, thresh = brake threshold, range = −120, attack 0.05 s, hold 0.1 s, release 0.3 s, knee 12, prePost = 1)`. When the input falls below the brake threshold the smoothing cut-off goes to zero and the gain freezes — silence is not boosted.
- The loudness window is a true sliding sum sized for 192 kHz (`ba.slidingSump(n, Tg·192000)`), i.e. a large buffer; the expander is the GPL-3.0-only Brouns function. Formula reference only.

#### 4.3 WebRTC AGC2 adaptive digital gain (BSD-style licence + patent grant; speech, 10 ms frames) `[SRC]`
Sources (GitHub mirror `webrtc-sdk/webrtc`, `master`, which may lag upstream): [agc2_common.h](https://github.com/webrtc-sdk/webrtc/blob/master/modules/audio_processing/agc2/agc2_common.h), [adaptive_digital_gain_applier.cc](https://github.com/webrtc-sdk/webrtc/blob/master/modules/audio_processing/agc2/adaptive_digital_gain_applier.cc), [audio_processing.h](https://github.com/webrtc-sdk/webrtc/blob/master/modules/audio_processing/include/audio_processing.h).
- Target: "We want to boost the signal so that peaks are at -kHeadroomDbfs" with `kHeadroomDbfs = 1`, `kMaxGainDb = 30`, `kInitialAdaptiveDigitalGainDb = 8`.
- Rate: `max_gain_change_db_per_second = 3.0` (config default), applied per 10 ms frame, both up and down.
- Gating: gain may only *increase* after `adjacent_speech_frames_threshold = 12` consecutive frames (120 ms) with voice probability ≥ `kVadConfidenceThreshold = 0.95` ("Forbid increasing the gain until enough adjacent speech frames are observed"); decreases are always allowed.
- Noise cap: `LimitGainByNoise` — the gain is capped so the estimated noise floor times the gain stays below `max_output_noise_level_dbfs = −50`.
- Level-estimate confidence: `kLevelEstimatorTimeToConfidenceMs = 400`; saturation protector with 20 dB initial and 5 dB extra headroom; if the estimate is not yet confident the gain is also capped by the limiter's envelope.
- It needs a voice-activity detector and works on 10 ms frames, so it is a source of *constants and safeguards*, not a per-sample algorithm for this app.

#### 4.4 Other tools named in the brief
- x42 darc (earlier notes): a compressor with built-in loudness-stable make-up and a hold that "prevents modulation of the noise-floor"; not a leveller.
- Squeezer's auto make-up is static (half the static reduction of a 0 dBFS peak; earlier notes) — not a leveller.
- Calf "Mono Input" is a utility, not a leveller: its controls are input/output level, balance, an `atan` soft clip (`out = atan(x·sc_level)/atan(sc_level)`), mutes, phase inverts, delay, stereo base/phase `[SRC]` — [metadata.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/metadata.cpp), [modules_tools.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/modules_tools.cpp).
- CTAGDRC's programme-dependent auto make-up carries its author's warning: "This is a time-varying effect and may introduce unwanted volume changes to the output signal" (earlier notes) — [README](https://github.com/p-hlp/CTAGDRC/blob/HEAD/README.md).
- "LUveler" (Klangfreund): `github.com/klangfreund/LUveler` asked for credentials (private or absent), so no source or licence could be read; the same author's `LUFSMeter` repository exists publicly. Not usable as a source here.
- Carried over from the earlier report: iZotope Nectar 4 places its Auto-Level module "at the start of the signal chain", and −18 dBFS is the common internal reference level — [SOS: Nectar 4 review](https://www.soundonsound.com/node/4931710), [iZotope: gain staging](https://www.izotope.com/en/learn/gain-staging-what-it-is-and-how-to-do-it.html).

### Inferences
- **Is a rider advisable in a live vocal chain?** Only in a restrained form. Three reasons, each tied to a source: (1) a time-varying gain "may introduce unwanted volume changes" (CTAGDRC) — in headphones the singer hears their quiet phrases pushed up and loud phrases pulled down and compensates, fighting the rider; (2) every open leveller needs a freeze below a silence or voice threshold, and a sung performance has long legitimate pauses and breaths at exactly the levels where such gates misfire; (3) the open defaults span 3 dB/s (AGC2, speech) to 24 dB/s (LSP), i.e. they are tuned for speech intelligibility or broadcast loudness, not for preserving musical dynamics. The compressors already do the short-term work, and they need a *stable* input level to hit their thresholds predictably.
- **Recommended design: calibrate, then freeze; optional slow rider.**
  1. *Calibration (sound-check):* while the user sings a loud phrase for a few seconds, measure gated mean-square level: one-pole power detector τ 400 ms (LSP long period; master_me 0.4 s window), counting only samples whose 10 ms RMS is above the expander threshold; set a **static** input trim so the gated RMS lands at −18 dBFS (master_me's default target; the −18 dBFS reference of the earlier report), clamp the trim to ±12 dB, and also verify that the peak stays below about −6 dBFS after trim.
  2. *During performance:* trim fixed. No riding by default.
  3. *Optional "Auto-level" switch (off by default):* a gated integrator in the LSP/master_me style —

```
// prepare: aL = exp(−1/(0.4·fs)); rate = 1.0 dB/s (design choice; AGC2 uses 3 dB/s for speech);
//          step = rate/fs (dB per sample); range = ±6 dB (design choice; master_me ±20 dB); target = −18 dBFS RMS
pL  = aL·pL + (1 − aL)·x·x                         // long-term power of the INPUT (feed-forward measure)
Lg  = 10·log10(pL + 1e-12) + gDb                   // level after the rider
active = (10 ms RMS of x) > expanderThreshold + 6 dB       // freeze in pauses, breaths and noise
if active {
    if Lg < target − 1.5 { gDb += step }           // dead band ±1.5 dB (design choice) so it rests when close
    else if Lg > target + 1.5 { gDb −= 4·step }    // fall faster than rise (LSP: short fall 4× short grow)
}
gDb = clamp(gDb, −6, +6)
y   = x·10^(gDb/20)
```
  - The freeze flag reuses the expander's detector; nothing is boosted in silence (LSP `fSilence`, master_me brake, AGC2 voice gating and noise cap all exist for this purpose).
  - Sample-rate handling: `step` and `aL` derive from seconds; no buffers.
- A target expressed in LUFS (LSP −23 LUFS, K-weighted) and one in dBFS RMS (−18) are not the same number; for a solo voice the K-weighting adds roughly the level of the presence region and the 400 ms window makes them comparable but not equal. Use plain RMS for the trim — it is what the compressor thresholds are defined against `[reasoning]`.

### Gaps
- No source studied whether performers are disturbed by gain riding in their own monitor; the advice against riding live is reasoning plus the CTAGDRC author's warning.
- LUveler could not be read. Other levellers named in forums (commercial "vocal riders") are closed.
- LSP's loudness meters (`LoudnessMeter`, K-weighting filters) were not read; only the gain logic was.
- The WebRTC mirror's `master` may be older than upstream (for example upstream's `headroom_db` and `max_gain_db` configuration fields were not present in the files read).
- The rider's rate, dead band and range are design choices without a measured basis.

---

## 5. Unresolved compressor points: LA-2A topology, 1176 release and harmonics, feedback stability, make-up constant

### Takeaway
The best-supported reading is that the LA-2A is mainly a *feedback* design with an added feed-forward share that differs between Compress and Limit (a manual reproduction says "feed-back style"; a schematic reading on a DIY forum and an open-source measured model agree; one forum builder disputes it) — no schematic could be opened. The 1176's release is programme-dependent with a fast part after transients and a slow part after sustained compression (UA manual, secondary), and an open measured model adds that the release slows as reduction deepens; its static FET harmonics are small second- and third-order terms that change sign with the amount of reduction, the audible "colour" being mostly gain ripple. A digital feedback loop with one sample of delay is stable only if `(1 − α)·(1 + L) < 2` (L = loop slope in dB per dB), which open code satisfies by reusing the feed-forward gain law inside the loop (L ≤ 1), at the price of an effective ratio of at most 2:1.

### Cited Findings

#### 5.1 LA-2A: feed-forward or feedback?
- A reproduction of an LA-2A owner's manual reportedly states: "The LA-2A is a feed-back style compressor. This is due to the fact that the signal that is used to drive the side-chain circuit is affected by the gain reduced signal", and that the side-chain signal "is first fed into the 'Peak Reduction' potentiometer (R2) … A 12AX7 is then used as a voltage amplifier" `[SEC]` — [manualsonline: LA-2A block diagram page](https://manualsonline.com/manuals/mfg/inova/la2a.html?p=13).
- A GroupDIY thread reportedly contains both views `[SEC]` — [la2a feedforward/feedback design](https://groupdiy.com/threads/la2a-feedforward-feedback-design.50129/): one poster says the block diagrams in the manuals are inaccurate, that in the schematic the side-chain is taken "from the middle of the gain reduction cell" (so it is driven by a version of the output: feedback), and that with the Limit/Compress switch open the side-chain is a linear mix of input and output — "neither 100% feedback or 100% feed-forward"; a more experienced builder disputes the feedback premise, arguing the cell samples the input. Another post notes one manual block diagram (in a current 1176 reissue manual) suggests feed-forward and another suggests feedback with some input also sent to the side-chain in Limit mode.
- An open-source measured model treats it as feedback plus an input share `[SRC]` — dusk-audio multi-comp, file header "Copyright (C) 2026 Dusk Audio, GNU GPL v3.0 or later", [MultiCompOptoCell.hpp](https://github.com/dusk-audio/dusk-audio-plugins/blob/main/plugins/multi-comp/core/MultiCompOptoCell.hpp) (commit 3d23fa1): "FEEDBACK T4 cell … Compress u = (g_cell[n-1] + b_c) * d      Limit u = (a * g_cell[n-1] + b) * d", with `d` the input, `g_cell[n−1]` the previous-sample cell gain, "divider g_cell = 1 / (1 + C) (the feedback loop taps g_cell)", an EL-panel stage "e += beta * (|s| - e)" and several CdS conductance "populations" `G_i` with their own rates. This is one developer's fitted model (the file refers to "the reference" captures); it is not an independent measurement, and the constants `a, b, b_c` were not read.
- Earlier notes: a 2025 arXiv paper fits a *feed-forward* digital compressor to an LA-2A and lists a feedback design as future work `[SEC]` — [arXiv 2509.10706](https://arxiv.org/abs/2509.10706).

#### 5.2 1176: release behaviour and FET harmonics
- UA's 1176AE manual reportedly says: "There are three features to a program dependent release: A fast release-time, a slow release-time, and a transition-time. The fast release time is the effective release time after transients; the slow release time is the release time after sustained high-RMS signals", and that the "Bluestripe" and 1176AE have "a different slow release-time and transition-time when compared to the 'Blackface' edition" `[SEC]` — [UA 1176AE manual p.22](https://www.manualsdir.com/manuals/293279/universal-audio-1176ae.html?page=22).
- A general explainer adds the purpose: a longer release during prolonged heavy compression reduces "pumping and harmonic distortion (caused by repetitive attack-release cycles)" `[SEC]` — [Sweetwater: program-dependent compression](https://www.sweetwater.com/insync/program-dependent-compression/).
- Open measured model `[SRC]` — dusk-audio multi-comp, [MultiCompModes.hpp](https://github.com/dusk-audio/dusk-audio-plugins/blob/main/plugins/multi-comp/core/MultiCompModes.hpp) (repository LICENSE GPL v3; a developer's fit to its own hardware captures, not independently verified):
  - Feedback law: "One capacitor c, in dB of reduction, integrates the OUTPUT's overshoot above the level the static law settles at, and leaks through the release: dc/dt = max(0, |out| / M(c + Q(c) + T(c)) - 1) / attack - c / release … M the inverse of the measured static law, solved implicitly per sample." Ratios 4–20 use this loop; "All-buttons keeps the feed-forward arm".
  - Release slows with depth: "The depth term is the reference's release slowing as the reduction deepens (after a 1 s hold, 386 ms at 14 dB against 512 ms at 22 dB at 4:1; from 25 dB it falls at about 43 dB/s at 4:1 and 60 dB/s at 20:1)".
  - A second, slower store: "A slow population q adds to the reduction … the reference's slow tail shortens far less than its release at the fast end of the knob" — i.e. the two-part (fast/slow) release UA's manual describes.
  - Ratio scales attack: "the feedback loop's faster effective attack at higher ratios".
  - Attack shape at the slowest setting: "5.0 / 8.0 / 12.7 / 16.1 dB at 0.25 / 0.5 / 1 / 2 ms into a 22 dB step at Attack 0".
  - Harmonics: "The 1176's harmonics are a static part, a function of the reduction alone, plus the side chain's ripple, which the C6 loop produces itself (proportional to the release rate)." Static part = a cubic term ("third harmonic, sign change near 23 dB GR") and an even term ("negative below ~9 dB GR: the 1176's sub-knee second harmonic sits at 180 degrees"). The fitted coefficient tables: cubic −0.0038 at 0 dB of reduction, about −0.0041…−0.0048 between 0.5 and 10 dB, −0.0017 at 18 dB, ≈ 0 at 24 dB, +0.0022 at 40 dB; even −0.0037 at 0 dB, crossing zero between 8 and 10 dB, +0.0045 at 18 dB, +0.0166 at 34–40 dB. I did not trace how these coefficients are applied to the signal, so no THD percentage is derived from them.
- A PhD thesis measured a vintage Blackface 1176 and a UA reissue with THD, IMD and tone bursts and reports that the 1176 "was shown to impart significant amounts of distortion when used in its all-buttons" setting; a 2016 AES convention paper by the same author links the FET gain-reduction circuit to non-linear distortion and pumping when the unit is run outside its design conditions `[SEC]` — [Moore, University of Huddersfield, 2017](https://eprints.hud.ac.uk/id/eprint/34118/). The harmonic order (odd vs. even) was not visible in the summaries.
- Earlier notes (verified then): at the fastest attack and release "minute level fluctuations sound like distortion" — [UA 1176 tips](https://www.uaudio.com/blogs/ua/1176-collection-tips).

#### 5.3 What open code does about the one-sample feedback loop `[SRC]`
- **Squeezer** — [compressor.cpp](https://github.com/mzuther/Squeezer/blob/HEAD/Source/compressor.cpp): in feed-back design the side-chain sample is the stored *previous output sample* (`SideChainSample = OutputSamples[CurrentChannel]`, which already includes make-up gain); the comment reads "feed-forward design: current gain reduction / feed-back design: 'old' gain reduction". The gain computer is the same one used for feed-forward (`dRatioInternal = 1 − 1/ratio` in [side_chain.cpp](https://github.com/mzuther/Squeezer/blob/HEAD/Source/side_chain.cpp)); there is no extra stability code. An "alternative feedback mode" (used with an external side-chain) multiplies the external signal by the last gain reduction.
- **ZL Compressor "Classic" and "Vocal"** (AGPL, study only) — [classic.hpp](https://github.com/ZL-Audio/ZLCompressor/blob/HEAD/source/dsp/compressor/styles/classic.hpp): `input_db = gainToDecibels(|x0_|); reduction = follower(computer.eval(input_db)); x0_ = buffer[i]·decibelsToGain(reduction)` — the detector reads the previous *output* sample (before make-up) through the same computer as the feed-forward styles; no stability guard. "Vocal" is the same loop with the follower on linear gain.
- **Faust `FBcompressor_N_chan` / `FBFFcompressor_N_chan`** (Brouns, GPL-3.0-only) — [compressors.lib](https://github.com/grame-cncm/faustlibraries/blob/HEAD/compressors.lib): the feed-forward gain function inside a `~` recursion (Faust's implicit one-sample delay); in the FB/FF blend the feedback branch runs at three times the strength (`strength*(1+((i==0)*2))`) because "The feedback part has a much higher strength, so they end up sounding similar"; `strength > 1` ("over-compression") is allowed. No guard.
- **chowdsp** — [chowdsp_GainComputerImpls.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/HEAD/modules/dsp/chowdsp_compressor/Compressor/chowdsp_GainComputerImpls.h): the feed-back computer uses the true feedback law `gain = (|y|/T)^(1 − R)` (knee coefficient `(R − 1)/(2·knee)`); no clamp on the loop gain was found, and the module header warns "WARNING: This module is currently unfinished! It is still in need of much testing and optimization."
- **dusk-audio**: solves the loop "implicitly per sample" (comment quoted above) — the only code read that avoids the one-sample delay instead of living with it.

### Inferences
- **Stability bound (derived, then checked by simulation at 48 kHz).** Let the dB gain be smoothed by a one-pole with coefficient α and let the gain computer read the previous output: `g[n] = α·g[n−1] + (1−α)·c`, `c = −L·max(0, x + g[n−1] − T)`, where L is the loop slope (dB of reduction per dB of *output* overshoot). Above threshold `g[n] = (1 − (1−α)(1+L))·g[n−1] − (1−α)·L·(x − T)`. The pole is `p = 1 − (1−α)(1+L)`: stable iff `(1−α)(1+L) < 2`, free of sample-to-sample alternation iff `(1−α)(1+L) ≤ 1`. Steady state: `g = −L/(1+L)·(x − T)`, i.e. an effective ratio of `1 + L`.
  - True feedback law, `L = R − 1`: effective ratio R; condition `(1−α)·R ≤ 1`; the loop's effective attack coefficient is `(1−α)·R`, so the attack is about R times faster than nominal (this is the "attack scaled by ratio" behaviour noted for the 1176).
  - Feed-forward law reused in the loop (Squeezer, ZL, Faust FB), `L = 1 − 1/R ≤ 1`: `(1−α)(1+L) ≤ 2(1−α) < 2` for any smoothing, so it can never run away — but the effective ratio is only `2 − 1/R` (1.75:1 at a nominal 4:1, 1.95:1 at 20:1, never more than 2:1). Brouns' ×3 raises this to at most 4:1 and then needs `(1−α)·4 < 2`.
  - Simulation results (hard knee, threshold −20 dB, input 0 dB, my own Python run): true law R = 4, attack τ 20 µs → pole −1.59, sustained oscillation; R = 4, τ 50 µs → pole −0.36, settles at −15.0 dB (4:1); R = 20, τ 200 µs → pole −0.98, barely stable; R = 20, τ 400 µs → pole −0.015, clean, −19.0 dB (20:1). Feed-forward law in the loop: nominal 4:1 settles at −8.57 dB (1.75:1), nominal 20:1 at −9.74 dB (1.95:1). ×3 strength at "∞:1": τ 20 µs oscillates, τ 40 µs settles at −15.0 dB (4:1).
- **Rule for the app's FET stage** (log-domain feedback, true ratio wanted): compute the attack coefficient as `1 − α_eff = min(1 − α_nominal, 1/R)`. Minimum attack τ for a monotonic loop, `τ_min = −1/(fs·ln(1 − 1/R))`: at 48 kHz 72 µs (4:1), 156 µs (8:1), 239 µs (12:1), 406 µs (20:1); at 44.1 kHz 79 / 170 / 261 / 442 µs; at 96 kHz 36 / 78 / 120 / 203 µs `[DERIVED]`. With the app's present 0.4 ms nominal attack at 4:1 the loop pole is 0.797 at 48 kHz, an effective attack τ of about 92 µs — inside the 1176's documented 20–800 µs range. If the app's computer uses the feed-forward slope `1 − 1/R` inside the loop instead, it is unconditionally stable but its real ratio is `2 − 1/R`; to get a true ratio use slope `R − 1` with the guard above.
- **Release**: with the signal gone, the overshoot is zero and the loop is open, so the release time constant is the nominal one; the ratio scaling applies to the attack only `[DERIVED]`.
- **FET colour**: the sources point to gain ripple from very fast attack/release as the main audible effect, with a small static second/third-order term. A separate waveshaper is therefore optional; if one is added it should be subtle and depend on gain reduction, and its constants would have to be tuned by ear (none are verified here).
- **Programme-dependent release for the FET character**: the two-store structure the app already uses for the optical stage (a fast store plus a slow store holding a share of the reduction) is the same structure UA's manual and the dusk model describe for the 1176 ("fast", "slow", "transition"); for the FET the slow share should be small and the slow time a few times the main release. No verified numbers exist for the share or the times.
- **LA-2A**: a faithful optical model would feed its detector with `x·(β·g[n−1] + (1 − β))` (a feedback/feed-forward blend, larger β in Compress than in Limit by the dusk model's structure). With an optical ratio of about 3:1 the loop slope is small and stability is not an issue. The app's present feed-forward Squeezer-law stage is a legitimate simplification; adding the blend is optional and β is unverified.
- **Make-up constant for one "amount" knob.** No source measures it; the three open laws are 0.5 × static reduction at 0 dBFS (Squeezer), 1.0 × static reduction at a target level (chowdsp) and exact unity at −10 dBFS RMS (darc) — earlier notes. Energy bookkeeping gives a usable rule `[DERIVED]`: the make-up that keeps total energy constant equals the static gain reduction evaluated near the *power-weighted mean* envelope level `L_eff` (for a level distribution with mean μ and standard deviation σ in dB, `L_eff ≈ μ + 0.23·σ²`). So choose the pivot at the level of the loud passages and use k = 1. With the pivot fixed at −12 dBFS, a computed example (levels assumed normally distributed, knee 6 dB, ratios 3–8, thresholds −30…−18 dBFS) gives k = 0.54–0.80 for μ = −18, σ = 4; 0.91–1.08 for μ = −18, σ = 6; 0.91–0.97 for μ = −15, σ = 4 — i.e. k between 0.7 and 1.0 for a normally levelled vocal, moving with how dynamic the singer is. **Recommendation: pivot −12 dBFS (detector units), k = 0.8, smoothed 30 ms, never programme-driven; expose a ±6 dB output trim.** The earlier notes' starting value of 0.7 is inside the same band.

### Gaps
- No LA-2A or 1176 schematic or original manual could be opened (uaudio.com, manualsdir.com, manualsonline.com, groupdiy.com, eprints.hud.ac.uk, core.ac.uk, tangible-technology.com all failed to resolve in this session). The LA-2A topology statement and the 1176 release description are therefore secondary, and the forum sources disagree with each other.
- The dusk-audio constants are one developer's curve fits (21 000 lines of calibration code); they were sampled, not audited, and the way the harmonic coefficients are applied was not traced.
- The Giannoulis–Massberg–Reiss paper remains unread.
- The make-up factor k was estimated from an assumed normal level distribution, not from measured vocals; it needs a loudness-meter check in the app.
- The exact gain law inside the app's own FET stage (`R − 1` or `1 − 1/R`) was not inspected.

---

## 6. Licence check: Calf, chowdsp_compressor, and the sources added in this pass

### Takeaway
Calf's DSP files still carry "LGPL version 2 … or (at your option) any later version" in their headers, while the repository's README and its `licenses/README_LICENSES.txt` now declare the project "LGPL-2.1-only"; both readings are compatible with a GPL-3.0-or-later project because LGPL 2.1 §3 itself lets a copy be converted to the GPL "version 2" or "a newer version". chowdsp_compressor says only "license: GPLv3" with no "or later" wording anywhere I could find, so the conservative reading is GPL-3.0-only: combinable, but copying its code would pin the combined work to v3 — re-derive from the formulas.

### Cited Findings
- **Calf per-file headers** `[SRC]` (commit a1b72e1) — the compression source file begins: "This program is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation; either version 2 of the License, or (at your option) any later version." — [src/modules_comp.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/modules_comp.cpp). The same "version 2 of the License, or (at your option) any later version" line is in [audio_fx.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/audio_fx.cpp), [audio_fx.h](https://github.com/calf-studio-gear/calf/blob/HEAD/src/calf/audio_fx.h), [primitives.h](https://github.com/calf-studio-gear/calf/blob/HEAD/src/calf/primitives.h), [biquad.h](https://github.com/calf-studio-gear/calf/blob/HEAD/src/calf/biquad.h), [modules_comp.h](https://github.com/calf-studio-gear/calf/blob/HEAD/src/calf/modules_comp.h) and [metadata.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/metadata.cpp).
- **Calf project-level statements** `[SRC]`: README: "This project is licensed under LGPL-2.1-only. It uses GTK and FluidSynth (LGPL-2.1-or-later)." — [README.md](https://github.com/calf-studio-gear/calf/blob/HEAD/README.md); `licenses/README_LICENSES.txt`: "CALF (this project) … License: LGPL-2.1-only" — [README_LICENSES.txt](https://github.com/calf-studio-gear/calf/blob/HEAD/licenses/README_LICENSES.txt); the root `COPYING` is the text of "GNU LESSER GENERAL PUBLIC LICENSE Version 2.1, February 1999" — [COPYING](https://github.com/calf-studio-gear/calf/blob/HEAD/COPYING). So the claim "LGPL-2.1-only" is real, but it is a project-level label that contradicts the per-file grants.
- Some Calf host/GUI files are under the GPL instead, e.g. `jackhost.cpp`: "under the terms of the GNU General Public License … either version 2, or (at your option) any later version" — [jackhost.cpp](https://github.com/calf-studio-gear/calf/blob/HEAD/src/jackhost.cpp); a number of headers (`bypass.h`, `orfanidis_eq.h`, `vumeter.h`, `modules_pitch.h`, `wavetable.h`, LV2 headers) have no LGPL notice at all `[SRC, grep]`.
- LGPL 2.1 §3, quoted from Calf's own COPYING `[SRC]`: "You may opt to apply the terms of the ordinary GNU General Public License instead of this License to a given copy of the Library. To do this, you must alter all the notices that refer to this License, so that they refer to the ordinary GNU General Public License, version 2, instead of to this License. (If a newer version than version 2 of the ordinary GNU General Public License has appeared, then you can specify that version instead if you wish.)"
- **chowdsp_compressor** `[SRC]` (commit e97b826): the module declaration block reads "ID: chowdsp_compressor / vendor: Chowdhury DSP / version: 2.4.0 / name: ChowDSP Compressor / description: Tools for building a compressor / … / license: GPLv3" followed by "WARNING: This module is currently unfinished! It is still in need of much testing and optimization." — [chowdsp_compressor.h](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/HEAD/modules/dsp/chowdsp_compressor/chowdsp_compressor.h). The files under `Compressor/` contain no licence text (grep for "license" returns nothing). Repository `LICENSE.md`: "Each module in this repository has its own unique license. If you would like to use code from one of the modules, please check the license of that particular module. If you are making a proprietary or closed source app and would like to use code from a module that is under a GPL-style license, please contact chowdsp@gmail.com for non-GPL licensing options. All non-module code in this repository (tests, examples, benchmarks, etc.) is licensed under the GPLv3." — [LICENSE.md](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/HEAD/LICENSE.md). README lists "`chowdsp_compressor` (GPLv3)" — [README.md](https://github.com/Chowdhury-DSP/chowdsp_utils/blob/HEAD/README.md). No "or any later version" wording in any of the three.
- GPL v3 §14, quoted from a GPL v3 text in one of the cloned repositories `[SRC]`: "If the Program specifies that a certain numbered version of the GNU General Public License 'or any later version' applies to it, you have the option of following the terms and conditions either of that numbered version or of any later version … If the Program does not specify a version number of the GNU General Public License, you may choose any version ever published" — [master_me LICENSE](https://github.com/trummerschlunk/master_me/blob/HEAD/LICENSE).
- **Sources added in this pass** `[SRC]`:

| Source | Licence as found | Use in a GPL-3.0-or-later project |
|---|---|---|
| Airwindows DeEss, DeBess, Gatelope, SoftGate, ClipOnly2, ClipSoftly, ADClip7 | MIT (repo LICENSE; earlier notes) | Port freely |
| nhthn/safety-limiter | Unlicense, text in the header: "This is free and unencumbered software released into the public domain." | Port freely |
| stmlib limiter / SoftLimit | MIT (earlier notes) | Port freely |
| Calf Deesser, Gate, gain-reduction object | LGPL "version 2 … or any later version" per file; project label "LGPL-2.1-only" | Port (either reading is compatible) |
| LSP Gate, AutoGain, SimpleAutoGain, SurgeProtector | "GNU Lesser General Public License … either version 3 of the License, or any later version" (header of AutoGain.cpp) | Port |
| lsp-plugins-gate, lsp-plugins-autogain (defaults) | LSP project, LGPL-3.0-or-later headers (only the meta and plug files were opened) | Values are facts; port |
| ZamGate | GPL-2.0-or-later (earlier notes) | Port |
| Faust `ef.gate_mono`, `an.amp_follower_ar` | `LicenseRef-STK-4.3` (MIT-style) | Port |
| Faust `peak_expansion_gain_mono_db`, `FFcompressor_N_chan`, `FBFFcompressor_N_chan` | declared `GPL-3.0-only` | **Flag: re-implement from the formula** |
| master_me | `declare license "GPLv3"`; README "licensed under GPL3"; no "or later" seen; depends on GPL-3.0-only Faust functions | **Flag: formula reference only** |
| OBS expander / noise gate / limiter filters | no per-file header; repo COPYING GPL v2; core files "version 2 … or (at your option) any later version" | Treat as GPL-2.0-or-later; safest to re-implement |
| WebRTC AGC2 | "BSD-style license … An additional intellectual property rights grant can be found in the file PATENTS" (file headers) | Compatible; constants only were used |
| dusk-audio multi-comp | file header "GNU GPL v3.0 or later (see repository LICENSE)" on `MultiCompOptoCell.hpp`; README "licensed under the GNU General Public License v3.0" | Compatible; used as knowledge only (fitted model, far too large to port) |
| ZL Compressor | AGPL-3.0 (earlier notes) | **Study only** |
| Techivation T-De-Esser, digitalfishphones Spitfish | closed freeware (secondary) | Not usable |

### Inferences
- For Calf, cite the per-file header when porting a specific file and keep the notice; the project-level "LGPL-2.1-only" label does not prevent use in a GPL-3.0-or-later program, because LGPL 2.1 §3 allows conversion to GPL v2 or a newer GPL version. (Not legal advice; this is a reading of the licence text quoted above.)
- For chowdsp_compressor, master_me and the Brouns/Sanfilippo Faust functions the rule from the earlier notes stands: read for the idea, write the code from the mathematics.

### Gaps
- When Calf's README label was changed to "LGPL-2.1-only" could not be dated (shallow clone); whether the maintainers intend to relicense the files was not investigated.
- chowdsp's author was not asked whether "GPLv3" means "or later".
- The OBS filter files' licence is inferred from the repository, not stated in the files.

---

## 7. The final recommended minimal vocal dynamics design

### Takeaway
Keep the fixed order **(static input trim) → expander → de-esser → fast FET compressor → slow optical compressor → static make-up → limiter + soft clip**, all with zero look-ahead. Relative to what the app has today the changes worth making are: give the expander a range limit, hysteresis and hold; shorten the de-esser release from 60 ms to about 15 ms and replace its hard clamp with a soft ratio law and depth cap; guard the FET loop with `1 − α ≤ 1/R`; and put a hold-and-release limiter in front of the existing soft clip.

### Cited Findings
- Chain order in practice (earlier report, pages read in the earlier session): Sound On Sound's reference chain is gate → de-esser → compressor → compressor → EQ → tube distortion, because "compression tends to emphasise frequencies that already dominate a sound", so "it's best to place [the de-esser] before any standard compressor" — [SOS: Vocal Processing](https://www.soundonsound.com/techniques/vocal-processing). "The 1176 goes first because its fast 'grab' catches peaks before they get out of hand" — [UA: LA-2A and 1176](https://www.uaudio.com/blogs/ua/how-to-use-the-la-2a-and-1176-in-your-mix).
- A complete open chain built for live use orders its dynamics the same way `[SRC]`: master_me runs gate → EQ → leveller → side-chain compressor → `mscomp` → RMS limiter → no-latency brickwall — [master_me.dsp](https://github.com/trummerschlunk/master_me/blob/HEAD/master_me.dsp).
- Hardware figures used below (earlier notes): 1176 attack 20–800 µs, release 50 ms–1.1 s, ratios 4/8/12/20, vocal starting point 4:1 — [UA 1176 tips](https://www.uaudio.com/blogs/ua/1176-collection-tips); LA-2A ratio "roughly 3:1", attack 10 ms, release "about 60 milliseconds for 50% of the release, and anywhere from 1 to 15 seconds for the rest" — [UA LA-2A tips](https://www.uaudio.com/blog/la-2a-collection-tips-tricks/); generic target "around 5 dB of gain reduction", ratio 2:1–5:1 — [UA compression basics](https://www.uaudio.com/blogs/ua/audio-compression-basics); dbx 160 family attack 15 ms for 10 dB, release about 120 dB/s `[SEC]` — [dbx 160SL manual](https://www.manualsdir.com/manuals/288622/dbx-160sl.html?page=13); x42 darc defaults threshold −30 dB, attack 10 ms, release 300 ms, soft power-law knee, hold `[SRC]` — [darc lv2.c](https://github.com/x42/darc.lv2/blob/HEAD/src/lv2.c); Squeezer optical law `480/(3 + GR)` ms `[SRC]` — [gain_stage_optical.cpp](https://github.com/mzuther/Squeezer/blob/HEAD/Source/gain_stage_optical.cpp); CTAGDRC defaults threshold −20 dB, ratio 2, knee 6 dB `[SRC]` — [Constants.h](https://github.com/p-hlp/CTAGDRC/blob/HEAD/Source/util/include/Constants.h).

### Inferences

**Order and reasons**

| # | Stage | Why here |
|---|---|---|
| 0 | Static input trim (calibrated to −18 dBFS gated RMS; optional slow rider, off by default) | Every later threshold is defined against a known level (§4) |
| 1 | High-pass (already in the chain), then downward expander | Works on the uncompressed signal, where the gap between voice and noise is largest; compression afterwards would raise the floor it has to judge. SOS chain: gate first |
| 2 | De-esser (split-band, relative threshold) | Before compression, which would otherwise emphasise sibilance (SOS). A relative threshold also makes it immune to the level changes around it |
| 3 | Compressor A — fast (FET character by default) | Catches peaks first (UA) so the slow stage sees a steadier signal |
| 4 | Compressor B — slow (optical character by default) | Levels the phrase; program-dependent release hides the work |
| 5 | Static make-up (pivot law, §5) and any tone/colour stages | Never programme-driven |
| 6 | Limiter (hold-and-release) → soft clip → finite check | Absolute protection, last (§3) |

**Parameter table per stage** (τ = true 63 % time constant, `α = exp(−1/(τ·fs))`; "src" = copied from a cited source, "dc" = design choice to be tuned by ear)

| Stage | Parameter | Value | Basis |
|---|---|---|---|
| Input trim | target / range | −18 dBFS gated RMS / ±12 dB, frozen after calibration | master_me target −18 (src); dc |
| Input trim | detector | power one-pole τ 400 ms, gated above expander threshold | LSP long period 400 ms, master_me 0.4 s (src) |
| Optional rider | rate / range / dead band | +1 dB/s up, −4 dB/s down / ±6 dB / ±1.5 dB; frozen when 10 ms RMS < expander threshold + 6 dB | AGC2 3 dB/s, LSP fall faster than grow (src); dc |
| Expander | detector | 100 Hz side-chain HPF; power one-pole τ 10 ms | OBS/LSP 10 ms (src) |
| Expander | threshold / hysteresis | noise floor + 10 dB (default −45 dBFS) / 4 dB | OBS −40 dB, 6 dB hysteresis (src); dc |
| Expander | ratio / knee / range | 2:1 / 9 dB / 10 dB | Calf 2:1, knee 2.83 (src); range dc |
| Expander | hold / open τ / close τ | 150 ms / 3 ms / 150 ms | OBS 200 ms hold, 150 ms release; Faust 100 ms hold (src) |
| De-esser | split | LR4 at 5.0 / 6.5 / 8.0 kHz (low / default / high voice) | app's 6.5 kHz; Calf 6 kHz; SOS 4–10 kHz (src) |
| De-esser | detector | power one-poles τ 3 ms on high band and full band; index = 10·log10(pH/pF) | Calf RMS detector ≈ 4–5 ms (src); relative index = app design |
| De-esser | threshold / slope / knee / cap | −9 dB (amount knob −5…−14) / 0.667 / 9 dB / 9 dB | Calf ratio 3 and knee 2.8 (src); threshold and cap dc |
| De-esser | attack τ / release τ | 1 ms / 15 ms | app 0.8 ms; Calf ≈ 3.7 / 5 ms, DeBess ≈ 8 ms (src-derived) |
| De-esser | floor | inactive below the expander threshold | dc |
| Limiter | target / ceiling | −3 dBFS / −1 dBFS (tanh knee between) | dc (ClipOnly2 uses −0.2 dBFS, stmlib 0.8 headroom) |
| Limiter | attack τ / hold / release | 0.4 ms / 100 ms / −60 dB in 100 ms (τ 14.5 ms) | stmlib 0.05 per sample; safety-limiter 100 ms / 100 ms (src) |

**Four selectable compressor characters over the one soft-knee gain computer** (thresholds assume the trimmed −18 dBFS RMS input; `GR` = gain reduction in dB)

| | FET (fast, default slot A) | Opto (slow, default slot B) | VCA / clean | Vari-mu / glue |
|---|---|---|---|---|
| Topology | Feedback: detector reads the previous output sample | Feed-forward (optional feedback blend, unverified) | Feed-forward | Feed-forward, power-additive law (darc) |
| Detector | peak `|y|`, no side-chain filter | peak `|x|`, side-chain high-pass 100–150 Hz ("emphasis") | peak `|x|` (or power, τ 10 ms), side-chain high-pass 120 Hz | power `x²` plus threshold power (no knee branch) |
| Static law | soft knee 6 dB; loop slope `R − 1` for a true ratio | soft knee 12 dB (dc) | soft knee 6 dB (CTAGDRC default) | `gain = exp(−r·ln(20·z))`, `r = 0.5·(1 − 1/R)` (darc) |
| Ratio | 4:1 default; 8, 12, 20 selectable (UA) | 3:1 (UA "roughly 3:1") | 3:1 (range 2–4; UA 2:1–5:1) | 3:1 nominal, rising with level (darc scale point 0.666) |
| Attack | nominal τ 0.4 ms (app today); guard `1 − α ≤ 1/R`; effective ≈ 92 µs at 4:1, 48 kHz | 10 ms average (UA); Squeezer law: `48/(3 + GR)` ms to 73 % on top of the main smoother | τ 10 ms (range 5–20) | darc attack 10 ms setting (τ ≈ 20 ms in darc's convention) |
| Release | τ 80 ms (app today; UA range 50 ms–1.1 s); optional small slow store (unverified constants) | Squeezer law `480/(3 + GR)` ms to 73 % (160 ms at 0 dB GR, 32 ms at 12 dB) plus the app's 1.5 s tail on a quarter of the reduction (UA: 60 ms for half, then 1–15 s) | τ 150 ms (range 100–250), decoupled smoothing, 10 ms hold | darc 300 ms setting: two cascaded stages, each τ ≈ 86 ms, release frozen below threshold |
| Smoothing placed on | dB gain reduction inside the loop | dB gain reduction, reduction-dependent second smoother | dB gain reduction (decoupled) | detector power |
| Threshold (peak, after trim) | −18 dBFS at "amount" 50 % | −22 dBFS | −20 dBFS (CTAGDRC default) | −30 dB darc setting (src default) |
| Typical gain reduction | 3–6 dB on peaks (UA "around 5 dB") | 2–4 dB average | 3–5 dB | 2–4 dB, slow |
| Colour | none added; the loop's own ripple at fast settings is the FET sound | none added | none | none (Pressure4 `coef²` cell is the character alternative, earlier notes) |
| Make-up | static pivot law, k = 0.8 at −12 dBFS | same | same | built into the darc law (unity near −10 dBFS RMS) |
| Source to port or re-derive | UA figures; Squeezer feedback switch (GPL-3.0-or-later); stability rule §5 | Squeezer optical stage (GPL-3.0-or-later) | CTAGDRC (GPL-3.0-or-later) | x42 darc (GPL-2.0-or-later) |

- One "Compress" macro should lower both slot thresholds together (for example −12…−30 dBFS for slot A with slot B 4 dB lower) and apply the static make-up; show total gain reduction.
- **Sample-rate handling across the whole design:** every time is a τ in seconds converted with `exp(−1/(τ·fs))` at prepare time; hold times become integer sample counts at prepare time; filters are recomputed from Hz; the FET guard uses the actual fs; nothing in the design uses a per-sample constant, a block-size-dependent constant or a buffer whose length depends on fs (the only state is a handful of scalars per stage), so there is no per-sample allocation and the behaviour at 44.1, 48 and 96 kHz differs only by the FET loop's one-sample delay (20.8 µs at 48 kHz, 10.4 µs at 96 kHz).
- **Latency:** 0 samples for every stage.

### Gaps
- The whole design is a synthesis from code reading and a few numerical checks; nothing was listened to. Values marked "dc" have no source.
- Thresholds in the character table are starting points tied to an assumed −18 dBFS RMS input with about 12 dB of crest; they were not validated on recordings.
- The optional slow store for the FET character and the feedback blend for the optical character have no verified constants.
- The interaction between the LR4 de-esser's phase rotation and the downstream FET compressor's peak detection was not measured.
- The app's existing implementation was described in the brief but its code was not inspected; where "app today" is quoted, the values come from the brief.
