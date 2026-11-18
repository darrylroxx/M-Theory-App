/** A fast Fourier transform for real signals whose length is a power of two. */
export class FFT {
  readonly n: number;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly rev: Uint32Array;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  /** the window the signal is seen through (Hann), and what its sum is (to read levels true) */
  readonly window: Float32Array;
  readonly gain: number;

  constructor(n: number) {
    if (n < 4 || (n & (n - 1)) !== 0) throw new Error("FFT size must be a power of two");
    this.n = n;
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.re = new Float32Array(n);
    this.im = new Float32Array(n);
    this.window = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      sum += this.window[i];
    }
    this.gain = sum / 2;
  }

  /**
   * The power at each frequency of the `n` samples of `x` that end at `end` (`x` is read as a
   * ring). `out[k]` is the power of bin `k` (0..n/2), scaled so that a sine wave of amplitude 1
   * reads 1 at its own bin.
   */
  power(x: Float32Array, end: number, out: Float32Array) {
    const { n, re, im, rev, window, cos, sin } = this;
    const len = x.length;
    let p = (((end - n) % len) + len) % len;
    for (let i = 0; i < n; i++) {
      re[rev[i]] = x[p] * window[i];
      im[rev[i]] = 0;
      if (++p === len) p = 0;
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j;
          const b = a + half;
          const tr = re[b] * cos[k] + im[b] * sin[k];
          const ti = im[b] * cos[k] - re[b] * sin[k];
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    const s = 1 / (this.gain * this.gain);
    for (let k = 0; k <= n / 2; k++) out[k] = (re[k] * re[k] + im[k] * im[k]) * s;
  }
}
