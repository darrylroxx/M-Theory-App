# Focusrite Scarlett Solo 3rd Gen as seen by software: Windows ASIO driver, latency, and a native low-latency Rust (Tauri) audio engine

Research date: 17 Nov 2026. Researcher notes for the report writer.

**Network limits in this session (affects the evidence).** These hosts could not be fetched directly: support.focusrite.com, userguides.focusrite.com, fael-downloads-prod.focusrite.com (Focusrite PDFs), docs.rs, kvraudio.com, gearspace.com, dawbench.substack.com, linuxgamecast.com, americansongwriter.com, v2.tauri.app and steinberg.net. Claims from those sites come from **search-engine snippets** and are marked "(snippet)". They should be confirmed before they are quoted as final.
**Primary-source checks I did complete:**
- Downloaded and read the **cpal 0.18.2** and **asio-sys 0.4.0** crate sources from static.crates.io.
- Read the official **tauri-docs** and **tauri-action** files on raw.githubusercontent.com.
- Read the **GitHub Actions runner-image** manifests.
- Read GitHub mirrors of the **ASIO SDK** README and licence description.

---

## 1. The Focusrite USB ASIO driver for 3rd Gen Scarlett on Windows (version, buffer sizes, Safe Mode, sample rate, channels, multi-client)

### Takeaway
3rd Gen Scarletts use Focusrite's combined Windows driver ("Focusrite USB ASIO" plus WDM). The latest version visible in search snippets is **4.144.0 (28 Apr 2026)**; one snippet also mentions 4.150.0. Buffer size and the "Safe Mode" toggle are set in the **Focusrite Notifier** tray app, not by the host. Windows (WDM/WASAPI) audio can play while one ASIO app runs, but only when every client uses the **same sample rate**. The Solo 3rd Gen offers 2 inputs and 2 outputs at 44.1–192 kHz. I could not confirm the exact ASIO channel-name strings.

### Cited Findings
**Driver version history**
- Focusrite's Windows driver release-notes page lists **driver 4.144.0, released 28 April 2026**, for 3rd Gen Scarlett on Windows 10 (64-bit) and Windows 11 (snippet). A product download page lists **4.150.0** as the current driver, but its notes were not visible (snippet). — [Focusrite Windows Driver Release Notes](https://support.focusrite.com/hc/en-gb/articles/13070702714130-Focusrite-Windows-Driver-Release-Notes)
- **Safe Mode** and a **latency readout** were added to the Focusrite Notifier Settings panel. This appeared in beta 4.99.2 (Feb 2022) and in the 1 June 2022 release, 4.102.4 (snippet). — [Focusrite driver release notes, June 2022 (PDF)](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/Focusrite%20driver%20release%20notes%20-%20June%202022.pdf); [Release notes page](https://support.focusrite.com/hc/en-gb/articles/13070702714130)
- The June 2022 notes **renamed the clock status "LOCKED" to "SYNCED"** "to avoid confusion around clock status" (snippet). — [June 2022 release notes PDF](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/Focusrite%20driver%20release%20notes%20-%20June%202022.pdf)
- A later release fixed an issue that "could cause the device to be running at a different sample rate than the open DAW session" (snippet). — [Focusrite Windows Driver Release Notes](https://support.focusrite.com/hc/en-gb/articles/13070702714130-Focusrite-Windows-Driver-Release-Notes)
- **Older driver changes**
  - Driver 4.62.1 (June 2019) made the buffer size persist across restarts.
  - Driver 4.65.5 fixed some DAWs (Studio One, Reason, Sibelius) showing unsupported buffer sizes.
  - In 4.65.5 the **Notifier tray icon replaced the old "ASIO Control Panel"**, and latency-reporting accuracy was improved.
  - In 4.65.5 the extra WDM channels can be hidden or shown from the Notifier menu.

  All four points are from snippets. — [Windows USB Driver 4.65.5 release notes (PDF)](https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/downloads/Windows%20USB%20Driver%204.65.5%20-%20Release%20Notes_0.pdf); [June 2022 release notes PDF](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/Focusrite%20driver%20release%20notes%20-%20June%202022.pdf)

**Buffer sizes**
- A Cantabile forum user says the Focusrite panel offers standard sizes such as **16, 32, 64, 128** (and larger), but these did **not** appear as choices in Cantabile's own buffer menu. The reply explains that under ASIO the driver tells the host which sizes it supports (snippet). — [Cantabile forum "Hands on Latency"](https://community.cantabilesoftware.com/t/hands-on-latency/4421?page=2)
- A 2i2 3rd Gen owner reports that the buffer defaulted to **16 samples** on their unit. Another user reports the buffer reverting to default after a reboot (snippet; different model from the Solo). — [Cantabile forum](https://community.cantabilesoftware.com/t/hands-on-latency/4421?page=2); [Audiofanzine "Scarlet Solo ASIO buffer reset"](https://en.audiofanzine.com/focusrite/forums/t.10223,focusrite-scarlet-solo-asio-buffer-reset.html)
- Focusrite support's latency arithmetic: buffer ÷ sample rate gives the per-buffer time. **256 samples ≈ 5.8 ms** and **512 ≈ 11.6 ms** (these figures correspond to 44.1 kHz) (snippet). — [Adobe community thread quoting Focusrite support](https://community.adobe.com/questions-544/reasonable-latency-only-at-256-samples-does-that-sound-right-164431)
- Focusrite also notes that opening an ASIO DAW can change the interface's sample rate or buffer size (snippet). — [Focusrite: Audio issues in Windows VoIP apps](https://support.focusrite.com/hc/de/articles/360013759200-Audio-issues-in-Windows-VoIP-apps-Discord-Zoom-Teamspeak)

**Safe Mode**
- I found **no source describing what Safe Mode changes internally**. The release notes only say that it exists. The guess that it "adds extra safety buffering" is unverified. — [June 2022 release notes PDF](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/Focusrite%20driver%20release%20notes%20-%20June%202022.pdf)

**Solo 3rd Gen hardware facts**
- The Solo 3rd Gen supports **44.1, 48, 88.2, 96, 176.4 and 192 kHz**, is **bus powered**, and is a **2-in/2-out** USB interface. — [Focusrite product page](https://us.focusrite.com/products/scarlett-solo-3rd-gen); [Reverb listing (2x2, 1 headphone out)](https://reverb.com/item/57397352)
- The 3rd Gen user-guide PDF (v2.0) exists but could not be read in this session. — [Scarlett Solo 3rd Gen User Guide V2.0](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/Scarlett%20Solo%203rd%20Gen%20User%20Guide%20V2_0.pdf); [Scarlett Solo 3rd Gen overview](https://userguides.focusrite.com/hc/en-gb/articles/23031462621458-Scarlett-Solo-3rd-Gen-overview)
- In DAWs on Windows, you choose the driver named **"Focusrite USB ASIO"** (shown for the 2i2; the Solo uses the same driver family) (snippet). — [Scarlett 2i2 guide via search](https://www.adorama.com/col/productManuals/FRAMS18183G.pdf)

**Multi-client: Windows audio plus ASIO at the same time**
- Focusrite support states that "multi-client support relies on the Windows sound settings having the same sample rate as you are using in your DAW." Community answers agree that the key to running Windows audio and ASIO together is matching sample rates (snippet). — [KVR thread "Scarlett Solo 3rd Gen – are its ASIO drivers non-exclusive like the 2i2's 2nd gen?"](https://www.kvraudio.com/forum/viewtopic.php?p=7845689)
- **Symptom of a rate mismatch:** after playing a 96 kHz file, a 44.1 kHz file gave "Unrecoverable playback error: Audio device in use" until the user changed the rate manually (snippet). — [hydrogenaud.io](https://hydrogenaud.io/index.php/topic,117437.0.html)
- **Multi-client ASIO** (several ASIO apps at once) is a different case from WDM plus one ASIO app. One forum user claims Focusrite USB interfaces don't support multi-client ASIO. This is unverified, and a Focusrite answer for the 6i6 says "capable of multi-client playback" (snippet). — [KVR thread](https://www.kvraudio.com/forum/viewtopic.php?p=8469239)

### Inferences
**Planning assumptions about the driver**
- **Channels:** the Solo 3rd Gen will most likely show **2 ASIO inputs** (Input 1 = mic XLR, Input 2 = line/instrument) and **2 ASIO outputs** (Output 1/2 = monitor L/R, mirrored on the headphone jack).
- **Channel names:** read them at runtime with `ASIOGetChannelInfo` (asio-sys exposes channel info). Do not hard-code them.
- **Buffer size:**
  - Expect the host to be **unable to choose a buffer size freely**. The driver reports min, max and preferred sizes plus a granularity, and the user changes the size in the Focusrite Notifier.
  - The app must handle `kAsioBufferSizeChange` / `kAsioResetRequest` and rebuild its streams when that happens.
  - Expect powers of two from 16 upwards.
- **Sample rate:** the app should set (or read) the sample rate and keep it equal to the Windows default-device rate. Otherwise system sounds or browser audio can fail or block while the app runs.
- **Safe Mode** should be treated as a user-side toggle. If dropouts occur, tell the user to try it. Because it probably changes the latency, always re-query the reported latency after a change.

### Gaps
- **ASIO channel names:** the exact strings (e.g. "Analogue 1"/"Input 1", "Output 1") and whether there is a **loopback** channel on the Solo 3rd Gen are not confirmed. Search found loopback only in 4i4-and-up 3rd Gen guides.
- **Buffer and Safe Mode details:**
  - The exact buffer list with Safe Mode on versus off is unknown.
  - Whether Safe Mode adds driver-side buffering is unknown.
  - The precise min, max and preferred sizes on 4.144.0 are unknown.
- **Current release notes:** the full notes for 4.144.0 / 4.150.0 were not readable (support.focusrite.com blocked), so whether 4.150.0 really exists is unconfirmed.
- **Rate switching:** the driver's behaviour when an ASIO host requests a rate different from WDM's (refuse, switch both, or resample) is not documented in anything found.

---

## 2. Measured round-trip latency (RTL), driver-reported latency (ASIOGetLatencies), and DAW compensation

### Takeaway
I found **no published RTL table for the Scarlett Solo 3rd Gen**. The closest data, all from other models or with loose methods, puts 3rd/4th Gen Scarletts at roughly **6–7 ms RTL at 48 kHz / 32 samples** on Windows. That means fixed driver and converter overhead adds roughly 5 ms beyond the 2 × 0.67 ms of buffers. Reaper, Cubase and others compensate recordings with the driver-reported latency, plus an optional user offset measured by loopback. The app should do the same, and should **calibrate with a loopback test** rather than trust the reported figures blindly.

### Cited Findings
**RTL measurements found (none is a Solo 3rd Gen RTL table)**

| Model | Sample rate / buffer | Figure | Notes |
|---|---|---|---|
| Scarlett 3rd Gen (MusicTech review) | 48 kHz / 32 | **6.8 ms RTL** | author calls the tests "not exactly scientific" |
| **Scarlett 2i2 4th Gen** (not 3rd) | 48 kHz / 32 | **6.792 ms RTL** | Gearspace low-latency database (snippet) |
| **Scarlett 18i20 3rd Gen** | 48 kHz / 32 | **6.125 ms RTL** | on macOS Catalina (snippet) |
| **Scarlett 2i2 3rd Gen** (Delamar) | not stated | **~7 ms RTL** | |
| **Scarlett 2i2 3rd Gen** (Podcastage) | 48 kHz / 256 | **7.4 ms output latency** | about 3.3 ms at 192 kHz; output only, not RTL |

Sources by row: [MusicTech review: Focusrite Scarlett 3rd Gen](https://musictech.com/reviews/studio-recording-gear/focusrite-scarlett-3rd-gen/); [Gearspace Low Latency Performance Data Base p.224](https://gearspace.com/board/music-computers/618474-audio-interface-low-latency-performance-data-base-224.html); [Gearspace "18i20 3rd Gen latency question"](https://gearspace.com/threads/focusrite-scarlett-18i20-3rd-gen-latency-question.1322286/); [Delamar test](https://www.delamar.de/test/focusrite-scarlett-2i2-3rd-gen-test/); [Podcastage review](https://podcastage.com/rev/2i23rd)

- For the MusicTech row, the review does not make clear which unit in the range was used.
- A Logic user reports that the difference between 2nd and 3rd Gen Scarlett at **48 kHz/64** is about **1 ms RTL**, with **one-way 3.9 ms versus 3.4 ms** (models not named; snippet). — [Audiobus forum "comparing interface latency"](https://forum.audiob.us/discussion/58564/comparing-interface-latency)
- On an iOS comparison (Onyx app), the Solo 3rd Gen gave "almost the same values as Audient EVO8". No ms figure was given (snippet). — [Audiobus forum](https://forum.audiob.us/discussion/58564/comparing-interface-latency)
- One user's attempt to run the **RTL Utility** on a Solo with a patch cable failed. The thread does not say why (snippet). — [The Fretboard forum](https://www.thefretboard.co.uk/discussion/comment/2356821/)

**Driver-reported latency and DAW compensation**
- **Reaper's method:** "If you're on windows you'll want to use an ASIO driver… it will report the latency to reaper." For the loopback test, connect a cable from output to input and use a test signal to "determine how many samples of offset is needed". The result goes in the recording-offset setting. — [reaper.blog: rec latency offset](https://reaper.blog/2018/11/rec_latency_offset/)
- **Per-input anomaly (Cubasis, iOS):** a user with a 2i4 2nd Gen and an 18i8 3rd Gen saw "Audio Recording Offset Compensation" add **12–13 ms on Input 1 but only 0.3–0.6 ms on other inputs**. A Reaper test on the same hardware showed consistent latency across inputs (snippet; different models). — [Steinberg forum "Scarlett interfaces increased latency on input 1"](https://forums.steinberg.net/t/scarlett-interfaces-increased-latency-on-input-1/781632)
- A Cakewalk forum thread says driver-reported latencies are "generally very accurate", and recommends a loopback test to verify (snippet; not Scarlett-specific). — [Cakewalk forum: How many use the audio interfaces reported latencies](https://discuss.cakewalk.com/topic/21276-how-many-use-the-audio-interfaces-reported-latencies)
- **What cpal does with the reported latency (from the cpal 0.18.0 changelog):**
  - "ASIO: Timestamps now include driver-reported hardware latency."
  - "Hardware latency is re-queried when the driver reports `kAsioLatenciesChanged`."
  - The code reads `driver.latencies()` (`ASIOGetLatencies`) for input and output separately, and keeps capture and playback timestamps monotonic when the user changes the buffer in the driver's panel.

  — [cpal 0.18.2 crate source: CHANGELOG.md and src/host/asio/stream.rs](https://static.crates.io/crates/cpal/cpal-0.18.2.crate)

### Inferences
**Buffer time and expected RTL**
- One buffer takes buffer ÷ rate. At 48 kHz:

  | Buffer (samples) | 16 | 32 | 64 | 128 | 256 |
  |---|---|---|---|---|---|
  | Time per buffer (ms) | 0.33 | 0.67 | 1.33 | 2.67 | 5.33 |

- At 44.1 kHz each figure is about 9% longer; at 96 kHz it is half.
- The ~6.1–6.8 ms RTL at 48k/32 for 3rd/4th Gen Scarletts means about 5 ms of the round trip is fixed overhead (USB transfer, driver safety buffer, converter filter delay) beyond the two 0.67 ms buffers.
- **Expected Solo 3rd Gen RTL** (an estimate, not measured):
  - about **6–7 ms** at 48k/32
  - about **8 ms** at 48k/64
  - about **10–11 ms** at 48k/128
  - lower at 96 kHz, higher at 44.1 kHz
- Live monitoring through software effects is therefore realistically **~6–8 ms**, ear to ear, at the smallest stable buffer. The Solo's **hardware Direct Monitor** switch is the zero-latency fallback, but it bypasses the app's effects.

**Keeping recordings aligned with playback**
- Shift the recorded input by **(reported input latency + reported output latency)** samples, measured against the playback sample clock, plus a user-calibrated "extra offset".
- **Build a built-in loopback calibration:** play an impulse or chirp on Out 1, record it on In 2 with a cable, cross-correlate, and store the residual offset per driver, buffer size and sample rate. This is what Reaper and Cubase users do by hand.

### Gaps
- **No Solo 3rd Gen RTL table was found.** That includes Oblique Audio RTL Utility tables, Julian Krause figures (no 3rd Gen Solo or 2i2 RTL found), and the DAWbench/Vin Curigliano "D25" database, which was blocked.
- **Driver-reported values unknown:** the actual `ASIOGetLatencies` values the Focusrite driver reports for the Solo, and how closely they match a measured loopback, are unknown. These need to be measured on the hardware.
- **Not confirmed (left out of findings):** whether Focusrite's reported latencies include the buffer and safety offset. The ASIO spec says reported latencies should include buffer and hardware latency, but I did not reconfirm the exact spec wording this session.

---

## 3. Rust options for ASIO: cpal "asio" feature (asio-sys), build requirements, limitations, ASIO SDK licence, alternatives, sample-accurate duplex

### Takeaway
**cpal 0.18.2 (16 Aug 2026)** with `features = ["asio"]` (**asio-sys 0.4.0**) is now a mature path. 2026 releases added:
- hardware-latency-aware timestamps
- xrun and overload reporting
- buffer-size-change handling
- step-aligned `BufferSize::Fixed` validation
- a fix for ASIO duplex built from separate `Device` handles

cpal still has **no single duplex callback API**. Input and output are separate streams, but under ASIO both are created in one `ASIOCreateBuffers` call and both callbacks run inside the same driver `bufferSwitch`. That allows sample-aligned duplex if the app passes data between them correctly.

Building needs MSVC, LLVM/clang (for bindgen) and the Steinberg SDK, which is downloaded automatically from steinberg.net or provided via `CPAL_ASIO_DIR`. GitHub's Windows runners already ship LLVM 20, Rust, NSIS and WiX.

Since **October 2025 the ASIO SDK is dual-licensed: proprietary or GPLv3.** A closed-source app must use the proprietary licence (Steinberg's licensing agreement). An open-source app can use GPLv3, but the whole app then has to be GPLv3-compatible.

### Cited Findings
**cpal versions and recent ASIO changes**
- **cpal versions:** 0.18.2 (2026-08-16), 0.18.1 (2026-06-07), 0.18.0 (2026-06-06), 0.17.3 (2026-02-18). The ASIO backend first appeared in 0.10.0 (2019-07-05). — [cpal 0.18.2 CHANGELOG (crate source)](https://static.crates.io/crates/cpal/cpal-0.18.2.crate)
- **0.18.2:** "ASIO: Fix duplex streams silently dropping audio when built from separate `Device` handles." — [cpal CHANGELOG](https://static.crates.io/crates/cpal/cpal-0.18.2.crate)
- **0.18.0 ASIO changes:**
  - timestamps include driver-reported hardware latency
  - `ErrorKind::StreamInvalidated` on `kAsioResyncRequest` or on a sample-rate change of 1 Hz or more
  - latency re-queried on `kAsioLatenciesChanged`
  - fixes:
    - buffer size not resizing on `kAsioBufferSizeChange`
    - "distortion when buggy drivers fire the buffer callback multiple times per cycle"
    - overrun not reported on `kAsioOverload`
    - `BufferSize::Fixed` sizes not aligned to the driver's step now return `UnsupportedConfig`
    - enumeration and stream creation failing from spawned threads

  0.18.0 also added `StreamTrait::buffer_size()` and `StreamTrait::now()`, plus a `realtime` feature. — [cpal CHANGELOG](https://static.crates.io/crates/cpal/cpal-0.18.2.crate)
- **0.17.0 (2025-12-20):** handling of `kAsioResetRequest`; "Buffer silencing logic to work with non-conformant drivers". **0.16.0 (2025-06-07):** ASIO int24 support. — [cpal CHANGELOG](https://static.crates.io/crates/cpal/cpal-0.18.2.crate)

**Build requirements**
- **README requirements:**
  - Enable the `asio` feature and select the host with `cpal::host_from_id(cpal::HostId::Asio)`.
  - The SDK is found via `CPAL_ASIO_DIR`, a cached copy in the temp directory, or an automatic download.
  - LLVM/clang is required for bindgen; set `LIBCLANG_PATH`.
  - The build script runs `vcvarsall.bat`, so Visual Studio/MSVC is assumed.
  - Use **ASIO4ALL** to test without hardware.
  - MinGW cross-compilation from Linux/macOS is possible.
  - The WASAPI/ASIO MSRV is 1.85, on Windows 10 or later.

  — [cpal README on GitHub](https://github.com/RustAudio/cpal)
- **asio-sys 0.4.0 `build.rs`:** `ASIO_SDK_URL = "https://www.steinberg.net/asiosdk"`. It downloads with PowerShell `Invoke-WebRequest` on Windows or curl elsewhere, and extracts to the temp directory. The README says "ASIO SDK: Automatically downloaded during build from Steinberg… Or set `CPAL_ASIO_DIR`", and "LLVM/Clang: Required for bindgen… `choco install llvm`". — [asio-sys 0.4.0 crate source](https://static.crates.io/crates/asio-sys/asio-sys-0.4.0.crate)
- **asio-sys changes:**
  - 0.3.0 (2026-06-06) added `Driver::latencies()` (input and output latency) and a `BufferPreference` enum with the driver's **preferred buffer size and step granularity** (from `ASIOGetBufferSize` min, max, pref and granularity).
  - 0.4.0 (2026-08-16) added `Driver::streams()` for shared input/output buffer state.

  — [asio-sys CHANGELOG](https://static.crates.io/crates/asio-sys/asio-sys-0.4.0.crate)

**How cpal's ASIO backend actually works (from reading the source)**
- **Channel selection:** `prepare_buffer_infos(is_input, n_channels)` maps `(0..n_channels)` to channel numbers. cpal therefore opens the **first N channels** of the device. You cannot pick, say, only input 2. Open both inputs (`channels: 2`) and ignore one in your code. — [asio-sys src/bindings/mod.rs](https://static.crates.io/crates/asio-sys/asio-sys-0.4.0.crate)
- **One driver buffer set for both directions:** "Because only the latest call to ASIOCreateBuffers is relevant this call will destroy all past active buffers and recreate them. For this reason we take the input stream if it exists." Building the output stream re-creates the buffers with the input included, and the reverse is also true. — [asio-sys src/bindings/mod.rs](https://static.crates.io/crates/asio-sys/asio-sys-0.4.0.crate)
- **Shared callback:**
  - The driver's `buffer_switch_time_info` locks a global `BUFFER_CALLBACK` mutex. The source comment reads: "This lock is probably unavoidable, but locks in the audio stream are not great."
  - It runs **every registered stream callback in turn**, then calls `ASIOOutputReady()`. Input and output callbacks therefore run back-to-back in the same driver period, on the driver's thread.

  — [asio-sys src/bindings/mod.rs](https://static.crates.io/crates/asio-sys/asio-sys-0.4.0.crate)
- **Buffer size:**
  - `BufferSize::Fixed(v)` is passed to `ASIOCreateBuffers`.
  - `BufferSize::Default` uses the driver's preferred size.
  - Once a stream exists, a later stream reuses its buffer size.
  - `SupportedBufferSize::Range` is filled from `driver.buffersize_range()` (min and max).

  — [cpal src/host/asio/stream.rs and device.rs](https://static.crates.io/crates/cpal/cpal-0.18.2.crate)
- **No duplex API:** cpal 0.18.2 has no `build_duplex_stream` API. "Duplex" appears only as a `DeviceDirection` enum value. The Duplex Stream Support issue **#349** is still listed as open, and a proposed `build_duplex_stream` exists in PR #1096 (seen through a mirror only; verify on GitHub). — [cpal crate source](https://static.crates.io/crates/cpal/cpal-0.18.2.crate); [ecosyste.ms cpal issues listing](https://issues.ecosyste.ms/hosts/GitHub/repositories/RustAudio%2Fcpal/issues)
- **Same device for input and output:** a user reported that opening the default input and default output devices separately under ASIO meant only one worked. The fix was to use the same device handle for both, because ASIO is exclusive per driver. 0.18.2 later fixed the separate-handle case. — [coderapp Q&A](https://coderapp.vercel.app/answer/78324591); [cpal CHANGELOG 0.18.2](https://static.crates.io/crates/cpal/cpal-0.18.2.crate)

**CI build environment**
- **GitHub Actions Windows runners (Nov 2026 images):**

  | Image | Version | LLVM | Rust | WiX | NSIS | VS Enterprise 2022 |
  |---|---|---|---|---|---|---|
  | windows-2025 | 20261111.331.1 | 20.1.8 | 1.99.1 | 3.14.1.8722 | not shown | 17.14 with VC LLVM/Clang components |
  | windows-2022 | 20261112.366.7 | 20.1.8 | 1.99.1 | 3.14.1.8722 | 3.10 | 17.14 with VC LLVM/Clang components |

  — [runner-images Windows2025-Readme](https://raw.githubusercontent.com/actions/runner-images/main/images/windows/Windows2025-Readme.md); [Windows2022-Readme](https://raw.githubusercontent.com/actions/runner-images/main/images/windows/Windows2022-Readme.md)

**ASIO SDK licence**
- **Dual licence since October 2025:**
  - Steinberg press release, **15 Oct 2025** (OBS partnership): ASIO licensing extended to "both proprietary and open-source options".
  - VST 3.8 press release, **29 Oct 2025**: VST 3 moved to MIT, and the ASIO SDK is available under **GPLv3** alongside the proprietary option.

  — [Steinberg press release 2025-10-15 (PDF)](https://ocl-steinberg-live.steinberg.net/_storage/asset/808575/storage/master/Press%20Release%20-%202025-10-15%20-%20OBS%20Partnership-%20EN.pdf); [Steinberg VST 3.8 press release 2025-10-29 (PDF)](https://ocl-steinberg-live.steinberg.net/_storage/asset/819253/storage/master/Press%20Release%20-%202025-10-29%20-%20VST%203.8%20-%20EN.pdf); [Libre Arts coverage](https://librearts.org/2025/11/steinberg-relicenses-vst3-and-asio/); [CDM](https://cdm.link/open-steinberg-vst3-and-asio/)
- **SDK copy on GitHub ("ASIO 2.3 SDK"):**
  - `LICENSE.txt` reads "Dual license: Proprietary Agreement and GPLv3", alongside "Steinberg ASIO Licensing Agreement.pdf".
  - FAQ: existing products may stay on the proprietary licence; moving to GPLv3 requires GPLv3 terms, including source disclosure.
  - Trademark rules: under GPLv3 the ASIO name or logo is optional, but if used it must follow Steinberg's rules. "ASIO" may not appear in a company or product name.

  — [audiosdk/asio on GitHub](https://github.com/audiosdk/asio); [jcelerier/asio-2 fork](https://github.com/jcelerier/asio-2)
- **Commercial licensing questions remain:** a May 2026 Steinberg forum thread shows developers still asking how commercial, closed-source distribution is licensed. — [Steinberg forum: Request for ASIO SDK access / licensing information](https://forums.steinberg.net/t/subject-request-for-asio-sdk-access-licensing-information/1031382.md)
- **OBS precedent:** OBS's native-ASIO pull request credits the GPLv3 option ("compatible with obs-studio"). — [obs-studio PR #12733 mirror](https://obs-versions.com/community/pulls/12733)

### Inferences
**Recommended duplex design with cpal (single driver period)**
1. Use **one** `Device` from `cpal::host_from_id(HostId::Asio)` whose name is "Focusrite USB ASIO".
2. Build the **input stream first** (2 channels), then the **output stream** (2 channels), with the same `SampleRate` and `BufferSize`.
3. Callbacks run in registration order inside each `bufferSwitch` (they are stored in a Vec and iterated). The input callback should therefore run before the output callback in the same period. **This is inferred from the code; test it.**
4. Pass input to output through an `rtrb` SPSC ring pre-filled with **zero** frames. Then input sample *n* of period *k* reaches the output in period *k*. That gives the minimum latency: the driver's RTL with no extra app buffering.
5. Use the callbacks' `StreamInstant` capture and playback timestamps, which include hardware latency, to compute alignment.

**The alternative: one true duplex callback**
- Write a thin layer on **asio-sys** directly, or patch/fork cpal's ASIO host. One `bufferSwitch` would then hand you both input and output pointers, removing the inter-callback ring and the order assumption.
- This also allows **non-contiguous channel selection**.

**Accepted risk: the mutex in the driver callback**
- cpal/asio-sys take a mutex inside the driver callback. It is uncontended in practice, but it is technically not real-time-safe. Accept this risk for v1, or own the `bufferSwitch` in a custom asio-sys layer.

**Licensing**
- **Closed-source app:** request the proprietary ASIO licence from Steinberg. The cpal path compiles Steinberg's host SDK sources (asiodrivers/asiolist) into the binary.
- **Open-source app:** release under GPLv3-compatible terms.
- **Either way:** do not put "ASIO" in the product name.

**CI**
- No LLVM install is needed on GitHub Windows runners. Do set `LIBCLANG_PATH="C:\Program Files\LLVM\bin"` if bindgen cannot find clang.
- **Cache the SDK**, or vendor it under `CPAL_ASIO_DIR`, to avoid depending on steinberg.net at every build.

### Gaps
- **Unchecked API details:**
  - I did not confirm whether cpal exposes `ASIOControlPanel()` (to open the Focusrite settings) or channel names through its safe API. asio-sys has the raw calls.
  - I did not verify the exact SDK point version that the steinberg.net/asiosdk zip delivers (2.3.3 or 2.3.4?).
- **Alternatives (background knowledge, not verified this session):**
  - **RtAudio:** C++, MIT-style licence; supports ASIO with a true duplex callback.
  - **PortAudio:** ASIO host API with a full-duplex callback; the Rust `portaudio` crate is old and its maintenance is uncertain.
  - **JUCE:** C++, GPL/commercial; its ASIO support needs the Steinberg SDK.
  - **Standalone `asio` crates:** small, little-maintained.

  All four need verification before they are cited.
- **Other unconfirmed items:**
  - Whether cpal's ASIO callback thread gets MMCSS from the driver: ASIO drivers own their callback thread, and Focusrite's thread priority is undocumented.
  - The status of cpal issues #787 and #766 (callback frequency mismatch, mostly WASAPI) on ASIO.

---

## 4. Real-time audio thread practice in Rust (no allocation or locks, lock-free rings, WAV writing off-thread, MMCSS)

### Takeaway
Keep the ASIO callback allocation-free and lock-free:
- Move audio to a disk-writer thread through a pre-allocated **rtrb** (or **ringbuf**) SPSC ring.
- Write 24-bit or 32-bit float WAV with **hound** on that thread.
- Send meter values (peak/RMS) through atomics or a small ring that a UI thread polls at about 30–60 Hz.

ASIO drivers run the callback on their own high-priority thread. Any **other** threads you create (disk writer, a WASAPI fallback) can be raised with MMCSS through **audio_thread_priority**, which cpal uses for WASAPI under its `realtime` feature.

### Cited Findings
- **Latest crate versions** (crates.io index, Nov 2026): **rtrb 0.4.1**, **ringbuf 0.6.0**, **hound 3.5.1**, **audio_thread_priority 0.38.0** (cpal 0.18.2 depends on 0.35). — [crates.io index: rtrb](https://index.crates.io/rt/rb/rtrb); [hound](https://index.crates.io/ho/un/hound); [ringbuf](https://index.crates.io/ri/ng/ringbuf); [audio_thread_priority](https://index.crates.io/au/di/audio_thread_priority)
- **MMCSS in `audio_thread_priority`:** on Windows it calls `AvSetMmThreadCharacteristicsW` with the MMCSS task **"Audio"** (source `rt_win.rs`). — [audio_thread_priority 0.34.0 source](https://static.crates.io/crates/audio_thread_priority/audio_thread_priority-0.34.0.crate)
- **cpal and thread priority:**
  - cpal's WASAPI backend calls `audio_thread_priority::promote_current_thread_to_real_time(period_frames, sample_rate)` when the `realtime` feature is on.
  - The ASIO backend makes no such call, because the driver owns the thread.
  - cpal 0.18.0 added `ErrorKind::RealtimeDenied`.

  — [cpal 0.18.2 src/host/wasapi/stream.rs, Cargo.toml, CHANGELOG](https://static.crates.io/crates/cpal/cpal-0.18.2.crate)
- **cpal's ASIO callback itself is not lock-free:** it takes a global mutex on each driver callback, as quoted in section 3. — [asio-sys source](https://static.crates.io/crates/asio-sys/asio-sys-0.4.0.crate)
- **Example to start from:** cpal ships a `record_wav.rs` example (hound) and a `feedback.rs` example (input to output through a ring buffer). — [cpal 0.18.2 examples](https://static.crates.io/crates/cpal/cpal-0.18.2.crate)

### Inferences
**Engine pattern**
- **Startup:** pre-allocate every effect state, the rings and the scratch buffers at stream start. Size each recording ring for at least 1–2 s of audio at 96 kHz × 2 channels × f32, so disk stalls don't cause overflow.
- **Inside the audio callback:**
  - deinterleave
  - run the effects (pre-allocated, no `Vec` growth, no `Box::new`, no logging, no `Mutex`)
  - push the raw dry input into the record ring
  - write the processed signal to the outputs
  - update atomics for meters
- **Writer thread:** pop from the ring and use `hound::WavWriter` with 24-bit int or 32-bit float.
- **Overflow:** if the ring is ever full, count dropped frames in an atomic and report them. **Never block** the callback.
- **Parameter changes from the UI:** use atomics (e.g. `AtomicU32` holding f32 bits) or a command ring the callback drains. Smooth parameters per block.
- **Record the dry input** together with the playback position (sample counter) captured in the same callback. Alignment then becomes a fixed offset applied on save.

### Gaps
- I did not fetch the rtrb, ringbuf or hound documentation pages (docs.rs blocked). API details (e.g. `rtrb::RingBuffer::new`, chunk APIs, and hound `WavSpec` with `SampleFormat::Float`) come from background knowledge and should be checked against the docs.

---

## 5. Tauri 2 specifics: native engine in Rust, IPC to the web UI, updater, Windows installers on GitHub Actions, WebView2

### Takeaway
- **Engine:** run the audio engine as plain Rust objects in Tauri's Rust process, kept in managed state.
- **Meters:** stream them to the UI with **`tauri::ipc::Channel`**, not the global event system. The docs say events are "not designed for low latency or high throughput".
- **Updater:** tauri-plugin-updater (2.14.1) needs a minisign-style key pair (`tauri signer generate`), `createUpdaterArtifacts: true`, the public key in config, and HTTPS endpoints serving a `latest.json`.
- **CI:** tauri-action builds Windows NSIS/MSI installers on `windows-latest` and can upload the installers plus `latest.json` to a GitHub Release.
- **Current stable versions:** tauri 2.12.6; Tauri 3 is in alpha (3.0.0-alpha.6).

### Cited Findings
**Crate versions**
- **Stable:** tauri **2.12.6** and tauri-plugin-updater **2.14.1**. **Pre-release:** tauri 3.0.0-alpha.6 and tauri-plugin-updater 3.0.0-alpha.3. — [crates.io index: tauri](https://index.crates.io/ta/ur/tauri); [tauri-plugin-updater](https://index.crates.io/ta/ur/tauri-plugin-updater)

**IPC to the web UI**
- **Events:** "The event system was designed for situations where small amounts of data need to be streamed… The event system is not designed for low latency or high throughput situations. See the channels section…"
- **Channels:** "Channels are designed to be fast and deliver ordered data." Usage: a Rust command takes `on_event: Channel<T>` (`use tauri::ipc::Channel`), and JS creates `new Channel<T>()` from `@tauri-apps/api/core` and passes it to `invoke`.

  — [tauri-docs: develop/calling-frontend.mdx](https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/develop/calling-frontend.mdx)

**Updater**
- **Keys:**
  - Generate with `cargo tauri signer generate -w ~/.tauri/myapp.key`.
  - The private key goes in env `TAURI_SIGNING_PRIVATE_KEY` (path or content), plus `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. "`.env` files do _not_ work!"
  - The docs warn: "if you lose this key you will NOT be able to publish new updates to the users that have the app already installed."
- **Config:**
  - Set `bundle.createUpdaterArtifacts: true`.
  - `plugins.updater.pubkey` must contain the key text, not a file path.
  - `endpoints` is an array, and "TLS is enforced in production mode". It supports `{{target}}`, `{{arch}}` and `{{current_version}}`, and the example uses `https://github.com/user/repo/releases/latest/download/latest.json`.
  - On Windows, `installMode` can be `"passive"` (default), `"basicUi"` or `"quiet"`.
- **Windows artifacts:** `myapp-setup.exe` + `.sig` (NSIS) and `myapp.msi` + `.sig`.
- **Static JSON format:** required keys are `version`, `platforms.[target].url` and `platforms.[target].signature`. The signature must be the `.sig` *content*, not a path. A dynamic server returns 204 when there is no update. Custom request headers can be added with `UpdaterBuilder::header`.

  — [tauri-docs: plugin/updater.mdx](https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/plugin/updater.mdx)

**tauri-action (GitHub Actions)**
- The example workflow needs `permissions: contents: write`, `GITHUB_TOKEN`, a `platform: 'windows-latest'` matrix entry and `tagName: app-v__VERSION__`, with `releaseDraft: true`.
- Options:
  - `uploadUpdaterJson: true` (default) uploads `latest.json`.
  - `updaterJsonPreferNsis` (default `false`) chooses whether `latest.json` points at the NSIS setup.exe or the MSI when both exist.
  - If you create the release yourself and pass `releaseId` without `tagName`, the updater URLs point to `releases/latest/download/…`, which can break if other releases lack updater bundles.

  — [tauri-action README](https://raw.githubusercontent.com/tauri-apps/tauri-action/dev/README.md)
- A third-party guide says Tauri 2 Windows updates should prefer NSIS (`updaterJsonPreferNsis: true`). — [stuffbucket tauri-updater-github-releases guide](https://stuffbucket.github.io/skills/catalog/tauri-updater-github-releases/)

**Windows installers and WebView2**
- **Installer types:** `.msi` (WiX v3) "can **only be created on Windows**"; NSIS `-setup.exe` can also be cross-compiled from Linux/macOS, "as a last resort".
- **WebView2 install modes** (`webviewInstallMode`):

  | Mode | Notes |
  |---|---|
  | `downloadBootstrapper` | default; 0 MB added; needs internet |
  | `embedBootstrapper` | about 1.8 MB |
  | `offlineInstaller` | about 127 MB; no internet needed |
  | `fixedRuntime` | also available |

  — [tauri-docs: distribute/windows-installer.mdx](https://raw.githubusercontent.com/tauri-apps/tauri-docs/v2/src/content/docs/distribute/windows-installer.mdx)

### Inferences
**App structure**
- Hold the engine (the cpal `Stream`s, which are `!Send` on some hosts) on a dedicated control thread that owns them, and control it from Tauri commands through a crossbeam/std channel.
- Expose commands such as `start_engine`, `set_param`, `arm_record`, `stop_record` and `open_asio_panel`.
- **Meters:** have the control thread read meter atomics about every 33 ms and push a small struct (peaks/RMS for 2 inputs and 2 outputs) through a `Channel<MeterFrame>` that the UI passed in at startup.

**Updater hosting**
- **Private GitHub repo:** release assets in a private repo are not publicly downloadable. A `releases/latest/download/latest.json` endpoint will then fail for users without a token. Choose one of:
  - (a) publish releases to a separate **public** "releases" repo (tauri-action can target another repo via `owner`/`repo` with a PAT, per its README note on `releaseCommitish`), or
  - (b) host `latest.json` and the installers on GitHub Pages or another public HTTPS host, or
  - (c) use the updater's custom headers with a token. This is **not** advisable: the token would ship inside the app.
- **CI secrets:** store `TAURI_SIGNING_PRIVATE_KEY` and its password as GitHub Actions secrets and pass them to tauri-action's environment.
- **Signing note:** Windows Authenticode code signing is separate from updater signing. Without it, SmartScreen warnings will appear.

### Gaps
- I did not verify current Tauri guidance on hosting updates from private repos, or tauri-action's exact cross-repo publishing inputs (`owner`/`repo`). Check the tauri-action README "inputs" section in full.
- Not researched: WebView2 behaviour on Windows 10 LTSC or N editions.

---

## 6. macOS / iOS: class compliance and power, for future versions

### Takeaway
- **Class compliance:** the Scarlett range is USB class-compliant on macOS and iOS. CoreAudio needs no driver, and cpal's CoreAudio backend covers both.
- **USB-C iPads:** since June 2020 Focusrite officially supports the 3rd Gen Solo and 2i2 on **USB-C iPads**. The Solo can run directly on bus power from the iPad ("several hours"), but Focusrite recommends powered operation through a USB-C hub with Power Delivery.
- **Lightning iPhones/iPads:** these **cannot bus-power** the interface. You need Apple's Lightning to USB 3 Camera Adapter, which has a power-in port, or a powered USB hub.

### Cited Findings
**Focusrite's iPad support**
- **June 2020 announcement** (Focusrite's own article): official USB-C iPad Pro support for the 3rd Gen Solo and 2i2. It notes "you'll need a USB-C to USB-C cable" (a C-to-A cable is in the box). Units can run bus-powered "for several hours", but "for permanent situations… we recommend powered operation using an appropriate USB-C hub". The interfaces were tested with GarageBand, Cubasis 2, Auria Pro, Ampify and FL Studio (snippet). — [Focusrite: The Focusrite Sound: Now On iPad Pro](https://us.focusrite.com/articles/the-focusrite-sound-now-on-ipad-pro/); [MusicTech news](https://www.musictech.net/news/ipad-pro-3rd-generation-scarlett-audio-interfaces/); [SVG News 2020-06-12](https://www.sportsvideo.org/2020/06/12/focusrite-pro-releases-support-for-third-generation-scarlett-solo-scarlett-2i2-interfaces/)
- **Current Focusrite help centre:** officially supports "3rd generation Scarlett Solo, 2i2 & 4th Generation Solo, 2i2 and 4i4 with USB-C iPads". It lists three connection methods: a USB-C hub with Power Delivery, a USB-C to USB-A adapter, or a direct C-to-C cable (snippet). — [Focusrite support article 360012532199](https://support.focusrite.com/hc/en-gb/articles/360012532199)

**Lightning devices**
- Focusrite says to update the interface firmware first (on a computer), before connecting to an iPad. Lightning devices need an official Apple Lightning to USB 3 Camera Adapter or USB adapter **plus power**. "An iPhone or iPad cannot bus-power the interface." The connection order matters, and audio "can be glitchy on iOS" (snippet). — [Focusrite support article 115005430409](https://support.focusrite.com/hc/en-gb/articles/115005430409); [Focusrite support article 206849159](https://support.focusrite.com/hc/en-gb/articles/206849159)
- **Old iOS bug:** iOS 14.5–14.8 blocked USB audio interfaces on iPhone through the Lightning USB 3 adapter; iOS 15 fixed it (PreSonus KB; generic). — [PreSonus iOS compatibility](https://support.presonus.com/hc/en-us/articles/360059975732-PreSonus-Hardware-iOS-iPadOS-Compatibility)

**cpal on Apple platforms**
- cpal 0.18.2 changes:
  - "iOS: Timestamps now include hardware latency and update when the audio route changes."
  - "iOS: Streams now resume automatically when an audio session interruption ends."
  - CoreAudio reports xruns.

  — [cpal CHANGELOG](https://static.crates.io/crates/cpal/cpal-0.18.2.crate)

**macOS Low Latency kext (for completeness)**
- Focusrite once offered a macOS "Low Latency" kext that "alters the audio buffer of the Mac Core Audio driver in order to further reduce latency". It is a separate, older, Mac-only tool (snippet). — [Focusrite support article 208736249](https://support.focusrite.com/hc/en-gb/articles/208736249)

### Inferences
- **Engine portability:** keep the engine behind a host-agnostic trait. ASIO on Windows, CoreAudio on macOS/iOS through cpal, and WASAPI as a Windows fallback when no ASIO driver exists. Design for the **reported input and output latencies** as a common abstraction, because cpal now folds hardware latency into timestamps on ASIO, CoreAudio and iOS.
- **Tauri on iOS:** Tauri 2 supports mobile targets. An iOS version would need AVAudioSession configuration (category playAndRecord, preferred IO buffer duration) and microphone permission. Those were not researched here.

### Gaps
- No measured RTL for the Solo 3rd Gen on macOS or iOS was found. 18i20 3rd Gen on macOS: 6.125 ms at 48k/32 (different model).
- Not confirmed:
  - the firmware version needed for USB-C iPad support
  - whether a Solo 3rd Gen with **phantom power on** stays within iPad bus-power limits

---

## 7. Known problems: crackles at small buffers, USB power management, Focusrite Notifier, clock issues

### Takeaway
The commonly reported causes of Windows crackles and dropouts with 3rd Gen Scarletts are system-level (DPC latency, power management, GPU drivers, hubs or long cables) rather than the interface itself. The usual fixes:
- High/Ultimate Performance power plan
- disable USB selective suspend and PCIe link-state power management
- untick "allow the computer to turn off this device"
- direct ports, no unpowered hubs
- larger buffer, or Safe Mode

The **Focusrite Notifier** is the control surface for buffer size, Safe Mode, the latency readout and the clock "SYNCED" status. If the sample rate changes underneath the app (another app or the Notifier), the app must handle the resync or reset messages.

### Cited Findings
**Crackles and dropouts**
- A Microsoft Q&A thread from a laptop with a **3rd Gen Scarlett Solo** lists:
  - the Ultimate Performance power plan
  - disable USB selective suspend and PCI Express Link State Power Management
  - disable NVIDIA latency-affecting options

  The poster had already tried the Windows sound and USB power settings without success. — [Microsoft Learn Q&A](https://learn.microsoft.com/en-us/answers/questions/5558646/problem-with-the-operation-of-any-external-audio-i)
- A third-party guide says Windows putting the Focusrite into a low-power state and waking it "can leave the driver in a confused state". Fix: in Device Manager → USB Root Hub → Power Management, untick "Allow the computer to turn off this device to save power" (snippet). — [TCNO hub guide](https://hub.tcno.co/audio/hardware/fix-focusright/)
- Rational Acoustics warns that multi-port hubs can be overloaded by USB-powered interfaces that also supply phantom power, naming the Focusrite Scarlett series. — [Rational Acoustics support](https://support.rationalacoustics.com/support/solutions/articles/150000091757--windows-audio-device-disconnects-or-stops-working-after-inactivity-within-smaart)
- Users report:
  - a 3rd Gen Clarett/Scarlett misbehaving with USB cables over 6 ft (snippet)
  - glitches unless the buffer is 512 or more (snippet; anecdotal)

  — [KVR "Audio Issues" thread](https://www.kvraudio.com/forum/viewtopic.php?p=8408214)
- VoiceMeeter users report crackling when an ASIO DAW (FL Studio) opens the 4i4 3rd Gen while VoiceMeeter also uses it. The rate or buffer was being changed by the second client (snippet; different model). — [VB-Audio forum](https://forum.vb-audio.com/viewtopic.php?p=7680)

**Focusrite Notifier**
- The Notifier replaced the old ASIO Control Panel (4.65.5). Safe Mode and the latency readout were added in 2022. Clock status was renamed LOCKED → SYNCED (snippets). — [June 2022 release notes PDF](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/Focusrite%20driver%20release%20notes%20-%20June%202022.pdf); [4.65.5 notes PDF](https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/downloads/Windows%20USB%20Driver%204.65.5%20-%20Release%20Notes_0.pdf)

**How cpal surfaces these problems**
- cpal 0.18.0 maps `kAsioOverload` to an overrun report, sends `StreamInvalidated` on `kAsioResyncRequest` or a sample-rate change, and handles `kAsioBufferSizeChange` and `kAsioResetRequest` (the latter since 0.17.0, "to prevent driver UI becoming unresponsive"). — [cpal CHANGELOG](https://static.crates.io/crates/cpal/cpal-0.18.2.crate)

### Inferences
**App features to build**
- A **"glitch counter"**, fed by cpal xrun/overrun errors plus record-ring overflow counts.
- A **"rebuild stream"** path on `StreamInvalidated`: re-query the rate, buffer and latencies, then restart.
- A **"Open driver settings"** button that calls `ASIOControlPanel`, so the user can change the buffer or Safe Mode.
- A **first-run checklist** (power plan, USB power management, direct port, Direct Monitor off when monitoring through effects).
- **Default to 48 kHz**, matching the Windows default device, so system audio keeps working.
- **Default to a 64-sample buffer**; offer 32/16 for capable machines and 128/256 as safe options.

### Gaps
- Not covered by any Focusrite KB article I could read (support site blocked):
  - official advice on 3rd Gen crackles
  - the Notifier's behaviour when an ASIO app changes the rate
  - known USB-controller incompatibilities (e.g. some AMD or Intel chipsets)
- I found no clock-drift problems specific to the Solo 3rd Gen. With one device providing both input and output, there is a single clock, so no drift between record and playback is expected (an inference).
