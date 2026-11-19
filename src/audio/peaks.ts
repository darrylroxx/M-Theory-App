/**
 * A take's waveform, worked out once from its decoded sound and kept: an SVG path of how loud
 * it is moment by moment (the loudest sample of every hundredth of a second, or of a longer
 * stretch for a long take), mirrored round the middle. x is in hundredths of a second from the
 * take's start, y from −1 to 1, scaled so the take's loudest moment fills the height. A clip
 * shows its stretch of it by its viewBox, so every clip of a take shares one path.
 */
const cache = new WeakMap<AudioBuffer, string>();
/** at most this many points across a take */
const MAX_POINTS = 2000;

export function wavePath(b: AudioBuffer): string {
  const have = cache.get(b);
  if (have !== undefined) return have;
  const rate = b.sampleRate;
  const len = b.length;
  const step = Math.max(Math.ceil(rate / 100), Math.ceil(len / MAX_POINTS));
  const n = Math.ceil(len / step);
  const peaks = new Float32Array(n);
  for (let ch = 0; ch < b.numberOfChannels; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      let m = peaks[i];
      const end = Math.min(len, (i + 1) * step);
      for (let j = i * step; j < end; j++) {
        const v = d[j] < 0 ? -d[j] : d[j];
        if (v > m) m = v;
      }
      peaks[i] = m;
    }
  }
  let top = 0;
  for (const p of peaks) if (p > top) top = p;
  const scale = 1 / Math.max(top, 0.02);
  const x = (i: number) => ((i * step * 100) / rate).toFixed(1);
  const y = (p: number) => Math.min(1, p * scale).toFixed(2);
  let d = n ? `M${x(0)} 0` : "";
  for (let i = 0; i < n; i++) d += `L${x(i + 0.5)} -${y(peaks[i])}`;
  if (n) d += `L${x(n)} 0`;
  for (let i = n - 1; i >= 0; i--) d += `L${x(i + 0.5)} ${y(peaks[i])}`;
  if (n) d += "Z";
  cache.set(b, d);
  return d;
}
