"""Build the electric piano's recordings (public/keys/epiano/) from mda ePiano's sample table.

    python3 scripts/epiano-pack.py mdaEPianoData.h [OUT_DIR]

mdaEPianoData.h is part of mda ePiano by Paul Kellett (MIT; see NOTICE.md), for example from
github.com/elk-audio/mda-vst3 (source/mdaEPianoData.h). The table is written as it is, 16-bit
little-endian at 32 kHz (src/keys/tines.ts knows where each recording and its loop are), with a
manifest naming the file and its hash.
"""
import hashlib
import json
import os
import re
import sys

import numpy as np

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "keys", "epiano")
os.makedirs(out, exist_ok=True)
text = open(src).read()
body = text[text.index("epianoData[] = {") + len("epianoData[] = {"): text.rindex("};")]
table = np.array([int(x) for x in re.findall(r"-?\d+", body)], dtype="<i2")
path = os.path.join(out, "tines.bin")
table.tofile(path)
data = open(path, "rb").read()
manifest = dict(
    name="Electric piano", version=1, format="int16le", sampleRate=32000, length=len(table),
    files=[dict(file="tines.bin", bytes=len(data), sha=hashlib.sha256(data).hexdigest()[:12])],
    source="mda ePiano by Paul Kellett (MIT)",
)
with open(os.path.join(out, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=1)
print(f"{len(table)} samples, {len(data)} bytes")
