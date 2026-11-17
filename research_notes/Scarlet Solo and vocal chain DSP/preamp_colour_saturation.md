# Vocal preamp and colour/saturation hardware and plug-ins, and how to model them in real time

Research note scope: JHS Colour Box (V1/V2), Neve 1073, API 550A/512c, SSL 4000 E/G, Soundtoys Decapitator, tape, tube/transformer/op-amp saturation, and the zero-lookahead DSP methods to model them (target: under 2 ms added latency for live vocal monitoring).

Method note: in this session, fetching full pages from soundtoys.com, ams-neve.com and jhspedals.info failed (the hosts are outside the session's allowed network). After that, findings came from web-search result extracts, not full-page reads. Manufacturer PDFs (Decapitator manual, AMS Neve 1073 manual, JHS product page, API 550A brochure, UAD manuals) are cited by URL. Where possible, re-check exact numbers against those PDFs before building on them. Items under "Inferences" are engineering reasoning or standard DSP derivations, not quotes from a source. They are marked that way on purpose.

---

## JHS Colour Box (V1 and V2): what it is, every control, EQ points, gain staging, why it is used on vocals

### Takeaway
The Colour Box is a guitar-pedal-format preamp built to give the sound of the Neve 1073 channel. It has two discrete gain stages in series. Step sets the gain of both stages (18 to about 39 dB in five steps on V2). Pre-Volume sets the level between stage 1 and stage 2, so it acts as the "drive" control. Master is the output level. V2 adds a combo XLR/1/4" input with a -20 dB pad, 48 V phantom pass-through, sweepable ("Shift") Treble/Middle/Bass, and a sweepable Hi-Pass. Singers use it as a mic preamp because it runs from clean "console warmth" to overdrive.

### Cited Findings
**Origin and topology**
- The original Colour Box launched in 2014 to bring the sound of the Neve 1073 preamp, with two circuits arranged in series. — [GearNews](https://www.gearnews.com/jhs-makes-good-things-better-with-color-box-version-2-preamp-pedal)
- "The preamp contains two gain stages, and the pre-vol control has no effect on the first stage. It sets the signal level getting into stage two." — [Guitar.com review](https://guitar.com/review/jhs-colour-box-review/)
- Pre-Volume acts like the drive knob on an overdrive pedal. Master acts like a normal volume control. — [No Treble](https://www.notreble.com/?p=33835); [Vintage King](https://vintageking.com/jhs-pedals-colour-box)
- The original (V1) had no phantom power ("bring your own juice when using a condenser mic"). The V2 passes 48 V phantom through its XLR connection. — [Tape Op review](https://tapeop.com/reviews/gear/107/colour-box-preampeq-pedal); summary via [search of review sources](https://www.sweetwater.com/store/detail/ColourBoxV2--jhs-colour-box-v2-preamp-pedal/reviews?reviews=5)
- The V2 has a combo XLR/1/4" input with an INST/XLR selector. The -20 dB pad works only in XLR mode and helps with high-output microphones. — [JHS Colour Box V2 product page](https://jhspedals.info/products/colour-box-v2) (via search extract); [Premier Guitar V2 announcement](https://www.premierguitar.com/jhs-pedals-announces-the-colour-box-v2)

**Step (gain) switch**
- V2 Step: five positions, +18, +23, +28, +33, +39 dB. — [JHS V2 product page](https://jhspedals.info/products/colour-box-v2); [Delicious Audio](https://delicious-audio.com/jhs-colour-box-v2/)
- Conflicting figures for other versions: Vintage King lists 18, 23, 28, 33 dB (four steps, original). The 500-series Colour Box lists "18db, 23db, 28db, 32db, or 37db" and says Step "sets the overall gain of each stage". No Treble gives 18 to 39 dB. — [Vintage King](https://vintageking.com/jhs-pedals-colour-box); [Moog Audio (Colour Box 500)](https://www.moogaudio.com/en/jhs-colour-box-500); [No Treble](https://www.notreble.com/?p=33835)

**EQ (V2)**
- Treble and Bass: ±15 dB (flat at noon). Middle: ±10 dB (flat at noon). — [JHS V2 product page / retailer copies](https://jhspedals.info/products/colour-box-v2); [Gear4music](https://gear4music.com/us/en/Guitar-and-Bass/JHS-Pedals-Colour-Box-V2/3ZFN)
- Shift (frequency sweep) ranges, best-supported set: Treble 2 kHz to 30 kHz, Middle 150 Hz to 2.4 kHz, Bass 20 Hz to 440 Hz. Turning Shift counter-clockwise lowers the frequency. — [JHS V2 product page](https://jhspedals.info/products/colour-box-v2); [Reverb listing](https://reverb.com/item/40987245-jhs-pedals-colour-box-v2-preamp-eq-overdrive-distortion-fuzz-di-guitar-effect-pedal). Conflicting: one listing gives Treble 1 to 15 kHz, Mid 160 Hz to 2.5 kHz, Bass 20 to 400 Hz. Another gives centres of 10 kHz / 1 kHz / 120 Hz, which are probably default or centre points. — [RockBoard PedalPedia](https://www.rockboard.de/en/pedalPedia/JHS/Colour-Box-V2/68980471/); [Guitar Sanctuary](https://www.guitarsanctuary.com/jhs-colourbox-v2-preamp-pedal/)
- Hi-Pass: sweepable 160 Hz to 650 Hz. Slope conflict: one source says 2nd-order 12 dB/oct, another says 6 dB/oct. — [JHS V2 product page](https://jhspedals.info/products/colour-box-v2); [Delicious Audio](https://delicious-audio.com/jhs-colour-box-v2/)
- The original V1 had fixed-frequency Treble/Middle/Bass knobs and a Hi-Pass switch rather than sweeps. This could not be confirmed from a primary page (see Gaps).

**Use on vocals**
- A Sweetwater reviewer who sings said they "sounded much better and enjoyed singing more". An American Musical buyer used it on guitar and "to record vocals". — [Sweetwater reviews](https://www.sweetwater.com/store/detail/ColourBoxV2--jhs-colour-box-v2-preamp-pedal/reviews?reviews=5); [American Musical](https://www.americanmusical.com/p/jhs-colour-box-10-preamp)
- It "can add a subtle warmth or a pronounced overdrive depending on your settings". — [Produce Like A Pro](https://producelikeapro.com/blog/exploring-the-jhs-colour-box-v2-a-versatile-tool-for-musicians-and-engineers/amp/)
- The 10th-anniversary Colour Box ("Colour Box 10") is described as having a "Lo mode for ultra-clean sounds and subtle tone shaping, perfect for acoustic guitar or vocals". — [American Musical](https://www.americanmusical.com/p/jhs-colour-box-10-preamp)

### Inferences
- **Gain-staging model for DSP:** input pad/mic gain → (Hi-Pass) → stage 1 (gain = Step) → Pre-Volume attenuator → stage 2 (gain = Step) → EQ → Master. Each stage has its own soft nonlinearity, so the sound depends on how the gain is split. A high Step with a low Pre-Volume drives only stage 1 into colour. A low Step with a high Pre-Volume keeps stage 1 clean and drives stage 2. With Step at +39 dB per stage, the total available gain is far more than a mic needs. This is why the pedal reaches "fuzz" territory, and why a vocal preset should keep Step low (+18/+23) and set level with Pre-Volume/Master.
- Because the EQ position relative to the stages is not documented (see Gaps), a model could put the EQ after stage 2, as on the 1073, where EQ follows the preamp. Then EQ boosts do not change the drive.
- For a vocal "Colour Box" voice in software, the useful range is: HPF around 80 to 160 Hz (the pedal's 160 Hz minimum is high for vocals, so a lower software HPF is reasonable), low drive, Treble Shift around 10 to 12 kHz for "air", and Middle used as a broad cut around 300 to 500 Hz or a boost around 1 to 2 kHz for presence.

### Gaps
- The exact V1 control set (fixed EQ frequencies, Hi-Pass switch frequency, and whether Step was 4 or 5 positions) could not be confirmed from a JHS primary page, because jhspedals.info was unreachable.
- The schematic order (whether the EQ is between or after the gain stages), the Treble/Bass curve type (shelf or bell), and the Middle Q are not documented in any source found.
- No published harmonic-spectrum measurement of the Colour Box was found.

---

## Neve 1073: gain stages, transformers, class A, EQ points and curve shapes, harmonic signature

### Takeaway
The 1073 is a discrete-transistor class-A mic/line amp. It has a Marinair-spec 10468 mic input transformer and an LO1166 gapped output transformer. Mic gain is +20 to +80 dB in 5 dB steps. The EQ is inductor-based: a fixed 12 kHz high shelf at ±16 dB; a mid peak at 0.36/0.7/1.6/3.2/4.8/7.2 kHz at ±18 dB with no Q control; a low shelf at 35/60/110/220 Hz; and an 18 dB/oct HPF at 50/80/160/300 Hz. The mid bandwidth narrows as gain increases ("proportional Q"), and the mid Q rises with centre frequency.

### Cited Findings
- Mic gain +80 dB to +20 dB in 5 dB steps. — [AMS Neve 1073LB](https://ams-neve.com/1073lb/); [AMS Neve 1073 product family](https://www.ams-neve.com/?p=1562)
- The input is a 10468 Marinair-spec transformer (mic) and a 31267 (line). The LO1166 gapped output transformer was designed by Rupert Neve around 1964. — [AMS Neve: Marinair](https://www.ams-neve.com/about-marinair/); [AMS Neve 1073LB](https://ams-neve.com/1073lb/)
- AMS Neve describes "two discrete transistor-based preamp gain stages, and one output gain stage". Sound On Sound says the original used BA283 circuitry plus an extra BA284 gain stage that did much of the work at the +50 to +80 dB end. — [AMS Neve 1073LB](https://ams-neve.com/1073lb/); [Sound On Sound: BAE 1073 MPF](https://www.soundonsound.com/reviews/bae-1073-mpf)
- The BA283 is a discrete-transistor class-A preamp and output-stage circuit. — [Sound On Sound: BAE 1073 DMP](https://www.soundonsound.com/reviews/bae-1073-dmp)
- EQ: high shelf fixed at 12 kHz, ±16 dB. Mid peak selectable at 0.36, 0.7, 1.6, 3.2, 4.8, 7.2 kHz, ±18 dB. Low shelf at 35, 60, 110, 220 Hz. HPF at 18 dB/oct at 50, 80, 160, 300 Hz. — [AMS Neve 1073 manual/spec](https://www.ams-neve.com/?p=1562); [ManualsLib Neve 1073 manual](https://www.manualslib.com/manual/1197029/Neve-1073.html?page=8); [MusicTech 1073 DPX review](https://musictech.com/2015/06/neve-1073-2/)
- The mid band has no Q control, so it is not truly parametric. — [Sound On Sound plug-in review](https://www.soundonsound.com/reviews/plug-folder-19)
- Bandwidth narrows as boost or cut increases (proportional Q, self-adjusting). — [Vintage Console EQ (Logic training notes)](https://sites.google.com/whosthebass.com/logictraining/effects/spectral-effects/vintage-console-eq)
- UA explains that the 1073 uses an inductor and capacitor to set the filter resonance. At higher centre frequencies the Q goes up, giving a more focused peak. Parasitic capacitances in the inductor pull the mid-band peaks toward unity gain at high frequencies. — [Universal Audio WebZine (2006)](https://www.uaudio.com/webzine/2006/may/text/content2.html)
- A community JSFX model (EQ1979) compared its curves to UAD's 1073 and set shelf gain to 16 dB "as per original 1073 design". — [Belles Ondes EQ1979 wiki](https://www.bellesondes.fr/wiki/doku.php?id=eq1979)
- The UAD 1073 is aimed at "broad musical frequency shaping rather than surgical correction". — [UAD Neve 1073 manual](https://help.uaudio.com/hc/en-us/articles/4419497223188-Neve-1073-Preamp-EQ-Manual); [UA product page](https://www.uaudio.com/uad-plugins/equalizers/neve-1073-collection.html)

### Inferences
- **EQ model with biquads:** HPF = 3rd-order Butterworth-like (one 1st-order plus one 2nd-order section) at 50/80/160/300 Hz to get 18 dB/oct. Low shelf = 2nd-order shelf (RBJ low-shelf, S around 0.7 to 1). Inductor-type shelves on vintage consoles often show a small dip/bump next to the shelf. This can be approximated with a shelf of Q above 0.707 (resonant shelf). It is unconfirmed for the 1073 (see Gaps). High shelf = 2nd-order shelf at 12 kHz. At 44.1/48 kHz this sits close to Nyquist, so a bilinear (RBJ) design will cramp. Use a matched / Vicanek / Massberg design (see DSP section).
- **Mid peak:** RBJ peaking biquad with Q as a function of both gain and centre frequency, for example Q = Q0(fc) · (1 + k·|G_dB|/18). Q0 rises with fc, per UA's description of the inductor. For the 7.2 kHz band, also scale the realised peak down slightly, to mimic the parasitic-capacitance pull toward unity. Exact constants must be fitted to measured curves (UAD plug-in or hardware sweeps).
- **Preamp colour:** class-A single-ended transistor stages are asymmetric, so expect 2nd harmonic at moderate level. The output transformer adds low-frequency, level-dependent 3rd harmonic (see transformer section). For a vocal "1073 colour" without heavy drive: mild asymmetric soft clip, then a transformer stage with frequency-dependent saturation.

### Gaps
- No published harmonic-spectrum measurement (2nd vs 3rd vs higher, vs level and frequency) of a 1073 or its Marinair transformers was found. The Marinair page is marketing with no figures.
- Exact mid-band Q values per frequency and gain, and whether the shelves overshoot, were not found. The UAD manual page found does not cover them.

---

## API 512c / 550A: discrete op-amp 2520, transformer, proportional Q EQ, character

### Takeaway
The API 550A is a 3-band, stepped, proportional-Q EQ. Its points are LF 50/100/200/300/400 Hz, MF 0.4/0.8/1.5/3/5 kHz and HF 5/7/10/12.5/15 kHz, with boost/cut steps of 2, 4, 6, 9 and 12 dB. LF and HF switch between shelf and peak. Bandwidth is wide at low gain and narrows as gain rises. Data on the 512c preamp could not be retrieved in this session.

### Cited Findings
- UAD manual: HF 5, 7, 10, 12.5, 15 kHz. MF 0.4, 0.8, 1.5, 3, 5 kHz. LF 50, 100, 200, 300, 400 Hz. — [UAD API 500 Series EQ Collection manual](https://help.uaudio.com/hc/en-us/articles/32524771071636-API-500-Series-EQ-Collection-Manual)
- Boost/cut in steps of 2, 4, 6, 9 and 12 dB, max ±12 dB. LF and HF switchable shelf/peak. Mid is a bell. — [API 550A brochure](https://www.APIaudio.com/docs/brochures/br550a.pdf); [API 550A product page](https://apiaudio.com/product/550a-discrete-3-band-eq/); [Waves API 550 user guide](https://manualmachine.com/wavesaudio/api550/6495050-user-guide/)
- Sources disagree on the point count (15 vs 21 points). — [RSPE Audio](https://www.rspeaudio.com/API-550A-p/api-550a.htm); [Musician's Friend](https://www.musiciansfriend.com/pro-audio/api-550a-discrete-3-band-eq/l82000000000000)
- Proportional Q widens bandwidth at low boost/cut and narrows it at high boost/cut. — [RSPE Audio](https://www.rspeaudio.com/API-550A-p/api-550a.htm); [API 550A product page](https://apiaudio.com/product/550a-discrete-3-band-eq/)
- Reciprocal: boost and cut curves mirror each other. — [API 550A brochure](https://www.APIaudio.com/docs/brochures/br550a.pdf)

### Inferences
- A proportional-Q peaking filter is easy to build: Q = Qmin + (Qmax - Qmin)·(|G|/12). Fit Qmin around 0.4 to 0.7 and Qmax around 1.5 to 2.5 to published curves (constants not sourced; must be fitted). Reciprocal cut = exact inverse of the boost biquad, which the RBJ peaking filter already gives when the same Q is used.
- The 2520 op-amp is generally described as a discrete class-AB op-amp. API's sound is often called "punchy/forward". This could not be sourced in this session (see Gaps). For DSP, treat it as a mostly clean stage that clips fairly hard (odd-dominant) near the rails, with a transformer stage after it.

### Gaps
- No source retrieved on the API 512c (gain range, 2520 behaviour, transformer model, harmonic measurements), or on 2520 op-amp distortion measurements. A targeted fetch of apiaudio.com was not attempted after other manufacturer hosts were blocked.

---

## SSL 4000 E/G channel strip EQ and dynamics on vocals

### Takeaway
There are two E-series EQ variants: "Brown Knob" (02 circuit) and "Black Knob" (242, developed with George Martin for AIR). The G-series EQ was the 292/383 in different accounts. SSL EQs are known as cleaner, more "surgical" console EQs than the Neve or API inductor EQs. Exact band ranges were not retrieved.

### Cited Findings
- Early E-series used the "Brown Knob" 02 circuit. The "Black Knob" 242 was developed with George Martin for AIR. The only visual difference was the LF knob colour. — [Abbey Road Institute](https://abbeyroadinstitute.nl/blog/ssl-e-g-series-eq/); [Waves: SSL E-Channel or G-Channel?](https://www.waves.com/ssl-e-channel-or-g-channel)
- Brown has 12 dB/oct HPF/LPF. Black adds a filter bypass (forum claims). — [Gearspace: different SSL EQs](https://gearspace.com/threads/different-ssl-eqs.23018/)
- Waves' E-Channel models the 242 Black Knob. The G-Channel models the 383 G-EQ. Another source says many G-series consoles reverted to the 242. — [Waves](https://www.waves.com/ssl-e-channel-or-g-channel); [Gearspace](https://gearspace.com/threads/ssl-eq-differences.806522/)
- SSL publishes a Channel Strip Guide (2025). — [SSL Channel Strip Guide PDF](https://eu1.download.solidstatelogic.com/Channel%20Strip%20Guide/SSL%20Channel%20Strip%20Guide%20v1%202025.pdf)

### Inferences
- For a vocal chain, an SSL-style stage is best modelled as a clean, low-colour 4-band EQ with HPF/LPF. The gain-dependent Q behaviour differs between E and G (the G is commonly described as proportional-Q in plug-in documentation, which is not sourced here). The SSL channel dynamics (compressor/gate) belong to the dynamics research, not to saturation.

### Gaps
- Exact SSL E/G band frequency ranges, gain ranges, Q behaviour, and channel compressor specs were not retrieved. The SSL Channel Strip Guide PDF and the Waves manuals are the next sources to read.

---

## Soundtoys Decapitator and tape saturation (Ampex/Studer: head bump, HF loss, hysteresis, wow/flutter)

### Takeaway
Decapitator has five analog-modelled saturation "Styles": A = Ampex 350 tape preamp, E = Chandler/EMI TG channel, N = Neve 1057 input channel, T = Thermionic Culture Vulture triode, P = Culture Vulture pentode. It adds Drive, Punish (+20 dB), a tilt-type Tone control, Low/High Cut, and Mix. Tape adds a speed-dependent low-frequency "head bump" (about 35 to 120 Hz depending on machine and speed), HF loss, and magnetic hysteresis. Jiles-Atherton hysteresis has a published real-time model (ChowTape, DAFx 2019).

### Cited Findings
**Decapitator**
- A = Ampex 350 tape-machine preamp. E = Chandler/EMI TG channel. N = Neve 1057 input channel. T = Thermionic Culture Vulture triode setting. P = Culture Vulture pentode setting ("an overdriven pentode tube"). — [Soundtoys Decapitator manual](https://www.soundtoys.com/wp-content/uploads/Decapitator-Manual.pdf) (via search extract; copies at [Full Compass](https://www.fullcompass.com/common/files/33650-SoundToysDecapitatorManual.pdf), [B&H](https://www.bhphotovideo.com/lit_files/89645.pdf))
- E is described as "beefy in the lows and smooth in the highs". — [Music Guy Mixing](https://www.musicguymixing.com/decapitator-style/)
- Punish adds 20 dB of extra gain for heavy saturation. — [Decapitator manual](https://www.soundtoys.com/wp-content/uploads/Decapitator-Manual.pdf); [Produce Like A Pro](https://producelikeapro.com/blog/soundtoys-decapitator-grade-a-saturation/)
- Tone is a gentle sloping EQ from dark to bright, like an old AM-radio tone control. — [Decapitator manual](https://www.soundtoys.com/wp-content/uploads/Decapitator-Manual.pdf)
- Claim (unverified in the manual): T adds even harmonics and P adds odd harmonics. — [Music Guy Mixing](https://www.musicguymixing.com/decapitator-style/)

**Tape**
- Head bump: one forum account puts a typical 30 ips bump around 80 to 120 Hz, moving down about an octave at 15 ips. Endino's measurements show a bump near 35 Hz (15 ips, one machine) and 40 Hz (another machine), and 30 ips rolling off steeply below 70 Hz. — [Premier Rock Forum](https://premierrockforum.com/viewtopic.php?p=7128); [Jack Endino tape graphs](https://www.endino.com/graphs/)
- Higher speeds extend HF response but make LF roll-off worse. 30 ips LF reproduction is generally worse than 15 ips. — [Tangible Technology: Analog Tape overview](https://www.tangible-technology.com/media/media_2.html); [Richard Hess](https://richardhess.com/notes/2007/08/26/tape-speed-track-width-frequency-response-and-dynamic-range/)
- Chowdhury, "Real-Time Physical Modelling for Analog Tape Machines" (DAFx 2019): a physical model built from first principles and a real-time implementation for a Sony TC-260. — [DAFx archive](https://dafx.de/paper-archive/details/Z5Ow_E5YHVxvndTAyeEuzA)
- ChowTape uses the Jiles-Atherton hysteresis model, with selectable real-time solvers, a loss filter and playhead controls. It is GPLv3. — [ChowTape manual](https://ccrma.stanford.edu/~jatin/chowdsp/Products/ChowTapeManual.pdf); [GitHub AnalogTapeModel](https://github.com/jatinchowdhury18/AnalogTapeModel)
- The author says the model was later extended by comparing against Nagra, Ampex ATR and cassette machines. — [KVR thread](https://www.kvraudio.com/forum/viewtopic.php?p=7654507)
- Bias settings strongly affect LF recording and saturation. — [Mix: Analog Tape 101 part 3](https://www.mixonline.com/recording/analog-tape-101-part-3-bias-magic-373029)

### Inferences
- **Decapitator-like design:** per-style chain = pre-filter (style EQ) → drive gain → style nonlinearity (asymmetric triode for T; harder, more symmetric clip for P; transformer/console soft clip for N and E; tape curve for A) → Tone tilt (1st-order shelving pair around 1 kHz, opposite gains) → Low/High Cut → auto output trim → Mix. Punish = +20 dB at the drive input.
- **Tape for live vocals:** use a memoryless soft clip (tanh/arctan, 3rd-dominant, symmetric) plus a light hysteresis term, a head-bump peaking filter (about +1 to 3 dB at 40 to 100 Hz, Q around 1 to 2, with a dip below it), and an HF loss low-pass/shelf. Drop wow/flutter for live monitoring, because pitch modulation is distracting in headphones. The Jiles-Atherton solve costs CPU and, in ChowTape, typically needs oversampling, which costs latency (see DSP section).
- ChowTape is GPLv3. Its code cannot be copied into a closed-source app. The DAFx paper's equations can be re-implemented independently.

### Gaps
- Decapitator Low/High Cut ranges, Thump, Auto, and Steep behaviour, and whether it oversamples, could not be read (soundtoys.com was unreachable).
- No authoritative Ampex/Studer harmonic-versus-level measurements (e.g. MOL 3% third harmonic points) were retrieved.

---

## Tube vs transformer vs op-amp vs tape saturation: transfer curves, even/odd harmonics, growth with drive, frequency dependence

### Takeaway
Asymmetry (single-ended triode, class-A transistor, DC-biased transformer) produces even harmonics, mainly the 2nd. Symmetric clipping (push-pull, op-amp at the rails, tape, unbiased transformer) produces odd harmonics, mainly the 3rd. Transformer saturation is strongest at low frequency and high level, because core flux is the integral of voltage. "Tube = even = warm, transistor = odd = harsh" is folklore that depends on topology and level.

### Cited Findings
- A single-ended stage produces even as well as odd harmonics. Push-pull's odd-symmetric transfer curve cancels the even terms. — [Wikipedia: Tube sound](https://en.wikipedia.org/wiki/Tube_sound)
- "Tubes even, transistors odd" is called "enduring audio folklore". Topology and level matter more. — [Till: device distortion](https://till.com/articles/devicedistortion/)
- Solid-state clipping produces many high-order odd harmonics. Tubes tend toward lower-order content. Op-amp third harmonic rises steeply near clipping. — [Hamm, "Tubes vs Transistors" part 2](https://www.butleraudio.com/tubesvstrans2.html)
- A transformer model block is an integrator (voltage → flux) with flux passed to a differentiator. Core area mostly affects LF handling (anecdotal, developer forum). — [Eventide forum](https://www.eventideaudio.com/?p=184528)
- A DC bias on a modelled transformer core adds second harmonics (Airwindows Coils). — [Airwindows: Coils](https://airwindows.com/coils)
- Commercial transformer models claim to model magnetic saturation, core loss and hysteresis. — [DeeTrans (KVR)](https://www.kvraudio.com/product/deetrans-by-dotec-audio/details); [AnyTesla (GearNews)](https://www.gearnews.com/sknote-announces-the-anytesla-audio-transformer-modelling-plug-in)

### Inferences
- **Growth with drive (standard result):** for a smooth memoryless nonlinearity, at low drive the nth harmonic grows about n dB per 1 dB of input. The 2nd rises at 2 dB/dB and the 3rd at 3 dB/dB, so relative to the fundamental, H2 rises at 1 dB/dB and H3 at 2 dB/dB. This is why light console colour is 2nd-dominant and odd harmonics take over as you push. Near hard clipping, the spectrum flattens out (square-wave-like, 1/n odd series).
- **Triode model:** an asymmetric curve, e.g. y = tanh(k(x + b)) - tanh(kb), or a Koren-style triode equation, with b > 0 for asymmetry. Add a slow DC-blocking HPF (~5 to 20 Hz) after it. A small bias b gives a clean 2nd.
- **Transformer model:** flux φ = leaky_integral(v). Saturate φ (tanh or Langevin curve, optional Jiles-Atherton hysteresis). Output v_out = differentiate(φ_sat). Because φ ∝ V/f, distortion rises roughly 6 dB per octave toward low frequencies at constant level. This is the "transformer weight on low end" effect. HF is barely touched. Tune the integrator leak so it is stable at DC.
- **Tape:** a symmetric (3rd-dominant) soft curve plus hysteresis (phase lag and level-dependent "memory"), with pre-/de-emphasis (record EQ boosts HF before saturation, playback cuts it). This makes HF saturate earlier than LF.
- **Op-amp:** linear until close to the rails, then hard clip. Model with hard clip plus ADAA, or a high-order polynomial knee.

### Gaps
- No peer-reviewed measured harmonic spectra (H2/H3 vs level vs frequency) for a specific transformer (Marinair, Carnhill, Jensen) or tube stage were retrieved in this session.

---

## DSP modelling methods with zero lookahead and under 2 ms latency

### Takeaway
Build each colour as memoryless waveshapers (with ADAA) wrapped in linear filters (pre/de-emphasis, flux integrator/differentiator, EQ). For anti-aliasing, prefer ADAA at 1x or with 2x oversampling through minimum-phase polyphase IIR half-band filters (a few samples of delay). Avoid linear-phase FIR oversamplers, which add tens of samples. For EQ near Nyquist, use matched biquads (Vicanek/Massberg/Orfanidis) instead of plain bilinear RBJ.

### Cited Findings
**ADAA**
- ADAA was introduced by Parker, Zavalishin and Le Bivic (Native Instruments), "Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time Convolution", DAFx-16. — [CCRMA ADAA notebook (Chowdhury)](https://ccrma.stanford.edu/~jatin/Notebooks/adaa.html); [Vicanek: AA distortion note](https://www.vicanek.de/articles/AADistortion.pdf)
- Bilbao, Esqueda, Parker and Välimäki, "Antiderivative Antialiasing for Memoryless Nonlinearities", IEEE Signal Processing Letters vol. 24 (2017): higher-order antiderivatives improve SNR over first-order. — [Aalto repository](https://aaltodoc.aalto.fi/items/a46ae786-3014-4c49-a409-957b4c330bcd); [Esqueda et al. Appl. Sci. 2017](https://acris.aalto.fi/ws/portalfiles/portal/16820117/esqueda_et_al_applsci_07_01328_v2_1.pdf)
- ADAA needs the analytic antiderivative of the nonlinearity, which can be hard without a symbolic solver. — [DAFx25 paper 30](https://dafx25.dii.univpm.it/wp-content/uploads/2025/08/DAFx25_paper_30.pdf)

**Oversampling**
- Polyphase IIR half-band filters built from cascaded allpass sections (musicdsp.org code, many ports). IIR is minimum-phase with low latency, with some phase compromise near Nyquist. FIR is linear-phase with higher latency. — [musicdsp.org polyphase filters](https://www.musicdsp.org/en/latest/Filters/39-polyphase-filters.html); [synfx-dsp source](https://docs.rs/crate/synfx-dsp/latest/source/src/oversampling.rs); [aloe-oversampling](https://lib.rs/crates/aloe-oversampling)
- A half-band filter is down 6 dB at its cutoff (fs/4), so it lets a small amount of aliasing through. — [Losada, Digital Filters with MATLAB](https://ocwitic.epsem.upc.edu/assignatures/se/recursos/digital-filters-with-matlab-ricardo-a-losada.pdf)
- Practitioners report that JUCE's polyphase IIR oversampler works with minimal latency even at high factors (forum opinion). — [KVR thread](https://www.kvraudio.com/forum/viewtopic.php?p=9161140)

**EQ near Nyquist**
- Vicanek, "Matched Second Order Digital Filters" (2016): bilinear designs cramp near Nyquist. Matching is done by modifying the analog prototype so the magnitude at Nyquist matches the analog value. It builds on Orfanidis and discusses Massberg. — [Vicanek BiquadFits.pdf](https://www.vicanek.de/articles/BiquadFits.pdf); [Vicanek ShelvingFits.pdf](https://www.vicanek.de/articles/ShelvingFits.pdf); [Vicanek 2-pole shelving fits](https://www.vicanek.de/articles/2poleShelvingFits.pdf)

**Physical models**
- Real-time Jiles-Atherton hysteresis with selectable solvers is demonstrated in ChowTape. — [ChowTape manual](https://ccrma.stanford.edu/~jatin/chowdsp/Products/ChowTapeManual.pdf)

### Inferences (implementation recipes; standard DSP derivations, not quoted)
- **Latency budget:** 2 ms = 96 samples at 48 kHz (88 at 44.1 kHz). Memoryless shapers and biquads add zero lookahead. First-order ADAA adds a half-sample delay. A 2x polyphase IIR up/down pair (e.g. a 2-path, 6-to-8-coefficient allpass half-band) adds only a few samples of group delay in the passband, well inside the budget. A linear-phase FIR half-band with 60 dB+ rejection costs tens of samples per stage, so it is not recommended here.
- **First-order ADAA:** y[n] = (F1(x[n]) − F1(x[n−1])) / (x[n] − x[n−1]). If |x[n] − x[n−1]| < ε (≈1e-5), use y = f((x[n]+x[n−1])/2). Antiderivatives: tanh → F1 = log(cosh x) (for large |x| use |x| − log 2 to avoid overflow). Hard clip → F1 = x²/2 inside ±1, ±x − 1/2 outside. Asymmetric shapes → integrate piecewise. ADAA attenuates highs slightly (a sinc-like droop), so compensate with a gentle high shelf if needed.
- **Recommended structure per colour:** [DC block] → pre-emphasis (shelf) → drive → (2x IIR oversample) → ADAA shaper(s) → (downsample) → de-emphasis (inverse shelf) → transformer stage → EQ (matched biquads) → output trim (auto gain ≈ 1/drive, smoothed) → dry/wet mix (dry must be delayed by the same few samples to avoid comb filtering).
- **Pre/de-emphasis:** a high shelf boost before the shaper and the exact inverse after it make HF saturate first (tape/"bright" drive). A low-shelf version makes LF saturate first. This is a cheap stand-in for transformer behaviour when the integrator model is too costly.
- **Transformer stage (cheap):** split at around 100 to 200 Hz with a 1st-order complementary pair. Saturate only the LF branch with level-dependent drive (∝ 1/f emerges naturally if you saturate a leaky-integrated signal and differentiate). Add a tiny DC bias to the shaper for H2.
- **Proportional-Q / inductor EQ:** RBJ peaking/shelf biquads with Q = g(gain, fc). Recompute coefficients per block with parameter smoothing, or use TPT/SVF (Zavalishin) topologies so that changing Q per sample does not zipper. For the 12 kHz (1073) and 10 to 15 kHz (API) shelves at 44.1/48 kHz, use Vicanek or Massberg matched designs to avoid cramping.
- **Wave digital filters:** suit circuit-accurate models (triode stage plus output transformer). They are zero-latency in principle but cost more CPU, and nonlinear elements need iterative solves. For a phone/web app, the "shaper + filters" approach is the practical choice.

### Gaps
- The RBJ cookbook, Pirkle, and Zölzer were not fetched this session. Exact formulas above are standard but should be checked against the cookbook text.
- No measured comparison was found of aliasing for ADAA-at-1x versus 2x IIR oversampling on vocal material.

---

## Published measurements of these units (harmonic spectra, frequency response plots)

### Takeaway
Very little is published. Measured tape frequency responses (head bump) exist from Jack Endino. Neve, API and JHS publish specs but no harmonic spectra. Community model projects (EQ1979) compare curves against UAD plug-ins rather than hardware.

### Cited Findings
- Jack Endino's tape machine frequency-response graphs (head bump positions at 15/30 ips). — [Endino graphs](https://www.endino.com/graphs/)
- McKnight, "Frequency Response of Magnetic Recorders" (classic reference on tape response). — [McKnight PDF](https://www.discolathe.com/.pdfs/McKnight_freq-resp-of-mag-recorders.pdf)
- EQ1979 JSFX curve comparisons against UAD 1073. — [Belles Ondes EQ1979](https://www.bellesondes.fr/wiki/doku.php?id=eq1979)
- R&S notes that similar THD values can hide very different individual-harmonic profiles, so measure H2, H3 and so on separately. (Context is power transformers.) — [Rohde & Schwarz K-factor](https://www.rohde-schwarz.com/se/_258787.html)

### Inferences
- The practical path is to measure your own references. Run sine sweeps and stepped-level sines through the UAD/Waves plug-ins (or hardware, if available), extract H2..H7 versus level and frequency, and fit shaper and filter constants to the result.

### Gaps
- No harmonic-spectrum measurements were found for: the Neve 1073, API 512c/550A, SSL E/G, the JHS Colour Box, or Decapitator styles.
- Network limits: soundtoys.com, ams-neve.com and jhspedals.info must be allowed in the session's network settings to read the manuals in full.

---

## Verification pass (Nov 2026): corrections and confirmations

- **JHS Colour Box V2 [read]** — [JHS V2 page](https://jhspedals.info/products/colour-box-v2):
  - Step: "1st is +18 dB, 2nd is +23 dB, 3rd is +28 dB, 4th is +33 dB, 5th is +39 dB", applied to "each preamp stage".
  - Pre-Vol "controls the amount of gain between the two internal gain stages" and acts as drive; Master sets the overall volume.
  - Treble ±15 dB, Middle ±10 dB, Bass ±15 dB, all "flat at noon".
  - Shift: Treble 2–30 kHz, Middle 150 Hz–2.4 kHz, Bass 20–440 Hz (each moves the "center Freq").
- **Correction (V2 Hi-Pass slope):** "The HPF is a 2nd order 12dB per octave high pass filter", with the −3 dB cutoff adjustable from 160 Hz to 650 Hz. The 6 dB/oct reading was wrong.
- **Added [read] (V2 features):**
  - a **Hi/Lo switch** (Lo for clean headroom; Hi "will distort much more readily");
  - an output transformer;
  - a −20 dB pad that "only works when in XLR input mode";
  - safe 48 V phantom pass-through;
  - an INST/XLR selector;
  - version history: V1 has a "smaller enclosure; no 'shift' EQ knobs; seven knobs total". The V1 product page has no description, so V1 steps and EQ points remain unconfirmed.
- **Colour Box 500 [read]:** step "18db, 23db, 28db, 32db, or 37db"; the core is "two cascaded Neve BA283 stages as found in the Neve 1073 preamps"; Carnhill VTB9046 input transformer. — [JHS Colour Box 500](https://jhspedals.info/products/colour-box-500)
- **Neve 1073 [read]** — [AMS Neve 1073](https://www.ams-neve.com/outboard/1073-range/1073-mic-preamp-equaliser/):
  - mic gain "+80db to +20dB in 5dB steps"; line input 10 kΩ, +20 to −10 dB;
  - HF "+/-16dB fixed frequency shelving at 12kHz";
  - LF "+/-16dB shelving" at 35/60/110/220 Hz (**the ±16 dB low-shelf gain was missing before**);
  - mid "+/-18dB peaking, fixed 'Q'" at 0.36/0.7/1.6/3.2/4.8/7.2 kHz;
  - HPF "18dB per octave", 50/80/160/300 Hz;
  - Marinair 10468 mic and 31267 line input transformers; LO1166 gapped output transformer;
  - "three distinct gain stages provided by two independent transistor-based preamplifiers".

  The 1073LB page (ams-neve.com without "www") was refused, so its exact wording is still [excerpt].
- **Decapitator manual [read]** — [Decapitator manual](https://www.soundtoys.com/wp-content/uploads/Decapitator-Manual.pdf):
  - styles A = Ampex 350 tape preamp, E = Chandler/EMI TG, N = Neve 1057, T = Culture Vulture triode, P = Culture Vulture pentode;
  - Punish "adds an extra 20db of gain".
- **Correction (Decapitator signal order):** Low Cut acts "before they hit the (virtual) saturation circuit"; Thump adds "a few dB of low frequency boost right at the Low Cut frequency"; Tone (AM-radio/tilt) "alters the sound before the saturation section"; High Cut "operates AFTER the saturation section". Steep switches High Cut from 6 dB/oct to 30 dB/oct. Auto lowers Output as Drive rises, and Mix blends dry and wet. The manual gives no numeric Low/High Cut ranges and does not mention oversampling. The earlier inferred chain (tilt and low/high cut after the nonlinearity) is therefore wrong. Use: Low Cut (+Thump) → Tone → drive → style → High Cut → auto-trim → mix.
- Still unverified: the UA WebZine 2006 EQ article (URL now 404) and the API 550A brochure (host not allowed).
