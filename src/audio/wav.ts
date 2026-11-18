/**
 * The song as a WAV file: 24-bit stereo, the way recording programs and streaming uploads
 * expect it. What rings on after the last bar is kept until it has died away.
 */

/**
 * Cut what is silent after the song (below about −90 dB), keeping a moment of air. Never shorter
 * than `min` frames (the song itself: quiet bars at its end are part of it).
 */
export function trimEnd(ch: Float32Array[], rate: number, min = 0, floor = 3e-5): Float32Array[] {
  let end = 0;
  for (const d of ch) for (let i = d.length - 1; i >= end; i--) if (Math.abs(d[i]) > floor) { end = i + 1; break; }
  const keep = Math.min(ch[0]?.length ?? 0, Math.max(min, end + Math.round(rate * 0.25)));
  return ch.map((d) => d.slice(0, keep));
}

/** Never clip: if the loudest moment is over full scale, everything is turned down to just under it. */
export function safeGain(ch: Float32Array[]): number {
  let peak = 0;
  for (const d of ch) for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  return peak > 0.966 ? 0.966 / peak : 1;
}

/** Interleaved 24-bit PCM in a RIFF/WAVE file. */
export function encodeWav(ch: Float32Array[], rate: number, gain = 1): Uint8Array {
  const n = ch[0]?.length ?? 0;
  const chans = ch.length;
  const bytes = n * chans * 3;
  const out = new Uint8Array(44 + bytes);
  const v = new DataView(out.buffer);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + bytes, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, chans, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * chans * 3, true);
  v.setUint16(32, chans * 3, true);
  v.setUint16(34, 24, true);
  w(36, "data");
  v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < chans; c++) {
      const x = Math.max(-1, Math.min(1, ch[c][i] * gain));
      const s = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff);
      out[o++] = s & 255;
      out[o++] = (s >> 8) & 255;
      out[o++] = (s >> 16) & 255;
    }
  return out;
}
