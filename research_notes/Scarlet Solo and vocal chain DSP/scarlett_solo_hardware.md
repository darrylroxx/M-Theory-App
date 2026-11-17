# Focusrite Scarlett Solo 3rd Generation: hardware reference (for building a recording app)

> Scope: the Scarlett Solo **3rd Gen** (released 2019). Figures from other generations or models (2nd Gen Solo, 4th Gen Solo, 2i2, Clarett/Red) are labelled where they appear.
>
> **How these notes were gathered:** in this research session the official Focusrite hosts (userguides.focusrite.com and fael-downloads-prod.focusrite.com) could not be fetched directly because the session's network blocks them. The official figures below therefore come from search-engine excerpts of those official pages (the 3rd Gen specifications page, the hardware-features page and the user guide PDFs v1 and v2), checked against retailer copies of the spec sheet. Before shipping anything that depends on an exact number, re-check it against the official PDF. The URLs are listed so that can be done.
>
> **Spec-version warning:** some search snippets reported "57 dB gain / −127 dBu EIN / +9.5 dBu max input" as Solo specs. Those snippets traced back to userguides article 28619367572882, which is the **Scarlett Solo 4th Gen (Studio Pack) Specifications** page, so they belong to the 4th Gen. The 3rd Gen figures are 56 dB / −128 dBu / +9 dBu (see below).

## 1. Inputs: connectors, gain, EIN, max levels, impedance, frequency response, THD+N, dynamic range; the INST switch

### Takeaway
Input 1 is a mic-only XLR preamp: 56 dB gain range, −128 dBu EIN (A-weighted), +9 dBu max input, 3 kΩ, 111 dB dynamic range. Input 2 is a front ¼" jack that is line level (60 kΩ, +22 dBu max) by default; the INST switch turns it into a Hi-Z input (1.5 MΩ, +12.5 dBu max) for guitar or bass. Both inputs have their own gain knob and Gain Halo, and the computer sees them as two separate mono channels.

### Cited Findings
**Physical layout**
- Input 1 is the mic input (XLR). Input 2 is a front-panel ¼" jack: a high-impedance, high-headroom instrument input meant for recording guitar or bass without clipping. The instrument input impedance is listed as 1.5 MΩ. — [Focusrite: Scarlett Solo 3rd Gen hardware features](https://userguides.focusrite.com/hc/en-gb/articles/23031457294610-Scarlett-Solo-3rd-Gen-hardware-features); [Focusrite product page](https://focusrite.com/products/scarlett-solo-3rd-gen)
- A listing confirms there are only two channels: one XLR and one ¼" jack. There is no combo jack and no second mic input. — [eBay listing (secondary)](https://www.ebay.com/itm/376296533618); 4th Gen reviews make the same point that the Solo has "one mic input and one mono line input, so no stereo recording" — [MusicProductionWiki (4th Gen review)](https://musicproductionwiki.com/articles/focusrite-scarlett-solo-review)

**Mic input (Input 1), official 3rd Gen figures**
- Frequency response 20 Hz – 20 kHz ±0.1 dB; dynamic range 111 dB (A-weighted); THD+N < 0.0012% (minimum gain); gain range 56 dB; max input level +9 dBu (at minimum gain); input impedance 3 kΩ. Focusrite states that all performance figures are measured to AES17 where possible. — [Focusrite: Scarlett Solo 3rd Gen specifications](https://userguides.focusrite.com/hc/en-gb/articles/23031457381138-Scarlett-Solo-3rd-Gen-specifications); [Vallee (retailer copy of spec sheet)](https://www.vallee.com/products/focusrite-scarlett-solo-3rd-gen-usb-audio-interface)
- EIN −128 dBu (A-weighted) is the 3rd Gen figure in older and official 3rd Gen listings. The −127 dBu figure belongs to the 4th Gen Solo. — [Symphony Music (3rd Gen spec listing)](https://symphonymusicstore.co.uk/interfaces/4136-focusrite-scarlett-solo-3rd-generation-usb-audio-interface.html); 4th Gen: [Focusrite: Scarlett Solo 4th Gen Specifications](https://userguides.focusrite.com/hc/en-gb/articles/17505454908562-Scarlett-Solo-4th-Gen-Specifications)
- Reviewers report enough gain for a Shure SM57 (a low-output dynamic mic) without an inline booster. — [Gearank review](https://gearank.com/gear/focusrite-scarlett-solo-3rd-gen-usb-audio-interface/)
- MusicRadar describes a "new, improved" preamp for the 3rd Gen range, with up to 56 dB gain. — [MusicRadar: Scarlett 3rd Gen review](https://www.musicradar.com/reviews/focusrite-scarlett-3rd-gen)

**Line input (Input 2, INST off)**
- Max input +22 dBu (minimum gain); impedance 60 kΩ; dynamic range 110.5 dB (A-wtd); THD+N < 0.002%. The official page's frequency-response line was reported as starting at "2 Hz", while retailer copies show 20 Hz – 20 kHz, so "2 Hz" is probably a typo. — [Focusrite 3rd Gen specifications](https://userguides.focusrite.com/hc/en-gb/articles/23031457381138-Scarlett-Solo-3rd-Gen-specifications); [Vallee](https://www.vallee.com/products/focusrite-scarlett-solo-3rd-gen-usb-audio-interface)

**Instrument input (Input 2, INST on)**
- Max input +12.5 dBu (minimum gain); impedance 1.5 MΩ; gain range 56 dB; dynamic range 110 dB (A-wtd); THD+N < 0.03%. — [Focusrite 3rd Gen specifications](https://userguides.focusrite.com/hc/en-gb/articles/23031457381138-Scarlett-Solo-3rd-Gen-specifications)

**Converters (A/D side)**
- Sample rates 44.1, 48, 88.2, 96, 176.4 and 192 kHz; 24-bit. — [Focusrite 3rd Gen specifications](https://userguides.focusrite.com/hc/en-gb/articles/23031457381138-Scarlett-Solo-3rd-Gen-specifications)

### Inferences
- **What INST does:** it switches Input 2 between a 60 kΩ line input with +22 dBu headroom and a 1.5 MΩ Hi-Z input with +12.5 dBu headroom. 1.5 MΩ is the right load for passive guitar pickups; a lower load would dull their top end. The app's setup guide should tell guitarists to press INST, and tell keyboard or line-level users to leave it off. The app cannot read the INST state on macOS, Windows or iOS (see section 8; only the Linux driver exposes it).
- Input 2 is a jack only, so a second microphone cannot go into Input 2 without an external preamp. App UX should not offer "two mics" on this device.
- **Vocals:** the 111 dB dynamic range and −128 dBu EIN are fine for close-miked vocals. With low-output dynamic mics (e.g. SM7B-class) the 56 dB of gain may be near the top of the knob, which means noise rises. That is an inference, not a measured figure. The app's noise-gate and noise-reduction defaults should allow for a higher noise floor at maximum gain.
- **Guitar:** reviewers of the related 4th Gen Solo say the instrument input overloads with hot or active pickups ([MusicProductionWiki](https://musicproductionwiki.com/articles/focusrite-scarlett-solo-review)). The 3rd Gen's +12.5 dBu INST headroom implies the same care is needed. The app should recommend lowering gain until the halo stays green or amber.

### Gaps
- I found no official 3rd Gen frequency response for INST mode beyond the dynamic range and THD+N figures above.
- I could not read the official PDF text directly (host blocked), so "+9 dBu at minimum gain" and similar qualifiers come from search excerpts.
- No independent bench measurement of the mic preamp EIN (e.g. Julian Krause) was found for the Solo 3rd Gen.

## 2. Air mode on the 3rd Gen

### Takeaway
3rd Gen Air is a switchable, fully analogue change to the mic preamp's frequency response. It is meant to emulate the transformer-based ISA preamp and adds a high-mid and high-frequency lift with no DSP and no latency. On the Solo 3rd Gen it applies to the mic input (Input 1). Focusrite has not published a frequency/dB curve or an impedance change for the 3rd Gen Scarlett version.

### Cited Findings
- Air is analogue, with no DSP or plug-ins running, so it adds no latency to the recording path. It boosts the mid and high frequencies. — [Focusrite support: What is 'Air' on my interface?](https://support.focusrite.com/hc/en-gb/articles/10742398294930-What-is-Air-on-my-interface); [Focusrite: What is Air…](https://us.focusrite.com/scarlett/what-is-air-and-how-does-it-help-make-better-recordings)
- The 3rd Gen manuals say Air "modifies the frequency response of the input stage to model the classic, transformer-based Focusrite ISA microphone preamps." — [Scarlett Solo 3rd Gen User Guide v1 (EN)](https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/downloads/Scarlett%20Solo%203rd%20Gen%20User%20Guide_EN.pdf)
- On the Solo, AIR is a front-panel switch that turns on Air mode for the mic input, and its LED lights amber. — [Focusrite: Solo 3rd Gen hardware features](https://userguides.focusrite.com/hc/en-gb/articles/23031457294610-Scarlett-Solo-3rd-Gen-hardware-features); [Manuals+ copy of 3rd Gen guide](https://manuals.plus/focusrite/scarlett-solo-3rd-gen-usb-audio-interface-manual)
- The impedance switch (6.2 kΩ → 2.2 kΩ) and the "4 dB lift at 24 kHz" figures are documented for **Clarett+ / Red**, and the 4 dB @ 24 kHz figure also for **4th Gen "Air Presence"**. Neither is documented for the 3rd Gen Scarlett. Sound On Sound notes that the 3rd Gen Scarlett preamp circuit is not the same as the one in the Clarett and Red. — [Focusrite support: What is Air](https://support.focusrite.com/hc/en-gb/articles/10742398294930-What-is-Air-on-my-interface); [Sound On Sound: Focusrite Scarlett USB-C (3rd Gen) review, Aug 2019](https://www.soundonsound.com/reviews/focusrite-scarlett-usbc)
- Reviewers hear a fairly noticeable high-frequency, upper-mid lift. They warn about using it with bright mics or sources and describe it as doing at tracking time what you would do in the mix anyway. — [Podcastage 2i2 3rd Gen review](https://podcastage.com/rev/2i23rd); [Gearank Solo 3rd Gen](https://gearank.com/gear/focusrite-scarlett-solo-3rd-gen-usb-audio-interface/)
- The mic input impedance is listed as a fixed 3 kΩ, with no separate Air-on figure. — [Focusrite 3rd Gen specifications](https://userguides.focusrite.com/hc/en-gb/articles/23031457381138-Scarlett-Solo-3rd-Gen-specifications)

### Inferences
- Air is printed into the recording (it is analogue and before the converter), so the app cannot remove it after the fact. If the app applies its own "presence/air" EQ on vocals, it should ask whether hardware Air was on, or default to a gentler software top-end boost, to avoid stacking two brightness lifts and getting harsh sibilance. That makes the de-esser more important when Air is on.
- The app cannot read the Air switch state on macOS, Windows or iOS without a vendor protocol (see section 8).

### Gaps
- No published 3rd Gen Air frequency-response curve (centre frequency, dB amount) was found, and no measured curve for it. The Clarett and 4th Gen numbers must not be used for it.
- It is unconfirmed whether Air on the Solo 3rd Gen does anything to Input 2. Official text says "mic input", which implies Input 1 only.

## 3. 48V phantom power

### Takeaway
A front-panel 48V button sends phantom power to the XLR mic input (Input 1) only; the ¼" Input 2 never carries phantom power. The same button, held down, takes the unit out of Easy Start (MSD) mode.

### Cited Findings
- Phantom power: yes. Bus powered: yes. — [Focusrite product page](https://us.focusrite.com/products/scarlett-solo-3rd-gen)
- Holding the 48V button for about 5 seconds while the unit is connected takes the Solo out of MSD mode and gives it full functionality. This comes from Focusrite's older (v1) 3rd Gen guide, so treat it as a possibly legacy method. — [Scarlett Solo 3rd Gen User Guide v1](https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/downloads/Scarlett%20Solo%203rd%20Gen%20User%20Guide_EN.pdf)
- Linux's scarlett2 driver exposes a "Phantom Power" control for the Solo Gen 3. — [Patch: ALSA scarlett2 Add support for Solo and 2i2 Gen 3](https://yhbt.net/lore/all/67c4ef3ef9fff1f89a7de60fbeb0fceb2d0b3561.1624294591.git.g@b4.vu/)

### Inferences
- Phantom power only makes sense on Input 1 (XLR). The app's mic-setup flow should say "press 48V for condenser mics; leave it off for dynamics or ribbons." Turning phantom on or off makes a thump, so the app should mute monitoring or warn the user while they toggle it.

### Gaps
- I found no measured current draw with 48V on, and no documented 48V behaviour on a phone or tablet (see section 7).

## 4. Gain Halo LED meters

### Takeaway
Each gain knob has a Gain Halo ring that meters the input after the converter: green means the signal is at or above −24 dBFS, amber means it is at or above −6 dBFS, and red means 0 dBFS (clipping).

### Cited Findings
- Green means at least −24 dBFS (signal present), amber means −6 dBFS (close to clipping), and red means 0 dBFS (clipping). — [Focusrite: Solo 3rd Gen hardware features](https://userguides.focusrite.com/hc/en-gb/articles/23031457294610-Scarlett-Solo-3rd-Gen-hardware-features); [Solo 3rd Gen User Guide v1](https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/downloads/Scarlett%20Solo%203rd%20Gen%20User%20Guide_EN.pdf)
- **4th Gen only (do not assume for 3rd Gen):** the 4th Gen halos have a finer scale (−42, −36, −24, −18, −12, −6 dBFS) and the whole ring flashes red on a clip. — [Focusrite 18i16 4th Gen hardware features](https://userguides.focusrite.com/hc/en-gb/articles/21616729762322-Scarlett-18i16-hardware-features)
- A Focusrite press item mentions "customisable Gain Halos" for the Scarlett range. It does not say whether this applies to the Solo 3rd Gen, which has no mixer software. — [4rfv press item](https://www.4rfv.com/YSFSKMWG6MKJ/199/customisable-gain-halos-for-scarlett-range.htm)

### Inferences
- The app's input meter should use the same breakpoints (−24 / −6 / 0 dBFS) and colours so that what the user sees on screen matches the hardware. A good target for vocals and guitar is peaks between about −18 and −6 dBFS, so the halo flickers green with only occasional amber. 24-bit leaves plenty of headroom.

### Gaps
- No source says whether the halo meters before or after Air. Since Air is analogue and before the converter, the halo most likely reflects Air-on levels (inference).

## 5. Direct Monitor switch

### Takeaway
DIRECT MONITOR on the Solo 3rd Gen is a two-position on/off switch (green LED when on). When it is on, both inputs are sent straight to the headphone and line outputs **summed to mono (centre)**, with zero latency. Computer playback **keeps playing** in stereo alongside it. There is no blend knob and no mono/stereo option on the 3rd Gen Solo.

### Cited Findings
- From Focusrite's manual: "the pre-recorded tracks will be heard in stereo, and the current input signals in mono – central in the stereo image." — [Manuals+ copy of Solo 3rd Gen guide](https://manuals.plus/focusrite/scarlett-solo-3rd-gen-usb-audio-interface-manual); [Solo 3rd Gen User Guide v1](https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/downloads/Scarlett%20Solo%203rd%20Gen%20User%20Guide_EN.pdf)
- Reviews agree that direct monitoring on the 3rd Gen Solo is mono, and criticise the lack of a mono/stereo switch. — [thinkdifferent.blog review](https://www.thinkdifferent.blog/blog/focusrite-scarlett-solo-3rd-gen-review/); [MusicLibraryReport review](https://musiclibraryreport.com/hardware-reviews/focusrite-scarlett-solo-3rd-generation/)
- Direct Monitor LED is green; AIR LED is amber. — [Manuals+ copy of Solo 3rd Gen guide](https://manuals.plus/focusrite/scarlett-solo-3rd-gen-usb-audio-interface-manual)
- **Not the standalone Solo:** a three-position switch (OFF / MONO / STEREO) appears in the *Scarlett Solo Studio* bundle documentation and is the 2i2-style arrangement. Do not assume it on the standalone Solo 3rd Gen. — [Manuals+ Solo Studio 3rd Gen guide](https://manuals.plus/focusrite/scarlett-solo-studio-3rd-generation-recording-bundle-manual)
- Linux exposes a "Direct Monitor" control for Solo Gen 3, which suggests the switch state can be read and set over USB vendor commands. — [ALSA scarlett2 Solo/2i2 Gen 3 patch](https://yhbt.net/lore/all/67c4ef3ef9fff1f89a7de60fbeb0fceb2d0b3561.1624294591.git.g@b4.vu/)

### Inferences
- **Most important for the app:** when Direct Monitor is on and the app *also* does software input monitoring (sending the input back out with effects), the user hears the dry signal with no delay plus the processed signal a few ms later. That sounds like comb filtering or doubling. The app should offer two modes: (a) "Hardware monitoring", where software input monitoring is off and the user hears the dry signal plus backing track; or (b) "Hear my effects", where the app tells the user to switch DIRECT MONITOR off and monitors through the software path.
- The guitar (Input 2) and the vocal (Input 1) are both centred in mono when DM is on. Neither can be panned and neither can be balanced against playback in hardware. The only balance control is the app's playback level (lower the backing track in software) and the input gain knobs.
- The app cannot detect the DM switch on macOS, Windows or iOS, so the setup UX has to ask the user.

### Gaps
- No source states the level of the direct-monitor path relative to playback (e.g. whether it is at unity).

## 6. Outputs: line outputs, headphones, level knob, max levels, impedance and power

### Takeaway
The 3rd Gen Solo has **two balanced ¼" TRS line outputs** on the rear. This was an upgrade over the 2nd Gen's RCA jacks; check before assuming it for the 4th Gen. It also has one front ¼" TRS stereo headphone jack. A single MONITOR knob sets the level of both the line outputs and the headphones, and the two always carry the same stereo feed.

### Cited Findings
- Line outputs: 2 × ¼" (6.35 mm) TRS jacks, electronically balanced, "+10 dBu output level (variable)". Either TRS (balanced) or TS (unbalanced) plugs can be used. — [Solo 3rd Gen User Guide v1](https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/downloads/Scarlett%20Solo%203rd%20Gen%20User%20Guide_EN.pdf); [Focusrite hardware features](https://userguides.focusrite.com/hc/en-gb/articles/23031457294610-Scarlett-Solo-3rd-Gen-hardware-features)
- Line-output performance: max output +15.5 dBu (balanced, at 0 dBFS); output impedance 430 Ω; dynamic range 108 dB (A-wtd). — [Focusrite 3rd Gen specifications](https://userguides.focusrite.com/hc/en-gb/articles/23031457381138-Scarlett-Solo-3rd-Gen-specifications); [Muziker listing](https://www.muziker.co.uk/focusrite-scarlett-solo-3rd-generation)
- The **2nd Gen** Solo used RCA phono line outputs (max +9 dBu). The 3rd Gen moved to balanced jacks. — [Solo 2nd Gen-era guide](https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/focusrite/downloads/20883/scarlett-solo-user-guidecl6.pdf); [GuitarPlayer review](https://www.guitarplayer.com/reviews/focusrite-scarlett-solo-3rd-gen-review)
- The front-panel MONITOR knob sets the level at both the rear outputs and the headphone output. — [Focusrite hardware features](https://userguides.focusrite.com/hc/en-gb/articles/23031457294610-Scarlett-Solo-3rd-Gen-hardware-features)
- Headphone output: ¼" TRS on the front; max output +7 dBu; output impedance < 1 Ω; dynamic range 104 dB (A-wtd); THD+N < 0.002% at max level. — [Focusrite 3rd Gen specifications](https://userguides.focusrite.com/hc/en-gb/articles/23031457381138-Scarlett-Solo-3rd-Gen-specifications)
- There is no mute switch for speakers vs headphones (they cannot be switched independently). — [MusicLibraryReport](https://musiclibraryreport.com/hardware-reviews/focusrite-scarlett-solo-3rd-generation/)
- Headphone drive: an ASR forum teardown author recommends headphones of at least 100 Ω. Gearank struggled with 250 Ω DT 770 Pro and suggests ≤150 Ω for clean, loud drive. — [ASR: Teardown, measurements, Focusrite Solo Gen3](https://www-audiosciencereview-com.translate.goog/forum/index.php?threads%2Fteardown-few-basic-measurements-and-personal-thoughts-of-the-focusrite-solo-gen3.9101%2F=&_x_tr_sl=en&_x_tr_tl=es&_x_tr_hl=es&_x_tr_pto=tc); [Gearank](https://gearank.com/gear/focusrite-scarlett-solo-3rd-gen-usb-audio-interface/)

### Inferences
- The device has 2 outputs, and the headphone jack mirrors them. The app should output stereo to Outputs 1/2 and should not offer a separate headphone mix, since none exists in hardware.
- If speakers are plugged in while a vocalist tracks on headphones, the speakers play too and bleed into the mic. The app's tracking checklist should say "turn monitors off at the speaker".
- +7 dBu into high-impedance headphones may sound quiet. The app should not compensate by pushing digital playback gain to 0 dBFS; a playback limiter or an "available headroom" note is better.

### Gaps
- No official headphone power figure (mW into a given load) was found for the 3rd Gen Solo.
- The exact meaning of "+10 dBu output level (variable)" vs "+15.5 dBu max" was not resolved from the excerpts (it may be nominal vs maximum).

## 7. Converters, USB and power

### Takeaway
The Solo uses 24-bit converters from 44.1 to 192 kHz (Cirrus Logic CS4272 codec according to teardowns), connects over a USB-C socket at USB 2.0, and runs entirely on bus power. iPhone/iPad use is officially supported only through a powered USB-C hub with Power Delivery, after updating the firmware.

### Cited Findings
- Sample rates 44.1, 48, 88.2, 96, 176.4 and 192 kHz; 24-bit. — [Focusrite 3rd Gen specifications](https://userguides.focusrite.com/hc/en-gb/articles/23031457381138-Scarlett-Solo-3rd-Gen-specifications)
- "The Scarlett Solo does not need a separate power supply; it gets its power from your computer via the USB connection." — [Solo 3rd Gen User Guide v2](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/Scarlett%20Solo%203rd%20Gen%20User%20Guide%20V2_0.pdf)
- The Focusrite product page has a footnote mentioning a 500 mA USB port requirement, but in the excerpt the footnote was not clearly tied to a specific item. — [Focusrite US product page](https://us.focusrite.com/products/scarlett-solo-3rd-gen)
- iPhone/iPad: Focusrite lists the Solo 3rd Gen among bus-powered interfaces that work through a USB-C hub with Power Delivery and its own power supply. It says to update 3rd Gen firmware *before* connecting to an iPad. — [Focusrite support: Connecting a bus-powered interface to iPhone or iPad](https://support.focusrite.com/hc/en-gb/articles/37768338125074-Connecting-a-bus-powered-audio-interface-to-an-iPhone-or-iPad)
- **4th Gen only:** a retailer lists 5 V at 900 mA for the Solo 4th Gen, and B&H lists 900 mA bus power for the 4th Gen. Do not apply this to the 3rd Gen. — [B&H Solo 4th Gen specs](https://www.bhphotovideo.com/c/product/1778216-REG/focusrite_scarlett_solo_4g_scarlett_solo_usb_audio.html/specs)
- Round-trip latency: MusicTech measured 6.8 ms at 48 kHz with a 32-sample buffer on a 3rd Gen **Scarlett** (the review covers the range and is led by the 2i2; not specifically the Solo). The reviewer calls the tests "not exactly scientific". — [MusicTech: Scarlett 3rd Gen review](https://musictech.com/reviews/studio-recording-gear/focusrite-scarlett-3rd-gen/)
- The 3rd Gen range is advertised as USB-C. — [Sound On Sound: Focusrite Scarlett USB-C](https://www.soundonsound.com/reviews/focusrite-scarlett-usbc)

### Inferences
- The app should default to 48 kHz / 24-bit. Higher rates are only available once the unit has left Easy Start (see section 9), and they add CPU load without helping vocal or guitar tracking much.
- A ~7 ms round trip at 32 samples means software monitoring with effects is usable on desktops. On iOS and Android the round trip will be larger and depends on the OS, which is another reason to give hardware Direct Monitor a prominent place in the UI.
- On a phone or tablet, a condenser mic with 48V on is the most power-hungry case. The app should warn iOS users to use a powered hub, following Focusrite's own guidance.

### Gaps
- No measured current draw with or without 48V was found.
- No official AD or DA dynamic range was found as a separate converter figure; only per-input and per-output dynamic ranges are published. Some blogs quote "~111 dB A/D vs ~120 dB 4th Gen" and "108 dB" output, which match the per-path figures but are not first-party converter specs.
- I found no first-party source stating USB 2.0 High-Speed explicitly. This is very likely (the XMOS-based Scarlett design and USB Audio Class 2), but I could not cite it.
- I found no measured latency for the Solo 3rd Gen specifically (e.g. a Julian Krause video).

## 8. How the computer sees it: channels and names, class compliance, software control

### Takeaway
The Solo is a 2-in / 2-out USB audio device (Focusrite markets it as "2x2"). Input 1 (mic) and Input 2 (inst/line) arrive as two separate mono capture channels, and playback is a stereo pair to Outputs 1/2, mirrored on the headphones. All controls are physical. No mixer software is needed or provided for the Solo, but the switches (48V, Air, Direct Monitor, MSD) are reachable over USB vendor commands, as the Linux driver shows.

### Cited Findings
- The device is marketed and sold as a "2 in 2 out" / "2x2" interface. — [Chicago Music Exchange listing](https://www.chicagomusicexchange.com/products/focusrite-scarlett-solo-3rd-gen-usb-2x2-digital-interface-788345); [eBay DE listing](https://www.ebay.de/itm/336176794894)
- The Linux scarlett2 mixer driver (Geoffrey D. Bennett, mainlined in 2021) supports the Solo Gen 3. It exposes the Air, phantom power, direct monitor and MSD-mode controls, and creates the other controls only after MSD mode is turned off. The Gen 2 Solo had no software-accessible controls. — [ALSA patch: Add support for Solo and 2i2 Gen 3](https://yhbt.net/lore/all/67c4ef3ef9fff1f89a7de60fbeb0fceb2d0b3561.1624294591.git.g@b4.vu/); [ALSA patch: Gen 3 MSD mode switch](https://patches.linaro.org/project/alsa-devel/patch/06f41cdc8c843a1c0ab0f7a1c01160ebbe7a7cdb.1624294591.git.g@b4.vu/); [linux-fcp repo](https://github.com/geoffreybennett/linux-fcp); [sadko4u backports](https://github.com/sadko4u/focusrite-scarlett-backports)
- The 4th Gen Solo is described as class compliant (Mac, Windows, USB-C iPad). The 3rd Gen is supported on iPad per Focusrite's support article. — [Focusrite Solo 4th Gen Specifications](https://userguides.focusrite.com/hc/en-gb/articles/17505454908562-Scarlett-Solo-4th-Gen-Specifications); [Focusrite iPad article](https://support.focusrite.com/hc/en-gb/articles/37768338125074-Connecting-a-bus-powered-audio-interface-to-an-iPhone-or-iPad)

### Inferences
- **Channel mapping for the app:** capture channel 1 = mic (Input 1, XLR), capture channel 2 = instrument/line (Input 2, jack). Drivers and DAWs commonly present them as a "1+2" stereo pair (e.g. "Analogue 1 + 2" in Windows/ASIO naming), but they are **independent mono signals**. The app must not record them as one stereo file and play back mic-left/guitar-right. It should split them into two mono tracks, or let the user pick channel 1 for vocals and channel 2 for guitar. Web Audio / getUserMedia gives a 2-channel stream; use a ChannelSplitter.
- On a web or mobile app, getUserMedia's default `echoCancellation`, `noiseSuppression` and `autoGainControl` must be turned **off** for music capture, or the OS will process the Solo's signal (general Web Audio practice, not Solo-specific).
- On macOS, Windows and iOS the app cannot read the hardware switch states (48V, Air, INST, DM, gain knob position) through standard audio APIs. Only Linux's scarlett2 controls expose them. The app UX should treat the gain, INST, Air and DM settings as things the user sets by hand, and show a "set your hardware" checklist.

### Gaps
- **Exact OS channel names were not confirmed** from a first-party source. Search found no official text for "Analogue 1 / Analogue 2" naming on the Solo 3rd Gen; it is a common Focusrite driver convention but unverified here.
- No official statement was found on whether the 3rd Gen Solo is fully USB Audio Class 2 compliant on Windows without the Focusrite driver. Windows normally uses the Focusrite USB ASIO driver for low latency.

## 9. Software: Focusrite Control, firmware, MSD / Easy Start

### Takeaway
Everything on the Solo 3rd Gen is controlled from the hardware, and day-to-day use needs no software. Out of the box it starts in "Easy Start" (MSD) mode: it shows up as a USB drive with a setup link and is limited to 48 kHz or lower. Installing the Focusrite software or updating the firmware turns MSD mode off and unlocks up to 192 kHz. Firmware updates come through Focusrite's desktop software.

### Cited Findings
- You do not need Focusrite Control running for general operation. Installing it is still necessary for sample rates above 48 kHz and for firmware updates. — [Focusrite Control Scarlett 3rd Gen user guide v2](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/Focusrite%20Control%20Scarlett%203rd%20Gen%20User%20Guide%20v2.pdf); [Getting started with your Scarlett Solo 3rd Gen](https://userguides.focusrite.com/hc/en-gb/articles/23031471992082-Getting-started-with-your-Scarlett-Solo-3rd-Gen)
- In Easy Start mode the interface only works at sample rates up to 48 kHz. On first connection the device is in Easy Start mode (it appears as a mass storage device). Installing the software switches it out of that mode. — [Getting started with your Scarlett Solo 3rd Gen](https://userguides.focusrite.com/hc/en-gb/articles/23031471992082-Getting-started-with-your-Scarlett-Solo-3rd-Gen)
- Manual exit: hold the 48V button for 5 s while connected (older v1 guide). — [Solo 3rd Gen User Guide v1](https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/downloads/Scarlett%20Solo%203rd%20Gen%20User%20Guide_EN.pdf)
- On Linux, the firmware update step turns MSD mode off for 3rd and 4th Gen interfaces. The scarlett2 driver offers an "MSD Mode" switch, and after changing it the device should be power-cycled. — [linux-fcp](https://github.com/geoffreybennett/linux-fcp); [sadko4u backports](https://github.com/sadko4u/focusrite-scarlett-backports)
- Users report Windows driver-install difficulties (anecdotal). — [Gearspace thread](https://gearspace.com/threads/focusrite-scarlett-solo-3rd-gen-drivers-dont-finish-install.1304431/)

### Inferences
- **App onboarding should check for Easy Start.** If the device only offers ≤48 kHz, or a "Scarlett" USB drive is mounted, the unit is still in MSD mode. That is fine for a 48 kHz app, but tell the user how to leave it (install Focusrite software / update firmware, or hold 48V for 5 s) if higher rates are wanted. Also tell iPad users to update firmware first (section 7).

### Gaps
- It is unclear whether the current (late-2026) firmware path for the 3rd Gen Solo is the original Focusrite Control or Focusrite Control 2. FC2 is documented for the 4th Gen; I found no source confirming FC2 support for the 3rd Gen Solo.
- The latest 3rd Gen Solo firmware version number was not found.

## 10. Differences from the 4th Gen Solo (so the app does not assume 4th Gen features)

### Takeaway
The 3rd Gen Solo has **one** Air mode (an analogue ISA-style lift), plain analogue gain knobs, no Auto Gain, no Clip Safe, no software mixer and the −24/−6/0 three-colour halos. The 4th Gen Solo adds Air "Presence" and "Harmonic Drive", a 57 dB preamp (EIN −127 dBu), Focusrite Control 2 support and a finer halo scale. Auto Gain and Clip Safe are on the 4th Gen **2i2 and above**; most sources say the 4th Gen Solo lacks them too.

### Cited Findings
- 4th Gen Solo: 57 dB gain range, EIN −127 dBu (A-wtd), 48 V, Air mode; Focusrite Control 2 listed; class compliant; 24/192. — [Focusrite: Scarlett Solo 4th Gen Specifications](https://userguides.focusrite.com/hc/en-gb/articles/17505454908562-Scarlett-Solo-4th-Gen-Specifications); [Full Compass 4th Gen listing](https://www.fullcompass.com/prod/623366-focusrite-scarlett-solo-4th-gen-2x2-usb-audio-interface-4th-generation)
- The 4th Gen Air modes are named "Presence" and "Harmonic Drive". 4th Gen Air Presence is documented as a 4 dB lift at 24 kHz. — [DJTechReviews 4th Gen review](https://djtechreviews.com/reviews/audio-interfaces/focusrite-scarlett-solo); [Focusrite support: What is Air](https://support.focusrite.com/hc/en-gb/articles/10742398294930-What-is-Air-on-my-interface)
- Auto Gain and Clip Safe: most 4th Gen Solo reviews say the Solo keeps a simpler preamp *without* Auto Gain or Clip Safe, which are on the 2i2 and 4i4 4th Gen. One outlier (Best Audio Hub) claims the Solo 4th Gen has auto-gain. — [SoundGuys Solo 4th Gen review](https://www.soundguys.com/focusrite-scarlett-solo-4th-gen-review-126209/); [Sweetwater 4th Gen reviews](https://www.sweetwater.com/store/detail/ScarSoG4--focusrite-scarlett-solo-4th-gen-usb-audio-interface/reviews); contradicted by [Best Audio Hub](https://bestaudiohub.com/scarlett-solo-4th-gen-review/)
- 4th Gen halos use a finer scale (−42 … −6 dBFS) and flash red on a clip (shown for the 18i16 4th Gen). — [Focusrite 18i16 4th Gen hardware features](https://userguides.focusrite.com/hc/en-gb/articles/21616729762322-Scarlett-18i16-hardware-features)
- Comparison blogs (low authority, inconsistent numbers) say the 4th Gen has better converters (~120 dB vs ~108–111 dB on the 3rd Gen) and a louder headphone amp. — [MusicNeeds 3rd vs 4th](https://musicneeds.co.za/focusrite-scarlett-solo-3rd-gen-vs-4th-gen-whats-the-real-difference/); [SonicAtlas](https://sonicatlas.co/focusrite-scarlett-solo-4th-gen-vs-3rd-gen/)
- Linux scarlett2 driver: Gen 3 Solo exposes Air, phantom, DM and MSD. The 2nd Gen Solo exposes nothing. — [ALSA patch](https://yhbt.net/lore/all/67c4ef3ef9fff1f89a7de60fbeb0fceb2d0b3561.1624294591.git.g@b4.vu/)

### Inferences
- If the app detects a device named "Scarlett Solo" it cannot tell the generation from the audio API name alone. A USB product ID would tell it apart (this is how the Linux driver tells them apart). The app should not show "Auto Gain" or "Clip Safe" prompts for any Solo, and it should describe Air as "on/off" for the 3rd Gen.

### Gaps
- **4th Gen Solo line output connector:** sources disagree. One review says 2 × ¼" TRS balanced, and I did not confirm RCA from first-party text. This does not affect the 3rd Gen, which is confirmed balanced TRS.

## 11. Teardown and circuit details

### Takeaway
Independent teardowns of the Solo 3rd Gen identify a Cirrus Logic CS4272 stereo codec (ADC and DAC in one chip) clocked by a Cirrus CS2100-CP, an XMOS USB microcontroller (probably the XU208-128-TQ64), Nisshinbo NJM2122 op-amps in the preamp and NJM8065 elsewhere, and a small unidentified headphone-amp chip.

### Cited Findings
- Codec: Cirrus Logic CS4272 (ADC/DAC); clock: Cirrus CS2100CP; USB controller "probably" XMOS XU208-128-TQ64 (inferred from package size); MPS MP2181 regulator for the 1 V XMOS core; firmware in a Macronix MX25L8006E flash; op-amps NJM2122 (preamps) and NJM8065 (elsewhere); headphone amp is a 2×2 mm QFN-12 that the author could not identify. — [Khron's Cave #88: Focusrite Scarlett Solo gen3 teardown (Aug 2025)](https://khronscave.blogspot.com/2025/08/88-focusrite-scarlett-solo-3rd-gen.html)
- The ASR teardown also identifies the CS4272-CZZ (24-bit/192 kHz, 114 dB dynamic-range class part). Its loopback measurement at 1.145 V RMS output gave about 0.0015% THD+N for the combined ADC+DAC. The author says Gen 3 has better numbers than Gen 2 but a worse harmonic profile, and recommends ≥100 Ω headphones. — [ASR forum: Teardown, few basic measurements… Focusrite Solo Gen3](https://www-audiosciencereview-com.translate.goog/forum/index.php?threads%2Fteardown-few-basic-measurements-and-personal-thoughts-of-the-focusrite-solo-gen3.9101%2F=&_x_tr_sl=en&_x_tr_tl=es&_x_tr_hl=es&_x_tr_pto=tc)
- A component-identification thread exists on Badcaps (repair context). — [Badcaps forum](https://www.badcaps.net/forum/troubleshooting-hardware-devices-and-electronics-theory/troubleshooting-audio-equipment/3521644-focusrite-scarlett-solo-3rd-gen-component-identification)
- One gaming-review site claims an "in-house Focusrite DAC" with no part number. This conflicts with both teardowns and should be disregarded. — [GamingPCGuru](https://gamingpcguru.com/focusrite-scarlett-solo-3rd-gen-review/)

### Inferences
- The CS4272 is a single stereo codec, so both inputs share one ADC and one clock. The two captured channels are therefore sample-aligned. If the user records vocal on channel 1 and guitar on channel 2 at the same time, the app can assume zero inter-channel skew.
- The NJM2122 is a low-noise op-amp. Its use in the preamp fits an op-amp-based (not discrete or transformer) mic preamp topology, which also fits Air being an analogue EQ or "emulation" rather than a real transformer. This is inferred from the parts list, not from a schematic.

### Gaps
- No schematic and no confirmed preamp topology (discrete front end vs op-amp only) was found.
- The XMOS part is inferred, not read from the chip marking.
- No iFixit or EEVblog teardown of the Solo 3rd Gen was found.

---

## Verification pass (Nov 2026): corrections and confirmations

Sources opened on 17 Nov 2026. Focusrite help-centre articles were read through the sites' public Zendesk API (`/api/v2/help_center/en-gb/articles/<id>.json`), because the HTML pages serve a Cloudflare challenge.

- **Spec page and User Guide v2 read [read].** All 3rd Gen input/output figures in section 1 and section 6 are confirmed. — [Focusrite 3rd Gen specifications](https://userguides.focusrite.com/hc/en-gb/articles/23031457381138-Scarlett-Solo-3rd-Gen-specifications); [User Guide v2](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/Scarlett%20Solo%203rd%20Gen%20User%20Guide%20V2_0.pdf)
- **Correction:** line-output dynamic range is **108.5 dB** (A-wtd), not 108 dB.
- **Correction / resolution:** the web spec page does print "2 Hz to 20kHz ±0.1dB" for the line input, but the v2 user guide prints **20 Hz to 20 kHz ±0.1 dB**. So "2 Hz" is a typo on the web page.
- **Note on units:** Focusrite prints the mic EIN as **"−128 dB (A-weighted)"**, not dBu. The value is unchanged.
- **Correction:** the 48V **five-second hold** to leave Easy Start appears in the v2 guide and on the current Getting Started page, so it is **not** a legacy method. — [Getting started](https://userguides.focusrite.com/hc/en-gb/articles/23031471992082-Getting-started-with-your-Scarlett-Solo-3rd-Gen)
- **Confirmed [read]:**
  - halos: green ≥ −24 dBFS, amber at −6 dBFS, red at 0 dBFS;
  - Direct Monitor: "Your inputs will be summed to mono"; playback is in stereo;
  - the MONITOR knob sets both the rear outputs and the headphones;
  - "+10 dBu output level (variable)" on the line outputs;
  - "1 x USB 2.0 Type-C connector" and "the Solo is a USB 2.0 device". The High-Speed rate and current draw are still unstated. — [hardware features](https://userguides.focusrite.com/hc/en-gb/articles/23031457294610-Scarlett-Solo-3rd-Gen-hardware-features)
- **Correction (Air):** Focusrite's Air article attributes the "4dB boost at 24kHz" and the 6.2 kΩ → 2.2 kΩ change to **Clarett+ and Red only**. It says 4th Gen "Air Presence is the same as Air was on Scarlett 3rd Gen". 3rd Gen Air is a "completely analogue circuit", has "no DSP", "adds no latency", and can be toggled from Focusrite Control. — [Focusrite: What is Air](https://support.focusrite.com/hc/en-gb/articles/10742398294930-What-is-Air-on-my-interface)
- **Added (Air impedance):** SOS says "the new Scarlett preamps remain at the Air impedance" whether Air is on or off. — [SOS](https://www.soundonsound.com/reviews/focusrite-scarlett-usbc)
- **Correction (4th Gen naming):** Focusrite names the 4th Gen modes "Air Presence" and "Air Presence & Drive", not "Presence" and "Harmonic Drive".
- **Confirmed [read]:** the 4th Gen Solo spec page lists 57 dB, −127 dBu EIN and 9.5 dBu max mic input. — [Solo 4th Gen specs](https://userguides.focusrite.com/hc/en-gb/articles/17505454908562-Scarlett-Solo-4th-Gen-Specifications)
- **Correction (Easy Start software):** the current Getting Started page names **Focusrite Control 2** (which "also installs the correct driver") as the software that disables Easy Start. FC2 gained 3rd Gen beta support in 1.1081.0 (16 Jul 2026) and listed full support from 1.1108.0 (13 Aug 2026). — [FC2 release notes](https://support.focusrite.com/hc/en-gb/articles/13289679039378-Focusrite-Control-2-Release-Notes)
- **Correction (iPad):** iPhone/iPad use is **not** "only through a powered USB-C hub". Focusrite lists the Solo 3rd Gen as tested and supported with USB-C iPads. Some USB-C devices (e.g. iPad Pro) power it directly, and a PD hub is the fallback. Lightning devices "can't provide enough power to the interface via a direct connection alone" (Camera Adapter plus charger), and no 3rd Gen is officially supported on Lightning iPads. Since iPadOS 15, units still in MSD mode "may not work". — [USB-C iPad Pro](https://support.focusrite.com/hc/en-gb/articles/360002662100-Using-an-audio-interface-with-a-USB-C-iPad-Pro); [bus-powered on iPhone/iPad](https://support.focusrite.com/hc/en-gb/articles/37768338125074-Connecting-a-bus-powered-audio-interface-to-an-iPhone-or-iPad); [3rd Gen not working on iPad](https://support.focusrite.com/hc/en-gb/articles/360016999880)
