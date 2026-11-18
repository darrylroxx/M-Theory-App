"""Build the app's piano (public/keys/piano/) from the Salamander Grand Piano V3 recordings.

    python3 scripts/piano-pack.py RAW_DIR [OUT_DIR]

RAW_DIR keeps the downloaded FLAC files (about 240 MB; they are fetched from GitHub the first time
and not committed). OUT_DIR defaults to public/keys/piano. Needs numpy, scipy and ffmpeg (with LAME).

What it does:
  - picks 30 keys (every minor third, A0 to C8) at five strengths (Salamander layers 2, 5, 9, 12
    and 15 of 16), and the string-resonance sounds the dampers make when keys are let go;
  - cuts the silence before the hammer (keeping 3 ms, faded in) and trims each note to a natural
    length (about 9.5 s in the bass down to 3.5 s at the top), fading the tail;
  - measures each note's pitch (from its partials, so the unison strings average out) and fits
    the instrument's stretch tuning;
  - measures loudness (ITU-R BS.1770 momentary maximum) and fits one smooth model of it across
    the keyboard and the layers: the natural step from soft to hard is kept, only the odd file
    that is louder or quieter than its neighbours is evened out;
  - for every layer above the softest, finds the lowpass that makes each note as bright as the
    softer layer's take of it: the player darkens notes played softer than a layer was recorded
    at, so brightness rises smoothly with velocity instead of in five steps (mixing two takes
    instead would cancel some partials: two strikes of a string are never in phase);
  - encodes MP3 (LAME VBR quality 2, 48 kHz), the one compact format both Chromium and Safari
    decode reliably with decodeAudioData, each file peak-normalised, its level in the manifest;
  - writes manifest.json (see src/keys/pack.ts) and a probe tone used to measure how much silence
    the browser's MP3 decoder puts in front of every file.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

import numpy as np
from scipy.signal import lfilter

SR = 48000
REPO = "https://raw.githubusercontent.com/sfzinstruments/SalamanderGrandPiano/master/Samples/"
NOTE_NAMES = ["A0", "C1", "D#1", "F#1", "A1", "C2", "D#2", "F#2", "A2", "C3", "D#3", "F#3", "A3", "C4", "D#4", "F#4",
              "A4", "C5", "D#5", "F#5", "A5", "C6", "D#6", "F#6", "A6", "C7", "D#7", "F#7", "A7", "C8"]
PC = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
# Salamander layers kept, with the MIDI velocity band each was recorded for (its centre is used).
LAYERS = [(2, 27, 34), (5, 44, 46), (9, 65, 72), (12, 89, 96), (15, 113, 120)]
REF = 2  # index of the reference layer (v9, mezzo-forte)
DAMPED_TOP = 88  # keys above this have no dampers on a grand
PREROLL = 0.003  # seconds kept before the hammer strike
TARGET_C4 = -20.0  # momentary-max loudness (LUFS) of C4 at the reference velocity
LAME_Q = os.environ.get("LAME_Q", "2")
# The recorded piano is stretch-tuned (bass flat, treble sharp, about -23 / +37 cents at the ends).
# Keeping 60% of that smoothed curve leaves octaves close to beatless for this piano's inharmonicity
# while staying near the equal-tempered pitch of the app's other instruments.
STRETCH_SCALE = 0.6


# ------------------------------------------------------------------------------------------ audio io
def read(path):
    """Decode any file to float stereo (n, 2) at 48 kHz through ffmpeg."""
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(out, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def encode(y, path):
    """Peak-normalise to -1 dBFS, encode MP3, return the normalisation gain in dB."""
    g = 10 ** (-1 / 20) / np.abs(y).max()
    z = np.ascontiguousarray((y * g).astype(np.float32))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-i", "-",
                    "-c:a", "libmp3lame", "-q:a", LAME_Q, "-map_metadata", "-1", "-id3v2_version", "0", path],
                   input=z.tobytes(), check=True)
    return 20 * np.log10(g)


# ITU-R BS.1770 K-weighting at 48 kHz (pre-filter shelf, then the RLB high-pass).
K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def max_momentary(x):
    """The loudest 400 ms (momentary loudness, LUFS), stepped every 100 ms."""
    k = lfilter(*K2, lfilter(*K1, x, axis=0), axis=0)
    p = (k ** 2).sum(axis=1)
    n, h = int(0.4 * SR), int(0.1 * SR)
    if len(p) < n:
        return float(-0.691 + 10 * np.log10(p.mean() + 1e-20))
    cs = np.concatenate([[0], np.cumsum(p)])
    starts = np.arange(0, len(p) - n + 1, h)
    return float((-0.691 + 10 * np.log10((cs[starts + n] - cs[starts]) / n + 1e-20)).max())


def lowpass(x, fc):
    """Web Audio's BiquadFilterNode lowpass at Q = -3.01 dB (Butterworth), as the player uses it."""
    w0 = 2 * np.pi * fc / SR
    alpha = np.sin(w0) / (2 * 10 ** (-3.0103 / 20))
    c = np.cos(w0)
    b = np.array([(1 - c) / 2, 1 - c, (1 - c) / 2])
    a = np.array([1 + alpha, -2 * c, 1 - alpha])
    return lfilter(b / a[0], a / a[0], x, axis=0)


def brightness(x):
    """Spectral centroid of the first 300 ms (the strike, where brightness is heard)."""
    m = x[: int(0.3 * SR)].mean(axis=1)
    sp = np.abs(np.fft.rfft(m * np.hanning(len(m))))
    return float((sp * np.fft.rfftfreq(len(m), 1 / SR)).sum() / sp.sum())


def soft_cutoff(y, softer, midi):
    """The lowpass cutoff (Hz) that makes `y` as bright as `softer`, or None if it is not brighter.
    Never below three times the fundamental: where a softer take is unusually dull (a few treble
    notes), the note keeps its first partials and is only darkened that far."""
    target = brightness(softer)
    if brightness(y) <= target * 1.02:
        return None
    floor = 3 * 440 * 2 ** ((midi - 69) / 12)
    head = y[: int(0.3 * SR)]
    lo, hi = np.log(100.0), np.log(20000.0)
    for _ in range(24):
        mid = (lo + hi) / 2
        if brightness(lowpass(head, np.exp(mid))) > target:
            hi = mid
        else:
            lo = mid
    return float(max(floor, np.exp((lo + hi) / 2)))


def fetch(raw):
    """Download the recordings this pack uses (skipping those already there)."""
    os.makedirs(raw, exist_ok=True)
    names = [f"{n}v{v}.flac" for n in NOTE_NAMES for v, _, _ in LAYERS]
    names += [f"harm{k}{n}.flac" for n in NOTE_NAMES if midi_of(n) <= DAMPED_TOP for k in "LS"]
    for i, name in enumerate(names):
        dest = os.path.join(raw, name)
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            continue
        print(f"[{i + 1}/{len(names)}] {name}", flush=True)
        with urllib.request.urlopen(REPO + urllib.parse.quote(name)) as r, open(dest + ".part", "wb") as f:
            f.write(r.read())
        os.replace(dest + ".part", dest)


# ------------------------------------------------------------------------------------------ analysis
def midi_of(n):
    m = re.match(r"([A-G]#?)(\d)", n)
    return 12 * (int(m.group(2)) + 1) + PC[m.group(1)]


def keep_seconds(midi):
    """How long each note is kept: about 9.5 s in the bass, falling to 3.5 s at the top."""
    return float(np.interp(midi, [21, 36, 48, 60, 72, 84, 96, 108], [9.5, 9.5, 8.5, 7.5, 6.5, 5.5, 4.2, 3.5]))


def onset(mono):
    a = np.abs(mono)
    floor = np.sqrt((mono[:150] ** 2).mean()) if len(mono) > 150 else 0
    return int(np.argmax(a > max(a.max() * 10 ** (-50 / 20), 4 * floor)))


def envelope(mono, win=2400):
    return np.sqrt(np.convolve(mono ** 2, np.ones(win) / win, mode="same"))


def trim(x, midi, keep=None, fade_frac=0.35, min_fade=0.8):
    """Cut the silence before the strike (keeping a short faded pre-roll) and fade the tail."""
    on = onset(x.mean(axis=1))
    start = max(0, on - int(PREROLL * SR))
    y = x[start:].copy()
    ramp = 0.5 - 0.5 * np.cos(np.pi * np.arange(on - start) / max(1, on - start))
    y[: on - start] *= ramp[:, None]
    env = envelope(y.mean(axis=1))
    ip = int(np.argmax(env))
    below = np.where((env < env[ip] * 10 ** (-66 / 20)) & (np.arange(len(env)) > ip))[0]
    natural = below[0] if len(below) else len(y)
    n = int(min(len(y), natural, (keep or keep_seconds(midi)) * SR))
    y = y[:n]
    nf = int(min(n * 0.9, max(min_fade * SR, fade_frac * n)))
    y[n - nf:] *= (0.5 + 0.5 * np.cos(np.pi * np.arange(nf) / nf))[:, None]
    return y


def partial_peaks(mono, midi):
    """Partial frequencies (power-weighted around each peak, so the unison strings average) and levels."""
    et = 440 * 2 ** ((midi - 69) / 12)
    n = int((1.0 if midi < 90 else 0.5) * SR)
    seg = mono[:n] if len(mono) >= n else np.pad(mono, (0, n - len(mono)))
    N = 1 << 21
    sp = np.abs(np.fft.rfft(seg * np.hanning(n), N)) ** 2
    df = SR / N
    out, f1, B = [], et, 0.0
    for k in range(1, max(1, min(12, int(6000 / et))) + 1):
        guess = k * f1 * np.sqrt(1 + B * k * k)
        w = 0.09 if k <= 3 else 0.02  # wide search for the first partials, narrow once the series is known
        lo, hi = int(guess * (1 - w) / df), int(guess * (1 + w) / df)
        if hi >= len(sp) - 2:
            break
        i = lo + int(np.argmax(sp[lo:hi]))
        r = int(i * 0.015)  # +-26 cents
        a, b = max(0, i - r), i + r + 1
        out.append((k, float((sp[a:b] * np.arange(a, b)).sum() / sp[a:b].sum() * df), float(sp[i])))
        ks = np.array([o[0] for o in out], float); fs = np.array([o[1] for o in out]); amp = np.array([o[2] for o in out])
        good = amp > amp.max() * 1e-3
        if good.sum() >= 3:  # fit f_k = k f1 sqrt(1 + B k^2) (a stiff string's partials)
            sol = np.linalg.lstsq(np.vstack([np.ones(good.sum()), ks[good] ** 2]).T, (fs[good] / ks[good]) ** 2, rcond=None)[0]
            if sol[0] > 0:
                f1, B = np.sqrt(sol[0]), max(0.0, sol[1] / sol[0])
        elif k == 1:
            f1 = out[-1][1]
    return out, et


def pitch_cents(mono, midi):
    """The note's heard pitch in cents from equal temperament: each partial's pitch (f_n / n), weighted by power."""
    ps, et = partial_peaks(mono, midi)
    ks = np.array([p[0] for p in ps], float); fs = np.array([p[1] for p in ps]); pw = np.array([p[2] for p in ps])
    keep = pw > pw.max() * 1e-3
    c = 1200 * np.log2(fs[keep] / ks[keep] / et)
    return float((c * pw[keep]).sum() / pw[keep].sum())


def main():
    raw = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "keys", "piano")
    fetch(raw)
    os.makedirs(out, exist_ok=True)

    # ---------------------------------------------------------------- sustain samples
    rows = []
    for name in NOTE_NAMES:
        midi = midi_of(name)
        for li, (v, _, _) in enumerate(LAYERS):
            x = read(os.path.join(raw, f"{name}v{v}.flac"))
            y = trim(x, midi)
            mono = y.mean(axis=1)
            rows.append(dict(midi=midi, layer=li, src=f"{name}v{v}", y=y, lufs=max_momentary(y), raw_lufs=max_momentary(x),
                             cents=pitch_cents(mono[int(0.25 * SR) if midi < 90 else int(0.06 * SR):], midi)))
            r = rows[-1]
            print(f"{r['src']:7s} m{midi:3d} L{li} dur {len(y) / SR:5.2f}s lufs {r['lufs']:6.1f} cents {r['cents']:+6.1f}", flush=True)

    # ---------------------------------------------------------------- tuning: smooth the instrument's own stretch
    pitches = sorted({r["midi"] for r in rows})
    per_pitch = np.array([np.median([r["cents"] for r in rows if r["midi"] == p]) for p in pitches])
    P = np.array(pitches, float)
    use = np.ones(len(P), bool)
    for _ in range(4):  # a cubic through the keys, dropping the odd key that is out of line with it
        coef = np.polyfit((P[use] - 60) / 12, per_pitch[use], 3)
        use = np.abs(per_pitch - np.polyval(coef, (P - 60) / 12)) < 12
    fit = lambda m: STRETCH_SCALE * float(np.polyval(coef, (m - 60) / 12) - np.polyval(coef, (69 - 60) / 12))  # A4 = 440 Hz
    stretch = [round(fit(m), 2) for m in range(21, 109)]

    # ---------------------------------------------------------------- loudness model
    # L(p, k) = S(p) + O_k(p): a smooth register curve plus a per-layer offset that may tilt with register
    # (the treble has a wider dynamic range than the bass), O_ref = 0.
    x_oct = lambda m: (m - 60) / 12
    A, b = [], []
    for r in rows:
        xo = x_oct(r["midi"])
        row = [1, xo, xo ** 2, xo ** 3]
        for li in range(len(LAYERS)):
            if li != REF:
                row += [1.0 if r["layer"] == li else 0.0, xo if r["layer"] == li else 0.0]
        A.append(row)
        b.append(r["lufs"])
    sol = np.linalg.lstsq(np.array(A), np.array(b), rcond=None)[0]
    S = lambda m: float(np.polyval(sol[3::-1], x_oct(m)))
    offs, j = [], 4
    for li in range(len(LAYERS)):
        if li == REF:
            offs.append((0.0, 0.0))
        else:
            offs.append((float(sol[j]), float(sol[j + 1])))
            j += 2
    O = lambda li, m: offs[li][0] + offs[li][1] * x_oct(m)
    # Voicing: keep the bass-to-treble balance, but halve the top's natural fall-off so a melody up there still reads.
    S72 = S(72)
    Sv = lambda m: S(m) + (0.5 * (S72 - S(m)) if m > 72 and S(m) < S72 else 0.0)
    shift = TARGET_C4 - Sv(60)

    samples = []
    for r in rows:
        li, m = r["layer"], r["midi"]
        fname = f"n{m:03d}v{li + 1}.mp3"
        norm = encode(r["y"], os.path.join(out, fname))
        # Per-file error against the fitted model, capped at 6 dB: some soft treble takes are genuinely weak,
        # and lifting them further would only lift their noise.
        d = float(np.clip(S(m) + O(li, m) - r["lufs"], -6, 6))
        # The gain takes the file (as encoded, peak at -1 dBFS) to the layer-free reference level of its key;
        # the player adds the velocity curve, which equals the layer's own offset at its centre.
        gain = d + (Sv(m) - S(m)) + shift - O(li, m) - norm
        sample = dict(note=m, layer=li, file=fname, gain=round(gain, 2), cents=round(r["cents"], 2), dur=round(len(r["y"]) / SR, 3))
        if li > 0:
            softer = next(q for q in rows if q["midi"] == m and q["layer"] == li - 1)
            fc = soft_cutoff(r["y"], softer["y"], m)
            if fc:
                # the cutoff at the layer's softest, and the loudness the filter takes away there (given back)
                sample["soft"] = round(fc)
                sample["softDb"] = round(r["lufs"] - max_momentary(lowpass(r["y"], fc)), 2)
        samples.append(sample)

    # ---------------------------------------------------------------- damper (string resonance) samples
    releases = []
    for name in NOTE_NAMES:
        m = midi_of(name)
        if m > DAMPED_TOP:
            continue
        for kind, ref_layer, vol, track in (("L", 2, -4.0, 0.92), ("S", 1, 0.0, 0.95)):
            x = read(os.path.join(raw, f"harm{kind}{name}.flac"))
            y = trim(x, m, keep=1.6, fade_frac=0.5, min_fade=0.6)
            # Level against the note it follows, as Salamander's own mapping sets it: the group volume plus
            # the difference between the two velocity tracks at the layer's own velocity.
            vref = (LAYERS[ref_layer][1] + LAYERS[ref_layer][2]) / 2
            sus = next(s for s in rows if s["midi"] == m and s["layer"] == ref_layer)
            rel_db = max_momentary(x) - sus["raw_lufs"] + vol + (track - 0.73) * 40 * np.log10(vref / 127)
            fname = f"r{m:03d}{kind.lower()}.mp3"
            norm = encode(y, os.path.join(out, fname))
            gain = float(Sv(m) + shift + rel_db - (max_momentary(y) + norm))
            # dB per second held: Salamander's rt_decay by register
            decay = 7.0 if kind == "S" else (6.0 if m <= 27 else 7.0 if m <= 36 else 8.0 if m <= 48 else 9.0)
            releases.append(dict(note=m, soft=kind == "S", file=fname, gain=round(gain, 2), decay=decay,
                                 cents=next(s["cents"] for s in samples if s["note"] == m and s["layer"] == ref_layer),
                                 dur=round(len(y) / SR, 3)))

    # ---------------------------------------------------------------- probe for the decoder's delay
    probe = np.zeros((int(0.3 * SR), 2))
    t0 = int(0.1 * SR)
    probe[t0:t0 + int(0.1 * SR)] = (0.5 * np.sin(2 * np.pi * 1000 * np.arange(int(0.1 * SR)) / SR))[:, None]
    encode(probe, os.path.join(out, "probe.mp3"))  # normalised to -1 dBFS: amplitude 0.891
    at = int(np.argmax(np.abs(probe[:, 0] * (10 ** (-1 / 20) / 0.5)) > 0.25)) / SR

    layers = []
    for li, (v, lo, hi) in enumerate(LAYERS):
        layers.append(dict(center=round((lo + hi) / 2 / 127, 4), db=[round(offs[li][0], 2), round(offs[li][1], 2)], src=f"v{v}"))
    for li in range(len(layers)):  # velocity bands meet halfway between centres
        lo = 0.0 if li == 0 else round((layers[li - 1]["center"] + layers[li]["center"]) / 2, 4)
        hi = 1.0 if li == len(layers) - 1 else round((layers[li]["center"] + layers[li + 1]["center"]) / 2, 4)
        layers[li]["vel"] = [lo, hi]

    manifest = dict(
        name="Grand piano", version=1, format="mp3", sampleRate=SR, preroll=PREROLL,
        range=[21, 108], dampedTop=DAMPED_TOP, maxShift=2,
        probe=dict(file="probe.mp3", at=round(at, 6)),
        stretch=stretch, layers=layers, samples=samples, releases=releases,
        source="Salamander Grand Piano V3 by Alexander Holm (CC BY 3.0), via github.com/sfzinstruments/SalamanderGrandPiano",
    )
    sha = lambda f: hashlib.sha256(open(os.path.join(out, f), "rb").read()).hexdigest()[:12]
    for s in manifest["samples"] + manifest["releases"]:
        s["bytes"] = os.path.getsize(os.path.join(out, s["file"]))
        s["sha"] = sha(s["file"])
    manifest["probe"]["sha"] = sha("probe.mp3")
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    total = sum(s["bytes"] for s in manifest["samples"] + manifest["releases"])
    print(f"{len(samples)} notes, {len(releases)} damper sounds, {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
