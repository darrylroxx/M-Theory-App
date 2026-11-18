# Music source separation (stems) for M-Theory: models, runtimes, streaming, fallbacks, Tauri integration

Researched 2026-11-18. Tags: [SRC] = read in the source file or page; [CALC] = computed or measured by the researcher; [SEC] = secondary source or search summary, not opened at its origin.
GPL tag for every source: **PORT** = the code may be copied, linked or ported into GPL-3.0-or-later code, keeping its notice. **REF** = use only as a formula or design reference, or the licence is unclear or incompatible.
Blocked from this sandbox: arxiv.org, export.arxiv.org, huggingface.co (403), dl.fbaipublicfiles.com (403), mixxx.org, dev.to, api.github.com for these repositories. Paper abstracts and Hugging Face model cards are therefore [SEC] (WebSearch) or missing.

## 1. Models: quality per stem, size, and licences of the code and the weights

### Takeaway
HT-Demucs v4 (`htdemucs`) is the best fit for M-Theory. It has about 40 M parameters (81 MB in f16), scores about 9.0 dB average SDR on MUSDB18-HQ, its code is MIT and it is ported to C++, ONNX, Rust/Burn and the browser. Its 6-stem variant adds a usable guitar stem and a poor piano stem. SCNet and BS/Mel-RoFormer score higher (SCNet-XL-IHF 10.08, BS-RoFormer 9.65 MUSDB-only), but SCNet has almost no runtime ports yet, and RoFormers are large (BS-RoFormer about 527 MB) and slow. Every code base is permissively licensed. Only UMX-L states a restrictive weight licence (CC BY-NC-SA 4.0); the other weights have no separate licence text, and much of their training data is non-commercial (MUSDB).

### Cited Findings
**Demucs (v4 Hybrid Transformer, v3 Hybrid), Meta. Code MIT. PORT**
- [SRC] Code licence: MIT, "Copyright (c) Meta Platforms, Inc."; README: "Demucs is released under the MIT license". The README gives no separate licence for the weights, which are downloaded from Meta's file host. The repository is no longer maintained (a fork lives at adefossez/demucs, "only important bug fixes"). — [LICENSE](https://github.com/facebookresearch/demucs/blob/main/LICENSE), [README](https://github.com/facebookresearch/demucs/blob/main/README.md)
- [SRC] htdemucs "achieves a SDR of 9.00 dB on the MUSDB HQ test set"; with sparse attention and per-source fine-tuning it reaches 9.20 dB, but that sparse model is not released. It was trained on "MUSDB HQ + an extra training dataset of 800 songs". — [README](https://github.com/facebookresearch/demucs/blob/main/README.md)
- [SRC] Released variants: `htdemucs` (default); `htdemucs_ft` ("will take 4 times more time but might be a bit better"; four per-source models); `htdemucs_6s` (adds piano and guitar: "okay quality for guitar, but a lot of bleeding and artifacts for the piano source"); `hdemucs_mmi` (v3, retrained on MUSDB plus 800 songs); `mdx` and `mdx_extra` (the latter trained with extra data "including MusDB test set"); `mdx_q` and `mdx_extra_q` (quantised). — [README](https://github.com/facebookresearch/demucs/blob/main/README.md), [remote/files.txt](https://github.com/facebookresearch/demucs/blob/main/demucs/remote/files.txt)
- [SRC] Overall SDR on MUSDB HQ from the README table: Open-Unmix 5.3; Demucs v2 6.3; KUIELAB-MDX-Net 7.5; Band-Split RNN 8.2 (no extra data) and 9.0 (1.7k extra mixes); Hybrid Demucs v3 7.7; Spleeter 5.9 (25k songs); HT Demucs fine-tuned v4 9.0 (800 songs). — [README](https://github.com/facebookresearch/demucs/blob/main/README.md)
- [SRC] SDR per stem from the C++ port on one MUSDB18-HQ test track (C++ is within about 0.1 dB of PyTorch):
  - htdemucs: vocals 8.37, drums 10.00, bass 4.02, other 7.47.
  - htdemucs_6s: vocals 8.40, drums 9.92, bass 4.52, other 0.17. "Other" is artificially low because guitar and piano are split out of it and MUSDB has no reference for them.
  - htdemucs_ft: vocals 8.68, drums 10.48, bass 4.59, other 7.37.
  — [SDR_scores.md](https://github.com/sevagh/demucs.cpp/blob/main/.github/SDR_scores.md)
- [SRC] MSST table on the separate "Multisong" set (not comparable with MUSDB):
  - HTDemucs4 with the official weights: average 9.16 (bass 11.76, drums 10.88, vocals 8.24, other 5.74).
  - HTDemucs4 6-stem: bass 11.22, drums 10.22, vocals 8.05; piano and guitar not scored.
  - Demucs3 mmi: average 8.88.
  — [pretrained_models.md](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/pretrained_models.md)
- [SRC] Sizes of the f16 ggml conversions: htdemucs 81 MB; htdemucs_6s 53 MB; each htdemucs_ft per-source model 81 MB (324 MB for all four); hdemucs_mmi 160 MB. — [demucs.cpp README](https://github.com/sevagh/demucs.cpp/blob/main/README.md)
- [CALC] Parameter counts from those f16 sizes (2 bytes per weight): htdemucs about 40 M; htdemucs_6s about 26 M; hdemucs_mmi about 80 M.
- [SRC] Other reported sizes: the Rust/Burn port lists htdemucs 84 MB, htdemucs_6s 84 MB and htdemucs_ft 333 MB ([demucs-rs README](https://github.com/nikhilunni/demucs-rs/blob/main/README.md)); an fp32 ONNX export is "約 172MB", about 172 MB ([demucs-web README](https://github.com/timcsy/demucs-web/blob/main/README.md)).

**Open-Unmix (UMX), Inria/sigsep. Code MIT (PORT). UMX-L weights are non-commercial (REF only; never bundle them).**
- [SRC] Each target is a 3-layer bidirectional LSTM that masks a magnitude spectrogram, followed by a multichannel Wiener filter. "Since the model takes information from past and future simultaneously, the model cannot be used in an online/real-time manner." — [README](https://github.com/sigsep/open-unmix-pytorch/blob/master/README.md), [LICENSE](https://github.com/sigsep/open-unmix-pytorch/blob/master/LICENSE)
- [SRC] `umxl` (the default) was "trained on private stems dataset of compressed stems. Note, that the weights are only licensed for non-commercial use (CC BY-NC-SA 4.0)" ([Zenodo 5069601](https://doi.org/10.5281/zenodo.5069601)). `umxhq` was trained on MUSDB18-HQ ([Zenodo 3370489](https://doi.org/10.5281/zenodo.3370489)) and `umx` on MUSDB18. — [README](https://github.com/sigsep/open-unmix-pytorch/blob/master/README.md)
- [SRC] Median SDR per stem on MUSDB18 (vocals / bass / drums / other):
  - UMX: 6.32 / 5.23 / 5.73 / 4.02
  - UMXHQ: 6.25 / 5.07 / 6.04 / 4.28
  - UMXL: 7.21 / 6.02 / 7.15 / 4.89
  — [README](https://github.com/sigsep/open-unmix-pytorch/blob/master/README.md)
- [SRC] Sizes: UMX-HQ 136 MB and UMX-L 432 MB in float32. umx.cpp quantises UMX-L ("mostly uint8, uint16 for the final four layers") and gzips it: "425 MB of UMX-L weights down to 45 MB, while achieving similar performance". — [umx.cpp README](https://github.com/sevagh/umx.cpp/blob/main/README.md)

**Spleeter, Deezer. Code MIT (PORT). Weight licence not stated (REF).**
- [SRC] Three models: 2stems (vocals and accompaniment), 4stems (vocals, drums, bass, other) and 5stems (adds piano). They are distributed through GitHub Releases. "The pre-trained models were trained on a large private dataset." Separation runs "100x faster than real-time when run on a GPU". The README's licence section says only "The code of Spleeter is MIT-licensed", plus a disclaimer to obtain authorisation for copyrighted material. The README also asks automated agents not to contact the maintainers about weight licensing, so this was not done. — [README](https://github.com/deezer/spleeter/blob/master/README.md), [Models wiki](https://github.com/deezer/spleeter/wiki/3.-Models)
- [SRC] 4stems SDR on the MUSDB test set (mask / multichannel Wiener filter): vocals 6.55 / 6.86; bass 5.10 / 5.51; drums 5.93 / 6.71; other 4.24 / 4.55. — [Separation-Performances wiki](https://github.com/deezer/spleeter/wiki/Separation-Performances)

**MDX-Net / UVR models. Code MIT (PORT). Weights: MIT with credit, according to UVR.**
- [SRC] kuielab/mdx-net code: MIT, "Copyright (c) 2020 KINoAI". — [LICENSE](https://github.com/kuielab/mdx-net/blob/main/LICENSE)
- [SRC] Ultimate Vocal Remover GUI: "UVR's core developers trained all of the models provided in this package (except for the Demucs v3 and v4 4-stem models)". "For all third-party application developers who wish to use our models, please honor the MIT license by providing credit to UVR and its developers." — [UVR README](https://github.com/Anjok07/ultimatevocalremovergui/blob/master/README.md)
- [CALC] Ready-made 2-stem ONNX files, sized with HEAD requests against [TRvlvr/model_repo](https://github.com/TRvlvr/model_repo/releases/tag/all_public_uvr_models): UVR-MDX-NET-Inst_HQ_3.onnx 66,759,214 B; Kim_Vocal_2.onnx 66,759,214 B; UVR-MDX-NET-Voc_FT.onnx 66,762,490 B; UVR_MDXNET_KARA_2.onnx 52,786,726 B. That is about 16.7 M fp32 parameters each.
- [SRC] MDX23C trained only on MUSDB18HQ scores a 7.15 average on the MUSDB test set (bass 5.77, drums 7.93, vocals 9.23, other 5.68). — [pretrained_models.md](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/pretrained_models.md)

**SCNet. Code MIT (PORT). Weights trained on MUSDB only (licence unclear, REF).**
- [SRC] starrytong/SCNet code: MIT (Copyright 2024 starrytong). The official checkpoint "was trained on the MUSDB dataset" and is hosted on Google Drive. — [README](https://github.com/starrytong/SCNet/blob/main/README.md), [LICENSE](https://github.com/starrytong/SCNet/blob/main/LICENSE)
- [SEC] Paper (ICASSP 2024, arXiv 2401.13276): 9.0 dB average SDR on MUSDB18-HQ without extra data, with "CPU inference time" about 48% of HT Demucs. Mid and high sub-bands are compressed more than the low band. — [arXiv abstract](https://arxiv.org/abs/2401.13276) (via WebSearch)
- [SRC] Checkpoints trained only on MUSDB18HQ, scored on the MUSDB test set (average; bass / drums / vocals / other):

  | Model | Average | Bass | Drums | Vocals | Other |
  |---|---|---|---|---|---|
  | SCNet Small (starrytong) | 9.03 | 8.89 | 10.44 | 9.90 | 6.89 |
  | SCNet Large (starrytong) | 9.70 | 9.38 | 11.15 | 10.94 | 7.31 |
  | SCNet XL | 9.80 | 9.23 | 11.51 | 11.05 | 7.41 |
  | SCNet XL IHF | 10.08 | 9.23 | 11.81 | 11.42 | 7.88 |

  — [pretrained_models.md](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/pretrained_models.md)
- [CALC] Checkpoint sizes from HEAD requests: SCNet-large_starrytong_fixed.ckpt 168,852,258 B (about 42 M parameters if fp32 and weights only); SCNet Masked Small 42,517,058 B (about 10.6 M).
- [SEC] One SCNet ONNX repository keeps five weights in float16 because all-int8 weights cost 2.6 dB on one song. — [audiojs/scnet](https://huggingface.co/audiojs/scnet) (via WebSearch)

**BS-RoFormer and Mel-Band RoFormer. Code MIT (lucidrains; MSST). Weights: community releases, licence unclear (REF).**
- [SRC] The lucidrains implementation is MIT (Copyright 2023 Phil Wang). It implements Band-Split RoFormer (arXiv 2309.02612) and Mel-Band RoFormer (arXiv 2310.01809), using axial attention across frequency bands and time with rotary embeddings; the example configuration uses dim=512 and depth=12. — [README](https://github.com/lucidrains/BS-RoFormer/blob/main/README.md), [LICENSE](https://github.com/lucidrains/BS-RoFormer/blob/main/LICENSE)
- [SRC] BS-RoFormer trained only on MUSDB18HQ scores a 9.65 average on the MUSDB test set (bass 8.48, drums 11.61, vocals 11.08, other 7.44). Vocal-only community checkpoints score on Multisong: BS-RoFormer ("viperx" edition) 10.87; Mel-RoFormer ("KimberleyJensen" edition) 10.98. — [pretrained_models.md](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/pretrained_models.md)
- [CALC] model_bs_roformer_ep_17_sdr_9.6568.ckpt is 527,385,512 B (about 132 M fp32 parameters).
- [SRC] On Windows with DirectML, RoFormers hit "DML allocator out of memory" and fall back to CPU. MDX .onnx models are "GPU-accelerated (CI-verified on NVIDIA T4/WDDM)". — [python-audio-separator README](https://github.com/nomadkaraoke/python-audio-separator/blob/main/README.md) (MIT, PORT)

**Band-Split RNN**
- [SRC] 8.2 dB without extra data and 9.0 dB with 1.7k extra mixes (from the Demucs README table, which cites arXiv 2209.15174). No official weights were found in the sources read.

**Training-data licence: MUSDB18**
- [SRC] MUSDB18 has 150 tracks (about 10 h):
  - 100 from DSD100, which is derived from a free multitrack library ("refer to this original resource for any question regarding your rights");
  - 46 from MedleyDB, "licensed under Creative Commons (BY-NC-SA 4.0)";
  - 2 from Native Instruments' free stems;
  - 2 from a remix competition, under CC BY-NC-SA 3.0.

  Access through Zenodo is granted manually "since the tracks can only be used for academic purposes". The `musdb` parser package itself is MIT. — [sigsep website musdb.md](https://github.com/sigsep/website/blob/master/content/datasets/musdb.md), [sigsep-mus-db README](https://github.com/sigsep/sigsep-mus-db/blob/master/README.md)

### Inferences
- For a painting app, a gap of 0.5 to 1 dB SDR matters far less than speed, size and portability. `htdemucs` (4 stems) is the default. `htdemucs_6s` is an option because its guitar stem is usable; its piano stem should be labelled experimental. `htdemucs_ft` costs 4× the time and 4× the download, which is not worth it for visuals.
- SCNet Small could become a faster alternative later: the [SEC] figure is 48% of HT-Demucs CPU time, its MUSDB-only checkpoint is about 42 MB and scores 9.03 dB. No ONNX, WebGPU or Rust port was verified, so it is a "watch" item.
- Licence ranking of the weights for a GPL app that downloads models:
  1. UVR MDX-Net ONNX: MIT with credit, but only 2 stems.
  2. Demucs htdemucs: MIT repository, no separate weight text. Trained partly on MUSDB (NC-licensed tracks) and 800 undisclosed songs.
  3. Spleeter: MIT repository, private training set.
  4. SCNet and RoFormer: MUSDB-only or undisclosed data, no weight licence.
  5. UMX-L: CC BY-NC-SA. Avoid it, because its NC term would add a restriction the GPL forbids for bundled parts.
- Whether weights trained on NC data are themselves encumbered is legally unsettled. The safe route is to keep weights out of the GPL installer, download them on demand after the user agrees, and show where each model came from.

### Gaps
- No released SDR for the htdemucs_6s piano and guitar stems; only the qualitative README remark exists.
- Paper abstracts for HTDemucs, BS-RoFormer, Mel-RoFormer and BSRNN could not be opened (arXiv blocked). Exact parameter counts are therefore estimated from file sizes.
- The licence texts on the Zenodo records for umxhq and umx, and any licence on the Spleeter release assets, were not read (hosts blocked).

## 2. Runtimes: demucs.cpp, free-music-demixer, ONNX (ort / onnxruntime-web), Rust ports; speed, threading, quantisation

### Takeaway
ONNX Runtime is the fastest portable route. A single htdemucs ONNX model runs at about 0.20× real time per segment on a strong 8-core laptop CPU (vendor benchmark), and GPU execution providers (DirectML, CUDA, CoreML) are reported at 5× or more faster. The hand-written demucs.cpp, and its WASM build in free-music-demixer, are 1.3 to 6× slower than real time and too slow for this use. For the Rust backend, the `ort` crate (MIT/Apache-2.0) with an STFT-outside ONNX export, or the ready crate `stem-splitter-core`, are the practical choices. `demucs-rs` (Burn, Apache-2.0) is a pure-Rust GPU alternative whose speed is not documented. In the browser, onnxruntime-web with WebGPU works only with specially prepared exports.

### Cited Findings
**demucs.cpp (C++17, Eigen, ggml format). MIT. PORT via FFI.**
- [SRC] Designed "for low-memory environments by sacrificing the speed of the Torch implementation". Library code must not use threads except through BLAS, because it is also compiled to single-threaded WASM. — [README](https://github.com/sevagh/demucs.cpp/blob/main/README.md), [PERFORMANCE.md](https://github.com/sevagh/demucs.cpp/blob/main/.github/PERFORMANCE.md), [LICENSE](https://github.com/sevagh/demucs.cpp/blob/main/LICENSE)
- [SRC] Measured on a 16-core / 32-thread Ryzen 5950X, 4-minute song:
  - single-model program with OMP 16: real 10m23s;
  - 4 std::threads × 4 OMP threads: real 4m09s;
  - v3 `hdemucs_mmi`, multi-threaded: 2m35s.

  The multi-threaded design splits the track into N sub-waveforms with 0.75 s overlap, then into 7.8 s segments. The code is "heavy on the for-loops and small matrix-vector ... multiplications", and the GPU (NVBLAS) branch was "not very useful". — [PERFORMANCE.md](https://github.com/sevagh/demucs.cpp/blob/main/.github/PERFORMANCE.md)
- [CALC] Real-time factor (RTF, processing time ÷ audio time) on that 16-core desktop: 623/240 = 2.6 (single); 249/240 = 1.04 (4×4 threads); 155/240 = 0.65 (v3).

**free-music-demixer (WASM in the browser). JS and WASM are MIT; the site's weights are "proprietary". REF for the weights.**
- [SRC] "An archived snapshot of an early demo ... no longer maintained". "The AI model weights and other website assets are proprietary and not covered by the MIT license". The current snapshot loads ONNX Runtime files such as `htdemucs.ort.gz`, which are not included. The earlier build was demucs.cpp compiled with Emscripten, unquantised f16 (htdemucs 81 MB, 6s 53 MB); "compression only gets down to ~70 MB". — [README](https://github.com/sevagh/free-music-demixer/blob/main/README.md), [LICENSE](https://github.com/sevagh/free-music-demixer/blob/main/LICENSE)
- [SRC] Browser timings: a roughly 7-minute MUSDB track took about 41 min single-threaded and about 9 min with 8 workers; a second track took about 20 min single and about 5 min with 8 workers (0.75 s overlap plus a weighted sum). — same README
- [CALC] Browser RTF ≈ 5.9 single-threaded and ≈ 1.3 with 8 workers. Not real time.

**ONNX export of HTDemucs**
- [SRC] demucs.onnx (MIT, 2024): HTDemucs' internal STFT and iSTFT are "not exportable to ONNX, so this basic export will usually fail". The fix moves `standalone_spec` (nfft 4096, hop 1024), magnitude (complex-as-channels), `standalone_ispec` and `standalone_mask` outside the network. The core graph then takes the time-domain mix plus the complex-as-channels spectrogram and returns (x, xt). The project converts the 4-source, 6-source and fine-tuned models to .onnx and .ort, and builds a minimal ONNX Runtime with only the needed operators. It claims it "should perform significantly faster" than demucs.cpp and can use the CUDA, WebGPU and WebNN execution providers. It publishes no timings. — [README](https://github.com/sevagh/demucs.onnx/blob/main/README.md), [LICENSE](https://github.com/sevagh/demucs.onnx/blob/main/LICENSE). PORT.
- [SRC] StemSplit/demucs-onnx (MIT, 2026) lists four export blockers and their fixes:
  1. `torch.stft` complex output, replaced by a Conv1d with precomputed kernels ("5×10⁻⁶ max abs diff");
  2. `model.segment = Fraction(39, 5)` = 7.8 s;
  3. a random positional-embedding shift, monkey-patched out;
  4. `aten::_native_multi_head_attention`, which has no ONNX symbolic.

  Its Hugging Face builds are described as "all MIT-licensed": htdemucs single 316 MB, 6s 258 MB, ft bag 1.26 GB. Each has an `*_fp16weights.onnx` variant at "~half the download", with identical runtime memory and latency. Single-stem mode is "4× faster, 75% less RAM". — [README](https://github.com/StemSplit/demucs-onnx/blob/main/README.md), [LICENSE](https://github.com/StemSplit/demucs-onnx/blob/main/LICENSE). PORT.
- [SRC] Vendor benchmark on an Apple M4 Pro (8-core CPU, no GPU):
  - ONNX Runtime CPU, single model: 1.59 s per 7.8 s segment, "RTF 0.20";
  - full ft bag: 6.4 s per segment, RTF 0.49;
  - PyTorch CPU single: 2.09 s per segment;
  - the ONNX graph runs at "1.31× the speed of PyTorch CPU";
  - "CUDA / DirectML / CoreML ONNX EPs are all ≥ 5× faster than the CPU EP". — same README
- [CALC] Cross-check: 1.59/7.8 = 0.204, which matches. Its "~22 s per 3-min song" cannot be right, because 180 s needs at least 23 segments, so at least 37 s (about 49 s with 25% overlap). Use the per-segment figure.
- [CALC] Why the 316 MB single model is larger than the 172 MB fp32 export: Conv1d STFT kernels for nfft 4096 hold 4096 × 2 × 2049 ≈ 16.8 M floats ≈ 67 MB each way, about 134 MB in total. That plausibly explains the difference.

**ONNX Runtime from Rust and from the web**
- [SRC] `ort` crate v2.0.0-rc.15: licence "MIT OR Apache-2.0", wraps ONNX Runtime 1.31.0, with feature-gated execution providers including `directml`, `cuda`, `openvino`, `xnnpack` and `webgpu`. — [README](https://github.com/pykeio/ort/blob/main/README.md), [Cargo.toml](https://github.com/pykeio/ort/blob/main/Cargo.toml). PORT.
- [SRC] stem-splitter-core v1.2.0 ("MIT OR Apache-2.0"): a Rust library using `ort = "=2.0.0-rc.11"`, symphonia and reqwest.
  - Model "htdemucs_ort_v1", fetched from a Hugging Face manifest and "cached ... with SHA-256 verification"; "~200MB disk space".
  - CUDA, CoreML, DirectML, oneDNN and XNNPACK auto-detected.
  - Download and split progress callbacks; `prepare_model` to pre-load; `manifest_url_override` to self-host.

  — [README](https://github.com/gentij/stem-splitter-core/blob/main/README.md), [Cargo.toml](https://github.com/gentij/stem-splitter-core/blob/main/Cargo.toml), [LICENSE-MIT](https://github.com/gentij/stem-splitter-core/blob/main/LICENSE-MIT). PORT.
- [SRC] demucs-web (MIT, npm `demucs-web`): htdemucs on onnxruntime-web with WebGPU or WASM. The model `htdemucs_embedded.onnx` is about 172 MB on Hugging Face. It needs SharedArrayBuffer, so the page must send `Cross-Origin-Embedder-Policy: require-corp` (and COOP). Its progress callback reports currentSegment and totalSegments. No speed figures are published. — [README](https://github.com/timcsy/demucs-web/blob/main/README.md), [LICENSE](https://github.com/timcsy/demucs-web/blob/main/LICENSE). PORT.
- [SEC] Stock HTDemucs ONNX exports fail on onnxruntime-web's WebGPU execution provider. A 6-stem WebGPU build needed constant folding because an embedded inverse STFT used `ConstantOfShape`, which that backend cannot run. Prepared builds exist: monteslu/htdemucs-ft-webgpu, monteslu/htdemucs-web-onnx ("mixed precision, 21-piece chained split"), kramp/htdemucs-6s-webgpu-onnx, and webnn/stem-separator (WebNN). — WebSearch results: [monteslu](https://huggingface.co/monteslu/htdemucs-ft-webgpu), [kramp](https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx), [webnn](https://huggingface.co/webnn/stem-separator) (not opened; Hugging Face blocked)

**Rust-native and other runtimes**
- [SRC] demucs-rs (Apache-2.0) is a "native Rust implementation of HTDemucs v4" on Burn.
  - Backends: Metal, Vulkan (Linux and Windows) and WebGPU through wgpu. The same `demucs-core` crate builds natively and for wasm32.
  - Weights are downloaded from Hugging Face on first use.
  - "The WebAssembly build is significantly slower than the native CLI due to WebGPU overhead and WASM constraints."
  - No timings published. Its VST3/CLAP plugin is macOS-only.

  — [README](https://github.com/nikhilunni/demucs-rs/blob/main/README.md), [LICENSE](https://github.com/nikhilunni/demucs-rs/blob/main/LICENSE). PORT (Apache-2.0 → GPL-3.0 is compatible; keep notices).
- [SRC] Intel OpenVINO plugins for Audacity (GPL-3.0): "Meta's Demucs v4 model ... ported to work with OpenVINO", 2-stem or 4-stem, on CPU, GPU or NPU. The first load compiles for the device ("usually takes 10 to 30 seconds") and is then cached. — [README](https://github.com/intel/openvino-plugins-ai-audacity/blob/main/README.md), [music_separation doc](https://github.com/intel/openvino-plugins-ai-audacity/blob/main/doc/feature_doc/music_separation/README.md), [LICENSE.txt](https://github.com/intel/openvino-plugins-ai-audacity/blob/main/LICENSE.txt). PORT (GPL-3.0).
- [SEC] No Candle or tract port of Demucs was found in one search.

**Quantisation**
- [CALC] umx.cpp's UMX-L at uint8/16 compared with float, on one track: vocals 6.836 vs 6.830, drums 7.434 vs 7.425, bass 2.445 vs 2.462, other 6.234 vs 6.197. All differences are 0.04 dB or less. — numbers from the [umx.cpp README](https://github.com/sevagh/umx.cpp/blob/main/README.md)
- [SRC] For HTDemucs, the free-music-demixer author found "anything smaller [than f16] affects the quality". f16 weights halve the download "with identical runtime memory/latency" (StemSplit). — the two READMEs above
- [SEC] Selective static INT8 (only cross-transformer Conv, MatMul and Gemm) reportedly costs about 0.03 dB on htdemucs (8.34 vs 8.37); full INT8 "would wreck" quality. This comes from an unverified personal Hugging Face card ([itamiArika/htdemucs-int8-memory](https://huggingface.co/itamiArika/htdemucs-int8-memory)). The DiffQ / Demucs v2 papers report about 120 MB with about 0.03 dB loss ([arXiv 2104.09987](https://arxiv.org/pdf/2104.09987)). Both via WebSearch.

**Reference speeds**
- [SRC] PyTorch CPU: "processing time should be roughly equal to 1.5 times the duration of the track". GPU: needs at least 3 GB, about 7 GB with default settings. — [Demucs README](https://github.com/facebookresearch/demucs/blob/main/README.md)
- [SEC] One i5-12400F (6-core desktop) CPU-only run: 187.8 s for a 6 min 24 s file, which is RTF ≈ 0.49 [CALC]. Unsourced guide figures for laptops: htdemucs on an i7 about 8 min and on an i5 about 15 min per 4-minute song. — WebSearch summary of [stemsplit.io guide](https://stemsplit.io/blog/demucs-local-setup-guide) and [SBRT paper](https://biblioteca.sbrt.org.br/articlefile/4978.pdf) (not opened)

### Inferences
- Expected RTF of `htdemucs` with ONNX Runtime on the CPU of an ordinary 4-core Windows laptop: about 0.5 to 1.0 at 25% overlap. This is extrapolated from 0.27 effective on an M4 Pro and 0.49 for PyTorch on a 6-core desktop, so it must be measured. It is roughly break-even with playback. A DirectML GPU path, if the [SEC] "≥5×" holds, gives about 0.1 to 0.2.
- Memory: ONNX Runtime CPU for one 7.8 s segment fits in a few hundred MB. The vendor says single-stem mode uses 75% less RAM. The ft bag is about 4× that.
- Ruled out: demucs.cpp (FFI work for a slow result) and RoFormers (about 527 MB checkpoints, DirectML memory failures).
- The minimal path is the `ort` crate with the `directml` feature and CPU fallback, an ONNX export with STFT outside the graph (recipe from demucs.onnx or StemSplit), and STFT/iSTFT in Rust via `realfft`/`rustfft`.
- The fastest path is to depend on `stem-splitter-core` directly. Check that its `ort` version pin (rc.11) is compatible with any other `ort` use in the app.

### Gaps
- No measured htdemucs ONNX speed on a Windows 4-core laptop CPU, or on DirectML, was found. The "≥5×" GPU figure is the vendor's own.
- No published speed for demucs-rs, for onnxruntime-web WebGPU on HTDemucs, or for SCNet ONNX.
- The licence of ONNX Runtime itself (MIT, according to general knowledge) was not read from source.

## 3. Streaming: segment length, overlap and crossfade, first-output latency, keeping ahead of playback

### Takeaway
HTDemucs works in fixed 7.8 s segments (343,980 samples at 44.1 kHz). Segments overlap by 25% by default and are cross-faded with triangular weights. The model always pads input to the full 7.8 s, so the earliest output arrives one full segment's compute after start: about 1.6 s on a fast CPU, an estimated 4 to 8 s on a 4-core laptop. A 3-minute song (about 31 segments) separates faster than it plays only if the effective RTF is below 1. Otherwise playback needs a pre-roll of T × (RTF − 1), and the lightweight fallbacks should paint in the meantime.

### Cited Findings
- [SRC] "Hybrid Transformer models only support a maximum segment length of 7.8 seconds"; `--overlap` defaults to 0.25 and "can probably be reduced to 0.1 to improve a bit speed"; `--shifts` multiplies the time. — [Demucs README](https://github.com/facebookresearch/demucs/blob/main/README.md)
- [SRC] Chunking in apply.py:
  - `segment_length = samplerate*segment`, `stride = int((1 - overlap) * segment_length)`;
  - weight = `cat(arange(1, L//2+1), arange(L - L//2, 0, -1))`, normalised and raised to `transition_power` (default 1, giving a linear cross-fade);
  - outputs are added with these weights, then divided by the summed weight.

  — [apply.py](https://github.com/facebookresearch/demucs/blob/main/demucs/apply.py). PORT (MIT); easy to re-implement.
- [SRC] With `use_train_segment` at inference, HTDemucs pads shorter input up to `training_length = int(self.segment * self.samplerate)` and runs the iSTFT at that length. demucs.onnx pads the same way (`F.pad(padded_mix, (0, training_length - ...))`). A shorter first chunk therefore saves no compute. — [htdemucs.py L530-541](https://github.com/facebookresearch/demucs/blob/main/demucs/htdemucs.py), [demucs.onnx README](https://github.com/sevagh/demucs.onnx/blob/main/README.md)
- [SRC] Defaults: `HTDemucs` nfft = 4096, hop = 1024, samplerate 44100; `segment = Fraction(39, 5)`. — [htdemucs.py](https://github.com/facebookresearch/demucs/blob/main/demucs/htdemucs.py), [StemSplit README](https://github.com/StemSplit/demucs-onnx/blob/main/README.md)
- [SRC] demucs.cpp logs "mix: 2, 343980" per segment, and demucs.onnx processes a 60 s file as 11 segments. — [demucs.cpp README](https://github.com/sevagh/demucs.cpp/blob/main/README.md), [demucs.onnx README](https://github.com/sevagh/demucs.onnx/blob/main/README.md)
- [SRC] UMX in umx.cpp streams its LSTM per chunk ("sequence length is the chunk length") with similar SDR. The original bidirectional UMX "cannot be used in an online/real-time manner". — [umx.cpp README](https://github.com/sevagh/umx.cpp/blob/main/README.md), [UMX README](https://github.com/sigsep/open-unmix-pytorch/blob/master/README.md)
- [SEC] Truly real-time low-latency separation exists in research: HS-TasNet (ICASSP 2024) reaches 23 ms latency at 4.65 dB SDR on MUSDB (5.55 with extra data), and a reviewer says the Small version runs on one CPU core. No public weights were found. — [arXiv 2402.17701](https://arxiv.org/abs/2402.17701) (via WebSearch)
- [SRC] python-audio-separator also splits very long files into 5- to 10-minute chunks (`--chunk_duration`) to cap memory. — [README](https://github.com/nomadkaraoke/python-audio-separator/blob/main/README.md)

### Inferences
- [CALC] Cost of overlap = 1/(1 − overlap): ×1.33 at 0.25 and ×1.11 at 0.10. A 3-minute song (180 s) needs ⌈(180 − 7.8)/5.85⌉ + 1 = 31 segments at 25% overlap, or about 26 at 10%.
- [CALC] First-output latency is the time to decode the file plus one segment's compute: 1.59 s on the M4 Pro figure, and an estimated 4 to 8 s on a 4-core laptop CPU. Each further 5.85 s of output (the stride) costs one more segment.
- [CALC] Keeping ahead. Let r be the effective RTF, including overlap.
  - If r < 1, start playback after the first segment; the lead then grows by (1 − r) seconds per second of audio.
  - If r ≥ 1, the pre-roll needed is W ≈ T·(r − 1) + one segment's compute. For T = 180 s: r = 1.3 gives about 54 s; r = 2 gives about 180 s.
- Scheduling plan:
  - Separate the whole file in the background as soon as it is loaded, before Play.
  - Keep segments in time order.
  - Use `max(1, physical_cores/ORT_intra_threads)` workers that take consecutive segments. This follows demucs.cpp's sub-waveform parallelism, but keeps workers on the frontier near the playhead first.
  - If the user seeks, re-prioritise the queue from the playhead.
  - Paint each layer from its stem where the stem exists, and from the fallback (section 4) where it does not yet, cross-fading the two at the boundary.
- Overlap of 0.1 is a good default for visuals: it is 17% cheaper than 0.25. Seams are hidden by the linear cross-fade; the quality impact was not measured.
- Model output stays at 44.1 kHz. Resample other files to 44.1 kHz first (Demucs README: "Audio is resampled on the fly if necessary").

### Gaps
- No source measured how quality changes with overlap 0.1 against 0.25 for HTDemucs.
- No measured first-segment latency on Windows hardware or WebView2 WebGPU.

## 4. Lightweight non-neural fallbacks: HPSS, REPET / REPET-SIM, mid/side and band splits

### Takeaway
Median-filter HPSS (Fitzgerald 2010; Driedger 2014 margins) cleanly gives a "drums/transients vs sustained/harmonic" pair and has real-time variants. REPET-SIM gives a "repeating accompaniment vs non-repeating (often vocal) foreground" pair. Mid/side and a low-band split separate "centre (vocal, kick, bass)" from "wide" content and "bass" from the rest. None of these approaches neural SDR (the oracle IRM for vocals is only 9.27 dB, and the fallbacks are far below), but together they are good enough to drive separate paint layers instantly while the model runs or when it is not installed.

### Cited Findings
- [SRC] librosa `decompose.hpss` (ISC, "Copyright (c) 2013--2026, librosa development team") cites Fitzgerald, "Harmonic/percussive separation using median filtering", DAFx-10, and Driedger, Müller and Disch, "Extending harmonic-percussive separation of audio", ISMIR 2014.
  - Defaults: kernel_size = 31, power = 2.0, margin = 1.0.
  - harm = median_filter along time; perc = median_filter along frequency (mode "reflect").
  - `mask_harm = softmask(harm, perc*margin_h, power)`, `mask_perc = softmask(perc, harm*margin_p, power)`.
  - margin > 1 leaves a residual R ("typical range is between 1 and 10").
  - Examples: kernel_size = (13, 31); margin = 3.0; margin = (1.0, 5.0) for a cleaner percussive layer.

  — [decompose.py](https://github.com/librosa/librosa/blob/main/librosa/decompose.py), [LICENSE.md](https://github.com/librosa/librosa/blob/main/LICENSE.md). PORT (ISC).
- [SRC] Real-time HPSS is already researched for this app (sevagh/Real-Time-HPSS, MIT): sliding STFT with nwin 1024, nfft 2048, hop 512, β = 2. The harmonic kernel is `round(0.2/((nfft−hop)/fs))` frames and the percussive kernel `round(500/(fs/nfft))` bins; masks are hard (`H/(P+eps) > β`). The harmonic side needs about 45 to 100 ms of history; the percussive side is instant. — see `research_notes/Realistic paint and sound painting/live_audio_analysis.md` §2.2, citing [hpss_rt.py](https://github.com/sevagh/Real-Time-HPSS/blob/master/python/hpss_rt/hpss_rt.py). PORT (MIT).
- [SRC] librosa's vocal-separation example ("Code source: Brian McFee, License: ISC") is "based on the REPET-SIM method of Rafii and Pardo, 2012":
  - `S_filter = nn_filter(S_full, aggregate=np.median, metric='cosine', width=frames(2 s))`, then `S_filter = min(S_full, S_filter)`;
  - margin_i = 2, margin_v = 10, power = 2;
  - `mask_i = softmask(S_filter, margin_i*(S_full − S_filter))`;
  - `mask_v = softmask(S_full − S_filter, margin_v*S_filter)`.

  — [plot_vocal_separation.py (0.10.2)](https://github.com/librosa/librosa/blob/0.10.2/docs/examples/plot_vocal_separation.py). PORT (ISC).
- [SRC] nussl (MIT, Interactive Audio Lab) `Repet`:
  - takes the repeating period from the beat-spectrum peak, searched between min_period 0.8 s and max_period 8 s (at most duration/3);
  - takes the median of period-length spectrogram slices as the background;
  - soft mask with threshold 0.5; foreground = 1 − background;
  - a 100 Hz high-pass cutoff keeps the low end in the background.

  `RepetSim`: cosine self-similarity, up to 100 most similar frames, at least 1 s apart, threshold 0, median of them. nussl also ships HPSS, FT2D, timbre clustering and Melodia primitives. — [repet.py](https://github.com/nussl/nussl/blob/master/nussl/separation/primitive/repet.py), [repet_sim.py](https://github.com/nussl/nussl/blob/master/nussl/separation/primitive/repet_sim.py), [primitive/__init__.py](https://github.com/nussl/nussl/blob/master/nussl/separation/primitive/__init__.py), [LICENSE.md](https://github.com/nussl/nussl/blob/master/LICENSE.md). PORT (MIT).
- [SEC] The oracle ideal ratio mask scores 9.27 dB for vocals on MUSDB, the upper bound for any magnitude mask. — WebSearch summary ([arXiv 2010.09453](https://arxiv.org/pdf/2010.09453v2))

### Inferences
- [CALC] A cheap 4-layer "stem-like" split, all in the STFT domain on 2048/512 frames at 44.1 kHz:
  1. **drums** = HPSS percussive mask (Driedger margin_p ≈ 2 to 3).
  2. **bass** = harmonic part below about 150 to 250 Hz. A cutoff, not a separation; kick-drum energy goes to "drums" through HPSS.
  3. **vocal-ish** = harmonic part, mid channel M = (L+R)/2, 200 Hz to 8 kHz, multiplied by the REPET-SIM foreground mask. Leading vocals are usually panned centre, but so are bass, kick and snare.
  4. **other** = remainder (harmonic side S = (L−R)/2 plus the REPET background).

  Each layer only needs magnitudes for painting; no iSTFT is needed unless the layer is played back.
- REPET-SIM's 2 s minimum distance and its whole-song similarity search make it offline. It can run once over the decoded file in a few seconds, versus minutes for neural models. HPSS percussive and mid/side/band splits can run live in the existing Web Audio analysis path.
- Expected quality: good for "transient vs sustained" (drums vs harmonic) and "low vs high". Weak for "vocals vs guitar/synth leads", since held synths and sustained guitars also count as "non-repeating" or "harmonic". Present these layers as approximate in the UI.
- Mid/side and band-split formulas are standard signal arithmetic [CALC]. No source was read for them, and none is needed for licensing.

### Gaps
- No SDR numbers were found for HPSS or REPET baselines on MUSDB (the SiSEC 2018 analysis repository README has no tables; the paper hosts are blocked).
- The kernel-length recommendations in the Fitzgerald and Driedger papers themselves were not read.
- No source was read for centre-channel extraction (the Audacity "Vocal Reduction and Isolation" plug-in source path was not found on raw GitHub).

## 5. Practical integration in a Tauri 2 app (shipping vs downloading, hosting, checksums, threading and progress, caching, legal notes) and the recommended plan

### Takeaway
Do not bundle model weights in the GPL installer. Download one model on demand (htdemucs: about 81 MB f16 or about 172 MB fp32 ONNX) from a pinned URL. Verify it against a SHA-256 manifest, store it in the app's cache directory, and run separation in a Rust background thread through `ort` (DirectML, then CPU). Stream progress and finished segments to the webview over a `tauri::ipc::Channel`, cache the stems per file hash, and paint fallback layers until the stems arrive.

### Cited Findings
- [SRC] Tauri 2 HTTP headers (since 2.1.0): `app.security.headers` can set COOP "same-origin" and COEP "require-corp" "to allow for the use of SharedArrayBuffer". This is needed only for multi-threaded WASM such as onnxruntime-web; M-Theory's tauri.conf.json currently has `"security": { "csp": null }` [SRC, local file]. — [http-headers.mdx](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/security/http-headers.mdx), `src-tauri/tauri.conf.json`
- [SRC] Tauri events are "not designed for low latency or high throughput" and carry JSON-string payloads. Channels "are designed to be fast and deliver ordered data", and Tauri uses them internally for download progress and child-process output. — [calling-frontend.mdx](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/develop/calling-frontend.mdx)
- [SRC] Sidecars (`bundle.externalBin`) can bundle an external CLI such as a pyinstaller app. This is an alternative route, but large. — [sidecar.mdx](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/develop/sidecar.mdx)
- [SRC] The app's Rust side currently uses tauri 2, tauri-plugin-updater, tauri-plugin-process, cpal 0.18 (with an `asio` feature on Windows) and hound 3.5. There is no ML runtime yet. — `src-tauri/Cargo.toml` (local)
- [SRC] GitHub Releases: "Each file included in a release must be under 2 GiB. There is no limit on the total size of a release, nor bandwidth usage"; up to 1000 assets per release. — [about-releases.md](https://github.com/github/docs/blob/main/content/repositories/releasing-projects-on-github/about-releases.md), [variables/large_files.yml](https://github.com/github/docs/blob/main/data/variables/large_files.yml), [variables/releases.yml](https://github.com/github/docs/blob/main/data/variables/releases.yml)
- [SRC] Existing hosting patterns:
  - stem-splitter-core: Hugging Face manifest, SHA-256 verified, system cache directory, override URL.
  - demucs-rs: Hugging Face, "downloaded automatically ... and cached".
  - demucs.cpp: Hugging Face dataset Retrobear/demucs.cpp.
  - ZFTurbo and UVR: GitHub Releases.

  — [stem-splitter-core](https://github.com/gentij/stem-splitter-core/blob/main/README.md), [demucs-rs](https://github.com/nikhilunni/demucs-rs/blob/main/README.md), [demucs.cpp](https://github.com/sevagh/demucs.cpp/blob/main/README.md), [MSST models](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/pretrained_models.md)
- [SRC] OpenVINO compiles a model per device on first load (10 to 30 s) and caches it. ONNX Runtime DirectML or WebGPU sessions also have a first-run cost; plan a "warming up" state. — [OpenVINO doc](https://github.com/intel/openvino-plugins-ai-audacity/blob/main/doc/feature_doc/music_separation/README.md)
- [SRC] Licence attribution duties: UVR asks third parties using its models to credit "UVR and its developers"; python-audio-separator repeats this. — [UVR README](https://github.com/Anjok07/ultimatevocalremovergui/blob/master/README.md), [audio-separator README](https://github.com/nomadkaraoke/python-audio-separator/blob/main/README.md)
- [SRC] Spleeter's disclaimer: "If you plan to use Spleeter on copyrighted material, make sure you get proper authorization from right owners beforehand." — [README](https://github.com/deezer/spleeter/blob/master/README.md)

**Source licence summary (code; weights noted separately)**

| Source | Code licence | Weight terms | GPL use |
|---|---|---|---|
| facebookresearch/demucs | MIT | none stated; MUSDB plus 800 private songs | PORT code; weights: download, attribute |
| sevagh/demucs.cpp, demucs.onnx, umx.cpp, free-music-demixer | MIT | f-m-d site weights "proprietary" | PORT code; REF those weights |
| StemSplit/demucs-onnx | MIT | HF builds stated "MIT-licensed" | PORT |
| timcsy/demucs-web | MIT | 172 MB ONNX on HF (derived from Meta) | PORT |
| nikhilunni/demucs-rs | Apache-2.0 | HF download (derived from Meta) | PORT |
| gentij/stem-splitter-core | MIT OR Apache-2.0 | HF manifest, SHA-256 | PORT |
| pykeio/ort | MIT OR Apache-2.0 | n/a | PORT |
| intel/openvino-plugins-ai-audacity | GPL-3.0 | Demucs v4 converted | PORT (GPL-3.0) |
| sigsep/open-unmix-pytorch | MIT | UMX-L CC BY-NC-SA 4.0 | PORT code; REF UMX-L |
| deezer/spleeter | MIT | not stated; private data | PORT code; weights unclear |
| kuielab/mdx-net, UVR GUI, python-audio-separator | MIT | UVR models: MIT with credit | PORT |
| ZFTurbo/MSST, lucidrains/BS-RoFormer, starrytong/SCNet | MIT | not stated; MUSDB-only or community data | PORT code; REF weights |
| librosa (HPSS, REPET-SIM example) | ISC | n/a | PORT |
| nussl (REPET, REPET-SIM) | MIT | n/a | PORT |
| sevagh/Real-Time-HPSS | MIT | n/a | PORT |
| MUSDB18 dataset | mixed; includes CC BY-NC-SA | academic use only | REF (do not redistribute) |

### Inferences
**Recommended plan**

1. **Model.** Use `htdemucs` (4 stems, about 9.0 dB MUSDB) as the default download. Offer `htdemucs_6s` ("+ guitar, + piano (experimental)") as a second, optional download. Keep `htdemucs_ft` out. Optionally offer UVR MDX-Net Inst_HQ_3 (MIT with credit, 66.8 MB, vocals/instrumental only) as a smaller 2-stem fallback.
2. **Runtime in Tauri.** Use Rust `ort` 2.x with the `directml` execution provider and CPU fallback. Do the STFT/iSTFT (nfft 4096, hop 1024, complex-as-channels) in Rust, port Demucs' triangular overlap-add, and use the ONNX export recipe of demucs.onnx or StemSplit (both MIT). Fastest start: depend on `stem-splitter-core` (MIT/Apache) and replace its manifest URL with M-Theory's own. Evaluate `demucs-rs` (Burn, Vulkan) as a pure-Rust alternative if ONNX Runtime DLL packaging on Windows is a problem.
3. **Browser build.** Use onnxruntime-web with a WebGPU-compatible export (prepared builds exist), falling back to the WASM execution provider. Threaded WASM needs COOP/COEP headers (Tauri 2.1+ `app.security.headers`; on the web host via server headers). Expect it to be slower than native and treat it as best-effort.
4. **Speed expectation** [CALC/inference]. On a 4-core laptop CPU the effective RTF is about 0.5 to 1.0, so a 3-minute song takes about 1.5 to 3 minutes, roughly as long as it plays. With a DirectML GPU it should take about 20 to 40 s. Always start separating at file load, show progress per segment, and paint fallback layers (section 4) until stems arrive.
5. **Chunking.** 7.8 s segments, overlap 0.1 to 0.25, linear cross-fade, processed in time order with a playhead-first queue. One `ort` session is shared; intra-op threads equal the number of physical cores, as demucs.cpp found for Eigen and OpenMP.
6. **Threading and progress.** Run a `tauri::async_runtime::spawn_blocking` job (or a dedicated `std::thread`), with a cancel flag checked between segments. A `Channel<SeparationEvent>` sends {segmentIndex, total, rtf, eta}, plus either per-segment downsampled envelopes (cheap, for painting) or the PCM.
7. **Caching** [CALC]. 3 min stereo float32 is 63.5 MB per stem: 254 MB for 4 stems, 381 MB for 6. As 16-bit WAV or FLAC it is about 32 MB per stem; for visuals only, per-band envelopes at 100 frames/s are well under 1 MB per stem. Key the cache on the SHA-256 of the decoded audio plus the model id and version, store it under the app cache directory, and let the user clear it.
8. **Hosting and integrity.**
   - Mirror the chosen ONNX weights as a GitHub Release asset on the project repository (each file under 2 GiB, no bandwidth limit), or point at the upstream Hugging Face file.
   - Ship a manifest inside the app: URL, size, SHA-256, licence and attribution text.
   - Verify after download and refuse on mismatch.
   - Downloading is opt-in, with the size shown. Weights are not in the installer, which keeps the GPL installer free of weights with unclear terms.
9. **Legal notes for users** (shown in the app):
   - Model provenance and licence: Demucs code MIT by Meta; trained on MUSDB18-HQ plus 800 internal songs.
   - Separated stems are derived from the user's file. Rights in the original recording are unaffected, so use stems for personal study and visualisation unless the user holds the rights (cf. Spleeter's disclaimer).
   - Credit UVR if its models are offered.
   - Never ship UMX-L (non-commercial).

### Gaps
- Not verified: WebGPU availability inside WebView2 on typical Windows machines, the DirectML speed of HTDemucs ONNX, the size of the `ort` DirectML runtime DLLs added to a Tauri installer, and whether `stem-splitter-core` builds cleanly on Windows MSVC alongside cpal/ASIO.
- No legal source was read on whether model weights trained on CC BY-NC data inherit NC terms; this remains unsettled.
- The Hugging Face model cards (fp16/WebGPU builds, int8 claims) could not be opened from the sandbox.
