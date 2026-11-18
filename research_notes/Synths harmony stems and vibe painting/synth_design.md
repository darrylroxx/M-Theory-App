# Yamaha reface CS and an "improved reface CS for beginners" (virtual-analogue synth for M-Theory)

Legend: [SRC] read from source; [CALC] computed/decoded/designed by me; [SEC] secondary/search summary.
Licence tags: **GPL-OK** = code/data portable into GPL-3.0-or-later; **REF-ONLY** = formula/idea reference only (proprietary manual, no licence, non-redistributable).
Network note (2026-11-18): usa.yamaha.com, de.yamaha.com, data.yamaha.com, manualslib.com, manualshive.com, yamahasynth.com, en.wikipedia.org, synthtopia.com and web.archive.org were blocked from this sandbox (proxy 403 / DNS). Everything about the hardware below comes from (a) open-source GitHub code and data files that transcribe Yamaha's reface Data List and Owner's Manual, and (b) WebSearch summaries [SEC]. Product, company and preset names only; no people, bands, songs or labels.

## 1. reface CS architecture: every control, its range and what it does

### Takeaway
The reface CS sound is just 17 front-panel values (plus a MIDI-only volume): one 8-voice engine with five oscillator algorithms whose two shared knobs (Texture, Mod) change meaning per algorithm, one resonant low-pass filter, one ADSR shared by amp and filter (blended by an EG Balance slider), one LFO with five destinations, one effect at a time, a portamento slider whose zero position means POLY, and a note-data phrase looper. It has no patch memory, no velocity response in the engine and no key-tracking control: the obvious places to "improve" it.

### Cited Findings
**Complete parameter table (tone generator block, Yamaha reface Data List, transcribed in GPL/MIT code)**
- [SRC] Tone-generator block base address `30 00 00`, 22 bytes; offsets: 00 Volume (0-127, MIDI-set only), 01 reserved, 02 LFO Assign (0-4: Off, Amp, Filter, Pitch, Osc), 03 LFO Depth, 04 LFO Speed, 05 Portamento, 06 OSC Type (0-4: Multi-saw, Pulse, Oscillator Sync, Ring Modulation, Frequency Modulation), 07 Texture, 08 Mod, 09 Cutoff, 0A Resonance, 0B EG Balance ("AEG max .. FEG max"), 0C Attack, 0D Decay, 0E Sustain, 0F Release, 10 Effect Type (0-4: Distortion, Chorus/Flanger, Phaser, Delay, Off/Thru), 11 Effect Depth, 12 Effect Rate, 13-15 reserved. All continuous values 0-127. — [harpomaxx/reface-cs-live RefaceProtocol.kt, MIT, GPL-OK](https://github.com/harpomaxx/reface-cs-live/blob/main/app/src/main/java/com/refacecslive/protocol/RefaceProtocol.kt); [ccbxxy/sysex CS.csv, no licence found, REF-ONLY](https://github.com/ccbxxy/sysex/blob/HEAD/data/yamaha/reface/CS.csv); [sterudo/refaceCS docs/reface-cs-midi.md, no licence, REF-ONLY](https://github.com/sterudo/refaceCS/blob/main/docs/reface-cs-midi.md)
- [SRC] Control-change map (MIDI Control = On): LFO Assign CC78, LFO Depth CC77, LFO Speed CC76, Portamento CC20, OSC Type CC80, Texture CC81, Mod CC82, Cutoff CC74, Resonance CC71, EG Balance CC83, Attack CC73, Decay CC75, Sustain CC79, Release CC72, Effect Type CC17, Effect Depth CC18, Effect Rate CC19. — [cfenell/cs-control cs_control.py, GPL-3.0, GPL-OK](https://github.com/cfenell/cs-control/blob/master/modules/cs_control.py); [pencilresearch/midi reface CS.csv](https://github.com/pencilresearch/midi/blob/main/Yamaha/reface%20CS.csv)
- [SRC] Five-way selectors are read in zones 0-25 / 26-51 / 52-76 / 77-102 / 103-127 (representative values 0, 32, 64, 95, 127) for LFO Assign (Off, Amp, Filter, Pitch, Oscillator), OSC Type (Multi-saw, Pulse, Oscillator sync, Ring modulation, Frequency modulation) and Effect Type (Distortion, Chorus/flange, Phaser, Delay, Off). — [pencilresearch/midi](https://github.com/pencilresearch/midi/blob/main/Yamaha/reface%20CS.csv); [cfenell/cs-control](https://github.com/cfenell/cs-control/blob/master/modules/cs_control.py)
- [SRC] Portamento: value 0 = Polyphonic; 1-127 = Mono with portamento time (the slider's bottom is a POLY detent; any raise switches to mono-with-glide). — [pencilresearch/midi](https://github.com/pencilresearch/midi/blob/main/Yamaha/reface%20CS.csv); [ccbxxy/sysex "0;1..127 poly;mono_time"](https://github.com/ccbxxy/sysex/blob/HEAD/data/yamaha/reface/CS.csv)
- [SRC] SysEx: parameter change `F0 43 1n 7F 1C 03 30 00 <offset> <value> F7`; dump request `F0 43 2n 7F 1C 03 0E 0F 00 F7`; a stored patch is a 61-byte .syx (header block 0E 0F 00 + tone block + footer 0F 0F 00); checksum = (−sum(model…data)) & 0x7F. Program Change is not supported by the CS; system parameters include Tempo 30-300 BPM, Master Transpose ±12, pitch-bend range ±24 semitones, Master Tune ±102.4 cents; MIDI clock in switches to external sync and falls back after ~3 s; identity reply `F0 7E 7F 06 02 43 00 41 51 06 00 00 00 7F F7`. — [harpomaxx RefaceProtocol.kt](https://github.com/harpomaxx/reface-cs-live/blob/main/app/src/main/java/com/refacecslive/protocol/RefaceProtocol.kt); [sterudo reface-cs-midi.md](https://github.com/sterudo/refaceCS/blob/main/docs/reface-cs-midi.md)
- [SRC] The hardware has no user patch memory: storing sounds needs Yamaha's iOS app or the Soundmondo web service (or third-party sysex tools). — [cfenell/cs-control README](https://github.com/cfenell/cs-control/blob/master/README.md)

**Per-oscillator meaning of Texture and Mod (manual wording, via GitHub paraphrase and search excerpts)**
- [SRC] Multi-saw: Texture "adds an octave-lower sub-oscillator"; Mod "layers multiple sawtooth waveforms for a thicker sound". Pulse: Texture "changes the pitch of the second square wave"; Mod "changes pulse width". Sync: Texture "changes OSC2 pitch and tone"; Mod "sets the amount of OSC2 pitch change". Ring: Texture "changes OSC1 pitch"; Mod "changes OSC2 pitch". FM: Texture "sets the modulation amount"; Mod "changes the pitch of the modulator oscillator (OSC2)". — [sterudo/refaceCS help-content.js, REF-ONLY](https://github.com/sterudo/refaceCS/blob/main/src/help-content.js)
- [SEC] Same mapping in manual excerpts surfaced by search: Pulse Texture = pitch of second square wave, Mod = pulse width, LFO→OSC gives PWM; FM Texture = modulation amount, Mod = modulator pitch, manual says FM gives "intense harmonics like those of the DX7"; Sync Texture = OSC2 pitch and tone, Mod = OSC2 pitch-change amount. — [Strait Music listing quoting manual](https://straitmusic.com/p-38148-yamaha-reface-cs-mobile-mini-modeling-synthesizer.aspx); [Yamaha reface CS page](https://usa.yamaha.com/products/music_production/synthesizers/reface/reface_cs.html)
- [SEC] CONFLICT: a Sonic State hands-on describes Ring Mod as Texture = ring depth and Mod = tune OSC2 (manual: Texture = OSC1 pitch). One yamahasynth.com article says Multi-saw Texture = "output level of Oscillator 2" (manual: octave-lower sub-oscillator; both readings = level of a second, lower oscillator). Manual wording preferred. — [Sonic State](https://sonicstate.com/news/2015/09/18/sonic-lab-yamaha-reface-cs-virtual-analog/); [Yamaha product page](https://usa.yamaha.com/products/music_production/synthesizers/reface/reface_cs.html)
- [SRC] LFO Assign: OFF; AMP = volume (tremolo); FILTER = cutoff (wah); PITCH = oscillator pitch (vibrato); OSC = type-dependent target: Multi-saw → pitch of the saws but not the sub-oscillator; Pulse → pulse width (PWM); Sync and Ring → OSC2 pitch; FM → FM amount. LFO controls are Depth and Speed only (no shape selector on the panel). — [sterudo help-content.js](https://github.com/sterudo/refaceCS/blob/main/src/help-content.js)

**Filter, EG, effects, keys, looper**
- [SRC] Filter: a single resonant low-pass with Cutoff and Resonance only (no key-tracking, envelope-amount or filter-type control exists in the parameter table). — [sterudo help-content.js](https://github.com/sterudo/refaceCS/blob/main/src/help-content.js); [CALC] from the 17-parameter table above.
- [SRC] EG: one Attack/Decay/Sustain/Release set drives both amplitude EG (AEG) and filter EG (FEG). EG Balance: one end = AEG maximised and FEG no effect; other end = FEG maximised; middle = equal influence; "zero AEG influence is not the same as muting the note: the note gate remains" (at the FEG end the amplitude becomes an on/off gate). — [sterudo help-content.js](https://github.com/sterudo/refaceCS/blob/main/src/help-content.js); CC83 named "EG FEG-AEG balance" [pencilresearch](https://github.com/pencilresearch/midi/blob/main/Yamaha/reface%20CS.csv)
- [SRC] Effects: one at a time; Depth = intensity/wet amount; Rate = distortion tone (DIST), modulation rate (CHO/FLA and PHASER), delay time (DELAY). Chorus/Flanger and Phaser are Yamaha "VCM" models. — [sterudo help-content.js](https://github.com/sterudo/refaceCS/blob/main/src/help-content.js); Data List note "effect-dependent: distortion tone, modulation rate, or delay time" [sterudo reface-cs-midi.md](https://github.com/sterudo/refaceCS/blob/main/docs/reface-cs-midi.md)
- [SRC] Keyboard/voices: 37 HQ mini keys, eight-note polyphony, mono/portamento available. — [sterudo help-content.js](https://github.com/sterudo/refaceCS/blob/main/src/help-content.js)
- [SEC] The synth engine is not velocity sensitive (keys still send velocity over MIDI). — [Synthtopia review](https://www.synthtopia.com/content/2015/09/22/yamaha-reface-cs-review-a-powerful-menu-free-minisynth/)
- [SEC] Phrase Looper: up to ~2,000 notes or ten minutes at 120 BPM; LOOPER slider CLEAR erases, REC arms (recording starts on the first key, "Key-on Start" is the only start method on the CS, with a guide click), PLAY ends recording and loops, REC again overdubs (no guide sound); the TEMPO slider changes tempo after recording; on the CS the OSC, FILTER and EG sliders keep shaping the looped phrase (it stores notes, not audio). — [reface manual mirror, manualsdir](https://www.manualsdir.com/manuals/848899/yamaha-reface-yc.html?page=20)
- [SEC] Looper drawbacks cited by a reviewer: loops use one sound and cannot be saved. — [BBoy Tech Report review](https://www.bboytechreport.com/2016/07/06/yamaha-reface-cs-review/)

**How it sounds (reviews)**
- [SEC] Goes "from supersaw trance sounds to pulse-width modulated string sounds to clangorous ring modulated sounds" without menus. — [Synthtopia](https://www.synthtopia.com/content/2015/09/22/yamaha-reface-cs-review-a-powerful-menu-free-minisynth/)
- [SEC] Solid bass from the saw + sub-oscillator; one effect at a time is limiting; "fast, fun". — [Sound On Sound](https://www.soundonsound.com/reviews/yamaha-reface-series)
- [SEC] Users say the VA engine sounds close to analogue; reviewers frame it as a modern portable take on the CS-80 line. — [Sweetwater user reviews](https://www.sweetwater.com/store/detail/RefaceCS--yamaha-reface-cs-virtual-analog-synth-with-mini-keys/reviews); [Wikipedia (search summary)](https://en.wikipedia.org/wiki/Yamaha_Reface_CS)

### Inferences
- [CALC] Strengths to keep: every sound reachable from one flat panel; per-algorithm reuse of two knobs; shared ADSR + balance (one gesture shapes both brightness and loudness); POLY detent on the glide slider; looper that keeps responding to sound edits.
- [CALC] Weaknesses to fix for beginners: no presets/patch memory; no velocity; no key tracking (low-pass sounds get dull up the keyboard); single effect; no reverb; LFO shape fixed; one envelope means a pluck with a long amp release but short filter decay is impossible.
- [CALC] Slider scaling: the protocol is linear 0-127 for every continuous control; the physical-to-sound curves (Hz, seconds, cents) are not published in any source reachable here, so M-Theory must choose its own curves (proposed in section 7).

### Gaps
- Exact curves (cutoff Hz, EG seconds, LFO Hz, glide time, delay time ranges), filter slope (12 vs 24 dB/oct) and whether it self-oscillates, LFO waveform, number of saws in Multi-saw and detune range, interval range of Pulse Texture, Ring/Sync/FM ratio ranges, Chorus vs Flanger switching rule inside one effect type, and whether MONO is legato (no retrigger) could not be confirmed: Yamaha manual and Data List PDFs were unreachable (403/DNS). A search for reface CS filter self-oscillation returned nothing relevant.

## 2. Open-source emulations, editors and sysex tables of the reface CS

### Takeaway
There is no faithful open-source DSP emulation; the useful open material is parameter tables (sysex/CC, value zones, defaults) and librarian/editor UX, the best-licensed being cfenell/cs-control (GPL-3.0) and harpomaxx/reface-cs-live (MIT).

### Cited Findings
- [SRC] GitHub search "reface cs" (2026-11-18): matthewcieplak/reface_midi (GPL-3.0, hardware patch-change box), cfenell/cs-control (GPL-3.0, Python CC/sysex get/set), beltsonata/reface-amidi (GPL-3.0, amidi librarian), csik/reface (GPL-3.0), Vladdudu12/Yamaha-Reface-CS-Master-Omnibus (no licence), sterudo/refaceCS (no licence), harpomaxx/reface-cs-live (MIT), cashimor/yamahabox (GPL-3.0), odinndagur/reface-cs-addington (no licence, TODO notes only), iman1000000/midi-util (MIT, WebMIDI controller). — [GitHub repository search](https://github.com/search?q=reface+cs&type=repositories)
- [SRC] harpomaxx/reface-cs-live (MIT, GPL-OK with notice): editor for "all 17 voice controls", 61-byte .syx import/export, validates manufacturer/model/address/byte count/checksum, throttled live sysex editing, setlists. — [README](https://github.com/harpomaxx/reface-cs-live/blob/main/README.md)
- [SRC] sterudo/refaceCS (Vite web app, no licence, REF-ONLY): browser panel, arpeggiator, phrase looper with quantise, drum step sequencer, patch library, and a "SuperKnob" macro (one knob, per-parameter drawn curves, default = cutoff only, record a fader sweep into a curve, cycle/tempo-sync). Its own "Simple Soft Synth" is explicitly "not a recreation of the hardware sound": Saw Texture = octave-lower sub-oscillator level, Pulse Texture = width 50/50 to 90/10. — [README](https://github.com/sterudo/refaceCS/blob/main/README.md); [help-content.js](https://github.com/sterudo/refaceCS/blob/main/src/help-content.js)
- [SRC] stefan-cambodia/js-synth "yamaha-reface-cs.html" (no licence, REF-ONLY): toy Web Audio approximation with two OscillatorNodes per voice: Multi-saw Texture = sub octave, Mod = second detuned saw; Sync faked with osc2 = f·(1.5+5·texture); Ring osc2 = f·(0.5+3·texture); FM ratio 1+7·texture. Not faithful. — [file](https://github.com/stefan-cambodia/js-synth/blob/HEAD/classic/yamaha-reface-cs.html)
- [SRC] Vladdudu12 Omnibus (no licence, REF-ONLY): Web MIDI controller page with arp, Turing-machine sequencer and a "morph" over Texture, Mod, cutoff, resonance, LFO depth/speed, ADSR, effect depth/rate. — [engine.js](https://github.com/Vladdudu12/Yamaha-Reface-CS-Master-Omnibus/blob/HEAD/engine.js)
- [SRC] Other machine-readable reface CS CC maps exist (format/licence unverified): Morningstar-Engineering/openmidi `data/brands/yamaha/refacecs.yaml`, intonarumori/instruments `yamaha_reface_cs.json`, dliess/musicdevicedescriptions `MidiConfigs/Devices/Yamaha/Reface-CS/Config.json`, eokuwwy/open-midi-rtc-specs `reface-cs.yml`. — [GitHub code search](https://github.com/search?q=%22reface+CS%22+Texture&type=code)
- [SRC] ccbxxy CS.csv "default" column (Volume 127, LFO Amp, Depth 64, Speed 64, Portamento 1, Osc Pulse, Texture/Mod/Cutoff/Res/Balance 64, Attack 0, D/S/R 64, FX Off) is that repo's template default, not Yamaha's factory init. — [ccbxxy CS.csv](https://github.com/ccbxxy/sysex/blob/HEAD/data/yamaha/reface/CS.csv)

### Inferences
- [CALC] M-Theory can store a reface-style preset as exactly the same 17 fields (plus extras) and can export/import real reface CS .syx files by scaling 0..1 ↔ 0..127 (useful for hardware owners; interoperability facts; the MIT/GPL code above can be ported).
- [CALC] The "SuperKnob" (one knob → many parameters through curves) is the most beginner-relevant idea in the reface ecosystem; reimplement from the idea, not the unlicensed code.

### Gaps
- No open-source DSP measured against a real reface CS was found; sound-matching would need recordings of the hardware.

## 3. Preset design: beginner categories and concrete recipes (in reface-CS terms)

### Takeaway
Open synth libraries converge on the same beginner-readable categories (Bass, Lead, Pad, Keys, Pluck, Brass, Strings, Bells/Mallets, Drone/Atmosphere, FX, Arp/Sequence). Decoded factory patches give consistent recipes: plucks = zero sustain + decaying filter envelope; brass = fast filter "blat" + full sustain + velocity-to-brightness; pads = slow attack + detuned saws or PWM + chorus; bells = inharmonic FM/ring + zero sustain; acid = high resonance + decaying filter envelope + mono glide.

### Cited Findings
**Category systems in open synths (counts [CALC] from repository trees)**
- [SRC] Surge XT factory patches (GPL-3.0 repo; no separate patch licence found → treat as GPL-3.0, GPL-OK): Basses 59, Brass 11, Chords 8, FX 27, Keys 16, Leads 131, MPE 9, Pads 65, Percussion 9, Plucks 111, Polysynths 104, Sequences 45, Splits 5, Templates 16 (Init Saw, Init Square, Init Sine, Init FM2, Init Wavetable, Init Modern, Init Arpeggiator, Init Duophonic, Init Paraphonic, Init Karplus-Strong, Init Env Per Osc, Init Experimental + 4 audio-in), Tutorials 14 (formula modulator), Vocoder 3, Winds 8. — [surge patches_factory](https://github.com/surge-synthesizer/surge/tree/main/resources/data/patches_factory); [LICENSE GPL-3.0](https://github.com/surge-synthesizer/surge/blob/main/LICENSE)
- [SRC] Helm factory presets (code GPL-3.0-or-later; presets: 269 files "licensed under a Creative Commons Attribution 4.0 International License", 5 files under GPL-3.0-or-later; folder LICENSE = CC BY 4.0): Arp 7, Bass 51, Chip 8, Harsh 3, Keys 43, Lead 37, Pad 40, Percussion 58, SFX 27. — [Helm presets + LICENSE](https://github.com/mtytel/helm/tree/master/patches/Factory%20Presets)
- [SRC] Odin2 factory soundbank (repo GPL-3.0; no separate soundbank licence found): Arps & Sequences 27, Atmospheres 24, Bass 15, Chimes 13, Chiptune 11, Drones 14, Drums 26, Instruments 16, Keys 17, Leads 20, Organ 10, Pads 29, SFX 21, Stabs 17 (.odin = binary JUCE ValueTree, not decoded). — [Odin2 Factory Presets](https://github.com/TheWaveWarden/odin2/tree/master/assets/Soundbanks/Factory%20Presets)
- [SRC] OB-Xf (successor of OB-Xd, "This repository and the source code is under GPL3"): patch folders Atmospheres, Basses, Bells, Brass, Drums, FX, Guitars, Keys, Leads, Mallets, Organs, Pads, Percussion, Plucks, Soundscapes, Strings, Voices, Winds; README notes OB-Xd's +12 semitone tuning offset (middle C ≈ 464 Hz) fixed on import. — [OB-Xf patches](https://github.com/surge-synthesizer/OB-Xf/tree/main/assets/installer/Surge%20Synth%20Team/OB-Xf/Patches); [README](https://github.com/surge-synthesizer/OB-Xf/blob/main/README.md)
- [SRC] Vital: source GPL-3.0, but "Do not distribute the presets that come with the free version of Vital… separate license that does not allow redistribution" → Vital presets unusable. — [Vital README](https://github.com/mtytel/vital/blob/main/README.md)
- ZynAddSubFX banks: not read in this session (licence and categories unverified).

**Decoded factory recipes used as grounding** ([CALC] decoded with my scripts. Helm units from [helm_common.cpp](https://github.com/mtytel/helm/blob/master/src/common/helm_common.cpp): env times stored 0-4, seconds = v²; cutoff = MIDI note 28-127; LFO and arp Hz = 2^v; glide s = 2^v; filter env depth in semitones. Surge units: env/glide s = 2^v, LFO Hz = 2^v, cutoff Hz = 440·2^(v/12), env1 = Amp EG and env2 = Filter EG (inferred from values); mod source ids from [ModulationSource.h](https://github.com/surge-synthesizer/surge/blob/main/src/common/ModulationSource.h): 1 velocity, 4 aftertouch, 6 mod wheel, 7-14 macros, 17 voice LFO1, 23 scene LFO1. Old Surge patches may store a pre-XT filter enum, so filter type names are approximate.)
- Helm "CM Supersaw": two saws × 5 unison voices, osc tunes ±0.12 st, sub saw 0.24, filter off, AEG A 0.01 s S 1 R 0.09 s, poly 4, delay 0.13 / reverb 0.15. [Helm](https://github.com/mtytel/helm/tree/master/patches/Factory%20Presets/Lead)
- Helm "CM Subsine": sine + sine −12 st + sine sub, cutoff ≈ 216 Hz, mono, glide 4 ms, drive +12 dB. Helm "CM Electro Bass": square + saw each 5-voice unison 14-16 cents, cross-mod 0.5, band filter res 0.59, filter env → cutoff −41 st, LFO → osc volumes.
- Helm "COA Acid Distorted Lead": mono, resonance 1.0, cutoff ≈ 891 Hz + filter env +51 st, FEG D ≈ 1.5 s S 0, distortion.
- Helm "CM Bells": triangle +36 st with 8-step wave +12 st, cross-mod 0.09, AEG D 0.59 s S 0, reverb 0.17. Helm "CM Pluck Time": square +24 / saw +12, AEG D 2.7 s S 0, delay 0.26, reverb 0.36.
- Helm "CM Soothing" pad: AEG A 4 s, FEG A 3.1 s → +24 st (slow swell). Helm "CM Stars": FEG A 7 s. Helm "CM Epic": saws ×3 unison 8 cents, A 0.35 s, drive, reverb 0.22, poly 16.
- Helm "COA Hard Brass Synth Ensemble": saws −12/+12 st, sub square 0.42, cutoff 70 Hz key-track 0.40, A 55 ms R 0.17 s, LFO tri 0.76 Hz. Helm "SF Arp 1": saw ×3, cutoff 452 Hz res 0.42, key-track 1.0, FEG D 0.29 s, AEG D 1.28 s S 0, arp Up, 1 octave, very short gate.
- Surge "Sync Lead": mono single-trigger, glide 10 ms, Classic osc with Sync 14.95 st swept +3.2 st by a scene LFO, ladder LP 2.17 kHz res 0.12, env +31 st, key 0.25, AmpEG A 4 ms D 125 ms S 0.87 R 31 ms, FiltEG D 1.29 s S 0.39, vibrato sine 6 Hz 0.56 st. [Surge Leads](https://github.com/surge-synthesizer/surge/tree/main/resources/data/patches_factory/Leads)
- Surge "Classic Lead 1": mono, glide 20 ms, drift 0.38, ladder LP 110 Hz res 0.56 env +37 st key 1.0, FiltEG A 78 ms D 318 ms S 0, vibrato tri 5 Hz, aftertouch → cutoff. Surge "Crisp PWM": LFO tri 1.12 Hz → shape, mod wheel → cutoff −60 st.
- Surge "Sawteeth" pad: 9 + 8 unison saws, LP12 84 Hz key 1.0 env +9 st, AmpEG A 0.18 s R 1.25 s, FiltEG A 1.8 s D 5.6 s S 0.66, Macro 1 → shape and sub mix. Surge "MKS-70 Warm Pad": two oscillators −1 octave ±0.08 st, AmpEG A ≈ 6.6 s R 1.8 s, FiltEG A 3.2 s. Surge "FM Pad": FM on, AmpEG A 2.8 s R 2 s, drift 0.26.
- Surge "Synth Brass 1": LP24 315 Hz key 0.91, env +24 st, velocity → cutoff +42 st, FiltEG A 4 ms D 2.1 s S 0, AmpEG A 6 ms S 1 R 0.16 s, vibrato 5.3 Hz.
- Surge "Nice Pluck 1": LP12 25 Hz + env +63 st (+36 by velocity), FiltEG D 1.35 s S 0.53, sub mix 1.0. Surge "Bell 1": AmpEG S 0 R 0.64 s, env +32 st by velocity, FiltEG D 56 ms. Surge "Simple PW": pulse width 0.29 + noise, LP12 + env +46 st, FiltEG D 1.23 s S 0, AmpEG R 2.65 s, LFO → width.
- Surge "DX EP": FM3 oscillator (M1 ratio 1 small amount, M2 ratio 19 "tine"), AmpEG D 1.8 s S 0.22 R 0.76 s, velocity → FM amounts and feedback. Surge "Ring Mayhem": second osc +0.66 st for beating, BP + notch filters, drive. Surge "Eighties Drone": mono, LP12 846 Hz res 0.64 key 1.0, mod wheel → cutoff +37 st.

**Recipes in reface-CS terms** ([CALC] designed from the decodes above and the manual semantics; values 0-127; "+" = improved-version extras)

Order: Osc | Texture | Mod | Cutoff | Res | EG Bal (0 = AEG only, 64 = both, 127 = FEG only) | A D S R | Portamento (0 = POLY) | LFO assign depth/speed | FX type depth/rate | + extras.

- **Bass**
  - Sub Bass: Pulse | 0 (2nd square in unison) | 0 (square) | 22 | 0 | 40 | 0 60 127 12 | 6 (mono, short glide) | Off | Dist 15/40 | + key-track 50%, velocity→amp 30% (ground: Helm CM Subsine, Surge Sub 1).
  - Acid Bass: Multi-saw | 0 | 0 (single saw) | 28 | 105 | 100 | 0 45 0 10 | 22 (mono glide) | Off | Dist 55/75 | + accent = velocity→filter env (ground: Helm Acid Distorted Lead).
  - Saw/Sub Bass: Multi-saw | 80 (strong sub) | 20 | 45 | 25 | 80 | 0 55 50 15 | 8 | Off | Off | + key-track 50%.
  - FM Bass: FM | 45 (index) | ratio 1:1 zone | 70 | 0 | 64 | 0 50 40 12 | 6 | Off | Dist 20/60 | + velocity→Texture.
- **Lead**
  - Supersaw Lead: Multi-saw | 30 | 100 | 110 | 10 | 20 | 0 64 127 20 | 10 (mono) or 0 | Pitch 8/75 (vibrato) | Delay 35/60 | + reverb 20% (ground: Helm CM Supersaw).
  - Sync Lead: Osc Sync | 70 | 60 | 92 | 20 | 64 | 0 50 100 20 | 10 | Pitch 8/75 | Dist 30/60 | + delayed vibrato (ground: Surge Sync Lead).
  - PWM Solo Lead: Pulse | 0 | 40 | 80 | 30 | 64 | 2 70 110 25 | 14 | Osc 35/55 (PWM) | Delay 30/55 (ground: Surge Crisp PWM, Classic Lead 1).
- **Pad**
  - PWM String Pad: Pulse | 8 (slight detune of 2nd square) | 50 | 70 | 10 | 40 | 70 80 110 80 | 0 | Osc 60/35 | Cho/Fla 70/30 | + reverb 35% (ground: review "PWM string sounds", Surge Simple PW).
  - Supersaw Warm Pad: Multi-saw | 25 | 90 | 55 | 15 | 60 | 60 100 100 85 | 0 | Filter 20/20 | Cho/Fla 60/25 | + reverb 40% (ground: Surge Sawteeth, Helm CM Epic).
  - Glass FM Pad: FM | 25 | ratio 2:1 zone | 80 | 0 | 50 | 85 90 110 95 | 0 | Osc 25/20 (FM-amount wobble) | Delay 40/80 (ground: Surge FM Pad).
- **Keys**
  - FM E-Piano: FM | 40 | ratio 1:1 zone | 75 | 0 | 64 | 0 85 25 50 | 0 | Amp 15/60 (tremolo) | Cho/Fla 35/30 | + velocity→Texture 60% (ground: Surge DX EP).
  - Square Organ: Pulse | +12 st zone (octave) | 0 | 100 | 0 | 0 | 0 0 127 6 | 0 | Pitch 4/90 | Phaser 40/35.
  - Poly Synth Keys: Multi-saw | 0 | 40 | 60 | 30 | 90 | 0 40 30 30 | 0 | Off | Delay 25/50 | + velocity→cutoff.
- **Pluck**
  - Saw Pluck: Multi-saw | 0 | 30 | 20 | 25 | 64 | 0 45 0 40 | 0 | Off | Delay 40/55 | + key-track 70%, reverb 25% (ground: Surge Nice Pluck 1, Helm CM Pluck Time).
  - Pulse Pluck: Pulse | +12 zone | 70 (narrow) | 30 | 20 | 70 | 0 38 0 35 | 0 | Off | Delay 35/45.
  - Harp-ish Pluck (for Strum mode): Pulse | 0 | 20 | 40 | 0 | 50 | 0 70 0 70 | 0 | Off | Cho/Fla 25/20 | + reverb 35%.
- **Brass**
  - Synth Brass: Multi-saw | 20 | 35 | 35 | 15 | 80 | 12 60 95 25 | 0 | Pitch 6/70 | Cho/Fla 30/30 | + velocity→cutoff 50%, key-track 90% (ground: Surge Synth Brass 1, Helm Hard Brass Ensemble).
  - Brass Stab: Multi-saw | 10 | 45 | 45 | 20 | 85 | 0 45 40 15 | 0 | Off | Off | + velocity→cutoff.
- **Strings**
  - Ensemble Strings: Pulse | 6 | 45 | 65 | 5 | 30 | 55 70 115 70 | 0 | Osc 55/40 | Cho/Fla 80/35.
  - Saw Strings: Multi-saw | 0 | 70 | 60 | 5 | 30 | 50 70 115 75 | 0 | Pitch 5/65 | Phaser 30/20.
- **Bells**
  - Ring-Mod Bell: Ring | 40 | non-integer zone (≈ ×2.76) | 100 | 0 | 30 | 0 90 0 80 | 0 | Off | Delay 35/60 | + reverb 40% (ground: review "clangorous ring modulated", Helm CM Bells, Surge Bell 1).
  - FM Bell: FM | 60 | ratio 3.5 zone | 110 | 0 | 20 | 0 100 0 90 | 0 | Off | Delay 30/70.
- **Drone**: Evolving Saw Drone and Ring Beating Drone (section 5).
- **FX/Texture**
  - Sync Riser: Osc Sync | 40 | 127 | 80 | 40 | 127 | 127 127 127 100 | 0 | Pitch 20/20 | Delay 60/90.
  - Ring Chaos: Ring | 100 | 90 | 90 | 50 | 64 | 30 80 90 80 | 0 | Pitch 100/120 | Phaser 60/80.
- **Arp**
  - Arp Pluck: Multi-saw | 0 | 20 | 40 | 50 | 100 | 0 30 0 20 | 0 | Off | Delay 45/dotted-1/8 | play mode Arp Up 1/16, 2 octaves, gate 50% (ground: Helm SF Arp 1).
  - Square Arp: Pulse | 0 | 90 (narrow) | 90 | 10 | 40 | 0 35 0 15 | 0 | Off | Delay 30/(1/8) | Arp Up-Down 1/16, 1 octave.

### Inferences
- [CALC] Show each preset as category + name + one-line description, with the reface panel underneath showing the same 17 values, so a beginner changes a working sound rather than starting from "init"; also ship "Init" per oscillator type, as Surge's Templates folder does.
- [CALC] Store presets as JSON in M-Theory (GPL-3.0-or-later). The recipe numbers above are original values informed by reading licensed presets, so they carry no third-party licence; any preset ported value-for-value from Helm must keep its CC BY 4.0 attribution (author field + licence) in metadata.

### Gaps
- ZynAddSubFX and OB-Xd/OB-Xf patch contents were not decoded (time); Odin2 binary presets not decoded.
- GPLv3 compatibility of CC BY 4.0 is stated from general knowledge of the FSF licence list (not fetched); verify before relying on it.

## 4. Macros for beginners

### Takeaway
Open synths expose 4 (Vital) to 8 (Surge) assignable macros; for a beginner page, 4-6 fixed, named macros with per-preset target curves (Brightness, Motion, Space, Grit, Width, Shape/Time) give most of the shaping with none of the routing.

### Cited Findings
- [SRC] Vital: `kNumMacros = 4`, alongside 8 LFOs, 6 envelopes, 4 random LFOs, 3 oscillators, 2 filters, max polyphony 33. — [vital synth_constants.h, GPL-3.0](https://github.com/mtytel/vital/blob/main/src/common/synth_constants.h)
- [SRC] Surge XT: 8 macro sources (ms_ctrl1..ms_ctrl8) plus per-note random (bipolar/unipolar), alternate, lowest/highest/latest key and release-velocity sources. — [ModulationSource.h, GPL-3.0](https://github.com/surge-synthesizer/surge/blob/main/src/common/ModulationSource.h); factory "Sawteeth" maps Macro 1 → oscillator shape + sub mix [CALC decode].
- [SRC] sterudo "SuperKnob": one knob; each assigned parameter has its own absolute curve (e.g. cutoff rising while resonance falls); default = cutoff only; curves can be recorded from a fader move; can cycle at a tempo-synced rate. — [sterudo help-content.js](https://github.com/sterudo/refaceCS/blob/main/src/help-content.js)
- [SEC] Arturia Analog Lab exposes four performance macros named Brightness, Timbre, Time and Movement; a user reports Brightness/Timbre mapped to cutoff/resonance ranges per preset (forum, not official documentation). — [KVR forum thread](https://www.kvraudio.com/forum/viewtopic.php?p=8296634)

### Inferences
- [CALC] Proposed fixed macro set (each macro = list of {target, from, to, curve} stored per preset, SuperKnob-style):
  - **Brightness**: Cutoff +0..+60 (exp curve), Resonance −10..0 (keeps loudness steady), EG Balance toward FEG +0..+20.
  - **Motion**: LFO Depth 0..80, LFO Speed 20..90, plus drift (random per-voice pitch ±0..8 cents).
  - **Space**: FX Depth 0..80 on the delay/chorus slot + reverb send 0..60%.
  - **Grit**: distortion drive 0..90, Texture +0..+30 (sub/index/sync push), Resonance +0..+20.
  - **Width**: Multi-saw Mod (spread) +0..+40, stereo spread of voices 0..100%, chorus depth.
  - **Shape/Time**: Attack 0..90 and Release 10..110 together (tight/short vs soft/long).
- [CALC] Render macros as large knobs above the reface panel; moving a macro visibly moves the underlying sliders (teaches what it does).

### Gaps
- Official Arturia/NI macro naming documentation could not be fetched; Vital's default macro assignments live in its non-redistributable presets.

## 5. Drones

### Takeaway
A drone is a sustained root (often + fifth + octave) held across chord changes, with very slow attack/release, slight detuning between layers for beating, and slow, non-repeating movement (very slow LFOs and random-walk drift on filter/macro values); open examples confirm the pattern (Odin2 has a Drones category; a GPL Web Audio drone uses 4 voices with small cent offsets and an "Evolve" random walk).

### Cited Findings
- [SRC] Odin2 ships a "Drones" category (14 presets) next to "Atmospheres" (24). — [Odin2 Factory Presets](https://github.com/TheWaveWarden/odin2/tree/master/assets/Soundbanks/Factory%20Presets)
- [SRC] Kalitragus/dronepigreco "Drone Machine π" (GPL-3.0, Web Audio, GPL-OK): four voices with default per-voice detune −1.4, +0.8, −2.1, +1.6 cents, pans −0.6/−0.2/+0.25/+0.6, gains 0.22/0.18/0.16/0.14, per-voice delays 0.28-0.5 s, shared low-pass (cutoff 4000 Hz, Q 0.7) whose changes are smoothed with setTargetAtTime (τ = 0.12 s), resonator bank; "Evolve" mode = a slow random walk on the macro controls so the drone moves for hours without repeating; voice ratios from mathematical constants with optional quantisation to the prime grid [2,3,5,7,11,13,17,19]. — [README](https://github.com/Kalitragus/dronepigreco/blob/HEAD/README.md); [drone.js](https://github.com/Kalitragus/dronepigreco/blob/HEAD/drone.js); [ALGORITHMS.md](https://github.com/Kalitragus/dronepigreco/blob/HEAD/ALGORITHMS.md)
- [SRC] Surge "Eighties Drone" (decoded): mono, glide 36 ms, LP12 ≈ 846 Hz res 0.64 key-track 1.0, mod wheel → cutoff +37 st (the player opens the filter by hand). Surge "Ring Mayhem": second oscillator +0.66 st for beating. — [CALC decode of Surge factory patches](https://github.com/surge-synthesizer/surge/tree/main/resources/data/patches_factory)

### Inferences
- [CALC] Drone recipes in reface terms:
  - Evolving Saw Drone: Multi-saw | Texture 70 (sub) | Mod 25 (slow beating) | Cutoff 45 | Res 35 | EG Bal 64 | A 110 D 127 S 127 R 120 | POLY | LFO Filter depth 35 speed 6 (≈ 0.05-0.1 Hz) | Phaser 40/10 or long Delay 50 | + random-walk drift on cutoff (±8) and per-layer detune ±2 cents.
  - Ring Beating Drone: Ring | Texture 10 | Mod just off unison (OSC2 ≈ +0.3 st) | Cutoff 60 | Res 20 | A 120 R 120 | LFO Osc depth 15 speed 5 | long Delay 45.
- [CALC] M-Theory "Drone" play mode: per section, hold the key's tonic (pedal) or each chord's root, layered root + fifth + octave (+ optional sub-octave); glide 300-800 ms between roots at chord changes; layer gains decreasing upward (like 0.22/0.18/0.16/0.14 above); per-layer random walk x += (rand − 0.5)·step every ~250 ms, clamped, smoothed with setTargetAtTime (τ ≈ 2 s).

### Gaps
- No measured study of "what makes a pleasant drone" was found; recipes are design proposals.

## 6. Ways of playing (arp, strum, chord memory, hold, glide, step patterns, humanise)

### Takeaway
On a grid where chords and melody are already written, the useful "ways of playing" are playback transformations of the written notes: Sustain (as written), Arp (Up/Down/Up-Down/Random/Crawl, tempo-synced 1/4-1/32 with triplets, 1-3 octaves, gate), Strum (up/down with spread in ms), rhythmic re-trigger (Pulse/Stab), Drone/pedal, and Glide/legato for melodies, plus Humanise; chord memory and hold/latch are live-keyboard aids that matter much less here.

### Cited Findings
- [SRC] Odin2 arpeggiator (GPL-3.0, GPL-OK): patterns Up, Down, UpAndDown, DownAndUp, Random (up pattern shuffled), CrawlUp, CrawlDown, CrawlUpDown, CrawlDownUp; Octaves (default 2), Steps (16-step sequence with per-step on/off, transpose in semitones, Mod1, Mod2), Gate % (default 0.5), sync time, one-shot. Crawl = sort held notes, extend over N octaves, then play a sliding window (length = number of held notes) moving one note at a time: C E G → C E G, E G C′, G C′ E′, C′ E′ G′. — [OdinArpeggiator.h](https://github.com/TheWaveWarden/odin2/blob/master/Source/gui/OdinArpeggiator.h); [OdinArpeggiator.cpp](https://github.com/TheWaveWarden/odin2/blob/master/Source/gui/OdinArpeggiator.cpp)
- [SRC] Odin2 factory "Harpstrum Up" / "Harpstrum Down" presets realise strums through the arp. — [Odin2 Arps & Sequences folder](https://github.com/TheWaveWarden/odin2/tree/master/assets/Soundbanks/Factory%20Presets/Arps%20%26%20Sequences)
- [SRC] Helm arp: pattern 0-4 (up, down, up-down, as played, random), octaves 1-4, gate 0-1, rate 2^(−1..4) Hz or tempo-synced divisions 32/1 … 1/64. — [helm_common.cpp](https://github.com/mtytel/helm/blob/master/src/common/helm_common.cpp); [helm_common.h](https://github.com/mtytel/helm/blob/master/src/common/helm_common.h)
- [SRC] Surge play modes decoded from factory patches: poly, mono, mono single-trigger (legato), mono fingered portamento (glide only when legato), mono ST+FP, latch; per-note random/alternate modulation sources usable for humanise. — [ModulationSource.h](https://github.com/surge-synthesizer/surge/blob/main/src/common/ModulationSource.h); [CALC] polymode values from patches
- [SRC] reface CS itself: POLY or MONO+glide only (no separate legato switch), no arpeggiator; third-party companions add arp, latch and looper quantise. — [pencilresearch CC20](https://github.com/pencilresearch/midi/blob/main/Yamaha/reface%20CS.csv); [sterudo README](https://github.com/sterudo/refaceCS/blob/main/README.md)

### Inferences
- [CALC] Priority for M-Theory (chords/melody already on a grid):
  1. **Sustain** (default): chord notes for their written length.
  2. **Arp**: Up, Down, Up-Down, Down-Up, Random, Crawl Up/Down, As Written (chord-tone order); rates 1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32; octaves 1-3; gate 10-100%; restart at each chord change; swing from the song.
  3. **Strum**: Down (low→high) / Up / Alternate per beat; spread 10-80 ms per note; velocity taper 0-30%.
  4. **Pulse/Stab**: re-trigger the whole chord on a rhythm (1/8, dotted 1/4, off-beat) with gate; turns pad chords into rhythmic synth parts.
  5. **Drone/Pedal**: section 5.
  6. **Glide/Legato** for melody tracks: mono, glide only when notes overlap (fingered portamento), 20-300 ms.
  7. **Humanise**: timing ±0-20 ms, velocity ±0-15%, per-note random cutoff ±0-6 st and pitch drift ±0-5 cents (Surge-style random source).
- [CALC] Chord memory and hold/latch are redundant on a grid (chords are stored and held already); a "tie chords" option (hold through rests until the next chord) covers the useful part. A 16-step pattern lane (Odin-style per-step on/off/accent/transpose) is a later, optional "Pattern" mode.

### Gaps
- No user study of which modes beginners use most was found; the ranking is a design judgement.

## 7. Implementation-ready design: "improved reface CS for beginners" in Web Audio (TypeScript)

### Takeaway
Keep the reface's 17-control panel and per-algorithm Texture/Mod semantics, implement the oscillators in one AudioWorklet (PolyBLEP saw/pulse with hard sync, ring, 2-op FM, 7-saw supersaw using published GPL supersaw constants), and add the beginner layer on top: categorised presets, 4-6 macros, play modes, velocity, key tracking and a second "space" effect (reverb).

### Cited Findings
- [SRC] Supersaw constants (GPL-3.0-or-later code, GPL-OK): offsets at full detune for 7 saws 0, −0.11002313, +0.10745242, −0.06288439, +0.06216538, −0.01952356, +0.01991221 (fraction of note frequency; ordered centre, outer, middle, inner so fewer saws still spread wide); mix vs spread s: centre = 0.99785 − 0.55366·s; side = (1.2841 − 0.73764·s)·s + 0.044372; normalise gains by 1/√(centre² + (N−1)·side²) so level stays constant; max spread 0.6. The file cites the 2010 thesis "How to Emulate the Super Saw" (JP-8000 measurements). — [DelugeFirmware supersaw.cpp](https://github.com/SynthstromAudible/DelugeFirmware/blob/HEAD/src/deluge/dsp/oscillators/supersaw.cpp)
- [SRC] GPL filter references: Surge sst-filters enum (LP12, LP24, Legacy Ladder, Vintage Ladder, OB-Xd LP12/LP24, K35, Diode, Cytomic SVF, OB-Xd Xpander, …). — [FilterConfiguration.h](https://github.com/surge-synthesizer/sst-filters/blob/main/include/sst/filters/FilterConfiguration.h)
- [SRC] Helm value curves as a GPL reference for slider scaling: env times 0-4 squared (0-16 s), cutoff as MIDI note 28-127, LFO 2^(−7..6) Hz, glide 2^(−9..−1) s, unison detune 0-100 cents, voices 1-15, polyphony 1-32. — [helm_common.cpp](https://github.com/mtytel/helm/blob/master/src/common/helm_common.cpp)

### Inferences (design; all [CALC], to be tuned by ear)
**Voice architecture**: 8 voices (reface default; allow 16 for pads); each = oscillator block → LP filter (24 dB: two cascaded 12 dB sections or a ladder) → VCA; one shared ADSR; one LFO per patch (sine/triangle; shape option under "advanced"); FX slot 1 = reface effect (Dist / Cho-Fla / Phaser / Delay / Off); FX slot 2 (new) = reverb send.

**Parameter curves (x = slider 0..1)**
- Cutoff Hz = 20·2^(10x) (20 Hz … 20.5 kHz); key-track (new, default 50%) = +0.5 st per semitone from C4; resonance feedback = x² (self-oscillation only above ≈ 0.95).
- EG: Attack = 0.001 + 8x³ s; Decay/Release = 0.005 + 10x³ s; Sustain = x (level). EG Balance b: ampEnvAmount = min(1, 2(1−b)); filterEnvAmount = min(1, 2b); amp = gate·(1 − ampEnvAmount) + env·ampEnvAmount; cutoff_st += filterEnvAmount·48·env. (b = 0.5 → both full; b = 1 → gated amp + full filter sweep, matching the manual description.)
- LFO Speed Hz = 0.05·2^(9x) (0.05-25.6 Hz); Depth curve x²; ranges per target: Amp 0-100% tremolo, Filter ±0-36 st, Pitch ±0-100 cents, Osc = type-specific (below).
- Portamento: x = 0 → POLY; x > 0 → MONO legato, glide = 0.005·2^(8.5x) s (≈ 5 ms-1.8 s).
- Effects: Dist: Depth = drive 0-36 dB + mix, Rate = tone low-pass 800 Hz-12 kHz. Cho/Fla: Rate = LFO 0.05-8 Hz; Depth < 0.5 = chorus (delay 7-25 ms, mod depth up to 5 ms), Depth ≥ 0.5 crossfades to flanger (1-5 ms, feedback up to 0.7) — design choice, hardware rule unknown. Phaser: 4-8 all-pass stages, Rate 0.03-6 Hz, Depth = sweep range + feedback. Delay: Rate = time 30 ms-1.2 s or tempo-synced (1/16, 1/8, dotted 1/8, 1/4, dotted 1/4, 1/2), Depth = mix with feedback = 0.85·depth.
- Velocity (new): amp 0-100% (default 30%), brightness (cutoff +0..24 st, default 12), Texture amount (for FM/Sync keys).

**Oscillator algorithms (Texture t, Mod m, both 0..1; [LFO→OSC target])**
- Multi-saw: m = 0 → 1 saw; m > 0 → 7 saws with spread s = 0.6·m^1.5 and the supersaw offsets/mix above (at s = 0.6 the outer saws sit ±6.6% ≈ ±114 cents from centre; at s = 0.2, ±2.2% ≈ ±38 cents [CALC]); random start phases per note; t = level of a sub-oscillator one octave below (square or saw, 0-100%). [LFO→OSC: pitch of the main saws only, not the sub, as the manual says.]
- Pulse: two pulse oscillators; m = width of both, 50% → 95% (square → thin pulse); t = pitch of the second pulse: 0-0.4 = detune 0 → +30 cents (thickening); 0.4-1 = stepped intervals (−12, −5, +7, +12, +19, +24 st) with a short crossfade on change. [LFO→OSC: pulse width = PWM.] Needs PolyBLEP pulse in the worklet (OscillatorNode has no width parameter).
- Osc Sync: master at note pitch (silent), slave hard-synced; slave offset = 36t st (sets pitch and "tone"); m = amount the slave pitch is swept by the shared EG, 0 → +48 st. [LFO→OSC: slave pitch.] Needs the worklet (OscillatorNode cannot hard-sync).
- Ring Mod: out = osc1·osc2 (optionally + 20% dry osc1 so pitch stays readable); osc1 = note·2^(24t/12); osc2 ratio from m with "magnetic" simple-ratio zones (0.5, 1, 1.5, 2, 3, 4) and inharmonic values between (e.g. ×2.76 for bells). [LFO→OSC: osc2 pitch.] Plain Web Audio alternative: GainNode with gain.value = 0 driven at audio rate by osc2.
- FM (2-op, sine carrier at note pitch): index = 10·t² rad; modulator ratio from m over 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8 with narrow "between" zones detuned for metallic tones. [LFO→OSC: FM index.] Plain Web Audio alternative: osc → GainNode(index·f_mod) → carrier.frequency.
- Anti-aliasing: PolyBLEP for saw/pulse/sync; 7 saws × 8 voices = 56 BLEP saws, cheap in one worklet at 48 kHz.

**Beginner layer (UI)**
- Preset browser: category chips (Bass, Lead, Pad, Keys, Pluck, Brass, Strings, Bells, Drone, FX, Arp) → 2-4 presets each (section 3 recipes) + "Init" per oscillator type.
- Macro row (section 4) above the reface panel; panel sliders move when a macro moves.
- "Play as" selector per track (section 6): Sustain, Arp, Strum, Pulse, Drone, Glide, with rate/octave/spread knobs.
- Save "My sound" = 17 reface values + extras + macro curves; optional .syx export for real reface CS hardware (protocol in section 1).

### Gaps
- All curves and ranges above are proposals; matching the hardware needs recordings of a reface CS. PolyBLEP and the Web Audio node techniques are standard practice, but no specific GPL source for them was read in this session.

## 8. Source licence summary

### Takeaway
GPL-OK: cfenell/cs-control (GPL-3.0), harpomaxx/reface-cs-live (MIT), Surge XT code and factory patches (GPL-3.0 repo), sst-filters (GPL-3.0), Helm code (GPL-3.0+) and presets (CC BY 4.0, attribution required), Odin2 code (GPL-3.0), OB-Xf (GPL-3.0), Vital code (GPL-3.0; presets excluded), DelugeFirmware supersaw (GPL-3.0+), dronepigreco (GPL-3.0). REF-ONLY: Yamaha manual/Data List, sterudo/refaceCS, Vladdudu12 Omnibus, stefan-cambodia js-synth, ccbxxy/sysex and pencilresearch/midi (no licence confirmed; use facts only), Vital factory presets (redistribution forbidden), review texts.

### Cited Findings
- [SRC] Licences as stated in each repo: [cs-control LICENSE GPL-3.0](https://github.com/cfenell/cs-control/blob/master/LICENSE); [reface-cs-live LICENSE MIT](https://github.com/harpomaxx/reface-cs-live/blob/main/LICENSE); [Surge LICENSE GPL-3.0](https://github.com/surge-synthesizer/surge/blob/main/LICENSE); [Helm presets LICENSE CC BY 4.0](https://github.com/mtytel/helm/blob/master/patches/Factory%20Presets/LICENSE); [Odin2 LICENSE GPL-3.0](https://github.com/TheWaveWarden/odin2/blob/master/LICENSE); [OB-Xf README "under GPL3"](https://github.com/surge-synthesizer/OB-Xf/blob/main/README.md); [Vital README](https://github.com/mtytel/vital/blob/main/README.md); [DelugeFirmware LICENSE GPL-3.0](https://github.com/SynthstromAudible/DelugeFirmware/blob/HEAD/LICENSE); [dronepigreco LICENSE GPL-3.0](https://github.com/Kalitragus/dronepigreco/blob/HEAD/LICENSE)

### Inferences
- [CALC] Parameter facts (CC numbers, sysex layout, value zones) are interoperability facts usable regardless of the licence of the repo that lists them; prose from unlicensed repos and the Yamaha manual should be paraphrased, not copied.

### Gaps
- Licence of pencilresearch/midi and ccbxxy/sysex not confirmed (GitHub API returned no licence field); Odin2 soundbank licence not separately stated; ZynAddSubFX bank licences not checked.
